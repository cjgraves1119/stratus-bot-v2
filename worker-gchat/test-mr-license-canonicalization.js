// MR Enterprise License SKU canonicalization tests
// Llama invents non-canonical patterns when asked for "N MR licenses".
// Verifies applySuffix normalizes them to the universal LIC-ENT-{term}YR.

const assert = require('assert');

// Pull the applySuffix function from index.js.
// We can't import from a CF Worker module directly, so we mirror the rule.
// (Kept in sync with worker-gchat/src/index.js applySuffix; if that diverges,
// these tests should be regenerated from source.)
function applySuffix(sku) {
  const upper = sku.toUpperCase();
  const mrLicMatch = upper.match(/^LIC-(?:ENT-MR|MR-ENT|MR)-(1|3|5)Y(?:R)?$/);
  if (mrLicMatch) return `LIC-ENT-${mrLicMatch[1]}YR`;
  // (Other branches omitted — we only test the MR license normalizer here.
  // Hardware suffix logic is exercised in test-chat-waterfall-quote-fix.js.)
  return upper;
}

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('\nMR Enterprise License SKU canonicalization\n────────────────────────────────────────────────────────────────');

// Pattern A: LIC-ENT-MR-{n}YR (Llama's most-observed invention)
t('LIC-ENT-MR-1YR → LIC-ENT-1YR', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-1YR'), 'LIC-ENT-1YR');
});
t('LIC-ENT-MR-3YR → LIC-ENT-3YR', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-3YR'), 'LIC-ENT-3YR');
});
t('LIC-ENT-MR-5YR → LIC-ENT-5YR', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-5YR'), 'LIC-ENT-5YR');
});
t('LIC-ENT-MR-1Y (without R) → LIC-ENT-1YR', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-1Y'), 'LIC-ENT-1YR');
});

// Pattern B: LIC-MR-ENT-{n}YR
t('LIC-MR-ENT-1YR → LIC-ENT-1YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-ENT-1YR'), 'LIC-ENT-1YR');
});
t('LIC-MR-ENT-3YR → LIC-ENT-3YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-ENT-3YR'), 'LIC-ENT-3YR');
});
t('LIC-MR-ENT-5YR → LIC-ENT-5YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-ENT-5YR'), 'LIC-ENT-5YR');
});

// Pattern C: LIC-MR-{n}YR / -{n}Y
t('LIC-MR-1YR → LIC-ENT-1YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-1YR'), 'LIC-ENT-1YR');
});
t('LIC-MR-3YR → LIC-ENT-3YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-3YR'), 'LIC-ENT-3YR');
});
t('LIC-MR-5YR → LIC-ENT-5YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-5YR'), 'LIC-ENT-5YR');
});
t('LIC-MR-1Y (without R) → LIC-ENT-1YR', () => {
  assert.strictEqual(applySuffix('LIC-MR-1Y'), 'LIC-ENT-1YR');
});

// Lowercase input still normalized
t('lowercase lic-ent-mr-3yr → LIC-ENT-3YR', () => {
  assert.strictEqual(applySuffix('lic-ent-mr-3yr'), 'LIC-ENT-3YR');
});

// Negative cases — must NOT match other license families
t('LIC-MX75-SEC-3YR (MX security, model-specific) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-MX75-SEC-3YR'), 'LIC-MX75-SEC-3YR');
});
t('LIC-MV-3YR (MV camera, universal but different family) NOT rewritten to LIC-ENT', () => {
  assert.strictEqual(applySuffix('LIC-MV-3YR'), 'LIC-MV-3YR');
});
t('LIC-MT-1YR (MT sensor, universal but different family) NOT rewritten to LIC-ENT', () => {
  assert.strictEqual(applySuffix('LIC-MT-1YR'), 'LIC-MT-1YR');
});
t('LIC-ENT-3YR (already canonical) NOT changed', () => {
  assert.strictEqual(applySuffix('LIC-ENT-3YR'), 'LIC-ENT-3YR');
});
t('Random non-license string passes through', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR'), 'LIC-ENT-MR'); // no term suffix
  assert.strictEqual(applySuffix('LIC-MR-ENT'), 'LIC-MR-ENT');
});

// Codex pushback 2026-05-05: regex must NOT manufacture non-canonical
// rewrites for unsupported terms. Catalog only has LIC-ENT-{1,3,5}YR; if
// Llama invents LIC-ENT-MR-7YR or LIC-MR-10YR, the safety net should NOT
// normalize to LIC-ENT-7YR/-10YR (those don't exist either). Pass through
// unchanged so the downstream not-found surfaces a real error instead of
// manufacturing a new fake SKU class.
t('LIC-ENT-MR-7YR (unsupported term) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-7YR'), 'LIC-ENT-MR-7YR');
});
t('LIC-ENT-MR-10YR (unsupported term) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-ENT-MR-10YR'), 'LIC-ENT-MR-10YR');
});
t('LIC-MR-7Y (unsupported term, missing R) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-MR-7Y'), 'LIC-MR-7Y');
});
t('LIC-MR-ENT-2YR (unsupported term 2y) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-MR-ENT-2YR'), 'LIC-MR-ENT-2YR');
});
t('LIC-MR-0YR (zero term, edge case) NOT rewritten', () => {
  assert.strictEqual(applySuffix('LIC-MR-0YR'), 'LIC-MR-0YR');
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
