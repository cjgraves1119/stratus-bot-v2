// One-shot plan card — extension-side wiring guards (2026-07-30).
// Source-level checks cover the React wiring; extracted pure helpers exercise
// the exact Gmail-name and order-URL transformations.
//
// Run: node chrome-extension/test-oneshot-card-2026-07-30.js

const fs = require('fs'), path = require('path'), assert = require('assert');
const SRC = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
const QUOTE = fs.readFileSync(path.join(__dirname, 'src/sidebar/components/QuoteResult.jsx'), 'utf8');
const CONTENT = fs.readFileSync(path.join(__dirname, 'src/content/index.js'), 'utf8');
let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; console.log(`  ✗ ${name}\n      ${e.message}`); }
}

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, opened = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    else if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

check('deterministic quote creation never auto-opens a one-shot plan', () => {
  const seg = SRC.slice(SRC.indexOf('async function runAndPushQuote'), SRC.indexOf('async function handleQuoteSuggestion'));
  assert.ok(!/startOneshotFromUrl|ONESHOT_PLAN|isOneshotAutoPlanEligible/.test(seg), 'quote generation must stop at the inert quote card');
});

check('chat email-quote replies never auto-open a one-shot plan', () => {
  const start = SRC.indexOf('const assistantMsg = {');
  const end = SRC.indexOf('} else if (response && response.error)', start);
  const seg = SRC.slice(start, end);
  assert.ok(!/startOneshotFromUrl|replyOrderUrls|ONESHOT_PLAN/.test(seg), 'chat reply must not create a one-shot card proactively');
});

check('only the explicit quote-card button authorizes the first one-shot plan', () => {
  assert.ok(QUOTE.includes('Create Zoho CRM quote from selected'), 'explicit consent button is missing');
  assert.ok(/onClick=\{\(\) => hasExplicitTermSelection && onSendToZoho\(result, selectedIndexes\)\}/.test(QUOTE), 'Zoho review must require a selected quote option and a separate button click');
  const starts = SRC.match(/startOneshotFromUrl\(/g) || [];
  assert.strictEqual(starts.length, 2, `expected one declaration + one explicit call, found ${starts.length}`);
  const seg = SRC.slice(SRC.indexOf('async function handleSendQuoteToZoho'), SRC.indexOf('async function replanOneshot'));
  assert.ok(/return startOneshotFromUrl\(orderUrl, \{[\s\S]*selectedQuoteOptionIndex: normalizedSelectedIndex >= 0 \? normalizedSelectedIndex : 0/.test(seg));
  assert.ok(/consentSource: 'quote-card-button'/.test(seg), 'explicit consent provenance must be stored on the card');
  assert.ok(/msg\.consentSource !== 'quote-card-button'/.test(SRC), 'legacy auto/intake cards must render inert');
  assert.ok(!/auto\s*:|lastAutoPlanUrlRef|isOneshotAutoPlanEligible|action: 'oneshot_email'/.test(SRC), 'legacy proactive-plan entry points must be removed');
});

check('explicit plan creation is single-flight and disables duplicate clicks', () => {
  const start = SRC.slice(SRC.indexOf('async function startOneshotFromUrl'), SRC.indexOf('async function replanOneshot'));
  assert.ok(/if \(oneshotPlanStartRef\.current\) return;[\s\S]*oneshotPlanStartRef\.current = true/.test(start), 'initial plan needs an imperative pre-await guard');
  assert.ok(/finally \{[\s\S]*oneshotPlanStartRef\.current = false/.test(start), 'initial plan guard must always clear');
  assert.ok(/busy=\{msg\.busy \|\| loading\}/.test(SRC), 'quote card must receive global plan busy state');
  assert.ok(/disabled=\{busy\}/.test(QUOTE), 'explicit Zoho handoff button must disable while planning');
});

check('Create Quote quick action is a read-only eCommerce intake and cannot enter one-shot directly', () => {
  assert.ok(/\{ label: 'Create Quote', action: 'email-ecomm-quote' \}/.test(SRC));
  const quick = SRC.slice(SRC.indexOf('{QUICK_ACTIONS.map'), SRC.indexOf('</button>', SRC.indexOf('{QUICK_ACTIONS.map')));
  assert.ok(/action\.action === 'email-ecomm-quote'[\s\S]*startEmailEcommQuote\(\)/.test(quick));
  assert.ok(!/handleSend\('Help me create a quote in Zoho CRM'\)|ONESHOT_PLAN|ONESHOT_EXECUTE/.test(quick));
});

check('term switch parses the exact selected URL and re-plans the SAME card', () => {
  const parse = Function(`return (${extractFunction(SRC, 'parseOrderUrlItems')});`)();
  assert.deepStrictEqual(parse('https://stratusinfosystems.com/order/?item=MS150-48MP-4X,LIC-MS150-48-5Y&qty=1,2'), [
    { sku: 'MS150-48MP-4X', qty: 1 },
    { sku: 'LIC-MS150-48-5Y', qty: 2 },
  ]);
  assert.ok(/<div style=\{S\.lab\}>Quote option<\/div>/.test(SRC), 'one-shot term selector missing');
  assert.ok(/value=\{selectedQuoteOptionIndex\}[\s\S]*onChange=\{\(e\) => onQuoteOptionChange\(Number\(e\.target\.value\)\)\}/.test(SRC), 'one-shot term selector must re-plan from the selected option');
  const change = SRC.slice(SRC.indexOf('async function changeOneshotQuoteOption'), SRC.indexOf('async function executeOneshotCard'));
  assert.ok(/parseOrderUrlItems\(option\.url\)/.test(change), 'selected order URL is not the SKU authority');
  assert.ok(/replanOneshot\(msg, \{[\s\S]*skus,[\s\S]*hardware_only: hardwareOnly,[\s\S]*\}, \{ \.\.\.messagePatch, selectedQuoteOptionIndex \}, \{ boundOptionSelection: true \}\)/.test(change), 'same card is not replanned in place with its reviewed account draft');
  assert.ok(/quoteOptionsSnapshotHash !== currentSnapshotHash/.test(change), 'stale option URLs must be rejected before they can trigger a new plan');
  assert.ok(!/appendMessage\(\{[\s\S]*kind: 'oneshot'/.test(change), 'term switch must not append a stale second card');
  assert.ok(/selectedUrls\.includes\(String\(option\?\.url \|\| ''\)\)/.test(QUOTE), 'quote-card selection must follow URL identity, not a stale index');
  assert.ok(/const \[selectedUrls, setSelectedUrls\] = useState\(\[\]\)/.test(QUOTE), 'Zoho conversion must begin with no implicit quote option');
  assert.ok(/checked=\{selectedIndexes\.includes\(option\.index\)\}[\s\S]*onChange=\{\(\) => toggleUrl\(option\.url\)\}/.test(QUOTE), 'quote options must be selected explicitly');
  assert.ok(/disabled=\{busy \|\| !hasExplicitTermSelection\}/.test(QUOTE), 'Zoho conversion must stay disabled until explicit term selection');
  assert.ok(/const url = urls\[idx\]\?\.url;[\s\S]*if \(url\) selectUrl\(url\)/.test(QUOTE), 'Copy must select the exact URL without starting Zoho review');
  assert.ok(/onClick=\{\(\) => selectUrl\(urlObj\.url\)\}/.test(QUOTE), 'Open must select the exact URL without starting Zoho review');
});

check('term replan replaces payload, plan, and review token while locking races', () => {
  const replan = SRC.slice(SRC.indexOf('async function replanOneshot'), SRC.indexOf('async function changeOneshotQuoteOption'));
  assert.ok(/buildOneshotReplanPayload\([\s\S]*\{ \.\.\.msg\.base, participants \},[\s\S]*next,[\s\S]*msg\.reviewToken/.test(replan), 'replan must safely merge the replacement payload');
  assert.ok(/delete base\.prior_review_token/.test(replan), 'prior token is request-only and must not become the next base');
  assert.ok(/reviewToken: res\.review_token/.test(replan), 'replan must replace the review token');
  assert.ok(/planRevision: \(m\.planRevision \|\| 0\) \+ 1/.test(replan), 'replan must remount the reviewed card');
  assert.ok(/busy: true/.test(replan) && /busy: false/.test(replan), 'card busy state must bracket replan');
  assert.ok(/oneshotInFlightRef\.current\.has\(msg\.id\)/.test(replan), 'imperative race guard missing');
  assert.ok(/busy: true, executeAttempted: true/.test(SRC), 'Execute must lock term switching before the request');
});

check('failed Execute retries the frozen payload without reopening review edits', () => {
  const execute = SRC.slice(SRC.indexOf('async function executeOneshotCard'), SRC.indexOf('// ── Gmail thread'));
  assert.ok(/msg\.executeAttempted === true\s*\? msg\.executePayload/.test(execute), 'retry must use the first attempt payload snapshot');
  assert.ok(/executePayload: payload/.test(execute), 'first attempt must persist its exact payload');
  assert.ok(!/msg\.executeAttempted \|\| oneshotInFlightRef/.test(execute), 'a failed attempt must remain safely retryable');
  assert.ok(/const immutableReviewLocked = busy \|\| msg\.executeAttempted === true/.test(SRC), 'review controls must freeze after the first attempt');
  assert.ok(/if \(msg\.executeAttempted === true\) \{ onExecute\(\); return; \}/.test(SRC), 'retry must bypass mutable local form collection');
  assert.ok(/Retry \/ resume Zoho creation/.test(SRC));
  assert.ok(/msg\.base\.license_term != null \? \{ license_term: String\(msg\.base\.license_term\) \}/.test(execute), 'reviewed license term must survive Execute/retry');
  assert.ok(/msg\.base\.renewal === true \? \{ renewal: true \}/.test(execute), 'reviewed renewal flag must survive Execute/retry');
  assert.ok(/msg\.base\.license_only === true \? \{ license_only: true \}/.test(execute), 'reviewed license-only flag must survive Execute/retry');
  assert.ok(/msg\.base\.hardware_only === true \? \{ hardware_only: true \}/.test(execute), 'reviewed hardware-only flag must survive Execute/retry');
  assert.ok(/msg\.base\.include_licenses === false \? \{ include_licenses: false \}/.test(execute), 'reviewed include-licenses flag must survive Execute/retry');
  assert.ok(/ha_recalculate_license_qty: true/.test(execute), 'reviewed HA recalculation must survive Execute/retry');
});

check('Gmail participant sanitizer removes email tokens before longest-name caching', () => {
  const sanitize = Function(`return (${extractFunction(CONTENT, 'sanitizeParticipantName')});`)();
  for (const dirty of [
    'Ron Jarman <ron.jarman@example.com>',
    'Ron Jarman ron.jarman@example.com',
    'Ron Jarman <mailto:ron.jarman@example.com>',
  ]) assert.strictEqual(sanitize(dirty), 'Ron Jarman', dirty);
  assert.strictEqual(sanitize('ron.jarman@example.com'), '');
  assert.ok(/const name = sanitizeParticipantName\(el\.getAttribute\('name'\) \|\| el\.textContent \|\| ''\)/.test(CONTENT));
  assert.ok(/threadContacts\.push\(\{ \.\.\.contact, name: sanitizeParticipantName\(contact\.name\) \}\)/.test(CONTENT));
});

check('typed hardware-only requests never expose forced license URLs', () => {
  // 2026-08-19: the phrase test moved into isWholeCartHardwareOnlyText so a MIXED
  // request ("… 2 MX65 licenses, and 5 MR44 hardware only") keeps its licences.
  // Both pieces are needed for the extracted function to run.
  const hwOnlyDeps = SRC.slice(
    SRC.indexOf('const TYPED_HW_ONLY_PHRASE'),
    SRC.indexOf('function typedHardwareOnlyResult'),
  );
  const transform = Function(`${hwOnlyDeps}\n${extractFunction(SRC, 'typedHardwareOnlyResult')}; return typedHardwareOnlyResult;`)();
  const provisional = transform({
    parsed: [
      { baseSku: 'MT12', qty: 1 },
      { baseSku: 'MT10', qty: 1 },
      { baseSku: 'C9300-24P', qty: 1 },
      { baseSku: 'LIC-MT-1Y', qty: 1 },
    ],
    suggestions: [{ input: 'C9300-24P', suggest: ['C9300-24P-M'] }],
    urls: [{ label: '1-Year', url: 'https://stratusinfosystems.com/order/?item=MT12,LIC-MT-1Y&qty=1,1' }],
  }, 'quote 1 C9300-24P, 1 MT12, 1 MT10 hardware only');
  assert.deepStrictEqual(provisional.urls, [{
    label: 'Hardware Only',
    url: 'https://stratusinfosystems.com/order/?item=MT12,MT10&qty=1,1',
    hardwareOnly: true,
  }]);
  const resolved = transform({
    parsed: [{ baseSku: 'MT12', qty: 1 }, { baseSku: 'MT10', qty: 1 }, { baseSku: 'C9300-24P-M', qty: 1 }],
    suggestions: [],
    urls: [],
  }, 'quote 1 C9300-24P-M, 1 MT12, 1 MT10 hardware only');
  assert.strictEqual(resolved.urls[0].url, 'https://stratusinfosystems.com/order/?item=MT12,MT10,C9300-24P-M&qty=1,1,1');
  assert.ok(/function typedHardwareOnlyResult\(result, text\)/.test(SRC));
  assert.ok(/const unresolved = new Set\(\(Array\.isArray\(result\.suggestions\)/.test(SRC));
  assert.ok(/!unresolved\.has\(line\.sku\)/.test(SRC), 'unresolved suggestion inputs must never enter an order URL');
  assert.ok(/!line\.sku\.startsWith\('LIC-'\)/.test(SRC));
  assert.ok(/urls: \[\{ label: 'Hardware Only', url, hardwareOnly: true \}\]/.test(SRC));
  assert.ok(/let candidate = typedHardwareOnlyResult\(result, text\)/.test(SRC), 'initial typed quote must apply hardware-only filtering');
  assert.ok(/let candidate = typedHardwareOnlyResult\(response\.result, prepared\.text\)/.test(SRC), 'suggestion and manual re-quotes must preserve hardware-only filtering');
});

// 2026-08-19, policy changed at Chris's request: the contact the panel is ALREADY
// showing rides along too, not only an explicit dropdown pick. The card used to
// display "Contact: Trevor Goode" while the plan was told nothing and blocked on
// ambiguous_contact. The safety property this test really guards is unchanged and
// still asserted below: BOTH paths are gated on the captured participant list, so
// a contact from another conversation can never leak into the plan.
check('only an eligible participant is forwarded as contact_email', () => {
  assert.ok(/const forwardedContactEmail = participants\.some\(\(c\) => c\.email === explicitlySelectedEmail\)/.test(SRC),
    'an explicit pick must still be preferred');
  assert.ok(/participants\.some\(\(c\) => c\.email === shownContextEmail\) \? shownContextEmail : undefined/.test(SRC),
    'the shown contact is the fallback, and only when it is a captured participant');
  assert.ok(/contact_email: forwardedContactEmail,/.test(SRC));
  assert.ok(/capturedParticipants: sourceMessage\?\.emailQuoteContext\?\.participants/.test(SRC));
  const planPayload = SRC.slice(SRC.indexOf('const base = {', SRC.indexOf('async function startOneshotFromUrl')), SRC.indexOf("source: 'ext-oneshot'", SRC.indexOf('async function startOneshotFromUrl')));
  assert.ok(!/customerEmail/.test(planPayload), 'the raw auto customerEmail must still not ride into the payload directly');
});

check('a manually pinned Deal is forwarded as the reviewed attach target', () => {
  const plan = SRC.slice(SRC.indexOf('async function startOneshotFromUrl'), SRC.indexOf('async function replanOneshot'));
  assert.ok(/pin\.module === 'Deals'[\s\S]*base\.existing_deal_id = pin\.recordId/.test(plan));
  assert.ok(/if \(pin\.accountId\) base\.account_id = pin\.accountId/.test(plan));
  assert.ok(/sourceMessage\?\.quoteHaRequested === true \? \{ ha_requested: true \} : null/.test(SRC),
    'explicit general-chat HA intent must reach the signed Plan');
});

check('Execute remains the sole write call and rejects email-shaped contact names locally', () => {
  const executeBoundary = extractFunction(SRC, 'executeOneshotCard');
  const executeCalls = executeBoundary.match(/sendToBackground\(MSG\.ONESHOT_EXECUTE/g) || [];
  assert.ok(executeCalls.length >= 1, 'Execute boundary must contain the CRM write call');
  assert.ok(!/sendToBackground\(MSG\.ONESHOT_EXECUTE/.test(SRC.replace(executeBoundary, '')), 'ONESHOT_EXECUTE must not escape executeOneshotCard');
  assert.ok(/remove the email address from the contact name/.test(SRC));
  assert.ok(/disabled=\{hard\.length > 0 \|\| busy \|\| productDirty\}/.test(SRC), 'Execute must also block unvalidated product edits');
  assert.ok(/deal = \{ new: true, confirmed: true \}/.test(SRC), 'new-deal choice must carry explicit confirmed:true');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
