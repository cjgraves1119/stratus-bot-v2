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
 */

import { MSG, IS_DEV_BUILD, API_BASE } from '../lib/constants.js';
import { registerMessageHandlers, sendToTab } from '../lib/messaging.js';
import { getSettings } from '../lib/storage.js';
import {
  parseZohoRecordUrl,
  contextMatchesUrl,
  minimalContextFromUrl,
} from '../lib/zoho-url.js';

import * as api from './api-client.js';
import { startZohoAuth, getAuthStatus, disconnectZoho, getValidZohoToken } from './auth.js';
import { setupCacheAlarms, handleAlarm, refreshPriceCatalog } from './cache.js';
import { setupContextMenus, handleContextMenuClick } from './context-menus.js';
import { handleCommand } from './shortcuts.js';

// ─────────────────────────────────────────────
// Zoho Quote → PDF export (web-UI "Export to PDF") helpers
// ─────────────────────────────────────────────
//
// No official Zoho CRM API returns the templated Quote PDF, and the internal
// export endpoint is session-cookie-gated. So we briefly open an INACTIVE
// crm.zoho.com print-preview tab (the user's live session), let the Zoho
// content script run the 2-step export there, return the PDF as base64, then
// close the tab. The sidebar turns the base64 into the actual download.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (ok) => { if (!done) { done = true; chrome.tabs.onUpdated.removeListener(onUpd); resolve(ok); } };
    const onUpd = (id, info) => { if (id === tabId && info.status === 'complete') finish(true); };
    chrome.tabs.onUpdated.addListener(onUpd);
    // Already-complete fast path + hard timeout backstop.
    chrome.tabs.get(tabId, (t) => { if (!chrome.runtime.lastError && t && t.status === 'complete') finish(true); });
    setTimeout(() => finish(false), timeoutMs);
  });
}

// Org-stable inventory-template ids (seed values for org647122552 — the org
// both instances share). Extended/refreshed at runtime from the preview
// flow's harvested templateIds, cached in chrome.storage.local.
const SEED_PDF_TEMPLATE_IDS = {
  org647122552: {
    'Hardware Quote': '2570562000000129141',
    'Professional Services Quote': '2570562000001580284',
  },
};

async function resolvePdfTemplateId(orgId, templateName) {
  try {
    const s = await chrome.storage.local.get(['zohoPdfTemplateIds']);
    const cached = (s.zohoPdfTemplateIds || {})[orgId] || {};
    if (templateName && cached[templateName]) return cached[templateName];
  } catch { /* storage unavailable — fall through to seeds */ }
  const seeded = SEED_PDF_TEMPLATE_IDS[orgId] || {};
  return (templateName && seeded[templateName]) || null;
}

async function cachePdfTemplateIds(orgId, ids) {
  if (!ids || typeof ids !== 'object' || !Object.keys(ids).length) return;
  try {
    const s = await chrome.storage.local.get(['zohoPdfTemplateIds']);
    const all = s.zohoPdfTemplateIds || {};
    all[orgId] = { ...(all[orgId] || {}), ...ids };
    await chrome.storage.local.set({ zohoPdfTemplateIds: all });
  } catch { /* non-fatal */ }
}

// 2026-07-09 (content_script_unreachable): Chrome never injects manifest
// content_scripts into tabs that were already open when the extension was
// loaded/reloaded/updated — those tabs keep an ORPHANED script whose runtime
// port is dead, and Memory-Saver-discarded tabs answer nothing at all. That's
// why the direct PDF path "worked once" (fresh tab) "then broke" (extension
// reload orphaned the script). On an unreachable tab, inject the bundle on
// demand (scripting permission + existing crm.zoho.com host permission) and
// retry. The zoho-content DOM work is dataset-guarded, so re-injection into a
// tab with a live script is harmless (first sendResponse wins).
async function sendToZohoTabWithInjection(tabId, type, payload) {
  let resp = await sendToTab(tabId, type, payload);
  if (resp) return resp;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['zoho-content.bundle.js'] });
  } catch (e) {
    console.warn('[Stratus AI] on-demand zoho-content injection failed for tab', tabId, e?.message || e);
    return null;
  }
  await sleep(250);
  resp = await sendToTab(tabId, type, payload);
  return resp;
}

async function exportZohoQuotePdf({ recordId, templateName, org }) {
  if (!recordId) return { success: false, error: 'missing_recordId' };
  const orgId = org || 'org647122552';

  // ── Fast path (2026-07-08): export from an ALREADY-OPEN Zoho tab. The
  // ExportPDF.do POST needs only the CSRF cookie + record id + numeric
  // template id (verified live against a real quote), so any crm.zoho.com
  // tab can run it same-origin — no hidden preview tab, whose in-field
  // flakiness (preview tab dying before its content script answered →
  // generic "Export failed") motivated this. Falls back to the preview flow
  // when no matching Zoho tab is open, the template id is unknown, or the
  // direct POST fails for any reason.
  // 2026-07-09: try EVERY matching Zoho tab (active first) with on-demand
  // injection — previously only candidates[0] got one un-retried shot.
  try {
    const directTemplateId = await resolvePdfTemplateId(orgId, templateName || 'Hardware Quote');
    if (directTemplateId) {
      const zohoTabs = await chrome.tabs.query({ url: 'https://crm.zoho.com/*' });
      const candidates = zohoTabs
        .filter((t) => (t.url || '').includes(`/crm/${orgId}/`))
        .sort((a, b) => (b.active ? 1 : 0) - (a.active ? 1 : 0));
      for (const target of candidates) {
        const direct = await sendToZohoTabWithInjection(target.id, MSG.EXPORT_ZOHO_PDF_DIRECT, {
          recordId, org: orgId, templateId: directTemplateId, templateName,
        });
        if (direct && direct.success) return direct;
        console.warn('[Stratus AI] Direct PDF export unavailable on tab ' + target.id + ' (' +
          ((direct && direct.error) || 'no_response') + ')' +
          (target === candidates[candidates.length - 1] ? ' — falling back to preview-tab flow.' : ' — trying next Zoho tab.'));
      }
    }
  } catch (e) {
    console.warn('[Stratus AI] Direct PDF export threw — falling back.', e);
  }

  const previewUrl =
    `https://crm.zoho.com/crm/${orgId}/tab/Quotes/${recordId}/export-pdf?flag=false&module=Quotes`;

  let tab;
  try {
    tab = await chrome.tabs.create({ url: previewUrl, active: false });
  } catch (e) {
    return { success: false, error: 'tab_create_failed: ' + (e.message || e) };
  }

  try {
    const loaded = await waitForTabComplete(tab.id, 20000);
    if (!loaded) console.warn('[Stratus AI] PDF preview tab did not reach complete in 20s — pinging anyway.');

    // If Zoho bounced to the sign-in page, the content script never loaded.
    try {
      const t = await chrome.tabs.get(tab.id);
      if (/accounts\.zoho\.com/i.test(t.url || '')) return { success: false, error: 'not_logged_in' };
    } catch { /* tab may already be gone */ }

    // The content script may not be injected/ready immediately, and it polls
    // internally for Zoho's JS to populate the template <select>. Retry until
    // it answers (non-null) or we give up. 2026-07-09: check the tab is still
    // ALIVE each round (preview tabs have died mid-session in the field — a
    // vanished tab used to silently burn all 14 retries), and half-way through
    // inject the content script on demand in case document_idle never fired.
    let result = null;
    let tabGone = false;
    for (let i = 0; i < 14; i++) {
      try {
        await chrome.tabs.get(tab.id);
      } catch {
        tabGone = true;
        break;
      }
      if (i === 6) {
        // Time-boxed: executeScript on a hung page load can stall indefinitely,
        // which would freeze the whole retry loop.
        result = await Promise.race([
          sendToZohoTabWithInjection(tab.id, MSG.EXPORT_ZOHO_PDF, { recordId, templateName }),
          sleep(4000).then(() => null),
        ]);
      } else {
        result = await sendToTab(tab.id, MSG.EXPORT_ZOHO_PDF, { recordId, templateName });
      }
      if (result) break;
      await sleep(600);
    }
    // Harvest name→id template map for the direct-export fast path.
    if (result && result.templateIds) await cachePdfTemplateIds(orgId, result.templateIds);
    return result || { success: false, error: tabGone ? 'preview_tab_closed_midway' : 'content_script_unreachable' };
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch { /* non-fatal */ }
  }
}

// ─────────────────────────────────────────────
// Extension Lifecycle
// ─────────────────────────────────────────────

self.addEventListener('error', (event) => {
  console.error('[Stratus AI] Background service worker error:', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack,
  });
});

self.addEventListener('unhandledrejection', (event) => {
  console.error(
    '[Stratus AI] Background service worker promise rejection:',
    event.reason?.stack || event.reason?.message || event.reason
  );
});

// DEV-build toolbar marker: an orange "DEV" badge so the unpacked test build's icon is
// visually distinct from the Web Store build even with the side panel closed. No-op in
// production — IS_DEV_BUILD is false unless the bundle was built with STRATUS_ENV=dev.
function applyDevBadge() {
  if (!IS_DEV_BUILD) return;
  try {
    chrome.action.setBadgeText({ text: 'DEV' });
    chrome.action.setBadgeBackgroundColor({ color: '#c2410c' });
    if (chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ color: '#ffffff' });
    chrome.action.setTitle({ title: 'Stratus AI (DEV) -> ' + API_BASE });
  } catch (e) { /* action API not ready yet */ }
}
applyDevBadge();

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[Stratus AI] Extension installed/updated:', details.reason);

  applyDevBadge();

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
  applyDevBadge();
  setupCacheAlarms();
});

// ─────────────────────────────────────────────
// Message Handlers (content ↔ background ↔ sidebar)
// ─────────────────────────────────────────────

// In-memory caches. Note: page contexts are now keyed PER TAB to prevent
// cross-tab bleed. The legacy `currentZohoPageContext` / `currentEmailContext`
// globals were a primary cause of the context-bleed bug (Wave B, 2026-06-03):
// a Gmail tab's email context would ride into a request issued while the
// active tab was a Zoho record, and vice versa. We still keep the in-memory
// maps because chrome.storage.session reads are async and the message
// handlers want a sync answer where possible.
let currentCrmContext = null;
let currentTaskRescheduleContext = null;
let currentPageType = 'other';     // 'gmail' | 'zoho' | 'other'

// tabId → email context (Gmail) / Zoho page context, mirrored to
// chrome.storage.session under the keys emailCtx_<tabId> / zohoCtx_<tabId>.
const tabEmailContexts = new Map();
const tabZohoContexts = new Map();

// Storage key prefixes — per-tab keying eliminates cross-tab bleed without
// requiring a global "active tab" lock everywhere readers run.
const EMAIL_CTX_KEY_PREFIX = 'emailCtx_';
const ZOHO_CTX_KEY_PREFIX = 'zohoCtx_';
const emailCtxKey = (tabId) => `${EMAIL_CTX_KEY_PREFIX}${tabId}`;
const zohoCtxKey = (tabId) => `${ZOHO_CTX_KEY_PREFIX}${tabId}`;

/**
 * Resolve the currently active tab. Returns null on failure so callers can
 * fall back gracefully.
 */
async function getActiveTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab || null;
  } catch {
    return null;
  }
}

/**
 * Read the Zoho page context for a given tab. Prefers the in-memory cache
 * but falls back to chrome.storage.session (which survives a slightly longer
 * window than the worker's memory does in MV3).
 */
async function getZohoContextForTab(tabId) {
  if (tabId == null) return null;
  if (tabZohoContexts.has(tabId)) return tabZohoContexts.get(tabId);
  try {
    const key = zohoCtxKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const ctx = stored && stored[key] ? stored[key] : null;
    if (ctx) tabZohoContexts.set(tabId, ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Read the Gmail email context for a given tab. Same pattern as
 * getZohoContextForTab.
 */
async function getEmailContextForTab(tabId) {
  if (tabId == null) return null;
  if (tabEmailContexts.has(tabId)) return tabEmailContexts.get(tabId);
  try {
    const key = emailCtxKey(tabId);
    const stored = await chrome.storage.session.get(key);
    const ctx = stored && stored[key] ? stored[key] : null;
    if (ctx) tabEmailContexts.set(tabId, ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Write the Zoho page context for a given tab.
 */
async function setZohoContextForTab(tabId, ctx) {
  if (tabId == null) return;
  if (ctx) {
    tabZohoContexts.set(tabId, ctx);
    try { await chrome.storage.session.set({ [zohoCtxKey(tabId)]: ctx }); } catch {}
  } else {
    tabZohoContexts.delete(tabId);
    try { await chrome.storage.session.remove(zohoCtxKey(tabId)); } catch {}
  }
}

/**
 * Write the Gmail email context for a given tab.
 */
async function setEmailContextForTab(tabId, ctx) {
  if (tabId == null) return;
  if (ctx) {
    tabEmailContexts.set(tabId, ctx);
    try { await chrome.storage.session.set({ [emailCtxKey(tabId)]: ctx }); } catch {}
  } else {
    tabEmailContexts.delete(tabId);
    try { await chrome.storage.session.remove(emailCtxKey(tabId)); } catch {}
  }
}

registerMessageHandlers({
  // ── Email Context ──
  //
  // Per-tab keying: EMAIL_CHANGED comes from the Gmail content script, so
  // `sender.tab.id` identifies which tab the user opened the email in.
  // Storing under emailCtx_<tabId> means a Zoho tab's read path will never
  // see a Gmail tab's email context (the cross-tab bleed bug).
  [MSG.EMAIL_CHANGED]: async (payload, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId == null) {
      // No tab id — message likely came from sidebar/popup, drop. Email
      // context is only ever written by Gmail content scripts.
      return { success: false, error: 'EMAIL_CHANGED requires a tab id (only Gmail content scripts may set it)' };
    }
    // Participant-growth re-sends for the SAME thread (progressive Gmail
    // hydration, print-view enrichment) must not wipe the CRM context — the
    // content script dedupes its CRM lookup per thread, so a wipe here would
    // never be repopulated and the sidebar's warm-context read would go empty.
    const prev = await getEmailContextForTab(tabId);
    const sameThread = !!prev
      && prev.subject === payload?.subject
      && prev.senderEmail === payload?.senderEmail;
    await setEmailContextForTab(tabId, payload);
    if (!sameThread) currentCrmContext = null; // Reset CRM context on new email
    return { success: true };
  },

  [MSG.GET_EMAIL_CONTEXT]: async () => {
    // The sidebar wants the email context for the user's currently active
    // tab. Resolve that tab, then look up its per-tab email context.
    const tab = await getActiveTab();
    if (!tab) return { empty: true };
    // Email context only makes sense on Gmail tabs — explicitly ignore
    // anything stored for a non-Gmail tab as a belt-and-suspenders check
    // against any future regression.
    if (!tab.url || !tab.url.startsWith('https://mail.google.com/')) {
      return { empty: true };
    }
    // Prefer a live extraction: the cached snapshot may predate Gmail's
    // progressive thread hydration and be missing late-rendered participants
    // (the "sidebar only shows the Cisco rep" bug). Fall back to the cache
    // when the content script is unreachable (e.g. pre-reload tab).
    try {
      const live = await chrome.tabs.sendMessage(tab.id, { type: MSG.GET_EMAIL_CONTEXT });
      if (live && !live.empty) {
        await setEmailContextForTab(tab.id, live);
        return live;
      }
    } catch (err) {
      console.warn('[Stratus] Live email context extraction failed:', err?.message);
    }
    const ctx = await getEmailContextForTab(tab.id);
    return ctx || { empty: true };
  },

  [MSG.GET_FULL_EMAIL_CONTEXT]: async () => {
    const activeTab = await getActiveTab();

    if (activeTab?.id && activeTab.url?.startsWith('https://mail.google.com/')) {
      try {
        const liveContext = await chrome.tabs.sendMessage(activeTab.id, { type: MSG.GET_FULL_EMAIL_CONTEXT });
        if (liveContext && !liveContext.empty) {
          await setEmailContextForTab(activeTab.id, liveContext);
          return liveContext;
        }
      } catch (err) {
        console.warn('[Stratus] Live full-thread email extraction failed:', err?.message);
      }
    }

    if (activeTab?.id != null && activeTab.url?.startsWith('https://mail.google.com/')) {
      const ctx = await getEmailContextForTab(activeTab.id);
      if (ctx) return ctx;
    }
    return { empty: true };
  },

  [MSG.GET_CRM_CONTEXT]: async () => {
    return currentCrmContext || { empty: true };
  },

  // ── CRM Operations ──
  [MSG.CRM_LOOKUP]: async ({ email, domain, verifyOnly }) => {
    const result = await api.crmContactLookup(email, domain);
    // verifyOnly lookups (e.g. resolving a task's Who_Id for an off-thread
    // participant) must not repoint the warm, thread-scoped CRM context.
    if (result && result.found && !verifyOnly) {
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

  // ── Report Issue ── forwards the sidebar's snapshot to /api/report-issue.
  [MSG.REPORT_ISSUE]: async (report) => {
    return api.reportIssue(report);
  },

  // ── SKU Detection ──
  [MSG.DETECT_SKUS]: async ({ text }) => {
    return api.detectSkus(text);
  },

  // ── Tasks ──
  [MSG.FETCH_TASKS]: async ({ domains, emails, accountId, contactId }) => {
    return api.fetchTasks(domains, emails, accountId, contactId);
  },

  // `...options` is forwarded verbatim (newDueDate, newSubject, dealId, contactId,
  // gmailThreadUrl for the complete_and_followup successor) — do not narrow it to a
  // fixed field list or new optional fields get silently dropped here.
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
  [MSG.CRM_ADD_CONTACT]: async ({ firstName, lastName, email, phone, title, accountId, mobile, nameHint }) => {
    return api.crmAddContact(firstName, lastName, email, phone, title, accountId, mobile, nameHint);
  },

  // ── Image Analysis (screenshot/dashboard parsing) ──
  [MSG.ANALYZE_IMAGE]: async ({ imageUrl, imageBase64 }) => {
    return api.analyzeImageForSkus(imageUrl, imageBase64);
  },

  // ── Chat Handoff (CRM-aware) ──
  [MSG.CHAT_HANDOFF]: async ({ text, emailContext, history, systemContext, progressId }) => {
    return api.chatWithCrm(text, emailContext, history, systemContext, progressId);
  },

  // ── Chat Progress polling ──
  [MSG.CHAT_PROGRESS]: async ({ progressId }) => {
    return api.getChatProgress(progressId);
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

  // ── License-key recovery (read-only; deal-preview "Find License Key" button) ──
  [MSG.FIND_LICENSE_KEY]: async ({ dealId }) => {
    return api.findLicenseKey(dealId);
  },

  // ── Deal Close Lost (confirm-gated in sidebar; worker verifies via read-back) ──
  [MSG.DEAL_CLOSE_LOST]: async ({ dealId, expectedDealName }) => {
    return api.dealCloseLost(dealId, expectedDealName);
  },

  // ── Download Zoho's native templated Quote PDF (web-UI "Export to PDF") ──
  [MSG.EXPORT_ZOHO_PDF]: async ({ recordId, templateName, org }) => {
    return exportZohoQuotePdf({ recordId, templateName, org });
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
  // Narrowed to the deployed worker's 3-tier contract ({cache_bust, start_tier:
  // zia|haiku|sonnet}). The richer fields his enrich-v5 worker consumed are dropped
  // here to match the CrmPanel downgrade — forwarding them was dead plumbing against
  // main's /api/enrich-company and risked polluting the enrich KV cache.
  [MSG.ENRICH_COMPANY]: async ({ domain, cache_bust, start_tier }) => {
    return api.enrichCompany(domain, { cache_bust, start_tier });
  },

  // ── CRM Create Task ──
  [MSG.CRM_CREATE_TASK]: async ({ subject, dueDate, dealId, contactId, priority, description, gmailThreadUrl }) => {
    return api.crmCreateTask(subject, dueDate, dealId, contactId, priority, description, gmailThreadUrl);
  },

  // ── Zoho Page Context ──
  //
  // Per-tab keyed: ZOHO_CONTEXT_CHANGED arrives from the Zoho content script,
  // so `sender.tab.id` identifies the tab whose record changed. We store
  // under zohoCtx_<tabId> so other tabs' records cannot show up in the
  // active-tab read path.
  //
  // The content script is the ONLY source for this message; it cannot know
  // its own tab id, which is why the background is the single writer.
  [MSG.ZOHO_CONTEXT_CHANGED]: async (payload, sender) => {
    const tabId = sender?.tab?.id;
    if (tabId == null) {
      return { success: false, error: 'ZOHO_CONTEXT_CHANGED requires a tab id (only Zoho content scripts may set it)' };
    }
    // Strip the inbound dispatch fields that registerMessageHandlers already
    // peeled off (`type`), and stamp url/detectedAt if the sender omitted
    // them so downstream readers can make staleness decisions.
    const stamped = {
      ...payload,
      url: payload?.url || sender?.tab?.url || null,
      detectedAt: payload?.detectedAt || Date.now(),
    };
    await setZohoContextForTab(tabId, stamped);
    return { success: true };
  },

  [MSG.GET_PAGE_CONTEXT]: async () => {
    // Resolve the active tab. Both the page-type decision and the per-tab
    // context lookup key off this single tab id.
    const tab = await getActiveTab();
    const activeUrl = tab?.url || '';
    const activeTabId = tab?.id;

    // Derive page type from the URL we just observed (not from a cached
    // currentPageType that may have drifted since the last onUpdated event).
    if (activeUrl.startsWith('https://mail.google.com/')) {
      currentPageType = 'gmail';
    } else if (activeUrl.startsWith('https://crm.zoho.com/')) {
      currentPageType = 'zoho';
    } else {
      currentPageType = 'other';
    }

    // Active Zoho URL is the authoritative source of truth for which record
    // the user is currently viewing. Cached/stored context is only trusted
    // when it matches that URL. If it doesn't, we fall back to a minimal
    // URL-derived context so the sidebar sees the correct record id even
    // while DOM enrichment is still pending in the content script.
    //
    // This is the central fix for the "stale Quote id sticks around after
    // SPA nav to a new Quote" bug (Codex repro, 2026-04-24).
    const urlInfo = parseZohoRecordUrl(activeUrl);
    let zohoContext = null;

    if (urlInfo && urlInfo.isZoho) {
      const tabZoho = await getZohoContextForTab(activeTabId);

      if (urlInfo.isRecord) {
        if (contextMatchesUrl(tabZoho, urlInfo)) {
          // Cached context is for the record the user is actually viewing —
          // trust it (it may have enriched recordName/email/accountName).
          zohoContext = tabZoho;
        } else {
          // Cached context is either missing or for a DIFFERENT record
          // (previous page in SPA inside this tab). Never leak it. Fall
          // back to a URL-only context so the sidebar at least has the
          // correct record id to target.
          if (tabZoho && !contextMatchesUrl(tabZoho, urlInfo)) {
            // Drop the stale per-tab cache so subsequent calls don't keep
            // resurrecting it.
            await setZohoContextForTab(activeTabId, null);
          }
          zohoContext = minimalContextFromUrl(urlInfo);
        }
      } else {
        // On Zoho but not on a record page (list view / dashboard). Don't
        // serve any cached record as "the current record" — the user isn't
        // viewing one.
        zohoContext = minimalContextFromUrl(urlInfo);
      }
    }

    // Email context: only attach if the active tab is Gmail. This prevents
    // a stale email from riding into a Zoho-tab request (the cross-tab
    // bleed bug Fix A is designed to close).
    let emailContext = null;
    if (currentPageType === 'gmail' && activeTabId != null) {
      emailContext = await getEmailContextForTab(activeTabId);
    }

    return {
      pageType: currentPageType,
      zohoContext,
      activeUrl,
      emailContext,
    };
  },

  // ── WS4: Read line items from the active Zoho Quote/SO/Invoice/PO record ──
  //
  // API-FIRST: fetch the line items authoritatively from the Zoho v8 API in the
  // worker (which holds the Zoho creds), keyed by the recordId parsed from the
  // page URL. This is the robust path — the old DOM scrape couldn't read Zoho's
  // lyte web-component grid (returned 0 items → "Couldn't read any line items").
  //
  // FALLBACK: if the recordId can't be parsed, or the API call throws/returns no
  // items, fall through to the legacy content-script DOM scrape so a worker or
  // network hiccup degrades gracefully instead of breaking the feature.
  //
  // Returns { items, module, recordId, recordName, error?, source? } — the shape
  // QuotePanel expects. items: [] means neither path found line items.
  [MSG.GET_ZOHO_QUOTE_ITEMS]: async () => {
    const tab = await getActiveTab();
    if (!tab || !tab.id) return { items: [], error: 'No active tab.' };
    if (!tab.url || !tab.url.startsWith('https://crm.zoho.com/')) {
      return { items: [], error: 'Active tab is not a Zoho CRM page.' };
    }

    // Modules with a quotable subform — must match the worker's allowed set.
    const ALLOWED_MODULES = ['Quotes', 'Sales_Orders', 'Invoices', 'Purchase_Orders'];

    // ── API-first ──
    const info = parseZohoRecordUrl(tab.url);
    if (info?.recordId && ALLOWED_MODULES.includes(info.module)) {
      try {
        const apiResp = await api.getZohoQuoteItems(info.recordId, info.module);
        if (apiResp?.items?.length) {
          return {
            items: apiResp.items,
            // Pass the worker-built faithful order URL through to QuotePanel
            // (it consolidates duplicate SKUs); without this it always fell back
            // to the client-side builder.
            orderUrl: apiResp.orderUrl || null,
            module: info.module,
            recordId: info.recordId,
            recordName: apiResp.recordName || null,
            source: 'api',
          };
        }
        // API reached but found nothing → fall through to the DOM scrape below.
      } catch (apiErr) {
        // Worker/network error → degrade to the DOM scrape, never break.
        console.warn('[Stratus] zoho-quote-items API failed, falling back to DOM scrape:', apiErr?.message || apiErr);
      }
    }

    // ── Fallback: legacy content-script DOM scrape ──
    const resp = await sendToTab(tab.id, MSG.GET_ZOHO_QUOTE_ITEMS, {});
    // sendToTab resolves null if the content script isn't loaded.
    if (!resp) {
      return { items: [], error: 'Could not reach the Zoho page. Reload the tab and try again.' };
    }
    return resp;
  },

  // ── WS4: Build a URL quote from scraped { sku, qty } line items ──
  // Same /api/quote engine as the bots (see api.buildUrlQuoteFromSkus).
  [MSG.BUILD_URL_QUOTE]: async ({ items, personId }) => {
    return api.buildUrlQuoteFromSkus(items, personId);
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
// Side Panel
// ─────────────────────────────────────────────

// Helpers: clear a single tab's stored context. Context storage is now
// keyed per-tab, so we always know exactly which tab we're clearing rather
// than nuking a shared global key.
function clearZohoContextForTab(tabId) {
  if (tabId == null) return;
  setZohoContextForTab(tabId, null).catch(() => {});
}
function clearEmailContextForTab(tabId) {
  if (tabId == null) return;
  setEmailContextForTab(tabId, null).catch(() => {});
}

// Enable side panel for all tabs (Gmail, Zoho CRM, and everything else for search)
//
// On a load-complete transition we update currentPageType for sync readers
// (it's a coarse global; the per-tab maps are the authoritative source).
// We also SYMMETRICALLY clear the OPPOSITE-type context for THIS tab so a
// single tab navigating between Zoho and Gmail can't accumulate both
// contexts. (Fix A, Wave B 2026-06-03.) Prior behaviour deliberately left
// the email context alive on Zoho transitions; that allowed a stale Gmail
// email to ride into a Zoho-tab request.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.url) {
    chrome.sidePanel.setOptions({
      tabId,
      path: 'sidebar.html',
      enabled: true,
    }).catch(() => {});

    // Track page type transitions and clear stale context for THIS tab.
    if (changeInfo.status === 'complete') {
      if (tab.url.startsWith('https://mail.google.com/')) {
        currentPageType = 'gmail';
        clearZohoContextForTab(tabId);
      } else if (tab.url.startsWith('https://crm.zoho.com/')) {
        currentPageType = 'zoho';
        // Symmetric clear: a tab that just navigated to Zoho must NOT
        // carry an email context. (Fix A.)
        clearEmailContextForTab(tabId);
      } else {
        currentPageType = 'other';
        clearEmailContextForTab(tabId);
        clearZohoContextForTab(tabId);
      }
    }
  }
});

// Tab switch — user flips between already-loaded tabs (no onUpdated fires).
// Update currentPageType so sync readers see the right value. We do NOT
// touch the per-tab stored contexts here (the user may switch back); they
// only get cleared when the tab itself navigates or closes.
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const url = tab?.url || '';
    if (url.startsWith('https://mail.google.com/')) {
      currentPageType = 'gmail';
    } else if (url.startsWith('https://crm.zoho.com/')) {
      currentPageType = 'zoho';
    } else {
      currentPageType = 'other';
    }
  } catch {}
});

// Tab closed — sweep this tab's per-tab context entries so storage doesn't
// grow unbounded over time. Both Zoho and Gmail keys for the closed tab are
// removed; any other open tab retains its own.
chrome.tabs.onRemoved.addListener(async (tabId) => {
  clearZohoContextForTab(tabId);
  clearEmailContextForTab(tabId);
});
