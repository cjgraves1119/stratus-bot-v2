/**
 * Quote-option selection is index-based on purpose. Two reviewed alternatives
 * may resolve to the same order URL while carrying different option-group or
 * term semantics. Treating the URL as the checkbox identity selected every
 * duplicate at once and could send more Zoho actions than the rep chose.
 */
export function normalizeQuoteOptionIndexes(indexes, optionCount) {
  const count = Number.isInteger(optionCount) && optionCount >= 0 ? optionCount : 0;
  return [...new Set((Array.isArray(indexes) ? indexes : [])
    .filter((index) => Number.isInteger(index) && index >= 0 && index < count))];
}

export function selectQuoteOptionIndex(indexes, index, optionCount, { exclusive = false } = {}) {
  const current = normalizeQuoteOptionIndexes(indexes, optionCount);
  if (!Number.isInteger(index) || index < 0 || index >= optionCount) return current;
  if (exclusive) return [index];
  return current.includes(index) ? current : [...current, index];
}

export function toggleQuoteOptionIndex(indexes, index, optionCount) {
  const current = normalizeQuoteOptionIndexes(indexes, optionCount);
  if (!Number.isInteger(index) || index < 0 || index >= optionCount) return current;
  return current.includes(index)
    ? current.filter((selected) => selected !== index)
    : [...current, index];
}

/**
 * Rebase reviewed indexes after unsafe quote options have been removed.
 *
 * URL equality is deliberately irrelevant: a renewal and EOL refresh may
 * resolve to the same cart while carrying different reviewed semantics. The
 * caller supplies the original index retained by each safe option so the
 * downstream one-shot handoff cannot silently collapse one into the other.
 */
export function rebaseQuoteOptionIndexes(selectedSourceIndexes, safeSourceIndexes) {
  const safeMap = new Map();
  for (const [safeIndex, sourceIndex] of (Array.isArray(safeSourceIndexes) ? safeSourceIndexes : []).entries()) {
    if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && !safeMap.has(sourceIndex)) {
      safeMap.set(sourceIndex, safeIndex);
    }
  }
  return [...new Set((Array.isArray(selectedSourceIndexes) ? selectedSourceIndexes : [])
    .filter((sourceIndex) => Number.isInteger(sourceIndex) && sourceIndex >= 0)
    .map((sourceIndex) => safeMap.get(sourceIndex))
    .filter((safeIndex) => Number.isInteger(safeIndex) && safeIndex >= 0))];
}
