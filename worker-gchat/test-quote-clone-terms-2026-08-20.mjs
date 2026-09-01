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

/** A renewal carrying both sides of one unambiguous EOL device family. */
function eolRefreshItems() {
  return [
    {
      id: 'eh1',
      Product_Name: { id: 'p-ms120-24p', Product_Code: 'MS120-24P-HW' },
      Quantity: 7,
      List_Price: 3000,
      Discount: 7000,
      Description: 'legacy hardware note',
      Sequence_Number: 1,
    },
    {
      id: 'el1',
      Product_Name: {
        id: String(CATALOG['LIC-MS120-24P-1YR'].zoho_product_id),
        Product_Code: 'LIC-MS120-24P-1YR',
      },
      Quantity: 7,
      List_Price: CATALOG['LIC-MS120-24P-1YR'].list,
      Discount: 700,
      Description: 'old renewal note',
      Sequence_Number: 2,
    },
    {
      id: 'a1',
      Product_Name: { id: 'p-pwr', Product_Code: 'MA-PWR-30W' },
      Quantity: 2,
      List_Price: 125,
      Discount: 0,
      Description: 'must stay untouched',
      Sequence_Number: 3,
    },
  ];
}

/**
 * Stub Zoho. GET returns the source, or the clone once it exists. PUT records
 * the payload. The native clone action goes through global fetch.
 *
 * `cloneRows` lets a test make the clone's subform disagree with the source,
 * and `mutate` lets the post-PUT re-read disagree with what was written.
 */
function stubZoho({
  items = sourceItems(),
  cloneFails = false,
  mutate = null,
  putResponse = null,
  ecommUnavailableSkus = [],
} = {}) {
  const calls = { get: 0, put: 0, puts: [], clones: 0, methods: [] };
  const source = items.map((i) => ({ ...i }));
  const unavailableEcomm = new Set(ecommUnavailableSkus.map((sku) => String(sku).toUpperCase()));
  // The clone starts as a faithful copy with FRESH subform row ids.
  let cloneRows = source.map((i, n) => ({ ...i, id: `c${n + 1}` }));
  let cloneSubject = 'Moonshot - 10x MR44 - 1-Year';

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
      return { data: [{ id: CLONE_ID, Subject: cloneSubject, Quote_Number: 'QT-1043', Grand_Total: 31000, Quoted_Items: cloneRows.map((i) => ({ ...i })) }] };
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
      const price = unavailableEcomm.has(code.toUpperCase()) ? null : ECOMM[code.toUpperCase()];
      return price
        ? { data: [{ WooProduct_Code: code.toUpperCase(), Stratus_Price: price, Woo_Price: 0, Inactive: false, Modified_Time: '2026-08-07T00:00:00-07:00' }] }
        : { data: [] };
    }
    if (method === 'PUT') {
      calls.put += 1;
      calls.puts.push(JSON.parse(JSON.stringify(body)));
      cloneSubject = body?.data?.[0]?.Subject || cloneSubject;
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

test('an explicit ecomm-unavailable catalog marker blocks frozen cache fallback before cloning', async () => {
  const target = CATALOG['LIC-ENT-3YR'];
  const hadMarker = Object.prototype.hasOwnProperty.call(target, 'ecomm_available');
  const previousMarker = target.ecomm_available;
  target.ecomm_available = false;
  try {
    const calls = stubZoho({ ecommUnavailableSkus: ['LIC-ENT-3YR'] });
    const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {});
    assert.equal(result.success, false);
    assert.equal(result.error, 'unmapped_licenses');
    assert.match(result.message, /no ecomm price/i);
    assert.equal(calls.clones, 0, 'an explicitly orphaned target must fail before native clone');
    assert.equal(calls.put, 0);
  } finally {
    if (hadMarker) target.ecomm_available = previousMarker;
    else delete target.ecomm_available;
  }
});

test('an EOL refresh re-terms MR Advanced without falling back to generic Enterprise', async () => {
  const advanced = CATALOG['LIC-MR-ADV-1Y'];
  const items = [
    ...eolRefreshItems(),
    {
      id: 'mr-adv-1',
      Product_Name: { id: String(advanced.zoho_product_id), Product_Code: 'LIC-MR-ADV-1Y' },
      Quantity: 4,
      List_Price: advanced.list,
      Discount: 100,
      Description: '',
      Sequence_Number: 4,
    },
  ];
  stubZoho({ items });
  const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {
    eolRefresh: { enabled: true },
  });
  assert.equal(result.success, true, result.message);
  assert.ok(result.swaps.some((swap) => swap.sku === 'LIC-MR-ADV-1Y'
    && swap.target_sku === 'LIC-MR-ADV-3Y'));
  assert.ok(!result.swaps.some((swap) => swap.sku === 'LIC-MR-ADV-1Y'
    && swap.target_sku.startsWith('LIC-ENT-')),
  'explicit MR Advanced must never silently downgrade to generic Enterprise');
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

test('an EOL refresh preview is read-only and exposes the exact replacement plan', async () => {
  const calls = stubZoho({ items: eolRefreshItems() });
  const preview = await w.previewCloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(calls.clones, 0, 'preview must never invoke the native Zoho clone action');
  assert.equal(calls.put, 0, 'preview must never write a quote');
  assert.equal(preview.available, true, preview.message);
  assert.match(preview.subject, /EOL Refresh/i);
  assert.equal(preview.eol_refresh?.complete, true);
  assert.equal(preview.eol_refresh?.replacements?.length, 1);
  const replacement = preview.eol_refresh.replacements[0];
  assert.equal(replacement.source_model, 'MS120-24P');
  assert.deepEqual(
    replacement.target_lines.map((line) => [line.sku, line.quantity, line.role, line.description]),
    [
      ['MS130-24P', 7, 'hardware', 'Replaces EOL MS120-24P'],
      ['LIC-MS130-24-1Y', 7, 'license', 'Replaces EOL MS120-24P'],
    ],
  );
});

test('an ambiguous EOL switch path blocks before a clone exists', async () => {
  const calls = stubZoho({
    items: [
      {
        id: 'el225',
        Product_Name: {
          id: String(CATALOG['LIC-MS225-48FP-1YR'].zoho_product_id),
          Product_Code: 'LIC-MS225-48FP-1YR',
        },
        Quantity: 4,
        List_Price: CATALOG['LIC-MS225-48FP-1YR'].list,
        Discount: 500,
        Description: 'End of Life Warning',
        Sequence_Number: 1,
      },
      {
        id: 'a1',
        Product_Name: { id: 'p-pwr', Product_Code: 'MA-PWR-30W' },
        Quantity: 1,
        List_Price: 125,
        Discount: 0,
        Sequence_Number: 2,
      },
    ],
  });
  const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(result.success, false);
  assert.equal(result.error, 'eol_replacement_choice_required');
  assert.deepEqual(result.alternatives, ['MS150-48FP-4G', 'MS150-48FP-4X']);
  assert.equal(calls.clones, 0, 'replacement ambiguity must be resolved before creating a CRM record');
  assert.equal(calls.put, 0);
  assert.equal(result.cloned_quote_id, undefined);
});

test('model-agnostic licences are carried over unchanged while model-specific EOL equipment refreshes', async () => {
  for (const sku of ['LIC-ENT-1YR', 'LIC-MR-ADV-1Y', 'LIC-MV-1YR', 'LIC-MT-1Y', 'LIC-SME-1YR']) {
    const generic = {
      id: `generic-${sku}`,
      Product_Name: { id: String(CATALOG[sku].zoho_product_id), Product_Code: sku },
      Quantity: 8,
      List_Price: CATALOG[sku].list,
      Discount: 100,
      Description: 'End of Life Warning\nRecommended Upgrade: current model',
      Sequence_Number: 4,
    };
    const calls = stubZoho({
      items: [...eolRefreshItems(), generic],
    });
    const preview = await w.previewCloneQuoteWithTerm(SRC_ID, null, ENV, {
      eolRefresh: { enabled: true },
    });

    assert.equal(preview.available, true, sku);
    assert.equal(preview.eol_refresh?.complete, true, sku);
    assert.deepEqual(preview.eol_refresh?.unresolved, [], sku);
    assert.equal(preview.untouched_count, 2, `${sku}: accessory and generic licence are carried over`);
    assert.equal(calls.clones, 0, `${sku}: preview must not create a quote`);
    assert.equal(calls.put, 0, `${sku}: preview must not write`);

    const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
      eolRefresh: { enabled: true },
    });
    assert.equal(result.success, true, `${sku}: ${result.message}`);
    assert.equal(result.eol_refresh?.complete, true, sku);
    assert.ok(result.untouched.some((line) => line.sku === sku && line.reason === 'refresh_only'), sku);
    const putRows = calls.puts[0]?.data?.[0]?.Quoted_Items || [];
    assert.equal(putRows.some((row) => String(row.id) === 'c4'), false,
      `${sku}: the model-agnostic clone row must not appear in the mutation payload`);
    assert.equal(calls.clones, 1, `${sku}: one reviewed refresh clone is created`);
    assert.equal(calls.put, 1, `${sku}: replacements share one atomic write`);
  }
});

test('an unidentified non-agnostic EOL row still blocks an otherwise partial refresh', async () => {
  const calls = stubZoho({
    items: [
      ...eolRefreshItems(),
      {
        id: 'unknown-eol',
        Product_Name: { id: 'p-unknown-eol', Product_Code: 'UNKNOWN-RETIRED-HW' },
        Quantity: 1,
        List_Price: 500,
        Discount: 0,
        Description: 'End of Life Warning\nRecommended Upgrade: unknown model',
        Sequence_Number: 4,
      },
    ],
  });
  const preview = await w.previewCloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(preview.available, false);
  assert.equal(preview.error, 'eol_source_ambiguous');
  assert.equal(preview.review_required, true);
  assert.equal(preview.eol_refresh?.complete, false);
  assert.equal(preview.eol_refresh?.unresolved?.[0]?.sku, 'UNKNOWN-RETIRED-HW');
  assert.equal(calls.clones, 0);
  assert.equal(calls.put, 0);
});

test('a quote with only model-agnostic licences has nothing model-specific to refresh', async () => {
  const sku = 'LIC-ENT-1YR';
  const calls = stubZoho({
    items: [{
      id: 'generic-only',
      Product_Name: { id: String(CATALOG[sku].zoho_product_id), Product_Code: sku },
      Quantity: 8,
      List_Price: CATALOG[sku].list,
      Discount: 100,
      Description: 'End of Life Warning',
      Sequence_Number: 1,
    }],
  });
  const preview = await w.previewCloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(preview.available, false);
  assert.equal(preview.error, 'nothing_to_refresh');
  assert.match(preview.message, /intentionally left unchanged/i);
  assert.equal(calls.clones, 0);
  assert.equal(calls.put, 0);
});

test('an explicit source tier cannot fall back to another catalogue tier in a CRM refresh clone', async () => {
  const sourceSku = 'LIC-MX64-ENT-1YR';
  const unavailablePreferredSkus = [
    'LIC-MX67-ENT-1YR',
    'LIC-MX67-ENT-3YR',
    'LIC-MX67-ENT-5YR',
  ];
  const savedPreferredRows = new Map(
    unavailablePreferredSkus.map((sku) => [sku, CATALOG[sku]]),
  );

  for (const sku of unavailablePreferredSkus) delete CATALOG[sku];
  try {
    const calls = stubZoho({
      items: [{
        id: 'mx64-ent',
        Product_Name: {
          id: String(CATALOG[sourceSku].zoho_product_id),
          Product_Code: sourceSku,
        },
        Quantity: 2,
        List_Price: CATALOG[sourceSku].list,
        Discount: 100,
        Description: 'End of Life Warning',
        Sequence_Number: 1,
      }],
    });

    const preview = await w.previewCloneQuoteWithTerm(SRC_ID, 3, ENV, {
      eolRefresh: { enabled: true },
    });
    assert.equal(preview.available, false);
    assert.equal(preview.error, 'eol_license_tier_review_required');
    assert.equal(preview.review_required, true);
    assert.equal(preview.eol_refresh?.complete, false);
    assert.match(preview.message, /explicit ENT tier is unavailable/i);
    assert.match(preview.message, /LIC-MX67-SEC-3YR/,
      'the review evidence names the real catalogue fallback family');
    assert.equal(calls.clones, 0, 'preview must remain read-only');
    assert.equal(calls.put, 0);

    const result = await w.cloneQuoteWithTerm(SRC_ID, 3, ENV, {
      eolRefresh: { enabled: true },
    });
    assert.equal(result.success, false);
    assert.equal(result.error, 'eol_license_tier_review_required');
    assert.equal(result.review_required, true);
    assert.equal(result.eol_refresh?.complete, false);
    assert.equal(result._undo_token, undefined);
    assert.equal(result._record_url, undefined);
    assert.equal(calls.clones, 0, 'tier fallback must stop before Zoho creates a clone');
    assert.equal(calls.put, 0, 'tier fallback must stop before any quote-line write');
  } finally {
    for (const [sku, row] of savedPreferredRows) CATALOG[sku] = row;
  }
});

test('refresh-only clone atomically replaces EOL hardware and its model-specific licence', async () => {
  const calls = stubZoho({ items: eolRefreshItems() });
  const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(result.success, true, result.message);
  assert.equal(calls.clones, 1, 'exactly one clone record is created');
  assert.equal(calls.put, 1, 'all EOL deletes and adds share one atomic PUT');
  const put = calls.puts[0];
  assert.equal(put.data.length, 1);
  assert.equal(put.data[0].Do_Not_Auto_Update_Prices, true);
  assert.match(put.data[0].Subject, /EOL Refresh/i);
  assert.deepEqual(deleteRows(put).map((row) => row.id).sort(), ['c1', 'c2']);

  const added = modifyRows(put);
  assert.equal(added.length, 2);
  const bySku = new Map(added.map((row) => [PID_TO_SKU[String(row.Product_Name?.id)], row]));
  for (const sku of ['MS130-24P', 'LIC-MS130-24-1Y']) {
    const row = bySku.get(sku);
    assert.ok(row, `${sku} must be added`);
    assert.equal(row.id, undefined);
    assert.equal(row.Quantity, 7);
    assert.equal(row.Description, 'Replaces EOL MS120-24P');
  }
  assert.equal(result.eol_refresh?.complete, true);
  assert.equal(result.eol_refresh?.replacements?.[0]?.source_model, 'MS120-24P');
  assert.equal(result.verification.success, true);
  assert.ok(result._undo_token, 'a verified refresh clone receives an undo token');
});

test('an EOL replacement verification mismatch suppresses success and undo', async () => {
  const calls = stubZoho({
    items: eolRefreshItems(),
    mutate: (rows) => rows.map((row) => (
      row.Product_Name?.Product_Code === 'MS130-24P'
        ? { ...row, Quantity: 6 }
        : row
    )),
  });
  const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(calls.put, 1, 'failed verification must not retry a clone write');
  assert.equal(result.success, false);
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.equal(result.verification?.success, false);
  assert.match(result.verification?.WARNING || '', /quantity|did NOT fully verify/i);
});

test('an untouched row cannot disappear behind a plausible final line count', async () => {
  const calls = stubZoho({
    items: eolRefreshItems(),
    mutate: (rows) => [
      ...rows.filter((row) => row.id !== 'c3'),
      {
        id: 'unexpected-but-count-balanced',
        Product_Name: { id: 'p-other', Product_Code: 'MA-CBL-40G-1M' },
        Quantity: 2,
        List_Price: 125,
        Discount: 0,
        Description: 'must stay untouched',
        Sequence_Number: 3,
      },
    ],
  });
  const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(calls.put, 1);
  assert.equal(result.verification?.line_count, eolRefreshItems().length,
    'the line count alone looks plausible and must not prove preservation');
  assert.equal(result.success, false);
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.match(result.verification?.WARNING || '', /untouched row c3 is missing/i);
});

test('a replacement with the wrong list price fails verification and suppresses undo', async () => {
  const calls = stubZoho({
    items: eolRefreshItems(),
    mutate: (rows) => rows.map((row) => (
      row.Product_Name?.Product_Code === 'MS130-24P'
        ? { ...row, List_Price: Number(row.List_Price) + 1 }
        : row
    )),
  });
  const result = await w.cloneQuoteWithTerm(SRC_ID, null, ENV, {
    eolRefresh: { enabled: true },
  });

  assert.equal(calls.put, 1, 'a verification failure must never retry the clone write');
  assert.equal(result.success, false);
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.match(result.verification?.WARNING || '', /MS130-24P: list price did not land/i);
});

test('the endpoints are registered and the write path is sequential', () => {
  assert.match(SOURCE, /case '\/api\/quote-clone-terms': \{/);
  assert.match(SOURCE, /case '\/api\/quote-clone-terms-preview': \{/);
  assert.match(SOURCE, /case '\/api\/quote-clone-refresh':\s*case '\/api\/quote-clone-terms': \{/,
    'refresh writes use a dedicated route that an older Worker cannot mistake for an ordinary term clone');
  assert.match(SOURCE, /case '\/api\/quote-clone-refresh-preview':\s*case '\/api\/quote-clone-terms-preview': \{/,
    'refresh previews use the same fail-closed compatibility boundary');

  const refreshWriteStart = SOURCE.indexOf("case '/api/quote-clone-refresh':");
  const refreshPreviewStart = SOURCE.indexOf("case '/api/quote-clone-refresh-preview':");
  const refreshWriteBlock = SOURCE.slice(refreshWriteStart, refreshPreviewStart);
  const refreshPreviewBlock = SOURCE.slice(refreshPreviewStart, SOURCE.indexOf("case '/api/quote-line-costs':", refreshPreviewStart));
  assert.match(refreshWriteBlock,
    /url\.pathname === '\/api\/quote-clone-refresh' && !eolRefresh\.enabled[\s\S]{0,180}status: 400/,
    'the dedicated write route rejects any request that did not explicitly enable refresh');
  assert.match(refreshPreviewBlock,
    /url\.pathname === '\/api\/quote-clone-refresh-preview' && !eolRefresh\.enabled[\s\S]{0,180}status: 400/,
    'the dedicated preview route rejects any request that did not explicitly enable refresh');

  const start = SOURCE.indexOf("case '/api/quote-clone-terms': {");
  const block = SOURCE.slice(start, SOURCE.indexOf("case '/api/quote-clone-terms-preview': {", start));
  // A clone is several Zoho calls and zohoApiCall has no 429 retry, so terms
  // are never fanned out.
  assert.doesNotMatch(block, /Promise\.all/);
  assert.match(block, /for \(const term of (?:terms|jobs)/);
  // Each term is independent: one failure must not abort the others.
  assert.match(block, /catch \(err\)/);
});
