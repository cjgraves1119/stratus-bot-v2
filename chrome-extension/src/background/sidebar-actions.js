import {
  PENDING_SIDEBAR_ACTIONS_KEY,
  acknowledgePendingSidebarAction,
  claimNextPendingSidebarAction,
  createQuoteSidebarAction,
  enqueuePendingSidebarAction,
} from '../lib/pending-sidebar-action.mjs';

let pendingActionStorageOperation = Promise.resolve();

function withPendingActionStorageLock(operation) {
  const run = pendingActionStorageOperation.then(operation, operation);
  pendingActionStorageOperation = run.then(() => undefined, () => undefined);
  return run;
}

async function readQueue() {
  const stored = await chrome.storage.session.get(PENDING_SIDEBAR_ACTIONS_KEY);
  return stored?.[PENDING_SIDEBAR_ACTIONS_KEY] || [];
}

async function writeQueue(actions) {
  if (actions.length > 0) {
    await chrome.storage.session.set({ [PENDING_SIDEBAR_ACTIONS_KEY]: actions });
  } else {
    await chrome.storage.session.remove(PENDING_SIDEBAR_ACTIONS_KEY);
  }
}

function newClaimId() {
  const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random()}`;
  return `claim_${String(random).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 140)}`;
}

export function isTrustedSidebarSender(sender) {
  if (!sender || sender.id !== chrome.runtime.id || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:'
      && url.hostname === chrome.runtime.id
      && url.pathname === '/sidebar.html';
  } catch {
    return false;
  }
}

export async function queueQuoteSidebarAction({ quoteSkuText, tabId, windowId, gmailContext = null }) {
  const action = createQuoteSidebarAction({ quoteSkuText, tabId, windowId, gmailContext });
  if (!action) return null;
  await withPendingActionStorageLock(async () => {
    const queue = await readQueue();
    await writeQueue(enqueuePendingSidebarAction(queue, action));
  });
  return action;
}

export async function claimQuoteSidebarAction({ tabId, windowId }, sender) {
  if (!isTrustedSidebarSender(sender)) throw new Error('Sidebar action claim requires the trusted sidebar document');
  return withPendingActionStorageLock(async () => {
    const queue = await readQueue();
    const result = claimNextPendingSidebarAction(queue, {
      tabId,
      windowId,
      claimId: newClaimId(),
    });
    await writeQueue(result.actions);
    return result.claim;
  });
}

export async function acknowledgeQuoteSidebarAction({ actionId, claimId }, sender) {
  if (!isTrustedSidebarSender(sender)) throw new Error('Sidebar action acknowledgement requires the trusted sidebar document');
  return withPendingActionStorageLock(async () => {
    const queue = await readQueue();
    const result = acknowledgePendingSidebarAction(queue, { actionId, claimId });
    await writeQueue(result.actions);
    return { acknowledged: result.acknowledged };
  });
}
