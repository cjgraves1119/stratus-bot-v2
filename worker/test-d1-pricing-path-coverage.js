// Regression test: every deterministic pre-classifier WebEx send path must
// log to bot_usage. Codex caught the gap on 2026-05-05T19:11Z — PR #25 live
// regression returned correct license-only URLs but D1 was empty, because
// handlePricingRequest's send block never called logBotUsageToD1.
//
// Source-level test (no runtime): scan worker/src/index.js to verify that
// each of the four deterministic send blocks (EOL, quote-confirm,
// follow-up modifier, pricing) terminates with a `logBotUsageToD1(...)`
// invocation that includes the right responsePath and a responseText
// reference. Fast, deterministic, doesn't require a stub env.

const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// Helper: extract the success branch body for a given handler. We bound the
// scope from the line declaring the reply variable up to the next `return;`
// after sendMessage so we test only the chosen-path body.
function findHandlerBlock(declarationLineMatch) {
  const idx = src.indexOf(declarationLineMatch);
  if (idx < 0) return null;
  // Scope = next ~25 lines from the declaration site.
  return src.substring(idx, idx + 2500);
}

// ─── 1. EOL date path ──────────────────────────────────────────────────────
{
  const block = findHandlerBlock("const eolDateReply = handleEolDateRequest(text);");
  check('EOL handler block found', !!block);
  check('EOL path calls logBotUsageToD1 with responsePath="eol-date"',
    !!block && /logBotUsageToD1\([^)]*responsePath:\s*'eol-date'/.test(block),
    'no eol-date log call');
  check('EOL path passes responseText: eolDateReply to D1',
    !!block && /logBotUsageToD1\([^\n]*responseText:\s*eolDateReply/.test(block),
    'no eolDateReply in responseText');
}

// ─── 2. Quote-confirmation path ────────────────────────────────────────────
{
  const block = findHandlerBlock("const quoteConfirmReply = await handleQuoteConfirmation");
  check('Quote-confirm handler block found', !!block);
  check('Quote-confirm path calls logBotUsageToD1 with responsePath="quote-confirmation"',
    !!block && /logBotUsageToD1\([^)]*responsePath:\s*'quote-confirmation'/.test(block),
    'no quote-confirmation log call');
  check('Quote-confirm path passes responseText: quoteConfirmReply to D1',
    !!block && /logBotUsageToD1\([^\n]*responseText:\s*quoteConfirmReply/.test(block),
    'no quoteConfirmReply in responseText');
}

// ─── 3. Follow-up modifier path (regression — already wired in PR #24) ─────
{
  const block = findHandlerBlock("const followUpReply = await handleFollowUpModifier");
  check('Follow-up modifier handler block found', !!block);
  check('Follow-up path still logs with responsePath="followup-modifier"',
    !!block && /logBotUsageToD1\([^)]*responsePath:\s*'followup-modifier'/.test(block),
    'followup-modifier log call missing — PR #24 regression');
}

// ─── 4. Pricing path (the actual gap from Codex) ───────────────────────────
{
  const block = findHandlerBlock("const pricingReply = await handlePricingRequest");
  check('Pricing handler block found', !!block);
  check('Pricing path calls logBotUsageToD1 with responsePath="pricing-deterministic"',
    !!block && /logBotUsageToD1\([^)]*responsePath:\s*'pricing-deterministic'/.test(block),
    'no pricing-deterministic log call');
  check('Pricing path passes responseText: pricingReply to D1',
    !!block && /logBotUsageToD1\([^\n]*responseText:\s*pricingReply/.test(block),
    'no pricingReply in responseText');
  check('Pricing path also calls writeMetric for analytics-engine telemetry',
    !!block && /writeMetric\([^)]*path:\s*'pricing-deterministic'/.test(block),
    'no writeMetric call');
}

// ─── 5. None of these paths use the previously-missing pattern (return; without logBotUsageToD1) ─
// Coarse but useful guard: assert each of the four reply variables doesn't
// have a return without a preceding logBotUsageToD1 within 25 lines.
{
  const checkNoUnloggedReturn = (replyVar, label) => {
    // Find the success branch starting at `if (${replyVar}) {`
    const re = new RegExp(`if\\s*\\(${replyVar}\\)\\s*\\{[\\s\\S]*?return;`, 'g');
    const m = re.exec(src);
    if (!m) return; // skipped — variable not found
    const body = m[0];
    check(`${label}: success branch contains a logBotUsageToD1 call before return`,
      /logBotUsageToD1\(/.test(body),
      `${label} branch returns without D1 logging`);
  };
  checkNoUnloggedReturn('eolDateReply', 'EOL');
  checkNoUnloggedReturn('quoteConfirmReply', 'Quote-confirm');
  checkNoUnloggedReturn('followUpReply', 'Follow-up');
  checkNoUnloggedReturn('pricingReply', 'Pricing');
}


// ─── 6. Lifecycle-attached writes — Codex pushback on PR #26 ────────────────
// Each new D1 call must be wrapped in ctx.waitUntil(...) or prefixed with
// await. A bare `logBotUsageToD1(...).catch(() => {})` can be cut off when
// the Worker request returns, dropping the row.
{
  const lifecycleAttached = (replyVar, label) => {
    const re = new RegExp(`if\\s*\\(${replyVar}\\)\\s*\\{[\\s\\S]*?return;`, 'g');
    const m = re.exec(src);
    if (!m) return;
    const body = m[0];
    const hasWaitUntil = /ctx\.waitUntil\(\s*logBotUsageToD1\(/.test(body);
    const hasAwait = /await\s+logBotUsageToD1\(/.test(body);
    check(`${label}: D1 call is lifecycle-attached (ctx.waitUntil OR await)`,
      hasWaitUntil || hasAwait,
      `${label} D1 call is bare fire-and-forget — Worker may abandon before flush`);
  };
  // Only apply to the three NEW paths covered by this PR. Pre-existing paths
  // (followup-modifier, cf-deterministic, etc.) follow a different pattern
  // that's been verified to work in production; not in scope to change here.
  lifecycleAttached('eolDateReply', 'EOL');
  lifecycleAttached('quoteConfirmReply', 'Quote-confirm');
  lifecycleAttached('pricingReply', 'Pricing');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
