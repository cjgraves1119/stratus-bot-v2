/**
 * Spoken English plurals on Meraki model tokens ("2 MR46s", "MX450s")
 * must collapse to the catalog model. Real S-suffix SKUs stay intact.
 *
 * Catalog models that legitimately end in S (Catalyst SFP switches, etc.)
 * are never stripped. Family-only matches are not enough to strip.
 */

const CATALYST_S_PORT = /-\d+S(?:-M)?$/i;
const SIMPLE_SPOKEN_PLURAL = /^(?:MR|MX|MV|MT|MG|Z)\d+[A-Z]?S$/i;
const MS_SPOKEN_PLURAL = /^MS\d{2,3}(?:-[A-Z0-9]+)*S$/i;
const REAL_S_SUFFIX_SKUS = new Set([
  'C9300-24S',
  'C9300-48S',
  'C9300-24S-M',
  'C9300-48S-M',
  'C9300L-24S',
  'C9300L-48S',
  'C9300L-24S-M',
  'C9300L-48S-M',
]);

export function isRealSSuffixSku(sku) {
  const upper = String(sku || '').trim().toUpperCase();
  return REAL_S_SUFFIX_SKUS.has(upper) || CATALYST_S_PORT.test(upper);
}

export function looksLikeEnglishPluralSku(sku) {
  const upper = String(sku || '').trim().toUpperCase();
  if (!upper.endsWith('S') || upper.length <= 3) return false;
  if (isRealSSuffixSku(upper)) return false;
  return SIMPLE_SPOKEN_PLURAL.test(upper) || (MS_SPOKEN_PLURAL.test(upper) && !/-\d+S$/i.test(upper));
}

/**
 * @param {string} sku
 * @param {(candidate: string) => boolean} [isKnownSku]
 */
export function canonicalizeSpokenSku(sku, isKnownSku = () => false) {
  const upper = String(sku || '').trim().toUpperCase();
  if (!upper) return '';
  if (isKnownSku(upper) || isRealSSuffixSku(upper)) return upper;
  if (!looksLikeEnglishPluralSku(upper)) return upper;
  const stripped = upper.slice(0, -1);
  if (isKnownSku(stripped) || /^(?:MR|MX|MV|MT|MG|Z)\d+[A-Z]?$/i.test(stripped)) {
    return stripped;
  }
  return upper;
}

function rowSku(row) {
  return String(row?.baseSku || row?.sku || '').trim().toUpperCase();
}

/**
 * Collapse spoken-plural leftovers (MR46S next to MR46) into the real model.
 * Real S-suffix SKUs are kept as their own rows.
 */
export function collapseSpokenPluralRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const known = new Set(list.map(rowSku).filter(Boolean));
  const isKnown = (candidate) => known.has(candidate) && !looksLikeEnglishPluralSku(candidate);
  const out = [];
  const indexBySku = new Map();
  for (const row of list) {
    const raw = rowSku(row);
    if (!raw) continue;
    const sku = canonicalizeSpokenSku(raw, isKnown);
    if (indexBySku.has(sku)) {
      const existing = out[indexBySku.get(sku)];
      existing.qty = (Number(existing.qty) || 1) + (Number(row?.qty) || 1);
      continue;
    }
    indexBySku.set(sku, out.length);
    const next = { ...row, qty: Number(row?.qty) || 1 };
    if (Object.prototype.hasOwnProperty.call(row, 'baseSku')) next.baseSku = sku;
    if (Object.prototype.hasOwnProperty.call(row, 'sku')) next.sku = sku;
    if (!next.baseSku && !next.sku) next.baseSku = sku;
    out.push(next);
  }
  return out;
}

export function dropSpokenPluralSuggestionRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const committed = new Set(
    list
      .filter((row) => row?.unresolved !== true)
      .map(rowSku)
      .filter(Boolean),
  );
  return list.filter((row) => {
    const sku = rowSku(row);
    if (row?.unresolved !== true) return true;
    if (!looksLikeEnglishPluralSku(sku)) return true;
    return !committed.has(canonicalizeSpokenSku(sku, (candidate) => committed.has(candidate)));
  });
}
