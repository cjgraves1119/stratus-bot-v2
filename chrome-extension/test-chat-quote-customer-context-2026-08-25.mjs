import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  quoteCustomerContextForHandoff,
  quoteCustomerContextEnabled,
  quoteCustomerContextSnapshot,
} from './src/lib/quote-customer-context.mjs';

const panelSource = await readFile(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');
const appSource = await readFile(new URL('./src/sidebar/App.jsx', import.meta.url), 'utf8');

const thread = {
  threadPermId: 'FMfcgzQcustomer1',
  threadContacts: [
    { email: 'Tom.English@Example.com', name: 'Tom English', role: 'customer' },
    { email: 'rep@cisco.com', name: 'Cisco Rep', role: 'cisco' },
    { email: 'tom.english@example.com', name: 'Duplicate', role: 'duplicate' },
  ],
};

test('chat quote freezes the displayed customer but no Gmail message content', () => {
  const snapshot = quoteCustomerContextSnapshot({
    source: 'chat-quote',
    context: thread,
    shownContactEmail: 'TOM.ENGLISH@example.com',
  });
  assert.deepEqual(snapshot, {
    threadPermId: 'FMfcgzQcustomer1',
    participants: [
      { email: 'tom.english@example.com', name: 'Tom English', role: 'customer' },
      { email: 'rep@cisco.com', name: 'Cisco Rep', role: 'cisco' },
    ],
    contactEmail: 'tom.english@example.com',
  });
  assert.equal('subject' in snapshot, false);
  assert.equal('body' in snapshot, false);
  assert.equal('orderUrls' in snapshot, false);
});

test('context-menu quote keeps ambiguity and never binds a heuristic customer', () => {
  const snapshot = quoteCustomerContextSnapshot({
    source: 'context-menu',
    context: thread,
    shownContactEmail: 'tom.english@example.com',
  });
  assert.equal(snapshot.contactEmail, undefined);
  const handoff = quoteCustomerContextForHandoff({
    quoteSource: 'context-menu',
    gmailParticipantSnapshot: { ...snapshot, contactEmail: 'tom.english@example.com' },
  });
  assert.equal(handoff.mode, 'context-menu');
  assert.equal(handoff.contactEmail, '');
  assert.equal(handoff.participants.length, 2);
});

test('manual and natural-language chat cards carry their card-bound customer', () => {
  for (const quoteSource of ['manual-ecomm-quote', 'chat-quote', 'editable-quote']) {
    const snapshot = quoteCustomerContextSnapshot({
      source: quoteSource,
      context: thread,
      shownContactEmail: 'tom.english@example.com',
    });
    const handoff = quoteCustomerContextForHandoff({ quoteSource, gmailParticipantSnapshot: snapshot });
    assert.equal(handoff.mode, 'chat-context');
    assert.equal(handoff.contactEmail, 'tom.english@example.com');
    assert.equal(handoff.participants[0].email, 'tom.english@example.com');
  }
});

test('card-bound Gmail identity coexists with authoritative Account, Deal, and Contact pins', () => {
  const snapshot = quoteCustomerContextSnapshot({
    source: 'chat-quote',
    context: { ...thread, pinnedRecord: { module: 'Accounts', recordId: 'account-1' } },
    shownContactEmail: 'tom.english@example.com',
  });
  const handoff = quoteCustomerContextForHandoff({
    quoteSource: 'chat-quote',
    gmailParticipantSnapshot: snapshot,
  });
  assert.equal(handoff.contactEmail, 'tom.english@example.com');
  assert.equal(handoff.participants.length, 2);
});

test('No context, malformed snapshots, and missing thread identity stay unscoped', () => {
  assert.equal(quoteCustomerContextSnapshot({ source: 'chat-quote', context: thread, disabled: true }), null);
  assert.equal(quoteCustomerContextSnapshot({
    source: 'chat-quote',
    context: { participants: thread.threadContacts },
    shownContactEmail: 'tom.english@example.com',
  }), null);
  assert.deepEqual(quoteCustomerContextForHandoff({ quoteSource: 'chat-quote' }), {
    participants: [], contactEmail: '', mode: 'unscoped',
  });
});

test('retained Gmail state is unavailable off Gmail unless the user explicitly locked Gmail', () => {
  assert.equal(quoteCustomerContextEnabled({ activePageType: 'gmail' }), true);
  assert.equal(quoteCustomerContextEnabled({ activePageType: 'zoho' }), false);
  assert.equal(quoteCustomerContextEnabled({ activePageType: 'other' }), false);
  assert.equal(quoteCustomerContextEnabled({ activePageType: 'zoho', contextLockKind: 'gmail' }), true);
  assert.equal(quoteCustomerContextEnabled({ activePageType: 'gmail', contextLockKind: 'zoho' }), false);
});

test('reviewed Gmail intake remains authoritative over a quote snapshot', () => {
  const handoff = quoteCustomerContextForHandoff({
    quoteSource: 'chat-quote',
    emailQuoteContext: { participants: [{ email: 'intake@example.com', name: 'Intake' }] },
    gmailParticipantSnapshot: quoteCustomerContextSnapshot({
      source: 'chat-quote', context: thread, shownContactEmail: 'tom.english@example.com',
    }),
  });
  assert.deepEqual(handoff, {
    participants: [{ email: 'intake@example.com', name: 'Intake', role: '' }],
    contactEmail: '',
    mode: 'gmail-intake',
  });
});

test('ChatPanel captures context before quote generation and never falls back at handoff', () => {
  assert.match(panelSource, /const capturedQuoteContext = quoteContext \|\| \(source !== 'context-menu'[\s\S]*currentQuoteCustomerContext\(\)/);
  assert.match(panelSource, /source: 'manual-ecomm-quote',[\s\S]*context: currentQuoteCustomerContext\(\)/);
  assert.match(panelSource, /source: 'chat-quote',[\s\S]*quoteContext: currentQuoteCustomerContext\(\)/);
  assert.match(panelSource, /capturedParticipants: customerContext\.participants,[\s\S]*capturedContactEmail: customerContext\.contactEmail/);
  assert.match(panelSource, /!gmailIdentityAvailable \|\| selectedContextEmail === '__none__'/);
  assert.doesNotMatch(panelSource, /selectedContextEmail === '__none__' \|\| manualRecord \|\| autoPinnedRecord/);
  assert.match(panelSource, /quoteCustomerContextEnabled\(\{[\s\S]*activePageType,[\s\S]*contextLockKind: contextLock\?\.kind \|\| ''/);
  assert.match(appSource, /<ChatPanel[\s\S]*activePageType=\{pageType\}/);
  assert.match(panelSource, /pin && pin\.module === 'Accounts'[\s\S]*base\.account_id = pin\.recordId/);
  assert.match(panelSource, /pin && pin\.module === 'Deals'[\s\S]*base\.existing_deal_id = pin\.recordId/);
  assert.match(panelSource, /pin && pin\.module === 'Contacts'[\s\S]*base\.contact_id = pin\.recordId/);
  assert.doesNotMatch(
    panelSource.slice(panelSource.indexOf('async function handleSendQuoteToZoho'), panelSource.indexOf('async function replanOneshot')),
    /capturedParticipants:[^\n]*emailContext\?\.threadContacts/,
  );
});
