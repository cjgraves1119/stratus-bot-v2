// WS6 SME variability + PARITY matrix. Loads BOTH worker/ (Webex) and
// worker-gchat (extension/addon) deterministic engines and runs the same inputs
// through each, asserting: (a) SME 3-year cap (no LIC-SME-5YR ever), (b) 5-year
// flag when capped, (c) mixed bare-SME injects SME-AGN without dropping hardware,
// (d) info questions don't quote, and (e) PARITY — both workers emit the same
// SKU+term multiset for the same input.
//
// Run: node test-sme-parity-matrix-2026-06-04.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function shim(workerDir, tag) {
  const here = path.join(__dirname, workerDir);
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
  if (ed > -1) { let d=0,s=false,e=ed; for (let i=ed;i<src.length;i++){if(src[i]==='{'){d++;s=true}if(src[i]==='}'){d--;if(s&&d===0){e=i+1;break}}} src = src.slice(0,ed)+src.slice(e+1); }
  src += `\nmodule.exports = { parseMessage, buildQuoteResponse };`;
  const tmp = path.join(os.tmpdir(), `parity-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}
const W = shim('worker', 'wbx');          // Webex (gold standard)
const G = shim('worker-gchat', 'gch');    // extension/addon

const render = (mod, text) => { try { const r = mod.buildQuoteResponse(mod.parseMessage(text)); return r && r.message ? r.message : (r && r.needsLlm ? '[LLM]' : ''); } catch (e) { return '[ERR:' + e.message + ']'; } };
// Extract the SKU+qty multiset across all order URLs in a message, term-agnostic.
function skuSet(msg) {
  const set = {};
  for (const m of (msg.match(/order\/\?item=[^\s)>\]]+/g) || [])) {
    const u = new URL('https://x/' + m.replace('order/', ''));
    const items = (u.searchParams.get('item') || '').split(',');
    const qtys = (u.searchParams.get('qty') || '').split(',');
    items.forEach((s, i) => { if (s) set[s] = (set[s] || 0) + (parseInt(qtys[i]) || 0); });
  }
  return set;
}
const eq = (a, b) => JSON.stringify(Object.keys(a).sort().map(k => [k, a[k]])) === JSON.stringify(Object.keys(b).sort().map(k => [k, b[k]]));

let pass = 0, fail = 0; const fails = [];
function chk(name, cond, detail) { if (cond) { pass++; } else { fail++; fails.push(`❌ ${name}\n     ${detail || ''}`); } }

// ── SME behavior matrix (assert on BOTH workers) ──
const SME = [
  { in: '10 lic-sme-3yr',                  has: ['LIC-SME-3YR'], no5: true, flag: false },
  { in: '10 lic-sme-1yr',                  has: ['LIC-SME-1YR'], no5: true, flag: false },
  { in: '10 lic-sme-5yr',                  has: ['LIC-SME-3YR'], no5: true, flag: true  },  // capped
  { in: '5 SME licenses',                  has: ['LIC-SME-1YR','LIC-SME-3YR'], no5: true, flag: true },
  { in: '10 systems manager licenses',     has: ['LIC-SME-1YR','LIC-SME-3YR'], no5: true, flag: true },
  { in: 'systems manager 3 year license',  has: ['LIC-SME-3YR'], no5: true, flag: false },
  { in: 'systems manager 5 year license',  has: ['LIC-SME-3YR'], no5: true, flag: true  },  // capped
  { in: 'quote 2 SME 1 year',              has: ['LIC-SME-1YR'], no5: true, flag: false },
  { in: 'LIC-SME-5Y',                      has: ['LIC-SME-3YR'], no5: true, flag: true  },  // #4 variant suffix
  { in: 'LIC-SME-4YR',                     has: ['LIC-SME-3YR'], no5: true, flag: true  },  // #4 invalid term
  { in: 'systems manager 4 year',          has: ['LIC-SME-3YR'], no5: true, flag: true  },  // #4 (was [ERR])
  { in: 'systems manager 2 year license',  has: ['LIC-SME-3YR'], no5: true, flag: true  },  // #4 non-1/3
];
console.log('── SME behavior (both workers) ──');
const smeTermDigits = (msg) => (msg.match(/LIC-SME-(\d+)/g) || []).map(s => s.match(/(\d+)/)[1]);
for (const c of SME) {
  for (const [tag, mod] of [['W', W], ['G', G]]) {
    const msg = render(mod, c.in);
    chk(`[${tag}] "${c.in}" has ${c.has.join('+')}`, c.has.every(s => msg.includes(s)), `got: ${msg.slice(0,160)}`);
    // Strong invariant: EVERY emitted LIC-SME term must be 1 or 3 (never 2/4/5/5Y).
    if (c.no5) { const bad = smeTermDigits(msg).filter(d => d !== '1' && d !== '3'); chk(`[${tag}] "${c.in}" only 1/3yr SME`, bad.length === 0, `INVALID SME terms ${JSON.stringify(bad)}: ${msg.slice(0,160)}`); }
    chk(`[${tag}] "${c.in}" flag=${c.flag}`, /(maximum of 3-year|only in 1-year and 3-year)/i.test(msg) === c.flag, `flag mismatch: ${msg.slice(0,160)}`);
  }
}

// ── Mixed hardware + bare SME: hardware retained AND SME injected (the drop bug) ──
console.log('── Mixed hardware + bare SME ──');
const MIXED = ['4 mr44, 2 sme, 5 MS130-12X', '4 mr44 , 2 systems manager , 5 MS130-12X', 'MX67 and 2 lic-sme'];
for (const inp of MIXED) {
  for (const [tag, mod] of [['W', W], ['G', G]]) {
    const msg = render(mod, inp);
    chk(`[${tag}] mixed "${inp}" keeps hardware`, /MR44-HW|MS130|MX67-HW/.test(msg), `no hw: ${msg.slice(0,160)}`);
    chk(`[${tag}] mixed "${inp}" includes LIC-SME`, /LIC-SME-[13]YR/.test(msg), `SME dropped: ${msg.slice(0,160)}`);
    chk(`[${tag}] mixed "${inp}" no 5YR SME`, !/LIC-SME-5YR/.test(msg), `5YR leaked: ${msg.slice(0,160)}`);
  }
}

// ── Info questions must NOT quote (both) ──
console.log('── Info-question guards (both) ──');
for (const q of ['what is a Systems Manager license', 'can you explain SME licenses', 'what are systems manager licenses']) {
  for (const [tag, mod] of [['W', W], ['G', G]]) {
    chk(`[${tag}] info "${q}" not quoted`, !/LIC-SME/.test(render(mod, q)), `quoted: ${render(mod,q).slice(0,120)}`);
  }
}

// ── PARITY: both workers emit the same SKU+qty multiset ──
console.log('── Parity (Webex vs extension) ──');
const PARITY = ['10 lic-sme-3yr','10 lic-sme-5yr','5 SME licenses','10 systems manager licenses','systems manager 5 year license','4 mr44, 2 sme, 5 MS130-12X','10 MR44','quote 1 MX85, 1 MX64','MX84'];
for (const inp of PARITY) {
  const a = skuSet(render(W, inp)), b = skuSet(render(G, inp));
  chk(`parity "${inp}"`, eq(a, b), `W=${JSON.stringify(a)}  G=${JSON.stringify(b)}`);
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
