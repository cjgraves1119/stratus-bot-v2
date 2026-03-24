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
  const skus = [...merged.keys()];
  const qtys = skus.map(s => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${skus.join(',')}&qty=${qtys.join(',')}`;
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
  const pricingIntent = /\b(COST|PRICE|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COST|WHAT IS THE COST|WHAT('S| IS) THE PRICE|CART TOTAL|BREAKDOWN|ESTIMATE)\b/i.test(text);
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
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
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
  if (/\b(LICENSE\s+ONLY|JUST\s+THE\s+LICENSE|JUST\s+LICENSE|LICENSE[S]?\s+ONLY|NO\s+HARDWARE|RENEWAL\s+ONLY)\b/.test(upper)) {
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

    // Show EOL warnings
    if (eolFound.length > 0) {
      for (const { baseModel, replacement } of eolFound) {
        if (_hasAlt(replacement)) {
          lines.push(`⚠️ **${baseModel}** is End-of-Life. Replacements: **${replacement[0]}** (1G Uplink) / **${replacement[1]}** (10G Uplink)`);
        } else {
          lines.push(`⚠️ **${baseModel}** is End-of-Life. Replacement: **${_primary(replacement)}**`);
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

      if (hasDualUplink) {
        lines.push(`**Option 2 — Hardware Refresh, 1G Uplink (${_buildUpgradeMap(eolFound, 0)}):**`);
        for (const term of terms) {
          const urlItems = _buildRefreshItems(term, 0);
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
            lines.push(`${termLabel}: ${url}`);
            lines.push('');
          }
        }
        lines.push(`**Option 3 — Hardware Refresh, 10G Uplink (${_buildUpgradeMap(eolFound, 1)}):**`);
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
        lines.push(`**Option 2 — Hardware Refresh (${_buildUpgradeMap(eolFound, 0)}):**`);
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

    // List all EOL warnings first
    for (const { baseSku, replacement } of eolItems) {
      if (_hasAlt(replacement)) {
        lines.push(`⚠️ **${baseSku}** is End-of-Life. Replacements: **${replacement[0]}** (1G Uplink) / **${replacement[1]}** (10G Uplink)`);
      } else {
        lines.push(`⚠️ **${baseSku}** is End-of-Life. Replacement: **${_primary(replacement)}**`);
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
      lines.push(`**Option 1 — Renew Existing Licenses:**`);
      for (const term of terms) {
        const urlItems = [];
        for (const { baseSku, qty } of eolItems) {
          const renewLicenses = _getEolRenewalLicenses(baseSku);
          if (renewLicenses) {
            const licSku = renewLicenses.find(l => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
        }
        // Also include non-EOL resolved items — LICENSE ONLY (Option 1 is renewal, no hardware)
        for (const { qty, licenseSkus } of resolvedItems) {
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
        if (!modifiers.licenseOnly) urlItems.push({ sku: replHwSku, qty });
        if (replLicenses && !modifiers.hardwareOnly) {
          const licSku = replLicenses.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
      }
      // Also include non-EOL resolved items — LICENSE ONLY (refresh is for EOL hardware only)
      for (const { qty, licenseSkus } of resolvedItems) {
        if (licenseSkus && !modifiers.hardwareOnly) {
          const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
      }
      return urlItems;
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
      lines.push(`**Option 2 — Hardware Refresh, 1G Uplink (${_buildUpgradeMap(eolItems, 0)}):**`);
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

      lines.push(`**Option 3 — Hardware Refresh, 10G Uplink (${_buildUpgradeMap(eolItems, 1)}):**`);
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
      lines.push(`**Option 2 — Hardware Refresh (${_buildUpgradeMap(eolItems, 0)}):**`);
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
APs (CW Wi-Fi 6E): CW9162I, CW9163E, CW9164I, CW9166I, CW9166D1
APs (CW Wi-Fi 7): CW9172H (Hospitality)
MX Security: MX67, MX67W, MX67C, MX67C-NA, MX68, MX68W, MX68CW, MX68CW-NA, MX75, MX85, MX95, MX105, MX250, MX450
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

When you identify ANY EOL product, ALWAYS flag it in Important Notes with EOS/End-of-Support dates AND include both Option 1 (renewal, license-only) and Option 2 (hardware refresh with replacement hardware + all licenses). If any replacement switch has 1G/10G uplink variants, show Option 2 (1G Uplink) and Option 3 (10G Uplink).

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

**Important Notes:**
• Flag ALL EOL products found (check EVERY product against the EOL list above)
• Flag any license overages
• Flag any anomalies (0 licensed but active devices, etc.)

**Option 1 — Renew Existing Licenses:**

1-Year Co-Term: {URL with all license SKUs at determined quantities}

3-Year Co-Term: {URL with all license SKUs at determined quantities}

5-Year Co-Term: {URL with all license SKUs at determined quantities}

If ANY EOL products were found, ALWAYS include a refresh section without being asked:

**Option 2 — Hardware Refresh ({source}→{replacement} mappings):**

3-Year Co-Term: {URL with replacement hardware SKUs (-HW suffix) + ALL license SKUs including non-EOL ones}

The refresh option replaces EOL hardware with successors and carries over ALL other licenses from the renewal. Default to 3-Year for refresh unless user specifies otherwise. If any replacement switch has 1G/10G uplink variants (4G/4X suffix), show Option 2 for 1G Uplink and Option 3 for 10G Uplink.

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
- Always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term
- URL-only output by default for simple quotes
- For dashboard screenshots, ALWAYS use the standardized format above
- Keep responses concise but complete — never skip EOL products
- NEVER use bullet points (•) before URLs. Just put the URL on its own line after the term label.
- Use bullet points (•) only for License Analysis and Important Notes sections, never for URLs

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
    const response = await fetch('https://api.anthropic.com/v1/messages', {
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

// ─── Claude API (direct fetch, no SDK) ───────────────────────────────────────
async function askClaude(userMessage, personId, env, imageData = null) {
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
    const pricingIntent = /\b(COST|PRICE|PRICING|HOW MUCH|TOTAL|CART TOTAL|BREAKDOWN|ESTIMATE)\b/i.test(userMessage);
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
    const messages = [...history, { role: 'user', content: userContent }];

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system: systemPrompt,
        messages
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic API error:', response.status, errBody);
      return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44".`;
    }

    const data = await response.json();
    const reply = data.content[0].text;

    if (personId) {
      await addToHistory(kv, personId, 'user', userMessage);
      await addToHistory(kv, personId, 'assistant', reply);
    }

    return reply;
  } catch (err) {
    console.error('Claude API error:', err.message);
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

    // Health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({
        status: 'Stratus AI (Google Chat) running',
        version: '1.0.0-gchat',
        runtime: 'cloudflare-workers'
      }), {
        headers: { 'Content-Type': 'application/json' }
      });
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

        // Process through the deterministic engine (same as Webex bot)
        let reply;

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

        if (!reply) {
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

        if (!reply) {
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            reply = pricingReply;
          }
        }

        if (!reply) {
          reply = await askClaude(text, personId, env);
        }

        // Adapt markdown for Google Chat (* instead of **)
        reply = adaptMarkdownForGChat(reply);

        // Truncate if needed (Google Chat limit ~4096 chars for add-on responses)
        if (reply.length > 4000) {
          const truncated = reply.substring(0, 3800);
          const lastNewline = truncated.lastIndexOf('\n');
          reply = (lastNewline > 3000 ? truncated.substring(0, lastNewline) : truncated) + '\n\n_(Response truncated)_';
        }

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

        if (!reply) {
          // Try deterministic pricing calculator
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            reply = pricingReply;
          }
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

// Helper: format response for Google Chat (Add-on or standalone)
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
