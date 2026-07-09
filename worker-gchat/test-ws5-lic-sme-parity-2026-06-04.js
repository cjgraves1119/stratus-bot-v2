// WS5 (2026-06-04): worker-gchat quoting parity with worker/ (Webex) for
// Systems Manager / LIC-SME. Verifies the typed-SKU directLicense path, the
// deterministic SME natural-language handler, the directLicense URL term label,
// and over-match guards. Mixed hardware+bare-SME requests must preserve the
// hardware and inject SME-AGN; typed inline LIC-SME still must not hijack or
// drop the hardware.
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
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${escPath('src/email-reply-voice-skill.json')}');`);
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
const SME_CAP_NOTE_RE = /Systems Manager \(LIC-SME\) licenses are discontinued/;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('── Part 1: typed LIC-SME directLicense path (the headline bug) ──');
t('parseMessage("10 lic-sme-3yr") → replacement quoted at qty 10 (direct or all-term list)', () => {
  const p = parseMessage('10 lic-sme-3yr');
  const skus = [
    ...(p.directLicense ? [p.directLicense] : []),
    ...(p.directLicenseList || []),
    ...(p.items || []).map(i => ({ sku: i.baseSku, qty: i.qty }))
  ];
  assert.ok(skus.some(e => /^LIC-MI-EMSC-D-1YMC-A-3YR$/.test(e.sku) && e.qty === 10), `replacement@10 missing: ${JSON.stringify(skus)}`);
  assert.ok(skus.every(e => !/^LIC-SME/.test(String(e.sku))), `legacy SME SKU present: ${JSON.stringify(skus)}`);
});
t('quote("10 lic-sme-3yr") → URL item=LIC-SME-3YR&qty=10 (not LLM)', () => {
  const r = quote('10 lic-sme-3yr');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=10/.test(r.message), `got: ${r.message}`);
});
t('quote("LIC-SME-1YR") → URL with replacement 1YR', () => {
  const r = quote('LIC-SME-1YR');
  assert.ok(/LIC-MI-EMSC-D-1YMC-A-1YR/.test(r.message) && r.needsLlm === false, `got: ${r.message}`);
});
t('quote("LIC-SME-5Y") → replacement 5YR + substitution flag', () => {
  const r = quote('LIC-SME-5Y');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-5YR&qty=1/.test(r.message), `got: ${r.message}`);
  assert.ok(!/item=LIC-SME-5Y\b/.test(r.message), `invalid SKU emitted: ${r.message}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message), `missing substitution flag: ${r.message}`);
});
t('quote("LIC-SME-4YR") → replacement 3YR (invalid-term fallback) + flag, no invalid SKU', () => {
  const r = quote('LIC-SME-4YR');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=1/.test(r.message), `got: ${r.message}`);
  assert.ok(!/item=LIC-SME-4YR\b/.test(r.message), `invalid SKU emitted: ${r.message}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message), `missing substitution flag: ${r.message}`);
});

console.log('── Part 2: SME natural-language handler (context, plurals, qty vs term) ──');
t('"10 systems manager licenses" → qty 10, replacement 1/3/5YR + flag, not LLM', () => {
  const r = quote('10 systems manager licenses');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/LIC-MI-EMSC-D-1YMC-A-1YR/.test(r.message) && /LIC-MI-EMSC-D-1YMC-A-3YR/.test(r.message) && /LIC-MI-EMSC-D-1YMC-A-5YR/.test(r.message), `1/3/5yr replacement missing: ${r.message}`);
  assert.ok(!/LIC-SME-/.test(r.message), `legacy SME SKU must NOT be quoted (discontinued): ${r.message}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message), `missing substitution flag: ${r.message}`);
  assert.ok(/qty=10/.test(r.message), `qty missing: ${r.message}`);
});
t('"5 SME licenses" → qty 5, replacement 1/3/5YR', () => {
  const p = parseMessage('5 SME licenses');
  const skus = (p.items || []).map(i => i.baseSku);
  assert.deepStrictEqual(skus, ['LIC-MI-EMSC-D-1YMC-A-1YR', 'LIC-MI-EMSC-D-1YMC-A-3YR', 'LIC-MI-EMSC-D-1YMC-A-5YR'], `expected replacement 1/3/5yr, got: ${JSON.stringify(skus)}`);
  assert.ok(p.items.every(i => i.qty === 5), `qty: ${JSON.stringify(p.items)}`);
});
t('"SME 3 year license" → directLicense replacement 3YR qty 1, single URL (term≠qty)', () => {
  const p = parseMessage('SME 3 year license');
  assert.ok(p.directLicense, `expected directLicense, got: ${JSON.stringify(p).slice(0,160)}`);
  assert.strictEqual(p.directLicense.sku, 'LIC-MI-EMSC-D-1YMC-A-3YR');
  assert.strictEqual(p.directLicense.qty, 1, `qty should be 1 (not 3 from "3 year")`);
  const r = buildQuoteResponse(p);
  const urls = (r.message || '').match(/order\/\?item=[^\s]+/g) || [];
  assert.strictEqual(urls.length, 1, `single named term must render ONE URL, got ${urls.length}: ${r.message}`);
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=1/.test(r.message), `got: ${r.message}`);
});
t('"10 SME 3 year licenses" → directLicense replacement 3YR qty 10', () => {
  const p = parseMessage('10 SME 3 year licenses');
  assert.ok(p.directLicense && p.directLicense.sku === 'LIC-MI-EMSC-D-1YMC-A-3YR' && p.directLicense.qty === 10, `got: ${JSON.stringify(p).slice(0,160)}`);
});
t('"systems manager 4 year" → replacement 3YR (invalid-term fallback) + flag, no throw', () => {
  const r = quote('systems manager 4 year');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=1/.test(r.message), `got: ${r.message}`);
  assert.ok(!/LIC-SME-4YR/.test(r.message), `invalid SKU emitted: ${r.message}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message), `missing substitution flag: ${r.message}`);
});
t('"systems manager 2 year license" → replacement 3YR (invalid-term fallback) + generalized flag, no throw', () => {
  const r = quote('systems manager 2 year license');
  assert.strictEqual(r.needsLlm, false, 'fell through to LLM');
  assert.ok(/item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=1/.test(r.message), `got: ${r.message}`);
  assert.ok(!/LIC-SME-2YR/.test(r.message), `invalid SKU emitted: ${r.message}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message), `missing substitution flag: ${r.message}`);
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
t('plural years: "SME 3 years license" → single replacement 3YR (not all terms)', () => {
  const p = parseMessage('SME 3 years license');
  assert.ok(p.directLicense && p.directLicense.sku === 'LIC-MI-EMSC-D-1YMC-A-3YR', `plural "years" missed single-term: ${JSON.stringify(p).slice(0,160)}`);
});

console.log('── Part 4 helper: directLicense URL term label ──');
t('licenseTermLabel("LIC-SME-3YR") === "3-Year"', () => assert.strictEqual(licenseTermLabel('LIC-SME-3YR'), '3-Year'));
t('licenseTermLabel("LIC-MV-1YR") === "1-Year"', () => assert.strictEqual(licenseTermLabel('LIC-MV-1YR'), '1-Year'));
t('licenseTermLabel("LIC-MT-5Y") === "5-Year" (-Y variant)', () => assert.strictEqual(licenseTermLabel('LIC-MT-5Y'), '5-Year'));
t('licenseTermLabel(no term) === "Quote"', () => assert.strictEqual(licenseTermLabel('LIC-WEIRD'), 'Quote'));

console.log('── Part 3: mixed hardware + inline SME — no hijack, bare SME injected ──');
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
t('mixed "4 mr44, 2 sme, 5 MS130-12X" injects SME-AGN and keeps hardware', () => {
  const p = parseMessage('4 mr44, 2 sme, 5 MS130-12X');
  const bySku = new Map((p.items || []).map(i => [i.baseSku, i.qty]));
  assert.strictEqual(bySku.get('MR44'), 4, `MR44 missing/wrong qty: ${JSON.stringify(p.items)}`);
  assert.strictEqual(bySku.get('SME-AGN'), 2, `SME-AGN missing/wrong qty: ${JSON.stringify(p.items)}`);
  assert.strictEqual(bySku.get('MS130-12X'), 5, `MS130-12X missing/wrong qty: ${JSON.stringify(p.items)}`);
});
t('mixed bare SME 5-year output quotes the replacement at 5-year alongside other items', () => {
  const r = quote('4 mr44, 2 sme, 1 mx67');
  const fiveLine = ((r.message || '').match(/\*\*5-Year Co-Term:\*\*[^\n]+/) || [''])[0];
  assert.ok(/LIC-MI-EMSC-D-1YMC-A-5YR/.test(fiveLine), `SME replacement missing from 5-year line: ${fiveLine}`);
  assert.ok(!/LIC-SME-/.test(r.message || ''), `legacy SME SKU emitted: ${r.message}`);
  assert.ok(/LIC-ENT-5YR/.test(fiveLine), `MR 5-year license missing from 5-year line: ${fiveLine}`);
  assert.ok(/LIC-MX67-SEC-5YR/.test(fiveLine), `MX67 5-year license missing from 5-year line: ${fiveLine}`);
  assert.ok(SME_CAP_NOTE_RE.test(r.message || ''), `missing substitution note: ${r.message}`);
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
