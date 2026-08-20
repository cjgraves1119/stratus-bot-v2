// Fixes for personal DEV error_reports #11 and #12 (reported 2026-08-03).
//
// #12: "Blocked: isr_not_found — fix in Zoho/catalog first." A Cisco address
// was merely PRESENT on the email thread (ashilen@cisco.com) with no
// Meraki_ISRs record. That pushed a HARD isr_not_found blocker, which disabled
// Execute on the one-shot card permanently — even under Stratus Referal, where
// no ISR is required. Evidence-only rep gaps are now ADVISORY; explicit rep
// requests and Meraki ISR Referal still hard-block.
//
// Behavioral: the real snapshot/validate helpers run against real tokens.
// Run: node worker-gchat/test-error-reports-2026-08-03.js

const fs = require('fs'), path = require('path'), assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
const PANEL = fs.readFileSync(
  path.join(__dirname, '../chrome-extension/src/sidebar/panels/ChatPanel.jsx'), 'utf8');
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ❌ ${n}\n      ${e}`); };
function check(n, fn) { try { fn(); ok(n); } catch (e) { bad(n, e.message); } }
async function checkAsync(n, fn) { try { await fn(); ok(n); } catch (e) { bad(n, e.message); } }

function grab(name) {
  let start = SRC.indexOf(`async function ${name}(`);
  if (start === -1) start = SRC.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found`);
  let p = SRC.indexOf('(', start), pd = 0, bodyStart = -1;
  for (let j = p; j < SRC.length; j++) {
    if (SRC[j] === '(') pd++;
    else if (SRC[j] === ')') { pd--; if (pd === 0) { bodyStart = SRC.indexOf('{', j); break; } }
  }
  let d = 0;
  for (let j = bodyStart; j < SRC.length; j++) {
    if (SRC[j] === '{') d++;
    else if (SRC[j] === '}') { d--; if (d === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error(`could not extract ${name}`);
}

const mod = { exports: {} };
new Function('module', [
  'const base64url = (b) => Buffer.from(typeof b === "string" ? b : Buffer.from(b)).toString("base64url");',
  'const base64UrlDecode = (s) => Buffer.from(s, "base64url").toString("utf8");',
  'const base64UrlToUint8Array = (s) => new Uint8Array(Buffer.from(s, "base64url"));',
  grab('normalizeOneshotEmail'),
  grab('canonicalOneshotRecipients'),
  grab('canonicalOneshotSkus'),
  grab('oneshotReviewKey'),
  grab('buildOneshotReviewSnapshot'),
  grab('signOneshotReviewToken'),
  grab('readOneshotReviewToken'),
  grab('sameOneshotJson'),
  grab('validateOneshotReviewBinding'),
  'module.exports = { buildOneshotReviewSnapshot, signOneshotReviewToken, validateOneshotReviewBinding };',
].join('\n'))(mod);
const H = mod.exports;

const ENV = { ONESHOT_REVIEW_SECRET: 'unit-test-review-secret' };
const CALLER = 'chrisg@stratusinfosystems.com';

// The exact shape of report #12: a Cisco rep on the thread, unknown to
// Meraki_ISRs, customer quote under Stratus Referal.
function planFixture(leadSource) {
  return {
    lead_source: leadSource,
    customer: { contact: { email: 'darren@united-systems.com' } },
    account: { mode: 'existing', id: 'ACC1', name: 'United Systems' },
    contact: { mode: 'existing', id: 'CON1', email: 'darren@united-systems.com' },
    deal: { mode: 'new', open_deals: [] },
    isr: { status: 'none', query: 'ashilen@cisco.com' },
  };
}
function inputFixture(leadSource) {
  return {
    source: 'ext-oneshot',
    lead_source: leadSource,
    participants: [
      { email: 'darren@united-systems.com', name: 'Darren Duncan' },
      { email: 'ashilen@cisco.com', name: 'Ashley Shilen' },
    ],
    skus: [{ sku: 'MX75-HW', qty: 1 }, { sku: 'LIC-MX75-SEC-3Y', qty: 1 }],
  };
}
const evidenceBlocker = (leadSource) => ({
  code: 'isr_not_found', query: 'ashilen@cisco.com',
  advisory: leadSource !== 'Meraki ISR Referal' || undefined,
  evidence_only: true,
});

(async () => {

console.log('\n(1) Snapshot: advisory blockers never gate; real blockers still do');

check('evidence-only isr_not_found under Stratus Referal is EXCLUDED from blocker_codes', () => {
  const snap = H.buildOneshotReviewSnapshot(
    planFixture('Stratus Referal'),
    [evidenceBlocker('Stratus Referal')],
    inputFixture('Stratus Referal'), CALLER
  );
  assert.ok(!snap.blocker_codes.includes('isr_not_found'),
    'an advisory rep gap must not gate Execute');
});

check('the SAME rep gap under Meraki ISR Referal IS gating', () => {
  const snap = H.buildOneshotReviewSnapshot(
    planFixture('Meraki ISR Referal'),
    [evidenceBlocker('Meraki ISR Referal'), { code: 'isr_required_for_lead_source' }],
    inputFixture('Meraki ISR Referal'), CALLER
  );
  assert.ok(snap.blocker_codes.includes('isr_not_found'),
    'attributing the deal to an unknown rep must still block');
});

check('an EXPLICIT rep request that fails is never advisory', () => {
  // buildOneshotPlan pushes this shape when the user named a rep/email.
  const snap = H.buildOneshotReviewSnapshot(
    planFixture('Stratus Referal'),
    [{ code: 'isr_not_found', query: 'nobody@cisco.com' }],
    inputFixture('Stratus Referal'), CALLER
  );
  assert.ok(snap.blocker_codes.includes('isr_not_found'),
    'a rep the user explicitly asked for must still block');
});

check('non-advisory blockers of other kinds are untouched', () => {
  const snap = H.buildOneshotReviewSnapshot(
    planFixture('Stratus Referal'),
    [{ code: 'unresolved_sku', sku: 'MX75-HW' }, evidenceBlocker('Stratus Referal')],
    inputFixture('Stratus Referal'), CALLER
  );
  assert.deepStrictEqual(snap.blocker_codes, ['unresolved_sku']);
});

console.log('\n(2) Validate: the report-#12 plan can now execute; unsafe variants cannot');

await checkAsync('Stratus Referal + evidence-only rep gap PASSES validation', async () => {
  const lead = 'Stratus Referal';
  const snap = H.buildOneshotReviewSnapshot(
    planFixture(lead), [evidenceBlocker(lead)], inputFixture(lead), CALLER);
  const token = await H.signOneshotReviewToken(snap, ENV);
  const r = await H.validateOneshotReviewBinding({
    ...inputFixture(lead), review_token: token,
    account: { id: 'ACC1' }, contact: { id: 'CON1' },
    deal: { new: true, confirmed: true },
  }, ENV, CALLER);
  assert.strictEqual(r.success, true, `expected pass, got: ${JSON.stringify(r.missing || r.error)}`);
});

await checkAsync('Meraki ISR Referal with the same unknown rep still FAILS closed', async () => {
  const lead = 'Meraki ISR Referal';
  const snap = H.buildOneshotReviewSnapshot(
    planFixture(lead),
    [evidenceBlocker(lead), { code: 'isr_required_for_lead_source' }],
    inputFixture(lead), CALLER);
  const token = await H.signOneshotReviewToken(snap, ENV);
  const r = await H.validateOneshotReviewBinding({
    ...inputFixture(lead), review_token: token,
    account: { id: 'ACC1' }, contact: { id: 'CON1' },
    deal: { new: true, confirmed: true },
  }, ENV, CALLER);
  assert.strictEqual(r.success, false, 'must not execute without a real ISR');
  assert.strictEqual(r.error, 'review_mismatch');
});

await checkAsync('advisory does NOT weaken the unrelated hard gates', async () => {
  const lead = 'Stratus Referal';
  const snap = H.buildOneshotReviewSnapshot(
    planFixture(lead),
    [evidenceBlocker(lead), { code: 'unresolved_sku', sku: 'MX75-HW' }],
    inputFixture(lead), CALLER);
  const token = await H.signOneshotReviewToken(snap, ENV);
  const r = await H.validateOneshotReviewBinding({
    ...inputFixture(lead), review_token: token,
    account: { id: 'ACC1' }, contact: { id: 'CON1' },
    deal: { new: true, confirmed: true },
  }, ENV, CALLER);
  assert.strictEqual(r.success, false);
  assert.ok(r.missing.some((m) => /blockers/.test(m)), 'unresolved_sku must still stop Execute');
});

console.log('\n(3) Plan + card wiring');

check('both participant-derived isr_not_found sites are evidence_only/advisory', () => {
  const plan = grab('buildOneshotPlan');
  const evidenceSites = (plan.match(/evidence_only: true/g) || []).length;
    assert.strictEqual(evidenceSites, 2,
    'the single-rep and multi-rep participant branches must both mark evidence_only');
  assert.ok(/advisory: leadSource !== 'Meraki ISR Referal'/.test(plan),
    'advisory must be derived from the lead source, not hardcoded');
  // The explicit-request branches must NOT be marked advisory.
  const explicit = plan.slice(plan.indexOf('if (p.meraki_isr_email)'), plan.indexOf('const participantRepEmails'));
  assert.ok(!/advisory/.test(explicit), 'explicit rep requests must never be advisory');
});

check('isr_required_for_lead_source still fires for Meraki ISR Referal', () => {
  const plan = grab('buildOneshotPlan');
  assert.ok(/leadSource === 'Meraki ISR Referal' && plan\.isr\.status !== 'resolved'/.test(plan));
});

check('card excludes advisory from the Execute-disabling hard set', () => {
  assert.ok(/const advisory = blockers\.filter\(\(b\) => b\.advisory === true\)/.test(PANEL));
  assert.ok(/const hard = blockers\.filter\(\(b\) => b\.advisory !== true\)/.test(PANEL),
    'hard must be computed from non-advisory blockers only');
});

check('card surfaces the advisory as a visible note, not silence', () => {
  assert.ok(/has no Meraki_ISRs record/.test(PANEL), 'the rep gap must still be told to the reviewer');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
