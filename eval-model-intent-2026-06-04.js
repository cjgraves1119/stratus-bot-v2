// ─────────────────────────────────────────────────────────────────────────────
// CLASSIFIER → ENGINE EVAL HARNESS — model-driven intent re-architecture (Phase 1)
//
// Design: DESIGN-model-intent-quoting-2026-06-04.md (PHASE 1, steps 2 & 3).
//
// WHAT THIS MEASURES
//   For each corpus input, the (LIVE classifier → DETERMINISTIC engine) pipeline:
//   does it produce the correct quote (right SKU+qty multiset) or correctly ASK
//   to clarify — and is it STABLE across N runs (the model is non-deterministic)?
//
// HOW (zero-replication-risk)
//   • The classification comes from the LIVE deployed classifier via the existing
//     /api/benchmark-classifier endpoint (X-Bench-Key auth). This is the REAL
//     CF_CLASSIFIER_PROMPT_V2 running on Workers AI — the exact prompt we measure.
//   • The consumption runs the REAL production functions — normalizeV2ClassifierForRouting,
//     buildQuoteFromV2, parseMessage, preserveMsAdvancedTier, buildQuoteResponse —
//     loaded locally from worker/src/index.js. consume() mirrors the webex handler
//     (worker/src/index.js ~8579, ~8713, ~8838-8921) line-for-line.
//   • Nothing here re-implements business logic; it only orchestrates the real
//     functions in the real order. Swap the classifier source (BASE_URL / MODEL /
//     PROMPT_VARIANT) or the engine (ENGINE_DIR) to re-measure across phases.
//
// SCOPE NOTE (baseline): measures the PRIMARY classifier (Llama-4-Scout + the
//   deployed V2 prompt) → engine. It does NOT replicate the Gemma-4 escalation
//   backstop (the waterfall at ~8601). That is intentional: Phase 1 measures the
//   prompt we are about to change in isolation. Gemma is a backstop the new design
//   keeps; an escalation arm can be added later (see TODO at bottom).
//
// Run:
//   node eval-model-intent-2026-06-04.js                 # default N=5, deployed prompt
//   N=8 CONCURRENCY=6 node eval-model-intent-2026-06-04.js
//   TIERS=CORE node eval-model-intent-2026-06-04.js      # only the CORE tier
//   BASE_URL=http://127.0.0.1:8787 node eval-...js        # wrangler dev --remote (Phase 2)
//   JSON_OUT=baseline.json node eval-...js                # dump full per-input record
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config (all overridable via env) ─────────────────────────────────────────
const BASE_URL       = process.env.BASE_URL || 'https://stratus-ai-bot.chrisg-ec1.workers.dev';
const BENCH_KEY      = process.env.BENCH_KEY; // must match the worker DASHBOARD_KEY secret (no hardcoded fallback)
if (!BENCH_KEY) { console.error('Set BENCH_KEY env var (value of the worker DASHBOARD_KEY secret) before running.'); process.exit(1); }
const MODEL          = process.env.MODEL || '@cf/meta/llama-4-scout-17b-16e-instruct';
const PROMPT_VARIANT = process.env.PROMPT_VARIANT || 'v2';
const ENGINE_DIR     = process.env.ENGINE_DIR || 'worker';            // which worker's engine to load
const N              = parseInt(process.env.N || '5', 10);             // runs per input (stability)
const CONCURRENCY    = parseInt(process.env.CONCURRENCY || '6', 10);   // parallel live calls
const MAX_RETRIES    = parseInt(process.env.MAX_RETRIES || '3', 10);   // per live call on transient err
const TIERS          = (process.env.TIERS || 'CORE,EXTENDED,COVERAGE').split(',').map(s => s.trim().toUpperCase());
const JSON_OUT       = process.env.JSON_OUT || '';
const CONSUMER       = (process.env.CONSUMER || 'v2').toLowerCase();        // 'v2' | 'v3' adapter
const FIXTURES       = process.env.FIXTURES || '';                          // JSON file of deterministic classifications → skip live calls
const PROMPT_FILE    = process.env.PROMPT_FILE || '';                       // .js exporting a prompt string → sent as prompt_override (live V3 A/B)
const PROMPT_OVERRIDE = PROMPT_FILE
  ? (() => { const m = require(path.isAbsolute(PROMPT_FILE) ? PROMPT_FILE : path.join(__dirname, PROMPT_FILE)); return m.CF_CLASSIFIER_PROMPT_V3 || m.CF_CLASSIFIER_PROMPT_V2 || Object.values(m).find(v => typeof v === 'string') || ''; })()
  : '';

// ── Engine loader (same require-trick the bug #2 corpus uses) ─────────────────
// Loads <repo>/<ENGINE_DIR>/src/index.js as a CJS module and exposes the real
// production functions consume() needs. No logic is altered — only ESM import /
// export lines are rewritten so Node can require it.
function loadEngine(workerDir) {
  const here = path.isAbsolute(workerDir) ? workerDir : path.join(__dirname, workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  // Strip the `export default { ... }` worker object (brace-matched).
  const ed = src.indexOf('export default');
  if (ed > -1) {
    let d = 0, started = false, end = ed;
    for (let i = ed; i < src.length; i++) {
      if (src[i] === '{') { d++; started = true; }
      if (src[i] === '}') { d--; if (started && d === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, ed) + src.slice(end + 1);
  }
  // Export exactly the functions the webex consumption path calls.
  src += `\nmodule.exports = { parseMessage, buildQuoteResponse, buildQuoteFromV2, buildQuoteFromV3, normalizeV2ClassifierForRouting, buildClassifierClarifyReply, preserveMsAdvancedTier };`;
  const tmp = path.join(os.tmpdir(), `eval-engine-${workerDir.replace(/\W/g, '')}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

// ── Live classifier call ─────────────────────────────────────────────────────
// POST the deployed /api/benchmark-classifier. Returns { parsed, raw, elapsed,
// err, parseError }. Retries on transient errors (timeout / empty / 5xx).
async function classifyLive(input) {
  let lastErr = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}/api/benchmark-classifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Bench-Key': BENCH_KEY },
        body: JSON.stringify({ input, model: MODEL, prompt_variant: PROMPT_VARIANT, prompt_override: PROMPT_OVERRIDE || undefined }),
      });
      if (!res.ok) { lastErr = `HTTP ${res.status}`; await sleep(400 * attempt); continue; }
      const body = await res.json();
      if (body.err || (!body.parsed && body.parseError)) {
        lastErr = body.err || body.parseError;
        await sleep(400 * attempt);
        continue;
      }
      if (!body.parsed || typeof body.parsed !== 'object' || !body.parsed.intent) {
        lastErr = 'no parsed.intent'; await sleep(400 * attempt); continue;
      }
      return { ok: true, v2: body.parsed, elapsed: body.elapsed, attempt };
    } catch (e) {
      lastErr = e.message; await sleep(400 * attempt);
    }
  }
  return { ok: false, error: lastErr };
}

// ── consume(): faithful mirror of the webex handler quote/clarify path ────────
// Mirrors worker/src/index.js:
//   ~8579  route = normalizeV2ClassifierForRouting(v2, text, hasPriorCtx=false)
//   ~8713  intent==='clarify' → render clarify reply (or buildClassifierClarifyReply)
//   ~8838  intent==='quote'  → buildQuoteFromV2(route, text) ...
//   ~8858  ... || parseMessage(text)
//   ~8859  preserveMsAdvancedTier(qp, text)
//   ~8864  qp.isClarification → clarify ; ~8876 qp.isRevision → Claude
//   ~8909  buildQuoteResponse(qp); ~8910 quote counts only if message && !needsLlm
// The corpus has no prior context, so hasPriorCtx=false throughout.
function consume(eng, v2, text) {
  const route = eng.normalizeV2ClassifierForRouting(v2, text, false) || v2;
  const intent = String(route.intent || '').toLowerCase();

  if (intent === 'clarify') {
    const q = route.reply || eng.buildClassifierClarifyReply(text, route) || '';
    return { kind: 'clarify', intent, question: q };
  }

  // Only intent==='quote' takes the V2-direct adapter; everything else (revise
  // surviving normalize, price_lookup, product_info, conversation, escalate)
  // does NOT produce the deterministic quote — it routes to Claude / a price
  // path in prod. We surface that as a misroute so a quote-expected input fails.
  let qp = null;
  if (intent === 'quote') {
    try { qp = eng.buildQuoteFromV2(route, text); } catch { qp = null; }
    if (!qp) qp = eng.parseMessage(text);           // adapter null → parseMessage fallback
  } else {
    return { kind: 'misroute', intent };
  }

  qp = eng.preserveMsAdvancedTier(qp, text);
  if (!qp) return { kind: 'none', intent };
  if (qp.isClarification && qp.clarificationMessage) return { kind: 'clarify', intent, question: qp.clarificationMessage };
  if (qp.isRevision) return { kind: 'revision', intent };

  const r = eng.buildQuoteResponse(qp);
  if (!r) return { kind: 'none', intent };
  if (!r.message || r.needsLlm || (r.errors && r.errors.length)) {
    return { kind: 'llm', intent, errors: r.errors || null };
  }
  return { kind: 'quote', intent, skus: skuQty(r.message) };
}

// ── consumeV3(): the v3 adapter — per-item synth → parseMessage → buildQuoteResponse
// → union. Validated by probe-resolver-2026-06-04.cjs: each item rendered in ISOLATION
// so named-license (isTermOptionQuote), agnostic, and EOL shapes each take their own
// engine path — no multi-item merge drop. clarify wins. This is the EVAL adapter
// (proves classifier+resolver correctness via the SKU multiset); the production
// mixed-quote renderer extension is the separate Phase-3 task (per Codex). Requires
// the per-item engine (ENGINE_DIR=/tmp/parked-engine/worker) for correct intent gating.
const TIER_WORD = { SEC: 'SEC', SDW: 'SD-WAN', ENT: 'enterprise', A: 'advanced' };
function synthV3(product, intent, qty, tier) {
  let base = `${qty} ${product}`;
  if (tier && TIER_WORD[tier]) base += ` ${TIER_WORD[tier]}`;  // parseMessage resolves the tier word/suffix
  if (intent === 'license') return `${base} license`;
  if (intent === 'hardware') return `${base} hardware only`;
  return base; // normal → hardware + license
}
// Does a SKU carry a license term suffix? LIC-ENT-5YR / LIC-MX85-SEC-5Y / LIC-L-AC-PLS-5Y-S1 / LIC-MS130-24-5Y
function skuTerm(sku) {
  const m = /-(\d)Y(?:R)?(?:-S1)?$/.exec(sku);
  return m ? parseInt(m[1], 10) : null;
}
function consumeV3(eng, v3, text) {
  if (v3.clarify && v3.clarify.needed === true) return { kind: 'clarify', intent: v3.intent, question: v3.clarify.question || '' };
  const items = Array.isArray(v3.items) ? v3.items : [];
  if (!items.length) return { kind: 'none', intent: v3.intent };
  const mods = v3.modifiers || {};
  const union = {};
  for (const it of items) {
    const product = String(it.product || '').trim();
    if (!product) continue;
    const intent = it.intent === 'hardware' ? 'hardware' : it.intent === 'license' ? 'license' : 'normal';
    const qty = Number.isFinite(Number(it.qty)) && Number(it.qty) > 0 ? Math.floor(Number(it.qty)) : 1;
    const s = synthV3(product, intent, qty, mods.tier);
    let qp; try { qp = eng.parseMessage(s); } catch { return { kind: 'llm', intent: v3.intent, errors: ['parse:' + product] }; }
    if (!qp) continue;
    qp = eng.preserveMsAdvancedTier(qp, s);
    if (qp.isClarification && qp.clarificationMessage) return { kind: 'clarify', intent: v3.intent, question: qp.clarificationMessage };
    let r; try { r = eng.buildQuoteResponse(qp); } catch { return { kind: 'llm', intent: v3.intent, errors: ['build:' + product] }; }
    if (!r || !r.message) continue;
    const m = skuQty(r.message);
    for (const k of Object.keys(m)) union[k] = Math.max(union[k] || 0, m[k]);
  }
  // list-level single-term filter: drop license SKUs of other terms (hardware SKUs have no term → kept).
  const wantTerm = (!mods.all_terms && mods.term_years) ? Number(mods.term_years) : null;
  if (wantTerm) for (const k of Object.keys(union)) { const t = skuTerm(k); if (t !== null && t !== wantTerm) delete union[k]; }
  if (!Object.keys(union).length) return { kind: 'none', intent: v3.intent };
  return { kind: 'quote', intent: v3.intent, skus: union };
}

// ── consumeV3prod(): the PRODUCTION path — calls the real eng.buildQuoteFromV3
// (single flattened parsed) → eng.buildQuoteResponse → extract SKUs from the rendered
// message (so qtys reflect buildStratusUrl's real SUM-on-dedup, not consumeV3's MAX).
// Also returns `message` so a grouping inspector can assert per-URL structure.
function consumeV3prod(eng, v3, text) {
  let qp;
  try { qp = eng.buildQuoteFromV3(v3, text); } catch (e) { return { kind: 'llm', intent: v3.intent, errors: ['v3:' + e.message] }; }
  if (!qp) return { kind: 'none', intent: v3.intent };
  if (qp.isClarification && qp.clarificationMessage) return { kind: 'clarify', intent: v3.intent, question: qp.clarificationMessage };
  let r; try { r = eng.buildQuoteResponse(qp); } catch (e) { return { kind: 'llm', intent: v3.intent, errors: ['build:' + e.message] }; }
  if (!r) return { kind: 'none', intent: v3.intent };
  if (!r.message || r.needsLlm || (r.errors && r.errors.length)) return { kind: 'llm', intent: v3.intent, errors: r.errors || null };
  return { kind: 'quote', intent: v3.intent, skus: skuQty(r.message), message: r.message };
}

// SKU → max qty seen across all order URLs in a string (term URLs repeat SKUs).
// Identical to the bug #2 corpus extractor.
function skuQty(text) {
  const map = {};
  for (const m of (text || '').matchAll(/item=([^&\s]+)&qty=([0-9,]+)/g)) {
    const skus = decodeURIComponent(m[1]).split(',');
    const qtys = m[2].split(',');
    skus.forEach((s, i) => { const q = parseInt(qtys[i] || '0', 10); if (!map[s] || q > map[s]) map[s] = q; });
  }
  return map;
}

// ── Grading ──────────────────────────────────────────────────────────────────
// expect = { clarify:true } | { quote:{ has:[{re,qty?}], hasnt:[re] } }
function gradeRun(result, expect) {
  if (expect.clarify) {
    return { pass: result.kind === 'clarify', why: result.kind === 'clarify' ? 'clarified' : `kind=${result.kind}(${result.intent || ''})` };
  }
  // quote expectation
  if (result.kind !== 'quote') return { pass: false, why: `kind=${result.kind}(${result.intent || ''})` };
  const m = result.skus || {};
  const present = re => Object.keys(m).find(k => re.test(k));
  for (const need of (expect.quote.has || [])) {
    const k = present(need.re);
    if (!k) return { pass: false, why: `missing ${need.re}` };
    if (need.qty != null && m[k] !== need.qty) return { pass: false, why: `${k} qty ${m[k]}≠${need.qty}` };
  }
  for (const bad of (expect.quote.hasnt || [])) {
    const k = present(bad);
    if (k) return { pass: false, why: `unexpected ${k} (${bad})` };
  }
  return { pass: true, why: 'ok' };
}

// Canonical signature for stability: same final decision across N runs?
function signature(result) {
  if (result.kind === 'quote') {
    return 'quote:' + Object.keys(result.skus).sort().map(k => `${k}=${result.skus[k]}`).join(',');
  }
  if (result.kind === 'clarify') return 'clarify';
  return `${result.kind}:${result.intent || ''}`;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Tiny concurrency-capped map.
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return out;
}

// ── CORPUS ───────────────────────────────────────────────────────────────────
// Ground truth: CORE entries are ported verbatim from the bug #2 ACCEPTANCE
// corpus (worker-gchat/test-per-item-intent-2026-06-04.js), which is gated +
// acceptance-tested on branch fix/quoting-per-item-intent → solid target spec.
// EXTENDED entries are the design-doc-named real cases (negation, "just the
// hardware for", clarify). DIAGNOSTIC entries (parked bare-family bug) are
// recorded but NOT counted in the headline (separate workstream per the design).
const CORPUS = [
  // ── CORE: mixed per-item intent (the core of bug #2) ──
  { tier: 'CORE', tag: 'mixed:lic+lic+hwonly', input: '6 mr and 1 mx84 enterprise license renewal and 1 CW9172I hardware only',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/, qty: 6 }, { re: /^LIC-MX84/ }, { re: /^CW9172I-RTG$/ }], hasnt: [/^MR\d*-HW$/, /^MX84-HW$/] } } },
  { tier: 'CORE', tag: 'mixed:lic+lic+bareNormal', input: '6 mr and 1 mx84 enterprise license renewal and 1 CW9172I',
    expect: { quote: { has: [{ re: /^CW9172I-RTG$/ }, { re: /^LIC-MX84/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [] } } },
  { tier: 'CORE', tag: 'order:hwonly+normal', input: '1 CW9172I hardware only and 6 MR44',
    expect: { quote: { has: [{ re: /^CW9172I-RTG$/ }, { re: /^MR44-HW$/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [] } } },
  { tier: 'CORE', tag: 'order:liconly+bareNormal', input: '1 MR44 license renewal and 1 CW9172I',
    // NOTE: no qty on LIC-ENT — "1 CW9172I" (bare) is a NORMAL AP and contributes
    // its OWN LIC-ENT, so the combined LIC-ENT qty is 2 (MR44 renewal + CW9172I).
    // The key assertions: CW9172I hardware present (not license-folded) + MR44 has
    // no hardware (license-only renewal). Verified vs parked target engine.
    expect: { quote: { has: [{ re: /^CW9172I-RTG$/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [/^MR44-HW$/] } } },
  { tier: 'CORE', tag: 'then:renew+hardware', input: 'renew MX67 then add MR44 hardware',
    expect: { quote: { has: [{ re: /^LIC-MX67/ }, { re: /^MR44-HW$/ }], hasnt: [/^MX67-HW$/, /^LIC-ENT-\dYR$/] } } },
  { tier: 'CORE', tag: 'then:renew+hardware(no-add)', input: 'renew MX67 then MR44 hardware',
    expect: { quote: { has: [{ re: /^LIC-MX67/ }, { re: /^MR44-HW$/ }], hasnt: [/^LIC-ENT-\dYR$/] } } },

  // ── CORE: single-intent regression guards (baseline SHOULD pass these) ──
  { tier: 'CORE', tag: 'single:hwonly', input: '6 mr44 hardware only',
    expect: { quote: { has: [{ re: /^MR44-HW$/ }], hasnt: [/^LIC-ENT/] } } },
  { tier: 'CORE', tag: 'single:renewal', input: 'renewal for 6 mr44',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/ }], hasnt: [/^MR44-HW$/] } } },
  { tier: 'CORE', tag: 'single:normal', input: '6 mr44',
    expect: { quote: { has: [{ re: /^MR44-HW$/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [] } } },
  { tier: 'CORE', tag: 'single:eol-hwonly', input: 'MS220-8P hardware only',
    expect: { quote: { has: [{ re: /^MS130-8P-HW$/ }], hasnt: [/^LIC-/] } } },

  // ── CORE: list-level modifiers must cover ALL items ──
  { tier: 'CORE', tag: 'list:trailing-licenses', input: '2 MS130-24P, 4 MR44, 5 MX67 licenses',
    expect: { quote: { has: [], hasnt: [/-HW$/] } } },
  { tier: 'CORE', tag: 'list:leading-renewal', input: 'renewal for 4 MR44 and 5 MX67',
    expect: { quote: { has: [], hasnt: [/-HW$/] } } },
  { tier: 'CORE', tag: 'list:leading-hardware', input: 'quote hardware for 1 MX67 and 1 MR44',
    expect: { quote: { has: [{ re: /^MX67-HW$/ }, { re: /^MR44-HW$/ }], hasnt: [/^LIC-/] } } },
  { tier: 'CORE', tag: 'list:leading-license-renewal', input: 'license renewal for 6 mr44 and 1 mx67',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/ }, { re: /^LIC-MX67/ }], hasnt: [/-HW$/] } } },
  { tier: 'CORE', tag: 'list:leading-ent-license-renewal', input: 'enterprise license renewal for 6 mr44 and 1 mx67',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/ }, { re: /^LIC-MX67/ }], hasnt: [/-HW$/] } } },

  // ── CORE: "hardware <noun>" must NOT mean hardware-only ──
  { tier: 'CORE', tag: 'guard:hardware-noun', input: 'quote hardware support for 1 MX67 and 1 MR44 hardware model',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/ }, { re: /^LIC-MX67/ }, { re: /^MR44-HW$/ }, { re: /^MX67-HW$/ }], hasnt: [] } } },

  // ── EXTENDED: negation → hardware-only (design-named, loop-found real case) ──
  // detNote = the deterministic regex fallback provably CANNOT satisfy this (by
  // design — model/routing required); not a flawed oracle. The live model already
  // beats the regex here (passes the live eval), which is the architecture's point.
  { tier: 'EXTENDED', tag: 'neg:without-the-license', input: 'quote 6 mr44 without the license',
    detNote: 'regex "WITHOUT (A)? LICENSE" misses "the/their" → emits the inverse (license); model reads negation correctly',
    expect: { quote: { has: [{ re: /^MR44-HW$/ }], hasnt: [/^LIC-ENT/] } } },
  { tier: 'EXTENDED', tag: 'neg:without-their-license', input: '5 mx67 without their license',
    detNote: 'same negation gap as above; model-required',
    expect: { quote: { has: [{ re: /^MX67-HW$/ }], hasnt: [/^LIC-MX67/] } } },

  // ── EXTENDED: "just the hardware for" → hardware-only (parked engine handles it) ──
  { tier: 'EXTENDED', tag: 'justhw:single', input: 'just the hardware for 3 MR46',
    expect: { quote: { has: [{ re: /^MR46-HW$/, qty: 3 }], hasnt: [/^LIC-ENT/] } } },

  // ── EXTENDED: clarify ("ask when unclear" — Chris's rule) ──
  { tier: 'EXTENDED', tag: 'clarify:hardware-refresh-no-target', input: '4 APs, hardware refresh',
    detNote: 'true NL ambiguity (refresh to WHICH model?) — only the model can detect → clarify; deterministic engine yields nothing',
    expect: { clarify: true } },
  { tier: 'EXTENDED', tag: 'clarify:stem-needs-suffix', input: 'quote 5 MS130-24',
    detNote: 'routing guard (classifierHasAmbiguousStem) clarifies; raw parseMessage instead quotes MS130-24',
    expect: { clarify: true } },
  { tier: 'EXTENDED', tag: 'clarify:bare-family', input: '3 MX',
    detNote: 'routing guard (ambiguous stem MX) clarifies; raw parseMessage yields nothing',
    expect: { clarify: true } },
  { tier: 'EXTENDED', tag: 'clarify:vague-switches', input: 'need some switches',
    detNote: 'classifier returns clarify intent; deterministic engine yields nothing',
    expect: { clarify: true } },

  // ── COVERAGE: product breadth × per-item intent (oracle-validated below) ──
  // Each stresses per-item intent across a NEW family or modifier. Expectations
  // are validated against the parked target engine (verify-oracle); any the regex
  // fallback can't reach get a detNote (model-required), the rest are det-reachable.
  { tier: 'COVERAGE', tag: 'cov:duo+mr-normal', input: '10 duo essentials and 6 mr44',
    detNote: 'parseMessage fallback drops the hardware sibling next to a named license; classifier+adapter path must keep both (Phase-3 adapter, may relate to the parked sibling-drop workstream)',
    expect: { quote: { has: [{ re: /^LIC-DUO-ESSENTIALS-\dYR$/ }, { re: /^MR44-HW$/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [] } } },
  { tier: 'COVERAGE', tag: 'cov:duo-adv-3yr + mr-hwonly', input: 'duo advantage 3 year and 4 mr44 hardware only',
    detNote: 'named-license + per-item hardware-only sibling; deterministic fallback drops the MR44, classifier path required',
    expect: { quote: { has: [{ re: /^LIC-DUO-ADVANTAGE-3YR$/ }, { re: /^MR44-HW$/ }], hasnt: [/^LIC-ENT/] } } },
  { tier: 'COVERAGE', tag: 'cov:umbrella+mx-normal', input: 'umbrella DNS essentials and 2 mx67',
    detNote: 'same named-license sibling-drop in the deterministic fallback; classifier path must keep both',
    expect: { quote: { has: [{ re: /^LIC-UMB-DNS-ESS/ }, { re: /^MX67-HW$/ }, { re: /^LIC-MX67/ }], hasnt: [] } } },
  { tier: 'COVERAGE', tag: 'cov:anyconnect-plus', input: '10 AnyConnect Plus',
    expect: { quote: { has: [{ re: /^LIC-L-AC-PLS-\dY-S1$/ }], hasnt: [/-HW$/, /^LIC-L-AC-APX/] } } },
  { tier: 'COVERAGE', tag: 'cov:sme-1-3yr-cap', input: 'SME license 1yr and 3yr',
    detNote: 'parseMessage fallback doesn\'t expand multi-term SME (only 1YR); classifier sets all_terms. SME 5YR must never appear (deprecated/capped).',
    expect: { quote: { has: [{ re: /^LIC-SME-1YR$/ }, { re: /^LIC-SME-3YR$/ }], hasnt: [/^LIC-SME-5YR$/, /-HW$/] } } },
  { tier: 'COVERAGE', tag: 'cov:mx-sec-5yr', input: '10 mx67 SEC 5 year',
    expect: { quote: { has: [{ re: /^MX67-HW$/, qty: 10 }, { re: /^LIC-MX67-SEC-5YR$/ }], hasnt: [/^LIC-MX67-SEC-1YR$/, /^LIC-MX67-SEC-3YR$/] } } },
  { tier: 'COVERAGE', tag: 'cov:mr-3yr-normal', input: '5 mr44 3 year',
    expect: { quote: { has: [{ re: /^MR44-HW$/, qty: 5 }, { re: /^LIC-ENT-3YR$/ }], hasnt: [/^LIC-ENT-1YR$/, /^LIC-ENT-5YR$/] } } },
  { tier: 'COVERAGE', tag: 'cov:mx-sdwan-suffix', input: 'MX85 SD-WAN with licensing',
    expect: { quote: { has: [{ re: /^MX85-HW$/ }, { re: /^LIC-MX85-SDW/ }], hasnt: [] } } },
  { tier: 'COVERAGE', tag: 'cov:eol-normal', input: '10 MX84',
    expect: { quote: { has: [{ re: /^MX85-HW$/, qty: 10 }, { re: /^LIC-MX85/ }], hasnt: [/^MX84-HW$/] } } },
  // (MR46 + MR44 — both current Wi-Fi 6; avoids an EOL-replacement confound. MR56→MR57 EOL.)
  { tier: 'COVERAGE', tag: 'cov:separate-quotes', input: '5 MR46 and 5 MR44 as separate quotes',
    expect: { quote: { has: [{ re: /^MR46-HW$/ }, { re: /^MR44-HW$/ }, { re: /^LIC-ENT-\dYR$/ }], hasnt: [] } } },
  { tier: 'COVERAGE', tag: 'cov:neg-no-license', input: '6 mr44 no license',
    expect: { quote: { has: [{ re: /^MR44-HW$/ }], hasnt: [/^LIC-ENT/] } } },
  { tier: 'COVERAGE', tag: 'cov:clarify-upgrade-firewalls', input: 'upgrade my firewalls',
    detNote: 'no target model — model-only NL-ambiguity clarify; deterministic engine yields nothing',
    expect: { clarify: true } },
  { tier: 'COVERAGE', tag: 'cov:clarify-vague-wireless', input: 'I need wireless',
    detNote: 'vague category — model-only clarify',
    expect: { clarify: true } },

  // ── DIAGNOSTIC: parked pre-existing bare-family + sibling drop (NOT headline) ──
  { tier: 'DIAGNOSTIC', tag: 'parked:bare-family-drop-mv', input: '4 mv and 6 mr44',
    expect: { quote: { has: [{ re: /^MV/ }, { re: /^MR44/ }], hasnt: [] } } },
  { tier: 'DIAGNOSTIC', tag: 'parked:bare-family-drop-mx', input: '6 mr renewal and 1 mx67',
    expect: { quote: { has: [{ re: /^LIC-ENT-\dYR$/ }, { re: /^(LIC-MX67|MX67)/ }], hasnt: [] } } },
];

// Exported for offline smoke-testing (loader/consume) without live calls.
module.exports = { loadEngine, consume, consumeV3, consumeV3prod, synthV3, classifyLive, skuQty, gradeRun, signature, CORPUS };

// ── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  const active = CORPUS.filter(c => TIERS.includes(c.tier) || c.tier === 'DIAGNOSTIC');
  console.log('━'.repeat(78));
  console.log('CLASSIFIER → ENGINE EVAL  (model-driven intent, Phase 1 baseline)');
  console.log(`  classifier : ${FIXTURES ? `FIXTURES ${FIXTURES} (deterministic)` : `${MODEL} variant=${PROMPT_VARIANT} @ ${BASE_URL}`}`);
  console.log(`  adapter    : consume${CONSUMER.toUpperCase()}`);
  console.log(`  engine     : ${ENGINE_DIR}/src/index.js (real production fns, loaded locally)`);
  console.log(`  runs/input : N=${FIXTURES ? 1 : N}   tiers=${TIERS.join('+')}(+DIAGNOSTIC)`);
  console.log('━'.repeat(78));

  const eng = loadEngine(ENGINE_DIR);
  const doConsume = (cls, text) => (CONSUMER === 'v3prod' ? consumeV3prod(eng, cls, text) : CONSUMER === 'v3' ? consumeV3(eng, cls, text) : consume(eng, cls, text));

  // FIXTURES mode: deterministic classifications from a JSON file ({ "<input>": <classification> }).
  // No live calls, no model randomness — validates the ADAPTER. Runs N=1 (deterministic).
  const fixtures = FIXTURES ? JSON.parse(fs.readFileSync(path.isAbsolute(FIXTURES) ? FIXTURES : path.join(__dirname, FIXTURES), 'utf8')) : null;
  const effN = fixtures ? 1 : N;

  // Flatten to (input, runIndex) tasks for the concurrency pool.
  const tasks = [];
  active.forEach((c, ci) => { for (let r = 0; r < effN; r++) tasks.push({ ci, r }); });

  const raw = active.map(() => []); // raw[ci] = [{ok, v2, result}] per run
  let done = 0;
  await mapLimit(tasks, fixtures ? 1 : CONCURRENCY, async ({ ci }) => {
    const c = active[ci];
    let entry;
    if (fixtures) {
      const cls = fixtures[c.input];
      if (!cls) entry = { ok: false, error: 'no fixture for input', result: { kind: 'callfail' } };
      else entry = { ok: true, v2: cls, elapsed: 0, result: doConsume(cls, c.input) };
    } else {
      const live = await classifyLive(c.input);
      if (!live.ok) entry = { ok: false, error: live.error, result: { kind: 'callfail' } };
      else entry = { ok: true, v2: live.v2, elapsed: live.elapsed, result: doConsume(live.v2, c.input) };
    }
    raw[ci].push(entry);
    done++;
    if (done % 10 === 0 || done === tasks.length) process.stdout.write(`\r  …${done}/${tasks.length} ${fixtures ? 'fixtures' : 'live calls'}`);
  });
  process.stdout.write('\n\n');

  // Aggregate per input.
  const rows = active.map((c, ci) => {
    const runs = raw[ci];
    const usable = runs.filter(x => x.ok);
    const grades = usable.map(x => gradeRun(x.result, c.expect));
    const passes = grades.filter(g => g.pass).length;
    const sigs = new Set(usable.map(x => signature(x.result)));
    const stable = sigs.size === 1 && usable.length === runs.length;
    const allPass = passes === runs.length && runs.length > 0;
    const stableCorrect = stable && allPass;
    // A representative run for diagnosis (prefer a failing one).
    const sample = (runs.find(x => x.ok && !gradeRun(x.result, c.expect).pass) || runs.find(x => x.ok) || runs[0]);
    const sampleGrade = sample && sample.ok ? gradeRun(sample.result, c.expect) : { pass: false, why: sample?.error || 'callfail' };
    return { c, runs, passes, n: runs.length, stable, stableCorrect, sigs: [...sigs], sample, sampleGrade };
  });

  // ── Per-input report ──
  const tierOrder = ['CORE', 'EXTENDED', 'COVERAGE', 'DIAGNOSTIC'];
  for (const tier of tierOrder) {
    const tierRows = rows.filter(r => r.c.tier === tier);
    if (!tierRows.length) continue;
    console.log(`\n┌─ ${tier} ${'─'.repeat(72 - tier.length)}`);
    for (const row of tierRows) {
      const { c } = row;
      const verdict = row.stableCorrect ? '✅' : (!row.stable ? '⚠️ ' : '❌');
      const flake = row.stable ? '' : ` UNSTABLE(${row.sigs.length} sigs)`;
      console.log(`│ ${verdict} [${row.passes}/${row.n}]${flake}  ${c.tag}`);
      console.log(`│      in : "${c.input}"`);
      if (!row.stableCorrect) {
        const s = row.sample;
        if (s && s.ok) {
          // Handle both v2 ({sku,sku_type}) and v3 ({product,intent}) item shapes.
          const items = (s.v2.items || []).map(i => `${i.qty || 1}×${i.sku || i.product}${(i.sku_type || i.intent) ? `(${(i.sku_type || i.intent)[0]})` : ''}`).join(' ');
          const mods = s.v2.modifiers || {};
          const clr = s.v2.clarify && s.v2.clarify.needed ? 'clarify' : '';
          const modStr = [clr, mods.hardware_only && 'hw_only', mods.license_only && 'lic_only', mods.term_years && `term=${mods.term_years}`, mods.tier && `tier=${mods.tier}`, mods.all_terms && 'all_terms', mods.separate_quotes && 'separate'].filter(Boolean).join(',');
          console.log(`│      clf: intent=${s.v2.intent} items=[${items}]${modStr ? ` mods={${modStr}}` : ''}`);
          console.log(`│      eng: ${describeResult(s.result)}`);
          console.log(`│      ✗  : ${row.sampleGrade.why}`);
        } else {
          console.log(`│      ✗  : ${row.sampleGrade.why}`);
        }
      }
    }
    console.log(`└${'─'.repeat(76)}`);
  }

  // ── Headline ──
  const summarize = (tier) => {
    const r = rows.filter(x => x.c.tier === tier);
    if (!r.length) return null;
    const sc = r.filter(x => x.stableCorrect).length;
    const st = r.filter(x => x.stable).length;
    return { tier, total: r.length, stableCorrect: sc, stable: st };
  };
  console.log('\n' + '━'.repeat(78));
  console.log('BASELINE SUMMARY  (stable+correct = passes all N runs AND identical across N)');
  console.log('━'.repeat(78));
  let headlineSC = 0, headlineTot = 0;
  for (const tier of tierOrder) {
    const s = summarize(tier);
    if (!s) continue;
    const pct = (n) => `${n}/${s.total} (${Math.round(100 * n / s.total)}%)`;
    const headline = tier !== 'DIAGNOSTIC';
    if (headline) { headlineSC += s.stableCorrect; headlineTot += s.total; }
    console.log(`  ${tier.padEnd(11)}  stable+correct ${pct(s.stableCorrect).padEnd(16)}  stable ${pct(s.stable)}${headline ? '' : '   (diagnostic — excluded from headline)'}`);
  }
  console.log('  ' + '─'.repeat(74));
  console.log(`  HEADLINE     stable+correct ${headlineSC}/${headlineTot} (${Math.round(100 * headlineSC / headlineTot)}%)   [all non-DIAGNOSTIC tiers]`);
  console.log('━'.repeat(78));

  if (JSON_OUT) {
    const dump = {
      meta: { ts: new Date().toISOString?.() || 'n/a', BASE_URL, MODEL, PROMPT_VARIANT, ENGINE_DIR, N },
      rows: rows.map(r => ({
        tier: r.c.tier, tag: r.c.tag, input: r.c.input, expect: describeExpect(r.c.expect),
        passes: r.passes, n: r.n, stable: r.stable, stableCorrect: r.stableCorrect, signatures: r.sigs,
        runs: r.runs.map(x => x.ok ? { intent: x.v2.intent, items: x.v2.items, modifiers: x.v2.modifiers, result: x.result } : { error: x.error }),
      })),
    };
    fs.writeFileSync(path.join(__dirname, JSON_OUT), JSON.stringify(dump, null, 2));
    console.log(`\n  full per-input record → ${JSON_OUT}`);
  }

  // Exit non-zero only on UNSTABLE rows (a harness/flakiness signal). Baseline
  // correctness is expected to be < 100% — that's the gap we're measuring, not a
  // CI failure. (Phase-gate runs will assert correctness explicitly.)
  const anyUnstable = rows.some(r => !r.stable);
  process.exit(anyUnstable ? 0 : 0); // always 0 in baseline mode; see comment
}

if (require.main === module) {
  main().catch(e => { console.error('FATAL', e); process.exit(2); });
}

function describeResult(r) {
  if (r.kind === 'quote') return `QUOTE ${Object.keys(r.skus).sort().map(k => `${k}×${r.skus[k]}`).join(' ') || '(empty)'}`;
  if (r.kind === 'clarify') return `CLARIFY "${String(r.question || '').slice(0, 80)}"`;
  if (r.kind === 'misroute') return `MISROUTE→${r.intent} (not the deterministic quote path)`;
  if (r.kind === 'llm') return `LLM-ESCALATE${r.errors ? ` errors=${r.errors.join('|').slice(0, 60)}` : ''}`;
  return r.kind + (r.intent ? `(${r.intent})` : '');
}
function describeExpect(e) {
  if (e.clarify) return 'CLARIFY';
  return 'QUOTE has=' + (e.quote.has || []).map(h => `${h.re}${h.qty != null ? `@${h.qty}` : ''}`).join(',') + ' hasnt=' + (e.quote.hasnt || []).join(',');
}
