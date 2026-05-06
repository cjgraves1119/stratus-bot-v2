// Regression test: Council priority 2 — datasheet refusal + retry context +
// flag-it handling. Transcript-style guards for the failure pattern Chris
// observed on 2026-05-01:
//   1. user: "list the 48 port PoE MS150 variants"        → product_info OK
//   2. user: "pull the full datasheet for details"        → bot refused
//   3. user: "you can do live web fetches, try again"     → bot collapsed to greeting
//   4. user: "flag it"                                    → treated as random text
//
// Source-level test (no runtime stubs). Scans worker/src/index.js to verify:
//   A. wantsLiveDatasheet regex matches the literal phrasings the user
//      typed, including "pull the FULL datasheet" (the regex hole that
//      caused turn 2 to refuse).
//   B. The system prompt explicitly tells Claude that the bot DOES have
//      live-datasheet fetch capability and to never claim otherwise.
//   C. The cf-conversation entry point now reroutes retry phrases to
//      Claude with history (so turn 3 stays anchored to MS150).
//   D. The deterministic flag-it handler exists, writes a bot_usage row
//      with response_path='feedback-flag', and acks the user.

const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + (typeof diag === 'string' ? diag.substring(0, 500) : diag) : ''}`); fail++; }
};

// ─── A. Widened wantsLiveDatasheet regex ─────────────────────────────────
// Pull the two regex literals out of the source and exercise each against the
// failing phrasing.
function extractRegex(label) {
  // Match `let wantsLiveDatasheet = /(...)/i.test(userMessage);` — capture
  // everything between the first /\b and \b/i. Both copies are .multiline-safe.
  const re = /let\s+wantsLiveDatasheet\s*=\s*\/\\b\(([\s\S]*?)\)\\b\/i\.test\(userMessage\);/g;
  const matches = [];
  let m;
  while ((m = re.exec(src)) !== null) matches.push(m[1]);
  return matches;
}
const wantsLiveRegexes = extractRegex();
check('Both wantsLiveDatasheet regex copies present in source',
  wantsLiveRegexes.length === 2, `count=${wantsLiveRegexes.length}`);

const phrasesShouldMatch = [
  'pull the full datasheet for details',     // ← the live failure phrasing
  'pull the live datasheet',
  'pull the datasheet',
  'pull the latest datasheet',
  'pull the complete datasheet',
  'pull the whole datasheet',
  'fetch the full datasheet',
  'fetch the datasheet',
  'read the latest datasheet',
  'get the full datasheet',
  'grab the datasheet',
  'verify',
  'check for updates',
  'get specifics',
  'specifics from the datasheet',
];
for (const phrase of phrasesShouldMatch) {
  for (let i = 0; i < wantsLiveRegexes.length; i++) {
    const r = new RegExp(`\\b(${wantsLiveRegexes[i]})\\b`, 'i');
    check(`wantsLiveDatasheet[${i}] matches "${phrase}"`,
      r.test(phrase),
      `phrase did not match in copy ${i}`);
  }
}

// Negation: phrases that should NOT match (avoid false positives on quote-y text)
const phrasesShouldNotMatch = [
  'quote 5 MR44',
  'change to 3 year',
  'cost of 10 MX85',
  'flag it',
  'try again',
];
for (const phrase of phrasesShouldNotMatch) {
  for (let i = 0; i < wantsLiveRegexes.length; i++) {
    const r = new RegExp(`\\b(${wantsLiveRegexes[i]})\\b`, 'i');
    check(`wantsLiveDatasheet[${i}] does NOT match "${phrase}"`,
      !r.test(phrase),
      `phrase wrongly matched in copy ${i}`);
  }
}

// ─── B. System prompt declares live-datasheet capability ─────────────────
{
  check('System prompt declares LIVE DATASHEET CAPABILITY',
    /## LIVE DATASHEET CAPABILITY[\s\S]*you DO have this/.test(src),
    'capability block missing');
  check('System prompt forbids "I cannot browse" hallucination',
    /NEVER reply with[\s\S]*"I don't have the ability to browse URLs"/.test(src),
    'browse-refusal forbid clause missing');
  check('System prompt mentions worker fetch capability',
    /fetchDatasheet/.test(src) || /worker fetches the page server-side/.test(src),
    'no mention of worker fetch capability');
}

// ─── C. cf-conversation entry reroutes retry phrases to Claude with history ─
{
  // Find the cf-conversation else-if branch
  const idx = src.indexOf("activeClassification.intent === 'conversation'");
  check('cf-conversation branch found', idx > 0);
  const branch = src.substring(idx, idx + 4000);

  check('cf-conversation branch checks isRetryPhrase',
    /isRetryPhrase|try\\s+again|retry/i.test(branch),
    'no retry-phrase check inside conversation branch');
  check('cf-conversation branch reads history before deciding',
    /getHistory\(kv,\s*personId\)/.test(branch),
    'no history read');
  check('cf-conversation retry path calls askClaude with history hint',
    /askClaude\([^)]*retrying/i.test(branch),
    'no askClaude with retry note');
  check('cf-conversation retry note no longer lies that a fetch already ran',
    !/already attempted a live datasheet fetch THIS turn/i.test(branch),
    'retry note can still claim a fetch happened before askClaude enters live-datasheet branch');
  check('cf-conversation retry note forbids one-model-at-a-time punts',
    /do NOT ask them to try one model at a time/i.test(branch),
    'retry note does not forbid observed one-at-a-time punt');
  check('cf-conversation retry path logs to D1 with response_path "claude-retry-rerouted"',
    /responsePath:\s*'claude-retry-rerouted'/.test(branch),
    'no claude-retry-rerouted log');
  check('cf-conversation retry path uses ctx.waitUntil for D1 (lifecycle-attached)',
    /ctx\.waitUntil\(\s*logBotUsageToD1/.test(branch),
    'D1 call not lifecycle-attached');
}

// ─── C2. Datasheet requests bypass Llama waterfall ───────────────────────
{
  const fnIdx = src.indexOf('function classifyProductInfoSubtype');
  check('classifyProductInfoSubtype found', fnIdx > 0);
  const fn = src.substring(fnIdx, fnIdx + 5000);

  check('DATASHEET_FOLLOWUP is routed to Claude/advisory, not Llama/simple_lookup',
    /if\s*\(DATASHEET_FOLLOWUP\.test\(upper\)\)\s*return\s+'advisory'/.test(fn),
    'datasheet followups can still route to Llama simple_lookup');
  check('DATASHEET_FOLLOWUP routing runs before multi-model simple_lookup shortcut',
    fn.indexOf('DATASHEET_FOLLOWUP.test(upper)') > 0 &&
      fn.indexOf('DATASHEET_FOLLOWUP.test(upper)') < fn.indexOf('MULTI_MODEL.test(m) && COMPARISON.test(upper)'),
    'multi-model datasheet pulls can still route through Llama before datasheet routing');
  check('source includes live-test rationale for not using Llama on datasheet pulls',
    /multi-model datasheet pulls[\s\S]*invent source URLs/.test(fn),
    'missing source-level rationale for routing live datasheet requests away from Llama');
}

// ─── C3. Datasheet retry phrases re-enter live-fetch branch ──────────────
{
  check('isDatasheetRetryFollowup helper exists',
    /function isDatasheetRetryFollowup\(message\)/.test(src),
    'retry followup helper missing');
  check('looksLikeRecentDatasheetTurn helper exists',
    /function looksLikeRecentDatasheetTurn\(content\)/.test(src),
    'recent datasheet helper missing');
  check('extractDatasheetKeys helper exists',
    /function extractDatasheetKeys\(message\)/.test(src),
    'datasheet model extraction helper missing');
  check('getRecentDatasheetRequestContext helper exists',
    /async function getRecentDatasheetRequestContext\(history\)/.test(src),
    'history-scoped datasheet request helper missing');
  check('history helper prefers explicit user datasheet requests before assistant text',
    /explicitUserRequests[\s\S]*role === 'user'[\s\S]*for \(const role of \['user', 'assistant'\]/.test(src),
    'retry fallback may still prefer assistant text and pull stale models');
  const askIdx = src.indexOf('async function askClaude');
  check('askClaude found for retry followup source checks', askIdx > 0);
  const askBlock = src.substring(askIdx, askIdx + 9000);
  check('askClaude promotes retry phrases after datasheet history to wantsLiveDatasheet',
    /isDatasheetRetryFollowup\(userMessage\)[\s\S]*looksLikeRecentDatasheetTurn[\s\S]*wantsLiveDatasheet\s*=\s*true/.test(askBlock),
    'retry phrases can still reach Claude without fetching prior datasheet models');
  check('askClaude retry fetch uses scoped recent datasheet request context',
    /getRecentDatasheetRequestContext\(history\)/.test(askBlock),
    'retry fetch still scans generic history instead of the last explicit datasheet request');
  check('live datasheet prompt forbids adding models from conversation history',
    /Do NOT add models from conversation history/.test(src) &&
      /Copy source URLs exactly from the \[Datasheet: \.\.\.\] labels/.test(src),
    'prompt does not prevent stale model bleed or source URL rewriting');
}

// ─── D. Flag-it deterministic handler ────────────────────────────────────
{
  // Must exist before the pricing handler so flag-it never falls through
  // to the LLM classifier.
  const flagIdx = src.indexOf('isFlagPhrase');
  const pricingIdx = src.indexOf('Deterministic pricing calculator');
  check('flag-it handler exists', flagIdx > 0);
  check('flag-it handler runs BEFORE the pricing handler',
    flagIdx > 0 && pricingIdx > flagIdx,
    `flagIdx=${flagIdx} pricingIdx=${pricingIdx}`);

  const flagBlock = src.substring(flagIdx, flagIdx + 2500);
  check('flag handler writes feedback-flag row to D1',
    /responsePath:\s*'feedback-flag'/.test(flagBlock),
    'no feedback-flag responsePath');
  check('flag handler stores flagged context preview in error_message',
    /errorMessage:\s*`FLAGGED:/.test(flagBlock),
    'no FLAGGED prefix on error_message');
  check('flag handler ack mentions logging for review',
    /logged this thread/i.test(flagBlock),
    'no user-facing ack');
  check('flag handler uses ctx.waitUntil for D1 (lifecycle-attached)',
    /ctx\.waitUntil\(\s*logBotUsageToD1/.test(flagBlock),
    'D1 call not lifecycle-attached');

  // Functional check on the deployed flag regex. We inline-mirror the same
  // shape and run shouldFlag / shouldNotFlag against it. If the worker's
  // regex drifts, this test will need to be updated alongside.
  const flagRe = /^\s*(?:please\s+)?(?:flag|mark|report|note)(?:\s+(?:it|this|that|the\s+(?:last|previous|prior)\s+(?:answer|reply|response|message)?))?\s*\.?\s*$/i;
  check('mirrored flag regex literal present in source',
    flagBlock.includes("(?:flag|mark|report|note)"),
    'source regex shape mismatch — update mirror in test');
  const shouldFlag = ['flag it', 'flag this', 'flag that', 'flag', 'please flag it',
                      'flag the previous answer', 'flag the last reply', 'mark it',
                      'report it', 'note it'];
  const shouldNotFlag = ['quote 5 MR44', 'flag this and quote MR44',
                         'how do I flag a port', 'flag the SKU', 'change to 3 year'];
  for (const phrase of shouldFlag) {
    check(`flag regex matches "${phrase}"`, flagRe.test(phrase));
  }
  for (const phrase of shouldNotFlag) {
    check(`flag regex does NOT match "${phrase}"`, !flagRe.test(phrase));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
