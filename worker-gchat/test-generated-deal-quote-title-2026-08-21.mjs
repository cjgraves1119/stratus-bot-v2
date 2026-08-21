import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');

function grab(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const paramsStart = source.indexOf('(', start);
  let parenDepth = 0;
  let bodyStart = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === '(') parenDepth += 1;
    if (source[index] === ')') {
      parenDepth -= 1;
      if (parenDepth === 0) {
        bodyStart = source.indexOf('{', index);
        break;
      }
    }
  }
  assert.ok(bodyStart >= 0, `body of ${name} not found`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

const factory = new Function([
  grab('deriveQuoteTermLabel'),
  grab('isGeneratedTitleLicenseSku'),
  grab('buildGeneratedDealQuoteTitle'),
  'return buildGeneratedDealQuoteTitle;',
].join('\n'));
const buildTitle = factory();

test('license-only cart gets a useful renewal title with reviewed term and date', () => {
  assert.equal(buildTitle({
    accountName: 'Palonix',
    resolvedProducts: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    closingDate: '2026-08-31',
  }), 'Palonix - License Renewal - 3-Year - 2026-08-31');
});

test('mixed and hardware carts summarize only hardware with quantities', () => {
  assert.equal(buildTitle({
    accountName: 'Acme',
    resolvedProducts: [
      { sku: 'MX67', qty: 2 },
      { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
      { sku: 'MR46', qty: 1 },
      { sku: 'LIC-ENT-3YR', qty: 1 },
    ],
    closingDate: '2026-08-31',
  }), 'Acme - 2x MX67 + MR46 - 3-Year - 2026-08-31');
});

test('more than two hardware rows stay bounded and report the remainder', () => {
  const title = buildTitle({
    accountName: 'Acme',
    resolvedProducts: [
      { sku: 'MX67', qty: 1 }, { sku: 'MR46', qty: 1 },
      { sku: 'MS130-24P', qty: 1 }, { sku: 'CW9164I', qty: 3 },
    ],
    closingDate: '2026-08-31',
  });
  assert.equal(title, 'Acme - MX67 + MR46 + 2 more - 2026-08-31');
});

test('non-LIC subscription families are also recognized as license-only renewals', () => {
  assert.equal(buildTitle({
    accountName: 'Acme',
    resolvedProducts: [{ sku: 'DUO-ESSENTIALS-3YR', qty: 20 }],
    closingDate: '2026-08-31',
  }), 'Acme - License Renewal - 3-Year - 2026-08-31');
});

test('blank account and mixed terms never produce dangling separators or a false term', () => {
  const title = buildTitle({
    accountName: '   ',
    resolvedProducts: [
      { sku: 'LIC-ENT-1YR', qty: 2 },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    closingDate: '2026-08-31',
  });
  assert.equal(title, 'License Renewal - 2026-08-31');
  assert.doesNotMatch(title, /^\s*-|-\s*$/);
});

test('long account names are truncated first while product, term, and reviewed date survive', () => {
  const title = buildTitle({
    accountName: 'A'.repeat(220),
    resolvedProducts: [{ sku: 'MX67', qty: 1 }, { sku: 'LIC-MX67-SEC-3YR', qty: 1 }],
    closingDate: '2026-08-31',
  });
  assert.ok(title.length <= 120, title);
  assert.match(title, /MX67 - 3-Year - 2026-08-31$/);
});

test('missing reviewed date never invents the current date', () => {
  const title = buildTitle({
    accountName: 'Acme',
    resolvedProducts: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
    closingDate: '',
  });
  assert.equal(title, 'Acme - License Renewal - 3-Year');
  assert.doesNotMatch(title, /2026-08-21/);
});

test('compound create uses the same generated fallback for Deal and Quote', () => {
  assert.match(source, /const generatedRecordTitle = buildGeneratedDealQuoteTitle\(/);
  assert.match(source, /Deal_Name:\s*deal_name \|\| existingDealData\?\.Deal_Name \|\| generatedRecordTitle/);
  assert.match(source, /let quoteSubject = deal_name \|\| existingDealData\?\.Deal_Name \|\| generatedRecordTitle/);
});
