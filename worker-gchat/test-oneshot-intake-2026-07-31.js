// One-shot email intake + D1 execute mutex (2026-07-31).
//
// Behavioural: the REAL buildOneshotIntake / claimOneshotExecution /
// settleOneshotClaim / executeOneshot run with stubbed I/O (fake D1, fake KV,
// injected extractor). Source-level: route registration and ordering
// invariants that need a live worker to exercise.
//
// Run: node worker-gchat/test-oneshot-intake-2026-07-31.js

const fs = require('fs'), path = require('path'), assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { fail++; console.log(`  ✗ ${name}\n      ${err}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }
async function checkAsync(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

// Brace-walking extractor (same pattern as test-oneshot-2026-07-30).
function grab(name) {
  let start = SRC.indexOf(`async function ${name}(`);
  if (start === -1) start = SRC.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in source`);
  let p = SRC.indexOf('(', start), pDepth = 0, bodyStart = -1;
  for (let j = p; j < SRC.length; j++) {
    if (SRC[j] === '(') pDepth++;
    else if (SRC[j] === ')') { pDepth--; if (pDepth === 0) { bodyStart = SRC.indexOf('{', j); break; } }
  }
  assert.ok(bodyStart > -1, `could not find body of ${name}`);
  let depth = 0;
  for (let j = bodyStart; j < SRC.length; j++) {
    if (SRC[j] === '{') depth++;
    else if (SRC[j] === '}') { depth--; if (depth === 0) return SRC.slice(start, j + 1); }
  }
  throw new Error(`could not extract ${name}`);
}
function grabConstLine(name) {
  const line = SRC.split('\n').find((l) => l.trim().startsWith(`const ${name} =`));
  assert.ok(line, `${name} not found`);
  return line;
}
// Strip // line comments and /* */ blocks so "no runtime CREATE TABLE"
// assertions test CODE, not the comment that documents the rule.
function stripComments(src) {
  return String(src).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}
function grabConstBlock(name, endMarker) {
  const start = SRC.indexOf(`const ${name} =`);
  assert.ok(start > -1, `${name} not found`);
  const end = SRC.indexOf(endMarker, start);
  assert.ok(end > start, `${name} end not found`);
  return SRC.slice(start, end + endMarker.length);
}

// ── Fake D1 with real INSERT-conflict / conditional-UPDATE semantics ─────────
function fakeD1() {
  const rows = new Map();
  const state = { fail: false, noTable: false };
  const exec = (sql, args) => ({
    async run() {
      if (state.fail) throw new Error('d1_down');
      if (state.noTable) throw new Error('D1_ERROR: no such table: oneshot_claims');
      if (/CREATE TABLE/i.test(sql)) throw new Error('runtime CREATE TABLE is forbidden — migration is required');
      if (/INSERT INTO oneshot_claims/i.test(sql)) {
        const [key, caller, at] = args;
        if (rows.has(key)) return { meta: { changes: 0 } };
        rows.set(key, { status: 'executing', caller, claimed_at: at, finished_at: null });
        return { meta: { changes: 1 } };
      }
      if (/SET status = 'executing'/i.test(sql)) {
        const [key, caller, at, staleBefore] = args;
        const r = rows.get(key);
        if (r && (r.status === 'failed' || (r.status === 'executing' && r.claimed_at < staleBefore))) {
          rows.set(key, { status: 'executing', caller, claimed_at: at, finished_at: null });
          return { meta: { changes: 1 } };
        }
        return { meta: { changes: 0 } };
      }
      if (/SET status = \?2/i.test(sql)) {
        const [key, status, at] = args;
        const r = rows.get(key) || {};
        rows.set(key, { ...r, status, finished_at: at });
        return { meta: { changes: 1 } };
      }
      return { meta: { changes: 0 } };
    },
    async first() {
      if (state.fail) throw new Error('d1_down');
      if (state.noTable) throw new Error('D1_ERROR: no such table: oneshot_claims');
      const r = rows.get(args[0]);
      return r ? { status: r.status, claimed_at: r.claimed_at } : null;
    },
  });
  return {
    rows, state,
    prepare(sql) {
      return { run: () => exec(sql, []).run(), first: () => exec(sql, []).first(), bind(...args) { return exec(sql, args); } };
    },
  };
}

// ── Load buildOneshotIntake with controllable parser/validator/extractor ─────
function loadIntake({ prices } = {}) {
  const m = { exports: {} };
  const ctl = {
    parseResult: { items: [] },
    validSkus: new Set(),
    extractorCalls: 0,
    parseCalls: 0,
    validateCalls: 0,
  };
  const stubs = [
    // Fake catalog data feeding the REAL matrix builder. Includes an MX family
    // to prove the intake allowlist excludes hardware-edition families.
    `const pricesData = __prices;`,
    grabConstLine('ONESHOT_INTAKE_FAMILIES'),
    grab('oneshotIntakeFamilyMatrix'),
    grab('clampOneshotQty'),
    grab('sanitizeOneshotFacts'),
    grab('normalizeOneshotEmail'),
    grab('parseOneshotIntakeOrderUrls'),
    grab('normalizeOneshotRequestText'),
    grab('selectOneshotRequestedMessage'),
    grab('hasExplicitMxHaIntent'),
    grab('oneshotIntakeIntent'),
    grab('isExplicitlyExcludedOneshotSku'),
    grab('normalizeOneshotLineTier'),
    grab('reconcileOneshotLiteralMxTierRows'),
    `const parseMessage = () => { __ctl.parseCalls++; return __ctl.parseResult; };`,
    `const validateSku = (s) => { __ctl.validateCalls++; return __ctl.validateResults?.[s] || { valid: __ctl.validSkus.has(s) }; };`,
    `const resolveCachedProduct = (s) => { const key = String(s || '').toUpperCase(); const entry = __prices?.prices?.[key] || null; return { key, entry }; };`,
    grab('buildOneshotIntake'),
    'module.exports = { buildOneshotIntake, oneshotIntakeFamilyMatrix, clampOneshotQty, sanitizeOneshotFacts, parseOneshotIntakeOrderUrls, normalizeOneshotRequestText, selectOneshotRequestedMessage, hasExplicitMxHaIntent, oneshotIntakeIntent };',
  ].join('\n');
  const duo = {};
  for (const ed of ['ESSENTIALS', 'ADVANTAGE', 'PREMIER']) {
    for (const t of ['1', '3', '5']) duo[`LIC-DUO-${ed}-${t}YR`] = { price: 1 };
  }
  const defaultPrices = { prices: { ...duo, 'LIC-MX84-SEC-1YR': { price: 1 }, 'LIC-MX84-ENT-3YR': { price: 1 } } };
  new Function('module', '__ctl', '__prices', stubs)(m, ctl, prices || defaultPrices);
  return { ...m.exports, ctl };
}

const ENV_ON = { CHAT_ONESHOT_ROUTE_ENABLED: 'true', CHAT_ONESHOT_OWNER_ALLOWLIST: 'chrisg@stratusinfosystems.com' };
const OWNER = 'chrisg@stratusinfosystems.com';
const EMAIL_INPUT = { subject: 'Duo quote', body_text: 'We would like 25 seats of Duo please.', participants: [{ email: 'it@customer.com', name: 'Pat' }] };

(async () => {

  console.log('\n(1) intake gate — flag, allowlist, caller identity, all fail closed');

  const I = loadIntake();
  const tripwire = async () => { I.ctl.extractorCalls++; throw new Error('extractor should not run'); };

  await checkAsync('flag absent → intake_disabled', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, { CHAT_ONESHOT_OWNER_ALLOWLIST: OWNER }, OWNER, tripwire);
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error, 'intake_disabled');
  });
  await checkAsync('missing caller → caller_required', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, null, tripwire);
    assert.strictEqual(r.error, 'caller_required');
  });
  await checkAsync('non-email caller (chrome-extension-user fallback) → caller_required', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, 'chrome-extension-user', tripwire);
    assert.strictEqual(r.error, 'caller_required');
  });
  await checkAsync('caller not in allowlist → caller_not_allowed', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, 'someoneelse@stratusinfosystems.com', tripwire);
    assert.strictEqual(r.error, 'caller_not_allowed');
  });
  await checkAsync('authenticated e-commerce extension intake is read-only and does not need legacy rollout gates', async () => {
    const input = { ...EMAIL_INPUT, source: 'ext-email-ecomm-intake' };
    const r = await I.buildOneshotIntake(input, {}, 'someoneelse@stratusinfosystems.com', async () => ({}));
    assert.strictEqual(r.success, true);
  });
  await checkAsync('e-commerce extension intake still requires a real caller identity', async () => {
    const input = { ...EMAIL_INPUT, source: 'ext-email-ecomm-intake' };
    const r = await I.buildOneshotIntake(input, {}, null, async () => ({}));
    assert.strictEqual(r.error, 'caller_required');
  });
  await checkAsync('empty subject+body → email_required', async () => {
    const r = await I.buildOneshotIntake({ subject: '  ', body_text: '' }, ENV_ON, OWNER, tripwire);
    assert.strictEqual(r.error, 'email_required');
  });
  check('gate probes never invoked the extractor', () => assert.strictEqual(I.ctl.extractorCalls, 0));

  console.log('\n(1b) extension order_urls — selected request first, strict last-cart fallback');

  await checkAsync('when message parsing yields no safe lines, last exact order URL wins and preserves line order + exact quantities', async () => {
    const U = loadIntake();
    const input = {
      ...EMAIL_INPUT,
      source: 'ext-email-ecomm-intake',
      order_urls: [
        'https://stratusinfosystems.com/order/?item=OLD-SKU&qty=99',
        'https://www.stratusinfosystems.com/order/?item=MX75%2CLIC-MX75-SEC-3Y%2CMA-PWR-CORD-US&qty=2%2C1%2C4',
      ],
    };
    let extracted = 0;
    const r = await U.buildOneshotIntake(input, {}, 'rep@stratusinfosystems.com', async () => { extracted++; return {}; });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.used_order_url, true);
    assert.strictEqual(r.selected_order_url_index, 1);
    assert.deepStrictEqual(r.lines.map((line) => [line.sku, line.qty]), [
      ['MX75', 2], ['LIC-MX75-SEC-3Y', 1], ['MA-PWR-CORD-US', 4],
    ]);
    assert.strictEqual(U.ctl.parseCalls, 1, 'the authoritative request must be parsed before URL fallback');
    assert.strictEqual(U.ctl.validateCalls, 0, 'intake must not validate products');
    assert.strictEqual(extracted, 0, 'LLM extractor must not run');
  });

  await checkAsync('a valid locked order URL works with no subject or body text', async () => {
    const U = loadIntake();
    const r = await U.buildOneshotIntake({
      source: 'ext-email-ecomm-intake',
      subject: '',
      body_text: '',
      order_urls: ['https://stratusinfosystems.com/order/?item=CW9176D1-RTG,LIC-ENT-1YR&qty=31,31'],
    }, {}, 'rep@stratusinfosystems.com', async () => { throw new Error('must not extract'); });
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.lines.map((line) => [line.sku, line.qty]), [
      ['CW9176D1-RTG', 31], ['LIC-ENT-1YR', 31],
    ]);
    assert.strictEqual(U.ctl.parseCalls, 0, 'a truly link-only handoff has no message text to parse');
  });

  await checkAsync('an unresolved selected-message SKU may use one exact URL as the bounded fallback', async () => {
    const U = loadIntake();
    U.ctl.parseResult = { items: [{ sku: 'UNKNOWN-MODEL', qty: 2 }] };
    const selectedCart = 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1';
    const r = await U.buildOneshotIntake({
      ...EMAIL_INPUT,
      source: 'ext-email-ecomm-intake',
      order_urls: [selectedCart],
    }, {}, 'rep@stratusinfosystems.com', async () => { throw new Error('must not extract'); });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.used_order_url, true);
    assert.strictEqual(r.selected_order_url, selectedCart);
    assert.deepStrictEqual(r.lines.map((line) => [line.sku, line.qty]), [
      ['MX67', 1], ['LIC-MX67-SEC-3YR', 1],
    ]);
    assert.strictEqual(U.ctl.parseCalls, 1);
    assert.strictEqual(U.ctl.validateCalls, 1);
  });

  await checkAsync('malformed fallback item/qty pairs fail closed after the request parser yields no safe lines', async () => {
    const U = loadIntake();
    const input = {
      ...EMAIL_INPUT,
      source: 'ext-email-ecomm-intake',
      order_urls: ['https://stratusinfosystems.com/order/?item=MX75,LIC-MX75-SEC-3Y&qty=2'],
    };
    let extracted = 0;
    const r = await U.buildOneshotIntake(input, {}, 'rep@stratusinfosystems.com', async () => { extracted++; return {}; });
    assert.strictEqual(r.error, 'order_url_malformed');
    assert.strictEqual(U.ctl.parseCalls, 1);
    assert.strictEqual(U.ctl.validateCalls, 0);
    assert.strictEqual(extracted, 0);
  });

  await checkAsync('non-HTTPS, non-allowlisted, and non-/order/ URLs are not accepted', async () => {
    const U = loadIntake();
    for (const badUrl of [
      'http://stratusinfosystems.com/order/?item=MX75&qty=1',
      'https://evil.stratusinfosystems.com/order/?item=MX75&qty=1',
      'https://stratusinfosystems.com/cart/?item=MX75&qty=1',
    ]) {
      const r = await U.buildOneshotIntake(
        { ...EMAIL_INPUT, source: 'ext-email-ecomm-intake', order_urls: [badUrl] },
        {}, 'rep@stratusinfosystems.com', async () => ({})
      );
      assert.strictEqual(r.error, 'order_url_not_allowed');
    }
  });

  await checkAsync('order URL list and quantity bounds fail closed', async () => {
    const U = loadIntake();
    const tooMany = await U.buildOneshotIntake({
      ...EMAIL_INPUT,
      source: 'ext-email-ecomm-intake',
      order_urls: Array.from({ length: 6 }, (_, i) => `https://stratusinfosystems.com/order/?item=SKU-${i}&qty=1`),
    }, {}, 'rep@stratusinfosystems.com', async () => ({}));
    assert.strictEqual(tooMany.error, 'order_urls_too_many');
    const zeroQty = await U.buildOneshotIntake({
      ...EMAIL_INPUT,
      source: 'ext-email-ecomm-intake',
      order_urls: ['https://stratusinfosystems.com/order/?item=MX75&qty=0'],
    }, {}, 'rep@stratusinfosystems.com', async () => ({}));
    assert.strictEqual(zeroQty.error, 'order_url_malformed');
  });

  console.log('\n(2) literal-SKU path — deterministic, LLM never runs');

  await checkAsync('valid literal SKUs → resolved lines, used_llm=false, extractor untouched', async () => {
    const L = loadIntake();
    L.ctl.parseResult = { items: [{ sku: 'MR44', qty: 2 }, { baseSku: 'LIC-MR-ADV-3YR', qty: 2 }] };
    L.ctl.validSkus = new Set(['MR44', 'LIC-MR-ADV-3YR']);
    let called = 0;
    const r = await L.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => { called++; return {}; });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.used_llm, false);
    assert.strictEqual(called, 0, 'extractor must not run on the literal path');
    assert.deepStrictEqual(r.lines.map((l) => [l.sku, l.qty, l.status]),
      [['MR44', 2, 'resolved'], ['LIC-MR-ADV-3YR', 2, 'resolved']]);
  });
  await checkAsync('literal LIC-ENT does not publish a global ENT intake tier for blank MX hardware', async () => {
    const L = loadIntake();
    // Mirror the real parser's broad requestedTier result: the intake helper
    // must independently mask the literal license SKU before publishing intent.
    L.ctl.parseResult = {
      items: [{ sku: 'LIC-ENT-3YR', qty: 2 }, { sku: 'MX67', qty: 1 }],
      requestedTier: 'ENT', modifiers: { hardwareOnly: false, licenseOnly: false },
    };
    L.ctl.validSkus = new Set(['LIC-ENT-3YR', 'MX67']);
    const r = await L.buildOneshotIntake({
      subject: 'Quote request',
      body_text: 'Please quote 2 LIC-ENT-3YR and 1 MX67.',
      messages: [{ index: 0, from_email: 'it@example.com', body: 'Please quote 2 LIC-ENT-3YR and 1 MX67.' }],
    }, ENV_ON, OWNER, async () => ({}));
    assert.strictEqual(r.success, true);
    assert.deepStrictEqual(r.lines.map((l) => [l.sku, l.qty]), [['LIC-ENT-3YR', 2], ['MX67', 1]]);
    assert.strictEqual(r.intent.license_tier, null);
  });
  await checkAsync('real Enterprise and Security prose still publish the intended intake tier', async () => {
    for (const [word, tier] of [['enterprise', 'ENT'], ['security', 'SEC']]) {
      const L = loadIntake();
      L.ctl.parseResult = {
        items: [{ sku: 'LIC-ENT-3YR', qty: 2 }, { sku: 'MX67', qty: 1, requestedTier: tier }],
        requestedTier: tier, modifiers: { hardwareOnly: false, licenseOnly: false },
      };
      L.ctl.validSkus = new Set(['LIC-ENT-3YR', 'MX67']);
      const text = `Please quote 2 LIC-ENT-3YR and 1 MX67 ${word}.`;
      const r = await L.buildOneshotIntake({
        subject: 'Quote request',
        body_text: text,
        messages: [{ index: 0, from_email: 'it@example.com', body: text }],
      }, ENV_ON, OWNER, async () => ({}));
      assert.strictEqual(r.success, true, word);
      assert.strictEqual(r.intent.license_tier, tier, word);
    }
  });
  await checkAsync('invalid literal candidates remain visible and block until corrected', async () => {
    const L = loadIntake();
    L.ctl.parseResult = { items: [{ sku: 'NOTASKU', qty: 3 }] };
    L.ctl.validSkus = new Set();
    let called = 0;
    const r = await L.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => { called++; return { requested_products: [] }; });
    assert.strictEqual(r.used_llm, false);
    assert.strictEqual(r.lines[0].status, 'unsupported');
    assert.strictEqual(r.lines[0].sku, 'NOTASKU');
    assert.strictEqual(called, 0);
  });
  await checkAsync('Catalyst shorthand remains visible with exact selectable suggestions', async () => {
    const L = loadIntake();
    L.ctl.parseResult = { items: [{ sku: 'C9300-24P', qty: 1 }, { sku: 'MT12', qty: 1 }, { sku: 'MT10', qty: 1 }] };
    L.ctl.validSkus = new Set(['MT12', 'MT10']);
    L.ctl.validateResults = {
      'C9300-24P': { valid: false, reason: 'C9300-24P needs an exact uplink variant', suggest: ['C9300-24P-M', 'C9300L-24P-4X-M'] },
    };
    const r = await L.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({}));
    assert.deepStrictEqual(r.lines.map((l) => [l.sku, l.status]), [
      ['C9300-24P', 'needs_sku'], ['MT12', 'resolved'], ['MT10', 'resolved'],
    ]);
    assert.deepStrictEqual(r.lines[0].suggestions, ['C9300-24P-M', 'C9300L-24P-4X-M']);
  });
  await checkAsync('structured customer quote message wins over later historical device chatter and preserves ENT/HA intent', async () => {
    const L = loadIntake();
    L.ctl.parseResult = {
      items: [{ sku: 'MX105', qty: 2 }, { sku: 'MX85', qty: 2 }],
      requestedTier: 'ENT', modifiers: { hardwareOnly: false, licenseOnly: false },
    };
    L.ctl.validSkus = new Set(['MX105', 'MX85']);
    const r = await L.buildOneshotIntake({
      ...EMAIL_INPUT,
      messages: [
        { index: 0, from_email: 'jody@example.com', body: 'Looking to get a quote for 2 - MX105 (enterprise with warm spare) and 2 - MX85 (enterprise with warm spare).' },
        { index: 1, from_email: 'chrisg@stratusinfosystems.com', body: 'Attached a quote.' },
        { index: 2, from_email: 'jody@example.com', body: 'We will need to order soon as I am replacing old MX84 appliances with MX85 units at other locations.' },
      ],
    }, ENV_ON, OWNER, async () => ({}));
    assert.deepStrictEqual(r.lines.map((l) => [l.sku, l.qty]), [['MX105', 2], ['MX85', 2]]);
    assert.strictEqual(r.selected_message_index, 0);
    assert.strictEqual(r.intent.license_tier, 'ENT');
    assert.strictEqual(r.intent.ha_requested, true);
    assert.strictEqual(r.intent.hardware_only, false);
    assert.ok(L.normalizeOneshotRequestText('2 - MX105 and 2 - MX85').includes('2 MX105'));
  });
  check('an approval plus a genuine new quote ask remains eligible as the current request', () => {
    const L = loadIntake();
    const selected = L.selectOneshotRequestedMessage([
      { index: 0, from_email: 'jody@example.com', body: 'Please quote 1 MX67.' },
      { index: 1, from_email: 'jody@example.com', body: 'The MX67 looks good. Could you provide us a quote for 2 MX85 as well?' },
    ], '');
    assert.strictEqual(selected.selected_message_index, 1);
  });
  check('HA detector accepts hyphen/plural intent and rejects quantity, unrelated spare, and negated wording', () => {
    for (const text of [
      'explicit high-availability warm spares', 'high availability firewalls',
      'warm spare MX pair', 'HA configuration', 'failover appliances', 'spare MX85',
      'High availability is required, not optional',
      'Quote two MX85 with high availability, not standard licensing',
      'Do not omit the warm spare',
      'Configure failover, not standalone mode',
      'No standard deployment, use high availability',
      '2 MX105 and 2 MX85, no MX84, enterprise licensing, high availability',
      'high availability, no MX84',
      'exclude historical MX84 and configure high availability for MX105 and MX85',
      'without MX84 but use high availability for MX105 and MX85',
      '2x MX105 + 2x MX85, ENT licensing, HA; exclude historical MX84.',
      'HA',
      'HA required for these MX85s',
      'Use HA for the MX105 and MX85',
      'Quote 2 MX85; high availability is not optional.',
      'High availability must not be omitted',
      'High availability cannot be omitted',
      'HA for 2 MX85s',
      'Warm spare for 2 MX85s',
      'HA for two MX85s',
      'Warm spare for the MX85 pair',
      'High availability for the MX85 pair',
      'Customer approved HA',
      'HA is preferred',
      "Don't forget the warm spare",
      'Never forget the warm spare',
      'Put the MX85s in HA',
      'Ensure high availability',
      'HA on two MX85s',
      'HA with two MX85s',
      'We opted for HA',
      'HA chosen',
      'Customer asked for HA',
      'Please turn on HA',
      'We would like HA',
      'Must have HA',
      'Provide an HA pair',
      'Customer request: HA',
      'Make it high availability',
      'Apply HA to these MX85s',
      'Build HA into the quote',
      'Deliver the MX85s with HA',
      'Design for high availability',
      'Can you ensure high availability?',
      'Could you turn on HA?',
      'Would you set up failover?',
      'Do not leave out HA',
      'HA should not be left out',
      'HA is our choice',
      'Can you activate HA?',
      'Would you implement failover?',
      'Could you put the MX85s in HA?',
      'Would you run both MX85s in HA?',
      'Can you place the MX85s in HA?',
      'Would you keep HA enabled?',
      'HA is the selected option',
      "The customer's preference is HA",
      'Please give us HA',
      'HA must remain enabled',
      "Please don't turn off HA",
      'Never turn off HA',
      "Please don't switch off HA",
      'Never switch off HA',
      'Customer signed off on HA',
      'HA has been approved',
      'Customer elected HA',
      'HA was elected',
      'HA is non-optional',
      'Quote 2 MX85 without omitting HA',
      'Deploy the MX85s without disabling HA',
      'Configure the MX85 pair as active-passive',
      'Deploy the MX105s in active standby',
      'Use HA instead of standalone mode',
      'Customer selected HA over standard mode',
      'Quote HA rather than standalone mode',
      'Deploy HA in place of standard mode',
      'Remove old MX84 and include HA.',
      'Do not quote without HA',
      'We cannot proceed without HA',
      'HA is essential',
      'HA is compulsory',
      'HA is a hard requirement',
      'Customer committed to HA',
      'Customer authorized HA',
      'Make the firewalls highly available',
      'Run the MX85s as active-passive',
      'Configure the MX105s active/standby',
      'Approval has been granted for HA.',
      'HA has customer approval.',
      'Proceed using a warm spare.',
      'Customer proceeded with HA.',
      'Customer gave approval for HA.',
      'Final selection: HA.',
      'Customer decided on HA.',
      'This is explicit HA.',
      'Configure these as a warm spare.',
      'Quote the MX85s with HA.',
      'Do not forget to include HA.',
      'Do not fail to include HA.',
      'Do not hesitate to configure HA.',
      'Never forget to keep HA enabled.',
      'Do not, under any circumstances, forget to include HA.',
    ]) assert.strictEqual(I.hasExplicitMxHaIntent(text), true, text);
    for (const text of [
      '2 MX105 and 2 MX85', 'spare parts and spare cable', 'backup config with redundant links',
      'no warm spare', 'do not configure high availability', 'without a failover appliance',
      'Please do not configure these appliances for high availability',
      'These are not intended to be configured as a warm spare',
      'Quote two MX85 for a non-high-availability pair',
      'High availability is not required for these MX85s',
      'Warm spare is not needed',
      'Failover should be excluded',
      "High availability isn't required",
      "Warm spare isn't needed",
      "Failover shouldn't be included",
      'Avoid high availability',
      'Omit the warm spare',
      'Skip failover',
      'High availability is prohibited',
      'High availability, not required',
      'Warm spare: not needed',
      'High availability? No.',
      'Never configure high availability',
      'Never use a warm spare',
      'We never want failover',
      'High availability is optional',
      'Warm spare is optional',
      'High availability is out of scope',
      'High availability was ruled out',
      'Warm spare is unneeded',
      'Failover is forbidden',
      'Do these MX85s support failover?',
      'Explain high availability for 2 MX85',
      'Can you quote 2 MX85 and tell me whether they support failover?',
      'No HA',
      'HA is optional',
      'Do these MX85s support HA?',
      'High availability (not required)',
      'Warm spare — not needed',
      'Failover / not needed',
      'High availability is no longer required',
      'We do not think we need high availability',
      "I don't believe a warm spare is needed",
      "We aren't looking for high availability",
      "We don't plan to use a warm spare",
      'We are not planning to use HA',
      'HA is unsupported',
      'HA is supported',
      'HA is available',
      'Quote 2 MX85. No need for high availability.',
      "Quote 2 MX85; we won't use high availability.",
      'High availability should be avoided.',
      'Should we use high availability?',
      "Quote 2 MX85. We aren't using high availability.",
      'Quote 2 MX85 without needing high availability.',
      'Quote 2 MX85; avoid using high availability.',
      'Quote 2 MX85; high availability is never needed.',
      'Quote 2 MX85; high availability was rejected.',
      'Quote 2 MX85. They had a warm spare last year but do not need one now.',
      'Quote 2 MX85; can these use warm spare mode?',
      'Do not quote HA',
      'We cannot use HA',
      'We do not currently need HA',
      'HA was declined',
      'HA is currently not required',
      'Reject the warm spare',
      'No thanks on HA',
      'There is no current need for high availability',
      'We have no plans for HA',
      'We have no intention of using HA',
      'We decided not to use high availability',
      'High availability remains disabled',
      'High availability was used before, but not requested now',
      'High availability was considered but rejected',
      'Warm spare was discussed but declined',
      'The customer declined high availability',
      'HA is probably not needed',
      'Can MX85s use warm spare mode?',
      'Quote 2 MX85 with optional HA',
      'Quote 2 MX85; we may need HA',
      'Quote 2 MX85, HA TBD',
      'Quote 2 MX85. We no longer use HA.',
      'Quote 2 MX85. Customer previously used high availability.',
      "Quote 2 MX85. Don't leave high availability enabled.",
      "Please don't automatically include HA",
      'The customer has not requested HA',
      "The customer hasn't requested HA",
      'We no longer want HA',
      'Do not explicitly quote HA',
      'Customer may want HA',
      'We might use HA',
      'We previously used HA',
      'We never formally requested HA',
      'Quote 2 MX85. Old design used failover; new quote is standalone.',
      "Quote 2 MX85. Last year they needed high availability, now they don't.",
      'Quote 2 MX85; maybe use HA',
      'Omit any use of high availability',
      'Quote 2 MX85 with possible HA',
      'Can you tell me whether to include HA?',
      'Could you advise whether we should use HA?',
      'We are evaluating whether to include HA',
      'We want to understand HA',
      'Request information about HA',
      'Need info about HA',
      'Need to decide whether to use HA',
      'Existing MX85 HA configuration',
      'MX85 HA support',
      'We can use HA',
      'Advise whether to use HA',
      'Include HA if customer confirms',
      'Configure HA if approved',
      'Need to decide on HA',
      'Need an explanation of HA',
      'Quote 2 MX85 with potentially needed HA',
      'Customer did not approve HA',
      'We did not choose HA',
      "We don't prefer HA",
      'No one requested HA',
      'The customer refused to use HA',
      'Customer cancelled plans to use HA',
      'We have not selected HA',
      'The customer did not select HA',
      "We haven't selected HA",
      'Do not select HA',
      'Do not activate HA',
      'Do not implement HA',
      'Do not implement failover',
      'Do not put the MX85s in HA',
      'Do not place the MX85s in HA',
      'Do not run the MX85s in HA',
      'Do not set up failover',
      'We did not confirm HA',
      'We have not confirmed HA',
      'No customer asked for HA',
      'Neither customer requested HA',
      'None of the options include HA',
      'We stopped requesting HA',
      'Customer withdrew the request for HA',
      'We are unsure we want HA',
      'Include HA only after approval',
      'For discussion only, include HA',
      'Proposed configuration includes HA',
      'Turn off HA',
      'Switch off HA',
      'Please keep HA off',
      'Customer asked about HA',
      'Customer asked for more info on HA',
      'Need documentation on HA',
      'Need to review HA',
      'Need approval for HA',
      'Pending approval, use HA',
      'Tentatively configure HA',
      'Include an explanation about HA',
      'Include a section on HA',
      'Include a note about HA',
      'Need a diagram of HA',
      'Need cost information about HA',
      'Configure HA once approved',
      'When approved, configure HA',
      'Enable HA after customer signs off',
      'Use HA — approval pending',
      'Request approval for HA',
      'The previous quote required HA',
      'In 2024 we required HA',
      'The appliances are HA capable',
      'Use standalone instead of HA',
      'Customer selected standard mode over HA',
      'Quote standalone rather than HA',
      'Deploy standard mode in place of HA',
      'The customer decided against HA',
      'The customer opted out of HA',
      'Configure HA, but the customer later declined it',
      'Use HA. Correction: do not include it.',
      'Customer requested HA, then withdrew the request',
      'Do not deploy active-passive',
      'Active standby is optional',
      'Need an HA estimate before deciding',
      'Budget permitting, use HA',
      'HA required. Actually do not include HA',
      'Include HA. Correction use standard',
      'Use HA. Actually no, use standard',
      'HA selected earlier but removed now.',
      'HA approved earlier but superseded by standard.',
      'Enable HA provided that approval is received.',
      'Include HA contingent on approval.',
      'Add HA dependent upon budget approval.',
      'Configure HA assuming the customer agrees.',
      'Configure HA following approval.',
      'Use HA as long as the customer approves.',
      'Use HA in the event the customer approves.',
      'Use HA depending on approval.',
      'Include HA conditionally.',
      'Provisionally include HA.',
      'Use HA, approval TBD.',
      'We will use HA should funding be approved.',
      'Provide a comparison between standard and HA.',
      'Quote hardware capable of HA.',
      'Could you add a note explaining HA?',
      'Quote 2 MX85 for an HA evaluation.',
      'Include HA in the documentation.',
      'Include HA in the comparison table.',
      'Provide information about HA.',
      'Provide details about HA.',
      'We need to talk about HA.',
      'Put HA on the agenda.',
      'The customer previously selected HA.',
      'The customer previously chose HA.',
      'The customer previously approved HA.',
      'Last week we required HA.',
      'HA approved last year.',
      'Prior quote: HA required.',
      'Old quote: HA required.',
      'The superseded design used an HA pair.',
      'Minutes from March say warm spare was approved.',
      'The archived scope included failover.',
      'We initially requested HA. We changed our mind; use standard.',
      'HA requested. Cancel that; use standard.',
      'Use HA. No, standard instead.',
      'Quote HA. On second thought, leave it out.',
      'Use a warm spare. Revised instruction: quote standalone.',
      'HA was approved, but the latest direction is standard.',
      'Include high availability. Final answer: no HA.',
      'Can you make a comparison for HA?',
      'Add HA as a consideration.',
      'The customer once required HA.',
      'In Q1 we selected HA.',
      'On the old quote, customer selected HA.',
      'HA selected on the prior quote.',
      'History: customer requested HA.',
      'Historical: customer requested HA.',
      'The last quote requested HA.',
      'The customer required HA in the previous phase.',
      'Earlier correspondence requested HA.',
      'Configure HA. Update: the customer chose standalone.',
      'Use HA for the historical MX84 only; exclude it from this quote.',
      'Exclude the old MX84 HA pair. Quote 2 MX85 standard.',
      'Do not authorize HA',
      'Customer did not authorize HA',
      'Customer has not authorized HA',
      'Customer did not elect HA',
      'Never commit to HA',
      'Customer did not commit to HA',
      "Don't sign off on HA",
      'Customer did not sign off on HA',
      'Do not proceed with HA',
      'Customer did not proceed with HA',
      'Customer did not give approval for HA',
      'Use HA only with approval',
      'Two years ago we used HA',
      'Three months ago the customer requested HA',
      'Last Tuesday the customer approved HA',
      'Use HA. Disregard that; use standard.',
      'Use HA. Scratch that; use standalone.',
      'Use HA. Ignore that; quote standard.',
      'Use HA. Final direction: standard.',
      'Do not ensure HA',
      'Customer did not ensure high availability',
      'Do not make it HA',
      'Never make the firewalls highly available',
      'Do not apply HA',
      'Customer did not apply HA to these MX85s',
      "Don't build HA into the quote",
      'Customer did not build high availability into the design',
      'Do not deliver the MX85s with HA',
      'Customer did not deliver HA',
      'Do not design for HA',
      'Customer did not design the network for high availability',
      'We did not decide on HA',
      'Customer has not decided on HA',
      'This is not explicit HA',
      'Not with HA',
      'Use standard, not with HA',
      'Not as HA',
      'Configure these not as a warm spare',
      'The MX85s are not with high availability',
      'The quote must not have HA',
      'Customer does not want HA',
      'Customer could not approve HA',
      'Customer might not choose HA',
      'We did not, after review, authorize HA',
      'Do not, under any circumstances, enable HA',
      "We haven't (yet) approved HA",
      'We did not — after review — authorize HA',
      'We did not at any point ever authorize HA',
      'We have yet to approve HA',
      'We are waiting to approve HA',
    ]) assert.strictEqual(I.hasExplicitMxHaIntent(text), false, text);
  });

  console.log('\n(3) extraction path — LOCAL matrix resolution only, LLM can never mint a SKU');

  await checkAsync('stated edition+term resolve to the exact catalog SKU', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'Duo', edition: 'Advantage', term_years: 3, qty: 25, evidence: '25 seats of Duo Advantage 3yr' }],
    }));
    assert.strictEqual(r.lines[0].sku, 'LIC-DUO-ADVANTAGE-3YR');
    assert.strictEqual(r.lines[0].status, 'resolved');
    assert.strictEqual(r.lines[0].qty, 25);
  });
  await checkAsync('missing edition → needs_edition with full 3×3 matrix', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'DUO', edition: null, term_years: null, qty: 25 }],
    }));
    const l = r.lines[0];
    assert.strictEqual(l.status, 'needs_edition');
    assert.strictEqual(l.sku, null);
    assert.deepStrictEqual(l.options.editions, ['ADVANTAGE', 'ESSENTIALS', 'PREMIER']);
    assert.deepStrictEqual(l.options.terms, [1, 3, 5]);
    assert.strictEqual(l.options.sku_matrix.PREMIER['5'], 'LIC-DUO-PREMIER-5YR');
  });
  await checkAsync('edition stated, term missing → needs_term', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'DUO', edition: 'ESSENTIALS', term_years: null, qty: 10 }],
    }));
    assert.strictEqual(r.lines[0].status, 'needs_term');
  });
  await checkAsync('MX (hardware-edition family) is NOT in the intake matrix → unsupported', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'MX84', edition: 'SEC', term_years: 1, qty: 1 }],
    }));
    assert.strictEqual(r.lines[0].status, 'unsupported');
    assert.strictEqual(r.lines[0].sku, null);
  });
  await checkAsync('unknown family → unsupported, never a guessed SKU', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'UMBRELLA', edition: 'DNS', term_years: 3, qty: 5 }],
    }));
    assert.strictEqual(r.lines[0].status, 'unsupported');
  });
  await checkAsync('injection-shaped family is sanitized then rejected as unsupported', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [{ family: 'DUO"; DROP TABLE x; --', edition: 'PREMIER', term_years: 1, qty: 1 }],
    }));
    assert.strictEqual(r.lines[0].status, 'unsupported');
    assert.ok(!/[^A-Z0-9]/.test(r.lines[0].family), 'family must be sanitized to [A-Z0-9]');
  });
  await checkAsync('qty is clamped: 0 → 1, huge → 1, "25" → 25', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [
        { family: 'DUO', edition: 'PREMIER', term_years: 1, qty: 0 },
        { family: 'DUO', edition: 'PREMIER', term_years: 1, qty: 10000000 },
        { family: 'DUO', edition: 'PREMIER', term_years: 1, qty: '25' },
      ],
    }));
    assert.deepStrictEqual(r.lines.map((l) => l.qty), [1, 1, 25]);
  });
  await checkAsync('extractor failure → success with extract_error, zero lines (manual fallback)', async () => {
    const r = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => { throw new Error('extract_http_500'); });
    assert.strictEqual(r.success, true);
    assert.ok(r.extract_error.includes('extract_http_500'));
    assert.strictEqual(r.lines.length, 0);
  });
  await checkAsync('single ISR mention → isr_prefill; multiple → none', async () => {
    const one = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [], isr_mentions: [{ name: 'Josh Disla' }],
    }));
    assert.deepStrictEqual(one.isr_prefill, { name: 'Josh Disla' });
    const two = await I.buildOneshotIntake(EMAIL_INPUT, ENV_ON, OWNER, async () => ({
      requested_products: [], isr_mentions: [{ name: 'Josh Disla' }, { name: 'Emily M' }],
    }));
    assert.strictEqual(two.isr_prefill, null);
  });

  console.log('\n(4) real catalog truth — prices.json carries the full DUO matrix');

  check('real prices.json resolves DUO to 3 editions × 3 terms', () => {
    const real = require('./src/data/prices.json');
    const R = loadIntake({ prices: real });
    const matrix = R.oneshotIntakeFamilyMatrix();
    assert.deepStrictEqual(Object.keys(matrix.DUO).sort(), ['ADVANTAGE', 'ESSENTIALS', 'PREMIER']);
    for (const ed of Object.keys(matrix.DUO)) {
      assert.deepStrictEqual(Object.keys(matrix.DUO[ed]).sort(), ['1', '3', '5']);
    }
  });

  console.log('\n(5) claimOneshotExecution — real CAS semantics on fake D1');

  const claimMod = { exports: {} };
  new Function('module', [
    grabConstLine('ONESHOT_STALE_CLAIM_MS'),
    grab('claimOneshotExecution'),
    grab('settleOneshotClaim'),
    'module.exports = { claimOneshotExecution, settleOneshotClaim };',
  ].join('\n'))(claimMod);
  const { claimOneshotExecution, settleOneshotClaim } = claimMod.exports;

  await checkAsync('fresh key claims; identical second claim → already_executing', async () => {
    const db = fakeD1();
    const env = { ANALYTICS_DB: db };
    assert.strictEqual((await claimOneshotExecution(env, 'k1', OWNER)).ok, true);
    const second = await claimOneshotExecution(env, 'k1', OWNER);
    assert.strictEqual(second.ok, false);
    assert.strictEqual(second.error, 'already_executing');
  });
  await checkAsync('settled failed → reclaimable; settled succeeded → already_succeeded', async () => {
    const db = fakeD1();
    const env = { ANALYTICS_DB: db };
    await claimOneshotExecution(env, 'k2', OWNER);
    await settleOneshotClaim(env, 'k2', 'failed');
    assert.strictEqual((await claimOneshotExecution(env, 'k2', OWNER)).ok, true, 'failed must reclaim');
    await settleOneshotClaim(env, 'k2', 'succeeded');
    const done = await claimOneshotExecution(env, 'k2', OWNER);
    assert.strictEqual(done.ok, false);
    assert.strictEqual(done.succeeded, true);
  });
  await checkAsync('stale executing (>10 min) reclaims; fresh executing does not', async () => {
    const db = fakeD1();
    const env = { ANALYTICS_DB: db };
    await claimOneshotExecution(env, 'k3', OWNER);
    db.rows.get('k3').claimed_at = Date.now() - 11 * 60 * 1000;
    assert.strictEqual((await claimOneshotExecution(env, 'k3', OWNER)).ok, true, 'stale must reclaim');
    assert.strictEqual((await claimOneshotExecution(env, 'k3', OWNER)).ok, false, 'fresh must not');
  });
  await checkAsync('missing binding and throwing D1 both → mutex_unavailable (fail closed)', async () => {
    const none = await claimOneshotExecution({}, 'k4', OWNER);
    assert.strictEqual(none.error, 'mutex_unavailable');
    const db = fakeD1();
    db.state.fail = true;
    const down = await claimOneshotExecution({ ANALYTICS_DB: db }, 'k4', OWNER);
    assert.strictEqual(down.error, 'mutex_unavailable');
    assert.strictEqual(down.retryable, true);
  });
  await checkAsync('unmigrated DB (no such table) → migration_required, NOT retryable, no runtime CREATE TABLE', async () => {
    const db = fakeD1();
    db.state.noTable = true;
    const r = await claimOneshotExecution({ ANALYTICS_DB: db }, 'k5', OWNER);
    assert.strictEqual(r.error, 'mutex_unavailable');
    assert.strictEqual(r.migration_required, true);
    assert.strictEqual(r.retryable, false, 'an unmigrated DB must not look like a transient outage');
    // The fake D1 throws on any CREATE TABLE, so reaching this line at all
    // proves the runtime bootstrap is gone.
    assert.ok(!/CREATE TABLE/i.test(stripComments(grab('claimOneshotExecution'))),
      'claimOneshotExecution must not create the table');
  });

  console.log('\n(6) executeOneshot under the claim — gate, mutex, settle, resume');

  function loadExecute({ kvInit = {}, responses = null, db = fakeD1(), toolDelayMs = 0 } = {}) {
    const calls = [];
    const kv = new Map(Object.entries(kvInit));
    const m = { exports: {} };
    const stubs = [
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', nextMonthEnd: '2026-08-31', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('isDomainLike'),
      (() => {
        const line = SRC.split('\n').find((l) => l.startsWith('const PLACEHOLDER_NAME_RE = '));
        return `${line}\n${grab('isPlaceholderName')}`;
      })(),
      `const validateOneshotReviewBinding = async () => ({ success: true, review: { product_snapshot: { plan_id: 'P1', snapshot_hash: 'H1', catalog_version: 'C1' } } });`,
      `const validateOneshotProductSnapshotForExecute = async (snapshot) => ({ success: true, snapshot });`,
      `const ONESHOT_PRODUCT_SNAPSHOT_CAPABILITY = Symbol('test-oneshot-snapshot');`,
      grabConstLine('ONESHOT_STALE_CLAIM_MS'),
      grab('claimOneshotExecution'),
      grab('settleOneshotClaim'),
      `const executeToolCall = async (tool, input) => { __calls.push({ tool, input }); if (__delay) await new Promise((r) => setTimeout(r, __delay)); const r = __responses ? __responses[Math.min(__calls.length - 1, __responses.length - 1)] : null; return r || { success: true, records: { deal: { id: 'D1', url: 'u' }, quote: { id: 'Q1', url: 'u' } } }; };`,
      grab('executeOneshot'),
      'module.exports = executeOneshot;',
    ].join('\n');
    new Function('module', '__calls', '__responses', '__delay', stubs)(m, calls, responses, toolDelayMs);
    const env = {
      ANALYTICS_DB: db,
      CONVERSATION_KV: {
        get: async (k) => { const v = kv.get(k); return v === undefined ? null : (typeof v === 'string' ? JSON.parse(v) : v); },
        put: async (k, v) => { kv.set(k, typeof v === 'string' ? v : JSON.stringify(v)); },
      },
    };
    return { run: (input, extraEnv = {}) => m.exports(input, { ...env, ...extraEnv }, OWNER), calls, kv, db, env };
  }

  const VALID = {
    idempotency_key: 'ext:itest-0001',
    review_token: 'stubbed',
    skus: [{ sku: 'LIC-DUO-ADVANTAGE-3YR', qty: 25 }],
    closing_date: '2026-07-25',
    account: { id: 'A1' },
    contact: { id: 'C1' },
    deal: { new: true, confirmed: true },
    lead_source: 'Stratus Referal',
  };

  await checkAsync('success settles the claim to succeeded and stores the KV replay', async () => {
    const X = loadExecute();
    const r = await X.run({ ...VALID });
    assert.strictEqual(r.success, true);
    assert.strictEqual(X.calls.length, 1);
    assert.strictEqual(X.db.rows.get(VALID.idempotency_key).status, 'succeeded');
    assert.ok(X.kv.has(`oneshot:${VALID.idempotency_key}`));
  });
  await checkAsync('concurrent double-fire: exactly one tool call, loser gets already_executing', async () => {
    const X = loadExecute({ toolDelayMs: 25 });
    const [a, b] = await Promise.all([X.run({ ...VALID }), X.run({ ...VALID })]);
    const winners = [a, b].filter((r) => r.success === true);
    const losers = [a, b].filter((r) => r.error === 'already_executing');
    assert.strictEqual(winners.length, 1, 'exactly one write sequence');
    assert.strictEqual(losers.length, 1, 'loser must see already_executing');
    assert.strictEqual(X.calls.length, 1, 'exactly one tool call');
  });
  await checkAsync('tool failure settles failed; retry reclaims and succeeds', async () => {
    const X = loadExecute({ responses: [{ success: false, error: 'zoho_500' }, null] });
    const first = await X.run({ ...VALID });
    assert.strictEqual(first.success, false);
    assert.strictEqual(X.db.rows.get(VALID.idempotency_key).status, 'failed');
    const second = await X.run({ ...VALID });
    assert.strictEqual(second.success, true);
    assert.strictEqual(X.db.rows.get(VALID.idempotency_key).status, 'succeeded');
  });
  await checkAsync('post-claim exception settles failed and reports oneshot_execute_exception', async () => {
    const X = loadExecute();
    X.calls.push = () => { throw new Error('boom'); };
    const r = await X.run({ ...VALID });
    assert.strictEqual(r.error, 'oneshot_execute_exception');
    assert.strictEqual(X.db.rows.get(VALID.idempotency_key).status, 'failed');
  });
  await checkAsync('D1 down → mutex_unavailable, ZERO tool calls (fail closed)', async () => {
    const db = fakeD1();
    db.state.fail = true;
    const X = loadExecute({ db });
    const r = await X.run({ ...VALID });
    assert.strictEqual(r.error, 'mutex_unavailable');
    assert.strictEqual(r.retryable, true);
    assert.strictEqual(X.calls.length, 0);
  });
  await checkAsync('KV success replay short-circuits BEFORE the claim (no claim row)', async () => {
    const X = loadExecute({ kvInit: { [`oneshot:${VALID.idempotency_key}`]: JSON.stringify({ success: true, records: { deal: { id: 'D1' } } }) } });
    const r = await X.run({ ...VALID });
    assert.strictEqual(r.replayed, true);
    assert.strictEqual(X.calls.length, 0);
    assert.strictEqual(X.db.rows.size, 0, 'replay must not touch D1');
  });
  await checkAsync('claim says succeeded but KV evicted → already_succeeded, no write', async () => {
    const X = loadExecute();
    X.db.rows.set(VALID.idempotency_key, { status: 'succeeded', caller: OWNER, claimed_at: Date.now(), finished_at: Date.now() });
    const r = await X.run({ ...VALID });
    assert.strictEqual(r.error, 'already_succeeded');
    assert.strictEqual(X.calls.length, 0);
  });
  await checkAsync('review-phase gate: ext-oneshot-intake source blocks BEFORE the claim by default', async () => {
    const X = loadExecute();
    const r = await X.run({ ...VALID, source: 'ext-oneshot-intake' });
    assert.strictEqual(r.error, 'execute_disabled_review_phase');
    assert.strictEqual(X.calls.length, 0);
    assert.strictEqual(X.db.rows.size, 0, 'gate must not churn claim rows');
  });
  await checkAsync('e-commerce intake source is permanently read-only at Execute', async () => {
    const X = loadExecute();
    const r = await X.run({ ...VALID, source: 'ext-email-ecomm-intake' }, { CHAT_ONESHOT_EXECUTE_ENABLED: 'true' });
    assert.strictEqual(r.error, 'source_read_only');
    assert.strictEqual(X.calls.length, 0);
    assert.strictEqual(X.db.rows.size, 0, 'read-only source must stop before the claim');
  });
  await checkAsync('review-phase gate opens with CHAT_ONESHOT_EXECUTE_ENABLED=true', async () => {
    const X = loadExecute();
    const r = await X.run({ ...VALID, source: 'ext-oneshot-intake' }, { CHAT_ONESHOT_EXECUTE_ENABLED: 'true' });
    assert.strictEqual(r.success, true);
  });
  await checkAsync('other sources (dashboard/URL card) are NOT gated by the review phase', async () => {
    const X = loadExecute();
    const r = await X.run({ ...VALID, source: 'ext-oneshot' });
    assert.strictEqual(r.success, true);
  });

  console.log('\n(7) source-level wiring invariants');

  check('/api/oneshot-intake route registered with the injected extractor', () => {
    assert.ok(SRC.includes(`case '/api/oneshot-intake': {`), 'route case missing');
    assert.ok(/buildOneshotIntake\(apiBody, env, \(env && env\.__CALLER_EMAIL\) \|\| null, extractOneshotFactsLLM\)/.test(SRC));
  });
  check('each one-shot route is registered EXACTLY once (no duplicate switch case)', () => {
    // A duplicated `case` is not a SyntaxError — the second copy is silent dead
    // code. A consolidation/port is exactly how one gets introduced, so pin it.
    for (const route of ['intake', 'plan', 'validate', 'execute']) {
      const n = (SRC.match(new RegExp(`case '/api/oneshot-${route}':`, 'g')) || []).length;
      assert.strictEqual(n, 1, `/api/oneshot-${route} registered ${n} times`);
    }
  });
  check('claim ordering: KV replay → review-phase gate → claim → stage ledger', () => {
    const fn = grab('executeOneshot');
    const replay = fn.indexOf('replayed: true');
    const gate = fn.indexOf('execute_disabled_review_phase');
    const claim = fn.indexOf('claimOneshotExecution(env, key, caller)');
    const stage = fn.indexOf('STAGE LEDGER');
    assert.ok(replay > -1 && gate > replay && claim > gate && stage > claim,
      `ordering broken: replay=${replay} gate=${gate} claim=${claim} stage=${stage}`);
  });
  check('every terminal path after the claim settles it', () => {
    const fn = grab('executeOneshot');
    assert.ok(/settleOneshotClaim\(env, key, 'succeeded'\)/.test(fn));
    assert.ok((fn.match(/settleOneshotClaim\(env, key, 'failed'\)/g) || []).length >= 2,
      'both the exception path and the tool-failure path must settle failed');
  });
  check('migration file is the ONLY schema authority (no runtime CREATE TABLE anywhere)', () => {
    const sql = fs.readFileSync(path.join(__dirname, 'migrations/0001_oneshot_claims.sql'), 'utf8');
    assert.ok(/CREATE TABLE IF NOT EXISTS oneshot_claims/.test(sql));
    assert.ok(/idempotency_key TEXT PRIMARY KEY/.test(sql));
    assert.ok(!/CREATE TABLE[^\n]*oneshot_claims/i.test(stripComments(SRC)),
      'src/index.js must never create oneshot_claims at runtime — the migration is required');
  });
  check('extractor prompt forbids SKU invention and treats the body as untrusted', () => {
    const fn = grab('extractOneshotFactsLLM');
    assert.ok(/Never output SKUs or part numbers/.test(fn));
    assert.ok(/untrusted data/.test(fn));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
