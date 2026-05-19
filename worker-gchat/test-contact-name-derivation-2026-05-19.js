#!/usr/bin/env node
// 2026-05-19 regression: contact name derivation (thread display-name + email local-part).
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');
const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');
const crmPanel = readFileSync(join(here, '../chrome-extension/src/sidebar/panels/CrmPanel.jsx'), 'utf8');
let passed=0, failed=0;
function t(n,f){ try{ f(); console.log('  ✓ '+n); passed++; }catch(e){ console.log('  ✗ '+n+'\n     '+e.message); failed++; } }

// Extract the two helper fns into a sandbox.
function slice(name){
  const a = source.indexOf('function '+name);
  if (a<0) throw new Error(name+' not found');
  let i = source.indexOf('{', a), d=0, end=-1;
  for(let j=i;j<source.length;j++){ if(source[j]==='{')d++; else if(source[j]==='}'){d--; if(d===0){end=j+1;break;}} }
  return source.slice(a,end);
}
const ctx = { console:{log(){},warn(){}} };
vm.createContext(ctx);
vm.runInContext(slice('_titleCaseNameToken')+'\n'+slice('deriveContactNameFields'), ctx);
const derive = (e,h)=>vm.runInContext(`JSON.stringify(deriveContactNameFields(${JSON.stringify(e)}, ${JSON.stringify(h||null)}))`, ctx);

console.log('\n=== Method 2: email local-part best guess ===\n');
t('kevin.goosic@optk.com -> Kevin Goosic', ()=>{ assert.deepEqual(JSON.parse(derive('kevin.goosic@optk.com')), {firstName:'Kevin',lastName:'Goosic'}); });
t('mary.jane.watson@x.com -> Mary "Jane Watson"', ()=>{ assert.deepEqual(JSON.parse(derive('mary.jane.watson@x.com')), {firstName:'Mary',lastName:'Jane Watson'}); });
t('kevin_goosic@x.com (underscore)', ()=>{ assert.deepEqual(JSON.parse(derive('kevin_goosic@x.com')), {firstName:'Kevin',lastName:'Goosic'}); });
t('kevin-goosic@x.com (dash)', ()=>{ assert.deepEqual(JSON.parse(derive('kevin-goosic@x.com')), {firstName:'Kevin',lastName:'Goosic'}); });
t('jdoe@x.com single token -> last only, no fabricated first', ()=>{ assert.deepEqual(JSON.parse(derive('jdoe@x.com')), {firstName:'',lastName:'Jdoe'}); });
t('john.smith2@x.com strips trailing digits', ()=>{ assert.deepEqual(JSON.parse(derive('john.smith2@x.com')), {firstName:'John',lastName:'Smith'}); });
t('UPPER.CASE@x.com normalizes case', ()=>{ assert.deepEqual(JSON.parse(derive('KEVIN.GOOSIC@x.com')), {firstName:'Kevin',lastName:'Goosic'}); });
t('hyphenated last name mary.smith-jones', ()=>{ assert.deepEqual(JSON.parse(derive('mary.smith-jones@x.com')), {firstName:'Mary',lastName:'Smith-Jones'}); });
t('empty email -> blanks', ()=>{ assert.deepEqual(JSON.parse(derive('')), {firstName:'',lastName:''}); });

console.log('\n=== Method 1: thread display-name hint (preferred over local-part) ===\n');
t('hint "Kevin Goosic" wins', ()=>{ assert.deepEqual(JSON.parse(derive('kg@optk.com','Kevin Goosic')), {firstName:'Kevin',lastName:'Goosic'}); });
t('hint with angle-bracket email stripped', ()=>{ assert.deepEqual(JSON.parse(derive('kg@optk.com','Kevin Goosic <kg@optk.com>')), {firstName:'Kevin',lastName:'Goosic'}); });
t('hint that is just the local-part is ignored -> falls back to local-part', ()=>{ assert.deepEqual(JSON.parse(derive('kevin.goosic@optk.com','kevin.goosic')), {firstName:'Kevin',lastName:'Goosic'}); });
t('three-word hint -> First + rest', ()=>{ assert.deepEqual(JSON.parse(derive('x@y.com','Mary Jane Watson')), {firstName:'Mary',lastName:'Jane Watson'}); });
t('single-word hint -> last only', ()=>{ assert.deepEqual(JSON.parse(derive('x@y.com','Cher')), {firstName:'',lastName:'Cher'}); });

console.log('\n=== Wiring checks ===\n');
t('LLM zoho_create_record(Contacts) derives when First+Last blank', ()=>{ assert.ok(/module_name === 'Contacts' && !recordData\.First_Name && !recordData\.Last_Name && recordData\.Email/.test(source)); assert.ok(/deriveContactNameFields\(recordData\.Email, null\)/.test(source)); });
t('LLM Contacts has Last_Name local-part fallback (Codex hardening)', ()=>{ assert.ok(/Codex review hardening \(2026-05-19\): Last_Name is Zoho-required/.test(source)); assert.ok(/zoho_create_record Last_Name fallback to local-part/.test(source)); });
t('/api/crm-add-contact accepts nameHint + derives', ()=>{ assert.ok(/nameHint: newCtNameHint/.test(source)); assert.ok(/deriveContactNameFields\(newCtEmail, newCtNameHint\)/.test(source)); });
t('api derive only when both names blank', ()=>{ assert.ok(/if \(!newCtFirst && !newCtLast && newCtEmail\) \{/.test(source)); });
t('CrmPanel openAddForm prefills from thread + local-part', ()=>{ assert.ok(/Contact name derivation \(Chris request\)/.test(crmPanel)); assert.ok(/emailContext\?\.threadContacts/.test(crmPanel)); });
t('CrmPanel passes nameHint to background', ()=>{ assert.ok(/nameHint: _hintContact\?\.name/.test(crmPanel)); });

console.log(`\n--- ${passed} passed, ${failed} failed ---\n`);
process.exit(failed>0?1:0);
