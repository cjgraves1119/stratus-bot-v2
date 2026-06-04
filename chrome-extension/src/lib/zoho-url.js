/**
 * Stratus AI — Shared Zoho URL parser.
 *
 * The active Zoho tab URL is the authoritative source of truth for
 * "what record is the user currently viewing". All three surfaces
 * (Zoho content script, background service worker, sidebar) parse
 * the URL with these helpers so they can agree on the answer.
 *
 * This module is imported by:
 *   - src/content/zoho-content.js (Zoho page content script)
 *   - src/background/index.js (service worker)
 *   - src/sidebar/App.jsx (header pill + initial context)
 *   - src/sidebar/panels/ChatPanel.jsx (pre-send validation)
 */

/**
 * Tab-name segment in the URL → API module name.
 * Zoho's URL uses tab names which differ from the API module names
 * for a few modules (Potentials → Deals, SalesOrders → Sales_Orders).
 */
export const ZOHO_TAB_TO_MODULE = {
  Accounts: 'Accounts',
  Contacts: 'Contacts',
  Potentials: 'Deals',
  Deals: 'Deals',
  Quotes: 'Quotes',
  SalesOrders: 'Sales_Orders',
  Invoices: 'Invoices',
  Leads: 'Leads',
  Tasks: 'Tasks',
};

/**
 * Parse a Zoho CRM URL.
 *
 * @param {string} url
 * @returns {
 *   null
 *   | { isZoho: true, isRecord: true,  module: string, recordId: string, tabName: string, url: string }
 *   | { isZoho: true, isRecord: false, module: null,   recordId: null,   tabName: string|null, url: string }
 * }
 *   - `null` if not a Zoho CRM URL at all.
 *   - `isRecord:true` when on `/tab/<Name>/<id>` — record detail page.
 *   - `isRecord:false` when on a Zoho page without a record id (list view,
 *     dashboard, etc.). Still useful: it proves the user is on Zoho.
 */
export function parseZohoRecordUrl(url) {
  if (typeof url !== 'string' || !url) return null;
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.hostname !== 'crm.zoho.com') return null;

  // Record detail: /crm/<org>/tab/<TabName>/<recordId>
  const recMatch = u.pathname.match(/\/crm\/[^/]+\/tab\/([^/]+)\/(\d{10,25})/);
  if (recMatch) {
    const tabName = recMatch[1];
    const recordId = recMatch[2];
    const module = ZOHO_TAB_TO_MODULE[tabName] || tabName;
    return { isZoho: true, isRecord: true, module, recordId, tabName, url };
  }

  // Non-record Zoho page (list/dashboard/settings/etc.)
  const tabOnly = u.pathname.match(/\/crm\/[^/]+\/tab\/([^/]+)/);
  return {
    isZoho: true,
    isRecord: false,
    module: null,
    recordId: null,
    tabName: tabOnly ? tabOnly[1] : null,
    url,
  };
}

/**
 * Convenience wrapper — returns `true` iff the URL is any Zoho CRM URL.
 */
export function isZohoUrl(url) {
  const parsed = parseZohoRecordUrl(url);
  return !!(parsed && parsed.isZoho);
}

/**
 * Does `ctx` describe the SAME active record as `urlInfo`?
 *
 * Used by the background + sidebar to decide whether a cached /
 * stored zohoPageContext is still valid for the currently active
 * tab, or whether it's stale (user navigated in the Zoho SPA but
 * storage hasn't caught up yet) and must be discarded.
 */
export function contextMatchesUrl(ctx, urlInfo) {
  if (!ctx || !urlInfo || !urlInfo.isRecord) return false;
  if (!ctx.recordId || !ctx.module) return false;
  return String(ctx.recordId) === String(urlInfo.recordId)
      && String(ctx.module)   === String(urlInfo.module);
}

/**
 * Parse a Stratus order URL into its line items.
 *
 * Stratus quote URLs look like:
 *   https://stratusinfosystems.com/order/?item=SKU1,SKU2&qty=1,2
 *
 * The `item` param is a comma-separated list of SKUs and `qty` is the
 * positionally-matched comma-separated list of quantities. This helper is the
 * inverse of the URL builder used throughout the quote panel, so a quote that
 * was produced as a URL (screenshot / Claude fallback path, where
 * `result.parsed` is empty) can be re-expanded into `{sku, qty}` pairs for the
 * "Send to Zoho" handoff.
 *
 * Robustness:
 *   - Accepts a full URL or a bare query string.
 *   - decodeURIComponent on each token (SKUs are URL-encoded in the link).
 *   - Tolerates missing/short qty list (defaults qty to 1).
 *   - Skips empty SKU tokens.
 *   - Never throws — returns [] on anything unparseable.
 *
 * @param {string} url
 * @returns {Array<{sku: string, qty: number}>}
 */
export function parseStratusOrderUrl(url) {
  if (typeof url !== 'string' || !url) return [];

  let itemParam = null;
  let qtyParam = null;

  // Primary: parse as a proper URL and read search params.
  try {
    const u = new URL(url);
    itemParam = u.searchParams.get('item');
    qtyParam = u.searchParams.get('qty');
  } catch {
    // Fallback: maybe we were handed a bare query string ("item=...&qty=...")
    // or a relative URL. Pull the params out by hand.
    try {
      const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : url;
      const params = new URLSearchParams(qs);
      itemParam = params.get('item');
      qtyParam = params.get('qty');
    } catch {
      return [];
    }
  }

  if (!itemParam) return [];

  const decode = (s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  };

  const skus = decode(itemParam).split(',').map((s) => s.trim());
  const qtys = (qtyParam ? decode(qtyParam) : '').split(',').map((s) => s.trim());

  const items = [];
  for (let i = 0; i < skus.length; i++) {
    const sku = skus[i];
    if (!sku) continue;
    const rawQty = parseInt(qtys[i], 10);
    const qty = Number.isFinite(rawQty) && rawQty > 0 ? rawQty : 1;
    items.push({ sku, qty });
  }
  return items;
}

/**
 * Build a minimal context object from just the URL, so we always
 * have *something* useful to publish immediately on SPA navigation
 * while DOM enrichment (record name, email, account name) is still
 * pending. Prevents the "brief window of stale record" bug.
 */
export function minimalContextFromUrl(urlInfo) {
  if (!urlInfo || !urlInfo.isZoho) return null;
  if (!urlInfo.isRecord) {
    return {
      type: 'zoho',
      page: 'list',
      module: null,
      recordId: null,
      tabName: urlInfo.tabName || null,
      url: urlInfo.url,
      detectedAt: Date.now(),
    };
  }
  return {
    type: 'zoho',
    page: 'record',
    module: urlInfo.module,
    recordId: urlInfo.recordId,
    tabName: urlInfo.tabName,
    url: urlInfo.url,
    detectedAt: Date.now(),
    // Populated by the DOM-enrichment pass in the content script:
    recordName: null,
    email: null,
    accountName: null,
    website: null,
  };
}
