// Gmail Create Quote intake guards (updated 2026-08-17).
// This stage is a read-only eCommerce quote. Zoho planning is authorized only
// by the separate button on the finished quote card.

const fs = require('fs'), path = require('path'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
const QUOTE = fs.readFileSync(path.join(__dirname, 'src/sidebar/components/QuoteResult.jsx'), 'utf8');
const BG = fs.readFileSync(path.join(__dirname, 'src/background/index.js'), 'utf8');
const API = fs.readFileSync(path.join(__dirname, 'src/background/api-client.js'), 'utf8');
const CONST = fs.readFileSync(path.join(__dirname, 'src/lib/constants.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}
function segment(startMarker, endMarker) {
  const s = SRC.indexOf(startMarker);
  assert.ok(s > -1, `segment start not found: ${startMarker}`);
  const e = SRC.indexOf(endMarker, s);
  assert.ok(e > s, `segment end not found: ${endMarker}`);
  return SRC.slice(s, e);
}

check('Create Quote uses dedicated Gmail eCommerce intake, never generic chat', () => {
  assert.ok(/label: 'Create Quote', action: 'email-ecomm-quote'/.test(SRC));
  assert.ok(/action\.action === 'email-ecomm-quote'[\s\S]*startEmailEcommQuote\(\)/.test(SRC));
  assert.ok(!/label: 'Create Quote', text:/.test(SRC));
  const intake = segment('async function startEmailEcommQuote', 'function resolveIntakeLine');
  assert.ok(/sendToBackground\(MSG\.ONESHOT_INTAKE/.test(intake));
  assert.ok(!/MSG\.CHAT_HANDOFF|MSG\.ONESHOT_PLAN|MSG\.ONESHOT_EXECUTE/.test(intake));
});

check('intake reads the locked subject/thread once and carries no CRM consent', () => {
  const intake = segment('async function startEmailEcommQuote', 'function resolveIntakeLine');
  assert.ok(/MSG\.GET_FULL_EMAIL_CONTEXT/.test(intake));
  assert.ok(/validateGmailQuoteContext\(fresh/.test(intake));
  assert.ok(/subject: quoteContext\.subject/.test(intake));
  assert.ok(/body_text: quoteContext\.fullThreadBody\.slice/.test(intake));
  assert.ok(!/quoteContext\.fullThreadBody \|\| quoteContext\.body/.test(intake));
  assert.ok(/source: 'ext-email-ecomm-intake'/.test(intake));
  assert.ok(!/consentSource|idempotencyKey|reviewToken/.test(intake));
});

check('intake card exposes normalized SKU quantity resolution and eCommerce build', () => {
  const card = segment('function EmailQuoteIntakeCard', 'function OneshotPlanCard');
  assert.ok(/eCommerce quote from this Gmail thread/.test(card));
  assert.ok(/pricing is best effort and never blocks the SKU output/.test(card));
  assert.ok(/Build eCommerce quote options/.test(card));
  assert.ok(/l\.status === 'needs_sku'/.test(card));
  assert.ok(/Use \{suggestion\}/.test(card));
  assert.ok(/Nothing is written to Zoho at this step/.test(card));
  assert.ok(!/onExecute|ONESHOT_EXECUTE/.test(card));
});

check('chip resolution is local matrix lookup and never reparses the email', () => {
  const chip = segment('function resolveIntakeLine', 'function handleIntakeUpdate');
  assert.ok(/next\.options\.sku_matrix/.test(chip));
  assert.ok(!/ONESHOT_INTAKE|parseMessage|parseOrderUrlItems/.test(chip));
});

check('eCommerce build calls quote only and retains SKU output on pricing failure', () => {
  const build = segment('async function buildEcommQuoteFromIntake', '// Post-plan');
  assert.ok(/runQuote\(skuText, personIdRef\.current\)/.test(build));
  assert.ok(/label: 'Hardware Only'/.test(build));
  assert.ok(/hardwareOnly: true/.test(build));
  assert.ok(/source: 'email-intake-sku-only'/.test(build));
  assert.ok(/Pricing\/link generation was unavailable/.test(build));
  assert.ok(!/MSG\.ONESHOT_PLAN|MSG\.ONESHOT_EXECUTE|MSG\.CHAT_HANDOFF/.test(build));
});

check('only the separate finished-card button starts Zoho deterministic review', () => {
  assert.ok(/Create Zoho CRM quote from selected/.test(QUOTE));
  assert.ok(/onClick=\{\(\) => hasExplicitTermSelection && onSendToZoho\(result, validSelectedIndexes\)\}/.test(QUOTE));
  assert.ok(/Begin a separate deterministic Zoho review; nothing is written until Execute/.test(QUOTE));
  const plan = segment('async function startOneshotFromUrl', 'async function replanOneshot');
  assert.ok(/sendToBackground\(MSG\.ONESHOT_PLAN/.test(plan));
  assert.ok(/consentSource: 'quote-card-button'/.test(plan));
  assert.ok(!/MSG\.ONESHOT_EXECUTE/.test(plan));
});

check('Execute remains the sole CRM write boundary', () => {
  const execute = segment('async function executeOneshotCard', '\n  // ── Gmail thread');
  const outsideExecute = SRC.slice(0, SRC.indexOf('async function executeOneshotCard'))
    + SRC.slice(SRC.indexOf('\n  // ── Gmail thread', SRC.indexOf('async function executeOneshotCard')));
  assert.ok(/sendToBackground\(MSG\.ONESHOT_EXECUTE/.test(execute));
  assert.ok(!/sendToBackground\(MSG\.ONESHOT_EXECUTE/.test(outsideExecute));
  assert.ok(/This older one-shot draft is inactive/.test(SRC));
  assert.ok(/msg\.consentSource !== 'quote-card-button'/.test(SRC));
});

check('background intake route remains parse-only wiring', () => {
  assert.ok(/ONESHOT_INTAKE: 'ONESHOT_INTAKE'/.test(CONST));
  assert.ok(/\[MSG\.ONESHOT_INTAKE\]: async \(payload\) => \{\s*return api\.oneshotIntake\(payload\);/.test(BG));
  assert.ok(/apiCall\('\/api\/oneshot-intake', payload \|\| \{\}, \{ timeout: 30000 \}\)/.test(API));
});

check('typed chat remains available independently of the visible Create Quote action', () => {
  assert.ok(/sendToBackground\(MSG\.CHAT_HANDOFF, \{/.test(SRC));
  assert.ok(/handleSendMessage\(overrideText\)/.test(SRC));
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
