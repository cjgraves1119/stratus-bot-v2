/**
 * Stratus AI Gmail Add-on — API Client
 *
 * All HTTP communication with the Cloudflare Worker backend.
 */

/**
 * Generic API call to the Stratus worker.
 * @param {string} endpoint  Path under /api/ (e.g. '/api/analyze-email')
 * @param {Object} payload   JSON body
 * @param {number} [timeoutMs=55000]  Fetch timeout (Apps Script max is 60s)
 * @returns {Object} Parsed JSON response
 */
function apiCall_(endpoint, payload, timeoutMs) {
  const url = CONFIG.API_BASE + endpoint;
  const options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-API-Key': getApiKey_(),
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();
  const text = response.getContentText();

  if (code === 401) {
    throw new Error('Invalid API key. Check STRATUS_API_KEY in Script Properties.');
  }
  if (code >= 500) {
    console.error(`API ${endpoint} returned ${code}: ${text.substring(0, 500)}`);
    throw new Error(`Server error (${code}). Try again in a moment.`);
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    console.error(`API ${endpoint} non-JSON response: ${text.substring(0, 500)}`);
    throw new Error('Unexpected response from API.');
  }
}

/**
 * Analyze an email: summary, detected SKUs, CRM sender lookup.
 * Single call, returns everything the sidebar needs.
 */
function analyzeEmail_(subject, body, senderEmail, senderName) {
  const cacheKey = 'analyze_' + Utilities.computeDigest(
    Utilities.DigestAlgorithm.MD5, subject + senderEmail
  ).map(b => (b & 0xff).toString(16).padStart(2, '0')).join('');

  const cached = getCached_(cacheKey);
  if (cached) return cached;

  const result = apiCall_('/api/analyze-email', {
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
