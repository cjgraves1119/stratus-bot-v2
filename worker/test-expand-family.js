// Focused test harness for expandFamily() and the overall quote pipeline.
// Run: node test-expand-family.js
//
// Exercises every user requirement the feature was built for:
//   - bare family SKU  ("MS150", "C9200L", "MX")
//   - filtered family  ("all 48 port PoE variants of MS150")
//   - wifi-class APs   ("all wifi 7 APs")
//   - accessory exclusion (STA-KIT, STAK-KIT, MA-*, network modules)
//   - fall-through when the input is NOT a family expansion
//   - buildQuoteResponse renders one URL per variant per term

const fs = require('fs');
const os = require('os');
const path = require('path');

// Build a CJS shim from src/index.js (same approach as test-local.js).
function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = (p) => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);

  // Strip `export default { ... };`
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }

  src += `
module.exports = {
  parseMessage: typeof parseMessage !== 'undefined' ? parseMessage : null,
  expandFamily: typeof expandFamily !== 'undefined' ? expandFamily : null,
  buildQuoteResponse: typeof buildQuoteResponse !== 'undefined' ? buildQuoteResponse : null,
  validateSku: typeof validateSku !== 'undefined' ? validateSku : null,
  catalog: typeof catalog !== 'undefined' ? catalog : null
};
`;

  const shimPath = path.join(os.tmpdir(), `stratus-expand-shim-${process.pid}.cjs`);
  fs.writeFileSync(shimPath, src);
  return require(shimPath);
}

const { parseMessage, expandFamily, buildQuoteResponse, catalog } = buildShim();

if (!expandFamily) {
  console.error('❌ expandFamily not exported from src/index.js');
  process.exit(1);
}

let pass = 0;
let fail = 0;

function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { console.log(`  ✅ ${label}`); pass++; }
  else {
    console.log(`  ❌ ${label}\n     expected: ${JSON.stringify(expected)}\n     actual:   ${JSON.stringify(actual)}`);
    fail++;
  }
}
function assertTrue(cond, label) {
  if (cond) { console.log(`  ✅ ${label}`); pass++; } else { console.log(`  ❌ ${label}`); fail++; }
}

function skus(result) {
  return result && result.items ? result.items.map(i => i.baseSku).sort() : null;
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 1. Bare family SKU ─────────────────────────────────');

{
  const r = expandFamily('MS150');
  assertTrue(r !== null, 'MS150 → expandFamily returns non-null');
  assertTrue(r.modifiers.separateQuotes === true, 'MS150 → separateQuotes flag set');
  assertEqual(skus(r), [
    'MS150-24MP-4X', 'MS150-24P-4G', 'MS150-24P-4X',
    'MS150-24T-4G', 'MS150-24T-4X',
    'MS150-48FP-4G', 'MS150-48FP-4X',
    'MS150-48LP-4G', 'MS150-48LP-4X',
    'MS150-48MP-4X',
    'MS150-48T-4G', 'MS150-48T-4X'
  ], 'MS150 bare → 12 variants, all of them');
}

{
  const r = expandFamily('C9200L');
  assertTrue(r !== null, 'C9200L → expandFamily returns non-null');
  const out = skus(r);
  assertTrue(out.includes('C9200L-24P-4G-M'), 'C9200L → 24P-4G-M included');
  assertTrue(out.includes('C9200L-48PXG-2Y-M'), 'C9200L → 48PXG-2Y-M included');
  assertTrue(!out.includes('C9200L-STA-KIT-M-O'), 'C9200L → stacking kit excluded');
  assertTrue(!out.includes('C9200L-STAK-KIT-M'), 'C9200L → stacking uplink kit excluded');
  assertTrue(out.length === 14, 'C9200L → exactly 14 switches after accessory prune');
}

{
  const r = expandFamily('MX');
  assertTrue(r !== null, 'MX → expandFamily returns non-null');
  const out = skus(r);
  assertTrue(out.includes('MX67'), 'MX → MX67 included');
  assertTrue(out.includes('MX67C-NA'), 'MX → MX67C-NA variant included');
  assertTrue(out.includes('MX450'), 'MX → MX450 included');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 2. Natural-language bare family phrasings ─────────');

for (const phrase of ['MS150s', 'MS150 switches', 'MX appliances', 'MR APs', 'MR access points', 'CW variants']) {
  const r = expandFamily(phrase);
  assertTrue(r !== null && r.items.length > 0, `"${phrase}" → expansion fires`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 3. Filtered family requests ─────────────────────────');

{
  const r = expandFamily('all 48 port PoE variants of MS150');
  assertTrue(r !== null, '48-port PoE MS150 → expansion fires');
  const out = skus(r);
  // Expect: 48FP-4G/4X, 48LP-4G/4X, 48MP-4X  (NOT 48T non-PoE)
  assertTrue(out.every(s => /-48/.test(s)), '48-port filter: all SKUs have -48');
  assertTrue(out.every(s => /-48(FP|LP|MP)-/.test(s)), '48-port PoE filter: only FP/LP/MP variants');
  assertTrue(!out.some(s => /-48T-/.test(s)), '48-port PoE filter: no data-only (-48T-)');
}

{
  const r = expandFamily('all 24 port non-PoE C9200L variants');
  assertTrue(r !== null, '24-port non-PoE C9200L → expansion fires');
  const out = skus(r);
  assertTrue(out.every(s => /-24T-/.test(s)), '24-port non-PoE filter: only -24T- variants');
  assertTrue(!out.some(s => /STA-KIT|STAK-KIT/.test(s)), 'C9200L stacking kits excluded');
}

{
  const r = expandFamily('all 48 port full PoE MS150');
  assertTrue(r !== null, '48-port FULL PoE MS150 → expansion fires');
  const out = skus(r);
  assertTrue(out.every(s => /-48FP-/.test(s)), 'Full PoE filter: only -48FP- variants');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 4. Wi-Fi class expansion ────────────────────────────');

{
  const r = expandFamily('all wifi 7 APs');
  assertTrue(r !== null, 'wifi 7 APs → expansion fires');
  const out = skus(r);
  assertTrue(out.every(s => /^CW917/.test(s)), 'wifi 7: only CW917x');
  assertTrue(!out.includes('CW9163E'), 'wifi 7: outdoor extender excluded');
  assertTrue(!out.includes('CW9800H1'), 'wifi 7: controller excluded');
  assertTrue(!out.includes('CW9179F'), 'wifi 7: specialty excluded');
}

{
  const r = expandFamily('all wifi 6e access points');
  assertTrue(r !== null, 'wifi 6e APs → expansion fires');
  const out = skus(r);
  assertTrue(out.every(s => /^CW916/.test(s)), 'wifi 6e: only CW916x');
  assertTrue(!out.includes('CW9163E'), 'wifi 6e: outdoor extender excluded');
}

{
  const r = expandFamily('all wifi 6 access points');
  assertTrue(r !== null, 'wifi 6 APs → expansion fires');
  const out = skus(r);
  assertTrue(out.every(s => /^MR/.test(s)), 'wifi 6: MR catalog only');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 5. Negative cases — must NOT hijack ─────────────────');

const negativeCases = [
  'MS150-24P-4G',                            // fully-qualified SKU
  'MS150-24P',                                // partial SKU (existing disambig)
  'quote an MS150 for me',                    // one-unit request, no "all"
  'what is the lead time for MS150',          // question
  'compare MS150 and MS130',                  // comparison
  'drop the MS150 and add MR44',              // revision
  'LIC-ENT-3YR, LIC-ENT-5YR',                // license list
  'MS150, MS130, MS210',                      // multi-family list
  '4 MR',                                     // agnostic path (existing)
  'MS150\nMS130\nMS210',                      // multi-line
  'tell me about MX67',                       // question
];
for (const msg of negativeCases) {
  const r = expandFamily(msg);
  assertTrue(r === null, `"${msg.replace(/\n/g, '\\n')}" → falls through (no hijack)`);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6. parseMessage integration ─────────────────────────');

{
  const p = parseMessage('MS150');
  assertTrue(p && p._fromFamilyExpansion === true, 'parseMessage("MS150") routes through expandFamily');
  assertTrue(p.items.length === 12, 'parseMessage("MS150") → 12 items');
  assertTrue(p.modifiers.separateQuotes === true, 'parseMessage("MS150") → separateQuotes on');
}

{
  const p = parseMessage('MS150-24P-4G');
  assertTrue(!p || !p._fromFamilyExpansion, 'parseMessage("MS150-24P-4G") does NOT trigger expansion');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 6b. Hardware-only / license-only modifiers ─────────');

{
  const p = parseMessage('quote all 48 port PoE MS150 variants hardware only');
  assertTrue(p && p._fromFamilyExpansion === true, 'HW-only phrasing still routes through expandFamily');
  assertTrue(p.modifiers.hardwareOnly === true, 'HW-only phrasing → hardwareOnly=true');
  assertTrue(p.modifiers.licenseOnly === false, 'HW-only phrasing → licenseOnly=false');
  assertTrue(p.items.length >= 4, `HW-only phrasing → still expands to multiple SKUs (got ${p.items.length})`);
}

{
  const p = parseMessage('all 48 port PoE MS150 no license');
  assertTrue(p && p._fromFamilyExpansion === true, '"no license" phrasing routes through expandFamily');
  assertTrue(p.modifiers.hardwareOnly === true, '"no license" → hardwareOnly=true');
}

{
  const p = parseMessage('all 48 port PoE MS150 hw only');
  assertTrue(p && p._fromFamilyExpansion === true, '"hw only" phrasing routes through expandFamily');
  assertTrue(p.modifiers.hardwareOnly === true, '"hw only" → hardwareOnly=true');
}

{
  const p = parseMessage('all wifi 7 APs license only');
  assertTrue(p && p._fromFamilyExpansion === true, 'license-only wifi-7 routes through expandFamily');
  assertTrue(p.modifiers.licenseOnly === true, 'license-only wifi-7 → licenseOnly=true');
  assertTrue(p.modifiers.hardwareOnly === false, 'license-only wifi-7 → hardwareOnly=false');
}

{
  const p = parseMessage('quote all 48 port PoE MS150 variants hardware only');
  const q = buildQuoteResponse(p);
  assertTrue(q && q.message, 'HW-only family → buildQuoteResponse returns a message');
  assertTrue(!/LIC-MS150-48-/.test(q.message), 'HW-only family → no LIC-MS150-48-* SKUs in URLs');
  assertTrue(/MS150-48FP-4G/.test(q.message), 'HW-only family → still includes MS150-48FP-4G');
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── 7. buildQuoteResponse end-to-end ────────────────────');

{
  const p = parseMessage('MS150');
  const q = buildQuoteResponse(p);
  assertTrue(q && q.message, 'MS150 → buildQuoteResponse returns a message');
  const msg = q.message;
  // Expect headers per SKU and 1Y/3Y/5Y links per header
  assertTrue(/\*\*MS150-24P-4G × 1:\*\*/.test(msg), 'MS150 → labeled block for MS150-24P-4G');
  assertTrue(/\*\*MS150-48FP-4X × 1:\*\*/.test(msg), 'MS150 → labeled block for MS150-48FP-4X');
  const oneYr = (msg.match(/1-Year Co-Term:/g) || []).length;
  const threeYr = (msg.match(/3-Year Co-Term:/g) || []).length;
  const fiveYr = (msg.match(/5-Year Co-Term:/g) || []).length;
  assertTrue(oneYr === 12 && threeYr === 12 && fiveYr === 12, `MS150 → 12×1Y + 12×3Y + 12×5Y URLs (got ${oneYr}/${threeYr}/${fiveYr})`);
  // No disambiguation prompt
  assertTrue(!/which.*need/i.test(msg), 'MS150 → no "which one" prompt');
}

{
  const p = parseMessage('all wifi 7 APs');
  const q = buildQuoteResponse(p);
  assertTrue(q && q.message, 'wifi 7 → buildQuoteResponse returns a message');
  const msg = q.message;
  assertTrue(/\*\*CW9172I.*× 1:\*\*/.test(msg), 'wifi 7 → CW9172I labeled block');
  assertTrue(/\*\*CW9178I.*× 1:\*\*/.test(msg), 'wifi 7 → CW9178I labeled block');
  assertTrue(!/CW9163E/.test(msg), 'wifi 7 → CW9163E (outdoor extender) NOT in output');
  assertTrue(!/CW9800H1/.test(msg), 'wifi 7 → CW9800H1 (controller) NOT in output');
}

console.log(`\n${'─'.repeat(60)}\nResults: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
