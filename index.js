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
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'valid_skus.json')));
const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};

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

  // CW Wi-Fi 7 (917x family) → -RTG
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;

  // CW Wi-Fi 6E (916x family) → -MR
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;

  // MS150, C9xxx, MA- accessories → no suffix
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('MA-')) return upper;

  // MS130, MS390 → -HW
  if (upper.startsWith('MS130') || upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  // MX cellular variants (MXxxC or MXxxCW) → -HW-NA
  if (/^MX\d+C(W)?$/i.test(upper)) {
    return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  }

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
  if (/^MR\d/.test(upper) || /^CW9/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
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
  const zMatch = upper.match(/^Z(\d+C?)/);
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

  // MS390 → no license in URL
  if (/^MS390/.test(upper)) return null;

  // No license mapping found
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

function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();

  // Check common mistakes first
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest };

  // MR
  if (/^MR\d/.test(upper)) {
    const variant = upper.replace('MR', '');
    if (catalog.MR && catalog.MR.includes(variant)) return { valid: true };
    if (EOL_PRODUCTS.MR && EOL_PRODUCTS.MR.includes(variant)) return { valid: true, eol: true };
    return { valid: false, reason: `MR${variant} is not a recognized model`, suggest: catalog.MR?.map(v => `MR${v}`) };
  }

  // MX
  if (/^MX\d/.test(upper)) {
    const variant = upper.replace('MX', '');
    if (catalog.MX && catalog.MX.includes(variant)) return { valid: true };
    if (EOL_PRODUCTS.MX && EOL_PRODUCTS.MX.includes(variant)) return { valid: true, eol: true };
    return { valid: false, reason: `MX${variant} is not a recognized model`, suggest: catalog.MX?.map(v => `MX${v}`) };
  }

  // MV
  if (/^MV\d/.test(upper)) {
    const variant = upper.replace('MV', '');
    if (catalog.MV && catalog.MV.includes(variant)) return { valid: true };
    return { valid: false, reason: `MV${variant} is not a recognized model` };
  }

  // MT
  if (/^MT\d/.test(upper)) {
    const variant = upper.replace('MT', '');
    if (catalog.MT && catalog.MT.includes(variant)) return { valid: true };
    return { valid: false, reason: `MT${variant} is not a recognized model`, suggest: catalog.MT?.map(v => `MT${v}`) };
  }

  // MG
  if (/^MG\d/.test(upper)) {
    const variant = upper.replace('MG', '');
    if (catalog.MG && catalog.MG.includes(variant)) return { valid: true };
    return { valid: false, reason: `MG${variant} is not a recognized model` };
  }

  // Z-series
  if (/^Z\d/.test(upper)) {
    const variant = upper.replace('Z', '');
    if (catalog.Z && catalog.Z.includes(variant)) return { valid: true };
    if (EOL_PRODUCTS.Z && EOL_PRODUCTS.Z.includes(variant)) return { valid: true, eol: true };
    return { valid: false, reason: `Z${variant} is not a recognized model`, suggest: ['Z4', 'Z4C'] };
  }

  // MS130
  if (/^MS130-/.test(upper)) {
    const variant = upper.replace('MS130-', '');
    if (catalog.MS130 && catalog.MS130.includes(variant)) return { valid: true };
    return { valid: false, reason: `MS130-${variant} is not a valid variant`, suggest: catalog.MS130?.map(v => `MS130-${v}`) };
  }

  // MS150
  if (/^MS150-/.test(upper)) {
    const variant = upper.replace('MS150-', '');
    if (catalog.MS150 && catalog.MS150.includes(variant)) return { valid: true };
    return { valid: false, reason: `MS150-${variant} is not a valid variant`, suggest: catalog.MS150?.map(v => `MS150-${v}`) };
  }

  // MS390
  if (/^MS390-/.test(upper)) {
    const variant = upper.replace('MS390-', '');
    if (catalog.MS390 && catalog.MS390.includes(variant)) return { valid: true };
    return { valid: false, reason: `MS390-${variant} is not a valid variant`, suggest: catalog.MS390?.map(v => `MS390-${v}`) };
  }

  // CW families
  if (/^CW9/.test(upper)) {
    for (const family of Object.keys(catalog).filter(k => k.startsWith('CW9'))) {
      if (upper.startsWith(family)) {
        const variant = upper.slice(family.length);
        if (!variant) return { valid: false, reason: `${family} requires a variant`, suggest: catalog[family].map(v => `${family}${v}`) };
        if (catalog[family].includes(variant)) return { valid: true };
      }
    }
    return { valid: false, reason: `${upper} is not a recognized CW model` };
  }

  // C9xxx and MA- accessories — pass through
  if (/^C9/.test(upper) || /^MA-/.test(upper)) return { valid: true };

  return { valid: false, reason: `${upper} is not a recognized SKU` };
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
    /C9[23]\d{2}L?-[\dA-Z]+-[\dA-Z]+-M/gi,
    /MA-[A-Z0-9-]+/gi,
    /CW9\d{3}[A-Z0-9]*/gi,
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,
    /MS[13][39]0-[\dA-Z]+/gi,
    /(?:MR|MX|MV|MT|MG)\d+[A-Z]*/gi,
    /Z\d+[A-Z]*/gi
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

Your job is to generate Stratus order URLs for Cisco/Meraki products.

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
- MS150, C9xxx-M, MA- accessories → no suffix

## LICENSE RULES (term format matters!)
- All APs (MR + CW) → LIC-ENT-1YR / LIC-ENT-3YR / LIC-ENT-5YR
- MX → LIC-MX{model}-SEC-1YR / -3YR / -5YR
- Z-series → LIC-Z{model}-SEC-1Y / -3Y / -5Y
- MG → LIC-MG{model}-ENT-1Y / -3Y / -5Y
- MS130 compact (8/8P/8X/12X) → LIC-MS130-CMPT-1Y / -3Y / -5Y
- MS130 standard (24/48) → LIC-MS130-{24/48}-1Y / -3Y / -5Y
- MS150 24-port → LIC-MS150-24-1Y / -3Y / -5Y
- MS150 48-port → LIC-MS150-48-1Y / -3Y / -5Y
- MS390 → no license in URL

## OUTPUT RULES
- Always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term
- URL-only output by default — no pricing tables
- If user asks "how much", "price", or "cost" you may add pricing context
- If a SKU is EOL, note the replacement and offer renewal vs refresh options
- If a SKU is ambiguous, ask for clarification

## EOL REPLACEMENTS
MR33→MR36, MR42→MR44, MR42E→MR46E, MR52/53/56→MR57, MR74→MR76, MR84→MR86
MX64→MX67, MX64W→MX67W, MX65→MX68, MX65W→MX68W, MX80/84→MX85
MS120/125/210/220/225→MS130, MS250/320→MS150, MS350/410/420/425→MS390

Keep responses concise, formatted for Webex markdown.`;

async function askClaude(userMessage) {
  if (!anthropic) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }]
  });
  return response.content[0].text;
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
    console.error('Webhook error:', err.message);
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
module.exports = { parseMessage, buildQuoteResponse, applySuffix, getLicenseSkus, buildStratusUrl, validateSku, isEol, checkEol };
