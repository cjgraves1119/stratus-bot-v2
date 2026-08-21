import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  licensePairReviewForRows,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetEnv = require('@babel/preset-env');
const presetReact = require('@babel/preset-react');
const editorPath = new URL('./src/sidebar/components/SkuQuantityEditor.jsx', import.meta.url);

const screenshotRows = () => [
  { sku: 'LIC-ENT-3YR', qty: 2 },
  { sku: 'MX67', qty: 1 },
  { sku: 'LIC-MX67-SEC-3YR', qty: 1, licenseIntent: 'paired' },
];

test('reported MX67 default-security shape marks one exact pair and leaves shared LIC-ENT standalone', () => {
  const review = licensePairReviewForRows(screenshotRows());
  assert.deepEqual(review[0], { kind: 'none' });
  assert.deepEqual(review[1], {
    kind: 'paired',
    role: 'hardware',
    hardwareQty: 1,
    licenseQty: 1,
    hardwareSkus: ['MX67'],
    licenseSkus: ['LIC-MX67-SEC-3YR'],
    tier: 'security',
  });
  assert.equal(review[2].kind, 'paired');
  assert.equal(review[2].role, 'license');
});

test('different ENT and SEC tiers remain unpaired instead of claiming coverage', () => {
  assert.deepEqual(licensePairReviewForRows([
    { sku: 'MX67', qty: 1, tier: 'enterprise' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]), [{ kind: 'none' }, { kind: 'none' }]);

  assert.deepEqual(licensePairReviewForRows([
    { sku: 'MX67', qty: 1, tier: 'security' },
    { sku: 'LIC-MX67-ENT-3YR', qty: 1 },
  ]), [{ kind: 'none' }, { kind: 'none' }]);
});

test('ambiguous shared and legacy-family licenses stay outside the conservative MX pairing contract', () => {
  assert.deepEqual(licensePairReviewForRows([
    { sku: 'MR44', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 1 },
    { sku: 'Z3', qty: 1 },
    { sku: 'LIC-Z3-ENT-3YR', qty: 1 },
  ]), [
    { kind: 'none' },
    { kind: 'none' },
    { kind: 'none' },
    { kind: 'none' },
  ]);
});

test('same-scope quantity mismatch is amber-review data on both rows', () => {
  const review = licensePairReviewForRows([
    { sku: 'MX67', qty: 2 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]);
  assert.equal(review[0].kind, 'mismatch');
  assert.equal(review[0].role, 'hardware');
  assert.equal(review[0].hardwareQty, 2);
  assert.equal(review[0].licenseQty, 1);
  assert.equal(review[1].kind, 'mismatch');
  assert.equal(review[1].role, 'license');
});

test('matching device license requires an explicit use choice and supports additive renewal', () => {
  const ambiguous = licensePairReviewForRows([
    { sku: 'MX75', qty: 1, tier: 'security' },
    { sku: 'LIC-MX75-SEC-3Y', qty: 1 },
  ]);
  assert.deepEqual(ambiguous.map(({ kind }) => kind), ['needs_review', 'needs_review']);
  assert.equal(quoteTextFromEditorRows([
    { sku: 'MX75', qty: 1, tier: 'security' },
    { sku: 'LIC-MX75-SEC-3Y', qty: 1 },
  ], '').ok, false);

  const standaloneRows = [
    { sku: 'MX75', qty: 1, tier: 'security' },
    { sku: 'LIC-MX75-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
  ];
  assert.deepEqual(licensePairReviewForRows(standaloneRows).map(({ kind }) => kind), ['standalone', 'standalone']);
  const prepared = quoteTextFromEditorRows(standaloneRows, '');
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.licenseIntents, [{ sku: 'LIC-MX75-SEC-3Y', qty: 1, intent: 'standalone' }]);
});

test('reviewed warm-spare HA recognizes exact 2:1 coverage without weakening standard mode', () => {
  const rows = [
    { sku: 'MX67', qty: 2 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1, licenseIntent: 'paired' },
  ];
  assert.deepEqual(licensePairReviewForRows(rows).map(({ kind }) => kind), ['mismatch', 'mismatch']);
  const reviewed = licensePairReviewForRows(rows, { allowHaLicenseRatio: true });
  assert.deepEqual(reviewed.map(({ kind }) => kind), ['paired', 'paired']);
  assert.equal(reviewed[0].warmSpare, true);
  assert.equal(reviewed[1].warmSpare, true);

  const invalid = licensePairReviewForRows([
    { sku: 'MX67', qty: 3 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ], { allowHaLicenseRatio: true });
  assert.deepEqual(invalid.map(({ kind }) => kind), ['mismatch', 'mismatch']);
});

test('duplicate rows aggregate only when one concrete license product matches the reviewed scope', () => {
  const review = licensePairReviewForRows([
    { sku: 'MX67', qty: 1 },
    { sku: 'MX67-HW', qty: 2 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1, licenseIntent: 'paired' },
    { sku: 'lic-mx67-sec-3yr', qty: 2, licenseIntent: 'paired' },
  ]);
  assert.deepEqual(review.map((entry) => entry.kind), ['paired', 'paired', 'paired', 'paired']);
  assert.equal(review[0].hardwareQty, 3);
  assert.equal(review[0].licenseQty, 3);

  const mixedTerms = licensePairReviewForRows([
    { sku: 'MX67', qty: 2 },
    { sku: 'LIC-MX67-SEC-1YR', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]);
  assert.deepEqual(mixedTerms.map((entry) => entry.kind), ['mismatch', 'mismatch', 'mismatch']);
});

test('pairing is recomputed from edits and never changes quote serialization', () => {
  const rows = screenshotRows();
  const before = quoteTextFromEditorRows(rows, '');
  assert.equal(before.ok, true, before.error);
  assert.equal(before.text, '2 LIC-ENT-3YR\n1 MX67\n1 LIC-MX67-SEC-3YR');
  assert.equal(licensePairReviewForRows(rows)[1].kind, 'paired');

  const quantityEdit = rows.map((row, index) => (index === 1 ? { ...row, qty: 2 } : row));
  assert.equal(licensePairReviewForRows(quantityEdit)[1].kind, 'mismatch');
  assert.equal(quoteTextFromEditorRows(quantityEdit, '').text, '2 LIC-ENT-3YR\n2 MX67\n1 LIC-MX67-SEC-3YR');

  const tierEdit = rows.map((row, index) => (index === 1 ? { ...row, tier: 'enterprise' } : row));
  assert.deepEqual(licensePairReviewForRows(tierEdit), [{ kind: 'none' }, { kind: 'none' }, { kind: 'none' }]);
});

test('editor renders explicit pairing and mismatch explanations and still parses as JSX', () => {
  const source = readFileSync(editorPath, 'utf8');
  assert.match(source, /licensePairReviewForRows\(values, \{ allowHaLicenseRatio \}\)/);
  assert.match(source, /License supplied by paired/);
  assert.match(source, /counted once, not an extra license/);
  assert.match(source, /Warm-spare license supplied/);
  assert.match(source, /counted once for this HA pair/);
  assert.match(source, /License quantity mismatch/);
  assert.match(source, /Move SKU row .* up/);
  assert.match(source, /Standalone renewal \/ additional license/);
  assert.doesNotThrow(() => babel.transformSync(source, {
    filename: 'SkuQuantityEditor.jsx',
    presets: [[presetEnv, { targets: { chrome: '120' } }], [presetReact, { runtime: 'automatic' }]],
    babelrc: false,
    configFile: false,
  }));
});
