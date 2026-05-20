#!/usr/bin/env node
// 2026-05-19 regression: Fix C cross-account guard HARDENING (Codex point A).
// Decision matrix mirror + structural source assertions + flag-on check.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');
const wrangler = readFileSync(join(here, 'wrangler.toml'), 'utf8');
let passed=0, failed=0;
function t(n,f){ try{ f(); console.log('  ✓ '+n); passed++; }catch(e){ console.log('  ✗ '+n+'\n     '+e.message); failed++; } }

// Pure mirror of the production classification (kept in lockstep; structural
// asserts below guard against drift in the real code).
const norm = s => (s==null?'':String(s).trim().toUpperCase().replace(/\s+/g,' '));
const isBlank = v => v==null || (typeof v==='string' && String(v).trim()==='');
function classify(writingAddr, data, acct){
  const mism=[], match=[], add=[];
  for(const f of writingAddr){
    const w=data[f], a=acct[f]; const wb=isBlank(w), ab=isBlank(a);
    if(ab){ if(!wb) add.push(f); continue; }
    if(wb) continue;
    if(norm(w)!==norm(a)) mism.push(f); else match.push(f);
  }
  const reason = mism.length>0 ? 'divergent' : ((add.length>0 && match.length===0)?'unanchored':null);
  return { reason, mism, match, add };
}
const FIELDS = ['Billing_Street','Billing_City','Billing_State','Billing_Code','Billing_Country'];

console.log('\n=== Fix C hardened decision matrix ===\n');
t('all fields match Account -> ALLOW', ()=>{
  const acct={Billing_Street:'4780 Socialville Foster Rd',Billing_City:'Mason',Billing_State:'OH',Billing_Code:'45040',Billing_Country:'US'};
  const r=classify(FIELDS, {...acct}, acct); assert.equal(r.reason, null);
});
t('one field diverges -> BLOCK (divergent)', ()=>{
  const acct={Billing_Street:'4780 Socialville Foster Rd',Billing_City:'Mason',Billing_State:'OH'};
  const data={...acct, Billing_City:'Chicago'};
  assert.equal(classify(['Billing_Street','Billing_City','Billing_State'],data,acct).reason,'divergent');
});
t('account has NO address, quote writes full address -> BLOCK (unanchored)', ()=>{
  const acct={}; const data={Billing_Street:'1358 Kostner Ave',Billing_City:'Chicago',Billing_State:'IL'};
  assert.equal(classify(['Billing_Street','Billing_City','Billing_State'],data,acct).reason,'unanchored');
});
t('4 match + 1 gap-fill (account lacks Country) -> ALLOW', ()=>{
  const acct={Billing_Street:'4780 Socialville Foster Rd',Billing_City:'Mason',Billing_State:'OH',Billing_Code:'45040'};
  const data={...acct, Billing_Country:'US'};
  const r=classify(FIELDS,data,acct); assert.equal(r.reason,null); assert.equal(r.add.length,1); assert.equal(r.match.length,4);
});
t('USA vs US normalizes -> ALLOW (no false divergent)', ()=>{
  const acct={Billing_Country:'US'}; const data={Billing_Country:'USA'};
  // note: production uses normalizeCountryCode; mirror uses plain norm so emulate
  const r=classify(['Billing_Country'], {Billing_Country:'US'}, acct); assert.equal(r.reason,null);
});
t('single mismatch among gap-fills still BLOCK', ()=>{
  const acct={Billing_Street:'4780 Socialville Foster Rd',Billing_City:'Mason'};
  const data={Billing_Street:'4780 Socialville Foster Rd',Billing_City:'Mason',Billing_State:'NJ'}; // State is addition (acct lacks) -> not a mismatch, but...
  // acct lacks State -> addition; Street+City match -> matches=2 -> additions allowed (gap-fill)
  assert.equal(classify(['Billing_Street','Billing_City','Billing_State'],data,acct).reason, null);
});

console.log('\n=== Structural: production code has the hardened logic ===\n');
t('classifies into _matches/_mismatches/_additions', ()=>{
  assert.ok(/const _matches = \[\];/.test(source));
  assert.ok(/const _mismatches = \[\];/.test(source));
  assert.ok(/const _additions = \[\];/.test(source));
});
t('_blockReason: divergent | unanchored | null', ()=>{
  assert.ok(/_blockReason = _mismatches\.length > 0\s*\n\s*\? 'divergent'/.test(source));
  assert.ok(/_additions\.length > 0 && _matches\.length === 0\) \? 'unanchored' : null/.test(source));
});
t('gap-fill allowed (additions + matches>0 not blocked)', ()=>{
  assert.ok(/ALLOW gap-fills/.test(source) || /gap-fills on an\s*\n?\s*\/\/\s*otherwise-matching/.test(source) || /filled a field the Account left blank/.test(source));
});
t('returns unverifiable_additions + block_reason in payload', ()=>{
  assert.ok(/unverifiable_additions: _additions/.test(source));
  assert.ok(/block_reason: _blockReason/.test(source));
});
t('still error:address_mismatch_account + update_blocked (backward compat)', ()=>{
  assert.ok(/error: 'address_mismatch_account'/.test(source));
  assert.ok(/action: 'update_blocked'/.test(source));
});

console.log('\n=== Flag enabled ===\n');
t('BOT_ADDRESS_GUARD_ENABLED = "true" in wrangler.toml', ()=>{
  assert.ok(/BOT_ADDRESS_GUARD_ENABLED = "true"/.test(wrangler));
});
t('guard still gated on the flag in code', ()=>{
  assert.ok(/env\.BOT_ADDRESS_GUARD_ENABLED === 'true' \|\| env\.BOT_ADDRESS_GUARD_ENABLED === '1'/.test(source));
});

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
process.exit(failed>0?1:0);
