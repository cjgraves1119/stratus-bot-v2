// R4v2 date policy + non-HW Zoho product preference — guards the 2026-07-21
// Chris rules:
//   1. Quote Valid_Till / Deal Closing_Date default = END OF CURRENT MONTH
//      (was +14d), pair always matched.
//   2. Within 7 days of month-end → needsConfirmation (ask the user).
//   3. Cisco fiscal-quarter cap: the default/explicit date must never slip
//      into the next Cisco fiscal quarter without confirmation. Quarters are
//      13-week Saturday-ending periods anchored to FY end = last Saturday of
//      July (FY26 Q4 = 2026-07-25, verified investor.cisco.com).
//   4. Zoho Quoted_Items: MX/MS hardware lines swap to the non-HW Zoho
//      product record when one exists (cached in KV), fail open to -HW.
//
// Run: node worker-gchat/test-date-policy-nonhw-2026-07-21.js

const fs = require('fs'), path = require('path'), os = require('os');

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

function loadEngine() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  for (const [imp, file] of [['pricesData', 'src/data/prices.json'], ['catalogData', 'src/data/auto-catalog.json'], ['specsData', 'src/data/specs.json'], ['accessoriesData', 'src/data/accessories.json'], ['voiceSkillData', 'src/email-reply-voice-skill.json']]) {
    src = src.replace(new RegExp(`^import ${imp} from '[^']+';?$`, 'm'), `const ${imp} = require(${JSON.stringify(path.join(here, file))});`);
  }
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += '\nmodule.exports = { ciscoFiscalQuarterEnd, defaultQuoteDealDate, preferNonHwQuotedItems, getProductIdToSkuMap, validateCrmWrite };';
  const tmp = path.join(os.tmpdir(), `date-nonhw-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}
const G = loadEngine();
const D = (s) => new Date(s + 'T12:00:00Z');

(async () => {
  // ── 1. Cisco fiscal quarter ends (13-week Saturdays, FY end = last Sat of July) ──
  console.log('ciscoFiscalQuarterEnd');
  ok(G.ciscoFiscalQuarterEnd(D('2026-07-21')) === '2026-07-25', 'Jul 21 2026 → FY26 Q4 end 2026-07-25');
  ok(G.ciscoFiscalQuarterEnd(D('2026-07-25')) === '2026-07-25', 'quarter-end day itself still maps to that quarter');
  ok(G.ciscoFiscalQuarterEnd(D('2026-07-26')) === '2026-10-24', 'Jul 26 2026 → FY27 Q1 end 2026-10-24');
  ok(G.ciscoFiscalQuarterEnd(D('2025-09-01')) === '2025-10-25', 'Sep 1 2025 → FY26 Q1 end 2025-10-25');
  ok(G.ciscoFiscalQuarterEnd(D('2026-01-02')) === '2026-01-24', 'Jan 2 2026 → FY26 Q2 end 2026-01-24');
  ok(G.ciscoFiscalQuarterEnd(D('2026-02-10')) === '2026-04-25', 'Feb 10 2026 → FY26 Q3 end 2026-04-25');
  ok(G.ciscoFiscalQuarterEnd(D('2027-06-01')) === '2027-07-31', 'FY27 (53-week year) Q4 end 2027-07-31');

  // ── 2. Default dates: end of month, matched pair semantics ──
  console.log('defaultQuoteDealDate');
  let d = G.defaultQuoteDealDate(D('2026-08-10'));
  ok(d.date === '2026-08-31' && !d.needsConfirmation && !d.crossesFiscalQuarter && d.suggested === '2026-08-31',
    'mid-month (Aug 10) → EOM 2026-08-31, silent');
  d = G.defaultQuoteDealDate(D('2026-07-21'));
  ok(d.date === '2026-07-31' && d.crossesFiscalQuarter && d.suggested === '2026-07-25' && d.needsConfirmation,
    `Jul 21 (Chris's live case) → EOM 07-31 CROSSES FY26 Q4 end; suggest 07-25; confirm (got ${JSON.stringify({ date: d.date, sug: d.suggested, conf: d.needsConfirmation })})`);
  d = G.defaultQuoteDealDate(D('2026-03-27'));
  ok(d.date === '2026-03-31' && d.daysToMonthEnd === 4 && d.needsConfirmation && !d.crossesFiscalQuarter && d.suggested === '2026-03-31',
    'Mar 27 → 4 days to EOM → confirm (no fiscal crossing; Q3 ends Apr 25)');
  d = G.defaultQuoteDealDate(D('2026-04-28'));
  ok(d.date === '2026-04-30' && !d.crossesFiscalQuarter && d.needsConfirmation,
    'Apr 28 → already inside Q4 (Apr 26–Jul 25): EOM Apr 30 does NOT cross; still confirms via 2-day window');
  d = G.defaultQuoteDealDate(D('2026-10-05'));
  ok(d.date === '2026-10-31' && d.crossesFiscalQuarter && d.suggested === '2026-10-24' && d.needsConfirmation,
    'Oct 5 2026 → EOM 10-31 crosses FY27 Q1 end 10-24 → suggest 10-24, confirm');
  ok(d.nextMonthEnd === '2026-11-30', 'nextMonthEnd carried for the alternate chip');

  // ── 3. Non-HW Zoho product preference (KV-cached resolution path) ──
  console.log('preferNonHwQuotedItems');
  const idMap = G.getProductIdToSkuMap();
  const mx85hwId = Object.keys(idMap).find(k => idMap[k] === 'MX85-HW');
  const mr44hwId = Object.keys(idMap).find(k => idMap[k] === 'MR44-HW');
  ok(Boolean(mx85hwId && mr44hwId), 'reverse map has MX85-HW and MR44-HW ids');
  const kvStore = new Map([['nonhw:MX85', '2570562000388889594|MX85']]); // self-verifying pre-cached resolution
  const env = { PRICES_KV: { get: async k => kvStore.get(k) ?? null, put: async (k, v) => { kvStore.set(k, v); } } };
  const items = [
    { Product_Name: { id: mx85hwId }, Quantity: 1 },            // MX → swaps
    { Product_Name: { id: mr44hwId }, Quantity: 4 },            // MR → NOT in scope, stays
    { id: 'existing-line', Product_Name: { id: mx85hwId } },    // existing line → untouched
  ];
  const r = await G.preferNonHwQuotedItems(items, env);
  ok(r.swapped === 1 && items[0].Product_Name.id === '2570562000388889594',
    `MX85-HW line swapped to the non-HW Zoho product (swapped=${r.swapped})`);
  ok(items[1].Product_Name.id === mr44hwId, 'MR44-HW (not MX/MS) untouched');
  ok(items[2].Product_Name.id === mx85hwId, 'existing line (has id) untouched');
  ok(idMap['2570562000388889594'] === 'MX85-HW', 'swapped id registered in reverse map for discount correction');
  // 'none' cache sentinel → fail open, keep -HW
  const kv2 = new Map([['nonhw:MS130-24P', 'none']]);
  const env2 = { PRICES_KV: { get: async k => kv2.get(k) ?? null, put: async () => {} } };
  const ms24hwId = Object.keys(idMap).find(k => idMap[k] === 'MS130-24P-HW');
  const items2 = [{ Product_Name: { id: ms24hwId }, Quantity: 1 }];
  await G.preferNonHwQuotedItems(items2, env2);
  ok(items2[0].Product_Name.id === ms24hwId, 'cached "none" (no non-HW record) → -HW id kept (fail open)');
  // Codex edge-hunt (2026-07-21): a WELL-FORMED id under the WRONG key must
  // never reach a quote line — the entry self-verifies via its |BASE suffix.
  for (const [label, poisoned] of [
    ['crossed entry (valid id, wrong base)', '2570562000388889594|MX95'],
    ['legacy bare id (pre-hardening format)', '2570562000388889594'],
    ['garbage value', 'DROP TABLE quotes'],
  ]) {
    const kv3 = new Map([['nonhw:MX85', poisoned]]);
    const env3 = { PRICES_KV: { get: async k => kv3.get(k) ?? null, put: async () => {} } };
    const items3 = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
    await G.preferNonHwQuotedItems(items3, env3); // live re-lookup throws w/o creds → -HW kept
    ok(items3[0].Product_Name.id === mx85hwId, `${label} → discarded, -HW id kept (fail open)`);
  }

  // 2026-07-22 council fix: __date_confirmed must be stripped on UPDATE
  // payloads too (the Quotes strip was create-only; the helper key reached
  // the Zoho write on updates).
  {
    const upd = { Valid_Till: '2026-09-30', __date_confirmed: true };
    await G.validateCrmWrite('Quotes', upd, false, null);
    ok(!('__date_confirmed' in upd), 'Quotes UPDATE: __date_confirmed stripped before Zoho write');
    const updD = { Closing_Date: '2026-09-30', __date_confirmed: true };
    await G.validateCrmWrite('Deals', updD, false, null);
    ok(!('__date_confirmed' in updD), 'Deals UPDATE: __date_confirmed stripped before Zoho write');
  }

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
