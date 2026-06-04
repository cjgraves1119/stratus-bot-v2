// ACCEPTANCE CORPUS — Bug #2: per-item (per-clause) intent.
//
// Intent modifiers (hardwareOnly / licenseOnly) are GLOBAL (whole-message) but
// users express them PER ITEM. "6 mr and 1 mx84 license renewal and 1 CW9172I
// hardware only" sets BOTH flags globally → non-EOL items render neither hardware
// nor license → DROPPED; and a bare model's license folds into another item's
// LIC-ENT count. Fix: each parsed item carries its own intent; buildQuoteResponse
// reads item intent with the global modifier as fallback (single-intent messages
// are unchanged → no regression).
//
// Product rule (confirmed with Chris 2026-06-04): a bare model with NO explicit
// intent word → normal AP quote (hardware + license). An explicit per-clause
// "hardware only" / "license"/"renewal" overrides for THAT item only.
//
// Connectors: per-clause intent splits on "and/plus/then/,/;/newline", and a clause's
// hardware intent matches an explicit "hardware only"/"hw only"/"without license" OR a
// bare "hardware" word (with the same exclusions the global rule uses: hardware
// specs/info/details/question/issue/problem/support/failure/warranty). So
// "renew MX67 then add MR44 hardware" → MX67 license + MR44 hardware-only.
//
// Gated through the REAL /api/quote handler AND both deterministic engines.
// Run: node worker-gchat/test-per-item-intent-2026-06-04.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function loadGchatHandler() {
  const here = __dirname;
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
  const tmp = path.join(os.tmpdir(), `pii-gchat-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp).__worker;
}
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
  const tmp = path.join(os.tmpdir(), `pii-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const worker = loadGchatHandler();
const G = loadEngine('worker-gchat', 'gch');
const W = loadEngine('worker', 'wbx');

const kv = { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }), getWithMetadata: async () => ({ value: null, metadata: null }) };
const db = { prepare: () => ({ bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }), run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }) };
const env = { GMAIL_ADDON_API_KEY: 'test-key', CONVERSATION_KV: kv, PRICES_KV: kv, ANALYTICS_DB: db, BOT_METRICS: { writeDataPoint: () => {} }, BOT_STORAGE: kv };
const ctx = { waitUntil: (p) => { try { if (p && p.catch) p.catch(() => {}); } catch (_) {} } };

async function callQuote(text) {
  const req = new Request('https://x.workers.dev/api/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: 'pii-corpus' }),
  });
  return await (await worker.fetch(req, env, ctx)).json();
}
// SKU → max qty seen across all order URLs in a string (term URLs repeat SKUs).
function skuQty(text) {
  const map = {};
  for (const m of (text || '').matchAll(/item=([^&\s]+)&qty=([0-9,]+)/g)) {
    const skus = decodeURIComponent(m[1]).split(','), qtys = m[2].split(',');
    skus.forEach((s, i) => { const q = parseInt(qtys[i] || '0', 10); if (!map[s] || q > map[s]) map[s] = q; });
  }
  return map;
}
const handlerSkuQty = (r) => skuQty((r.quoteUrls || []).map(u => u.url).join(' '));
function engineSkuQty(mod, text) {
  try { const r = mod.buildQuoteResponse(mod.parseMessage(text)); return skuQty((r && r.message) || ''); } catch (e) { return { __err: e.message }; }
}
const keys = (m) => Object.keys(m).sort();
const findKey = (m, re) => Object.keys(m).find(k => re.test(k));

let pass = 0, fail = 0;
async function t(name, fn) { try { await fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; } }

(async () => {
  console.log('── MIXED CASE 1: "...mx84 license renewal and 1 CW9172I hardware only" (handler) ──');
  await t('nothing dropped: MR license + MX84 license + CW9172I hardware all present', async () => {
    const m = handlerSkuQty(await callQuote('6 mr and 1 mx84 enterprise license renewal and 1 CW9172I hardware only'));
    const ent = findKey(m, /^LIC-ENT-\dYR$/);
    assert.ok(ent, `MR enterprise license (LIC-ENT) dropped: ${keys(m)}`);
    assert.strictEqual(m[ent], 6, `MR LIC-ENT qty should be 6 (CW9172I is hardware-only, adds no license), got ${m[ent]}`);
    assert.ok(findKey(m, /^LIC-MX84/), `MX84 license dropped: ${keys(m)}`);
    assert.ok(findKey(m, /^CW9172I-RTG$/), `CW9172I hardware dropped (it was 'hardware only'): ${keys(m)}`);
  });

  console.log('\n── MIXED CASE 3: "...mx84 license renewal and 1 CW9172I" (no intent word on CW) (handler) ──');
  await t('CW9172I (bare, no intent) → normal AP: CW9172I-RTG present, not silently folded away', async () => {
    const m = handlerSkuQty(await callQuote('6 mr and 1 mx84 enterprise license renewal and 1 CW9172I'));
    assert.ok(findKey(m, /^CW9172I-RTG$/), `CW9172I hardware dropped (bare model should quote as normal AP): ${keys(m)}`);
    assert.ok(findKey(m, /^LIC-MX84/), `MX84 license dropped: ${keys(m)}`);
    assert.ok(findKey(m, /^LIC-ENT-\dYR$/), `MR enterprise license dropped: ${keys(m)}`);
  });

  console.log('\n── REGRESSION GUARDS: single-intent messages must be UNCHANGED (both engines) ──');
  const guards = [
    { input: '6 mr44 hardware only', want: /^MR44-HW$/, absent: /^LIC-ENT/, desc: 'HW only → MR44-HW, no license' },
    { input: 'renewal for 6 mr44', want: /^LIC-ENT-\dYR$/, absent: /^MR44-HW$/, desc: 'renewal → LIC-ENT, no hardware' },
  ];
  for (const g of guards) {
    await t(`"${g.input}" — ${g.desc} (gchat≡webex)`, async () => {
      const gm = engineSkuQty(G, g.input), wm = engineSkuQty(W, g.input);
      assert.ok(findKey(gm, g.want), `gchat missing ${g.want}: ${keys(gm)}`);
      assert.ok(!findKey(gm, g.absent), `gchat should NOT have ${g.absent}: ${keys(gm)}`);
      assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: gchat=${keys(gm)} webex=${keys(wm)}`);
    });
  }
  await t('"6 mr44" (no intent) → MR44-HW + LIC-ENT (normal AP), gchat≡webex', async () => {
    const gm = engineSkuQty(G, '6 mr44'), wm = engineSkuQty(W, '6 mr44');
    assert.ok(findKey(gm, /^MR44-HW$/) && findKey(gm, /^LIC-ENT-\dYR$/), `normal AP quote wrong: ${keys(gm)}`);
    assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: gchat=${keys(gm)} webex=${keys(wm)}`);
  });

  console.log('\n── ORDER-INDEPENDENCE: per-item intent regardless of clause order (review finding) ──');
  await t('"1 CW9172I hardware only and 6 MR44" → CW9172I-RTG (hw-only) + MR44 NORMAL (MR44-HW + LIC-ENT)', async () => {
    const gm = engineSkuQty(G, '1 CW9172I hardware only and 6 MR44'), wm = engineSkuQty(W, '1 CW9172I hardware only and 6 MR44');
    assert.ok(findKey(gm, /^CW9172I-RTG$/), `CW9172I hardware missing: ${keys(gm)}`);
    assert.ok(findKey(gm, /^MR44-HW$/), `MR44 hardware missing (should be normal AP): ${keys(gm)}`);
    assert.ok(findKey(gm, /^LIC-ENT-\dYR$/), `MR44 license missing — it wrongly inherited CW9172I's hardware-only intent: ${keys(gm)}`);
    assert.deepStrictEqual(gm, wm, `parity drift: ${JSON.stringify(gm)} vs ${JSON.stringify(wm)}`);
  });
  await t('"1 MR44 license renewal and 1 CW9172I" → CW9172I-RTG present (CW9172I NORMAL, not license-folded)', async () => {
    const gm = engineSkuQty(G, '1 MR44 license renewal and 1 CW9172I'), wm = engineSkuQty(W, '1 MR44 license renewal and 1 CW9172I');
    assert.ok(findKey(gm, /^CW9172I-RTG$/), `CW9172I hardware dropped — it wrongly inherited MR44's license-only intent: ${keys(gm)}`);
    assert.deepStrictEqual(gm, wm, `parity drift: ${JSON.stringify(gm)} vs ${JSON.stringify(wm)}`);
  });

  console.log('\n── LIST-LEVEL modifiers must STILL apply to all items (must NOT regress) ──');
  await t('"2 MS130-24P, 4 MR44, 5 MX67 licenses" (trailing) → all license, NO hardware', async () => {
    const gm = engineSkuQty(G, '2 MS130-24P, 4 MR44, 5 MX67 licenses'), wm = engineSkuQty(W, '2 MS130-24P, 4 MR44, 5 MX67 licenses');
    assert.ok(!findKey(gm, /-HW$/), `trailing "licenses" should suppress ALL hardware: ${keys(gm)}`);
    assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: ${keys(gm)} vs ${keys(wm)}`);
  });
  await t('"renewal for 4 MR44 and 5 MX67" (leading) → all license, NO hardware', async () => {
    const gm = engineSkuQty(G, 'renewal for 4 MR44 and 5 MX67'), wm = engineSkuQty(W, 'renewal for 4 MR44 and 5 MX67');
    assert.ok(!findKey(gm, /-HW$/), `leading "renewal for" should suppress ALL hardware: ${keys(gm)}`);
    assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: ${keys(gm)} vs ${keys(wm)}`);
  });
  // Regression guard (2nd review pass): leading "license renewal for …" must be
  // list-level too — the "license" word before "renewal for" must not narrow it.
  for (const input of ['license renewal for 6 mr44 and 1 mx67', 'enterprise license renewal for 6 mr44 and 1 mx67']) {
    await t(`"${input}" (leading license phrase) → all license, NO hardware`, async () => {
      const gm = engineSkuQty(G, input), wm = engineSkuQty(W, input);
      assert.ok(!findKey(gm, /-HW$/), `leading "license renewal for" should suppress ALL hardware: ${keys(gm)}`);
      assert.ok(findKey(gm, /^LIC-ENT-\dYR$/) && findKey(gm, /^LIC-MX67/), `expected MR + MX67 licenses: ${keys(gm)}`);
      assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: ${keys(gm)} vs ${keys(wm)}`);
    });
  }

  console.log('\n── "then" connector + bare "hardware" → per-item intent (Chris 2026-06-04) ──');
  await t('"renew MX67 then add MR44 hardware" → MX67 license + MR44-HW (no MX67-HW, no MR44 license)', async () => {
    const gm = engineSkuQty(G, 'renew MX67 then add MR44 hardware'), wm = engineSkuQty(W, 'renew MX67 then add MR44 hardware');
    assert.ok(findKey(gm, /^LIC-MX67/), `MX67 should be license (renew): ${keys(gm)}`);
    assert.ok(!findKey(gm, /^MX67.*-HW$|^MX67-/), `MX67 should NOT be hardware: ${keys(gm)}`);
    assert.ok(findKey(gm, /^MR44-HW$/), `MR44 should be hardware: ${keys(gm)}`);
    assert.ok(!findKey(gm, /^LIC-ENT-\dYR$/), `MR44 should NOT carry a license (it's hardware only): ${keys(gm)}`);
    assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: ${keys(gm)} vs ${keys(wm)}`);
  });
  await t('"renew MX67 then MR44 hardware" (no "add") → same per-item split', async () => {
    const gm = engineSkuQty(G, 'renew MX67 then MR44 hardware');
    assert.ok(findKey(gm, /^LIC-MX67/) && findKey(gm, /^MR44-HW$/) && !findKey(gm, /^LIC-ENT-\dYR$/), `wrong split: ${keys(gm)}`);
  });
  // Per-clause hardware must match only an item-qualifier "hardware" (trailing or
  // "hardware for"), NOT "hardware <noun>". Regression guard: when the GLOBAL rule is
  // suppressed (a "hardware support" phrase present), a clause's "hardware model" must
  // NOT re-trigger hardware-only and drop the license — both items quote normally.
  await t('"quote hardware support for 1 MX67 and 1 MR44 hardware model" → both NORMAL (licenses kept)', async () => {
    const gm = engineSkuQty(G, 'quote hardware support for 1 MX67 and 1 MR44 hardware model'), wm = engineSkuQty(W, 'quote hardware support for 1 MX67 and 1 MR44 hardware model');
    assert.ok(findKey(gm, /^LIC-ENT-\dYR$/), `MR44 license wrongly dropped ("hardware model" mis-read as hardware-only): ${keys(gm)}`);
    assert.ok(findKey(gm, /^LIC-MX67/), `MX67 license missing: ${keys(gm)}`);
    assert.ok(findKey(gm, /^MR44-HW$/) && findKey(gm, /^MX67-HW$/), `hardware missing: ${keys(gm)}`);
    assert.deepStrictEqual(keys(gm), keys(wm), `parity drift: ${keys(gm)} vs ${keys(wm)}`);
  });

  console.log('\n── EOL + hardware-only must NOT leave an empty "Option" section (review finding) ──');
  const noEmptyOption = (msg) => {
    for (const p of (msg || '').split(/(?=\*\*Option )/)) {
      if (/^\*\*Option /.test(p) && !/stratusinfosystems\.com\/order\//.test(p)) return false;
    }
    return true;
  };
  await t('"MS220-8P hardware only" → MS130-8P-HW present, no empty Option section, gchat≡webex', async () => {
    const gMsg = (G.buildQuoteResponse(G.parseMessage('MS220-8P hardware only')) || {}).message || '';
    assert.ok(/MS130-8P-HW/.test(gMsg), `replacement hardware missing: ${gMsg.slice(0, 160)}`);
    assert.ok(noEmptyOption(gMsg), `empty Option section present:\n${gMsg}`);
    assert.deepStrictEqual(engineSkuQty(G, 'MS220-8P hardware only'), engineSkuQty(W, 'MS220-8P hardware only'), 'parity drift');
  });

  console.log('\n── PARITY on the mixed cases (both engines identical SKU+qty multiset) ──');
  for (const input of ['6 mr and 1 mx84 enterprise license renewal and 1 CW9172I hardware only', '6 mr and 1 mx84 enterprise license renewal and 1 CW9172I']) {
    await t(`parity "${input.slice(0, 40)}..."`, async () => {
      const gm = engineSkuQty(G, input), wm = engineSkuQty(W, input);
      assert.deepStrictEqual(gm, wm, `parity drift:\n     gchat=${JSON.stringify(gm)}\n     webex=${JSON.stringify(wm)}`);
    });
  }

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
