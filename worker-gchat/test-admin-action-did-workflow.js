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

mustContain(/function handleQuoteDidAdminAction/, 'structured DID admin-action handler');
mustContain(/data\.Admin_Action === 'LIVE_CiscoQuote_Deal'/, 'exact LIVE_CiscoQuote_Deal interception');
mustContain(/fetchQuoteAdminActionState/, 'quote state re-fetch helper');
mustContain(/CCW_Deal_Number/, 'CCW_Deal_Number verification');
mustContain(/isCiscoDid\(preState\?\.CCW_Deal_Number\)/, 'existing DID short-circuit');
mustContain(/wrote_admin_action:\s*false/, 'no-write existing DID result');
mustContain(/state:\s*'already_done'/, 'already_done result state');
mustContain(/statusLabel\s*=\s*errored \? 'error' : \(doneWithoutDid \? 'done_without_did' : 'processing'\)/, 'processing result state');
mustContain(/done_without_did/, 'done_without_did result state');
mustContain(/statusLabel\s*=\s*errored \? 'error'/, 'error result state');
mustContain(/poll_snapshots/, 'poll snapshot evidence returned');
mustContain(/submitVelocityHubDid\(did\)/, 'Velocity Hub auto-submit after DID');
mustContain(/velocity_hub_submission:\s*velocity/, 'Velocity Hub result is returned to model');
mustContain(/Do NOT separately call velocity_hub_submit after zoho_update_record returns admin_action_result:true/, 'prompt prevents double Velocity submission');
mustContain(/Do NOT speculate which line item caused it unless Zoho returned that exact detail/, 'prompt blocks unsupported line-item speculation');
mustContain(/\(make\|create\|generate\|get\|fire\|run\|submit\|push\).*deal\\s\*id/, 'deal id routing trigger');
mustContain(/try\\s\+making\\s\+the\\s\+deal\\s\*id\\s\+again/, 'retry deal id routing trigger');
mustContain(/approve\\s\+this\\s\+quote\|push\\s\+to\\s\+ccw/, 'approval routing trigger');
mustContain(/continue;\s*\n\s*}\s*\n\s*if \(String\(finalState\?\.Admin_Action/, 'transient __Done is not treated as immediate terminal without DID');
mustContain(/error_confirm/, 'persistent __Error gets confirmatory re-fetch before terminal failure');
mustContain(/sameCiscoStatus/, 'persistent __Error requires unchanged Cisco status before early terminate');
mustContain(/WORKER_GCHAT_DID_POLL_MAX_MS/, 'DID poll max is configurable');
mustContain(/Chrome extension requests are user-blocking/, 'poll-window rationale comment');

const interceptIdx = src.indexOf("data.Admin_Action === 'LIVE_CiscoQuote_Deal'");
const genericUpdateIdx = src.indexOf('const updateResult = await zohoApiCall');
assert(interceptIdx > -1 && genericUpdateIdx > -1 && interceptIdx < genericUpdateIdx,
  'DID admin action must intercept before generic update/undo path');

console.log('admin-action DID workflow source checks passed');
