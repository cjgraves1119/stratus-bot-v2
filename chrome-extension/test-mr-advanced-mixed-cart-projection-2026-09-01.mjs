// Milestone 1 (B): the exact MR Advanced mixed-cart path.
//
// Cart: MX67, 4x MR36-HW, 1x CW9162I, 2x C9300-24P-M, 2x MS130-24P with the
// Worker-derived paired projections already attached at 3 years. Changing
// MR36-HW from Enterprise to Advanced must:
//   1. immediately replace the visible derived LIC-ENT-3YR projection with
//      LIC-MR-ADV-3Y (same term, same synced quantity) as a rebuildable
//      pending projection - never a hard "License tier mismatch";
//   2. leave every other row, projection, group and position untouched;
//   3. serialize to editor text the Worker's deterministic pre-classifier
//      parser accepts ("4 MR36-HW advanced") so the V3 classifier is bypassed;
//   4. rebuild through the installed Worker to 1/3/5-year options that verify
//      against the committed rows and re-project LIC-MR-ADV at the shown term.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  applyLinkedQuoteRowPatch,
  groupQuoteEditorRows,
  licensePairReviewForRows,
  pairedLicenseSkuForTier,
  quoteRouteForRows,
  quoteTextFromEditorRows,
  rowsForLinkedQuoteRebuild,
  withPairedLicenseProjections,
} from './src/sidebar/components/sku-editor-core.mjs';
import { verifyStratusOrderUrlOptions } from './src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadInstalledWorker(workerDirName, exportsList) {
  const workerDir = path.resolve(__dirname, '..', workerDirName);
  const escPath = (rel) => path.join(workerDir, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(workerDir, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const exportDefault = src.indexOf('export default');
  if (exportDefault > -1) {
    let depth = 0;
    let started = false;
    let end = exportDefault;
    for (let index = exportDefault; index < src.length; index++) {
      if (src[index] === '{') { depth++; started = true; }
      if (src[index] === '}') {
        depth--;
        if (started && depth === 0) { end = index + 1; break; }
      }
    }
    src = src.slice(0, exportDefault) + src.slice(end + 1);
  }
  src += `\nmodule.exports = { ${exportsList.join(', ')} };\n`;
  const tmpPath = path.join(__dirname, `.tmp-mr-adv-mixed-cart-${workerDirName}-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const WORKER_EXPORTS = ['parseMessage', 'buildQuoteResponse', 'parseExplicitSkuRequestBeforeClassifier', 'clauseRequestedTier'];
const gchat = loadInstalledWorker('worker-gchat', WORKER_EXPORTS);
const webex = loadInstalledWorker('worker', WORKER_EXPORTS);

const ORDER_URL_RE = /https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g;

function parseOrderUrlItems(url) {
  const items = ((String(url || '').match(/[?&]item=([^&]*)/) || [])[1] || '')
    .split(',').map(decodeURIComponent).map((s) => s.trim()).filter(Boolean);
  const qtys = ((String(url || '').match(/[?&]qty=([^&]*)/) || [])[1] || '')
    .split(',').map((q) => parseInt(q, 10));
  return items.map((sku, i) => ({ sku, qty: Number.isFinite(qtys[i]) && qtys[i] > 0 ? qtys[i] : 1 }));
}

function workerOptions(worker, text) {
  const parsed = worker.parseMessage(text);
  const built = worker.buildQuoteResponse(parsed);
  const message = String(built?.message || built || '');
  return [...message.matchAll(ORDER_URL_RE)].map((match) => {
    const url = match[0];
    const terms = [...new Set(parseOrderUrlItems(url)
      .map((line) => String(line.sku).match(/-([135])YR?$/i)?.[1] || '')
      .filter(Boolean))];
    return { label: terms.length === 1 ? `${terms[0]}-Year` : 'Option', termYears: terms.length === 1 ? Number(terms[0]) : null, url };
  });
}

function cartOf(url) {
  return new Map(parseOrderUrlItems(url).map(({ sku, qty }) => [sku.toUpperCase(), qty]));
}

function shape(rows) {
  // The pre-existing family tier sync also stamps `tier` on co-family LIC rows;
  // normalization drops it for LIC rows before serialization, so it is not part
  // of a licence row's identity here.
  return rows.map((row) => [
    row.sku,
    row.qty,
    /^LIC-/i.test(String(row.sku || '')) ? '' : (row.tier || ''),
    row.licenseIntent || '',
    row.projectionPending === true,
  ]);
}

function groupShape(rows) {
  return groupQuoteEditorRows(rows, licensePairReviewForRows(rows))
    .map((group) => [group.key, group.entries.map((entry) => entry.index)]);
}

// The committed hardware rows as the rep sees them after the first Generate
// at Enterprise, plus the paired projections the Worker derived for 3 years.
const COMMITTED_ENTERPRISE = [
  { sku: 'MX67', qty: 1 },
  { sku: 'MR36-HW', qty: 4, tier: 'enterprise' },
  { sku: 'CW9162I', qty: 1, tier: 'enterprise' },
  { sku: 'C9300-24P-M', qty: 2 },
  { sku: 'MS130-24P', qty: 2 },
];

function enterpriseCartWithProjections() {
  const prepared = quoteTextFromEditorRows(COMMITTED_ENTERPRISE, '');
  assert.equal(prepared.ok, true, prepared.error);
  const options = workerOptions(gchat, prepared.text);
  const threeYear = options.find((option) => option.termYears === 3);
  assert.ok(threeYear, JSON.stringify(options));
  return withPairedLicenseProjections(prepared.rows, parseOrderUrlItems(threeYear.url));
}

test('baseline: the enterprise mixed cart carries a paired LIC-ENT-3YR projection for both access points', () => {
  const rows = enterpriseCartWithProjections();
  assert.deepEqual(shape(rows), [
    ['MX67', 1, '', '', false],
    ['MR36-HW', 4, 'enterprise', '', false],
    ['CW9162I', 1, 'enterprise', '', false],
    ['C9300-24P-M', 2, '', '', false],
    ['MS130-24P', 2, '', '', false],
    ['LIC-MX67-SEC-3YR', 1, '', 'paired', false],
    ['LIC-ENT-3YR', 5, '', 'paired', false],
    ['LIC-C9300-24E-3Y', 2, '', 'paired', false],
    ['LIC-MS130-24-3Y', 2, '', 'paired', false],
  ]);
  const review = licensePairReviewForRows(rows);
  assert.ok(review.every((entry) => entry.kind !== 'mismatch'), JSON.stringify(review));
});

test('changing MR36-HW to Advanced immediately re-targets the visible projection to LIC-MR-ADV-3Y as a pending row', () => {
  const rows = enterpriseCartWithProjections();
  const before = groupShape(rows);
  const next = applyLinkedQuoteRowPatch(rows, 1, { tier: 'advanced' });

  assert.deepEqual(shape(next), [
    ['MX67', 1, '', '', false],
    ['MR36-HW', 4, 'advanced', '', false],
    // Same access-point family: the CW row follows so one LIC-MR-ADV line covers both.
    ['CW9162I', 1, 'advanced', '', false],
    ['C9300-24P-M', 2, '', '', false],
    ['MS130-24P', 2, '', '', false],
    ['LIC-MX67-SEC-3YR', 1, '', 'paired', false],
    ['LIC-MR-ADV-3Y', 5, '', 'paired', true],
    ['LIC-C9300-24E-3Y', 2, '', 'paired', false],
    ['LIC-MS130-24-3Y', 2, '', 'paired', false],
  ]);
  // No hard mismatch anywhere; the re-targeted projection reads as paired.
  const review = licensePairReviewForRows(next);
  assert.ok(review.every((entry) => entry.kind !== 'mismatch'), JSON.stringify(review));
  assert.equal(review[6].kind, 'paired');
  assert.equal(review[6].role, 'license');
  assert.equal(review[6].licenseQty, 5);
  assert.deepEqual(review[6].hardwareSkus, ['MR36-HW', 'CW9162I']);
  // Identity and grouping are stable: same indexes in the same groups.
  assert.deepEqual(groupShape(next), before);
  assert.equal(quoteRouteForRows(next).route, 'ecomm');

  // A second edit (quantity) keeps following the hardware while still pending.
  const requantified = applyLinkedQuoteRowPatch(next, 1, { qty: 6 });
  assert.equal(requantified[6].sku, 'LIC-MR-ADV-3Y');
  assert.equal(requantified[6].qty, 7);
  assert.equal(requantified[6].projectionPending, true);

  // Switching back re-targets the same row to the Enterprise family.
  const back = applyLinkedQuoteRowPatch(next, 2, { tier: 'enterprise' });
  assert.equal(back[6].sku, 'LIC-ENT-3YR');
  assert.equal(back[6].qty, 5);
  assert.equal(back[1].tier, 'enterprise');
});

test('the default (blank) MR tier also re-targets to LIC-MR-ADV when moved to Advanced', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 4 },
    { sku: 'LIC-ENT-5YR', qty: 4, licenseIntent: 'paired' },
  ];
  const next = applyLinkedQuoteRowPatch(rows, 0, { tier: 'advanced' });
  assert.deepEqual(shape(next), [
    ['MR36-HW', 4, 'advanced', '', false],
    ['LIC-MR-ADV-5Y', 4, '', 'paired', true],
  ]);
  assert.equal(licensePairReviewForRows(next)[1].kind, 'paired');
});

test('a pending projection is rebuildable, not publishable: rebuild strips it and direct serialization fails closed', () => {
  const rows = applyLinkedQuoteRowPatch(enterpriseCartWithProjections(), 1, { tier: 'advanced' });
  const rebuildRows = rowsForLinkedQuoteRebuild(rows);
  assert.deepEqual(rebuildRows.map((row) => row.sku), ['MX67', 'MR36-HW', 'CW9162I', 'C9300-24P-M', 'MS130-24P']);
  const prepared = quoteTextFromEditorRows(rebuildRows, '');
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.text.split('\n'), [
    '1 MX67',
    '4 MR36-HW advanced',
    '1 CW9162I advanced',
    '2 C9300-24P-M',
    '2 MS130-24P',
  ]);

  const direct = quoteTextFromEditorRows(rows, '');
  assert.equal(direct.ok, false);
  assert.equal(direct.errors?.[0]?.code, 'pending_paired_projection');
  assert.equal(direct.text, '');
});

test('a projection that cannot be re-targeted is reported pending rather than as a rep tier mismatch', () => {
  assert.equal(pairedLicenseSkuForTier('LIC-ENT-3YR', 'advanced'), 'LIC-MR-ADV-3Y');
  assert.equal(pairedLicenseSkuForTier('LIC-MR-ADV-1Y', 'enterprise'), 'LIC-ENT-1YR');
  assert.equal(pairedLicenseSkuForTier('LIC-C9300-24E-3Y', 'advanced'), 'LIC-C9300-24A-3Y');
  assert.equal(pairedLicenseSkuForTier('LIC-MS130-24-3Y', 'advanced'), 'LIC-MS130-24A-3Y');
  assert.equal(pairedLicenseSkuForTier('LIC-MS130-CMPTA-5Y', 'standard'), 'LIC-MS130-CMPT-5Y');
  assert.equal(pairedLicenseSkuForTier('LIC-MX67-SEC-3YR', 'sdwan'), 'LIC-MX67-SDW-3YR');
  assert.equal(pairedLicenseSkuForTier('LIC-MX67-SEC-3YR', 'advanced'), '');
  assert.equal(pairedLicenseSkuForTier('LIC-ENT-3YR', 'security'), '');
  assert.equal(pairedLicenseSkuForTier('LIC-MV-3YR', 'advanced'), '');

  // A stale paired projection flagged pending with a tier the hardware no
  // longer has stays inert: kind 'pending', never 'mismatch'.
  const stale = [
    { sku: 'MR36-HW', qty: 4, tier: 'advanced' },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'paired', projectionPending: true },
  ];
  const review = licensePairReviewForRows(stale);
  assert.equal(review[1].kind, 'pending');
  assert.equal(review[1].role, 'license');
  const direct = quoteTextFromEditorRows(stale, '');
  assert.equal(direct.ok, false);
  assert.equal(direct.errors?.[0]?.code, 'pending_paired_projection');
  // The same rows without the flag are still the rep-facing hard mismatch.
  const unflagged = stale.map(({ projectionPending: _pending, ...row }) => row);
  assert.equal(licensePairReviewForRows(unflagged)[1].kind, 'mismatch');
});

test('both installed Workers take the editor text down the deterministic pre-classifier path, V3 or not', () => {
  const rows = applyLinkedQuoteRowPatch(enterpriseCartWithProjections(), 1, { tier: 'advanced' });
  const prepared = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(rows), '');
  for (const [name, worker] of [['worker-gchat', gchat], ['worker', webex]]) {
    const parsed = worker.parseExplicitSkuRequestBeforeClassifier(prepared.text);
    assert.ok(parsed && Array.isArray(parsed.items), `${name}: explicit SKU list bypasses the classifier`);
    assert.equal(parsed.requestedTier, 'A', name);
    const mr = parsed.items.find((item) => item.baseSku === 'MR36');
    assert.equal(mr?.qty, 4, name);
    assert.equal(mr?.requestedTier, 'A', name);
    // ADV / ADVANCED / ADVANTAGE are all allowlisted tier words: an explicit SKU
    // list carrying any of them stays on the deterministic path, and every UI
    // spelling maps MR/CW to Advanced without becoming a global switch tier.
    for (const word of ['advanced', 'advantage', 'adv']) {
      const single = worker.parseExplicitSkuRequestBeforeClassifier(`4 MR36-HW ${word}`);
      assert.ok(single && single.items?.length === 1, `${name}: "${word}" is not classifier residue`);
      assert.equal(single.items[0].baseSku, 'MR36', `${name}: ${word}`);
      assert.equal(single.items[0].requestedTier, 'A', `${name}: ${word}`);
    }
    assert.equal(worker.clauseRequestedTier('advantage', 'MR36-HW'), 'A', `${name}: MR advantage`);
    assert.equal(worker.clauseRequestedTier('advantage', 'CW9162I-MR'), 'A', `${name}: CW advantage`);
    assert.equal(worker.clauseRequestedTier('advantage', 'C9300-24P-M'), null, `${name}: advantage must not bleed to C9300`);
    assert.equal(worker.clauseRequestedTier('advantage', 'MS130-24P'), null, `${name}: advantage must not bleed to MS130`);
    assert.equal(worker.clauseRequestedTier('advanced', 'C9300-24P-M'), 'A', `${name}: existing switch Advanced remains supported`);
    // Control: prose still goes to the classifier path.
    assert.equal(worker.parseExplicitSkuRequestBeforeClassifier('what is the difference between MR36 advanced and enterprise?'), null, name);
  }
});

test('the rebuilt Advanced cart verifies for 1, 3 and 5 years and re-projects LIC-MR-ADV without a pending flag', () => {
  const rows = applyLinkedQuoteRowPatch(enterpriseCartWithProjections(), 1, { tier: 'advanced' });
  const prepared = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(rows), '');
  const options = workerOptions(gchat, prepared.text);
  assert.equal(options.length, 3, JSON.stringify(options));

  // Mirrors ChatPanel.verifiedQuoteUrls: a row-local tier drops the stale
  // global tier requirement so the verifier judges each committed row.
  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
    licenseTier: null,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 1);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.get('MR36-HW'), 4);
    assert.equal(cart.get('CW9162I-MR'), 1);
    assert.equal(cart.get(`LIC-MR-ADV-${term}Y`), 5, `LIC-MR-ADV-${term}Y aggregates both access points`);
    assert.equal(cart.get('C9300-24P-M'), 2);
    assert.equal(cart.get(`LIC-C9300-24E-${term}Y`), 2);
    assert.equal(cart.get('MS130-24P'), 2);
    assert.equal(cart.get(`LIC-MS130-24-${term}Y`), 2);
    assert.ok(![...cart.keys()].some((sku) => /^LIC-ENT-/.test(sku)), `no LIC-ENT in ${verified.urls[index].url}`);
  }

  const threeYear = verified.urls.find((option) => option.termYears === 3);
  const projected = withPairedLicenseProjections(prepared.rows, parseOrderUrlItems(threeYear.url));
  assert.deepEqual(shape(projected), [
    ['MX67', 1, '', '', false],
    ['MR36-HW', 4, 'advanced', '', false],
    ['CW9162I', 1, 'advanced', '', false],
    ['C9300-24P-M', 2, '', '', false],
    ['MS130-24P', 2, '', '', false],
    ['LIC-MX67-SEC-3YR', 1, '', 'paired', false],
    ['LIC-MR-ADV-3Y', 5, '', 'paired', false],
    ['LIC-C9300-24E-3Y', 2, '', 'paired', false],
    ['LIC-MS130-24-3Y', 2, '', 'paired', false],
  ]);
  assert.ok(licensePairReviewForRows(projected).every((entry) => entry.kind !== 'mismatch'));
});
