// Deterministic one-shot product snapshot, HA policy, replan reuse, and
// enrichment comparison regressions (2026-08-17).
// Run: node test-oneshot-product-snapshot-2026-08-17.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
const WRANGLER = fs.readFileSync(path.join(__dirname, 'wrangler.toml'), 'utf8');
assert.match(SRC, /create_followup_task: false/, 'extension one-shot must request quote-only execution');
assert.match(SRC, /Skipped follow-up Task \(extension quote-only review\)/, 'reviewed extension quote must not create a hidden Task');
let pass = 0;
let fail = 0;
const check = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (error) { fail++; console.log(`  ✗ ${name}\n      ${error.stack || error.message}`); }
};

function grab(name) {
  let start = SRC.indexOf(`async function ${name}(`);
  if (start === -1) start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let paren = SRC.indexOf('(', start), pDepth = 0, body = -1;
  for (let i = paren; i < SRC.length; i++) {
    if (SRC[i] === '(') pDepth++;
    else if (SRC[i] === ')' && --pDepth === 0) { body = SRC.indexOf('{', i); break; }
  }
  let depth = 0;
  for (let i = body; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function grabConst(name, end = ';') {
  const start = SRC.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `${name} not found`);
  const finish = SRC.indexOf(end, start);
  assert.ok(finish > start, `${name} end not found`);
  return SRC.slice(start, finish + end.length);
}

function loadProductHelpers() {
  const m = { exports: {} };
  const staticPrices = {
    'MX75-HW': { zoho_product_id: '2570562000000000001', zoho_active: true },
    'LIC-MX75-SEC-1Y': { zoho_product_id: '2570562000000000002', zoho_active: true },
    'LIC-MX75-SEC-3Y': { zoho_product_id: '2570562000000000003', zoho_active: true },
    'LIC-MX75-SEC-5Y': { zoho_product_id: '2570562000000000004', zoho_active: true },
    'LIC-MX75-ENT-1Y': { zoho_product_id: '2570562000000000006', zoho_active: true },
    'LIC-MX75-ENT-3Y': { zoho_product_id: '2570562000000000007', zoho_active: true },
    'LIC-MX75-ENT-5Y': { zoho_product_id: '2570562000000000008', zoho_active: true },
    'LIC-MX85-ENT-3Y': { zoho_product_id: '2570562000000000009', zoho_active: true },
    'MX85-HW': { zoho_product_id: '2570562000000000010', zoho_active: true },
    'MX105-HW': { zoho_product_id: '2570562000000000011', zoho_active: true },
    'LIC-MX85-ENT-5Y': { zoho_product_id: '2570562000000000012', zoho_active: true },
    'LIC-MX105-ENT-5Y': { zoho_product_id: '2570562000000000013', zoho_active: true },
    'LIC-MV-3YR': { zoho_product_id: '2570562000000000005', zoho_active: true },
  };
  const code = [
    `const pricesData = {_meta:{last_updated:'2026-08-17'}};`,
    `const catalogData = {_generated:'2026-08-17'};`,
    `const staticPrices = __staticPrices;`,
    `const prices = staticPrices;`,
    `const base64url = (value) => Buffer.from(typeof value === 'string' ? value : new Uint8Array(value)).toString('base64url');`,
    `const applySuffix = (sku) => { const u=String(sku).toUpperCase(); return ['MX75','MX85','MX105'].includes(u) ? u+'-HW' : u; };`,
    `const resolveCatalogSku = (sku) => String(sku).toUpperCase();`,
    `const getLicenseSkus = (sku, tier) => {
      const u=String(sku).toUpperCase();
      const m=u.match(/^MX(75|85|105)/);
      if (m) return ['1','3','5'].map((n) => ({term:n+'Y',sku:'LIC-MX'+m[1]+'-'+(tier||'SEC')+'-'+n+'Y'}));
      return null;
    };`,
    `const isEol = (sku) => String(sku).toUpperCase() === 'MV22';`,
    `const EOL_REPLACEMENTS = {MV22:'MV63'};`,
    grab('agnosticRenewalFamily'),
    grab('collapseAgnosticRenewalSkus'),
    grab('canonicalOneshotSkus'),
    grabConst('ONESHOT_PRODUCT_SNAPSHOT_VERSION'),
    grabConst('ONESHOT_PRODUCT_SNAPSHOT_TTL_MS'),
    grabConst('ONESHOT_HA_MODES'),
    grabConst('ONESHOT_HA_MX_MODELS', ']);'),
    grab('normalizeOneshotHaMode'),
    grab('oneshotCatalogVersion'),
    grab('oneshotProductRequestDescriptor'),
    grab('hashOneshotValue'),
    grab('oneshotProductRequestFingerprint'),
    grab('oneshotLicenseStem'),
    grab('oneshotLicenseTerm'),
    grab('canonicalOneshotCatalogSku'),
    grab('isSupportedOneshotHaHardware'),
    grab('selectOneshotLicenseSku'),
    grab('aggregateOneshotLines'),
    grab('orderOneshotProductRows'),
    grab('oneshotExplicitLicenseMatchesHardware'),
    // Per-line "None (hardware only)" support (2026-08-19).
    grabConst('ONESHOT_COMPOSITION_HARDWARE_BASE'),
    grab('canonicalOneshotCompositionSku'),
    grab('oneshotHardwareOnlyKeys'),
    grab('oneshotLineIsHardwareOnly'),
    grab('oneshotProductPricingBlocker'),
    grab('quotedItemsFromOneshotProductRows'),
    grab('isLicenseExemptAccessorySku'),
    grab('expandOneshotRequestedProducts'),
    grab('publicOneshotProductLines'),
    grab('oneshotProductBlockersFromSnapshot'),
    `let __activeEcommSkus = new Set();`,
    `let __activeEcommLookupError = null;`,
    `const lookupActiveEcommSkus = async () => { if (__activeEcommLookupError) throw new Error(__activeEcommLookupError); return { ok: true, skus: new Set(__activeEcommSkus) }; };`,
    `let __liveZohoProducts = new Map();`,
    `const lookupLiveZohoProductsByIds = async (ids) => ({ ok: true, products: new Map((ids || []).map((id) => [String(id), __liveZohoProducts.get(String(id))]).filter(([, row]) => row)) });`,
    grab('buildOneshotProductSnapshot'),
    grab('validateOneshotProductSnapshotForExecute'),
    `let __prior = null;`,
    `const readOneshotReviewToken = async () => __prior;`,
    grab('resolveOneshotProductPlan'),
    grab('normalizeOneshotAccountPrefill'),
    grab('oneshotEnrichmentCandidate'),
    grab('compareOneshotEnrichment'),
    `module.exports = {
      canonicalOneshotSkus, oneshotCatalogVersion, expandOneshotRequestedProducts,
      buildOneshotProductSnapshot, validateOneshotProductSnapshotForExecute,
      resolveOneshotProductPlan, compareOneshotEnrichment,
      normalizeOneshotAccountPrefill, oneshotEnrichmentCandidate,
      orderOneshotProductRows, oneshotProductPricingBlocker, quotedItemsFromOneshotProductRows,
      setPrior(value){ __prior = value; },
      setActiveEcommSkus(values){ __activeEcommSkus = new Set(values || []); },
      setActiveEcommLookupError(value){ __activeEcommLookupError = value ? String(value) : null; },
      setLiveZohoProducts(values){ __liveZohoProducts = new Map((values || []).map((row) => [String(row.id), row])); },
      staticPrices,
    };`,
  ].join('\n');
  new Function('module', '__staticPrices', 'Buffer', code)(m, staticPrices, Buffer);
  return m.exports;
}

const H = loadProductHelpers();
const baseInput = {
  skus: [{ sku: 'MX75', qty: 2 }],
  license_term: '3',
  include_licenses: true,
  ha_mode: 'standard',
};

function lookupSpy() {
  const calls = [];
  const fn = async (tool, input) => {
    calls.push({ tool, input });
    assert.strictEqual(tool, 'batch_product_lookup', 'plan may invoke only the one read-only batch lookup');
    const products = {};
    let index = 10;
    for (const line of input.skus) {
      products[line.sku] = {
        found: true,
        suffixed_sku: line.sku === 'MX75' ? 'MX75-HW' : line.sku,
        product_id: `2570562000000000${String(index++).padStart(3, '0')}`,
        product_active: true,
        list_price: 100,
        ecomm_price: 90,
        discount_per_unit: 10,
      };
    }
    return { success: true, products };
  };
  return { fn, calls };
}

(async () => {
  console.log('\n(1) canonical product request + deterministic HA policy');

  await check('canonical lines merge duplicates and sort', () => {
    assert.deepStrictEqual(H.canonicalOneshotSkus([
      { sku: 'mx75', qty: 1 }, { sku: 'LIC-X', qty: 2 }, { sku: 'MX75', qty: 3 },
    ]), [{ sku: 'LIC-X', qty: 2 }, { sku: 'MX75', qty: 4 }]);
  });

  await check('direct review rows bind per-line tiers and generate the selected license SKUs', () => {
    assert.deepStrictEqual(H.canonicalOneshotSkus([
      { sku: 'mx75', qty: 1, tier: 'enterprise' },
      { sku: 'MX75', qty: 2, tier: 'ENT' },
      { sku: 'MX75', qty: 1, tier: 'SEC' },
    ]), [
      { sku: 'MX75', qty: 3, tier: 'ENT' },
      { sku: 'MX75', qty: 1, tier: 'SEC' },
    ]);
    const expanded = H.expandOneshotRequestedProducts({
      ...baseInput,
      skus: [
        { sku: 'MX75', qty: 2, tier: 'ENT' },
        { sku: 'MX75', qty: 1, tier: 'SEC' },
      ],
    });
    assert.strictEqual(expanded.success, true, JSON.stringify(expanded.blockers));
    assert.deepStrictEqual(expanded.lines, [
      { sku: 'MX75', qty: 3 },
      { sku: 'LIC-MX75-ENT-3Y', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 1 },
    ]);
  });

  await check('standard mode auto-adds one license per device', () => {
    const result = H.expandOneshotRequestedProducts(baseInput);
    assert.strictEqual(result.success, true, JSON.stringify(result.blockers));
    assert.deepStrictEqual(result.lines, [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 2 },
    ]);
  });

  await check('Catalyst stack kits, power supplies, and SFPs never auto-add licences', () => {
    const result = H.expandOneshotRequestedProducts({
      ...baseInput,
      skus: [
        { sku: 'C9300L-STAK-KIT2-M', qty: 2 },
        { sku: 'PWR-C1-715WAC-P-M', qty: 2 },
        { sku: 'MA-SFP-10GB-SR-AO', qty: 2 },
      ],
    });
    assert.strictEqual(result.success, true, JSON.stringify(result.blockers));
    assert.deepStrictEqual(result.lines, [
      { sku: 'C9300L-STAK-KIT2-M', qty: 2 },
      { sku: 'MA-SFP-10GB-SR-AO', qty: 2 },
      { sku: 'PWR-C1-715WAC-P-M', qty: 2 },
    ]);
    assert.ok(!result.lines.some((line) => line.sku.startsWith('LIC-')));
  });

  await check('explicit compatible MX ENT tier suppresses default SEC in either input order', () => {
    const expected = [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-ENT-3Y', qty: 2 },
    ];
    for (const skus of [
      [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-ENT-3Y', qty: 2 }],
      [{ sku: 'LIC-MX75-ENT-3Y', qty: 2 }, { sku: 'MX75', qty: 2 }],
    ]) {
      const result = H.expandOneshotRequestedProducts({ ...baseInput, skus });
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.lines, expected);
      assert.ok(!result.lines.some((line) => line.sku === 'LIC-MX75-SEC-3Y'));
    }
  });

  await check('reviewed paired versus standalone license intent is signed and counted exactly once or additively', () => {
    const pairedInput = {
      ...baseInput,
      skus: [
        { sku: 'MX75', qty: 2 },
        { sku: 'LIC-MX75-SEC-3Y', qty: 2, licenseIntent: 'paired' },
      ],
    };
    assert.deepStrictEqual(H.canonicalOneshotSkus(pairedInput.skus), [
      { sku: 'LIC-MX75-SEC-3Y', qty: 2, license_intent: 'paired' },
      { sku: 'MX75', qty: 2 },
    ]);
    assert.deepStrictEqual(H.expandOneshotRequestedProducts(pairedInput).lines, [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 2 },
    ]);

    const standaloneInput = {
      ...baseInput,
      skus: [
        { sku: 'MX75', qty: 2 },
        { sku: 'LIC-MX75-SEC-3Y', qty: 2, licenseIntent: 'standalone' },
      ],
    };
    assert.deepStrictEqual(H.expandOneshotRequestedProducts(standaloneInput).lines, [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 4 },
    ]);

    const invalid = H.expandOneshotRequestedProducts({
      ...baseInput,
      skus: [{ sku: 'LIC-MX75-SEC-3Y', qty: 2, licenseIntent: 'guessed' }],
    });
    assert.strictEqual(invalid.success, false);
    assert.ok(invalid.blockers.some((blocker) => blocker.code === 'invalid_license_intent'));
  });

  await check('ambiguous, wrong-model, wrong-term, and wrong-quantity explicit MX licenses block before lookup', async () => {
    const cases = [
      {
        code: 'explicit_license_ambiguous',
        skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-ENT-3Y', qty: 2 }, { sku: 'LIC-MX75-SEC-3Y', qty: 2 }],
      },
      {
        code: 'explicit_license_family_conflict',
        skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX85-ENT-3Y', qty: 2 }],
      },
      {
        code: 'explicit_license_term_conflict',
        skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-ENT-5Y', qty: 2 }],
      },
      {
        code: 'explicit_license_quantity_conflict',
        skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-ENT-3Y', qty: 1 }],
      },
    ];
    for (const scenario of cases) {
      const expanded = H.expandOneshotRequestedProducts({ ...baseInput, skus: scenario.skus });
      assert.strictEqual(expanded.success, false, scenario.code);
      assert.ok(expanded.blockers.some((blocker) => blocker.code === scenario.code), scenario.code);
      const spy = lookupSpy();
      const planned = await H.buildOneshotProductSnapshot({ ...baseInput, skus: scenario.skus }, {}, 'oneshot:test', spy.fn);
      assert.strictEqual(planned.product_validation_count, 0, scenario.code);
      assert.strictEqual(spy.calls.length, 0, scenario.code);
    }
  });

  await check('warm spare is explicit and produces exactly 2 hardware : 1 shared license', () => {
    const result = H.expandOneshotRequestedProducts({ ...baseInput, ha_mode: 'warm_spare' });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.lines, [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 1 },
    ]);
    assert.strictEqual(result.ha.ratio, '2:1');
  });

  await check('reviewed HA selector may replace a matching cart license from 1:1 to 2:1', () => {
    const cartInput = {
      ...baseInput,
      ha_mode: 'warm_spare',
      ha_recalculate_license_qty: true,
      skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-SEC-3Y', qty: 2 }],
    };
    const result = H.expandOneshotRequestedProducts(cartInput);
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.lines, [
      { sku: 'MX75', qty: 2 },
      { sku: 'LIC-MX75-SEC-3Y', qty: 1 },
    ]);
    assert.strictEqual(result.ha.license_qty_recalculated, true);
    assert.strictEqual(result.ha.recalculation_confirmed, true);
  });

  await check('the same 1:1 cart license conflict blocks without the reviewed HA override', () => {
    const result = H.expandOneshotRequestedProducts({
      ...baseInput,
      ha_mode: 'warm_spare',
      skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-SEC-3Y', qty: 2 }],
    });
    assert.strictEqual(result.success, false);
    assert.ok(result.blockers.some((b) => b.code === 'ha_license_quantity_conflict'));
  });

  await check('multiple explicitly requested MX HA pairs preserve every model and recalculate each license independently', () => {
    const result = H.expandOneshotRequestedProducts({
      skus: [
        { sku: 'MX105', qty: 2 }, { sku: 'LIC-MX105-ENT-5Y', qty: 2 },
        { sku: 'MX85', qty: 2 }, { sku: 'LIC-MX85-ENT-5Y', qty: 2 },
      ],
      license_term: '5', ha_mode: 'warm_spare', ha_recalculate_license_qty: true,
    });
    assert.strictEqual(result.success, true, JSON.stringify(result.blockers));
    assert.deepStrictEqual(result.lines, [
      { sku: 'MX105', qty: 2 }, { sku: 'MX85', qty: 2 },
      { sku: 'LIC-MX105-ENT-5Y', qty: 1 }, { sku: 'LIC-MX85-ENT-5Y', qty: 1 },
    ]);
    assert.strictEqual(result.ha.pairs.length, 2);
    assert.deepStrictEqual(result.ha.pairs.map((pair) => [pair.hardware_sku, pair.hardware_qty, pair.shared_license_qty]), [
      ['MX105', 2, 1], ['MX85', 2, 1],
    ]);
  });

  await check('odd, unsupported, and conflicting HA inputs block before lookup', () => {
    const odd = H.expandOneshotRequestedProducts({ ...baseInput, ha_mode: 'warm_spare', skus: [{ sku: 'MX75', qty: 3 }] });
    assert.ok(odd.blockers.some((b) => b.code === 'ha_even_hardware_quantity_required'));
    const mixed = H.expandOneshotRequestedProducts({ ...baseInput, ha_mode: 'warm_spare', skus: [{ sku: 'MX75', qty: 2 }, { sku: 'MS130-48X', qty: 2 }] });
    assert.ok(mixed.blockers.some((b) => b.code === 'ha_hardware_unsupported'));
    const unsupported = H.expandOneshotRequestedProducts({ ...baseInput, ha_mode: 'warm_spare', skus: [{ sku: 'MS130-48X', qty: 2 }] });
    assert.ok(unsupported.blockers.some((b) => b.code === 'ha_hardware_unsupported'));
    const conflict = H.expandOneshotRequestedProducts({ ...baseInput, ha_mode: 'warm_spare', skus: [{ sku: 'MX75', qty: 4 }, { sku: 'LIC-MX75-SEC-3Y', qty: 1 }] });
    assert.ok(conflict.blockers.some((b) => b.code === 'ha_license_quantity_conflict'));
  });

  await check('invalid HA policy performs zero product lookups', async () => {
    const spy = lookupSpy();
    const result = await H.buildOneshotProductSnapshot(
      { ...baseInput, ha_mode: 'warm_spare', skus: [{ sku: 'MX75', qty: 3 }] },
      {}, 'oneshot:test', spy.fn
    );
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.product_validation_count, 0);
    assert.strictEqual(spy.calls.length, 0);
  });

  await check('renewal/license-only collapse happens before snapshot expansion', () => {
    const result = H.expandOneshotRequestedProducts({
      skus: [{ sku: 'MV22', qty: 2 }], renewal: true, license_only: true,
      license_term: '3', ha_mode: 'standard',
    });
    assert.strictEqual(result.success, true);
    assert.deepStrictEqual(result.lines, [{ sku: 'LIC-MV-3YR', qty: 2 }]);
    assert.ok(result.renewal_collapse);
  });

  console.log('\n(2) signed snapshot handoff invariant');

  let firstSnapshot;
  await check('new product fingerprint performs exactly one batch lookup and captures product ids', async () => {
    const spy = lookupSpy();
    const result = await H.buildOneshotProductSnapshot(baseInput, {}, 'oneshot:test', spy.fn);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.product_validation_count, 1);
    assert.strictEqual(spy.calls.length, 1);
    assert.ok(result.snapshot.lines.every((line) => /^\d{15,20}$/.test(line.product_id)));
    assert.ok(result.snapshot.catalog_version.includes('fnv1a-'));
    assert.ok(result.snapshot.catalog_hash);
    assert.ok(result.snapshot.snapshot_hash);
    firstSnapshot = result.snapshot;
  });

  await check('signed snapshot and reviewed Quoted_Items are hardware-first for both input orders', async () => {
    const snapshots = [];
    for (const skus of [
      [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-ENT-3Y', qty: 2 }],
      [{ sku: 'LIC-MX75-ENT-3Y', qty: 2 }, { sku: 'MX75', qty: 2 }],
    ]) {
      const spy = lookupSpy();
      const result = await H.buildOneshotProductSnapshot({ ...baseInput, skus }, {}, 'oneshot:test', spy.fn);
      assert.strictEqual(result.success, true);
      assert.deepStrictEqual(result.snapshot.lines.map((line) => line.input_sku), ['MX75', 'LIC-MX75-ENT-3Y']);
      const quotedItems = H.quotedItemsFromOneshotProductRows([...result.snapshot.lines].reverse());
      assert.deepStrictEqual(quotedItems.map((row) => row.Product_Name.id), [
        result.snapshot.lines[0].product_id,
        result.snapshot.lines[1].product_id,
      ]);
      snapshots.push(result.snapshot.lines.map(({ input_sku, qty }) => ({ input_sku, qty })));
    }
    assert.deepStrictEqual(snapshots[0], snapshots[1]);
  });

  await check('found and active rows without reproducible pricing block durably with zero-lookup replan', async () => {
    const spy = lookupSpy();
    const blocked = await H.buildOneshotProductSnapshot(baseInput, {}, 'oneshot:test', async (...args) => {
      const result = await spy.fn(...args);
      for (const row of Object.values(result.products)) {
        row.list_price = null;
        row.ecomm_price = null;
        row.discount_per_unit = 0;
      }
      return result;
    });
    assert.strictEqual(blocked.success, false);
    assert.ok(blocked.blockers.some((blocker) => blocker.code === 'pricing_unavailable'));
    H.setPrior({ success: true, snapshot: { product_snapshot: blocked.snapshot } });
    const replanSpy = lookupSpy();
    const replanned = await H.resolveOneshotProductPlan(
      { ...baseInput, prior_review_token: 'signed-prior', account_id: 'account-change' },
      {}, 'test@stratusinfosystems.com', 'oneshot:test', replanSpy.fn
    );
    assert.strictEqual(replanned.product_validation_count, 0);
    assert.strictEqual(replanSpy.calls.length, 0);
    assert.ok(replanned.blockers.some((blocker) => blocker.code === 'pricing_unavailable'));
    const executeCheck = await H.validateOneshotProductSnapshotForExecute(blocked.snapshot, baseInput);
    assert.strictEqual(executeCheck.error, 'product_snapshot_blocked');
    assert.ok(executeCheck.blockers.some((blocker) => blocker.code === 'pricing_unavailable'));
  });

  await check('explicit Zoho-only rows use signed list price with zero discount and cannot be introduced after review', async () => {
    const input = {
      skus: [{ sku: 'CW9174E-RTG', qty: 2 }],
      include_licenses: false,
      hardware_only: true,
      ha_mode: 'standard',
      zoho_list_price_skus: ['CW9174E-RTG'],
    };
    const lookup = async () => ({ products: {
      'CW9174E-RTG': {
        suffixed_sku: 'CW9174E-RTG', qty: 2,
        product_id: '2570562000000091740', product_active: true, found: true,
        // A stale orphan may still carry an old cached storefront price. The
        // independent Woo proof must be able to override it.
        list_price: 2495, ecomm_price: 1995, discount_per_unit: 500, discount_pct: 20,
      },
    } });
    H.setActiveEcommSkus([]);
    H.setLiveZohoProducts([{
      id: '2570562000000091740', Product_Code: 'CW9174E-RTG',
      Unit_Price: 2595.25, Product_Active: true,
    }]);
    const planned = await H.buildOneshotProductSnapshot(input, {}, 'oneshot:test', lookup);
    assert.strictEqual(planned.success, true, JSON.stringify(planned.blockers));
    assert.deepStrictEqual(planned.snapshot.lines.map((line) => ({
      sku: line.sku,
      list_price: line.list_price,
      ecomm_price: line.ecomm_price,
      discount_per_unit: line.discount_per_unit,
      zoho_only: line.zoho_only,
      pricing_source: line.pricing_source,
    })), [{
      sku: 'CW9174E-RTG', list_price: 2595.25, ecomm_price: 2595.25,
      discount_per_unit: 0, zoho_only: true, pricing_source: 'zoho_list_price',
    }]);
    const executeOk = await H.validateOneshotProductSnapshotForExecute(planned.snapshot, input);
    assert.strictEqual(executeOk.success, true, JSON.stringify(executeOk));
    const executeWithoutFallback = await H.validateOneshotProductSnapshotForExecute(planned.snapshot, {
      ...input, zoho_list_price_skus: [],
    });
    assert.strictEqual(executeWithoutFallback.error, 'product_snapshot_mismatch');

    const blocked = await H.buildOneshotProductSnapshot({
      ...input, zoho_list_price_skus: [],
    }, {}, 'oneshot:test', async () => ({ products: {
      'CW9174E-RTG': {
        suffixed_sku: 'CW9174E-RTG', qty: 2,
        product_id: '2570562000000091740', product_active: true, found: true,
        list_price: 2495, ecomm_price: null, discount_per_unit: null,
      },
    } }));
    assert.strictEqual(blocked.success, false);
    assert.ok(blocked.blockers.some((blocker) => blocker.code === 'pricing_unavailable'));

    // A forged/stale client flag cannot bypass a currently active Woo row.
    H.setActiveEcommSkus(['CW9174E-RTG']);
    const storefront = await H.buildOneshotProductSnapshot(input, {}, 'oneshot:test', lookup);
    assert.strictEqual(storefront.success, true, JSON.stringify(storefront.blockers));
    assert.strictEqual(storefront.snapshot.lines[0].zoho_only, undefined);
    assert.strictEqual(storefront.snapshot.lines[0].ecomm_price, 1995);
    assert.strictEqual(storefront.snapshot.lines[0].pricing_source, 'ecomm');
    H.setActiveEcommSkus([]);
    H.setLiveZohoProducts([]);
  });

  await check('Zoho-only rows fail closed when live Product pricing cannot be verified', async () => {
    const input = {
      skus: [{ sku: 'CW9174E-RTG', qty: 2 }],
      include_licenses: false, hardware_only: true, ha_mode: 'standard',
      zoho_list_price_skus: ['CW9174E-RTG'],
    };
    H.setActiveEcommSkus([]);
    H.setLiveZohoProducts([]);
    const blocked = await H.buildOneshotProductSnapshot(input, {}, 'oneshot:test', async () => ({ products: {
      'CW9174E-RTG': {
        suffixed_sku: 'CW9174E-RTG', qty: 2,
        product_id: '2570562000000091740', product_active: true, found: true,
        list_price: 2495, ecomm_price: 1995, discount_per_unit: 500,
      },
    } }));
    assert.strictEqual(blocked.success, false);
    assert.ok(blocked.blockers.some((blocker) => blocker.code === 'zoho_list_price_unverified'));
    assert.strictEqual(blocked.snapshot.lines[0].pricing_source, 'zoho_list_price_unverified');
    assert.strictEqual(blocked.snapshot.lines[0].ecomm_price, null);

    H.setLiveZohoProducts([{
      id: '2570562000000091740', Product_Code: 'CW9174E-RTG', Unit_Price: 2595.25,
      // Product_Active intentionally absent: missing is not affirmative proof.
    }]);
    const missingActivity = await H.buildOneshotProductSnapshot(input, {}, 'oneshot:test', async () => ({ products: {
      'CW9174E-RTG': {
        suffixed_sku: 'CW9174E-RTG', qty: 2,
        product_id: '2570562000000091740', product_active: true, found: true,
        list_price: 2495, ecomm_price: 1995, discount_per_unit: 500,
      },
    } }));
    assert.strictEqual(missingActivity.success, false);
    assert.ok(missingActivity.blockers.some((blocker) => blocker.code === 'zoho_list_price_unverified'));
    H.setLiveZohoProducts([]);
  });

  await check('Zoho-only rows fail closed when independent Woo availability proof throws', async () => {
    const input = {
      skus: [{ sku: 'MA-SFP-10GB-SR-AO', qty: 2 }],
      include_licenses: false, hardware_only: true, ha_mode: 'standard',
      zoho_list_price_skus: ['MA-SFP-10GB-SR-AO'],
    };
    H.setActiveEcommLookupError('simulated Woo availability outage');
    try {
      const blocked = await H.buildOneshotProductSnapshot(input, {}, 'oneshot:test', async () => ({ products: {
        'MA-SFP-10GB-SR-AO': {
          suffixed_sku: 'MA-SFP-10GB-SR-AO', qty: 2,
          product_id: '2570562000000091741', product_active: true, found: true,
          // This stale cache value is the exact fail-open the regression pins.
          list_price: 1000, ecomm_price: 700, discount_per_unit: 300, discount_pct: 30,
        },
      } }));
      assert.strictEqual(blocked.success, false);
      assert.ok(blocked.blockers.some((blocker) => blocker.code === 'zoho_list_price_unverified'));
      assert.strictEqual(blocked.snapshot.lines[0].pricing_source, 'zoho_list_price_unverified');
      assert.strictEqual(blocked.snapshot.lines[0].list_price, null);
      assert.strictEqual(blocked.snapshot.lines[0].ecomm_price, null);
      assert.strictEqual(blocked.snapshot.lines[0].discount_per_unit, null);
    } finally {
      H.setActiveEcommLookupError(null);
    }
  });

  await check('pricing requires exact nonnegative list-minus-discount math and permits an exact zero row', () => {
    assert.deepStrictEqual(H.oneshotProductPricingBlocker({
      sku: 'FREE-SYNTHETIC', list_price: 0, ecomm_price: 0, discount_per_unit: 0,
    }), null);
    assert.strictEqual(H.oneshotProductPricingBlocker({
      sku: 'MX75', list_price: 100, ecomm_price: 90, discount_per_unit: 0,
    }).reason, 'price_inputs_do_not_recreate_ecomm_price');
    assert.strictEqual(H.oneshotProductPricingBlocker({
      sku: 'MX75', list_price: 100, ecomm_price: -1, discount_per_unit: 101,
    }).reason, 'missing_or_invalid_price_inputs');
    assert.strictEqual(H.oneshotProductPricingBlocker({
      sku: 'FRACTIONAL-SYNTHETIC', qty: 3, list_price: 1, ecomm_price: 0.67, discount_per_unit: 0.333333,
    }).reason, 'price_inputs_do_not_recreate_ecomm_price');
  });

  await check('account/contact/Deal-only replan reuses prior product snapshot with zero lookup', async () => {
    H.setPrior({ success: true, snapshot: { product_snapshot: firstSnapshot } });
    const spy = lookupSpy();
    const result = await H.resolveOneshotProductPlan(
      { ...baseInput, prior_review_token: 'signed-prior', account_id: 'different-account-choice' },
      {}, 'test@stratusinfosystems.com', 'oneshot:test', spy.fn
    );
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.reused, true);
    assert.strictEqual(result.product_validation_count, 0);
    assert.strictEqual(spy.calls.length, 0);
    assert.strictEqual(result.snapshot.snapshot_hash, firstSnapshot.snapshot_hash);
  });

  await check('equivalent reordered/duplicated canonical lines reuse with zero lookup', async () => {
    H.setPrior({ success: true, snapshot: { product_snapshot: firstSnapshot } });
    const spy = lookupSpy();
    const result = await H.resolveOneshotProductPlan(
      { ...baseInput, prior_review_token: 'signed-prior', skus: [{ sku: 'mx75', qty: 1 }, { sku: 'MX75', qty: 1 }] },
      {}, 'test@stratusinfosystems.com', 'oneshot:test', spy.fn
    );
    assert.strictEqual(result.product_validation_count, 0);
    assert.strictEqual(spy.calls.length, 0);
    assert.strictEqual(result.snapshot.snapshot_hash, firstSnapshot.snapshot_hash);
  });

  await check('changed quantity produces exactly one fresh lookup', async () => {
    H.setPrior({ success: true, snapshot: { product_snapshot: firstSnapshot } });
    const spy = lookupSpy();
    const result = await H.resolveOneshotProductPlan(
      { ...baseInput, prior_review_token: 'signed-prior', skus: [{ sku: 'MX75', qty: 4 }] },
      {}, 'test@stratusinfosystems.com', 'oneshot:test', spy.fn
    );
    assert.strictEqual(result.product_validation_count, 1);
    assert.strictEqual(spy.calls.length, 1);
  });

  await check('changing the reviewed HA quantity override invalidates the snapshot', async () => {
    const cartInput = {
      ...baseInput,
      ha_mode: 'warm_spare',
      ha_recalculate_license_qty: true,
      skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX75-SEC-3Y', qty: 2 }],
    };
    const spy = lookupSpy();
    const planned = await H.buildOneshotProductSnapshot(cartInput, {}, 'oneshot:test', spy.fn);
    assert.strictEqual(planned.success, true);
    const changed = await H.validateOneshotProductSnapshotForExecute(
      planned.snapshot,
      { ...cartInput, ha_recalculate_license_qty: false }
    );
    assert.strictEqual(changed.error, 'product_snapshot_mismatch');
  });

  await check('EOL product blocker survives account/enrichment-only replan with zero lookup', async () => {
    const spy = lookupSpy();
    const blocked = await H.buildOneshotProductSnapshot(baseInput, {}, 'oneshot:test', async (...args) => {
      const result = await spy.fn(...args);
      const first = Object.keys(result.products)[0];
      result.products[first].eol = true;
      result.products[first].replaced_by = 'MX85-HW';
      return result;
    });
    assert.strictEqual(blocked.success, false);
    assert.ok(blocked.blockers.some((b) => b.code === 'eol_sku'));
    H.setPrior({ success: true, snapshot: { product_snapshot: blocked.snapshot } });
    const replanSpy = lookupSpy();
    const replanned = await H.resolveOneshotProductPlan(
      { ...baseInput, prior_review_token: 'signed-prior', refresh_enrichment: true },
      {}, 'test@stratusinfosystems.com', 'oneshot:test', replanSpy.fn
    );
    assert.strictEqual(replanned.product_validation_count, 0);
    assert.strictEqual(replanSpy.calls.length, 0);
    assert.ok(replanned.blockers.some((b) => b.code === 'eol_sku'));
    const executeCheck = await H.validateOneshotProductSnapshotForExecute(blocked.snapshot, baseInput);
    assert.strictEqual(executeCheck.error, 'product_snapshot_blocked');
  });

  await check('unresolved and inactive blockers also survive unchanged replans without lookup', async () => {
    for (const kind of ['unresolved_sku', 'inactive_sku']) {
      const spy = lookupSpy();
      const blocked = await H.buildOneshotProductSnapshot(baseInput, {}, 'oneshot:test', async (...args) => {
        const result = await spy.fn(...args);
        const first = Object.keys(result.products)[0];
        if (kind === 'unresolved_sku') {
          result.products[first].found = false;
          result.products[first].product_id = null;
        } else {
          result.products[first].product_active = false;
        }
        return result;
      });
      assert.ok(blocked.blockers.some((b) => b.code === kind));
      H.setPrior({ success: true, snapshot: { product_snapshot: blocked.snapshot } });
      const replanSpy = lookupSpy();
      const replanned = await H.resolveOneshotProductPlan(
        { ...baseInput, prior_review_token: 'signed-prior', account_id: `changed-${kind}` },
        {}, 'test@stratusinfosystems.com', 'oneshot:test', replanSpy.fn
      );
      assert.strictEqual(replanned.product_validation_count, 0);
      assert.strictEqual(replanSpy.calls.length, 0);
      assert.ok(replanned.blockers.some((b) => b.code === kind));
      assert.strictEqual(
        (await H.validateOneshotProductSnapshotForExecute(blocked.snapshot, baseInput)).error,
        'product_snapshot_blocked'
      );
    }
  });

  await check('execute preflight is lookup-free and fails closed on mismatch, expiry, and catalog drift', async () => {
    assert.strictEqual((await H.validateOneshotProductSnapshotForExecute(firstSnapshot, baseInput)).success, true);
    const mismatch = await H.validateOneshotProductSnapshotForExecute(firstSnapshot, { ...baseInput, license_term: '5' });
    assert.strictEqual(mismatch.error, 'product_snapshot_mismatch');
    const expired = await H.validateOneshotProductSnapshotForExecute({ ...firstSnapshot, expires_at: Date.now() - 1 }, baseInput);
    assert.strictEqual(expired.error, 'product_snapshot_expired');
    H.staticPrices.NEW = { zoho_product_id: '2570562000000099999', zoho_active: true };
    const drift = await H.validateOneshotProductSnapshotForExecute(firstSnapshot, baseInput);
    assert.strictEqual(drift.error, 'product_catalog_mismatch');
    delete H.staticPrices.NEW;
  });

  console.log('\n(3) explicit enrichment compare (never silent overwrite)');

  await check('refresh comparison preserves current values and exposes candidate + provenance', () => {
    const current = H.normalizeOneshotAccountPrefill({
      account_prefill: { name: 'Reviewed Co', street: '1 Main', city: 'Wichita', state: 'KS', zip: '67202', country: 'United States' },
    });
    const candidate = H.oneshotEnrichmentCandidate({ name: 'Web Co', address: '99 Web Ave', city: 'Denver', state: 'CO', zip: '80202' }, 'example.com');
    const comparison = H.compareOneshotEnrichment(current, candidate, { source: 'zia_web', tier: 'web', confidence: 0.8, refreshed: true });
    assert.strictEqual(comparison.current.street, '1 Main');
    assert.strictEqual(comparison.candidate.street, '99 Web Ave');
    assert.strictEqual(comparison.applied, false);
    assert.strictEqual(comparison.provenance.refreshed, true);
    assert.ok(comparison.changed_fields.includes('street'));
  });

  console.log('\n(4) source-level no-bypass/no-write invariants');

  await check('compound skip uses a module-local Symbol capability, not a JSON field', () => {
    assert.ok(/const ONESHOT_PRODUCT_SNAPSHOT_CAPABILITY = Symbol\(/.test(SRC));
    assert.ok(/toolInput\[ONESHOT_PRODUCT_SNAPSHOT_CAPABILITY\] = reviewedProductSnapshot/.test(SRC));
    assert.ok(!/__oneshot_product_snapshot/.test(SRC));
  });

  await check('signed Execute branch has 0 batch lookups, 0 Product reads, and 0 live Woo pricing calls', () => {
    const compoundStart = SRC.indexOf(`case 'create_deal_and_quote':`);
    const compound = SRC.slice(compoundStart, SRC.indexOf(`case 'quote_to_po_and_esign':`, compoundStart));
    assert.ok(/if \(!reviewedProductSnapshot\)/.test(compound));
    assert.ok(/if \(reviewedProductSnapshot\) \{[\s\S]*?quotedItems = quotedItemsFromOneshotProductRows\(resolvedProducts\)/.test(compound));
    const signedRowsStart = compound.indexOf('// The signed plan already performed the only product validation.');
    const signedRowsEnd = compound.indexOf('// STEP 4:', signedRowsStart);
    const signedRowsBranch = compound.slice(signedRowsStart, signedRowsEnd);
    assert.ok(signedRowsStart > -1 && signedRowsEnd > signedRowsStart);
    assert.ok(!/batch_product_lookup|Products\/search|WooProducts|fetchLiveSkuPricing|hydrateResolvedProductsWithLivePricing|preflightResolvedQuoteProducts/.test(signedRowsBranch));
    const trustedStart = compound.indexOf('if (reviewedProductSnapshot) {', compound.indexOf('let quotedItems'));
    const trustedPricingBranch = compound.slice(trustedStart, compound.indexOf('} else {', trustedStart));
    assert.ok(!/hydrateResolvedProductsWithLivePricing|preflightResolvedQuoteProducts|batch_product_lookup/.test(trustedPricingBranch));
    assert.ok(/orderOneshotProductRows\(reviewedProductSnapshot\.lines\)/.test(signedRowsBranch));
    assert.ok(/quotedItemsFromOneshotProductRows\(resolvedProducts\)/.test(compound));
    const reconcile = grab('reconcileQuoteToEcommPricing');
    assert.ok(!/Products\/|Products\/search|WooProducts|fetchLiveSkuPricing|hydrateResolvedProductsWithLivePricing/.test(reconcile));
  });

  await check('Execute derives product blockers before the idempotency claim or any write', () => {
    const execute = grab('executeOneshot');
    const pricingGuard = execute.indexOf('validateOneshotProductSnapshotForExecute(');
    const claim = execute.indexOf('claimOneshotExecution(');
    assert.ok(pricingGuard >= 0 && claim > pricingGuard);
  });

  await check('plan product builder cannot invoke a CRM write tool', () => {
    const fn = grab('buildOneshotProductSnapshot');
    assert.ok(/'batch_product_lookup'/.test(fn));
    assert.ok(!/create_deal_and_quote|create_quote_on_deal|zoho_create_record|zoho_update_record/.test(fn));
  });

  await check('public plan exposes validation id/hash/catalog/count/reuse metadata', () => {
    const plan = grab('buildOneshotPlan');
    assert.ok(/plan\.product_validation\s*=\s*\{/.test(plan));
    for (const field of ['plan_id', 'snapshot_hash', 'catalog_version', 'catalog_hash', 'product_validation_count', 'reused']) {
      assert.ok(new RegExp(`\\b${field}:`).test(plan), `missing public product_validation.${field}`);
    }
  });

  await check('D1 migration directory resolves to the checked-in one-shot claim migration', () => {
    assert.ok(/^migrations_dir\s*=\s*"migrations"\s*$/m.test(WRANGLER));
    assert.ok(fs.existsSync(path.join(__dirname, 'migrations', '0001_oneshot_claims.sql')));
    assert.ok(!/migrations_dir\s*=\s*"\.\.\/migrations"/.test(WRANGLER));
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
