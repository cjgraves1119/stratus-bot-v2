// Fix (2026-08-19): "Quote could not be verified: The generated order URL did not
// contain the committed quantity for CW9164."
//
// Typing "5 CW9164s" leaves the editor row as the bare stem "CW9164" while the
// resolver builds "CW9164I-MR". The verifier canonicalizes that URL line to
// "CW9164I", which did not equal the committed "CW9164", so verification failed
// closed. That blocked EVERY update on the cart, including edits to unrelated
// rows: Chris could not change a Z4 quantity from 2 to 3.
//
// The stem is resolved to the single catalog form present in the URL. The rule is
// deliberately narrow: CW numbers only, one direction, exactly one candidate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyStratusOrderUrlComposition,
  verifyStratusOrderUrlOptions,
  oneshotStopExplanation,
} from './src/lib/email-quote-flow.mjs';
import { defaultLicenseTierLabelForSku } from './src/sidebar/components/sku-editor-core.mjs';

const url = (items) =>
  `https://stratusinfosystems.com/order/?item=${items.map((i) => i[0]).join(',')}&qty=${items.map((i) => i[1]).join(',')}`;
const verify = (committed, urlItems) =>
  verifyStratusOrderUrlComposition(url(urlItems), committed, {});

test('the reported cart verifies end to end', () => {
  // Exactly what "3 MR44, 5 CW9164s, 1 MX67C, 2 Z4" produces.
  const committed = [
    { sku: 'MR44', qty: 3 }, { sku: 'CW9164', qty: 5 },
    { sku: 'MX67C', qty: 1 }, { sku: 'Z4', qty: 2 },
  ];
  const options = [1, 3, 5].map((t) => ({
    label: `${t}-Year`,
    url: url([['MR44-HW', 3], [`LIC-ENT-${t}YR`, 8], ['CW9164I-MR', 5],
      ['MX67C-NA', 1], [`LIC-MX67C-SEC-${t}YR`, 1], ['Z4-HW', 2], [`LIC-Z4-SEC-${t}Y`, 2]]),
  }));
  const res = verifyStratusOrderUrlOptions(options, committed, { requireLicensedOption: true });
  assert.equal(res.ok, true, res.error);
});

test('a changed quantity on an unrelated row still verifies', () => {
  // The Z4 going from 2 to 3 must not be blocked by the CW9164 row.
  const committed = [
    { sku: 'MR44', qty: 3 }, { sku: 'CW9164', qty: 5 },
    { sku: 'MX67C', qty: 1 }, { sku: 'Z4', qty: 3 },
  ];
  const res = verify(committed, [['MR44-HW', 3], ['LIC-ENT-1YR', 8], ['CW9164I-MR', 5],
    ['MX67C-NA', 1], ['LIC-MX67C-SEC-1YR', 1], ['Z4-HW', 3], ['LIC-Z4-SEC-1Y', 3]]);
  assert.equal(res.ok, true, res.error);
});

test('a bare CW stem resolves to the one catalog form in the URL', () => {
  assert.equal(verify([{ sku: 'CW9164', qty: 5 }], [['CW9164I-MR', 5], ['LIC-ENT-1YR', 5]]).ok, true);
  assert.equal(verify([{ sku: 'CW9166', qty: 2 }], [['CW9166I-MR', 2], ['LIC-ENT-1YR', 2]]).ok, true);
  assert.equal(verify([{ sku: 'CW9176', qty: 3 }], [['CW9176I-RTG', 3], ['LIC-ENT-1YR', 3]]).ok, true);
});

test('an explicitly typed variant is never satisfied by a different one', () => {
  // CW9172H and CW9172I are both real, so this must stay strict.
  assert.equal(verify([{ sku: 'CW9172I', qty: 2 }], [['CW9172H-RTG', 2], ['LIC-ENT-1YR', 2]]).ok, false);
  assert.equal(verify([{ sku: 'CW9166I', qty: 2 }], [['CW9166D-MR', 2], ['LIC-ENT-1YR', 2]]).ok, false);
});

test('an ambiguous stem fails closed', () => {
  const res = verify([{ sku: 'CW9172', qty: 4 }],
    [['CW9172H-RTG', 2], ['CW9172I-RTG', 2], ['LIC-ENT-1YR', 4]]);
  assert.equal(res.ok, false, 'two candidate variants must not silently pick one');
});

test('the rule is not widened to Meraki families where the letter is a product', () => {
  // Z4 and Z4C, MX67 and MX67C are different appliances.
  assert.equal(verify([{ sku: 'Z4', qty: 2 }], [['Z4C-HW', 2], ['LIC-Z4C-SEC-1Y', 2]]).ok, false);
  assert.equal(verify([{ sku: 'MX67', qty: 1 }], [['MX67C-NA', 1], ['LIC-MX67C-SEC-1YR', 1]]).ok, false);
  // The narrow -HW/-NA equivalence that already existed still works.
  assert.equal(verify([{ sku: 'Z4', qty: 2 }], [['Z4-HW', 2], ['LIC-Z4-SEC-1Y', 2]]).ok, true);
  assert.equal(verify([{ sku: 'MX67C', qty: 1 }], [['MX67C-NA', 1], ['LIC-MX67C-SEC-1YR', 1]]).ok, true);
});

test('quantities are still enforced through the stem resolution', () => {
  assert.equal(verify([{ sku: 'CW9164', qty: 5 }], [['CW9164I-MR', 4], ['LIC-ENT-1YR', 4]]).ok, false);
});

// ── The default tier is now named on screen ──────────────────────────────────

test('the default tier option names the tier the row will actually get', () => {
  assert.match(defaultLicenseTierLabelForSku('MX67C-NA'), /Advanced Security \(SEC\).*default/);
  assert.match(defaultLicenseTierLabelForSku('Z4-HW'), /Advanced Security \(SEC\).*default/);
  assert.match(defaultLicenseTierLabelForSku('MR44'), /Enterprise \(ENT\).*default/);
  assert.match(defaultLicenseTierLabelForSku('CW9164I-MR'), /Enterprise \(ENT\).*default/);
  assert.match(defaultLicenseTierLabelForSku('MS130-24'), /Standard.*default/);
  // An unlicensed line has no tier dropdown at all, so the generic label stands.
  assert.equal(defaultLicenseTierLabelForSku('MA-PWR-30W'), 'Default license tier');
});

// ── A one-shot stop always explains itself ──────────────────────────────────

test('a bare stop code still renders a reason', () => {
  // Asserts that a reason is produced and that it points at the write target,
  // not the exact sentence, which was reworded on 2026-08-19 once the real cause
  // turned out to be a Deal belonging to a different contact.
  const dealTarget = oneshotStopExplanation({ error: 'reviewed_deal_target_changed' });
  assert.match(dealTarget, /Deal/);
  assert.match(dealTarget, /Nothing was written/);
  assert.match(oneshotStopExplanation({ error: 'review_mismatch' }),
    /no longer matches the signed review/);
  assert.match(oneshotStopExplanation({ error: 'product_review_required' }),
    /could not sign this cart/);
});

test('the worker\'s own words win over the local fallback', () => {
  assert.match(oneshotStopExplanation({ error: 'review_mismatch', missing: ['ISR choice is missing'] }),
    /ISR choice is missing/);
  assert.match(oneshotStopExplanation({ error: 'deal_not_open', instruction: 'Deal 123 is closed.' }),
    /Deal 123 is closed\./);
});

test('an unknown code degrades quietly instead of printing noise', () => {
  assert.equal(oneshotStopExplanation({ error: 'some_new_code' }), '');
  assert.equal(oneshotStopExplanation({}), '');
  assert.equal(oneshotStopExplanation(null), '');
});

// ── Dropping an option must skip the OPTION, never just one licence line ─────
// When per-option failures became drops instead of suppressing the whole set,
// three of the drop sites sat inside a `for (const { sku } of licenseLines)` loop.
// A bare `continue` there skipped only that licence and published the bad option
// anyway, silently defeating the tier guards. All drops now `continue optionLoop`.

test('a wrong licence tier still rejects the option, it is not merely skipped', () => {
  const essentialsWhenAdvancedAsked = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-3Y&qty=2,2',
  }], [{ sku: 'C9300-24P-M', qty: 2 }], { licenseTier: 'A' });
  assert.equal(essentialsWhenAdvancedAsked.ok, false,
    'an Essentials licence must not satisfy an Advanced request');
  assert.equal((essentialsWhenAdvancedAsked.urls || []).length, 0, 'and nothing may be published');
});

test('a mismatched licence term still rejects the option', () => {
  const wrongTerm = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=2,2',
  }], [{ sku: 'MR44', qty: 2 }], { requireLicensedOption: true });
  assert.equal(wrongTerm.ok, false, 'a 1-year licence in the 3-Year option must be rejected');
});

test('a Hardware Only option carrying a licence still rejects', () => {
  const bad = verifyStratusOrderUrlOptions([{
    label: 'Hardware Only',
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=2,2',
  }], [{ sku: 'MR44', qty: 2 }], {});
  assert.equal(bad.ok, false);
});

test('a good option alongside a bad one publishes only the good one', () => {
  const mixed = verifyStratusOrderUrlOptions([
    { label: '3-Year', url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=2,2' },
    { label: '5-Year', url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=2,2' },
  ], [{ sku: 'MR44', qty: 2 }], { requireLicensedOption: true });
  assert.equal(mixed.ok, true, 'the matching option must still be usable');
  assert.deepEqual(mixed.urls.map((o) => o.label), ['3-Year']);
  assert.equal(mixed.dropped.length, 1);
  assert.match(mixed.dropped[0].reason, /mismatched license term/);
});
