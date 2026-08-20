// Fix (2026-08-19): a Contact pinned in the extension was ignored by the one-shot.
//
// Chris pinned Trevor Goode, and the card still showed "CUSTOMER — multiple people
// on the thread, explicit pick required" plus "ACCOUNT — WILL BE CREATED", and
// Execute blocked on ambiguous_contact.
//
// First attempt (1.27.21) set plan.contact from the pinned id, but the CUSTOMER
// decision and selectedEmail are made earlier and from email only, so nothing
// changed. The pin is now resolved before that decision.
//
// The pin is authoritative and skips the thread-participant eligibility gate on
// purpose: a customer pinned from the CRM need not appear on the Gmail thread,
// and failing there with contact_not_eligible would be worse than asking.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function extractRealFunctions() {
  const escPath = (rel) => path.join(__dirname, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `\nmodule.exports = { oneshotPinnedRecordCustomer };\n`;
  const tmpPath = path.join(__dirname, `.tmp-extract-pinned-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try { delete require.cache[require.resolve(tmpPath)]; return require(tmpPath); }
  finally { fs.unlinkSync(tmpPath); }
}
const mod = extractRealFunctions();
const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

// Trevor Goode, as Zoho actually holds him.
const TREVOR = {
  id: '2570562000334501093',
  Full_Name: 'Trevor Goode',
  Email: 'trevorgoode@bayerhfcu.com',
  Account_Name: { id: '2570562000219891005', name: 'Bayer Heritage Federal Credit Union' },
};
const threadWithOthers = {
  status: 'ambiguous',
  reason: 'multiple recipients',
  candidates: [
    { email: 'someone@bayerhfcu.com', name: 'Someone Else' },
    { email: 'other@bayerhfcu.com', name: 'Other Person' },
  ],
  vendors: [{ email: 'adrsanch@cisco.com', name: 'A Cisco Rep' }],
};

test('a pinned contact decides the customer even on an ambiguous thread', () => {
  const decision = mod.oneshotPinnedRecordCustomer(TREVOR, threadWithOthers);
  assert.ok(decision, 'a pinned contact with an email must decide');
  assert.equal(decision.selectedEmail, 'trevorgoode@bayerhfcu.com');
  assert.equal(decision.selectedName, 'Trevor Goode');
  assert.equal(decision.customer.status, 'pinned_record');
  assert.equal(decision.customer.contact.email, 'trevorgoode@bayerhfcu.com');
});

test('the pinned contact carries its Account so none is invented', () => {
  const decision = mod.oneshotPinnedRecordCustomer(TREVOR, threadWithOthers);
  assert.equal(decision.accountId, '2570562000219891005');
});

test('the thread candidates are preserved for the picker', () => {
  const decision = mod.oneshotPinnedRecordCustomer(TREVOR, threadWithOthers);
  assert.equal(decision.customer.candidates.length, 2, 'the rep can still override');
  assert.equal(decision.customer.vendors.length, 1);
});

test('a pin the thread does not contain is still authoritative', () => {
  // This is the whole point: the eligibility gate would have failed it.
  const decision = mod.oneshotPinnedRecordCustomer(TREVOR, {
    status: 'ambiguous', candidates: [{ email: 'nobody@example.com', name: 'Nobody' }], vendors: [],
  });
  assert.equal(decision.selectedEmail, 'trevorgoode@bayerhfcu.com');
});

test('an unusable pin decides nothing and falls through', () => {
  assert.equal(mod.oneshotPinnedRecordCustomer(null, threadWithOthers), null);
  assert.equal(mod.oneshotPinnedRecordCustomer({ id: '1' }, threadWithOthers), null,
    'no email means nothing to select on');
  assert.equal(mod.oneshotPinnedRecordCustomer({ Email: 'a@b.com' }, threadWithOthers), null,
    'no id means it is not a resolved record');
});

test('a contact with no linked Account yields no account id', () => {
  const decision = mod.oneshotPinnedRecordCustomer({ ...TREVOR, Account_Name: null }, threadWithOthers);
  assert.equal(decision.accountId, null, 'nothing is invented');
  assert.equal(decision.selectedEmail, 'trevorgoode@bayerhfcu.com');
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the pin is resolved BEFORE the customer decision', () => {
  const pinAt = source.indexOf('const pinnedRecord = (!p.existing_deal_id && pinnedContactRecordId)');
  const customerAt = source.indexOf('let selectedEmail = p.existing_deal_id');
  const branchAt = source.indexOf("} else if (pinnedRecord && selectedEmail === pinnedRecord.selectedEmail) {");
  assert.ok(pinAt > -1 && customerAt > pinAt, 'the pin must resolve ahead of selectedEmail');
  assert.ok(branchAt > customerAt, 'and take its own branch in the customer decision');
});

test('the pinned account is used when the caller supplied none', () => {
  assert.match(source, /String\(p\.account_id \|\| pinnedRecord\?\.accountId \|\| ''\)\.trim\(\)/,
    'an explicit account_id still wins over the contact\'s account');
});

test('a pinned Deal still owns the customer relationship', () => {
  // The pinned-record path is skipped when a Deal is pinned, so the Deal's own
  // contact keeps precedence and none of that logic changes.
  assert.match(source, /const pinnedRecord = \(!p\.existing_deal_id && pinnedContactRecordId\)/);
});
