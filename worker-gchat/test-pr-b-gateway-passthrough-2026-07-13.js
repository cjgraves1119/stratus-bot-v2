// PR-B gateway-passthrough + canary-baseline regression (2026-07-13).
//
// Root cause of "prompt caching does nothing" (cache_creation=cache_read=0 on
// every CRM/agent call): two defects on top of the KV kill-switch being off.
//
//   (1) The CRM CONTINUATION loop sent `cf-aig-cache-ttl: 3600` on gateway
//       calls. This gateway has response caching enabled, and an ACTIVE gateway
//       cache layer makes Anthropic treat every request as a prompt-cache MISS
//       (verified live: cache-ttl → cache_creation on every call, never a read;
//       cf-aig-skip-cache:true → cache_read hit). So the ~35k system+tools
//       prefix was reprocessed cold on every continuation iteration.
//       Fix: continuation loop now sends `cf-aig-skip-cache: true` (matches the
//       askClaude loop, which already did).
//
//   (2) verifyCachingActive's cost-delta auto-kill compared the pr_b-filtered
//       CURRENT window (expensive CRM tool-loop rows only) against an UNFILTERED
//       baseline (all crm_agent/claude rows, incl. cheap quote-URL calls). The
//       population mismatch made cur24hAvg structurally exceed baseAvg, firing
//       the +5% cost-delta kill on every tick regardless of caching — the cause
//       of 5 of the 6 historical auto-kills. Fix: baseline query now filters on
//       `response_text LIKE '%pr_b%'` too, so the delta compares like-with-like.
//
// These are grep-style invariants against the source (the header lives in a
// closure and the SQL in a local const — the cheapest durable guard). The live
// end-to-end proof is the pr_b telemetry showing cache_read>0 after deploy.
//
// Run: node worker-gchat/test-pr-b-gateway-passthrough-2026-07-13.js

const fs = require('fs'), path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

// Helper: extract the body of the Nth `async function callAnthropicWithRetry(`
// up to a rough brace-balanced end, so we assert on the right closure.
function fnBodies(name) {
  const bodies = [];
  const re = new RegExp('async function ' + name + '\\s*\\(', 'g');
  let m;
  while ((m = re.exec(src))) {
    // grab a generous window; the header lines we check are near the top.
    bodies.push(src.slice(m.index, m.index + 1800));
  }
  return bodies;
}

console.log('PR-B gateway passthrough (skip-cache on BOTH CRM loops)');

// There are exactly two CRM agent-loop callAnthropicWithRetry closures.
const retryFns = fnBodies('callAnthropicWithRetry');
ok(retryFns.length === 2, `found ${retryFns.length} callAnthropicWithRetry closures (expected 2: askClaude + continuation)`);

// Every gateway call in a CRM agent loop must skip the gateway response cache.
retryFns.forEach((body, i) => {
  ok(/cf-aig-skip-cache/.test(body), `CRM loop #${i + 1} sends cf-aig-skip-cache on gateway calls`);
  ok(!/cf-aig-cache-ttl/.test(body), `CRM loop #${i + 1} does NOT re-enable the gateway response cache (no cf-aig-cache-ttl)`);
});

// The other cache-ttl sites (single-shot web_search / draft-assist, no
// cache_control) are allowed to keep gateway response caching — but the CRM
// loops must not. Guard the specific regression: the continuation loop's
// header assignment is skip-cache, not cache-ttl.
ok(/if \(apiUrl === ANTHROPIC_API_URL\) headers\['cf-aig-skip-cache'\] = 'true';/.test(src),
  "continuation loop header assignment is cf-aig-skip-cache:true");
ok(!/if \(apiUrl === ANTHROPIC_API_URL\) headers\['cf-aig-cache-ttl'\] = '3600';/.test(src),
  "the old continuation cf-aig-cache-ttl:3600 assignment is gone");

console.log('PR-B canary cost-delta baseline (like-with-like population)');

// Isolate the verifyCachingActive body.
const vIdx = src.indexOf('async function verifyCachingActive(');
ok(vIdx > -1, 'verifyCachingActive present');
const vBody = src.slice(vIdx, vIdx + 3000);

// The baselineQuery must ALSO filter on pr_b rows so it samples the same
// population as the current-window query.
const baseMatch = vBody.match(/const baselineQuery = `([\s\S]*?)`;/);
ok(!!baseMatch, 'baselineQuery literal found');
if (baseMatch) {
  const baselineSql = baseMatch[1];
  ok(/response_text LIKE '%pr_b%'/.test(baselineSql),
    "baselineQuery filters on response_text LIKE '%pr_b%' (matches current-window population)");
  ok(/-10 days/.test(baselineSql) && /-3 days/.test(baselineSql),
    'baselineQuery keeps the 3–10 day historical window');
}

console.log('\n-------------------------------------------------------------------');
console.log(`PR-B gateway/canary suite: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
