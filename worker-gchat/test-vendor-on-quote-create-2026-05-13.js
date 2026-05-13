#!/usr/bin/env node
// 2026-05-13 — REVERTED PR #68's STEP 6b Vendor write.
// Root cause investigation found that writing Quote.Vendor text field
// (via PUT after create) breaks Cisco CCW DID generation: the
// LIVE_CiscoQuote_Deal admin action hangs at __Processing forever.
// Yesterday's working Quote had Vendor (text) = null but Vendor1 (lookup)
// populated; that's all Cisco needs. quoteVendorValue now also reads
// Vendor1 so the pre-DID Vendor verify in handleQuoteToPoAndEsign
// short-circuits ('already_set') instead of writing the text field.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== PR #68 STEP 6b REVERTED ===\n');

t('PR #68 STEP 6b vendor-verify post-create call is REMOVED', () => {
  // Must not have the setAndVerify call right after Quote POST.
  const idx = source.indexOf('Created Quote with ${resolvedProducts.length} line items at ecomm pricing');
  assert.notEqual(idx, -1, 'create-success log line still present');
  // Search the 1200 chars after for any pre-STEP-7 setAndVerify call.
  const slice = source.slice(idx, idx + 1500);
  assert.ok(
    !/setAndVerifyQuoteDefaultVendor\(quoteId/.test(slice),
    'no Vendor-verify PUT may fire between Quote POST and STEP 7'
  );
});

t('Cisco CCW DID hang root cause is documented in source', () => {
  assert.ok(
    /Cisco's CCW DID integration to hang/i.test(source),
    'source must document the Cisco hang root cause for future reverters'
  );
});

t('quoteVendorValue now also reads Vendor1 lookup', () => {
  // Find the function body and assert Vendor1 is in the read list.
  const idx = source.indexOf('function quoteVendorValue(');
  assert.notEqual(idx, -1, 'quoteVendorValue must still be defined');
  const block = source.slice(idx, idx + 800);
  assert.ok(
    /record\.Vendor1/.test(block),
    'quoteVendorValue must read Vendor1 so pre-DID Vendor verify short-circuits'
  );
});

t('setAndVerifyQuoteDefaultVendor still defined (for post-DID/PO flow)', () => {
  assert.ok(
    /async function setAndVerifyQuoteDefaultVendor\(quoteId, quote, env\)/.test(source),
    'helper must remain — handleQuoteToPoAndEsign uses it after DID/before PO conversion'
  );
});

t('Existing handleQuoteToPoAndEsign vendor check intact (will now short-circuit on Vendor1)', () => {
  assert.ok(
    /const quoteVendor = await setAndVerifyQuoteDefaultVendor\(quoteId, quote, env\)/.test(source),
    'handleQuoteToPoAndEsign must still call the helper; it just no-ops now thanks to quoteVendorValue fix'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
