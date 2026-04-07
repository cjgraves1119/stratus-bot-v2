/**
 * Stratus AI Chrome Extension — API Client
 *
 * All HTTP communication with the Cloudflare Worker backend.
 * Replaces Apps Script's UrlFetchApp with native fetch.
 * Includes IndexedDB caching for frequently-used endpoints.
 */

import { API_BASE, CACHE_TTL, MAX_EMAIL_BODY_CHARS } from '../lib/constants.js';
import { getSettings } from '../lib/storage.js';
import { getCached, setCached } from '../lib/storage.js';

// In-flight request deduplication — prevents duplicate API calls for the same data
const _inflightRequests = new Map();

/**
 * Generic API call to the Stratus worker.
 * @param {string} endpoint - Path under /api/
 * @param {Object} payload - JSON body
 * @param {Object} [options] - {timeout, skipCache}
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiCall(endpoint, payload, options = {}) {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error('API key not configured. Open extension settings to set it up.');
  }

  const controller = new AbortController();
  const timeout = options.timeout || 30000;
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': settings.apiKey,
        'X-User-Email': settings.userEmail || '',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (response.status === 401) {
      throw new Error('Invalid API key. Check your settings.');
    }
    if (response.status >= 500) {
      const text = await response.text();
      console.error(`[Stratus API] ${endpoint} returned ${response.status}:`, text.substring(0, 500));
      throw new Error(`Server error (${response.status}). Try again in a moment.`);
    }

    return await response.json();
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeout / 1000}s.`);
    }
    throw err;
  }
}

// ─────────────────────────────────────────────
// Email Analysis
// ─────────────────────────────────────────────

/**
 * Analyze an email: summary, detected SKUs, CRM sender lookup.
 */
export async function analyzeEmail(subject, body, senderEmail, senderName) {
  const cacheKey = `analyze_${hashString(subject + senderEmail)}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const result = await apiCall('/api/analyze-email', {
    subject,
    body: (body || '').substring(0, MAX_EMAIL_BODY_CHARS),
    senderEmail,
    senderName,
  });

  await setCached(cacheKey, result, CACHE_TTL.EMAIL_ANALYSIS);
  return result;
}

// ─────────────────────────────────────────────
// Draft Reply
// ─────────────────────────────────────────────

/**
 * Generate reply drafts for an email.
 */
export async function draftReply(subject, body, senderEmail, senderName, tone, instructions) {
  return apiCall('/api/draft-reply', {
    subject,
    body: (body || '').substring(0, MAX_EMAIL_BODY_CHARS),
    senderEmail,
    senderName,
    tone: tone || 'warm',
    instructions: instructions || '',
  });
}

// ─────────────────────────────────────────────
// Quote Generation
// ─────────────────────────────────────────────

/**
 * Generate a Stratus URL quote from SKU text.
 */
export async function generateQuote(skuText) {
  return apiCall('/api/quote', { text: skuText });
}

// ─────────────────────────────────────────────
// CRM Operations (zero AI cost endpoints)
// ─────────────────────────────────────────────

/**
 * Look up a contact and linked account by email/domain.
 */
export async function crmContactLookup(email, domain) {
  const cacheKey = `crm_contact_${email || domain}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  // Deduplicate in-flight requests for the same lookup
  if (_inflightRequests.has(cacheKey)) {
    return _inflightRequests.get(cacheKey);
  }

  const promise = apiCall('/api/crm-contact', {
    email: email || '',
    domain: domain || '',
  }).then(async (result) => {
    _inflightRequests.delete(cacheKey);
    if (result && result.found) {
      await setCached(cacheKey, result, CACHE_TTL.CRM_CONTACT);
    }
    return result;
  }).catch((err) => {
    _inflightRequests.delete(cacheKey);
    throw err;
  });

  _inflightRequests.set(cacheKey, promise);
  return promise;
}

/**
 * Full CRM context: contact + account + deals + activities + quotes.
 */
export async function crmFull(email, domain) {
  const cacheKey = `crm_full_${email || domain}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const result = await apiCall('/api/crm-full', {
    email: email || '',
    domain: domain || '',
  });

  if (result && result.found) {
    await setCached(cacheKey, result, CACHE_TTL.CRM_CONTACT);
  }
  return result;
}

/**
 * Get deals for an account.
 */
export async function crmDeals(accountId, contactEmail) {
  return apiCall('/api/crm-deals', {
    accountId: accountId || '',
    contactEmail: contactEmail || '',
  });
}

/**
 * Get open tasks/activities for an account or contact.
 */
export async function crmActivities(accountId, contactId) {
  return apiCall('/api/crm-activities', {
    accountId: accountId || '',
    contactId: contactId || '',
  });
}

/**
 * Get quotes for an account or deal.
 */
export async function crmQuotes(accountId, dealId) {
  return apiCall('/api/crm-quotes', {
    accountId: accountId || '',
    dealId: dealId || '',
  });
}

/**
 * Get notes for a contact or account.
 */
export async function crmNotes(contactId, accountId) {
  return apiCall('/api/crm-notes', {
    contactId: contactId || '',
    accountId: accountId || '',
  });
}

/**
 * CRM search across modules.
 */
export async function crmSearch(query, module) {
  return apiCall('/api/crm-search', {
    query,
    module: module || 'Accounts',
  });
}

/**
 * Get deals where a Cisco rep is the Meraki ISR.
 */
export async function crmIsrDeals(repEmail, repName) {
  const cacheKey = `crm_isr_deals_${repEmail || repName}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const result = await apiCall('/api/crm-search', {
    query: repEmail || repName,
    module: 'Deals',
    field: 'Meraki_ISR',
  });

  if (result) {
    await setCached(cacheKey, result, CACHE_TTL.CRM_DEALS);
  }
  return result;
}

/**
 * Add a note to CRM.
 */
export async function crmAddNote(parentModule, parentId, title, content) {
  return apiCall('/api/crm-add-note', {
    parentModule: parentModule || 'Contacts',
    parentId,
    title: title || '',
    content,
  });
}

/**
 * Create a CRM contact.
 */
export async function crmAddContact(firstName, lastName, email, phone, title, accountId, mobile) {
  return apiCall('/api/crm-add-contact', {
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    title: title || '',
    accountId: accountId || '',
    mobile: mobile || '',
  });
}

/**
 * Create a CRM task.
 */
export async function crmCreateTask(subject, dueDate, dealId, contactId, priority, description) {
  return apiCall('/api/crm-create-task', {
    subject,
    dueDate: dueDate || '',
    dealId: dealId || '',
    contactId: contactId || '',
    priority: priority || 'Normal',
    description: description || '',
  });
}

// ─────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────

/**
 * Fetch open tasks for given domains/emails.
 */
export async function fetchTasks(domains, emails) {
  return apiCall('/api/tasks', {
    domains: domains || [],
    emails: emails || [],
  });
}

/**
 * Perform a task action.
 */
export async function taskAction(action, taskId, options) {
  return apiCall('/api/task-action', {
    action,
    taskId,
    ...options,
  });
}

// ─────────────────────────────────────────────
// SKU Detection
// ─────────────────────────────────────────────

/**
 * Detect SKUs in text via API.
 */
export async function detectSkus(text) {
  return apiCall('/api/detect-skus', { text });
}

/**
 * Analyze an image for SKUs via Claude vision.
 */
export async function analyzeImageForSkus(imageUrl) {
  return apiCall('/api/analyze-image', { imageUrl }, { timeout: 45000 });
}

// ─────────────────────────────────────────────
// Handoff to GChat
// ─────────────────────────────────────────────

/**
 * Send a request to the GChat worker for full AI agent processing.
 */
export async function sendHandoff(requestText, emailContext) {
  return apiCall('/api/handoff', {
    text: requestText,
    emailContext,
    userEmail: (await getSettings()).userEmail || 'chrisg@stratusinfosystems.com',
  }, { timeout: 60000 }); // Longer timeout for handoff
}

// ─────────────────────────────────────────────
// Admin
// ─────────────────────────────────────────────

/**
 * Get API usage stats.
 */
export async function getAdminUsage() {
  return apiCall('/api/admin-usage', {});
}

// ─────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────

/**
 * Simple string hash for cache keys.
 */
function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}
