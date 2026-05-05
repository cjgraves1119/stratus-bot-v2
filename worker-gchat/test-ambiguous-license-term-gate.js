// 2026-05-05 council: tests for detectAmbiguousLicenseTerm gate.
// Mirrors the function from src/index.js. Codex live retest of PR #11 / v666
// confirmed Llama silently defaulted "21 MR licenses" to LIC-ENT-1YR and
// created Zoho records. This deterministic gate fires BEFORE Llama runs.

const assert = require('assert');

function detectAmbiguousLicenseTerm(text) {
  if (!text || typeof text !== 'string') return null;
  const m = text.match(/\b(\d+)\s*(MR|MV|MT|MG)\s+(?:enterprise\s+)?licens(?:es?|ing)\b/i);
  if (!m) return null;
  const hasTerm =
    /\b([135])\s*[-]?\s*(?:year|yr|y)s?\b/i.test(text)
    || /\b(?:one|three|five)[\s-]+years?\b/i.test(text)
    || /-([135])Y(?:R)?\b/i.test(text)
    || /\bLIC-(?:ENT|MV|MT|MG)-[^\s]*[135]Y/i.test(text);
  if (hasTerm) return null;
  const family = m[2].toUpperCase();
  const qty = parseInt(m[1], 10);
  const familyLabel =
    family === 'MR' ? 'MR Enterprise' :
    family === 'MV' ? 'MV camera' :
    family === 'MT' ? 'MT sensor' :
    family === 'MG' ? 'MG cellular' : family;
  return {
    family,
    qty,
    askMessage:
      `Which ${familyLabel} license term should I use: 1 year, 3 year, or 5 year?\n\n` +
      `(I won't create the quote until you choose a term — the license SKU varies by term: ` +
      `LIC-${family === 'MR' ? 'ENT' : family}-{1,3,5}YR.)`
  };
}

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); passed++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); failed++; }
}

console.log('\nAmbiguous license-term gate\n────────────────────────────────────────────────────────────────');

// ── Production failure repro ──
t('Production v666 prompt exact: "quote 21 MR licenses in zoho..." → fires', () => {
  const r = detectAmbiguousLicenseTerm('quote 21 MR licenses in zoho\n\nBe sure to include the account address on the quote');
  assert.ok(r, 'gate should fire');
  assert.strictEqual(r.family, 'MR');
  assert.strictEqual(r.qty, 21);
  assert.match(r.askMessage, /1 year, 3 year, or 5 year/);
  assert.match(r.askMessage, /MR Enterprise/);
});

// ── Positive cases (must fire) ──
t('5 MR licenses (no term) → fires', () => {
  const r = detectAmbiguousLicenseTerm('5 MR licenses please');
  assert.ok(r); assert.strictEqual(r.family, 'MR'); assert.strictEqual(r.qty, 5);
});
t('21 MR enterprise licenses (with "enterprise" word) → fires', () => {
  const r = detectAmbiguousLicenseTerm('I need 21 MR enterprise licenses');
  assert.ok(r); assert.strictEqual(r.qty, 21);
});
t('10 MV licenses → fires', () => {
  const r = detectAmbiguousLicenseTerm('quote 10 MV licenses');
  assert.ok(r); assert.strictEqual(r.family, 'MV');
  assert.match(r.askMessage, /MV camera/);
});
t('3 MT licenses → fires', () => {
  const r = detectAmbiguousLicenseTerm('add 3 MT licenses to the quote');
  assert.ok(r); assert.strictEqual(r.family, 'MT');
  assert.match(r.askMessage, /MT sensor/);
});
t('2 MG licenses → fires', () => {
  const r = detectAmbiguousLicenseTerm('I want 2 MG licenses');
  assert.ok(r); assert.strictEqual(r.family, 'MG');
  assert.match(r.askMessage, /MG cellular/);
});
t('Lowercase "21 mr licenses" → fires', () => {
  const r = detectAmbiguousLicenseTerm('21 mr licenses');
  assert.ok(r); assert.strictEqual(r.family, 'MR');
});

// ── Negative cases — explicit term provided (must NOT fire) ──
t('"21 1 year MR licenses" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('quote 21 1 year MR licenses in zoho'), null);
});
t('"21 MR licenses 3 year" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR licenses 3 year'), null);
});
t('"5y MR licenses" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('5y MR licenses'), null);
});
t('"21 MR licenses 5yr" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR licenses 5yr'), null);
});
t('"21 MR licenses for 3 years" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR licenses for 3 years'), null);
});
t('"21 MR licenses for three years" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR licenses for three years'), null);
});
t('"21 MR 3-year licenses" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR 3-year licenses'), null);
});
t('"quote LIC-ENT-3YR x21" → does NOT fire (canonical SKU mentioned)', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('quote LIC-ENT-3YR x21'), null);
});

// ── Negative cases — specific hardware models (must NOT fire) ──
t('"21 MR46 licenses" → does NOT fire (specific model)', () => {
  // MR46 doesn't match \b(MR|MV|MT|MG)\s+licens because MR46 has digits, not whitespace, after
  assert.strictEqual(detectAmbiguousLicenseTerm('quote 21 MR46 licenses'), null);
});
t('"21 MR46-HW with licenses" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('21 MR46-HW with licenses'), null);
});

// ── Negative cases — totally unrelated text ──
t('"What is the price of MR46?" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('What is the price of MR46?'), null);
});
t('"hello" → does NOT fire', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm('hello'), null);
});

// ── Edge cases ──
t('null input → returns null', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm(null), null);
});
t('empty string → returns null', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm(''), null);
});
t('non-string input → returns null', () => {
  assert.strictEqual(detectAmbiguousLicenseTerm(42), null);
  assert.strictEqual(detectAmbiguousLicenseTerm({}), null);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
