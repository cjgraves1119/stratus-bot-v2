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
import { normalizeProductSearchQuery, sanitizeProductSearchResponse } from '../lib/product-search.mjs';

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
 * Passes a persistent personId for conversation history (pricing follow-ups, revisions, etc.)
 */
export async function generateQuote(skuText, personId, priorQuoteText) {
  return apiCall('/api/quote', {
    text: skuText,
    personId,
    priorQuoteText: priorQuoteText || undefined,
  }, { timeout: 60000 });
}

/**
 * Read-only product autocomplete. The Worker owns the bounded cache/Zoho
 * lookup; this client strips every response before it reaches extension UI.
 */
export async function productSearch(query) {
  const normalized = normalizeProductSearchQuery(query);
  if (!normalized.ok) {
    return { ok: false, query: '', results: [], live: false, error: normalized.error };
  }
  try {
    const response = await apiCall('/api/product-search', { query: normalized.query }, {
      timeout: 8000,
      skipCache: true,
    });
    return sanitizeProductSearchResponse(response, normalized.query);
  } catch (error) {
    return {
      ok: false,
      query: normalized.query,
      results: [],
      live: false,
      error: error?.message || 'Product search was unavailable.',
    };
  }
}

/**
 * WS4 — Build a Stratus URL quote from a structured list of { sku, qty } line
 * items (e.g. scraped from a Zoho Quotes Product_Details grid).
 *
 * Routes through the SAME /api/quote engine as the Webex/GChat bots — it does
 * NOT use the dead local quote-engine.js. We format each item as a
 * "<qty> <sku>" line (the engine's preferred input form) and let the worker
 * handle SKU validation, suffix mapping, EOL replacement, and URL building.
 *
 * @param {Array<{sku: string, qty: number}>} items
 * @param {string} personId
 * @returns {Promise<Object>} Same response shape as generateQuote (quoteUrls,
 *   parsedItems, eolWarnings, suggestions, ...).
 */
export async function buildUrlQuoteFromSkus(items, personId) {
  const lines = (Array.isArray(items) ? items : [])
    .map((i) => {
      const sku = String(i?.sku || i?.baseSku || '').trim();
      if (!sku) return null;
      const qty = Number.isFinite(i?.qty) && i.qty > 0 ? i.qty : 1;
      return `${qty} ${sku}`;
    })
    .filter(Boolean);

  if (!lines.length) {
    return { error: 'No line items to quote.' };
  }

  return apiCall('/api/quote', { text: lines.join('\n'), personId }, { timeout: 60000 });
}

/**
 * Fetch a Zoho record's line items authoritatively via the worker (which holds
 * the Zoho creds), keyed by the recordId the extension already parsed from the
 * page URL. Replaces DOM scraping for the "Build URL quote from this Zoho quote"
 * feature — the Zoho Quotes grid is a lyte web-component the scraper can't read.
 *
 * @param {string} recordId  10–25 digit Zoho record id
 * @param {string} module    one of Quotes | Sales_Orders | Invoices | Purchase_Orders
 * @returns {Promise<{items: Array<{sku: string, qty: number}>, module: string, recordId: string, recordName: string|null, error?: string}>}
 */
export async function getZohoQuoteItems(recordId, module) {
  return apiCall('/api/zoho-quote-items', { recordId, module }, { timeout: 30000 });
}

/**
 * Quote Line Editor read. Unlike getZohoQuoteItems above (sku + qty only, pinned
 * by a no-margin invariant test), this returns LIST PRICE and DISCOUNT so the
 * rep can see and edit what Zoho holds. INTERNAL ONLY: never let this payload
 * reach customer-facing copy.
 *
 * @param {string} recordId 10-25 digit Zoho record id
 * @param {string} [module] Quotes | Sales_Orders | Invoices | Purchase_Orders
 */
export async function getQuoteLines(recordId, module = 'Quotes') {
  return apiCall('/api/quote-lines', { recordId, module }, { timeout: 30000 });
}

/**
 * Quote Line Editor write. ONE atomic Zoho PUT behind this call.
 *
 * 60s because the worker does a fetch, the PUT, and a verification re-fetch.
 * apiCall has no retry and the worker's zohoApiCall has no 429 retry, so a
 * failed write is NEVER retried automatically: the card shows the error and
 * keeps the local edits for a deliberate manual retry.
 *
 * @param {{recordId: string, module?: string, personId?: string,
 *          ops: {setDiscounts: Array<{id: string, pct: number}>, deletes: string[], reorder: string[]},
 *          writeDescriptions?: boolean}} payload
 */
/**
 * Resolve each quote line's live ECOMM (storefront) price, so a hand-priced
 * quote can be brought back into parity with stratusinfosystems.com. Read-only:
 * it returns prices for the diff panel, and the rep still commits through
 * commitQuoteLineOps.
 *
 * 45s because the worker resolves each DISTINCT SKU sequentially against
 * WooProducts and Products rather than fanning out (zohoApiCall has no 429
 * retry), so a wide quote genuinely takes a while.
 */
export async function matchQuoteLinesToEcomm(recordId, module = 'Quotes') {
  return apiCall('/api/quote-line-ecomm', { recordId, module }, { timeout: 45000 });
}

/**
 * Read the quote's distributor cost per line (Zoho's "Costs By Lines", the
 * Vendor_Lines module), so the editor can price each line to a target profit
 * margin exactly the way Zoho's own margin function does.
 *
 * INTERNAL ONLY: this carries distributor cost. Never let it reach
 * customer-facing copy.
 */
export async function getQuoteLineCosts(recordId, module = 'Quotes') {
  return apiCall('/api/quote-line-costs', { recordId, module }, { timeout: 30000 });
}

/**
 * Preview what a term clone would do. Writes NOTHING: it runs the same
 * classification and pricing the clone would, so the card can show which
 * licences move, to which SKUs, at what price, before anything exists in Zoho.
 */
export async function previewQuoteCloneTerms(recordId, terms) {
  return apiCall('/api/quote-clone-terms-preview', { recordId, terms }, { timeout: 45000 });
}

/**
 * Clone the quote onto one or more licence terms. Creates a NEW Zoho quote per
 * term, hardware carried over untouched, licences swapped and priced at ecomm
 * (7YR/10YR take the fixed co-term discount, which has no ecomm equivalent).
 *
 * 90s: each term is a clone plus a re-read plus an atomic PUT plus a
 * verification re-fetch, run sequentially. No retry anywhere on this path.
 */
export async function cloneQuoteTerms(payload) {
  return apiCall('/api/quote-clone-terms', payload, { timeout: 90000 });
}

export async function commitQuoteLineOps(payload) {
  return apiCall('/api/quote-line-ops', payload, { timeout: 60000 });
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
 * Uses dedicated /api/crm-isr-deals endpoint which searches by rep ID.
 */
export async function crmIsrDeals(repEmail, repName) {
  const cacheKey = `crm_isr_deals_${repEmail || repName}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;

  const result = await apiCall('/api/crm-isr-deals', {
    repEmail: repEmail || '',
    repName: repName || '',
  });

  if (result && result.deals) {
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
export async function crmAddContact(firstName, lastName, email, phone, title, accountId, mobile, nameHint) {
  return apiCall('/api/crm-add-contact', {
    firstName: firstName || '',
    lastName: lastName || '',
    email: email || '',
    phone: phone || '',
    title: title || '',
    accountId: accountId || '',
    mobile: mobile || '',
    nameHint: nameHint || '',
  });
}

/**
 * Create a CRM task.
 */
export async function crmCreateTask(subject, dueDate, dealId, contactId, priority, description, gmailThreadUrl) {
  return apiCall('/api/crm-create-task', {
    subject,
    dueDate: dueDate || '',
    dealId: dealId || '',
    contactId: contactId || '',
    priority: priority || 'Normal',
    description: description || '',
    gmailThreadUrl: gmailThreadUrl || '',
  });
}

/**
 * Search for CRM accounts by name (for Add Contact form).
 * Pass `domain` to trigger domain-based criteria matching (Website field + name base word).
 */
export async function crmAccountSearch(query, domain) {
  return apiCall('/api/crm-search', {
    query: query || '',
    domain: domain || '',
    module: 'Accounts',
  });
}

/**
 * Enrich company info from domain (Claude-powered lookup).
 */
export async function enrichCompany(domain, opts = {}) {
  // opts: { cache_bust?: boolean, start_tier?: 'zia'|'haiku'|'sonnet' }
  // 75s timeout: the zia→haiku→sonnet enrichment waterfall can exceed the 30s default.
  return apiCall('/api/enrich-company', { domain: domain || '', ...opts }, { timeout: 75000, skipCache: true });
}

/**
 * Create a new CRM account.
 */
export async function crmCreateAccount(name, street, city, state, zip, website) {
  return apiCall('/api/crm-create-account', {
    name: name || '',
    street: street || '',
    city: city || '',
    state: state || '',
    zip: zip || '',
    website: website || '',
  });
}

// ─────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────

/**
 * Fetch open tasks for given domains/emails, or directly by accountId/contactId.
 * When accountId/contactId are provided, domain resolution is bypassed for reliability.
 */
export async function fetchTasks(domains, emails, accountId, contactId) {
  return apiCall('/api/tasks', {
    domains: domains || [],
    emails: emails || [],
    accountId: accountId || '',
    contactId: contactId || '',
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
 * Uses the /api/parse-dashboard endpoint which handles both imageUrl and imageBase64.
 *
 * NO `instructions` override: the worker now owns the dashboard vision prompt
 * (getDashboardVisionPrompt — the SM-aware gold-standard prompt that includes
 * Systems Manager → SM-ENT and the colored-marker continuation rules). Sending a
 * prompt from here would override the backend's and silently drop Systems Manager.
 * The worker returns a fully-rendered renewal quote (analysis + quoteUrls) plus a
 * structured `parsedItems` array — the panel consumes parsedItems directly.
 */
export async function analyzeImageForSkus(imageUrl, imageBase64) {
  return apiCall('/api/parse-dashboard', {
    imageUrl: imageUrl || undefined,
    imageBase64: imageBase64 || undefined,
  }, { timeout: 60000 });
}

// ─────────────────────────────────────────────
// Chat with CRM Agent
// ─────────────────────────────────────────────

/**
 * Send a message to the CRM-aware Claude agent.
 * Routes through the same askClaude() tool-use loop as the GChat bot,
 * giving the extension chat full Zoho CRM capabilities.
 */
export async function chatWithCrm(requestText, emailContext, history, systemContext, progressId) {
  return apiCall('/api/chat', {
    text: requestText,
    emailContext,
    history: history || [],
    systemContext: systemContext || '',
    progressId: progressId || undefined,
  }, { timeout: 130000 }); // 2+ minute timeout for CRM tool-use loops
}

/**
 * Poll the chat progress endpoint. Returns { steps: [{ts, message}], status }.
 */
export async function getChatProgress(progressId) {
  if (!progressId) return { steps: [], status: 'unknown' };
  return apiCall('/api/chat-progress', { progressId }, { timeout: 5000 });
}

/**
 * Legacy handoff to GChat (sends results to Google Chat space).
 */
export async function sendHandoff(requestText, emailContext, history) {
  return apiCall('/api/handoff', {
    text: requestText,
    emailContext,
    history: history || [],
  }, { timeout: 60000 });
}

/**
 * Recover a customer's Cisco license claim key for a deal (read-only).
 * Resolves the deal's Sales Order, finds the Cisco/TD SYNNEX license-delivery
 * email, and returns { success, claimKey, ... } or { error, message }.
 * No Zoho writes.
 */
export async function findLicenseKey(dealId) {
  return apiCall('/api/find-license-key', { deal_id: dealId }, { timeout: 30000 });
}

// ─────────────────────────────────────────────
// CCW / Velocity Hub
// ─────────────────────────────────────────────

/**
 * Look up a Zoho Quote by CCW Deal Number, with Deal Name fallback.
 */
export async function ccwLookup(ccwDealNumber, dealName) {
  if (!ccwDealNumber && !dealName) return { found: false };
  const cacheKey = `ccw_${ccwDealNumber || ''}_${(dealName || '').substring(0, 30)}`;
  const cached = await getCached(cacheKey);
  if (cached) return cached;
  const result = await apiCall('/api/ccw-lookup', {
    ccwDealNumber: ccwDealNumber || '',
    dealName: dealName || '',
  });
  if (result && result.found) await setCached(cacheKey, result, CACHE_TTL.CRM_CONTACT);
  return result;
}

/**
 * Submit a deal approval to Velocity Hub.
 */
export async function velocityHubSubmit(dealId, country) {
  return apiCall('/api/velocity-hub', {
    deal_id: dealId,
    country: country || 'United States',
  }, { timeout: 30000 });
}

/**
 * Mark a Deal Closed (Lost) — confirm-gated in the UI, deterministic on the worker.
 * The worker fetches the deal first (existence + exact-name guard), refuses
 * Closed (Won) deals, writes Stage: 'Closed (Lost)', then reads the record back
 * and only reports success when the VERIFIED stage is Closed (Lost).
 * Only call this after the user explicitly confirmed the named deal.
 */
export async function dealCloseLost(dealId, expectedDealName) {
  return apiCall('/api/deal-close-lost', {
    dealId,
    expectedDealName: expectedDealName || '',
  }, { timeout: 30000 });
}

/**
 * One-shot customer-to-quote. PLAN is strictly read-only resolution (account,
 * contact from the FULL participant list, open deals, ISR, pricing, date) with
 * blockers[] for anything ambiguous; EXECUTE takes only fully-explicit reviewed
 * decisions and drives the deterministic compound create — no agent loop.
 */
export async function oneshotPlan(payload) {
  return apiCall('/api/oneshot-plan', payload || {}, { timeout: 45000 });
}

export async function oneshotExecute(payload) {
  return apiCall('/api/oneshot-execute', payload || {}, { timeout: 90000 });
}

/**
 * One-shot email intake: literal SKUs parse deterministically (no LLM);
 * otherwise ONE constrained fact extraction resolved against the worker's
 * local catalog matrix. Read-only — never writes CRM. Flag- and
 * allowlist-gated server-side.
 */
export async function oneshotIntake(payload) {
  return apiCall('/api/oneshot-intake', payload || {}, { timeout: 30000 });
}

/**
 * Scripted CRM delete. Works anywhere a record_id or quote_number is already
 * known, so nothing waits on the chat agent to rediscover the record. The
 * server delegates to the same delete tool the agent uses, so every guard and
 * the pre-delete snapshot still apply, and it returns an undo_token.
 */
export async function crmDelete({ moduleName, recordId, quoteNumber, confirm }) {
  return apiCall('/api/crm-delete', {
    module_name: moduleName,
    ...(recordId ? { record_id: String(recordId) } : {}),
    ...(quoteNumber ? { quote_number: String(quoteNumber) } : {}),
    confirm: confirm === true,
  }, { timeout: 45000 });
}

/** Reverse a scripted delete (or any mutation) from its undo token. */
export async function crmUndo(undoToken) {
  return apiCall('/api/crm-undo', { undo_token: String(undoToken || '') }, { timeout: 45000 });
}

/**
 * Assign a Cisco rep to a Deal's Meraki_ISR field.
 */
export async function assignCiscoRep(dealId, repEmail, repName) {
  return apiCall('/api/assign-rep', {
    dealId,
    repEmail: repEmail || '',
    repName: repName || '',
  });
}

// ─────────────────────────────────────────────
// Suggest Task (two-step: preview then confirm)
// ─────────────────────────────────────────────

/**
 * Preview a follow-up task (account/contact resolution before creating).
 */
export async function suggestTaskPreview(senderEmail, senderName, subject, accountId, threadDomains) {
  // Backend expects camelCase field names
  return apiCall('/api/suggest-task-preview', {
    senderEmail: senderEmail || '',
    senderName: senderName || '',
    subject: subject || '',
    hasAccount: accountId ? true : false,
    accountId: accountId || '',
    threadDomains: Array.isArray(threadDomains) ? threadDomains : [],
  });
}

/**
 * Confirm and create the suggested follow-up task.
 * `params` is forwarded verbatim, which includes the optional `gmailThreadUrl`
 * the panel sends — do not narrow this to a fixed field list.
 */
export async function suggestTask(params) {
  return apiCall('/api/suggest-task', params);
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

/**
 * Report an issue/glitch with a snapshot of extension state.
 * @param {Object} report - { note, version, url, context, lastChat, recentErrors, userAgent }
 * @returns {Promise<{ok:boolean, id:number}>}
 */
export async function reportIssue(report) {
  return apiCall('/api/report-issue', report, { timeout: 15000 });
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
