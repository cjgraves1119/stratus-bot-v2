/**
 * Deterministic quote client — shared by the Chat panel.
 *
 * Wraps the worker /api/quote engine (the SAME deterministic handler chain the
 * Webex and GChat bots use: EOL dates → confirmations → pricing → SKU quotes →
 * Claude fallback) plus the screenshot/dashboard vision path
 * (/api/parse-dashboard). Ported out of the old Quote tab (QuotePanel) when
 * quoting was consolidated into Chat (2026-06-17). React-free so any panel can
 * call it.
 *
 * The synthetic MR-ENT token ("MR Enterprise licenses" — not a catalog SKU)
 * needs special handling: it is stripped from the engine input (otherwise
 * parseMessage's agnostic-family short-circuit drops the hardware SKUs) and the
 * three LIC-ENT-{1,3,5}YR co-term URLs are appended to the result afterward.
 */

import { sendToBackground } from './messaging';
import { MSG } from './constants';
import { parseStratusOrderUrl } from './zoho-url.js';

const ORDER_BASE = 'https://stratusinfosystems.com/order/';

export function buildOrderUrl(sku, qty) {
  return `${ORDER_BASE}?item=${encodeURIComponent(sku)}&qty=${qty}`;
}

function toUrlObj(u) {
  return (u && typeof u === 'object') ? u : { url: String(u), label: 'Quote' };
}

// MR-ENT only (no hardware) — labels mirror the engine's co-term option labels.
function mrOnlyUrls(qty) {
  return [
    { url: buildOrderUrl('LIC-ENT-1YR', qty), label: '1-Year Co-Term' },
    { url: buildOrderUrl('LIC-ENT-3YR', qty), label: '3-Year Co-Term' },
    { url: buildOrderUrl('LIC-ENT-5YR', qty), label: '5-Year Co-Term' },
  ];
}

// MR-ENT alongside hardware — these are appended after the hardware quote.
function mrAppendUrls(qty) {
  const ap = `${qty} AP${qty === 1 ? '' : 's'}`;
  return [
    { url: buildOrderUrl('LIC-ENT-1YR', qty), label: `MR Ent Licenses — 1-Year (${ap})` },
    { url: buildOrderUrl('LIC-ENT-3YR', qty), label: `MR Ent Licenses — 3-Year (${ap})` },
    { url: buildOrderUrl('LIC-ENT-5YR', qty), label: `MR Ent Licenses — 5-Year (${ap})` },
  ];
}

function mrOnlyResult(qty) {
  return {
    urls: mrOnlyUrls(qty),
    eolWarnings: [],
    suggestions: null,
    parsed: [{ baseSku: 'LIC-ENT', qty }],
    source: 'vision-mr-only',
    handlerType: 'vision-mr-only',
  };
}

const isMrEnt = (d) => d.sku === 'MR-ENT' || d.sku === 'MR_ENT';

/**
 * Map a raw /api/quote response into the normalized `result` shape the
 * QuoteResult renderer expects. Returns { result } or { error }.
 */
export function mapQuoteResponse(res, mrEntQty = 0) {
  const rawUrls = res.quoteUrls || res.urls || [];
  const urlsArr = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
  const eolArr = Array.isArray(res.eolWarnings) ? res.eolWarnings : [];
  const parsedRaw = Array.isArray(res.parsedItems) ? res.parsedItems : [];
  const suggestArr = Array.isArray(res.suggestions) ? res.suggestions : null;

  if (res.pricingResponse) {
    return { result: {
      urls: urlsArr.map(toUrlObj), eolWarnings: [], suggestions: null, parsed: [],
      pricingResponse: res.pricingResponse, handlerType: res.handlerType || 'pricing', source: 'pricing',
    } };
  }
  if (res.eolDateResponse) {
    return { result: {
      urls: [], eolWarnings: [], suggestions: null, parsed: [],
      eolDateResponse: res.eolDateResponse, handlerType: 'eol-date', source: 'eol-date',
    } };
  }
  if (urlsArr.length > 0 || (suggestArr && suggestArr.length > 0) || res.claudeResponse) {
    let finalUrls = urlsArr.map(toUrlObj);
    if (mrEntQty > 0) finalUrls = finalUrls.concat(mrAppendUrls(mrEntQty));
    return { result: {
      urls: finalUrls,
      eolWarnings: eolArr,
      suggestions: suggestArr,
      parsed: parsedRaw.map(p => ({ baseSku: p.sku || p.baseSku || '', qty: p.qty || 1 })),
      claudeResponse: res.claudeResponse || null,
      handlerType: res.handlerType || 'deterministic',
      source: res.claudeResponse && urlsArr.length === 0 ? 'claude' : 'api',
    } };
  }
  if (res.error) return { error: res.error };
  return { error: 'No quote generated. Check your SKU input.' };
}

/**
 * Run a deterministic URL quote for free-text SKUs. Strips synthetic MR-ENT
 * lines, calls the worker engine, and appends the LIC-ENT co-term URLs.
 * @returns {Promise<{result?: object, error?: string}>}
 */
export async function runQuote(skuText, personId) {
  const raw = (skuText || '').trim();
  if (!raw) return { error: 'No SKUs provided.' };

  const lines = raw.split(/\r?\n/);
  let mrEntQty = 0;
  const kept = [];
  const mrEntLineRe = /^\s*(?:MR[-_]ENT|MR\s+Enterprise)(?:\s*[xX×*]\s*|\s+)(\d+)\s*$/;
  for (const line of lines) {
    const m = line.match(mrEntLineRe);
    if (m) {
      const q = parseInt(m[1], 10);
      if (Number.isFinite(q) && q > 0 && q <= 500) mrEntQty += q;
    } else {
      kept.push(line);
    }
  }
  const skuForApi = kept.join('\n').trim();

  // MR-ENT only → the three co-term URLs directly (no worker round-trip).
  if (!skuForApi && mrEntQty > 0) {
    return { result: mrOnlyResult(mrEntQty) };
  }

  try {
    const res = await sendToBackground(MSG.GENERATE_QUOTE, { skuText: skuForApi, personId });
    if (!res) return { error: 'No response from quote API.' };
    return mapQuoteResponse(res, mrEntQty);
  } catch (err) {
    return { error: err?.message || 'Quote generation failed' };
  }
}

function isValidSkuToken(sku) {
  if (!sku) return false;
  const s = sku.toUpperCase();
  if (s.startsWith('LIC-')) return true;
  if (s === 'MR-ENT' || s === 'MR_ENT') return true;
  if (/^Z\d/.test(s) && !/^Z[134][C]?X?$/.test(s)) return false;
  if (/^[A-Z0-9]{4,}-[A-Z0-9]{4,}-[A-Z0-9]{4,}/.test(s)) return false;
  return true;
}

// Pull the worker's "X (EOL) → Replacement: Y" lines out of the rendered
// dashboard analysis so chat can show the EOL→replacement mapping (like the
// Webex bot) alongside the refresh options.
function extractEolMapping(analysisText) {
  if (!analysisText) return [];
  return analysisText
    .split('\n')
    .filter((l) => /\(EOL\)\s*(→|->)\s*Replacement/i.test(l))
    .map((l) => l.replace(/^[•\-*\s]+/, '').trim())
    .filter(Boolean);
}

// Friendly display label for the Parsed Items list — the synthetic MR-ENT
// token is real (7 MR Enterprise licenses) but isn't a catalog SKU.
function parsedDisplaySku(sku) {
  return (sku === 'MR-ENT' || sku === 'MR_ENT') ? 'MR Enterprise (LIC-ENT)' : sku;
}

/**
 * Analyze a screenshot/dashboard image and return a discriminated result for
 * the chat panel to render:
 *   { kind: 'result', result, note, detectedSkus }  — ready-made quote (worker
 *       URLs or MR-only) to push straight into the thread.
 *   { kind: 'skus', skuText, note, detectedSkus }    — detected SKUs to run
 *       through runQuote() (MR-ENT handling included).
 *   { kind: 'message', note }                        — nothing usable parsed.
 *   { error }
 */
export async function analyzeImage(imageUrl, imageBase64) {
  let res;
  try {
    res = await sendToBackground(MSG.ANALYZE_IMAGE, { imageUrl, imageBase64 });
  } catch (err) {
    return { error: 'Image analysis failed: ' + (err?.message || err) };
  }

  const rawAnalysisText = (res && res.analysis) || '';
  const analysisText = rawAnalysisText.replace(/\*{1,3}/g, '');
  const eolMapping = extractEolMapping(rawAnalysisText);

  let parsedItems = [];
  if (Array.isArray(res?.parsedItems) && res.parsedItems.length > 0) {
    parsedItems = res.parsedItems
      .map(p => ({ sku: String(p.sku || p.baseSku || '').toUpperCase().replace(/_/g, '-'), qty: Number(p.qty) || 1 }))
      .filter(p => p.sku && isValidSkuToken(p.sku) && p.qty > 0 && p.qty <= 500);
  } else if (/LICENSE_DASHBOARD_PARSE_V1/.test(analysisText)) {
    const lineRe = /SKU:\s*([A-Z0-9][A-Z0-9_-]*)\s*\|\s*LIMIT:\s*(\d+)\s*\|\s*ACTIVE:\s*(\d+)/gi;
    let m;
    while ((m = lineRe.exec(analysisText)) !== null) {
      const sku = m[1].toUpperCase().replace(/_/g, '-');
      const limit = parseInt(m[2], 10);
      const active = parseInt(m[3], 10);
      if (!Number.isFinite(limit) || !Number.isFinite(active)) continue;
      if (active === 0) continue;
      const qty = Math.min(limit || active, active || limit);
      if (qty <= 0 || qty > 500) continue;
      if (!isValidSkuToken(sku)) continue;
      parsedItems.push({ sku, qty });
    }
  }

  // Dedupe while preserving order.
  const dedupMap = new Map();
  for (const { sku, qty } of parsedItems) dedupMap.set(sku, (dedupMap.get(sku) || 0) + qty);
  const deduped = Array.from(dedupMap.entries()).map(([sku, qty]) => ({ sku, qty }));
  const hwItems = deduped.filter(d => !isMrEnt(d));
  const mrQty = deduped.filter(isMrEnt).reduce((sum, d) => sum + (d.qty || 0), 0);
  const detectedSkus = deduped.map(d => d.sku);
  const formatted = deduped.map(({ sku, qty }) => `${sku} x ${qty}`).join('\n');

  // Worker pre-built full quote URLs — show them directly.
  if (res && Array.isArray(res.quoteUrls) && res.quoteUrls.length > 0) {
    const result = {
      urls: res.quoteUrls.map(toUrlObj),
      eolWarnings: [],
      suggestions: null,
      // Show ALL detected items including the MR Enterprise licenses (the
      // synthetic MR-ENT token), not just the hardware — otherwise the URL
      // looks like it has more than Parsed Items lists.
      parsed: deduped.map(({ sku, qty }) => ({ baseSku: parsedDisplaySku(sku), qty })),
      source: 'api',
    };
    const note = deduped.length
      ? `Detected ${deduped.length} SKU${deduped.length > 1 ? 's' : ''} from the screenshot.`
      : 'Quote URLs generated from the screenshot.';
    return { kind: 'result', result, note, detectedSkus, eolMapping };
  }

  if (res && res.analysis) {
    if (deduped.length > 0) {
      // MR-only screenshot → the three LIC-ENT co-term URLs.
      if (hwItems.length === 0 && mrQty > 0) {
        return { kind: 'result', result: mrOnlyResult(mrQty), note: `Detected MR Enterprise × ${mrQty} from the screenshot.`, detectedSkus };
      }
      // Hardware (and maybe MR-ENT) → quote the formatted list (runQuote strips MR-ENT).
      return { kind: 'skus', skuText: formatted, note: `Detected ${deduped.length} SKU${deduped.length > 1 ? 's' : ''} from the screenshot.`, detectedSkus, eolMapping };
    }
    // Structured parse failed — best-effort MR-Enterprise prose match only.
    const narrowMrMatch = analysisText.match(/MR\s+Enterprise[^0-9]{0,40}(\d{1,3})/i);
    if (narrowMrMatch) {
      const q = parseInt(narrowMrMatch[1], 10);
      if (Number.isFinite(q) && q > 0 && q <= 500) {
        return { kind: 'result', result: mrOnlyResult(q), note: `Detected MR Enterprise × ${q} (prose fallback). If hardware SKUs are missing, re-capture a cleaner screenshot.`, detectedSkus: ['MR-ENT'] };
      }
    }
    return { kind: 'message', note: "Couldn't parse the dashboard into SKUs. Try a cleaner screenshot, or type the SKUs (e.g. 10 MR44)." };
  }

  return { kind: 'message', note: 'No SKUs detected in this image.' };
}

/**
 * Resolve the order URL + a "Nx SKU" summary for a Send-to-Zoho handoff.
 * Re-expands the chosen order URL (source of truth) into line items.
 */
export function orderSummaryFromResult(result, selectedUrlIdx = 0) {
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  const chosen = urls[selectedUrlIdx] || urls[0] || null;
  const orderUrl = chosen ? (typeof chosen === 'object' ? chosen.url : String(chosen)) : null;
  let items = orderUrl ? parseStratusOrderUrl(orderUrl) : [];
  if (!items.length && Array.isArray(result?.parsed)) {
    items = result.parsed.map(p => ({ sku: p.baseSku || p.sku || '', qty: p.qty || 1 })).filter(p => p.sku);
  }
  const skuSummary = items.map(i => `${i.qty || 1}x ${i.sku}`).join(', ');
  return { orderUrl, skuSummary };
}
