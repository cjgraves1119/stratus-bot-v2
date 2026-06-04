// WS6 completeness sweep — broad variability across families/phrasings, run
// through BOTH workers. Flags: (a) exceptions, (b) Webex↔extension parity
// divergence, (c) any invalid SME term leak (only 1/3 allowed, never 5YR/5Y/etc).
// This is the "expand to other scenarios" critic pass before hand-off.
// Run: node test-completeness-sweep-2026-06-04.js

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
  const tmp = path.join(os.tmpdir(), `cs-${tag}-${process.pid}.cjs`); fs.writeFileSync(tmp, src); return require(tmp);
}
const W = shim('worker', 'w'), G = shim('worker-gchat', 'g');
const render = (m, t) => { try { const r = m.buildQuoteResponse(m.parseMessage(t)); return { msg: r && r.message ? r.message : '', llm: !!(r && r.needsLlm), err: null }; } catch (e) { return { msg: '', llm: false, err: e.message }; } };
function skuSet(msg) { const o = {}; for (const u of (msg.match(/order\/\?item=[^\s)>\]]+/g) || [])) { const q = new URL('https://x/' + u.replace('order/', '')); (q.searchParams.get('item') || '').split(',').forEach((s, i) => { if (s) o[s] = (o[s] || 0) + (parseInt((q.searchParams.get('qty') || '').split(',')[i]) || 0); }); } return o; }
const eq = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

const INPUTS = [
  // hardware families
  '10 MR44','MR46 5yr','MX67','MX68CW','MX85 3 year','MX95','MX105','MX250','MX450','MS120-8','MS125-24','MS130-12X','MS150-24-4G','MS210-24','MS225-48LP','MS250-48','MS350-48FP','MS390-48','MS410-16','MS425-16','C9200L-24P-4X','C9300-24UX','C9300-48P','C9350-48','MG41','MG52','MV12','MV63','MT10','MT30','Z3','Z4','CW9162','CW9164','CW9166','CW9172','CW9176','CW9178',
  // license families
  '10 lic-ent-3yr','5 MR licenses','4 MV licenses 3 year','MT licenses','lic-mx67-sec-5yr','Duo essentials 3 year','duo advantage','umbrella sig advantage 3yr','all duo 3 year','100 AnyConnect','AnyConnect plus 3 year',
  // SME (the WS6 focus)
  '10 lic-sme-3yr','10 lic-sme-5yr','5 SME licenses','systems manager 5 year','systems manager 2 year license','LIC-SME-4YR',
  // mixed
  '4 mr44, 2 sme, 5 MS130-12X','2 MR44 and 1 MX67 and 3 MS225-48LP','MS350-48FP and 4 MR46 and 2 MV12','3 of the MX67 and 5 of the MR44','quote 1 MX85, 1 MX64','mx84 and 3 lic-ent-5yr',
  // EOL
  'MS220-8P','MX64','MS320-24','MR42',
  // term/qty phrasings
  'MR44 x4','quote 5 MR44','MR44 qty 10','10 MR44 1 year only',
  // negative / info
  'what is an MX67','hello','do you sell routers','quote',
];

let errs = 0, divs = 0, smeLeaks = 0; const issues = [];
for (const inp of INPUTS) {
  const a = render(W, inp), b = render(G, inp);
  if (a.err) { errs++; issues.push(`ERR[W] "${inp}": ${a.err}`); }
  if (b.err) { errs++; issues.push(`ERR[G] "${inp}": ${b.err}`); }
  for (const [tag, r] of [['W', a], ['G', b]]) {
    const bad = (r.msg.match(/LIC-SME-(\d+)/g) || []).map(s => s.match(/(\d+)/)[1]).filter(d => d !== '1' && d !== '3');
    if (bad.length) { smeLeaks++; issues.push(`SME-LEAK[${tag}] "${inp}": invalid terms ${JSON.stringify(bad)}`); }
  }
  if (!a.err && !b.err && !eq(skuSet(a.msg), skuSet(b.msg))) { divs++; issues.push(`DIVERGE "${inp}"\n     W=${JSON.stringify(skuSet(a.msg))}\n     G=${JSON.stringify(skuSet(b.msg))}`); }
}
console.log(`Completeness sweep: ${INPUTS.length} inputs × 2 workers`);
console.log(`  exceptions: ${errs}`);
console.log(`  Webex↔extension parity divergences: ${divs}`);
console.log(`  invalid-SME-term leaks: ${smeLeaks}`);
if (issues.length) { console.log('\nISSUES:\n' + issues.join('\n')); process.exit(1); }
console.log('\n✅ CLEAN — no exceptions, full parity, no SME leaks.');
