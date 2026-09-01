import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import {
  blankQuoteEditorRows,
  quoteTextFromEditorRows,
  quoteEditorHasSkuInput,
  quoteEditorRowsFromIntake,
} from './src/sidebar/components/sku-editor-core.mjs';

const chatSource = fs.readFileSync(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');
const quoteSource = fs.readFileSync(new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url), 'utf8');

function sourceSlice(startMarker, endMarker) {
  const start = chatSource.indexOf(startMarker);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  const end = chatSource.indexOf(endMarker, start);
  assert.ok(end > start, `missing source marker: ${endMarker}`);
  return chatSource.slice(start, end);
}

test('manual Create Quote starts with a fresh blank controlled row', () => {
  const first = blankQuoteEditorRows();
  const second = blankQuoteEditorRows();
  assert.deepEqual(first, [{ sku: '', qty: 1, unresolved: false }]);
  assert.notEqual(first, second);
  assert.equal(quoteEditorHasSkuInput(first), false);
  assert.equal(quoteEditorHasSkuInput([{ sku: '   ', qty: 9 }]), false);
  assert.equal(quoteEditorHasSkuInput([{ sku: 'mx67', qty: 1 }]), true);
});

test('Gmail intake becomes editable rows without merging distinct tier intent', () => {
  assert.deepEqual(quoteEditorRowsFromIntake([
    { status: 'resolved', sku: 'MX67', qty: 1, tier: 'SEC' },
    { status: 'resolved', sku: 'MX67', qty: 2, tier: 'ENT' },
    { status: 'resolved', sku: 'LIC-ENT-3YR', qty: 2 },
  ]), [
    { sku: 'MX67', qty: 1, unresolved: false, synthetic: false, tier: 'security' },
    { sku: 'MX67', qty: 2, unresolved: false, synthetic: false, tier: 'enterprise' },
    { sku: 'LIC-ENT-3YR', qty: 2, unresolved: false, synthetic: false },
  ]);
});

test('Gmail intake preserves per-row hardware-only intent and fails closed on malformed tier', () => {
  assert.deepEqual(quoteEditorRowsFromIntake([
    { status: 'resolved', sku: 'MX64', qty: 1, tier: '', hardwareOnly: true },
    { status: 'resolved', sku: 'MR44', qty: 2, tier: 'ENT' },
  ]), [
    { sku: 'MX64', qty: 1, unresolved: false, synthetic: false, tier: 'none' },
    { sku: 'MR44', qty: 2, unresolved: false, synthetic: false, tier: 'enterprise' },
  ]);
  assert.deepEqual(quoteEditorRowsFromIntake([
    { status: 'resolved', sku: 'MX67', qty: 1, tier: 'BOGUS' },
  ]), []);
});

test('manual row order is preserved in the canonical quote request', () => {
  const ordered = quoteTextFromEditorRows([
    { sku: 'MR44', qty: 2 },
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 4 },
  ]);
  assert.equal(ordered.ok, true, ordered.error);
  assert.equal(ordered.text, '2 MR44\n1 MX67\n4 LIC-ENT-3YR');

  const moved = quoteTextFromEditorRows([
    { sku: 'LIC-ENT-3YR', qty: 4 },
    { sku: 'MR44', qty: 2 },
    { sku: 'MX67', qty: 1 },
  ]);
  assert.equal(moved.ok, true, moved.error);
  assert.equal(moved.text, '4 LIC-ENT-3YR\n2 MR44\n1 MX67');
});

test('manual opening and Gmail population contain no quote, chat, or CRM execution', () => {
  assert.match(chatSource, /\{ label: 'Create Quote', action: 'manual-ecomm-quote' \}/);
  const manual = sourceSlice('function startManualEcommQuote', 'async function populateManualQuoteFromGmail');
  assert.match(manual, /blankQuoteEditorRows\(\)/);
  assert.doesNotMatch(manual, /sendToBackground|runQuote|CHAT_HANDOFF|ONESHOT_PLAN|ONESHOT_EXECUTE/);

  const populate = sourceSlice('async function populateManualQuoteFromGmail', 'function resolveIntakeLine');
  assert.match(populate, /MSG\.GET_FULL_EMAIL_CONTEXT/);
  assert.match(populate, /MSG\.ONESHOT_INTAKE/);
  assert.match(populate, /quoteEditorHasSkuInput\(quoteDraftRows\(msg\)\)/);
  assert.match(populate, /quoteEditorRowsFromIntake/);
  assert.doesNotMatch(populate, /runQuote|buildEcommQuoteFromIntake|CHAT_HANDOFF|ONESHOT_PLAN|ONESHOT_EXECUTE/);
});

test('manual card exposes optional Gmail fill, Zoho product search, and explicit Generate quote', () => {
  assert.match(chatSource, /'Populate from Gmail context'/);
  assert.match(chatSource, /Existing manual SKU rows are never overwritten/);
  assert.match(chatSource, /onProductSearch=\{msg\.restored \? undefined : searchQuoteProducts\}/);
  assert.match(chatSource, /quoteUpdateLabel=[\s\S]{0,500}'Generate quote'/);
  assert.match(quoteSource, /quoteUpdateLabel = 'Update quote'/);
  assert.match(quoteSource, /updateLabel=\{suggestions\.length > 0 \? 'Apply correction and update quote' : quoteUpdateLabel\}/);
  assert.match(chatSource, /'Continue to Zoho review'/);
  assert.match(chatSource, /startZohoOnlyManualQuote\(msg, rows\)/);
  assert.match(chatSource, /Zoho-only cart handed to the review card below/);
});

test('ordinary typed chat quote routing remains available and independent', () => {
  assert.match(chatSource, /sendToBackground\(MSG\.CHAT_HANDOFF/);
  assert.match(chatSource, /runAndPushQuote/);
  assert.match(chatSource, /handleSendMessage\(overrideText\)/);
});
