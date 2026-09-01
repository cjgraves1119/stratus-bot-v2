// Stratus URL echoback + -HW recognition — guards the 2026-07-21 fixes:
//   1. validateSku accepts order-form -HW/-HW-NA tokens by validating the
//      stripped base model (MS130-24P-HW flagged its own ecomm SKU before).
//   2. A pasted /order/ URL re-renders EVERY item deterministically
//      (hardware + licenses, term expansion across 1/3/5) instead of being
//      hijacked by the explicit-license-list parser, which dropped hardware
//      and lost extra licenses (LIC-MS130-CMPT-3Y) in the reparse.
//   3. Legacy tokens in pasted URLs still get the EOL swaps + warnings.
//   4. Genuinely invalid hardware still falls through to "did you mean".
//
// Run: node worker-gchat/test-url-echoback-hw-2026-07-21.js

const fs = require('fs'), path = require('path'), os = require('os');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

function shim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  for (const [imp, file] of [['pricesData', 'src/data/prices.json'], ['catalogData', 'src/data/auto-catalog.json'], ['specsData', 'src/data/specs.json'], ['accessoriesData', 'src/data/accessories.json'], ['voiceSkillData', 'src/email-reply-voice-skill.json']]) {
    src = src.replace(new RegExp(`^import ${imp} from '[^']+';?$`, 'm'), `const ${imp} = require(${JSON.stringify(path.join(here, file))});`);
  }
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += '\nmodule.exports.validateSku = validateSku;';
  const tmp = path.join(os.tmpdir(), `echo-hw-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const M = shim();
const worker = M.__worker;

const store = new Map();
const skv = {
  get: async (k, t) => { const v = store.get(k); if (v == null) return null; return t === 'json' || t === undefined ? (typeof v === 'string' ? JSON.parse(v) : v) : v; },
  put: async (k, v) => { store.set(k, v); },
  list: async () => ({ keys: [] }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
};
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
const env = { GMAIL_ADDON_API_KEY: 'k', CONVERSATION_KV: skv, PRICES_KV: { get: async () => null, put: async () => {} }, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: skv };
const ctx = { waitUntil: p => { try { p && p.catch && p.catch(() => {}); } catch (_) {} } };
const call = async (text, pid) => {
  const req = new Request('https://x.workers.dev/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'k' }, body: JSON.stringify({ text, personId: pid }) });
  return await (await worker.fetch(req, env, ctx)).json();
};

(async () => {
  // ── 1. validateSku accepts -HW order forms ──
  console.log('validateSku: -HW order forms');
  ok(M.validateSku('MS130-24P-HW').valid === true, 'MS130-24P-HW valid (base MS130-24P in catalog)');
  ok(M.validateSku('MS130-8P-HW').valid === true, 'MS130-8P-HW valid');
  ok(M.validateSku('MX85-HW').valid === true, 'MX85-HW valid');
  ok(M.validateSku('MX84-HW').valid === true && M.validateSku('MX84-HW').eol === true, 'MX84-HW valid + EOL-flagged via base');
  ok(M.validateSku('MS130-99P-HW').valid === false, 'MS130-99P-HW still invalid (no such base model)');

  // ── 2. URL echoback preserves every item, expands terms ──
  console.log('/api/quote URL echoback (the 2026-07-21 report)');
  const j = await call('https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y,MS130-24P-HW,LIC-MS130-24-3Y,MS130-8P-HW,LIC-MS130-CMPT-3Y&qty=1,1,1,1,1,1', 'echo-t1');
  ok(j.handlerType === 'deterministic' && !(j.suggestions || []).length, `no bogus suggestions (got ${j.handlerType}, ${(j.suggestions || []).length} suggestions)`);
  ok((j.parsedItems || []).length === 6, `all 6 items parsed (got ${(j.parsedItems || []).length})`);
  ok((j.parsedItems || []).some(i => i.sku === 'MX85')
      && (j.parsedItems || []).some(i => i.sku === 'MS130-24P')
      && !(j.parsedItems || []).some(i => /^(?:MX|MS).*\-HW(?:-|$)/.test(i.sku)),
    'extension-facing parsed items also expose bare MX/MS SKUs');
  ok((j.quoteUrls || []).length === 3, `3 term buckets (got ${(j.quoteUrls || []).length})`);
  const u3 = (j.quoteUrls || []).find(u => u.label === '3-Year');
  ok(u3 && u3.url === 'https://stratusinfosystems.com/order/?item=MX85,LIC-MX85-SEC-3Y,MS130-24P,LIC-MS130-24-3Y,MS130-8P,LIC-MS130-CMPT-3Y&qty=1,1,1,1,1,1',
    '3-Year bucket normalizes inactive MX/MS -HW tokens to active non-HW order SKUs');
  const u1 = (j.quoteUrls || []).find(u => u.label === '1-Year');
  ok(u1 && /[?&,]item=MX85,|[?,]item=[^\n]*\bMX85,/.test(u1.url) && /MS130-8P/.test(u1.url) && !/-HW/.test(u1.url) && /LIC-MS130-CMPT-1Y/.test(u1.url),
    '1-Year bucket carries non-HW order SKUs AND the CMPT license (rewritten)');

  // ── 3. Legacy tokens in a pasted URL: swaps + warnings ──
  console.log('URL echoback + EOL swaps');
  const j2 = await call('https://stratusinfosystems.com/order/?item=LIC-VMX-S-3YR,LIC-SME-3YR,LIC-MX84-SEC-3YR&qty=1,8,2', 'echo-t2');
  const s2 = JSON.stringify(j2.quoteUrls);
  ok(/LIC-VMX-S-SEC-3Y/.test(s2) && /LIC-MI-EMSC-D-1YMC-A-3YR/.test(s2) && !/LIC-SME/.test(s2),
    'legacy vMX/SME tokens swapped in the echoed URLs');
  ok(/qty=1,50,2/.test(s2), 'Ivanti 50-floor applied in echoed URLs');
  ok((j2.eolWarnings || []).some(w => /licenses are discontinued/.test(w)), 'SME retirement flag in eolWarnings');

  // ── 4. Genuinely invalid hardware still gets suggestions ──
  console.log('fall-through for real typos');
  const j3 = await call('https://stratusinfosystems.com/order/?item=MS130-99P-HW,LIC-MS130-24-3Y&qty=1,1', 'echo-t3');
  ok((j3.suggestions || []).length > 0, 'invalid model in URL → did-you-mean suggestions');

  // ── 5. Codex HOLD findings: echoback must fail closed, never silently drop ──
  console.log('codex findings: echoback containment');
  const j4 = await call('https://stratusinfosystems.com/order/?item=LIC-NOTREAL-3Y,LIC-MS130-24-3Y&qty=1,1', 'echo-t4');
  const j4urls = JSON.stringify(j4.quoteUrls || []);
  ok(!/LIC-NOTREAL/.test(j4urls), 'F1b: unknown LIC token never echoed into an order URL');
  const j5 = await call('https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y,LIC-VMX100&qty=1,1,1', 'echo-t5');
  const j5all = JSON.stringify(j5);
  ok(!(j5.handlerType === 'deterministic' && (j5.parsedItems || []).length === 2 && !/VMX100/.test(j5all)),
    'F1a: valid hardware + LIC-VMX100 does NOT silently quote only the hardware');
  const j6 = await call('https://stratusinfosystems.com/order/?item=MR44-HW&qty=1 and https://stratusinfosystems.com/order/?item=MX85-HW&qty=1', 'echo-t6');
  ok(!(j6.handlerType === 'deterministic' && (j6.quoteUrls || []).length > 0 && !/MX85/.test(JSON.stringify(j6.quoteUrls))),
    'F1c: two pasted URLs are never half-rendered (first-only)');

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
