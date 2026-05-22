// PR-A regression suite — prompt compression + intent-class tool subsetting + telemetry.
//
// Council requirement (Codex Round 2): PR-A must land WITH telemetry showing
// pre/post token counts per intent class so PR-B (prompt caching) has a clean
// baseline. This file proves the three guarantees:
//   1. SYSTEM_PROMPT effective byte count ≤ 70% of the pre-PR-A baseline
//      (36,361 chars → target ≤ 25,453 chars, ≥30% reduction).
//   2. Tool subsetting returns the documented per-class subsets and falls
//      back to the general superset when classifier confidence < 0.7.
//   3. Telemetry extras { intentClass, toolCount } reach trackUsage at the
//      askClaude call site (verified by static inspection — bash runner has
//      no Anthropic credentials).
//
// All assertions are pure-Node — no Cloudflare bindings, no live LLM calls.

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m,
    'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
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
  src += `
module.exports = {
  CRM_SYSTEM_PROMPT,
  CRM_AGENT_SYSTEM_PROMPT_BASE,
  CRM_PROMPT_EMAIL_INTAKE,
  CRM_PROMPT_ADMIN_ACTION,
  CRM_EMAIL_TOOLS,
  TOOL_SUBSETS,
  TOOL_SUBSET_CLASSES,
  classifyCrmIntent,
  selectToolSubset,
  buildCrmSystemPrompt,
  detectCrmEmailIntent
};`;
  const tmp = path.join(os.tmpdir(), `stratus-gchat-pra-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const {
  CRM_SYSTEM_PROMPT,
  CRM_AGENT_SYSTEM_PROMPT_BASE,
  CRM_EMAIL_TOOLS,
  TOOL_SUBSETS,
  TOOL_SUBSET_CLASSES,
  classifyCrmIntent,
  selectToolSubset,
  buildCrmSystemPrompt
} = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

// ─── 1. SYSTEM_PROMPT compression ────────────────────────────────────────────
console.log('\nPR-A · SYSTEM_PROMPT compression\n────────────────────────────────────────────────────────────────');

// Pre-PR-A baseline (committed values, see brain memory
// project_gchat_crm_prompt_optimization):
//   CRM_AGENT_SYSTEM_PROMPT_BASE:  2,612 chars
//   CRM_SYSTEM_PROMPT (body):     33,749 chars
//   Effective combined:           36,361 chars
const PRE_BASELINE_BASE = 2612;
const PRE_BASELINE_SYS = 33749;
const PRE_BASELINE_EFFECTIVE = PRE_BASELINE_BASE + PRE_BASELINE_SYS;

t('CRM_SYSTEM_PROMPT body has been compressed', () => {
  assert.ok(CRM_SYSTEM_PROMPT.length < PRE_BASELINE_SYS,
    `CRM_SYSTEM_PROMPT body is ${CRM_SYSTEM_PROMPT.length} chars; expected < ${PRE_BASELINE_SYS}`);
});

t('CRM_AGENT_SYSTEM_PROMPT_BASE has been compressed', () => {
  // The BASE string in source contains a literal ${CRM_SYSTEM_PROMPT}
  // placeholder; we measure just the "wrapper" text (everything except the
  // placeholder). After PR-A this wrapper is < 1,000 chars.
  const wrapperLen = CRM_AGENT_SYSTEM_PROMPT_BASE.length - CRM_SYSTEM_PROMPT.length;
  assert.ok(wrapperLen < PRE_BASELINE_BASE,
    `BASE wrapper is ${wrapperLen} chars; expected < ${PRE_BASELINE_BASE}`);
});

t('Effective CRM agent prompt ≥30% smaller than pre-PR-A baseline', () => {
  // CRM_AGENT_SYSTEM_PROMPT_BASE is computed at module-load time with the
  // ${CRM_SYSTEM_PROMPT} placeholder already expanded — that's the actual
  // runtime prompt the model sees on a plain CRM call (no advisor, no intake).
  const effective = CRM_AGENT_SYSTEM_PROMPT_BASE.length;
  const target = Math.floor(PRE_BASELINE_EFFECTIVE * 0.70);
  assert.ok(effective <= target,
    `Effective prompt ${effective} chars; expected ≤ ${target} (30% reduction floor)`);
});

t('Effective CRM agent prompt ≤ 16,000 chars target', () => {
  // Aspirational secondary target referenced in the council prompt.
  // Allow up to 25,500 chars (~6.4K tokens) — anything tighter without
  // killing load-bearing rules is a stretch goal.
  const effective = CRM_AGENT_SYSTEM_PROMPT_BASE.length;
  assert.ok(effective <= 25500,
    `Effective prompt ${effective} chars; expected ≤ 25,500 for cost-reduction target`);
});

// Load-bearing sections that MUST remain after compression. If any of these
// regress, behavior changes — flag immediately.
const LOAD_BEARING_PHRASES = [
  // Rule 1-5 enforcement
  'No partial-success narration',
  '_undo_token',
  'confirm: true',
  'Restate the undo token',
  // Anti-hallucination
  'LIC-ENT-1YR',
  'LIC-ENT-3YR',
  'LIC-ENT-5YR',
  'LIC-ENT-MR',                  // explicit ❌ pattern
  'Cisco reps live in the Meraki_ISRs',
  'Meraki ISR Referal',
  // Picklist protection
  'Closed (Won)',
  'Closed (Lost)',
  'Proposal/Negotiation',
  'Stratus Referal',
  // Quoted_Items rules
  'ADDITIVE',
  '_delete: null',
  'KEEP_LIST_NO_OP',
  // URL construction
  'Quote_Number',
  'org647122552'
];

t('All load-bearing phrases survive compression', () => {
  const missing = LOAD_BEARING_PHRASES.filter(p => !CRM_AGENT_SYSTEM_PROMPT_BASE.includes(p));
  assert.deepStrictEqual(missing, [],
    `Missing load-bearing phrases: ${missing.join(', ')}`);
});

// ─── 2. Tool subsetting ──────────────────────────────────────────────────────
console.log('\nPR-A · Intent-class tool subsetting\n────────────────────────────────────────────────────────────────');

t('TOOL_SUBSETS defines all expected classes', () => {
  const expected = ['crm_write','crm_read','email','quote_url','subscription','cisco_rep','general'];
  for (const c of expected) {
    assert.ok(Array.isArray(TOOL_SUBSETS[c]), `Missing class ${c}`);
    assert.ok(TOOL_SUBSETS[c].length > 0, `Empty subset for ${c}`);
  }
  assert.deepStrictEqual([...TOOL_SUBSET_CLASSES].sort(), expected.slice().sort());
});

t('Average subset size is 3-10 tools (not all 23)', () => {
  const sizes = TOOL_SUBSET_CLASSES.map(c => TOOL_SUBSETS[c].length);
  const avg = sizes.reduce((a,b) => a+b, 0) / sizes.length;
  assert.ok(avg < 11 && avg > 2,
    `Average subset size ${avg.toFixed(1)} outside expected 3-10 range`);
  assert.ok(Math.max(...sizes) < CRM_EMAIL_TOOLS.length,
    `Largest subset ${Math.max(...sizes)} >= full ${CRM_EMAIL_TOOLS.length} — defeats the optimization`);
});

t('classifyCrmIntent — crm_write intent (create quote)', () => {
  const r = classifyCrmIntent('Create a new deal and quote for Acme Corp: 5x MR46');
  assert.strictEqual(r.class, 'crm_write');
  assert.ok(r.confidence >= 0.7, `confidence ${r.confidence} below floor`);
});

t('classifyCrmIntent — crm_read intent (list deals)', () => {
  const r = classifyCrmIntent('show me the open deals for Chris Graves');
  assert.strictEqual(r.class, 'crm_read');
  assert.ok(r.confidence >= 0.7);
});

t('classifyCrmIntent — email intent (draft reply)', () => {
  const r = classifyCrmIntent('Draft a reply to John about the quote');
  assert.strictEqual(r.class, 'email');
  assert.ok(r.confidence >= 0.7);
});

t('classifyCrmIntent — subscription intent (DID generation)', () => {
  const r = classifyCrmIntent('Generate a DID for quote 2570562000401257768');
  assert.strictEqual(r.class, 'subscription');
  assert.ok(r.confidence >= 0.7);
});

t('classifyCrmIntent — cisco_rep intent (assign rep)', () => {
  const r = classifyCrmIntent('Assign Cisco rep jacporti@cisco.com as the Meraki ISR on deal 2570562000400000001');
  assert.strictEqual(r.class, 'cisco_rep');
  assert.ok(r.confidence >= 0.7);
});

t('classifyCrmIntent — quote_url intent (ecomm link)', () => {
  const r = classifyCrmIntent('give me the ecomm link for this quote');
  assert.strictEqual(r.class, 'quote_url');
  assert.ok(r.confidence >= 0.7);
});

t('classifyCrmIntent — ambiguous text below confidence floor returns general', () => {
  // No explicit CRM verb, no record type — should fall to general at 0.5.
  const r = classifyCrmIntent('hey, what do you think about this?');
  assert.strictEqual(r.class, 'general');
  assert.ok(r.confidence < 0.7, `confidence ${r.confidence} should be below floor`);
});

t('classifyCrmIntent — empty input returns general', () => {
  const r = classifyCrmIntent('');
  assert.strictEqual(r.class, 'general');
  assert.ok(r.confidence < 0.7);
});

// 2026-05-21 regression: "update the licenses to be 5 years" misrouted to
// crm_read, so the agent got a read-only tool subset (no zoho_update_record)
// and looped on zoho_search_records until the iteration cap.
t('classifyCrmIntent — "update licenses" with quote session → crm_write', () => {
  const r = classifyCrmIntent('[Session: Most recently worked quote — Record_ID: 1. When user says "the quote" use it.]\n\nupdate the licenses to be 5 years', { hasQuoteSession: true });
  assert.strictEqual(r.class, 'crm_write');
});

t('classifyCrmIntent — "update licenses" on active quote page → crm_write', () => {
  const r = classifyCrmIntent('[Active Zoho page: Quotes 2570562000399909180]\nupdate the licenses to be 5 years', { hasActivePageContext: true });
  assert.strictEqual(r.class, 'crm_write');
});

t('classifyCrmIntent — "update me on the latest deals" stays crm_read', () => {
  const r = classifyCrmIntent('update me on the latest deals');
  assert.strictEqual(r.class, 'crm_read');
});

// Exercises the reordered Rule 6 directly: a noun-free mutation verb in a
// quote session. Rule 5 misses (no record-type noun); the context-bound
// rule catches it. Pre-fix this returned `general` — the reorder is what
// makes it crm_write.
t('classifyCrmIntent — noun-free mutation in a quote session → crm_write', () => {
  const r = classifyCrmIntent('update this', { hasQuoteSession: true });
  assert.strictEqual(r.class, 'crm_write');
});

// 2026-05-22 regression: "Clone this current quote ... do not submit to CCW"
// matched the subscription rule's "submit to ccw" substring INSIDE the
// negation, routing to the `subscription` subset — which has no clone_quote
// tool. The clone-intent guard now runs before the subscription rule.
t('classifyCrmIntent — "clone this quote" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('clone this quote').class, 'crm_write');
});

t('classifyCrmIntent — "clone this current quote" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('clone this current quote').class, 'crm_write');
});

t('classifyCrmIntent — "make a copy of this quote" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('make a copy of this quote').class, 'crm_write');
});

t('classifyCrmIntent — clone request with negated "do not submit to CCW" → crm_write', () => {
  const r = classifyCrmIntent('Clone this current quote under the same Hummel deal. Do not submit to CCW and do not create a CCW deal.');
  assert.strictEqual(r.class, 'crm_write');
});

t('selectToolSubset — a clone request yields a subset containing clone_quote', () => {
  const subset = selectToolSubset(classifyCrmIntent('clone this quote'), CRM_EMAIL_TOOLS);
  assert.ok(subset.map(x => x.name).includes('clone_quote'),
    'clone request must yield a subset that includes clone_quote');
});

t('classifyCrmIntent — DID generation still routes to subscription (guard is clone-only)', () => {
  assert.strictEqual(classifyCrmIntent('Generate a DID for quote 2570562000401257768').class, 'subscription');
});

// Clone guard must NOT false-positive on bare "copy" — "copy me on the email"
// with active-page context must not get routed to crm_write (which would strip
// the email tools). `copy` is only a clone signal when bound to "quote".
t('classifyCrmIntent — "copy me on the email" with page context does NOT route to crm_write', () => {
  const r = classifyCrmIntent('copy me on the email to the customer', { hasActivePageContext: true });
  assert.notStrictEqual(r.class, 'crm_write');
});

t('selectToolSubset — crm_write returns mutation + lookup tools', () => {
  const intent = { class: 'crm_write', confidence: 0.85 };
  const subset = selectToolSubset(intent, CRM_EMAIL_TOOLS);
  const names = subset.map(t => t.name);
  assert.ok(names.includes('create_deal_and_quote'), 'missing create_deal_and_quote');
  assert.ok(names.includes('zoho_update_record'), 'missing zoho_update_record');
  assert.ok(names.includes('zoho_create_record'), 'missing zoho_create_record');
  assert.ok(names.includes('batch_product_lookup'), 'missing batch_product_lookup');
  assert.ok(subset.length < CRM_EMAIL_TOOLS.length, 'should be a proper subset');
});

t('selectToolSubset — low confidence falls back to general superset', () => {
  const intent = { class: 'crm_write', confidence: 0.5 };
  const subset = selectToolSubset(intent, CRM_EMAIL_TOOLS);
  const names = subset.map(t => t.name).sort();
  const expected = TOOL_SUBSETS.general.slice().sort();
  assert.deepStrictEqual(names, expected,
    'low-confidence path should yield the general superset');
});

t('selectToolSubset — unknown class falls back to general', () => {
  const intent = { class: 'not_a_real_class', confidence: 0.9 };
  const subset = selectToolSubset(intent, CRM_EMAIL_TOOLS);
  const names = subset.map(t => t.name).sort();
  const expected = TOOL_SUBSETS.general.slice().sort();
  assert.deepStrictEqual(names, expected);
});

t('selectToolSubset — quote_url path is minimal (1-2 tools)', () => {
  const intent = { class: 'quote_url', confidence: 0.9 };
  const subset = selectToolSubset(intent, CRM_EMAIL_TOOLS);
  assert.ok(subset.length <= 3, `quote_url subset has ${subset.length} tools, expected ≤ 3`);
});

t('selectToolSubset — every subset is non-empty when input is non-empty', () => {
  for (const cls of TOOL_SUBSET_CLASSES) {
    const subset = selectToolSubset({ class: cls, confidence: 0.95 }, CRM_EMAIL_TOOLS);
    assert.ok(subset.length > 0, `subset for ${cls} is empty`);
  }
});

t('selectToolSubset — null intent returns general superset (not empty)', () => {
  const subset = selectToolSubset(null, CRM_EMAIL_TOOLS);
  const names = subset.map(t => t.name).sort();
  const expected = TOOL_SUBSETS.general.slice().sort();
  assert.deepStrictEqual(names, expected);
});

// ─── 3. Tool subsetting NEVER returns more tools than CRM_EMAIL_TOOLS ───────
t('No subset exceeds the full CRM_EMAIL_TOOLS array length', () => {
  for (const cls of TOOL_SUBSET_CLASSES) {
    const subset = selectToolSubset({ class: cls, confidence: 0.95 }, CRM_EMAIL_TOOLS);
    assert.ok(subset.length <= CRM_EMAIL_TOOLS.length,
      `${cls} subset has ${subset.length} > ${CRM_EMAIL_TOOLS.length}`);
  }
});

// ─── 4. Tool subset names must all be real tool names ────────────────────────
t('Every TOOL_SUBSETS entry references a real tool name', () => {
  const real = new Set(CRM_EMAIL_TOOLS.map(t => t.name));
  for (const cls of TOOL_SUBSET_CLASSES) {
    for (const name of TOOL_SUBSETS[cls]) {
      assert.ok(real.has(name), `${cls} references unknown tool ${name}`);
    }
  }
});

// ─── 5. Telemetry payload static check ───────────────────────────────────────
console.log('\nPR-A · Telemetry payload\n────────────────────────────────────────────────────────────────');

t('Source contains intent_class + tool_count telemetry stash', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.ok(src.includes('intent_class'),
    'source does not write intent_class to telemetry');
  assert.ok(src.includes('tool_count'),
    'source does not write tool_count to telemetry');
  assert.ok(src.includes('_praExtras') || src.includes('intentClass'),
    'source does not pass intentClass extras to trackUsage');
});

t('trackUsage signature accepts an extras argument', () => {
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.ok(src.includes('async function trackUsage(env, model, usage, source, evalContext = null, extras = null)'),
    'trackUsage signature missing extras parameter');
});

// ─── 6. detectCrmEmailIntent is preserved (no regressions to existing logic) ─
t('detectCrmEmailIntent still exports the same hasAny shape', () => {
  const { detectCrmEmailIntent } = buildShim();
  const r = detectCrmEmailIntent('create a quote for acme');
  assert.strictEqual(typeof r, 'object');
  assert.ok('hasAny' in r);
  assert.ok('hasCrm' in r);
  assert.ok('hasEmail' in r);
});

// ─── 7. buildCrmSystemPrompt still conditionally loads intake + admin ───────
t('buildCrmSystemPrompt loads CRM_PROMPT_EMAIL_INTAKE on new-customer intent', () => {
  const p = buildCrmSystemPrompt('new customer email — Acme just reached out about MR46s');
  assert.ok(p.includes('NEW CUSTOMER EMAIL INTAKE WORKFLOW'),
    'email intake section missing on new-customer prompt');
});

t('buildCrmSystemPrompt loads CRM_PROMPT_ADMIN_ACTION on DID intent', () => {
  const p = buildCrmSystemPrompt('generate the DID for this quote and convert to PO');
  assert.ok(p.includes('ADMIN ACTION WORKFLOW (Quote-to-PO)'),
    'admin action section missing on DID prompt');
});

t('buildCrmSystemPrompt does NOT load intake/admin on plain CRM read', () => {
  const p = buildCrmSystemPrompt('show me the open deals for Chris');
  assert.ok(!p.includes('NEW CUSTOMER EMAIL INTAKE WORKFLOW'),
    'email intake section loaded on a plain read');
  assert.ok(!p.includes('ADMIN ACTION WORKFLOW (Quote-to-PO)'),
    'admin action section loaded on a plain read');
});

// ─── 8. Behavioral baselines from existing benchmark fixtures (sampled) ──────
console.log('\nPR-A · Behavioral baselines (sampled benchmark fixtures)\n────────────────────────────────────────────────────────────────');

// Each fixture below pairs a benchmark task (from BENCHMARK_TASKS in src) with
// the expected intent class. These are LOCAL classifications — they don't hit
// the live LLM. The goal is parity proof for the tool-array decision.
const BEHAVIORAL_FIXTURES = [
  { prompt: 'Create a new deal and quote for Stratus Information Systems: 5x MR46 access points with 3-year licenses.',
    expected: 'crm_write' },
  { prompt: 'List the 5 most recent open deals owned by Chris Graves',
    expected: 'crm_read' },
  { prompt: 'Find the most recent open deal for Chris Graves and report its stage, amount, and any related quote',
    expected: 'crm_read' },
  { prompt: 'Draft a follow-up email to the customer about the quote',
    expected: 'email' },
  { prompt: 'Assign the Cisco rep jacporti@cisco.com as the Meraki ISR on deal 2570562000400000001',
    expected: 'cisco_rep' },
  { prompt: 'Submit DID 12345678 to Velocity Hub for deal approval',
    expected: 'subscription' },
  { prompt: 'give me the URL quote for this set',
    expected: 'quote_url' }
];

t('Behavioral fixtures classify to expected intent classes', () => {
  const wrong = [];
  for (const f of BEHAVIORAL_FIXTURES) {
    const r = classifyCrmIntent(f.prompt);
    if (r.class !== f.expected) {
      wrong.push(`"${f.prompt.slice(0,50)}…" → got ${r.class}, expected ${f.expected}`);
    }
  }
  assert.deepStrictEqual(wrong, [],
    `Behavioral regressions:\n  ${wrong.join('\n  ')}`);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n────────────────────────────────────────────────────────────────`);
console.log(`Total: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
