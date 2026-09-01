const SAFE_SKU = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/;
const MAX_PRODUCT_RESULTS = 10;

export function normalizeProductSearchQuery(value) {
  const query = String(value || '').trim().replace(/\s+/g, ' ');
  if (query.length < 2) {
    return { ok: false, query: '', error: 'Enter at least two characters to search products.' };
  }
  if (query.length > 80 || /[\u0000-\u001f\u007f]/.test(query)) {
    return { ok: false, query: '', error: 'Product search text must be 2-80 printable characters.' };
  }
  return { ok: true, query, error: '' };
}

function boundedProductName(value, fallback) {
  const name = String(value || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 160 || /[\u0000-\u001f\u007f]/.test(name)) return fallback;
  return name;
}

function safeProductSource(value) {
  const source = String(value || '').trim().toLowerCase();
  if (source === 'zoho') return 'zoho';
  if (source === 'cache') return 'cache';
  return 'catalog';
}

function safeProductAvailability(value, source) {
  const availability = String(value || '').trim().toLowerCase();
  if (availability === 'ecomm' || availability === 'zoho_only') return availability;
  // Catalog/cache rows are, by definition, represented by the eCommerce
  // catalog. A live Zoho row without an explicit classification stays unknown
  // so the UI cannot silently claim it is storefront-ready.
  return source === 'catalog' || source === 'cache' ? 'ecomm' : 'unknown';
}

/**
 * Strip a Worker product-search response to the read-only fields the editor
 * needs. Product IDs, prices, costs, margins, arbitrary CRM fields, and
 * inactive products never cross this boundary. Exact SKU authority remains
 * the subsequent /api/quote rebuild or signed one-shot plan.
 */
export function sanitizeProductSearchResponse(payload, requestedQuery) {
  const normalizedQuery = normalizeProductSearchQuery(requestedQuery);
  if (!normalizedQuery.ok) {
    return { ok: false, query: '', results: [], live: false, error: normalizedQuery.error };
  }
  if (!payload || typeof payload !== 'object' || payload.success === false || payload.ok === false) {
    return { ok: false, query: normalizedQuery.query, results: [], live: false, error: 'Product search was unavailable.' };
  }
  const candidates = Array.isArray(payload.results) ? payload.results : null;
  if (!candidates) {
    return { ok: false, query: normalizedQuery.query, results: [], live: false, error: 'Product search returned an invalid response.' };
  }

  const results = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const sku = String(candidate.sku || '').trim().toUpperCase();
    if (!SAFE_SKU.test(sku) || candidate.active !== true || seen.has(sku)) continue;
    seen.add(sku);
    const source = safeProductSource(candidate.source);
    results.push({
      sku,
      name: boundedProductName(candidate.name, sku),
      active: true,
      source,
      availability: safeProductAvailability(candidate.availability, source),
    });
    if (results.length >= MAX_PRODUCT_RESULTS) break;
  }
  return { ok: true, query: normalizedQuery.query, results, live: payload.live === true, error: '' };
}

/**
 * In-memory newest-request guard for debounced autocomplete. It retains one
 * opaque token only; no query, results, or draft state is persisted.
 */
export function createLatestRequestGuard() {
  let latest = null;
  return Object.freeze({
    begin() {
      const token = Object.freeze({});
      latest = token;
      return token;
    },
    isLatest(token) {
      return token != null && token === latest;
    },
    invalidate() {
      latest = null;
    },
  });
}
