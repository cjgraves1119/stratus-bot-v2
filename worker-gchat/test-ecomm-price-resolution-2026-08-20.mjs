/**
 * Ecomm price resolution, everywhere it happens (2026-08-20).
 *
 * Two defects were found in the Quote Line Editor's ecomm matching and then
 * traced through the rest of the worker. This file pins EVERY site so neither
 * can come back somewhere else:
 *
 *   1. DUPLICATE VARIATION ROWS. WooProducts holds one row per WooCommerce
 *      variation, and they disagree on price. LIC-ENT-1YR really has rows at
 *      $117 last touched 2025-02-24 and rows at $116 last touched 2026-08-07.
 *      Any `.find(...)` / first-row-wins selection returns an arbitrary one.
 *
 *   2. CANONICALIZED SKU SUBSTITUTION. applySuffix appends -HW to any /^MS\d/
 *      SKU (MS150 was special-cased out; MS130 was not). MS130-48X becomes
 *      MS130-48X-HW, which has no WooProducts row, so the lookup fell through
 *      to the price cache and returned $5,474 from a DIFFERENT Zoho product
 *      (id ...182445404, list $9,428) for a line whose product (id
 *      ...390014574) lists at $10,625.63 and sells at $4,947. Six units read
 *      $32,844 instead of $29,682.
 *
 * The sites, all in src/index.js:
 *   A  fetchLiveSkuPricing        - every live ecomm lookup
 *   B  the daily price-refresh cron - WRITES the KV cache everything falls back to
 *   C  Phase 2 new-SKU discovery
 *   D  the agent's WooProducts cache intercept
 *   E  /api/quote-line-ecomm      - the Quote Line Editor endpoint
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');

/** The real duplicate rows for LIC-ENT-1YR, straight out of Zoho. */
const LIC_ENT_ROWS = [
  { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 117, Inactive: false, Modified_Time: '2025-02-24T04:21:04-08:00' },
  { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 117, Inactive: false, Modified_Time: '2025-02-24T04:33:02-08:00' },
  { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 116, Inactive: false, Modified_Time: '2026-08-07T11:30:40-07:00' },
  { WooProduct_Code: 'LIC-ENT-1YR', Stratus_Price: 999, Inactive: true, Modified_Time: '2026-08-19T00:00:00-07:00' },
];

/** The selection every site must implement: active first, then newest. */
function newestActive(rows, code) {
  const candidates = rows.filter((r) =>
    r.WooProduct_Code === code && !r.WooProduct_Code.includes('+') && Number(r.Stratus_Price) > 0);
  const active = candidates.filter((r) => r.Inactive !== true);
  return (active.length ? active : candidates)
    .slice()
    .sort((a, b) => String(b.Modified_Time || '').localeCompare(String(a.Modified_Time || '')))[0];
}

function slice(from, to) {
  const start = SOURCE.indexOf(from);
  assert.notEqual(start, -1, `anchor not found: ${from}`);
  const end = SOURCE.indexOf(to, start);
  assert.notEqual(end, -1, `end anchor not found: ${to}`);
  return SOURCE.slice(start, end);
}

test('the agreed selection picks the newest ACTIVE row regardless of input order', () => {
  assert.equal(newestActive(LIC_ENT_ROWS, 'LIC-ENT-1YR').Stratus_Price, 116);
  assert.equal(newestActive([...LIC_ENT_ROWS].reverse(), 'LIC-ENT-1YR').Stratus_Price, 116);
  // The newest row overall is INACTIVE and must lose to the newest active one.
  assert.notEqual(newestActive(LIC_ENT_ROWS, 'LIC-ENT-1YR').Stratus_Price, 999);
  // All-inactive still yields something rather than nothing.
  const allDead = LIC_ENT_ROWS.map((r) => ({ ...r, Inactive: true }));
  assert.equal(newestActive(allDead, 'LIC-ENT-1YR').Stratus_Price, 999);
});

test('A: fetchLiveSkuPricing selects deterministically and guards the cache fallback', () => {
  const fn = slice('async function fetchLiveSkuPricing(', 'async function fetchEcommPriceByExactCode(');
  assert.doesNotMatch(fn, /const wooMatch = wooData\.find\(/, 'first-row-wins must be gone');
  assert.match(fn, /Inactive !== true/);
  assert.match(fn, /localeCompare/);
  assert.match(fn, /fields=WooProduct_Code,Stratus_Price,Inactive,Modified_Time/);
  assert.match(fn, /per_page=200/);

  // Defect 2: retry under the product's own code BEFORE trusting the cache.
  assert.match(fn, /fetchEcommPriceByExactCode\(productCodeEarly, env\)/);
  assert.ok(fn.indexOf('productCodeEarly, env') < fn.indexOf('let _wooFromCache'),
    'the exact retry must come before the cache fallback');
  // ...and refuse a cached price whose list price says it is another product.
  assert.match(fn, /const listMismatch/);
  assert.match(fn, /REFUSING cached ecomm/);
  assert.match(fn, /_resolved_under/);
  // Never average disagreeing prices.
  assert.doesNotMatch(fn, /reduce\(\(sum|\/ wooPool\.length/);
});

test('B: the daily price-refresh cron does not write an arbitrary duplicate into KV', () => {
  // This one matters most: it WRITES the cache every other site falls back to,
  // so an arbitrary pick here poisons everything downstream for a day.
  const fn = slice('[PRICE-CRON] Refreshing ${skuList.length} SKUs', 'PHASE 2: New SKU discovery');
  assert.doesNotMatch(fn, /result\.data\.find\(r =>/, 'first-row-wins must be gone');
  assert.match(fn, /const wooActiveRows = wooRows\.filter\(r => r\.Inactive !== true\)/);
  assert.match(fn, /localeCompare/);
  assert.match(fn, /const match = wooSorted\[0\]/);
  assert.match(fn, /fields=WooProduct_Code,Stratus_Price,Inactive,Modified_Time/);
  assert.match(fn, /different prices/, 'a disagreement must be logged, not hidden');
});

test('C: Phase 2 SKU discovery keeps the newest active row per code', () => {
  const fn = slice('PHASE 2: New SKU discovery', 'Find SKUs in WooProducts but not in prices.json');
  assert.doesNotMatch(fn, /if \(!allWooSkus\[code\]\) allWooSkus\[code\] = price;/,
    'first-row-wins must be gone');
  assert.match(fn, /allWooSkusMeta/);
  assert.match(fn, /Inactive !== true/);
  assert.match(fn, /localeCompare/);
  assert.match(fn, /fields=WooProduct_Code,Stratus_Price,Inactive,Modified_Time/);
});

test('D: the agent cache intercept never passes off a substituted SKU as an exact hit', () => {
  const fn = slice('INTERCEPT: Redirect WooProducts lookups through batch cache', 'const params = new URLSearchParams()');
  assert.match(fn, /const substituted = suffixed !== sku/);
  assert.match(fn, /_requested_code: sku/);
  assert.match(fn, /_resolved_under: suffixed/);
  assert.match(fn, /these can be different Zoho products with different prices/);
});

test('E: the Quote Line Editor endpoint resolves the exact line SKU first', () => {
  const fn = slice("case '/api/quote-line-ecomm': {", "case '/api/zoho-quote-items': {");
  assert.match(fn, /await fetchEcommPriceByExactCode\(sku, env\)/);
  assert.ok(fn.indexOf('fetchEcommPriceByExactCode') < fn.indexOf('await fetchLiveSkuPricing'));
  assert.match(fn, /listGap > 0\.02/);
  assert.match(fn, /resolvedUnder/);
});

test('no live ecomm lookup anywhere still uses first-row-wins on WooProducts', () => {
  // A sweep rather than a per-site check, so a NEW site cannot reintroduce it.
  //
  // Comments are stripped first: the fixes deliberately DOCUMENT the old
  // `wooData.find(...)` shape so the next reader knows what went wrong, and a
  // raw text sweep would flag that explanation as the bug itself.
  const code = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
  const offenders = [];
  const patterns = [
    /\.data\.find\(\s*r(ecord)?\s*=>\s*r(ecord)?\.WooProduct_Code/g,
    /wooData\.find\(/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      offenders.push(code.slice(Math.max(0, match.index - 60), match.index + 80).replace(/\s+/g, ' '));
    }
  }
  assert.deepEqual(offenders, [], `first-row-wins WooProducts selection found:\n${offenders.join('\n')}`);
});

test('the refresh cron surfaces cache keys that no longer have a storefront row', () => {
  // The ROOT CAUSE of the stale price. A cache key with no WooProducts row
  // makes the refresh return early, so its price AND list stay frozen forever
  // with nothing reporting it. MS130-48X-HW sat at list $9,428 / ecomm $5,474
  // while the real product moved to $10,625.63 / $4,947, and applySuffix kept
  // routing MS130-48X straight to that dead key.
  const fn = slice('const priceChanges = []', 'PHASE 2: New SKU discovery');
  assert.match(fn, /const orphanedSkus = \[\]/);
  assert.match(fn, /orphanedSkus\.push\(\{ sku, price: existing\?\.price/);
  assert.match(fn, /frozen at their last known price/);
  // And it reaches the dashboard payload, not just the log.
  const kv = slice('PHASE 4: Write results to KV', 'refreshedAt: new Date().toISOString()');
  assert.ok(SOURCE.includes('orphanedSkus: orphanedSkus.length'), 'the count must reach the KV stats');
  assert.ok(SOURCE.includes('orphanedSkuList'), 'the list must reach the KV stats');
});

test('the MS130-48X arithmetic, end to end', () => {
  // The reported symptom and the correct answer, kept as plain numbers so the
  // regression is legible without reading any code.
  const qty = 6;
  const wrongEcomm = 5474;   // MS130-48X-HW, a different product (list 9428)
  const rightEcomm = 4947;   // MS130-48X, the product actually on the quote
  assert.equal(qty * wrongEcomm, 32844, 'what the extension showed');
  assert.equal(qty * rightEcomm, 29682, 'what it should show');

  // The list-price gap is what makes the substitution detectable.
  const cachedList = 9428;
  const liveList = 10625.63;
  assert.ok(Math.abs(cachedList - liveList) / liveList > 0.02,
    'the guard threshold must catch this substitution');
  // ...while a benign rounding drift must NOT trip it.
  assert.ok(Math.abs(200 - 200.7) / 200.7 < 0.02,
    'a 200 vs 200.70 list drift is not a different product');
});
