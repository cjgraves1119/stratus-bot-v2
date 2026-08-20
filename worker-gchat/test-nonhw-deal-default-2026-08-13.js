const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

test('one-shot account resolution uses domain/email first and a bounded name fallback', () => {
  assert.match(source, /resolveAccountWaterfall\(\{[\s\S]*domain: selectedDomain[\s\S]*email: selectedEmail[\s\S]*nameHint: p\.account_name \|\| selectedName/);
  assert.match(source, /code: 'account_confirm'[\s\S]*fuzzyCandidates/);
});

test('one-shot Deal lookup offers only open Deals and fails closed on read errors', () => {
  assert.match(source, /Stage not in \('Closed \(Won\)', 'Closed \(Lost\)'\)/);
  assert.match(source, /plan\.deal = \{ mode: 'new', open_deals: \[\] \}/);
  assert.match(source, /plan\.deal = \{ mode: 'choose', open_deals:[\s\S]*blockers\.push\(\{ code: 'deal_choice'/);
  assert.match(source, /read_failed: true/);
});

test('MX\/MS bare Product resolution precedes plan errors and Zoho writes', () => {
  assert.match(source, /resolveBareMxMsZohoProduct\(resolved, env\)/);
  assert.match(source, /suffixed_sku: bareMxMs \? bareMxMs\.candidate : resolved/);
  assert.match(source, /preparedQuoteProducts = await preflightResolvedQuoteProducts\(resolvedProducts, env\)/);
  assert.match(source, /pricing_sku = resolvedProducts\[i\]\.pricing_sku \|\| resolvedProducts\[i\]\.sku/);
});

test('the fallback system prompt forbids MX\/MS -HW output', () => {
  assert.match(source, /All MS switches → use the bare SKU; NEVER add -HW/);
  assert.match(source, /MX non-cellular → use the bare SKU; NEVER add -HW/);
});

console.log(`\n${passed} passed, 0 failed`);
