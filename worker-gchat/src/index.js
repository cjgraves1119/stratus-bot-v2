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
const ANTHROPIC_API_DIRECT = 'https://api.anthropic.com/v1/messages'; // Fallback when gateway fails

// ─── Cloudflare Workflows (durable execution for CRM agentic loops) ─────────
import { WorkflowEntrypoint } from 'cloudflare:workers';

// ─── Data Imports (embedded at build time by wrangler) ──────────────────────
import pricesData from './data/prices.json';
import catalogData from './data/auto-catalog.json';
import specsData from './data/specs.json';
import accessoriesData from './data/accessories.json';

const staticPrices = pricesData.prices;
let livePrices = null;       // KV-cached prices (refreshed daily by cron)
let livePricesCacheTs = 0;   // When we last read from KV (ms)
const LIVE_PRICES_CACHE_TTL = 300000; // 5 minutes in-memory cache

// Load live prices from KV (if available). Cached in-memory per isolate.
// Accepts env object — uses PRICES_KV (preferred) or CONVERSATION_KV as fallback.
async function loadLivePrices(env) {
  const kv = env?.PRICES_KV || env?.CONVERSATION_KV || env;
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
    // For live prices, check the KV cache first
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});

// ─── API Usage Tracking ─────────────────────────────────────────────────────
// Pricing per 1M tokens (USD) by model
const MODEL_PRICING = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-3-5-sonnet-20241022': { input: 3.00, output: 15.00 },
  'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },
};

/**
 * Track API usage from a Claude response.
 * Stores per-request log entry and updates monthly totals in KV.
 * @param {Object} env - Worker env with KV bindings
 * @param {string} model - Model name used
 * @param {Object} usage - { input_tokens, output_tokens } from API response
 * @param {string} source - Where the call originated (e.g. 'gchat', 'addon-analyze', 'addon-draft', 'crm-agent')
 */
async function trackUsage(env, model, usage, source) {
  if (!usage || !env?.CONVERSATION_KV) return;
  try {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['claude-sonnet-4-20250514'];
    const inputCost = (usage.input_tokens / 1_000_000) * pricing.input;
    const outputCost = (usage.output_tokens / 1_000_000) * pricing.output;
    const totalCost = inputCost + outputCost;

    const now = new Date();
    const monthKey = `usage_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;

    // Read current monthly totals
    var monthly = await env.CONVERSATION_KV.get(monthKey, 'json') || {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
      bySource: {},
      recentRequests: []
    };

    // Update totals
    monthly.totalInputTokens += usage.input_tokens;
    monthly.totalOutputTokens += usage.output_tokens;
    monthly.totalCostUsd += totalCost;
    monthly.requestCount += 1;

    // Track by source
    if (!monthly.bySource[source]) {
      monthly.bySource[source] = { requests: 0, costUsd: 0, inputTokens: 0, outputTokens: 0 };
    }
    monthly.bySource[source].requests += 1;
    monthly.bySource[source].costUsd += totalCost;
    monthly.bySource[source].inputTokens += usage.input_tokens;
    monthly.bySource[source].outputTokens += usage.output_tokens;

    // Keep last 50 requests for detail view
    monthly.recentRequests.unshift({
      ts: now.toISOString(),
      model,
      source,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      costUsd: Math.round(totalCost * 1_000_000) / 1_000_000
    });
    if (monthly.recentRequests.length > 50) {
      monthly.recentRequests = monthly.recentRequests.slice(0, 50);
    }

    // Write back with 90-day TTL (keeps ~3 months of history)
    await env.CONVERSATION_KV.put(monthKey, JSON.stringify(monthly), { expirationTtl: 90 * 86400 });
    // ── D1: Write to bot_usage table (fire-and-forget) ──
    if (env.ANALYTICS_DB) {
      try {
        await env.ANALYTICS_DB.prepare(
          `INSERT INTO bot_usage (bot, person_id, response_path, model, input_tokens, output_tokens, cost_usd, duration_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          source.startsWith('addon') ? 'addon' : 'gchat',
          null, // person_id filled by caller if available
          source === 'crm-agent' ? 'crm_agent' : (source.includes('addon') ? 'claude' : 'claude'),
          model,
          usage.input_tokens || 0,
          usage.output_tokens || 0,
          Math.round(totalCost * 1_000_000) / 1_000_000,
          null
        ).run();
      } catch (d1Err) {
        console.error('[D1] bot_usage insert error:', d1Err.message);
      }
    }

  } catch (err) {
    console.error('[USAGE] tracking error:', err.message);
  }
}

// ── D1 Analytics Helpers ────────────────────────────────────────────────────
// Fire-and-forget inserts into stratus-bot-analytics D1 database.
// All functions are safe to call without await (non-blocking).

/**
 * Log a quote to D1 quote_history table.
 */
async function logQuoteToD1(env, { bot, personId, accountName, skus, totalList, totalEcomm, quoteUrl, responseType, eolWarnings, durationMs }) {
  if (!env?.ANALYTICS_DB) return;
  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO quote_history (bot, person_id, account_name, skus, total_list, total_ecomm, quote_url, response_type, eol_warnings, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      bot || 'gchat',
      personId || null,
      accountName || null,
      JSON.stringify(skus || []),
      totalList || null,
      totalEcomm || null,
      quoteUrl || null,
      responseType || 'deterministic',
      eolWarnings ? JSON.stringify(eolWarnings) : null,
      durationMs || null
    ).run();
  } catch (err) {
    console.error('[D1] quote_history insert error:', err.message);
  }
}

/**
 * Log a CRM operation to D1 crm_operations table.
 */
async function logCrmOpToD1(env, { personId, operation, module, recordId, recordName, status, durationMs, errorMessage, details }) {
  if (!env?.ANALYTICS_DB) return;
  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO crm_operations (person_id, operation, module, record_id, record_name, status, duration_ms, error_message, details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      personId || null,
      operation,
      module || null,
      recordId || null,
      recordName || null,
      status,
      durationMs || null,
      errorMessage || null,
      details ? JSON.stringify(details) : null
    ).run();
  } catch (err) {
    console.error('[D1] crm_operations insert error:', err.message);
  }
}

/**
 * Log a price change to D1 pricing_history table.
 */
async function logPriceChangeToD1(env, { sku, oldPrice, newPrice, listPrice }) {
  if (!env?.ANALYTICS_DB) return;
  const change = (newPrice || 0) - (oldPrice || 0);
  const changePct = oldPrice ? (change / oldPrice) * 100 : 0;
  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO pricing_history (sku, old_price, new_price, list_price, price_change, change_pct)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(sku, oldPrice || null, newPrice || null, listPrice || null, change, Math.round(changePct * 100) / 100).run();
  } catch (err) {
    console.error('[D1] pricing_history insert error:', err.message);
  }
}

/**
 * Log a bot interaction to D1 bot_usage table (for non-Claude paths like deterministic).
 */
async function logBotUsageToD1(env, { bot, personId, requestText, responsePath, model, inputTokens, outputTokens, costUsd, durationMs, errorMessage }) {
  if (!env?.ANALYTICS_DB) return;
  try {
    await env.ANALYTICS_DB.prepare(
      `INSERT INTO bot_usage (bot, person_id, request_text, response_path, model, input_tokens, output_tokens, cost_usd, duration_ms, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      bot || 'gchat',
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

// ── Analytics Engine: Real-time telemetry ────────────────────────────────────
// Writes high-frequency data points for latency, cost, and throughput tracking.
// Schema:
//   blobs[0] = bot ('webex'|'gchat'|'addon')
//   blobs[1] = response_path ('deterministic'|'claude'|'crm_agent'|'pricing'|'error')
//   blobs[2] = model (e.g. 'claude-sonnet-4-20250514' or 'none')
//   doubles[0] = duration_ms
//   doubles[1] = input_tokens
//   doubles[2] = output_tokens
//   doubles[3] = cost_usd
//   indexes[0] = person_id (sampling key)
function writeMetric(env, { bot, path, model, durationMs, inputTokens, outputTokens, costUsd, personId }) {
  if (!env?.BOT_METRICS) return;
  try {
    env.BOT_METRICS.writeDataPoint({
      blobs: [bot || 'gchat', path || 'unknown', model || 'none'],
      doubles: [durationMs || 0, inputTokens || 0, outputTokens || 0, costUsd || 0],
      indexes: [personId || 'anonymous']
    });
  } catch (_) {} // Never block on metrics
}

// ── R2 Object Storage Helpers ───────────────────────────────────────────────
// Store and retrieve files (quote PDFs, attachments, reports) in R2.
// All operations are fire-and-forget safe — failures never block bot responses.

/**
 * Store a file in R2. Returns the key on success, null on failure.
 * @param {object} env - Worker env with BOT_STORAGE binding
 * @param {string} key - Object key (e.g. 'quotes/Q-00123.pdf')
 * @param {ArrayBuffer|string|ReadableStream} data - File content
 * @param {object} [opts] - R2 put options (httpMetadata, customMetadata, etc.)
 */
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

/**
 * Retrieve a file from R2. Returns { data, httpMetadata, customMetadata } or null.
 */
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

/**
 * Delete a file from R2.
 */
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

/**
 * List objects in R2 under a prefix.
 * @param {string} prefix - Key prefix (e.g. 'quotes/')
 * @param {number} [limit=100] - Max objects to return
 */
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
    // Strip image data from content before storing — images are large (MB of base64)
    // and cause API errors when replayed from history. Replace with a text placeholder.
    let storable = content;
    if (Array.isArray(content)) {
      // Content is multimodal (image + text array from vision requests)
      const textParts = content
        .filter(c => c.type === 'text')
        .map(c => c.text);
      const hasImage = content.some(c => c.type === 'image');
      storable = (hasImage ? '[User sent an image] ' : '') + textParts.join(' ');
    }

    let data = await kv.get(`conv:${personId}`, 'json');
    if (!data) data = { messages: [] };
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

  // If there's an active CRM session, let the CRM agent handle this "yes" confirmation
  const crmSession = await kv.get(`crm_session_${personId}`);
  if (crmSession) return null;

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
  // CRITICAL: If the last assistant message is from a CRM workflow (contains Zoho URLs,
  // mentions ecomm/discount, or references Zoho/CRM), NEVER intercept — let the CRM agent
  // handle the follow-up. Without this, "yes" after a CRM quote creation gets hijacked
  // into URL quotes because the assistant message mentions SKUs + "Would you like".
  if (/crm\.zoho\.com|ecomm|discount|zoho|crm\b|deal\s*id|velocity\s*hub/i.test(lastAssistant)) return null;
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

// ─── Message Parser ──────────────────────────────────────────────────────────
function parseMessage(text) {
  // Pre-process: convert written-out numbers to digits
  text = convertWordNumbers(text);
  const upper = text.toUpperCase();

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
  // "licenses for [SKU]" or "renewal [SKU]" implies license-only (renewal scenario)
  // But NOT "MX67 with 3 year license" — that's hardware + license
  if (!modifiers.licenseOnly && /\b(LICENSE[S]?\s+FOR\s+(AN?\s+)?(\d+\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)\d|RENEWAL[S]?\s+(OF\s+|FOR\s+)?(\d+\s*)?(MR|MS|MX|MV|MT|MG|CW|Z)\d)/.test(upper)) {
    modifiers.licenseOnly = true;
  }
  // "[SKU] license" or "[SKU] renewal" at end of short input (e.g. "mr44 license", "5 MR44 renewal")
  // Also matches family-only like "mr license". Requires ^ anchor to avoid matching full sentences.
  // But NOT "[SKU] with X year license" (hardware + license)
  if (!modifiers.licenseOnly && /^(QUOTE\s+)?(\d+\s+)?(MR|MS|MX|MV|MT|MG|CW|Z)\d*[A-Z0-9-]*\s+(LICENSE[S]?|RENEWAL[S]?)\s*$/i.test(upper.trim()) && !/\bWITH\b/.test(upper)) {
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

  // ── Duo natural language handler ──
  // License-only product (no hardware). If tier is specified, return URLs directly.
  // If tier is NOT specified, prompt the user to choose (Essentials/Advantage/Premier).
  const isDuo = /\b(?:DUO|CISCO\s*DUO)\b/i.test(upper);
  if (isDuo && !isAdvisory) {
    // Extract tier and qty with explicit checks (avoids regex group-shifting bugs)
    let duoTier = null;
    if (/ADVANTAGE/i.test(upper)) duoTier = 'ADVANTAGE';
    else if (/PREMIER/i.test(upper)) duoTier = 'PREMIER';
    else if (/ESSENTIAL/i.test(upper)) duoTier = 'ESSENTIALS';
    const duoQtyMatch = upper.match(/\b(\d+)\b/);
    const duoQty = duoQtyMatch ? parseInt(duoQtyMatch[1]) : 1;

    if (!duoTier) {
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
    return {
      items: [
        { baseSku: `LIC-DUO-${duoTier}-1YR`, qty: duoQty, isLicenseOnly: true },
        { baseSku: `LIC-DUO-${duoTier}-3YR`, qty: duoQty, isLicenseOnly: true },
        { baseSku: `LIC-DUO-${duoTier}-5YR`, qty: duoQty, isLicenseOnly: true }
      ],
      isQuote: true,
      isTermOptionQuote: true
    };
  }

  // ── Umbrella natural language handler ──
  // License-only product. If type+tier specified, return URLs directly.
  // If missing, prompt user to choose type (DNS/SIG) and tier (Essentials/Advantage).
  const isUmb = /\b(?:UMBRELLA|UMB)\b/i.test(upper);
  if (isUmb && !isAdvisory) {
    // Extract type, tier, qty with explicit checks
    let umbType = null;
    if (/\bSIG\b/i.test(upper)) umbType = 'SIG';
    else if (/\bDNS\b/i.test(upper)) umbType = 'DNS';
    let umbTier = null;
    if (/ADV(?:ANCED)?/i.test(upper)) umbTier = 'ADV';
    else if (/ESS(?:ENTIALS?)?/i.test(upper)) umbTier = 'ESS';
    const umbQtyMatch = upper.match(/\b(\d+)\b/);
    const umbQty = umbQtyMatch ? parseInt(umbQtyMatch[1]) : 1;

    if (!umbType || !umbTier) {
      let prompt = `Which Umbrella package do you need? (qty: ${umbQty})\n\n`;
      if (!umbType) {
        prompt += `**Type:**\n• **DNS Security** — DNS-layer protection\n• **SIG** (Secure Internet Gateway) — full web proxy + DNS\n\n`;
      }
      if (!umbTier) {
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
    return {
      items: [
        { baseSku: `LIC-UMB-${umbType}-${umbTier}-K9-1YR`, qty: umbQty, isLicenseOnly: true },
        { baseSku: `LIC-UMB-${umbType}-${umbTier}-K9-3YR`, qty: umbQty, isLicenseOnly: true },
        { baseSku: `LIC-UMB-${umbType}-${umbTier}-K9-5YR`, qty: umbQty, isLicenseOnly: true }
      ],
      isQuote: true,
      isTermOptionQuote: true
    };
  }

  // ── Model-agnostic license handler (MR, MV, MT) ──
  // These families use a single license SKU regardless of specific model.
  // "MR license", "5 MV licenses", "quote MT renewal", "licenses for MR", etc.
  // The model doesn't matter — all MR use LIC-ENT, all MV use LIC-MV, all MT use LIC-MT.
  let agnosticFamily = null;
  let agnosticQty = 1;
  let _m;

  // Pattern A: "5 MR licenses", "10 MV renewal" (qty before family)
  _m = upper.match(/(\d+)\s*[X×]?\s*(MR|MV|MT)\s+(LICENSE|LIC|RENEWAL)S?/i);
  if (_m) { agnosticQty = parseInt(_m[1]); agnosticFamily = _m[2].toUpperCase(); }

  // Pattern B: "MR license", "MV licenses", "MT renewal", "quote MR license" (no qty)
  if (!agnosticFamily) {
    _m = upper.trim().match(/^(?:QUOTE\s+)?(MR|MV|MT)\s+(LICENSE|LIC|RENEWAL)S?\s*$/i);
    if (_m) { agnosticFamily = _m[1].toUpperCase(); }
  }

  // Pattern C: "MR licenses 5", "MT renewal 10" (qty after keyword)
  if (!agnosticFamily) {
    _m = upper.match(/(MR|MV|MT)\s+(LICENSE|LIC|RENEWAL)S?\s*[X×]?\s*(\d+)/i);
    if (_m) { agnosticFamily = _m[1].toUpperCase(); agnosticQty = parseInt(_m[3]); }
  }

  // Pattern D: "licenses for MR", "renewal for MV" (keyword before family)
  if (!agnosticFamily) {
    _m = upper.trim().match(/^(?:QUOTE\s+)?(LICENSE|LIC|RENEWAL)S?\s+(?:FOR\s+)?(MR|MV|MT)\s*$/i);
    if (_m) { agnosticFamily = _m[2].toUpperCase(); }
  }

  // Pattern E: "5 MR", "10 MV" (qty + family only, if licenseOnly modifier already set)
  if (!agnosticFamily && modifiers.licenseOnly) {
    _m = upper.trim().match(/^(?:QUOTE\s+)?(\d+)\s*[X×]?\s*(MR|MV|MT)\s*(ENT(?:ERPRISE)?)?$/i);
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
  if (parsed.isTermOptionQuote && parsed.items) {
    const termGroups = { '1YR': [], '3YR': [], '5YR': [] };
    for (const item of parsed.items) {
      const termMatch = item.baseSku.match(/(\d)YR?$/i);
      if (termMatch) {
        const key = `${termMatch[1]}YR`;  // normalize 1Y → 1YR key
        if (termGroups[key]) termGroups[key].push({ sku: item.baseSku, qty: item.qty });
      }
    }
    const lines = [];
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
    trackUsage(env, 'claude-sonnet-4-20250514', data.usage, 'email-parse').catch(() => {});
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

/**
 * Update an existing Google Chat message (PATCH).
 * Used for progress indicators — edit the "thinking" message in-place.
 * @param {string} messageName - e.g. "spaces/AAAAxyz/messages/abc123"
 * @param {string} text - updated message text
 * @param {object} env - worker env with secrets
 */
async function updateGChatMessage(messageName, text, env) {
  const token = await getGoogleChatBotToken(env);
  const url = `https://chat.googleapis.com/v1/${messageName}?updateMask=text`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  const resBody = await res.text();
  if (!res.ok) {
    console.warn(`[GCHAT-ASYNC] Failed to update message: ${res.status} ${resBody.substring(0, 300)} | textLen=${text.length}`);
    try {
      if (env.CONVERSATION_KV) {
        await env.CONVERSATION_KV.put(`update_err_${Date.now()}`, JSON.stringify({
          status: res.status, error: resBody.substring(0, 500), textLen: text.length,
          textPreview: text.substring(0, 200), ts: new Date().toISOString()
        }), { expirationTtl: 3600 });
      }
    } catch (_) {}
  } else {
    // Store success diagnostic to confirm PATCH actually worked
    try {
      if (env.CONVERSATION_KV) {
        const parsed = JSON.parse(resBody);
        await env.CONVERSATION_KV.put(`debug_update_ok_${Date.now()}`, JSON.stringify({
          messageName, textLen: text.length, textPreview: text.substring(0, 200),
          responseTextLen: (parsed.text || '').length, responseTextPreview: (parsed.text || '').substring(0, 200),
          ts: new Date().toISOString()
        }), { expirationTtl: 3600 });
      }
    } catch (_) {}
  }
  return res.ok;
}

/**
 * Download an image attachment from Google Chat using the media API.
 * Google Chat attachments have a resourceName that can be fetched via
 * the Media API: GET https://chat.googleapis.com/v1/media/{resourceName}?alt=media
 *
 * @param {object} attachment - Google Chat attachment object
 * @param {object} env - worker env
 * @returns {object|null} - { base64, mediaType } or null
 */
async function downloadGChatImage(attachment, env) {
  // Claude only accepts these media types for vision
  const VALID_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  /**
   * Normalize a content-type to one Claude accepts.
   * Google Chat sometimes returns generic types like 'application/octet-stream'.
   */
  function normalizeMediaType(raw, fileName) {
    const ct = (raw || '').split(';')[0].trim().toLowerCase();
    if (VALID_IMAGE_TYPES.includes(ct)) return ct;

    // Infer from file extension
    const ext = (fileName || '').split('.').pop().toLowerCase();
    const extMap = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
    if (extMap[ext]) return extMap[ext];

    // Infer from attachment's declared contentType (may differ from response header)
    const attCt = (attachment.contentType || '').split(';')[0].trim().toLowerCase();
    if (VALID_IMAGE_TYPES.includes(attCt)) return attCt;

    // Default to PNG for screenshots (most common from mobile/desktop)
    console.warn(`[GCHAT-IMG] Unknown media type "${ct}" (ext="${ext}"), defaulting to image/png`);
    return 'image/png';
  }

  try {
    const token = await getGoogleChatBotToken(env);
    const fileName = attachment.name || attachment.contentName || '';

    // Google Chat provides attachmentDataRef.resourceName for downloadable attachments
    const resourceName = attachment.attachmentDataRef?.resourceName;
    if (!resourceName) {
      console.warn('[GCHAT-IMG] No resourceName in attachment:', JSON.stringify(attachment).substring(0, 200));

      // Fallback: try downloadUri if present
      if (attachment.downloadUri) {
        const res = await fetch(attachment.downloadUri, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return null;
        const rawCt = res.headers.get('content-type') || '';
        const mediaType = normalizeMediaType(rawCt, fileName);
        const arrayBuffer = await res.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        return { base64: btoa(binary), mediaType };
      }
      return null;
    }

    // Use the Media API to download the attachment content
    const mediaUrl = `https://chat.googleapis.com/v1/media/${resourceName}?alt=media`;
    const res = await fetch(mediaUrl, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      console.error(`[GCHAT-IMG] Media download failed: ${res.status}`);
      return null;
    }

    const rawCt = res.headers.get('content-type') || '';
    const mediaType = normalizeMediaType(rawCt, fileName);
    const arrayBuffer = await res.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);

    console.log(`[GCHAT-IMG] Downloaded image: ${mediaType} (raw: ${rawCt}), ${bytes.length} bytes`);
    return { base64: btoa(binary), mediaType };
  } catch (err) {
    console.error(`[GCHAT-IMG] Download error: ${err.message}`);
    return null;
  }
}

/**
 * Extract image attachments from a Google Chat event.
 * Returns the first image attachment data or null.
 */
async function extractImageFromEvent(event, env) {
  const msg = event.message || event.chat?.messagePayload?.message;
  if (!msg?.attachment || !Array.isArray(msg.attachment)) return null;

  for (const att of msg.attachment) {
    const ct = (att.contentType || '').toLowerCase();
    if (ct.startsWith('image/')) {
      console.log(`[GCHAT-IMG] Found image attachment: ${ct}, name=${att.name || 'unnamed'}`);
      return await downloadGChatImage(att, env);
    }
  }
  return null;
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
  // v8 (not v2) — v2 omits subform data (Quoted_Items, Invoiced_Items, etc.)
  const url = `https://www.zohoapis.com/crm/v8/${path}`;
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
// ── Reverse lookup: product_id → SKU (built once from static keys, used by discount correction) ──
// Maps Zoho product IDs to their SKU strings so we can use the Proxy-based `prices[sku]`
// accessor (which checks live KV prices first, then falls back to static prices.json).
let _productIdToSku = null;
function getProductIdToSkuMap() {
  if (_productIdToSku) return _productIdToSku;
  _productIdToSku = {};
  // Use staticPrices (not Proxy) for key enumeration, but we'll look up via Proxy later
  for (const [sku, data] of Object.entries(staticPrices)) {
    if (data?.zoho_product_id) {
      _productIdToSku[data.zoho_product_id] = sku;
    }
  }
  console.log(`[DISCOUNT-FIX] Built product_id→SKU reverse map: ${Object.keys(_productIdToSku).length} entries`);
  return _productIdToSku;
}

// ── Server-side discount correction for Quoted_Items ──
// Prevents Claude from applying hallucinated discount percentages.
// For each line item with a Product_Name.id, looks up the correct discount_per_unit
// from live KV prices (via Proxy) and replaces whatever Claude set. Delete markers
// (_delete: null) and items without Product_Name are left untouched.
function correctQuotedItemDiscounts(quotedItems) {
  if (!Array.isArray(quotedItems)) return;
  const idMap = getProductIdToSkuMap();
  let corrected = 0;
  for (const item of quotedItems) {
    // Skip delete markers and modify-only items (no Product_Name = qty change only)
    if (item._delete !== undefined || !item.Product_Name?.id) continue;
    const qty = item.Quantity || 1;
    const productId = item.Product_Name.id;
    // Reverse lookup: product_id → SKU → live price data (via Proxy: KV first, static fallback)
    const sku = idMap[productId];
    if (!sku) continue;
    const liveData = prices[sku]; // Goes through Proxy → checks livePrices (KV) first
    if (!liveData?.discount_per_unit) continue;
    const correctDiscount = liveData.discount_per_unit * qty;
    if (item.Discount !== undefined && Math.abs(item.Discount - correctDiscount) > 1) {
      console.log(`[DISCOUNT-FIX] ${sku} (${productId}): Claude set Discount=${item.Discount}, correcting to ${correctDiscount} (discount_per_unit=${liveData.discount_per_unit} × qty=${qty})`);
      item.Discount = correctDiscount;
      corrected++;
    } else if (item.Discount === undefined) {
      // Claude didn't set a discount at all — apply ecomm default
      console.log(`[DISCOUNT-FIX] ${sku} (${productId}): No Discount set, applying ecomm default ${correctDiscount}`);
      item.Discount = correctDiscount;
      corrected++;
    }
  }
  if (corrected > 0) {
    console.log(`[DISCOUNT-FIX] Corrected ${corrected}/${quotedItems.length} line items`);
  }
}

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
    // Server-side Closing_Date enforcement: correct past/invalid dates
    if (data.Closing_Date) {
      const parsedDate = new Date(data.Closing_Date + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(parsedDate.getTime()) || parsedDate < today) {
        const corrected = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        console.log(`[VALIDATE] Closing_Date "${data.Closing_Date}" is past/invalid, correcting to ${corrected}`);
        data.Closing_Date = corrected;
      }
    }
    // Auto-fill defaults for commonly skipped fields
    if (!data.Meraki_ISR && isCreate) data.Meraki_ISR = { id: '2570562000027286729' }; // Stratus Sales
    if (!data.Owner) data.Owner = { id: '2570562000141711002' }; // Chris Graves
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
    // Server-side Valid_Till enforcement: if Claude passes a past date or invalid date,
    // override with today + 30 days. LLMs frequently miscalculate dates.
    if (data.Valid_Till) {
      const parsedDate = new Date(data.Valid_Till + 'T00:00:00');
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (isNaN(parsedDate.getTime()) || parsedDate < today) {
        const corrected = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
        console.log(`[VALIDATE] Valid_Till "${data.Valid_Till}" is past/invalid, correcting to ${corrected}`);
        data.Valid_Till = corrected;
      }
    } else {
      // Missing Valid_Till — set default
      data.Valid_Till = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
    }
    // Auto-fill commonly skipped fields with safe defaults
    if (!data.Cisco_Billing_Term) data.Cisco_Billing_Term = 'Prepaid Term';
    if (!data.Shipping_Country) data.Shipping_Country = data.Billing_Country || 'US';
    if (!data.Owner) data.Owner = { id: '2570562000141711002' };
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

        // ── INTERCEPT: Redirect Products module lookups through batch cache ──
        // When Claude searches Products by Product_Code, resolve from prices.json cache instead.
        // This eliminates unnecessary Zoho API calls (~2-3s each) for SKUs already in the cache.
        if (module_name === 'Products' && criteria) {
          const equalsMatch = criteria.match(/Product_Code:equals:([A-Z0-9\-]+)/i);
          const startsWithMatch = !equalsMatch && criteria.match(/Product_Code:starts_with:([A-Z0-9\-]+)/i);

          if (equalsMatch) {
            const sku = equalsMatch[1].toUpperCase();
            const suffixed = applySuffix(sku);
            const cached = prices[suffixed] || prices[sku] || null;
            if (cached?.zoho_product_id) {
              console.log(`[INTERCEPT] Products search for ${sku} → cache hit (${cached.zoho_product_id})`);
              return {
                data: [{
                  id: cached.zoho_product_id,
                  Product_Code: suffixed,
                  Product_Name: suffixed,
                  Unit_Price: cached.list || null,
                  Product_Active: true,
                  _from_cache: true,
                  ecomm_price: cached.price || null,
                  discount_per_unit: cached.discount_per_unit || 0,
                  discount_pct: cached.discount_pct || 0
                }],
                info: { count: 1, more_records: false },
                _cache_note: `Resolved from prices.json cache (zero API calls). Use batch_product_lookup for multiple SKUs.`
              };
            }
            // Not in cache — fall through to normal API search
            console.log(`[INTERCEPT] Products search for ${sku} → not in cache, falling through to API`);
          }

          if (startsWithMatch) {
            const prefix = startsWithMatch[1].toUpperCase();
            // Find all matching SKUs in cache
            const matches = Object.entries(prices)
              .filter(([k, v]) => k.startsWith(prefix) && v?.zoho_product_id)
              .map(([k, v]) => ({
                id: v.zoho_product_id,
                Product_Code: k,
                Product_Name: k,
                Unit_Price: v.list || null,
                Product_Active: true,
                _from_cache: true,
                ecomm_price: v.price || null,
                discount_per_unit: v.discount_per_unit || 0,
                discount_pct: v.discount_pct || 0
              }));
            if (matches.length > 0) {
              console.log(`[INTERCEPT] Products starts_with ${prefix} → ${matches.length} cache hits`);
              return {
                data: matches,
                info: { count: matches.length, more_records: false },
                _cache_note: `Resolved ${matches.length} SKUs from prices.json cache (zero API calls). Use batch_product_lookup for better performance.`
              };
            }
            // No cache hits — fall through to API
            console.log(`[INTERCEPT] Products starts_with ${prefix} → no cache hits, falling through to API`);
          }
        }

        // ── INTERCEPT: Redirect WooProducts lookups through batch cache ──
        if (module_name === 'WooProducts' && criteria) {
          const wooMatch = criteria.match(/WooProduct_Code:equals:([A-Z0-9\-]+)/i);
          if (wooMatch) {
            const sku = wooMatch[1].toUpperCase();
            const suffixed = applySuffix(sku);
            const cached = prices[suffixed] || prices[sku] || null;
            if (cached?.price) {
              console.log(`[INTERCEPT] WooProducts search for ${sku} → cache hit (ecomm: $${cached.price})`);
              return {
                data: [{
                  WooProduct_Code: suffixed,
                  Stratus_Price: cached.price,
                  Product_Name: suffixed,
                  _from_cache: true
                }],
                info: { count: 1, more_records: false },
                _cache_note: `Resolved from prices.json cache (zero API calls). Use batch_product_lookup for multiple SKUs.`
              };
            }
          }
        }

        const params = new URLSearchParams();
        if (criteria) params.set('criteria', criteria);
        // Default fields per module to reduce response size (saves 2-3s per iteration)
        const defaultFields = {
          Accounts: 'id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code',
          Contacts: 'id,First_Name,Last_Name,Email,Phone,Account_Name',
          Deals: 'id,Deal_Name,Stage,Amount,Closing_Date,Account_Name,Contact_Name,Owner',
          Products: 'id,Product_Name,Product_Code,Unit_Price,Description',
          WooProducts: 'id,WooProduct_Code,Stratus_Price,Product_Name',
          Quotes: 'id,Subject,Quote_Number,Grand_Total,Deal_Name,Stage',
          Tasks: 'id,Subject,Status,Due_Date,What_Id,Who_Id,Description'
        };
        params.set('fields', fields || defaultFields[module_name] || '');
        if (page) params.set('page', String(page));
        if (per_page) params.set('per_page', String(per_page));
        const searchResult = await zohoApiCall('GET', `${module_name}/search?${params}`, env);

        // AUTO-EXPAND: For Quote searches, automatically fetch full details of the first result
        // including Quoted_Items (line items). This eliminates the need for a separate get_record
        // call, reducing agentic loop from 3 iterations to 2.
        // IMPORTANT: Do NOT use ?fields= parameter — Zoho CRM v2 API strips subform data
        // (Quoted_Items) when fields are specified. Fetch full record instead.
        if (module_name === 'Quotes') {
          try {
            const parsed = typeof searchResult === 'string' ? JSON.parse(searchResult) : searchResult;
            if (parsed?.data?.length > 0) {
              const firstId = parsed.data[0].id;
              const expanded = await zohoApiCall('GET', `Quotes/${firstId}`, env);
              const expandedParsed = typeof expanded === 'string' ? JSON.parse(expanded) : expanded;
              if (expandedParsed?.data?.[0]) {
                // Extract only the fields Claude needs to keep payload manageable
                const full = expandedParsed.data[0];
                const slim = {
                  id: full.id,
                  Subject: full.Subject,
                  Quote_Number: full.Quote_Number,
                  Account_Name: full.Account_Name,
                  Deal_Name: full.Deal_Name,
                  Grand_Total: full.Grand_Total,
                  Sub_Total: full.Sub_Total,
                  Quote_Stage: full.Quote_Stage,
                  Valid_Till: full.Valid_Till,
                  Created_Time: full.Created_Time,
                  Contact_Name: full.Contact_Name,
                  Billing_Street: full.Billing_Street,
                  Billing_City: full.Billing_City,
                  Billing_State: full.Billing_State,
                  Billing_Code: full.Billing_Code,
                  Billing_Country: full.Billing_Country,
                  Shipping_Street: full.Shipping_Street,
                  Shipping_City: full.Shipping_City,
                  Shipping_State: full.Shipping_State,
                  Shipping_Code: full.Shipping_Code,
                  Shipping_Country: full.Shipping_Country,
                  Cisco_Billing_Term: full.Cisco_Billing_Term,
                  Net_Terms: full.Net_Terms,
                  Source: full.Source,
                  // Admin Action + quote-to-PO workflow fields
                  CCW_Deal_Number: full.CCW_Deal_Number,
                  Admin_Action: full.Admin_Action,
                  Cisco_Estimate_Status: full.Cisco_Estimate_Status,
                  Cisco_Quote_Status: full.Cisco_Quote_Status,
                  Delinquency_Score: full.Delinquency_Score,
                  Owner: full.Owner,
                  Tax: full.Tax,
                  Adjustment: full.Adjustment,
                  Discount: full.Discount,
                  Modified_Time: full.Modified_Time,
                  // Quoted_Items: slim down each line item to essential fields
                  // NOTE: id + product_id are REQUIRED for updates — Zoho rejects without item IDs
                  // and product_id is needed to build the Product_Name object for unchanged items
                  Quoted_Items: (full.Quoted_Items || []).map(item => ({
                    id: item.id,
                    product_id: item.Product_Name?.id,
                    Sequence_Number: item.Sequence_Number,
                    Description: item.Description,
                    Product_Code: item.Product_Name?.Product_Code,
                    Product_Name: item.Product_Name?.name,
                    Quantity: item.Quantity,
                    List_Price: item.List_Price,
                    unit_price: item.unit_price,
                    Discount: item.Discount,
                    Total: item.Total,
                    Tax: item.Tax,
                    Net_Total: item.Net_Total
                  })),
                  _auto_expanded: true,
                  _line_item_count: (full.Quoted_Items || []).length
                };
                parsed.data[0] = { ...parsed.data[0], ...slim };
                return JSON.stringify(parsed);
              }
            }
          } catch (expandErr) {
            console.log('[GCHAT] Quote auto-expand failed, returning search results only:', expandErr.message);
          }
        }

        return searchResult;
      }

      case 'zoho_get_record': {
        const { module_name, record_id, fields } = toolInput;
        // For Quotes: Do NOT use ?fields= parameter — Zoho CRM v2 API strips subform data
        // (Quoted_Items) when fields are specified. Fetch full record and slim it down.
        if (module_name === 'Quotes') {
          const fullResult = await zohoApiCall('GET', `${module_name}/${record_id}`, env);
          try {
            const parsed = typeof fullResult === 'string' ? JSON.parse(fullResult) : fullResult;
            if (parsed?.data?.[0]) {
              const full = parsed.data[0];
              parsed.data[0] = {
                id: full.id,
                Subject: full.Subject,
                Quote_Number: full.Quote_Number,
                Account_Name: full.Account_Name,
                Deal_Name: full.Deal_Name,
                Contact_Name: full.Contact_Name,
                Grand_Total: full.Grand_Total,
                Sub_Total: full.Sub_Total,
                Quote_Stage: full.Quote_Stage,
                Valid_Till: full.Valid_Till,
                Created_Time: full.Created_Time,
                Billing_Street: full.Billing_Street,
                Billing_City: full.Billing_City,
                Billing_State: full.Billing_State,
                Billing_Code: full.Billing_Code,
                Billing_Country: full.Billing_Country,
                Shipping_Street: full.Shipping_Street,
                Shipping_City: full.Shipping_City,
                Shipping_State: full.Shipping_State,
                Shipping_Code: full.Shipping_Code,
                Shipping_Country: full.Shipping_Country,
                Cisco_Billing_Term: full.Cisco_Billing_Term,
                Net_Terms: full.Net_Terms,
                Source: full.Source,
                // Admin Action fields — needed for DID generation and quote-to-PO workflow
                CCW_Deal_Number: full.CCW_Deal_Number,
                Admin_Action: full.Admin_Action,
                Cisco_Estimate_Status: full.Cisco_Estimate_Status,
                Cisco_Quote_Status: full.Cisco_Quote_Status,
                Quoted_Items: (full.Quoted_Items || []).map(item => ({
                  id: item.id,
                  product_id: item.Product_Name?.id,
                  Sequence_Number: item.Sequence_Number,
                  Description: item.Description,
                  Product_Code: item.Product_Name?.Product_Code,
                  Product_Name: item.Product_Name?.name,
                  Quantity: item.Quantity,
                  List_Price: item.List_Price,
                  unit_price: item.unit_price,
                  Discount: item.Discount,
                  Total: item.Total,
                  Tax: item.Tax,
                  Net_Total: item.Net_Total
                })),
                _line_item_count: (full.Quoted_Items || []).length
              };
              return JSON.stringify(parsed);
            }
          } catch (slimErr) {
            console.log('[GCHAT] Quote slim-down failed, returning full result:', slimErr.message);
          }
          return fullResult;
        }
        // Non-Quote modules: use fields param if provided
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
        // Auto-correct Quoted_Items discounts using prices.json (prevents Claude from applying wrong discounts)
        if (module_name === 'Quotes' && recordData.Quoted_Items) {
          correctQuotedItemDiscounts(recordData.Quoted_Items);
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
        // Auto-correct Quoted_Items discounts using prices.json (prevents Claude from applying wrong discounts)
        if (module_name === 'Quotes' && data.Quoted_Items) {
          correctQuotedItemDiscounts(data.Quoted_Items);
        }
        // Debug: log what we're sending (especially useful for Quoted_Items updates)
        if (module_name === 'Quotes' && data.Quoted_Items) {
          console.log(`[GCHAT] Quote update payload — record_id: ${record_id}, item_count: ${data.Quoted_Items.length}`);
          console.log(`[GCHAT] First item sample:`, JSON.stringify(data.Quoted_Items[0]));
        }
        const updateResult = await zohoApiCall('PUT', `${module_name}/${record_id}`, env, { data: [data] });
        if (module_name === 'Quotes') {
          console.log(`[GCHAT] Quote update response:`, JSON.stringify(updateResult)?.substring(0, 500));
        }
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

      // ── Batch Product Lookup (optimized: uses embedded product IDs from prices.json) ──
      case 'batch_product_lookup': {
        const { skus } = toolInput;
        const batchResults = {};
        let cacheHits = 0;
        let apiLookups = 0;
        const lookupPromises = skus.map(async (entry) => {
          const rawSku = (typeof entry === 'string' ? entry : entry.sku).trim().toUpperCase();
          const qty = (typeof entry === 'object' ? entry.qty : 1) || 1;
          const suffixed = applySuffix(rawSku);
          // Get cached price data (live KV → static prices.json via Proxy)
          const cachedPrice = prices[suffixed] || null;
          // If prices.json has zoho_product_id, skip the API call entirely
          if (cachedPrice?.zoho_product_id) {
            cacheHits++;
            const result = {
              suffixed_sku: suffixed,
              qty,
              product_id: cachedPrice.zoho_product_id,
              product_name: suffixed,
              list_price: cachedPrice.list || null,
              ecomm_price: cachedPrice.price || null,
              discount_per_unit: cachedPrice.discount_per_unit || 0,
              discount_pct: cachedPrice.discount_pct || 0,
              product_active: true,
              found: true
            };
            // For hardware SKUs, suggest associated license SKUs so Claude doesn't need mapping knowledge
            if (!rawSku.startsWith('LIC-')) {
              const licOptions = getLicenseSkus(rawSku);
              if (licOptions?.length) {
                result.suggested_licenses = licOptions.map(l => l.sku);
              }
            }
            batchResults[rawSku] = result;
            return;
          }
          // Fallback: API lookup for SKUs without embedded product IDs (~19 legacy SKUs)
          apiLookups++;
          try {
            const prodResult = await zohoApiCall('GET',
              `Products/search?criteria=(Product_Code:equals:${encodeURIComponent(suffixed)})&fields=id,Product_Code,Product_Name,Unit_Price`,
              env
            );
            const records = prodResult?.data || [];
            const match = records.find(r => r.Product_Code === suffixed);
            const apiResult = {
              suffixed_sku: suffixed,
              qty,
              product_id: match?.id || null,
              product_name: match?.Product_Name || suffixed,
              list_price: cachedPrice?.list || match?.Unit_Price || null,
              ecomm_price: cachedPrice?.price || null,
              discount_per_unit: cachedPrice?.discount_per_unit || 0,
              discount_pct: cachedPrice?.discount_pct || 0,
              found: !!match
            };
            if (!rawSku.startsWith('LIC-')) {
              const licOptions = getLicenseSkus(rawSku);
              if (licOptions?.length) {
                apiResult.suggested_licenses = licOptions.map(l => l.sku);
              }
            }
            batchResults[rawSku] = apiResult;
          } catch (e) {
            batchResults[rawSku] = { suffixed_sku: suffixed, qty, error: e.message, found: false };
          }
        });
        await Promise.all(lookupPromises);
        console.log(`[BATCH-LOOKUP] ${cacheHits} cache hits, ${apiLookups} API lookups for ${skus.length} SKUs`);
        return {
          success: true,
          products: batchResults,
          count: Object.keys(batchResults).length,
          cacheHits,
          apiLookups,
          pricing_instruction: 'For Quoted_Items: set Product_Name.id = product_id, Quantity, Discount = discount_per_unit * Quantity (flat dollar amount off). Do NOT set unit_price or Description — keep line items minimal for speed.'
        };
      }

      // ── Parse Stratus Quote URL into ordered line items with cached product IDs ──
      case 'parse_quote_url': {
        const { url } = toolInput;
        try {
          const urlObj = new URL(url);
          const itemParam = urlObj.searchParams.get('item') || '';
          const qtyParam = urlObj.searchParams.get('qty') || '';
          const rawSkus = itemParam.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
          const rawQtys = qtyParam.split(',').map(s => parseInt(s) || 1);

          if (rawSkus.length === 0) {
            return { success: false, error: 'No SKUs found in URL. Expected ?item=SKU1,SKU2&qty=1,2 format.' };
          }

          // Separate hardware and license SKUs
          const hwItems = [];
          const licItems = [];
          for (let i = 0; i < rawSkus.length; i++) {
            const sku = rawSkus[i];
            const qty = rawQtys[i] || 1;
            if (sku.startsWith('LIC-')) {
              licItems.push({ sku, qty });
            } else {
              hwItems.push({ sku, qty });
            }
          }

          // Build hardware→license association map
          // License SKU patterns: LIC-ENT-*, LIC-{MXmodel}-SEC-*, LIC-{MSmodel}-*, LIC-C{model}-*, LIC-MV-*, LIC-MT-*, LIC-MG{model}-*, LIC-Z{model}-*
          function matchLicenseToHardware(licSku, hwList) {
            const lic = licSku.toUpperCase();
            // Enterprise AP license → matches MR* and CW* hardware
            if (/^LIC-ENT-/.test(lic)) {
              return hwList.find(h => /^(MR|CW9)\d/.test(h.sku));
            }
            // MX security/SDW license → match by MX model number
            const mxMatch = lic.match(/^LIC-(MX\d+[A-Z]*)-/);
            if (mxMatch) {
              const mxModel = mxMatch[1];
              return hwList.find(h => {
                const hwBase = h.sku.replace(/-HW(-NA)?$/, '');
                return hwBase === mxModel;
              });
            }
            // C9300/C9200/C8xxx license → match by model in license SKU
            const catMatch = lic.match(/^LIC-(C\d+[A-Z]*)-(\d+[A-Z]*)-/);
            if (catMatch) {
              const catFamily = catMatch[1]; // e.g., C9300
              const catPort = catMatch[2];   // e.g., 24E, 48E
              // Try exact port count match first (24E→24P, 48E→48P)
              const portNum = catPort.match(/^(\d+)/)?.[1];
              const exactMatch = hwList.find(h => h.sku.startsWith(catFamily) && h.sku.includes(`-${portNum}`));
              if (exactMatch) return exactMatch;
              // Fallback to family match
              return hwList.find(h => h.sku.startsWith(catFamily));
            }
            // MS license
            const msMatch = lic.match(/^LIC-(MS\d+[A-Z]*)-/);
            if (msMatch) {
              const msModel = msMatch[1];
              return hwList.find(h => h.sku.startsWith(msModel));
            }
            // MV/MT/MG/Z license
            const otherMatch = lic.match(/^LIC-(M[VTG]\d*|Z\d+[A-Z]*)-/);
            if (otherMatch) {
              const model = otherMatch[1];
              return hwList.find(h => h.sku.startsWith(model));
            }
            return null;
          }

          // Build ordered list: hardware → its license(s) → next hardware → its license(s)
          const orderedItems = [];
          const usedLicenses = new Set();
          const hwWithLicenses = hwItems.map(hw => {
            const matchedLics = licItems.filter((lic, idx) => {
              if (usedLicenses.has(idx)) return false;
              const match = matchLicenseToHardware(lic.sku, [hw]);
              if (match) {
                usedLicenses.add(idx);
                return true;
              }
              return false;
            });
            return { hw, licenses: matchedLics };
          });

          // Add items in order: hw → license → hw → license...
          for (const { hw, licenses } of hwWithLicenses) {
            orderedItems.push({ sku: hw.sku, qty: hw.qty, type: 'hardware' });
            for (const lic of licenses) {
              orderedItems.push({ sku: lic.sku, qty: lic.qty, type: 'license' });
            }
          }
          // Append any unmatched licenses at the end
          for (let i = 0; i < licItems.length; i++) {
            if (!usedLicenses.has(i)) {
              orderedItems.push({ sku: licItems[i].sku, qty: licItems[i].qty, type: 'license', unmatched: true });
            }
          }

          // Resolve all product IDs from cache
          let cacheHits = 0;
          let apiNeeded = 0;
          const resolvedItems = orderedItems.map(item => {
            const suffixed = applySuffix(item.sku);
            const cached = prices[suffixed] || prices[item.sku] || null;
            if (cached?.zoho_product_id) {
              cacheHits++;
              return {
                ...item,
                suffixed_sku: suffixed,
                product_id: cached.zoho_product_id,
                list_price: cached.list || null,
                ecomm_price: cached.price || null,
                discount_per_unit: cached.discount_per_unit || 0,
                discount_pct: cached.discount_pct || 0,
                found: true
              };
            }
            apiNeeded++;
            return { ...item, suffixed_sku: suffixed, found: false };
          });

          console.log(`[PARSE-URL] ${rawSkus.length} SKUs parsed, ${orderedItems.length} ordered items, ${cacheHits} cache hits, ${apiNeeded} need API`);

          return {
            success: true,
            items: resolvedItems,
            total_items: resolvedItems.length,
            cache_hits: cacheHits,
            api_needed: apiNeeded,
            pricing_instruction: 'For each item in Quoted_Items: set Product_Name.id = product_id, Quantity = qty, Discount = discount_per_unit * qty (flat dollar amount). Do NOT set unit_price or Description. Items are already in correct hardware→license display order — use this exact order in the Quoted_Items array.'
          };
        } catch (e) {
          return { success: false, error: `Failed to parse URL: ${e.message}` };
        }
      }

      // ── Compound: Create Deal + Quote in One Shot ──
      case 'create_deal_and_quote': {
        const { account_name, contact_name, contact_email, deal_name, skus, license_term, lead_source, billing_address } = toolInput;
        const results = { steps: [], errors: [], records: {} };
        const _startMs = Date.now();

        try {
          // STEP 1: Find or create Account
          let accountId = null;
          let accountData = null;
          const acctSearch = await zohoApiCall('GET',
            `Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(account_name)})&fields=id,Account_Name,Billing_Street,Billing_City,Billing_State,Billing_Code,Billing_Country,Phone,Website`,
            env);
          if (acctSearch?.data?.[0]) {
            accountData = acctSearch.data[0];
            accountId = accountData.id;
            results.steps.push(`Found Account: ${accountData.Account_Name} (${accountId})`);
          } else {
            // Create new account
            const newAcct = await zohoApiCall('POST', 'Accounts', env, {
              data: [{ Account_Name: account_name, Owner: { id: '2570562000141711002' } }]
            });
            if (newAcct?.data?.[0]?.details?.id) {
              accountId = newAcct.data[0].details.id;
              results.steps.push(`Created Account: ${account_name} (${accountId})`);
            } else {
              results.errors.push('Failed to create Account');
              return { success: false, ...results, wall_ms: Date.now() - _startMs };
            }
          }
          results.records.account = { id: accountId, name: account_name, url: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${accountId}` };

          // STEP 2: Find Contact
          let contactId = null;
          if (contact_name || contact_email) {
            const contactCriteria = contact_email
              ? `(Email:equals:${encodeURIComponent(contact_email)})`
              : `(Account_Name:equals:${encodeURIComponent(account_name)})`;
            const contactSearch = await zohoApiCall('GET',
              `Contacts/search?criteria=${contactCriteria}&fields=id,Full_Name,Email&per_page=5`, env);
            if (contactSearch?.data?.[0]) {
              contactId = contactSearch.data[0].id;
              results.steps.push(`Found Contact: ${contactSearch.data[0].Full_Name || contact_name} (${contactId})`);
            }
          } else {
            // Search account contacts
            const acctContacts = await zohoApiCall('GET',
              `Contacts/search?criteria=(Account_Name:equals:${encodeURIComponent(account_name)})&fields=id,Full_Name,Email&per_page=3`, env);
            if (acctContacts?.data?.[0]) {
              contactId = acctContacts.data[0].id;
              results.steps.push(`Found Contact on Account: ${acctContacts.data[0].Full_Name} (${contactId})`);
            } else {
              results.steps.push('No contact found on Account (quote will be created without contact)');
            }
          }
          if (contactId) {
            results.records.contact = { id: contactId, url: `https://crm.zoho.com/crm/org647122552/tab/Contacts/${contactId}` };
          }

          // STEP 3: Resolve ALL products from cache using getLicenseSkus for auto-license
          // Accept hardware SKUs (MX68, MS130-12X) and auto-add matching licenses.
          // Also accept explicit license SKUs if passed.
          const resolvedProducts = [];
          const missingProducts = [];
          const defaultTerm = license_term || '1';

          function resolveFromCache(sku) {
            const suffixed = applySuffix(sku);
            return prices[suffixed] || prices[sku] || null;
          }

          // Collect SKUs needing product IDs, then batch-resolve via API
          const pendingProducts = []; // {suffixed, qty, cached} waiting for product ID

          function stageProduct(sku, qty) {
            const suffixed = applySuffix(sku);
            const cached = prices[suffixed] || prices[sku] || null;
            console.log(`[COMPOUND] stageProduct: sku=${sku} suffixed=${suffixed} hasPid=${!!cached?.zoho_product_id} hasPrice=${!!cached?.price}`);
            if (cached) {
              pendingProducts.push({ suffixed, qty, cached, hasPid: !!cached.zoho_product_id });
              return true;
            }
            return false;
          }

          // Build ordered pairs: hardware → license, hardware → license
          // For SKUs sharing the same license (e.g., multiple APs), group hardware first then totaled licenses
          const orderedPairs = []; // [{hw: sku, hwQty, licSku, licQty}]
          const licenseQtyMap = {}; // licenseSku → total qty (for grouping shared licenses)
          const licenseToHardware = {}; // licenseSku → [hwSku1, hwSku2, ...]

          console.log(`[COMPOUND] Input SKUs: ${JSON.stringify(skus)}`);
          for (const entry of skus) {
            const rawSku = (typeof entry === 'string' ? entry : entry.sku).trim().toUpperCase();
            const qty = (typeof entry === 'object' ? entry.qty : 1) || 1;
            console.log(`[COMPOUND] Processing: rawSku=${rawSku} qty=${qty} isLicense=${rawSku.startsWith('LIC-')}`);

            // If it's already a license SKU, just resolve it directly
            if (rawSku.startsWith('LIC-')) {
              if (!stageProduct(rawSku, qty)) {
                missingProducts.push(rawSku);
              }
              continue;
            }

            // It's a hardware SKU — stage the hardware
            if (!stageProduct(rawSku, qty)) {
              missingProducts.push(rawSku);
              continue;
            }

            // Auto-add matching license using getLicenseSkus
            const licenseOptions = getLicenseSkus(rawSku);
            console.log(`[COMPOUND] getLicenseSkus(${rawSku}): ${licenseOptions ? JSON.stringify(licenseOptions[0]) : 'null'}`);
            let resolvedLicSku = null;
            if (licenseOptions) {
              const termMap = { '1': '1Y', '3': '3Y', '5': '5Y' };
              const targetTerm = termMap[defaultTerm] || '1Y';
              const licenseSku = licenseOptions.find(l => l.term === targetTerm)?.sku;
              if (licenseSku) {
                if (!stageProduct(licenseSku, qty)) {
                  const altSku = licenseSku.endsWith('Y') && !licenseSku.endsWith('YR')
                    ? licenseSku + 'R'
                    : licenseSku.replace(/YR$/, 'Y');
                  if (!stageProduct(altSku, qty)) {
                    missingProducts.push(licenseSku);
                  } else {
                    resolvedLicSku = altSku;
                  }
                } else {
                  resolvedLicSku = licenseSku;
                }
              }
            }

            // Track license grouping
            if (resolvedLicSku) {
              const suffixedLic = applySuffix(resolvedLicSku);
              licenseQtyMap[suffixedLic] = (licenseQtyMap[suffixedLic] || 0) + qty;
              if (!licenseToHardware[suffixedLic]) licenseToHardware[suffixedLic] = [];
              licenseToHardware[suffixedLic].push(rawSku);
            }
            orderedPairs.push({ hw: applySuffix(rawSku), hwQty: qty, licSku: resolvedLicSku ? applySuffix(resolvedLicSku) : null });
          }

          // STEP 3b: Batch-resolve product IDs for staged products
          // Products with cached zoho_product_id are ready. Others need one API call each.
          // Run all API lookups in parallel for speed.
          const apiLookupPromises = pendingProducts.map(async (p) => {
            if (p.hasPid) {
              // Already have product ID from live KV cache — use precalculated discount fields
              resolvedProducts.push({
                sku: p.suffixed, qty: p.qty,
                product_id: p.cached.zoho_product_id,
                list_price: p.cached.list || null,
                ecomm_price: p.cached.price || null,
                discount_per_unit: p.cached.discount_per_unit || 0,
                discount_pct: p.cached.discount_pct || 0
              });
              return;
            }
            // Need to fetch product ID from Zoho Products API
            console.log(`[COMPOUND] API lookup for ${p.suffixed} (no cached product ID)`);
            try {
              const prodResult = await zohoApiCall('GET',
                `Products/search?criteria=(Product_Code:equals:${encodeURIComponent(p.suffixed)})&fields=id,Product_Code,Product_Name,Unit_Price`, env);
              const match = prodResult?.data?.find(r => r.Product_Code === p.suffixed);
              if (match) {
                resolvedProducts.push({
                  sku: p.suffixed, qty: p.qty,
                  product_id: match.id,
                  list_price: p.cached.list || match.Unit_Price || null,
                  ecomm_price: p.cached.price || null,
                  discount_per_unit: p.cached.discount_per_unit || 0,
                  discount_pct: p.cached.discount_pct || 0
                });
              } else {
                console.log(`[COMPOUND] API lookup returned no match for ${p.suffixed}`);
                missingProducts.push(p.suffixed);
              }
            } catch (e) {
              console.log(`[COMPOUND] API lookup error for ${p.suffixed}: ${e.message}`);
              missingProducts.push(p.suffixed);
            }
          });
          await Promise.all(apiLookupPromises);
          results.steps.push(`Resolved ${resolvedProducts.length}/${skus.length} products from cache` +
            (missingProducts.length ? ` (missing: ${missingProducts.join(', ')})` : ''));

          // STEP 3c: Reorder resolved products — hardware then license underneath
          // For shared licenses (e.g., multiple APs using LIC-ENT-*), list all hardware first, then license with totaled qty
          const resolvedMap = {};
          for (const p of resolvedProducts) {
            resolvedMap[p.sku] = p;
          }
          const orderedResolved = [];
          const addedLicenses = new Set();

          // Check which licenses are shared across multiple hardware SKUs
          const sharedLicenses = new Set();
          for (const [licSku, hwList] of Object.entries(licenseToHardware)) {
            if (hwList.length > 1) sharedLicenses.add(licSku);
          }

          // First pass: add hardware → unique license pairs
          for (const pair of orderedPairs) {
            if (resolvedMap[pair.hw]) {
              orderedResolved.push(resolvedMap[pair.hw]);
            }
            // Add license right after hardware ONLY if it's not shared
            if (pair.licSku && !sharedLicenses.has(pair.licSku) && !addedLicenses.has(pair.licSku) && resolvedMap[pair.licSku]) {
              orderedResolved.push(resolvedMap[pair.licSku]);
              addedLicenses.add(pair.licSku);
            }
          }

          // Second pass: add shared licenses at the end with totaled quantities
          for (const licSku of sharedLicenses) {
            if (!addedLicenses.has(licSku) && resolvedMap[licSku]) {
              const totalQty = licenseQtyMap[licSku] || resolvedMap[licSku].qty;
              orderedResolved.push({ ...resolvedMap[licSku], qty: totalQty });
              addedLicenses.add(licSku);
            }
          }

          // Add any remaining products not yet in the ordered list (explicit license SKUs passed by user)
          for (const p of resolvedProducts) {
            if (!orderedResolved.find(o => o.sku === p.sku)) {
              orderedResolved.push(p);
            }
          }

          // Replace resolvedProducts with ordered version
          resolvedProducts.length = 0;
          resolvedProducts.push(...orderedResolved);

          // STEP 4: Build SKU description for deal name (hardware only for cleaner name)
          const skuSummary = orderedPairs.map(p => `${p.hwQty > 1 ? p.hwQty + 'x ' : ''}${p.hw}`).join(', ');
          const closingDate = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];

          // STEP 5: Create Deal
          const dealData = {
            Deal_Name: deal_name || `${account_name} - ${skuSummary}`,
            Account_Name: { id: accountId },
            Stage: 'Qualification',
            Lead_Source: lead_source || 'Stratus Referal',
            Meraki_ISR: { id: '2570562000027286729' },
            Owner: { id: '2570562000141711002' },
            Closing_Date: closingDate
          };
          if (contactId) dealData.Contact_Name = { id: contactId };

          const dealResult = await zohoApiCall('POST', 'Deals', env, { data: [dealData] });
          const dealId = dealResult?.data?.[0]?.details?.id;
          if (!dealId) {
            results.errors.push('Failed to create Deal: ' + JSON.stringify(dealResult?.data?.[0]));
            return { success: false, ...results, wall_ms: Date.now() - _startMs };
          }
          results.steps.push(`Created Deal: ${dealData.Deal_Name} (${dealId})`);
          results.records.deal = { id: dealId, name: dealData.Deal_Name, url: `https://crm.zoho.com/crm/org647122552/tab/Deals/${dealId}` };

          // STEP 6: Create Quote with line items
          const billingAddr = billing_address || {
            street: accountData?.Billing_Street || '',
            city: accountData?.Billing_City || '',
            state: accountData?.Billing_State || '',
            zip: accountData?.Billing_Code || '',
            country: accountData?.Billing_Country || 'United States'
          };
          const validTill = closingDate;
          const quotedItems = resolvedProducts.map(p => {
            const discountTotal = Math.round((p.discount_per_unit || 0) * p.qty * 100) / 100;
            return {
              Product_Name: { id: p.product_id },
              Quantity: p.qty,
              Discount: discountTotal
            };
          });

          const quoteData = {
            Subject: deal_name || `${account_name} - ${skuSummary}`,
            Deal_Name: { id: dealId },
            Account_Name: { id: accountId },
            Valid_Till: validTill,
            Billing_Street: billingAddr.street,
            Billing_City: billingAddr.city,
            Billing_State: billingAddr.state,
            Billing_Code: billingAddr.zip,
            Billing_Country: billingAddr.country,
            Shipping_Country: billingAddr.country || 'United States',
            Owner: { id: '2570562000141711002' },
            Quoted_Items: quotedItems
          };
          if (contactId) quoteData.Contact_Name = { id: contactId };

          const quoteResult = await zohoApiCall('POST', 'Quotes', env, { data: [quoteData] });
          const quoteId = quoteResult?.data?.[0]?.details?.id;
          if (!quoteId) {
            results.errors.push('Failed to create Quote: ' + JSON.stringify(quoteResult?.data?.[0]));
            return { success: false, ...results, wall_ms: Date.now() - _startMs };
          }
          results.steps.push(`Created Quote with ${resolvedProducts.length} line items at ecomm pricing (${quoteId})`);
          results.records.quote = { id: quoteId, url: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${quoteId}` };

          // STEP 7: Fetch the created quote to get actual line items + Grand_Total
          let quoteVerification = null;
          try {
            const fetchedQuote = await zohoApiCall('GET', `Quotes/${quoteId}`, env);
            if (fetchedQuote?.data?.[0]) {
              quoteVerification = {
                Grand_Total: fetchedQuote.data[0].Grand_Total,
                Sub_Total: fetchedQuote.data[0].Sub_Total,
                Quote_Stage: fetchedQuote.data[0].Quote_Stage,
                item_count: fetchedQuote.data[0].Quoted_Items?.length || 0,
                items: (fetchedQuote.data[0].Quoted_Items || []).map(item => ({
                  product: item.Product_Name?.name || item.product?.name || 'Unknown',
                  qty: item.Quantity,
                  unit_price: item.unit_price,
                  total: item.total
                }))
              };
              results.steps.push(`Verified: ${quoteVerification.item_count} items, Grand Total: $${quoteVerification.Grand_Total}`);
            }
          } catch (e) {
            results.steps.push('Quote verification fetch failed (quote was created successfully)');
          }
          results.records.quote.verification = quoteVerification;

          // STEP 8: Create follow-up task
          const taskDueDate = new Date();
          // Add 3 business days
          let daysAdded = 0;
          while (daysAdded < 3) {
            taskDueDate.setDate(taskDueDate.getDate() + 1);
            if (taskDueDate.getDay() !== 0 && taskDueDate.getDay() !== 6) daysAdded++;
          }
          const taskData = {
            Subject: `Follow up - ${account_name}`,
            Due_Date: taskDueDate.toISOString().split('T')[0],
            Status: 'Not Started',
            Priority: 'Normal',
            Owner: { id: '2570562000141711002' },
            What_Id: { id: dealId },
            $se_module: 'Deals'
          };
          try {
            const taskResult = await zohoApiCall('POST', 'Tasks', env, { data: [taskData] });
            const taskId = taskResult?.data?.[0]?.details?.id;
            if (taskId) {
              results.steps.push(`Created follow-up Task due ${taskData.Due_Date} (${taskId})`);
              results.records.task = { id: taskId, url: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${taskId}` };
            }
          } catch (e) {
            results.steps.push(`Task creation failed: ${e.message}`);
          }

          results.success = true;
          results.wall_ms = Date.now() - _startMs;
          results.pricing_summary = resolvedProducts.map(p =>
            `${p.sku} x${p.qty}: list $${p.list_price}, ecomm $${p.ecomm_price} (${p.discount_pct}% off, $${p.discount_per_unit}/unit discount)`
          );
          if (missingProducts.length > 0) {
            results.missing_products = missingProducts;
            results.note = 'Some products were not found. Mention this to the user but do NOT attempt to fix it with additional tool calls.';
          }
          results.instruction = 'DONE. Report these results to the user with Zoho links. Do NOT call any more tools — the workflow is complete.';
          return results;
        } catch (e) {
          results.errors.push(`Unexpected error: ${e.message}`);
          results.success = false;
          results.wall_ms = Date.now() - _startMs;
          return results;
        }
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

      // ── Velocity Hub ──
      case 'velocity_hub_submit': {
        const { deal_id, country } = toolInput;
        if (!/^\d{8}$/.test(deal_id)) {
          return { error: `Invalid DID format: "${deal_id}". Must be exactly 8 digits.` };
        }
        try {
          const vhResponse = await fetch('https://eo44ez435h7vzp2.m.pipedream.net', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deal_id, country: country || 'United States' })
          });
          const vhStatus = vhResponse.status;
          const vhBody = await vhResponse.text().catch(() => '');
          console.log(`[GCHAT-AGENT] Velocity Hub submit: DID=${deal_id}, status=${vhStatus}`);
          return { success: vhStatus >= 200 && vhStatus < 300, status: vhStatus, deal_id, message: `Deal ${deal_id} submitted to Velocity Hub for approval.` };
        } catch (vhErr) {
          console.error(`[GCHAT-AGENT] Velocity Hub error:`, vhErr.message);
          return { success: false, error: vhErr.message, deal_id, message: `Velocity Hub submission failed but DID ${deal_id} was generated successfully. Chris can submit manually later.` };
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
    description: 'Search Zoho CRM records in any module (Deals, Quotes, Contacts, Accounts, Tasks, Sales_Orders, Invoices). Uses COQL criteria syntax like (Account_Name:equals:Acme Corp) or (Stage:equals:Qualification). Multiple criteria joined with "and"/"or". WARNING: Do NOT use this for Products or WooProducts lookups — use batch_product_lookup instead (it resolves product IDs from cache with zero API calls). Products searches via this tool are auto-intercepted through the cache anyway.',
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
  // zoho_coql_query REMOVED — zoho_search_records handles all search needs. Saves ~50 tokens per request.
  // Batch Product Lookup (parallel, with KV pricing)
  {
    name: 'batch_product_lookup',
    description: 'Look up multiple product SKUs in parallel. Applies SKU suffix rules automatically. Uses embedded Zoho product IDs from the local price cache (zero API calls for 98% of SKUs), with API fallback for the rare SKUs without cached IDs. Returns product_id, list_price, ecomm_price, and quote_unit_price for each SKU. IMPORTANT: Use quote_unit_price (ecomm price) for Quoted_Items.unit_price when creating quotes — this is the Stratus default. Use this for ALL product lookups — never search Products/WooProducts individually.',
    input_schema: {
      type: 'object',
      properties: {
        skus: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'Base SKU without suffix (e.g., MR57, LIC-ENT-1YR)' },
              qty: { type: 'number', description: 'Quantity (default 1)' }
            },
            required: ['sku']
          },
          description: 'Array of SKUs to look up. Suffixes are applied automatically.'
        }
      },
      required: ['skus']
    }
  },
  // Parse Stratus quote URL into ordered line items
  {
    name: 'parse_quote_url',
    description: 'Parse a stratusinfosystems.com/order URL into ordered Quoted_Items with product IDs and ecomm pricing from cache. Automatically orders items as hardware→license pairs for clean quote display. Use this FIRST when a user pastes a Stratus URL and asks to create or update a Zoho quote. Returns items in correct display order with product_id, discount, and pricing — ready to pass directly into zoho_create_record or zoho_update_record Quoted_Items payload. ZERO API calls for cached SKUs.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The full stratusinfosystems.com/order URL with ?item= and &qty= parameters' }
      },
      required: ['url']
    }
  },
  // Compound tool: create deal + quote in one shot
  {
    name: 'create_deal_and_quote',
    description: 'FASTEST way to create a Deal + Quote in Zoho CRM. Pass ONLY hardware SKUs (e.g., MX68, MS130-12X, MR44) — licenses are auto-added using the correct SKU for each model. Handles ALL steps: Account, Contact, Deal, product resolution from cache, Quote with ecomm pricing, verification, and follow-up Task. ONE call, ~10 seconds. After this returns, just report the results — do NOT make additional tool calls to modify the quote.',
    input_schema: {
      type: 'object',
      properties: {
        account_name: { type: 'string', description: 'Company/Account name (e.g., "Verato")' },
        contact_name: { type: 'string', description: 'Contact full name (optional — will search Account contacts if omitted)' },
        contact_email: { type: 'string', description: 'Contact email (optional)' },
        deal_name: { type: 'string', description: 'Deal name (optional — defaults to "Account - Products - Quote")' },
        skus: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string', description: 'HARDWARE SKUs only (e.g., MR44, MX68, MS130-12X). Licenses are auto-added. Do NOT pass license SKUs — they are resolved automatically.' },
              qty: { type: 'number', description: 'Quantity (default 1)' }
            },
            required: ['sku']
          },
          description: 'Array of HARDWARE SKUs only. Licenses auto-added per model.'
        },
        license_term: { type: 'string', description: 'License term for auto-added licenses: "1" (default), "3", or "5".' },
        lead_source: { type: 'string', description: 'Lead source. Default "Stratus Referal". Use "Meraki ISR Referal" if Cisco rep involved.' },
        billing_address: {
          type: 'object',
          description: 'Billing address (optional — looked up from Account if omitted)',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            zip: { type: 'string' },
            country: { type: 'string' }
          }
        }
      },
      required: ['account_name', 'skus']
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
  // Velocity Hub deal approval submission
  {
    name: 'velocity_hub_submit',
    description: 'Submit a Cisco Deal ID (DID) to Velocity Hub for deal approval. Call this after LIVE_CiscoQuote_Deal generates a CCW_Deal_Number. The DID must be exactly 8 digits.',
    input_schema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'The 8-digit CCW Deal Number (DID) from LIVE_CiscoQuote_Deal' },
        country: { type: 'string', description: 'Country for deal approval (default: "United States")' }
      },
      required: ['deal_id']
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

// ─── Fast Path: Direct Quote Lookup ──────────────────────────────────────────
// Handles "most recent X quote / line items in X quote" in ~3-5s (2 Zoho API
// calls) vs the 3-iteration agentic loop which can hit the 30s ctx.waitUntil
// wall-clock limit. Returns a formatted GChat string or null to fall through.
async function fastPathQuoteLookup(userMessage, envObj) {
  const msg = userMessage.toLowerCase();

  // Must be a read request — bail immediately on create/update keywords
  if (/\b(create|make|build|new\s+quote|add|update|change|modify|set|edit|replace|switch|convert|upgrade)\b/.test(msg)) return null;

  // Must mention "quote" with a lookup indicator
  if (!/\bquote\b/.test(msg)) return null;
  if (!/\b(line\s*items?|most\s+recent|latest|last|products?|what|list|show|contents?|what('?s|\s+is|\s+are))\b/.test(msg)) return null;

  // Extract company name
  let company = null;

  // "most recent {COMPANY} quote" — words between "most recent" and "quote"
  let m = msg.match(/most\s+recent\s+([\w&'.'-]+(?:\s+[\w&'.'-]+){0,3}?)\s+quote/);
  if (m) company = m[1].trim();

  // "in the {COMPANY} quote" / "in {COMPANY}'s quote"
  if (!company) {
    m = msg.match(/\bin\s+(?:the\s+)?(?:most\s+recent\s+)?([\w&'.'-]+(?:\s+[\w&'.'-]+){0,3}?)(?:'s)?\s+quote/);
    if (m) company = m[1].trim();
  }

  // "for {COMPANY}" (e.g. "latest quote for Modea")
  if (!company) {
    m = msg.match(/\bfor\s+([\w&'.'-]+(?:\s+[\w&'.'-]+){0,3}?)\b/);
    if (m && !/^(the|a|an|me|you|us|our|them|this|that)$/i.test(m[1])) company = m[1].trim();
  }

  // Filter non-company filler words
  if (!company || company.length < 2) return null;
  if (/^(the|a|an|my|our|this|that|any|recent|latest|last|most|all|every)$/i.test(company)) return null;

  try {
    // Step 1: Search Quotes by account name (most recent first)
    const OWNER = '2570562000141711002';
    const searchPath = `Quotes/search?criteria=(Account_Name:contains:${encodeURIComponent(company)})and(Owner:equals:${OWNER})&sort_by=Created_Time&sort_order=desc&per_page=3&fields=id,Subject,Quote_Number,Account_Name,Grand_Total,Quote_Stage`;
    const searchResult = await zohoApiCall('GET', searchPath, envObj);
    const quotes = searchResult?.data;
    if (!quotes || quotes.length === 0) return null; // No match — fall through to Claude

    const quoteId = quotes[0].id;

    // Step 2: Get full record with Quoted_Items
    const FIELDS = 'id,Subject,Quote_Number,Quoted_Items,Account_Name,Grand_Total,Quote_Stage';
    const detail = await zohoApiCall('GET', `Quotes/${quoteId}?fields=${FIELDS}`, envObj);
    const q = Array.isArray(detail?.data) ? detail.data[0] : detail?.data;
    if (!q) return null;

    const items = q.Quoted_Items || [];
    if (items.length === 0) return null; // No line items — fall through to Claude

    // Format for GChat (* bold, not **)
    let reply = `*${q.Subject}* (Quote #${q.Quote_Number})\n\n`;
    reply += `*Line Items:*\n`;
    for (const item of items) {
      const code = item.Product_Code || item.product_code || '';
      const name = item.product_name || item.Product_Name || '';
      const qty = item.quantity || item.Quantity || 1;
      const price = item.unit_price || item.Unit_Price || 0;
      const display = code || name || '(unknown SKU)';
      reply += `• ${qty}x ${display}`;
      if (price) reply += ` — $${Number(price).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      reply += '\n';
    }
    if (q.Grand_Total) {
      reply += `\n*Total:* $${Number(q.Grand_Total).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
    }
    if (q.Quote_Stage) reply += `  |  *Stage:* ${q.Quote_Stage}`;
    reply += `\n\n[View in Zoho CRM](https://crm.zoho.com/crm/org647122552/tab/Quotes/${quoteId})`;

    return reply;
  } catch (_) {
    return null; // Any error → fall through to full agentic loop
  }
}

// ─── CRM/Email Intent Detection ──────────────────────────────────────────────
function detectCrmEmailIntent(text) {
  const lower = text.toLowerCase();

  // CRM intents
  const crmPatterns = [
    /\b(create|new|add)\s+(a\s+)?(deal|quote|task|contact|account)/i,
    /\b(update|edit|change|modify)\s+.{0,40}\b(deal|quote|task|contact|account)/i,
    /\b(search|find|look\s*up|pull\s*up|get|show|list)\s+(me\s+)?(the\s+|all\s+)?.{0,20}\b(deal|quote|task|contact|account|customer|client|line\s*items?)/i,
    /\b(close|complete|finish)\s+(the\s+)?(task|deal)/i,
    /\b(what|when|how\s+many|how\s+much|who)\s+.*(deal|quote|customer|account|order|invoice|pipeline)/i,
    // Quote field updates (Valid Till, dates, amounts, etc.)
    /\b(valid\s+till|expir|due\s+date|closing\s+date)\b/i,
    /\b(these|those|the)\s+quotes?\b/i,
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
    // Follow-up patterns that reference CRM actions
    /\b(status|confirm|progress)\b.{0,30}\b(quote|deal|account|contact|task|creation)/i,
    /\bzoho\s+quote\b/i,
    /\bmake\s+(a\s+|the\s+)?(zoho\s+)?quote\b/i,
    /\b(individual|separate)\s+quote\s+for\s+each/i,
    // Post-workflow retrieval — "show me links", "what did you create", etc.
    /\b(links?|url|urls)\s+(to|for)\s+(the\s+)?(records?|deal|quote|account|contact)/i,
    /\bwhat\s+(records?|did\s+you|have\s+you)\s+(just\s+)?(creat|made?|built?|add)/i,
    /\b(show|give)\s+me\s+the\s+(zoho\s+)?(links?|url|records?)/i,
    /\b(records?\s+you\s+just\s+creat|things?\s+you\s+just\s+(made|creat|built))/i,
    /\b(zoho\s+)?(link|url)\s+(for|to)\s+(the\s+)?(deal|quote|account)/i,
    /\b(most\s+recent|just\s+creat|latest)\s+.{0,30}\b(records?|deal|quote|account|contact)/i,
    /\b(line\s*items?|quoted\s*items?|products?\s+in\s+the\s+quote)\b/i,
    /\b(what('?s|\s+is|\s+are)\s+.{0,30}(in|on)\s+.{0,20}(quote|deal|order))/i,
    /\bwhat\s+(was|were)\s+(just\s+)?(creat|made?|built?|add)/i,
    // Stop-then-ask pattern — user says stop, then asks follow-up
    /\bstop\b.{0,50}\b(creat|quot|deal|zoho|account)/i,
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

## SPEED CRITICAL — READ THIS FIRST

**For new deal + quote creation:** Use the **create_deal_and_quote** tool. It handles Account, Contact, Deal, product resolution, Quote with ecomm pricing, verification, and Task creation in ONE tool call (~10 seconds). Do NOT manually create records with separate zoho_create_record calls.

**For other CRM operations:** Call MULTIPLE tools in the SAME response whenever inputs are independent. Never narrate without acting.

**Target iteration counts (fewer = faster):**
- New deal + quote: 2 iterations (1 create_deal_and_quote call + 1 summary)
- URL-to-quote update: 2-3 iterations (parse_quote_url + update + summary)
- Quote modification: 2-3 iterations (read + update + summary — skip verification unless error)
- Simple lookup: 1-2 iterations
- NEVER exceed 4 iterations for any quote operation

---

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

Before calling zoho_create_record for a Deal or Quote, show a validation table with all required fields (Field | Value | Status). Mark each ✓ or ⚠. If ANY field is ⚠ or missing, STOP and resolve before creating.

**EXCEPTION:** When using create_deal_and_quote, the tool handles validation internally — skip the table and let it run.

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
    {
      "Product_Name": {"id": "{zoho_product_id}"},
      "Quantity": 1,
      "Discount": discount_per_unit * qty
    }
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

## SKU SUFFIX & LICENSE RULES

SKU suffixes and hardware→license pairing are handled automatically by the tools:
- batch_product_lookup and parse_quote_url apply suffixes automatically (MR44 → MR44-HW, CW9172I → CW9172I-RTG, etc.)
- create_deal_and_quote auto-adds licenses for each hardware SKU using getLicenseSkus()
- You do NOT need to manually apply suffixes or figure out license SKUs — just pass base SKUs to the tools
- License quantity always equals hardware quantity (1:1 ratio)
- If a user explicitly names a license SKU (e.g., "LIC-ENT-3YR"), pass it as-is to batch_product_lookup

---

## ZOHO SEARCH RULES

**Quote_Number vs ID:** Quote_Number is NOT the same as record id. To look up a quote by number: zoho_search_records(Quotes, criteria=(Quote_Number:equals:X)). NEVER use zoho_get_record with a Quote_Number.

**Search order:** Accounts FIRST, then Contacts (can be parallel). For quote lookups, search Quotes directly (system auto-expands first result with full Quoted_Items — no separate zoho_get_record needed).

**Speed:** Call multiple independent tools in the SAME response. Never serialize independent calls. Each API call costs ~2-3s. Use "contains" when unsure of exact name. Never pass record IDs into name search fields — use zoho_get_related_records instead.

---

## PRODUCT LOOKUP & PRICING

Use **batch_product_lookup** for ALL product lookups. Use **parse_quote_url** for Stratus URLs. Both resolve product IDs from cache with zero API calls. NEVER search Products/WooProducts individually.

**When found: false for a LIC-* SKU:** Search Zoho Products directly before giving up. found: false does NOT mean invalid. Only report "not available" if both batch_product_lookup AND Products search fail.

### Ecomm Pricing (DEFAULT)
- Discount is a DOLLAR AMOUNT: Discount = discount_per_unit * Quantity
- Do NOT set unit_price (Zoho uses stored list price) or Description
- Only use list pricing if user explicitly asks for "list price" or "no discount"

### Quote Update Workflow (minimize tool calls)
1. URL provided? → parse_quote_url. Otherwise → batch_product_lookup for all SKUs in ONE call
2. Existing items to keep/delete? → zoho_get_record. Empty quote? → skip
3. Build Quoted_Items: Product_Name.id, Quantity, Discount. No Description, no unit_price.
4. zoho_update_record ONCE → STOP. No verification unless error.
Steps 1 and 2 can run in PARALLEL.

### Quoted_Items ADDITIVE RULE (CRITICAL)
Updates are ADDITIVE — Zoho ADDS items, does NOT replace.
- KEEP items: omit from payload (they stay)
- REMOVE items: include with "id" and "_delete": null
- ADD items: include WITHOUT "id", with Product_Name: {"id": "zoho_product_id"}, Quantity, Discount
- MODIFY items: include with existing "id" + changed fields
- REPLACE (e.g., swap license): DELETE old + ADD new in SAME update

**NEVER infer quote contents from Subject field.** Always read actual Quoted_Items via zoho_get_record before modifying existing quotes.
- **ALWAYS include Discount when adding new line items** — including license term swaps. Missing Discount = list price charged

  Example: Quote has 4 items. Remove item #2 (1YR license), add a 3YR license, keep items #1/#3/#4 unchanged:
  Quoted_Items: [
    {"id": "item2_id_1yr_license", "_delete": null},
    {"Product_Name": {"id": "new_3yr_product_id"}, "Quantity": 1}
  ]
  Items #1, #3, #4 are NOT included because they stay automatically.

  Example: Remove duplicates (items with IDs "dup1" and "dup2"):
  Quoted_Items: [
    {"id": "dup1", "_delete": null},
    {"id": "dup2", "_delete": null}
  ]

**LICENSE TERM SWAP (e.g., 3YR → 5YR) — CRITICAL WORKFLOW:**
When the user asks to change license terms on an existing quote:
1. Call zoho_get_record on the Quote AND batch_product_lookup for new SKUs IN PARALLEL (both are independent)
2. Build a SINGLE zoho_update_record call that BOTH deletes the old items AND adds the new ones WITH ecomm discount:
   Quoted_Items: [
     {"id": "old_3yr_line_item_id", "_delete": null},
     {"id": "old_3yr_switch_lic_id", "_delete": null},
     {"Product_Name": {"id": "new_5yr_product_id"}, "Quantity": 1, "Discount": discount_per_unit * 1},
     {"Product_Name": {"id": "new_5yr_switch_product_id"}, "Quantity": 1, "Discount": discount_per_unit * 1}
   ]
3. NEVER split deletes and adds into separate update calls — this creates duplicates because adds happen before deletes are processed
4. Report success. Only call zoho_get_record to verify if something looks wrong.

**NEVER DO (Line Item Updates):**
- NEVER send Quoted_Items with items you want to keep, expecting Zoho to remove the rest — this ADDS duplicates
- NEVER assume Quoted_Items in an update replaces the existing list — it is always additive
- NEVER use zoho_delete_record on Quoted_Items module directly (returns "record not approved")
- NEVER split a license term swap into two separate update calls (one for add, one for delete) — this ALWAYS creates duplicates

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

## NEW CUSTOMER EMAIL INTAKE
(Full workflow loaded conditionally when email intake intent is detected.)

---

## CRITICAL RULES

1. You are in CRM mode — always create Zoho CRM quotes, NEVER fall back to URL quotes.
2. Parse user input for intent, not literal strings. Don't re-ask for already-provided info.
3. **CRM-FIRST:** Search Zoho CRM before web searching. Only use web_search_domain for NEW accounts not in CRM.
4. **create_deal_and_quote:** Pass ONLY hardware SKUs (auto-adds licenses). Call it ALONE. After it returns, STOP — report results only.
5. **batch_product_lookup / parse_quote_url:** Use for all SKU lookups and URL parsing. Never search Products individually.
6. **RESELLER / VAR PATTERN:** "this is for [Customer]" or "on behalf of [Customer]" = sender is VAR. Billing Account = sender's company. Deal name: "[Sender Account] - [End Customer] - [Description]". Contact = sender.
7. **ALWAYS END WITH ZOHO LINKS:** [Record Name](https://crm.zoho.com/crm/org647122552/tab/MODULE/ID) for every record created.

---

## ADMIN ACTION WORKFLOW
(Full workflow loaded conditionally when admin action intent is detected.)

---

## URL / ECOMM QUOTE LINK GENERATION

When the user asks for a "URL quote", "ecomm link", "order link", or "shopping cart link" from a Zoho quote:
1. Read the Quoted_Items from the quote (use CRM context if available)
2. Build the Stratus ecomm URL: https://stratusinfosystems.com/order/?item={SKU1},{SKU2},{SKU3}&qty={Q1},{Q2},{Q3}
3. Generate 3 links (1yr, 3yr, 5yr) by swapping license terms:
   - LIC-ENT-{N}YR for AP licenses
   - LIC-{model}-SEC-{N}YR for MX security licenses
   - LIC-{model}-{N}Y for switch licenses (note: Y not YR for switches)
   - Hardware SKUs stay the same across all 3 links
4. Present as:
   *1-Year Co-Term:* {url}
   *3-Year Co-Term:* {url}
   *5-Year Co-Term:* {url}

If the quote already has specific license terms, show just that term's link plus offer: "Want me to show 1yr and 5yr options too?"

---

## SPEED RULES (CRITICAL FOR RESPONSIVENESS)

- You have at most 25 seconds total. Each Zoho API call costs ~2-3s. Each of your responses costs ~5-10s.
- Budget: 2 of your responses + 1-2 Zoho calls MAX for simple lookups.
- When CRM context is injected (PREVIOUS CRM CONTEXT section), use those IDs directly. DO NOT search again.
- For quote updates with context: go straight to batch_product_lookup + zoho_update_record. Skip the search.
- For Admin Actions: trigger immediately on the Quote ID from context. No search needed.
- Combine multiple pieces of info in a single response rather than doing multiple tool calls to gather them separately.
- If a task only needs 1 tool call, make that call immediately with your narration in the same turn.

## PARALLEL TOOL CALLS — MAXIMIZE SPEED

Issue MULTIPLE tool_use blocks in a SINGLE response whenever the calls are independent:

**ALWAYS parallel:**
- batch_product_lookup + zoho_search_records (account/contact lookup) → PARALLEL (no dependency)
- zoho_search_records(Accounts) + zoho_search_records(Contacts) → PARALLEL
- zoho_get_record(Account) + zoho_get_record(Contact) → PARALLEL (different modules)

**NEVER parallel (sequential dependency):**
- batch_product_lookup THEN zoho_create_record (Quote needs product IDs from lookup)
- zoho_create_record(Deal) THEN zoho_create_record(Quote with deal.id) (Quote needs Deal ID)
- zoho_search_records THEN zoho_get_record(result.id) (get needs the search result)

**Example — Quote creation in 3 iterations (not 5):**
Turn 1: [text] + batch_product_lookup([skus]) + zoho_search_records(account)  ← 2 parallel calls
Turn 2: zoho_create_record(Quote with product IDs from turn 1 + account data from turn 1)
Turn 3: [format success response to user]

**Pre-resolved product data:** If the system message includes [Pre-resolved products: ...], use those product IDs directly. Skip batch_product_lookup entirely — go straight to zoho_create_record.

---

## NARRATE AS YOU WORK
The user can only see your text responses, not tool calls. Always include a brief text block explaining what you're doing before each tool call, and summarize results after. Never make silent tool calls.
`;

// Minimal system prompt for CRM/email agent mode (saves ~4K tokens vs full SYSTEM_PROMPT)
const CRM_AGENT_SYSTEM_PROMPT_BASE = `You are Stratus AI, the sales assistant for Stratus Information Systems, a Cisco-exclusive Meraki reseller. You help with CRM and email tasks.

Keep responses concise and well-formatted for Google Chat (* for bold, not **).
${CRM_SYSTEM_PROMPT}`;

// ── Conditional prompt sections (loaded only when relevant intent detected) ──

const CRM_PROMPT_EMAIL_INTAKE = `

## NEW CUSTOMER EMAIL INTAKE WORKFLOW

When the user says "new customer", "process this email", "intake this lead", or references a customer email that needs CRM setup:

### PHASE 1 — EMAIL DISCOVERY & ANALYSIS
1. Search Gmail for the referenced email (sender name, company, subject, recency clues).
2. Read the FULL THREAD (gmail_read_thread), not just one message.
3. Extract: products/services requested, budget/scope, timeline/urgency.

### PHASE 2 — PRODUCT DETERMINATION
Map needs to Cisco/Meraki SKUs. If vague: MR57/CW9166I for Wi-Fi, MS150 for switches, MX75/85/95 by user count for security. Include licenses (LIC-ENT for APs, LIC-SEC for MX, LIC-MS for switches). Flag placeholders.

### PHASE 3 — CONTACT IDENTIFICATION
Extract from email: First/Last Name, Email, Phone, Title. Identify decision-maker if multiple people.

### PHASE 4 — BUSINESS IDENTIFICATION
1. Check email signature for company/address
2. Extract email domain if unclear
3. **SEARCH ZOHO CRM FIRST** for existing Account (by name or domain) and Contact (by email)
4. If Account exists → use it, pull billing address. **DO NOT web search.**
5. If NOT in CRM → use web_search_domain for address/business info to create new Account
6. Never create duplicate Accounts

### PHASE 5 — CONFIRMATION GATE (MANDATORY)
Present complete summary before creating records: Email Thread, Account (NEW/EXISTING), Contact, Deal details (Stage: Qualification, Lead Source: Stratus Referal, ISR: Stratus Sales), Products. WAIT for user confirmation.

### PHASE 6 — CRM RECORD CREATION
After confirmation, call **create_deal_and_quote** with ALL details (one tool call). Do NOT manually create records. Report results with Zoho links.

### PHASE 7 — OPTIONAL: DRAFT REPLY
Offer to draft a reply (gmail_create_draft, never auto-send).
`;

const CRM_PROMPT_ADMIN_ACTION = `

## ADMIN ACTION WORKFLOW (Quote-to-PO)

Admin Actions are Zoho automations triggered by writing an action name to the Admin_Action field. Execute via API directly. NEVER tell user to click a button.

**Trigger process:**
1. TRIGGER: zoho_update_record(module_name="Quotes", record_id={id}, data={"Admin_Action": "{ACTION_NAME}"})
2. VERIFY: zoho_get_record on same ID. Check Admin_Action shows "{ACTION_NAME}__Done". Re-fetch once more if unchanged.

**Admin Action Sequence:**
| Step | Action | Trigger Phrases | Verify Field |
|------|--------|----------------|-------------|
| 1 | LIVE_CiscoQuote_Deal | "create deal id", "generate DID", "submit to CCW" | CCW_Deal_Number (8-digit) |
| 2 | LIVE_GetQuoteData | "get quote data", "get disti pricing" | Vendor_Lines populated |
| 3 | LIVE_ConvertQuoteToSO | "convert to PO", "create purchase order" | Sales_Orders linked |
| 4 | LIVE_SendToEsign | "send for signature", "send PO", "esign" | Quote_Stage updates |

**Step 1: LIVE_CiscoQuote_Deal (DID generation)**
Async, takes 30-90 seconds. After triggering, re-fetch. If CCW_Deal_Number populated → report + auto-submit to Velocity Hub (velocity_hub_submit). If null → tell user it's processing, offer to check back. DID must be exactly 8 digits.

**Step 3: LIVE_ConvertQuoteToSO**
Show validation first: Net_Terms, Contact, Tax, Grand Total. Net_Terms CANNOT change after conversion.

**Step 4: LIVE_SendToEsign**
Run on Sales_Orders module (PO record), NOT Quotes. Search Sales_Orders by Deal_Name, then trigger on PO record.

**Delinquency Gate:** If Delinquency_Score non-green after ConvertQuoteToSO, set Net_Terms="Cash" and re-run.
`;

// Build CRM system prompt dynamically based on detected intent
function buildCrmSystemPrompt(text) {
  let prompt = CRM_AGENT_SYSTEM_PROMPT_BASE;
  const lower = (text || '').toLowerCase();

  // Detect email intake intent
  const emailIntakePatterns = [
    /\bnew\s+customer\b/i,
    /\b(process|intake|onboard)\s+(this\s+)?(email|lead|customer)/i,
    /\b(set\s*up|build\s*out|create\s+everything)\s+(for|from)\s+(this|the)/i,
    /\b(got|received|have)\s+(a|an)\s+(email|inquiry|request)\s+(from|about)\s+(a\s+)?(new|potential|prospective)/i,
  ];
  if (emailIntakePatterns.some(p => p.test(text))) {
    prompt += CRM_PROMPT_EMAIL_INTAKE;
  }

  // Detect admin action intent
  const adminActionPatterns = [
    /\b(admin\s*action|generate\s*did|deal\s*id|submit.*ccw|convert.*po|purchase\s*order|esign|send.*signature|quote.to.po|did\s+generation)\b/i,
    /\bLIVE_/i,
    /\b(get\s+quote\s+data|disti\s+pricing|vendor\s+lines)\b/i,
  ];
  if (adminActionPatterns.some(p => p.test(text))) {
    prompt += CRM_PROMPT_ADMIN_ACTION;
  }

  return prompt;
}

// Keep backward-compatible reference for non-dynamic usage
const CRM_AGENT_SYSTEM_PROMPT = CRM_AGENT_SYSTEM_PROMPT_BASE;

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
    case 'batch_product_lookup': {
      const skuCount = toolInput.skus?.length || 0;
      return `📦 Resolving ${skuCount} product${skuCount !== 1 ? 's' : ''} (cached IDs + pricing)...`;
    }
    case 'parse_quote_url':
      return `📦 Parsing URL → ordered line items with cached pricing...`;
    case 'create_deal_and_quote': {
      const acct = toolInput.account_name || 'customer';
      const skuCount = toolInput.skus?.length || 0;
      return `🚀 Creating Deal + Quote for ${acct} (${skuCount} products)...`;
    }
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
      const apiUrl = attempt === maxRetries ? ANTHROPIC_API_DIRECT : ANTHROPIC_API_URL;
      const headers = {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      };
      if (apiUrl === ANTHROPIC_API_URL) headers['cf-aig-cache-ttl'] = '3600';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      });

      // Retry on rate limits
      if ((response.status === 429 || response.status === 529) && attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 2000 * Math.pow(2, attempt)));
        continue;
      }

      // Detect CF AI Gateway errors (code 2005 = provider failure) and retry direct
      if (response.status === 400 && apiUrl === ANTHROPIC_API_URL && attempt < maxRetries) {
        try {
          const text = await response.clone().text();
          if (text.includes('"code":2005') || text.includes('Failed to get response from provider')) {
            console.warn(`[GCHAT-API] Gateway error 2005, retrying direct to Anthropic (attempt ${attempt + 1})`);
            continue;
          }
        } catch (_) {}
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

    // Dynamic model: Haiku only for dispatch-only steps (zoho_update_record, send_email)
    // at iteration 4+. Sonnet for all planning/interpretation steps.
    // .every() ensures Haiku only fires if ALL last tools were dispatch-only.
    const _lastMsg = [...messages].reverse().find(m => m.role === 'assistant');
    const _contLastToolNames = _lastMsg && Array.isArray(_lastMsg.content)
      ? _lastMsg.content.filter(b => b.type === 'tool_use').map(b => b.name)
      : [];
    const _contExecTools = new Set(['zoho_update_record', 'send_email']);
    const _isPureExec = _contLastToolNames.length > 0 && _contLastToolNames.every(n => _contExecTools.has(n));
    const contModel = (iteration > 3 && _isPureExec)
      ? 'claude-haiku-4-5-20251001'
      : 'claude-sonnet-4-20250514';
    console.log(`[GCHAT-CONTINUE] Model: ${contModel} (iter=${iteration}, pureExec=${_isPureExec}, lastTools=${_contLastToolNames.join(',')})`);

    // Dynamic max_tokens: 2048 for most iterations, 1024 for pure exec (Haiku dispatch)
    const contMaxTok = _isPureExec ? 1024 : 2048;
    const requestBody = {
      model: contModel,
      max_tokens: contMaxTok,
      system: systemPrompt,
      messages
    };
    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    const response = await callAnthropicWithRetry(requestBody);
    if (!response || !response.ok) {
      const contErrBody = await response?.text().catch(() => '');
      let contErrParsed = {};
      try { contErrParsed = JSON.parse(contErrBody); } catch (_) {}
      const contErrMsg = contErrParsed?.error?.message || '';
      if (response?.status === 429) return `I'm being rate-limited. Please wait 30 seconds and try again.`;
      if (response?.status === 400 && contErrMsg.includes('credit balance')) {
        return `⚠️ The AI service account is out of credits. Please top up the Anthropic API balance at console.anthropic.com, then try again.`;
      }
      return `Sorry, I couldn't complete that CRM request (API ${response?.status || 'error'}).`;
    }

    const data = await response.json();
    trackUsage(env, contModel, data.usage, 'crm-agent-continue').catch(() => {});

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
        // zoho_get_record returns large payloads for Quotes (Quoted_Items); use higher limit
        const truncLimit = block.name === 'zoho_get_record' ? 8000 : 2000;
        return {
          type: 'tool_result',
          tool_use_id: block.id,
          content: resultStr.length > truncLimit ? resultStr.substring(0, truncLimit) + '...(truncated)' : resultStr
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
      const licSkus = getLicenseSkus(model, term) || [];
      for (const lic of licSkus) items.push({ sku: lic, qty });
    } else if (license_only) {
      const licSkus = getLicenseSkus(model, term) || [];
      for (const lic of licSkus) items.push({ sku: lic, qty });
    } else {
      // Hardware only
      items.push({ sku: applySuffix(model), qty: hwQty });
    }
  }

  const url = buildStratusUrl(items);
  return { url, label: label || `${term}-Year Co-Term`, items_count: items.length };
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
    // For CRM tool-use, limit history to last 2 messages to keep Anthropic payload small.
    // Full 10-message history + tool calls + tools schema = 50-65K chars → too slow for ctx.waitUntil 30s wall-clock limit.
    // 2-message history keeps follow-up context while fitting the full agentic flow in ~15-20s.
    const effectiveHistory = useTools ? history.slice(-2) : history;
    let messages = [...effectiveHistory, { role: 'user', content: userContent }];

    // Determine if we should include CRM/email tools
    // Always include QUOTE_URL_TOOL for deterministic URL generation (even non-CRM path)
    const tools = useTools ? CRM_EMAIL_TOOLS : [QUOTE_URL_TOOL];
    if (useTools) {
      // Build system prompt dynamically — conditionally loads EMAIL INTAKE and ADMIN ACTION
      // sections only when relevant intent is detected, saving ~2K tokens on standard requests.
      systemPrompt = buildCrmSystemPrompt(userMessage);

      // CRM context injection: if a previous CRM turn saved context (quote ID, account,
      // line items), inject it so the agent can skip re-searching on follow-up messages.
      if (personId && kv) {
        try {
          const savedCtx = await kv.get(`crm_context_${personId}`, 'json');
          if (savedCtx) {
            let ctxHint = '\n\n## PREVIOUS CRM CONTEXT (from your last turn)\n';
            if (savedCtx.account_name) ctxHint += `Account: ${savedCtx.account_name} (ID: ${savedCtx.account_id})\n`;
            if (savedCtx.quote_id) ctxHint += `Quote ID: ${savedCtx.quote_id}`;
            if (savedCtx.quote_number) ctxHint += ` (Quote#: ${savedCtx.quote_number})`;
            ctxHint += '\n';
            if (savedCtx.deal_id) ctxHint += `Deal ID: ${savedCtx.deal_id}\n`;
            if (savedCtx.ccw_deal_number) ctxHint += `CCW Deal Number (DID): ${savedCtx.ccw_deal_number}\n`;
            if (savedCtx.line_items?.length) {
              ctxHint += `Line items (${savedCtx.line_items.length} total):\n`;
              for (const li of savedCtx.line_items) {
                ctxHint += `  - ${li.qty}x ${li.sku} (line_item_id: ${li.id}, product_id: ${li.product_id})\n`;
              }
            }
            ctxHint += '\n⚡ SPEED DIRECTIVE: You already have all record IDs. DO NOT call zoho_search_records — go directly to zoho_get_record using the IDs above. For quote updates, call zoho_get_record on the Quote ID to get fresh Quoted_Items, then immediately call zoho_update_record. For Admin Actions (DID, ConvertToSO, SendToEsign), use the Quote ID or Deal ID directly. For URL quote generation, use the line items listed above. Target: 1-2 tool calls max for follow-up requests.\n';
            systemPrompt += ctxHint;
            console.log(`[GCHAT] Injected CRM context: quote=${savedCtx.quote_id}, acct=${savedCtx.account_name}`);
          }
        } catch (ctxErr) {
          console.error(`[GCHAT] CRM context injection error:`, ctxErr.message);
        }
      }
    }

    // Agentic loop: Claude may call tools multiple times before returning text.
    // GChat CRM path runs inside ctx.waitUntil which has a hard 30s wall-clock limit.
    // Budget: 2-3 Zoho calls (~6-9s) + 2-3 Anthropic calls (~15-20s) = ~25s max.
    // Cap at 6 iterations for tool-use mode to prevent timeouts.
    // Quote creation (non-GChat) needs 15-25 tool calls — but that path isn't CRM tool-use.
    // Queue consumer gives us 15 min wall-clock — no need for aggressive iteration cap.
    // CRM agentic loops typically need 3-5 iterations (search → get_record → compose).
    // 15 is generous but safe; each iteration is ~10-15s (Anthropic API + Zoho calls).
    const MAX_TOOL_ITERATIONS = useTools ? 15 : 8;
    let iteration = 0;
    const _loopStartMs = Date.now();

    // Non-CRM (quoting) path: accumulate text across tool-use iterations so dashboard
    // screenshot responses don't lose analysis text when Claude emits text + tool_use blocks.
    // Tool URLs are tracked separately and only injected as fallback if Claude omits them.
    let accumulatedText = '';
    const toolUrls = []; // URLs from build_quote_url results (deferred injection, not eager)

    // CRM speed optimization: track auto-expanded Quote data to avoid redundant API calls.
    // When zoho_search_records on Quotes auto-expands the first result (including Quoted_Items),
    // we cache the expanded data here. If Claude later calls zoho_get_record on the same Quote,
    // we return the cached data instantly instead of making another API call.
    const _expandedQuoteCache = {}; // { recordId: expandedDataString }

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
      const wallMs = Date.now() - _loopStartMs;
      console.log(`[GCHAT-AGENT] Iteration ${iteration}/${MAX_TOOL_ITERATIONS}, wall=${wallMs}ms`);

      // KV-based debug log for diagnosing stalls
      if (useTools && env.CONVERSATION_KV) {
        try {
          await env.CONVERSATION_KV.put(`agent_log_${_loopStartMs}`, JSON.stringify({
            iteration, wallMs, msgCount: messages.length,
            lastMsgRole: messages[messages.length - 1]?.role,
            ts: new Date().toISOString()
          }), { expirationTtl: 3600 });
        } catch (_) {}
      }

      // Dynamic model selection:
      // - Sonnet for all planning/interpretation steps: zoho_search_records,
      //   zoho_get_record, batch_product_lookup, zoho_create_record. These all
      //   produce data that Claude must reason about to decide next steps.
      // - Haiku for DISPATCH-ONLY steps at iter 3+: zoho_update_record and
      //   send_email. After Sonnet has planned the full payload, the act of
      //   sending the update and checking "Modified: true" is mechanical.
      //   The NEXT iteration (zoho_get_record verify) will use Sonnet again.
      // - .every() check ensures Haiku only fires if ALL last tools were dispatch-only.
      //   If last batch included batch_product_lookup + zoho_update_record, Sonnet runs.
      const _lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
      const _lastToolNames = _lastAssistantMsg && Array.isArray(_lastAssistantMsg.content)
        ? _lastAssistantMsg.content.filter(b => b.type === 'tool_use').map(b => b.name)
        : [];
      const _executionTools = new Set(['zoho_update_record', 'send_email']);
      const _inPureExecMode = useTools
        && _lastToolNames.length > 0
        && _lastToolNames.every(n => _executionTools.has(n));
      const activeModel = (useTools && iteration > 2 && _inPureExecMode)
        ? 'claude-haiku-4-5-20251001'
        : 'claude-sonnet-4-20250514';
      if (useTools) {
        console.log(`[GCHAT-AGENT] Model: ${activeModel} (iter=${iteration}, pureExec=${_inPureExecMode}, lastTools=${_lastToolNames.join(',')})`);
      }

      // Dynamic max_tokens for speed:
      // - Iteration 0-1: 4096 (planning + first tool calls, needs room for parallel calls)
      // - Iteration 2-3: 1536 (tool results + next tool calls, compact JSON payloads)
      // - Iteration 4+: 1024 (finishing up, formatting response)
      // - Haiku exec steps: 1024 (just dispatching update/send, minimal reasoning)
      const maxTok = _inPureExecMode ? 1024 : (iteration <= 1 ? 4096 : (iteration <= 3 ? 1536 : 1024));
      const requestBody = {
        model: activeModel,
        max_tokens: maxTok,
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

        // Parse error body for specific messages
        let parsedErr = {};
        try { parsedErr = JSON.parse(errBody); } catch (_) {}
        const errMsg = parsedErr?.error?.message || '';

        if (response.status === 529) {
          return `The AI service is temporarily overloaded. Please try again in a minute.`;
        }
        if (response.status === 429) {
          return `I'm being rate-limited right now. Please wait 30 seconds and try again.`;
        }
        if (response.status === 400 && errMsg.includes('credit balance')) {
          return `⚠️ The AI service account is out of credits. Please top up the Anthropic API balance at console.anthropic.com, then try again.`;
        }
        return useTools
          ? `Sorry, I couldn't process that CRM/email request (API ${response.status}). Please try again shortly.`
          : `Sorry, I couldn't process that request (API ${response.status}). Try a specific SKU like "quote 10 MR44".`;
      }

      const data = await response.json();
      console.log(`[GCHAT-AGENT] Response: stop_reason=${data.stop_reason}, content_blocks=${data.content?.length}, usage=${JSON.stringify(data.usage || {})}`);

      // Track API usage
      const usageSource = useTools ? 'crm-agent' : 'gchat-quote';
      trackUsage(env, activeModel, data.usage, usageSource).catch(() => {});

      // Check if Claude wants to use tools
      if (data.stop_reason === 'tool_use') {
        console.log(`[GCHAT-AGENT] Tool use iteration ${iteration}`);

        // Non-CRM path: strip base64 images after first iteration to save tokens.
        // Claude already analyzed the image; resending it wastes ~100K+ tokens per iteration.
        if (!useTools && iteration === 1) {
          for (const msg of messages) {
            if (msg.role === 'user' && Array.isArray(msg.content)) {
              msg.content = msg.content.map(block =>
                block.type === 'image' ? { type: 'text', text: '[Image already analyzed in first turn]' } : block
              );
            }
          }
        }

        // Add Claude's response (with tool_use blocks) to messages
        messages.push({ role: 'assistant', content: data.content });

        // Execute each tool call and collect results
        // Collect any interim text Claude narrated before the tool calls
        const interimText = data.content
          .filter(b => b.type === 'text' && b.text.trim().length > 0)
          .map(b => b.text.trim())
          .join('\n');

        // Non-CRM path: accumulate interim text across iterations
        if (!useTools && interimText) {
          accumulatedText += interimText + '\n\n';
        }

        const toolBlocks = data.content.filter(b => b.type === 'tool_use');

        // Fire-and-forget progress update for all tools in this batch
        if (progressCallback && toolBlocks.length > 0) {
          const progressMsg = toolBlocks.map(b => toolProgressMessage(b.name, b.input)).join('\n');
          const fullProgress = interimText ? `${interimText}\n\n${progressMsg}` : progressMsg;
          try { progressCallback(fullProgress).catch(() => {}); } catch (e) { /* ignore */ }
        }

        // Execute tool calls with CRM speed optimizations:
        // 1. Dedup: if multiple zoho_search_records target Quotes, only run the first
        // 2. Cache: auto-expanded Quote data is cached; zoho_get_record on cached Quotes is free
        // 3. Higher truncation limit for Quote data (Quoted_Items can be large)
        let _quotesSearchDone = false; // track if we already ran a Quote search this iteration
        const toolPromises = toolBlocks.map(async (block) => {
          console.log(`[GCHAT-AGENT] Calling tool: ${block.name}`, JSON.stringify(block.input).substring(0, 200));

          // DEDUP: Skip duplicate Quote searches in the same iteration
          if (block.name === 'zoho_search_records' && block.input?.module_name === 'Quotes') {
            if (_quotesSearchDone) {
              console.log(`[GCHAT-AGENT] Skipping duplicate Quotes search (already ran one this iteration)`);
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: '{"info":"Duplicate Quotes search skipped — use results from the first search above."}'
              };
            }
            _quotesSearchDone = true;
          }

          // SKIP: If a Quote search is in this same batch, skip any zoho_get_record on Quotes.
          // The search auto-expands the first result with full Quoted_Items — no separate get needed.
          // Also check cross-iteration cache for get_record calls that come in later iterations.
          if (block.name === 'zoho_get_record' && block.input?.module_name === 'Quotes') {
            if (_quotesSearchDone) {
              console.log(`[GCHAT-AGENT] Skipping Quote get_record (search in same batch auto-expands)`);
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: '{"info":"Quote details already included in the search results above via auto-expand. Look for the _auto_expanded:true record which contains Quoted_Items, Grand_Total, Quote_Stage, etc."}'
              };
            }
            if (_expandedQuoteCache[block.input?.record_id]) {
              console.log(`[GCHAT-AGENT] Cache hit for Quote ${block.input.record_id} — skipping API call`);
              const cached = _expandedQuoteCache[block.input.record_id];
              return {
                type: 'tool_result',
                tool_use_id: block.id,
                content: cached.length > 8000 ? cached.substring(0, 8000) + '...(truncated)' : cached
              };
            }
          }

          // Handle build_quote_url locally (deterministic, no external API call)
          if (block.name === 'build_quote_url') {
            const quoteResult = handleQuoteUrlTool(block.input);
            console.log(`[GCHAT-AGENT] build_quote_url → ${quoteResult.url?.substring(0, 80)}...`);
            // Non-CRM path: track the URL for deferred fallback injection (don't inject yet).
            // Only inject at the end if Claude's combined text doesn't include the URL.
            if (!useTools && quoteResult.url) {
              toolUrls.push({ url: quoteResult.url, label: quoteResult.label || 'Quote URL' });
            }
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(quoteResult)
            };
          }

          const result = await executeToolCall(block.name, block.input, env);
          const resultStr = typeof result === 'string' ? result : JSON.stringify(result);
          console.log(`[GCHAT-AGENT] Tool result (${block.name}): ${resultStr.substring(0, 200)}`);

          // Cache auto-expanded Quote results for future get_record calls
          if (block.name === 'zoho_search_records' && block.input?.module_name === 'Quotes') {
            try {
              const parsed = JSON.parse(resultStr);
              if (parsed?.data?.[0]?._auto_expanded) {
                _expandedQuoteCache[parsed.data[0].id] = JSON.stringify({ data: [parsed.data[0]] });
                console.log(`[GCHAT-AGENT] Cached auto-expanded Quote ${parsed.data[0].id}`);
              }
            } catch (_) {}
          }

          // Higher truncation limit for Quote data (search results now include Quoted_Items via auto-expand)
          // Also include zoho_update_record on Quotes so Admin Action responses (with CCW_Deal_Number etc.) aren't truncated
          const isQuoteData = (block.input?.module_name === 'Quotes') &&
                              ['zoho_get_record', 'zoho_search_records', 'zoho_update_record'].includes(block.name);
          const truncLimit = isQuoteData ? 8000 : 2000;
          return {
            type: 'tool_result',
            tool_use_id: block.id,
            content: resultStr.length > truncLimit ? resultStr.substring(0, truncLimit) + '...(truncated)' : resultStr
          };
        });

        const toolResults = await Promise.all(toolPromises);

        // Add tool results to messages
        messages.push({ role: 'user', content: toolResults });

        // Message compaction: when conversation grows beyond 4 messages,
        // replace older tool_result contents with a brief summary to keep
        // the Anthropic API payload small (faster calls = more iterations within wall clock).
        if (messages.length > 4) {
          for (let i = 1; i < messages.length - 2; i++) {
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

      // Handle max_tokens truncation: Claude ran out of output tokens mid-response.
      // Add what we have to messages and loop again so Claude can continue.
      if (data.stop_reason === 'max_tokens' && useTools && iteration < MAX_TOOL_ITERATIONS) {
        console.log(`[GCHAT-AGENT] max_tokens hit at iteration ${iteration}, continuing...`);
        messages.push({ role: 'assistant', content: data.content });
        // Send any partial text as progress
        const partialText = data.content.filter(b => b.type === 'text').map(b => b.text).join('');
        if (partialText && progressCallback) {
          try { progressCallback(partialText).catch(() => {}); } catch (_) {}
        }
        // Ask Claude to continue from where it left off
        messages.push({ role: 'user', content: '[System: Your response was truncated due to length. Continue from where you left off. Do not repeat what you already said.]' });
        continue;
      }

      // Claude returned a final text response (stop_reason = 'end_turn')
      const textBlocks = data.content.filter(b => b.type === 'text');
      let reply;

      if (!useTools && accumulatedText) {
        // Non-CRM path with tool-use: combine accumulated text + final response
        let finalText = textBlocks.map(b => b.text).join('\n');
        if (finalText) accumulatedText += finalText;

        // Deferred URL injection: only inject tool-generated URLs that Claude's combined
        // text (intermediate + final) doesn't already contain. This prevents duplicates
        // regardless of whether Claude placed URLs in intermediate or final iterations.
        if (toolUrls.length > 0) {
          const missingUrls = toolUrls.filter(({ url }) => !accumulatedText.includes(url));
          if (missingUrls.length > 0) {
            const fallbackBlock = missingUrls.map(({ url, label }) =>
              `**${label}:** ${url}`
            ).join('\n\n');
            accumulatedText = fallbackBlock + '\n\n' + accumulatedText;
          }
        }

        reply = accumulatedText.replace(/\n{3,}/g, '\n\n').trim() || 'Sorry, I could not generate a response.';
      } else {
        // CRM path or no tool-use: use final text as-is
        reply = textBlocks.map(b => b.text).join('\n');
      }
      console.log(`[GCHAT-AGENT] Final response at iteration ${iteration}, stop_reason=${data.stop_reason}, reply_len=${reply.length}, reply_preview="${reply.substring(0, 150)}"`);

      if (personId) {
        await addToHistory(kv, personId, 'user', userMessage);
        await addToHistory(kv, personId, 'assistant', reply);

        // CRM context persistence: extract key record IDs from tool results
        // so follow-up messages can skip re-searching. Scan messages for Zoho
        // tool results containing Quote, Deal, or Account data.
        if (useTools && kv) {
          try {
            const crmCtx = {};
            for (const msg of messages) {
              if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
              for (const block of msg.content) {
                if (block.type !== 'tool_result' || !block.content) continue;
                const raw = typeof block.content === 'string' ? block.content : '';
                // Extract Quote context from create_record responses (which lack Quoted_Items)
                // zoho_create_record returns: {data: [{status: "success", details: {id: "..."}, message: "record added"}]}
                if (raw.includes('"record added"') && raw.includes('"details"')) {
                  try {
                    const parsed = JSON.parse(raw);
                    const rec = parsed?.data?.[0];
                    if (rec?.status === 'success' && rec?.details?.id) {
                      // Check the tool_use block preceding this result to identify the module
                      const prevIdx = messages.indexOf(msg) - 1;
                      const prevMsg = prevIdx >= 0 ? messages[prevIdx] : null;
                      if (prevMsg?.role === 'assistant' && Array.isArray(prevMsg.content)) {
                        const toolUse = prevMsg.content.find(b => b.type === 'tool_use' && b.id === block.tool_use_id);
                        if (toolUse?.input?.module_name === 'Quotes') {
                          crmCtx.quote_id = rec.details.id;
                        } else if (toolUse?.input?.module_name === 'Deals') {
                          crmCtx.deal_id = rec.details.id;
                        }
                      }
                    }
                  } catch (_) {}
                }
                // Extract Quote context (from search, get_record, or update_record responses)
                if (raw.includes('"Quoted_Items"') || raw.includes('"Quote_Number"') || raw.includes('"CCW_Deal_Number"')) {
                  try {
                    const parsed = JSON.parse(raw.replace(/\.\.\.\(truncated\)$/, '').replace(/\.\.\.\(compacted\)$/, ''));
                    const rec = parsed?.data?.[0] || parsed;
                    if (rec?.id) {
                      crmCtx.quote_id = rec.id;
                      crmCtx.quote_number = rec.Quote_Number || crmCtx.quote_number || null;
                      crmCtx.account_name = rec.Account_Name?.name || crmCtx.account_name || null;
                      crmCtx.account_id = rec.Account_Name?.id || crmCtx.account_id || null;
                      crmCtx.deal_id = rec.Deal_Name?.id || crmCtx.deal_id || null;
                      // Capture CCW Deal Number (DID) when present from Admin Action results
                      if (rec.CCW_Deal_Number) crmCtx.ccw_deal_number = rec.CCW_Deal_Number;
                      // Compact line items: product code + qty + line item ID
                      if (rec.Quoted_Items) {
                        crmCtx.line_items = rec.Quoted_Items.map(i => ({
                          id: i.id,
                          sku: i.Product_Code || i.Product_Name?.Product_Code || i.Product_Name,
                          qty: i.Quantity,
                          product_id: i.product_id || i.Product_Name?.id
                        }));
                      }
                    }
                  } catch (_) {}
                }
                // Extract Account context
                if (raw.includes('"Account_Name"') && !crmCtx.account_id) {
                  try {
                    const parsed = JSON.parse(raw.replace(/\.\.\.\(truncated\)$/, '').replace(/\.\.\.\(compacted\)$/, ''));
                    const rec = parsed?.data?.[0] || parsed;
                    if (rec?.Account_Name) {
                      crmCtx.account_name = rec.Account_Name?.name || rec.Account_Name;
                      crmCtx.account_id = rec.Account_Name?.id || null;
                    }
                  } catch (_) {}
                }
              }
            }
            if (Object.keys(crmCtx).length > 0) {
              await kv.put(`crm_context_${personId}`, JSON.stringify(crmCtx), { expirationTtl: 900 });
              console.log(`[GCHAT] Saved CRM context for ${personId}: quote=${crmCtx.quote_id}, acct=${crmCtx.account_name}`);
            }
          } catch (ctxErr) {
            console.error(`[GCHAT] CRM context save error:`, ctxErr.message);
          }
        }
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

// ═══════════════════════════════════════════════════════════════════════════════
// Cloudflare Workflow: Durable CRM Execution
// ═══════════════════════════════════════════════════════════════════════════════
// Replaces Queue-based CRM dispatch with per-step retries and durable state.
// Each step is independently retriable — if Zoho times out, only that step
// re-runs, not the entire agentic loop.
//
// Dispatch priority: CRM_WORKFLOW → CRM_QUEUE → ctx.waitUntil
// ═══════════════════════════════════════════════════════════════════════════════
export class CrmWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { text, personId, spaceName, threadName, imageDataKey } = event.payload;

    if (!spaceName) {
      throw new Error('[WORKFLOW] No spaceName in payload — cannot deliver response');
    }

    const env = this.env;
    const workflowStart = Date.now();
    console.log(`[WORKFLOW] Starting CRM workflow for: "${(text || '').substring(0, 80)}..."`);

    // Step 1: Load live prices from shared KV
    await step.do('load-prices', async () => {
      if (env.CONVERSATION_KV) {
        await loadLivePrices(env);
      }
      return true;
    });

    // Step 2: Send "Working on it..." progress message
    const progressMsgName = await step.do('send-progress',
      { retries: { limit: 2, delay: '2 seconds' } },
      async () => {
        try {
          const msg = await sendAsyncGChatMessage(spaceName, '⏳ Working on it...', null, env);
          return msg?.name || null;
        } catch (err) {
          console.error(`[WORKFLOW] Failed to send progress: ${err.message}`);
          return null; // Non-fatal: proceed without progress updates
        }
      }
    );

    // Step 3: Run the CRM agentic loop (main work)
    // This is the heavy step — askClaude may make multiple Zoho + Anthropic calls.
    // Timeout: 5 minutes. Retry once on failure (covers transient API errors).
    const result = await step.do('process-crm',
      { retries: { limit: 1, delay: '5 seconds' }, timeout: '5 minutes' },
      async () => {
        // Reload live prices in case this step was retried (module state is lost on retry)
        if (env.CONVERSATION_KV) await loadLivePrices(env);

        // Retrieve image data from KV if the caller stored it there
        let imageData = null;
        if (imageDataKey) {
          try {
            imageData = await env.CONVERSATION_KV.get(imageDataKey, 'json');
            await env.CONVERSATION_KV.delete(imageDataKey); // Clean up temp key
          } catch (_) {}
        }

        // Progress callback: update the "Working on it..." message with step details
        let _stepLog = [];
        const progressCallback = progressMsgName
          ? async (stepMsg) => {
              if (!stepMsg) return;
              const lines = stepMsg.split('\n').filter(l => /^[🔍📄🔗✏️📦🌐📧✍️📤⚙️]/.test(l.trim()));
              for (const line of lines) {
                const trimmed = line.trim();
                if (_stepLog.length === 0 || _stepLog[_stepLog.length - 1] !== trimmed) {
                  _stepLog.push(trimmed);
                }
              }
              const recentSteps = _stepLog.slice(-5);
              const display = recentSteps.length > 0
                ? `⏳ *Working on it...*\n\n${recentSteps.join('\n')}`
                : '⏳ Working on it...';
              try { await updateGChatMessage(progressMsgName, display, env); } catch (_) {}
            }
          : async () => {};

        const reply = await askClaude(text, personId, env, imageData, true, progressCallback, 300000);
        let finalReply = typeof reply === 'string' ? reply : (reply?.reply || 'Done.');
        finalReply = adaptMarkdownForGChat(finalReply);
        finalReply = truncateGChatReply(finalReply);
        return finalReply;
      }
    );

    // Step 4: Deliver final response to Google Chat
    await step.do('deliver-response',
      { retries: { limit: 3, delay: '2 seconds', backoff: 'linear' } },
      async () => {
        let delivered = false;
        if (progressMsgName) {
          try {
            delivered = await updateGChatMessage(progressMsgName, result, env);
            if (delivered) console.log(`[WORKFLOW] Final response PATCH'd onto ${progressMsgName}`);
          } catch (patchErr) {
            console.warn(`[WORKFLOW] PATCH failed: ${patchErr.message}`);
          }
        }
        if (!delivered) {
          await sendAsyncGChatMessage(spaceName, result, null, env);
        }
        return delivered;
      }
    );

    // Step 5: Update conversation history in KV
    await step.do('update-history',
      { retries: { limit: 2, delay: '1 second' } },
      async () => {
        const kv = env.CONVERSATION_KV;
        if (personId && kv) {
          await addToHistory(kv, personId, 'user', text);
          await addToHistory(kv, personId, 'assistant', result);
          await kv.put(`crm_session_${personId}`, 'active', { expirationTtl: 600 });
        }
        return true;
      }
    );

    console.log(`[WORKFLOW] Completed in ${Date.now() - workflowStart}ms`);
    return { success: true, spaceName, textLength: result?.length || 0 };
  }
}

export default {
  async fetch(request, env, ctx) {
    // Load KV-cached live prices (if available from daily cron refresh)
    // This is fast: reads KV once, then cached in-memory for 5 minutes per isolate
    if (env.CONVERSATION_KV) {
      await loadLivePrices(env);
    }

    const url = new URL(request.url);
    // ── Dashboard Manifest: auto-written to KV on first request after deploy ──
    const WORKER_MANIFEST = {
      worker: 'gchat',
      version: '2.0.0-cf',
      deployedAt: new Date().toISOString(),
      routes: ['POST /', 'POST /_refresh-prices', 'GET /_prices-status', 'GET /_new-skus', 'GET /_debug-errors', 'GET /_admin/usage', 'POST /_work', 'POST /_continue', 'CRON 0 11 * * *'],
      handlers: [
        {id:'gc-trigger',name:'GChat Webhook',type:'trigger',fn:'fetch()'},
        {id:'gc-jwt',name:'JWT Verify',type:'decision',fn:'verifyGoogleJwt()'},
        {id:'gc-addon',name:'Source Check',type:'decision',fn:'addon vs chat'},
        {id:'gc-text',name:'Extract Text',type:'action',fn:'extractMessageText()'},
        {id:'gc-session',name:'CRM Session',type:'decision',fn:'kv session check'},
        {id:'gc-followup',name:'CRM Follow-up',type:'decision',fn:'crmFollowUp detection'},
        {id:'gc-pricing',name:'Pricing Calculator',type:'action',fn:'handlePricingRequest()'},
        {id:'gc-parse',name:'parseMessage',type:'action',fn:'parseMessage()'},
        {id:'gc-build',name:'Build Quote',type:'action',fn:'buildQuoteResponse()'},
        {id:'gc-intent',name:'CRM Intent',type:'decision',fn:'detectCrmEmailIntent()'},
        {id:'gc-dispatch',name:'CRM Dispatch',type:'workflow',fn:'CRM_WORKFLOW/CRM_QUEUE'},
        {id:'gc-workflow',name:'CRM Workflow',type:'workflow',fn:'CrmWorkflow class'},
        {id:'gc-agent',name:'CRM Agent',type:'api',fn:'handleCrmRequest()'},
        {id:'gc-claude',name:'Claude Fallback',type:'api',fn:'askClaude()'},
        {id:'gc-respond',name:'Send Response',type:'output',fn:'sendGChatMessage()'},
        {id:'gc-d1',name:'D1 + Analytics',type:'storage',fn:'ANALYTICS_DB + BOT_METRICS'},
        {id:'gc-history',name:'Update History',type:'storage',fn:'addToHistory()'},
        {id:'cr-trigger',name:'Price Cron',type:'trigger',fn:'scheduled()'},
        {id:'cr-zoho',name:'Zoho WooProducts',type:'api',fn:'fetchWooProduct()'},
        {id:'cr-kv',name:'KV Price Write',type:'storage',fn:'PRICES_KV.put()'}
      ],
      bindings: {kv:'CONVERSATION_KV',d1:'ANALYTICS_DB',ae:'BOT_METRICS',ai:'AI_GATEWAY',workflow:'CRM_WORKFLOW',queue:'CRM_QUEUE'}
    };
    if (!globalThis.__manifestWritten) {
      globalThis.__manifestWritten = true;
      ctx.waitUntil((async () => {
        try { await env.CONVERSATION_KV.put('dashboard_manifest_gchat', JSON.stringify(WORKER_MANIFEST), {expirationTtl:86400}); }
        catch(e) { console.warn('Manifest write failed:', e.message); }
      })());
    }
    // ── Dashboard API (consumed by stratus-dashboard.pages.dev) ──
    const DASH_CORS = {'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, OPTIONS','Access-Control-Allow-Headers':'Content-Type, X-Dashboard-Key'};
    if (url.pathname.startsWith('/dashboard/')) {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: DASH_CORS });
      const dashKey = request.headers.get('X-Dashboard-Key') || url.searchParams.get('key');
      if (dashKey !== 'stratus2026') return new Response(JSON.stringify({error:'Unauthorized'}), {status:401, headers:DASH_CORS});
      const db = env.ANALYTICS_DB;

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
      return new Response(JSON.stringify({error:'Not found'}), {status:404, headers:DASH_CORS});
    }

    // Log ALL incoming requests for debugging
    console.log(`[GCHAT-DEBUG] ${request.method} ${url.pathname} from ${request.headers.get('user-agent') || 'unknown'}`);

    // ── /_refresh-prices: Manual trigger for price refresh (same as cron) ──
    if (request.method === 'POST' && url.pathname === '/_refresh-prices') {
      // Reuse the scheduled handler logic
      try {
        await this.scheduled({ cron: 'manual' }, env, ctx);
        const result = await env.CONVERSATION_KV.get('prices_live', 'json');
        return new Response(JSON.stringify({
          ok: true,
          stats: result?.stats || {},
          refreshedAt: result?.refreshedAt
        }), { headers: { 'Content-Type': 'application/json' } });
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: err.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    }

    // ── /_debug-errors: Show recent API errors from KV ──
    if (request.method === 'GET' && url.pathname === '/_debug-errors') {
      const apiKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
      if (apiKey !== env.GMAIL_ADDON_API_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      const errors = [];
      // Check for recent api_error entries
      const kv = env.CONVERSATION_KV;
      const list = await kv.list({ prefix: 'api_error_', limit: 10 });
      for (const key of list.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) errors.push({ key: key.name, ...val });
      }
      // Check for api_exception entries
      const exceptions = await kv.list({ prefix: 'api_exception_', limit: 10 });
      for (const key of exceptions.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) errors.push({ key: key.name, ...val });
      }
      // Check for work_error entries
      const workErrors = await kv.list({ prefix: 'work_error_', limit: 10 });
      for (const key of workErrors.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) errors.push({ key: key.name, ...val });
      }
      // Check for agent_log entries (most recent iteration state)
      const agentLogs = await kv.list({ prefix: 'agent_log_', limit: 5 });
      const logs = [];
      for (const key of agentLogs.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) logs.push({ key: key.name, ...val });
      }
      // Check for handoff_alive entries (ctx.waitUntil diagnostic)
      const aliveEntries = await kv.list({ prefix: 'handoff_alive_', limit: 5 });
      const alive = [];
      for (const key of aliveEntries.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) alive.push({ key: key.name, ...val });
      }
      // Check for debug_work entries (spaceName diagnostic)
      const debugWork = await kv.list({ prefix: 'debug_work_', limit: 5 });
      const workDebug = [];
      for (const key of debugWork.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) workDebug.push({ key: key.name, ...val });
      }
      // Check for debug_init_send_err entries (initial "Working on it" failure)
      const initErrList = await kv.list({ prefix: 'debug_init_send_err_', limit: 5 });
      const initErrs = [];
      for (const key of initErrList.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) initErrs.push({ key: key.name, ...val });
      }
      // Check for update_err entries (updateGChatMessage failure)
      const updateErrList = await kv.list({ prefix: 'update_err_', limit: 5 });
      const updateErrs = [];
      for (const key of updateErrList.keys) {
        const val = await kv.get(key.name, 'json');
        if (val) updateErrs.push({ key: key.name, ...val });
      }
      return new Response(JSON.stringify({ errors, logs, alive, workDebug, initErrs, updateErrs, errorCount: errors.length, logCount: logs.length }, null, 2), {
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── /_prices-status: Check last refresh status ──
    if (request.method === 'GET' && url.pathname === '/_prices-status') {
      const result = await env.CONVERSATION_KV.get('prices_live', 'json');
      const error = await env.CONVERSATION_KV.get('prices_live_error', 'json');
      return new Response(JSON.stringify({
        hasLivePrices: !!result,
        refreshedAt: result?.refreshedAt || null,
        stats: result?.stats || null,
        lastError: error || null
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── /_new-skus: Check for newly discovered WooProducts SKUs ──
    if (request.method === 'GET' && url.pathname === '/_new-skus') {
      const newSkus = await env.CONVERSATION_KV.get('new_skus_detected', 'json');
      return new Response(JSON.stringify({
        hasNewSkus: !!newSkus?.skus?.length,
        count: newSkus?.skus?.length || 0,
        detectedAt: newSkus?.detectedAt || null,
        skus: newSkus?.skus || []
      }), { headers: { 'Content-Type': 'application/json' } });
    }

    // ── /_admin/usage: API cost tracking dashboard ──
    if (request.method === 'GET' && url.pathname === '/_admin/usage') {
      const apiKey = request.headers.get('X-API-Key') || url.searchParams.get('key');
      if (apiKey !== env.GMAIL_ADDON_API_KEY) {
        return new Response('Unauthorized', { status: 401 });
      }
      const now = new Date();
      const monthParam = url.searchParams.get('month'); // e.g. "2026-03"
      let year, month;
      if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
        [year, month] = monthParam.split('-');
      } else {
        year = now.getFullYear();
        month = String(now.getMonth() + 1).padStart(2, '0');
      }
      const monthKey = `usage_${year}_${month}`;
      const data = await env.CONVERSATION_KV.get(monthKey, 'json');
      if (!data) {
        return new Response(JSON.stringify({
          month: `${year}-${month}`,
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCostUsd: 0,
          requestCount: 0,
          bySource: {},
          recentRequests: []
        }), { headers: { 'Content-Type': 'application/json' } });
      }
      // Round cost for readability
      data.totalCostUsd = Math.round(data.totalCostUsd * 1_000_000) / 1_000_000;
      for (const src in data.bySource) {
        data.bySource[src].costUsd = Math.round(data.bySource[src].costUsd * 1_000_000) / 1_000_000;
      }
      // Return HTML dashboard if ?format=html, otherwise JSON
      if (url.searchParams.get('format') === 'html') {
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Stratus AI - API Usage</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;background:#f5f7fa;color:#333;padding:20px}
.container{max-width:900px;margin:0 auto}.header{background:#1a73a7;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0;display:flex;align-items:center;gap:12px}
.header h1{font-size:20px;font-weight:600}.header .month{font-size:14px;opacity:.8;margin-left:auto}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding:16px;background:#fff;border-bottom:1px solid #e5e8ec}
.stat{text-align:center;padding:12px}.stat .value{font-size:24px;font-weight:700;color:#1a73a7}.stat .label{font-size:11px;color:#666;text-transform:uppercase;margin-top:4px}
.section{background:#fff;padding:16px 20px;border-bottom:1px solid #e5e8ec}.section h2{font-size:14px;font-weight:600;margin-bottom:10px;color:#555}
table{width:100%;border-collapse:collapse;font-size:13px}th{text-align:left;padding:6px 8px;border-bottom:2px solid #e5e8ec;font-weight:600;color:#666}
td{padding:6px 8px;border-bottom:1px solid #f0f2f5}.cost{color:#1a73a7;font-weight:600}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}
.badge-gchat{background:#e8f5e9;color:#2e7d32}.badge-addon{background:#e3f2fd;color:#1565c0}.badge-crm{background:#fff3e0;color:#e65100}.badge-email{background:#fce4ec;color:#c62828}
.footer{background:#fff;padding:12px 20px;border-radius:0 0 12px 12px;font-size:11px;color:#999;text-align:center}
.nav{padding:12px 20px;background:#fff;display:flex;gap:8px;border-bottom:1px solid #e5e8ec}
.nav a{padding:4px 12px;border-radius:4px;text-decoration:none;font-size:12px;background:#f0f2f5;color:#555}.nav a:hover{background:#e3e6ea}
</style></head><body><div class="container">
<div class="header"><svg width="32" height="32" viewBox="0 0 256 256"><circle cx="128" cy="128" r="128" fill="#fff" opacity=".2"/><text x="128" y="170" font-size="160" font-weight="700" fill="#fff" text-anchor="middle" font-family="Arial">S</text></svg>
<h1>Stratus AI Usage</h1><span class="month">${data.month}</span></div>
<div class="nav">${(() => {
  const months = [];
  for (let i = 0; i < 3; i++) {
    const d = new Date(parseInt(year), parseInt(month) - 1 - i, 1);
    const m = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
    months.push('<a href="/_admin/usage?key=' + apiKey + '&format=html&month=' + m + '">' + m + '</a>');
  }
  return months.join('');
})()}</div>
<div class="stats">
<div class="stat"><div class="value">${data.requestCount}</div><div class="label">Requests</div></div>
<div class="stat"><div class="value">$${data.totalCostUsd.toFixed(4)}</div><div class="label">Total Cost</div></div>
<div class="stat"><div class="value">${(data.totalInputTokens/1000).toFixed(1)}k</div><div class="label">Input Tokens</div></div>
<div class="stat"><div class="value">${(data.totalOutputTokens/1000).toFixed(1)}k</div><div class="label">Output Tokens</div></div>
</div>
<div class="section"><h2>Cost by Source</h2><table><tr><th>Source</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost</th></tr>
${Object.entries(data.bySource).sort((a,b) => b[1].costUsd - a[1].costUsd).map(([src, s]) => {
  const badge = src.startsWith('addon') ? 'addon' : src.startsWith('crm') ? 'crm' : src.startsWith('email') ? 'email' : 'gchat';
  return '<tr><td><span class="badge badge-' + badge + '">' + src + '</span></td><td>' + s.requests + '</td><td>' + (s.inputTokens/1000).toFixed(1) + 'k</td><td>' + (s.outputTokens/1000).toFixed(1) + 'k</td><td class="cost">$' + s.costUsd.toFixed(4) + '</td></tr>';
}).join('')}
</table></div>
<div class="section"><h2>Recent Requests (last 50)</h2><table><tr><th>Time</th><th>Source</th><th>Model</th><th>In/Out</th><th>Cost</th></tr>
${(data.recentRequests || []).map(r => {
  const t = new Date(r.ts);
  const time = String(t.getMonth()+1).padStart(2,'0') + '/' + String(t.getDate()).padStart(2,'0') + ' ' + String(t.getHours()).padStart(2,'0') + ':' + String(t.getMinutes()).padStart(2,'0');
  const badge = r.source.startsWith('addon') ? 'addon' : r.source.startsWith('crm') ? 'crm' : r.source.startsWith('email') ? 'email' : 'gchat';
  const model = r.model.includes('haiku') ? 'Haiku' : 'Sonnet';
  return '<tr><td>' + time + '</td><td><span class="badge badge-' + badge + '">' + r.source + '</span></td><td>' + model + '</td><td>' + r.inputTokens + ' / ' + r.outputTokens + '</td><td class="cost">$' + r.costUsd.toFixed(6) + '</td></tr>';
}).join('')}
</table></div>
<div class="footer">Stratus AI Bot &middot; Cloudflare Workers &middot; AI Gateway: <a href="https://dash.cloudflare.com/ec1888c5a0b51dc3eebf6bae13a3922b/ai/ai-gateway/gateways/stratus-ai-bot" style="color:#1a73a7">Dashboard</a></div>
</div></body></html>`;
        return new Response(html, { headers: { 'Content-Type': 'text/html' } });
      }
      return new Response(JSON.stringify(data, null, 2), { headers: { 'Content-Type': 'application/json' } });
    }

    // ══════════════════════════════════════════════════════════════
    // ── /api/* endpoints: Gmail Add-on backend ──
    // Authenticated via X-API-Key header. Returns JSON responses.
    // These reuse the existing quoting engine, Claude API, and CRM
    // agent rather than duplicating any logic.
    // ══════════════════════════════════════════════════════════════
    if (url.pathname.startsWith('/api/')) {
      const apiKey = request.headers.get('X-API-Key');
      if (!apiKey || apiKey !== env.GMAIL_ADDON_API_KEY) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }

      // CORS preflight
      if (request.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
          }
        });
      }

      if (request.method !== 'POST') {
        return new Response(JSON.stringify({ error: 'Method not allowed' }), {
          status: 405, headers: { 'Content-Type': 'application/json' }
        });
      }

      const apiBody = await request.json();
      const jsonHeaders = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

      try {
        let apiResult;
        switch (url.pathname) {

          // ── Analyze Email: summary + detected SKUs + CRM sender lookup ──
          case '/api/analyze-email': {
            const { subject, body, senderEmail, senderName } = apiBody;
            if (!body && !subject) {
              return new Response(JSON.stringify({ error: 'subject or body required' }), { status: 400, headers: jsonHeaders });
            }

            // 1) Detect SKUs in the email body (with catalog validation to filter false positives)
            const fullText = (subject || '') + ' ' + (body || '');
            const parsed = parseMessage(fullText);
            const detectedSkus = [];
            if (parsed && parsed.items) {
              for (const item of parsed.items) {
                const baseSku = item.baseSku || item.sku;
                const validation = validateSku(baseSku);
                if (validation.valid) {
                  detectedSkus.push({ sku: baseSku, qty: item.qty });
                }
              }
            }

            // 2) CRM sender lookup (by email domain or name)
            let crmAccount = null;
            if (senderEmail) {
              try {
                const domain = senderEmail.split('@')[1];
                if (domain && !['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com', 'icloud.com'].includes(domain.toLowerCase())) {
                  // Search by website/domain (starts_with works for "easyice.com" matching "https://www.easyice.com")
                  const domainCore = domain.replace(/^(www\.)/i, '');
                  const acctResp = await zohoApiCall('GET',
                    `Accounts/search?criteria=(Website:starts_with:${encodeURIComponent(domainCore)})&fields=id,Account_Name,Phone,Website`, env
                  );
                  if (acctResp?.data?.[0]) {
                    crmAccount = acctResp.data[0];
                    // Try to get recent deals
                    try {
                      const dealsResp = await zohoApiCall('GET',
                        `Accounts/${crmAccount.id}/Deals?fields=id,Deal_Name,Stage,Amount&per_page=5`, env
                      );
                      if (dealsResp?.data) crmAccount.recentDeals = dealsResp.data;
                    } catch (_) {}
                  }
                }
                // Fallback: search contacts by email
                if (!crmAccount) {
                  const contactResp = await zohoApiCall('GET',
                    `Contacts/search?email=${encodeURIComponent(senderEmail)}&fields=id,First_Name,Last_Name,Email,Account_Name`, env
                  );
                  if (contactResp?.data?.[0]) {
                    const contact = contactResp.data[0];
                    if (contact.Account_Name?.id) {
                      const acctDetail = await zohoApiCall('GET',
                        `Accounts/${contact.Account_Name.id}?fields=id,Account_Name,Phone,Website`, env
                      );
                      if (acctDetail?.data?.[0]) {
                        crmAccount = acctDetail.data[0];
                        try {
                          const dealsResp = await zohoApiCall('GET',
                            `Accounts/${crmAccount.id}/Deals?fields=id,Deal_Name,Stage,Amount&per_page=5`, env
                          );
                          if (dealsResp?.data) crmAccount.recentDeals = dealsResp.data;
                        } catch (_) {}
                      }
                    }
                  }
                }
              } catch (crmErr) {
                console.error(`[API] CRM lookup error: ${crmErr.message}`);
              }
            }

            // 3) AI summary via Claude
            let summary = null, urgency = null, actionItems = [];
            try {
              const summaryResp = await fetch(ANTHROPIC_API_URL, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': env.ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                  model: 'claude-sonnet-4-20250514',
                  max_tokens: 500,
                  system: `You are a concise email analyzer for Chris Graves, Regional Sales Director at Stratus Information Systems (Cisco/Meraki reseller). Analyze the email and return ONLY valid JSON with these fields:
{
  "summary": "2-3 sentence summary of the email",
  "urgency": "low|medium|high",
  "actionItems": ["array of specific action items or requests"],
  "suggestedApproach": "brief suggestion for how to respond"
}
Return ONLY the JSON object, no markdown or extra text.`,
                  messages: [{ role: 'user', content: `Subject: ${subject}\nFrom: ${senderName} <${senderEmail}>\n\n${(body || '').substring(0, 6000)}` }]
                })
              });

              if (summaryResp.ok) {
                const summaryData = await summaryResp.json();
                ctx.waitUntil(trackUsage(env, 'claude-sonnet-4-20250514', summaryData.usage, 'addon-analyze'));
                const text = summaryData.content?.[0]?.text || '';
                try {
                  const parsed = JSON.parse(text.replace(/```json\n?|\n?```/g, '').trim());
                  summary = parsed.summary;
                  urgency = parsed.urgency;
                  actionItems = parsed.actionItems || [];
                } catch (_) {
                  summary = text.substring(0, 300);
                }
              }
            } catch (aiErr) {
              console.error(`[API] Claude summary error: ${aiErr.message}`);
              summary = 'Could not generate summary.';
            }

            apiResult = { summary, urgency, actionItems, detectedSkus, crmAccount };
            break;
          }

          // ── Draft Reply: AI-generated reply options with product intelligence ──
          case '/api/draft-reply': {
            const { subject, body, senderEmail, senderName, tone, instructions } = apiBody;
            if (!body && !subject) {
              return new Response(JSON.stringify({ error: 'subject or body required' }), { status: 400, headers: jsonHeaders });
            }

            const toneGuide = {
              warm: 'Friendly and personable. Use contractions. End with an engaging question.',
              professional: 'Polished but approachable. Clear and direct. End with a specific next step.',
              brief: 'Very concise, 2-3 sentences max. Get to the point fast. End with a question.',
              'follow-up': 'You are following up on a previous conversation. Be brief and professional (3-5 sentences). Your goal is to get an update or move the conversation forward. Reference the specific topic from the previous email. Always end with a direct question that elicits a response, such as: "Were you able to look into this?", "How is everything going so far?", "What has feedback been so far?", "Do you have any updates on this?", "When would be a good time to reconnect?" Never start with filler like "I hope this email finds you well." Get straight to the check-in.'
            };

            // Detect SKUs in the email to provide product context and quote URLs
            var detectedProducts = [];
            var quoteContext = '';
            try {
              const emailText = (subject || '') + ' ' + (body || '');
              const parsed = parseMessage(emailText);
              var validationNotes = [];  // Track disambiguation and validation messages
              if (parsed && parsed.items && parsed.items.length > 0) {
                for (var pi = 0; pi < parsed.items.length; pi++) {
                  var pItem = parsed.items[pi];
                  var baseSku = pItem.baseSku || pItem.sku;

                  // Run SKU validation to catch partial matches and common mistakes
                  var skuValidation = validateSku(baseSku);
                  if (!skuValidation.valid && skuValidation.suggest && skuValidation.suggest.length > 0) {
                    // SKU needs disambiguation (e.g. MS150-48FP → MS150-48FP-4G / MS150-48FP-4X)
                    validationNotes.push(baseSku + ' is not a complete SKU. Valid options: ' + skuValidation.suggest.join(', '));
                  }

                  var eolInfo = checkEol(baseSku);
                  detectedProducts.push({
                    sku: baseSku,
                    qty: pItem.qty || 1,
                    isEol: !!eolInfo,
                    replacement: eolInfo ? (Array.isArray(EOL_REPLACEMENTS[baseSku]) ? EOL_REPLACEMENTS[baseSku] : [EOL_REPLACEMENTS[baseSku]]) : null,
                    eolDate: EOL_DATES[baseSku] || null,
                    needsDisambiguation: !skuValidation.valid && skuValidation.suggest && skuValidation.suggest.length > 1,
                    suggestions: skuValidation.suggest || null
                  });
                }

                // Build quote URLs for detected products
                var quoteUrls = [];
                if (detectedProducts.some(function(p) { return p.isEol; })) {
                  // For EOL products, generate renewal + upgrade options
                  var renewItems = [];
                  var upgradeItems = [];
                  for (var di = 0; di < detectedProducts.length; di++) {
                    var dp = detectedProducts[di];
                    if (dp.isEol && dp.replacement) {
                      // Renewal (license only for existing hardware)
                      var licSkus = getLicenseSkus(dp.sku);
                      if (licSkus && licSkus.length > 0) {
                        renewItems.push({ sku: licSkus[0], qty: dp.qty }); // 1Y
                      }
                      // Upgrade to replacement
                      var repl = dp.replacement[0];
                      upgradeItems.push({ sku: repl, qty: dp.qty });
                      var replLic = getLicenseSkus(repl);
                      if (replLic && replLic.length > 0) {
                        upgradeItems.push({ sku: replLic[0], qty: dp.qty }); // 1Y
                      }
                    } else {
                      // Non-EOL: just license renewal
                      var neLic = getLicenseSkus(dp.sku);
                      if (neLic && neLic.length > 0) {
                        renewItems.push({ sku: neLic[0], qty: dp.qty });
                      }
                    }
                  }

                  // Build URLs using buildStratusUrl
                  if (renewItems.length > 0) {
                    quoteUrls.push({ label: 'License Renewal (1-Year)', url: buildStratusUrl(renewItems) });
                  }
                  if (upgradeItems.length > 0) {
                    quoteUrls.push({ label: 'Hardware Upgrade (1-Year)', url: buildStratusUrl(upgradeItems) });
                  }
                } else {
                  // Non-EOL products OR partial matches (variant disambiguation) — use full buildQuoteResponse
                  var builtResp = buildQuoteResponse(parsed);
                  var respText = builtResp.message || builtResp.text || '';
                  // Extract URLs from the response text
                  var urlRegex2 = /https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g;
                  var extractedUrls = respText.match(urlRegex2) || [];
                  var termLabels2 = ['1-Year', '3-Year', '5-Year'];
                  var currentOpt = '';
                  var optIdx2 = 0;
                  var respLines = respText.split('\n');
                  for (var rl = 0; rl < respLines.length; rl++) {
                    var optMatch2 = respLines[rl].match(/\*\*Option \d+[^*]*\*\*/) || respLines[rl].match(/^Option \d+/);
                    if (optMatch2) { currentOpt = (optMatch2[0] || '').replace(/\*\*/g, '').replace(/[—–:]/g, '').replace(/-+$/, '').trim(); optIdx2 = 0; }
                    var urlMatch2 = respLines[rl].match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/);
                    if (urlMatch2) {
                      var lbl = currentOpt ? currentOpt + ' (' + (termLabels2[optIdx2] || '') + ')' : termLabels2[quoteUrls.length] || 'Quote ' + (quoteUrls.length + 1);
                      quoteUrls.push({ label: lbl.trim(), url: urlMatch2[0] });
                      optIdx2++;
                    }
                  }
                }

                quoteContext = '\n\nPRODUCT INTELLIGENCE (use this for accurate recommendations):\n';
                // Include the full deterministic bot response so Claude can reference it
                if (builtResp) {
                  var botRespText = builtResp.message || builtResp.text || '';
                  if (botRespText) {
                    quoteContext += '\nDETERMINISTIC BOT RESPONSE (use this as the basis for your reply, do NOT contradict it):\n';
                    quoteContext += botRespText.replace(/\*\*/g, '').substring(0, 2000) + '\n';
                  }
                }
                quoteContext += 'Detected products in email: ' + detectedProducts.map(function(p) {
                  var info = p.sku + ' (qty: ' + p.qty + ')';
                  if (p.isEol) {
                    info += ' [END OF LIFE' + (p.eolDate ? ' as of ' + p.eolDate : '') + ', replacement: ' + p.replacement.join(' or ') + ']';
                  }
                  return info;
                }).join(', ') + '\n';
                if (quoteUrls.length > 0) {
                  quoteContext += 'Pre-built Stratus quote URLs to include in your reply:\n';
                  for (var qi = 0; qi < quoteUrls.length; qi++) {
                    quoteContext += '  ' + quoteUrls[qi].label + ': ' + quoteUrls[qi].url + '\n';
                  }
                }
                quoteContext += '\nIMPORTANT PRODUCT RULES:\n';
                quoteContext += '- NEVER recommend a product that is End of Life (EOL). Only recommend the listed replacement.\n';
                quoteContext += '- Always use the pre-built Stratus quote URLs above (https://stratusinfosystems.com/order/...) rather than inventing URLs.\n';
                quoteContext += '- If the customer needs a license renewal for existing hardware, provide the renewal URL.\n';
                quoteContext += '- If recommending an upgrade, provide the hardware upgrade URL.\n';
                quoteContext += '- Common EOL replacements: MX64->MX67, MX65->MX68, MX84->MX85, MX100->MX105, MS220->MS130, MS225->MS130, MS250->MS150, MS350->MS150.\n';

                // Add disambiguation notes if any SKUs need clarification
                if (validationNotes.length > 0) {
                  quoteContext += '\nSKU DISAMBIGUATION REQUIRED:\n';
                  for (var vn = 0; vn < validationNotes.length; vn++) {
                    quoteContext += '- ' + validationNotes[vn] + '\n';
                  }
                  quoteContext += '- IMPORTANT: When a SKU has multiple variants (e.g. 4G vs 4X uplinks), you MUST present ALL options to the customer and ask which variant they need. Do NOT just pick one.\n';
                  quoteContext += '- For MS150/MS450 switches, 4G = 1G uplinks, 4X = 10G uplinks. Present both and explain the difference.\n';
                  quoteContext += '- Do NOT generate quote URLs for ambiguous SKUs. Ask the customer to clarify first.\n';
                }
              }

              // Inject specs.json data for detected products AND their suggested variants
              var specLines = [];
              var specSkusToLookup = [];
              for (var si = 0; si < detectedProducts.length; si++) {
                specSkusToLookup.push(detectedProducts[si].sku);
                // Also look up specs for suggested variants (e.g. MS150-48FP-4G, MS150-48FP-4X)
                if (detectedProducts[si].suggestions) {
                  for (var sgi = 0; sgi < detectedProducts[si].suggestions.length; sgi++) {
                    specSkusToLookup.push(detectedProducts[si].suggestions[sgi]);
                  }
                }
              }
              for (var sli = 0; sli < specSkusToLookup.length; sli++) {
                var specSku = specSkusToLookup[sli];
                var specEntry = null;
                // Look up specs in each family
                for (var family of Object.keys(specs)) {
                  if (family.startsWith('_')) continue;
                  if (specs[family][specSku]) {
                    specEntry = specs[family][specSku];
                    break;
                  }
                }
                if (specEntry) {
                  specLines.push(specSku + ': ' + JSON.stringify(specEntry));
                }
              }
              if (specLines.length > 0) {
                quoteContext += '\nPRODUCT SPECIFICATIONS (use these for accuracy, do NOT guess specs):\n';
                quoteContext += specLines.join('\n') + '\n';
              }
            } catch (parseErr) {
              console.error('[API] Draft product detection error:', parseErr.message);
            }

            // Even if parseMessage didn't find SKUs, scan for product mentions and inject specs
            if (detectedProducts.length === 0) {
              try {
                var emailText = ((subject || '') + ' ' + (body || '')).toUpperCase();
                var specFallbackLines = [];
                for (var sfFamily of Object.keys(specs)) {
                  if (sfFamily.startsWith('_')) continue;
                  for (var sfModel of Object.keys(specs[sfFamily])) {
                    if (emailText.includes(sfModel.toUpperCase())) {
                      specFallbackLines.push(sfModel + ': ' + JSON.stringify(specs[sfFamily][sfModel]));
                    }
                  }
                }
                if (specFallbackLines.length > 0) {
                  quoteContext += '\nPRODUCT SPECIFICATIONS (use these for accuracy, do NOT guess specs):\n';
                  quoteContext += specFallbackLines.join('\n') + '\n';
                }
              } catch (specErr) {
                console.error('[API] Spec fallback scan error:', specErr.message);
              }
            }

            const draftResp = await fetch(ANTHROPIC_API_URL, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-api-key': env.ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01'
              },
              body: JSON.stringify({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1500,
                system: `You are drafting email replies for Chris Graves, Regional Sales Director at Stratus Information Systems (Cisco/Meraki exclusive reseller specializing in Meraki). Write in Chris's voice:

STYLE RULES:
- Personable, consultative, and concise
- Vary sentence structure; mix short and long sentences
- NEVER use em dashes (use commas, parentheses, or periods instead)
- Use contractions naturally: I'll, you're, that's, we've, can't, won't
- Keep paragraphs to 1-3 lines max with blank lines between
- ALWAYS end with a question or specific call to action
- Never start with "I hope this email finds you well" or similar filler
- Signature is handled separately, do NOT include one
- NEVER invent or fabricate URLs. Only use the pre-built Stratus quote URLs provided in the PRODUCT INTELLIGENCE section below.
- If no quote URLs are provided, do NOT include any URLs in the draft.

THREAD CHRONOLOGY:
- Pay close attention to the dates of messages in the email thread.
- The MOST RECENT message is the one you are replying to. Earlier messages are historical context.
- If a customer wrote months/years ago AND wrote again recently, they are following up separately. The recent message is the active request.
- Do not confuse old resolved conversations with the current request.
- Today's date: ${new Date().toISOString().split('T')[0]}

TONE: ${toneGuide[tone] || toneGuide.warm}
${quoteContext}
${instructions ? 'ADDITIONAL INSTRUCTIONS: ' + instructions : ''}

CRITICAL: Return ONLY a raw JSON object. No commentary, no explanation, no markdown code fences, no text before or after the JSON. Your entire response must be parseable by JSON.parse():
{"drafts": ["draft option 1", "draft option 2"], "suggestedProducts": [{"sku": "MX67", "qty": 1}]}

CRITICAL URL RULES:
- Do NOT include any URLs or hyperlinks anywhere in the draft text. Quote links are automatically generated and displayed separately by the sidebar UI.
- If you are recommending a specific Cisco/Meraki product, list it in "suggestedProducts" using the base SKU without suffixes (e.g. "MX67" not "MX67-HW", "MS130-24P" not "MS130-24P-HW"). Real Stratus quote links will be generated from this field.
- "suggestedProducts" is optional — omit the field entirely if you are not recommending specific hardware.
- Provide exactly 2 distinct reply options. Each draft is the complete email body text only (no subject, no signature). Use \\n for line breaks between paragraphs.`,
                messages: [{
                  role: 'user',
                  content: `Reply to this email:\n\nSubject: ${subject}\nFrom: ${senderName} <${senderEmail}>\n\n${(body || '').substring(0, 6000)}`
                }]
              })
            });

            if (!draftResp.ok) {
              apiResult = { error: 'Claude API error: ' + draftResp.status };
              break;
            }

            const draftData = await draftResp.json();
            ctx.waitUntil(trackUsage(env, 'claude-sonnet-4-20250514', draftData.usage, 'addon-draft'));
            const draftText = draftData.content?.[0]?.text || '';
            var parsedDraft;
            try {
              // Try direct parse first (clean JSON response)
              parsedDraft = JSON.parse(draftText.replace(/```json\n?|\n?```/g, '').trim());
            } catch (_) {
              // Extract JSON object from mixed text (Claude sometimes adds commentary before/after)
              try {
                var jsonMatch = draftText.match(/\{[\s\S]*"drafts"\s*:\s*\[[\s\S]*\]\s*[\s\S]*\}/);
                if (jsonMatch) {
                  parsedDraft = JSON.parse(jsonMatch[0]);
                } else {
                  parsedDraft = { drafts: [draftText.substring(0, 2000)] };
                }
              } catch (_2) {
                parsedDraft = { drafts: [draftText.substring(0, 2000)] };
              }
            }
            // Validate drafts array exists and has content
            if (!parsedDraft.drafts || !Array.isArray(parsedDraft.drafts) || parsedDraft.drafts.length === 0) {
              parsedDraft = { drafts: [draftText.replace(/```json\n?|\n?```/g, '').trim().substring(0, 2000)] };
            }

            // Build real Stratus URLs from suggestedProducts (products Claude recommends)
            // quoteUrls is only defined if SKUs were detected in the email body — guard against undefined
            var allQuoteUrls = (quoteUrls || []).slice(); // start with any pre-detected URLs from email content
            if (parsedDraft.suggestedProducts && parsedDraft.suggestedProducts.length > 0) {
              try {
                var sugSkuText = parsedDraft.suggestedProducts.map(function(p) {
                  return (p.qty || 1) + ' ' + p.sku;
                }).join(', ');
                var sugParsed = parseMessage(sugSkuText);
                if (sugParsed && sugParsed.items && sugParsed.items.length > 0) {
                  var sugResp = buildQuoteResponse(sugParsed);
                  var sugText = (sugResp && (sugResp.message || sugResp.text || sugResp.reply)) || '';
                  var sugUrlRegex = /https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g;
                  var sugUrlMatches = sugText.match(sugUrlRegex) || [];
                  var sugTermLabels = ['1-Year', '3-Year', '5-Year'];
                  var sugOptLabel = '';
                  var sugOptIdx = 0;
                  var sugLines = sugText.split('\n');
                  var sugUrlsParsed = [];
                  for (var sli = 0; sli < sugLines.length; sli++) {
                    var sLine = sugLines[sli];
                    var sOptMatch = sLine.match(/\*\*Option \d+[^*]*\*\*/) || sLine.match(/^Option \d+/);
                    if (sOptMatch) { sugOptLabel = (sOptMatch[0] || '').replace(/\*\*/g, '').replace(/[—–:]/g, '').replace(/-+$/, '').trim(); sugOptIdx = 0; }
                    var sUrlMatch = sLine.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/);
                    if (sUrlMatch) {
                      var sLabel = sugOptLabel
                        ? sugOptLabel + ' (' + (sugTermLabels[sugOptIdx] || '') + ')'
                        : sugTermLabels[sugUrlsParsed.length] || 'Quote ' + (sugUrlsParsed.length + 1);
                      sugUrlsParsed.push({ url: sUrlMatch[0], label: sLabel.trim() });
                      sugOptIdx++;
                    }
                  }
                  // Fallback to raw URL array if line-parse found nothing
                  if (sugUrlsParsed.length === 0 && sugUrlMatches.length > 0) {
                    sugUrlMatches.forEach(function(u, i) {
                      sugUrlsParsed.push({ url: u, label: sugTermLabels[i] || 'Quote ' + (i + 1) });
                    });
                  }
                  // Merge, avoiding duplicates
                  sugUrlsParsed.forEach(function(su) {
                    if (!allQuoteUrls.some(function(ex) { return ex.url === su.url; })) {
                      allQuoteUrls.push(su);
                    }
                  });
                }
              } catch (sugErr) {
                console.error('[API] suggestedProducts URL build error:', sugErr.message);
              }
            }

            // Inject quote URLs directly into each draft body so they appear
            // in the card preview and are included when "Create Gmail Draft" is clicked
            var rawDrafts = parsedDraft.drafts || [parsedDraft.draft || draftText.substring(0, 2000)];
            var finalDrafts = rawDrafts.map(function(draft) {
              if (allQuoteUrls.length === 0) return draft;
              var urlBlock = '\n\nFor your convenience, here' + (allQuoteUrls.length === 1 ? '\'s a quote link' : ' are some quote options') + ':';
              allQuoteUrls.forEach(function(q) {
                urlBlock += '\n' + q.label + ': ' + q.url;
              });
              return draft + urlBlock;
            });

            apiResult = {
              drafts: finalDrafts
            };
            if (allQuoteUrls.length > 0) {
              apiResult.quoteUrls = allQuoteUrls; // also returned for sidebar display
            }
            break;
          }

          // ── Quote: Full hybrid quoting engine — identical handler chain to Webex/GChat bot ──
          // Supports: EOL date lookups, quote confirmations, deterministic pricing,
          // SKU quotes with validation/suggestions, Claude AI fallback for advisory,
          // and conversation history for multi-turn interactions.
          case '/api/quote': {
            const { text, personId: reqPersonId } = apiBody;
            if (!text) {
              return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: jsonHeaders });
            }

            // Conversation history: use provided personId or generate ephemeral one
            const quotePersonId = reqPersonId || ('chrome-ext-' + Date.now());
            const kv = env.CONVERSATION_KV;

            // Store user message in conversation history
            await addToHistory(kv, quotePersonId, 'user', text);

            // Helper: extract URLs + labels from a buildQuoteResponse message string
            function extractQuoteUrls(responseText) {
              const urls = [];
              const tLabels = ['1-Year', '3-Year', '5-Year'];
              let curOption = '';
              let oIdx = 0;
              for (const line of responseText.split('\n')) {
                const optMatch = line.match(/\*\*Option \d+[^*]*\*\*/) || line.match(/^Option \d+/);
                if (optMatch) { curOption = (optMatch[0] || '').replace(/\*\*/g, '').replace(/[—–:]/g, '').replace(/-+$/, '').trim(); oIdx = 0; }
                const urlMatch = line.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/);
                if (urlMatch) {
                  const label = curOption
                    ? `${curOption} (${tLabels[oIdx] || ''})`
                    : tLabels[urls.length] || 'Quote ' + (urls.length + 1);
                  urls.push({ url: urlMatch[0], label: label.trim() });
                  oIdx++;
                }
              }
              if (urls.length === 0) {
                const rawUrls = responseText.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g) || [];
                rawUrls.forEach((u, i) => urls.push({ url: u, label: tLabels[i] || 'Quote ' + (i + 1) }));
              }
              return urls;
            }

            // Helper: store assistant response and return apiResult
            async function finalizeQuoteResponse(result, assistantText) {
              if (assistantText) {
                await addToHistory(kv, quotePersonId, 'assistant', assistantText);
              }
              return result;
            }

            // ────────────────────────────────────────────
            // STEP 1: EOL Date Lookup (deterministic)
            // Same as Webex bot: "when does MR44 go EOL?"
            // ────────────────────────────────────────────
            const eolDateReply = handleEolDateRequest(text);
            if (eolDateReply) {
              apiResult = await finalizeQuoteResponse({
                quoteUrls: [],
                eolWarnings: [],
                parsedItems: [],
                eolDateResponse: eolDateReply,
                handlerType: 'eol-date',
              }, eolDateReply);
              break;
            }

            // ────────────────────────────────────────────
            // STEP 2: Quote Confirmation (deterministic)
            // Same as Webex bot: user says "yes" after advisory
            // ────────────────────────────────────────────
            const quoteConfirmReply = await handleQuoteConfirmation(text, quotePersonId, kv);
            if (quoteConfirmReply) {
              const confirmUrls = extractQuoteUrls(quoteConfirmReply);
              apiResult = await finalizeQuoteResponse({
                quoteUrls: confirmUrls,
                eolWarnings: [],
                parsedItems: [],
                handlerType: 'quote-confirmation',
              }, quoteConfirmReply);
              break;
            }

            // ────────────────────────────────────────────
            // STEP 3: Deterministic Pricing Calculator
            // Same as Webex bot: "cost of option 2", "price of MR44"
            // ────────────────────────────────────────────
            const pricingReply = await handlePricingRequest(text, quotePersonId, kv);
            if (pricingReply) {
              apiResult = await finalizeQuoteResponse({
                quoteUrls: [],
                eolWarnings: [],
                parsedItems: [],
                pricingResponse: pricingReply,
                handlerType: 'pricing',
              }, pricingReply);
              break;
            }

            // ────────────────────────────────────────────
            // STEP 4: Pre-validate ALL SKU-like tokens from raw text
            // Catches SKUs that parseMessage might silently drop (e.g., "MS225", "MS130" without variant)
            // ────────────────────────────────────────────
            const rawSkuTokens = [...new Set(
              (text.toUpperCase().match(/\b((?:MR|MX|MV|MG|MS|MT|CW|C9|C8|Z)\d[\w-]*)\b/gi) || [])
                .map(s => s.toUpperCase())
                .filter(s => !s.startsWith('LIC-'))
            )];

            const parsed = parseMessage(text);

            // Clarification prompts (e.g. "which Duo tier?") — return as clarification response
            if (parsed && parsed.isClarification && parsed.clarificationMessage) {
              apiResult = {
                quoteUrls: [],
                eolWarnings: [],
                parsedItems: [],
                clarification: parsed.clarificationMessage,
                handlerType: 'clarification',
              };
              break;
            }

            const parsedSkuSet = new Set(
              (parsed?.items || []).map(i => (i.baseSku || i.sku || '').toUpperCase())
            );

            // Find SKU-like tokens that parseMessage dropped (couldn't resolve to a valid item)
            const droppedTokens = rawSkuTokens.filter(t => !parsedSkuSet.has(t));

            // Validate ALL tokens: both parsed items and dropped tokens
            const suggestions = [];
            const validItems = [];
            const parsedWithValidation = [];

            // Validate parsed items first
            // Skip validation for license SKUs (LIC-*) and passthrough items —
            // parseMessage already validated these when constructing the items.
            // validateSku only knows hardware models, not license SKU patterns.
            for (const item of (parsed?.items || [])) {
              const base = item.baseSku || item.sku;
              const upper = (base || '').toUpperCase();
              if (upper.startsWith('LIC-') || PASSTHROUGH.has(upper)) {
                // License/passthrough SKUs are valid by definition if parseMessage returned them
                parsedWithValidation.push({ sku: base, qty: item.qty, validation: { valid: true } });
                validItems.push(item);
              } else {
                const validation = validateSku(base);
                parsedWithValidation.push({ sku: base, qty: item.qty, validation });
                if (!validation.valid) {
                  suggestions.push({
                    input: base,
                    reason: validation.reason || `${base} is not a recognized SKU`,
                    suggest: validation.suggest || [],
                    isCommonMistake: !!validation.isCommonMistake,
                  });
                } else {
                  validItems.push(item);
                }
              }
            }

            // Validate dropped tokens — these were in the text but parseMessage couldn't handle them
            for (const token of droppedTokens) {
              const validation = validateSku(token);
              parsedWithValidation.push({ sku: token, qty: 1, validation });
              if (!validation.valid) {
                suggestions.push({
                  input: token,
                  reason: validation.reason || `${token} is not a recognized SKU — did you mean a specific variant?`,
                  suggest: validation.suggest || [],
                  isCommonMistake: !!validation.isCommonMistake,
                  wasDropped: true,
                });
              }
              // If dropped token IS valid/EOL, parseMessage should have caught it — don't add to validItems
              // since parseMessage already extracted what it could
            }

            // Direct license list (multi-line LIC- CSV/list) — route through buildQuoteResponse deterministically
            // parseMessage sets items=[] but directLicenseList=[...] for these inputs
            if (parsed && parsed.directLicenseList && parsed.directLicenseList.length > 0) {
              const quoteResult = buildQuoteResponse(parsed);
              if (!quoteResult.needsLlm && quoteResult.message) {
                const responseText = quoteResult.message;
                const quoteUrls = extractQuoteUrls(responseText);
                await addToHistory(kv, quotePersonId, 'assistant', responseText);
                apiResult = {
                  quoteUrls,
                  eolWarnings: [],
                  parsedItems: parsed.directLicenseList.map(p => ({ sku: p.sku, qty: p.qty })),
                  handlerType: 'deterministic',
                };
                break;
              }
            }

            // If no parsed items AND no SKU-like tokens at all → Claude fallback (technical question)
            if ((!parsed || !parsed.items || parsed.items.length === 0) && rawSkuTokens.length === 0 && (!parsed || !parsed.directLicenseList || parsed.directLicenseList.length === 0)) {
              try {
                const claudeReply = await askClaude(
                  text,
                  quotePersonId,
                  env,
                  null,   // no image
                  false,  // no tools
                );
                const sanitizedFallback = (claudeReply || '').replace(/\[object Object\]/g, '');
                const claudeUrls = sanitizedFallback.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g) || [];
                const cleanFallbackUrls = claudeUrls
                  .map(u => u.replace(/,{2,}/g, ',').replace(/,&/g, '&').replace(/item=,/g, 'item=').replace(/,$/g, ''))
                  .filter(u => u.includes('item=') && !u.includes('item=&'));
                const termLabels = ['1-Year', '3-Year', '5-Year'];
                apiResult = await finalizeQuoteResponse({
                  quoteUrls: cleanFallbackUrls.map((u, i) => ({ url: u, label: termLabels[i] || 'Quote ' + (i + 1) })),
                  eolWarnings: [],
                  parsedItems: [],
                  claudeResponse: sanitizedFallback,
                  handlerType: 'claude-fallback',
                }, sanitizedFallback);
              } catch (claudeErr) {
                console.error('[API/quote] Claude fallback error:', claudeErr);
                apiResult = { error: 'No valid SKUs detected and AI fallback failed. Try formats like: 10 MR44, 5 MS130-24P, 2 MX67' };
              }
              break;
            }

            // If ANY suggestions exist (invalid or unrecognized SKUs), BLOCK quote output
            // User must resolve all SKU issues before we generate URLs
            if (suggestions.length > 0) {
              apiResult = {
                quoteUrls: [],
                eolWarnings: [],
                parsedItems: parsedWithValidation.map(p => ({ sku: p.sku, qty: p.qty })),
                suggestions,
                handlerType: 'suggestions-only',
              };
              break;
            }

            // If parseMessage found no items but raw tokens were all valid/EOL,
            // fall through to Claude for guidance (e.g., "MS225" alone — EOL family)
            if (validItems.length === 0) {
              try {
                // Build item context so Claude knows what was parsed (prevents [object Object] hallucination)
                const fbItemContext = (parsedWithValidation || []).map(i => `${i.qty}x ${i.sku}`).join(', ');
                let fbPrompt = text;
                if (fbItemContext) fbPrompt += `\n\n(Parsed items: ${fbItemContext})`;
                const claudeReply = await askClaude(
                  fbPrompt,
                  quotePersonId,
                  env,
                  null,
                  false,
                );
                // Sanitize: strip [object Object] from Claude's response (hallucination safety net)
                const sanitizedFb = (claudeReply || '').replace(/\[object Object\]/g, '');
                const claudeUrls = sanitizedFb.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g) || [];
                // Clean up URL artifacts from sanitization (trailing commas, empty items)
                const cleanFbUrls = claudeUrls
                  .map(u => u.replace(/,{2,}/g, ',').replace(/,&/g, '&').replace(/item=,/g, 'item=').replace(/,$/g, ''))
                  .filter(u => u.includes('item=') && !u.includes('item=&'));
                const termLabels = ['1-Year', '3-Year', '5-Year'];
                apiResult = await finalizeQuoteResponse({
                  quoteUrls: cleanFbUrls.map((u, i) => ({ url: u, label: termLabels[i] || 'Quote ' + (i + 1) })),
                  eolWarnings: [],
                  parsedItems: parsedWithValidation.map(p => ({ sku: p.sku, qty: p.qty })),
                  claudeResponse: sanitizedFb,
                  handlerType: 'claude-fallback',
                }, sanitizedFb);
              } catch (claudeErr) {
                console.error('[API/quote] Claude fallback error:', claudeErr);
                apiResult = { error: 'AI response failed. Please try again.' };
              }
              break;
            }

            // ── All SKUs validated — proceed with quote generation ──

            // Check for EOL warnings
            const eolWarnings = [];
            for (const item of parsed.items) {
              const base = item.baseSku || item.sku;
              if (isEol(base)) {
                const replacement = checkEol(base);
                eolWarnings.push(base + ' is End-of-Life' + (replacement ? ' → replaced by ' + (Array.isArray(replacement) ? replacement.join(' / ') : replacement) : ''));
              }
            }

            // Route through buildQuoteResponse for consistent output
            const quoteResult = buildQuoteResponse(parsed);

            // If buildQuoteResponse says it needs LLM (advisory, revision, etc.),
            // fall through to Claude — identical to Webex bot behavior
            if (quoteResult.needsLlm) {
              try {
                // Build item context string so Claude knows exactly what was parsed
                // This prevents [object Object] in Claude's URL generation
                const itemContext = (parsed?.items || []).map(i => {
                  const sku = i.baseSku || i.sku || '';
                  return `${i.qty}x ${sku}`;
                }).join(', ');
                const errorContext = (quoteResult.errors || []).join('; ');
                let claudePrompt = text;
                if (itemContext) claudePrompt += `\n\n(Parsed items: ${itemContext})`;
                if (errorContext) claudePrompt += `\n(SKU issues: ${errorContext})`;
                const claudeReply = await askClaude(
                  claudePrompt,
                  quotePersonId,
                  env,
                  null,
                  false,
                );
                // Sanitize: strip [object Object] from Claude's response (hallucination safety net)
                const sanitizedReply = (claudeReply || '').replace(/\[object Object\]/g, '');
                const claudeUrls = sanitizedReply.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g) || [];
                // Clean up URL artifacts from sanitization (trailing commas, empty items)
                const cleanUrls = claudeUrls
                  .map(u => u.replace(/,{2,}/g, ',').replace(/,&/g, '&').replace(/item=,/g, 'item=').replace(/,$/g, ''))
                  .filter(u => u.includes('item=') && !u.includes('item=&'));
                const termLabels = ['1-Year', '3-Year', '5-Year'];
                apiResult = await finalizeQuoteResponse({
                  quoteUrls: cleanUrls.map((u, i) => ({ url: u, label: termLabels[i] || 'Quote ' + (i + 1) })),
                  eolWarnings,
                  parsedItems: parsedWithValidation.map(p => ({ sku: p.sku, qty: p.qty })),
                  claudeResponse: sanitizedReply,
                  handlerType: 'claude-advisory',
                }, sanitizedReply);
              } catch (claudeErr) {
                console.error('[API/quote] Claude fallback error:', claudeErr);
                apiResult = { error: 'AI response failed. Please try again.' };
              }
              break;
            }

            // ── Deterministic quote — extract URLs from buildQuoteResponse output ──
            const responseText = quoteResult.message || quoteResult.text || quoteResult.reply || '';
            const quoteUrls = extractQuoteUrls(responseText);

            // Store the full deterministic response in history so pricing follow-ups work
            await addToHistory(kv, quotePersonId, 'assistant', responseText);

            apiResult = {
              quoteUrls,
              eolWarnings,
              parsedItems: parsedWithValidation.map(p => ({ sku: p.sku, qty: p.qty })),
              handlerType: 'deterministic',
            };
            break;
          }

          // ── Parse Dashboard: Claude vision analysis of license dashboard screenshots ──
          // Accepts base64 image data (or a public image URL) and returns license analysis + quote URLs.
          case '/api/parse-dashboard': {
            const { imageBase64, imageUrl, mediaType: imgMediaType, instructions: dashInstructions } = apiBody;
            if (!imageBase64 && !imageUrl) {
              return new Response(JSON.stringify({ error: 'imageBase64 or imageUrl required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              // Resolve image data: either from base64 or fetch from URL
              let resolvedBase64 = imageBase64;
              let resolvedMediaType = imgMediaType || 'image/png';

              if (!resolvedBase64 && imageUrl) {
                // Fetch image from URL (Google Drive sharing links, public URLs, etc.)
                let fetchUrl = imageUrl;

                // Convert Google Drive sharing links to direct download
                const driveMatch = imageUrl.match(/drive\.google\.com\/file\/d\/([^/]+)/);
                if (driveMatch) {
                  fetchUrl = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
                }

                const imgResp = await fetch(fetchUrl, { redirect: 'follow' });
                if (!imgResp.ok) {
                  apiResult = { error: 'Failed to fetch image from URL (HTTP ' + imgResp.status + '). Make sure the link is publicly accessible.' };
                  break;
                }
                const contentType = imgResp.headers.get('content-type') || 'image/png';
                resolvedMediaType = contentType.split(';')[0].trim();
                if (!resolvedMediaType.startsWith('image/')) {
                  apiResult = { error: 'URL did not return an image. Content-Type: ' + resolvedMediaType };
                  break;
                }
                const imgBuffer = await imgResp.arrayBuffer();
                // Convert to base64
                const bytes = new Uint8Array(imgBuffer);
                let binary = '';
                for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
                resolvedBase64 = btoa(binary);
              }

              // Size check (Claude max ~20MB base64)
              if (resolvedBase64.length > 20_000_000) {
                apiResult = { error: 'Image is too large. Please use an image under 15MB.' };
                break;
              }

              const dashPrompt = dashInstructions || 'Analyze this Meraki license dashboard screenshot. Parse all license types, device counts, and expiration dates. Follow the LICENSE DASHBOARD SCREENSHOT HANDLING rules exactly.';

              // Call Claude with vision (reuse existing askClaude)
              const imageData = { base64: resolvedBase64, mediaType: resolvedMediaType };
              const claudeResponse = await askClaude(dashPrompt, 'gmail-addon-dashboard', env, imageData);

              // Extract URLs from the response
              const dashUrlRegex = /https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g;
              const dashUrls = (claudeResponse || '').match(dashUrlRegex) || [];

              // Parse option structure from response
              const dashQuoteUrls = [];
              const termLabels = ['1-Year', '3-Year', '5-Year'];
              let currentOpt = '';
              let optIdx = 0;
              const dashLines = (claudeResponse || '').split('\n');
              for (const line of dashLines) {
                const optMatch = line.match(/\*\*Option \d+[^*]*\*\*/) || line.match(/^Option \d+/);
                if (optMatch) { currentOpt = (optMatch[0] || '').replace(/\*\*/g, '').replace(/[—–:]/g, '').replace(/-+$/, '').trim(); optIdx = 0; }
                const urlMatch = line.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/);
                if (urlMatch) {
                  const label = currentOpt
                    ? `${currentOpt} (${termLabels[optIdx] || ''})`
                    : termLabels[dashQuoteUrls.length] || 'Quote ' + (dashQuoteUrls.length + 1);
                  dashQuoteUrls.push({ url: urlMatch[0], label: label.trim() });
                  optIdx++;
                }
              }

              apiResult = {
                analysis: claudeResponse || 'No analysis generated.',
                quoteUrls: dashQuoteUrls,
                rawUrls: dashUrls,
              };
            } catch (err) {
              console.error('[PARSE-DASHBOARD] Error:', err.message);
              apiResult = { error: 'Dashboard analysis failed: ' + err.message };
            }
            break;
          }

          // ── CRM Search: Search Zoho CRM modules ──
          case '/api/crm-search': {
            const { query, module, domain } = apiBody;
            if (!query && !domain) {
              return new Response(JSON.stringify({ error: 'query or domain required' }), { status: 400, headers: jsonHeaders });
            }

            const validModules = ['Accounts', 'Contacts', 'Deals', 'Quotes', 'Sales_Orders'];
            const mod = validModules.includes(module) ? module : 'Accounts';

            const fieldMap = {
              Accounts: 'id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code',
              Contacts: 'id,First_Name,Last_Name,Email,Phone,Account_Name',
              Deals: 'id,Deal_Name,Stage,Amount,Closing_Date,Account_Name',
              Quotes: 'id,Subject,Quote_Number,Grand_Total,Deal_Name,Stage',
              Sales_Orders: 'id,Subject,SO_Number,Grand_Total,Status,Deal_Name,Account_Name,Client_Send_Status,Disti_Tracking_Number,Disti_Estimated_Ship_Date,Vendor_SO_Number',
            };

            try {
              // Domain-based account search: criteria match on Website + word match on domain base name
              if (domain && mod === 'Accounts') {
                const results = [];
                const seen = new Set();

                // 1. Criteria search on Website field (e.g. "lavanture.com")
                try {
                  const domainResp = await zohoApiCall('GET',
                    `Accounts/search?criteria=((Website:starts_with:${encodeURIComponent(domain)}))&fields=${fieldMap.Accounts}&per_page=5`, env
                  );
                  for (const r of (domainResp?.data || [])) {
                    if (!seen.has(r.id)) {
                      results.push({ id: r.id, name: r.Account_Name, phone: r.Phone, website: r.Website,
                        billingStreet: r.Billing_Street, billingCity: r.Billing_City,
                        billingState: r.Billing_State, billingZip: r.Billing_Code, isDomainMatch: true });
                      seen.add(r.id);
                    }
                  }
                } catch (_) {}

                // 2. Word search on the domain base (strip TLD) — catches "Lavanture Products" from "lavanture.com"
                const domainBase = domain.split('.')[0] || '';
                if (domainBase.length >= 3) {
                  try {
                    const baseResp = await zohoApiCall('GET',
                      `Accounts/search?word=${encodeURIComponent(domainBase)}&fields=${fieldMap.Accounts}&per_page=5`, env
                    );
                    for (const r of (baseResp?.data || [])) {
                      if (!seen.has(r.id)) {
                        results.push({ id: r.id, name: r.Account_Name, phone: r.Phone, website: r.Website,
                          billingStreet: r.Billing_Street, billingCity: r.Billing_City,
                          billingState: r.Billing_State, billingZip: r.Billing_Code, isDomainMatch: true });
                        seen.add(r.id);
                      }
                    }
                  } catch (_) {}
                }

                apiResult = { records: results, module: mod, domain, isDomainSearch: true };
              } else {
                // Standard word search by name
                const searchResp = await zohoApiCall('GET',
                  `${mod}/search?word=${encodeURIComponent(query)}&fields=${fieldMap[mod]}&per_page=10`, env
                );
                const rawRecords = searchResp?.data || [];
                // Normalize accounts to consistent shape
                const records = mod === 'Accounts'
                  ? rawRecords.map(r => ({ id: r.id, name: r.Account_Name, phone: r.Phone, website: r.Website,
                      billingStreet: r.Billing_Street, billingCity: r.Billing_City,
                      billingState: r.Billing_State, billingZip: r.Billing_Code }))
                  : rawRecords;
                apiResult = { records, module: mod, query };
              }
            } catch (crmErr) {
              apiResult = { error: 'CRM search failed: ' + crmErr.message, records: [] };
            }
            break;
          }

          // ── CRM ISR Deals: Get ALL deals (current + past) where a Cisco rep is the Meraki ISR ──
          case '/api/crm-isr-deals': {
            const { repEmail: isrEmail, repId: isrRepId, repName: isrRepName } = apiBody;
            if (!isrEmail && !isrRepId && !isrRepName) {
              return new Response(JSON.stringify({ error: 'repEmail, repId, or repName required' }), { status: 400, headers: jsonHeaders });
            }
            try {
              let repId = isrRepId || '';
              let repName = isrRepName || '';

              // Look up rep ID by email if not provided
              if (!repId && isrEmail) {
                const repSearch = await zohoApiCall('GET',
                  `Meraki_ISRs/search?criteria=(Email:equals:${encodeURIComponent(isrEmail)})&fields=id,Name`, env
                ).catch(() => null);
                if (repSearch?.data?.[0]) {
                  repId = repSearch.data[0].id;
                  repName = repName || repSearch.data[0].Name || '';
                }
              }

              // Fallback: search by name if email lookup failed
              if (!repId && repName) {
                const nameSearch = await zohoApiCall('GET',
                  `Meraki_ISRs/search?word=${encodeURIComponent(repName)}&fields=id,Name,Email`, env
                ).catch(() => null);
                if (nameSearch?.data?.[0]) {
                  repId = nameSearch.data[0].id;
                }
              }

              if (!repId) {
                apiResult = { deals: [], found: false, error: 'Rep not found in Meraki ISRs module' };
                break;
              }

              // Use COQL to fetch ALL deals where Meraki_ISR = repId (current + past, all stages)
              const dealFields = 'Deal_Name, Stage, Amount, Closing_Date, Account_Name, Lead_Source, Created_Time';
              const coqlQuery = `select ${dealFields} from Deals where Meraki_ISR = '${repId}' order by Closing_Date desc limit 100`;
              const dealsResp = await zohoApiCall('POST', 'coql', env, { select_query: coqlQuery }).catch(() => null);

              const deals = (dealsResp?.data || []).map(d => ({
                id: d.id,
                name: d.Deal_Name || '',
                stage: d.Stage || '',
                amount: d.Amount || 0,
                closingDate: d.Closing_Date || '',
                accountName: d.Account_Name?.name || d.Account_Name || '',
                leadSource: d.Lead_Source || '',
                createdTime: d.Created_Time || '',
                zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Potentials/${d.id}`,
              }));

              apiResult = { deals, found: deals.length > 0, repId, repName };
            } catch (isrErr) {
              apiResult = { deals: [], found: false, error: isrErr.message };
            }
            break;
          }

          // ── CRM Create Account ──
          case '/api/crm-create-account': {
            const { name: newAcctName, street: newAcctStreet, city: newAcctCity, state: newAcctState, zip: newAcctZip, website: newAcctWebsite } = apiBody;
            if (!newAcctName) {
              return new Response(JSON.stringify({ error: 'name required' }), { status: 400, headers: jsonHeaders });
            }
            try {
              const accountPayload = {
                data: [{
                  Account_Name: newAcctName,
                  Billing_Street: newAcctStreet || '',
                  Billing_City: newAcctCity || '',
                  Billing_State: newAcctState || '',
                  Billing_Code: newAcctZip || '',
                  Website: newAcctWebsite || '',
                  Owner: { id: '2570562000141711002' }, // Chris Graves
                }]
              };
              const createResp = await zohoApiCall('POST', 'Accounts', env, accountPayload);
              const parsed = parseZohoResponse(createResp, 'Account creation');
              if (parsed.success) {
                apiResult = {
                  success: true,
                  accountId: parsed.record_id,
                  name: newAcctName,
                  zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${parsed.record_id}`,
                  message: `Account created: ${newAcctName}`,
                };
              } else {
                apiResult = { success: false, error: parsed.message || 'Account creation failed' };
              }
            } catch (err) {
              apiResult = { error: 'Account creation failed: ' + err.message, success: false };
            }
            break;
          }

          // ── Enrich Company: Use Claude to derive company info from a domain ──
          case '/api/enrich-company': {
            const { domain: enrichDomain } = apiBody;
            if (!enrichDomain) {
              return new Response(JSON.stringify({ error: 'domain required' }), { status: 400, headers: jsonHeaders });
            }
            try {
              const enrichResp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': env.ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify({
                  model: 'claude-haiku-4-5-20251001',
                  max_tokens: 300,
                  system: `You are a company research assistant. Given an email domain, return the company's official name and headquarters address. Return ONLY a raw JSON object (no markdown, no code fences, no commentary). If you cannot determine a field, use an empty string. Format:
{"name":"Company Name","street":"123 Main St","city":"City","state":"ST","zip":"12345","website":"domain.com","phone":""}
Use the most commonly known company name (e.g. "AFIMAC Global" not "AFIMAC Global Security Inc."). For state, use the 2-letter abbreviation. Only include information you are confident about.`,
                  messages: [{ role: 'user', content: `Company domain: ${enrichDomain}` }]
                })
              });
              if (!enrichResp.ok) {
                apiResult = { error: 'Enrichment API error: ' + enrichResp.status };
                break;
              }
              const enrichData = await enrichResp.json();
              ctx.waitUntil(trackUsage(env, 'claude-haiku-4-5-20251001', enrichData.usage, 'addon-enrich'));
              const enrichText = enrichData.content?.[0]?.text || '';
              var enrichParsed;
              try {
                enrichParsed = JSON.parse(enrichText.replace(/```json\n?|\n?```/g, '').trim());
              } catch (_) {
                // Try extracting JSON from mixed text
                var enrichJsonMatch = enrichText.match(/\{[\s\S]*"name"\s*:[\s\S]*\}/);
                enrichParsed = enrichJsonMatch ? JSON.parse(enrichJsonMatch[0]) : {};
              }
              apiResult = {
                name: enrichParsed.name || '',
                street: enrichParsed.street || '',
                city: enrichParsed.city || '',
                state: enrichParsed.state || '',
                zip: enrichParsed.zip || '',
                website: enrichParsed.website || enrichDomain,
                phone: enrichParsed.phone || '',
              };
            } catch (err) {
              apiResult = { error: 'Enrichment failed: ' + err.message };
            }
            break;
          }

          // ── Tasks: Fetch open Zoho tasks for account/contact (by ID or domain/email fallback) ──
          case '/api/tasks': {
            const { domains, emails, accountId: directAccountId, contactId: directContactId } = apiBody;

            // Require at least one lookup parameter
            if (!directAccountId && !directContactId && (!domains || domains.length === 0) && (!emails || emails.length === 0)) {
              return new Response(JSON.stringify({ error: 'accountId, contactId, domains, or emails required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              const taskFields = 'Subject, Status, Due_Date, Description, What_Id, Who_Id, Owner';
              const seenIds = new Set();
              let allTasks = [];

              const mapTask = (t, acctId, acctName) => ({
                id: t.id,
                subject: t.Subject || '(no subject)',
                status: t.Status || 'Not Started',
                dueDate: t.Due_Date || null,
                description: t.Description ? t.Description.substring(0, 200) : '',
                dealId: t.What_Id ? t.What_Id.id : null,
                dealName: t.What_Id ? t.What_Id.name : null,
                contactId: t.Who_Id ? t.Who_Id.id : null,
                contactName: t.Who_Id ? t.Who_Id.name : null,
                ownerId: t.Owner ? t.Owner.id : null,
                ownerName: t.Owner ? t.Owner.name : null,
                accountId: acctId || null,
                accountName: acctName || null,
                zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${t.id}`,
              });

              // ── Fast path: accountId/contactId provided directly — skip domain resolution ──
              if (directAccountId || directContactId) {
                // Strategy 1: Contact-linked tasks (Who_Id match) — covers standalone tasks + rep tasks
                if (directContactId) {
                  try {
                    const contactCoql = `select ${taskFields} from Tasks where Who_Id = '${directContactId}' and Status not in ('Completed') order by Due_Date asc limit 25`;
                    const resp = await zohoApiCall('POST', 'coql', env, { select_query: contactCoql });
                    if (resp?.data) {
                      for (const t of resp.data) {
                        if (!seenIds.has(t.id)) { seenIds.add(t.id); allTasks.push(mapTask(t, directAccountId, null)); }
                      }
                    }
                  } catch (_) { /* contact query failed, continue */ }
                }

                // Strategy 2: Deal-linked tasks for account (What_Id in deal IDs for account)
                if (directAccountId) {
                  try {
                    const dealsCoql = `select id from Deals where Account_Name = '${directAccountId}' and Stage not in ('Closed (Lost)') limit 50`;
                    const dealsResp = await zohoApiCall('POST', 'coql', env, { select_query: dealsCoql });
                    if (dealsResp?.data && dealsResp.data.length > 0) {
                      const dealIds = dealsResp.data.map(d => `'${d.id}'`).join(',');
                      const dealTaskCoql = `select ${taskFields} from Tasks where What_Id in (${dealIds}) and Status not in ('Completed') order by Due_Date asc limit 50`;
                      const taskResp = await zohoApiCall('POST', 'coql', env, { select_query: dealTaskCoql });
                      if (taskResp?.data) {
                        for (const t of taskResp.data) {
                          if (!seenIds.has(t.id)) { seenIds.add(t.id); allTasks.push(mapTask(t, directAccountId, null)); }
                        }
                      }
                    }
                  } catch (_) { /* deal-based query failed */ }
                }

                allTasks.sort((a, b) => {
                  if (!a.dueDate && !b.dueDate) return 0;
                  if (!a.dueDate) return 1; if (!b.dueDate) return -1;
                  return new Date(a.dueDate) - new Date(b.dueDate);
                });
                apiResult = { tasks: allTasks };
                break;
              }

              // ── Fallback path: domain/email resolution (used when IDs not available) ──
              const searchDomains = (domains || []).filter(d => d && !d.match(/gmail\.com|yahoo\.com|hotmail\.com|outlook\.com|aol\.com|icloud\.com|protonmail\.com|live\.com|msn\.com|me\.com|mac\.com|comcast\.\w+|att\.\w+|verizon\.\w+|stratusinfosystems\.com/i));
              let accounts = [];

              for (const domain of searchDomains) {
                try {
                  // Try both bare domain and https://www. prefix to handle varying Website field formats
                  const criteria = `((Website:starts_with:${encodeURIComponent(domain)}))`;
                  const acctResp = await zohoApiCall('GET',
                    `Accounts/search?criteria=${criteria}&fields=id,Account_Name,Website&per_page=5`, env
                  );
                  if (acctResp?.data) {
                    acctResp.data.forEach(a => {
                      if (!accounts.find(e => e.id === a.id)) accounts.push({ id: a.id, name: a.Account_Name, website: a.Website });
                    });
                  }
                } catch (_) { /* skip failed domain lookups */ }
              }

              // If no accounts found via domain, try contact email lookup
              if (accounts.length === 0 && emails && emails.length > 0) {
                for (const email of emails.slice(0, 5)) {
                  try {
                    const contactResp = await zohoApiCall('GET',
                      `Contacts/search?email=${encodeURIComponent(email)}&fields=id,Account_Name&per_page=3`, env
                    );
                    if (contactResp?.data) {
                      contactResp.data.forEach(c => {
                        if (c.Account_Name?.id && !accounts.find(e => e.id === c.Account_Name.id)) {
                          accounts.push({ id: c.Account_Name.id, name: c.Account_Name.name || 'Unknown' });
                        }
                      });
                    }
                  } catch (_) { /* skip */ }
                }
              }

              if (accounts.length === 0) {
                apiResult = { accounts: [], tasks: [], message: 'No matching accounts found' };
                break;
              }

              // Fetch open tasks for each found account via deal-linked COQL
              for (const acct of accounts.slice(0, 5)) {
                try {
                  const dealsCoql = `select id from Deals where Account_Name = '${acct.id}' and Stage not in ('Closed (Lost)') limit 50`;
                  const dealsResp = await zohoApiCall('POST', 'coql', env, { select_query: dealsCoql });
                  if (dealsResp?.data && dealsResp.data.length > 0) {
                    const dealIds = dealsResp.data.map(d => `'${d.id}'`).join(',');
                    const dealTaskCoql = `select ${taskFields} from Tasks where What_Id in (${dealIds}) and Status not in ('Completed') order by Due_Date asc limit 50`;
                    const taskResp = await zohoApiCall('POST', 'coql', env, { select_query: dealTaskCoql });
                    if (taskResp?.data) {
                      for (const t of taskResp.data) {
                        if (!seenIds.has(t.id)) { seenIds.add(t.id); allTasks.push(mapTask(t, acct.id, acct.name)); }
                      }
                    }
                  }
                } catch (tErr) {
                  console.error(`[API/tasks] COQL error for account ${acct.id}: ${tErr.message}`);
                }
              }

              allTasks.sort((a, b) => {
                if (!a.dueDate && !b.dueDate) return 0;
                if (!a.dueDate) return 1; if (!b.dueDate) return -1;
                return new Date(a.dueDate) - new Date(b.dueDate);
              });

              apiResult = { accounts, tasks: allTasks };
            } catch (taskErr) {
              apiResult = { error: 'Task lookup failed: ' + taskErr.message, accounts: [], tasks: [] };
            }
            break;
          }

          // ── Task Action: Complete/reschedule/edit Zoho tasks ──
          case '/api/task-action': {
            const { action, taskId, newSubject, newDueDate, dealId, contactId, accountName } = apiBody;
            if (!action || !taskId) {
              return new Response(JSON.stringify({ error: 'action and taskId required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              // Helper: calculate N business days from today
              function addBusinessDays(startDate, days) {
                let d = new Date(startDate);
                let added = 0;
                while (added < days) {
                  d.setDate(d.getDate() + 1);
                  const dow = d.getDay();
                  if (dow !== 0 && dow !== 6) added++;
                }
                return d.toISOString().split('T')[0]; // YYYY-MM-DD
              }

              switch (action) {
                case 'complete_and_followup': {
                  // 1. Complete the existing task
                  const completeResp = await zohoApiCall('PUT', `Tasks/${taskId}`, env, {
                    data: [{ Status: 'Completed' }]
                  });
                  if (completeResp.data && completeResp.data[0] && completeResp.data[0].code !== 'SUCCESS') {
                    throw new Error('Failed to complete task: ' + (completeResp.data[0].message || 'unknown'));
                  }

                  // 2. Create successor task
                  const followUpDate = addBusinessDays(new Date(), 3);
                  const successorSubject = newSubject || 'Follow up: next steps';
                  const successorPayload = {
                    data: [{
                      Subject: successorSubject,
                      Status: 'Not Started',
                      Due_Date: newDueDate || followUpDate,
                      Owner: '2570562000141711002', // Chris Graves
                    }]
                  };
                  // Attach to deal if available
                  if (dealId) {
                    successorPayload.data[0].What_Id = dealId;
                    successorPayload.data[0].$se_module = 'Deals';
                  }
                  if (contactId) {
                    successorPayload.data[0].Who_Id = contactId;
                  }

                  const createResp = await zohoApiCall('POST', 'Tasks', env, successorPayload);
                  const newTaskId = (createResp.data && createResp.data[0]) ? createResp.data[0].details.id : null;

                  apiResult = {
                    success: true,
                    action: 'complete_and_followup',
                    completedTaskId: taskId,
                    newTaskId: newTaskId,
                    newDueDate: newDueDate || followUpDate,
                    newSubject: successorSubject,
                  };
                  break;
                }

                case 'complete': {
                  // Just close the task, no successor
                  const compOnlyResp = await zohoApiCall('PUT', `Tasks/${taskId}`, env, {
                    data: [{ Status: 'Completed' }]
                  });
                  if (compOnlyResp.data && compOnlyResp.data[0] && compOnlyResp.data[0].code !== 'SUCCESS') {
                    throw new Error('Failed to complete task: ' + (compOnlyResp.data[0].message || 'unknown'));
                  }
                  apiResult = { success: true, action: 'complete', taskId };
                  break;
                }

                case 'reschedule': {
                  if (!newDueDate) {
                    return new Response(JSON.stringify({ error: 'newDueDate required for reschedule' }), { status: 400, headers: jsonHeaders });
                  }
                  const reschedResp = await zohoApiCall('PUT', `Tasks/${taskId}`, env, {
                    data: [{ Due_Date: newDueDate, ...(newSubject ? { Subject: newSubject } : {}) }]
                  });
                  if (reschedResp.data && reschedResp.data[0] && reschedResp.data[0].code !== 'SUCCESS') {
                    throw new Error('Failed to reschedule: ' + (reschedResp.data[0].message || 'unknown'));
                  }
                  apiResult = { success: true, action: 'reschedule', taskId, newDueDate, newSubject: newSubject || null };
                  break;
                }

                case 'edit': {
                  const updateFields = {};
                  if (newSubject) updateFields.Subject = newSubject;
                  if (newDueDate) updateFields.Due_Date = newDueDate;
                  if (Object.keys(updateFields).length === 0) {
                    return new Response(JSON.stringify({ error: 'Nothing to update' }), { status: 400, headers: jsonHeaders });
                  }
                  const editResp = await zohoApiCall('PUT', `Tasks/${taskId}`, env, { data: [updateFields] });
                  if (editResp.data && editResp.data[0] && editResp.data[0].code !== 'SUCCESS') {
                    throw new Error('Failed to edit: ' + (editResp.data[0].message || 'unknown'));
                  }
                  apiResult = { success: true, action: 'edit', taskId, updates: updateFields };
                  break;
                }

                default:
                  return new Response(JSON.stringify({ error: 'Unknown action: ' + action }), { status: 400, headers: jsonHeaders });
              }
            } catch (actErr) {
              apiResult = { error: 'Task action failed: ' + actErr.message, success: false };
            }
            break;
          }

          // ── Suggest Task Preview: lookup only, no writes ──
          case '/api/suggest-task-preview': {
            const { senderEmail: prevEmail, senderName: prevName, subject: prevSubject, hasAccount: prevHasAcct, accountId: prevAcctId } = apiBody;
            if (!prevEmail) {
              return new Response(JSON.stringify({ error: 'senderEmail required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              const prevDomain = prevEmail.split('@')[1] || '';
              const prevIsGeneric = /^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac|comcast|att|verizon)\.\w+$/i.test(prevDomain);

              function previewAddBizDays(start, days) {
                let d = new Date(start);
                let added = 0;
                while (added < days) {
                  d.setDate(d.getDate() + 1);
                  if (d.getDay() !== 0 && d.getDay() !== 6) added++;
                }
                return d.toISOString().split('T')[0];
              }

              let prevAccountId = prevAcctId || null;
              let prevAccountName = '';
              let prevContactFound = false;
              let prevContactName = '';
              let prevAssociationUncertain = false;

              // Strategy 1: ALWAYS search contacts by email (even generic domains)
              // This catches cases where a gmail.com user is already a contact in CRM
              if (!prevAccountId) {
                try {
                  const ec = await zohoApiCall('GET', `Contacts/search?email=${encodeURIComponent(prevEmail)}&fields=id,Account_Name,Full_Name`, env);
                  if (ec?.data?.[0]?.Account_Name?.id) {
                    prevAccountId = ec.data[0].Account_Name.id;
                    prevAccountName = ec.data[0].Account_Name.name || '';
                    prevContactFound = true;
                    prevContactName = ec.data[0].Full_Name || '';
                  }
                } catch (e) {}
              }

              // For non-generic domains, continue with domain-based strategies
              if (!prevAccountId && !prevIsGeneric && prevDomain) {
                // Strategy 2: Search accounts by website/domain
                try {
                  const ac = await zohoApiCall('GET', `Accounts/search?criteria=(Website:starts_with:${encodeURIComponent(prevDomain)})&fields=id,Account_Name`, env);
                  if (ac?.data?.[0]) { prevAccountId = ac.data[0].id; prevAccountName = ac.data[0].Account_Name; }
                } catch (e) {}

                // Strategy 3: Word search with abbreviated domain
                if (!prevAccountId) {
                  try {
                    const db = prevDomain.split('.')[0];
                    const st = db.length > 8 ? db.substring(0, 3).toUpperCase() : db;
                    const as = await zohoApiCall('GET', `Accounts/search?word=${encodeURIComponent(st)}&fields=id,Account_Name,Website`, env);
                    if (as?.data) {
                      const m = as.data.find(a => (a.Website && a.Website.toLowerCase().includes(prevDomain.toLowerCase())) || a.Account_Name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(db.toLowerCase()));
                      if (m) { prevAccountId = m.id; prevAccountName = m.Account_Name; }
                    }
                  } catch (e) {}
                }
              }

              // For generic emails with no account found yet, try thread context domains
              // (excluding generic domains and the user's own stratusinfosystems.com domain)
              if (!prevAccountId && prevIsGeneric && apiBody.threadDomains) {
                const usableDomains = (apiBody.threadDomains || []).filter(d =>
                  d && !/^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac|comcast|att|verizon)\.\w+$/i.test(d)
                  && !d.toLowerCase().includes('stratusinfosystems')
                );
                for (const td of usableDomains) {
                  if (prevAccountId) break;
                  try {
                    const ac = await zohoApiCall('GET', `Accounts/search?criteria=(Website:starts_with:${encodeURIComponent(td)})&fields=id,Account_Name`, env);
                    if (ac?.data?.[0]) { prevAccountId = ac.data[0].id; prevAccountName = ac.data[0].Account_Name; }
                  } catch (e) {}
                }
              }

              // If account found but contact not yet checked, verify contact
              if (prevAccountId && !prevContactFound) {
                try {
                  const cs = await zohoApiCall('GET', `Contacts/search?email=${encodeURIComponent(prevEmail)}&fields=id,Full_Name`, env);
                  if (cs?.data?.[0]) {
                    prevContactFound = true;
                    prevContactName = cs.data[0].Full_Name || '';
                  }
                } catch (e) {}
              }

              // Flag uncertainty: generic email + no existing contact + no clear account
              if (prevIsGeneric && !prevContactFound && !prevAccountId) {
                prevAssociationUncertain = true;
              }

              if (prevHasAcct && prevAcctId && !prevAccountName) {
                try {
                  const ar = await zohoApiCall('GET', `Accounts/${prevAcctId}?fields=Account_Name`, env);
                  prevAccountName = ar?.data?.[0]?.Account_Name || '';
                  prevAccountId = prevAcctId;
                } catch (e) {}
              }

              const prevDomainBase = prevDomain.split('.')[0];
              const prevCompanyName = prevDomainBase.charAt(0).toUpperCase() + prevDomainBase.slice(1);

              apiResult = {
                success: true,
                accountFound: !!prevAccountId,
                accountId: prevAccountId || '',
                accountName: prevAccountName,
                contactFound: prevContactFound,
                contactName: prevContactName,
                senderEmail: prevEmail,
                senderName: prevName || '',
                isGenericEmail: prevIsGeneric,
                domain: prevDomain,
                companyName: prevCompanyName,
                suggestedDueDate: previewAddBizDays(new Date(), 3),
                associationUncertain: prevAssociationUncertain
              };
            } catch (err) {
              apiResult = { error: 'Preview failed: ' + err.message };
            }
            break;
          }

          // ── Suggest Task: Auto-create lead/contact + follow-up task ──
          case '/api/suggest-task': {
            const { senderEmail, senderName, subject: taskSubject, hasAccount, accountId, dealId: suggestDealId, createContact: shouldCreateContact } = apiBody;
            if (!senderEmail) {
              return new Response(JSON.stringify({ error: 'senderEmail required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              const domain = senderEmail.split('@')[1] || '';
              const isGenericEmail = /^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac|comcast|att|verizon)\.\w+$/i.test(domain);

              function suggestAddBusinessDays(startDate, days) {
                let d = new Date(startDate);
                let added = 0;
                while (added < days) {
                  d.setDate(d.getDate() + 1);
                  const dow = d.getDay();
                  if (dow !== 0 && dow !== 6) added++;
                }
                return d.toISOString().split('T')[0];
              }
              const followUpDate = suggestAddBusinessDays(new Date(), 3);

              let resultAccountId = accountId || null;
              let resultAccountName = '';
              let contactId = null;
              let contactCreated = false;
              let leadCreated = false;
              let taskCreated = false;
              let taskId = null;
              let associationUncertain = false;

              // If no accountId provided, search Zoho for account by domain
              // Strategy: 1) ALWAYS search contacts by email (reveals linked account)
              //           2) For non-generic domains: Search accounts by domain/website criteria
              //           3) For non-generic domains: Search accounts by word (first portion of domain)
              //           4) For generic emails: Try thread domains (if provided)

              // Strategy 1: ALWAYS search contacts by email (even generic domains)
              try {
                const existingContact = await zohoApiCall('GET',
                  `Contacts/search?email=${encodeURIComponent(senderEmail)}&fields=id,Account_Name,Full_Name`, env
                );
                if (existingContact?.data?.[0]?.Account_Name?.id) {
                  resultAccountId = existingContact.data[0].Account_Name.id;
                  resultAccountName = existingContact.data[0].Account_Name.name || '';
                  contactId = existingContact.data[0].id;
                }
              } catch (e) { /* contact search failed */ }

              // For non-generic domains, continue with domain-based strategies
              if (!resultAccountId && !isGenericEmail && domain) {
                if (!resultAccountId) {
                  try {
                    // Strategy 2: Search accounts by website criteria containing domain
                    const acctCriteria = await zohoApiCall('GET',
                      `Accounts/search?criteria=(Website:starts_with:${encodeURIComponent(domain)})&fields=id,Account_Name,Website`, env
                    );
                    if (acctCriteria?.data && acctCriteria.data.length > 0) {
                      resultAccountId = acctCriteria.data[0].id;
                      resultAccountName = acctCriteria.data[0].Account_Name;
                    }
                  } catch (e) { /* criteria search failed */ }
                }

                if (!resultAccountId) {
                  try {
                    // Strategy 3: Word search with abbreviated domain parts
                    // "mtischoolofknowledge.org" -> try "MTI" (first 3-4 chars if domain is one word)
                    const domainBase = domain.split('.')[0];
                    // Try first word-like segment (e.g. "mti" from "mtischoolofknowledge")
                    const shortToken = domainBase.length > 8 ? domainBase.substring(0, 3).toUpperCase() : domainBase;
                    const acctSearch = await zohoApiCall('GET',
                      `Accounts/search?word=${encodeURIComponent(shortToken)}&fields=id,Account_Name,Website`, env
                    );
                    if (acctSearch?.data && acctSearch.data.length > 0) {
                      const match = acctSearch.data.find(a =>
                        (a.Website && a.Website.toLowerCase().includes(domain.toLowerCase())) ||
                        a.Account_Name.toLowerCase().replace(/[^a-z0-9]/g, '').includes(domainBase.toLowerCase())
                      );
                      if (match) {
                        resultAccountId = match.id;
                        resultAccountName = match.Account_Name;
                      }
                    }
                  } catch (e) { /* word search failed */ }
                }
              }

              // For generic emails with no account found yet, try thread context domains
              // (excluding generic domains and the user's own stratusinfosystems.com domain)
              if (!resultAccountId && isGenericEmail && apiBody.threadDomains) {
                const usableDomains = (apiBody.threadDomains || []).filter(d =>
                  d && !/^(gmail|yahoo|hotmail|outlook|aol|icloud|protonmail|live|msn|me|mac|comcast|att|verizon)\.\w+$/i.test(d)
                  && !d.toLowerCase().includes('stratusinfosystems')
                );
                for (const td of usableDomains) {
                  if (resultAccountId) break;
                  try {
                    const ac = await zohoApiCall('GET', `Accounts/search?criteria=(Website:starts_with:${encodeURIComponent(td)})&fields=id,Account_Name`, env);
                    if (ac?.data?.[0]) { resultAccountId = ac.data[0].id; resultAccountName = ac.data[0].Account_Name; }
                  } catch (e) {}
                }
              }

              // Flag uncertainty: generic email + no existing contact + no clear account
              if (isGenericEmail && !contactId && !resultAccountId) {
                associationUncertain = true;
              }

              const foundAccount = !!(resultAccountId);

              if ((hasAccount && accountId) || foundAccount) {
                // Account exists. Check if contact exists for this email.
                if (!resultAccountName) {
                  const acctResp = await zohoApiCall('GET', `Accounts/${resultAccountId}?fields=Account_Name`, env);
                  resultAccountName = acctResp?.data?.[0]?.Account_Name || 'Unknown';
                }

                const contactSearch = await zohoApiCall('GET',
                  `Contacts/search?email=${encodeURIComponent(senderEmail)}&fields=id,Full_Name,Email`, env
                );
                if (contactSearch?.data && contactSearch.data.length > 0) {
                  contactId = contactSearch.data[0].id;
                } else if (shouldCreateContact) {
                  // Create contact under existing account (user confirmed via preview)
                  const nameParts = (senderName || '').split(' ');
                  const firstName = nameParts[0] || senderEmail.split('@')[0];
                  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '-';
                  const contactPayload = {
                    data: [{
                      First_Name: firstName,
                      Last_Name: lastName,
                      Email: senderEmail,
                      Account_Name: { id: resultAccountId },
                      Owner: '2570562000141711002'
                    }]
                  };
                  const createContactResp = await zohoApiCall('POST', 'Contacts', env, contactPayload);
                  if (createContactResp?.data?.[0]?.details?.id) {
                    contactId = createContactResp.data[0].details.id;
                    contactCreated = true;
                  }
                }
              } else if (!isGenericEmail) {
                // No account, non-generic email. Create a Lead.
                const nameParts = (senderName || '').split(' ');
                const firstName = nameParts[0] || senderEmail.split('@')[0];
                const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : '-';
                const company = domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1);
                const leadPayload = {
                  data: [{
                    First_Name: firstName,
                    Last_Name: lastName,
                    Email: senderEmail,
                    Company: company,
                    Lead_Source: 'Website',
                    Owner: '2570562000141711002'
                  }]
                };
                const createLeadResp = await zohoApiCall('POST', 'Leads', env, leadPayload);
                if (createLeadResp?.data?.[0]?.details?.id) {
                  leadCreated = true;
                  // Note: Leads don't link to accounts/contacts directly.
                  // The task will be standalone with just the lead reference.
                  contactId = null;
                  resultAccountName = company;
                }
              }
              // For generic emails (gmail.com etc.) without an account, we skip lead creation
              // but still create the task as a standalone follow-up.

              // Create follow-up task
              const taskPayload = {
                data: [{
                  Subject: 'Follow up: ' + (taskSubject || senderName || senderEmail),
                  Status: 'Not Started',
                  Due_Date: followUpDate,
                  Owner: '2570562000141711002',
                  Description: 'Auto-created from Gmail add-on.\nSender: ' + senderName + ' <' + senderEmail + '>\nOriginal subject: ' + (taskSubject || 'N/A')
                }]
              };
              if (contactId) {
                taskPayload.data[0].Who_Id = contactId;
              }
              // Link to deal if provided, otherwise link to account
              if (suggestDealId) {
                taskPayload.data[0].What_Id = suggestDealId;
                taskPayload.data[0].$se_module = 'Deals';
              } else if (resultAccountId) {
                taskPayload.data[0].What_Id = resultAccountId;
                taskPayload.data[0].$se_module = 'Accounts';
              }

              const createTaskResp = await zohoApiCall('POST', 'Tasks', env, taskPayload);
              if (createTaskResp?.data?.[0]?.details?.id) {
                taskId = createTaskResp.data[0].details.id;
                taskCreated = true;
              }

              let statusMsg = '';
              if (leadCreated) statusMsg += 'Created lead for ' + resultAccountName + '. ';
              if (contactCreated) statusMsg += 'Added ' + senderName + ' as contact to ' + resultAccountName + '. ';
              if (taskCreated) statusMsg += 'Follow-up task created (due ' + followUpDate + ').';
              if (!taskCreated) statusMsg += 'Could not create task. Check Zoho permissions.';

              apiResult = {
                success: taskCreated,
                action: 'suggest_task',
                message: statusMsg.trim(),
                taskId: taskId,
                newDueDate: followUpDate,
                newSubject: 'Follow up: ' + (taskSubject || senderName || senderEmail),
                leadCreated: leadCreated,
                contactCreated: contactCreated,
                accountName: resultAccountName
              };
            } catch (suggestErr) {
              apiResult = { error: 'Task suggestion failed: ' + suggestErr.message, success: false };
            }
            break;
          }

          // ── Detect SKUs: Parse SKUs from arbitrary text ──
          case '/api/detect-skus': {
            const { text } = apiBody;
            if (!text) {
              return new Response(JSON.stringify({ error: 'text required' }), { status: 400, headers: jsonHeaders });
            }
            const parsed = parseMessage(text);
            const skus = [];
            if (parsed && parsed.items) {
              for (const item of parsed.items) {
                const baseSku = item.baseSku || item.sku;
                // Validate SKU against auto-catalog to filter out false positives
                const validation = validateSku(baseSku);
                // Include SKU if it's valid (not EOL) or if EOL but still valid
                if (validation.valid) {
                  skus.push({ sku: baseSku, qty: item.qty });
                }
                // Skip invalid SKUs (false positives like "Z3IOQXQ")
              }
            }
            // Also check directLicenseList for LIC-* SKUs parsed from CSV/prose
            if (parsed && parsed.directLicenseList && parsed.directLicenseList.length > 0) {
              for (const lic of parsed.directLicenseList) {
                // Avoid duplicates (in case items already captured it)
                if (!skus.some(s => s.sku === lic.sku)) {
                  skus.push({ sku: lic.sku, qty: lic.qty });
                }
              }
            }
            // Fallback: regex scan for LIC-* patterns not caught by parser
            if (skus.length === 0 || !skus.some(s => s.sku.startsWith('LIC-'))) {
              const licRegex = /\b(LIC-[A-Z0-9]+-[A-Z0-9-]+)\b/gi;
              let licMatch;
              while ((licMatch = licRegex.exec(text)) !== null) {
                const foundLic = licMatch[1].toUpperCase();
                if (!skus.some(s => s.sku === foundLic)) {
                  // Try to find qty near the license mention
                  const nearby = text.substring(Math.max(0, licMatch.index - 20), licMatch.index + licMatch[0].length + 20);
                  const qtyMatch = nearby.match(/(\d+)\s*(?:x\s*)?(?:LIC-|$)/i) || nearby.match(/(?:qty|quantity|x)\s*(\d+)/i);
                  skus.push({ sku: foundLic, qty: qtyMatch ? parseInt(qtyMatch[1]) : 1 });
                }
              }
            }
            apiResult = { skus };
            break;
          }

          // ── Chat: CRM-aware Claude agent for Chrome Extension sidebar ──
          // Routes through the same askClaude() tool-use loop as the GChat bot,
          // giving the extension chat full Zoho CRM capabilities.
          case '/api/chat': {
            const { text: chatText, emailContext: chatEc, history: chatHistory, systemContext: chatSystemContext } = apiBody;
            if (!chatText) {
              apiResult = { error: 'text is required' };
              break;
            }

            try {
              const chatUserEmail = request.headers.get('x-user-email') || 'chrome-extension-user';
              const chatPersonId = `ext:${chatUserEmail}`;

              // Seed conversation history from prior chat messages if provided
              if (chatHistory && Array.isArray(chatHistory) && chatHistory.length > 0) {
                // Store the last few messages as history so askClaude can see them
                for (const msg of chatHistory.slice(-6)) {
                  await addToHistory(env.CONVERSATION_KV, chatPersonId, msg.role, msg.content);
                }
              }

              // Build a context-enriched message
              let enrichedMessage = chatText;
              if (chatEc && chatEc.subject) {
                const ctxParts = [];
                ctxParts.push(`Subject: "${chatEc.subject}"`);
                if (chatEc.senderName || chatEc.senderEmail) {
                  ctxParts.push(`From: ${chatEc.senderName || ''} (${chatEc.senderEmail || ''})`);
                }
                if (chatEc.customerEmail) {
                  ctxParts.push(`Customer: ${chatEc.customerEmail}`);
                }
                if (chatEc.customerDomain) {
                  ctxParts.push(`Domain: ${chatEc.customerDomain}`);
                }
                enrichedMessage = `[Email context: ${ctxParts.join(', ')}]\n\n${chatText}`;
              }

              // Inject systemContext from extension (Zoho execution rules, email context)
              if (chatSystemContext && chatSystemContext.trim()) {
                enrichedMessage = `[Extension Instructions]\n${chatSystemContext}\n[End Instructions]\n\n${enrichedMessage}`;
              }

              // Detect if this is a CRM request that needs tool-use
              const chatIntent = detectCrmEmailIntent(chatText);
              const hasCrmCreds = !!(env.ZOHO_CLIENT_ID && env.ZOHO_REFRESH_TOKEN);
              const useTools = chatIntent.hasAny && hasCrmCreds;

              // SERVER-SIDE PRODUCT PRE-RESOLUTION
              // If this looks like a quote creation request, pre-resolve product IDs from cache
              // so Claude can skip the batch_product_lookup iteration entirely (~3-5s saved).
              if (useTools && chatIntent.hasCrm && /\b(quote|create.*quote|quote.*for)\b/i.test(chatText)) {
                const preSkuTokens = [];
                const skuRegex = /\b(?:MR|MV|MT|MG|MX|CW9|MS|C9|Z)\d[A-Z0-9-]*/gi;
                let m;
                while ((m = skuRegex.exec(chatText.toUpperCase())) !== null) {
                  preSkuTokens.push(m[0]);
                }
                // Also detect license SKUs directly mentioned
                const licRegex = /\bLIC-[A-Z0-9-]+/gi;
                while ((m = licRegex.exec(chatText.toUpperCase())) !== null) {
                  preSkuTokens.push(m[0]);
                }
                if (preSkuTokens.length > 0) {
                  const preResolved = {};
                  for (const raw of [...new Set(preSkuTokens)]) {
                    const suffixed = applySuffix(raw);
                    const cached = prices[suffixed] || prices[raw] || null;
                    if (cached?.zoho_product_id) {
                      preResolved[raw] = {
                        suffixed_sku: suffixed,
                        product_id: cached.zoho_product_id,
                        list_price: cached.list || null,
                        ecomm_price: cached.price || null,
                        discount_per_unit: cached.discount_per_unit || 0,
                        product_active: true
                      };
                      // Also pre-resolve licenses
                      const licOptions = getLicenseSkus(raw);
                      if (licOptions?.length) {
                        for (const lic of licOptions) {
                          const licCached = prices[lic.sku] || null;
                          if (licCached?.zoho_product_id) {
                            preResolved[lic.sku] = {
                              suffixed_sku: lic.sku,
                              product_id: licCached.zoho_product_id,
                              list_price: licCached.list || null,
                              ecomm_price: licCached.price || null,
                              discount_per_unit: licCached.discount_per_unit || 0,
                              product_active: true
                            };
                          }
                        }
                      }
                    }
                  }
                  if (Object.keys(preResolved).length > 0) {
                    enrichedMessage += `\n\n[Pre-resolved products: ${JSON.stringify(preResolved)}]`;
                    console.log(`[API/chat] Pre-resolved ${Object.keys(preResolved).length} products from cache`);
                  }
                }
              }

              // Use the same askClaude function as the GChat bot
              // This gives the extension chat full CRM tool-use capabilities
              let reply = await askClaude(
                enrichedMessage,
                chatPersonId,
                env,
                null,       // no image data
                useTools,   // enable CRM tools if CRM intent detected
                null,       // no progress callback for direct HTTP response
                120000      // 2-minute timeout for CRM operations
              );

              // Handle continuation objects (for very long CRM workflows)
              while (reply && reply.__continuation) {
                reply = await askClaudeContinue(
                  reply.messages, reply.tools, reply.systemPrompt,
                  reply.iteration, env, null, 120000
                );
              }

              const replyText = typeof reply === 'string' ? reply : (reply?.reply || 'No response generated.');

              // Save to history
              await addToHistory(env.CONVERSATION_KV, chatPersonId, 'user', enrichedMessage);
              await addToHistory(env.CONVERSATION_KV, chatPersonId, 'assistant', replyText);

              // Set CRM session if tools were used
              if (useTools) {
                await env.CONVERSATION_KV.put(`crm_session_${chatPersonId}`, 'active', { expirationTtl: 900 });
              }

              apiResult = { success: true, reply: replyText, usedTools: useTools };
            } catch (chatErr) {
              console.error(`[API/CHAT] Error: ${chatErr.message}`);
              apiResult = { success: false, error: 'Chat failed: ' + chatErr.message };
            }
            break;
          }

          // ── Admin Usage: API cost stats for sidebar dashboard ──
          case '/api/admin-usage': {
            try {
              const now = new Date();
              const monthKey = `usage_${now.getFullYear()}_${String(now.getMonth() + 1).padStart(2, '0')}`;
              const kv = env.CONVERSATION_KV;
              const usageData = await kv.get(monthKey, 'json');

              // Get price refresh status
              let priceStatus = null;
              try {
                priceStatus = await kv.get('prices_live', 'json');
              } catch (e) {}

              const pricesMeta = priceStatus ? {
                lastPriceRefresh: priceStatus._lastRefresh || 'Unknown',
                priceStats: (priceStatus._stats ? priceStatus._stats.updated + ' updated, ' + priceStatus._stats.skipped + ' skipped' : 'Unknown')
              } : {};

              apiResult = {
                totalInputTokens: usageData?.totalInputTokens || 0,
                totalOutputTokens: usageData?.totalOutputTokens || 0,
                totalCostUsd: usageData?.totalCostUsd || 0,
                requestCount: usageData?.requestCount || 0,
                bySource: usageData?.bySource || {},
                recentRequests: (usageData?.recentRequests || []).slice(0, 15),
                workerVersion: 'gchat-v2.5',
                ...pricesMeta
              };
            } catch (err) {
              apiResult = { error: 'Usage fetch failed: ' + err.message };
            }
            break;
          }

          case '/api/register-space': {
            const { userEmail: regEmail, spaceName: regSpaceName } = apiBody;
            if (!regEmail || !regSpaceName) {
              apiResult = { error: 'userEmail and spaceName are required' };
              break;
            }
            await env.CONVERSATION_KV.put(
              `gchat_dm_space:${regEmail.toLowerCase().trim()}`,
              regSpaceName,
              { expirationTtl: 86400 * 365 }
            );
            apiResult = { success: true, registered: { userEmail: regEmail, spaceName: regSpaceName } };
            break;
          }

          case '/api/handoff': {
            const { text: handoffText, emailContext: ec, userEmail: handoffUserEmail, gchatSpaceId: explicitSpaceId } = apiBody;
            if (!handoffText || !handoffUserEmail) {
              apiResult = { error: 'text and userEmail are required' };
              break;
            }

            const normalizedHandoffEmail = handoffUserEmail.toLowerCase().trim();
            let targetSpaceName = explicitSpaceId || null;
            if (!targetSpaceName) {
              targetSpaceName = await env.CONVERSATION_KV.get(`gchat_dm_space:${normalizedHandoffEmail}`);
            }
            if (!targetSpaceName) {
              apiResult = {
                success: false,
                error: 'No Google Chat space found for this user. Please send any message to the Stratus AI bot in Google Chat first, then try again.'
              };
              break;
            }

            const handoffPersonId = `email:${normalizedHandoffEmail}`;
            const subject      = ec?.subject     || '(no subject)';
            const senderName   = ec?.senderName  || ec?.senderEmail || 'unknown sender';
            const senderEmail  = ec?.senderEmail || '';
            const accountName  = ec?.accountName || null;
            const emailBodySnippet = (ec?.body || '').substring(0, 2000);

            // Detect reseller/VAR pattern: email says "for [Customer]" or "on behalf of [Customer]"
            const resellerMatch = handoffText.match(/\b(?:this\s+is\s+for|for\s+(?:my\s+customer|a\s+customer)|on\s+behalf\s+of)\s+([A-Z][a-zA-Z\s&.,'-]{2,50})/i)
              || (emailBodySnippet.match(/\b(?:this\s+is\s+for|for\s+(?:my\s+customer|a\s+customer)|on\s+behalf\s+of|for\s+a\s+different\s+customer)\s*:?\s*([A-Z][a-zA-Z\s&.,'-]{2,50})/i));
            const resellerEndCustomer = resellerMatch ? resellerMatch[1].trim() : null;
            const resellerNote = resellerEndCustomer
              ? `\n⚠️ RESELLER/VAR PATTERN DETECTED: The email says this is FOR "${resellerEndCustomer}". The SENDER (${senderEmail}) is a reseller — look up THEIR Zoho account by domain. Do NOT create a new account for "${resellerEndCustomer}". Name the deal: "[Sender Account] - ${resellerEndCustomer} - [Description]". Note the end customer in the Deal description.`
              : '';

            const compositeMessage =
              `[HANDOFF FROM GMAIL SIDEBAR — PRE-APPROVED. CRITICAL INSTRUCTIONS:
1. Execute the FULL workflow autonomously. Do NOT stop for confirmation at any step.
2. SPEED RULES: Keep narration to ONE LINE per step (e.g. "Found account: Acme. Creating deal..."). Do NOT write multi-sentence explanations before or after each tool call.
3. SEARCH ORDER: Search Accounts FIRST by company name (NEVER search Deals or run COQL before finding the Account). Search Accounts + Contacts in the SAME parallel call batch.
4. You MUST complete ALL of these steps in a SINGLE turn — do NOT end your turn early:
   a) Search Zoho Accounts by company name (use "contains" operator). In the SAME tool batch, search Contacts by sender email.
   b) If contact not found, create Contact linked to existing Account.
   c) Create Deal (defaults: Stage=Qualification, Lead_Source=Stratus Referal, Meraki_ISR=Stratus Sales)
   d) Call batch_product_lookup ONCE with ALL SKUs (hardware + licenses in one call — parallel, cached IDs)
   e) Create Quote with ALL line items at LIST PRICE
   f) Create follow-up Task on the Deal (due in 3 business days)
   g) Ask if user wants ecomm discounts applied
5. Only emit your final summary text AFTER all steps are complete. ALWAYS include Zoho links for every created record.
6. Do NOT stop after creating the Deal — the Quote with line items is the most important part.
7. Do NOT search WooProducts individually — use batch_product_lookup instead.${resellerNote}]\n\n[Email context: From ${senderName} (${senderEmail}), Subject: "${subject}", Account: ${accountName || 'unknown'}]\n\nUser request: ${handoffText}`;

            // Seed conversation history with email context
            if (emailBodySnippet) {
              await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'user',
                `[Email thread context — Subject: "${subject}" from ${senderName}]\n${emailBodySnippet}`
              );
              await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'assistant',
                `I have the email context loaded. Subject: "${subject}", From: ${senderName}. Ready to help with any requests related to this email or account.`
              );
            }

            let handoffReply;
            try {
              // Check handoffText (user's actual request), NOT compositeMessage.
              // The compositeMessage header always contains "Subject:" which would
              // trigger the email pattern and cause false CRM routing for pure quoting requests.
              const handoffIntent = detectCrmEmailIntent(handoffText);
              const hasCrmCreds = !!(env.ZOHO_CLIENT_ID && env.ZOHO_REFRESH_TOKEN);

              if (handoffIntent.hasAny && hasCrmCreds) {
                // Dedup guard: prevent duplicate dispatches from double-clicks or retries
                const dedupKey = `handoff_dedup_${normalizedHandoffEmail}_${handoffText.substring(0, 50).replace(/\s/g, '_')}`;
                const recentHandoff = await env.CONVERSATION_KV.get(dedupKey);
                if (recentHandoff) {
                  apiResult = { success: true, preview: '(already processing — duplicate request ignored)', targetSpace: targetSpaceName };
                  break;
                }
                await env.CONVERSATION_KV.put(dedupKey, 'active', { expirationTtl: 120 }); // 2-min dedup window

                // ARCHITECTURE: Process CRM work INLINE within this HTTP request.
                // /api/handoff is a direct HTTP call (not a webhook with a 30s timeout),
                // so it gets unlimited wall time on Workers Standard plan. The Gmail
                // Add-on has a 25s deadline but treats timeouts as "pending success" —
                // the user is told to check GChat. Running inline avoids ctx.waitUntil
                // which was silently killing the agent after ~30s.
                console.log(`[HANDOFF] Processing CRM work inline for: "${handoffText.substring(0, 80)}..."`);

                // Send "Working on it..." to GChat
                let _progressMsgName = null;
                let _stepLog = [];
                try {
                  const thinkingMsg = await sendAsyncGChatMessage(targetSpaceName, '⏳ Working on it...', null, env);
                  _progressMsgName = thinkingMsg?.name || null;
                } catch (initErr) {
                  console.warn(`[HANDOFF] Could not send progress message: ${initErr.message}`);
                }

                // Progress callback for real-time step updates
                const progressCallback = _progressMsgName
                  ? async (msg) => {
                      if (msg) {
                        const lines = msg.split('\n').filter(l => /^[🔍📄🔗✏️📦🌐📧✍️📤⚙️]/.test(l.trim()));
                        for (const line of lines) {
                          const trimmed = line.trim();
                          if (_stepLog.length === 0 || _stepLog[_stepLog.length - 1] !== trimmed) {
                            _stepLog.push(trimmed);
                          }
                        }
                      }
                      const recentSteps = _stepLog.slice(-5);
                      const display = recentSteps.length > 0
                        ? `⏳ *Working on it...*\n\n${recentSteps.join('\n')}`
                        : '⏳ Working on it...';
                      try { await updateGChatMessage(_progressMsgName, display, env); } catch (_) {}
                    }
                  : async () => {};

                // Run the full CRM agentic loop — 5-min deadline (plenty for 15-25 tool calls)
                let result = await askClaude(compositeMessage, handoffPersonId, env, null, true, progressCallback, 300000);

                // Handle continuation if deadline was hit (unlikely with 5 min)
                while (result && result.__continuation) {
                  console.log(`[HANDOFF] Continuation at iteration ${result.iteration}`);
                  result = await askClaudeContinue(
                    result.messages, result.tools, result.systemPrompt,
                    result.iteration, env, progressCallback, 300000
                  );
                }

                // Deliver final response
                let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
                finalReply = adaptMarkdownForGChat(finalReply);
                finalReply = truncateGChatReply(finalReply);

                let delivered = false;
                if (_progressMsgName) {
                  try {
                    delivered = await updateGChatMessage(_progressMsgName, finalReply, env);
                  } catch (_) {}
                }
                if (!delivered) {
                  await sendAsyncGChatMessage(targetSpaceName, finalReply, null, env);
                }

                // Save conversation history
                await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'user', compositeMessage);
                await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'assistant', finalReply);
                await env.CONVERSATION_KV.put(`crm_session_${handoffPersonId}`, 'active', { expirationTtl: 600 });

                console.log(`[HANDOFF] CRM work completed inline`);
                handoffReply = 'Processing — check Google Chat for your results.';
              } else {
                // Quoting / Claude fallback — synchronous
                const handoffParsed = parseMessage(compositeMessage);
                if (handoffParsed) {
                  const handoffResult = buildQuoteResponse(handoffParsed);
                  if (!handoffResult.needsLlm && handoffResult.message) {
                    handoffReply = handoffResult.message;
                  }
                }
                if (!handoffReply) {
                  handoffReply = await askClaude(compositeMessage, handoffPersonId, env, null, false, null, 50000);
                }
                if (handoffReply) {
                  await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'user', compositeMessage);
                  await addToHistory(env.CONVERSATION_KV, handoffPersonId, 'assistant', handoffReply);
                }
                const formattedHandoffReply = adaptMarkdownForGChat(
                  truncateGChatReply(`*From Gmail sidebar (Re: ${subject})*\n\n` + (handoffReply || 'No response generated.'))
                );
                await sendAsyncGChatMessage(targetSpaceName, formattedHandoffReply, null, env);
              }
            } catch (handoffErr) {
              console.error(`[HANDOFF] Processing error: ${handoffErr.message}`);
              try {
                await sendAsyncGChatMessage(targetSpaceName,
                  `Something went wrong processing your Gmail sidebar request: ${handoffErr.message.substring(0, 200)}`,
                  null, env);
              } catch (_) {}
              apiResult = { success: false, error: handoffErr.message };
              break;
            }

            apiResult = {
              success: true,
              preview: (typeof handoffReply === 'string' ? handoffReply : 'Processing...').substring(0, 100),
              targetSpace: targetSpaceName
            };
            break;
          }

          // ══════════════════════════════════════════════════════════════
          // ── Direct Zoho CRM Sidebar Endpoints (zero AI cost) ──
          // These replace the Zoho for Gmail Chrome Extension.
          // All endpoints call Zoho REST API directly via zohoApiCall().
          // ══════════════════════════════════════════════════════════════

          // ── CRM Full Batch: Contact + Account + Deals + Tasks + Quotes in ONE call ──
          // Pre-fetches all CRM data for a sender so the sidebar tabs load instantly from cache.
          // Returns { contact, account, deals, tasks, recentCompleted, quotes, found }.
          // All Zoho queries run in parallel via Promise.all for ~1s total response time.
          case '/api/crm-full': {
            const { email: fullEmail, domain: fullDomain, include: fullInclude } = apiBody;
            if (!fullEmail && !fullDomain) {
              return new Response(JSON.stringify({ error: 'email or domain required' }), { status: 400, headers: jsonHeaders });
            }

            // Default: include everything
            const sections = fullInclude || ['deals', 'tasks', 'quotes'];

            try {
              // ── KV cache check (5-min TTL for full batch) ──
              const fullCacheKey = `crm_full_${fullEmail || fullDomain}`;
              if (env.GCHAT_CONVERSATION_KV) {
                try {
                  const cached = await env.GCHAT_CONVERSATION_KV.get(fullCacheKey, 'json');
                  if (cached) {
                    console.log(`[CRM-FULL] Cache hit for ${fullEmail || fullDomain}`);
                    apiResult = cached;
                    break;
                  }
                } catch (_) {}
              }

              // ── Phase 1: Contact + Account lookup (reuses /api/crm-contact logic) ──
              let contact = null;
              let account = null;
              const isCiscoEmail = fullEmail && fullEmail.toLowerCase().endsWith('@cisco.com');

              if (isCiscoEmail) {
                const isrResp = await zohoApiCall('GET',
                  `Meraki_ISRs/search?criteria=(Email:equals:${encodeURIComponent(fullEmail)})&fields=id,Name,Email,Title,Phone,Points_Current,Meraki_Team,Vertical`, env
                ).catch(() => null);
                if (isrResp?.data?.[0]) {
                  const isr = isrResp.data[0];
                  const nameParts = (isr.Name || '').split(' ');
                  const _sv = (v) => (v && typeof v === 'object') ? (v.name || v.Name || '') : (v || '');
                  contact = {
                    id: isr.id, firstName: nameParts[0] || '', lastName: nameParts.slice(1).join(' ') || '',
                    fullName: isr.Name || '', email: isr.Email || fullEmail, phone: isr.Phone || '',
                    mobile: '', title: _sv(isr.Title) || 'Cisco Rep', accountId: null,
                    accountName: 'Cisco Systems (Meraki ISR)', address: '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/CustomModule9/${isr.id}`,
                    isCiscoRep: true,
                    pointsCurrent: typeof isr.Points_Current === 'number' ? isr.Points_Current : (Number(isr.Points_Current) || ''),
                    merakiTeam: _sv(isr.Meraki_Team),
                    vertical: _sv(isr.Vertical),
                  };
                }
                // Cisco reps: no account/deals/tasks/quotes
                apiResult = { contact, account: null, deals: [], tasks: [], recentCompleted: [], quotes: [], weborders: [], found: !!contact, isCiscoRep: true };
              } else {
                // Standard contact + account parallel lookup
                const contactPromise = fullEmail
                  ? zohoApiCall('GET',
                      `Contacts/search?email=${encodeURIComponent(fullEmail)}&fields=id,First_Name,Last_Name,Full_Name,Email,Phone,Mobile,Title,Account_Name,Mailing_Street,Mailing_City,Mailing_State,Mailing_Zip`, env
                    ).catch(() => null)
                  : Promise.resolve(null);

                const domainCore = fullDomain ? fullDomain.replace(/^(www\.)/i, '') : '';
                const domainPromise = domainCore
                  ? zohoApiCall('GET',
                      `Accounts/search?criteria=((Website:starts_with:${encodeURIComponent(domainCore)}))&fields=id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code,Industry&per_page=3`, env
                    ).catch(() => null)
                  : Promise.resolve(null);

                const [contactResp, domainResp] = await Promise.all([contactPromise, domainPromise]);

                if (contactResp?.data?.[0]) {
                  const c = contactResp.data[0];
                  contact = {
                    id: c.id, firstName: c.First_Name || '', lastName: c.Last_Name || '',
                    fullName: c.Full_Name || ((c.First_Name || '') + ' ' + (c.Last_Name || '')).trim(),
                    email: c.Email || fullEmail, phone: c.Phone || '', mobile: c.Mobile || '',
                    title: c.Title || '', accountId: c.Account_Name?.id || null,
                    accountName: c.Account_Name?.name || '',
                    address: [c.Mailing_Street, c.Mailing_City, c.Mailing_State, c.Mailing_Zip].filter(Boolean).join(', '),
                  };
                }

                const acctId = contact?.accountId;
                if (acctId) {
                  try {
                    const acctResp = await zohoApiCall('GET',
                      `Accounts/${acctId}?fields=id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code,Industry`, env
                    );
                    if (acctResp?.data?.[0]) {
                      const a = acctResp.data[0];
                      account = {
                        id: a.id, name: a.Account_Name || '', phone: a.Phone || '',
                        website: a.Website || '',
                        address: [a.Billing_Street, a.Billing_City, a.Billing_State, a.Billing_Code].filter(Boolean).join(', '),
                        industry: a.Industry || '',
                        zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${a.id}`,
                      };
                    }
                  } catch (_) {}
                } else if (domainResp?.data?.[0]) {
                  const a = domainResp.data[0];
                  account = {
                    id: a.id, name: a.Account_Name || '', phone: a.Phone || '',
                    website: a.Website || '',
                    address: [a.Billing_Street, a.Billing_City, a.Billing_State, a.Billing_Code].filter(Boolean).join(', '),
                    industry: a.Industry || '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${a.id}`,
                  };
                }

                if (contact) {
                  contact.zohoUrl = `https://crm.zoho.com/crm/org647122552/tab/Contacts/${contact.id}`;
                }

                // ── Phase 2: Deals + Tasks + Quotes in PARALLEL ──
                const resolvedAcctId = account?.id || null;
                const resolvedContactId = contact?.id || null;
                const resolvedContactEmail = contact?.email || fullEmail || '';

                // Build parallel promises based on requested sections
                const dealsPromise = (sections.includes('deals') && resolvedAcctId)
                  ? (async () => {
                      try {
                        const coql = `select Deal_Name, Stage, Amount, Closing_Date, Probability, Contact_Name, Owner from Deals where Account_Name.id = '${resolvedAcctId}' order by Closing_Date desc limit 20`;
                        const resp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                        return (resp?.data || []).map(d => ({
                          id: d.id, name: d.Deal_Name || '', stage: d.Stage || '',
                          amount: d.Amount || 0, closingDate: d.Closing_Date || '',
                          probability: d.Probability || 0, contactName: d.Contact_Name?.name || '',
                          ownerName: d.Owner?.name || '',
                          zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Deals/${d.id}`,
                        }));
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                const tasksPromise = (sections.includes('tasks') && (resolvedContactId || resolvedAcctId))
                  ? (async () => {
                      try {
                        const taskFields = 'Subject, Status, Due_Date, Priority, Description, What_Id, Who_Id, Owner';
                        const seenIds = new Set();
                        let tasks = [];
                        const mapT = (t) => ({
                          id: t.id, subject: t.Subject || '(no subject)', status: t.Status || 'Not Started',
                          dueDate: t.Due_Date || null, priority: t.Priority || 'Normal',
                          description: t.Description ? t.Description.substring(0, 200) : '',
                          dealId: t.What_Id?.id || null, dealName: t.What_Id?.name || null,
                          contactId: t.Who_Id?.id || null, contactName: t.Who_Id?.name || null,
                          ownerName: t.Owner?.name || '',
                          zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${t.id}`,
                        });

                        // Contact-based tasks + deal-based tasks in parallel
                        const contactTaskP = resolvedContactId
                          ? zohoApiCall('POST', 'coql', env, {
                              select_query: `select ${taskFields} from Tasks where Who_Id = '${resolvedContactId}' and Status not in ('Completed') order by Due_Date asc limit 25`
                            }).catch(() => null)
                          : Promise.resolve(null);

                        const dealTaskP = resolvedAcctId
                          ? (async () => {
                              const dResp = await zohoApiCall('POST', 'coql', env, {
                                select_query: `select id from Deals where Account_Name = '${resolvedAcctId}' and Stage not in ('Closed (Lost)') limit 50`
                              }).catch(() => null);
                              if (dResp?.data?.length) {
                                const dealIds = dResp.data.map(d => `'${d.id}'`).join(',');
                                return zohoApiCall('POST', 'coql', env, {
                                  select_query: `select ${taskFields} from Tasks where What_Id in (${dealIds}) and Status not in ('Completed') order by Due_Date asc limit 25`
                                }).catch(() => null);
                              }
                              return null;
                            })()
                          : Promise.resolve(null);

                        const [cTaskResp, dTaskResp] = await Promise.all([contactTaskP, dealTaskP]);
                        for (const resp of [cTaskResp, dTaskResp]) {
                          if (resp?.data) {
                            for (const t of resp.data) {
                              if (!seenIds.has(t.id)) { seenIds.add(t.id); tasks.push(mapT(t)); }
                            }
                          }
                        }
                        tasks.sort((a, b) => {
                          if (!a.dueDate) return 1; if (!b.dueDate) return -1;
                          return a.dueDate.localeCompare(b.dueDate);
                        });
                        return tasks;
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                const recentCompPromise = (sections.includes('tasks') && (resolvedContactId || resolvedAcctId))
                  ? (async () => {
                      try {
                        let coql;
                        if (resolvedContactId) {
                          coql = `select Subject, Status, Due_Date, Modified_Time from Tasks where Who_Id = '${resolvedContactId}' and Status = 'Completed' order by Modified_Time desc limit 5`;
                        } else if (resolvedAcctId) {
                          const dResp = await zohoApiCall('POST', 'coql', env, {
                            select_query: `select id from Deals where Account_Name = '${resolvedAcctId}' limit 50`
                          }).catch(() => null);
                          if (dResp?.data?.length) {
                            const ids = dResp.data.map(d => `'${d.id}'`).join(',');
                            coql = `select Subject, Status, Due_Date, Modified_Time from Tasks where What_Id in (${ids}) and Status = 'Completed' order by Modified_Time desc limit 5`;
                          }
                        }
                        if (!coql) return [];
                        const resp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                        return (resp?.data || []).map(t => ({
                          id: t.id, subject: t.Subject || '', completedDate: t.Modified_Time ? t.Modified_Time.split('T')[0] : '',
                          zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${t.id}`,
                        }));
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                const quotesPromise = (sections.includes('quotes') && resolvedAcctId)
                  ? (async () => {
                      try {
                        const coql = `select Subject, Quote_Number, Grand_Total, Stage, Valid_Till, Deal_Name, Created_Time from Quotes where Account_Name.id = '${resolvedAcctId}' order by Created_Time desc limit 15`;
                        const resp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                        return (resp?.data || []).map(q => ({
                          id: q.id, subject: q.Subject || '', quoteNumber: q.Quote_Number || '',
                          grandTotal: q.Grand_Total || 0, stage: q.Stage || '',
                          validTill: q.Valid_Till || '', dealName: q.Deal_Name?.name || '',
                          createdTime: q.Created_Time ? q.Created_Time.split('T')[0] : '',
                          zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${q.id}`,
                        }));
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                // Weborders: Sales_Orders linked to this account that have NO deal associated
                const webordersPromise = (sections.includes('deals') && resolvedAcctId)
                  ? (async () => {
                      try {
                        const coql = `select Subject, SO_Number, Grand_Total, Status, Created_Time, Deal_Name, Owner, Client_Send_Status, Disti_Tracking_Number, Disti_Estimated_Ship_Date, Vendor_SO_Number, Web_Order_ID from Sales_Orders where Account_Name.id = '${resolvedAcctId}' and Deal_Name is null order by Created_Time desc limit 15`;
                        const resp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                        return (resp?.data || []).map(so => ({
                          id: so.id,
                          subject: so.Subject || '',
                          soNumber: so.SO_Number || '',
                          grandTotal: so.Grand_Total || 0,
                          status: so.Status || '',
                          poStatus: so.Client_Send_Status || '',
                          trackingNumber: so.Disti_Tracking_Number || '',
                          estimatedShipDate: so.Disti_Estimated_Ship_Date || '',
                          vendorSoNumber: so.Vendor_SO_Number || '',
                          webOrderId: so.Web_Order_ID || '',
                          createdTime: so.Created_Time ? so.Created_Time.split('T')[0] : '',
                          ownerName: so.Owner?.name || '',
                          zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/SalesOrders/${so.id}`,
                        }));
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                // Sales Orders linked to deals (for SO details on Closed Won deals)
                const dealSosPromise = (sections.includes('deals') && resolvedAcctId)
                  ? (async () => {
                      try {
                        const coql = `select SO_Number, Deal_Name, Client_Send_Status, Disti_Tracking_Number, Disti_Estimated_Ship_Date, Vendor_SO_Number, Web_Order_ID from Sales_Orders where Account_Name.id = '${resolvedAcctId}' and Deal_Name is not null order by Created_Time desc limit 50`;
                        const resp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                        return (resp?.data || []).map(so => ({
                          dealId: so.Deal_Name?.id || '',
                          soNumber: so.SO_Number || '',
                          poStatus: so.Client_Send_Status || '',
                          trackingNumber: so.Disti_Tracking_Number || '',
                          estimatedShipDate: so.Disti_Estimated_Ship_Date || '',
                          vendorSoNumber: so.Vendor_SO_Number || '',
                          webOrderId: so.Web_Order_ID || '',
                        }));
                      } catch (_) { return []; }
                    })()
                  : Promise.resolve([]);

                // Fire all in parallel
                const [deals, tasks, recentCompleted, quotes, weborders, dealSos] = await Promise.all([
                  dealsPromise, tasksPromise, recentCompPromise, quotesPromise, webordersPromise, dealSosPromise
                ]);

                // Merge Sales Order details onto their linked deals
                if (dealSos.length > 0) {
                  const soByDeal = {};
                  for (const so of dealSos) {
                    if (so.dealId && !soByDeal[so.dealId]) soByDeal[so.dealId] = so;
                  }
                  for (const deal of deals) {
                    const so = soByDeal[deal.id];
                    if (so) {
                      deal.soNumber = so.soNumber;
                      deal.poStatus = so.poStatus;
                      deal.trackingNumber = so.trackingNumber;
                      deal.estimatedShipDate = so.estimatedShipDate;
                      deal.vendorSoNumber = so.vendorSoNumber;
                      deal.webOrderId = so.webOrderId;
                    }
                  }
                }

                apiResult = { contact, account, deals, tasks, recentCompleted, quotes, weborders, found: !!(contact || account) };
              }

              // Cache in KV (5-min TTL)
              if (env.GCHAT_CONVERSATION_KV && apiResult.found) {
                ctx.waitUntil(
                  env.GCHAT_CONVERSATION_KV.put(fullCacheKey, JSON.stringify(apiResult), { expirationTtl: 300 })
                    .catch(() => {})
                );
              }
            } catch (err) {
              apiResult = { error: 'CRM full lookup failed: ' + err.message, contact: null, account: null, deals: [], tasks: [], recentCompleted: [], quotes: [], weborders: [], found: false };
            }
            break;
          }

          // ── CRM Contact Lookup: Find contact + account by email/domain ──
          // Optimized: parallel Zoho calls + server-side KV cache (10-min TTL)
          case '/api/crm-contact': {
            const { email: contactEmail, domain: contactDomain } = apiBody;
            if (!contactEmail && !contactDomain) {
              return new Response(JSON.stringify({ error: 'email or domain required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              // Check KV cache first (10-min TTL)
              const cacheKey = `crm_contact_${contactEmail || contactDomain}`;
              if (env.GCHAT_CONVERSATION_KV) {
                try {
                  const cached = await env.GCHAT_CONVERSATION_KV.get(cacheKey, 'json');
                  if (cached) {
                    console.log(`[CRM-CONTACT] Cache hit for ${contactEmail || contactDomain}`);
                    apiResult = cached;
                    break;
                  }
                } catch (_) {}
              }

              let contact = null;
              let account = null;

              // ── Cisco rep detection: search Meraki_ISRs module instead of Contacts ──
              const isCiscoEmail = contactEmail && contactEmail.toLowerCase().endsWith('@cisco.com');

              if (isCiscoEmail) {
                // Search Meraki_ISRs module by email for Cisco reps (API name = Meraki_ISRs)
                console.log(`[CRM-CONTACT] Cisco email detected: ${contactEmail} — searching Meraki_ISRs`);
                const isrResp = await zohoApiCall('GET',
                  `Meraki_ISRs/search?criteria=(Email:equals:${encodeURIComponent(contactEmail)})&fields=id,Name,Email,Title,Phone,Points_Current,Meraki_Team,Vertical`, env
                ).catch(() => null);

                if (isrResp?.data?.[0]) {
                  const isr = isrResp.data[0];
                  const nameParts = (isr.Name || '').split(' ');
                  // Safely extract string values from potentially object-valued Zoho lookup fields
                  const _strVal = (v) => (v && typeof v === 'object') ? (v.name || v.Name || String(v) || '') : (v || '');
                  contact = {
                    id: isr.id,
                    firstName: nameParts[0] || '',
                    lastName: nameParts.slice(1).join(' ') || '',
                    fullName: isr.Name || '',
                    email: isr.Email || contactEmail,
                    phone: isr.Phone || '',
                    mobile: '',
                    title: _strVal(isr.Title) || 'Cisco Rep',
                    accountId: null,
                    accountName: 'Cisco Systems (Meraki ISR)',
                    address: '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/CustomModule9/${isr.id}`,
                    isCiscoRep: true,
                    pointsCurrent: typeof isr.Points_Current === 'number' ? isr.Points_Current : (Number(isr.Points_Current) || ''),
                    merakiTeam: _strVal(isr.Meraki_Team),
                    vertical: _strVal(isr.Vertical),
                  };
                }
                // No account lookup needed for Cisco reps
                apiResult = { contact, account: null, found: !!contact, isCiscoRep: true };

              } else {
                // Standard flow: search Contacts + Accounts in parallel

                // PARALLEL: Search contact by email AND account by domain simultaneously
                const contactPromise = contactEmail
                  ? zohoApiCall('GET',
                      `Contacts/search?email=${encodeURIComponent(contactEmail)}&fields=id,First_Name,Last_Name,Full_Name,Email,Phone,Mobile,Title,Account_Name,Mailing_Street,Mailing_City,Mailing_State,Mailing_Zip`, env
                    ).catch(() => null)
                  : Promise.resolve(null);

                // Strip common prefixes for starts_with matching (easyice.com matches "https://www.easyice.com")
                const domainCore = contactDomain ? contactDomain.replace(/^(www\.)/i, '') : '';
                const domainPromise = domainCore
                  ? zohoApiCall('GET',
                      `Accounts/search?criteria=((Website:starts_with:${encodeURIComponent(domainCore)}))&fields=id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code,Industry&per_page=3`, env
                    ).catch(() => null)
                  : Promise.resolve(null);

                const [contactResp, domainResp] = await Promise.all([contactPromise, domainPromise]);

                // Process contact result
                if (contactResp?.data?.[0]) {
                  const c = contactResp.data[0];
                  contact = {
                    id: c.id,
                    firstName: c.First_Name || '',
                    lastName: c.Last_Name || '',
                    fullName: c.Full_Name || ((c.First_Name || '') + ' ' + (c.Last_Name || '')).trim(),
                    email: c.Email || contactEmail,
                    phone: c.Phone || '',
                    mobile: c.Mobile || '',
                    title: c.Title || '',
                    accountId: c.Account_Name?.id || null,
                    accountName: c.Account_Name?.name || '',
                    address: [c.Mailing_Street, c.Mailing_City, c.Mailing_State, c.Mailing_Zip].filter(Boolean).join(', '),
                  };
                }

                // Resolve account: prefer linked account from contact, fall back to domain search
                const acctId = contact?.accountId;
                if (acctId) {
                  // Contact has linked account — fetch full details
                  try {
                    const acctResp = await zohoApiCall('GET',
                      `Accounts/${acctId}?fields=id,Account_Name,Phone,Website,Billing_Street,Billing_City,Billing_State,Billing_Code,Industry`, env
                    );
                    if (acctResp?.data?.[0]) {
                      const a = acctResp.data[0];
                      account = {
                        id: a.id,
                        name: a.Account_Name || '',
                        phone: a.Phone || '',
                        website: a.Website || '',
                        address: [a.Billing_Street, a.Billing_City, a.Billing_State, a.Billing_Code].filter(Boolean).join(', '),
                        industry: a.Industry || '',
                        zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${a.id}`,
                      };
                    }
                  } catch (_) {}
                } else if (domainResp?.data?.[0]) {
                  // Use the domain search result that ran in parallel
                  const a = domainResp.data[0];
                  account = {
                    id: a.id,
                    name: a.Account_Name || '',
                    phone: a.Phone || '',
                    website: a.Website || '',
                    address: [a.Billing_Street, a.Billing_City, a.Billing_State, a.Billing_Code].filter(Boolean).join(', '),
                    industry: a.Industry || '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${a.id}`,
                  };
                }

                if (contact) {
                  contact.zohoUrl = `https://crm.zoho.com/crm/org647122552/tab/Contacts/${contact.id}`;
                }

                apiResult = { contact, account, found: !!(contact || account) };
              }

              // Cache result in KV (10-min TTL)
              if (env.GCHAT_CONVERSATION_KV && apiResult.found) {
                ctx.waitUntil(
                  env.GCHAT_CONVERSATION_KV.put(cacheKey, JSON.stringify(apiResult), { expirationTtl: 600 })
                    .catch(() => {})
                );
              }
            } catch (err) {
              apiResult = { error: 'Contact lookup failed: ' + err.message, contact: null, account: null, found: false };
            }
            break;
          }

          // ── CRM Deals: Get deals for an account ──
          case '/api/crm-deals': {
            const { accountId: dealsAcctId, contactEmail: dealsContactEmail } = apiBody;
            if (!dealsAcctId && !dealsContactEmail) {
              return new Response(JSON.stringify({ error: 'accountId or contactEmail required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              let deals = [];
              let weborders = [];
              let targetAccountId = dealsAcctId;

              // If no accountId, look it up from contact email
              if (!targetAccountId && dealsContactEmail) {
                const cResp = await zohoApiCall('GET',
                  `Contacts/search?email=${encodeURIComponent(dealsContactEmail)}&fields=id,Account_Name`, env
                );
                if (cResp?.data?.[0]?.Account_Name?.id) {
                  targetAccountId = cResp.data[0].Account_Name.id;
                }
              }

              if (targetAccountId) {
                // Use COQL for flexible deal retrieval sorted by Closing_Date desc
                const coql = `select Deal_Name, Stage, Amount, Closing_Date, Probability, Contact_Name, Owner from Deals where Account_Name.id = '${targetAccountId}' order by Closing_Date desc limit 20`;
                const dealResp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                if (dealResp?.data) {
                  deals = dealResp.data.map(d => ({
                    id: d.id,
                    name: d.Deal_Name || '',
                    stage: d.Stage || '',
                    amount: d.Amount || 0,
                    closingDate: d.Closing_Date || '',
                    probability: d.Probability || 0,
                    contactName: d.Contact_Name?.name || '',
                    ownerName: d.Owner?.name || '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Deals/${d.id}`,
                  }));
                }

                // Also fetch weborders (Sales_Orders without a Deal linked) for this account
                try {
                  const woCoql = `select Subject, SO_Number, Grand_Total, Status, Created_Time, Deal_Name, Owner, Client_Send_Status, Disti_Tracking_Number, Disti_Estimated_Ship_Date, Vendor_SO_Number, Web_Order_ID from Sales_Orders where Account_Name.id = '${targetAccountId}' and Deal_Name is null order by Created_Time desc limit 15`;
                  const woResp = await zohoApiCall('POST', 'coql', env, { select_query: woCoql });
                  if (woResp?.data) {
                    weborders = woResp.data.map(so => ({
                      id: so.id,
                      subject: so.Subject || '',
                      soNumber: so.SO_Number || '',
                      grandTotal: so.Grand_Total || 0,
                      status: so.Status || '',
                      poStatus: so.Client_Send_Status || '',
                      trackingNumber: so.Disti_Tracking_Number || '',
                      estimatedShipDate: so.Disti_Estimated_Ship_Date || '',
                      vendorSoNumber: so.Vendor_SO_Number || '',
                          webOrderId: so.Web_Order_ID || '',
                      createdTime: so.Created_Time ? so.Created_Time.split('T')[0] : '',
                      ownerName: so.Owner?.name || '',
                      zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/SalesOrders/${so.id}`,
                    }));
                  }
                } catch (_) {}

                // Fetch Sales Orders linked to deals (for SO details on Closed Won deals)
                try {
                  const soCoql = `select SO_Number, Deal_Name, Client_Send_Status, Disti_Tracking_Number, Disti_Estimated_Ship_Date, Vendor_SO_Number, Web_Order_ID from Sales_Orders where Account_Name.id = '${targetAccountId}' and Deal_Name is not null order by Created_Time desc limit 50`;
                  const soResp = await zohoApiCall('POST', 'coql', env, { select_query: soCoql });
                  if (soResp?.data) {
                    const soByDeal = {};
                    for (const so of soResp.data) {
                      const dId = so.Deal_Name?.id;
                      if (dId && !soByDeal[dId]) {
                        soByDeal[dId] = {
                          soNumber: so.SO_Number || '',
                          poStatus: so.Client_Send_Status || '',
                          trackingNumber: so.Disti_Tracking_Number || '',
                          estimatedShipDate: so.Disti_Estimated_Ship_Date || '',
                          vendorSoNumber: so.Vendor_SO_Number || '',
                          webOrderId: so.Web_Order_ID || '',
                        };
                      }
                    }
                    for (const deal of deals) {
                      const so = soByDeal[deal.id];
                      if (so) Object.assign(deal, so);
                    }
                  }
                } catch (_) {}

                // Fetch CCW Deal Number from the most recent quote per deal
                try {
                  const dealIds = deals.map(d => d.id).filter(Boolean);
                  if (dealIds.length > 0) {
                    const dealIdList = dealIds.map(id => `'${id}'`).join(',');
                    const qtCoql = `select CCW_Deal_Number, Deal_Name, Created_Time from Quotes where Deal_Name.id in (${dealIdList}) and CCW_Deal_Number is not null order by Created_Time desc limit 50`;
                    const qtResp = await zohoApiCall('POST', 'coql', env, { select_query: qtCoql });
                    if (qtResp?.data) {
                      // Map: first (most recent) CCW Deal Number per deal
                      const ccwByDeal = {};
                      for (const q of qtResp.data) {
                        const dId = q.Deal_Name?.id;
                        if (dId && !ccwByDeal[dId]) {
                          ccwByDeal[dId] = q.CCW_Deal_Number;
                        }
                      }
                      for (const deal of deals) {
                        if (ccwByDeal[deal.id]) {
                          deal.ccwDealNumber = ccwByDeal[deal.id];
                        }
                      }
                    }
                  }
                } catch (_) {}
              }

              apiResult = { deals, weborders, accountId: targetAccountId || null };
            } catch (err) {
              apiResult = { error: 'Deals lookup failed: ' + err.message, deals: [], weborders: [] };
            }
            break;
          }

          // ── CRM Activities: Get open tasks for a contact/account ──
          case '/api/crm-activities': {
            const { accountId: actAcctId, contactId: actContactId } = apiBody;
            if (!actAcctId && !actContactId) {
              return new Response(JSON.stringify({ error: 'accountId or contactId required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              let tasks = [];
              const taskFields = 'Subject, Status, Due_Date, Priority, Description, What_Id, Who_Id, Owner';
              const seenTaskIds = new Set();

              const mapTask = (t) => ({
                id: t.id,
                subject: t.Subject || '(no subject)',
                status: t.Status || 'Not Started',
                dueDate: t.Due_Date || null,
                priority: t.Priority || 'Normal',
                description: t.Description ? t.Description.substring(0, 200) : '',
                dealId: t.What_Id?.id || null,
                dealName: t.What_Id?.name || null,
                contactId: t.Who_Id?.id || null,
                contactName: t.Who_Id?.name || null,
                ownerName: t.Owner?.name || '',
                zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${t.id}`,
              });

              // Strategy 1: Query by contact (Who_Id) - most reliable, single-level lookup
              if (actContactId) {
                try {
                  const contactCoql = `select ${taskFields} from Tasks where Who_Id = '${actContactId}' and Status not in ('Completed') order by Due_Date asc limit 25`;
                  const contactResp = await zohoApiCall('POST', 'coql', env, { select_query: contactCoql });
                  if (contactResp?.data) {
                    for (const t of contactResp.data) {
                      if (!seenTaskIds.has(t.id)) {
                        seenTaskIds.add(t.id);
                        tasks.push(mapTask(t));
                      }
                    }
                  }
                } catch (_) { /* contact query failed, continue to deal-based */ }
              }

              // Strategy 2: Query by deal IDs (for tasks not linked to a contact directly)
              if (actAcctId) {
                try {
                  // First get the account's deal IDs
                  const dealsCoql = `select id from Deals where Account_Name = '${actAcctId}' and Stage not in ('Closed (Lost)') limit 50`;
                  const dealsResp = await zohoApiCall('POST', 'coql', env, { select_query: dealsCoql });
                  if (dealsResp?.data && dealsResp.data.length > 0) {
                    const dealIds = dealsResp.data.map(d => `'${d.id}'`).join(',');
                    const dealTaskCoql = `select ${taskFields} from Tasks where What_Id in (${dealIds}) and Status not in ('Completed') order by Due_Date asc limit 25`;
                    const dealTaskResp = await zohoApiCall('POST', 'coql', env, { select_query: dealTaskCoql });
                    if (dealTaskResp?.data) {
                      for (const t of dealTaskResp.data) {
                        if (!seenTaskIds.has(t.id)) {
                          seenTaskIds.add(t.id);
                          tasks.push(mapTask(t));
                        }
                      }
                    }
                  }
                } catch (_) { /* deal-based query failed, continue with what we have */ }
              }

              // Sort merged results by due date
              tasks.sort((a, b) => {
                if (!a.dueDate) return 1;
                if (!b.dueDate) return -1;
                return a.dueDate.localeCompare(b.dueDate);
              });

              // Also fetch recently completed tasks (last 5)
              let recentCompleted = [];
              try {
                let compCoql;
                if (actContactId) {
                  compCoql = `select Subject, Status, Due_Date, Modified_Time from Tasks where Who_Id = '${actContactId}' and Status = 'Completed' order by Modified_Time desc limit 5`;
                } else if (actAcctId) {
                  // Get deal IDs for account, then completed tasks for those deals
                  const dealsCoql2 = `select id from Deals where Account_Name = '${actAcctId}' limit 50`;
                  const dealsResp2 = await zohoApiCall('POST', 'coql', env, { select_query: dealsCoql2 });
                  if (dealsResp2?.data && dealsResp2.data.length > 0) {
                    const dealIds2 = dealsResp2.data.map(d => `'${d.id}'`).join(',');
                    compCoql = `select Subject, Status, Due_Date, Modified_Time from Tasks where What_Id in (${dealIds2}) and Status = 'Completed' order by Modified_Time desc limit 5`;
                  }
                }
                if (compCoql) {
                  const compResp = await zohoApiCall('POST', 'coql', env, { select_query: compCoql });
                  if (compResp?.data) {
                    recentCompleted = compResp.data.map(t => ({
                      id: t.id,
                      subject: t.Subject || '',
                      completedDate: t.Modified_Time ? t.Modified_Time.split('T')[0] : '',
                      zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Tasks/${t.id}`,
                    }));
                  }
                }
              } catch (_) { /* recent completed is optional */ }

              apiResult = { tasks, recentCompleted };
            } catch (err) {
              apiResult = { error: 'Activities lookup failed: ' + err.message, tasks: [], recentCompleted: [] };
            }
            break;
          }

          // ── CRM Quotes: Get quotes for an account's deals ──
          case '/api/crm-quotes': {
            const { accountId: quotesAcctId, dealId: quotesDealId } = apiBody;
            if (!quotesAcctId && !quotesDealId) {
              return new Response(JSON.stringify({ error: 'accountId or dealId required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              let quotes = [];

              if (quotesDealId) {
                // Direct: get quotes for a specific deal
                const qResp = await zohoApiCall('GET',
                  `Deals/${quotesDealId}/Quotes?fields=id,Subject,Quote_Number,Grand_Total,Stage,Valid_Till,Created_Time&per_page=10`, env
                );
                if (qResp?.data) {
                  quotes = qResp.data.map(q => ({
                    id: q.id,
                    subject: q.Subject || '',
                    quoteNumber: q.Quote_Number || '',
                    grandTotal: q.Grand_Total || 0,
                    stage: q.Stage || '',
                    validTill: q.Valid_Till || '',
                    createdTime: q.Created_Time ? q.Created_Time.split('T')[0] : '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${q.id}`,
                  }));
                }
              } else if (quotesAcctId) {
                // Get quotes across all account deals via COQL
                const coql = `select Subject, Quote_Number, Grand_Total, Stage, Valid_Till, Deal_Name, Created_Time from Quotes where Account_Name.id = '${quotesAcctId}' order by Created_Time desc limit 15`;
                const qResp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                if (qResp?.data) {
                  quotes = qResp.data.map(q => ({
                    id: q.id,
                    subject: q.Subject || '',
                    quoteNumber: q.Quote_Number || '',
                    grandTotal: q.Grand_Total || 0,
                    stage: q.Stage || '',
                    validTill: q.Valid_Till || '',
                    dealName: q.Deal_Name?.name || '',
                    createdTime: q.Created_Time ? q.Created_Time.split('T')[0] : '',
                    zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${q.id}`,
                  }));
                }
              }

              apiResult = { quotes };
            } catch (err) {
              apiResult = { error: 'Quotes lookup failed: ' + err.message, quotes: [] };
            }
            break;
          }

          // ── CCW Lookup: Find a Zoho Quote by CCW Deal Number (with Deal Name fallback) ──
          case '/api/ccw-lookup': {
            const { ccwDealNumber, dealName } = apiBody;
            if (!ccwDealNumber && !dealName) {
              return new Response(JSON.stringify({ error: 'ccwDealNumber or dealName required' }), { status: 400, headers: jsonHeaders });
            }

            const mapQuote = (q) => ({
              id: q.id,
              subject: q.Subject || '',
              quoteNumber: q.Quote_Number || '',
              grandTotal: q.Grand_Total || 0,
              stage: q.Quote_Stage || q.Stage || '',
              ccwDealNumber: q.CCW_Deal_Number || '',
              dealId: q.Deal_Name?.id || '',
              dealName: q.Deal_Name?.name || '',
              accountName: q.Account_Name?.name || '',
              zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${q.id}`,
              dealUrl: q.Deal_Name?.id ? `https://crm.zoho.com/crm/org647122552/tab/Potentials/${q.Deal_Name.id}` : '',
            });

            try {
              let found = false;
              let matchMethod = '';

              // Primary: search by CCW Deal Number
              if (ccwDealNumber) {
                const coql = `select id, Subject, Quote_Number, Grand_Total, Quote_Stage, CCW_Deal_Number, Deal_Name, Account_Name from Quotes where CCW_Deal_Number = '${ccwDealNumber}' limit 1`;
                const qResp = await zohoApiCall('POST', 'coql', env, { select_query: coql });
                if (qResp?.data && qResp.data.length > 0) {
                  apiResult = { found: true, matchMethod: 'ccw', quote: mapQuote(qResp.data[0]) };
                  found = true;
                }
              }

              // Fallback: search by Deal Name (fuzzy match on Quote Subject)
              if (!found && dealName) {
                const DEAL_DESCRIPTORS = /\b(license|renewal|renewed|updated|update|upgrade|refresh|hardware|software|year|yr|month|mo|addon|add-on|modification|mod|replacement|subscription|sub|setup|install|installation|migration|expansion|new|existing|current|pricing|quote|deal|ecomm)\b/gi;
                const cleanName = dealName
                  .replace(/\d+/g, '')
                  .replace(DEAL_DESCRIPTORS, '')
                  .replace(/[-–—()]/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim();
                const words = cleanName.split(/\s+/).filter(w => w.length >= 2);
                const searchWords = words.slice(0, 3);

                if (searchWords.length > 0) {
                  const likeClause = searchWords.map(w => `Subject like '%${w}%'`).join(' and ');
                  const coql2 = `select id, Subject, Quote_Number, Grand_Total, Quote_Stage, CCW_Deal_Number, Deal_Name, Account_Name from Quotes where ${likeClause} order by Created_Time desc limit 5`;
                  const qResp2 = await zohoApiCall('POST', 'coql', env, { select_query: coql2 });
                  if (qResp2?.data && qResp2.data.length > 0) {
                    apiResult = {
                      found: true,
                      matchMethod: 'dealName',
                      searchTerm: searchWords.join(', '),
                      quote: mapQuote(qResp2.data[0]),
                      allQuotes: qResp2.data.map(mapQuote),
                    };
                    found = true;
                  }
                }
              }

              if (!found) {
                apiResult = { found: false };
              }
            } catch (err) {
              apiResult = { error: 'CCW lookup failed: ' + err.message, found: false };
            }
            break;
          }

          // ── Velocity Hub: Proxy deal approval submission to Pipedream webhook ──
          case '/api/velocity-hub': {
            const { deal_id, country } = apiBody;
            if (!deal_id) {
              return new Response(JSON.stringify({ error: 'deal_id required' }), { status: 400, headers: jsonHeaders });
            }
            try {
              const vhResp = await fetch('https://eo44ez435h7vzp2.m.pipedream.net', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ deal_id, country: country || 'United States' }),
              });
              const vhText = await vhResp.text();
              let vhData;
              try { vhData = JSON.parse(vhText); } catch (_) { vhData = { success: true, rawResponse: vhText.substring(0, 100) }; }
              apiResult = vhData;
            } catch (err) {
              apiResult = { success: false, error: 'Velocity Hub submission failed: ' + err.message };
            }
            break;
          }

          // ── Assign Cisco Rep: Update Deal's Meraki_ISR field ──
          // Accepts dealId + repId, OR dealId + repEmail (looks up via Meraki_ISRs module)
          case '/api/assign-rep': {
            const { dealId: arDealId, repId: arRepId, repName: arRepName, repEmail: arRepEmail } = apiBody;
            if (!arDealId) {
              return new Response(JSON.stringify({ error: 'dealId required' }), { status: 400, headers: jsonHeaders });
            }
            if (!arRepId && !arRepEmail) {
              return new Response(JSON.stringify({ error: 'repId or repEmail required' }), { status: 400, headers: jsonHeaders });
            }
            try {
              let finalRepId = arRepId || '';
              let finalRepName = arRepName || arRepEmail || '';

              // If no repId provided, look up via Meraki_ISRs module by email
              if (!finalRepId && arRepEmail) {
                const isrSearch = await zohoApiCall('GET',
                  `Meraki_ISRs/search?criteria=(Email:equals:${encodeURIComponent(arRepEmail)})&fields=id,Name,Email,Title,Phone,Points_Current,Meraki_Team,Vertical`, env
                ).catch(() => null);
                if (isrSearch?.data && isrSearch.data.length > 0) {
                  finalRepId = isrSearch.data[0].id;
                  finalRepName = isrSearch.data[0].Name || finalRepName;
                } else {
                  apiResult = { success: false, error: `Rep ${arRepEmail} not found in Meraki_ISRs module` };
                  break;
                }
              }

              const updateResp = await zohoApiCall('PUT', `Deals/${arDealId}`, env, {
                data: [{
                  Meraki_ISR: { id: finalRepId },
                  Reason: 'Meraki ISR recommended',
                }],
              });
              const updateRecord = updateResp?.data?.[0];
              const success = updateRecord?.code === 'SUCCESS';
              const zohoError = !success ? (updateRecord?.message || updateRecord?.code || JSON.stringify(updateRecord || updateResp).substring(0, 200)) : '';
              console.log(`[ASSIGN-REP] dealId=${arDealId} repId=${finalRepId} repName=${finalRepName} success=${success} zohoError=${zohoError}`);
              apiResult = {
                success,
                dealId: arDealId,
                repId: finalRepId,
                repName: finalRepName,
                message: success ? `Assigned ${finalRepName} to deal` : zohoError || 'Update failed',
                error: success ? undefined : (zohoError || 'Update failed'),
              };
            } catch (err) {
              apiResult = { success: false, error: 'Rep assignment failed: ' + err.message };
            }
            break;
          }

          // ── CRM Notes: Get recent notes for a contact/account ──
          case '/api/crm-notes': {
            const { contactId: notesContactId, accountId: notesAcctId } = apiBody;
            if (!notesContactId && !notesAcctId) {
              return new Response(JSON.stringify({ error: 'contactId or accountId required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              let notes = [];
              const parentModule = notesContactId ? 'Contacts' : 'Accounts';
              const parentId = notesContactId || notesAcctId;

              const noteResp = await zohoApiCall('GET',
                `${parentModule}/${parentId}/Notes?fields=id,Note_Title,Note_Content,Created_Time,Owner&per_page=10`, env
              );
              if (noteResp?.data) {
                notes = noteResp.data.map(n => ({
                  id: n.id,
                  title: n.Note_Title || '',
                  content: n.Note_Content ? n.Note_Content.substring(0, 500) : '',
                  createdTime: n.Created_Time ? n.Created_Time.split('T')[0] : '',
                  ownerName: n.Owner?.name || '',
                }));
              }

              apiResult = { notes };
            } catch (err) {
              apiResult = { error: 'Notes lookup failed: ' + err.message, notes: [] };
            }
            break;
          }

          // ── CRM Add Note: Create a note on a contact/account ──
          case '/api/crm-add-note': {
            const { parentModule: noteParent, parentId: noteParentId, title: noteTitle, content: noteContent } = apiBody;
            if (!noteParentId || !noteContent) {
              return new Response(JSON.stringify({ error: 'parentId and content required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              const mod = noteParent || 'Contacts';
              const noteResp = await zohoApiCall('POST', `${mod}/${noteParentId}/Notes`, env, {
                data: [{
                  Note_Title: noteTitle || '',
                  Note_Content: noteContent,
                }]
              });
              const parsed = parseZohoResponse(noteResp, 'Note creation');
              apiResult = { success: parsed.success, noteId: parsed.record_id || null, message: parsed.message };
            } catch (err) {
              apiResult = { error: 'Note creation failed: ' + err.message, success: false };
            }
            break;
          }

          // ── CRM Add Contact: Create a new contact, optionally linked to an account ──
          case '/api/crm-add-contact': {
            const {
              firstName: newCtFirst, lastName: newCtLast, email: newCtEmail,
              phone: newCtPhone, title: newCtTitle, accountId: newCtAcctId,
              mobile: newCtMobile
            } = apiBody;
            if (!newCtLast && !newCtEmail) {
              return new Response(JSON.stringify({ error: 'lastName or email required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              // Check for duplicate by email first
              if (newCtEmail) {
                const dupeCheck = await zohoApiCall('GET',
                  `Contacts/search?email=${encodeURIComponent(newCtEmail)}&fields=id,Full_Name,Email`, env
                );
                if (dupeCheck?.data?.[0]) {
                  const existing = dupeCheck.data[0];
                  apiResult = {
                    success: false,
                    duplicate: true,
                    existingContact: {
                      id: existing.id,
                      name: existing.Full_Name || '',
                      email: existing.Email || '',
                      zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Contacts/${existing.id}`,
                    },
                    message: `Contact already exists: ${existing.Full_Name || existing.Email}`
                  };
                  break;
                }
              }

              const contactPayload = {
                data: [{
                  First_Name: newCtFirst || '',
                  Last_Name: newCtLast || newCtEmail.split('@')[0] || 'Unknown',
                  Email: newCtEmail || '',
                  Phone: newCtPhone || '',
                  Mobile: newCtMobile || '',
                  Title: newCtTitle || '',
                  Owner: { id: '2570562000141711002' }, // Chris Graves
                }]
              };
              if (newCtAcctId) {
                contactPayload.data[0].Account_Name = { id: newCtAcctId };
              }

              const createResp = await zohoApiCall('POST', 'Contacts', env, contactPayload);
              const parsed = parseZohoResponse(createResp, 'Contact creation');
              if (parsed.success) {
                apiResult = {
                  success: true,
                  contactId: parsed.record_id,
                  zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Contacts/${parsed.record_id}`,
                  message: `Contact created: ${newCtFirst || ''} ${newCtLast || ''}`.trim()
                };
              } else {
                apiResult = { success: false, error: parsed.message || 'Contact creation failed' };
              }
            } catch (err) {
              apiResult = { error: 'Contact creation failed: ' + err.message, success: false };
            }
            break;
          }

          // ── Detect Account: Extract company info from email signature + domain lookup ──
          case '/api/detect-account': {
            const { emailBody: detectBody, senderDomain: detectDomain, senderEmail: detectEmail, senderName: detectSenderName } = apiBody;
            if (!detectDomain && !detectBody) {
              return new Response(JSON.stringify({ error: 'emailBody or senderDomain required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              const accountSuggestion = { name: '', street: '', city: '', state: '', zip: '', website: '', phone: '', confidence: 'none', source: '' };

              // ─── Phase 1: Parse email signature ───
              // Look for a signature block in the last ~2000 chars of the email body
              const sigBlock = (detectBody || '').slice(-2000);

              // Company name patterns (after common name lines, before address)
              // Try to find structured signature with pipes, dashes, or line breaks
              const sigPatterns = {
                // Phone: various formats
                phone: sigBlock.match(/(?:(?:phone|tel|office|direct|cell|mobile|ph?)[\s.:]*)?(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/i),
                // Address: street number + street name + optional suite
                address: sigBlock.match(/(\d{1,6}\s+(?:[A-Z][a-z]+\.?\s*){1,4}(?:St(?:reet)?|Ave(?:nue)?|Blvd|Boulevard|Dr(?:ive)?|Rd|Road|Ln|Lane|Way|Ct|Court|Pkwy|Parkway|Pl|Place|Cir|Circle|Hwy|Highway|Ter(?:race)?|Loop|Trail|Pike|Run|Path)[.,]?\s*(?:(?:Ste|Suite|Apt|Unit|Bldg|Building|Floor|Fl|#)\s*[\w-]+)?)/i),
                // City, State ZIP
                cityStateZip: sigBlock.match(/([A-Z][a-z]+(?:\s[A-Z][a-z]+)*),?\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)/),
                // Website
                website: sigBlock.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|net|org|edu|gov|io|co|us|biz|info)(?:\.[a-z]{2})?)/i),
              };

              // Extract phone
              if (sigPatterns.phone) {
                accountSuggestion.phone = sigPatterns.phone[0].replace(/^(?:phone|tel|office|direct|cell|mobile|ph?)[\s.:]*/i, '').trim();
              }

              // Extract address
              if (sigPatterns.address) {
                accountSuggestion.street = sigPatterns.address[1].trim();
              }

              // Extract city/state/zip
              if (sigPatterns.cityStateZip) {
                accountSuggestion.city = sigPatterns.cityStateZip[1].trim();
                accountSuggestion.state = sigPatterns.cityStateZip[2].trim();
                accountSuggestion.zip = sigPatterns.cityStateZip[3].trim();
              }

              // Extract website from signature or fall back to domain
              if (sigPatterns.website) {
                accountSuggestion.website = sigPatterns.website[0].replace(/^https?:\/\//, '').replace(/^www\./, '');
              } else if (detectDomain) {
                accountSuggestion.website = detectDomain;
              }

              // ─── Phase 2: Use Claude to extract company name from signature ───
              // Claude is better at identifying the company name from unstructured signature text
              // Also does a web search if signature parsing got nothing useful
              const hasAddressInfo = accountSuggestion.street || accountSuggestion.city;
              const sigLast500 = (detectBody || '').slice(-1500);
              const needsWebLookup = !hasAddressInfo && detectDomain;

              const claudePrompt = needsWebLookup
                ? `Extract the company/organization name and mailing address for the domain "${detectDomain}".

First check this email signature for clues:
---
${sigLast500}
---

If the signature doesn't have enough info, search the web for "${detectDomain}" to find the company name and address.

The sender's name is: ${detectSenderName || 'unknown'}
The sender's email is: ${detectEmail || 'unknown'}

Return ONLY a JSON object (no markdown, no explanation):
{"name": "Company Name", "street": "123 Main St", "city": "City", "state": "XX", "zip": "12345", "phone": "555-555-5555", "website": "${detectDomain || ''}", "confidence": "high|medium|low"}`
                : `Extract the company/organization name from this email signature. The sender is ${detectSenderName || 'unknown'} at ${detectEmail || detectDomain || 'unknown domain'}.

Signature block:
---
${sigLast500}
---

Return ONLY a JSON object (no markdown, no explanation):
{"name": "Company Name", "confidence": "high|medium|low"}`;

              // Use Claude with web search tool if we need a lookup
              const claudeMessages = [{ role: 'user', content: claudePrompt }];
              const claudeTools = needsWebLookup ? [{
                type: 'web_search_20250305',
                name: 'web_search',
                max_uses: 3,
              }] : undefined;

              const claudeBody = {
                model: 'claude-haiku-4-5-20251001',
                max_tokens: 500,
                messages: claudeMessages,
              };
              if (claudeTools) claudeBody.tools = claudeTools;

              const claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'x-api-key': env.ANTHROPIC_API_KEY,
                  'anthropic-version': '2023-06-01',
                },
                body: JSON.stringify(claudeBody),
              });

              if (claudeResp.ok) {
                const claudeData = await claudeResp.json();
                // Extract text content from response (may have multiple content blocks with web search)
                let textContent = '';
                for (const block of (claudeData.content || [])) {
                  if (block.type === 'text') textContent += block.text;
                }

                // Parse JSON from Claude's response
                const jsonMatch = textContent.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                  try {
                    const parsed = JSON.parse(jsonMatch[0]);
                    if (parsed.name) accountSuggestion.name = parsed.name;
                    if (parsed.street && !accountSuggestion.street) accountSuggestion.street = parsed.street;
                    if (parsed.city && !accountSuggestion.city) accountSuggestion.city = parsed.city;
                    if (parsed.state && !accountSuggestion.state) accountSuggestion.state = parsed.state;
                    if (parsed.zip && !accountSuggestion.zip) accountSuggestion.zip = parsed.zip;
                    if (parsed.phone && !accountSuggestion.phone) accountSuggestion.phone = parsed.phone;
                    if (parsed.website && !accountSuggestion.website) accountSuggestion.website = parsed.website;
                    if (parsed.confidence) accountSuggestion.confidence = parsed.confidence;
                    accountSuggestion.source = needsWebLookup ? 'web_search' : 'signature';
                  } catch (_) { /* JSON parse failed, keep regex results */ }
                }
              }

              // ─── Phase 3: Check if account already exists in Zoho ───
              let existingAccount = null;
              if (accountSuggestion.name) {
                try {
                  const acctSearch = await zohoApiCall('GET',
                    `Accounts/search?criteria=(Account_Name:equals:${encodeURIComponent(accountSuggestion.name)})&fields=id,Account_Name,Billing_Street,Billing_City,Billing_State,Billing_Code,Website`, env
                  );
                  if (acctSearch?.data?.[0]) {
                    existingAccount = {
                      id: acctSearch.data[0].id,
                      name: acctSearch.data[0].Account_Name,
                      street: acctSearch.data[0].Billing_Street || '',
                      city: acctSearch.data[0].Billing_City || '',
                      state: acctSearch.data[0].Billing_State || '',
                      zip: acctSearch.data[0].Billing_Code || '',
                      website: acctSearch.data[0].Website || '',
                      zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${acctSearch.data[0].id}`,
                    };
                  }
                } catch (_) { /* search failed, continue with suggestion */ }

                // Also try domain-based search if exact name didn't match
                if (!existingAccount && detectDomain) {
                  try {
                    const domainSearch = await zohoApiCall('GET',
                      `Accounts/search?criteria=(Website:contains:${encodeURIComponent(detectDomain)})&fields=id,Account_Name,Billing_Street,Billing_City,Billing_State,Billing_Code,Website`, env
                    );
                    if (domainSearch?.data?.[0]) {
                      existingAccount = {
                        id: domainSearch.data[0].id,
                        name: domainSearch.data[0].Account_Name,
                        street: domainSearch.data[0].Billing_Street || '',
                        city: domainSearch.data[0].Billing_City || '',
                        state: domainSearch.data[0].Billing_State || '',
                        zip: domainSearch.data[0].Billing_Code || '',
                        website: domainSearch.data[0].Website || '',
                        zohoUrl: `https://crm.zoho.com/crm/org647122552/tab/Accounts/${domainSearch.data[0].id}`,
                      };
                    }
                  } catch (_) { /* domain search failed */ }
                }
              }

              apiResult = {
                suggestion: accountSuggestion,
                existingAccount: existingAccount,
                domain: detectDomain || '',
              };
            } catch (err) {
              console.error('[detect-account] Error:', err);
              apiResult = { error: 'Account detection failed: ' + err.message, suggestion: null };
            }
            break;
          }

          // ── CRM Create Task: Create a new task ──
          case '/api/crm-create-task': {
            const { subject: newTaskSubject, dueDate: newTaskDue, dealId: newTaskDeal, contactId: newTaskContact, priority: newTaskPriority, description: newTaskDesc } = apiBody;
            if (!newTaskSubject) {
              return new Response(JSON.stringify({ error: 'subject required' }), { status: 400, headers: jsonHeaders });
            }

            try {
              function createTaskBizDays(startDate, days) {
                let d = new Date(startDate);
                let added = 0;
                while (added < days) {
                  d.setDate(d.getDate() + 1);
                  if (d.getDay() !== 0 && d.getDay() !== 6) added++;
                }
                return d.toISOString().split('T')[0];
              }

              const taskPayload = {
                data: [{
                  Subject: newTaskSubject,
                  Status: 'Not Started',
                  Due_Date: newTaskDue || createTaskBizDays(new Date(), 3),
                  Priority: newTaskPriority || 'Normal',
                  Owner: '2570562000141711002', // Chris Graves
                }]
              };
              if (newTaskDeal) {
                taskPayload.data[0].What_Id = newTaskDeal;
                taskPayload.data[0].$se_module = 'Deals';
              }
              if (newTaskContact) {
                taskPayload.data[0].Who_Id = newTaskContact;
              }
              if (newTaskDesc) {
                taskPayload.data[0].Description = newTaskDesc;
              }

              const createResp = await zohoApiCall('POST', 'Tasks', env, taskPayload);
              const parsed = parseZohoResponse(createResp, 'Task creation');
              apiResult = {
                success: parsed.success,
                taskId: parsed.record_id || null,
                message: parsed.message,
                zohoUrl: parsed.record_id ? `https://crm.zoho.com/crm/org647122552/tab/Tasks/${parsed.record_id}` : null,
              };
            } catch (err) {
              apiResult = { error: 'Task creation failed: ' + err.message, success: false };
            }
            break;
          }

          default:
            return new Response(JSON.stringify({ error: 'Unknown endpoint: ' + url.pathname }), {
              status: 404, headers: jsonHeaders
            });
        }

        return new Response(JSON.stringify(apiResult), { headers: jsonHeaders });
      } catch (apiErr) {
        console.error(`[API] Error on ${url.pathname}: ${apiErr.message}`);
        return new Response(JSON.stringify({ error: apiErr.message }), {
          status: 500, headers: jsonHeaders
        });
      }
    }

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
        const { text, personId, spaceName, threadName, imageData } = state;
        console.log(`[GCHAT-WORK] Starting CRM work for: "${text.substring(0, 80)}..." spaceName="${spaceName}"`);

        // Diagnostic: store spaceName for debugging delivery failures
        try { await kv.put(`debug_work_${Date.now()}`, JSON.stringify({ spaceName, threadName, personId: personId?.substring(0, 30), ts: new Date().toISOString() }), { expirationTtl: 3600 }); } catch (_) {}

        // Send initial "Working on it..." message and record messageName for dot-cycling.
        // Progress callback patches this message with dots on each tool-call iteration
        // (no setInterval needed — natural heartbeat from Claude's agentic loop).
        let _progressMsgName = null;
        let _dotIdx = 0;
        try {
          // Always send top-level (null threadName) so the progress message is visible
          // at the root of the DM, not hidden inside a collapsed thread.
          const thinkingMsg = await sendAsyncGChatMessage(spaceName, '⏳ Working on it...', null, env);
          _progressMsgName = thinkingMsg?.name || null;
        } catch (initSendErr) {
          // Store the initial send failure for diagnostics
          try { await kv.put(`debug_init_send_err_${Date.now()}`, JSON.stringify({ spaceName, error: initSendErr.message?.substring(0, 300), ts: new Date().toISOString() }), { expirationTtl: 3600 }); } catch (_) {}
          /* proceed without progress message */
        }

        // Progress callback: show real-time step updates (tool calls, thinking)
        // so the user can see exactly what the CRM agent is doing, similar to
        // watching Claude's tool-use steps in the Claude UI.
        let _stepLog = [];  // accumulate step descriptions
        const progressCallback = _progressMsgName
          ? async (msg) => {
              // msg comes from toolProgressMessage() — e.g. "🔍 Searching Zoho Accounts..."
              // Build a running log of steps so the user sees the full workflow
              if (msg) {
                // Extract just the tool-progress lines (emoji-prefixed), skip interim text
                const lines = msg.split('\n').filter(l => /^[🔍📄🔗✏️📦🌐📧✍️📤⚙️]/.test(l.trim()));
                for (const line of lines) {
                  const trimmed = line.trim();
                  // Avoid duplicate consecutive steps
                  if (_stepLog.length === 0 || _stepLog[_stepLog.length - 1] !== trimmed) {
                    _stepLog.push(trimmed);
                  }
                }
              }
              // Show the last 5 steps to keep the message concise
              const recentSteps = _stepLog.slice(-5);
              const display = recentSteps.length > 0
                ? `⏳ *Working on it...*\n\n${recentSteps.join('\n')}`
                : '⏳ Working on it...';
              try { await updateGChatMessage(_progressMsgName, display, env); } catch (_) {}
            }
          : async (msg) => {
              // Fallback: no messageName, send new messages for each step
              const formatted = adaptMarkdownForGChat(msg);
              await sendAsyncGChatMessage(spaceName, formatted, null, env);
            };

        try {
          // 5-minute safety-net deadline (unlimited wall time available in /_work)
          let result = await askClaude(text, personId, env, imageData || null, true, progressCallback, 300000);
          console.log(`[GCHAT-WORK] askClaude completed in ${Date.now() - _workStart}ms`);

          // Handle continuation (safety net for 5-min deadline)
          if (result && result.__continuation) {
            console.log(`[GCHAT-WORK] Continuation needed at iteration ${result.iteration}, chaining to /_continue`);
            const contToken = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            await kv.put(`cont_${contToken}`, JSON.stringify({
              ...result,
              spaceName,
              threadName: threadName || null,
              personId,
              originalText: text,
              progressMsgName: _progressMsgName,
              stepLog: _stepLog,
              segment: 1
            }), { expirationTtl: 300 });
            // Chain via Service Binding — unlimited wall time
            await env.SELF.fetch(new Request('https://self/_continue', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ token: contToken })
            }));
          } else {
            // Normal completion — PATCH the final reply onto the "Working on it..."
            // placeholder. In Google Chat DMs, async REST API messages get auto-
            // threaded under the user's message, making them invisible at the top
            // level. Since the placeholder is already visible (even if threaded),
            // updating it in-place ensures the user sees the real response.
            // Falls back to a new top-level message if PATCH fails.
            let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
            finalReply = adaptMarkdownForGChat(finalReply);
            finalReply = truncateGChatReply(finalReply);

            let delivered = false;
            if (_progressMsgName) {
              try {
                delivered = await updateGChatMessage(_progressMsgName, finalReply, env);
                if (delivered) {
                  console.log(`[GCHAT-WORK] Final response PATCH'd onto ${_progressMsgName} (${finalReply.length} chars)`);
                }
              } catch (patchErr) {
                console.warn(`[GCHAT-WORK] PATCH failed: ${patchErr.message} — falling back to new message`);
              }
            }

            // Fallback: if no placeholder existed or PATCH failed, send a new message
            if (!delivered) {
              console.log(`[GCHAT-WORK] Sending final response as new top-level message (PATCH ${_progressMsgName ? 'failed' : 'n/a'})`);
              await sendAsyncGChatMessage(spaceName, finalReply, null, env);
            }
            if (personId) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', finalReply);
              await kv.put(`crm_session_${personId}`, 'active', { expirationTtl: 600 });
            }
          }
          console.log(`[GCHAT-WORK] Completed in ${Date.now() - _workStart}ms total`);
        } catch (err) {
          console.error(`[GCHAT-WORK] Error: ${err.message}`);
          const errMsg = `❌ Sorry, I ran into an issue processing that request.\n\n_Error: ${err.message.substring(0, 200)}_`;
          try {
            if (_progressMsgName) {
              await updateGChatMessage(_progressMsgName, errMsg, env);
            } else {
              await sendAsyncGChatMessage(spaceName, errMsg, null, env);
            }
          } catch (_) {}
          try {
            await kv.put(`work_error_${Date.now()}`, JSON.stringify({
              error: err.message,
              stack: (err.stack || '').substring(0, 500),
              ts: new Date().toISOString(),
              elapsed: Date.now() - _workStart
            }), { expirationTtl: 3600 });
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

        const _contProgressMsgName = state.progressMsgName || null;
        let _contStepLog = state.stepLog || [];
        const progressCallback = _contProgressMsgName
          ? async (msg) => {
              if (msg) {
                const lines = msg.split('\n').filter(l => /^[🔍📄🔗✏️📦🌐📧✍️📤⚙️]/.test(l.trim()));
                for (const line of lines) {
                  const trimmed = line.trim();
                  if (_contStepLog.length === 0 || _contStepLog[_contStepLog.length - 1] !== trimmed) {
                    _contStepLog.push(trimmed);
                  }
                }
              }
              const recentSteps = _contStepLog.slice(-5);
              const display = recentSteps.length > 0
                ? `⏳ *Working on it...*\n\n${recentSteps.join('\n')}`
                : '⏳ Working on it...';
              try { await updateGChatMessage(_contProgressMsgName, display, env); } catch (_) {}
            }
          : async (msg) => {
              const formatted = adaptMarkdownForGChat(msg);
              await sendAsyncGChatMessage(state.spaceName, formatted, state.threadName || null, env);
            };

        try {
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
              threadName: state.threadName || null,
              personId: state.personId,
              originalText: state.originalText,
              progressMsgName: _contProgressMsgName,
              stepLog: _contStepLog,
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
            // Final response — update progress message or send new
            let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
            finalReply = adaptMarkdownForGChat(finalReply);
            finalReply = truncateGChatReply(finalReply);
            let contDelivered = false;
            if (_contProgressMsgName) {
              try {
                contDelivered = await updateGChatMessage(_contProgressMsgName, finalReply, env);
              } catch (_) {}
            }
            if (!contDelivered) {
              await sendAsyncGChatMessage(state.spaceName, finalReply, null, env);
            }
            if (state.personId) {
              await addToHistory(kv, state.personId, 'user', state.originalText || '');
              await addToHistory(kv, state.personId, 'assistant', finalReply);
              await kv.put(`crm_session_${state.personId}`, 'active', { expirationTtl: 600 });
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

    // Static icon for Gmail Add-on
    if (request.method === 'GET' && url.pathname === '/icon.png') {
      const iconBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAAWOUlEQVR4nO3deXAc1Z0H8O8ckkbH6LJGpyVbki1LtrFkY2RsiHFswMSL7UAWEkggx+YoNskSYrIJm82mqMSwRyg2ZLNLNmyyKaCcBKhsIDYB7BgQsZFv2Ua2ZZ2WrGt0z0ij0RzaPxSfWNJI093vdff3U8U/FMl7ev1+3/l1T083QEREREREREREREREREREREZhET0BUkfuth3jSv9/tj91H/eLwfCA6pQaBR4tBoT+8IBJTsZCnykGg7x4YCRjhIKfDgNBHjwQgpmh4KfDQBCHCy8Ai35yDANtcbE1wqKfOYaB+rjAKmLRK4dhoA4uqsJY9OpjGCiHC6kQFr72GATR4wJGgUUvD4bB7HDRZoGFLy8GwcxwsWaAha8fDILIcJEiwMLXLwbB1Lg4U2DhGweD4NqsoicgKxa/sfB4XhtT8SrcKMbHbuASLsRfsPDNh0HAAGDhk6mDwNTXAFj8BJh7H5gy+cx8wGlqZusGTNcBsPhpKmbbH6YKALMdXJodM+0TU7Q7ZjqgpCyjnxIYvgNg8VM0jL5/DB0ARj94pA0j7yNDtjdGPmAkltFOCQzXAbD4SU1G21+GCgCjHRySk5H2mWECwEgHheRnlP1miAAwysEgfTHCvtP1BQ0jHAAyBr1eHNRtB8DiJ5nodT/qMgD0uthkbHrcl7oLAD0uMpmH3vanrgJAb4tL5qSnfaqbANDTohLpZb/qIgD0sphEl9PDvpU+APSwiESTkX3/Sh0Asi8eUSRk3sdSBwARqUvaAJA5NYlmStb9LGUAyLpYRNGQcV9LFwAyLhKRUmTb31IFgGyLQ6QGmfa5NAEg06IQqU2W/S5NABCR9qQIAFnSkEhLMux74QEgwyIQiSJ6/wsNANF/PJEMRNaB8A6AiMQR9hwzfvorw2qxID89ESVZKZifkQSX04FMpwMZSQ64nA44HTFwxNgQa7ci1mZDXIwNVgsQDI0jGA4jGAojEBqHLxCE1x+EdzQArz+AYX8QfcN+uD2j6PH60eMdRY9nFB2DI2gf9CEYCov+0w1HxHMFhQQAi3/2CjOcWF2ciVWFLizOTUVxphNxdpumcwiPj6NryIe2/hGc7x9GU48XDd1DaHB70Ogegtcf1HQ+RqJ1CGgeACz+mYmz27ChLAebluXjpuJMZCbHi57StDoHfTjTNYja9gHUtvejtmMQ9d1D7BoipGUI2LUaiCJnsQC3lOTg7hXzsHHpXCTF6eswZafEIzslHreUZF/8d4FQGKc6BnDsXB+OnOvF0XO9aHAPYZwfB0Jp2gHw039qsXYrPrFiPr58SylKspJFT0d1ntEAjp7rRXWTG9WNbhxp6YU/GBI9LSlo1QVoFgAs/snZrBY8uHoBHr51CVxOh+jpCDMWDONYay9217bjp3tPiZ6OcFqEgL56SwNaXZyJH358BUpzUkVPRbhYuxWVhS5kJcczADSiyX0A/PT/sMQ4O/79U6vw8kPrWfx0TVrUDTsAAcpyUvGzB29Cscspeipkcqp3APz0v9LdK+Zh58O3sfgpImrXDzsADX12zUJsv+t6WHT5HlkyIlU7AH76X/K19WV44m4WP82cmnWkWgCw+C/5zI3FeGxTuehpkI6pVU/8NaDKVhdnYvtd14ueBtE1qRIA/PSfUJCeiOc+ezPsNuYsRU+NuuLOVNGP7q1EakKs6GkQTUrxAOCn/4T7VxXjpgVZoqdBBqN0fbEDUIHL6cD37uRFP5KfogHAT/8JD60rRXI8W39Sh5J1xg5AYemJcXhg9QLR0yCKiGIBwE//CV9auwgJsbzBktSlVL1xpyrIZrXg/lVFoqdx0WgghONtfajrGkJ99xDaB0bQOejDwIgfntEAhseCCITCCIbGYbNa4IixIT7GBkeMDakJcchKjkdWsgNZyfHIS0tESVYyFmQmw+mIEf2nkUIYAApaW5KNjCSxD/RocHuws6YVb9aex4m2PgTDkX1QhEPjCITC8IwGAADn+oYn/W+zU+KxKCsFFQVzsHLeHCyfNwdpCXGKzJ+0pUgAsP2f8PHl84SNva++G0/vPol99d2qj9U56EPnoA/v1HVe/HdFLidWFbqwblEOPlKShRReBFVd7rYd49E+NYgdgEJsVgs2LsnTfNxerx/feeUgdp1o03zsyzW6PWh0e7DjQCNsVgvK89OxblEOPrZ0LhbnpgqdG00u6t+m8dN/Qnl+OnY9fLumYza6Pbj/52+jdYp2XQaFGU5sLs/HneX5WJKbNu1/39LrxZon/6DBzIwhmi6AHYBCKue7NB3P7RnFff/9Ntr65S5+AGjq8eCZPbV4Zk8tilxOfKqyCPdcP18X7zgwOt4HoJAbCjM0He+xVw7poviv1uj24ImdNVj5w1fxuV9U4Y0Pzkd8oZKUF1UAsP2/ZGne9K2tUo609OL1k2LP+aMVCo/jrdrz+MIvq3Dj9tfw072nMDAyJnpauhRNHfIUQAE2qwV5aYmajff8+/WajaWFjsERPLGzBk+/eRJ/vbIQG8pyRE/JNBgACshLTYDdqt2zvvae7tBsLC35AiE8v78ez+83VsDJbNanAGz/LymYk6TZWN2eUbg9o5qNR/ow23rkRUAFZGr4Oq/OwRHNxiLjYwAoQMsf//iDfMU2KWdWAcD2/0rxGgZAGh8xRpOYTV2yA1BAfKxNs7GyePMMKYgBoIBYm3YB4HTERHQ7LVEkZhwAbP8/zB8IaTreneX5mo5H+jHT+mQHoIBRjQPg8zct5H30pAgGgAJ8gaCm4zkdMfiXT6yETcObj8iYGAAKEHFjzu1L8vCT+1dregciGc+MAoDn/9fW1i/m5pytFQV46aH1KHI5hYxPcppJnbIDUIDIn+VWFrqw99GP4cm7V6IgXbsfJJEx8MdAChj0jcHtGYVLw1uCL2e3WfHgmgX4zOpivH2mEy8dasLu2naMjGl7bYL0hwGgkONtfdhQlit0DlaLBetLc7C+NAe+QAhVdZ3Yc7oD753tRHOPV+jcSE4RX0Hi+f/Uvnn7Umy7fanoaUyqY3AEB5t6cLilB0fP9eGD9n7Nv74kbUXyrEB2AArZV98ldQDkpCRgS0UBtlQUAACC4XHUdQ6ipq0Px1r7cLy1D7UdAwiG+GMjM2EAKORgcw/6hv1IT9THCzLsVgsW56ZicW4q7quceJvRWDCM2o4B1LT2oqa1DzWtfTjbPYQQn9lnWAwAhYTC49hd2457bygUPZVZi7VbUZGfjor89Iv/zhcI4URbH4609OJwSw8OtfSie8gncJakJAaAgn57qEnXAXAt8TE2VBa6UFl46bHnbf3DONjcg3frOlFV14UOPqREtxgACtrf0I3TnYMozU4RPRVVzU1LxNy0RNz1l1ehne0awrtnO/HHk22obnTzlEFHIvoWgN8ARO7Tq4rxr/fcIHoawvQN+/HHk23YebwNVWc7GQaCTfdNAANAYXarBXu/tYm352Liq8ffHGjCrw82Sv/6MqOaLgB4K7DCguFxbN9ZI3oaUshJScA3bluC/Y9txvN/s/aK6wgkBwaACv54sg27a9tFT0MaFguwviwXv/vqBvzuqxvw0VK++EMWDACVbPvtAfR4+fz+q1UWuvDCF2/Bji+vwyKDXyzVAwaASnq8o3h4RzUvgk1ibUk23vrmHXh86wo4YrR7piJdiQGgorfPdOAffndY9DSkZbNa8MWPlOCNRzZi2dz06f8HpDgGgMpe2F+Pp9/6QPQ0pLYgMxmvff1WPLhmgeipmM60XwPyK0BlPLSuFP94Z4XoaUjvZ++cxg/+cAzj3HWKmeqrQHYAGvmvt0/jkd9UY4yv9prSV24pxVP3rhI9DdNgAGjotwebsOUnb6Gllw/nmMonbyhkt6QRBoDGTpzvx8an38BLh5pET0VqD60rxWdW85qA2hgAAnhGA/jGr6txz7N/QoPbI3o60np8y3LeK6AyBoBA++q7seFHr+P7vz8i5N0CsnPE2PDTT/PdB2piAAgWCIXxXFUdVj/xGrbvrGEQXKUsJ5WnAipiAEjCFwjhP/eewg0/fBUP73gfx1r7RE9JGttuXwqnI0b0NAyJASCZQCiMlw83469+/CY2/fhNPFdVZ/quID0xDp+/eaHoaRgSbwTSAZvVgpsXZGHTsnxsKMtBTkqC6ClprnPQh1XbX0WQv62YsaluBOIjwXQgFB7HO3WdeKeuEwCwODcVt5bl4uaFWVgxLwPxJvgxTXZKPDYunYudx1tFT8VQGAA6VNs+gNr2ATyzpxZ2mxXX5aVhVZELN8zPwMr5GchIEvOKMrVtrShgACiMAaBzwVAYR8/14ui5Xjz7l383PyMJK+dNhMHK+RlYlJ0Cq0X/X6WtW5SDWLuVt1MriAFgQM09XjT3ePHy4WYAQFKcHcsL5lwMhBUFc5AcHyt2krOQGGfHmuIsvH2mQ/RUDIMBYAJefxBVZ7tQdbYLwMQjuhZmJqOyKBOrCl24sciF3FR9XFisLMxgACiIAWBC4+NAXdcQ6rqG8ML+egBAscuJtSXZuG1JHtYUZyLGJuc3xHxwiLIYAAQAaHB70OD24Jd/PoukODvuuG4u7lo+D2tLsqW6fsAAUBYDgD7E6w/i5UPNePlQMwrSE/H5m0rwwJoFUnzdOCcpDinxsRj0jYmeiiHI2eeRNM71DePx145i1fZX8WJ1gxRP6tHL9Qo9YABQRHq9fvz9SwfxwP+8A68/KHQueWkMAKUwAGhG9p7uwOd+8S5GAyFhc8h0xgsb22imDYDp3i1G5rO/oRvffuWgsPFluBahF3w3IKnilcPNOHquV8jYfJGIchgANCvj48CPd9cKGZsBoBwGAM1a1dlOIdcCQjJ8FWEQDACatdFACAea3JqP6xsTdwHSaBgAFJX2gRHNx/QFxH4NaSQMAIpKj9ev+ZjsAJTDAKCoiPg0HhljB6CUiAKA9wJM74sfKcEjty0x3dNrkwX8vecFnHboUSR1yw5AISnxsXh043Wo/u5m/N2ti5EUZ47fWRW5nJqP2dY3rPmYRsUAUFhKfCy+fccyvP/dzfj6emMHgdViwYqCDE3HHA2E0OM192PSlcQAUElaQhy+s2kZDn1vK76/eTnmpiWKnpLi1izIxJykOE3HbOvnp7+SGAAqczpi8OVbFmHfY3fi2QfWYHnBHNFTUsxXP1qm+Zi17QOaj2lkxu1PJWOzWrC5vACbywtwpKUXL1Y34LWacxgW/NPa2dpSUYC1Jdmaj3ukRczvD4wq4g6A3wQoZ8W8OXjq3koc/aeP40f3VuL6edqeR0drcW4q/u2eSiFjH2rpETKu3kRar+wABEqMs+O+yiLcV1mEs11D+P2xFrx+og2nOwdFT21SK+dn4FdfWCvk4uZYMIyT5/s1H9fIGACSWJiVjEc3XodHN16HRrcHu060YdeJVtRI8pZgu82Kv11Xim23L4Vd0BOD36vvQiDEl4IoiQEgoSKXE19bX4avrS+D2zOKfQ3d2FffhT/Xd6Opx6PpXOw2K7ZWFOCR25agMEP77/wv91rNOaHjG9GMAqD9qfssfFuwtlxOB7ZWFGBrRQEAoGNwBAeaevDB+X580D6A2vZ+dCv8+vAYmxUrCuZg07J8bKkoQKZT/LsGg6Ew3jh5XvQ0dGEm1+vYAehMTkrCFYEAAG7PKOq6BtHWP4L2gUv/dHt8GBkLwjcWgi8Qgm8siGA4DLvViji7FU5HLFITYpGTEo+8tEQszErGktw0lOenS/fYrXfqOvkocBUwAAzA5XTAJcGntJp+/u4Z0VMwJN4IRNI73tZ38b2GpKwZBwDvByCt/cefTomegm7MtD7ZAZDUjrX24fUTbaKnYVgMAJJWMDyOb710AGE+BFQ1swoAngaQFn7+7hn++GcGZlOX7ABISqc6BvDUGydET8PwGAAknV6vH5/7RRV8At8/aBazDgCeBpAagqEwvvSr9/jgjxmabT2yAyBpjAXD+Mrz+1At4GUjZsU7AUkKw/4gvvC/VXiPN/xoKqoOgKcBpITuIR8++bO9LP5ZiqYO2QEohN9Uz86fTrXjG7+pRq+ANwwRA0Axz+ypxbHWPmwpz8fGJXlIjo8VPSWpjQZCeHJXDZ6rqhM9FVNTpIXnMwKuFGOzYm1JNraUF+C2JblIYRhcND4OvHKkGf+86zg6BvmGn2hFexrODkAFgVAYe061Y8+pdtisFqycl4H1Zbm4tSwHpTmpoqcnzLt1nXhy13Ecb5PjMWekUAcAsAuIVE5KAtaX5uDmhVm4sciFzOR40VNS1chYEK8cbsYv/3wWZyR+2KkeKXERnh2AxjoGR/BidQNerG4AMPH8vzXFmbixOBOVhS7kpSYInmH0gqEw9jV0Y9eJNvzf0RZ4RgOip0STYAAI1uj2oNHtwQvvTwRCRpIDy/LTUT534tFc5XPTddEldA35cKDJjd217Xizth1DfHyXLij6PT5PA9SRlhCHhVnJWJiZjIVZySjOTEaxy4nc1ATECHhEd493FA1uDz4434/DLb041NzDW3c1ptQ9OOwAdKB/xI8DTW4cuOoWWYsFcCU5kJuagLy0ROSmJCDD6UBqQixS4yce+JmaEIvk+Fg47FbE2K2wW62ItVsvBkcgFMZYcOKfQCgMfzCEQd8Yer1+9A770esdRa/Xj47BETS6PWhwe9jSG4jid/KxCyBSl5J34PLHQEQmpngA8PcBROpRur7YARCZmCoBwC6ASHlq1BU7ACITUy0A2AUQKUetelK1A2AIEEVPzTriKQCRiakeAOwCiGZP7fphB0BkYpoEALsAopnTom7YARCZmGYBwC6AKHJa1YumHQBDgGh6WtYJTwGITEzzAGAXQDQ5retDSAfAECD6MBF1IewUgCFAdImoeuA1ACITExoA7AKIxNaB8A6AIUBmJnr/Cw8AQPwiEIkgw76XIgCISAxpAkCGNCTSiiz7XZoAAORZFCI1ybTPpQoAQK7FIVKabPtbugAA5FskIiXIuK+lDABAzsUimi1Z97O0AUBE6pM6AGRNTaKZkHkfSx0AgNyLRzQd2fev9AEAyL+IRNeih32riwAA9LGYRBfoZb/qJgAA/SwqmZue9qmuAgDQ1+KS+ehtf+ouAAD9LTKZgx73pS4DANDnYpNx6XU/6nLSV8vdtmNc9BzInPRa+BfotgO4nN4PAumTEfadIQIAMMbBIP0wyn4zTAAAxjkoJDcj7TNDBQBgrIND8jHa/jLUH3M1XhwkpRit8C8wXAdwOaMeNNKWkfeRoQMAMPbBI/UZff8Y+o+7Gk8JKFJGL/wLDN8BXM4sB5WiY6Z9YqoAAMx1cGnmzLY/TPXHXo2nBHSB2Qr/AtN1AJcz60GnK5l5H5j2D78auwHzMXPhX2D6Bbgag8D4WPiXcCEmwSAwHhb+h5n6GsBUuFmMhcfz2rgoEWA3oF8s/KlxcWaAQaAfLPzIcJFmgUEgLxb+zHCxosAgkAcLf3a4aAphGGiPRR89LqDCGATqY+ErhwupIoaBclj06uCiaoRhMHMsevVxgQVgGEyORa8tLrZgDAMWvUhceMmYIRBY8PLggZCcEQKBBS8vHhidkjEYWOj6wwNmUGoEBAuciIiIiIiIiIiIiIiIiEh6/w/2aoSNhOmzuQAAAABJRU5ErkJggg==';
      const iconBytes = Uint8Array.from(atob(iconBase64), c => c.charCodeAt(0));
      return new Response(iconBytes, {
        headers: {
          'Content-Type': 'image/png',
          'Cache-Control': 'public, max-age=31536000',
          'Access-Control-Allow-Origin': '*'
        }
      });
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

        // Auto-register DM space for Gmail sidebar handoff
        const dmSpaceType = event.space?.type || event.message?.space?.type;
        const dmSpaceNameRaw = event.space?.name || event.message?.space?.name;
        if (!isAddon && dmSpaceType === 'DM' && event.message?.sender?.email) {
          try {
            const senderEmail = event.message.sender.email.toLowerCase().trim();
            const dmSpaceName = dmSpaceNameRaw;
            if (senderEmail && dmSpaceName && env.CONVERSATION_KV) {
              await env.CONVERSATION_KV.put(
                `gchat_dm_space:${senderEmail}`,
                dmSpaceName,
                { expirationTtl: 86400 * 365 }
              );
            }
          } catch (regErr) {
            console.error(`[HANDOFF] Space registration error: ${regErr.message}`);
          }
        }

        // Detect if message is in a Space (not a DM)
        const isSpace = event.space?.type === 'ROOM';

        // Extract message text from either format (handles attachments, cards, etc.)
        const messageText = extractMessageText(event, isAddon);

        // Extract sender ID for conversation history
        const personId = isAddon
          ? (event.chat?.user?.name || 'unknown')
          : (event.message?.sender?.name || 'unknown');

        // Check for image attachments (screenshots, photos, license dashboards, etc.)
        let imageData = null;
        if (env.GCP_SERVICE_ACCOUNT_KEY) {
          try {
            imageData = await extractImageFromEvent(event, env);
            if (imageData) {
              console.log(`[GCHAT-IMG] Image extracted: ${imageData.mediaType}, ${imageData.base64.length} base64 chars`);
            }
          } catch (imgErr) {
            console.warn(`[GCHAT-IMG] Image extraction failed: ${imgErr.message}`);
          }
        }

        // Handle non-message events (but allow image-only messages through)
        if (!messageText && !imageData) {
          const greeting = 'Hey! I\'m Stratus AI, your Cisco/Meraki quoting assistant. Try "quote 10 MR44" or "5 MS150-48LP-4G" to get started.';
          return sendGChatResponse(greeting, isAddon);
        }

        const text = messageText || '';

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
        const _requestStartMs = Date.now();
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

        // Fast-path: "show me links / what did you just create?" — return the saved
        // last_crm_result without spinning up the full agentic loop.
        const lastResultPattern = /\b(links?|url|urls|records?)\s*(you\s+)?(just\s+)?(creat|made?|built?)\b|\bwhat\s+(records?|did\s+you|have\s+you)\s+(just\s+)?(creat|made?|built?)|\b(show|give)\s+me\s+the\s+(zoho\s+)?(links?|url|records?)\b|\b(most\s+recent|just\s+creat|latest)\s+(records?|deal|quote|account)\b/i;
        if (lastResultPattern.test(text) && personId && kv) {
          const lastResult = await kv.get(`last_crm_result_${personId}`, 'json').catch(() => null);
          if (lastResult && lastResult.summary) {
            const age = Math.round((Date.now() - lastResult.ts) / 60000);
            reply = `Here's what was created ${age < 2 ? 'just now' : `~${age} minutes ago`}:\n\n${lastResult.summary}`;
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', reply);
          }
        }

        // Skip deterministic quoting engine for explicit CRM/Zoho requests
        // e.g. "In zoho a new quote for 1 MR44" — the SKU parser would intercept
        // before the CRM agent could handle it without this guard.
        let isExplicitCrmRequest = /\bzoho\b|\bcrm\b|\bin\s+zoho\b|\bzoho\s+quote\b|\bzoho\s+deal\b|\bopen\s+deals?\b|\bcheck\s+(the\s+)?(crm|zoho)\b/i.test(text);

        // Detect "quote [SKUs] for [company]" pattern — when a company/account name
        // is referenced alongside SKUs, route to CRM for Zoho quote creation.
        // Matches: "quote 1 mr44 for easy ice", "quote 10 MR57 for Acme Corp",
        //          "create a quote for 5 MR44 under easy ice"
        if (!isExplicitCrmRequest) {
          const forCompanyPattern = /\b(quote|create|build|make)\b.*\b(for|under|at)\s+([A-Z][a-zA-Z].*?)$/i;
          const forMatch = text.match(forCompanyPattern);
          if (forMatch) {
            const possibleCompany = forMatch[3].trim().replace(/[.!?]+$/, '');
            // Make sure it's not just a modifier like "for 1 year" or "for hardware only"
            const isModifier = /^(\d+\s*(year|yr|y)|hardware|license|lic|pricing|cost|price|each|free)/i.test(possibleCompany);
            if (!isModifier && possibleCompany.length > 2) {
              console.log(`[GCHAT] Company-referenced quote detected: "${possibleCompany}" — routing to CRM agent`);
              isExplicitCrmRequest = true;
            }
          }
        }

        // Detect "create that in zoho" / "put that in zoho" / "make a zoho quote"
        if (!isExplicitCrmRequest) {
          if (/\b(create|put|make|build|add)\s+(that|this|it)\s+(in|into|to)\s+(zoho|crm)\b/i.test(text)) {
            isExplicitCrmRequest = true;
          }
        }

        // Detect existing-quote modification — messages about updating/fixing/cleaning up
        // an existing quote should route to CRM, not the URL quoting engine, even if
        // SKUs are present. Without this, "the modea quote has duplicate line items.
        // update it so it only has: 2x MR44-HW..." gets grabbed by the SKU parser.
        if (!isExplicitCrmRequest) {
          const hasQuoteRef = /\b(the\s+\w+\s+quote|this\s+quote|that\s+quote|existing\s+quote|current\s+quote|modea\s+quote|quote\s+has|quote\s+#?\d)\b/i.test(text);
          const hasModifyIntent = /\b(update|fix|change|remove|duplicate|replace|modify|clean\s*up|correct|swap|switch|convert)\b/i.test(text);
          if (hasQuoteRef && hasModifyIntent) {
            console.log(`[GCHAT] Existing quote modification detected — routing to CRM agent`);
            isExplicitCrmRequest = true;
          }
        }

        // CRM session continuation: if a CRM conversation is active (flag set by
        // the async CRM handler), keep routing follow-up messages to the CRM agent
        // even without explicit "zoho"/"crm" keywords. This allows multi-turn CRM
        // workflows (ask clarifying questions → user answers → create quote).
        // IMPORTANT: Do NOT hijack messages that are clearly quoting requests
        // (e.g. "quote 5 MR44") — those should go through the deterministic engine
        // even if a CRM session is active.
        if (!isExplicitCrmRequest && personId && kv) {
          const crmSession = await kv.get(`crm_session_${personId}`);
          console.log(`[GCHAT] CRM session check for ${personId}: ${crmSession ? 'ACTIVE' : 'NOT FOUND'}`);
          if (crmSession) {
            // Check if this looks like a quoting request — if so, let it go
            // through the deterministic quoting engine instead of the CRM agent
            // BUT exclude messages about applying/updating ecomm pricing on existing quotes
            const isCrmPricingAction = /\b(apply|update|set|change|use)\b.{0,20}\b(ecomm|e-comm|discount|stratus\s+pric)/i.test(text);
            const looksLikeQuote = !isCrmPricingAction && (
              /^\s*(quote|q)\s+\d/i.test(text)
              || /^\s*\d+\s*x?\s+[A-Z]{1,3}[A-Z0-9-]/i.test(text)
              || /\b(cost|price|pricing|how much)\b/i.test(text)
            );
            if (looksLikeQuote) {
              console.log(`[GCHAT] Active CRM session but message looks like a quoting request — letting quoting engine handle it`);
            } else {
              console.log(`[GCHAT] Active CRM session found for ${personId} — routing to CRM agent`);
              isExplicitCrmRequest = true;
            }
          }
        }

        // CRM follow-up detection: route short follow-up messages to CRM agent
        // when the PREVIOUS assistant message was CRM-related. This catches
        // "try again", "confirm status", "go ahead", "yes proceed", "yes", etc.
        // Also catches bare "yes"/"no" answers to CRM agent questions like
        // "Would you like me to submit to Velocity Hub?" or "apply ecomm pricing?"
        if (!isExplicitCrmRequest && personId && kv) {
          const followUpPattern = /^\s*(try\s+again|retry|again|try\s+that\s+again|confirm|status|proceed|go\s+ahead|yes|yep|yeah|no|nah|not\s+now|skip|do\s+it|make\s+it|approved?|looks?\s+good|that('?s|\s+is)\s+(correct|right|good)|check\s+(the\s+)?(status|progress)|what('?s|\s+is)\s+(the\s+)?(status|progress|update|happening)|how('?s|\s+is)\s+(it|that)\s+(going|coming|looking)|did\s+(it|that)\s+(work|go\s+through)|confirm\s+the\s+status|what\s+happened|is\s+it\s+done|are\s+we\s+good|any\s+update|where\s+are\s+we|is\s+(this|it)\s+still\s+(being\s+)?(worked?\s+on|working|processing|running)|still\s+working\s+on\s+(this|it|that)|check\s+it\s+again|check\s+again|try\s+again|send\s+(it|the)\s+deal|submit)\s*[.!?]?\s*$/i;
          // Also match messages that reference quote/deal creation status or ecomm pricing actions
          const crmFollowUpPattern = /\b(status|confirm|progress|update)\b.{0,30}\b(quote|deal|account|contact|task|creation|create)/i;
          const crmActionFollowUp = /^\s*(yes|yep|yeah|sure|ok|go\s+ahead)[\s,]*\b(apply|update|set|change|use|add|remove|swap|modify)\b/i;

          if (followUpPattern.test(text) || crmFollowUpPattern.test(text) || crmActionFollowUp.test(text)) {
            const recentHistory = await getHistory(kv, personId);
            const lastUserMsg = recentHistory.filter(m => m.role === 'user').slice(-2, -1)[0];
            const lastAssistantMsg = recentHistory.filter(m => m.role === 'assistant').pop();

            // Check if previous conversation involved CRM — check BOTH the last user
            // message intent AND the last assistant message content. The assistant
            // check covers cases where the bot asked a CRM follow-up question (e.g.
            // "Would you like me to apply ecomm pricing?" or "submit to Velocity Hub?")
            const prevWasCrm = (lastUserMsg && detectCrmEmailIntent(lastUserMsg.content).hasAny)
              || (lastAssistantMsg && /\b(zoho|crm|account|deal|quote|contact|velocity\s*hub|ecomm|deal\s*id|did\s*generated|ccw)/i.test(lastAssistantMsg.content));

            if (prevWasCrm) {
              console.log(`[GCHAT] CRM follow-up detected ("${text.substring(0, 40)}...") after CRM conversation — routing to CRM agent`);
              isExplicitCrmRequest = true;
            }
          }
        }

        // Deterministic pricing calculator (runs BEFORE parseMessage so pricing
        // requests for Duo/Umbrella/etc. don't get intercepted by quoting handlers)
        if (!reply && !isExplicitCrmRequest) {
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            reply = pricingReply;
          }
        }

        if (!reply && !isExplicitCrmRequest) {
          const parsed = parseMessage(text);
          if (parsed) {
            // Clarification prompts (e.g. "which Duo tier?") — send directly
            if (parsed.isClarification && parsed.clarificationMessage) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', parsed.clarificationMessage);
              reply = parsed.clarificationMessage;
            }
            const result = !reply ? buildQuoteResponse(parsed) : null;
            if (result && !result.needsLlm && result.message) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', result.message);
              reply = result.message;
            } else if (result && result.revision) {
              const history = await getHistory(kv, personId);
              if (history.length > 0) {
                reply = await askClaude(
                  `${text}\n\n(Note: The user is modifying their previous quote request.)`,
                  personId, env
                );
              } else {
                reply = 'I don\'t have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"';
              }
            } else if (result && result.errors && result.errors.length > 0) {
              const errorContext = result.errors.join('\n');
              reply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
            }
          }
        }

        if (!reply) {
          // Check if this is a CRM or email intent — if so, enable tool use
          const intent = detectCrmEmailIntent(text);

          // Image + action verb = almost certainly a CRM request (screenshot of Zoho, quote, etc.)
          if (imageData && !intent.hasAny && /\b(change|update|modify|edit|set|fix|adjust|move|extend|renew|close|complete|create|add|delete|remove)\b/i.test(text)) {
            intent.hasAny = true;
            intent.hasCrm = true;
            console.log(`[GCHAT-AGENT] Image + action verb detected — forcing CRM routing`);
          }

          // CRITICAL: If CRM session/follow-up detection already flagged this as a CRM
          // request (isExplicitCrmRequest=true from lines 7549-7588), force CRM routing
          // with tools enabled. Without this, generic follow-ups like "is this still
          // being worked on?" would fail detectCrmEmailIntent() and get dispatched
          // WITHOUT tools, causing Claude to hallucinate XML tool invocations.
          if (isExplicitCrmRequest && !intent.hasAny) {
            intent.hasAny = true;
            intent.hasCrm = true;
            console.log(`[GCHAT-AGENT] CRM session/follow-up active — forcing useTools=true despite no CRM keywords in text`);
          }

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
              // ARCHITECTURE: Dispatch CRM work via Cloudflare Workflow (preferred)
              //   or Queue (fallback) or ctx.waitUntil (last resort).
              //
              // Workflow advantages over Queue:
              //   - Per-step retries (Zoho timeout? only that step re-runs)
              //   - Durable state persisted between steps
              //   - Step-level visibility in CF dashboard
              //   - No wall-clock limit (runs as long as needed)
              //
              // Queue kept as fallback in case Workflow binding isn't available.
              //
              // Flow: webhook → workflow.create(payload) → return 200 immediately
              //       workflow steps: progress → askClaude → deliver → update history
              const _imgData = imageData ? { base64: imageData.base64, mediaType: imageData.mediaType } : null;

              // ── Dispatch: Workflow → Queue → ctx.waitUntil ─────────────────
              if (env.CRM_WORKFLOW) {
                try {
                  // Store image data in KV if present (may exceed workflow payload limit)
                  let imageDataKey = null;
                  if (_imgData) {
                    imageDataKey = `workflow_img_${Date.now()}_${personId}`;
                    await env.CONVERSATION_KV.put(imageDataKey, JSON.stringify(_imgData), { expirationTtl: 300 });
                  }
                  await env.CRM_WORKFLOW.create({
                    params: { text, personId, spaceName, threadName, imageDataKey }
                  });
                  console.log(`[GCHAT-DISPATCH] CRM work dispatched to Workflow for: "${text.substring(0, 60)}..."`);
                } catch (workflowErr) {
                  console.error(`[GCHAT-DISPATCH] Workflow create failed: ${workflowErr.message} — falling back to Queue`);
                  // Fall through to Queue
                  if (env.CRM_QUEUE) {
                    try {
                      await env.CRM_QUEUE.send({ text, personId, spaceName, threadName, imageData: _imgData });
                      console.log(`[GCHAT-DISPATCH] Fell back to Queue successfully`);
                    } catch (queueErr) {
                      console.error(`[GCHAT-DISPATCH] Queue also failed: ${queueErr.message}`);
                      try {
                        await sendAsyncGChatMessage(spaceName, `❌ Failed to process request: ${workflowErr.message.substring(0, 100)}`, null, env);
                      } catch (_) {}
                    }
                  } else {
                    try {
                      await sendAsyncGChatMessage(spaceName, `❌ Failed to process request: ${workflowErr.message.substring(0, 100)}`, null, env);
                    } catch (_) {}
                  }
                }
              } else if (env.CRM_QUEUE) {
                // Queue fallback (original dispatch method)
                try {
                  await env.CRM_QUEUE.send({ text, personId, spaceName, threadName, imageData: _imgData });
                  console.log(`[GCHAT-DISPATCH] CRM work queued for: "${text.substring(0, 60)}..."`);
                } catch (queueErr) {
                  console.error(`[GCHAT-DISPATCH] Queue send failed: ${queueErr.message}`);
                  try {
                    await sendAsyncGChatMessage(spaceName, `❌ Failed to queue request: ${queueErr.message.substring(0, 100)}`, null, env);
                  } catch (_) {}
                }
              } else {
                // Last resort: ctx.waitUntil (30s wall-clock limit)
                console.warn(`[GCHAT-DISPATCH] No CRM_WORKFLOW or CRM_QUEUE — falling back to ctx.waitUntil`);
                ctx.waitUntil((async () => {
                  try {
                    await sendAsyncGChatMessage(spaceName, '⏳ Working on it...', threadName, env);
                    const result = await askClaude(text, personId, env, _imgData, true);
                    if (result) {
                      await sendAsyncGChatMessage(spaceName, result, threadName, env);
                    }
                  } catch (fallbackErr) {
                    console.error(`[GCHAT-DISPATCH] ctx.waitUntil fallback failed: ${fallbackErr.message}`);
                    try {
                      await sendAsyncGChatMessage(spaceName, `❌ Request failed: ${fallbackErr.message.substring(0, 100)}`, threadName, env);
                    } catch (_) {}
                  }
                })());
              }

              // Return empty response immediately — queue consumer or ctx.waitUntil handles everything
              return new Response(JSON.stringify({}), { headers: { 'Content-Type': 'application/json' } });
            }

            // Fallback: no service account key, process synchronously (may timeout)
            console.log(`[GCHAT-AGENT] No GCP_SERVICE_ACCOUNT_KEY — falling back to synchronous CRM processing`);
          }

          reply = await askClaude(text, personId, env, imageData, useTools);
        }

        // If we have an image but no reply yet (no CRM intent, no SKU match),
        // send directly to Claude with the image for analysis
        if (!reply && imageData) {
          const prompt = text || 'A user sent this image. Analyze it and respond accordingly. If it contains Meraki license information, SKUs, or network details, provide relevant quoting or product guidance.';
          reply = await askClaude(prompt, personId, env, imageData);
        }

        // Adapt markdown for Google Chat (* instead of **)
        reply = adaptMarkdownForGChat(reply);
        reply = truncateGChatReply(reply);

        // ── D1 + Analytics Engine: Log this interaction (fire-and-forget) ──
        const _requestEndMs = Date.now();
        const _responsePath = useTools ? 'crm_agent' : (reply && !imageData ? 'deterministic' : 'claude');
        const _durationMs = _requestEndMs - (_requestStartMs || _requestEndMs);
        ctx.waitUntil(logBotUsageToD1(env, {
          bot: isAddon ? 'addon' : 'gchat',
          personId,
          requestText: text,
          responsePath: _responsePath,
          durationMs: _durationMs
        }));
        writeMetric(env, {
          bot: isAddon ? 'addon' : 'gchat',
          path: _responsePath,
          durationMs: _durationMs,
          personId
        });

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

        // Deterministic pricing calculator (runs BEFORE parseMessage so pricing
        // requests for Duo/Umbrella/etc. don't get intercepted by quoting handlers)
        if (!reply) {
          const pricingReply = await handlePricingRequest(text, personId, kv);
          if (pricingReply) {
            await addToHistory(kv, personId, 'user', text);
            await addToHistory(kv, personId, 'assistant', pricingReply);
            reply = pricingReply;
          }
        }

        if (!reply) {
          // Try deterministic engine
          const parsed = parseMessage(text);
          if (parsed) {
            // Clarification prompts (e.g. "which Duo tier?") — send directly, skip buildQuoteResponse
            if (parsed.isClarification && parsed.clarificationMessage) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', parsed.clarificationMessage);
              reply = parsed.clarificationMessage;
            }

            const result = !reply ? buildQuoteResponse(parsed) : null;

            if (result && !result.needsLlm && result.message) {
              await addToHistory(kv, personId, 'user', text);
              await addToHistory(kv, personId, 'assistant', result.message);
              reply = result.message;
            } else if (result && result.revision) {
              const history = await getHistory(kv, personId);
              if (history.length > 0) {
                reply = await askClaude(
                  `${text}\n\n(Note: The user is modifying their previous quote request. Use the conversation history to understand what they originally asked for, apply the requested change, and generate updated URLs.)`,
                  personId, env
                );
              } else {
                reply = `I don't have a previous quote to modify. Could you give me the full request? For example: "quote 10 MR44 hardware only"`;
              }
            } else if (result && result.errors && result.errors.length > 0) {
              const errorContext = result.errors.join('\n');
              reply = await askClaude(`${text}\n\n(Note: these SKU issues were detected: ${errorContext})`, personId, env);
            }
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
  },

  // ── Cron Trigger: Daily price refresh from Zoho WooProducts → KV ──
  // Runs on schedule defined in wrangler.toml (default: daily 6 AM CT)
  // Fetches Stratus_Price for every SKU in the static prices.json,
  // builds an updated price map, and stores it in KV.
  // Runtime reads KV first → falls back to static prices.json.
  // ── Queue Consumer: CRM work dispatch (independent execution context) ──
  // Cloudflare Queue consumers get their own execution context with up to
  // 15 minutes of wall-clock time — no 30s ctx.waitUntil limit.
  // The webhook handler produces a message with the work payload; this
  // consumer picks it up and runs the full agentic CRM loop.
  async queue(batch, env) {
    for (const msg of batch.messages) {
      const queueStart = Date.now();
      const { text, personId, spaceName, threadName, imageData } = msg.body;
      console.log(`[GCHAT-QUEUE] Processing CRM work for: "${(text || '').substring(0, 80)}..." spaceName="${spaceName}"`);

      if (!spaceName) {
        console.error('[GCHAT-QUEUE] No spaceName in message — skipping');
        msg.ack();
        continue;
      }

      // Load live prices (same as fetch handler)
      if (env.CONVERSATION_KV) {
        await loadLivePrices(env);
      }

      const kv = env.CONVERSATION_KV;

      // Send initial "Working on it..." message
      let _progressMsgName = null;
      let _stepLog = [];
      try {
        const thinkingMsg = await sendAsyncGChatMessage(spaceName, '⏳ Working on it...', null, env);
        _progressMsgName = thinkingMsg?.name || null;
        console.log(`[GCHAT-QUEUE] Progress message sent: ${_progressMsgName}`);
      } catch (initSendErr) {
        console.error(`[GCHAT-QUEUE] Failed to send progress message: ${initSendErr.message}`);
      }

      // Progress callback: real-time step updates
      const progressCallback = _progressMsgName
        ? async (stepMsg) => {
            if (stepMsg) {
              const lines = stepMsg.split('\n').filter(l => /^[🔍📄🔗✏️📦🌐📧✍️📤⚙️]/.test(l.trim()));
              for (const line of lines) {
                const trimmed = line.trim();
                if (_stepLog.length === 0 || _stepLog[_stepLog.length - 1] !== trimmed) {
                  _stepLog.push(trimmed);
                }
              }
            }
            const recentSteps = _stepLog.slice(-5);
            const display = recentSteps.length > 0
              ? `⏳ *Working on it...*\n\n${recentSteps.join('\n')}`
              : '⏳ Working on it...';
            try { await updateGChatMessage(_progressMsgName, display, env); } catch (_) {}
          }
        : async () => {};

      try {
        // 5-minute safety-net deadline
        let result = await askClaude(text, personId, env, imageData || null, true, progressCallback, 300000);
        console.log(`[GCHAT-QUEUE] askClaude completed in ${Date.now() - queueStart}ms`);

        let finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
        finalReply = adaptMarkdownForGChat(finalReply);
        finalReply = truncateGChatReply(finalReply);

        // Deliver final response
        let delivered = false;
        if (_progressMsgName) {
          try {
            delivered = await updateGChatMessage(_progressMsgName, finalReply, env);
            if (delivered) console.log(`[GCHAT-QUEUE] Final response PATCH'd onto ${_progressMsgName}`);
          } catch (patchErr) {
            console.warn(`[GCHAT-QUEUE] PATCH failed: ${patchErr.message}`);
          }
        }
        if (!delivered) {
          await sendAsyncGChatMessage(spaceName, finalReply, null, env);
        }

        // Update conversation history
        if (personId) {
          await addToHistory(kv, personId, 'user', text);
          await addToHistory(kv, personId, 'assistant', finalReply);
          await kv.put(`crm_session_${personId}`, 'active', { expirationTtl: 600 });
        }
        console.log(`[GCHAT-QUEUE] Completed in ${Date.now() - queueStart}ms total`);
      } catch (err) {
        console.error(`[GCHAT-QUEUE] Error: ${err.message}`);
        const errMsg = `❌ Sorry, I ran into an issue processing that request.\n\n_Error: ${err.message.substring(0, 200)}_`;
        try {
          if (_progressMsgName) {
            await updateGChatMessage(_progressMsgName, errMsg, env);
          } else {
            await sendAsyncGChatMessage(spaceName, errMsg, null, env);
          }
        } catch (_) {}
      }
      msg.ack();
    }
  },

  async scheduled(event, env, ctx) {
    const startTime = Date.now();
    console.log(`[PRICE-CRON] Starting daily price refresh at ${new Date().toISOString()}`);

    // Use PRICES_KV (shared across both workers) with CONVERSATION_KV fallback
    const kv = env.PRICES_KV || env.CONVERSATION_KV;
    if (!env.ZOHO_CLIENT_ID || !env.ZOHO_REFRESH_TOKEN) {
      console.error('[PRICE-CRON] Missing Zoho credentials — skipping refresh');
      return;
    }

    // ─── Known Product ID exceptions (no Products record in Zoho) ────────
    // Duo/Umbrella WooProducts have null WooProduct_Code so cron can't match them.
    // Static prices in prices.json are authoritative for these stable per-user licenses.
    const PRODUCT_ID_SKIP_LIST = new Set([
      'Z1-HW-AU', 'Z1-HW-UK', 'Z4CX', 'Z4X', 'MV22-HW',
      'LIC-MX50-ENT-1YR', 'LIC-MX50-ENT-3YR', 'LIC-MX50-SEC-1YR', 'LIC-MX50-SEC-3YR',
      'LIC-VMX-XL-SEC-1Y', 'LIC-VMX-XL-SEC-3Y', 'LIC-VMX-XL-SEC-5Y',
      'LIC-MX-SDW-M-3Y', 'MA-PWR-CORD-JP', 'MA-PWR-USB-JP', 'MA-PWR300WINDADP-O',
      // Duo licenses (WooProducts have null WooProduct_Code — name-based only)
      'LIC-DUO-ESSENTIALS-1YR', 'LIC-DUO-ESSENTIALS-3YR', 'LIC-DUO-ESSENTIALS-5YR',
      'LIC-DUO-ADVANTAGE-1YR', 'LIC-DUO-ADVANTAGE-3YR', 'LIC-DUO-ADVANTAGE-5YR',
      'LIC-DUO-PREMIER-1YR', 'LIC-DUO-PREMIER-3YR', 'LIC-DUO-PREMIER-5YR',
      // Umbrella licenses (WooProducts have null WooProduct_Code — name-based only)
      'LIC-UMB-DNS-ESS-K9-1YR', 'LIC-UMB-DNS-ESS-K9-3YR', 'LIC-UMB-DNS-ESS-K9-5YR',
      'LIC-UMB-DNS-ADV-K9-1YR', 'LIC-UMB-DNS-ADV-K9-3YR', 'LIC-UMB-DNS-ADV-K9-5YR',
      'LIC-UMB-SIG-ESS-K9-1YR', 'LIC-UMB-SIG-ESS-K9-3YR', 'LIC-UMB-SIG-ESS-K9-5YR',
      'LIC-UMB-SIG-ADV-K9-1YR', 'LIC-UMB-SIG-ADV-K9-3YR', 'LIC-UMB-SIG-ADV-K9-5YR',
    ]);

    try {
      // Get all SKUs from the static prices.json (bundled at deploy time)
      const staticPrices = pricesData.prices;
      const skuList = Object.keys(staticPrices);
      console.log(`[PRICE-CRON] Refreshing ${skuList.length} SKUs from Zoho WooProducts`);

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 1: Price refresh (update Stratus_Price for all known SKUs)
      // ═══════════════════════════════════════════════════════════════════
      const BATCH_SIZE = 5;
      // Deep-copy existing entries to preserve all 6 fields
      const updatedPrices = {};
      for (const [sku, entry] of Object.entries(staticPrices)) {
        updatedPrices[sku] = { ...entry };
      }
      let updated = 0;
      let skipped = 0;
      let errors = 0;
      let outliers = 0;
      const priceChanges = []; // Track which SKUs had price changes

      for (let i = 0; i < skuList.length; i += BATCH_SIZE) {
        const batch = skuList.slice(i, i + BATCH_SIZE);
        const results = await Promise.allSettled(
          batch.map(async (sku) => {
            try {
              const result = await zohoApiCall(
                'GET',
                `WooProducts/search?criteria=(WooProduct_Code:equals:${encodeURIComponent(sku)})&fields=WooProduct_Code,Stratus_Price`,
                env
              );

              if (!result?.data?.length) return { sku, price: null };

              // Filter out bundles (codes with '+') and find exact match
              const match = result.data.find(r =>
                r.WooProduct_Code === sku && !r.WooProduct_Code.includes('+')
              );

              return { sku, price: match?.Stratus_Price ?? null };
            } catch (err) {
              console.error(`[PRICE-CRON] Error fetching ${sku}: ${err.message}`);
              return { sku, price: null, error: true };
            }
          })
        );

        for (const result of results) {
          if (result.status === 'rejected') { errors++; continue; }
          const { sku, price, error } = result.value;

          if (error) { errors++; continue; }
          if (price == null || price === 0) { skipped++; continue; }

          const existing = updatedPrices[sku];
          const listPrice = existing?.list || 0;

          // Outlier check: Stratus price should never exceed list price
          if (listPrice > 0 && price > listPrice) {
            outliers++;
            continue; // Keep existing price
          }

          // Track if price actually changed
          if (existing?.price !== price) {
            priceChanges.push({ sku, oldPrice: existing?.price, newPrice: price });
            // D1: Log price change (fire-and-forget)
            ctx.waitUntil(logPriceChangeToD1(env, {
              sku,
              oldPrice: existing?.price,
              newPrice: price,
              listPrice: existing?.list || null
            }));
          }

          // Merge into existing entry — preserve zoho_product_id and all other fields
          existing.price = price;
          if (listPrice > 0) {
            existing.discount = Math.round(((listPrice - price) / listPrice) * 10000) / 10000;
            existing.discount_per_unit = Math.round((listPrice - price) * 100) / 100;
            existing.discount_pct = Math.round((1 - price / listPrice) * 100);
          }
          updated++;
        }

        // Small delay between batches to respect Zoho rate limits
        if (i + BATCH_SIZE < skuList.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      console.log(`[PRICE-CRON] Phase 1 complete — updated: ${updated}, skipped: ${skipped}, errors: ${errors}, outliers: ${outliers}, priceChanges: ${priceChanges.length}`);

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 2: New SKU discovery (paginate WooProducts, find unknowns)
      // ═══════════════════════════════════════════════════════════════════
      let newSkus = [];
      let filteredOut = 0;
      try {
        console.log('[PRICE-CRON] Phase 2: Scanning WooProducts for new SKUs...');
        const allWooSkus = {};
        let page = 1;
        let hasMore = true;
        let pageToken = null;

        while (hasMore && page <= 20) { // Safety cap at 20 pages
          const params = pageToken
            ? `WooProducts?fields=WooProduct_Code,Stratus_Price&per_page=200&page_token=${pageToken}`
            : `WooProducts?fields=WooProduct_Code,Stratus_Price&per_page=200&page=${page}`;

          const result = await zohoApiCall('GET', params, env);
          if (!result?.data?.length) break;

          for (const r of result.data) {
            const code = r.WooProduct_Code;
            const price = r.Stratus_Price;
            if (!code || code.includes('+')) continue; // Skip nulls and bundles
            if (!allWooSkus[code]) allWooSkus[code] = price;
          }

          // Check pagination
          hasMore = result?.info?.more_records === true;
          pageToken = result?.info?.next_page_token || null;
          if (page >= 10 && !pageToken) break; // Can't go past page 10 without token
          page++;

          await new Promise(r => setTimeout(r, 200));
        }

        // Find SKUs in WooProducts but not in prices.json
        // Filter out EOL products, legacy/renamed SKUs, and discontinued items
        // so the notification only surfaces genuinely new, sellable products.
        const EOL_HW_PREFIXES = [
          'MS120-', 'MS125-', 'MS210-', 'MS220-', 'MS225-', 'MS250-', 'MS320-',
          'MS350-', 'MS355-', 'MS390-', 'MS410-', 'MS420-', 'MS425-',
          'MR12', 'MR16', 'MR18', 'MR24', 'MR26', 'MR32', 'MR33', 'MR34',
          'MR42', 'MR52', 'MR53', 'MR56', 'MR62', 'MR66', 'MR72', 'MR74',
          'MR84', 'MR20', 'MR30H', 'MR70',
          'MV12', 'MV22', 'MV32', 'MV52', 'MV72',
          'MX60', 'MX64', 'MX65', 'MX80', 'MX84', 'MX100', 'MX400', 'MX600',
          'Z1-', 'Z3-', 'Z3C',
          'MG21',
        ];
        const LEGACY_SKU_PREFIXES = [
          // Renamed Duo tiers (MFA→Essentials, Access→Advantage, Beyond→Premier)
          'LIC-DUO-MFA', 'LIC-DUO-ACCESS', 'LIC-DUO-BEYOND',
          // Discontinued accessories and legacy interface modules
          'PWR-MS420', 'IM-2-SFP', 'IM-8-SFP',
          // Legacy vMX size tiers (replaced by S/M/L/XL naming)
          'LIC-VMX100',
          // Legacy Meraki Insight sizing
          'LIC-MI-XS', 'LIC-MI-S-', 'LIC-MI-M-', 'LIC-MI-L-', 'LIC-MI-XL',
          // Legacy GR (Go Router)
          'GR10-', 'GR60-', 'LIC-GR-', 'GA-',
          // Legacy Meraki Cloud (MC) phone
          'LIC-MC-',
          // Legacy Lobby Ambassador licensing
          'LIC-L-AC-',
          // Discontinued MA- accessories/mounts already in prices.json or obsolete
          'MA-MNT-MR-', 'MA-MNT-MV-', 'MA-INJ-4', 'MA-INJ-5', 'MA-PWR-18W',
          'MA-SFP-1GB-LX100', 'MA-MOD-4X10G',
          // Legacy vMX Enterprise sizing
          'LIC-VMX-ENT-S', 'LIC-VMX-ENT-M',
          // Legacy MX70
          'LIC-MX70',
        ];

        const isEolOrLegacy = (sku) => {
          const upper = sku.toUpperCase();
          if (EOL_HW_PREFIXES.some(p => upper.startsWith(p))) return true;
          if (LEGACY_SKU_PREFIXES.some(p => upper.startsWith(p))) return true;
          // Check auto-catalog EOL replacements
          const base = upper.replace(/-HW(-NA)?$/, '');
          if (catalogData._EOL_REPLACEMENTS && catalogData._EOL_REPLACEMENTS[base]) return true;
          return false;
        };

        for (const [code, price] of Object.entries(allWooSkus)) {
          if (!updatedPrices[code] && price && price > 0) {
            if (isEolOrLegacy(code)) {
              filteredOut++;
            } else {
              newSkus.push({ sku: code, price });
            }
          }
        }

        console.log(`[PRICE-CRON] Phase 2 complete — WooProducts total: ${Object.keys(allWooSkus).length}, new SKUs found: ${newSkus.length}, EOL/legacy filtered: ${filteredOut}`);
      } catch (err) {
        console.error(`[PRICE-CRON] Phase 2 error: ${err.message}`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 3: Product ID check (find missing zoho_product_id values)
      // ═══════════════════════════════════════════════════════════════════
      let productIdsAdded = 0;
      try {
        const missingIds = Object.entries(updatedPrices)
          .filter(([sku, v]) => !v.zoho_product_id && !PRODUCT_ID_SKIP_LIST.has(sku))
          .map(([sku]) => sku);

        if (missingIds.length > 0) {
          console.log(`[PRICE-CRON] Phase 3: Looking up ${missingIds.length} missing product IDs...`);

          // Batch search Products module (up to 15 OR conditions per call)
          for (let i = 0; i < missingIds.length; i += 10) {
            const batch = missingIds.slice(i, i + 10);
            // Build search codes — strip -O suffix for accessories
            const searchPairs = batch.map(sku => {
              const searchCode = sku.endsWith('-O') ? sku.slice(0, -2) : sku;
              return { originalSku: sku, searchCode };
            });

            const criteria = searchPairs
              .map(p => `(Product_Code:equals:${encodeURIComponent(p.searchCode)})`)
              .join('or');

            try {
              const result = await zohoApiCall(
                'GET',
                `Products/search?criteria=(${criteria})&fields=Product_Code,id`,
                env
              );

              if (result?.data?.length) {
                for (const record of result.data) {
                  // Match back to original SKU (account for -O suffix stripping)
                  const pair = searchPairs.find(p => p.searchCode === record.Product_Code);
                  if (pair && updatedPrices[pair.originalSku]) {
                    updatedPrices[pair.originalSku].zoho_product_id = record.id;
                    productIdsAdded++;
                    console.log(`[PRICE-CRON] Found product ID for ${pair.originalSku}: ${record.id}`);
                  }
                }
              }
            } catch (err) {
              console.error(`[PRICE-CRON] Phase 3 batch error: ${err.message}`);
            }

            await new Promise(r => setTimeout(r, 200));
          }
        }
        console.log(`[PRICE-CRON] Phase 3 complete — product IDs added: ${productIdsAdded}`);
      } catch (err) {
        console.error(`[PRICE-CRON] Phase 3 error: ${err.message}`);
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 4: Write results to KV
      // ═══════════════════════════════════════════════════════════════════
      const kvPayload = {
        prices: updatedPrices,
        refreshedAt: new Date().toISOString(),
        stats: {
          total: skuList.length, updated, skipped, errors, outliers,
          priceChanges: priceChanges.length,
          newSkusFound: newSkus.length,
          productIdsAdded
        }
      };
      await kv.put('prices_live', JSON.stringify(kvPayload), { expirationTtl: 90000 });

      // Store new SKUs separately with 7-day TTL for the /_new-skus endpoint
      if (newSkus.length > 0) {
        await kv.put('new_skus_detected', JSON.stringify({
          skus: newSkus,
          detectedAt: new Date().toISOString()
        }), { expirationTtl: 604800 }); // 7 days
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 5: GitHub auto-commit (weekly, or when product IDs added)
      // Commits the KV-refreshed prices back to prices.json in the repo
      // so the static fallback stays current.
      // ═══════════════════════════════════════════════════════════════════
      let githubCommitted = false;
      const dayOfWeek = new Date().getUTCDay(); // 0=Sun, 1=Mon, ...
      const shouldCommit = (dayOfWeek === 1) || productIdsAdded > 0; // Mondays or when IDs added

      if (shouldCommit && env.GITHUB_PAT && priceChanges.length > 0) {
        try {
          console.log('[PRICE-CRON] Phase 5: Committing updated prices.json to GitHub...');
          const repo = 'cjgraves1119/stratus-bot-v2';
          const ghHeaders = {
            'Authorization': `token ${env.GITHUB_PAT}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'stratus-ai-bot-gchat'
          };

          // Build the new prices.json content
          const newPricesJson = JSON.stringify({ prices: updatedPrices }, null, 2);
          const contentBase64 = btoa(unescape(encodeURIComponent(newPricesJson)));

          // Update both worker files via Git Data API (atomic commit)
          const filePaths = [
            'worker/src/data/prices.json',
            'worker-gchat/src/data/prices.json'
          ];

          // 1. Get current main branch ref
          const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers: ghHeaders });
          const refData = await refRes.json();
          const latestCommitSha = refData?.object?.sha;
          if (!latestCommitSha) throw new Error('Could not get main branch SHA');

          // 2. Get the tree of the latest commit
          const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${latestCommitSha}`, { headers: ghHeaders });
          const commitData = await commitRes.json();
          const baseTreeSha = commitData?.tree?.sha;

          // 3. Create a new tree with both files updated
          const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({
              base_tree: baseTreeSha,
              tree: filePaths.map(path => ({
                path,
                mode: '100644',
                type: 'blob',
                content: newPricesJson
              }))
            })
          });
          const treeData = await treeRes.json();
          if (!treeData?.sha) throw new Error('Could not create tree');

          // 4. Create the commit
          const msg = `chore: auto-refresh prices.json — ${priceChanges.length} price changes, ${productIdsAdded} product IDs added\n\nCron-generated commit from GChat worker.\nCo-Authored-By: Stratus AI Bot <bot@stratusinfosystems.com>`;
          const newCommitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
            method: 'POST',
            headers: ghHeaders,
            body: JSON.stringify({
              message: msg,
              tree: treeData.sha,
              parents: [latestCommitSha]
            })
          });
          const newCommitData = await newCommitRes.json();
          if (!newCommitData?.sha) throw new Error('Could not create commit');

          // 5. Update main to point to the new commit
          const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, {
            method: 'PATCH',
            headers: ghHeaders,
            body: JSON.stringify({ sha: newCommitData.sha })
          });
          const updateRefData = await updateRefRes.json();
          githubCommitted = !!updateRefData?.object?.sha;

          console.log(`[PRICE-CRON] Phase 5 complete — committed ${priceChanges.length} price changes to GitHub (SHA: ${newCommitData.sha.slice(0, 7)})`);
        } catch (err) {
          console.error(`[PRICE-CRON] Phase 5 GitHub error: ${err.message}`);
        }
      }

      // ═══════════════════════════════════════════════════════════════════
      // PHASE 6: Google Chat notification (new SKUs or significant price changes)
      // Only notifies for genuinely actionable items (EOL/legacy already filtered)
      // ═══════════════════════════════════════════════════════════════════
      const hasNewSkus = newSkus.length > 0;
      // Significant price changes: >5% change in either direction
      const significantChanges = priceChanges.filter(c => {
        if (!c.oldPrice || c.oldPrice === 0) return false;
        const pctChange = Math.abs((c.newPrice - c.oldPrice) / c.oldPrice) * 100;
        return pctChange >= 5;
      });
      const hasSignificantChanges = significantChanges.length > 0;

      if ((hasNewSkus || hasSignificantChanges) && env.GCP_SERVICE_ACCOUNT_KEY) {
        try {
          const parts = [];
          parts.push(`📊 *Daily Price Refresh Summary*`);
          parts.push(`Updated ${updated} of ${skuList.length} SKUs${filteredOut > 0 ? ` (${filteredOut} EOL/legacy filtered)` : ''}`);

          if (hasNewSkus) {
            const skuListStr = newSkus.map(s => `• ${s.sku} ($${s.price})`).join('\n');
            parts.push(`\n🆕 *${newSkus.length} New SKU(s) Detected:*\n${skuListStr}\nRun the bot-price-refresh skill to add them.`);
          }

          if (hasSignificantChanges) {
            const changeListStr = significantChanges.slice(0, 20).map(c => {
              const pct = ((c.newPrice - c.oldPrice) / c.oldPrice * 100).toFixed(1);
              const arrow = c.newPrice > c.oldPrice ? '📈' : '📉';
              return `• ${c.sku}: $${c.oldPrice} → $${c.newPrice} (${pct > 0 ? '+' : ''}${pct}%) ${arrow}`;
            }).join('\n');
            parts.push(`\n💰 *${significantChanges.length} Significant Price Change(s) (>5%):*\n${changeListStr}`);
            if (significantChanges.length > 20) {
              parts.push(`_(${significantChanges.length - 20} more not shown)_`);
            }
          }

          const text = parts.join('\n');

          // Look up Chris's DM space from KV (auto-registered on first DM)
          const chrisDmSpace = await kv.get('gchat_dm_space:chrisg@stratusinfosystems.com');
          if (chrisDmSpace) {
            await sendAsyncGChatMessage(chrisDmSpace, text, null, env);
            console.log(`[PRICE-CRON] Phase 6: Google Chat notification sent — ${newSkus.length} new SKUs, ${significantChanges.length} price changes`);
          } else {
            console.log(`[PRICE-CRON] Phase 6: No DM space cached for Chris — skipping notification. DM the bot once to register.`);
          }
        } catch (err) {
          console.error(`[PRICE-CRON] Phase 6 GChat notification error: ${err.message}`);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[PRICE-CRON] All phases complete in ${elapsed}s — prices: ${updated} updated/${priceChanges.length} changed, newSKUs: ${newSkus.length}, productIDs: ${productIdsAdded}, github: ${githubCommitted ? 'committed' : 'skipped'}`);

    } catch (err) {
      console.error(`[PRICE-CRON] Fatal error: ${err.message}`);
      // Store error state so we can debug
      await kv.put('prices_live_error', JSON.stringify({
        error: err.message,
        ts: new Date().toISOString()
      }), { expirationTtl: 86400 });
    }
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
    // argumentText strips @mention; text includes it. For DMs or un-mentioned
    // space messages (when "App can read all space messages" is enabled), they're identical.
    // Prefer argumentText (no @mention prefix) but fall back to text.
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
    // Also check for "RE:" or "FW:" patterns — always treat as email share
    // No need for an explicit command; if someone shares a subject with RE:/FW:, they want it processed
    if (!result.isGmailShare) {
      const reMatch = text.match(/(RE|FW|Fwd):\s*(.+)/i);
      if (reMatch) {
        const fullSubject = reMatch[0].trim();
        const userComment = text.replace(fullSubject, '').trim();
        result.isGmailShare = true;
        result.searchHint = fullSubject;
        result.userComment = userComment || null;
        console.log(`[GCHAT] Gmail Share detected by RE/FW pattern: subject="${fullSubject}"`);
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

    // Determine if this looks like a new customer / intake scenario
    const hasCrmCreds = !!(env.ZOHO_CLIENT_ID && env.ZOHO_REFRESH_TOKEN);
    const hasGmailCreds = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_REFRESH_TOKEN);

    // Gmail shares ALWAYS enable CRM tools when credentials are available.
    // The whole point of sharing an email to the bot is to take action on it.
    const useTools = hasCrmCreds || hasGmailCreds;

    // Build the email context with intake workflow guidance
    const defaultIntent = useTools
      ? 'The user shared this email for processing. Follow the NEW CUSTOMER EMAIL INTAKE WORKFLOW: analyze the thread for products/contact/business info, check if the account exists in Zoho, then present the intake summary for approval before creating Account → Contact → Deal → Quote → Task. If this is clearly NOT a new customer (e.g., existing customer, internal email), adapt accordingly but still offer relevant CRM actions.'
      : 'The user shared this email. Analyze it for Cisco/Meraki product mentions, customer requests, or action items. If products are found, generate quote URLs.';

    const emailContext = `## SHARED EMAIL THREAD\n${emailContent}\n\n## USER'S REQUEST\n${userIntent || defaultIntent}`;

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
