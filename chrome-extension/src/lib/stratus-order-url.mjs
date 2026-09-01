const STRATUS_ORDER_HOSTS = new Set(['stratusinfosystems.com', 'www.stratusinfosystems.com']);
const MAX_UNWRAP_DEPTH = 4;

function decodeSafely(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch (_) {
    return String(value || '');
  }
}

function exactStratusOrderUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:'
        || !STRATUS_ORDER_HOSTS.has(url.hostname.toLowerCase())
        || url.pathname !== '/order/'
        || url.username || url.password || url.port || url.hash
        || url.searchParams.getAll('item').length !== 1
        || url.searchParams.getAll('qty').length !== 1) return '';
    return url.toString();
  } catch (_) {
    return '';
  }
}

/**
 * Extract one exact Stratus cart from a Gmail anchor or visible text.
 *
 * Gmail and Google Safe Browsing commonly wrap a real cart in a `q=`, `url=`,
 * or `continue=` redirect. Decode and follow only a short, bounded chain; the
 * returned URL still has to be the exact HTTPS order endpoint with one item and
 * qty parameter, so this helper never turns an arbitrary redirect into quote
 * input.  It deliberately preserves the cart's query text/quantities for the
 * Worker rather than attempting to parse individual SKU names in the DOM.
 */
export function extractExactStratusOrderUrl(raw) {
  const pending = [{ value: String(raw || '').replace(/&amp;/gi, '&'), depth: 0 }];
  const seen = new Set();

  while (pending.length) {
    const { value: current, depth } = pending.shift();
    if (depth >= MAX_UNWRAP_DEPTH) continue;
    if (!current || seen.has(current)) continue;
    seen.add(current);

    const exact = exactStratusOrderUrl(current);
    if (exact) return exact;

    const decoded = decodeSafely(current);
    if (decoded !== current) pending.push({ value: decoded, depth: depth + 1 });

    try {
      const redirect = new URL(current);
      for (const key of ['q', 'url', 'continue', 'redirect']) {
        for (const value of redirect.searchParams.getAll(key)) {
          if (value) pending.push({ value, depth: depth + 1 });
        }
      }
    } catch (_) { /* A visible text fragment may not itself be a URL. */ }

    const embedded = decoded.match(/https?:\/\/[^\s)\]>"']*stratusinfosystems\.com\/order\/\?[^\s)\]>"']+/i);
    if (embedded?.[0]) pending.push({ value: embedded[0], depth: depth + 1 });
  }
  return '';
}
