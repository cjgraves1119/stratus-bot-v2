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

// MR-ENT alongside hardware must remain one atomic cart per term. Publishing
// separate hardware and license-only links makes neither link represent the
// committed full snapshot and lets a user accidentally order only one half.
function mergeMrEntIntoQuoteOptions(options, qty) {
  const safeSku = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/;
  const normalizedContractLine = (line) => {
    const sku = String(line?.sku || '').trim().toUpperCase();
    const lineQty = Number(line?.qty);
    return safeSku.test(sku) && Number.isInteger(lineQty) && lineQty >= 1 && lineQty <= 99999
      ? { ...line, sku, qty: lineQty }
      : null;
  };
  const addContractQuantity = (rawLines, sku, addedQty) => {
    if (!Array.isArray(rawLines) || rawLines.length === 0) return null;
    const lines = rawLines.map(normalizedContractLine);
    if (lines.some((line) => !line)) return null;
    const existingIndexes = lines
      .map((line, index) => (line.sku === sku ? index : -1))
      .filter((index) => index >= 0);
    const existingTotal = existingIndexes.reduce((sum, index) => sum + lines[index].qty, 0);
    if (existingTotal + addedQty > 99999) return null;
    if (existingIndexes.length) {
      const index = existingIndexes[0];
      lines[index] = { ...lines[index], qty: lines[index].qty + addedQty };
    } else {
      lines.push({ sku, qty: addedQty });
    }
    return lines;
  };
  const merged = [];
  for (const rawOption of options) {
    const option = toUrlObj(rawOption);
    try {
      const url = new URL(String(option.url || ''));
      if (url.protocol !== 'https:'
          || url.port || url.username || url.password || url.hash
          || !['stratusinfosystems.com', 'www.stratusinfosystems.com'].includes(url.hostname.toLowerCase())
          || url.pathname !== '/order/'
          || url.searchParams.getAll('item').length !== 1
          || url.searchParams.getAll('qty').length !== 1) return [];
      const items = String(url.searchParams.get('item') || '').split(',').map((value) => value.trim().toUpperCase());
      const quantities = String(url.searchParams.get('qty') || '').split(',').map(Number);
      if (!items.length || items.length !== quantities.length
          || new Set(items).size !== items.length
          || quantities.some((value) => !Number.isInteger(value) || value < 1 || value > 99999)) return [];
      const labelTerm = String(option.label || '').match(/\b([135])\s*-?\s*YEAR\b/i)?.[1] || '';
      const urlTerms = [...new Set(items
        .map((item) => item.match(/-(1|3|5)YR?$/)?.[1] || '')
        .filter(Boolean))];
      const term = labelTerm || (urlTerms.length === 1 ? urlTerms[0] : '');
      if (!term || (labelTerm && urlTerms.length && (urlTerms.length !== 1 || urlTerms[0] !== labelTerm))) return [];
      const licenseSku = `LIC-ENT-${term}YR`;
      let verification = option.verification;
      if (verification !== undefined && verification !== null) {
        // EOL refresh options carry a source/target proof that the extension
        // verifies against both the reviewed rows and the public URL. Adding a
        // synthetic MR-ENT quantity to only the URL makes that proof stale and
        // suppresses the otherwise valid refresh action. Extend all three
        // surfaces atomically, or publish no options at all.
        if (option.optionKind !== 'eol_refresh'
            || !Number.isInteger(option.termYears) || option.termYears !== Number(term)
            || !verification || typeof verification !== 'object' || Array.isArray(verification)
            || verification.schema !== 'quote-option-v1'
            || verification.mode !== 'eol_transform'
            || !Array.isArray(verification.replacements) || verification.replacements.length === 0
            || !Array.isArray(verification.targetLines)
            || verification.targetLines.length !== items.length) return [];
        const currentTargetLines = verification.targetLines.map(normalizedContractLine);
        if (currentTargetLines.some((line) => !line)
            || currentTargetLines.some((line, index) => (
              line.sku !== items[index] || line.qty !== quantities[index]
            ))) return [];
        const sourceLines = addContractQuantity(verification.sourceLines, licenseSku, qty);
        const targetLines = addContractQuantity(verification.targetLines, licenseSku, qty);
        if (!sourceLines || !targetLines) return [];
        verification = {
          ...verification,
          sourceLines,
          targetLines,
          // Copy the bounded array so this transformation cannot mutate the
          // Worker's response object through a shared reference.
          replacements: [...verification.replacements],
        };
      }
      const existing = items.indexOf(licenseSku);
      if (existing >= 0) {
        if (quantities[existing] + qty > 99999) return [];
        quantities[existing] += qty;
      } else {
        items.push(licenseSku);
        quantities.push(qty);
      }
      const mergedOption = {
        ...option,
        url: `${ORDER_BASE}?item=${items.join(',')}&qty=${quantities.join(',')}`,
        ...(verification !== undefined && verification !== null ? { verification } : {}),
      };
      // The option-level flag describes the complete cart, not an individual
      // EOL replacement. Once LIC-ENT is merged into the cart it is no longer
      // globally Hardware Only; per-replacement hardwareOnly proof remains in
      // the signed transform contract for the bare EOL source row.
      delete mergedOption.hardwareOnly;
      merged.push(mergedOption);
    } catch {
      return [];
    }
  }
  return merged;
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
  // Normalize one worker `parsedItems` entry into the row shape the renderer and
  // the SKU editor share. `resolvedSku` / `licenseOnly` are additive fields the
  // worker attaches to a LICENSE-ONLY line (editorReadyParsedItems): `sku` is
  // still the hardware model the user typed, while `resolvedSku` is the licence
  // the quote actually contains (LIC-MX67C-SEC-3YR). Carrying them through is
  // what lets the editor pre-fill a complete, re-quotable SKU instead of a bare
  // model that silently re-adds hardware on the next Update quote.
  // Deliberately a LOCAL: test-mx-dashboard-correction-2026-07-31.js extracts
  // this function's source on its own, so a sibling top-level helper would be
  // undefined there.
  const toParsedRow = (p) => {
    const row = { baseSku: p.sku || p.baseSku || '', qty: p.qty || 1 };
    if (p.resolvedSku) row.resolvedSku = p.resolvedSku;
    if (p.licenseOnly === true) row.licenseOnly = true;
    if (p.hardwareOnly === true) row.hardwareOnly = true;
    // Row-local tier is committed quote intent. Carry it into the editor so an
    // ordinary Chat quote for MX67 Enterprise cannot reopen as the MX default
    // (Advanced Security) merely because the API response was normalized.
    if (p.requestedTier || p.tier) row.requestedTier = p.requestedTier || p.tier;
    return row;
  };
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
  if (res.recovery) {
    return { result: {
      urls: urlsArr.map(toUrlObj),
      eolWarnings: eolArr,
      suggestions: suggestArr,
      parsed: parsedRaw.map(toParsedRow),
      claudeResponse: res.claudeResponse || res.analysis || res.error || res.recovery.detail || 'A specific recovery step is required.',
      recovery: res.recovery,
      handlerType: res.handlerType || 'complexity-recovery',
      source: 'recovery',
    } };
  }
  if (urlsArr.length > 0 || (suggestArr && suggestArr.length > 0) || res.claudeResponse) {
    let finalUrls = urlsArr.map(toUrlObj);
    if (mrEntQty > 0) finalUrls = mergeMrEntIntoQuoteOptions(finalUrls, mrEntQty);
    const parsed = parsedRaw.map(toParsedRow);
    if (mrEntQty > 0) parsed.push({ baseSku: 'MR-ENT', qty: mrEntQty });
    return { result: {
      urls: finalUrls,
      eolWarnings: eolArr,
      suggestions: suggestArr,
      parsed,
      claudeResponse: res.claudeResponse || null,
      recovery: res.recovery || null,
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
export async function runQuote(skuText, personId, priorQuoteText = null) {
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
    const res = await sendToBackground(MSG.GENERATE_QUOTE, {
      skuText: skuForApi,
      personId,
      // Bounded local quote-card context for deterministic corrections. The
      // worker accepts only Stratus order URLs or its dashboard marker.
      priorQuoteText: priorQuoteText || undefined,
    });
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

  // Typed recovery must win over every image/SKU fallback. In particular, a
  // complexity-exhausted vision call or blocked order SKU must never be
  // re-posted as ordinary SKU text (which would hide the actual failure).
  if (res?.recovery) {
    return {
      kind: 'recovery',
      note: res.analysis || res.error || res.recovery.detail || 'A specific recovery step is required.',
      recovery: res.recovery,
    };
  }
  if (res?.error) return { error: res.error };

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

  // The worker deliberately withholds URLs when an MX row needs an edition
  // that was not visibly confirmed in the screenshot. Keep the parsed rows on
  // the message so a short SEC/ENT/SDW answer can resume deterministically.
  if (res?.needsClarification) {
    return {
      kind: 'clarification',
      note: res.clarification || res.analysis || 'Please confirm the MX license edition before quoting.',
      detectedSkus,
      skuText: formatted,
    };
  }

  // Worker pre-built full quote URLs — show them directly.
  if (res && Array.isArray(res.quoteUrls) && res.quoteUrls.length > 0) {
    const result = {
      urls: res.quoteUrls.map(toUrlObj),
      eolWarnings: Array.isArray(res.eolWarnings) ? res.eolWarnings : [],
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
      // F8: every detected row is a fully-formed license SKU. After the worker's
      // LIC- passthrough fix a license dashboard returns ready quote URLs above
      // (the res.quoteUrls branch). Reaching here with ONLY license rows means
      // the worker couldn't build a quote — re-POSTing them as raw SKU text
      // mis-routes license rows through the hardware parser and produces phantom
      // "did you mean MX67?" chips. Show a re-capture prompt instead of garbage.
      if (deduped.every(d => String(d.sku).toUpperCase().startsWith('LIC-'))) {
        return { kind: 'message', note: `Detected these license SKUs but couldn't auto-build a quote: ${detectedSkus.join(', ')}. Try a cleaner screenshot, or type the SKUs (e.g. 10 MR44).`, detectedSkus };
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
