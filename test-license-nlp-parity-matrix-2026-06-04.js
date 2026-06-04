// WS6B license-NLP variability + PARITY matrix. Loads BOTH worker/ (Webex) and
// worker-gchat (extension) engines and asserts H1 (term filter), H2 (AnyConnect
// separate per-tier), H4 (multi-tier Duo/Umbrella), H5 (CW bare-stem promotion),
// M1 (bare-family+qty), plus Webex≡extension parity on the SKU+qty multiset.
// Run: node test-license-nlp-parity-matrix-2026-06-04.js

const fs = require('fs'), path = require('path'), os = require('os');
function shim(dir, tag) {
  const here = path.join(__dirname, dir);
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
  const tmp = path.join(os.tmpdir(), `lnp-${tag}-${process.pid}.cjs`); fs.writeFileSync(tmp, src); return require(tmp);
}
const W = shim('worker', 'w'), G = shim('worker-gchat', 'g');
const render = (m, t) => { try { const r = m.buildQuoteResponse(m.parseMessage(t)); return r && r.message ? r.message : (r && r.needsLlm ? '[LLM]' : ''); } catch (e) { return '[ERR:' + e.message + ']'; } };
function skuSet(msg) { const set = {}; for (const u of (msg.match(/order\/\?item=[^\s)>\]]+/g) || [])) { const q = new URL('https://x/' + u.replace('order/', '')); (q.searchParams.get('item') || '').split(',').forEach((s, i) => { if (s) set[s] = (set[s] || 0) + (parseInt((q.searchParams.get('qty') || '').split(',')[i]) || 0); }); } return set; }
const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());
let pass = 0, fail = 0; const fails = [];
const chk = (n, c, d) => { if (c) pass++; else { fail++; fails.push(`❌ ${n}\n     ${d || ''}`); } };

// H1 term-filter: a named single term yields ONLY that term (both workers)
console.log('── H1: named-term filter (Duo/Umbrella/AnyConnect) ──');
const H1 = [
  ['Duo essentials 3 year', /ESSENTIALS-3YR/, /ESSENTIALS-(1|5)YR/],
  ['umbrella sig advantage 3yr', /UMB-SIG-ADV-K9-3YR/, /UMB-SIG-ADV-K9-(1|5)YR/],
  ['AnyConnect apex 50 3 year', /AC-APX-3Y-S1/, /AC-APX-(1|5)Y-S1/],
];
for (const [inp, want, notWant] of H1) for (const [tag, m] of [['W', W], ['G', G]]) {
  const msg = render(m, inp);
  chk(`[${tag}] "${inp}" has named term`, want.test(msg), `got ${msg.slice(0,140)}`);
  chk(`[${tag}] "${inp}" no other terms`, !notWant.test(msg), `leaked other term: ${msg.slice(0,140)}`);
}

// H2 AnyConnect untiered → BOTH tiers present (separate quotes)
console.log('── H2: AnyConnect untiered separate tiers ──');
for (const [tag, m] of [['W', W], ['G', G]]) {
  const msg = render(m, '100 AnyConnect 3 year');
  chk(`[${tag}] untiered AC has APX`, /AC-APX-3Y-S1/.test(msg), msg.slice(0,140));
  chk(`[${tag}] untiered AC has PLS`, /AC-PLS-3Y-S1/.test(msg), msg.slice(0,140));
}

// H4 multi-tier Duo/Umbrella → all named tiers
console.log('── H4: multi-tier Duo/Umbrella ──');
for (const [tag, m] of [['W', W], ['G', G]]) {
  const d = render(m, 'duo essentials, premier, and advantage 3 year');
  chk(`[${tag}] duo 3 tiers`, /ESSENTIALS-3YR/.test(d) && /PREMIER-3YR/.test(d) && /ADVANTAGE-3YR/.test(d), d.slice(0,180));
  const u = render(m, 'umbrella DNS essentials, DNS advantage, SIG advantage 3yr');
  chk(`[${tag}] umbrella 3 combos`, /UMB-DNS-ESS-K9-3YR/.test(u) && /UMB-DNS-ADV-K9-3YR/.test(u) && /UMB-SIG-ADV-K9-3YR/.test(u), u.slice(0,200));
}

// H5 CW bare-stem promotion
console.log('── H5: CW bare-stem → I-variant ──');
for (const [tag, m] of [['W', W], ['G', G]]) {
  chk(`[${tag}] CW9172 → CW9172I-RTG`, /CW9172I-RTG/.test(render(m, 'CW9172')), render(m,'CW9172').slice(0,140));
  chk(`[${tag}] CW9164 → CW9164I-MR`, /CW9164I-MR/.test(render(m, 'CW9164')), render(m,'CW9164').slice(0,140));
}

// M1 bare-family+qty → not LLM (deterministic disambiguation/quote)
console.log('── M1: bare-family+qty fallback ──');
for (const [tag, m] of [['W', W], ['G', G]]) {
  const r = m.buildQuoteResponse(m.parseMessage('quote 5 MS150'));
  chk(`[${tag}] "quote 5 MS150" deterministic (not LLM)`, r && r.needsLlm !== true, `needsLlm=${r && r.needsLlm}`);
}

// #4 fix: AnyConnect "N year" must NOT show the spurious 25-user clamp note (both)
console.log('── #4: AnyConnect "N year" no false clamp ──');
for (const [tag, m] of [['W', W], ['G', G]]) {
  const msg = render(m, 'AnyConnect plus 5 year');
  chk(`[${tag}] AC "5 year" has 5Y PLS`, /AC-PLS-5Y-S1/.test(msg), msg.slice(0,140));
  chk(`[${tag}] AC "5 year" no false clamp note`, !/bumped quantity to 25|25-user minimum/i.test(msg), `false clamp: ${msg.slice(0,140)}`);
}

// PARITY: Webex ≡ extension SKU+qty multiset
console.log('── Parity (Webex vs extension) ──');
const P = ['Duo essentials 3 year','umbrella sig advantage 3yr','AnyConnect apex 50 3 year','100 AnyConnect 3 year','duo essentials, premier, and advantage 3 year','CW9172','CW9164','3 of the MX67','quote 1 MX85, 1 MX64','MX84','10 MR44',
  'all umbrella 3 year','all duo 3 year','AnyConnect plus 5 year','duo advantage 1yr and 3yr','umbrella DNS essentials and SIG advantage 3yr'];
for (const inp of P) { const a = skuSet(render(W, inp)), b = skuSet(render(G, inp)); chk(`parity "${inp}"`, eq(a, b), `W=${JSON.stringify(a)}\n     G=${JSON.stringify(b)}`); }

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
if (fail) { console.log(fails.join('\n')); process.exit(1); }
