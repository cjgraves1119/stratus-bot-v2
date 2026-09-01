// Seam failures 2026-06-10 — F1-F4 regression guard (offline, REAL handlers).
//
// Live failures killed (all D1-verified on simple rep requests, 2026-06-10):
//   A. "200 dns advantage" (no "umbrella" token) → parseMessage was blind → webex
//      cf-deterministic emitted ONE bare unlabeled 3-Year URL (D1 row 5240, term never
//      requested); gchat fell to a Claude apology (row 5251).
//   B. "what are the costs for essentials" after an Advantage quote → cf-v2-revise applied
//      the PRICING but ignored the TIER change → Advantage prices rendered as the answer
//      to an Essentials question.
//   C. "provide 1-5 year options" after a single-term render → no deterministic all-terms
//      branch → fell to Sonnet.
//
// Fixes under test:
//   F1 parseMessage (BOTH workers): dns/sig vocabulary without the "umbrella" token —
//      tier-adjacency or qty-adjacency REQUIRED; benign "dns servers" phrasings excluded;
//      bare "N dns"/"N sig" → existing Umbrella tier clarify (type carried in the header
//      so buildTierClarifyContinuation can resolve a bare tier reply).
//   F2 handleFollowUpModifier (BOTH workers, byte-identical): compound pricing+mutation
//      pass — pricing word + at most ONE unambiguous mutation (tier/type/term); pricing
//      alone re-renders the prior quote with buildPricingBlock; everything else fails
//      closed to the existing fallbacks.
//   F3 buildQuoteFromV2 (webex only — gchat has no V2 adapter): a single term-bearing
//      license SKU whose term the USER never stated expands to labeled 1/3/5 URLs instead
//      of one bare unlabeled URL.
//   F4 handleFollowUpModifier (BOTH workers): all-terms re-render across [1,3,5] via
//      rewriteSkuTerm; retired SME is replaced by active Ivanti 1/3/5 lines.
//
// Run: node worker-gchat/test-seam-fixes-2026-06-10.js

const fs = require('fs'), path = require('path'), os = require('os');

// loadEngine CJS shim — same pattern as test-gchat-followup-parity-2026-06-09.js
function loadEngine(workerDir, tag) {
  const here = path.isAbsolute(workerDir) ? workerDir : path.join(__dirname, '..', workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import legacyProductIdAliasesData from '\.\/data\/legacy-product-id-aliases\.json';?$/m, `const legacyProductIdAliasesData = require('${esc('src/data/legacy-product-id-aliases.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${esc('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  // buildQuoteFromV2 exists only in webex — export null where absent (typeof on an
  // undeclared identifier is safe in CJS module scope).
  src += `\nmodule.exports = { handleFollowUpModifier, parseMessage, buildQuoteResponse, buildTierClarifyContinuation, buildQuoteFromV2: (typeof buildQuoteFromV2 === 'function' ? buildQuoteFromV2 : null) };`;
  const tmp = path.join(os.tmpdir(), `seamfix-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const G = loadEngine(path.join(__dirname), 'gc');
const W = loadEngine(path.join(__dirname, '..', 'worker'), 'wbx');
const ENGINES = [[W, 'webex'], [G, 'gchat']];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

// ── KV/history fixtures ──
const kvWith = (assistantMsg) => ({
  get: async () => ({ messages: [
    { role: 'user', content: 'quote request' },
    { role: 'assistant', content: assistantMsg },
  ] }),
  put: async () => {},
});
const kvEmpty = { get: async () => null, put: async () => {} };

const UMB_ADV_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ADV-K9-1YR&qty=200',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ADV-K9-3YR&qty=200',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ADV-K9-5YR&qty=200',
].join('\n');
const DUO_ADV_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-1YR&qty=200',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=200',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=200',
].join('\n');
const DNS_ESS_SINGLE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-3YR&qty=200';
const MR44_QUOTE = [
  '**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=5,5',
  '',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5',
  '',
  '**5-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=5,5',
].join('\n');
const SME_SINGLE = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-SME-3YR&qty=100';
const ACCESSORY_QUOTE = 'https://stratusinfosystems.com/order/?item=MA-SFP-10GB-SR&qty=4';

const has135Labels = (m) => /\*\*1-Year Co-Term:\*\*/.test(m) && /\*\*3-Year Co-Term:\*\*/.test(m) && /\*\*5-Year Co-Term:\*\*/.test(m);

(async () => {
  // ════ F1 — vocabulary: Umbrella without the "umbrella" token (parseMessage) ════
  console.log('F1: dns/sig vocabulary (parseMessage, both engines)');
  for (const [E, name] of ENGINES) {
    // Chris's exact live phrase (D1 rows 5240/5251)
    let r = E.buildQuoteResponse(E.parseMessage('200 dns advantage'));
    ok(r && r.message && has135Labels(r.message)
      && /item=LIC-UMB-DNS-ADV-K9-1YR&qty=200/.test(r.message)
      && /item=LIC-UMB-DNS-ADV-K9-3YR&qty=200/.test(r.message)
      && /item=LIC-UMB-DNS-ADV-K9-5YR&qty=200/.test(r.message),
      `${name}: "200 dns advantage" → labeled 1/3/5 LIC-UMB-DNS-ADV-K9 × 200 (deterministic)`);

    // Live row 5256 variant
    r = E.buildQuoteResponse(E.parseMessage('200 dns advantage licenses'));
    ok(r && r.message && has135Labels(r.message) && /LIC-UMB-DNS-ADV-K9-3YR&qty=200/.test(r.message),
      `${name}: "200 dns advantage licenses" → labeled 1/3/5`);

    // Generalization: sig advantage / dns essentials / spelled-out SIG
    r = E.buildQuoteResponse(E.parseMessage('200 sig advantage'));
    ok(r && r.message && has135Labels(r.message) && /LIC-UMB-SIG-ADV-K9-3YR&qty=200/.test(r.message),
      `${name}: "200 sig advantage" → labeled 1/3/5 SIG-ADV`);
    r = E.buildQuoteResponse(E.parseMessage('200 dns essentials'));
    ok(r && r.message && has135Labels(r.message) && /LIC-UMB-DNS-ESS-K9-3YR&qty=200/.test(r.message),
      `${name}: "200 dns essentials" → labeled 1/3/5 DNS-ESS`);
    r = E.buildQuoteResponse(E.parseMessage('200 secure internet gateway advantage'));
    ok(r && r.message && has135Labels(r.message) && /LIC-UMB-SIG-ADV-K9-3YR&qty=200/.test(r.message),
      `${name}: "200 secure internet gateway advantage" → SIG-ADV (spelled-out type)`);

    // F1(b): qty + type, no tier → the EXISTING Umbrella tier clarify, type carried in header
    let p = E.parseMessage('200 dns');
    ok(p && p.isClarification && /Which Umbrella package do you need\? \(qty: 200, type: DNS\)/.test(p.clarificationMessage)
      && /\*\*Tier:\*\*/.test(p.clarificationMessage) && !/\*\*Type:\*\*/.test(p.clarificationMessage),
      `${name}: "200 dns" → tier clarify (type DNS locked, only Tier asked)`);
    // …and a bare tier reply resolves WITHOUT re-asking (continuation reads the header type)
    const cont = E.buildTierClarifyContinuation('Essentials', p.clarificationMessage);
    ok(cont === '200 umbrella dns essentials licenses',
      `${name}: clarify("200 dns") + reply "Essentials" → "200 umbrella dns essentials licenses"`);
    p = E.parseMessage('50 sig');
    ok(p && p.isClarification && /\(qty: 50, type: SIG\)/.test(p.clarificationMessage),
      `${name}: "50 sig" → tier clarify (type SIG locked)`);

    // Negative guards — benign dns/sig phrasings must NOT become quotes or clarifies
    const benign = [
      'what dns servers does meraki use',
      'can the dashboard use custom dns settings',
      'we have 3 dns servers',
      'how do I change dns records for the guest network',
    ];
    for (const b of benign) {
      const bp = E.parseMessage(b);
      ok(bp === null || (!bp.isClarification && (!bp.items || bp.items.length === 0) && !bp.directLicense && !bp.directLicenseList),
        `${name}: benign "${b}" → NOT a quote/clarify`);
    }
    // "essentials" bare (tier word, no family, no qty-dns adjacency) — unchanged
    const bareEss = E.parseMessage('essentials');
    ok(bareEss === null || (!bareEss.isClarification && (!bareEss.items || bareEss.items.length === 0)),
      `${name}: bare "essentials" → unchanged (no quote, no clarify)`);
  }

  // ════ F2 — compound follow-ups (handleFollowUpModifier, both engines) ════
  console.log('F2: compound pricing + single-mutation follow-ups');
  for (const [E, name] of ENGINES) {
    // Failure B (exact live phrase): tier change MUST apply before pricing renders
    let r = await E.handleFollowUpModifier('what are the costs for essentials', 'p1', kvWith(UMB_ADV_QUOTE));
    ok(r && /LIC-UMB-DNS-ESS-K9-1YR&qty=200/.test(r) && /LIC-UMB-DNS-ESS-K9-3YR&qty=200/.test(r)
      && !/-ADV-/.test(r) && /\$/.test(r) && /Cart Total/.test(r),
      `${name}: "what are the costs for essentials" after ADV → ESSENTIALS pricing ($ figures, no ADV)`);

    // Same phrase against a Duo prior — tier swap machinery shared
    r = await E.handleFollowUpModifier('what are the costs for essentials', 'p1', kvWith(DUO_ADV_QUOTE));
    ok(r && /LIC-DUO-ESSENTIALS-3YR&qty=200/.test(r) && !/ADVANTAGE/.test(r) && /Cart Total/.test(r),
      `${name}: same phrase after Duo Advantage → Duo ESSENTIALS pricing`);

    // Pricing alone → prior quote re-rendered with pricing, SKUs unchanged
    r = await E.handleFollowUpModifier('what are the costs', 'p1', kvWith(UMB_ADV_QUOTE));
    ok(r && /LIC-UMB-DNS-ADV-K9-3YR&qty=200/.test(r) && /\$/.test(r) && /Cart Total/.test(r),
      `${name}: "what are the costs" alone → prior quote WITH pricing`);
    r = await E.handleFollowUpModifier("what's the total", 'p1', kvWith(MR44_QUOTE));
    ok(r && /MR44-HW/.test(r) && /Cart Total/.test(r), `${name}: "what's the total" → prior quote WITH pricing`);
    r = await E.handleFollowUpModifier('total cost?', 'p1', kvWith(MR44_QUOTE));
    ok(r && /MR44-HW/.test(r) && /Cart Total/.test(r), `${name}: "total cost?" → prior quote WITH pricing`);

    // Pricing + term → term filter applies first, pricing renders
    r = await E.handleFollowUpModifier('price for the 3 year', 'p1', kvWith(MR44_QUOTE));
    ok(r && /LIC-ENT-3YR/.test(r) && !/LIC-ENT-1YR/.test(r) && !/LIC-ENT-5YR/.test(r) && /Cart Total/.test(r),
      `${name}: "price for the 3 year" → ONLY the 3-Year bucket, with pricing`);

    // Pricing + umbrella type → type swap applies first (tier preserved), pricing renders
    r = await E.handleFollowUpModifier('how much for sig', 'p1', kvWith(DNS_ESS_SINGLE));
    ok(r && /LIC-UMB-SIG-ESS-K9-3YR&qty=200/.test(r) && /Cart Total/.test(r),
      `${name}: "how much for sig" after DNS-ESS → SIG-ESS with pricing (tier preserved)`);

    // FAIL-CLOSED guards
    r = await E.handleFollowUpModifier('costs for essentials and advantage', 'p1', kvWith(UMB_ADV_QUOTE));
    ok(r === null, `${name}: two mutation components → null (fail closed)`);
    r = await E.handleFollowUpModifier('what are the costs for 300 users', 'p1', kvWith(UMB_ADV_QUOTE));
    ok(r === null, `${name}: pricing + free number (qty?) → null (fail closed)`);
    r = await E.handleFollowUpModifier('how much for the mr44', 'p1', kvWith(MR44_QUOTE));
    ok(r === null, `${name}: pricing + SKU token → null (fresh-quote machinery owns it)`);
    r = await E.handleFollowUpModifier('what are the shipping costs', 'p1', kvWith(MR44_QUOTE));
    ok(r === null, `${name}: unrecognized word survives filler → null (fail closed)`);
    r = await E.handleFollowUpModifier('what are the costs for essentials', 'p1', kvEmpty);
    ok(r === null, `${name}: compound with NO history → null (unchanged entry gating)`);
    // tier not valid for the prior quote's families → fail closed (MR has no Essentials)
    r = await E.handleFollowUpModifier('what are the costs for essentials', 'p1', kvWith(MR44_QUOTE));
    ok(r === null, `${name}: "costs for essentials" after an MR quote → null (no swappable family)`);
    // pending tier-clarify question still owns bare-tier replies (guard unchanged)
    r = await E.handleFollowUpModifier('what are the costs for essentials', 'p1',
      kvWith('Which Umbrella package do you need? (qty: 200, type: DNS)\n\n**Tier:**\n…'));
    ok(r === null, `${name}: pending tier-clarify question → null (continuation owns the turn)`);

    // Existing single-intent behavior UNCHANGED (spot checks; full coverage in older suites)
    r = await E.handleFollowUpModifier('change to essentials', 'p1', kvWith(DUO_ADV_QUOTE));
    ok(r && /LIC-DUO-ESSENTIALS-3YR&qty=200/.test(r) && !/\$/.test(r),
      `${name}: "change to essentials" still swaps WITHOUT pricing (single-intent untouched)`);
    r = await E.handleFollowUpModifier('remove 2 MR44', 'p1', kvWith(MR44_QUOTE));
    ok(r === null, `${name}: "remove 2 MR44" (partial removal) still null (fail closed)`);
  }

  // ════ F4 — all-terms re-render (handleFollowUpModifier, both engines) ════
  console.log('F4: all-terms re-render');
  const allTermsPhrases = [
    'provide 1-5 year options',           // Chris's exact live phrase (failure C)
    'show all terms',
    '1, 3 and 5 year options',
    'show me the other terms',
    'all term options',
  ];
  for (const [E, name] of ENGINES) {
    for (const phrase of allTermsPhrases) {
      const r = await E.handleFollowUpModifier(phrase, 'p1', kvWith(DNS_ESS_SINGLE));
      ok(r && has135Labels(r)
        && /LIC-UMB-DNS-ESS-K9-1YR&qty=200/.test(r)
        && /LIC-UMB-DNS-ESS-K9-3YR&qty=200/.test(r)
        && /LIC-UMB-DNS-ESS-K9-5YR&qty=200/.test(r),
        `${name}: "${phrase}" after single-term render → 3 labeled buckets`);
    }
    // Hardware+license prior: licenses rewritten per bucket, hardware unchanged in each
    let r = await E.handleFollowUpModifier('show all terms', 'p1',
      kvWith('**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5'));
    ok(r && has135Labels(r) && /MR44-HW,LIC-ENT-1YR&qty=5,5/.test(r) && /MR44-HW,LIC-ENT-5YR&qty=5,5/.test(r),
      `${name}: all-terms on hw+lic prior → license rewritten per bucket, hardware carried`);
    // SME is retired — replace it with active Ivanti 1/3/5 options and never
    // let a legacy LIC-SME token survive into an order URL.
    r = await E.handleFollowUpModifier('provide 1-5 year options', 'p1', kvWith(SME_SINGLE));
    ok(r && /LIC-MI-EMSC-D-1YMC-A-1YR&qty=100/.test(r)
      && /LIC-MI-EMSC-D-1YMC-A-3YR&qty=100/.test(r)
      && /LIC-MI-EMSC-D-1YMC-A-5YR&qty=100/.test(r)
      && !/item=LIC-SME/.test(r) && /Systems Manager.*discontinued/i.test(r),
      `${name}: all-terms on SME → Ivanti 1\/3\/5 replacement, no LIC-SME (got ${String(r).slice(0, 500)})`);
    // Fail closed: no prior quote / nothing term-bearing
    r = await E.handleFollowUpModifier('provide 1-5 year options', 'p1', kvEmpty);
    ok(r === null, `${name}: all-terms with no prior quote → null (fail closed)`);
    r = await E.handleFollowUpModifier('show all terms', 'p1', kvWith(ACCESSORY_QUOTE));
    ok(r === null, `${name}: all-terms on accessory-only prior (no term-bearing SKU) → null`);
    // Negative: a single-term ask is NOT all-terms ("3 year only" path untouched)
    r = await E.handleFollowUpModifier('3 year only', 'p1', kvWith(MR44_QUOTE));
    ok(r && /LIC-ENT-3YR/.test(r) && !/LIC-ENT-1YR/.test(r),
      `${name}: "3 year only" still filters to the single bucket (untouched)`);
  }

  // ════ Cross-engine parity on every new behavior ════
  console.log('Parity: identical outputs across engines for the new paths');
  const parityCases = [
    ['what are the costs for essentials', UMB_ADV_QUOTE],
    ['what are the costs', UMB_ADV_QUOTE],
    ['price for the 3 year', MR44_QUOTE],
    ['how much for sig', DNS_ESS_SINGLE],
    ['provide 1-5 year options', DNS_ESS_SINGLE],
    ['show all terms', SME_SINGLE],
  ];
  for (const [msg, prior] of parityCases) {
    const w = await W.handleFollowUpModifier(msg, 'p1', kvWith(prior));
    const g = await G.handleFollowUpModifier(msg, 'p1', kvWith(prior));
    ok(w !== null && w === g, `"${msg}" → identical non-null output on webex + gchat`);
  }
  for (const msg of ['200 dns advantage', '200 sig advantage', '200 dns']) {
    const w = JSON.stringify(W.parseMessage(msg));
    const g = JSON.stringify(G.parseMessage(msg));
    ok(w === g, `parseMessage("${msg}") parity across engines`);
  }

  // ════ F3 — buildQuoteFromV2 1/3/5 invariant (webex only; the live failure layer) ════
  console.log('F3: V2-adapter single-license term invariant (webex)');
  {
    // The EXACT live shape (D1 row 5240): V2 emitted LIC-UMB-DNS-ADV-K9-3YR for a message
    // that never stated a term → must now render labeled 1/3/5, never one bare URL.
    const v2 = { intent: 'quote', items: [{ sku: 'LIC-UMB-DNS-ADV-K9-3YR', qty: 200, sku_type: 'license' }], modifiers: {} };
    const p = W.buildQuoteFromV2(v2, '200 dns advantage');
    const r = p ? W.buildQuoteResponse(p) : null;
    ok(r && r.message && has135Labels(r.message)
      && /LIC-UMB-DNS-ADV-K9-1YR&qty=200/.test(r.message) && /LIC-UMB-DNS-ADV-K9-5YR&qty=200/.test(r.message),
      'webex: V2 hallucinated-term single license + no user term → labeled 1/3/5 (was: one bare URL)');
    ok(r && !/^https:\/\//.test(String(r.message).trim()), 'webex: response does not START with a bare unlabeled URL');

    // Initial typed-license quotes deliberately render every available term;
    // narrowing to one term belongs to a revision/selection turn.
    const p2 = W.buildQuoteFromV2(
      { intent: 'quote', items: [{ sku: 'LIC-UMB-DNS-ADV-K9-3YR', qty: 200, sku_type: 'license' }], modifiers: { term_years: 3 } },
      '200 dns advantage 3 year');
    const p2r = p2 ? W.buildQuoteResponse(p2) : null;
    ok(p2 && p2.isTermOptionQuote && p2r?.message && has135Labels(p2r.message),
      'webex: initial stated-term license still renders the available 1\/3\/5 set');

    // A literal term-bearing SKU follows the same initial-choice policy.
    const p3 = W.buildQuoteFromV2(
      { intent: 'quote', items: [{ sku: 'LIC-UMB-DNS-ADV-K9-3YR', qty: 200, sku_type: 'license' }], modifiers: {} },
      'quote 200 LIC-UMB-DNS-ADV-K9-3YR');
    const p3r = p3 ? W.buildQuoteResponse(p3) : null;
    ok(p3 && p3.isTermOptionQuote && p3r?.message && has135Labels(p3r.message),
      'webex: literal term-bearing SKU renders the available 1\/3\/5 set');

    // gchat has no V2 adapter — guard the assumption so a future port re-evaluates F3
    ok(G.buildQuoteFromV2 === null, 'gchat: no buildQuoteFromV2 (F3 fix is webex-layer only)');
  }

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} assertions passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
