/**
 * Clone a quote onto a different licence term (2026-08-20).
 *
 * Chris's rules, and what each test here defends:
 *   - HARDWARE IS UNTOUCHED. Only termed LIC-* lines are swapped; every other
 *     line keeps the source quote's own discount, carried by the additive PUT.
 *   - Swapped licences price at ECOMM.
 *   - 7YR/10YR have no ecomm price by design, so they take the fixed co-term
 *     discount: 50% and 55% off list (55% supersedes the old 60%).
 *   - The subject's term is swapped in place.
 *
 * The load-bearing structural rule: every line is classified and priced BEFORE
 * anything is cloned, so an unmappable licence fails the request without
 * leaving an orphan quote in Zoho for someone to find later.
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
  src += `\nmodule.exports={
    classifyQuoteForTerm, previewCloneQuoteWithTerm, cloneQuoteWithTerm, subjectForTerm,
    COTERM_DEFAULT_DISCOUNT, CLONE_TERM_ALLOWED,
    setZohoApiCall:(fn)=>{zohoApiCall=fn;},
    setGetZohoAccessToken:(fn)=>{getZohoAccessToken=fn;}
  };\n`;
  const t = path.join(WORKER, `.tmp-clone-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();
const CATALOG = require(path.join(WORKER, 'src/data/prices.json')).prices;

// resolveTargetLicenseEconomics reads the BUNDLED catalog first, so a 1/3/5
// target resolves to the real product id and list price no matter what the
// stub says. Only the co-term 7/10 targets (absent from the catalog by design)
// fall through to the stubbed live Zoho lookup. Build the reverse map from the
// real catalog so the stub can label the rows it adds.
const PID_TO_SKU = {};
for (const [sku, entry] of Object.entries(CATALOG)) {
  if (entry?.zoho_product_id) PID_TO_SKU[String(entry.zoho_product_id)] = sku;
}
Object.assign(PID_TO_SKU, {
  'p-ent7': 'LIC-ENT-7YR', 'p-ent10': 'LIC-ENT-10YR',
  'p-ms48-7': 'LIC-MS130-48-7Y', 'p-ms48-10': 'LIC-MS130-48-10Y',
});

const SRC_ID = '2570562000422125077';
const CLONE_ID = '2570562000999000111';

/** A mixed quote: 3 hardware lines and 2 termed licences, all at 1 year. */
function sourceItems() {
  return [
    { id: 'h1', Product_Name: { id: 'p-mr', Product_Code: 'MR44-HW' }, Quantity: 10, List_Price: 1716.68, Discount: 8000, Description: 'hand priced', Sequence_Number: 1 },
    { id: 'l1', Product_Name: { id: 'p-ent1', Product_Code: 'LIC-ENT-1YR' }, Quantity: 10, List_Price: 200, Discount: 840, Description: '', Sequence_Number: 2 },
    { id: 'h2', Product_Name: { id: 'p-ms', Product_Code: 'MS130-48X' }, Quantity: 2, List_Price: 10625.63, Discount: 5000, Description: '', Sequence_Number: 3 },
    { id: 'l2', Product_Name: { id: 'p-ms48-1', Product_Code: 'LIC-MS130-48-1Y' }, Quantity: 2, List_Price: 298.49, Discount: 284.98, Description: '', Sequence_Number: 4 },
    { id: 'h3', Product_Name: { id: 'p-pwr', Product_Code: 'MA-PWR-30W' }, Quantity: 4, List_Price: 125, Discount: 0, Description: '', Sequence_Number: 5 },
  ];
}

/**
 * Stub Zoho. GET returns the source, or the clone once it exists. PUT records
 * the payload. The native clone action goes through global fetch.
 *
 * `cloneRows` lets a test make the clone's subform disagree with the source,
 * and `mutate` lets the post-PUT re-read disagree with what was written.
 */
function stubZoho({ items = sourceItems(), cloneFails = false, mutate = null, putResponse = null } = {}) {
  const calls = { get: 0, put: 0, puts: [], clones: 0, methods: [] };
  const source = items.map((i) => ({ ...i }));
  // The clone starts as a faithful copy with FRESH subform row ids.
  let cloneRows = source.map((i, n) => ({ ...i, id: `c${n + 1}` }));

  w.setGetZohoAccessToken(async () => 'fake-token');
  globalThis.fetch = async (url) => {
    calls.clones += 1;
    if (cloneFails) {
      return { text: async () => JSON.stringify({ data: [{ status: 'error', code: 'INVALID_DATA', message: 'nope' }] }) };
    }
    return { text: async () => JSON.stringify({ data: [{ status: 'success', details: { id: CLONE_ID } }] }) };
  };

  w.setZohoApiCall(async (method, apiPath, env, body) => {
    calls.methods.push(`${method} ${apiPath}`);
    if (method === 'GET' && apiPath.startsWith(`Quotes/${SRC_ID}`)) {
      calls.get += 1;
      return { data: [{ id: SRC_ID, Subject: 'Moonshot - 10x MR44 - 1-Year', Quote_Number: 'QT-1042', Grand_Total: 30000, Quoted_Items: source.map((i) => ({ ...i })) }] };
    }
    if (method === 'GET' && apiPath.startsWith(`Quotes/${CLONE_ID}`)) {
      calls.get += 1;
      return { data: [{ id: CLONE_ID, Subject: 'Moonshot - 10x MR44 - 1-Year', Quote_Number: 'QT-1043', Grand_Total: 31000, Quoted_Items: cloneRows.map((i) => ({ ...i })) }] };
    }
    if (method === 'GET' && apiPath.startsWith('Products/')) {
      // Term siblings, priced the way the real catalog is.
      const code = decodeURIComponent(apiPath).match(/equals:([^)&]+)/)?.[1] || '';
      const CATALOG = {
        'LIC-ENT-3YR': ['p-ent3', 450], 'LIC-ENT-5YR': ['p-ent5', 750],
        'LIC-ENT-7YR': ['p-ent7', 1050], 'LIC-ENT-10YR': ['p-ent10', 1500],
        'LIC-MS130-48-3Y': ['p-ms48-3', 672.35], 'LIC-MS130-48-5Y': ['p-ms48-5', 1121.58],
        'LIC-MS130-48-7Y': ['p-ms48-7', 1570], 'LIC-MS130-48-10Y': ['p-ms48-10', 2243],
      };
      const hit = CATALOG[code.toUpperCase()];
      return hit ? { data: [{ id: hit[0], Product_Code: code.toUpperCase(), Unit_Price: hit[1], Product_Active: true }] } : { data: [] };
    }
    if (method === 'GET' && apiPath.startsWith('WooProducts/search')) {
      const code = decodeURIComponent(apiPath).match(/equals:([^)&]+)/)?.[1] || '';
      const ECOMM = {
        'LIC-ENT-3YR': 262, 'LIC-ENT-5YR': 436,
        'LIC-MS130-48-3Y': 352, 'LIC-MS130-48-5Y': 587,
      };
      const price = ECOMM[code.toUpperCase()];
      return price
        ? { data: [{ WooProduct_Code: code.toUpperCase(), Stratus_Price: price, Woo_Price: 0, Inactive: false, Modified_Time: '2026-08-07T00:00:00-07:00' }] }
        : { data: [] };
    }
    if (method === 'PUT') {
      calls.put += 1;
      calls.puts.push(JSON.parse(JSON.stringify(body)));
      const rows = body?.data?.[0]?.Quoted_Items || [];
      for (const row of rows) {
        if (Object.prototype.hasOwnProperty.call(row, '_delete')) {
          cloneRows = cloneRows.filter((r) => String(r.id) !== String(row.id));
        } else if (!row.id) {
          const code = PID_TO_SKU[String(row.Product_Name?.id)] || 'UNKNOWN';
          cloneRows.push({
            id: `n${cloneRows.length + 1}`, Product_Name: { id: row.Product_Name.id, Product_Code: code },
            Quantity: row.Quantity, List_Price: row.List_Price, Discount: row.Discount,
            Description: row.Description, Sequence_Number: row.Sequence_Number,
          });
        }
      }
      if (mutate) cloneRows = mutate(cloneRows);
      return putResponse || { data: [{ code: 'SUCCESS', message: 'updated', details: { id: CLONE_ID } }] };
    }
    throw new Error(`unexpected ${method} ${apiPath}`);
  });
  return calls;
}

const ENV = {}; // no ANALYTICS_DB, so logCrmOpToD1 short-circuits

const roundTo = (v) => Math.round(v * 100) / 100;
const modifyRows = (put) => (put.data[0].Quoted_Items || []).filter((r) => !('_delete' in r));
const deleteRows = (put) => (put.data[0].Quoted_Items || []).filter((r) => '_delete' in r);

test('the co-term policy is 7YR 50% and 10YR 55%', () => {
  // Chris 2026-08-20, superseding the 2026-07-14 pair that had 10YR at 60%.
  // Global on purpose: the clone, reterm_quote_licenses and
  // correctQuotedItemDiscounts all read this one constant.
  assert.equal(w.COTERM_DEFAULT_DISCOUNT[7], 0.50);
  assert.equal(w.COTERM_DEFAULT_DISCOUNT[10], 0.55);
  assert.deepEqual(w.CLONE_TERM_ALLOWED, [1, 3, 5, 7, 10]);
  assert.doesNotMatch(SOURCE.slice(SOURCE.indexOf('const COTERM_DEFAULT_DISCOUNT')), /^const COTERM_DEFAULT_DISCOUNT = \{ 7: 0\.50, 10: 0\.60 \}/);
});

test('the subject swaps its term in place, or gains one', () => {
  assert.equal(w.subjectForTerm('Moonshot - 10x MR44 - 1-Year', 3), 'Moonshot - 10x MR44 - 3-Year');
  assert.equal(w.subjectForTerm('Acme 5 Year refresh', 1), 'Acme 1-Year refresh');
  assert.equal(w.subjectForTerm('Acme 3YR', 5), 'Acme 5-Year');
  assert.equal(w.subjectForTerm('Acme refresh', 3), 'Acme refresh - 3-Year');
  assert.equal(w.subjectForTerm('', 5), '5-Year');
  // 10 must not be read as a leading "1".
  assert.equal(w.subjectForTerm('Acme - 10-Year', 3), 'Acme - 3-Year');
  assert.equal(w.subjectForTerm('Acme - 1-Year', 10), 'Acme - 10-Year');
});

test('only termed licences are swapped; hardware is never in the payload', async () => {
  const calls = stubZoho();
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  assert.equal(result.success, true, result.message);
  assert.equal(calls.put, 1, 'exactly ONE PUT on the clone');

  // Two licence lines swapped, three hardware lines carried over.
  assert.equal(result.swaps.length, 2);
  assert.deepEqual(result.swaps.map((s) => s.sku).sort(), ['LIC-ENT-1YR', 'LIC-MS130-48-1Y']);
  assert.equal(result.untouched.length, 3);

  // THE HARDWARE RULE: no hardware row appears in the PUT at all, so the
  // additive semantics leave the clone's own hardware exactly as cloned.
  const put = calls.puts[0];
  const touchedIds = new Set([...deleteRows(put).map((r) => String(r.id))]);
  assert.deepEqual([...touchedIds].sort(), ['c2', 'c4'], 'only the two licence rows are deleted');
  for (const row of modifyRows(put)) {
    assert.equal(row.id, undefined, 'added rows carry no id');
    // Every added row must be a LICENCE at the target term. Resolved through
    // the product id the worker actually sent, so a hardware product slipping
    // into the payload would fail here.
    const sku = PID_TO_SKU[String(row.Product_Name?.id)];
    assert.ok(sku, `product ${row.Product_Name?.id} is not a known catalog product`);
    assert.match(sku, /^LIC-/, `${sku} is not a licence`);
    assert.match(sku, /-3(YR|Y)$/, `${sku} is not at the 3 year target term`);
  }
  assert.equal(put.data[0].Do_Not_Auto_Update_Prices, true);
  assert.equal(put.data[0].Subject, 'Moonshot - 10x MR44 - 3-Year');
});

test('swapped licences price at ECOMM for 1/3/5', async () => {
  const calls = stubZoho();
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  const ent = result.swaps.find((s) => s.target_sku === 'LIC-ENT-3YR');
  // List comes from the bundled catalog (452), the price from the storefront
  // (262): 10 units is a 4520 list total, 2620 net, so 1900 of discount.
  assert.equal(ent.unit_price, 262);
  assert.equal(ent.new_list_total, roundTo(CATALOG['LIC-ENT-3YR'].list * 10));
  assert.equal(ent.new_net_total, 2620);
  assert.equal(ent.new_discount, roundTo(ent.new_list_total - 2620));
  assert.equal(ent.pricing, 'ecomm');

  const ms = result.swaps.find((s) => s.target_sku === 'LIC-MS130-48-3Y');
  assert.equal(ms.unit_price, 352);
  assert.equal(ms.new_net_total, 704);
  assert.equal(ms.pricing, 'ecomm');

  // And that is what actually reaches Zoho.
  const entPid = String(CATALOG['LIC-ENT-3YR'].zoho_product_id);
  const added = modifyRows(calls.puts[0]);
  assert.equal(added.find((r) => String(r.Product_Name.id) === entPid).Discount, ent.new_discount);
});

test('7 and 10 year take the fixed co-term discount, not ecomm', async () => {
  for (const [term, pct] of [[7, 0.50], [10, 0.55]]) {
    const calls = stubZoho();
    const result = await w.cloneQuoteWithTerm(SRC_ID, term, ENV, {});
    assert.equal(result.success, true, `${term}yr: ${result.message}`);
    const ent = result.swaps.find((s) => s.target_sku === `LIC-ENT-${term}YR`);
    const listTotal = ent.new_list_total;
    assert.equal(ent.new_discount, Math.round(listTotal * pct * 100) / 100, `${term}yr discount`);
    assert.equal(ent.pricing, `coterm_default_${Math.round(pct * 100)}pct`);
    // These SKUs have no WooProducts row, which is exactly why they use the
    // fixed discount rather than failing.
    assert.equal(calls.put, 1);
  }
  // Spot the actual numbers: 10YR list 1500 x 10 = 15000, 55% off = 8250.
  const calls = stubZoho();
  const ten = await w.cloneQuoteWithTerm(SRC_ID, 10, ENV, {});
  const ent = ten.swaps.find((s) => s.target_sku === 'LIC-ENT-10YR');
  assert.equal(ent.new_list_total, 15000);
  assert.equal(ent.new_discount, 8250);
  assert.equal(ent.new_net_total, 6750);
});

test('an unmappable licence fails BEFORE anything is cloned', async () => {
  // The whole point of classifying first: no orphan quote is left in Zoho.
  const calls = stubZoho({
    items: [
      ...sourceItems(),
      { id: 'l9', Product_Name: { id: 'p-odd', Product_Code: 'LIC-NOSUCH-1YR' }, Quantity: 1, List_Price: 100, Discount: 0, Sequence_Number: 6 },
    ],
  });
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result.error, 'unmapped_licenses');
  assert.match(result.message, /NOTHING was cloned/);
  assert.equal(calls.clones, 0, 'the clone action must never fire');
  assert.equal(calls.put, 0, 'and nothing is written');
  assert.equal(result.cloned_quote_id, undefined);
});

test('a quote already at the target term is refused, with no clone', async () => {
  const calls = stubZoho();
  const result = await w.cloneQuoteWithTerm(SRC_ID, 1, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result.error, 'nothing_to_reterm');
  assert.equal(calls.clones, 0);
  assert.equal(calls.put, 0);
});

test('a failed clone action reports cleanly and writes nothing', async () => {
  const calls = stubZoho({ cloneFails: true });
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result.error, 'clone_failed');
  assert.equal(calls.put, 0);
});

test('a clone that exists but cannot be re-termed still reports its id', async () => {
  // Once a record exists, someone has to know about it even on failure.
  const calls = stubZoho({ putResponse: { data: [{ code: 'INVALID_DATA', message: 'nope', details: {} }] } });
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result.error, 'write_rejected');
  assert.equal(result.cloned_quote_id, CLONE_ID, 'the orphan clone must be named');
  assert.match(result.cloned_quote_url, /Quotes\/2570562000999000111$/);
  assert.match(result.message, /still carries the original terms|re-check the clone/i);
  assert.equal(result._undo_token, undefined);
});

test('a verification mismatch suppresses the undo token', async () => {
  // Leave one old licence row behind on the clone.
  const calls = stubZoho({ mutate: (rows) => [...rows, { id: 'ghost', Product_Name: { id: 'p-ent1', Product_Code: 'LIC-ENT-1YR' }, Quantity: 10, List_Price: 200, Discount: 840 }] });
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  assert.equal(result.success, false);
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.match(result.verification.WARNING, /did NOT fully verify/);
  assert.equal(calls.put, 1, 'a failed verification must not trigger another write');
});

test('the preview writes nothing and matches what the clone would do', async () => {
  const calls = stubZoho();
  const preview = await w.previewCloneQuoteWithTerm(SRC_ID, 3, ENV);
  assert.equal(calls.clones, 0, 'preview must not clone');
  assert.equal(calls.put, 0, 'preview must not write');
  assert.equal(preview.available, true);
  assert.equal(preview.subject, 'Moonshot - 10x MR44 - 3-Year');
  assert.equal(preview.swaps.length, 2);
  assert.equal(preview.untouched_count, 3);

  // The preview's numbers must be the clone's numbers, because both come from
  // the same classifier.
  const real = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
  for (const p of preview.swaps) {
    const actual = real.swaps.find((s) => s.target_sku === p.target_sku);
    assert.equal(p.unit_price, actual.unit_price, `${p.target_sku} unit price`);
    assert.equal(p.new_net_total, actual.new_net_total, `${p.target_sku} net`);
  }
  // Licence subtotal moves; the preview reports it without implying the
  // hardware moved, because it does not.
  assert.equal(preview.licence_total_after, 2620 + 704);
});

test('an unavailable term previews as unavailable rather than throwing', async () => {
  stubZoho();
  const preview = await w.previewCloneQuoteWithTerm(SRC_ID, 1, ENV);
  assert.equal(preview.available, false);
  assert.equal(preview.error, 'nothing_to_reterm');
  assert.ok(preview.message);
});

test('the endpoints are registered and the write path is sequential', () => {
  assert.match(SOURCE, /case '\/api\/quote-clone-terms': \{/);
  assert.match(SOURCE, /case '\/api\/quote-clone-terms-preview': \{/);
  const start = SOURCE.indexOf("case '/api/quote-clone-terms': {");
  const block = SOURCE.slice(start, SOURCE.indexOf("case '/api/quote-clone-terms-preview': {", start));
  // A clone is several Zoho calls and zohoApiCall has no 429 retry, so terms
  // are never fanned out.
  assert.doesNotMatch(block, /Promise\.all/);
  assert.match(block, /for \(const term of terms/);
  // Each term is independent: one failure must not abort the others.
  assert.match(block, /catch \(err\)/);
});
