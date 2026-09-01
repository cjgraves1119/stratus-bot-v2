// REGRESSION — Zoho field-name + phone-validation guards (port of corp 5690ebf).
//
// Two independent live-Zoho-confirmed defects, both verified against Zoho
// metadata on 2026-07-24 (module Quotes has NO field named `Stage`; the real
// picklist is `Quote_Stage`. Contacts Phone/Mobile are phone-typed and reject
// junk with INVALID_DATA / expected_data_type:"phone").
//
//   (A) Quotes read paths must never select the Deal field `Stage` — Zoho
//       answers INVALID_QUERY and the caller silently renders an EMPTY quote
//       list, which looks like "this account has no quotes".
//   (B) Contact create/update must OMIT an invalid Phone/Mobile rather than
//       send it (never send ""), or the whole write fails with INVALID_DATA.
//
// Source-level assertions (A) because those paths need live Zoho creds to
// exercise; behavioural assertions (B) against the real exported helpers.
//
// Run: node worker-gchat/test-quote-stage-and-contact-phone-2026-07-24.js

const fs = require('fs'), path = require('path'), assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { fail++; console.log(`  ✗ ${name}\n      ${err}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }

console.log('\n(A) Quotes must use Quote_Stage, never the Deal field Stage');

check('no Quotes field-list selects bare `Stage`', () => {
  const hits = SRC.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /Quotes:\s*'id,Subject,Quote_Number,Grand_Total,Deal_Name,Stage'/.test(l));
  assert.strictEqual(hits.length, 0, `field maps still selecting Stage at line(s) ${hits.map(h => h[0]).join(', ')}`);
});

check('no COQL selects `Stage` from Quotes', () => {
  const hits = SRC.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /Grand_Total,\s*Stage,[\s\S]*from Quotes/.test(l));
  assert.strictEqual(hits.length, 0, `COQL still selecting Stage at line(s) ${hits.map(h => h[0]).join(', ')}`);
});

check('no related-list GET requests Stage on Quotes', () => {
  assert.ok(!/Quotes\?fields=[^`'"]*,Stage,/.test(SRC), 'a Deals/{id}/Quotes GET still requests Stage');
});

check('no quote result mapping reads q.Stage', () => {
  const hits = SRC.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /stage:\s*q\.Stage\b/.test(l));
  assert.strictEqual(hits.length, 0, `mapping still reads q.Stage at line(s) ${hits.map(h => h[0]).join(', ')}`);
});

check('Quote_Stage IS used in the quote read paths', () => {
  assert.ok(/Quotes:\s*'id,Subject,Quote_Number,Grand_Total,Deal_Name,Quote_Stage'/.test(SRC), 'field map missing Quote_Stage');
  assert.ok(/select Subject, Quote_Number, Grand_Total, Quote_Stage,[\s\S]*?from Quotes/.test(SRC), 'COQL missing Quote_Stage');
});

check('Deals STILL use their real `Stage` field (no over-correction)', () => {
  assert.ok(/Deals:\s*'id,Deal_Name,Stage,/.test(SRC), 'Deals field list lost Stage — Deals really do have Stage');
  assert.ok(!/Deals:\s*'id,Deal_Name,Quote_Stage/.test(SRC), 'Deals wrongly rewritten to Quote_Stage');
});

console.log('\n(B) Contact Phone/Mobile sanitisation');

// Load the two pure helpers without executing the Worker entrypoint.
function loadPhoneHelpers() {
  const grab = (name) => {
    const start = SRC.indexOf(`function ${name}(`);
    assert.ok(start > -1, `${name} not found in source`);
    // walk braces from the first { after the signature
    let i = SRC.indexOf('{', start), depth = 0;
    for (let j = i; j < SRC.length; j++) {
      if (SRC[j] === '{') depth++;
      else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
    }
    throw new Error(`could not extract ${name}`);
  };
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', `${grab('sanitizeZohoPhoneField')}\n${grab('applyZohoPhoneFields')}\nmodule.exports = { sanitizeZohoPhoneField, applyZohoPhoneFields };`)(mod);
  return mod.exports;
}
const { sanitizeZohoPhoneField, applyZohoPhoneFields } = loadPhoneHelpers();

check('rejects the values Zoho rejects (emails, N/A, URLs)', () => {
  assert.strictEqual(sanitizeZohoPhoneField('someone@example.com'), null, 'email must be omitted');
  assert.strictEqual(sanitizeZohoPhoneField('N/A'), null, 'N/A must be omitted');
  assert.strictEqual(sanitizeZohoPhoneField('n/a'), null, 'n/a must be omitted');
  assert.strictEqual(sanitizeZohoPhoneField('https://example.com/x'), null, 'URL must be omitted');
});

check('never sends empty string (omits instead)', () => {
  assert.strictEqual(sanitizeZohoPhoneField(''), null);
  assert.strictEqual(sanitizeZohoPhoneField('   '), null);
  assert.strictEqual(sanitizeZohoPhoneField(null), null);
  assert.strictEqual(sanitizeZohoPhoneField(undefined), null);
});

check('keeps real phone shapes intact', () => {
  assert.strictEqual(sanitizeZohoPhoneField('404-555-0134'), '404-555-0134');
  assert.strictEqual(sanitizeZohoPhoneField('+1 (404) 555-0134 x22'), '+1 (404) 555-0134 x22');
  assert.strictEqual(sanitizeZohoPhoneField('  612.555.0100  '), '612.555.0100', 'must trim');
});

check('rejects absurdly long values', () => {
  assert.strictEqual(sanitizeZohoPhoneField('1'.repeat(31)), null);
});

check('applyZohoPhoneFields deletes invalid keys and reports them', () => {
  const rec = { Last_Name: 'Example', Phone: 'N/A', Mobile: '404-555-0134' };
  const omitted = applyZohoPhoneFields(rec);
  assert.ok(!('Phone' in rec), 'invalid Phone key must be DELETED, not blanked');
  assert.strictEqual(rec.Mobile, '404-555-0134', 'valid Mobile must survive');
  assert.strictEqual(rec.Last_Name, 'Example', 'unrelated fields untouched');
  assert.strictEqual(omitted.length, 1);
  assert.ok(/Phone=/.test(omitted[0]), 'omission must be reported for logging');
});

check('applyZohoPhoneFields leaves absent keys absent (no accidental blanking)', () => {
  const rec = { Last_Name: 'Example' };
  const omitted = applyZohoPhoneFields(rec);
  assert.deepStrictEqual(Object.keys(rec), ['Last_Name']);
  assert.strictEqual(omitted.length, 0);
});

console.log('\n(C) write paths actually call the guard');

check('zoho_create_record(Contacts) sanitises', () => {
  assert.ok(/zoho_create_record omitted invalid/.test(SRC), 'create path missing phone guard');
});
check('zoho_update_record(Contacts) sanitises', () => {
  assert.ok(/zoho_update_record omitted invalid/.test(SRC), 'update path missing phone guard');
});
check('/api/crm-add-contact never sends a bare Phone/Mobile', () => {
  assert.ok(!/Phone:\s*newCtPhone\s*\|\|\s*''/.test(SRC), "crm-add-contact still sends Phone: newCtPhone || ''");
  assert.ok(!/Mobile:\s*newCtMobile\s*\|\|\s*''/.test(SRC), "crm-add-contact still sends Mobile: newCtMobile || ''");
  assert.ok(/crm-add-contact omitted invalid Phone/.test(SRC), 'crm-add-contact missing phone guard');
});

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
