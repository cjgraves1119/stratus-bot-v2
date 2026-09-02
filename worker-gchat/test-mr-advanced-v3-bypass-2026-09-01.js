// HANDLER-LEVEL regression for the exact MR Advanced mixed-cart path with the
// V3 classifier ENABLED and deliberately hostile.
//
// The quote editor serializes a tier change as "4 MR36-HW advanced". Before
// 2026-09-01 the word "advanced" was not in parseExplicitSkuRequestBeforeClassifier's
// residue allowlist, so an explicit SKU list carrying it fell through to the
// probabilistic V3 classifier. A classifier that answers Enterprise then quoted
// LIC-ENT instead of LIC-MR-ADV. This test proves, through the real /api/quote
// fetch handler:
//   * env.AI.run is never invoked for editor text (ADVANCED / ADV / ADVANTAGE);
//   * 4x MR36-HW + 1x CW9162I produce exactly LIC-MR-ADV-1Y / -3Y / -5Y x5;
//   * no LIC-ENT line appears on any option;
//   * unrelated switch rows (C9300-24P-M, MS130-24P) and the MX67 survive with
//     their own licences at the same term;
//   * the hostile mock is reachable for prose (control), so "zero AI calls" is a
//     property of the bypass and not of a disconnected stub.
// Run: node worker-gchat/test-mr-advanced-v3-bypass-2026-09-01.js

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
  const tmp = path.join(os.tmpdir(), `mr-adv-v3-bypass-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  try {
    return require(tmp).__worker;
  } finally {
    fs.unlinkSync(tmp);
  }
}
const worker = loadWorker();

const kv = { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }), getWithMetadata: async () => ({ value: null, metadata: null }) };
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
const baseEnv = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: kv, PRICES_KV: kv, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: kv };
const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

// A classifier that always answers Enterprise for every access point and
// re-labels the switches as licence-only. If the handler ever consults it for
// editor text, the MR Advanced tier is lost and the switch hardware disappears.
function hostileEnterpriseClassifier() {
  const state = { calls: 0, prompts: [] };
  const env = {
    ...baseEnv,
    CF_QUOTE_V3_ENABLED: 'true',
    AI: {
      run: async (_model, input) => {
        state.calls += 1;
        state.prompts.push(String(input?.messages?.at(-1)?.content || ''));
        return { response: JSON.stringify({
          intent: 'quote',
          confidence: 0.99,
          clarify: { needed: false, question: '' },
          items: [
            { product: 'MX67', qty: 1, intent: 'normal' },
            { product: 'MR36', qty: 4, intent: 'normal' },
            { product: 'CW9162I', qty: 1, intent: 'normal' },
            { product: 'C9300-24P-M', qty: 2, intent: 'license' },
            { product: 'MS130-24P', qty: 2, intent: 'license' },
          ],
          modifiers: { term_years: null, tier: 'ENT', show_pricing: false, all_terms: true, separate_quotes: false },
          revision: {}, reference: {}, dashboard: { is_meraki_license_page: false },
        }) };
      },
    },
  };
  return { env, state };
}

async function callQuote(text, env) {
  const req = new Request('https://x.workers.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: 'mr-adv-v3-harness' }),
  });
  const res = await worker.fetch(req, env, ctx);
  assert.strictEqual(res.status, 200);
  return await res.json();
}

function cartOf(url) {
  const parsed = new URL(url);
  const items = (parsed.searchParams.get('item') || '').split(',').filter(Boolean);
  const qtys = (parsed.searchParams.get('qty') || '').split(',').map((q) => parseInt(q, 10));
  return new Map(items.map((sku, index) => [sku.toUpperCase(), Number.isFinite(qtys[index]) && qtys[index] > 0 ? qtys[index] : 1]));
}

function termOf(url) {
  const terms = [...new Set([...cartOf(url).keys()]
    .map((sku) => (sku.match(/-([135])YR?$/) || [])[1])
    .filter(Boolean))];
  assert.strictEqual(terms.length, 1, `mixed terms on one option: ${url}`);
  return Number(terms[0]);
}

// Exactly what quoteTextFromEditorRows() emits for the committed hardware rows
// after MR36-HW is moved to Advanced (the CW row follows the AP family).
const EDITOR_TEXT = [
  '1 MX67',
  '4 MR36-HW advanced',
  '1 CW9162I advanced',
  '2 C9300-24P-M',
  '2 MS130-24P',
].join('\n');

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.stack || e.message}`); fail++; } }

function assertAdvancedMixedCart(r, label) {
  assert.strictEqual(r.handlerType, 'deterministic', `${label}: ${JSON.stringify(r).slice(0, 600)}`);
  assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `${label}: expected 1/3/5 options, got ${JSON.stringify(r.quoteUrls)}`);
  const byTerm = new Map(r.quoteUrls.map((option) => [termOf(option.url), cartOf(option.url)]));
  assert.deepStrictEqual([...byTerm.keys()].sort(), [1, 3, 5], label);
  for (const [term, cart] of byTerm) {
    const suffixY = `${term}Y`;
    const suffixYR = `${term}YR`;
    // Both access points aggregate into ONE Advanced licence line at the shown term.
    assert.strictEqual(cart.get(`LIC-MR-ADV-${suffixY}`), 5, `${label}: LIC-MR-ADV-${suffixY} x5 (4 MR36 + 1 CW9162I) in ${[...cart]}`);
    assert.strictEqual(cart.get('MR36-HW'), 4, `${label}: MR36-HW x4`);
    assert.strictEqual(cart.get('CW9162I-MR'), 1, `${label}: CW9162I-MR x1`);
    assert.ok(![...cart.keys()].some((sku) => /^LIC-ENT-/.test(sku)), `${label}: LIC-ENT must not appear at ${term}Y: ${[...cart.keys()]}`);
    assert.ok(![...cart.keys()].some((sku) => /^LIC-MR-ADV-/.test(sku) && sku !== `LIC-MR-ADV-${suffixY}`), `${label}: only one ADV term per option`);
    // Unrelated rows survive untouched with their own licences at the same term.
    assert.strictEqual(cart.get('MX67'), 1, `${label}: MX67 x1`);
    assert.strictEqual(cart.get(`LIC-MX67-SEC-${suffixYR}`), 1, `${label}: LIC-MX67-SEC-${suffixYR} x1`);
    assert.strictEqual(cart.get('C9300-24P-M'), 2, `${label}: C9300-24P-M x2`);
    assert.strictEqual(cart.get(`LIC-C9300-24E-${suffixY}`), 2, `${label}: LIC-C9300-24E-${suffixY} x2 (switch tier is not Advanced)`);
    assert.strictEqual(cart.get('MS130-24P'), 2, `${label}: MS130-24P x2`);
    assert.strictEqual(cart.get(`LIC-MS130-24-${suffixY}`), 2, `${label}: LIC-MS130-24-${suffixY} x2 (switch tier is not Advanced)`);
    assert.strictEqual(cart.size, 9, `${label}: exactly 9 cart lines at ${term}Y: ${[...cart.keys()]}`);
  }
  assert.ok(!r.suggestions || r.suggestions.length === 0, `${label}: unexpected suggestions ${JSON.stringify(r.suggestions)}`);
  // The typed "MR36-HW" is the same item as the parsed "MR36". Before the
  // canonical dropped-token comparison it came back as an extra tier-less
  // { sku: 'MR36-HW', qty: 1 } row, which is what made the composition guard
  // demand LIC-ENT and block the Advanced quote.
  const parsedSkus = (r.parsedItems || []).map((item) => String(item.sku || '').toUpperCase());
  assert.ok(!parsedSkus.includes('MR36-HW'), `${label}: phantom MR36-HW row in parsedItems ${JSON.stringify(r.parsedItems)}`);
  assert.strictEqual(parsedSkus.filter((sku) => sku === 'MR36').length, 1, `${label}: ${JSON.stringify(r.parsedItems)}`);
  const mr = (r.parsedItems || []).find((item) => String(item.sku || '').toUpperCase() === 'MR36');
  assert.strictEqual(mr.qty, 4, `${label}: ${JSON.stringify(mr)}`);
  assert.strictEqual(mr.requestedTier, 'A', `${label}: ${JSON.stringify(mr)}`);
}

(async () => {
  console.log('── /api/quote: MR Advanced mixed cart bypasses a hostile V3 classifier ──');

  await t('editor text "4 MR36-HW advanced" never reaches env.AI and yields LIC-MR-ADV 1/3/5 x5 with switches intact', async () => {
    const { env, state } = hostileEnterpriseClassifier();
    for (let attempt = 0; attempt < 2; attempt++) {
      const r = await callQuote(EDITOR_TEXT, env);
      assertAdvancedMixedCart(r, `attempt ${attempt + 1}`);
    }
    assert.strictEqual(state.calls, 0, `V3 classifier must not be consulted for editor text; prompts=${JSON.stringify(state.prompts)}`);
  });

  await t('the ADV shorthand and the single-line editor row take the same deterministic path', async () => {
    const { env, state } = hostileEnterpriseClassifier();
    const short = await callQuote(EDITOR_TEXT.replace(/advanced/g, 'adv'), env);
    assertAdvancedMixedCart(short, 'adv');
    const single = await callQuote('4 MR36-HW advanced', env);
    assert.strictEqual(single.handlerType, 'deterministic', JSON.stringify(single).slice(0, 400));
    assert.strictEqual(single.quoteUrls.length, 3);
    for (const option of single.quoteUrls) {
      const cart = cartOf(option.url);
      assert.strictEqual(cart.get('MR36-HW'), 4);
      assert.strictEqual(cart.get(`LIC-MR-ADV-${termOf(option.url)}Y`), 4, option.url);
      assert.strictEqual(cart.size, 2, option.url);
    }
    assert.strictEqual(state.calls, 0, 'V3 classifier must not be consulted');
  });

  await t('"advantage" is the MR/CW Advanced UI spelling without bleeding to unrelated switches', async () => {
    const { env, state } = hostileEnterpriseClassifier();
    const r = await callQuote(EDITOR_TEXT.replace(/advanced/g, 'advantage'), env);
    assertAdvancedMixedCart(r, 'advantage');
    assert.strictEqual(state.calls, 0, 'V3 classifier must not be consulted');
    for (const option of r.quoteUrls) {
      const cart = cartOf(option.url);
      const term = termOf(option.url);
      assert.strictEqual(cart.get(`LIC-MS130-24-${term}Y`), 2, option.url);
      assert.ok(!cart.has(`LIC-MS130-24A-${term}Y`), `switch tier bled to Advanced: ${option.url}`);
    }
  });

  await t('control: a genuinely unresolved token is still reported, the canonical comparison only forgives spelling', async () => {
    const { env, state } = hostileEnterpriseClassifier();
    const r = await callQuote('4 MR36-HW advanced\n2 MS130', env);
    assert.strictEqual(state.calls, 0, 'V3 classifier must not be consulted');
    assert.ok(Array.isArray(r.suggestions) && r.suggestions.some((s) => String(s.input || '').toUpperCase() === 'MS130'),
      `bare MS130 family stem must still raise a did-you-mean chip: ${JSON.stringify(r).slice(0, 500)}`);
    const parsedSkus = (r.parsedItems || []).map((item) => String(item.sku || '').toUpperCase());
    assert.ok(!parsedSkus.includes('MR36-HW'), `phantom MR36-HW row: ${JSON.stringify(r.parsedItems)}`);
  });

  await t('control: prose with residue still reaches the classifier, so the stub is live', async () => {
    const { env, state } = hostileEnterpriseClassifier();
    const r = await callQuote('please quote 4 MR36-HW advanced for our warehouse refresh', env);
    assert.strictEqual(state.calls, 1, `prose must consult V3 exactly once; calls=${state.calls}`);
    assert.match(state.prompts[0], /MR36-HW advanced/i);
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length > 0, JSON.stringify(r).slice(0, 400));
    // Demonstrates the hazard the allowlist closes: the hostile answer wins on
    // prose and quotes Enterprise for the access point.
    const urls = r.quoteUrls.map((option) => option.url).join(' ');
    assert.ok(/LIC-ENT-/.test(urls), `hostile classifier expected to force LIC-ENT on prose: ${urls}`);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
})();
