/**
 * Stratus AI Gmail Add-on — API Client
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
