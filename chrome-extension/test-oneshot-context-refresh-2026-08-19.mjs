// "Refresh from current page / pin" on the one-shot card.
//
// WHY THIS EXISTS. Chris built a quote while not on the Gmail thread. The card
// therefore captured no thread participants, planned with nothing to resolve a
// customer from, and stopped at missing_contact. Opening the correct thread
// afterwards did not help: the card kept the empty participant list it was born
// with, and the only escape was to abandon it and requote (2026-08-19).
//
// The refresh returns ONLY re-plan inputs the existing pickers already send, so
// the server re-resolves the plan and every downstream guard still applies.
// Nothing is written to Zoho until Execute.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.dirname(fileURLToPath(import.meta.url));
const flow = await import(path.join(EXT, 'src/lib/email-quote-flow.mjs'));
const CHAT = fs.readFileSync(path.join(EXT, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
const { oneshotContextRefreshOverrides: refresh, oneshotContextRefreshSummary: summary } = flow;

const THREAD = [
  { email: 'TrevorGoode@bayerhfcu.com', name: 'Trevor Goode', role: 'customer' },
  { email: 'rscrudat@cisco.com', name: 'Rachel Scrudato', role: 'cisco' },
];

test('the thread the panel is showing becomes the participant list', () => {
  const o = refresh({ threadContacts: THREAD });
  assert.equal(o.participants.length, 2);
  assert.equal(o.participants[0].email, 'trevorgoode@bayerhfcu.com', 'emails are lowercased');
  assert.equal(o.participants[0].name, 'Trevor Goode');
});

test('junk entries are dropped and the list is capped', () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ email: `p${i}@x.com` }));
  const o = refresh({ threadContacts: [{ email: '' }, { email: 'not-an-email' }, null, ...many] });
  assert.equal(o.participants.length, 50);
  assert.ok(o.participants.every((c) => c.email.includes('@')));
});

test('the shown contact is forwarded when the thread lists them', () => {
  const o = refresh({ threadContacts: THREAD, shownContactEmail: 'trevorgoode@bayerhfcu.com' });
  assert.equal(o.contact_email, 'trevorgoode@bayerhfcu.com');
});

test('a contact NOT on the thread is never forwarded', () => {
  // The same gate the initial plan uses: a pick from another conversation must
  // not leak into this one.
  const o = refresh({ threadContacts: THREAD, shownContactEmail: 'someone@elsewhere.com' });
  assert.equal('contact_email' in o, false);
});

test('an explicit pick outranks the merely-shown contact', () => {
  const o = refresh({
    threadContacts: THREAD,
    selectedContactEmail: 'rscrudat@cisco.com',
    shownContactEmail: 'trevorgoode@bayerhfcu.com',
  });
  assert.equal(o.contact_email, 'rscrudat@cisco.com');
});

test('a pinned Contact is authoritative and carries its id', () => {
  // The pin names the person outright, so it does not need the thread to agree.
  const o = refresh({
    threadContacts: [],
    pin: { module: 'Contacts', recordId: '123', email: 'Trevor@bayerhfcu.com', accountId: '900' },
  });
  assert.equal(o.contact_id, '123');
  assert.equal(o.contact_email, 'trevor@bayerhfcu.com');
  assert.equal(o.account_id, '900');
});

test('a pinned Account and a pinned Deal map to their own inputs', () => {
  assert.equal(refresh({ pin: { module: 'Accounts', recordId: 'A1' } }).account_id, 'A1');
  const deal = refresh({ pin: { module: 'Deals', recordId: 'D1', accountId: 'A2' } });
  assert.equal(deal.existing_deal_id, 'D1');
  assert.equal(deal.account_id, 'A2');
});

test('a pinned Contact account does not clobber a pinned Account', () => {
  const o = refresh({
    pin: { module: 'Accounts', recordId: 'A1' },
  });
  assert.equal(o.account_id, 'A1');
});

test('nothing to work with yields an empty, harmless result', () => {
  const o = refresh({});
  assert.deepEqual(o.participants, []);
  assert.equal('contact_email' in o, false);
  assert.equal('account_id' in o, false);
});

test('the refresh never invents a write or a product change', () => {
  const o = refresh({ threadContacts: THREAD, pin: { module: 'Deals', recordId: 'D1' } });
  // Only re-plan inputs the pickers already send.
  const allowed = new Set(['participants', 'contact_email', 'contact_id', 'account_id', 'existing_deal_id']);
  for (const key of Object.keys(o)) assert.ok(allowed.has(key), `unexpected override: ${key}`);
  assert.equal(flow.isProductChangingOneshotOverride(o), false,
    'a context refresh must not invalidate the reviewed product snapshot');
});

test('the summary says what will be sent', () => {
  const o = refresh({ threadContacts: THREAD, shownContactEmail: 'trevorgoode@bayerhfcu.com' });
  const text = summary(o);
  assert.match(text, /2 people on this thread/);
  assert.match(text, /trevorgoode@bayerhfcu\.com/);
});

// ── Source wiring ──

test('the card renders the refresh control and the panel wires it', () => {
  assert.match(CHAT, /onRefreshContext/, 'prop is wired');
  assert.match(CHAT, /Refresh from current page \/ pin/, 'button is rendered');
  assert.match(CHAT, /async function refreshOneshotFromContext\(msg\)/);
});

test('the refresh is disabled once the review is locked', () => {
  const start = CHAT.indexOf('Refresh from current page / pin');
  assert.ok(start > 0);
  const block = CHAT.slice(CHAT.lastIndexOf('<button', start), start);
  assert.match(block, /disabled=\{reviewLocked \|\| busy\}/,
    'a locked or in-flight card must not be re-planned from underneath');
});

test('the refresh routes through the normal re-plan path', () => {
  // It must not build its own plan request: replanOneshot is what preserves the
  // review token handling and the quote-option rebinding.
  const start = CHAT.indexOf('async function refreshOneshotFromContext(msg)');
  const block = CHAT.slice(start, CHAT.indexOf('async function replanOneshot', start));
  assert.match(block, /await replanOneshot\(msg, overrides\)/);
  assert.match(block, /oneshotContextRefreshOverrides/);
});
