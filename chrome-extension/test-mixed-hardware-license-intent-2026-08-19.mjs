// Fix (2026-08-19): a MIXED request lost every licence.
//
// "quote 6 CW9164, 2 MX65 licenses, and 5 MR44 hardware only" is three different
// intents in one request, and the worker got it exactly right:
//   CW9164I-MR x6 + LIC-ENT-1YR x6 + LIC-MX65-SEC-1YR x2 + MR44-HW x5
// The panel then discarded all six options and replaced them with a single
// all-hardware link, because typedHardwareOnlyResult fired on the phrase
// "hardware only" appearing ANYWHERE in the text.
//
// The same override also broke the per-line "None (hardware only)" option, since
// the editor's re-serialization contains that phrase on one line.
//
// The override now requires the request to be hardware-only for the WHOLE cart:
// no licence intent survives once the hardware-only phrases are stripped, and
// every SKU-bearing clause carries the phrase itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const chatSource = fs.readFileSync(path.join(__dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');

// The detector is a panel-local helper, so it is lifted out by source slice.
// Keeping it local is deliberate: it only guards this one override.
const isWholeCartHardwareOnlyText = (() => {
  const start = chatSource.indexOf('const TYPED_HW_ONLY_PHRASE');
  const end = chatSource.indexOf('function typedHardwareOnlyResult');
  assert.ok(start > -1 && end > start, 'the detector must exist ahead of the override');
  return new Function(`${chatSource.slice(start, end)}\nreturn isWholeCartHardwareOnlyText;`)();
})();

test('the reported mixed request does not trigger the override', () => {
  assert.equal(
    isWholeCartHardwareOnlyText('quote 6 CW9164, 2 MX65 licenses, and 5 MR44 hardware only'),
    false,
    'APs with licences, an MX licence, and hardware-only APs must all survive');
});

test('the editor re-serialization of a per-line None does not trigger it', () => {
  assert.equal(isWholeCartHardwareOnlyText('5 MR44 hardware only\n6 CW9164\n2 MX65'), false);
  assert.equal(isWholeCartHardwareOnlyText('2 MX67C-NA hardware only\n4 MR44'), false);
});

test('a genuinely whole-cart hardware-only request still triggers it', () => {
  for (const text of [
    'quote 6 MR44 hardware only',
    'quote 6 MR44 hw only',
    'quote 6 MR44 no licenses',
    'quote 6 MR44 without licences',
    'quote just the hardware for 6 MR44',
  ]) {
    assert.equal(isWholeCartHardwareOnlyText(text), true, text);
  }
});

test('every clause carrying the phrase counts as whole-cart', () => {
  assert.equal(isWholeCartHardwareOnlyText('quote 2 MX67C hardware only and 4 MR44 hardware only'), true);
  assert.equal(isWholeCartHardwareOnlyText('2 MX67C-NA hardware only\n4 MR44 hardware only'), true);
});

test('a trailing phrase with no competing intent covers the whole cart', () => {
  // Matches the worker's positional rule: a phrase outside the run of models
  // covers them all. This is also the long-standing safety net for a worker
  // response that wrongly included a licence.
  assert.equal(isWholeCartHardwareOnlyText('quote 2 MX67C and 4 MR44 hardware only'), true);
  assert.equal(isWholeCartHardwareOnlyText('quote 1 C9300-24P, 1 MT12, 1 MT10 hardware only'), true);
  assert.equal(isWholeCartHardwareOnlyText('hardware only for 2 MX67C and 4 MR44'), true);
});

test('a phrase BETWEEN items stays local to its own clause', () => {
  // This is the per-line None shape: the serializer puts the None row first, so
  // models follow the phrase and it must not spread to them.
  assert.equal(isWholeCartHardwareOnlyText('2 MX67C-NA hardware only\n4 MR44\n3 MS130-24'), false);
  assert.equal(isWholeCartHardwareOnlyText('5 MR44 hardware only\n6 CW9164'), false);
});

test('licence intent alone, or no phrase at all, never triggers it', () => {
  assert.equal(isWholeCartHardwareOnlyText('quote 6 MR44 licenses'), false);
  assert.equal(isWholeCartHardwareOnlyText('quote 6 CW9164 and 5 MR44'), false);
  assert.equal(isWholeCartHardwareOnlyText('quote 6 MR44 renewal'), false);
  assert.equal(isWholeCartHardwareOnlyText(''), false);
  assert.equal(isWholeCartHardwareOnlyText(null), false);
});

test('prose with no SKU clause never triggers it', () => {
  assert.equal(isWholeCartHardwareOnlyText('what hardware do you recommend'), false);
  assert.equal(isWholeCartHardwareOnlyText('is hardware only cheaper'), false);
});

test('the override is gated on the detector, not the bare phrase', () => {
  assert.match(chatSource, /if \(!result \|\| !isWholeCartHardwareOnlyText\(text\)\) \{/,
    'typedHardwareOnlyResult must consult the whole-cart detector');
});

// ── The pinned contact reaches the plan by id as well as by email ───────────

test('a pinned Contact sends its record id, not only its email', () => {
  assert.match(chatSource, /base\.contact_id = pin\.recordId;/,
    'the id must always ride along, because the pin\'s email may not be enriched yet');
  assert.match(chatSource, /if \(pin\.email\) base\.contact_email = pin\.email;/);
});

test('the worker resolves a pinned contact by id when no email came along', () => {
  const workerSource = fs.readFileSync(path.join(__dirname, '../worker-gchat/src/index.js'), 'utf8');
  assert.match(workerSource, /async function resolveOneshotContactById/);
  assert.match(workerSource, /\} else if \(selectedEmail \|\| pinnedContactRecordId\) \{/,
    'the contact branch must run for a pinned id with no email');
  assert.match(workerSource, /: await resolveOneshotContactById\(pinnedContactRecordId, env\)/);
  assert.match(workerSource, /contact_id: p\.contact_id \|\| undefined,/,
    'the id must survive a replan');
});

// ── The contact the panel already shows is forwarded (2026-08-19) ────────────
// The bar read "Contact: Trevor Goode" while the one-shot payload sent nothing,
// so the plan blocked on ambiguous_contact and the card asked "pick the customer"
// for someone already on screen. Only an explicit DROPDOWN pick used to ride
// along; the shown contact falls back to the auto-detected thread contact.

test('the shown context contact is forwarded when it is an eligible participant', () => {
  assert.match(chatSource, /const shownContextEmail = String\(activeContextEmail \|\| ''\)\.trim\(\)\.toLowerCase\(\)/,
    'the panel must read the contact it is displaying');
  assert.match(chatSource,
    /participants\.some\(\(c\) => c\.email === shownContextEmail\) \? shownContextEmail : undefined/,
    'and forward it only when the captured participant list contains it');
  assert.match(chatSource, /contact_email: forwardedContactEmail,/);
});

test('an explicit dropdown pick still wins over the shown contact', () => {
  const order = chatSource.indexOf('const forwardedContactEmail = participants.some((c) => c.email === explicitlySelectedEmail)');
  assert.ok(order > -1, 'the explicit pick must be tested first');
  const shownAfter = chatSource.indexOf('shownContextEmail) ? shownContextEmail : undefined', order);
  assert.ok(shownAfter > order, 'the shown contact is only the fallback');
});

test('a forwarded thread contact is labelled as such, not as a click', () => {
  assert.match(chatSource, /contact_email_source: 'panel-context'/,
    'the card must be able to say the contact came from the thread');
});

test('a contact from another conversation still cannot leak', () => {
  // Both branches are gated on the captured participant list, so an email that is
  // not on this thread is never forwarded.
  const gate = (chatSource.match(/participants\.some\(\(c\) => c\.email === \w+\)/g) || []);
  assert.ok(gate.length >= 2, `both paths must be eligibility-gated, found ${gate.length}`);
});
