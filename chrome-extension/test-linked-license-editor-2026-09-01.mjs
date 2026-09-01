import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyLinkedQuoteRowPatch,
  removeLinkedQuoteRow,
  groupQuoteEditorRows,
  licenseTierOptionsForSku,
  licensePairReviewForRows,
  normalizeSkuEditorRows,
  oneshotSkusFromCommittedRows,
  oneshotSkusWithReviewedLicenseIntents,
  quoteTextFromEditorRows,
  retainPairedLicenseProjections,
  rowsForLinkedQuoteRebuild,
  withDefaultPairedLicenseIntents,
  withPairedLicenseProjections,
} from './src/sidebar/components/sku-editor-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const readSource = (relative) => fs.readFileSync(path.join(HERE, relative), 'utf8');

const switchRows = () => ([
  { sku: 'MS130-24P', qty: 2 },
  { sku: 'MS130-24', qty: 4 },
  { sku: 'LIC-MS130-24-3Y', qty: 6 },
]);

test('compatible switch variants default to one paired license scope', () => {
  const rows = withDefaultPairedLicenseIntents(switchRows());
  assert.equal(rows[2].licenseIntent, 'paired');
  const review = licensePairReviewForRows(rows);
  assert.deepEqual(review.map(({ kind }) => kind), ['paired', 'paired', 'paired']);
  assert.equal(review[2].hardwareQty, 6);
  assert.deepEqual(review[2].hardwareContributions, [
    { sku: 'MS130-24P', qty: 2 },
    { sku: 'MS130-24', qty: 4 },
  ]);
});

test('compact MS130 variants share the existing CMPT license relationship', () => {
  for (const [tier, licenseSku] of [
    ['', 'LIC-MS130-CMPT-3Y'],
    ['advanced', 'LIC-MS130-CMPTA-3Y'],
  ]) {
    const rows = withDefaultPairedLicenseIntents([
      { sku: 'MS130-8P', qty: 2, ...(tier ? { tier } : {}) },
      { sku: 'MS130-12P', qty: 4, ...(tier ? { tier } : {}) },
      { sku: licenseSku, qty: 6 },
    ]);
    assert.equal(rows[2].licenseIntent, 'paired', licenseSku);
    assert.deepEqual(licensePairReviewForRows(rows).map(({ kind }) => kind), ['paired', 'paired', 'paired']);
    const changed = applyLinkedQuoteRowPatch(rows, 0, { qty: '3' });
    assert.equal(changed[2].qty, 7);
  }
});

test('MS130R and C9300X use their existing shared catalog license scopes', () => {
  const compact = withDefaultPairedLicenseIntents([
    { sku: 'MS130R-8P', qty: 1 },
    { sku: 'MS130-12P', qty: 2 },
    { sku: 'LIC-MS130-CMPT-3Y', qty: 3 },
  ]);
  assert.deepEqual(licensePairReviewForRows(compact).map(({ kind }) => kind), ['paired', 'paired', 'paired']);

  const catalyst = withDefaultPairedLicenseIntents([
    { sku: 'C9300X-12Y-M', qty: 2 },
    { sku: 'C9300L-24P-4X-M', qty: 1 },
    { sku: 'LIC-C9300-24E-3Y', qty: 3 },
  ]);
  assert.deepEqual(licensePairReviewForRows(catalyst).map(({ kind }) => kind), ['paired', 'paired', 'paired']);
});

test('Catalyst 9200L Essentials and Advanced licenses participate in the same linked editor contract', () => {
  for (const [licenseSku, tier] of [
    ['LIC-C9200L-24E-3Y', 'standard'],
    ['LIC-C9200L-24A-3Y', 'advanced'],
  ]) {
    const rows = withDefaultPairedLicenseIntents([
      { sku: 'C9200L-24P-4G-M', qty: 2, ...(tier === 'advanced' ? { tier } : {}) },
      { sku: licenseSku, qty: 2 },
    ]);
    assert.equal(rows[1].licenseIntent, 'paired', licenseSku);
    assert.deepEqual(licensePairReviewForRows(rows).map(({ kind }) => kind), ['paired', 'paired']);
  }
});

test('editing paired hardware synchronizes the existing license quantity without aggregating quote output', () => {
  const rows = withDefaultPairedLicenseIntents(switchRows());
  const changed = applyLinkedQuoteRowPatch(rows, 0, { qty: '3' });
  assert.equal(changed[0].qty, '3');
  assert.equal(changed[2].qty, 7);

  const rebuild = rowsForLinkedQuoteRebuild(changed);
  assert.deepEqual(rebuild.map(({ sku, qty }) => ({ sku, qty })), [
    { sku: 'MS130-24P', qty: '3' },
    { sku: 'MS130-24', qty: 4 },
  ], 'the worker remains responsible for deriving and aggregating the final license line');
});

test('temporarily clearing a hardware quantity does not delete its paired license while typing', () => {
  const rows = withDefaultPairedLicenseIntents(switchRows());
  const incomplete = applyLinkedQuoteRowPatch(rows, 0, { qty: '' });
  assert.equal(incomplete[2].qty, 6);
  assert.equal(normalizeSkuEditorRows(incomplete).ok, false);
});

test('standalone renewal decouples quantity and is retained exactly once for rebuild', () => {
  const paired = withDefaultPairedLicenseIntents(switchRows());
  const standalone = applyLinkedQuoteRowPatch(paired, 2, { licenseIntent: 'standalone' });
  const changed = applyLinkedQuoteRowPatch(standalone, 0, { qty: '5' });
  assert.equal(changed[2].qty, 6, 'standalone quantity must not track hardware');
  assert.deepEqual(rowsForLinkedQuoteRebuild(changed).map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'MS130-24P', qty: '5', licenseIntent: undefined },
    { sku: 'MS130-24', qty: 4, licenseIntent: undefined },
    { sku: 'LIC-MS130-24-3Y', qty: 6, licenseIntent: 'standalone' },
  ]);
});

test('paired coverage and an additive standalone copy of the same SKU remain separate', () => {
  const rows = withDefaultPairedLicenseIntents([
    { sku: 'MX95', qty: 2 },
    { sku: 'LIC-MX95-SEC-3Y', qty: 2, licenseIntent: 'paired' },
    { sku: 'LIC-MX95-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
  ]);
  assert.deepEqual(licensePairReviewForRows(rows).map(({ kind }) => kind), ['paired', 'paired', 'standalone']);
  const changed = applyLinkedQuoteRowPatch(rows, 0, { qty: '3' });
  assert.equal(changed[1].qty, 3);
  assert.equal(changed[2].qty, 1);
  assert.deepEqual(rowsForLinkedQuoteRebuild(changed).map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'MX95', qty: '3', licenseIntent: undefined },
    { sku: 'LIC-MX95-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
  ]);
});

test('hardware-only removes only its paired contribution', () => {
  const paired = withDefaultPairedLicenseIntents(switchRows());
  const oneBare = applyLinkedQuoteRowPatch(paired, 0, { tier: 'none' });
  assert.equal(oneBare[2].qty, 4);
  assert.equal(oneBare[0].tier, 'none');
  assert.equal(oneBare[1].tier || '', '');

  const allBare = applyLinkedQuoteRowPatch(oneBare, 1, { tier: 'none' });
  assert.equal(allBare.find((row) => row.sku === 'LIC-MS130-24-3Y')?.pairedSuspended, true);

  const restored = applyLinkedQuoteRowPatch(oneBare, 0, { tier: '' });
  assert.equal(restored.find((row) => row.sku === 'LIC-MS130-24-3Y')?.qty, 6);
});

test('removing linked hardware updates or removes only its paired projection', () => {
  const paired = withDefaultPairedLicenseIntents(switchRows());
  const oneRemoved = removeLinkedQuoteRow(paired, 0);
  assert.equal(oneRemoved.find((row) => row.sku === 'LIC-MS130-24-3Y')?.qty, 4);
  const allHardwareRemoved = removeLinkedQuoteRow(oneRemoved, 0);
  assert.equal(allHardwareRemoved.some((row) => row.sku === 'LIC-MS130-24-3Y'), false);
});

test('tier changes synchronize within a family but preserve other families and legacy Z3', () => {
  const rows = [
    { sku: 'MX95', qty: 1 },
    { sku: 'Z4-HW', qty: 1 },
    { sku: 'Z3-HW', qty: 1 },
    { sku: 'MR44', qty: 1 },
    { sku: 'CW9172I', qty: 1 },
    { sku: 'MS130-24P', qty: 1 },
    { sku: 'MS130-48P', qty: 1 },
  ];
  const appliances = applyLinkedQuoteRowPatch(rows, 0, { tier: 'enterprise' });
  assert.equal(appliances[0].tier, 'enterprise');
  assert.equal(appliances[1].tier, 'enterprise');
  assert.equal(appliances[2].tier, undefined, 'legacy Z3 is not compatible with the MX/Z4 policy family');

  const aps = applyLinkedQuoteRowPatch(appliances, 3, { tier: 'advanced' });
  assert.equal(aps[3].tier, 'advanced');
  assert.equal(aps[4].tier, 'advanced');
  assert.equal(aps[0].tier, 'enterprise');

  const switches = applyLinkedQuoteRowPatch(aps, 5, { tier: 'advanced' });
  assert.equal(switches[5].tier, 'advanced');
  assert.equal(switches[6].tier, 'advanced');
});

test('mixed tiers inside one compatible family fail closed while different families remain independent', () => {
  const invalid = normalizeSkuEditorRows([
    { sku: 'MX95', qty: 1, tier: 'security' },
    { sku: 'Z4-HW', qty: 1, tier: 'enterprise' },
  ]);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.errors[0].code, 'mixed_family_license_tier');

  const valid = normalizeSkuEditorRows([
    { sku: 'MX95', qty: 1, tier: 'security' },
    { sku: 'MR44', qty: 1, tier: 'advanced' },
  ]);
  assert.equal(valid.ok, true, valid.error);

  // The gate governs hardware dropdowns only. A standalone renewal at another
  // edition is an additive line for devices already in the field and stays
  // publishable with its intent (the committed extension and Worker pipeline
  // contracts: Advanced APs beside a standalone ENT renewal, MX Enterprise
  // beside a standalone SEC renewal). Legacy Z3 is outside the policy entirely.
  for (const rows of [
    [
      { sku: 'MX95', qty: 1, tier: 'security' },
      { sku: 'LIC-MX95-ENT-3Y', qty: 1, licenseIntent: 'standalone' },
    ],
    [
      { sku: 'MR44', qty: 1, tier: 'advanced' },
      { sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'standalone' },
    ],
    [
      { sku: 'MS130-24P', qty: 1, tier: 'advanced' },
      { sku: 'LIC-MS130-24-3Y', qty: 1, licenseIntent: 'standalone' },
    ],
    [
      { sku: 'MX95', qty: 1, tier: 'security' },
      { sku: 'LIC-Z3-ENT-3YR', qty: 1, licenseIntent: 'standalone' },
    ],
  ]) {
    const additive = normalizeSkuEditorRows(rows);
    assert.equal(additive.ok, true, additive.error);
    assert.equal(additive.rows[1].licenseIntent, 'standalone');
  }

  // Two appliances on different editions still fail closed even when a
  // standalone renewal sits beside them.
  const mixedHardware = normalizeSkuEditorRows([
    { sku: 'MX95', qty: 1, tier: 'security' },
    { sku: 'MX67', qty: 1, tier: 'enterprise' },
    { sku: 'LIC-MX95-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
  ]);
  assert.equal(mixedHardware.ok, false);
  assert.equal(mixedHardware.errors[0].code, 'mixed_family_license_tier');
});

test('Z tier controls match the catalog contract', () => {
  assert.deepEqual(licenseTierOptionsForSku('Z3').map(({ value }) => value), ['', 'enterprise', 'none']);
  assert.deepEqual(licenseTierOptionsForSku('Z4-HW').map(({ value }) => value), ['', 'enterprise', 'security', 'none']);
});

test('presentation groups paired licenses with their product type without mutating row order', () => {
  const rows = withDefaultPairedLicenseIntents([
    ...switchRows(),
    { sku: 'CW9172I', qty: 3 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
    { sku: 'MA-SFP-10GB-SR', qty: 2 },
  ]);
  const groups = groupQuoteEditorRows(rows, licensePairReviewForRows(rows));
  assert.deepEqual(groups.map(({ key }) => key), ['access-points', 'switches', 'accessories']);
  assert.deepEqual(groups.find(({ key }) => key === 'switches').entries.map(({ index }) => index), [0, 1, 2]);
  assert.deepEqual(rows.map(({ sku }) => sku), [
    'MS130-24P', 'MS130-24', 'LIC-MS130-24-3Y', 'CW9172I', 'LIC-ENT-3YR', 'MA-SFP-10GB-SR',
  ]);
});

test('group counts name products and paired projections separately', () => {
  const rows = withDefaultPairedLicenseIntents([
    ...switchRows(),
    { sku: 'LIC-MS130-24-3Y', qty: 1, licenseIntent: 'standalone' },
    { sku: 'CW9172I', qty: 3 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ]);
  const groups = groupQuoteEditorRows(rows);
  const switches = groups.find(({ key }) => key === 'switches');
  // Two switch models plus one standalone renewal are quotable products; the
  // paired projection is the review view of hardware already counted.
  assert.equal(switches.entries.length, 4);
  assert.equal(switches.productCount, 3);
  assert.equal(switches.pairedLicenseCount, 1);
  const aps = groups.find(({ key }) => key === 'access-points');
  assert.equal(aps.productCount, 1);
  assert.equal(aps.pairedLicenseCount, 1);
});

test('a suspended paired projection cannot be serialized directly and never reaches a rebuild', () => {
  const paired = withDefaultPairedLicenseIntents(switchRows());
  const allBare = applyLinkedQuoteRowPatch(applyLinkedQuoteRowPatch(paired, 0, { tier: 'none' }), 1, { tier: 'none' });
  const suspendedRow = allBare.find((row) => row.sku === 'LIC-MS130-24-3Y');
  assert.equal(suspendedRow?.pairedSuspended, true);
  assert.equal(suspendedRow?.qty, 4, 'the last synced quantity is kept in place rather than deleted');
  assert.equal(licensePairReviewForRows(allBare)[2].kind, 'suspended');
  // Restoring a tier resumes the sync from the CURRENT active hardware.
  const oneRestored = applyLinkedQuoteRowPatch(allBare, 0, { tier: '' });
  assert.equal(oneRestored[2].pairedSuspended, undefined);
  assert.equal(oneRestored[2].qty, 2);
  const bothRestored = applyLinkedQuoteRowPatch(oneRestored, 1, { tier: '' });
  assert.equal(bothRestored[2].qty, 6);

  const direct = quoteTextFromEditorRows(allBare, '', {});
  assert.equal(direct.ok, false);
  assert.equal(direct.errors[0].code, 'suspended_paired_license');

  const rebuilt = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(allBare), '', {});
  assert.equal(rebuilt.ok, true, rebuilt.error);
  assert.deepEqual(rebuilt.hardwareOnlyLines, [{ sku: 'MS130-24P', qty: 2 }, { sku: 'MS130-24', qty: 4 }]);
  assert.deepEqual(rebuilt.hardwareOnlySkus, ['MS130-24P', 'MS130-24']);
  assert.equal(rebuilt.text, '2 MS130-24P hardware only\n4 MS130-24 hardware only');

  const standalone = applyLinkedQuoteRowPatch(allBare, 2, { licenseIntent: 'standalone' });
  assert.equal(standalone[2].pairedSuspended, undefined);
  assert.equal(quoteTextFromEditorRows(standalone, '', {}).ok, true);
});

test('a retyped hardware SKU never deletes its old projection mid-keystroke; explicit removal does', () => {
  const paired = withDefaultPairedLicenseIntents([
    { sku: 'MX67', qty: 2 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
  ]);
  const retyped = applyLinkedQuoteRowPatch(paired, 0, { sku: 'MX6' });
  assert.equal(retyped.length, 2, 'the orphaned projection survives while the rep is typing');
  assert.equal(retyped[1].licenseIntent, 'paired');
  const removed = removeLinkedQuoteRow(paired, 0);
  assert.deepEqual(removed, []);
  // Removing the licence row itself never touches hardware.
  const licenseRemoved = removeLinkedQuoteRow(paired, 1);
  assert.deepEqual(licenseRemoved.map(({ sku, qty }) => ({ sku, qty })), [{ sku: 'MX67', qty: 2 }]);
});

test('a successful rebuild re-projects paired licenses from the verified option and keeps explicit rows', () => {
  const committed = [
    { sku: 'MX95', qty: 2, tier: 'security' },
    { sku: 'LIC-MX95-SEC-3Y', qty: 1, licenseIntent: 'standalone' },
    { sku: 'MR44', qty: 3 },
    { sku: 'MR46', qty: 1, tier: 'none' },
  ];
  const urlLines = [
    { sku: 'MX95', qty: 2 },
    { sku: 'LIC-MX95-SEC-3Y', qty: 3 },
    { sku: 'MR44', qty: 3 },
    { sku: 'MR46', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ];
  const projected = withPairedLicenseProjections(committed, urlLines);
  assert.deepEqual(projected.slice(0, 4), committed);
  assert.deepEqual(projected.slice(4).map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'LIC-MX95-SEC-3Y', qty: 2, licenseIntent: 'paired' },
    { sku: 'LIC-ENT-3YR', qty: 3, licenseIntent: 'paired' },
  ]);
  const review = licensePairReviewForRows(projected);
  assert.equal(review[4].kind, 'paired');
  assert.equal(review[5].kind, 'paired');
  assert.equal(review[1].kind, 'standalone');
  // Round trip: the projections are stripped again for the next rebuild and
  // the committed quote text is unchanged.
  assert.deepEqual(rowsForLinkedQuoteRebuild(projected), committed.map((row) => ({ ...row })));

  // A URL licence with no committed hardware to pair with is never projected.
  const stray = withPairedLicenseProjections([{ sku: 'MR44', qty: 1 }], [
    { sku: 'MR44', qty: 1 }, { sku: 'LIC-ENT-1YR', qty: 1 }, { sku: 'LIC-MX67-SEC-1YR', qty: 4 },
  ]);
  assert.deepEqual(stray.map(({ sku }) => sku), ['MR44', 'LIC-ENT-1YR']);

  // Term-agnostic alias rows consume the URL licence they resolved to.
  const alias = withPairedLicenseProjections([{ sku: 'MR-ENT', qty: 2 }, { sku: 'MR44', qty: 1 }], [
    { sku: 'MR44', qty: 1 }, { sku: 'LIC-ENT-3YR', qty: 3 },
  ]);
  assert.deepEqual(alias.slice(2).map(({ sku, qty }) => ({ sku, qty })), [{ sku: 'LIC-ENT-3YR', qty: 1 }]);
});

test('a failed rebuild attempt keeps the pre-attempt projections visible', () => {
  const editorRows = withDefaultPairedLicenseIntents([
    { sku: 'MS130-24P', qty: 2 },
    { sku: 'LIC-MS130-24-3Y', qty: 2 },
    { sku: 'LIC-MS130-48-3Y', qty: 1, licenseIntent: 'standalone' },
  ]);
  const committed = rowsForLinkedQuoteRebuild(editorRows);
  assert.deepEqual(committed.map(({ sku }) => sku), ['MS130-24P', 'LIC-MS130-48-3Y']);
  const retained = retainPairedLicenseProjections(committed, editorRows);
  assert.deepEqual(retained.map(({ sku, licenseIntent }) => ({ sku, licenseIntent })), [
    { sku: 'MS130-24P', licenseIntent: undefined },
    { sku: 'LIC-MS130-48-3Y', licenseIntent: 'standalone' },
    { sku: 'LIC-MS130-24-3Y', licenseIntent: 'paired' },
  ]);
});

test('the Zoho handoff splits a reviewed standalone quantity out of the aggregated URL line', () => {
  const urlLines = [
    { sku: 'MX95-HW', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 3 },
    { sku: 'MR44', qty: 3 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ];
  const committed = [
    { sku: 'MX95', qty: 2, tier: 'security' },
    { sku: 'LIC-MX95-SEC-1Y', qty: 1, licenseIntent: 'standalone' },
    { sku: 'MR44', qty: 3 },
    { sku: 'LIC-MX95-SEC-3Y', qty: 2, licenseIntent: 'paired' },
  ];
  assert.deepEqual(oneshotSkusWithReviewedLicenseIntents(urlLines, committed), [
    { sku: 'MX95-HW', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 1, licenseIntent: 'standalone' },
    { sku: 'MR44', qty: 3 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ]);
  // Without reviewed rows the cart is passed through unchanged.
  assert.deepEqual(oneshotSkusWithReviewedLicenseIntents(urlLines, null), [
    { sku: 'MX95-HW', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 3 },
    { sku: 'MR44', qty: 3 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ]);
  // A URL line that cannot fund the standalone quantity is left for the Worker
  // to refuse rather than being silently rewritten.
  assert.deepEqual(oneshotSkusWithReviewedLicenseIntents(
    [{ sku: 'LIC-MX95-SEC-3YR', qty: 1 }],
    [{ sku: 'LIC-MX95-SEC-3Y', qty: 2, licenseIntent: 'standalone' }],
  ), [{ sku: 'LIC-MX95-SEC-3YR', qty: 1 }]);
  // A wholly standalone line keeps its intent and is not split into a zero line.
  assert.deepEqual(oneshotSkusWithReviewedLicenseIntents(
    [{ sku: 'LIC-MX65-SEC-5YR', qty: 2 }],
    [{ sku: 'LIC-MX65-SEC-5YR', qty: 2, licenseIntent: 'standalone' }],
  ), [{ sku: 'LIC-MX65-SEC-5YR', qty: 2, licenseIntent: 'standalone' }]);
});

test('direct one-shot rows drop the editor-only None tier and keep intents and availability', () => {
  assert.deepEqual(oneshotSkusFromCommittedRows([
    { sku: 'MX67', qty: 1, tier: 'none', unresolved: false },
    { sku: 'MX67', qty: 2, tier: 'security' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1, licenseIntent: 'standalone', availability: 'zoho_only' },
    { sku: 'MR44', qty: 2, licenseIntent: 'standalone' },
    { sku: '', qty: 1 },
  ]), [
    { sku: 'MX67', qty: 1 },
    { sku: 'MX67', qty: 2, tier: 'SECURITY' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1, licenseIntent: 'standalone', availability: 'zoho_only' },
    { sku: 'MR44', qty: 2 },
  ]);
});

test('the editor wires Remove to linked removal and reports product counts', () => {
  const editor = readSource('src/sidebar/components/SkuQuantityEditor.jsx');
  assert.match(editor, /removeLinkedQuoteRow\(values, index, \{ allowHaLicenseRatio \}\)/);
  assert.doesNotMatch(editor, /publish\(values\.filter\(\(_, rowIndex\) => rowIndex !== index\)\)/);
  assert.match(editor, /group\.productCount/);
  assert.match(editor, /group\.pairedLicenseCount/);
  assert.doesNotMatch(editor, /\{group\.entries\.length\}/);
  assert.match(editor, /pairing\.kind === 'suspended'/);
});

test('ChatPanel forwards quantity-scoped bare lines, re-projects after rebuild, and preserves standalone intent', () => {
  const chat = readSource('src/sidebar/panels/ChatPanel.jsx');
  // Serialization -> verification -> message -> one-shot payload -> Execute.
  assert.match(chat, /prepared\.hardwareOnlyLines,\s*\)/);
  assert.match(chat, /hardwareOnlyLines\.length \? \{ hardwareOnlyLines \} : \{\}/);
  assert.match(chat, /quoteHardwareOnlyLines: Array\.isArray\(prepared\.hardwareOnlyLines\)/);
  assert.match(chat, /hardwareOnlyLines: sourceMessage\?\.quoteHardwareOnlyLines/);
  assert.match(chat, /hardware_only_lines: hardwareOnlyLines\.map/);
  assert.equal((chat.match(/hardware_only_lines: msg\.base\.hardware_only_lines/g) || []).length, 2,
    'first-quote Execute and the extra-term Execute both repeat the fingerprint-bound field');
  assert.match(chat, /hardware_only_lines: Array\.isArray\(prepared\.hardwareOnlyLines\) \? prepared\.hardwareOnlyLines : \[\]/,
    'the plan-card replan restates the bare lines instead of inheriting stale ones');
  // Paired projections after a successful rebuild and across failed attempts.
  assert.match(chat, /withPairedLicenseProjections\(\s*prepared\.rows,\s*pairedProjectionSourceLines\(verified\.urls/);
  assert.equal((chat.match(/retainPairedLicenseProjections\(prepared\.rows, rows\)/g) || []).length, 3);
  // Standalone intent through the tier replan and the ecommerce -> Zoho handoff.
  assert.match(chat, /row\?\.licenseIntent === 'standalone'\s*\|\| !parsed\.some/);
  assert.match(chat, /oneshotSkusWithReviewedLicenseIntents\(parseOrderUrlItems\(orderUrl\), reviewedRows\)/);
  assert.match(chat, /oneshotSkusWithReviewedLicenseIntents\(parseOrderUrlItems\(option\.url\), msg\.base\.skus\)/);
  assert.match(chat, /reviewedRows: quoteDraftRows\(sourceMessage\)/);
  assert.match(chat, /oneshotSkusFromCommittedRows\(directSkus\)/);
  assert.match(chat, /let skus = oneshotSkusFromCommittedRows\(prepared\.rows\)/);
});
