// Milestone 1 (A + C) regressions for the quote editor's product picker:
//  - an active live Zoho product with an unknown storefront status stays
//    selectable and editable, keeps its source/availability through
//    normalization, and blocks every final route until an exact retry proves
//    ecomm or zoho_only ("unknown" is never promoted);
//  - the routing matrix (all ecomm -> regular quote, any zoho_only -> whole
//    cart Zoho review, any unknown -> blocked) is applied in serialization so
//    Generate/Update, Zoho review and CRM writes all fail closed together;
//  - restored verified rows and derived paired projections without metadata
//    are untouched by the gate;
//  - typing edits a local combobox draft only; the canonical row identity and
//    grouping change on a picked result or an explicit exact commit, and a
//    manually typed exact SKU is routed with the same fail-closed rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  applyLinkedQuoteRowPatch,
  commitQuoteEditorSkuDraft,
  directZohoQuoteTerm,
  exactProductSearchMatch,
  groupQuoteEditorRows,
  licensePairReviewForRows,
  normalizeSkuEditorRows,
  oneshotSkusFromCommittedRows,
  quoteRouteForRows,
  quoteTextFromEditorRows,
  resolveRowAvailabilityFromSearch,
  rowAvailabilityState,
  rowsForLinkedQuoteRebuild,
  selectQuoteEditorProduct,
  withPairedLicenseProjections,
} from './src/sidebar/components/sku-editor-core.mjs';
import { sanitizeProductSearchResponse } from './src/lib/product-search.mjs';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetReact = require('@babel/preset-react');

const editorPath = new URL('./src/sidebar/components/SkuQuantityEditor.jsx', import.meta.url);
const chatPanelPath = new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url);
const editorSource = readFileSync(editorPath, 'utf8');
const chatPanelSource = readFileSync(chatPanelPath, 'utf8');

const liveUnknown = { sku: 'CW9174E-RTG', name: 'CW9174E RTG', active: true, source: 'zoho', availability: 'unknown' };
const liveEcomm = { sku: 'CW9174E-RTG', name: 'CW9174E RTG', active: true, source: 'zoho', availability: 'ecomm' };
const liveZohoOnly = { sku: 'CW9174E-RTG', name: 'CW9174E RTG', active: true, source: 'zoho', availability: 'zoho_only' };
const searchOk = (...results) => ({ ok: true, live: true, results });

test('direct Zoho term resolution accepts concrete renewals and termless accessories without guessing', () => {
  assert.deepEqual(
    directZohoQuoteTerm([{ sku: 'LIC-MR-ADV-3YR', qty: 4, licenseIntent: 'standalone', availability: 'zoho_only' }], ''),
    { ok: true, term: '3', source: 'license_sku', error: '' },
  );
  assert.deepEqual(
    directZohoQuoteTerm([{ sku: 'MA-SFP-10GB-SR-AO', qty: 2, availability: 'zoho_only' }], ''),
    { ok: true, term: null, source: 'not_required', error: '' },
  );
  assert.equal(directZohoQuoteTerm([
    { sku: 'LIC-ENT-1YR', qty: 1, licenseIntent: 'standalone' },
    { sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'standalone' },
  ], '').ok, false);
  assert.equal(directZohoQuoteTerm([{ sku: 'MR36-HW', qty: 1, tier: 'advanced' }], '').ok, false);
  assert.deepEqual(
    directZohoQuoteTerm([{ sku: 'MR36-HW', qty: 1, tier: 'none' }], ''),
    { ok: true, term: null, source: 'not_required', error: '' },
  );
});

test('the sanitizer keeps a live Zoho row without a storefront classification as unknown, never ecomm', () => {
  const sanitized = sanitizeProductSearchResponse({
    ok: true,
    live: true,
    results: [
      { sku: 'CW9174E-RTG', name: 'CW9174E RTG', active: true, source: 'zoho' },
      { sku: 'MR36-HW', name: 'MR36', active: true, source: 'zoho', availability: 'ecomm' },
      { sku: 'MA-SFP-10GB-SR-AO', name: 'AO optic', active: true, source: 'zoho', availability: 'zoho_only' },
    ],
  }, 'CW');
  assert.equal(sanitized.ok, true, sanitized.error);
  assert.deepEqual(sanitized.results.map((row) => [row.sku, row.availability]), [
    ['CW9174E-RTG', 'unknown'],
    ['MR36-HW', 'ecomm'],
    ['MA-SFP-10GB-SR-AO', 'zoho_only'],
  ]);
});

test('row availability state distinguishes a selected unknown from rows that simply lack metadata', () => {
  assert.equal(rowAvailabilityState({ sku: 'CW9174E-RTG', qty: 1, availability: 'unknown', productSource: 'zoho' }), 'unknown');
  assert.equal(rowAvailabilityState({ sku: 'CW9174E-RTG', qty: 1, availability: 'ecomm', productSource: 'zoho' }), 'ecomm');
  assert.equal(rowAvailabilityState({ sku: 'CW9174E-RTG', qty: 1, availability: 'zoho_only' }), 'zoho_only');
  // Legacy typed-row shape: unknown without a source is "no proof", not a block.
  assert.equal(rowAvailabilityState({ sku: 'MX67', qty: 1, availability: 'unknown' }), '');
  assert.equal(rowAvailabilityState({ sku: 'LIC-ENT-3YR', qty: 1, licenseIntent: 'paired' }), '');
  assert.equal(rowAvailabilityState({ sku: 'MX67', qty: 1, availability: 'ECOMM ' }), 'ecomm');
});

test('selecting an unknown live product keeps it selectable and editable without guessing a route', () => {
  const rows = selectQuoteEditorProduct([{ sku: '', qty: 1, unresolved: false }], 0, liveUnknown);
  assert.deepEqual(rows, [{ sku: 'CW9174E-RTG', qty: 1, unresolved: false, availability: 'unknown', productSource: 'zoho' }]);
  const edited = applyLinkedQuoteRowPatch(rows, 0, { qty: 3 });
  assert.equal(edited[0].qty, 3);
  assert.equal(edited[0].availability, 'unknown');
  assert.equal(edited[0].productSource, 'zoho');
  assert.equal(quoteRouteForRows(edited).route, 'blocked');
  assert.deepEqual(quoteRouteForRows(edited).unknownSkus, ['CW9174E-RTG']);
});

test('normalization preserves productSource and explicit unknown, and unknown is sticky across duplicate merges', () => {
  const normalized = normalizeSkuEditorRows([
    { sku: 'cw9174e-rtg', qty: '2', availability: 'unknown', productSource: 'zoho' },
    { sku: 'CW9174E-RTG', qty: 1, availability: 'ecomm' },
    { sku: 'MR36-HW', qty: 4, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'MX67', qty: 1, availability: 'unknown' },
  ]);
  assert.equal(normalized.ok, true);
  assert.deepEqual(normalized.rows, [
    { sku: 'CW9174E-RTG', qty: 3, unresolved: false, availability: 'unknown', productSource: 'zoho' },
    { sku: 'MR36-HW', qty: 4, unresolved: false, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'MX67', qty: 1, unresolved: false },
  ]);

  // Order-independent: an eCommerce proof first, then an unknown duplicate.
  const reversed = normalizeSkuEditorRows([
    { sku: 'CW9174E-RTG', qty: 1, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'CW9174E-RTG', qty: 2, availability: 'unknown', productSource: 'zoho' },
  ]);
  assert.equal(reversed.rows[0].availability, 'unknown');
  assert.equal(reversed.rows[0].qty, 3);

  // A Zoho-only proof beside an unknown duplicate is still blocked until retried.
  const withZohoOnly = normalizeSkuEditorRows([
    { sku: 'CW9174E-RTG', qty: 1, availability: 'zoho_only' },
    { sku: 'CW9174E-RTG', qty: 2, availability: 'unknown', productSource: 'zoho' },
  ]);
  assert.equal(withZohoOnly.rows[0].availability, 'unknown');

  // The pre-existing conservative merges are unchanged.
  assert.equal(normalizeSkuEditorRows([
    { sku: 'CW9174E-RTG', qty: 1, availability: 'zoho_only' },
    { sku: 'CW9174E-RTG', qty: 2, availability: 'ecomm' },
  ]).rows[0].availability, 'zoho_only');
  assert.equal('availability' in normalizeSkuEditorRows([
    { sku: 'MR36-HW', qty: 1, availability: 'ecomm' },
    { sku: 'MR36-HW', qty: 2 },
  ]).rows[0], false);
});

test('routing matrix: all ecomm -> regular quote, any zoho_only -> Zoho review, any unknown -> blocked', () => {
  const ecommOnly = [
    { sku: 'MR36-HW', qty: 4, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'paired' },
  ];
  assert.deepEqual(quoteRouteForRows(ecommOnly), { route: 'ecomm', unknownSkus: [], zohoOnlySkus: [] });
  const anyZohoOnly = [...ecommOnly, { sku: 'MA-SFP-10GB-SR-AO', qty: 2, availability: 'zoho_only' }];
  assert.deepEqual(quoteRouteForRows(anyZohoOnly), { route: 'zoho_only', unknownSkus: [], zohoOnlySkus: ['MA-SFP-10GB-SR-AO'] });
  const anyUnknown = [...anyZohoOnly, { sku: 'CW9174E-RTG', qty: 1, availability: 'unknown', productSource: 'zoho' }];
  assert.deepEqual(quoteRouteForRows(anyUnknown), {
    route: 'blocked',
    unknownSkus: ['CW9174E-RTG'],
    zohoOnlySkus: ['MA-SFP-10GB-SR-AO'],
  });
  assert.equal(quoteRouteForRows([]).route, 'ecomm');
  assert.equal(quoteRouteForRows(null).route, 'ecomm');
});

test('serialization fails closed while a selected product route is unknown: no text, no Zoho lines', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 4, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'CW9174E-RTG', qty: 1, availability: 'unknown', productSource: 'zoho' },
  ];
  const prepared = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(rows), '');
  assert.equal(prepared.ok, false);
  assert.equal(prepared.text, '');
  assert.equal(prepared.errors?.[0]?.code, 'availability_unknown');
  assert.match(prepared.error, /CW9174E-RTG/);
  assert.match(prepared.error, /no link, Zoho review, or CRM write/i);
  // The Zoho one-shot claim shape never carries an unknown as a proof either.
  assert.deepEqual(oneshotSkusFromCommittedRows(rows), [
    { sku: 'MR36-HW', qty: 4, availability: 'ecomm' },
    { sku: 'CW9174E-RTG', qty: 1 },
  ]);
});

test('rows without metadata (restored, typed, paired projections) are not blocked by the unknown gate', () => {
  const rows = [
    { sku: 'MX67', qty: 1 },
    { sku: 'MR36-HW', qty: 4, tier: 'enterprise' },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'paired' },
    { sku: 'LIC-MV-3YR', qty: 2, licenseIntent: 'standalone' },
  ];
  assert.equal(quoteRouteForRows(rows).route, 'ecomm');
  const prepared = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(rows), '');
  assert.equal(prepared.ok, true, prepared.error);
  assert.match(prepared.text, /4 MR36-HW enterprise/);
  assert.match(prepared.text, /2 LIC-MV-3YR/);
});

test('retry outcomes: an exact re-read resolves unknown to ecomm or zoho_only and only an exact match may do so', () => {
  const rows = [
    { sku: 'MX67', qty: 1 },
    { sku: 'CW9174E-RTG', qty: 2, availability: 'unknown', productSource: 'zoho' },
  ];

  const ecomm = resolveRowAvailabilityFromSearch(rows, 1, 'CW9174E-RTG', searchOk(liveEcomm));
  assert.equal(ecomm.changed, true);
  assert.equal(ecomm.rows[1].availability, 'ecomm');
  assert.equal(ecomm.rows[1].productSource, 'zoho');
  assert.equal(ecomm.rows[1].qty, 2);
  assert.equal(quoteRouteForRows(ecomm.rows).route, 'ecomm');
  const ecommPrepared = quoteTextFromEditorRows(rowsForLinkedQuoteRebuild(ecomm.rows), '');
  assert.equal(ecommPrepared.ok, true, ecommPrepared.error);
  assert.match(ecommPrepared.text, /2 CW9174E-RTG/);
  assert.equal(ecommPrepared.rows.find((row) => row.sku === 'CW9174E-RTG').availability, 'ecomm');

  const zohoOnly = resolveRowAvailabilityFromSearch(rows, 1, 'CW9174E-RTG', searchOk(liveZohoOnly));
  assert.equal(zohoOnly.changed, true);
  assert.equal(zohoOnly.rows[1].availability, 'zoho_only');
  assert.equal(quoteRouteForRows(zohoOnly.rows).route, 'zoho_only');
  assert.deepEqual(oneshotSkusFromCommittedRows(zohoOnly.rows), [
    { sku: 'MX67', qty: 1 },
    { sku: 'CW9174E-RTG', qty: 2, availability: 'zoho_only' },
  ]);

  // Still unknown, a failed search, a prefix-only match, or an inactive
  // product all leave the row blocked; nothing is promoted.
  for (const response of [
    searchOk(liveUnknown),
    { ok: false, error: 'product_search_failed', results: [] },
    searchOk({ ...liveEcomm, sku: 'CW9174E-RTG-EXTRA' }),
    searchOk({ ...liveEcomm, active: false }),
    null,
  ]) {
    const still = resolveRowAvailabilityFromSearch(rows, 1, 'CW9174E-RTG', response);
    assert.equal(still.changed, false, JSON.stringify(response));
    assert.equal(quoteRouteForRows(still.rows).route, 'blocked');
  }
});

test('a late retry response cannot stamp a proof onto a row whose identity changed', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 1, availability: 'ecomm', productSource: 'zoho' },
    { sku: 'MX75', qty: 1 },
  ];
  // The row at the original index is now MX75; CW9174E-RTG is gone entirely.
  const resolved = resolveRowAvailabilityFromSearch(rows, 1, 'CW9174E-RTG', searchOk(liveEcomm));
  assert.equal(resolved.changed, false);
  assert.equal(resolved.index, -1);
  assert.deepEqual(resolved.rows, rows);
  // A row that already holds a proof is never rewritten by a retry.
  const proven = resolveRowAvailabilityFromSearch(rows, 0, 'MR36-HW', searchOk({ ...liveZohoOnly, sku: 'MR36-HW' }));
  assert.equal(proven.changed, false);
  assert.equal(proven.rows[0].availability, 'ecomm');
});

test('metadata survives serialization, projection attachment and the rebuild strip', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 4, tier: 'enterprise', availability: 'ecomm', productSource: 'zoho' },
    { sku: 'MA-SFP-10GB-SR', qty: 2, availability: 'ecomm', productSource: 'zoho' },
  ];
  const prepared = quoteTextFromEditorRows(rows, '');
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.rows.map((row) => [row.sku, row.availability, row.productSource]), [
    ['MR36-HW', 'ecomm', 'zoho'],
    ['MA-SFP-10GB-SR', 'ecomm', 'zoho'],
  ]);
  const projected = withPairedLicenseProjections(prepared.rows, [
    { sku: 'MR36-HW', qty: 4 },
    { sku: 'LIC-ENT-3YR', qty: 4 },
    { sku: 'MA-SFP-10GB-SR', qty: 2 },
  ]);
  assert.deepEqual(projected.map((row) => [row.sku, row.availability || null, row.productSource || null, row.licenseIntent || null]), [
    ['MR36-HW', 'ecomm', 'zoho', null],
    ['MA-SFP-10GB-SR', 'ecomm', 'zoho', null],
    ['LIC-ENT-3YR', null, null, 'paired'],
  ]);
  // The derived projection lacks metadata and must not block the cart.
  assert.equal(quoteRouteForRows(projected).route, 'ecomm');
  const rebuild = rowsForLinkedQuoteRebuild(projected);
  assert.deepEqual(rebuild.map((row) => [row.sku, row.availability, row.productSource]), [
    ['MR36-HW', 'ecomm', 'zoho'],
    ['MA-SFP-10GB-SR', 'ecomm', 'zoho'],
  ]);
  // Normalizing the projected rows again keeps the proof and never invents one.
  const renormalized = normalizeSkuEditorRows(projected);
  assert.equal(renormalized.rows[0].productSource, 'zoho');
  assert.equal('availability' in renormalized.rows[2], false);
});

test('typing is a local draft: the canonical rows, grouping, and order are untouched until commit', () => {
  const rows = [
    { sku: 'MX67', qty: 1 },
    { sku: 'MR36-HW', qty: 4, tier: 'enterprise' },
    { sku: 'LIC-ENT-3YR', qty: 4, licenseIntent: 'paired' },
    { sku: '', qty: 1, unresolved: false },
  ];
  const before = JSON.stringify(rows);
  const groupsBefore = groupQuoteEditorRows(rows, licensePairReviewForRows(rows)).map((group) => [group.key, group.entries.map((entry) => entry.index)]);
  // Mid-keystroke text is never committed: an invalid draft returns the same
  // rows and an inline correction, and a partial one is only evaluated.
  const invalid = commitQuoteEditorSkuDraft(rows, 3, 'MS 130', null);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.changed, false);
  assert.match(invalid.error, /valid 2-80 character SKU/);
  assert.equal(JSON.stringify(invalid.rows), before);
  assert.deepEqual(
    groupQuoteEditorRows(invalid.rows, licensePairReviewForRows(invalid.rows)).map((group) => [group.key, group.entries.map((entry) => entry.index)]),
    groupsBefore,
  );
  // Re-committing the same identity without current exact proof leaves order
  // alone but marks that row unknown immediately, so stale proof cannot route.
  const same = commitQuoteEditorSkuDraft(rows, 0, 'mx67', null);
  assert.equal(same.changed, true);
  assert.deepEqual(same.rows.map((row) => row.sku), rows.map((row) => row.sku));
  assert.equal(same.rows[0].availability, 'unknown');
  assert.equal(same.rows[0].productSource, 'manual');
  assert.equal(quoteRouteForRows(same.rows).route, 'blocked');
});

test('an explicit exact commit changes identity once, drops the old proof, and adopts the exact search evidence', () => {
  const rows = [
    { sku: 'MR36-HW', qty: 4, availability: 'ecomm', productSource: 'zoho' },
    { sku: '', qty: 1, unresolved: false },
  ];
  // A retyped identity loses the previous proof and is synchronously blocked
  // when nothing exact is known.
  const retyped = commitQuoteEditorSkuDraft(rows, 0, 'MR46-HW', searchOk({ ...liveEcomm, sku: 'MR46' }));
  assert.equal(retyped.changed, true);
  assert.equal(retyped.rows[0].sku, 'MR46-HW');
  assert.equal(retyped.rows[0].qty, 4);
  assert.equal(retyped.rows[0].availability, 'unknown');
  assert.equal(retyped.rows[0].productSource, 'manual');
  assert.equal(quoteRouteForRows(retyped.rows).route, 'blocked');

  // Manual exact typing of a live product with an unknown storefront status is
  // blocked exactly like a picked result.
  const typedUnknown = commitQuoteEditorSkuDraft(rows, 1, 'cw9174e-rtg', searchOk(liveUnknown));
  assert.equal(typedUnknown.changed, true);
  assert.deepEqual(typedUnknown.exact, { sku: 'CW9174E-RTG', availability: 'unknown', source: 'zoho' });
  assert.equal(typedUnknown.rows[1].sku, 'CW9174E-RTG');
  assert.equal(typedUnknown.rows[1].availability, 'unknown');
  assert.equal(typedUnknown.rows[1].productSource, 'zoho');
  assert.equal(quoteRouteForRows(typedUnknown.rows).route, 'blocked');
  assert.equal(quoteTextFromEditorRows(typedUnknown.rows, '').ok, false);

  const typedEcomm = commitQuoteEditorSkuDraft(rows, 1, 'CW9174E-RTG', searchOk(liveEcomm));
  assert.equal(typedEcomm.rows[1].availability, 'ecomm');
  assert.equal(quoteRouteForRows(typedEcomm.rows).route, 'ecomm');
  const typedZohoOnly = commitQuoteEditorSkuDraft(rows, 1, 'CW9174E-RTG', searchOk(liveZohoOnly));
  assert.equal(typedZohoOnly.rows[1].availability, 'zoho_only');
  assert.equal(quoteRouteForRows(typedZohoOnly.rows).route, 'zoho_only');

  // A typed SKU the search does not know is selected-but-unclassified and
  // stays blocked until an exact result classifies it.
  const typedUnproven = commitQuoteEditorSkuDraft(rows, 1, 'MX67', searchOk(liveUnknown));
  assert.equal(typedUnproven.exact, null);
  assert.equal(typedUnproven.rows[1].availability, 'unknown');
  assert.equal(typedUnproven.rows[1].productSource, 'manual');
  assert.equal(quoteRouteForRows(typedUnproven.rows).route, 'blocked');
  // A post-commit exact check then classifies it, including to unknown.
  const classified = resolveRowAvailabilityFromSearch(typedUnproven.rows, 1, 'MX67', searchOk({ ...liveUnknown, sku: 'MX67' }));
  assert.equal(classified.changed, true);
  assert.equal(quoteRouteForRows(classified.rows).route, 'blocked');

  // Clearing the draft clears the row without touching its neighbours.
  const cleared = commitQuoteEditorSkuDraft(typedEcomm.rows, 1, '', null);
  assert.equal(cleared.changed, true);
  assert.deepEqual(cleared.rows[1], { sku: '', qty: 1, unresolved: false });
  assert.deepEqual(cleared.rows[0], rows[0]);
  assert.equal(commitQuoteEditorSkuDraft(rows, 7, 'MX67', null).ok, false);
});

test('exact search matching ignores prefix and inactive results and never classifies beyond the proof', () => {
  assert.equal(exactProductSearchMatch(searchOk({ ...liveEcomm, sku: 'CW9174E-RTG-1' }), 'CW9174E-RTG'), null);
  assert.equal(exactProductSearchMatch(searchOk({ ...liveEcomm, active: false }), 'CW9174E-RTG'), null);
  assert.equal(exactProductSearchMatch({ ok: false, results: [liveEcomm] }, 'CW9174E-RTG'), null);
  assert.deepEqual(exactProductSearchMatch(searchOk({ sku: 'cw9174e-rtg', source: 'zoho', availability: 'weird' }), 'CW9174E-RTG'), {
    sku: 'CW9174E-RTG', availability: 'unknown', source: 'zoho',
  });
  assert.deepEqual(exactProductSearchMatch(searchOk({ sku: 'MR36-HW', availability: 'ecomm' }), 'mr36-hw'), {
    sku: 'MR36-HW', availability: 'ecomm', source: 'zoho',
  });
});

test('installed editor keeps typing local, makes unknown selectable, and shows Checking/Retry with a blocked action', () => {
  babel.transformSync(editorSource, { filename: 'SkuQuantityEditor.jsx', presets: [presetReact], babelrc: false, configFile: false });
  // The SKU onChange handler only updates the draft and schedules a search.
  const onChange = editorSource.match(/onChange=\{\(event\) => \{\s*\/\/ Draft only[\s\S]*?\}\}/);
  assert.ok(onChange, 'SKU input onChange draft handler present');
  assert.doesNotMatch(onChange[0], /patchRow|publish\(/);
  assert.match(onChange[0], /setDraft\(\{ index, text, baseSku: sku\.trim\(\)\.toUpperCase\(\) \}\)/);
  assert.match(onChange[0], /scheduleSearch\(index, text\)/);
  assert.match(editorSource, /value=\{inputValue\}/);
  assert.match(editorSource, /const inputValue = isDrafting \? draft\.text : sku;/);
  // Stable identity: a draft is bound to the row's canonical SKU at draft start
  // and is discarded, never committed, if the row under that index changed.
  assert.match(editorSource, /function draftBelongsTo\(index\) \{\s*return draft\.index === index\s*&& draft\.baseSku === String\(values\[index\]\?\.sku \|\| ''\)\.trim\(\)\.toUpperCase\(\);/);
  assert.match(editorSource, /const isDrafting = draftBelongsTo\(index\);/);
  assert.match(editorSource, /if \(!draftBelongsTo\(index\)\) \{[\s\S]*?setDraft\(EMPTY_DRAFT\);\s*return;\s*\}/);
  // Commit paths: picked result, Enter, leaving the field; Escape reverts.
  assert.match(editorSource, /commitQuoteEditorSkuDraft\(values, index, text, response, \{ allowHaLicenseRatio \}\)/);
  assert.match(editorSource, /selectQuoteEditorProduct\(values, index, product, \{ allowHaLicenseRatio \}\)/);
  assert.match(editorSource, /event\.key === 'Enter'/);
  assert.match(editorSource, /event\.key === 'ArrowDown' \|\| event\.key === 'ArrowUp'/);
  assert.match(editorSource, /event\.key === 'Escape'/);
  assert.match(editorSource, /onBlur=\{\(\) => \{\s*commitDraft\(index\);/);
  assert.match(editorSource, /role="combobox"/);
  assert.match(editorSource, /role="listbox"/);
  assert.match(editorSource, /role="option"/);
  assert.match(editorSource, /aria-activedescendant=/);
  // Unknown live rows are selectable (no disabled option) and explained.
  assert.doesNotMatch(editorSource, /disabled=\{product\.availability === 'unknown'\}/);
  assert.match(editorSource, /eCommerce status pending — selectable, checked after you pick it/);
  assert.match(editorSource, /if \(product\.availability === 'unknown'\) checkAvailability\(index, product\.sku\);/);
  // Compact Checking / Retry state and the fail-closed action.
  assert.match(editorSource, /Checking availability…/);
  assert.match(editorSource, /aria-label=\{`Retry availability check row \$\{index \+ 1\}`\}/);
  assert.match(editorSource, /resolveRowAvailabilityFromSearch\(valuesRef\.current, index, sku, response\)/);
  assert.match(editorSource, /const routeBlocked = route\.route === 'blocked';/);
  assert.match(editorSource, /const updateBlocked = draftActive \|\| !validation\.ok \|\| routeBlocked \|\| !preflight\.ok;/);
  assert.match(editorSource, /disabled=\{disabled \|\| !dirty \|\| updateBlocked\}/);
  assert.match(editorSource, /aria-label=\{`Quote editor \$\{readiness\.kind\}`\}/);
  // The stale-identity guard still routes removals and patches through the reducer.
  assert.match(editorSource, /removeLinkedQuoteRow\(values, index, \{ allowHaLicenseRatio \}\)/);
  assert.match(editorSource, /applyLinkedQuoteRowPatch\(values, index, patch, \{ allowHaLicenseRatio \}\)/);
});

test('ChatPanel routes Generate/Continue through the shared matrix helper', () => {
  assert.match(chatPanelSource, /quoteRouteForRows,\n/);
  assert.match(chatPanelSource, /msg\.manualQuoteBuilder === true && quoteRouteForRows\(rows\)\.route === 'zoho_only'\s*\? startZohoOnlyManualQuote\(msg, rows\)/);
  assert.match(chatPanelSource, /quoteRouteForRows\(draftRows\)\.route === 'zoho_only'\s*\? 'Continue to Zoho review'/);
  assert.doesNotMatch(chatPanelSource, /rows\.some\(\(row\) => row\?\.availability === 'zoho_only'\)/);
});
