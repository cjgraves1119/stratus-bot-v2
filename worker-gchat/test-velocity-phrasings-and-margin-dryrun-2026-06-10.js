// Velocity Hub phrasing completion + apply_margin_to_quote dry-run guard
// (Fable final-pass 2026-06-10). Two fixes:
//  1. classifyCrmIntent: real rep phrasings ("push/send/resubmit ... to velocity hub",
//     "submit it/the deal to velocity hub") dropped to 'general' (no velocity_hub_submit
//     tool). New OR-branch routes any push/submit-class verb → velocity[ hub] to
//     'subscription'. Must NOT over-trigger on benign reads.
//  2. apply_margin_to_quote was missing from BENCHMARK_WRITE_TOOLS + the dry-run mock map
//     — a latent real-Zoho-write bypass during A/B benchmark runs.
//
// Runs the REAL classifyCrmIntent + inspects the REAL dry-run guard data.
// Run: node worker-gchat/test-velocity-phrasings-and-margin-dryrun-2026-06-10.js

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
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${esc('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { classifyCrmIntent, BENCHMARK_WRITE_TOOLS, executeToolCallDryRun };`;
  const tmp = path.join(os.tmpdir(), `velmargin-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { classifyCrmIntent, BENCHMARK_WRITE_TOOLS, executeToolCallDryRun } = loadEngine();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✅ ' + m); } else { fail++; console.log('  ❌ ' + m); } };

(async () => {
  console.log('Velocity Hub phrasings → subscription (carries velocity_hub_submit tool)');
  const should = [
    'push that DID to velocity hub', 'send that did to velocity hub',
    'resubmit to velocity', 'resubmit the did to velocity hub',
    'submit it to velocity hub', 'submit deal 12345678 to velocity hub',
    'submit the deal to velocity hub', 'fire the did over to velocity hub',
    'submit that DID to Velocity Hub', 'submit DID 12345678 to velocity hub',
    'can you submit the did',
    // codex round-2 medium-miss additions (plausible rep nouns)
    'push the estimate to velocity hub', 'send approval to velocity hub',
    'submit request to velocity hub', 'send the quote to velocity hub',
  ];
  for (const t of should) {
    const c = classifyCrmIntent(t);
    ok(c && c.class === 'subscription', `"${t}" → subscription (got ${c && c.class})`);
  }

  console.log('Benign reads + non-submit sends must NOT over-trigger to subscription');
  const shouldNot = [
    "what's velocity hub status", 'find the velocity hub deal', 'find account velocity hub',
    'deals submitted to velocity hub last week', 'how does velocity hub work', 'show velocity hub deals',
    // Codex round-1 over-triggers: email/message/invoice sends have no admin object.
    'send an email to velocity hub support', 'send a message to velocity hub support',
    'send invoice to velocity hub billing', 'forward the email to velocity hub',
    // comma-spanning false-match guard: connector must be adjacent to "velocity"
    'send it to the team, then check velocity hub status',
    // Codex round-2 over-triggers: pronoun gaps + clause bridging must not match.
    'send this email to velocity hub support', 'send them an email to velocity hub support',
    'send the team an update, it goes to velocity hub eventually',
    'send this quote URL to velocity hub support team email',
  ];
  for (const t of shouldNot) {
    const c = classifyCrmIntent(t);
    ok(!c || c.class !== 'subscription', `"${t}" → NOT subscription (got ${c && c.class})`);
  }

  console.log('Existing subscription/quote phrasings still classify correctly (no regression)');
  ok(classifyCrmIntent('generate a did for this quote').class === 'subscription', 'generate a did → subscription');
  ok(classifyCrmIntent('submit to ccw').class === 'subscription', 'submit to ccw → subscription');
  ok(classifyCrmIntent('renew my subscription').class === 'subscription', 'renew my subscription → subscription');
  const q = classifyCrmIntent('create a quote for 5 mr44');
  ok(q && q.class !== 'subscription', 'create a quote → NOT subscription');

  console.log('apply_margin_to_quote dry-run guard (no real Zoho write during benchmarks)');
  ok(BENCHMARK_WRITE_TOOLS.has('apply_margin_to_quote'), 'apply_margin_to_quote ∈ BENCHMARK_WRITE_TOOLS');
  // Exercise the REAL executeToolCallDryRun wrapper (the second dry-run map Codex flagged)
  // — it must return a SHAPED mock, not the impoverished {mocked:true,id} fallback,
  // and must NOT touch Zoho. dryRun is the explicit 5th arg (true forces the mock branch).
  const amq = await executeToolCallDryRun('apply_margin_to_quote', { quote_id: 'Q-TEST-1', target_margin: 0.2 }, {}, 'bench:test', true);
  ok(amq && amq.mocked === true, 'executeToolCallDryRun mocks apply_margin_to_quote (no real call)');
  ok(amq && amq.result && amq.result.dry_run === true && amq.result.quote_id === 'Q-TEST-1' && !amq.result.mocked,
    `→ shaped mock with quote_id + dry_run (not the impoverished {mocked,id} fallback)`);
  // velocity_hub_submit through the same wrapper, sanity.
  const vh = await executeToolCallDryRun('velocity_hub_submit', { deal_id: 'D1' }, {}, 'bench:test', true);
  ok(vh && vh.result && vh.result.dry_run === true, 'velocity_hub_submit shaped mock via wrapper');
  // Spot-check the other write tools we relied on today are still guarded.
  for (const w of ['create_deal_and_quote', 'velocity_hub_submit', 'quote_to_po_and_esign', 'zoho_update_record']) {
    ok(BENCHMARK_WRITE_TOOLS.has(w), `${w} still ∈ BENCHMARK_WRITE_TOOLS`);
  }

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
