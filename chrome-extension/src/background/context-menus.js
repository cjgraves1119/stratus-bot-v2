/**
 * Stratus AI Chrome Extension — Context Menus
 *
 * Right-click context menus for selected text in Gmail.
 */

import { generateQuote, crmSearch } from './api-client.js';
import { queueQuoteSidebarAction } from './sidebar-actions.js';
import { MSG } from '../lib/constants.js';
import { verifiedPendingQuoteGmailContext } from '../lib/pending-sidebar-action.mjs';

/**
 * Post one message to a Zoho tab's content script. Kept local and tiny rather
 * than importing the background's own helper, because context-menus.js is
 * imported BY background/index.js and a back-import would be circular.
 */
function sendToZohoTab(tabId, type, payload) {
  return new Promise((resolve) => {
    try {
      chrome.tabs.sendMessage(tabId, { type, ...payload }, (response) => {
        void chrome.runtime.lastError;
        resolve(response || null);
      });
    } catch (_) { resolve(null); }
  });
}

/**
 * Detect which Zoho CRM module a highlighted string most likely belongs to,
 * so we can auto-select the right tab in the Search panel.
 *
 * Order matters — tighter patterns first.
 */
export function detectSearchModule(text) {
  const t = (text || '').trim();
  if (!t) return 'Accounts';

  // Email address → Contacts (find by email)
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return 'Contacts';

  // Stratus uses 18-19 digit Zoho-style IDs as SO_Number — long pure numeric → POs
  if (/^\d{15,}$/.test(t)) return 'Sales_Orders';

  // Deal ID / DLID / DID / CCW number → related Quotes
  if (/^(?:deal\s*(?:id|#)?|dlid|did|ccw)[\s#:\-_]*\d{8}$/i.test(t)) return 'Quotes';
  if (/^\d{8}$/.test(t)) return 'Quotes';

  // Invoice patterns: "Invoice 26236", "INV-12345", "INV12345", "INV 12345"
  if (/^(?:inv|invoice)[\s#:\-_]*\d+$/i.test(t)) return 'Invoices';

  // Bare short numeric lookups are invoice numbers in the extension search flow.
  // Keep long Zoho-style ids above routed to Sales_Orders.
  if (/^\d{4,7}$/.test(t)) return 'Invoices';

  // Quote patterns: "QT-12345", "Q-12345", "Quote-12345"
  if (/^(qt|q|quote)[\s\-_]?\d+$/i.test(t)) return 'Quotes';

  // Two-word "First Last" → Contacts. Single word or 3+ words → Accounts.
  // Keep simple: alphabetic two words with no punctuation other than apostrophes/hyphens.
  const words = t.split(/\s+/);
  if (words.length === 2 && words.every(w => /^[A-Za-z][A-Za-z'\-]*\.?$/.test(w))) {
    return 'Contacts';
  }

  // Default — covers single-word company names, multi-word company names with commas/LLC etc.
  return 'Accounts';
}

/**
 * Create context menu items. Called once on extension install.
 */
export function setupContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'stratus-quote-selection',
      title: 'Quote these SKUs with Stratus',
      contexts: ['selection'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    chrome.contextMenus.create({
      id: 'stratus-crm-lookup',
      title: 'Look up "%s" in Zoho CRM',
      contexts: ['selection'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    // 2026-05-12: stratus-velocity-hub context menu removed per Chris. The
    // right-click "Send Deal ID to Velocity Hub" shortcut on selected text
    // is gone. Server-side velocity_hub_submit tool stays intact — it's
    // still used by the deterministic quote_to_po_and_esign workflow.

    chrome.contextMenus.create({
      id: 'stratus-separator',
      type: 'separator',
      contexts: ['selection'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    chrome.contextMenus.create({
      id: 'stratus-copy-sku',
      title: 'Copy SKU to clipboard',
      contexts: ['selection'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    chrome.contextMenus.create({
      id: 'stratus-quote-image',
      title: 'Analyze image for SKUs with Stratus',
      contexts: ['image'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    chrome.contextMenus.create({
      id: 'stratus-gmail-thread',
      title: 'View in Gmail',
      contexts: ['selection', 'link'],
      documentUrlPatterns: ['https://crm.zoho.com/*'],
    });

    // Quote Line Editor (2026-08-20). A real user gesture, scoped to Zoho, so
    // the in-page overlay can be opened without the keyboard shortcuts (which
    // shortcuts.js hard-gates to Gmail tabs). The content script decides
    // whether the current page is actually a Quote record.
    chrome.contextMenus.create({
      id: 'stratus-quote-line-editor',
      title: 'Edit quote line items',
      contexts: ['page'],
      documentUrlPatterns: ['https://crm.zoho.com/*'],
    });

    // Right-click on email addresses to look up contact in CRM
    chrome.contextMenus.create({
      id: 'stratus-lookup-email',
      title: 'Look up in Stratus AI',
      contexts: ['link'],
      targetUrlPatterns: ['mailto:*'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

    // Screenshot capture for quoting (works on any page)
    chrome.contextMenus.create({
      id: 'stratus-capture-screenshot',
      title: 'Capture screenshot for quoting',
      contexts: ['page'],
      documentUrlPatterns: ['https://*/*'],
    });
  });
}

/**
 * Handle context menu clicks.
 */
export async function handleContextMenuClick(info, tab) {
  const selectedText = info.selectionText || '';

  switch (info.menuItemId) {
    case 'stratus-quote-selection': {
      if (!selectedText.trim()) return;
      try {
        // Preserve the user gesture: opening the panel must be the first async
        // browser action. The quote request itself is then queued durably so a
        // slower panel mount cannot lose it behind a fixed timeout.
        await chrome.sidePanel.open({ tabId: tab.id });
        // Capture only the identity fields from the exact Gmail tab that
        // received the right-click. The queue boundary sanitizes this down to
        // the thread id + participants and drops every subject/body field.
        // This must happen after sidePanel.open so the browser user gesture is
        // not lost.
        let gmailContext = null;
        try {
          const live = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_EMAIL_CONTEXT });
          if (live && !live.empty) {
            gmailContext = verifiedPendingQuoteGmailContext(live, {
              pageUrl: info.pageUrl,
              tabUrl: tab.url,
            });
          }
        } catch (_) { /* an unhydrated Gmail tab safely yields an unscoped quote */ }
        const action = await queueQuoteSidebarAction({
          quoteSkuText: selectedText.trim(),
          tabId: tab.id,
          windowId: tab.windowId,
          gmailContext,
        });
        if (!action) throw new Error('Could not create a bounded quote action');
        // Fast wake-up only. The sidebar still claims the stored action on
        // mount/storage change, so this message may be missed without data loss.
        chrome.runtime.sendMessage({
          type: 'SIDEBAR_ACTION_AVAILABLE',
          actionId: action.actionId,
        }, () => void chrome.runtime.lastError);
      } catch (err) {
        console.error('[Stratus] Context menu quote failed:', err);
      }
      break;
    }

    case 'stratus-crm-lookup': {
      const trimmed = selectedText.trim();
      if (!trimmed) return;
      const module = detectSearchModule(trimmed);
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        setTimeout(() => {
          const emailLookup = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: emailLookup ? 'crm' : 'search',
            data: emailLookup ? { preloadEmail: trimmed } : { query: trimmed, module },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Context menu CRM lookup failed:', err);
      }
      break;
    }

    // 2026-05-12: stratus-velocity-hub right-click handler removed.

    case 'stratus-copy-sku': {
      if (!selectedText.trim()) return;
      // Send to content script to copy via Clipboard API
      chrome.tabs.sendMessage(tab.id, {
        type: 'COPY_TO_CLIPBOARD',
        text: selectedText.trim().toUpperCase(),
      });
      break;
    }

    case 'stratus-quote-image': {
      try {
        // MUST open side panel FIRST (before any async work) to satisfy user-gesture requirement
        await chrome.sidePanel.open({ tabId: tab.id });
        // Now capture the visible tab as base64 screenshot
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'chat',
            data: { imageBase64: base64 },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Image quote context menu failed:', err);
      }
      break;
    }

    case 'stratus-lookup-email': {
      // Right-click on mailto: link → look up contact in CRM sidebar
      let email = '';
      if (info.linkUrl && info.linkUrl.startsWith('mailto:')) {
        email = decodeURIComponent(info.linkUrl.replace('mailto:', '').split('?')[0]);
      }
      if (!email || !email.includes('@')) return;
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'crm',
            data: { preloadEmail: email },
            openPanel: true,
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Email lookup context menu failed:', err);
      }
      break;
    }

    case 'stratus-capture-screenshot': {
      try {
        // MUST open side panel FIRST to satisfy user-gesture requirement
        await chrome.sidePanel.open({ tabId: tab.id });
        const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
        const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'chat',
            data: { imageBase64: base64 },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Screenshot capture context menu failed:', err);
      }
      break;
    }

    case 'stratus-quote-line-editor': {
      if (!tab?.id) return;
      // Mounting is idempotent in the content script, so a double right-click
      // cannot stack two overlays.
      try {
        await sendToZohoTab(tab.id, 'OPEN_QUOTE_LINE_EDITOR', {});
      } catch (err) {
        console.warn('[Stratus AI] quote line editor could not be opened:', err?.message || err);
      }
      break;
    }

    case 'stratus-gmail-thread': {
      let email = selectedText.trim();

      // If it's a link (mailto), extract email from href
      if (info.linkUrl && info.linkUrl.startsWith('mailto:')) {
        email = info.linkUrl.replace('mailto:', '').split('?')[0];
      }

      // Validate it looks like an email
      if (!email || !email.includes('@')) return;

      // Build and open Gmail search URL
      const gmailSearchBase = 'https://mail.google.com/mail/u/0/#search/';
      const query = encodeURIComponent(`from:${email} OR to:${email}`);
      const gmailUrl = `${gmailSearchBase}${query}`;

      chrome.tabs.create({ url: gmailUrl });
      break;
    }
  }
}
