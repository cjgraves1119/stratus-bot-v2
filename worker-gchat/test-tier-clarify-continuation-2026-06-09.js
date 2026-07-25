// Tier-clarify continuation — regression guard for the 2026-06-09 V3-canary bug:
// "200 duo licenses" → bot asks "Which Cisco Duo tier do you need? (qty: 200)" → user replies
// "Essentials" → the bare reply had no SKU, fell to the Claude fallback (19.7s, Sonnet emitted
// malformed empty order URLs: ?item=&qty=). buildTierClarifyContinuation synthesizes the combined
// request ("200 duo essentials licenses") so the deterministic engine answers instantly.
//
// Run: node worker-gchat/test-tier-clarify-continuation-2026-06-09.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine(workerDir, tag) {
  const here = path.join(__dirname, '..', workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${esc('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { buildTierClarifyContinuation, parseMessage, buildQuoteResponse };`;
  const tmp = path.join(os.tmpdir(), `tiercont-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const G = loadEngine('worker-gchat', 'gch');
const W = loadEngine('worker', 'wbx');

const DUO_Q = 'Which Cisco Duo tier do you need? (qty: 200)\n\n• **Essentials** - MFA...\nJust reply with the tier name (e.g. "Duo Advantage") or "Duo Essentials 200".';
const UMB_Q = 'Which Umbrella package do you need? (qty: 6)\n\n**Tier:**\n• **Essentials** — core protection\n• **Advantage** — ...';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

console.log('── helper: synthesis + conservative nulls (both engines must agree) ──');
const CASES = [
  ['Essentials', DUO_Q, '200 duo essentials licenses'],
  ['Duo Essentials 200', DUO_Q, '200 duo essentials licenses'],
  ['advantage', DUO_Q, '200 duo advantage licenses'],
  ['Premier please', DUO_Q, '200 duo premier licenses'],
  ['DNS Essentials', UMB_Q, '6 umbrella dns essentials licenses'],
  ['Essentials', UMB_Q, null],                       // Umbrella type unknown — never guess DNS vs SIG
  ['quote 5 MR44', DUO_Q, null],                     // fresh SKU request — not hijacked
  ['Essentials', 'Here is your quote: https://stratusinfosystems.com/order/?item=MR44-HW&qty=5', null], // no clarify pending
  ['I think we want the advantage tier for all two hundred users plus extras', DUO_Q, null], // too long — not a bare reply
  // codex round-2 hardening: questions/pricing/info follow-ups never become quotes
  ['what is advantage?', DUO_Q, null],
  ['cost of Duo Advantage', DUO_Q, null],
  ['how much is premier', DUO_Q, null],
  ['compare essentials vs advantage', DUO_Q, null],
  // "N year" is a TERM choice, not a quantity
  ['Advantage 3 year', DUO_Q, '200 duo advantage licenses 3 year'],
  ['Essentials 5yr', DUO_Q, '200 duo essentials licenses 5 year'],
  ['Duo Essentials 200 3 year', DUO_Q, '200 duo essentials licenses 3 year'],
  // codex round-3: negation / hedge / multi-tier replies are never answers
  ['not advantage', DUO_Q, null],
  ['no advantage', DUO_Q, null],
  ['not essentials, advantage', DUO_Q, null],
  ['advantage or premier', DUO_Q, null],
  ['maybe advantage', DUO_Q, null],
  ["don't do premier", DUO_Q, null],
  // codex round-4: curly apostrophe + negative phrases + SIG synonym
  ['don’t do premier', DUO_Q, null],
  ['anything but advantage', DUO_Q, null],
  ['other than advantage', DUO_Q, null],
  ['all but premier', DUO_Q, null],
  ['Secure Internet Gateway Advantage', UMB_Q, '6 umbrella sig advantage licenses'],
  ['Advantage but 3 year', DUO_Q, '200 duo advantage licenses 3 year'], // plain "but" still allowed
];
for (const [reply, lastAsst, expect] of CASES) {
  const g = G.buildTierClarifyContinuation(reply, lastAsst);
  const w = W.buildTierClarifyContinuation(reply, lastAsst);
  ok(String(g) === String(expect) && String(w) === String(expect), `${JSON.stringify(reply)} → ${JSON.stringify(expect)} (gchat+webex agree)`);
}

console.log('── end-to-end: synthesized request → deterministic engine → correct quote ──');
function skuQty(msg) {
  const map = {};
  for (const m of (msg || '').matchAll(/item=([^&\s]+)&qty=([0-9,]+)/g)) {
    const skus = decodeURIComponent(m[1]).split(','), qtys = m[2].split(',');
    skus.forEach((s, i) => { const q = parseInt(qtys[i] || '0', 10); if (!map[s] || q > map[s]) map[s] = q; });
  }
  return map;
}
for (const [eng, name] of [[G, 'gchat'], [W, 'webex']]) {
  const req = eng.buildTierClarifyContinuation('Essentials', DUO_Q);
  const r = eng.buildQuoteResponse(eng.parseMessage(req));
  const m = skuQty(r && r.message);
  ok(m['LIC-DUO-ESSENTIALS-1YR'] === 200 && m['LIC-DUO-ESSENTIALS-3YR'] === 200 && m['LIC-DUO-ESSENTIALS-5YR'] === 200,
    `${name}: "Essentials" after Duo q(200) → LIC-DUO-ESSENTIALS 1/3/5YR × 200 (deterministic, no LLM)`);
  ok(!/item=&qty=/.test(r && r.message || ''), `${name}: no empty order URLs in output`);
  const uq = eng.buildTierClarifyContinuation('DNS Essentials', UMB_Q);
  const ur = eng.buildQuoteResponse(eng.parseMessage(uq));
  const um = skuQty(ur && ur.message);
  ok(um['LIC-UMB-DNS-ESS-K9-1YR'] === 6 && um['LIC-UMB-DNS-ESS-K9-3YR'] === 6,
    `${name}: "DNS Essentials" after Umbrella q(6) → LIC-UMB-DNS-ESS-K9 × 6`);
  // term-qualified reply renders ONLY the chosen term
  const tq = eng.buildTierClarifyContinuation('Advantage 3 year', DUO_Q);
  const tr = eng.buildQuoteResponse(eng.parseMessage(tq));
  const tm = skuQty(tr && tr.message);
  ok(tm['LIC-DUO-ADVANTAGE-3YR'] === 200 && !tm['LIC-DUO-ADVANTAGE-1YR'] && !tm['LIC-DUO-ADVANTAGE-5YR'],
    `${name}: "Advantage 3 year" → LIC-DUO-ADVANTAGE-3YR × 200 ONLY (term honored, not qty 3)`);
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} assertions passed`);
process.exit(fail === 0 ? 0 : 1);
