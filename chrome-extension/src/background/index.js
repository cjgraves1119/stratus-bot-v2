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

registerMessageHandlers({
  // ── Email Context ──
  [MSG.EMAIL_CHANGED]: async (payload) => {
    currentEmailContext = payload;
    currentCrmContext = null; // Reset CRM context on new email
    return { success: true };
  },

  [MSG.GET_EMAIL_CONTEXT]: async () => {
    return currentEmailContext || { empty: true };
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
  [MSG.GENERATE_QUOTE]: async ({ skuText }) => {
    return api.generateQuote(skuText);
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
  [MSG.FETCH_TASKS]: async ({ domains, emails }) => {
    return api.fetchTasks(domains, emails);
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
  [MSG.SIDEBAR_NAVIGATE]: async (payload) => {
    // This is forwarded to the sidebar via onMessage listeners
    // The sidebar listens for this directly
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

  // ── Image Analysis ──
  [MSG.ANALYZE_IMAGE]: async ({ imageUrl }) => {
    return api.analyzeImageForSkus(imageUrl);
  },

  // ── Chat Handoff ──
  [MSG.CHAT_HANDOFF]: async ({ text, emailContext }) => {
    return api.sendHandoff(text, emailContext);
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

// Enable side panel for Gmail tabs only
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url && tab.url.startsWith('https://mail.google.com/')) {
    chrome.sidePanel.setOptions({
      tabId,
      path: 'sidebar.html',
      enabled: true,
    }).catch(() => {});
  }
});
