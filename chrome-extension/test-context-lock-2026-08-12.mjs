import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  CHAT_SESSION_STORAGE_KEY,
  MAX_LOCKED_EMAIL_BODY_CHARS,
  MAX_LOCKED_MESSAGES,
  MAX_STORED_MESSAGE_CHARS,
  contextLockReportMetadata,
  createContextLock,
  createEmptyChatSession,
  effectivePinnedZohoRecord,
  hasEffectiveZohoRecord,
  isLockSourceAvailable,
  lockedEmailBodyUnavailable,
  normalizeStoredChatSession,
  resolveLockedContexts,
  serializeChatSession,
  shouldBlockForActiveZohoMismatch,
} from './src/lib/context-lock.mjs';
import { oneshotHaStateForQuoteOption } from './src/lib/email-quote-flow.mjs';

const gmailUrl = 'https://mail.google.com/mail/u/0/#inbox/FMfcgzQlock1';
const zohoUrl = 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000402426396';

function gmailContext(overrides = {}) {
  return {
    threadPermId: 'FMfcgzQlock1',
    subject: 'Synthetic context lock test',
    senderEmail: 'sender@example.test',
    senderName: 'Synthetic Sender',
    customerEmail: 'customer@example.test',
    customerName: 'Synthetic Customer',
    customerDomain: 'example.test',
    body: 'Short synthetic body',
    fullThreadBody: 'Full synthetic thread body',
    threadContacts: [{ email: 'customer@example.test', name: 'Synthetic Customer', role: 'sender' }],
    threadOrderUrls: ['https://example.test/order/synthetic'],
    extractedAt: 1234,
    ...overrides,
  };
}

function zohoContext(overrides = {}) {
  return {
    type: 'zoho', page: 'record', module: 'Quotes',
    recordId: '2570562000402426396', recordName: 'Synthetic Quote',
    accountId: '2570562000000000001', accountName: 'Synthetic Account',
    detectedAt: 1234,
    ...overrides,
  };
}

test('Gmail to Zoho switch keeps the locked Gmail snapshot authoritative', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 11, emailContext: gmailContext(), now: 100 });
  const resolved = resolveLockedContexts(lock, gmailContext({ subject: 'Different live thread' }), zohoContext());
  assert.equal(resolved.locked, true);
  assert.equal(resolved.emailContext.threadPermId, 'FMfcgzQlock1');
  assert.equal(resolved.emailContext.subject, 'Synthetic context lock test');
  assert.equal(resolved.zohoContext, null);
  assert.equal(resolved.ignoreLivePage, true);
});

test('Zoho to Gmail switch keeps the locked Zoho record authoritative', () => {
  const lock = createContextLock({ pageUrl: zohoUrl, tabId: 22, zohoContext: zohoContext(), now: 200 });
  const resolved = resolveLockedContexts(lock, gmailContext(), zohoContext({ recordId: '9999999999999999999' }));
  assert.equal(resolved.emailContext, null);
  assert.equal(resolved.zohoContext.recordId, '2570562000402426396');
  assert.equal(resolved.ignoreLivePage, true);
});

test('Dispatcher and one-shot planning ignore a live Zoho page under a Gmail lock', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 23, emailContext: gmailContext(), now: 210 });
  assert.equal(hasEffectiveZohoRecord({ contextLock: lock, liveZohoContext: zohoContext() }), false);
  assert.equal(effectivePinnedZohoRecord({ contextLock: lock, autoPinnedRecord: zohoContext() }), null);
});

test('Dispatcher and one-shot planning retain a Zoho lock after switching to Gmail', () => {
  const lock = createContextLock({ pageUrl: zohoUrl, tabId: 24, zohoContext: zohoContext(), now: 220 });
  assert.equal(hasEffectiveZohoRecord({ contextLock: lock, liveZohoContext: null }), true);
  assert.equal(effectivePinnedZohoRecord({ contextLock: lock }).recordId, '2570562000402426396');
});

test('Locking an unsupported/list page creates an explicit no-context lock', () => {
  const lock = createContextLock({ pageUrl: 'https://example.test/dashboard', tabId: 33, now: 300 });
  const resolved = resolveLockedContexts(lock, gmailContext(), zohoContext());
  assert.equal(lock.kind, 'none');
  assert.equal(resolved.emailContext, null);
  assert.equal(resolved.zohoContext, null);
});

test('Unlocked resolver preserves current live behavior', () => {
  const email = gmailContext();
  const record = zohoContext();
  const resolved = resolveLockedContexts(null, email, record);
  assert.equal(resolved.locked, false);
  assert.equal(resolved.emailContext, email);
  assert.equal(resolved.zohoContext, record);
  assert.equal(resolved.ignoreLivePage, false);
});

test('New chat boundary rotates identity and clears lock, history, and CRM pins', () => {
  const first = createEmptyChatSession(1000, 0.1);
  const second = createEmptyChatSession(1001, 0.2);
  assert.notEqual(first.sessionId, second.sessionId);
  assert.equal(second.contextLock, null);
  assert.deepEqual(second.messages, []);
  assert.equal(second.autoPinnedRecord, null);
  assert.equal(second.manualPinnedRecord, null);
});

test('manual CRM pin is sanitized and survives panel tab switching/reload', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_manual_pin',
    messages: [],
    manualPinnedRecord: {
      type: 'zoho', page: 'record', module: 'Deals',
      recordId: '2570562000416640162', recordName: 'Synthetic Deal',
      accountId: '2570562000389733190', accountName: 'Synthetic Account',
      secret: 'must-not-persist',
    },
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored)));
  assert.equal(restored.manualPinnedRecord.module, 'Deals');
  assert.equal(restored.manualPinnedRecord.recordId, '2570562000416640162');
  assert.equal(restored.manualPinnedRecord.accountId, '2570562000389733190');
  assert.equal(JSON.stringify(restored).includes('must-not-persist'), false);
});

test('Refresh/reload round-trip restores the same chat-scoped lock', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 44, emailContext: gmailContext(), now: 400 });
  const stored = serializeChatSession({
    sessionId: 'chat_refresh_test',
    messages: [{ id: 1, role: 'user', content: 'continue this thought' }],
    contextLock: lock,
    autoPinnedRecord: null,
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored)));
  assert.equal(CHAT_SESSION_STORAGE_KEY, 'stratusActiveChatSessionV1');
  assert.equal(restored.sessionId, 'chat_refresh_test');
  assert.equal(restored.contextLock.kind, 'gmail');
  assert.equal(restored.contextLock.snapshot.threadPermId, 'FMfcgzQlock1');
  assert.equal(restored.messages[0].content, 'continue this thought');
});

test('A new browser tab/window can restore the global chat session without becoming the source', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 55, emailContext: gmailContext(), now: 500 });
  const stored = serializeChatSession({ sessionId: 'chat_cross_tab', contextLock: lock, messages: [] });
  const restored = normalizeStoredChatSession(stored);
  assert.equal(restored.contextLock.lockedFromTabId, 55);
  assert.equal(isLockSourceAvailable(restored.contextLock, { id: 56, url: gmailUrl }), false);
  assert.equal(resolveLockedContexts(restored.contextLock, gmailContext({ subject: 'Other tab' }), null).emailContext.subject, 'Synthetic context lock test');
});

test('Closed or navigated source is stale but never replaced by live context', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 66, emailContext: gmailContext(), now: 600 });
  lock.sourceAvailable = false;
  assert.equal(isLockSourceAvailable(lock, null), false);
  const resolved = resolveLockedContexts(lock, gmailContext({ subject: 'Wrong replacement' }), zohoContext());
  assert.equal(resolved.emailContext.subject, 'Synthetic context lock test');
  assert.equal(resolved.zohoContext, null);
});

test('Unavailable locked Gmail snapshot fails closed instead of using a live email', () => {
  const broken = {
    kind: 'gmail', provenance: 'user-explicit', lockedAt: 700,
    lockedFromTabId: 77, sourceUrl: gmailUrl, sourceAvailable: false, snapshot: null,
  };
  const resolved = resolveLockedContexts(broken, gmailContext({ subject: 'Must not substitute' }), null);
  assert.equal(resolved.emailContext, null);
  assert.equal(lockedEmailBodyUnavailable(broken), true);
});

test('Zoho mismatch guard allows an explicit lock and blocks the same mismatch unlocked', () => {
  const lock = createContextLock({ pageUrl: gmailUrl, tabId: 88, emailContext: gmailContext(), now: 800 });
  const args = {
    activeRecordId: '2570562000402426396',
    outgoingText: 'User message: continue the locked Gmail thought',
    manualPinnedRecord: null,
    autoPinnedRecord: null,
  };
  assert.equal(shouldBlockForActiveZohoMismatch({ ...args, contextLock: lock }), false);
  assert.equal(shouldBlockForActiveZohoMismatch({ ...args, contextLock: null }), true);
});

test('Privacy boundary caps thread text and strips unneeded message bodies', () => {
  const oversized = 'x'.repeat(MAX_LOCKED_EMAIL_BODY_CHARS + 5000);
  const lock = createContextLock({
    pageUrl: gmailUrl,
    tabId: 99,
    emailContext: gmailContext({
      fullThreadBody: oversized,
      messageContexts: [{ body: 'must not be persisted' }],
      url: 'https://mail.google.com/private-thread-id',
    }),
    now: 900,
  });
  assert.equal(lock.snapshot.fullThreadBody.length, MAX_LOCKED_EMAIL_BODY_CHARS);
  assert.equal('messageContexts' in lock.snapshot, false);
  assert.equal('url' in lock.snapshot, false);
  const report = contextLockReportMetadata(lock);
  assert.deepEqual(Object.keys(report).sort(), ['hasSnapshot', 'kind', 'lockedAt', 'sourceAvailable'].sort());
  assert.equal(JSON.stringify(report).includes('Synthetic context lock test'), false);
  assert.equal(JSON.stringify(report).includes('sender@example.test'), false);
});

test('Session persistence bounds retained chat history', () => {
  const messages = Array.from({ length: MAX_LOCKED_MESSAGES + 20 }, (_, i) => ({ id: i, role: 'user', content: `m${i}` }));
  const stored = serializeChatSession({ sessionId: 'chat_bounded', messages });
  assert.equal(stored.messages.length, MAX_LOCKED_MESSAGES);
  assert.equal(stored.messages[0].content, 'm20');
});

test('Session persistence strips nested cards and stays safely below the session quota', () => {
  const nestedSecret = 'must-not-persist';
  const messages = Array.from({ length: MAX_LOCKED_MESSAGES }, (_, i) => ({
    id: i,
    role: i % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(MAX_STORED_MESSAGE_CHARS + 5000),
    result: { customer: nestedSecret, urls: Array(200).fill('https://example.test/private') },
    analysis: { raw: nestedSecret },
    suggestions: [{ payload: nestedSecret }],
    recovery: { debug: nestedSecret },
  }));
  const stored = serializeChatSession({ sessionId: 'chat_privacy_bounded', messages });
  assert.equal(stored.messages[0].content.length, MAX_STORED_MESSAGE_CHARS);
  assert.equal('result' in stored.messages[0], false);
  assert.equal('analysis' in stored.messages[0], false);
  assert.equal('suggestions' in stored.messages[0], false);
  assert.equal(JSON.stringify(stored).includes(nestedSecret), false);
  assert.ok(JSON.stringify(stored).length < 1_100_000);
});

test('Deterministic quote cards retain only safe Stratus order data across reload', () => {
  const nestedSecret = 'must-not-persist';
  const stored = serializeChatSession({
    sessionId: 'chat_safe_quote_reload',
    messages: [{
      id: 901,
      role: 'assistant',
      kind: 'quote',
      skuText: 'MX75-HW x 2',
      note: 'Synthetic deterministic quote',
      eolMapping: ['MX64-HW (EOL) → Replacement: MX75-HW'],
      result: {
        urls: [
          { label: '1-Year', url: 'https://stratusinfosystems.com/order/?item=MX75-HW&qty=2' },
          { label: '3-Year', url: 'https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX75-ENT-3YR&qty=2,2' },
        ],
        parsed: [{ baseSku: 'MX75-HW', qty: 2 }],
        eolWarnings: ['MX64-HW is End-of-Life'],
        suggestions: [{ payload: nestedSecret }],
        customer: nestedSecret,
        reviewToken: nestedSecret,
      },
      consentSource: nestedSecret,
    }],
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored)));
  const message = restored.messages[0];
  assert.equal(message.kind, 'quote');
  assert.equal(message.restored, true);
  assert.equal(message.skuText, 'MX75-HW x 2');
  assert.equal(message.result.urls.length, 2);
  assert.equal(message.result.urls[0].label, '1-Year');
  assert.equal(message.result.urls[0].url, 'https://stratusinfosystems.com/order/?item=MX75-HW&qty=2');
  assert.deepEqual(message.result.parsed, [{ baseSku: 'MX75-HW', qty: 2 }]);
  assert.equal(message.result.suggestions, null);
  assert.equal('customer' in message.result, false);
  assert.equal('reviewToken' in message.result, false);
  assert.equal('consentSource' in message, false);
  assert.equal(JSON.stringify(restored).includes(nestedSecret), false);
});

test('Quote persistence rejects unsafe URLs and margin-bearing display fields', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_quote_url_guard',
    messages: [{
      id: 902,
      role: 'assistant',
      kind: 'quote',
      skuText: 'MX75-HW',
      note: 'Margin 25 percent',
      eolMapping: ['Gross profit margin: secret'],
      result: {
        urls: [
          { label: 'Margin option', url: 'https://stratusinfosystems.com/order/?item=MX75-HW&qty=1' },
          { label: 'Wrong host', url: 'https://example.test/order/?item=MX75-HW&qty=1' },
          { label: 'Wrong path', url: 'https://stratusinfosystems.com/admin/?item=MX75-HW&qty=1' },
          { label: 'Credentials', url: 'https://user:pass@stratusinfosystems.com/order/?item=MX75-HW&qty=1' },
          { label: 'JavaScript', url: 'javascript:alert(1)' },
        ],
        parsed: [{ baseSku: 'Margin summary', qty: 1 }, { baseSku: 'MX75-HW', qty: 1 }],
        eolWarnings: ['Margin 25 percent', 'MX64-HW is End-of-Life'],
      },
    }],
  });
  const message = stored.messages[0];
  assert.equal(message.kind, 'quote');
  assert.equal(message.note, '');
  assert.deepEqual(message.eolMapping, []);
  assert.equal(message.result.urls.length, 1);
  assert.equal(message.result.urls[0].label, 'Option 1');
  assert.deepEqual(message.result.parsed, [{ baseSku: 'MX75-HW', qty: 1 }]);
  assert.deepEqual(message.result.eolWarnings, ['MX64-HW is End-of-Life']);
  assert.equal(JSON.stringify(message).toLowerCase().includes('margin'), false);
});

test('Quote cards without a valid Stratus order URL degrade to the inert summary', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_quote_fail_closed',
    messages: [{
      id: 903,
      role: 'assistant',
      kind: 'quote',
      result: { urls: [{ label: 'Bad', url: 'https://example.test/order/?item=MX75-HW&qty=1' }] },
    }],
  });
  assert.equal(stored.messages[0].kind, undefined);
  assert.equal(stored.messages[0].content, '[quote result from this chat; interactive card details are not retained across a panel reload]');
});

test('Dirty quote drafts never persist stale actionable URLs across reload', () => {
  const staleUrl = 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2';
  const stored = serializeChatSession({
    sessionId: 'chat_dirty_quote_fail_closed',
    messages: [{
      id: 9031,
      role: 'assistant',
      kind: 'quote',
      content: `Copy this stale URL: ${staleUrl}`,
      draftDirty: true,
      draftRows: [{ sku: 'MX85', qty: 3 }],
      result: {
        urls: [{ label: 'Stale 3-Year', url: staleUrl }],
        parsed: [{ baseSku: 'MX85', qty: 2 }],
      },
    }],
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored)));
  assert.equal(restored.messages[0].kind, undefined);
  assert.equal('result' in restored.messages[0], false);
  assert.doesNotMatch(JSON.stringify(restored), /stratusinfosystems\.com|MX85-HW/);
  assert.equal(restored.messages[0].content, '[quote draft changed; stale interactive links were not retained across the panel reload]');
});

test('Clean quote persistence retains Hardware Only and trusted HA semantics without Gmail provenance', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_clean_quote_semantics',
    messages: [{
      id: 9032,
      role: 'assistant',
      kind: 'quote',
      skuText: '2 MX85\nenterprise\nhigh availability',
      intake: { intent: { ha_requested: true, license_tier: 'ENT' }, secret: 'discard-me' },
      emailQuoteContext: { participants: [{ email: 'discard-me@example.test' }] },
      result: {
        urls: [
          { label: '3-Year', url: 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,1' },
          { label: 'Hardware Only', url: 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2', hardwareOnly: true },
        ],
        parsed: [{ baseSku: 'MX85', qty: 2 }],
      },
    }],
  });
  const message = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored))).messages[0];
  assert.equal(message.kind, 'quote');
  assert.equal(message.quoteHaRequested, true);
  assert.equal(message.quoteLicenseTier, 'ENT');
  assert.equal(message.quoteSupportsHardwareOnly, true);
  assert.equal(message.result.urls[1].hardwareOnly, true);
  assert.equal('intake' in message, false);
  assert.equal('emailQuoteContext' in message, false);
  assert.doesNotMatch(JSON.stringify(message), /discard-me/);
});

test('Restored Gmail intake is explicitly inert because intent and participants are not persisted', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_restored_intake_inert',
    messages: [{
      id: 904,
      role: 'assistant',
      kind: 'email-quote-intake',
      intake: {
        lines: [
          { sku: 'MX67', qty: 1, status: 'resolved', tier: 'SEC' },
          { sku: 'MX67', qty: 2, status: 'resolved', tier: 'ENT' },
          { sku: 'LIC-ENT-3YR', qty: 2, status: 'resolved', tier: 'ENT' },
        ],
        intent: { hardware_only: true },
        facts: { customer: 'must-not-persist' },
      },
      emailQuoteContext: { participants: [{ email: 'must-not-persist@example.test' }] },
    }],
  });
  const message = stored.messages[0];
  assert.equal(message.kind, 'email-quote-intake');
  assert.equal(message.restored, true);
  assert.deepEqual(message.intake.lines, [
    { sku: 'MX67', qty: 1, status: 'resolved', tier: 'SEC' },
    { sku: 'MX67', qty: 2, status: 'resolved', tier: 'ENT' },
    { sku: 'LIC-ENT-3YR', qty: 2, status: 'resolved' },
  ]);
  assert.equal('intent' in message.intake, false);
  assert.equal('facts' in message.intake, false);
  assert.equal('emailQuoteContext' in message, false);
  assert.equal(JSON.stringify(message).includes('must-not-persist'), false);
});

test('Restored one-shot options preserve only validated term and Hardware Only semantics', () => {
  const stored = serializeChatSession({
    sessionId: 'chat_restored_oneshot_options',
    messages: [{
      id: 905,
      role: 'assistant',
      kind: 'oneshot',
      consentSource: 'quote-card-button',
      reviewToken: 'synthetic-review-token',
      idempotencyKey: 'synthetic-idempotency-key',
      base: {
        skus: [{ sku: 'MX75-HW', qty: 1 }],
        participants: [],
        hardware_only: true,
        include_licenses: false,
        ha_mode: 'standard',
        ha_available: true,
        ha_recalculate_license_qty: false,
      },
      plan: { product_validation: { snapshot_hash: 'sha256:mx75-products' } },
      quoteOptionsSnapshotHash: 'sha256:mx75-products',
      quoteOptions: [
        {
          label: 'Hardware Only',
          url: 'https://stratusinfosystems.com/order/?item=MX75-HW&qty=1',
          hardwareOnly: true,
          termYears: null,
          searchResults: [{ id: 'must-not-persist' }],
        },
        {
          label: '3-Year',
          url: 'https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX75-ENT-3Y&qty=1,1',
          hardwareOnly: false,
          termYears: 3,
          draftLines: [{ sku: 'must-not-persist', qty: 99 }],
        },
      ],
      selectedQuoteOptionIndex: 0,
    }],
  });
  const message = stored.messages[0];
  assert.equal(message.kind, 'oneshot');
  assert.deepEqual(message.quoteOptions.map(({ hardwareOnly, termYears }) => ({ hardwareOnly, termYears })), [
    { hardwareOnly: true, termYears: null },
    { hardwareOnly: false, termYears: 3 },
  ]);
  assert.equal(JSON.stringify(message).includes('searchResults'), false);
  assert.equal(JSON.stringify(message).includes('draftLines'), false);
  assert.equal(message.base.ha_available, true);
  assert.deepEqual(oneshotHaStateForQuoteOption({
    haAvailable: message.base.ha_available,
    hardwareOnly: false,
    currentMode: message.base.ha_mode,
  }), {
    ha_mode: 'warm_spare',
    ha_recalculate_license_qty: true,
    ha_available: true,
  });
  assert.equal(JSON.stringify(message).includes('must-not-persist'), false);
});

test('Restored one-shot options are dropped when their product snapshot binding is missing or stale', () => {
  const baseMessage = {
    id: 906,
    role: 'assistant',
    kind: 'oneshot',
    consentSource: 'quote-card-button',
    reviewToken: 'synthetic-review-token',
    idempotencyKey: 'synthetic-idempotency-key',
    base: { skus: [{ sku: 'C9300-24P-M', qty: 1 }], participants: [] },
    plan: { product_validation: { snapshot_hash: 'sha256:new-catalyst-products' } },
    quoteOptions: [{
      label: 'Old MX option',
      url: 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,1',
      termYears: 3,
    }],
    selectedQuoteOptionIndex: 0,
  };
  for (const binding of [undefined, 'sha256:old-mx-products']) {
    const stored = serializeChatSession({
      sessionId: `chat_stale_binding_${binding || 'missing'}`,
      messages: [{ ...baseMessage, quoteOptionsSnapshotHash: binding }],
    });
    assert.equal(stored.messages[0].kind, 'oneshot');
    assert.deepEqual(stored.messages[0].quoteOptions, []);
    assert.equal(stored.messages[0].selectedQuoteOptionIndex, null);
    assert.equal(stored.messages[0].quoteOptionsSnapshotHash, undefined);
  }
});

test('Static privacy and send-path guards are wired into the concrete diff', async () => {
  const [background, app, chat, content] = await Promise.all([
    readFile(new URL('./src/background/index.js', import.meta.url), 'utf8'),
    readFile(new URL('./src/sidebar/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8'),
    readFile(new URL('./src/content/index.js', import.meta.url), 'utf8'),
  ]);
  assert.match(background, /setAccessLevel\(\{ accessLevel: 'TRUSTED_CONTEXTS' \}\)/);
  assert.match(app, /contextLockReportMetadata\(chatContextLock\)/);
  assert.match(app, /sender\.tab\.id !== activeTab\.id/);
  assert.match(app, /manualPinnedRecord=\{chatManualPinnedRecord\}/);
  assert.match(app, /manualPinnedRecord: chatManualPinnedRecord/);
  assert.match(chat, /shouldBlockForActiveZohoMismatch/);
  assert.match(chat, /lockedEmailBodyUnavailable/);
  assert.match(content, /empty: true/);
});
