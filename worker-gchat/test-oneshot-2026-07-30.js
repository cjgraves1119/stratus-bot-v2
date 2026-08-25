// ONE-SHOT customer-to-quote — participant selection, ISR resolution,
// reviewed-plan binding, pinned-record cross-checks, and executeOneshot
// fail-closed validation (2026-07-30).
//
// Behavioural assertions run the REAL extracted helpers with stubbed I/O;
// source-level assertions cover wiring that needs live Zoho creds to exercise.
//
// Run: node worker-gchat/test-oneshot-2026-07-30.js

const fs = require('fs'), path = require('path'), assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const bad = (name, err) => { fail++; console.log(`  ✗ ${name}\n      ${err}`); };
function check(name, fn) { try { fn(); ok(name); } catch (e) { bad(name, e.message); } }
async function checkAsync(name, fn) { try { await fn(); ok(name); } catch (e) { bad(name, e.message); } }

// Brace-walking extractor (same pattern as test-quote-stage-and-contact-phone).
function grab(name) {
  // async first — `function X(` is a substring of `async function X(` and a
  // naive plain-first match strips the async keyword (breaks await).
  let start = SRC.indexOf(`async function ${name}(`);
  if (start === -1) start = SRC.indexOf(`function ${name}(`);
  assert.ok(start > -1, `${name} not found in source`);
  // Walk the PARAMETER parens first — destructured defaults like
  // ({ a = null } = {}) contain braces that would fool a naive brace walk.
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
function grabConstSet(name) {
  const start = SRC.indexOf(`const ${name} = new Set([`);
  assert.ok(start > -1, `${name} not found`);
  const end = SRC.indexOf(']);', start);
  return SRC.slice(start, end + 3);
}
// isPlaceholderName reads the module-level PLACEHOLDER_NAME_RE — grab the const
// line wherever the function rides along.
function grabPlaceholderDeps() {
  const line = SRC.split('\n').find((l) => l.startsWith('const PLACEHOLDER_NAME_RE = '));
  assert.ok(line, 'PLACEHOLDER_NAME_RE not found');
  return `${line}\n${grab('isPlaceholderName')}`;
}

// ── Load pure helpers ────────────────────────────────────────────────────────
const mod = { exports: {} };
new Function('module', [
  grabConstSet('CONSUMER_DOMAINS'),
  grabConstSet('ONESHOT_VENDOR_DOMAINS'),
  grab('sanitizeContactNameHint'),
  grab('selectCustomerFromParticipants'),
  grab('isZohoTrue'),
  grab('contactAccountMismatch'),
  grab('isDomainLike'),
  grab('isPlaceholderName'),
  'module.exports = { selectCustomerFromParticipants, isZohoTrue, contactAccountMismatch, isDomainLike, isPlaceholderName };'
].join('\n'))(mod);
const { selectCustomerFromParticipants, isZohoTrue, contactAccountMismatch } = mod.exports;

console.log('\n(1) selectCustomerFromParticipants — strict fail-closed invariant');

check('single external participant → resolved', () => {
  const r = selectCustomerFromParticipants([
    { email: 'chrisg@stratusinfosystems.com', name: 'Chris' },
    { email: 'barry@americanimplement.com', name: 'Barry' },
  ]);
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.contact.email, 'barry@americanimplement.com');
});

check('participant display name strips angle-bracketed and bare email tokens', () => {
  for (const name of [
    'Ron Jarman <ron.jarman@example.com>',
    'Ron Jarman ron.jarman@example.com',
    'Ron Jarman <mailto:ron.jarman@example.com>',
  ]) {
    const r = selectCustomerFromParticipants([{ email: 'ron.jarman@example.com', name }]);
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.contact.name, 'Ron Jarman', name);
    assert.ok(!r.contact.name.includes('@'), name);
  }
});

check('American Implement shape (cisco + johndeere + americanimplement) → ambiguous multiple_external_domains, vendor listed', () => {
  const r = selectCustomerFromParticipants([
    { email: 'jdisla@cisco.com', name: 'Josh Disla', role: 'sender' },
    { email: 'balloujoshr@johndeere.com', name: 'Josh Ballou' },
    { email: 'barry@americanimplement.com', name: 'Barry' },
  ]);
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.reason, 'multiple_external_domains');
  assert.strictEqual(r.candidates.length, 2);
  assert.ok(r.vendors.some((v) => v.email === 'jdisla@cisco.com'), 'cisco rep should be in vendors, never a candidate');
});

check('duplicate alias (same email, different case/name) → resolved, deduped', () => {
  const r = selectCustomerFromParticipants([
    { email: 'Barry@AmericanImplement.com', name: 'Barry' },
    { email: 'barry@americanimplement.com', name: 'Barry Fuller' },
  ]);
  assert.strictEqual(r.status, 'resolved');
  assert.strictEqual(r.candidates.length, 1);
});

check('two people on ONE domain → ambiguous multiple_people_same_domain', () => {
  const r = selectCustomerFromParticipants([
    { email: 'a@acme.com', name: 'A' },
    { email: 'b@acme.com', name: 'B' },
  ]);
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.reason, 'multiple_people_same_domain');
});

check('account-domain narrowing is a SUGGESTION only, never auto-commit', () => {
  const r = selectCustomerFromParticipants([
    { email: 'a@acme.com', name: 'A' },
    { email: 'x@other.com', name: 'X' },
  ], { accountWebsiteDomain: 'www.acme.com' });
  assert.strictEqual(r.status, 'ambiguous', 'must stay ambiguous even with a matching account domain');
  assert.ok(r.suggested && r.suggested.email === 'a@acme.com', 'matching-domain candidate should be suggested');
});

check('freemail + corp participant → ambiguous (freemail is a real candidate)', () => {
  const r = selectCustomerFromParticipants([
    { email: 'owner@gmail.com', name: 'Owner' },
    { email: 'it@acme.com', name: 'IT' },
  ]);
  assert.strictEqual(r.status, 'ambiguous');
  assert.strictEqual(r.candidates.length, 2);
});

check('vendor-only thread → none (never auto-fall-back to the Cisco rep)', () => {
  const r = selectCustomerFromParticipants([
    { email: 'jdisla@cisco.com', name: 'Josh' },
    { email: 'rep2@meraki.com', name: 'Rep' },
  ]);
  assert.strictEqual(r.status, 'none');
  assert.strictEqual(r.vendors.length, 2);
});

check('empty / no participants → none', () => {
  assert.strictEqual(selectCustomerFromParticipants([]).status, 'none');
  assert.strictEqual(selectCustomerFromParticipants(null).status, 'none');
});

console.log('\n(2) contactAccountMismatch');

check('different linked account → mismatch', () => {
  assert.strictEqual(contactAccountMismatch({ Account_Name: { id: '111' } }, '222'), true);
});
check('same account → no mismatch', () => {
  assert.strictEqual(contactAccountMismatch({ Account_Name: { id: '111' } }, '111'), false);
});
check('orphan contact (no Account_Name) → no mismatch', () => {
  assert.strictEqual(contactAccountMismatch({ Account_Name: null }, '111'), false);
  assert.strictEqual(contactAccountMismatch({}, '111'), false);
});
check('no account id yet → no mismatch', () => {
  assert.strictEqual(contactAccountMismatch({ Account_Name: { id: '111' } }, null), false);
});

console.log('\n(3) isZohoTrue');

check('true and "true" are true; everything else false', () => {
  assert.strictEqual(isZohoTrue(true), true);
  assert.strictEqual(isZohoTrue('true'), true);
  assert.strictEqual(isZohoTrue(false), false);
  assert.strictEqual(isZohoTrue('false'), false);
  assert.strictEqual(isZohoTrue(undefined), false);
  assert.strictEqual(isZohoTrue(null), false);
});

console.log('\n(4) resolveMerakiIsrByName — stubbed Zoho, fail-closed on 0/many');

function loadIsrResolver(rows, { throwErr = false } = {}) {
  const m = { exports: {} };
  new Function('module', 'zohoApiCall', `${grab('resolveMerakiIsrByName')}\nmodule.exports = resolveMerakiIsrByName;`)(
    m,
    async () => { if (throwErr) throw new Error('boom'); return { data: rows }; }
  );
  return m.exports;
}

(async () => {
  await checkAsync('0 rows → none', async () => {
    const r = await loadIsrResolver([])('Josh Disla', {});
    assert.strictEqual(r.status, 'none');
  });
  await checkAsync('1 partial match → resolved', async () => {
    const r = await loadIsrResolver([{ id: '1', Name: 'Josh Disla', Email: 'jdisla@cisco.com' }])('Josh', {});
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.rep.Email, 'jdisla@cisco.com');
  });
  await checkAsync('2 rows, one EXACT name → resolved to the exact match', async () => {
    const r = await loadIsrResolver([
      { id: '1', Name: 'Josh Disla', Email: 'jdisla@cisco.com' },
      { id: '2', Name: 'Josh Dislavic', Email: 'jdislavic@cisco.com' },
    ])('Josh Disla', {});
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.rep.id, '1');
  });
  await checkAsync('duplicate exact names → active record is preferred', async () => {
    const r = await loadIsrResolver([
      { id: 'old', Name: 'Josh Disla', Email: 'old@cisco.com', Inactive: true },
      { id: 'active', Name: 'Josh Disla', Email: 'jdisla@cisco.com', Inactive: false },
    ])('Josh Disla', {});
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.rep.id, 'active');
  });
  await checkAsync('inactive-only exact name → preserved for explicit reactivation gate', async () => {
    const r = await loadIsrResolver([
      { id: 'inactive', Name: 'Josh Disla', Email: 'old@cisco.com', Inactive: 'true' },
    ])('Josh Disla', {});
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.rep.id, 'inactive');
  });
  await checkAsync('2 rows, no exact → ambiguous with candidates', async () => {
    const r = await loadIsrResolver([
      { id: '1', Name: 'Josh Disla', Email: 'a@cisco.com' },
      { id: '2', Name: 'Josh Dillon', Email: 'b@cisco.com' },
    ])('Josh', {});
    assert.strictEqual(r.status, 'ambiguous');
    assert.strictEqual(r.candidates.length, 2);
  });
  await checkAsync('short query (<3 chars) → none, no API call', async () => {
    const r = await loadIsrResolver([{ id: '1', Name: 'Jo', Email: 'x@cisco.com' }])('Jo', {});
    assert.strictEqual(r.status, 'none');
  });
  await checkAsync('Zoho throw → error status (caller must not guess)', async () => {
    const r = await loadIsrResolver([], { throwErr: true })('Josh Disla', {});
    assert.strictEqual(r.status, 'error');
  });

  console.log('\n(4b) resolveMerakiIsrByEmail — exact-domain lookup, fail-closed on 0/many');

  function loadIsrEmailResolver(rows, { throwErr = false } = {}) {
    const m = { exports: {} };
    new Function('module', 'zohoApiCall', [
      grab('normalizeOneshotEmail'),
      grab('resolveMerakiIsrByEmail'),
      'module.exports = resolveMerakiIsrByEmail;',
    ].join('\n'))(
      m,
      async () => {
        if (throwErr) throw new Error('boom');
        return { data: rows };
      }
    );
    return m.exports;
  }

  await checkAsync('0 exact email rows → none', async () => {
    const r = await loadIsrEmailResolver([])('nobody@cisco.com', {});
    assert.strictEqual(r.status, 'none');
    assert.deepStrictEqual(r.candidates, []);
  });

  await checkAsync('1 exact email row → resolved', async () => {
    const r = await loadIsrEmailResolver([
      { id: 'ISR1', Name: 'Josh Disla', Email: 'JDISLA@CISCO.COM' },
    ])('jdisla@cisco.com', {});
    assert.strictEqual(r.status, 'resolved');
    assert.strictEqual(r.rep.id, 'ISR1');
  });

  await checkAsync('many exact email rows → ambiguous, never first-row wins', async () => {
    const r = await loadIsrEmailResolver([
      { id: 'ISR1', Name: 'Josh Disla', Email: 'jdisla@cisco.com' },
      { id: 'ISR2', Name: 'Duplicate Josh', Email: 'jdisla@cisco.com' },
    ])('jdisla@cisco.com', {});
    assert.strictEqual(r.status, 'ambiguous');
    assert.strictEqual(r.candidates.length, 2);
  });

  await checkAsync('non-Cisco/Meraki email → none without trusting a module row', async () => {
    const r = await loadIsrEmailResolver([
      { id: 'BAD', Name: 'Customer', Email: 'customer@acme.com' },
    ])('customer@acme.com', {});
    assert.strictEqual(r.status, 'none');
  });

  console.log('\n(4c) reviewed-plan token — caller + decision binding');

  function loadReviewHelpers() {
    const m = { exports: {} };
    new Function('module', [
      grab('base64url'),
      grab('base64UrlDecode'),
      grab('base64UrlToUint8Array'),
      grab('normalizeOneshotEmail'),
      grab('canonicalOneshotRecipients'),
      grab('canonicalOneshotSkus'),
      grab('oneshotReviewKey'),
      grab('buildOneshotReviewSnapshot'),
      grab('signOneshotReviewToken'),
      grab('readOneshotReviewToken'),
      grab('sameOneshotJson'),
      grab('validateOneshotReviewBinding'),
      'module.exports = { buildOneshotReviewSnapshot, signOneshotReviewToken, readOneshotReviewToken, validateOneshotReviewBinding };',
    ].join('\n'))(m);
    return m.exports;
  }

  const reviewHelpers = loadReviewHelpers();
  const reviewEnv = { ONESHOT_REVIEW_SECRET: 'unit-test-review-secret' };
  const reviewCaller = 'reviewer@stratusinfosystems.com';
  const reviewedInput = {
    source: 'renewal-card',
    lead_source: 'Meraki ISR Referal',
    participants: [
      { email: 'customer@acme.com', name: 'Acme Customer' },
      { email: 'rep@cisco.com', name: 'Cisco Rep' },
    ],
    skus: [{ sku: 'lic-ent-3yr', qty: 3 }],
  };
  const reviewedPlan = {
    lead_source: 'Meraki ISR Referal',
    customer: { contact: { email: 'customer@acme.com' } },
    account: { mode: 'existing', id: 'ACC1', name: 'Acme' },
    contact: { mode: 'existing', id: 'CON1', email: 'customer@acme.com' },
    deal: {
      mode: 'choose',
      open_deals: [{ id: 'DEAL1' }, { id: 'DEAL2' }],
    },
    isr: {
      status: 'resolved',
      rep: { id: 'ISR1', email: 'rep@cisco.com', inactive: false },
    },
  };
  const reviewedSnapshot = reviewHelpers.buildOneshotReviewSnapshot(
    reviewedPlan, [{ code: 'deal_choice' }], reviewedInput, reviewCaller
  );
  const reviewToken = await reviewHelpers.signOneshotReviewToken(reviewedSnapshot, reviewEnv);
  const reviewedExecute = {
    ...reviewedInput,
    review_token: reviewToken,
    account: { id: 'ACC1' },
    contact: { id: 'CON1' },
    deal: { existing_deal_id: 'DEAL1' },
    meraki_isr_email: 'rep@cisco.com',
  };

  await checkAsync('review signing and verification refuse the extension-visible API key fallback', async () => {
    await assert.rejects(
      () => reviewHelpers.signOneshotReviewToken(reviewedSnapshot, { GMAIL_ADDON_API_KEY: 'extension-visible-key' }),
      /oneshot_review_secret_missing/
    );
    const read = await reviewHelpers.readOneshotReviewToken(
      reviewToken,
      { GMAIL_ADDON_API_KEY: 'extension-visible-key' },
      reviewCaller
    );
    assert.strictEqual(read.success, false);
    assert.strictEqual(read.error, 'review_unavailable');
    assert.ok(!/GMAIL_ADDON_API_KEY/.test(grab('oneshotReviewKey')));
  });

  await checkAsync('valid token binds caller and every reviewed decision', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding(
      reviewedExecute, reviewEnv, reviewCaller
    );
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.review.customer_email, 'customer@acme.com');
  });

  await checkAsync('token is caller-bound', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding(
      reviewedExecute, reviewEnv, 'someone-else@stratusinfosystems.com'
    );
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error, 'review_caller_mismatch');
  });

  await checkAsync('tampered token is rejected before binding checks', async () => {
    const parts = reviewToken.split('.');
    parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
    const r = await reviewHelpers.validateOneshotReviewBinding(
      { ...reviewedExecute, review_token: parts.join('.') }, reviewEnv, reviewCaller
    );
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error, 'review_invalid');
  });

  await checkAsync('recipient-set change → review_mismatch', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding({
      ...reviewedExecute,
      participants: [{ email: 'customer@acme.com' }],
    }, reviewEnv, reviewCaller);
    assert.strictEqual(r.error, 'review_mismatch');
    assert.ok(r.missing.includes('recipients changed after review'));
  });

  await checkAsync('SKU or quantity change → review_mismatch', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding({
      ...reviewedExecute,
      skus: [{ sku: 'LIC-ENT-3YR', qty: 4 }],
    }, reviewEnv, reviewCaller);
    assert.strictEqual(r.error, 'review_mismatch');
    assert.ok(r.missing.includes('quote lines changed after review'));
  });

  await checkAsync('HA license recalculation choice is bound into the review token', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding({
      ...reviewedExecute,
      ha_mode: 'warm_spare',
      ha_recalculate_license_qty: true,
    }, reviewEnv, reviewCaller);
    assert.strictEqual(r.error, 'review_mismatch');
    assert.ok(r.missing.includes('quote workflow options changed after review'));
  });

  await checkAsync('unreviewed Deal choice → review_mismatch', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding({
      ...reviewedExecute,
      deal: { existing_deal_id: 'DEAL-NOT-REVIEWED' },
    }, reviewEnv, reviewCaller);
    assert.strictEqual(r.error, 'review_mismatch');
    assert.ok(r.missing.includes('Deal was not one of the reviewed open Deals'));
  });

  await checkAsync('unreviewed ISR choice → review_mismatch', async () => {
    const r = await reviewHelpers.validateOneshotReviewBinding({
      ...reviewedExecute,
      meraki_isr_email: 'different-rep@cisco.com',
    }, reviewEnv, reviewCaller);
    assert.strictEqual(r.error, 'review_mismatch');
    assert.ok(r.missing.includes('Cisco/Meraki ISR was not verified in the reviewed plan'));
  });

  console.log('\n(5) executeOneshot — fail-closed validation + tool mapping');

  const attachGuardModule = { exports: {} };
  new Function('module', [
    grab('validateOneshotAttachTarget'),
    'module.exports = validateOneshotAttachTarget;',
  ].join('\n'))(attachGuardModule);
  const validateAttachTarget = attachGuardModule.exports;

  check('reviewed attach target must remain open with the same Account and Contact', () => {
    const expected = { deal_id: 'D1', account_id: 'A1', contact_id: 'C1' };
    const current = {
      id: 'D1', Stage: 'Qualification',
      Account_Name: { id: 'A1' }, Contact_Name: { id: 'C1' },
    };
    assert.strictEqual(validateAttachTarget(current, expected).success, true);
    assert.strictEqual(validateAttachTarget({ ...current, Stage: 'Closed (Won)' }, expected).error, 'deal_not_open');
    assert.strictEqual(validateAttachTarget({ ...current, Account_Name: { id: 'A2' } }, expected).error, 'reviewed_deal_target_changed');
    assert.strictEqual(validateAttachTarget({ ...current, Contact_Name: { id: 'C2' } }, expected).error, 'reviewed_deal_target_changed');
  });

  function loadExecuteOneshot({
    kvInit = {},
    responses = null,
    reviewResult = { success: true, review: { product_snapshot: { plan_id: 'P1', snapshot_hash: 'H1', catalog_version: 'C1' } } },
  } = {}) {
    const calls = [];
    const kv = new Map(Object.entries(kvInit));
    const puts = [];
    const m = { exports: {} };
    const stubs = [
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', nextMonthEnd: '2026-08-31', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('isDomainLike'),
      grabPlaceholderDeps(),
      `const validateOneshotReviewBinding = async () => __reviewResult;`,
      `const validateOneshotProductSnapshotForExecute = async (snapshot) => ({ success: true, snapshot });`,
      `const ONESHOT_PRODUCT_SNAPSHOT_CAPABILITY = Symbol('test-oneshot-snapshot');`,
      `const ONESHOT_ATTACH_TARGET_CAPABILITY = Symbol('test-oneshot-attach-target');`,
      // D1 claim mutex (2026-07-31) is exercised by its own focused suite
      // (test-oneshot-intake-2026-07-31.js); here it stays permissive so these
      // cases keep testing validation + tool mapping in isolation.
      `const claimOneshotExecution = async () => ({ ok: true });`,
      `const settleOneshotClaim = async () => {};`,
      // Programmable per-call responses: __responses[i] answers the i-th tool
      // call; the last entry repeats. Default = full success.
      `const executeToolCall = async (tool, input) => { __calls.push({ tool, input }); const r = __responses ? __responses[Math.min(__calls.length - 1, __responses.length - 1)] : null; return r || { success: true, records: { deal: { id: 'D1', url: 'u' }, quote: { id: 'Q1', url: 'u' } } }; };`,
      grab('executeOneshot'),
      'module.exports = executeOneshot;'
    ].join('\n');
    new Function('module', '__calls', '__responses', '__reviewResult', stubs)(
      m, calls, responses, reviewResult
    );
    const env = {
      CONVERSATION_KV: {
        get: async (k) => { const v = kv.get(k); return v === undefined ? null : (typeof v === 'string' ? JSON.parse(v) : v); },
        put: async (k, v) => { kv.set(k, typeof v === 'string' ? v : JSON.stringify(v)); puts.push([k, v]); },
      },
    };
    return { run: (input) => m.exports(input, env, 'test@stratusinfosystems.com'), calls, kv, puts };
  }

  await checkAsync('empty input → oneshot_invalid listing every missing decision', async () => {
    const { run } = loadExecuteOneshot();
    const r = await run({});
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.error, 'oneshot_invalid');
    for (const want of ['idempotency_key', 'skus', 'closing_date', 'account ({id} or {create})', 'contact ({id} or {create})', 'deal ({existing_deal_id} or {new:true})']) {
      assert.ok(r.missing.some((mi) => mi.startsWith(want.split(' ')[0])), `missing[] should name ${want}`);
    }
  });

  await checkAsync('review rejection halts before validation, KV, or any write tool', async () => {
    const { run, calls, puts } = loadExecuteOneshot({
      reviewResult: {
        success: false,
        error: 'review_mismatch',
        missing: ['recipients changed after review'],
      },
    });
    const r = await run({});
    assert.strictEqual(r.error, 'review_mismatch');
    assert.deepStrictEqual(r.missing, ['recipients changed after review']);
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(puts.length, 0);
  });

  await checkAsync('missing signed product snapshot halts before KV or any write tool', async () => {
    const { run, calls, puts } = loadExecuteOneshot({ reviewResult: { success: true, review: {} } });
    const r = await run({});
    assert.strictEqual(r.error, 'product_review_required');
    assert.strictEqual(calls.length, 0);
    assert.strictEqual(puts.length, 0);
  });

  const validNewDeal = {
    idempotency_key: 'mdr:test-123',
    skus: [{ sku: 'LIC-ENT-3YR', qty: 3 }],
    license_term: '3',
    renewal: true,
    closing_date: '2026-07-25',
    account: { id: '2570562000000001', name: 'Acme Co' },
    contact: { id: '2570562000000002' },
    deal: { new: true, confirmed: true },
    lead_source: 'Stratus Referal',
  };

  await checkAsync('valid new-deal payload → create_deal_and_quote with pinned ids, strict_contact, confirm+force flags', async () => {
    const { run, calls } = loadExecuteOneshot();
    const r = await run(validNewDeal);
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].tool, 'create_deal_and_quote');
    assert.strictEqual(calls[0].input.account_id, '2570562000000001');
    assert.strictEqual(calls[0].input.contact_id, '2570562000000002');
    assert.strictEqual(calls[0].input.strict_contact, true);
    assert.strictEqual(calls[0].input.confirm_new_deal, true);
    assert.strictEqual(calls[0].input.force_new_deal, true);
  });

  await checkAsync('new-deal WITHOUT deal.confirmed → invalid', async () => {
    const { run } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, deal: { new: true } });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((mi) => mi.includes('deal.confirmed')));
  });

  await checkAsync('attach mode → create_quote_on_deal with deal_id, no account pin, and EXPLICIT confirm_attach', async () => {
    const { run, calls } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, deal: { existing_deal_id: 'DEAL9' } });
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls[0].tool, 'create_quote_on_deal');
    assert.strictEqual(calls[0].input.deal_id, 'DEAL9');
    assert.strictEqual(calls[0].input.strict_contact, true);
    assert.strictEqual(calls[0].input.confirm_attach, true, 'the card deal choice must satisfy the attach gate');
    const attachTarget = Object.getOwnPropertySymbols(calls[0].input)
      .map((symbol) => calls[0].input[symbol])
      .find((value) => value?.deal_id === 'DEAL9');
    assert.deepStrictEqual(attachTarget, {
      deal_id: 'DEAL9',
      account_id: '2570562000000001',
      contact_id: '2570562000000002',
    });
  });

  await checkAsync('create-account mode requires FULL billing; placeholder name rejected', async () => {
    const { run } = loadExecuteOneshot();
    const r1 = await run({ ...validNewDeal, account: { create: { name: 'New Co', billing: { street: '1 Main', city: 'Wichita' } } } });
    assert.strictEqual(r1.error, 'oneshot_invalid');
    assert.ok(r1.missing.some((mi) => mi.includes('billing.state')));
    const r2 = await run({ ...validNewDeal, account: { create: { name: 'Company Name', billing: { street: '1 Main', city: 'W', state: 'KS', zip: '67226', country: 'United States' } } } });
    assert.strictEqual(r2.error, 'oneshot_invalid');
    assert.ok(r2.missing.some((mi) => mi.includes('placeholder')));
  });

  await checkAsync('create-account + EXISTING contact → invalid (orphan-account sequence blocked)', async () => {
    const { run, calls } = loadExecuteOneshot();
    const r = await run({
      ...validNewDeal,
      account: { create: { name: 'New Co', billing: { street: '1 Main', city: 'W', state: 'KS', zip: '67226', country: 'United States' } } },
      contact: { id: '2570562000000002' },
    });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((mi) => mi.includes('existing contact belongs to its own Account')));
    assert.strictEqual(calls.length, 0, 'no tool call may happen — nothing created');
  });

  await checkAsync('structured first/last contact (Account-name/IT fallback) maps through UNSPLIT', async () => {
    const { run, calls } = loadExecuteOneshot();
    const r = await run({
      ...validNewDeal,
      contact: { create: { first_name: 'American Implement', last_name: 'IT', email: 'barry@americanimplement.com' } },
    });
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls[0].input.contact_first_name, 'American Implement', 'whole account name must survive as First_Name');
    assert.strictEqual(calls[0].input.contact_last_name, 'IT');
    assert.strictEqual(calls[0].input.contact_name, 'American Implement IT');
    assert.strictEqual(calls[0].input.contact_email, 'barry@americanimplement.com');
  });

  await checkAsync('email-bearing structured Contact name is rejected before any write tool', async () => {
    const { run, calls, puts } = loadExecuteOneshot();
    const r = await run({
      ...validNewDeal,
      contact: { create: { first_name: 'Ron', last_name: 'Jarman ron.jarman@example.com', email: 'ron.jarman@example.com' } },
    });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((item) => item.includes('email address rejected from name fields')));
    assert.strictEqual(calls.length, 0, 'no CRM tool may run');
    assert.strictEqual(puts.length, 0, 'validation must stop before any idempotency/stage write');
  });

  await checkAsync('contact.create with NEITHER name nor first/last → invalid', async () => {
    const { run } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, contact: { create: { email: 'x@y.com' } } });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((mi) => mi.includes('first_name+last_name')));
  });

  await checkAsync('Meraki ISR Referal without meraki_isr_email → invalid', async () => {
    const { run } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, lead_source: 'Meraki ISR Referal' });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((mi) => mi.includes('meraki_isr_email')));
  });

  await checkAsync('closing_date past fiscal quarter end without explicit confirmation → invalid', async () => {
    const { run } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, closing_date: '2026-08-15' });
    assert.strictEqual(r.error, 'oneshot_invalid');
    assert.ok(r.missing.some((mi) => mi.includes('date_beyond_quarter_confirmed')));
  });

  await checkAsync('idempotent replay: stored success returns replayed:true without touching the tool', async () => {
    const { run, calls } = loadExecuteOneshot({ kvInit: { 'oneshot:mdr:test-123': { success: true, records: { deal: { id: 'D-old' } } } } });
    const r = await run(validNewDeal);
    assert.strictEqual(r.replayed, true);
    assert.strictEqual(r.records.deal.id, 'D-old');
    assert.strictEqual(calls.length, 0);
  });

  console.log('\n(5c) stage-resume — failure after each stage must NOT duplicate CRM records');

  await checkAsync('quote-stage failure persists the stage; retry ATTACHES to the stored deal (no duplicate Deal)', async () => {
    const fail = { success: false, error: 'quote_create_verify_failed', records: { account: { id: 'A9' }, contact: { id: 'C9' }, deal: { id: 'D9', url: 'du' } } };
    const first = loadExecuteOneshot({ responses: [fail] });
    const r1 = await first.run(validNewDeal);
    assert.strictEqual(r1.success, false);
    const stageRaw = first.kv.get('oneshot-stage:mdr:test-123');
    assert.ok(stageRaw, 'stage ledger must be written on failure');
    const stage = JSON.parse(stageRaw);
    assert.strictEqual(stage.deal_id, 'D9');
    assert.strictEqual(stage.quote_id, null);
    // Retry with the SAME decisions (deal: new+confirmed) — must resume, not recreate.
    const second = loadExecuteOneshot({ kvInit: { 'oneshot-stage:mdr:test-123': stageRaw } });
    const r2 = await second.run(validNewDeal);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(second.calls.length, 1);
    assert.strictEqual(second.calls[0].tool, 'create_quote_on_deal', 'retry must attach, never create_deal_and_quote again');
    assert.strictEqual(second.calls[0].input.deal_id, 'D9');
    assert.ok(Array.isArray(r2.resumed) && r2.resumed.some((s) => s.includes('D9')), 'result should surface the resume');
  });

  await checkAsync('deal-stage failure (account+contact created): retry pins the stored ids, no create branches re-run', async () => {
    const createInput = {
      ...validNewDeal,
      account: { create: { name: 'New Co', billing: { street: '1 Main', city: 'W', state: 'KS', zip: '67226', country: 'United States' } } },
      contact: { create: { name: 'Barry', email: 'barry@newco.com' } },
    };
    const fail = { success: false, error: 'deal_create_failed', records: { account: { id: 'A7' }, contact: { id: 'C7' } } };
    const first = loadExecuteOneshot({ responses: [fail] });
    const r1 = await first.run(createInput);
    assert.strictEqual(r1.success, false);
    const stageRaw = first.kv.get('oneshot-stage:mdr:test-123');
    const stage = JSON.parse(stageRaw);
    assert.strictEqual(stage.account_id, 'A7');
    assert.strictEqual(stage.contact_id, 'C7');
    assert.strictEqual(stage.deal_id, null);
    const second = loadExecuteOneshot({ kvInit: { 'oneshot-stage:mdr:test-123': stageRaw } });
    const r2 = await second.run(createInput);
    assert.strictEqual(r2.success, true);
    assert.strictEqual(second.calls[0].tool, 'create_deal_and_quote');
    assert.strictEqual(second.calls[0].input.account_id, 'A7', 'account must be pinned, not re-created');
    assert.strictEqual(second.calls[0].input.contact_id, 'C7', 'contact must be pinned, not re-created');
    assert.strictEqual(second.calls[0].input.billing_address, undefined, 'create branch must not re-run');
    assert.strictEqual(second.calls[0].input.contact_email, undefined, 'contact create branch must not re-run');
  });

  await checkAsync('full success stores BOTH the final result and the complete stage ledger', async () => {
    const { run, kv } = loadExecuteOneshot({ responses: [{ success: true, records: { account: { id: 'A1' }, contact: { id: 'C1' }, deal: { id: 'D1' }, quote: { id: 'Q1' } } }] });
    const r = await run(validNewDeal);
    assert.strictEqual(r.success, true);
    assert.ok(kv.get('oneshot:mdr:test-123'), 'final result stored for replay');
    const stage = JSON.parse(kv.get('oneshot-stage:mdr:test-123'));
    assert.strictEqual(stage.quote_id, 'Q1');
    assert.strictEqual(stage.deal_id, 'D1');
  });

  console.log('\n(5b) buildOneshotPlan — pairing + placeholder review fixtures');

  function grabConstArray(name) {
    const start = SRC.indexOf(`const ${name} = [`);
    assert.ok(start > -1, `${name} not found`);
    const end = SRC.indexOf('];', start);
    return SRC.slice(start, end + 2);
  }

  function loadBuildPlan({
    waterfallAccount = null,
    contactByEmail = null,
    openDeals = [],
    isrRowsByEmail = {},
    pinnedDeal = null,
    pinnedDealContact = null,
    enrichmentResult = null,
  } = {}) {
    const m = { exports: {} };
    const cfg = { waterfallAccount, contactByEmail, openDeals, isrRowsByEmail, pinnedDeal, pinnedDealContact, enrichmentResult };
    const stubs = [
      grabConstSet('CONSUMER_DOMAINS'),
      grabConstSet('ONESHOT_VENDOR_DOMAINS'),
      grabConstArray('REQUIRED_ACCOUNT_FIELDS'),
      grab('base64url'),
      grab('isDomainLike'),
      grab('getMissingAccountFields'),
      grab('sanitizeContactNameHint'),
      grab('selectCustomerFromParticipants'),
      grab('isZohoTrue'),
      grab('normalizeOneshotEmail'),
      grab('_titleCaseNameToken'),
      grab('deriveContactNameFields'),
      grab('canonicalOneshotRecipients'),
      grab('canonicalOneshotSkus'),
      grab('oneshotReviewKey'),
      grab('buildOneshotReviewSnapshot'),
      grab('signOneshotReviewToken'),
      grab('normalizeOneshotAccountPrefill'),
      grab('oneshotEnrichmentCandidate'),
      grab('compareOneshotEnrichment'),
      `const fetchAccountById = async () => __cfg.waterfallAccount;`,
      `const resolveAccountWaterfall = async (args) => { __cfg.wfArgs = args; return (__cfg.waterfallAccount ? { account: __cfg.waterfallAccount, confidence: 'high', source: 'test' } : null); };`,
      `const enrichCompanyV2 = async () => null;`,
      `const resolveContactByEmail = async () => __cfg.contactByEmail;`,
      `const zohoApiCall = async (method, pathArg) => {
        const apiPath = String(pathArg);
        if (apiPath.startsWith('Deals/')) return { data: __cfg.pinnedDeal ? [__cfg.pinnedDeal] : [] };
        if (apiPath.startsWith('Contacts/')) return { data: __cfg.pinnedDealContact ? [__cfg.pinnedDealContact] : [] };
        if (apiPath === 'coql') return { data: __cfg.openDeals };
        if (apiPath.startsWith('Meraki_ISRs/search?criteria=')) {
          const match = apiPath.match(/\\(Email:equals:([^\\)]+)\\)/);
          const email = match ? decodeURIComponent(match[1]).toLowerCase() : '';
          const rows = __cfg.isrRowsByEmail[email];
          if (rows && rows.throw) throw new Error('stubbed ISR read failure');
          return { data: Array.isArray(rows) ? rows : [] };
        }
        return { data: [] };
      };`,
      grab('resolveMerakiIsrByName'),
      grab('resolveMerakiIsrByEmail'),
      `const executeToolCall = async (tool, input) => { const out = {}; for (const s of input.skus) out[s.sku] = { suffixed_sku: s.sku, found: true, ecomm_price: 100, list_price: 150, product_active: true }; return { products: out }; };`,
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('buildOneshotPlan'),
      'module.exports = buildOneshotPlan;'
    ].join('\n');
    new Function('module', '__cfg', stubs)(m, cfg);
    const run = (input) => m.exports(
      input,
      { ONESHOT_REVIEW_SECRET: 'test-review-secret' },
      'test@stratusinfosystems.com',
      {},
      async () => cfg.enrichmentResult,
    );
    run.cfg = cfg;
    return run;
  }

  const FULL_ACCOUNT = {
    id: 'ACC1', Account_Name: 'American Implement', Website: 'www.americanimplement.com',
    Billing_Street: '1 Main', Billing_City: 'Wichita', Billing_State: 'KS',
    Billing_Code: '67226', Billing_Country: 'United States',
  };

  await checkAsync('explicit Cisco/Meraki recipient is rejected as a customer Contact', async () => {
    for (const vendorEmail of ['jdisla@cisco.com', 'renewals@meraki.com']) {
      const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
        skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
        participants: [
          { email: 'customer@americanimplement.com', name: 'Customer' },
          { email: vendorEmail, name: 'Vendor Rep' },
        ],
        contact_email: vendorEmail.toUpperCase(),
      });
      assert.strictEqual(plan.success, false, vendorEmail);
      assert.strictEqual(plan.error, 'contact_not_eligible', vendorEmail);
      assert.strictEqual(plan.blockers[0].code, 'contact_not_eligible', vendorEmail);
      assert.strictEqual(plan.blockers[0].vendor, true, vendorEmail);
    }
  });

  await checkAsync('editable Account name supplies Account-name + IT Contact defaults when recipient name is unknown', async () => {
    const plan = await loadBuildPlan()({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'billing@marlettefunding.com', name: '' }],
      account_name: 'Marlette Funding',
      enrich: false,
    });
    assert.strictEqual(plan.success, true);
    assert.strictEqual(plan.plan.account.mode, 'create');
    assert.strictEqual(plan.plan.account.prefill.name, 'Marlette Funding');
    assert.deepStrictEqual(plan.plan.contact.defaults, {
      first_name: 'Marlette Funding',
      last_name: 'IT',
      account_it_fallback: true,
    });
    assert.ok(!plan.blockers.some((b) => b.code === 'contact_name_required'));
  });

  await checkAsync('single-token contact name → create mode with SURFACED last-name placeholder, zero blockers', async () => {
    const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 3 }],
      participants: [{ email: 'barry@americanimplement.com', name: 'Barry' }],
    });
    assert.strictEqual(plan.success, true);
    assert.strictEqual(plan.plan.contact.mode, 'create');
    assert.strictEqual(plan.plan.contact.last_name_placeholder, true, 'placeholder must be surfaced in the plan');
    assert.deepStrictEqual(plan.blockers, [], `expected no blockers, got ${JSON.stringify(plan.blockers)}`);
  });

  await checkAsync('Ron Jarman display text never leaks its email into one-shot Last_Name defaults', async () => {
    for (const name of [
      'Ron Jarman <ron.jarman@example.com>',
      'Ron Jarman ron.jarman@example.com',
    ]) {
      const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
        skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
        participants: [{ email: 'ron.jarman@americanimplement.com', name }],
      });
      assert.deepStrictEqual(plan.plan.contact.defaults, {
        first_name: 'Ron',
        last_name: 'Jarman',
        from_real_name: true,
      });
      assert.ok(!JSON.stringify(plan.plan.contact.defaults).includes('@'), name);
    }
  });

  await checkAsync('email-only display name uses the obvious local-part first/last pattern', async () => {
    const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'ron.jarman@americanimplement.com', name: '<ron.jarman@americanimplement.com>' }],
    });
    assert.deepStrictEqual(plan.plan.contact.defaults, {
      first_name: 'Ron',
      last_name: 'Jarman',
    });
    assert.ok(!JSON.stringify(plan.plan.contact.defaults).includes('@'));
  });

  await checkAsync('explicitly selected jason.rice participant becomes Jason Rice without guessing among recipients', async () => {
    const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [
        { email: 'jason.rice@omahazoo.com', name: 'jason.rice' },
        { email: 'scott.carrier@omahazoo.com', name: 'scott.carrier' },
        { email: 'mitch.anderson@omahazoo.com', name: 'mitch.anderson' },
      ],
      contact_email: 'jason.rice@omahazoo.com',
    });
    assert.strictEqual(plan.plan.customer.status, 'explicit');
    assert.strictEqual(plan.plan.contact.email, 'jason.rice@omahazoo.com');
    assert.deepStrictEqual(plan.plan.contact.defaults, {
      first_name: 'Jason',
      last_name: 'Rice',
    });
    assert.strictEqual(plan.plan.contact.last_name_placeholder, undefined);
  });

  await checkAsync('create-account + contact linked to ANOTHER account → contact_linked_elsewhere blocker', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: null,
      contactByEmail: { id: 'C1', Full_Name: 'Josh Ballou', Email: 'balloujoshr@johndeere.com', Account_Name: { id: 'ACC-JD', name: 'John Deere' } },
    })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'balloujoshr@johndeere.com', name: 'Josh Ballou' }],
      enrich: false,
    });
    assert.strictEqual(plan.plan.account.mode, 'create');
    assert.ok(plan.blockers.some((b) => b.code === 'account_create_review'));
    const linked = plan.blockers.find((b) => b.code === 'contact_linked_elsewhere');
    assert.ok(linked, 'contact_linked_elsewhere blocker required');
    assert.strictEqual(linked.contact_account_name, 'John Deere');
    assert.strictEqual(plan.plan.contact.linked_account.id, 'ACC-JD');
  });

  await checkAsync('Marlette proof: participants-only input → waterfall gets NO nameHint, no existing account attaches, create prefilled without a name', async () => {
    const run = loadBuildPlan();
    const plan = await run({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'billing@marlettefunding.com', name: '' }],
      enrich: false,
      // NOTE: no account_name — the dashboard no longer sends the card org.
    });
    assert.strictEqual(run.cfg.wfArgs.nameHint, undefined, 'card/org name must never reach the waterfall as a lookup hint');
    assert.strictEqual(run.cfg.wfArgs.domain, 'marlettefunding.com', 'recipient domain is the lookup authority');
    assert.strictEqual(plan.plan.account.mode, 'create', 'no trustworthy domain match → CREATE review, never a similar-name attach');
    assert.strictEqual(plan.plan.account.prefill.name, '', 'engine leaves the name empty for the dashboard display-only backfill');
  });

  await checkAsync('business-email contact surname is never reused as an Account fuzzy-search hint', async () => {
    const run = loadBuildPlan();
    const plan = await run({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 2 }],
      participants: [{ email: 'sean@palonix.example', name: 'Sean Carpenter' }],
      enrich: false,
    });
    assert.strictEqual(run.cfg.wfArgs.domain, 'palonix.example');
    assert.strictEqual(run.cfg.wfArgs.email, 'sean@palonix.example');
    assert.strictEqual(
      run.cfg.wfArgs.nameHint,
      undefined,
      'a person name must not trigger Account_Name:starts_with:carpenter after exact email/domain lookup misses',
    );
    assert.strictEqual(plan.plan.account.mode, 'create');
    assert.ok(plan.blockers.some((b) => b.code === 'account_create_review'));
  });

  await checkAsync('domain miss follows the Zoho-tab pattern: enriched Account draft plus separate Contact draft', async () => {
    const run = loadBuildPlan({
      enrichmentResult: {
        name: 'Palonix Example',
        address: '3971 Example Rd PMB 183',
        city: 'Grove City',
        state: 'OH',
        zip: '43123',
        country: 'United States',
        website: 'palonix.example',
        source: 'synthetic-web-enrichment',
        confidence: 0.9,
      },
    });
    const result = await run({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 2 }],
      participants: [{ email: 'sean@palonix.example', name: 'Sean Carpenter' }],
    });
    assert.strictEqual(result.plan.account.mode, 'create');
    assert.strictEqual(
      result.plan.account.prefill.enrich_error,
      undefined,
      `enrichment failed in the plan harness: ${result.plan.account.prefill.enrich_error || 'unknown'}`,
    );
    assert.deepStrictEqual(
      {
        name: result.plan.account.prefill.name,
        street: result.plan.account.prefill.street,
        city: result.plan.account.prefill.city,
        state: result.plan.account.prefill.state,
        zip: result.plan.account.prefill.zip,
        website: result.plan.account.prefill.website,
      },
      {
        name: 'Palonix Example',
        street: '3971 Example Rd PMB 183',
        city: 'Grove City',
        state: 'OH',
        zip: '43123',
        website: 'www.palonix.example',
      },
      'domain enrichment should fill only the reviewed create-Account draft',
    );
    assert.strictEqual(result.plan.contact.mode, 'create');
    assert.strictEqual(result.plan.contact.email, 'sean@palonix.example');
    assert.deepStrictEqual(result.plan.contact.defaults, {
      first_name: 'Sean',
      last_name: 'Carpenter',
      from_real_name: true,
    });
    assert.ok(result.blockers.some((b) => b.code === 'account_create_review'));
    assert.ok(!result.blockers.some((b) => b.code === 'account_confirm'));
  });

  await checkAsync('open deals present → deal_choice blocker with the list', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      openDeals: [{ id: 'D1', Deal_Name: 'AI - Renewal', Stage: 'Proposal', Amount: 5000 }],
    })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'barry@americanimplement.com', name: 'Barry Fuller' }],
    });
    assert.strictEqual(plan.plan.deal.mode, 'choose');
    const b = plan.blockers.find((x) => x.code === 'deal_choice');
    assert.ok(b && b.open_deals.length === 1);
  });

  await checkAsync('explicit pinned open Deal resolves its existing Account and Contact without email participants', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D1', Deal_Name: 'Synthetic Existing Deal', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
        Owner: { id: 'OWNER1', name: 'Chris Graves' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: 'barry@americanimplement.com',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({
      skus: [{ sku: 'MX85', qty: 2 }],
      participants: [],
      existing_deal_id: 'D1',
      account_id: 'ACC1',
    });
    assert.strictEqual(plan.success, true);
    assert.strictEqual(plan.plan.account.id, 'ACC1');
    assert.strictEqual(plan.plan.contact.id, 'C1');
    assert.strictEqual(plan.plan.customer.status, 'pinned_deal');
    assert.strictEqual(plan.plan.deal.mode, 'attach');
    assert.strictEqual(plan.plan.deal.existing_deal_id, 'D1');
    assert.ok(!plan.blockers.some((b) => ['missing_contact', 'deal_not_readable', 'deal_not_open'].includes(b.code)));
  });

  await checkAsync('pinned Deal never substitutes a participant when its linked Contact is unreadable', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D1', Deal_Name: 'Synthetic Existing Deal', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C-DEAL', name: 'Deal Contact' },
      },
      pinnedDealContact: null,
      contactByEmail: {
        id: 'C-OTHER', Full_Name: 'Other Contact', Email: 'other@americanimplement.com',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({
      skus: [{ sku: 'MX85', qty: 2 }],
      participants: [{ email: 'other@americanimplement.com', name: 'Other Contact' }],
      contact_email: 'other@americanimplement.com',
      existing_deal_id: 'D1',
      account_id: 'ACC1',
    });
    assert.ok(plan.blockers.some((b) => b.code === 'pinned_deal_contact_not_readable'));
    assert.ok(plan.blockers.some((b) => b.code === 'missing_contact'));
    assert.strictEqual(plan.plan.contact, undefined, 'participant Contact must not replace the Deal Contact');
  });

  await checkAsync('pinned Deal hard-blocks missing Account or Contact lookups instead of falling back', async () => {
    const missingContact = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D-NO-CONTACT', Deal_Name: 'Missing Contact', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({
      skus: [{ sku: 'MX85', qty: 2 }],
      participants: [{ email: 'other@americanimplement.com', name: 'Other Contact' }],
      existing_deal_id: 'D-NO-CONTACT',
      account_id: 'ACC1',
    });
    assert.ok(missingContact.blockers.some((b) => b.code === 'pinned_deal_contact_missing'));
    assert.strictEqual(missingContact.plan.contact, undefined);

    const missingAccount = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D-NO-ACCOUNT', Deal_Name: 'Missing Account', Stage: 'Qualification',
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: 'barry@americanimplement.com',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({
      skus: [{ sku: 'MX85', qty: 2 }],
      existing_deal_id: 'D-NO-ACCOUNT',
      account_id: 'ACC1',
    });
    assert.ok(missingAccount.blockers.some((b) => b.code === 'pinned_deal_account_missing'));
    assert.strictEqual(missingAccount.plan.account, undefined, 'requested Account must not replace a missing Deal Account');
  });

  await checkAsync('pinned Deal hard-blocks a linked Contact without a usable email or on another Account', async () => {
    const noEmail = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D1', Deal_Name: 'Synthetic Existing Deal', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: '',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({ skus: [{ sku: 'MX85', qty: 2 }], existing_deal_id: 'D1', account_id: 'ACC1' });
    assert.ok(noEmail.blockers.some((b) => b.code === 'pinned_deal_contact_email_missing'));

    const wrongAccount = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D1', Deal_Name: 'Synthetic Existing Deal', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: 'barry@americanimplement.com',
        Account_Name: { id: 'ACC2', name: 'Different Account' },
      },
    })({ skus: [{ sku: 'MX85', qty: 2 }], existing_deal_id: 'D1', account_id: 'ACC1' });
    assert.ok(wrongAccount.blockers.some((b) => b.code === 'pinned_deal_contact_mismatch'));

    const orphan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D1', Deal_Name: 'Synthetic Existing Deal', Stage: 'Qualification',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: 'barry@americanimplement.com',
        Account_Name: null,
      },
    })({ skus: [{ sku: 'MX85', qty: 2 }], existing_deal_id: 'D1', account_id: 'ACC1' });
    assert.ok(orphan.blockers.some((b) => b.code === 'pinned_deal_contact_account_missing'));
  });

  await checkAsync('pinned closed Deal remains read-only and blocks Execute', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      pinnedDeal: {
        id: 'D-CLOSED', Deal_Name: 'Closed Test', Stage: 'Closed (Lost)',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
        Contact_Name: { id: 'C1', name: 'Barry Fuller' },
      },
      pinnedDealContact: {
        id: 'C1', Full_Name: 'Barry Fuller', Email: 'barry@americanimplement.com',
        Account_Name: { id: 'ACC1', name: 'American Implement' },
      },
    })({ skus: [{ sku: 'MX85', qty: 2 }], existing_deal_id: 'D-CLOSED', account_id: 'ACC1' });
    assert.ok(plan.blockers.some((b) => b.code === 'deal_not_open'));
  });

  await checkAsync('0 Cisco/Meraki participants → ISR remains not_required', async () => {
    const plan = await loadBuildPlan({ waterfallAccount: FULL_ACCOUNT })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'barry@americanimplement.com', name: 'Barry Fuller' }],
    });
    assert.strictEqual(plan.plan.isr.status, 'not_required');
    assert.ok(!plan.blockers.some((b) => b.code.startsWith('isr_')));
  });

  await checkAsync('1 Cisco/Meraki participant + 1 exact module record → ISR resolves', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      isrRowsByEmail: {
        'jdisla@cisco.com': [
          { id: 'ISR1', Name: 'Josh Disla', Email: 'jdisla@cisco.com', Inactive: false },
        ],
      },
    })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [
        { email: 'barry@americanimplement.com', name: 'Barry Fuller' },
        { email: 'jdisla@cisco.com', name: 'Josh Disla' },
      ],
    });
    assert.strictEqual(plan.plan.isr.status, 'resolved');
    assert.strictEqual(plan.plan.isr.rep.id, 'ISR1');
    assert.strictEqual(plan.plan.isr.rep.email, 'jdisla@cisco.com');
    assert.ok(!plan.blockers.some((b) => b.code === 'isr_ambiguous'));
  });

  await checkAsync('many Cisco/Meraki participants → ISR stays ambiguous even when every rep resolves', async () => {
    const plan = await loadBuildPlan({
      waterfallAccount: FULL_ACCOUNT,
      isrRowsByEmail: {
        'jdisla@cisco.com': [
          { id: 'ISR1', Name: 'Josh Disla', Email: 'jdisla@cisco.com', Inactive: false },
        ],
        'other@meraki.com': [
          { id: 'ISR2', Name: 'Other Rep', Email: 'other@meraki.com', Inactive: false },
        ],
      },
    })({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [
        { email: 'barry@americanimplement.com', name: 'Barry Fuller' },
        { email: 'jdisla@cisco.com', name: 'Josh Disla' },
        { email: 'other@meraki.com', name: 'Other Rep' },
      ],
    });
    assert.strictEqual(plan.plan.isr.status, 'ambiguous');
    assert.deepStrictEqual(
      plan.plan.isr.candidates.map((candidate) => candidate.id),
      ['ISR1', 'ISR2']
    );
    assert.ok(plan.blockers.some((b) => b.code === 'isr_ambiguous'));
  });

  console.log('\n(5d) chat postmortem 2026-07-31 — attach gate, chip classification, refusal telemetry');

  check('create_quote_on_deal fails closed without confirm_attach — and its refusal ships NO ready-made bypass', () => {
    const seg = SRC.slice(SRC.indexOf(`case 'create_quote_on_deal':`), SRC.indexOf('── Compound: Create Deal + Quote in One Shot'));
    assert.ok(/if \(confirm_attach !== true\)/.test(seg), 'gate missing');
    assert.ok(/error: 'attach_needs_confirmation'/.test(seg));
    assert.ok(!/args: \{ \.\.\.toolInput, confirm_attach: true \}/.test(seg),
      'the refusal must NOT pre-fill confirm_attach:true (review: a ready-made bypass invites an unasked retry)');
    assert.ok(/does NOT answer this/i.test(seg), 'instruction must void the generic "create it now"');
    const schemaSeg = SRC.slice(SRC.indexOf(`name: 'create_quote_on_deal'`), SRC.indexOf(`name: 'create_quote_on_deal'`) + 4000);
    assert.ok(/confirm_attach: \{ type: 'boolean'/.test(schemaSeg), 'schema param missing');
  });

  check('consent SURVIVES the documented post-pick paths (open-deals hints, chip prompt, RULE 4, tool description)', () => {
    assert.ok(/confirm_attach: true,\s*\n\s*skus: toolInput\.skus/.test(SRC),
      'account_has_open_deals per-deal hints must carry confirm_attach for the post-pick call');
    assert.ok(/ONLY after the user explicitly picks this deal/.test(SRC), 'hint description must gate on the pick');
    assert.ok(/their chip tap IS the attach consent/.test(SRC), 'chip-flow prompt must pass the flag');
    assert.ok(/the user naming the deal \/ working ON its Zoho page IS the attach consent/.test(SRC), 'RULE 4 must cover deal-page first-call consent');
    assert.ok(/NEVER pick a deal for the user — a deal you found by searching is NOT consent/.test(SRC));
    assert.ok(/chosen deal_id AND confirm_attach:true/.test(SRC), 'create_deal_and_quote description must carry the flag');
  });

  check('chip-confirm messages classify as crm_write — including the CANONICAL "Add to the existing deal" chip', () => {
    const m2 = { exports: {} };
    new Function('module', [
      grab('stripInjectedClassifierContext'),
      grab('classifyCrmIntent'),
      'module.exports = classifyCrmIntent;'
    ].join('\n'))(m2);
    const classify = m2.exports;
    assert.strictEqual(classify('No Cisco rep, Stratus Referal. Create it now. 1 year').class, 'crm_write',
      'the exact Marlette chip reply must be crm_write');
    assert.strictEqual(classify('Create it now').class, 'crm_write');
    assert.strictEqual(classify('Add to the existing deal').class, 'crm_write', 'the REAL prompt chip label');
    assert.strictEqual(classify('Add it to the existing deal').class, 'crm_write');
    assert.strictEqual(classify('Attach it to the existing deal').class, 'crm_write');
    assert.strictEqual(classify('what quotes are open on this account?').class === 'crm_write', false,
      'reads must not be swept in');
  });

  check('general tool subset includes create_quote_on_deal (misclassified attach turns can still attach)', () => {
    const seg = SRC.slice(SRC.indexOf('general: ['), SRC.indexOf(']', SRC.indexOf('general: [')));
    assert.ok(seg.includes("'create_quote_on_deal'"));
  });

  check('tool refusals are accumulated in-loop and surfaced in the telemetry meta', () => {
    assert.ok(/const _toolRefusalAcc = \[\];/.test(SRC));
    assert.ok(/_toolRefusalAcc\.push\(`\$\{block\.name\}:\$\{String\(result\.error\)\.slice\(0, 60\)\}`\)/.test(SRC));
    const hits = SRC.match(/toolRefusals: _toolRefusalAcc/g) || [];
    assert.strictEqual(hits.length, 2, `both _praExtras branches must carry refusals, found ${hits.length}`);
    const metaHits = SRC.match(/refusals: extras\.toolRefusals\.slice\(-6\)/g) || [];
    assert.strictEqual(metaHits.length, 2,
      `BOTH meta sites (production + pr_a eval) must include refusals, found ${metaHits.length} — review catch: patching one left real traffic blind`);
  });

  console.log('\n(6) source-level wiring');

  check('one-shot attach re-reads Stage and enforces the signed Deal/Account/Contact target before writing', () => {
    assert.ok(/Deals\/\$\{existingDealId\}\?fields=id,Deal_Name,Stage,Account_Name,Contact_Name/.test(SRC));
    assert.ok(/Contacts\/\$\{encodeURIComponent\(reviewedContactId\)\}\?fields=id,Account_Name/.test(SRC));
    // 2026-08-19: the Deal-level call now opts OUT of comparing the Deal's own
    // primary contact, because a quote's contact may legitimately differ from it.
    // The Deal/Account binding and the contact-identity revalidation below are
    // still enforced, which is what this check is really about.
    assert.ok(/validateOneshotAttachTarget\(\s*existingDealData, reviewedAttachTarget, \{ requireContactMatch: false \}\)/.test(SRC),
      'the Deal-level target check must still run, with the contact comparison explicitly opted out');
    assert.ok(/requireContactMatch: true/.test(SRC),
      'the contact-level revalidation must still assert identity');
    assert.ok(/toolInput\[ONESHOT_ATTACH_TARGET_CAPABILITY\] = \{/.test(SRC));
    assert.ok(/reviewed_deal_target_changed/.test(SRC));
  });

  check('plan enrichment is INJECTED + ctx-aware and NEVER fails silently (Marlette blank-address diagnosis)', () => {
    assert.ok(/await enrich\(selectedDomain, \{ env, ctx, cache_bust: p\.enrich_cache_bust === true \}\)/.test(SRC),
      'must call the injected enricher with ctx');
    assert.ok(/async function buildOneshotPlan\(input, env, caller, ctx, enrich\)/.test(SRC), 'ctx + enrich must be plan parameters');
    assert.ok(/buildOneshotPlan\(apiBody, env, \(env && env\.__CALLER_EMAIL\) \|\| null, ctx, enrichCompanyV2\)/.test(SRC),
      'route must inject enrichCompanyV2 from its own scope');
    assert.ok(/if \(typeof enrich !== 'function'\) throw new Error\('enricher_not_injected'\)/.test(SRC),
      'a missing injection must surface, not silently skip');
    assert.ok(!/const er = await enrichCompanyV2\(/.test(SRC), 'module-scope direct call (ReferenceError) must be gone');
    assert.ok(/prefill\.enrich_error = er\?\.error \|\|/.test(SRC), 'a non-result must record enrich_error');
    assert.ok(/prefill\.enrich_error = String\(\(e && e\.message\) \|\| e\)/.test(SRC), 'a throw must record enrich_error');
    assert.ok(!/catch \(_\) \{ \/\* enrichment is best-effort prefill only \*\/ \}/.test(SRC), 'the silent catch must be gone');
  });

  check('create branch honors structured contact_first_name/contact_last_name over the split', () => {
    assert.ok(/toolInput\.contact_first_name && String\(toolInput\.contact_first_name\)\.trim\(\)\) \|\| nameParts\[0\]/.test(SRC));
    assert.ok(/toolInput\.contact_last_name && String\(toolInput\.contact_last_name\)\.trim\(\)\)/.test(SRC));
  });

  check('single-token contact create uses the neutral "-" surname placeholder', () => {
    assert.ok(/nameParts\.slice\(1\)\.join\(' '\) \|\| '-'/.test(SRC), 'placeholder branch missing');
    assert.ok(!/nameParts\.slice\(1\)\.join\(' '\) \|\| nameParts\[0\]/.test(SRC), 'old duplicate-first-name branch still present');
  });

  check('old unsorted Account-contacts fallback (per_page=3) is gone', () => {
    assert.ok(!/Contacts\/search\?criteria=\(Account_Name:equals:\$\{encodeURIComponent\(accountData\.Account_Name \|\| account_name\)\}\)&fields=id,Full_Name,Email&per_page=3/.test(SRC));
  });
  check('strict_contact gates the last-resort contact fallback', () => {
    assert.ok(/if \(!contactId && strict_contact !== true\) \{\s*\n\s*const fallbackContact = await fetchPrimaryContactForAccount\(accountId, env\)/.test(SRC));
  });
  check('pinned account/contact fail closed (no silent fallback)', () => {
    assert.ok(SRC.includes(`error: 'pinned_account_not_found'`));
    assert.ok(SRC.includes(`error: 'pinned_contact_not_found'`));
    assert.ok(SRC.includes(`error: 'contact_account_mismatch'`));
  });
  check('meraki_isr_name is in the tool schema and the ISR gate mentions it', () => {
    assert.ok(/meraki_isr_name: \{ type: 'string'/.test(SRC));
    assert.ok(/retry with meraki_isr_name/.test(SRC) || /meraki_isr_name\) set/.test(SRC) || /\(retry with meraki_isr_name\)/.test(SRC));
  });
  check('thread-participants context line present in BOTH chat entry paths', () => {
    const hits = SRC.match(/Thread participants: /g) || [];
    assert.ok(hits.length >= 2, `expected ≥2 injection sites, found ${hits.length}`);
  });
  check('oneshot routes registered', () => {
    assert.ok(SRC.includes(`case '/api/oneshot-plan':`));
    assert.ok(SRC.includes(`case '/api/oneshot-execute':`));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
