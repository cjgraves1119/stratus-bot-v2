import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  canonicalizeSpokenSku,
  collapseSpokenPluralRows,
  dropSpokenPluralSuggestionRows,
  isRealSSuffixSku,
  looksLikeEnglishPluralSku,
} from './src/lib/nl-plural-sku.mjs';

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
  const tmpPath = path.join(__dirname, `.tmp-plural-${workerDirName}-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const EXACT = 'Quote me 2 MR46s: - 1 MX67 - 1 MS130-24P - 2 MX450s';
const WITH_REAL_S = `${EXACT} and 1 C9300-24S-M`;
const EXPECTED = [
  { baseSku: 'MR46', qty: 2 },
  { baseSku: 'MX67', qty: 1 },
  { baseSku: 'MS130-24P', qty: 1 },
  { baseSku: 'MX450', qty: 2 },
];

function compactItems(items) {
  return (Array.isArray(items) ? items : []).map((item) => ({
    baseSku: String(item.baseSku || item.sku || '').toUpperCase(),
    qty: Number(item.qty) || 1,
  }));
}

test('spoken plural tokens collapse; Catalyst S-suffix SKUs are kept', () => {
  assert.equal(looksLikeEnglishPluralSku('MR46S'), true);
  assert.equal(looksLikeEnglishPluralSku('MX450S'), true);
  assert.equal(looksLikeEnglishPluralSku('C9300-24S-M'), false);
  assert.equal(isRealSSuffixSku('C9300-24S-M'), true);
  assert.equal(canonicalizeSpokenSku('MR46S'), 'MR46');
  assert.equal(canonicalizeSpokenSku('MX450S'), 'MX450');
  assert.equal(canonicalizeSpokenSku('C9300-24S-M'), 'C9300-24S-M');
  assert.equal(canonicalizeSpokenSku('C9300-24S'), 'C9300-24S');
});

test('exact spoken list yields MR46 x2, MX67 x1, MS130-24P x1, MX450 x2 — no *S leftovers', () => {
  const collapsed = collapseSpokenPluralRows([
    { baseSku: 'MR46S', qty: 2 },
    { baseSku: 'MR46', qty: 2 },
    { baseSku: 'MX67', qty: 1 },
    { baseSku: 'MS130-24P', qty: 1 },
    { baseSku: 'MX450S', qty: 2 },
    { baseSku: 'C9300-24S-M', qty: 1 },
  ]);
  assert.deepEqual(compactItems(collapsed), [
    ...EXPECTED,
    { baseSku: 'C9300-24S-M', qty: 1 },
  ]);
  assert.ok(!collapsed.some((row) => /^(MR46S|MX450S)$/.test(row.baseSku)));
});

test('unresolved spoken-plural suggestion rows are dropped when the real model is present', () => {
  const rows = dropSpokenPluralSuggestionRows([
    { sku: 'MR46', qty: 2, unresolved: false },
    { sku: 'MR46S', qty: 2, unresolved: true },
    { sku: 'C9300-24S-M', qty: 1, unresolved: false },
  ]);
  assert.deepEqual(rows.map((row) => row.sku), ['MR46', 'C9300-24S-M']);
});

for (const workerName of ['worker', 'worker-gchat']) {
  test(`${workerName} parseMessage: "${EXACT}"`, () => {
    const worker = loadInstalledWorker(workerName, ['parseMessage']);
    const parsed = worker.parseMessage(EXACT);
    const items = collapseSpokenPluralRows(compactItems(parsed?.items));
    assert.deepEqual(items, EXPECTED);
    assert.ok(!items.some((item) => item.baseSku === 'MR46S' || item.baseSku === 'MX450S'));
  });
}

test('real S-suffix SKU C9300-24S-M is kept next to spoken plurals', () => {
  const gchat = loadInstalledWorker('worker-gchat', ['parseMessage']);
  const parsed = gchat.parseMessage(WITH_REAL_S);
  const items = collapseSpokenPluralRows(compactItems(parsed?.items));
  assert.deepEqual(items, [
    ...EXPECTED,
    { baseSku: 'C9300-24S-M', qty: 1 },
  ]);
  const standalone = collapseSpokenPluralRows([{ baseSku: 'C9300-24S-M', qty: 1 }]);
  assert.deepEqual(compactItems(standalone), [{ baseSku: 'C9300-24S-M', qty: 1 }]);
});
