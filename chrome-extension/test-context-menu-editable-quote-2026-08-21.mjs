import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chatSource = await readFile(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');
const quoteSource = await readFile(new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url), 'utf8');

test('right-click SKU and order-URL quotes open as an editable draft', () => {
  const contextStart = chatSource.indexOf('// "Quote these SKUs with Stratus" from the right-click selection menu.');
  const contextEffect = chatSource.slice(
    contextStart,
    chatSource.indexOf('// Email quick-actions deep-linked from keyboard shortcuts.', contextStart),
  );
  assert.ok(contextEffect.includes('runAndPushQuote(navData.quoteSkuText, {'));
  assert.ok(contextEffect.includes('editable: true'));
  assert.ok(contextEffect.includes("source: 'context-menu'"));

  const runner = chatSource.slice(
    chatSource.indexOf('async function runAndPushQuote'),
    chatSource.indexOf('function quoteDraftRows', chatSource.indexOf('async function runAndPushQuote')),
  );
  assert.match(runner, /const draftRows = editable \? editableRowsFromResult\(candidate\) : undefined/);
  assert.match(runner, /draftStatus: 'Parsed from the selected text/);
  assert.match(runner, /quoteSource: source \|\| 'editable-quote'/);
});

test('editable context-menu result still retains explicit Zoho review after term selection', () => {
  assert.match(quoteSource, /onSendToZoho && \(/);
  assert.match(quoteSource, /onClick=\{\(\) => hasExplicitTermSelection && onSendToZoho\(result, validSelectedIndexes\)\}/);
  assert.match(quoteSource, /<SkuQuantityEditor/);
  assert.match(chatSource, /onSendToZoho=\{msg\.restored \? undefined : \(result, selectedUrlIdx\) => handleSendQuoteToZoho\(msg, result, selectedUrlIdx\)\}/);
});
