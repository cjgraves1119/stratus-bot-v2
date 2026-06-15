// MS130-8P-I multi-segment SKU regression (2026-06-12). Chris reported the
// extension quoted the base MS130-8P (and one surface fell to Sonnet) when he
// asked for MS130-8P-I. Root cause: the MS-switch SKU regex
//   /MS[12345]\d{2}R?-[\dA-Z]+(?:-RF)?/   (skuPatterns + the looksLikeSku guard)
// captured only ONE dash-segment, so "MS130-8P-I" → "MS130-8P" — the "-I"
// (internal-PSU variant, a distinct/pricier unit, catalog key MS130-8P-I-HW)
// was dropped before validation. Fixed by allowing an optional 2nd segment.
//
// Runs the REAL parseMessage + buildQuoteResponse via the CJS shim.
// Run: node worker-gchat/test-ms130-8p-i-variant-2026-06-12.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { parseMessage, buildQuoteResponse, looksLikeSku: (typeof looksLikeSku !== 'undefined' ? looksLikeSku : null) };`;
  const tmp = path.join(os.tmpdir(), `ms130-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { parseMessage, buildQuoteResponse } = loadEngine();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

const quoteSkus = (text) => {
  const parsed = parseMessage(text);
  if (!parsed) return { parsed: null, skus: [], msg: null };
  const res = buildQuoteResponse(parsed);
  const msg = res && res.message ? res.message : '';
  const skus = new Set();
  for (const m of msg.matchAll(/item=([^&\s)]+)/g)) m[1].split(',').forEach(s => skus.add(s.toUpperCase()));
  return { parsed, skus: [...skus], msg, needsLlm: res && res.needsLlm };
};

console.log('MS130-8P-I must quote the -I variant, not the base MS130-8P');
for (const text of ['MS130-8P-I', 'quote a MS130-8P-I', '2 MS130-8P-I', 'MS130-8P-I 3 year']) {
  const r = quoteSkus(text);
  ok(r.skus.some(s => s.includes('MS130-8P-I')), `"${text}" → quotes MS130-8P-I* (got: ${r.skus.join(', ') || 'none'})`);
  ok(!r.skus.some(s => /MS130-8P-(?!I)/.test(s) && !s.includes('MS130-8P-I')), `"${text}" → does NOT quote the base MS130-8P-HW`);
  ok(!r.needsLlm, `"${text}" → resolved deterministically (no LLM fallback)`);
}

console.log('License stays correct (LIC-MS130-CMPT) for the -I variant');
{
  const r = quoteSkus('MS130-8P-I');
  ok(r.skus.some(s => s.startsWith('LIC-MS130-CMPT')), `MS130-8P-I license → LIC-MS130-CMPT* (got: ${r.skus.filter(s=>s.startsWith('LIC')).join(',')})`);
}

console.log('Codex regression guard: -HW / term suffixes must NOT be swallowed (no no-quote)');
for (const text of ['MS130-8P-HW', 'MS130-8P-3YR']) {
  const r = quoteSkus(text);
  ok(r.skus.some(s => s.includes('MS130-8P') && !s.includes('MS130-8P-I')), `"${text}" → still quotes the base MS130-8P-HW (got: ${r.skus.join(', ') || 'none'})`);
  ok(!r.needsLlm, `"${text}" → resolved deterministically (not kicked to LLM/no-quote)`);
}
{
  const r = quoteSkus('MS225-48-RF');
  ok(r.parsed !== null, 'MS225-48-RF still parses (the -RF path is intact)');
}

console.log('No regression on single-segment + existing multi-segment MS SKUs');
for (const [text, want] of [['MS130-8P', 'MS130-8P-HW'], ['MS130-24X', 'MS130-24X-HW'], ['MS225-48FP', 'MS225-48FP-HW'], ['MS150-24P-4G', 'MS150-24P-4G']]) {
  const r = quoteSkus(text);
  ok(r.skus.some(s => s.includes(want.replace('-HW',''))), `"${text}" still quotes ${want} (got: ${r.skus.join(', ') || 'none'})`);
}
// base MS130-8P must NOT bleed into the -I variant
{
  const r = quoteSkus('MS130-8P');
  ok(!r.skus.some(s => s.includes('MS130-8P-I')), 'base "MS130-8P" does NOT quote the -I variant');
}

console.log('');
console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
