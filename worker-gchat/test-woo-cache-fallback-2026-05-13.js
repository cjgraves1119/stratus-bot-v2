#!/usr/bin/env node
// 2026-05-13 regression: fetchLiveSkuPricing falls back to embedded
// prices.json cache when live WooProducts returns 0 rows (the gap case).
// Codex B1 cleanup symptom: MS130-24P-HW present in prices.json but missing
// from Zoho WooProducts module, hard gate blocked the entire quote.
//
// Source-level checks plus a simulation of the function body in isolation
// (Zoho stub) to confirm the three behaviors:
//   1. Cache fallback fires when live succeeds with empty result.
//   2. Cache fallback does NOT fire when live rejects (rate limit, etc).
//   3. Cache fallback does NOT fire when live returns a real value (parity).

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Source-level wiring ===\n');

t('Cache fallback block exists', () => {
  assert.ok(
    /Cache fallback for missing-in-WooProducts SKUs/.test(source),
    'cache-fallback comment block missing'
  );
});

t('Fallback gated on wooResult.status === "fulfilled"', () => {
  assert.ok(
    /if \(!\(ecommPrice > 0\) && wooResult\.status === 'fulfilled'\)/.test(source),
    'fallback must require live call to have SUCCEEDED with zero rows; rejected calls must still fail loud'
  );
});

t('Fallback reads prices Proxy by suffixed and raw SKU', () => {
  assert.ok(
    /prices\[suffixed\] \|\| prices\[sku\]/.test(source),
    'fallback must consult the embedded prices Proxy'
  );
});

t('_woo_from_cache flag is exposed on success return', () => {
  assert.ok(
    /_woo_from_cache: _wooFromCache \|\| undefined/.test(source),
    'success payload must include _woo_from_cache flag for telemetry'
  );
});

t('Fallback warns to console for backfill visibility', () => {
  assert.ok(
    /WooProducts has no live record for \$\{suffixed\}; falling back to embedded cache/.test(source),
    'warn message must surface so the team can backfill'
  );
});

t('List-price cache fallback fires only when ecomm-cache was used', () => {
  assert.ok(
    /if \(resolvedListPrice == null && _wooFromCache\)/.test(source),
    'list-price cache fallback must be gated on _wooFromCache to avoid silently mixing live ecomm with cached list'
  );
});

console.log('\n=== Behavioral simulation ===\n');

// Reconstruct a minimal version of the function in isolation. We can't run
// the real one without the whole worker. The point is to verify the
// CONDITIONAL behavior of the fallback logic.

function buildFn() {
  const prices = {
    'MS130-24P-HW': { list: 3443, price: 1999 },
    'LIC-MS130-24-1Y': { list: 173, price: 91 },
    'KNOWN-SKU': { list: 100, price: 50 }
  };
  const moneyValue = (v) => {
    if (v == null || v === '') return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  };
  const roundMoney = (v) => Math.round(v * 100) / 100;

  async function fetchLiveSkuPricing({ sku, wooStatus, wooData, productData, productStatus = 'fulfilled' }) {
    const suffixed = sku;
    const wooMatch = (wooData || []).find(r => r.WooProduct_Code === suffixed);
    let ecommPrice = moneyValue(wooMatch?.Stratus_Price);

    let _wooFromCache = false;
    if (!(ecommPrice > 0) && wooStatus === 'fulfilled') {
      const cached = prices[suffixed] || prices[sku];
      const cachedEcomm = moneyValue(cached?.price);
      if (cachedEcomm > 0) {
        ecommPrice = cachedEcomm;
        _wooFromCache = true;
      }
    }
    if (!(ecommPrice > 0)) {
      return {
        success: false,
        sku: suffixed,
        error: wooStatus === 'rejected'
          ? `Live WooProducts lookup failed`
          : 'Live WooProducts Stratus_Price was not found'
      };
    }

    const productRecord = (productData || []).find(r => r.Product_Code === suffixed);
    const listPrice = moneyValue(productRecord?.Unit_Price);
    let resolvedListPrice = listPrice > 0 ? roundMoney(listPrice) : null;
    if (resolvedListPrice == null && _wooFromCache) {
      const cached = prices[suffixed] || prices[sku];
      const cachedList = moneyValue(cached?.list);
      if (cachedList > 0) resolvedListPrice = roundMoney(cachedList);
    }

    return {
      success: true,
      sku: suffixed,
      ecomm_price: roundMoney(ecommPrice),
      list_price: resolvedListPrice,
      _woo_from_cache: _wooFromCache || undefined
    };
  }

  return fetchLiveSkuPricing;
}

const fn = buildFn();

t('SCENARIO 1: live success + 0 rows → cache fallback fires (the bug fix)', async () => {
  const out = await fn({
    sku: 'MS130-24P-HW',
    wooStatus: 'fulfilled',
    wooData: [],
    productData: []
  });
  assert.equal(out.success, true, 'must succeed via cache fallback');
  assert.equal(out.ecomm_price, 1999, 'must use cached ecomm price');
  assert.equal(out.list_price, 3443, 'must use cached list price (Products module also empty)');
  assert.equal(out._woo_from_cache, true, 'flag must indicate cache fallback was used');
});

t('SCENARIO 2: live success + real ecomm row → no fallback, parity guard preserved', async () => {
  const out = await fn({
    sku: 'KNOWN-SKU',
    wooStatus: 'fulfilled',
    wooData: [{ WooProduct_Code: 'KNOWN-SKU', Stratus_Price: 47.50 }],  // different from cached $50
    productData: [{ Product_Code: 'KNOWN-SKU', Unit_Price: 100 }]
  });
  assert.equal(out.success, true);
  assert.equal(out.ecomm_price, 47.50, 'live ecomm must win over cache when present');
  assert.equal(out._woo_from_cache, undefined, 'flag must NOT be set when live had a record');
  assert.equal(out.list_price, 100, 'live list_price must win over cache');
});

t('SCENARIO 3: live rejected (rate limit etc) → NO fallback, fail loud', async () => {
  const out = await fn({
    sku: 'MS130-24P-HW',
    wooStatus: 'rejected',
    wooData: [],
    productData: []
  });
  assert.equal(out.success, false, 'rejected live must still fail');
  assert.match(out.error, /Live WooProducts lookup failed/);
});

t('SCENARIO 4: live success + 0 rows + SKU not in cache → still fails loud', async () => {
  const out = await fn({
    sku: 'UNKNOWN-RANDOM-SKU',
    wooStatus: 'fulfilled',
    wooData: [],
    productData: []
  });
  assert.equal(out.success, false, 'must fail when neither live nor cache has the SKU');
  assert.match(out.error, /Stratus_Price was not found/);
});

t('SCENARIO 5: cache fallback fires for LIC-MS130-24-1Y too', async () => {
  const out = await fn({
    sku: 'LIC-MS130-24-1Y',
    wooStatus: 'fulfilled',
    wooData: [],
    productData: []
  });
  assert.equal(out.success, true);
  assert.equal(out.ecomm_price, 91);
  assert.equal(out.list_price, 173);
  assert.equal(out._woo_from_cache, true);
});

// Drain async test promises
setTimeout(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 200);
