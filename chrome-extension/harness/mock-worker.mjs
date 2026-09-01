/**
 * Faithful-enough mock of the worker's quote resolution, so the harness exercises
 * the REAL verifier against REALISTIC URLs.
 *
 * Mirrors the behaviours that actually matter for URL composition:
 *   - term-agnostic licence aliases (LIC-ENT / LIC-MV / LIC-MT / MR-ENT) expand per term
 *   - bare models that only ship as a regional SKU resolve to it (MX67C -> MX67C-NA)
 *   - Meraki hardware gets its -HW / -MR / -RTG catalog form
 *   - hardware without an explicit licence gets an automatic companion licence
 *
 * Deliberately NOT a copy of worker logic — it is a stand-in for the network. The
 * thing under test is the extension's editor + verifier round trip.
 */

const TERMS = [1, 3, 5];

// Models whose only catalog form carries a region suffix.
const REGION_ONLY = {
  MX67C: 'MX67C-NA',
  MX68CW: 'MX68CW-NA',
  MG21: 'MG21-HW-NA',
  MG21E: 'MG21E-HW-NA',
  Z3C: 'Z3C-HW-NA',
};

// Meraki hardware catalog forms.
const HARDWARE_FORM = {
  MR44: 'MR44-HW',
  MR46: 'MR46-HW',
  MX75: 'MX75-HW',
  MX85: 'MX85-HW',
  MX105: 'MX105-HW',
  'MS130-24': 'MS130-24',
  CW9164I: 'CW9164I-MR',
  CW9166I: 'CW9166I-MR',
  CW9172H: 'CW9172H-RTG',
};

// Automatic companion licence for a hardware line, by term.
const COMPANION = {
  MR44: (t) => `LIC-ENT-${t}YR`,
  MR46: (t) => `LIC-ENT-${t}YR`,
  CW9164I: (t) => `LIC-ENT-${t}YR`,
  CW9166I: (t) => `LIC-ENT-${t}YR`,
  'MS130-24': (t) => `LIC-MS130-24-${t}Y`,
  'C9300-48P-M': (t) => `LIC-C9300-48E-${t}Y`,
  'C9300-24P-M': (t) => `LIC-C9300-24E-${t}Y`,
  MX75: (t) => `LIC-MX75-SEC-${t}Y`,
  MX85: (t) => `LIC-MX85-SEC-${t}Y`,
  MX67C: (t) => `LIC-MX67C-ENT-${t}YR`,
  MX68CW: (t) => `LIC-MX68CW-SEC-${t}YR`,
  CW9172H: (t) => `LIC-ENT-${t}YR`,
};

const AGNOSTIC = {
  'LIC-ENT': (t) => `LIC-ENT-${t}YR`,
  'MR-ENT': (t) => `LIC-ENT-${t}YR`,
  'LIC-MV': (t) => `LIC-MV-${t}YR`,
  'LIC-MT': (t) => `LIC-MT-${t}Y`,
};

function orderUrl(items) {
  return `https://stratusinfosystems.com/order/?item=${items.map((i) => i.sku).join(',')}&qty=${items.map((i) => i.qty).join(',')}`;
}

/**
 * Resolve committed editor rows into the catalog items for one term.
 * hardwareOnly=true suppresses every licence line.
 */
export function resolveForTerm(rows, term, { hardwareOnly = false } = {}) {
  const out = [];
  for (const row of rows) {
    const sku = String(row.sku || '').trim().toUpperCase();
    const qty = Number(row.qty);
    if (!sku || !Number.isInteger(qty) || qty <= 0) continue;

    if (AGNOSTIC[sku]) {
      if (!hardwareOnly) out.push({ sku: AGNOSTIC[sku](term), qty });
      continue;
    }
    if (sku.startsWith('LIC-')) {
      if (!hardwareOnly) {
        // The worker emits each option at ITS term, so an explicit committed term
        // SKU is restated for the option being built. Passing it through unchanged
        // would put a 1-year licence in the 3-year option, which the option-set
        // gate rightly rejects.
        const m = sku.match(/^(LIC-.+?)-(\d{1,2})(YR|Y)$/);
        out.push({ sku: m ? `${m[1]}-${term}${m[3]}` : sku, qty });
      }
      continue;
    }
    const hw = REGION_ONLY[sku] || HARDWARE_FORM[sku] || sku;
    out.push({ sku: hw, qty });
    if (!hardwareOnly && COMPANION[sku]) out.push({ sku: COMPANION[sku](term), qty });
  }
  return out;
}

/** Build the full option set the worker would return for a committed cart. */
export function buildQuoteOptions(rows) {
  // A term-labelled option only makes sense when that term actually produces a
  // licence line. A cart of pure hardware with no companion licence gets the
  // Hardware Only option alone — emitting empty "1-Year" options would (rightly)
  // be rejected by the option-set gate.
  const options = TERMS
    .map((t) => ({ t, items: resolveForTerm(rows, t) }))
    .filter(({ items }) => items.some((i) => i.sku.startsWith('LIC-')))
    .map(({ t, items }) => ({ label: `${t}-Year`, url: orderUrl(items), termYears: t }));
  const hwItems = resolveForTerm(rows, 3, { hardwareOnly: true });
  const allHardware = rows.every(({ sku }) => !String(sku).toUpperCase().startsWith('LIC-') && !AGNOSTIC[String(sku).toUpperCase()]);
  if (hwItems.length && allHardware) {
    options.push({ label: 'Hardware Only', url: orderUrl(hwItems), hardwareOnly: true });
  }
  return options;
}

// ── One-shot re-plan stand-in ───────────────────────────────────────────────
// The one-shot card requotes hardware to rebuild its licences at a new tier.
// What comes back is the whole cart, so this models the two things that broke
// on 2026-08-19: hardware being dropped, and licences arriving twice.
//
// The SKU spellings below are the ones the real worker returned for these exact
// carts (captured from parseMessage + buildQuoteResponse, not invented).

const TIER_CODE = { security: 'SEC', enterprise: 'ENT', advanced: 'ADV', 'SD-WAN': 'SDW' };

/** The licence a device gets, honouring a per-row tier where the family has one. */
function companionForRequote(model, term, tier) {
  const m = String(model || '').toUpperCase();
  const code = TIER_CODE[tier] || null;
  if (/^MX|^Z\d/.test(m)) {
    const base = m.replace(/-NA$/, '');
    return `LIC-${base}-${code || 'ENT'}-${term}YR`;
  }
  if (/^MR|^CW9/.test(m)) return `LIC-ENT-${term}YR`;
  if (/^MS(\d+)/.test(m)) return `LIC-${m.split('-')[0]}-${(m.split('-')[1] || '').replace(/[^0-9]/g, '') || '48'}-${term}Y`;
  if (/^C9[23]/.test(m)) return `LIC-${m.split('-')[0]}-24E-${term}Y`;
  return null;
}

/**
 * Resolve the serialized requote text the sidebar sends ("2 MX67C-NA security")
 * into the cart the worker would return for one term.
 */
export function resolveRequoteText(text, term) {
  const out = [];
  for (const raw of String(text || '').split(/\n+/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+([A-Z0-9][A-Z0-9-]*)\s*(security|enterprise|advanced|SD-WAN)?$/i);
    if (!m) continue;
    const qty = parseInt(m[1], 10);
    const sku = m[2].toUpperCase();
    const tier = m[3] ? m[3].toLowerCase() : null;
    if (sku.startsWith('LIC-')) { out.push({ sku, qty }); continue; }
    const hw = REGION_ONLY[sku] || HARDWARE_FORM[sku] || sku;
    out.push({ sku: hw, qty });
    const lic = companionForRequote(sku, term, tier);
    if (lic) out.push({ sku: lic, qty });
  }
  return out;
}

/** Catalog pool backing the read-only autocomplete. */
export const PRODUCT_POOL = [
  ...Object.values(REGION_ONLY),
  ...Object.values(HARDWARE_FORM),
  'C9300-48P-M', 'C9300-24P-M',
  'LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR',
  'LIC-MX67C-ENT-1YR', 'LIC-MX67C-ENT-3YR', 'LIC-MX67C-ENT-5YR',
  'LIC-MS130-24-3Y', 'LIC-C9300-48E-3Y',
];

// ── Quote Line Editor (2026-08-20) ───────────────────────────────────────────
//
// A mixed quote of the shape Chris actually edits: hardware, licences, a line
// that already carries a hand-written description, and a line already sitting
// at a non-zero discount. Discount is ABSOLUTE DOLLARS, as it is in Zoho.

export const QLE_QUOTE = {
  quoteId: '2570562000400116511',
  module: 'Quotes',
  quoteNumber: 'QT-1042',
  subject: 'Northside ISD refresh',
  ccwDealNumber: '80412345',
  grandTotal: 27130,
  subTotal: 27130,
  lines: [
    { id: 'ql1', sku: 'MR44-HW', name: 'Meraki MR44 access point', qty: 10, listPrice: 1495, discount: 0, description: '', sequence: 1 },
    { id: 'ql2', sku: 'LIC-ENT-3YR', name: 'Meraki Enterprise 3 year', qty: 10, listPrice: 450, discount: 675, description: 'Renewal co-term', sequence: 2 },
    { id: 'ql3', sku: 'MS130-24', name: 'Meraki MS130 24 port', qty: 2, listPrice: 2195, discount: 0, description: '', sequence: 3 },
    { id: 'ql4', sku: 'MA-PWR-30W', name: 'Power adapter', qty: 2, listPrice: 125, discount: 0, description: '', sequence: 4 },
    { id: 'ql5', sku: 'LIC-MS130-24-3Y', name: 'MS130 licence 3 year', qty: 2, listPrice: 320, discount: 0, description: '', sequence: 5 },
  ],
};

const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Stand-in for /api/quote-line-ops. Deliberately NOT a copy of the worker: it
 * applies Zoho's ADDITIVE Quoted_Items semantics to the mock quote so the
 * harness exercises the extension's payload against a realistic server, the
 * same way mock-worker stands in for the quoting engine above.
 */
export function applyQuoteLineOps(quote, payload) {
  const ops = payload?.ops || {};
  const byId = new Map(quote.lines.map((line) => [line.id, { ...line }]));
  const deletes = new Set(ops.deletes || []);

  for (const op of ops.setDiscounts || []) {
    const line = byId.get(op.id);
    if (!line) return { success: false, error: 'unknown_ids', message: `unknown row ${op.id}` };
    if (deletes.has(op.id)) return { success: false, error: 'delete_conflict', message: `row ${op.id} is both deleted and repriced` };
    line.discount = round2(line.listPrice * line.qty * op.pct / 100);
    line.description = op.pct > 0 ? `${Number(Number(op.pct).toFixed(1))}% Discount` : '';
  }
  for (const id of deletes) {
    if (!byId.has(id)) return { success: false, error: 'unknown_ids', message: `unknown row ${id}` };
    byId.delete(id);
  }
  if (byId.size === 0) return { success: false, error: 'empty_quoted_items', message: 'a quote cannot be emptied' };

  let lines = [...byId.values()];
  if ((ops.reorder || []).length) {
    if (ops.reorder.length !== lines.length) return { success: false, error: 'partial_reorder', message: 'reorder must list every surviving line' };
    lines = ops.reorder.map((id, index) => ({ ...byId.get(id), sequence: index + 1 }));
  } else {
    lines = lines.map((line, index) => ({ ...line, sequence: index + 1 }));
  }

  const grandTotal = round2(lines.reduce((acc, l) => acc + (l.listPrice * l.qty) - l.discount, 0));
  return {
    success: true,
    record_id: quote.quoteId,
    module: quote.module,
    quote_number: quote.quoteNumber,
    lines: (ops.setDiscounts || []).map((op) => ({ id: op.id, pct: op.pct })),
    deletes: [...deletes],
    reorder: ops.reorder || [],
    grand_total_before: quote.grandTotal,
    grand_total_after: grandTotal,
    verification: { verified: true, success: true, line_count: lines.length },
    _undo_token: 'undo-harness-0001',
    _record_url: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${quote.quoteId}`,
    quote: { ...quote, lines, grandTotal, subTotal: grandTotal },
  };
}

/**
 * Stand-in for /api/quote-line-ecomm. Mirrors the real shapes the worker can
 * return: a live WooProducts price, a SKU quoted at list because it has no
 * storefront row, and a SKU the lookup could not resolve at all.
 */
const QLE_ECOMM = {
  'MR44-HW': { ecommPrice: 1121.25, source: 'live_zoho_wooproducts' },
  // Stale line list + a storefront that holds two prices: the exact shape that
  // made the card preview a net the quote would never show.
  'LIC-ENT-3YR': { ecommPrice: 337.5, source: 'live_zoho_wooproducts', liveListPrice: 449, priceConflict: [337.5, 340] },
  'MS130-24': { ecommPrice: 1920.63, source: 'live_zoho_wooproducts' },
  // No WooProducts row: fetchLiveSkuPricing quotes it at list with no discount.
  'MA-PWR-30W': { ecommPrice: 125, source: 'live_zoho_products_list_only', note: 'No ecomm price on file; quoted at list price with no discount.' },
  // Not resolvable at all.
  'LIC-MS130-24-3Y': { error: 'Live WooProducts Stratus_Price was not found' },
};

export function resolveEcommPrices(quote) {
  return {
    module: quote.module,
    recordId: quote.quoteId,
    quoteNumber: quote.quoteNumber,
    lookups: quote.lines.length,
    quotes: quote.lines.map((line) => {
      const hit = QLE_ECOMM[line.sku] || {};
      return {
        id: line.id,
        sku: line.sku,
        qty: line.qty,
        // The LIVE catalog list price, which is NOT always the price the quote
        // line is stored at. The editor must discount against the line's own
        // list, never this one (2026-08-20 regression).
        listPrice: hit.liveListPrice ?? line.listPrice,
        priceConflict: hit.priceConflict || null,
        ecommPrice: hit.ecommPrice || 0,
        currentUnitNet: line.qty > 0 ? round2((line.listPrice * line.qty - line.discount) / line.qty) : 0,
        source: hit.source || null,
        note: hit.note || null,
        error: hit.error || '',
      };
    }),
  };
}

// ── Distributor cost, for margin pricing (2026-08-20) ────────────────────────
//
// REAL DATA. This is Quote 2570562000422125077's Costs By Lines (Vendor_Lines)
// as Zoho actually holds it, so the harness prices against the same numbers the
// product will. `zohoDiscountAt10` is what Zoho's own margin function stored.

export const QLE_COST_QUOTE = {
  quoteId: '2570562000422125077',
  module: 'Quotes',
  quoteNumber: '2570562000422125084',
  subject: 'Moonshot-Solutions - 31x CW9176D1-RTG, 36x MS150-48LP-4X, 6x MS130-48X-HW - 1-Year',
  ccwDealNumber: '85800644',
  grandTotal: 199462.26,
  subTotal: 199462.26,
  lines: [
    { id: 'v1', sku: 'CW9176D1-RTG', name: 'Cisco Wireless 9176D1', qty: 31, listPrice: 3636.11, discount: 0, description: '', sequence: 1 },
    { id: 'v2', sku: 'LIC-ENT-1YR', name: 'Meraki MR Enterprise License, 1YR', qty: 31, listPrice: 200.7, discount: 0, description: '', sequence: 2 },
    { id: 'v3', sku: 'MS150-48LP-4X', name: 'Meraki MS150-48LP-4X', qty: 36, listPrice: 9783.61, discount: 0, description: '', sequence: 3 },
    { id: 'v4', sku: 'LIC-MS150-48-1Y', name: 'Meraki MS150-48 Essentials, 1Y', qty: 36, listPrice: 298.49, discount: 0, description: '', sequence: 4 },
    { id: 'v5', sku: 'MS130-48X', name: 'Meraki MS130-48X', qty: 6, listPrice: 10625.63, discount: 0, description: '', sequence: 5 },
    { id: 'v6', sku: 'LIC-MS130-48-1Y', name: 'Meraki MS130-48 Ent Renewal, 1Y', qty: 6, listPrice: 298.49, discount: 0, description: '', sequence: 6 },
    // A line with NO cost row, so the "left unchanged" path is always exercised.
    { id: 'v7', sku: 'MA-PWR-30W', name: 'Power adapter', qty: 4, listPrice: 125, discount: 0, description: '', sequence: 7 },
  ],
};

const QLE_COSTS = {
  v1: 40015.42, v2: 2270.75, v3: 100379.88, v4: 3492.36, v5: 19444.92, v6: 653.7,
};

/** What Zoho's own margin function stored on this quote at 10%. */
export const ZOHO_DISCOUNT_AT_10 = {
  v1: 68257.83, v2: 3698.64, v3: 240676.76, v4: 6865.24, v5: 42148.31, v6: 1064.61,
};

/** Stand-in for /api/quote-line-costs. */
export function resolveLineCosts(quote) {
  return {
    recordId: quote.quoteId,
    module: quote.module,
    quoteNumber: quote.quoteNumber,
    ccwDealNumber: quote.ccwDealNumber,
    quoteMarginPct: 10,
    vendorLineCount: Object.keys(QLE_COSTS).length,
    costs: quote.lines.map((line) => {
      const distiTotal = QLE_COSTS[line.id];
      const lineTotal = round2(line.listPrice * line.qty);
      if (!distiTotal) {
        return { id: line.id, sku: line.sku, qty: line.qty, lineTotal, distiTotal: 0, distiUnit: 0,
          error: `No distributor-cost row for ${line.sku}. Refresh the cost data on the quote.` };
      }
      return {
        id: line.id, sku: line.sku, qty: line.qty, lineTotal,
        distiTotal, distiUnit: round2(distiTotal / line.qty), costQty: line.qty,
        zohoMarginPct: 10, zohoClientTotal: round2(distiTotal / 0.9), error: '',
      };
    }),
  };
}

// ── Clone with different licence terms (2026-08-20) ──────────────────────────
//
// Stand-in for /api/quote-clone-terms{,-preview}. Mirrors the worker's rules:
// hardware untouched, termed LIC-* swapped to the target term at ecomm, 7/10
// year on the fixed co-term discount because they have no ecomm price.

const TERM_RE = /-(10|[1357])(YR|Y)$/i;
const COTERM = { 7: 0.50, 10: 0.55 };
// Term siblings, priced the way the real catalog is (same % off list per family).
const LICENCE_CATALOG = {
  'LIC-ENT': { 1: [116, 200], 3: [262, 450], 5: [436, 750], 7: [null, 1050], 10: [null, 1500] },
  'LIC-MS130-48': { 1: [156, 298.49], 3: [352, 672.35], 5: [587, 1121.58], 7: [null, 1570], 10: [null, 2243] },
  'LIC-MS150-48': { 1: [129, 298.49], 3: [291, 672.35], 5: [484, 1121.58], 7: [null, 1570], 10: [null, 2243] },
  // Real catalog values, so the harness prices the way production does.
  'LIC-MS130-24': { 1: [91, 172.86], 3: [203, 388.94], 5: [339, 648.23], 7: [null, 907], 10: [null, 1296] },
};

function licenceStem(sku) {
  return String(sku).toUpperCase().replace(TERM_RE, '');
}

export function previewCloneTerms(quote, terms) {
  return {
    recordId: quote.quoteId,
    previews: terms.map((term) => {
      const swaps = [];
      let unmapped = null;
      for (const line of quote.lines) {
        const sku = String(line.sku).toUpperCase();
        if (!/^LIC-/.test(sku) || !TERM_RE.test(sku)) continue;
        const stem = licenceStem(sku);
        // A licence already AT the target term is not swapped, it is carried
        // over. The worker classifies these as already_at_target_term; without
        // the same check the harness would show a no-op "X becomes X" swap.
        const sourceTerm = Number((sku.match(TERM_RE) || [])[1]);
        if (sourceTerm === term) continue;
        const fam = LICENCE_CATALOG[stem];
        if (!fam || !fam[term]) { unmapped = `${sku} (no ${term}-year sibling)`; break; }
        const [ecomm, list] = fam[term];
        const unit = ecomm != null ? ecomm : round2(list * (1 - COTERM[term]));
        const suffix = sku.endsWith('YR') ? 'YR' : 'Y';
        swaps.push({
          sku, target_sku: `${stem}-${term}${suffix}`, quantity: line.qty,
          unit_price: unit, new_net_total: round2(unit * line.qty),
          discount_pct: round2((1 - unit / list) * 100),
          pricing: ecomm != null ? 'ecomm' : `coterm_default_${Math.round(COTERM[term] * 100)}pct`,
        });
      }
      if (unmapped) return { target_term: term, available: false, error: 'unmapped_licenses', message: `Cannot move 1 licence line(s) to ${term} year: ${unmapped}. NOTHING was cloned.` };
      if (!swaps.length) return { target_term: term, available: false, error: 'nothing_to_reterm', message: `No termed licence to move to ${term} year.` };
      const before = round2(quote.lines
        .filter((l) => /^LIC-/.test(String(l.sku).toUpperCase()) && TERM_RE.test(String(l.sku).toUpperCase()))
        .reduce((sum, l) => sum + (l.listPrice * l.qty - l.discount), 0));
      return {
        target_term: term, available: true,
        subject: String(quote.subject || '').replace(/\b(10|[1357])\s*-?\s*(?:yr|yrs|year|years)\b/i, `${term}-Year`),
        swaps,
        untouched_count: quote.lines.length - swaps.length,
        licence_total_before: before,
        licence_total_after: round2(swaps.reduce((sum, s) => sum + s.new_net_total, 0)),
        source_grand_total: quote.grandTotal,
      };
    }),
  };
}

let cloneSeq = 0;
export function cloneQuoteTerms(quote, terms) {
  const previews = previewCloneTerms(quote, terms).previews;
  const results = previews.map((p) => {
    if (!p.available) return { success: false, target_term: p.target_term, error: p.error, message: p.message };
    cloneSeq += 1;
    const id = `257056200099900${String(cloneSeq).padStart(4, '0')}`;
    return {
      success: true, target_term: p.target_term,
      source_quote_id: quote.quoteId,
      cloned_quote_id: id,
      cloned_quote_url: `https://crm.zoho.com/crm/org647122552/tab/Quotes/${id}`,
      cloned_quote_number: `QT-CLONE-${p.target_term}Y`,
      subject: p.subject,
      swaps: p.swaps,
      untouched: new Array(p.untouched_count).fill({ reason: 'not_a_license' }),
      clone_grand_total: round2(quote.grandTotal - p.licence_total_before + p.licence_total_after),
      verification: { verified: true, success: true },
      _undo_token: `undo-clone-${p.target_term}y`,
      message: `Cloned to ${p.target_term} year.`,
    };
  });
  return { recordId: quote.quoteId, requested: terms, succeeded: results.filter((r) => r.success).length, results };
}
