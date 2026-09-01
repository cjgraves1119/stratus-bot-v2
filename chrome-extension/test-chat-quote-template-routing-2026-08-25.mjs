import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');

function slice(from, until) {
  const start = source.indexOf(from);
  assert.ok(start >= 0, `${from} must exist`);
  const end = source.indexOf(until, start);
  assert.ok(end > start, `${until} must follow ${from}`);
  return source.slice(start, end);
}

test('ordinary typed chat quotes always open as editable quote-card templates', () => {
  const quote = slice('async function runAndPushQuote', 'function quoteDraftRows');
  assert.match(quote, /editable = true/);
  assert.match(quote, /const draftRows = editable \? editableRowsFromResult\(candidate\) : undefined/);
  assert.match(quote, /quoteSource: source \|\| 'editable-quote'/);
});

test('natural-language quote corrections rebuild the current quote card through the verified editor path', () => {
  const correction = slice('async function applyNaturalLanguageQuoteCorrection', '// Picking a license tier');
  assert.match(correction, /runQuote\(correctionText, newQuotePersonId\(\), messageHistoryText\(msg\)\)/);
  assert.match(correction, /editableRowsFromResult/);
  assert.match(correction, /rebuildQuoteMessage\(msg, correctedRows/);
  assert.doesNotMatch(correction, /MSG\.CHAT_HANDOFF|MSG\.ONESHOT_EXECUTE/);
  assert.match(source, /const quoteEditorCorrection = hasPriorQuote/);
  assert.match(source, /applyNaturalLanguageQuoteCorrection\(priorQuote, text\)/);
});

test('dialogue requests for Zoho use the current reviewed quote and require a term before One Shot planning', () => {
  assert.match(source, /function isZohoQuoteReviewRequest/);
  assert.match(source, /function requestedQuoteTermYears/);
  assert.match(source, /const zohoReviewRequest = hasPriorQuote/);
  assert.match(source, /handleSendQuoteToZoho\(priorQuote, priorQuote\.result, selectedIndex\)/);
  assert.match(source, /Select a term on the current quote card to open its One Shot review/);
  const dispatch = slice('function handleSend(overrideText)', '// ── Manual CRM search');
  assert.ok(dispatch.indexOf('if (zohoReviewRequest)') < dispatch.indexOf('handleSendMessage(overrideText)'));
});
