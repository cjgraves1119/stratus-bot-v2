// Claude-outage → Llama 4 failover regression (2026-07-16).
//
// The incident: the worker's Anthropic account hit its monthly usage limit and
// every /api/chat request 400'd. askClaude converts EVERY Anthropic failure
// into a polite success-shaped apology STRING (errors:[] stays empty), and
// claudeResultLooksUsable() (a) short-circuited to "usable" whenever any tool
// call ran and (b) had a reply regex that missed the actual apology strings
// ('API 400', "rate-limited", out-of-credits). Result: with
// CRM_AGENT_CLAUDE_DEFAULT=true the apology was returned as a successful
// claude-write-intent reply and the Llama tier NEVER ran — extension chat
// dead-ended for the whole outage.
//
// Pins:
//   (1) claudeApiFailureReason tags every deterministic apology string;
//   (2) claudeResultLooksUsable rejects them even when toolCalls is non-empty;
//   (3) waterfall: Claude 400 → Llama tier answers, tierUsed 'llama-failover',
//       exactly ONE Anthropic call (400 never retries);
//   (4) total outage (Llama+Gemma also stall) → 'all-tiers-down' graceful
//       reply with NO tier-3 re-call of the dead Claude;
//   (5) forceClaude:true surfaces the Claude error honestly (no silent switch);
//   (6) PR-A tool subsetting applies on the CF tier (crm_read → 5 tools);
//   (7) static: write-safety gate + /api/chat direct-path failover +
//       400-usage-limits branch survive in source.
//
// Run: node worker-gchat/test-claude-failover-llama-2026-07-16.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function loadEngine() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import\s+(\w+)\s+from\s+'\.\/([^']+\.json)';?$/mg, (_, n, rel) => `const ${n} = require('${esc('src/' + rel)}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { askWithWaterfall, claudeResultLooksUsable, claudeApiFailureReason, TOOL_SUBSETS, CRM_EMAIL_TOOLS };`;
  const tmp = path.join(os.tmpdir(), `claude-failover-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const RAW_SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
const { askWithWaterfall, claudeResultLooksUsable, claudeApiFailureReason, TOOL_SUBSETS, CRM_EMAIL_TOOLS } = loadEngine();

// Expected CF-tier tool count in failover mode: classified subset ∪ prompt-
// commanded tools, minus the irreversible failover-blocked set.
const PROMPT_UNION = ['undo_crm_action', 'gmail_search_messages', 'gmail_read_message', 'gmail_read_thread', 'gmail_send_email'];
const BLOCKED = ['zoho_delete_record', 'quote_to_po_and_esign', 'velocity_hub_submit', 'gmail_send_email'];
const expectedFailoverCount = (subsetNames) => {
  const u = new Set([...subsetNames, ...PROMPT_UNION]);
  for (const b of BLOCKED) u.delete(b);
  return u.size;
};

// ── mocks ────────────────────────────────────────────────────────────────────
const CLAUDE_400_USAGE = JSON.stringify({
  type: 'error',
  error: { type: 'invalid_request_error', message: 'You have reached your specified API usage limits.' }
});

let anthropicCalls = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/anthropic/') || u.includes('api.anthropic.com')) {
    anthropicCalls++;
    return new Response(CLAUDE_400_USAGE, { status: 400, headers: { 'content-type': 'application/json' } });
  }
  throw new Error(`unexpected fetch in test: ${u}`); // fail loud — nothing else may touch network
};

const store = new Map();
const kv = {
  get: async (k, type) => { const v = store.get(k); if (v == null) return null; return type === 'json' ? (typeof v === 'string' ? JSON.parse(v) : v) : v; },
  put: async (k, v) => { store.set(k, v); },
  list: async () => ({ keys: [] }),
  getWithMetadata: async () => ({ value: null, metadata: null })
};
const d1run = { run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) };
const db = { prepare: () => ({ bind: () => d1run, ...d1run }) };

let aiCalls = [];            // { modelId, toolCount, toolNames, sys }
let aiReplyText = 'Here are the open deals for Acme: TestCo HQ Refresh (Qualification, $42,500).';
const AI = {
  run: async (modelId, body) => {
    const toolNames = Array.isArray(body?.tools) ? body.tools.map(t => t?.function?.name || t?.name).filter(Boolean) : [];
    aiCalls.push({
      modelId,
      toolCount: Array.isArray(body?.tools) ? body.tools.length : 0,
      toolNames,
      sys: Array.isArray(body?.messages) && body.messages[0]?.role === 'system' ? String(body.messages[0].content) : ''
    });
    return { response: aiReplyText };
  }
};

const baseEnv = () => ({
  ANTHROPIC_API_KEY: 'test-key',
  CRM_AGENT_CLAUDE_DEFAULT: 'true',
  CONVERSATION_KV: kv,
  PRICES_KV: kv,
  ANALYTICS_DB: db,
  AI,
  BOT_METRICS: { writeDataPoint: () => {} }
});

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); }
};

(async () => {
  console.log('claudeApiFailureReason — apology string taxonomy');
  await t('529 overloaded string → overloaded_529', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: 'The AI service is temporarily overloaded. Please try again in a minute.' }), 'overloaded_529'));
  await t('429 rate-limited string → rate_limited_429', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: "I'm being rate-limited right now. Please wait 30 seconds and try again." }), 'rate_limited_429'));
  await t('400 credits/usage-limit string → credits_or_usage_limit_400', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: '⚠️ The AI service account is out of credits or has reached its API usage limit. Please raise the limit or top up at console.anthropic.com, then try again.' }), 'credits_or_usage_limit_400'));
  await t('generic (API 400) apology → api_error', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: "Sorry, I couldn't process that CRM/email request (API 400). Please try again shortly." }), 'api_error'));
  await t('missing key string → not_configured', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: 'Claude API not configured. Please check ANTHROPIC_API_KEY.' }), 'not_configured'));
  await t('normal reply → null', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: 'Created quote Q-1234 for Acme — $5,002.41. https://crm.zoho.com/...' }), null));
  await t('accepts bare strings too (direct /api/chat path)', () =>
    assert.strictEqual(claudeApiFailureReason("Sorry, I couldn't process that request (API 500). Try a specific SKU like \"quote 10 MR44\"."), 'api_error'));
  await t('outer-catch apology (network-level outage) → api_exception (review critical #1)', () =>
    assert.strictEqual(claudeApiFailureReason('Sorry, I couldn\'t process that request. Try a specific SKU like "quote 10 MR44" or "5 MS150-48LP-4G".'), 'api_exception'));
  await t("continue-path 429 variant (no 'right now') → rate_limited_429 (review major)", () =>
    assert.strictEqual(claudeApiFailureReason("I'm being rate-limited. Please wait 30 seconds and try again."), 'rate_limited_429'));
  await t('ANCHORED: healthy reply relaying a Zoho throttle → null (round-2 false-positive fix)', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: "I checked the quote — it looks like I'm being rate-limited by Zoho right now, so the update didn't land. Want me to retry in a minute? The record itself is fine." }), null));
  await t('ANCHORED: healthy reply quoting an (API 400) error mid-text → null', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: "Quantity updated to 25 on the MX68 line. One follow-up call couldn't process that request (API 400) — the Valid_Till picklist value was rejected by Zoho, so please pick a valid date. Everything else saved cleanly and the quote total now reads $14,210.55." }), null));
  await t('ANCHORED: genuine apology still matches (full-reply, short)', () =>
    assert.strictEqual(claudeApiFailureReason({ reply: "  Sorry, I couldn't process that CRM/email request (API 400). Please try again shortly." }), 'api_error'));

  console.log('\nclaudeResultLooksUsable — the masked-outage bug');
  await t('apology + toolCalls>0 → NOT usable (was the bug)', () =>
    assert.strictEqual(claudeResultLooksUsable({ reply: "Sorry, I couldn't process that CRM/email request (API 400). Please try again shortly.", toolCalls: [{ name: 'zoho_search_records' }], errors: [] }), false));
  await t('rate-limited hyphen string → NOT usable', () =>
    assert.strictEqual(claudeResultLooksUsable({ reply: "I'm being rate-limited right now. Please wait 30 seconds and try again.", toolCalls: [], errors: [] }), false));
  await t('normal reply + toolCalls → usable', () =>
    assert.strictEqual(claudeResultLooksUsable({ reply: 'Done — quote updated.', toolCalls: [{ name: 'zoho_update_record' }], errors: [] }), true));

  console.log('\naskWithWaterfall — Claude 400 outage cascades to Llama');
  {
    anthropicCalls = 0; aiCalls = []; store.clear();
    aiReplyText = 'Here are the open deals for Acme: TestCo HQ Refresh (Qualification, $42,500).';
    const out = await askWithWaterfall('list my open deals for Acme', baseEnv(), 'gw:test@stratus.test', {});
    await t('tierUsed = llama-failover', () => assert.strictEqual(out.tierUsed, 'llama-failover'));
    await t('reply comes from Llama', () => assert.ok(String(out.reply).includes('TestCo HQ Refresh')));
    await t('stallReason names the Claude failure', () => assert.ok(String(out.stallReason).startsWith('claude:credits_or_usage_limit_400')));
    await t('exactly ONE Anthropic call (400 does not retry)', () => assert.strictEqual(anthropicCalls, 1));
    await t('Llama model id hit on the CF tier', () => assert.ok(aiCalls.some(c => /llama-4-scout/.test(c.modelId))));
  }

  console.log('\naskWithWaterfall — PR-A subsetting ∪ prompt-commanded tools on the CF tier');
  {
    const readCall = aiCalls.find(c => /llama-4-scout/.test(c.modelId));
    const expected = expectedFailoverCount(TOOL_SUBSETS.crm_read); // crm_read ∪ union − blocked
    await t(`Llama received crm_read ∪ prompt tools − blocked (${expected}), not all 27`, () =>
      assert.strictEqual(readCall.toolCount, expected));
    await t('undo_crm_action + gmail reads present via the union (round-2 fix)', () =>
      assert.ok(readCall.toolNames.includes('undo_crm_action') && readCall.toolNames.includes('gmail_search_messages')));
    await t('gmail_send_email stripped in failover mode', () =>
      assert.ok(!readCall.toolNames.includes('gmail_send_email')));
  }

  console.log('\naskWithWaterfall — forced eval mode keeps all 27 tools (round-2 fix)');
  {
    anthropicCalls = 0; aiCalls = []; store.clear();
    aiReplyText = 'Forced-mode reply for the eval harness.';
    const out = await askWithWaterfall('list my open deals for Acme', baseEnv(), 'gw:test@stratus.test', { forceLlama: true });
    const call = aiCalls.find(c => /llama-4-scout/.test(c.modelId));
    await t(`forceLlama receives all ${CRM_EMAIL_TOOLS.length} tools (eval-series comparability)`, () =>
      assert.strictEqual(call.toolCount, CRM_EMAIL_TOOLS.length));
    await t('forced mode never consults Claude', () => assert.strictEqual(anthropicCalls, 0));
  }

  console.log('\naskWithWaterfall — failover guardrails (blocked tools, banner, failover-mode prompt)');
  {
    anthropicCalls = 0; aiCalls = []; store.clear();
    aiReplyText = 'Added 2 LIC-ENT-3YR licenses to the quote.';
    // crm_write-classified message (classifier rule 0: create + quote) → the
    // subset includes zoho_delete_record, which failover mode must strip.
    const out = await askWithWaterfall('create a quote for Acme for 2 MX68 firewalls', baseEnv(), 'gw:test@stratus.test', {});
    const llamaCall = aiCalls.find(c => /llama-4-scout/.test(c.modelId));
    const expectedWrite = expectedFailoverCount(TOOL_SUBSETS.crm_write);
    await t('failover strips irreversible tools from the crm_write subset (post-union)', () =>
      assert.strictEqual(llamaCall.toolCount, expectedWrite));
    await t('zoho_delete_record absent from the failover toolset', () =>
      assert.ok(!llamaCall.toolNames.includes('zoho_delete_record')));
    await t('failover-mode prompt block delivered to the model', () =>
      assert.ok(llamaCall.sys.includes('FAILOVER MODE (Claude is down')));
    await t('degraded-service banner prepended to the reply', () =>
      assert.ok(String(out.reply).startsWith('ℹ️ Claude is offline right now')));
    await t('banner wording avoids FAILURE_PATTERN terms (no self-stripping)', () =>
      assert.ok(!/(temporarily unavailable|hit an API error|being rate-limited|out of credits)/i.test(String(out.reply).split('\n')[0])));
  }

  console.log('\naskWithWaterfall — total outage degrades gracefully, no tier-3 re-call');
  {
    anthropicCalls = 0; aiCalls = []; store.clear();
    aiReplyText = ''; // Llama AND Gemma stall (empty reply)
    const out = await askWithWaterfall('list my open deals for Acme', baseEnv(), 'gw:test@stratus.test', {});
    await t('tierUsed = all-tiers-down', () => assert.strictEqual(out.tierUsed, 'all-tiers-down'));
    await t('reply preserves the class-specific recovery guidance (usage-cap, round-2 fix)', () =>
      assert.ok(/usage limit/.test(String(out.reply)) && /backup models also could not/.test(String(out.reply))));
    await t('NO tier-3 Claude re-call during outage (1 Anthropic call total)', () => assert.strictEqual(anthropicCalls, 1));
    await t('stallReason carries the full tier trace', () => assert.ok(/claude:.*llama:.*gemma:/.test(String(out.stallReason))));
  }

  console.log('\naskWithWaterfall — forceClaude surfaces the error honestly');
  {
    anthropicCalls = 0; aiCalls = []; store.clear();
    const out = await askWithWaterfall('list my open deals for Acme', baseEnv(), 'gw:test@stratus.test', { forceClaude: true });
    await t('tierUsed = claude (no silent switch)', () => assert.strictEqual(out.tierUsed, 'claude'));
    await t('reply is the usage-limit apology, not a Llama answer', () => assert.ok(String(out.reply).includes('usage limit')));
    await t('no CF model was invoked', () => assert.strictEqual(aiCalls.length, 0));
  }

  console.log('\nstatic source pins — seams that must survive refactors');
  await t('write-safety gate exists (claude-partial-write, no failover after a write)', () =>
    assert.ok(RAW_SRC.includes("tierUsed: 'claude-partial-write'") && RAW_SRC.includes('write_executed_no_failover')));
  await t('/api/chat direct path has Llama failover wired', () =>
    assert.ok(/API\/CHAT\] Claude API failure/.test(RAW_SRC)));
  await t("askClaude 400 branch matches 'usage limits'", () =>
    assert.ok(RAW_SRC.includes("errMsg.includes('usage limits')")));
  await t('tier badges cover llama-failover and all-tiers-down', () =>
    assert.ok(RAW_SRC.includes("'llama-failover':") && RAW_SRC.includes("'all-tiers-down':")));
  await t('askCfModel reads + saves crm_context (parity with askClaude)', () =>
    assert.ok(/\[CF-AGENT\] Injected CRM context/.test(RAW_SRC) && /\[CF-AGENT\] Saved CRM context/.test(RAW_SRC)));
  await t('/api/chat continuation loop uses the tracker proxy (review critical #2)', () =>
    assert.ok(/reply\.iteration, _directEnv, null, 120000, chatPersonId/.test(RAW_SRC)));
  await t('/api/chat strips [[SUGGESTIONS]] server-side and ships suggestions field (review minor)', () =>
    assert.ok(RAW_SRC.includes('_directCleanReply') && RAW_SRC.includes('suggestions: _directSuggestions || undefined')));
  await t('/api/chat failover badge is response-only, never stored to history (review minor)', () =>
    assert.ok(RAW_SRC.includes('_directFailoverBadge ? `${replyText}') && !/addToHistory\([^)]*_directFailoverBadge/.test(RAW_SRC)));
  await t('CF FAILURE_PATTERN filters degraded-service strings (no outage parroting)', () =>
    assert.ok(/FAILURE_PATTERN = \/\(.*temporarily unavailable.*\)\/i/.test(RAW_SRC)));
  await t('FAILOVER_BLOCKED_TOOLS set covers the four irreversible tools', () =>
    assert.ok(/FAILOVER_BLOCKED_TOOLS = new Set\(\[\s*'zoho_delete_record', 'quote_to_po_and_esign', 'velocity_hub_submit', 'gmail_send_email'/.test(RAW_SRC)));
  await t('SKU truth guard present on the CF reply path', () =>
    assert.ok(RAW_SRC.includes('[SKU-GUARD]') && RAW_SRC.includes('unverified SKU — confirm before ordering')));
  await t('failover write audit trail present (failover_writes_<date> KV)', () =>
    assert.ok(RAW_SRC.includes('failover_writes_')));
  await t('parity gap: ecomm-link default rule in the Llama prompt', () =>
    assert.ok(RAW_SRC.includes('QUOTE OUTPUT — ECOMM LINK DEFAULT (HARD RULE):')));
  await t('parity gap: accessory SKU-find rules in the Llama prompt', () =>
    assert.ok(RAW_SRC.includes('ACCESSORY SKU FIND (PSU / power supply / injector')));
  await t('parity gap: SME→Ivanti substitution in the Llama knowledge block', () =>
    assert.ok(RAW_SRC.includes('LIC-MI-EMSC-D-1YMC-A-{1|3|5}YR')));
  await t('parity gap: Meraki ISR Referal accepts reviewed email or name resolution in the Llama prompt', () =>
    assert.ok(/Lead_Source "Meraki ISR Referal" REQUIRES either meraki_isr_email[\s\S]*or meraki_isr_name/.test(RAW_SRC)));
  await t('parity gap: SKU miss ladder in the Llama prompt', () =>
    assert.ok(RAW_SRC.includes('SKU MISS LADDER:')));
  await t('round-2: stalled CF runs never persist crm_context', () =>
    assert.ok(RAW_SRC.includes('_cfRunStalled') && /!_cfRunStalled && personId/.test(RAW_SRC)));
  await t('round-2: dangling [[SUGGESTIONS]] opener stripped on the CF path', () =>
    assert.ok(/includes\('\[\[SUGGESTIONS\]\]'\) && !finalReply\.includes\('\[\[\/SUGGESTIONS\]\]'\)/.test(RAW_SRC)));
  await t('round-2: /api/chat continuation throw routes to failover detection', () =>
    assert.ok(RAW_SRC.includes('continuation threw') && RAW_SRC.includes('routing to failover detection')));
  await t('round-2: CF crm_context read-inject is dryRun-gated', () =>
    assert.ok(/env\.CONVERSATION_KV && !dryRun\) \{\s*\n\s*try \{\s*\n\s*const _savedCrmCtx/.test(RAW_SRC)));
  await t('round-2: FAILURE_PATTERN covers overloaded + (API n) apologies', () =>
    assert.ok(/FAILURE_PATTERN = \/\(.*temporarily overloaded.*API \\d/.test(RAW_SRC)));
  await t('round-2: CF_TIER_PROMPT_TOOLS union set present', () =>
    assert.ok(RAW_SRC.includes('CF_TIER_PROMPT_TOOLS = new Set([')));

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
