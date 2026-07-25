// Telemetry blind-spot fixes (2026-06-10) — two confirmed production gaps:
//
// 1. WebEx clarify turns never logged: the deterministic-parse branch in the
//    webex webhook (worker/src/index.js, quoteParsed.isClarification) sent the
//    clarification question and returned WITHOUT a bot_usage row. The missing
//    "200 duo licenses" turn made the 2026-06-09 tier-continuation root-cause
//    blind. Fix mirrors the tier-continuation logging pattern with
//    responsePath 'clarify-question'.
//
// 2. Benchmark rows pollute production analytics: askClaudeForBenchmark →
//    askClaude threads personId 'bench:task_NN:<ts>', but trackUsage's non-eval
//    D1 insert hardcoded bot='gchat' / person_id=NULL ("filled by caller if
//    available" — never was). ~415-470 untagged A/B rows/day, response_path
//    'crm_agent', indistinguishable from real traffic. Fix: botFromPersonId
//    maps 'bench:' → 'benchmark', and trackUsage tags bench rows only (real
//    traffic keeps its exact prior shape).
//
// Drives the REAL botFromPersonId + trackUsage with a mock D1 capturing bind
// args. Run: node worker-gchat/test-telemetry-blind-spots-2026-06-10.js

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
  src += `\nmodule.exports = { botFromPersonId, trackUsage };`;
  const tmp = path.join(os.tmpdir(), `telemetry-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { botFromPersonId, trackUsage } = loadEngine();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

(async () => {
  // ── FIX 2a: botFromPersonId tags bench ids ─────────────────────────────────
  console.log('botFromPersonId — bench tagging');
  ok(botFromPersonId('bench:task_49:123') === 'benchmark', "'bench:task_49:1718000000000'-style id → 'benchmark'");
  ok(botFromPersonId('bench:task_01:1718000000000') === 'benchmark', "other bench task ids → 'benchmark'");
  ok(botFromPersonId('BENCH:task_49:123') === 'benchmark', "case-insensitive (id is lowercased first)");

  console.log('botFromPersonId — existing prefixes unchanged (regression)');
  ok(botFromPersonId('chrome-ext-chat-abc123') === 'chrome-chat', "'chrome-ext-chat-*' → 'chrome-chat'");
  ok(botFromPersonId('chrome-ext-quote-abc123') === 'chrome-quote', "'chrome-ext-quote-*' → 'chrome-quote'");
  ok(botFromPersonId('chrome-ext-other') === 'chrome-ext', "'chrome-ext-*' (other) → 'chrome-ext'");
  ok(botFromPersonId('gw:user@example.com-chrome-ext-chat-1') === 'chrome-chat', "gateway-wrapped chrome-ext id (substring match) → 'chrome-chat'");
  ok(botFromPersonId('addon-session-1') === 'addon', "'addon*' → 'addon'");
  ok(botFromPersonId('webex-person-9') === 'webex', "'webex*' → 'webex'");
  ok(botFromPersonId('gw:chrisg@stratusinfosystems.com') === 'gchat', "gateway email id → 'gchat' (default)");
  ok(botFromPersonId('spaces/AAQAbCdEfGh') === 'gchat', "bare GChat space id → 'gchat' (default)");
  ok(botFromPersonId('chrisg@stratusinfosystems.com') === 'gchat', "bare email → 'gchat' (default)");
  ok(botFromPersonId(null) === 'gchat', "null → 'gchat' (default)");
  ok(botFromPersonId('') === 'gchat', "empty string → 'gchat' (default)");

  // ── FIX 2b: trackUsage D1 write — bench rows tagged, real traffic untouched ─
  console.log('trackUsage D1 write — bench personId reaches bot_usage');
  const makeEnv = (binds) => ({
    CONVERSATION_KV: { get: async () => null, put: async () => {} },
    ANALYTICS_DB: { prepare: (sql) => ({ bind: (...args) => ({ run: async () => { binds.push({ sql, args }); } }) }) }
  });
  const usage = { input_tokens: 1000, output_tokens: 200 };
  const findUsageInsert = (binds) => binds.find(b => /INSERT INTO bot_usage \(/.test(b.sql));

  // Bench run: source 'crm-agent', personId 'bench:...'
  let binds = [];
  await trackUsage(makeEnv(binds), 'claude-sonnet-4-6', usage, 'crm-agent', null, null, 'bench:task_49:1718000000000');
  let row = findUsageInsert(binds);
  ok(!!row, 'bench crm-agent call writes a bot_usage row');
  ok(row && row.args[0] === 'benchmark', "→ bot = 'benchmark' (was 'gchat')");
  ok(row && row.args[1] === 'bench:task_49:1718000000000', '→ person_id = bench personId (was NULL)');
  ok(row && row.args[2] === 'crm_agent', "→ response_path stays 'crm_agent'");

  // Real gchat traffic: personId threaded but row shape must NOT change
  binds = [];
  await trackUsage(makeEnv(binds), 'claude-sonnet-4-6', usage, 'crm-agent', null, null, 'spaces/AAQAbCdEfGh');
  row = findUsageInsert(binds);
  ok(row && row.args[0] === 'gchat', "real gchat traffic → bot stays 'gchat'");
  ok(row && row.args[1] === null, '→ person_id stays NULL (real traffic unchanged)');
  ok(row && row.args[2] === 'crm_agent', "→ response_path stays 'crm_agent'");

  // Real addon traffic: prior mapping preserved
  binds = [];
  await trackUsage(makeEnv(binds), 'claude-sonnet-4-6', usage, 'addon-analyze', null, null, null);
  row = findUsageInsert(binds);
  ok(row && row.args[0] === 'addon' && row.args[1] === null, "addon source → bot 'addon', person_id NULL (unchanged)");

  // No-personId call (legacy callers omit the new 7th param entirely)
  binds = [];
  await trackUsage(makeEnv(binds), 'claude-sonnet-4-6', usage, 'crm-agent');
  row = findUsageInsert(binds);
  ok(row && row.args[0] === 'gchat' && row.args[1] === null, "legacy 4-arg call → bot 'gchat', person_id NULL (unchanged)");

  // Bench continuation rows (source 'crm-agent-continue') also tagged
  binds = [];
  await trackUsage(makeEnv(binds), 'claude-sonnet-4-6', usage, 'crm-agent-continue', null, null, 'bench:task_12:99');
  row = findUsageInsert(binds);
  ok(row && row.args[0] === 'benchmark' && row.args[1] === 'bench:task_12:99', 'bench continuation rows tagged too');

  // ── Source revert-guards ────────────────────────────────────────────────────
  console.log('Source revert-guards — gchat bench write site passes personId');
  const gchatSrc = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  ok(/async function trackUsage\(env, model, usage, source, evalContext = null, extras = null, personId = null\)/.test(gchatSrc),
    'trackUsage signature carries personId param');
  ok(/_isBenchRun \? botFromPersonId\(personId\) : \(source\.startsWith\('addon'\) \? 'addon' : 'gchat'\)/.test(gchatSrc),
    'D1 bind: bot gated on bench, real-traffic mapping byte-identical');
  ok(/_isBenchRun \? personId : null/.test(gchatSrc),
    'D1 bind: person_id populated only for bench rows');
  ok(/trackUsage\(env, activeModel, data\.usage, usageSource, evalContext, _praExtras, personId\)\.catch/.test(gchatSrc),
    'askClaude completion path threads personId into trackUsage');
  ok(/\}, personId\)\.catch\(\(\) => \{\}\);/.test(gchatSrc),
    'askClaudeContinue completion path threads personId into trackUsage');
  ok(/if \(p\.startsWith\('bench:'\)\) return 'benchmark';/.test(gchatSrc),
    "botFromPersonId source contains the 'bench:' → 'benchmark' mapping");

  console.log('Source revert-guards — webex clarify branch now logs to D1');
  const webexSrc = fs.readFileSync(path.join(__dirname, '..', 'worker', 'src', 'index.js'), 'utf8');
  // The webhook deterministic-parse clarify branch: isClarification check, then
  // within the same block a logBotUsageToD1 with responsePath 'clarify-question'
  // and its writeMetric twin (mirrors the tier-continuation pattern).
  const clarifyIdx = webexSrc.indexOf("if (quoteParsed.isClarification && quoteParsed.clarificationMessage) {");
  ok(clarifyIdx > -1, 'webhook deterministic-parse clarify branch exists');
  const clarifyBlock = webexSrc.slice(clarifyIdx, clarifyIdx + 1800);
  ok(/ctx\.waitUntil\(logBotUsageToD1\(env, \{ personId, requestText: text, responsePath: 'clarify-question', durationMs: Date\.now\(\) - _wxStartMs, responseText: quoteParsed\.clarificationMessage \}\)\.catch\(\(\) => \{\}\)\)/.test(clarifyBlock),
    "clarify branch fire-and-forgets a bot_usage row with responsePath 'clarify-question'");
  ok(/writeMetric\(env, \{ path: 'clarify-question', durationMs: Date\.now\(\) - _wxStartMs, personId \}\)/.test(clarifyBlock),
    'clarify branch writes the metric twin');
  ok(clarifyBlock.indexOf("logBotUsageToD1") < clarifyBlock.indexOf('return;'),
    'logging happens BEFORE the branch returns');
  // The sibling cf-clarify branch must still log (regression)
  ok(/responsePath: 'cf-clarify'/.test(webexSrc), "cf-clarify branch still logs 'cf-clarify' (untouched)");

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
