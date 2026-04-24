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

function applyTruthGuard(finalReply, verifiedRecordIds, mutationSummaries) {
  if (!finalReply || /^API error:/.test(finalReply)) return finalReply;
  let reply = finalReply;
  // Reset regex state between invocations
  const re = new RegExp(ZOHO_URL_RE.source, 'g');
  const urlsFound = [];
  let m;
  while ((m = re.exec(reply)) !== null) {
    urlsFound.push({ full: m[0], module: m[1], id: m[2] });
  }
  const unverified = urlsFound.filter(u => !verifiedRecordIds.has(u.id));
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

t('Keeps verified Zoho URL (id in verifiedRecordIds)', () => {
  const id = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${id}`;
  const reply = `Here is your quote: [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, new Set([id]), []);
  assert.ok(guarded.includes(url), 'verified URL must be preserved');
  assert.ok(guarded.includes('[View Quote]'), 'markdown link wrapper preserved');
});

t('Strips hallucinated Zoho URL (id NOT in verifiedRecordIds)', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `The quote was created. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, new Set(), []);
  assert.ok(!guarded.includes(url), 'hallucinated URL must be stripped');
  assert.ok(/link removed: unverified/.test(guarded), 'replacement marker present');
});

t('Strips bare (non-markdown) hallucinated URL', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `Quote URL: ${url}`;
  const guarded = applyTruthGuard(reply, new Set(), []);
  assert.ok(!guarded.includes(url));
  assert.ok(/URL removed: unverified/.test(guarded));
});

t('Prepends warning when reply claims creation but no mutation succeeded', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const reply = `The quote was created successfully. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, new Set(), []);
  assert.ok(/⚠️/.test(guarded), 'warning symbol must be present');
  assert.ok(/hallucinating success/i.test(guarded), 'warning text must mention hallucination');
});

t('Does NOT warn when a mutation did succeed (legitimate create)', () => {
  const id = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${id}`;
  const reply = `The quote was created. [View Quote](${url})`;
  const guarded = applyTruthGuard(reply, new Set([id]), [{ isError: false, recordUrl: url }]);
  assert.ok(!/⚠️/.test(guarded), 'must not warn on legitimate success');
  assert.ok(guarded.includes(url), 'verified URL preserved');
});

t('Mixed: strips hallucinated URL, keeps verified URL in same reply', () => {
  const realId = '2570562000400116511';
  const fakeId = '9999999999999999999';
  const realUrl = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${realId}`;
  const fakeUrl = `https://crm.zoho.com/crm/org647122552/tab/Deals/${fakeId}`;
  const reply = `Quote: [real](${realUrl})\nDeal: [fake](${fakeUrl})`;
  const guarded = applyTruthGuard(reply, new Set([realId]), [{ isError: false, recordUrl: realUrl }]);
  assert.ok(guarded.includes(realUrl), 'real URL preserved');
  assert.ok(!guarded.includes(fakeUrl), 'fake URL stripped');
});

t('Does not strip for other modules (Tasks) when verified', () => {
  const id = '2570562000400116599';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Tasks/${id}`;
  const reply = `Task created. [Open Task](${url})`;
  const guarded = applyTruthGuard(reply, new Set([id]), [{ isError: false, recordUrl: url }]);
  assert.ok(guarded.includes(url));
});

t('Strips Sales_Orders URL when hallucinated', () => {
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Sales_Orders/${fakeId}`;
  const reply = `Your sales order is here: [SO](${url})`;
  const guarded = applyTruthGuard(reply, new Set(), []);
  assert.ok(!guarded.includes(url));
});

t('Full TestCo transcript reproduction: leak + fake URL + false success', () => {
  // This is the exact failure mode Codex captured.
  const fakeId = '2570562000400116511';
  const url = `https://crm.zoho.com/crm/org647122552/tab/Quotes/${fakeId}`;
  const raw = `No tool call were made during this conversation. I can now respond.\n\nThe quote was created with C9300L-48P-4X-M, LIC-C9300-48E-1Y, C9300L-24P-4X-M, LIC-C9300-24E-1Y.\n\n[View Quote](${url})`;
  const afterLeaks = stripLeaks(raw);
  assert.ok(!/No tool call/i.test(afterLeaks), 'leak stripped first');
  const guarded = applyTruthGuard(afterLeaks, new Set(), []);
  assert.ok(!guarded.includes(url), 'fake URL stripped');
  assert.ok(/⚠️/.test(guarded), 'warning present');
  assert.ok(/hallucinating success/i.test(guarded), 'warning cites hallucination');
});

t('Does NOT flag on historical phrasing with intervening record id', () => {
  // "quote <15-19 digit id> was created" describes history (from a search
  // result). The claimsSuccess regex requires word-level proximity between
  // the noun and the verb, so an intervening id breaks the match. Good.
  const reply = 'According to the record, quote 2570562000399909183 was created on 2024-01-15.';
  const guarded = applyTruthGuard(reply, new Set(), []);
  assert.ok(!/⚠️/.test(guarded), 'no false-positive warning on historical phrasing with id between noun and verb');
});

t('Zoho URL regex does not over-match on arbitrary digits inside URL', () => {
  const shortIdUrl = 'https://crm.zoho.com/crm/org647122552/tab/Quotes/12345'; // too short
  const reply = `Partial URL: ${shortIdUrl}`;
  const guarded = applyTruthGuard(reply, new Set(), []);
  // Short id should not match the 15-19 digit requirement → not touched.
  assert.ok(guarded.includes(shortIdUrl));
});

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
