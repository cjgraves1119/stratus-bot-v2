// WS5 (2026-06-04): worker-gchat quoting parity with worker/ (Webex) for
// Systems Manager / LIC-SME. Verifies the typed-SKU directLicense path, the
// deterministic SME natural-language handler, the directLicense URL term label,
// and over-match guards. The mixed hardware+inline-license case asserts PARITY
// with worker/ (both keep the hardware and drop the inline license — a shared
// limitation), and that the SME handler never hijacks/​drops the hardware.
//
// Run: node worker-gchat/test-ws5-lic-sme-parity-2026-06-04.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `\nmodule.exports = { parseMessage, buildQuoteResponse, licenseTermLabel };`;
  const tmp = path.join(os.tmpdir(), `stratus-ws5-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { parseMessage, buildQuoteResponse, licenseTermLabel } = buildShim();
const quote = (text) => buildQuoteResponse(parseMessage(text));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('── Part 1: typed LIC-SME directLicense path (the headline bug) ──');
t('parseMessage("10 lic-sme-3yr") → directLicense LIC-SME-3YR qty 10', () => {
  const p = parseMessage('10 lic-sme-3yr');
  assert.ok(p && p.directLicense, 'directLicense not set');
  assert.strictEqual(p.directLicense.sku, 'LIC-SME-3YR');
  assert.strictEqual(p.directLicense.qty, 10);
});
t('quote("10 lic-sme-3yr") → URL item=LIC-SME-3YR&qty=10 (not LLM)', () => {
  const r = quote('10 lic-sme-3yr');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-SME-3YR&qty=10/.test(r.message), `got: ${r.message}`);
});
t('quote("LIC-SME-1YR") → URL with LIC-SME-1YR', () => {
  const r = quote('LIC-SME-1YR');
  assert.ok(/LIC-SME-1YR/.test(r.message) && r.needsLlm === false, `got: ${r.message}`);
});

console.log('── Part 2: SME natural-language handler (context, plurals, qty vs term) ──');
t('"10 systems manager licenses" → qty 10, 1YR+3YR ONLY (5YR deprecated) + flag, not LLM', () => {
  const r = quote('10 systems manager licenses');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/LIC-SME-1YR/.test(r.message) && /LIC-SME-3YR/.test(r.message), `1/3yr missing: ${r.message}`);
  assert.ok(!/LIC-SME-5YR/.test(r.message), `5YR must NOT be quoted (deprecated): ${r.message}`);
  assert.ok(/maximum of 3-year/.test(r.message), `missing 5yr deprecation flag: ${r.message}`);
  assert.ok(/qty=10/.test(r.message), `qty missing: ${r.message}`);
});
t('"5 SME licenses" → qty 5, 1YR+3YR only (no 5YR)', () => {
  const p = parseMessage('5 SME licenses');
  const skus = (p.items || []).map(i => i.baseSku);
  assert.deepStrictEqual(skus, ['LIC-SME-1YR', 'LIC-SME-3YR'], `expected 1/3yr only, got: ${JSON.stringify(skus)}`);
  assert.ok(p.items.every(i => i.qty === 5), `qty: ${JSON.stringify(p.items)}`);
});
t('"SME 3 year license" → directLicense LIC-SME-3YR qty 1, single URL (term≠qty)', () => {
  const p = parseMessage('SME 3 year license');
  assert.ok(p.directLicense, `expected directLicense, got: ${JSON.stringify(p).slice(0,160)}`);
  assert.strictEqual(p.directLicense.sku, 'LIC-SME-3YR');
  assert.strictEqual(p.directLicense.qty, 1, `qty should be 1 (not 3 from "3 year")`);
  const r = buildQuoteResponse(p);
  const urls = (r.message || '').match(/order\/\?item=[^\s]+/g) || [];
  assert.strictEqual(urls.length, 1, `single named term must render ONE URL, got ${urls.length}: ${r.message}`);
  assert.ok(/item=LIC-SME-3YR&qty=1/.test(r.message), `got: ${r.message}`);
});
t('"10 SME 3 year licenses" → directLicense LIC-SME-3YR qty 10', () => {
  const p = parseMessage('10 SME 3 year licenses');
  assert.ok(p.directLicense && p.directLicense.sku === 'LIC-SME-3YR' && p.directLicense.qty === 10, `got: ${JSON.stringify(p).slice(0,160)}`);
});
t('over-match guard: "what is Systems Manager" (no quote context) → NOT a quote', () => {
  const p = parseMessage('what is Systems Manager');
  const json = JSON.stringify(p || {});
  assert.ok(!/LIC-SME/.test(json), `over-matched info prose: ${json.slice(0, 200)}`);
});
t('info-question guard: "what is a Systems Manager license" → NOT a quote', () => {
  assert.ok(!/LIC-SME/.test(JSON.stringify(parseMessage('what is a Systems Manager license') || {})), 'info question quoted');
});
t('info-question guard: "what are Systems Manager licenses" → NOT a quote', () => {
  assert.ok(!/LIC-SME/.test(JSON.stringify(parseMessage('what are Systems Manager licenses') || {})), 'info question quoted');
});
t('explicit-verb override: "what\'s the price of 5 SME licenses" → DOES quote', () => {
  const p = parseMessage("what's the price of 5 SME licenses");
  assert.ok(/LIC-SME/.test(JSON.stringify(p || {})), `price request not quoted: ${JSON.stringify(p).slice(0,160)}`);
});
t('polite-prefix info questions → NOT a quote', () => {
  for (const q of ['can you explain Systems Manager license', 'please describe Systems Manager licenses', 'could you explain the SME license']) {
    assert.ok(!/LIC-SME/.test(JSON.stringify(parseMessage(q) || {})), `quoted info question: "${q}"`);
  }
});
t('plural years: "SME 3 years license" → single LIC-SME-3YR (not all terms)', () => {
  const p = parseMessage('SME 3 years license');
  assert.ok(p.directLicense && p.directLicense.sku === 'LIC-SME-3YR', `plural "years" missed single-term: ${JSON.stringify(p).slice(0,160)}`);
});

console.log('── Part 4 helper: directLicense URL term label ──');
t('licenseTermLabel("LIC-SME-3YR") === "3-Year"', () => assert.strictEqual(licenseTermLabel('LIC-SME-3YR'), '3-Year'));
t('licenseTermLabel("LIC-MV-1YR") === "1-Year"', () => assert.strictEqual(licenseTermLabel('LIC-MV-1YR'), '1-Year'));
t('licenseTermLabel("LIC-MT-5Y") === "5-Year" (-Y variant)', () => assert.strictEqual(licenseTermLabel('LIC-MT-5Y'), '5-Year'));
t('licenseTermLabel(no term) === "Quote"', () => assert.strictEqual(licenseTermLabel('LIC-WEIRD'), 'Quote'));

console.log('── Part 3: mixed hardware + inline SME — must MATCH worker/ (parity, no hijack) ──');
// PARITY NOTE: running worker/ (Webex, gold standard) on this exact input shows it
// ALSO drops the inline typed LIC-SME and returns only MR44+MX67. So parity =
// keep the hardware + drop the inline license (a SHARED limitation; fixing it would
// make worker-gchat exceed worker/ — out of scope). The critical guard here is that
// the new SME handler must NOT hijack mixed input and drop the hardware.
t('mixed "mr44 x4, MX67, 3 lic-sme-3yr" RETAINS hardware (SME over-match regression guard)', () => {
  const p = parseMessage('mr44 x4, MX67, and 3 lic-sme-3yr');
  const skus = (p.items || []).map(i => i.baseSku);
  assert.ok(skus.includes('MR44'), `MR44 dropped (SME over-match): ${JSON.stringify(skus)}`);
  assert.ok(skus.includes('MX67'), `MX67 dropped (SME over-match): ${JSON.stringify(skus)}`);
  assert.ok(!p.directLicense, 'mixed input should not collapse to a single directLicense');
});
t('mixed output matches worker/: hardware multi-term present', () => {
  const r = quote('mr44 x4, MX67, and 3 lic-sme-3yr');
  assert.ok(/MR44-HW/.test(r.message || '') && /MX67-HW/.test(r.message || ''), `hardware missing: ${(r.message || '').slice(0, 200)}`);
});

console.log('── Regression + over-match guards ──');
t('"MX84" still quotes (regression)', () => {
  const r = quote('MX84');
  assert.ok(r.message && /MX84/.test(r.message), `got: ${JSON.stringify(r).slice(0,200)}`);
});
t('"quote 1 MX85, 1 MX64" NOT hijacked by SME handler', () => {
  const p = parseMessage('quote 1 MX85, 1 MX64');
  const json = JSON.stringify(p);
  assert.ok(!/LIC-SME/.test(json), `falsely matched SME: ${json.slice(0,200)}`);
});
t('bare "SME" with no license/quote context does NOT force a quote', () => {
  // "small/medium enterprise" style usage shouldn't trigger; SME alone w/o context
  const p = parseMessage('what is an SME');
  // Either no directLicense/SME items, or needsLlm — must not assert a LIC-SME quote
  const json = JSON.stringify(p || {});
  assert.ok(!/LIC-SME/.test(json), `over-matched bare SME: ${json.slice(0,200)}`);
});

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
