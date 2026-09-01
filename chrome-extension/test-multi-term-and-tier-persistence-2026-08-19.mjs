// Two defects found in live use right after per-line "None (hardware only)"
// started working (Chris, 2026-08-19).
//
// 1. THE EDITOR CONTRADICTED THE QUOTE. A row set to "None" redrew as
//    "Enterprise (ENT) - default" on the next render, because the committed
//    rows written back to draftRows come from normalizeEditableQuoteLines,
//    which returns only { sku, qty }. The links were right; the dropdown lied.
//
// 2. THE SECOND QUOTE FAILED. Creating a 3-year AND a 5-year quote created the
//    3-year one and failed the 5-year with product_snapshot_mismatch. The
//    extra-term PLAN spreads msg.base, so it receives hardware_only_skus; the
//    extra-term EXECUTE rebuilt its payload from scratch and omitted it. That
//    field is bound into the review fingerprint, so Plan and Execute hashed
//    differently. Same latent hole existed for ha_recalculate_license_qty.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.dirname(fileURLToPath(import.meta.url));
const core = await import(path.join(EXT, 'src/sidebar/components/sku-editor-core.mjs'));
const CHAT = fs.readFileSync(path.join(EXT, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');

const CHRIS_ROWS = [
  { sku: 'CW9164', qty: 6, tier: '' },
  { sku: 'MX65', qty: 2, tier: '' },
  { sku: 'MR44', qty: 6, tier: 'none' },
];

test('a per-row None survives onto the committed rows', () => {
  const prepared = core.quoteTextFromEditorRows(CHRIS_ROWS, '6 CW9164, 2 MX65 licenses, 6 MR44', {});
  assert.equal(prepared.ok, true, prepared.error);
  const mr44 = prepared.rows.find((r) => r.sku === 'MR44');
  assert.equal(mr44.tier, 'none', 'the None choice must not be erased on write-back');
  // A row with no explicit tier stays clean rather than gaining an empty one.
  assert.equal('tier' in prepared.rows.find((r) => r.sku === 'CW9164'), false);
});

test('re-serializing the committed rows is stable', () => {
  // The editor feeds its own committed rows back in on the next update. If the
  // tier were lost, the second pass would drop "hardware only" and silently
  // re-licence the row.
  const first = core.quoteTextFromEditorRows(CHRIS_ROWS, '6 CW9164, 2 MX65 licenses, 6 MR44', {});
  const second = core.quoteTextFromEditorRows(first.rows, first.text, {});
  assert.equal(second.text, first.text);
  assert.deepEqual(second.hardwareOnlySkus, first.hardwareOnlySkus);
  assert.deepEqual(second.hardwareOnlySkus, ['MR44']);
});

test('the tier is resolved by SKU, not by position', () => {
  // normalizeEditableQuoteLines MERGES duplicate SKUs, so the committed list is
  // shorter than the editor list and positional lookup lands on the wrong row.
  const rows = [
    { sku: 'MR44', qty: 2, tier: 'none' },
    { sku: 'MR44', qty: 4, tier: 'none' },
    { sku: 'CW9164', qty: 6, tier: '' },
  ];
  const prepared = core.quoteTextFromEditorRows(rows, '', {});
  assert.equal(prepared.ok, true, prepared.error);
  const mr44 = prepared.rows.find((r) => r.sku === 'MR44');
  assert.equal(mr44.qty, 6, 'duplicates merge');
  assert.equal(mr44.tier, 'none');
  assert.deepEqual(prepared.hardwareOnlySkus, ['MR44']);
});

test('a licence row never keeps a tier', () => {
  const prepared = core.quoteTextFromEditorRows(
    [{ sku: 'LIC-ENT-3YR', qty: 6, tier: 'none', licenseIntent: 'paired' }, { sku: 'MR44', qty: 6, tier: '' }], '', {});
  assert.equal(prepared.ok, true, prepared.error);
  assert.deepEqual(prepared.hardwareOnlySkus, [], 'a LIC- row is not hardware');
  assert.ok(!/LIC-ENT-3YR hardware only/i.test(prepared.text));
});

// ── Source wiring: the extra-term execute must send the fingerprint fields ──

function extraTermExecuteBlock() {
  const marker = 'idempotency_key: `${msg.idempotencyKey}:term:';
  const start = CHAT.indexOf(marker);
  assert.ok(start > 0, 'extra-term execute payload not found');
  const end = CHAT.indexOf('}).catch', start);
  assert.ok(end > start);
  return CHAT.slice(start, end);
}

test('the extra-term execute forwards hardware_only_skus', () => {
  assert.match(extraTermExecuteBlock(), /hardware_only_skus/,
    'without this the 5-year quote fails product_snapshot_mismatch');
});

test('the extra-term execute forwards zoho_list_price_skus', () => {
  assert.match(extraTermExecuteBlock(), /zoho_list_price_skus/,
    'Zoho-only pricing is bound into the product snapshot fingerprint');
});

test('the extra-term execute forwards ha_recalculate_license_qty', () => {
  assert.match(extraTermExecuteBlock(), /ha_recalculate_license_qty/);
});

test('the extra-term plan still inherits the base payload', () => {
  // It is what puts hardware_only_skus into the PLAN half of the pair.
  const marker = 'const planRes = await sendToBackground(MSG.ONESHOT_PLAN, {';
  const start = CHAT.indexOf(marker);
  assert.ok(start > 0);
  assert.match(CHAT.slice(start, CHAT.indexOf('}).catch', start)), /\.\.\.msg\.base/);
});

test('the first-quote execute also forwards hardware_only_skus', () => {
  const start = CHAT.indexOf('idempotency_key: msg.idempotencyKey,');
  assert.ok(start > 0);
  assert.match(CHAT.slice(start, CHAT.indexOf('...decisions', start)), /hardware_only_skus/);
});

test('the first-quote execute also forwards zoho_list_price_skus', () => {
  const start = CHAT.indexOf('idempotency_key: msg.idempotencyKey,');
  assert.ok(start > 0);
  assert.match(CHAT.slice(start, CHAT.indexOf('...decisions', start)), /zoho_list_price_skus/);
});
