// Actual editor -> Worker -> extension-verifier regression for repeated model
// rows. Rows sharing a SKU may be merged only when their row-local quote intent
// also matches; otherwise a tier or hardware-only decision is silently lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  normalizeSkuEditorRows,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';
import { verifyStratusOrderUrlOptions } from './src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function extractRealWorkerFunctions() {
  const workerDir = path.resolve(__dirname, '../worker-gchat');
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
  src += '\nmodule.exports = { parseMessage, buildQuoteResponse, oneshotIntakeIntent };\n';
  const tmpPath = path.join(__dirname, `.tmp-duplicate-row-pipeline-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const worker = extractRealWorkerFunctions();
const ORDER_URL_RE = /https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g;

function optionsFromWorkerMessage(message) {
  return [...String(message || '').matchAll(ORDER_URL_RE)].map((match, index) => {
    const url = match[0];
    const terms = [...new Set(String(new URL(url).searchParams.get('item') || '')
      .split(',')
      .map((sku) => String(sku).match(/-([135])YR?$/i)?.[1] || '')
      .filter(Boolean))];
    const term = terms.length === 1 ? Number(terms[0]) : null;
    return { label: term ? `${term}-Year` : `Option ${index + 1}`, url };
  });
}

function cartOf(rawUrl) {
  const url = new URL(rawUrl);
  const skus = String(url.searchParams.get('item') || '').split(',').filter(Boolean);
  const qtys = String(url.searchParams.get('qty') || '').split(',').map(Number);
  return new Map(skus.map((sku, index) => [sku.toUpperCase(), qtys[index]]));
}

const MIXED_TIER_ROWS = [
  { sku: 'MX67', qty: 1, tier: 'security' },
  { sku: 'MX67', qty: 2, tier: 'enterprise' },
];

test('actual Worker intake ignores tier words inside literal LIC-* SKUs', () => {
  const literalText = 'quote 2 LIC-ENT-3YR and 1 MX67';
  const literalParsed = worker.parseMessage(literalText);
  assert.equal(literalParsed.requestedTier, 'ENT', 'control: the broad quote parser still sees the literal token');
  assert.equal(worker.oneshotIntakeIntent(literalParsed, literalText).license_tier, null);

  for (const [word, tier] of [['enterprise', 'ENT'], ['security', 'SEC']]) {
    const text = `quote 2 LIC-ENT-3YR and 1 MX67 ${word}`;
    const parsed = worker.parseMessage(text);
    assert.equal(worker.oneshotIntakeIntent(parsed, text).license_tier, tier, word);
  }
});

test('editor normalization merges only exact same-SKU, same-intent rows', () => {
  assert.deepEqual(normalizeSkuEditorRows([
    { sku: 'mx67', qty: 1, tier: 'security' },
    { sku: 'MX67', qty: 2, tier: 'security' },
  ]).rows, [
    { sku: 'MX67', qty: 3, tier: 'security', unresolved: false },
  ]);

  assert.deepEqual(normalizeSkuEditorRows(MIXED_TIER_ROWS).rows, [
    { sku: 'MX67', qty: 1, tier: 'security', unresolved: false },
    { sku: 'MX67', qty: 2, tier: 'enterprise', unresolved: false },
  ]);
});

test('serializer preserves repeated same-model row tiers and exact quantities', () => {
  const prepared = quoteTextFromEditorRows(
    MIXED_TIER_ROWS,
    'quote 1 MX67 security and 2 MX67 enterprise',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '1 MX67 security\n2 MX67 enterprise');
  assert.deepEqual(prepared.rows, MIXED_TIER_ROWS);
});

test('serializer still safely aggregates same-model rows when every intent field matches', () => {
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX67', qty: 1, tier: 'security' },
    { sku: 'MX67', qty: 2, tier: 'security' },
  ], '', {});
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '3 MX67 security');
  assert.deepEqual(prepared.rows, [{ sku: 'MX67', qty: 3, tier: 'security' }]);
});

test('blank editor row retains a prior global Enterprise tier through Worker and verifier', () => {
  const prepared = quoteTextFromEditorRows(
    [{ sku: 'MX67', qty: 1 }],
    'quote 1 MX67 enterprise',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '1 MX67\nenterprise');
  assert.deepEqual(prepared.rows, [{ sku: 'MX67', qty: 1, tier: 'enterprise' }]);

  const parsed = worker.parseMessage(prepared.text);
  const built = worker.buildQuoteResponse(parsed);
  assert.notEqual(built.compositionBlocked, true, built.message);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 3);

  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 1);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 1);
    assert.equal(cart.has(`LIC-MX67-SEC-${term}YR`), false);
  }
});

test('blank editor row keeps the MX default Security tier when no global tier exists', () => {
  const prepared = quoteTextFromEditorRows(
    [{ sku: 'MX67', qty: 1 }],
    'quote 1 MX67',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '1 MX67');
  assert.deepEqual(prepared.rows, [{ sku: 'MX67', qty: 1 }]);

  const parsed = worker.parseMessage(prepared.text);
  const built = worker.buildQuoteResponse(parsed);
  assert.notEqual(built.compositionBlocked, true, built.message);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 3);

  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 1);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.has(`LIC-MX67-ENT-${term}YR`), false);
  }
});

test('reviewed blank rows enforce MX, Z4, and MS130 family-default tiers', () => {
  const verify = (url, rows, requirements = {}) => verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url,
  }], rows, { requireLicensedOption: true, ...requirements });

  const blankMx = [{ sku: 'MX67', qty: 1 }];
  assert.equal(verify(
    'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1',
    blankMx,
  ).ok, true);
  for (const license of ['LIC-MX67-ENT-3YR', 'LIC-MX67-BOGUS-3YR', 'LIC-MX67-3YR']) {
    const result = verify(
      `https://stratusinfosystems.com/order/?item=MX67,${license}&qty=1,1`,
      blankMx,
    );
    assert.equal(result.ok, false, `${license} must not satisfy blank/default MX Security`);
    assert.equal(result.urls.length, 0);
  }

  const blankZ4 = [{ sku: 'Z4', qty: 1 }];
  assert.equal(verify(
    'https://stratusinfosystems.com/order/?item=Z4-HW,LIC-Z4-SEC-3Y&qty=1,1',
    blankZ4,
  ).ok, true);
  for (const license of ['LIC-Z4-ENT-3Y', 'LIC-Z4-BOGUS-3Y', 'LIC-Z4-3Y']) {
    const result = verify(
      `https://stratusinfosystems.com/order/?item=Z4-HW,${license}&qty=1,1`,
      blankZ4,
    );
    assert.equal(result.ok, false, `${license} must not satisfy blank/default Z4 Security`);
    assert.equal(result.urls.length, 0);
  }

  const blankMs = [{ sku: 'MS130-24P', qty: 1 }];
  assert.equal(verify(
    'https://stratusinfosystems.com/order/?item=MS130-24P,LIC-MS130-24-3Y&qty=1,1',
    blankMs,
  ).ok, true, 'MS130 Essentials is encoded by the unsuffixed port license');
  for (const license of ['LIC-MS130-24A-3Y', 'LIC-MS130-24X-3Y']) {
    const result = verify(
      `https://stratusinfosystems.com/order/?item=MS130-24P,${license}&qty=1,1`,
      blankMs,
    );
    assert.equal(result.ok, false, `${license} must not satisfy blank/default MS130 Essentials`);
    assert.equal(result.urls.length, 0);
  }
});

test('request-global Enterprise scopes an otherwise blank MX row before verification', () => {
  const verified = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-ENT-3YR&qty=1,1',
  }], [{ sku: 'MX67', qty: 1 }], {
    licenseTier: 'ENT',
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 1);
});

test('blank and Enterprise rows for one MX model remain default SEC x1 plus ENT x2', () => {
  const rows = [
    { sku: 'MX67', qty: 1 },
    { sku: 'MX67', qty: 2, tier: 'enterprise' },
  ];
  const prepared = quoteTextFromEditorRows(
    rows,
    'quote 1 MX67 and 2 MX67 enterprise',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '1 MX67\n2 MX67 enterprise');
  assert.deepEqual(prepared.rows, rows);

  const parsed = worker.parseMessage(prepared.text);
  assert.deepEqual(parsed.items.map((row) => ({
    sku: row.baseSku,
    qty: row.qty,
    tier: row.requestedTier || null,
  })), [
    { sku: 'MX67', qty: 1, tier: null },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
  ]);

  const built = worker.buildQuoteResponse(parsed);
  assert.notEqual(built.compositionBlocked, true, built.message);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 3);
  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 3);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 2);
  }
});

test('legacy Z1/Z3 blank quantities stay on their ENT-only family default', () => {
  const verified = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=Z3,LIC-Z3-ENT-3YR&qty=3,3',
  }], [
    { sku: 'Z3', qty: 1 },
    { sku: 'Z3', qty: 2, tier: 'enterprise' },
  ], {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 1);
});

test('actual Z3 Worker alternatives retain raw tiers but exact editor verification fails closed', () => {
  const rows = [
    { sku: 'Z3', qty: 1 },
    { sku: 'Z3', qty: 2, tier: 'enterprise' },
  ];
  const prepared = quoteTextFromEditorRows(
    rows,
    'quote 1 Z3 and 2 Z3 enterprise',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);
  assert.equal(prepared.text, '1 Z3\n2 Z3 enterprise');

  const parsed = worker.parseMessage(prepared.text);
  const built = worker.buildQuoteResponse(parsed);
  assert.notEqual(built.compositionBlocked, true, built.message);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 6);

  for (const term of [1, 3, 5]) {
    const asIsSku = `LIC-Z3-ENT-${term}YR`;
    const asIs = options.find((option) => cartOf(option.url).get(asIsSku) === 3);
    assert.ok(asIs, `${term}Y as-is Z3 ENT option is missing`);
    const asIsCart = cartOf(asIs.url);
    assert.equal(asIsCart.size, 1);

    const refresh = options.find((option) => {
      const cart = cartOf(option.url);
      return cart.get('Z4-HW') === 3
        && cart.get(`LIC-Z4-SEC-${term}Y`) === 1
        && cart.get(`LIC-Z4-ENT-${term}Y`) === 2;
    });
    assert.ok(refresh, `${term}Y Z4 refresh SEC1/ENT2 option is missing`);
  }

  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.urls.length, 0);
  assert.match(verified.error, /committed quantity for Z3|unexpected item/i);
});

test('same SKU cannot mix hardware-only and licensed quantities in one editor snapshot', () => {
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX67', qty: 1, tier: 'none' },
    { sku: 'MX67', qty: 2, tier: 'security' },
  ], '', {});
  assert.equal(prepared.ok, false);
  assert.match(prepared.error, /MX67.*hardware-only.*licensed.*separate quotes/i);
  assert.equal(prepared.text, '');
});

test('actual serializer -> Worker -> verifier keeps SEC x1 and ENT x2', () => {
  const prepared = quoteTextFromEditorRows(
    MIXED_TIER_ROWS,
    'quote 1 MX67 security and 2 MX67 enterprise',
    { haRequested: false },
  );
  assert.equal(prepared.ok, true, prepared.error);

  const parsed = worker.parseMessage(prepared.text);
  assert.deepEqual(parsed.items.map((row) => ({
    sku: row.baseSku,
    qty: row.qty,
    tier: row.requestedTier,
  })), [
    { sku: 'MX67', qty: 1, tier: 'SEC' },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
  ]);

  const built = worker.buildQuoteResponse(parsed);
  assert.notEqual(built.compositionBlocked, true, built.message);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 3);

  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 3);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 2);
  }
});

test('tier-aware verifier rejects a same-model companion with the wrong row quantity', () => {
  const wrong = [{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR,LIC-MX67-ENT-3YR&qty=3,3,2',
  }];
  const verified = verifyStratusOrderUrlOptions(wrong, MIXED_TIER_ROWS, {
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, false);
  assert.equal(verified.urls.length, 0);
  assert.match(verified.error, /wrong license quantity|unexpected item|duplicate license companion/i);
});
