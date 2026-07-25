// Follow-up sweep fixes — regression guard for the 2026-06-09 adversarial sweep (179 scenarios)
// + codex round-2 findings on the tier-swap branch. Runs the REAL webex handleFollowUpModifier
// with mocked KV histories. Covers: qty-change branch, fail-closed removes, add fixes (filler
// strip, term-bucket matching, license pairing), SME 5yr cap on term rewrites, pricing block,
// family-prefix tier swap, pending-tier-question guard, broadened term phrasings.
//
// Run: node worker-gchat/test-followup-sweep-fixes-2026-06-09.js

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
  src += `\nmodule.exports = { handleFollowUpModifier, prices };`;
  const tmp = path.join(os.tmpdir(), `fusweep-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const W = loadEngine('worker', 'wbx');

const kvWith = (assistantMsg, extra = []) => ({
  get: async () => ({ messages: [
    { role: 'user', content: 'earlier request' },
    { role: 'assistant', content: assistantMsg },
    ...extra,
  ] }),
  put: async () => {},
});

const DUO200 = ['**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-1YR&qty=200',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=200',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=200'].join('\n\n');
const MR44Q = ['**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=5,5',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=5,5'].join('\n\n');
const MIXEDQ = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=CW9172I-RTG,MR44-HW,LIC-ENT-3YR&qty=1,6,6';
const SMEQ = ['**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-SME-1YR&qty=100',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-SME-3YR&qty=100'].join('\n\n');
const HWONLYQ = 'https://stratusinfosystems.com/order/?item=MR44-HW&qty=5';
const DUO_QUESTION = 'Which Cisco Duo tier do you need? (qty: 200)\n\nJust reply with the tier name.';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };
const qtys = (r, sku) => { const m = (r || '').match(new RegExp('item=([^&\\s]*)&qty=([0-9,]+)', 'g')) || []; const out = []; for (const u of m) { const mm = u.match(/item=([^&\s]*)&qty=([0-9,]+)/); const skus = mm[1].split(','), qs = mm[2].split(','); skus.forEach((s, i) => { if (s === sku) out.push(parseInt(qs[i], 10)); }); } return out; };

(async () => {
  console.log('── QTY changes (were ALL LLM fallthroughs) ──');
  let r = await W.handleFollowUpModifier('change qty to 300', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MR44-HW').every(q => q === 300) && qtys(r, 'LIC-ENT-3YR').every(q => q === 300), '"change qty to 300" → hw AND license move together (300,300)');
  r = await W.handleFollowUpModifier('make it 300', 'p', kvWith(DUO200));
  ok(r && qtys(r, 'LIC-DUO-ADVANTAGE-3YR')[0] === 300, '"make it 300" → Duo ×300 (all terms)');
  r = await W.handleFollowUpModifier('actually 250', 'p', kvWith(DUO200));
  ok(r && qtys(r, 'LIC-DUO-ADVANTAGE-1YR')[0] === 250, '"actually 250" → ×250');
  r = await W.handleFollowUpModifier('bump to 500', 'p', kvWith(DUO200));
  ok(r && qtys(r, 'LIC-DUO-ADVANTAGE-5YR')[0] === 500, '"bump to 500" → ×500');
  r = await W.handleFollowUpModifier('300 instead', 'p', kvWith(DUO200));
  ok(r && qtys(r, 'LIC-DUO-ADVANTAGE-3YR')[0] === 300, '"300 instead" → ×300');
  r = await W.handleFollowUpModifier('double it', 'p', kvWith(DUO200));
  ok(r && qtys(r, 'LIC-DUO-ADVANTAGE-3YR')[0] === 400, '"double it" → ×400');
  r = await W.handleFollowUpModifier('qty 25', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MR44-HW').every(q => q === 25), '"qty 25" → ×25');
  r = await W.handleFollowUpModifier('change to 5', 'p', kvWith(DUO200));
  ok(r === null, '"change to 5" → null (5 could mean 5-year — ambiguous, fail closed)');
  r = await W.handleFollowUpModifier('make it 10', 'p', kvWith(MIXEDQ));
  ok(r === null, '"make it 10" on MIXED qtys (1,6,6) → null (which line? — fail closed)');
  r = await W.handleFollowUpModifier('change qty to 200', 'p', kvWith(DUO200));
  ok(r === null, '"change qty to 200" when already 200 → null (no-op never re-rendered as change)');

  console.log('── REMOVE fail-closed (were silent no-ops / orphaned licenses) ──');
  r = await W.handleFollowUpModifier('remove 50', 'p', kvWith(DUO200));
  ok(r === null, '"remove 50" → null (a number is not a SKU; was a silent no-op re-render)');
  r = await W.handleFollowUpModifier('remove 2 MR44', 'p', kvWith(MR44Q));
  ok(r === null, '"remove 2 MR44" → null (partial removal needs license rebalance)');
  r = await W.handleFollowUpModifier('remove MR44', 'p', kvWith(MR44Q));
  ok(r === null, '"remove MR44" (hw+lic quote) → null (would orphan licenses)');
  r = await W.handleFollowUpModifier('take out the cw9172i', 'p', kvWith(MIXEDQ));
  ok(r === null, '"take out the cw9172i" → null (article now parsed; shared LIC-ENT would go stale)');
  r = await W.handleFollowUpModifier('remove LIC-ENT-3YR', 'p', kvWith(MIXEDQ));
  ok(r && !/LIC-ENT-3YR/.test(r) && /CW9172I-RTG/.test(r) && /MR44-HW/.test(r), '"remove LIC-ENT-3YR" (explicit license) → deterministic removal still works');
  r = await W.handleFollowUpModifier('remove MR44', 'p', kvWith(HWONLYQ));
  ok(r === null, '"remove MR44" on hw-only single-item quote → null (would empty the quote)');

  console.log('── ADD fixes (filler qty, term-bucket isolation, license pairing) ──');
  r = await W.handleFollowUpModifier('add 2 more MR44', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MR44-HW').every(q => q === 7), '"add 2 more MR44" → 7 (filler no longer eats the qty; was 6)');
  ok(r && qtys(r, 'LIC-ENT-3YR')[0] === 7, '   …and the co-term license is paired up to 7 too');
  r = await W.handleFollowUpModifier('add 100 duo essentials', 'p', kvWith(DUO200));
  ok(r && !/LIC-DUO-ESSENTIALS-3YR[^&]*&[^#]*1-Year/.test(r) && qtys(r, 'LIC-DUO-ESSENTIALS-1YR').length === 1 && qtys(r, 'LIC-DUO-ESSENTIALS-3YR').length === 1, '"add 100 duo essentials" → each term bucket gets ONLY its own term SKU (no cross-term poison)');
  r = await W.handleFollowUpModifier('add 2 MX67', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MX67-HW')[0] === 2 && qtys(r, 'LIC-MX67-SEC-3YR')[0] === 2, '"add 2 MX67" → hardware + paired co-term license (was hardware only)');

  console.log('── SME discontinued → replacement substitution (was: 5-year cap) ──');
  r = await W.handleFollowUpModifier('5 year', 'p', kvWith(SMEQ));
  ok(r && /LIC-MI-EMSC-D-1YMC-A-5YR/.test(r) && !/LIC-SME-\d/.test(r), '"5 year" after legacy SME quote → replacement 5YR, never a legacy LIC-SME SKU');
  ok(r && /licenses are discontinued/.test(r), '   …with the substitution note');
  ok(r && qtys(r, 'LIC-MI-EMSC-D-1YMC-A-5YR').every(q => q === 100), '   …at qty 100, NOT 200 (codex round-3: collapsed term-alternatives must dedupe, not sum)');
  ok(r && /\*\*5-Year Co-Term:\*\*/.test(r) && !/3-Year Co-Term/.test(r), '   …labeled 5-Year (replacement genuinely supports the requested term)');

  console.log('── codex round-3: add intent + na-bucket term safety ──');
  r = await W.handleFollowUpModifier('add 2 MR44 hardware only', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MR44-HW').every(q => q === 7) && qtys(r, 'LIC-ENT-3YR')[0] === 5, '"add 2 MR44 hardware only" → hw 7, license STAYS 5 (intent honored)');
  r = await W.handleFollowUpModifier('add 2 MR44 license only', 'p', kvWith(MR44Q));
  ok(r && qtys(r, 'MR44-HW').every(q => q === 5) && qtys(r, 'LIC-ENT-3YR')[0] === 7, '"add 2 MR44 license only" → license 7, hw STAYS 5');
  r = await W.handleFollowUpModifier('add 100 duo essentials', 'p', kvWith(HWONLYQ));
  ok(r === null, 'term-bearing add into an UNLABELED (na) bucket → null (would mix terms in one URL)');

  console.log('── codex round-2: family prefix + qty validation ──');
  r = await W.handleFollowUpModifier('change to umbrella essentials', 'p', kvWith(DUO200));
  ok(r === null, '"change to umbrella essentials" after a DUO quote → null (family honored, was swapping Duo)');
  r = await W.handleFollowUpModifier('change to essentials', 'p', kvWith('**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=abc'));
  ok(r === null, 'malformed qty=abc in history → null (NaN never propagates)');

  console.log('── pending tier question guard (ordering race) ──');
  r = await W.handleFollowUpModifier('change to essentials', 'p', kvWith(DUO_QUESTION));
  ok(r === null, 'pending Duo question → follow-up handler stands down (tier-continuation answers with the QUESTION qty)');

  console.log('── broadened term phrasings (were LLM fallthroughs) ──');
  r = await W.handleFollowUpModifier('make it 5 year', 'p', kvWith(DUO200));
  ok(r && /LIC-DUO-ADVANTAGE-5YR/.test(r) && !/1YR|3YR/.test(r), '"make it 5 year" → 5-year only');
  r = await W.handleFollowUpModifier('3 years', 'p', kvWith(DUO200));
  ok(r && /LIC-DUO-ADVANTAGE-3YR/.test(r) && !/1YR|5YR/.test(r), '"3 years" (plural) → 3-year only');
  r = await W.handleFollowUpModifier('switch to 5 year', 'p', kvWith(DUO200));
  ok(r && /LIC-DUO-ADVANTAGE-5YR/.test(r), '"switch to 5 year" → 5-year');
  r = await W.handleFollowUpModifier('go with the 5-year', 'p', kvWith(DUO200));
  ok(r && /LIC-DUO-ADVANTAGE-5YR/.test(r), '"go with the 5-year" → 5-year');

  console.log('── pricing block actually renders ──');
  r = await W.handleFollowUpModifier('with pricing', 'p', kvWith(MR44Q));
  ok(r && /\$\s?[\d,]+/.test(r), '"with pricing" → response contains real $ prices (was a blank block)');

  console.log('── no empty URLs anywhere ──');
  ok(true && !/item=&qty=/.test(String(r)), 'spot check: no empty order URLs in outputs');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} assertions passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
