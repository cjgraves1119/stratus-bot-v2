import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  editableQuoteSkuText,
  normalizeEditableQuoteLines,
  verifyStratusOrderUrlComposition,
  verifyStratusOrderUrlOptions,
} from './src/lib/email-quote-flow.mjs';
import {
  createLatestRequestGuard,
  normalizeProductSearchQuery,
  sanitizeProductSearchResponse,
} from './src/lib/product-search.mjs';

test('editable lines reject invalid rows instead of producing a partial quote', () => {
  const normalized = normalizeEditableQuoteLines([
    { sku: 'MR44', qty: 2 },
    { sku: '', qty: 1 },
    { sku: 'MT12', qty: '1.5' },
  ]);
  assert.equal(normalized.ok, false);
  assert.deepEqual(normalized.lines, []);
  assert.deepEqual(normalized.errors.map((error) => error.code), ['invalid_sku', 'invalid_quantity']);
  assert.equal(editableQuoteSkuText([{ sku: 'MR44', qty: 0 }]).text, '');
  assert.equal(normalizeEditableQuoteLines([]).ok, false);
  assert.equal(normalizeEditableQuoteLines(Array.from({ length: 101 }, () => ({ sku: 'MR44', qty: 1 }))).ok, false);
});

test('editable lines uppercase and merge duplicates but fail closed on merged overflow', () => {
  assert.deepEqual(normalizeEditableQuoteLines([
    { sku: 'mr44', qty: '2' },
    { sku: 'MR44', qty: 3 },
    { sku: 'mt12', qty: 1 },
  ]), {
    ok: true,
    lines: [{ sku: 'MR44', qty: 5 }, { sku: 'MT12', qty: 1 }],
    errors: [],
    error: '',
  });
  const overflow = normalizeEditableQuoteLines([
    { sku: 'MR44', qty: 99999 },
    { sku: 'mr44', qty: 1 },
  ]);
  assert.equal(overflow.ok, false);
  assert.deepEqual(overflow.lines, []);
  assert.equal(overflow.errors[0].code, 'quantity_overflow');
});

test('order URL verification permits only narrow Meraki -HW equivalence', () => {
  const verified = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MT12-HW,LIC-MT-3Y,MT10-HW&qty=1,2,1',
    [{ sku: 'MT12', qty: 1 }, { sku: 'MT10', qty: 1 }],
  );
  assert.equal(verified.ok, true);
  assert.match(verified.usableUrl, /^https:\/\/stratusinfosystems\.com\/order\//);

  const cwLicense = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=CW9164I-MR,LIC-ENT-3YR&qty=2,2',
    [{ sku: 'CW9164I', qty: 2 }],
  );
  assert.equal(cwLicense.ok, true, 'CW access points share the catalog LIC-ENT companion');

  for (const [hardware, license] of [
    ['C8111-G2-MX', 'LIC-C8111-ENT-3Y'],
    ['C8455-G2-MX', 'LIC-C8455-SEC-3Y'],
    ['MG41E', 'LIC-MG41-ENT-3Y'],
  ]) {
    const familyLicense = verifyStratusOrderUrlComposition(
      `https://stratusinfosystems.com/order/?item=${hardware},${license}&qty=2,2`,
      [{ sku: hardware, qty: 2 }],
    );
    assert.equal(familyLicense.ok, true, `${hardware} must accept its catalog license companion`);
  }

  const arbitrary = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=C9300-24P-M-HW&qty=1',
    [{ sku: 'C9300-24P-M', qty: 1 }],
  );
  assert.equal(arbitrary.ok, false, '-HW must not be stripped from arbitrary Cisco SKUs');
  assert.equal(arbitrary.usableUrl, '');

  // 2026-08-18: models that ship only as a regional SKU (no bare form in the
  // catalog) verified on first build but failed on edit, because "MX67C-NA" never
  // collapsed to the typed "MX67C". Region-only suffixes must be equivalent.
  for (const [typed, published] of [
    ['MX67C', 'MX67C-NA'],
    ['MX68CW', 'MX68CW-NA'],
  ]) {
    const regional = verifyStratusOrderUrlComposition(
      `https://stratusinfosystems.com/order/?item=${published}&qty=1`,
      [{ sku: typed, qty: 1 }],
    );
    assert.equal(regional.ok, true, `${typed} must verify against regional ${published}`);
  }

  // 2026-08-18: picking a concrete term SKU from the read-only autocomplete (or
  // applying a suggestion chip) committed e.g. "LIC-ENT-1YR". Each option was then
  // compared against that exact SKU, so the 3-year and 5-year options could never
  // match — and one mismatch suppresses the whole set, leaving no links at all.
  {
    const termOptions = [
      { label: '1-Year', url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,MX67C-NA&qty=7,1' },
      { label: '3-Year', url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67C-NA&qty=7,1' },
      { label: '5-Year', url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,MX67C-NA&qty=7,1' },
    ];
    for (const committed of ['LIC-ENT', 'LIC-ENT-1YR', 'LIC-ENT-5YR']) {
      const set = verifyStratusOrderUrlOptions(termOptions, [{ sku: committed, qty: 7 }, { sku: 'MX67C', qty: 1 }]);
      assert.equal(set.ok, true, `${committed} must verify against every term option`);
      assert.equal(set.urls.length, 3, `${committed} must keep all three term options`);
    }
    // Re-terming must not weaken quantity or product checks.
    const badQty = verifyStratusOrderUrlOptions(termOptions, [{ sku: 'LIC-ENT-1YR', qty: 9 }, { sku: 'MX67C', qty: 1 }]);
    assert.equal(badQty.ok, false, 'a wrong committed quantity must still fail closed');
    const badProduct = verifyStratusOrderUrlOptions(termOptions, [{ sku: 'LIC-MV-1YR', qty: 7 }, { sku: 'MX67C', qty: 1 }]);
    assert.equal(badProduct.ok, false, 'a different licence family must still fail closed');
  }

  // Model shorthand that the resolver expands into a licence line.
  const shorthandLicense = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MX67C-ENT-3YR&qty=8,1',
    [{ sku: 'LIC-ENT', qty: 8 }, { sku: 'MX67C', qty: 1 }],
  );
  assert.equal(shorthandLicense.ok, true, 'bare model shorthand may resolve to its licence line');

  // ...but an ambiguous expansion still fails closed.
  const ambiguous = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=LIC-MX67C-ENT-3YR,LIC-MX67C-SEC-3YR&qty=1,1',
    [{ sku: 'MX67C', qty: 1 }],
  );
  assert.equal(ambiguous.ok, false, 'two candidate licences must not silently pick one');

  for (const [requested, published] of [
    ['Z4', 'Z4-HW'],
    ['MX68CW', 'MX68CW-HW-NA'],
    ['CW9166I', 'CW9166I-MR'],
    ['CW9172H', 'CW9172H-RTG'],
  ]) {
    const familyResult = verifyStratusOrderUrlComposition(
      `https://stratusinfosystems.com/order/?item=${published}&qty=1`,
      [{ sku: requested, qty: 1 }],
    );
    assert.equal(familyResult.ok, true, `${requested} must match its exact public-order suffix form`);
  }
});

test('composition mismatch makes a generated URL unusable', () => {
  const missing = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MT12-HW,MT10-HW&qty=1,1',
    [{ sku: 'C9300-24P-M', qty: 1 }, { sku: 'MT12', qty: 1 }, { sku: 'MT10', qty: 1 }],
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'composition_mismatch');
  assert.equal(missing.usableUrl, '');

  const staleExtra = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MT12-HW,MX84&qty=1,1',
    [{ sku: 'MT12', qty: 1 }],
  );
  assert.equal(staleExtra.ok, false);
  assert.equal(staleExtra.usableUrl, '');

  const unrelatedLicense = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y,LIC-MX84-ENT-3Y&qty=2,2,1',
    [{ sku: 'MX85', qty: 2 }],
  );
  assert.equal(unrelatedLicense.ok, false);
  assert.match(unrelatedLicense.error, /unexpected item \(LIC-MX84-ENT-3Y\)/i);

  const requestedLicenseOnly = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=LIC-MX85-ENT-3Y,LIC-MX84-ENT-3Y&qty=2,1',
    [{ sku: 'LIC-MX85-ENT-3Y', qty: 2 }],
  );
  assert.equal(requestedLicenseOnly.ok, false, 'license-only edits must not admit any uncommitted license SKU');
});

test('automatic license companions enforce model, port, quantity, tier, and explicit MX HA scope', () => {
  const mxHalf = 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,1';
  assert.equal(verifyStratusOrderUrlComposition(mxHalf, [{ sku: 'MX85', qty: 2 }]).ok, false);
  assert.equal(verifyStratusOrderUrlComposition(mxHalf, [{ sku: 'MX85', qty: 2 }], {
    allowHaLicenseRatio: true,
  }).ok, true);
  assert.equal(verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=2,1',
    [{ sku: 'MR44', qty: 2 }],
    { allowHaLicenseRatio: true },
  ).ok, false, 'MX HA permission must not halve AP licenses');

  for (const [hardware, license] of [
    ['C9300-24P-M', 'LIC-C9300-48E-3Y'],
    ['MS130-24P', 'LIC-MS130-48-3Y'],
  ]) {
    assert.equal(verifyStratusOrderUrlComposition(
      `https://stratusinfosystems.com/order/?item=${hardware},${license}&qty=2,2`,
      [{ sku: hardware, qty: 2 }],
    ).ok, false, `${license} must not attach to ${hardware}`);
  }
  assert.equal(verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,99',
    [{ sku: 'MX85', qty: 2 }],
  ).ok, false);

  const advancedWrong = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-3Y&qty=2,2',
  }], [{ sku: 'C9300-24P-M', qty: 2 }], { licenseTier: 'A' });
  assert.equal(advancedWrong.ok, false);
  const advancedCorrect = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24A-3Y&qty=2,2',
  }], [{ sku: 'C9300-24P-M', qty: 2 }], { licenseTier: 'A' });
  assert.equal(advancedCorrect.ok, true);
});

test('term-agnostic license aliases require exact quantities and a labeled matching option term', () => {
  for (const [requested, published] of [
    ['LIC-ENT', 'LIC-ENT-3YR'],
    ['MR-ENT', 'LIC-ENT-3YR'],
    ['LIC-MV', 'LIC-MV-3YR'],
    ['LIC-MT', 'LIC-MT-3Y'],
  ]) {
    const valid = verifyStratusOrderUrlOptions([{
      label: '3-Year',
      url: `https://stratusinfosystems.com/order/?item=${published}&qty=7`,
    }], [{ sku: requested, qty: 7 }]);
    assert.equal(valid.ok, true, requested);
    assert.equal(verifyStratusOrderUrlOptions([{
      label: 'Current quote',
      url: `https://stratusinfosystems.com/order/?item=${published}&qty=7`,
    }], [{ sku: requested, qty: 7 }]).ok, false, `${requested} requires an explicit term label`);
    assert.equal(verifyStratusOrderUrlOptions([{
      label: '3-Year',
      url: `https://stratusinfosystems.com/order/?item=${published}&qty=6`,
    }], [{ sku: requested, qty: 7 }]).ok, false, `${requested} requires an exact quantity`);
  }

  assert.equal(verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR&qty=5',
  }], [{ sku: 'LIC-ENT', qty: 5 }, { sku: 'MR-ENT', qty: 5 }]).ok, false,
  'one published line must not satisfy two committed aliases');

  const mixedExplicitLicenseTiers = verifyStratusOrderUrlOptions([{
    label: '1-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,LIC-MX64-SEC-1YR&qty=2,1',
  }, {
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MX64-SEC-3YR&qty=2,1',
  }, {
    label: '5-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,LIC-MX64-SEC-5YR&qty=2,1',
  }], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'LIC-MX64-SEC-3YR', qty: 1 },
  ], { licenseTier: 'ENT', requireLicensedOption: true });
  assert.equal(mixedExplicitLicenseTiers.ok, true,
    mixedExplicitLicenseTiers.error || 'literal ENT and MX SEC renewals must retain their independently committed tiers');
  assert.equal(mixedExplicitLicenseTiers.urls.length, 3);

  const refreshBundleWithExplicitCompanion = verifyStratusOrderUrlOptions([{
    label: '1-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,MX67,LIC-MX67-SEC-1YR&qty=2,1,1',
  }, {
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR&qty=2,1,1',
  }, {
    label: '5-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,MX67,LIC-MX67-SEC-5YR&qty=2,1,1',
  }], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ], { licenseTier: 'ENT', requireLicensedOption: true });
  assert.equal(refreshBundleWithExplicitCompanion.ok, true,
    refreshBundleWithExplicitCompanion.error || 'the sent MX67 refresh bundle must retain all three verified lines');
  assert.equal(refreshBundleWithExplicitCompanion.urls.length, 3);

  const mixedStandaloneAndHardware = verifyStratusOrderUrlOptions([{
    label: '1-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,MX67,LIC-MX67-SEC-1YR&qty=2,1,1',
  }], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX67', qty: 1, tier: 'security' },
  ], { licenseTier: 'ENT', requireLicensedOption: true });
  assert.equal(mixedStandaloneAndHardware.ok, true,
    mixedStandaloneAndHardware.error || 'the MX row tier must override the unrelated standalone ENT license');

  const wrongMxCompanionTier = verifyStratusOrderUrlOptions([{
    label: '1-Year',
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,MX67,LIC-MX67-ENT-1YR&qty=2,1,1',
  }], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX67', qty: 1, tier: 'security' },
  ], { licenseTier: 'ENT', requireLicensedOption: true });
  assert.equal(wrongMxCompanionTier.ok, false, 'MX67 Security must still reject an ENT companion');
  assert.match(wrongMxCompanionTier.error, /ENT license tier when SEC was requested/i);

  const mixedMr = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=2,4',
  }], [{ sku: 'MR44', qty: 2 }, { sku: 'MR-ENT', qty: 2 }]);
  assert.equal(mixedMr.ok, true, 'MR hardware auto-license and explicit MR-ENT quantities must be summed atomically');
  assert.equal(verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=2,2',
  }], [{ sku: 'MR44', qty: 2 }, { sku: 'MR-ENT', qty: 2 }]).ok, false,
  'a mixed cart missing the explicit MR-ENT quantity must fail closed');
});

test('newest-request guard ignores older autocomplete results and retains no query state', () => {
  const guard = createLatestRequestGuard();
  const first = guard.begin();
  const second = guard.begin();
  assert.equal(guard.isLatest(first), false);
  assert.equal(guard.isLatest(second), true);
  assert.deepEqual(Object.keys(second), []);
  guard.invalidate();
  assert.equal(guard.isLatest(second), false);
});

test('product responses are active-only, capped, deduplicated, and stripped', () => {
  assert.equal(normalizeProductSearchQuery('x').ok, false);
  assert.deepEqual(normalizeProductSearchQuery('  C9300   24P  '), {
    ok: true,
    query: 'C9300 24P',
    error: '',
  });

  const products = Array.from({ length: 12 }, (_, index) => ({
    sku: `MT${10 + index}`,
    name: `Sensor ${index}`,
    product_id: `25705620004015234${String(index).padStart(2, '0')}`,
    active: true,
    source: index % 2 ? 'zoho' : 'cache',
    unit_price: 123,
    cost: 100,
    margin: 23,
    credentials: 'must-not-cross',
  }));
  products.splice(1, 0, { ...products[0] });
  products.splice(2, 0, { ...products[2], active: false });
  products.splice(3, 0, { Product_Code: 'MR44', Product_Name: 'Raw alias', Product_Active: true });
  const result = sanitizeProductSearchResponse({
    results: products,
    live: true,
    debug: { token: 'must-not-cross' },
  }, 'MT');
  assert.equal(result.ok, true);
  assert.equal(result.live, true);
  assert.equal(result.results.length, 10);
  assert.equal(result.results.some((row) => row.sku === 'MR44'), false, 'raw Zoho aliases must not cross the route contract');
  assert.deepEqual(Object.keys(result.results[0]).sort(), ['active', 'name', 'sku', 'source']);
  assert.doesNotMatch(JSON.stringify(result), /product_id|unit_price|cost|margin|credentials|debug|must-not-cross/);
});

test('background wiring is a narrow POST to /api/product-search', () => {
  const constants = fs.readFileSync(new URL('./src/lib/constants.js', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('./src/background/api-client.js', import.meta.url), 'utf8');
  const background = fs.readFileSync(new URL('./src/background/index.js', import.meta.url), 'utf8');
  assert.match(constants, /PRODUCT_SEARCH: 'PRODUCT_SEARCH'/);
  assert.match(client, /export async function productSearch\(query\)/);
  assert.match(client, /apiCall\('\/api\/product-search', \{ query: normalized\.query \}/);
  assert.match(client, /timeout: 8000/);
  assert.match(background, /\[MSG\.PRODUCT_SEARCH\]: async \(\{ query \}\) => \{[\s\S]{0,120}api\.productSearch\(query\)/);
  assert.doesNotMatch(background.match(/\[MSG\.PRODUCT_SEARCH\][\s\S]{0,180}/)?.[0] || '', /storage\.|CRM_CREATE|ONESHOT_EXECUTE/);
});
