// Self-contained, network-free unit tests for the CRM agent-loop API-400 crash
// fix + the deterministic reterm_quote_licenses tool + the undo-resolution fix.
// Run: node worker-gchat/test-reterm-and-crashfix-2026-07-13.js
//
// Strategy: the pure, module-level helpers (repairDanglingToolUse,
// getCrmMaxOutputTokens) are EXTRACTED FROM SOURCE by brace-matching and executed
// directly, so they can't drift from the shipped code. The inline agent-loop
// expressions (term parse, SKU resolution, verification matching) are exercised as
// faithful mirrors of the source, annotated with the line they mirror.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = path.join(__dirname, 'src', 'index.js');
const src = fs.readFileSync(SRC, 'utf8');

let pass = 0;
const t = (name, fn) => { fn(); console.log('  ✓ ' + name); pass++; };

// Extract a top-level `function NAME(...) { ... }` by brace-matching.
function extractFn(name) {
  const start = src.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`fn ${name} not found in source`);
  let depth = 0, open = src.indexOf('{', start);
  for (let k = open; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (depth === 0) return src.slice(start, k + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
const load = (name) => new Function(`${extractFn(name)}; return ${name};`)();

// ───────────────────────── crash fix: repairDanglingToolUse ─────────────────
const repairDanglingToolUse = load('repairDanglingToolUse');
function assertValidToolShape(msgs, label) {
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    if (m.role === 'assistant' && Array.isArray(m.content)) {
      const ids = m.content.filter(b => b.type === 'tool_use').map(b => b.id);
      if (ids.length) {
        const next = msgs[i + 1];
        assert(next && next.role === 'user' && Array.isArray(next.content), `${label}: tool_use not followed by user tool_result msg`);
        const rIds = new Set(next.content.filter(b => b.type === 'tool_result').map(b => b.tool_use_id));
        for (const id of ids) assert(rIds.has(id), `${label}: ${id} unmatched`);
      }
    }
    if (i > 0 && msgs[i - 1].role === 'user' && m.role === 'user') throw new Error(`${label}: consecutive user turns`);
  }
}
console.log('repairDanglingToolUse (extracted from source):');
t('the live API-400 shape (dangling tool_use + text turn) is repaired, merged into the existing user turn', () => {
  const before = [
    { role: 'user', content: 'reterm to 1yr' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_A', name: 'zoho_update_record', input: {} }] },
    { role: 'user', content: '[System: continue]' },
  ];
  const after = repairDanglingToolUse(before);
  assertValidToolShape(after, 'live-400');
  assert.strictEqual(after.length, 3, 'synthetic result merges into the existing user turn');
});
t('partial results: 2 tool_use, 1 tool_result -> the missing one is synthesized', () => {
  const after = repairDanglingToolUse([
    { role: 'assistant', content: [{ type: 'tool_use', id: 'A', name: 'x', input: {} }, { type: 'tool_use', id: 'B', name: 'y', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'A', content: 'ok' }] },
  ]);
  assertValidToolShape(after, 'partial');
});
t('end-of-array dangling tool_use -> a user tool_result turn is appended', () => {
  const after = repairDanglingToolUse([
    { role: 'user', content: 'go' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'Z', name: 'zoho_update_record', input: {} }] },
  ]);
  assertValidToolShape(after, 'eoa');
  assert.strictEqual(after.length, 3);
});
t('already-valid + text-only assistant turns are left unchanged', () => {
  const valid = [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'A', name: 'x', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'A', content: 'ok' }] },
  ];
  assert.strictEqual(JSON.stringify(repairDanglingToolUse(valid)), JSON.stringify(valid));
  const textOnly = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }];
  assert.strictEqual(JSON.stringify(repairDanglingToolUse(textOnly)), JSON.stringify(textOnly));
});

// ───────────────────── env-configurable output-token ceiling ────────────────
const getCrmMaxOutputTokens = load('getCrmMaxOutputTokens');
console.log('getCrmMaxOutputTokens (extracted from source):');
t('defaults to 8192; positive int env overrides; junk/zero/negative/fractional -> default', () => {
  assert.strictEqual(getCrmMaxOutputTokens({}), 8192);
  assert.strictEqual(getCrmMaxOutputTokens({ CRM_MAX_OUTPUT_TOKENS: '16384' }), 16384);
  assert.strictEqual(getCrmMaxOutputTokens({ CRM_MAX_OUTPUT_TOKENS: '0' }), 8192);
  assert.strictEqual(getCrmMaxOutputTokens({ CRM_MAX_OUTPUT_TOKENS: 'abc' }), 8192);
  assert.strictEqual(getCrmMaxOutputTokens({ CRM_MAX_OUTPUT_TOKENS: '-5' }), 8192);
  assert.strictEqual(getCrmMaxOutputTokens({ CRM_MAX_OUTPUT_TOKENS: '0.5' }), 8192); // fractional -> default, not floor(0.5)=0
});

// ─────────── reterm inline logic (mirrors retermQuoteLicenses ~10073) ────────
// term parse (mirrors the anchored /^([135])\s*(?:y|yr|year|years)?$/ guard)
const parseTerm = (x) => {
  const m = String(x).trim().toLowerCase().match(/^([135])\s*(?:y|yr|year|years)?$/);
  const n = m ? Number(m[1]) : NaN;
  return [1, 3, 5].includes(n) ? n : null;
};
console.log('reterm term parse (mirror):');
t('accepts 1/3/5 + "1yr"/"3 year"/"5y"; REJECTS destructive typos 15/35/10/51', () => {
  for (const g of [[1, 1], ['1yr', 1], ['3 year', 3], ['5y', 5]]) assert.strictEqual(parseTerm(g[0]), g[1]);
  for (const b of [15, 35, 10, 51, 2, 4, '15 years', '']) assert.strictEqual(parseTerm(b), null, `${b} must reject`);
});

// SKU resolution (mirrors codeOf: flat Product_Code first, then nested, then name token)
const ZRE = /\b(MR\d{2,3}[A-Z0-9-]*|MS\d{3}[A-Z0-9-]*|MX\d{2,3}[A-Z0-9-]*|CW\d{4}[A-Z0-9-]*|MV\d{2,3}[A-Z0-9-]*|MT\d{2,3}[A-Z0-9-]*|MG\d{2,3}[A-Z0-9-]*|C9\d{3}[A-Z0-9-]*|Z\d[A-Z0-9-]*|LIC-[A-Z0-9-]+|SUB-[A-Z0-9-]+|PWR-[A-Z0-9-]+|MA-[A-Z0-9-]+)\b/i;
const codeOf = (i) => {
  let s = i?.Product_Code || i?.Product_Name?.Product_Code || null;
  if (!s && typeof i?.Product_Name?.name === 'string') { const m = i.Product_Name.name.match(ZRE); if (m) s = m[1]; }
  return String(s || '').trim().toUpperCase();
};
console.log('reterm SKU resolution (mirror):');
t('flat Product_Code wins; nested fallback; name-token fallback', () => {
  assert.strictEqual(codeOf({ Product_Code: 'LIC-ENT-3YR', Product_Name: { name: 'Meraki MR Enterprise License, 3YR' } }), 'LIC-ENT-3YR');
  assert.strictEqual(codeOf({ Product_Name: { Product_Code: 'LIC-MS250-48LP-3YR' } }), 'LIC-MS250-48LP-3YR');
  assert.strictEqual(codeOf({ Product_Name: { name: 'Meraki LIC-MT-3Y Sensor License' } }), 'LIC-MT-3Y');
});

// verification (mirrors the new-row isolation + two-pass list+discount match)
function verify(retermLines, quotedItems, after) {
  const mismatches = [];
  const afterIds = new Set(after.map(i => i.id));
  const originalIds = new Set(quotedItems.map(i => i.id));
  const newRows = after.filter(i => !originalIds.has(i.id));
  if (newRows.length !== retermLines.length) mismatches.push('count');
  const pool = newRows.map(i => ({ sku: i.sku, qty: i.qty, disc: i.disc, list: i.list, used: false }));
  const lines = retermLines.map(l => ({ ...l }));
  const pass_ = (tol) => { for (const l of lines) { if (l._m) continue; const c = pool.find(a => !a.used && a.sku === l.target_sku && a.qty === l.quantity && Math.abs(a.disc - l.new_discount) <= tol && Math.abs(a.list - l.new_list) <= tol); if (c) { c.used = true; l._m = true; } } };
  pass_(0.02); pass_(0.5);
  for (const l of lines) if (!l._m) mismatches.push('unmatched');
  return mismatches;
}
console.log('reterm verification (mirror):');
const twins = [{ target_sku: 'LIC-MT-1Y', quantity: 2, new_list: 260, new_discount: 334.08 }, { target_sku: 'LIC-MT-1Y', quantity: 2, new_list: 260, new_discount: 334.08 }];
t('both new twins correct -> PASS', () => assert.deepStrictEqual(verify(twins, [{ id: 'A' }, { id: 'B' }], [{ id: 'N1', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 260 }, { id: 'N2', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 260 }]), []));
t('a new twin left at LIST price (disc 0) -> FAILS', () => assert(verify(twins, [{ id: 'A' }, { id: 'B' }], [{ id: 'N1', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 260 }, { id: 'N2', sku: 'LIC-MT-1Y', qty: 2, disc: 0, list: 260 }]).length >= 1));
t('right discount but WRONG list price -> FAILS', () => assert(verify(twins, [{ id: 'A' }, { id: 'B' }], [{ id: 'N1', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 260 }, { id: 'N2', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 999 }]).length >= 1));
t('a PRE-EXISTING correct 1Y row cannot mask a mis-priced NEW row (new-row isolation)', () => {
  const one = [{ target_sku: 'LIC-MT-1Y', quantity: 2, new_list: 260, new_discount: 334.08 }];
  const after = [{ id: 'P', sku: 'LIC-MT-1Y', qty: 2, disc: 334.08, list: 260 }, { id: 'N1', sku: 'LIC-MT-1Y', qty: 2, disc: 0, list: 260 }];
  assert(verify(one, [{ id: 'OLD' }, { id: 'P' }], after).length >= 1, 'must FAIL: the NEW row is mis-priced');
});

// fail-closed economics (mirror) + description term filter (mirror)
console.log('reterm guards (mirror):');
t('non-positive qty/list aborts fail-closed; valid proceeds', () => {
  const bad = (q, lp) => { const olt = Math.round(((Number(lp) || 0) * (Number(q) || 0)) * 100) / 100; return !((Number(q) || 0) > 0) || !(olt > 0); };
  assert.strictEqual(bad(0, 100), true); assert.strictEqual(bad(2, 0), true); assert.strictEqual(bad(2, 100), false);
});
t('description term filter drops "5-Year"/"3YR", keeps "3 yards"/plain', () => {
  const isTerm = (d) => /\b[135]\s*-?\s*(?:yr|yrs|year|years)\b/i.test(d);
  assert.strictEqual(isTerm('5-Year Subscription Add-on'), true);
  assert.strictEqual(isTerm('3YR license'), true);
  assert.strictEqual(isTerm('3 yards of cable'), false);
  assert.strictEqual(isTerm('Priority note'), false);
});

// ─────────────── undo-resolution fix: source-shape assertions ────────────────
// The bare-"undo" resolver is D1 SQL (not JS-executable here), so assert the
// SHAPE of the shipped query + the reterm operation label that make it correct.
console.log('undo resolution (source-shape assertions):');
t('re-terms are logged with a distinct operation, and the bare-undo query excludes null-token side effects', () => {
  assert.match(src, /operation: 'reterm_quote_licenses', module: 'Quotes'/, 're-term logs operation=reterm_quote_licenses');
  assert.match(src, /undoToken: null,.*re-term is not undo-token reversible/, 're-term stores no undo token');
  // query keeps null-token side-effects (e.g. follow-up Tasks) out, but includes re-terms
  assert.match(src, /operation IN \('create','update','clone','delete','reterm_quote_licenses'\)/, 'query set includes reterm');
  assert.match(src, /json_extract\(request_payload, '\$\.tool'\) = 'reterm_quote_licenses'/, 'legacy reterms (logged as update) detected via request_payload.tool');
  assert.match(src, /if \(latest && latest\.is_reterm\)/, 'refuse when the latest resolved op is a re-term (new or legacy)');
});

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
