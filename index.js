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

// ─── Conversation Memory (per-user, in-memory) ──────────────────────────────
const conversationHistory = new Map();
const MAX_HISTORY = 10;
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getHistory(personId) {
  const entry = conversationHistory.get(personId);
  if (!entry) return [];
  // Auto-clear if older than TTL
  if (Date.now() - entry.lastActive > HISTORY_TTL_MS) {
    conversationHistory.delete(personId);
    return [];
  }
  return entry.messages;
}

function addToHistory(personId, role, content) {
  let entry = conversationHistory.get(personId);
  if (!entry) {
    entry = { messages: [], lastActive: Date.now() };
    conversationHistory.set(personId, entry);
  }
  entry.messages.push({ role, content });
  entry.lastActive = Date.now();
  // Trim to MAX_HISTORY (keeping pairs where possible)
  while (entry.messages.length > MAX_HISTORY) {
    entry.messages.shift();
  }
}

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

function getLicenseSkus(baseSku, requestedTier) {
  const upper = baseSku.toUpperCase();

  // AP families (MR + all CW models) → LIC-ENT (older format: -YR)
  // APs only support ENT — ignore requestedTier
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
    // MX supports ENT, SEC, SDW — default SEC
    const tier = requestedTier || 'SEC';
    // Older MX models (67/68) use -YR, newer (75/85/95/105) use -Y
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const isNewer = modelNum >= 75;
    const suffix = isNewer ? 'Y' : 'YR';
    // SDW uses -Y format regardless of model age
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  // MX security appliances — supports ENT, SEC, SDW (default SEC)
  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    const tier = requestedTier || 'SEC';
    // Older MX models (67/68/100/250/450) use -YR, newer (75/85/95/105) use -Y
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const isNewer = modelNum >= 75 && modelNum < 250;
    const suffix = isNewer ? 'Y' : 'YR';
    // SDW uses -Y format regardless of model age
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  // Z-series license tiers:
  //   Z1, Z3, Z3C → ENT only (older -YR format). If user requests SEC/SDW, warn + default ENT.
  //   Z4, Z4C → ENT + SEC (newer -Y format). Default ENT. If user requests SDW, warn + default ENT.
  //   Z4X, Z4CX → use Z4/Z4C licenses respectively
  const zMatch = upper.match(/^Z(\d+)(C)?(X)?$/);
  if (zMatch) {
    const zNum = zMatch[1];          // "1", "3", "4"
    const hasC = !!zMatch[2];        // cellular variant
    const hasX = !!zMatch[3];        // X variant (uses parent model license)

    // Determine license model name: Z4X uses Z4, Z4CX uses Z4C
    const licModel = `Z${zNum}${hasC ? 'C' : ''}`;

    if (zNum === '1' || zNum === '3') {
      // Legacy Z: ENT only, -YR format
      return [
        { term: '1Y', sku: `LIC-${licModel}-ENT-1YR` },
        { term: '3Y', sku: `LIC-${licModel}-ENT-3YR` },
        { term: '5Y', sku: `LIC-${licModel}-ENT-5YR` }
      ];
    }
    // Z4/Z4C/Z4X/Z4CX: supports ENT + SEC, newer -Y format. Default ENT.
    const zTier = (requestedTier === 'SEC') ? 'SEC' : 'ENT';
    return [
      { term: '1Y', sku: `LIC-${licModel}-${zTier}-1Y` },
      { term: '3Y', sku: `LIC-${licModel}-${zTier}-3Y` },
      { term: '5Y', sku: `LIC-${licModel}-${zTier}-5Y` }
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
    // Filter to entries that contain the user's partial input (e.g., "MS150-48" matches MS150-48T-4G, MS150-48LP-4G, etc.)
    const partialMatches = catalog[family].filter(s => s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase()));
    const suggestions = partialMatches.length > 0 ? partialMatches : catalog[family].slice(0, 5);
    const isPartialMatch = partialMatches.length > 1;
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions, isPartialMatch };
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

  // ─── Modifier Detection (Error 1 fix) ──────────────────────────────────────
  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|WITHOUT\s+(A\s+)?LICENSE|NO\s+LICENSE|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  if (/\b(LICENSE\s+ONLY|JUST\s+THE\s+LICENSE|JUST\s+LICENSE|LICENSE[S]?\s+ONLY|NO\s+HARDWARE|RENEWAL\s+ONLY)\b/.test(upper)) {
    modifiers.licenseOnly = true;
  }

  // ─── License Tier Detection (Phase 3) ───────────────────────────────────────
  let requestedTier = null;
  if (/\b(ADVANCED\s+SECURITY|SEC(URITY)?)\b/.test(upper) && !/\bENTERPRISE\b/.test(upper)) {
    requestedTier = 'SEC';
  } else if (/\bENT(ERPRISE)?\b/.test(upper) && !/\bSEC(URITY)?\b/.test(upper)) {
    requestedTier = 'ENT';
  } else if (/\b(SD[\s-]?WAN|SDW)\b/.test(upper)) {
    requestedTier = 'SDW';
  }

  // ─── Intent Classification (Error 3 fix) ───────────────────────────────────
  const advisoryPatterns = [
    /\bWHAT('?S| IS) THE DIFFERENCE\b/,
    /\bWHICH (ONE |SHOULD |DO |WOULD )/,
    /\bDO I NEED\b/,
    /\bIS .+ COMPATIBLE\b/,
    /\bCAN I USE\b/,
    /\bSHOULD I (GET|USE|GO|CHOOSE|PICK)\b/,
    /\bWHAT (DO YOU|WOULD YOU) (RECOMMEND|SUGGEST)\b/,
    /\bCOMPARE\b/,
    /\bTELL ME ABOUT\b/,
    /\bWHAT('?S| IS) THE BEST\b/,
    /\bHOW (DOES|DO|MANY|MUCH THROUGHPUT|FAST)\b/,
    /\bSPECS?\b/,
    /\bDIFFERENCE BETWEEN\b/
  ];
  const isAdvisory = advisoryPatterns.some(p => p.test(upper));

  // SKU patterns to match (order matters — more specific first)
  const skuPatterns = [
    /C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?/gi,  // Catalyst C9200L/C9300/C9300X
    /MA-[A-Z0-9-]+/gi,                                   // Meraki accessories
    /CW9\d{3}[A-Z0-9]*/gi,                               // CW APs
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,                          // MS150 (3-part SKU)
    /MS450-\d+/gi,                                        // MS450
    /MS[12345]\d{2}R?-[\dA-Z]+(?:-RF)?/gi,               // All MS families (130/150/210/225/250/350/390/425)
    /(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])/gi,              // MR, MV, MT, MG — only 0-1 trailing alpha (prevents MR44S from plural "s")
    /MX\d+[A-Z]*(?:-NA)?/gi,                             // MX (including MX67C-NA, MX68CW-NA)
    /GX\d+/gi,                                            // GX
    /Z\d+[A-Z]*/gi                                        // Z-series
  ];

  const rawMatches = [];
  const matched = new Set();

  for (const pattern of skuPatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      let sku = match[0];
      const pos = match.index;

      // ─── Plural "s" strip (Error 4 fix) ──────────────────────────────
      // If SKU ends with S and stripped version is valid but full version is not, strip it
      if (sku.endsWith('S') && sku.length > 3) {
        const stripped = sku.slice(0, -1);
        const strippedValid = VALID_SKUS.has(stripped) || detectFamily(stripped) !== null;
        const fullValid = VALID_SKUS.has(sku);
        if (strippedValid && !fullValid) {
          sku = stripped;
        }
      }

      if (matched.has(sku)) continue;
      matched.add(sku);

      // Look for quantity near this SKU
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + match[0].length, pos + match[0].length + 15);

      let qty = 1;
      const beforeQty = before.match(/(\d+)\s*[X×]?\s*$/);
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)/);

      if (beforeQty) qty = parseInt(beforeQty[1]);
      else if (afterQty) qty = parseInt(afterQty[1]);

      rawMatches.push({ baseSku: sku, qty, position: pos });
    }
  }

  // ─── Subsumption Dedup (Error 2 fix) ──────────────────────────────────────
  // If one matched SKU is a substring of another (e.g., MS150-48FP inside MS150-48FP-4G),
  // drop the shorter one.
  const foundItems = rawMatches.filter((item, idx) => {
    return !rawMatches.some((other, otherIdx) => {
      if (idx === otherIdx) return false;
      return other.baseSku.length > item.baseSku.length && other.baseSku.includes(item.baseSku);
    });
  });

  // ─── Sort by input position (Error 4 fix) ────────────────────────────────
  foundItems.sort((a, b) => a.position - b.position);

  // Strip position from output (not needed downstream)
  const items = foundItems.map(({ baseSku, qty }) => ({ baseSku, qty }));

  // ─── Revision Intent Detection ──────────────────────────────────────────────
  // Detect follow-up modification requests that reference a prior quote
  const revisionPatterns = [
    /\b(REMOVE|DROP|TAKE OUT|DELETE|STRIP|EXCLUDE)\b.*(LICENSE|HARDWARE|HW|AP|SWITCH|MX|MR)/,
    /\b(REMOVE|DROP|TAKE OUT|DELETE|STRIP|EXCLUDE)\b.*(FROM|THE|THAT|THOSE)/,
    /\b(ADD|INCLUDE|THROW IN|TACK ON)\b.*\b(MORE|EXTRA|ADDITIONAL|ALSO)\b/,
    /\b(CHANGE|UPDATE|MODIFY|ADJUST|SWITCH)\b.*(QUANTITY|QTY|COUNT|NUMBER|TERM|LICENSE|TIER)/,
    /\b(MAKE (IT|THAT|THEM))\b.*(INSTEAD|RATHER)/,
    /\b(ACTUALLY|NEVER\s?MIND|SCRATCH THAT|WAIT)\b/,
    /\bINSTEAD OF\b/,
    /\b(JUST|ONLY)\s+(THE\s+)?(LICENSE|HARDWARE|HW)\b/,
    /\bSWITCH (TO|IT TO)\b/,
    /\bBUMP (IT |THAT |THE )?(UP|DOWN|TO)\b/
  ];
  const isRevision = revisionPatterns.some(p => p.test(upper));

  if (items.length === 0) {
    // No SKUs found — could be a revision or advisory, but not a quote request
    if (isRevision || isAdvisory) {
      return { items: [], requestedTerm, modifiers, requestedTier, isAdvisory, isRevision };
    }
    return null;
  }
  return { items, requestedTerm, modifiers, requestedTier, isAdvisory, isRevision };
}

// ─── Quote Builder ───────────────────────────────────────────────────────────

function buildQuoteResponse(parsed) {
  // ─── Advisory intent → route to Claude (Error 3 fix) ─────────────────────
  if (parsed.isAdvisory) {
    return { message: null, needsLlm: true, advisory: true };
  }

  // ─── Revision intent with no new SKUs → route to Claude with history ─────
  if (parsed.isRevision && parsed.items.length === 0) {
    return { message: null, needsLlm: true, revision: true };
  }

  const terms = parsed.requestedTerm ? [parsed.requestedTerm] : [1, 3, 5];
  const modifiers = parsed.modifiers || { hardwareOnly: false, licenseOnly: false };
  const requestedTier = parsed.requestedTier || null;
  const eolItems = [];
  const errors = [];
  const resolvedItems = [];
  const tierWarnings = [];

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
      eolItems.push({ baseSku, qty, replacement, eol: true });
      continue; // Handle EOL separately with dual-option flow
    }

    // Z-series tier warnings
    const zTest = baseSku.toUpperCase().match(/^Z(\d+)/);
    if (zTest) {
      const zNum = zTest[1];
      if ((zNum === '1' || zNum === '3') && requestedTier && requestedTier !== 'ENT') {
        tierWarnings.push(`⚠️ **${baseSku}** only supports Enterprise licensing. Using ENT.`);
      }
      if (zNum === '4' && requestedTier === 'SDW') {
        tierWarnings.push(`⚠️ **${baseSku}** does not support SD-WAN licensing. Using ENT.`);
      }
    }

    // Apply suffix for hardware SKU
    const hwSku = applySuffix(baseSku);

    // Get license SKUs with tier support
    const licenseSkus = getLicenseSkus(baseSku, requestedTier);

    resolvedItems.push({ baseSku, hwSku, qty, licenseSkus, eol: false });
  }

  // ─── Hard-stop on validation errors (Phase 4) ───────────────────────────
  // If ANY item failed validation, do NOT generate URLs — return errors only
  if (errors.length > 0) {
    // Check if all errors have partial-match suggestions (ambiguous SKU clarification)
    const allPartialMatches = parsed.items.every(({ baseSku }) => {
      const v = validateSku(baseSku);
      return v.valid || (!v.valid && v.isPartialMatch && v.suggest && v.suggest.length > 0);
    });

    // If some items resolved but others failed, hard-stop with error + suggestions
    if (resolvedItems.length > 0) {
      const lines = [...errors];
      lines.push('');
      lines.push('Please correct the invalid SKU(s) above and try again. I can only generate a quote when all items are valid.');
      return { message: lines.join('\n'), needsLlm: false };
    }

    // If ALL failed and all are partial matches, show clarification
    if (allPartialMatches) {
      const lines = [];
      for (const { baseSku } of parsed.items) {
        const v = validateSku(baseSku);
        if (v.valid) continue;
        const family = detectFamily(baseSku.toUpperCase());
        const familyLabel = family || baseSku.toUpperCase();
        const portMatch = baseSku.match(/\d+$/);
        const portHint = portMatch ? ` ${portMatch[0]}-port` : '';
        lines.push(`I found multiple ${familyLabel}${portHint} variants. Which one do you need?`);
        for (const s of v.suggest) {
          lines.push(`• ${s}`);
        }
      }
      return { message: lines.join('\n'), needsLlm: false };
    }

    return { message: null, needsLlm: true, errors };
  }

  // Build response
  let lines = [];

  if (tierWarnings.length > 0) {
    lines.push(...tierWarnings, '');
  }

  // ─── EOL Dual-Option Flow (Phase 5) ───────────────────────────────────────
  if (eolItems.length > 0) {
    for (const { baseSku, qty, replacement } of eolItems) {
      lines.push(`⚠️ **${baseSku}** is End-of-Life. Replacement: **${replacement}**`);
      lines.push('');

      // Option A: Renew existing (license-only for current model)
      const renewLicenses = getLicenseSkus(baseSku, requestedTier);
      if (renewLicenses) {
        lines.push(`**Option A — Renew Existing ${baseSku} License:**`);
        for (const term of terms) {
          const licSku = renewLicenses.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) {
            const url = buildStratusUrl([{ sku: licSku, qty }]);
            const termLabel = term === 1 ? '1-Year' : term === 3 ? '3-Year' : '5-Year';
            lines.push(`${termLabel}: ${url}`);
          }
        }
        lines.push('');
      }

      // Option B: Refresh to replacement (hardware + license)
      const replHwSku = applySuffix(replacement);
      const replLicenses = getLicenseSkus(replacement, requestedTier);
      lines.push(`**Option B — Refresh to ${replacement}:**`);
      for (const term of terms) {
        const urlItems = [];
        if (!modifiers.licenseOnly) urlItems.push({ sku: replHwSku, qty });
        if (replLicenses && !modifiers.hardwareOnly) {
          const licSku = replLicenses.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year' : term === 3 ? '3-Year' : '5-Year';
          lines.push(`${termLabel}: ${url}`);
        }
      }
      lines.push('');
    }
  }

  if (resolvedItems.length === 0 && eolItems.length === 0) {
    return { message: null, needsLlm: true, errors };
  }

  // Build URLs per term for non-EOL items
  if (resolvedItems.length > 0) {
    for (const term of terms) {
      const urlItems = [];
      for (const { hwSku, qty, licenseSkus } of resolvedItems) {
        if (!modifiers.licenseOnly) {
          urlItems.push({ sku: hwSku, qty });
        }
        if (licenseSkus && !modifiers.hardwareOnly) {
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
  }

  return { message: lines.join('\n').trim(), needsLlm: false };
}

// ─── Claude API Fallback ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products.

## YOUR ROLE
You are the fallback when our deterministic quoting engine can't resolve a request. You'll typically see ambiguous SKUs, partial product names, common mistakes, natural language questions, or follow-up requests referencing prior context.

## REASONING APPROACH
Think through each request step by step before generating URLs:
1. Identify what products the user is asking about
2. Verify each SKU exists in the catalog below. NEVER assume a product exists. NEVER invent SKUs, pricing, or specifications.
3. Apply the correct hardware suffix
4. Pair with the correct license SKU and term format
5. Build the URL

If a product can't be found, ask the user to clarify. Suggest the closest alternatives from the catalog.

## PERSONA
Professional, concise, action-oriented. Give direct answers without conversational fluff. Short answers for well-defined questions. Positive and engaging tone. You're a knowledgeable colleague, not a help desk.

## STRATUS CONTEXT
Stratus Information Systems is a Cisco-exclusive reseller specializing in Meraki cloud-managed networking. We serve K-12, higher ed, healthcare, and enterprise customers. Our quoting tool generates instant order URLs that populate a cart on stratusinfosystems.com.

## URL FORMAT
https://stratusinfosystems.com/order/?item={item1},{item2}&qty={qty1},{qty2}

Items and quantities are separate comma-separated lists in matching order.

## SKU SUFFIX RULES
- MR, MV, MT, MG, MS130, MS130R, MS390, Z (not Z4X/Z4CX) → add -HW
- MX non-cellular → add -HW
- MX cellular (MXxxC, MXxxCW) → add -HW-NA
- CW Wi-Fi 6E (CW916x) → add -MR
- CW Wi-Fi 7 (CW917x) → add -RTG
- MS150, MS450, C9xxx-M, MA- accessories, GX → no suffix
- Z4X, Z4CX → no suffix (sold as-is)
- Legacy switches (MS120/125/210/225/250/350/425) → add -HW
IMPORTANT: Users often omit the -HW suffix. If someone says "MR44", they mean the hardware appliance (MR44-HW). Handle this gracefully.

## LICENSE RULES (term format matters!)
Three license tiers exist for MX/Z/GX:
- ENT (Enterprise): Available for ALL product families
- SEC (Advanced Security): Available for MX (all models), Z4/Z4C, GX
- SDW (SD-WAN): Available for MX (all models) only

Tier selection rules:
- MX: Supports ENT, SEC, SDW. Default = SEC unless user requests otherwise.
- Z1, Z3, Z3C: ENT ONLY. If user asks for Security, explain these only support Enterprise.
- Z4, Z4C: ENT + SEC. Default = ENT unless user requests Security.
- All other families (MR, MS, MV, MT, MG): ENT only.
- GX: SEC only.

Specific mappings:
- All APs (MR + CW) → LIC-ENT-1YR / LIC-ENT-3YR / LIC-ENT-5YR
- MX older (67/68/250/450) → LIC-MX{model}-{ENT|SEC}-1YR / -3YR / -5YR (note: SDW uses -Y not -YR)
- MX newer (75/85/95/105) → LIC-MX{model}-{ENT|SEC|SDW}-1Y / -3Y / -5Y
- Z1/Z3/Z3C → LIC-Z{model}-ENT-1YR / -3YR / -5YR (ENT only, older -YR format)
- Z4/Z4C → LIC-Z{model}-{ENT|SEC}-1Y / -3Y / -5Y (newer -Y format)
- MG → LIC-MG{model}-ENT-1Y / -3Y / -5Y (newer -Y format)
- MV → LIC-MV-1YR / -3YR / -5YR
- MT → LIC-MT-1Y / -3Y / -5Y
- MS130 compact (8/8P/8X/12X) → LIC-MS130-CMPT-1Y / -3Y / -5Y
- MS130 standard (24/48) → LIC-MS130-{24/48}-1Y / -3Y / -5Y
- MS150 24-port → LIC-MS150-24-1Y / -3Y / -5Y
- MS150 48-port → LIC-MS150-48-1Y / -3Y / -5Y
- MS390, MS450 → no license in URL (DNA license handled separately)
- GX → LIC-GX{model}-SEC-1Y / -3Y / -5Y
- Legacy switches → LIC-ENT-1YR / -3YR / -5YR
IMPORTANT: Watch for -YR vs -Y. Older products (MR, MX67/68/250/450, MV, legacy switches) use -1YR/-3YR/-5YR. Newer products (MX75/85/95/105, MS130, MS150, Z4, MG, MT, GX) use -1Y/-3Y/-5Y. SDW always uses -Y format.

## MODIFIER HANDLING
Users may request hardware-only or license-only quotes:
- "hardware only", "without a license", "no license", "just the hardware" → exclude licenses from URL
- "license only", "just the license", "renewal only", "no hardware" → exclude hardware from URL
If detected, adjust the URL accordingly.

## VALID PRODUCT CATALOG
NEVER assume a product exists if it's not on this list. If not found, ask for clarification and suggest alternatives.

APs (MR): MR28, MR36, MR36H, MR44, MR46, MR46E, MR52, MR57, MR76, MR78, MR86
APs (CW Wi-Fi 6E): CW9162I, CW9163E, CW9164I, CW9166I, CW9166D1
APs (CW Wi-Fi 7): CW9172I, CW9172H, CW9176D1, CW9176I, CW9178I
MX Security: MX67, MX67W, MX67C, MX67C-NA, MX68, MX68W, MX68CW, MX68CW-NA, MX75, MX85, MX95, MX105, MX250, MX450
MS130 Switches: MS130-8, MS130-8P, MS130-8P-I, MS130-8X, MS130-12X, MS130-24, MS130-24P, MS130-24X, MS130-48, MS130-48P, MS130-48X, MS130R-8P
MS150 Switches: MS150-24T-4G, MS150-24P-4G, MS150-24T-4X, MS150-24P-4X, MS150-24MP-4X, MS150-48T-4G, MS150-48LP-4G, MS150-48FP-4G, MS150-48T-4X, MS150-48LP-4X, MS150-48FP-4X, MS150-48MP-4X
MS390 Switches: MS390-24UX, MS390-48UX, MS390-48UX2
MS450 Switches: MS450-12
MV Cameras: MV2, MV13, MV13M, MV22, MV22X, MV23M, MV23X, MV32, MV33, MV33M, MV52, MV53X, MV63, MV63M, MV63X, MV72, MV72X, MV73X, MV73M, MV84X, MV93, MV93M, MV93X
MT Sensors: MT10, MT11, MT12, MT14, MT15, MT20, MT30, MT40
MG Cellular: MG21, MG21E, MG41, MG41E, MG51, MG51E, MG52, MG52E
Z-Series: Z4, Z4C, Z4X, Z4CX
GX: GX20, GX50

## HANDLING INVALID OR AMBIGUOUS SKUs
- INVALID SKU: "I couldn't find that SKU in our catalog. Could you double-check the product code? Here are some similar options: [list]"
- AMBIGUOUS SKU: "I found multiple products that match. Which one do you need?" then list the options with bullet points.
- EMPTY RESULTS: If a product truly can't be matched, say so clearly and suggest the user verify the model number.
NEVER guess. If uncertain, ask.

## OUTPUT RULES
- Always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term
- URL-only output by default, no pricing tables
- If user asks "how much", "price", or "cost" you may add pricing context
- If a SKU is EOL, note the replacement and offer renewal vs refresh options
- Use bullet points, not tables (tables don't render well in Webex)
- Post URLs as plain text (not markdown links, since Webex auto-links them)
- Keep responses concise

## EOL REPLACEMENTS
MR33→MR36, MR42→MR44, MR42E→MR46E, MR52/53/56→MR57, MR74→MR76, MR84→MR86
MX64→MX67, MX64W→MX67W, MX65→MX68, MX65W→MX68W, MX80/84→MX85
MS120/125/210/220/225→MS130, MS250/320→MS150, MS350/410/420/425→MS390

## COMMON MISTAKES
MR55 doesn't exist (suggest MR57). MS130-13X doesn't exist (suggest MS130-12X). MS350-24 is EOL (suggest MS390-24UX).

## QUOTE REVISION (FOLLOW-UP REQUESTS)
Users may reference a prior quote and ask to modify it. You'll see the conversation history and a system note indicating this is a revision. Common revision requests:
- "remove the license" → regenerate the prior quote with hardware only (no license SKUs)
- "remove the hardware" / "just the license" → regenerate with license only
- "change to 3 year only" → regenerate with only the 3-year term
- "change quantity to 20" / "bump it to 20" → regenerate with updated quantity
- "add 5 more MR44" → add to the existing quote items
- "switch to enterprise" / "change to security" → change the license tier
- "actually make it an MX85 instead" → swap out the product

When revising:
1. Look at your prior response in conversation history to understand the original quote
2. Apply the requested modification
3. Generate fresh URLs with the changes applied
4. Briefly note what changed (e.g., "Here's the updated quote with hardware only:")

## FEW-SHOT EXAMPLES

User: "quote 10 MR44"
Response:
1-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=10,10

3-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=10,10

5-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=10,10

User: "I need 5 MS150-48s"
Response:
I found multiple MS150 48-port variants. Which one do you need?
• MS150-48T-4G
• MS150-48LP-4G (PoE)
• MS150-48FP-4G (Full PoE)
• MS150-48T-4X (10G uplink)
• MS150-48LP-4X (PoE + 10G uplink)
• MS150-48FP-4X (Full PoE + 10G uplink)
• MS150-48MP-4X (mGig PoE)

User: "2 MR44 and 1 MX75 3 year only"
Response:
3-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR,MX75-HW,LIC-MX75-SEC-3Y&qty=2,2,1,1

User: "1 MX67 enterprise"
Response:
1-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-ENT-1YR&qty=1,1

3-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-ENT-3YR&qty=1,1

5-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-ENT-5YR&qty=1,1

User: "5 MR44 hardware only"
Response:
https://stratusinfosystems.com/order/?item=MR44-HW&qty=5

User: "What's the difference between the MX75 and MX85?"
Response:
The MX75 and MX85 are both next-gen Meraki security appliances. The MX85 offers higher throughput and is designed for larger deployments (up to ~600 users), while the MX75 covers mid-range deployments (up to ~200 users). Both support Enterprise, Advanced Security, and SD-WAN licensing.

Want me to put together a quote for either one?

User (follow-up after quoting "10 MR44"): "remove the license"
Response:
Here's the updated quote with hardware only:

https://stratusinfosystems.com/order/?item=MR44-HW&qty=10

User (follow-up after quoting "2 MX75"): "switch to enterprise"
Response:
Updated with Enterprise licensing:

1-Year: https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX75-ENT-1Y&qty=2,2

3-Year: https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX75-ENT-3Y&qty=2,2

5-Year: https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX75-ENT-5Y&qty=2,2`;

async function askClaude(userMessage, personId) {
  if (!anthropic) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';
  try {
    // Build messages array with conversation history
    const history = personId ? getHistory(personId) : [];
    const messages = [...history, { role: 'user', content: userMessage }];

    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-latest',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages
    });
    const reply = response.content[0].text;

    // Log both sides to history
    if (personId) {
      addToHistory(personId, 'user', userMessage);
      addToHistory(personId, 'assistant', reply);
    }

    return reply;
  } catch (err) {
    console.error('Claude API error:', err.message, err.status, JSON.stringify(err.error || {}));
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
    const personId = event.data.personId;
    if (personId === botId) return;

    const msg = await getMessage(event.data.id);
    const text = (msg.text || '').trim();
    if (!text) return;

    const roomId = msg.roomId;

    // Try JSON engine first
    const parsed = parseMessage(text);

    if (parsed) {
      const result = buildQuoteResponse(parsed);

      if (!result.needsLlm && result.message) {
        // Log successful JSON engine interactions to history for context continuity
        addToHistory(personId, 'user', text);
        addToHistory(personId, 'assistant', result.message);
        await sendMessage(roomId, result.message);
        return;
      }

      // Revision intent — route to Claude with explicit instruction to use conversation history
      if (result.revision) {
        const history = getHistory(personId);
        if (history.length > 0) {
          const claudeReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId);
          await sendMessage(roomId, claudeReply);
          return;
        }
        // No history — can't revise what doesn't exist
        await sendMessage(roomId, `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`);
        return;
      }

      // If errors exist but we're falling back, include them for context
      if (result.errors && result.errors.length > 0) {
        const errorContext = result.errors.join('\n');
        const claudeReply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId);
        await sendMessage(roomId, claudeReply);
        return;
      }
    }

    // Full fallback to Claude API
    const claudeReply = await askClaude(text, personId);
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
module.exports = { parseMessage, buildQuoteResponse, applySuffix, getLicenseSkus, buildStratusUrl, validateSku, isEol, checkEol, detectFamily, VALID_SKUS, getHistory, addToHistory, conversationHistory, SYSTEM_PROMPT, askClaude };
