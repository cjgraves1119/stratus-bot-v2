/**
 * Stratus AI Gmail Add-on — Configuration
 *
 * All constants, API URLs, and property accessors live here.
 */

const CONFIG = {
  API_BASE: 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev',
  CACHE_TTL_SECONDS: 300,  // 5 min in-memory cache for CRM data
  MAX_EMAIL_BODY_CHARS: 8000,  // Truncate long emails before sending to API
  STRATUS_COLOR: '#1a73a7',
  ZOHO_ORG_URL: 'https://crm.zoho.com/crm/org647122552',
};

/**
 * Get the API key from Script Properties.
 * Set via: File > Project Settings > Script Properties > STRATUS_API_KEY
 */
function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('STRATUS_API_KEY');
  if (!key) {
    throw new Error('STRATUS_API_KEY not set. Go to Project Settings > Script Properties and add it.');
  }
  return key;
}

/**
 * Simple per-execution cache using CacheService (shared across triggers).
 */
function getCached_(key) {
  try {
    const cache = CacheService.getUserCache();
    const val = cache.get(key);
    return val ? JSON.parse(val) : null;
  } catch (e) {
    return null;
  }
}

function setCached_(key, value, ttl) {
  try {
    const cache = CacheService.getUserCache();
    cache.put(key, JSON.stringify(value), ttl || CONFIG.CACHE_TTL_SECONDS);
  } catch (e) {
    // Cache failures are non-fatal
  }
}
