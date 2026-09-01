// Regression checks for the 2026-05-05 MR license live-test follow-up.
// These static checks cover the guardrails that failed in production:
// license-only MR requests must not become MR46 hardware, create_deal_and_quote
// must feed truth-guard side-channel summaries, and Account billing fields must
// be re-fetched before Quote creation.

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  PASS ${name}`); passed++; }
  catch (e) { console.log(`  FAIL ${name}\n     ${e.message}`); failed++; }
}

console.log('\nMR license follow-up guards\n────────────────────────────────────────────────────────────────');

t('create_deal_and_quote accepts MR-ENT / MR-AGN as license-only aliases', () => {
  assert.match(src, /rawSku === 'MR-ENT' \|\| rawSku === 'MR-AGN'/);
  assert.match(src, /const licSku = `LIC-ENT-\$\{defaultTerm\}YR`/);
});

t('model-agnostic license aliases refuse missing terms instead of defaulting', () => {
  assert.match(src, /error: 'missing_license_term'/);
  assert.match(src, /Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year\?/);
  assert.match(src, /Do NOT create a Deal or Quote until they choose a term/);
});

t('create_deal_and_quote schema semantically forbids turning MR license requests into AP hardware', () => {
  const start = src.indexOf("name: 'create_deal_and_quote'");
  const end = src.indexOf("name: 'create_quote_on_deal'", start);
  assert.ok(start > -1 && end > start, 'create_deal_and_quote tool definition must be isolatable');
  const tool = src.slice(start, end);
  assert.match(tool, /"MR licenses"\s+use MR-ENT or LIC-ENT-\{term\}YR/);
  assert.match(tool, /never substitute MR46\/MR44 hardware unless the user asked for AP hardware/i);
  assert.match(tool, /For license-only requests,[\s\S]{0,180}do NOT invent hardware/);
  assert.match(tool, /License-only requests must stay license-only/);
});

t('create_deal_and_quote emits truth-guard mutation side-channel fields', () => {
  assert.match(src, /results\._record_url = results\.records\.quote\?\.url \|\| null/);
  assert.match(src, /results\._user_visible_summary =/);
});

t('Account billing fields are re-fetched before Quote address population', () => {
  assert.match(src, /Accounts\/\$\{accountId\}\?fields=id,Account_Name,Billing_Street/);
  assert.match(src, /Fetched Account billing fields for Quote address/);
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
