/**
 * Stratus AI Chrome Extension — Cache Manager
 *
 * Manages IndexedDB cache lifecycle, background price sync,
 * and cache pruning via chrome.alarms.
 */

import { pruneCache, savePriceCatalog, getCached, setCached } from '../lib/storage.js';
import { API_BASE, CACHE_TTL } from '../lib/constants.js';
import { getSettings } from '../lib/storage.js';

/**
 * Set up cache maintenance alarms.
 * Called once on extension install/startup.
 */
export function setupCacheAlarms() {
  // Prune expired cache entries every 30 minutes
  chrome.alarms.create('cache-prune', { periodInMinutes: 30 });

  // Refresh price catalog every 6 hours
  chrome.alarms.create('price-sync', { periodInMinutes: 360 });
}

/**
 * Handle alarm events.
 */
export async function handleAlarm(alarm) {
  switch (alarm.name) {
    case 'cache-prune':
      await pruneCache();
      break;
    case 'price-sync':
      await refreshPriceCatalog();
      break;
  }
}

/**
 * Fetch the live price catalog from the worker and store in IndexedDB.
 */
export async function refreshPriceCatalog() {
  try {
    const settings = await getSettings();
    if (!settings.apiKey) return;

    const response = await fetch(`${API_BASE}/_prices-status`, {
      headers: { 'X-API-Key': settings.apiKey },
    });

    if (!response.ok) {
      console.warn('[Stratus Cache] Price status check failed:', response.status);
      return;
    }

    const status = await response.json();
    console.log('[Stratus Cache] Price catalog status:', status);

    // The prices are served through the worker's regular endpoints.
    // For the extension, we cache prices as they're looked up via API calls.
    // A full catalog sync could be implemented here if a bulk endpoint is added.

    await setCached('price_sync_last', {
      timestamp: Date.now(),
      stats: status,
    }, CACHE_TTL.PRICE_CATALOG);

  } catch (err) {
    console.warn('[Stratus Cache] Price refresh failed:', err.message);
  }
}
