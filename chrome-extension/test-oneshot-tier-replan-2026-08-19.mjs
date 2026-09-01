// Fix (2026-08-19): "Revalidate / re-plan" wiped the hardware off a one-shot plan.
//
// Repro: a plan holding hardware AND its derived licences, with a licence tier
// set on one hardware row. revalidateEditedProducts requoted the WHOLE row set,
// derived licences included. Two things went wrong downstream:
//   1. the worker read the combined text as a licence-only list and dropped
//      every device (fixed worker-side, see the matching worker test), and
//   2. even once hardware survived, the worker derived a licence per device AND
//      kept the re-sent ones, so licence quantities doubled.
//
// Fix: the requote sends only the hardware. Derived licences are rebuilt by the
// worker at the new tier; a licence that belongs to no device in this cart is
// re-attached afterwards so it is not lost.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  skuModelToken,
  skuVariantDigits,
  sameDeviceIdentity,
  splitRowsForTierRequote,
  quoteTextFromEditorRows,
  termFromLicenseRows,
} from './src/sidebar/components/sku-editor-core.mjs';
import { withHardwareOnlyQuoteOption } from './src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatSource = fs.readFileSync(
  path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');

const skus = (rows) => rows.map((r) => r.sku);

test('skuModelToken reduces a licence and its device to the same token', () => {
  assert.equal(skuModelToken('LIC-MX67C-SEC-1YR'), 'MX67C');
  assert.equal(skuModelToken('MX67C-NA'), 'MX67C');
  assert.equal(skuModelToken('LIC-C9200L-24E-1Y'), 'C9200L');
  assert.equal(skuModelToken('C9200L-24P-4G-M'), 'C9200L');
  assert.equal(skuModelToken('LIC-MS150-48-1Y'), 'MS150');
  assert.equal(skuModelToken('MS150-48LP-4G'), 'MS150');
  // A family licence carries no model, so it can never match a device token.
  assert.equal(skuModelToken('LIC-ENT-1YR'), 'ENT');
  assert.equal(skuModelToken(''), '');
  assert.equal(skuModelToken(null), '');
});

test('the reported cart splits into hardware and its derived licences', () => {
  const rows = [
    { sku: 'C9200L-24P-4G-M', qty: 1, tier: '' },
    { sku: 'MS150-48LP-4G', qty: 1, tier: '' },
    { sku: 'MX67C-NA', qty: 2, tier: 'security' },
    { sku: 'LIC-C9200L-24E-1Y', qty: 1 },
    { sku: 'LIC-MS150-48-1Y', qty: 1 },
    { sku: 'LIC-MX67C-SEC-1YR', qty: 2 },
  ];
  const { hardwareRows, derivedLicenseRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);

  assert.deepEqual(skus(hardwareRows), ['C9200L-24P-4G-M', 'MS150-48LP-4G', 'MX67C-NA']);
  assert.deepEqual(skus(derivedLicenseRows),
    ['LIC-C9200L-24E-1Y', 'LIC-MS150-48-1Y', 'LIC-MX67C-SEC-1YR']);
  assert.deepEqual(standaloneLicenseRows, [],
    'every licence here belongs to a device in the cart');
});

test('the requote text carries the hardware and its tier, and no licence rows', () => {
  const rows = [
    { sku: 'MX67C-NA', qty: 2, tier: 'security' },
    { sku: 'MR44', qty: 3, tier: 'advanced' },
    { sku: 'LIC-MX67C-SEC-1YR', qty: 2 },
    { sku: 'LIC-ENT-1YR', qty: 3 },
  ];
  const { hardwareRows } = splitRowsForTierRequote(rows);
  const prepared = quoteTextFromEditorRows(hardwareRows, '', {});

  assert.ok(prepared.ok, prepared.error);
  assert.doesNotMatch(prepared.text, /LIC-/,
    'a derived licence must never be requoted, the worker rebuilds it');
  assert.match(prepared.text, /2 MX67C-NA security/);
  assert.match(prepared.text, /3 MR44 advanced/,
    'each row keeps its own tier so a mixed cart does not collapse to one tier');
});

test('a licence for hardware not in the cart is kept as standalone', () => {
  // 7 MR licences bought alongside an MX. Nothing here derives them, so losing
  // them would silently drop a line from the customer quote.
  const rows = [
    { sku: 'MX67C-NA', qty: 1, tier: 'security' },
    { sku: 'LIC-MX67C-SEC-1YR', qty: 1 },
    { sku: 'LIC-MS250-48-3YR', qty: 4 },
  ];
  const { derivedLicenseRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
  assert.deepEqual(skus(derivedLicenseRows), ['LIC-MX67C-SEC-1YR']);
  assert.deepEqual(skus(standaloneLicenseRows), ['LIC-MS250-48-3YR']);
});

test('a licence-only cart has no hardware to requote', () => {
  const rows = [
    { sku: 'LIC-C9200L-24E-3Y', qty: 1 },
    { sku: 'LIC-MS150-48-3Y', qty: 1 },
    { sku: 'LIC-MX67C-SEC-3YR', qty: 2 },
  ];
  const { hardwareRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
  assert.deepEqual(hardwareRows, [], 'nothing to requote');
  assert.equal(standaloneLicenseRows.length, 3,
    'with no hardware every licence is standalone, and the caller passes the rows through');
});

test('splitRowsForTierRequote tolerates junk input', () => {
  assert.deepEqual(splitRowsForTierRequote(null).hardwareRows, []);
  assert.deepEqual(splitRowsForTierRequote(undefined).standaloneLicenseRows, []);
  const { hardwareRows } = splitRowsForTierRequote([{ sku: '', qty: 1 }, {}]);
  assert.equal(hardwareRows.length, 2, 'blank rows are not licences, they stay hardware-side');
});

// ── The sidebar wiring, so the helper cannot be left unused ──

test('revalidateEditedProducts requotes hardware only and re-attaches standalones', () => {
  assert.match(chatSource, /splitRowsForTierRequest|splitRowsForTierRequote/,
    'ChatPanel must use the splitter');
  assert.match(chatSource,
    /const \{ hardwareRows, standaloneLicenseRows \} = splitRowsForTierRequote\(rows\)/,
    'the re-plan path must split the rows before requoting');
  assert.match(chatSource,
    /hardwareRows\.length \? quoteTextFromEditorRows\(hardwareRows, '', \{\}\) : prepared/,
    'the requote text must be built from the hardware rows alone');
  assert.match(chatSource, /!parsed\.some\(\(item\) => sameDeviceIdentity\(item\.sku, row\.sku\)\)/,
    'a standalone licence the requote produced anyway must not be added twice');
  assert.doesNotMatch(chatSource, /const quoteRes = await runQuote\(prepared\.text, 'oneshot-replan'\)/,
    'the old whole-cart requote must be gone');
});

// ── Bugs found by the harness probe sweep (2026-08-19) ──────────────────────

test('skuVariantDigits separates devices that share a model token', () => {
  assert.equal(skuVariantDigits('MS130-24'), '24');
  assert.equal(skuVariantDigits('MS130-48'), '48');
  assert.equal(skuVariantDigits('MS150-48LP-4G'), '48');
  assert.equal(skuVariantDigits('C9200L-24P-4G-M'), '24');
  assert.equal(skuVariantDigits('LIC-MS130-24A-1Y'), '24');
  assert.equal(skuVariantDigits('LIC-C9200L-24E-1Y'), '24');
  // No port count to compare: the model token alone identifies these.
  assert.equal(skuVariantDigits('MX67C-NA'), '');
  assert.equal(skuVariantDigits('LIC-MX67C-SEC-1YR'), '');
  // A term suffix is not a variant, or LIC-ENT-1YR would read as variant "1".
  assert.equal(skuVariantDigits('LIC-ENT-1YR'), '');
  assert.equal(skuVariantDigits(''), '');
});

test('sameDeviceIdentity does not confuse a 24-port with a 48-port', () => {
  assert.equal(sameDeviceIdentity('LIC-MS130-24-3Y', 'MS130-24'), true);
  assert.equal(sameDeviceIdentity('LIC-MS130-48-3Y', 'MS130-48'), true);
  assert.equal(sameDeviceIdentity('LIC-MS130-48-3Y', 'MS130-24'), false);
  assert.equal(sameDeviceIdentity('LIC-MS120-24-3YR', 'MS120-8FP'), false);
  // The port code differs between a switch and its licence (24P vs 24E), so the
  // digits are compared, not the whole segment.
  assert.equal(sameDeviceIdentity('LIC-C9200L-24E-1Y', 'C9200L-24P-4G-M'), true);
  // Tier-coded licences carry no port count and match on the model alone.
  assert.equal(sameDeviceIdentity('LIC-MX67C-SEC-1YR', 'MX67C-NA'), true);
  assert.equal(sameDeviceIdentity('LIC-ENT-1YR', 'MR44'), false);
  assert.equal(sameDeviceIdentity('', 'MR44'), false);
});

test('a licence for a port variant not in the cart stays standalone', () => {
  // Regression: LIC-MS130-48-3Y was silently dropped because it shares the
  // token MS130 with the MS130-24 that IS in the cart.
  const rows = [
    { sku: 'MS130-24', qty: 2, tier: 'advanced' },
    { sku: 'LIC-MS130-24-3Y', qty: 2 },
    { sku: 'LIC-MS130-48-3Y', qty: 4 },
  ];
  const { derivedLicenseRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
  assert.deepEqual(skus(derivedLicenseRows), ['LIC-MS130-24-3Y']);
  assert.deepEqual(skus(standaloneLicenseRows), ['LIC-MS130-48-3Y'],
    'a licence for hardware that is not in the cart must be carried across');
});

test('both port variants in one cart are each treated as derived', () => {
  const rows = [
    { sku: 'MS130-24', qty: 2, tier: 'advanced' },
    { sku: 'MS130-48', qty: 3, tier: 'advanced' },
    { sku: 'LIC-MS130-24-3Y', qty: 2 },
    { sku: 'LIC-MS130-48-3Y', qty: 3 },
  ];
  const { derivedLicenseRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
  assert.equal(derivedLicenseRows.length, 2, 'both licences belong to hardware here');
  assert.deepEqual(standaloneLicenseRows, []);
});

test('a tier is never serialized onto a licence line', () => {
  // Row state can still carry a tier after the SKU is edited from hardware to a
  // licence. "2 LIC-MX67C-SEC-1YR enterprise" asks for two tiers at once.
  const prepared = quoteTextFromEditorRows([{ sku: 'LIC-MX67C-SEC-1YR', qty: 2, tier: 'enterprise' }], '', {});
  assert.ok(prepared.ok, prepared.error);
  assert.equal(prepared.text.trim(), '2 LIC-MX67C-SEC-1YR');
  assert.doesNotMatch(prepared.text, /enterprise|security|advanced/i);
});

test('a stale tier on a licence row does not disturb the hardware rows', () => {
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX67C-NA', qty: 2, tier: 'security' },
    { sku: 'LIC-ENT-1YR', qty: 3, tier: 'advanced' },
  ], '', {});
  assert.ok(prepared.ok, prepared.error);
  assert.match(prepared.text, /2 MX67C-NA security/, 'the hardware tier still rides along');
  assert.match(prepared.text, /3 LIC-ENT-1YR(\n|$)/, 'the licence line is left bare');
});

test('termFromLicenseRows reads the term the plan is already quoting', () => {
  assert.equal(termFromLicenseRows([
    { sku: 'MX67C-NA', qty: 1 }, { sku: 'LIC-MX67C-SEC-1YR', qty: 1 },
  ]), '1');
  assert.equal(termFromLicenseRows([
    { sku: 'LIC-C9200L-24E-5Y', qty: 1 }, { sku: 'LIC-MS150-48-5Y', qty: 1 },
  ]), '5');
  // Disagreeing or absent terms return null so the caller can decide, rather
  // than picking one of them at random.
  assert.equal(termFromLicenseRows([
    { sku: 'LIC-MX67C-SEC-1YR', qty: 1 }, { sku: 'LIC-MS150-48-3Y', qty: 1 },
  ]), null);
  assert.equal(termFromLicenseRows([{ sku: 'MR44', qty: 2 }]), null);
  assert.equal(termFromLicenseRows([]), null);
  assert.equal(termFromLicenseRows(null), null);
});

test('the re-plan term comes from the plan, not a hardcoded 3 years', () => {
  assert.match(chatSource,
    /const term = String\(msg\.base\?\.license_term \|\| termFromLicenseRows\(rows\) \|\| '3'\)/,
    'a missing license_term must fall back to the plan\'s own licence rows first');
  assert.match(chatSource, /!parsed\.some\(\(item\) => sameDeviceIdentity\(item\.sku, row\.sku\)\)/,
    'the carry-across filter must match on device identity, not the bare model token');
});

// ── Hardware Only option, now a shared lib function (2026-08-19) ────────────
// It used to be a ChatPanel closure called from only one of the two quote paths,
// so a fresh chat quote never offered the option and no test could reach it.

test('an all-hardware cart is offered Hardware Only', () => {
  const result = { urls: [{ label: '1-Year', url: 'https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=4,4' }] };
  const rows = [{ sku: 'MR44-HW', qty: 4 }];
  const out = withHardwareOnlyQuoteOption(result, rows);
  const hw = (out.urls || []).find((o) => o.hardwareOnly === true);
  assert.ok(hw, 'a Hardware Only option must be added');
  assert.equal(hw.label, 'Hardware Only');
  assert.match(hw.url, /item=MR44-HW&qty=4$/, 'the URL is exactly the committed hardware rows');
  assert.equal(out.urls.length, 2, 'the term option is kept alongside it');
});

test('a cart containing a licence row is not offered Hardware Only', () => {
  const result = { urls: [{ label: '1-Year', url: 'https://x/?item=A&qty=1' }] };
  const out = withHardwareOnlyQuoteOption(result, [
    { sku: 'MR44-HW', qty: 4 }, { sku: 'LIC-ENT-1YR', qty: 4 },
  ]);
  assert.equal((out.urls || []).some((o) => o.hardwareOnly), false,
    'the synthesized URL would not equal the committed rows, so no option is offered');
});

test('multi-line hardware carts keep every line in the option URL', () => {
  const out = withHardwareOnlyQuoteOption({ urls: [] }, [
    { sku: 'CW9176I-RTG', qty: 3 }, { sku: 'MR44-HW', qty: 4 }, { sku: 'MX67C-NA', qty: 2 },
  ]);
  const hw = out.urls.find((o) => o.hardwareOnly);
  assert.match(hw.url, /item=CW9176I-RTG,MR44-HW,MX67C-NA&qty=3,4,2$/);
});

test('an empty or licence-only cart yields no Hardware Only option', () => {
  assert.equal((withHardwareOnlyQuoteOption({ urls: [] }, []).urls || []).length, 0);
  assert.equal((withHardwareOnlyQuoteOption({ urls: [] }, [{ sku: 'LIC-ENT-1YR', qty: 2 }]).urls || []).length, 0);
});

test('re-applying the option does not duplicate it', () => {
  const rows = [{ sku: 'MR44-HW', qty: 4 }];
  const once = withHardwareOnlyQuoteOption({ urls: [] }, rows);
  const twice = withHardwareOnlyQuoteOption(once, rows);
  assert.equal(twice.urls.filter((o) => o.hardwareOnly).length, 1);
});

test('both quote paths in ChatPanel offer the option', () => {
  const calls = (chatSource.match(/withHardwareOnlyQuoteOption\(/g) || []).length;
  assert.ok(calls >= 2,
    `expected the fresh-quote and update paths to call it, found ${calls} call(s)`);
  assert.doesNotMatch(chatSource, /function appendEmailHardwareOnlyOption/,
    'the panel-local copy must be gone so the two cannot drift');
});
