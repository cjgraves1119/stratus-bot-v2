/** Shared helpers used by both runners. */

export function summarizeToolResult(result) {
  if (result === null || result === undefined) return null;
  if (typeof result !== 'object') return String(result).slice(0, 200);
  return {
    keys: Object.keys(result),
    success: result.success,
    error: result.error || null,
    record_count:
      Array.isArray(result.data) ? result.data.length :
      Array.isArray(result.records) ? result.records.length : null,
    snippet: JSON.stringify(result).slice(0, 500)
  };
}

export function canonicalToolSequence(toolCalls) {
  return (toolCalls || []).map((tc) => ({
    name: tc.name,
    input_keys: tc.input ? Object.keys(tc.input).sort() : [],
    framework: tc.framework
  }));
}
