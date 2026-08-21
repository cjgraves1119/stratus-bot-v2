// Regression coverage for parseMessage's occurrence handling.
//
// The hardware scanner used to dedupe by SKU text, then remove a shorter SKU
// whenever any longer SKU anywhere in the request contained it. That silently
// dropped separately requested rows such as MX64 + MX64W and every repeated
// occurrence of the same model. Mixed-cart explicit LIC-* rows had the same
// first-occurrence-only bug. These tests load the real Worker parser and quote
// builder, with no parser/build mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function extractRealFunctions() {
  const escPath = (rel) => path.join(__dirname, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
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
  src += '\nmodule.exports = { parseMessage, buildQuoteResponse };\n';
  const tmpPath = path.join(__dirname, `.tmp-parser-occurrences-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const mod = extractRealFunctions();

function parsedRows(text) {
  const parsed = mod.parseMessage(text);
  assert.ok(parsed, `request did not parse: ${text}`);
  return parsed.items || [];
}

function quote(text) {
  const parsed = mod.parseMessage(text);
  assert.ok(parsed, `request did not parse: ${text}`);
  return { parsed, result: mod.buildQuoteResponse(parsed) };
}

function urlsIn(result) {
  return [...String(result?.message || '').matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g)]
    .map((match) => match[0]);
}

function cartOf(rawUrl) {
  const url = new URL(rawUrl);
  const skus = String(url.searchParams.get('item') || '').split(',').filter(Boolean);
  const qtys = String(url.searchParams.get('qty') || '').split(',').map(Number);
  const cart = new Map();
  for (const [index, sku] of skus.entries()) {
    const normalized = sku.toUpperCase();
    cart.set(normalized, (cart.get(normalized) || 0) + (qtys[index] || 0));
  }
  return cart;
}

test('separately mentioned substring-related variants all survive parsing', () => {
  for (const { left, right } of [
    { left: 'MX64', right: 'MX64W' },
    { left: 'MR36', right: 'MR36H' },
    { left: 'Z4', right: 'Z4C' },
    { left: 'MG51', right: 'MG51E' },
  ]) {
    const rows = parsedRows(`quote 2 ${left} hardware only and 3 ${right} hardware only`);
    assert.deepEqual(
      rows.map((row) => ({ sku: row.baseSku, qty: row.qty })),
      [{ sku: left, qty: 2 }, { sku: right, qty: 3 }],
      `${left} was incorrectly treated as an overlapping substring of ${right}`,
    );
  }
});

test('current paired variants both reach the real quote URL builder', () => {
  for (const { text, expected } of [
    {
      text: 'quote 2 MR36 hardware only and 3 MR36H hardware only',
      expected: [['MR36-HW', 2], ['MR36H-HW', 3]],
    },
    {
      text: 'quote 2 Z4 hardware only and 3 Z4C hardware only',
      expected: [['Z4-HW', 2], ['Z4C-HW', 3]],
    },
  ]) {
    const { result } = quote(text);
    assert.notEqual(result.compositionBlocked, true, result.message);
    const urls = urlsIn(result);
    assert.ok(urls.length > 0, `no quote URL for ${text}`);
    const cart = cartOf(urls[0]);
    for (const [sku, qty] of expected) assert.equal(cart.get(sku), qty, `${sku} missing/wrong`);
  }
});

test('overlapping MS150 scanner patterns keep only the longest source interval', () => {
  const { parsed, result } = quote('quote 2 MS150-24P-4X hardware only');
  assert.deepEqual(
    parsed.items.map((row) => ({ sku: row.baseSku, qty: row.qty })),
    [{ sku: 'MS150-24P-4X', qty: 2 }],
    'the generic MS scanner must not add a phantom MS150-24P row',
  );
  assert.notEqual(result.compositionBlocked, true, result.message);
  const urls = urlsIn(result);
  assert.ok(urls.length > 0);
  assert.equal(cartOf(urls[0]).get('MS150-24P-4X'), 2);
});

test('paired EOL MG variants both reach one hardware-refresh cart', () => {
  const { result } = quote('quote 2 MG51 hardware only and 3 MG51E hardware only');
  assert.notEqual(result.compositionBlocked, true, result.message);
  const refreshCart = urlsIn(result)
    .map(cartOf)
    .find((cart) => cart.has('MG52-HW') || cart.has('MG52E-HW'));
  assert.ok(refreshCart, 'no MG52/MG52E refresh cart was built');
  assert.equal(refreshCart.get('MG52-HW'), 2);
  assert.equal(refreshCart.get('MG52E-HW'), 3);
});

test('repeated hardware occurrences retain row-local tiers before URL aggregation', () => {
  const { parsed, result } = quote(
    'quote 1 MX67 security and 2 MX67 enterprise',
  );
  assert.deepEqual(
    parsed.items.map((row) => ({ sku: row.baseSku, qty: row.qty, tier: row.requestedTier })),
    [
      { sku: 'MX67', qty: 1, tier: 'SEC' },
      { sku: 'MX67', qty: 2, tier: 'ENT' },
    ],
  );
  assert.notEqual(result.compositionBlocked, true, result.message);
  const urls = urlsIn(result);
  assert.equal(urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(urls[index]);
    assert.equal(cart.get('MX67'), 3);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 2);
  }
});

test('repeated identical hardware quantities sum instead of keeping only the first mention', () => {
  const { parsed, result } = quote('quote 1 MX67 security and 2 MX67 security');
  assert.deepEqual(parsed.items.map((row) => row.qty), [1, 2]);
  assert.notEqual(result.compositionBlocked, true, result.message);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(urlsIn(result)[index]);
    assert.equal(cart.get('MX67'), 3);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 3);
  }
});

test('paired EOL rows keep independent quantities and tiers through refresh', () => {
  const { parsed, result } = quote('quote 1 MX64 enterprise and 2 MX64W security');
  assert.deepEqual(
    parsed.items.map((row) => ({ sku: row.baseSku, qty: row.qty, tier: row.requestedTier })),
    [
      { sku: 'MX64', qty: 1, tier: 'ENT' },
      { sku: 'MX64W', qty: 2, tier: 'SEC' },
    ],
  );
  assert.notEqual(result.compositionBlocked, true, result.message);
  const refresh = urlsIn(result).filter((url) => cartOf(url).has('MX67'));
  assert.equal(refresh.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(refresh[index]);
    assert.equal(cart.get('MX67'), 1);
    assert.equal(cart.get('MX67W'), 2);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX67W-SEC-${term}YR`), 2);
  }
});

test('repeated EOL hardware and explicit companions preserve the reviewed total exactly once', () => {
  const { parsed, result } = quote(
    'quote 1 MX64 enterprise and 1 MX64 enterprise and '
      + '1 LIC-MX64-ENT-3YR and 1 LIC-MX64-ENT-3YR',
  );
  assert.equal(parsed.items.filter((row) => row.baseSku === 'MX64').length, 2);
  assert.equal(parsed.items.filter((row) => row.baseSku === 'LIC-MX64-ENT-3YR').length, 2);
  assert.notEqual(result.compositionBlocked, true, result.message);

  const urls = urlsIn(result);
  const asIs = urls.filter((url) => [...cartOf(url).keys()].some((sku) => /^LIC-MX64-ENT-/.test(sku)));
  const refresh = urls.filter((url) => cartOf(url).has('MX67'));
  assert.equal(asIs.length, 3);
  assert.equal(refresh.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const oldCart = cartOf(asIs[index]);
    assert.equal(oldCart.get(`LIC-MX64-ENT-${term}YR`), 2);

    const newCart = cartOf(refresh[index]);
    assert.equal(newCart.get('MX67'), 2);
    assert.equal(newCart.get(`LIC-MX67-ENT-${term}YR`), 2);
    assert.equal(newCart.has(`LIC-MX64-ENT-${term}YR`), false);
  }
});

test('repeated-row under- and over-sized explicit totals fail closed', () => {
  for (const text of [
    'quote 1 MX64 enterprise and 1 MX64 enterprise and 1 LIC-MX64-ENT-3YR',
    'quote 1 MX64 enterprise and 1 MX64 enterprise and '
      + '1 LIC-MX64-ENT-3YR and 1 LIC-MX64-ENT-3YR and 1 LIC-MX64-ENT-3YR',
  ]) {
    const { result } = quote(text);
    assert.equal(result.compositionBlocked, true, text);
    assert.match(result.message, /does not cover the matching hardware quantity/);
    assert.equal(urlsIn(result).length, 0);
    assert.equal(result.needsLlm, false, 'quantity mismatches must not fall through to AI');
  }
});
