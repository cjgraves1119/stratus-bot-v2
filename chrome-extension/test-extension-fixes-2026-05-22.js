#!/usr/bin/env node
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const here = __dirname;
const quoteSource = fs.readFileSync(path.join(here, 'src/lib/quote-engine.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(here, 'src/lib/auto-catalog.json'), 'utf8'));
const contextMenuSource = fs.readFileSync(path.join(here, 'src/background/context-menus.js'), 'utf8');
const quoteResultSource = fs.readFileSync(path.join(here, 'src/sidebar/components/QuoteResult.jsx'), 'utf8');
const searchPanelSource = fs.readFileSync(path.join(here, 'src/sidebar/panels/SearchPanel.jsx'), 'utf8');
const chatPanelSource = fs.readFileSync(path.join(here, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');

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

const ctx = { __catalog: catalog, console };
vm.createContext(ctx);
vm.runInContext(
  quoteSource
    .replace("import catalog from './auto-catalog.json';", 'const catalog = __catalog;')
    .replace(/\bexport\s+/g, ''),
  ctx
);

function itemsFrom(url) {
  const parsed = new URL(url);
  return parsed.searchParams.get('item').split(',');
}

function qtyFrom(url) {
  const parsed = new URL(url);
  return parsed.searchParams.get('qty').split(',');
}

console.log('\n=== Quote parser model-agnostic licenses ===\n');

t('mixed MV/MR/MX64 license request generates one URL per term with no hardware', () => {
  const result = ctx.generateLocalQuote('Quote 1 MV, 2 MR, and 3 MX64 licenses');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 3);
  const oneYear = result.urls.find(u => /1-Year/.test(u.label));
  assert.ok(oneYear);
  assert.deepEqual(itemsFrom(oneYear.url), ['LIC-MV-1YR', 'LIC-ENT-1YR', 'LIC-MX64-SEC-1YR']);
  assert.deepEqual(qtyFrom(oneYear.url), ['1', '2', '3']);
  assert.ok(!oneYear.url.includes('MV-AGN'));
  assert.ok(!oneYear.url.includes('MR-AGN'));
  assert.ok(!oneYear.url.includes('MX64-HW'));
});

t('AP license request maps to universal LIC-ENT URLs', () => {
  const result = ctx.generateLocalQuote('Quote 10 AP licenses');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 3);
  assert.deepEqual(itemsFrom(result.urls[0].url), ['LIC-ENT-1YR']);
  assert.deepEqual(qtyFrom(result.urls[0].url), ['10']);
});

t('MV renewal maps to universal LIC-MV URLs', () => {
  const result = ctx.generateLocalQuote('Quote 4 MV renewal');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 3);
  assert.deepEqual(itemsFrom(result.urls[2].url), ['LIC-MV-5YR']);
  assert.deepEqual(qtyFrom(result.urls[2].url), ['4']);
});

t('bare MV with quantity asks license-vs-camera clarification without EOL suggestions', () => {
  const result = ctx.generateLocalQuote('quote 5 mv');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 0);
  assert.equal(result.suggestions.length, 1);
  assert.match(result.suggestions[0].reason, /licenses or 5 MV hardware/i);
  assert.ok(result.suggestions[0].suggest.includes('5 MV licenses'));
  assert.ok(!result.suggestions[0].suggest.some(s => /MV22|MV32|MV52|MV72/i.test(s)));
});

t('bare MR with quantity clarifies licenses vs hardware without EOL suggestions', () => {
  const result = ctx.generateLocalQuote('quote 5 mr');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 0);
  assert.equal(result.suggestions.length, 1);
  assert.match(result.suggestions[0].reason, /licenses or 5 MR hardware/i);
  assert.ok(result.suggestions[0].suggest.includes('5 MR licenses'));
  assert.ok(!result.suggestions[0].suggest.some(s => /MR44|MR52|MR55/i.test(s)));
});

t('bare MX and MS with quantity ask for current model instead of EOL recommendations', () => {
  const mx = ctx.generateLocalQuote('3 mx');
  assert.equal(mx.error, null);
  assert.equal(mx.urls.length, 0);
  assert.match(mx.suggestions[0].reason, /Which MX security appliance/i);
  assert.ok(!mx.suggestions[0].suggest.some(s => /MX64|MX65|MX84|MX100/i.test(s)));

  const ms = ctx.generateLocalQuote('quote 2 ms');
  assert.equal(ms.error, null);
  assert.equal(ms.urls.length, 0);
  assert.match(ms.suggestions[0].reason, /Which MS switch/i);
  assert.ok(!ms.suggestions[0].suggest.some(s => /MS120|MS210|MS225|MS250|MS390/i.test(s)));
});

t('explicit MV licenses still generates LIC-MV URLs', () => {
  const result = ctx.generateLocalQuote('5 mv licenses');
  assert.equal(result.error, null);
  assert.equal(result.urls.length, 3);
  assert.deepEqual(itemsFrom(result.urls[0].url), ['LIC-MV-1YR']);
  assert.deepEqual(qtyFrom(result.urls[0].url), ['5']);
});

t('bare MX64 still includes hardware', () => {
  const result = ctx.generateLocalQuote('Quote 2 MX64');
  assert.equal(result.error, null);
  assert.ok(result.urls.some(u => itemsFrom(u.url).some(item => /MX\d+-HW/.test(item))));
});

t('MX64 licenses is license-only', () => {
  const result = ctx.generateLocalQuote('Quote 2 MX64 licenses');
  assert.equal(result.error, null);
  assert.deepEqual(itemsFrom(result.urls[0].url), ['LIC-MX64-SEC-1YR']);
  assert.deepEqual(qtyFrom(result.urls[0].url), ['2']);
});

t('CW access point wording does not duplicate AP-AGN licensing', () => {
  const result = ctx.generateLocalQuote('Quote 1 CW9172H AP licenses');
  assert.equal(result.error, null);
  assert.deepEqual(itemsFrom(result.urls[0].url), ['LIC-ENT-1YR']);
  assert.deepEqual(qtyFrom(result.urls[0].url), ['1']);
});

console.log('\n=== Extension search and copy-all wiring ===\n');

t('context menu detects invoice phrases and bare short numbers', () => {
  assert.ok(/\(\?:inv\|invoice\)/.test(contextMenuSource));
  assert.ok(/\\d\{4,7\}/.test(contextMenuSource));
});

t('SearchPanel also auto-detects invoices for manual default search', () => {
  assert.ok(/function detectSearchModule/.test(searchPanelSource));
  assert.ok(/moduleTouched/.test(searchPanelSource));
  assert.ok(/setModule\(effectiveModule\)/.test(searchPanelSource));
  assert.ok(/module: effectiveModule/.test(searchPanelSource));
});

t('SearchPanel hides Deals and routes short deal IDs to quote search', () => {
  assert.ok(!/Deals:\s*\{\s*label:\s*'Deals'/.test(searchPanelSource));
  assert.ok(/return 'Quotes';/.test(searchPanelSource));
  assert.ok(/\\d\{8\}/.test(searchPanelSource));
  assert.ok(/dlid/.test(searchPanelSource));
  assert.ok(/isStrongAutoModuleSearch/.test(searchPanelSource));
  assert.ok(/CCW_Deal_Number/.test(searchPanelSource));
});

t('context menu routes DLID and bare 8-digit searches to Quotes', () => {
  assert.ok(/dlid/.test(contextMenuSource));
  assert.ok(/return 'Quotes';/.test(contextMenuSource));
  assert.ok(/\\d\{8\}/.test(contextMenuSource));
});

t('QuoteResult has labeled Copy All Links action', () => {
  assert.ok(/function handleCopyAll/.test(quoteResultSource));
  assert.ok(/Copy All Links/.test(quoteResultSource));
  assert.ok(/\$\{u\.label \|\| `Option/.test(quoteResultSource));
  assert.ok(/text\/html/.test(quoteResultSource));
  assert.ok(/ClipboardItem/.test(quoteResultSource));
});

t('QuoteResult no longer offers Google Chat routing', () => {
  assert.ok(!/Open Google Chat/.test(quoteResultSource));
  assert.ok(!/handleSendToGChat/.test(quoteResultSource));
});

t('ChatPanel routes Gmail Create Quote through eCommerce before explicit Zoho review', () => {
  assert.ok(/startEmailEcommQuote/.test(chatPanelSource));
  assert.ok(/buildEcommQuoteFromIntake/.test(chatPanelSource));
  assert.ok(/Create Zoho CRM quote from selected/.test(quoteResultSource));
  assert.ok(/consentSource: 'quote-card-button'/.test(chatPanelSource));
  assert.ok(/Execute — create in Zoho CRM/.test(chatPanelSource));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
process.exit(failed ? 1 : 0);
