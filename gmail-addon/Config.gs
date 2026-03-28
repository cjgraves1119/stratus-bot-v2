/**
 * Stratus AI Gmail Add-on — Configuration
 *
 * Constants, API URLs, property accessors, and authorization helpers.
 */

var CONFIG = {
  API_BASE: 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev',
  CACHE_TTL_SECONDS: 300,
  MAX_EMAIL_BODY_CHARS: 8000,
  STRATUS_BLUE: '#1a73a7',
  STRATUS_DARK: '#0d4f73',
  ZOHO_ORG_URL: 'https://crm.zoho.com/crm/org647122552',
  ICON_URL: 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev/icon.png',
};

/**
 * Get the API key from Script Properties.
 */
function getApiKey_() {
  var key = PropertiesService.getScriptProperties().getProperty('STRATUS_API_KEY');
  if (!key) {
    throw new Error('STRATUS_API_KEY not set. Go to Project Settings > Script Properties and add it.');
  }
  return key;
}

/**
 * AUTHORIZATION FIX — Run this function manually from the Script Editor
 * to force Google to prompt for ALL OAuth scopes including script.external_request.
 *
 * Steps:
 *   1. Open this script in the Apps Script editor
 *   2. Select "authorize" from the function dropdown
 *   3. Click Run
 *   4. Approve ALL permissions in the consent dialog
 *   5. Reinstall the test deployment
 */
function authorize() {
  // This call forces the script.external_request scope to be authorized
  var response = UrlFetchApp.fetch('https://httpbin.org/get', { muteHttpExceptions: true });
  Logger.log('Authorization test: HTTP ' + response.getResponseCode());
  Logger.log('UrlFetchApp is working. You can now reinstall the test deployment.');

  // Also verify the API key is set
  try {
    var key = getApiKey_();
    Logger.log('API key found: ' + key.substring(0, 8) + '...');
  } catch (e) {
    Logger.log('WARNING: ' + e.message);
  }

  // Test the actual API endpoint
  try {
    var apiResponse = UrlFetchApp.fetch(CONFIG.API_BASE + '/health', { muteHttpExceptions: true });
    Logger.log('API health check: HTTP ' + apiResponse.getResponseCode());
  } catch (e) {
    Logger.log('API health check failed: ' + e.message);
  }
}

/**
 * Check if UrlFetchApp is authorized (used by cards to show auth status).
 */
function isApiAuthorized_() {
  try {
    UrlFetchApp.fetch('https://httpbin.org/get', { muteHttpExceptions: true });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Simple per-execution cache using CacheService.
 */
function getCached_(key) {
  try {
    var cache = CacheService.getUserCache();
    var val = cache.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) {
    return null;
  }
}

function setCached_(key, value, ttl) {
  try {
    var cache = CacheService.getUserCache();
    cache.put(key, JSON.stringify(value), ttl || CONFIG.CACHE_TTL_SECONDS);
  } catch (e) {
    // Cache failures are non-fatal
  }
}
