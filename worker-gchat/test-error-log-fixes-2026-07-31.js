#!/usr/bin/env node
// 2026-07-31 — Regression coverage for the week's error-report fixes
// (corp error_reports #16/#18/#22/#24/#26/#28/#31/#37/#38/#39, corp
// "undefined" Account 2026-07-30, personal error_reports #7/#8).
//
// Covered here:
//  A. "SKU,qty SKU,qty" pair parsing — quantities must bind to the PRECEDING
//     SKU (Ohio Valley Gas shift-by-one).
//  B. classifyCrmIntent continuation turns keep create tools in the subset
//     ("I don't have a quote-creation tool" class) + injected-context strip.
//  C. isPlaceholderName / validateCrmWrite guards (Company Name -, undefined).
//  D. Quote_Stage defaulted on create (LLM path) + set in the deterministic
//     payload (source assertion).
//  E. Term-aware quote Subject helpers (3yr quote titled 1yr class).
//  F. MT sensor type mapping present in the prompt (MT12 = water leak).

const fs = require('fs'), path = require('path'), os = require('os');
const assert = require('node:assert/strict');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const rawSource = src;
const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
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
src += '\nmodule.exports = { parseMessage, parseExplicitDirectLicenseListBeforeClassifier, classifyCrmIntent, selectToolSubset, stripInjectedClassifierContext, isPlaceholderName, deriveQuoteTermLabel, subjectHasTermToken, validateCrmWrite, CRM_EMAIL_TOOLS };';
const tmp = path.join(os.tmpdir(), `stratus-gchat-error-log-fixes-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const {
  parseMessage, parseExplicitDirectLicenseListBeforeClassifier, classifyCrmIntent, selectToolSubset, stripInjectedClassifierContext,
  isPlaceholderName, deriveQuoteTermLabel, subjectHasTermToken, validateCrmWrite,
  CRM_EMAIL_TOOLS
} = require(tmp);

let passed = 0, failed = 0;
function t(name, fn) {
  try { const r = fn(); if (r && typeof r.then === 'function') throw new Error('use ta() for async'); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}
const toolNames = (intent) => selectToolSubset(intent, CRM_EMAIL_TOOLS).map(t2 => t2.name);

(async () => {

console.log('\n=== A. "SKU,qty" pair parsing (personal error_reports #7 — shift-by-one) ===\n');

// Chris's exact Ohio Valley Gas paste: 20 "SKU,qty" pairs on one line,
// double-space separated. Every quantity must bind to the SKU BEFORE the comma.
const ovgInput = 'LIC-C9300-24E-3Y,1  LIC-ENT-3YR,27  LIC-MS120-24-3YR,4  LIC-MS120-24P-3YR,1  LIC-MS120-48LP-3YR,6  LIC-MS120-8LP-3YR,2  LIC-MS125-48LP-3Y,5  LIC-MS130-CMPT-3Y,8  LIC-MS225-24P-3YR,3  LIC-MS425-16-3YR,1  LIC-MS450-12-3YR,2  LIC-MT-3Y,1  LIC-MX100-SEC-3YR,1  LIC-MX105-SEC-3Y,1  LIC-MX250-SEC-3YR,1  LIC-MX65-SEC-3YR,2  LIC-MX67W-SEC-3YR,5  LIC-MX75-SEC-3Y,4  LIC-MX85-SEC-3Y,1  LIC-MX95-SEC-3Y,1';
const ovgExpected = {
  'LIC-C9300-24E-3Y': 1, 'LIC-ENT-3YR': 27, 'LIC-MS120-24-3YR': 4, 'LIC-MS120-24P-3YR': 1,
  'LIC-MS120-48LP-3YR': 6, 'LIC-MS120-8LP-3YR': 2, 'LIC-MS125-48LP-3Y': 5, 'LIC-MS130-CMPT-3Y': 8,
  'LIC-MS225-24P-3YR': 3, 'LIC-MS425-16-3YR': 1, 'LIC-MS450-12-3YR': 2, 'LIC-MT-3Y': 1,
  'LIC-MX100-SEC-3YR': 1, 'LIC-MX105-SEC-3Y': 1, 'LIC-MX250-SEC-3YR': 1, 'LIC-MX65-SEC-3YR': 2,
  'LIC-MX67W-SEC-3YR': 5, 'LIC-MX75-SEC-3Y': 4, 'LIC-MX85-SEC-3Y': 1, 'LIC-MX95-SEC-3Y': 1
};

t('Ohio Valley Gas 20-pair paste parses with EXACT quantities (no shift)', () => {
  const r = parseMessage(ovgInput);
  assert.ok(r && Array.isArray(r.directLicenseList), 'must return a directLicenseList');
  assert.equal(r.directLicenseList.length, 20, `expected 20 items, got ${r.directLicenseList.length}`);
  for (const item of r.directLicenseList) {
    assert.equal(item.qty, ovgExpected[item.sku], `${item.sku}: qty ${item.qty} ≠ expected ${ovgExpected[item.sku]}`);
  }
});

t('legacy single-line SKU-only comma list still parses (qty 1 each)', () => {
  const r = parseMessage('LIC-MX68W-SEC-1YR, LIC-ENT-1YR, LIC-MS220-8P-1YR');
  assert.ok(r && Array.isArray(r.directLicenseList));
  assert.deepEqual(r.directLicenseList.map(i => [i.sku, i.qty]), [
    ['LIC-MX68W-SEC-1YR', 1], ['LIC-ENT-1YR', 1], ['LIC-MS220-8P-1YR', 1]
  ]);
});

t('legacy "2x LIC-… , LIC-…" qty-prefix format unchanged', () => {
  const r = parseMessage('2x LIC-ENT-1YR, LIC-MX68-SEC-1YR');
  assert.ok(r && Array.isArray(r.directLicenseList));
  assert.deepEqual(r.directLicenseList.map(i => [i.sku, i.qty]), [
    ['LIC-ENT-1YR', 2], ['LIC-MX68-SEC-1YR', 1]
  ]);
});

t('mixed/ambiguous "LIC-A, 5 LIC-B" keeps the qty-first binding (not treated as pairs)', () => {
  const r = parseMessage('LIC-ENT-1YR, 5 LIC-MX68-SEC-1YR');
  assert.ok(r && Array.isArray(r.directLicenseList));
  assert.deepEqual(r.directLicenseList.map(i => [i.sku, i.qty]), [
    ['LIC-ENT-1YR', 1], ['LIC-MX68-SEC-1YR', 5]
  ]);
});

t('multi-line input with MULTIPLE pairs on one line no longer drops that line', () => {
  const r = parseMessage('LIC-ENT-3YR,27  LIC-MS120-24-3YR,4\nLIC-MX65-SEC-3YR,2\nLIC-MT-3Y,1');
  assert.ok(r && Array.isArray(r.directLicenseList));
  const map = Object.fromEntries(r.directLicenseList.map(i => [i.sku, i.qty]));
  assert.deepEqual(map, {
    'LIC-ENT-3YR': 27, 'LIC-MS120-24-3YR': 4, 'LIC-MX65-SEC-3YR': 2, 'LIC-MT-3Y': 1
  });
});

t('multi-line CSV format (one pair per line) unchanged', () => {
  const r = parseMessage('LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MX67-SEC-3YR,2');
  assert.ok(r && Array.isArray(r.directLicenseList));
  assert.deepEqual(r.directLicenseList.map(i => [i.sku, i.qty]), [
    ['LIC-ENT-3YR', 26], ['LIC-MS120-8FP-3YR', 4], ['LIC-MX67-SEC-3YR', 2]
  ]);
});

t('embedded LIC substring ("PUBLIC-SECTOR,3") never mints a bogus SKU (adversarial P3)', () => {
  const r = parseMessage('PUBLIC-SECTOR,3 LIC-ENT-3YR,27');
  const skus = (r && r.directLicenseList || []).map(i => i.sku);
  assert.ok(!skus.includes('LIC-SECTOR'), `LIC-SECTOR minted from PUBLIC-SECTOR: ${JSON.stringify(skus)}`);
});

t('zero-qty pairs are skipped, not quoted as 0', () => {
  const r = parseMessage('LIC-ENT-3YR,0  LIC-MX67-SEC-3YR,2  LIC-MT-3Y,1');
  assert.ok(r && Array.isArray(r.directLicenseList));
  const map = Object.fromEntries(r.directLicenseList.map(i => [i.sku, i.qty]));
  assert.equal(map['LIC-ENT-3YR'], undefined, 'qty-0 line must be dropped');
  assert.equal(map['LIC-MX67-SEC-3YR'], 2);
  assert.equal(map['LIC-MT-3Y'], 1);
});

t('six-digit pair quantity fails closed instead of shifting onto the next SKU', () => {
  const input = 'LIC-A-3YR,100000  LIC-B-3YR,2  LIC-C-3YR,1';
  const r = parseMessage(input);
  assert.equal(r?.isClarification, true, `expected clarification, got ${JSON.stringify(r)}`);
  assert.equal(r?.directLicenseList, undefined, 'invalid input must not expose a shifted directLicenseList');

  const bypass = parseExplicitDirectLicenseListBeforeClassifier(input);
  assert.equal(bypass?.isClarification, true, 'classifier bypass must preserve the fail-closed result');
  assert.equal(bypass?.directLicenseList, undefined, 'bypass must not recreate shifted quantities');
});

console.log('\n=== B. Continuation turns keep create tools (corp error_reports #16/#31) ===\n');

const pageCtx = { hasActivePageContext: true, hasQuoteSession: false };

t('corp #31-shaped turn "Yes, use <rep>@cisco.com as the referring Cisco rep. 1 year" → crm_write with create tools', () => {
  const intent = classifyCrmIntent('Yes, use arep@cisco.com as the referring Cisco rep. 1 year', pageCtx);
  assert.equal(intent.class, 'crm_write', `classified ${intent.class}`);
  const names = toolNames(intent);
  assert.ok(names.includes('create_deal_and_quote'), 'subset must carry create_deal_and_quote');
  assert.ok(names.includes('create_quote_on_deal'), 'subset must carry create_quote_on_deal');
});

t('same turn WITH the real [Active Zoho page:] prefix the extension injects → still crm_write (adversarial P1)', () => {
  const msg = '[Active Zoho page: Quotes 2570562000399909180]\nYes, use arep@cisco.com as the referring Cisco rep. 1 year';
  const intent = classifyCrmIntent(msg, { hasActivePageContext: true, hasQuoteSession: false });
  assert.equal(intent.class, 'crm_write', `classified ${intent.class} — Active-page prefix must not defeat the ^-anchored continuation rule`);
});

t('reactivation approval "yes, uncheck the inactive flag and assign Jesse" → cisco_rep, NOT hijacked (adversarial P2)', () => {
  const intent = classifyCrmIntent('yes, uncheck the inactive flag and assign Jesse', pageCtx);
  assert.equal(intent.class, 'cisco_rep', `classified ${intent.class} — must reach the subset carrying assign_cisco_rep_to_deal`);
  assert.ok(toolNames(intent).includes('assign_cisco_rep_to_deal'));
});

t('"Use 2026-07-31 as the close date" (repeated in 4 of the week\'s transcripts) → crm_write', () => {
  const intent = classifyCrmIntent('Use 2026-07-31 as the close date', pageCtx);
  assert.equal(intent.class, 'crm_write');
});

t('bare "1 year" answer with quote session → crm_write', () => {
  const intent = classifyCrmIntent('1 year', { hasActivePageContext: false, hasQuoteSession: true });
  assert.equal(intent.class, 'crm_write');
});

t('bare rep-email answer (corp #28 transcript shape) → crm_write', () => {
  const intent = classifyCrmIntent('brep@cisco.com', pageCtx);
  assert.equal(intent.class, 'crm_write');
});

t('continuation guard does NOT hijack explicit admin confirmations ("yes, submit it to velocity hub")', () => {
  const intent = classifyCrmIntent('yes, submit it to velocity hub', pageCtx);
  assert.equal(intent.class, 'subscription');
});

t('continuation guard does NOT hijack email follow-ups ("yes, draft the reply to them")', () => {
  // Pre-existing rules classify this 'general' ("draft THE reply" misses the
  // email regex's "draft a reply" — unchanged here). The invariant this guard
  // must hold: an email-flavored confirmation is never claimed as crm_write.
  const intent = classifyCrmIntent('yes, draft the reply to them', pageCtx);
  assert.notEqual(intent.class, 'crm_write');
  assert.equal(classifyCrmIntent('yes, draft a reply to them', pageCtx).class, 'email');
});

t('bare "1 year" WITHOUT any session/page context stays general (no behavior change)', () => {
  const intent = classifyCrmIntent('1 year', {});
  assert.equal(intent.class, 'general');
});

t('strip removes [Active Zoho page:] lines and un-closed [Email body: tails (adversarial hardening)', () => {
  const s1 = stripInjectedClassifierContext('[Active Zoho page: Deals 123 — Acme]\nUse 2026-07-31 as the close date');
  assert.ok(!s1.includes('Active Zoho page'), 'Active-page line must be stripped');
  assert.ok(s1.includes('Use 2026-07-31'), 'user text must survive');
  const s2 = stripInjectedClassifierContext('create a quote [Email body: please esign the docusign contract');
  assert.ok(!/esign|docusign/.test(s2), 'un-closed Email body tail must not fail open into the classified text');
});

t('stripInjectedClassifierContext removes [Session:]/[Email context:]/[Pre-resolved products:] blocks', () => {
  const s = stripInjectedClassifierContext(
    '[Session: Most recently worked quote 123]\nUse 2026-07-31 as the close date [Email context: renewal contract esign docusign]\n[Pre-resolved products: LIC-ENT-3YR]\ntail');
  assert.ok(!s.includes('[Session:'), 'Session block must be stripped');
  assert.ok(!s.includes('esign'), 'Email context block must be stripped');
  assert.ok(!s.includes('Pre-resolved'), 'Pre-resolved tail must be stripped');
  assert.ok(s.includes('Use 2026-07-31 as the close date'), 'user text must survive');
});

t('admin vocabulary inside injected email context no longer hijacks the class', () => {
  const msg = 'create a quote for 3 MX67 [Email context: Subject "please esign the contract and convert to PO"]';
  const intent = classifyCrmIntent(msg, pageCtx);
  assert.equal(intent.class, 'crm_write', `classified ${intent.class} — email-context vocab leaked into classification`);
});

console.log('\n=== C. Placeholder/junk name guards (corp #18/#24/#28 + "undefined" Account) ===\n');

t('isPlaceholderName catches the corp "undefined" Account class', () => {
  for (const bad of ['undefined', 'Undefined', 'UNDEFINED', 'null', 'NaN', '[object Object]', '<undefined>']) {
    assert.ok(isPlaceholderName(bad), `"${bad}" must be flagged`);
  }
});

t('isPlaceholderName catches Amir\'s corp placeholder class (ported)', () => {
  for (const bad of ['Company Name -', 'company_name', 'Customer Name', 'TBD', 'N/A', 'unknown', '--', 'Test Company', '{account}', 'placeholder deal']) {
    assert.ok(isPlaceholderName(bad), `"${bad}" must be flagged`);
  }
});

t('isPlaceholderName passes real names (incl. non-Latin + name-adjacent)', () => {
  for (const good of ['Trophy Auto Group', 'Ohio Valley Gas', "O'Brien & Sons", 'First Service Solutions', 'None of the Above LLC', 'Nullify Security Inc', 'Client Names LLC', '株式会社日立']) {
    assert.ok(!isPlaceholderName(good), `"${good}" must NOT be flagged`);
  }
});

await ta('validateCrmWrite blocks a placeholder Deal_Name on create', async () => {
  const data = {
    Deal_Name: 'Company Name -', Stage: 'Qualification', Lead_Source: 'Stratus Referal',
    Owner: { id: 'x' }, Closing_Date: '2099-01-01', Account_Name: { id: 'y' }
  };
  const r = await validateCrmWrite('Deals', data, true, null);
  assert.equal(r.valid, false);
  assert.ok(/placeholder/i.test(r.error), 'error must call out the placeholder');
});

await ta('validateCrmWrite: Account created as literal "undefined" is stopped (any casing)', async () => {
  for (const bad of ['undefined', 'UNDEFINED', 'Null']) {
    const data = { Account_Name: bad };
    const r = await validateCrmWrite('Accounts', data, true, null);
    assert.equal(r.valid, false, `"${bad}" must not create an Account`);
  }
});

await ta('validateCrmWrite: placeholder Account_Name blocked, real one passes', async () => {
  const bad = await validateCrmWrite('Accounts', { Account_Name: 'Customer Name' }, true, null);
  assert.equal(bad.valid, false);
  const good = await validateCrmWrite('Accounts', { Account_Name: 'Acme Networks LLC' }, true, null);
  assert.equal(good.valid, true, good.error || '');
});

console.log('\n=== D. Quote_Stage set on every create (corp error_reports #22/#39) ===\n');

await ta('LLM-path Quote create defaults Quote_Stage to "Qualification"', async () => {
  const data = { Subject: 'Acme - Renewal', Deal_Name: { id: 'd' }, Valid_Till: '2099-01-01', __date_confirmed: true };
  const r = await validateCrmWrite('Quotes', data, true, null);
  assert.equal(r.valid, true, r.error || '');
  assert.equal(data.Quote_Stage, 'Qualification');
});

await ta('an explicit legitimate Quote_Stage is preserved (not overwritten)', async () => {
  const data = { Subject: 'Acme - Renewal', Deal_Name: { id: 'd' }, Valid_Till: '2099-01-01', Quote_Stage: 'Negotiation', __date_confirmed: true };
  const r = await validateCrmWrite('Quotes', data, true, null);
  assert.equal(r.valid, true, r.error || '');
  assert.equal(data.Quote_Stage, 'Negotiation');
});

await ta('Admin_Action create is NOT given a Quote_Stage default (forbidden combo guard)', async () => {
  const data = { Subject: 'Acme - Renewal', Deal_Name: { id: 'd' }, Valid_Till: '2099-01-01', Admin_Action: 'LIVE_CiscoQuote_Deal' };
  await validateCrmWrite('Quotes', data, true, null);
  assert.equal(data.Quote_Stage, undefined, 'defaulting Quote_Stage alongside Admin_Action recreates the forbidden combo');
});

t('deterministic create_deal_and_quote payload sets Quote_Stage (source assertion)', () => {
  const idx = rawSource.indexOf('const quoteData = {');
  assert.notEqual(idx, -1);
  const block = rawSource.slice(idx, idx + 1200);
  assert.ok(/Quote_Stage:\s*'Qualification'/.test(block), 'deterministic quoteData must set Quote_Stage');
});

t('Quotes default-field lists request Quote_Stage, never the nonexistent Stage', () => {
  assert.ok(!/Quotes: 'id,Subject,Quote_Number,Grand_Total,Deal_Name,Stage'/.test(rawSource),
    'a Quotes field list still asks Zoho for "Stage"');
});

console.log('\n=== E. Term-aware quote Subject (corp error_reports #26/#38) ===\n');

t('uniform 3-year license lines → "3-Year" label', () => {
  assert.equal(deriveQuoteTermLabel([
    { sku: 'LIC-ENT-3YR' }, { sku: 'LIC-MX85-SEC-3Y' }, { sku: 'MS130-24-HW' }
  ], null), '3-Year');
});

t('mixed terms → null (never stamp a wrong term)', () => {
  assert.equal(deriveQuoteTermLabel([{ sku: 'LIC-ENT-1YR' }, { sku: 'LIC-MX85-SEC-3Y' }], null), null);
});

t('no explicit-term SKUs + license_term arg → arg wins (Duo single-SKU class)', () => {
  assert.equal(deriveQuoteTermLabel([{ sku: 'DUO-EDU-ESS-F' }], '1'), '1-Year');
  assert.equal(deriveQuoteTermLabel([{ sku: 'DUO-EDU-ESS-F' }], '3'), '3-Year');
});

t('license_term arg outside real Cisco terms never stamps ("36" ≠ "36-Year")', () => {
  assert.equal(deriveQuoteTermLabel([{ sku: 'DUO-EDU-ESS-F' }], '36'), null);
  assert.equal(deriveQuoteTermLabel([{ sku: 'DUO-EDU-ESS-F' }], '2'), null);
  assert.equal(deriveQuoteTermLabel([{ sku: 'DUO-EDU-ESS-F' }], '10'), '10-Year');
});

t('hardware-only quote with no term arg → null', () => {
  assert.equal(deriveQuoteTermLabel([{ sku: 'MA-MNT-MV-48' }, { sku: 'MT12-HW' }], null), null);
});

t('subjectHasTermToken detects existing labels; skips unlabeled', () => {
  for (const labeled of ['Acme - 3YR Renewal', 'Acme 1-Year Option', 'Acme - 3 year', 'Acme 36 mo']) {
    assert.ok(subjectHasTermToken(labeled), `"${labeled}" should count as labeled`);
  }
  for (const bare of ['Acme - License Renewal', 'Trophy Auto Group - LIC-ENT', 'MX85 for Acme']) {
    assert.ok(!subjectHasTermToken(bare), `"${bare}" should NOT count as labeled`);
  }
});

t('deterministic path stamps the term into the Subject (source assertion)', () => {
  assert.ok(/deriveQuoteTermLabel\(resolvedProducts,\s*license_term\)/.test(rawSource),
    'quote build must derive the term label');
  assert.ok(/subjectHasTermToken\(quoteSubject\)/.test(rawSource),
    'quote build must skip already-labeled subjects');
});

console.log('\n=== F. MT sensor type mapping + ISR name lookup (corp #37, personal #8) ===\n');

t('prompt maps water/leak sensors to MT12 and flags MT14 as air quality', () => {
  assert.ok(/MT12 = WATER LEAK/.test(rawSource), 'MT12 water-leak mapping missing');
  assert.ok(/"Water sensor" \/ "leak sensor" \/ "moisture sensor" → MT12, NEVER MT14/.test(rawSource),
    'water→MT12 never-MT14 rule missing');
});

t('create_deal_and_quote accepts meraki_isr_name and resolves it from Meraki_ISRs', () => {
  assert.ok(/meraki_isr_name: \{ type: 'string'/.test(rawSource), 'tool schema must expose meraki_isr_name');
  assert.ok(/async function resolveMerakiIsrByName\(name, env\)/.test(rawSource),
    'shared ISR name resolver must remain the single lookup implementation');
  assert.ok(/await resolveMerakiIsrByName\(meraki_isr_name, env\)/.test(rawSource),
    'compound quote path must use the shared ISR name resolver');
  assert.ok(/const active = pool\.filter\(\(r\) => r\.Inactive !== true && r\.Inactive !== 'true'\)/.test(rawSource),
    'shared ISR resolver must prefer active candidates while preserving inactive-only review');
  assert.ok(/meraki_isr_ambiguous/.test(rawSource), 'ambiguous name matches must surface candidates');
});

t('active prompts accept ISR name resolution and ask only after name/address routes fail', () => {
  assert.ok(/meraki_isr_email OR meraki_isr_name is REQUIRED/.test(rawSource),
    'tool guidance must allow either a rep email or name');
  assert.ok(/pass the supplied name as \\`meraki_isr_name\\` for server-side resolution/.test(rawSource),
    'full prompt must direct a supplied name through server-side resolution');
  assert.ok(/inspect To\/CC\/BCC for a Cisco\/Meraki address/.test(rawSource),
    'optimized prompt must inspect message participants before asking');
  assert.doesNotMatch(rawSource, /Don't know the rep\? ASK/,
    'contradictory email-only ISR prompt must not remain active');
});

console.log(`\n${'='.repeat(50)}`);
console.log(`RESULT: ${passed} passed, ${failed} failed`);
fs.unlinkSync(tmp);
process.exit(failed > 0 ? 1 : 0);

})();
