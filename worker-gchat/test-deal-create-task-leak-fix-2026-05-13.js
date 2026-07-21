#!/usr/bin/env node
// 2026-05-13 regression: Track 1 fixes for the missing-follow-up-task leak
// (42% of Deal creates skipping the Task per D1 telemetry over 30 days).
//
// Three changes covered:
//   1) zoho_create_record(Deals) calls createFollowUpTaskForDeal after a
//      successful POST (the primary 42% leak path).
//   2) STEP 8 of create_deal_and_quote delegates to the same helper and
//      surfaces task_create_failed:true on failure (was silent-success).
//   3) The helper retries ONCE on transient (5xx / thrown) failures but
//      NOT on Zoho row-level validation errors (4xx-equivalent).
//
// These are source-grep regressions following the pattern in
// test-open-deals-guard-2026-05-13.js — the runtime path is exercised in
// production via the live waterfall benchmark suite.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Test 1: zoho_create_record(Deals) triggers Task POST ===\n');

t('createFollowUpTaskForDeal helper is defined', () => {
  assert.ok(
    // existingDeal param added 2026-07-21 (follow-up task dedupe)
    /async function createFollowUpTaskForDeal\(\{ dealId, subjectLabel, env, personId, ownerId, existingDeal = false \}\)/.test(source),
    'createFollowUpTaskForDeal signature missing'
  );
});

t('zoho_create_record Deals branch invokes the helper after successful POST', () => {
  // Match the wiring block we appended right before the final `return parsed;`
  // of the zoho_create_record case. It must be gated on !createIsError + Deals.
  const block = source.match(
    /if \(!createIsError && createdId && module_name === 'Deals'\)[\s\S]{0,1200}createFollowUpTaskForDeal\(\{[\s\S]{0,400}dealId: createdId/
  );
  assert.ok(block, 'zoho_create_record(Deals) does not call createFollowUpTaskForDeal');
});

t('zoho_create_record Deals path surfaces task_create_failed on helper failure', () => {
  assert.ok(
    /parsed\.task_create_failed = true;/.test(source),
    'task_create_failed flag not surfaced on zoho_create_record(Deals) failure'
  );
  assert.ok(
    /parsed\.task_create_error = taskRes\.error;/.test(source),
    'task_create_error not propagated'
  );
});

console.log('\n=== Test 2: create_deal_and_quote STEP 8 regression ===\n');

t('STEP 8 still creates a follow-up task (via the shared helper)', () => {
  // STEP 8 must call createFollowUpTaskForDeal with the resolved label.
  const hit = source.match(
    /\/\/ STEP 8: Create follow-up task[\s\S]{0,1500}createFollowUpTaskForDeal\(\{\s*dealId,\s*subjectLabel: _taskAccountLabel/
  );
  assert.ok(hit, 'STEP 8 no longer delegates to createFollowUpTaskForDeal');
});

t('STEP 8 still derives subject from the 4-source fallback', () => {
  assert.ok(
    /accountData\?\.Account_Name\s*\n\s*\|\| account_name\s*\n\s*\|\| existingDealData\?\.Deal_Name/.test(source),
    'STEP 8 4-source label fallback missing'
  );
});

t('STEP 8 surfaces results.task_create_failed on helper failure', () => {
  assert.ok(
    /results\.task_create_failed = true;/.test(source),
    'STEP 8 results.task_create_failed flag missing'
  );
  assert.ok(
    /results\.task_create_classification = _taskRes\.http_classified;/.test(source),
    'STEP 8 task_create_classification flag missing'
  );
});

t('STEP 8 user_visible_summary appends the failure note for the LLM', () => {
  assert.ok(
    /if \(results\.task_create_failed\)[\s\S]{0,400}Please tell the user the Deal and Quote were created but a Task could not be added/.test(source),
    'STEP 8 user_visible_summary does not append failure note'
  );
});

console.log('\n=== Test 3: failure surfaces task_create_failed in BOTH code paths ===\n');

t('Helper returns success:false + classification on failure', () => {
  // The helper distinguishes three failure buckets so callers can decide
  // what to do — success:false + classification is the contract.
  assert.ok(
    /classification: 'validation'/.test(source) &&
    /classification: 'transient'/.test(source) &&
    /classification: 'unknown'/.test(source),
    'classification buckets missing'
  );
  assert.ok(
    /http_classified: attempt\.classification/.test(source),
    'http_classified is not propagated on failure return'
  );
});

t('Both call sites read taskRes.success / taskRes.error', () => {
  // zoho_create_record path
  assert.ok(
    /const taskRes = await createFollowUpTaskForDeal\(/.test(source),
    'zoho_create_record path does not capture helper return'
  );
  // STEP 8 path
  assert.ok(
    /const _taskRes = await createFollowUpTaskForDeal\(/.test(source),
    'STEP 8 does not capture helper return'
  );
});

console.log('\n=== Test 4: 5xx triggers ONE retry, 4xx does NOT ===\n');

t('Helper retries only on classification === "transient"', () => {
  // Single retry gate must be tied to the transient bucket, not any failure.
  assert.ok(
    /if \(!attempt\.ok && attempt\.classification === 'transient'\)\s*\{\s*\n\s*retried = true;/.test(source),
    'retry guard is not gated on transient classification'
  );
});

t('Helper retries AT MOST ONCE (no while/for retry loop)', () => {
  // Find the helper body and check it does not contain a while/for loop on retries.
  const start = source.indexOf('async function createFollowUpTaskForDeal');
  assert.ok(start > 0, 'helper not found');
  // Take ~6000 chars of the helper body for inspection
  const body = source.substring(start, start + 6000);
  const loopMatches = body.match(/while\s*\(|for\s*\(\s*let\s+[ai]\s*=\s*0\s*;\s*[ai]\s*<\s*\d+/g) || [];
  // The Due_Date `while (daysAdded < 3)` business-day loop is allowed.
  const retryLoops = loopMatches.filter(m => !/daysAdded/.test(body.substring(body.indexOf(m), body.indexOf(m) + 100)));
  // Permit up to 1 (the daysAdded while). Any others is a retry-loop regression.
  assert.ok(loopMatches.length <= 1, `Helper body has too many loops (potential retry storm): ${JSON.stringify(loopMatches)}`);
});

t('Validation errors are classified as validation (no retry)', () => {
  // The validation classification is set on taskRow?.status === 'error', which
  // covers Zoho 4xx-style row errors (INVALID_DATA, MANDATORY_NOT_FOUND, etc.)
  assert.ok(
    /if \(taskRow\?\.status === 'error'\)[\s\S]{0,400}classification: 'validation'/.test(source),
    'Zoho row-error is not classified as validation'
  );
});

t('Thrown exceptions are classified as transient (will retry)', () => {
  assert.ok(
    /catch \(e\)[\s\S]{0,300}classification: 'transient'/.test(source),
    'thrown errors are not classified as transient'
  );
});

console.log('\n=== Test 5: telemetry helper logs the task-create attempt ===\n');

t('Helper logs successful task creation to crm_operations (logCrmOpToD1)', () => {
  // Find the helper, then check that both branches (success + failure)
  // call logCrmOpToD1 with module: 'Tasks'.
  const start = source.indexOf('async function createFollowUpTaskForDeal');
  const end = source.indexOf('\n}\n', start + 1) + 2;
  const body = source.substring(start, end + 4000); // include up to next func
  const logCalls = (body.match(/logCrmOpToD1\(env, \{/g) || []).length;
  assert.ok(logCalls >= 2, `Expected ≥2 logCrmOpToD1 calls in helper (success + failure), found ${logCalls}`);
  assert.ok(/module: 'Tasks'/.test(body), 'helper telemetry does not tag module=Tasks');
});

t('Failure telemetry includes classification + retried flag for triage', () => {
  assert.ok(
    // ownerSource added 2026-07-15 (R6 owner-resolution fix) — optional here so
    // the marker keeps guarding classification/retried/source.
    /details: \{ dealId, dueDate: dueDateStr, retried, classification: attempt\.classification, source: 'createFollowUpTaskForDeal'(, ownerSource: _taskOwnerSource)? \}/.test(source),
    'failure telemetry missing classification/retried/source markers'
  );
});

t('logCrmOpToD1 helper itself still exists and accepts the expected fields', () => {
  // Sanity: don't let a refactor of the telemetry helper silently break us.
  assert.ok(
    /async function logCrmOpToD1\(env, \{[\s\S]{0,200}operation, module, recordId, recordName, status, durationMs, errorMessage, details/.test(source),
    'logCrmOpToD1 signature changed — helper telemetry will silently drop fields'
  );
});

console.log('\n=== Bonus: tool description nudge for lookup-field shapes ===\n');

t('zoho_create_record description tells the LLM lookup fields must be {id:...} objects', () => {
  assert.ok(
    /LOOKUP FIELDS on Quote create — Deal_Name, Account_Name, Contact_Name — MUST be passed as `\{"id":/.test(source),
    'zoho_create_record description lacks lookup-field shape guidance'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
