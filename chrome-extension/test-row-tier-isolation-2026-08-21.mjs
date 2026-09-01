import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyLinkedQuoteRowPatch,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const editorSource = fs.readFileSync(path.join(here, 'src/sidebar/components/SkuQuantityEditor.jsx'), 'utf8');

test('row tier selector never publishes its value through the legacy global callback', () => {
  assert.doesNotMatch(editorSource, /onTierChange\?\.\(event\.target\.value\)/);
  assert.match(editorSource, /onChange=\{\(event\) => patchRow\(index, \{ tier: event\.target\.value \}\)\}/);
});

test('one explicit MX tier synchronizes every compatible MX family row', () => {
  const rows = applyLinkedQuoteRowPatch([
    { sku: 'MX67', qty: 1, tier: '' },
    { sku: 'MX75', qty: 1, tier: '' },
  ], 0, { tier: 'enterprise' });

  assert.equal(rows[0].tier, 'enterprise');
  assert.equal(rows[1].tier, 'enterprise');

  const result = quoteTextFromEditorRows(rows, 'quote 1 MX67 and 1 MX75');

  assert.equal(result.ok, true, result.error);
  assert.match(result.text, /^1 MX67 enterprise$/m);
  assert.match(result.text, /^1 MX75 enterprise$/m);
});

test('an externally supplied mixed MX family state fails closed', () => {
  const result = quoteTextFromEditorRows([
    { sku: 'MX67', qty: 1, tier: 'enterprise' },
    { sku: 'MX75', qty: 1, tier: 'advanced-security' },
  ], 'quote 1 MX67 enterprise and 1 MX75 advanced security');

  assert.equal(result.ok, false);
  assert.equal(result.errors[0].code, 'mixed_family_license_tier');
});
