// 2026-05-05 council: tests for looksLikeZohoQuoteIntent helper.
// Codex PR #14 retest Test 2: explicit-term renewal "quote 21 3 year MR
// renewals in zoho. Be sure to include the account address on the quote"
// was intercepted by Tier 0 URL responder. This helper signals when user
// wants Zoho-write so Tier 0 defers to LLM+CRM path.

const assert = require('assert');

function looksLikeZohoQuoteIntent(text) {
  if (!text || typeof text !== 'string') return false;
  return /\b(?:in|to|into)\s+zoho\b/i.test(text)
      || /\b(?:include|add|with)\s+(?:the\s+)?(?:account|customer|company)?\s*(?:billing\s+)?address\b/i.test(text)
      || /\bon\s+the\s+(?:zoho\s+)?quote\b/i.test(text)
      || /\bcreate\s+(?:a\s+|the\s+)?(?:zoho\s+)?(?:quote|deal|opportunity)\s+(?:for|in)\b/i.test(text)
      || /\b(?:billing|shipping)\s+(?:address|street|city|state|zip|country)\b/i.test(text);
}

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('\nlooksLikeZohoQuoteIntent\n────────────────────────────────────────────────────────────────');

// ── Codex repro positive: must trigger ──
t('Test 2 exact prompt: explicit renewal + zoho + address → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('quote 21 3 year MR renewals in zoho. Be sure to include the account address on the quote'), true);
});
t('Test 1 exact: ambiguous renewal in zoho → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('quote 21 MR renewals in zoho'), true);
});
t('Test 3 exact: ambiguous license + include address → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('quote 21 MR licenses in zoho\n\nBe sure to include the account address on the quote'), true);
});

// ── Positive: each clause individually ──
t('"in zoho" alone → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('create a quote in zoho for me'), true);
});
t('"to zoho" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('push this to zoho'), true);
});
t('"include the account address" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('include the account address please'), true);
});
t('"add the customer address" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('add the customer address to this'), true);
});
t('"on the quote" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('also put the address on the quote'), true);
});
t('"on the zoho quote" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('record this on the zoho quote'), true);
});
t('"create a quote for" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('create a quote for TestCo'), true);
});
t('"create a deal in" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('create a deal in zoho'), true);
});
t('"billing address" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('billing address: 123 Main St'), true);
});
t('"shipping street" → fires', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('shipping street is the same'), true);
});

// ── Negative: pure URL/SKU lookup intent ──
t('Bare SKU lookup "quote 21 LIC-ENT-3YR" → does NOT fire', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('quote 21 LIC-ENT-3YR'), false);
});
t('Bare hardware "MX67 with license" → does NOT fire', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('quote MX67 with license'), false);
});
t('"price for MR46" → does NOT fire', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('what is the price for MR46?'), false);
});
t('"hello" → does NOT fire', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent('hello'), false);
});

// ── Edge ──
t('null input → false', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent(null), false);
});
t('empty string → false', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent(''), false);
});
t('non-string → false', () => {
  assert.strictEqual(looksLikeZohoQuoteIntent(42), false);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
