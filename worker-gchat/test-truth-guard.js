// Unit tests for the response-truth guard shipped alongside the
// CW9172/C9xxx auto-normalization PR (2026-04-24 Codex council).
//
// The guard lives inside askClaude in worker-gchat/src/index.js. It has
// three pieces:
//   1. verifiedRecordIds tracking — harvest Zoho 15-19 digit record ids
//      from every SUCCESSFUL tool result this turn.
//   2. Leak-pattern stripping — remove Llama's internal-planning text
//      like "No tool call were made during this conversation".
//   3. URL truth filter — strip any CRM URL in finalReply whose record
//      id is not in verifiedRecordIds, plus prepend a warning when the
//      reply claims creation/update without any successful mutation.
//
// These tests re-declare the patterns/logic so they run without needing
// the full worker pipeline. Run: node test-truth-guard.js

const assert = require('node:assert/strict');

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

// ─── Re-declare the guard logic in pure form for testing ─────────────────────

const ZOHO_URL_RE = /https:\/\/crm\.zoho\.com\/crm\/org\d+\/tab\/(Quotes|Deals|Accounts|Contacts|Tasks|Sales_Orders|Invoices|Products)\/(\d{15,19})/g;

const LEAK_PATTERNS = [
  /\b[Nn]o\s+tool\s+calls?\s+(?:were|was)\s+made[^.\n]*\.?\s*(?:I\s+can\s+(?:now\s+)?respond[^.\n]*\.?)?\s*/g,
  /\[(?:thinking|internal|reasoning|planning)\][\s\S]*?\[\/(?:thinking|internal|reasoning|planning)\]\s*/gi,
  /^\s*I\s+(?:should|will|need to|am going to)\s+call\s+(?:the\s+)?\w+(?:_\w+)*\s+(?:tool|function)[^.\n]*\.?\s*$/gim,
];

function stripLeaks(s) {
  if (!s) return s;
  for (const p of LEAK_PATTERNS) s = s.replace(p, '');
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function applyTruthGuard(finalReply, verifiedRecordsByModule, mutationSummaries) {
  if (!finalReply || /^API error:/.test(finalReply)) return finalReply;
  let reply = finalReply;
  // Reset regex state between invocations
  const re = new RegExp(ZOHO_URL_RE.source, 'g');
  const urlsFound = [];
  let m;
  while ((m = re.exec(reply)) !== null) {
    urlsFound.push({ full: m[0], module: m[1], id: m[2] });
  }
  const unverified = urlsFound.filter(u => {
    const set = verifiedRecordsByModule.get(u.module);
    return !(set && set.has(u.id));
  });
  for (const u of unverified) {
    const urlEsc = u.full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    reply = reply.replace(new RegExp(`\\[([^\\]]*)\\]\\(${urlEsc}\\)`, 'g'), '[link removed: unverified]');
    reply = reply.replace(new RegExp(urlEsc, 'g'), '[URL removed: unverified]');
  }
  const successfulMutation = mutationSummaries.some(s => !s.isError);
  const claimsSuccess = /\b(quote|deal|task|record|contact|account)\s+(?:was|has\s+been|is)\s+(?:successfully\s+)?(?:created|added|updated|cloned|saved|made)\b/i.test(reply)
    || /\bcreated\s+(?:a\s+new\s+)?(?:quote|deal|task|contact|account)\b/i.test(reply);
  if (claimsSuccess && !successfulMutation) {
    reply = `⚠️ The assistant claimed a record was created or updated, but no verified CRM write tool ran successfully this turn. Any record references above have been stripped. Please retry — if the problem persists, the model may be hallucinating success.\n\n${reply}`;
  }
  return reply;
}

// ─── Test Cases ──────────────────────────────────────────────────────────────

console.log('─── Leak-pattern stripping ───');

t('Strips "No tool call were made" with trailing "I can now respond"', () => {
  const input = 'No tool call were made during this conversation. I can now respond.\n\nThe quote was created successfully.';
  const out = stripLeaks(input);
  assert.ok(!/No tool call/i.test(out), 'leak text should be gone');
  assert.ok(!/I can now respond/i.test(out), '"I can now respond" should be gone');
  assert.ok(/The quote was created/.test(out), 'legitimate text preserved');
});

t('Strips "no tool calls were made" (plural, lowercase)', () => {
  const input = 'no tool calls were made. I can respond.';
  const out = stripLeaks(input);
  assert.equal(out, '');
});

t('Leaves normal text untouched', () => {
  const input = 'Here is your quote summary. Grand total is $1,234.';
  const out = stripLeaks(input);
  assert.equal(out, input);
});

t('Strips [thinking]...[/thinking] blocks', () => {
  const input = '[thinking]The user wants a quote. Let me call zoho_create_record.[/thinking]\n\nQuote created.';
  const out = stripLeaks(input);
  assert.ok(!/thinking/i.test(out));
  assert.ok(/Quote created/.test(out));
});

t('Strips [planning]...[/planning] blocks', () => {
  const input = '[planning]Step 1: search. Step 2: create.[/planning]\nResult here.';
  const out = stripLeaks(input);
  assert.ok(!/Step 1/.test(out));
  assert.ok(/Result here/.test(out));
});

t('Collapses excess blank lines left behind after stripping', () => {
  const input = 'Line A\n\n\n\n\nLine B';
  const out = stripLeaks(input);
  assert.equal(out, 'Line A\n\nLine B');
});

console.log('\n─── URL truth guard ───');

// Helper: build a module→idSet Map from {module, id} tuples (cleaner than Map boilerplate in tests)
function verifiedMap(tuples) {
  const m = new Map();
  for (const [module, id] of tuples) {
    if (!m.has(module)) m.set(module, new Set());
    m.get(module).add(String(id));
  }
  return m;
}

t('Keeps verified Zoho URL (module+id in verifiedRecordsByModule)', () => {
  const id = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${id}`;
  const reply = `Here is your quote: [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([['Quotes', id]]), []);
  assert.ok(guarded.includes(url), 'verified URL must be preserved');
  assert.ok(guarded.includes('[View Quote]'), 'markdown link wrapper preserved');
});

t('Strips hallucinated Zoho URL (module+id NOT verified)', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `The quote was created. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  assert.ok(!guarded.includes(url), 'hallucinated URL must be stripped');
  assert.ok(/link removed: unverified/.test(guarded), 'replacement marker present');
});

t('Strips bare (non-markdown) hallucinated URL', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `Quote URL: ${url}`;
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  assert.ok(!guarded.includes(url));
  assert.ok(/URL removed: unverified/.test(guarded));
});

t('Prepends warning when reply claims creation but no mutation succeeded', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `The quote was created successfully. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  assert.ok(/⚠️/.test(guarded), 'warning symbol must be present');
  assert.ok(/hallucinating success/i.test(guarded), 'warning text must mention hallucination');
});

t('Does NOT warn when a mutation did succeed (legitimate create)', () => {
  const id = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${id}`;
  const reply = `The quote was created. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([['Quotes', id]]), [{ isError: false, recordUrl: url }]);
  assert.ok(!/⚠️/.test(guarded), 'must not warn on legitimate success');
  assert.ok(guarded.includes(url), 'verified URL preserved');
});

t('Mixed: strips hallucinated URL, keeps verified URL in same reply', () => {
  const realId = '2570562000400116511';
  const fakeId = '9999999999999999999';
  const realUrl = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${realId}`;
  const fakeUrl = `https://crm.zoho.com/crm/org647122552/tab/Deals/${fakeId}`;
  const reply = `Quote: [real](${realUrl})\nDeal: [fake](${fakeUrl})`;
  const guarded = applyTruthGuard(reply, verifiedMap([['Quotes', realId]]), [{ isError: false, recordUrl: realUrl }]);
  assert.ok(guarded.includes(realUrl), 'real URL preserved');
  assert.ok(!guarded.includes(fakeUrl), 'fake URL stripped');
});

t('Cross-module attack blocked: Task id cannot whitelist fake Quote URL', () => {
  // The Codex non-blocking concern: if a successful Task mutation put id X
  // into verifiedRecordIds, a fake Quote URL with the same id X would pass
  // the old id-only check. Module-aware check blocks it.
  const sharedId = '2570562000400116599';
  const taskUrl = `https://crm.zoho.com/crm/org647122552/tab/Tasks/${sharedId}`;   // verified
  const fakeQuoteUrl = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${sharedId}`; // hallucinated
  const reply = `Task created: [Task](${taskUrl})\nQuote: [View Quote](${fakeQuoteUrl})`;
  const guarded = applyTruthGuard(reply, verifiedMap([['Tasks', sharedId]]), [{ isError: false, recordUrl: taskUrl }]);
  assert.ok(guarded.includes(taskUrl), 'Task URL preserved');
  assert.ok(!guarded.includes(fakeQuoteUrl), 'Quote URL with Task id must be stripped');
});

t('Does not strip for Tasks module when Tasks id is verified', () => {
  const id = '2570562000400116599';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Tasks/${id}`;
  const reply = `Task created. [Open Task](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([['Tasks', id]]), [{ isError: false, recordUrl: url }]);
  assert.ok(guarded.includes(url));
});

t('Strips Sales_Orders URL when hallucinated', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Sales_Orders/${fakeId}`;
  const reply = `Your sales order is here: [SO](${url})`;
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  assert.ok(!guarded.includes(url));
});

t('Full TestCo transcript reproduction: leak + fake URL + false success', () => {
  // This is the exact failure mode Codex captured.
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const raw = `No tool call were made during this conversation. I can now respond.\n\nThe quote was created with C9300L-48P-4X-M, LIC-C9300-48E-1Y, C9300L-24P-4X-M, LIC-C9300-24E-1Y.\n\n[View Quote](${url})`;
  const afterLeaks = stripLeaks(raw);
  assert.ok(!/No tool call/i.test(afterLeaks), 'leak stripped first');
  const guarded = applyTruthGuard(afterLeaks, verifiedMap([]), []);
  assert.ok(!guarded.includes(url), 'fake URL stripped');
  assert.ok(/⚠️/.test(guarded), 'warning present');
  assert.ok(/hallucinating success/i.test(guarded), 'warning cites hallucination');
});

t('Does NOT flag on historical phrasing with intervening record id', () => {
  // "quote <15-19 digit id> was created" describes history (from a search
  // result). The claimsSuccess regex requires word-level proximity between
  // the noun and the verb, so an intervening id breaks the match.
  const reply = 'According to the record, quote 2570562000399909183 was created on 2024-01-15.';
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  assert.ok(!/⚠️/.test(guarded), 'no false-positive warning on historical phrasing with id between noun and verb');
});

t('Zoho URL regex does not over-match on arbitrary digits inside URL', () => {
  const shortIdUrl = 'https://crm.zoho.com/crm/org647122552/tab/Quotes/12345'; // too short
  const reply = `Partial URL: ${shortIdUrl}`;
  const guarded = applyTruthGuard(reply, verifiedMap([]), []);
  // Short id should not match the 15-19 digit requirement → not touched.
  assert.ok(guarded.includes(shortIdUrl));
});

console.log('\n─── Quote-create verification-failure shape (Codex pre-merge check) ───');

// Simulate the exact return shape emitted by create_deal_and_quote when the
// post-create GET verification fails. Codex flagged that `{ success:false,
// ...results }` would silently become success:true if `results` ever carries
// `success: true`. Verify the patched shape cannot regress to success.
function simulateCreateDealAndQuoteVerifyFailReturn(resultsInitialState) {
  // Mirror the production code after the patch.
  const results = { ...resultsInitialState };
  const quoteId = '2570562000400116511';
  const error = 'GET returned no record';
  // Scrub per production
  if (results.records?.quote) delete results.records.quote;
  if (!Array.isArray(results.errors)) results.errors = [];
  results.errors.push(`Quote verification failed after create: ${error}`);
  results.success = false; // defensive — set on results BEFORE spread
  return {
    ...results,
    success: false,
    error: 'quote_create_verify_failed',
    created_id_unverified: quoteId,
    instruction: 'Treat as FAILED create',
    wall_ms: 0,
  };
}

t('Verify-fail shape is success:false even when results had success:true', () => {
  const ret = simulateCreateDealAndQuoteVerifyFailReturn({
    steps: ['ok'],
    errors: [],
    records: { deal: { id: 'DEAL_X' }, quote: { id: 'QUOTE_Y', url: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400116511' } },
    success: true, // <-- the trap: a future refactor could set this earlier
  });
  assert.equal(ret.success, false, 'top-level success must be false');
  assert.equal(ret.error, 'quote_create_verify_failed');
  assert.equal(ret.created_id_unverified, '2570562000400116511');
  assert.ok(!ret.records?.quote, 'records.quote must be scrubbed');
});

t('Verify-fail shape does not expose a Quote URL in any field', () => {
  const ret = simulateCreateDealAndQuoteVerifyFailReturn({
    steps: [],
    errors: [],
    records: { deal: { id: 'DEAL_X' }, quote: { id: 'QUOTE_Y', url: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400116511' } },
    success: true,
  });
  const serialized = JSON.stringify(ret);
  // The quote URL string must NOT appear anywhere in the scrubbed payload.
  assert.ok(!/\/tab\/Quotes\/\d{15,19}/.test(serialized), 'no Quote URL may leak through on verify-fail');
  // created_id_unverified carries the id for diagnostics but NOT as a URL.
  assert.ok(ret.created_id_unverified, 'id may be surfaced for diagnostics');
});

t('Verify-fail result cannot whitelist the failed Quote id in verifiedRecordsByModule', () => {
  const ret = simulateCreateDealAndQuoteVerifyFailReturn({
    steps: [],
    errors: [],
    records: { deal: { id: 'DEAL_X' }, quote: { id: 'QUOTE_Y', url: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400116511' } },
    success: true,
  });
  // Simulate the askClaude harvesting logic: only SUCCESSFUL results contribute.
  const verified = new Map();
  const resultIsError = ret.success === false || !!ret.error || !!ret.validation_error;
  if (!resultIsError) {
    const s = JSON.stringify(ret);
    const rx = /https:\/\/crm\.zoho\.com\/crm\/org\d+\/tab\/(Quotes|Deals|Accounts|Contacts|Tasks|Sales_Orders|Invoices|Products)\/(\d{15,19})/g;
    let mm;
    while ((mm = rx.exec(s)) !== null) {
      if (!verified.has(mm[1])) verified.set(mm[1], new Set());
      verified.get(mm[1]).add(mm[2]);
    }
  }
  assert.ok(!verified.has('Quotes'), 'Quotes module must not be present in verifiedRecordsByModule');
  // If the model then tries to render a Quote URL with the failed id, the guard strips it.
  const fakeReply = 'The quote was created. [View](https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400116511)';
  const guarded = applyTruthGuard(fakeReply, verified, []);
  assert.ok(!/tab\/Quotes\/2570562000400116511/.test(guarded), 'URL must be stripped by guard');
  assert.ok(/⚠️/.test(guarded), 'hallucinated-success warning must fire');
});

console.log('\n─── Quote-update verification-failure normalization (Codex round-4) ───');

// Mirrors the production return shapes for the verify-fetch-fails paths in
// zoho_update_record (worker-gchat/src/index.js). Two cases:
//   (a) verify GET threw — catch block returns success:false + WARNING
//   (b) verify GET returned no record — falls through to the no-record path
// Codex's invariant: under either case, top-level success MUST be false and
// a verification.WARNING must be present so the model can't narrate success.

function simulateVerifyGetThrew(updateParsed, errMessage) {
  // Mirror production catch block.
  return {
    ...updateParsed,
    success: false,
    message: `⚠️ Zoho returned SUCCESS on the PUT but the verification re-fetch threw: ${errMessage}. The update is UNVERIFIED — do NOT claim the change was applied.`,
    verification: {
      success: false,
      verified: false,
      WARNING: `Verification re-fetch threw: ${errMessage}. The update is UNVERIFIED. Tell the user the change cannot be confirmed and offer to retry. Do NOT claim the change was applied.`,
      reason: 'verify_get_threw',
      error: errMessage,
    },
  };
}

function simulateVerifyGetReturnedNoRecord(updateParsed, recordId) {
  return {
    ...updateParsed,
    success: false,
    message: '⚠️ Zoho returned SUCCESS on the PUT but the verification re-fetch returned no record. The update is UNVERIFIED — do NOT claim the change was applied.',
    verification: {
      success: false,
      verified: false,
      WARNING: `Verification re-fetch returned no record for Quote ${recordId} after a SUCCESS write. The update is UNVERIFIED. Tell the user the change cannot be confirmed and offer to retry. Do NOT claim the change was applied.`,
      reason: 'verify_get_returned_no_record',
    },
  };
}

t('verify GET threw: top-level success is false (not true from updateParsed)', () => {
  const ret = simulateVerifyGetThrew({ success: true, code: 'SUCCESS', data: { id: 'X', code: 'SUCCESS' } }, 'fetch timeout');
  assert.equal(ret.success, false, 'top-level success must be false');
  assert.equal(ret.verification.success, false, 'inner verification.success must be false');
  assert.ok(ret.verification.WARNING, 'WARNING must be present');
  assert.equal(ret.verification.reason, 'verify_get_threw');
});

t('verify GET threw: WARNING text instructs the model not to claim success', () => {
  const ret = simulateVerifyGetThrew({ success: true }, 'ECONNRESET');
  assert.match(ret.verification.WARNING, /UNVERIFIED/);
  assert.match(ret.verification.WARNING, /Do NOT claim the change was applied/i);
});

t('verify GET threw: top-level message also flags the failure', () => {
  const ret = simulateVerifyGetThrew({ success: true }, 'timeout');
  assert.match(ret.message, /UNVERIFIED/);
  assert.match(ret.message, /⚠️/);
  assert.match(ret.message, /Do NOT claim/i);
});

t('verify GET returned no record: top-level success is false', () => {
  const ret = simulateVerifyGetReturnedNoRecord({ success: true, code: 'SUCCESS' }, '2570562000400116511');
  assert.equal(ret.success, false);
  assert.equal(ret.verification.success, false);
  assert.equal(ret.verification.reason, 'verify_get_returned_no_record');
});

t('verify-fail result is treated as error by askClaude harvesting (no whitelist)', () => {
  // Production logic: resultIsError = result.success === false || !!result.error || !!result.validation_error.
  // A verify-fail result must be classified as error so its ids are NOT
  // harvested into verifiedRecordsByModule.
  const ret = simulateVerifyGetThrew(
    { success: true, code: 'SUCCESS', data: { id: '2570562000400116511', code: 'SUCCESS' } },
    'fetch timeout'
  );
  const resultIsError = ret.success === false || !!ret.error || !!ret.validation_error;
  assert.ok(resultIsError, 'verify-fail must be classified as error so harvesting is skipped');

  // Now confirm: with NO whitelisting, a model-rendered Quote URL is stripped.
  const verified = new Map();
  if (!resultIsError) {
    const s = JSON.stringify(ret);
    const rx = /https:\/\/crm\.zoho\.com\/crm\/org\d+\/tab\/(Quotes|Deals|Accounts|Contacts|Tasks|Sales_Orders|Invoices|Products)\/(\d{15,19})/g;
    let mm;
    while ((mm = rx.exec(s)) !== null) {
      if (!verified.has(mm[1])) verified.set(mm[1], new Set());
      verified.get(mm[1]).add(mm[2]);
    }
  }
  assert.ok(!verified.has('Quotes'), 'no Quotes whitelist when verify failed');

  const reply = 'The quote was updated. [View Quote](https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400116511)';
  const guarded = applyTruthGuard(reply, verified, [{ isError: true, recordUrl: null }]);
  assert.ok(!/tab\/Quotes\/2570562000400116511/.test(guarded), 'URL stripped');
  assert.ok(/⚠️/.test(guarded), 'success-claim warning fires');
});

t('verify-fail does not include a usable Zoho URL anywhere in payload', () => {
  // Belt-and-suspenders: the verify-fail return must not embed a Quote URL
  // that could be harvested by the URL regex at a later stage.
  const ret = simulateVerifyGetThrew({ success: true }, 'transient');
  const serialized = JSON.stringify(ret);
  assert.ok(!/\/tab\/Quotes\/\d{15,19}/.test(serialized), 'no Quote URL in verify-fail payload');
});

console.log('\n─── Quote update undo: smart-diff + no-op fast path (Codex round-5) ───');

// Mirrors the production smart-diff algorithm in worker-gchat/src/index.js
// undo_crm_action update branch for module=Quotes. Validates that:
//   - identical sets → empty diff (no-op fast path fires)
//   - removed item in current → 1 add op, 0 deletes
//   - extra item in current → 0 adds, 1 delete
//   - mixed → both
//   - duplicates handled as multisets
// preState-empty refusal is shape-tested separately.

function buildItem(productId, qty, discount, subformId = null) {
  const item = {
    Product_Name: { id: productId },
    Quantity: qty,
    Discount: discount,
    List_Price: 1000,
    Description: `Item ${productId}`,
    Sequence_Number: 1,
  };
  if (subformId) item.id = subformId;
  return item;
}

function smartDiff(currentItems, preStateItems) {
  const itemKey = (it) => {
    const pid = it.Product_Name?.id || null;
    const qty = Number(it.Quantity || 0);
    const disc = Number(it.Discount || 0);
    if (!pid) return null;
    return `${pid}|${qty}|${disc.toFixed(2)}`;
  };
  const currentKeyToIds = new Map();
  for (const it of currentItems) {
    const k = itemKey(it);
    if (!k) continue;
    if (!currentKeyToIds.has(k)) currentKeyToIds.set(k, []);
    currentKeyToIds.get(k).push(it.id);
  }
  const preStateKeyCount = new Map();
  for (const it of preStateItems) {
    const k = itemKey(it);
    if (!k) continue;
    preStateKeyCount.set(k, (preStateKeyCount.get(k) || 0) + 1);
  }
  const idsToDelete = [];
  for (const [k, ids] of currentKeyToIds.entries()) {
    const want = preStateKeyCount.get(k) || 0;
    const have = ids.length;
    if (have > want) for (let i = want; i < have; i++) idsToDelete.push(ids[i]);
  }
  const itemsToAdd = [];
  for (const [k, want] of preStateKeyCount.entries()) {
    const have = (currentKeyToIds.get(k) || []).length;
    if (want > have) {
      let needed = want - have;
      for (const it of preStateItems) {
        if (needed === 0) break;
        if (itemKey(it) !== k) continue;
        itemsToAdd.push({
          Product_Name: { id: it.Product_Name.id },
          Quantity: it.Quantity,
          Discount: it.Discount,
        });
        needed--;
      }
    }
  }
  return { idsToDelete, itemsToAdd, equivalent: idsToDelete.length === 0 && itemsToAdd.length === 0 };
}

t('identical sets → equivalent (no-op fast path)', () => {
  const current = [
    buildItem('PID_A', 1, 100, 'sub_1'),
    buildItem('PID_B', 2, 200, 'sub_2'),
  ];
  const preState = [
    buildItem('PID_A', 1, 100),
    buildItem('PID_B', 2, 200),
  ];
  const d = smartDiff(current, preState);
  assert.equal(d.equivalent, true, 'must detect equivalence');
  assert.equal(d.idsToDelete.length, 0);
  assert.equal(d.itemsToAdd.length, 0);
});

t('same items different order → equivalent (set-wise comparison)', () => {
  const current = [buildItem('PID_A', 1, 100, 'sub_1'), buildItem('PID_B', 2, 200, 'sub_2')];
  const preState = [buildItem('PID_B', 2, 200), buildItem('PID_A', 1, 100)];
  assert.equal(smartDiff(current, preState).equivalent, true);
});

t('current has 1 extra item → 1 delete, 0 adds', () => {
  const current = [
    buildItem('PID_A', 1, 100, 'sub_1'),
    buildItem('PID_B', 2, 200, 'sub_2'),
    buildItem('PID_C', 1, 50, 'sub_3'),
  ];
  const preState = [buildItem('PID_A', 1, 100), buildItem('PID_B', 2, 200)];
  const d = smartDiff(current, preState);
  assert.equal(d.idsToDelete.length, 1);
  assert.equal(d.idsToDelete[0], 'sub_3');
  assert.equal(d.itemsToAdd.length, 0);
  assert.equal(d.equivalent, false);
});

t('preState has 1 item missing from current → 0 deletes, 1 add', () => {
  const current = [buildItem('PID_A', 1, 100, 'sub_1')];
  const preState = [buildItem('PID_A', 1, 100), buildItem('PID_B', 2, 200)];
  const d = smartDiff(current, preState);
  assert.equal(d.idsToDelete.length, 0);
  assert.equal(d.itemsToAdd.length, 1);
  assert.equal(d.itemsToAdd[0].Product_Name.id, 'PID_B');
});

t('mixed: current and preState differ in both directions', () => {
  const current = [buildItem('PID_A', 1, 100, 'sub_1'), buildItem('PID_X', 1, 50, 'sub_2')];
  const preState = [buildItem('PID_A', 1, 100), buildItem('PID_B', 2, 200)];
  const d = smartDiff(current, preState);
  assert.equal(d.idsToDelete.length, 1);
  assert.equal(d.idsToDelete[0], 'sub_2');
  assert.equal(d.itemsToAdd.length, 1);
  assert.equal(d.itemsToAdd[0].Product_Name.id, 'PID_B');
});

t('quantity mismatch produces delete+add (not stable)', () => {
  const current = [buildItem('PID_A', 1, 100, 'sub_1')];
  const preState = [buildItem('PID_A', 5, 100)];
  const d = smartDiff(current, preState);
  // Different (pid, qty, disc) keys → treated as separate items
  assert.equal(d.idsToDelete.length, 1);
  assert.equal(d.itemsToAdd.length, 1);
});

t('discount drift < 1¢ treated as same (toFixed(2) tolerance)', () => {
  const current = [buildItem('PID_A', 1, 100.001, 'sub_1')];
  const preState = [buildItem('PID_A', 1, 100.002)];
  const d = smartDiff(current, preState);
  assert.equal(d.equivalent, true, 'sub-cent drift must not produce a diff');
});

t('duplicates handled as multisets (3 of same SKU in both → equivalent)', () => {
  const current = [
    buildItem('PID_A', 1, 100, 'sub_1'),
    buildItem('PID_A', 1, 100, 'sub_2'),
    buildItem('PID_A', 1, 100, 'sub_3'),
  ];
  const preState = [
    buildItem('PID_A', 1, 100),
    buildItem('PID_A', 1, 100),
    buildItem('PID_A', 1, 100),
  ];
  assert.equal(smartDiff(current, preState).equivalent, true);
});

t('duplicates: 3 in current, 2 in preState → exactly 1 delete', () => {
  const current = [
    buildItem('PID_A', 1, 100, 'sub_1'),
    buildItem('PID_A', 1, 100, 'sub_2'),
    buildItem('PID_A', 1, 100, 'sub_3'),
  ];
  const preState = [buildItem('PID_A', 1, 100), buildItem('PID_A', 1, 100)];
  const d = smartDiff(current, preState);
  assert.equal(d.idsToDelete.length, 1);
  assert.equal(d.idsToDelete[0], 'sub_3', 'last dup deleted to keep earlier sequence numbers stable');
  assert.equal(d.itemsToAdd.length, 0);
});

// Reproduces the exact live failure shape: Quote 2570562000402426396, 6 items
// (3 hardware + 3 license rows), Grand_Total $9,105.02, current matches preState
// because the prior "remove the licenses" PUT was silently rejected by Zoho.
t('LIVE REPRO Quote 2570562000402426396: 6 items unchanged → no-op fast path', () => {
  const items = [
    { Product_Name: { id: '2570562000064739443' }, Quantity: 1, Discount: 941, id: '2570562000402426397' },  // MX75-HW
    { Product_Name: { id: '2570562000064739383' }, Quantity: 1, Discount: 887, id: '2570562000402426398' },  // LIC-MX75-SEC-1Y
    { Product_Name: { id: '2570562000064739444' }, Quantity: 1, Discount: 703, id: '2570562000402426399' },  // MX85-HW
    { Product_Name: { id: '2570562000064739398' }, Quantity: 1, Discount: 804, id: '2570562000402426400' },  // LIC-MX85-SEC-1Y
    { Product_Name: { id: '2570562000297110189' }, Quantity: 2, Discount: 1714, id: '2570562000402426401' }, // CW9172I-RTG x2
    { Product_Name: { id: '2570562000001098894' }, Quantity: 2, Discount: 168, id: '2570562000402426402' },  // LIC-ENT-1YR x2
  ];
  // preState = same 6 items (because Zoho rejected the change)
  const preStateMirror = items.map(({ id, ...rest }) => rest);
  const d = smartDiff(items, preStateMirror);
  assert.equal(d.equivalent, true, 'no-op fast path must fire on this exact live failure shape');
  assert.equal(d.idsToDelete.length, 0);
  assert.equal(d.itemsToAdd.length, 0);
});

t('LIVE REPRO follow-up: licenses actually removed → 3 deletes, 0 adds', () => {
  // Counterfactual: if the "remove licenses" PUT had succeeded, current would
  // be HW-only (3 items). The undo would then delete nothing extra and re-add
  // the 3 license rows.
  const current = [
    { Product_Name: { id: '2570562000064739443' }, Quantity: 1, Discount: 941, id: '2570562000402426397' },
    { Product_Name: { id: '2570562000064739444' }, Quantity: 1, Discount: 703, id: '2570562000402426399' },
    { Product_Name: { id: '2570562000297110189' }, Quantity: 2, Discount: 1714, id: '2570562000402426401' },
  ];
  const preState = [
    { Product_Name: { id: '2570562000064739443' }, Quantity: 1, Discount: 941 },
    { Product_Name: { id: '2570562000064739383' }, Quantity: 1, Discount: 887 },
    { Product_Name: { id: '2570562000064739444' }, Quantity: 1, Discount: 703 },
    { Product_Name: { id: '2570562000064739398' }, Quantity: 1, Discount: 804 },
    { Product_Name: { id: '2570562000297110189' }, Quantity: 2, Discount: 1714 },
    { Product_Name: { id: '2570562000001098894' }, Quantity: 2, Discount: 168 },
  ];
  const d = smartDiff(current, preState);
  assert.equal(d.idsToDelete.length, 0, 'no current items need deleting (all 3 hardware match preState)');
  assert.equal(d.itemsToAdd.length, 3, 'three license rows must be re-added');
  const addedPids = d.itemsToAdd.map(i => i.Product_Name.id).sort();
  assert.deepEqual(addedPids, ['2570562000001098894', '2570562000064739383', '2570562000064739398'].sort());
});

t('Empty preState would refuse: caller must check before building payload', () => {
  // The algorithm does NOT short-circuit on empty preState — that gate lives
  // in the production caller. Document the invariant.
  const current = [buildItem('PID_A', 1, 100, 'sub_1')];
  const d = smartDiff(current, []);
  // Diff says: delete the one current item (would leave 0 items).
  // Production caller must intercept: preStateItems.length === 0 → refuse.
  assert.equal(d.idsToDelete.length, 1);
  assert.equal(d.itemsToAdd.length, 0);
});

console.log('\n─── Bug C: update verification false-negative on silent rejection (Codex round-6) ───');

// Mirror the production verification logic for zoho_update_record on Quotes.
// Key invariants:
//   - Outer gate runs whenever module === 'Quotes' && success — NOT gated on data.Quoted_Items.
//   - Per-item delete/modify checks gate on data.Quoted_Items having actual intents.
//   - No-op detection (anyItemChanged + totals) ALWAYS runs when preUpdateSnapshot exists.
//   - Scalar-persistence check fires when any data[k] (excluding derived/Quoted_Items) didn't persist.
//   - Tolerant valuesEqual handles picklist string-vs-object, reference id, float drift.

// Re-declared locally so the test runs without loading the worker module.
const SCALAR_VERIFY_EXCLUDE = new Set([
  'Quoted_Items', 'Do_Not_Auto_Update_Prices',
  'Tax', 'Grand_Total', 'Sub_Total', 'Adjustment',
  'All_Taxes_Total', 'Tax_1_Total', 'Tax_2_Total',
  'Modified_Time', 'Last_Activity_Time', 'Modified_By',
  'Created_Time', 'Created_By',
]);

function valuesEqual(pre, post) {
  if (pre === post) return true;
  if (pre == null && post == null) return true;
  if (pre == null || post == null) return false;
  if (typeof pre === 'number' && typeof post === 'number') return Math.abs(pre - post) < 0.01;
  if (typeof pre === 'string' && typeof post === 'object') return pre === post.name || pre === post.id || pre === String(post);
  if (typeof post === 'string' && typeof pre === 'object') return post === pre.name || post === pre.id || post === String(pre);
  if (typeof pre === 'object' && typeof post === 'object') {
    if (Array.isArray(pre) || Array.isArray(post)) {
      if (!Array.isArray(pre) || !Array.isArray(post)) return false;
      if (pre.length !== post.length) return false;
      return pre.every((v, i) => valuesEqual(v, post[i]));
    }
    if (pre.id != null && post.id != null) return String(pre.id) === String(post.id);
    try { return JSON.stringify(pre) === JSON.stringify(post); } catch { return false; }
  }
  if (typeof pre === 'boolean' || typeof post === 'boolean') return Boolean(pre) === Boolean(post);
  return String(pre) === String(post);
}

// Compute the scalar-persistence categories the production check produces.
function computeScalarPersistence(data, preSnap, postRec) {
  const tried = Object.keys(data).filter(k => !SCALAR_VERIFY_EXCLUDE.has(k));
  const persisted = [];
  const dropped = [];
  const alreadyMatched = [];
  for (const k of tried) {
    const wasIntended = !valuesEqual(preSnap[k], data[k]);
    const actuallyChanged = !valuesEqual(preSnap[k], postRec[k]);
    if (!wasIntended) alreadyMatched.push(k);
    else if (actuallyChanged) persisted.push(k);
    else dropped.push(k);
  }
  return { tried, persisted, dropped, already_matched: alreadyMatched };
}

// Compute item-side change indicator from pre/post snapshots.
function computeItemChange(preSnap, postRec) {
  const preItemsById = new Map((preSnap.Quoted_Items || []).map(i => [i.id, {
    discount: Number(i.Discount || 0),
    quantity: Number(i.Quantity || 0),
    product_id: i.Product_Name?.id || null,
  }]));
  const postItems = postRec.Quoted_Items || [];
  let any = false;
  for (const post of postItems) {
    const pre = preItemsById.get(post.id);
    if (!pre) { any = true; break; }
    if (Math.abs(pre.discount - Number(post.Discount || 0)) > 0.01) { any = true; break; }
    if (pre.quantity !== Number(post.Quantity || 0)) { any = true; break; }
  }
  if (preItemsById.size !== postItems.length) any = true;
  const totalChanged = Math.abs(Number(preSnap.Grand_Total || 0) - Number(postRec.Grand_Total || 0)) > 0.01;
  const subChanged = Math.abs(Number(preSnap.Sub_Total || 0) - Number(postRec.Sub_Total || 0)) > 0.01;
  return { anyItemChanged: any, totalChanged, subChanged };
}

t('valuesEqual: number tolerance < 1¢', () => {
  assert.equal(valuesEqual(100.001, 100.002), true);
  assert.equal(valuesEqual(100, 100.5), false);
});

t('valuesEqual: picklist write-string vs read-object', () => {
  // Zoho returns Stage as {name:"Review", id:"..."} on read but accepts string on write.
  assert.equal(valuesEqual('Review', { name: 'Review', id: '12345' }), true);
  assert.equal(valuesEqual({ name: 'Review', id: '12345' }, 'Review'), true);
  assert.equal(valuesEqual('Negotiation', { name: 'Review', id: '12345' }), false);
});

t('valuesEqual: reference object equality by id', () => {
  assert.equal(valuesEqual({ id: 'A', name: 'x' }, { id: 'A', name: 'y' }), true);
  assert.equal(valuesEqual({ id: 'A' }, { id: 'B' }), false);
});

t('valuesEqual: arrays element-wise', () => {
  assert.equal(valuesEqual([1, 2, 3], [1, 2, 3]), true);
  assert.equal(valuesEqual([1, 2], [1, 2, 3]), false);
});

t('valuesEqual: null/undefined handling', () => {
  assert.equal(valuesEqual(null, null), true);
  assert.equal(valuesEqual(undefined, undefined), true);
  assert.equal(valuesEqual(null, 'value'), false);
});

// ── Live failure shape: Quote 2570562000402426396 ──
// pre and post both have 6 identical items @ $9,105.02. Llama's PUT included
// Quoted_Items intents (likely _delete on the licenses) but Zoho silently
// rejected them. Modified_Time advanced; everything else unchanged.
t('LIVE REPRO Quote 2570562000402426396: items unchanged → ZOHO_DROPPED_QUOTED_ITEMS warning', () => {
  const items = [
    { Product_Name: { id: 'PID_MX75' }, Quantity: 1, Discount: 941, id: 'sub_1' },
    { Product_Name: { id: 'PID_LIC_MX75' }, Quantity: 1, Discount: 887, id: 'sub_2' },
    { Product_Name: { id: 'PID_MX85' }, Quantity: 1, Discount: 703, id: 'sub_3' },
    { Product_Name: { id: 'PID_LIC_MX85' }, Quantity: 1, Discount: 804, id: 'sub_4' },
    { Product_Name: { id: 'PID_CW9172I' }, Quantity: 2, Discount: 1714, id: 'sub_5' },
    { Product_Name: { id: 'PID_LIC_ENT' }, Quantity: 2, Discount: 168, id: 'sub_6' },
  ];
  const preSnap = { Quoted_Items: items, Grand_Total: 9105.02, Sub_Total: 9105.0152 };
  const postRec = { Quoted_Items: items, Grand_Total: 9105.02, Sub_Total: 9105.0152 };
  const data = {
    Quoted_Items: [
      { id: 'sub_2', _delete: null }, // license removal intent
      { id: 'sub_4', _delete: null },
      { id: 'sub_6', _delete: null },
    ],
  };

  const { anyItemChanged, totalChanged, subChanged } = computeItemChange(preSnap, postRec);
  assert.equal(anyItemChanged, false, 'no item-side change');
  assert.equal(totalChanged, false);
  assert.equal(subChanged, false);

  const triedQuotedItems = Array.isArray(data.Quoted_Items) && data.Quoted_Items.length > 0;
  const shouldFire = triedQuotedItems && !anyItemChanged && !totalChanged && !subChanged;
  assert.equal(shouldFire, true, 'ZOHO_DROPPED_QUOTED_ITEMS warning must fire on this exact scenario');
});

t('Scalar-only legitimate update: scalar persisted → no warning', () => {
  // Llama updates Subject. Zoho accepts. Pre.Subject differs from post.Subject.
  const preSnap = { Subject: 'Old Title', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const postRec = { Subject: 'New Title', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const data = { Subject: 'New Title' };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  assert.deepEqual(sp.persisted, ['Subject']);
  assert.deepEqual(sp.dropped, []);
  assert.deepEqual(sp.already_matched, []);
});

t('Scalar-only silently rejected: scalar dropped → ZOHO_REJECTED_SCALARS warning', () => {
  const preSnap = { Subject: 'Old', Stage: 'Negotiation', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const postRec = { Subject: 'Old', Stage: 'Negotiation', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const data = { Subject: 'New', Stage: 'Closed Won' };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  assert.deepEqual(sp.persisted, []);
  assert.deepEqual(sp.dropped.sort(), ['Stage', 'Subject'].sort());
  assert.equal(sp.dropped.length, 2, 'both fields must be flagged as dropped');
});

t('Scalar set to current value: not flagged (already_matched, not dropped)', () => {
  // Llama tries to "set" Subject to its existing value. Zoho's no-change
  // is benign — must not generate a false-positive warning.
  const preSnap = { Subject: 'Same', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const postRec = { Subject: 'Same', Grand_Total: 5000, Sub_Total: 5000, Quoted_Items: [] };
  const data = { Subject: 'Same' };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  assert.deepEqual(sp.dropped, []);
  assert.deepEqual(sp.already_matched, ['Subject']);
});

t('Mixed scalar+items: scalar persisted, items unchanged → only ZOHO_DROPPED_QUOTED_ITEMS', () => {
  const items = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 0, id: 'sub_1' }];
  const preSnap = { Subject: 'Old', Quoted_Items: items, Grand_Total: 1000, Sub_Total: 1000 };
  const postRec = { Subject: 'New', Quoted_Items: items, Grand_Total: 1000, Sub_Total: 1000 };
  const data = { Subject: 'New', Quoted_Items: [{ id: 'sub_1', _delete: null }] };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  const ic = computeItemChange(preSnap, postRec);
  // Scalar OK
  assert.deepEqual(sp.persisted, ['Subject']);
  assert.deepEqual(sp.dropped, []);
  // Items dropped → DROPPED_QUOTED_ITEMS would fire
  const triedQI = Array.isArray(data.Quoted_Items) && data.Quoted_Items.length > 0;
  const itemsWarn = triedQI && !ic.anyItemChanged && !ic.totalChanged && !ic.subChanged;
  assert.equal(itemsWarn, true);
});

t('Mixed scalar+items: scalar dropped AND items unchanged → BOTH warnings', () => {
  const items = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 0, id: 'sub_1' }];
  const preSnap = { Subject: 'Old', Quoted_Items: items, Grand_Total: 1000, Sub_Total: 1000 };
  const postRec = { Subject: 'Old', Quoted_Items: items, Grand_Total: 1000, Sub_Total: 1000 };
  const data = { Subject: 'New', Quoted_Items: [{ id: 'sub_1', _delete: null }] };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  const ic = computeItemChange(preSnap, postRec);
  assert.deepEqual(sp.dropped, ['Subject']);
  assert.equal(ic.anyItemChanged, false);
  // Both warnings should fire in production
});

t('Picklist field equality tolerance: write-string vs read-object — no false-positive', () => {
  // Llama writes `Stage: 'Review'` as a string. Zoho returns `Stage: {name: 'Review', id: '...'}`.
  // The persistence check must NOT flag this as dropped.
  const preSnap = { Stage: { name: 'Negotiation', id: '12345' }, Grand_Total: 0, Sub_Total: 0, Quoted_Items: [] };
  const postRec = { Stage: { name: 'Review', id: '67890' }, Grand_Total: 0, Sub_Total: 0, Quoted_Items: [] };
  const data = { Stage: 'Review' };
  const sp = computeScalarPersistence(data, preSnap, postRec);
  assert.deepEqual(sp.persisted, ['Stage'], 'string-write-then-object-read must register as persisted');
  assert.deepEqual(sp.dropped, []);
});

t('Excluded fields: Tax/Grand_Total/etc never appear in scalar checks', () => {
  // Even if data contained these, they should not be evaluated.
  const preSnap = { Subject: 'A', Grand_Total: 100, Sub_Total: 100, Tax: 7, Quoted_Items: [] };
  const postRec = { Subject: 'A', Grand_Total: 100, Sub_Total: 100, Tax: 7, Quoted_Items: [] };
  const data = { Grand_Total: 99, Sub_Total: 99, Tax: 6.93, Adjustment: 0 }; // all excluded
  const sp = computeScalarPersistence(data, preSnap, postRec);
  assert.deepEqual(sp.tried, [], 'no fields tried after exclusion');
  assert.deepEqual(sp.dropped, []);
  assert.deepEqual(sp.persisted, []);
});

t('Live-failure end-to-end: verify-fail result is treated as error by askClaude harvesting', () => {
  // Simulate the production verification block result for Quote 2570562000402426396.
  const verification = {
    success: false,
    code: 'SUCCESS',
    data: { id: '2570562000402426396' },
    message: '⚠️ Zoho returned SUCCESS but verification detected the changes did not actually land. See verification.WARNING.',
    verification: {
      success: false,
      WARNING: 'ZOHO_DROPPED_QUOTED_ITEMS: ... | ZOHO_REJECTED_SCALARS: ...',
      actual_item_count: 6,
      grand_total: 9105.02,
    },
  };
  const resultIsError = verification.success === false || !!verification.error || !!verification.validation_error;
  assert.ok(resultIsError, 'verify-fail must classify as error so harvesting skips whitelisting');

  // Confirm no Quote URL in payload could be harvested
  const verified = new Map();
  if (!resultIsError) {
    const s = JSON.stringify(verification);
    const rx = /https:\/\/crm\.zoho\.com\/crm\/org\d+\/tab\/(Quotes|Deals|Accounts|Contacts|Tasks|Sales_Orders|Invoices|Products)\/(\d{15,19})/g;
    let mm;
    while ((mm = rx.exec(s)) !== null) {
      if (!verified.has(mm[1])) verified.set(mm[1], new Set());
      verified.get(mm[1]).add(mm[2]);
    }
  }
  assert.ok(!verified.has('Quotes'), 'no Quote URL whitelisted on verify-fail');
});

console.log('\n─── Multiset row fingerprint + undo-token suppression (Codex round-7) ───');

// Mirrors the production fingerprint helpers added in the verification block.
function itemFingerprintKey(it) {
  const pid = it.Product_Name?.id || null;
  const qty = Number(it.Quantity || 0);
  const disc = Number(it.Discount != null ? it.Discount : (it.discount || 0));
  if (!pid) return null;
  return `${pid}|${qty}|${disc.toFixed(2)}`;
}
function fingerprintMultiset(items) {
  const m = new Map();
  for (const it of items || []) {
    const k = itemFingerprintKey(it);
    if (!k) continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return m;
}
function fingerprintEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, c] of a) if (b.get(k) !== c) return false;
  return true;
}

t('fingerprint: identical sets match regardless of subform-id changes', () => {
  const pre = [
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_OLD_1' },
    { Product_Name: { id: 'PID_B' }, Quantity: 2, Discount: 50, id: 'sub_OLD_2' },
  ];
  const post = [
    { Product_Name: { id: 'PID_B' }, Quantity: 2, Discount: 50, id: 'sub_NEW_X' },  // Zoho regenerated id
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_NEW_Y' },  // and reordered
  ];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), true,
    'fingerprint must be invariant to subform id regeneration AND ordering');
});

t('fingerprint: different quantity → mismatch', () => {
  const pre = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' }];
  const post = [{ Product_Name: { id: 'PID_A' }, Quantity: 2, Discount: 100, id: 'sub_1' }];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), false);
});

t('fingerprint: different discount > 1¢ → mismatch', () => {
  const pre = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' }];
  const post = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 99, id: 'sub_1' }];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), false);
});

t('fingerprint: discount drift < 1¢ → match (toFixed(2) tolerance)', () => {
  const pre = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100.001, id: 'sub_1' }];
  const post = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100.002, id: 'sub_1' }];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), true);
});

t('fingerprint: missing item → mismatch', () => {
  const pre = [
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' },
    { Product_Name: { id: 'PID_B' }, Quantity: 1, Discount: 50, id: 'sub_2' },
  ];
  const post = [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' }];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), false);
});

t('fingerprint: duplicate items as multiset (3-of-A pre vs 2-of-A post → mismatch)', () => {
  const pre = [
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' },
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_2' },
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_3' },
  ];
  const post = [
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_4' },
    { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_5' },
  ];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), false,
    'dropping one duplicate must register as mismatch even with regenerated ids');
});

t('LIVE REPRO Quote 2570562000402426396: fingerprint matches with regenerated subform ids', () => {
  // Hypothetical: even if Zoho regenerated all subform ids during the
  // silent-rejected PUT, the fingerprint match would still detect no-op.
  const items = [
    { Product_Name: { id: 'PID_MX75' }, Quantity: 1, Discount: 941 },
    { Product_Name: { id: 'PID_LIC_MX75' }, Quantity: 1, Discount: 887 },
    { Product_Name: { id: 'PID_MX85' }, Quantity: 1, Discount: 703 },
    { Product_Name: { id: 'PID_LIC_MX85' }, Quantity: 1, Discount: 804 },
    { Product_Name: { id: 'PID_CW9172I' }, Quantity: 2, Discount: 1714 },
    { Product_Name: { id: 'PID_LIC_ENT' }, Quantity: 2, Discount: 168 },
  ];
  const pre = items.map((it, i) => ({ ...it, id: `pre_${i}` }));
  const post = items.map((it, i) => ({ ...it, id: `post_REGEN_${i}` })); // ids regenerated
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), true,
    'fingerprint must match on this exact live failure even if Zoho regenerated subform ids');
  // Therefore: ZOHO_DROPPED_QUOTED_ITEMS must fire regardless of id regeneration.
});

t('Real change is still caught: licenses removed → fingerprint mismatch', () => {
  const pre = [
    { Product_Name: { id: 'PID_HW1' }, Quantity: 1, Discount: 941 },
    { Product_Name: { id: 'PID_LIC1' }, Quantity: 1, Discount: 887 },
    { Product_Name: { id: 'PID_HW2' }, Quantity: 1, Discount: 703 },
  ];
  const post = [
    { Product_Name: { id: 'PID_HW1' }, Quantity: 1, Discount: 941, id: 'sub_x' },
    { Product_Name: { id: 'PID_HW2' }, Quantity: 1, Discount: 703, id: 'sub_y' },
  ];
  assert.equal(fingerprintEqual(fingerprintMultiset(pre), fingerprintMultiset(post)), false,
    'real license removal MUST register as fingerprint mismatch (not a no-op)');
});

console.log('\n─── Undo-token suppression on verify-fail (Codex round-7) ───');

// Mirror the askClaude truth-guard injection guards — the `!last.isError`
// gate added in this commit. A failed mutation must NEVER cause an undo
// token or [Open in Zoho] link to be appended to the user reply.

function simulateInjection(finalReplyIn, last) {
  let finalReply = finalReplyIn;
  const replyHasToken = last.undoToken && finalReply.includes(last.undoToken);
  const replyHasUrl = last.recordUrl && finalReply.includes(last.recordUrl);
  const hasAnyToken = /`u_[a-z0-9_-]+`/i.test(finalReply) || /\bundo\s+token/i.test(finalReply);
  if (!last.isError && last.undoToken && !replyHasToken && !hasAnyToken) {
    if (!replyHasUrl && last.recordUrl) {
      finalReply = `${finalReply.trim()}\n\n${last.summary}`;
    } else {
      finalReply = `${finalReply.trim()}\n\nUndo token: \`${last.undoToken}\` (say "undo" to reverse).`;
    }
  } else if (!last.isError && last.recordUrl && !replyHasUrl && !/\[Open in Zoho\]/i.test(finalReply) && !/https:\/\/crm\.zoho\.com/i.test(finalReply)) {
    finalReply = `${finalReply.trim()}\n\n[Open in Zoho](${last.recordUrl})`;
  }
  return finalReply;
}

t('Failed mutation: undo token NOT injected', () => {
  const out = simulateInjection(
    'Update attempted.',
    { isError: true, undoToken: 'u_c7214a00', recordUrl: null, summary: 'failed', toolName: 'zoho_update_record' }
  );
  assert.ok(!out.includes('u_c7214a00'), 'undo token must NOT appear');
  assert.ok(!/say "undo" to reverse/i.test(out), 'undo prompt must NOT appear');
});

t('Failed mutation: [Open in Zoho] NOT injected', () => {
  const out = simulateInjection(
    'Update attempted.',
    { isError: true, undoToken: null, recordUrl: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000402426396', summary: 'failed', toolName: 'zoho_update_record' }
  );
  assert.ok(!/Open in Zoho/i.test(out), 'Open in Zoho link must NOT appear on failed mutation');
});

t('Successful mutation: undo token IS injected (regression — round-7 only added gate, not removed function)', () => {
  const out = simulateInjection(
    'Update applied.',
    { isError: false, undoToken: 'u_abc123', recordUrl: null, summary: 'success', toolName: 'zoho_update_record' }
  );
  assert.ok(/u_abc123/.test(out), 'undo token must still appear for successful mutations');
});

t('Successful mutation: [Open in Zoho] IS injected when missing', () => {
  const url = 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000400000001';
  const out = simulateInjection(
    'Update applied.',
    { isError: false, undoToken: null, recordUrl: url, summary: 'success', toolName: 'zoho_update_record' }
  );
  assert.ok(out.includes(url), 'Zoho link must still be injected on success');
});

t('Failed mutation: error summary still injected (separate path)', () => {
  // The error-summary injection (lines 11378-11386) is a separate gate that
  // explicitly fires WHEN last.isError is true. That stays unchanged so the
  // user sees the verbatim warning text.
  let finalReply = 'The model said something';
  const last = { isError: true, summary: 'ZOHO_DROPPED_QUOTED_ITEMS: line items unchanged.' };
  if (last.isError && last.summary) {
    const keyPhrase = last.summary.split(/[.!?]/)[0].trim().slice(0, 80);
    if (keyPhrase && !finalReply.toLowerCase().includes(keyPhrase.toLowerCase())) {
      finalReply = `${finalReply.trim()}\n\n${last.summary}`;
    }
  }
  assert.ok(/ZOHO_DROPPED_QUOTED_ITEMS/.test(finalReply), 'error summary still surfaces');
});

t('Verify-fail return shape: no _undo_token, no _record_url, _user_visible_summary is the warning', () => {
  // Production verification block result shape after warnings fire.
  const result = {
    success: false,
    code: 'SUCCESS',
    data: { id: '2570562000402426396' },
    message: '⚠️ Update on Quote 2570562000402426396 was NOT applied. ZOHO_DROPPED_QUOTED_ITEMS: ...',
    verification: {
      success: false,
      WARNING: 'ZOHO_DROPPED_QUOTED_ITEMS: ...',
    },
    _user_visible_summary: '⚠️ Update on Quote 2570562000402426396 was NOT applied. ZOHO_DROPPED_QUOTED_ITEMS: ...',
    // No _undo_token, no _record_url
  };
  assert.equal(result._undo_token, undefined);
  assert.equal(result._record_url, undefined);
  assert.match(result._user_visible_summary, /NOT applied/);
  assert.match(result._user_visible_summary, /⚠️/);
});

console.log('\n─── Quote undo STRIP + spread-order (Codex round-8 pre-merge) ───');

// Mirrors the production STRIP set used by the undo update branch for Quotes.
const UNDO_STRIP = new Set([
  'id', 'Created_Time', 'Modified_Time', 'Created_By', 'Modified_By',
  'Last_Activity_Time', 'Owner', '$editable',
  'Quote_Number', 'Tax', 'Grand_Total', 'Sub_Total', 'Adjustment', 'Layout',
  'All_Taxes_Total', 'Tax_1_Total', 'Tax_2_Total',
  'Do_Not_Auto_Update_Prices',
]);

function buildScalarRestore(preState) {
  const out = {};
  for (const [k, v] of Object.entries(preState)) {
    if (UNDO_STRIP.has(k) || k.startsWith('$') || k === 'Quoted_Items') continue;
    out[k] = v;
  }
  return out;
}

t('Live no-op undo: preState has only items+totals+control flag → scalarRestore is empty', () => {
  // Reproduces the exact preState shape Bug C's snapshot logic produces
  // for a Quote update where data only contained Quoted_Items.
  const preState = {
    id: '2570562000402426396',
    Quoted_Items: [
      { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' },
    ],
    Grand_Total: 9105.02,
    Sub_Total: 9105.0152,
    Do_Not_Auto_Update_Prices: true,
  };
  const sr = buildScalarRestore(preState);
  assert.deepEqual(sr, {}, 'scalarRestore must be empty so no-op fast path returns NO_OP without PUT');
});

t('Live no-op undo: preState with derived totals included → all stripped', () => {
  const preState = {
    id: '2570562000402426396',
    Quoted_Items: [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100, id: 'sub_1' }],
    Grand_Total: 9105.02,
    Sub_Total: 9105.0152,
    Tax: 421.91,
    All_Taxes_Total: 421.91,
    Tax_1_Total: 421.91,
    Tax_2_Total: 0,
    Adjustment: 0,
    Quote_Number: '2570562000402426403',
    Do_Not_Auto_Update_Prices: true,
    Modified_Time: '2026-04-24T18:55:43-04:00',
    Last_Activity_Time: '2026-04-24T18:55:43-04:00',
    Modified_By: { id: '...', name: 'Tim' },
  };
  const sr = buildScalarRestore(preState);
  assert.deepEqual(sr, {}, 'all derived totals + system fields + control flag must be stripped');
});

t('Real scalar to restore (Subject change): scalarRestore preserves it', () => {
  const preState = {
    id: 'Q1',
    Quoted_Items: [],
    Grand_Total: 1000,
    Sub_Total: 1000,
    Do_Not_Auto_Update_Prices: true,
    Subject: 'Original Subject',
    Stage: 'Negotiation',
  };
  const sr = buildScalarRestore(preState);
  assert.deepEqual(sr, { Subject: 'Original Subject', Stage: 'Negotiation' });
});

t('Mixed restore payload: Do_Not_Auto_Update_Prices:true comes AFTER spread', () => {
  // Production code: const restorePayload = { ...scalarRestore, Do_Not_Auto_Update_Prices: true };
  // Even if a malicious/unexpected scalarRestore contained Do_Not_Auto_Update_Prices:false,
  // the literal `: true` after the spread must override.
  const scalarRestore = { Subject: 'Old', Do_Not_Auto_Update_Prices: false }; // hypothetical leak
  const payload = { ...scalarRestore, Do_Not_Auto_Update_Prices: true };
  assert.equal(payload.Do_Not_Auto_Update_Prices, true, 'literal-after-spread must win');
  assert.equal(payload.Subject, 'Old', 'other restored scalars preserved');
});

t('No-op fast path scalar PUT: spread-then-literal locks the flag too', () => {
  // The no-op fast path uses the same pattern.
  const scalarRestore = { Subject: 'X', Do_Not_Auto_Update_Prices: false };
  const scalarPayload = { ...scalarRestore, Do_Not_Auto_Update_Prices: true };
  assert.equal(scalarPayload.Do_Not_Auto_Update_Prices, true);
});

t('Mixed restore payload: derived totals never appear', () => {
  // After STRIP filtering, Grand_Total/Sub_Total/Tax/etc. never end up in scalarRestore
  // and therefore never appear in the mixed restorePayload.
  const preState = {
    id: 'Q1',
    Quoted_Items: [],
    Grand_Total: 5000, Sub_Total: 5000, Tax: 350, All_Taxes_Total: 350,
    Tax_1_Total: 350, Tax_2_Total: 0, Adjustment: 0,
    Subject: 'Old',
  };
  const sr = buildScalarRestore(preState);
  const payload = { ...sr, Do_Not_Auto_Update_Prices: true };
  for (const f of ['Grand_Total', 'Sub_Total', 'Tax', 'All_Taxes_Total', 'Tax_1_Total', 'Tax_2_Total', 'Adjustment']) {
    assert.equal(payload[f], undefined, `${f} must not appear in restore payload`);
  }
  assert.equal(payload.Subject, 'Old');
  assert.equal(payload.Do_Not_Auto_Update_Prices, true);
});

t('Live no-op undo end-to-end: itemsetEquivalent=true + empty scalarRestore → pure NO_OP, no PUT call', () => {
  // Compose the production logic shape from the no-op fast path.
  const preState = {
    id: '2570562000402426396',
    Quoted_Items: [
      { Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 100 },
    ],
    Grand_Total: 9105.02,
    Sub_Total: 9105.0152,
    Do_Not_Auto_Update_Prices: true,
  };
  const itemsetEquivalent = true;  // assumption from smart-diff
  const sr = buildScalarRestore(preState);
  let didPUT = false;
  let resultMessage = null;
  if (itemsetEquivalent) {
    if (Object.keys(sr).length > 0) {
      didPUT = true; // would have called zohoApiCall('PUT', ...)
    } else {
      resultMessage = 'No-op — prior mutation did not actually change the quote.';
    }
  }
  assert.equal(didPUT, false, 'no PUT must be issued in the live no-op case');
  assert.match(resultMessage, /No-op/);
});

console.log('\n─── Omission-style delete normalizer (Codex round-9) ───');

// Mirrors the production normalizer added to zoho_update_record before the
// Quote PUT. Exercises:
//   - all-id-only strict subset → convert omitted current ids to delete ops
//   - all-id-only equals current → reject (no-op intent)
//   - all-id-only with unknown id → reject
//   - mixed id-only + explicit ops → reject
//   - duplicate ids in keep-list → reject
//   - Do_Not_Auto_Update_Prices preserved through normalization

const isQuoteRowIdOnly = (row) => {
  if (!row || typeof row !== 'object' || !row.id) return false;
  const meaningfulKeys = ['_delete', 'Product_Name', 'Quantity', 'Discount', 'List_Price', 'Description', 'Sequence_Number', 'Tax'];
  for (const k of meaningfulKeys) {
    if (k in row && row[k] !== undefined) return false;
  }
  return true;
};

function normalizeKeepList(data, preUpdateSnapshot, recordId = 'Q1') {
  if (!Array.isArray(data.Quoted_Items)) return { data, normalized: false };
  const hasCurrentItems = preUpdateSnapshot
    && Array.isArray(preUpdateSnapshot.Quoted_Items)
    && preUpdateSnapshot.Quoted_Items.length > 0;

  // Round-10 (a): empty Quoted_Items + non-empty current → reject.
  if (data.Quoted_Items.length === 0 && hasCurrentItems) {
    return { error: 'empty_quoted_items_rejected', current_count: preUpdateSnapshot.Quoted_Items.length };
  }

  if (data.Quoted_Items.length === 0) return { data, normalized: false };

  const allIdOnly = data.Quoted_Items.every(isQuoteRowIdOnly);
  const someIdOnly = data.Quoted_Items.some(isQuoteRowIdOnly);

  // Round-10 (b): all-id-only without snapshot → reject.
  if (allIdOnly && !hasCurrentItems) {
    return { error: 'keep_list_snapshot_unavailable' };
  }

  if (allIdOnly) {
    const currentIds = new Set(preUpdateSnapshot.Quoted_Items.map(it => it.id).filter(Boolean));
    const keptIds = data.Quoted_Items.map(r => r.id);
    const keptSet = new Set(keptIds);
    if (keptIds.length !== keptSet.size) {
      return { error: 'keep_list_duplicate_ids' };
    }
    const unknownIds = keptIds.filter(id => !currentIds.has(id));
    if (unknownIds.length > 0) {
      return { error: 'keep_list_unknown_ids', unknown_ids: unknownIds };
    }
    const omittedIds = [...currentIds].filter(id => !keptSet.has(id));
    if (omittedIds.length === 0) {
      return { error: 'keep_list_matches_all_current' };
    }
    const newQuotedItems = omittedIds.map(id => ({ id, _delete: null }));
    return {
      data: { ...data, Quoted_Items: newQuotedItems },
      normalized: true,
      normalization: { original_kept_ids: keptIds, converted_delete_ids: omittedIds },
    };
  } else if (someIdOnly) {
    const idOnlyCount = data.Quoted_Items.filter(isQuoteRowIdOnly).length;
    return {
      error: 'mixed_id_only_payload',
      id_only_count: idOnlyCount,
      explicit_count: data.Quoted_Items.length - idOnlyCount,
    };
  }
  return { data, normalized: false };
}

t('LIVE shape Quote 2570562000402426396: HW-only keep-list → 3 license _delete ops', () => {
  // The exact crm_operations row 1070/1071 payload Codex captured.
  const data = {
    Quoted_Items: [
      { id: '2570562000402426397' },  // MX75-HW
      { id: '2570562000402426399' },  // MX85-HW
      { id: '2570562000402426401' },  // CW9172I-RTG
    ],
    Do_Not_Auto_Update_Prices: true,
  };
  const preSnap = {
    Quoted_Items: [
      { id: '2570562000402426397' },  // MX75-HW
      { id: '2570562000402426398' },  // LIC-MX75-SEC-1Y
      { id: '2570562000402426399' },  // MX85-HW
      { id: '2570562000402426400' },  // LIC-MX85-SEC-1Y
      { id: '2570562000402426401' },  // CW9172I-RTG
      { id: '2570562000402426402' },  // LIC-ENT-1YR
    ],
  };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, true, 'must normalize the live payload');
  assert.equal(r.error, undefined);
  assert.equal(r.data.Quoted_Items.length, 3, 'three delete ops');
  const deleteIds = r.data.Quoted_Items.map(it => it.id).sort();
  assert.deepEqual(
    deleteIds,
    ['2570562000402426398', '2570562000402426400', '2570562000402426402'].sort(),
    'must produce delete ops for the 3 license subform ids'
  );
  for (const op of r.data.Quoted_Items) assert.equal(op._delete, null);
  assert.equal(r.data.Do_Not_Auto_Update_Prices, true, 'control flag preserved');
  assert.deepEqual(
    r.normalization.original_kept_ids.sort(),
    ['2570562000402426397', '2570562000402426399', '2570562000402426401'].sort()
  );
});

t('All-current keep-list → reject with keep_list_matches_all_current', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' },
    ],
    Do_Not_Auto_Update_Prices: true,
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, undefined);
  assert.equal(r.error, 'keep_list_matches_all_current');
});

t('Unknown id in keep-list → reject with keep_list_unknown_ids', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1' },        // exists
      { id: 'sub_DOES_NOT_EXIST' },
    ],
    Do_Not_Auto_Update_Prices: true,
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'keep_list_unknown_ids');
  assert.deepEqual(r.unknown_ids, ['sub_DOES_NOT_EXIST']);
});

t('Mixed id-only + explicit modify → reject with mixed_id_only_payload', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1' },                                 // id-only
      { id: 'sub_2', Quantity: 5 },                    // explicit modify
      { Product_Name: { id: 'PID_NEW' }, Quantity: 1 } // explicit add
    ],
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'mixed_id_only_payload');
  assert.equal(r.id_only_count, 1);
  assert.equal(r.explicit_count, 2);
});

t('Duplicate id in keep-list → reject with keep_list_duplicate_ids', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1' },
      { id: 'sub_1' },  // duplicate
    ],
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'keep_list_duplicate_ids');
});

t('Already-explicit payload (all _delete:null) → pass through unchanged', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1', _delete: null },
      { id: 'sub_2', _delete: null },
    ],
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, false, 'no normalization needed');
  assert.equal(r.error, undefined);
  assert.equal(r.data.Quoted_Items.length, 2);
});

t('Already-explicit payload (modify only) → pass through unchanged', () => {
  const data = {
    Quoted_Items: [
      { id: 'sub_1', Quantity: 5 },
      { id: 'sub_2', Discount: 100 },
    ],
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, false);
  assert.equal(r.data.Quoted_Items.length, 2);
});

t('Add-only payload (no ids, just Product_Name) → pass through unchanged', () => {
  const data = {
    Quoted_Items: [
      { Product_Name: { id: 'PID_NEW' }, Quantity: 1, Discount: 50 },
    ],
  };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, false);
});

t('Empty Quoted_Items array with empty preState → pass through (degenerate, not rejected)', () => {
  const data = { Quoted_Items: [] };
  const preSnap = { Quoted_Items: [] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.normalized, false);
  assert.equal(r.error, undefined);
});

console.log('\n─── Round-10 edge guards: empty array + missing snapshot ───');

t('Empty Quoted_Items + non-empty current → reject empty_quoted_items_rejected', () => {
  // The model sent Quoted_Items: [] expecting Zoho to clear all line items.
  // Zoho's additive PUT means [] is a no-op; reject pre-PUT.
  const data = { Quoted_Items: [], Do_Not_Auto_Update_Prices: true };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }, { id: 'sub_3' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'empty_quoted_items_rejected');
  assert.equal(r.current_count, 3, 'message must surface current item count');
});

t('All-id-only payload + missing snapshot → reject keep_list_snapshot_unavailable', () => {
  // Cannot compute strict-subset diff without current rows. Without rejection,
  // the id-only payload would reach Zoho as no-op AND be hard to detect post-hoc
  // because verification has no pre/post rows to fingerprint against.
  const data = {
    Quoted_Items: [{ id: 'sub_1' }, { id: 'sub_2' }],
    Do_Not_Auto_Update_Prices: true,
  };
  const r = normalizeKeepList(data, null);
  assert.equal(r.error, 'keep_list_snapshot_unavailable');
});

t('All-id-only + snapshot has empty Quoted_Items → reject keep_list_snapshot_unavailable', () => {
  // Same logic: snapshot exists but has no current rows to diff against.
  const data = { Quoted_Items: [{ id: 'sub_1' }] };
  const preSnap = { Quoted_Items: [] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'keep_list_snapshot_unavailable');
});

t('Explicit _delete:null payload + missing snapshot → still passes through (not id-only)', () => {
  // Explicit deletes are unambiguous. They don't need a snapshot to interpret.
  const data = { Quoted_Items: [{ id: 'sub_1', _delete: null }] };
  const r = normalizeKeepList(data, null);
  assert.equal(r.error, undefined);
  assert.equal(r.normalized, false);
});

t('Explicit add payload + missing snapshot → passes through', () => {
  // Pure adds (no ids) are unambiguous and don't depend on current state.
  const data = { Quoted_Items: [{ Product_Name: { id: 'PID_A' }, Quantity: 1, Discount: 50 }] };
  const r = normalizeKeepList(data, null);
  assert.equal(r.error, undefined);
  assert.equal(r.normalized, false);
});

t('Empty Quoted_Items + missing snapshot → degenerate, not rejected (degenerate case)', () => {
  // No snapshot, empty payload — nothing to do, nothing to reject.
  const data = { Quoted_Items: [] };
  const r = normalizeKeepList(data, null);
  assert.equal(r.error, undefined);
  assert.equal(r.normalized, false);
});

t('Single id-only row that matches single current row → no-op (all-current)', () => {
  // Edge case: 1-element keep-list when current has 1 item.
  const data = { Quoted_Items: [{ id: 'sub_1' }] };
  const preSnap = { Quoted_Items: [{ id: 'sub_1' }] };
  const r = normalizeKeepList(data, preSnap);
  assert.equal(r.error, 'keep_list_matches_all_current',
    '1-of-1 keep-list still triggers the all-current rejection (model bug, not delete intent)');
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
