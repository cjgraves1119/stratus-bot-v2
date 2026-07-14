// Network-free unit tests for guardQuoteWriteDiscounts — the fail-closed guard that
// prevents >100% (negative-net) Quote line discounts and auto-scales a discount when
// ONLY Quantity changes. Eric report 2026-07-09 ("over 100% discounts / negative
// profit"). The function is EXTRACTED FROM SOURCE so tests can't drift from shipped code.
// Run: node worker-gchat/test-discount-guard-2026-07-13.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, 'src', 'index.js'), 'utf8');
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fn ${name} not found`);
  let depth = 0, open = src.indexOf('{', start);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error('unbalanced');
}
const guardQuoteWriteDiscounts = new Function(`${extractFn('guardQuoteWriteDiscounts')}; return guardQuoteWriteDiscounts;`)();

let p = 0; const t = (n, f) => { f(); console.log('  ✓ ' + n); p++; };
const snap = [
  { id: 'A', Product_Name: { Product_Code: 'LIC-X-3YR' }, List_Price: 100, Quantity: 10, Discount: 500 }, // 50% off, qty 10
  { id: 'B', Product_Name: { Product_Code: 'HW-Y' }, List_Price: 200, Quantity: 2, Discount: 0 },
  { id: 'C', Product_Name: { Product_Code: 'BAD' }, List_Price: 100, Quantity: 4, Discount: 900 }, // already-invalid old line
];
console.log('guardQuoteWriteDiscounts (extracted from source):');
t('ERIC CASE: qty 10→3, Discount omitted → auto-scaled to 50% ($150), NOT the stale $500', () => {
  const items = [{ id: 'A', Quantity: 3 }];
  const r = guardQuoteWriteDiscounts(items, snap);
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(items[0].Discount, 150);
  assert.deepStrictEqual(r.scaled, ['LIC-X-3YR']);
});
t('explicit >100% rejected; 1-cent over rejected (integer cents, no epsilon leak)', () => {
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Quantity: 3, Discount: 400 }], snap).errors.length, 1);
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Quantity: 3, Discount: 300.01 }], snap).errors.length, 1);
});
t('exactly-100% allowed; $0 line allowed; negative discount rejected', () => {
  assert.deepStrictEqual(guardQuoteWriteDiscounts([{ id: 'A', Quantity: 3, Discount: 300 }], snap).errors, []);
  assert.deepStrictEqual(guardQuoteWriteDiscounts([{ id: 'B', Quantity: 5 }], snap).errors, []);
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Discount: -5 }], snap).errors.length, 1);
});
t('malformed inputs rejected (boolean/empty Discount, non-integer Quantity)', () => {
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Discount: true }], snap).errors.length, 1);
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Discount: '' }], snap).errors.length, 1);
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Quantity: 2.5, Discount: 100 }], snap).errors.length, 1);
});
t('MODIFY with no snapshot match → REJECT (fail-closed, not silently skipped)', () => {
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'ZZ', Quantity: 3 }], snap).errors.length, 1);
});
t('product change must NOT inherit old list price; needs explicit List_Price', () => {
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Product_Name: { id: 'new' }, Quantity: 3, Discount: 200 }], snap).errors.length, 1);
  assert.deepStrictEqual(guardQuoteWriteDiscounts([{ id: 'A', Product_Name: { id: 'new' }, List_Price: 100, Quantity: 3, Discount: 200 }], snap).errors, []);
});
t('cannot auto-scale off an already-invalid old line → reject, ask for explicit', () => {
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'C', Quantity: 2 }], snap).errors.length, 1);
});
t('duplicate snapshot id → reject (ambiguous)', () => {
  const dup = [...snap, { id: 'A', List_Price: 100, Quantity: 10, Discount: 500 }];
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', Quantity: 3 }], dup).errors.length, 1);
});
t('clean DELETE skipped; DELETE mixed with pricing rejected', () => {
  assert.deepStrictEqual(guardQuoteWriteDiscounts([{ id: 'A', _delete: null }], snap).errors, []);
  assert.strictEqual(guardQuoteWriteDiscounts([{ id: 'A', _delete: null, Discount: 50 }], snap).errors.length, 1);
});
t('ADD valid ok; ADD >100% rejected', () => {
  assert.deepStrictEqual(guardQuoteWriteDiscounts([{ Product_Name: { id: 'p' }, List_Price: 50, Quantity: 2, Discount: 40 }], snap).errors, []);
  assert.strictEqual(guardQuoteWriteDiscounts([{ Product_Name: { id: 'p' }, List_Price: 50, Quantity: 2, Discount: 150 }], snap).errors.length, 1);
});
console.log(`\nALL ${p} ASSERTIONS PASSED`);
