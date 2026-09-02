/**
 * Extension-side Commerce Bot lead-time request.
 * Talks only to the existing Stratus gateway with X-API-Key.
 * Hardware SKUs only (`-HW` where the product uses it). Never LIC- / non-HW.
 */

import { parseStratusOrderUrl } from './zoho-url.js';

export const LEAD_TIME_GATEWAY_PATH = '/api/lead-time';

const USES_HW_SUFFIX = /^(?:MR|MV|MT|MG|Z)\d/i;
const MS_USES_HW = /^(?:MS130|MS390)/i;
const MX_USES_HW = /^MX\d/i;
const NEVER_HW = /^(?:LIC-|MS150|MS450|C9|C8|MA-)/i;

function upperSku(value) {
  return String(value || '').trim().toUpperCase();
}

export function usesHardwareSuffix(sku) {
  const upper = upperSku(sku);
  if (!upper || NEVER_HW.test(upper) || upper.startsWith('LIC-')) return false;
  if (upper.endsWith('-HW') || /-(?:HW)-(?:NA|WW)$/.test(upper)) return true;
  if (USES_HW_SUFFIX.test(upper) && !/^Z\d+C?X$/i.test(upper)) return true;
  if (MS_USES_HW.test(upper)) return true;
  if (MX_USES_HW.test(upper)) return true;
  return false;
}

/** Map a cart/editor SKU to the gateway `-HW` form, or null if it must not be sent. */
export function toLeadTimeHardwareSku(sku) {
  const upper = upperSku(sku);
  if (!upper || upper.startsWith('LIC-')) return null;
  if (NEVER_HW.test(upper) && !upper.endsWith('-HW')) return null;
  if (upper.endsWith('-HW') || /-(?:HW)-(?:NA|WW)$/.test(upper)) return upper;
  if (!usesHardwareSuffix(upper)) return null;
  if (/^MX\d+C[W]?$/i.test(upper)) return `${upper}-HW-NA`;
  return `${upper.replace(/-(?:NA|WW)$/, '')}-HW`;
}

export function collectLeadTimeHardwareSkus(values) {
  const seen = new Set();
  const skus = [];
  const push = (raw) => {
    const sku = toLeadTimeHardwareSku(raw);
    if (!sku || seen.has(sku)) return;
    seen.add(sku);
    skus.push(sku);
  };

  if (Array.isArray(values)) {
    for (const item of values) {
      if (typeof item === 'string') push(item);
      else push(item?.sku || item?.baseSku);
    }
    return skus;
  }

  const input = values && typeof values === 'object' ? values : {};
  if (Array.isArray(input.skus)) {
    for (const item of input.skus) push(item);
  }
  if (Array.isArray(input.rows)) {
    const selected = Array.isArray(input.selectedIndexes) ? new Set(input.selectedIndexes) : null;
    input.rows.forEach((row, index) => {
      if (selected && !selected.has(index)) return;
      push(row?.sku || row?.baseSku);
    });
  }
  if (input.orderUrl) {
    for (const item of parseStratusOrderUrl(input.orderUrl)) push(item.sku);
  }
  return skus;
}

export function buildLeadTimePayload(skus) {
  const hardware = collectLeadTimeHardwareSkus(skus);
  if (!hardware.length) {
    return { ok: false, skus: [], error: 'Select at least one hardware SKU. License SKUs are never sent.' };
  }
  return {
    ok: true,
    skus: hardware,
    text: `lead time of ${hardware.join(',')}`,
    error: '',
  };
}

/**
 * POST /api/lead-time on the existing gateway. Inject fetch for tests.
 * Never talks to Webex or Composio from the extension.
 */
export async function requestLeadTimes({
  apiBase,
  apiKey,
  skus,
  rows,
  selectedIndexes,
  orderUrl,
  fetch: fetchFn = globalThis.fetch,
} = {}) {
  const payload = buildLeadTimePayload(skus || { rows, selectedIndexes, orderUrl });
  if (!payload.ok) return { ok: false, error: payload.error, status: 0 };

  const base = String(apiBase || '').replace(/\/$/, '');
  if (!base) return { ok: false, error: 'Gateway URL is not configured.', status: 0 };
  if (!apiKey) return { ok: false, error: 'API key is not configured.', status: 0 };

  let response;
  try {
    response = await fetchFn(`${base}${LEAD_TIME_GATEWAY_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey,
      },
      body: JSON.stringify({ skus: payload.skus }),
    });
  } catch (error) {
    return { ok: false, error: error?.message || 'Lead-time request failed.', status: 0 };
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  return {
    ok: response.ok === true && data?.ok === true,
    status: response.status,
    sent: data?.sent === true,
    dryRun: data?.dryRun === true,
    text: data?.text || payload.text,
    skuCount: data?.skuCount ?? payload.skus.length,
    skus: payload.skus,
    error: data?.error || (response.ok ? '' : `Gateway returned ${response.status}`),
    result: data,
  };
}

export function formatLeadTimeResult(result) {
  if (!result) return '';
  if (result.ok === false) return result.error || 'Lead-time request failed.';
  const mode = result.dryRun ? 'dry-run (not sent)' : (result.sent ? 'submitted' : 'accepted');
  return `Lead time ${mode}: ${result.text || ''}`.trim();
}
