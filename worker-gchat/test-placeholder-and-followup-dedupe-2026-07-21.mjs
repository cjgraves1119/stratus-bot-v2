// Self-check for the 2026-07-21 consolidated-dev fixes:
//   1. isPlaceholderName() — placeholder record-name gate (L5)
//   2. createFollowUpTaskForDeal same-turn memo dedupe (L6)
// Run: node test-placeholder-and-followup-dedupe-2026-07-21.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok - ${name}`); pass++; }
  catch (e) { console.log(`  FAIL - ${name}\n    ${e.message}`); fail++; }
}

// ── 1. isPlaceholderName ─────────────────────────────────────────────────────
const phStart = SRC.indexOf('const PLACEHOLDER_NAME_RE');
const phEnd = SRC.indexOf('\n}', SRC.indexOf('function isPlaceholderName')) + 2;
assert(phStart > -1 && phEnd > phStart, 'isPlaceholderName block not found in src/index.js');
const isPlaceholderName = new Function(`${SRC.slice(phStart, phEnd)}; return isPlaceholderName;`)();

for (const s of ['Company Name', 'Company Name - 3x MX75', '{Account} - MX', 'tbd']) {
  t(`placeholder TRUE: "${s}"`, () => assert.strictEqual(isPlaceholderName(s), true));
}
for (const s of ['Accountemps', 'Bluewater Trading LLC', 'Prairie Valley Association']) {
  t(`placeholder FALSE: "${s}"`, () => assert.strictEqual(isPlaceholderName(s), false));
}
t('placeholder TRUE: empty/null/non-string/1-char', () => {
  assert.strictEqual(isPlaceholderName(''), true);
  assert.strictEqual(isPlaceholderName(null), true);
  assert.strictEqual(isPlaceholderName(42), true);
  assert.strictEqual(isPlaceholderName('A'), true);
});

// ── 2. createFollowUpTaskForDeal same-turn memo dedupe ───────────────────────
const fnStart = SRC.indexOf('async function createFollowUpTaskForDeal');
const fnEnd = SRC.indexOf('/**\n * Log a bot interaction to D1 bot_usage table', fnStart);
assert(fnStart > -1 && fnEnd > fnStart, 'createFollowUpTaskForDeal not found in src/index.js');
const fnSrc = SRC.slice(fnStart, fnEnd);

let zohoPosts = 0;
const stubs = {
  coqlEscape: (v) => String(v).replace(/'/g, "\\'"),
  zohoApiCall: async (method, path) => {
    if (path === 'Tasks') { zohoPosts++; return { data: [{ status: 'success', details: { id: 'TASK-1' } }] }; }
    return { error: '', status: 204 }; // COQL no-rows
  },
  getOwnerContext: async () => null,
  callerEmailFromPersonId: () => null,
  normalizeCallerEmail: () => null,
  logCrmOpToD1: async () => {},
  botFromPersonId: () => 'test',
};
const createFollowUpTaskForDeal = new Function(
  ...Object.keys(stubs),
  `${fnSrc}; return createFollowUpTaskForDeal;`
)(...Object.values(stubs));

const env = { SYSTEM_OWNER_ID: 'SYS-1' };
const first = await createFollowUpTaskForDeal({ dealId: 'D-1', subjectLabel: 'Acme Corp', env, personId: null, ownerId: 'O-1', existingDeal: false });
t('memo: first call creates the Task', () => {
  assert.strictEqual(first.success, true);
  assert.strictEqual(first.taskId, 'TASK-1');
  assert.ok(!first.deduped, 'first call must not be deduped');
  assert.strictEqual(zohoPosts, 1);
});
const second = await createFollowUpTaskForDeal({ dealId: 'D-1', subjectLabel: 'Acme Corp', env, personId: null, ownerId: 'O-1', existingDeal: false });
t('memo: second same-turn call returns deduped:true, no second POST', () => {
  assert.strictEqual(second.success, true);
  assert.strictEqual(second.deduped, true);
  assert.strictEqual(second.taskId, 'TASK-1');
  assert.strictEqual(second.dueDate, first.dueDate);
  assert.strictEqual(zohoPosts, 1, 'no second Tasks POST');
});
const otherDeal = await createFollowUpTaskForDeal({ dealId: 'D-2', subjectLabel: 'Bluewater Trading LLC', env, personId: null, ownerId: 'O-1', existingDeal: false });
t('memo: different dealId still creates', () => {
  assert.ok(!otherDeal.deduped);
  assert.strictEqual(zohoPosts, 2);
});
const failEnv = { SYSTEM_OWNER_ID: 'SYS-1' };
const savedZoho = stubs.zohoApiCall;
stubs.zohoApiCall = async () => { throw new Error('coql down'); };
const failClosed = await new Function(...Object.keys(stubs), `${fnSrc}; return createFollowUpTaskForDeal;`)(...Object.values(stubs))(
  { dealId: 'D-3', subjectLabel: 'Acme', env: failEnv, personId: null, ownerId: 'O-1', existingDeal: true });
stubs.zohoApiCall = savedZoho;
t('cross-turn: COQL error fails CLOSED (no create, followup_dedupe_check_failed)', () => {
  assert.strictEqual(failClosed.success, false);
  assert.strictEqual(failClosed.deduped, false);
  assert.match(failClosed.error, /followup_dedupe_check_failed/);
});

// ── 3. Council-review hardening (2026-07-21) ─────────────────────────────────
// 3a. Placeholder deal_name must be rejected on existing-deal attach too:
// the deal_name leg of the create_deal_and_quote gate is NOT conditioned on
// !existingDealId (source-shape lock on the exact gate condition).
t('gate: placeholder deal_name rejected even with existingDealId (source lock)', () => {
  assert.ok(
    SRC.includes('if ((!existingDealId && isPlaceholderName(account_name)) || (deal_name && isPlaceholderName(deal_name))) {'),
    'create_deal_and_quote placeholder gate must not condition the deal_name check on !existingDealId'
  );
});

// 3d. Cross-turn dedupe COQL check fails CLOSED on Zoho JSON error shapes.
async function buildAndRun(dealId) {
  const fn = new Function(...Object.keys(stubs), `${fnSrc}; return createFollowUpTaskForDeal;`)(...Object.values(stubs));
  return fn({ dealId, subjectLabel: 'Acme', env: { SYSTEM_OWNER_ID: 'SYS-1' }, personId: null, ownerId: 'O-1', existingDeal: true });
}
let posts3 = 0;
stubs.zohoApiCall = async (method, path) => {
  if (path === 'Tasks') { posts3++; return { data: [{ status: 'success', details: { id: 'TASK-9' } }] }; }
  return { code: 'INVALID_QUERY', details: {}, message: 'unable to process your request', status: 'error' };
};
const zohoErrShape = await buildAndRun('D-4');
t('cross-turn: Zoho JSON error shape (.code / status:"error") fails CLOSED, no create', () => {
  assert.strictEqual(zohoErrShape.success, false);
  assert.strictEqual(zohoErrShape.deduped, false);
  assert.match(zohoErrShape.error, /followup_dedupe_check_failed/);
  assert.strictEqual(posts3, 0, 'no Tasks POST after failed dedupe check');
});
stubs.zohoApiCall = async (method, path) => {
  if (path === 'Tasks') { posts3++; return { data: [{ status: 'success', details: { id: 'TASK-9' } }] }; }
  return { error: 'HTTP 400: Bad Request', status: 400 };
};
const httpErrShape = await buildAndRun('D-5');
t('cross-turn: non-JSON HTTP error (numeric status >= 400) fails CLOSED, no create', () => {
  assert.strictEqual(httpErrShape.success, false);
  assert.match(httpErrShape.error, /followup_dedupe_check_failed/);
  assert.strictEqual(posts3, 0, 'no Tasks POST after failed dedupe check');
});
stubs.zohoApiCall = async (method, path) => {
  if (path === 'Tasks') { posts3++; return { data: [{ status: 'success', details: { id: 'TASK-9' } }] }; }
  return { error: '', status: 204 }; // COQL no-rows
};
const noRows204 = await buildAndRun('D-6');
t('cross-turn: COQL no-rows ({error:"",status:204}) still falls through to CREATE', () => {
  assert.strictEqual(noRows204.success, true);
  assert.strictEqual(noRows204.taskId, 'TASK-9');
  assert.ok(!noRows204.deduped, '204 no-rows must not report deduped');
  assert.strictEqual(posts3, 1, 'exactly one Tasks POST');
});
stubs.zohoApiCall = savedZoho;

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
