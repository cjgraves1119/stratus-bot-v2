/**
 * Stratus AI Chrome Extension — Context Menus
 *
 * Right-click context menus for selected text in Gmail.
 */

import { generateQuote, crmSearch } from './api-client.js';

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

    chrome.contextMenus.create({
      id: 'stratus-velocity-hub',
      title: 'Send Deal ID to Velocity Hub',
      contexts: ['selection'],
      documentUrlPatterns: ['https://mail.google.com/*'],
    });

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
      // Open sidebar with quote panel pre-filled
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        // Send message to sidebar to navigate to quote panel with pre-filled text
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'quote',
            data: { skuText: selectedText.trim() },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Context menu quote failed:', err);
      }
      break;
    }

    case 'stratus-crm-lookup': {
      if (!selectedText.trim()) return;
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'search',
            data: { query: selectedText.trim() },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Context menu CRM lookup failed:', err);
      }
      break;
    }

    case 'stratus-velocity-hub': {
      if (!selectedText.trim()) return;
      const dealIdMatch = selectedText.match(/\d{13,19}/);
      if (dealIdMatch) {
        try {
          await chrome.sidePanel.open({ tabId: tab.id });
          setTimeout(() => {
            chrome.runtime.sendMessage({
              type: 'SIDEBAR_NAVIGATE',
              panel: 'email',
              data: { velocityHubDealId: dealIdMatch[0] },
            });
          }, 500);
        } catch (err) {
          console.error('[Stratus] Velocity Hub context menu failed:', err);
        }
      }
      break;
    }

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
      if (!info.srcUrl) return;
      try {
        await chrome.sidePanel.open({ tabId: tab.id });
        setTimeout(() => {
          chrome.runtime.sendMessage({
            type: 'SIDEBAR_NAVIGATE',
            panel: 'quote',
            data: { imageUrl: info.srcUrl },
          });
        }, 500);
      } catch (err) {
        console.error('[Stratus] Image quote context menu failed:', err);
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
