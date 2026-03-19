/**
 * Stratus AI - Webex Quote Bot
 * Phase 1: JSON catalog engine with Claude API failover
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
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

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

// ─── SKU Resolution ──────────────────────────────────────────────────────────

/**
 * Apply -HW / -MR / -RTG suffix rules to a bare SKU.
 * Returns the suffixed hardware SKU.
 */
function applySuffix(sku) {
  const upper = sku.toUpperCase();

  // CW Wi-Fi 7 (917x family)
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;

  // CW Wi-Fi 6E (916x family)
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;

  // MS150, C9xxx, MA- — no suffix
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('MA-')) return upper;

  // MS130, MS390 — -HW
  if (upper.startsWith('MS130') || upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  // MX cellular variants — -HW-NA
  if (/^MX\d+C(W)?(-HW-NA)?$/.test(upper)) {
    return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  }

  // All other hardware families: MR, MX, MV, MT, MG, Z
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }

  return upper;
}

/**
 * Determine license SKU for a given hardware base SKU.
 * Returns array of { term, sku } for 1Y, 3Y, 5Y.
 */
function getLicenseSkus(baseSku) {
  const upper = baseSku.toUpperCase();

  // AP families (MR + all CW models) → LIC-ENT
  if (/^MR\d/.test(upper) || /^CW9/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
    ];
  }

  // MX security licenses
  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    return [
      { term: '1Y', sku: `LIC-MX${model}-SEC-1YR` },
      { term: '3Y', sku: `LIC-MX${model}-SEC-3YR` },
      { term: '5Y', sku: `LIC-MX${model}-SEC-5YR` }
    ];
  }

  // Z-series
  const zMatch = upper.match(/^Z(\d+C?)/);
  if (zMatch) {
    const model = zMatch[1];
    return [
      { term: '1Y', sku: `LIC-Z${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-Z${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-Z${model}-ENT-5Y` }
    ];
  }

  // MG cellular gateways
  const mgMatch = upper.match(/^MG(\d+E?)/);
  if (mgMatch) {
    const model = mgMatch[1];
    return [
      { term: '1Y', sku: `LIC-MG${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-MG${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }

  // MS130 compact (8 or 12 port) → CMPT license
  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130 standard (24 or 48 port)
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  // No license mapping found — return null
  return null;
}

/**
 * Build a Stratus order URL for given items and term.
 * items: [{ sku, qty }]
 * term: 1 | 3 | 5
 */
function buildStratusUrl(items, term) {
  const skuParam = items.map(i => `${i.sku}:${i.qty}`).join(',');
  return `https://www.stratusinfosystems.com/store/cisco-meraki/p?skus=${encodeURIComponent(skuParam)}&term=${term}`;
}

/**
 * Check if a SKU base is EOL. Returns replacement string or null.
 */
function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  return EOL_REPLACEMENTS[upper] || null;
}

/**
 * Try to fix common mistakes. Returns corrected SKU or null.
 */
function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }
  return null;
}

/**
 * Validate a base SKU against the catalog.
 * Returns { valid: true } or { valid: false, reason, suggest? }
 */
function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();

  // Check common mistakes first
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest };

  // MR — check variant
  if (/^MR/.test(upper)) {
    const variant = upper.replace('MR', '');
    if (catalog.MR && catalog.MR.includes(variant)) return { valid: true };
    const eolCheck = catalog._EOL_PRODUCTS?.MR?.includes(variant);
    if (eolCheck) return { valid: true, eol: true };
    return { valid: false, reason: `MR${variant} is not a recognized model`, suggest: catalog.MR?.map(v => `MR${v}`) };
  }

  // MX
  if (/^MX/.test(upper)) {
    const variant = upper.replace('MX', '');
    if (catalog.MX && catalog.MX.includes(variant)) return { valid: true };
    return { valid: false, reason: `MX${variant} is not a recognized model`, suggest: catalog.MX?.map(v => `MX${v}`) };
  }

  // MV
  if (/^MV/.test(upper)) {
    const variant = upper.replace('MV', '');
    if (catalog.MV && catalog.MV.includes(variant)) return { valid: true };
    return { valid: false, reason: `MV${variant} is not a recognized model` };
  }

  // MT
  if (/^MT/.test(upper)) {
    const variant = upper.replace('MT', '');
    if (catalog.MT && catalog.MT.includes(variant)) return { valid: true };
    return { valid: false, reason: `MT${variant} is not a recognized model`, suggest: catalog.MT?.map(v => `MT${v}`) };
  }

  // MG
  if (/^MG/.test(upper)) {
    const variant = upper.replace('MG', '');
    if (catalog.MG && catalog.MG.includes(variant)) return { valid: true };
    return { valid: false, reason: `MG${variant} is not a recognized model` };
  }

  // Z-series
  if (/^Z\d/.test(upper)) {
    const variant = upper.replace('Z', '');
    if (catalog.Z && catalog.Z.includes(variant)) return { valid: true };
    return { valid: false, reason: `Z${variant} is not a recognized model`, suggest: ['Z4', 'Z4C'] };
  }

  // MS130
  if (/^MS130/.test(upper)) {
    const variant = upper.replace('MS130-', '');
    if (catalog.MS130 && catalog.MS130.includes(variant)) return { valid: true };
    return { valid: false, reason: `MS130-${variant} is not a valid variant`, suggest: catalog.MS130?.map(v => `MS130-${v}`) };
  }

  // MS150
  if (/^MS150/.test(upper)) {
    const variant = upper.replace('MS150-', '');
    if (catalog.MS150 && catalog.MS150.includes(variant)) return { valid: true };
    if (!variant) return { valid: false, reason: 'MS150 requires a variant', suggest: catalog.MS150?.map(v => `MS150-${v}`) };
    return { valid: false, reason: `MS150-${variant} is not a valid variant`, suggest: catalog.MS150?.map(v => `MS150-${v}`) };
  }

  // MS390
  if (/^MS390/.test(upper)) {
    const variant = upper.replace('MS390-', '');
    if (catalog.MS390 && catalog.MS390.includes(variant)) return { valid: true };
    return { valid: false, reason: `MS390-${variant} is not a valid variant`, suggest: catalog.MS390?.map(v => `MS390-${v}`) };
  }

  // CW families
  if (/^CW9/.test(upper)) {
    for (const family of Object.keys(catalog).filter(k => k.startsWith('CW9'))) {
      if (upper.startsWith(family)) {
        const variant = upper.replace(family + '-', '').replace(family, '');
        if (!variant) return { valid: false, reason: `${family} requires a variant`, suggest: catalog[family].map(v => `${family}${v}`) };
        if (catalog[family].includes(variant)) return { valid: true };
      }
    }
    return { valid: false, reason: `${upper} is not a recognized CW model` };
  }

  // C9xxx and MA- accessories — pass through (no deep validation)
  if (/^C9/.test(upper) || /^MA-/.test(upper)) return { valid: true };

  return { valid: false, reason: `${upper} is not a recognized SKU` };
}

// ─── Message Parser ──────────────────────────────────────────────────────────

/**
 * Parse a Webex message for SKU/quantity pairs.
 * Returns { items: [{ baseSku, qty }], requestedTerm: null | 1 | 3 | 5 } or null if nothing found.
 */
function parseMessage(text) {
  const upper = text.toUpperCase();

  // Detect explicitly requested term
  let requestedTerm = null;
  if (/\b1[\s-]?Y(EAR)?\b/.test(upper) && !/3[\s-]?Y|5[\s-]?Y/.test(upper)) requestedTerm = 1;
  else if (/\b3[\s-]?Y(EAR)?\b/.test(upper) && !/1[\s-]?Y|5[\s-]?Y/.test(upper)) requestedTerm = 3;
  else if (/\b5[\s-]?Y(EAR)?\b/.test(upper) && !/1[\s-]?Y|3[\s-]?Y/.test(upper)) requestedTerm = 5;

  // SKU patterns to match (order matters — more specific first)
  const skuPatterns = [
    // C9200L / C9300 family
    /C9[23]\d{2}L?-[\dA-Z]+-[\dA-Z]+-M/g,
    // MA- accessories
    /MA-[A-Z0-9-]+/g,
    // CW family
    /CW9\d{3}[A-Z0-9-]*/g,
    // MS150 full variant
    /MS150-[\dA-Z]+-[\dA-Z]+/g,
    // MS130/MS390 with variant
    /MS[13][39]0-[\dA-Z]+/g,
    // MR/MX/MV/MT/MG/Z with model number
    /(?:MR|MX|MV|MT|MG)\d+[A-Z]*/g,
    /Z\d+[A-Z]*/g
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
      // Check for "N x SKU" or "N SKU" before, or "SKU x N" or "SKU N" after
      const pos = match.index;
      const before = upper.slice(Math.max(0, pos - 15), pos);
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

/**
 * Build quote response from parsed items.
 * Returns { message: string, needsLlm: boolean }
 */
function buildQuoteResponse(parsed) {
  const terms = parsed.requestedTerm ? [parsed.requestedTerm] : [1, 3, 5];
  const eolNotes = [];
  const errors = [];
  const resolvedItems = []; // [{ sku, qty }] — hw + licenses per term

  for (const { baseSku, qty } of parsed.items) {
    // Validate
    const validation = validateSku(baseSku);
    if (!validation.valid) {
      const suggest = validation.suggest ? `\nDid you mean: ${validation.suggest.slice(0, 3).join(', ')}?` : '';
      errors.push(`⚠️ **${baseSku}**: ${validation.reason}${suggest}`);
      continue;
    }

    // EOL check
    const replacement = checkEol(baseSku);
    if (replacement) {
      eolNotes.push(`⚠️ **${baseSku}** is End-of-Life. Consider upgrading to **${replacement}** instead.`);
    }

    // Apply suffix for hardware SKU
    const hwSku = applySuffix(baseSku);

    // Get license SKUs
    const licenseSkus = getLicenseSkus(baseSku);

    resolvedItems.push({ hwSku, qty, licenseSkus });
  }

  // If any SKU failed validation entirely, trigger LLM fallback
  if (errors.length > 0 && resolvedItems.length === 0) {
    return { message: null, needsLlm: true };
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
    return { message: null, needsLlm: true };
  }

  // Build URLs per term
  for (const term of terms) {
    const urlItems = [];
    for (const { hwSku, qty, licenseSkus } of resolvedItems) {
      urlItems.push({ sku: hwSku, qty });
      if (licenseSkus) {
        const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
        if (licSku) urlItems.push({ sku: licSku, qty });
      }
    }
    const url = buildStratusUrl(urlItems, term);
    lines.push(`**${term}-Year:** ${url}`);
  }

  return { message: lines.join('\n'), needsLlm: false };
}

// ─── Claude API Fallback ─────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Stratus AI, a Cisco/Meraki quoting assistant for Stratus Information Systems.

Your only job is to generate Stratus order URLs for Cisco/Meraki products.

## URL FORMAT
https://www.stratusinfosystems.com/store/cisco-meraki/p?skus=SKU1:QTY1,SKU2:QTY2&term=TERM

Where term = 1, 3, or 5 (years). Always include both hardware and license SKUs.

## SKU SUFFIX RULES
- MR, MX, MV, MT, MG, MS130, MS390, Z → add -HW (e.g. MR44 → MR44-HW)
- MX cellular (MXxxCW, MXxxC) → add -HW-NA (e.g. MX68CW → MX68CW-HW-NA)
- CW Wi-Fi 6E (CW916x) → add -MR (e.g. CW9166I → CW9166I-MR)
- CW Wi-Fi 7 (CW917x) → add -RTG (e.g. CW9172I → CW9172I-RTG)
- MS150, C9xxx-M, MA- accessories → no suffix

## LICENSE RULES
- All APs (MR + CW models) → LIC-ENT-1YR / LIC-ENT-3YR / LIC-ENT-5YR
- MX → LIC-MX{model}-SEC-{1YR/3YR/5YR} (e.g. MX68 → LIC-MX68-SEC-3YR)
- Z-series → LIC-Z{model}-ENT-{1Y/3Y/5Y}
- MG → LIC-MG{model}-ENT-{1Y/3Y/5Y}
- MS130 compact (8 or 12 port) → LIC-MS130-CMPT-{1Y/3Y/5Y}
- MS130 standard (24 or 48 port) → LIC-MS130-{24/48}-{1Y/3Y/5Y}
- MS150, MS390 → no license SKU needed in URL (licensed separately)

## OUTPUT RULES
- Always show 1-Year, 3-Year, and 5-Year URLs unless user specifies one term
- URL-only output by default — no pricing tables, no totals
- If user asks "how much", "price", or "cost" — you may add pricing context
- If a SKU is EOL, note the replacement but still build the URL if they want to renew licenses
- If a SKU is ambiguous or doesn't exist, ask for clarification — don't guess

## EOL REPLACEMENTS
MR33→MR36, MR42→MR44, MR42E→MR46E, MR52/53/56→MR57, MR74→MR76, MR84→MR86
MX64→MX67, MX64W→MX67W, MX65→MX68, MX65W→MX68W, MX80/84→MX85
MS120/125/210/220/225→MS130, MS250/320→MS150, MS350/410/420/425→MS390

Keep responses concise and formatted for Webex markdown.`;

async function askClaude(userMessage) {
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
  res.sendStatus(200); // Ack immediately

  try {
    const event = req.body;
    if (event.resource !== 'messages' || event.event !== 'created') return;

    const botId = await getBotPersonId();
    if (event.data.personId === botId) return; // Ignore own messages

    const msg = await getMessage(event.data.id);
    const text = (msg.text || '').trim();
    if (!text) return;

    const roomId = msg.roomId;

    // Try JSON engine first
    const parsed = parseMessage(text);

    if (parsed) {
      const { message, needsLlm } = buildQuoteResponse(parsed);

      if (!needsLlm && message) {
        await sendMessage(roomId, message);
        return;
      }
    }

    // Fallback to Claude API
    const claudeReply = await askClaude(text);
    await sendMessage(roomId, claudeReply);

  } catch (err) {
    console.error('Webhook error:', err.message);
  }
});

// ─── Health Check ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Stratus AI running', version: '1.0.0' }));

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`Stratus AI bot listening on port ${PORT}`);
  getBotPersonId().then(id => console.log(`Bot ID: ${id}`)).catch(console.error);
});
