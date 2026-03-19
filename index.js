/**
 * Stratus AI - Webex Quote Bot
 * JSON catalog engine with Claude API failover
 *
 * URL format (from SKILL.md):
 *   https://stratusinfosystems.com/order/?item={SKU1},{SKU2}&qty={qty1},{qty2}
 *
 * Flow:
 *   Webex message → JSON parser → build Stratus URLs → respond
 *   If parser can't resolve SKU → Claude API fallback → respond
 */

const express = require('express');
const axios = require('axios');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

// ─── Config ─────────────────────────────────────────────────────────────────
const WEBEX_BOT_TOKEN = process.env.WEBEX_BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

// ─── Load Catalogs ───────────────────────────────────────────────────────────
const prices = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'prices.json'))).prices;
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'auto-catalog.json')));
const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const PASSTHROUGH = new Set(catalog._PASSTHROUGH || []);

// Build a flat Set of all valid base SKUs for fast lookup
const VALID_SKUS = new Set();
for (const [key, value] of Object.entries(catalog)) {
  if (key.startsWith('_')) continue; // skip meta keys
  if (Array.isArray(value)) {
    for (const sku of value) VALID_SKUS.add(sku.toUpperCase());
  }
}
// Add passthrough SKUs
for (const sku of PASSTHROUGH) VALID_SKUS.add(sku.toUpperCase());

const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

// ─── Bot Identity ─────────────────────────────────────────────────────────────
let BOT_PERSON_ID = null;
async function getBotPersonId() {
  if (BOT_PERSON_ID) return BOT_PERSON_ID;
  const res = await axios.get('https://webexapis.com/v1/people/me', {
    headers: { Authorization: `Bearer ${WEBEX_BOT_TOKEN}` }
  });
  BOT_PERSON_ID = res.data.id;
  return BOT_PERSON_ID;
}

// ─── Webex Helpers ───────────────────────────────────────────────────────────
async function getMessage(messageId) {
  const res = await axios.get(`https://webexapis.com/v1/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${WEBEX_BOT_TOKEN}` }
  });
  return res.data;
}

async function sendMessage(roomId, markdown) {
  await axios.post('https://webexapis.com/v1/messages', {
    roomId,
    markdown
  }, {
    headers: {
      Authorization: `Bearer ${WEBEX_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    }
  });
}

// ─── SKU Suffix Rules (SKILL.md Step 2c) ─────────────────────────────────────

function applySuffix(sku) {
  const upper = sku.toUpperCase();

  // CW accessories/mounts/antennas — no suffix
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;

  // CW Wi-Fi 7 (917x family) → -RTG
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;

  // CW Wi-Fi 6E (916x family) → -MR
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;

  // MS150, MS450, C9xxx, MA- accessories, GX → no suffix
  if (upper.startsWith('MS150') || upper.startsWith('MS450') || upper.startsWith('C9') || upper.startsWith('MA-') || upper.startsWith('GX')) return upper;

  // MS130 (including MS130R) → -HW
  if (/^MS130R?-/.test(upper)) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  // MS390 → -HW
  if (upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  // Legacy switches (MS120/125/210/225/250/350/425) → -HW
  if (/^MS[1-4]\d{2}-/.test(upper) && !upper.startsWith('MS150') && !upper.startsWith('MS130') && !upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  // MX with -NA suffix already (e.g., MX67C-NA) → -HW-NA already baked in as variant name
  // These exist in catalog as "MX67C-NA" — suffix is handled differently
  if (/^MX\d+C[W]?-NA$/i.test(upper)) return upper;

  // MX cellular variants (MXxxC or MXxxCW, without -NA) → -HW-NA
  if (/^MX\d+C(W)?$/i.test(upper)) {
    return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  }

  // Z-series with X suffix (Z4X, Z4CX) — no suffix (sold as-is per prices.json)
  if (/^Z\d+C?X$/i.test(upper)) return upper;

  // All other hardware families: MR, MX, MV, MT, MG, Z → -HW
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  return upper;
}

// ─── License SKU Rules (SKILL.md Step 2d) ─────────────────────────────────────
// Term format matters:
//   Older products (MX, MV, LIC-ENT): -1YR, -3YR, -5YR
//   Newer products (MS130, MS150, C9xxx, MG, MT, Z4): -1Y, -3Y, -5Y

function getLicenseSkus(baseSku) {
  const upper = baseSku.toUpperCase();

  // AP families (MR + all CW models) → LIC-ENT (older format: -YR)
  if (/^MR\d/.test(upper) || /^CW9\d/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
    ];
  }

  // MX with -NA variant name (MX67C-NA, MX68CW-NA) → strip -NA for license model
  const mxNaMatch = upper.match(/^MX(\d+C[W]?)-NA$/);
  if (mxNaMatch) {
    const model = mxNaMatch[1];
    return [
      { term: '1Y', sku: `LIC-MX${model}-SEC-1YR` },
      { term: '3Y', sku: `LIC-MX${model}-SEC-3YR` },
      { term: '5Y', sku: `LIC-MX${model}-SEC-5YR` }
    ];
  }

  // MX security licenses (older format: -YR)
  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    return [
      { term: '1Y', sku: `LIC-MX${model}-SEC-1YR` },
      { term: '3Y', sku: `LIC-MX${model}-SEC-3YR` },
      { term: '5Y', sku: `LIC-MX${model}-SEC-5YR` }
    ];
  }

  // Z-series → SEC tier, newer format: -Y (SKILL.md line 313)
  // Z4, Z4C → LIC-Z4-SEC / LIC-Z4C-SEC
  // Z4X, Z4CX → LIC-Z4X-SEC / LIC-Z4CX-SEC
  const zMatch = upper.match(/^Z(\d+C?X?)/);
  if (zMatch) {
    const model = zMatch[1];
    return [
      { term: '1Y', sku: `LIC-Z${model}-SEC-1Y` },
      { term: '3Y', sku: `LIC-Z${model}-SEC-3Y` },
      { term: '5Y', sku: `LIC-Z${model}-SEC-5Y` }
    ];
  }

  // MG cellular gateways → ENT tier, newer format: -Y
  const mgMatch = upper.match(/^MG(\d+E?)/);
  if (mgMatch) {
    const model = mgMatch[1];
    return [
      { term: '1Y', sku: `LIC-MG${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-MG${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }

  // MS130R compact → same as MS130 compact
  if (/^MS130R-/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130 compact (8, 8P, 8P-I, 8X, 12X) → LIC-MS130-CMPT, newer format: -Y
  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130 standard (24 or 48 port), newer format: -Y
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  // MS150 (24 or 48 port), newer format: -Y (SKILL.md line 307-308)
  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    return [
      { term: '1Y', sku: `LIC-MS150-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS150-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS150-${ports}-5Y` }
    ];
  }

  // MS390, MS450 → no license in URL (DNA license separate)
  if (/^MS[34][59]0/.test(upper)) return null;

  // GX → SEC license, newer format
  const gxMatch = upper.match(/^GX(\d+)/);
  if (gxMatch) {
    const model = gxMatch[1];
    return [
      { term: '1Y', sku: `LIC-GX${model}-SEC-1Y` },
      { term: '3Y', sku: `LIC-GX${model}-SEC-3Y` },
      { term: '5Y', sku: `LIC-GX${model}-SEC-5Y` }
    ];
  }

  // MV cameras → ENT license, older format
  const mvMatch = upper.match(/^MV(\d+)/);
  if (mvMatch) {
    // MV uses per-model license: LIC-MV{model}-{term}
    // But the standard storage options vary. Use ENT tier for simplicity.
    return [
      { term: '1Y', sku: 'LIC-MV-1YR' },
      { term: '3Y', sku: 'LIC-MV-3YR' },
      { term: '5Y', sku: 'LIC-MV-5YR' }
    ];
  }

  // MT sensors → ENT license, newer format
  const mtMatch = upper.match(/^MT(\d+)/);
  if (mtMatch) {
    return [
      { term: '1Y', sku: 'LIC-MT-1Y' },
      { term: '3Y', sku: 'LIC-MT-3Y' },
      { term: '5Y', sku: 'LIC-MT-5Y' }
    ];
  }

  // Legacy switches (MS120/125/210/225/250/350/425) → ENT license, older format
  if (/^MS[12345]\d{2}-/.test(upper) && !upper.startsWith('MS130') && !upper.startsWith('MS150')) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
    ];
  }

  // CW accessories, Catalyst, passthrough — no license
  return null;
}

// ─── URL Builder (SKILL.md Step 4) ───────────────────────────────────────────
// Format: https://stratusinfosystems.com/order/?item={items}&qty={quantities}
// Items and quantities are separate comma-separated lists

function buildStratusUrl(items) {
  const itemStr = items.map(i => i.sku).join(',');
  const qtyStr = items.map(i => i.qty).join(',');
  return `https://stratusinfosystems.com/order/?item=${itemStr}&qty=${qtyStr}`;
}

// ─── EOL Check ───────────────────────────────────────────────────────────────

function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();

  // Check direct replacement lookup
  if (EOL_REPLACEMENTS[upper]) return EOL_REPLACEMENTS[upper];

  // Check family-level EOL (e.g., MR42 → check EOL_PRODUCTS.MR for "42")
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = upper.replace(family, '');
      if (variants.includes(variant)) {
        return EOL_REPLACEMENTS[upper] || EOL_REPLACEMENTS[family] || null;
      }
    }
  }
  return null;
}

function isEol(baseSku) {
  const upper = baseSku.toUpperCase();
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = upper.replace(family, '');
      if (variants.includes(variant)) return true;
    }
  }
  return false;
}

// ─── Common Mistakes ─────────────────────────────────────────────────────────

function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }
  return null;
}

// ─── SKU Validation (SKILL.md Step 2a) ───────────────────────────────────────
// Uses flat VALID_SKUS set auto-generated from prices.json

function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();

  // Check common mistakes first
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest };

  // Direct lookup in auto-generated catalog
  if (VALID_SKUS.has(upper)) {
    // Check if it's also EOL
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }

  // Check EOL products (may not be in prices.json but are still recognizable)
  if (isEol(upper)) return { valid: true, eol: true };

  // MA- accessories always pass through
  if (/^MA-/.test(upper)) return { valid: true };

  // Find the family for suggestions
  const family = detectFamily(upper);
  if (family && catalog[family]) {
    const suggestions = catalog[family].slice(0, 5);
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions };
  }

  return { valid: false, reason: `${upper} is not a recognized SKU` };
}

// ─── Family Detection (for suggestions on invalid SKUs) ─────────────────────

function detectFamily(sku) {
  if (/^MR\d/.test(sku)) return 'MR';
  if (/^MX\d/.test(sku)) return 'MX';
  if (/^MV\d/.test(sku)) return 'MV';
  if (/^MT\d/.test(sku)) return 'MT';
  if (/^MG\d/.test(sku)) return 'MG';
  if (/^Z\d/.test(sku)) return 'Z';
  if (/^GX\d/.test(sku)) return 'GX';
  if (/^MS130/.test(sku)) return 'MS130';
  if (/^MS150/.test(sku)) return 'MS150';
  if (/^MS390/.test(sku)) return 'MS390';
  if (/^MS450/.test(sku)) return 'MS450';
  if (/^CW9/.test(sku)) return 'CW';
  if (/^C9300X/.test(sku)) return 'C9300X';
  if (/^C9300L/.test(sku)) return 'C9300L';
  if (/^C9300/.test(sku)) return 'C9300';
  if (/^C9200L/.test(sku)) return 'C9200L';
  return null;
}

// ─── Message Parser ──────────────────────────────────────────────────────────

function parseMessage(text) {
  const upper = text.toUpperCase();

  // Detect explicitly requested term (only single-term if "just" or "only" used)
  let requestedTerm = null;
  const hasJust = /\b(JUST|ONLY)\b/.test(upper);
  if (hasJust) {
    if (/\b1[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 1;
    else if (/\b3[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 3;
    else if (/\b5[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 5;
  }

  // SKU patterns to match (order matters — more specific first)
  const skuPatterns = [
    /C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?/gi,  // Catalyst C9200L/C9300/C9300X
    /MA-[A-Z0-9-]+/gi,                                   // Meraki accessories
    /CW9\d{3}[A-Z0-9]*/gi,                               // CW APs
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,                          // MS150 (3-part SKU)
    /MS450-\d+/gi,                                        // MS450
    /MS[12345]\d{2}R?-[\dA-Z]+(?:-RF)?/gi,               // All MS families (130/150/210/225/250/350/390/425)
    /(?:MR|MV|MT|MG)\d+[A-Z]*/gi,                        // MR, MV, MT, MG
    /MX\d+[A-Z]*(?:-NA)?/gi,                             // MX (including MX67C-NA, MX68CW-NA)
    /GX\d+/gi,                                            // GX
    /Z\d+[A-Z]*/gi                                        // Z-series
  ];

  const foundItems = [];
  const matched = new Set();

  for (const pattern of skuPatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      const sku = match[0];
      if (matched.has(sku)) continue;
      matched.add(sku);

      // Look for quantity near this SKU
      const pos = match.index;
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + sku.length, pos + sku.length + 15);

      let qty = 1;
      const beforeQty = before.match(/(\d+)\s*[X×]?\s*$/);
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)/);

      if (beforeQty) qty = parseInt(beforeQty[1]);
      else if (afterQty) qty = parseInt(afterQty[1]);

      foundItems.push({ baseSku: sku, qty });
    }
  }

  if (foundItems.length === 0) return null;
  return { items: foundItems, requestedTerm };
}

// ─── Quote Builder ───────────────────────────────────────────────────────────

function buildQuoteResponse(parsed) {
  const terms = parsed.requestedTerm ? [parsed.requestedTerm] : [1, 3, 5];
  const eolNotes = [];
  const errors = [];
  const resolvedItems = [];

  for (const { baseSku, qty } of parsed.items) {
    // Validate
    const validation = validateSku(baseSku);
    if (!validation.valid) {
      const suggest = validation.suggest ? `\nDid you mean: ${validation.suggest.slice(0, 3).join(', ')}?` : '';
      errors.push(`⚠️ **${baseSku}**: ${validation.reason}${suggest}`);
      continue;
    }

    // EOL check
    const eol = isEol(baseSku);
    const replacement = checkEol(baseSku);
    if (eol && replacement) {
      eolNotes.push(`⚠️ **${baseSku}** is End-of-Life. Recommended replacement: **${replacement}**`);
    }

    // Apply suffix for hardware SKU
    const hwSku = applySuffix(baseSku);

    // Get license SKUs
    const licenseSkus = getLicenseSkus(baseSku);

    resolvedItems.push({ baseSku, hwSku, qty, licenseSkus, eol });
  }

  // If ALL SKUs failed validation, trigger LLM fallback
  if (errors.length > 0 && resolvedItems.length === 0) {
    return { message: null, needsLlm: true, errors };
  }

  // Build response
  let lines = [];

  if (eolNotes.length > 0) {
    lines.push(...eolNotes, '');
  }

  if (errors.length > 0) {
    lines.push(...errors, '');
  }

  if (resolvedItems.length === 0) {
    return { message: null, needsLlm: true, errors };
  }

  // Build URLs per term
  for (const term of terms) {
    const urlItems = [];
    for (const { hwSku, qty, licenseSkus, eol } of resolvedItems) {
      // For EOL items, skip hardware (license-only renewal)
      if (!eol) {
        urlItems.push({ sku: hwSku, qty });
      }
      if (licenseSkus) {
        const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
        if (licSku) urlItems.push({ sku: licSku, qty });
      }
    }
    if (urlItems.length > 0) {
      const url = buildStratusUrl(urlItems);
      const termLabel = term === 1 ? '1-Year' : term === 3 ? '3-Year' : '5-Year';
      lines.push(`**${termLabel}:** ${url}`);
      lines.push('');
    }
  }

  return { message: lines.join('\n').trim(), needsLlm: false };
}

// ─── Claude API Fallback ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Stratus AI, a Cisco/Meraki quoting assistant for Stratus Information Systems.

Your job is to generate Stratus order URLs for Cisco/Meraki products. You are the fallback when our deterministic engine can't resolve a request, so you'll typically see ambiguous SKUs, partial names, common mistakes, or general questions.

## URL FORMAT
https://stratusinfosystems.com/order/?item={item1},{item2}&qty={qty1},{qty2}

Items is a comma-separated list of SKUs. Qty is a separate comma-separated list of quantities in the same order.

Example for 10 MR44 with 3-year licenses:
https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=10,10

Example for 2 MR44 + 1 MS130-24P + 1 MX75 with 3-year:
https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR,MS130-24P-HW,LIC-MS130-24-3Y,MX75-HW,LIC-MX75-SEC-3YR&qty=2,2,1,1,1,1

## SKU SUFFIX RULES
- MR, MV, MT, MG, MS130, MS390, Z → add -HW
- MX non-cellular → add -HW
- MX cellular (MXxxC, MXxxCW) → add -HW-NA
- CW Wi-Fi 6E (CW916x) → add -MR
- CW Wi-Fi 7 (CW917x) → add -RTG
- MS150, MS450, C9xxx-M, MA- accessories, GX → no suffix
- Z4X, Z4CX → no suffix (sold as-is)
- Legacy switches (MS120/125/210/225/250/350/425) → add -HW

## LICENSE RULES (term format matters!)
- All APs (MR + CW) → LIC-ENT-1YR / LIC-ENT-3YR / LIC-ENT-5YR
- MX → LIC-MX{model}-SEC-1YR / -3YR / -5YR
- Z-series → LIC-Z{model}-SEC-1Y / -3Y / -5Y
- MG → LIC-MG{model}-ENT-1Y / -3Y / -5Y
- MV → LIC-MV-1YR / -3YR / -5YR
- MT → LIC-MT-1Y / -3Y / -5Y
- MS130 compact (8/8P/8X/12X) → LIC-MS130-CMPT-1Y / -3Y / -5Y
- MS130 standard (24/48) → LIC-MS130-{24/48}-1Y / -3Y / -5Y
- MS150 24-port → LIC-MS150-24-1Y / -3Y / -5Y
- MS150 48-port → LIC-MS150-48-1Y / -3Y / -5Y
- MS390, MS450 → no license in URL (DNA license separate)
- GX → LIC-GX{model}-SEC-1Y / -3Y / -5Y
- Legacy switches → LIC-ENT-1YR / -3YR / -5YR

## VALID PRODUCT CATALOG
Use this list to resolve ambiguous requests. If a user says a partial name, match to the closest model(s) and ask for clarification if multiple match.

**APs (MR):** MR28, MR36, MR36H, MR44, MR46, MR46E, MR52, MR57, MR76, MR78, MR86
**APs (CW Wi-Fi 6E):** CW9162I, CW9163E, CW9164I, CW9166I, CW9166D1
**APs (CW Wi-Fi 7):** CW9172I, CW9172H, CW9176D1, CW9176I, CW9178I
**MX Security:** MX67, MX67W, MX67C, MX68, MX68W, MX68CW, MX75, MX85, MX95, MX105, MX250, MX450
**MS130 Switches:** MS130-8, MS130-8P, MS130-8P-I, MS130-8X, MS130-12X, MS130-24, MS130-24P, MS130-24X, MS130-48, MS130-48P, MS130-48X, MS130R-8P
**MS150 Switches:** MS150-24T-4G, MS150-24P-4G, MS150-24T-4X, MS150-24P-4X, MS150-24MP-4X, MS150-48T-4G, MS150-48LP-4G, MS150-48FP-4G, MS150-48T-4X, MS150-48LP-4X, MS150-48FP-4X, MS150-48MP-4X
**MS390 Switches:** MS390-24UX, MS390-48UX, MS390-48UX2
**MS450 Switches:** MS450-12
**MV Cameras:** MV2, MV13, MV13M, MV22, MV22X, MV23M, MV23X, MV32, MV33, MV33M, MV52, MV53X, MV63, MV63M, MV63X, MV72, MV72X, MV73X, MV73M, MV84X, MV93, MV93M, MV93X
**MT Sensors:** MT10, MT11, MT12, MT14, MT15, MT20, MT30, MT40
**MG Cellular:** MG21, MG21E, MG41, MG41E, MG51, MG51E, MG52, MG52E
**Z-Series:** Z4, Z4C, Z4X, Z4CX
**GX:** GX20, GX50

## OUTPUT RULES
- Always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term
- URL-only output by default, no pricing tables
- If user asks "how much", "price", or "cost" you may add pricing context
- If a SKU is EOL, note the replacement and offer renewal vs refresh options
- If a SKU is ambiguous (like "MS150-48"), list the valid variants and ask which one they need
- If you truly can't determine the product, say so and list nearby options

## EOL REPLACEMENTS
MR33→MR36, MR42→MR44, MR42E→MR46E, MR52/53/56→MR57, MR74→MR76, MR84→MR86
MX64→MX67, MX64W→MX67W, MX65→MX68, MX65W→MX68W, MX80/84→MX85
MS120/125/210/220/225→MS130, MS250/320→MS150, MS350/410/420/425→MS390

## COMMON MISTAKES
MR55 doesn't exist (suggest MR57). MS130-13X doesn't exist (suggest MS130-12X). MS350-24 is EOL (suggest MS390-24UX).

Keep responses concise, formatted for Webex markdown.`;

async function askClaude(userMessage) {
  if (!anthropic) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }]
    });
    return response.content[0].text;
  } catch (err) {
    console.error('Claude API error:', err.message);
    return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44" or "5 MS150-48LP-4G".`;
  }
}

// ─── Webhook Handler ─────────────────────────────────────────────────────────

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const event = req.body;
    if (event.resource !== 'messages' || event.event !== 'created') return;

    const botId = await getBotPersonId();
    if (event.data.personId === botId) return;

    const msg = await getMessage(event.data.id);
    const text = (msg.text || '').trim();
    if (!text) return;

    const roomId = msg.roomId;

    // Try JSON engine first
    const parsed = parseMessage(text);

    if (parsed) {
      const result = buildQuoteResponse(parsed);

      if (!result.needsLlm && result.message) {
        await sendMessage(roomId, result.message);
        return;
      }

      // If errors exist but we're falling back, include them for context
      if (result.errors && result.errors.length > 0) {
        const errorContext = result.errors.join('\n');
        const claudeReply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`);
        await sendMessage(roomId, claudeReply);
        return;
      }
    }

    // Full fallback to Claude API
    const claudeReply = await askClaude(text);
    await sendMessage(roomId, claudeReply);

  } catch (err) {
    console.error('Webhook error:', err.message, err.stack);
    // Try to notify the user something went wrong
    try {
      const event = req.body;
      if (event?.data?.roomId) {
        await sendMessage(event.data.roomId, `⚠️ Something went wrong processing your request. Try again with a specific SKU like "quote 10 MR44".`);
      }
    } catch (notifyErr) {
      console.error('Failed to send error notification:', notifyErr.message);
    }
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Stratus AI running', version: '2.0.0' }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Stratus AI bot listening on port ${PORT}`);
  if (WEBEX_BOT_TOKEN) {
    getBotPersonId().then(id => console.log(`Bot ID: ${id}`)).catch(console.error);
  }
});

// ─── Exports for testing ─────────────────────────────────────────────────────
module.exports = { parseMessage, buildQuoteResponse, applySuffix, getLicenseSkus, buildStratusUrl, validateSku, isEol, checkEol, detectFamily, VALID_SKUS };
