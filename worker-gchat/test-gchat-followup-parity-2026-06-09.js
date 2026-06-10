// gchat follow-up parity — guards handoff Fix 2 (2026-06-09): handleFollowUpModifier
// existed ONLY in webex, so every revision typed in the Chrome extension ("change to
// essentials", "make it 300") went to the slow Claude fallback. The function is now
// COPIED VERBATIM into worker-gchat and wired at /api/quote (STEP 2.5) + the gchat
// webhook (before pricing/classify), with the Claude empty-URL strip on all gchat
// Claude reply paths.
//
// 1. PARITY: the two copies must stay byte-identical (sync discipline — webex is the
//    source of truth). Set WEBEX_DIR to compare against an unmerged webex worktree.
// 2. BEHAVIOR: the REAL gchat handleFollowUpModifier passes the core follow-up
//    scenarios with a mocked KV history.
//
// Run: node worker-gchat/test-gchat-followup-parity-2026-06-09.js

const fs = require('fs'), path = require('path'), os = require('os');

function extractHandler(file) {
  const src = fs.readFileSync(file, 'utf8');
  const start = src.indexOf('async function handleFollowUpModifier');
  if (start < 0) return null;
  let d = 0, started = false;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') { d++; started = true; }
    if (src[i] === '}') { d--; if (started && d === 0) return src.slice(start, i + 1); }
  }
  return null;
}

function loadEngine(workerDir, tag) {
  const here = path.isAbsolute(workerDir) ? workerDir : path.join(__dirname, '..', workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { handleFollowUpModifier, stripEmptyOrderUrls };`;
  const tmp = path.join(os.tmpdir(), `gfp-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

const kvWith = (assistantMsg) => ({
  get: async () => ({ messages: [
    { role: 'user', content: 'quote request' },
    { role: 'assistant', content: assistantMsg },
  ] }),
  put: async () => {},
});

const DUO_ADV_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-1YR&qty=200',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=200',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=200',
].join('\n');
const DNS_ESS_QUOTE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-3YR&qty=200';
const MR44_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=5,5',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=5,5',
].join('\n');

(async () => {
  // ── 1. PARITY: both copies byte-identical ──
  console.log('Parity: webex ↔ gchat handler copies');
  const webexDir = process.env.WEBEX_DIR || path.join(__dirname, '..', 'worker');
  const wbxHandler = extractHandler(path.join(webexDir, 'src/index.js'));
  const gcHandler = extractHandler(path.join(__dirname, 'src/index.js'));
  ok(!!wbxHandler, 'webex defines handleFollowUpModifier');
  ok(!!gcHandler, 'gchat defines handleFollowUpModifier');
  ok(wbxHandler && gcHandler && wbxHandler === gcHandler,
    'handler copies are BYTE-IDENTICAL (sync discipline)');

  // ── 2. BEHAVIOR: real gchat handler, mocked KV ──
  console.log('Behavior: gchat handleFollowUpModifier');
  const G = loadEngine(path.join(__dirname), 'gc');

  // Tier swap (the extension's live gap — previously Claude-only)
  let r = await G.handleFollowUpModifier('change to essentials', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-ESSENTIALS-3YR&qty=200/.test(r) && !/ADVANTAGE/.test(r),
    '"change to essentials" after Duo Advantage → ESSENTIALS (deterministic in gchat)');

  // Umbrella package-type swap (handoff Fix 1, now in BOTH workers)
  r = await G.handleFollowUpModifier('change to SIG Advantage', 'p1', kvWith(DNS_ESS_QUOTE));
  ok(r && /LIC-UMB-SIG-ADV-K9-3YR&qty=200/.test(r), '"change to SIG Advantage" → SIG-ADV (type swap ported)');

  // Qty change
  r = await G.handleFollowUpModifier('make it 300', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && /LIC-DUO-ADVANTAGE-3YR&qty=300/.test(r), '"make it 300" → qty 300 across buckets');

  // Term filter
  r = await G.handleFollowUpModifier('3 year only', 'p1', kvWith(MR44_QUOTE));
  ok(r && /LIC-ENT-3YR/.test(r) && !/LIC-ENT-1YR/.test(r) && !/LIC-ENT-5YR/.test(r),
    '"3 year only" → only the 3-Year bucket remains');

  // Hardware only
  r = await G.handleFollowUpModifier('hardware only', 'p1', kvWith(MR44_QUOTE));
  ok(r && /MR44-HW/.test(r) && !/LIC-ENT/.test(r), '"hardware only" → licenses dropped');

  // Add
  r = await G.handleFollowUpModifier('add 2 MX67', 'p1', kvWith(MR44_QUOTE));
  ok(r && /MX67/.test(r) && /MR44-HW/.test(r), '"add 2 MX67" → MX67 added alongside MR44');

  // Fail-closed: removes that need license rebalancing
  r = await G.handleFollowUpModifier('remove 2 MR44', 'p1', kvWith(MR44_QUOTE));
  ok(r === null, '"remove 2 MR44" (partial) → null (fail closed)');

  // Fail-closed: no prior quote
  r = await G.handleFollowUpModifier('change to essentials', 'p1', { get: async () => ({ messages: [] }), put: async () => {} });
  ok(r === null, 'no prior quote → null');

  // Guard: modifier output never contains empty order URLs
  r = await G.handleFollowUpModifier('change to essentials', 'p1', kvWith(DUO_ADV_QUOTE));
  ok(r && !/item=&qty=/.test(r), 'modifier output has no empty order URLs');

  // ── 3. stripEmptyOrderUrls (Claude-path guard, ported from webex #129) ──
  console.log('Claude empty-URL strip');
  const dirty = 'Here you go:\n**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=&qty=\n**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW&qty=5\nThanks!';
  const clean = G.stripEmptyOrderUrls(dirty);
  ok(!/item=&qty=/.test(clean) && /item=MR44-HW&qty=5/.test(clean) && /Thanks!/.test(clean),
    'strips empty-URL lines, keeps real URLs and text');
  ok(G.stripEmptyOrderUrls(null) === '' && G.stripEmptyOrderUrls('') === '', 'null/empty safe');

  // ── 4. /api/quote integration: follow-ups through the REAL endpoint ──
  // Stateful KV so the prior quote survives between calls (the stateless mock in
  // test-api-quote-handler can't exercise multi-turn). Codex review regressions:
  // single-term follow-up must carry the line's OWN term label, never positional.
  console.log('/api/quote integration (stateful KV)');
  {
    const store = new Map();
    const skv = {
      get: async (k, type) => { const v = store.get(k); if (v == null) return null; return type === 'json' || type === undefined ? (typeof v === 'string' ? JSON.parse(v) : v) : v; },
      put: async (k, v) => { store.set(k, v); },
      list: async () => ({ keys: [] }),
      getWithMetadata: async () => ({ value: null, metadata: null }),
    };
    const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
    const env = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: skv, PRICES_KV: { get: async () => null, put: async () => {} }, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: skv };
    const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

    // Load full worker (default export) — same shim as test-api-quote-handler.
    const here = __dirname;
    let wsrc = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
    const wesc = p => path.join(here, p).replace(/\\/g, '\\\\');
    wsrc = wsrc.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
    wsrc = wsrc.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${wesc('src/data/prices.json')}');`);
    wsrc = wsrc.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${wesc('src/data/auto-catalog.json')}');`);
    wsrc = wsrc.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${wesc('src/data/specs.json')}');`);
    wsrc = wsrc.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${wesc('src/data/accessories.json')}');`);
    wsrc = wsrc.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
    wsrc = wsrc.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
    wsrc = wsrc.replace(/^export default /m, 'module.exports.__worker = ');
    const wtmp = path.join(os.tmpdir(), `gfp-worker-${process.pid}.cjs`);
    fs.writeFileSync(wtmp, wsrc);
    const worker = require(wtmp).__worker;
    const callQuote = async (text, personId) => {
      const req = new Request('https://x.workers.dev/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
        body: JSON.stringify({ text, personId }),
      });
      const res = await worker.fetch(req, env, ctx);
      return await res.json();
    };

    // Turn 1: fresh quote (deterministic) seeds history
    let q = await callQuote('5 mr44', 'fp-int-1');
    ok(Array.isArray(q.quoteUrls) && q.quoteUrls.length === 3, 'turn 1 "5 mr44" → 3 term URLs');

    // Turn 2: single-term follow-up — THE codex label regression
    q = await callQuote('3 year only', 'fp-int-1');
    ok(q.handlerType === 'followup-modifier', 'turn 2 "3 year only" → handlerType followup-modifier');
    ok(q.quoteUrls && q.quoteUrls.length === 1 && /LIC-ENT-3YR/.test(q.quoteUrls[0].url),
      'turn 2 → exactly one URL with LIC-ENT-3YR');
    ok(q.quoteUrls && q.quoteUrls[0] && q.quoteUrls[0].label === '3-Year',
      `turn 2 label is "3-Year", not positional "1-Year" (got: ${q.quoteUrls && q.quoteUrls[0] && q.quoteUrls[0].label})`);
    ok(!q.pricingResponse, 'turn 2 (pure URL re-render) does NOT duplicate text into pricingResponse');

    // Turn 3: pricing re-render follow-up ("with pricing" — codex round 2: the dollar
    // lines must reach the extension via pricingResponse, not be swallowed)
    q = await callQuote('with pricing', 'fp-int-1');
    ok(q.handlerType === 'followup-modifier' && !/item=&qty=/.test(JSON.stringify(q)),
      `turn 3 "with pricing" → followup-modifier, no empty URLs (got: ${q.handlerType})`);
    ok(typeof q.pricingResponse === 'string' && /\$\d/.test(q.pricingResponse),
      `turn 3 pricingResponse carries the dollar pricing lines (got: ${q.pricingResponse ? 'text without $' : 'missing'})`);

    // Tier swap through the endpoint
    let q2 = await callQuote('200 duo advantage licenses 3 year', 'fp-int-2');
    ok(q2.quoteUrls && q2.quoteUrls.length >= 1, 'turn 1 duo quote renders');
    q2 = await callQuote('change to essentials', 'fp-int-2');
    ok(q2.handlerType === 'followup-modifier' && /LIC-DUO-ESSENTIALS/.test(JSON.stringify(q2.quoteUrls)) && !/ADVANTAGE/.test(JSON.stringify(q2.quoteUrls)),
      `"change to essentials" via /api/quote → followup-modifier with ESSENTIALS (got: ${q2.handlerType})`);

    // Single-term TERM REWRITE (codex round 3 BLOCKER: rewriteSkuTerm was webex-only —
    // a prior SINGLE-term quote + "3 year only" threw and fell to claude-fallback)
    let q3 = await callQuote('200 duo advantage licenses 1 year', 'fp-int-3');
    ok(q3.quoteUrls && /LIC-DUO-ADVANTAGE-1YR/.test(JSON.stringify(q3.quoteUrls)), 'turn 1 single-term (1yr) duo quote renders');
    q3 = await callQuote('3 year only', 'fp-int-3');
    ok(q3.handlerType === 'followup-modifier' && /LIC-DUO-ADVANTAGE-3YR/.test(JSON.stringify(q3.quoteUrls)) && !/1YR/.test(JSON.stringify(q3.quoteUrls)),
      `single-term rewrite "3 year only" → DUO-ADVANTAGE-3YR deterministically (got: ${q3.handlerType})`);

    // SME 5-year cap through the term rewrite (HARD RULE: LIC-SME-5YR must NEVER be emitted)
    let q4 = await callQuote('100 systems manager licenses 1 year', 'fp-int-4');
    ok(q4.quoteUrls && /LIC-SME-1YR/.test(JSON.stringify(q4.quoteUrls)), 'turn 1 SME 1yr quote renders');
    q4 = await callQuote('5 year only', 'fp-int-4');
    const q4s = JSON.stringify(q4);
    ok(!/LIC-SME-5YR/.test(q4s), 'SME "5 year only" NEVER emits LIC-SME-5YR (hard business rule)');
    ok(q4.handlerType === 'followup-modifier' && /LIC-SME-3YR/.test(q4s),
      `SME "5 year only" → capped to LIC-SME-3YR deterministically (got: ${q4.handlerType})`);
    ok(typeof q4.pricingResponse === 'string' && /Systems Manager/.test(q4.pricingResponse),
      'SME cap note reaches the extension via pricingResponse');
  }

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
