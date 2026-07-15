// Zoho quote-items mapper — extension "Build URL quote from this Zoho quote" fix
// (2026-06-12):
//
// The Chrome extension used to scrape the Zoho Quotes DOM via
// extractQuoteLineItems() in zoho-content.js. Zoho renders line items in a lyte
// web-component grid the scraper's selectors don't match → 0 items → user saw
// "Couldn't read any line items from this Zoho quote page." The fix fetches the
// line items authoritatively from the Zoho v8 API in the worker, keyed by the
// recordId the extension already parses from the page URL.
//
// This test drives the REAL mapSubformToItems() factored to module scope, plus
// source-guards proving the /api/zoho-quote-items endpoint exists, sits inside
// the X-API-Key gate, and never returns a price/margin field (no-margin
// invariant). Run: node worker-gchat/test-zoho-quote-items-2026-06-12.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine() {
  const here = __dirname;
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
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { mapSubformToItems, ZOHO_QUOTE_ITEMS_SUBFORM_FIELD, ZOHO_QUOTE_ITEMS_ALLOWED_MODULES };`;
  const tmp = path.join(os.tmpdir(), `zohoqi-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { mapSubformToItems, ZOHO_QUOTE_ITEMS_SUBFORM_FIELD, ZOHO_QUOTE_ITEMS_ALLOWED_MODULES } = loadEngine();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

// Helper: assert an items array carries ONLY {sku, qty} keys (no-margin invariant).
const PRICE_KEYS = ['price', 'unit_price', 'Unit_Price', 'list_price', 'List_Price', 'margin', 'Margin', 'total', 'Total', 'amount', 'Amount', 'Net_Total', 'Discount'];
const onlySkuQty = (items) => items.every(it => {
  const keys = Object.keys(it);
  return keys.length === 2 && keys.includes('sku') && keys.includes('qty');
});
const hasNoPriceKey = (items) => items.every(it => PRICE_KEYS.every(k => !(k in it)));

(async () => {
  console.log('mapSubformToItems — SKU resolution order');

  // 1. flat Product_Code present (Quotes/SO common case)
  let items = mapSubformToItems([{ Product_Code: 'MR44-HW', Quantity: 5 }]);
  ok(items.length === 1 && items[0].sku === 'MR44-HW' && items[0].qty === 5, 'flat Product_Code → {MR44-HW, 5}');

  // 2. Product_Name.Product_Code (lookup object carries the code)
  items = mapSubformToItems([{ Product_Name: { id: 'p1', Product_Code: 'MS130-8P-HW', name: 'Whatever' }, Quantity: 2 }]);
  ok(items.length === 1 && items[0].sku === 'MS130-8P-HW' && items[0].qty === 2, 'Product_Name.Product_Code → {MS130-8P-HW, 2}');

  // 3. SKU recovered from Product_Name.name via regex (no code anywhere)
  items = mapSubformToItems([{ Product_Name: { id: 'p2', name: 'Cisco Catalyst CW9166I-MR Access Point' }, Quantity: 1 }]);
  ok(items.length === 1 && items[0].sku === 'CW9166I-MR', 'name-only "CW9166I-MR" → regex-extracted');

  items = mapSubformToItems([{ Product_Name: { name: 'MX85 Security Appliance' }, Quantity: 3 }]);
  ok(items.length === 1 && items[0].sku === 'MX85' && items[0].qty === 3, 'name-only "MX85 ..." → MX85');

  items = mapSubformToItems([{ Product_Name: { name: 'Meraki LIC-MR-ADV-3YR enterprise license' }, Quantity: 10 }]);
  ok(items.length === 1 && items[0].sku === 'LIC-MR-ADV-3YR', 'name-only LIC- token → extracted');

  console.log('Skip + rounding + uppercase');

  // missing-sku row skipped entirely
  items = mapSubformToItems([{ Product_Name: { name: 'Onsite installation labor (no SKU)' }, Quantity: 4 }]);
  ok(items.length === 0, 'row with no derivable SKU → skipped (not emitted)');

  // mixed: one good, one skipped
  items = mapSubformToItems([
    { Product_Code: 'MV12-HW', Quantity: 2 },
    { Product_Name: { name: 'Professional services' }, Quantity: 1 },
  ]);
  ok(items.length === 1 && items[0].sku === 'MV12-HW', 'mixed rows → only the SKU-bearing row survives');

  // qty rounding: 2.6 → 3, "1" → 1
  items = mapSubformToItems([{ Product_Code: 'mr36-hw', Quantity: 2.6 }]);
  ok(items[0].qty === 3, 'Quantity 2.6 → rounded to 3');
  ok(items[0].sku === 'MR36-HW', 'lowercase product code uppercased to MR36-HW');

  items = mapSubformToItems([{ Product_Code: 'MT10', Quantity: '7' }]);
  ok(items[0].qty === 7, 'string "7" qty coerced to 7');

  // qty missing / zero / NaN → defaults to 1
  items = mapSubformToItems([{ Product_Code: 'MG41', Quantity: 0 }]);
  ok(items[0].qty === 1, 'Quantity 0 → default 1');
  items = mapSubformToItems([{ Product_Code: 'Z3', Quantity: undefined }]);
  ok(items[0].qty === 1, 'Quantity undefined → default 1');

  console.log('All four modules’ subforms map identically (rows are module-agnostic)');

  // The mapper is module-agnostic — verify it works on representative rows
  // sourced from each module's subform field shape.
  const quoteRows    = [{ Product_Code: 'MX67-HW', Quantity: 1 }];                                  // Quoted_Items
  const orderRows    = [{ Product_Name: { Product_Code: 'MS120-8-HW', name: 'MS120' }, Quantity: 2 }]; // Ordered_Items
  const invoiceRows  = [{ Product_Name: { name: 'C9300-24T switch' }, Quantity: 4 }];                // Invoiced_Items
  const purchaseRows = [{ Product_Code: 'PWR-C5-125WAC', Quantity: 6 }];                             // Purchase_Items
  ok(mapSubformToItems(quoteRows)[0].sku === 'MX67-HW', 'Quotes/Quoted_Items row → MX67-HW');
  ok(mapSubformToItems(orderRows)[0].sku === 'MS120-8-HW', 'Sales_Orders/Ordered_Items row → MS120-8-HW');
  ok(mapSubformToItems(invoiceRows)[0].sku === 'C9300-24T', 'Invoices/Invoiced_Items row → C9300-24T (regex)');
  ok(mapSubformToItems(purchaseRows)[0].sku === 'PWR-C5-125WAC', 'Purchase_Orders/Purchase_Items row → PWR-C5-125WAC');

  console.log('No-margin invariant: output is strictly {sku, qty}');

  // Even when the raw row carries price/margin fields, they must NEVER pass through.
  items = mapSubformToItems([
    { Product_Code: 'MR44-HW', Quantity: 2, Unit_Price: 1299, List_Price: 1499, Net_Total: 2598, Discount: 200, margin: 0.18 },
    { Product_Name: { name: 'MX85 appliance' }, Quantity: 1, Total: 4200, Amount: 4200 },
  ]);
  ok(items.length === 2, 'priced rows still produce 2 items');
  ok(onlySkuQty(items), 'every emitted item has EXACTLY {sku, qty} keys');
  ok(hasNoPriceKey(items), 'NO price/margin key leaked into output (no-margin invariant)');

  console.log('Defensive: bad input never throws');
  ok(Array.isArray(mapSubformToItems(null)) && mapSubformToItems(null).length === 0, 'null rows → []');
  ok(mapSubformToItems(undefined).length === 0, 'undefined rows → []');
  ok(mapSubformToItems('not-an-array').length === 0, 'non-array rows → []');
  ok(mapSubformToItems([null, undefined, 42, 'x', { Product_Code: 'MR28', Quantity: 1 }]).length === 1, 'junk entries skipped, valid one kept');

  console.log('Subform-field map + allowed modules');
  ok(ZOHO_QUOTE_ITEMS_SUBFORM_FIELD.Quotes === 'Quoted_Items', 'Quotes → Quoted_Items');
  ok(ZOHO_QUOTE_ITEMS_SUBFORM_FIELD.Sales_Orders === 'Ordered_Items', 'Sales_Orders → Ordered_Items');
  ok(ZOHO_QUOTE_ITEMS_SUBFORM_FIELD.Invoices === 'Invoiced_Items', 'Invoices → Invoiced_Items');
  ok(ZOHO_QUOTE_ITEMS_SUBFORM_FIELD.Purchase_Orders === 'Purchase_Items', 'Purchase_Orders → Purchase_Items');
  ok(ZOHO_QUOTE_ITEMS_ALLOWED_MODULES.length === 4
     && ['Quotes', 'Sales_Orders', 'Invoices', 'Purchase_Orders'].every(m => ZOHO_QUOTE_ITEMS_ALLOWED_MODULES.includes(m)),
    'allowed modules = exactly the 4 quotable modules');
  ok(!ZOHO_QUOTE_ITEMS_ALLOWED_MODULES.includes('Accounts') && !ZOHO_QUOTE_ITEMS_ALLOWED_MODULES.includes('Deals'),
    'Accounts/Deals NOT in allowed set (rejection set proven)');

  // ── Source-guards: endpoint shape, auth gate, no price/margin keys ──
  console.log('Source-guards (endpoint placement + auth + no-price)');
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

  // 1. Endpoint exists as a switch case.
  const epIdx = src.indexOf("case '/api/zoho-quote-items':");
  ok(epIdx > -1, "case '/api/zoho-quote-items' exists");

  // 2. It is INSIDE the gated /api/* block. The gate (rejects unless gwSecret or
  //    GMAIL_ADDON_API_KEY) lives at the top of `if (url.pathname.startsWith('/api/'))`,
  //    and the switch dispatch follows it. Prove the endpoint sits AFTER the gate
  //    and INSIDE the same `switch (url.pathname)` that all other /api/* cases use.
  const gateIdx = src.indexOf('if (!isBenchmark && !gwSecretOk && !apiKeyOk) {');
  const switchIdx = src.indexOf('switch (url.pathname) {');
  const switchDefaultIdx = src.indexOf("default:\n            return new Response(JSON.stringify({ error: 'Unknown endpoint: '");
  ok(gateIdx > -1 && switchIdx > gateIdx, 'X-API-Key/gateway gate precedes the /api/* switch');
  ok(epIdx > switchIdx && (switchDefaultIdx === -1 || epIdx < switchDefaultIdx),
    'endpoint sits inside the gated switch, before its default (so it IS auth-gated)');

  // 3. The endpoint block must not reference any price/margin field name.
  const epBlock = src.slice(epIdx, src.indexOf("case '/api/ccw-lookup':", epIdx));
  ok(epBlock.length > 0, 'endpoint block isolated for inspection');
  const forbidden = /\b(Unit_Price|List_Price|Net_Total|Grand_Total|Sub_Total|margin|Margin|Discount|Amount)\b/;
  ok(!forbidden.test(epBlock), 'endpoint block references NO price/margin field');

  // 4. Endpoint requests only id, Subject, and the subform field (no pricing).
  ok(/fields=id,Subject,\$\{subformField\}/.test(epBlock), 'fetch requests only id,Subject,<subform> (no price fields)');

  // 5. The mapper itself never names a price/margin field.
  const mapIdx = src.indexOf('function mapSubformToItems(rows)');
  const mapBlock = src.slice(mapIdx, src.indexOf('\n}', mapIdx) + 2);
  ok(mapIdx > -1 && !forbidden.test(mapBlock), 'mapSubformToItems body references NO price/margin field');

    // Faithful order URL: the endpoint builds it via buildStratusUrl(items) — exact
  // SKUs+qtys joined, NO engine round-trip (which dropped EOL-flagged MS225 lines).
  {
    const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
    ok(/const orderUrl = items\.length \? buildStratusUrl\(items\) : null;/.test(src),
      'endpoint builds a faithful orderUrl via buildStratusUrl (no resolving engine)');
    ok(/JSON\.stringify\(\{ items, orderUrl, module, recordId, recordName/.test(src),
      'endpoint response includes orderUrl');
  }

console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
