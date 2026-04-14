/**
 * Stratus AI Chrome Extension — Zoho CRM Content Script
 *
 * 1. Detects the current Zoho CRM record (Account, Contact, Deal, Quote, etc.)
 *    from the URL and page content, then sends context to the sidebar via background.
 * 2. Injects "View in Gmail" quick links next to email fields.
 *
 * Runs only on crm.zoho.com pages.
 */

const GMAIL_SEARCH_BASE = 'https://mail.google.com/mail/u/0/#search/';

// ─────────────────────────────────────────────
// Zoho URL → Module/Record parsing
// ─────────────────────────────────────────────

/**
 * Zoho CRM URL patterns:
 *   /crm/org647122552/tab/Accounts/123456789
 *   /crm/org647122552/tab/Contacts/123456789
 *   /crm/org647122552/tab/Potentials/123456789   (Deals)
 *   /crm/org647122552/tab/Quotes/123456789
 *   /crm/org647122552/tab/SalesOrders/123456789
 *
 * The tab name maps to an API module name.
 */
const TAB_TO_MODULE = {
  Accounts: 'Accounts',
  Contacts: 'Contacts',
  Potentials: 'Deals',
  Quotes: 'Quotes',
  SalesOrders: 'Sales_Orders',
  Invoices: 'Invoices',
  Leads: 'Leads',
};

/**
 * Parse a Zoho CRM URL and return { module, recordId, tabName } or null.
 */
function parseZohoUrl(url) {
  try {
    const u = new URL(url);
    // Match: /crm/<org>/tab/<TabName>/<recordId>
    const match = u.pathname.match(/\/crm\/[^/]+\/tab\/([^/]+)\/(\d{10,25})/);
    if (!match) return null;

    const tabName = match[1];
    const recordId = match[2];
    const module = TAB_TO_MODULE[tabName] || tabName;

    return { module, recordId, tabName };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// Extract record name from page DOM
// ─────────────────────────────────────────────

/**
 * Try to extract the record name/title from the Zoho CRM page.
 * Zoho renders the record name in several possible selectors.
 */
function extractRecordName() {
  // Primary: the record header title
  const selectors = [
    '.entityNameContent',           // Record detail header
    '.moduleHead .lyte-text',       // Alternate header
    '.header-info .primaryText',    // Another variant
    'h1.moduleHead',                // Module header
    '.entityHeaderInfo .primaryField', // Primary field
    '[data-zia-view="entity_name"]',   // ZIA annotated
    '.recordTitle',                 // Record title
    '.lyte-text[data-field-name="Account_Name"]',
    '.lyte-text[data-field-name="Full_Name"]',
    '.lyte-text[data-field-name="Deal_Name"]',
    '.lyte-text[data-field-name="Subject"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0 && text.length < 200) return text;
    }
  }

  // Fallback: page title often contains the record name
  // Format: "Record Name - Module - Zoho CRM"
  const title = document.title || '';
  const parts = title.split(' - ');
  if (parts.length >= 2 && parts[0].trim().length > 0) {
    return parts[0].trim();
  }

  return null;
}

/**
 * Extract email address from the current record page (for contacts).
 */
function extractRecordEmail() {
  const emailSelectors = [
    '[data-field-name="Email"] a[href^="mailto:"]',
    '[data-field-name="Email"] .zcrmLink',
    '[data-field-name="Email"] a',
    'a[href^="mailto:"]',
  ];

  for (const sel of emailSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      let email = '';
      if (el.href && el.href.startsWith('mailto:')) {
        email = el.href.replace('mailto:', '').split('?')[0];
      } else {
        email = el.textContent.trim();
      }
      if (email && email.includes('@')) return email;
    }
  }
  return null;
}

/**
 * Extract the account name from a Contact or Deal record page.
 */
function extractAccountName() {
  const selectors = [
    '[data-field-name="Account_Name"] a',
    '[data-field-name="Account_Name"] .zcrmLink',
    '[data-field-name="Account_Name"] .lyte-text',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0) return text;
    }
  }
  return null;
}

/**
 * Extract the website/domain from an Account record page.
 */
function extractWebsite() {
  const selectors = [
    '[data-field-name="Website"] a',
    '[data-field-name="Website"] .zcrmLink',
    '[data-field-name="Website"] .lyte-text',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0) return text;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// Context detection & messaging
// ─────────────────────────────────────────────

let lastSentContext = null;

/**
 * Persist context directly to chrome.storage.local so the sidebar can always
 * read it, even when the MV3 service worker is sleeping (sendMessage would
 * silently fail if the background is inactive).
 *
 * We still fire sendMessage() so the background's in-memory cache
 * (currentZohoPageContext) stays warm while the worker is alive.
 */
function persistContext(ctx) {
  chrome.storage.local.set({ zohoPageContext: ctx }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Stratus AI] Failed to persist Zoho context to storage:',
        chrome.runtime.lastError.message);
    }
  });
}

/**
 * Detect the current Zoho record and send context to the background.
 */
function detectAndSendContext() {
  const parsed = parseZohoUrl(window.location.href);

  if (!parsed) {
    // Not on a record page (maybe list view, dashboard, etc.)
    const ctx = { type: 'zoho', page: 'list', module: null, recordId: null };
    const key = JSON.stringify(ctx);
    if (key !== lastSentContext) {
      lastSentContext = key;
      // Write directly to storage — don't rely on the service worker being alive
      persistContext(ctx);
      // Also message the background to update its in-memory cache (best-effort)
      chrome.runtime.sendMessage({
        type: 'ZOHO_CONTEXT_CHANGED',
        ...ctx,
      }).catch(() => {});
    }
    return;
  }

  const { module, recordId, tabName } = parsed;
  const recordName = extractRecordName();
  const email = extractRecordEmail();
  const accountName = extractAccountName();
  const website = extractWebsite();

  const ctx = {
    type: 'zoho',
    page: 'record',
    module,
    recordId,
    tabName,
    recordName,
    email,
    accountName,
    website,
  };

  const key = JSON.stringify(ctx);
  if (key !== lastSentContext) {
    lastSentContext = key;
    // Write directly to storage — don't rely on the service worker being alive
    persistContext(ctx);
    // Also message the background to update its in-memory cache (best-effort)
    chrome.runtime.sendMessage({
      type: 'ZOHO_CONTEXT_CHANGED',
      ...ctx,
    }).catch(() => {});
    console.log('[Stratus AI] Zoho context detected:', module, recordId, recordName || '(loading)');
  }
}

// ─────────────────────────────────────────────
// Gmail quick-links (existing feature)
// ─────────────────────────────────────────────

function buildGmailSearchUrl(email) {
  const query = encodeURIComponent(`from:${email} OR to:${email}`);
  return `${GMAIL_SEARCH_BASE}${query}`;
}

function injectGmailLinks() {
  const emailElements = document.querySelectorAll(
    'a[href^="mailto:"], ' +
    '.zcrmEmailLink, ' +
    '[data-field-name="Email"] .zcrmLink, ' +
    '[data-field-name="Email"] a, ' +
    'span[data-type="email"]'
  );

  emailElements.forEach((el) => {
    if (el.dataset.stratusGmailLink) return;
    el.dataset.stratusGmailLink = 'true';

    let email = '';
    if (el.href && el.href.startsWith('mailto:')) {
      email = el.href.replace('mailto:', '').split('?')[0];
    } else {
      email = el.textContent.trim();
    }

    if (!email || !email.includes('@')) return;

    const gmailBtn = document.createElement('a');
    gmailBtn.href = buildGmailSearchUrl(email);
    gmailBtn.target = '_blank';
    gmailBtn.rel = 'noopener';
    gmailBtn.className = 'stratus-gmail-link';
    gmailBtn.title = `View ${email} in Gmail`;
    gmailBtn.style.cssText = `
      display: inline-flex; align-items: center; gap: 3px;
      margin-left: 8px; padding: 2px 8px; border-radius: 4px;
      background: #ea433515; color: #ea4335; font-size: 11px;
      font-weight: 500; text-decoration: none; cursor: pointer;
      border: 1px solid #ea433522; transition: all 0.15s ease;
      vertical-align: middle;
    `;
    gmailBtn.innerHTML = '✉ Gmail';

    gmailBtn.addEventListener('mouseenter', () => {
      gmailBtn.style.background = '#ea433525';
    });
    gmailBtn.addEventListener('mouseleave', () => {
      gmailBtn.style.background = '#ea433515';
    });

    el.parentNode.insertBefore(gmailBtn, el.nextSibling);
  });
}

// ─────────────────────────────────────────────
// Initialization & SPA navigation tracking
// ─────────────────────────────────────────────

// Initial detection (with short delay for page to render record name)
setTimeout(() => {
  detectAndSendContext();
  injectGmailLinks();
}, 500);

// Retry context detection a few times as Zoho lazy-loads record content
let retryCount = 0;
const retryInterval = setInterval(() => {
  detectAndSendContext();
  retryCount++;
  if (retryCount >= 6) clearInterval(retryInterval); // Stop after ~6s
}, 1000);

// Watch for SPA navigation via URL changes
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    lastSentContext = null; // Reset so we re-detect
    retryCount = 0;

    // Immediately clear stale context from storage so the sidebar doesn't
    // show the previous record during the render delay. detectAndSendContext()
    // will write the correct new context once Zoho finishes rendering.
    chrome.storage.local.remove('zohoPageContext');

    // Delay to let Zoho render the new page
    setTimeout(() => {
      detectAndSendContext();
      injectGmailLinks();
    }, 600);

    // Additional retries for lazy-loaded content
    let navRetries = 0;
    const navRetryInterval = setInterval(() => {
      detectAndSendContext();
      injectGmailLinks();
      navRetries++;
      if (navRetries >= 5) clearInterval(navRetryInterval);
    }, 1000);
  }

  // Always re-inject Gmail links (Zoho re-renders DOM frequently)
  injectGmailLinks();
});

urlObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also listen for right-click on email elements
document.addEventListener('contextmenu', (e) => {
  const emailEl = e.target.closest('a[href^="mailto:"], .zcrmEmailLink, [data-field-name="Email"] a');
  if (emailEl) {
    window.__stratusSelectedEmail = emailEl.textContent.trim() ||
      (emailEl.href || '').replace('mailto:', '').split('?')[0];
  }
});

// Listen for requests from the sidebar/background to get current context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'GET_ZOHO_PAGE_DATA') {
    const parsed = parseZohoUrl(window.location.href);
    sendResponse({
      ...parsed,
      recordName: extractRecordName(),
      email: extractRecordEmail(),
      accountName: extractAccountName(),
      website: extractWebsite(),
    });
    return true;
  }
});

console.log('[Stratus AI] Zoho CRM content script loaded (with context detection).');
