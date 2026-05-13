#!/usr/bin/env node
// 2026-05-13 regression: create_deal_and_quote / create_quote_on_deal must
// invoke setAndVerifyQuoteDefaultVendor after Quote POST so the Vendor
// lookup gets populated. Zoho silently ignores plain-string Vendor on
// initial CREATE but accepts it on UPDATE — without this follow-up, a
// fresh Quote has Vendor blank until quote_to_po_and_esign runs.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Vendor follow-up after Quote create ===\n');

t('STEP 6b vendor-verify block exists after Quote POST', () => {
  // The new follow-up must be inserted between Quote creation and STEP 7
  // reconcile in the shared create_deal_and_quote / create_quote_on_deal body.
  assert.ok(
    /STEP 6b — Verify Vendor populated post-create/.test(source),
    'STEP 6b banner missing from source'
  );
});

t('vendor-verify calls setAndVerifyQuoteDefaultVendor with the new Quote id', () => {
  assert.ok(
    /setAndVerifyQuoteDefaultVendor\(quoteId, \{ Vendor: null \}, env\)/.test(source),
    'setAndVerifyQuoteDefaultVendor must be invoked with the freshly-created quoteId and a placeholder Vendor:null so the helper does not skip on a stale read'
  );
});

t('vendor-verify success path logs to results.steps with DEFAULT_QUOTE_VENDOR + state', () => {
  assert.ok(
    /Set Quote Vendor: \$\{DEFAULT_QUOTE_VENDOR\} \(state: \$\{vendorVerify\.state\}\)/.test(source),
    'success log must show the resolved vendor + verifier state'
  );
});

t('vendor-verify failure does NOT block the create (non-blocking)', () => {
  // The catch branch must not return success:false from the tool; it must
  // log and continue. Quote was already created, blocking the response
  // would lie to the model about whether the create happened.
  const block = source.slice(
    source.indexOf('STEP 6b — Verify Vendor populated post-create'),
    source.indexOf('STEP 7: Fetch the created quote to confirm durability')
  );
  assert.ok(block.length > 100, 'STEP 6b block must exist');
  assert.ok(
    !/return\s+\{\s*success: false/.test(block),
    'vendor-verify failure must not early-return success:false'
  );
  assert.ok(
    /Non-blocking: Quote was created/.test(block),
    'non-blocking intent must be documented in the source'
  );
});

t('vendor-verify catch handles thrown errors gracefully', () => {
  const block = source.slice(
    source.indexOf('STEP 6b — Verify Vendor populated post-create'),
    source.indexOf('STEP 7: Fetch the created quote to confirm durability')
  );
  assert.ok(
    /catch \(vendorErr\)/.test(block) && /Vendor verify threw/.test(block),
    'try/catch around verify must exist with thrown-error logging'
  );
});

t('Existing setAndVerifyQuoteDefaultVendor function still in source', () => {
  assert.ok(
    /async function setAndVerifyQuoteDefaultVendor\(quoteId, quote, env\)/.test(source),
    'setAndVerifyQuoteDefaultVendor must remain defined'
  );
});

t('Existing handleQuoteToPoAndEsign still calls setAndVerifyQuoteDefaultVendor', () => {
  // Don't regress the existing wrapper's vendor handling.
  assert.ok(
    /const quoteVendor = await setAndVerifyQuoteDefaultVendor\(quoteId, quote, env\)/.test(source),
    'handleQuoteToPoAndEsign must still invoke the helper before PO conversion'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
