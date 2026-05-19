#!/usr/bin/env node
// 2026-05-19 regression bundle for the 8-bug quote/address fix (Kenwood + OPTK postmortems).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');
const crmPanel = readFileSync(join(here, '../chrome-extension/src/sidebar/panels/CrmPanel.jsx'), 'utf8');
let passed = 0, failed = 0;
function t(name, fn){ try{ fn(); console.log(`  ✓ ${name}`); passed++; }catch(e){ console.log(`  ✗ ${name}\n     ${e.message}`); failed++; } }
function buildSandbox(){
  const start = source.indexOf('const US_STATE_MAP');
  if (start < 0) throw new Error('US_STATE_MAP anchor not found');
  const fnAnchor = source.indexOf('function normalizeMerakiIsrPayload', start);
  if (fnAnchor < 0) throw new Error('normalizeMerakiIsrPayload anchor not found');
  let depth = 0, end = -1;
  for (let j = source.indexOf('{', fnAnchor); j < source.length; j++){
    if (source[j]==='{') depth++;
    else if (source[j]==='}'){ depth--; if(depth===0){ end=j+1; break; } }
  }
  if (end < 0) throw new Error('end of normalizeMerakiIsrPayload not found');
  const region = source.slice(start, end);
  const ctx = { console: { log(){}, warn(){}, error(){} } };
  vm.createContext(ctx);
  vm.runInContext(region, ctx);
  return ctx;
}
let sb;
try { sb = buildSandbox(); } catch(e){ console.error('FATAL sandbox:', e.message); process.exit(1); }

console.log('\n=== Fix E — aliases + normalization ===\n');
t('FIELD_NAME_ALIASES defined', ()=>{ assert.ok(/const FIELD_NAME_ALIASES = \{/.test(source)); assert.ok(/Billing_Zip:\s*'Billing_Code'/.test(source)); assert.ok(/Shipping_Zip:\s*'Shipping_Code'/.test(source)); });
t('applyFieldAliases Billing_Zip→Billing_Code', ()=>{ const r=vm.runInContext(`applyFieldAliases({ Billing_Zip: '60651' })`, sb); assert.equal(r.Billing_Code,'60651'); assert.equal('Billing_Zip' in r,false); });
t('applyFieldAliases Shipping_Zip→Shipping_Code', ()=>{ const r=vm.runInContext(`applyFieldAliases({ Shipping_Zip: '12345' })`, sb); assert.equal(r.Shipping_Code,'12345'); });
t('applyFieldAliases no clobber when canonical present', ()=>{ const r=vm.runInContext(`applyFieldAliases({ Billing_Zip: '00000', Billing_Code: '60651' })`, sb); assert.equal(r.Billing_Code,'60651'); assert.equal(r.Billing_Zip,'00000'); });
t('normalizeCountryCode USA→US', ()=>{ assert.equal(vm.runInContext(`normalizeCountryCode('USA')`, sb),'US'); });
t('normalizeCountryCode United States→US', ()=>{ assert.equal(vm.runInContext(`normalizeCountryCode('United States')`, sb),'US'); });
t('normalizeStateCode Nebraska→NE', ()=>{ assert.equal(vm.runInContext(`normalizeStateCode('Nebraska')`, sb),'NE'); });
t('normalizeStateCode OH passthrough', ()=>{ assert.equal(vm.runInContext(`normalizeStateCode('OH')`, sb),'OH'); });
t('Fix E wired into create', ()=>{ assert.ok(/applyFieldAliases\(recordData,\s*`zoho_create_record/.test(source)); assert.ok(/recordData\.Shipping_State = normalizeStateCode/.test(source)); });
t('Fix E wired into update', ()=>{ assert.ok(/applyFieldAliases\(data,\s*`zoho_update_record/.test(source)); assert.ok(/data\.Shipping_Country = normalizeCountryCode\(data\.Shipping_Country\)/.test(source)); });

console.log('\n=== Fix D — placeholder heuristic ===\n');
t('123 Main St / Anytown flagged', ()=>{ const r=vm.runInContext(`detectPlaceholderAddress({ Billing_Street: '123 Main St', Billing_City: 'Anytown' })`, sb); assert.ok(Array.isArray(r)&&r.length===2); });
t('456 Elm St / Othertown flagged', ()=>{ const r=vm.runInContext(`detectPlaceholderAddress({ Billing_Street: '456 Elm St', Billing_City: 'Othertown' })`, sb); assert.ok(Array.isArray(r)&&r.length===2); });
t('Real Mason address NOT flagged', ()=>{ assert.equal(vm.runInContext(`detectPlaceholderAddress({ Billing_Street: '4780 Socialville Foster Rd', Billing_City: 'Mason' })`, sb), null); });
t('null/empty returns null', ()=>{ assert.equal(vm.runInContext(`detectPlaceholderAddress(null)`, sb), null); assert.equal(vm.runInContext(`detectPlaceholderAddress({})`, sb), null); });
t('Lorem Ipsum flagged', ()=>{ const r=vm.runInContext(`detectPlaceholderAddress({ Shipping_Street: 'Lorem Ipsum Drive' })`, sb); assert.ok(Array.isArray(r)&&r.length===1); });

console.log('\n=== Meraki_ISRs Name auto-build ===\n');
t('First+Last→Name', ()=>{ const r=vm.runInContext(`normalizeMerakiIsrPayload('Meraki_ISRs', { First_Name: 'Mark', Last_Name: 'Hennessy', Email: 'm@cisco.com' })`, sb); assert.equal(r.Name,'Mark Hennessy'); assert.equal('First_Name' in r,false); assert.equal('Last_Name' in r,false); });
t('Name present→no overwrite', ()=>{ const r=vm.runInContext(`normalizeMerakiIsrPayload('Meraki_ISRs', { Name: 'Existing Name', First_Name: 'X' })`, sb); assert.equal(r.Name,'Existing Name'); });
t('Other module passthrough', ()=>{ const r=vm.runInContext(`normalizeMerakiIsrPayload('Contacts', { First_Name: 'Kevin', Last_Name: 'Goosic' })`, sb); assert.equal(r.First_Name,'Kevin'); assert.equal(r.Name,undefined); });
t('Wired into create', ()=>{ assert.ok(/normalizeMerakiIsrPayload\(module_name,\s*recordData\)/.test(source)); });

console.log('\n=== Fix A — Account billing re-fetch on create ===\n');
t('Fix A banner', ()=>{ assert.ok(/Fix A \(Kenwood \+ OPTK postmortems\)/.test(source)); });
t('Fix A gated on NO address fields at all (Codex BLOCK fix)', ()=>{ assert.ok(/const _fixAHasAnyAddr = _FIX_A_ADDR_KEYS\.some/.test(source)); assert.ok(/&& !_fixAHasAnyAddr/.test(source)); assert.ok(!/&& !recordData\.Billing_Street\) \{\n          try \{\n            const _acctBillFetch/.test(source)); });
t('Fix A fills missing only', ()=>{ assert.ok(/if \(!recordData\.Billing_City && _acct\.Billing_City\)/.test(source)); assert.ok(/if \(!recordData\.Shipping_Country && _acct\.Shipping_Country\)/.test(source)); });
t('Fix A normalizes state/country', ()=>{ assert.ok(/normalizeStateCode\(_acct\.Billing_State\)/.test(source)); assert.ok(/normalizeCountryCode\(_acct\.Billing_Country\)/.test(source)); });
t('Fix A non-blocking', ()=>{ assert.ok(/\[FIX-A\] Account billing re-fetch failed \(non-blocking\)/.test(source)); });

console.log('\n=== Fix C — cross-account guard ===\n');
t('Fix C banner', ()=>{ assert.ok(/Fix C \(Kenwood \+ OPTK postmortems\): cross-account billing guard/.test(source)); });
t('Fix C flag-gated', ()=>{ assert.ok(/env\.BOT_ADDRESS_GUARD_ENABLED === 'true' \|\| env\.BOT_ADDRESS_GUARD_ENABLED === '1'/.test(source)); });
t('Fix C detects all 10 addr fields', ()=>{ const m=source.match(/const _ADDR_FIELDS = \[[\s\S]*?\];/); assert.ok(m); for(const f of ['Billing_Street','Billing_City','Billing_State','Billing_Code','Billing_Country','Shipping_Street','Shipping_City','Shipping_State','Shipping_Code','Shipping_Country']) assert.ok(m[0].includes(f), 'missing '+f); });
t('Fix C structured error', ()=>{ assert.ok(/error: 'address_mismatch_account'/.test(source)); assert.ok(/action: 'update_blocked'/.test(source)); });
t('Fix C allows all-blank clears', ()=>{ assert.ok(/const _allBlank = _writingAddr\.every/.test(source)); assert.ok(/if \(!_allBlank\)/.test(source)); });
t('Fix C normalizes for compare', ()=>{ assert.ok(/_normForField/.test(source)); });
t('Fix C non-blocking on fetch fail', ()=>{ assert.ok(/Cross-account guard fetch failed \(non-blocking, allowing write\)/.test(source)); });

console.log('\n=== Fix B — macro idempotency ===\n');
t('Fix B banner', ()=>{ assert.ok(/Fix B \(Kenwood postmortem\): emit next-tool-call hints \+ KV/.test(source)); });
t('Fix B next_tool_calls', ()=>{ assert.ok(/next_tool_calls: _nextToolHints/.test(source)); assert.ok(/tool: 'create_quote_on_deal'/.test(source)); assert.ok(/deal_id: d\.id/.test(source)); });
t('Fix B bypass_tool_call', ()=>{ assert.ok(/bypass_tool_call: _bypassHint/.test(source)); assert.ok(/confirm_new_deal: true/.test(source)); });
t('Fix B KV cache 600s', ()=>{ assert.ok(/env\.CONVERSATION_KV/.test(source)); assert.ok(/expirationTtl: 600/.test(source)); });
t('Fix B keeps error code', ()=>{ assert.ok(/error: 'account_has_open_deals'/.test(source)); });
t('Fix B forbids chain', ()=>{ assert.ok(/Do NOT chain zoho_create_record\(Deals\)\+zoho_create_record\(Quotes\)/.test(source)); });
t('Fix B keeps backward-compat phrase', ()=>{ assert.ok(/call create_quote_on_deal with that deal_id/.test(source)); });

console.log('\n=== F1 — ext endpoint logging ===\n');
t('F1 banners x2', ()=>{ const o=source.match(/F1 fix \(OPTK postmortem\): instrument with crm_operations/g); assert.ok(o&&o.length===2, `found ${o?o.length:0}`); });
t('F1 account logs chrome_ext', ()=>{ const b=source.slice(source.indexOf("case '/api/crm-create-account':"), source.indexOf("case '/api/enrich-company':")); assert.ok(/bot:\s*'chrome_ext'/.test(b)); assert.ok(/operation:\s*'create',\s*\n\s*module:\s*'Accounts'/.test(b)); });
t('F1 contact logs chrome_ext', ()=>{ const b=source.slice(source.indexOf("case '/api/crm-add-contact':"), source.indexOf("case '/api/detect-account':")); assert.ok(/bot:\s*'chrome_ext'/.test(b)); assert.ok(/operation:\s*'create',\s*\n\s*module:\s*'Contacts'/.test(b)); });
t('F1 contact status tri-state', ()=>{ const b=source.slice(source.indexOf("case '/api/crm-add-contact':"), source.indexOf("case '/api/detect-account':")); assert.ok(/_ctcStatus = 'success'/.test(b)); assert.ok(/_ctcStatus = 'skipped'/.test(b)); assert.ok(/let _ctcStatus = 'error'/.test(b)); });
t('F1 best-effort try/catch', ()=>{ assert.ok(/try \{\s*\n\s*await logCrmOpToD1\([\s\S]+?\s*\} catch \(_logErr\)/.test(source)); });

console.log('\n=== F2 — frontend tightening ===\n');
t('F2 banner', ()=>{ assert.ok(/2026-05-19 OPTK contact-false-positive fix/.test(crmPanel)); });
t('F2 strict check', ()=>{ assert.ok(/if \(result && result\.success === true && result\.contactId\)/.test(crmPanel)); });
t('F2 lax removed from handleAddContact', ()=>{ const s=crmPanel.indexOf('async function handleAddContact'); const e=crmPanel.indexOf('}', crmPanel.indexOf('finally {', s)); const b=crmPanel.slice(s,e); assert.ok(!/result\.success \|\| result\.id \|\| result\.contactId/.test(b)); });

console.log('\n=== Composition order ===\n');
t('alias before validate (update)', ()=>{ const u=source.indexOf("case 'zoho_update_record': {"); const v=source.indexOf('const updateCheck = await validateCrmWrite', u); const a=source.indexOf("applyFieldAliases(data,", u); assert.ok(a>0&&a<v); });
t('Fix C before PUT', ()=>{ const g=source.indexOf("Fix C (Kenwood + OPTK postmortems): cross-account billing guard"); const p=source.indexOf("await zohoApiCall('PUT'", g); assert.ok(g>0&&p>g); });
t('Fix A after discount, before createStart', ()=>{ const a=source.indexOf("Fix A (Kenwood + OPTK postmortems)"); const cs=source.indexOf('const createStart = Date.now();', a); const d=source.lastIndexOf('correctQuotedItemDiscounts', a); assert.ok(d>0&&d<a); assert.ok(cs>a); });

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
process.exit(failed>0?1:0);
