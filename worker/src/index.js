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
// Routes Anthropic API calls through CF AI Gateway for caching, analytics,
// and rate limiting. Dashboard: dash.cloudflare.com > AI > AI Gateway
const ANTHROPIC_API_URL = 'https://gateway.ai.cloudflare.com/v1/ec1888c5a0b51dc3eebf6bae13a3922b/stratus-ai-bot/anthropic/v1/messages';

// ─── Data Imports (embedded at build time by wrangler) ──────────────────────
import pricesData from './data/prices.json';
import catalogData from './data/auto-catalog.json';
import specsData from './data/specs.json';
import accessoriesData from './data/accessories.json';

const staticPrices = pricesData.prices;
let livePrices = null;       // KV-cached prices (refreshed daily by GChat worker cron)
let livePricesCacheTs = 0;   // When we last read from KV (ms)
const LIVE_PRICES_CACHE_TTL = 300000; // 5 minutes in-memory cache

// ── Analytics Engine: Real-time telemetry (Webex bot) ───────────────────────
function writeMetric(env, { path, model, durationMs, inputTokens, outputTokens, costUsd, personId }) {
  if (!env?.BOT_METRICS) return;
  try {
    env.BOT_METRICS.writeDataPoint({
      blobs: ['webex', path || 'unknown', model || 'none'],
      doubles: [durationMs || 0, inputTokens || 0, outputTokens || 0, costUsd || 0],
      indexes: [personId || 'anonymous']
    });
  } catch (_) {}
}

// ── D1 Analytics Helper (Webex bot) ─────────────────────────────────────────
async function logBotUsageToD1(env, { personId, requestText, responsePath, model, inputTokens, outputTokens, costUsd, durationMs, errorMessage }) {
  if (!env?.ANALYTICS_DB) return;
  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO bot_usage (bot, person_id, request_text, response_path, model, input_tokens, output_tokens, cost_usd, duration_ms, error_message)
       VALUES ('webex', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      personId || null,
      (requestText || '').substring(0, 500),
      responsePath,
      model || null,
      inputTokens || 0,
      outputTokens || 0,
      costUsd || 0,
      durationMs || null,
      errorMessage || null
    ).run();
  } catch (err) {
    console.error('[D1] bot_usage insert error:', err.message);
  }
}

// ── Workflow Trace Helper (live flow visualization) ─────────────────────────
// Lightweight per-step logger for the dashboard's live workflow animation.
// Each request gets a trace_id; each pipeline step logs node_id + status.
// Fire-and-forget — never blocks the request pipeline.
function makeTraceId() {
  return crypto.randomUUID ? crypto.randomUUID() : `t-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureTraceTable(db) {
  if (!db || globalThis.__traceTableReady) return;
  try {
    await db.prepare(`CREATE TABLE IF NOT EXISTS workflow_traces (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      trace_id TEXT NOT NULL,
      bot TEXT NOT NULL,
      node_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'enter',
      ts_ms REAL NOT NULL,
      metadata TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_traces_created ON workflow_traces(created_at)`).run();
    await db.prepare(`CREATE INDEX IF NOT EXISTS idx_traces_trace_id ON workflow_traces(trace_id)`).run();
    globalThis.__traceTableReady = true;
  } catch (_) { globalThis.__traceTableReady = true; /* may already exist */ }
}

function createTracer(env, bot) {
  const traceId = makeTraceId();
  const db = env?.ANALYTICS_DB;
  const steps = []; // buffer for batch insert
  const t0 = Date.now();

  return {
    traceId,
    /** Log a node step. status: 'enter' | 'exit' | 'skip' */
    step(nodeId, status = 'enter', meta = null) {
      steps.push({ nodeId, status, tsMs: Date.now() - t0, meta });
    },
    /** Flush all buffered steps to D1 (call in ctx.waitUntil) */
    async flush() {
      if (!db || steps.length === 0) return;
      try {
        await ensureTraceTable(db);
        const stmt = db.prepare(
          `INSERT INTO workflow_traces (trace_id, bot, node_id, status, ts_ms, metadata) VALUES (?, ?, ?, ?, ?, ?)`
        );
        const batch = steps.map(s =>
          stmt.bind(traceId, bot, s.nodeId, s.status, s.tsMs, s.meta ? JSON.stringify(s.meta) : null)
        );
        await db.batch(batch);
      } catch (err) {
        console.error('[D1] trace flush error:', err.message);
      }
    }
  };
}

// ── R2 Object Storage Helpers (Webex bot) ──────────────────────────────────
// Store and retrieve files (quote PDFs, attachments, reports) in R2.

async function r2Put(env, key, data, opts = {}) {
  if (!env?.BOT_STORAGE) return null;
  try {
    await env.BOT_STORAGE.put(key, data, {
      httpMetadata: opts.httpMetadata || {},
      customMetadata: opts.customMetadata || {}
    });
    return key;
  } catch (err) {
    console.error('[R2] put error:', key, err.message);
    return null;
  }
}

async function r2Get(env, key) {
  if (!env?.BOT_STORAGE) return null;
  try {
    const obj = await env.BOT_STORAGE.get(key);
    if (!obj) return null;
    return {
      data: await obj.arrayBuffer(),
      httpMetadata: obj.httpMetadata,
      customMetadata: obj.customMetadata,
      size: obj.size,
      uploaded: obj.uploaded
    };
  } catch (err) {
    console.error('[R2] get error:', key, err.message);
    return null;
  }
}

async function r2Delete(env, key) {
  if (!env?.BOT_STORAGE) return false;
  try {
    await env.BOT_STORAGE.delete(key);
    return true;
  } catch (err) {
    console.error('[R2] delete error:', key, err.message);
    return false;
  }
}

async function r2List(env, prefix, limit = 100) {
  if (!env?.BOT_STORAGE) return [];
  try {
    const listed = await env.BOT_STORAGE.list({ prefix, limit });
    return listed.objects.map(o => ({
      key: o.key,
      size: o.size,
      uploaded: o.uploaded
    }));
  } catch (err) {
    console.error('[R2] list error:', prefix, err.message);
    return [];
  }
}

// Load live prices from KV (if available). Cached in-memory per isolate.
// GChat worker's daily cron writes to PRICES_KV; this worker reads from it.
async function loadLivePrices(env) {
  const kv = env?.PRICES_KV || env?.CONVERSATION_KV;
  if (!kv || typeof kv.get !== 'function') return null;
  const now = Date.now();
  if (livePrices && (now - livePricesCacheTs) < LIVE_PRICES_CACHE_TTL) {
    return livePrices;
  }
  try {
    const stored = await kv.get('prices_live', 'json');
    if (stored?.prices) {
      livePrices = stored.prices;
      livePricesCacheTs = now;
      console.log(`[PRICES] Loaded live prices from KV (refreshed: ${stored.refreshedAt}, ${stored.stats?.updated || '?'} updated)`);
      return livePrices;
    }
  } catch (err) {
    console.error(`[PRICES] KV read error: ${err.message}`);
  }
  return null;
}

// Merged price lookup: live KV prices → static prices.json fallback
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});

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
        // Base extraction now includes Catalyst C9xxx so bare "C9300" / "C9200L" resolve.
        const baseMatch = model.match(/^(MS\d{3}|MX\d+|MR\d+|MV\d+|MG\d+|MT\d+|CW\d+[A-Z]*\d*|Z4|C9\d{3}[A-Z]*)/);
        if (baseMatch && familyData[baseMatch[1]] && !found.some(f => f.model === baseMatch[1])) {
          found.push({ model: baseMatch[1], specs: familyData[baseMatch[1]] });
        }
        // Family-level fallback: user asked about a family stem (C9300, MS150, etc.) that is
        // NOT a variant key. Surface the _family summary + variant names so Claude has context
        // instead of defaulting to "I don't have verified specs."
        const familyStem = baseMatch ? baseMatch[1] : model;
        const familyMatches = (family === familyStem) ||
                              (family === `${familyStem}-M`) ||
                              family.startsWith(`${familyStem}-`) ||
                              family.startsWith(`${familyStem}`);
        if (familyMatches && familyData._family && !found.some(f => f.model === family)) {
          const variantList = Object.keys(familyData).filter(k => !k.startsWith('_'));
          found.push({
            model: family,
            specs: {
              family: familyData._family,
              variants: variantList,
              _stacking: familyData._stacking || undefined
            }
          });
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
  let context = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE SOURCE)\n';
  context += 'CRITICAL: Use ONLY these specs when answering. Do NOT supplement with training data. These specs OVERRIDE any conflicting information in conversation history — if prior messages contain different numbers, they were wrong and these are correct.\n';
  context += 'If the user asks about a spec not listed here, say "I don\'t have that specific spec cached — want me to pull the latest datasheet to confirm?"\n';
  context += 'FORMATTING: This renders in Webex, which does NOT render pipe-delimited markdown tables. NEVER output rows like "| col | col |" — they render as literal pipe characters. For multi-model comparisons, use grouped bullets per model (e.g. "**MX95** · FW: 3 Gbps · VPN: 2.5 Gbps · 500 users") or a stacked list with bolded model names as headers.\n';
  // NOTE: Do NOT instruct the model to append a "Specs from product database" footer.
  // The caller (askLlamaProductInfo / askClaude) owns the source-attribution footer
  // and appends it in code based on sources{}. Having the model also emit one caused
  // a duplicate "Specs from product database. Want me to pull the latest datasheet to
  // verify?" line on every reply. Fixed 2026-04-23.

  for (const { model, specs: s } of unique) {
    context += `${model}: ${JSON.stringify(s)}\n`;
  }
  // Return object shape so askClaude can attribute sources in its transparency footer.
  // `text` preserves the legacy string payload; `models` is the list of resolved keys.
  return { text: context, models: unique.map(u => u.model) };
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
  const fetches = uniqueUrls.map(async (url, idx) => {
    const text = await fetchDatasheet(url);
    return text ? { idx, url, body: `[Datasheet: ${url}]\n${text}` } : null;
  });
  const fetchRows = (await Promise.all(fetches)).filter(Boolean);
  if (fetchRows.length === 0) return null;
  const results = fetchRows.map(r => r.body);
  const fetchedUrls = fetchRows.map(r => r.url);
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
    'FORMATTING: This renders in Webex — NEVER output pipe-delimited markdown tables ("| col | col |"). They render as literal pipes. Use stacked bolded model headers followed by spec bullets per model.\n\n' +
    results.join('\n\n');
  if (staticSpecs.length > 0) {
    context += '\n\n## CACHED SPECS (fallback if datasheet content is unclear)\n' +
      staticSpecs.join('\n');
  }
  // Return object shape so askClaude can attribute sources in its transparency footer.
  return { text: context, models: keys, urls: fetchedUrls };
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
    // Self-healing: accept both shapes.
    //   {messages: [...]}  — canonical shape written by addToHistory
    //   [...]              — raw array accidentally written by a prior bug
    //                        (legacy Llama waterfall path kv.put, fixed 2026-04-23)
    if (Array.isArray(data)) return data;
    return data.messages || [];
  } catch {
    return [];
  }
}

async function addToHistory(kv, personId, role, content) {
  if (!kv) return;
  try {
    // Strip image data from content before storing — images are large (MB of base64)
    // and cause API errors when replayed from history. Replace with a text placeholder.
    let storable = content;
    if (Array.isArray(content)) {
      const textParts = content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      const hasImage = content.some(c => c.type === 'image');
      storable = (hasImage ? '[User sent an image] ' : '') + textParts.join(' ');
    }

    let data = await kv.get(`conv:${personId}`, 'json');
    // Self-heal: a legacy bug wrote the record as a raw array.
    // Normalize any non-canonical shape to {messages: [...]} before pushing,
    // otherwise the push throws TypeError and the write is silently dropped
    // by the try/catch, leaving the KV record stuck at its corrupted state.
    if (!data) {
      data = { messages: [] };
    } else if (Array.isArray(data)) {
      data = { messages: data };
    } else if (!Array.isArray(data.messages)) {
      data = { messages: [] };
    }
    data.messages.push({ role, content: storable });
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

// ─── Workers AI Vision Cascade Test ──────────────────────────────────────────
// Tries 3 vision models in order. Returns first successful result tagged with model name.
// Goal: find a free CF model that can extract structured data from dashboard screenshots,
// so we can feed the text output to Claude instead of the expensive base64 image.


// ═══════════════════════════════════════════════════════════════
// CF Workers AI — Tiered routing layer
// Deterministic engine → CF intent classifier → Claude fallback
// ═══════════════════════════════════════════════════════════════
const CF_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';

// Feature flag: when true, Schema V2 classifier (Llama) drives routing instead of legacy
// Enabled 2026-04-20 after 74-fixture benchmark: Llama V2 93% accuracy at 1.7s p50.
// To rollback: flip this to false and redeploy (or git revert the cutover commit).
const USE_V2_CLASSIFIER = true;

// ═══ CF_GROUNDING_RULES ═══
// System-prompt addendum applied to Llama/Gemma on product_info requests.
// Targets failure modes from 2026-04-23 benchmark: flagship hallucination,
// multi-product URL concatenation, ignored injected PRICE lines, training-data drift.
// Round 2 (Claude 4.6 vs CF with these rules): Llama 67%→83%, Gemma 75%→79%.
// Reused by both /api/benchmark-product-info and the product_info waterfall in askClaude.
const CF_GROUNDING_RULES = `

## CRITICAL RULES — FOLLOW EXACTLY (these override any conflicting instruction above)

1. GROUNDING. Every factual claim must be directly supported by the PRODUCT SPECS, DATASHEET, PRICING, or ACCESSORIES context provided in this system prompt. Do NOT supplement with training-data facts. If a spec is missing, say "I do not have that data" — never guess.

2. FLAGSHIP / HIGHEST-END / BEST. Do NOT call any product a "flagship", "highest-end", "top-tier", "best", or equivalent UNLESS that model has the single highest value on the relevant spec (throughput Gbps, port count, radio generation) among every product listed in the injected specs above. When the user asks for the flagship and the true flagship is not in context, explicitly say the highest-end model in that family (MX450 for MX, MS450 for MS, CW9176 for CW Wi-Fi 7) and note you can pull its full specs on request.

3. PRICING. If the injected context contains a PRICING section or lines starting with "PRICE:", you MUST use those exact prices. Never respond "I don't have pricing" when pricing is present above. Copy the price values verbatim — do not round, estimate, or re-derive.

4. MULTI-PRODUCT ORDER URLS. When the user asks about multiple distinct products and you output Stratus order links, produce ONE URL per product. Never concatenate SKUs from different products into a single item list. Format: https://stratusinfosystems.com/order/?item={SKU}&qty={N}

5. UNCERTAINTY. If a requested spec, SKU, or price is not in the context above, say so plainly. Do NOT invent SKUs that are not in the SPECS / PRICING / DATASHEET blocks.

6. WEBEX FORMATTING. This response renders in Webex chat, which does NOT render markdown tables (| col | col |). For multi-product comparisons, use grouped bullets per model instead. Format:
**ModelA**
• Spec1: value
• Spec2: value

**ModelB**
• Spec1: value
• Spec2: value

Followed by a short **Summary:** paragraph naming the practical difference. Keep bolding for model names and spec categories only. Never output a pipe-delimited table row.
`;

// ═══ PRODUCT_INFO WATERFALL CLASSIFIER ═══
// Cheap regex-based router called after V2 classifier returns intent=product_info.
// Decides which model handles the answer-generation step:
//
//   'simple_lookup' → Llama 4 Scout + CF_GROUNDING_RULES (fast, free, grounded-datasheet)
//     • Single-model spec: "specs of the MS150-24P", "what does the MR44 do"
//     • License: "what license does X need", "license term for Y"
//     • EOL: "what replaces the MR42", "is MX67 EOL"
//     • Datasheet followup (prior_context present): "get specifics from datasheet"
//     • Multi-model spec comparison: "MX95 vs MX105", "difference between MR46 and CW9164"
//       (injected specs block contains both — Llama reads, tabulates, no judgment needed)
//
//   'advisory' → Claude Sonnet 4.6 (keeps current accuracy)
//     • Category superlatives: "highest-end", "flagship", "best", "most powerful", "top"
//     • Pricing: "cost", "price", "how much", "budget", "breakdown"
//     • Recommendations: "recommend", "what should I use", "what do I need for X"
//     • Single-model comparison against non-Meraki gear (no multi-Meraki-model in message)
//
// Default on ambiguity: 'advisory' (Claude). Bias toward accuracy — the waterfall
// only wins if it never regresses quality. Flag: USE_PRODUCT_INFO_WATERFALL=true
function classifyProductInfoSubtype(userMessage, hasImage) {
  if (hasImage) return 'advisory';
  const m = (userMessage || '').trim();
  if (!m) return 'advisory';
  const upper = m.toUpperCase();

  // Advisory signals — any match forces advisory path
  const SUPERLATIVE = /\b(HIGHEST[\s-]?END|FLAGSHIP|TOP[\s-]?(TIER|OF[\s-]THE[\s-]LINE|END)|BEST|MOST\s+POWERFUL|BIGGEST|FASTEST|LARGEST|MOST\s+CAPABLE)\b/;
  const COMPARISON = /\b(COMPARE|COMPARISON|VS\.?|VERSUS|DIFFERENCE\s+BETWEEN|DIFFER|BETTER\s+THAN)\b/;
  const PRICING = /\b(COSTS?|PRICES?|PRICING|HOW\s+MUCH|BUDGET|BREAKDOWN|ESTIMATE|TOTAL|QUOTE\s+THE\s+COST|SPEND)\b/;
  const RECOMMEND = /\b(RECOMMEND|SUGGEST|WHAT\s+SHOULD\s+I|WHAT\s+DO\s+I\s+NEED|WHICH\s+(FIREWALL|SWITCH|AP|ACCESS\s+POINT|CAMERA|DEVICE|PRODUCT)|SIZE\s+(FOR|A)|FOR\s+A?\s*(SCHOOL|HOSPITAL|OFFICE|WAREHOUSE|CAMPUS)\s+(OF|WITH)?)\b/;
  const MULTI_MODEL = /\b(MR\d+|CW\d+|MX\d+|MS\d+|MV\d+|MT\d+|MG\d+|Z\d)\D+?(MR\d+|CW\d+|MX\d+|MS\d+|MV\d+|MT\d+|MG\d+|Z\d)\b/i;

  // Hard advisory gates — these require Claude's judgment
  if (SUPERLATIVE.test(upper)) return 'advisory';
  if (PRICING.test(upper)) return 'advisory';
  if (RECOMMEND.test(upper)) return 'advisory';

  // Spec comparison path — multi-model + comparison intent with NO superlative/pricing/recommend
  // above. Pure datasheet lookups ("MX95 vs MX105", "difference between MR46 and CW9164")
  // are well within Llama's grounded-spec ability per bench v2 (20/24 with CF_GROUNDING_RULES).
  if (MULTI_MODEL.test(m) && COMPARISON.test(upper)) return 'simple_lookup';
  if (MULTI_MODEL.test(m)) return 'simple_lookup';

  // Single-model comparisons against non-Meraki gear (e.g. "MR46 vs Ubiquiti U7") stay advisory
  if (COMPARISON.test(upper)) return 'advisory';

  // Simple-lookup signals
  const SINGLE_MODEL_SPEC = /\b(SPECS?|SPECIFICATIONS?|DETAILS?|FEATURES?|CAPABILIT|WHAT\s+IS\s+(THE\s+)?(MR|CW|MX|MS|MV|MT|MG|Z)\d+|TELL\s+ME\s+ABOUT|WHAT\s+DOES\s+(THE\s+)?(MR|CW|MX|MS|MV|MT|MG|Z)\d+\s+DO|INFO\s+ON)\b/;
  const LICENSE_Q = /\b(LICENS(E|ING)|WHAT\s+LICENSE|LICENSE\s+(TERM|TYPE|DOES)|LIC-ENT|LIC-MS|LIC-MX|LIC-MV|LIC-MT|LIC-MG)\b/;
  const EOL_Q = /\b(EOL|END[\s-]OF[\s-]LIFE|REPLACES?|REPLACEMENT|SUCCESSOR|MIGRATION\s+PATH|WHAT\s+(TO|SHOULD|DO)\s+(I\s+)?REPLACE|UPGRADE\s+PATH)\b/;
  const DATASHEET_FOLLOWUP = /\b(DATASHEET|SPEC\s+SHEET|SPECIFICS|MORE\s+DETAILS?|RADIO\s+COUNT|PORT\s+COUNT|THROUGHPUT)\b/;

  // Model-name gate for followup-style signals. Without a Meraki model in the message,
  // phrases like "pull the datasheet" or "more details" are pronoun followups that need
  // conversation history to resolve the referent — Claude has history loaded, the
  // waterfall's askLlamaProductInfo does not. Route those to Claude. (2026-04-23 fix.)
  const MODEL_IN_MSG = /\b(MR|CW|MX|MS|MV|MT|MG|Z)\d+[A-Z0-9-]*\b/i;
  const hasModel = MODEL_IN_MSG.test(m);

  if (SINGLE_MODEL_SPEC.test(upper)) return hasModel ? 'simple_lookup' : 'advisory';
  if (LICENSE_Q.test(upper)) return hasModel ? 'simple_lookup' : 'advisory';
  if (EOL_Q.test(upper)) return hasModel ? 'simple_lookup' : 'advisory';
  if (DATASHEET_FOLLOWUP.test(upper)) return hasModel ? 'simple_lookup' : 'advisory';

  // Default: advisory (Claude) — bias toward accuracy
  return 'advisory';
}

const CF_CLASSIFIER_PROMPT = `You are an intent classifier and clarification engine for a Cisco/Meraki quoting bot. Your job is to classify what the user wants and ask smart clarifying questions when their request is incomplete. You do NOT answer product questions — those go to a more capable AI.

Respond with ONLY a JSON object, nothing else.

Categories:
- "quote": User wants a quote or pricing. They mention a specific model (MR46, MS130-8P, MX67, CW9164, MT14, Z4, MG51, etc.) with or without a quantity, or a bare license SKU (LIC-ENT-3YR, LIC-MV-5YR), or a generic license request ("5 MR licenses", "MR44 license"). Even if the model is EOL or unknown to you, classify as "quote" — the backend validates SKUs. If no quantity specified, assume 1. Extract the clean request.
- "clarify": User wants a quote but is too vague OR specified an incomplete model that needs a variant selection. Generate a helpful clarification using the variant tables below. Examples: "quote me some switches" (which model?), "I need APs" (which model?), "quote 5 MS130-24" (1G or 10G uplinks?), "pricing for Meraki" (which product family?).
- "product_info": User is asking about specs, features, sizing, recommendations, comparisons, EOL, compatibility, or capabilities — NOT asking for a quote. Examples: "what firewall for 50 users", "difference between MR46 and CW9164", "does MX67 support SD-WAN", "is MV22 weatherproof", "is MR46 indoor or outdoor". Set reply to empty — these go to the advanced AI.
- "escalate": Complex requests needing the advanced AI. Use for: proposal writing, deployment planning, detailed technical analysis. Set reply to empty.
- "conversation": Greetings, thanks, farewells, jokes, identity questions, general chat, non-product topics, single characters ("q", "?", "!"), short reactions ("nice", "cool", "ok", "lol").

CRITICAL RULES:
- Never use "unclear" as an intent.
- product_info reply MUST be empty. Never answer product questions yourself.
- For "clarify", always generate a reply asking which specific model/variant.
- Single word "price" or "pricing" alone = "clarify".
- "MR44 license" or "licenses for 3 MT" = "quote".
- "LIC-ENT-3YR" or any bare license SKU = "quote".
- Any SKU + "hardware only", "hw only", "no license", "hardware no license" = "quote". Example: "MX85 hardware only no license" = quote for MX85-HW.
- Any SKU + "license only", "licenses only", "just the license", "renewal only" = "quote". Example: "MR46 license only 3 year" = quote for LIC-ENT-3YR.
- Any SKU + "add-on", "add on license", "co-term", "coterm" = "quote".
- SDW TIER RULE: Any MX model followed by "SDW", "SD-WAN", "SD WAN", "sdwan", "sd-wan", or suffix "-SDW" = "quote" for that MX with SD-WAN license. Examples: "MX85-SDW 3 year" → quote 1 MX85 with SD-WAN 3yr license; "MX75 sdwan" → quote 1 MX75 with SD-WAN license; "MX95 SD-WAN with licensing" → quote 1 MX95 with SD-WAN license. The base SKU is the MX model (e.g., "MX85"), the tier is SD-WAN. NEVER drop the SDW tier and NEVER classify these as "clarify".
- SWAP RULE: "swap X for Y", "replace X with Y", "change X to Y", "substitute X with Y" = "quote" for Y (with qty if given). Keep the swapped-out SKU X as context in extracted. Example: "swap MR44 for 5 MR46 3 year" → quote 5 MR46 with 3 year license (swapping out MR44). Treat swap as a single atomic quote, never as separate remove + add operations.
- A bare model number with no other context (e.g. "MX85", "MR46", "CW9164") = "quote" with qty 1.
- Renewal/refresh phrasing with a SKU = "quote": "renew MR46 licenses", "refresh 10 MR44s", "replace MV22".
- When generating variant clarifications, ONLY suggest models from the variant tables above. NEVER invent model numbers like "MS150-8" or "MS150-16" — those do not exist.
- If a bare family name is given (e.g., "MS150", "MS130") with a port count ambiguity, ask port count FIRST, then variant.

VARIANT CLARIFICATION TABLES (use when user gives an incomplete model):
MS switches with variants — if user says just the base model, ask which:
- MS130-8: 8-port compact (no variants)
- MS130-12: 12-port → MS130-12P (PoE, 1G) or MS130-12X (mGig, 10G uplinks)
- MS130-24: 24-port → MS130-24P (PoE, 1G uplinks) or MS130-24X (PoE, 10G uplinks)
- MS130-48: 48-port → MS130-48P (PoE, 1G uplinks) or MS130-48X (PoE, 10G uplinks)
- MS210-24: 24-port → MS210-24P (PoE) or MS210-24 (no PoE)
- MS210-48: 48-port → MS210-48FP (full PoE) or MS210-48LP (partial PoE) or MS210-48 (no PoE)
- MS225-24: 24-port → MS225-24P (PoE) or MS225-24 (no PoE)
- MS225-48: 48-port → MS225-48FP (full PoE) or MS225-48LP (partial PoE) or MS225-48 (no PoE)
- MS250-24: 24-port → MS250-24P (PoE) or MS250-24 (no PoE)
- MS250-48: 48-port → MS250-48FP (full PoE) or MS250-48LP (partial PoE) or MS250-48 (no PoE)
- MS390-24: → MS390-24P (PoE), MS390-24UX (mGig+UPOE), MS390-24U (mGig)
- MS390-48: → MS390-48P (PoE), MS390-48UX (mGig+UPOE), MS390-48UX2 (mGig+UPOE 2nd gen), MS390-48U (mGig)
- MS150-24: 24-port → MS150-24T-4G (no PoE, 1G uplinks), MS150-24P-4G (PoE, 1G uplinks), MS150-24T-4X (no PoE, 10G uplinks), MS150-24P-4X (PoE, 10G uplinks), MS150-24MP-4X (mGig PoE, 10G uplinks)
- MS150-48: 48-port → MS150-48T-4G (no PoE, 1G), MS150-48LP-4G (partial PoE, 1G), MS150-48FP-4G (full PoE, 1G), MS150-48T-4X (no PoE, 10G), MS150-48LP-4X (partial PoE, 10G), MS150-48FP-4X (full PoE, 10G), MS150-48MP-4X (mGig PoE, 10G)
- MS150 (no port count): Ask "24-port or 48-port?" first, then ask variant.

MX sizing by user count (for basic sizing clarifications):
- Up to 50 users: MX67 ($595) or MX68 ($795)
- Up to 200 users: MX75 ($2,195)
- Up to 600 users: MX85 ($3,995)
- Up to 2,000 users: MX95 ($7,995)
- Up to 5,000 users: MX105 ($12,995)
- Up to 10,000 users: MX250 ($19,995)
- Unlimited: MX450 ($34,995)

Product families (for vague "I need switches/APs/cameras" clarifications):
MR access points: MR28, MR36H, MR44 (End-of-Sale), MR46, MR57, MR78
CW Wi-Fi 7 access points: CW9162, CW9164, CW9166, CW9172, CW9176
MS switches: MS130 (8/12/24/48-port, 1G/10G), MS150 (24/48-port, 1G/10G, replaces MS210/220/225/320), MS390 (24/48-port, mGig), MS450 (12-port)
MX security appliances: MX67, MX68, MX75, MX85, MX95, MX105, MX250, MX450
MV cameras: MV2, MV12, MV22, MV32, MV72, MV93
MT sensors: MT14, MT15, MT20, MT40
Teleworker: Z4, Z4C
Cellular: MG51, MG52
IMPORTANT — Unknown/EOL model rule: If a user mentions a model number that follows Cisco/Meraki naming patterns (MR##, MX##, MS###-##, MV##, CW####, MT##, Z#, MG##) but is NOT in the active product list above, it is likely end-of-life or a typo. ALWAYS classify as "quote" if they want pricing — NEVER "clarify". The backend has full EOL data and handles replacement mapping automatically.

Respond with ONLY this JSON:
{"intent":"<category>","reply":"<for clarify or conversation only. MUST be empty for quote, product_info, escalate>","extracted":"<for quote only: extract clean request like 'quote 10 MR46 with 3 year license'. Empty for all other intents>"}`;

const CF_CONVO_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products. Be friendly, concise, and professional. Keep responses under 4 sentences.

Key product knowledge:
- MX security appliances: MX67 ($595, 50 users), MX68 ($795, 50), MX75 ($2,195, 200), MX85 ($3,995, 600), MX95 ($7,995, 2000), MX105 ($12,995, 5000), MX250 ($19,995, 10000), MX450 ($34,995, unlimited)
- MR access points: MR28 ($495), MR36H ($595), MR44 ($995, EoS-replaced by CW9164), MR46 ($1,295), MR57 ($1,895), MR78 ($2,495)
- MS switches: MS120-8 ($595), MS130-8 ($695), MS210-24 ($2,495), MS225-24 ($3,495), MS250-24 ($4,995), MS390-24 ($7,995)
- CW Wi-Fi 7: CW9162 ($995), CW9164 ($1,495), CW9166 ($1,995), CW9172 ($2,495), CW9176 ($3,995)
- MV cameras: MV2 ($495), MV12 ($995), MV22 ($1,295), MV32 ($1,995), MV72 ($3,495), MV93 ($4,995)
- MT sensors: MT14 ($149), MT15 ($199), MT20 ($129), MT40 ($199) — free tier up to 100 sensors
- All hardware needs a license (1yr/3yr/5yr). APs use LIC-ENT-. MX uses LIC-SEC- or LIC-ENT-.

For quote requests, tell users to say "quote [qty] [model]" and you'll generate an instant quote.`;

// Helper: extract text from Workers AI response (handles native string, native object, and OpenAI formats)
function extractAIResponse(result) {
  const raw = result?.response ?? result?.choices?.[0]?.message?.content ?? '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object') return JSON.stringify(raw);  // Llama 4 Scout returns parsed JSON objects
  return String(raw);
}

// ── Schema v2 classifier (SHADOW MODE) ──
// Rich structured output: intent + items + modifiers + revision + reference.
// Runs in parallel with the legacy classifier. Output is logged for comparison
// but does NOT drive routing yet. After a week of shadow data, we flip the flag.
const CF_CLASSIFIER_PROMPT_V2 = `You are an intent classifier for a Cisco/Meraki quoting bot. Output a single JSON object — no prose, no markdown.

SCHEMA:
{"intent":"quote|revise|price_lookup|dashboard_parse|clarify|product_info|escalate|conversation","confidence":0.0-1.0,"reply":"","items":[{"sku":"...","qty":1,"sku_type":"hardware|license|accessory"}],"modifiers":{"hardware_only":false,"license_only":false,"with_license":null,"term_years":null,"tier":null,"show_pricing":false,"all_terms":false,"separate_quotes":false},"revision":{"action":null,"target_sku":null,"add_items":[],"new_term":null,"new_tier":null,"new_qty":null,"hw_lic_toggle":null},"reference":{"is_pronoun_ref":false,"option_ref":null,"resolve_from_history":false},"dashboard":{"is_meraki_license_page":false}}

INTENT RULES:
- "quote": fresh quote or license request with ≥1 explicit SKU. Bare SKU ("MR46") = quote qty 1. "renewal for [SKU list]" or "renew N [SKU]" = quote with license_only=true (NOT revise — renewals with explicit SKUs are fresh license quotes).
- "price_lookup": standalone pricing question naming a SPECIFIC SKU with NO prior quote context — "cost of MR44", "how much is MR44", "price for MR44", "cost of MS150-24P-4G with license", "how much is MR44 with 3 year license", "what does MR46 cost with licensing". With-license phrasing sets modifiers.with_license=true and modifiers.term_years (if stated), but intent STAYS price_lookup — do NOT switch to quote just because "with license" is appended. If prior_context is present AND the user is asking to see pricing on the prior quote (e.g. "what is the cost", "how much", "with pricing"), use intent="revise" with action="show_pricing" instead.
- "revise": message modifies a prior quote using a REVISION VERB or PRONOUN REFERENCE — "add X", "remove X", "swap X for Y", "replace X", "change X", "make it N", "license only", "hardware only", "3 year only", "convert to", "toggle", "with pricing on that", "show me pricing". HARD RULE #1: "revise" requires prior_context to be present. If prior_context is empty/null, NEVER output "revise" — use "quote" or "clarify" instead. This is absolute: "refresh N X", "replace our X with Y", "upgrade to X", "just the hardware for N X", "hardware only for N X", "just show me the N year for N X", "just the N year for N X", "N year only for N X", and any hw/license/term-modifier phrasing that NAMES an explicit SKU must be intent="quote" (with appropriate modifiers) when prior_context is empty. HARD RULE #2: even when prior_context IS present, a message that opens with a FRESH QUOTING VERB ("quote", "price", "send me", "give me", "get me", "I need", "can you quote", "let me see", "pull up", "build me", "refresh", "upgrade", "just show me") followed by an explicit product family, SKU, or quantity is intent="quote", NOT revise. Revise requires either a revision verb (add/remove/swap/replace/change/make it/convert/toggle) OR a pronoun/demonstrative referencing the prior quote (it/that/these/those/the quote/the switches/the APs). Examples that ARE quote even with prior_context: "quote MR44", "quote all duo licenses", "quote 10 duo essentials as separate quotes", "price me a MX85", "refresh 5 MX64", "just the hardware for 3 MR46", "just show me the 5 year for 10 MR46". Examples that ARE revise: "add 2 MR44", "swap them for MR46", "make it 5 year", "with pricing", "change to SEC".
- "dashboard_parse": image of Meraki license dashboard. NEVER use for messages containing stratusinfosystems.com URLs — those are the bot's own quote output, not dashboards.
- STRATUS URL ECHOBACK: Messages containing a stratusinfosystems.com/order/ URL (with or without follow-on bullet lines summarizing items/pricing) are quote echoes, not revisions. Parse the ?item= and &qty= params in the URL and emit intent="quote" with items[] populated from those params (one item per URL position, sku_type inferred from the SKU: LIC-* → license, HW/bare model → hardware). This holds even when prior_context is present — the user is confirming or re-sending a fresh quote spec, not revising a prior one. NEVER classify stratusinfosystems.com URL messages as revise, dashboard_parse, or conversation.
- "clarify": quote request too vague — "some switches", "need APs", "pricing" alone. Also when a SKU stem is given WITHOUT its required variant suffix: "quote 5 MS130-24" (MS130-24 needs port/uplink suffix like -4G/-2X), "5 MS250", "3 MX" (no model number). Ambiguous SKU stems override the quoting verb — even "quote 5 MS130-24" is clarify, not quote. HARD RULE: family + base model number without the variant/port suffix = clarify, regardless of verb.
- "product_info": spec, compare, size, capability, EOL-status, or sizing/recommendation question — NOT a quote. Includes: "what do I need for X users", "what do you recommend for X", "which firewall for X employees", "what's the best AP for a warehouse". Also use for bare product/license category NAMES that identify a specific Cisco product line without asking for a quote: "DNS Security Essentials", "DNS Security Advantage", "Umbrella SIG", "Duo Advantage", "Meraki Advanced Security", "SecureX" — these are product-line lookups, classify as product_info (not clarify). If the user is asking WHAT to buy or naming a product line (not quoting a specific SKU with quantity), it's product_info.
- "escalate": complex proposal / deployment planning.
- "conversation": greeting, thanks, jokes, identity, short reactions ("lol","ok","?").

MODIFIER RULES:
- hardware_only: "hw only","hardware only","no license","just hardware","without licensing".
- license_only: "license only","just the license","licenses only","renewal only","renew X","renewal for X","lic only". When the user says "renewal for [devices]" they want license quotes — set license_only=true and intent="quote".
- with_license: true when user says "with license","with licensing","and license". null otherwise.
- term_years: 1/3/5 for "1 year"/"3 year"/"5 year"/"three year"/"just the 5 year". null otherwise.
- tier: "SEC" for "SEC"/"security"/"advanced security"; "ENT" for "ENT"/"enterprise"; "SDW" for any of "SD-WAN"/"SDW"/"SD WAN"/"sdwan"/"sd-wan"/"sd wan" (case-insensitive). null otherwise.
- CRITICAL — SDW TIER: Whenever the user says "SDW", "SD-WAN", "SD WAN", "sdwan", or any case variant ANYWHERE in the message, you MUST set modifiers.tier="SDW". Never drop it. Never leave tier as null when these phrasings are present. This applies even when the phrasing is in a suffix (MX85-SDW), separated by space (MX85 SDW), or appended after the model (MX85 SD-WAN with licensing).
- TIER SUFFIX SPLITTING: If a SKU has a tier suffix or space-separated tier word appended — examples: "MX85-SDW", "MX85 SDW", "MX85 sdwan", "MX85-SD-WAN", "MX67-SEC", "MX67 SEC", "MX75-ENT", "MX75 enterprise" — SPLIT it: put the base model in items[].sku (e.g., "MX85") and the tier in modifiers.tier (e.g., "SDW"). Never include the tier suffix as part of the SKU string. Never leave the tier as null when you've stripped a tier suffix.
- show_pricing: true for pricing intent ("cost","how much","with pricing","price").
- all_terms: true when user says "1yr 3yr and 5yr" or "all terms".
- CRITICAL — separate_quotes: Set modifiers.separate_quotes=true whenever the user asks for one URL/quote/link PER item, tier, or line. Trigger phrases (case-insensitive, match anywhere in the message): "separate quote[s]", "separate url[s]", "separate link[s]", "individual quote[s]/url[s]/link[s]", "each as its own quote/url/link", "each separately", "as separate ...", "one per line", "one per tier", "break (these|them|it) out", "split (into|up into) separate", "X url, Y url, Z url". CRITICAL: NEVER leave separate_quotes=false when any of the above appears. When separate_quotes=true, items[] MUST contain EVERY distinct thing the user named so the renderer can produce one URL per item — never collapse multi-tier or multi-item requests into a single item. Examples:
  * "quote 10 duo essentials and advantage as separate quotes" → items=[{sku:"LIC-DUO-ESSENTIALS-3YR",qty:10,sku_type:"license"},{sku:"LIC-DUO-ADVANTAGE-3YR",qty:10,sku_type:"license"}], separate_quotes=true
  * "MR44 and MS130-24 as separate links" → items=[{sku:"MR44",qty:1},{sku:"MS130-24",qty:1}], separate_quotes=true
  * "all duo licenses as separate quotes" → (see "all DUO/UMBRELLA" expansion rule below), separate_quotes=true
  * "give me separate URLs for 5 MR46 and 5 MR56" → items=[{sku:"MR46",qty:5},{sku:"MR56",qty:5}], separate_quotes=true

REVISION RULES:
- CRITICAL: Only use intent="revise" when prior_context is provided. If prior_context is empty or absent, the message is standalone — classify as "quote", "clarify", or another intent instead.
- action: "add"/"remove"/"swap"/"change_term"/"change_tier"/"toggle_hw_lic"/"change_qty"/"show_pricing".
- "license only"/"hardware only" AFTER prior quote (prior_context present) → action=toggle_hw_lic, hw_lic_toggle="license_only"/"hardware_only". If prior_context is EMPTY and the same phrasing is used with an explicit SKU ("just the hardware for 3 MR46", "5 MX67 no license"), this is intent="quote" with modifiers.hardware_only=true — NOT revise.
- "3 year only"/"make it 5 year" → action=change_term, new_term=3 or 5.
- "add 2 MX67" → action=add, add_items=[{sku:"MX67",qty:2}].
- "remove MR44"/"take out MR44" → action=remove, target_sku="MR44".
- SWAP — any of "swap X for Y", "replace X with Y", "change X to Y", "substitute X with Y", "exchange X for Y" → action="swap", target_sku="X", add_items=[{sku:"Y", qty: if given}]. Examples: "swap MR44 for MR46" → swap, target MR44, add MR46; "replace the MR44s with MR46" → swap, target MR44, add MR46; "change MX75 to MX85" → swap, target MX75, add MX85. CRITICAL: Swap is ONE atomic action. NEVER split "swap X for Y" into separate action="remove" (X) + action="add" (Y) — that loses the swap semantics. Always emit a single revise with action="swap".
- "make it 5" → action=change_qty, new_qty=5.
- "change to SEC" → action=change_tier, new_tier="SEC".
- Pricing follow-up on a prior quote — the user wants to see the dollar figures on items they've already been quoted. Natural-language examples: "what is the cost", "how much", "how much is that", "how much does it cost", "what's the price", "with pricing", "add pricing", "show me pricing", "give me pricing", "what's this cost", "total cost", "the price", "pricing" — basically any message that asks about cost/price/pricing without introducing new SKUs or changing the spec. → action="show_pricing", set modifiers.show_pricing=true, reference.resolve_from_history=true. This is a no-op on items/term/tier — keep the prior quote exactly as-is and just render it with pricing visible. Trust the semantic meaning of the message; you don't need the exact phrase to match — if the intent is "I want to see the cost of what you just quoted," use show_pricing.
- For revisions: set reference.resolve_from_history=true.
- "renewal for [device list]" is NOT a revision — it's a fresh quote with license_only=true.

REFERENCE RULES:
- is_pronoun_ref: true for "that"/"those"/"it"/"them"/"this"/"these"/"the switch"/"the AP"/"the quote".
- option_ref: 1/2/3 if user says "Option 1/2/3".
- resolve_from_history: true whenever the message only makes sense with prior context.

SKU KNOWLEDGE:
Valid Meraki families: MR (APs), MX (firewalls), MS (switches), MV (cameras), MT (sensors), MG (cellular), Z (teleworker), CW (Wi-Fi 6E/7).
Bare license SKUs like "LIC-ENT-3YR","LIC-MX64-SEC-3YR" → items with sku_type="license".
Cisco Duo licenses: format is LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-{1|3|5}YR. Examples: "duo essentials 3 year" → LIC-DUO-ESSENTIALS-3YR; "duo advantage" → LIC-DUO-ADVANTAGE-{term}YR; "duo premier" → LIC-DUO-PREMIER-{term}YR. NEVER emit short forms like "DUO-E-3YR", "DUO-A", or "DUO-ESS" — always the full LIC-DUO-{TIER}-{TERM}YR string. If you aren't sure of the exact canonical SKU, leave items[] empty (the backend will resolve it) rather than hallucinating a short form.
Cisco Umbrella licenses: format is LIC-UMB-{DNS|SIG}-{ESS|ADV}-K9-{1|3|5}YR. Examples: "umbrella DNS essentials 3 year" → LIC-UMB-DNS-ESS-K9-3YR; "umbrella SIG advantage" → LIC-UMB-SIG-ADV-K9-{term}YR. NEVER emit short forms like "UMB-DNS-3YR" — always include -K9- and the full LIC-UMB-{TYPE}-{TIER}-K9-{TERM}YR format.

CRITICAL — "ALL DUO" / "ALL UMBRELLA" expansion:
When the user says "all duo" / "all duo licenses" / "all duo quotes" / "every duo tier" (case-insensitive, with or without "cisco"), intent="quote" and items[] must expand to ALL three Duo tiers at the user-stated term (or all three terms when no term stated). Set modifiers.separate_quotes=true — the user wants one URL per tier/item. Default qty=1 unless user states a number.
  * "all duo licenses" (no term) → items = 9 entries: LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-{1|3|5}YR (qty=1 each), separate_quotes=true
  * "all duo licenses as separate links" → same 9 entries, separate_quotes=true
  * "50 of all duo 3 year" → 3 entries: LIC-DUO-{ESSENTIALS|ADVANTAGE|PREMIER}-3YR qty=50 each, separate_quotes=true
Same rule for "all umbrella" / "all umbrella licenses" — expand to all 4 type×tier combos (LIC-UMB-{DNS|SIG}-{ESS|ADV}-K9-{term}YR) at the stated term (or all 3 terms = 12 combos when no term stated), separate_quotes=true.
NEVER collapse "all duo" to a single tier or "all umbrella" to a single type. NEVER classify "all duo" / "all umbrella" as clarify — the user is being explicit, they want every tier priced.

If a model looks valid but you don't recognize it (EOL or new), still emit as quote — the backend validates.
Word numbers: "one"=1,"two"=2,...,"ten"=10,"a couple"=2,"a few"=3.

Return ONLY the JSON object. No markdown fences. No explanation.`;

async function classifyWithCFv2(userMessage, priorContext, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const userText = priorContext ? `Prior assistant context:\n${priorContext}\n\nUser message:\n${userMessage}` : userMessage;
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: 'system', content: CF_CLASSIFIER_PROMPT_V2 },
          { role: 'user', content: userText }
        ],
        max_tokens: 512
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('V2_TIMEOUT')), 8000))
    ]);
    const elapsed = Date.now() - startMs;
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === 'object' && rawResponse !== null && rawResponse.intent) {
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === 'string' ? rawResponse.trim() : String(rawResponse || '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { elapsed, raw, parseError: 'no JSON found' };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...parsed, elapsed, raw };
    } catch (e) {
      return { elapsed, raw, parseError: e.message };
    }
  } catch (err) {
    return { elapsed: Date.now() - startMs, error: err.message };
  }
}

// ── Gemma 4 shadow classifier (same Schema v2 prompt, different model) ──
const GEMMA4_MODEL = '@cf/google/gemma-4-26b-a4b-it';
async function classifyWithGemma4(userMessage, priorContext, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const userText = priorContext ? `Prior assistant context:\n${priorContext}\n\nUser message:\n${userMessage}` : userMessage;
    const result = await Promise.race([
      env.AI.run(GEMMA4_MODEL, {
        messages: [
          { role: 'system', content: CF_CLASSIFIER_PROMPT_V2 },
          { role: 'user', content: userText }
        ],
        max_completion_tokens: 4096,
        thinking: { type: 'disabled' }
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('GEMMA4_TIMEOUT')), 10000))
    ]);
    const elapsed = Date.now() - startMs;
    // Gemma 4 uses OpenAI-style response: choices[0].message.content
    const rawResponse = result?.choices?.[0]?.message?.content ?? result?.response;
    if (typeof rawResponse === 'object' && rawResponse !== null && rawResponse.intent) {
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }
    const raw = typeof rawResponse === 'string' ? rawResponse.trim() : String(rawResponse || '');
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { elapsed, raw, parseError: 'no JSON found' };
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      return { ...parsed, elapsed, raw };
    } catch (e) {
      return { elapsed, raw, parseError: e.message };
    }
  } catch (err) {
    return { elapsed: Date.now() - startMs, error: err.message };
  }
}

// Async-fire-and-forget: log the shadow comparison to D1 via ctx.waitUntil.
async function logShadowClassification(env, { personId, requestText, priorContext, legacy, v2, gemma4 }) {
  if (!env.ANALYTICS_DB) return;
  try {
    // Migrate table: add Gemma 4 columns if they don't exist yet
    await env.ANALYTICS_DB.prepare(`CREATE TABLE IF NOT EXISTS classifier_shadow (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT (datetime('now')),
      person_id TEXT,
      request_text TEXT,
      prior_context TEXT,
      legacy_intent TEXT,
      legacy_elapsed_ms INTEGER,
      legacy_raw TEXT,
      v2_intent TEXT,
      v2_confidence REAL,
      v2_elapsed_ms INTEGER,
      v2_items TEXT,
      v2_modifiers TEXT,
      v2_revision TEXT,
      v2_reference TEXT,
      v2_raw TEXT,
      v2_parse_error TEXT,
      intent_agree INTEGER,
      gemma4_intent TEXT,
      gemma4_confidence REAL,
      gemma4_elapsed_ms INTEGER,
      gemma4_items TEXT,
      gemma4_modifiers TEXT,
      gemma4_revision TEXT,
      gemma4_reference TEXT,
      gemma4_raw TEXT,
      gemma4_parse_error TEXT,
      gemma4_agree INTEGER
    )`).run();
    // Safe migration for existing tables: add columns if missing (SQLite ignores duplicate ADD COLUMN errors)
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_intent TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_confidence REAL`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_elapsed_ms INTEGER`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_items TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_modifiers TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_revision TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_reference TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_raw TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_parse_error TEXT`).run(); } catch {}
    try { await env.ANALYTICS_DB.prepare(`ALTER TABLE classifier_shadow ADD COLUMN gemma4_agree INTEGER`).run(); } catch {}
    const intentAgree = legacy?.intent && v2?.intent ? (String(legacy.intent).toLowerCase() === String(v2.intent).toLowerCase() ? 1 : 0) : null;
    const gemma4Agree = legacy?.intent && gemma4?.intent ? (String(legacy.intent).toLowerCase() === String(gemma4.intent).toLowerCase() ? 1 : 0) : null;
    await env.ANALYTICS_DB.prepare(`INSERT INTO classifier_shadow
      (person_id, request_text, prior_context, legacy_intent, legacy_elapsed_ms, legacy_raw, v2_intent, v2_confidence, v2_elapsed_ms, v2_items, v2_modifiers, v2_revision, v2_reference, v2_raw, v2_parse_error, intent_agree, gemma4_intent, gemma4_confidence, gemma4_elapsed_ms, gemma4_items, gemma4_modifiers, gemma4_revision, gemma4_reference, gemma4_raw, gemma4_parse_error, gemma4_agree)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      personId || null,
      String(requestText || '').substring(0, 1000),
      String(priorContext || '').substring(0, 2000),
      legacy?.intent || null,
      legacy?.elapsed || null,
      String(legacy?.raw || '').substring(0, 2000),
      v2?.intent || null,
      v2?.confidence || null,
      v2?.elapsed || null,
      v2?.items ? JSON.stringify(v2.items).substring(0, 1000) : null,
      v2?.modifiers ? JSON.stringify(v2.modifiers).substring(0, 500) : null,
      v2?.revision ? JSON.stringify(v2.revision).substring(0, 500) : null,
      v2?.reference ? JSON.stringify(v2.reference).substring(0, 200) : null,
      String(v2?.raw || '').substring(0, 2000),
      v2?.parseError || v2?.error || null,
      intentAgree,
      gemma4?.intent || null,
      gemma4?.confidence || null,
      gemma4?.elapsed || null,
      gemma4?.items ? JSON.stringify(gemma4.items).substring(0, 1000) : null,
      gemma4?.modifiers ? JSON.stringify(gemma4.modifiers).substring(0, 500) : null,
      gemma4?.revision ? JSON.stringify(gemma4.revision).substring(0, 500) : null,
      gemma4?.reference ? JSON.stringify(gemma4.reference).substring(0, 200) : null,
      String(gemma4?.raw || '').substring(0, 2000),
      gemma4?.parseError || gemma4?.error || null,
      gemma4Agree
    ).run();
  } catch (e) {
    console.warn('[Shadow] log failed:', e.message);
  }
}

async function classifyWithCF(userMessage, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: 'system', content: CF_CLASSIFIER_PROMPT },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 256
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 8000))
    ]);
    const elapsed = Date.now() - startMs;

    // Llama 4 Scout returns result.response as a pre-parsed JSON object
    const rawResponse = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof rawResponse === 'object' && rawResponse !== null && rawResponse.intent) {
      console.log(`[CF-Classify] Pre-parsed object (${elapsed}ms): intent=${rawResponse.intent}`);
      return { ...rawResponse, elapsed, raw: JSON.stringify(rawResponse) };
    }

    // Fallback: string response (other models) — extract JSON
    const raw = typeof rawResponse === 'string' ? rawResponse.trim() : String(rawResponse || '');
    console.log(`[CF-Classify] Raw response (${elapsed}ms): ${raw.substring(0, 200)}`);
    let jsonStr = raw;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    const parsed = JSON.parse(jsonStr);
    return { ...parsed, elapsed, raw };
  } catch (err) {
    console.error(`[CF-Classify] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}

async function askCFConversation(userMessage, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [
          { role: 'system', content: CF_CONVO_PROMPT },
          { role: 'user', content: userMessage }
        ],
        max_tokens: 256
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 10000))
    ]);
    const elapsed = Date.now() - startMs;
    const response = extractAIResponse(result);
    if (response.length > 5) return { response, elapsed };
    return null;
  } catch (err) {
    console.error(`[CF-Convo] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}

// ─── Extract SKUs from vision response text ─────────────────────────────────
// Parses a CF Vision (or Claude) response for SKU + quantity pairs so they can
// be stored in KV and fed to the deterministic quote engine on a follow-up
// "quote this" / "quote both" message.
function isValidSkuToken(sku) {
  if (!sku) return false;
  const s = sku.toUpperCase();
  if (s.startsWith('LIC-')) return true;
  if (/^Z\d/.test(s) && !/^Z[134][C]?X?$/.test(s)) return false;
  if (/^[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}/.test(s)) return false;
  return true;
}

function dedupeSkus(skus) {
  const map = new Map();
  for (const { sku, qty } of skus) {
    map.set(sku, (map.get(sku) || 0) + qty);
  }
  return Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty }));
}

function extractSkusFromVisionText(text) {
  const skus = [];
  if (!text) return skus;

  // Strip markdown bold/italic so Claude's occasional `**SKU:**` doesn't break the regex.
  const cleanedText = text.replace(/\*{1,3}/g, '');

  if (/LICENSE_DASHBOARD_PARSE_V1/.test(cleanedText)) {
    const lineRe = /SKU:\s*([A-Z0-9][A-Z0-9_-]*)\s*\|\s*LIMIT:\s*(\d+)\s*\|\s*ACTIVE:\s*(\d+)/gi;
    let m;
    while ((m = lineRe.exec(cleanedText)) !== null) {
      const sku = m[1].toUpperCase().replace(/_/g, '-');
      const limit = parseInt(m[2], 10);
      const active = parseInt(m[3], 10);
      if (!Number.isFinite(limit) || !Number.isFinite(active)) continue;
      if (active === 0 && limit === 0) continue;
      if (active === 0) continue;
      const qty = Math.min(limit || active, active || limit);
      if (qty <= 0 || qty > 500) continue;
      if (!isValidSkuToken(sku)) continue;
      skus.push({ sku, qty });
    }
    if (skus.length > 0) return dedupeSkus(skus);
  }

  const mrEntRe = /MR\s+Enterprise[^\n\d]{0,40}?(\d+)/gi;
  let mEnt;
  while ((mEnt = mrEntRe.exec(cleanedText)) !== null) {
    const qty = parseInt(mEnt[1], 10);
    if (qty > 0 && qty <= 500) skus.push({ sku: 'MR-ENT', qty });
  }

  const skuRegex = /\b((?:LIC-[A-Z0-9-]+|(?:MR|MS|MX|MV|MT|MG|CW|C9|Z)\d[A-Z0-9-]*))\b/gi;
  const lines = cleanedText.split(/\n|\r/);
  for (const line of lines) {
    if (/license\s+history/i.test(line)) continue;
    if (/\b[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}\b/i.test(line)) continue;
    let match;
    skuRegex.lastIndex = 0;
    while ((match = skuRegex.exec(line)) !== null) {
      const sku = match[1].toUpperCase();
      if (!isValidSkuToken(sku)) continue;
      const beforeSku = line.substring(0, match.index);
      const afterSku = line.substring(match.index + match[0].length);
      let qty = 1;
      const afterQty = afterSku.match(/(?:\s*[\|:×x]\s*|\s+(?:has\s+a\s+)?count\s+of\s+|\s*\(\s*)(\d+)/i);
      if (afterQty) {
        qty = parseInt(afterQty[1], 10);
      } else {
        const beforeQty = beforeSku.match(/(?:^|[\s,|])(\d+)\s*[x×]?\s+$/i);
        if (beforeQty) {
          qty = parseInt(beforeQty[1], 10);
        }
      }
      if (qty > 0 && qty <= 500) {
        skus.push({ sku, qty });
      }
    }
  }
  return dedupeSkus(skus);
}

// CF Vision: analyze images via Llama 4 Scout (free) before falling back to Claude
async function askCFVision(prompt, imageData, env) {
  if (!env.AI) return null;
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(CF_MODEL, {
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${imageData.mediaType};base64,${imageData.base64}` } }
          ]
        }],
        max_tokens: 1500
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('CF_VISION_TIMEOUT')), 15000))
    ]);
    const elapsed = Date.now() - startMs;
    const response = extractAIResponse(result);
    // Validate: if model says "can't see" or returns too short, it failed
    if (response.length < 20) return null;
    const cantSee = /(can'?t see|cannot see|don'?t see|unable to (see|view)|no image|text-based|upload)/i;
    if (cantSee.test(response)) {
      console.log(`[CF-Vision] Model can't see image (${elapsed}ms), falling back to Claude`);
      return null;
    }
    console.log(`[CF-Vision] Success (${elapsed}ms, ${response.length} chars)`);
    return { response, elapsed };
  } catch (err) {
    console.error(`[CF-Vision] Error: ${err.message} (${Date.now() - startMs}ms)`);
    return null;
  }
}

async function sendMessage(roomId, markdown, token) {
  // Webex has a ~7439 char limit for markdown messages.
  // If the message exceeds this, split into chunks at line boundaries.
  const MAX_LEN = 7000; // Leave margin for safety
  if (markdown.length <= MAX_LEN) {
    await fetch('https://webexapis.com/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, markdown })
    });
    return;
  }

  // Split long messages at double-newline (paragraph) boundaries
  const chunks = [];
  let remaining = markdown;
  while (remaining.length > MAX_LEN) {
    let splitIdx = remaining.lastIndexOf('\n\n', MAX_LEN);
    if (splitIdx < MAX_LEN * 0.3) splitIdx = remaining.lastIndexOf('\n', MAX_LEN);
    if (splitIdx < MAX_LEN * 0.3) splitIdx = MAX_LEN; // Hard split as last resort
    chunks.push(remaining.substring(0, splitIdx).trim());
    remaining = remaining.substring(splitIdx).trim();
  }
  if (remaining) chunks.push(remaining);

  for (const chunk of chunks) {
    await fetch('https://webexapis.com/v1/messages', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, markdown: chunk })
    });
  }
}

// ─── SKU Suffix Rules ────────────────────────────────────────────────────────
function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;  // CW9179F has no -RTG suffix
  // CW Wi-Fi 7 (917x): add -RTG suffix
  if (/^CW917\d/.test(upper)) {
    // Auto-append I if bare model number (CW9172→CW9172I, but not CW9172H or CW9176 which are already full)
    let cwBase = upper;
    if (/^CW917\dI?$/.test(cwBase) && !cwBase.endsWith('I')) cwBase = `${cwBase}I`;
    return cwBase.endsWith('-RTG') ? cwBase : `${cwBase}-RTG`;
  }
  // CW Wi-Fi 6E (916x): auto-append I for standard internal-antenna model, add -MR suffix
  if (/^CW916\d/.test(upper)) {
    let cwBase = upper;
    // CW9162→CW9162I, CW9164→CW9164I, CW9166→CW9166I (but not CW9163E, CW9166D1, etc.)
    if (/^CW916\dI?$/.test(cwBase) && !cwBase.endsWith('I')) cwBase = `${cwBase}I`;
    return cwBase.endsWith('-MR') ? cwBase : `${cwBase}-MR`;
  }
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (/^MS\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

// ─── License SKU Rules ───────────────────────────────────────────────────────
function getLicenseSkus(baseSku, requestedTier) {
  const raw = _getLicenseSkusRaw(baseSku, requestedTier);
  if (!raw || raw.length === 0) return null;

  // Validate every generated license SKU exists in prices.json.
  // Regex-based generation can produce fictitious SKUs for invalid models
  // (e.g. MX44 → LIC-MX44-SEC-3YR which doesn't exist).
  const validated = raw.filter(entry => entry.sku in prices);
  if (validated.length === 0) {
    console.warn(`[LICENSE] All generated SKUs invalid for ${baseSku}: ${raw.map(e => e.sku).join(', ')}`);
    return null;
  }
  if (validated.length < raw.length) {
    const dropped = raw.filter(e => !(e.sku in prices)).map(e => e.sku);
    console.warn(`[LICENSE] Dropped invalid SKUs for ${baseSku}: ${dropped.join(', ')}`);
  }
  return validated;
}

function _getLicenseSkusRaw(baseSku, requestedTier) {
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

  // Preserve insertion order (= request order). Hardware is pushed before its
  // license in every call site, so each device's HW+LIC stay grouped naturally.
  const orderedSkus = [...merged.keys()];
  const qtys = orderedSkus.map(s => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${orderedSkus.join(',')}&qty=${qtys.join(',')}`;
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

// ─── Levenshtein Distance (for fuzzy SKU matching) ──────────────────────────
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

// ─── Fuzzy SKU Matcher ──────────────────────────────────────────────────────
// Find the closest valid SKUs within a family using Levenshtein distance.
// Returns array of { sku, distance } sorted by distance, filtered to max distance 3.
function fuzzyMatchInFamily(input, family) {
  const upper = input.toUpperCase();
  const variants = catalog[family];
  if (!variants || !Array.isArray(variants)) return [];

  // Build full SKU list: family prefix + variant (e.g., "MS150" + "-48FP-4X")
  const candidates = variants.map(v => {
    const fullSku = family.match(/^(MR|MX|MV|MT|MG|Z|CW)$/) ? v : v;
    return { sku: fullSku, distance: levenshtein(upper, fullSku.toUpperCase()) };
  });

  return candidates
    .filter(c => c.distance <= 3 && c.distance > 0) // within 3 edits, exclude exact matches
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

// Cross-family fuzzy match: check ALL families when detectFamily returns null
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
  // BUT skip if the input itself is already a valid SKU (e.g. MS150-24P-4G)
  if (!VALID_SKUS.has(upper) && !isEol(upper)) {
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
  // Try stripping -HW suffix (MR46-HW → MR46)
  const noHw = upper.replace(/-HW(-NA)?$/, '');
  if (noHw !== upper && prices[noHw]) return prices[noHw];
  // Try adding -HW suffix (MR46 → MR46-HW)
  if (prices[`${upper}-HW`]) return prices[`${upper}-HW`];
  // Try adding -MR suffix for CW Wi-Fi 6E (CW9164I → CW9164I-MR)
  if (prices[`${upper}-MR`]) return prices[`${upper}-MR`];
  // Try adding -RTG suffix for CW Wi-Fi 7 (CW9172I → CW9172I-RTG)
  if (prices[`${upper}-RTG`]) return prices[`${upper}-RTG`];
  // Try full applySuffix normalization as last resort
  const suffixed = applySuffix(upper);
  if (suffixed !== upper && prices[suffixed]) return prices[suffixed];
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
 * Case 1 + routing improvement: Handle modifier-only follow-ups after a quote.
 *
 * Triggers on messages like:
 *   "hardware only" / "hw only"
 *   "license only" / "licenses only" / "just the licenses"
 *   "with pricing" / "add pricing"
 *   "3 year only" / "just the 3 year" / "only 1 year"
 *   "remove MR44" / "take out MR44" / "without MR44"
 *   "add 2 MX67" / "also include 1 MS130-24P"
 *   "change MR44 to MR46" / "swap MR44 for MR46"
 *
 * Looks at the most recent assistant message with a Stratus order URL, parses
 * it back into {sku, qty}, applies the mutation, and rebuilds deterministically.
 * Returns response string if handled, null to pass through.
 */
async function handleFollowUpModifier(text, personId, kv) {
  if (!personId || !kv) return null;
  const upper = text.toUpperCase().trim();
  // Ignore if the message itself contains SKU tokens — that's handled downstream
  // UNLESS the phrase is "add ..." or "also ..." which we want to apply to the prior quote.
  const hasAddPrefix = /^(ADD|ALSO\s+(?:ADD|INCLUDE))\b/i.test(upper);
  const hasRemovePrefix = /^(REMOVE|TAKE\s+OUT|WITHOUT)\b/i.test(upper);
  const hasSwapPrefix = /^(CHANGE|SWAP|REPLACE)\b/i.test(upper);

  // Pure modifier phrases (no SKU tokens needed)
  const isHwOnly = /^(HARDWARE\s+ONLY|HW\s+ONLY|JUST\s+(THE\s+)?HARDWARE|NO\s+LICENSE[S]?|WITHOUT\s+LICENSE[S]?)\s*\.?\s*$/i.test(upper);
  const isLicOnly = /^(LICENSE[S]?\s+ONLY|LICENCE[S]?\s+ONLY|JUST\s+(THE\s+)?LICENSE[S]?|LICENSE[S]?\s+RENEWAL|RENEWAL\s+ONLY|NO\s+HARDWARE)\s*\.?\s*$/i.test(upper);
  const isTermOnly = upper.match(/^(?:JUST\s+(?:THE\s+)?|ONLY\s+(?:THE\s+)?)?(\d)\s*-?\s*YEAR(?:\s+ONLY|\s+PLEASE)?\s*\.?\s*$/i);
  const isAddPricing = /^(ADD\s+PRICING|WITH\s+PRICING|INCLUDE\s+PRICING|SHOW\s+ME\s+PRICING|HOW\s+MUCH(\s+(IS|ARE)\s+(IT|THAT|THOSE|THIS|THESE|THEM))?\s*\??\s*)$/i.test(upper);

  if (!isHwOnly && !isLicOnly && !isTermOnly && !isAddPricing && !hasAddPrefix && !hasRemovePrefix && !hasSwapPrefix) return null;

  const history = await getHistory(kv, personId);
  if (!history || history.length === 0) return null;
  const assistantMsgs = history.filter(h => h.role === 'assistant').reverse();

  // Find the last assistant message with a Stratus URL
  let lastUrl = null, lastTermLabels = [];
  for (const m of assistantMsgs) {
    // Capture ALL URLs + their term labels. Handle both **label:** and **label**: markdown.
    const urlRegex = /(?:\*\*)?(\d)-Year\s+Co-Term(?:\*\*)?\s*:?\s*(?:\*\*)?\s*(https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)*]+)/gi;
    const urlMatches = [...m.content.matchAll(urlRegex)];
    if (urlMatches.length > 0) {
      lastTermLabels = urlMatches.map(u => ({ term: parseInt(u[1], 10), url: u[2] }));
      lastUrl = lastTermLabels[0].url;
      break;
    }
    // Fallback: any Stratus URL without a term label (e.g. single-url pricing response)
    const anyUrl = m.content.match(/(https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)*]+)/);
    if (anyUrl) {
      lastUrl = anyUrl[1];
      lastTermLabels = [{ term: null, url: anyUrl[1] }];
      break;
    }
  }
  if (!lastUrl) return null;

  // Parse each URL into {sku, qty}[]
  const urlToItems = (url) => {
    const m = url.match(/[?&]item=([^&]+)&qty=([^&\s)]+)/);
    if (!m) return null;
    const skus = m[1].split(',').map(s => decodeURIComponent(s.trim()));
    const qtys = m[2].split(',').map(q => parseInt(decodeURIComponent(q.trim()), 10));
    if (skus.length !== qtys.length) return null;
    return skus.map((sku, i) => ({ sku, qty: qtys[i] }));
  };

  // For mutations, we apply to all terms (hw only, license only, term reduction) OR a specific one.
  // Build a map of term → items.
  const termItems = {};
  for (const entry of lastTermLabels) {
    const items = urlToItems(entry.url);
    if (items) termItems[entry.term || 'na'] = items;
  }
  if (Object.keys(termItems).length === 0) return null;

  // Helper: apply "hardware only" — drop LIC-* SKUs
  const applyHwOnly = (items) => items.filter(i => !/^LIC-/i.test(i.sku));
  // Helper: apply "license only" — keep LIC-* SKUs, OR if none, generate from hardware
  const applyLicOnly = (items, term) => {
    const licOnly = items.filter(i => /^LIC-/i.test(i.sku));
    if (licOnly.length > 0) return licOnly;
    // Generate licenses from hardware SKUs
    const generated = [];
    for (const { sku, qty } of items) {
      const cleanBase = sku.replace(/-(HW|MR|RTG|HW-NA)$/i, '');
      const lics = getLicenseSkus(cleanBase, null);
      if (lics) {
        const found = lics.find(l => l.term === `${term || 3}Y`);
        if (found) generated.push({ sku: found.sku, qty });
      }
    }
    return generated;
  };
  // Helper: apply add/remove/swap
  const applyItemMutation = (items, freshText) => {
    const up = freshText.toUpperCase();
    // Remove
    const removeMatch = up.match(/^(?:REMOVE|TAKE\s+OUT|WITHOUT)\s+(\d+\s+)?([A-Z0-9][-A-Z0-9]+)/i);
    if (removeMatch) {
      const rmSku = removeMatch[2].toUpperCase();
      return items.filter(i => i.sku.toUpperCase() !== rmSku && i.sku.toUpperCase() !== applySuffix(rmSku).toUpperCase());
    }
    // Add
    const addMatch = freshText.match(/^(?:ADD|ALSO\s+(?:ADD|INCLUDE))\s+(.+)$/i);
    if (addMatch) {
      const parsed = parseMessage(addMatch[1]);
      if (parsed && parsed.items && parsed.items.length > 0) {
        const merged = items.slice();
        for (const it of parsed.items) {
          const hwSku = applySuffix(it.baseSku);
          const existingIdx = merged.findIndex(e => e.sku.toUpperCase() === hwSku.toUpperCase());
          if (existingIdx >= 0) merged[existingIdx].qty += it.qty;
          else merged.push({ sku: hwSku, qty: it.qty });
        }
        return merged;
      }
    }
    return null;
  };

  let filteredTerms = Object.entries(termItems);

  // Apply term filter
  if (isTermOnly) {
    const wantTerm = parseInt(isTermOnly[1], 10);
    const single = filteredTerms.find(([k]) => String(k) === String(wantTerm));
    if (single) filteredTerms = [single];
  }

  // Apply mutation
  const mutated = [];
  for (const [term, items] of filteredTerms) {
    let out = items;
    if (isHwOnly) out = applyHwOnly(out);
    else if (isLicOnly) out = applyLicOnly(out, term === 'na' ? null : parseInt(term, 10));
    else if (hasRemovePrefix || hasAddPrefix || hasSwapPrefix) {
      const r = applyItemMutation(out, text);
      if (r) out = r;
      else return null; // couldn't parse the mutation — pass through
    }
    if (out.length > 0) mutated.push({ term, items: out });
  }
  if (mutated.length === 0) return null;

  // Render response
  const lines = [];
  const showPricing = isAddPricing;
  for (const { term, items } of mutated) {
    const url = buildStratusUrl(items);
    const label = term === 'na' ? '' : `**${term}-Year Co-Term:** `;
    lines.push(`${label}${url}`);
    if (showPricing) {
      lines.push(buildPricingBlock(items, false));
    }
    lines.push('');
  }
  if (isAddPricing && !showPricing) {
    // simple pricing-only: price the hardware+licenses for first term
    const first = mutated[0];
    lines.push(buildPricingBlock(first.items, false));
  }
  return lines.join('\n').trim();
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

  // Bail out on competitive analysis / vague category phrases — these need CF classification
  if (/\b(total cost of ownership|TCO|vs\s+\w+|versus|compared?\s+to|ROI)\b/i.test(text)) return null;
  if (/\b(pricing for|how much for|cost of)\s+(meraki|cisco|switches|aps?|access points?|cameras?|sensors?|firewalls?|routers?|networking)\s*$/i.test(text)) return null;

  // Pattern 0: Duo / Umbrella natural language pricing (e.g. "cost of Duo Advantage", "price of 10 Umbrella DNS Essentials")
  const isDuoPricing = /\b(?:DUO|CISCO\s*DUO)\b/i.test(upper);
  const isUmbPricing = /\bUMBRELLA\b/i.test(upper);
  if (isDuoPricing || isUmbPricing) {
    // Extract quantity (default 1)
    const qtyMatch = upper.match(/\b(\d+)\b/);
    const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;

    if (isDuoPricing) {
      let duoTier = null;
      if (/ADVANTAGE/i.test(upper)) duoTier = 'ADVANTAGE';
      else if (/PREMIER/i.test(upper)) duoTier = 'PREMIER';
      else if (/ESSENTIAL/i.test(upper)) duoTier = 'ESSENTIALS';
      if (duoTier) {
        const skus = [`LIC-DUO-${duoTier}-1YR`, `LIC-DUO-${duoTier}-3YR`, `LIC-DUO-${duoTier}-5YR`];
        const qtys = [qty, qty, qty];
        const label = `Cisco Duo ${duoTier.charAt(0) + duoTier.slice(1).toLowerCase()} — ${qty} license${qty > 1 ? 's' : ''}`;
        const resp = formatPricingResponse(label, skus, qtys);
        if (resp) return resp;
      }
    }

    if (isUmbPricing) {
      const isDns = /\bDNS\b/i.test(upper);
      const isSig = /\b(SIG|SECURE\s*INTERNET\s*GATEWAY)\b/i.test(upper);
      const isEss = /\bESS/i.test(upper);
      const isAdv = /\bADV/i.test(upper);

      let umbType = isDns ? 'DNS' : isSig ? 'SIG' : null;
      let umbTier = isEss ? 'ESS' : isAdv ? 'ADV' : null;

      if (umbType && umbTier) {
        const skus = [`LIC-UMB-${umbType}-${umbTier}-K9-1YR`, `LIC-UMB-${umbType}-${umbTier}-K9-3YR`, `LIC-UMB-${umbType}-${umbTier}-K9-5YR`];
        const qtys = [qty, qty, qty];
        const typeLabel = umbType === 'DNS' ? 'DNS Security' : 'Secure Internet Gateway';
        const tierLabel = umbTier === 'ESS' ? 'Essentials' : 'Advantage';
        const label = `Cisco Umbrella ${typeLabel} ${tierLabel} — ${qty} license${qty > 1 ? 's' : ''}`;
        const resp = formatPricingResponse(label, skus, qtys);
        if (resp) return resp;
      }
    }
  }

  // ── NEW (Case 3 fix): Detect "with license" / "with N year license" / "with licensing" ──
  // When present, append the appropriate license SKU(s) to the pricing call.
  // Allow optional tier word (SEC/ENT/etc) between "year" and "license".
  const withLicenseMatch = text.match(/\bwith\s+(?:a\s+)?(?:(\d)\s*[-\s]?\s*year\s+)?(?:(?:ENT(?:ERPRISE)?|SEC(?:URITY)?|ADVANCED\s+SECURITY|SDW|SD[\s-]?WAN)\s+)?(license|licence|licensing|lic)\b/i);
  const wantsLicense = !!withLicenseMatch;
  const licenseTerm = withLicenseMatch && withLicenseMatch[1] ? parseInt(withLicenseMatch[1]) : 3;
  const licenseTierMatch = wantsLicense && text.match(/\bwith\s+(?:a\s+)?(?:\d\s*[-\s]?\s*year\s+)?(ENT(?:ERPRISE)?|SEC(?:URITY)?|ADVANCED\s+SECURITY|SDW|SD[\s-]?WAN)\s+(license|licence|licensing)/i);
  let licenseTierOverride = null;
  if (licenseTierMatch) {
    const t = licenseTierMatch[1].toUpperCase();
    if (/SEC|ADVANCED/.test(t)) licenseTierOverride = 'SEC';
    else if (/ENT/.test(t)) licenseTierOverride = 'ENT';
    else if (/SDW|SD.?WAN/.test(t)) licenseTierOverride = 'SDW';
  }
  const _licenseSkusFor = (baseSku, term, tier) => {
    try {
      const cleanBase = baseSku.replace(/-(HW|MR|RTG|HW-NA)$/i, '');
      const lics = getLicenseSkus(cleanBase, tier);
      if (!lics) return [];
      const m = lics.find(l => l.term === `${term}Y`);
      return m ? [m.sku] : [];
    } catch { return []; }
  };

  // Pattern 1: Direct SKU pricing request like "cost of 2x MS150-48FP-4X" or "price of MR44"
  const directSkuMatch = text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
  const singleSkuMatch = !directSkuMatch && text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);

  if (directSkuMatch) {
    const qty = parseInt(directSkuMatch[1]);
    const sku = directSkuMatch[2].toUpperCase();
    const skus = [sku];
    const qtys = [qty];
    if (wantsLicense) {
      for (const ls of _licenseSkusFor(sku, licenseTerm, licenseTierOverride)) { skus.push(ls); qtys.push(qty); }
    }
    const resp = formatPricingResponse(null, skus, qtys);
    if (resp) return resp;
  }

  if (singleSkuMatch) {
    const sku = singleSkuMatch[1].toUpperCase();
    if (!/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(sku) && (/\d/.test(sku) || /^LIC-/i.test(sku))) {
      const skus = [sku];
      const qtys = [1];
      if (wantsLicense) {
        for (const ls of _licenseSkusFor(sku, licenseTerm, licenseTierOverride)) { skus.push(ls); qtys.push(1); }
      }
      const resp = formatPricingResponse(null, skus, qtys);
      if (resp) return resp;
    }
  }

  // ── NEW (Case 4 fix): Pronoun resolution for pricing follow-ups ──
  // "what is the cost of that" / "how much is it" / "price of those"
  // → look back at history for most recently quoted SKU(s) and price them.
  const pronounRef = text.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does|are|would))?\s+(?:an?\s+|the\s+)?(that|those|this|these|it|them|the\s+switch(?:es)?|the\s+ap(?:s)?|the\s+access\s+point(?:s)?|the\s+firewall|the\s+camera(?:s)?|the\s+quote)\b/i);
  if (pronounRef && personId && kv) {
    const history = await getHistory(kv, personId);
    if (history && history.length > 0) {
      const assistantMsgs = history.filter(h => h.role === 'assistant').reverse();
      for (const m of assistantMsgs) {
        const urlMatch = m.content.match(/stratusinfosystems\.com\/order\/\?item=([^\s&]+)&qty=([^\s)]+)/);
        if (urlMatch) {
          const skuList = urlMatch[1].split(',').map(s => s.trim()).filter(Boolean);
          const qtyList = urlMatch[2].split(',').map(q => parseInt(q.trim(), 10));
          if (skuList.length > 0 && qtyList.length === skuList.length) {
            const finalSkus = skuList.slice();
            const finalQtys = qtyList.slice();
            if (wantsLicense) {
              for (let i = 0; i < skuList.length; i++) {
                const s = skuList[i];
                if (!s.toUpperCase().startsWith('LIC-')) {
                  for (const ls of _licenseSkusFor(s, licenseTerm, licenseTierOverride)) {
                    if (!finalSkus.some(e => e.toUpperCase() === ls.toUpperCase())) { finalSkus.push(ls); finalQtys.push(qtyList[i]); }
                  }
                }
              }
            }
            const resp = formatPricingResponse(null, finalSkus, finalQtys);
            if (resp) return resp;
          }
        }
      }
    }
  }

  // Pattern 2: References to "Option 1/2/3" (or legacy A/B/B1/B2) or "X-Year" from prior conversation
  const optionRef = text.match(/\b(?:OPTION\s+(1|2|3|A|B|B1|B2))\b/i);
  const termRef = text.match(/\b(\d)\s*-?\s*YEAR/i);

  // Only use history-based pricing when there's an EXPLICIT reference to a prior quote
  // (option number, term year, "the 3-year", etc.) — NOT just any pricing question
  if (!optionRef && !termRef) return null;

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
  // Fallback for term references: find most recent message with Stratus order URLs
  if (!lastResponse && termRef) {
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

// ─── Word-to-Number Conversion ──────────────────────────────────────────────
// Converts written-out English numbers to digits so "two MR44" → "2 MR44".
// Handles: one–twenty, tens (thirty–ninety), compounds (twenty-five / twenty five),
// "a dozen", "half dozen", "hundred", and "a couple [of]".
const WORD_NUMBERS = {
  ZERO: 0, ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7,
  EIGHT: 8, NINE: 9, TEN: 10, ELEVEN: 11, TWELVE: 12, THIRTEEN: 13,
  FOURTEEN: 14, FIFTEEN: 15, SIXTEEN: 16, SEVENTEEN: 17, EIGHTEEN: 18,
  NINETEEN: 19, TWENTY: 20, THIRTY: 30, FORTY: 40, FIFTY: 50, SIXTY: 60,
  SEVENTY: 70, EIGHTY: 80, NINETY: 90, HUNDRED: 100
};

function convertWordNumbers(text) {
  let result = text;

  // "a dozen" / "half dozen" / "half a dozen" → 12 / 6
  result = result.replace(/\bhalf\s+(?:a\s+)?dozen\b/gi, '6');
  result = result.replace(/\ba\s+dozen\b/gi, '12');
  result = result.replace(/\bdozen\b/gi, '12');

  // "a couple of" / "a couple" → 2
  result = result.replace(/\ba\s+couple\s+(?:of\s+)?/gi, '2 ');
  result = result.replace(/\ba\s+couple\b/gi, '2');

  // Compound tens: "twenty-five", "twenty five", "thirty two", etc.
  // Must run BEFORE simple word replacement to avoid partial matches
  const tens = 'TWENTY|THIRTY|FORTY|FIFTY|SIXTY|SEVENTY|EIGHTY|NINETY';
  const ones = 'ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE';
  const compoundRe = new RegExp(`\\b(${tens})[\\s-]+(${ones})\\b`, 'gi');
  result = result.replace(compoundRe, (_, t, o) => {
    return String(WORD_NUMBERS[t.toUpperCase()] + WORD_NUMBERS[o.toUpperCase()]);
  });

  // Simple single-word numbers (one through ninety, hundred)
  // Use word boundary to avoid replacing inside other words ("fortune", "bone", etc.)
  const allWords = Object.keys(WORD_NUMBERS).join('|');
  const simpleRe = new RegExp(`\\b(${allWords})\\b`, 'gi');
  result = result.replace(simpleRe, (m) => {
    const val = WORD_NUMBERS[m.toUpperCase()];
    return val !== undefined ? String(val) : m;
  });

  return result;
}

// ─── V2 Classifier → parseMessage-shape Adapter (PR 2) ─────────────────────
// Consumes the Llama V2 classifier's rich JSON schema and produces the same
// shape `parseMessage` returns, so `buildQuoteResponse` can run untouched.
// This replaces the legacy PR 1 adapter, which collapsed V2 `items[]` into a
// joined string and re-ran `parseMessage` on it, discarding modifier,
// revision, reference, and dashboard fidelity.
//
// Returns:
//   - null → caller should fall back to parseMessage (not a quote intent, or
//            V2 items[] empty)
//   - { items, requestedTerm, modifiers, requestedTier, isAdvisory, isRevision,
//       showPricing, unresolvedCategories, _fromV2: true }
//
// License-only paths return directLicense / directLicenseList exactly as
// parseMessage does, so downstream license-list rendering is unchanged.
function buildQuoteFromV2(v2, rawText) {
  if (!v2 || typeof v2 !== 'object') return null;
  if (v2.intent !== 'quote') return null;

  // ─── Short-circuits: route around V2 when parseMessage knows better ────
  // Each of these covers a family or pattern the V2 Llama prompt does NOT
  // teach, where V2 is likely to hallucinate or drop features. Returning
  // null bounces the caller to parseMessage(), which has correct
  // deterministic handlers for all of them.
  const rawStr = typeof rawText === 'string' ? rawText : '';

  // 1. Duo / Umbrella — no longer short-circuited.
  //    The V2 prompt now teaches the canonical SKU format
  //    (LIC-DUO-{TIER}-{1,3,5}YR, LIC-UMB-{DNS|SIG}-{ESS|ADV}-K9-{1,3,5}YR)
  //    AND the "all duo"/"all umbrella" cartesian expansion rule with
  //    separate_quotes=true. Items are still validated against prices.json
  //    below, so hallucinated SKUs still bounce to parseMessage as a
  //    safety net.

  // 2. Catalyst M-series (C9300, C9300L, C9300X, C9200L, C8111, C8455) —
  //    V2 prompt only teaches Meraki families. parseMessage + validateSku
  //    have the full Catalyst regex and license map (LIC-C9300-{port}E-1Y
  //    etc.).
  if (/\b(C9[23]\d{2}[LX]?|C8[14]\d{2})\b/i.test(rawStr)) return null;

  // 3. Meraki accessories (MA-* — transceivers, cables, PSUs, mounts,
  //    stacking kits). V2 prompt doesn't teach MA-. parseMessage has
  //    /MA-[A-Z0-9-]+/gi and validateSku passes them through.
  if (/\bMA-[A-Z0-9]/i.test(rawStr)) return null;

  // 4. Model-agnostic license phrasing ("5 MR licenses", "10 MV renewal",
  //    "quote MT license"). parseMessage injects virtual MR-AGN / MV-AGN /
  //    MT-AGN items that produce 1Y/3Y/5Y URLs with the right co-term SKU
  //    (LIC-ENT / LIC-MV / LIC-MT). V2 has no concept of this.
  if (/\b\d+\s*(MR|MV|MT)(?:'?S)?\s+(LICENSE|LICENCE|LISCENSE|LIC|RENEWAL)/i.test(rawStr)) return null;
  if (/\b(LICENSE|LICENCE|LIC|RENEWAL)S?\s+(FOR\s+)?(MR|MV|MT)\b(?!\d)/i.test(rawStr)) return null;
  if (/^(?:QUOTE\s+)?(MR|MV|MT)\s+(LICENSE|LICENCE|LIC|RENEWAL)/i.test(rawStr.trim())) return null;

  // 5. Bare family mentions that should trigger variant-choice clarify —
  //    MS150, MS130 (bare, no variant), MS390, MS450, C9300L, C9200L,
  //    bare "CW" without a digit. parseMessage returns a clarify message
  //    with the available variants.
  if (/\b(MS150|MS130|MS390|MS450)\b(?!-)/i.test(rawStr)) return null;
  if (/\b(C9300L?|C9200L)\b(?!-)/i.test(rawStr)) return null;
  if (/\bCW\b(?!\d)/i.test(rawStr)) return null;

  // 6. Wi-Fi generation category clarify ("wifi 7 AP", "6E aps",
  //    "2 wi-fi 6 access points"). parseMessage emits unresolvedCategories
  //    with model suggestions. V2 prompt has no concept of this.
  if (/\b(WI[-\s]?FI|WIFI)\s*(6E|6|7)\s+(AP|APS|ACCESS)/i.test(rawStr)) return null;

  // 7. Pronoun / history references ("quote this", "requote that") — let
  //    the vision-SKU KV bridge handle these. If V2 hallucinates items
  //    while the ref flag is set, returning non-null would bypass the KV
  //    lookup at the Webex handler's parseMessage==null branch.
  const ref = (v2.reference && typeof v2.reference === 'object') ? v2.reference : {};
  if (ref.is_pronoun_ref === true || ref.resolve_from_history === true) return null;

  const items = Array.isArray(v2.items) ? v2.items.filter(i => i && i.sku) : [];
  if (items.length === 0) return null;

  const mods = (v2.modifiers && typeof v2.modifiers === 'object') ? v2.modifiers : {};
  const showPricing = Boolean(mods.show_pricing);

  // Classify each V2 item into hardware vs license. Trust sku_type first,
  // fall back to LIC- prefix heuristic.
  const hwItems = [];
  const licItems = [];
  for (const it of items) {
    const sku = String(it.sku).toUpperCase().trim();
    if (!sku) continue;
    const qty = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;
    const isLicense = (it.sku_type === 'license') || sku.startsWith('LIC-');
    if (isLicense) licItems.push({ sku, qty });
    else hwItems.push({ sku, qty });
  }

  // Validate every V2 license SKU against the live prices catalog. If ANY
  // license SKU is hallucinated (not in prices), return null so parseMessage
  // can take over — it produces the correct canonical SKU deterministically.
  for (const lic of licItems) {
    if (!(lic.sku in prices)) return null;
  }

  // separate_quotes: trust V2's detection OR fall back to a deterministic
  // regex over the raw user text. V2 (Llama) misses this modifier often,
  // especially when the phrase is sandwiched in a longer message, so we
  // belt-and-suspenders override on any of these variants:
  //   "as separate quotes", "separate URLs/links", "individual quotes",
  //   "each as its own quote", "split into separate", "one per line",
  //   "break these out", "X URL/link, Y URL/link, ..."
  const rawForDetect = String(rawText || '');
  const separateQuotesRegex = /\b(?:as\s+)?separate\s+(?:quote|quotes|url|urls|link|links)\b|\bindividual\s+(?:quote|quotes|url|urls|link|links)\b|\beach\s+as\s+(?:its|their)\s+own\s+(?:quote|url|link)\b|\bsplit\s+(?:these\s+|them\s+)?into\s+separate\b|\bone\s+per\s+line\b|\bbreak\s+(?:these|them)\s+out\b/i;
  const separateQuotes = Boolean(mods.separate_quotes) || separateQuotesRegex.test(rawForDetect);

  // Pure license path — caller renders via directLicense / directLicenseList
  if (hwItems.length === 0 && licItems.length > 0) {
    if (licItems.length === 1) {
      return {
        items: [],
        directLicense: { sku: licItems[0].sku, qty: licItems[0].qty },
        requestedTerm: null,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing,
        unresolvedCategories: [],
        _fromV2: true
      };
    }
    // Dedupe — if V2 emitted the same license twice, keep the higher qty.
    const byKey = new Map();
    for (const it of licItems) {
      const prev = byKey.get(it.sku);
      if (!prev || it.qty > prev.qty) byKey.set(it.sku, it);
    }
    const dedup = [...byKey.values()];
    // If separate_quotes is on, route multi-license through the
    // isTermOptionQuote renderer so each license becomes its OWN URL with a
    // friendly label (e.g. Duo Essentials / Duo Premier / Duo Advantage).
    // Without this, the directLicenseList path concatenates every SKU into a
    // single combined URL.
    if (separateQuotes) {
      return {
        items: dedup.map(l => ({ baseSku: l.sku, qty: l.qty, isLicenseOnly: true })),
        isQuote: true,
        isTermOptionQuote: true,
        modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes: true },
        requestedTier: null,
        isAdvisory: false,
        isRevision: false,
        showPricing,
        unresolvedCategories: [],
        _fromV2: true
      };
    }
    return {
      items: [],
      directLicenseList: dedup,
      requestedTerm: null,
      modifiers: { hardwareOnly: false, licenseOnly: true, separateQuotes },
      requestedTier: null,
      isAdvisory: false,
      isRevision: false,
      showPricing,
      unresolvedCategories: [],
      _fromV2: true
    };
  }

  // Hardware path — normalize base SKUs (strip any suffix V2 may have left on)
  // so `applySuffix` / `buildQuoteResponse` can re-apply the correct one.
  const normHw = [];
  const seen = new Set();
  for (const it of hwItems) {
    let base = it.sku
      // Strip -HW / -HW-NA / -MR / -RTG hardware suffixes; re-added later.
      .replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => (na ? na : ''))
      // Defense-in-depth: if V2 missed a tier-suffix split, drop it here.
      .replace(/-(SEC|ENT|SDW|SD-WAN)$/i, '')
      .trim();
    if (!base) continue;
    // Dedupe — if the same base appears twice, keep the higher qty.
    if (seen.has(base)) {
      const prev = normHw.find(x => x.baseSku === base);
      if (prev && it.qty > prev.qty) prev.qty = it.qty;
      continue;
    }
    seen.add(base);
    normHw.push({ baseSku: base, qty: it.qty });
  }

  if (normHw.length === 0 && licItems.length === 0) return null;

  // requestedTerm — all_terms wins (null triggers 1/3/5Y output); otherwise term_years.
  let requestedTerm = null;
  if (!mods.all_terms) {
    const t = parseInt(mods.term_years, 10);
    if ([1, 3, 5].includes(t)) requestedTerm = t;
  }

  // requestedTier — SEC / ENT / SDW only; anything else falls through to default.
  let requestedTier = null;
  if (mods.tier) {
    const raw = String(mods.tier).toUpperCase().replace(/\s+/g, '').replace(/^SD-WAN$/, 'SDW');
    if (['SEC', 'ENT', 'SDW'].includes(raw)) requestedTier = raw;
  }

  // Hardware + attached licenses (e.g. "MR44 with LIC-ENT-3YR"): buildQuoteResponse
  // auto-generates licenses for each hardware item, so explicit license items are
  // redundant here. We still honor an explicit term_years signal pulled from the
  // attached license (e.g. "5 MR44 with LIC-ENT-3YR" implies 3yr).
  if (requestedTerm == null && licItems.length > 0 && !mods.all_terms) {
    for (const lic of licItems) {
      const termMatch = lic.sku.match(/-([135])YR?$/);
      if (termMatch) {
        const impliedTerm = parseInt(termMatch[1], 10);
        if ([1, 3, 5].includes(impliedTerm)) {
          requestedTerm = impliedTerm;
          break;
        }
      }
    }
  }

  return {
    items: normHw,
    requestedTerm,
    modifiers: {
      hardwareOnly: Boolean(mods.hardware_only),
      licenseOnly: Boolean(mods.license_only),
      separateQuotes
    },
    requestedTier,
    isAdvisory: false,
    isRevision: false,
    showPricing,
    unresolvedCategories: [],
    _fromV2: true
  };
}

// ─── V2 Revision Applicator (PR 2) ─────────────────────────────────────────
// Applies a V2 revision object to a prior parseMessage-shape quote and returns
// a new parseMessage-shape result that can feed straight into buildQuoteResponse.
// Returns null for revision actions we can't handle deterministically (caller
// falls back to askClaude which has the full conversation history).
//
// Supported actions (deterministic, fast): change_term, change_tier,
// toggle_hw_lic, add, remove, swap, change_qty.
// Unsupported or ambiguous cases (empty prior, missing target, no add_items)
// return null so the caller can route to Claude.
function applyV2Revision(priorParsed, v2) {
  if (!priorParsed || !v2 || !v2.revision) return null;
  const rev = v2.revision || {};
  const mods = v2.modifiers || {};
  // Back-compat: if the classifier left action=null but flagged show_pricing,
  // treat it as a show_pricing revision. Keeps us resilient to prompt drift.
  // Same idea for separate_quotes: user saying "as separate quotes" against
  // a prior state doesn't fit any of the structural actions (it's a render-
  // mode toggle), so promote it to an explicit toggle_separate_quotes action.
  let action = rev.action;
  if (!action && mods.show_pricing) action = 'show_pricing';
  if (!action && mods.separate_quotes) action = 'toggle_separate_quotes';
  if (!action) return null;

  // Can't revise a prior that has no hardware items and no direct license list.
  const hasItems = Array.isArray(priorParsed.items) && priorParsed.items.length > 0;
  const hasDirLic = priorParsed.directLicense || (Array.isArray(priorParsed.directLicenseList) && priorParsed.directLicenseList.length > 0);
  if (!hasItems && !hasDirLic) return null;

  // Deep-ish clone of the prior quote shape. isTermOptionQuote is preserved
  // so the Duo/Umbrella per-tier renderer stays active across revisions
  // (change_term filters items, toggle_separate_quotes flips the flag).
  const next = {
    items: hasItems ? priorParsed.items.map(i => ({ baseSku: i.baseSku, qty: i.qty })) : [],
    directLicense: priorParsed.directLicense ? { ...priorParsed.directLicense } : undefined,
    directLicenseList: Array.isArray(priorParsed.directLicenseList)
      ? priorParsed.directLicenseList.map(l => ({ ...l }))
      : undefined,
    requestedTerm: priorParsed.requestedTerm ?? null,
    modifiers: { ...(priorParsed.modifiers || { hardwareOnly: false, licenseOnly: false }) },
    requestedTier: priorParsed.requestedTier ?? null,
    isTermOptionQuote: Boolean(priorParsed.isTermOptionQuote),
    isAdvisory: false,
    isRevision: false,
    showPricing: Boolean(mods.show_pricing) || Boolean(priorParsed.showPricing),
    unresolvedCategories: [],
    _fromV2: true,
    _revised: action
  };
  // Prune undefined direct* keys so downstream treats them as absent.
  if (!next.directLicense) delete next.directLicense;
  if (!next.directLicenseList) delete next.directLicenseList;

  const stripHwSuffix = (s) => String(s || '').toUpperCase()
    .replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => (na ? na : ''))
    .replace(/-(SEC|ENT|SDW|SD-WAN)$/i, '')
    .trim();

  switch (action) {
    case 'change_term': {
      const t = parseInt(rev.new_term, 10);
      if (![1, 3, 5].includes(t)) return null;
      next.requestedTerm = t;
      // For Duo/Umbrella isTermOptionQuote items, the term lives IN the SKU
      // (LIC-DUO-ESSENTIALS-{1,3,5}YR) — metadata alone doesn't filter them.
      // Narrow the items list to just the matching term so the renderer
      // emits per-tier URLs for only the selected term.
      if (next.isTermOptionQuote && Array.isArray(next.items) && next.items.length > 0) {
        const suffixRe = new RegExp(`-${t}YR?$`, 'i');
        const filtered = next.items.filter(i => suffixRe.test(String(i.baseSku)));
        if (filtered.length === 0) return null; // no SKUs at that term → bail
        next.items = filtered;
      }
      // Same idea for a directLicenseList of Duo/Umbrella SKUs (legacy path
      // for prior states that predate the isTermOptionQuote promotion).
      if (!next.isTermOptionQuote && Array.isArray(next.directLicenseList) && next.directLicenseList.length > 0) {
        const suffixRe = new RegExp(`-${t}YR?$`, 'i');
        const allDuoUmb = next.directLicenseList.every(l => /^LIC-(DUO|UMB)-/i.test(String(l.sku || '')));
        if (allDuoUmb) {
          const filtered = next.directLicenseList.filter(l => suffixRe.test(String(l.sku)));
          if (filtered.length === 0) return null;
          next.directLicenseList = filtered;
        }
      }
      return next;
    }
    case 'toggle_separate_quotes': {
      // Render-mode toggle — flip modifiers.separateQuotes on the prior
      // shape so the renderer emits one URL per SKU (or per tier, for
      // isTermOptionQuote). Also promote a directLicenseList of all
      // Duo/Umbrella SKUs to isTermOptionQuote shape so the per-tier
      // label path kicks in.
      next.modifiers = { ...(next.modifiers || {}), separateQuotes: true };
      if (!next.isTermOptionQuote && Array.isArray(next.directLicenseList) && next.directLicenseList.length > 1) {
        const allDuoUmb = next.directLicenseList.every(l => /^LIC-(DUO|UMB)-/i.test(String(l.sku || '')));
        if (allDuoUmb) {
          next.items = next.directLicenseList.map(l => ({ baseSku: l.sku, qty: l.qty }));
          delete next.directLicenseList;
          next.isTermOptionQuote = true;
        }
      }
      return next;
    }
    case 'change_tier': {
      const raw = String(rev.new_tier || '').toUpperCase().replace(/\s+/g, '').replace(/^SD-WAN$/, 'SDW');
      if (!['SEC', 'ENT', 'SDW'].includes(raw)) return null;
      next.requestedTier = raw;
      return next;
    }
    case 'toggle_hw_lic': {
      const t = rev.hw_lic_toggle;
      if (t === 'hardware_only') { next.modifiers.hardwareOnly = true; next.modifiers.licenseOnly = false; return next; }
      if (t === 'license_only')  { next.modifiers.licenseOnly = true; next.modifiers.hardwareOnly = false; return next; }
      return null;
    }
    case 'change_qty': {
      const q = parseInt(rev.new_qty, 10);
      if (!Number.isFinite(q) || q <= 0) return null;
      // If target_sku given, change only that item; otherwise apply to all.
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      if (tgt && hasItems) {
        let hit = false;
        for (const it of next.items) {
          if (stripHwSuffix(it.baseSku) === tgt) { it.qty = q; hit = true; }
        }
        if (!hit) return null;
      } else if (hasItems) {
        for (const it of next.items) it.qty = q;
      } else if (next.directLicenseList) {
        for (const it of next.directLicenseList) it.qty = q;
      } else if (next.directLicense) {
        next.directLicense.qty = q;
      }
      return next;
    }
    case 'remove': {
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      if (!tgt) return null;
      if (hasItems) next.items = next.items.filter(it => stripHwSuffix(it.baseSku) !== tgt);
      if (next.directLicenseList) next.directLicenseList = next.directLicenseList.filter(l => String(l.sku || '').toUpperCase() !== tgt);
      if (next.directLicense && String(next.directLicense.sku).toUpperCase() === tgt) delete next.directLicense;
      if ((next.items?.length || 0) === 0 && !next.directLicense && !(next.directLicenseList?.length)) return null;
      return next;
    }
    case 'add': {
      const adds = Array.isArray(rev.add_items) ? rev.add_items : [];
      if (adds.length === 0) return null;
      for (const a of adds) {
        if (!a || !a.sku) continue;
        const rawSku = String(a.sku).toUpperCase().trim();
        const qty = Number.isFinite(Number(a.qty)) && Number(a.qty) > 0 ? Math.floor(Number(a.qty)) : 1;
        if (rawSku.startsWith('LIC-')) {
          // Promote single licence into directLicenseList alongside prior state.
          if (!next.directLicenseList) next.directLicenseList = next.directLicense ? [next.directLicense] : [];
          delete next.directLicense;
          next.directLicenseList.push({ sku: rawSku, qty });
        } else {
          const base = stripHwSuffix(rawSku);
          const existing = next.items.find(it => stripHwSuffix(it.baseSku) === base);
          if (existing) existing.qty += qty;
          else next.items.push({ baseSku: base, qty });
        }
      }
      return next;
    }
    case 'show_pricing': {
      // No structural change — keep items/term/tier/qty as-is. Flip showPricing
      // so buildQuoteResponse renders the existing quote with dollar figures.
      next.showPricing = true;
      return next;
    }
    case 'swap': {
      const tgt = rev.target_sku ? stripHwSuffix(rev.target_sku) : null;
      const adds = Array.isArray(rev.add_items) ? rev.add_items : [];
      if (!tgt || adds.length === 0) return null;
      // Capture qty of target so swap preserves it if caller didn't specify one.
      let carriedQty = null;
      if (hasItems) {
        const targetItem = next.items.find(it => stripHwSuffix(it.baseSku) === tgt);
        if (targetItem) carriedQty = targetItem.qty;
        next.items = next.items.filter(it => stripHwSuffix(it.baseSku) !== tgt);
      }
      for (const a of adds) {
        if (!a || !a.sku) continue;
        const rawSku = String(a.sku).toUpperCase().trim();
        const aQty = Number.isFinite(Number(a.qty)) && Number(a.qty) > 0
          ? Math.floor(Number(a.qty))
          : (carriedQty != null ? carriedQty : 1);
        if (rawSku.startsWith('LIC-')) {
          if (!next.directLicenseList) next.directLicenseList = next.directLicense ? [next.directLicense] : [];
          delete next.directLicense;
          next.directLicenseList.push({ sku: rawSku, qty: aQty });
        } else {
          const base = stripHwSuffix(rawSku);
          const existing = next.items.find(it => stripHwSuffix(it.baseSku) === base);
          if (existing) existing.qty += aQty;
          else next.items.push({ baseSku: base, qty: aQty });
        }
      }
      if ((next.items?.length || 0) === 0 && !next.directLicense && !(next.directLicenseList?.length)) return null;
      return next;
    }
    default:
      return null;
  }
}

// ─── Extract parseMessage-shape from a prior assistant quote URL (PR 2) ───────
// The assistant's last quote response contains the current state of the quote
// in a URL like:
//   https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=10,10
// This helper parses that URL back into a parseMessage-shape so chained
// revisions (revise after revise) can preserve intermediate state that
// scanning user messages would miss.
// Returns null if no parseable URL is found in the content.
function extractPriorFromAssistantUrl(content) {
  if (!content || typeof content !== 'string') return null;
  // Find ALL /order/?... URLs in the message. A multi-term quote (1Y/3Y/5Y)
  // or multi-option quote (Option 1/2/3) can emit several URLs; we pool
  // items + licenses across all of them so revise-after-multi-term preserves
  // the full item list and lets us detect "all terms were shown."
  const urls = content.match(/stratusinfosystems\.com\/order\/\?[^\s)`"'<>]+/gi);
  if (!urls || urls.length === 0) return null;

  const stripHw = (s) => String(s || '').toUpperCase()
    .replace(/-(HW|MR|RTG)(-NA)?$/i, (m, _a, na) => (na ? na : ''))
    .replace(/-(SEC|ENT|SDW|SD-WAN)$/i, '')
    .trim();

  // Pool across URLs. Keep first-seen qty for each distinct SKU (all terms
  // typically carry the same quantities anyway).
  const itemMap = new Map(); // baseSku → qty
  const licMap  = new Map(); // sku     → qty
  const termsSeen = new Set();
  // Track MX tier and agnostic tier separately. MX-specific licenses (which
  // are hardware-tied) are authoritative when present; family-agnostic MR
  // licenses are the fallback. This prevents LIC-ENT-5YR (tier-agnostic MR)
  // from corrupting MX's tier during swap revisions.
  let mxTier = null;
  let agnosticTier = null;

  for (const url of urls) {
    const qs = url.split('?')[1] || '';
    const params = {};
    for (const kv of qs.split('&')) {
      const [k, v] = kv.split('=');
      if (k) params[k] = decodeURIComponent(v || '');
    }
    const itemStr = params.item || '';
    const qtyStr  = params.qty  || '';
    if (!itemStr) continue;
    const skus = itemStr.split(',').map(s => s.trim()).filter(Boolean);
    const qtys = qtyStr.split(',').map(n => parseInt(n, 10));

    for (let i = 0; i < skus.length; i++) {
      const sku = skus[i].toUpperCase();
      const qty = Number.isFinite(qtys[i]) && qtys[i] > 0 ? qtys[i] : 1;
      if (sku.startsWith('LIC-')) {
        if (!licMap.has(sku)) licMap.set(sku, qty);
        // Term — collect ALL distinct term years across URLs. If more than
        // one (e.g. 1Y/3Y/5Y all shown), the caller should render all three.
        const tm = sku.match(/-([135])Y(R?)$/);
        if (tm) termsSeen.add(parseInt(tm[1], 10));
        // Tier — MX-specific takes precedence (LIC-MX67-SEC, LIC-MX-SEC for
        // fixtures). Tier-agnostic MR (LIC-ENT/SEC/SDW-*YR) is only a fallback
        // when no MX licenses are present.
        const mxMatch = sku.match(/^LIC-MX\w*-(SEC|ENT|SDW)-/);
        if (mxMatch) {
          mxTier = mxMatch[1];
        } else {
          const agMatch = sku.match(/^LIC-(ENT|SEC|SDW)-[135]YR?$/);
          if (agMatch) agnosticTier = agMatch[1];
        }
      } else {
        const base = stripHw(sku);
        if (base && !itemMap.has(base)) itemMap.set(base, qty);
      }
    }
  }

  const inferredTier = mxTier || agnosticTier;

  if (itemMap.size === 0 && licMap.size === 0) return null;

  const items = [];
  for (const [baseSku, qty] of itemMap) items.push({ baseSku, qty });

  // If >1 distinct term surfaced across URLs, leave term null so the renderer
  // emits 1/3/5Y again on revision. Exactly 1 → lock to that term.
  const inferredTerm = termsSeen.size === 1 ? [...termsSeen][0] : null;

  // Partition licenses: family-agnostic standalone licenses (MR ENT/SEC/SDW,
  // MV, MT) can't be regenerated from any hardware item. When mixed alongside
  // real hardware, we convert them into MR-AGN / MV-AGN / MT-AGN items that
  // the renderer recognizes so the quantity survives swap revisions. When
  // pure-license (no hw at all), we leave items empty so the caller takes
  // the directLicense / directLicenseList path below. All other licenses
  // (MX-, MS-, Cxxxx-, etc.) are hardware-tied and will be regenerated by
  // buildQuoteResponse from item+term+tier, so they're dropped here.
  if (itemMap.size > 0) {
    const agnInjections = [];
    for (const [sku, qty] of licMap) {
      if (/^LIC-(ENT|SEC|SDW)-[135]YR?$/.test(sku)) {
        agnInjections.push({ family: 'MR', qty });
      } else if (/^LIC-MV-[135]YR?$/.test(sku)) {
        agnInjections.push({ family: 'MV', qty });
      } else if (/^LIC-MT-[135]Y$/.test(sku)) {
        agnInjections.push({ family: 'MT', qty });
      }
    }
    for (const { family, qty } of agnInjections) {
      const agnSku = `${family}-AGN`;
      // Skip if hardware from that family is already present (e.g. MR44 in
      // items means the MR license belongs to it, not a standalone bulk).
      const familyPresent = items.some(it => {
        const m = it.baseSku.match(/^([A-Z]+)/);
        return m && m[1] === family;
      });
      if (!familyPresent && !items.some(it => it.baseSku === agnSku)) {
        items.push({ baseSku: agnSku, qty });
      }
    }
  }

  // Pure license path — no hardware, only loose licenses. Use directLicense
  // for single, directLicenseList for multi. (Reached only when itemMap was
  // empty AND every license was non-agnostic, which is rare but possible.)
  if (items.length === 0 && licMap.size > 0) {
    const licList = [...licMap.entries()].map(([sku, qty]) => ({ sku, qty }));

    // Duo / Umbrella promotion: when the pooled licenses are all in the
    // isTermOptionQuote family (LIC-DUO-* / LIC-UMB-*), return the
    // isTermOptionQuote shape instead of directLicenseList. Preserves
    // the per-tier labeled rendering the user originally saw, and lets
    // applyV2Revision filter by term / toggle separateQuotes without
    // losing the shape. Multi-tier pools default to separateQuotes=true
    // because that's the only way the original render produced >1 URL.
    const isAllDuoUmb = licList.length >= 2 &&
      licList.every(l => /^LIC-(DUO|UMB)-/.test(String(l.sku || '')));
    if (isAllDuoUmb) {
      const tierFamilies = new Set();
      for (const l of licList) {
        tierFamilies.add(String(l.sku).replace(/-(\d)YR?$/i, ''));
      }
      return {
        items: licList.map(l => ({ baseSku: l.sku, qty: l.qty })),
        isTermOptionQuote: true,
        requestedTerm: inferredTerm,
        requestedTier: inferredTier,
        modifiers: {
          hardwareOnly: false,
          licenseOnly: true,
          separateQuotes: tierFamilies.size >= 2
        },
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: [],
        _fromAssistantUrl: true
      };
    }

    if (licList.length === 1) {
      return {
        items: [],
        directLicense: licList[0],
        requestedTerm: inferredTerm,
        modifiers: { hardwareOnly: false, licenseOnly: true },
        requestedTier: inferredTier,
        isAdvisory: false,
        isRevision: false,
        showPricing: false,
        unresolvedCategories: [],
        _fromAssistantUrl: true
      };
    }
    return {
      items: [],
      directLicenseList: licList,
      requestedTerm: inferredTerm,
      modifiers: { hardwareOnly: false, licenseOnly: true },
      requestedTier: inferredTier,
      isAdvisory: false,
      isRevision: false,
      showPricing: false,
      unresolvedCategories: [],
      _fromAssistantUrl: true
    };
  }

  // Mixed or hardware-only path. Hardware-tied licenses get auto-generated
  // by buildQuoteResponse from item+term+tier. hardwareOnly only true if
  // we saw zero licenses at all in the URL(s).
  const hardwareOnly = licMap.size === 0;
  return {
    items,
    requestedTerm: inferredTerm,
    modifiers: { hardwareOnly, licenseOnly: false },
    requestedTier: inferredTier,
    isAdvisory: false,
    isRevision: false,
    showPricing: false,
    unresolvedCategories: [],
    _fromAssistantUrl: true
  };
}

// ─── Family / Wi-Fi-Class Expansion (Additive) ──────────────────────────────
// Turns a bare family SKU ("MS150", "C9200L", "MX"), a wifi-class AP request
// ("all wifi 7 APs"), or a filtered family ("all 48 port PoE variants of
// MS150") into a pre-filled items list so buildQuoteResponse can emit one
// URL per variant per term. Accessories (stack kits, network modules,
// MA-/PWR-/SFP- transceivers) are excluded automatically.
//
// Returns null when the request doesn't match, so parseMessage falls through
// to its existing logic untouched. Nothing outside this function changes.
function expandFamily(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  const cleaned = upper.replace(/[.!?,;:"']+$/, '').trim();

  // ── Guardrails: skip inputs better handled by existing logic ──
  // 1. Multi-line input (CSV paste, dashboard export)
  const nonEmptyLines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (nonEmptyLines.length > 1) return null;
  // 2. License SKUs present anywhere in the message
  if (/\bLIC-[A-Z0-9]/.test(cleaned)) return null;
  // 3. Fully-qualified hardware SKU typed out (let validateSku handle it)
  if (/\b(MS\d{2,3}-\d{1,3}[A-Z]{1,3}-\d+[GXY](?:-[A-Z]+)?|C9\d{3}L?X?-\d+[A-Z]{1,3}-\d+[GXY]-M|MR\d+[A-Z]*-HW|MX\d+[CW]{0,2}(?:-NA)?-HW(?:-NA)?|CW9\d{3}[A-Z0-9]*-(?:HW|MR|RTG))\b/.test(cleaned)) return null;
  // 4. Quantity-prefixed bare family for MR/MV/MT → existing agnostic path
  if (/^\s*\d+\s*(MR|MV|MT)S?\s*$/.test(cleaned)) return null;
  // 5. Question / advisory phrases (lead time, compare, etc.)
  if (/^(HOW|WHAT|WHICH|WHEN|WHERE|WHY|IS|ARE|DO|DOES|CAN|SHOULD|TELL|EXPLAIN|COMPARE|DIFFERENCE|RECOMMEND|INFO|INFORMATION|LEAD\s+TIME|NEED\s+HELP)\b/.test(cleaned)) return null;
  // 6. Revision verbs targeting existing quotes
  if (/\b(DROP|REMOVE|DELETE|REPLACE|CHANGE|REVISE)\s+(THE|THAT|IT|THOSE|THEM)\b/.test(cleaned)) return null;
  // 7. Multi-SKU comma list (>2 parts) → user is explicitly listing SKUs
  const commaParts = cleaned.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
  if (commaParts.length > 2) return null;
  // 8. Specific model number present (MX75, MR44, MV53, MT20, C9300-48P, …).
  //    These are targeted requests or mixed quotes. The existing parser handles
  //    them (often via unresolvedCategories for wifi-class placeholders), and
  //    auto-expanding would hijack that flow.
  if (/\b(MX\d+[A-Z]*|MR\d+[A-Z]*|MV\d+[A-Z]*|MT\d+[A-Z]*|MG\d+[A-Z]*|Z\d+[A-Z]*|MS\d{2,3}-\d+|C9\d{3}L?X?-\d+|CW9\d{3}[A-Z]+\d*)\b/.test(cleaned)) return null;

  // ── Wi-Fi class detection ──
  const wifiClass =
    /\b(WI[-\s]?FI\s*7|WIFI7)\b/.test(cleaned) ? '7' :
    /\b(WI[-\s]?FI\s*6E|WIFI6E)\b/.test(cleaned) ? '6E' :
    /\b(WI[-\s]?FI\s*6|WIFI6)\b/.test(cleaned) ? '6' : null;

  // ── Intent markers ──
  const hasAll = /\b(ALL|EVERY|EACH)\b/.test(cleaned);

  // ── Family-token detection (longest alternatives first) ──
  // Allow optional trailing "S" plural (e.g. "MS150s", "MXs") by stripping one
  // trailing S adjacent to the family token before matching. Apply only when the
  // cleaned input is a bare token or token + qualifier phrase so we don't strip
  // legitimate S suffixes inside a full SKU.
  const FAMILY_TOKEN_RE = /\b(MS130|MS150|MS210|MS220|MS225|MS250|MS320|MS350|MS355|MS390|MS410|MS420|MS425|MS450|MS120|MS125|C9200L|C9300L|C9300X|C9300|MX|MR|MV|MT|MG|CW)S?\b/;
  const fm = cleaned.match(FAMILY_TOKEN_RE);
  let family = fm ? fm[1] : null;

  // Wi-Fi-class-only request → resolve to catalog bucket
  if (!family && wifiClass) {
    family = (wifiClass === '6') ? 'MR' : 'CW';
  }
  if (!family) return null;

  // ── Load variant pool from auto-catalog ──
  let pool = Array.isArray(catalog[family]) ? catalog[family].slice() : null;
  if (!pool || pool.length === 0) return null;

  // ── Trigger gate ──
  // Bare family shorthand: "MS150", "MX", "MS150s", "MX switches", "MR APs".
  // Anything more complex must include "all/every", a Wi-Fi class, or a
  // port/PoE/uplink filter keyword.
  const bareFamilyRe = new RegExp(
    `^${family}S?(\\s+(APS?|ACCESS\\s+POINTS?|SWITCH(?:ES)?|APPLIANCES?|CAMERAS?|SENSORS?|GATEWAYS?|VARIANTS?|MODELS?|OPTIONS?))?$`
  );
  const isBare = cleaned === family || bareFamilyRe.test(cleaned);
  const filterWords = /\b(\d+[-\s]?PORTS?|NON[-\s]?POE|POE\+?|DATA[-\s]?ONLY|MULTIGIG|MGIG|FULL[-\s]?POE|LOW[-\s]?POE|UPOE|U[-\s]?POE|10G|25G|\b1G\b|UPLINK|NO\s+POE)\b/.test(cleaned);
  // Wi-Fi class alone is a CATEGORY PLACEHOLDER (handled by existing
  // unresolvedCategories clarification flow). Only expand when paired with
  // explicit "all/every/each" or a port/PoE filter keyword.
  if (wifiClass && !hasAll && !filterWords && !isBare) return null;
  if (!isBare && !hasAll && !wifiClass && !filterWords) return null;

  // ── Wi-Fi-class pruning (CW catalog → 917x or 916x, MR is already Wi-Fi 6) ──
  if (wifiClass === '7') {
    pool = pool.filter(s => /^CW917/.test(s));
  } else if (wifiClass === '6E') {
    pool = pool.filter(s => /^CW916/.test(s));
  }

  // ── Accessory / niche-SKU exclusion ──
  pool = pool.filter(sku => {
    const u = sku.toUpperCase();
    if (/^MA-/.test(u)) return false;                 // transceivers, brackets
    if (/^(PWR|GLC|SFP|QSFP|CAB)-/.test(u)) return false;
    if (/-NM-/.test(u)) return false;                 // network modules
    if (/-STA-?KIT|-STAK-?KIT/.test(u)) return false; // stacking kits
    if (u === 'CW9163E') return false;                // outdoor extender
    if (u === 'CW9800H1') return false;               // wireless controller
    if (u === 'CW9179F') return false;                // specialty variant
    return true;
  });

  // ── Port-count filter ("48 port", "24-port", "48 ports") ──
  const portMatch = cleaned.match(/(\d{1,3})\s*[-]?\s*PORTS?\b/);
  if (portMatch) {
    const n = portMatch[1];
    const portRe = new RegExp(`(^|[-])${n}[A-Z]{0,4}?(-|$)`);
    pool = pool.filter(s => portRe.test(s.toUpperCase()));
  }

  // ── PoE-type filter ──
  const wantsNoPoe = /\b(NON[-\s]?POE|NO\s*POE|DATA[-\s]?ONLY)\b/.test(cleaned);
  const wantsFullPoe = /\b(FULL[-\s]?POE|\bFP\b)\b/.test(cleaned);
  const wantsLowPoe = /\b(LOW[-\s]?POE|\bLP\b)\b/.test(cleaned);
  const wantsMultigig = /\b(MULTIGIG|MGIG|\bMP\b)\b/.test(cleaned);
  const wantsUpoe = /\b(UPOE|U[-\s]?POE)\b/.test(cleaned);
  const wantsPoe = /\bPOE\+?\b/.test(cleaned) && !wantsNoPoe;

  if (/^(MS\d|C9)/.test(family)) {
    if (wantsNoPoe) pool = pool.filter(s => /-\d+T(-|$)/.test(s));
    else if (wantsFullPoe) pool = pool.filter(s => /-\d+FP(-|$)/.test(s));
    else if (wantsLowPoe) pool = pool.filter(s => /-\d+LP(-|$)/.test(s));
    else if (wantsMultigig) pool = pool.filter(s => /-\d+(MP|UXM|UN|PXG)(-|$)/.test(s));
    else if (wantsUpoe) pool = pool.filter(s => /-\d+(U|UN|UX|UXM)(-|$)/.test(s));
    else if (wantsPoe) pool = pool.filter(s => /-\d+(P|FP|LP|MP|U|UN|UX|UXM|PL|PXG)(-|$)/.test(s));
  }

  // ── Uplink filter (1G = "4G" suffix, 10G/25G = "4X"/"2Y" suffix) ──
  if (/\b(10G\s*UPLINK|SFP\+\s*UPLINK|TEN\s*G\s*UPLINK)\b/.test(cleaned) || (/\b10G\b/.test(cleaned) && /UPLINK/.test(cleaned))) {
    if (/^(MS\d|C9)/.test(family)) pool = pool.filter(s => /-(4X|2Y)(-M)?$/.test(s));
  } else if (/\b(1G\s*UPLINK|GIG\s*UPLINK)\b/.test(cleaned) && !/\b10G\b/.test(cleaned)) {
    if (/^(MS\d|C9)/.test(family)) pool = pool.filter(s => /-4G(-M)?$/.test(s));
  }

  // Filter excluded everything → let existing logic respond naturally
  if (pool.length === 0) return null;

  // Deterministic ordering
  pool.sort();

  const items = pool.map(baseSku => ({ baseSku, qty: 1 }));
  return {
    items,
    requestedTerm: null,
    modifiers: { hardwareOnly: false, licenseOnly: false, separateQuotes: true },
    requestedTier: null,
    isAdvisory: false,
    isRevision: false,
    showPricing: false,
    unresolvedCategories: [],
    _fromFamilyExpansion: true,
    _familyExpandedFrom: family,
    _wifiClass: wifiClass || null
  };
}

// ─── Message Parser ──────────────────────────────────────────────────────────
function parseMessage(text) {
  // Pre-process: convert written-out numbers to digits
  text = convertWordNumbers(text);

  // ── Additive family-expansion hook ──
  // Intercepts bare-family quotes ("MS150"), wifi-class AP requests
  // ("all wifi 7 APs"), and filtered family expansions ("all 48 port PoE
  // MS150 variants"). Emits one URL per variant per term via the existing
  // separateQuotes branch of buildQuoteResponse. Returns null to fall
  // through to existing logic when the request isn't a family expansion.
  const _expandedFamily = expandFamily(text);
  if (_expandedFamily && _expandedFamily.items && _expandedFamily.items.length > 0) {
    // Re-detect hardware-only / license-only on the raw request so trailing
    // modifiers like "hardware only", "hw only", "no license" survive the
    // family-expansion short-circuit. Mirrors the detection at ~line 3768.
    const _upper = text.toUpperCase();
    const _LIC_WORD  = `(?:LICENSE|LICENCE|LISCENSE|LISCENCE|LICESE|LIC)`;
    const _LIC_WORDS = `(?:LICENSE[S]?|LICENCE[S]?|LISCENSE[S]?|LISCENCE[S]?|LICESE[S]?|LIC)`;
    const _hwOnlyRe  = /\b(HARDWARE\s+ONLY|WITHOUT\s+(A\s+)?(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|NO\s+(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/;
    const _hwExcl    = /\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/;
    const _licOnlyRe = new RegExp(`\\b(${_LIC_WORDS}\\s+ONLY|JUST\\s+THE\\s+${_LIC_WORD}|JUST\\s+${_LIC_WORD}|NO\\s+HARDWARE|RENEWAL\\s+ONLY|${_LIC_WORD}\\s+RENEWAL|RENEW\\s+(THE\\s+)?${_LIC_WORDS})\\b`);
    if (_hwOnlyRe.test(_upper) && !_hwExcl.test(_upper)) {
      _expandedFamily.modifiers.hardwareOnly = true;
      _expandedFamily.modifiers.licenseOnly  = false;
    } else if (_licOnlyRe.test(_upper)) {
      _expandedFamily.modifiers.licenseOnly  = true;
      _expandedFamily.modifiers.hardwareOnly = false;
    }
    return _expandedFamily;
  }

  const upper = text.toUpperCase();

  // ── separate_quotes early detection ──
  // Detected early so the Duo/Umbrella handlers (which early-return before
  // the main modifier block) can carry this flag through to the renderer.
  // Deliberately tolerant — missing a phrasing just defaults to combined.
  const SEPARATE_QUOTES_RE = /\b(SEPARATE\s+(QUOTES?|URLS?|LINKS?)|INDIVIDUAL\s+(QUOTES?|URLS?|LINKS?)|EACH\s+(AS\s+)?(ITS\s+)?OWN\s+(QUOTES?|URLS?|LINKS?)|ONE\s+(QUOTE|URL|LINK)\s+(PER|EACH|APIECE|FOR\s+EACH)|BREAK\s+(THESE|THEM|IT)\s+OUT|SPLIT\s+(INTO|UP\s+INTO)\s+SEPARATE|AS\s+(THEIR|ITS)\s+OWN\s+(QUOTES?|URLS?|LINKS?))\b/;
  let __separateQuotes = SEPARATE_QUOTES_RE.test(upper);

  // Multi-line License SKU Input (CSV/list from dashboard export)
  // Handles formats like:
  //   LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\n...
  //   SKU,Count\nLIC-ENT-3YR,26\n...
  //   LIC-ENT-3YR 26\nLIC-MS120-8FP-3YR 4\n...
  const rawLines = text.trim().split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  // Strip leading bullet markers from all lines: •, -, *, numbered lists (1., 2.), etc.
  // This ensures bulleted lists (common in Webex/GChat/email pastes) parse correctly.
  const lines = rawLines.map(l => l.replace(/^[\s•\-\*·▸▹►‣⁃◦]+\s*/, '').replace(/^\d+[.)]\s*/, '').trim()).filter(Boolean);
  // Extract all LIC- entries, skipping headers and non-matching lines
  if (lines.length >= 2) {
    const licItems = [];
    for (const line of lines) {
      // Match: LIC-xxx,qty or LIC-xxx qty
      const csvMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[,\s]\s*(\d+)\s*$/i);
      // Match: qty x LIC-xxx or qty LIC-xxx (quantity-first format)
      const qtyFirstMatch = !csvMatch && line.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      // Match: LIC-xxx x qty (SKU-first with x separator, e.g. "LIC-ENT-1YR x5")
      const skuXqtyMatch = !csvMatch && !qtyFirstMatch && line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[xX×]\s*(\d+)\s*$/i);
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else if (qtyFirstMatch) {
        licItems.push({ sku: qtyFirstMatch[2].toUpperCase(), qty: parseInt(qtyFirstMatch[1]) });
      } else if (skuXqtyMatch) {
        licItems.push({ sku: skuXqtyMatch[1].toUpperCase(), qty: parseInt(skuXqtyMatch[2]) });
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

  // ── Single-line comma/semicolon-separated License SKU input ──
  // Handles: "LIC-MX68W-SEC-1YR, LIC-ENT-1YR, LIC-MS220-8P-1YR"
  // Also handles qty variants: "2x LIC-ENT-1YR, LIC-MX68-SEC-1YR"
  // The multi-line parser above requires >= 2 newline-separated lines,
  // so comma-separated input on a single line falls through. Catch it here.
  if (lines.length <= 2) {
    const commaParts = text.split(/[,;]+/).map(s => s.trim()).filter(Boolean);
    const licFromComma = [];
    for (const part of commaParts) {
      // "LIC-xxx" or "LIC-xxx qty" or "qty LIC-xxx" or "LIC-xxx x qty"
      const m1 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
      const m2 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s+(\d+)\s*$/i);
      const m3 = part.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      const m4 = part.match(/^\s*(LIC-[A-Z0-9-]+)\s*[xX×]\s*(\d+)\s*$/i);
      if (m2) {
        licFromComma.push({ sku: m2[1].toUpperCase(), qty: parseInt(m2[2]) });
      } else if (m3) {
        licFromComma.push({ sku: m3[2].toUpperCase(), qty: parseInt(m3[1]) });
      } else if (m4) {
        licFromComma.push({ sku: m4[1].toUpperCase(), qty: parseInt(m4[2]) });
      } else if (m1) {
        licFromComma.push({ sku: m1[1].toUpperCase(), qty: 1 });
      }
    }
    // If we found >= 2 license SKUs from comma separation, treat as direct license list
    if (licFromComma.length >= 2) {
      const seenC = new Set();
      const dedupC = [];
      for (const item of licFromComma) {
        if (!seenC.has(item.sku)) { seenC.add(item.sku); dedupC.push(item); }
      }
      return {
        items: [],
        directLicenseList: dedupC,
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
      const isLicenseOnly = /\b(LICENSE|LICENCE|LISCENSE|LISCENCE|RENEWAL|RENEW|LIC)\b/.test(nonModelLines);
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
  // Tolerates natural-language preambles ("quote", "get me", "price for"), trailing
  // qualifiers ("licenses", "license renewals"), and both qty-before and qty-after
  // orderings with or without the literal 'x' separator. This matters because the CF
  // classifier often re-phrases user input (e.g. "lic-mv-1yr x 30" -> "30 LIC-MV-1YR"
  // or "quote LIC-MV-1YR qty 30") before handing it to parseMessage. The old regex
  // was strictly anchored to LIC- at the start, so any preamble killed the match and
  // downstream fallbacks dropped the qty.
  {
    // Strip preamble + trailing qualifier words iteratively so multi-word
    // phrases like "price for", "get me", "can you quote" all collapse away.
    // Order the alternation from longest to shortest to avoid "PRICE" eating
    // half of "PRICE FOR" and leaving "FOR" behind.
    const PREAMBLE_RE = /^\s*(?:PLEASE\s+)?(?:CAN\s+YOU\s+|COULD\s+YOU\s+)?(?:PRICING\s+(?:ON|FOR)|PRICE\s+(?:OF|FOR)|COST\s+(?:OF|FOR)|HOW\s+MUCH\s+(?:IS|ARE|FOR)|I\s+(?:NEED|WANT)|GIVE\s+ME|SEND\s+ME|GET\s+ME|QUOTE\s+ME|QUOTE|PRICING|PRICE|COST|GET|NEED|WANT|FOR|ON|PLEASE)\s+/i;
    const TRAILER_RE = /\s+(?:LICENSES?|LICENCES?|LISCENSES?|LISCENCES?|LIC|RENEWALS?|OF\s+(?:THEM|THESE|THOSE)|PLEASE|THANKS?|THANK\s+YOU)\s*$/i;
    let stripped = upper.replace(/\s+(?:QTY|QUANTITY)\s+(\d+)\s*$/i, ' $1').trim();  // "qty 30" -> " 30"
    // Apply preamble + trailer strips repeatedly until stable (handles stacked modifiers)
    for (let i = 0; i < 4; i++) {
      const before = stripped;
      stripped = stripped.replace(PREAMBLE_RE, '').replace(TRAILER_RE, '').trim();
      if (stripped === before) break;
    }

    // qty-first: "30 LIC-MV-1YR", "30 x LIC-MV-1YR", "30x LIC-MV-1YR"
    const qtyFirst = stripped.match(/^(\d+)\s*[X×]?\s*(LIC-[A-Z0-9-]+)\s*$/);
    // SKU-first with qty: "LIC-MV-1YR 30", "LIC-MV-1YR x 30", "LIC-MV-1YR x30"
    const skuFirst = !qtyFirst && stripped.match(/^(LIC-[A-Z0-9-]+?)(?:\s*[X×]\s*|\s+)(\d+)\s*$/);
    // Bare SKU: "LIC-MV-1YR"
    const skuOnly = !qtyFirst && !skuFirst && stripped.match(/^(LIC-[A-Z0-9-]+)\s*$/);

    let licSku = null, qty = 1;
    if (qtyFirst) { qty = parseInt(qtyFirst[1]); licSku = qtyFirst[2]; }
    else if (skuFirst) { licSku = skuFirst[1]; qty = parseInt(skuFirst[2]); }
    else if (skuOnly) { licSku = skuOnly[1]; qty = 1; }

    if (licSku && licSku.startsWith('LIC-')) {
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
  // Term detection — catches "just 3 year", "only 1yr", but also
  // bare "3 year", "5yr", "3-year" with term-keyword suffix. Uses
  // negative lookbehind [\w-] to avoid matching the "3YR" in
  // SKU-embedded terms like "LIC-ENT-3YR".
  const TERM_RE = /(?<![\w-])([135])\s*-?\s*Y(?:R|EAR|EARS)?\b/i;
  const tm = upper.match(TERM_RE);
  if (tm) requestedTerm = parseInt(tm[1]);

  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|HARDWARE|WITHOUT\s+(A\s+)?(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|NO\s+(?:LICENSE|LICENCE|LISCENSE|LISCENCE)|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/.test(upper) && !/\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  // LICENSE keyword variations including common misspellings: licence, liscense, liscence, liceses, etc.
  const LIC_WORD = `(?:LICENSE|LICENCE|LISCENSE|LISCENCE|LICESE|LIC)`;
  const LIC_WORDS = `(?:LICENSE[S]?|LICENCE[S]?|LISCENSE[S]?|LISCENCE[S]?|LICESE[S]?|LIC)`;
  const licOnlyRe = new RegExp(`\\b(${LIC_WORDS}\\s+ONLY|JUST\\s+THE\\s+${LIC_WORD}|JUST\\s+${LIC_WORD}|${LIC_WORDS}\\s+ONLY|NO\\s+HARDWARE|RENEWAL\\s+ONLY|${LIC_WORD}\\s+RENEWAL|RENEW\\s+(THE\\s+)?${LIC_WORDS}|RENEWAL\\s+FOR|RENEW\\s+EXISTING)\\b`);
  if (licOnlyRe.test(upper)) {
    modifiers.licenseOnly = true;
  }
  // "licenses for [SKU]" or "renewal [SKU]" implies license-only (renewal scenario)
  // But NOT "MX67 with 3 year license" — that's hardware + license
  // Also matches bare family names: "renewal for 4 MR" (no model number)
  if (!modifiers.licenseOnly) {
    const licForSkuRe = new RegExp(`\\b(${LIC_WORDS}\\s+FOR\\s+(AN?\\s+)?(\\d+\\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)(\\d|'?S?\\b)|RENEWAL[S]?\\s+(OF\\s+|FOR\\s+)?(\\d+\\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)(\\d|'?S?\\b))`);
    if (licForSkuRe.test(upper)) modifiers.licenseOnly = true;
  }
  // "[SKU] license" or "[SKU] renewal" at end of short input (e.g. "mr44 license", "5 MR44 renewal")
  // Also matches family-only like "mr license". Requires ^ anchor to avoid matching full sentences.
  // But NOT "[SKU] with X year license" (hardware + license)
  if (!modifiers.licenseOnly) {
    const skuLicRe = new RegExp(`^(QUOTE\\s+)?(\\d+\\s+)?(MR|MS|MX|MV|MT|MG|CW|Z)\\d*[A-Z0-9-]*\\s+(${LIC_WORDS}|RENEWAL[S]?)\\s*$`, 'i');
    if (skuLicRe.test(upper.trim()) && !/\bWITH\b/.test(upper)) modifiers.licenseOnly = true;
  }
  // "renewal for X MS130, Y MR, Z MX67" — "renewal for" at start implies license-only for entire request
  if (!modifiers.licenseOnly && /^\s*(QUOTE\s+)?RENEWAL\s+(FOR\s+)?\d/i.test(upper)) {
    modifiers.licenseOnly = true;
  }
  // Trailing "licenses" / "licence" / "liscense" at end of multi-product list implies license-only
  // e.g., "2 MS130-24P, 4 MR, and 5 MX67 ENT liceses"
  // But NOT "MX67 with 3 year license" (hardware + license)
  if (!modifiers.licenseOnly && !/\bWITH\b/.test(upper)) {
    const trailingLicRe = new RegExp(`\\b(ENT(?:ERPRISE)?\\s+)?${LIC_WORDS}\\s*$`);
    if (trailingLicRe.test(upper.trim())) modifiers.licenseOnly = true;
  }

  const showPricing = /\b(HOW\s+MUCH|PRICE[SD]?|PRICING|COST[S]?|WITH\s+PRIC(E|ING|ES))\b/.test(upper);

  // separate_quotes (detected early, top of parseMessage). Plumb into modifiers.
  modifiers.separateQuotes = __separateQuotes;

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
    // Product info / support / feature questions (should NOT generate quotes)
    /\bDOES .+ SUPPORT\b/, /\bIS .+ SUPPORTED\b/, /\bIS .+ (STILL )?AVAILABLE\b/,
    /\bWHAT .+ SUPPORT\b/, /\bWHAT (POE|UPLINK|PORT|SPEED|THROUGHPUT|BANDWIDTH|FEATURE)/,
    /\bDOES .+ (HAVE|INCLUDE|COME WITH|OFFER)\b/,
    /\bIS .+ (EOL|END OF LIFE|DISCONTINUED|DEPRECATED|STILL SOLD)\b/,
    /\bCAN .+ (HANDLE|SUPPORT|DO)\b/,
    /\bWHAT('?S| IS|'S) .+ (CAPABLE|RATED|MAX|MAXIMUM)\b/,
    /\bWRITE .+ PROPOSAL\b/, /\bDRAFT .+ PROPOSAL\b/, /\bBUILD .+ PROPOSAL\b/,
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

  // ── Duo natural language handler ──
  // License-only product (no hardware). Supports multi-tier detection:
  // "duo essentials, premier, and advantage" → all three tiers emitted.
  // If tier is NOT specified, prompt the user to choose (Essentials/Advantage/Premier).
  const isDuo = /\b(?:DUO|CISCO\s*DUO)\b/i.test(upper);
  if (isDuo && !isAdvisory) {
    // Collect ALL tiers mentioned in the message (order-preserving).
    const duoTiers = [];
    // Step through the message to preserve the user's stated order.
    const tierOrderRe = /\b(ADVANTAGE|PREMIER|ESSENTIAL(?:S)?)\b/gi;
    let tm;
    while ((tm = tierOrderRe.exec(upper)) !== null) {
      const raw = tm[1].toUpperCase();
      const canon = raw === 'ADVANTAGE' ? 'ADVANTAGE' : raw === 'PREMIER' ? 'PREMIER' : 'ESSENTIALS';
      if (!duoTiers.includes(canon)) duoTiers.push(canon);
    }
    // "all duo" / "all duo quotes" / "all duo licenses" → all three tiers,
    // auto-treat as separate quotes (user wants one URL per tier).
    const isAllDuo = /\bALL\s+(?:CISCO\s+)?DUO\b/i.test(upper);
    if (isAllDuo && duoTiers.length === 0) {
      duoTiers.push('ESSENTIALS', 'ADVANTAGE', 'PREMIER');
      __separateQuotes = true;
    }
    const duoQtyMatch = upper.match(/\b(\d+)\b/);
    const duoQty = duoQtyMatch ? parseInt(duoQtyMatch[1]) : 1;

    if (duoTiers.length === 0) {
      return {
        items: [],
        isQuote: false,
        isClarification: true,
        clarificationMessage: `Which Cisco Duo tier do you need? (qty: ${duoQty})\n\n` +
          `• **Essentials** — MFA, passwordless, device trust\n` +
          `• **Advantage** — Essentials + adaptive policies, VPN-less remote access\n` +
          `• **Premier** — Advantage + full SSO, Duo Trust Monitor\n\n` +
          `Just reply with the tier name (e.g. "Duo Advantage") or "Duo Essentials ${duoQty}".`
      };
    }
    // Build items for every tier × every term. The isTermOptionQuote renderer
    // groups by tier when separateQuotes is set, or by term otherwise.
    const duoItems = [];
    for (const tier of duoTiers) {
      for (const t of [1, 3, 5]) {
        duoItems.push({ baseSku: `LIC-DUO-${tier}-${t}YR`, qty: duoQty, isLicenseOnly: true });
      }
    }
    // Narrow to the requested term whenever the user specified one, regardless
    // of tier count or separate_quotes. The cartesian 1/3/5YR expansion only
    // applies when the user did NOT state a term — the renderer then emits
    // one URL per term. When a term IS stated, respect it: one URL per tier
    // (if separate_quotes or multi-tier) at that term, or one combined URL
    // (single tier, no separate_quotes).
    let duoFinalItems = duoItems;
    if (requestedTerm) {
      duoFinalItems = duoItems.filter(it => it.baseSku.endsWith(`-${requestedTerm}YR`));
    }
    return {
      items: duoFinalItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { separateQuotes: __separateQuotes || duoTiers.length > 1 }
    };
  }

  // ── Umbrella natural language handler ──
  // License-only product. If type+tier specified, return URLs directly.
  // If missing, prompt user to choose type (DNS/SIG) and tier (Essentials/Advantage).
  // Multi-type/multi-tier: "umbrella DNS essentials, DNS advantage, SIG advantage" emits all combinations.
  const isUmb = /\b(?:UMBRELLA|UMB)\b/i.test(upper);
  if (isUmb && !isAdvisory) {
    // Collect ALL types (DNS, SIG) mentioned, in order of appearance
    const umbTypes = [];
    const typeRe = /\b(DNS|SIG)\b/gi;
    let tym;
    while ((tym = typeRe.exec(upper)) !== null) {
      const canon = tym[1].toUpperCase();
      if (!umbTypes.includes(canon)) umbTypes.push(canon);
    }

    // Collect ALL tiers (ESS, ADV) mentioned, in order of appearance
    // Must match both literal spellings ("advantage", "essentials") and short forms ("adv", "ess").
    const umbTiers = [];
    const tierRe = /\b(ADV(?:ANTAGE|ANCED)?|ESS(?:ENTIALS?)?)\b/gi;
    let trm;
    while ((trm = tierRe.exec(upper)) !== null) {
      const raw = trm[1].toUpperCase();
      const canon = raw.startsWith('ADV') ? 'ADV' : 'ESS';
      if (!umbTiers.includes(canon)) umbTiers.push(canon);
    }

    const umbQtyMatch = upper.match(/\b(\d+)\b/);
    const umbQty = umbQtyMatch ? parseInt(umbQtyMatch[1]) : 1;

    // Detect explicit term request (e.g. "3 year umbrella")
    const umbTermMatch = upper.match(/\b([135])\s*(?:YR|YEAR|YEARS)\b/);
    const umbRequestedTerm = umbTermMatch ? parseInt(umbTermMatch[1]) : null;

    if (umbTypes.length === 0 || umbTiers.length === 0) {
      let prompt = `Which Umbrella package do you need? (qty: ${umbQty})\n\n`;
      if (umbTypes.length === 0) {
        prompt += `**Type:**\n• **DNS Security** — DNS-layer protection\n• **SIG** (Secure Internet Gateway) — full web proxy + DNS\n\n`;
      }
      if (umbTiers.length === 0) {
        prompt += `**Tier:**\n• **Essentials** — core protection\n• **Advantage** — Essentials + advanced features\n\n`;
      }
      prompt += `Reply with the full package, e.g. "Umbrella DNS Essentials ${umbQty}" or "Umbrella SIG Advantage".`;
      return {
        items: [],
        isQuote: false,
        isClarification: true,
        clarificationMessage: prompt
      };
    }

    // Build items: cartesian product of types × tiers × all three terms (1/3/5YR)
    const umbItems = [];
    for (const type of umbTypes) {
      for (const tier of umbTiers) {
        for (const t of [1, 3, 5]) {
          umbItems.push({ baseSku: `LIC-UMB-${type}-${tier}-K9-${t}YR`, qty: umbQty, isLicenseOnly: true });
        }
      }
    }

    // Narrow to the requested term whenever the user specified one. The
    // 1/3/5YR cartesian only applies when NO term is stated — the renderer
    // then emits one URL per term. When a term IS stated, respect it: one
    // URL per combo (if separate_quotes or multi-combo) at that term, or
    // one combined URL for a single combo.
    const combos = umbTypes.length * umbTiers.length;
    let umbFinalItems = umbItems;
    if (umbRequestedTerm) {
      umbFinalItems = umbItems.filter(it => it.baseSku.endsWith(`-${umbRequestedTerm}YR`));
    }

    return {
      items: umbFinalItems,
      isQuote: true,
      isTermOptionQuote: true,
      modifiers: { separateQuotes: __separateQuotes || combos > 1 }
    };
  }

  // ── Model-agnostic license handler (MR, MV, MT) ──
  // These families use a single license SKU regardless of specific model.
  // "MR license", "5 MV licenses", "quote MT renewal", "licenses for MR", etc.
  // Also handles possessives/plurals: "MR's", "MRs", "MR'S"
  // The model doesn't matter — all MR use LIC-ENT, all MV use LIC-MV, all MT use LIC-MT.
  const AGNOSTIC_FAMILY = `(MR|MV|MT)(?:'?S)?`;  // matches MR, MRs, MR's, MR'S, etc.
  let agnosticFamily = null;
  let agnosticQty = 1;
  let _m;

  // Pattern A: "5 MR licenses", "10 MV renewal", "4 MR's licenses" (qty before family)
  _m = upper.match(new RegExp(`(\\d+)\\s*[X×]?\\s*${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?`, 'i'));
  if (_m) { agnosticQty = parseInt(_m[1]); agnosticFamily = _m[2].toUpperCase(); }

  // Pattern B: "MR license", "MV licenses", "MT renewal", "quote MR license" (no qty)
  if (!agnosticFamily) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?\\s*$`, 'i'));
    if (_m) { agnosticFamily = _m[1].toUpperCase(); }
  }

  // Pattern C: "MR licenses 5", "MT renewal 10" (qty after keyword)
  if (!agnosticFamily) {
    _m = upper.match(new RegExp(`${AGNOSTIC_FAMILY}\\s+(${LIC_WORDS}|RENEWAL)S?\\s*[X×]?\\s*(\\d+)`, 'i'));
    if (_m) { agnosticFamily = _m[1].toUpperCase(); agnosticQty = parseInt(_m[3]); }
  }

  // Pattern D: "licenses for MR", "renewal for MV" (keyword before family)
  if (!agnosticFamily) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?(${LIC_WORDS}|RENEWAL)S?\\s+(?:FOR\\s+)?${AGNOSTIC_FAMILY}\\s*$`, 'i'));
    if (_m) { agnosticFamily = _m[2].toUpperCase(); }
  }

  // Pattern E: "5 MR", "10 MV" (qty + family only, if licenseOnly modifier already set)
  if (!agnosticFamily && modifiers.licenseOnly) {
    _m = upper.trim().match(new RegExp(`^(?:QUOTE\\s+)?(\\d+)\\s*[X×]?\\s*${AGNOSTIC_FAMILY}\\s*(ENT(?:ERPRISE)?)?$`, 'i'));
    if (_m) { agnosticQty = parseInt(_m[1]); agnosticFamily = _m[2].toUpperCase(); }
  }

  if (agnosticFamily && !isAdvisory) {
    let licSkus;
    if (agnosticFamily === 'MR') {
      licSkus = [
        { baseSku: 'LIC-ENT-1YR', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-ENT-3YR', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-ENT-5YR', qty: agnosticQty, isLicenseOnly: true }
      ];
    } else if (agnosticFamily === 'MV') {
      licSkus = [
        { baseSku: 'LIC-MV-1YR', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-MV-3YR', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-MV-5YR', qty: agnosticQty, isLicenseOnly: true }
      ];
    } else if (agnosticFamily === 'MT') {
      licSkus = [
        { baseSku: 'LIC-MT-1Y', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-MT-3Y', qty: agnosticQty, isLicenseOnly: true },
        { baseSku: 'LIC-MT-5Y', qty: agnosticQty, isLicenseOnly: true }
      ];
    }
    if (licSkus) {
      return {
        items: licSkus,
        isQuote: true,
        isTermOptionQuote: true  // reuse same 1Y/3Y/5Y URL output path
      };
    }
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

  // ── Bare family names (MR, MRs, MR's, MV, MT) in multi-product lists ──
  // When licenseOnly is true, bare family names like "4 MR" should be captured
  // as model-agnostic license items. SKU patterns above require digits after MR/MV/MT.
  // We handle this separately to inject them as special "MR-AGN" / "MV-AGN" / "MT-AGN" items.
  const bareAgnosticItems = [];
  if (modifiers.licenseOnly) {
    // Match patterns like "4 MR", "5 MV's", "3 MT'S", "10 MRs" in multi-product context
    const bareRe = /\b(\d+)\s*[X×]?\s*(MR|MV|MT)(?:'?S)?\b/gi;
    let bareMatch;
    while ((bareMatch = bareRe.exec(upper)) !== null) {
      const family = bareMatch[2].toUpperCase();
      const qty = parseInt(bareMatch[1]);
      const pos = bareMatch.index;
      // Only match if there's NO digit immediately after the family name (avoids matching MR44, MV72, etc.)
      const afterChar = upper[pos + bareMatch[0].length];
      if (afterChar && /\d/.test(afterChar)) continue;
      bareAgnosticItems.push({ baseSku: `${family}-AGN`, qty, position: pos, _agnosticFamily: family });
    }
  }

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
      // Handle "MR36x10" shorthand: the case-insensitive SKU regex greedily eats
      // the 'x' separator (MR36 + X*) producing invalid SKUs like "MR36X". If the
      // stripped form is a valid family and the full form isn't, strip the X.
      // Safe because SKUs legitimately ending in X (MS150-48FP-4X etc.) validate
      // as fullValid and short-circuit.
      if (sku.endsWith('X') && sku.length > 3) {
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
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*(?:OF\s+)?(?:THE\s+)?$/);
      // Negative lookahead rejects qty followed by term keywords like "3 YEAR",
      // "3YR", "3-YEAR", "5 Y" — these are term specifiers, not quantities.
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9]|[A-Z]*-|\s*-?Y(?:R|EAR|EARS)?\b)/i);
      // For inline format (SKU1 qty1 SKU2 qty2...), prefer afterQty to avoid picking up previous SKU's quantity
      if (afterQty) qty = parseInt(afterQty[1]);
      else if (beforeQty) qty = parseInt(beforeQty[1]);
      rawMatches.push({ baseSku: sku, qty, position: pos });
    }
  }

  // ── Bare multi-variant family names ──
  // Catches "MS150", "MS130", "MS390", "C9300", "CW" etc. when used without a full variant suffix.
  // These are valid families that need variant clarification, NOT invalid SKUs.
  const bareFamilyPatterns = [
    { re: /\bMS150\b(?!-)/gi, family: 'MS150' },
    { re: /\bMS130\b(?!-\d)/gi, family: 'MS130' },  // MS130 bare, but not MS130-24P etc.
    { re: /\bMS390\b(?!-)/gi, family: 'MS390' },
    { re: /\bMS450\b(?!-)/gi, family: 'MS450' },
    { re: /\bC9300L?\b(?!-)/gi, family: 'C9300' },   // C9300 or C9300L bare
    { re: /\bC9200L\b(?!-)/gi, family: 'C9200L' },
    { re: /\bCW\b(?!\d)/gi, family: 'CW' },          // bare "CW" without model number
  ];

  for (const { re, family } of bareFamilyPatterns) {
    let m;
    while ((m = re.exec(upper)) !== null) {
      const pos = m.index;
      // Skip if this position is already covered by a more specific match
      const alreadyCovered = rawMatches.some(rm =>
        pos >= rm.position && pos < rm.position + rm.baseSku.length
      );
      if (alreadyCovered) continue;

      // Extract quantity from before/after the match
      const before = upper.slice(Math.max(0, pos - 20), pos);
      const after = upper.slice(pos + m[0].length, pos + m[0].length + 15);
      let qty = 1;
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*(?:OF\s+)?(?:THE\s+)?$/);
      // Same term-keyword exclusion as variant-match afterQty (see above)
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9]|\s*-?Y(?:R|EAR|EARS)?\b)/i);
      if (afterQty) qty = parseInt(afterQty[1]);
      else if (beforeQty) qty = parseInt(beforeQty[1]);

      rawMatches.push({ baseSku: family, qty, position: pos });
    }
  }

  const foundItems = rawMatches.filter((item, idx) => {
    return !rawMatches.some((other, otherIdx) => {
      if (idx === otherIdx) return false;
      return other.baseSku.length > item.baseSku.length && other.baseSku.includes(item.baseSku);
    });
  });

  // Merge bare agnostic items (MR-AGN, MV-AGN, MT-AGN) into foundItems
  // Only include if no specific model from that family was already matched (e.g., MR44 would suppress MR-AGN)
  for (const bare of bareAgnosticItems) {
    const family = bare._agnosticFamily;
    const alreadyHasFamily = foundItems.some(f => f.baseSku.startsWith(family) && f.baseSku !== `${family}-AGN`);
    if (!alreadyHasFamily) {
      foundItems.push(bare);
    }
  }

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

  // ── Unresolved AP category phrases (Wi-Fi 6 / 6E / 7) ──
  // Catches "wifi 7 ap", "wi-fi 6e aps", "2 wifi 7 access points" — phrases that
  // reference an AP generation without specifying a model. These typically follow
  // Claude recommending Wi-Fi options and the user replying "go with the wifi 7
  // AP". Captured here so buildQuoteResponse can append an AP-choice clarify
  // alongside any other items resolved from the same message. If a CW model was
  // already matched for the same generation (e.g., "CW9172I"), the category is
  // considered already resolved and dropped.
  const unresolvedCategories = [];
  const WIFI_CAT_RE = /(?:(\d+)\s*[x×]?\s*)?(?:the\s+)?(?:meraki\s+|cisco\s+)?(?:wi[\s-]?fi|wifi)\s*(7|6e|6)\s*(?:ap|aps|access\s*points?)\b/gi;
  let _wcm;
  const _seenCats = new Set();
  while ((_wcm = WIFI_CAT_RE.exec(text)) !== null) {
    const qty = _wcm[1] ? parseInt(_wcm[1]) : 1;
    const gen = _wcm[2].toUpperCase();  // "7" | "6E" | "6"
    const key = `${gen}:${qty}`;
    if (_seenCats.has(key)) continue;
    _seenCats.add(key);
    // Skip if a matching CW/MR model already resolved this generation
    const alreadyResolved = items.some(({ baseSku }) => {
      const bu = baseSku.toUpperCase();
      if (gen === '7')  return /^CW917/.test(bu);
      if (gen === '6E') return /^CW916/.test(bu);
      if (gen === '6')  return /^MR/.test(bu);
      return false;
    });
    if (alreadyResolved) continue;
    unresolvedCategories.push({ kind: 'ap', generation: gen, qty });
  }

  // Bare category request with no SKUs — emit as clarification so the bot
  // prompts the user to pick a specific model instead of returning nothing.
  if (items.length === 0 && unresolvedCategories.length > 0 && !isAdvisory && !isRevision) {
    const msg = _formatUnresolvedCategoryPrompt(unresolvedCategories, { preamble: true });
    return {
      items: [],
      isQuote: false,
      isClarification: true,
      clarificationMessage: msg,
      unresolvedCategories
    };
  }

  if (items.length === 0) {
    if (isRevision || isAdvisory) {
      return { items: [], requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing, unresolvedCategories };
    }
    return null;
  }
  return { items, requestedTerm, modifiers, requestedTier, isAdvisory, isRevision, showPricing, unresolvedCategories };
}

// ─── Unresolved AP category → clarify-text helper ───────────────────────────
// Given an array of { kind, generation, qty }, build a human-readable prompt
// listing top SKU choices for each generation. Used by parseMessage (bare
// category request) and buildQuoteResponse (items + category combo).
function _formatUnresolvedCategoryPrompt(cats, { preamble = false } = {}) {
  const GEN_OPTIONS = {
    '7':  { label: 'Wi-Fi 7',  skus: ['CW9172I', 'CW9174I', 'CW9176D1', 'CW9176I', 'CW9178I'], note: 'indoor enterprise' },
    '6E': { label: 'Wi-Fi 6E', skus: ['CW9162I', 'CW9164I', 'CW9166D1', 'CW9166I', 'CW9167I'], note: 'indoor enterprise' },
    '6':  { label: 'Wi-Fi 6',  skus: ['MR36', 'MR44', 'MR46', 'MR57', 'MR76'], note: 'indoor enterprise' }
  };
  const lines = [];
  if (preamble) lines.push(`Which access point model do you want?`);
  for (const { generation, qty } of cats) {
    const opt = GEN_OPTIONS[generation];
    if (!opt) continue;
    const qtyStr = qty > 1 ? ` (qty: ${qty})` : '';
    lines.push(`**${opt.label} AP${qtyStr}** — ${opt.skus.join(', ')}`);
  }
  lines.push(`Reply with the specific model (e.g., "${GEN_OPTIONS[cats[0].generation]?.skus[0] || 'CW9172I'}") and I'll add it to the quote.`);
  return lines.join('\n');
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
  if (parsed.isTermOptionQuote && parsed.items) {
    const separateQuotes = Boolean(parsed.modifiers && parsed.modifiers.separateQuotes);
    const termGroups = { '1YR': [], '3YR': [], '5YR': [] };
    for (const item of parsed.items) {
      const termMatch = item.baseSku.match(/(\d)YR?$/i);
      if (termMatch) {
        const key = `${termMatch[1]}YR`;  // normalize 1Y → 1YR key
        if (termGroups[key]) termGroups[key].push({ sku: item.baseSku, qty: item.qty });
      }
    }
    const lines = [];
    // separateQuotes: emit one URL per (tier, term) pair. We detect distinct
    // tier families by stripping the term suffix from each SKU.
    if (separateQuotes) {
      // Group SKUs by their tier family (the SKU minus the trailing term).
      const tierFamilies = new Map(); // tierKey → tier label
      for (const item of parsed.items) {
        const tierKey = item.baseSku.replace(/-(\d)YR?$/i, '');
        if (!tierFamilies.has(tierKey)) {
          // Friendly label: LIC-DUO-ESSENTIALS → "Duo Essentials"
          let label = tierKey
            .replace(/^LIC-/, '')
            .replace(/-K9$/, '')
            .replace(/-/g, ' ')
            .replace(/\bDUO\b/, 'Duo')
            .replace(/\bUMB\b/, 'Umbrella')
            .replace(/\bESSENTIALS\b/i, 'Essentials')
            .replace(/\bADVANTAGE\b/i, 'Advantage')
            .replace(/\bPREMIER\b/i, 'Premier')
            .replace(/\bESS\b/i, 'Essentials')
            .replace(/\bADV\b/i, 'Advantage')
            .replace(/\bDNS\b/i, 'DNS')
            .replace(/\bSIG\b/i, 'SIG');
          tierFamilies.set(tierKey, label.trim());
        }
      }
      for (const [tierKey, label] of tierFamilies) {
        lines.push(`**${label}:**`);
        for (const term of ['1YR', '3YR', '5YR']) {
          const matching = termGroups[term].filter(s => s.sku.replace(/-(\d)YR?$/i, '') === tierKey);
          if (matching.length > 0) {
            const url = buildStratusUrl(matching);
            lines.push(`${term.replace('YR', '-Year')} Co-Term: ${url}`);
          }
        }
        lines.push('');
      }
      return { message: lines.join('\n').trim(), needsLlm: false };
    }
    for (const [term, skus] of Object.entries(termGroups)) {
      if (skus.length > 0) {
        const url = buildStratusUrl(skus);
        lines.push(`**${term.replace('YR', '-Year')} Co-Term:** ${url}`);
      }
    }
    return { message: lines.join('\n\n'), needsLlm: false };
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

  for (let { baseSku, qty } of parsed.items) {
    // ── Model-agnostic license families (MR-AGN, MV-AGN, MT-AGN) ──
    // These are injected by the bare-family parser for "4 MR", "5 MV's", etc.
    // They bypass normal SKU validation and generate license-only items directly.
    const agnMatch = baseSku.match(/^(MR|MV|MT)-AGN$/);
    if (agnMatch) {
      const family = agnMatch[1];
      let licSkus;
      if (family === 'MR') {
        licSkus = [
          { term: '1Y', sku: 'LIC-ENT-1YR' },
          { term: '3Y', sku: 'LIC-ENT-3YR' },
          { term: '5Y', sku: 'LIC-ENT-5YR' }
        ];
      } else if (family === 'MV') {
        licSkus = [
          { term: '1Y', sku: 'LIC-MV-1YR' },
          { term: '3Y', sku: 'LIC-MV-3YR' },
          { term: '5Y', sku: 'LIC-MV-5YR' }
        ];
      } else if (family === 'MT') {
        licSkus = [
          { term: '1Y', sku: 'LIC-MT-1Y' },
          { term: '3Y', sku: 'LIC-MT-3Y' },
          { term: '5Y', sku: 'LIC-MT-5Y' }
        ];
      }
      resolvedItems.push({ baseSku: `${family} Enterprise`, hwSku: null, qty, licenseSkus: licSkus, eol: false, isAgnosticLicense: true });
      continue;
    }

    // Pre-normalize CW base models: CW9164→CW9164I, CW9166→CW9166I, CW9162→CW9162I, CW9172→CW9172I
    // Users commonly type just the base number without the I suffix
    const bUpper = baseSku.toUpperCase();
    if (/^CW9(16|17)\d$/.test(bUpper) && !bUpper.endsWith('I')) {
      baseSku = `${bUpper}I`;
    }

    const validation = validateSku(baseSku);
    if (!validation.valid) {
      // Partial/fuzzy/common-mistake matches get full variant suggestions (bulleted), not "Did you mean"
      if (validation.suggest && validation.suggest.length > 0 && (validation.isPartialMatch || validation.isFuzzyMatch || validation.isCommonMistake)) {
        let msg = `⚠️ **${baseSku.toUpperCase()}** — which variant do you need?`;
        for (const s of validation.suggest.slice(0, 8)) msg += `\n• ${s}`;
        errors.push(msg);
      } else {
        const suggest = validation.suggest ? `\nDid you mean: ${validation.suggest.slice(0, 3).join(', ')}?` : '';
        errors.push(`⚠️ **${baseSku}**: ${validation.reason}${suggest}`);
      }
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
        } else if (v.isFuzzyMatch || v.reason) {
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
  // Separate truly invalid SKUs from those that just need variant clarification
  if (errors.length > 0) {
    // Check which errors are actually partial-match variant questions
    const variantPrompts = [];
    const trueErrors = [];
    for (const err of errors) {
      // Errors that contain bullet points (•) are variant suggestions, not true errors
      if (err.includes('•') || err.includes('Which one do you need?') || err.includes('Did you mean') || err.includes('which variant do you need')) {
        variantPrompts.push(err);
      } else {
        trueErrors.push(err);
      }
    }
    if (trueErrors.length > 0) {
      lines.push(...trueErrors, '');
      lines.push('_The items above could not be quoted._', '');
    }
    if (variantPrompts.length > 0) {
      lines.push(...variantPrompts, '');
    }
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
        // Regular quote — EOL items already called out in the "Products End of Life" block above.
        // Just emit the header; skip the per-item info lines (redundant with the EOL callout).
        lines.push(`**Option 1 — As Quoted:**`);
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
        for (const { hwSku, qty, licenseSkus, isAgnosticLicense } of resolvedItems) {
          if (!modifiers.licenseOnly && !modifiers.hardwareOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
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
      for (const { hwSku, qty, licenseSkus, isAgnosticLicense } of resolvedItems) {
        if (!modifiers.licenseOnly && !modifiers.hardwareOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
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
        for (const { hwSku, qty, licenseSkus, isAgnosticLicense } of resolvedItems) {
          if (!modifiers.licenseOnly && !isAgnosticLicense) allItems.push({ sku: hwSku, qty });
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
    // Check if ALL resolved items are accessories (no license component) — e.g., MA- prefix.
    // These don't have term-based licensing, so showing 3 identical URLs (1Y/3Y/5Y) is noise.
    const allAccessories = resolvedItems.every(item =>
      (!item.licenseSkus || item.licenseSkus.length === 0) &&
      (item.baseSku?.toUpperCase().startsWith('MA-') || item.hwSku?.toUpperCase().startsWith('MA-'))
    );

    if (allAccessories) {
      // Single URL output — no term differentiation needed
      const urlItems = resolvedItems.map(i => ({ sku: i.hwSku, qty: i.qty }));
      const url = buildStratusUrl(urlItems);
      lines.push(url);
      if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
      lines.push('');
    } else if (modifiers.hardwareOnly) {
      // Hardware-only: single URL (no license terms to differentiate)
      // Skip agnostic license items (they have no hardware)
      const urlItems = [];
      for (const { hwSku, qty, isAgnosticLicense } of resolvedItems) {
        if (!isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
      }
      if (urlItems.length > 0) {
        const url = buildStratusUrl(urlItems);
        lines.push(url);
        if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
        lines.push('');
      }
    } else if (modifiers.separateQuotes && resolvedItems.length > 1) {
      // separate_quotes: emit a labeled URL block per item, one URL per term
      // within each block. Each item carries its own license so each quote is
      // self-contained.
      for (const item of resolvedItems) {
        const { baseSku, hwSku, qty, licenseSkus, isAgnosticLicense } = item;
        const label = baseSku || hwSku || 'Quote';
        lines.push(`**${label} × ${qty}:**`);
        for (const term of terms) {
          const urlItems = [];
          if (!modifiers.licenseOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
          if (licenseSkus) {
            const licSku = licenseSkus.find(l => l.term === `${term}Y`)?.sku;
            if (licSku) urlItems.push({ sku: licSku, qty });
          }
          if (urlItems.length > 0) {
            const url = buildStratusUrl(urlItems);
            const termLabel = term === 1 ? '1-Year Co-Term' : term === 3 ? '3-Year Co-Term' : '5-Year Co-Term';
            lines.push(`${termLabel}: ${url}`);
            if (parsed.showPricing) lines.push(buildPricingBlock(urlItems, true));
          }
        }
        lines.push('');
      }
    } else {
      for (const term of terms) {
        const urlItems = [];
        for (const { hwSku, qty, licenseSkus, isAgnosticLicense } of resolvedItems) {
          if (!modifiers.licenseOnly && !isAgnosticLicense) urlItems.push({ sku: hwSku, qty });
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

  // Unresolved AP category phrases — append clarify prompt alongside the quote
  if (parsed.unresolvedCategories && parsed.unresolvedCategories.length > 0) {
    lines.push('');
    lines.push(`⚠️ **AP model not specified** — the quote above covers the other items. ${_formatUnresolvedCategoryPrompt(parsed.unresolvedCategories, { preamble: false })}`);
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

## CRITICAL ANTI-HALLUCINATION RULES
- NEVER state product specifications unless they are provided in this prompt via a "PRODUCT SPECS" section.
- If no specs are provided and the user asks about throughput, user counts, performance, etc., say: "I don't have verified specs for that model in my current data. Want me to pull the latest datasheet?"
- When listing model options or variants, ONLY list models from the VALID PRODUCT CATALOG section. Never suggest model numbers that aren't explicitly listed.
- If conversation history contains specs that conflict with an injected PRODUCT SPECS section, the injected specs are ALWAYS correct.

## PERSONA
Professional, concise, action-oriented. Give direct answers without conversational fluff. Short answers for well-defined questions. Positive and engaging tone. You're a knowledgeable colleague, not a help desk.

## STRATUS CONTEXT
Stratus Information Systems is a Cisco-exclusive reseller specializing in Meraki cloud-managed networking. We serve K-12, higher ed, healthcare, and enterprise customers. Our quoting tool generates instant order URLs that populate a cart on stratusinfosystems.com.

## URL FORMAT
https://stratusinfosystems.com/order/?item={item1},{item2}&qty={qty1},{qty2}

Items and quantities are separate comma-separated lists in matching order.

## SKU SUFFIX RULES
- Most MS switches (MS120/125/130/130R/210/225/250/350/390/425/450) → add -HW
- MR, MV, MT, MG, Z (not Z4X/Z4CX) → add -HW
- MX non-cellular → add -HW
- MX cellular (MXxxC, MXxxCW) → add -HW-NA
- CW Wi-Fi 6E (CW916x) → add -MR
- CW Wi-Fi 7 (CW917x) → add -RTG
- MS150, C9200/C9300 (ending in 4G/4X), C8xxx, MA- accessories → no suffix (these families end in 4G/4X like Catalyst switches)
- Z4X, Z4CX → no suffix (sold as-is)

IMPORTANT: CW9166I and CW9164I are CURRENT Wi-Fi 6E access points (use -MR suffix). They are NOT end-of-life. Do NOT substitute MR36 or any other replacement. Only SKUs listed in the EOL replacements map should be treated as EOL.

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

CRITICAL AGGREGATION RULES FOR REFRESH URLs — follow ALL three rules:

RULE 1 — DEDUP REPLACEMENTS: When multiple EOL models map to the SAME replacement SKU, SUM their quantities into ONE URL entry.
Example: MX60W ×1 + MX64W ×1 both map to MX67W → MX67W-HW ×2, LIC-MX67W-SEC-3YR ×2 (NOT two separate entries).
Example: MS120-8FP ×26 + MS220-8P ×6 both map to MS130-8P → MS130-8P-HW ×32.

RULE 2 — EXISTING DEVICE LICENSE CARRY-FORWARD: When an EOL model's replacement matches a device the customer ALREADY HAS (non-EOL), the refresh URL must include licenses for BOTH the replacement AND the existing device, but hardware ONLY for the replacement (the customer already owns the existing hardware). In build_quote_url, use hardware_qty to specify the replacement-only hardware count while qty covers total licenses.
Example: Z1 ×1 (EOL → Z4) + existing Z4 ×1 (non-EOL) → pass {model:"Z4", qty:2, hardware_qty:1} → Z4-HW ×1 (only the Z1 replacement), LIC-Z4-SEC-3Y ×2 (one for the Z1→Z4 replacement + one for the existing Z4).

RULE 3 — BUILD A RUNNING TALLY: Before constructing ANY refresh URL, build a tally of every SKU and its total quantity across all devices (EOL replacements + non-EOL carry-forwards). Hardware for non-EOL devices is EXCLUDED (they already own it). Licenses for non-EOL devices ARE included. Then construct ONE URL from the final tally. Never build the URL device-by-device.

RULE 4 — ORDERED HARDWARE+LICENSE GROUPING: Maintain the exact device order from the screenshot or request. For each device, place its hardware SKU immediately followed by its license SKU(s) — NEVER group all hardware first then all licenses. When multiple EOL models merge into one replacement (Rule 1), place the merged entry at the position of the FIRST contributing device. Non-EOL devices appear at their original position with license-only (no hardware).
Example from a license dashboard (top to bottom): MG51, MR Enterprise ×2, MS220-8P ×2, MX60, MX60W, MX64W, MX65, MX65W, MX75, Z1, Z4
Correct URL order: MG52-HW,LIC-MG52-ENT-3Y(×1), LIC-ENT-3YR(×2), MS130-8P-HW,LIC-MS130-CMPT-3Y(×2), MX67-HW,LIC-MX67-SEC-3YR(×1), MX67W-HW(×2),LIC-MX67W-SEC-3YR(×2), MX68-HW,LIC-MX68-SEC-3YR(×1), MX68W-HW,LIC-MX68W-SEC-3YR(×1), LIC-MX75-SEC-3Y(×1), Z4-HW(×1),LIC-Z4-SEC-3Y(×2)
Note: MX67W appears once at MX60W's position (first device mapping to MX67W). MX75 = license-only (non-EOL). Z4-HW ×1 (only Z1 replacement) but LIC-Z4-SEC-3Y ×2 (Rule 2: Z1→Z4 + existing Z4). The Z4 entry uses hardware_qty:1 and qty:2.

MANDATORY: Use the build_quote_url tool for ALL URL generation. NEVER manually type out URLs. Pass your parsed device list to the tool and it will handle suffixes, license mapping, dedup, and URL construction. For generic MR Enterprise licenses (no specific AP model), use model "MR-ENT". Call the tool once per URL you need (e.g., once for Option 1 renewal, once for Option 2 refresh). Use hardware_qty when a replacement model matches an existing device (Rule 2).

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
- For regular SKU quotes: always show 1-Year, 3-Year, and 5-Year URLs unless user says "just" or "only" with one term.
- URL-only output by default for simple quotes
- Keep responses concise but complete — never skip EOL products
- NEVER use bullet points (•) before URLs. Just put the URL on its own line after the term label.
- Use bullet points (•) only for License Analysis sections, never for URLs
- NEVER include EOS dates, End-of-Support dates, or lifecycle dates in responses unless the user explicitly asks for EOL dates

## MANDATORY DASHBOARD SCREENSHOT TEMPLATE
When analyzing a Meraki license dashboard screenshot, you MUST follow this EXACT template. Do NOT deviate, do NOT add extra sections, do NOT skip sections. Show ONLY 3-Year URLs. Use build_quote_url for EVERY URL.

**License Analysis:**
• [Model]: [qty] licensed = [qty] active ✓ (or note discrepancies)
• ... (list ALL devices from screenshot in order, skip MT with 0 devices)

**EOL Devices:**
• [Model] (EOL) → [Replacement]
• ... (list ALL EOL devices)

**Option 1 — Renew As-Is (License Only):**
[Call build_quote_url with ALL devices as license_only=true, term="3". Include every device from the screenshot that has active devices. Use the ORIGINAL model names (not replacements). Skip MT with 0 devices.]

3-Year Co-Term: [URL from tool]

**Option 2 — Hardware Refresh:**
[Call build_quote_url with: EOL devices mapped to their replacements (license_only=false), non-EOL devices as license_only=true, term="3". Apply Rules 1-4 for dedup, carry-forward, tally, and ordering.]

3-Year Co-Term: [URL from tool]

CRITICAL: You MUST call build_quote_url TWICE — once for Option 1, once for Option 2. NEVER manually construct URLs. Complete BOTH options in a single response. Do NOT stop after the analysis or after Option 1.

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

// ─── Claude API (direct fetch, no SDK) ───────────────────────────────────────
// ─── Quote URL Tool (deterministic URL builder for Claude vision path) ───────
const QUOTE_URL_TOOL = {
  name: 'build_quote_url',
  description: 'Build a Stratus order URL from a structured device list. ALWAYS use this tool for URL generation — never manually construct URLs. Pass devices in the order they should appear. The tool handles SKU suffixes, license mapping, dedup, and URL formatting. IMPORTANT for refresh quotes with Rule 2 carry-forward: when an EOL replacement matches a device the customer already owns, pass ONE entry with qty = total license count AND hardware_qty = replacement-only count (e.g., Z1→Z4 + existing Z4 = {model:"Z4", qty:2, hardware_qty:1}).',
  input_schema: {
    type: 'object',
    properties: {
      devices: {
        type: 'array',
        description: 'Ordered list of devices. Each device becomes hardware+license or license-only in the URL.',
        items: {
          type: 'object',
          properties: {
            model: { type: 'string', description: 'Base model without suffix (e.g., MX67, MS130-8P, Z4, MR44). For MR enterprise licenses without specific model, use "MR-ENT".' },
            qty: { type: 'integer', description: 'Quantity of this device (used for BOTH hardware and licenses unless hardware_qty overrides hardware count).' },
            hardware_qty: { type: 'integer', description: 'Override hardware quantity when it differs from license qty. Use for Rule 2 carry-forward: EOL replacement + existing device → hardware_qty = replacement count, qty = total licenses. Example: Z1×1 (EOL→Z4) + existing Z4×1 → {model:"Z4", qty:2, hardware_qty:1}. Omit to use qty for both.' },
            license_only: { type: 'boolean', description: 'True if customer already owns hardware (non-EOL). Only license, no hardware SKU.' }
          },
          required: ['model', 'qty']
        }
      },
      term: { type: 'string', enum: ['1', '3', '5'], description: 'License term in years. Default: 3.' },
      label: { type: 'string', description: 'Label for this URL (e.g., "Option 1 — Renew As-Is 3-Year", "Option 2 — Hardware Refresh 3-Year")' },
      hardware_only: { type: 'boolean', description: 'If true, output only hardware SKUs with no licenses.' }
    },
    required: ['devices']
  }
};

function handleQuoteUrlTool(params) {
  const { devices = [], term = '3', label, hardware_only = false } = params;
  const items = [];

  for (const device of devices) {
    const model = String(device.model || '').trim();
    const qty = parseInt(device.qty, 10) || 1;
    const license_only = !!device.license_only;
    // hardware_qty overrides qty for hardware SKUs only (Rule 2 carry-forward).
    // When an EOL replacement matches an existing device, hardware_qty = replacement count,
    // qty = total license count. Example: Z1→Z4 + existing Z4 → hardware_qty:1, qty:2.
    const hwQty = device.hardware_qty != null ? parseInt(device.hardware_qty, 10) : qty;

    if (!model) continue;

    // Special case: MR-ENT = generic MR Enterprise license (no hardware model)
    if (model === 'MR-ENT' || model === 'MR_ENT') {
      const termSuffix = term === '1' ? '1YR' : term === '5' ? '5YR' : '3YR';
      items.push({ sku: `LIC-ENT-${termSuffix}`, qty });
      continue;
    }

    if (!license_only && !hardware_only) {
      // Hardware + license (hwQty may differ from qty for carry-forward scenarios)
      if (hwQty > 0) items.push({ sku: applySuffix(model), qty: hwQty });
      const licSkus = getLicenseSkus(model, null); // null = use default tier (SEC/ENT per family)
      if (licSkus) {
        const licEntry = licSkus.find(l => l.term === `${term}Y`);
        if (licEntry) items.push({ sku: licEntry.sku, qty });
      }
    } else if (license_only) {
      // License only (non-EOL device, customer owns hardware)
      const licSkus = getLicenseSkus(model, null); // null = use default tier
      if (licSkus) {
        const licEntry = licSkus.find(l => l.term === `${term}Y`);
        if (licEntry) items.push({ sku: licEntry.sku, qty });
      }
    } else {
      // Hardware only
      items.push({ sku: applySuffix(model), qty: hwQty });
    }
  }

  const url = buildStratusUrl(items);
  return { url, label: label || `${term}-Year Co-Term`, items_count: items.length };
}

// ═══ PRODUCT_INFO WATERFALL — Llama handler ═══
// Handles product_info requests classified as 'simple_lookup' by classifyProductInfoSubtype.
// Mirrors askClaude's context-building (static specs → datasheet → category fallback) but
// substitutes Llama 4 Scout + CF_GROUNDING_RULES for the answer generation.
//
// Return: { reply: string } on success, or null on empty/error (caller falls back to Claude).
// Caller is responsible for history save + D1 logging.
async function askLlamaProductInfo(userMessage, personId, env, classification = null) {
  if (!env.AI) return null;
  try {
    const kv = env.CONVERSATION_KV;

    // Datasheet-intent detection (shared with askClaude)
    let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?(LATEST|DATASHEET|SPECS?)|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|GET\s+SPECIFICS|SPECIFICS\s+(FROM\s+)?(THE\s+)?DATASHEET|FROM\s+(THE\s+)?DATASHEET|WHAT\s+DOES\s+(THE\s+)?DATASHEET\s+SAY|READ\s+(THE\s+)?DATASHEET|FETCH\s+(THE\s+)?DATASHEET)\b/i.test(userMessage);
    if (!wantsLiveDatasheet && classification && classification.intent === 'product_info') {
      // product_info followups often reference a prior turn that named a model
      const FOLLOWUP = /\b(SPECIFICS|MORE\s+DETAILS?|TELL\s+ME\s+MORE|KEEP\s+GOING|CONTINUE)\b/i;
      if (FOLLOWUP.test(userMessage)) wantsLiveDatasheet = true;
    }

    // Build context identically to askClaude: static specs → datasheet → category family
    let systemPrompt = SYSTEM_PROMPT;
    const sources = { liveModels: [], liveUrls: [], fetchFailed: false, cachedModels: [], categoryFamilies: [] };

    if (wantsLiveDatasheet) {
      let datasheetContext = await getRelevantDatasheetContext(userMessage);
      // If no model in current message, scan recent history for a model mention
      if (!datasheetContext && personId && kv) {
        const history = await getHistory(kv, personId);
        const recentTurns = [...history].reverse().slice(0, 6);
        for (const turn of recentTurns) {
          if (turn && turn.content) {
            const ctx = await getRelevantDatasheetContext(turn.content);
            if (ctx) { datasheetContext = ctx; break; }
          }
        }
      }
      if (datasheetContext) {
        systemPrompt += '\n\n' + datasheetContext.text;
        systemPrompt += '\n\nThe user is asking for spec details. Use the datasheet content above as the authoritative source.';
        sources.liveModels.push(...(datasheetContext.models || []));
        sources.liveUrls.push(...(datasheetContext.urls || []));
      } else {
        sources.fetchFailed = true;
        const staticContext = getStaticSpecsContext(userMessage);
        if (staticContext) {
          systemPrompt += '\n\n' + staticContext.text;
          sources.cachedModels.push(...(staticContext.models || []));
        }
      }
    } else {
      const staticContext = getStaticSpecsContext(userMessage);
      if (staticContext) {
        systemPrompt += '\n\n' + staticContext.text;
        sources.cachedModels.push(...(staticContext.models || []));
      } else {
        // Category family fallback (same logic as askClaude + benchmark endpoint)
        const catUpper = userMessage.toUpperCase();
        const families = [];
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push('MX');
        if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push('MR', 'CW');
        if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push('MS130', 'MS150');
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push('MV');
        if (/\b(SENSOR)\b/.test(catUpper)) families.push('MT');
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push('MG');
        if (families.length > 0) {
          let ctx = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE)\n';
          ctx += 'Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n';
          ctx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") — they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
          for (const fam of families) {
            const familyData = specs[fam];
            if (familyData) {
              for (const [model, modelSpecs] of Object.entries(familyData)) {
                ctx += `${model}: ${JSON.stringify(modelSpecs)}\n`;
              }
            }
          }
          systemPrompt += '\n\n' + ctx;
          sources.categoryFamilies.push(...families);
        }
      }
    }

    // Accessories injection (skip pricing — advisory path owns those)
    const accessoriesContext = getAccessoriesContext(userMessage);
    if (accessoriesContext) systemPrompt += '\n\n' + accessoriesContext;

    // Append grounding rules (bench v2: +16pp on Llama with these)
    systemPrompt += CF_GROUNDING_RULES;

    // Include last few history turns so followups work
    const history = (personId && kv) ? await getHistory(kv, personId) : [];
    const cfHistory = history.slice(-6).map(h => ({ role: h.role, content: h.content }));
    const messages = [
      { role: 'system', content: systemPrompt },
      ...cfHistory,
      { role: 'user', content: userMessage }
    ];

    const result = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
      messages,
      max_tokens: 1024
    });
    const reply = result?.response ?? result?.choices?.[0]?.message?.content ?? null;
    if (!reply || reply.trim().length < 20) return null;

    // Build source attribution footer (identical format to askClaude's footer)
    let footer = '';
    if (sources.liveModels.length) {
      footer = `\n\n*Live datasheet: ${sources.liveModels.join(', ')}*`;
    } else if (sources.fetchFailed && sources.cachedModels.length) {
      footer = `\n\n*Specs from product database (live datasheet fetch failed). Want me to retry?*`;
    } else if (sources.cachedModels.length) {
      footer = `\n\n*Specs from product database. Want me to pull the latest datasheet to verify?*`;
    } else if (sources.categoryFamilies.length) {
      footer = `\n\n*Specs from product database (${sources.categoryFamilies.join(', ')} family).*`;
    }
    return { reply: reply.trim() + footer, sources };
  } catch (e) {
    console.error('askLlamaProductInfo error:', e && e.message);
    return null;
  }
}

async function askClaude(userMessage, personId, env, imageData = null, classification = null) {
  if (!env.ANTHROPIC_API_KEY) return 'Claude API not configured. Please check ANTHROPIC_API_KEY.';

  // ═══ PRODUCT_INFO WATERFALL GATE ═══
  // When USE_PRODUCT_INFO_WATERFALL=true, route simple spec lookups to Llama (free, 83% acc
  // on these intents per 2026-04-23 benchmark). Advisory/flagship/pricing/comparison/image
  // stay on Claude. On Llama failure → falls through to Claude for full redundancy.
  // Trim flag value defensively — secret stdin may include trailing newlines.
  const waterfallFlag = String(env.USE_PRODUCT_INFO_WATERFALL || '').trim().toLowerCase();
  const waterfallOn = waterfallFlag === 'true' || waterfallFlag === '1' || waterfallFlag === 'yes';
  console.log(`[Waterfall] flag=${JSON.stringify(env.USE_PRODUCT_INFO_WATERFALL)} parsed=${waterfallOn} intent=${classification?.intent} hasImg=${!!imageData}`);
  if (waterfallOn &&
      classification && classification.intent === 'product_info' &&
      !imageData) {
    const subtype = classifyProductInfoSubtype(userMessage, false);
    console.log(`[Waterfall] subtype=${subtype} for: ${userMessage.substring(0, 60)}`);
    if (subtype === 'simple_lookup') {
      const t0 = Date.now();
      const llamaOut = await askLlamaProductInfo(userMessage, personId, env, classification);
      const elapsed = Date.now() - t0;
      if (llamaOut && llamaOut.reply) {
        // Save to conversation history using addToHistory — it writes the
        // {messages: [...]} shape that getHistory expects. Previously this block
        // wrote a raw array via kv.put directly, which getHistory would read back
        // as [] (because arrayData.messages is undefined). That silently dropped
        // conversation history after every waterfall reply, breaking follow-up
        // questions like "pull the datasheet" that rely on prior-turn context.
        const kv = env.CONVERSATION_KV;
        if (kv && personId) {
          try {
            await addToHistory(kv, personId, 'user', userMessage);
            await addToHistory(kv, personId, 'assistant', llamaOut.reply);
          } catch (_) {}
        }
        // Log decision to D1
        if (env.ctx && env.ctx.waitUntil) {
          env.ctx.waitUntil(logBotUsageToD1(env, {
            personId,
            requestText: userMessage,
            responsePath: 'waterfall-llama-product-info',
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            durationMs: elapsed
          }).catch(() => {}));
        } else {
          logBotUsageToD1(env, {
            personId,
            requestText: userMessage,
            responsePath: 'waterfall-llama-product-info',
            model: '@cf/meta/llama-4-scout-17b-16e-instruct',
            durationMs: elapsed
          }).catch(() => {});
        }
        // User-visible model marker — confirms which model produced this reply.
        // Matches the Claude-path marker added below for at-a-glance observability.
        const elapsedSec = (elapsed / 1000).toFixed(1);
        return `${llamaOut.reply}\n\n_🦙 Llama 4 Scout · CF Workers AI · ${elapsedSec}s · free_`;
      }
      // Llama returned null/empty → fall through to Claude (logged as waterfall-fallthrough)
      console.log('Waterfall: Llama returned empty, falling through to Claude');
    }
  }

  const claudeStartMs = Date.now();
  try {
    const upper = userMessage.toUpperCase();
    let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?(LATEST|DATASHEET|SPECS?)|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|CHECK\s+IT|MAKE\s+SURE|CONFIRM\s+(THE\s+)?(SPECS?|DATA)|DID\s+YOU\s+CHECK|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET|GET\s+SPECIFICS|SPECIFICS\s+(FROM\s+)?(THE\s+)?DATASHEET|FROM\s+(THE\s+)?DATASHEET|WHAT\s+DOES\s+(THE\s+)?DATASHEET\s+SAY|LOOK\s+(IT\s+)?UP|PULL\s+(IT\s+)?UP|DIG\s+INTO|READ\s+(THE\s+)?DATASHEET|FETCH\s+(THE\s+)?DATASHEET)\b/i.test(userMessage);

    // V2 classifier: product_info intent → treat as datasheet-lookup request
    // This lets followup questions like "get specifics from datasheet" or "tell me more"
    // trigger live fetch even when the narrow regex above doesn't match.
    if (!wantsLiveDatasheet && classification && classification.intent === 'product_info') {
      wantsLiveDatasheet = true;
    }

    let systemPrompt = SYSTEM_PROMPT;
    const kv = env.CONVERSATION_KV;

    // ─── Source Attribution Tracker ──────────────────────────────────────────
    // Records where the spec context injected into Claude came from so we can
    // tag every reply with a transparency footer. Options: live datasheet
    // (successful fetch from documentation.meraki.com), cached specs.json
    // (authoritative internal cache), category family fallback, or nothing
    // (training-data-only warning).
    const sources = {
      liveModels: [],       // datasheet keys fetched live
      liveUrls: [],         // URLs that returned content
      fetchFailed: false,   // live fetch was attempted but returned no content
      cachedModels: [],     // specs.json model keys resolved
      categoryFamilies: [], // family-level fallback (MX, MR, MS150, etc.)
    };
    let showFooter = false;
    // product_info intent is always a spec question → footer is always relevant
    if (classification && classification.intent === 'product_info') showFooter = true;

    // Context-aware: bare "yes"/"yeah"/"sure" after bot offered datasheet check
    if (!wantsLiveDatasheet && /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it)\s*[.!]?\s*$/i.test(userMessage) && personId && kv) {
      const recentHistory = await getHistory(kv, personId);
      const lastAssistant = [...recentHistory].reverse().find(h => h.role === 'assistant');
      if (lastAssistant && /datasheet|check for updates/i.test(lastAssistant.content)) {
        wantsLiveDatasheet = true;
      }
    }

    if (wantsLiveDatasheet) {
      showFooter = true;
      let datasheetFetched = false;
      const datasheetContext = await getRelevantDatasheetContext(userMessage);
      if (!datasheetContext && personId) {
        const history = await getHistory(kv, personId);
        // Scan recent history (not just last assistant) for any model mention.
        // Followups like "get specifics from datasheet" may come several turns after the model was named.
        const recentTurns = [...history].reverse().slice(0, 6);
        let historyContext = null;
        for (const turn of recentTurns) {
          historyContext = await getRelevantDatasheetContext(turn.content);
          if (historyContext) break;
        }
        if (historyContext) {
          systemPrompt += '\n\n' + historyContext.text;
          systemPrompt += '\n\nThe user has asked you to verify specs against the latest datasheet. Compare the live datasheet data above with what you previously told them and note any differences.';
          datasheetFetched = true;
          sources.liveModels.push(...(historyContext.models || []));
          sources.liveUrls.push(...(historyContext.urls || []));
        }
      } else if (datasheetContext) {
        systemPrompt += '\n\n' + datasheetContext.text;
        systemPrompt += '\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.';
        datasheetFetched = true;
        sources.liveModels.push(...(datasheetContext.models || []));
        sources.liveUrls.push(...(datasheetContext.urls || []));
      }
      // If datasheet fetch failed, tell Claude it has the capability but the fetch failed
      if (!datasheetFetched) {
        sources.fetchFailed = true;
        systemPrompt += '\n\nThe user asked to verify specs against the latest datasheet. The live datasheet fetch was attempted but failed (the page may be temporarily unavailable). Tell the user the datasheet check was attempted but the page was unreachable, and offer to try again. Do NOT say you lack the ability to fetch datasheets — you DO have this capability, but it failed this time. Fall back to the specs.json data you already have.';
        // Still inject static specs as fallback
        const recentHistory = await getHistory(kv, personId);
        const lastAssistant = [...recentHistory].reverse().find(h => h.role === 'assistant');
        if (lastAssistant) {
          const staticContext = getStaticSpecsContext(lastAssistant.content);
          if (staticContext) {
            systemPrompt += '\n\n' + staticContext.text;
            sources.cachedModels.push(...(staticContext.models || []));
          }
        }
      }
    } else {
      const staticContext = getStaticSpecsContext(userMessage);
      // If no static context from model names, try category keywords for advisory questions
      let categoryContext = null;
      let categoryFamilies = [];
      if (!staticContext) {
        const catUpper = userMessage.toUpperCase();
        const families = [];
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push('MX');
        if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push('MR', 'CW');
        if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push('MS130', 'MS150');
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push('MV');
        if (/\b(SENSOR)\b/.test(catUpper)) families.push('MT');
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push('MG');

        if (families.length > 0) {
          let ctx = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE)\n';
          ctx += 'Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n';
          ctx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") — they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
          for (const fam of families) {
            const familyData = specs[fam];
            if (familyData) {
              for (const [model, modelSpecs] of Object.entries(familyData)) {
                ctx += `${model}: ${JSON.stringify(modelSpecs)}\n`;
              }
            }
          }
          categoryContext = ctx;
          categoryFamilies = families;
        }
      }
      if (staticContext) {
        systemPrompt += '\n\n' + staticContext.text;
        sources.cachedModels.push(...(staticContext.models || []));
        showFooter = true;
      } else if (categoryContext) {
        systemPrompt += '\n\n' + categoryContext;
        sources.categoryFamilies.push(...categoryFamilies);
        showFooter = true;
      }
    }

    // ── Guaranteed family fallback ──
    // Product_info queries must NEVER fall back to "training data only". If nothing
    // above resolved (no specific model, datasheet fetch failed, lastAssistant empty),
    // detect the family from the current message + last two assistant turns and inject
    // family-level specs from specs.json. Handles cases like:
    //   • "which MX for 500 users"  — bare family, no model number
    //   • "pull the datasheet" after a category-level prior turn
    //   • "tell me about switches" — generic wording, no SKU
    if ((classification?.intent === 'product_info' || wantsLiveDatasheet) &&
        sources.liveModels.length === 0 &&
        sources.cachedModels.length === 0 &&
        sources.categoryFamilies.length === 0) {
      // Family-prefix regexes intentionally omit the trailing \b so they also match
      // model numbers like "MX95" (where MX is followed by digits, not a boundary).
      // "\bMX" matches both bare "MX" and "MX95".
      const familyDetect = (text) => {
        const u = (text || '').toUpperCase();
        const fams = new Set();
        if (/\b(FIREWALL|SECURITY\s*APPLIANCE|GATEWAY)\b/.test(u) || /\bMX/.test(u)) fams.add('MX');
        if (/\b(ACCESS\s*POINT|WI[\s-]?FI|WIRELESS|\bAP\b)/.test(u) || /\b(MR|CW)/.test(u)) { fams.add('MR'); fams.add('CW'); }
        if (/\b(SWITCH|SWITCHING)\b/.test(u) || /\bMS/.test(u)) { fams.add('MS130'); fams.add('MS150'); }
        if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(u) || /\bMV/.test(u)) fams.add('MV');
        if (/\bSENSOR\b/.test(u) || /\bMT/.test(u)) fams.add('MT');
        if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(u) || /\bMG/.test(u)) fams.add('MG');
        return [...fams];
      };
      let fams = familyDetect(userMessage);
      if (fams.length === 0 && personId && kv) {
        const histForFam = await getHistory(kv, personId);
        const recentAsst = [...histForFam].reverse().filter(h => h.role === 'assistant').slice(0, 2);
        for (const t of recentAsst) {
          fams = familyDetect(t.content);
          if (fams.length > 0) break;
        }
      }
      if (fams.length > 0) {
        let famCtx = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE, family-level fallback)\n';
        famCtx += 'Use ONLY these specs. Do NOT supplement with training data. If the exact spec the user asked about is not listed, say so and offer to pull the live datasheet.\n';
        famCtx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") — they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
        for (const fam of fams) {
          const famData = specs[fam];
          if (famData) {
            for (const [model, mSpecs] of Object.entries(famData)) {
              if (model.startsWith('_')) continue;
              famCtx += `${model}: ${JSON.stringify(mSpecs)}\n`;
            }
          }
        }
        systemPrompt += '\n\n' + famCtx;
        sources.categoryFamilies.push(...fams);
        showFooter = true;
      }
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
    const messages = [...history, { role: 'user', content: userContent }];

    // Include quote URL tool for all requests (lightweight, only called when Claude needs URLs)
    // Image analysis + tool-use needs more tokens than text-only (2048 for tool calls)
    const apiBody = {
      model: 'claude-sonnet-4-6',
      max_tokens: imageData ? 4096 : 1024,
      system: systemPrompt,
      messages,
      tools: [QUOTE_URL_TOOL]
    };

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(apiBody)
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Anthropic API error:', response.status, errBody);
      return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44".`;
    }

    let data = await response.json();

    // Strip base64 image from messages after first API call to save tokens on tool-use round-trips.
    // Claude already analyzed the image; resending it wastes ~100K+ tokens per iteration.
    if (imageData && data.stop_reason === 'tool_use') {
      for (const msg of messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          msg.content = msg.content.map(block =>
            block.type === 'image' ? { type: 'text', text: '[Image already analyzed in first turn]' } : block
          );
        }
      }
    }

    // Tool-use loop: handle build_quote_url calls (max 8 iterations for multi-URL responses)
    // Strategy: accumulate Claude's text across all iterations. Track tool-generated URLs
    // separately and only inject them as a FALLBACK if Claude's combined text omits any.
    // This prevents duplicate URLs when Claude includes them in intermediate or final text.
    let accumulatedText = '';
    let toolIterations = 0;
    const toolUrls = []; // URLs from build_quote_url results (label + url for fallback injection)

    while (data.stop_reason === 'tool_use' && toolIterations < 8) {
      toolIterations++;

      // Capture text blocks from this iteration BEFORE processing tools
      for (const block of data.content) {
        if (block.type === 'text' && block.text) {
          accumulatedText += block.text + '\n\n';
        }
      }

      const toolUseBlocks = data.content.filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      // Process all tool calls in this response
      const toolResults = [];
      for (const toolUse of toolUseBlocks) {
        if (toolUse.name === 'build_quote_url') {
          let result;
          try {
            console.log(`[WEBEX] Tool input: ${JSON.stringify(toolUse.input).substring(0, 500)}`);
            result = handleQuoteUrlTool(toolUse.input);
            console.log(`[WEBEX] Tool call: build_quote_url → ${result.url?.substring(0, 80)}...`);
          } catch (toolErr) {
            console.error(`[WEBEX] Tool error: ${toolErr.message}`, toolErr.stack);
            result = { error: toolErr.message, url: null };
          }
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify(result)
          });

          // Track the URL for deferred fallback injection (don't inject into text yet)
          if (result.url) {
            toolUrls.push({ url: result.url, label: result.label || 'Quote URL' });
          }
        } else {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: JSON.stringify({ error: 'Unknown tool' }),
            is_error: true
          });
        }
      }

      // Send tool results back to Claude
      messages.push({ role: 'assistant', content: data.content });
      messages.push({ role: 'user', content: toolResults });

      const nextResponse = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ ...apiBody, messages })
      });

      if (!nextResponse.ok) break;
      data = await nextResponse.json();
    }

    // Capture text from the final response (Claude's wrap-up after all tool calls)
    const finalTextBlock = data.content?.find(b => b.type === 'text');
    if (finalTextBlock?.text) {
      accumulatedText += finalTextBlock.text;
    }

    // Deferred URL injection: only inject tool-generated URLs that Claude's combined
    // text (intermediate + final) doesn't already contain. This prevents duplicates
    // regardless of whether Claude placed URLs in intermediate or final iterations.
    if (toolUrls.length > 0) {
      const missingUrls = toolUrls.filter(({ url }) => !accumulatedText.includes(url));
      if (missingUrls.length > 0) {
        // Prepend missing URLs as fallback so they appear in the output
        const fallbackBlock = missingUrls.map(({ url, label }) =>
          `**${label}:** ${url}`
        ).join('\n\n');
        accumulatedText = fallbackBlock + '\n\n' + accumulatedText;
      }
    }

    const reply = accumulatedText.replace(/\n{3,}/g, '\n\n').trim() || 'Sorry, I could not generate a response.';

    // ─── Source Attribution Footer ───────────────────────────────────────────
    // Tag every spec-related reply with where the data came from so Chris can
    // tell at a glance whether the bot pulled the live datasheet, fell back to
    // the cached specs.json, or answered purely from training data (hallucination risk).
    let sourceFooter = '';
    if (showFooter) {
      if (sources.liveModels.length > 0) {
        const uniqModels = [...new Set(sources.liveModels)];
        sourceFooter = `_📄 Source: live datasheet — ${uniqModels.join(', ')} (documentation.meraki.com)_`;
      } else if (sources.cachedModels.length > 0) {
        const uniqModels = [...new Set(sources.cachedModels)];
        const fetchNote = sources.fetchFailed ? ' · live fetch failed, fell back to cache' : '';
        sourceFooter = `_📊 Source: cached specs.json — ${uniqModels.join(', ')}${fetchNote}_`;
      } else if (sources.categoryFamilies.length > 0) {
        const uniqFams = [...new Set(sources.categoryFamilies)];
        sourceFooter = `_📊 Source: cached specs.json — family-level (${uniqFams.join(', ')})_`;
      } else {
        // Should be unreachable for product_info — guaranteed family fallback above
        // always injects at least one family from specs.json. This branch remains
        // only as a defensive safety net (e.g. non-Meraki follow-up questions).
        sourceFooter = `_📚 Source: general Cisco/Meraki knowledge — ask me to "pull the datasheet" for live specs on a specific model._`;
      }
    }
    // User-visible model marker — confirms which model produced this reply.
    // Matches the Llama-path marker above for at-a-glance observability.
    const claudeSec = ((Date.now() - claudeStartMs) / 1000).toFixed(1);
    const modelMarker = `_💎 Claude Sonnet 4.6 · ${claudeSec}s_`;
    const finalReply = sourceFooter
      ? `${reply}\n\n${sourceFooter}\n\n${modelMarker}`
      : `${reply}\n\n${modelMarker}`;

    if (personId) {
      await addToHistory(kv, personId, 'user', userMessage);
      await addToHistory(kv, personId, 'assistant', finalReply);
    }

    // Log token usage + cost to D1 (previously missed — cost was always $0)
    if (data?.usage) {
      const MODEL_COST = { input: 3.0, output: 15.0 }; // sonnet-4-6 per 1M tokens
      const costUsd = ((data.usage.input_tokens || 0) / 1e6) * MODEL_COST.input +
                      ((data.usage.output_tokens || 0) / 1e6) * MODEL_COST.output;
      logBotUsageToD1(env, {
        personId, requestText: userMessage, responsePath: 'claude',
        model: 'claude-sonnet-4-6',
        inputTokens: data.usage.input_tokens || 0,
        outputTokens: data.usage.output_tokens || 0,
        costUsd,
        durationMs: null
      }).catch(() => {});
    }

    return finalReply;
  } catch (err) {
    console.error('Claude API error:', err.message, err.stack);
    return `Sorry, I couldn't process that request. Try a specific SKU like "quote 10 MR44" or "5 MS150-48LP-4G".`;
  }
}

// ─── Main Worker Entry Point ─────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    // Load KV-cached live prices (written by GChat worker's daily cron)
    await loadLivePrices(env);

    const url = new URL(request.url);
    // ── Dashboard Manifest: auto-written to KV on first request after deploy ──
    const WORKER_MANIFEST = {
      worker: 'webex',
      version: '2.0.0-cf',
      deployedAt: new Date().toISOString(),
      routes: ['POST /webhook', 'GET /health'],
      handlers: [
        {id:'wx-trigger',name:'Webex Webhook',type:'trigger',fn:'fetch()'},
        {id:'wx-dedup',name:'Dedup Check',type:'decision',fn:'kv.get(dedup_)'},
        {id:'wx-botcheck',name:'Bot Self-Check',type:'decision',fn:'getBotPersonId()'},
        {id:'wx-getmsg',name:'Get Message',type:'api',fn:'getMessage()'},
        {id:'wx-image',name:'Image Check',type:'decision',fn:'msg.files'},
        {id:'wx-cfvision',name:'CF Vision (Llama 4 Scout)',type:'api',fn:'askCFVision()'},
        {id:'wx-imgclaude',name:'Claude Vision (fallback)',type:'api',fn:'askClaude(imageData)'},
        {id:'wx-eol',name:'EOL Lookup',type:'action',fn:'handleEolDateRequest()'},
        {id:'wx-confirm',name:'Quote Confirm',type:'action',fn:'handleQuoteConfirmation()'},
        {id:'wx-pricing',name:'Pricing Calculator',type:'action',fn:'handlePricingRequest()'},
        {id:'wx-parse',name:'parseMessage',type:'action',fn:'parseMessage()'},
        {id:'wx-clarify',name:'Clarification',type:'decision',fn:'clarification prompt'},
        {id:'wx-cfclassify',name:'CF Intent Classifier',type:'api',fn:'classifyWithCF()'},
        {id:'wx-build',name:'Build Quote',type:'action',fn:'buildQuoteResponse()'},
        {id:'wx-revision',name:'Revision Check',type:'decision',fn:'revision detection'},
        {id:'wx-claude',name:'Claude Fallback',type:'api',fn:'askClaude()'},
        {id:'wx-send',name:'Send Response',type:'output',fn:'sendMessage()'},
        {id:'wx-history',name:'Update History',type:'storage',fn:'addToHistory()'},
        {id:'wx-d1',name:'D1 + Analytics',type:'storage',fn:'ANALYTICS_DB + BOT_METRICS'}
      ],
      bindings: {kv:'CONVERSATION_KV',d1:'ANALYTICS_DB',ae:'BOT_METRICS',ai:'AI_GATEWAY'}
    };
    if (!globalThis.__manifestWritten) {
      globalThis.__manifestWritten = true;
      ctx.waitUntil((async () => {
        try { await env.CONVERSATION_KV.put('dashboard_manifest_webex', JSON.stringify(WORKER_MANIFEST), {expirationTtl:86400}); }
        catch(e) { console.warn('Manifest write failed:', e.message); }
      })());
    }
    // ── Dashboard API (consumed by stratus-dashboard.pages.dev) ──
    const DASH_CORS = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Dashboard-Key'};
    if (url.pathname.startsWith('/dashboard/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: DASH_CORS });
      const dashKey = request.headers.get('X-Dashboard-Key') || url.searchParams.get('key');
      if (dashKey !== 'Biscuit4') return new Response(JSON.stringify({error:'Unauthorized'}), {status:401, headers:DASH_CORS});
      const db = env.ANALYTICS_DB; // may be undefined if D1 binding missing

      if (request.method === 'GET' && url.pathname === '/dashboard/stats') {
        if (!db) return new Response(JSON.stringify({error:'D1 not bound',usage:{total:0},quotes:{total:0},errors:{total:0},pathBreakdown:[],modelBreakdown:[],hourly:[],recentErrors:[]}), {headers:DASH_CORS});
        try {
          const range = url.searchParams.get('range') || '24h';
          const rs = {'1h':"-1 hour",'6h':"-6 hours",'24h':"-1 day",'7d':"-7 days",'30d':"-30 days",'all':"-100 years"}[range] || "-1 day";
          const since = `datetime('now','${rs}')`;
          const [usage,quotes,errors,pathBreakdown,modelBreakdown,hourly,recentErrors] = await Promise.all([
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,COALESCE(SUM(input_tokens),0) as input_tokens,COALESCE(SUM(output_tokens),0) as output_tokens,COALESCE(SUM(cost_usd),0) as total_cost,COALESCE(AVG(duration_ms),0) as avg_duration FROM bot_usage WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,COALESCE(SUM(total_list),0) as total_list,COALESCE(SUM(total_ecomm),0) as total_ecomm FROM quote_history WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total FROM bot_usage WHERE response_path='error' AND created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT response_path,COUNT(*) as count FROM bot_usage WHERE created_at >= ${since} GROUP BY response_path ORDER BY count DESC`).all(),
            env.ANALYTICS_DB.prepare(`SELECT model,COUNT(*) as count,COALESCE(SUM(input_tokens),0) as input_tokens,COALESCE(SUM(output_tokens),0) as output_tokens,COALESCE(SUM(cost_usd),0) as cost FROM bot_usage WHERE model IS NOT NULL AND created_at >= ${since} GROUP BY model ORDER BY count DESC`).all(),
            env.ANALYTICS_DB.prepare(`SELECT strftime('%Y-%m-%dT%H:00:00Z',created_at) as hour,COUNT(*) as count,SUM(CASE WHEN response_path='error' THEN 1 ELSE 0 END) as errors FROM bot_usage WHERE created_at >= ${since} GROUP BY hour ORDER BY hour`).all(),
            env.ANALYTICS_DB.prepare(`SELECT created_at,bot,response_path,error_message,duration_ms FROM bot_usage WHERE response_path='error' AND created_at >= ${since} ORDER BY created_at DESC LIMIT 20`).all()
          ]);
          return new Response(JSON.stringify({range,timestamp:new Date().toISOString(),usage,quotes,errors,pathBreakdown:pathBreakdown.results,modelBreakdown:modelBreakdown.results,hourly:hourly.results,recentErrors:recentErrors.results}), {headers:DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      if (request.method === 'GET' && url.pathname === '/dashboard/events') {
        if (!db) return new Response(JSON.stringify({events:[],quotes:[]}), {headers:DASH_CORS});
        try {
          const since = url.searchParams.get('since') || new Date(Date.now()-300000).toISOString();
          const limit = Math.min(parseInt(url.searchParams.get('limit')||'50'),100);
          const [events,quotes] = await Promise.all([
            env.ANALYTICS_DB.prepare('SELECT id,created_at,bot,response_path,model,input_tokens,output_tokens,cost_usd,duration_ms,error_message FROM bot_usage WHERE created_at > ? ORDER BY created_at DESC LIMIT ?').bind(since,limit).all(),
            env.ANALYTICS_DB.prepare('SELECT id,created_at,bot,skus,total_list,total_ecomm,response_type,eol_warnings,duration_ms FROM quote_history WHERE created_at > ? ORDER BY created_at DESC LIMIT ?').bind(since,limit).all()
          ]);
          return new Response(JSON.stringify({events:events.results,quotes:quotes.results,timestamp:new Date().toISOString()}), {headers:DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      if (request.method === 'GET' && url.pathname === '/dashboard/crm-stats') {
        if (!db) return new Response(JSON.stringify({operations:{total:0,errors:0},breakdown:[]}), {headers:DASH_CORS});
        try {
          const range = url.searchParams.get('range') || '24h';
          const rs = {'1h':"-1 hour",'6h':"-6 hours",'24h':"-1 day",'7d':"-7 days",'30d':"-30 days",'all':"-100 years"}[range] || "-1 day";
          const since = `datetime('now','${rs}')`;
          const [ops,breakdown] = await Promise.all([
            env.ANALYTICS_DB.prepare(`SELECT COUNT(*) as total,SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) as success,SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) as errors FROM crm_operations WHERE created_at >= ${since}`).first(),
            env.ANALYTICS_DB.prepare(`SELECT operation,module,COUNT(*) as count FROM crm_operations WHERE created_at >= ${since} GROUP BY operation,module ORDER BY count DESC LIMIT 20`).all()
          ]);
          return new Response(JSON.stringify({operations:ops,breakdown:breakdown.results}), {headers:DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      if (request.method === 'GET' && url.pathname === '/dashboard/pricing-status') {
        try {
          const kv = env.CONVERSATION_KV;
          const result = kv ? await kv.get('prices_live','json') : null;
          const error = kv ? await kv.get('prices_live_error','json') : null;
          const recentChanges = env.ANALYTICS_DB ? await env.ANALYTICS_DB.prepare('SELECT sku,old_price,new_price,list_price,price_change,change_pct,refreshed_at FROM pricing_history WHERE price_change != 0 ORDER BY refreshed_at DESC LIMIT 20').all() : {results:[]};
          return new Response(JSON.stringify({hasLivePrices:!!result,refreshedAt:result?.refreshedAt||null,stats:result?.stats||null,lastError:error||null,recentChanges:recentChanges.results}), {headers:DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }


      if (request.method === 'GET' && url.pathname === '/dashboard/config') {
        try {
          const kv = env.CONVERSATION_KV;
          const [webex,gchat] = await Promise.all([
            kv.get('dashboard_manifest_webex','json'),
            kv.get('dashboard_manifest_gchat','json')
          ]);
          return new Response(JSON.stringify({webex,gchat,timestamp:new Date().toISOString()}), {headers:DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      // ── /dashboard/shadow-classifier ── recent shadow log rows + agreement stats (shadow mode analysis)
      if (request.method === 'GET' && url.pathname === '/dashboard/shadow-classifier') {
        if (!db) return new Response(JSON.stringify({error:'D1 not bound'}), {status:500, headers:DASH_CORS});
        try {
          const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500);
          const [rows, stats] = await Promise.all([
            db.prepare('SELECT id, created_at, substr(request_text,1,120) as req, legacy_intent, v2_intent, v2_confidence, intent_agree, v2_items, v2_modifiers, v2_revision, v2_reference, v2_parse_error, v2_elapsed_ms, legacy_elapsed_ms, gemma4_intent, gemma4_confidence, gemma4_elapsed_ms, gemma4_items, gemma4_modifiers, gemma4_revision, gemma4_reference, gemma4_parse_error, gemma4_agree FROM classifier_shadow ORDER BY id DESC LIMIT ?').bind(limit).all(),
            db.prepare("SELECT COUNT(*) as total, SUM(CASE WHEN intent_agree=1 THEN 1 ELSE 0 END) as v2_agree, SUM(CASE WHEN gemma4_agree=1 THEN 1 ELSE 0 END) as gemma4_agree, SUM(CASE WHEN v2_parse_error IS NOT NULL THEN 1 ELSE 0 END) as v2_parse_fail, SUM(CASE WHEN gemma4_parse_error IS NOT NULL THEN 1 ELSE 0 END) as gemma4_parse_fail, AVG(legacy_elapsed_ms) as avg_legacy_ms, AVG(v2_elapsed_ms) as avg_v2_ms, AVG(gemma4_elapsed_ms) as avg_gemma4_ms FROM classifier_shadow WHERE created_at >= datetime('now','-7 days')").first()
          ]);
          return new Response(JSON.stringify({stats, rows: rows.results || []}, null, 2), {headers: DASH_CORS});
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      // ── Live Workflow Traces: recent pipeline executions for animation ──
      if (request.method === 'GET' && url.pathname === '/dashboard/traces') {
        if (!db) return new Response(JSON.stringify({traces:[]}), {headers:DASH_CORS});
        try {
          await ensureTraceTable(db);
          // D1 stores created_at as 'YYYY-MM-DD HH:MM:SS' (no T), so normalize the since param
          const sinceRaw = url.searchParams.get('since') || new Date(Date.now() - 120000).toISOString();
          const since = sinceRaw.replace('T', ' ').replace(/\.\d+Z$/, '').replace('Z', '');
          const rows = await db.prepare(
            `SELECT trace_id, bot, node_id, status, ts_ms, metadata, created_at
             FROM workflow_traces WHERE created_at > ? ORDER BY created_at DESC, ts_ms ASC, id ASC LIMIT 500`
          ).bind(since).all();
          // Group by trace_id
          const grouped = {};
          for (const r of rows.results) {
            if (!grouped[r.trace_id]) grouped[r.trace_id] = { traceId: r.trace_id, bot: r.bot, createdAt: r.created_at, steps: [] };
            grouped[r.trace_id].steps.push({ nodeId: r.node_id, status: r.status, tsMs: r.ts_ms, meta: r.metadata ? JSON.parse(r.metadata) : null });
          }
          return new Response(JSON.stringify({ traces: Object.values(grouped), timestamp: new Date().toISOString() }), { headers: DASH_CORS });
        } catch(err) { return new Response(JSON.stringify({error:err.message}), {status:500, headers:DASH_CORS}); }
      }

      return new Response(JSON.stringify({error:'Not found'}), {status:404, headers:DASH_CORS});
    }

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
        const T = createTracer(env, 'webex');
        try {
          const event = body;
          if (event.resource !== 'messages' || event.event !== 'created') return;
          T.step('wx-trigger', 'enter', { msgId: event.data?.id });

          const token = env.WEBEX_BOT_TOKEN;
          const kv = env.CONVERSATION_KV;

          // ── Webhook dedup: prevent duplicate processing of the same message ──
          T.step('wx-dedup', 'enter');
          const msgId = event.data?.id;
          if (msgId && kv) {
            const dedupKey = `dedup_${msgId}`;
            const already = await kv.get(dedupKey);
            if (already) {
              console.log(`[WEBEX] Dedup: skipping already-processed message ${msgId}`);
              T.step('wx-dedup', 'exit', { result: 'duplicate' });
              ctx.waitUntil(T.flush());
              return;
            }
            await kv.put(dedupKey, '1', { expirationTtl: 300 });
          }
          T.step('wx-dedup', 'exit', { result: 'new' });

          T.step('wx-botcheck', 'enter');
          const botId = await getBotPersonId(token);
          const personId = event.data.personId;
          if (personId === botId) { T.step('wx-botcheck', 'exit', { result: 'is_bot' }); ctx.waitUntil(T.flush()); return; }
          T.step('wx-botcheck', 'exit', { result: 'not_bot' });

          T.step('wx-getmsg', 'enter');
          const msg = await getMessage(event.data.id, token);
          let text;
          if (msg.html) {
            text = msg.html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
          } else {
            text = (msg.text || '').trim();
          }
          const roomId = msg.roomId;
          T.step('wx-getmsg', 'exit');

          // Check for image attachments
          T.step('wx-image', 'enter');
          if (msg.files && msg.files.length > 0) {
            const fileUrl = msg.files[0];
            const imageData = await downloadWebexFile(fileUrl, token);
            if (imageData && imageData.mediaType.startsWith('image/')) {
              T.step('wx-image', 'exit', { result: 'has_image' });
              const DASHBOARD_VISION_PROMPT = `You are analyzing a Cisco Meraki license dashboard screenshot.

Only extract rows from the TOP "License information" table — the one with the columns "License limit" and "Current device count". IGNORE the "License History" section at the bottom (those are past renewals with license keys like Z228-BEAC-D2QX and old devices — they must never appear in output).

Respond with ONLY this block. No preamble, no summary, no recommendations, no markdown bold, no explanations:

LICENSE_DASHBOARD_PARSE_V1
---
SKU: <sku> | LIMIT: <license limit number> | ACTIVE: <current device count number>
---
EXPIRATION: <YYYY-MM-DD or unknown>
MX_EDITION: <Advanced Security | Secure SD-WAN Plus | none>
MR_EDITION: <Enterprise | Advanced | none>

Hard rules:
1. One SKU per line between the --- markers. Emit a row for EVERY visible row in the top License table (including MR Enterprise, MX models, MS models, MT, MV, MG, Z-series).
2. MR Enterprise rows MUST be emitted as: SKU: MR-ENT | LIMIT: <number> | ACTIVE: <number>
3. Skip any row where ACTIVE (Current device count) is 0. Example: "MT | 5 free | 0" — skip.
4. Do NOT invent, recommend, translate, or substitute SKUs. Only emit SKUs literally visible in the top License table. If unsure, leave it out.
5. Do NOT include SKUs from the "License History" section (e.g. MX84 from a prior renewal).
6. LIMIT and ACTIVE must be the exact integers from the "License limit" and "Current device count" columns — never derive from model numbers.
7. Preserve hyphens exactly (MS120-24P, not MS120 24P).
8. Do not wrap labels in asterisks or other markdown. Output plain ASCII only.
9. If nothing extractable, emit the block with no SKU lines between the --- markers.`;

              const prompt = text || DASHBOARD_VISION_PROMPT;

              // Tier 1: Try CF Workers AI vision (Llama 4 Scout — free)
              T.step('wx-cfvision', 'enter');
              const cfVision = await askCFVision(prompt, imageData, env);
              T.step('wx-cfvision', 'exit');

              if (cfVision) {
                // CF vision succeeded — extract SKUs and store for follow-up requests
                const visionSkus = extractSkusFromVisionText(cfVision.response);
                if (visionSkus.length > 0) {
                  await kv.put(`vision_skus_${personId}`, JSON.stringify(visionSkus), { expirationTtl: 300 });
                  console.log(`[CF-Vision] Extracted ${visionSkus.length} SKUs from vision, stored in KV for 5min`);
                }

                await addToHistory(kv, personId, 'user', `[Image] ${prompt}`);

                // When SKUs are extracted, ALWAYS auto-generate the quote — no need to wait
                // for the user to say "quote this". Build a clean summary + quote URLs.
                if (visionSkus.length > 0) {
                  // Clean summary line: "LIC-ENT-3YR × 6" instead of raw markdown table
                  const skuSummary = visionSkus.map(s => `**${s.sku}** × ${s.qty}`).join('\n');

                  // MR-ENT is a generic "MR Enterprise license" signal from the vision
                  // extractor. It is NOT a real catalog SKU. Routing it through the text
                  // bridge with hardware SKUs triggers parseMessage's agnostic-family
                  // short-circuit which DROPS the hardware items. So: strip MR-ENT out
                  // of parseMessage input and handle MR licenses separately after.
                  const mrEntItems = visionSkus.filter(s => s.sku === 'MR-ENT' || s.sku === 'MR_ENT');
                  const hardwareItems = visionSkus.filter(s => s.sku !== 'MR-ENT' && s.sku !== 'MR_ENT');
                  const mrEntQty = mrEntItems.reduce((sum, s) => sum + (s.qty || 0), 0);

                  const skuText = hardwareItems.map(s => `${s.qty} ${s.sku}`).join(', ');
                  const visionQuoteParsed = hardwareItems.length > 0 ? parseMessage(skuText) : null;
                  const hwResult = (visionQuoteParsed && visionQuoteParsed.items.length > 0)
                    ? buildQuoteResponse(visionQuoteParsed)
                    : null;

                  // MR-license handling: merge LIC-ENT-{term}YR directly into the
                  // hardware quote URLs when both are present (one unified cart per
                  // term). If MR-only (no hardware), emit a standalone 3-URL block.
                  const mergeMrIntoUrls = (msg, qty) => {
                    if (!msg || !qty) return msg;
                    // Each stratus URL has shape: ...?item=A,B,C&qty=1,2,3
                    // Append LIC-ENT-{termYr} and qty to the matching term URL.
                    return msg.replace(
                      /(https:\/\/stratusinfosystems\.com\/order\/\?item=)([^&\s]+)(&qty=)([^\s)]+)/g,
                      (full, pre, items, midQty, qtys) => {
                        // Detect term from surrounding context by scanning the item list.
                        let term = null;
                        if (/-1YR?\b/.test(items) || /-1Y\b/.test(items)) term = '1YR';
                        else if (/-3YR?\b/.test(items) || /-3Y\b/.test(items)) term = '3YR';
                        else if (/-5YR?\b/.test(items) || /-5Y\b/.test(items)) term = '5YR';
                        if (!term) return full;
                        return `${pre}${items},LIC-ENT-${term}${midQty}${qtys},${qty}`;
                      }
                    );
                  };

                  let mrBlock = '';
                  let mergedHwMessage = hwResult ? hwResult.message : null;
                  if (mrEntQty > 0) {
                    if (hwResult && hwResult.message && !hwResult.needsLlm) {
                      // Hardware present: merge MR licenses into the existing term URLs.
                      // MR-ENT is listed in "Detected SKUs" already, so no need for an
                      // extra callout — treat it like any other detected item.
                      mergedHwMessage = mergeMrIntoUrls(hwResult.message, mrEntQty);
                    } else {
                      // No hardware: emit standalone MR block so user still gets URLs.
                      const mr1 = buildStratusUrl([{ sku: 'LIC-ENT-1YR', qty: mrEntQty }]);
                      const mr3 = buildStratusUrl([{ sku: 'LIC-ENT-3YR', qty: mrEntQty }]);
                      const mr5 = buildStratusUrl([{ sku: 'LIC-ENT-5YR', qty: mrEntQty }]);
                      mrBlock = [
                        '',
                        `**MR Enterprise Licenses (${mrEntQty} AP${mrEntQty === 1 ? '' : 's'}):**`,
                        `**1-Year:** ${mr1}`,
                        `**3-Year:** ${mr3}`,
                        `**5-Year:** ${mr5}`
                      ].join('\n\n');
                    }
                  }

                  if (hwResult && hwResult.message && !hwResult.needsLlm) {
                    // Drop detection: verify every extracted SKU appears in the combined
                    // rendered output (merged hardware message + optional MR block).
                    const qmsg = (mergedHwMessage || '') + (mrBlock || '');
                    const droppedFlags = [];
                    for (const s of visionSkus) {
                      const upper = s.sku.toUpperCase();
                      let seen = false;
                      if (upper === 'MR-ENT' || upper === 'MR_ENT') {
                        seen = /\bLIC-ENT-[135]YR?\b/.test(qmsg);
                      } else {
                        const escaped = upper.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                        const directRe = new RegExp(`\\b${escaped}\\b`);
                        const licRe = new RegExp(`LIC-${escaped}(?:-[A-Z0-9]+)?-[135]Y`);
                        seen = directRe.test(qmsg) || licRe.test(qmsg);
                      }
                      if (!seen) droppedFlags.push(`⚠️ **${s.sku}** × ${s.qty} was detected but did not appear in the quote — manual review needed.`);
                    }
                    const dropBlock = droppedFlags.length > 0 ? `\n\n${droppedFlags.join('\n')}` : '';
                    if (droppedFlags.length > 0) {
                      console.warn(`[CF-Vision] ${droppedFlags.length} SKU(s) dropped from final quote:`, droppedFlags);
                    }
                    const combined = `**Detected SKUs:**\n${skuSummary}${dropBlock}\n\n---\n\n${mergedHwMessage}${mrBlock}`;
                    await addToHistory(kv, personId, 'assistant', combined);
                    T.step('wx-send', 'enter');
                    await sendMessage(roomId, `${combined}\n\n_⚡ Workers AI Vision + Deterministic Quote (${cfVision.elapsed}ms, free)_`, token);
                    T.step('wx-send', 'exit');
                    T.step('wx-d1', 'enter');
                    logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: 'cf-vision-quote', durationMs: cfVision.elapsed }).catch(() => {});
                    writeMetric(env, { path: 'cf-vision-quote', durationMs: cfVision.elapsed, personId });
                    T.step('wx-d1', 'exit');
                    ctx.waitUntil(T.flush());
                    return;
                  }
                  // Deterministic couldn't build the hardware quote — still show the clean
                  // summary. If we DID produce an MR-licenses block (e.g. MR-only screenshot),
                  // include it so the user still gets the three LIC-ENT URLs.
                  const summaryTail = mrBlock ? `\n\n---${mrBlock}` : '';
                  const summaryMsg = `**Detected SKUs:**\n${skuSummary}${summaryTail}`;
                  await addToHistory(kv, personId, 'assistant', summaryMsg);
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, `${summaryMsg}\n\n_⚡ Workers AI Vision (${cfVision.elapsed}ms, free)_`, token);
                  T.step('wx-send', 'exit');
                  T.step('wx-d1', 'enter');
                  logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: 'cf-vision', durationMs: cfVision.elapsed }).catch(() => {});
                  writeMetric(env, { path: 'cf-vision', durationMs: cfVision.elapsed, personId });
                  T.step('wx-d1', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // No SKUs extracted — send the raw vision response (non-license screenshot)
                await addToHistory(kv, personId, 'assistant', cfVision.response);
                T.step('wx-send', 'enter');
                await sendMessage(roomId, `${cfVision.response}\n\n_⚡ Workers AI Vision (${cfVision.elapsed}ms, free)_`, token);
                T.step('wx-send', 'exit');
                T.step('wx-d1', 'enter');
                logBotUsageToD1(env, { personId, requestText: `[Image] ${prompt}`, responsePath: 'cf-vision', durationMs: cfVision.elapsed }).catch(() => {});
                writeMetric(env, { path: 'cf-vision', durationMs: cfVision.elapsed, personId });
                T.step('wx-d1', 'exit');
                ctx.waitUntil(T.flush());
                return;
              }

              // Tier 2: Fall back to Claude vision (paid)
              console.log('[Routing] CF vision failed, falling back to Claude');
              T.step('wx-imgclaude', 'enter');
              const claudeReply = await askClaude(prompt, personId, env, imageData);
              T.step('wx-imgclaude', 'exit');
              T.step('wx-send', 'enter');
              await sendMessage(roomId, claudeReply, token);
              T.step('wx-send', 'exit');
              ctx.waitUntil(T.flush());
              return;
            }
            if (msg.files.length > 0) {
              if (text) {
                // Fall through to text processing below
              } else {
                T.step('wx-image', 'exit', { result: 'file_failed' });
                T.step('wx-send', 'enter');
                await sendMessage(roomId, `I received a file attachment but couldn't process it as an image. Could you try sending it again?`, token);
                T.step('wx-send', 'exit');
                ctx.waitUntil(T.flush());
                return;
              }
            }
          }
          T.step('wx-image', 'exit', { result: 'text_only' });

          if (!text) { ctx.waitUntil(T.flush()); return; }
          const _wxStartMs = Date.now();

          // Try deterministic EOL date lookup first (before quoting engine)
          T.step('wx-eol', 'enter');
          const eolDateReply = handleEolDateRequest(text);
          if (eolDateReply) {
            T.step('wx-eol', 'exit', { result: 'match' });
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', eolDateReply);
            T.step('wx-history', 'enter'); T.step('wx-history', 'exit');
            T.step('wx-send', 'enter');
            await sendMessage(roomId, eolDateReply, token);
            T.step('wx-send', 'exit');
            ctx.waitUntil(T.flush());
            return;
          }
          T.step('wx-eol', 'exit', { result: 'no_match' });

          // Try deterministic quote confirmation
          T.step('wx-confirm', 'enter');
          const quoteConfirmReply = await handleQuoteConfirmation(text, personId, kv);
          if (quoteConfirmReply) {
            T.step('wx-confirm', 'exit', { result: 'confirmed' });
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', quoteConfirmReply);
            T.step('wx-history', 'enter'); T.step('wx-history', 'exit');
            T.step('wx-send', 'enter');
            await sendMessage(roomId, quoteConfirmReply, token);
            T.step('wx-send', 'exit');
            ctx.waitUntil(T.flush());
            return;
          }
          T.step('wx-confirm', 'exit', { result: 'no' });

          // ── NEW (Case 1 fix): Follow-up modifier handler ──
          // Runs BEFORE pricing + CF classify so modifier-only messages like
          // "license only", "hardware only", "3 year only", "add 2 MX67" apply
          // to the prior quote URL instead of being mis-routed to Claude/clarify.
          T.step('wx-followup', 'enter');
          try {
            const followUpReply = await handleFollowUpModifier(text, personId, kv);
            if (followUpReply) {
              T.step('wx-followup', 'exit', { result: 'match' });
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', followUpReply);
              T.step('wx-send', 'enter');
              await sendMessage(roomId, `${followUpReply}\n\n_⚡ Follow-up modifier (deterministic, free)_`, token);
              T.step('wx-send', 'exit');
              T.step('wx-d1', 'enter');
              logBotUsageToD1(env, { personId, requestText: text, responsePath: 'followup-modifier', durationMs: Date.now() - _wxStartMs }).catch(() => {});
              writeMetric(env, { path: 'followup-modifier', durationMs: Date.now() - _wxStartMs, personId });
              T.step('wx-d1', 'exit');
              ctx.waitUntil(T.flush());
              return;
            }
            T.step('wx-followup', 'exit', { result: 'no_match' });
          } catch (e) {
            console.warn('[FollowUp] error:', e.message);
            T.step('wx-followup', 'exit', { result: 'error' });
          }

          // Deterministic pricing calculator
          T.step('wx-pricing', 'enter');
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            T.step('wx-pricing', 'exit', { result: 'match' });
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            T.step('wx-history', 'enter'); T.step('wx-history', 'exit');
            T.step('wx-send', 'enter');
            await sendMessage(roomId, pricingReply, token);
            T.step('wx-send', 'exit');
            ctx.waitUntil(T.flush());
            return;
          }
          T.step('wx-pricing', 'exit', { result: 'no_match' });

          // ── CF-FIRST WATERFALL: CF classifies intent, deterministic executes quotes ──
          // Architecture: CF decides WHAT to do, deterministic engine does the QUOTING.
          // This eliminates false-positive quoting on product-info/advisory questions
          // because the deterministic engine never makes routing decisions — only CF does.
          // Matches GChat worker architecture (v2.0.0-cf-first-advisor).

          // ── Step 1: CF Workers AI intent classifier — the brain of the waterfall ──
          // SHADOW MODE: run legacy + Schema v2 classifier in parallel. Only legacy
          // drives routing. Both outputs are logged to D1 for disagreement analysis.
          // Pull most recent assistant message for v2 context.
          let priorCtxForV2 = '';
          try {
            const hist = await getHistory(kv, personId);
            const lastAsst = (hist || []).filter(h => h.role === 'assistant').slice(-1)[0];
            if (lastAsst) priorCtxForV2 = String(lastAsst.content || '').substring(0, 1500);
          } catch {}
          T.step('wx-cfclassify', 'enter');
          // CRITICAL PATH routing logic depends on USE_V2_CLASSIFIER:
          //   - V2 ON  (default, as of 2026-04-20 cutover): run Llama V2 + legacy in
          //     PARALLEL. V2 drives routing; legacy is the fallback if V2 errors or
          //     fails to parse. Gemma 4 stays in the shadow (non-blocking D1 log).
          //     Total critical-path latency ≈ max(V2, legacy) ≈ 1.7s p50.
          //   - V2 OFF (rollback mode): legacy alone on hot path, V2+Gemma shadow
          //     only for D1 comparison logging. Latency ≈ 500ms p50.
          // ── WATERFALL ROUTING (2026-04-22) ──
          // Hot path: V2/Llama + legacy in parallel (unchanged). Unconditional
          // Gemma shadow removed — saves ~$22/mo on the ~85% of traffic V2
          // handles with high confidence. Gemma is now an on-demand escalation:
          // only fires when V2 is low-confidence or lands on a known-weak intent
          // (price_lookup, clarify), with a 5s Promise.race timeout so a Gemma
          // tail-latency spike can't stall the hot path.
          let classification;                  // legacy result (always fetched)
          let v2Classification = null;         // V2 result (fetched only when flag on)
          let gemma4Classification = null;     // Gemma result (null unless waterfall escalates)
          let _rollbackShadowPromise = null;   // V2 shadow promise for rollback-mode logging only

          if (USE_V2_CLASSIFIER) {
            // V2 + legacy in parallel
            const _v2Promise = classifyWithCFv2(text, priorCtxForV2, env)
              .catch(e => ({ error: e.message, parseError: true }));
            const _legacyPromise = classifyWithCF(text, env)
              .catch(e => ({ error: e.message, intent: 'escalate' }));
            [v2Classification, classification] = await Promise.all([_v2Promise, _legacyPromise]);

            // ── Waterfall escalation decision ──
            // Trigger Gemma when V2 is unusable, low-confidence, in a known-weak
            // bucket, OR its output has structural inconsistencies. Tuned from the
            // 2026-04-23 waterfall audit (74-fixture benchmark): Llama's self-
            // reported confidence is useless (wrong answers came back at conf=1.0
            // every time) so we bolt on structural gates that catch the real
            // failure modes — empty items[] on a "quote", an ambiguous SKU stem
            // without variant suffix, and "revise" intent without prior_context.
            // price_lookup is only escalated when prior_context is present, since
            // standalone pricing questions on an explicit SKU are Llama's strong
            // suit and escalating them burns a Gemma call for nothing.
            const LOW_CONF_THRESHOLD = 0.7;
            const GEMMA_TIMEOUT_MS = 5000;
            // SKU stems that require a variant/port suffix before they can be quoted.
            // Matches family + base model number with NO trailing -\d suffix (e.g.
            // MS130-24 needs -4G / -2X; MS250 needs -24P/-48P etc.). If Llama emits
            // one of these as a hard "quote" item, the user actually wants clarify.
            const AMBIGUOUS_STEM = /^(MS130-24|MS150-24|MS150-48|MS250-24|MS250-48|MS350-24|MS350-48|MS425-16|MS425-32|MS130|MS150|MS250|MS350|MS425|MR|MX|MV|MT|MG|CW)$/i;
            const v2Intent = v2Classification?.intent;
            const v2ConfRaw = v2Classification?.confidence;
            const v2Conf = typeof v2ConfRaw === 'number' ? v2ConfRaw : Number(v2ConfRaw) || 0;
            const v2Broken = !v2Intent || v2Classification?.parseError || v2Classification?.error;
            const v2Items = Array.isArray(v2Classification?.items) ? v2Classification.items : [];
            const hasPriorCtx = !!(priorCtxForV2 && String(priorCtxForV2).trim());
            // Structural checks — catch confidently-wrong outputs the confidence gate misses.
            const structQuoteEmptyItems = v2Intent === 'quote' && v2Items.length === 0;
            const structReviseNoPrior = v2Intent === 'revise' && !hasPriorCtx;
            const structAmbiguousStem = v2Intent === 'quote'
              && v2Items.some(i => i && typeof i.sku === 'string' && AMBIGUOUS_STEM.test(i.sku.trim()));
            const structuralEscalate = structQuoteEmptyItems || structReviseNoPrior || structAmbiguousStem;
            // Weak-intent bucket — only escalate price_lookup when prior_context exists
            // (pronoun/ambiguity territory); bare clarify always benefits from Gemma's
            // second opinion. Both are cheap: Llama resolves clarify in ~2s, so an
            // extra Gemma call is only ~3s added budget.
            const weakHit = (v2Intent === 'price_lookup' && hasPriorCtx) || v2Intent === 'clarify';
            const escalate = v2Broken || v2Conf < LOW_CONF_THRESHOLD || weakHit || structuralEscalate;

            if (escalate) {
              const reason = v2Broken ? 'broken'
                : v2Conf < LOW_CONF_THRESHOLD ? `low-conf(${v2Conf})`
                : structQuoteEmptyItems ? 'struct:quote-empty-items'
                : structReviseNoPrior ? 'struct:revise-no-prior'
                : structAmbiguousStem ? 'struct:ambiguous-sku-stem'
                : weakHit ? `weak:${v2Intent}`
                : 'unknown';
              console.log(`[Waterfall] Escalating to Gemma 4: v2Intent=${v2Intent || 'ERR'} conf=${v2Conf} reason=${reason}`);
              gemma4Classification = await Promise.race([
                classifyWithGemma4(text, priorCtxForV2, env).catch(e => ({ error: e.message })),
                new Promise(resolve => setTimeout(() => resolve({ timeout: true, elapsed: GEMMA_TIMEOUT_MS }), GEMMA_TIMEOUT_MS))
              ]);
              if (gemma4Classification?.timeout) {
                console.log(`[Waterfall] Gemma timed out at ${GEMMA_TIMEOUT_MS}ms, falling back to V2`);
              }
            } else {
              console.log(`[Waterfall] Skipping Gemma: V2 confident (${v2Intent} conf=${v2Conf})`);
            }
          } else {
            // Rollback mode — legacy only on hot path. V2 still shadows for D1
            // parity logging. Gemma is fully disabled in rollback to save $.
            classification = await classifyWithCF(text, env);
            _rollbackShadowPromise = classifyWithCFv2(text, priorCtxForV2, env)
              .catch(e => ({ error: e.message }));
          }
          T.step('wx-cfclassify', 'exit');

          // Shadow logging — non-blocking D1 write. logShadowClassification
          // handles null gemma4 gracefully (writes NULL to gemma4_* columns).
          ctx.waitUntil((async () => {
            try {
              let v2c, g4c;
              if (USE_V2_CLASSIFIER) {
                v2c = v2Classification;
                g4c = gemma4Classification; // null when waterfall skipped escalation
              } else {
                v2c = _rollbackShadowPromise ? await _rollbackShadowPromise : null;
                g4c = null; // Gemma disabled in rollback mode
              }
              if (v2c) console.log(`[Shadow-V2] intent=${v2c.intent || 'ERR'} conf=${v2c.confidence || '?'} (${v2c.elapsed || 0}ms)${v2c.parseError ? ' parseErr=' + v2c.parseError : ''}`);
              if (g4c) console.log(`[Shadow-Gemma4] intent=${g4c.intent || 'ERR'} conf=${g4c.confidence || '?'} (${g4c.elapsed || 0}ms)${g4c.parseError ? ' parseErr=' + g4c.parseError : ''}${g4c.timeout ? ' timeout=true' : ''}`);
              await logShadowClassification(env, {
                personId, requestText: text, priorContext: priorCtxForV2,
                legacy: classification, v2: v2c, gemma4: g4c
              });
            } catch (e) { console.warn('[Shadow] error:', e?.message); }
          })());

          // Select active classification — V2 if valid, legacy otherwise.
          // Gemma can override V2 if it returned successfully AND disagrees with
          // V2 at high confidence. This is the accuracy win: when V2 confidently
          // misroutes (e.g. pronoun cases scoring revise instead of price_lookup),
          // Gemma's second opinion rescues the call.
          let activeClassification = classification; // legacy by default
          const v2Valid = USE_V2_CLASSIFIER
            && v2Classification
            && !v2Classification.parseError
            && !v2Classification.error
            && v2Classification.intent;
          if (v2Valid) {
            // Map V2 schema intent to legacy format for routing compatibility
            activeClassification = {
              intent: v2Classification.intent,
              reply: v2Classification.reply || '',
              extracted: v2Classification.items?.map(i => `${i.qty || 1} ${i.sku}`).join(', ') || '',
              elapsed: v2Classification.elapsed,
              // Preserve V2 rich structure for downstream use
              _v2: v2Classification
            };
            console.log(`[V2-Active] intent=${activeClassification.intent} (V2 ${v2Classification.elapsed}ms / legacy ${classification?.elapsed}ms)`);
          } else if (USE_V2_CLASSIFIER) {
            console.log(`[V2-Fallback] V2 failed (${v2Classification?.error || v2Classification?.parseError || 'null'}), using legacy classifier`);
          }

          // ── Waterfall merge: Gemma overrides V2 on high-conf disagreement ──
          const GEMMA_WIN_CONF = 0.8;
          const gemmaValid = gemma4Classification
            && !gemma4Classification.timeout
            && !gemma4Classification.error
            && !gemma4Classification.parseError
            && gemma4Classification.intent;
          if (gemmaValid) {
            const gemmaConfRaw = gemma4Classification.confidence;
            const gemmaConf = typeof gemmaConfRaw === 'number' ? gemmaConfRaw : Number(gemmaConfRaw) || 0;
            const gemmaIntent = String(gemma4Classification.intent).toLowerCase();
            const activeIntentLower = activeClassification?.intent
              ? String(activeClassification.intent).toLowerCase()
              : null;
            const disagrees = activeIntentLower && gemmaIntent !== activeIntentLower;
            if (gemmaConf >= GEMMA_WIN_CONF && disagrees) {
              const overriddenSource = v2Valid ? 'V2' : 'legacy';
              console.log(`[Waterfall] Gemma overrides ${overriddenSource}: ${activeIntentLower} -> ${gemmaIntent} (gemmaConf=${gemmaConf}, gemmaMs=${gemma4Classification.elapsed})`);
              activeClassification = {
                intent: gemma4Classification.intent,
                reply: gemma4Classification.reply || '',
                extracted: gemma4Classification.items?.map(i => `${i.qty || 1} ${i.sku}`).join(', ') || '',
                elapsed: gemma4Classification.elapsed,
                _gemma: gemma4Classification,
                _v2: v2Valid ? v2Classification : undefined
              };
            } else {
              console.log(`[Waterfall] Gemma agrees or below win threshold: gemmaIntent=${gemmaIntent} conf=${gemmaConf} (keeping ${v2Valid ? 'V2' : 'legacy'}: ${activeIntentLower})`);
            }
          }

          if (activeClassification) {
            console.log(`[CF-First] Intent: ${activeClassification.intent} (${activeClassification.elapsed}ms)`);

            // CF: clarify — ambiguous input needs more info
            if (activeClassification.intent === 'clarify' && activeClassification.reply) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', activeClassification.reply);
              T.step('wx-send', 'enter');
              await sendMessage(roomId, `${activeClassification.reply}\n\n_⚡ Workers AI (${activeClassification.elapsed}ms, free)_`, token);
              T.step('wx-send', 'exit');
              T.step('wx-d1', 'enter');
              logBotUsageToD1(env, { personId, requestText: text, responsePath: 'cf-clarify', durationMs: Date.now() - _wxStartMs }).catch(() => {});
              writeMetric(env, { path: 'cf-clarify', durationMs: Date.now() - _wxStartMs, personId });
              T.step('wx-d1', 'exit');
              ctx.waitUntil(T.flush());
              return;
            }

            // CF: product_info — route to Claude (CF classifies, Claude answers)
            if (activeClassification.intent === 'product_info') {
              console.log(`[CF-First] Product info question, routing to Claude`);
              // Fall through to Claude below — CF identified the intent, Claude provides the answer
            }

            // CF: escalate — complex request needs Claude
            if (activeClassification.intent === 'escalate') {
              console.log(`[CF-Escalate] Complex request, falling through to Claude`);
              // Don't return — fall through to Claude below
            }

            // CF: conversation — casual chat, CF handles directly
            else if (activeClassification.intent === 'conversation') {
              const convoReply = activeClassification.reply && activeClassification.reply.length > 5
                ? activeClassification.reply
                : (await askCFConversation(text, env))?.response;

              if (convoReply) {
                await addToHistory(kv, personId, 'user', text);
                await addToHistory(kv, personId, 'assistant', convoReply);
                T.step('wx-send', 'enter');
                await sendMessage(roomId, `${convoReply}\n\n_⚡ Workers AI (${activeClassification.elapsed}ms, free)_`, token);
                T.step('wx-send', 'exit');
                T.step('wx-d1', 'enter');
                logBotUsageToD1(env, { personId, requestText: text, responsePath: 'cf-conversation', durationMs: Date.now() - _wxStartMs }).catch(() => {});
                writeMetric(env, { path: 'cf-conversation', durationMs: Date.now() - _wxStartMs, personId });
                T.step('wx-d1', 'exit');
                ctx.waitUntil(T.flush());
                return;
              }
            }

            // CF: quote — CF says this is a quote request, execute via deterministic engine
            else if (activeClassification.intent === 'quote') {
              // Use CF's extracted clean text if available, otherwise original text
              const quoteText = activeClassification.extracted || text;
              console.log(`[CF-First] Quote intent, executing deterministic with: ${quoteText}`);

              // ── Step 2: Deterministic engine only runs when CF routes to "quote" ──
              T.step('wx-parse', 'enter');
              // PR 2: Try V2-direct adapter first when V2 classification is present.
              // buildQuoteFromV2 returns a parseMessage-shape object built directly
              // from the V2 rich schema (items[], modifiers, etc.) — preserves item
              // fidelity (modifiers, quantities, license/hardware split) that would
              // otherwise be lost in the extracted-string → parseMessage round-trip.
              // Falls back to parseMessage on null (V2 produced no usable items,
              // e.g. license-only input V2 adapter doesn't handle yet).
              //
              // Per Chris's architectural feedback ("the LLM should figure out the
              // intent itself") the prior NL_OVERRIDE_RE short-circuit for
              // "all duo/umbrella" has been REMOVED. The V2 prompt now carries
              // "all duo/umbrella" expansion + separate_quotes detection as
              // CRITICAL rules with explicit examples. If V2 still misses, the
              // belt-and-suspenders regex inside buildQuoteFromV2 catches
              // separate_quotes phrasing at the adapter layer (not the routing
              // layer) so the renderer gets the right flag.
              let quoteParsed = null;
              if (activeClassification._v2) {
                try {
                  quoteParsed = buildQuoteFromV2(activeClassification._v2, text);
                  if (quoteParsed) {
                    console.log(`[CF-First] V2-direct built parseMessage-shape: ${quoteParsed.items?.length || 0} items, term=${quoteParsed.requestedTerm || 'all'}, tier=${quoteParsed.requestedTier || 'default'}`);
                  }
                } catch (e) {
                  console.warn(`[CF-First] V2-direct adapter failed, falling back to parseMessage: ${e?.message}`);
                  quoteParsed = null;
                }
              }
              // Fallback: if V2 adapter produced nothing, parse the ORIGINAL
              // message text — NOT V2's stripped `extracted` string. The
              // extracted field is just a SKU+qty list (e.g. "1 LIC-DUO-ESSENTIALS-3YR,
              // 1 LIC-DUO-ADVANTAGE-3YR, ...") and loses the NL signals
              // parseMessage relies on ("all duo", "as separate links",
              // "license only", pronoun refs, etc.). Using the original text
              // lets the existing parseMessage NL handlers do their job when
              // the V2 adapter returns null for any reason (short-circuit,
              // hallucinated SKU, pronoun reference, etc.).
              if (!quoteParsed) quoteParsed = parseMessage(text);
              if (quoteParsed) {
                T.step('wx-parse', 'exit', { result: quoteParsed._fromV2 ? 'v2-direct' : 'parsed', items: quoteParsed.items?.length || 0, advisory: quoteParsed.isAdvisory, revision: quoteParsed.isRevision });

                // Clarification responses (Duo/Umbrella tier selection) — instant
                if (quoteParsed.isClarification && quoteParsed.clarificationMessage) {
                  T.step('wx-clarify', 'enter'); T.step('wx-clarify', 'exit');
                  await addToHistory(kv, personId, 'user', text);
                  await addToHistory(kv, personId, 'assistant', quoteParsed.clarificationMessage);
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, quoteParsed.clarificationMessage, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // Revision requests go straight to Claude (needs conversation history)
                if (quoteParsed.isRevision) {
                  T.step('wx-revision', 'enter');
                  const history = await getHistory(kv, personId);
                  if (history.length > 0) {
                    T.step('wx-revision', 'exit', { result: 'has_history' });
                    T.step('wx-claude', 'enter');
                    const claudeReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env);
                    T.step('wx-claude', 'exit');
                    T.step('wx-send', 'enter');
                    await sendMessage(roomId, claudeReply, token);
                    T.step('wx-send', 'exit');
                    ctx.waitUntil(T.flush());
                    return;
                  }
                  T.step('wx-revision', 'exit', { result: 'no_history' });
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // If CF stripped a Wi-Fi category phrase during extraction,
                // re-detect from the original input and merge so the bot
                // still prompts for an AP choice alongside the quote.
                if (quoteText !== text && (!quoteParsed.unresolvedCategories || quoteParsed.unresolvedCategories.length === 0)) {
                  const fromOriginal = parseMessage(text);
                  if (fromOriginal && fromOriginal.unresolvedCategories && fromOriginal.unresolvedCategories.length > 0) {
                    quoteParsed.unresolvedCategories = fromOriginal.unresolvedCategories;
                  }
                }

                // Normal quote — build the response
                const quoteResult = buildQuoteResponse(quoteParsed);
                if (quoteResult.message && !quoteResult.needsLlm) {
                  await addToHistory(kv, personId, 'user', text);
                  await addToHistory(kv, personId, 'assistant', quoteResult.message);
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, `${quoteResult.message}\n\n_⚡ CF-routed deterministic (${activeClassification.elapsed}ms classify, free)_`, token);
                  T.step('wx-send', 'exit');
                  T.step('wx-d1', 'enter');
                  logBotUsageToD1(env, { personId, requestText: text, responsePath: 'cf-deterministic', durationMs: Date.now() - _wxStartMs }).catch(() => {});
                  writeMetric(env, { path: 'cf-deterministic', durationMs: Date.now() - _wxStartMs, personId });
                  T.step('wx-d1', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }
                // Deterministic had errors — pass context to Claude
                if (quoteResult.errors && quoteResult.errors.length > 0) {
                  const errorContext = quoteResult.errors.join('\n');
                  console.log(`[CF-First] Deterministic errors, escalating to Claude: ${errorContext}`);
                  T.step('wx-claude', 'enter');
                  const claudeReply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
                  T.step('wx-claude', 'exit');
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, claudeReply, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }
                // parseMessage returned a result but buildQuoteResponse couldn't produce output.
                // This happens with mixed hw+lic comma input where items=[] and no directLicenseList.
                // Fall through to the SKU validation block below (shared with the null-parse branch).
              }
              // ── Shared: parseMessage returned null OR returned empty/unquotable result ──
              {
                T.step('wx-parse', 'exit', { result: 'no_parse' });

                // ── VISION SKU FOLLOW-UP ──
                // If parseMessage returned null (no SKUs in the text), check if the user
                // recently sent a dashboard screenshot. "quote this" / "quote both" after a
                // vision parse should use the stored SKUs rather than asking for clarification.
                try {
                  const storedVisionSkus = await kv.get(`vision_skus_${personId}`, 'json');
                  if (storedVisionSkus && storedVisionSkus.length > 0) {
                    const visionSkuText = storedVisionSkus.map(s => `${s.qty} ${s.sku}`).join(', ');
                    console.log(`[CF-First] Found ${storedVisionSkus.length} vision SKUs in KV, re-parsing: ${visionSkuText}`);
                    const visionParsed = parseMessage(visionSkuText);
                    if (visionParsed && visionParsed.items.length > 0) {
                      const visionResult = buildQuoteResponse(visionParsed);
                      if (visionResult.message && !visionResult.needsLlm) {
                        await addToHistory(kv, personId, 'user', text);
                        await addToHistory(kv, personId, 'assistant', visionResult.message);
                        T.step('wx-send', 'enter');
                        await sendMessage(roomId, `${visionResult.message}\n\n_⚡ Vision follow-up + Deterministic Quote (${activeClassification.elapsed}ms classify, free)_`, token);
                        T.step('wx-send', 'exit');
                        T.step('wx-d1', 'enter');
                        logBotUsageToD1(env, { personId, requestText: text, responsePath: 'cf-vision-followup-quote', durationMs: Date.now() - _wxStartMs }).catch(() => {});
                        writeMetric(env, { path: 'cf-vision-followup-quote', durationMs: Date.now() - _wxStartMs, personId });
                        T.step('wx-d1', 'exit');
                        // Clear vision SKUs after successful use
                        await kv.delete(`vision_skus_${personId}`);
                        ctx.waitUntil(T.flush());
                        return;
                      }
                    }
                  }
                } catch (_visionErr) {
                  console.warn(`[CF-First] Vision SKU follow-up check failed: ${_visionErr.message}`);
                }
              }
              // ── SKU VALIDATION + SUGGESTIONS ──
              // Before falling to Claude, try to validate raw SKU tokens from the text.
              // This catches typos (CW9172IH → CW9172I) and mixed hw+lic comma input.
              {
                // Prefer the ORIGINAL user text when extracting tokens + qty. The
                // CF classifier's rewritten `extracted` field sometimes drops
                // quantities (e.g. "lic-mv-1yr x 30" → "LIC-MV-1YR"), and rebuilding
                // with just the SKU would silently collapse qty to 1.
                const _rawSourceText = text || quoteText || '';
                const _valText = _rawSourceText.toUpperCase();
                // Extract all SKU-like tokens: hardware models AND license SKUs, and
                // detect an adjacent quantity (either "N SKU", "SKU N", or "SKU x N").
                const _allTokens = [];
                const _hwRe = /\b(\d+)?\s*[xX×]?\s*((?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\d[\w-]*)(?:\s*[xX×]?\s*(\d+))?\b/gi;
                const _licRe = /\b(\d+)?\s*[xX×]?\s*(LIC-[A-Z0-9-]+)(?:\s*[xX×]?\s*(\d+))?\b/gi;
                let _m;
                while ((_m = _hwRe.exec(_valText)) !== null) {
                  const qty = parseInt(_m[1] || _m[3] || '1');
                  _allTokens.push({ sku: _m[2].toUpperCase(), qty, isLicense: false });
                }
                while ((_m = _licRe.exec(_valText)) !== null) {
                  const qty = parseInt(_m[1] || _m[3] || '1');
                  _allTokens.push({ sku: _m[2].toUpperCase(), qty, isLicense: true });
                }
                // Deduplicate by SKU (keep highest qty if same SKU appears twice),
                // then strip -RTG/-MR/-HW suffixes from hardware for catalog lookup.
                const _byKey = new Map();
                for (const t of _allTokens) {
                  const prev = _byKey.get(t.sku);
                  if (!prev || t.qty > prev.qty) _byKey.set(t.sku, t);
                }
                const _cleanTokens = [..._byKey.values()].map(t => ({
                  raw: t.sku,
                  clean: t.isLicense ? t.sku : t.sku.replace(/-(RTG|MR|HW)$/i, ''),
                  isLicense: t.isLicense,
                  qty: t.qty
                }));

                if (_cleanTokens.length > 0) {
                  const _suggestions = [];
                  const _validItems = [];  // array of { raw, qty }
                  for (const tk of _cleanTokens) {
                    if (tk.isLicense) {
                      // License SKUs are valid by nature — pass through with qty
                      _validItems.push({ raw: tk.raw, qty: tk.qty });
                    } else {
                      const val = validateSku(tk.clean);
                      if (val.valid) {
                        _validItems.push({ raw: tk.raw, qty: tk.qty });
                      } else {
                        _suggestions.push({ input: tk.raw, reason: val.reason || `${tk.raw} is not a recognized model`, suggest: val.suggest || [] });
                      }
                    }
                  }

                  // If we have any suggestions or valid items, build a response instead of falling to Claude
                  if (_suggestions.length > 0 || _validItems.length > 0) {
                    let _msg = '';
                    // Show suggestions for invalid SKUs
                    for (const s of _suggestions) {
                      _msg += `⚠️ **${s.input}**: ${s.reason}\n`;
                      if (s.suggest.length > 0) _msg += `Did you mean: ${s.suggest.join(', ')}?\n`;
                      _msg += '\n';
                    }
                    // If we have valid items, try to build a quote for them.
                    // Preserve qty by building "N SKU, N SKU, ..." instead of bare SKU list.
                    if (_validItems.length > 0) {
                      const _validText = _validItems.map(it => `${it.qty} ${it.raw}`).join(', ');
                      const _reParsed = parseMessage(_validText);
                      if (_reParsed) {
                        const _reResult = buildQuoteResponse(_reParsed);
                        if (_reResult.message && !_reResult.needsLlm) {
                          if (_suggestions.length > 0) {
                            _msg += `_The items above were skipped. Quote generated for recognized models below._\n\n`;
                          }
                          _msg += _reResult.message;
                          await addToHistory(kv, personId, 'user', text);
                          await addToHistory(kv, personId, 'assistant', _msg);
                          T.step('wx-send', 'enter');
                          await sendMessage(roomId, `${_msg}\n\n_⚡ Validated + Deterministic (${activeClassification.elapsed}ms classify, free)_`, token);
                          T.step('wx-send', 'exit');
                          ctx.waitUntil(T.flush());
                          return;
                        }
                      }
                    }
                    // If only suggestions (no valid items), show them
                    if (_suggestions.length > 0 && _validItems.length === 0) {
                      _msg += `Please correct the SKUs above and try again.`;
                      await addToHistory(kv, personId, 'user', text);
                      await addToHistory(kv, personId, 'assistant', _msg);
                      T.step('wx-send', 'enter');
                      await sendMessage(roomId, _msg, token);
                      T.step('wx-send', 'exit');
                      ctx.waitUntil(T.flush());
                      return;
                    }
                  }
                }
              }
              // Deterministic couldn't handle CF's extracted quote — fall through to Claude
              console.log('[CF-First] Deterministic couldn\'t execute CF quote intent, falling to Claude');
            }

            // CF: revise — V2 classifier identified a modification to a prior quote.
            // PR 2: when V2 is present, try deterministic revision via applyV2Revision.
            // Falls through to Claude if V2 revision can't be applied (no prior quote,
            // unhandled action, or build error).
            else if (activeClassification.intent === 'revise' && activeClassification._v2) {
              T.step('wx-revise-v2', 'enter');
              console.log(`[CF-First] Revise intent with V2 action=${activeClassification._v2?.modifiers?.action || '?'}`);
              try {
                const history = await getHistory(kv, personId);
                if (!history || history.length === 0) {
                  T.step('wx-revise-v2', 'exit', { result: 'no_history' });
                  // No prior context — tell the user and bail
                  const noHistMsg = `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`;
                  await addToHistory(kv, personId, 'user', text);
                  await addToHistory(kv, personId, 'assistant', noHistMsg);
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, noHistMsg, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // Prefer extracting prior state from the most recent assistant quote
                // URL — this captures the CURRENT state of the quote including any
                // revisions already applied (revise-after-revise chains). Fall back
                // to scanning user messages if no URL is found.
                let priorParsed = null;
                for (let i = history.length - 1; i >= 0; i--) {
                  const msg = history[i];
                  if (msg.role !== 'assistant' || !msg.content) continue;
                  const fromUrl = extractPriorFromAssistantUrl(msg.content);
                  if (fromUrl) {
                    priorParsed = fromUrl;
                    console.log(`[CF-First] Revise: using assistant-URL prior state (items=${priorParsed.items?.length || 0}, term=${priorParsed.requestedTerm}, tier=${priorParsed.requestedTier})`);
                    break;
                  }
                }
                // Fallback: scan user messages for most recent quotable request
                if (!priorParsed) {
                  for (let i = history.length - 1; i >= 0; i--) {
                    const msg = history[i];
                    if (msg.role !== 'user' || !msg.content) continue;
                    const candidate = parseMessage(msg.content);
                    if (candidate && (candidate.items?.length > 0 || candidate.directLicense || candidate.directLicenseList)) {
                      priorParsed = candidate;
                      console.log(`[CF-First] Revise: using user-message prior (parseMessage)`);
                      break;
                    }
                  }
                }

                if (!priorParsed) {
                  T.step('wx-revise-v2', 'exit', { result: 'no_prior_quote' });
                  console.log('[CF-First] Revise: no parseable prior quote in history, falling to Claude');
                  // Let Claude handle it with full history context
                  T.step('wx-claude', 'enter');
                  const claudeReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env);
                  T.step('wx-claude', 'exit');
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, claudeReply, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // Apply the V2 revision
                const revised = applyV2Revision(priorParsed, activeClassification._v2);
                if (!revised) {
                  T.step('wx-revise-v2', 'exit', { result: 'unhandled_action' });
                  console.log('[CF-First] Revise: applyV2Revision returned null (unhandled action), falling to Claude');
                  T.step('wx-claude', 'enter');
                  const claudeReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env);
                  T.step('wx-claude', 'exit');
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, claudeReply, token);
                  T.step('wx-send', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                console.log(`[CF-First] V2 revision applied: ${revised._revised || 'unknown'}, items=${revised.items?.length || 0}`);
                const revisedResult = buildQuoteResponse(revised);
                if (revisedResult.message && !revisedResult.needsLlm) {
                  T.step('wx-revise-v2', 'exit', { result: 'success', action: revised._revised });
                  await addToHistory(kv, personId, 'user', text);
                  await addToHistory(kv, personId, 'assistant', revisedResult.message);
                  T.step('wx-send', 'enter');
                  await sendMessage(roomId, `${revisedResult.message}\n\n_⚡ CF-routed V2 revision (${activeClassification.elapsed}ms classify, free)_`, token);
                  T.step('wx-send', 'exit');
                  T.step('wx-d1', 'enter');
                  logBotUsageToD1(env, { personId, requestText: text, responsePath: 'cf-v2-revise', durationMs: Date.now() - _wxStartMs }).catch(() => {});
                  writeMetric(env, { path: 'cf-v2-revise', durationMs: Date.now() - _wxStartMs, personId });
                  T.step('wx-d1', 'exit');
                  ctx.waitUntil(T.flush());
                  return;
                }

                // buildQuoteResponse wasn't able to render the revised request — fall to Claude
                T.step('wx-revise-v2', 'exit', { result: 'build_failed' });
                console.log('[CF-First] Revise: buildQuoteResponse failed on revised state, falling to Claude');
                T.step('wx-claude', 'enter');
                const fallbackReply = await askClaude(`${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`, personId, env);
                T.step('wx-claude', 'exit');
                T.step('wx-send', 'enter');
                await sendMessage(roomId, fallbackReply, token);
                T.step('wx-send', 'exit');
                ctx.waitUntil(T.flush());
                return;
              } catch (reviseErr) {
                T.step('wx-revise-v2', 'exit', { result: 'error', message: reviseErr?.message });
                console.warn(`[CF-First] V2 revision error, falling to Claude: ${reviseErr?.message}`);
                // Fall through to Claude below (don't return)
              }
            }
          }

          // Full fallback to Claude API (Tier 3)
          // Pass activeClassification so product_info intent triggers the datasheet path
          // even when the narrow wantsLiveDatasheet regex doesn't match (e.g., followups like
          // "get specifics from datasheet" or "what does the datasheet say about ports").
          T.step('wx-claude', 'enter');
          const claudeReply = await askClaude(text, personId, env, null, activeClassification);
          T.step('wx-claude', 'exit');
          T.step('wx-send', 'enter');
          await sendMessage(roomId, claudeReply, token);
          T.step('wx-send', 'exit');
          T.step('wx-d1', 'enter');
          logBotUsageToD1(env, { personId, requestText: text, responsePath: 'claude', durationMs: Date.now() - _wxStartMs }).catch(() => {});
          writeMetric(env, { path: 'claude', durationMs: Date.now() - _wxStartMs, personId });
          T.step('wx-d1', 'exit');
          T.step('wx-history', 'enter'); T.step('wx-history', 'exit');
          ctx.waitUntil(T.flush());

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
          ctx.waitUntil(T.flush());
        }
      })());

      return new Response('OK', { status: 200 });
    }

    // ── Test routing endpoint: simulates full waterfall without sending messages ──
    if (url.pathname === '/test-routing') {
      const input = url.searchParams.get('input');
      if (!input) return new Response(JSON.stringify({ error: 'input required' }), { headers: { 'content-type': 'application/json' } });

      const result = { input, layer: null, response: null, details: {} };
      const startMs = Date.now();

      try {
        // Layer 1: Deterministic — EOL date
        const eolReply = handleEolDateRequest(input);
        if (eolReply) {
          result.layer = 'deterministic-eol';
          result.response = eolReply.substring(0, 300);
          result.details.ms = Date.now() - startMs;
          return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
        }

        // Layer 1: Deterministic — pricing (skip history-dependent part)
        const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?)\b/i.test(input);
        if (pricingIntent) {
          const directSkuMatch = input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
          const singleSkuMatch = !directSkuMatch && input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);
          if (directSkuMatch) {
            const qty = parseInt(directSkuMatch[1]);
            const sku = directSkuMatch[2].toUpperCase();
            const resp = formatPricingResponse(null, [sku], [qty]);
            if (resp) {
              result.layer = 'deterministic-pricing';
              result.response = resp.substring(0, 300);
              result.details = { sku, qty, ms: Date.now() - startMs };
              return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
            }
          }
          // Reverse pattern: "what does [SKU] cost" — SKU before pricing keyword
          const reverseSkuMatch = !directSkuMatch && !singleSkuMatch && input.match(/(?:what|how)\s+(?:does|do|is|would)\s+(?:an?\s+)?(?:the\s+)?(\d+\s+)?([A-Z0-9][-A-Z0-9]+)\s+(?:cost|run|go for|price)/i);
          const pricingSkuMatch = singleSkuMatch || reverseSkuMatch;
          if (pricingSkuMatch && !/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(pricingSkuMatch[reverseSkuMatch ? 2 : 1])) {
            const skuIdx = reverseSkuMatch ? 2 : 1;
            const qtyIdx = reverseSkuMatch ? 1 : null;
            const sku = pricingSkuMatch[skuIdx].toUpperCase();
            const qty = qtyIdx && pricingSkuMatch[qtyIdx] ? parseInt(pricingSkuMatch[qtyIdx]) : 1;
            const resp = formatPricingResponse(null, [sku], [qty]);
            if (resp) {
              result.layer = 'deterministic-pricing';
              result.response = resp.substring(0, 300);
              result.details = { sku, qty, ms: Date.now() - startMs };
              return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
            }
            result.details.pricingSkuAttempt = sku;
          }
        }

        // Pre-check: Deterministic clarifications (Duo/Umbrella tier — instant, free)
        const parsed = parseMessage(input);
        if (parsed && parsed.isClarification && parsed.clarificationMessage) {
          result.layer = 'deterministic-clarify';
          result.response = parsed.clarificationMessage.substring(0, 300);
          result.details.ms = Date.now() - startMs;
          return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
        }

        // CF-FIRST: CF Workers AI classifies intent, deterministic executes quotes
        const classification = await classifyWithCF(input, env);
        if (classification) {
          result.details.cfIntent = classification.intent;
          result.details.cfElapsed = classification.elapsed;
          result.details.cfReply = (classification.reply || '').substring(0, 300);
          result.details.cfExtracted = classification.extracted || '';

          if (classification.intent === 'clarify' && classification.reply) {
            result.layer = 'cf-clarify';
            result.response = classification.reply.substring(0, 300);
            result.details.ms = Date.now() - startMs;
            return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
          }
          if (classification.intent === 'product_info') {
            // CF identified product_info — route to Claude (CF doesn't answer these)
            result.layer = 'claude';
            result.response = '[Product info question routed to Claude by CF]';
            result.details.ms = Date.now() - startMs;
            result.details.productInfoRoute = 'cf-to-claude';
            return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
          }
          if (classification.intent === 'escalate') {
            result.layer = 'claude';
            result.response = '[Escalated to Claude by CF classifier]';
            result.details.ms = Date.now() - startMs;
            result.details.escalateReason = 'cf-escalate';
            return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
          }
          if (classification.intent === 'conversation') {
            const convoReply = classification.reply && classification.reply.length > 5
              ? classification.reply
              : (await askCFConversation(input, env))?.response;
            if (convoReply) {
              result.layer = 'cf-conversation';
              result.response = convoReply.substring(0, 300);
              result.details.ms = Date.now() - startMs;
              return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
            }
          }
          if (classification.intent === 'quote') {
            // CF says quote — execute via deterministic engine
            const quoteText = classification.extracted || input;
            const quoteParsed = parseMessage(quoteText);
            if (quoteParsed && !quoteParsed.isClarification) {
              // If the CF classifier stripped a Wi-Fi category phrase during
              // extraction (e.g., "MX75 with the Wifi 7 AP, and 3 years" →
              // "MX75 3 year"), re-detect from the original input and merge.
              // This ensures the AP clarify prompt fires even when the
              // classifier is terse.
              if (quoteText !== input && (!quoteParsed.unresolvedCategories || quoteParsed.unresolvedCategories.length === 0)) {
                const fromOriginal = parseMessage(input);
                if (fromOriginal && fromOriginal.unresolvedCategories && fromOriginal.unresolvedCategories.length > 0) {
                  quoteParsed.unresolvedCategories = fromOriginal.unresolvedCategories;
                }
              }
              const quoteResult = buildQuoteResponse(quoteParsed);
              if (quoteResult.message && !quoteResult.needsLlm) {
                result.layer = 'cf-deterministic';
                result.response = quoteResult.message.substring(0, 500);
                result.details.ms = Date.now() - startMs;
                return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
              }
              if (quoteResult.errors) {
                result.details.deterministicErrors = quoteResult.errors;
              }
            }
            result.details.cfExtractedButFailed = true;
          }
        } else {
          result.details.cfFailed = true;
        }

        // Fallthrough: Claude API
        result.layer = 'claude';
        result.response = '[Would fall through to Claude API]';
        result.details.ms = Date.now() - startMs;
        return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });

      } catch (err) {
        result.layer = 'error';
        result.response = err.message;
        result.details.ms = Date.now() - startMs;
        return new Response(JSON.stringify(result, null, 2), { headers: { 'content-type': 'application/json' } });
      }
    }

    // ── /api/benchmark-classifier ── POST with {input, prior_context?, model?}
    // Runs the Schema v2 classifier prompt against the named CF Workers AI model
    // via the bound AI gateway (which works with the deployed worker's auth).
    // Used by the offline benchmark runner to A/B Llama vs Gemma vs Hermes.
    if (url.pathname === '/api/benchmark-classifier') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, X-Bench-Key' } });
      if (request.method !== 'POST') return new Response('POST required', { status: 405 });
      const key = request.headers.get('X-Bench-Key') || new URL(request.url).searchParams.get('key');
      if (key !== 'Biscuit4') return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type':'application/json' } });
      try {
        const body = await request.json();
        const input = body.input;
        const priorCtx = body.prior_context || '';
        const model = body.model || '@cf/meta/llama-4-scout-17b-16e-instruct';
        // prompt_variant: "v2" (default, Schema v2 rich output) | "legacy" (CF_CLASSIFIER_PROMPT)
        const promptVariant = (body.prompt_variant || 'v2').toLowerCase();
        if (!input) return new Response(JSON.stringify({ error: 'input required' }), { status: 400, headers: { 'content-type':'application/json' } });
        if (!env.AI) return new Response(JSON.stringify({ error: 'env.AI not bound' }), { status: 500, headers: { 'content-type':'application/json' } });

        // Select system prompt by variant
        const systemPrompt = promptVariant === 'legacy' ? CF_CLASSIFIER_PROMPT : CF_CLASSIFIER_PROMPT_V2;

        const userText = priorCtx ? `Prior assistant context:\n${priorCtx}\n\nUser message:\n${input}` : input;

        const isGemma = /gemma/i.test(model);
        const requestBody = isGemma
          ? { messages: [{ role:'system', content: systemPrompt }, { role:'user', content: userText }], max_completion_tokens: 4096, thinking: { type: 'disabled' } }
          : { messages: [{ role:'system', content: systemPrompt }, { role:'user', content: userText }], max_tokens: 512 };

        const start = Date.now();
        let aiResult, err = null;
        try {
          aiResult = await env.AI.run(model, requestBody);
        } catch (e) { err = e.message; }
        const elapsed = Date.now() - start;

        // Extract response — handle both Llama (.response) and Gemma 4 (.choices[]) formats
        let raw = null, parsed = null, parseError = null;
        if (aiResult) {
          // Try all known response formats (Llama=.response, Gemma4=.choices[].message.content, fallback to reasoning)
          raw = aiResult.response ?? aiResult.choices?.[0]?.message?.content ?? null;
          // Gemma 4 may put content in reasoning field if thinking is enabled
          if ((raw === null || raw === undefined) && aiResult.choices?.[0]?.message?.reasoning) {
            const reasoning = aiResult.choices[0].message.reasoning;
            const jsonInReasoning = reasoning.match(/\{[\s\S]*\}/);
            if (jsonInReasoning) raw = jsonInReasoning[0];
          }
          // Last resort: check result.response
          if (raw === null || raw === undefined) raw = aiResult.result?.response ?? null;
          if (typeof raw === 'object' && raw !== null) { parsed = raw; raw = JSON.stringify(raw); }
          else if (typeof raw === 'string' && !raw.startsWith('__DEBUG_')) {
            try {
              const m = raw.match(/\{[\s\S]*\}/);
              if (m) parsed = JSON.parse(m[0]);
            } catch (e) { parseError = e.message; }
          }
        }

        return new Response(JSON.stringify({ model, prompt_variant: promptVariant, input, elapsed, raw, parsed, parseError, err }), { headers: { 'content-type':'application/json', 'Access-Control-Allow-Origin':'*' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'content-type':'application/json' } });
      }
    }

    // ── /api/benchmark-product-info ── POST with {input, model, prior_context?, want_live_datasheet?, prompt_variant?}
    // Runs the askClaude product_info path against the named model (Claude Sonnet 4.6, Llama 4 Scout,
    // Gemma 4 26B) with identical injected context. Used to A/B whether CF Workers AI can replace
    // Claude for spec-lookup / comparison / advisory questions.
    //
    // Supported model values:
    //   "claude"  → claude-sonnet-4-6 via ANTHROPIC_API_URL
    //   "llama"   → @cf/meta/llama-4-scout-17b-16e-instruct via env.AI
    //   "gemma"   → @cf/google/gemma-4-26b-a4b-it via env.AI
    //
    // Supported prompt_variant values (default: "baseline"):
    //   "baseline" → SYSTEM_PROMPT only (matches production askClaude)
    //   "revised"  → SYSTEM_PROMPT + CF_GROUNDING_RULES (targets Llama/Gemma failure modes)
    if (url.pathname === '/api/benchmark-product-info') {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Access-Control-Allow-Headers':'Content-Type, X-Bench-Key' } });
      if (request.method !== 'POST') return new Response('POST required', { status: 405 });
      const key = request.headers.get('X-Bench-Key') || new URL(request.url).searchParams.get('key');
      if (key !== 'Biscuit4') return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'content-type':'application/json' } });
      try {
        const body = await request.json();
        const input = body.input;
        const modelKey = (body.model || 'claude').toLowerCase();
        const priorCtx = body.prior_context || '';
        const wantLiveDatasheet = !!body.want_live_datasheet;
        const promptVariant = (body.prompt_variant || 'baseline').toLowerCase();
        if (!input) return new Response(JSON.stringify({ error: 'input required' }), { status: 400, headers: { 'content-type':'application/json' } });

        // CF_GROUNDING_RULES is defined at module scope; appended below for prompt_variant='revised'.

        // ── Build injected context identically to askClaude ──
        let systemPrompt = SYSTEM_PROMPT;
        const sources = { liveModels: [], liveUrls: [], fetchFailed: false, cachedModels: [], categoryFamilies: [] };

        if (wantLiveDatasheet) {
          let datasheetContext = await getRelevantDatasheetContext(input);
          if (!datasheetContext && priorCtx) datasheetContext = await getRelevantDatasheetContext(priorCtx);
          if (datasheetContext) {
            systemPrompt += '\n\n' + datasheetContext.text;
            systemPrompt += '\n\nThe user requested live datasheet verification. Use the live datasheet content above as the authoritative source.';
            sources.liveModels.push(...(datasheetContext.models || []));
            sources.liveUrls.push(...(datasheetContext.urls || []));
          } else {
            sources.fetchFailed = true;
            const staticContext = getStaticSpecsContext(priorCtx || input);
            if (staticContext) {
              systemPrompt += '\n\n' + staticContext.text;
              sources.cachedModels.push(...(staticContext.models || []));
            }
          }
        } else {
          const staticContext = getStaticSpecsContext(input);
          let categoryContext = null;
          let categoryFamilies = [];
          if (!staticContext) {
            const catUpper = input.toUpperCase();
            const families = [];
            if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push('MX');
            if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push('MR', 'CW');
            if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push('MS130', 'MS150');
            if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push('MV');
            if (/\b(SENSOR)\b/.test(catUpper)) families.push('MT');
            if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push('MG');
            if (families.length > 0) {
              let ctx = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE)\n';
              ctx += 'Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n';
          ctx += 'FORMATTING: Webex does NOT render pipe-delimited markdown tables ("| col | col |") — they show as literal pipes. For multi-model comparisons use grouped bullets under a bolded model header, not tables.\n\n';
              for (const fam of families) {
                const familyData = specs[fam];
                if (familyData) {
                  for (const [model, modelSpecs] of Object.entries(familyData)) {
                    ctx += `${model}: ${JSON.stringify(modelSpecs)}\n`;
                  }
                }
              }
              categoryContext = ctx;
              categoryFamilies = families;
            }
          }
          if (staticContext) {
            systemPrompt += '\n\n' + staticContext.text;
            sources.cachedModels.push(...(staticContext.models || []));
          } else if (categoryContext) {
            systemPrompt += '\n\n' + categoryContext;
            sources.categoryFamilies.push(...categoryFamilies);
          }
        }

        // Pricing + accessories injection (same as askClaude)
        const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(input);
        if (pricingIntent) {
          const priceContext = getRelevantPriceContext(input, []);
          if (priceContext) systemPrompt += '\n\n' + priceContext;
        }
        const accessoriesContext = getAccessoriesContext(input);
        if (accessoriesContext) systemPrompt += '\n\n' + accessoriesContext;

        // Append CF grounding rules for revised variant (appears AFTER injected context so the
        // model sees the specs/pricing/datasheet block first, then the rules that reference it)
        if (promptVariant === 'revised') systemPrompt += CF_GROUNDING_RULES;

        // Build messages — prior_context becomes a fake prior assistant turn for followup tests
        const messages = [];
        if (priorCtx) messages.push({ role: 'assistant', content: priorCtx });
        messages.push({ role: 'user', content: input });

        // ── Run target model ──
        const start = Date.now();
        let reply = null, err = null, rawResult = null;

        if (modelKey === 'claude') {
          if (!env.ANTHROPIC_API_KEY) return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not bound' }), { status: 500, headers: { 'content-type':'application/json' } });
          try {
            const resp = await fetch(ANTHROPIC_API_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
              body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: 1024, system: systemPrompt, messages })
            });
            if (!resp.ok) {
              err = `Anthropic ${resp.status}: ${await resp.text()}`;
            } else {
              const data = await resp.json();
              rawResult = data;
              reply = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
            }
          } catch (e) { err = e.message; }
        } else if (modelKey === 'llama') {
          if (!env.AI) return new Response(JSON.stringify({ error: 'env.AI not bound' }), { status: 500, headers: { 'content-type':'application/json' } });
          try {
            const result = await env.AI.run('@cf/meta/llama-4-scout-17b-16e-instruct', {
              messages: [{ role: 'system', content: systemPrompt }, ...messages],
              max_tokens: 1024
            });
            rawResult = result;
            reply = result?.response ?? result?.choices?.[0]?.message?.content ?? null;
          } catch (e) { err = e.message; }
        } else if (modelKey === 'gemma') {
          if (!env.AI) return new Response(JSON.stringify({ error: 'env.AI not bound' }), { status: 500, headers: { 'content-type':'application/json' } });
          try {
            const result = await env.AI.run('@cf/google/gemma-4-26b-a4b-it', {
              messages: [{ role: 'system', content: systemPrompt }, ...messages],
              max_completion_tokens: 2048,
              thinking: { type: 'disabled' }
            });
            rawResult = result;
            reply = result?.choices?.[0]?.message?.content ?? result?.response ?? null;
          } catch (e) { err = e.message; }
        } else {
          return new Response(JSON.stringify({ error: `unknown model "${modelKey}" — use claude|llama|gemma` }), { status: 400, headers: { 'content-type':'application/json' } });
        }

        const elapsed = Date.now() - start;
        return new Response(JSON.stringify({
          model: modelKey,
          prompt_variant: promptVariant,
          input,
          elapsed,
          reply,
          sources,
          system_prompt_chars: systemPrompt.length,
          err
        }, null, 2), { headers: { 'content-type':'application/json', 'Access-Control-Allow-Origin':'*' } });
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message, stack: e.stack }), { status: 500, headers: { 'content-type':'application/json' } });
      }
    }

    return new Response('Not Found', { status: 404 });
  }
};
