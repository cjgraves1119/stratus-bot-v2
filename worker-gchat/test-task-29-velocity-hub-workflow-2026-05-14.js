#!/usr/bin/env node
// 2026-05-14 task #29 regression — Velocity Hub DID submission in the
// quote_to_po_and_esign workflow chain.
//
// Background:
//   Welker run on 2026-05-13 (quote 2570562000405927006, DID 84685002): the
//   bot's user-visible reply confirmed "submitted to Velocity Hub ✅" and
//   crm_operations row 1164 shows velocity_hub_submission.success=true with
//   HTTP 200 from Pipedream. That proves OUR outbound payload is correct.
//   The VH bot still saw a raw "deal approval" body — which means the loss
//   happened downstream of our worker.
//
//   This fix hardens the worker side so:
//     (a) every VH submission goes through a single helper with a hard
//         8-digit DID guard, preventing any blank/malformed payload from
//         ever reaching Pipedream silently,
//     (b) every VH submission writes a structured D1 row (request payload,
//         response status, body preview), so when a downstream actor
//         malforms the bot-group message we have proof it was correct
//         on our side,
//     (c) inbound /api/velocity-hub requests with bad shape are rejected
//         AND fingerprinted (user-agent / origin / referer logged) so a
//         rogue caller can be traced,
//     (d) when submitVelocityHubDid fails, the parent state propagates
//         the failure into the user-visible summary instead of falsely
//         claiming "submitted ✅".
//
// Run: node worker-gchat/test-task-29-velocity-hub-workflow-2026-05-14.js

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Test 1: submitVelocityHubDid hardened signature ===\n');

t('Helper accepts a context object (env, personId, callSite, quoteId)', () => {
  assert.ok(
    /async function submitVelocityHubDid\(dealId, country = 'United States', context = \{\}\)/.test(source),
    "submitVelocityHubDid signature missing the new context param"
  );
});

t('Hard guard rejects non-8-digit DID before any fetch', () => {
  const guardBlock = source.match(
    /async function submitVelocityHubDid[\s\S]{0,2000}if \(!isCiscoDid\(normalizedDid\)\)/
  );
  assert.ok(guardBlock, "DID format guard missing or not before fetch");
});

t('Guard path logs the rejection to D1 with attempted_deal_id', () => {
  const block = source.match(
    /if \(!isCiscoDid\(normalizedDid\)\)[\s\S]{0,1200}logCrmOpToD1\(env, \{[\s\S]{0,800}attempted_deal_id: dealId/
  );
  assert.ok(block, "rejection branch does not log attempted_deal_id to D1");
});

console.log('\n=== Test 2: VH submission telemetry ===\n');

t('Every VH submission writes operation="velocity_hub_submit" to D1', () => {
  // There should be at least 2 logCrmOpToD1 calls in submitVelocityHubDid:
  // one for the rejection path, one for the success/error path. Both must
  // tag operation as velocity_hub_submit so we can grep telemetry later.
  const helperBody = source.match(
    /async function submitVelocityHubDid[\s\S]+?\n\}/);
  assert.ok(helperBody, "Could not locate submitVelocityHubDid body");
  const matches = (helperBody[0].match(/operation: 'velocity_hub_submit'/g) || []).length;
  assert.ok(matches >= 2, `Expected ≥2 velocity_hub_submit log writes, found ${matches}`);
});

t('Submission log captures requestPayload {deal_id, country} and responsePayload', () => {
  // The success/error log must include the exact outbound deal_id + the VH
  // response status + body preview, so we can prove our side is clean.
  const block = source.match(
    /requestPayload: requestBody,[\s\S]{0,300}responsePayload: \{ status: vhStatus, body_preview: responsePreview/
  );
  assert.ok(block, "Submission log missing requestPayload/responsePayload structure");
});

console.log('\n=== Test 3: workflow chain wires through hardened helper ===\n');

t('ensureQuoteDidAndVelocity threads personId through to submitVelocityHubDid', () => {
  // The chain caller must pass personId so the D1 row attributes the
  // submission to the right user. Previously this was lost.
  assert.ok(
    /async function ensureQuoteDidAndVelocity\(quote, env, personId = null\)/.test(source),
    "ensureQuoteDidAndVelocity does not accept personId"
  );
  assert.ok(
    /await submitVelocityHubDid\(did, 'United States', \{\s*env,\s*personId,\s*quoteId,\s*callSite: 'quote_to_po_and_esign:ensureQuoteDidAndVelocity'/.test(source),
    "ensureQuoteDidAndVelocity does not pass context to submitVelocityHubDid"
  );
});

t('handleQuoteToPoAndEsign forwards personId into ensureQuoteDidAndVelocity', () => {
  assert.ok(
    /const did = await ensureQuoteDidAndVelocity\(quote, env, personId\);/.test(source),
    "handleQuoteToPoAndEsign call site missing personId"
  );
});

t('VH failure on the workflow chain propagates to parent state', () => {
  // Previously the parent always returned success:true if DID was ready,
  // even if submitVelocityHubDid threw or got HTTP 5xx. That would make
  // the user-visible reply falsely claim "submitted ✅". Now the parent
  // mirrors velocity.success.
  assert.ok(
    /success: !!velocity\.success,[\s\S]{0,300}state: velocity\.success === false \? 'did_ready_velocity_failed' : 'did_ready'/.test(source),
    "Parent state does not propagate VH failure"
  );
});

console.log('\n=== Test 4: standalone velocity_hub_submit tool consolidated ===\n');

t('velocity_hub_submit tool delegates to submitVelocityHubDid (no duplicate fetch)', () => {
  // Old code had an inline fetch. New code should be a single helper call.
  // Specifically: the case body must NOT contain a fetch() call to the
  // Pipedream URL — that call only lives in submitVelocityHubDid now.
  const caseBody = source.match(
    /case 'velocity_hub_submit': \{[\s\S]+?\n      \}/
  );
  assert.ok(caseBody, "velocity_hub_submit case not found");
  assert.ok(
    /submitVelocityHubDid\(deal_id, country \|\| 'United States', \{[\s\S]{0,200}callSite: 'tool:velocity_hub_submit'/.test(caseBody[0]),
    "velocity_hub_submit tool does not delegate to submitVelocityHubDid"
  );
  assert.ok(
    !/fetch\('https:\/\/eo44ez/.test(caseBody[0]),
    "velocity_hub_submit tool still has an inline fetch (should delegate)"
  );
});

console.log('\n=== Test 5: /api/velocity-hub proxy hardened ===\n');

t('/api/velocity-hub validates DID format before forwarding', () => {
  const block = source.match(
    /case '\/api\/velocity-hub': \{[\s\S]+?\n            break;\n          \}/
  );
  assert.ok(block, "/api/velocity-hub case not found");
  assert.ok(
    /if \(!deal_id \|\| !\/\^\\d\{8\}\$\/\.test\(String\(deal_id\)\.trim\(\)\)\)/.test(block[0]),
    "/api/velocity-hub missing strict 8-digit guard"
  );
});

t('/api/velocity-hub fingerprints rejected callers (UA, origin, referer)', () => {
  const block = source.match(
    /case '\/api\/velocity-hub': \{[\s\S]+?\n            break;\n          \}/
  );
  assert.ok(block, "/api/velocity-hub case not found");
  assert.ok(
    /user_agent: inboundUa[\s\S]{0,200}origin: inboundOrigin[\s\S]{0,200}referer: inboundReferer/.test(block[0]),
    "/api/velocity-hub rejection log missing caller fingerprint"
  );
});

t('/api/velocity-hub forwards through submitVelocityHubDid (no inline fetch)', () => {
  const block = source.match(
    /case '\/api\/velocity-hub': \{[\s\S]+?\n            break;\n          \}/
  );
  assert.ok(block, "/api/velocity-hub case not found");
  assert.ok(
    /submitVelocityHubDid\(\s*String\(deal_id\)\.trim\(\),[\s\S]{0,2000}callSite: 'api:\/api\/velocity-hub'/.test(block[0]),
    "/api/velocity-hub does not delegate to submitVelocityHubDid"
  );
});

console.log('\n=== Test 6: single outbound fetch site invariant ===\n');

t('Pipedream URL appears exactly once in source (only inside submitVelocityHubDid)', () => {
  // Three legacy call sites (helper, tool, proxy) had identical fetches.
  // After consolidation, the literal URL should appear in exactly one
  // production code location. Test files don't count. Use ^ start-of-line
  // and a fetch( prefix to filter out comments.
  const fetchMatches = source.match(
    /await fetch\('https:\/\/eo44ez435h7vzp2\.m\.pipedream\.net'/g
  ) || [];
  assert.equal(
    fetchMatches.length, 1,
    `Expected exactly 1 outbound fetch to Pipedream; found ${fetchMatches.length}`
  );
});

console.log('\n=== Test 7: workflow chain re-fetches Quote post-poll ===\n');

t('ensureQuoteDidAndVelocity always re-fetches the Quote after DID poll completes', () => {
  // The poll's final_state can lag Zoho by 1-2s, so a fresh fetch protects
  // against handing a stale (blank) CCW_Deal_Number to submitVelocityHubDid.
  // This was already in place but the comment + invariant should remain.
  const block = source.match(
    /const refreshedQuote = await fetchQuoteForPoWorkflow\(quoteId, env\)\.catch[\s\S]{0,200}if \(!isCiscoDid\(refreshedQuote\?\.CCW_Deal_Number\)\)/
  );
  assert.ok(block, "Post-poll re-fetch + DID guard missing");
});

console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));
process.exit(failed === 0 ? 0 : 1);
