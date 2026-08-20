import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

import {
  applySkuSuggestion,
  normalizeSkuEditorRows,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';

const require = createRequire(import.meta.url);
const babel = require('@babel/core');
const presetEnv = require('@babel/preset-env');
const presetReact = require('@babel/preset-react');

const quoteResultPath = new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url);
const editorPath = new URL('./src/sidebar/components/SkuQuantityEditor.jsx', import.meta.url);
const chatPanelPath = new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url);

test('strict editor normalization rejects partial invalid input and merges exact duplicates', () => {
  assert.deepEqual(normalizeSkuEditorRows([
    { sku: 'mt12', qty: '1' },
    { sku: 'MT12', qty: 2 },
    { sku: 'MT10', qty: 1 },
  ]).rows, [
    { sku: 'MT12', qty: 3, unresolved: false },
    { sku: 'MT10', qty: 1, unresolved: false },
  ]);
  const invalid = normalizeSkuEditorRows([{ sku: 'MT12', qty: 1 }, { sku: '', qty: 2 }]);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.rows, []);
});

test('a suggestion replacement retains every unrelated SKU and original quantity', () => {
  const rows = applySkuSuggestion([
    { sku: 'C9300-24P', qty: 2, unresolved: true },
    { sku: 'MT12', qty: 3 },
    { sku: 'MT10', qty: 4 },
  ], { input: 'C9300-24P', suggest: ['C9300-24P-M'] }, 'apply');
  assert.deepEqual(rows.map(({ sku, qty }) => ({ sku, qty })), [
    { sku: 'C9300-24P-M', qty: 2 },
    { sku: 'MT12', qty: 3 },
    { sku: 'MT10', qty: 4 },
  ]);
});

test('quote rebuild emits exact quantity lines and preserves hardware-only intent safely', () => {
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX105', qty: 2 },
    { sku: 'MX85', qty: 2 },
  ], 'quote these hardware only');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, '2 MX105\n2 MX85\nhardware only');

  const conflict = quoteTextFromEditorRows([{ sku: 'LIC-MX105-ENT-3Y', qty: 1 }], 'hardware only');
  assert.equal(conflict.ok, false);
  assert.match(conflict.error, /cannot include an explicit license SKU/i);

  const added = quoteTextFromEditorRows([
    { sku: 'MX85', qty: 2 },
    { sku: 'MX75', qty: 1 },
  ], 'Quote 2 MX85 hardware only');
  assert.equal(added.ok, true);
  assert.equal(added.text, '2 MX85\n1 MX75\nhardware only');
});

test('quote card hides every stale link and CRM action while rows are dirty or unresolved', () => {
  const source = readFileSync(quoteResultPath, 'utf8');
  assert.match(source, /quoteActionsBlocked = busy \|\| draftDirty \|\| suggestions\.length > 0/);
  assert.match(source, /urls\.length > 0 && !quoteActionsBlocked/);
  assert.match(source, /Existing links, term selection, and Zoho conversion are hidden/);
});

// 2026-08-19: the requirements object now also carries hardwareOnlySkus, so the
// per-row "None" rows are known to the verifier. The gate itself is unchanged.
test('chat rebuild uses newest-response and canonical URL-composition gates', () => {
  const source = readFileSync(chatPanelPath, 'utf8');
  assert.match(source, /quoteUpdateSequenceRef/);
  assert.match(source, /verifyStratusOrderUrlOptions\(result\?\.urls, committedRows, \{\s*\.\.\.quoteVerificationRequirements\(msg\)/);
  assert.match(source, /applyExplicitMxWarmSpareToQuoteOptions\(candidate\?\.urls, explicitQuoteHaRequested\(msg\)\)/);
  assert.match(source, /response\?\.result/);
  assert.match(source, /runQuote\(prepared\.text, newQuotePersonId\(\)\)/,
    'canonical editor rebuilds must not reuse conversational quote history');
  assert.match(source, /draftDirty: false/);
  assert.match(source, /result: \{ \.\.\.candidate, urls: \[\] \}/);
  assert.match(source, /A user edit invalidated this response while it was in flight[\s\S]{0,300}setLoading\(false\)/);
  assert.match(source, /msg\.restored === true[\s\S]{0,1200}Gmail intent, participants, and message provenance are not retained/);
});

test('one-shot product edits force re-plan and cannot execute stale products', () => {
  const source = readFileSync(chatPanelPath, 'utf8');
  assert.match(source, /onReplan\(\{\s*skus,\s*include_licenses: !hardwareOnly,\s*hardware_only: hardwareOnly,\s*\}\)/,
    'edited-product re-plan must recompute skus and pass explicit license intent (not reuse a stale normalized.lines snapshot)');
  assert.match(source, /disabled=\{hard\.length > 0 \|\| busy \|\| productDirty\}/);
  assert.match(source, /Product editing is unavailable after an Execute attempt/);
  assert.match(source, /Execute remains disabled/);
  assert.match(source, /nextOneshotQuoteOptionState/);
  assert.match(source, /productChanging: isProductChangingOneshotOverride\(next\)/);
  assert.match(source, /quoteOptionsSnapshotHash !== currentSnapshotHash/);
  assert.match(source, /boundOptionSelection: true/);
});

test('product autocomplete consumes only the sanitized result shape and JSX parses', () => {
  const editorSource = readFileSync(editorPath, 'utf8');
  const chatSource = readFileSync(chatPanelPath, 'utf8');
  assert.match(editorSource, /Array\.isArray\(response\.results\)/);
  assert.doesNotMatch(editorSource, /product_id|product_name/);
  assert.match(chatSource, /MSG\.PRODUCT_SEARCH/);

  for (const [filename, source] of [
    ['QuoteResult.jsx', readFileSync(quoteResultPath, 'utf8')],
    ['SkuQuantityEditor.jsx', editorSource],
    ['ChatPanel.jsx', chatSource],
  ]) {
    assert.doesNotThrow(() => babel.transformSync(source, {
      filename,
      presets: [[presetEnv, { targets: { chrome: '120' } }], [presetReact, { runtime: 'automatic' }]],
      babelrc: false,
      configFile: false,
    }));
  }
});
