/**
 * Stratus AI Chrome Extension — Storage Abstraction
 *
 * Wraps chrome.storage.sync (settings), chrome.storage.local (tokens/cache),
 * and IndexedDB (large data) in a unified async API.
 */

// ─────────────────────────────────────────────
// Chrome Storage (sync + local)
// ─────────────────────────────────────────────

/**
 * Get values from chrome.storage.sync (settings that sync across devices).
 * @param {string|string[]} keys
 * @returns {Promise<Object>}
 */
export function getSyncStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, resolve);
  });
}

/**
 * Set values in chrome.storage.sync.
 * @param {Object} items
 * @returns {Promise<void>}
 */
export function setSyncStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, resolve);
  });
}

/**
 * Get values from chrome.storage.local (tokens, large cache).
 * @param {string|string[]} keys
 * @returns {Promise<Object>}
 */
export function getLocalStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, resolve);
  });
}

/**
 * Set values in chrome.storage.local.
 * @param {Object} items
 * @returns {Promise<void>}
 */
export function setLocalStorage(items) {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, resolve);
  });
}

/**
 * Remove values from chrome.storage.local.
 * @param {string|string[]} keys
 * @returns {Promise<void>}
 */
export function removeLocalStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, resolve);
  });
}

// ─────────────────────────────────────────────
// High-level Settings API
// ─────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  apiKey: '',
  userName: '',
  userEmail: '',
  enableNotifications: true,
  enableSkuHighlighting: true,
  enableCrmBanner: true,
  enableComposeButton: true,
  sidebarDefaultPanel: 'email', // email, crm, quote, tasks
  theme: 'light',
};

// In-memory settings cache (5-second TTL to avoid hammering chrome.storage)
let _settingsCache = null;
let _settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000;

/**
 * Load user settings (merged with defaults). Cached in memory for 5s.
 * @returns {Promise<Object>}
 */
export async function getSettings() {
  const now = Date.now();
  if (_settingsCache && (now - _settingsCacheTime) < SETTINGS_CACHE_TTL) {
    return _settingsCache;
  }
  const stored = await getSyncStorage('settings');
  _settingsCache = { ...DEFAULT_SETTINGS, ...(stored.settings || {}) };
  _settingsCacheTime = now;
  return _settingsCache;
}

/**
 * Save user settings (partial update).
 * @param {Object} updates
 * @returns {Promise<Object>} Merged settings
 */
export async function saveSettings(updates) {
  const current = await getSettings();
  const merged = { ...current, ...updates };
  await setSyncStorage({ settings: merged });
  _settingsCache = merged;
  _settingsCacheTime = Date.now();
  return merged;
}

// ─────────────────────────────────────────────
// Zoho Token Storage
// ─────────────────────────────────────────────

/**
 * Get stored Zoho OAuth tokens.
 * @returns {Promise<{accessToken: string, refreshToken: string, expiresAt: number}|null>}
 */
export async function getZohoTokens() {
  const { zohoTokens } = await getLocalStorage('zohoTokens');
  return zohoTokens || null;
}

/**
 * Save Zoho OAuth tokens.
 * @param {Object} tokens - {accessToken, refreshToken, expiresAt}
 */
export async function saveZohoTokens(tokens) {
  await setLocalStorage({ zohoTokens: tokens });
}

/**
 * Clear Zoho tokens (logout).
 */
export async function clearZohoTokens() {
  await removeLocalStorage('zohoTokens');
}

// ─────────────────────────────────────────────
// IndexedDB (large data: prices, analysis cache)
// ─────────────────────────────────────────────

const DB_NAME = 'stratus_ai';
const DB_VERSION = 1;

// Singleton DB connection — avoids reopening IndexedDB on every read/write
let _dbInstance = null;
let _dbPromise = null;

function openDB() {
  if (_dbInstance) return Promise.resolve(_dbInstance);
  if (_dbPromise) return _dbPromise;

  _dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Cache store with TTL
      if (!db.objectStoreNames.contains('cache')) {
        const store = db.createObjectStore('cache', { keyPath: 'key' });
        store.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      // Price catalog
      if (!db.objectStoreNames.contains('prices')) {
        db.createObjectStore('prices', { keyPath: 'sku' });
      }
    };

    request.onsuccess = () => {
      _dbInstance = request.result;
      _dbInstance.onclose = () => { _dbInstance = null; _dbPromise = null; };
      resolve(_dbInstance);
    };
    request.onerror = () => {
      _dbPromise = null;
      reject(request.error);
    };
  });

  return _dbPromise;
}

/**
 * Get a cached value from IndexedDB.
 * @param {string} key
 * @returns {Promise<any|null>}
 */
export async function getCached(key) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('cache', 'readonly');
      const store = tx.objectStore('cache');
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result;
        if (!record) return resolve(null);
        if (record.expiresAt && record.expiresAt < Date.now()) {
          // Expired — delete async and return null
          const delTx = db.transaction('cache', 'readwrite');
          delTx.objectStore('cache').delete(key);
          return resolve(null);
        }
        resolve(record.value);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Set a cached value in IndexedDB.
 * @param {string} key
 * @param {any} value
 * @param {number} ttlMs - Time to live in milliseconds
 */
export async function setCached(key, value, ttlMs) {
  try {
    const db = await openDB();
    const tx = db.transaction('cache', 'readwrite');
    const store = tx.objectStore('cache');
    store.put({
      key,
      value,
      expiresAt: ttlMs ? Date.now() + ttlMs : null,
      updatedAt: Date.now(),
    });
  } catch {
    // Cache write failures are non-fatal
  }
}

/**
 * Clear all expired cache entries.
 */
export async function pruneCache() {
  try {
    const db = await openDB();
    const tx = db.transaction('cache', 'readwrite');
    const store = tx.objectStore('cache');
    const index = store.index('expiresAt');
    const range = IDBKeyRange.upperBound(Date.now());
    const request = index.openCursor(range);

    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        if (cursor.value.expiresAt && cursor.value.expiresAt < Date.now()) {
          cursor.delete();
        }
        cursor.continue();
      }
    };
  } catch {
    // Prune failures are non-fatal
  }
}

/**
 * Store the full price catalog in IndexedDB.
 * @param {Object} priceMap - {sku: {list, ecomm, discount, ...}}
 */
export async function savePriceCatalog(priceMap) {
  try {
    const db = await openDB();
    const tx = db.transaction('prices', 'readwrite');
    const store = tx.objectStore('prices');

    // Clear old data
    store.clear();

    // Write all entries
    for (const [sku, data] of Object.entries(priceMap)) {
      store.put({ sku, ...data });
    }
  } catch {
    // Price save failures are non-fatal
  }
}

/**
 * Get price for a specific SKU.
 * @param {string} sku
 * @returns {Promise<Object|null>}
 */
export async function getPrice(sku) {
  try {
    const db = await openDB();
    return new Promise((resolve) => {
      const tx = db.transaction('prices', 'readonly');
      const store = tx.objectStore('prices');
      const request = store.get(sku);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}
