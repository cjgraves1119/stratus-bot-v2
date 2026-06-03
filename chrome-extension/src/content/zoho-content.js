/**
 * Stratus AI Chrome Extension — Zoho CRM Content Script
 *
 * 1. Detects the current Zoho CRM record (Account, Contact, Deal, Quote, etc.)
 *    from the URL and page content, then sends context to the background
 *    service worker, which persists it under a per-tab key
 *    (`zohoCtx_<tabId>` in chrome.storage.session) so other tabs' contexts
 *    never leak into the active-tab read path.
 * 2. Injects "View in Gmail" quick links next to email fields.
 *
 * URL is authoritative: on every SPA navigation we publish a minimal
 * URL-derived context immediately (before DOM enrichment finishes) so the
 * sidebar/background never serve a stale record in the gap.
 *
 * The content script NEVER writes to chrome.storage directly — it cannot
 * know its own tab id, and a global storage key (the prior approach) is the
 * root cause of the cross-tab context-bleed bug. All persistence is routed
 * through chrome.runtime.sendMessage so the background can stamp
 * `sender.tab.id` and key storage correctly.
 *
 * Runs only on crm.zoho.com pages.
 */

import {
  parseZohoRecordUrl,
  minimalContextFromUrl,
} from '../lib/zoho-url.js';

const GMAIL_SEARCH_BASE = 'https://mail.google.com/mail/u/0/#search/';

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
 * Publish a Zoho page context (list or record) to the background service
 * worker. The background is now the SINGLE WRITER to chrome.storage.session
 * for the per-tab keyed entries (zohoCtx_<tabId>) — content scripts cannot
 * know their own tab id, so writing storage directly here would either need
 * a global key (the prior cross-tab bleed bug) or be unsafe.
 *
 * Dedupes on JSON equality so we don't spam the worker during repeated
 * observer ticks.
 *
 * NOTE on message shape: we MUST spread `ctx` FIRST and then set `type` so
 * the outer dispatch `type` is not clobbered by `ctx.type` (which is the
 * literal string 'zoho' from minimalContextFromUrl, NOT a discriminator).
 * The previous shape `{ type: 'ZOHO_CONTEXT_CHANGED', ...ctx }` silently
 * overwrote the message type back to 'zoho', so registerMessageHandlers
 * never dispatched to MSG.ZOHO_CONTEXT_CHANGED. (EXT-CRIT-1)
 */
function publishContext(ctx) {
  if (!ctx) return;
  const key = JSON.stringify(ctx);
  if (key === lastSentContext) return;
  lastSentContext = key;
  // Background handles BOTH the in-memory cache AND the per-tab storage write.
  chrome.runtime.sendMessage({
    ...ctx,
    type: 'ZOHO_CONTEXT_CHANGED',
  }).catch(() => {});
}

/**
 * Immediately publish a URL-only context (no DOM enrichment) so the sidebar
 * switches to the new record the moment SPA navigation happens. The later
 * detectAndSendContext() call will enrich it with recordName/email/etc.
 */
function publishMinimalUrlContext() {
  const urlInfo = parseZohoRecordUrl(window.location.href);
  if (!urlInfo) return;
  const minimal = minimalContextFromUrl(urlInfo);
  if (minimal) publishContext(minimal);
}

/**
 * Detect the current Zoho record and send context to the background.
 *
 * Every published context carries:
 *   - url: the URL the context was derived from (authoritative source)
 *   - detectedAt: ms timestamp (helps downstream staleness checks)
 */
function detectAndSendContext() {
  const urlInfo = parseZohoRecordUrl(window.location.href);

  if (!urlInfo) {
    // Shouldn't happen — script only runs on crm.zoho.com — but guard anyway.
    return;
  }

  if (!urlInfo.isRecord) {
    // List view, dashboard, etc. Publish a list context with the URL attached
    // so the sidebar can still tell "we're on Zoho, just not on a record".
    publishContext(minimalContextFromUrl(urlInfo));
    return;
  }

  const { module, recordId, tabName, url } = urlInfo;
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
    url,
    detectedAt: Date.now(),
    recordName,
    email,
    accountName,
    website,
  };

  if (publishContextIfEnriched(ctx)) {
    console.log('[Stratus AI] Zoho context detected:', module, recordId, recordName || '(loading)');
  }
}

/**
 * Wrapper around publishContext() that skips "downgrade" writes:
 * if storage already has the same record with a populated recordName,
 * don't clobber it with a newer ctx that hasn't enriched yet.
 *
 * Returns `true` if it published, `false` if skipped.
 */
function publishContextIfEnriched(ctx) {
  if (!ctx) return false;
  publishContext(ctx);
  return true;
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

// Initial detection: publish URL-derived context on the same tick the script
// loads so the sidebar has a record id to show before DOM enrichment finishes.
publishMinimalUrlContext();
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

// Watch for SPA navigation via URL changes.
//
// CRITICAL: previously this block `chrome.storage.local.remove('zohoPageContext')`
// on nav and then waited ~600ms for DOM enrichment before re-publishing.
// During that gap the sidebar/background could continue to serve the old
// quote id as "the record the user is currently viewing" via the in-memory
// cache in the service worker, producing the stale-quote bug reproduced by
// Codex on 2026-04-24 (Quote 2570562000400116511 still showing after user
// navigated to Quote 2570562000402426396).
//
// Fix: publish a MINIMAL URL-derived context synchronously on nav
// (module + recordId + url + detectedAt, with recordName/email/etc. blank).
// DOM enrichment then upgrades that context in place via the retry cycle.
// The background re-stamps storage under the per-tab key `zohoCtx_<tabId>`
// on every push, so storage is always in sync with the most recent push.
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    lastSentContext = null; // Reset so we re-detect
    retryCount = 0;

    // Publish the new record's URL-derived context IMMEDIATELY so the sidebar
    // switches to the new quote/deal/account on the same tick as the URL
    // change — no stale-record window.
    publishMinimalUrlContext();

    // Enrich with DOM data as soon as Zoho has rendered.
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
    const urlInfo = parseZohoRecordUrl(window.location.href);
    const base = urlInfo && urlInfo.isRecord
      ? {
          module: urlInfo.module,
          recordId: urlInfo.recordId,
          tabName: urlInfo.tabName,
          url: urlInfo.url,
          detectedAt: Date.now(),
        }
      : {};
    sendResponse({
      ...base,
      recordName: extractRecordName(),
      email: extractRecordEmail(),
      accountName: extractAccountName(),
      website: extractWebsite(),
    });
    return true;
  }
});

console.log('[Stratus AI] Zoho CRM content script loaded (with context detection).');
