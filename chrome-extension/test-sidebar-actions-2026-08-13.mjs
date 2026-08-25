import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  MAX_PENDING_QUOTE_CHARS,
  MAX_PENDING_QUOTE_PARTICIPANTS,
  PENDING_SIDEBAR_ACTION_TTL_MS,
  acknowledgePendingSidebarAction,
  claimNextPendingSidebarAction,
  createQuoteSidebarAction,
  enqueuePendingSidebarAction,
  normalizePendingSidebarActions,
  normalizePendingQuoteGmailContext,
  verifiedPendingQuoteGmailContext,
} from './src/lib/pending-sidebar-action.mjs';

function quoteAction(overrides = {}) {
  return createQuoteSidebarAction({
    quoteSkuText: 'MX75-HW x 2',
    tabId: 11,
    windowId: 22,
    now: 1_000,
    random: 0.12345,
    ...overrides,
  });
}

test('Quote actions are bounded, targeted, and expire quickly', () => {
  const action = quoteAction({ quoteSkuText: `  ${'x'.repeat(MAX_PENDING_QUOTE_CHARS + 500)}  ` });
  assert.equal(action.quoteSkuText.length, MAX_PENDING_QUOTE_CHARS);
  assert.equal(action.targetTabId, 11);
  assert.equal(action.targetWindowId, 22);
  assert.equal(action.expiresAt - action.createdAt, PENDING_SIDEBAR_ACTION_TTL_MS);
  assert.equal(createQuoteSidebarAction({ quoteSkuText: '', tabId: 11, windowId: 22 }), null);
  assert.equal(createQuoteSidebarAction({ quoteSkuText: 'MX75-HW', tabId: null, windowId: 22 }), null);
});

test('Identical SKU text with distinct action ids remains two explicit actions', () => {
  const first = quoteAction({ random: 0.111 });
  const second = quoteAction({ random: 0.222 });
  assert.notEqual(first.actionId, second.actionId);
  const queue = enqueuePendingSidebarAction(enqueuePendingSidebarAction([], first, { now: 1_000 }), second, { now: 1_000 });
  assert.equal(queue.length, 2);
  assert.deepEqual(queue.map((item) => item.quoteSkuText), ['MX75-HW x 2', 'MX75-HW x 2']);
});

test('Gmail context-menu identity is exact-thread, minimal, bounded, and never chooses the customer', () => {
  const url = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQsynthetic';
  const raw = {
    url,
    threadPermId: 'FMfcgzQsynthetic',
    subject: 'must not persist',
    body: 'must not persist',
    customerEmail: 'heuristic@example.test',
    threadContacts: [
      { email: ' Customer@Example.test ', name: 'Customer', role: 'sender' },
      { email: 'customer@example.test', name: 'duplicate', role: 'to' },
      { email: 'other@example.test', name: 'Other', role: 'cc' },
      { email: 'bad', name: 'Invalid', role: 'cc' },
      ...Array.from({ length: MAX_PENDING_QUOTE_PARTICIPANTS + 5 }, (_, index) => ({
        email: `person${index}@example.test`, name: `Person ${index}`, role: 'cc',
      })),
    ],
  };
  const verified = verifiedPendingQuoteGmailContext(raw, { pageUrl: url, tabUrl: url });
  assert.equal(verified.threadPermId, 'FMfcgzQsynthetic');
  assert.equal(verified.participants.length, MAX_PENDING_QUOTE_PARTICIPANTS);
  assert.equal(verified.participants[0].email, 'customer@example.test');
  assert.equal(verified.participants[1].email, 'other@example.test');
  assert.equal('contactEmail' in verified, false, 'the heuristic Gmail customer must not bypass ambiguity');
  assert.equal('subject' in verified, false);
  assert.equal('body' in verified, false);

  assert.equal(verifiedPendingQuoteGmailContext(raw, {
    pageUrl: url,
    tabUrl: 'https://mail.google.com/mail/u/0/#inbox/DIFFERENT',
  }), null, 'navigation between the click and capture must fail closed');
  assert.equal(verifiedPendingQuoteGmailContext({ ...raw, url: `${url}-new` }, { pageUrl: url, tabUrl: url }), null);
  assert.equal(normalizePendingQuoteGmailContext({ ...raw, threadPermId: '' }), null);
});

test('A claimed quote action retains only its transient same-thread participant snapshot', () => {
  const url = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQbound';
  const gmailContext = verifiedPendingQuoteGmailContext({
    url,
    threadPermId: 'FMfcgzQbound',
    threadContacts: [{ email: 'customer@example.test', name: 'Customer', role: 'sender' }],
  }, { pageUrl: url, tabUrl: url });
  const action = quoteAction({ gmailContext });
  assert.deepEqual(action.gmailContext, gmailContext);
  const claimed = claimNextPendingSidebarAction([action], {
    tabId: 11, windowId: 22, claimId: 'claim_threadbound', now: 1_001,
  });
  assert.deepEqual(claimed.claim.action.gmailContext, gmailContext);
});

test('A target-matched action is leased once and removed only by the matching acknowledgement', () => {
  const action = quoteAction();
  const queue = enqueuePendingSidebarAction([], action, { now: 1_000 });
  const wrongTarget = claimNextPendingSidebarAction(queue, {
    tabId: 99, windowId: 22, claimId: 'claim_wrongtarget', now: 1_001,
  });
  assert.equal(wrongTarget.claim, null);

  const claimed = claimNextPendingSidebarAction(queue, {
    tabId: 11, windowId: 22, claimId: 'claim_abcdefgh', now: 1_001,
  });
  assert.equal(claimed.claim.action.actionId, action.actionId);
  const duplicate = claimNextPendingSidebarAction(claimed.actions, {
    tabId: 11, windowId: 22, claimId: 'claim_secondone', now: 1_002,
  });
  assert.equal(duplicate.claim, null);

  const wrongAck = acknowledgePendingSidebarAction(claimed.actions, {
    actionId: action.actionId, claimId: 'claim_wrongvalue', now: 1_003,
  });
  assert.equal(wrongAck.acknowledged, false);
  assert.equal(wrongAck.actions.length, 1);
  const acknowledged = acknowledgePendingSidebarAction(claimed.actions, {
    actionId: action.actionId, claimId: 'claim_abcdefgh', now: 1_003,
  });
  assert.equal(acknowledged.acknowledged, true);
  assert.deepEqual(acknowledged.actions, []);
});

test('Expired actions are dropped and expired leases can be reclaimed', () => {
  const action = quoteAction();
  assert.deepEqual(normalizePendingSidebarActions([action], { now: action.expiresAt }), []);

  const firstClaim = claimNextPendingSidebarAction([action], {
    tabId: 11, windowId: 22, claimId: 'claim_firstlease', now: 1_001, leaseMs: 5,
  });
  const reclaimed = claimNextPendingSidebarAction(firstClaim.actions, {
    tabId: 11, windowId: 22, claimId: 'claim_recovered', now: 1_007,
  });
  assert.equal(reclaimed.claim.action.actionId, action.actionId);
  assert.equal(reclaimed.claim.claimId, 'claim_recovered');
});

test('Concrete context-menu and panel wiring has no fixed-delay dependency', async () => {
  const [menus, app, chat, backgroundActions] = await Promise.all([
    readFile(new URL('./src/background/context-menus.js', import.meta.url), 'utf8'),
    readFile(new URL('./src/sidebar/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/background/sidebar-actions.js', import.meta.url), 'utf8'),
  ]);
  const quoteCase = menus.match(/case 'stratus-quote-selection':[\s\S]*?break;/)?.[0] || '';
  assert.match(quoteCase, /queueQuoteSidebarAction/);
  assert.match(quoteCase, /chrome\.tabs\.sendMessage\(tab\.id, \{ type: MSG\.GET_EMAIL_CONTEXT \}\)/);
  assert.match(quoteCase, /verifiedPendingQuoteGmailContext\(live, \{[\s\S]*pageUrl: info\.pageUrl,[\s\S]*tabUrl: tab\.url/);
  assert.doesNotMatch(quoteCase, /setTimeout/);
  assert.match(app, /PENDING_SIDEBAR_ACTIONS_KEY/);
  assert.match(app, /SIDEBAR_ACTION_CLAIM/);
  assert.match(app, /SIDEBAR_ACTION_ACK/);
  assert.match(app, /if \(!chatSessionHydrated\) return undefined;/,
    'a fresh context-menu quote must be claimed only after restored session hydration');
  assert.match(chat, /navData\?\.quoteActionId \|\| navData\?\.quoteSkuText/);
  assert.match(app, /quoteContext: action\.gmailContext \|\| null/);
  assert.match(chat, /source: 'context-menu',[\s\S]*quoteContext: navData\.quoteContext \|\| null/);
  assert.match(backgroundActions, /isTrustedSidebarSender/);
});
