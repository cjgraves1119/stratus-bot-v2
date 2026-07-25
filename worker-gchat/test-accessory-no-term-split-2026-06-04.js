// ACCEPTANCE CORPUS — Bug #1: accessory-only quotes must NOT get a spurious
// 1/3/5-Year term split. Accessories (mounts, injectors, power, antennas, cables)
// carry no license, so there is no co-term to differentiate — a single URL only.
//
// Gated at TWO layers per the handoff discipline (parseMessage-only tests let prior
// bugs through):
//   (A) the REAL worker-gchat /api/quote handler  → assert exactly 1 quoteUrl, no year label
//   (B) the worker/ (Webex) deterministic message  → assert exactly 1 order URL
// Plus NEGATIVE cases: hardware / agnostic-license / mixed / explicit-term must
// STILL produce their normal multi-URL (or correctly-labeled) output — no over-collapse.
//
// Run: node worker-gchat/test-accessory-no-term-split-2026-06-04.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

// ── (A) worker-gchat: load the REAL default fetch() handler ──
function loadGchatHandler() {
  const here = path.join(__dirname);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${esc('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  const tmp = path.join(os.tmpdir(), `acc-gchat-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp).__worker;
}

// ── Engine loader (internal parseMessage + buildQuoteResponse) for EITHER worker ──
function loadEngine(workerDir, tag) {
  const here = path.join(__dirname, '..', workerDir);
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
  src += `\nmodule.exports = { parseMessage, buildQuoteResponse };`;
  const tmp = path.join(os.tmpdir(), `acc-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const worker = loadGchatHandler();         // gchat REAL /api/quote handler (layer A)
const G = loadEngine('worker-gchat', 'gch'); // gchat deterministic engine (layer B)
const W = loadEngine('worker', 'wbx');       // webex deterministic engine (layer B)

const kv = { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }), getWithMetadata: async () => ({ value: null, metadata: null }) };
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
const env = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: kv, PRICES_KV: kv, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: kv };
const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

async function callQuote(text) {
  const req = new Request('https://x.workers.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: 'acc-corpus' }),
  });
  const res = await worker.fetch(req, env, ctx);
  return await res.json();
}
// Count distinct order URLs in a deterministic message + read noTermSplit.
function engineResult(mod, text) {
  try { const r = mod.buildQuoteResponse(mod.parseMessage(text)); const msg = (r && r.message) || ''; return { urls: (msg.match(/https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+/g) || []).length, noTermSplit: !!(r && r.noTermSplit), msg }; }
  catch (e) { return { urls: -1, noTermSplit: false, msg: '[ERR:' + e.message + ']' }; }
}

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; } }

(async () => {
  // ── LAYER A: the user-facing gate — accessory-only through the REAL handler ──
  console.log('── LAYER A (real /api/quote handler): accessory-only → exactly ONE URL, no year label ──');
  const accessoryInputs = [
    'MA-MNT-MV-78, MA-MNT-MV-88',  // mounts (combined)
    'MA-INJ-4-US',                  // injector
    'MA-PWR-30W',                   // power supply
    'MA-ANT-25',                    // antenna
    'MA-CBL-100G-1M',               // cable
    '2 MA-INJ-4-US',                // qty accessory
  ];
  for (const input of accessoryInputs) {
    await t(`"${input}" → 1 quoteUrl, neutral label`, async () => {
      const r = await callQuote(input);
      assert.notStrictEqual(r.handlerType, 'suggestions-only', `blocked: ${JSON.stringify(r.suggestions)}`);
      assert.ok(Array.isArray(r.quoteUrls), `no quoteUrls array: ${JSON.stringify(r).slice(0, 160)}`);
      assert.strictEqual(r.quoteUrls.length, 1, `expected 1 URL, got ${r.quoteUrls.length}: ${r.quoteUrls.map(u => u.label).join('|')}`);
      assert.ok(!/\d\s*-?\s*year/i.test(r.quoteUrls[0].label), `label implies a term: "${r.quoteUrls[0].label}"`);
    });
  }

  // ── LAYER B: engine-level collapse + NO over-collapse, identical across BOTH workers ──
  console.log('\n── LAYER B (both engines): accessory-only → 1 URL + noTermSplit; licensed → 3 URLs; parity ──');
  const accCollapse = ['MA-MNT-MV-78, MA-MNT-MV-88', 'MA-INJ-4-US', 'MA-PWR-30W', 'MA-ANT-25', 'MA-CBL-100G-1M'];
  for (const input of accCollapse) {
    await t(`"${input}" → 1 URL + noTermSplit, gchat≡webex`, async () => {
      const g = engineResult(G, input), w = engineResult(W, input);
      assert.strictEqual(g.urls, 1, `gchat emitted ${g.urls} URLs (expected 1): ${g.msg.slice(0, 120)}`);
      assert.strictEqual(w.urls, 1, `webex emitted ${w.urls} URLs (expected 1): ${w.msg.slice(0, 120)}`);
      assert.ok(g.noTermSplit && w.noTermSplit, `noTermSplit not set on both (gchat=${g.noTermSplit}, webex=${w.noTermSplit})`);
    });
  }
  // Licensed / agnostic-license items MUST still emit the 3-term split (no over-collapse).
  const licensed = ['6 MR44', '5 MS130-24P', '3 MV2', '5 MR licenses' /* bare-family → MR-AGN agnostic license */];
  for (const input of licensed) {
    await t(`"${input}" → 3 URLs, noTermSplit=false, gchat≡webex (no over-collapse)`, async () => {
      const g = engineResult(G, input), w = engineResult(W, input);
      assert.strictEqual(g.urls, 3, `gchat emitted ${g.urls} URLs (expected 3): ${g.msg.slice(0, 120)}`);
      assert.strictEqual(w.urls, 3, `webex emitted ${w.urls} URLs (expected 3): ${w.msg.slice(0, 120)}`);
      assert.ok(!g.noTermSplit && !w.noTermSplit, `noTermSplit wrongly set on a licensed quote`);
    });
  }

  // ── MIXED: accessory + licensed hardware → 3 URLs, accessory rides along in each ──
  console.log('\n── MIXED: accessory + licensed hardware → 3 URLs, accessory present in each (handler) ──');
  await t('"MA-MNT-MV-78 and 4 MR44" → 3 URLs, each contains MA-MNT-MV-78 + LIC-ENT spread', async () => {
    const r = await callQuote('MA-MNT-MV-78 and 4 MR44');
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 3, `expected 3 URLs, got ${(r.quoteUrls || []).length}`);
    for (const u of r.quoteUrls) assert.ok(/MA-MNT-MV-78/.test(u.url), `accessory missing from URL: ${u.url}`);
    const joined = r.quoteUrls.map(u => u.url).join(' ');
    assert.ok(/LIC-ENT-1YR/.test(joined) && /LIC-ENT-3YR/.test(joined) && /LIC-ENT-5YR/.test(joined), `MR licenses not spread across terms: ${joined}`);
  });

  // ── CONTROL: explicit single-term license unaffected (directLicense path, not noTermSplit) ──
  console.log('\n── CONTROL: explicit single-term license is unaffected (directLicense path) ──');
  await t('"10 lic-sme-3yr" → 1 URL labeled 3-Year (capped term, NOT collapsed-to-neutral)', async () => {
    const r = await callQuote('10 lic-sme-3yr');
    assert.ok(Array.isArray(r.quoteUrls) && r.quoteUrls.length === 1, `expected 1 URL, got ${(r.quoteUrls || []).length}`);
    assert.ok(/3\s*-?\s*year/i.test(r.quoteUrls[0].label), `expected 3-Year label, got "${r.quoteUrls[0].label}"`);
  });

  console.log(`\n${fail === 0 ? '✅' : '❌'} ${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
