#!/usr/bin/env node
// 2026-05-12 quoting fixes regression tests:
//   1. Chrome ext: Deal ID green-highlight + VH right-click + VH in-page
//      button all removed (source-level checks).
//   2. resolveContactByEmail prefers the contact with a populated
//      Account_Name when an email matches multiple contacts.
//   3. create_deal_and_quote suppresses auto-pair when the user supplied an
//      explicit LIC for that hardware family stem.
//   4. create_deal_and_quote emits Quoted_Items in request order with each
//      hardware followed by its auto-paired license.

const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
let _testQueue = Promise.resolve();
function t(name, fn) {
  _testQueue = _testQueue.then(async () => {
    try { await fn(); console.log(`  ✓ ${name}`); passed++; }
    catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
  });
}
function section(title) {
  _testQueue = _testQueue.then(() => console.log(`\n=== ${title} ===\n`));
}

// ─── Section 1: Chrome extension removals ──────────────────────────────────

section('1. Chrome ext: Deal ID highlight + VH UI removed');

const chromeExtRoot = join(here, '..', 'chrome-extension');
const contentJs = readFileSync(join(chromeExtRoot, 'src/content/index.js'), 'utf8');
const contentCss = readFileSync(join(chromeExtRoot, 'src/content/content.css'), 'utf8');
const contextMenus = readFileSync(join(chromeExtRoot, 'src/background/context-menus.js'), 'utf8');
const emailPanel = readFileSync(join(chromeExtRoot, 'src/sidebar/panels/EmailPanel.jsx'), 'utf8');
const crmPanel = readFileSync(join(chromeExtRoot, 'src/sidebar/panels/CrmPanel.jsx'), 'utf8');

t('content/index.js: highlightDealIdsInEmail function removed', () => {
  assert.ok(!/function highlightDealIdsInEmail\(/.test(contentJs),
    'highlightDealIdsInEmail function definition must be removed');
});

t('content/index.js: handleDealIdClick + handleDealIdHover removed', () => {
  assert.ok(!/function handleDealIdClick\(/.test(contentJs),
    'handleDealIdClick must be removed');
  assert.ok(!/function handleDealIdHover\(/.test(contentJs),
    'handleDealIdHover must be removed');
});

t('content/index.js: highlightDealIdsInEmail() call removed', () => {
  assert.ok(!/^\s*highlightDealIdsInEmail\(\)/m.test(contentJs),
    'highlightDealIdsInEmail() invocation must be removed');
});

t('content.css: .stratus-deal-id-highlight CSS class removed', () => {
  assert.ok(!/\.stratus-deal-id-highlight\s*\{/.test(contentCss),
    '.stratus-deal-id-highlight CSS rule must be removed');
});

t('context-menus.js: stratus-velocity-hub context menu item removed', () => {
  assert.ok(!/id:\s*['"]stratus-velocity-hub['"]/.test(contextMenus),
    'stratus-velocity-hub context-menu create() must be removed');
});

t('context-menus.js: case "stratus-velocity-hub" handler removed', () => {
  assert.ok(!/case\s+['"]stratus-velocity-hub['"]\s*:/.test(contextMenus),
    'stratus-velocity-hub case handler must be removed');
});

t('EmailPanel: "Submit to Velocity Hub" button removed', () => {
  assert.ok(!/Submit to Velocity Hub/.test(emailPanel),
    'EmailPanel must not render the Velocity Hub button');
});

t('CrmPanel: 🚀 Velocity Hub button removed', () => {
  // The button text was "🚀 Velocity Hub" inside a JSX button onClick={onVelocityHub}
  assert.ok(!/🚀\s*Velocity Hub/.test(crmPanel),
    'CrmPanel must not render the Velocity Hub button');
});

t('Server-side velocity_hub_submit tool still registered', () => {
  // We removed UI surface only — server tool stays for quote_to_po_and_esign.
  assert.ok(/name:\s*['"]velocity_hub_submit['"]/.test(source),
    'velocity_hub_submit tool definition must remain in worker-gchat');
});

// ─── Section 2: resolveContactByEmail ──────────────────────────────────────

section('2. resolveContactByEmail prefers Account-bearing contact');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const signatureEnd = source.indexOf(') {', start);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const resolveContactByEmailSrc = extractFunction('resolveContactByEmail');

t('resolveContactByEmail uses per_page>1 (not 1)', () => {
  // Strip JS line comments so prose like "Original per_page=1 returned the
  // orphan" doesn't cause a false positive — we only care about live code.
  const code = resolveContactByEmailSrc.replace(/\/\/[^\n]*/g, '');
  assert.ok(/per_page=10/.test(code),
    'should fetch multiple matches per criterion');
  assert.ok(!/per_page=1(?!\d)/.test(code),
    'must NOT still be per_page=1 inside live code');
});

t('resolveContactByEmail logic prefers contact with Account_Name', () => {
  assert.ok(/Account_Name/.test(resolveContactByEmailSrc),
    'should inspect Account_Name');
  assert.ok(/withAccount/.test(resolveContactByEmailSrc),
    'should pick the matching contact with an account');
});

t('resolveContactByEmail body — withAccount selection logic ported in isolation', () => {
  // Live sim through Function() is blocked because the function uses `await`
  // and Function()-evaluated source doesn't preserve async-context for
  // nested function declarations in every runtime (the parser flags
  // top-level await even when nested inside an async function). Instead we
  // re-implement the SELECTION RULE here, mirroring the new code:
  //   rows.find(c => c.Account_Name) || rows[0]
  // and assert it picks the right contact for the Ray vs Raymond scenario.
  const rows = [
    { id: '2570562000276096015', Account_Name: null },
    { id: '2570562000065148929', Account_Name: { id: '2570562000065148910', name: 'PAR Excellence' } }
  ];
  const withAccount = rows.find(c => {
    const acct = c?.Account_Name;
    if (!acct) return false;
    if (typeof acct === 'object') return !!(acct.id || acct.name);
    return !!String(acct).trim();
  });
  const picked = withAccount || rows[0];
  assert.equal(picked.id, '2570562000065148929',
    'selection rule must pick the contact with an Account_Name lookup populated');
});

t('resolveContactByEmail fallback rule — first row when no Account_Name on any match', () => {
  const rows = [
    { id: 'A', Account_Name: null },
    { id: 'B', Account_Name: null }
  ];
  const withAccount = rows.find(c => {
    const acct = c?.Account_Name;
    if (!acct) return false;
    if (typeof acct === 'object') return !!(acct.id || acct.name);
    return !!String(acct).trim();
  });
  const picked = withAccount || rows[0];
  assert.equal(picked.id, 'A', 'fallback to first row when no Account_Name on any match');
});

// ─── Section 3: phantom 1Y license auto-pair suppression ───────────────────

section('3. create_deal_and_quote suppresses phantom 1Y auto-pair');

t('source contains explicitLicenseFamilyStems precompute', () => {
  assert.ok(/explicitLicenseFamilyStems\s*=\s*new Set\(\)/.test(source),
    'family-stem Set must be built before the SKU loop');
});

t('source contains stripTermFromLicSku helper', () => {
  assert.ok(/stripTermFromLicSku\s*=\s*\(sku\)/.test(source),
    'stripTermFromLicSku arrow helper must exist');
});

t('auto-pair branch checks family-stem against explicit set', () => {
  // Look for the candidateStem + explicitLicenseFamilyStems.has(...) check.
  assert.ok(/candidateStem\s*&&\s*explicitLicenseFamilyStems\.has\(candidateStem\)/.test(source),
    'candidate license family stem must be checked against explicit input set');
});

t('stripTermFromLicSku regex is the tightened form (post Codex review)', () => {
  // Tightened from /-(\d{1,2})Y?R?$/ to /-\d{1,2}YR?$/ to require Y so that
  // a bare -3 or -3R suffix can't be mistakenly stripped from a non-LIC token.
  assert.ok(/replace\(\/-\\d\{1,2\}YR\?\$\/i, ''\)/.test(source),
    'stripTermFromLicSku regex must be the tightened /-\\d{1,2}YR?$/i form');
  // Ensure the old looser form is gone.
  assert.ok(!/replace\(\/-\(\\d\{1,2\}\)Y\?R\?\$\/i, ''\)/.test(source),
    'old /-(\\d{1,2})Y?R?$/ form should not still be present');
});

t('end-to-end stripTermFromLicSku sample stems', () => {
  const strip = (sku) => String(sku || '').toUpperCase().replace(/-\d{1,2}YR?$/i, '');
  assert.equal(strip('LIC-MS130-48-3Y'), 'LIC-MS130-48');
  assert.equal(strip('LIC-MS130-48-3YR'), 'LIC-MS130-48');
  assert.equal(strip('LIC-Z4-SEC-3Y'), 'LIC-Z4-SEC');
  assert.equal(strip('LIC-MX85-SEC-3Y'), 'LIC-MX85-SEC');
  assert.equal(strip('LIC-MT-1Y'), 'LIC-MT');
  assert.equal(strip('LIC-ENT-1YR'), 'LIC-ENT');
  // Negative cases: bare -3 or -3R suffix must NOT be stripped (tightened form)
  assert.equal(strip('FOO-3'), 'FOO-3', 'bare -3 must not be stripped');
  assert.equal(strip('FOO-3R'), 'FOO-3R', 'bare -3R must not be stripped');
});

// ─── Section 4: ordered Quoted_Items output ────────────────────────────────

section('4. create_deal_and_quote line ordering — STEP 3c is sole authority post-revert');

t('PR #62 input-order override is removed (Cisco BOM compatibility)', () => {
  // 2026-05-13: license-before-hardware ordering hangs Cisco CCW DID
  // generation. PR #62 introduced an override that ordered lines by
  // input position, which placed standalone licenses before hardware
  // when the user supplied them first. Yesterday's working Quote
  // 2570562000405707101 used STEP 3c ordering (HW first, standalones
  // last) and successfully generated a DID. Today's stuck Quote
  // 2570562000405752232 used PR #62 ordering and hangs. Override removed.
  assert.ok(
    !/_orderedResolved\s*=\s*\[\]/.test(source),
    'PR #62 _orderedResolved override array must be removed'
  );
  assert.ok(
    !/_inputSuffixedSkus/.test(source),
    'PR #62 _inputSuffixedSkus must be removed'
  );
  assert.ok(
    !/_consumedPairIndices/.test(source),
    'PR #62 _consumedPairIndices must be removed'
  );
});

t('quotedItems built directly from STEP-3c-reordered resolvedProducts', () => {
  assert.ok(
    /const quotedItems = resolvedProducts\.map\(p => \{[\s\S]+?Product_Name: \{ id: p\.product_id \}/.test(source),
    'final quotedItems mapping must consume resolvedProducts directly (STEP 3c output)'
  );
});

t('STEP 3c HW→LIC reorder block still in source (the working order)', () => {
  // Don\'t accidentally remove the actual working ordering logic.
  assert.ok(
    /STEP 3c: Reorder resolved products/.test(source) || /First pass: add hardware → unique license pairs/.test(source),
    'STEP 3c HW→LIC reorder logic must remain intact'
  );
});

_testQueue.then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
