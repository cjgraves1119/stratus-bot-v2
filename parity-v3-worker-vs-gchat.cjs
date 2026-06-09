// Engine parity check: WebEx (worker/) vs Chrome-extension backend (worker-gchat/).
// Proves the V3 quoting logic is SYNCHRONIZED — same V3 classifier output must yield the same
// quote (SKUs + per-term grouping) from both engines. No network/API calls.
const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine(dir, exportNames) {
  let src = fs.readFileSync(path.join(dir, 'src/index.js'), 'utf8');
  const esc = p => path.join(dir, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { ${exportNames.join(', ')} };`;
  const tmp = path.join(os.tmpdir(), `parity-${path.basename(dir)}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const EX = ['parseMessage', 'buildQuoteResponse', 'buildQuoteFromV3', 'preserveMsAdvancedTier'];
const W = loadEngine('/tmp/v3int/worker', EX);
const G = loadEngine('/tmp/v3int/worker-gchat', EX);

// per-term SKU map from a rendered message
function perTerm(message) {
  const out = {};
  for (const line of (message || '').split('\n')) {
    const lm = line.match(/(\d)-Year Co-Term/);
    const um = line.match(/[?&]item=([^&\s]+)&qty=([0-9,]+)/g) || [];
    for (const u of um) {
      const mm = u.match(/[?&]item=([^&\s]+)&qty=([0-9,]+)/);
      const term = lm ? `${lm[1]}Y` : 'NOTERM';
      out[term] = out[term] || {};
      const skus = decodeURIComponent(mm[1]).split(','), qtys = mm[2].split(',');
      skus.forEach((sk, i) => { out[term][sk] = (out[term][sk] || 0) + (parseInt(qtys[i] || '0', 10)); });
    }
  }
  return out;
}
function render(eng, v3, text) {
  const qp = eng.buildQuoteFromV3(v3, text);
  if (!qp) return { kind: 'none' };
  if (qp.isClarification) return { kind: 'clarify', q: qp.clarificationMessage };
  const r = eng.buildQuoteResponse(qp);
  if (!r || !r.message || r.needsLlm) return { kind: 'llm' };
  return { kind: 'quote', pt: perTerm(r.message), hasNote: /[_].*[_]/.test(r.message) };
}

const v3 = (i, m = {}) => ({ intent: 'quote', clarify: { needed: false, question: '' }, items: i, modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false, ...m } });
const I = (product, intent, qty = 1) => ({ product, qty, intent });
const CASES = [
  ['duo+mr normal', v3([I('duo essentials', 'normal', 10), I('mr44', 'normal', 6)])],
  ['SME all-terms', v3([I('systems manager', 'license', 1)], { all_terms: true })],
  ['SME @5yr (cap)', v3([I('systems manager', 'license', 5)], { term_years: 5 })],
  ['liconly+normal sum', v3([I('MR44', 'license', 1), I('CW9172I', 'normal', 1)])],
  ['hwonly+normal', v3([I('CW9172I', 'hardware', 1), I('MR44', 'normal', 6)])],
  ['umbrella+mx', v3([I('umbrella DNS essentials', 'license', 5), I('mx67', 'normal', 2)])],
  ['anyconnect', v3([I('anyconnect plus', 'license', 10)], { term_years: 3 })],
  ['separate quotes', v3([I('MR46', 'normal', 5), I('MR44', 'normal', 5)], { separate_quotes: true })],
  ['mx sec 5yr', v3([I('MX67', 'normal', 10)], { tier: 'SEC', term_years: 5 })],
  ['eol mx84', v3([I('mx84', 'license', 1)])],
  ['clarify', { intent: 'quote', clarify: { needed: true, question: 'Which MX model?' }, items: [I('MX', 'normal', 3)], modifiers: {} }],
];

let pass = 0, fail = 0;
for (const [label, q] of CASES) {
  const rw = render(W, q, label), rg = render(G, q, label);
  const same = JSON.stringify(rw) === JSON.stringify(rg);
  console.log((same ? '✅' : '❌') + ' ' + label + (same ? '' : '  DIVERGENT'));
  if (!same) { console.log('    webex:', JSON.stringify(rw)); console.log('    gchat:', JSON.stringify(rg)); fail++; } else pass++;
}
console.log(`\n${fail === 0 ? '✅ ENGINES IN SYNC' : '❌ DIVERGENCE'} — ${pass}/${pass + fail} cases identical`);
process.exit(fail === 0 ? 0 : 1);
