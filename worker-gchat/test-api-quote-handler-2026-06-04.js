// HANDLER-LEVEL test for the /api/quote endpoint (the path the Chrome extension
// actually uses) — NOT just parseMessage/buildQuoteResponse. This is the path that
// the SME/license-NLP parity matrices missed: the handler runs its OWN validateSku
// loop on parsed.items, which rejected the model-agnostic aliases (MR-AGN/…) and
// blocked the quote with a bogus "not a recognized SKU" while Webex worked.
//
// Invokes the worker's default fetch() with a mock Request + minimal env stubs.
// Run: node worker-gchat/test-api-quote-handler-2026-06-04.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function loadWorker() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import\s+(\w+)\s+from\s+'\.\/([^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${esc('src/' + rel)}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  const tmp = path.join(os.tmpdir(), `apiquote-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp).__worker;
}
const worker = loadWorker();

const kv = { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }), getWithMetadata: async () => ({ value: null, metadata: null }) };
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
const env = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: kv, PRICES_KV: kv, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: kv };
const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

async function callQuote(text, envOverrides = {}) {
  const req = new Request('https://x.workers.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: 'test-harness' }),
  });
  const res = await worker.fetch(req, { ...env, ...envOverrides }, ctx);
  return await res.json();
}

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; } }

(async () => {
  console.log('── /api/quote handler: model-agnostic aliases must NOT be rejected ──');
  await t('"6 mr and 1 mx84 enterprise license renewal" → quote, NOT suggestions-error', async () => {
    const r = await callQuote('6 mr and 1 mx84 enterprise license renewal');
    assert.ok(!r.suggestions || r.suggestions.length === 0, `blocked with suggestions: ${JSON.stringify(r.suggestions)}`);
    assert.notStrictEqual(r.handlerType, 'suggestions-only', 'returned suggestions-only (the bug)');
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0, `no quoteUrls: ${JSON.stringify(r).slice(0,200)}`);
    const urls = r.quoteUrls.map(u => u.url).join(' ');
    assert.ok(/LIC-ENT-/.test(urls), `MR license (LIC-ENT) missing: ${urls}`);
    assert.ok(/MX84|MX85/.test(urls), `MX84 EOL handling missing: ${urls}`);
    assert.ok(!/MR-AGN/.test(JSON.stringify(r)), `MR-AGN alias leaked to response: ${JSON.stringify(r).slice(0,200)}`);
  });
  await t('"4 mr44, 2 sme, 5 MS130-12X" → quote with hardware + LIC-SME, no error', async () => {
    const r = await callQuote('4 mr44, 2 sme, 5 MS130-12X');
    assert.notStrictEqual(r.handlerType, 'suggestions-only', `suggestions-only: ${JSON.stringify(r.suggestions)}`);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0, `no quoteUrls: ${JSON.stringify(r).slice(0,200)}`);
    const urls = r.quoteUrls.map(u => u.url).join(' ');
    assert.ok(/MR44-HW/.test(urls) && /MS130/.test(urls) && /LIC-SME-[13]YR/.test(urls), `mixed contents wrong: ${urls}`);
    assert.ok(!/LIC-SME-5YR/.test(urls), `5YR SME leaked: ${urls}`);
  });
  await t('"10 lic-sme-5yr" → 3YR (capped), deterministic, no alias leak', async () => {
    const r = await callQuote('10 lic-sme-5yr');
    const urls = (r.quoteUrls || []).map(u => u.url).join(' ');
    assert.ok(/LIC-SME-3YR/.test(urls) && !/LIC-SME-5YR/.test(urls), `cap failed: ${urls}`);
  });
  await t('typed direct license list → 1/3/5 URLs through real /api/quote handler', async () => {
    const r = await callQuote('LIC-ENT-3YR x1, LIC-MV-3YR x12, LIC-MX67W-SEC-3YR x2');
    assert.strictEqual(r.handlerType, 'deterministic', `wrong handler: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(Array.isArray(r.quoteUrls), `quoteUrls missing: ${JSON.stringify(r).slice(0, 300)}`);
    assert.strictEqual(r.quoteUrls.length, 3, `expected 3 quote URLs, got ${r.quoteUrls.length}: ${JSON.stringify(r.quoteUrls)}`);
    const urls = r.quoteUrls.map(u => u.url).join('\n');
    assert.ok(/LIC-ENT-1YR,LIC-MV-1YR,LIC-MX67W-SEC-1YR/.test(urls), `1YR URL missing: ${urls}`);
    assert.ok(/LIC-ENT-3YR,LIC-MV-3YR,LIC-MX67W-SEC-3YR/.test(urls), `3YR URL missing: ${urls}`);
    assert.ok(/LIC-ENT-5YR,LIC-MV-5YR,LIC-MX67W-SEC-5YR/.test(urls), `5YR URL missing: ${urls}`);
  });
  await t('mixed valid/invalid SKU list bypasses V3 clarification and returns partial quote', async () => {
    let aiCalls = 0;
    const r = await callQuote('5 MR44 and 2 MX999', {
      CF_QUOTE_V3_ENABLED: 'true',
      AI: {
        run: async () => {
          aiCalls++;
          return { response: JSON.stringify({
            intent: 'quote',
            confidence: 0.99,
            clarify: { needed: true, question: 'Which MX model did you mean?' },
            items: [],
            modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false },
            revision: {},
            reference: {},
            dashboard: { is_meraki_license_page: false },
          }) };
        },
      },
    });
    assert.strictEqual(aiCalls, 0, 'V3 classifier should be skipped for SKU-list syntax');
    assert.strictEqual(r.handlerType, 'deterministic', `wrong handler: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `expected 3 quote URLs, got ${JSON.stringify(r.quoteUrls)}`);
    const urls = r.quoteUrls.map(u => u.url).join('\n');
    assert.ok(/MR44-HW,LIC-ENT-1YR/.test(urls) && /qty=5,5/.test(urls), `MR44 1YR URL missing/wrong qty: ${urls}`);
    assert.ok(/MR44-HW,LIC-ENT-3YR/.test(urls), `MR44 3YR URL missing: ${urls}`);
    assert.ok(/MR44-HW,LIC-ENT-5YR/.test(urls), `MR44 5YR URL missing: ${urls}`);
    assert.ok(JSON.stringify(r.suggestions || []).includes('MX999'), `MX999 suggestion missing: ${JSON.stringify(r).slice(0, 500)}`);
  });
  await t('SKU-list syntax variants bypass V3 and return partial quote', async () => {
    const inputs = [
      '5x MR44 + 2x MX999',
      'MR44 qty 5, MX999 qty 2',
      'MR44 quantity 5; MX999 quantity 2',
      'MR44=5, MX999=2',
    ];
    for (const input of inputs) {
      let aiCalls = 0;
      const r = await callQuote(input, {
        CF_QUOTE_V3_ENABLED: 'true',
        AI: {
          run: async () => {
            aiCalls++;
            return { response: JSON.stringify({
              intent: 'quote',
              confidence: 0.99,
              clarify: { needed: true, question: 'Which MX model did you mean?' },
              items: [],
              modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false },
              revision: {},
              reference: {},
              dashboard: { is_meraki_license_page: false },
            }) };
          },
        },
      });
      assert.strictEqual(aiCalls, 0, `${input}: V3 classifier should be skipped for SKU-list syntax`);
      assert.strictEqual(r.handlerType, 'deterministic', `${input}: wrong handler: ${JSON.stringify(r).slice(0, 300)}`);
      assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `${input}: expected 3 quote URLs, got ${JSON.stringify(r.quoteUrls)}`);
      const urls = r.quoteUrls.map(u => u.url).join('\n');
      assert.ok(/MR44-HW,LIC-ENT-3YR/.test(urls) && /qty=5,5/.test(urls), `${input}: MR44 3YR URL missing/wrong qty: ${urls}`);
      assert.ok(JSON.stringify(r.suggestions || []).includes('MX999'), `${input}: MX999 suggestion missing: ${JSON.stringify(r).slice(0, 500)}`);
    }
  });
  await t('LIC-MX direct license bypass is not corrupted by x-normalization', async () => {
    let aiCalls = 0;
    const r = await callQuote('quote LIC-MX67-SEC-3YR', {
      CF_QUOTE_V3_ENABLED: 'true',
      AI: {
        run: async () => {
          aiCalls++;
          return { response: JSON.stringify({
            intent: 'quote',
            confidence: 0.99,
            clarify: { needed: false, question: '' },
            items: [{ sku: 'LIC-M-SEC-3YR', qty: 67 }],
            modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false },
            revision: {},
            reference: {},
            dashboard: { is_meraki_license_page: false },
          }) };
        },
      },
    });
    assert.strictEqual(aiCalls, 0, `V3 classifier should be skipped for direct LIC-MX quote`);
    assert.strictEqual(r.handlerType, 'deterministic', `wrong handler: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `expected 1/3/5 quote URLs: ${JSON.stringify(r.quoteUrls)}`);
    const urls = (r.quoteUrls || []).map(u => u.url).join('\n');
    assert.ok(/LIC-MX67-SEC-1YR/.test(urls), `1-year LIC-MX67 URL missing: ${urls}`);
    assert.ok(/LIC-MX67-SEC-3YR/.test(urls), `correct LIC-MX67 URL missing: ${urls}`);
    assert.ok(/LIC-MX67-SEC-5YR/.test(urls), `5-year LIC-MX67 URL missing: ${urls}`);
    assert.ok(!/LIC-M-SEC-3YR/.test(urls), `corrupted LIC-M token leaked: ${urls}`);
  });
  await t('LIC-MX direct license with explicit term-only wording still emits all terms', async () => {
    let aiCalls = 0;
    const r = await callQuote('quote LIC-MX67-SEC-3YR 3-year only', {
      CF_QUOTE_V3_ENABLED: 'true',
      AI: {
        run: async () => {
          aiCalls++;
          return { response: JSON.stringify({
            intent: 'quote',
            confidence: 0.99,
            clarify: { needed: false, question: '' },
            items: [{ sku: 'LIC-M-SEC-3YR', qty: 67 }],
            modifiers: { term_years: 3, tier: null, show_pricing: false, all_terms: false, separate_quotes: false },
            revision: {},
            reference: {},
            dashboard: { is_meraki_license_page: false },
          }) };
        },
      },
    });
    assert.strictEqual(aiCalls, 0, 'V3 classifier should be skipped for explicit direct LIC-MX term wording');
    assert.strictEqual(r.handlerType, 'deterministic', `wrong handler: ${JSON.stringify(r).slice(0, 300)}`);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `expected 1/3/5 quote URLs: ${JSON.stringify(r.quoteUrls)}`);
    const urls = (r.quoteUrls || []).map(u => u.url).join('\n');
    assert.ok(/LIC-MX67-SEC-1YR/.test(urls), `1-year LIC-MX67 URL missing: ${urls}`);
    assert.ok(/LIC-MX67-SEC-3YR/.test(urls), `3-year LIC-MX67 URL missing: ${urls}`);
    assert.ok(/LIC-MX67-SEC-5YR/.test(urls), `5-year LIC-MX67 URL missing: ${urls}`);
    assert.ok(!/MX67-HW/.test(urls), `hardware-paired quote leaked into direct license response: ${urls}`);
  });
  await t('"5 MV63 license renewal" (bare MV-AGN) → quote, not rejected', async () => {
    const r = await callQuote('5 MV63 license renewal');
    assert.notStrictEqual(r.handlerType, 'suggestions-only', `suggestions-only: ${JSON.stringify(r.suggestions)}`);
    assert.ok(!/MV-AGN/.test(JSON.stringify(r)), `MV-AGN leaked: ${JSON.stringify(r).slice(0,160)}`);
  });
  await t('"CW9172" (bare CW Wi-Fi 7 stem) → quote, NOT suggestions-error', async () => {
    const r = await callQuote('CW9172');
    assert.notStrictEqual(r.handlerType, 'suggestions-only', `blocked: ${JSON.stringify(r.suggestions)}`);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0, `no quoteUrls: ${JSON.stringify(r).slice(0,200)}`);
    assert.ok(/CW9172I/.test(r.quoteUrls.map(u => u.url).join(' ')), `CW9172 not promoted to I-variant: ${JSON.stringify(r.quoteUrls)}`);
  });
  await t('"CW9164" (bare CW Wi-Fi 6E stem) → quote', async () => {
    const r = await callQuote('CW9164');
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0 && r.handlerType !== 'suggestions-only', `blocked/no urls: ${JSON.stringify(r).slice(0,160)}`);
  });
  await t('non-quote "hello" → no exception, graceful', async () => {
    const r = await callQuote('hello');  // should not throw / 500
    assert.ok(r && typeof r === 'object', 'no response object');
  });
  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ ' + fail + ' FAILED'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
