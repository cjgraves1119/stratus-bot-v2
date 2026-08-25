export const PENDING_SIDEBAR_ACTIONS_KEY = 'stratusPendingSidebarActionsV1';
export const PENDING_SIDEBAR_ACTION_TTL_MS = 60_000;
export const PENDING_SIDEBAR_ACTION_LEASE_MS = 10_000;
export const MAX_PENDING_SIDEBAR_ACTIONS = 8;
export const MAX_PENDING_QUOTE_CHARS = 8_000;
export const MAX_PENDING_QUOTE_PARTICIPANTS = 50;

const ACTION_ID_RE = /^[A-Za-z0-9_-]{8,160}$/;

function safeString(value, max) {
  return String(value == null ? '' : value).slice(0, max);
}

function safeInteger(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function safeEmail(value) {
  const email = safeString(value, 320).trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function safeGmailUrl(value) {
  const raw = safeString(value, 4000).trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && url.hostname === 'mail.google.com' ? url.toString() : '';
  } catch {
    return '';
  }
}

/**
 * Minimal Gmail identity snapshot for a context-menu quote.
 *
 * The pending action is tied to the exact tab that received the right-click,
 * lives for only 60 seconds in storage.session, and intentionally excludes the
 * subject/body/message text. This gives One Shot enough identity to perform its
 * read-only Zoho lookup without letting a later, unrelated Gmail tab leak into
 * the quote.
 */
export function normalizePendingQuoteGmailContext(value) {
  const source = value && typeof value === 'object' ? value : {};
  const threadPermId = safeString(source.threadPermId, 300).trim();
  if (!threadPermId) return null;
  const rawParticipants = Array.isArray(source.participants)
    ? source.participants
    : (Array.isArray(source.threadContacts) ? source.threadContacts : []);
  const participants = [];
  const seen = new Set();
  const add = (candidate) => {
    const email = safeEmail(candidate?.email || candidate);
    if (!email || seen.has(email) || participants.length >= MAX_PENDING_QUOTE_PARTICIPANTS) return;
    seen.add(email);
    participants.push({
      email,
      name: safeString(candidate?.name, 300).trim(),
      role: safeString(candidate?.role, 80).trim(),
    });
  };
  rawParticipants.forEach(add);
  if (!participants.length) return null;
  return {
    threadPermId,
    participants,
  };
}

/**
 * Accept a live Gmail snapshot only when it came from the exact page/tab that
 * received the context-menu gesture. Gmail navigation is fast enough that the
 * user can move threads while the side panel opens; a mismatch must therefore
 * fail closed instead of borrowing the newly-active thread.
 */
export function verifiedPendingQuoteGmailContext(value, { pageUrl, tabUrl } = {}) {
  const liveUrl = safeGmailUrl(value?.url);
  const clickedUrl = safeGmailUrl(pageUrl || tabUrl);
  const originalTabUrl = safeGmailUrl(tabUrl);
  if (!liveUrl || !clickedUrl || liveUrl !== clickedUrl) return null;
  if (pageUrl && originalTabUrl && clickedUrl !== originalTabUrl) return null;
  return normalizePendingQuoteGmailContext(value);
}

function makeId(prefix, now, random) {
  const suffix = Number(random).toString(36).replace(/[^a-z0-9]/gi, '').slice(0, 12) || '0';
  return `${prefix}_${Number(now).toString(36)}_${suffix}`;
}

export function createQuoteSidebarAction({
  quoteSkuText,
  tabId,
  windowId,
  gmailContext = null,
  now = Date.now(),
  random = Math.random(),
} = {}) {
  const text = safeString(String(quoteSkuText ?? '').trim(), MAX_PENDING_QUOTE_CHARS);
  const targetTabId = safeInteger(tabId);
  const targetWindowId = safeInteger(windowId);
  const createdAt = Number(now);
  if (!text || targetTabId == null || targetWindowId == null || !Number.isFinite(createdAt)) return null;
  const normalizedGmailContext = normalizePendingQuoteGmailContext(gmailContext);
  return {
    version: 1,
    actionId: makeId('quote', createdAt, random),
    type: 'quote-selection',
    panel: 'chat',
    quoteSkuText: text,
    targetTabId,
    targetWindowId,
    createdAt,
    expiresAt: createdAt + PENDING_SIDEBAR_ACTION_TTL_MS,
    claimId: null,
    claimExpiresAt: 0,
    ...(normalizedGmailContext ? { gmailContext: normalizedGmailContext } : {}),
  };
}

export function normalizePendingSidebarAction(value, { now = Date.now() } = {}) {
  if (!value || value.version !== 1 || value.type !== 'quote-selection' || value.panel !== 'chat') return null;
  const actionId = safeString(value.actionId, 160);
  const quoteSkuText = safeString(String(value.quoteSkuText ?? '').trim(), MAX_PENDING_QUOTE_CHARS);
  const targetTabId = safeInteger(value.targetTabId);
  const targetWindowId = safeInteger(value.targetWindowId);
  const createdAt = Number(value.createdAt);
  const expiresAt = Number(value.expiresAt);
  const currentTime = Number(now);
  if (!ACTION_ID_RE.test(actionId) || !quoteSkuText || targetTabId == null || targetWindowId == null) return null;
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || !Number.isFinite(currentTime)) return null;
  if (expiresAt <= currentTime || expiresAt <= createdAt || expiresAt - createdAt > PENDING_SIDEBAR_ACTION_TTL_MS) return null;

  const rawClaimId = safeString(value.claimId, 160);
  const rawClaimExpiresAt = Number(value.claimExpiresAt);
  const hasActiveClaim = ACTION_ID_RE.test(rawClaimId)
    && Number.isFinite(rawClaimExpiresAt)
    && rawClaimExpiresAt > currentTime
    && rawClaimExpiresAt <= expiresAt;
  const gmailContext = normalizePendingQuoteGmailContext(value.gmailContext);

  return {
    version: 1,
    actionId,
    type: 'quote-selection',
    panel: 'chat',
    quoteSkuText,
    targetTabId,
    targetWindowId,
    createdAt,
    expiresAt,
    claimId: hasActiveClaim ? rawClaimId : null,
    claimExpiresAt: hasActiveClaim ? rawClaimExpiresAt : 0,
    ...(gmailContext ? { gmailContext } : {}),
  };
}

export function normalizePendingSidebarActions(value, options = {}) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const normalized = [];
  for (const item of source) {
    const action = normalizePendingSidebarAction(item, options);
    if (!action || seen.has(action.actionId)) continue;
    seen.add(action.actionId);
    normalized.push(action);
  }
  return normalized.slice(-MAX_PENDING_SIDEBAR_ACTIONS);
}

export function enqueuePendingSidebarAction(value, action, { now = Date.now() } = {}) {
  const normalizedAction = normalizePendingSidebarAction(action, { now });
  const actions = normalizePendingSidebarActions(value, { now });
  if (!normalizedAction) return actions;
  return [...actions.filter((item) => item.actionId !== normalizedAction.actionId), normalizedAction]
    .slice(-MAX_PENDING_SIDEBAR_ACTIONS);
}

export function claimNextPendingSidebarAction(value, {
  tabId,
  windowId,
  claimId,
  now = Date.now(),
  leaseMs = PENDING_SIDEBAR_ACTION_LEASE_MS,
} = {}) {
  const targetTabId = safeInteger(tabId);
  const targetWindowId = safeInteger(windowId);
  const safeClaimId = safeString(claimId, 160);
  const currentTime = Number(now);
  const lease = Math.max(1, Math.min(Number(leaseMs) || 0, PENDING_SIDEBAR_ACTION_LEASE_MS));
  const actions = normalizePendingSidebarActions(value, { now: currentTime });
  if (targetTabId == null || targetWindowId == null || !ACTION_ID_RE.test(safeClaimId)) {
    return { actions, claim: null };
  }

  const index = actions.findIndex((action) => (
    action.targetTabId === targetTabId
    && action.targetWindowId === targetWindowId
    && !action.claimId
  ));
  if (index < 0) return { actions, claim: null };

  const claimed = {
    ...actions[index],
    claimId: safeClaimId,
    claimExpiresAt: Math.min(actions[index].expiresAt, currentTime + lease),
  };
  const next = actions.slice();
  next[index] = claimed;
  return { actions: next, claim: { action: claimed, claimId: safeClaimId } };
}

export function acknowledgePendingSidebarAction(value, {
  actionId,
  claimId,
  now = Date.now(),
} = {}) {
  const safeActionId = safeString(actionId, 160);
  const safeClaimId = safeString(claimId, 160);
  const actions = normalizePendingSidebarActions(value, { now });
  const index = actions.findIndex((action) => (
    action.actionId === safeActionId && action.claimId === safeClaimId
  ));
  if (index < 0) return { actions, acknowledged: false };
  return {
    actions: actions.filter((_, itemIndex) => itemIndex !== index),
    acknowledged: true,
  };
}
