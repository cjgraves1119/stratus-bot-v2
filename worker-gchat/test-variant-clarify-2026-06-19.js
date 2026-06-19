// ACCEPTANCE — Task 1: agent-explained differentiators on the spec-narrowed
// family picklist. When narrowVariantsBySpecs leaves 2–8 valid variants, the
// /api/quote handler must route to the agent-explained "variant-clarify" path
// (claudeResponse + the narrowed +button picklist), NOT the bare suggestions-only
// dump. A BARE ambiguous stem (no specs → no narrowing) must STILL be a plain
// suggestions-only picklist. Plus unit tests for the SKU differentiator decode.
//
// Run: node worker-gchat/test-variant-clarify-2026-06-19.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function loadGchatHandler() {
  const here = path.join(__dirname);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += `\nmodule.exports.decodeVariantSku = decodeVariantSku;`;
  src += `\nmodule.exports.explainVariantDifferentiators = explainVariantDifferentiators;`;
  src += `\nmodule.exports.narrowVariantsBySpecs = narrowVariantsBySpecs;`;
  const tmp = path.join(os.tmpdir(), `vclar-gchat-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const M = loadGchatHandler();
const worker = M.__worker;
const { decodeVariantSku, explainVariantDifferentiators, narrowVariantsBySpecs } = M;

const kv = { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }), getWithMetadata: async () => ({ value: null, metadata: null }) };
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
// No ANTHROPIC_API_KEY → askClaude returns a fixed "not configured" string (non-throw),
// so the variant-clarify branch still sets claudeResponse + suggestions deterministically.
const env = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: kv, PRICES_KV: kv, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: kv };
const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

async function callQuote(text) {
  const req = new Request('https://x.workers.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: 'vclar-corpus-' + Math.random().toString(36).slice(2) }),
  });
  const res = await worker.fetch(req, env, ctx);
  return await res.json();
}

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; } }

(async () => {
  console.log('── UNIT: decodeVariantSku ──');
  await t('decodes C9200L-48PXG-4X-M', () => {
    assert.deepStrictEqual(decodeVariantSku('C9200L-48PXG-4X-M'), { ports: '48', poe: 'PXG', uplink: '4X' });
  });
  await t('decodes C9200L-24T-4G-M (data-only, 1G)', () => {
    assert.deepStrictEqual(decodeVariantSku('C9200L-24T-4G-M'), { ports: '24', poe: 'T', uplink: '4G' });
  });
  await t('decodes C9200L-48PL-4X-M (PoE-lite)', () => {
    assert.deepStrictEqual(decodeVariantSku('C9200L-48PL-4X-M'), { ports: '48', poe: 'PL', uplink: '4X' });
  });
  await t('decodes 25G uplink C9200L-48PXG-2Y-M', () => {
    assert.deepStrictEqual(decodeVariantSku('C9200L-48PXG-2Y-M'), { ports: '48', poe: 'PXG', uplink: '2Y' });
  });

  console.log('── UNIT: explainVariantDifferentiators ──');
  await t('PoE-class differentiator (P vs PXG)', () => {
    const r = explainVariantDifferentiators('C9200L', ['C9200L-48P-4X-M', 'C9200L-48PXG-4X-M']);
    assert.ok(r, 'should not be null');
    assert.ok(/PoE class/i.test(r.contextBlock), 'context names PoE class');
    assert.ok(/PoE\+/.test(r.contextBlock) && /multigigabit UPOE/.test(r.contextBlock), 'decodes both classes');
    assert.ok(/PoE class/i.test(r.detSentence), 'det sentence names PoE class');
    assert.ok(!/uplink speed/i.test(r.detSentence), 'does NOT claim uplink differs (both 4X)');
  });
  await t('uplink differentiator (4X vs 2Y)', () => {
    const r = explainVariantDifferentiators('C9200L', ['C9200L-48PXG-4X-M', 'C9200L-48PXG-2Y-M']);
    assert.ok(/Uplink:/i.test(r.contextBlock), 'context names uplink');
    assert.ok(/10G/.test(r.contextBlock) && /25G/.test(r.contextBlock), 'decodes 10G + 25G');
  });
  await t('returns null for <2 variants', () => {
    assert.strictEqual(explainVariantDifferentiators('C9200L', ['C9200L-48P-4X-M']), null);
  });

  console.log('── HANDLER: spec-narrowed stem → variant-clarify ──');
  await t('"quote a C9200L switch with 48 ports 10G poe" → variant-clarify', async () => {
    const r = await callQuote('quote a C9200L switch with 48 ports 10G poe');
    assert.strictEqual(r.handlerType, 'variant-clarify', `got ${r.handlerType}`);
    assert.ok(Array.isArray(r.suggestions) && r.suggestions.length >= 1, 'has narrowed picklist');
    const sug = r.suggestions[0];
    assert.ok(sug.narrowedFamily === true, 'suggestion flagged narrowedFamily');
    assert.ok(sug.suggest.length >= 2 && sug.suggest.length <= 8, `narrowed to 2–8 (got ${sug.suggest.length})`);
    assert.ok(typeof r.claudeResponse === 'string' && r.claudeResponse.length > 0, 'has agent explanation');
    assert.ok(!Array.isArray(r.quoteUrls) || r.quoteUrls.length === 0, 'no premature quote URLs');
  });

  console.log('── HANDLER (negative): bare ambiguous stem → plain suggestions-only ──');
  await t('"quote a C9200L" (no specs) → suggestions-only, NOT variant-clarify', async () => {
    const r = await callQuote('quote a C9200L');
    assert.notStrictEqual(r.handlerType, 'variant-clarify', 'must NOT hijack the un-narrowed dump');
    assert.strictEqual(r.handlerType, 'suggestions-only', `got ${r.handlerType}`);
  });

  console.log('── HANDLER (negative): plain valid quote unaffected ──');
  await t('"5 MR44" → deterministic quote, no clarify', async () => {
    const r = await callQuote('5 MR44');
    assert.notStrictEqual(r.handlerType, 'variant-clarify', 'plain quote not diverted');
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0, 'produced quote URLs');
  });

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
