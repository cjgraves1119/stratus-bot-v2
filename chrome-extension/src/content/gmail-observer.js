/**
 * Stratus AI Chrome Extension — Gmail DOM Observer Utilities
 *
 * Helper functions for safely interacting with Gmail's DOM.
 * Gmail uses obfuscated class names that can change, so we use
 * multiple detection strategies with fallbacks.
 */

/**
 * Wait for a Gmail DOM element to appear.
 * @param {string} selector - CSS selector
 * @param {number} [timeout=5000] - Max wait in ms
 * @returns {Promise<Element|null>}
 */
export function waitForElement(selector, timeout = 5000) {
  return new Promise((resolve) => {
    const existing = document.querySelector(selector);
    if (existing) return resolve(existing);

    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (el) {
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

/**
 * Check if we're currently viewing an email thread.
 */
export function isEmailView() {
  const hash = window.location.hash;
  // Gmail thread URLs look like #inbox/FMfcgzQZTfNfrLNpWjQTSqwLpvxXjXhV
  return hash && /^#[a-z]+\/[A-Za-z0-9]+/.test(hash);
}

/**
 * Check if a compose window is open.
 */
export function isComposeOpen() {
  return !!document.querySelector('.AD [role="dialog"]');
}

/**
 * Get the current Gmail view type from URL hash.
 * @returns {'inbox'|'sent'|'thread'|'compose'|'search'|'other'}
 */
export function getGmailView() {
  const hash = window.location.hash;
  if (!hash || hash === '#' || hash === '#inbox') return 'inbox';
  if (hash.startsWith('#sent')) return 'sent';
  if (hash.startsWith('#search')) return 'search';
  if (hash.includes('/compose')) return 'compose';
  if (/^#[a-z]+\/[A-Za-z0-9]{10,}/.test(hash)) return 'thread';
  return 'other';
}
