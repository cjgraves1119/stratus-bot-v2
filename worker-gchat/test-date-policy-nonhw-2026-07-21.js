// R4v2 date policy + non-HW Zoho product preference — guards the 2026-07-21
// Chris rules:
//   1. Quote Valid_Till / Deal Closing_Date default = END OF CURRENT MONTH
//      (was +14d), pair always matched.
//   2. Within 7 days of month-end → needsConfirmation (ask the user).
//   3. Cisco fiscal-quarter cap: the default/explicit date must never slip
//      into the next Cisco fiscal quarter without confirmation. Quarters are
//      13-week Saturday-ending periods anchored to FY end = last Saturday of
//      July (FY26 Q4 = 2026-07-25, verified investor.cisco.com).
//   4. Zoho Quoted_Items: MX/MS hardware lines swap atomically to active bare
//      Zoho product records; a missing/inactive/unverifiable bare record blocks
//      the quote for review and never falls back to -HW.
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
  src += '\nmodule.exports = { ciscoFiscalQuarterEnd, defaultQuoteDealDate, preferNonHwQuotedItems, preflightQuotedItemsProductActive, preflightResolvedQuoteProducts, formatQuotedItemsPreflightMessage, getProductIdToSkuMap, publicMxMsHardwareSku, validateCrmWrite, executeToolCall };';
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
  const priceData = require('./src/data/prices.json');
  const lineage = priceData.legacy_product_id_aliases;
  ok(lineage?._meta?.authority === 'historical_alias_only'
      && lineage._meta.source_commit === '3104e92b2b024debe51e61b9837a403ba770d580',
    'legacy Product-ID aliases carry explicit historical-only snapshot provenance');
  ok(Object.entries(lineage?.aliases || {}).every(([historicalId, alias]) => {
    const canonicalId = priceData.prices?.[alias.canonical_sku]?.zoho_product_id;
    return idMap[historicalId] === alias.sku
      && idMap[canonicalId] === alias.canonical_sku
      && historicalId !== canonicalId;
  }), 'all migrated historical ids preserve -HW lineage without overwriting canonical bare owners');
  const mx85hwId = Object.keys(idMap).find(k => idMap[k] === 'MX85-HW');
  const mr44hwId = Object.keys(idMap).find(k => idMap[k] === 'MR44-HW');
  ok(Boolean(mx85hwId && mr44hwId), 'reverse map has MX85-HW and MR44-HW ids');
  const originalFetch = global.fetch;
  const tokenKv = new Map([['zoho_access_token', 'test-token']]);
  const productById = new Map([
    ['2570562000388889594', { id: '2570562000388889594', Product_Code: 'MX85', Product_Active: true }],
    ['2570562000388889595', { id: '2570562000388889595', Product_Code: 'MX67C-NA', Product_Active: true }],
    ['2570562000388889596', { id: '2570562000388889596', Product_Code: 'MX67C-WW', Product_Active: true }],
  ]);
  const searchByCode = new Map();
  const sourceLookupFailures = new Set();
  const fetchCalls = [];
  const jsonResponse = (payload, status = 200) => new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
  global.fetch = async (url, opts = {}) => {
    const value = String(url);
    fetchCalls.push({ url: value, method: String(opts.method || 'GET').toUpperCase() });
    const idMatch = value.match(/\/Products\/(\d+)\?/);
    if (idMatch) {
      if (sourceLookupFailures.has(idMatch[1])) throw new Error(`forced lookup failure for ${idMatch[1]}`);
      return jsonResponse({ data: productById.has(idMatch[1]) ? [productById.get(idMatch[1])] : [] });
    }
    if (value.includes('/Products/search?')) {
      const decoded = decodeURIComponent(value);
      const code = decoded.match(/Product_Code:equals:([^\)]+)/)?.[1];
      return jsonResponse(searchByCode.get(code) || { data: [] });
    }
    throw new Error(`Unexpected test fetch: ${url}`);
  };
  const makeEnv = (store = new Map()) => ({
    PRICES_KV: {
      get: async k => store.get(k) ?? null,
      put: async (k, v) => { store.set(k, v); },
      delete: async k => { store.delete(k); }
    },
    CONVERSATION_KV: {
      get: async k => tokenKv.get(k) ?? null,
      put: async (k, v) => { tokenKv.set(k, v); }
    }
  });
  const kvStore = new Map([['nonhw:MX85', '2570562000388889594|MX85']]); // self-verifying pre-cached resolution
  const env = makeEnv(kvStore);
  const items = [
    { Product_Name: { id: mx85hwId }, Quantity: 1 },            // MX → swaps
    { Product_Name: { id: mr44hwId }, Quantity: 4 },            // MR → NOT in scope, stays
    { id: 'existing-line', Product_Name: { id: mx85hwId } },    // explicit product on existing row → swaps
  ];
  const r = await G.preferNonHwQuotedItems(items, env);
  ok(r.swapped === 2 && items[0].Product_Name.id === '2570562000388889594',
    `MX85-HW line swapped to the non-HW Zoho product (swapped=${r.swapped})`);
  ok(items[1].Product_Name.id === mr44hwId, 'MR44-HW (not MX/MS) untouched');
  ok(items[2].Product_Name.id === '2570562000388889594', 'existing row with explicit Product_Name is normalized too');
  ok(idMap['2570562000388889594'] === 'MX85', 'canonical bare id keeps its canonical reverse-map owner after swap');
  ok(idMap[mx85hwId] === 'MX85-HW' && mx85hwId !== '2570562000388889594',
    'historical -HW id remains a read-only lineage alias distinct from the canonical bare id');
  ok(G.publicMxMsHardwareSku('MX67-HW') === 'MX67'
      && G.publicMxMsHardwareSku('MX67C-HW-NA') === 'MX67C-NA'
      && G.publicMxMsHardwareSku('MS130-24P-HW') === 'MS130-24P'
      && G.publicMxMsHardwareSku('MR44-HW') === 'MR44-HW',
    'public SKU normalization removes only MX/MS -HW and preserves regional/non-target families');

  // The plan/catalog lookup must run the bare-product auto-correct before it
  // reports a legacy -HW cache row as inactive or missing.
  searchByCode.set('MX85', { data: [productById.get('2570562000388889594')] });
  const planLookup = await G.executeToolCall('batch_product_lookup', {
    skus: [{ sku: 'MX85', qty: 1 }]
  }, env, 'test-plan');
  ok(planLookup.products?.MX85?.found === true
      && planLookup.products.MX85.suffixed_sku === 'MX85'
      && planLookup.products.MX85.product_id === '2570562000388889594'
      && planLookup.products.MX85.pricing_sku === 'MX85-HW',
    'batch lookup exposes active bare MX85 while retaining MX85-HW only as its pricing alias');
  // A legacy 'none' sentinel is ignored; the current live absence is what
  // produces the deterministic review block.
  const kv2 = new Map([['nonhw:MS130-24P', 'none']]);
  const env2 = makeEnv(kv2);
  const ms24hwId = Object.keys(idMap).find(k => idMap[k] === 'MS130-24P-HW');
  const items2 = [{ Product_Name: { id: ms24hwId }, Quantity: 1 }];
  const r2 = await G.preferNonHwQuotedItems(items2, env2);
  ok(r2.valid === false && r2.error === 'non_hw_product_review_required'
      && r2.blocked?.[0]?.candidate === 'MS130-24P',
    'stale "none" + current live absence → typed review blocker for the exact bare candidate');
  ok(items2[0].Product_Name.id === ms24hwId,
    'live absence → original -HW id is not mutated into a write-ready success');

  // Mixed payload atomicity: an earlier valid swap must not be applied when a
  // later MX/MS line has no confirmed active bare record.
  const kvAtomic = new Map([
    ['nonhw:MX85', '2570562000388889594|MX85'],
    ['nonhw:MS130-24P', 'none'],
  ]);
  const envAtomic = makeEnv(kvAtomic);
  const atomicItems = [
    { Product_Name: { id: mx85hwId }, Quantity: 2 },
    { Product_Name: { id: ms24hwId }, Quantity: 3 },
  ];
  const atomicResult = await G.preferNonHwQuotedItems(atomicItems, envAtomic);
  ok(atomicResult.valid === false && atomicResult.swapped === 0
      && atomicItems[0].Product_Name.id === mx85hwId
      && atomicItems[1].Product_Name.id === ms24hwId,
    'mixed active+missing bare records block atomically with zero partial swaps');

  // Geography survives removal of only the literal -HW token, matching the
  // Stratus order-link rule for both NA and WW variants.
  const mx67naHwId = Object.keys(idMap).find(k => idMap[k] === 'MX67C-HW-NA');
  const mx67wwHwId = Object.keys(idMap).find(k => idMap[k] === 'MX67C-HW-WW');
  const kvRegional = new Map([
    ['nonhw:MX67C-NA', '2570562000388889595|MX67C-NA'],
    ['nonhw:MX67C-WW', '2570562000388889596|MX67C-WW'],
  ]);
  const regionalItems = [
    { Product_Name: { id: mx67naHwId }, Quantity: 1 },
    { Product_Name: { id: mx67wwHwId }, Quantity: 1 },
  ];
  const regionalResult = await G.preferNonHwQuotedItems(regionalItems, {
    ...makeEnv(kvRegional)
  });
  ok(regionalResult.valid === true && regionalResult.swapped === 2
      && regionalItems[0].Product_Name.id === '2570562000388889595'
      && regionalItems[1].Product_Name.id === '2570562000388889596',
    'NA/WW variants preserve geography while swapping to bare product ids');

  // An exact bare record that exists but is Product_Active=false is distinct
  // evidence for review; it must never be treated as a valid fallback.
  const inactivePriceKv = new Map();
  const inactiveEnv = makeEnv(inactivePriceKv);
  let liveProductPayload = {
    data: [{ id: '2570562000388889597', Product_Code: 'MX85', Product_Active: false }]
  };
  searchByCode.set('MX85', liveProductPayload);
  const inactiveItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const inactiveResult = await G.preferNonHwQuotedItems(inactiveItems, inactiveEnv);
  ok(inactiveResult.valid === false
      && inactiveResult.blocked?.[0]?.reason === 'bare_product_inactive'
      && inactiveItems[0].Product_Name.id === mx85hwId,
    'live inactive bare record → typed blocker and no -HW fallback');
  inactivePriceKv.clear();
  liveProductPayload = { data: [] };
  searchByCode.set('MX85', liveProductPayload);
  const missingItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const missingResult = await G.preferNonHwQuotedItems(missingItems, inactiveEnv);
  ok(missingResult.valid === false
      && missingResult.blocked?.[0]?.reason === 'bare_product_missing'
      && missingItems[0].Product_Name.id === mx85hwId,
    'live absent bare record → typed blocker and no -HW fallback');
  inactivePriceKv.clear();
  liveProductPayload = { error: 'RATE_LIMIT', status: 429 };
  searchByCode.set('MX85', liveProductPayload);
  const apiErrorItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const apiErrorResult = await G.preferNonHwQuotedItems(apiErrorItems, inactiveEnv);
  ok(apiErrorResult.valid === false
      && apiErrorResult.blocked?.[0]?.reason === 'bare_product_lookup_failed'
      && !inactivePriceKv.has('nonhw:MX85')
      && apiErrorItems[0].Product_Name.id === mx85hwId,
    'structured Zoho API error → lookup-failed blocker and no negative cache poisoning');
  searchByCode.delete('MX85');

  // Generic preflight must surface the same deterministic review contract.
  const preflightItems = [{ Product_Name: { id: ms24hwId }, Quantity: 1 }];
  const preflight = await G.preflightQuotedItemsProductActive(preflightItems, env2);
  ok(preflight.valid === false
      && preflight.error_code === 'non_hw_product_review_required'
      && preflight.requires_review === true
      && /REVIEW REQUIRED/.test(preflight.errors?.[0] || '')
      && preflightItems[0].Product_Name.id === ms24hwId,
    'Quoted_Items preflight returns structured review metadata and no mutation');
  ok(/^Review required — quote write blocked:/.test(G.formatQuotedItemsPreflightMessage(preflight)),
    'generic create/update surfaces label non-HW failure as review-required, not EOL');
  const existingScopedItems = [{ id: 'existing-mx-line', Product_Name: { id: mx85hwId }, Quantity: 2 }];
  const existingScopedResult = await G.preflightQuotedItemsProductActive(existingScopedItems, env);
  ok(existingScopedResult.valid === true
      && existingScopedItems[0].Product_Name.id === '2570562000388889594',
    'generic preflight normalizes explicit MX/MS -HW Product_Name on an existing row');

  // Compound create adapter reuses preflight, emits no write-ready items on a
  // blocker, and synchronizes both payload + reconciliation ids on success.
  const blockedResolved = [{ sku: 'MS130-24P-HW', product_id: ms24hwId, qty: 1, discount_per_unit: 100 }];
  const compoundBlocked = await G.preflightResolvedQuoteProducts(blockedResolved, env2);
  ok(compoundBlocked.valid === false && compoundBlocked.quoted_items.length === 0
      && blockedResolved[0].product_id === ms24hwId,
    'compound adapter blocks before producing Quoted_Items and leaves reconciliation state unchanged');
  const compoundResolved = [{ sku: 'MX85-HW', product_id: mx85hwId, qty: 2, discount_per_unit: 10 }];
  const compoundSuccess = await G.preflightResolvedQuoteProducts(compoundResolved, env);
  ok(compoundSuccess.valid === true
      && compoundSuccess.quoted_items[0].Product_Name.id === '2570562000388889594'
      && compoundSuccess.quoted_items[0].Discount === 20
      && compoundResolved[0].product_id === '2570562000388889594'
      && compoundResolved[0].sku === 'MX85'
      && compoundResolved[0].pricing_sku === 'MX85-HW',
    'compound adapter uses bare id/SKU in Quote state while retaining the legacy pricing alias');
  const engineSource = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  const compoundGateAt = engineSource.indexOf('preparedQuoteProducts = await preflightResolvedQuoteProducts(resolvedProducts, env)');
  const compoundStep5At = engineSource.indexOf('// STEP 5: Create Deal, or reuse the current Deal', compoundGateAt);
  const compoundQuotePostAt = engineSource.indexOf("zohoApiCall('POST', 'Quotes'", compoundStep5At);
  ok(compoundGateAt > -1 && compoundStep5At > compoundGateAt && compoundQuotePostAt > compoundStep5At
      && engineSource.indexOf('const quotedItems = preparedQuoteProducts.quoted_items;', compoundGateAt) < compoundStep5At,
    'compound create wires the shared preflight before Deal/Quote/Task writes and reuses its exact payload');

  // A legacy -HW source can itself be inactive/EOL; that must not pre-empt an
  // active bare product. MX67W-HW is a concrete catalog example.
  const mx67wHwId = Object.keys(idMap).find(k => idMap[k] === 'MX67W-HW');
  const mx67wBareId = '2570562000388889598';
  searchByCode.set('MX67W', { data: [{ id: mx67wBareId, Product_Code: 'MX67W', Product_Active: true }] });
  const inactiveSourceItems = [{ Product_Name: { id: mx67wHwId }, Quantity: 1 }];
  const inactiveSourceResult = await G.preflightQuotedItemsProductActive(inactiveSourceItems, makeEnv());
  ok(inactiveSourceResult.valid === true && inactiveSourceItems[0].Product_Name.id === mx67wBareId,
    'inactive legacy MX67W-HW source defers to and swaps into the active bare MX67W record');

  // A product id absent from prices.json is classified from its live Product_Code,
  // then sent through the same non-HW resolver. Lookup uncertainty fails closed.
  const liveOnlySourceId = '2570562000999999991';
  const liveOnlyBareId = '2570562000999999992';
  productById.set(liveOnlySourceId, { id: liveOnlySourceId, Product_Code: 'MX95-HW', Product_Active: true });
  searchByCode.set('MX95', { data: [{ id: liveOnlyBareId, Product_Code: 'MX95', Product_Active: true }] });
  const liveOnlyItems = [{ Product_Name: { id: liveOnlySourceId }, Quantity: 1 }];
  const liveOnlyResult = await G.preflightQuotedItemsProductActive(liveOnlyItems, makeEnv());
  ok(liveOnlyResult.valid === true && liveOnlyItems[0].Product_Name.id === liveOnlyBareId,
    'live-only MX95-HW source id is classified and normalized to the active bare record');
  const failingSourceId = '2570562000999999993';
  sourceLookupFailures.add(failingSourceId);
  const failingSourceItems = [{ Product_Name: { id: failingSourceId }, Quantity: 1 }];
  const failingSourceResult = await G.preflightQuotedItemsProductActive(failingSourceItems, makeEnv());
  ok(failingSourceResult.valid === false
      && failingSourceResult.error_code === 'product_verification_review_required'
      && failingSourceResult.requires_review === true
      && failingSourceItems[0].Product_Name.id === failingSourceId,
    'unknown source lookup failure blocks for deterministic review instead of failing open');
  sourceLookupFailures.delete(failingSourceId);

  // Positive cache entries are hints only: stale inactive and wrong-code ids
  // are re-resolved. Old negative sentinels cannot suppress a later active row.
  const replacementBareId = '2570562000388889600';
  const staleCacheKv = new Map([['nonhw:MX85', '2570562000388889594|MX85']]);
  productById.set('2570562000388889594', { id: '2570562000388889594', Product_Code: 'MX85', Product_Active: false });
  searchByCode.set('MX85', { data: [{ id: replacementBareId, Product_Code: 'MX85', Product_Active: true }] });
  const staleCacheItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const staleCacheResult = await G.preferNonHwQuotedItems(staleCacheItems, makeEnv(staleCacheKv));
  ok(staleCacheResult.valid === true && staleCacheItems[0].Product_Name.id === replacementBareId,
    'cached bare id that is now inactive is rejected and replaced by the current active exact record');
  const wrongCodeId = '2570562000388889601';
  productById.set(wrongCodeId, { id: wrongCodeId, Product_Code: 'MX95', Product_Active: true });
  const wrongCodeKv = new Map([['nonhw:MX85', `${wrongCodeId}|MX85`]]);
  const wrongCodeItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const wrongCodeResult = await G.preferNonHwQuotedItems(wrongCodeItems, makeEnv(wrongCodeKv));
  ok(wrongCodeResult.valid === true && wrongCodeItems[0].Product_Name.id === replacementBareId,
    'cached id whose live Product_Code no longer matches is discarded and safely re-resolved');
  const recoveredNoneKv = new Map([['nonhw:MX85', 'none']]);
  const recoveredNoneItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const recoveredNoneResult = await G.preferNonHwQuotedItems(recoveredNoneItems, makeEnv(recoveredNoneKv));
  ok(recoveredNoneResult.valid === true && recoveredNoneItems[0].Product_Name.id === replacementBareId,
    'legacy negative cache cannot block recovery after an active bare record appears');
  searchByCode.set('MX85', { data: [{ id: 'not-a-zoho-id', Product_Code: 'MX85', Product_Active: true }] });
  const malformedIdItems = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
  const malformedIdResult = await G.preferNonHwQuotedItems(malformedIdItems, makeEnv());
  ok(malformedIdResult.valid === false
      && malformedIdResult.blocked?.[0]?.reason === 'bare_product_lookup_failed'
      && malformedIdItems[0].Product_Name.id === mx85hwId,
    'active bare search result without a plausible Zoho id blocks instead of staging undefined/garbage');
  productById.set('2570562000388889594', { id: '2570562000388889594', Product_Code: 'MX85', Product_Active: true });
  searchByCode.set('MX85', { data: [productById.get('2570562000388889594')] });

  // Exercise the actual generic executor boundary. A missing bare record may
  // perform read-only verification calls, but it must return before any POST.
  searchByCode.delete('MS130-24P');
  fetchCalls.length = 0;
  const genericBlocked = await G.executeToolCall('zoho_create_record', {
    module_name: 'Quotes',
    data: { Subject: 'Non-HW guard test', Quoted_Items: [{ Product_Name: { id: ms24hwId }, Quantity: 1 }] }
  }, makeEnv(new Map([['nonhw:MS130-24P', 'none']])), 'test-nonhw');
  ok(genericBlocked.validation_error === true
      && genericBlocked.error_code === 'non_hw_product_review_required'
      && !fetchCalls.some(call => call.method === 'POST'),
    'generic Quote executor returns the review blocker with zero Zoho POSTs');

  // Codex edge-hunt (2026-07-21): a WELL-FORMED id under the WRONG key must
  // never reach a quote line — discard it, then recover only from an exact live
  // active search result.
  for (const [label, poisoned] of [
    ['crossed entry (valid id, wrong base)', '2570562000388889594|MX95'],
    ['legacy bare id (pre-hardening format)', '2570562000388889594'],
    ['garbage value', 'DROP TABLE quotes'],
  ]) {
    const kv3 = new Map([['nonhw:MX85', poisoned]]);
    const env3 = makeEnv(kv3);
    const items3 = [{ Product_Name: { id: mx85hwId }, Quantity: 1 }];
    const r3 = await G.preferNonHwQuotedItems(items3, env3);
    ok(r3.valid === true && items3[0].Product_Name.id === '2570562000388889594',
      `${label} → discarded and replaced only after an exact active live recheck`);
  }
  global.fetch = originalFetch;

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
