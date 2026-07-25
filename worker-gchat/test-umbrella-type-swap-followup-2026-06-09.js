// Umbrella PACKAGE-TYPE swap follow-up — regression guard for the 2026-06-09 live repro
// (D1 23:19:29): "change to SIG Advantage" after an Umbrella DNS quote fell to the Claude
// fallback because the #129 tier swap only swaps ESS↔ADV within the same package type.
// applyItemMutation now rewrites the (DNS|SIG) type segment (optionally the tier too) of
// LIC-UMB-(DNS|SIG)-(ESS|ADV)-K9-{term}, fail-closed. Runs the REAL webex
// handleFollowUpModifier with a mocked KV history.
//
// Run: node worker-gchat/test-umbrella-type-swap-followup-2026-06-09.js

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
  src += `\nmodule.exports = { handleFollowUpModifier };`;
  const tmp = path.join(os.tmpdir(), `utswap-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const W = loadEngine('worker', 'wbx');

// Mock KV whose history ends with a given assistant quote message.
const kvWith = (assistantMsg) => ({
  get: async (key, type) => ({ messages: [
    { role: 'user', content: 'umbrella for 200 users' },
    { role: 'assistant', content: 'DNS or SIG? And which tier — Essentials or Advantage? (qty: 200)' },
    { role: 'user', content: 'DNS Essentials' },
    { role: 'assistant', content: assistantMsg },
  ] }),
  put: async () => {},
});

const DNS_ESS_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-1YR&qty=200',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-3YR&qty=200',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-5YR&qty=200',
].join('\n');
const SIG_ESS_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-SIG-ESS-K9-3YR&qty=50';
const DNS_ADV_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ADV-K9-3YR&qty=75';
const SIG_ADV_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-SIG-ADV-K9-3YR&qty=10';
const MR44_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5';
const MIXED_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR,LIC-UMB-DNS-ESS-K9-3YR&qty=6,6,200';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

(async () => {
  console.log('Umbrella package-type swap — live repro');

  // 1. The exact live bug: "change to SIG Advantage" after a DNS Essentials quote
  let r = await W.handleFollowUpModifier('change to SIG Advantage', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-SIG-ADV-K9-1YR&qty=200/.test(r) && /LIC-UMB-SIG-ADV-K9-3YR&qty=200/.test(r) && /LIC-UMB-SIG-ADV-K9-5YR&qty=200/.test(r),
    '"change to SIG Advantage" after DNS-ESS → SIG-ADV 1/3/5YR × 200 (deterministic)');
  ok(r && !/DNS/.test(r), '   …and no DNS SKUs remain');
  ok(r && !/item=&qty=/.test(r), '   …and no empty order URLs');

  // 2. Type-only swap preserves each line's tier
  r = await W.handleFollowUpModifier('change to SIG', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-SIG-ESS-K9-3YR&qty=200/.test(r) && !/-ADV-/.test(r),
    '"change to SIG" (no tier) after DNS-ESS → SIG-ESS (tier preserved)');
  r = await W.handleFollowUpModifier('change to sig', 'p1', kvWith(DNS_ADV_QUOTE));
  ok(r && /LIC-UMB-SIG-ADV-K9-3YR&qty=75/.test(r),
    '"change to sig" after DNS-ADV → SIG-ADV (ADV tier preserved)');

  // 3. Other phrasings
  r = await W.handleFollowUpModifier('switch to dns advantage', 'p1', kvWith(SIG_ESS_QUOTE));
  ok(r && /LIC-UMB-DNS-ADV-K9-3YR&qty=50/.test(r), '"switch to dns advantage" after SIG-ESS → DNS-ADV');
  r = await W.handleFollowUpModifier('SIG instead', 'p1', kvWith(DNS_ADV_QUOTE));
  ok(r && /LIC-UMB-SIG-ADV-K9-3YR&qty=75/.test(r), '"SIG instead" after DNS-ADV → SIG-ADV');
  r = await W.handleFollowUpModifier('change to secure internet gateway', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-SIG-ESS-K9-3YR&qty=200/.test(r), '"change to secure internet gateway" → SIG (synonym)');
  r = await W.handleFollowUpModifier('change to umbrella sig', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-SIG-ESS-K9-3YR&qty=200/.test(r), '"change to umbrella sig" (family prefix) → SIG');

  // 4. Mixed bucket: only the Umbrella line swaps; hardware + co-term license untouched
  r = await W.handleFollowUpModifier('change to SIG', 'p1', kvWith(MIXED_QUOTE));
  ok(r && /MR44-HW/.test(r) && /LIC-ENT-3YR/.test(r) && /LIC-UMB-SIG-ESS-K9-3YR/.test(r) && !/LIC-UMB-DNS/.test(r),
    'mixed MR44+ENT+DNS bucket: "change to SIG" swaps only the Umbrella line');

  // 5. Fail-closed cases → null (falls through to revise/Claude, never a wrong quote)
  r = await W.handleFollowUpModifier('change to SIG', 'p1', kvWith(MR44_QUOTE));
  ok(r === null, 'MR44-only quote + "change to SIG" → null (no Umbrella line — fail closed)');
  r = await W.handleFollowUpModifier('change to SIG', 'p1', kvWith(SIG_ESS_QUOTE));
  ok(r === null, 'already-SIG quote + "change to SIG" → null (no-op — never re-render unchanged)');
  r = await W.handleFollowUpModifier('change to SIG Advantage', 'p1', kvWith(SIG_ADV_QUOTE));
  ok(r === null, 'already-SIG-ADV quote + "change to SIG Advantage" → null (no-op fail closed)');

  // 6. Existing branches unaffected (collision guards)
  r = await W.handleFollowUpModifier('change to advantage', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-DNS-ADV-K9-3YR&qty=200/.test(r), 'plain tier swap "change to advantage" still works (type preserved)');
  r = await W.handleFollowUpModifier('change to essentials', 'p1', kvWith(DNS_ADV_QUOTE));
  ok(r && /LIC-UMB-DNS-ESS-K9-3YR&qty=75/.test(r), 'plain tier swap "change to essentials" still works');
  r = await W.handleFollowUpModifier('change to 5', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r === null, '"change to 5" still fails closed (ambiguous qty/term — not swallowed by type swap)');

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
