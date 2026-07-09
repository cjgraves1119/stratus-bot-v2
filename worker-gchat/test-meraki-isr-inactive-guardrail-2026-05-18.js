#!/usr/bin/env node
// 2026-05-18 — Meraki_ISR inactive guardrail.
// Trigger: deal 2570562000406442433 — Lauren Fogal was inactive in Zoho;
// bot looped 3+ minutes burning tokens because the FILTER_CRITERIA_NOT_SATISFIED
// error wasn't surfaced. This PR adds a structured interceptor + helpers +
// prompt guidance so the agent stops looping and surfaces the issue.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Meraki_ISR inactive guardrail (2026-05-18) ===\n');

t('getZohoUserStatus helper is defined and queries /users', () => {
  assert.ok(/async function getZohoUserStatus\(env, userId\)/.test(source),
    'getZohoUserStatus must be declared');
  assert.ok(/users\?type=AllUsers/.test(source),
    'helper must hit /users?type=AllUsers');
});

t('getZohoUserName helper is defined and returns display name', () => {
  assert.ok(/async function getZohoUserName\(env, userId\)/.test(source),
    'getZohoUserName must be declared');
});

t('detectInactiveMerakiIsrError is wired into zoho_create_record', () => {
  const idx = source.indexOf("await zohoApiCall('POST', module_name, env, { data: [recordData] })");
  assert.notEqual(idx, -1, 'create POST line still present');
  const window = source.slice(idx, idx + 800);
  assert.ok(/detectInactiveMerakiIsrError\(createResult, recordData, env\)/.test(window),
    'create site must call detectInactiveMerakiIsrError before parseZohoResponse');
});

t('detectInactiveMerakiIsrError is wired into zoho_update_record', () => {
  const idx = source.indexOf("await zohoApiCall('PUT', `${module_name}/${record_id}`, env, { data: [data] })");
  assert.notEqual(idx, -1, 'update PUT line still present');
  const window = source.slice(idx, idx + 800);
  assert.ok(/detectInactiveMerakiIsrError\(updateResult, data, env\)/.test(window),
    'update site must call detectInactiveMerakiIsrError after PUT');
});

t('Interceptor returns meraki_isr_inactive: true when user is inactive', () => {
  assert.ok(/meraki_isr_inactive:\s*true/.test(source),
    'inactive branch must set meraki_isr_inactive: true');
  assert.ok(/action:\s*'meraki_isr_inactive'/.test(source),
    'inactive branch must set action: meraki_isr_inactive');
});

t('Interceptor returns meraki_isr_filter_rejected for active but blocked user', () => {
  assert.ok(/meraki_isr_filter_rejected:\s*true/.test(source),
    'active-but-rejected branch must set meraki_isr_filter_rejected: true');
});

t('Interceptor only matches Meraki_ISR.id filter failures', () => {
  assert.ok(/Meraki_ISR\.id/.test(source),
    'detector must scope to Meraki_ISR.id json_path');
});

t('User-visible message tells user to uncheck Inactive in Zoho', () => {
  assert.ok(/Settings\s*→\s*Users/.test(source),
    'inactive message must reference Settings -> Users path');
  assert.ok(/uncheck the Inactive flag/i.test(source) || /uncheck Inactive/i.test(source),
    'inactive message must tell user to uncheck Inactive');
});

t('User-visible message explicitly forbids silent retry / Stratus Sales swap', () => {
  assert.ok(/Do NOT retry with a different ISR/i.test(source),
    'message must forbid retry with different ISR');
});

t('System prompt forbids hallucinated "tool missing" responses', () => {
  assert.ok(/tool missing/i.test(source) || /session needs zoho_create_record/i.test(source),
    'prompt must explicitly address the hallucinated "tool missing" failure mode');
});

t('System prompt added to both MASTER and GEMMA prompts', () => {
  const count = (source.match(/ZOHO ERROR — MERAKI_ISR INACTIVE/g) || []).length;
  assert.equal(count, 2, `expected 2 occurrences in master + gemma prompts, got ${count}`);
});

t('Existing Stratus-Sales auto-default in validateCrmWrite is preserved', () => {
  // 2026-07-09: the one-line default became an else-branch behind the ISR-Referal
  // hard gate (feat/crm-quote-fixes) — non-referral creates still default to
  // Stratus Sales, and "Meraki ISR Referal" now BLOCKS instead of defaulting.
  assert.ok(
    /else if \(!data\.Meraki_ISR && isCreate\) \{\s*\n\s*data\.Meraki_ISR = \{ id: '2570562000027286729' \};/.test(source),
    'non-referral Meraki_ISR missing-field default must remain'
  );
  assert.ok(
    /isCreate && data\.Lead_Source === 'Meraki ISR Referal'/.test(source),
    'ISR-Referal creates must hit the no-default hard gate'
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
