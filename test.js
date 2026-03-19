/**
 * Stress test for Stratus AI quoting engine
 * Tests parseMessage + buildQuoteResponse against SKILL.md expected outputs
 */

const { parseMessage, buildQuoteResponse, applySuffix, getLicenseSkus, buildStratusUrl, validateSku, isEol, checkEol } = require('./index.js');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg);
}

function runQuote(input) {
  const parsed = parseMessage(input);
  if (!parsed) return null;
  return buildQuoteResponse(parsed);
}

// ─── Test Suite ─────────────────────────────────────────────────────────────

console.log('\n=== SUFFIX RULES ===');

test('MR36 → MR36-HW', () => {
  assert(applySuffix('MR36') === 'MR36-HW', `Got: ${applySuffix('MR36')}`);
});

test('MX75 → MX75-HW', () => {
  assert(applySuffix('MX75') === 'MX75-HW', `Got: ${applySuffix('MX75')}`);
});

test('MX68CW → MX68CW-HW-NA (cellular)', () => {
  assert(applySuffix('MX68CW') === 'MX68CW-HW-NA', `Got: ${applySuffix('MX68CW')}`);
});

test('MX68C → MX68C-HW-NA (cellular)', () => {
  assert(applySuffix('MX68C') === 'MX68C-HW-NA', `Got: ${applySuffix('MX68C')}`);
});

test('CW9166I → CW9166I-MR (Wi-Fi 6E)', () => {
  assert(applySuffix('CW9166I') === 'CW9166I-MR', `Got: ${applySuffix('CW9166I')}`);
});

test('CW9172I → CW9172I-RTG (Wi-Fi 7)', () => {
  assert(applySuffix('CW9172I') === 'CW9172I-RTG', `Got: ${applySuffix('CW9172I')}`);
});

test('MS130-24P → MS130-24P-HW', () => {
  assert(applySuffix('MS130-24P') === 'MS130-24P-HW', `Got: ${applySuffix('MS130-24P')}`);
});

test('MS150-48LP-4G → MS150-48LP-4G (no suffix)', () => {
  assert(applySuffix('MS150-48LP-4G') === 'MS150-48LP-4G', `Got: ${applySuffix('MS150-48LP-4G')}`);
});

test('Z4 → Z4-HW', () => {
  assert(applySuffix('Z4') === 'Z4-HW', `Got: ${applySuffix('Z4')}`);
});

test('MT15 → MT15-HW', () => {
  assert(applySuffix('MT15') === 'MT15-HW', `Got: ${applySuffix('MT15')}`);
});

test('MG41 → MG41-HW', () => {
  assert(applySuffix('MG41') === 'MG41-HW', `Got: ${applySuffix('MG41')}`);
});


console.log('\n=== LICENSE RULES ===');

test('MR36 → LIC-ENT-{1,3,5}YR (older format)', () => {
  const lics = getLicenseSkus('MR36');
  assert(lics[0].sku === 'LIC-ENT-1YR', `1Y got: ${lics[0].sku}`);
  assert(lics[1].sku === 'LIC-ENT-3YR', `3Y got: ${lics[1].sku}`);
  assert(lics[2].sku === 'LIC-ENT-5YR', `5Y got: ${lics[2].sku}`);
});

test('CW9166I → LIC-ENT-{1,3,5}YR (APs use ENT)', () => {
  const lics = getLicenseSkus('CW9166I');
  assert(lics[1].sku === 'LIC-ENT-3YR', `3Y got: ${lics[1].sku}`);
});

test('CW9172I → LIC-ENT-{1,3,5}YR (APs use ENT)', () => {
  const lics = getLicenseSkus('CW9172I');
  assert(lics[1].sku === 'LIC-ENT-3YR', `3Y got: ${lics[1].sku}`);
});

test('MX75 → LIC-MX75-SEC-3YR (older format)', () => {
  const lics = getLicenseSkus('MX75');
  assert(lics[1].sku === 'LIC-MX75-SEC-3YR', `3Y got: ${lics[1].sku}`);
});

test('MX68CW → LIC-MX68CW-SEC-3YR', () => {
  const lics = getLicenseSkus('MX68CW');
  assert(lics[1].sku === 'LIC-MX68CW-SEC-3YR', `3Y got: ${lics[1].sku}`);
});

test('Z4 → LIC-Z4-SEC-3Y (newer format, SEC tier)', () => {
  const lics = getLicenseSkus('Z4');
  assert(lics[1].sku === 'LIC-Z4-SEC-3Y', `3Y got: ${lics[1].sku}`);
});

test('MG41 → LIC-MG41-ENT-3Y (newer format, ENT tier)', () => {
  const lics = getLicenseSkus('MG41');
  assert(lics[1].sku === 'LIC-MG41-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS130-8P → LIC-MS130-CMPT-3Y (compact)', () => {
  const lics = getLicenseSkus('MS130-8P');
  assert(lics[1].sku === 'LIC-MS130-CMPT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS130-24P → LIC-MS130-24-3Y (standard)', () => {
  const lics = getLicenseSkus('MS130-24P');
  assert(lics[1].sku === 'LIC-MS130-24-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS150-48LP-4G → LIC-MS150-48-3Y', () => {
  const lics = getLicenseSkus('MS150-48LP-4G');
  assert(lics[1].sku === 'LIC-MS150-48-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS390-24UX → no license', () => {
  const lics = getLicenseSkus('MS390-24UX');
  assert(lics === null, `Expected null, got: ${JSON.stringify(lics)}`);
});


console.log('\n=== URL FORMAT ===');

test('buildStratusUrl single item', () => {
  const url = buildStratusUrl([{ sku: 'MR36-HW', qty: 10 }, { sku: 'LIC-ENT-3YR', qty: 10 }]);
  assert(url === 'https://stratusinfosystems.com/order/?item=MR36-HW,LIC-ENT-3YR&qty=10,10', `Got: ${url}`);
});

test('buildStratusUrl multi item', () => {
  const url = buildStratusUrl([
    { sku: 'MR44-HW', qty: 2 }, { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MS130-24P-HW', qty: 1 }, { sku: 'LIC-MS130-24-3Y', qty: 1 }
  ]);
  assert(url.includes('item=MR44-HW,LIC-ENT-3YR,MS130-24P-HW,LIC-MS130-24-3Y'), `Items wrong: ${url}`);
  assert(url.includes('qty=2,2,1,1'), `Qtys wrong: ${url}`);
});


console.log('\n=== FULL QUOTE TESTS ===');

test('Test 1: "quote 10 MR36" → 3 URLs, 3Y has MR36-HW,LIC-ENT-3YR qty 10,10', () => {
  const result = runQuote('quote 10 MR36');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('1-Year'), 'Missing 1-Year');
  assert(result.message.includes('3-Year'), 'Missing 3-Year');
  assert(result.message.includes('5-Year'), 'Missing 5-Year');
  assert(result.message.includes('item=MR36-HW,LIC-ENT-3YR&qty=10,10'), `3Y URL wrong. Got:\n${result.message}`);
});

test('Test 2: "5 MX68 and 10 MR44" → multi-product URL', () => {
  const result = runQuote('5 MX68 and 10 MR44');
  assert(result && !result.needsLlm, 'Should not need LLM');
  // 3Y URL should have both products
  assert(result.message.includes('MX68-HW'), 'Missing MX68-HW');
  assert(result.message.includes('LIC-MX68-SEC-3YR'), 'Missing MX68 license');
  assert(result.message.includes('MR44-HW'), 'Missing MR44-HW');
  assert(result.message.includes('LIC-ENT-3YR'), 'Missing ENT license');
});

test('Test 3: "3 MS130-24P" → MS130-24P-HW + LIC-MS130-24-3Y', () => {
  const result = runQuote('3 MS130-24P');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('item=MS130-24P-HW,LIC-MS130-24-3Y&qty=3,3'), `URL wrong. Got:\n${result.message}`);
});

test('Test 4: "2 MS130-8P" → LIC-MS130-CMPT-3Y (compact license)', () => {
  const result = runQuote('2 MS130-8P');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('LIC-MS130-CMPT-3Y'), `Missing compact license. Got:\n${result.message}`);
});

test('Test 5: "6 CW9166I" → CW9166I-MR + LIC-ENT-3YR', () => {
  const result = runQuote('6 CW9166I');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('item=CW9166I-MR,LIC-ENT-3YR&qty=6,6'), `URL wrong. Got:\n${result.message}`);
});

test('Test 6: "4 CW9172I" → CW9172I-RTG + LIC-ENT-3YR', () => {
  const result = runQuote('4 CW9172I');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('item=CW9172I-RTG,LIC-ENT-3YR&qty=4,4'), `URL wrong. Got:\n${result.message}`);
});

test('Test 7: "1 MX68CW" → MX68CW-HW-NA + LIC-MX68CW-SEC-3YR', () => {
  const result = runQuote('1 MX68CW');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MX68CW-HW-NA'), `Missing -HW-NA. Got:\n${result.message}`);
  assert(result.message.includes('LIC-MX68CW-SEC-3YR'), `Missing MX68CW license. Got:\n${result.message}`);
});

test('Test 8: "2 MS150-48LP-4G" → MS150-48LP-4G (no suffix) + LIC-MS150-48-3Y', () => {
  const result = runQuote('2 MS150-48LP-4G');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('item=MS150-48LP-4G,LIC-MS150-48-3Y&qty=2,2'), `URL wrong. Got:\n${result.message}`);
});

test('Test 9: "10 MR36 3 year" → still shows ALL 3 terms (no "just"/"only")', () => {
  const result = runQuote('10 MR36 3 year');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('1-Year'), 'Should still show 1-Year');
  assert(result.message.includes('3-Year'), 'Should still show 3-Year');
  assert(result.message.includes('5-Year'), 'Should still show 5-Year');
});

test('Test 10: "10 MR36 just 3 year" → only 3Y URL', () => {
  const result = runQuote('10 MR36 just 3 year');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(!result.message.includes('1-Year'), 'Should NOT show 1-Year');
  assert(result.message.includes('3-Year'), 'Should show 3-Year');
  assert(!result.message.includes('5-Year'), 'Should NOT show 5-Year');
});

test('Test 11: "1 Z4" → Z4-HW + LIC-Z4-SEC-3Y (SEC tier, newer format)', () => {
  const result = runQuote('1 Z4');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('Z4-HW'), `Missing Z4-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-Z4-SEC-3Y'), `Missing Z4 SEC license. Got:\n${result.message}`);
});

test('Test 12: "1 MG41" → MG41-HW + LIC-MG41-ENT-3Y', () => {
  const result = runQuote('1 MG41');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MG41-HW'), `Missing MG41-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-MG41-ENT-3Y'), `Missing MG41 ENT license. Got:\n${result.message}`);
});


console.log('\n=== EOL HANDLING ===');

test('MR42 is EOL', () => {
  assert(isEol('MR42') === true, 'MR42 should be EOL');
});

test('MR42 replacement → MR44', () => {
  const replacement = checkEol('MR42');
  assert(replacement === 'MR44', `Expected MR44, got: ${replacement}`);
});


console.log('\n=== PARSER EDGE CASES ===');

test('Empty string → null', () => {
  assert(parseMessage('') === null, 'Should return null');
});

test('No SKUs → null', () => {
  assert(parseMessage('hello how are you') === null, 'Should return null');
});

test('"quote MR36" → qty defaults to 1', () => {
  const parsed = parseMessage('quote MR36');
  assert(parsed.items[0].qty === 1, `Expected qty 1, got: ${parsed.items[0].qty}`);
});

test('"20x MR36" → qty 20', () => {
  const parsed = parseMessage('20x MR36');
  assert(parsed.items[0].qty === 20, `Expected qty 20, got: ${parsed.items[0].qty}`);
});


// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
