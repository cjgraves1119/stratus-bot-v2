import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import {
  licenseTierOptionsForSku,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';
import { verifyStratusOrderUrlOptions } from './src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

function grabFunction(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

function loadFn(src, name) {
  const code = grabFunction(src, name);
  const context = { String };
  vm.createContext(context);
  vm.runInContext(`${code}\nthis.__fn = ${name};`, context);
  return context.__fn;
}

const gchatSrc = fs.readFileSync(path.join(repoRoot, 'worker-gchat/src/index.js'), 'utf8');
const workerSrc = fs.readFileSync(path.join(repoRoot, 'worker/src/index.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');

const clauseRequestedTier = loadFn(gchatSrc, 'clauseRequestedTier');
const gchatLicenses = loadFn(gchatSrc, '_getLicenseSkusRaw');
const workerLicenses = loadFn(workerSrc, '_getLicenseSkusRaw');

test('editor serializes 3 MR44 advanced', () => {
  const result = quoteTextFromEditorRows([{ sku: 'MR44', qty: 3, tier: 'advanced' }], '');
  assert.equal(result.ok, true);
  assert.match(result.text, /3 MR44 advanced/);
});

test('ChatPanel empty-state example uses the valid MR Advanced suffix', () => {
  assert.equal(/LIC-MR-ADV-\d+YR/.test(chatSrc), false);
  assert.match(chatSrc, /LIC-MR-ADV-3Y/);
});

test('worker prompts distinguish MR Advanced from the generic ENT default', () => {
  for (const [label, src] of [['gchat', gchatSrc], ['worker', workerSrc]]) {
    assert.equal(/APs \(MR \+ CW\) — all use generic ENT license/.test(src), false, label);
    assert.equal(/All MR and CW APs → LIC-ENT/.test(src), false, label);
    assert.match(src, /MR APs explicitly requested as Advanced\/ADV → LIC-MR-ADV-1Y, LIC-MR-ADV-3Y, LIC-MR-ADV-5Y/, label);
    assert.match(src, /MR APs with no explicit Advanced request → LIC-ENT-1YR, LIC-ENT-3YR, LIC-ENT-5YR/, label);
  }
});

test('clauseRequestedTier maps MR + ADVANCED to A, not ENT', () => {
  assert.equal(clauseRequestedTier('advanced', 'MR44'), 'A');
  assert.equal(clauseRequestedTier('ADV', 'MR44'), 'A');
  assert.equal(clauseRequestedTier('enterprise', 'MR44'), 'ENT');
});

function skusOf(rows) {
  return JSON.parse(JSON.stringify((rows || []).map((row) => String(row.sku))));
}

function assertAdvancedMr(fn, label) {
  const skus = skusOf(fn('MR44', 'A'));
  assert.deepEqual(skus, ['LIC-MR-ADV-1Y', 'LIC-MR-ADV-3Y', 'LIC-MR-ADV-5Y'], label);
  const joined = skus.join(',');
  assert.equal(/LIC-ENT/.test(joined), false, label);
  assert.equal(/LIC-MR-ADV-\d+YR/.test(joined), false, label);
  assert.equal(/LIC-MR-UPGR/.test(joined), false, label);
  assert.equal(/E3N-MR-ADV/.test(joined), false, label);
}

test('both workers emit LIC-MR-ADV-1Y/3Y/5Y for MR44 + A', () => {
  assertAdvancedMr(gchatLicenses, 'worker-gchat');
  assertAdvancedMr(workerLicenses, 'worker');
});

test('default MR44 without advanced still emits LIC-ENT-*YR', () => {
  for (const [label, fn] of [['gchat', gchatLicenses], ['worker', workerLicenses]]) {
    assert.deepEqual(skusOf(fn('MR44', null)), ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR'], label);
  }
});

test('CW remains ENT and its editor does not offer unsupported Advanced', () => {
  assert.deepEqual(skusOf(gchatLicenses('CW9164I', 'A')), ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR']);
  const values = licenseTierOptionsForSku('CW9164I').map(({ value }) => value);
  assert.deepEqual(values, ['', 'enterprise', 'none']);
});

test('MR Advanced verifier rejects ENT and accepts LIC-MR-ADV', () => {
  const committed = [{ sku: 'MR44', qty: 3, tier: 'advanced' }];
  const wrong = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=3,3',
  }], committed, { requireLicensedOption: true });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.urls.length, 0);

  const correct = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-MR-ADV-3Y&qty=3,3',
  }], committed, { requireLicensedOption: true });
  assert.equal(correct.ok, true);
  assert.equal(correct.urls.length, 1);
});

test('ADV aliases emit MR Advanced and generic MR remains default', () => {
  for (const tier of ['ADV', 'advanced', 'AdVaNcEd']) {
    assertAdvancedMr((sku) => gchatLicenses(sku, tier), `gchat ${tier}`);
    assertAdvancedMr((sku) => workerLicenses(sku, tier), `worker ${tier}`);
  }
  const result = quoteTextFromEditorRows([{ sku: 'MR44', qty: 3 }], '');
  assert.equal(result.ok, true);
  assert.equal(/advanced/i.test(result.text), false);
});
