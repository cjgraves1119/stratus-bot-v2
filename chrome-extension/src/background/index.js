/**
 * Stratus AI Chrome Extension — Background Service Worker
 *
 * Central hub for all extension functionality:
 * - Message routing between content scripts, sidebar, and popup
 * - API calls to the Cloudflare worker
 * - Zoho OAuth management
 * - Cache management
 * - Keyboard shortcuts
 * - Context menus
 * - Notifications
 */

import { MSG } from '../lib/constants.js';
import { registerMessageHandlers } from '../lib/messaging.js';
import { getSettings } from '../lib/storage.js';

import * as api from './api-client.js';
import { startZohoAuth, getAuthStatus, disconnectZoho, getValidZohoToken } from './auth.js';
import { setupCacheAlarms, handleAlarm, refreshPriceCatalog } from './cache.js';
import { setupContextMenus, handleContextMenuClick } from './context-menus.js';
import { showNotification, handleNotificationClick, checkDueTasks } from './notifications.js';
import { handleCommand } from './shortcuts.js';

// ─────────────────────────────────────────────
// Extension Lifecycle
// ─────────────────────────────────────────────

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Stratus AI] Extension installed/updated:', details.reason);

  // Set up context menus
  setupContextMenus();

  // Set up cache alarms
  setupCacheAlarms();

  // Open options page on first install
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage();
  }

  // Set side panel behavior — open on action click
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  console.log('[Stratus AI] Extension started.');
  setupCacheAlarms();

  // Check for due tasks on startup
  setTimeout(() => checkDueTasks(), 5000);
});

// ─────────────────────────────────────────────
// Message Handlers (content ↔ background ↔ sidebar)
// ─────────────────────────────────────────────

// In-memory email context (set by content script, read by sidebar)
let currentEmailContext = null;
let currentCrmContext = null;
let currentTaskRescheduleContext = null;
let currentZohoPageContext = null; // Set by Zoho content script
let currentPageType = 'other';     // 'gmail' | 'zoho' | 'other'

registerMessageHandlers({
  // ── Email Context ──
  [MSG.EMAIL_CHANGED]: async (payload) => {
    currentEmailContext = payload;
    currentCrmContext = null; // Reset CRM context on new email
    // Persist to chrome.storage.session for recovery after service worker sleep
    try {
      await chrome.storage.session.set({ emailContext: payload });
    } catch (err) {
      console.error('[Stratus] Failed to persist email context to session storage:', err);
    }
    return { success: true };
  },

  [MSG.GET_EMAIL_CONTEXT]: async () => {
    // Return in-memory context if available
    if (currentEmailContext) {
      return currentEmailContext;
    }
    // Recover from session storage if service worker was asleep
    try {
      const stored = await chrome.storage.session.get('emailContext');
      if (stored && stored.emailContext) {
        currentEmailContext = stored.emailContext;
        return currentEmailContext;
      }
    } catch (err) {
      console.error('[Stratus] Failed to retrieve email context from session storage:', err);
    }
    return { empty: true };
  },

  [MSG.GET_CRM_CONTEXT]: async () => {
    return currentCrmContext || { empty: true };
  },

  // ── CRM Operations ──
  [MSG.CRM_LOOKUP]: async ({ email, domain }) => {
    const result = await api.crmContactLookup(email, domain);
    if (result && result.found) {
      currentCrmContext = result;
    }
    return result;
  },

  [MSG.CRM_LOOKUP_CONTACT]: async ({ email, domain }) => {
    const result = await api.crmContactLookup(email, domain);
    if (result && result.found) {
      currentCrmContext = result;
    }
    return result;
  },

  [MSG.CRM_DEALS]: async ({ accountId, contactEmail }) => {
    return api.crmDeals(accountId, contactEmail);
  },

  [MSG.CRM_ISR_DEALS]: async ({ repEmail, repName }) => {
    return api.crmIsrDeals(repEmail, repName);
  },

  [MSG.CRM_SEARCH]: async ({ query, module }) => {
    return api.crmSearch(query, module);
  },

  // ── Email Analysis ──
  [MSG.ANALYZE_EMAIL]: async ({ subject, body, senderEmail, senderName }) => {
    return api.analyzeEmail(subject, body, senderEmail, senderName);
  },

  // ── Quoting ──
  [MSG.GENERATE_QUOTE]: async ({ skuText, personId }) => {
    return api.generateQuote(skuText, personId);
  },

  // ── Draft Reply ──
  [MSG.DRAFT_REPLY]: async ({ subject, body, senderEmail, senderName, tone, instructions }) => {
    return api.draftReply(subject, body, senderEmail, senderName, tone, instructions);
  },

  // ── SKU Detection ──
  [MSG.DETECT_SKUS]: async ({ text }) => {
    return api.detectSkus(text);
  },

  // ── Tasks ──
  [MSG.FETCH_TASKS]: async ({ domains, emails, accountId, contactId }) => {
    return api.fetchTasks(domains, emails, accountId, contactId);
  },

  [MSG.TASK_ACTION]: async ({ action, taskId, ...options }) => {
    return api.taskAction(action, taskId, options);
  },

  // ── Price Lookup ──
  [MSG.GET_PRICE]: async ({ sku }) => {
    const { getPrice } = await import('../lib/storage.js');
    return getPrice(sku);
  },

  // ── Auth ──
  [MSG.ZOHO_AUTH_START]: async () => {
    return startZohoAuth();
  },

  [MSG.GET_AUTH_STATUS]: async () => {
    return getAuthStatus();
  },

  // ── Settings ──
  [MSG.GET_SETTINGS]: async () => {
    return getSettings();
  },

  [MSG.SAVE_SETTINGS]: async (payload) => {
    const { saveSettings } = await import('../lib/storage.js');
    return saveSettings(payload);
  },

  // ── Sidebar Navigation ──
  [MSG.SIDEBAR_NAVIGATE]: async (payload, sender) => {
    // If openPanel flag is set (e.g. from contact chip click), open the side panel first
    if (payload.openPanel && sender?.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => {});
    }
    // Message is also received by the sidebar's onMessage listener for in-panel navigation
    return { forwarded: true };
  },

  // ── Email Sent Detection & Task Rescheduling ──
  [MSG.EMAIL_SENT]: async ({ recipients, subject, sentAt }) => {
    if (!recipients || recipients.length === 0) {
      return { success: false, message: 'No recipients found' };
    }

    try {
      // Fetch open tasks for the recipients
      const result = await api.fetchTasks([], recipients);
      const openTasks = (result && result.tasks) || [];

      if (openTasks.length > 0) {
        // Store context for the sidebar to display
        currentTaskRescheduleContext = {
          recipients,
          subject,
          sentAt,
          tasksFound: openTasks.length,
          tasks: openTasks,
        };

        // Show notification with task count
        const { showNotification } = await import('./notifications.js');
        showNotification(
          'Tasks to Reschedule',
          `Found ${openTasks.length} open task${openTasks.length > 1 ? 's' : ''} for the recipient${recipients.length > 1 ? 's' : ''}. Would you like to reschedule?`,
          { id: 'task-reschedule', requireInteraction: true }
        );

        return { success: true, tasksFound: openTasks.length };
      }

      return { success: true, tasksFound: 0 };
    } catch (err) {
      console.error('[Stratus] EMAIL_SENT handler error:', err);
      return { success: false, message: err.message };
    }
  },

  [MSG.CHECK_OPEN_TASKS]: async () => {
    return currentTaskRescheduleContext || { empty: true };
  },

  // ── CRM Write Operations ──
  [MSG.CRM_ADD_CONTACT]: async ({ firstName, lastName, email, phone, title, accountId, mobile }) => {
    return api.crmAddContact(firstName, lastName, email, phone, title, accountId, mobile);
  },

  // ── Image Analysis (screenshot/dashboard parsing) ──
  [MSG.ANALYZE_IMAGE]: async ({ imageUrl, imageBase64 }) => {
    return api.analyzeImageForSkus(imageUrl, imageBase64);
  },

  // ── Chat Handoff (CRM-aware) ──
  [MSG.CHAT_HANDOFF]: async ({ text, emailContext, history, systemContext }) => {
    return api.chatWithCrm(text, emailContext, history, systemContext);
  },

  // ── CCW / Velocity Hub ──
  [MSG.CCW_LOOKUP]: async ({ ccwDealNumber, dealName }) => {
    return api.ccwLookup(ccwDealNumber, dealName);
  },

  [MSG.VELOCITY_HUB_SUBMIT]: async ({ dealId, country }) => {
    return api.velocityHubSubmit(dealId, country);
  },

  [MSG.ASSIGN_REP]: async ({ dealId, repEmail, repName }) => {
    return api.assignCiscoRep(dealId, repEmail, repName);
  },

  // ── Suggest Task ──
  [MSG.SUGGEST_TASK_PREVIEW]: async (params) => {
    return api.suggestTaskPreview(
      params.senderEmail, params.senderName, params.subject,
      params.accountId, params.threadDomains
    );
  },

  [MSG.SUGGEST_TASK]: async (params) => {
    return api.suggestTask(params);
  },

  // ── CRM Account Search ──
  [MSG.CRM_ACCOUNT_SEARCH]: async ({ query, domain }) => {
    return api.crmAccountSearch(query, domain);
  },

  // ── CRM Create Account ──
  [MSG.CRM_CREATE_ACCOUNT]: async ({ name, street, city, state, zip, website }) => {
    return api.crmCreateAccount(name, street, city, state, zip, website);
  },

  // ── Enrich Company (domain → company info) ──
  [MSG.ENRICH_COMPANY]: async ({ domain }) => {
    return api.enrichCompany(domain);
  },

  // ── CRM Create Task ──
  [MSG.CRM_CREATE_TASK]: async ({ subject, dueDate, dealId, contactId, priority, description }) => {
    return api.crmCreateTask(subject, dueDate, dealId, contactId, priority, description);
  },

  // ── Zoho Page Context ──
  [MSG.ZOHO_CONTEXT_CHANGED]: async (payload) => {
    currentZohoPageContext = payload;
    // Persist to session storage for recovery after service worker sleep
    try {
      await chrome.storage.session.set({ zohoPageContext: payload });
    } catch (err) {
      console.error('[Stratus] Failed to persist Zoho context:', err);
    }
    return { success: true };
  },

  [MSG.GET_PAGE_CONTEXT]: async () => {
    // Determine current page type from the active tab URL
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const url = tab?.url || '';

      if (url.startsWith('https://mail.google.com/')) {
        currentPageType = 'gmail';
      } else if (url.startsWith('https://crm.zoho.com/')) {
        currentPageType = 'zoho';
      } else {
        currentPageType = 'other';
      }
    } catch {
      // Fallback if tabs query fails
    }

    // Recover Zoho context from session storage if needed
    if (!currentZohoPageContext) {
      try {
        const stored = await chrome.storage.session.get('zohoPageContext');
        if (stored?.zohoPageContext) {
          currentZohoPageContext = stored.zohoPageContext;
        }
      } catch {}
    }

    return {
      pageType: currentPageType,
      zohoContext: currentZohoPageContext,
      emailContext: currentEmailContext,
    };
  },

  // ── Tab Screenshot Capture ──
  [MSG.CAPTURE_TAB]: async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) throw new Error('No active tab found');
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
      // Strip the data:image/png;base64, prefix to get raw base64
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      return { success: true, base64, dataUrl };
    } catch (err) {
      console.error('[Stratus] Tab capture failed:', err);
      return { success: false, error: err.message };
    }
  },
});

// ─────────────────────────────────────────────
// Alarms
// ─────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(handleAlarm);

// ─────────────────────────────────────────────
// Commands (Keyboard Shortcuts)
// ─────────────────────────────────────────────

chrome.commands.onCommand.addListener(handleCommand);

// ─────────────────────────────────────────────
// Context Menus
// ─────────────────────────────────────────────

chrome.contextMenus.onClicked.addListener(handleContextMenuClick);

// ─────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────

chrome.notifications.onClicked.addListener(handleNotificationClick);

// ─────────────────────────────────────────────
// Side Panel
// ─────────────────────────────────────────────

// Enable side panel for all tabs (Gmail, Zoho CRM, and everything else for search)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url) {
    chrome.sidePanel.setOptions({
      tabId,
      path: 'sidebar.html',
      enabled: true,
    }).catch(() => {});

    // Track page type transitions and clear stale context
    if (changeInfo.status === 'complete') {
      if (tab.url.startsWith('https://mail.google.com/')) {
        currentPageType = 'gmail';
        currentZohoPageContext = null;
      } else if (tab.url.startsWith('https://crm.zoho.com/')) {
        currentPageType = 'zoho';
        currentEmailContext = null;
      } else {
        currentPageType = 'other';
        currentEmailContext = null;
        currentZohoPageContext = null;
      }
    }
  }
});
