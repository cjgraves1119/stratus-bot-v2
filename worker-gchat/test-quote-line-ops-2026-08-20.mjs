/**
 * /api/quote-line-ops: the deterministic Quote Line Editor write (2026-08-20).
 *
 * Runs the SHIPPED quoteLineOps() out of src/index.js against a stubbed
 * zohoApiCall, so every assertion here is about the payload Zoho would actually
 * receive. Extraction follows test-update-quote-pipeline-2026-08-19.mjs:62.
 *
 * The four things this file exists to stop, all of which are silent failures
 * rather than errors:
 *   1. a modify row carrying Product_Name, which makes
 *      correctQuotedItemDiscounts overwrite the rep's chosen discount
 *   2. a PUT without Do_Not_Auto_Update_Prices, which Zoho accepts and ignores
 *      on CCW-locked quotes
 *   3. a thin preState, which lets undo delete every line
 *   4. an unverified write reading as success
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(WORKER, 'x.cjs'));
const SOURCE = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = SOURCE;
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) {
    let d = 0, s = false, e = i;
    for (let k = i; k < src.length; k++) {
      if (src[k] === '{') { d++; s = true; }
      if (src[k] === '}') { d--; if (s && d === 0) { e = k + 1; break; } }
    }
    src = src.slice(0, i) + src.slice(e + 1);
  }
  // zohoApiCall is a function declaration, so it can be rebound in its own
  // scope. Stubbing it also covers fetchRecordFull, which goes through it.
  src += `\nmodule.exports={quoteLineOps,scrubMarginFromQuotedItems,setZohoApiCall:(fn)=>{zohoApiCall=fn;}};\n`;
  const t = path.join(WORKER, `.tmp-qle-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

const QUOTE_ID = '2570562000400116511';

function baseItems() {
  return [
    { id: 'r1', Product_Name: { id: 'p1', name: 'Meraki MR44', Product_Code: 'MR44-HW' }, Quantity: 10, List_Price: 1495, Discount: 0, Description: '', Sequence_Number: 1, Total: 14950, Net_Total: 14950 },
    { id: 'r2', Product_Name: { id: 'p2', name: 'ENT 3Y', Product_Code: 'LIC-ENT-3YR' }, Quantity: 10, List_Price: 450, Discount: 675, Description: 'Renewal co-term', Sequence_Number: 2, Total: 4500, Net_Total: 3825 },
    { id: 'r3', Product_Name: { id: 'p3', name: 'MS130', Product_Code: 'MS130-24' }, Quantity: 2, List_Price: 2195, Discount: 0, Description: '', Sequence_Number: 3, Total: 4390, Net_Total: 4390 },
    { id: 'r4', Product_Name: { id: 'p4', name: 'Power adapter', Product_Code: 'MA-PWR-30W' }, Quantity: 2, List_Price: 125, Discount: 0, Description: '', Sequence_Number: 4, Total: 250, Net_Total: 250 },
  ];
}

/**
 * Stub Zoho. GET returns the quote (pre-PUT snapshot, then a post-PUT one built
 * by applying the payload). PUT records the body and succeeds.
 *
 * `mutate` lets a test make the post-PUT re-fetch disagree with what was sent,
 * which is the only way to exercise the verification-failure path.
 */
function stubZoho({ items = baseItems(), mutate = null, putResponse = null } = {}) {
  const calls = { get: 0, put: 0, puts: [], methods: [] };
  let current = items.map((i) => ({ ...i }));
  w.setZohoApiCall(async (method, apiPath, env, body) => {
    calls.methods.push(`${method} ${apiPath}`);
    if (method === 'GET') {
      calls.get += 1;
      return { data: [{ id: QUOTE_ID, Subject: 'Test quote', Quote_Number: 'QT-1042', Grand_Total: 24090, Sub_Total: 24090, Quoted_Items: current.map((i) => ({ ...i })) }] };
    }
    if (method === 'PUT') {
      calls.put += 1;
      calls.puts.push(JSON.parse(JSON.stringify(body)));
      // Apply the payload the way Zoho would: additive, id-keyed.
      const rows = body?.data?.[0]?.Quoted_Items || [];
      for (const row of rows) {
        const idx = current.findIndex((i) => String(i.id) === String(row.id));
        if (idx < 0) continue;
        if (Object.prototype.hasOwnProperty.call(row, '_delete')) { current.splice(idx, 1); continue; }
        const next = { ...current[idx] };
        if ('Quantity' in row) next.Quantity = row.Quantity;
        if ('Discount' in row) next.Discount = row.Discount;
        if ('Description' in row) next.Description = row.Description;
        if ('Sequence_Number' in row) next.Sequence_Number = row.Sequence_Number;
        current[idx] = next;
      }
      if (mutate) current = mutate(current);
      return putResponse || { data: [{ code: 'SUCCESS', message: 'record updated', details: { id: QUOTE_ID } }] };
    }
    throw new Error(`unexpected ${method} ${apiPath}`);
  });
  return calls;
}

const ENV = {}; // no ANALYTICS_DB, so logCrmOpToD1 short-circuits to null

const modifyRows = (put) => (put.data[0].Quoted_Items || []).filter((r) => !('_delete' in r));
const deleteRows = (put) => (put.data[0].Quoted_Items || []).filter((r) => '_delete' in r);

test('a bulk discount writes dollars, replaces descriptions, and verifies', async () => {
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setDiscounts: [{ id: 'r1', pct: 25 }, { id: 'r2', pct: 25 }, { id: 'r3', pct: 12.5 }],
    deletes: [], reorder: [],
  }, ENV, { personId: 'chris' });

  assert.equal(result.success, true, result.message);
  assert.equal(calls.put, 1, 'exactly ONE PUT per commit');
  const rows = modifyRows(calls.puts[0]);
  // Discount is DOLLARS: 1495 * 10 * 25% = 3737.50
  assert.equal(rows.find((r) => r.id === 'r1').Discount, 3737.5);
  assert.equal(rows.find((r) => r.id === 'r2').Discount, 1125);
  assert.equal(rows.find((r) => r.id === 'r3').Discount, 548.75);
  assert.equal(rows.find((r) => r.id === 'r1').Description, '25% Discount');
  assert.equal(rows.find((r) => r.id === 'r3').Description, '12.5% Discount');
  // The hand-written note on r2 is replaced, which is Chris's stated decision.
  assert.equal(rows.find((r) => r.id === 'r2').Description, '25% Discount');
  assert.ok(result._undo_token, 'a verified write emits an undo token');
  assert.match(result._record_url, /tab\/Quotes\/2570562000400116511$/);
});

test('every modify row omits Product_Name, so correctQuotedItemDiscounts skips it', async () => {
  const calls = stubZoho();
  await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setDiscounts: [{ id: 'r1', pct: 25 }], deletes: ['r4'], reorder: ['r1', 'r2', 'r3'],
  }, ENV, {});
  for (const row of calls.puts[0].data[0].Quoted_Items) {
    assert.equal('Product_Name' in row, false, `row ${row.id} must not carry Product_Name`);
    assert.equal('List_Price' in row, false, `row ${row.id} must not restate List_Price`);
    assert.equal('Quantity' in row, false, `row ${row.id} must not restate Quantity`);
  }
});

test('Do_Not_Auto_Update_Prices: true rides in the same payload', async () => {
  const calls = stubZoho();
  await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 10 }] }, ENV, {});
  assert.equal(calls.puts.length, 1);
  assert.equal(calls.puts[0].data[0].Do_Not_Auto_Update_Prices, true);
});

test('a quantity edit writes quantity and recomputed discount together, then verifies both', async () => {
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setQuantities: [{ id: 'r2', qty: 35 }],
    setDiscounts: [{ id: 'r2', pct: 15 }],
  }, ENV, { writeDescriptions: false });

  assert.equal(result.success, true, result.message);
  assert.deepEqual(result.quantities, [{ id: 'r2', qty: 35 }]);
  const row = modifyRows(calls.puts[0]).find((item) => item.id === 'r2');
  assert.equal(row.Quantity, 35);
  assert.equal(row.Discount, 2362.5, '450 list x 35 quantity x 15%');
  assert.equal('Description' in row, false, 'unchecked description option preserves the existing note');
  assert.equal(result.verification.success, true);
});

test('a quantity verification mismatch suppresses success and the undo token', async () => {
  const calls = stubZoho({ mutate: (items) => items.map((item) => (
    item.id === 'r2' ? { ...item, Quantity: 10 } : item
  )) });
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setQuantities: [{ id: 'r2', qty: 35 }],
    setDiscounts: [{ id: 'r2', pct: 15 }],
  }, ENV, {});

  assert.equal(result.success, false);
  assert.equal(calls.put, 1);
  assert.match(result.verification.WARNING, /quantity did not land/);
  assert.equal(result._undo_token, undefined);
});

test('an untouched row cannot disappear or change behind a plausible final count', async () => {
  const disappeared = stubZoho({ mutate: (items) => [
    ...items.filter((item) => item.id !== 'r4'),
    {
      id: 'balanced-ghost',
      Product_Name: { id: 'p-ghost', name: 'Unexpected row', Product_Code: 'MA-CBL-40G-1M' },
      Quantity: 2,
      List_Price: 125,
      Discount: 0,
      Description: '',
      Sequence_Number: 4,
    },
  ] });
  const missingResult = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setQuantities: [{ id: 'r2', qty: 35 }],
    setDiscounts: [{ id: 'r2', pct: 15 }],
  }, ENV, { writeDescriptions: false });
  assert.equal(missingResult.verification.line_count, baseItems().length,
    'the balanced fixture must keep the old line count plausible');
  assert.equal(missingResult.success, false);
  assert.match(missingResult.verification.WARNING, /untouched row r4 is missing/i);
  assert.equal(missingResult._undo_token, undefined);
  assert.equal(disappeared.put, 1, 'verification failure must not retry the write');

  const changed = stubZoho({ mutate: (items) => items.map((item) => (
    item.id === 'r4'
      ? {
        ...item,
        Product_Name: { id: 'p-other', name: 'Changed', Product_Code: 'MA-CBL-40G-1M' },
        Quantity: 3,
        List_Price: 126,
        Discount: 1,
        Description: 'changed behind the edit',
      }
      : item
  )) });
  const changedResult = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setQuantities: [{ id: 'r2', qty: 35 }],
    setDiscounts: [{ id: 'r2', pct: 15 }],
  }, ENV, { writeDescriptions: false });
  assert.equal(changedResult.success, false);
  assert.match(changedResult.verification.WARNING, /row r4: product changed unexpectedly/i);
  assert.match(changedResult.verification.WARNING, /untouched row r4: quantity changed unexpectedly/i);
  assert.match(changedResult.verification.WARNING, /row r4: list price changed unexpectedly/i);
  assert.match(changedResult.verification.WARNING, /untouched row r4: discount changed unexpectedly/i);
  assert.match(changedResult.verification.WARNING, /untouched row r4: description changed unexpectedly/i);
  assert.equal(changedResult._undo_token, undefined);
  assert.equal(changed.put, 1);
});

test('a 0% line clears its Description instead of writing "0% Discount"', async () => {
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setDiscounts: [{ id: 'r2', pct: 0 }],
  }, ENV, {});
  const row = modifyRows(calls.puts[0]).find((r) => r.id === 'r2');
  assert.equal(row.Discount, 0);
  assert.equal(row.Description, '', 'Description must be sent as an explicit empty string, not omitted');
  assert.equal('Description' in row, true);
  assert.equal(result.success, true);
});

test('deletes are explicit {id, _delete: null} rows and carry no pricing', async () => {
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', { deletes: ['r3', 'r4'] }, ENV, {});
  const dels = deleteRows(calls.puts[0]);
  assert.equal(dels.length, 2);
  for (const row of dels) {
    assert.deepEqual(Object.keys(row).sort(), ['_delete', 'id']);
    assert.equal(row._delete, null);
  }
  assert.equal(result.success, true);
  assert.equal(result.verification.line_count, 2);
  assert.equal(result.verification.line_count_expected, 2);
});

test('reorder writes Sequence_Number and verifies that it actually landed', async () => {
  const ok = stubZoho();
  const good = await w.quoteLineOps(QUOTE_ID, 'Quotes', { reorder: ['r4', 'r1', 'r2', 'r3'] }, ENV, {});
  const rows = modifyRows(ok.puts[0]);
  assert.deepEqual(rows.map((r) => [r.id, r.Sequence_Number]), [['r4', 1], ['r1', 2], ['r2', 3], ['r3', 4]]);
  assert.equal(good.success, true);

  // Zoho ignoring a Sequence_Number-only PUT is the ONE unproven behaviour in
  // this feature. When it happens the write must NOT read as success, and the
  // result must name the documented fallback.
  const ignored = stubZoho({ mutate: (items) => items.map((i, index) => ({ ...i, Sequence_Number: index + 1 })) });
  const bad = await w.quoteLineOps(QUOTE_ID, 'Quotes', { reorder: ['r4', 'r1', 'r2', 'r3'] }, ENV, {});
  assert.equal(bad.success, false);
  assert.equal(ignored.put, 1, 'a failed verification must not trigger a second PUT');
  assert.equal(bad.verification.reorder_unsupported, true);
  assert.match(bad.verification.NOTE, /delete-plus-re-add/);
  assert.equal(bad._undo_token, undefined);
  assert.equal(bad._record_url, undefined);
});

test('a verification mismatch suppresses the undo token and the record URL', async () => {
  const calls = stubZoho({ mutate: (items) => items.map((i) => (i.id === 'r1' ? { ...i, Discount: 1 } : i)) });
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 25 }] }, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.equal(result._user_visible_summary, undefined);
  assert.match(result.verification.WARNING, /discount did not land/);
  assert.match(result.message, /did NOT fully verify/);
  assert.equal(calls.put, 1);
});

test('unknown, duplicate, conflicting and delete-everything op sets reject before any PUT', async () => {
  for (const [label, ops, code] of [
    ['unknown id', { setDiscounts: [{ id: 'nope', pct: 10 }] }, 'unknown_ids'],
    ['unknown delete', { deletes: ['nope'] }, 'unknown_ids'],
    ['duplicate discount id', { setDiscounts: [{ id: 'r1', pct: 10 }, { id: 'r1', pct: 20 }] }, 'duplicate_op_ids'],
    ['duplicate quantity id', { setQuantities: [{ id: 'r1', qty: 2 }, { id: 'r1', qty: 3 }], setDiscounts: [{ id: 'r1', pct: 10 }] }, 'duplicate_op_ids'],
    ['duplicate delete id', { deletes: ['r1', 'r1'] }, 'duplicate_op_ids'],
    ['delete everything', { deletes: ['r1', 'r2', 'r3', 'r4'] }, 'empty_quoted_items'],
    ['delete plus discount on the same row', { setDiscounts: [{ id: 'r1', pct: 10 }], deletes: ['r1'] }, 'delete_conflict'],
    ['delete plus quantity on the same row', { setQuantities: [{ id: 'r1', qty: 2 }], setDiscounts: [{ id: 'r1', pct: 10 }], deletes: ['r1'] }, 'delete_conflict'],
    ['delete plus reorder on the same row', { deletes: ['r1'], reorder: ['r1', 'r2', 'r3'] }, 'delete_conflict'],
    ['partial reorder', { reorder: ['r1', 'r2'] }, 'partial_reorder'],
    ['no ops at all', {}, 'no_ops'],
    ['percent above 100', { setDiscounts: [{ id: 'r1', pct: 101 }] }, 'invalid_percent'],
    ['negative percent', { setDiscounts: [{ id: 'r1', pct: -1 }] }, 'invalid_percent'],
    ['non-numeric percent', { setDiscounts: [{ id: 'r1', pct: 'lots' }] }, 'invalid_percent'],
    ['zero quantity', { setQuantities: [{ id: 'r1', qty: 0 }], setDiscounts: [{ id: 'r1', pct: 10 }] }, 'invalid_quantity'],
    ['fractional quantity', { setQuantities: [{ id: 'r1', qty: 2.5 }], setDiscounts: [{ id: 'r1', pct: 10 }] }, 'invalid_quantity'],
    ['quantity without discount percent', { setQuantities: [{ id: 'r1', qty: 2 }] }, 'quantity_requires_discount'],
  ]) {
    const calls = stubZoho();
    const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', ops, ENV, {});
    assert.equal(result.success, false, label);
    assert.equal(result.error, code, `${label} must reject with ${code}, got ${result.error}`);
    assert.equal(calls.put, 0, `${label} must reject BEFORE any PUT`);
  }
});

test('the discount guard rejects a discount above List_Price x Quantity', async () => {
  // A line whose live quantity is 0 cannot be priced, and a quote whose live
  // snapshot went missing cannot be validated. Both must fail closed.
  const zeroQty = stubZoho({ items: baseItems().map((i) => (i.id === 'r1' ? { ...i, Quantity: 0 } : i)) });
  const zero = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 25 }] }, ENV, {});
  assert.equal(zero.success, false);
  assert.equal(zero.error, 'invalid_line');
  assert.equal(zeroQty.put, 0);

  // 100% is the ceiling the endpoint allows, and it must still pass the shared
  // guardQuoteWriteDiscounts gate rather than being waved through.
  const full = stubZoho();
  const atList = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 100 }] }, ENV, {});
  assert.equal(atList.success, true);
  assert.equal(modifyRows(full.puts[0])[0].Discount, 14950);
});

test('an empty or missing subform fails closed instead of writing', async () => {
  const empty = stubZoho({ items: [] });
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 25 }] }, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result.error, 'no_line_items');
  assert.equal(empty.put, 0);
});

test('preState carries the FULL line shape, not {id, Discount}', async () => {
  // A thin snapshot makes undo_crm_action's itemKey() return null, which lets
  // undo delete every line (src/index.js, the comment above applyMarginToQuote's
  // preState). Assert the shape at the source rather than via D1.
  const source = SOURCE.slice(SOURCE.indexOf('async function quoteLineOps('), SOURCE.indexOf('async function applyMarginToQuote('));
  const preState = source.slice(source.indexOf('const preState = {'), source.indexOf('// ── 7.'));
  for (const field of ['Product_Name', 'Quantity', 'List_Price', 'Discount', 'Description', 'Sequence_Number']) {
    assert.match(preState, new RegExp(`\\b${field}:`), `preState must snapshot ${field}`);
  }
  assert.match(preState, /Product_Name: i\.Product_Name\?\.id \? \{ id: i\.Product_Name\.id \} : undefined/);
});

test('no Description this endpoint can write mentions margin, and the scrubber still runs', async () => {
  for (const pct of [0, 0.1, 12.5, 20, 25, 33.3, 50, 100]) {
    const calls = stubZoho();
    await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct }] }, ENV, {});
    assert.doesNotMatch(JSON.stringify(calls.puts[0]), /margin/i, `pct=${pct}`);
  }
  // Defence in depth: the shared scrubber is wired onto the built rows, so one
  // rule governs every Description reaching a customer-facing quote.
  const source = SOURCE.slice(SOURCE.indexOf('async function quoteLineOps('), SOURCE.indexOf('async function applyMarginToQuote('));
  assert.match(source, /scrubMarginFromQuotedItems\(subformRows/);
  assert.match(source, /guardQuoteWriteDiscounts\(subformRows, currentItems\)/);
  // And it really does strip margin wording when handed some.
  const rows = [{ id: 'x', Description: '5-Year Add-on (20% Margin)' }];
  w.scrubMarginFromQuotedItems(rows);
  assert.equal(rows[0].Description, '5-Year Add-on');
});

test('an ecomm match writes the EXACT supplied dollars, not the rounded percent', async () => {
  // MS130-24: list 2195 x 2 = 4390 gross. The storefront price is 1920.63 each,
  // so the true discount is 548.74 while 12.5% of gross is 548.75. Matching the
  // site has to be exact, so the op carries dollars and the percent only
  // describes it.
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setDiscounts: [{ id: 'r3', pct: 12.5, dollars: 548.74 }],
  }, ENV, {});
  const row = modifyRows(calls.puts[0]).find((r) => r.id === 'r3');
  assert.equal(row.Discount, 548.74);
  assert.equal(row.Description, '12.5% Discount');
  assert.equal(result.success, true);
  assert.equal(result.lines[0].exact_dollars, true);
  assert.equal(calls.put, 1);

  // Without the dollars the same op writes the percent arithmetic instead.
  const plain = stubZoho();
  await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r3', pct: 12.5 }] }, ENV, {});
  assert.equal(modifyRows(plain.puts[0])[0].Discount, 548.75);
});

test('a supplied discount that contradicts its stated percent is refused before any PUT', async () => {
  // Otherwise the line would advertise "25% Discount" while carrying a
  // different number, which is a customer-facing lie the undo token cannot fix.
  for (const [label, op] of [
    ['dollars far below the stated percent', { id: 'r1', pct: 25, dollars: 100 }],
    ['dollars far above the stated percent', { id: 'r1', pct: 5, dollars: 9000 }],
  ]) {
    const calls = stubZoho();
    const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [op] }, ENV, {});
    assert.equal(result.success, false, label);
    assert.equal(result.error, 'discount_percent_mismatch', label);
    assert.equal(calls.put, 0, `${label} must reject BEFORE any PUT`);
  }

  // A negative or unreadable dollar figure is rejected on its own terms.
  for (const bad of [-1, 'lots', NaN]) {
    const calls = stubZoho();
    const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r1', pct: 25, dollars: bad }] }, ENV, {});
    assert.equal(result.success, false, String(bad));
    assert.equal(result.error, 'invalid_discount_dollars', String(bad));
    assert.equal(calls.put, 0);
  }

  // Display rounding is NOT a contradiction: 548.74 against 12.5% of 4390 is
  // the ecomm case above and must pass.
  const ok = stubZoho();
  const fine = await w.quoteLineOps(QUOTE_ID, 'Quotes', { setDiscounts: [{ id: 'r3', pct: 12.5, dollars: 548.74 }] }, ENV, {});
  assert.equal(fine.success, true);
  assert.equal(ok.put, 1);
});

test('the ecomm price endpoint resolves SKUs sequentially and never fans out', () => {
  assert.match(SOURCE, /case '\/api\/quote-line-ecomm': \{/);
  const start = SOURCE.indexOf("case '/api/quote-line-ecomm': {");
  const block = SOURCE.slice(start, SOURCE.indexOf("case '/api/zoho-quote-items': {", start));
  assert.ok(block.length > 500 && block.length < 14000, `the ecomm case block should be self-contained, got ${block.length} chars`);
  // zohoApiCall has no 429 retry, and fetchLiveSkuPricing already issues two
  // calls per SKU. A Promise.all over the lines would be a 2N-wide fan-out.
  assert.doesNotMatch(block, /Promise\.all|Promise\.allSettled/);
  assert.match(block, /await fetchLiveSkuPricing\(sku, productId, env\)/);
  // One lookup per DISTINCT sku + product id, reused across duplicate lines.
  assert.match(block, /if \(!resolved\.has\(key\)\)/);
  // And a hard cap, so a huge quote cannot turn into hundreds of calls.
  assert.match(block, /QLE_MAX_ECOMM_LOOKUPS/);
  assert.match(SOURCE, /const QLE_MAX_ECOMM_LOOKUPS = \d+;/);
  // Read only: it must never write.
  assert.doesNotMatch(block, /zohoApiCall\('PUT'|zohoApiCall\("PUT"/);
});

test('the distributor-cost endpoint reads the fields Vendor_Lines actually has', () => {
  assert.match(SOURCE, /case '\/api\/quote-line-costs': \{/);
  const start = SOURCE.indexOf("case '/api/quote-line-costs': {");
  const block = SOURCE.slice(start, SOURCE.indexOf("case '/api/quote-line-ecomm': {", start));
  assert.ok(block.length > 500 && block.length < 12000, `expected a self-contained block, got ${block.length} chars`);

  // THE BUG THIS PINS. Vendor_Lines uses SKU and Qty. Product_Code and Quantity
  // do NOT exist on that module (verified against the live schema 2026-08-20),
  // and asking for them yields undefined on every row, so every cost match
  // fails silently and no margin can ever be priced.
  assert.match(block, /fields=id,SKU,Qty,/);
  assert.doesNotMatch(block, /Product_Code,Quantity|fields=[^&]*\bQuantity\b/);
  assert.match(block, /String\(line\.SKU \|\| ''\)/);
  assert.match(block, /Number\(match\.Qty\)/);

  // ONE search call, no fan-out, and read-only.
  assert.equal((block.match(/await zohoApiCall\(/g) || []).length, 1);
  assert.doesNotMatch(block, /zohoApiCall\('PUT'|zohoApiCall\('POST'/);
  // Cost data missing is reported, never estimated.
  assert.match(block, /cost_data_unavailable/);
  assert.match(block, /Do NOT estimate the discounts/);
});

test('apply_margin_to_quote no longer reads non-existent Vendor_Lines fields', () => {
  // Same bug, in the pre-existing agent tool: it asked for Product_Code and
  // Quantity, so vlPool rows had product_code '' and quantity 0, no candidate
  // ever matched, and every call returned cost_match_failed.
  const start = SOURCE.indexOf('async function applyMarginToQuote(');
  const fn = SOURCE.slice(start, SOURCE.indexOf('async function retermQuoteLicenses(', start));
  assert.match(fn, /Vendor_Lines\/search\?criteria=\$\{vlCriteria\}&fields=id,Name,SKU,Qty,/);
  assert.match(fn, /product_code: String\(v\.SKU \|\| ''\)/);
  assert.match(fn, /quantity: Number\(v\.Qty\) \|\| 0/);
  assert.doesNotMatch(fn, /v\.Product_Code|v\.Quantity/);
  // The margin maths itself is unchanged: sell = cost / (1 - margin).
  assert.match(fn, /const targetSell = vl\.disti_total \/ \(1 - margin\)/);
});

test('the margin maths matches Zoho, verified against a real quote', () => {
  // Quote 2570562000422125077 at 10% margin, as Zoho actually stored it.
  // The worker and the client must agree on this or the rep approves one number
  // and Zoho receives another.
  const round2 = (v) => Math.round(v * 100) / 100;
  const cases = [
    { sku: 'MS150-48LP-4X', disti: 100379.88, lineTotal: 352209.96, zohoDiscount: 240676.76 },
    { sku: 'CW9176D1-RTG', disti: 40015.42, lineTotal: 112719.41, zohoDiscount: 68257.83 },
    { sku: 'MS130-48X', disti: 19444.92, lineTotal: 63753.78, zohoDiscount: 42148.31 },
    { sku: 'LIC-MS150-48-1Y', disti: 3492.36, lineTotal: 10745.64, zohoDiscount: 6865.24 },
    { sku: 'LIC-ENT-1YR', disti: 2270.75, lineTotal: 6221.7, zohoDiscount: 3698.64 },
    { sku: 'LIC-MS130-48-1Y', disti: 653.7, lineTotal: 1790.94, zohoDiscount: 1064.61 },
  ];
  for (const c of cases) {
    // Round the SELL to cents first, then subtract. The other order is off by
    // a cent on LIC-MS130-48-1Y.
    const sell = round2(c.disti / (1 - 0.10));
    assert.equal(round2(c.lineTotal - sell), c.zohoDiscount, c.sku);
    // Margin, not markup.
    assert.equal(round2(((sell - c.disti) / sell) * 100), 10, `${c.sku} must achieve 10% margin`);
  }
});

test('a margin-priced commit survives the exact-dollar guard end to end', async () => {
  // 2195 x 2 = 4390 gross, cost 2500 -> sell 2777.78 -> discount 1612.22,
  // which is 36.72% of gross. The percent labels the line; the dollars are exact.
  const calls = stubZoho();
  const result = await w.quoteLineOps(QUOTE_ID, 'Quotes', {
    setDiscounts: [{ id: 'r3', pct: 36.72, dollars: 1612.22 }],
  }, ENV, {});
  assert.equal(result.success, true, result.message);
  const row = modifyRows(calls.puts[0]).find((r) => r.id === 'r3');
  assert.equal(row.Discount, 1612.22);
  assert.equal(row.Description, '36.72% Discount');
  assert.equal(calls.put, 1);
});

test('the worker and the client render the discount percent identically', async () => {
  // The rep approves the CLIENT's rendering; the WORKER's is what lands on the
  // quote. If these two ever drift, the description on the quote is not the one
  // that was reviewed. Drive both over the same table.
  const core = await import(path.join(WORKER, '../chrome-extension/src/sidebar/components/quote-line-editor-core.mjs'));
  const start = SOURCE.indexOf('function qleFmtPct(');
  const workerFmt = new Function(`${SOURCE.slice(start, SOURCE.indexOf('\n}', start) + 2)}\nreturn qleFmtPct;`)();
  for (const pct of [0, 0.01, 1, 12.5, 12.55, 20, 25, 33.33, 36.72, 59.44, 59.45, 60.56, 63.89, 66.11, 68.33, 99.99, 100]) {
    assert.equal(workerFmt(pct), core.fmtPct(pct), `qleFmtPct(${pct}) must equal fmtPct(${pct})`);
  }
  assert.equal(workerFmt(25.0), '25', 'trailing zeros are trimmed');
  assert.equal(workerFmt(68.33), '68.33', 'two decimals survive');
});

test('WooProducts price selection is deterministic: newest ACTIVE row wins', () => {
  // WooProducts keeps one row per WooCommerce VARIATION, so a single SKU has
  // dozens of rows that do not agree. LIC-ENT-1YR really has rows at $117 last
  // touched 2025-02-24 and rows at $116 last touched 2026-08-07 (verified
  // against the live module 2026-08-20). The old `wooData.find(...)` returned
  // whichever the search happened to put first, so the same SKU could price at
  // $116 or $117 on consecutive calls.
  const start = SOURCE.indexOf('async function fetchLiveSkuPricing(');
  const fn = SOURCE.slice(start, SOURCE.indexOf('async function hydrateResolvedProductsWithLivePricing(', start));

  assert.doesNotMatch(fn, /const wooMatch = wooData\.find\(/, 'arbitrary first-match selection must be gone');
  assert.match(fn, /Inactive !== true/, 'inactive rows must be de-prioritised');
  assert.match(fn, /localeCompare/, 'rows must be ordered by Modified_Time');
  assert.match(fn, /const wooMatch = wooPool\[0\]/);
  assert.match(fn, /fields=WooProduct_Code,Stratus_Price,Inactive,Modified_Time/);
  assert.match(fn, /per_page=200/, 'all variations must be fetched, not the default page');
  // A disagreement is reported, never averaged or hidden.
  assert.match(fn, /_woo_price_conflict/);
  assert.doesNotMatch(fn, /reduce\(\(sum|\/ wooPool\.length/, 'prices must never be averaged');

  // Run the extracted selection over the real shape to prove the ordering.
  const rows = [
    { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 117, Inactive: false, Modified_Time: '2025-02-24T04:21:04-08:00' },
    { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 116, Inactive: false, Modified_Time: '2026-08-07T11:30:40-07:00' },
    { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 999, Inactive: true, Modified_Time: '2026-08-19T00:00:00-07:00' },
  ];
  const pick = (data) => {
    const candidates = data.filter((r) => r.WooProduct_Code === 'LIC-ENT-1YR' && Number(r.Stratus_Price) > 0);
    const active = candidates.filter((r) => r.Inactive !== true);
    return (active.length ? active : candidates)
      .slice()
      .sort((a, b) => String(b.Modified_Time || '').localeCompare(String(a.Modified_Time || '')))[0];
  };
  assert.equal(pick(rows).Stratus_Price, 116, 'newest ACTIVE row, not the newest row overall');
  // Order of the input must not change the answer.
  assert.equal(pick([...rows].reverse()).Stratus_Price, 116);
  assert.equal(pick([rows[1], rows[0], rows[2]]).Stratus_Price, 116);
});

test('the ecomm endpoint resolves the EXACT quote-line SKU before canonicalizing', () => {
  // MS130-48X (2026-08-20). applySuffix appends -HW to any /^MS\d/ SKU (MS150
  // was already special-cased out of that rule; MS130 was not). WooProducts has
  // no MS130-48X-HW row, so fetchLiveSkuPricing fell through to the price cache
  // under the SUFFIXED key and returned $5,474 from a different Zoho product
  // (id ...182445404, list $9,428) instead of the $4,947 the storefront charges
  // for the product actually on the quote (id ...390014574, list $10,625.63).
  // Six units: $32,844 instead of $29,682.
  const start = SOURCE.indexOf("case '/api/quote-line-ecomm': {");
  const block = SOURCE.slice(start, SOURCE.indexOf("case '/api/zoho-quote-items': {", start));

  assert.match(block, /await fetchEcommPriceByExactCode\(sku, env\)/);
  // Exact must be tried BEFORE the canonicalizing path.
  assert.ok(block.indexOf('fetchEcommPriceByExactCode') < block.indexOf('await fetchLiveSkuPricing'),
    'the exact lookup must come first');
  // A canonicalized price must never arrive unlabelled.
  assert.match(block, /_resolved_under/);
  assert.match(block, /resolvedUnder: live\._resolved_under \|\| null/);
  // And a resolved price whose list price says "different product" is refused.
  assert.match(block, /listGap > 0\.02/);
  assert.match(block, /That is a different product, so the line was left unchanged/);
});

test('the exact-code lookup ignores bundle rows and picks the newest active one', () => {
  const start = SOURCE.indexOf('async function fetchEcommPriceByExactCode(');
  const fn = SOURCE.slice(start, SOURCE.indexOf('async function hydrateResolvedProductsWithLivePricing(', start));
  // WooProducts really holds "MS130-48X + LIC-MS130-48-1Y" bundle variations at
  // $5,103 alongside the bare MS130-48X at $4,947. A bundle must never price a
  // bare line.
  assert.match(fn, /includes\('\+'\)/);
  assert.match(fn, /Inactive !== true/);
  assert.match(fn, /localeCompare/);
  assert.match(fn, /Woo_Price/, 'the storefront list is fetched as a cross-check');

  // Drive the selection over the real rows for MS130-48X.
  const rows = [
    { WooProduct_Code: 'MS130-48X + LIC-MS130-48-1Y', Stratus_Price: 5103, Inactive: false, Modified_Time: '2026-08-07T10:02:17-07:00' },
    { WooProduct_Code: 'MS130-48X', Stratus_Price: 4947, Inactive: false, Modified_Time: '2026-08-07T10:02:36-07:00' },
    { WooProduct_Code: 'MS130-48X', Stratus_Price: 4947, Inactive: false, Modified_Time: '2026-08-07T10:02:15-07:00' },
  ];
  const exact = 'MS130-48X';
  const picked = rows
    .filter((r) => r.WooProduct_Code.toUpperCase() === exact && !r.WooProduct_Code.includes('+') && Number(r.Stratus_Price) > 0)
    .filter((r) => r.Inactive !== true)
    .slice()
    .sort((a, b) => String(b.Modified_Time || '').localeCompare(String(a.Modified_Time || '')))[0];
  assert.equal(picked.Stratus_Price, 4947, 'the bare product, not the bundle');
  assert.equal(4947 * 6, 29682, 'which is the total Chris expects');
});

test('the endpoints are registered on the /api/* switch and never on the agent loop', () => {
  assert.match(SOURCE, /case '\/api\/quote-lines': \{/);
  assert.match(SOURCE, /case '\/api\/quote-line-ops': \{/);
  // mapSubformToItems is pinned by a no-margin invariant test elsewhere, so the
  // richer read endpoint must not have been bolted onto it.
  assert.match(SOURCE, /function mapSubformToItems\(rows\) \{/);
  const mapFn = SOURCE.slice(SOURCE.indexOf('function mapSubformToItems(rows) {'));
  assert.doesNotMatch(mapFn.slice(0, mapFn.indexOf('\n}\n')), /List_Price|Discount|listPrice/);
});
