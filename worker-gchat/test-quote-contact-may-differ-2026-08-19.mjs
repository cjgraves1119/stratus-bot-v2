// Business rule (2026-08-19, from Chris): a quote's contact may differ from the
// primary contact on the Deal or the Account. That must not stop a quote.
//
// Before this, quoting for Trevor Goode on a Deal whose Zoho primary contact is
// John Taylor was refused at Execute as "reviewed_deal_target_changed — the Deal
// Contact changed after Plan". Nothing had changed; the Deal simply belongs to
// someone else at the same Account, which is ordinary.
//
// The rule now:
//   - the Deal must still be open, still be the reviewed Deal, and still be on
//     the reviewed Account;
//   - the quote's contact must still read back as the reviewed contact;
//   - the Deal's own primary contact is irrelevant;
//   - a contact linked to a DIFFERENT Account is flagged and needs explicit
//     approval, not a refusal.

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
  src += `\nmodule.exports = { validateOneshotAttachTarget };\n`;
  const tmpPath = path.join(__dirname, `.tmp-extract-contact-rule-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally { fs.unlinkSync(tmpPath); }
}
const mod = extractRealFunctions();
const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

// Real ids captured from Zoho while diagnosing the report.
const ACCOUNT = '2570562000219891005';   // Bayer Heritage Federal Credit Union
const DEAL = '2570562000422419031';      // "… New Site"
const JOHN = '2570562000219891022';      // the Deal's primary contact
const TREVOR = '2570562000334501093';    // the contact this quote is for

const dealRecord = (contactId, accountId = ACCOUNT, stage = 'Qualification') => ({
  id: DEAL, Stage: stage,
  Account_Name: { id: accountId },
  Contact_Name: contactId ? { id: contactId } : null,
});
const reviewed = (contactId = TREVOR, accountId = ACCOUNT) => ({
  deal_id: DEAL, account_id: accountId, contact_id: contactId,
});

test('a quote for another contact at the same Account is allowed', () => {
  const res = mod.validateOneshotAttachTarget(
    dealRecord(JOHN), reviewed(TREVOR), { requireContactMatch: false });
  assert.equal(res.success, true, `expected success, got ${res.error}: ${res.detail}`);
});

test('a Deal with no primary contact at all is allowed', () => {
  const res = mod.validateOneshotAttachTarget(
    dealRecord(null), reviewed(TREVOR), { requireContactMatch: false });
  assert.equal(res.success, true, `expected success, got ${res.error}`);
});

test('the reviewed contact must still read back as itself', () => {
  const good = mod.validateOneshotAttachTarget(
    { ...dealRecord(JOHN), Contact_Name: { id: TREVOR } }, reviewed(TREVOR), { requireContactMatch: true });
  assert.equal(good.success, true, good.detail);

  const swapped = mod.validateOneshotAttachTarget(
    { ...dealRecord(JOHN), Contact_Name: { id: JOHN } }, reviewed(TREVOR), { requireContactMatch: true });
  assert.equal(swapped.success, false, 'a different contact reading back must be refused');
  assert.equal(swapped.error, 'reviewed_deal_target_changed');

  const unreadable = mod.validateOneshotAttachTarget(
    { ...dealRecord(JOHN), Contact_Name: null }, reviewed(TREVOR), { requireContactMatch: true });
  assert.equal(unreadable.success, false, 'an unreadable contact must be refused');
});

test('every other target guard still refuses', () => {
  const cases = [
    ['a Deal on a different Account', dealRecord(JOHN, '2570562000999999999'), reviewed()],
    ['a Deal id that no longer matches', { ...dealRecord(JOHN), id: '999' }, reviewed()],
    ['a closed Deal', dealRecord(JOHN, ACCOUNT, 'Closed (Lost)'), reviewed()],
    ['an unreadable Deal', { ...dealRecord(JOHN), id: '' }, reviewed()],
    ['a review with no Deal id', dealRecord(JOHN), { deal_id: '', account_id: ACCOUNT, contact_id: TREVOR }],
    ['a review with no Account id', dealRecord(JOHN), { deal_id: DEAL, account_id: '', contact_id: TREVOR }],
  ];
  for (const [label, deal, expected] of cases) {
    const res = mod.validateOneshotAttachTarget(deal, expected, { requireContactMatch: false });
    assert.equal(res.success, false, `${label} must still be refused`);
    assert.ok(res.detail, `${label} must explain itself`);
  }
});

test('no expected target at all is still a pass-through', () => {
  assert.equal(mod.validateOneshotAttachTarget(dealRecord(JOHN), null).success, true);
});

// ── Wiring ──────────────────────────────────────────────────────────────────

test('the Deal-level call does not assert the primary contact', () => {
  assert.match(source, /existingDealData, reviewedAttachTarget, \{ requireContactMatch: false \}/,
    'the Deal-level check must opt out of the contact identity comparison');
});

test('a cross-account contact is approvable, not fatal', () => {
  assert.match(source, /toolInput\?\.approve_contact_account_mismatch !== true/,
    'Execute must let an explicit approval through');
  assert.match(source, /error: 'contact_account_mismatch'/);
  assert.match(source, /approvable: true/);
  // The review gate must stop treating it as permanently unresolved.
  assert.match(source, /input\?\.approve_contact_account_mismatch === true \? \['contact_account_mismatch'\] : \[\]/,
    'an approved mismatch must clear the review blocker gate');
});

test('every other hard blocker stays unapprovable', () => {
  const gate = source.slice(source.indexOf('const approvedBlockers'), source.indexOf('if (unresolved.length)'));
  for (const code of ['unresolved_sku', 'inactive_sku', 'eol_sku', 'deal_not_open', 'ambiguous_contact']) {
    assert.doesNotMatch(gate, new RegExp(`'${code}'`),
      `${code} must not become approvable`);
  }
});
