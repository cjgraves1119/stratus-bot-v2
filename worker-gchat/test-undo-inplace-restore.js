// Unit / regression tests for the per-id in-place undo restore pass
// shipped in cycle 2 (2026-04-25, fix/undo-preserve-subform-ids-via-per-field-put).
//
// Tested behavior — re-declared in pure form here mirroring the production
// algorithm in worker-gchat/src/index.js around the undo_crm_action handler.
// If the production logic diverges, update this file in lockstep.
//
// Coverage:
//   - Quote undo where current/preState share subform ids and Quantity differs
//     → restore payload uses {id, Quantity}, NOT delete-add
//   - id-preservation verifier rejects post-fetch where a preserved id is missing
//   - User-visible undo summary uses Quote_Number when preState.Quote_Number exists,
//     falls back to record_id otherwise
//
// Run: node test-undo-inplace-restore.js

const assert = require('node:assert/strict');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

// ─── Re-declare the production algorithm in pure form ────────────────────────

// Wide key matches production itemKey: product_id|qty|discount|list_price|description
function itemKey(it) {
  const pid = it.Product_Name?.id || null;
  const qty = Number(it.Quantity || 0);
  const disc = Number(it.Discount || 0);
  const lp = Number(it.List_Price || 0);
  const desc = it.Description == null ? '' : String(it.Description);
  if (!pid) return null;
  return `${pid}|${qty}|${disc.toFixed(2)}|${lp.toFixed(2)}|${desc}`;
}

const closeNum = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) <= 0.01;
const stringDiff = (a, b) => {
  const A = a == null ? '' : String(a);
  const B = b == null ? '' : String(b);
  return A !== B;
};

// Compute restore ops the same way the production code does.
// Returns { inPlaceRestoreOps, idsToDelete, itemsToAdd, idsConsumedByInPlace }.
function computeQuoteUndoItemOps(currentItems, preStateItems) {
  const inPlaceRestoreOps = [];
  const idsConsumedByInPlace = new Set();

  const currentById = new Map();
  for (const it of currentItems) {
    if (it && it.id) currentById.set(String(it.id), it);
  }
  const preByIdAvailable = new Map();
  for (const it of preStateItems) {
    if (it && it.id && currentById.has(String(it.id))) {
      preByIdAvailable.set(String(it.id), it);
    }
  }

  for (const [idStr, preRow] of preByIdAvailable.entries()) {
    const curRow = currentById.get(idStr);
    if (!curRow) continue;
    const prePid = preRow.Product_Name?.id || null;
    const curPid = curRow.Product_Name?.id || null;
    if (prePid !== curPid) continue;
    const patch = { id: preRow.id };
    let touched = false;
    if (!closeNum(preRow.Quantity, curRow.Quantity)) {
      patch.Quantity = preRow.Quantity;
      touched = true;
    }
    if (!closeNum(preRow.Discount, curRow.Discount)) {
      patch.Discount = preRow.Discount;
      touched = true;
    }
    if (!closeNum(preRow.List_Price, curRow.List_Price)) {
      patch.List_Price = preRow.List_Price;
      touched = true;
    }
    if (stringDiff(preRow.Description, curRow.Description)) {
      patch.Description = preRow.Description;
      touched = true;
    }
    if (touched) inPlaceRestoreOps.push(patch);
    idsConsumedByInPlace.add(idStr);
  }

  const currentRemaining = currentItems.filter(it => !it.id || !idsConsumedByInPlace.has(String(it.id)));
  const preRemaining = preStateItems.filter(it => !it.id || !idsConsumedByInPlace.has(String(it.id)));

  const currentKeyToIds = new Map();
  for (const it of currentRemaining) {
    const k = itemKey(it);
    if (!k) continue;
    if (!currentKeyToIds.has(k)) currentKeyToIds.set(k, []);
    currentKeyToIds.get(k).push(it.id);
  }
  const preKeyCount = new Map();
  for (const it of preRemaining) {
    const k = itemKey(it);
    if (!k) continue;
    preKeyCount.set(k, (preKeyCount.get(k) || 0) + 1);
  }

  const idsToDelete = [];
  for (const [k, ids] of currentKeyToIds.entries()) {
    const want = preKeyCount.get(k) || 0;
    const have = ids.length;
    if (have > want) {
      for (let i = want; i < have; i++) idsToDelete.push(ids[i]);
    }
  }
  const itemsToAdd = [];
  for (const [k, want] of preKeyCount.entries()) {
    const have = (currentKeyToIds.get(k) || []).length;
    if (want > have) {
      let needed = want - have;
      for (const it of preRemaining) {
        if (needed === 0) break;
        if (itemKey(it) !== k) continue;
        itemsToAdd.push({
          Product_Name: it.Product_Name?.id ? { id: it.Product_Name.id } : undefined,
          Quantity: it.Quantity,
          List_Price: it.List_Price,
          Discount: it.Discount,
          Description: it.Description,
          Sequence_Number: it.Sequence_Number,
        });
        needed--;
      }
    }
  }
  return { inPlaceRestoreOps, idsToDelete, itemsToAdd, idsConsumedByInPlace };
}

// id-preservation verifier — mirrors the production check.
// Returns { ok, failures: [...] }.
function verifyInPlacePreservation(verifyItems, inPlaceRestoreOps, preStateItems) {
  const verifyItemsById = new Map();
  for (const it of verifyItems) {
    if (it && it.id) verifyItemsById.set(String(it.id), it);
  }
  const preStateItemsById = new Map();
  for (const it of preStateItems) {
    if (it && it.id) preStateItemsById.set(String(it.id), it);
  }
  const failures = [];
  for (const patch of inPlaceRestoreOps) {
    const idStr = String(patch.id);
    const got = verifyItemsById.get(idStr);
    if (!got) {
      failures.push(`id ${idStr} missing from post-restore`);
      continue;
    }
    const preRow = preStateItemsById.get(idStr);
    const prePid = preRow?.Product_Name?.id || null;
    const gotPid = got.Product_Name?.id || null;
    if (prePid && gotPid && String(prePid) !== String(gotPid)) {
      failures.push(`id ${idStr} Product_Name changed`);
    }
    if (patch.Quantity != null && Math.abs(Number(got.Quantity || 0) - Number(patch.Quantity || 0)) > 0.01) {
      failures.push(`id ${idStr} Quantity didn't persist`);
    }
    if (patch.Discount != null && Math.abs(Number(got.Discount || 0) - Number(patch.Discount || 0)) > 0.01) {
      failures.push(`id ${idStr} Discount didn't persist`);
    }
    if (patch.List_Price != null && Math.abs(Number(got.List_Price || 0) - Number(patch.List_Price || 0)) > 0.01) {
      failures.push(`id ${idStr} List_Price didn't persist`);
    }
    if (patch.Description != null) {
      const want = String(patch.Description ?? '');
      const have = String(got.Description ?? '');
      if (want !== have) failures.push(`id ${idStr} Description didn't persist`);
    }
  }
  return { ok: failures.length === 0, failures };
}

// Full Quote structural-fidelity verifier. Fingerprints and totals can match
// after delete-add, but the exact subform ids still changed.
function verifyExactSubformIds(verifyItems, preStateItems) {
  const expected = preStateItems.map(it => it?.id).filter(Boolean).map(String);
  const actual = verifyItems.map(it => it?.id).filter(Boolean).map(String);
  const canVerify = expected.length === preStateItems.length && actual.length === verifyItems.length;
  if (!canVerify) return { ok: true, skipped: true, expected, actual };
  const ok = expected.length === actual.length && expected.every((id, idx) => id === actual[idx]);
  return { ok, skipped: false, expected, actual };
}

// Quote_Number-aware label — same shape as the production undo helper.
function buildQuoteRefLabel(origModule, origRecordId, preState) {
  if (origModule === 'Quotes' && preState && preState.Quote_Number) {
    return `Quote #${preState.Quote_Number}`;
  }
  return `${origModule.replace(/s$/, '')} ${origRecordId}`;
}

// ─── Tests ──────────────────────────────────────────────────────────────────

console.log('\nundo in-place restore — algorithm and verification');
console.log('─'.repeat(64));

t('qty-only diff on shared subform id → in-place patch {id, Quantity}, no delete/add', () => {
  const preStateItems = [
    {
      id: '2570562000402639030',
      Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
      Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null, Sequence_Number: '1',
    },
    {
      id: '2570562000402639031',
      Product_Name: { id: 'PROD_LIC', Product_Code: 'LIC-ENT-1YR' },
      Quantity: 13, List_Price: 200.7, Discount: 1092, Description: null, Sequence_Number: '2',
    },
  ];
  const currentItems = [
    {
      id: '2570562000402639030',
      Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
      Quantity: 15, List_Price: 1676.64, Discount: 11141, Description: null, Sequence_Number: '1',
    },
    {
      id: '2570562000402639031',
      Product_Name: { id: 'PROD_LIC', Product_Code: 'LIC-ENT-1YR' },
      Quantity: 15, List_Price: 200.7, Discount: 1092, Description: null, Sequence_Number: '2',
    },
  ];
  const { inPlaceRestoreOps, idsToDelete, itemsToAdd } = computeQuoteUndoItemOps(currentItems, preStateItems);
  assert.equal(inPlaceRestoreOps.length, 2, 'should emit 2 in-place patches');
  assert.equal(idsToDelete.length, 0, 'should NOT delete any rows');
  assert.equal(itemsToAdd.length, 0, 'should NOT add any rows');
  // Each patch must be narrow: only id + Quantity (no Discount, List_Price, Description).
  for (const op of inPlaceRestoreOps) {
    assert.ok(op.id, 'patch must have id');
    assert.ok(op.Quantity != null, 'patch must include Quantity');
    assert.ok(op.Discount == null, 'patch must NOT include Discount when it did not change');
    assert.ok(op.List_Price == null, 'patch must NOT include List_Price when it did not change');
    assert.ok(op.Description == null, 'patch must NOT include Description when it did not change');
    assert.ok(op.Product_Name == null, 'patch must NEVER include Product_Name (Product_Name.id mismatch routes to delete-add instead)');
  }
  // Specifically check the qty-13 restoration on the AP line.
  const apPatch = inPlaceRestoreOps.find(p => p.id === '2570562000402639030');
  assert.equal(apPatch.Quantity, 13);
});

t('discount-only diff on shared id → patch contains {id, Discount} only', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
    Quantity: 13, List_Price: 1676.64, Discount: 12000, Description: null, Sequence_Number: '1',
  }];
  const currentItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
    Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null, Sequence_Number: '1',
  }];
  const { inPlaceRestoreOps, idsToDelete, itemsToAdd } = computeQuoteUndoItemOps(currentItems, preStateItems);
  assert.equal(inPlaceRestoreOps.length, 1);
  assert.equal(inPlaceRestoreOps[0].Discount, 12000);
  assert.ok(inPlaceRestoreOps[0].Quantity == null, 'unchanged Quantity must NOT be in patch');
  assert.equal(idsToDelete.length, 0);
  assert.equal(itemsToAdd.length, 0);
});

t('no diff on shared id → no patches, ids consumed (skipped by wide-key delete-add)', () => {
  const sameRow = {
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
    Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null, Sequence_Number: '1',
  };
  const { inPlaceRestoreOps, idsToDelete, itemsToAdd, idsConsumedByInPlace } = computeQuoteUndoItemOps([sameRow], [sameRow]);
  assert.equal(inPlaceRestoreOps.length, 0, 'no patches needed');
  assert.equal(idsToDelete.length, 0, 'no delete');
  assert.equal(itemsToAdd.length, 0, 'no add');
  assert.ok(idsConsumedByInPlace.has('2570562000402639030'), 'id should be marked consumed so wide-key logic skips it');
});

t('product_id mismatch on shared id → falls through to delete-add (no in-place patch)', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_OLD', Product_Code: 'OLD-SKU' },
    Quantity: 5, List_Price: 100, Discount: 0, Description: null, Sequence_Number: '1',
  }];
  const currentItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_NEW', Product_Code: 'NEW-SKU' },
    Quantity: 5, List_Price: 100, Discount: 0, Description: null, Sequence_Number: '1',
  }];
  const { inPlaceRestoreOps, idsToDelete, itemsToAdd } = computeQuoteUndoItemOps(currentItems, preStateItems);
  assert.equal(inPlaceRestoreOps.length, 0, 'must NOT emit in-place patch when Product_Name.id differs');
  // The wide-key logic should now see both rows as different keys, so delete the current and add the pre.
  assert.equal(idsToDelete.length, 1, 'wide-key delete the current row');
  assert.equal(itemsToAdd.length, 1, 'wide-key add the pre row');
});

t('row added by modify (current has, pre lacks) → goes to delete via wide-key path', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP', Product_Code: 'CW9172I-RTG' },
    Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null, Sequence_Number: '1',
  }];
  const currentItems = [
    { ...preStateItems[0] }, // unchanged in-place, becomes no-op consumed
    {
      id: '2570562000402648099', // new id added by modify
      Product_Name: { id: 'PROD_NEW', Product_Code: 'EXTRA-SKU' },
      Quantity: 1, List_Price: 50, Discount: 0, Description: null, Sequence_Number: '2',
    },
  ];
  const { inPlaceRestoreOps, idsToDelete, itemsToAdd } = computeQuoteUndoItemOps(currentItems, preStateItems);
  assert.equal(inPlaceRestoreOps.length, 0, 'unchanged shared row needs no patch');
  assert.equal(idsToDelete.length, 1, 'extra row should be deleted');
  assert.equal(idsToDelete[0], '2570562000402648099');
  assert.equal(itemsToAdd.length, 0);
});

console.log('\nid-preservation verifier');
console.log('─'.repeat(64));

t('verifier passes when all preserved ids present with restored values', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const inPlaceRestoreOps = [{ id: '2570562000402639030', Quantity: 13 }];
  const verifyItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const result = verifyInPlacePreservation(verifyItems, inPlaceRestoreOps, preStateItems);
  assert.equal(result.ok, true, 'should pass');
  assert.equal(result.failures.length, 0);
});

t('verifier FAILS when preserved id is absent from post-fetch (Zoho replaced the row)', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const inPlaceRestoreOps = [{ id: '2570562000402639030', Quantity: 13 }];
  // Zoho silently replaced the row with a new id but kept the values
  const verifyItems = [{
    id: '2570562000402648074', // DIFFERENT id
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const result = verifyInPlacePreservation(verifyItems, inPlaceRestoreOps, preStateItems);
  assert.equal(result.ok, false, 'should fail');
  assert.ok(
    result.failures.some(f => f.includes('missing from post-restore')),
    'should mention the missing id'
  );
});

t('verifier FAILS when preserved id present but Quantity did not persist', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const inPlaceRestoreOps = [{ id: '2570562000402639030', Quantity: 13 }];
  const verifyItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 15, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const result = verifyInPlacePreservation(verifyItems, inPlaceRestoreOps, preStateItems);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('Quantity')), 'should flag Quantity mismatch');
});

t('verifier FAILS when Product_Name.id changed under same subform id', () => {
  const preStateItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_AP' }, Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const inPlaceRestoreOps = [{ id: '2570562000402639030', Quantity: 13 }];
  const verifyItems = [{
    id: '2570562000402639030',
    Product_Name: { id: 'PROD_DIFFERENT' }, // product_id changed!
    Quantity: 13, List_Price: 1676.64, Discount: 11141, Description: null,
  }];
  const result = verifyInPlacePreservation(verifyItems, inPlaceRestoreOps, preStateItems);
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.includes('Product_Name changed')));
});

t('exact-id verifier FAILS when delete-add restores values with regenerated license ids', () => {
  const preStateItems = [
    { id: '2570562000402426397', Product_Name: { id: 'PID_MX75' }, Quantity: 1, List_Price: 2362.03, Discount: 941 },
    { id: '2570562000402426398', Product_Name: { id: 'PID_LIC75' }, Quantity: 1, List_Price: 1660.79, Discount: 887 },
    { id: '2570562000402426399', Product_Name: { id: 'PID_MX85' }, Quantity: 1, List_Price: 3670.05, Discount: 703 },
    { id: '2570562000402426400', Product_Name: { id: 'PID_LIC85' }, Quantity: 1, List_Price: 2452.55, Discount: 804 },
    { id: '2570562000402426401', Product_Name: { id: 'PID_AP' }, Quantity: 2, List_Price: 1676.64, Discount: 1714 },
    { id: '2570562000402426402', Product_Name: { id: 'PID_LICAP' }, Quantity: 2, List_Price: 200.70, Discount: 168 },
  ];
  const verifyItems = [
    preStateItems[0],
    { ...preStateItems[1], id: '2570562000404051436' },
    preStateItems[2],
    { ...preStateItems[3], id: '2570562000404051437' },
    preStateItems[4],
    { ...preStateItems[5], id: '2570562000404051438' },
  ];
  const result = verifyExactSubformIds(verifyItems, preStateItems);
  assert.equal(result.ok, false, 'regenerated ids must fail exact-state undo');
  assert.deepEqual(result.expected, preStateItems.map(i => i.id));
  assert.deepEqual(result.actual, verifyItems.map(i => i.id));
});

t('exact-id verifier PASSES when all subform ids match byte-for-byte', () => {
  const preStateItems = [
    { id: 'sub_1', Product_Name: { id: 'PID_A' } },
    { id: 'sub_2', Product_Name: { id: 'PID_B' } },
  ];
  const result = verifyExactSubformIds([{ ...preStateItems[0] }, { ...preStateItems[1] }], preStateItems);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, false);
});

console.log('\nQuote_Number-aware label');
console.log('─'.repeat(64));

t('label uses Quote_Number when origModule is Quotes and preState.Quote_Number exists', () => {
  const label = buildQuoteRefLabel('Quotes', '2570562000402639029', { Quote_Number: '2570562000402639034' });
  assert.equal(label, 'Quote #2570562000402639034');
});

t('label falls back to record_id when preState lacks Quote_Number', () => {
  const label = buildQuoteRefLabel('Quotes', '2570562000402639029', {});
  assert.equal(label, 'Quote 2570562000402639029');
});

t('label falls back to record_id for non-Quote modules even with Quote_Number present', () => {
  const label = buildQuoteRefLabel('Deals', '2570562000402419947', { Quote_Number: '99999' });
  assert.equal(label, 'Deal 2570562000402419947');
});

t('label falls back to record_id when preState is null', () => {
  const label = buildQuoteRefLabel('Quotes', '2570562000402639029', null);
  assert.equal(label, 'Quote 2570562000402639029');
});

console.log('\n' + '─'.repeat(64));
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
