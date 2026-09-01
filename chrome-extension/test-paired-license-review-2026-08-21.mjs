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

test('different ENT and SEC tiers remain unpaired and force review on the license', () => {
  assert.deepEqual(licensePairReviewForRows([
    { sku: 'MX67', qty: 1, tier: 'enterprise' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]).map(({ kind }) => kind), ['none', 'mismatch']);

  assert.deepEqual(licensePairReviewForRows([
    { sku: 'MX67', qty: 1, tier: 'security' },
    { sku: 'LIC-MX67-ENT-3YR', qty: 1 },
  ]).map(({ kind }) => kind), ['none', 'mismatch']);
});

test('shared AP licenses review aggregate MR/CW916x coverage while legacy Z stays out', () => {
  const enterprise = licensePairReviewForRows([
    { sku: 'MR44', qty: 2 },
    { sku: 'CW9164I', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ]);
  assert.deepEqual(enterprise.map(({ kind }) => kind), ['needs_review', 'needs_review', 'needs_review']);
  assert.equal(enterprise[2].hardwareQty, 3);

  const advanced = licensePairReviewForRows([
    { sku: 'CW9164I', qty: 1, tier: 'advanced' },
    { sku: 'LIC-MR-ADV-3Y', qty: 1, licenseIntent: 'paired' },
  ]);
  assert.deepEqual(advanced.map(({ kind }) => kind), ['paired', 'paired']);

  assert.deepEqual(licensePairReviewForRows([
    { sku: 'CW9172I', qty: 1 },
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

test('pasted AP cart requires license-use review and rejects stale paired intent after a tier change', () => {
  const rows = [
    { sku: 'CW9164I', qty: 1 },
    { sku: 'LIC-ENT-5YR', qty: 1 },
  ];
  const undecided = quoteTextFromEditorRows(rows, '');
  assert.equal(undecided.ok, false);
  assert.match(undecided.error, /device-associated or a standalone renewal/i);

  const paired = quoteTextFromEditorRows([
    rows[0],
    { ...rows[1], licenseIntent: 'paired' },
  ], '');
  assert.equal(paired.ok, true, paired.error);
  assert.deepEqual(paired.licenseIntents, [{ sku: 'LIC-ENT-5YR', qty: 1, intent: 'paired' }]);

  const stale = quoteTextFromEditorRows([
    { ...rows[0], tier: 'advanced' },
    { ...rows[1], licenseIntent: 'paired' },
  ], '');
  assert.equal(stale.ok, false);
  assert.match(stale.error, /does not match/i);

  const tierMismatch = quoteTextFromEditorRows([
    { ...rows[0], tier: 'advanced' },
    rows[1],
  ], '');
  assert.equal(tierMismatch.ok, false, 'tier mismatch without a use choice must fail closed');
  assert.match(tierMismatch.error, /does not match/i);

  const intentionalStandalone = quoteTextFromEditorRows([
    { ...rows[0], tier: 'advanced' },
    { ...rows[1], licenseIntent: 'standalone' },
  ], '');
  assert.equal(intentionalStandalone.ok, true, intentionalStandalone.error);
  assert.deepEqual(intentionalStandalone.licenseIntents, [
    { sku: 'LIC-ENT-5YR', qty: 1, intent: 'standalone' },
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

  // The key customer scenario: two new appliances each derive a license, and
  // one existing appliance is renewed with the explicit line. The standalone
  // choice must be offered even though its quantity differs from hardware.
  const mixedQuantity = [
    { sku: 'MX75', qty: 2, tier: 'security' },
    { sku: 'LIC-MX75-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
  ];
  assert.deepEqual(licensePairReviewForRows(mixedQuantity).map(({ kind }) => kind), ['standalone', 'standalone']);
  assert.equal(quoteTextFromEditorRows(mixedQuantity, '').ok, true);
});

test('Catalyst 9300L hardware and its explicit Standard licence require one counted-once choice', () => {
  const rows = [
    { sku: 'C9300L-48P-4X-M', qty: 2 },
    { sku: 'LIC-C9300-48E-3Y', qty: 2 },
    { sku: 'C9300L-STAK-KIT2-M', qty: 2 },
  ];
  const review = licensePairReviewForRows(rows);
  assert.deepEqual(review.map(({ kind }) => kind), ['needs_review', 'needs_review', 'none']);
  assert.equal(review[0].tier, 'standard');
  assert.equal(quoteTextFromEditorRows(rows, '').ok, false, 'generation waits for the pairing choice');

  const paired = rows.map((row, index) => (index === 1 ? { ...row, licenseIntent: 'paired' } : row));
  assert.deepEqual(licensePairReviewForRows(paired).map(({ kind }) => kind), ['paired', 'paired', 'none']);
  const prepared = quoteTextFromEditorRows(paired, '');
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.licenseIntents, [
    { sku: 'LIC-C9300-48E-3Y', qty: 2, intent: 'paired' },
  ]);

  const wrongQuantity = rows.map((row, index) => (index === 1 ? { ...row, qty: 1 } : row));
  assert.deepEqual(licensePairReviewForRows(wrongQuantity).map(({ kind }) => kind), ['mismatch', 'mismatch', 'none']);
  assert.equal(quoteTextFromEditorRows(wrongQuantity, '').ok, false, 'quantity mismatch requires correction or standalone intent');
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
  assert.equal(quoteTextFromEditorRows(quantityEdit, '').ok, false, 'a changed hardware quantity must reopen license-use review');
  const intentionalExtra = quantityEdit.map((row, index) => (
    index === 2 ? { ...row, licenseIntent: 'standalone' } : row
  ));
  assert.equal(
    quoteTextFromEditorRows(intentionalExtra, '').text,
    '2 LIC-ENT-3YR\n2 MX67\n1 LIC-MX67-SEC-3YR',
  );

  const tierEdit = rows.map((row, index) => (index === 1 ? { ...row, tier: 'enterprise' } : row));
  assert.deepEqual(
    licensePairReviewForRows(tierEdit).map(({ kind }) => kind),
    ['none', 'none', 'mismatch'],
  );
  assert.equal(quoteTextFromEditorRows(tierEdit, '').ok, false, 'tier edits must reopen license-use review');
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
  assert.match(source, /needsReview \|\| paired \|\| standalone \|\| mismatch/);
  assert.doesNotThrow(() => babel.transformSync(source, {
    filename: 'SkuQuantityEditor.jsx',
    presets: [[presetEnv, { targets: { chrome: '120' } }], [presetReact, { runtime: 'automatic' }]],
    babelrc: false,
    configFile: false,
  }));
});
