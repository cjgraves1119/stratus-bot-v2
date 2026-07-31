// One-shot plan card — extension-side wiring guards (2026-07-30).
// Source-level: the React component needs a browser/bundler to execute, so
// these assert the load-bearing wiring that reviews required:
//   1. AUTO plan-open exists on BOTH quote paths (deterministic card + chat
//      email-quote reply) — Zoho tab optional, no second click.
//   2. Only an EXPLICIT user pick is forwarded as contact_email — the auto
//      customerEmail default (American Implement bug) must never ride along.
//   3. Execute is the only write boundary: exactly one ONESHOT_EXECUTE call
//      site, inside executeOneshotCard, driven by the card button.
//
// Run: node chrome-extension/test-oneshot-card-2026-07-30.js

const fs = require('fs'), path = require('path'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

check('auto plan-open after the deterministic quote card (runAndPushQuote)', () => {
  const seg = SRC.slice(SRC.indexOf('async function runAndPushQuote'), SRC.indexOf('async function handleQuoteSuggestion'));
  assert.ok(/startOneshotFromUrl\(orderUrl, \{ auto: true \}\)/.test(seg), 'runAndPushQuote must auto-open the plan card');
  assert.ok(/if \(emailContext\)/.test(seg), 'auto-open must be gated on an active email thread');
});

check('auto plan-open after a chat email-quote reply with engine order URLs', () => {
  assert.ok(/shouldReadFullEmailForQuote && !isDraftAsk && gatedEmailContext && response\.reply/.test(SRC));
  assert.ok(/stratusinfosystems\\\.com\\\/order\\\//.test(SRC), 'reply order-URL extraction regex missing');
  assert.ok(/replyOrderUrls\[replyOrderUrls\.length - 1\]/.test(SRC), 'most recent URL must win');
});

check('auto opens dedupe on URL; explicit button always opens', () => {
  assert.ok(/lastAutoPlanUrlRef\.current === orderUrl\) return;/.test(SRC));
  assert.ok(/startOneshotFromUrl\(orderUrl, \{ auto: false \}\)/.test(SRC), 'button path must stay explicit');
});

check('only an explicit user pick is forwarded as contact_email', () => {
  assert.ok(/contact_email: \(selectedContextEmail && selectedContextEmail !== '__none__'\) \? selectedContextEmail : undefined/.test(SRC));
  const planPayload = SRC.slice(SRC.indexOf('const base = {'), SRC.indexOf("source: 'ext-oneshot'"));
  assert.ok(!/customerEmail/.test(planPayload), 'auto customerEmail default must NOT ride into the plan payload');
});

check('full participant list rides to the server', () => {
  assert.ok(/participants: \(emailContext\?\.threadContacts \|\| \[\]\)\.map/.test(SRC));
});

check('Execute is the only write boundary (one ONESHOT_EXECUTE call site, inside executeOneshotCard)', () => {
  const hits = SRC.match(/MSG\.ONESHOT_EXECUTE/g) || [];
  assert.strictEqual(hits.length, 1, `expected exactly 1 ONESHOT_EXECUTE call site, found ${hits.length}`);
  const seg = SRC.slice(SRC.indexOf('async function executeOneshotCard'), SRC.indexOf('function handleSend('));
  assert.ok(/MSG\.ONESHOT_EXECUTE/.test(seg), 'the call site must live in executeOneshotCard');
});

check('plan card gates Execute on hard blockers and collects explicit decisions', () => {
  assert.ok(/disabled=\{hard\.length > 0 \|\| busy\}/.test(SRC));
  assert.ok(/deal = \{ new: true, confirmed: true \}/.test(SRC), 'new-deal choice must carry explicit confirmed:true');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
