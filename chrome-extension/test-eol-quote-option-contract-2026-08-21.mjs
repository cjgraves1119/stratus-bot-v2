import assert from 'node:assert/strict';
import test from 'node:test';
import {
  selectableQuoteTerms,
  verifyStratusOrderUrlOptions,
} from './src/lib/email-quote-flow.mjs';

const committed = [
  { sku: 'LIC-ENT-3YR', qty: 2 },
  { sku: 'LIC-MX64-SEC-3YR', qty: 1 },
];

function renewalOption(termYears = 3) {
  return {
    label: `Renew As-Is — ${termYears}-Year`,
    optionKind: 'renewal',
    optionGroupId: 'renew-as-is',
    termYears,
    url: `https://stratusinfosystems.com/order/?item=LIC-ENT-${termYears}YR,LIC-MX64-SEC-${termYears}YR&qty=2,1`,
  };
}

function refreshOption(overrides = {}) {
  const option = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67-HW,LIC-MX67-SEC-3YR&qty=2,1,1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: committed,
      targetLines: [
        { sku: 'LIC-ENT-3YR', qty: 2 },
        { sku: 'MX67', qty: 1 },
        { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
      ],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1, tier: 'SEC' }],
        to: [
          { sku: 'MX67', qty: 1, role: 'hardware' },
          { sku: 'LIC-MX67-SEC-3YR', qty: 1, role: 'license' },
        ],
      }],
    },
  };
  return {
    ...option,
    ...overrides,
    verification: overrides.verification === undefined
      ? option.verification
      : overrides.verification,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function hardwareOriginRefresh({ hardwareQty = 1, licenseQty = 0 } = {}) {
  const sourceLines = [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX64', qty: hardwareQty, tier: 'SEC' },
    ...(licenseQty ? [{ sku: 'LIC-MX64-SEC-3YR', qty: licenseQty }] : []),
  ];
  const targetLines = [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX67', qty: hardwareQty },
    { sku: 'LIC-MX67-SEC-3YR', qty: licenseQty || hardwareQty },
  ];
  return {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: `https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR&qty=2,${hardwareQty},${licenseQty || hardwareQty}`,
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines,
      targetLines,
      replacements: [{
        kind: 'eol_replace',
        from: [
          { sku: 'MX64', qty: hardwareQty, tier: 'SEC' },
          ...(licenseQty ? [{ sku: 'LIC-MX64-SEC-3YR', qty: licenseQty, tier: 'SEC' }] : []),
        ],
        to: [
          { sku: 'MX67', qty: hardwareQty, role: 'hardware' },
          { sku: 'LIC-MX67-SEC-3YR', qty: licenseQty || hardwareQty, role: 'license' },
        ],
      }],
    },
  };
}

function hardwareOnlyRefresh(overrides = {}) {
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
  return { ...option, ...overrides };
}

test('structured EOL refresh binds source, preserves unrelated lines, and exactly verifies target URL', () => {
  const result = verifyStratusOrderUrlOptions([
    renewalOption(),
    refreshOption(),
  ], committed);
  assert.equal(result.ok, true);
  assert.equal(result.urls.length, 2);
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(result.urls.map(({ optionKind }) => optionKind), ['renewal', 'eol_refresh']);
});

test('explicit committed terms are safely restated for each structured option term', () => {
  const option = refreshOption({
    label: 'Hardware Refresh — 5-Year',
    termYears: 5,
    url: 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,MX67,LIC-MX67-SEC-5YR&qty=2,1,1',
  });
  option.verification = clone(option.verification);
  option.verification.sourceLines = [
    { sku: 'LIC-ENT-5YR', qty: 2 },
    { sku: 'LIC-MX64-SEC-5YR', qty: 1 },
  ];
  option.verification.targetLines = [
    { sku: 'LIC-ENT-5YR', qty: 2 },
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-MX67-SEC-5YR', qty: 1 },
  ];
  option.verification.replacements[0].from[0].sku = 'LIC-MX64-SEC-5YR';
  option.verification.replacements[0].to[1].sku = 'LIC-MX67-SEC-5YR';
  const result = verifyStratusOrderUrlOptions([option], committed);
  assert.equal(result.ok, true, result.error);
});

test('legacy untiered switch renewals may migrate only to the replacement Essentials tier', () => {
  const legacyCommitted = [{ sku: 'LIC-MS120-24P-3YR', qty: 1 }];
  const option = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: 'https://stratusinfosystems.com/order/?item=MS130-24P,LIC-MS130-24-3Y&qty=1,1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: legacyCommitted,
      targetLines: [
        { sku: 'MS130-24P', qty: 1 },
        { sku: 'LIC-MS130-24-3Y', qty: 1 },
      ],
      replacements: [{
        kind: 'eol_replace',
        from: legacyCommitted,
        to: [
          { sku: 'MS130-24P', qty: 1, role: 'hardware' },
          { sku: 'LIC-MS130-24-3Y', qty: 1, role: 'license' },
        ],
      }],
    },
  };
  const essentials = verifyStratusOrderUrlOptions([option], legacyCommitted);
  assert.equal(essentials.ok, true, essentials.error);

  const advanced = clone(option);
  advanced.url = 'https://stratusinfosystems.com/order/?item=MS130-24P,LIC-MS130-24A-3Y&qty=1,1';
  advanced.verification.targetLines[1].sku = 'LIC-MS130-24A-3Y';
  advanced.verification.replacements[0].to[1].sku = 'LIC-MS130-24A-3Y';
  const rejected = verifyStratusOrderUrlOptions([advanced], legacyCommitted);
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /changed the committed license tier/i);
});

test('hardware-origin EOL transform consumes hardware without double-counting a paired old license', () => {
  const hardwareOnlySource = hardwareOriginRefresh();
  const hardwareOnlyCommitted = [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX64', qty: 1, tier: 'SEC' },
  ];
  assert.equal(verifyStratusOrderUrlOptions([hardwareOnlySource], hardwareOnlyCommitted).ok, true);

  const pairedSource = hardwareOriginRefresh({ hardwareQty: 1, licenseQty: 1 });
  const pairedCommitted = [
    ...hardwareOnlyCommitted,
    { sku: 'LIC-MX64-SEC-3YR', qty: 1 },
  ];
  const paired = verifyStratusOrderUrlOptions([pairedSource], pairedCommitted);
  assert.equal(paired.ok, true, paired.error);
  assert.match(paired.urls[0].url, /qty=2,1,1/,
    'one hardware plus its explicit old companion remains one replacement unit');
});

test('hardware-only EOL transform requires the current reviewed bare-hardware source', () => {
  const option = hardwareOnlyRefresh();
  const committedHardwareOnly = [{ sku: 'MX64', qty: 1, tier: 'none' }];
  const reviewed = verifyStratusOrderUrlOptions([option], committedHardwareOnly, {
    hardwareOnlySkus: ['MX64'],
  });
  assert.equal(reviewed.ok, true, reviewed.error);
  assert.equal(reviewed.urls[0].hardwareOnly, true);

  const notReviewed = verifyStratusOrderUrlOptions([option], committedHardwareOnly);
  assert.equal(notReviewed.ok, false);
  assert.deepEqual(notReviewed.urls, []);
  assert.match(notReviewed.error, /matching reviewed Hardware Only source/i);

  const staleTargetFlag = hardwareOnlyRefresh({ hardwareOnly: false });
  const stale = verifyStratusOrderUrlOptions([staleTargetFlag], committedHardwareOnly, {
    hardwareOnlySkus: ['MX64'],
  });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /not explicitly marked Hardware Only/i);

  const missingReplacementProof = hardwareOnlyRefresh();
  delete missingReplacementProof.verification.replacements[0].hardwareOnly;
  const missingProof = verifyStratusOrderUrlOptions([missingReplacementProof], committedHardwareOnly, {
    hardwareOnlySkus: ['MX64'],
  });
  assert.equal(missingProof.ok, false);
  assert.match(missingProof.error, /did not explicitly match its Hardware Only scope/i);
});

test('mixed EOL refresh permits only the ordinary companion for retained non-EOL hardware', () => {
  const option = hardwareOnlyRefresh({
    hardwareOnly: false,
    url: 'https://stratusinfosystems.com/order/?item=MX67,MR44,LIC-ENT-3YR&qty=1,1,1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [
        { sku: 'MX64', qty: 1 },
        { sku: 'MR44', qty: 1, tier: 'ENT' },
      ],
      targetLines: [
        { sku: 'MX67', qty: 1 },
        { sku: 'MR44', qty: 1 },
        { sku: 'LIC-ENT-3YR', qty: 1 },
      ],
      replacements: [{
        kind: 'eol_replace',
        hardwareOnly: true,
        from: [{ sku: 'MX64', qty: 1 }],
        to: [{ sku: 'MX67', qty: 1, role: 'hardware' }],
      }],
    },
  });
  const result = verifyStratusOrderUrlOptions([option], [
    { sku: 'MX64', qty: 1, tier: 'none' },
    { sku: 'MR44', qty: 1, tier: 'ENT' },
  ], { hardwareOnlySkus: ['MX64'] });
  assert.equal(result.ok, true, result.error);

  const forgedExtra = clone(option);
  forgedExtra.verification.targetLines.push({ sku: 'LIC-MX67-SEC-3YR', qty: 1 });
  forgedExtra.url = 'https://stratusinfosystems.com/order/?item=MX67,MR44,LIC-ENT-3YR,LIC-MX67-SEC-3YR&qty=1,1,1,1';
  const rejected = verifyStratusOrderUrlOptions([forgedExtra], [
    { sku: 'MX64', qty: 1, tier: 'none' },
    { sku: 'MR44', qty: 1, tier: 'ENT' },
  ], { hardwareOnlySkus: ['MX64'] });
  assert.equal(rejected.ok, false);
  assert.deepEqual(rejected.urls, []);
});

test('repeated identical EOL rows may consume their aggregated source quantity exactly once each', () => {
  const option = hardwareOriginRefresh({ hardwareQty: 2 });
  option.verification = clone(option.verification);
  option.verification.replacements = [1, 2].map(() => ({
    kind: 'eol_replace',
    from: [{ sku: 'MX64', qty: 1, tier: 'SEC' }],
    to: [
      { sku: 'MX67', qty: 1, role: 'hardware' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1, role: 'license' },
    ],
  }));
  const result = verifyStratusOrderUrlOptions([option], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX64', qty: 1, tier: 'SEC' },
    { sku: 'MX64', qty: 1, tier: 'SEC' },
  ]);
  assert.equal(result.ok, true, result.error);
});

test('hardware-origin EOL transform binds the reviewed row tier and rejects stale SEC metadata after an ENT edit', () => {
  const option = hardwareOriginRefresh();
  const staleTier = verifyStratusOrderUrlOptions([option], [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX64', qty: 1, tier: 'ENT' },
  ]);
  assert.equal(staleTier.ok, false);
  assert.deepEqual(staleTier.urls, []);
  assert.match(staleTier.error, /sourceLines did not match/i);
});

test('affirmative HA permits a 2:1 paired source without weakening the default verifier', () => {
  const option = hardwareOriginRefresh({ hardwareQty: 2, licenseQty: 1 });
  const haCommitted = [
    { sku: 'LIC-ENT-3YR', qty: 2 },
    { sku: 'MX64', qty: 2, tier: 'SEC' },
    { sku: 'LIC-MX64-SEC-3YR', qty: 1 },
  ];
  assert.equal(verifyStratusOrderUrlOptions([option], haCommitted).ok, false,
    '2:1 coverage is forbidden unless affirmative HA was reviewed');
  const reviewedHa = verifyStratusOrderUrlOptions([option], haCommitted, { allowHaLicenseRatio: true });
  assert.equal(reviewedHa.ok, true, reviewedHa.error);
});

test('renewal and refresh options for the same term remain independently selectable', () => {
  const options = selectableQuoteTerms([renewalOption(), refreshOption()]);
  assert.deepEqual(options.map(({ years, optionGroupId }) => [years, optionGroupId]), [
    [3, 'renew-as-is'],
    [3, 'eol-refresh'],
  ]);
  assert.equal(selectableQuoteTerms([renewalOption(), renewalOption()]).length, 1,
    'duplicates inside the same group and term stay deduplicated');
});

test('stale or absent EOL contracts fail closed while a valid renewal remains usable', () => {
  const stale = refreshOption();
  stale.verification = clone(stale.verification);
  stale.verification.sourceLines[1].qty = 2;
  const absent = refreshOption({ verification: null });

  for (const option of [stale, absent]) {
    const result = verifyStratusOrderUrlOptions([renewalOption(), option], committed);
    assert.equal(result.ok, true);
    assert.deepEqual(result.urls.map(({ optionKind }) => optionKind), ['renewal']);
    assert.equal(result.dropped.length, 1);
    assert.match(result.dropped[0].reason, /EOL refresh option could not be verified/i);
  }
});

test('a refresh label alone cannot authorize a transformed cart', () => {
  const forgedLabel = {
    label: 'Hardware Refresh — 3-Year',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: refreshOption().url,
  };
  const result = verifyStratusOrderUrlOptions([forgedLabel], committed);
  assert.equal(result.ok, false);
  assert.deepEqual(result.urls, []);
  assert.match(result.error, /committed quantity|unexpected item/i);
});

test('structured EOL option rejects forged term labels and malformed identity fields', () => {
  const cases = [
    refreshOption({ label: 'Hardware Refresh — 5-Year' }),
    refreshOption({ optionGroupId: '' }),
    refreshOption({ termYears: 9 }),
    refreshOption({ termYears: '3' }),
    refreshOption({ hardwareOnly: true }),
  ];
  for (const option of cases) {
    const result = verifyStratusOrderUrlOptions([option], committed);
    assert.equal(result.ok, false, JSON.stringify(option));
    assert.deepEqual(result.urls, []);
    assert.match(result.error, /EOL refresh option could not be verified/i);
  }
});

test('structured EOL option rejects malformed schema, mode, replacement kind, and target roles', () => {
  const mutate = (fn) => {
    const option = refreshOption();
    option.verification = clone(option.verification);
    fn(option);
    return option;
  };
  const cases = [
    mutate((option) => { option.verification.schema = 'quote-option-v0'; }),
    mutate((option) => { option.verification.mode = 'trust_label'; }),
    mutate((option) => { option.verification.replacements[0].kind = 'replace'; }),
    mutate((option) => { option.verification.replacements[0].to[0].role = 'license'; }),
    mutate((option) => { option.verification.replacements[0].to[0].role = 'Hardware'; }),
    mutate((option) => { delete option.verification.replacements[0].to[1].role; }),
    mutate((option) => { option.verification.targetLines[0].qty = '2'; }),
  ];
  for (const option of cases) {
    const result = verifyStratusOrderUrlOptions([option], committed);
    assert.equal(result.ok, false);
    assert.deepEqual(result.urls, []);
  }
});

test('structured EOL option rejects overdraw, duplicate consumption, tier changes, and term changes', () => {
  const mutate = (fn) => {
    const option = refreshOption();
    option.verification = clone(option.verification);
    fn(option);
    return option;
  };
  const overdraw = mutate((option) => {
    option.verification.replacements[0].from[0].qty = 2;
    option.verification.replacements[0].to[0].qty = 2;
    option.verification.replacements[0].to[1].qty = 2;
  });
  const duplicate = mutate((option) => {
    option.verification.replacements.push(clone(option.verification.replacements[0]));
  });
  const wrongTier = mutate((option) => {
    option.verification.replacements[0].to[1].sku = 'LIC-MX67-ENT-3YR';
    option.verification.targetLines[2].sku = 'LIC-MX67-ENT-3YR';
    option.url = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-ENT-3YR&qty=2,1,1';
  });
  const wrongTerm = mutate((option) => {
    option.verification.replacements[0].to[1].sku = 'LIC-MX67-SEC-5YR';
    option.verification.targetLines[2].sku = 'LIC-MX67-SEC-5YR';
    option.url = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-5YR&qty=2,1,1';
  });
  for (const option of [overdraw, duplicate, wrongTier, wrongTerm]) {
    const result = verifyStratusOrderUrlOptions([option], committed);
    assert.equal(result.ok, false);
    assert.deepEqual(result.urls, []);
  }
});

test('structured EOL target must retain unrelated lines and exactly match both transform and URL', () => {
  const mutate = (fn) => {
    const option = refreshOption();
    option.verification = clone(option.verification);
    fn(option);
    return option;
  };
  const droppedUnrelated = mutate((option) => {
    option.verification.targetLines.shift();
    option.url = 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1';
  });
  const undeclaredTarget = mutate((option) => {
    option.verification.targetLines.push({ sku: 'MR44', qty: 1 });
    option.url = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR,MR44&qty=2,1,1,1';
  });
  const staleUrl = mutate((option) => {
    option.url = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR&qty=2,2,2';
  });
  for (const option of [droppedUnrelated, undeclaredTarget, staleUrl]) {
    const result = verifyStratusOrderUrlOptions([option], committed);
    assert.equal(result.ok, false);
    assert.deepEqual(result.urls, []);
  }
});

test('generic exact quote options remain unchanged and require no structured contract', () => {
  const result = verifyStratusOrderUrlOptions([renewalOption()], committed);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.urls.length, 1);
});
