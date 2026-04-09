/**
 * Stratus AI Gmail Add-on â API Client
 *
 * All HTTP communication with the Cloudflare Worker backend.
 */

/**
 * Generic API call to the Stratus worker.
 * @param {string} endpoint  Path under /api/
 * @param {Object} payload   JSON body
 * @param {number} [timeoutMs=55000]  Fetch timeout
 * @returns {Object} Parsed JSON response
 */
function apiCall_(endpoint, payload, timeoutMs) {
  var url = CONFIG.API_BASE + endpoint;
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-Key': getApiKey_(),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(url, options);
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code === 401) {
    throw new Error('Invalid API key. Check STRATUS_API_KEY in Script Properties.');
  }
  if (code >= 500) {
    console.error('API ' + endpoint + ' returned ' + code + ': ' + text.substring(0, 500));
    throw new Error('Server error (' + code + '). Try again in a moment.');
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error('API ' + endpoint + ' non-JSON response: ' + text.substring(0, 500));
    throw new Error('Unexpected response from API.');
  }
}

/**
 * Analyze an email: summary, detected SKUs, CRM sender lookup.
 */
function analyzeEmail_(subject, body, senderEmail, senderName) {
  var cacheKey = 'analyze_' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, subject + senderEmail
  ).map(function(b) { return (b & 0xff).toString(16).padStart(2, '0'); }).join('');

  var cached = getCached_(cacheKey);
  if (cached) return cached;

  var result = apiCall_('/api/analyze-email', {
    subject: subject,
    body: (body || '').substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderEmail: senderEmail,
    senderName: senderName,
  });

  setCached_(cacheKey, result, CONFIG.CACHE_TTL_SECONDS);
  return result;
}

/**
 * Generate reply drafts for the current email.
 */
function draftReply_(subject, body, senderEmail, senderName, tone, instructions) {
  return apiCall_('/api/draft-reply', {
    subject: subject,
    body: (body || '').substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderEmail: senderEmail,
    senderName: senderName,
    tone: tone || 'warm',
    instructions: instructions || '',
  });
}

/**
 * Generate a Stratus URL quote from SKU text.
 */
function generateQuote_(skuText) {
  return apiCall_('/api/quote', {
    text: skuText,
  });
}

/**
 * Search Zoho CRM.
 */
function crmSearch_(query, module) {
  return apiCall_('/api/crm-search', {
    query: query,
    module: module || 'Accounts',
  });
}

/**
 * Detect SKUs in arbitrary text.
 */
function detectSkus_(text) {
  return apiCall_('/api/detect-skus', {
    text: text,
  });
}

/**
 * Fetch open tasks for accounts matching the given domains/emails.
 */
function fetchTasks_(domains, emails) {
  return apiCall_('/api/tasks', {
    domains: domains || [],
    emails: emails || [],
  });
}

/**
 * Perform a task action: complete_and_followup, reschedule, or edit.
 */
function taskAction_(action, taskId, options) {
  var payload = {
    action: action,
    taskId: taskId,
  };
  if (options) {
    if (options.newSubject) payload.newSubject = options.newSubject;
    if (options.newDueDate) payload.newDueDate = options.newDueDate;
    if (options.dealId) payload.dealId = options.dealId;
    if (options.contactId) payload.contactId = options.contactId;
  }
  return apiCall_('/api/task-action', payload);
}

/**
 * Send a free-form request from the Gmail sidebar to the GChat worker,
 * which processes it and delivers a response as a Google Chat DM.
 */
function sendHandoffRequest_(requestText, emailContext) {
  var payload = {
    text: requestText,
    emailContext: emailContext,
    userEmail: 'chrisg@stratusinfosystems.com',
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': getApiKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
    // 25s deadline: Gmail add-on actions have a 30s hard limit from Google.
    // Our Cloudflare worker processes CRM work for 4-5 min but CONTINUES
    // running after the HTTP connection drops (CF docs confirm this behavior).
    // So a timeout here means "still processing" — not an error.
    deadline: 25,
  };
  try {
    var response = UrlFetchApp.fetch(CONFIG.HANDOFF_ENDPOINT, options);
    var code = response.getResponseCode();
    var text = response.getContentText();
    if (code === 401) throw new Error('Invalid API key.');
    if (code >= 500) throw new Error('Server error (' + code + ').');
    return JSON.parse(text);
  } catch (e) {
    // Check if this is a timeout (deadline exceeded). The Cloudflare worker
    // continues processing after disconnect — treat timeout as pending success.
    var msg = e.message || '';
    var isTimeout = msg.indexOf('Timed out') !== -1
      || msg.indexOf('timed out') !== -1
      || msg.indexOf('timeout') !== -1
      || msg.indexOf('deadline') !== -1
      || msg.indexOf('SocketTimeoutException') !== -1;
    if (isTimeout) {
      console.log('[HANDOFF] Request timed out — worker continues in background.');
      return { success: true, pending: true };
    }
    console.error('[HANDOFF] sendHandoffRequest_ error: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ─────────────────────────────────────────────
// DIRECT CRM SIDEBAR ENDPOINTS (zero AI cost)
// ─────────────────────────────────────────────

/**
 * Look up a contact and linked account by email/domain.
 */
function crmContactLookup_(email, domain) {
  var cacheKey = 'crm_contact_' + (email || domain);
  var cached = getCached_(cacheKey);
  if (cached) return cached;

  var result = apiCall_('/api/crm-contact', {
    email: email || '',
    domain: domain || '',
  });

  if (result && result.found) {
    setCached_(cacheKey, result, CONFIG.CACHE_TTL_SECONDS);
  }
  return result;
}

/**
 * Get deals for an account.
 */
function crmDeals_(accountId, contactEmail) {
  return apiCall_('/api/crm-deals', {
    accountId: accountId || '',
    contactEmail: contactEmail || '',
  });
}

/**
 * Get open tasks (activities) for an account or contact.
 */
function crmActivities_(accountId, contactId) {
  return apiCall_('/api/crm-activities', {
    accountId: accountId || '',
    contactId: contactId || '',
  });
}

/**
 * Get quotes for an account or specific deal.
 */
function crmQuotes_(accountId, dealId) {
  return apiCall_('/api/crm-quotes', {
    accountId: accountId || '',
    dealId: dealId || '',
  });
}

/**
 * Get recent notes for a contact or account.
 */
function crmNotes_(contactId, accountId) {
  return apiCall_('/api/crm-notes', {
    contactId: contactId || '',
    accountId: accountId || '',
  });
}

/**
 * Add a note to a contact or account.
 */
function crmAddNote_(parentModule, parentId, title, content) {
  return apiCall_('/api/crm-add-note', {
    parentModule: parentModule || 'Contacts',
    parentId: parentId,
    title: title || '',
    content: content,
  });
}

/**
 * Create a new CRM task.
 */
function crmCreateTask_(subject, dueDate, dealId, contactId, priority, description) {
  return apiCall_('/api/crm-create-task', {
    subject: subject,
    dueDate: dueDate || '',
    dealId: dealId || '',
    contactId: contactId || '',
    priority: priority || 'Normal',
    description: description || '',
  });
}

/**
 * Detect account info from email signature + domain web lookup.
 */
function detectAccount_(emailBody, senderDomain, senderEmail, senderName) {
  return apiCall_('/api/detect-account', {
    emailBody: (emailBody || '').substring(0, CONFIG.MAX_EMAIL_BODY_CHARS),
    senderDomain: senderDomain || '',
    senderEmail: senderEmail || '',
    senderName: senderName || '',
  });
}

/**
 * Create a new CRM account.
 */
function crmCreateAccount_(name, street, city, state, zip, website) {
  return apiCall_('/api/crm-create-account', {
    name: name || '',
    street: street || '',
    city: city || '',
    state: state || '',
    zip: zip || '',
    website: website || '',
  });
}

/**
 * Create a new CRM contact, optionally linked to an account.
 */
function crmAddContact_(firstName, lastName, email, phone, title, accountId, mobile) {
  return apiCall_('/api/crm-add-contact', {
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
 * Register the user's Google Chat DM space with the worker,
 * enabling the sidebar handoff to deliver responses via GChat.
 */
function registerGchatSpace_(spaceName) {
  var payload = {
    userEmail: 'chrisg@stratusinfosystems.com',
    spaceName: spaceName,
  };
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-API-Key': getApiKey_() },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };
  try {
    var response = UrlFetchApp.fetch(CONFIG.REGISTER_SPACE_ENDPOINT, options);
    return JSON.parse(response.getContentText());
  } catch (e) {
    return { success: false, error: e.message };
  }
}
