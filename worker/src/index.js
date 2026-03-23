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
  MX95: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95//105_Datasheet',
  MX105: 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/MX95//105_Datasheet',
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

async function getBotPersonId(token) {
  if (cachedBotPersonId) return cachedBotPersonId;
  const res = await fetch('https://webexapis.com/v1/people/me', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  cachedBotPersonId = data.id;
  return cachedBotPersonId;
}

// ─── Webex Helpers ───────────────────────────────────────────────────────────
async function getMessage(messageId, token) {
  const res = await fetch(`https://webexapis.com/v1/messages/${messageId}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  return res.json();
}

async function downloadWebexFile(fileUrl, token) {
  try {
    const res = await fetch(fileUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/png';
    const arrayBuffer = await res.arrayBuffer();
    // Convert to base64 using Web APIs
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    return { base64, mediaType: contentType.split(';')[0].trim() };
  } catch (err) {
    console.error('File download error:', err.message);
    return null;
  }
}

async function sendMessage(roomId, markdown, token) {
  await fetch('https://webexapis.com/v1/messages', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ roomId, markdown })
  });
}

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

  if (/^MS130R-/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    return [
      { term: '1Y', sku: `LIC-MS150-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS150-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS150-${ports}-5Y` }
    ];
  }

  // MS125: Uses -Y suffix (not -YR) — LIC-MS125-{variant}-{1Y|3Y|5Y}
  const ms125Match = upper.match(/^MS125-(.+)/);
  if (ms125Match) {
    const variant = ms125Match[1];
    return [
      { term: '1Y', sku: `LIC-MS125-${variant}-1Y` },
      { term: '3Y', sku: `LIC-MS125-${variant}-3Y` },
      { term: '5Y', sku: `LIC-MS125-${variant}-5Y` }
    ];
  }

  // MS390: Uses {portCount}{A|E}-{term}Y format (NOT legacy -1YR format)
  // MS390-24UX → LIC-MS390-24E-1Y, MS390-48P → LIC-MS390-48E-1Y
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

  const legacyMatch = upper.match(/^(MS\d{3})-(.+)/);
  if (legacyMatch && !upper.startsWith('MS130') && !upper.startsWith('MS150')) {
    const model = legacyMatch[1];
    let port = legacyMatch[2];
    // MS350-48X uses the 48-port license (LIC-MS350-48, no X)
    // MS350-24X has its own license (LIC-MS350-24X), so only strip X from 48-port
    if (model === 'MS350' && port === '48X') port = '48';
    return [
      { term: '1Y', sku: `LIC-${model}-${port}-1YR` },
      { term: '3Y', sku: `LIC-${model}-${port}-3YR` },
      { term: '5Y', sku: `LIC-${model}-${port}-5YR` }
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

// ─── Common Mistakes ─────────────────────────────────────────────────────────
function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }
  return null;
}

// ─── SKU Validation ──────────────────────────────────────────────────────────
function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();
  const mistake = fixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest };
  if (VALID_SKUS.has(upper)) {
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }
  if (isEol(upper)) return { valid: true, eol: true };
  if (/^MA-/.test(upper)) return { valid: true };
  const family = detectFamily(upper);
  if (family && catalog[family]) {
    const partialMatches = catalog[family].filter(s => s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase()));
    const suggestions = partialMatches.length > 0 ? partialMatches : catalog[family].slice(0, 5);
    const isPartialMatch = partialMatches.length > 1;
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions, isPartialMatch };
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
  if (/^MS390/.test(sku)) return 'MS390';
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
    /\bHOW (DOES|DO|MANY|MUCH THROUGHPUT|FAST)\b/, /\bSPECS?\b/, /\bDIFFERENCE BETWEEN\b/
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
      if (beforeQty) qty = parseInt(beforeQty[1]);
      else if (afterQty) qty = parseInt(afterQty[1]);
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
      return v.valid || (!v.valid && v.isPartialMatch && v.suggest && v.suggest.length > 0);
    });
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
        for (const s of v.suggest) lines.push(`• ${s}`);
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
        // Also include any non-EOL resolved items in the renewal URL
        for (const { hwSku, qty, licenseSkus } of resolvedItems) {
          if (!modifiers.licenseOnly) urlItems.push({ sku: hwSku, qty });
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
      // Also include any non-EOL resolved items
      for (const { hwSku, qty, licenseSkus } of resolvedItems) {
        if (!modifiers.licenseOnly) urlItems.push({ sku: hwSku, qty });
        if (licenseSkus && !modifiers.hardwareOnly) {
          const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
          if (licSku) urlItems.push({ sku: licSku, qty });
        }
      }
      return urlItems;
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

## LICENSE RULES (term format matters!)
Three license tiers exist for MX/Z:
- ENT (Enterprise): Available for ALL product families
- SEC (Advanced Security): Available for MX (all models), Z4/Z4C
- SDW (SD-WAN): Available for MX (all models) only

Specific mappings:
- All APs (MR + CW) → LIC-ENT-1YR / LIC-ENT-3YR / LIC-ENT-5YR
- MX older (67/68/250/450) → LIC-MX{model}-{ENT|SEC}-1YR / -3YR / -5YR
- MX newer (75/85/95/105) → LIC-MX{model}-{ENT|SEC|SDW}-1Y / -3Y / -5Y
- Z1/Z3/Z3C → LIC-Z{model}-ENT-1YR / -3YR / -5YR
- Z4/Z4C → LIC-Z{model}-{SEC|ENT}-1Y / -3Y / -5Y (default SEC)
- MG → LIC-MG{model}-ENT-1Y / -3Y / -5Y
- MV → LIC-MV-1YR / -3YR / -5YR
- MT → LIC-MT-1Y / -3Y / -5Y
- MS130 compact (8/8P/8X/12X) → LIC-MS130-CMPT-1Y / -3Y / -5Y
- MS130 standard (24/48) → LIC-MS130-{24/48}-1Y / -3Y / -5Y
- MS150 → LIC-MS150-{24/48}-1Y / -3Y / -5Y
- MS390 → LIC-MS390-{model}-{term} (e.g. LIC-MS390-48UX-1YR)
- MS450 → LIC-MS450-{model}-{term} (e.g. LIC-MS450-12-1YR)
- Legacy switches → LIC-MS{model}-{port}-1YR / -3YR / -5YR

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
- Use bullet points (•) only for License Analysis and Important Notes sections, never for URLs`;

// ─── Claude API (direct fetch, no SDK) ───────────────────────────────────────
async function askClaude(userMessage, personId, env, imageData = null) {
  if (!env.ANTHROPIC_API_KEY) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';
  try {
    const upper = userMessage.toUpperCase();
    const wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?LATEST|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET)\b/i.test(userMessage);

    let systemPrompt = SYSTEM_PROMPT;
    const kv = env.CONVERSATION_KV;

    if (wantsLiveDatasheet) {
      const datasheetContext = await getRelevantDatasheetContext(userMessage);
      if (!datasheetContext && personId) {
        const history = await getHistory(kv, personId);
        const lastAssistant = [...history].reverse().find(h => h.role === 'assistant');
        if (lastAssistant) {
          const historyContext = await getRelevantDatasheetContext(lastAssistant.content);
          if (historyContext) {
            systemPrompt += '\n\n' + historyContext;
            systemPrompt += '\n\nThe user has asked you to verify specs against the latest datasheet. Compare the live datasheet data above with what you previously told them and note any differences.';
          }
        }
      } else if (datasheetContext) {
        systemPrompt += '\n\n' + datasheetContext;
        systemPrompt += '\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.';
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

// ─── Main Worker Entry Point ─────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response(JSON.stringify({ status: 'Stratus AI running', version: '2.0.0-cf', runtime: 'cloudflare-workers' }), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Webhook handler
    if (request.method === 'POST' && url.pathname === '/webhook') {
      // Respond 200 immediately (Webex requires fast response)
      // Use ctx.waitUntil to process in background
      const body = await request.json();

      ctx.waitUntil((async () => {
        try {
          const event = body;
          if (event.resource !== 'messages' || event.event !== 'created') return;

          const token = env.WEBEX_BOT_TOKEN;
          const kv = env.CONVERSATION_KV;
          const botId = await getBotPersonId(token);
          const personId = event.data.personId;
          if (personId === botId) return;

          const msg = await getMessage(event.data.id, token);
          // Prefer html field to preserve line breaks (Webex text field collapses newlines to spaces)
          let text;
          if (msg.html) {
            text = msg.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
          } else {
            text = (msg.text || '').trim();
          }
          const roomId = msg.roomId;

          // Check for image attachments
          if (msg.files && msg.files.length > 0) {
            const fileUrl = msg.files[0];
            const imageData = await downloadWebexFile(fileUrl, token);
            if (imageData && imageData.mediaType.startsWith('image/')) {
              const prompt = text || 'A user sent this image. Analyze it and respond accordingly.';
              const claudeReply = await askClaude(prompt, personId, env, imageData);
              if (claudeReply && claudeReply.trim()) {
                await sendMessage(roomId, claudeReply, token);
              } else {
                await sendMessage(roomId, `I received your image but wasn't able to generate a response. Could you try sending it again, or describe what you need?`, token);
              }
              return;
            }
            // Image download failed — notify user instead of silently dropping
            if (msg.files.length > 0) {
              if (text) {
                // Fall through to text processing below
              } else {
                await sendMessage(roomId, `I received a file attachment but couldn't process it as an image. Could you try sending it again?`, token);
                return;
              }
            }
          }

          if (!text) return;

          // Try deterministic EOL date lookup first (before quoting engine)
          const eolDateReply = handleEolDateRequest(text);
          if (eolDateReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', eolDateReply);
            await sendMessage(roomId, eolDateReply, token);
            return;
          }

          // Try deterministic engine first
          const parsed = parseMessage(text);

          if (parsed) {
            const result = buildQuoteResponse(parsed);

            if (!result.needsLlm && result.message) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', result.message);
              await sendMessage(roomId, result.message, token);
              return;
            }

            if (result.revision) {
              const history = await getHistory(kv, personId);
              if (history.length > 0) {
                const claudeReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env);
                await sendMessage(roomId, claudeReply, token);
                return;
              }
              await sendMessage(roomId, `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`, token);
              return;
            }

            if (result.errors && result.errors.length > 0) {
              const errorContext = result.errors.join('\n');
              const claudeReply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
              await sendMessage(roomId, claudeReply, token);
              return;
            }
          }

          // Try deterministic pricing calculator before Claude fallback
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            await sendMessage(roomId, pricingReply, token);
            return;
          }

          // Full fallback to Claude API
          const claudeReply = await askClaude(text, personId, env);
          await sendMessage(roomId, claudeReply, token);

        } catch (err) {
          console.error('Webhook error:', err.message, err.stack);
          try {
            const event = body;
            if (event?.data?.roomId) {
              await sendMessage(event.data.roomId, `⚠️ Something went wrong processing your request. Try again with a specific SKU like "quote 10 MR44".`, env.WEBEX_BOT_TOKEN);
            }
          } catch (notifyErr) {
            console.error('Failed to send error notification:', notifyErr.message);
          }
        }
      })());

      return new Response('OK', { status: 200 });
    }

    return new Response('Not Found', { status: 404 });
  }
};
