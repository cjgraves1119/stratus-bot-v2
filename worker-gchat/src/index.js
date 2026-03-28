/**
 * Stratus AI - Webex Quote Bot (Cloudflare Workers Edition)
 * JSON catalog engine with Claude API failover
 *
 * Ported from Express/Railway to Cloudflare Workers free plan.
 * Changes from Express version:
 *   - fetch() handler instead of Express routes
 *   - Cloudflare KV for conversation history (replaces in-memory Map)
 *   - Native fetch() instead of axios
 *   - Direct Anthropic API calls instead of SDK (SDK requires Node.js)
 *   - Web APIs (btoa/Uint8Array) instead of Buffer
 *   - JSON imports instead of fs.readFileSync
 */

// ─── Cloudflare AI Gateway ──────────────────────────────────────────────────
// Routes all Anthropic API calls through CF AI Gateway for:
//   - Response caching (identical prompts served from edge cache)
//   - Analytics & cost tracking (token usage, latency, error rates)
//   - Rate limiting (protect against runaway API costs)
// Dashboard: https://dash.cloudflare.com/ec1888c5a0b51dc3eebf6bae13a3922b/ai/ai-gateway/gateways/stratus-ai-bot
const ANTHROPIC_API_URL = 'https://gateway.ai.cloudflare.com/v1/ec1888c5a0b51dc3eebf6bae13a3922b/stratus-ai-bot/anthropic/v1/messages';

// ─── Data Imports (embedded at build time by wrangler) ──────────────────────
import pricesData from './data/prices.json';
import catalogData from './data/auto-catalog.json';
import specsData from './data/specs.json';
import accessoriesData from './data/accessories.json';

const prices = pricesData.prices;
const catalog = catalogData;
const specs = specsData;
const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const EOL_DATES = catalog._EOL_DATES || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const PASSTHROUGH = new Set(catalog._PASSTHROUGH || []);

// ─── Live Datasheet RAG ──────────────────────────────────────────────────────
const DATASHEET_URLS = {
  MX67: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX67W: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX67C: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX68: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX68W: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX68CW: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX67_and_MX68_Datasheet',
  MX75: 'https://documentation.meraki.com/MX/MX_Overviews_and_Specifications/MX75_Datasheet',
  MX85: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX85_Datasheet',
  MX95: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95%2F%2F105_Datasheet',
  MX105: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95%2F%2F105_Datasheet',
  MX250: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX250_Datasheet',
  MX450: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX450_Datasheet',
  MR28: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR28_Datasheet',
  MR36: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR36_Datasheet',
  MR36H: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR36H_Datasheet',
  MR44: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR44_Datasheet',
  MR46: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR46_Datasheet',
  MR46E: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR46E_Datasheet',
  MR57: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR57_Datasheet',
  MR76: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR76_Datasheet',
  MR78: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR78_Datasheet',
  MR86: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/MR86_Datasheet',
  CW9162I: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9162_Datasheet',
  CW9163E: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9163E_Datasheet',
  CW9164I: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9164_Datasheet',
  CW9166I: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9166_Datasheet',
  CW9166D1: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9166_Datasheet',
  CW9172H: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9172H_Datasheet',
  CW9176I: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9176I_%2F%2F_CW9176D1_Datasheet',
  CW9176D1: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9176I_%2F%2F_CW9176D1_Datasheet',
  CW9178I: 'https://documentation.meraki.com/Wireless/Product_Information/Overviews_and_Datasheets/CW9178I_Datasheet',
  MS130: 'https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS130_Datasheet',
  MS150: 'https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS150_Datasheet',
  MS390: 'https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS390_Datasheet',
  MS450: 'https://documentation.meraki.com/Switching/MS_-_Switches/Product_Information/Overviews_and_Datasheets/MS450_Overview_and_Specifications',
  C9300: 'https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300-M_Datasheet',
  C9300X: 'https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300X-M_Datasheet',
  C9300L: 'https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9300L-M_Datasheet',
  C9200L: 'https://documentation.meraki.com/Switching/Cloud_Management_with_IOS_XE/Product_Information/Overviews_and_Datasheets/Catalyst_9200L-M_Datasheet',
  MV13: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV13_Datasheet',
  MV22X: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/Second_Generation_MV_Cameras:_Overview_and_Specifications',
  MV23X: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV23_Series_Datasheet',
  MV33: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV33_Datasheet',
  MV53X: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV53X_Datasheet',
  MV63: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/Third_Generation_MV_Cameras:_Overview_and_Specifications',
  MV73X: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV73_Series_Datasheet',
  MV84X: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV84X_Datasheet',
  MV93: 'https://documentation.meraki.com/IoT/MV_-_Smart_Cameras/Product_Information/MV_Overviews_and_Datasheets/MV93_Series_Datasheet',
  Z4: 'https://documentation.meraki.com/SASE_and_SD-WAN/Z-Series_Teleworker_Gateways/Product_Information/Z4_Datasheet',
  MG21: 'https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/Overviews_and_Datasheets',
  MG41: 'https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG41_Internal_Antenna_Datasheet',
  MG51: 'https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG51_Internal_Antenna_Datasheet',
  MG52: 'https://documentation.meraki.com/SASE_and_SD-WAN/Cellular/Product_Information/MG_Antenna_Datasheets/MG52_Internal_Antenna_Datasheet',
  MT10: 'https://documentation.meraki.com/IoT/MT_-_Sensors/Product_Information/MT_Overviews_and_Datasheets/MT10_Datasheet_-_Temperature_and_Humidity',
  MT14: 'https://documentation.meraki.com/MT/MT_Datasheets/MT14_Datasheet_-_Indoor_Air_Quality_Monitor',
  MT20: 'https://documentation.meraki.com/MT/MT_Datasheets/MT20_Datasheet_-_Open%2F%2FClose_Detection',
  MT40: 'https://documentation.meraki.com/MT/MT_Datasheets/MT40_Datasheet_-_Smart_Power_Controller',
};

// ─── Datasheet Key Resolver ──────────────────────────────────────────────────
function getDatasheetKey(model) {
  const upper = model.toUpperCase();
  if (DATASHEET_URLS[upper]) return upper;
  const mxMatch = upper.match(/^(MX\d+[A-Z]*)/);
  if (mxMatch && DATASHEET_URLS[mxMatch[1]]) return mxMatch[1];
  const mgmtMatch = upper.match(/^(M[GT]\d+)/);
  if (mgmtMatch && DATASHEET_URLS[mgmtMatch[1]]) return mgmtMatch[1];
  const mvMatch = upper.match(/^(MV\d+)/);
  if (mvMatch && DATASHEET_URLS[mvMatch[1]]) return mvMatch[1];
  const cwMatch = upper.match(/^(CW\d+[A-Z]*\d*)/);
  if (cwMatch && DATASHEET_URLS[cwMatch[1]]) return cwMatch[1];
  const msMatch = upper.match(/^(MS\d+)/);
  if (msMatch && DATASHEET_URLS[msMatch[1]]) return msMatch[1];
  if (upper.startsWith('C9300X')) return 'C9300X';
  if (upper.startsWith('C9300L')) return 'C9300L';
  if (upper.startsWith('C9300')) return 'C9300';
  if (upper.startsWith('C9200')) return 'C9200L';
  if (/^Z4/.test(upper)) return 'Z4';
  return null;
}

// ─── Datasheet Fetch (in-memory cache per isolate lifecycle) ─────────────────
const datasheetCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchDatasheet(url) {
  const now = Date.now();
  const cached = datasheetCache.get(url);
  if (cached && (now - cached.time) < CACHE_TTL) return cached.text;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StratusAI-Bot/1.0 (spec-lookup)' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return null;
    const html = await res.text();
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
      .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
      .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&#\d+;/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const truncated = text.length > 3000 ? text.slice(0, 3000) + '...' : text;
    datasheetCache.set(url, { text: truncated, time: now });
    return truncated;
  } catch (e) {
    console.error(`Datasheet fetch failed for ${url}:`, e.message);
    return null;
  }
}

// ─── Static Specs Context ────────────────────────────────────────────────────
function getStaticSpecsContext(message) {
  const upper = message.toUpperCase();
  const modelPatterns = [
    /\b(MX\d+[A-Z]*)/g, /\b(MR\d+[A-Z]*)/g, /\b(CW\d+[A-Z]*\d*)/g,
    /\b(MS\d{3}[R]?(?:-\d+[A-Z]*(?:-\d+[A-Z])?)?)/g, /\b(MV\d+[A-Z]*)/g,
    /\b(MT\d+)/g, /\b(MG\d+[A-Z]*)/g, /\b(Z4[A-Z]*)/g,
    /\b(C9\d{3}[A-Z]*)/g,
  ];
  const found = [];
  for (const pat of modelPatterns) {
    let m;
    while ((m = pat.exec(upper)) !== null) {
      const model = m[1];
      for (const [family, familyData] of Object.entries(specs)) {
        if (family.startsWith('_')) continue;
        if (familyData[model]) {
          found.push({ model, specs: familyData[model] });
        }
        const baseMatch = model.match(/^(MS\d{3}|MX\d+|MR\d+|MV\d+|MG\d+|MT\d+|CW\d+[A-Z]*\d*|Z4)/);
        if (baseMatch && familyData[baseMatch[1]] && !found.some(f => f.model === baseMatch[1])) {
          found.push({ model: baseMatch[1], specs: familyData[baseMatch[1]] });
        }
      }
    }
  }
  if (found.length === 0) return null;
  const seen = new Set();
  const unique = found.filter(f => {
    if (seen.has(f.model)) return false;
    seen.add(f.model);
    return true;
  });
  let context = '## PRODUCT SPECS (from specs.json, current as of March 2026)\n';
  context += 'Use ONLY these specs when answering. Do not supplement with training data.\n';
  context += 'After answering, add: "*Specs current as of March 2026. Want me to pull the latest datasheet to check for updates?"\n\n';
  for (const { model, specs: s } of unique) {
    context += `${model}: ${JSON.stringify(s)}\n`;
  }
  return context;
}

// ─── Datasheet Context ───────────────────────────────────────────────────────
async function getRelevantDatasheetContext(message) {
  const upper = message.toUpperCase();
  const modelPatterns = [
    /\b(MX\d+[A-Z]*)/g, /\b(MR\d+[A-Z]*)/g, /\b(CW\d+[A-Z]*\d*)/g,
    /\b(MS\d{3}[R]?(?:-\d+[A-Z]*(?:-\d+[A-Z])?)?)/g, /\b(MV\d+[A-Z]*)/g,
    /\b(MT\d+)/g, /\b(MG\d+[A-Z]*)/g, /\b(Z4[A-Z]*)/g,
    /\b(C9\d{3}[A-Z]*)/g,
  ];
  const models = new Set();
  for (const pat of modelPatterns) {
    let m;
    while ((m = pat.exec(upper)) !== null) {
      const key = getDatasheetKey(m[1]);
      if (key) models.add(key);
    }
  }
  if (models.size === 0) return null;
  const keys = [...models].slice(0, 3);
  const uniqueUrls = [...new Set(keys.map(k => DATASHEET_URLS[k]))];
  const fetches = uniqueUrls.map(async url => {
    const text = await fetchDatasheet(url);
    return text ? `[Datasheet: ${url}]\n${text}` : null;
  });
  const results = (await Promise.all(fetches)).filter(Boolean);
  if (results.length === 0) return null;
  const staticSpecs = [];
  for (const key of keys) {
    for (const family of Object.keys(specs)) {
      if (family.startsWith('_')) continue;
      const familyData = specs[family];
      if (familyData[key]) {
        staticSpecs.push(`${key}: ${JSON.stringify(familyData[key])}`);
      }
    }
  }
  let context = '## LIVE DATASHEET CONTENT (use this as your primary source for specs)\n' +
    results.join('\n\n');
  if (staticSpecs.length > 0) {
    context += '\n\n## CACHED SPECS (fallback if datasheet content is unclear)\n' +
      staticSpecs.join('\n');
  }
  return context;
}

// ─── Valid SKU Set ────────────────────────────────────────────────────────────
const VALID_SKUS = new Set();
for (const [key, value] of Object.entries(catalog)) {
  if (key.startsWith('_')) continue;
  if (Array.isArray(value)) {
    for (const sku of value) VALID_SKUS.add(sku.toUpperCase());
  }
}
for (const sku of PASSTHROUGH) VALID_SKUS.add(sku.toUpperCase());

// ─── Conversation History (KV-backed) ────────────────────────────────────────
const MAX_HISTORY = 10;
const HISTORY_TTL_SECONDS = 30 * 60; // 30 minutes

async function getHistory(kv, personId) {
  if (!kv) return [];
  try {
    const data = await kv.get(`conv:${personId}`, 'json');
    if (!data) return [];
    return data.messages || [];
  } catch {
    return [];
  }
}

async function addToHistory(kv, personId, role, content) {
  if (!kv) return;
  try {
    let data = await kv.get(`conv:${personId}`, 'json');
    if (!data) data = { messages: [] };
    data.messages.push({ role, content });
    while (data.messages.length > MAX_HISTORY) {
      data.messages.shift();
    }
    await kv.put(`conv:${personId}`, JSON.stringify(data), {
      expirationTtl: HISTORY_TTL_SECONDS
    });
  } catch (e) {
    console.error('KV write error:', e.message);
  }
}

// ─── Bot Identity ────────────────────────────────────────────────────────────
let cachedBotPersonId = null;
// ─── SKU Suffix Rules ────────────────────────────────────────────────────────
function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;  // CW9179F has no -RTG suffix
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (upper.startsWith('MS450')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS130R?-/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (upper.startsWith('MS390')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS[1-4]\d{2}-/.test(upper) && !upper.startsWith('MS150') && !upper.startsWith('MS130') && !upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

// ─── License SKU Rules ───────────────────────────────────────────────────────
function getLicenseSkus(baseSku, requestedTier) {
  const upper = baseSku.toUpperCase();

  // C8111 / C8455 Secure Routers — ENT/SEC/SDW license tiers
  const c8Match = upper.match(/^C(8111|8455)/);
  if (c8Match) {
    const model = c8Match[1];
    const tier = requestedTier || 'ENT';
    return [
      { term: '1Y', sku: `LIC-C${model}-${tier}-1Y` },
      { term: '3Y', sku: `LIC-C${model}-${tier}-3Y` },
      { term: '5Y', sku: `LIC-C${model}-${tier}-5Y` }
    ];
  }

  // CW9800 Wireless Controller — no standard license association
  if (/^CW9800/.test(upper)) return null;

  if (/^MR\d/.test(upper) || /^CW9\d/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
    ];
  }

  const mxNaMatch = upper.match(/^MX(\d+C[W]?)-NA$/);
  if (mxNaMatch) {
    const model = mxNaMatch[1];
    const tier = requestedTier || 'SEC';
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const isNewer = modelNum >= 75;
    const suffix = isNewer ? 'Y' : 'YR';
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    const tier = requestedTier || 'SEC';
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    // Only MX75, MX85, MX95, MX105 use -Y for ENT/SEC. All others use -YR.
    const newerModels = [75, 85, 95, 105];
    const isNewer = newerModels.includes(modelNum);
    const suffix = isNewer ? 'Y' : 'YR';
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  const zMatch = upper.match(/^Z(\d+)(C)?(X)?$/);
  if (zMatch) {
    const zNum = zMatch[1];
    const hasC = !!zMatch[2];
    const licModel = `Z${zNum}${hasC ? 'C' : ''}`;
    if (zNum === '1' || zNum === '3') {
      return [
        { term: '1Y', sku: `LIC-${licModel}-ENT-1YR` },
        { term: '3Y', sku: `LIC-${licModel}-ENT-3YR` },
        { term: '5Y', sku: `LIC-${licModel}-ENT-5YR` }
      ];
    }
    const zTier = (requestedTier === 'ENT') ? 'ENT' : 'SEC';
    return [
      { term: '1Y', sku: `LIC-${licModel}-${zTier}-1Y` },
      { term: '3Y', sku: `LIC-${licModel}-${zTier}-3Y` },
      { term: '5Y', sku: `LIC-${licModel}-${zTier}-5Y` }
    ];
  }

  const mgMatch = upper.match(/^MG(\d+)/);
  if (mgMatch) {
    // MG21E uses same license as MG21, MG51E uses MG51, etc.
    // License SKUs never include the E suffix
    const model = mgMatch[1];
    return [
      { term: '1Y', sku: `LIC-MG${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-MG${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }

  // MS130R (compact) — uses LIC-MS130-CMPT
  if (/^MS130R-/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130-8P, MS130-12P (small form factor) — uses LIC-MS130-CMPT
  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130-24/48 — uses LIC-MS130-{portCount}
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  // MS150 — uses LIC-MS150-{portCount}
  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    return [
      { term: '1Y', sku: `LIC-MS150-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS150-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS150-${ports}-5Y` }
    ];
  }

  // MS125: Uses -Y suffix — LIC-MS125-{variant}-{1Y|3Y|5Y}
  const ms125Match = upper.match(/^MS125-(.+)/);
  if (ms125Match) {
    const variant = ms125Match[1];
    return [
      { term: '1Y', sku: `LIC-MS125-${variant}-1Y` },
      { term: '3Y', sku: `LIC-MS125-${variant}-3Y` },
      { term: '5Y', sku: `LIC-MS125-${variant}-5Y` }
    ];
  }

  // MS390: Uses {portCount}{A|E}-{term}Y format
  const ms390Match = upper.match(/^MS390-(\d+)/);
  if (ms390Match) {
    const portCount = ms390Match[1];
    const tier = (requestedTier === 'A') ? 'A' : 'E';
    return [
      { term: '1Y', sku: `LIC-MS390-${portCount}${tier}-1Y` },
      { term: '3Y', sku: `LIC-MS390-${portCount}${tier}-3Y` },
      { term: '5Y', sku: `LIC-MS390-${portCount}${tier}-5Y` }
    ];
  }

  // MS450: Falls through to legacy MS handler below (LIC-MS450-{port}-{term}YR)

  // Legacy MS switches (MS210, MS220, MS225, MS250, MS350, MS410, MS425) — LIC-{model}-{port}-{term}YR
  const legacyMsMatch = upper.match(/^(MS\d{3})-(.+)/);
  if (legacyMsMatch && !upper.startsWith('MS130') && !upper.startsWith('MS150')) {
    const model = legacyMsMatch[1];
    let port = legacyMsMatch[2];
    // MS350-48X uses the 48-port license (no X)
    if (model === 'MS350' && port === '48X') port = '48';
    return [
      { term: '1Y', sku: `LIC-${model}-${port}-1YR` },
      { term: '3Y', sku: `LIC-${model}-${port}-3YR` },
      { term: '5Y', sku: `LIC-${model}-${port}-5YR` }
    ];
  }

  // Catalyst M-series: C9200L, C9300, C9350 — LIC-{family}-{portCount}{A|E}-{term}
  // C9300-48UXM-M → LIC-C9300-48E-1Y, C9200L-24P-4G-M → LIC-C9200L-24E-1Y
  // C9300X and C9300L have no license SKUs in prices, they use C9300 licenses
  // C9300X-12Y uses the 24-port license (LIC-C9300-24E)
  // C9350 has only 3Y and 5Y (no 1Y)
  const catMatch = upper.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (catMatch) {
    let family = catMatch[1];
    let portCount = catMatch[2];
    const tier = (requestedTier === 'A') ? 'A' : 'E';

    // C9300X and C9300L map to C9300 license SKUs
    if (family === 'C9300X' || family === 'C9300L') {
      family = 'C9300';
    }

    // C9300X-12Y uses the 24-port license
    if (portCount === '12') portCount = '24';

    // C9350 has no 1Y option
    if (family === 'C9350') {
      return [
        { term: '3Y', sku: `LIC-C9350-${portCount}${tier}-3Y` },
        { term: '5Y', sku: `LIC-C9350-${portCount}${tier}-5Y` }
      ];
    }

    return [
      { term: '1Y', sku: `LIC-${family}-${portCount}${tier}-1Y` },
      { term: '3Y', sku: `LIC-${family}-${portCount}${tier}-3Y` },
      { term: '5Y', sku: `LIC-${family}-${portCount}${tier}-5Y` }
    ];
  }

  const mvMatch = upper.match(/^MV(\d+)/);
  if (mvMatch) {
    return [
      { term: '1Y', sku: 'LIC-MV-1YR' },
      { term: '3Y', sku: 'LIC-MV-3YR' },
      { term: '5Y', sku: 'LIC-MV-5YR' }
    ];
  }

  const mtMatch = upper.match(/^MT(\d+)/);
  if (mtMatch) {
    return [
      { term: '1Y', sku: 'LIC-MT-1Y' },
      { term: '3Y', sku: 'LIC-MT-3Y' },
      { term: '5Y', sku: 'LIC-MT-5Y' }
    ];
  }

  return null;
}

// ─── URL Builder ─────────────────────────────────────────────────────────────
function buildStratusUrl(items) {
  // Consolidate duplicate SKUs by summing quantities
  const merged = new Map();
  for (const { sku, qty } of items) {
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }

  // Sort by product family group, hardware before licenses within each group
  const _skuSortKey = (sku) => {
    const upper = sku.toUpperCase();
    const isLicense = upper.startsWith('LIC-');
    // Determine product family for grouping order
    let familyOrder;
    if (/^(MR\d|CW9|LIC-ENT|LIC-CW)/.test(upper)) familyOrder = '1-AP';
    else if (/^(MS\d|LIC-MS)/.test(upper)) familyOrder = '2-SW';
    else if (/^(C9\d|LIC-C9)/.test(upper)) familyOrder = '3-CAT';
    else if (/^(MX\d|LIC-MX|Z\d|LIC-Z)/.test(upper)) familyOrder = '4-SEC';
    else if (/^(MV\d|LIC-MV)/.test(upper)) familyOrder = '5-CAM';
    else if (/^(MT\d|LIC-MT)/.test(upper)) familyOrder = '6-SENS';
    else if (/^(MG\d|LIC-MG)/.test(upper)) familyOrder = '7-CELL';
    else if (/^(MA-SFP|STACK)/.test(upper)) familyOrder = '8-ACC';
    else familyOrder = '9-OTHER';
    // Within group: hardware (0) before licenses (1), then alphabetical
    return `${familyOrder}-${isLicense ? '1' : '0'}-${upper}`;
  };

  const sortedSkus = [...merged.keys()].sort((a, b) => _skuSortKey(a).localeCompare(_skuSortKey(b)));
  const qtys = sortedSkus.map(s => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${sortedSkus.join(',')}&qty=${qtys.join(',')}`;
}

// ─── EOL Check ───────────────────────────────────────────────────────────────
// Strip leading dash from variant when family name is a prefix of the full SKU.
// e.g., MS220-8P → family "MS220", raw variant "-8P" → cleaned "8P"
function _extractVariant(upper, family) {
  const raw = upper.slice(family.length);
  return raw.startsWith('-') ? raw.slice(1) : raw;
}

function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  if (EOL_REPLACEMENTS[upper]) return EOL_REPLACEMENTS[upper];
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = _extractVariant(upper, family);
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
      const variant = _extractVariant(upper, family);
      if (variants.includes(variant)) return true;
    }
  }
  return false;
}

// ─── EOL Date Helpers ────────────────────────────────────────────────────────
function getEolDates(baseSku) {
  const upper = baseSku.toUpperCase();
  if (EOL_DATES[upper]) return EOL_DATES[upper];
  for (const key of Object.keys(EOL_DATES)) {
    if (upper === key) return EOL_DATES[key];
  }
  return null;
}

function formatEolDate(isoDate) {
  if (!isoDate) return '';
  const d = new Date(isoDate + 'T00:00:00Z');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function eolDateSuffix(baseSku) {
  const dates = getEolDates(baseSku);
  if (!dates) return '';
  const parts = [];
  if (dates.eos) parts.push(`EOS: ${formatEolDate(dates.eos)}`);
  if (dates.eost) parts.push(`End of Support: ${formatEolDate(dates.eost)}`);
  return parts.length > 0 ? ` (${parts.join(' | ')})` : '';
}

// ─── Levenshtein Distance ───────────────────────────────────────────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

// ─── Fuzzy Matching ─────────────────────────────────────────────────────────
function fuzzyMatchInFamily(input, family) {
  const upper = input.toUpperCase();
  const variants = catalog[family];
  if (!variants || !Array.isArray(variants)) return [];
  const candidates = variants.map(v => {
    return { sku: v, distance: levenshtein(upper, v.toUpperCase()) };
  });
  return candidates
    .filter(c => c.distance <= 3 && c.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function fuzzyMatchAllFamilies(input) {
  const upper = input.toUpperCase();
  const results = [];
  for (const [family, variants] of Object.entries(catalog)) {
    if (family.startsWith('_') || !Array.isArray(variants)) continue;
    for (const sku of variants) {
      const dist = levenshtein(upper, sku.toUpperCase());
      if (dist <= 2) results.push({ sku, distance: dist });
    }
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, 5);
}

// ─── Common Mistakes ─────────────────────────────────────────────────────────
function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();

  // Exact match first
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }

  // Prefix match: check if input extends a common mistake key
  // e.g., "MS150-48P-4X" starts with mistake key "MS150-48P"
  for (const [key, val] of Object.entries(COMMON_MISTAKES)) {
    if (upper.startsWith(key + '-') && val.suggest && val.suggest.length > 0) {
      const suffix = upper.slice(key.length).toUpperCase(); // e.g., "-4X"

      // Strategy 1: Append suffix to suggestions and check validity
      const appended = val.suggest
        .map(s => s + suffix)
        .filter(s => VALID_SKUS.has(s.toUpperCase()) || isEol(s));
      if (appended.length > 0) {
        return { error: val.error, suggest: appended };
      }

      // Strategy 2: Filter suggestions that already end with the same suffix
      // (handles cases where suggestions already include uplink variants)
      const filtered = val.suggest.filter(s => s.toUpperCase().endsWith(suffix));
      if (filtered.length > 0) {
        return { error: val.error, suggest: filtered };
      }

      // Fallback: return all original suggestions
      return { error: val.error, suggest: val.suggest };
    }
  }

  return null;
}

// ─── SKU Validation ──────────────────────────────────────────────────────────
function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest, isCommonMistake: true };
  if (VALID_SKUS.has(upper)) {
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }
  if (isEol(upper)) return { valid: true, eol: true };
  if (/^MA-/.test(upper)) return { valid: true };
  const family = detectFamily(upper);
  if (family && catalog[family]) {
    // Try partial string matching first
    const partialMatches = catalog[family].filter(s => s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase()));
    if (partialMatches.length > 0) {
      return { valid: false, reason: `${upper} is not a recognized model`, suggest: partialMatches, isPartialMatch: partialMatches.length > 1 };
    }
    // Fuzzy match within the family (Levenshtein distance <= 3)
    const fuzzyMatches = fuzzyMatchInFamily(upper, family);
    if (fuzzyMatches.length > 0) {
      const suggestions = fuzzyMatches.map(m => m.sku);
      const closest = fuzzyMatches[0];
      return {
        valid: false,
        reason: `${upper} is not a recognized model`,
        suggest: suggestions,
        isFuzzyMatch: true,
        closestDistance: closest.distance
      };
    }
    // Fallback: show first 5 variants in the family
    const suggestions = catalog[family].slice(0, 5);
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions, isPartialMatch: false };
  }
  // No family detected — try cross-family fuzzy match
  const crossFamilyMatches = fuzzyMatchAllFamilies(upper);
  if (crossFamilyMatches.length > 0) {
    return {
      valid: false,
      reason: `${upper} is not a recognized SKU`,
      suggest: crossFamilyMatches.map(m => m.sku),
      isFuzzyMatch: true,
      closestDistance: crossFamilyMatches[0].distance
    };
  }
  return { valid: false, reason: `${upper} is not a recognized SKU` };
}

// ─── Family Detection ────────────────────────────────────────────────────────
function detectFamily(sku) {
  if (/^MR\d/.test(sku)) return 'MR';
  if (/^MX\d/.test(sku)) return 'MX';
  if (/^MV\d/.test(sku)) return 'MV';
  if (/^MT\d/.test(sku)) return 'MT';
  if (/^MG\d/.test(sku)) return 'MG';
  if (/^Z\d/.test(sku)) return 'Z';
  if (/^MS130/.test(sku)) return 'MS130';
  if (/^MS150/.test(sku)) return 'MS150';
  if (/^MS120/.test(sku)) return 'MS120';
  if (/^MS125/.test(sku)) return 'MS125';
  if (/^MS210/.test(sku)) return 'MS210';
  if (/^MS220/.test(sku)) return 'MS220';
  if (/^MS225/.test(sku)) return 'MS225';
  if (/^MS250/.test(sku)) return 'MS250';
  if (/^MS320/.test(sku)) return 'MS320';
  if (/^MS350/.test(sku)) return 'MS350';
  if (/^MS355/.test(sku)) return 'MS355';
  if (/^MS390/.test(sku)) return 'MS390';
  if (/^MS410/.test(sku)) return 'MS410';
  if (/^MS420/.test(sku)) return 'MS420';
  if (/^MS425/.test(sku)) return 'MS425';
  if (/^MS450/.test(sku)) return 'MS450';
  if (/^CW9/.test(sku)) return 'CW';
  if (/^C9300X/.test(sku)) return 'C9300X';
  if (/^C9300L/.test(sku)) return 'C9300L';
  if (/^C9300/.test(sku)) return 'C9300';
  if (/^C9200L/.test(sku)) return 'C9200L';
  if (/^C8111/.test(sku)) return 'C8111';
  if (/^C8455/.test(sku)) return 'C8455';
  return null;
}

// ─── Price Lookup ────────────────────────────────────────────────────────────
function getPrice(sku) {
  const upper = sku.toUpperCase();
  if (prices[upper]) return prices[upper];
  const noHw = upper.replace(/-HW(-NA)?$/, '');
  if (prices[noHw]) return prices[noHw];
  return null;
}

// ─── Pricing Calculator ──────────────────────────────────────────────────────

/**
 * Parse a Stratus URL into { skus: string[], qtys: number[] }
 */
function parseStratusUrl(url) {
  try {
    const u = new URL(url);
    const items = (u.searchParams.get('item') || '').split(',').map(s => s.trim()).filter(Boolean);
    const qtyStr = (u.searchParams.get('qty') || '').split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    if (items.length === 0) return null;
    // If qtys missing or mismatched, default all to 1
    const qtys = qtyStr.length === items.length ? qtyStr : items.map(() => 1);
    return { skus: items, qtys };
  } catch {
    return null;
  }
}

/**
 * Calculate pricing for a list of SKUs and quantities.
 * Returns { lines: string[], cartTotal: number, found: number, missing: string[] }
 */
function calculatePricing(skus, qtys) {
  const lines = [];
  let cartTotal = 0;
  const missing = [];
  let found = 0;

  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    const qty = qtys[i] || 1;
    const p = getPrice(sku);
    if (p) {
      found++;
      const lineTotal = p.price * qty;
      cartTotal += lineTotal;
      if (qty > 1) {
        lines.push(`• ${qty} × ${sku} - $${p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })} each ($${lineTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
      } else {
        lines.push(`• ${sku} - $${p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}`);
      }
    } else {
      missing.push(sku);
    }
  }

  return { lines, cartTotal, found, missing };
}

/**
 * Format a full pricing response for a single URL or SKU set.
 */
function formatPricingResponse(label, skus, qtys) {
  const { lines, cartTotal, found, missing } = calculatePricing(skus, qtys);
  if (found === 0) return null;

  const parts = [];
  if (label) parts.push(`**${label}**`);
  // Add URL for reference
  const url = buildStratusUrl(skus.map((s, i) => ({ sku: s, qty: qtys[i] })));
  parts.push(url);
  parts.push('');
  parts.push(...lines);
  parts.push(`**Cart Total: $${cartTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}**`);
  if (missing.length > 0) {
    parts.push(`\n_Pricing unavailable for: ${missing.join(', ')}_`);
  }
  return parts.join('\n');
}

// ─── EOL Date Lookup ──────────────────────────────────────────────────────────
/**
 * Detect EOL/end-of-support date queries and respond deterministically.
 * Supports single and batch lookups.
 * Returns a response string if handled, or null to pass through.
 */
function handleEolDateRequest(text) {
  const upper = text.toUpperCase();

  // Detect EOL date intent
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(text);
  if (!eolIntent) return null;

  // Extract SKU-like tokens from the message
  const skuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/gi;
  const matches = [...upper.matchAll(skuPattern)].map(m => m[1]);

  // Deduplicate
  const skus = [...new Set(matches)];
  if (skus.length === 0) return null;

  const lines = [];

  for (const sku of skus) {
    const skuUpper = sku.toUpperCase();

    // Check if EOL
    let isEolProduct = false;
    let fullSkuKey = skuUpper;

    // Direct date lookup first
    if (EOL_DATES[skuUpper]) {
      isEolProduct = true;
    } else {
      // Try family + variant lookup
      for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
        if (skuUpper.startsWith(family)) {
          const raw = skuUpper.slice(family.length);
          const variant = raw.startsWith('-') ? raw.slice(1) : raw;
          if (variants.includes(variant)) {
            isEolProduct = true;
            fullSkuKey = skuUpper;
            break;
          }
        }
      }
    }

    if (!isEolProduct) {
      lines.push(`**${skuUpper}** — ✅ Active product (not end-of-life)`);
      continue;
    }

    const dates = EOL_DATES[fullSkuKey];
    const replacement = EOL_REPLACEMENTS[fullSkuKey];

    let line = `**${skuUpper}**`;
    if (dates) {
      const eosDate = new Date(dates.eos);
      const eostDate = new Date(dates.eost);
      const now = new Date();
      const eosLabel = eosDate <= now ? 'End of Sale' : 'End of Sale';
      const eostLabel = eostDate <= now ? 'End of Support (passed)' : 'End of Support';
      line += `\n  📅 ${eosLabel}: **${dates.eos}**`;
      line += `\n  🛡️ ${eostLabel}: **${dates.eost}**`;

      // Days until/since EOST
      const daysToEost = Math.round((eostDate - now) / (1000 * 60 * 60 * 24));
      if (daysToEost > 0) {
        line += ` _(${daysToEost} days remaining)_`;
      } else {
        line += ` _(${Math.abs(daysToEost)} days ago)_`;
      }
    } else {
      line += '\n  📅 EOL confirmed (exact dates not available)';
    }

    if (replacement) {
      if (Array.isArray(replacement)) {
        line += `\n  🔄 Replacement: **${replacement[0]}** (1G) or **${replacement[1]}** (10G)`;
      } else {
        line += `\n  🔄 Replacement: **${replacement}**`;
      }
    }

    lines.push(line);
  }

  if (lines.length === 0) return null;

  const header = skus.length === 1 ? '**End-of-Life Status**' : `**End-of-Life Status (${skus.length} products)**`;
  return `${header}\n\n${lines.join('\n\n')}`;
}

/**
 * Detect "yes, generate a quote" type follow-ups and route through the deterministic engine.
 * Extracts SKUs from the last assistant message (specs response or product discussion)
 * and builds a proper quote via parseMessage() + buildQuoteResponse().
 * Returns a response string if handled, or null to pass through to Claude.
 */
async function handleQuoteConfirmation(text, personId, kv) {
  // Detect quote confirmation intent
  const confirmIntent = /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it|quote it|generate (a |the )?quote|yes.*quote|please.*quote|let'?s do it|go for it)\s*[.!]?\s*$/i.test(text);
  if (!confirmIntent) return null;
  if (!personId || !kv) return null;

  const history = await getHistory(kv, personId);
  if (history.length === 0) return null;

  // Find the most recent assistant message
  const assistantMsgs = history.filter(h => h.role === 'assistant').reverse();
  if (assistantMsgs.length === 0) return null;

  const lastAssistant = assistantMsgs[0].content;

  // Check if the last assistant message was offering to generate a quote (specs/advisory response)
  // and does NOT already contain Stratus order URLs (already a quote)
  if (lastAssistant.includes('stratusinfosystems.com/order/')) return null;
  // If the last message was offering a datasheet check, don't intercept — let askClaude handle it
  if (/datasheet|check for updates/i.test(lastAssistant)) return null;
  if (!/quote|would you like|pricing/i.test(lastAssistant)) return null;

  // Extract SKUs from the assistant's response — look for bold product names or SKU patterns
  const skuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z|C9)\d[\w-]*(?:-M)?)\b/gi;
  const matches = [...lastAssistant.matchAll(skuPattern)];
  if (matches.length === 0) return null;

  // Deduplicate and take the first/primary SKU mentioned (typically the one in the title)
  const allSkus = [...new Set(matches.map(m => m[1].toUpperCase()))];

  // Filter to likely hardware SKUs (not license SKUs or generic terms)
  const hwSkus = allSkus.filter(s => !s.startsWith('LIC-') && !s.startsWith('LIC'));

  if (hwSkus.length === 0) return null;

  // Build a synthetic quote request and route through parseMessage + buildQuoteResponse
  const syntheticRequest = `quote ${hwSkus.map(s => `1 ${s}`).join(', ')}`;
  const parsed = parseMessage(syntheticRequest);

  if (parsed && parsed.items && parsed.items.length > 0) {
    const result = buildQuoteResponse(parsed);
    if (!result.needsLlm && result.message) {
      return result.message;
    }
  }

  // Couldn't build deterministic quote — fall through to Claude
  return null;
}

/**
 * Detect pricing intent and handle deterministically.
 * Returns a response string if handled, or null to pass through to Claude.
 */
async function handlePricingRequest(text, personId, kv) {
  const upper = text.toUpperCase();

  // Detect pricing intent keywords
  const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(text);
  if (!pricingIntent) return null;

  // Pattern 1: Direct SKU pricing request like "cost of 2x MS150-48FP-4X" or "price of MR44"
  const directSkuMatch = text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
  const singleSkuMatch = !directSkuMatch && text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);

  if (directSkuMatch) {
    const qty = parseInt(directSkuMatch[1]);
    const sku = directSkuMatch[2].toUpperCase();
    const resp = formatPricingResponse(null, [sku], [qty]);
    if (resp) return resp;
    // SKU not found in prices — fall through to Claude
  }

  if (singleSkuMatch) {
    const sku = singleSkuMatch[1].toUpperCase();
    // Filter out common false positives
    if (!/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(sku)) {
      const resp = formatPricingResponse(null, [sku], [1]);
      if (resp) return resp;
    }
  }

  // Pattern 2: References to "Option 1/2/3" (or legacy A/B/B1/B2) or "X-Year" from prior conversation
  const optionRef = text.match(/\b(?:OPTION\s+(1|2|3|A|B|B1|B2))\b/i);
  const termRef = text.match(/\b(\d)\s*-?\s*YEAR/i);

  if (!personId || !kv) return null;

  // Search recent assistant messages for one containing the referenced option/URLs
  const history = await getHistory(kv, personId);
  if (history.length === 0) return null;

  const assistantMsgs = history.filter(h => h.role === 'assistant').reverse();
  if (assistantMsgs.length === 0) return null;

  // Normalize legacy option references: A→1, B1→2, B2→3, B→2
  let normalizedOpt = optionRef ? optionRef[1].toUpperCase() : null;
  if (normalizedOpt === 'A') normalizedOpt = '1';
  if (normalizedOpt === 'B1') normalizedOpt = '2';
  if (normalizedOpt === 'B2') normalizedOpt = '3';
  if (normalizedOpt === 'B') normalizedOpt = '2'; // single refresh = Option 2

  // Find the best assistant message: one that contains the referenced option, or has Stratus URLs
  let lastResponse = null;
  if (normalizedOpt) {
    const optKey = `OPTION ${normalizedOpt}`;
    lastResponse = assistantMsgs.find(m => m.content.toUpperCase().includes(optKey))?.content;
    // Also check legacy format in history
    if (!lastResponse && optionRef) {
      const legacyKey = `OPTION ${optionRef[1].toUpperCase()}`;
      lastResponse = assistantMsgs.find(m => m.content.toUpperCase().includes(legacyKey))?.content;
    }
  }
  // Fallback: find the most recent message with Stratus order URLs
  if (!lastResponse) {
    lastResponse = assistantMsgs.find(m => m.content.includes('stratusinfosystems.com/order/'))?.content;
  }
  if (!lastResponse) return null;

  // Extract all URLs from last response, grouped by their preceding label
  const urlBlocks = [];
  const responseLines = lastResponse.split('\n');
  let currentLabel = '';

  for (const line of responseLines) {
    const trimmed = line.trim();
    // Track section headers (Option 1, Option 2, Option 3, or legacy A/B/B1/B2)
    if (/option\s+(\d|a|b|b1|b2)/i.test(trimmed)) {
      currentLabel = trimmed.replace(/[*:]+/g, '').trim();
    }
    // Track term labels
    const termLabel = trimmed.match(/^(\d-Year\s+Co-Term):/i);
    if (termLabel) {
      const urlMatch = trimmed.match(/(https:\/\/stratusinfosystems\.com\/order\/\?[^\s]+)/);
      if (urlMatch) {
        urlBlocks.push({
          section: currentLabel,
          term: termLabel[1],
          url: urlMatch[1]
        });
      }
    }
    // Also catch bare URLs on the same line as term
    if (!termLabel) {
      const bareUrl = trimmed.match(/(https:\/\/stratusinfosystems\.com\/order\/\?[^\s]+)/);
      if (bareUrl && !urlBlocks.find(b => b.url === bareUrl[1])) {
        urlBlocks.push({
          section: currentLabel,
          term: '',
          url: bareUrl[1]
        });
      }
    }
  }

  if (urlBlocks.length === 0) return null;

  // Filter by option reference if specified (supports both new 1/2/3 and legacy A/B/B1/B2)
  let filtered = urlBlocks;
  if (normalizedOpt) {
    filtered = urlBlocks.filter(b => {
      const su = b.section.toUpperCase();
      // Match new format: "OPTION 1", "OPTION 2", "OPTION 3"
      if (su.includes(`OPTION ${normalizedOpt}`)) return true;
      // Match legacy format for backward compatibility with conversation history
      if (normalizedOpt === '1' && su.includes('OPTION A')) return true;
      if (normalizedOpt === '2' && (su.includes('OPTION B1') || (su.includes('OPTION B') && !su.includes('B1') && !su.includes('B2')))) return true;
      if (normalizedOpt === '3' && su.includes('OPTION B2')) return true;
      return false;
    });
    // If Option 2 matched nothing but there are Option B entries, try broader match
    if (normalizedOpt === '2' && filtered.length === 0) {
      filtered = urlBlocks.filter(b => b.section.toUpperCase().includes('OPTION B') || b.section.toUpperCase().includes('OPTION 2'));
    }
  }

  // Filter by term if specified
  if (termRef) {
    const termNum = termRef[1];
    const termFiltered = filtered.filter(b => b.term.startsWith(termNum));
    if (termFiltered.length > 0) filtered = termFiltered;
  }

  if (filtered.length === 0) filtered = urlBlocks;

  // Build pricing response for each matching URL
  const responses = [];
  for (const block of filtered) {
    const parsed = parseStratusUrl(block.url);
    if (!parsed) continue;
    const label = [block.section, block.term].filter(Boolean).join(' — ');
    const resp = formatPricingResponse(label || null, parsed.skus, parsed.qtys);
    if (resp) responses.push(resp);
  }

  if (responses.length === 0) return null;
  return responses.join('\n\n');
}

/**
 * Extract relevant SKU prices for injection into Claude's system prompt (Option 3).
 * Returns a pricing context string or null.
 */
function getRelevantPriceContext(text, history) {
  const skusToLookup = new Set();

  // Extract SKUs from the user message
  const skuPattern = /\b([A-Z]{1,3}\d{1,4}[-A-Z0-9]*)\b/gi;
  let match;
  while ((match = skuPattern.exec(text)) !== null) {
    skusToLookup.add(match[1].toUpperCase());
  }

  // Extract SKUs from recent assistant responses (URLs)
  if (history && history.length > 0) {
    const recentAssistant = history.filter(h => h.role === 'assistant').slice(-2);
    for (const msg of recentAssistant) {
      const urls = msg.content.match(/https:\/\/stratusinfosystems\.com\/order\/\?item=([^&\s]+)/g) || [];
      for (const url of urls) {
        const itemMatch = url.match(/item=([^&\s]+)/);
        if (itemMatch) {
          itemMatch[1].split(',').forEach(s => skusToLookup.add(s.trim().toUpperCase()));
        }
      }
    }
  }

  if (skusToLookup.size === 0) return null;

  // Look up prices for all detected SKUs
  const priceLines = [];
  for (const sku of skusToLookup) {
    const p = getPrice(sku);
    if (p) {
      priceLines.push(`${sku}: $${p.price.toLocaleString('en-US', { minimumFractionDigits: 2 })} (list: $${p.list.toLocaleString('en-US', { minimumFractionDigits: 2 })})`);
    }
  }

  if (priceLines.length === 0) return null;

  return `## RELEVANT PRICING (Stratus eComm prices)\nUse these prices when the user asks about costs, pricing, or totals. Show itemized breakdowns with per-unit and line totals.\n${priceLines.join('\n')}`;
}

// ─── Accessory Resolver Engine (Phase 2) ─────────────────────────────────────
const accessories = accessoriesData;
const portProfiles = accessories.port_profiles;
const sfpModules = accessories.sfp_modules;
const stackingData = accessories.stacking;
const uplinkModules = accessories.uplink_modules;

/**
 * Look up a device's port profile from accessories.json.
 * Handles both exact matches and family-level lookups (e.g., "C9300-48P-4X" → strip -M suffix).
 */
function getPortProfile(deviceModel) {
  const upper = deviceModel.toUpperCase().replace(/-HW(-NA)?$/, '').replace(/-MR$/, '').replace(/-RTG$/, '');
  // Try each family in port_profiles
  for (const [family, models] of Object.entries(portProfiles)) {
    if (models[upper]) return { profile: models[upper], family, model: upper };
    // Try with -M suffix for Catalyst
    if (models[upper + '-M']) return { profile: models[upper + '-M'], family, model: upper + '-M' };
    // Try stripping -M suffix if present
    const noM = upper.replace(/-M$/, '');
    if (models[noM]) return { profile: models[noM], family, model: noM };
  }
  return null;
}

/**
 * Get the SFP port capabilities of a device (what speeds/forms its uplink ports accept).
 * Returns array of {speed, form, count} objects.
 */
function getDeviceUplinkPorts(profileData) {
  if (!profileData) return [];
  const { profile, family } = profileData;

  // Modular devices (MS390, C9300, C9300X) - uplinks depend on which module is installed
  if (profile.uplinks === 'modular') {
    const mods = uplinkModules[family];
    if (!mods) return [];
    // Return all possible module options so resolver can recommend
    return mods.modules.map(m => ({
      speed: m.speed, form: m.type, count: m.ports, sku: m.sku, modular: true,
      recommended: m.recommended || false
    }));
  }

  // Fixed uplink devices - merge sfp_uplinks (MX) and uplinks (switches)
  const ports = [];
  if (profile.sfp_uplinks) {
    for (const p of profile.sfp_uplinks) ports.push({ speed: p.speed, form: p.form, count: p.count });
  }
  if (profile.uplinks && Array.isArray(profile.uplinks)) {
    for (const p of profile.uplinks) ports.push({ speed: p.speed, form: p.form, count: p.count });
  }
  // Also check sfp_lan for MX devices (can be used for interconnects)
  if (profile.sfp_lan) {
    for (const p of profile.sfp_lan) ports.push({ speed: p.speed, form: p.form, count: p.count, isLan: true });
  }
  return ports;
}

/**
 * Find the maximum common speed between two devices' SFP ports.
 * Returns the best matching speed tier or null if no SFP interconnect is possible.
 */
function findCommonSpeed(portsA, portsB) {
  const speedRank = { '100G': 5, '40G': 4, '25G': 3, '10G': 2, '1G': 1 };
  const speedsA = new Set(portsA.map(p => p.speed));
  const speedsB = new Set(portsB.map(p => p.speed));

  // Also account for backward compatibility: 10G SFP+ accepts 1G SFP, 25G SFP28 accepts 10G/1G
  const expandedA = new Set(speedsA);
  const expandedB = new Set(speedsB);
  if (speedsA.has('25G')) { expandedA.add('10G'); expandedA.add('1G'); }
  if (speedsA.has('10G')) expandedA.add('1G');
  if (speedsB.has('25G')) { expandedB.add('10G'); expandedB.add('1G'); }
  if (speedsB.has('10G')) expandedB.add('1G');

  // Find best common speed (prefer native match at highest speed)
  let bestSpeed = null;
  let bestRank = 0;
  for (const speed of expandedA) {
    if (expandedB.has(speed) && (speedRank[speed] || 0) > bestRank) {
      bestSpeed = speed;
      bestRank = speedRank[speed];
    }
  }
  return bestSpeed;
}

/**
 * Get compatible SFP modules for a given speed tier, checking device incompatibilities.
 * Returns array of SFP options sorted by use case relevance.
 */
function getCompatibleSfps(speed, deviceFamilies) {
  const speedCategories = {
    '1G': '1G_SFP',
    '10G': ['10G_SFP+', '10G_DAC'],
    '25G': '25G_SFP28',  // future-proofing
    '40G': '40G_QSFP',
    '100G': '100G_QSFP28'
  };
  const cats = speedCategories[speed];
  if (!cats) return [];
  const categoryList = Array.isArray(cats) ? cats : [cats];

  const results = [];
  for (const cat of categoryList) {
    const modules = sfpModules[cat] || [];
    for (const mod of modules) {
      // Check incompatibilities against both device families
      const isIncompat = mod.incompatible_with.some(f => deviceFamilies.includes(f));
      if (!isIncompat) {
        results.push({ ...mod, category: cat });
      }
    }
  }
  return results;
}

/**
 * Main accessory resolver: given two device models, determine what SFPs/cables are needed.
 * Returns a structured recommendation object.
 */
function resolveAccessories(deviceA, deviceB) {
  const profileA = getPortProfile(deviceA);
  const profileB = getPortProfile(deviceB);

  if (!profileA && !profileB) {
    return { error: true, message: `I couldn't find port profiles for either ${deviceA} or ${deviceB}. Could you double-check the model numbers?` };
  }
  if (!profileA) {
    return { error: true, message: `I don't have port profile data for ${deviceA}. Could you verify the model number?` };
  }
  if (!profileB) {
    return { error: true, message: `I don't have port profile data for ${deviceB}. Could you verify the model number?` };
  }

  const portsA = getDeviceUplinkPorts(profileA);
  const portsB = getDeviceUplinkPorts(profileB);

  // Check if either device has no SFP ports (RJ45 only)
  if (portsA.length === 0) {
    return { error: true, message: `The ${deviceA} only has RJ45 ports — no SFP slots available for fiber/DAC connections. It connects via standard Ethernet cable.` };
  }
  if (portsB.length === 0) {
    return { error: true, message: `The ${deviceB} only has RJ45 ports — no SFP slots available for fiber/DAC connections. It connects via standard Ethernet cable.` };
  }

  const families = [profileA.family, profileB.family];
  const isModularA = portsA.some(p => p.modular);
  const isModularB = portsB.some(p => p.modular);

  const bestSpeed = findCommonSpeed(portsA, portsB);
  if (!bestSpeed) {
    return { error: true, message: `No compatible SFP speed tier found between ${deviceA} and ${deviceB}. These devices may not have directly compatible uplink ports.` };
  }

  const sfpOptions = getCompatibleSfps(bestSpeed, families);

  // Build recommendation
  const result = {
    error: false,
    deviceA: { model: profileA.model, family: profileA.family, ports: portsA },
    deviceB: { model: profileB.model, family: profileB.family, ports: portsB },
    recommendedSpeed: bestSpeed,
    sfpOptions,
    modulesNeeded: [],
    notes: [],
    quantity: 2 // One SFP per end (pair needed)
  };

  // Flag modular devices that need uplink modules
  if (isModularA) {
    const mods = uplinkModules[profileA.family];
    if (mods) {
      const compatMods = mods.modules.filter(m => {
        const modSpeed = m.speed;
        const speedRank = { '100G': 5, '40G': 4, '25G': 3, '10G': 2, '1G': 1 };
        return (speedRank[modSpeed] || 0) >= (speedRank[bestSpeed] || 0);
      });
      result.modulesNeeded.push({
        device: profileA.model,
        family: profileA.family,
        options: compatMods,
        note: mods.note
      });
    }
  }
  if (isModularB) {
    const mods = uplinkModules[profileB.family];
    if (mods) {
      const compatMods = mods.modules.filter(m => {
        const modSpeed = m.speed;
        const speedRank = { '100G': 5, '40G': 4, '25G': 3, '10G': 2, '1G': 1 };
        return (speedRank[modSpeed] || 0) >= (speedRank[bestSpeed] || 0);
      });
      result.modulesNeeded.push({
        device: profileB.model,
        family: profileB.family,
        options: compatMods,
        note: mods.note
      });
    }
  }

  // Add incompatibility notes
  if (families.includes('MS390') || families.includes('C9300') || families.includes('C9300X') || families.includes('C9300L')) {
    result.notes.push('MA-SFP-1GB-TX (copper SFP) is NOT supported on Catalyst/MS390 platforms.');
  }
  if (families.includes('C9300X')) {
    result.notes.push('MA-SFP-10GB-LRM is NOT supported on C9300X.');
  }

  return result;
}

/**
 * Get stacking cable recommendations for a given switch model and quantity.
 * Returns structured stacking info or null if not stackable.
 */
function getStackingSuggestion(baseSku, qty) {
  if (qty < 2) return null;

  const profile = getPortProfile(baseSku);
  if (!profile || !profile.profile.stackable) return null;

  const stackType = profile.profile.stack_type;
  if (!stackType) return null;

  const stackFamily = stackingData.families[stackType];
  if (!stackFamily) return null;

  // Default 1M cable recommendation
  const defaultCable = Object.entries(stackFamily.cables).find(([_, v]) => v.use_case && v.use_case.includes('default'));
  const cableSku = defaultCable ? defaultCable[0] : Object.keys(stackFamily.cables)[1]; // fallback to 1M (usually index 1)
  const cableQty = qty; // ring topology = N cables for N switches

  const result = {
    stackType,
    bandwidth: stackFamily.bandwidth,
    maxStackSize: stackFamily.max_stack_size,
    cableSku,
    cableQty,
    topology: 'ring (recommended)',
    note: `${qty} ${baseSku} can be stacked. Ring topology needs ${qty} cables.`
  };

  // C9300L needs stacking kit
  if (stackFamily.requires_kit) {
    result.kitSku = stackFamily.requires_kit;
    result.kitQty = qty; // one per switch
    result.kitNote = stackFamily.kit_note;
  }

  // StackPower info
  if (stackFamily.stackpower) {
    result.stackpower = stackFamily.stackpower;
  }

  return result;
}

/**
 * Build a one-liner stacking suggestion for appending to quote output.
 * Light touch per user preference.
 */
function buildStackingSuggestionLine(baseSku, qty) {
  const suggestion = getStackingSuggestion(baseSku, qty);
  if (!suggestion) return null;

  let line = `💡 **Stacking:** ${qty}x ${baseSku} can be stacked (${suggestion.bandwidth}). `;
  line += `Ring topology needs ${suggestion.cableQty}x ${suggestion.cableSku}.`;

  if (suggestion.kitSku) {
    line += ` Each switch also requires 1x ${suggestion.kitSku} stacking module.`;
  }

  return line;
}

/**
 * Build accessories context string for Claude system prompt injection.
 * Only injects relevant data based on devices mentioned in the message.
 */
function getAccessoriesContext(userMessage) {
  const upper = userMessage.toUpperCase();

  // Check if message involves connectivity/accessories topics
  const accessoryIntent = /\b(SFP|OPTIC|TRANSCEIVER|FIBER|DAC|TWINAX|STACK(ING)?|UPLINK|MODULE|CONNECT|INTERCONNECT|CABLE|PORT|COMPATIBLE|COMPATIBILITY)\b/i.test(userMessage);
  const designIntent = /\b(CONNECT .+ TO|BETWEEN .+ AND|LINK .+ (TO|WITH)|UPLINK .+ (TO|FROM)|HOOK UP|TIE .+ TOGETHER)\b/i.test(userMessage);

  if (!accessoryIntent && !designIntent) return null;

  // Extract device models mentioned
  const devicePatterns = [
    /MX\d+[A-Z]*/gi, /MS\d{3}[A-Z]?-[\dA-Z-]+/gi, /MS\d{3}/gi,
    /C9[23]\d{2}[LX]?(?:-[\dA-Z]+-[\dA-Z]+)?(?:-M)?/gi,
    /MR\d+[A-Z]*/gi, /CW9\d{3}[A-Z]*/gi
  ];

  const mentionedDevices = new Set();
  for (const pattern of devicePatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      mentionedDevices.add(match[0]);
    }
  }

  let context = '## ACCESSORY & CONNECTIVITY REFERENCE\n';
  context += 'Use this data when answering questions about SFPs, stacking cables, uplink modules, or device connectivity.\n\n';

  // Inject relevant port profiles for mentioned devices
  if (mentionedDevices.size > 0) {
    context += '### Device Port Profiles\n';
    for (const dev of mentionedDevices) {
      const profile = getPortProfile(dev);
      if (profile) {
        context += `${profile.model} (${profile.family}): ${JSON.stringify(profile.profile)}\n`;
      }
    }
    context += '\n';
  }

  // Always inject SFP module catalog when SFP/optic/fiber topics come up
  if (/\b(SFP|OPTIC|TRANSCEIVER|FIBER|DAC|TWINAX)\b/i.test(userMessage)) {
    context += '### SFP Module Catalog\n';
    for (const [category, modules] of Object.entries(sfpModules)) {
      context += `${category}: ${modules.map(m => `${m.sku} (${m.medium}, ${m.range})`).join(', ')}\n`;
    }
    context += '\n';
  }

  // Inject stacking info when stacking topics come up
  if (/\b(STACK|STACKING)\b/i.test(userMessage)) {
    context += '### Stacking Cable Families\n';
    for (const [type, family] of Object.entries(stackingData.families)) {
      context += `${type} (${family.bandwidth}): ${family.compatible_switches.join(', ')} — cables: ${Object.keys(family.cables).join(', ')}\n`;
    }
    context += `Not stackable: ${stackingData.not_stackable.join(', ')}\n\n`;
  }

  // Inject uplink module info when modular devices or modules are mentioned
  if (/\b(MODULE|UPLINK|MS390|C9300|MODULAR)\b/i.test(userMessage)) {
    context += '### Uplink Modules (Modular Devices)\n';
    for (const [platform, data] of Object.entries(uplinkModules)) {
      context += `${platform}: ${data.modules.map(m => `${m.sku} (${m.ports}x ${m.speed} ${m.type})`).join(', ')} — ${data.note}\n`;
    }
    context += '\n';
  }

  // Always inject design rules
  context += '### Design Rules\n';
  context += accessories.design_rules.matching.join('\n') + '\n';
  context += accessories.design_rules.common_mistakes.join('\n') + '\n';

  return context;
}

// ─── Message Parser ──────────────────────────────────────────────────────────
function parseMessage(text) {
  const upper = text.toUpperCase();

  // Multi-line License SKU Input (CSV/list from dashboard export)
  // Handles formats like:
  //   LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\n...
  //   SKU,Count\nLIC-ENT-3YR,26\n...
  //   LIC-ENT-3YR 26\nLIC-MS120-8FP-3YR 4\n...
  const lines = text.trim().split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  // Extract all LIC- entries, skipping headers and non-matching lines
  if (lines.length >= 2) {
    const licItems = [];
    for (const line of lines) {
      // Match: LIC-xxx,qty or LIC-xxx qty
      const csvMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[,\s]\s*(\d+)\s*$/i);
      // Match: qty x LIC-xxx or qty LIC-xxx (quantity-first format)
      const qtyFirstMatch = !csvMatch && line.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else if (qtyFirstMatch) {
        licItems.push({ sku: qtyFirstMatch[2].toUpperCase(), qty: parseInt(qtyFirstMatch[1]) });
      } else {
        const singleMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
        if (singleMatch) {
          licItems.push({ sku: singleMatch[1].toUpperCase(), qty: 1 });
        }
        // Skip non-matching lines (headers, garbage, double-pasted data)
      }
    }
    // Deduplicate: if same SKU appears multiple times (e.g. double-pasted input), keep first occurrence
    const seenSkus = new Set();
    const dedupedItems = [];
    for (const item of licItems) {
      if (!seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
        dedupedItems.push(item);
      }
    }
    if (dedupedItems.length >= 2) {
      return {
        items: [],
        directLicenseList: dedupedItems,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false
      };
    }
  }

  // Multi-line bare model list (one device per line, no quantities)
  // Detects patterns like: MR36\nMR36\nMS250-24P\nMR44\n...
  // Counts occurrences of each model to derive quantities
  if (lines.length >= 3) {
    const modelPattern = /^\s*((?:MR|MV|MT|MG|MX|CW9|MS|C9|C8|Z)\d[A-Z0-9-]*)\s*$/i;
    const modelLines = lines.filter(l => modelPattern.test(l));
    // If at least 70% of non-empty lines are bare model numbers, treat as a device list
    if (modelLines.length >= 3 && modelLines.length / lines.length >= 0.7) {
      const counts = new Map();
      for (const line of modelLines) {
        const m = line.match(modelPattern);
        if (m) {
          const sku = m[1].toUpperCase();
          counts.set(sku, (counts.get(sku) || 0) + 1);
        }
      }
      const items = [...counts.entries()].map(([baseSku, qty]) => ({ baseSku, qty }));
      // Detect license-related intent from surrounding text
      const nonModelLines = lines.filter(l => !modelPattern.test(l)).join(' ').toUpperCase();
      const isLicenseOnly = /\b(LICENSE|RENEWAL|RENEW|LIC)\b/.test(nonModelLines);
      const showPricing = /\b(HOW\s+MUCH|PRICE[SD]?|PRICING|COST[S]?)\b/.test(nonModelLines);
      return {
        items,
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: isLicenseOnly },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing
      };
    }
  }

  // Direct License SKU Input (single line)
  const licDirectMatch = upper.match(/^\s*((?:LIC-[A-Z0-9-]+?)(?:\s+[X×]?\s*(\d+))?)\s*$/);
  if (licDirectMatch) {
    const fullInput = licDirectMatch[0].trim();
    const qtyAfter = fullInput.match(/\s+[X×]?\s*(\d+)\s*$/);
    let licSku = fullInput;
    let qty = 1;
    if (qtyAfter) {
      qty = parseInt(qtyAfter[1]);
      licSku = fullInput.slice(0, fullInput.length - qtyAfter[0].length).trim();
    }
    const qtyBefore = upper.match(/^\s*(\d+)\s*[X×]?\s*(LIC-[A-Z0-9-]+)\s*$/);
    if (qtyBefore) {
      qty = parseInt(qtyBefore[1]);
      licSku = qtyBefore[2];
    }
    if (licSku.startsWith('LIC-')) {
      return {
        items: [],
        directLicense: { sku: licSku, qty },
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing: false
      };
    }
  }

  let requestedTerm = null;
  const hasJust = /\b(JUST|ONLY)\b/.test(upper);
  if (hasJust) {
    if (/\b1[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 1;
    else if (/\b3[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 3;
    else if (/\b5[\s-]?Y(EAR)?\b/.test(upper)) requestedTerm = 5;
  }

  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|HARDWARE|WITHOUT\s+(A\s+)?LICENSE|NO\s+LICENSE|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/.test(upper) && !/\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  if (/\b(LICENSE\s+ONLY|JUST\s+THE\s+LICENSE|JUST\s+LICENSE|LICENSE[S]?\s+ONLY|NO\s+HARDWARE|RENEWAL\s+ONLY|LICENSE\s+RENEWAL|RENEW\s+(THE\s+)?LICENSE[S]?|RENEWAL\s+FOR|RENEW\s+EXISTING)\b/.test(upper)) {
    modifiers.licenseOnly = true;
  }

  const showPricing = /\b(HOW\s+MUCH|PRICE[SD]?|PRICING|COST[S]?|WITH\s+PRIC(E|ING|ES))\b/.test(upper);

  let requestedTier = null;
  if (/\b(ADVANCED\s+SECURITY|SEC(URITY)?)\b/.test(upper) && !/\bENTERPRISE\b/.test(upper)) {
    requestedTier = 'SEC';
  } else if (/\bENT(ERPRISE)?\b/.test(upper) && !/\bSEC(URITY)?\b/.test(upper)) {
    requestedTier = 'ENT';
  } else if (/\b(SD[\s-]?WAN|SDW)\b/.test(upper)) {
    requestedTier = 'SDW';
  }

  const advisoryPatterns = [
    /\bWHAT('?S| IS) THE DIFFERENCE\b/, /\bWHICH (ONE |SHOULD |DO |WOULD )/,
    /\bDO I NEED\b/, /\bIS .+ COMPATIBLE\b/, /\bCAN I USE\b/,
    /\bSHOULD I (GET|USE|GO|CHOOSE|PICK)\b/, /\bWHAT (DO YOU|WOULD YOU) (RECOMMEND|SUGGEST)\b/,
    /\bCOMPARE\b/, /\bTELL ME ABOUT\b/, /\bWHAT('?S| IS) THE BEST\b/,
    /\bHOW (DOES|DO|MANY|MUCH THROUGHPUT|FAST)\b/, /\bSPECS?\b/, /\bDIFFERENCE BETWEEN\b/,
    // Accessory/connectivity intent patterns (Phase 2)
    /\bWHAT SFP\b/, /\bWHICH SFP\b/, /\bWHAT OPTIC\b/, /\bWHICH OPTIC\b/,
    /\bCONNECT .+ TO\b/, /\bLINK .+ TO\b/, /\bHOOK UP\b/,
    /\bWHAT (CABLE|STACKING|STACK)\b/, /\bSTACK(ING|ABLE)? (CABLE)?\b/,
    /\bIS .+ STACKABLE\b/, /\bCAN .+ (BE )?STACK(ED)?\b/,
    /\bUPLINK MODULE\b/, /\bWHAT MODULE\b/, /\bWHICH MODULE\b/,
    /\bFIBER (TYPE|OPTIC|CABLE)\b/, /\bDAC\b/, /\bTWINAX\b/,
    /\bSFP.{0,20}(NEED|REQUIRE|USE|COMPATIBLE)\b/,
    /\bCOMPATIBLE (SFP|OPTIC|MODULE|TRANSCEIVER)\b/,
    /\bHOW (DO I |TO )?(CONNECT|LINK|UPLINK)\b/
  ];
  const isAdvisory = advisoryPatterns.some(p => p.test(upper));

  // ── Duo / Umbrella natural language handler ──
  // These are license-only products (no hardware), so intercept before hardware SKU parsing
  const duoMatch = upper.match(/(\d+)\s*[X×]?\s*(?:DUO|CISCO\s*DUO)\s*(ESSENTIALS?|ADVANTAGE|PREMIER)?/i)
    || upper.match(/(?:DUO|CISCO\s*DUO)\s*(ESSENTIALS?|ADVANTAGE|PREMIER)?\s*[X×]?\s*(\d+)?/i);
  if (duoMatch && !isAdvisory) {
    const qty = parseInt(duoMatch[1]) || parseInt(duoMatch[2]) || 1;
    const tierRaw = (duoMatch[2] || duoMatch[1] || '').toUpperCase();
    let tier = 'ESSENTIALS';
    if (/ADVANTAGE/.test(tierRaw)) tier = 'ADVANTAGE';
    else if (/PREMIER/.test(tierRaw)) tier = 'PREMIER';
    else if (/ESSENTIAL/.test(tierRaw)) tier = 'ESSENTIALS';
    else if (!/\d/.test(tierRaw) && tierRaw) tier = tierRaw.replace(/S$/, '') === 'ESSENTIAL' ? 'ESSENTIALS' : tierRaw;
    return {
      items: [
        { baseSku: `LIC-DUO-${tier}-1YR`, qty, isLicenseOnly: true },
        { baseSku: `LIC-DUO-${tier}-3YR`, qty, isLicenseOnly: true },
        { baseSku: `LIC-DUO-${tier}-5YR`, qty, isLicenseOnly: true }
      ],
      isQuote: true,
      isDuoUmbrella: true
    };
  }

  const umbMatch = upper.match(/(\d+)\s*[X×]?\s*(?:UMBRELLA|UMB)\s*(DNS|SIG(?:NATURE)?)?[- ]*(ESS(?:ENTIALS?)?|ADV(?:ANCED)?)?/i)
    || upper.match(/(?:UMBRELLA|UMB)\s*(DNS|SIG(?:NATURE)?)?[- ]*(ESS(?:ENTIALS?)?|ADV(?:ANCED)?)?\s*[X×]?\s*(\d+)?/i);
  if (umbMatch && !isAdvisory) {
    const qty = parseInt(umbMatch[1]) || parseInt(umbMatch[3]) || 1;
    const typeRaw = (umbMatch[2] || umbMatch[1] || 'DNS').toUpperCase();
    const tierRaw = (umbMatch[3] || umbMatch[2] || 'ESS').toUpperCase();
    const type = /SIG/.test(typeRaw) ? 'SIG' : 'DNS';
    const tier = /ADV/.test(tierRaw) ? 'ADV' : 'ESS';
    return {
      items: [
        { baseSku: `LIC-UMB-${type}-${tier}-K9-1YR`, qty, isLicenseOnly: true },
        { baseSku: `LIC-UMB-${type}-${tier}-K9-3YR`, qty, isLicenseOnly: true },
        { baseSku: `LIC-UMB-${type}-${tier}-K9-5YR`, qty, isLicenseOnly: true }
      ],
      isQuote: true,
      isDuoUmbrella: true
    };
  }

  const skuPatterns = [
    /C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?/gi,
    /C8[14]\d{2}-G2-MX/gi,
    /MA-[A-Z0-9-]+/gi,
    /CW9\d{3}[A-Z0-9]*/gi,
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,
    /MS450-\d+/gi,
    /MS[12345]\d{2}R?-[\dA-Z]+(?:-RF)?/gi,
    /(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])/gi,
    /MX\d+[A-Z]*(?:-NA)?/gi,
    /Z\d+[A-Z]*/gi
  ];

  const rawMatches = [];
  const matched = new Set();

  for (const pattern of skuPatterns) {
    let match;
    while ((match = pattern.exec(upper)) !== null) {
      let sku = match[0];
      const pos = match.index;
      if (sku.endsWith('S') && sku.length > 3) {
        const stripped = sku.slice(0, -1);
        const strippedValid = VALID_SKUS.has(stripped) || detectFamily(stripped) !== null;
        const fullValid = VALID_SKUS.has(sku);
        if (strippedValid && !fullValid) sku = stripped;
      }
      if (matched.has(sku)) continue;
      matched.add(sku);
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + match[0].length, pos + match[0].length + 15);
      let qty = 1;
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*$/);
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9]|[A-Z]*-)/i);
      // For inline format (SKU1 qty1 SKU2 qty2...), prefer afterQty to avoid picking up previous SKU's quantity
      if (afterQty) qty = parseInt(afterQty[1]);
      else if (beforeQty) qty = parseInt(beforeQty[1]);
      rawMatches.push({ baseSku: sku, qty, position: pos });
    }
  }

  const foundItems = rawMatches.filter((item, idx) => {
    return !rawMatches.some((other, otherIdx) => {
      if (idx === otherIdx) return false;
      return other.baseSku.length > item.baseSku.length && other.baseSku.includes(item.baseSku);
    });
  });

  foundItems.sort((a, b) => a.position - b.position);
  const items = foundItems.map(({ baseSku, qty }) => ({ baseSku, qty }));

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
    if (isRevision || isAdvisory) {
      return { items: [], requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing };
    }
    return null;
  }
  return { items, requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing };
}

// ─── Price Formatting ────────────────────────────────────────────────────────
function formatPrice(num) {
  return '$' + num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildPricingBlock(urlItems, showPricing) {
  if (!showPricing) return '';
  let lines = [];
  let cartTotal = 0;
  for (const { sku, qty } of urlItems) {
    const priceData = getPrice(sku);
    if (priceData) {
      const lineTotal = priceData.price * qty;
      cartTotal += lineTotal;
      lines.push(`• ${qty} × ${sku} — ${formatPrice(priceData.price)} each (${formatPrice(lineTotal)})`);
    } else {
      lines.push(`• ${qty} × ${sku} — price not available`);
    }
  }
  if (cartTotal > 0) {
    lines.push(`**Cart Total: ${formatPrice(cartTotal)}**`);
  }
  return '\n' + lines.join('\n');
}

// ─── Quote Builder ───────────────────────────────────────────────────────────
function buildQuoteResponse(parsed) {
  // Build "source→target" upgrade mapping string for refresh option headers
  // eolList: array of { baseSku/baseModel, replacement } objects
  const _buildUpgradeMap = (eolList, uplinkIdx) => {
    const _p = (r) => Array.isArray(r) ? r[uplinkIdx || 0] : r;
    const pairs = [];
    const seen = new Set();
    for (const item of eolList) {
      const src = item.baseSku || item.baseModel;
      const tgt = _p(item.replacement);
      const key = `${src}→${tgt}`;
      if (!seen.has(key)) {
        seen.add(key);
        pairs.push(key);
      }
    }
    return pairs.join(', ');
  };

  // Duo / Umbrella license-only products — return 1Y/3Y/5Y URLs directly
  if (parsed.isDuoUmbrella && parsed.items) {
    const termGroups = { '1YR': [], '3YR': [], '5YR': [] };
    for (const item of parsed.items) {
      const termMatch = item.baseSku.match(/(\d)YR$/);
      if (termMatch) {
        const key = `${termMatch[1]}YR`;
        if (termGroups[key]) termGroups[key].push({ sku: item.baseSku, qty: item.qty });
      }
    }
    const lines = [];
    for (const [term, skus] of Object.entries(termGroups)) {
      if (skus.length > 0) {
        const url = buildStratusUrl(skus);
        lines.push(`**${term.replace('YR', '-Year')}:** ${url}`);
      }
    }
    return { text: lines.join('\n\n'), needsLlm: false };
  }

  // Multi-line license SKU list (CSV from dashboard)
  if (parsed.directLicenseList) {
    const lines = [];
    const _primary = (r) => Array.isArray(r) ? r[0] : r;
    const _hasAlt = (r) => Array.isArray(r) && r.length > 1;

    // Detect term from license SKUs (e.g. LIC-ENT-3YR → 3, LIC-MT-3Y → 3)
    let detectedTerm = null;
    for (const { sku } of parsed.directLicenseList) {
      const termMatch = sku.match(/(\d+)\s*Y(?:R|EA)?$/i);
      if (termMatch) { detectedTerm = parseInt(termMatch[1]); break; }
    }
    const terms = detectedTerm ? [detectedTerm] : [1, 3, 5];
    const requestedTier = parsed.requestedTier || null;

    // Extract base hardware model from each license SKU and check EOL
    const eolFound = []; // { baseModel, replacement, sku, qty }
    for (const { sku, qty } of parsed.directLicenseList) {
      const modelMatch = sku.match(/^LIC-(MS\d{3}-[A-Z0-9]+)-\d+Y/i) ||
                         sku.match(/^LIC-(MX\d+[A-Z]*)-[A-Z]+-\d+Y/i) ||
                         sku.match(/^LIC-(Z\d+[A-Z]*)-[A-Z]+-\d+Y/i) ||
                         sku.match(/^LIC-(MG\d+[A-Z]*)-[A-Z]+-\d+Y/i);
      if (modelMatch) {
        const baseModel = modelMatch[1].toUpperCase();
        if (isEol(baseModel)) {
          const replacement = checkEol(baseModel);
          if (replacement) {
            eolFound.push({ baseModel, replacement, sku, qty });
          }
        }
      }
    }

    // Show EOL warnings (compact format, no EOS dates)
    if (eolFound.length > 0) {
      lines.push(`**Products End of Life:**`);
      for (const { baseModel, replacement } of eolFound) {
        if (_hasAlt(replacement)) {
          lines.push(`• ${baseModel} (EOL) → Replacements: ${replacement[0]} (1G) / ${replacement[1]} (10G)`);
        } else {
          lines.push(`• ${baseModel} (EOL) → Replacement: ${_primary(replacement)}`);
        }
      }
      lines.push('');
    }

    // Option 1 — Renew existing licenses (original SKUs as submitted)
    lines.push(`**Option 1 — Renew Existing Licenses:**`);
    for (const term of terms) {
      const url = buildStratusUrl(parsed.directLicenseList);
      const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
      lines.push(`${termLabel}: ${url}`);
      lines.push('');
    }

    // Option 2/3 — Refresh (only if EOL items found)
    if (eolFound.length > 0) {
      const hasDualUplink = eolFound.some(({ replacement }) => _hasAlt(replacement));

      // Helper: build refresh URL items for a given uplink choice
      const _buildRefreshItems = (term, uplinkIdx) => {
        const urlItems = [];
        const processedEolModels = new Set();

        for (const { sku, qty } of parsed.directLicenseList) {
          // Check if this license is for an EOL model
          const eolEntry = eolFound.find(e => e.sku === sku);
          if (eolEntry && !processedEolModels.has(eolEntry.baseModel)) {
            processedEolModels.add(eolEntry.baseModel);
            const repl = _hasAlt(eolEntry.replacement) ? eolEntry.replacement[uplinkIdx] : _primary(eolEntry.replacement);
            const replHwSku = applySuffix(repl);
            const replLicenses = getLicenseSkus(repl, requestedTier);
            urlItems.push({ sku: replHwSku, qty });
            if (replLicenses) {
              const licSku = replLicenses.find(l => l.term === `${term}Y`)?.sku;
              if (licSku) urlItems.push({ sku: licSku, qty });
            }
          } else if (!eolEntry) {
            // Non-EOL license — pass through as-is
            urlItems.push({ sku, qty });
          }
        }
        return urlItems;
      };

      // Hardware breakdown for license CSV path (shows combined quantities with source tracking)
      const _buildHardwareBreakdownLic = (uplinkIdx) => {
        const hwMap = new Map();
        const processedModels = new Set();
        for (const { baseModel, qty, replacement } of eolFound) {
          if (processedModels.has(baseModel)) continue;
          processedModels.add(baseModel);
          const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
          const replHwSku = applySuffix(repl);
          if (!hwMap.has(replHwSku)) hwMap.set(replHwSku, { total: 0, parts: [] });
          const entry = hwMap.get(replHwSku);
          entry.total += qty;
          entry.parts.push({ qty, source: `replacing ${baseModel}` });
        }
        if (hwMap.size === 0) return [];
        const bdLines = [];
        for (const [hwSku, { total, parts }] of hwMap) {
          if (parts.length === 1) {
            bdLines.push(`• ${hwSku} × ${total} (${parts[0].source})`);
          } else {
            const detail = parts.map(p => `${p.qty} ${p.source}`).join(' + ');
            bdLines.push(`• ${hwSku} × ${total} (${detail})`);
          }
        }
        return bdLines;
      };

      if (hasDualUplink) {
        lines.push(`**Option 2 — Hardware Refresh, 1G Uplink:**`);
        lines.push(..._buildHardwareBreakdownLic(0));
        lines.push('');
        for (const term of terms) {
          const urlItems = _buildRefreshItems(term, 0);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
            lines.push(`${termLabel}: ${url}`);
            lines.push('');
          }
        }
        lines.push(`**Option 3 — Hardware Refresh, 10G Uplink:**`);
        lines.push(..._buildHardwareBreakdownLic(1));
        lines.push('');
        for (const term of terms) {
          const urlItems = _buildRefreshItems(term, 1);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
            lines.push(`${termLabel}: ${url}`);
            lines.push('');
          }
        }
      } else {
        lines.push(`**Option 2 — Hardware Refresh:**`);
        lines.push(..._buildHardwareBreakdownLic(0));
        lines.push('');
        for (const term of terms) {
          const urlItems = _buildRefreshItems(term, 0);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
            lines.push(`${termLabel}: ${url}`);
            lines.push('');
          }
        }
      }
    }

    return { message: lines.join('\n').trim(), needsLlm: false };
  }

  if (parsed.directLicense) {
    const { sku, qty } = parsed.directLicense;
    const url = buildStratusUrl([{ sku, qty }]);
    let message = url;
    if (parsed.showPricing) message += buildPricingBlock([{ sku, qty }], true);
    return { message, needsLlm: false };
  }

  if (parsed.isAdvisory) return { message: null, needsLlm: true, advisory: true };
  if (parsed.isRevision && parsed.items.length === 0) return { message: null, needsLlm: true, revision: true };

  const terms = parsed.requestedTerm ? [parsed.requestedTerm] : [1, 3, 5];
  const modifiers = parsed.modifiers || { hardwareOnly: false, licenseOnly: false };
  const requestedTier = parsed.requestedTier || null;
  const eolItems = [];
  const errors = [];
  const resolvedItems = [];
  const tierWarnings = [];

  for (const { baseSku, qty } of parsed.items) {
    const validation = validateSku(baseSku);
    if (!validation.valid) {
      const suggest = validation.suggest ? `\nDid you mean: ${validation.suggest.slice(0, 3).join(', ')}?` : '';
      errors.push(`⚠️ **${baseSku}**: ${validation.reason}${suggest}`);
      continue;
    }
    const eol = isEol(baseSku);
    const replacement = checkEol(baseSku);
    if (eol && replacement) {
      eolItems.push({ baseSku, qty, replacement, eol: true });
      continue;
    }
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
    const hwSku = applySuffix(baseSku);
    const licenseSkus = getLicenseSkus(baseSku, requestedTier);
    resolvedItems.push({ baseSku, hwSku, qty, licenseSkus, eol: false });
  }

  if (errors.length > 0 && resolvedItems.length === 0 && eolItems.length === 0) {
    // ALL items are invalid — block entirely
    const allPartialMatches = parsed.items.every(({ baseSku }) => {
      const v = validateSku(baseSku);
      return v.valid || (!v.valid && (v.isPartialMatch || v.isFuzzyMatch || v.isCommonMistake) && v.suggest && v.suggest.length > 0);
    });
    if (allPartialMatches) {
      const lines = [];
      for (const { baseSku } of parsed.items) {
        const v = validateSku(baseSku);
        if (v.valid) continue;
        const upper = baseSku.toUpperCase();
        if (v.suggest && v.suggest.length === 1) {
          // Single suggestion — strong "Did you mean?" prompt
          lines.push(`⚠️ **${upper}** is not a recognized SKU. Did you mean **${v.suggest[0]}**?`);
        } else if (v.isFuzzyMatch || v.isCommonMistake || v.reason) {
          // Fuzzy match or common mistake — show suggestions with context
          lines.push(`⚠️ **${upper}** is not a recognized SKU.${v.reason && !v.reason.includes('not a recognized') ? ' ' + v.reason + '.' : ''} Did you mean:`);
          for (const s of v.suggest) lines.push(`• ${s}`);
        } else {
          // Multiple partial matches — variant disambiguation
          const family = detectFamily(upper);
          const familyLabel = family || upper;
          const portMatch = baseSku.match(/\d+$/);
          const portHint = portMatch ? ` ${portMatch[0]}-port` : '';
          lines.push(`I found multiple ${familyLabel}${portHint} variants. Which one do you need?`);
          for (const s of v.suggest) lines.push(`• ${s}`);
        }
      }
      return { message: lines.join('\n'), needsLlm: false };
    }
    return { message: null, needsLlm: true, errors };
  }
  // If some items are invalid but others are valid/EOL, proceed with valid items
  // and append errors as warnings at the top

  let lines = [];
  // Prepend invalid SKU warnings when processing alongside valid items
  if (errors.length > 0) {
    lines.push(...errors, '');
    lines.push('_The items above were skipped. Quote generated for recognized models below._', '');
  }
  if (tierWarnings.length > 0) lines.push(...tierWarnings, '');

  if (eolItems.length > 0) {
    // Normalize replacement to always be primary (first option) for warnings
    // replacement can be a string or an array of [4G, 4X] options
    const _primary = (r) => Array.isArray(r) ? r[0] : r;
    const _hasAlt = (r) => Array.isArray(r) && r.length > 1;

    // List all EOL warnings first (compact format, no EOS dates)
    lines.push(`**Products End of Life:**`);
    for (const { baseSku, replacement } of eolItems) {
      if (_hasAlt(replacement)) {
        lines.push(`• ${baseSku} (EOL) → Replacements: ${replacement[0]} (1G) / ${replacement[1]} (10G)`);
      } else {
        lines.push(`• ${baseSku} (EOL) → Replacement: ${_primary(replacement)}`);
      }
    }
    lines.push('');

    // Option 1 — Consolidated renewal (license-only for existing EOL hardware)
    // For products where getLicenseSkus returns null (MS390, MS450), generate legacy license SKU
    const _getEolRenewalLicenses = (baseSku) => {
      const lics = getLicenseSkus(baseSku, requestedTier);
      if (lics) return lics;
      // Fallback: generate legacy switch license pattern (e.g. LIC-MS390-48UX-1YR)
      const legacyMatch = baseSku.toUpperCase().match(/^(MS\d{3})-(.+)/);
      if (legacyMatch) {
        return [
          { term: '1Y', sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-1YR` },
          { term: '3Y', sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-3YR` },
          { term: '5Y', sku: `LIC-${legacyMatch[1]}-${legacyMatch[2]}-5YR` }
        ];
      }
      return null;
    };
    const hasRenewLicenses = eolItems.some(({ baseSku }) => _getEolRenewalLicenses(baseSku));
    if (hasRenewLicenses) {
      if (modifiers.licenseOnly) {
        // User explicitly asked for license renewal — simple label, everything is license-only
        lines.push(`**Option 1 — Renew Existing Licenses:**`);
      } else {
        // Regular quote — clarify that EOL items are license-only while current gear includes hardware
        const eolNames = eolItems.map(e => e.baseSku).join(', ');
        lines.push(`**Option 1 — As Quoted:**`);
        for (const { baseSku } of eolItems) {
          lines.push(`ℹ️ ${baseSku} — license renewal only (no longer orderable)`);
        }
        if (resolvedItems.length > 0) {
          lines.push(`All other hardware included. See Option 2 for replacement hardware.`);
        }
        lines.push('');
      }
      for (const term of terms) {
        const urlItems = [];
        for (const { baseSku, qty } of eolItems) {
          const renewLicenses = _getEolRenewalLicenses(baseSku);
          if (renewLicenses) {
            const licSku = renewLicenses.find(l => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
        }
        // Also include non-EOL resolved items
        // Default: hardware + licenses (user asked for a regular quote, non-EOL gear is current)
        // licenseOnly: license-only (user explicitly asked for license renewal)
        for (const { hwSku, qty, licenseSkus } of resolvedItems) {
          if (!modifiers.licenseOnly && !modifiers.hardwareOnly) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus && !modifiers.hardwareOnly) {
            const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
        }
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
          lines.push(`${termLabel}: ${url}`);
          lines.push('');
        }
      }
    }

    // Check if any EOL item has dual-uplink options
    const hasDualUplink = eolItems.some(({ replacement }) => _hasAlt(replacement));

    // Helper: build refresh URL items for a given uplink choice (0 = 4G, 1 = 4X)
    const _buildRefreshItems = (term, uplinkIdx) => {
      const urlItems = [];
      for (const { baseSku, qty, replacement } of eolItems) {
        const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
        const replHwSku = applySuffix(repl);
        const replLicenses = getLicenseSkus(repl, requestedTier);
        // EOL replacement hardware ALWAYS included in refresh (that's the whole point)
        urlItems.push({ sku: replHwSku, qty });
        if (replLicenses && !modifiers.hardwareOnly) {
          const licSku = replLicenses.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
      }
      // Also include non-EOL resolved items
      // Default: hardware + licenses (refresh option includes all current gear as-is)
      // licenseOnly: license-only for non-EOL (user asked for license renewal, only EOL gets replacement hw)
      for (const { hwSku, qty, licenseSkus } of resolvedItems) {
        if (!modifiers.licenseOnly && !modifiers.hardwareOnly) urlItems.push({ sku: hwSku, qty });
        if (licenseSkus && !modifiers.hardwareOnly) {
          const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
      }
      return urlItems;
    };

    // Helper: build hardware breakdown showing what's existing vs replacement
    const _buildHardwareBreakdown = (uplinkIdx) => {
      const hwMap = new Map(); // finalHwSku -> { total, parts: [{qty, source}] }
      // EOL replacement hardware
      for (const { baseSku, qty, replacement } of eolItems) {
        const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
        const replHwSku = applySuffix(repl);
        if (!hwMap.has(replHwSku)) hwMap.set(replHwSku, { total: 0, parts: [] });
        const entry = hwMap.get(replHwSku);
        entry.total += qty;
        entry.parts.push({ qty, source: `replacing ${baseSku}` });
      }
      // Non-EOL hardware (only in regular quote mode, not license renewal)
      if (!modifiers.licenseOnly) {
        for (const { hwSku, qty } of resolvedItems) {
          if (!hwMap.has(hwSku)) hwMap.set(hwSku, { total: 0, parts: [] });
          const entry = hwMap.get(hwSku);
          entry.total += qty;
          entry.parts.push({ qty, source: 'existing' });
        }
      }
      if (hwMap.size === 0) return [];
      const bdLines = [];
      for (const [hwSku, { total, parts }] of hwMap) {
        if (parts.length === 1 && parts[0].source === 'existing') {
          bdLines.push(`• ${hwSku} × ${total}`);
        } else if (parts.length === 1) {
          bdLines.push(`• ${hwSku} × ${total} (${parts[0].source})`);
        } else {
          const detail = parts.map(p => `${p.qty} ${p.source}`).join(' + ');
          bdLines.push(`• ${hwSku} × ${total} (${detail})`);
        }
      }
      return bdLines;
    };

    // Helper: generate stacking + module suggestions for replacement SKUs
    const _buildReplacementAccessorySuggestions = (uplinkIdx) => {
      const suggestionLines = [];
      const seenStackFamilies = new Set();
      const seenModFamilies = new Set();
      for (const { qty, replacement } of eolItems) {
        const repl = _hasAlt(replacement) ? replacement[uplinkIdx] : _primary(replacement);
        // Stacking suggestion for replacement
        if (qty >= 2 && !seenStackFamilies.has(repl)) {
          const suggestion = buildStackingSuggestionLine(repl, qty);
          if (suggestion) {
            seenStackFamilies.add(repl);
            suggestionLines.push(suggestion);
          }
        }
        // Uplink module reminder for replacement
        const profile = getPortProfile(repl);
        if (profile && profile.profile.uplinks === 'modular' && !seenModFamilies.has(profile.family)) {
          seenModFamilies.add(profile.family);
          const mods = uplinkModules[profile.family];
          if (mods) {
            suggestionLines.push(`💡 **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
          }
        }
      }
      // Also check non-EOL resolved items
      for (const { baseSku, qty } of resolvedItems) {
        if (qty >= 2 && !seenStackFamilies.has(baseSku)) {
          const suggestion = buildStackingSuggestionLine(baseSku, qty);
          if (suggestion) {
            seenStackFamilies.add(baseSku);
            suggestionLines.push(suggestion);
          }
        }
        const profile = getPortProfile(baseSku);
        if (profile && profile.profile.uplinks === 'modular' && !seenModFamilies.has(profile.family)) {
          seenModFamilies.add(profile.family);
          const mods = uplinkModules[profile.family];
          if (mods) {
            suggestionLines.push(`💡 **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
          }
        }
      }
      return suggestionLines;
    };

    if (hasDualUplink) {
      lines.push(`**Option 2 — Hardware Refresh, 1G Uplink:**`);
      lines.push(..._buildHardwareBreakdown(0));
      lines.push('');
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 0);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
          lines.push(`${termLabel}: ${url}`);
          lines.push('');
        }
      }
      // Accessory suggestions for Option 2 replacement SKUs
      const opt2Suggestions = _buildReplacementAccessorySuggestions(0);
      for (const s of opt2Suggestions) { lines.push(s); }
      if (opt2Suggestions.length > 0) lines.push('');

      lines.push(`**Option 3 — Hardware Refresh, 10G Uplink:**`);
      lines.push(..._buildHardwareBreakdown(1));
      lines.push('');
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 1);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
          lines.push(`${termLabel}: ${url}`);
          lines.push('');
        }
      }
      // Accessory suggestions for Option 3 replacement SKUs
      const opt3Suggestions = _buildReplacementAccessorySuggestions(1);
      for (const s of opt3Suggestions) { lines.push(s); }
      if (opt3Suggestions.length > 0) lines.push('');
    } else {
      lines.push(`**Option 2 — Hardware Refresh:**`);
      lines.push(..._buildHardwareBreakdown(0));
      lines.push('');
      for (const term of terms) {
        const urlItems = _buildRefreshItems(term, 0);
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
          lines.push(`${termLabel}: ${url}`);
          lines.push('');
        }
      }
      // Accessory suggestions for Option 2 replacement SKUs
      const opt2Suggestions = _buildReplacementAccessorySuggestions(0);
      for (const s of opt2Suggestions) { lines.push(s); }
      if (opt2Suggestions.length > 0) lines.push('');
    }

    // When there are EOL items AND non-EOL resolved items, we already included
    // resolved items in both Option 1 and 2/3 above, so skip the normal output block
    if (resolvedItems.length > 0) {
      if (parsed.showPricing) {
        const allItems = [];
        for (const { hwSku, qty, licenseSkus } of resolvedItems) {
          if (!modifiers.licenseOnly) allItems.push({ sku: hwSku, qty });
          if (licenseSkus && !modifiers.hardwareOnly) {
            const licSku = licenseSkus.find(l => l.term === '3Y')?.sku;
            if (licSku) allItems.push({ sku: licSku, qty });
          }
        }
        lines.push(buildPricingBlock(allItems, false));
      }
      return { message: lines.join('\n').trim(), needsLlm: false };
    }
  }

  if (resolvedItems.length === 0 && eolItems.length === 0) {
    return { message: null, needsLlm: true, errors };
  }

  if (resolvedItems.length > 0) {
    if (modifiers.hardwareOnly) {
      // Hardware-only: single URL (no license terms to differentiate)
      const urlItems = [];
      for (const { hwSku, qty } of resolvedItems) {
        urlItems.push({ sku: hwSku, qty });
      }
      if (urlItems.length > 0) {
        const url = buildStratusUrl(urlItems);
        lines.push(url);
        if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
        lines.push('');
      }
    } else {
      for (const term of terms) {
        const urlItems = [];
        for (const { hwSku, qty, licenseSkus } of resolvedItems) {
          if (!modifiers.licenseOnly) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus) {
            const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
        }
        if (urlItems.length > 0) {
          const url = buildStratusUrl(urlItems);
          const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
          lines.push(`**${termLabel}:** ${url}`);
          if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
          lines.push('');
        }
      }
    }
  }

  // Phase 3: Stacking auto-suggest for non-EOL stackable switches with qty > 1
  // (EOL items get suggestions on their replacement SKUs inside Option 2/3 sections)
  const stackableFamilies = new Set();
  for (const { baseSku, qty } of parsed.items) {
    if (qty >= 2 && !isEol(baseSku)) {
      const suggestion = buildStackingSuggestionLine(baseSku, qty);
      if (suggestion && !stackableFamilies.has(baseSku)) {
        stackableFamilies.add(baseSku);
        lines.push('');
        lines.push(suggestion);
      }
    }
  }

  // Phase 3: Uplink module reminder for non-EOL modular devices (MS390, C9300, C9300X)
  const modularFamiliesFound = new Set();
  for (const { baseSku } of parsed.items) {
    if (isEol(baseSku)) continue; // Skip EOL — handled in Option 2/3
    const profile = getPortProfile(baseSku);
    if (profile && profile.profile.uplinks === 'modular' && !modularFamiliesFound.has(profile.family)) {
      modularFamiliesFound.add(profile.family);
      const mods = uplinkModules[profile.family];
      if (mods) {
        lines.push('');
        lines.push(`💡 **Uplink Module:** ${profile.family} ships without uplink module. Popular choice: ${mods.modules[0].sku} (${mods.modules[0].ports}x ${mods.modules[0].speed} ${mods.modules[0].type}).`);
      }
    }
  }

  return { message: lines.join('\n').trim(), needsLlm: false };
}

// ─── System Prompt (identical to Express version) ────────────────────────────
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
- MS150, MS450, C9xxx-M, MA- accessories → no suffix
- Z4X, Z4CX → no suffix (sold as-is)
- Legacy switches (MS120/125/210/225/250/350/425) → add -HW

## LICENSE RULES (CRITICAL — term suffix format matters! Follow EXACTLY)
Three license tiers exist for MX/Z:
- ENT (Enterprise): Available for ALL product families
- SEC (Advanced Security): Available for MX (all models), Z4/Z4C. DEFAULT for MX and Z4/Z4C.
- SDW (SD-WAN): Available for MX (all models) only. ALWAYS uses -Y suffix regardless of model age.

EXACT license SKU mappings by product family:

### APs (MR + CW) — all use generic ENT license
- All MR and CW APs → LIC-ENT-1YR, LIC-ENT-3YR, LIC-ENT-5YR (note: -YR suffix)
- CW9800 wireless controllers → NO license association

### MX Security Appliances — term suffix depends on model number
- MX67, MX67W, MX67C, MX68, MX68W, MX68CW, MX250, MX450 (older) → -YR suffix
  Examples: LIC-MX67-SEC-1YR, LIC-MX68CW-SEC-3YR, LIC-MX250-SEC-5YR
- MX75, MX85, MX95, MX105 (newer) → -Y suffix
  Examples: LIC-MX75-SEC-1Y, LIC-MX85-SEC-3Y, LIC-MX95-ENT-5Y
- MX cellular (-NA variants): license uses the C/CW model WITHOUT -NA
  Examples: MX67C-HW-NA → LIC-MX67C-SEC-1YR, MX68CW-HW-NA → LIC-MX68CW-SEC-1YR
- SDW tier ALWAYS uses -Y suffix: LIC-MX85-SDW-1Y, LIC-MX67-SDW-1Y

### Z-Series
- Z1, Z3, Z3C (legacy) → ENT only, -YR suffix: LIC-Z1-ENT-1YR, LIC-Z3C-ENT-3YR
- Z4, Z4C → SEC default, -Y suffix: LIC-Z4-SEC-1Y, LIC-Z4C-SEC-3Y
- Z4X, Z4CX → same as Z4/Z4C (X is hardware suffix only, not in license SKU)

### MG Cellular Gateways — -Y suffix, strip E from model
- MG21/MG21E → LIC-MG21-ENT-1Y, -3Y, -5Y
- MG41/MG41E → LIC-MG41-ENT-1Y, -3Y, -5Y
- MG51/MG51E → LIC-MG51-ENT-1Y, -3Y, -5Y
- MG52/MG52E → LIC-MG52-ENT-1Y, -3Y, -5Y

### MV Cameras — generic, -YR suffix
- ALL MV models → LIC-MV-1YR, LIC-MV-3YR, LIC-MV-5YR

### MT Sensors — generic, -Y suffix
- ALL MT models → LIC-MT-1Y, LIC-MT-3Y, LIC-MT-5Y

### MS130 Switches — -Y suffix
- Compact (8/8P/8X/8P-I/12X, MS130R-8P) → LIC-MS130-CMPT-1Y, -3Y, -5Y
- Standard → LIC-MS130-{24|48}-1Y, -3Y, -5Y

### MS150 Switches — -Y suffix
- All variants → LIC-MS150-{24|48}-1Y, -3Y, -5Y (port count only, ignore uplink)

### MS390 Switches — port count + tier, -Y suffix
- MS390-24UX → LIC-MS390-24E-1Y, -3Y, -5Y
- MS390-48UX → LIC-MS390-48E-1Y, -3Y, -5Y
- Use port count only (24 or 48), drop variant letters. Tier A or E (default E).

### MS450 Switches — -Y suffix
- MS450-12 → LIC-MS450-12E-1Y, -3Y, -5Y

### Catalyst C9300-M — port count + tier, -Y suffix
- C9300-24T-M, C9300-24P-M, etc. → LIC-C9300-24E-1Y, -3Y, -5Y
- C9300-48T-M, C9300-48P-M, C9300-48UXM-M, etc. → LIC-C9300-48E-1Y, -3Y, -5Y

### Catalyst C9300X-M — MAPS TO C9300 licenses (C9300X has NO its own license SKUs!)
- C9300X-24Y-M, C9300X-24HX-M → LIC-C9300-24E-1Y, -3Y, -5Y
- C9300X-48TX-M, C9300X-48HX-M, C9300X-48HXN-M → LIC-C9300-48E-1Y, -3Y, -5Y
- C9300X-12Y-M → LIC-C9300-24E-1Y, -3Y, -5Y (12-port uses 24-port license!)

### Catalyst C9300L-M — MAPS TO C9300 licenses (C9300L has NO its own license SKUs!)
- C9300L-24T-4X-M, C9300L-24P-4X-M, etc. → LIC-C9300-24E-1Y, -3Y, -5Y
- C9300L-48T-4X-M, C9300L-48P-4X-M, etc. → LIC-C9300-48E-1Y, -3Y, -5Y

### Catalyst C9200L-M — -Y suffix
- C9200L-24T-4G-M, C9200L-24P-4X-M, etc. → LIC-C9200L-24E-1Y, -3Y, -5Y
- C9200L-48T-4G-M, C9200L-48P-4X-M, etc. → LIC-C9200L-48E-1Y, -3Y, -5Y

### Catalyst C9350 — NO 1Y option, only 3Y and 5Y
- C9350-24* → LIC-C9350-24E-3Y, LIC-C9350-24E-5Y
- C9350-48* → LIC-C9350-48E-3Y, LIC-C9350-48E-5Y

### Legacy Switches (all EOL) — -YR suffix
- MS120/125/210/220/225/250/320/350/355/410/420/425 → LIC-{model}-{variant}-1YR, -3YR, -5YR
  Examples: LIC-MS250-48FP-1YR, LIC-MS350-24X-1YR
  Exception: MS350-48X uses LIC-MS350-48-1YR (drop the X from 48-port only)

## VALID PRODUCT CATALOG
APs (MR): MR28, MR36, MR36H, MR44, MR46, MR46E, MR52, MR57, MR76, MR78, MR86
APs (CW Wi-Fi 6E): CW9162I, CW9163E (external antenna), CW9164I, CW9166I, CW9166D1 (directional)
APs (CW Wi-Fi 7): CW9171I (entry), CW9172I (mid-range, DEFAULT), CW9172H (hospitality), CW9174I (high-perf), CW9176I (premium), CW9176D1 (directional), CW9178I (top-tier), CW9179F (outdoor)
MX Security: MX67, MX67W, MX67C, MX67C-NA, MX68, MX68W, MX68CW, MX68CW-NA, MX75, MX85, MX95, MX105, MX250, MX450
Next-Gen MX (Catalyst-based, MX OS): C8111-G2-MX (replaces MX67, 2 Gbps FW, 1.2 Gbps VPN, 4 LAN, 200 users), C8121-G2-MX (replaces MX68, 2 Gbps FW, 1.2 Gbps VPN, 10 LAN, 200 users)
MS130 Switches: MS130-8, MS130-8P, MS130-8P-I, MS130-8X, MS130-12X, MS130-24, MS130-24P, MS130-24X, MS130-48, MS130-48P, MS130-48X, MS130R-8P
MS150 Switches: MS150-24T-4G, MS150-24P-4G, MS150-24T-4X, MS150-24P-4X, MS150-24MP-4X, MS150-48T-4G, MS150-48LP-4G, MS150-48FP-4G, MS150-48T-4X, MS150-48LP-4X, MS150-48FP-4X, MS150-48MP-4X
MS390 Switches: MS390-24UX, MS390-48UX, MS390-48UX2
MS450 Switches: MS450-12
Catalyst C9300-M: C9300-24T-M, C9300-24P-M, C9300-24U-M, C9300-24UX-M, C9300-24S-M, C9300-48T-M, C9300-48P-M, C9300-48U-M, C9300-48UXM-M, C9300-48S-M, C9300-48UN-M
Catalyst C9300X-M: C9300X-12Y-M, C9300X-24Y-M, C9300X-24HX-M, C9300X-48TX-M, C9300X-48HX-M, C9300X-48HXN-M
Catalyst C9300L-M: C9300L-24T-4X-M, C9300L-24P-4X-M, C9300L-24UXG-4X-M, C9300L-48T-4X-M, C9300L-48P-4X-M, C9300L-48PF-4X-M, C9300L-48UXG-4X-M
Catalyst C9200L-M: C9200L-24T-4G-M, C9200L-24P-4G-M, C9200L-24T-4X-M, C9200L-24P-4X-M, C9200L-24PXG-4X-M, C9200L-24PXG-2Y-M, C9200L-48T-4G-M, C9200L-48P-4G-M, C9200L-48PL-4G-M, C9200L-48T-4X-M, C9200L-48P-4X-M, C9200L-48PL-4X-M, C9200L-48PXG-4X-M, C9200L-48PXG-2Y-M
MV Cameras: MV2, MV13, MV13M, MV22, MV22X, MV23M, MV23X, MV32, MV33, MV33M, MV52, MV53X, MV63, MV63M, MV63X, MV72, MV72X, MV73X, MV73M, MV84X, MV93, MV93M, MV93X
MT Sensors: MT10, MT11, MT12, MT14, MT15, MT20, MT30, MT40
MG Cellular: MG21, MG21E, MG41, MG41E, MG51, MG51E, MG52, MG52E
Z-Series: Z4, Z4C, Z4X, Z4CX

## EOL PRODUCT KNOWLEDGE
These products are End-of-Life. ALWAYS check every product in a screenshot or request against this list:
- MX: MX60, MX60W, MX64, MX64W, MX65, MX65W, MX80, MX84, MX100, MX400, MX600
- MR: MR12, MR16, MR18, MR20, MR24, MR26, MR30H, MR32, MR33, MR34, MR42, MR42E, MR45, MR52, MR53, MR53E, MR55, MR56, MR62, MR66, MR70, MR72, MR74, MR84
- MV: MV12N, MV12W, MV12WE, MV21, MV22, MV22X, MV32, MV52, MV71, MV72, MV72X
- MS: MS120 (all), MS125 (all), MS210 (all), MS220 (all), MS225 (all), MS250 (all), MS320 (all), MS350 (all), MS355 (all), MS390 (all), MS410 (all), MS420 (all), MS425 (all)
- MG: MG21, MG21E, MG51, MG51E
- Z: Z1, Z3, Z3C

Replacements: MX60/64→MX67, MX65→MX68, MX80/84→MX85, MX100→MX95, MX400→MX250, MX600→MX450, MR20→MR28, MR30H→MR36H, MR33→MR36, MR42→MR44, MR45→MR46, MR52/53/56→MR57, MR55→MR57, MR70→MR78, MR74→MR76, MR84→MR86, MV Gen 2→Gen 3, MS120/125→MS130, MS210/220/225→MS130/MS150, MS250→C9300L, MS320→MS150, MS350→C9300, MS355→C9300X, MS390→C9300, MS410/420→C9300, MS425→C9300X, MG21→MG41, MG51→MG52, Z1/3→Z4, Z3C→Z4C

When you identify ANY EOL product, flag it using the compact format below (NO EOS dates, NO End-of-Support dates — those are only shown when explicitly requested). ALWAYS include both Option 1 (renewal, license-only) and Option 2 (hardware refresh with replacement hardware + all licenses). If any replacement switch has 1G/10G uplink variants, show Option 2 (1G Uplink) and Option 3 (10G Uplink). Flag ALL EOL products found regardless of whether they have a license overage — EOL status is based on the product family, not the license gap.

## AP MODEL DEFAULTS AND UPGRADE TIERS

### Antenna Suffix Defaults
- (I) Internal Antenna = DEFAULT for all APs unless otherwise specified
- (H) Hospitality = only when replacing another H-series AP or when specifically requested
- (E) External Antenna = when replacing an E-series AP or when requested. ALWAYS auto-add 2× MA-ANT-20 (omni-directional antenna) per AP, as external antenna APs do not include antennas. Notify the user: "ℹ️ External antenna model selected — 2× MA-ANT-20 (omni-directional) added per AP (antennas not included by default)."

### MR → Wi-Fi 7 Tier Mapping (use when user asks for "Wi-Fi 7 equivalent/upgrade")
- MR28 → CW9171I (entry)
- MR36 → CW9172I (mid-range)
- MR36H → CW9172H (hospitality)
- MR44 / MR46 → CW9174I (high-performance)
- MR46E → CW9174I + 2× MA-ANT-20 per AP (external antenna — see note above)
- MR57 / MR56 / MR52 / MR53 → CW9178I (top-tier)
- MR76 / MR78 → CW9179F (outdoor)
- MR86 → CW9179F (outdoor)

### Wi-Fi 6E: When user asks for "Wi-Fi 6E" without specifying a model, show all available internal antenna options: CW9162I (entry), CW9164I (mid), CW9166I (premium). If the context suggests external antenna, show CW9163E + MA-ANT-20.

### Wi-Fi 7: Default model is CW9172I (internal antenna, mid-range). When user asks for "Wi-Fi 7 AP" without specifying, use CW9172I. Only use CW9172H when replacing an H-series model or when explicitly requested.

### Upgrade Path Priority
Default EOL replacement = MR equivalent (same generation). When user asks for Wi-Fi 6E or Wi-Fi 7 equivalent, use the tier mapping above. When asked for just "upgrade" in the context of APs, default to MR replacement and mention Wi-Fi 7 as an option.

## CISCO SECURITY PRODUCTS (License-Only, No Hardware)
We also quote these Cisco security licenses. They are per-user, per-year licenses with NO hardware component:
- Duo MFA: LIC-DUO-ESSENTIALS, LIC-DUO-ADVANTAGE, LIC-DUO-PREMIER (1YR/3YR/5YR each)
- Umbrella DNS: LIC-UMB-DNS-ESS-K9, LIC-UMB-DNS-ADV-K9 (1YR/3YR/5YR each)
- Umbrella SIG: LIC-UMB-SIG-ESS-K9, LIC-UMB-SIG-ADV-K9 (1YR/3YR/5YR each)
When a user asks about Duo or Umbrella licensing, provide quote URLs with 1Y/3Y/5Y options just like hardware quotes.

## LICENSE DASHBOARD SCREENSHOT HANDLING
When a user sends a screenshot of a Meraki license dashboard, ALWAYS use this exact response format:

### If BOTH the license table AND device counts are visible:

**License Analysis:**
• {License Name}: {licensed count} licensed = {active count} active ✓   (if match)
• {License Name}: {licensed count} licensed, {active count} active — adjusted to {active count}   (if mismatch)
• {License Name}: 0 devices (skip from renewal)   (if zero active)
• MT: {count} devices (5 free licenses, {count-5} need licensing)   (if MT > 5)

Apply these mismatch rules:
1. MATCH (license limit = device count): Include at that count.
2. FEWER ACTIVE DEVICES: Include at the LOWER active device count.
3. ZERO ACTIVE DEVICES: REMOVE that license from the renewal.
4. MORE DEVICES THAN LICENSES: Include at the higher device count. Flag the overage.
5. MT SENSORS: Skip if 5 or fewer total. If more than 5, only license the overage (devices minus 5).

### If ONLY the license SKU table is visible (no device counts):
Quote the licenses EXACTLY as shown in the table. Do NOT ask for device counts. Generate renewal URLs immediately.

### After analysis, ALWAYS output in this format:

**Products End of Life:**
• {MODEL} (EOL) → Replacement: {REPLACEMENT MODEL}
(list ALL EOL products found — regardless of overage status. If replacement has 1G/10G variants: "→ Replacements: {MODEL-4G} (1G) / {MODEL-4X} (10G)")

**License Overages (if any):**
• {device}: licensed {X}, active {Y} — adjusted to {Y}

**Option 1 — Renew Existing Licenses:**

3-Year Co-Term: {URL with all license SKUs at determined quantities}

If ANY EOL products were found, ALWAYS include a refresh section without being asked:

**Option 2 — Hardware Refresh ({source}→{replacement} mappings):**

3-Year Co-Term: {URL with replacement hardware SKUs (-HW suffix) + ALL license SKUs including non-EOL ones}

CRITICAL DEDUP RULE: When multiple EOL models share the same replacement SKU, COMBINE their quantities into a single URL entry. Example: MS120-8FP ×26 + MS220-8P ×6 both map to MS130-8P → use MS130-8P-HW ×32 (NOT two separate MS130-8P-HW entries). Always sum quantities before building the URL.

The refresh option replaces EOL hardware with successors and carries over ALL other licenses from the renewal. If any replacement switch has 1G/10G uplink variants (4G/4X suffix), show Option 2 (1G Uplink) and Option 3 (10G Uplink). Only show 3-Year for dashboard screenshot responses unless user specifies otherwise.

## REFRESH / UPGRADE / HARDWARE UPGRADE SEMANTICS
When a user asks for a "refresh option" or "upgrade option" in the context of a renewal quote:
- This means a HARDWARE UPGRADE for End-of-Life equipment.
- Replace ALL EOL hardware with successors (not just one — check every product).
- Include the new hardware SKU with correct suffix (-HW for most, see suffix rules).
- ALWAYS carry over ALL other licenses from the original quote. If the original had MR ENT licenses, MS licenses, etc., include ALL of them in the refresh option.
- "Upgrade" does NOT mean changing the license tier (SEC→SDW) unless the user explicitly says "upgrade to SD-WAN" or "upgrade license".
- Label sections as Option 1 (renewal), Option 2 (refresh / 1G uplink), Option 3 (10G uplink when applicable). Never use "Option A" or "Option B".

## HARDWARE-ONLY MODE
When the user says "hardware only" or "hardware" (without asking about specs/info), they want ONLY hardware SKUs with NO licenses.
- ALWAYS apply the correct -HW suffix (e.g., Z4C → Z4C-HW, MX67 → MX67-HW).
- Output a single URL (no 1-Year/3-Year/5-Year breakdown since there are no licenses).

## Z-SERIES DEFAULT LICENSE TIER
Z4 and Z4C default to SEC (Advanced Security) licensing unless the user explicitly requests ENT (Enterprise).

## OUTPUT RULES
- For dashboard screenshots: show ONLY the 3-Year URL for all options. Never show 1-Year or 5-Year for dashboard analysis unless user explicitly requests it.
- For regular SKU quotes: always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term.
- URL-only output by default for simple quotes
- For dashboard screenshots, ALWAYS use the standardized format above
- Keep responses concise but complete — never skip EOL products
- NEVER use bullet points (•) before URLs. Just put the URL on its own line after the term label.
- Use bullet points (•) only for License Analysis sections, never for URLs
- NEVER include EOS dates, End-of-Support dates, or lifecycle dates in responses unless the user explicitly asks for EOL dates

## ACCESSORY & CONNECTIVITY GUIDANCE
When asked about SFPs, stacking cables, uplink modules, or how to connect two devices:
- If specific accessory data is injected below this prompt, use it as the authoritative source
- Both ends of a fiber link must match: same speed, same wavelength, same fiber type (MMF/SMF)
- 10G SFP+ ports accept 1G SFP modules (backward compatible). 25G SFP28 accepts 10G/1G.
- 1G SFP ports do NOT accept 10G SFP+ modules.
- MA-SFP-1GB-TX (copper SFP) is NOT supported on MS390, C9300, C9300X, C9300L
- C9300 and MS390 ship without uplink modules. Always ask about uplink needs.
- For stacking, recommend ring topology for production. Ring uses N cables for N switches.
- MS130 does NOT support physical stacking.
- C9300L requires a separate C9300L-STACK-KIT2-M stacking module per switch.
- Default cable recommendation: 1M length for same-rack. Note 50cm and 3M also available.
- When recommending SFPs, ask about fiber type (MMF/SMF) and distance if not specified.
- For same-rack 10G, DAC cables (MA-CBL-TA-1M) are cheapest. For >3m, use SFP+ optics.
- Include quote URLs for recommended accessories whenever possible.`;

// ─── Email Thread Parsing ────────────────────────────────────────────────────
/**
 * Detects if message contains email content (forwarded messages, threads, etc.)
 * Looks for patterns like "From:", "Subject:", "Forwarded message", email signatures
 */
function detectEmailContent(text) {
  const emailPatterns = [
    /^From:\s*.+?@.+?\s*$/m,           // From: name@domain.com
    /^Subject:\s*.+/m,                  // Subject: line
    /------+\s*Forwarded message/i,     // Gmail forwarded message separator
    /On\s+.+?[,.]?\s+.+?\s+wrote:/i,    // "On Mon, Jan 5, 2026 at 3:30 PM, John wrote:"
    />\s*On\s+.+?[,.]?\s+.+?\s+wrote:/i, // Quoted version
    />+\s*From:/,                        // Quoted From line
    /Sent\s+from\s+my\s+(iPhone|Android|device)/i, // Sent from signature
    /Best\s+regards|Kind\s+regards|Cheers|Thanks/i, // Email closings with quotes
    /^>\s{1,2}.+(@|From:|Subject:)/m,   // Multiple quoted lines starting with >
  ];

  return emailPatterns.some(pattern => pattern.test(text));
}

/**
 * Builds a specialized Claude prompt for extracting products from email
 */
function buildEmailParsingPrompt(emailText) {
  return `You are analyzing an email thread to extract Cisco/Meraki product requests.

## YOUR TASK
Extract ALL Cisco/Meraki products mentioned in the email. Return a JSON block with:
- items: array of {sku, quantity, context}
- summary: one-sentence summary of the request

## PRODUCT FAMILIES TO LOOK FOR
- **Access Points (AP)**: MR-series (MR36, MR44, MR46, MR57, etc.), CW-series (CW9166I, CW9172H, etc.)
- **Firewalls**: MX-series (MX67, MX85, MX95, etc.)
- **Switches**: MS150, MS390, C9300, C9300X, C9300L, C9200L
- **Cameras**: MV13, MV33, MV53X, MV63, MV73X, MV84X, MV93
- **Sensors**: MT10, MT14, MT20, MT40
- **Cellular Gateways**: MG21, MG41, MG51, MG52
- **Teleworker Gateways**: Z4, Z4C
- **Licenses**: Any mention of "license renewal", "co-term", "refresh", "support", "upgrade"

## QUANTITY INFERENCE
- "we need 50 APs for 50 classrooms" → {sku: "MR44", qty: 50}
- "replace 5 old MX64 units" → {sku: "MX85", qty: 5}
- Count actual device numbers if listed as a table or line-by-line list
- If no quantity is explicit, infer from context (number of sites, classrooms, offices, etc.)
- If still unclear, use qty: 1 as default

## CONTEXT EXTRACTION
Also identify:
- New deployment, refresh/replacement, expansion, license renewal, support renewal
- EOL product mentions (old models being replaced)
- Uplink requirements (1G, 4G, 10G)
- Hardware vs license vs both

## RETURN FORMAT
Return ONLY valid JSON like this (no markdown, no code fence):
{
  "items": [
    {"sku": "MR44", "qty": 10, "context": "new deployment for 10 classrooms"},
    {"sku": "MX85", "qty": 2, "context": "refresh from EOL MX64"}
  ],
  "summary": "Email requests 10 MR44 APs and 2 MX85 firewalls for campus refresh"
}

## CRITICAL RULES
- NEVER invent SKUs. Only use real Meraki model numbers.
- If you find a product mention but can't determine quantity, infer from surrounding context
- License mentions should be captured as the base hardware model (e.g., "MR44" not license SKU)
- Ignore signature lines, disclaimers, and non-product text

Here is the email to analyze:

${emailText}`;
}

/**
 * Process an email thread: detect products via Claude, then run through deterministic engine
 */
async function processEmailThread(text, personId, env, kv) {
  if (!env.ANTHROPIC_API_KEY) return null;

  try {
    // Use Claude to extract products from the email
    const prompt = buildEmailParsingPrompt(text);
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 512,
        system: 'You are a JSON extraction tool. Return ONLY valid JSON with no markdown or extra text.',
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      console.error('Email parsing: Claude API error', response.status);
      return null;
    }

    const data = await response.json();
    const rawJson = data.content[0].text.trim();

    // Parse JSON response
    let parsed;
    try {
      // Remove markdown code fence if present
      const jsonStr = rawJson.replace(/^```(?:json)?\n?|\n?```$/g, '').trim();
      parsed = JSON.parse(jsonStr);
    } catch (e) {
      console.error('Email parsing: JSON parse error', e.message);
      return null;
    }

    if (!parsed.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      return null;
    }

    // Build a quote request string from the extracted items
    // For each item: "quote {qty} {sku}"
    const quoteRequests = parsed.items
      .map(item => {
        const sku = (item.sku || '').toUpperCase().trim();
        const qty = item.qty || 1;
        return `${qty} ${sku}`;
      })
      .filter(Boolean);

    if (quoteRequests.length === 0) return null;

    const combinedRequest = `quote ${quoteRequests.join(', ')}`;

    // Run the combined request through the deterministic parser
    const parsed2 = parseMessage(combinedRequest);
    if (!parsed2) return null;

    const result = buildQuoteResponse(parsed2);
    if (!result.message) return null;

    // Build response: summary + quote URLs
    const emailSummary = parsed.summary || 'Email products extracted';
    const reply = `*Email Thread Analysis*\n\n${emailSummary}\n\n*Generated Quotes:*\n\n${result.message}`;

    return reply;
  } catch (err) {
    console.error('Email processing error:', err.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── CRM & EMAIL AGENT ENGINE (POC) ──────────────────────────────────────────
// Adds Zoho CRM and Gmail tool-use capabilities to the Claude fallback path.
// When a user message indicates CRM or email intent, Claude is given tools it
// can call in a loop until it produces a final text response.
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Google Chat Async Response (Service Account JWT) ─────────────────────────
// For CRM/email tool-use queries that exceed Google Chat's 30-second sync timeout,
// we return a quick "thinking" message synchronously and deliver the real answer
// via the Google Chat REST API using a service account bearer token.

/**
 * Base64url encode a buffer or string (no padding, URL-safe)
 */
function base64url(input) {
  const buf = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = '';
  for (const byte of buf) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Generate a Google Chat API access token using a GCP service account key.
 * The key must be stored as the worker secret GCP_SERVICE_ACCOUNT_KEY (JSON string).
 * Tokens are cached in KV for 50 minutes (they expire after 60).
 */
async function getGoogleChatBotToken(env) {
  const kv = env.CONVERSATION_KV;
  const cached = await kv.get('gchat_bot_token');
  if (cached) return cached;

  if (!env.GCP_SERVICE_ACCOUNT_KEY) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY secret not configured — cannot send async Google Chat messages');
  }

  let sa;
  try {
    sa = JSON.parse(env.GCP_SERVICE_ACCOUNT_KEY);
  } catch (e) {
    throw new Error('GCP_SERVICE_ACCOUNT_KEY is not valid JSON');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: sa.client_email,
    sub: sa.client_email,
    scope: 'https://www.googleapis.com/auth/chat.bot',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };

  const headerB64 = base64url(JSON.stringify(header));
  const payloadB64 = base64url(JSON.stringify(payload));
  const signingInput = `${headerB64}.${payloadB64}`;

  // Import the RSA private key (PEM -> CryptoKey)
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s/g, '');
  const keyBuf = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', keyBuf.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput)
  );

  const jwt = `${signingInput}.${base64url(signature)}`;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    }).toString()
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Google Chat token exchange failed: ${tokenRes.status} ${err}`);
  }

  const data = await tokenRes.json();
  if (!data.access_token) throw new Error('No access_token in Google Chat token response');

  // Cache for 50 minutes (tokens last 60 min)
  await kv.put('gchat_bot_token', data.access_token, { expirationTtl: 3000 });
  return data.access_token;
}

/**
 * Send a message to a Google Chat space via the REST API (async follow-up).
 * @param {string} spaceName - e.g. "spaces/AAAAxyz123"
 * @param {string} text - message text
 * @param {string|null} threadName - e.g. "spaces/AAAAxyz123/threads/abc" to reply in-thread
 * @param {object} env - worker env with secrets
 */
async function sendAsyncGChatMessage(spaceName, text, threadName, env) {
  const token = await getGoogleChatBotToken(env);

  const body = { text };
  if (threadName) {
    body.thread = { name: threadName };
  }

  // Use REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD so it threads when possible
  let url = `https://chat.googleapis.com/v1/${spaceName}/messages`;
  if (threadName) {
    url += '?messageReplyOption=REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD';
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`[GCHAT-ASYNC] Failed to send async message: ${res.status} ${err}`);
    throw new Error(`Google Chat API error: ${res.status} ${err}`);
  }

  console.log(`[GCHAT-ASYNC] Sent async message to ${spaceName}`);
  return await res.json();
}

// ─── Zoho OAuth Token Manager ─────────────────────────────────────────────────
// Caches access tokens in KV with TTL. Refreshes from client credentials.
async function getZohoAccessToken(env) {
  const kv = env.CONVERSATION_KV;
  // Check KV cache first
  const cached = await kv.get('zoho_access_token');
  if (cached) return cached;

  // Refresh from OAuth
  if (!env.ZOHO_CLIENT_ID || !env.ZOHO_CLIENT_SECRET || !env.ZOHO_REFRESH_TOKEN) {
    throw new Error('Zoho OAuth credentials not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
    refresh_token: env.ZOHO_REFRESH_TOKEN
  });

  const res = await fetch('https://accounts.zoho.com/oauth/v2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Zoho token refresh failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in Zoho response');

  // Cache for 50 minutes (tokens last 60 min)
  await kv.put('zoho_access_token', data.access_token, { expirationTtl: 3000 });
  return data.access_token;
}

// ─── Gmail OAuth Token Manager ────────────────────────────────────────────────
async function getGmailAccessToken(env) {
  const kv = env.CONVERSATION_KV;
  const cached = await kv.get('gmail_access_token');
  if (cached) return cached;

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET || !env.GOOGLE_REFRESH_TOKEN) {
    throw new Error('Gmail OAuth credentials not configured');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: env.GOOGLE_CLIENT_ID,
    client_secret: env.GOOGLE_CLIENT_SECRET,
    refresh_token: env.GOOGLE_REFRESH_TOKEN
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gmail token refresh failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in Gmail response');

  await kv.put('gmail_access_token', data.access_token, { expirationTtl: 3000 });
  return data.access_token;
}

// ─── Zoho CRM API Client ─────────────────────────────────────────────────────
async function zohoApiCall(method, path, env, body = null) {
  const token = await getZohoAccessToken(env);
  const url = `https://www.zohoapis.com/crm/v2/${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Zoho-oauthtoken ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text, status: res.status };
  }
}

// ─── Gmail API Client ─────────────────────────────────────────────────────────
async function gmailApiCall(method, path, env, body = null) {
  const token = await getGmailAccessToken(env);
  const url = `https://gmail.googleapis.com/gmail/v1/users/me/${path}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { error: text, status: res.status };
  }
}

// ─── CRM Validation Constants ─────────────────────────────────────────────────
const VALID_DEAL_STAGES = [
  'Qualification', 'Needs Analysis', 'Value Proposition', 'Identify Decision Makers',
  'Proposal/Price Quote', 'Negotiation/Review', 'Closed Won', 'Closed (Lost)',
  'Waiting on Customer', 'PO Received'
];
const VALID_LEAD_SOURCES = [
  'Stratus Referal', 'Meraki ISR Referal', 'Meraki ADR Referal', 'VDC', 'Website', 'PharosIQ'
];
const VALID_TASK_STATUSES = [
  'Not Started', 'Deferred', 'In Progress', 'Waiting for input', 'Completed'
];
const BLOCKED_STAGE_VALUES = ['Closed Won']; // Must be set by PO automation, never manually

// Common misspellings/wrong values → correct values for helpful error messages
const PICKLIST_CORRECTIONS = {
  'Closed Lost': 'Closed (Lost)',
  'Closed-Lost': 'Closed (Lost)',
  'closed lost': 'Closed (Lost)',
  'Referral': 'Stratus Referal',
  'Stratus Referral': 'Stratus Referal',
  'Meraki ISR Referral': 'Meraki ISR Referal',
  'Closed-Won': 'Closed Won',
  '-None-': null  // Should never be used for Lead_Source
};

/**
 * Validates picklist values before sending to Zoho.
 * Returns { valid: true } or { valid: false, error: 'message' }
 */
function validateCrmWrite(module_name, data, isCreate = false) {
  const errors = [];

  if (module_name === 'Deals') {
    // Stage validation
    if (data.Stage) {
      // Check for blocked values first
      if (BLOCKED_STAGE_VALUES.includes(data.Stage)) {
        errors.push(`❌ Stage "${data.Stage}" cannot be set manually. Deals auto-close to Closed Won when a PO (Sales_Order) is attached.`);
      }
      // Check for common misspellings
      else if (PICKLIST_CORRECTIONS[data.Stage] !== undefined) {
        const correction = PICKLIST_CORRECTIONS[data.Stage];
        errors.push(`❌ Invalid Stage "${data.Stage}". Did you mean "${correction}"?`);
      }
      // Check against valid values
      else if (!VALID_DEAL_STAGES.includes(data.Stage)) {
        errors.push(`❌ Invalid Stage "${data.Stage}". Valid options: ${VALID_DEAL_STAGES.join(', ')}`);
      }
    }

    // Lead_Source validation
    if (data.Lead_Source) {
      if (data.Lead_Source === '-None-') {
        errors.push('❌ Lead_Source cannot be "-None-". Use "Stratus Referal" as default or specify the correct source.');
      } else if (PICKLIST_CORRECTIONS[data.Lead_Source] !== undefined) {
        const correction = PICKLIST_CORRECTIONS[data.Lead_Source];
        errors.push(`❌ Invalid Lead_Source "${data.Lead_Source}". Did you mean "${correction}"?`);
      } else if (!VALID_LEAD_SOURCES.includes(data.Lead_Source)) {
        errors.push(`❌ Invalid Lead_Source "${data.Lead_Source}". Valid options: ${VALID_LEAD_SOURCES.join(', ')}`);
      }
    }

    // Required fields on create
    if (isCreate) {
      const required = ['Deal_Name', 'Stage', 'Lead_Source', 'Owner', 'Closing_Date'];
      for (const field of required) {
        if (!data[field]) {
          errors.push(`❌ Missing required field "${field}" for Deal creation.`);
        }
      }
    }
  }

  if (module_name === 'Tasks') {
    if (data.Status) {
      if (!VALID_TASK_STATUSES.includes(data.Status)) {
        errors.push(`❌ Invalid Task Status "${data.Status}". Valid options: ${VALID_TASK_STATUSES.join(', ')}`);
      }
    }
  }

  if (module_name === 'Quotes' && isCreate) {
    const required = ['Subject', 'Deal_Name', 'Valid_Till'];
    for (const field of required) {
      if (!data[field]) {
        errors.push(`❌ Missing required field "${field}" for Quote creation.`);
      }
    }
  }

  return errors.length > 0
    ? { valid: false, error: errors.join('\n') }
    : { valid: true };
}

/**
 * Parse Zoho API response into a clear success/failure message.
 */
function parseZohoResponse(result, action = 'operation') {
  // Handle raw error responses
  if (result.error) {
    return { success: false, message: `Zoho API error: ${result.error}`, data: result };
  }

  // Handle standard Zoho response format
  if (result.data && Array.isArray(result.data)) {
    const record = result.data[0];
    if (record.code === 'SUCCESS') {
      return {
        success: true,
        message: `✅ ${action} successful.`,
        record_id: record.details?.id,
        data: record
      };
    } else {
      const detail = record.details
        ? Object.entries(record.details).map(([k,v]) => `${k}: ${JSON.stringify(v)}`).join(', ')
        : '';
      return {
        success: false,
        message: `❌ ${action} failed: ${record.code} — ${record.message || ''}${detail ? ` (${detail})` : ''}`,
        data: record
      };
    }
  }

  // Fallback — return as-is but flag if it looks like an error
  if (result.status && result.status >= 400) {
    return { success: false, message: `Zoho API returned status ${result.status}`, data: result };
  }

  return { success: true, message: `✅ ${action} completed.`, data: result };
}

// ─── Tool Execution Router ────────────────────────────────────────────────────
async function executeToolCall(toolName, toolInput, env) {
  try {
    switch (toolName) {
      // ── Zoho CRM Tools ──
      case 'zoho_search_records': {
        const { module_name, criteria, fields, page, per_page } = toolInput;
        const params = new URLSearchParams();
        if (criteria) params.set('criteria', criteria);
        // Default fields per module to reduce response size (saves 2-3s per iteration)
        const defaultFields = {
          Accounts: 'id,Account_Name,Phone,Website',
          Contacts: 'id,First_Name,Last_Name,Email,Phone,Account_Name',
          Deals: 'id,Deal_Name,Stage,Amount,Closing_Date,Account_Name,Contact_Name,Owner',
          Products: 'id,Product_Name,Product_Code,Unit_Price,Description',
          Quotes: 'id,Subject,Quote_Number,Grand_Total,Deal_Name,Stage',
          Tasks: 'id,Subject,Status,Due_Date,What_Id,Who_Id,Description'
        };
        params.set('fields', fields || defaultFields[module_name] || '');
        if (page) params.set('page', String(page));
        if (per_page) params.set('per_page', String(per_page));
        return await zohoApiCall('GET', `${module_name}/search?${params}`, env);
      }

      case 'zoho_get_record': {
        const { module_name, record_id, fields } = toolInput;
        const params = fields ? `?fields=${fields}` : '';
        return await zohoApiCall('GET', `${module_name}/${record_id}${params}`, env);
      }

      case 'zoho_create_record': {
        const { module_name, data } = toolInput;
        const recordData = Array.isArray(data) ? data[0] : data;
        // Pre-flight validation
        const createCheck = validateCrmWrite(module_name, recordData, true);
        if (!createCheck.valid) {
          return { validation_error: true, message: createCheck.error, action: 'create_blocked' };
        }
        const createResult = await zohoApiCall('POST', module_name, env, { data: [recordData] });
        return parseZohoResponse(createResult, `${module_name} record creation`);
      }

      case 'zoho_update_record': {
        const { module_name, record_id, data } = toolInput;
        // Pre-flight validation
        const updateCheck = validateCrmWrite(module_name, data, false);
        if (!updateCheck.valid) {
          return { validation_error: true, message: updateCheck.error, action: 'update_blocked' };
        }
        const updateResult = await zohoApiCall('PUT', `${module_name}/${record_id}`, env, { data: [data] });
        return parseZohoResponse(updateResult, `${module_name} record update`);
      }

      case 'zoho_get_related_records': {
        const { module_name, record_id, related_module, fields } = toolInput;
        const params = fields ? `?fields=${fields}` : '';
        return await zohoApiCall('GET', `${module_name}/${record_id}/${related_module}${params}`, env);
      }

      case 'zoho_get_field': {
        const { module_name, field_name } = toolInput;
        return await zohoApiCall('GET', `settings/fields?module=${module_name}&field_api_name=${field_name}`, env);
      }

      case 'zoho_coql_query': {
        const { query } = toolInput;
        return await zohoApiCall('POST', 'coql', env, { select_query: query });
      }

      // ── Web Enrichment Tools ──
      case 'web_search_domain': {
        const { domain } = toolInput;
        try {
          // Try fetching the domain homepage with a short timeout
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5000);
          const url = `https://${domain.replace(/^(https?:\/\/)?(www\.)?/, '')}`;
          const res = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (compatible; StratusBot/1.0)',
              'Accept': 'text/html'
            },
            signal: controller.signal,
            redirect: 'follow'
          });
          clearTimeout(timeoutId);
          const html = await res.text();
          // Extract useful metadata from the page
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([\s\S]*?)["']/i)
            || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*name=["']description["']/i);
          const ogNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([\s\S]*?)["']/i)
            || html.match(/<meta[^>]*content=["']([\s\S]*?)["'][^>]*property=["']og:site_name["']/i);
          // Try to find address in structured data
          const addressMatch = html.match(/"streetAddress"\s*:\s*"([^"]+)"/i);
          const cityMatch = html.match(/"addressLocality"\s*:\s*"([^"]+)"/i);
          const stateMatch = html.match(/"addressRegion"\s*:\s*"([^"]+)"/i);
          const zipMatch = html.match(/"postalCode"\s*:\s*"([^"]+)"/i);
          // Extract visible text from body for Claude to analyze (limited)
          const bodyText = html
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .substring(0, 3000);
          return {
            domain: domain,
            url: url,
            status: res.status,
            title: titleMatch ? titleMatch[1].trim() : null,
            description: descMatch ? descMatch[1].trim() : null,
            site_name: ogNameMatch ? ogNameMatch[1].trim() : null,
            structured_address: (addressMatch || cityMatch) ? {
              street: addressMatch ? addressMatch[1] : null,
              city: cityMatch ? cityMatch[1] : null,
              state: stateMatch ? stateMatch[1] : null,
              zip: zipMatch ? zipMatch[1] : null
            } : null,
            page_text_preview: bodyText
          };
        } catch (e) {
          return {
            domain: domain,
            error: `Could not fetch domain: ${e.message}`,
            suggestion: 'Try inferring the business name from the email signature or ask the user for the company details.'
          };
        }
      }

      // ── Gmail Tools ──
      case 'gmail_search_messages': {
        const { query, max_results } = toolInput;
        const params = new URLSearchParams({ q: query, maxResults: String(max_results || 10) });
        return await gmailApiCall('GET', `messages?${params}`, env);
      }

      case 'gmail_read_message': {
        const { message_id, format } = toolInput;
        const params = format ? `?format=${format}` : '?format=full';
        const data = await gmailApiCall('GET', `messages/${message_id}${params}`, env);
        // Extract readable content from the response
        if (data.payload) {
          const headers = (data.payload.headers || []).reduce((acc, h) => {
            acc[h.name.toLowerCase()] = h.value;
            return acc;
          }, {});
          let body = '';
          if (data.payload.body?.data) {
            body = atob(data.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
          } else if (data.payload.parts) {
            const textPart = data.payload.parts.find(p => p.mimeType === 'text/plain');
            if (textPart?.body?.data) {
              body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
            }
          }
          return {
            id: data.id,
            threadId: data.threadId,
            from: headers.from || '',
            to: headers.to || '',
            cc: headers.cc || '',
            subject: headers.subject || '',
            date: headers.date || '',
            snippet: data.snippet || '',
            body: body.substring(0, 3000) // Truncate to save tokens
          };
        }
        return data;
      }

      case 'gmail_read_thread': {
        const { thread_id } = toolInput;
        const data = await gmailApiCall('GET', `threads/${thread_id}?format=full`, env);
        if (data.messages) {
          return {
            id: data.id,
            message_count: data.messages.length,
            messages: data.messages.map(msg => {
              const headers = (msg.payload?.headers || []).reduce((acc, h) => {
                acc[h.name.toLowerCase()] = h.value;
                return acc;
              }, {});
              let body = '';
              if (msg.payload?.body?.data) {
                body = atob(msg.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
              } else if (msg.payload?.parts) {
                const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
                if (textPart?.body?.data) {
                  body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
                }
              }
              return {
                id: msg.id,
                from: headers.from || '',
                to: headers.to || '',
                subject: headers.subject || '',
                date: headers.date || '',
                snippet: msg.snippet || '',
                body: body.substring(0, 2000)
              };
            })
          };
        }
        return data;
      }

      case 'gmail_create_draft': {
        const { to, subject, body, cc, bcc, in_reply_to, thread_id } = toolInput;
        // Build RFC 2822 message
        let raw = `To: ${to}\r\n`;
        if (cc) raw += `Cc: ${cc}\r\n`;
        if (bcc) raw += `Bcc: ${bcc}\r\n`;
        raw += `Subject: ${subject}\r\n`;
        if (in_reply_to) raw += `In-Reply-To: ${in_reply_to}\r\nReferences: ${in_reply_to}\r\n`;
        raw += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
        raw += body;
        // Base64url encode
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const draftBody = { message: { raw: encoded } };
        if (thread_id) draftBody.message.threadId = thread_id;
        return await gmailApiCall('POST', 'drafts', env, draftBody);
      }

      case 'gmail_send_email': {
        const { to, subject, body, cc, bcc, in_reply_to, thread_id } = toolInput;
        let raw = `To: ${to}\r\n`;
        if (cc) raw += `Cc: ${cc}\r\n`;
        if (bcc) raw += `Bcc: ${bcc}\r\n`;
        raw += `Subject: ${subject}\r\n`;
        if (in_reply_to) raw += `In-Reply-To: ${in_reply_to}\r\nReferences: ${in_reply_to}\r\n`;
        raw += `Content-Type: text/plain; charset=UTF-8\r\n\r\n`;
        raw += body;
        const encoded = btoa(unescape(encodeURIComponent(raw)))
          .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const sendBody = { raw: encoded };
        if (thread_id) sendBody.threadId = thread_id;
        return await gmailApiCall('POST', 'messages/send', env, sendBody);
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Tool Definitions for Claude API ──────────────────────────────────────────
const CRM_EMAIL_TOOLS = [
  // Zoho CRM
  {
    name: 'zoho_search_records',
    description: 'Search Zoho CRM records in any module (Deals, Quotes, Contacts, Accounts, Tasks, Products, Sales_Orders, Invoices). Uses COQL criteria syntax like (Account_Name:equals:Acme Corp) or (Stage:equals:Qualification). Multiple criteria joined with "and"/"or".',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'CRM module API name: Deals, Quotes, Contacts, Accounts, Tasks, Products, Sales_Orders, Invoices' },
        criteria: { type: 'string', description: 'COQL criteria string. Example: (Owner:equals:2570562000141711002) and (Stage:not_equals:Closed Won)' },
        fields: { type: 'string', description: 'Comma-separated field API names to return. Example: id,Deal_Name,Stage,Amount,Account_Name' },
        page: { type: 'number', description: 'Page number (default 1)' },
        per_page: { type: 'number', description: 'Records per page (max 200, default 20)' }
      },
      required: ['module_name', 'criteria']
    }
  },
  {
    name: 'zoho_get_record',
    description: 'Get a specific Zoho CRM record by its ID. Returns full record details.',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'CRM module API name' },
        record_id: { type: 'string', description: 'Record ID (numeric string)' },
        fields: { type: 'string', description: 'Optional comma-separated fields to return' }
      },
      required: ['module_name', 'record_id']
    }
  },
  {
    name: 'zoho_create_record',
    description: 'Create a new record in Zoho CRM. Server-side validation enforces required fields: Deals need Deal_Name, Stage, Lead_Source, Owner, Closing_Date. Quotes need Subject, Deal_Name, Valid_Till. Invalid picklist values are blocked before reaching Zoho. Response includes clear success/failure status.',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'CRM module API name' },
        data: { type: 'object', description: 'Record data object with field API names as keys' }
      },
      required: ['module_name', 'data']
    }
  },
  {
    name: 'zoho_update_record',
    description: 'Update an existing Zoho CRM record. Stage changes ARE supported (e.g., Qualification → Proposal/Price Quote, Negotiation/Review → Closed (Lost)). Server-side validation prevents invalid picklist values. Only "Closed Won" is blocked — deals auto-close when a PO is attached.',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'CRM module API name' },
        record_id: { type: 'string', description: 'Record ID to update' },
        data: { type: 'object', description: 'Fields to update' }
      },
      required: ['module_name', 'record_id', 'data']
    }
  },
  {
    name: 'zoho_get_related_records',
    description: 'Get records related to a parent record (e.g., Quotes under a Deal, Tasks linked to a Deal, Contacts under an Account).',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'Parent module API name' },
        record_id: { type: 'string', description: 'Parent record ID' },
        related_module: { type: 'string', description: 'Related module API name (Quotes, Tasks, Contacts, etc.)' },
        fields: { type: 'string', description: 'Optional fields to return' }
      },
      required: ['module_name', 'record_id', 'related_module']
    }
  },
  {
    name: 'zoho_get_field',
    description: 'Get field metadata including picklist values. Use this to validate Stage values before creating/updating Deals.',
    input_schema: {
      type: 'object',
      properties: {
        module_name: { type: 'string', description: 'Module API name' },
        field_name: { type: 'string', description: 'Field API name (e.g., Stage, Lead_Source)' }
      },
      required: ['module_name', 'field_name']
    }
  },
  {
    name: 'zoho_coql_query',
    description: 'Execute a COQL (CRM Object Query Language) query. Example: "select Deal_Name, Amount, Stage from Deals where Owner = 2570562000141711002 and Stage != \'Closed Won\' limit 20"',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'COQL SELECT query string' }
      },
      required: ['query']
    }
  },
  // Web enrichment
  {
    name: 'web_search_domain',
    description: 'Look up a company by its email domain (e.g., "acme.com"). Fetches the domain homepage to extract business name, address, and description. Use this when a customer emails from an unknown domain and you need to identify the business for Zoho Account creation. Returns extracted metadata or raw page content for analysis.',
    input_schema: {
      type: 'object',
      properties: {
        domain: { type: 'string', description: 'The email domain to look up (e.g., "riverside.k12.wi.us", "acmecorp.com"). Do NOT include "www." or "https://".' }
      },
      required: ['domain']
    }
  },
  // Gmail
  {
    name: 'gmail_search_messages',
    description: 'Search Gmail messages using Gmail search syntax. Examples: "from:john@acme.com", "subject:quote request", "to:me is:unread", "from:customer after:2026/01/01"',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Gmail search query string' },
        max_results: { type: 'number', description: 'Maximum messages to return (default 10, max 50)' }
      },
      required: ['query']
    }
  },
  {
    name: 'gmail_read_message',
    description: 'Read a specific Gmail message by ID. Returns from, to, cc, subject, date, and body text (truncated to 3000 chars).',
    input_schema: {
      type: 'object',
      properties: {
        message_id: { type: 'string', description: 'Gmail message ID from search results' },
        format: { type: 'string', description: 'Response format: full (default), metadata, minimal' }
      },
      required: ['message_id']
    }
  },
  {
    name: 'gmail_read_thread',
    description: 'Read an entire Gmail thread (all messages in a conversation). Returns all messages with from, to, subject, date, and body.',
    input_schema: {
      type: 'object',
      properties: {
        thread_id: { type: 'string', description: 'Gmail thread ID' }
      },
      required: ['thread_id']
    }
  },
  {
    name: 'gmail_create_draft',
    description: 'Create a Gmail draft reply or new email. The draft will appear in the user\'s Drafts folder for review before sending. Use this for composing email responses.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address(es), comma-separated' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Plain text email body. Use blank lines between paragraphs.' },
        cc: { type: 'string', description: 'CC recipients (optional)' },
        bcc: { type: 'string', description: 'BCC recipients (optional)' },
        in_reply_to: { type: 'string', description: 'Message-ID header of the email being replied to (for threading)' },
        thread_id: { type: 'string', description: 'Gmail thread ID to attach this draft to' }
      },
      required: ['to', 'subject', 'body']
    }
  },
  {
    name: 'gmail_send_email',
    description: 'Send an email directly via Gmail. WARNING: Only use after explicit user approval. Prefer gmail_create_draft for composing responses, then send only after review.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Recipient email address(es)' },
        subject: { type: 'string', description: 'Email subject line' },
        body: { type: 'string', description: 'Plain text email body' },
        cc: { type: 'string', description: 'CC recipients (optional)' },
        bcc: { type: 'string', description: 'BCC recipients (optional)' },
        in_reply_to: { type: 'string', description: 'Message-ID for threading' },
        thread_id: { type: 'string', description: 'Gmail thread ID for threading' }
      },
      required: ['to', 'subject', 'body']
    }
  }
];

// ─── CRM/Email Intent Detection ──────────────────────────────────────────────
function detectCrmEmailIntent(text) {
  const lower = text.toLowerCase();

  // CRM intents
  const crmPatterns = [
    /\b(create|new|add)\s+(a\s+)?(deal|quote|task|contact|account)/i,
    /\b(update|edit|change|modify)\s+(the\s+)?(deal|quote|task|contact|account)/i,
    /\b(search|find|look\s*up|pull\s*up|get|show)\s+(me\s+)?(the\s+)?(deal|quote|task|contact|account|customer|client)/i,
    /\b(close|complete|finish)\s+(the\s+)?(task|deal)/i,
    /\b(what|when|how\s+many|how\s+much|who)\s+.*(deal|quote|customer|account|order|invoice|pipeline)/i,
    /\bzoho\b/i,
    /\bcrm\b/i,
    /\b(pipeline|forecast|revenue|stage|closed\s+won|qualification)/i,
    /\blast\s+(time|order|purchase|quote)\b/i,
    /\b(open\s+deals|my\s+deals|active\s+deals|pending\s+tasks|overdue\s+tasks)/i,
    // New customer intake workflow triggers
    /\bnew\s+customer\b/i,
    /\b(process|intake|onboard)\s+(this\s+)?(email|lead|customer|request|inquiry)/i,
    /\b(set\s*up|build\s*out|create\s+everything)\s+(for|from)\s+(this|the)/i,
    /\b(got|received|have)\s+(a|an)\s+(email|inquiry|request)\s+(from|about)\s+(a\s+)?(new|potential|prospective)/i,
    /\b(customer|prospect|lead)\s+(email|inquiry|request)\b.*\b(quote|meraki|cisco|network)/i,
  ];

  // Email intents
  const emailPatterns = [
    /\b(email|draft|send|reply|compose|write)\s+(an?\s+)?(email|message|response|follow[\s-]?up)/i,
    /\b(check|read|search|find|look\s*up|summarize|sum up|review)\s+(my\s+)?(this\s+)?(email|inbox|gmail|thread|conversation)/i,
    /\b(what|any)\s+.{0,30}(email|message|inbox)/i,       // "whats my most recent email", "what new emails", etc.
    /\b(my|the|latest|last|recent|newest|most\s+recent)\s+(email|emails|message|messages)/i,  // "my most recent email", "latest email"
    /\b(respond|reply)\s+to\s+/i,
    /\bemail\s+(from|to|about|regarding)/i,
    /\bdraft\b.{0,20}\b(email|response|reply|message)/i,  // "draft an email response to..."
    /\bgmail\b/i,
    /\binbox\b/i,
    /\b(email|mail)\s+(connected|setup|working|access)/i,  // "is email connected?"
    /\bsummarize\s+(this\s+)?(thread|email|conversation|message)/i,  // "summarize this thread"
    /\b(RE|FW|Fwd):\s+/,  // Forwarded/replied subject lines indicate email context
    /\bsubject\s*(line|:)/i,  // References to email subject lines
    /\bsearch\s+(for\s+)?(the\s+)?(email|thread|message)/i,  // "search for the email"
  ];

  const hasCrm = crmPatterns.some(p => p.test(text));
  const hasEmail = emailPatterns.some(p => p.test(text));

  return { hasCrm, hasEmail, hasAny: hasCrm || hasEmail };
}

// ─── CRM System Prompt Extension ─────────────────────────────────────────────
const CRM_SYSTEM_PROMPT = `

## CRM & EMAIL ASSISTANT MODE

You now have access to Zoho CRM and Gmail tools. Use them to help with CRM and email tasks.

### ZOHO CRM CONTEXT
- Org ID: org647122552
- CRM link format: https://crm.zoho.com/crm/org647122552/tab/{MODULE}/{RECORD_ID}
- Owner default: Chris Graves — ID 2570562000141711002
- Always filter queries by Owner = 2570562000141711002 unless told otherwise

---

## CLARIFYING QUESTIONS — ASK BEFORE CREATING

Before creating any Deal or Quote, you MUST have all required fields. If anything is missing, STOP and ask the user in a single friendly message. Do not guess or proceed with placeholders.

Info needed for a Quote (gather all in one ask if missing):
- Company name (Account)
- Contact name
- Products / SKUs and quantities
- Any Cisco rep involvement? (determines Lead_Source)
- Billing address (look up in Zoho Account first, then Gmail thread, then ask)

Example: "To build this quote in Zoho I need a couple details — what's the company and contact name? And do you have a specific SKU list?"

---

## PRE-CREATION VALIDATION TABLE (MANDATORY)

Before calling zoho_create_record for ANY Deal or Quote, display a validation table and wait for confirmation. Stop if any required field is missing or marked ⚠.

Deal validation example:
\`\`\`
PRE-CREATION VALIDATION (DEAL):
| Field        | Value                   | Status       |
|--------------|-------------------------|--------------|
| Deal_Name    | Acme - MR44 Refresh     | ✓            |
| Account_Name | Acme Corp               | ✓            |
| Contact_Name | John Smith              | ✓            |
| Stage        | Qualification           | ✓ (default)  |
| Lead_Source  | Stratus Referal         | ✓ (default)  |
| Meraki_ISR   | Stratus Sales           | ✓ (default)  |
| Closing_Date | 2026-04-26              | ✓ (today+30) |
\`\`\`

Quote validation example:
\`\`\`
PRE-CREATION VALIDATION (QUOTE):
| Field              | Value                | Status       |
|--------------------|----------------------|--------------|
| Subject            | Acme - 10x MR44      | ✓            |
| Deal_Name          | Acme - MR44 Refresh  | ✓            |
| Contact_Name       | John Smith           | ✓            |
| Valid_Till         | 2026-04-26           | ✓ (today+30) |
| Cisco_Billing_Term | Prepaid Term         | ✓ (default)  |
| Billing_Street     | 500 Industrial Blvd  | ✓ (Account)  |
| Billing_City       | Milwaukee            | ✓            |
| Billing_State      | WI                   | ✓            |
| Billing_Code       | 53202                | ✓            |
| Billing_Country    | US                   | ✓ (default)  |
| Shipping_Country   | US                   | ✓ (default)  |
| Line Items         | 10x MR44-HW + lic    | ✓            |
\`\`\`

If ANY field is ⚠ or missing → STOP and resolve before creating.
Show BOTH tables when creating a Deal and Quote in the same workflow.

---

## DEAL CREATION — COMPLETE REQUIRED PAYLOAD

Every Deal Create call MUST include ALL of these fields:
\`\`\`json
{
  "Deal_Name": "{Account} - {Description}",
  "Account_Name": {"id": "{account_id}"},
  "Contact_Name": {"id": "{contact_id}"},
  "Stage": "Qualification",
  "Lead_Source": "Stratus Referal",
  "Closing_Date": "{YYYY-MM-DD, today + 30 days}",
  "Amount": 0,
  "Meraki_ISR": {"id": "2570562000027286729"},
  "Owner": {"id": "2570562000141711002"}
}
\`\`\`
Closing_Date: calculate dynamically as today + 30 days, YYYY-MM-DD format.
Never set Stage to "Closed Won" manually — deals auto-close when a PO is attached.

---

## QUOTE CREATION — COMPLETE REQUIRED PAYLOAD

Every Quote Create call MUST include ALL of these fields:
\`\`\`json
{
  "Subject": "{Account} - {Description}",
  "Deal_Name": {"id": "{deal_id}"},
  "Account_Name": {"id": "{account_id}"},
  "Contact_Name": {"id": "{contact_id}"},
  "Valid_Till": "{YYYY-MM-DD, today + 30 days}",
  "Cisco_Billing_Term": "Prepaid Term",
  "Billing_Street": "{from Account record or lookup}",
  "Billing_City": "{from Account record or lookup}",
  "Billing_State": "{2-LETTER STATE CODE}",
  "Billing_Code": "{zip code}",
  "Billing_Country": "US",
  "Shipping_Country": "US",
  "Owner": {"id": "2570562000141711002"},
  "Quoted_Items": [
    {"Quantity": 1, "Product_Name": {"id": "{zoho_product_id}"}, "Discount": 0}
  ]
}
\`\`\`

Billing address lookup order: (1) Zoho Account record fields → (2) Gmail thread/email signature → (3) Ask user. Never create a Quote with blank address fields.

---

## LEAD SOURCE & MERAKI ISR LOGIC

Lead_Source valid values ONLY — "Referal" spelled with ONE R (intentional):
- "Stratus Referal" — DEFAULT for 99% of deals
- "Meraki ISR Referal" — Cisco rep referred the opportunity
- "Meraki ADR Referal" — ADR involved (prompt for ADR name)
- "VDC" — VDC lead
- "Website" — website inquiry
- NEVER use "-None-", never create new picklist values

Meraki_ISR defaults:
- Lead_Source = Stratus Referal / Website / VDC → Meraki_ISR = Stratus Sales (ID: 2570562000027286729)
- Lead_Source = Meraki ISR Referal → Meraki_ISR = REQUIRED (ask for rep name), Reason = "Meraki ISR recommended"
- Lead_Source = Meraki ADR Referal → prompt for ADR name

Proceed-first rule: Create with Stratus Referal + Stratus Sales defaults. Ask about Cisco rep involvement AFTER creation unless a rep is obviously mentioned up front.

---

## ECOMM PRICING — EVERY QUOTE

Never create a quote at list price. Apply Stratus ecomm pricing on every line:
1. Search WooProducts module: criteria (WooProduct_Code:equals:{SKU}), fields: WooProduct_Code,Stratus_Price
2. Discount per line = (List_Price − Stratus_Price) × Quantity  ← dollar amount, not percent
3. Include Description = "{XX}% discount applied" on each line

Zoho auto-populates List_Price from the Product record. Only send Product_Name.id, Quantity, Discount, Description per line item.

---

## PICKLIST PROTECTION

NEVER create new dropdown values — Zoho silently accepts invalid values and creates duplicates.
- WRONG: "Closed Lost" → CORRECT: "Closed (Lost)" with parentheses
- WRONG: "Referral" → CORRECT: "Stratus Referal" (one R)
- Always validate Stage live via zoho_get_field before any Stage write
- Lead_Source is stable — use the cached list above

---

## TASK RULES

- All active deals MUST have at least one open follow-up task
- Default follow-up: 3 business days out, skip weekends
- Before closing a task on an active deal, check for successor tasks
- Every new Deal MUST have a follow-up task created as the FINAL step before reporting done

---

## EMAIL RULES

- Always create a Gmail draft first (gmail_create_draft) — NEVER send without approval
- Blank line between every paragraph
- Sign as: Chris Graves, Regional Sales Director, Stratus Information Systems
- Voice: friendly, consultative, concise. End every customer email with a question or CTA.

---

## GMAIL SEARCH TIPS
- Sender: from:john@acme.com  |  Subject: subject:"quote"  |  Date: after:2026/01/01

---

## NEW CUSTOMER EMAIL INTAKE WORKFLOW

When the user says "new customer", "process this email", "intake this lead", or references a customer email that needs CRM setup, follow this structured workflow:

### PHASE 1 — EMAIL DISCOVERY & ANALYSIS
1. Search Gmail to find the referenced email. Use context clues: sender name, company name, subject keywords, or recency ("the last email from...").
2. Once found, read the FULL THREAD (gmail_read_thread), not just the single message.
3. Extract and summarize:
   - What the customer is asking for (products, services, timeline)
   - Any specific Cisco/Meraki products mentioned
   - Budget indicators or project scope
   - Timeline or urgency signals

### PHASE 2 — PRODUCT DETERMINATION
Map the customer's needs to specific Cisco/Meraki SKUs:
- If specific models are mentioned, validate them against the product catalog
- If the request is vague (e.g., "we need better Wi-Fi"), recommend appropriate products based on context:
  - Office Wi-Fi: MR57 (high-density) or CW9166I (Wi-Fi 6E standard)
  - Switches: MS150 series (access), MS450 (aggregation)
  - Security: MX series based on user count (MX75 for <200, MX85 for <500, MX95 for <1000)
  - Cameras: MV2, MV12, MV72 based on indoor/outdoor
- Always include appropriate licenses (LIC-ENT for APs, LIC-SEC for MX, LIC-MS for switches)
- Flag products as "placeholder — needs refinement" if you're making assumptions

### PHASE 3 — CONTACT IDENTIFICATION
Extract the primary contact from the email thread:
- Full name (First_Name, Last_Name)
- Email address
- Phone number (check email signatures)
- Title/role (check email signatures)
- If multiple people are in the thread, identify the decision-maker or primary requester

### PHASE 4 — BUSINESS IDENTIFICATION & ENRICHMENT
Determine the business/organization:
1. Check the email signature for company name, address, phone
2. If not clear from the signature, extract the email domain (e.g., user@riverside.k12.wi.us → riverside.k12.wi.us)
3. Use web_search_domain to look up the domain and extract:
   - Business/organization name
   - Street address, city, state, zip
   - Type of business (school district, healthcare, enterprise, etc.)
4. Search Zoho CRM to check if this Account already exists:
   - zoho_search_records in Accounts with criteria matching the company name or domain
   - Also search Contacts for the email address
5. If Account exists → use existing Account ID (do NOT create duplicate)
6. If Account is new → prepare to create it with all discovered info

### PHASE 5 — CONFIRMATION GATE (MANDATORY)
Before creating ANY records, present a complete summary for approval:

\`\`\`
📋 NEW CUSTOMER INTAKE SUMMARY

📧 Email Thread: [subject line]
From: [sender name] <[email]>

🏢 Account: [Business Name] [NEW or EXISTING - link]
   Address: [street, city, state zip]

👤 Contact: [Full Name] [NEW or EXISTING - link]
   Email: [email] | Phone: [phone] | Title: [title]

💼 Deal: [Account] - [Description]
   Stage: Qualification | Lead Source: Stratus Referal
   Meraki ISR: Stratus Sales

📦 Products (Quote):
   [qty]x [SKU] - [description] [placeholder?]
   [qty]x [SKU] - [description]
   ...

⏭️ Ready to create: Account → Contact → Deal → Quote → Follow-up Task

Proceed? (or tell me what to adjust)
\`\`\`

WAIT for user confirmation before proceeding. If anything is marked as placeholder or uncertain, highlight it clearly.

### PHASE 6 — CRM RECORD CREATION CHAIN
After user confirms, execute in this exact order:
1. Create Account (if new) — include name, address, phone, website
2. Create Contact — link to Account via Account_Name.id
3. Create Deal — link to Account and Contact, use defaults:
   - Stage: "Qualification"
   - Lead_Source: "Stratus Referal"
   - Meraki_ISR: Stratus Sales (ID: 2570562000027286729)
   - Owner: Chris Graves (ID: 2570562000141711002)
   - Closing_Date: today + 30 days
4. Create Quote — link to Deal, include:
   - Product line items with ecomm pricing (look up WooProducts for Stratus_Price)
   - Billing address from Account
   - Valid_Till: today + 30 days
5. Create follow-up Task on the Deal — due in 3 business days
6. Report all created records with Zoho links

### PHASE 7 — OPTIONAL: DRAFT REPLY
After CRM setup is complete, offer to draft a reply to the original email thread:
- Reference the customer's request
- Let them know you're working on their quote
- Ask any clarifying questions that came up
- Create as gmail_create_draft (never auto-send)

---

## RESPONSE FORMAT
- Link every Zoho record: https://crm.zoho.com/crm/org647122552/tab/{Module}/{RecordID}
- Format deal/quote info as a clean summary, never raw JSON
- Use * for bold in Google Chat (not **)
- Keep responses concise — this is a chat interface

## NARRATE AS YOU WORK (CRITICAL)

The user cannot see your thinking or tool calls — only your text responses. This means you MUST narrate what you're doing and what you find as you go. Include a brief text block BEFORE each tool call explaining what you're about to do and why. After getting results, summarize what you found before moving to the next step.

Examples of good narration:
- Before searching: "Let me search Zoho for the Apollocare account first."
- After finding account: "Found Apollocare (ID: 123). Now I'll pull their open deals."
- Before creating: "Got everything I need — here's what I'm about to create:" [show validation table]
- When something is missing: "I can see the account but there's no billing address on file. Let me check Gmail for their email signature."
- When asking for input: "I need one more thing before I can create this — what SKUs and quantities should I quote?"

Never jump straight to tool calls without a text explanation. The user should always know what step you're on and what you found.
`;

// Minimal system prompt for CRM/email agent mode (saves ~4K tokens vs full SYSTEM_PROMPT)
const CRM_AGENT_SYSTEM_PROMPT = `You are Stratus AI, the sales assistant for Stratus Information Systems, a Cisco-exclusive Meraki reseller. You help with CRM and email tasks.

Keep responses concise and well-formatted for Google Chat (* for bold, not **).
${CRM_SYSTEM_PROMPT}`;

// ═══════════════════════════════════════════════════════════════════════════════
// ─── END CRM & EMAIL AGENT ENGINE ────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Claude API (direct fetch, no SDK) ───────────────────────────────────────
// Generate a human-readable progress message from a tool call
function toolProgressMessage(toolName, toolInput) {
  switch (toolName) {
    case 'zoho_search_records': {
      const mod = toolInput.module_name || 'records';
      const criteria = toolInput.criteria ? toolInput.criteria.replace(/[()]/g, '').substring(0, 60) : '';
      return `🔍 Searching Zoho ${mod}${criteria ? ` (${criteria})` : ''}...`;
    }
    case 'zoho_coql_query':
      return `🔍 Running CRM query...`;
    case 'zoho_get_record': {
      const mod = toolInput.module_name || 'record';
      return `📄 Loading ${mod} details...`;
    }
    case 'zoho_get_related_records': {
      const rel = toolInput.related_module || 'related records';
      return `🔗 Loading related ${rel}...`;
    }
    case 'zoho_create_record': {
      const mod = toolInput.module_name || 'record';
      return `✏️ Validating & creating ${mod} in Zoho CRM...`;
    }
    case 'zoho_update_record': {
      const mod = toolInput.module_name || 'record';
      const stageNote = (toolInput.data?.Stage) ? ` (Stage → ${toolInput.data.Stage})` : '';
      return `✏️ Validating & updating ${mod}${stageNote}...`;
    }
    case 'zoho_get_field':
      return `🔍 Validating ${toolInput.field_name || 'field'} picklist values...`;
    case 'web_search_domain': {
      return `🌐 Looking up ${toolInput.domain || 'domain'}...`;
    }
    case 'gmail_search_messages': {
      const q = (toolInput.query || '').substring(0, 50);
      return `📧 Searching Gmail: ${q}...`;
    }
    case 'gmail_read_message':
      return `📧 Reading email...`;
    case 'gmail_read_thread':
      return `📧 Loading email thread...`;
    case 'gmail_create_draft':
      return `✍️ Creating draft email to ${toolInput.to || ''}...`;
    case 'gmail_send_email':
      return `📤 Sending email to ${toolInput.to || ''}...`;
    default:
      return `⚙️ Running ${toolName}...`;
  }
}

// Continuation variant of askClaude: resumes a tool loop from saved state.
// Used by the /_continue self-invocation endpoint.
async function askClaudeContinue(messages, tools, systemPrompt, startIteration, env, progressCallback, maxWallMs) {
  const MAX_TOOL_ITERATIONS = 30;
  let iteration = startIteration;
  const _loopStartMs = Date.now();

  async function callAnthropicWithRetry(body, maxRetries = 2) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const response = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'cf-aig-cache-ttl': '3600'  // Cache identical prompts for 1 hour
        },
        body: JSON.stringify(body)
      });
      if ((response.status === 429 || response.status === 529) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }
      return response;
    }
  }

  while (iteration < MAX_TOOL_ITERATIONS) {
    if (maxWallMs && (Date.now() - _loopStartMs) > maxWallMs) {
      console.log(`[GCHAT-CONTINUE] Deadline hit at iteration ${iteration}, chaining`);
      return { __continuation: true, messages, tools, systemPrompt, iteration };
    }

    iteration++;
    console.log(`[GCHAT-CONTINUE] Iteration ${iteration}, wall=${Date.now() - _loopStartMs}ms`);

    const requestBody = {
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: systemPrompt,
      messages
    };
    if (tools.length > 0) requestBody.tools = tools;

    const response = await callAnthropicWithRetry(requestBody);
    if (!response || !response.ok) {
      return `Sorry, I couldn't complete that CRM request (API ${response?.status || 'error'}).`;
    }

    const data = await response.json();

    if (data.stop_reason === 'tool_use') {
      messages.push({ role: 'assistant', content: data.content });

      const interimText = data.content
        .filter(b => b.type === 'text' && b.text.trim().length > 0)
        .map(b => b.text.trim())
        .join('\n');

      const toolBlocks = data.content.filter(b => b.type === 'tool_use');

      if (progressCallback && toolBlocks.length > 0) {
        const progressMsg = toolBlocks.map(b => toolProgressMessage(b.name, b.input)).join('\n');
        const fullProgress = interimText ? `${interimText}\n\n${progressMsg}` : progressMsg;
        try { progressCallback(fullProgress).catch(() => {}); } catch (_) { /* ignore */ }
      }

      const toolPromises = toolBlocks.map(async (block) => {
        console.log(`[GCHAT-CONTINUE] Tool: ${block.name}`);
        const result = await executeToolCall(block.name, block.input, env);
        const resultStr = JSON.stringify(result);
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...(truncated)' : resultStr
        };
      });

      const toolResults = await Promise.all(toolPromises);
      messages.push({ role: 'user', content: toolResults });

      // Compact older messages
      if (messages.length > 6) {
        for (let i = 1; i < messages.length - 4; i++) {
          const msg = messages[i];
          if (msg.role === 'user' && Array.isArray(msg.content)) {
            msg.content = msg.content.map(block => {
              if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > 300) {
                return { ...block, content: block.content.substring(0, 300) + '...(compacted)' };
              }
              return block;
            });
          }
        }
      }
      continue;
    }

    // Final text response
    const textBlocks = data.content.filter(b => b.type === 'text');
    return { reply: textBlocks.map(b => b.text).join('\n') };
  }

  return { reply: 'I ran into a complex operation that required too many steps. Could you break it into smaller pieces?' };
}

async function askClaude(userMessage, personId, env, imageData = null, useTools = false, progressCallback = null, maxWallMs = null) {
  if (!env.ANTHROPIC_API_KEY) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';
  try {
    const upper = userMessage.toUpperCase();
    let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?LATEST|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET)\b/i.test(userMessage);

    let systemPrompt = SYSTEM_PROMPT;
    const kv = env.CONVERSATION_KV;

    // Context-aware: bare "yes"/"yeah"/"sure" after bot offered datasheet check
    if (!wantsLiveDatasheet && /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it)\s*[.!]?\s*$/i.test(userMessage) && personId && kv) {
      const recentHistory = await getHistory(kv, personId);
      const lastAssistant = [...recentHistory].reverse().find(h => h.role === 'assistant');
      if (lastAssistant && /datasheet|check for updates/i.test(lastAssistant.content)) {
        wantsLiveDatasheet = true;
      }
    }

    if (wantsLiveDatasheet) {
      let datasheetFetched = false;
      const datasheetContext = await getRelevantDatasheetContext(userMessage);
      if (!datasheetContext && personId) {
        const history = await getHistory(kv, personId);
        const lastAssistant = [...history].reverse().find(h => h.role === 'assistant');
        if (lastAssistant) {
          const historyContext = await getRelevantDatasheetContext(lastAssistant.content);
          if (historyContext) {
            systemPrompt += '\n\n' + historyContext;
            systemPrompt += '\n\nThe user has asked you to verify specs against the latest datasheet. Compare the live datasheet data above with what you previously told them and note any differences.';
            datasheetFetched = true;
          }
        }
      } else if (datasheetContext) {
        systemPrompt += '\n\n' + datasheetContext;
        systemPrompt += '\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.';
        datasheetFetched = true;
      }
      // If datasheet fetch failed, tell Claude it has the capability but the fetch failed
      if (!datasheetFetched) {
        systemPrompt += '\n\nThe user asked to verify specs against the latest datasheet. The live datasheet fetch was attempted but failed (the page may be temporarily unavailable). Tell the user the datasheet check was attempted but the page was unreachable, and offer to try again. Do NOT say you lack the ability to fetch datasheets — you DO have this capability, but it failed this time. Fall back to the specs.json data you already have.';
        // Still inject static specs as fallback
        const recentHistory = await getHistory(kv, personId);
        const lastAssistant = [...recentHistory].reverse().find(h => h.role === 'assistant');
        if (lastAssistant) {
          const staticContext = getStaticSpecsContext(lastAssistant.content);
          if (staticContext) systemPrompt += '\n\n' + staticContext;
        }
      }
    } else {
      const staticContext = getStaticSpecsContext(userMessage);
      if (staticContext) systemPrompt += '\n\n' + staticContext;
    }

    const history = personId ? await getHistory(kv, personId) : [];

    // Option 3: Inject relevant pricing into system prompt for pricing questions
    const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(userMessage);
    if (pricingIntent) {
      const priceContext = getRelevantPriceContext(userMessage, history);
      if (priceContext) systemPrompt += '\n\n' + priceContext;
    }

    // Phase 4: Inject accessories/connectivity context for design questions
    const accessoriesContext = getAccessoriesContext(userMessage);
    if (accessoriesContext) systemPrompt += '\n\n' + accessoriesContext;

    let userContent;
    if (imageData) {
      userContent = [
        { type: 'image', source: { type: 'base64', media_type: imageData.mediaType, data: imageData.base64 } },
        { type: 'text', text: userMessage || 'Please analyze this image.' }
      ];
    } else {
      userContent = userMessage;
    }
    let messages = [...history, { role: 'user', content: userContent }];

    // Determine if we should include CRM/email tools
    const tools = useTools ? CRM_EMAIL_TOOLS : [];
    if (useTools) {
      // Use a minimal system prompt for CRM/email operations to stay under token limits.
      // The full quoting system prompt (~5K tokens) isn't needed for CRM queries.
      systemPrompt = CRM_AGENT_SYSTEM_PROMPT;
    }

    // Agentic loop: Claude may call tools multiple times before returning text.
    // Workers Unbound gives unlimited wall clock (30s CPU cap), so we can afford
    // many iterations. Full quote creation needs 15-25 tool calls.
    const MAX_TOOL_ITERATIONS = useTools ? 30 : 8;
    let iteration = 0;
    const _loopStartMs = Date.now();

    // Helper: call Anthropic API with retry for 429/529 + model fallback
    async function callAnthropicWithRetry(body, maxRetries = 3) {
      let lastResponse = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const response = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'cf-aig-skip-cache': 'true'  // CRM tool-use calls are always unique
          },
          body: JSON.stringify(body)
        });

        if ((response.status === 429 || response.status === 529) && attempt < maxRetries) {
          // Rate limited (429) or overloaded (529) — wait with exponential backoff (2s, 4s, 8s)
          const retryAfter = response.headers.get('retry-after');
          const waitMs = retryAfter ? parseInt(retryAfter) * 1000 : (2000 * Math.pow(2, attempt));
          console.log(`[GCHAT-AGENT] API ${response.status}, retry ${attempt + 1}/${maxRetries} after ${waitMs}ms`);
          await new Promise(r => setTimeout(r, waitMs));
          continue;
        }

        return response;
      }
      // All retries exhausted on primary model — try fallback to Haiku
      if (body.model !== 'claude-haiku-4-5-20251001') {
        console.log(`[GCHAT-AGENT] Primary model exhausted retries, falling back to Haiku`);
        const fallbackBody = { ...body, model: 'claude-haiku-4-5-20251001' };
        return await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01',
            'cf-aig-skip-cache': 'true'
          },
          body: JSON.stringify(fallbackBody)
        });
      }
    }

    while (iteration < MAX_TOOL_ITERATIONS) {
      // Deadline guard: if we've burned past maxWallMs, return a continuation object
      // so the caller can chain to /_continue. Safety net for runaway loops.
      if (maxWallMs && (Date.now() - _loopStartMs) > maxWallMs) {
        console.log(`[GCHAT] Deadline ${maxWallMs}ms hit at iteration ${iteration}, requesting continuation`);
        return {
          __continuation: true,
          messages,
          tools,
          systemPrompt,
          iteration,
          segment: 1
        };
      }

      iteration++;
      console.log(`[GCHAT-AGENT] Iteration ${iteration}/${MAX_TOOL_ITERATIONS}, wall=${Date.now() - _loopStartMs}ms`);

      const requestBody = {
        // CRM tool-use: Haiku (1-2s/call) for speed across many iterations.
        // Sonnet for non-tool conversational chat (higher quality responses).
        model: useTools ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-20250514',
        max_tokens: useTools ? 1024 : 1024,
        system: systemPrompt,
        messages
      };
      if (tools.length > 0) {
        requestBody.tools = tools;
      }

      const response = await callAnthropicWithRetry(requestBody);

      if (!response.ok) {
        const errBody = await response.text();
        console.error('Anthropic API error:', response.status, errBody);
        // Save detailed error to KV for debugging
        try {
          const kv = env.CONVERSATION_KV;
          if (kv) {
            await kv.put(`api_error_${Date.now()}`, JSON.stringify({
              timestamp: new Date().toISOString(),
              status: response.status,
              error: errBody.substring(0, 2000),
              iteration,
              useTools,
              messageCount: messages.length,
              systemPromptLen: systemPrompt.length,
              bodyLen: JSON.stringify(requestBody).length,
              userMessage: userMessage.substring(0, 200)
            }), { expirationTtl: 7200 });
          }
        } catch (logErr) { /* ignore logging errors */ }
        if (response.status === 529) {
          return `The AI service is temporarily overloaded. Please try again in a minute.`;
        }
        return useTools
          ? `Sorry, I couldn't process that CRM/email request (API ${response.status}). Please try again shortly.`
          : `Sorry, I couldn't process that request (API ${response.status}). Try a specific SKU like "quote 10 MR44".`;
      }

      const data = await response.json();

      // Check if Claude wants to use tools
      if (data.stop_reason === 'tool_use') {
        console.log(`[GCHAT-AGENT] Tool use iteration ${iteration}`);

        // Add Claude's response (with tool_use blocks) to messages
        messages.push({ role: 'assistant', content: data.content });

        // Execute each tool call and collect results
        // Collect any interim text Claude narrated before the tool calls
        const interimText = data.content
          .filter(b => b.type === 'text' && b.text.trim().length > 0)
          .map(b => b.text.trim())
          .join('\n');

        const toolBlocks = data.content.filter(b => b.type === 'tool_use');

        // Fire-and-forget progress update for all tools in this batch
        if (progressCallback && toolBlocks.length > 0) {
          const progressMsg = toolBlocks.map(b => toolProgressMessage(b.name, b.input)).join('\n');
          const fullProgress = interimText ? `${interimText}\n\n${progressMsg}` : progressMsg;
          try { progressCallback(fullProgress).catch(() => {}); } catch (e) { /* ignore */ }
        }

        // Execute tool calls in parallel when multiple are returned
        const toolPromises = toolBlocks.map(async (block) => {
          console.log(`[GCHAT-AGENT] Calling tool: ${block.name}`, JSON.stringify(block.input).substring(0, 200));
          const result = await executeToolCall(block.name, block.input, env);
          const resultStr = JSON.stringify(result);
          console.log(`[GCHAT-AGENT] Tool result (${block.name}): ${resultStr.substring(0, 200)}`);
          // Aggressive truncation: keep payloads small so subsequent Anthropic calls are fast.
          // Zoho responses contain many unused fields — 2KB is enough for IDs + key fields.
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultStr.length > 2000 ? resultStr.substring(0, 2000) + '...(truncated)' : resultStr
          };
        });

        const toolResults = await Promise.all(toolPromises);

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResults });

        // Message compaction: when conversation grows beyond 6 messages,
        // replace older tool_result contents with a brief summary to keep
        // the Anthropic API payload small (faster calls = more iterations in 30s).
        if (messages.length > 6) {
          for (let i = 1; i < messages.length - 4; i++) {
            const msg = messages[i];
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              msg.content = msg.content.map(block => {
                if (block.type === 'tool_result' && typeof block.content === 'string' && block.content.length > 300) {
                  return { ...block, content: block.content.substring(0, 300) + '...(compacted)' };
                }
                return block;
              });
            }
          }
        }

        continue; // Loop back for Claude to process tool results
      }

      // Claude returned a final text response (stop_reason = 'end_turn')
      const textBlocks = data.content.filter(b => b.type === 'text');
      const reply = textBlocks.map(b => b.text).join('\n');

      if (personId) {
        await addToHistory(kv, personId, 'user', userMessage);
        await addToHistory(kv, personId, 'assistant', reply);
      }

      return reply;
    }

    // If we exhausted iterations, return whatever we have
    return 'I ran into a complex operation that required too many steps. Could you break your request into smaller pieces?';
  } catch (err) {
    console.error('Claude API error:', err.message, err.stack);
    // Save exception details to KV
    try {
      const kv = env.CONVERSATION_KV;
      if (kv) {
        await kv.put(`api_exception_${Date.now()}`, JSON.stringify({
          timestamp: new Date().toISOString(),
          error: err.message,
          stack: (err.stack || '').substring(0, 1000),
          useTools,
          userMessage: userMessage.substring(0, 200)
        }), { expirationTtl: 7200 });
      }
    } catch (logErr) { /* ignore */ }
    return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44" or "5 MS150-48LP-4G".`;
  }
}

// ─── Google Chat Markdown Adapter ─────────────────────────────────────────────
// Google Chat supports: *bold*, _italic_, `code`, ```preformatted```, ~strikethrough~, links
// Webex uses **bold** and * for unordered lists. Convert:
function adaptMarkdownForGChat(text) {
  if (!text) return text;
  let out = text;
  // Convert **bold** to *bold* (Google Chat uses single asterisk for bold)
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
  // Convert • bullet points to - (Google Chat renders - as bullets)
  out = out.replace(/^•\s*/gm, '- ');
  // Convert --- horizontal rules to a plain separator
  out = out.replace(/^---+$/gm, '────────────────');
  return out;
}

// ─── Google Chat JWT Verification ─────────────────────────────────────────────
// Google Chat sends a Bearer token in the Authorization header.
// For Google Workspace apps, we verify the token against Google's OIDC certs.
// Simplified: we verify the token audience matches our project number.
async function verifyGoogleChatToken(request, env) {
  // If no GOOGLE_PROJECT_NUMBER is set, skip verification (development mode)
  if (!env.GOOGLE_PROJECT_NUMBER) return true;
  
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return false;
  
  const token = authHeader.slice(7);
  
  try {
    // Decode JWT payload (middle segment) without full signature verification
    // Full verification would require fetching Google's JWKS and validating the signature
    // For Cloudflare Workers, we do a lightweight check on claims
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    
    // Check audience matches our project number
    if (payload.aud !== env.GOOGLE_PROJECT_NUMBER) {
      console.error('JWT audience mismatch:', payload.aud, '!==', env.GOOGLE_PROJECT_NUMBER);
      return false;
    }
    
    // Check issuer is Google
    if (payload.iss !== 'chat@system.gserviceaccount.com') {
      console.error('JWT issuer mismatch:', payload.iss);
      return false;
    }
    
    // Check expiration
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
      console.error('JWT expired');
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('JWT verification error:', e.message);
    return false;
  }
}

// ─── Main Worker Entry Point (Google Chat) ────────────────────────────────────
/**
 * Google Chat Bot for Stratus AI Quoting
 *
 * ENVIRONMENT SETUP REQUIRED:
 * In Google Cloud Console > Chat API > App Configuration:
 *
 * 1. Basic Information
 *    - App name: Stratus AI Bot
 *    - Avatar URL: (optional)
 *    - Description: Cisco/Meraki quoting assistant
 *
 * 2. Functionality
 *    - Slash commands: (optional, for /quote, /price)
 *
 * 3. Connection Settings
 *    - HTTP endpoint URL: https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev
 *    - Verification token: (optional, for extra security)
 *
 * 4. Permissions
 *    - Receive 1:1 messages: ENABLED
 *    - Join spaces and group conversations: ENABLED
 *    - See messages in spaces where bot is added: YES
 *    - Read basic space information: YES
 *
 * USAGE:
 * - DMs: Send messages directly to @StratusAI
 * - Spaces: Add bot to space, then:
 *   - @mention bot to trigger quote parsing
 *   - Use Gmail "Share to Chat" feature to share emails directly
 *   - Bot extracts email content and finds relevant products
 *
 * GMAIL INTEGRATION:
 * Once bot is in a Space, Gmail users can right-click emails
 * and select "Share to Google Chat" to send them to the Space.
 * The bot will parse email content and extract any Cisco/Meraki
 * products mentioned, generating quote links.
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Log ALL incoming requests for debugging
    console.log(`[GCHAT-DEBUG] ${request.method} ${url.pathname} from ${request.headers.get('user-agent') || 'unknown'}`);

    // ── /_work endpoint: Primary handler for CRM agentic loops ──
    // Processes SYNCHRONOUSLY (not in ctx.waitUntil) to get unlimited wall-clock
    // time. Per CF docs, HTTP requests have no wall-time limit while the
    // connection is alive. ctx.waitUntil only gets 30s — not enough for CRM.
    // The webhook handler fires a fetch to /_work and returns immediately.
    if (request.method === 'POST' && url.pathname === '/_work') {
      const _workStart = Date.now();
      try {
        const { token } = await request.json();
        const stateJson = await env.CONVERSATION_KV.get(`work_${token}`);
        if (!stateJson) {
          return new Response('Work request expired', { status: 410 });
        }
        await env.CONVERSATION_KV.delete(`work_${token}`);
        const state = JSON.parse(stateJson);
        const kv = env.CONVERSATION_KV;
        const { text, personId, spaceName } = state;
        console.log(`[GCHAT-WORK] Starting CRM work for: "${text.substring(0, 80)}..."`);

        try {
          const progressCallback = async (msg) => {
            const formatted = adaptMarkdownForGChat(msg);
            await sendAsyncGChatMessage(spaceName, formatted, null, env);
          };

          // 5-minute safety-net deadline (unlimited wall time available)
          let result = await askClaude(text, personId, env, null, true, progressCallback, 300000);
          console.log(`[GCHAT-WORK] askClaude completed in ${Date.now() - _workStart}ms`);

          // Handle continuation (safety net for 5-min deadline)
          if (result && result.__continuation) {
            console.log(`[GCHAT-WORK] Continuation needed at iteration ${result.iteration}, chaining to /_continue`);
            const contToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await kv.put(`cont_${contToken}`, JSON.stringify({
              ...result,
              spaceName,
              personId,
              originalText: text,
              segment: 1
            }), { expirationTtl: 300 });
            // Chain via Service Binding — unlimited wall time
            await env.SELF.fetch(new Request('https://self/_continue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: contToken })
            }));
          } else {
            // Normal completion
            let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
            finalReply = adaptMarkdownForGChat(finalReply);
            finalReply = truncateGChatReply(finalReply);
            await sendAsyncGChatMessage(spaceName, finalReply, null, env);
            if (personId) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', finalReply);
              await kv.put(`crm_session_${personId}`, 'active', { expirationTtl: 300 });
            }
          }
          console.log(`[GCHAT-WORK] Completed in ${Date.now() - _workStart}ms total`);
        } catch (err) {
          console.error(`[GCHAT-WORK] Error: ${err.message}`);
          try {
            await kv.put(`work_error_${Date.now()}`, JSON.stringify({
              error: err.message,
              stack: (err.stack || '').substring(0, 500),
              ts: new Date().toISOString(),
              elapsed: Date.now() - _workStart
            }), { expirationTtl: 3600 });
          } catch (_) {}
          try {
            await sendAsyncGChatMessage(spaceName,
              `Sorry, I ran into an issue processing that CRM request. Try again or rephrase your question.\n\n_Error: ${err.message.substring(0, 200)}_`,
              null, env);
          } catch (_) {}
        }

        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error(`[GCHAT-WORK] Parse error: ${err.message}`);
        return new Response('Invalid work request', { status: 400 });
      }
    }

    // ── /_continue endpoint: Continuation chain for extremely long flows ──
    // Safety net if /_work's 5-min deadline is hit. Same synchronous pattern.
    if (request.method === 'POST' && url.pathname === '/_continue') {
      try {
        const { token } = await request.json();
        const stateJson = await env.CONVERSATION_KV.get(`cont_${token}`);
        if (!stateJson) {
          return new Response('Continuation expired', { status: 410 });
        }
        await env.CONVERSATION_KV.delete(`cont_${token}`);
        const state = JSON.parse(stateJson);
        const kv = env.CONVERSATION_KV;
        console.log(`[GCHAT-CONTINUE] Resuming from iteration ${state.iteration}, segment ${state.segment || 1}`);

        try {
          const progressCallback = async (msg) => {
            const formatted = adaptMarkdownForGChat(msg);
            await sendAsyncGChatMessage(state.spaceName, formatted, null, env);
          };

          // 5-minute deadline as safety net (unlimited wall time available)
          const result = await askClaudeContinue(
            state.messages, state.tools, state.systemPrompt,
            state.iteration, env, progressCallback, 300000
          );

          if (result && result.__continuation) {
            // Shouldn't happen often with 5-min deadline, but handle gracefully
            const nextToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await kv.put(`cont_${nextToken}`, JSON.stringify({
              ...result,
              spaceName: state.spaceName,
              personId: state.personId,
              originalText: state.originalText,
              segment: (state.segment || 1) + 1
            }), { expirationTtl: 300 });
            console.log(`[GCHAT-CONTINUE] Chaining to segment ${(state.segment || 1) + 1}`);
            // Chain via Service Binding — unlimited wall time
            await env.SELF.fetch(new Request('https://self/_continue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: nextToken })
            }));
          } else {
            // Final response
            let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
            finalReply = adaptMarkdownForGChat(finalReply);
            finalReply = truncateGChatReply(finalReply);
            await sendAsyncGChatMessage(state.spaceName, finalReply, null, env);
            if (state.personId) {
              await addToHistory(kv, state.personId, 'user', state.originalText || '');
              await addToHistory(kv, state.personId, 'assistant', finalReply);
              await kv.put(`crm_session_${state.personId}`, 'active', { expirationTtl: 300 });
            }
            console.log(`[GCHAT-CONTINUE] Completed successfully`);
          }
        } catch (err) {
          console.error(`[GCHAT-CONTINUE] Error: ${err.message}`);
          try {
            await sendAsyncGChatMessage(state.spaceName,
              `Sorry, I ran into an issue continuing that request. Try again or break it into smaller steps.\n\n_Error: ${err.message.substring(0, 200)}_`,
              null, env);
          } catch (_) { /* ignore */ }
        }

        return new Response('OK', { status: 200 });
      } catch (err) {
        console.error(`[GCHAT-CONTINUE] Parse error: ${err.message}`);
        return new Response('Invalid continuation', { status: 400 });
      }
    }

    // Health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        status: 'Stratus AI (Google Chat) running',
        version: '1.2.0-gchat-async',
        runtime: 'cloudflare-workers'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Diagnostic: test CRM agent flow end-to-end
    if (request.method === 'GET' && url.pathname === '/test-agent') {
      try {
        const kv = env.CONVERSATION_KV;
        const results = { timestamp: new Date().toISOString(), steps: [] };

        // Step 1: Check secrets
        results.steps.push({
          step: 'secrets',
          anthropic_key: env.ANTHROPIC_API_KEY ? `set (${env.ANTHROPIC_API_KEY.length} chars, starts: ${env.ANTHROPIC_API_KEY.substring(0, 12)}...)` : 'MISSING',
          zoho_client_id: env.ZOHO_CLIENT_ID ? 'set' : 'MISSING',
          zoho_refresh: env.ZOHO_REFRESH_TOKEN ? 'set' : 'MISSING',
          google_client_id: env.GOOGLE_CLIENT_ID ? 'set' : 'MISSING',
          google_refresh: env.GOOGLE_REFRESH_TOKEN ? 'set' : 'MISSING',
          gcp_service_account: env.GCP_SERVICE_ACCOUNT_KEY ? 'set (async responses enabled)' : 'MISSING (sync-only mode, may timeout on CRM queries)'
        });

        // Step 2: Test Anthropic API with tools
        const testBody = {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 256,
          system: 'You are a test assistant. Respond with "API working" and use the test_tool to confirm tool use works.',
          messages: [{ role: 'user', content: 'test' }],
          tools: [{
            name: 'test_tool',
            description: 'A test tool',
            input_schema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] }
          }]
        };
        const apiRes = await fetch(ANTHROPIC_API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': env.ANTHROPIC_API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(testBody)
        });
        const apiBody = await apiRes.text();
        results.steps.push({
          step: 'anthropic_api_with_tools',
          status: apiRes.status,
          ok: apiRes.ok,
          bodyPreview: apiBody.substring(0, 500)
        });

        // Step 3: Test Zoho token
        try {
          const zohoToken = await getZohoAccessToken(env);
          results.steps.push({ step: 'zoho_token', ok: true, tokenLen: zohoToken.length });
        } catch (e) {
          results.steps.push({ step: 'zoho_token', ok: false, error: e.message });
        }

        // Step 4: Test full CRM query
        try {
          const fullReply = await askClaude('what is my most recent deal?', 'test-diag', env, null, true);
          results.steps.push({ step: 'full_crm_query', ok: true, replyPreview: fullReply.substring(0, 300) });
        } catch (e) {
          results.steps.push({ step: 'full_crm_query', ok: false, error: e.message });
        }

        // Step 5: Check for recent errors in KV
        const keys = await kv.list({ prefix: 'api_error_' });
        const errors = [];
        for (const key of (keys.keys || []).slice(0, 5)) {
          const val = await kv.get(key.name, 'json');
          if (val) errors.push(val);
        }
        const exKeys = await kv.list({ prefix: 'api_exception_' });
        for (const key of (exKeys.keys || []).slice(0, 5)) {
          const val = await kv.get(key.name, 'json');
          if (val) errors.push(val);
        }
        results.recentErrors = errors;

        return new Response(JSON.stringify(results, null, 2), {
          headers: { 'Content-Type': 'application/json' }
        });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), {
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // Google Chat webhook handler - match ANY POST request
    if (request.method === 'POST') {
      try {
        const rawBody = await request.text();

        // DEBUG: Save request to KV for inspection
        const kv = env.CONVERSATION_KV;
        const debugKey = `debug_${Date.now()}`;

        let event;
        try {
          event = JSON.parse(rawBody);
        } catch (parseErr) {
          return new Response(JSON.stringify({ text: 'Error parsing request' }), {
            headers: { 'Content-Type': 'application/json' }
          });
        }

        // Save full event structure (without auth tokens to save space)
        const debugEvent = JSON.parse(rawBody);
        delete debugEvent.authorizationEventObject;
        await kv.put(debugKey, JSON.stringify({
          timestamp: new Date().toISOString(),
          userAgent: request.headers.get('user-agent'),
          url: url.pathname,
          event: debugEvent
        }), { expirationTtl: 3600 });

        // Detect Workspace Add-on format (commonEventObject present)
        const isAddon = !!event.commonEventObject;

        // Detect if message is in a Space (not a DM)
        const isSpace = event.space?.type === 'ROOM';

        // Extract message text from either format (handles attachments, cards, etc.)
        const messageText = extractMessageText(event, isAddon);

        // Extract sender ID for conversation history
        const personId = isAddon
          ? (event.chat?.user?.name || 'unknown')
          : (event.message?.sender?.name || 'unknown');

        // Handle non-message events
        if (!messageText) {
          const greeting = 'Hey! I\'m Stratus AI, your Cisco/Meraki quoting assistant. Try "quote 10 MR44" or "5 MS150-48LP-4G" to get started.';
          return sendGChatResponse(greeting, isAddon);
        }

        const text = messageText;

        // Log raw event structure for debugging Gmail Share to Chat
        try {
          const msg = isAddon ? event.chat?.messagePayload?.message : event.message;
          if (msg) {
            const debugPayload = {
              timestamp: new Date().toISOString(),
              text: (msg.argumentText || msg.text || '').substring(0, 300),
              hasAnnotation: !!msg.annotation,
              annotationCount: msg.annotation?.length || 0,
              annotations: msg.annotation?.map(a => ({ type: a.type, metadata: a.richLinkMetadata || a.slashCommandMetadata || null })) || [],
              hasMatchedUrl: !!msg.matchedUrl,
              matchedUrl: msg.matchedUrl?.url || null,
              hasAttachment: !!msg.attachment,
              attachmentCount: msg.attachment?.length || 0,
              hasCardsV2: !!msg.cardsV2,
              cardCount: msg.cardsV2?.length || 0,
              // Capture all space/name paths to find correct location for addon events
              spaceName_eventSpace: event.space?.name || null,
              spaceType_eventSpace: event.space?.type || null,
              spaceName_msgSpace: msg.space?.name || null,
              spaceType_msgSpace: msg.space?.type || null,
              msgName: msg.name || null,
              chatSpaceName: event.chat?.messagePayload?.space?.name || null,
              chatMsgSpaceName: event.chat?.messagePayload?.message?.space?.name || null,
              commonEventKeys: event.commonEventObject ? Object.keys(event.commonEventObject) : [],
              chatKeys: event.chat ? Object.keys(event.chat) : [],
              chatPayloadKeys: event.chat?.messagePayload ? Object.keys(event.chat.messagePayload) : [],
              isAddon: isAddon
            };
            await kv.put(`event_debug_${Date.now()}`, JSON.stringify(debugPayload), { expirationTtl: 3600 });
            console.log(`[GCHAT-DEBUG] Event payload: ${JSON.stringify(debugPayload)}`);
          }
        } catch (dbgErr) { /* ignore debug errors */ }

        // Process through the deterministic engine (same as Webex bot)
        let reply;

        // Check for Gmail "Share to Chat" (Gmail links or annotations)
        const gmailShare = detectGmailShare(text, event, isAddon);
        if (gmailShare.isGmailShare) {
          console.log(`[GCHAT] Gmail Share to Chat detected: ${gmailShare.gmailUrl}`);
          reply = await processGmailShareToChat(gmailShare, text, personId, env, kv);
          if (reply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', reply);
          }
        }

        // Try deterministic EOL date lookup first
        const eolDateReply = handleEolDateRequest(text);
        if (eolDateReply) {
          await addToHistory(kv, personId, 'user', text);
          await addToHistory(kv, personId, 'assistant', eolDateReply);
          reply = eolDateReply;
        }

        if (!reply) {
          const quoteConfirmReply = await handleQuoteConfirmation(text, personId, kv);
          if (quoteConfirmReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', quoteConfirmReply);
            reply = quoteConfirmReply;
          }
        }

        if (!reply && detectEmailContent(text)) {
          const emailReply = await processEmailThread(text, personId, env, kv);
          if (emailReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', emailReply);
            reply = emailReply;
          }
        }

        // Skip deterministic quoting engine for explicit CRM/Zoho requests
        // e.g. "In zoho a new quote for 1 MR44" — the SKU parser would intercept
        // before the CRM agent could handle it without this guard.
        let isExplicitCrmRequest = /\bzoho\b|\bcrm\b|\bin\s+zoho\b|\bzoho\s+quote\b|\bzoho\s+deal\b|\bopen\s+deals?\b|\bcheck\s+(the\s+)?(crm|zoho)\b/i.test(text);

        // CRM session continuation: if a CRM conversation is active (flag set by
        // the async CRM handler), keep routing follow-up messages to the CRM agent
        // even without explicit "zoho"/"crm" keywords. This allows multi-turn CRM
        // workflows (ask clarifying questions → user answers → create quote).
        if (!isExplicitCrmRequest && personId && kv) {
          const crmSession = await kv.get(`crm_session_${personId}`);
          if (crmSession) {
            console.log(`[GCHAT] Active CRM session found for ${personId} — routing to CRM agent`);
            isExplicitCrmRequest = true;
          }
        }

        // "Try again" / "retry" should re-run as a CRM request if the previous
        // user message was a CRM intent — prevents context confusion where
        // "try again" gets treated as a quote revision and replies about wrong topic.
        if (!isExplicitCrmRequest && /^\s*(try\s+again|retry|again|try\s+that\s+again)\s*[.!?]?\s*$/i.test(text)) {
          const recentHistory = await getHistory(kv, personId);
          const lastUserMsg = recentHistory.filter(m => m.role === 'user').slice(-2, -1)[0];
          if (lastUserMsg && detectCrmEmailIntent(lastUserMsg.content).hasAny) {
            console.log(`[GCHAT] "try again" detected after CRM query — re-routing to CRM agent`);
            isExplicitCrmRequest = true;
          }
        }

        if (!reply && !isExplicitCrmRequest) {
          const parsed = parseMessage(text);
          if (parsed) {
            const result = buildQuoteResponse(parsed);
            if (!result.needsLlm && result.message) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', result.message);
              reply = result.message;
            } else if (result.revision) {
              const history = await getHistory(kv, personId);
              if (history.length > 0) {
                reply = await askClaude(
                  `${text}\n\n(Note: The user is modifying their previous quote request.)`,
                  personId, env
                );
              } else {
                reply = 'I don\'t have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"';
              }
            } else if (result.errors && result.errors.length > 0) {
              const errorContext = result.errors.join('\n');
              reply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
            }
          }
        }

        // Option 4: Deterministic pricing calculator (skip for explicit CRM requests)
        if (!reply && !isExplicitCrmRequest) {
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) reply = pricingReply;
        }

        if (!reply) {
          // Check if this is a CRM or email intent — if so, enable tool use
          const intent = detectCrmEmailIntent(text);
          const hasCrmCreds = !!(env.ZOHO_CLIENT_ID && env.ZOHO_REFRESH_TOKEN);
          const hasGmailCreds = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_REFRESH_TOKEN);
          const useTools = intent.hasAny && (hasCrmCreds || hasGmailCreds);

          if (useTools) {
            console.log(`[GCHAT-AGENT] CRM/Email intent detected (crm=${intent.hasCrm}, email=${intent.hasEmail}). Enabling tool use.`);

            // ── Async response pattern ──────────────────────────────────────
            // CRM/email tool-use calls can take 15-45+ seconds (multi-iteration
            // agentic loop). Google Chat's synchronous webhook timeout is ~30s.
            // Return a quick "thinking" message now, process in background,
            // then deliver the real answer via the Google Chat REST API.
            // For addon events (isAddon=true), space is nested inside chat.messagePayload
            // For direct webhook events (isAddon=false), space is at event.space
            const spaceName = event.space?.name
              || event.chat?.messagePayload?.message?.space?.name
              || event.chat?.messagePayload?.space?.name;
            const threadName = event.message?.thread?.name
              || event.chat?.messagePayload?.message?.thread?.name;
            const hasAsyncCreds = !!env.GCP_SERVICE_ACCOUNT_KEY;

            if (spaceName && hasAsyncCreds) {
              console.log(`[GCHAT-ASYNC] Using /_work pattern for CRM query in ${spaceName}`);

              // ARCHITECTURE: ctx.waitUntil() has a hard 30-second limit (all plans).
              // Instead of doing heavy work in waitUntil, we immediately fire a fetch
              // to /_work, which processes SYNCHRONOUSLY as a fresh HTTP request with
              // UNLIMITED wall-clock time. waitUntil only needs to survive long enough
              // to dispatch the fetch (milliseconds).
              const workToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

              // Save work request to KV (avoids body size issues with self-fetch)
              await kv.put(`work_${workToken}`, JSON.stringify({
                text,
                personId,
                spaceName,
                ts: new Date().toISOString()
              }), { expirationTtl: 600 });

              // Fire-and-forget via Service Binding (env.SELF).
              // Workers can't fetch their own URL (same-zone restriction).
              // env.SELF.fetch() bypasses this — dispatches a fresh HTTP request
              // to /_work which processes SYNCHRONOUSLY with unlimited wall time.
              ctx.waitUntil(
                env.SELF.fetch(new Request('https://self/_work', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ token: workToken })
                })).catch(e => console.error(`[GCHAT-ASYNC] Work dispatch error: ${e.message}`))
              );

              // Return a quick synchronous "thinking" message
              return sendGChatResponse('🔍 Looking that up in the CRM... one moment.', isAddon);
            }

            // Fallback: no service account key, process synchronously (may timeout)
            console.log(`[GCHAT-AGENT] No GCP_SERVICE_ACCOUNT_KEY — falling back to synchronous CRM processing`);
          }

          reply = await askClaude(text, personId, env, null, useTools);
        }

        // Adapt markdown for Google Chat (* instead of **)
        reply = adaptMarkdownForGChat(reply);
        reply = truncateGChatReply(reply);

        return sendGChatResponse(reply || 'No response generated', isAddon);

        /* === OLD PROCESSING LOGIC (replaced by unified handler above) ===
        if (event.type === 'ADDED_TO_SPACE') {}

        if (event.type === 'REMOVED_FROM_SPACE') {
          return new Response(JSON.stringify({}), { 
            headers: { 'Content-Type': 'application/json' } 
          });
        }

        if (event.type !== 'MESSAGE') {
          return new Response(JSON.stringify({}), { 
            headers: { 'Content-Type': 'application/json' } 
          });
        }

        // Extract message details from Google Chat event
        const message = event.message;
        // In Google Chat, argumentText strips the @mention; text includes it.
        // For DMs, text and argumentText are the same.
        let text = (message.argumentText || message.text || '').trim();
        if (!text) {
          return new Response(JSON.stringify({ text: 'I didn\'t catch that. Try "quote 10 MR44" to get started.' }), { 
            headers: { 'Content-Type': 'application/json' } 
          });
        }

        const kv = env.CONVERSATION_KV;
        // Use sender's name as unique ID for conversation history
        const personId = message.sender?.name || 'unknown';

        // Process the message through the same engine as Webex
        let reply;

        // Try deterministic EOL date lookup first
        const eolDateReply = handleEolDateRequest(text);
        if (eolDateReply) {
          await addToHistory(kv, personId, 'user', text);
          await addToHistory(kv, personId, 'assistant', eolDateReply);
          reply = eolDateReply;
        }

        if (!reply) {
          // Try deterministic quote confirmation
          const quoteConfirmReply = await handleQuoteConfirmation(text, personId, kv);
          if (quoteConfirmReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', quoteConfirmReply);
            reply = quoteConfirmReply;
          }
        }

        if (!reply) {
          // Try deterministic engine
          const parsed = parseMessage(text);
          if (parsed) {
            const result = buildQuoteResponse(parsed);

            if (!result.needsLlm && result.message) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', result.message);
              reply = result.message;
            } else if (result.revision) {
              const history = await getHistory(kv, personId);
              if (history.length > 0) {
                reply = await askClaude(
                  `${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`,
                  personId, env
                );
              } else {
                reply = `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`;
              }
            } else if (result.errors && result.errors.length > 0) {
              const errorContext = result.errors.join('\n');
              reply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
            }
          }
        }

        // Option 4: Deterministic pricing calculator
        if (!reply) {
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) reply = pricingReply;
        }

        if (!reply) {
          // Full fallback to Claude API
          reply = await askClaude(text, personId, env);
        }

        // Adapt markdown for Google Chat
        reply = adaptMarkdownForGChat(reply);

        // Google Chat supports synchronous responses up to 4096 chars
        // For longer messages, we need to truncate or split
        if (reply.length > 4096) {
          // Split at a natural break point
          const truncated = reply.substring(0, 4000);
          const lastNewline = truncated.lastIndexOf('\n');
          reply = (lastNewline > 3000 ? truncated.substring(0, lastNewline) : truncated) + '\n\n_(Response truncated. Ask for specific sections if you need more detail.)_';
        }

        console.log(`[GCHAT] Reply length: ${reply ? reply.length : 'null'}, preview: ${reply ? reply.substring(0, 200) : 'null'}`);
        const responseBody = JSON.stringify({ text: reply || 'No response generated' });
        console.log(`[GCHAT] Sending response, body length: ${responseBody.length}`);
        return new Response(responseBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
        === END ORIGINAL PROCESSING LOGIC === */

      } catch (err) {
        console.error('[GCHAT] Webhook error:', err.message, err.stack);
        return sendGChatResponse(
          'Something went wrong processing your request. Try again with a specific SKU like "quote 10 MR44".',
          true // assume add-on format for safety
        );
      }
    }

    return new Response(JSON.stringify({ text: 'OK' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

/**
 * Extracts message text from Google Chat events, handling both DMs and Spaces.
 * In Spaces, the bot receives messages when:
 * 1. @mentioned (argumentText strips the @mention, text includes it)
 * 2. Configured in GCP to receive all messages in the space
 *
 * GCP Chat App Configuration Requirements:
 * - Enable "Receive 1:1 messages" (for DMs)
 * - Enable "Join spaces and group conversations"
 * - Set HTTP endpoint URL in Connection settings
 * - If only @mentions desired: no additional config needed
 * - If all messages desired: requires GCP permission scopes
 */
function extractMessageText(event, isAddon) {
  let text = '';

  if (isAddon) {
    // Workspace Add-on format: text at chat.messagePayload.message.argumentText
    text = event.chat?.messagePayload?.message?.argumentText
      || event.chat?.messagePayload?.message?.text
      || '';
  } else {
    // Standalone Chat app format (DMs and Spaces)
    text = event.message?.argumentText || event.message?.text || '';
  }

  // If no text, try to extract from attachments (Gmail shares, etc.)
  if (!text && event.message?.attachment) {
    text = extractFromAttachments(event.message.attachment);
  }

  // Also try cardsV2 (newer format)
  if (!text && event.message?.cardsV2) {
    text = extractFromCards(event.message.cardsV2);
  }

  return text.trim();
}

/**
 * Extracts text from Gmail shared email attachments.
 * Gmail "Share to Chat" feature sends email content as attachments.
 */
function extractFromAttachments(attachments) {
  if (!Array.isArray(attachments)) return '';

  let fullText = '';

  for (const attachment of attachments) {
    // Gmail shared email typically has contentName or fileName
    const name = attachment.name || attachment.contentName || '';

    // Extract text content from attachment
    if (attachment.source?.attachmentDataUri) {
      // For base64 encoded data
      try {
        const base64Data = attachment.source.attachmentDataUri.split(',')[1] || attachment.source.attachmentDataUri;
        const decoded = atob(base64Data);
        fullText += decoded + '\n';
      } catch (e) {
        console.warn('[GCHAT] Failed to decode attachment:', e.message);
      }
    }

    // Some formats include the text directly
    if (attachment.text) {
      fullText += attachment.text + '\n';
    }
  }

  return fullText;
}

/**
 * Extracts text from card widgets (newer Google Chat format).
 * Gmail shares can appear as rich cards with email subject and preview.
 */
function extractFromCards(cardsV2) {
  if (!Array.isArray(cardsV2)) return '';

  let fullText = '';

  for (const cardWrapper of cardsV2) {
    const card = cardWrapper.card || {};

    // Extract from sections
    if (card.sections && Array.isArray(card.sections)) {
      for (const section of card.sections) {
        if (section.header) {
          fullText += section.header + '\n';
        }

        if (section.widgets && Array.isArray(section.widgets)) {
          for (const widget of section.widgets) {
            // Text paragraphs
            if (widget.textParagraph?.text) {
              fullText += widget.textParagraph.text + '\n';
            }

            // Decorated text (has label and value)
            if (widget.decoratedText?.text) {
              fullText += widget.decoratedText.text + '\n';
            }
            if (widget.decoratedText?.topLabel) {
              fullText += widget.decoratedText.topLabel + ': ';
            }
            if (widget.decoratedText?.bottomLabel) {
              fullText += widget.decoratedText.bottomLabel + '\n';
            }
          }
        }
      }
    }
  }

  return fullText;
}

// ─── Gmail Share to Chat Detection & Processing ──────────────────────────────

/**
 * Detects if a message contains a Gmail link or is a Gmail "Share to Chat" event.
 * Returns { isGmailShare: bool, gmailUrl: string|null, userComment: string|null, annotations: [] }
 */
function detectGmailShare(text, event, isAddon) {
  const result = { isGmailShare: false, gmailUrl: null, userComment: null, searchHint: null };

  // Check for Gmail URLs in message text
  const gmailUrlMatch = text.match(/https:\/\/mail\.google\.com\/mail\/[^\s)>\]]+/i);
  if (gmailUrlMatch) {
    result.isGmailShare = true;
    result.gmailUrl = gmailUrlMatch[0];
    // User comment is everything except the URL
    result.userComment = text.replace(gmailUrlMatch[0], '').trim() || null;
  }

  // Check for Google Chat annotations (rich links from Share to Chat)
  const message = isAddon
    ? event.chat?.messagePayload?.message
    : event.message;

  if (message?.annotation) {
    for (const ann of message.annotation) {
      if (ann.type === 'RICH_LINK' && ann.richLinkMetadata?.uri?.includes('mail.google.com')) {
        result.isGmailShare = true;
        result.gmailUrl = ann.richLinkMetadata.uri;
        result.searchHint = ann.richLinkMetadata.richLinkType === 'GMAIL'
          ? (ann.richLinkMetadata.subject || null) : null;
      }
    }
  }

  // Check matchedUrl (Google Chat auto-detected links)
  if (message?.matchedUrl?.url?.includes('mail.google.com')) {
    result.isGmailShare = true;
    result.gmailUrl = message.matchedUrl.url;
  }

  // Fallback: detect Gmail Share by text patterns (subject line without URL)
  // Gmail "Share to Chat" sometimes sends just the subject line as text with no URL
  if (!result.isGmailShare) {
    const subjectMatch = text.match(/^(.*?)\n\s*(?:📧\s*|✉️\s*)?(?:RE|FW|Fwd)?:?\s*(.+?)$/im);
    if (subjectMatch) {
      const userComment = subjectMatch[1].trim();
      const possibleSubject = subjectMatch[2].trim();
      // If user comment is a command and the second line looks like an email subject
      if (/\b(summarize|read|review|analyze|look at|check|what|tell me about)\b/i.test(userComment) && possibleSubject.length > 5) {
        result.isGmailShare = true;
        result.searchHint = possibleSubject;
        result.userComment = userComment;
        console.log(`[GCHAT] Gmail Share detected by text pattern: subject="${possibleSubject}", comment="${userComment}"`);
      }
    }
    // Also check for "RE:" or "FW:" patterns with a command
    if (!result.isGmailShare) {
      const reMatch = text.match(/(RE|FW|Fwd):\s*(.+)/i);
      if (reMatch) {
        const fullSubject = reMatch[0].trim();
        const userComment = text.replace(fullSubject, '').trim();
        if (userComment.length > 0 || /summarize|read|review|analyze/i.test(text)) {
          result.isGmailShare = true;
          result.searchHint = fullSubject;
          result.userComment = userComment || 'summarize this email';
          console.log(`[GCHAT] Gmail Share detected by RE/FW pattern: subject="${fullSubject}"`);
        }
      }
    }
  }

  return result;
}

/**
 * Extracts a Gmail thread/message ID from a Gmail URL.
 * Gmail URLs use formats like: #inbox/FMfcg... or #thread-f:... or ?compose=...
 * The ID after the last / is typically a thread key we can search for.
 */
function extractGmailIdFromUrl(url) {
  if (!url) return null;
  // Try #inbox/<id>, #sent/<id>, #label/<name>/<id>, #search/<query>/<id>
  const hashMatch = url.match(/#[^/]+\/([A-Za-z0-9_+-]+)$/);
  if (hashMatch) return hashMatch[1];
  // Try thread-f:<id> format
  const threadMatch = url.match(/thread-f:(\d+)/);
  if (threadMatch) return threadMatch[1];
  return null;
}

/**
 * Process a Gmail Share to Chat: fetch the email thread and pass to Claude with context.
 */
async function processGmailShareToChat(gmailShare, text, personId, env, kv) {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_REFRESH_TOKEN) {
    return 'Gmail integration is not configured. I can still analyze the email if you paste the content directly.';
  }

  try {
    let emailContent = null;
    const gmailId = extractGmailIdFromUrl(gmailShare.gmailUrl);

    // Strategy 1: Try to find by thread/message ID from URL
    if (gmailId) {
      // Search Gmail for this message using the rfc822msgid or general search
      const searchResult = await gmailApiCall('GET', `messages?q=rfc822msgid:${gmailId}&maxResults=1`, env);
      if (searchResult.messages?.length > 0) {
        const threadId = searchResult.messages[0].threadId;
        emailContent = await fetchGmailThread(threadId, env);
      }
    }

    // Strategy 2: Search by subject hint from annotation
    if (!emailContent && gmailShare.searchHint) {
      const searchResult = await gmailApiCall('GET',
        `messages?q=subject:"${encodeURIComponent(gmailShare.searchHint)}"&maxResults=3`, env);
      if (searchResult.messages?.length > 0) {
        const threadId = searchResult.messages[0].threadId;
        emailContent = await fetchGmailThread(threadId, env);
      }
    }

    // Strategy 3: Search for recent messages if no specific match
    if (!emailContent) {
      const searchResult = await gmailApiCall('GET', `messages?q=in:inbox&maxResults=5`, env);
      if (searchResult.messages?.length > 0) {
        // Get the most recent thread
        const threadId = searchResult.messages[0].threadId;
        emailContent = await fetchGmailThread(threadId, env);
      }
    }

    if (!emailContent) {
      return 'I couldn\'t find that email in Gmail. Try pasting the email content directly, or ask me to search for it by subject or sender.';
    }

    // Build context for Claude
    const userIntent = gmailShare.userComment || text.replace(/https:\/\/mail\.google\.com[^\s]*/i, '').trim();
    const emailContext = `## SHARED EMAIL THREAD\n${emailContent}\n\n## USER'S REQUEST\n${userIntent || 'The user shared this email. Analyze it for Cisco/Meraki product mentions, customer requests, or action items. If products are found, generate quote URLs.'}`;

    // Determine if CRM tools should be enabled based on user comment
    const intent = detectCrmEmailIntent(userIntent || 'analyze this email for products and create a quote');
    const hasCrmCreds = !!(env.ZOHO_CLIENT_ID && env.ZOHO_REFRESH_TOKEN);
    const useTools = intent.hasAny && hasCrmCreds;

    const reply = await askClaude(emailContext, personId, env, null, useTools);
    return reply;
  } catch (err) {
    console.error('[GCHAT] Gmail Share to Chat error:', err.message);
    return `I had trouble fetching that email: ${err.message}. Try pasting the email content directly or telling me the subject line so I can search for it.`;
  }
}

/**
 * Fetch a Gmail thread and format it as readable text.
 */
async function fetchGmailThread(threadId, env) {
  const data = await gmailApiCall('GET', `threads/${threadId}?format=full`, env);
  if (!data.messages?.length) return null;

  let formatted = '';
  for (const msg of data.messages) {
    const headers = (msg.payload?.headers || []).reduce((acc, h) => {
      acc[h.name.toLowerCase()] = h.value;
      return acc;
    }, {});

    let body = '';
    if (msg.payload?.body?.data) {
      body = atob(msg.payload.body.data.replace(/-/g, '+').replace(/_/g, '/'));
    } else if (msg.payload?.parts) {
      const textPart = msg.payload.parts.find(p => p.mimeType === 'text/plain');
      if (textPart?.body?.data) {
        body = atob(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/'));
      }
    }

    formatted += `From: ${headers.from || 'unknown'}\n`;
    formatted += `To: ${headers.to || ''}\n`;
    formatted += `Date: ${headers.date || ''}\n`;
    formatted += `Subject: ${headers.subject || '(no subject)'}\n`;
    formatted += `\n${body.substring(0, 3000)}\n`;
    formatted += '---\n';
  }

  return formatted;
}

// Helper: format response for Google Chat (Add-on or standalone)
/**
 * Truncate a reply to fit Google Chat's message size limit (~4096 chars).
 */
function truncateGChatReply(reply) {
  const maxLen = 4000;
  if (reply && reply.length > maxLen) {
    const truncated = reply.substring(0, maxLen - 200);
    const lastNewline = truncated.lastIndexOf('\n');
    return (lastNewline > maxLen - 1000 ? truncated.substring(0, lastNewline) : truncated) +
      '\n\n_(Response truncated. Ask a follow-up for more detail.)_';
  }
  return reply || 'No response generated';
}

function sendGChatResponse(text, isAddon) {
  let body;
  if (isAddon) {
    body = JSON.stringify({
      hostAppDataAction: {
        chatDataAction: {
          createMessageAction: {
            message: { text }
          }
        }
      }
    });
  } else {
    body = JSON.stringify({ text });
  }
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}
