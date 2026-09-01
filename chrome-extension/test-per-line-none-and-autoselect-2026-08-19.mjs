// 2026-08-19 requests and the deal-contact diagnosis.
//
// 1. PER-LINE "None (hardware only)". A request-level "hardware only" strips
//    every licence; there was no way to quote one device bare while the rest keep
//    theirs. The phrase is now attached to that row's own clause.
//
//    Ordering matters and is not cosmetic: a strong "hardware only" AFTER the
//    last item is read as covering the whole request (that is what makes a typed
//    "2 MX67C and 4 MR44 hardware only" behave), so a None on the final row would
//    strip every licence in the cart. Hardware-only rows are emitted first.
//
// 2. A pinned Contact seeds the plan, and a sole ISR candidate is preselected.
//
// 3. reviewed_deal_contact_differs replaces a misleading
//    "reviewed_deal_target_changed — the Deal Contact changed after Plan" for the
//    case that actually happened: the chosen Deal belongs to another person at
//    the same Account, so nothing had changed at all.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  quoteTextFromEditorRows,
  licenseTierOptionsForSku,
  rowIsHardwareOnly,
} from './src/sidebar/components/sku-editor-core.mjs';
import { oneshotStopExplanation } from './src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatSource = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
const text = (rows) => quoteTextFromEditorRows(rows, '', {}).text;

// ── 1. Per-line None ────────────────────────────────────────────────────────

test('None is offered on every licensable family and nowhere else', () => {
  for (const sku of ['MX67C-NA', 'Z4-HW', 'MR44', 'CW9164I-MR', 'MS130-24', 'C9200L-24P-4G-M']) {
    const values = licenseTierOptionsForSku(sku).map((o) => o.value);
    assert.ok(values.includes('none'), `${sku} should offer None, got ${values.join(',')}`);
  }
  // A licence row has no tier dropdown at all, so it must not gain a None entry.
  assert.deepEqual(licenseTierOptionsForSku('LIC-MX67C-SEC-1YR').map((o) => o.value), ['']);
});

test('rowIsHardwareOnly reads the None selection', () => {
  assert.equal(rowIsHardwareOnly({ tier: 'none' }), true);
  assert.equal(rowIsHardwareOnly({ tier: 'NONE' }), true);
  assert.equal(rowIsHardwareOnly({ tier: 'security' }), false);
  assert.equal(rowIsHardwareOnly({ tier: '' }), false);
  assert.equal(rowIsHardwareOnly({}), false);
  assert.equal(rowIsHardwareOnly(null), false);
});

test('None marks only its own row hardware-only', () => {
  const out = text([{ sku: 'MX67C-NA', qty: 2, tier: 'none' }, { sku: 'MR44', qty: 4, tier: '' }]);
  assert.match(out, /^2 MX67C-NA hardware only$/m);
  assert.match(out, /^4 MR44$/m, 'the other row stays licensed');
});

test('a None row is emitted before licensed rows whatever the row order', () => {
  // The regression this ordering prevents: a trailing "hardware only" covers the
  // whole request, so a None on the last row would strip every licence.
  const out = text([{ sku: 'MR44', qty: 4, tier: '' }, { sku: 'MX67C-NA', qty: 2, tier: 'none' }]);
  const lines = out.trim().split('\n');
  assert.equal(lines[0], '2 MX67C-NA hardware only');
  assert.equal(lines.at(-1), '4 MR44');
  assert.doesNotMatch(lines.at(-1), /hardware only/,
    'the final line must not carry the phrase, or it applies list-wide');
});

test('None coexists with an explicit tier on another row', () => {
  const out = text([{ sku: 'MX67C-NA', qty: 2, tier: 'none' }, { sku: 'MR44', qty: 4, tier: 'advanced' }]);
  assert.match(out, /^2 MX67C-NA hardware only$/m);
  assert.match(out, /^4 MR44 advanced$/m);
});

test('None on three rows keeps a licensed line last', () => {
  const out = text([
    { sku: 'MR44', qty: 4, tier: '' },
    { sku: 'MX67C-NA', qty: 2, tier: 'none' },
    { sku: 'MS130-24', qty: 3, tier: '' },
  ]);
  const lines = out.trim().split('\n');
  assert.equal(lines[0], '2 MX67C-NA hardware only');
  assert.doesNotMatch(lines.at(-1), /hardware only/);
  assert.equal(lines.filter((l) => /hardware only/.test(l)).length, 1);
});

test('a cart that is entirely None is a hardware-only cart', () => {
  const out = text([{ sku: 'MX67C-NA', qty: 2, tier: 'none' }, { sku: 'MR44', qty: 4, tier: 'none' }]);
  assert.equal(out.trim().split('\n').filter((l) => /hardware only/.test(l)).length, 2);
});

test('a cart with no None is byte-identical to before', () => {
  assert.equal(text([{ sku: 'MX67C-NA', qty: 2, tier: 'security' }, { sku: 'MR44', qty: 4, tier: '' }]).trim(),
    '2 MX67C-NA security\n4 MR44');
  assert.equal(text([{ sku: 'MX67C-NA', qty: 2, tier: '' }, { sku: 'MR44', qty: 4, tier: '' }]).trim(),
    '2 MX67C-NA\n4 MR44');
});

test('a stale None on a licence row is ignored', () => {
  const out = text([{ sku: 'LIC-ENT-1YR', qty: 3, tier: 'none' }, { sku: 'MR44', qty: 4, tier: 'advanced' }]);
  assert.doesNotMatch(out, /LIC-ENT-1YR hardware only/,
    'a licence line has no hardware to strip');
});

// ── 2. Auto-selection ───────────────────────────────────────────────────────

test('a pinned Contact seeds the plan contact and account', () => {
  assert.match(chatSource, /if \(pin && pin\.module === 'Contacts' && pin\.recordId\)/);
  assert.match(chatSource, /if \(pin\.email\) base\.contact_email = pin\.email;/);
  assert.match(chatSource, /base\.account_id = base\.account_id \|\| pin\.accountId/,
    'an explicit Account pin must still win over the contact\'s account');
});

test('a sole ISR candidate is preselected, several still require a pick', () => {
  assert.match(chatSource, /isr\.candidates\.length === 1/);
  assert.match(chatSource, /useState\(\(isr\.rep && isr\.rep\.email\) \|\| isrSoleCandidate \|\| ''\)/);
});

// ── 3. The deal-contact message ─────────────────────────────────────────────

test('the deal-target explanation names the differing-contact case', () => {
  // The error CODE is deliberately unchanged: it is a fail-closed contract the
  // worker suite pins. Only the wording improved.
  const explained = oneshotStopExplanation({ error: 'reviewed_deal_target_changed' });
  assert.match(explained, /different contact at the same Account/);
  assert.doesNotMatch(explained, /changed after Plan/,
    'nothing changed; the deal simply belongs to someone else');
  // The worker's own detail still wins when it arrives.
  assert.match(
    oneshotStopExplanation({ error: 'reviewed_deal_target_changed', detail: 'Nothing changed after Plan; the Deal simply belongs to someone else.' }),
    /belongs to someone else/);
});

test('the plan surfaces a differing deal contact as information, and Execute allows it', () => {
  const workerSource = fs.readFileSync(
    path.join(__dirname, '../worker-gchat/src/index.js'), 'utf8');
  assert.match(workerSource, /code: 'deal_contact_differs'/,
    'the plan must raise the advisory');
  assert.match(workerSource, /Closing_Date, Contact_Name from Deals/,
    'the open-deals query must select the contact so the check can run');
  // 2026-08-19, revised: this is no longer refused at all. A quote's contact may
  // differ from the Deal's primary contact, so Execute must ALLOW it.
  assert.match(workerSource, /requireContactMatch: false/,
    'the Deal-level check must not compare the Deal\'s primary contact');
  assert.match(workerSource, /approve_contact_account_mismatch/,
    'a contact on a different Account is approvable instead');
  assert.match(chatSource, /b\.code === 'deal_contact_differs'/,
    'the card must render it in plain language');
});
