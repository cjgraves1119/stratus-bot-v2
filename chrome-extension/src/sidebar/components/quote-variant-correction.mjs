/**
 * Safe, card-local hardware variant corrections.
 *
 * A phrase such as "change the 4G to the 4X" is meaningful only against the
 * rows already being reviewed.  It must never make a bare "4x" quantity look
 * like a model suffix, so this module intentionally requires a directional
 * source-to-target token pair before it mutates a cart.
 */

const EDIT_VERB = /\b(?:change|update|replace|swap|switch|convert|correct|make|set)\b/i;
const DIRECTIONAL_VARIANT = /\b(\d{1,2}[GX])\b\s*(?:to|into|→|->)\s*(?:the\s+)?\b(\d{1,2}[GX])\b/i;
const TARGET_ONLY_VARIANT = /\b(?:change|update|replace|swap|switch|convert|correct|make|set)\b[\s\S]{0,72}\b(?:to|into)\s+(?:the\s+)?(\d{1,2}X)\b/i;
const PRONOUN_VARIANT = /\b(?:change|update|replace|swap|switch|convert|correct|make|set)\s+(?:it|this|that)\s+(?:to\s+)?(?:the\s+)?(\d{1,2}X)\b/i;

function canonicalSku(value) {
  return String(value || '').trim().toUpperCase();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function variantSegmentRegex(token) {
  return new RegExp(`-${escapeRegex(token)}(?=-|$)`, 'i');
}

function activeSkuSet(activeSkus) {
  return activeSkus instanceof Set
    ? activeSkus
    : new Set(Array.from(activeSkus || [], canonicalSku));
}

function quotedQuantity(text) {
  const match = String(text || '').match(/\b(?:quantity|qty)\s*(?:to|=)?\s*(\d{1,5})\b/i);
  if (!match) return null;
  const qty = Number(match[1]);
  return Number.isInteger(qty) && qty >= 1 && qty <= 99999 ? qty : null;
}

function replaceVariantToken(sku, sourceToken, targetToken) {
  return canonicalSku(sku).replace(variantSegmentRegex(sourceToken), `-${targetToken}`);
}

function rowSku(row) {
  return canonicalSku(row?.sku || row?.typedSku);
}

function clarification(message, rows, candidates = []) {
  return {
    kind: 'clarify',
    rows: Array.isArray(rows) ? rows : [],
    candidates,
    message,
  };
}

/**
 * Resolve a directional 4G/4X-style variant correction against reviewed rows.
 *
 * Return values:
 * - apply: a complete replacement row set suitable for rebuildQuoteMessage
 * - clarify: a UI-safe explanation; the input rows are unchanged
 * - no-match: ordinary chat / quantity parsing should continue unchanged
 */
export function resolveQuoteVariantCorrection(rows, text, { activeSkus = [] } = {}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const request = String(text || '').trim();
  if (!request || !EDIT_VERB.test(request)) return { kind: 'no-match', rows: rowList };

  const catalog = activeSkuSet(activeSkus);
  const directional = request.match(DIRECTIONAL_VARIANT);
  if (!directional) {
    // "change to 4X" has two plausible readings: a port/uplink variant or a
    // quantity entered as "4x". Never choose for the rep, even if a card has
    // one apparent 4G candidate.
    const targetOnly = request.match(TARGET_ONLY_VARIANT) || request.match(PRONOUN_VARIANT);
    if (!targetOnly) return { kind: 'no-match', rows: rowList };
    const targetToken = canonicalSku(targetOnly[1]);
    const possible = rowList
      .map((row, index) => ({ row, index, sku: rowSku(row) }))
      .filter(({ sku }) => /-\d{1,2}G(?=-|$)/i.test(sku))
      .map(({ row, index, sku }) => ({
        row,
        index,
        sourceSku: sku,
        targetSku: sku.replace(/-(\d{1,2})G(?=-|$)/i, `-${targetToken}`),
      }))
      .filter(({ targetSku }) => catalog.has(targetSku));
    if (!possible.length) return { kind: 'no-match', rows: rowList };
    if (possible.length === 1) {
      const candidate = possible[0];
      return clarification(
        `I found ${candidate.sourceSku}. Did you mean replace it with ${candidate.targetSku} (keeping quantity ${Number(candidate.row?.qty) || 1}), or set a quantity of 4? The quote is unchanged.`,
        rowList,
        [candidate],
      );
    }
    return clarification(
      `I found multiple active 4G-to-4X SKU changes. Enter the full SKU you want to replace so I do not change the wrong quote row.`,
      rowList,
      possible,
    );
  }

  const sourceToken = canonicalSku(directional[1]);
  const targetToken = canonicalSku(directional[2]);
  const sourceMatch = sourceToken.match(/^(\d{1,2})([GX])$/);
  const targetMatch = targetToken.match(/^(\d{1,2})([GX])$/);
  if (!sourceMatch || !targetMatch || sourceMatch[1] !== targetMatch[1] || sourceToken === targetToken) {
    return clarification(
      'I could not verify that this is a safe hardware-variant change. Enter the full source and replacement SKU; the quote is unchanged.',
      rowList,
    );
  }

  const matchingRows = rowList
    .map((row, index) => ({ row, index, sourceSku: rowSku(row) }))
    .filter(({ sourceSku }) => variantSegmentRegex(sourceToken).test(sourceSku));
  if (matchingRows.length !== 1) {
    return clarification(
      matchingRows.length
        ? `I found ${matchingRows.length} quote rows with ${sourceToken}. Enter the full source SKU so I do not change more than one row.`
        : `I could not find a current quote row with ${sourceToken}. The quote is unchanged.`,
      rowList,
      matchingRows,
    );
  }

  const match = matchingRows[0];
  const targetSku = replaceVariantToken(match.sourceSku, sourceToken, targetToken);
  if (!catalog.has(targetSku)) {
    return clarification(
      `${targetSku} is not an active catalog SKU, so I left ${match.sourceSku} unchanged. Select a catalog product or enter the full replacement SKU.`,
      rowList,
      [{ ...match, targetSku }],
    );
  }

  const quantity = quotedQuantity(request);
  const nextRows = rowList.map((row, index) => {
    if (index !== match.index) return row;
    const next = {
      ...row,
      sku: targetSku,
      unresolved: false,
      ...(quantity ? { qty: quantity } : {}),
    };
    if (row?.typedSku) next.typedSku = targetSku;
    if (row?.resolvedSku) next.resolvedSku = targetSku;
    return next;
  });
  return {
    kind: 'apply',
    rows: nextRows,
    sourceSku: match.sourceSku,
    targetSku,
    quantity: quantity || Number(match.row?.qty) || 1,
    message: `${match.sourceSku} was replaced with ${targetSku}.`,
  };
}
