/**
 * Quote Line Editor: core + component source tests (2026-08-20).
 *
 * The load-bearing assertion in this file is the FIRST one: the client's
 * dollarsForPct must equal the worker's roundMoney(list * qty * pct / 100) for
 * every shape of input. If those two ever drift, the rep approves one number in
 * the diff panel and Zoho is written a different one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetEnv = require('@babel/preset-env');
const presetReact = require('@babel/preset-react');

import {
  applyBulkDiscount,
  applyEcommPricing,
  applyMarginPricing,
  buildOpsPayload,
  clampPct,
  descriptionForPct,
  diffAgainstOriginal,
  dollarsForPct,
  effectiveDollars,
  netUnitForRow,
  marginPctForRow,
  normalizeQuantity,
  roundMoney,
  rowMatchesEcomm,
  fmtPct,
  linesFromApi,
  markSelectedForDelete,
  moveRow,
  moveRowToIndex,
  netForRow,
  pctForDollars,
  resequence,
  setAllSelected,
  setRowDiscount,
  setRowQuantity,
  summarizeDiff,
  toggleRowSelected,
  totalsForRows,
  undoDeletes,
  validateRows,
} from './src/sidebar/components/quote-line-editor-core.mjs';

// The worker's own arithmetic, copied verbatim from worker-gchat/src/index.js
// (moneyValue :14316, roundMoney :14324). Copied rather than imported because
// index.js is a 39k-line Worker module; the copy is the point of the test.
function workerMoneyValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
function workerRoundMoney(value) {
  return Math.round(workerMoneyValue(value) * 100) / 100;
}

const API = {
  quoteId: '2570562000400116511',
  quoteNumber: 'QT-1042',
  lines: [
    { id: 'r1', sku: 'MR44-HW', name: 'Meraki MR44', qty: 10, listPrice: 1495, discount: 0, description: '', sequence: 1 },
    { id: 'r2', sku: 'LIC-ENT-3YR', name: 'Meraki ENT 3Y', qty: 10, listPrice: 450, discount: 675, description: 'Renewal co-term', sequence: 2 },
    { id: 'r3', sku: 'MS130-24', name: 'Meraki MS130', qty: 2, listPrice: 2195, discount: 0, description: '', sequence: 3 },
    { id: 'r4', sku: 'MA-PWR-30W', name: 'Power adapter', qty: 2, listPrice: 125, discount: 0, description: '', sequence: 4 },
    { id: 'r5', sku: 'LIC-MS130-24-3Y', name: 'MS130 licence', qty: 2, listPrice: 320, discount: 0, description: '', sequence: 5 },
  ],
};

const rowsOf = () => linesFromApi(API);

test('dollarsForPct matches the worker roundMoney(list * qty * pct / 100) exactly', () => {
  const lists = [0, 0.01, 125, 320, 449.99, 1495, 2195, 19999.95, 123456.78];
  const qtys = [1, 2, 3, 7, 10, 250];
  const pcts = [0, 0.1, 1, 12.5, 20, 25, 33.3, 50, 66.7, 99.9, 100];
  for (const list of lists) {
    for (const qty of qtys) {
      for (const pct of pcts) {
        assert.equal(
          dollarsForPct(list, qty, pct),
          workerRoundMoney(list * qty * pct / 100),
          `list=${list} qty=${qty} pct=${pct}`,
        );
      }
    }
  }
  // String money, the shape Zoho sometimes returns, must agree too.
  assert.equal(dollarsForPct('$1,495.00', 10, 25), workerRoundMoney(1495 * 10 * 25 / 100));
});

test('percent clamps to 0..100 with one decimal and survives blank input', () => {
  assert.equal(clampPct(-5), 0);
  assert.equal(clampPct(140), 100);
  assert.equal(clampPct('25%'), 25);
  assert.equal(clampPct(12.55), 12.55);
  assert.equal(clampPct(68.333333), 68.33);
  assert.equal(clampPct(12.555), 12.56);
  assert.equal(clampPct(''), null);
  assert.equal(clampPct('abc'), null);
  assert.equal(clampPct(null), null);
});

test('quantity normalization accepts only positive safe whole numbers in the editor range', () => {
  assert.equal(normalizeQuantity(1), 1);
  assert.equal(normalizeQuantity('12'), 12);
  assert.equal(normalizeQuantity('00012'), 12);
  assert.equal(normalizeQuantity(99999), 99999);
  for (const invalid of ['', null, undefined, 0, -1, 1.5, '1.5', '1e3', 'abc', 100000, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeQuantity(invalid), null, String(invalid));
  }
});

test('descriptionForPct is the exact copy Chris chose, and never says margin', () => {
  assert.equal(descriptionForPct(0), '');
  assert.equal(descriptionForPct(null), '');
  assert.equal(descriptionForPct(-3), '');
  assert.equal(descriptionForPct(25), '25% Discount');
  assert.equal(descriptionForPct(25.0), '25% Discount');
  assert.equal(descriptionForPct(12.5), '12.5% Discount');
  assert.equal(descriptionForPct(100), '100% Discount');
  assert.equal(fmtPct(25.0), '25');
  assert.equal(fmtPct(12.5), '12.5');

  for (let pct = 0; pct <= 100; pct += 0.1) {
    const text = descriptionForPct(pct);
    assert.doesNotMatch(text, /margin/i, `descriptionForPct(${pct}) must never mention margin`);
    // No em dashes anywhere in this feature, especially in quote text.
    assert.doesNotMatch(text, /[\u2014\u2013]/, `descriptionForPct(${pct}) must not contain an em or en dash`);
  }
});

test('linesFromApi derives percent from the dollar discount Zoho actually stores', () => {
  const rows = rowsOf();
  assert.equal(rows.length, 5);
  assert.equal(rows[0].discountPct, 0);
  // 675 off a 450 x 10 = 4500 gross line is 15%.
  assert.equal(rows[1].discountPct, 15);
  assert.equal(rows[1].description, 'Renewal co-term');
  assert.deepEqual(rows.map((row) => row.sequence), [1, 2, 3, 4, 5]);
  assert.equal(pctForDollars(0, 0, 0), 0, 'a zero-gross line reads as 0% instead of dividing by zero');
});

test('buildOpsPayload emits nothing for an untouched quote', () => {
  const original = rowsOf();
  const built = buildOpsPayload(original, original.map((row) => ({ ...row })), { recordId: API.quoteId });
  assert.equal(built.ok, false);
  assert.equal(built.payload, null);
  assert.match(built.error, /Nothing has changed/);
  assert.equal(diffAgainstOriginal(original, original).hasChanges, false);
});

test('an untouched hand-written description is left alone, but re-applying its own percent replaces it', () => {
  const original = rowsOf();
  // r2 sits at 15% with the note "Renewal co-term". Editing some OTHER line must
  // not quietly normalize that note into "15% Discount".
  const other = setRowDiscount(original, 'r1', 25);
  const untouchedDiff = diffAgainstOriginal(original, other);
  assert.deepEqual(untouchedDiff.setDiscounts.map((op) => op.id), ['r1']);
  assert.equal(untouchedDiff.descriptionChanges.some((change) => change.id === 'r2'), false);

  // Deliberately setting r2 to the percent it already has IS an edit, and Chris
  // chose full replacement, so the note goes.
  const deliberate = diffAgainstOriginal(original, setRowDiscount(original, 'r2', 15));
  assert.deepEqual(deliberate.setDiscounts, [{ id: 'r2', pct: 15 }]);
  assert.deepEqual(deliberate.descriptionChanges, [
    { id: 'r2', sku: 'LIC-ENT-3YR', from: 'Renewal co-term', to: '15% Discount' },
  ]);
});

test('description writing can be disabled without suppressing discount or quantity edits', () => {
  const original = rowsOf();
  const discounted = applyBulkDiscount(original, 25);
  const diff = diffAgainstOriginal(original, discounted, { writeDescriptions: false });
  assert.equal(diff.setDiscounts.length, 5);
  assert.deepEqual(diff.descriptionChanges, []);

  const built = buildOpsPayload(original, discounted, {
    recordId: API.quoteId,
    writeDescriptions: false,
  });
  assert.equal(built.ok, true);
  assert.equal(built.payload.writeDescriptions, false);
  assert.deepEqual(built.diff.descriptionChanges, []);
  assert.deepEqual(discounted.map((row) => row.description), original.map((row) => row.description),
    'the editor never mutates an existing description locally');

  // Re-applying the same percent is a description-only operation when enabled.
  // With the checkbox off, it is correctly a complete no-op and preserves both
  // the hand-written note and every blank description.
  const samePercent = setRowDiscount(original, 'r2', 15);
  assert.equal(diffAgainstOriginal(original, samePercent).hasChanges, true);
  assert.equal(diffAgainstOriginal(original, samePercent, { writeDescriptions: false }).hasChanges, false);
  assert.equal(buildOpsPayload(original, samePercent, {
    recordId: API.quoteId,
    writeDescriptions: false,
  }).ok, false);
});

test('a quantity edit is normalized, recalculates dollars, and emits quantity plus discount atomically', () => {
  const original = rowsOf();
  const rows = setRowQuantity(original, 'r2', '12');
  const row = rows.find((candidate) => candidate.id === 'r2');
  assert.equal(original.find((candidate) => candidate.id === 'r2').qty, 10, 'the original snapshot is immutable');
  assert.equal(row.qty, 12);
  assert.equal(row.discountPct, 15, 'the reviewed discount percent is preserved');
  assert.equal(row.discountDollars, null, 'stale exact dollars are dropped before recalculation');
  assert.equal(effectiveDollars(row), 810, '450 x 12 x 15%');
  assert.equal(netForRow(row), 4590);
  assert.equal(row.dirty, true);

  const diff = diffAgainstOriginal(original, rows);
  assert.deepEqual(diff.setQuantities, [{ id: 'r2', qty: 12 }]);
  assert.deepEqual(diff.setDiscounts, [{ id: 'r2', pct: 15 }]);
  assert.equal(summarizeDiff(diff), '1 quantity change, discount recalculated at 15%');

  const built = buildOpsPayload(original, rows, { recordId: API.quoteId });
  assert.deepEqual(built.payload.ops.setQuantities, [{ id: 'r2', qty: 12 }]);
  assert.deepEqual(built.payload.ops.setDiscounts, [{ id: 'r2', pct: 15 }]);
  assert.equal(built.payload.writeDescriptions, true);

  const preserving = buildOpsPayload(original, rows, {
    recordId: API.quoteId,
    writeDescriptions: false,
  });
  assert.equal(preserving.ok, true);
  assert.deepEqual(preserving.diff.descriptionChanges, []);
  assert.deepEqual(preserving.payload.ops.setQuantities, [{ id: 'r2', qty: 12 }]);
  assert.deepEqual(preserving.payload.ops.setDiscounts, [{ id: 'r2', pct: 15 }]);
});

test('a quantity edit rejects unsafe values and invalidates stale pricing badges', () => {
  const original = rowsOf();
  for (const invalid of ['', 0, -1, 1.5, '1e3', 100000, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(setRowQuantity(original, 'r2', invalid), original, String(invalid));
  }
  assert.deepEqual(setRowQuantity(original, 'r2', 10), original, 're-entering the same quantity is a no-op');

  const priced = original.map((row) => (row.id === 'r2' ? {
    ...row,
    ecomm: { price: 382.5 },
    ecommError: 'old ecomm warning',
    cost: { distiTotal: 2000 },
    costError: 'old cost warning',
  } : row));
  const changed = setRowQuantity(priced, 'r2', 11).find((row) => row.id === 'r2');
  assert.equal(changed.ecomm, null);
  assert.equal(changed.ecommError, '');
  assert.equal(changed.cost, null);
  assert.equal(changed.costError, '');
});

test('a quantity edit followed by exact pricing carries fresh dollars against the new quantity', () => {
  const original = rowsOf();
  const resized = setRowQuantity(original, 'r3', 3);
  const ecommRows = applyEcommPricing(resized, [{
    id: 'r3', listPrice: 2195, ecommPrice: 1920.63, source: 'live_zoho_wooproducts', error: '',
  }]);
  const ecommRow = ecommRows.find((row) => row.id === 'r3');
  assert.equal(ecommRow.discountDollars, 823.11, '(2195 - 1920.63) x the new quantity of 3');
  assert.equal(ecommRow.discountPct, 12.5);
  assert.equal(netUnitForRow(ecommRow), 1920.63);

  const ecommPayload = buildOpsPayload(original, ecommRows, { recordId: API.quoteId }).payload;
  assert.deepEqual(ecommPayload.ops.setQuantities, [{ id: 'r3', qty: 3 }]);
  assert.deepEqual(ecommPayload.ops.setDiscounts, [{ id: 'r3', pct: 12.5, dollars: 823.11 }],
    'fresh exact dollars must not be dropped merely because quantity also moved');
  assert.equal(dollarsForPct(2195, 3, 12.5), 823.13,
    'the rounded percent would miss storefront parity by two cents');

  // Margin pricing uses the same exact-dollar seam and must survive the same
  // quantity-plus-discount atomic payload.
  const marginRows = applyMarginPricing(resized, [{ id: 'r3', distiTotal: 5000, error: '' }], 10);
  const marginRow = marginRows.find((row) => row.id === 'r3');
  assert.equal(marginRow.discountDollars, 1029.44);
  const marginPayload = buildOpsPayload(original, marginRows, { recordId: API.quoteId }).payload;
  assert.deepEqual(marginPayload.ops.setQuantities, [{ id: 'r3', qty: 3 }]);
  assert.deepEqual(marginPayload.ops.setDiscounts, [{ id: 'r3', pct: 15.63, dollars: 1029.44 }]);
});

test('a bulk 25% fills every surviving row and rewrites every description', () => {
  const original = rowsOf();
  const rows = applyBulkDiscount(original, 25);
  const diff = diffAgainstOriginal(original, rows);
  assert.equal(diff.setDiscounts.length, 5);
  assert.equal(diff.deletes.length, 0);
  assert.equal(diff.reorder.length, 0);
  assert.ok(diff.setDiscounts.every((op) => op.pct === 25));
  // The line that already carried a note has it REPLACED, per Chris's decision.
  const replaced = diff.descriptionChanges.find((change) => change.id === 'r2');
  assert.equal(replaced.from, 'Renewal co-term');
  assert.equal(replaced.to, '25% Discount');
  assert.equal(summarizeDiff(diff), '5 lines to 25%');
});

test('a row set back to 0% clears its description instead of writing 0% Discount', () => {
  const original = rowsOf();
  let rows = applyBulkDiscount(original, 25);
  rows = setRowDiscount(rows, 'r2', 0);
  const diff = diffAgainstOriginal(original, rows);
  const zeroed = diff.descriptionChanges.find((change) => change.id === 'r2');
  assert.equal(zeroed.to, '');
  assert.equal(diff.setDiscounts.find((op) => op.id === 'r2').pct, 0);
  assert.equal(summarizeDiff(diff), '4 lines to 25%, 1 line to 0%');
});

test('a deleted row emits only a delete, never a discount and never a sequence', () => {
  const original = rowsOf();
  let rows = applyBulkDiscount(original, 25);
  rows = setRowQuantity(rows, 'r4', 3);
  rows = toggleRowSelected(rows, 'r4');
  rows = markSelectedForDelete(rows);
  rows = resequence(rows);

  const diff = diffAgainstOriginal(original, rows);
  assert.deepEqual(diff.deletes, ['r4']);
  assert.equal(diff.setDiscounts.some((op) => op.id === 'r4'), false);
  assert.equal(diff.setQuantities.some((op) => op.id === 'r4'), false);
  assert.equal(diff.reorder.includes('r4'), false);
  assert.equal(rows.find((row) => row.id === 'r4').sequence, null);
  // Surviving rows renumber densely; that alone is not a reorder.
  assert.deepEqual(rows.filter((row) => !row.deleted).map((row) => row.sequence), [1, 2, 3, 4]);
  assert.equal(diff.reorder.length, 0, 'a delete must not be reported as an order change');

  const built = buildOpsPayload(original, rows, { recordId: API.quoteId });
  assert.equal(built.ok, true);
  assert.equal(built.payload.ops.deletes.length, 1);
  assert.equal(built.payload.ops.setDiscounts.some((op) => op.id === 'r4'), false);
  assert.equal(built.payload.ops.setQuantities.some((op) => op.id === 'r4'), false);
  assert.equal(JSON.stringify(built.payload.ops.reorder), '[]');
  // A bulk discount applied BEFORE the delete must not leak an op for that row.
  assert.equal(applyBulkDiscount(rows, 40).find((row) => row.id === 'r4').discountPct, 25);
});

test('deleting every line produces a payload the validator rejects', () => {
  const original = rowsOf();
  let rows = setAllSelected(original, true);
  rows = markSelectedForDelete(rows);
  const validation = validateRows(rows);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors[0].code, 'delete_all');
  const built = buildOpsPayload(original, rows, { recordId: API.quoteId });
  assert.equal(built.ok, false);
  assert.equal(built.payload, null);
  // ...and undoing the deletes puts it right back to a valid, no-op state.
  assert.equal(validateRows(undoDeletes(rows)).ok, true);
});

test('validateRows fails closed on a duplicate id, a missing id, and a bad percent', () => {
  const original = rowsOf();
  assert.equal(validateRows([...original, { ...original[0] }]).errors[0].code, 'duplicate_id');
  assert.equal(validateRows([{ ...original[0], id: '' }]).errors[0].code, 'missing_id');
  assert.equal(validateRows([{ ...original[0], discountPct: 'abc' }]).errors[0].code, 'invalid_pct');
  assert.equal(validateRows([{ ...original[0], qty: 0 }]).errors[0].code, 'invalid_quantity');
  assert.equal(validateRows([{ ...original[0], qty: 1.5 }]).errors[0].code, 'invalid_quantity');
  assert.equal(validateRows([{ ...original[0], qty: Number.MAX_SAFE_INTEGER + 1 }]).errors[0].code, 'invalid_quantity');
  assert.equal(validateRows([]).errors[0].code, 'no_rows');
});

test('resequence yields a dense 1..n over survivors only', () => {
  let rows = rowsOf();
  rows = markSelectedForDelete(toggleRowSelected(toggleRowSelected(rows, 'r2'), 'r4'));
  rows = resequence(rows);
  assert.deepEqual(rows.map((row) => row.sequence), [1, null, 2, null, 3]);
});

test('moveRow and moveRowToIndex round trip and are stable at the boundaries', () => {
  const original = rowsOf();
  const ids = (rows) => rows.map((row) => row.id);

  assert.deepEqual(ids(moveRow(original, 'r1', 'up')), ids(original), 'first row cannot move up');
  assert.deepEqual(ids(moveRow(original, 'r5', 'down')), ids(original), 'last row cannot move down');
  assert.deepEqual(ids(moveRow(original, 'r9', 'up')), ids(original), 'an unknown id is a no-op');

  const down = moveRow(original, 'r1', 'down');
  assert.deepEqual(ids(down), ['r2', 'r1', 'r3', 'r4', 'r5']);
  assert.deepEqual(ids(moveRow(down, 'r1', 'up')), ids(original), 'down then up round trips');

  assert.deepEqual(ids(moveRowToIndex(original, 'r5', 0)), ['r5', 'r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(ids(moveRowToIndex(original, 'r1', 99)), ['r2', 'r3', 'r4', 'r5', 'r1'], 'index clamps to the end');
  assert.deepEqual(ids(moveRowToIndex(original, 'r1', -5)), ids(original), 'index clamps to the start');
  assert.deepEqual(ids(moveRowToIndex(original, 'r3', 2)), ids(original), 'dropping a row on itself is a no-op');
  assert.deepEqual(
    ids(moveRowToIndex(moveRowToIndex(original, 'r5', 0), 'r5', 4)),
    ids(original),
    'moveRowToIndex round trips',
  );
  // Reordering renumbers, and the diff reports it as a reorder over survivors.
  const moved = moveRowToIndex(original, 'r5', 0);
  assert.deepEqual(moved.map((row) => row.sequence), [1, 2, 3, 4, 5]);
  const diff = diffAgainstOriginal(original, moved);
  assert.deepEqual(diff.reorder, ['r5', 'r1', 'r2', 'r3', 'r4']);
  assert.equal(diff.setDiscounts.length, 0, 'a pure reorder emits no discount ops');
  assert.equal(summarizeDiff(diff), 'order changed');
});

test('the full mixed commit carries discounts, deletes and reorder in one payload', () => {
  const original = rowsOf();
  let rows = applyBulkDiscount(original, 25);
  rows = setRowDiscount(rows, 'r3', 12.5);
  rows = markSelectedForDelete(toggleRowSelected(toggleRowSelected(rows, 'r4'), 'r5'));
  rows = moveRowToIndex(rows, 'r3', 0);

  const built = buildOpsPayload(original, rows, { recordId: API.quoteId, module: 'Quotes', personId: 'chris' });
  assert.equal(built.ok, true);
  assert.equal(built.payload.recordId, API.quoteId);
  assert.equal(built.payload.module, 'Quotes');
  assert.equal(built.payload.personId, 'chris');
  assert.equal(built.payload.writeDescriptions, true);
  assert.deepEqual(built.payload.ops.deletes.sort(), ['r4', 'r5']);
  assert.deepEqual(built.payload.ops.setQuantities, []);
  assert.deepEqual(
    built.payload.ops.setDiscounts.map((op) => [op.id, op.pct]).sort(),
    [['r1', 25], ['r2', 25], ['r3', 12.5]],
  );
  assert.deepEqual(built.payload.ops.reorder, ['r3', 'r1', 'r2']);
  // Deleted ids appear in exactly one op list.
  for (const id of built.payload.ops.deletes) {
    assert.equal(built.payload.ops.setDiscounts.some((op) => op.id === id), false);
    assert.equal(built.payload.ops.reorder.includes(id), false);
  }
  assert.equal(summarizeDiff(built.diff), '2 lines to 25%, 1 line to 12.5%, 2 deletes, order changed');
});

test('the client preview totals equal the sum of the worker discount arithmetic', () => {
  const original = rowsOf();
  const rows = applyBulkDiscount(original, 25);
  const totals = totalsForRows(original, rows);
  const expectedAfter = workerRoundMoney(rows.reduce((acc, row) => {
    const gross = row.listPrice * row.qty;
    return acc + gross - workerRoundMoney(gross * 25 / 100);
  }, 0));
  assert.equal(totals.after, expectedAfter);
  assert.ok(totals.after < totals.before);
  assert.equal(netForRow(rows[0]), workerRoundMoney(1495 * 10 - workerRoundMoney(1495 * 10 * 25 / 100)));
});

// ── Ecomm price matching (2026-08-20) ────────────────────────────────────────

// What POST /api/quote-line-ecomm returns: a live storefront price, a SKU with
// no WooProducts row (quoted at list), and one the lookup could not resolve.
const ECOMM = [
  { id: 'r1', sku: 'MR44-HW', qty: 10, listPrice: 1495, ecommPrice: 1121.25, source: 'live_zoho_wooproducts', error: '' },
  { id: 'r2', sku: 'LIC-ENT-3YR', qty: 10, listPrice: 450, ecommPrice: 337.5, source: 'live_zoho_wooproducts', error: '' },
  { id: 'r3', sku: 'MS130-24', qty: 2, listPrice: 2195, ecommPrice: 1920.63, source: 'live_zoho_wooproducts', error: '' },
  { id: 'r4', sku: 'MA-PWR-30W', qty: 2, listPrice: 125, ecommPrice: 125, source: 'live_zoho_products_list_only', error: '' },
  { id: 'r5', sku: 'LIC-MS130-24-3Y', qty: 2, listPrice: 320, ecommPrice: 0, source: null, error: 'Live WooProducts Stratus_Price was not found' },
];

test('an ecomm match writes the EXACT dollar gap, not a rounded percent', () => {
  const original = rowsOf();
  const rows = applyEcommPricing(original, ECOMM);

  // MS130-24 is the case the whole exact-dollar path exists for: list 2195 x 2
  // is 4390 gross, ecomm 1920.63 x 2 is 3841.26, so the true discount is
  // $548.74. The one-decimal percent (12.5%) would write $548.75 and put the
  // line a cent off the storefront.
  const ms = rows.find((row) => row.id === 'r3');
  assert.equal(ms.discountDollars, 548.74);
  assert.equal(ms.discountPct, 12.5);
  assert.equal(effectiveDollars(ms), 548.74);
  assert.notEqual(effectiveDollars(ms), dollarsForPct(ms.listPrice, ms.qty, ms.discountPct));
  assert.equal(netUnitForRow(ms), 1920.63, 'the unit price must land exactly on the ecomm price');
  assert.equal(rowMatchesEcomm(ms), true);

  // A line whose percent happens to be exact still carries the dollars.
  const mr = rows.find((row) => row.id === 'r1');
  assert.equal(mr.discountDollars, 3737.5);
  assert.equal(netUnitForRow(mr), 1121.25);

  const payload = buildOpsPayload(original, rows, { recordId: API.quoteId }).payload;
  const opMs = payload.ops.setDiscounts.find((op) => op.id === 'r3');
  assert.deepEqual(opMs, { id: 'r3', pct: 12.5, dollars: 548.74 });
  // The percent must still DESCRIBE the dollars, because it is what the written
  // Description says. The worker rejects the payload otherwise.
  for (const op of payload.ops.setDiscounts) {
    const row = original.find((r) => r.id === op.id);
    const gross = row.listPrice * row.qty;
    assert.ok(Math.abs(op.dollars - (gross * op.pct / 100)) <= Math.max(1, gross * 0.001),
      `${op.id}: ${op.dollars} must be describable as ${op.pct}% of ${gross}`);
  }
});

test('a line the worker could not price is left EXACTLY as it was', () => {
  const original = rowsOf();
  const rows = applyEcommPricing(original, ECOMM);
  const unresolved = rows.find((row) => row.id === 'r5');
  const before = original.find((row) => row.id === 'r5');
  assert.equal(unresolved.dirty, false);
  assert.equal(unresolved.discountDollars, before.discountDollars, 'untouched means the stored discount is unchanged');
  assert.equal(unresolved.discountPct, before.discountPct);
  assert.match(unresolved.ecommError, /Stratus_Price was not found/);

  const payload = buildOpsPayload(original, rows, { recordId: API.quoteId }).payload;
  assert.equal(payload.ops.setDiscounts.some((op) => op.id === 'r5'), false,
    'one unpriceable SKU must never be silently repriced, and must not block the rest');
  assert.equal(payload.ops.setDiscounts.length, 3, 'the three lines that resolved still commit');

  // A line already sitting at its ecomm price is matched but emits no op.
  assert.equal(rows.find((row) => row.id === 'r4').ecomm.price, 125);
  assert.equal(payload.ops.setDiscounts.some((op) => op.id === 'r4'), false);
});

test('an ecomm price above list is refused rather than written as a negative discount', () => {
  const original = rowsOf();
  const rows = applyEcommPricing(original, [{ id: 'r1', listPrice: 1495, ecommPrice: 1600, error: '' }]);
  const row = rows.find((r) => r.id === 'r1');
  assert.equal(row.discountDollars, original.find((r) => r.id === 'r1').discountDollars);
  assert.equal(row.dirty, false);
  assert.match(row.ecommError, /above this line's list price/);
  assert.equal(diffAgainstOriginal(original, rows).hasChanges, false);
});

test('an ecomm match discounts against the LINE list price, never the catalog one', () => {
  // The screenshot case (2026-08-20): the quote line is stored at 200.70, the
  // catalog now says 200.00, the storefront sells at 116.00.
  //
  // Zoho subtracts Discount from the LINE's stored List_Price x Quantity, and
  // this feature never rewrites List_Price. Pricing against the catalog list
  // wrote 2604.00, so the card previewed 3596.00 while Zoho would have computed
  // 3617.70: the rep approves one number and the customer sees another.
  const original = linesFromApi({
    lines: [{ id: 'x', sku: 'LIC-ENT-1YR', qty: 31, listPrice: 200.7, discount: 0, description: '' }],
  });
  const rows = applyEcommPricing(original, [{ id: 'x', listPrice: 200, ecommPrice: 116, error: '' }]);
  const row = rows[0];

  assert.equal(row.listPrice, 200.7, 'the line list price must NOT be overwritten by the catalog');
  assert.equal(row.discountDollars, 2625.7, '(200.70 - 116.00) x 31 against the line list');
  assert.notEqual(row.discountDollars, 2604, 'the catalog-list figure is the bug');
  assert.equal(netForRow(row), 3596, 'preview net');
  assert.equal(roundMoney(200.7 * 31 - row.discountDollars), netForRow(row),
    'what Zoho will compute must equal what the card previews');
  assert.equal(netUnitForRow(row), 116, 'the customer pays exactly the ecomm price');
  // A stale line list is worth saying, but it never blocks the match.
  assert.match(row.ecommError, /stored at list 200.7 but the catalog now says 200/);
  assert.ok(row.ecomm, 'the row is still matched');
});

test('a storefront price conflict is reported rather than silently picked', () => {
  const original = linesFromApi({
    lines: [{ id: 'x', sku: 'LIC-ENT-1YR', qty: 31, listPrice: 200.7, discount: 0, description: '' }],
  });
  const rows = applyEcommPricing(original, [
    { id: 'x', listPrice: 200.7, ecommPrice: 116, priceConflict: [116, 117], error: '' },
  ]);
  assert.match(rows[0].ecommError, /more than one price for this SKU \(116, 117\)/);
  assert.equal(rows[0].discountDollars, roundMoney((200.7 - 116) * 31), 'it still matches the chosen price');
  assert.ok(rows[0].ecomm);
});

test('an ecomm price resolved under a DIFFERENT sku is flagged, never silent', () => {
  // The MS130-48X case (2026-08-20). applySuffix turned the line's SKU into
  // MS130-48X-HW, WooProducts had no such row, and the cache answered under the
  // suffixed key with a different product's price: $5,474 instead of $4,947, so
  // 6 units read $32,844 instead of $29,682.
  //
  // The worker now refuses that outright on the list-price gap. If a future SKU
  // slips past it, the rep still sees where the number came from.
  const original = linesFromApi({
    lines: [{ id: 'x', sku: 'MS130-48X', qty: 6, listPrice: 10625.63, discount: 0, description: '' }],
  });
  const flagged = applyEcommPricing(original, [
    { id: 'x', listPrice: 10625.63, ecommPrice: 4947, resolvedUnder: 'MS130-48X-HW', error: '' },
  ]);
  assert.match(flagged[0].ecommError, /No storefront row for MS130-48X; this price was resolved under MS130-48X-HW/);
  assert.ok(flagged[0].ecomm, 'it is a warning, not a block');

  // The exact-row price produces the number Chris expects.
  const correct = applyEcommPricing(original, [{ id: 'x', listPrice: 10625.63, ecommPrice: 4947, error: '' }]);
  assert.equal(netForRow(correct[0]), 29682, '6 x 4947');
  assert.equal(netUnitForRow(correct[0]), 4947);
  assert.equal(correct[0].ecommError, '', 'an exact match needs no warning');

  // The wrong price would have produced the number he saw.
  const wrong = applyEcommPricing(original, [{ id: 'x', listPrice: 10625.63, ecommPrice: 5474, error: '' }]);
  assert.equal(netForRow(wrong[0]), 32844, 'the reported symptom');
});

test('a manual percent edit clears the ecomm override so the two never disagree', () => {
  const original = rowsOf();
  const matched = applyEcommPricing(original, ECOMM);
  assert.equal(matched.find((r) => r.id === 'r3').discountDollars, 548.74);

  const perRow = setRowDiscount(matched, 'r3', 30);
  const row = perRow.find((r) => r.id === 'r3');
  assert.equal(row.discountDollars, null, 'a typed percent must drop the storefront dollars');
  assert.equal(row.ecomm, null);
  assert.equal(effectiveDollars(row), dollarsForPct(row.listPrice, row.qty, 30));

  const bulk = applyBulkDiscount(matched, 40);
  assert.ok(bulk.every((r) => r.discountDollars === null && r.ecomm === null));

  const payload = buildOpsPayload(original, bulk, { recordId: API.quoteId }).payload;
  assert.ok(payload.ops.setDiscounts.every((op) => op.dollars === undefined),
    'a plain percent commit must let the worker recompute the dollars');
});

test('validateRows rejects an exact-dollar discount above the line gross', () => {
  const original = rowsOf();
  const rows = original.map((row) => (row.id === 'r1' ? { ...row, discountDollars: 99999, dirty: true } : row));
  const validation = validateRows(rows);
  assert.equal(validation.ok, false);
  assert.equal(validation.errors[0].code, 'discount_out_of_range');
  assert.equal(buildOpsPayload(original, rows, { recordId: API.quoteId }).ok, false);
});

// ── Margin pricing (2026-08-20) ──────────────────────────────────────────────
//
// THE FIXTURE IS REAL. These six lines and their distributor costs are Quote
// 2570562000422125077 as Zoho actually holds it, and `zohoDiscount` is the
// Discount value Zoho's own margin function stored on each line at 10% margin.
// If applyMarginPricing ever stops reproducing those numbers to the cent, the
// editor has stopped agreeing with Zoho and this test fails.

const REAL_QUOTE = {
  lines: [
    { id: 'q1', sku: 'CW9176D1-RTG', qty: 31, listPrice: 3636.11, discount: 0, description: '' },
    { id: 'q2', sku: 'LIC-ENT-1YR', qty: 31, listPrice: 200.7, discount: 0, description: '' },
    { id: 'q3', sku: 'MS150-48LP-4X', qty: 36, listPrice: 9783.61, discount: 0, description: '' },
    { id: 'q4', sku: 'LIC-MS150-48-1Y', qty: 36, listPrice: 298.49, discount: 0, description: '' },
    { id: 'q5', sku: 'MS130-48X', qty: 6, listPrice: 10625.63, discount: 0, description: '' },
    { id: 'q6', sku: 'LIC-MS130-48-1Y', qty: 6, listPrice: 298.49, discount: 0, description: '' },
  ],
};
const REAL_COSTS = [
  { id: 'q1', sku: 'CW9176D1-RTG', qty: 31, distiTotal: 40015.42, error: '' },
  { id: 'q2', sku: 'LIC-ENT-1YR', qty: 31, distiTotal: 2270.75, error: '' },
  { id: 'q3', sku: 'MS150-48LP-4X', qty: 36, distiTotal: 100379.88, error: '' },
  { id: 'q4', sku: 'LIC-MS150-48-1Y', qty: 36, distiTotal: 3492.36, error: '' },
  { id: 'q5', sku: 'MS130-48X', qty: 6, distiTotal: 19444.92, error: '' },
  { id: 'q6', sku: 'LIC-MS130-48-1Y', qty: 6, distiTotal: 653.7, error: '' },
];
// What Zoho itself wrote at 10% margin.
const ZOHO_AT_10 = { q1: 68257.83, q2: 3698.64, q3: 240676.76, q4: 6865.24, q5: 42148.31, q6: 1064.61 };

test('applyMarginPricing reproduces Zoho stored Discount to the cent on a real quote', () => {
  const original = linesFromApi(REAL_QUOTE);
  const rows = applyMarginPricing(original, REAL_COSTS, 10);
  for (const row of rows) {
    assert.equal(row.discountDollars, ZOHO_AT_10[row.id], `${row.sku} must match Zoho exactly`);
    // ...and every line reads back as exactly the requested margin.
    assert.equal(marginPctForRow(row), 10, `${row.sku} must achieve 10% margin`);
  }

  // Margin is NOT markup. 10% margin on 100379.88 of cost sells at 111533.20
  // (gross profit 11153.32, which is 10% OF THE SELL). A markup calculation
  // would give 110417.87 and quietly under-earn on every quote.
  const ms150 = rows.find((row) => row.id === 'q3');
  assert.equal(ms150.cost.sell, 111533.2);
  assert.equal(ms150.cost.grossProfit, 11153.32);
  assert.notEqual(ms150.cost.sell, 110417.87);

  // Rounding ORDER matters: Zoho rounds the sell to cents first, then
  // subtracts. The other order misses LIC-MS130-48-1Y by a cent.
  const lic = rows.find((row) => row.id === 'q6');
  assert.equal(lic.cost.sell, 726.33);
  assert.equal(lic.discountDollars, 1064.61);
});

test('the diff summary stays readable when every line lands on its own percent', () => {
  const original = linesFromApi(REAL_QUOTE);
  const diff = diffAgainstOriginal(original, applyMarginPricing(original, REAL_COSTS, 10));
  // Six distinct percents would otherwise enumerate as an unreadable list.
  assert.equal(summarizeDiff(diff), '6 lines repriced, 6 priced to an exact target');
  // A bulk fill still reads the useful way.
  assert.equal(summarizeDiff(diffAgainstOriginal(original, applyBulkDiscount(original, 25))), '6 lines to 25%');
});

test('a margin commit sends exact dollars with a two-decimal percent, like Zoho writes', () => {
  const original = linesFromApi(REAL_QUOTE);
  const rows = applyMarginPricing(original, REAL_COSTS, 10);
  const payload = buildOpsPayload(original, rows, { recordId: '2570562000422125077' }).payload;

  const ms150 = payload.ops.setDiscounts.find((op) => op.id === 'q3');
  assert.equal(ms150.dollars, 240676.76);
  assert.equal(ms150.pct, 68.33, 'Zoho writes two decimals, so 68.33 not 68.3');
  assert.equal(descriptionForPct(ms150.pct), '68.33% Discount');

  // Every op must carry exact dollars, and the percent must still describe them
  // within the tolerance the worker enforces.
  for (const op of payload.ops.setDiscounts) {
    assert.notEqual(op.dollars, undefined, `${op.id} must send exact dollars`);
    const row = original.find((r) => r.id === op.id);
    const gross = row.listPrice * row.qty;
    assert.ok(Math.abs(op.dollars - (gross * op.pct / 100)) <= Math.max(1, gross * 0.001),
      `${op.id}: ${op.dollars} must be describable as ${op.pct}%`);
  }
});

test('re-applying the margin a quote already sits at is a no-op commit', () => {
  // Quote 2570562000422125077 is already at 10%. Loading it and asking for 10%
  // again must produce NOTHING to write, not a churn of identical values.
  const priced = REAL_QUOTE.lines.map((line) => ({
    ...line,
    discount: ZOHO_AT_10[line.id],
    description: descriptionForPct(pctForDollars(line.listPrice, line.qty, ZOHO_AT_10[line.id])),
  }));
  const original = linesFromApi({ lines: priced });
  const rows = applyMarginPricing(original, REAL_COSTS, 10);
  for (const row of rows) assert.equal(row.discountDollars, ZOHO_AT_10[row.id]);
  const diff = diffAgainstOriginal(original, rows);
  assert.equal(diff.setDiscounts.length, 0, 'no discount moved, so no op');
  assert.equal(diff.hasChanges, false);
  assert.equal(buildOpsPayload(original, rows, { recordId: '1234567890' }).ok, false);

  // CAVEAT, and it is real: on a quote Zoho itself priced, the stored label may
  // still differ. Zoho's own descriptions on this quote are not internally
  // consistent (it wrote "60.55% Discount" where the discount rounds to 60.56,
  // and "63.90%" where it rounds to 63.89). Those lines emit a
  // description-only update whose DOLLARS do not move, which is correct: the
  // label is being brought in line with the money already on the quote.
  const zohoLabelled = REAL_QUOTE.lines.map((line) => ({
    ...line, discount: ZOHO_AT_10[line.id], description: '60.55% Discount',
  }));
  const zohoOriginal = linesFromApi({ lines: zohoLabelled });
  const relabelled = diffAgainstOriginal(zohoOriginal, applyMarginPricing(zohoOriginal, REAL_COSTS, 10));
  for (const op of relabelled.setDiscounts) {
    assert.equal(op.dollars, ZOHO_AT_10[op.id], `${op.id}: a relabel must not move the money`);
  }
});

test('a line with no usable cost row is left EXACTLY as it was', () => {
  const original = linesFromApi(REAL_QUOTE);
  const costs = [
    { id: 'q1', distiTotal: 40015.42, error: '' },
    { id: 'q2', distiTotal: 0, error: 'No distributor-cost row for LIC-ENT-1YR.' },
    { id: 'q3', distiTotal: 0, error: '' },
    // Cost priced for a different quantity is stale, and the worker says so.
    { id: 'q4', distiTotal: 3492.36, error: 'The cost row for LIC-MS150-48-1Y is priced for 12, but this line is 36.' },
  ];
  const rows = applyMarginPricing(original, costs, 10);
  assert.equal(rows.find((r) => r.id === 'q1').discountDollars, 68257.83);
  for (const id of ['q2', 'q3', 'q4']) {
    const row = rows.find((r) => r.id === id);
    const was = original.find((r) => r.id === id);
    assert.equal(row.discountDollars, was.discountDollars, `${id} must not be repriced`);
    assert.equal(row.discountPct, was.discountPct, `${id} must keep its percent`);
    assert.equal(row.dirty, false);
    assert.ok(row.costError, `${id} must say why`);
  }
  // Lines the worker did not mention at all are untouched and silent.
  for (const id of ['q5', 'q6']) {
    assert.equal(rows.find((r) => r.id === id).costError, '');
    assert.equal(rows.find((r) => r.id === id).dirty, false);
  }
  const payload = buildOpsPayload(original, rows, { recordId: '1234567890' }).payload;
  assert.deepEqual(payload.ops.setDiscounts.map((op) => op.id), ['q1']);
});

test('a margin that cannot be reached without pricing above list is refused', () => {
  const original = linesFromApi(REAL_QUOTE);
  // Cost is 95% of the line list, so even 10% margin would need a sell above list.
  const costs = [{ id: 'q1', distiTotal: 107083.44, error: '' }];
  const rows = applyMarginPricing(original, costs, 10);
  const row = rows.find((r) => r.id === 'q1');
  assert.equal(row.discountDollars, original.find((r) => r.id === 'q1').discountDollars);
  assert.equal(row.dirty, false);
  assert.match(row.costError, /too high to reach/);
  assert.equal(diffAgainstOriginal(original, rows).hasChanges, false);

  // And an out-of-range margin is refused before any arithmetic.
  // A negative margin must be REFUSED, not clamped to 0: pricing at 0% margin
  // means selling at distributor cost, which nobody types "-1" to request.
  for (const bad of [95, 120, -1, 'lots', '', null]) {
    const out = applyMarginPricing(original, REAL_COSTS, bad);
    const got = out.find((r) => r.id === 'q1');
    assert.equal(got.discountDollars, original.find((r) => r.id === 'q1').discountDollars, String(bad));
    assert.equal(got.dirty, false, String(bad));
    assert.match(got.costError, /between 0 and 95/, String(bad));
  }
  // 0 itself IS valid: it means sell at cost, deliberately.
  assert.equal(applyMarginPricing(original, REAL_COSTS, 0).find((r) => r.id === 'q1').cost.sell, 40015.42);
});

test('margin and ecomm are mutually exclusive, and a typed percent clears both', () => {
  const original = linesFromApi(REAL_QUOTE);
  const margined = applyMarginPricing(original, REAL_COSTS, 10);
  assert.ok(margined[0].cost);
  assert.equal(margined[0].ecomm, null, 'a margin price is not an ecomm price');

  const thenEcomm = applyEcommPricing(margined, [{ id: 'q1', listPrice: 3636.11, ecommPrice: 1800, error: '' }]);
  assert.equal(thenEcomm.find((r) => r.id === 'q1').cost, null, 'ecomm must clear the margin badge');
  assert.ok(thenEcomm.find((r) => r.id === 'q1').ecomm);

  const typed = setRowDiscount(margined, 'q1', 30);
  assert.equal(typed.find((r) => r.id === 'q1').cost, null);
  assert.equal(typed.find((r) => r.id === 'q1').discountDollars, null);
  assert.ok(applyBulkDiscount(margined, 40).every((r) => r.cost === null && r.discountDollars === null));
});

// ── Source assertions on the shipped component ────────────────────────────────
// Same technique as test-quote-sku-editor-2026-08-17.mjs:104. The commit gate
// and the write-path constants are behaviour we cannot reach without a DOM, so
// they are pinned against the source instead of left untested.

const EDITOR_PATH = new URL('./src/sidebar/components/QuoteLineEditor.jsx', import.meta.url);

function loadEditorHelperExports() {
  const source = fs.readFileSync(EDITOR_PATH, 'utf8');
  const transformed = babel.transformSync(source, {
    filename: 'QuoteLineEditor.jsx',
    presets: [
      [presetEnv, { targets: { node: 'current' }, modules: 'commonjs' }],
      [presetReact, { runtime: 'automatic' }],
    ],
    babelrc: false,
    configFile: false,
  });
  const moduleRecord = { exports: {} };
  const colors = new Proxy({}, { get: () => '#000' });
  const localRequire = (specifier) => {
    if (specifier === 'react') return {};
    if (specifier === 'react/jsx-runtime') {
      return { Fragment: 'fragment', jsx: () => null, jsxs: () => null };
    }
    if (specifier.includes('/lib/constants')) return { COLORS: colors };
    if (specifier.includes('quote-line-editor-core')) return {};
    throw new Error(`Unexpected QuoteLineEditor test import: ${specifier}`);
  };
  vm.runInNewContext(transformed.code, {
    module: moduleRecord,
    exports: moduleRecord.exports,
    require: localRequire,
    console,
  });
  return moduleRecord.exports;
}

test('QuoteLineEditor gates the commit on diff, validation and busy', () => {
  const source = fs.readFileSync(EDITOR_PATH, 'utf8');
  assert.match(source, /const commitDisabled = busy \|\| ecommBusy \|\| marginBusy \|\| cloneBusy \|\| !diff\.hasChanges \|\| !validation\.ok;/);
  assert.match(source, /buildOpsPayload/);
  // Prices are internal: this card must never offer a customer-facing artifact
  // while edits are pending (the quoteActionsBlocked idea from QuoteResult.jsx).
  assert.match(source, /quoteActionsBlocked/);
  // No em dashes anywhere in this feature.
  assert.doesNotMatch(source, /[\u2014]/);
  // Discount maths lives in the core, never inline in the JSX.
  assert.doesNotMatch(source, /listPrice\s*\*\s*qty\s*\*/);
});

test('QuoteLineEditor exposes direct quantity and description controls through the tested core', () => {
  const source = fs.readFileSync(EDITOR_PATH, 'utf8');
  assert.match(source, /aria-label={`Quantity for line \$\{index \+ 1\}`}/);
  assert.match(source, /min="1"[\s\S]{0,80}max="99999"[\s\S]{0,80}step="1"/);
  assert.match(source, /setRowQuantity\(rows, row\.id, event\.target\.value\)/);
  assert.match(source, /aria-label="Include discount percentage in line descriptions"/);
  assert.match(source, /checked=\{writeDescriptions\}/);
  assert.match(source, /diffAgainstOriginal\(original, rows, \{ writeDescriptions \}\)/);
  assert.match(source, /buildOpsPayload\(original, rows, \{[\s\S]{0,180}writeDescriptions/);
  assert.match(source, /Existing line descriptions, including blanks, will be preserved\./);
  assert.match(source, /result\?\.quantities\?\.length/, 'the verified write summary must report quantity changes');
});

test('the editor JSX parses under the extension Babel config', () => {
  const source = fs.readFileSync(EDITOR_PATH, 'utf8');
  assert.doesNotThrow(() => babel.transformSync(source, {
    filename: 'QuoteLineEditor.jsx',
    presets: [[presetEnv, { targets: { chrome: '120' } }], [presetReact, { runtime: 'automatic' }]],
    babelrc: false,
    configFile: false,
  }));
});

test('the extension holds no live -HW SKU rules of its own', () => {
  // 2026-08-20: Chris asked for the -HW duplicate handling to be fixed "on the
  // extension" too. It has no live copy to fix. SKU resolution is entirely the
  // worker's, which is the only side that sees the catalog, so the extension
  // inherits the fix. quote-engine.js carries an old copy but is dead: nothing
  // imports it and it is in no bundle. This test keeps it that way.
  const engine = fs.readFileSync(new URL('./src/lib/quote-engine.js', import.meta.url), 'utf8');
  assert.match(engine, /DEAD CODE/, 'the stale copy must stay clearly marked');

  const sources = ['src/background/api-client.js', 'src/background/index.js',
    'src/sidebar/App.jsx', 'src/sidebar/components/quote-line-editor-core.mjs',
    'src/sidebar/components/QuoteLineEditor.jsx', 'src/content/zoho-content.js'];
  for (const rel of sources) {
    const src = fs.readFileSync(new URL(`./${rel}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /from '.*quote-engine/, `${rel} must not import the dead engine`);
    assert.doesNotMatch(src, /\bapplySuffix\b/, `${rel} must not resolve SKUs locally`);
  }
});

test('order-URL verification accepts a bare code against an -HW committed row', () => {
  // The worker now emits bare codes for migrated families. Verification has to
  // accept them in BOTH directions or a correct quote would fail closed.
  const flow = fs.readFileSync(new URL('./src/lib/email-quote-flow.mjs', import.meta.url), 'utf8');
  assert.match(flow, /sku\.endsWith\('-HW'\)/, 'the -HW equivalence must still exist');
});

test('clone refresh request logic is narrow and never increases selected-term clone count', () => {
  const {
    cloneEolRefreshRequest,
    requestedCloneCount,
    refreshClonePreviewReady,
    cloneEolRefreshDetails,
    eolReplacementDescription,
  } = loadEditorHelperExports();

  const off = cloneEolRefreshRequest(false, '10G');
  assert.equal(off.enabled, false);
  assert.equal(off.replacementPath, null);
  const oneG = cloneEolRefreshRequest(true, '1G');
  assert.equal(oneG.enabled, true);
  assert.equal(oneG.replacementPath, '1g');
  assert.equal(cloneEolRefreshRequest(true, 'unexpected').replacementPath, null);

  assert.equal(requestedCloneCount([], false), 0);
  assert.equal(requestedCloneCount([], true), 1, 'refresh-only creates one clone');
  assert.equal(requestedCloneCount([1, 3, 5], true), 3, 'refresh transforms selected clones instead of adding one');
  assert.equal(requestedCloneCount([3, 3, 99], true), 1, 'terms are bounded and deduplicated');

  const completePreview = {
    available: true,
    eol_refresh: { enabled: true, complete: true, replacement_path: '1g' },
  };
  assert.equal(refreshClonePreviewReady([completePreview], [], true, '1g'), true);
  assert.equal(refreshClonePreviewReady([{ available: true }], [], true, ''), false,
    'an old term preview that omits eol_refresh must never unlock a refresh write');
  assert.equal(refreshClonePreviewReady([{ ...completePreview, eol_refresh: { enabled: true, complete: false } }], [], true, ''), false);
  assert.equal(refreshClonePreviewReady([completePreview], [1, 3], true, '1g'), false, 'every requested clone needs a preview');
  assert.equal(refreshClonePreviewReady([completePreview], [], true, '10g'), false, 'the selected path must match');

  const entry = {
    warnings: ['Check tier'],
    alternatives: [{ path: '1g' }, { path: '10g' }],
    eol_refresh: {
      enabled: true,
      replacements: [{ source_model: 'MS225-48FP', target_lines: [] }],
      unresolved: [{ id: 'row-1', sku: 'MX100', quantity: 1, description: 'generic licence cannot bind a model' }],
      review_warnings: ['Check tier', 'License review required'],
    },
  };
  const details = cloneEolRefreshDetails(entry);
  assert.equal(details.replacements.length, 1);
  assert.deepEqual(Array.from(details.warnings), ['Check tier', 'License review required']);
  assert.deepEqual(Array.from(details.unresolved), ['MX100']);
  assert.deepEqual(Array.from(details.alternatives), ['1g', '10g']);
  assert.equal(eolReplacementDescription(entry.eol_refresh.replacements[0], {}), 'Replaces EOL MS225-48FP');
  assert.equal(eolReplacementDescription({ description: 'Replaces EOL MX100' }, {}), 'Replaces EOL MX100');
});

test('the clone term and EOL refresh card is gated and never auto-retried', () => {
  const source = fs.readFileSync(EDITOR_PATH, 'utf8');
  // Terms offered, matching the worker's CLONE_TERM_ALLOWED.
  assert.match(source, /const CLONE_TERMS = \[1, 3, 5, 7, 10\]/);
  // Refresh is opt-in and supports a refresh-only request.
  assert.match(source, /const \[cloneEolRefresh, setCloneEolRefresh\] = useState\(false\)/);
  assert.match(source, /const cloneRequestReady = cloneCount > 0/);
  assert.match(source, /const cloneWriteReady = cloneRequestReady && \(!cloneEolRefresh \|\| refreshClonePreviewReady\(/);
  assert.match(source, /if \(!onCloneTerms \|\| !cloneWriteReady\) return/);
  assert.match(source, /disabled=\{busy \|\| cloneBusy \|\| !cloneRequestReady\}/);
  assert.match(source, /disabled=\{busy \|\| cloneBusy \|\| !cloneWriteReady\}/);
  assert.match(source, /aria-label="Include end-of-life equipment refresh"/);
  assert.match(source, /aria-label="EOL replacement path preference"/);
  assert.match(source, /<option value="1g">Prefer 1G replacement<\/option>/);
  assert.match(source, /<option value="10g">Prefer 10G replacement<\/option>/);
  assert.match(source, /cloneEolRefreshRequest\(cloneEolRefresh, cloneReplacementPath\)/);
  assert.match(source, /Replacement line descriptions always name the retired model as "Replaces EOL \[model\]"/);
  assert.match(source, /Refresh preview is incomplete or unsupported\. No quote can be created\./);
  assert.match(source, /Preview this exact refresh first\. Clone unlocks only after every refresh plan is available and complete\./);
  // A clone creates records, so it must never be retried automatically: a
  // retry after a partial failure would leave duplicate quotes behind.
  const runClones = source.slice(source.indexOf('async function runClones()'));
  assert.doesNotMatch(runClones.slice(0, runClones.indexOf('\n  }')), /retry|for \(|while \(/);
  // A clone reads what Zoho holds, not the rep's uncommitted edits, and says so.
  assert.match(source, /The clone is made from what Zoho holds now, not your uncommitted edits/);
  // Committing is blocked while a clone is in flight.
  assert.match(source, /const commitDisabled = busy \|\| ecommBusy \|\| marginBusy \|\| cloneBusy/);
  // Preview and results expose provenance plus every review gate.
  assert.match(source, /Description: "\{eolReplacementDescription\(replacement, line\)\}"/);
  assert.match(source, /Review warning: \{warning\}/);
  assert.match(source, /Unresolved EOL lines:/);
  assert.match(source, /Available replacement paths:/);
  assert.match(source, /License review required for this replacement/);
});

test('background, api-client and constants wire the clone endpoints', () => {
  const constants = fs.readFileSync(new URL('./src/lib/constants.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('./src/background/api-client.js', import.meta.url), 'utf8');
  const background = fs.readFileSync(new URL('./src/background/index.js', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('./src/sidebar/App.jsx', import.meta.url), 'utf8');

  assert.match(constants, /PREVIEW_QUOTE_CLONE_TERMS: 'PREVIEW_QUOTE_CLONE_TERMS'/);
  assert.match(constants, /CLONE_QUOTE_TERMS: 'CLONE_QUOTE_TERMS'/);
  assert.match(client, /eolRefresh\?\.enabled === true[\s\S]{0,100}'\/api\/quote-clone-refresh-preview'[\s\S]{0,100}'\/api\/quote-clone-terms-preview'/);
  assert.match(client, /payload\?\.eolRefresh\?\.enabled === true[\s\S]{0,100}'\/api\/quote-clone-refresh'[\s\S]{0,100}'\/api\/quote-clone-terms'/);
  // 90s: each term is a clone, a re-read, an atomic PUT and a verify, run
  // sequentially.
  assert.match(client, /apiCall\(route, payload, \{ timeout: 90000 \}\)/);
  assert.match(background, /\[MSG\.PREVIEW_QUOTE_CLONE_TERMS\]/);
  assert.match(background, /\[MSG\.CLONE_QUOTE_TERMS\]/);
  assert.match(app, /\(id, terms, eolRefresh\) => sendToBackground\(MSG\.PREVIEW_QUOTE_CLONE_TERMS, \{/);
  assert.match(app, /recordId: id,[\s\S]{0,80}terms,[\s\S]{0,80}eolRefresh/);
  assert.match(background, /\[MSG\.PREVIEW_QUOTE_CLONE_TERMS\]: async \(\{ recordId, terms, eolRefresh \}\)/);
  assert.match(background, /previewQuoteCloneTerms\(id, Array\.isArray\(terms\) \? terms : undefined, eolRefresh\)/);
  assert.match(client, /previewQuoteCloneTerms\(recordId, terms, eolRefresh\)/);
  assert.match(client, /apiCall\(route, \{ recordId, terms, eolRefresh \}, \{ timeout: 45000 \}\)/);
  // Write already forwards the complete payload; eolRefresh must not be picked
  // apart or lost before the Worker validates it.
  assert.match(background, /return api\.cloneQuoteTerms\(payload\)/);
  assert.match(client, /apiCall\(route, payload/);

  const cloneFn = client.slice(client.indexOf('export async function cloneQuoteTerms'));
  assert.doesNotMatch(cloneFn.slice(0, cloneFn.indexOf('\n}')), /retry|for \(|while \(/);
});

test('background, api-client and constants wire the two new endpoints narrowly', () => {
  const constants = fs.readFileSync(new URL('./src/lib/constants.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('./src/background/api-client.js', import.meta.url), 'utf8');
  const background = fs.readFileSync(new URL('./src/background/index.js', import.meta.url), 'utf8');

  assert.match(constants, /GET_QUOTE_LINES: 'GET_QUOTE_LINES'/);
  assert.match(constants, /COMMIT_QUOTE_LINE_OPS: 'COMMIT_QUOTE_LINE_OPS'/);
  assert.match(constants, /OPEN_QUOTE_LINE_EDITOR: 'OPEN_QUOTE_LINE_EDITOR'/);

  assert.match(client, /apiCall\('\/api\/quote-lines'/);
  assert.match(client, /apiCall\('\/api\/quote-line-ops'/);
  assert.match(client, /apiCall\('\/api\/quote-line-ecomm'/);
  assert.match(client, /apiCall\('\/api\/quote-line-costs'/);
  assert.match(constants, /GET_QUOTE_LINE_COSTS: 'GET_QUOTE_LINE_COSTS'/);
  assert.match(constants, /MATCH_QUOTE_LINES_TO_ECOMM: 'MATCH_QUOTE_LINES_TO_ECOMM'/);
  // 60s: the write does fetch, PUT, and a verification re-fetch.
  assert.match(client, /\/api\/quote-line-ops[\s\S]{0,120}timeout: 60000/);
  // apiCall has no retry, and zohoApiCall has no 429 retry. A write must never
  // be auto-retried from the client.
  const commitFn = client.slice(client.indexOf('export async function commitQuoteLineOps'));
  assert.doesNotMatch(commitFn.slice(0, commitFn.indexOf('\n}')), /retry|for \(|while \(/);

  assert.match(background, /\[MSG\.GET_QUOTE_LINES\]/);
  assert.match(background, /\[MSG\.COMMIT_QUOTE_LINE_OPS\]/);
  assert.match(background, /\[MSG\.MATCH_QUOTE_LINES_TO_ECOMM\]/);
  assert.match(background, /\[MSG\.GET_QUOTE_LINE_COSTS\]/);
});
