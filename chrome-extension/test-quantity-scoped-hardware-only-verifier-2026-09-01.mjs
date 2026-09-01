// Quantity-scoped hardwareOnlyLines through URL verification.
//
// The editor may split one SKU into a bare spare and licensed units (MX67 x1
// None + MX67 x2 SEC). The whole-SKU hardwareOnlySkus list cannot say that:
// naming MX67 excluded all three units from companion coverage and made a
// URL with LIC-MX67 x2 an "unexpected item"; omitting it demanded three
// licences. hardwareOnlyLines carries the bare quantity itself.

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildOneshotReplanPayload,
  isProductChangingOneshotOverride,
  verifyStratusOrderUrlComposition,
  verifyStratusOrderUrlOptions,
} from './src/lib/email-quote-flow.mjs';

const SPLIT_ROWS = [
  { sku: 'MX67', qty: 1, tier: 'none' },
  { sku: 'MX67', qty: 2, tier: 'security' },
];
const SPLIT_REQUIREMENTS = {
  requireLicensedOption: true,
  hardwareOnlyLines: [{ sku: 'MX67', qty: 1 }],
  hardwareOnlySkus: [],
};
const option = (qtyLicense) => ({
  label: '3-Year',
  url: `https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=3,${qtyLicense}`,
});

test('a split SKU verifies only the URL that licenses exactly the non-bare units', () => {
  const exact = verifyStratusOrderUrlOptions([option(2)], SPLIT_ROWS, SPLIT_REQUIREMENTS);
  assert.equal(exact.ok, true, exact.error);
  for (const wrong of [1, 3]) {
    const result = verifyStratusOrderUrlOptions([option(wrong)], SPLIT_ROWS, SPLIT_REQUIREMENTS);
    assert.equal(result.ok, false, `LIC x${wrong} must not verify`);
    assert.match(result.error, /wrong license quantity/i);
  }
});

test('the legacy whole-SKU list still excludes every unit, so a partial licence is an unexpected item', () => {
  const result = verifyStratusOrderUrlOptions([option(2)], SPLIT_ROWS, {
    requireLicensedOption: true,
    hardwareOnlySkus: ['MX67'],
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /unexpected item|No licensed term option/i);
});

test('a bare quantity covering the whole committed quantity is treated as the whole-SKU list', () => {
  const rows = [{ sku: 'MR44', qty: 3, tier: 'none' }, { sku: 'MX67', qty: 1, tier: 'security' }];
  const requirements = { requireLicensedOption: true, hardwareOnlyLines: [{ sku: 'MR44', qty: 3 }] };
  const bare = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44,MX67,LIC-MX67-SEC-3YR&qty=3,1,1',
  }], rows, requirements);
  assert.equal(bare.ok, true, bare.error);
  const licensedBare = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44,MX67,LIC-MX67-SEC-3YR,LIC-ENT-3YR&qty=3,1,1,3',
  }], rows, requirements);
  assert.equal(licensedBare.ok, false, 'a licence for wholly bare access points is still refused');
});

test('a split SKU is not a hardware-only cart: a licensed option is still required', () => {
  const hardwareOnlyOnly = verifyStratusOrderUrlOptions([{
    label: 'Hardware Only',
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX67&qty=3',
  }], SPLIT_ROWS, SPLIT_REQUIREMENTS);
  assert.equal(hardwareOnlyOnly.ok, false);
  assert.match(hardwareOnlyOnly.error, /No licensed term option/i);

  const whollyBare = verifyStratusOrderUrlOptions([{
    label: 'Hardware Only',
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX67&qty=3',
  }], [{ sku: 'MX67', qty: 3, tier: 'none' }], {
    requireLicensedOption: true,
    hardwareOnlyLines: [{ sku: 'MX67', qty: 3 }],
  });
  assert.equal(whollyBare.ok, true, whollyBare.error);
});

test('composition verification accepts the quantity-scoped requirement directly', () => {
  const result = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=3,2',
    SPLIT_ROWS,
    { hardwareOnlyLines: [{ sku: 'MX67-HW', qty: 1 }] },
  );
  assert.equal(result.usable, true, result.error);
  const malformed = verifyStratusOrderUrlComposition(
    'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=3,2',
    [{ sku: 'MX67', qty: 3, tier: 'security' }],
    { hardwareOnlyLines: [{ sku: 'MX67', qty: 'one' }, null] },
  );
  assert.equal(malformed.usable, false, 'malformed bare lines cannot excuse a missing licence');
});

function splitEolRefresh() {
  return {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=3,2',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [
        { sku: 'MX64', qty: 1, tier: 'none' },
        { sku: 'MX64', qty: 2, tier: 'SEC' },
      ],
      targetLines: [
        { sku: 'MX67', qty: 3 },
        { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
      ],
      replacements: [
        {
          kind: 'eol_replace',
          hardwareOnly: true,
          from: [{ sku: 'MX64', qty: 1 }],
          to: [{ sku: 'MX67', qty: 1, role: 'hardware' }],
        },
        {
          kind: 'eol_replace',
          from: [{ sku: 'MX64', qty: 2, tier: 'SEC' }],
          to: [
            { sku: 'MX67', qty: 2, role: 'hardware' },
            { sku: 'LIC-MX67-SEC-3YR', qty: 2, role: 'license' },
          ],
        },
      ],
    },
  };
}
const SPLIT_EOL_ROWS = [
  { sku: 'MX64', qty: 1, tier: 'none' },
  { sku: 'MX64', qty: 2, tier: 'security' },
];
const clone = (value) => JSON.parse(JSON.stringify(value));

test('an EOL refresh whose source model is split bare/licensed still fails closed at contract binding', () => {
  // Known limitation, pinned deliberately: the structured contract cannot yet
  // declare a per-row "none" tier, and the SKU+tier binding refuses a committed
  // bare row for a model whose other rows declare a tier. No link is offered
  // rather than a link that could license the bare unit.
  const declaredNone = splitEolRefresh();
  const rejectedTier = verifyStratusOrderUrlOptions([declaredNone], SPLIT_EOL_ROWS, {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 1 }],
  });
  assert.equal(rejectedTier.ok, false);
  assert.match(rejectedTier.error, /unknown license tier/i);

  const undeclared = splitEolRefresh();
  undeclared.verification = clone(undeclared.verification);
  delete undeclared.verification.sourceLines[0].tier;
  const rejectedBinding = verifyStratusOrderUrlOptions([undeclared], SPLIT_EOL_ROWS, {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 1 }],
  });
  assert.equal(rejectedBinding.ok, false);
  assert.match(rejectedBinding.error, /did not match the current committed cart/i);
});

test('the EOL bare budget is quantity-scoped in both directions', () => {
  // Two bare replacement units against one reviewed bare unit.
  const overBare = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX67&qty=2',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'MX64', qty: 2 }],
      targetLines: [{ sku: 'MX67', qty: 2 }],
      replacements: [{
        kind: 'eol_replace',
        hardwareOnly: true,
        from: [{ sku: 'MX64', qty: 2 }],
        to: [{ sku: 'MX67', qty: 2, role: 'hardware' }],
      }],
    },
  };
  const rejectedBare = verifyStratusOrderUrlOptions([overBare], [{ sku: 'MX64', qty: 2, tier: 'none' }], {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 1 }],
  });
  assert.equal(rejectedBare.ok, false, 'two bare replacement units exceed the one reviewed bare unit');
  assert.match(rejectedBare.error, /matching reviewed Hardware Only source/i);
  const acceptedBare = verifyStratusOrderUrlOptions([overBare], [{ sku: 'MX64', qty: 2, tier: 'none' }], {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 2 }],
  });
  assert.equal(acceptedBare.ok, true, acceptedBare.error);

  // Two licensed replacement units against one reviewed licensed unit.
  const overLicensed = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=2,2',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'MX64', qty: 2, tier: 'SEC' }],
      targetLines: [{ sku: 'MX67', qty: 2 }, { sku: 'LIC-MX67-SEC-3YR', qty: 2 }],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'MX64', qty: 2, tier: 'SEC' }],
        to: [
          { sku: 'MX67', qty: 2, role: 'hardware' },
          { sku: 'LIC-MX67-SEC-3YR', qty: 2, role: 'license' },
        ],
      }],
    },
  };
  const licensedRows = [{ sku: 'MX64', qty: 2, tier: 'security' }];
  const rejectedLicensed = verifyStratusOrderUrlOptions([overLicensed], licensedRows, {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 1 }],
  });
  assert.equal(rejectedLicensed.ok, false, 'licensing a reviewed bare unit is refused');
  assert.match(rejectedLicensed.error, /added a license to a reviewed Hardware Only source/i);
  const acceptedLicensed = verifyStratusOrderUrlOptions([overLicensed], licensedRows, {});
  assert.equal(acceptedLicensed.ok, true, acceptedLicensed.error);
});

test('a whole-SKU hardware-only EOL refresh verifies from the quantity-scoped lines alone', () => {
  const option = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX67&qty=1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'MX64', qty: 1 }],
      targetLines: [{ sku: 'MX67', qty: 1 }],
      replacements: [{
        kind: 'eol_replace',
        hardwareOnly: true,
        from: [{ sku: 'MX64', qty: 1 }],
        to: [{ sku: 'MX67', qty: 1, role: 'hardware' }],
      }],
    },
  };
  const result = verifyStratusOrderUrlOptions([option], [{ sku: 'MX64', qty: 1, tier: 'none' }], {
    hardwareOnlyLines: [{ sku: 'MX64', qty: 1 }],
  });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.urls[0].hardwareOnly, true);
});

test('changing either bare contract is a product change that drops the prior review token', () => {
  for (const key of ['hardware_only_skus', 'hardware_only_lines']) {
    assert.equal(isProductChangingOneshotOverride({ [key]: [] }), true, key);
    const payload = buildOneshotReplanPayload({ skus: [], prior_review_token: 'stale' }, { [key]: [] }, 'token');
    assert.equal(payload.prior_review_token, undefined, key);
  }
});
