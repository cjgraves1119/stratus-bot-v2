#!/usr/bin/env node
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, 'src', 'index.js');
const src = fs.readFileSync(srcPath, 'utf8');

function mustContain(pattern, label) {
  assert(
    pattern.test(src),
    `Missing expected admin-action DID workflow evidence: ${label}`
  );
}

mustContain(/async function handleQuoteDidAdminAction/, 'structured standalone DID handler');
mustContain(/data\.Admin_Action === 'LIVE_CiscoQuote_Deal'/, 'exact LIVE_CiscoQuote_Deal interception');
mustContain(/extraFields\.length > 0/, 'mixed-field DID payload is rejected instead of silently dropping fields');
mustContain(/return handleQuoteDidAdminAction\(record_id, env, personId\)/, 'generic update delegates to standalone handler');
mustContain(/do not separately call velocity_hub_submit afterward/,
  'standalone DID prompt prevents a duplicate Velocity submission');
mustContain(/ensureQuoteDidAndVelocity\(quote, env, personId\)/, 'handler reuses reviewed DID and Velocity workflow');
mustContain(/fetchQuoteForPoWorkflow\(quoteId, env\)/, 'handler fetches the current Quote before deciding whether to write');
mustContain(/state:\s*'already_done'/, 'existing DID returns already_done');
mustContain(/wrote_admin_action:\s*false/, 'fetch failures and missing Quotes report no admin write');
mustContain(/result\.state !== 'already_done'/, 'existing DID short-circuit is reported as no write');
mustContain(/poll_snapshots/, 'poll snapshot evidence is returned');
mustContain(/submitVelocityHubDid\(did, 'United States'/, 'shared workflow auto-submits a generated DID to Velocity Hub');
mustContain(/velocity_hub_submission:\s*velocity/, 'Velocity Hub result is returned to the model');
mustContain(/WORKER_GCHAT_DID_POLL_MAX_MS/, 'DID poll max is configurable');
mustContain(/WORKER_GCHAT_DID_POLL_EVERY_MS/, 'DID poll cadence is configurable');
mustContain(/Chrome extension requests are user-blocking/, 'poll-window rationale is documented');
mustContain(/actionName === 'LIVE_CiscoQuote_Deal' && !isCiscoDid\(finalState\?\.CCW_Deal_Number\)/,
  'transient __Done is not terminal without a DID');
mustContain(/pendingCiscoError && sameCiscoStatus\(pendingCiscoError, finalState\)/,
  'Cisco error must persist unchanged across consecutive reads');
mustContain(/error_confirm:\s*\{\s*persistent:\s*true/,
  'terminal DID error includes confirmation evidence');
mustContain(/action\.error_confirm\?\.persistent === true/,
  'ensureQuoteDidAndVelocity only classifies confirmed Cisco errors as terminal');
mustContain(/state:\s*writeRejected \? 'did_write_rejected'/,
  'a rejected Zoho write is terminal and is not mislabeled as polling');

function extractFunction(name) {
  const start = src.indexOf(`function ${name}`);
  assert(start >= 0, `Missing function ${name}`);
  const declarationStart = src.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  const open = src.indexOf('{', src.indexOf(')', start));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    if (src[i] === '}' && --depth === 0) return src.slice(declarationStart, i + 1);
  }
  throw new Error(`Unterminated function ${name}`);
}

const pureHelpers = new Function(
  `${extractFunction('boundedDidPollMs')}\n${extractFunction('quoteDidPollingConfig')}\n${extractFunction('sameCiscoStatus')}\n` +
  'return { boundedDidPollMs, quoteDidPollingConfig, sameCiscoStatus };'
)();
assert.deepStrictEqual(pureHelpers.quoteDidPollingConfig({}), { maxPollMs: 70000, pollEveryMs: 5000 });
assert.deepStrictEqual(
  pureHelpers.quoteDidPollingConfig({ WORKER_GCHAT_DID_POLL_MAX_MS: '90000', WORKER_GCHAT_DID_POLL_EVERY_MS: '750' }),
  { maxPollMs: 90000, pollEveryMs: 750 }
);
assert.deepStrictEqual(
  pureHelpers.quoteDidPollingConfig({ WORKER_GCHAT_DID_POLL_MAX_MS: '999999', WORKER_GCHAT_DID_POLL_EVERY_MS: '1' }),
  { maxPollMs: 180000, pollEveryMs: 250 },
  'environment polling values must remain safely bounded'
);
assert(pureHelpers.sameCiscoStatus(
  { Admin_Action: 'LIVE_CiscoQuote_Deal__Error', Cisco_Estimate_Status: 'ERROR', Last_Error: 'x' },
  { Admin_Action: 'LIVE_CiscoQuote_Deal__Error', Cisco_Estimate_Status: 'ERROR', Last_Error: 'x' }
), 'identical Cisco error snapshots should confirm persistence');
assert(!pureHelpers.sameCiscoStatus(
  { Admin_Action: 'LIVE_CiscoQuote_Deal__Error', Cisco_Estimate_Status: 'ERROR', Last_Error: 'x' },
  { Admin_Action: 'LIVE_CiscoQuote_Deal', Cisco_Estimate_Status: 'Processing', Last_Error: '' }
), 'changing Cisco status must not confirm a transient error');

const updateCaseIdx = src.indexOf("case 'zoho_update_record':");
const interceptIdx = src.indexOf("data.Admin_Action === 'LIVE_CiscoQuote_Deal'", updateCaseIdx);
const genericValidationIdx = src.indexOf('// Pre-flight validation', updateCaseIdx);
assert(updateCaseIdx > -1 && interceptIdx > updateCaseIdx && genericValidationIdx > interceptIdx,
  'DID admin action must intercept before generic update/undo validation and write logic');

(async () => {
  const makeHandler = (fetchQuoteForPoWorkflow, ensureQuoteDidAndVelocity) => new Function(
    'fetchQuoteForPoWorkflow',
    'ensureQuoteDidAndVelocity',
    `${extractFunction('handleQuoteDidAdminAction')}\nreturn handleQuoteDidAdminAction;`
  )(fetchQuoteForPoWorkflow, ensureQuoteDidAndVelocity);

  const existingHandler = makeHandler(
    async () => ({ id: 'quote-1', CCW_Deal_Number: '12345678' }),
    async (quote) => ({
      success: true,
      state: 'already_done',
      quote,
      ccw_deal_number: '12345678',
      velocity_hub_submission: { skipped: true, reason: 'existing_did' }
    })
  );
  const existing = await existingHandler('quote-1', {}, 'gw:test@example.invalid');
  assert.strictEqual(existing.wrote_admin_action, false, 'an existing DID must not rewrite Admin_Action');
  assert.strictEqual(existing.state, 'already_done');
  assert.strictEqual(existing.velocity_hub_submission.skipped, true);

  const generatedHandler = makeHandler(
    async () => ({ id: 'quote-2', CCW_Deal_Number: null }),
    async (quote) => ({
      success: true,
      state: 'did_ready',
      quote: { ...quote, CCW_Deal_Number: '87654321' },
      ccw_deal_number: '87654321',
      admin_action: { state: 'done', write_result: { code: 'SUCCESS' }, poll_snapshots: [{ at_ms: 500 }] },
      velocity_hub_submission: { success: true, deal_id: '87654321' }
    })
  );
  const generated = await generatedHandler('quote-2', {}, 'gw:test@example.invalid');
  assert.strictEqual(generated.wrote_admin_action, true, 'a generated DID reports the successful admin write');
  assert.deepStrictEqual(generated.poll_snapshots, [{ at_ms: 500 }]);
  assert.strictEqual(generated.velocity_hub_submission.deal_id, '87654321');

  const failingHandler = makeHandler(
    async () => { throw new Error('synthetic Zoho read outage'); },
    async () => { throw new Error('ensure must not run after preflight failure'); }
  );
  const failed = await failingHandler('quote-3', {}, 'gw:test@example.invalid');
  assert.strictEqual(failed.state, 'quote_fetch_failed');
  assert.strictEqual(failed.wrote_admin_action, false);

  console.log('admin-action DID workflow source and synthetic checks passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
