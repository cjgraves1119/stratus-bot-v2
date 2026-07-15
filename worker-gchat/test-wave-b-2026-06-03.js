// Tests for the 2026-06-03 Wave B audit fixes + Wave A leftovers.
//
// What this verifies:
//   1. CRIT-7  — queue consumer continuation loop (test the resolve-and-loop
//                pattern directly using a stub askClaude-like function that
//                returns __continuation chains, ensuring the resolver doesn't
//                surface "Done." to the user when the wall-budget elapses).
//   2. P6     — duplicate-contact linking: when Zoho returns DUPLICATE_DATA
//                with an existing record id in details.id, we synthesise a
//                SUCCESS apiResult that LINKS the existing record instead of
//                reporting a generic "Contact creation failed".
//   3. Fix 2b — SKU-named inactive-product error: enrichInactiveProductMessage
//                pulls the json_path Quoted_Items[i] index, reverse-maps the
//                Product_Name.id to a SKU, and prepends it to the terminal
//                message.
//   4. CRIT-1 — undo-token fallback path uses .slice(-8) (cosmetic; the path
//                is unreachable in CF Workers because crypto.randomUUID is
//                always present).
//   5. CRIT-3 — eosLabel ternary now says "End of Sale (passed)" when the EOS
//                date is in the past (sanity check on the literal).
//
// Run: node test-wave-b-2026-06-03.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${escPath('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `\nmodule.exports = { generateUndoToken, parseZohoResponse, enrichInactiveProductMessage, getProductIdToSkuMap };`;
  const tmp = path.join(os.tmpdir(), `stratus-wave-b-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { generateUndoToken, parseZohoResponse, enrichInactiveProductMessage } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  const run = async () => {
    try { await fn(); console.log(`  ✅ ${name}`); pass++; }
    catch (e) { console.log(`  ❌ ${name}\n     ${e.message}\n     ${e.stack && e.stack.split('\n').slice(1, 4).join('\n     ')}`); fail++; }
  };
  return run();
}

(async () => {

console.log('── CRIT-7: queue consumer continuation loop ──');

// Simulate the askClaude+askClaudeContinue contract used by the queue consumer
// at line ~25530. The continuation handoff shape is:
//   { __continuation: true, messages, tools, systemPrompt, iteration, personId }
// Without the loop, finalReply = result.reply || 'Done.' which falls through
// to 'Done.' because __continuation handoffs have no .reply.
await t('continuation chain resolves to a real reply (not "Done.")', async () => {
  let callCount = 0;
  const stubAskClaude = async () => ({
    __continuation: true,
    messages: [],
    tools: [],
    systemPrompt: 'sp',
    iteration: 5,
    personId: 'p1'
  });
  // Simulate askClaudeContinue: first call returns another continuation, second returns final.
  const stubContinue = async () => {
    callCount++;
    if (callCount === 1) {
      return { __continuation: true, messages: [], tools: [], systemPrompt: 'sp', iteration: 10, personId: 'p1' };
    }
    return { reply: 'Quote created — Q-1234' };
  };
  // Replay the CRIT-7 loop logic.
  let result = await stubAskClaude();
  while (result && result.__continuation) {
    result = await stubContinue();
  }
  const finalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
  assert.notStrictEqual(finalReply, 'Done.', 'must NOT surface "Done." to the user');
  assert.strictEqual(finalReply, 'Quote created — Q-1234');
  assert.strictEqual(callCount, 2, 'continue should have been invoked twice');
});

await t('without the loop, "Done." would have been delivered', async () => {
  // Demonstrate the WITHOUT-FIX regression so the test pins the behaviour.
  const stubAskClaude = async () => ({
    __continuation: true, messages: [], tools: [], systemPrompt: 'sp', iteration: 5, personId: 'p1'
  });
  const result = await stubAskClaude();
  const buggyFinalReply = typeof result === 'string' ? result : (result?.reply || 'Done.');
  assert.strictEqual(buggyFinalReply, 'Done.', 'pre-fix path would emit "Done."');
});

// Source assertion: the queue consumer's loop is wired into src/index.js.
await t('source: queue consumer has the continuation loop wired in', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  // Look for the comment marker + the loop body invoking askClaudeContinue right
  // after the askClaude call inside the queue-consumer try block.
  assert.ok(/CRIT-7[\s\S]{0,400}while\s*\(\s*result\s*&&\s*result\.__continuation\s*\)\s*\{[\s\S]{0,400}askClaudeContinue/.test(src),
    'CRIT-7 continuation loop missing or malformed in src/index.js');
});

console.log('── P6: duplicate-contact linking ──');

// We can't easily exercise the full /api/crm-add-contact route through the
// shim (it requires env+request plumbing), so we assert the source contains the
// new DUPLICATE_DATA branch with the right shape.
await t('source: DUPLICATE_DATA path returns success + linked record_id', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.ok(/DUPLICATE_DATA[\s\S]{0,200}_existingId/.test(src), 'DUPLICATE_DATA branch missing');
  assert.ok(/_existing:\s*true/.test(src), 'apiResult must set _existing:true');
  assert.ok(/linked existing record/i.test(src), 'message must mention linking existing record');
});

// Behavioural check: parseZohoResponse marks DUPLICATE_DATA as a failure; the
// caller-side branch is responsible for converting it to a linked-success.
await t('parseZohoResponse marks DUPLICATE_DATA as a failure (caller upgrades)', () => {
  const r = parseZohoResponse({
    data: [{
      code: 'DUPLICATE_DATA',
      message: 'duplicate data',
      details: { api_name: 'Email', id: '99999' },
      status: 'error'
    }]
  }, 'Contact creation');
  assert.strictEqual(r.success, false, 'parseZohoResponse keeps it a failure');
  // The caller-side branch must read the raw createResp.data[0].details.id
  // (which our test simulates here) and upgrade to success.
  const _rawRec = { code: 'DUPLICATE_DATA', details: { id: '99999' } };
  const _existingId = _rawRec.details?.duplicate_record?.id || _rawRec.details?.id || null;
  assert.strictEqual(_existingId, '99999', 'caller branch can extract the existing id');
});

console.log('── Fix 2b: SKU-named inactive-product error ──');

await t('enrichInactiveProductMessage prepends SKU when json_path resolves to a known id', () => {
  // LIC-SME-5YR is flagged zoho_active:false in prices.json — use its real id.
  const SME5_ID = '2570562000001277655';
  const parsed = parseZohoResponse({
    data: [{
      code: 'NOT_ALLOWED',
      message: "can't add inactive product in the inventory",
      details: { api_name: 'id', json_path: '$.data[0].Quoted_Items[2].Product_Name.id' }
    }]
  }, 'Quotes record update');
  const recordData = {
    Quoted_Items: [
      { Product_Name: { id: 'other-1' }, Quantity: 1 },
      { Product_Name: { id: 'other-2' }, Quantity: 2 },
      { Product_Name: { id: SME5_ID }, Quantity: 84 }
    ]
  };
  const out = enrichInactiveProductMessage(parsed, recordData);
  assert.strictEqual(out._no_retry, true);
  assert.ok(/LIC-SME-5YR/.test(out.message), 'message must name the SKU: ' + out.message);
  assert.ok(/INACTIVE in Zoho/i.test(out.message), 'message must still flag INACTIVE');
});

await t('enrichInactiveProductMessage is a no-op when json_path is absent', () => {
  const parsed = parseZohoResponse({
    data: [{ code: 'NOT_ALLOWED', message: "can't add inactive product in the inventory" }]
  }, 'Quotes record update');
  const before = parsed.message;
  enrichInactiveProductMessage(parsed, { Quoted_Items: [{ Product_Name: { id: 'x' } }] });
  assert.strictEqual(parsed.message, before, 'no json_path → no rewrite');
});

await t('enrichInactiveProductMessage is a no-op when the id is unmapped', () => {
  const parsed = parseZohoResponse({
    data: [{
      code: 'NOT_ALLOWED',
      message: "can't add inactive product in the inventory",
      details: { json_path: '$.data[0].Quoted_Items[0].Product_Name.id' }
    }]
  }, 'Quotes record update');
  const before = parsed.message;
  enrichInactiveProductMessage(parsed, { Quoted_Items: [{ Product_Name: { id: 'unknown-id-9999' } }] });
  assert.strictEqual(parsed.message, before, 'unknown id → no rewrite');
});

await t('enrichInactiveProductMessage is a no-op when _no_retry is not set', () => {
  const parsed = { success: false, message: 'something else', data: {} };
  enrichInactiveProductMessage(parsed, { Quoted_Items: [] });
  assert.strictEqual(parsed.message, 'something else');
});

console.log('── CRIT-1: undo-token fallback uses .slice(-8) ──');

await t('generateUndoToken returns a non-empty u_ token', () => {
  const tk = generateUndoToken();
  assert.ok(/^u_[a-z0-9]+$/.test(tk), 'token shape: ' + tk);
  assert.ok(tk.length > 2, 'token must have a payload');
});

await t('source: fallback path uses .slice(-8) not .substring(-8)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  // Pin the fix: the buggy form must be gone, and the slice form present in
  // generateUndoToken's fallback line.
  assert.ok(/Date\.now\(\)\.toString\(36\)\.slice\(-8\)/.test(src), 'slice(-8) form must be present');
  assert.ok(!/Date\.now\(\)\.toString\(36\)\.substring\(-8\)/.test(src), 'substring(-8) form must be gone');
});

console.log('── CRIT-3: eosLabel ternary distinguishes past/future ──');

await t('source: eosLabel says "End of Sale (passed)" when EOS is in the past', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.ok(/eosLabel\s*=\s*eosDate\s*<=\s*now\s*\?\s*'End of Sale \(passed\)'\s*:\s*'End of Sale'/.test(src),
    'eosLabel ternary not in the fixed form');
});

console.log('── CRIT-9: AI gateway fallback wired in for both call sites ──');

await t('source: callWebSearchEnrichment uses gateway → direct fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  // The bare literal must be GONE from these two sites; the only literal
  // remaining must be the ANTHROPIC_API_DIRECT constant on line ~22.
  const literalHits = (src.match(/'https:\/\/api\.anthropic\.com\/v1\/messages'/g) || []).length;
  assert.strictEqual(literalHits, 1, 'only ANTHROPIC_API_DIRECT constant should hold the literal — found ' + literalHits);
  // The web-search enricher should reference ANTHROPIC_API_URL.
  assert.ok(/callWebSearchEnrichment[\s\S]{0,1500}ANTHROPIC_API_URL[\s\S]{0,1500}ANTHROPIC_API_DIRECT/.test(src),
    'callWebSearchEnrichment missing gateway+direct refs');
});

await t('source: detect-account site uses gateway → direct fallback', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  // The detect-account replacement marker should reference both URLs.
  assert.ok(/detect-account gateway[\s\S]{0,200}ANTHROPIC_API_DIRECT/.test(src),
    'detect-account fallback marker not present');
});

console.log('── P5: Tasks $se_module auto-inject ──');

await t('source: zoho_create_record auto-injects $se_module for Tasks', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.ok(/TASK-SE-MODULE/.test(src), 'TASK-SE-MODULE log marker not present');
  assert.ok(/module_name === 'Tasks'[\s\S]{0,200}What_Id[\s\S]{0,200}\$se_module/.test(src),
    'Tasks $se_module auto-inject block not in zoho_create_record');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

})();
