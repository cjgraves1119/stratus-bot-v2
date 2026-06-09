// Duo/Umbrella tier-swap follow-up — regression guard for the 2026-06-09 canary bug #2:
// "200 duo licenses" → "Advantage" (tier-continuation quote) → "change to essentials" had no
// deterministic handler, fell to the Claude fallback (D1 row 4738: Sonnet emitted malformed
// empty ?item=&qty= URLs). applyItemMutation now swaps the tier segment of Duo/Umbrella SKUs,
// fail-closed. Runs the REAL webex handleFollowUpModifier with a mocked KV history.
//
// Run: node worker-gchat/test-duo-tier-swap-followup-2026-06-09.js

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
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { handleFollowUpModifier };`;
  const tmp = path.join(os.tmpdir(), `tswap-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const W = loadEngine('worker', 'wbx');

// Mock KV whose history ends with a given assistant quote message.
const kvWith = (assistantMsg) => ({
  get: async (key, type) => ({ messages: [
    { role: 'user', content: '200 duo licenses' },
    { role: 'assistant', content: 'Which Cisco Duo tier do you need? (qty: 200)' },
    { role: 'user', content: 'Advantage' },
    { role: 'assistant', content: assistantMsg },
  ] }),
  put: async () => {},
});

const DUO_ADV_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-1YR&qty=200',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=200',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=200',
].join('\n');
const UMB_DNS_ESS_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-3YR&qty=6';
const MR44_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

(async () => {
  // 1. The exact live bug: "change to essentials" after a Duo Advantage quote
  let r = await W.handleFollowUpModifier('change to essentials', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-ESSENTIALS-1YR&qty=200/.test(r) && /LIC-DUO-ESSENTIALS-3YR&qty=200/.test(r) && /LIC-DUO-ESSENTIALS-5YR&qty=200/.test(r),
    '"change to essentials" after Duo Advantage → ESSENTIALS 1/3/5YR × 200 (deterministic)');
  ok(r && !/ADVANTAGE/.test(r), '   …and no ADVANTAGE SKUs remain');
  ok(r && !/item=&qty=/.test(r), '   …and no empty order URLs');

  // 2. Other phrasings
  r = await W.handleFollowUpModifier('swap to premier', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-PREMIER-3YR&qty=200/.test(r), '"swap to premier" → PREMIER SKUs');
  r = await W.handleFollowUpModifier('switch to essentials', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-ESSENTIALS-3YR/.test(r), '"switch to essentials" (new SWITCH prefix) works');

  // 3. Umbrella: tier swap within the same package type
  r = await W.handleFollowUpModifier('change to advantage', 'p1', kvWith(UMB_DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-DNS-ADV-K9-3YR&qty=6/.test(r), 'Umbrella DNS ESS → "change to advantage" → DNS-ADV (type preserved)');

  // 4. Fail-closed cases → null (falls through to V2-revise/Claude, never a wrong quote)
  r = await W.handleFollowUpModifier('change to premier', 'p1', kvWith(UMB_DNS_ESS_QUOTE));
  ok(r === null, 'Umbrella + "change to premier" → null (Umbrella has no Premier — fail closed)');
  r = await W.handleFollowUpModifier('change to essentials', 'p1', kvWith(MR44_QUOTE));
  ok(r === null, 'MR44 hardware quote + "change to essentials" → null (nothing swappable — fail closed)');

  // 5. Existing mutations unaffected
  r = await W.handleFollowUpModifier('3 year only', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-ADVANTAGE-3YR/.test(r) && !/1YR|5YR/.test(r), '"3 year only" term filter still works');

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} assertions passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
