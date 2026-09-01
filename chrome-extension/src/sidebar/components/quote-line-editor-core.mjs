/**
 * Quote Line Editor: pure core (2026-08-20)
 *
 * No React, no chrome APIs, no network. Everything the editor decides lives
 * here so it can be unit tested the same way sku-editor-core.mjs is: the JSX is
 * a renderer over these functions and nothing else.
 *
 * THE ONE FACT THAT DRIVES ALL OF THIS: on Zoho's Quoted_Items subform,
 * `Discount` is an ABSOLUTE DOLLAR amount for the whole line, not a percent.
 * There is no discount_percentage or Discount_Type field in this org. So
 *
 *     Discount = List_Price * Quantity * pct / 100
 *
 * and `dollarsForPct` below must stay bit-identical to the worker's
 * `roundMoney(listPrice * qty * pct / 100)`, or the preview the rep approves is
 * not the number that gets written.
 */

// Zoho's own line cap for a quote we are willing to edit in one commit.
const MAX_ROWS = 300;

// Match the extension's existing editable-quote quantity boundary. Keeping this
// well below Number.MAX_SAFE_INTEGER also makes every client/server multiply
// deterministic and prevents an accidental exponent or decimal from being
// normalized into a different customer quantity.
const MAX_QUANTITY = 99999;

// TWO decimals, because that is what Zoho itself writes. Its own margin function
// stamps descriptions like "68.33% Discount" on the quote (verified on Quote
// 2570562000422125077, 2026-08-20), and a margin-derived percent is never a
// round number. One decimal would flatten 68.33 to 68.3 and make our lines
// disagree with every line Zoho priced.
const PCT_DECIMALS = 2;

/** Mirror of the worker's moneyValue: tolerate "$1,234.00" and blanks. */
export function moneyValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Mirror of the worker's roundMoney. Half-up on cents, same as the server. */
export function roundMoney(value) {
  return Math.round(moneyValue(value) * 100) / 100;
}

/**
 * Clamp a typed percent to 0..100 with two decimals. Returns null for anything
 * that is not a number at all, so the caller can leave the field mid-typing
 * ("1." / "") without snapping it to 0 under the user's cursor.
 */
export function clampPct(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(String(value).replace(/[%\s]/g, ''));
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(100, Math.max(0, n));
  const factor = 10 ** PCT_DECIMALS;
  return Math.round(clamped * factor) / factor;
}

/**
 * Strict whole-line quantity normalization. Browser number inputs still hand us
 * strings, so accept decimal digits only and return a real safe integer. Invalid
 * intermediate values are rejected instead of truncated or rounded.
 */
export function normalizeQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const quantity = Number(text);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) return null;
  return quantity;
}

/**
 * Percent, printed the way Chris wants it read back on the quote: 25 not 25.00,
 * but 12.5 keeps its half. Trailing zeros only, never significant digits.
 */
export function fmtPct(pct) {
  const n = clampPct(pct);
  if (n === null) return '0';
  return String(Number(n.toFixed(PCT_DECIMALS)));
}

/**
 * The line Description this feature writes. Chris's decision (2026-08-19):
 * REPLACE the description entirely, and a line at 0% gets a BLANK description
 * rather than "0% Discount".
 *
 * Never produces the word "margin", customer-facing copy, and the worker's
 * scrubMarginFromQuotedItems runs over it again as defence in depth.
 */
export function descriptionForPct(pct) {
  const n = clampPct(pct);
  if (n === null || n <= 0) return '';
  return `${fmtPct(n)}% Discount`;
}

/** Dollar discount for a line. Must equal the worker's arithmetic exactly. */
export function dollarsForPct(listPrice, qty, pct) {
  const list = moneyValue(listPrice);
  const quantity = Number(qty) || 0;
  const n = clampPct(pct) ?? 0;
  return roundMoney(list * quantity * n / 100);
}

/** Percent implied by an existing dollar discount. 0 when the line is free. */
export function pctForDollars(listPrice, qty, discount) {
  const gross = moneyValue(listPrice) * (Number(qty) || 0);
  if (!(gross > 0)) return 0;
  const pct = (moneyValue(discount) / gross) * 100;
  return clampPct(pct) ?? 0;
}

/**
 * The dollar discount a row will actually write.
 *
 * Normally that is the percent times the line gross. An ECOMM MATCH is the
 * exception: matching the storefront has to be exact, and a percent rounded to
 * one decimal is not (0.05% of a $14,950 line is $7.48). So an ecomm-matched
 * row carries `discountDollars`, and the percent is kept only to render the
 * description. `applyEcommPricing` is the only thing that sets it, and any
 * manual percent edit clears it.
 */
export function effectiveDollars(row) {
  if (row?.discountDollars !== null && row?.discountDollars !== undefined) return roundMoney(row.discountDollars);
  return dollarsForPct(row?.listPrice, row?.qty, row?.discountPct);
}

/** Line net after discount, for the preview column. */
export function netForRow(row) {
  const gross = moneyValue(row?.listPrice) * (Number(row?.qty) || 0);
  return roundMoney(gross - effectiveDollars(row));
}

/** Unit price the customer pays on this row, which is what ecomm quotes. */
export function netUnitForRow(row) {
  const qty = Number(row?.qty) || 0;
  if (!(qty > 0)) return 0;
  return roundMoney(netForRow(row) / qty);
}

/**
 * API payload (`/api/quote-lines`) -> controlled editor rows.
 *
 * `sequence` is normalized to a dense 1..n in the order the API returned,
 * because Zoho sometimes omits Sequence_Number entirely and sometimes hands
 * back the array in a different order than it was sent. The ORIGINAL sequence
 * is kept on the row so the diff can tell a real reorder from a renumber.
 */
export function linesFromApi(payload) {
  const raw = Array.isArray(payload?.lines) ? payload.lines : [];
  return raw.slice(0, MAX_ROWS).map((line, index) => {
    const listPrice = moneyValue(line?.listPrice);
    const qty = Number(line?.qty) || 0;
    const discount = roundMoney(line?.discount);
    return {
      id: String(line?.id || ''),
      sku: String(line?.sku || '').trim().toUpperCase(),
      name: String(line?.name || '').trim(),
      productId: line?.productId ? String(line.productId) : null,
      qty,
      listPrice,
      discount,
      discountPct: pctForDollars(listPrice, qty, discount),
      description: typeof line?.description === 'string' ? line.description : '',
      sequence: index + 1,
      apiSequence: Number(line?.sequence) || null,
      selected: false,
      deleted: false,
      dirty: false,
      // The dollars Zoho ACTUALLY holds, kept as the row's exact discount.
      //
      // Deriving them back from `discountPct` instead would round-trip through
      // two decimals and lose cents: a line Zoho priced at a 10% margin carries
      // $240,676.76 against a 68.33% label, but 68.33% of the line total is
      // $240,665.06. Recomputing made every already-discounted quote show a
      // pending change on every line the instant it loaded (2026-08-20).
      discountDollars: discount,
      ecomm: null,
      ecommError: '',
      // Distributor cost + achieved margin, once the rep asks for it.
      cost: null,
      costError: '',
    };
  }).filter((row) => row.id);
}

/** Deep-ish copy so callers never mutate the array React is rendering. */
function copy(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({ ...row }));
}

/**
 * Bulk fill: one percent onto every surviving row. Deleted rows are skipped:
 * a row on its way out must not also carry a discount op (that would be two
 * conflicting instructions for the same id in one payload).
 */
export function applyBulkDiscount(rows, pct) {
  const n = clampPct(pct);
  if (n === null) return copy(rows);
  // A typed percent is an explicit instruction, so it drops any ecomm match on
  // the row rather than silently keeping the storefront dollars underneath it.
  return copy(rows).map((row) => (row.deleted
    ? row
    : { ...row, discountPct: n, discountDollars: null, ecomm: null, ecommError: '', cost: null, costError: '', dirty: true }));
}

/** Per-row override, applied after (or instead of) a bulk fill. */
export function setRowDiscount(rows, id, pct) {
  const n = clampPct(pct);
  return copy(rows).map((row) => {
    if (row.id !== id || row.deleted) return row;
    return {
      ...row,
      discountPct: n === null ? row.discountPct : n,
      discountDollars: null,
      ecomm: null,
      ecommError: '',
      cost: null,
      costError: '',
      dirty: true,
    };
  });
}

/**
 * Per-row quantity edit. Quantity changes preserve the displayed discount
 * percent, but drop exact-dollar ecomm/margin targets so the discount can be
 * recomputed against the new line gross. The Worker receives both operations in
 * one atomic request.
 */
export function setRowQuantity(rows, id, qty) {
  const quantity = normalizeQuantity(qty);
  if (quantity === null) return copy(rows);
  return copy(rows).map((row) => {
    if (row.id !== id || row.deleted || normalizeQuantity(row.qty) === quantity) return row;
    return {
      ...row,
      qty: quantity,
      discountDollars: null,
      ecomm: null,
      ecommError: '',
      cost: null,
      costError: '',
      dirty: true,
    };
  });
}

/**
 * Match every line to its ecomm (storefront) price.
 *
 * `quotes` is what POST /api/quote-line-ecomm returned: one entry per line id,
 * each carrying the live WooProducts Stratus_Price and the Zoho list price the
 * worker resolved. The discount is the exact dollar gap, NOT a rounded percent,
 * because the point of this action is parity with what the customer sees on the
 * site. The percent is derived only so the written description still reads
 * "N% Discount" the way every other line does.
 *
 * A line the worker could not price is left EXACTLY as it was and carries an
 * `ecommError` for the UI. Failing one SKU must never silently reprice it, and
 * must never block the lines that did resolve.
 */
export function applyEcommPricing(rows, quotes) {
  const byId = new Map((Array.isArray(quotes) ? quotes : []).map((q) => [String(q?.id || ''), q]));
  return copy(rows).map((row) => {
    if (row.deleted) return row;
    const quote = byId.get(row.id);
    if (!quote) return row;
    // THE LINE'S OWN LIST PRICE IS THE ONLY VALID BASE.
    //
    // Zoho subtracts Discount from the quote line's stored List_Price x
    // Quantity, and this feature never rewrites List_Price. Pricing against the
    // LIVE Products.Unit_Price instead (which is what the payload's listPrice
    // carries) makes the card preview a net the quote will never show: on a
    // line stored at 200.70 whose live list is 200.00, the card previewed
    // $3,596.00 for 31 units while Zoho would compute $3,617.70 (2026-08-20).
    const listPrice = moneyValue(row.listPrice);
    const liveListPrice = moneyValue(quote.listPrice);
    const ecommPrice = moneyValue(quote.ecommPrice);
    if (quote.error || !(ecommPrice > 0) || !(listPrice > 0)) {
      return { ...row, ecomm: null, ecommError: quote.error || 'No ecomm price on file for this SKU.' };
    }
    if (ecommPrice > listPrice + 0.005) {
      // Storefront above list is a data problem, not a discount. Never write a
      // negative discount; say so and leave the line alone.
      return { ...row, ecomm: null, ecommError: `Ecomm price ${ecommPrice} is above this line's list price ${listPrice}. Left unchanged.` };
    }
    const qty = Number(row.qty) || 0;
    const dollars = roundMoney(roundMoney(listPrice * qty) - roundMoney(ecommPrice * qty));
    // A quote line priced off a stale list is worth saying out loud: the money
    // is still exactly right (the customer pays the ecomm price), but the
    // percent on the description will not look like the storefront's.
    const notes = [];
    if (Array.isArray(quote.priceConflict) && quote.priceConflict.length > 1) {
      // The storefront holds more than one price for this SKU. The worker used
      // the most recently updated one; the rep should still see the spread.
      notes.push(`The storefront has more than one price for this SKU (${quote.priceConflict.join(', ')}). Used the most recent, ${roundMoney(ecommPrice)}.`);
    }
    if (quote.resolvedUnder) {
      // The price did not come from a storefront row for this line's own SKU.
      // That is how MS130-48X got priced as MS130-48X-HW; never let it be
      // silent even though the worker now guards the list price too.
      notes.push(`No storefront row for ${row.sku}; this price was resolved under ${quote.resolvedUnder}. Check it.`);
    }
    if (liveListPrice > 0 && Math.abs(liveListPrice - listPrice) > 0.005) {
      notes.push(`This line is stored at list ${listPrice} but the catalog now says ${liveListPrice}. The ecomm price is still matched exactly.`);
    }
    const staleList = notes.join(' ');
    return {
      ...row,
      discountDollars: dollars,
      discountPct: pctForDollars(listPrice, qty, dollars),
      ecomm: {
        price: roundMoney(ecommPrice),
        source: String(quote.source || 'wooproducts'),
        liveListPrice: liveListPrice > 0 ? roundMoney(liveListPrice) : null,
      },
      ecommError: staleList,
      cost: null,
      costError: '',
      dirty: true,
    };
  });
}

/**
 * Price every line to a target PROFIT MARGIN off distributor cost, the way
 * Zoho's own "Costs By Lines" margin function does.
 *
 *     client price = disti cost / (1 - margin/100)
 *     discount     = line list total - client price
 *
 * `costs` is what POST /api/quote-line-costs returned: one entry per line id,
 * carrying the Vendor_Lines distributor cost for that product.
 *
 * ROUNDING ORDER IS LOAD BEARING. Zoho rounds the client price to cents FIRST,
 * then subtracts it from the line total. Rounding the other way round misses by
 * a cent or two per line. Verified against all six lines of Quote
 * 2570562000422125077, which reproduce Zoho's stored Discount exactly
 * (2026-08-20).
 *
 * Margin is NOT markup: 10% margin on $100,379.88 of cost is a $111,533.20 sell
 * ($11,153.32 of gross profit, which is 10% OF THE SELL), not $110,417.87.
 *
 * A line with no cost row, or one that cannot reach the margin without pricing
 * above list, is left EXACTLY as it was and carries a `costError` for the UI.
 */
export function applyMarginPricing(rows, costs, marginPct) {
  // Validate the RAW input before rounding. clampPct would silently turn -1
  // into 0, and a 0% margin means selling at distributor cost: a real and very
  // expensive instruction that nobody types "-1" to request.
  const raw = (marginPct === null || marginPct === undefined || marginPct === '')
    ? NaN
    : Number(String(marginPct).replace(/[%\s]/g, ''));
  const margin = (Number.isFinite(raw) && raw >= 0 && raw < 95) ? clampPct(raw) : null;
  const byId = new Map((Array.isArray(costs) ? costs : []).map((c) => [String(c?.id || ''), c]));
  return copy(rows).map((row) => {
    if (row.deleted) return row;
    const cost = byId.get(row.id);
    if (!cost) return row;
    if (cost.error) return { ...row, cost: null, costError: cost.error };
    if (margin === null) {
      return { ...row, cost: null, costError: 'Enter a margin between 0 and 95 percent.' };
    }
    const distiTotal = moneyValue(cost.distiTotal);
    const lineTotal = roundMoney(moneyValue(row.listPrice) * (Number(row.qty) || 0));
    if (!(distiTotal > 0)) {
      return { ...row, cost: null, costError: 'Distributor cost for this line is zero or unknown, so no margin can be applied.' };
    }
    if (!(lineTotal > 0)) {
      return { ...row, cost: null, costError: 'This line has no list total, so no margin can be applied.' };
    }
    // Round the sell price to cents FIRST, exactly as Zoho does.
    const targetSell = roundMoney(distiTotal / (1 - margin / 100));
    if (targetSell > lineTotal + 0.005) {
      return {
        ...row,
        cost: null,
        costError: `Distributor cost ${roundMoney(distiTotal)} is too high to reach ${fmtPct(margin)}% margin without pricing above the line list total ${lineTotal}. Left unchanged.`,
      };
    }
    const dollars = roundMoney(lineTotal - targetSell);
    return {
      ...row,
      discountDollars: dollars,
      discountPct: pctForDollars(row.listPrice, row.qty, dollars),
      cost: {
        distiTotal: roundMoney(distiTotal),
        sell: targetSell,
        marginPct: margin,
        grossProfit: roundMoney(targetSell - distiTotal),
      },
      costError: '',
      // A margin price is not an ecomm price; never show both badges.
      ecomm: null,
      ecommError: '',
      dirty: true,
    };
  });
}

/** The margin a row currently achieves, given its distributor cost. */
export function marginPctForRow(row) {
  const sell = netForRow(row);
  const distiTotal = moneyValue(row?.cost?.distiTotal);
  if (!(sell > 0) || !(distiTotal > 0)) return null;
  return Math.round(((sell - distiTotal) / sell) * 10000) / 100;
}

/** True when a row already sits at its ecomm price, so nothing needs matching. */
export function rowMatchesEcomm(row) {
  if (!row?.ecomm) return false;
  return Math.abs(netUnitForRow(row) - moneyValue(row.ecomm.price)) <= 0.005;
}

export function toggleRowSelected(rows, id) {
  return copy(rows).map((row) => (row.id === id ? { ...row, selected: !row.selected } : row));
}

export function setAllSelected(rows, on) {
  return copy(rows).map((row) => (row.deleted ? row : { ...row, selected: !!on }));
}

/**
 * SOFT delete. The row stays in the list, struck through, until commit, so the
 * rep can see what is going and undo it without re-reading the quote. It also
 * keeps ids stable for the diff.
 */
export function markSelectedForDelete(rows) {
  return copy(rows).map((row) => (row.selected ? { ...row, deleted: true, selected: false } : row));
}

export function markRowForDelete(rows, id) {
  return copy(rows).map((row) => (row.id === id ? { ...row, deleted: true, selected: false } : row));
}

/** Put ONE soft-deleted row back. The per-row undo next to the trash control. */
export function unmarkRowForDelete(rows, id) {
  return copy(rows).map((row) => (row.id === id ? { ...row, deleted: false } : row));
}

export function undoDeletes(rows) {
  return copy(rows).map((row) => (row.deleted ? { ...row, deleted: false } : row));
}

/** Move one row up or down among ALL rows (deleted rows keep their slot). */
export function moveRow(rows, id, dir) {
  const list = copy(rows);
  const from = list.findIndex((row) => row.id === id);
  if (from < 0) return list;
  const to = dir === 'up' ? from - 1 : from + 1;
  if (to < 0 || to >= list.length) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return resequence(list);
}

/** Drag-drop target. Index is clamped, so dropping past either end is stable. */
export function moveRowToIndex(rows, id, index) {
  const list = copy(rows);
  const from = list.findIndex((row) => row.id === id);
  if (from < 0) return list;
  const to = Math.min(list.length - 1, Math.max(0, Number(index)));
  if (to === from) return list;
  const [moved] = list.splice(from, 1);
  list.splice(to, 0, moved);
  return resequence(list);
}

/**
 * Dense 1..n over the SURVIVING rows, in list order. Deleted rows get a null
 * sequence: they are leaving, so numbering them would only produce a gap or a
 * collision with a row that stays.
 */
export function resequence(rows) {
  let next = 1;
  return copy(rows).map((row) => (row.deleted
    ? { ...row, sequence: null }
    : { ...row, sequence: next++ }));
}

/**
 * Fail-closed validation, run before the commit button is ever enabled.
 * Everything here is also re-checked server-side; this exists so the rep sees
 * the reason on screen instead of a rejected write.
 */
export function validateRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const errors = [];
  if (list.length === 0) errors.push({ code: 'no_rows', message: 'This quote has no line items to edit.' });
  if (list.length > MAX_ROWS) errors.push({ code: 'too_many_rows', message: `A quote with more than ${MAX_ROWS} lines is too large to edit here.` });

  const seen = new Set();
  for (const row of list) {
    if (!row?.id) { errors.push({ code: 'missing_id', message: 'A line is missing its Zoho row id. Reload the quote.' }); continue; }
    if (seen.has(row.id)) errors.push({ code: 'duplicate_id', message: `Line id ${row.id} appears twice. Reload the quote.` });
    seen.add(row.id);
    if (row.deleted) continue;
    const qty = normalizeQuantity(row.qty);
    if (qty === null) {
      errors.push({ code: 'invalid_quantity', message: `${row.sku || row.id}: quantity must be a whole number from 1 to ${MAX_QUANTITY.toLocaleString('en-US')}.` });
      continue;
    }
    const pct = clampPct(row.discountPct);
    if (pct === null) {
      errors.push({ code: 'invalid_pct', message: `${row.sku || row.id}: enter a discount percent between 0 and 100.` });
      continue;
    }
    const gross = roundMoney(moneyValue(row.listPrice) * qty);
    if (!(gross >= 0)) {
      errors.push({ code: 'invalid_line', message: `${row.sku || row.id}: list price or quantity is unreadable, so its discount cannot be validated.` });
      continue;
    }
    // The ecomm match writes exact dollars, so the dollar figure gets the same
    // 0 to line-gross gate the percent gets. The worker's
    // guardQuoteWriteDiscounts is the second, authoritative check.
    const dollars = effectiveDollars(row);
    if (!Number.isFinite(dollars) || dollars < 0 || dollars > gross + 0.005) {
      errors.push({ code: 'discount_out_of_range', message: `${row.sku || row.id}: a discount of ${dollars} is outside 0 to ${gross} for this line.` });
    }
  }

  const survivors = list.filter((row) => !row.deleted);
  if (list.length > 0 && survivors.length === 0) {
    // Mirrors the worker's EMPTY_QUOTED_ITEMS_REJECTED: a quote with zero lines
    // is never what the rep meant, and Zoho would leave it in a broken state.
    errors.push({ code: 'delete_all', message: 'Deleting every line would leave an empty quote. Delete the quote in Zoho instead.' });
  }

  return { ok: errors.length === 0, error: errors[0]?.message || '', errors };
}

/**
 * What changed, as ops. `original` is the untouched linesFromApi() snapshot.
 *
 * Rules, each pinned by a test:
 *   - an unchanged row emits NOTHING (a no-op commit is refused, not sent)
 *   - a deleted row emits ONLY a delete, never a discount and never a sequence
 *   - `reorder` appears only when the surviving order actually differs
 *
 * A discount op needs the row to be DIRTY, not merely to look different from
 * the convention. Quotes in the wild carry hand-written descriptions ("Renewal
 * co-term") on lines whose percent is already right; comparing those against
 * descriptionForPct() alone would silently rewrite every such note on a commit
 * the rep made for some unrelated line. Chris chose description replacement on
 * the rows he EDITS, not a whole-quote normalization.
 */
export function diffAgainstOriginal(original, rows, options = {}) {
  const before = new Map((Array.isArray(original) ? original : []).map((row) => [row.id, row]));
  const list = Array.isArray(rows) ? rows : [];
  const writeDescriptions = options.writeDescriptions !== false;

  const deletes = list.filter((row) => row.deleted && before.has(row.id)).map((row) => row.id);
  const deleted = new Set(deletes);
  const survivors = list.filter((row) => !deleted.has(row.id));

  const setDiscounts = [];
  const setQuantities = [];
  const descriptionChanges = [];
  for (const row of survivors) {
    const was = before.get(row.id);
    if (!was) continue;
    const pct = clampPct(row.discountPct) ?? 0;
    const nextDescription = descriptionForPct(pct);
    const dollars = effectiveDollars(row);
    const pctMoved = dollars !== effectiveDollars(was);
    const qty = normalizeQuantity(row.qty);
    const wasQty = normalizeQuantity(was.qty);
    // A quote can already contain a legacy/fractional quantity that this editor
    // refuses to write. Once the rep explicitly corrects it to a valid whole
    // number, that correction must be emitted. Requiring the original to also
    // normalize made the UI show the new quantity while Zoho kept the old one.
    const quantityMoved = qty !== null && (wasQty === null || qty !== wasQty);
    const descriptionMoved = writeDescriptions && nextDescription !== (was.description || '');
    if (row.dirty === true && quantityMoved) setQuantities.push({ id: row.id, qty });
    if (row.dirty === true && (pctMoved || descriptionMoved || quantityMoved)) {
      // A quantity edit clears its old exact-dollar target in setRowQuantity.
      // Therefore any non-null dollars here were computed AFTER that edit by
      // ecomm or margin pricing against the new quantity and must ride along.
      // A still-null target lets the worker recompute from the reviewed percent.
      setDiscounts.push(row.discountDollars === null || row.discountDollars === undefined
        ? { id: row.id, pct }
        : { id: row.id, pct, dollars });
      if (descriptionMoved) {
        descriptionChanges.push({
          id: row.id,
          sku: row.sku,
          from: was.description || '',
          to: nextDescription,
        });
      }
    }
  }

  // Reorder is judged on the surviving rows only. A delete alone shifts every
  // later line up, and that is not a reorder the rep asked for.
  const beforeOrder = (Array.isArray(original) ? original : [])
    .filter((row) => !deleted.has(row.id)).map((row) => row.id);
  const afterOrder = survivors.map((row) => row.id);
  const orderChanged = beforeOrder.length === afterOrder.length
    && beforeOrder.some((id, index) => id !== afterOrder[index]);
  const reorder = orderChanged ? afterOrder.slice() : [];

  return {
    setDiscounts,
    setQuantities,
    deletes,
    reorder,
    descriptionChanges,
    unchanged: survivors.length - setDiscounts.length,
    hasChanges: setDiscounts.length > 0 || setQuantities.length > 0 || deletes.length > 0 || reorder.length > 0,
  };
}

/**
 * The exact body POSTed to /api/quote-line-ops. Returns { ok:false } rather
 * than a half payload, so a caller can never send an invalid or empty commit.
 */
export function buildOpsPayload(original, rows, options = {}) {
  const validation = validateRows(rows);
  if (!validation.ok) return { ok: false, error: validation.error, errors: validation.errors, payload: null, diff: null };

  const writeDescriptions = options.writeDescriptions !== false;
  const diff = diffAgainstOriginal(original, rows, { writeDescriptions });
  if (!diff.hasChanges) {
    return { ok: false, error: 'Nothing has changed yet.', errors: [{ code: 'no_op', message: 'Nothing has changed yet.' }], payload: null, diff };
  }

  const payload = {
    recordId: String(options.recordId || ''),
    module: String(options.module || 'Quotes'),
    ops: {
      setDiscounts: diff.setDiscounts.map((op) => (op.dollars === undefined
        ? { id: op.id, pct: op.pct }
        : { id: op.id, pct: op.pct, dollars: op.dollars })),
      setQuantities: diff.setQuantities.map((op) => ({ id: op.id, qty: op.qty })),
      deletes: diff.deletes.slice(),
      reorder: diff.reorder.slice(),
    },
    writeDescriptions,
  };
  if (options.personId) payload.personId = String(options.personId);
  return { ok: true, error: '', errors: [], payload, diff };
}

/** One human line for the confirm step. No em dashes anywhere in this feature. */
export function summarizeDiff(diff) {
  if (!diff || !diff.hasChanges) return '';
  const parts = [];
  const quantityOps = Array.isArray(diff.setQuantities) ? diff.setQuantities : [];
  const quantityIds = new Set(quantityOps.map((op) => op.id));
  const repricingOps = diff.setDiscounts.filter((op) => !quantityIds.has(op.id));
  const quantityDiscounts = diff.setDiscounts.filter((op) => quantityIds.has(op.id));
  const byPct = new Map();
  for (const op of repricingOps) byPct.set(op.pct, (byPct.get(op.pct) || 0) + 1);
  // Enumerating every distinct percent reads well for a bulk fill ("3 lines to
  // 25%") and terribly for margin pricing, where each line lands on its own
  // number. Past a handful, say how many moved and let the row list carry the
  // detail.
  if (byPct.size > 3) {
    const total = repricingOps.length;
    parts.push(`${total} line${total === 1 ? '' : 's'} repriced`);
  } else {
    for (const [pct, count] of [...byPct.entries()].sort((a, b) => b[0] - a[0])) {
      parts.push(`${count} line${count === 1 ? '' : 's'} to ${fmtPct(pct)}%`);
    }
  }
  const exact = repricingOps.filter((op) => op.dollars !== undefined).length;
  if (exact) parts.push(`${exact} priced to an exact target`);
  if (quantityOps.length) {
    const quantityPcts = new Set(quantityDiscounts.map((op) => op.pct));
    const discountNote = quantityPcts.size === 1
      ? `, discount recalculated at ${fmtPct(quantityDiscounts[0].pct)}%`
      : ', discounts recalculated';
    parts.push(`${quantityOps.length} quantity change${quantityOps.length === 1 ? '' : 's'}${discountNote}`);
  }
  if (diff.deletes.length) parts.push(`${diff.deletes.length} delete${diff.deletes.length === 1 ? '' : 's'}`);
  if (diff.reorder.length) parts.push('order changed');
  return parts.join(', ');
}

/** Totals for the before / after header, computed the same way the server will. */
export function totalsForRows(original, rows) {
  const sum = (list) => roundMoney(list.reduce((acc, row) => acc + netForRow(row), 0));
  const before = sum((Array.isArray(original) ? original : []).filter((row) => !row.deleted));
  const after = sum((Array.isArray(rows) ? rows : []).filter((row) => !row.deleted));
  return { before, after, delta: roundMoney(after - before) };
}
