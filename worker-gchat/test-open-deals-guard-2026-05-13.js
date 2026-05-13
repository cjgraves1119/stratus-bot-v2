#!/usr/bin/env node
// 2026-05-13 regression: HARD GATE #3b in create_deal_and_quote refuses
// silent new-Deal creation when the resolved Account already has open
// Deals. Codex B1 failure: bot created PAR Excellence Deal
// 2570562000405763135 even though two open Deals already existed on the
// account.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== HARD GATE #3b: account_has_open_deals refusal ===\n');

t('Guard block is present in source with the correct anchor', () => {
  assert.ok(
    /HARD GATE #3b: Account has existing open Deals/.test(source),
    'HARD GATE #3b banner missing'
  );
});

t('Guard reads toolInput.confirm_new_deal', () => {
  assert.ok(
    /const confirmNewDeal = toolInput\.confirm_new_deal === true;/.test(source),
    'confirm_new_deal must be read with strict === true comparison'
  );
});

t('Guard skips the check when existing_deal_id is supplied', () => {
  // Look for the guarded condition: !existingDealId AND !confirmNewDeal
  assert.ok(
    /if \(accountId && !existingDealId && !confirmNewDeal\)/.test(source),
    'guard must skip when existing_deal_id or confirm_new_deal is set'
  );
});

t('Guard queries open Deals via COQL with Stage not-in closed states', () => {
  assert.ok(
    /select id, Deal_Name, Stage, Amount, Closing_Date from Deals where Account_Name = '\$\{accountId\}'/.test(source),
    'COQL query template must select Deals by Account_Name = accountId'
  );
  assert.ok(
    /Stage not in \('Closed \(Won\)', 'Closed \(Lost\)'\)/.test(source),
    "COQL Stage filter must exclude 'Closed (Won)' and 'Closed (Lost)'"
  );
});

t('Guard refusal payload has error:"account_has_open_deals"', () => {
  assert.ok(
    /error: 'account_has_open_deals'/.test(source),
    "refusal payload must include error:'account_has_open_deals'"
  );
});

t('Guard refusal includes the list of existing open Deals', () => {
  assert.ok(
    /existing_open_deals: openDeals\.map/.test(source),
    'refusal must include existing_open_deals array for the model to read'
  );
});

t('Guard instruction directs model to create_quote_on_deal (default path)', () => {
  assert.ok(
    /call create_quote_on_deal with that deal_id/.test(source),
    'instruction must name create_quote_on_deal as the default expected path'
  );
});

t('Guard instruction documents confirm_new_deal as the explicit-consent override', () => {
  assert.ok(
    /re-call create_deal_and_quote with confirm_new_deal:true/.test(source),
    'instruction must mention re-call with confirm_new_deal:true after explicit consent'
  );
});

t('Guard returns user-visible summary so model can relay it', () => {
  assert.ok(
    /_user_visible_summary: `This account already has \$\{openDeals\.length\} open deal\(s\)/.test(source),
    'guard must include a _user_visible_summary'
  );
});

t('Guard COQL errors are non-blocking (logged warn, fall through to existing flow)', () => {
  assert.ok(
    /\[COMPOUND\] Open-Deals guard check failed \(proceeding anyway\)/.test(source),
    'guard must log a warn and fall through on COQL errors so a transient API hiccup does not break quoting'
  );
});

console.log('\n=== Tool registration ===\n');

t('create_deal_and_quote description mentions account_has_open_deals behavior', () => {
  const descMatch = source.match(/name: 'create_deal_and_quote',\s*description: '([^']+)'/);
  assert.ok(descMatch, "tool description must be found");
  const desc = descMatch[1];
  assert.ok(
    /If the resolved Account already has one or more OPEN Deals/.test(desc),
    "description must explain the account_has_open_deals refusal"
  );
  assert.ok(
    /create_quote_on_deal/.test(desc),
    "description must direct the model to create_quote_on_deal as the default response"
  );
});

t('input_schema declares confirm_new_deal boolean property', () => {
  assert.ok(
    /confirm_new_deal: \{ type: 'boolean', description: '\(2026-05-13\)/.test(source),
    'confirm_new_deal must be a documented boolean input on create_deal_and_quote'
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
