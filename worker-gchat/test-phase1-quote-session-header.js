#!/usr/bin/env node
// Phase 1 (2026-05-12) regression tests:
//   - extractMostRecentQuoteRefFromHistory walks history in reverse and
//     pulls the latest assistant-emitted quote reference.
//   - buildMostRecentQuoteSessionHeader emits a header string with the
//     authoritative deferral wording ("active Account/Deal is parent
//     context, defer to THIS session quote").
//   - The header is wired into /api/chat-waterfall enrichment path so
//     gateway-routed traffic gets the same grounding as /api/chat.
//
// These tests use the same source-extraction pattern as
// test-quote-po-admin-workflow.js — load the module source, slice the helper
// functions, and execute them in a sandboxed scope.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in src/index.js`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} signature has body brace`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const extractMostRecentQuoteRefFromHistory = Function(
  `"use strict"; ${extractFunction('extractMostRecentQuoteRefFromHistory')}; return extractMostRecentQuoteRefFromHistory;`
)();

const buildMostRecentQuoteSessionHeader = Function(
  `"use strict";
   ${extractFunction('extractMostRecentQuoteRefFromHistory')}
   ${extractFunction('buildMostRecentQuoteSessionHeader')}
   return buildMostRecentQuoteSessionHeader;`
)();

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n     ${err.message}`);
    failed++;
  }
}

console.log('\n=== extractMostRecentQuoteRefFromHistory ===\n');

t('null/undefined/empty history returns null', () => {
  assert.equal(extractMostRecentQuoteRefFromHistory(null), null);
  assert.equal(extractMostRecentQuoteRefFromHistory(undefined), null);
  assert.equal(extractMostRecentQuoteRefFromHistory([]), null);
  assert.equal(extractMostRecentQuoteRefFromHistory('not-an-array'), null);
});

t('history with no quote references returns null', () => {
  const h = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi there, how can I help?' }
  ];
  assert.equal(extractMostRecentQuoteRefFromHistory(h), null);
});

t('extracts quote record id from Zoho URL', () => {
  const h = [
    { role: 'user', content: 'create quote for Electrocraft' },
    { role: 'assistant', content: 'Created Quote 2570562000404932151 — https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151' }
  ];
  const ref = extractMostRecentQuoteRefFromHistory(h);
  assert.ok(ref, 'returns a ref');
  assert.equal(ref.recordId, '2570562000404932151', 'extracts record id from URL');
});

t('extracts most recent quote when multiple are mentioned', () => {
  const h = [
    { role: 'assistant', content: 'Created Quote https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932148' },
    { role: 'user', content: 'now do another for Riverside' },
    { role: 'assistant', content: 'Created Quote https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151' }
  ];
  const ref = extractMostRecentQuoteRefFromHistory(h);
  assert.equal(ref.recordId, '2570562000404932151', 'most recent wins');
});

t('extracts from "Quote 123..." numeric form when URL missing', () => {
  const h = [
    { role: 'assistant', content: 'Done — Quote 2570562000404932200 is ready.' }
  ];
  const ref = extractMostRecentQuoteRefFromHistory(h);
  assert.equal(ref.recordId, '2570562000404932200');
});

t('user messages are ignored — only assistant emits matter', () => {
  const h = [
    { role: 'user', content: 'I made Quote 2570562000404932999 earlier — use that' },
    { role: 'assistant', content: 'OK, no quote yet.' }
  ];
  assert.equal(extractMostRecentQuoteRefFromHistory(h), null);
});

t('handles non-string content gracefully', () => {
  const h = [
    { role: 'assistant', content: null },
    { role: 'assistant', content: undefined },
    { role: 'assistant', content: { url: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932250' } }
  ];
  // Last entry serializes to JSON containing the URL, so it should match.
  const ref = extractMostRecentQuoteRefFromHistory(h);
  assert.equal(ref?.recordId, '2570562000404932250');
});

t('captures Quote_Number when present in addition to record id', () => {
  const h = [
    { role: 'assistant', content: 'Quote_Number: QU-12345 — https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932300' }
  ];
  const ref = extractMostRecentQuoteRefFromHistory(h);
  assert.equal(ref.recordId, '2570562000404932300');
  assert.equal(ref.quoteNumber, 'QU-12345');
});

console.log('\n=== buildMostRecentQuoteSessionHeader ===\n');

t('empty history returns empty string', () => {
  assert.equal(buildMostRecentQuoteSessionHeader([]), '');
  assert.equal(buildMostRecentQuoteSessionHeader(null), '');
});

t('history with no quote returns empty string', () => {
  const h = [{ role: 'assistant', content: 'no quote here' }];
  assert.equal(buildMostRecentQuoteSessionHeader(h), '');
});

t('builds header with [Session: Most recently worked quote ...] prefix', () => {
  const h = [
    { role: 'assistant', content: 'Created https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151' }
  ];
  const header = buildMostRecentQuoteSessionHeader(h);
  assert.ok(header.startsWith('[Session: Most recently worked quote'), `prefix: ${header.substring(0, 60)}`);
  assert.ok(header.includes('2570562000404932151'), 'includes record id');
  assert.ok(header.includes('https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151'), 'includes URL');
});

t('header explicitly defers Account/Deal pages to session quote', () => {
  const h = [
    { role: 'assistant', content: 'Created https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151' }
  ];
  const header = buildMostRecentQuoteSessionHeader(h);
  // The wording must explicitly say active Account/Deal is parent context,
  // not "the quote". This is the Phase 1 grounding fix.
  assert.ok(
    /active Account or Deal page is parent\/customer context|defer to THIS session quote/i.test(header),
    `header missing module-deferral wording: ${header}`
  );
});

t('header tells model NOT to ask which quote', () => {
  const h = [
    { role: 'assistant', content: 'Created https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404932151' }
  ];
  const header = buildMostRecentQuoteSessionHeader(h);
  assert.ok(/Do NOT ask which quote/i.test(header), 'forbids "which quote" follow-up');
});

console.log('\n=== /api/chat-waterfall integration ===\n');

t('chat-waterfall handler calls buildMostRecentQuoteSessionHeader (Phase 1 wire-up)', () => {
  // The source must include the helper invocation inside the /api/chat-waterfall
  // case block. Without this, gateway-routed traffic doesn't get the header.
  const waterfallStart = source.indexOf("case '/api/chat-waterfall':");
  assert.notEqual(waterfallStart, -1, '/api/chat-waterfall case block exists');

  // Find the end of this case block (search next 'case' at the same nesting,
  // or the closing of the switch). Approximate by limiting search range.
  const blockEnd = source.indexOf("case '/api/chat':", waterfallStart);
  assert.notEqual(blockEnd, -1, '/api/chat case block follows');

  const block = source.slice(waterfallStart, blockEnd);
  assert.ok(
    block.includes('buildMostRecentQuoteSessionHeader(wHistory)'),
    'Phase 1 helper must be invoked inside /api/chat-waterfall block'
  );
});

t('chat handler also uses the shared helper (refactored away from inline scan)', () => {
  const chatStart = source.indexOf("case '/api/chat':");
  assert.notEqual(chatStart, -1, '/api/chat case block exists');
  // The shared helper must be called and the legacy inline scan removed.
  const block = source.slice(chatStart, chatStart + 30000);
  assert.ok(
    block.includes('buildMostRecentQuoteSessionHeader(chatHistory)'),
    'shared helper must be invoked inside /api/chat block'
  );
  assert.ok(
    !/let lastQuoteRef = null;[\s\S]{0,200}for \(let _qi = chatHistory\.length/.test(block),
    'legacy inline scan must be removed'
  );
});

console.log('\n=== ChatPanel module-specific page hint ===\n');

t('ChatPanel buildZohoPageContextHint has module-scoped wording', () => {
  const chatPanelPath = join(__dirname, '..', 'chrome-extension', 'src', 'sidebar', 'panels', 'ChatPanel.jsx');
  const panel = readFileSync(chatPanelPath, 'utf8');

  // Must distinguish Quotes vs Accounts/Deals
  assert.ok(/ctx\.module === 'Quotes'/.test(panel), 'Quotes branch present');
  assert.ok(/ctx\.module === 'Accounts'/.test(panel), 'Accounts branch present');
  assert.ok(/ctx\.module === 'Potentials' \|\| ctx\.module === 'Deals'/.test(panel), 'Deals branch present');

  // Must NOT use the old blanket wording
  assert.ok(
    !/they mean \$\{moduleLabel\} \$\{ctx\.recordId\}\. Act on it directly without asking which one/.test(panel),
    'old blanket "they mean {moduleLabel}" wording must be removed'
  );

  // Account branch must explicitly say "Do NOT treat this Account as this quote"
  assert.ok(
    /Do NOT treat this Account as "this quote"/.test(panel),
    'Account branch refuses Quote misinterpretation'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
