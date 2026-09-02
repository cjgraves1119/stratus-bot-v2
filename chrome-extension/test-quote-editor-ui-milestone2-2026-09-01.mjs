// Milestone 2 acceptance contract for the editable quote surface. These tests
// keep presentation order separate from canonical quote order, make hardware
// own licensing, keep explicit renewals additive, and gate every stale action
// while a product draft or availability decision is unresolved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  applyLinkedQuoteRowPatch,
  applyQuoteEditorHardwareLicenseUse,
  applySkuSuggestion,
  blankStandaloneRenewalRow,
  commitQuoteEditorSkuDraft,
  consolidatePairedLicenseProjections,
  groupQuoteEditorRows,
  QUOTE_TERM_OPTIONS,
  quoteEditorHardwareLicenseUse,
  quoteRouteForRows,
  quoteTextFromEditorRows,
  selectQuoteEditorProduct,
  withDefaultPairedLicenseIntents,
} from './src/sidebar/components/sku-editor-core.mjs';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetReact = require('@babel/preset-react');
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');

const editorSource = read('./src/sidebar/components/SkuQuantityEditor.jsx');
const quoteResultSource = read('./src/sidebar/components/QuoteResult.jsx');
const chatPanelSource = read('./src/sidebar/panels/ChatPanel.jsx');
const cssSource = read('./src/styles/sidebar.css');

test('presentation groups are hardware first, then consolidated paired licenses, then standalone without mutating canonical order', () => {
  const input = [
    { sku: 'LIC-ENT-3YR', qty: 1 },
    { sku: 'MR36-HW', qty: 2, tier: 'enterprise' },
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'CW9162I-MR', qty: 1, tier: 'enterprise' },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'standalone' },
  ];
  const canonicalBefore = input.map((row) => ({ ...row }));
  const rows = withDefaultPairedLicenseIntents(input);
  assert.deepEqual(input, canonicalBefore, 'defaulting and grouping do not mutate the caller rows');
  assert.deepEqual(rows.map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'LIC-ENT-3YR', qty: 3, licenseIntent: 'paired' },
    { sku: 'MR36-HW', qty: 2, licenseIntent: undefined },
    { sku: 'CW9162I-MR', qty: 1, licenseIntent: undefined },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'standalone' },
  ]);
  const aps = groupQuoteEditorRows(rows).find((group) => group.key === 'access-points');
  assert.deepEqual(aps.entries.map(({ row, role }) => [row.sku, role]), [
    ['MR36-HW', 'product'],
    ['CW9162I-MR', 'product'],
    ['LIC-ENT-3YR', 'paired_license'],
    ['LIC-ENT-3YR', 'standalone_license'],
  ]);
  assert.deepEqual(rows.map((row) => row.sku), ['LIC-ENT-3YR', 'MR36-HW', 'CW9162I-MR', 'LIC-ENT-3YR']);
});

test('only exact paired projections consolidate; another term and standalone copies remain independent', () => {
  const consolidated = consolidatePairedLicenseProjections([
    { sku: 'LIC-ENT-3YR', qty: 2, licenseIntent: 'paired', tier: 'stale-hidden-value' },
    { sku: 'LIC-ENT-3YR', qty: 3, licenseIntent: 'paired' },
    { sku: 'LIC-ENT-1YR', qty: 4, licenseIntent: 'paired' },
    { sku: 'LIC-ENT-3YR', qty: 5, licenseIntent: 'standalone' },
  ]);
  assert.deepEqual(consolidated.map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'LIC-ENT-3YR', qty: 5, licenseIntent: 'paired' },
    { sku: 'LIC-ENT-1YR', qty: 4, licenseIntent: 'paired' },
    { sku: 'LIC-ENT-3YR', qty: 5, licenseIntent: 'standalone' },
  ]);
});

test('licensable hardware defaults paired and its hardware-only choice restores the prior tier', () => {
  const initial = withDefaultPairedLicenseIntents([
    { sku: 'MR36-HW', qty: 2, tier: 'advanced' },
    { sku: 'LIC-MR-ADV-3Y', qty: 2 },
  ]);
  assert.equal(quoteEditorHardwareLicenseUse(initial[0]), 'paired');
  assert.equal(initial[1].licenseIntent, 'paired');
  const bare = applyQuoteEditorHardwareLicenseUse(initial, 0, 'hardware_only');
  assert.equal(bare[0].tier, 'none');
  assert.equal(bare[0].tierBeforeHardwareOnly, 'advanced');
  assert.equal(bare[1].pairedSuspended, true);
  const restored = applyQuoteEditorHardwareLicenseUse(bare, 0, 'paired');
  assert.equal(restored[0].tier, 'advanced');
  assert.equal(restored[0].tierBeforeHardwareOnly, undefined);
  assert.equal(restored[1].pairedSuspended, undefined);
  assert.equal(restored[1].qty, 2);
  assert.deepEqual(applyQuoteEditorHardwareLicenseUse(restored, 0, 'paired'), restored, 'choosing the active value is idempotent');
});

test('restoring a hardware-only row joins the current family tier instead of rolling peers backward', () => {
  let rows = withDefaultPairedLicenseIntents([
    { sku: 'MR36-HW', qty: 1 },
    { sku: 'CW9162I-MR', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 2 },
  ]);
  rows = applyQuoteEditorHardwareLicenseUse(rows, 0, 'hardware_only');
  rows = applyLinkedQuoteRowPatch(rows, 1, { tier: 'advanced' });
  const restored = applyQuoteEditorHardwareLicenseUse(rows, 0, 'paired');
  assert.equal(restored[0].tier, 'advanced');
  assert.equal(restored[1].tier, 'advanced');
  assert.equal(restored.find((row) => row.licenseIntent === 'paired').sku, 'LIC-MR-ADV-3Y');
});

test('dedicated standalone renewal accepts only license products and same-SKU proof updates preserve intent', () => {
  const blank = [blankStandaloneRenewalRow()];
  const committed = commitQuoteEditorSkuDraft(blank, 0, 'LIC-ENT-3YR', null);
  assert.equal(committed.ok, true);
  assert.equal(committed.rows[0].licenseIntent, 'standalone');
  assert.equal(committed.rows[0].availability, 'unknown');
  assert.equal(quoteRouteForRows(committed.rows).route, 'blocked');

  const hardware = commitQuoteEditorSkuDraft(blank, 0, 'MR36-HW', null);
  assert.equal(hardware.ok, false);
  assert.match(hardware.error, /standalone renewal must use a license SKU/i);
  assert.deepEqual(selectQuoteEditorProduct(blank, 0, { sku: 'MR36-HW', availability: 'ecomm', source: 'zoho' }), blank);

  const proven = selectQuoteEditorProduct(committed.rows, 0, {
    sku: 'LIC-ENT-3YR', availability: 'ecomm', source: 'zoho',
  });
  assert.equal(proven[0].licenseIntent, 'standalone');
  assert.equal(proven[0].availability, 'ecomm');
  assert.equal(proven[0].productSource, 'zoho');
});

test('explicit unproven commits fail closed and exact same-SKU selections change metadata only', () => {
  const rows = [{
    sku: 'MR36-HW', qty: 2, tier: 'enterprise', availability: 'ecomm', productSource: 'zoho',
  }];
  const retyped = commitQuoteEditorSkuDraft(rows, 0, 'MR36-HW', null);
  assert.equal(retyped.rows[0].sku, 'MR36-HW');
  assert.equal(retyped.rows[0].tier, 'enterprise');
  assert.equal(retyped.rows[0].availability, 'unknown');
  assert.equal(retyped.rows[0].productSource, 'manual');
  assert.equal(quoteRouteForRows(retyped.rows).route, 'blocked');
  assert.equal(quoteTextFromEditorRows(retyped.rows, '').errors[0].code, 'availability_unknown');
});

test('committed cross-family replacement clears an incompatible tier and old projection; same coverage keeps a valid tier', () => {
  const mx = withDefaultPairedLicenseIntents([
    { sku: 'MX67', qty: 2, tier: 'security' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
  ]);
  const mr = commitQuoteEditorSkuDraft(mx, 0, 'MR36-HW', {
    ok: true,
    results: [{ sku: 'MR36-HW', availability: 'ecomm', source: 'zoho' }],
  });
  assert.deepEqual(mr.rows.map((row) => row.sku), ['MR36-HW']);
  assert.equal(mr.rows[0].tier, undefined);
  assert.equal(mr.rows.some((row) => row.sku.startsWith('LIC-MX')), false);

  const sameCoverage = applyLinkedQuoteRowPatch([
    { sku: 'MR36-HW', qty: 1, tier: 'advanced' },
    { sku: 'LIC-MR-ADV-3Y', qty: 1, licenseIntent: 'paired' },
  ], 0, { sku: 'MR44' });
  assert.equal(sameCoverage[0].tier, 'advanced');
  assert.equal(sameCoverage[1].sku, 'LIC-MR-ADV-3Y');
  assert.equal(sameCoverage[1].licenseIntent, 'paired');

  const direct = applyLinkedQuoteRowPatch(mx, 0, { sku: 'MR36-HW' });
  assert.equal(direct[0].availability, undefined);
  assert.equal(direct[0].productSource, undefined);
  assert.equal(direct[0].tier, undefined);
  assert.deepEqual(direct.map((row) => row.sku), ['MR36-HW']);
});

test('SKU spelling suggestions never transfer routing proof to another identity', () => {
  const next = applySkuSuggestion(withDefaultPairedLicenseIntents([
    { sku: 'MX67', qty: 1, tier: 'security', unresolved: true, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]), { input: 'MX67', suggest: ['MR36-HW'], qty: 1 });
  assert.equal(next[0].sku, 'MR36-HW');
  assert.equal(next[0].availability, undefined);
  assert.equal(next[0].productSource, undefined);
  assert.equal(next[0].tier, undefined);
  assert.deepEqual(next.map((row) => row.sku), ['MR36-HW']);

  const ha = withDefaultPairedLicenseIntents([
    { sku: 'MX95', qty: 2, tier: 'security' },
    { sku: 'LIC-MX95-SEC-3Y', qty: 1 },
    { sku: 'MR3G-HW', qty: 1, unresolved: true },
  ], { allowHaLicenseRatio: true });
  const correctedHa = applySkuSuggestion(ha, {
    input: 'MR3G-HW', suggest: ['MR36-HW'], qty: 1,
  }, 'apply', { allowHaLicenseRatio: true });
  assert.equal(correctedHa.find((row) => row.sku === 'LIC-MX95-SEC-3Y').qty, 1, 'an unrelated reviewed HA pair remains 2:1');
});

test('quote-wide term is All/1/3/5, replaces stale prompt terms, and rejects conflicting standalone renewals', () => {
  assert.deepEqual(QUOTE_TERM_OPTIONS.map((option) => option.value), ['', '1', '3', '5']);
  const base = [{ sku: 'MR36-HW', qty: 1, tier: 'enterprise' }];
  const one = quoteTextFromEditorRows(base, '1 MR36-HW 5 year', { term: '1' });
  assert.equal(one.ok, true);
  assert.match(one.text, /\n1 year$/);
  assert.doesNotMatch(one.text, /5 year/);
  const all = quoteTextFromEditorRows(base, '1 MR36-HW 5 year', { term: '' });
  assert.equal(all.ok, true);
  assert.doesNotMatch(all.text, /\n[135] year$/);
  assert.equal(quoteTextFromEditorRows(base, '', { term: '7' }).errors[0].code, 'invalid_quote_term');
  const conflict = quoteTextFromEditorRows([
    ...base,
    { sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'standalone' },
  ], '', { term: '1' });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.errors[0].code, 'mixed_quote_term');
  const legacyConflict = quoteTextFromEditorRows([
    ...base,
    { sku: 'LIC-ENT-10YR', qty: 1, licenseIntent: 'standalone' },
  ], '', { term: '3' });
  assert.equal(legacyConflict.errors[0].code, 'mixed_quote_term');
  const inferredConflict = quoteTextFromEditorRows([
    ...base,
    { sku: 'LIC-ENT-1YR', qty: 1, licenseIntent: 'standalone' },
  ], 'quote for 3 years');
  assert.equal(inferredConflict.errors[0].code, 'mixed_quote_term');
});

test('row actions keep their target index after duplicate paired projections consolidate', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 2 },
    { sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'paired', tier: 'stale' },
    { sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'paired' },
    { sku: 'LIC-MR-ADV-3Y', qty: 5, licenseIntent: 'standalone' },
  ];
  const patched = applyLinkedQuoteRowPatch(rows, 3, { qty: 7 });
  assert.deepEqual(patched.map(({ sku, qty, licenseIntent }) => ({ sku, qty, licenseIntent })), [
    { sku: 'MR36-HW', qty: 2, licenseIntent: undefined },
    { sku: 'LIC-ENT-3YR', qty: 2, licenseIntent: 'paired' },
    { sku: 'LIC-MR-ADV-3Y', qty: 7, licenseIntent: 'standalone' },
  ]);
});

test('installed components compile and expose the fixed responsive grid plus all stale-action gates', () => {
  for (const [filename, source] of [
    ['SkuQuantityEditor.jsx', editorSource],
    ['QuoteResult.jsx', quoteResultSource],
    ['ChatPanel.jsx', chatPanelSource],
  ]) {
    babel.transformSync(source, { filename, presets: [presetReact], babelrc: false, configFile: false });
  }
  assert.match(editorSource, /<span>Product<\/span><span>Qty<\/span><span>Tier<\/span><span>Term<\/span><span>License use<\/span><span>Actions<\/span>/);
  assert.match(editorSource, /\+ Add standalone renewal/);
  assert.match(editorSource, /editorPurpose === 'standalone'\s*\|\| valuesRef\.current\[index\]\?\.licenseIntent === 'standalone'/);
  assert.match(editorSource, /<option value="paired">Paired licensing<\/option>/);
  assert.match(editorSource, /<option value="hardware_only">Hardware only<\/option>/);
  assert.match(editorSource, /QUOTE_TERM_OPTIONS\.map/);
  assert.match(editorSource, /const updateBlocked = draftActive \|\| !validation\.ok \|\| routeBlocked \|\| !preflight\.ok;/);
  assert.match(editorSource, /searchTokenRef\.current \+= 1;\s*setSearch\(EMPTY_SEARCH\);/);
  assert.match(quoteResultSource, /busy \|\| draftDirty \|\| editorDraftActive \|\| suggestions\.length > 0/);
  assert.match(quoteResultSource, /const suggestionMutationLocked = busy \|\| editorDraftActive;/);
  assert.equal((quoteResultSource.match(/disabled=\{suggestionMutationLocked\}/g) || []).length, 2);
  assert.doesNotMatch(quoteResultSource, /\[resultRevision\][\s\S]{0,80}setEditorDraftActive\(false\)/);
  assert.match(chatPanelSource, /const reviewLocked = immutableReviewLocked \|\| productDirty \|\| productDraftActive;/);
  assert.match(chatPanelSource, /disabled=\{hard\.length > 0 \|\| busy \|\| productDirty \|\| productDraftActive\}/);
  assert.match(cssSource, /\.sku-editor-grid\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(cssSource, /@media \(max-width: 760px\)[\s\S]*?grid-template-areas:/);
});
