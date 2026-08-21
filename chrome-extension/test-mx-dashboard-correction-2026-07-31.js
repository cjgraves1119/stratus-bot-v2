// Extension-side wiring regressions for personal error_reports #9 and #10.
// Source-level checks are used because ChatPanel is a bundled React component.
//
// Run: node chrome-extension/test-mx-dashboard-correction-2026-07-31.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const read = (relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8');
const chat = read('src/sidebar/panels/ChatPanel.jsx');
const quoteClient = read('src/lib/quote-client.js');
const quoteResult = read('src/sidebar/components/QuoteResult.jsx');
const backgroundApi = read('src/background/api-client.js');
const background = read('src/background/index.js');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed++;
    console.log('  ❌ ' + name + '\n     ' + err.message);
  }
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.ok(start >= 0, name + ' not found');
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error('could not extract ' + name);
}

test('MX edition correction detector accepts the worker-supported bounded phrases', () => {
  const fn = Function('return (' + extractFunction(chat, 'isMxEditionQuoteFollowUp') + ')')();
  for (const phrase of [
    'ENT',
    'ENT instead',
    'actually Enterprise',
    'change SEC to ENT',
    'correct SEC to Enterprise',
    'switch the licenses to SDW',
  ]) {
    assert.strictEqual(fn(phrase), true, 'not recognized: ' + phrase);
  }
  for (const phrase of [
    'change the Zoho quote to Enterprise',
    'send an email about ENT',
    'Enterprise for this account',
    'change SEC to ENT and update CRM',
  ]) {
    assert.strictEqual(fn(phrase), false, 'over-broad match: ' + phrase);
  }
});

test('prior quote text travels through every extension hop to /api/quote', () => {
  assert.ok(/runQuote\(skuText, personId, priorQuoteText = null\)/.test(quoteClient));
  assert.ok(/priorQuoteText: priorQuoteText \|\| undefined/.test(quoteClient));
  assert.ok(/generateQuote\(skuText, personId, priorQuoteText\)/.test(backgroundApi));
  assert.ok(/priorQuoteText: priorQuoteText \|\| undefined/.test(backgroundApi));
  assert.ok(/MSG\.GENERATE_QUOTE\]: async \(\{ skuText, personId, priorQuoteText \}\)/.test(background));
  assert.ok(/api\.generateQuote\(skuText, personId, priorQuoteText\)/.test(background));
});

test('dashboard ambiguity is returned as a clarification before SKU fallback', () => {
  const start = quoteClient.indexOf('export async function analyzeImage');
  const end = quoteClient.indexOf('\nexport ', start + 1);
  const segment = quoteClient.slice(start, end > start ? end : quoteClient.length);
  const recovery = segment.indexOf("kind: 'recovery'");
  const clarification = segment.indexOf('res?.needsClarification');
  const directQuote = segment.indexOf('if (res && Array.isArray(res.quoteUrls)');
  const skuFallback = segment.indexOf("kind: 'skus'");
  assert.ok(clarification >= 0, 'clarification branch missing');
  assert.ok(directQuote > clarification, 'clarification must precede direct URL handling');
  assert.ok(skuFallback > clarification, 'clarification must precede ordinary SKU fallback');
  assert.ok(/kind: 'clarification'/.test(segment));
});

test('clarification card retains exact parsed rows for the next deterministic turn', () => {
  assert.ok(/kind: 'quote-clarification'/.test(chat));
  assert.ok(/\[Dashboard quote blocked pending MX edition\]/.test(chat));
  assert.ok(/Detected rows:/.test(chat));
  assert.ok(/msgs\[i\]\.kind === 'quote' \|\| msgs\[i\]\.kind === 'quote-clarification'/.test(chat));
  assert.ok(/messageHistoryText\(msgs\[lastQuoteIdx\]\)/.test(chat));
});

test('eligible correction bypasses CRM even on Zoho before takeover, but never after takeover', () => {
  const start = chat.indexOf('function handleSend(');
  const end = chat.indexOf('\n  // ── Manual CRM search', start);
  const segment = chat.slice(start, end);
  assert.ok(/mxEditionCorrection/.test(segment), 'MX correction gate missing');
  assert.ok(/const mxEditionCorrection = hasPriorQuote && !zohoTookOver && isMxEditionQuoteFollowUp\(text\)/.test(segment), 'correction is not bounded by prior quote + takeover');
  assert.ok(/const ecommAllowed = mxEditionCorrection \|\| !onZohoRecord \|\| isExplicitEcommUrlAsk\(text\)/.test(segment), 'Zoho-page exception is not limited to the correction gate');
  assert.ok(/runAndPushQuote\(text, \{ priorQuoteText: mxEditionCorrection/.test(segment), 'correction does not call deterministic quote helper');
});

test('no deterministic quote result can auto-open the one-shot plan route', () => {
  const start = chat.indexOf('async function runAndPushQuote');
  const end = chat.indexOf('async function handleQuoteSuggestion', start);
  const segment = chat.slice(start, end);
  assert.ok(!/startOneshotFromUrl|ONESHOT_PLAN|isOneshotAutoPlanEligible/.test(segment));
  assert.ok(!/function isOneshotAutoPlanEligible|export function isOneshotAutoPlanEligible/.test(quoteClient));
  assert.ok(/Create Zoho CRM quote from selected/.test(quoteResult), 'explicit consent button must remain');
  assert.ok(/disabled=\{busy \|\| !hasExplicitTermSelection\}/.test(quoteResult), 'Zoho conversion must require an explicitly selected quote option');
});

test('quote response mapping behaviorally preserves an inert typed recovery', () => {
  const toUrlObjSource = extractFunction(quoteClient, 'toUrlObj');
  const mapSource = extractFunction(quoteClient, 'mapQuoteResponse');
  const map = Function(`${toUrlObjSource}; return (${mapSource});`)();
  const recovery = {
    kind: 'complexity_exhausted', code: 'retry_deterministic_quote',
    title: 'Use the deterministic quote route', detail: 'Use exact SKUs.', write_state: 'unknown',
  };
  const mapped = map({ quoteUrls: [], recovery, error: 'Use exact SKUs.', handlerType: 'complexity-recovery' });
  assert.ok(mapped.result, JSON.stringify(mapped));
  assert.deepStrictEqual(mapped.result.urls, []);
  assert.deepStrictEqual(mapped.result.recovery, recovery);
  assert.strictEqual(mapped.result.handlerType, 'complexity-recovery');
});

test('MR-ENT plus hardware is merged into one full cart per term', () => {
  const toUrlObjSource = extractFunction(quoteClient, 'toUrlObj');
  const mergeSource = extractFunction(quoteClient, 'mergeMrEntIntoQuoteOptions');
  const mapSource = extractFunction(quoteClient, 'mapQuoteResponse');
  const map = Function(`const ORDER_BASE = 'https://stratusinfosystems.com/order/'; ${toUrlObjSource}; ${mergeSource}; return (${mapSource});`)();
  const mapped = map({
    quoteUrls: [1, 3, 5].map((term) => ({
      label: `${term}-Year Co-Term`,
      url: `https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-${term}YR&qty=2,2`,
    })),
    parsedItems: [{ sku: 'MR44', qty: 2 }],
  }, 3);
  assert.deepStrictEqual(mapped.result.parsed, [
    { baseSku: 'MR44', qty: 2 },
    { baseSku: 'MR-ENT', qty: 3 },
  ]);
  assert.strictEqual(mapped.result.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    assert.ok(mapped.result.urls[index].url.includes(`item=MR44-HW,LIC-ENT-${term}YR`));
    assert.ok(mapped.result.urls[index].url.includes('qty=2,5'));
  }
});

test('structured complexity recovery is stored and rendered without an automatic retry action', () => {
  assert.ok(/response\.reply \|\| response\.suggestions \|\| response\.recovery/.test(chat));
  assert.ok(/recovery: response\.recovery \|\| null/.test(chat));
  assert.ok(/msg\.role === 'assistant' && msg\.recovery/.test(chat));
  assert.ok(/msg\.recovery\.write_state === 'possible'/.test(chat));
  const recoveryRender = chat.slice(chat.indexOf("msg.role === 'assistant' && msg.recovery"), chat.indexOf('{msg.usedTools', chat.indexOf("msg.role === 'assistant' && msg.recovery")));
  assert.ok(!/handleSendMessage|runAndPushQuote|ONESHOT_EXECUTE/.test(recoveryRender), 'recovery card must not auto-retry or mutate');
  assert.ok(/result\.recovery/.test(quoteResult), 'quote recovery renderer missing');
  assert.ok(!/onClick=.*recovery|recovery.*onClick/.test(quoteResult), 'quote recovery renderer must stay inert');
  assert.ok(/out\.kind === 'recovery'/.test(chat), 'image recovery is not routed to an inert chat card');
});

console.log('');
console.log(failed === 0
  ? '✅ ' + passed + '/' + (passed + failed) + ' assertions passed'
  : '❌ ' + failed + ' FAILED, ' + passed + ' passed');
process.exit(failed === 0 ? 0 : 1);
  assert.ok(recovery >= 0 && recovery < clarification, 'typed recovery must precede clarification/SKU fallbacks');
