import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

import { resolveQuoteVariantCorrection } from './src/sidebar/components/quote-variant-correction.mjs';
import { quoteTextFromEditorRows } from './src/sidebar/components/sku-editor-core.mjs';

const source = fs.readFileSync(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');
const catalog = new Set([
  'C9200L-24P-4G-M',
  'C9200L-24P-4X-M',
  'C9200L-48P-4G-M',
  'C9200L-48P-4X-M',
]);

const baseRows = [{
  sku: 'C9200L-24P-4G-M',
  qty: 1,
  tier: 'advanced',
  licenseIntent: 'paired',
}];

test('an explicit 4G to 4X card correction swaps only the matching active SKU', () => {
  const result = resolveQuoteVariantCorrection(baseRows, 'change the 4G to the 4X', { activeSkus: catalog });
  assert.equal(result.kind, 'apply');
  assert.equal(result.sourceSku, 'C9200L-24P-4G-M');
  assert.equal(result.targetSku, 'C9200L-24P-4X-M');
  assert.deepEqual(result.rows, [{
    sku: 'C9200L-24P-4X-M',
    qty: 1,
    tier: 'advanced',
    licenseIntent: 'paired',
    unresolved: false,
  }]);

  const prepared = quoteTextFromEditorRows(result.rows, '');
  assert.equal(prepared.ok, true);
  assert.match(prepared.text, /1 C9200L-24P-4X-M advanced/i);
  assert.doesNotMatch(prepared.text, /4G-M/i);
});

test('an explicit full-SKU 4G to 4X correction also stays in the deterministic card path', () => {
  const result = resolveQuoteVariantCorrection(
    baseRows,
    'change C9200L-24P-4G-M to C9200L-24P-4X-M',
    { activeSkus: catalog },
  );
  assert.equal(result.kind, 'apply');
  assert.equal(result.rows[0].sku, 'C9200L-24P-4X-M');
  assert.equal(result.rows[0].qty, 1);
});

test('an explicit quantity can accompany an unambiguous variant correction', () => {
  const result = resolveQuoteVariantCorrection(baseRows, 'change the 4G to the 4X and set quantity 4', { activeSkus: catalog });
  assert.equal(result.kind, 'apply');
  assert.equal(result.rows[0].sku, 'C9200L-24P-4X-M');
  assert.equal(result.rows[0].qty, 4);
});

test('ordinary 4x quote quantities are never interpreted as a hardware-variant correction', () => {
  const plainRequest = resolveQuoteVariantCorrection(baseRows, 'quote 4x MX67', { activeSkus: catalog });
  assert.equal(plainRequest.kind, 'no-match');

  const explicitSkuQuantity = resolveQuoteVariantCorrection(baseRows, 'make a quote for 4 x C9200L-24P-4G-M', { activeSkus: catalog });
  assert.equal(explicitSkuQuantity.kind, 'no-match');
});

test('a bare 4X request stays unchanged and asks whether it means a model or quantity', () => {
  for (const request of ['change to 4X', 'make it 4x']) {
    const result = resolveQuoteVariantCorrection(baseRows, request, { activeSkus: catalog });
    assert.equal(result.kind, 'clarify', request);
    assert.strictEqual(result.rows, baseRows);
    assert.match(result.message, /quantity of 4/i);
    assert.match(result.message, /C9200L-24P-4X-M/i);
  }
});

test('multiple matching 4G rows, absent source rows, and inactive targets never mutate the card', () => {
  const multiple = resolveQuoteVariantCorrection([
    ...baseRows,
    { sku: 'C9200L-48P-4G-M', qty: 2 },
  ], 'change the 4G to the 4X', { activeSkus: catalog });
  assert.equal(multiple.kind, 'clarify');
  assert.match(multiple.message, /2 quote rows/i);

  const absent = resolveQuoteVariantCorrection([{ sku: 'MX67', qty: 1 }], 'change the 4G to the 4X', { activeSkus: catalog });
  assert.equal(absent.kind, 'clarify');
  assert.match(absent.message, /could not find/i);

  const inactive = resolveQuoteVariantCorrection(baseRows, 'change the 4G to the 4X', {
    activeSkus: new Set(['C9200L-24P-4G-M']),
  });
  assert.equal(inactive.kind, 'clarify');
  assert.match(inactive.message, /not an active catalog SKU/i);
});

test('ChatPanel routes variant decisions before general chat, rebuilds the same card, and recognizes direct Zoho phrasing', () => {
  assert.match(source, /resolveQuoteVariantCorrection\(quoteDraftRows\(priorQuote\), text, \{ activeSkus: ACTIVE_QUOTE_CATALOG_SKUS \}\)/);
  assert.match(source, /if \(quoteVariantCorrection\) \{/);
  assert.match(source, /applyDeterministicQuoteVariantCorrection\(priorQuote, quoteVariantDecision, text, \{ requestZoho: zohoReviewRequest \}\)/);
  assert.match(source, /await rebuildQuoteMessage\(msg, decision\.rows, \{ sourceText: msg\?\.skuText \|\| '' \}\)/);
  assert.match(source, /(?:make\|turn\|convert).*into/);
  assert.match(source, /function isExplicitNewEcommQuoteRequest/);
  assert.match(source, /!explicitNewEcommQuote && isQuoteEditorCorrectionRequest\(text\)/);
  assert.match(source, /const customerContext = quoteCustomerContextForHandoff\(sourceMessage\)/);
  assert.match(source, /capturedParticipants: customerContext\.participants/);

  const dispatchStart = source.indexOf('function handleSend(overrideText)');
  const dispatchEnd = source.indexOf('// ── Manual CRM search', dispatchStart);
  const dispatch = source.slice(dispatchStart, dispatchEnd);
  assert.ok(dispatch.indexOf('if (quoteVariantCorrection)') < dispatch.indexOf('handleSendMessage(overrideText)'));
});
