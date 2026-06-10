/**
 * Stratus TD Synnex Pricing Worker
 *
 * Daily cron job that pulls distributor cost pricing from TD Synnex API
 * for all hardware SKUs in the Stratus catalog. Stores results in shared
 * PRICES_KV under key 'tdsynnex_costs' so bot workers can access cost data.
 *
 * License SKUs are skipped (they're ordered through CCW, not distribution).
 *
 * KV Data Structure (tdsynnex_costs):
 * {
 *   "last_updated": "2026-04-10T11:00:00Z",
 *   "total_queried": 397,
 *   "total_found": 285,
 *   "total_with_pricing": 270,
 *   "skus": {
 *     "MR46E-HW": {
 *       "best_price": 1343.17,
 *       "msrp": 2296.02,
 *       "unit_cost": 1343.17,
 *       "unpromoted_price": 1343.17,
 *       "has_promo": false,
 *       "availability": "0",
 *       "description": "Meraki MR46E Wi-Fi 6 Indoor AP...",
 *       "material_number": "5882168",
 *       "last_seen": "2026-04-10T11:00:00Z"
 *     }
 *   }
 * }
 */

// ─── SKU list imported from shared prices.json at build time ───
import pricesData from '../../data/prices.json';

// ─── Constants ───
const KV_KEY = 'tdsynnex_costs';
const KV_KEY_HISTORY = 'tdsynnex_costs_history'; // last 7 days of summaries
const LICENSE_PREFIX = 'LIC-';

// SKUs known to not exist in TD Synnex catalog (reduces wasted API calls)
// This list auto-grows as we discover 404s and is cached in KV
const KV_KEY_SKIPLIST = 'tdsynnex_skiplist';

export default {
  /**
   * HTTP handler — exposes cost data via simple API endpoints
   * GET /              → health check
   * GET /costs         → full cost data from KV
   * GET /costs/:sku    → single SKU cost lookup
   * GET /summary       → refresh summary stats
   * POST /refresh      → trigger manual refresh (same as cron)
   */
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // Health check
    if (path === '/' || path === '/health') {
      const costs = await env.PRICES_KV.get(KV_KEY, 'json');
      return Response.json({
        status: 'ok',
        worker: 'stratus-tdsynnex-pricing',
        last_updated: costs?.last_updated || 'never',
        total_skus_tracked: costs ? Object.keys(costs.skus || {}).length : 0,
      });
    }

    // Full cost data
    if (path === '/costs') {
      const costs = await env.PRICES_KV.get(KV_KEY, 'json');
      if (!costs) return Response.json({ error: 'No cost data yet. Run /refresh first.' }, { status: 404 });
      return Response.json(costs);
    }

    // Single SKU lookup
    if (path.startsWith('/costs/')) {
      const sku = decodeURIComponent(path.replace('/costs/', '')).toUpperCase();
      const costs = await env.PRICES_KV.get(KV_KEY, 'json');
      if (!costs?.skus?.[sku]) {
        return Response.json({ error: `SKU ${sku} not found in TD Synnex cost data` }, { status: 404 });
      }
      return Response.json({ sku, ...costs.skus[sku] });
    }

    // Summary / history
    if (path === '/summary') {
      const history = await env.PRICES_KV.get(KV_KEY_HISTORY, 'json');
      return Response.json(history || { message: 'No history yet' });
    }

    // Manual refresh trigger
    if (path === '/refresh' && request.method === 'POST') {
      const result = await runPriceRefresh(env);
      return Response.json(result);
    }

    return Response.json({ error: 'Not found' }, { status: 404 });
  },

  /**
   * Cron handler — runs daily at 5:00 AM CT
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runPriceRefresh(env));
  },
};

// ─── Core refresh logic ───

async function runPriceRefresh(env) {
  const startTime = Date.now();
  const timestamp = new Date().toISOString();
  const allSkus = Object.keys(pricesData.prices || pricesData);

  // Filter out license SKUs (not in TD Synnex catalog)
  const hardwareSkus = allSkus.filter(sku => !sku.startsWith(LICENSE_PREFIX));

  // Load existing cost data to preserve historical entries
  const existingCosts = await env.PRICES_KV.get(KV_KEY, 'json') || { skus: {} };

  // Load skip list (SKUs we've confirmed don't exist in TD Synnex)
  let skipList = await env.PRICES_KV.get(KV_KEY_SKIPLIST, 'json') || {};
  // Re-check skipped SKUs every 30 days in case TD Synnex adds them
  const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const activeSkipList = {};
  for (const [sku, ts] of Object.entries(skipList)) {
    if (ts > thirtyDaysAgo) activeSkipList[sku] = ts;
  }
  skipList = activeSkipList;

  const skusToQuery = hardwareSkus.filter(sku => !skipList[sku]);

  console.log(`[TDSYNNEX-CRON] Starting refresh: ${skusToQuery.length} SKUs to query (${hardwareSkus.length - skusToQuery.length} skipped from cache)`);

  // Rate-limited sequential fetch
  const rateLimitMs = Math.ceil(1000 / (parseInt(env.RATE_LIMIT_PER_SEC) || 2));
  const results = { ...existingCosts.skus };
  let found = 0;
  let notFound = 0;
  let errors = 0;
  let priceChanges = [];
  const newSkipEntries = {};

  for (let i = 0; i < skusToQuery.length; i++) {
    const sku = skusToQuery[i];

    try {
      const data = await fetchSkuFromTdSynnex(sku, env);

      if (data && data.length > 0) {
        // Pick the best result: prefer CISCO SYSTEMS with pricing
        const best = pickBestResult(data);

        if (best) {
          const oldPrice = results[sku]?.best_price;
          const newPrice = parseFloat(best.BestPrice) || null;

          // Track price changes
          if (oldPrice && newPrice && oldPrice !== newPrice) {
            priceChanges.push({
              sku,
              old_price: oldPrice,
              new_price: newPrice,
              change_pct: ((newPrice - oldPrice) / oldPrice * 100).toFixed(1),
            });
          }

          results[sku] = {
            best_price: newPrice,
            msrp: parseFloat(best.MSRP) || null,
            unit_cost: parseFloat(best.UnitCost) || null,
            unpromoted_price: parseFloat(best.UnpromotedPrice) || null,
            has_promo: best.HasPromotion === true,
            promo_expiration: best.PromoExpirationDate || null,
            availability: best.CorporateAvailability || '0',
            description: best.Description || '',
            material_number: best.MaterialNumber || '',
            manufacturer: best.ManufacturerName || '',
            last_seen: timestamp,
          };
          found++;
        } else {
          notFound++;
          newSkipEntries[sku] = Date.now();
        }
      } else {
        notFound++;
        newSkipEntries[sku] = Date.now();
      }
    } catch (err) {
      console.error(`[TDSYNNEX-CRON] Error fetching ${sku}: ${err.message}`);
      errors++;
    }

    // Rate limit (skip delay on last item)
    if (i < skusToQuery.length - 1) {
      await sleep(rateLimitMs);
    }

    // Progress log every 50 SKUs
    if ((i + 1) % 50 === 0) {
      console.log(`[TDSYNNEX-CRON] Progress: ${i + 1}/${skusToQuery.length} (found: ${found}, notFound: ${notFound}, errors: ${errors})`);
    }
  }

  // Build final cost data object
  const costData = {
    last_updated: timestamp,
    total_queried: skusToQuery.length,
    total_found: found,
    total_not_found: notFound,
    total_errors: errors,
    total_with_pricing: Object.values(results).filter(r => r.best_price !== null).length,
    total_skus_tracked: Object.keys(results).length,
    price_changes: priceChanges.length,
    duration_ms: Date.now() - startTime,
    skus: results,
  };

  // Write cost data to KV
  await env.PRICES_KV.put(KV_KEY, JSON.stringify(costData));

  // Update skip list with new 404 entries
  const mergedSkipList = { ...skipList, ...newSkipEntries };
  await env.PRICES_KV.put(KV_KEY_SKIPLIST, JSON.stringify(mergedSkipList));

  // Update history (keep last 7 entries)
  const history = await env.PRICES_KV.get(KV_KEY_HISTORY, 'json') || { entries: [] };
  history.entries.unshift({
    timestamp,
    queried: skusToQuery.length,
    found,
    not_found: notFound,
    errors,
    price_changes: priceChanges.length,
    duration_ms: Date.now() - startTime,
  });
  history.entries = history.entries.slice(0, 7); // Keep 7 days
  await env.PRICES_KV.put(KV_KEY_HISTORY, JSON.stringify(history));

  // Log price changes to D1 if any
  if (priceChanges.length > 0 && env.ANALYTICS_DB) {
    try {
      await logPriceChangesToD1(env, priceChanges, timestamp);
    } catch (err) {
      console.error(`[TDSYNNEX-CRON] D1 logging failed: ${err.message}`);
    }
  }

  const summary = {
    status: 'complete',
    timestamp,
    queried: skusToQuery.length,
    found,
    not_found: notFound,
    errors,
    price_changes: priceChanges,
    duration_ms: Date.now() - startTime,
    skip_list_size: Object.keys(mergedSkipList).length,
  };

  console.log(`[TDSYNNEX-CRON] Complete: ${JSON.stringify({ ...summary, price_changes: priceChanges.length })}`);
  return summary;
}

// ─── TD Synnex API call ───

async function fetchSkuFromTdSynnex(sku, env) {
  const baseUrl = env.TDSYNNEX_API_BASE || 'https://ws.us.tdsynnex.com/webservice/ltd/api';
  const qualifier = env.QUALIFIER || 'MG';
  const authToken = env.TDSYNNEX_AUTH_TOKEN;

  const url = `${baseUrl}/products?qualifier=${qualifier}&partNumbers=${encodeURIComponent(sku)}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': authToken,
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const data = await response.json();

  // API returns { Message: "Unable to get product information..." } for not-found SKUs
  if (data.Message) return null;

  // Should be an array of results
  return Array.isArray(data) ? data : null;
}

// ─── Pick best result from multiple TD Synnex entries ───

function pickBestResult(results) {
  // Filter to only results with pricing we can see
  const withPricing = results.filter(r =>
    r.CustomerCanSeePricing !== false &&
    !r.ErrorMessage &&
    (r.BestPrice || r.MSRP || r.UnitCost)
  );

  if (withPricing.length === 0) return null;

  // Prefer "CISCO SYSTEMS" manufacturer over "COP PARTS" or others
  const cisco = withPricing.filter(r =>
    r.ManufacturerName?.toUpperCase().includes('CISCO')
  );

  // Among matching results, prefer ones with BestPrice set
  const candidates = cisco.length > 0 ? cisco : withPricing;
  const withBestPrice = candidates.filter(r => r.BestPrice);

  return withBestPrice[0] || candidates[0];
}

// ─── D1 logging for price changes ───

async function logPriceChangesToD1(env, changes, timestamp) {
  // Create table if it doesn't exist
  await env.ANALYTICS_DB.prepare(`
    CREATE TABLE IF NOT EXISTS tdsynnex_price_changes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT NOT NULL,
      old_price REAL,
      new_price REAL,
      change_pct REAL,
      recorded_at TEXT NOT NULL
    )
  `).run();

  // Batch insert price changes
  const stmt = env.ANALYTICS_DB.prepare(
    'INSERT INTO tdsynnex_price_changes (sku, old_price, new_price, change_pct, recorded_at) VALUES (?, ?, ?, ?, ?)'
  );

  const batch = changes.map(c =>
    stmt.bind(c.sku, c.old_price, c.new_price, parseFloat(c.change_pct), timestamp)
  );

  await env.ANALYTICS_DB.batch(batch);
  console.log(`[TDSYNNEX-CRON] Logged ${changes.length} price changes to D1`);
}

// ─── Helpers ───

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
