import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  collectConcreteLicenseTerms,
  isMixedLicenseTermCart,
  mixedTermApprovalState,
} from './src/lib/mixed-term-approval.mjs';

const MIXED_ROWS = [
  { sku: 'MX67-HW', qty: 1 },
  { sku: 'LIC-MX67-SEC-1YR', qty: 1, licenseIntent: 'standalone' },
  { sku: 'LIC-ENT-3YR', qty: 2, licenseIntent: 'standalone' },
  { sku: 'LIC-MS130-24-5Y', qty: 1, licenseIntent: 'standalone' },
];

const UNIFORM_ROWS = [
  { sku: 'MX67-HW', qty: 1 },
  { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  { sku: 'LIC-ENT-3YR', qty: 2 },
];

test('mixed-term flag lists the distinct 1/3/5-year concrete license terms', () => {
  assert.deepEqual(collectConcreteLicenseTerms(MIXED_ROWS), ['1', '3', '5']);
  assert.equal(isMixedLicenseTermCart(MIXED_ROWS), true);
  assert.equal(isMixedLicenseTermCart(UNIFORM_ROWS), false);
  const flagged = mixedTermApprovalState({ rows: MIXED_ROWS, approved: false });
  assert.equal(flagged.mixed, true);
  assert.equal(flagged.flag, 'Mixed 1/3/5-year license terms');
  assert.match(flagged.message, /explicit approval/i);
});

test('generate links and Zoho review stay blocked until mixed-term approval', () => {
  const blocked = mixedTermApprovalState({ rows: MIXED_ROWS, approved: false });
  assert.equal(blocked.requiresApproval, true);
  assert.equal(blocked.canGenerateLinks, false);
  assert.equal(blocked.canStartZohoReview, false);

  const zohoStart = blocked.canStartZohoReview
    ? { started: true, wroteCrm: true }
    : { started: false, wroteCrm: false };
  assert.deepEqual(zohoStart, { started: false, wroteCrm: false });
});

test('after explicit approval, generate and stubbed Zoho review start are allowed (no live Zoho)', () => {
  const allowed = mixedTermApprovalState({ rows: MIXED_ROWS, approved: true });
  assert.equal(allowed.requiresApproval, false);
  assert.equal(allowed.canGenerateLinks, true);
  assert.equal(allowed.canStartZohoReview, true);

  const startZohoReview = (state) => {
    if (!state.canStartZohoReview) return { ok: false, error: 'approval_required' };
    return { ok: true, reviewStarted: true, wroteCrm: false, stubbed: true };
  };
  const started = startZohoReview(allowed);
  assert.equal(started.ok, true);
  assert.equal(started.reviewStarted, true);
  assert.equal(started.wroteCrm, false);
  assert.equal(started.stubbed, true);
});

test('uniform-term carts do not require the mixed-term approval gate', () => {
  const state = mixedTermApprovalState({ rows: UNIFORM_ROWS, approved: false });
  assert.equal(state.mixed, false);
  assert.equal(state.canGenerateLinks, true);
  assert.equal(state.canStartZohoReview, true);
});

test('QuoteResult and SkuQuantityEditor wire the mixed-term flag and approval gate', () => {
  const quoteResult = readFileSync(new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url), 'utf8');
  const editor = readFileSync(new URL('./src/sidebar/components/SkuQuantityEditor.jsx', import.meta.url), 'utf8');
  assert.match(quoteResult, /mixedTermApprovalState/);
  assert.match(quoteResult, /mixed-term-flag/);
  assert.match(quoteResult, /Approve mixed 1\/3\/5-year terms/);
  assert.match(quoteResult, /mixedTermBlocksActions/);
  assert.match(quoteResult, /canStartZohoReview/);
  assert.match(editor, /generationHoldReason/);
  assert.match(editor, /Mixed 1\/3\/5-year license terms require explicit approval/);
});
