// ONE-SHOT customer-to-quote — participant selection, ISR-by-name, pinned-record
// cross-checks, and executeOneshot fail-closed validation (2026-07-30).
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

  console.log('\n(5) executeOneshot — fail-closed validation + tool mapping');

  function loadExecuteOneshot({ kvInit = {}, responses = null } = {}) {
    const calls = [];
    const kv = new Map(Object.entries(kvInit));
    const puts = [];
    const m = { exports: {} };
    const stubs = [
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', nextMonthEnd: '2026-08-31', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('isDomainLike'),
      grabPlaceholderDeps(),
      // Programmable per-call responses: __responses[i] answers the i-th tool
      // call; the last entry repeats. Default = full success.
      `const executeToolCall = async (tool, input) => { __calls.push({ tool, input }); const r = __responses ? __responses[Math.min(__calls.length - 1, __responses.length - 1)] : null; return r || { success: true, records: { deal: { id: 'D1', url: 'u' }, quote: { id: 'Q1', url: 'u' } } }; };`,
      grab('executeOneshot'),
      'module.exports = executeOneshot;'
    ].join('\n');
    new Function('module', '__calls', '__responses', stubs)(m, calls, responses);
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

  await checkAsync('attach mode → create_quote_on_deal with deal_id, no account pin', async () => {
    const { run, calls } = loadExecuteOneshot();
    const r = await run({ ...validNewDeal, deal: { existing_deal_id: 'DEAL9' } });
    assert.strictEqual(r.success, true);
    assert.strictEqual(calls[0].tool, 'create_quote_on_deal');
    assert.strictEqual(calls[0].input.deal_id, 'DEAL9');
    assert.strictEqual(calls[0].input.strict_contact, true);
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

  function loadBuildPlan({ waterfallAccount = null, contactByEmail = null, openDeals = [] } = {}) {
    const m = { exports: {} };
    const stubs = [
      grabConstSet('CONSUMER_DOMAINS'),
      grabConstSet('ONESHOT_VENDOR_DOMAINS'),
      grabConstArray('REQUIRED_ACCOUNT_FIELDS'),
      grab('isDomainLike'),
      grab('getMissingAccountFields'),
      grab('selectCustomerFromParticipants'),
      grab('isZohoTrue'),
      `const fetchAccountById = async () => __cfg.waterfallAccount;`,
      `const resolveAccountWaterfall = async (args) => { __cfg.wfArgs = args; return (__cfg.waterfallAccount ? { account: __cfg.waterfallAccount, confidence: 'high', source: 'test' } : null); };`,
      `const enrichCompanyV2 = async () => null;`,
      `const resolveContactByEmail = async () => __cfg.contactByEmail;`,
      `const zohoApiCall = async (method, pathArg) => { if (String(pathArg) === 'coql') return { data: __cfg.openDeals }; return { data: [] }; };`,
      grab('resolveMerakiIsrByName'),
      `const executeToolCall = async (tool, input) => { const out = {}; for (const s of input.skus) out[s.sku] = { suffixed_sku: s.sku, found: true, ecomm_price: 100, list_price: 150, product_active: true }; return { products: out }; };`,
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('buildOneshotPlan'),
      'module.exports = buildOneshotPlan;'
    ].join('\n');
    new Function('module', '__cfg', stubs)(m, { waterfallAccount, contactByEmail, openDeals });
    return (input) => m.exports(input, {}, 'test@stratusinfosystems.com');
  }

  const FULL_ACCOUNT = {
    id: 'ACC1', Account_Name: 'American Implement', Website: 'www.americanimplement.com',
    Billing_Street: '1 Main', Billing_City: 'Wichita', Billing_State: 'KS',
    Billing_Code: '67226', Billing_Country: 'United States',
  };

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
    const cfg = { waterfallAccount: null, contactByEmail: null, openDeals: [] };
    const m = { exports: {} };
    const stubs = [
      grabConstSet('CONSUMER_DOMAINS'),
      grabConstSet('ONESHOT_VENDOR_DOMAINS'),
      grabConstArray('REQUIRED_ACCOUNT_FIELDS'),
      grab('isDomainLike'),
      grab('getMissingAccountFields'),
      grab('selectCustomerFromParticipants'),
      grab('isZohoTrue'),
      `const fetchAccountById = async () => __cfg.waterfallAccount;`,
      `const resolveAccountWaterfall = async (args) => { __cfg.wfArgs = args; return null; };`,
      `const enrichCompanyV2 = async () => null;`,
      `const resolveContactByEmail = async () => null;`,
      `const zohoApiCall = async () => ({ data: [] });`,
      grab('resolveMerakiIsrByName'),
      `const executeToolCall = async (tool, input) => { const out = {}; for (const s of input.skus) out[s.sku] = { suffixed_sku: s.sku, found: true, ecomm_price: 100, list_price: 150, product_active: true }; return { products: out }; };`,
      `const defaultQuoteDealDate = () => ({ date: '2026-07-31', suggested: '2026-07-25', fiscalQuarterEnd: '2026-07-25', crossesFiscalQuarter: true, daysToMonthEnd: 1, needsConfirmation: true });`,
      grab('buildOneshotPlan'),
      'module.exports = buildOneshotPlan;'
    ].join('\n');
    new Function('module', '__cfg', stubs)(m, cfg);
    const plan = await m.exports({
      skus: [{ sku: 'LIC-ENT-3YR', qty: 1 }],
      participants: [{ email: 'billing@marlettefunding.com', name: '' }],
      enrich: false,
      // NOTE: no account_name — the dashboard no longer sends the card org.
    }, {}, 'test@stratusinfosystems.com');
    assert.strictEqual(cfg.wfArgs.nameHint, undefined, 'card/org name must never reach the waterfall as a lookup hint');
    assert.strictEqual(cfg.wfArgs.domain, 'marlettefunding.com', 'recipient domain is the lookup authority');
    assert.strictEqual(plan.plan.account.mode, 'create', 'no trustworthy domain match → CREATE review, never a similar-name attach');
    assert.strictEqual(plan.plan.account.prefill.name, '', 'engine leaves the name empty for the dashboard display-only backfill');
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

  console.log('\n(6) source-level wiring');

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
