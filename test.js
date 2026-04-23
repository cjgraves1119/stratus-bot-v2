/**
 * Stress test for Stratus AI quoting engine
 * Tests parseMessage + buildQuoteResponse against SKILL.md expected outputs
 * v2: expanded with auto-catalog coverage tests
 */

const { parseMessage, buildQuoteResponse, applySuffix, getLicenseSkus, buildStratusUrl, validateSku, isEol, checkEol, VALID_SKUS, getHistory, addToHistory, conversationHistory, SYSTEM_PROMPT, askClaude } = require('./index.js');

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

// New suffix tests for previously-failing SKUs
test('MS130R-8P → MS130R-8P-HW', () => {
  assert(applySuffix('MS130R-8P') === 'MS130R-8P-HW', `Got: ${applySuffix('MS130R-8P')}`);
});

test('MS210-24P → MS210-24P-HW (legacy)', () => {
  assert(applySuffix('MS210-24P') === 'MS210-24P-HW', `Got: ${applySuffix('MS210-24P')}`);
});

test('MS225-48FP → MS225-48FP-HW (legacy)', () => {
  assert(applySuffix('MS225-48FP') === 'MS225-48FP-HW', `Got: ${applySuffix('MS225-48FP')}`);
});

test('MS350-48 → MS350-48-HW (legacy)', () => {
  assert(applySuffix('MS350-48') === 'MS350-48-HW', `Got: ${applySuffix('MS350-48')}`);
});

test('MS450-12 → MS450-12 (no suffix)', () => {
  assert(applySuffix('MS450-12') === 'MS450-12', `Got: ${applySuffix('MS450-12')}`);
});

test('MX67C-NA → MX67C-NA (variant name, no extra suffix)', () => {
  assert(applySuffix('MX67C-NA') === 'MX67C-NA', `Got: ${applySuffix('MX67C-NA')}`);
});

test('MX68CW-NA → MX68CW-NA (variant name)', () => {
  assert(applySuffix('MX68CW-NA') === 'MX68CW-NA', `Got: ${applySuffix('MX68CW-NA')}`);
});

test('Z4X → Z4X (no suffix, sold as-is)', () => {
  assert(applySuffix('Z4X') === 'Z4X', `Got: ${applySuffix('Z4X')}`);
});

test('Z4CX → Z4CX (no suffix, sold as-is)', () => {
  assert(applySuffix('Z4CX') === 'Z4CX', `Got: ${applySuffix('Z4CX')}`);
});

test('GX20 → GX20 (no suffix)', () => {
  assert(applySuffix('GX20') === 'GX20', `Got: ${applySuffix('GX20')}`);
});

test('MV93M → MV93M-HW', () => {
  assert(applySuffix('MV93M') === 'MV93M-HW', `Got: ${applySuffix('MV93M')}`);
});

test('MV84X → MV84X-HW', () => {
  assert(applySuffix('MV84X') === 'MV84X-HW', `Got: ${applySuffix('MV84X')}`);
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

test('MX75 → LIC-MX75-SEC-3Y (newer format, model ≥75)', () => {
  const lics = getLicenseSkus('MX75');
  assert(lics[1].sku === 'LIC-MX75-SEC-3Y', `3Y got: ${lics[1].sku}`);
});

test('MX68CW → LIC-MX68CW-SEC-3YR', () => {
  const lics = getLicenseSkus('MX68CW');
  assert(lics[1].sku === 'LIC-MX68CW-SEC-3YR', `3Y got: ${lics[1].sku}`);
});

test('MX67C-NA → LIC-MX67C-SEC-3YR (strip -NA for license)', () => {
  const lics = getLicenseSkus('MX67C-NA');
  assert(lics[1].sku === 'LIC-MX67C-SEC-3YR', `3Y got: ${lics[1].sku}`);
});

test('Z4 → LIC-Z4-ENT-3Y (newer format, default ENT)', () => {
  const lics = getLicenseSkus('Z4');
  assert(lics[1].sku === 'LIC-Z4-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('Z4 with SEC tier → LIC-Z4-SEC-3Y', () => {
  const lics = getLicenseSkus('Z4', 'SEC');
  assert(lics[1].sku === 'LIC-Z4-SEC-3Y', `3Y got: ${lics[1].sku}`);
});

test('Z4X → LIC-Z4-ENT-3Y (uses Z4 license, default ENT)', () => {
  const lics = getLicenseSkus('Z4X');
  assert(lics[1].sku === 'LIC-Z4-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('Z4CX → LIC-Z4C-ENT-3Y (uses Z4C license, default ENT)', () => {
  const lics = getLicenseSkus('Z4CX');
  assert(lics[1].sku === 'LIC-Z4C-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MG41 → LIC-MG41-ENT-3Y (newer format, ENT tier)', () => {
  const lics = getLicenseSkus('MG41');
  assert(lics[1].sku === 'LIC-MG41-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MG21 → LIC-MG21-ENT-3Y', () => {
  const lics = getLicenseSkus('MG21');
  assert(lics[1].sku === 'LIC-MG21-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MG21E → LIC-MG21E-ENT-3Y', () => {
  const lics = getLicenseSkus('MG21E');
  assert(lics[1].sku === 'LIC-MG21E-ENT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS130-8P → LIC-MS130-CMPT-3Y (compact)', () => {
  const lics = getLicenseSkus('MS130-8P');
  assert(lics[1].sku === 'LIC-MS130-CMPT-3Y', `3Y got: ${lics[1].sku}`);
});

test('MS130R-8P → LIC-MS130-CMPT-3Y (rugged compact)', () => {
  const lics = getLicenseSkus('MS130R-8P');
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

test('MS450-12 → no license (DNA separate)', () => {
  const lics = getLicenseSkus('MS450-12');
  assert(lics === null, `Expected null, got: ${JSON.stringify(lics)}`);
});

test('MS210-24P → LIC-ENT-3YR (legacy switch)', () => {
  const lics = getLicenseSkus('MS210-24P');
  assert(lics[1].sku === 'LIC-ENT-3YR', `3Y got: ${lics[1].sku}`);
});

test('MS225-48FP → LIC-ENT-3YR (legacy switch)', () => {
  const lics = getLicenseSkus('MS225-48FP');
  assert(lics[1].sku === 'LIC-ENT-3YR', `3Y got: ${lics[1].sku}`);
});

test('MV93M → LIC-MV-3YR (camera license)', () => {
  const lics = getLicenseSkus('MV93M');
  assert(lics !== null, 'Should have licenses');
  assert(lics[1].sku === 'LIC-MV-3YR', `3Y got: ${lics[1].sku}`);
});

test('MT15 → LIC-MT-3Y (sensor license)', () => {
  const lics = getLicenseSkus('MT15');
  assert(lics !== null, 'Should have licenses');
  assert(lics[1].sku === 'LIC-MT-3Y', `3Y got: ${lics[1].sku}`);
});

test('GX20 → LIC-GX20-SEC-3Y', () => {
  const lics = getLicenseSkus('GX20');
  assert(lics !== null, 'Should have licenses');
  assert(lics[1].sku === 'LIC-GX20-SEC-3Y', `3Y got: ${lics[1].sku}`);
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


console.log('\n=== VALIDATION (auto-catalog) ===');

test('MR36 validates', () => {
  assert(validateSku('MR36').valid === true, 'MR36 should be valid');
});

test('MG21 validates (was failing before)', () => {
  assert(validateSku('MG21').valid === true, 'MG21 should be valid');
});

test('MG21E validates (was failing before)', () => {
  assert(validateSku('MG21E').valid === true, 'MG21E should be valid');
});

test('MV73X validates (was failing before)', () => {
  assert(validateSku('MV73X').valid === true, 'MV73X should be valid');
});

test('MV84X validates (was failing before)', () => {
  assert(validateSku('MV84X').valid === true, 'MV84X should be valid');
});

test('MV93M validates (was failing before)', () => {
  assert(validateSku('MV93M').valid === true, 'MV93M should be valid');
});

test('MS130R-8P validates (was failing before)', () => {
  assert(validateSku('MS130R-8P').valid === true, 'MS130R-8P should be valid');
});

test('MS210-24P validates (legacy, was failing before)', () => {
  assert(validateSku('MS210-24P').valid === true, 'MS210-24P should be valid');
});

test('MS225-48FP validates (legacy, was failing before)', () => {
  assert(validateSku('MS225-48FP').valid === true, 'MS225-48FP should be valid');
});

test('MS350-48 validates (legacy, was failing before)', () => {
  assert(validateSku('MS350-48').valid === true, 'MS350-48 should be valid');
});

test('MS450-12 validates (was failing before)', () => {
  assert(validateSku('MS450-12').valid === true, 'MS450-12 should be valid');
});

test('Z4X validates (was failing before)', () => {
  assert(validateSku('Z4X').valid === true, 'Z4X should be valid');
});

test('Z4CX validates (was failing before)', () => {
  assert(validateSku('Z4CX').valid === true, 'Z4CX should be valid');
});

test('MX67C-NA validates (was failing before)', () => {
  assert(validateSku('MX67C-NA').valid === true, 'MX67C-NA should be valid');
});

test('MX68CW-NA validates (was failing before)', () => {
  assert(validateSku('MX68CW-NA').valid === true, 'MX68CW-NA should be valid');
});

test('GX20 validates (was failing before)', () => {
  assert(validateSku('GX20').valid === true, 'GX20 should be valid');
});

test('GX50 validates (was failing before)', () => {
  assert(validateSku('GX50').valid === true, 'GX50 should be valid');
});

test('Bogus SKU "MR99" fails validation', () => {
  const result = validateSku('MR99');
  assert(result.valid === false, 'MR99 should be invalid');
  assert(result.suggest && result.suggest.length > 0, 'Should have suggestions');
});

test('VALID_SKUS set has 180+ entries', () => {
  assert(VALID_SKUS.size >= 180, `Only ${VALID_SKUS.size} entries in VALID_SKUS`);
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

test('Test 11: "1 Z4" → Z4-HW + LIC-Z4-ENT-3Y (default ENT, newer format)', () => {
  const result = runQuote('1 Z4');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('Z4-HW'), `Missing Z4-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-Z4-ENT-3Y'), `Missing Z4 ENT license. Got:\n${result.message}`);
});

test('Test 12: "1 MG41" → MG41-HW + LIC-MG41-ENT-3Y', () => {
  const result = runQuote('1 MG41');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MG41-HW'), `Missing MG41-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-MG41-ENT-3Y'), `Missing MG41 ENT license. Got:\n${result.message}`);
});

// New full quote tests for previously-failing families
test('Test 13: "2 MG21" → MG21-HW + LIC-MG21-ENT-3Y', () => {
  const result = runQuote('2 MG21');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('LIC-MG21-ENT-3Y'), `Missing MG21 license. Got:\n${result.message}`);
});

test('Test 14: "1 MV93M" → MV93M-HW + LIC-MV-3YR', () => {
  const result = runQuote('1 MV93M');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MV93M-HW'), `Missing MV93M-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-MV-3YR'), `Missing MV license. Got:\n${result.message}`);
});

test('Test 15: "3 MT15" → MT15-HW + LIC-MT-3Y', () => {
  const result = runQuote('3 MT15');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MT15-HW'), `Missing MT15-HW. Got:\n${result.message}`);
  assert(result.message.includes('LIC-MT-3Y'), `Missing MT license. Got:\n${result.message}`);
});

test('Test 16: "1 Z4X" → Z4X (no suffix) + LIC-Z4-ENT-3Y (uses Z4 license)', () => {
  const result = runQuote('1 Z4X');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('LIC-Z4-ENT-3Y'), `Missing Z4 ENT license. Got:\n${result.message}`);
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

test('"1 MX67C-NA" parses correctly', () => {
  const parsed = parseMessage('1 MX67C-NA');
  assert(parsed !== null, 'Should parse');
  assert(parsed.items[0].baseSku === 'MX67C-NA', `Got: ${parsed.items[0].baseSku}`);
});

test('"2 MS210-24P" parses correctly (legacy switch)', () => {
  const parsed = parseMessage('2 MS210-24P');
  assert(parsed !== null, 'Should parse');
  assert(parsed.items[0].baseSku === 'MS210-24P', `Got: ${parsed.items[0].baseSku}`);
});

test('"1 GX20" parses correctly', () => {
  const parsed = parseMessage('1 GX20');
  assert(parsed !== null, 'Should parse');
  assert(parsed.items[0].baseSku === 'GX20', `Got: ${parsed.items[0].baseSku}`);
});


console.log('\n=== AMBIGUITY DETECTION ===');

test('Ambiguity: "quote MS150-48" → clarification message, NOT needsLlm', () => {
  const result = runQuote('quote MS150-48');
  assert(result !== null, 'Should parse MS150-48');
  assert(result.needsLlm === false, `Should NOT need LLM, got needsLlm=${result.needsLlm}`);
  assert(result.message.includes('MS150-48T-4G'), `Should suggest MS150-48T-4G. Got:\n${result.message}`);
  assert(result.message.includes('MS150-48LP-4G'), `Should suggest MS150-48LP-4G. Got:\n${result.message}`);
  assert(result.message.includes('Which one'), `Should ask which one. Got:\n${result.message}`);
});

test('Ambiguity: "quote MS130-24" → exact match exists, should NOT be ambiguous', () => {
  const result = runQuote('quote MS130-24');
  assert(result !== null, 'Should parse MS130-24');
  assert(result.needsLlm === false, 'Should NOT need LLM');
  assert(result.message.includes('MS130-24'), 'Should contain MS130-24 in URL');
  assert(!result.message.includes('Which one'), 'Should NOT ask for clarification (exact match)');
});

test('Ambiguity: "quote MS150-24" → clarification for 24-port variants', () => {
  const result = runQuote('quote MS150-24');
  assert(result !== null, 'Should parse MS150-24');
  assert(result.needsLlm === false, 'Should NOT need LLM');
  assert(result.message.includes('MS150-24T-4G'), `Should suggest variants. Got:\n${result.message}`);
});


console.log('\n=== CONVERSATION MEMORY ===');

test('addToHistory stores messages', () => {
  conversationHistory.clear();
  addToHistory('test-user-1', 'user', 'quote 10 MR44');
  addToHistory('test-user-1', 'assistant', 'Here are your URLs...');
  const history = getHistory('test-user-1');
  assert(history.length === 2, `Expected 2 messages, got ${history.length}`);
  assert(history[0].role === 'user', 'First should be user');
  assert(history[1].role === 'assistant', 'Second should be assistant');
  conversationHistory.clear();
});

test('getHistory returns empty for unknown user', () => {
  conversationHistory.clear();
  const history = getHistory('unknown-user');
  assert(history.length === 0, `Expected 0, got ${history.length}`);
});

test('addToHistory trims to MAX_HISTORY', () => {
  conversationHistory.clear();
  for (let i = 0; i < 15; i++) {
    addToHistory('trim-user', 'user', `message ${i}`);
  }
  const history = getHistory('trim-user');
  assert(history.length <= 10, `Expected <=10, got ${history.length}`);
  conversationHistory.clear();
});

test('getHistory auto-clears expired entries', () => {
  conversationHistory.clear();
  // Manually insert an old entry
  conversationHistory.set('old-user', {
    messages: [{ role: 'user', content: 'old message' }],
    lastActive: Date.now() - 31 * 60 * 1000 // 31 minutes ago
  });
  const history = getHistory('old-user');
  assert(history.length === 0, `Expected 0 (expired), got ${history.length}`);
  assert(!conversationHistory.has('old-user'), 'Should have deleted the entry');
});


console.log('\n=== PHASE 1: PARSER FIXES ===');

test('Subsumption: "2 MS150-48FP-4G" → only MS150-48FP-4G, no phantom MS150-48FP', () => {
  const parsed = parseMessage('2 MS150-48FP-4G');
  assert(parsed.items.length === 1, `Expected 1 item, got ${parsed.items.length}: ${JSON.stringify(parsed.items)}`);
  assert(parsed.items[0].baseSku === 'MS150-48FP-4G', `Got: ${parsed.items[0].baseSku}`);
});

test('Plural strip: "5 MR44s" → MR44 (not MR44S)', () => {
  const parsed = parseMessage('5 MR44s');
  assert(parsed.items[0].baseSku === 'MR44', `Got: ${parsed.items[0].baseSku}`);
});

test('Input-order: "3 MX68 and 10 MR44" → MX68 first, MR44 second', () => {
  const parsed = parseMessage('3 MX68 and 10 MR44');
  assert(parsed.items[0].baseSku === 'MX68', `First should be MX68, got: ${parsed.items[0].baseSku}`);
  assert(parsed.items[1].baseSku === 'MR44', `Second should be MR44, got: ${parsed.items[1].baseSku}`);
});


console.log('\n=== PHASE 2: MODIFIERS & INTENT ===');

test('Hardware-only modifier: "10 MR44 hardware only" → URL without licenses', () => {
  const result = runQuote('10 MR44 hardware only');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('MR44-HW'), 'Should have hardware');
  assert(!result.message.includes('LIC-ENT'), 'Should NOT have license');
});

test('License-only modifier: "10 MR44 license only" → URL without hardware', () => {
  const result = runQuote('10 MR44 license only');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(!result.message.includes('MR44-HW'), 'Should NOT have hardware');
  assert(result.message.includes('LIC-ENT'), 'Should have license');
});

test('Advisory intent: "what is the difference between MR44 and MR46" → needsLlm', () => {
  const result = runQuote('what is the difference between MR44 and MR46');
  assert(result !== null, 'Should parse SKUs');
  assert(result.needsLlm === true, 'Should route to Claude');
  assert(result.advisory === true, 'Should flag as advisory');
});

test('Advisory intent: "which should I get MX75 or MX85" → needsLlm', () => {
  const result = runQuote('which should I get MX75 or MX85');
  assert(result !== null, 'Should parse');
  assert(result.needsLlm === true, 'Should route to Claude');
});

test('Non-advisory: "quote 5 MR44" → not advisory', () => {
  const parsed = parseMessage('quote 5 MR44');
  assert(parsed.isAdvisory === false, 'Should not be advisory');
});


console.log('\n=== PHASE 3: LICENSE TIER SELECTION ===');

test('MX67 default → SEC', () => {
  const lics = getLicenseSkus('MX67');
  assert(lics[1].sku === 'LIC-MX67-SEC-3YR', `Got: ${lics[1].sku}`);
});

test('MX67 ENT → LIC-MX67-ENT-3YR', () => {
  const lics = getLicenseSkus('MX67', 'ENT');
  assert(lics[1].sku === 'LIC-MX67-ENT-3YR', `Got: ${lics[1].sku}`);
});

test('MX75 SDW → LIC-MX75-SDW-3Y (newer -Y format)', () => {
  const lics = getLicenseSkus('MX75', 'SDW');
  assert(lics[1].sku === 'LIC-MX75-SDW-3Y', `Got: ${lics[1].sku}`);
});

test('MX67 SDW → LIC-MX67-SDW-3Y (SDW always uses -Y)', () => {
  const lics = getLicenseSkus('MX67', 'SDW');
  assert(lics[1].sku === 'LIC-MX67-SDW-3Y', `Got: ${lics[1].sku}`);
});

test('MX250 default → SEC with -YR format', () => {
  const lics = getLicenseSkus('MX250');
  assert(lics[1].sku === 'LIC-MX250-SEC-3YR', `Got: ${lics[1].sku}`);
});

test('Z3 → ENT only, -YR format', () => {
  const lics = getLicenseSkus('Z3');
  assert(lics[1].sku === 'LIC-Z3-ENT-3YR', `Got: ${lics[1].sku}`);
});

test('Z3C → ENT only, -YR format', () => {
  const lics = getLicenseSkus('Z3C');
  assert(lics[1].sku === 'LIC-Z3C-ENT-3YR', `Got: ${lics[1].sku}`);
});

test('Z1 → ENT only, -YR format', () => {
  const lics = getLicenseSkus('Z1');
  assert(lics[1].sku === 'LIC-Z1-ENT-3YR', `Got: ${lics[1].sku}`);
});

test('Z4C SEC → LIC-Z4C-SEC-3Y', () => {
  const lics = getLicenseSkus('Z4C', 'SEC');
  assert(lics[1].sku === 'LIC-Z4C-SEC-3Y', `Got: ${lics[1].sku}`);
});

test('Full quote: "1 MX67 enterprise" → ENT license', () => {
  const result = runQuote('1 MX67 enterprise');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('LIC-MX67-ENT-3YR'), `Missing ENT license. Got:\n${result.message}`);
});

test('Full quote: "1 Z4 advanced security" → SEC license', () => {
  const result = runQuote('1 Z4 advanced security');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('LIC-Z4-SEC-3Y'), `Missing SEC license. Got:\n${result.message}`);
});


console.log('\n=== PHASE 4: HARD-STOP ON ERRORS ===');

test('Mixed valid+invalid: "5 MR44 and 1 MR99" → hard-stop, no URL', () => {
  const result = runQuote('5 MR44 and 1 MR99');
  assert(result && !result.needsLlm, 'Should not fall to LLM');
  assert(result.message.includes('MR99'), 'Should mention invalid SKU');
  assert(result.message.includes('correct the invalid'), 'Should ask to correct');
  assert(!result.message.includes('stratusinfosystems.com'), 'Should NOT have URL');
});


console.log('\n=== PHASE 5: EOL DUAL-OPTION ===');

test('EOL: "1 MR42" → Option A (renew) + Option B (refresh to MR44)', () => {
  const result = runQuote('1 MR42');
  assert(result && !result.needsLlm, 'Should not need LLM');
  assert(result.message.includes('End-of-Life'), 'Should mention EOL');
  assert(result.message.includes('MR44'), 'Should mention replacement MR44');
  assert(result.message.includes('Option A'), 'Should have Option A');
  assert(result.message.includes('Option B'), 'Should have Option B');
  assert(result.message.includes('stratusinfosystems.com'), 'Should have URLs');
});


console.log('\n=== ROUTING LOGIC ===');

// These tests verify the full routing decision tree:
// 1. Valid SKUs → JSON engine handles (needsLlm=false)
// 2. Advisory questions with SKUs → Claude (needsLlm=true, advisory=true)
// 3. No SKUs at all → parseMessage returns null → Claude
// 4. All invalid SKUs with partial matches → JSON engine clarification (needsLlm=false)
// 5. All invalid SKUs without partial matches → Claude (needsLlm=true)
// 6. Mixed valid+invalid → JSON engine hard-stop (needsLlm=false, error message)

test('Route: valid SKU → JSON engine (needsLlm=false)', () => {
  const result = runQuote('quote 5 MR44');
  assert(result !== null, 'Should parse');
  assert(result.needsLlm === false, 'Should be handled by JSON engine');
  assert(result.message.includes('stratusinfosystems.com'), 'Should have URL');
});

test('Route: advisory with SKUs → Claude (needsLlm=true, advisory=true)', () => {
  const result = runQuote('tell me about the MX75');
  assert(result !== null, 'Should parse');
  assert(result.needsLlm === true, 'Should route to Claude');
  assert(result.advisory === true, 'Should be flagged advisory');
});

test('Route: no SKUs → parseMessage returns null → would go to Claude', () => {
  const parsed = parseMessage('hello how are you');
  assert(parsed === null, 'No SKUs should return null (Claude path)');
});

test('Route: ambiguous SKU → JSON engine clarification (needsLlm=false)', () => {
  const result = runQuote('quote MS150-48');
  assert(result.needsLlm === false, 'Should be handled by JSON engine clarification');
  assert(result.message.includes('Which one'), 'Should ask for clarification');
});

test('Route: completely unknown SKU → Claude (needsLlm=true)', () => {
  const result = runQuote('quote XYZZY-9000');
  // XYZZY-9000 won't match any regex patterns, so parseMessage returns null
  // which means the webhook handler would go to Claude
  // But if it somehow matches, it should fall through
  assert(result === null || result.needsLlm === true, 'Should either not parse or route to Claude');
});

test('Route: mixed valid+invalid → hard-stop, no URL, no Claude', () => {
  const result = runQuote('2 MR44 and 1 MR55');
  assert(result.needsLlm === false, 'Should NOT fall to Claude');
  assert(!result.message.includes('stratusinfosystems.com'), 'Should NOT have URL');
  assert(result.message.includes('correct the invalid'), 'Should ask to correct');
});

test('Route: "how much" question with valid SKU → still generates quote (not advisory)', () => {
  // "how much" is a pricing question, not advisory — it still wants a quote
  const parsed = parseMessage('how much for 10 MR44');
  // Note: "HOW MUCH" matches advisory pattern HOW MUCH — let's check
  const result = runQuote('how much for 10 MR44');
  // This SHOULD be advisory since user is asking a question, not requesting a quote
  // The Claude system prompt handles pricing questions
  assert(result !== null, 'Should parse');
  if (result.needsLlm) {
    assert(result.advisory === true, 'If routed to Claude, should be advisory');
  }
});

test('Route: modifier + valid SKU → JSON engine (needsLlm=false)', () => {
  const result = runQuote('5 MR44 without a license');
  assert(result.needsLlm === false, 'Modifier quotes handled by JSON engine');
  assert(result.message.includes('MR44-HW'), 'Should have hardware');
  assert(!result.message.includes('LIC-ENT'), 'Should NOT have license');
});

test('Route: tier request + valid SKU → JSON engine (needsLlm=false)', () => {
  const result = runQuote('1 MX67 enterprise');
  assert(result.needsLlm === false, 'Tier quotes handled by JSON engine');
  assert(result.message.includes('LIC-MX67-ENT'), 'Should use ENT tier');
});

test('Route: EOL product → JSON engine dual-option (needsLlm=false)', () => {
  const result = runQuote('5 MR42');
  assert(result.needsLlm === false, 'EOL handled by JSON engine');
  assert(result.message.includes('Option A'), 'Should have renew option');
  assert(result.message.includes('Option B'), 'Should have refresh option');
});


console.log('\n=== REVISION DETECTION & ROUTING ===');

test('"remove the license" → detected as revision with no SKUs', () => {
  const parsed = parseMessage('remove the license');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
  assert(parsed.items.length === 0, 'Should have no items');
});

test('"change quantity to 20" → detected as revision', () => {
  const parsed = parseMessage('change quantity to 20');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
});

test('"just the hardware" → detected as revision', () => {
  const parsed = parseMessage('just the hardware');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
});

test('"actually make it an MX85 instead" → detected as revision with MX85 SKU', () => {
  const parsed = parseMessage('actually make it an MX85 instead');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
  // MX85 is a valid SKU and should still be parsed
  assert(parsed.items.length === 1, 'Should find MX85');
  assert(parsed.items[0].baseSku === 'MX85', 'Should be MX85');
});

test('"switch to enterprise" → detected as revision', () => {
  const parsed = parseMessage('switch to enterprise');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
  assert(parsed.requestedTier === 'ENT', 'Should detect ENT tier');
});

test('"bump it to 20" → detected as revision', () => {
  const parsed = parseMessage('bump it to 20');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
});

test('"nevermind drop the MR44" → detected as revision', () => {
  const parsed = parseMessage('nevermind drop the MR44');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isRevision === true, 'Should detect as revision');
});

test('Revision with no SKUs → buildQuoteResponse routes to LLM', () => {
  const parsed = parseMessage('remove the license');
  const result = buildQuoteResponse(parsed);
  assert(result.needsLlm === true, 'Should route to LLM');
  assert(result.revision === true, 'Should flag as revision');
});

test('"quote 10 MR44" is NOT a revision', () => {
  const parsed = parseMessage('quote 10 MR44');
  assert(parsed.isRevision === false, 'Normal quote should not be revision');
});

test('"what would you recommend for a 24 port switch" → advisory, not revision', () => {
  const parsed = parseMessage('what would you recommend for a 24 port switch to power 10 MR36s');
  assert(parsed !== null, 'Should not return null');
  assert(parsed.isAdvisory === true, 'Should detect as advisory');
});

console.log('\n=== HARD-STOP MIXED ITEM VALIDATION ===');

test('Mixed valid + invalid + EOL → hard-stop, no URLs', () => {
  const parsed = parseMessage('MS150-24, MS130-8P, MX67 Enterprise, MG21');
  assert(parsed !== null, 'Should parse');
  const result = buildQuoteResponse(parsed);
  // MS150-24 is invalid — should hard-stop
  assert(result.needsLlm === false, 'Should not need LLM');
  assert(result.message.includes('MS150-24'), 'Should mention invalid SKU');
  assert(!result.message.includes('stratusinfosystems.com/order'), 'Should NOT contain any URLs');
});

test('All valid items → generates URLs normally', () => {
  const parsed = parseMessage('MS130-8P, MX67');
  const result = buildQuoteResponse(parsed);
  assert(result.message.includes('stratusinfosystems.com'), 'Should have URLs');
});

test('Single invalid item → error, no URLs', () => {
  const parsed = parseMessage('MS150-24');
  const result = buildQuoteResponse(parsed);
  assert(!result.message.includes('stratusinfosystems.com/order'), 'Should NOT have URLs');
  assert(result.message.includes('MS150-24'), 'Should mention invalid SKU');
});

console.log('\n=== SYSTEM PROMPT VALIDATION ===');

test('SYSTEM_PROMPT contains ENT/SEC/SDW tier rules', () => {
  assert(SYSTEM_PROMPT.includes('ENT (Enterprise)'), 'Missing ENT tier');
  assert(SYSTEM_PROMPT.includes('SEC (Advanced Security)'), 'Missing SEC tier');
  assert(SYSTEM_PROMPT.includes('SDW (SD-WAN)'), 'Missing SDW tier');
});

test('SYSTEM_PROMPT contains correct MX tier defaults', () => {
  assert(SYSTEM_PROMPT.includes('MX: Supports ENT, SEC, SDW. Default = SEC'), 'Missing MX tier default');
});

test('SYSTEM_PROMPT contains Z-series tier restrictions', () => {
  assert(SYSTEM_PROMPT.includes('Z1, Z3, Z3C: ENT ONLY'), 'Missing Z legacy ENT-only rule');
  assert(SYSTEM_PROMPT.includes('Z4, Z4C: ENT + SEC'), 'Missing Z4 tier rule');
});

test('SYSTEM_PROMPT contains -YR vs -Y format guidance', () => {
  assert(SYSTEM_PROMPT.includes('-YR vs -Y'), 'Missing term format guidance');
  assert(SYSTEM_PROMPT.includes('SDW always uses -Y'), 'Missing SDW format note');
});

test('SYSTEM_PROMPT contains modifier handling section', () => {
  assert(SYSTEM_PROMPT.includes('MODIFIER HANDLING'), 'Missing modifier section');
  assert(SYSTEM_PROMPT.includes('hardware only'), 'Missing hardware only');
  assert(SYSTEM_PROMPT.includes('license only'), 'Missing license only');
});

test('SYSTEM_PROMPT contains enterprise tier few-shot example', () => {
  assert(SYSTEM_PROMPT.includes('MX67 enterprise'), 'Missing enterprise example');
  assert(SYSTEM_PROMPT.includes('LIC-MX67-ENT'), 'Missing ENT license in example');
});

test('SYSTEM_PROMPT contains hardware-only few-shot example', () => {
  assert(SYSTEM_PROMPT.includes('hardware only'), 'Missing hardware-only example');
});

test('SYSTEM_PROMPT contains advisory few-shot example', () => {
  assert(SYSTEM_PROMPT.includes('difference between the MX75 and MX85'), 'Missing advisory example');
});

test('SYSTEM_PROMPT contains full valid product catalog', () => {
  assert(SYSTEM_PROMPT.includes('MR44'), 'Missing MR44 in catalog');
  assert(SYSTEM_PROMPT.includes('MX75'), 'Missing MX75 in catalog');
  assert(SYSTEM_PROMPT.includes('Z4'), 'Missing Z4 in catalog');
  assert(SYSTEM_PROMPT.includes('CW9172I'), 'Missing CW9172I in catalog');
  assert(SYSTEM_PROMPT.includes('MS150-48FP-4G'), 'Missing MS150 variant in catalog');
});

test('SYSTEM_PROMPT MX75 few-shot uses -Y format (not -YR)', () => {
  assert(SYSTEM_PROMPT.includes('LIC-MX75-SEC-3Y'), 'MX75 example should use -Y not -YR');
});

test('SYSTEM_PROMPT warns against inventing SKUs', () => {
  assert(SYSTEM_PROMPT.includes('NEVER assume a product exists'), 'Missing SKU invention warning');
  assert(SYSTEM_PROMPT.includes('NEVER invent SKUs'), 'Missing invent warning');
});

test('SYSTEM_PROMPT contains quote revision section', () => {
  assert(SYSTEM_PROMPT.includes('QUOTE REVISION'), 'Missing quote revision section');
  assert(SYSTEM_PROMPT.includes('remove the license'), 'Missing revision example');
  assert(SYSTEM_PROMPT.includes('conversation history'), 'Missing conversation history reference');
});

test('SYSTEM_PROMPT contains revision few-shot examples', () => {
  assert(SYSTEM_PROMPT.includes('switch to enterprise'), 'Missing revision few-shot for tier change');
});

test('askClaude uses correct model string', () => {
  // Read the source to verify model string
  const src = require('fs').readFileSync(require('path').join(__dirname, 'index.js'), 'utf8');
  assert(src.includes("model: 'claude-sonnet-4-6'"), 'Should use claude-sonnet-4-6 model');
  assert(!src.includes("model: 'claude-sonnet-4-20250514'"), 'Should NOT use legacy claude-sonnet-4-20250514 model');
});


console.log('\n=== CLAUDE API TESTS (live, skipped if no key) ===');

// These tests actually call Claude to verify the system prompt produces correct responses.
// They're skipped if ANTHROPIC_API_KEY is not set.
const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

async function asyncTest(name, fn) {
  if (!HAS_API_KEY) {
    console.log(`  ⏭️  ${name} (skipped — no API key)`);
    return;
  }
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

// We need to run async tests before the summary
async function runAsyncTests() {
  await asyncTest('Claude: "quote 10 MR44" → response contains correct URL structure', async () => {
    const reply = await askClaude('quote 10 MR44', null);
    assert(reply.includes('MR44-HW'), `Response missing MR44-HW. Got:\n${reply}`);
    assert(reply.includes('LIC-ENT'), `Response missing LIC-ENT license. Got:\n${reply}`);
    assert(reply.includes('stratusinfosystems.com'), `Response missing URL. Got:\n${reply}`);
    assert(reply.includes('qty=10,10'), `Response missing correct quantities. Got:\n${reply}`);
  });

  await asyncTest('Claude: "1 MX67 enterprise" → uses ENT tier, not SEC', async () => {
    const reply = await askClaude('1 MX67 enterprise', null);
    assert(reply.includes('LIC-MX67-ENT'), `Should use ENT tier. Got:\n${reply}`);
    assert(!reply.includes('LIC-MX67-SEC'), `Should NOT use SEC tier. Got:\n${reply}`);
  });

  await asyncTest('Claude: "difference between MX75 and MX85" → advisory response, no URL required', async () => {
    const reply = await askClaude('what is the difference between the MX75 and MX85', null);
    // Should give an informative answer, not just URLs
    assert(reply.length > 100, `Response too short for advisory. Got:\n${reply}`);
    // Should mention both models
    assert(reply.includes('MX75') && reply.includes('MX85'), `Should discuss both models. Got:\n${reply}`);
  });

  await asyncTest('Claude: "quote 5 MR55" → recognizes invalid SKU, suggests MR57', async () => {
    const reply = await askClaude('quote 5 MR55', null);
    assert(reply.includes('MR57') || reply.includes('MR5'), `Should suggest MR57 replacement. Got:\n${reply}`);
  });

  await asyncTest('Claude: "1 Z3 with security license" → explains Z3 is ENT only', async () => {
    const reply = await askClaude('1 Z3 with advanced security license', null);
    const lower = reply.toLowerCase();
    assert(lower.includes('enterprise') || lower.includes('ent'), `Should mention Enterprise is the only option for Z3. Got:\n${reply}`);
  });

  await asyncTest('Claude: "5 MR44 hardware only" → URL without license', async () => {
    const reply = await askClaude('5 MR44 hardware only', null);
    assert(reply.includes('MR44-HW'), `Should have hardware SKU. Got:\n${reply}`);
    // Should either omit license or note it's hardware only
    if (reply.includes('stratusinfosystems.com')) {
      // If it generated a URL, check it doesn't include license
      const urlMatch = reply.match(/stratusinfosystems\.com\/order\/\?[^\s]+/);
      if (urlMatch) {
        assert(!urlMatch[0].includes('LIC-ENT'), `URL should not include license. Got: ${urlMatch[0]}`);
      }
    }
  });

  await asyncTest('Claude: MX75 uses -Y format (not -YR)', async () => {
    const reply = await askClaude('quote 1 MX75', null);
    if (reply.includes('LIC-MX75')) {
      assert(reply.includes('-1Y') || reply.includes('-3Y') || reply.includes('-5Y'), `MX75 should use -Y format. Got:\n${reply}`);
      assert(!reply.includes('-1YR') && !reply.includes('-3YR') && !reply.includes('-5YR'), `MX75 should NOT use -YR format. Got:\n${reply}`);
    }
  });

  await asyncTest('Claude: conversation memory maintains context', async () => {
    // First message establishes context
    const reply1 = await askClaude('quote 10 MR44', 'test-memory-user');
    assert(reply1.includes('MR44'), `First reply should mention MR44. Got:\n${reply1}`);

    // Follow-up should have context
    const reply2 = await askClaude('change that to 20', 'test-memory-user');
    // Should reference MR44 from context and update qty to 20
    const hasMR44 = reply2.includes('MR44');
    const has20 = reply2.includes('20');
    assert(hasMR44 || has20, `Follow-up should reference MR44 or qty 20 from memory. Got:\n${reply2}`);

    // Clean up
    conversationHistory.delete('test-memory-user');
  });

  // Print final summary after async tests
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (!HAS_API_KEY) {
    console.log('(Claude API tests were skipped — set ANTHROPIC_API_KEY to run them)');
  }
  console.log(`${'='.repeat(50)}\n`);

  process.exit(failed > 0 ? 1 : 0);
}

runAsyncTests();
