/**
 * Stratus AI Chrome Extension — Message Passing Helpers
 *
 * Provides a clean async API over chrome.runtime.sendMessage
 * and chrome.tabs.sendMessage for communication between
 * background, content scripts, sidebar, and popup.
 */

/**
 * Send a message to the background service worker and await response.
 * Use from: content scripts, sidebar, popup.
 * @param {string} type - Message type (from MSG constants)
 * @param {Object} [payload={}] - Message data
 * @returns {Promise<any>} Response from background
 */
export function sendToBackground(type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (response && response.error) {
        reject(new Error(response.error));
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Send a message to a specific tab's content script.
 * Use from: background service worker.
 * @param {number} tabId
 * @param {string} type
 * @param {Object} [payload={}]
 * @returns {Promise<any>}
 */
export function sendToTab(tabId, type, payload = {}) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, { type, ...payload }, (response) => {
      if (chrome.runtime.lastError) {
        // Tab might not have content script loaded — non-fatal
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

/**
 * Send a message to all Gmail tabs.
 * Use from: background service worker.
 * @param {string} type
 * @param {Object} [payload={}]
 */
export async function broadcastToGmail(type, payload = {}) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
  for (const tab of tabs) {
    sendToTab(tab.id, type, payload).catch(() => {});
  }
}

/**
 * Register a message handler in the background service worker.
 * Automatically sends response via sendResponse.
 * @param {Object} handlers - {[MSG_TYPE]: async (payload, sender) => response}
 */
export function registerMessageHandlers(handlers) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { type, ...payload } = message;
    const handler = handlers[type];

    if (!handler) return false; // Not handled — let other listeners try

    // Handle async
    (async () => {
      try {
        const result = await handler(payload, sender);
        sendResponse(result || { success: true });
      } catch (err) {
        console.error(`[Stratus] Handler error for ${type}:`, err);
        sendResponse({ error: err.message });
      }
    })();

    return true; // Keep sendResponse alive for async
  });
}

/**
 * Listen for messages of a specific type.
 * Use from: content scripts, sidebar.
 * @param {string} type
 * @param {Function} callback - (payload) => void
 * @returns {Function} Unlisten function
 */
export function onMessage(type, callback) {
  const listener = (message) => {
    if (message.type === type) {
      callback(message);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
