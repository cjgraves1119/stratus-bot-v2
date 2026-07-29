#!/usr/bin/env node
/**
 * Offline behavioral tests for /api/deal-close-lost and the additive read-back
 * verification on task-action 'complete'.
 *
 * These run against the ACTUAL case blocks extracted from src/index.js — not a
 * copy — so drift in the source fails the suite. zohoApiCall is mocked and every
 * call is recorded, which is how we assert "no write happened" on the refusal
 * paths. No network, no credentials, no Zoho.
 *
 * Run: node worker-gchat/test-deal-close-lost-2026-07-29.js
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, 'src', 'index.js');
const src = fs.readFileSync(SRC, 'utf8');

// ── Extract a `case '<label>': { ... }` block by brace-matching from the source ──
function extractCase(label, from = 0) {
  const needle = `case '${label}': {`;
  const start = src.indexOf(needle, from);
  if (start === -1) throw new Error(`FATAL: could not find ${needle} in src/index.js`);
  let depth = 0, i = src.indexOf('{', start);
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`FATAL: unbalanced braces after ${needle}`);
}

const closeLostBlock = extractCase('/api/deal-close-lost');
// 'complete' appears inside the task-action switch; anchor the search past its marker.
const taskActionAt = src.indexOf("case '/api/task-action'");
const completeBlock = extractCase('complete', taskActionAt);

// The real picklist, read from source so a source-side edit is caught here too.
const reasonMatch = src.match(/const VALID_REASON_FOR_LOSS = \[([\s\S]*?)\];/);
if (!reasonMatch) throw new Error('FATAL: VALID_REASON_FOR_LOSS not found in src/index.js');
const VALID_REASON_FOR_LOSS = reasonMatch[1]
  .split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(s => s && !s.startsWith('//'));

class FakeResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status || 200; }
  json() { return JSON.parse(this.body); }
}

function makeRunner(block, switchOn, extraArgs = []) {
  const argNames = ['apiBody', 'env', 'zohoApiCall', 'jsonHeaders', 'VALID_REASON_FOR_LOSS', 'Response', 'console', ...extraArgs];
  // eslint-disable-next-line no-new-func
  const fn = new Function(...argNames,
    `return (async () => { let apiResult; switch (${JSON.stringify(switchOn)}) { ${block} } return apiResult; })();`);
  return (...args) => fn(...args);
}

const runCloseLost = makeRunner(closeLostBlock, '/api/deal-close-lost');
const runComplete = makeRunner(completeBlock, 'complete', ['taskId']);

const quietConsole = { log: () => {}, warn: () => {}, error: () => {} };

// ── Mock Zoho: `stages` is a queue of GET results; writes are recorded ──
function mockZoho({ getResults = [], putResult = { data: [{ code: 'SUCCESS' }] }, putThrows = null, getThrows = false }) {
  const calls = [];
  const gets = [...getResults];
  const zohoApiCall = async (method, url, _env, body) => {
    calls.push({ method, url, body });
    if (method === 'GET') {
      if (getThrows) throw new Error('simulated read failure');
      return gets.length ? gets.shift() : { data: [] };
    }
    if (method === 'PUT') {
      if (putThrows) throw new Error(putThrows);
      return putResult;
    }
    return {};
  };
  return { zohoApiCall, calls, writes: () => calls.filter(c => c.method === 'PUT') };
}

const deal = (over = {}) => ({ data: [{ Deal_Name: 'Acme Refresh', Stage: 'Qualification', ...over }] });

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

(async () => {
  console.log('\n/api/deal-close-lost\n');

  // 1. input validation
  {
    const m = mockZoho({});
    const r = await runCloseLost({ dealId: 'abc' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('400 on non-numeric dealId', r instanceof FakeResponse && r.status === 400);
    check('  no Zoho call on bad dealId', m.calls.length === 0);
  }
  {
    const m = mockZoho({});
    const r = await runCloseLost({}, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('400 on missing dealId', r instanceof FakeResponse && r.status === 400);
  }
  {
    const m = mockZoho({ getResults: [deal()] });
    const r = await runCloseLost({ dealId: '2570562000000000001', reasonForLoss: 'Because I said so' },
      {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('400 on invalid reasonForLoss', r instanceof FakeResponse && r.status === 400);
    check('  no Zoho call on invalid reason', m.calls.length === 0);
  }

  // 2. refusal paths — the critical ones: NO WRITE may happen
  {
    const m = mockZoho({ getResults: [{ data: [] }] });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('not-found → success:false', r.success === false);
    check('  no write on not-found', m.writes().length === 0);
  }
  {
    const m = mockZoho({ getResults: [deal({ Deal_Name: 'Acme Refresh' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001', expectedDealName: 'Stale Name' },
      {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('name mismatch → success:false', r.success === false);
    check('  no write on name mismatch', m.writes().length === 0);
    check('  error names both values', /Acme Refresh/.test(r.error) && /Stale Name/.test(r.error));
  }
  {
    const m = mockZoho({ getResults: [deal({ Stage: 'Closed (Won)' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('Closed (Won) → refused', r.success === false);
    check('  no write on Closed (Won)', m.writes().length === 0);
  }
  {
    const m = mockZoho({ getResults: [deal({ Stage: 'Closed (Lost)' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('already Closed (Lost) → idempotent success', r.success === true && r.alreadyClosedLost === true);
    check('  no write when already closed', m.writes().length === 0);
  }

  // 3. happy path — exactly one Stage-only write, then read-back
  {
    const m = mockZoho({ getResults: [deal(), deal({ Stage: 'Closed (Lost)' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001', expectedDealName: 'Acme Refresh' },
      {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    const w = m.writes();
    check('happy path → success:true', r.success === true);
    check('  verifiedStage is Closed (Lost)', r.verifiedStage === 'Closed (Lost)');
    check('  previousStage preserved', r.previousStage === 'Qualification');
    check('  exactly ONE write', w.length === 1, `got ${w.length}`);
    check('  payload is Stage-only', JSON.stringify(w[0].body) === JSON.stringify({ data: [{ Stage: 'Closed (Lost)' }] }),
      JSON.stringify(w[0]?.body));
    check('  read-back GET happened after write', m.calls.filter(c => c.method === 'GET').length === 2);
  }
  {
    const valid = VALID_REASON_FOR_LOSS[0];
    const m = mockZoho({ getResults: [deal(), deal({ Stage: 'Closed (Lost)' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001', reasonForLoss: valid },
      {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check(`valid reasonForLoss ("${valid}") accepted`, r.success === true);
    check('  Reason_For_Loss included in payload', m.writes()[0].body.data[0].Reason_For_Loss === valid);
  }

  // 4. failure reporting — never claim success we can't prove
  {
    const m = mockZoho({ getResults: [deal()], putResult: { data: [{ code: 'INVALID_DATA', message: 'nope' }] } });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('Zoho rejection → success:false', r.success === false);
    check('  surfaces Zoho message', /nope/.test(r.error));
  }
  {
    // write "succeeds" but the record still shows the old stage
    const m = mockZoho({ getResults: [deal(), deal({ Stage: 'Qualification' })] });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('read-back mismatch → success:false', r.success === false);
    check('  reports the actual stage seen', r.verifiedStage === 'Qualification');
  }
  {
    const m = mockZoho({ getResults: [deal()], putThrows: 'network down' });
    const r = await runCloseLost({ dealId: '2570562000000000001' }, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole);
    check('thrown error → success:false, no crash', r.success === false && /network down/.test(r.error));
  }

  console.log('\ntask-action complete → read-back verification\n');

  {
    const m = mockZoho({ getResults: [{ data: [{ Status: 'Completed', Subject: 'Follow up - Acme', What_Id: { id: '999' } }] }] });
    const r = await runComplete({}, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole, '123');
    check('complete → verifiedStatus Completed', r.success === true && r.verifiedStatus === 'Completed');
    check('  verifiedSubject returned', r.verifiedSubject === 'Follow up - Acme');
    check('  verifiedWhatId returned', r.verifiedWhatId === '999');
  }
  {
    const m = mockZoho({ getThrows: true });
    const r = await runComplete({}, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole, '123');
    check('verification read fails → verifiedStatus null, not a guess', r.success === true && r.verifiedStatus === null);
  }
  {
    let threw = false;
    const m = mockZoho({ putResult: { data: [{ code: 'INVALID_DATA', message: 'bad' }] } });
    try { await runComplete({}, {}, m.zohoApiCall, {}, VALID_REASON_FOR_LOSS, FakeResponse, quietConsole, '123'); }
    catch (e) { threw = /Failed to complete task/.test(e.message); }
    check('PUT rejection still throws (existing contract preserved)', threw);
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
})();
