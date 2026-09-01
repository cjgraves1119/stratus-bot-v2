/**
 * Stratus AI Chrome Extension — Authentication
 *
 * Handles Zoho OAuth flow and token refresh for per-user CRM access.
 * Uses chrome.identity.launchWebAuthFlow for OAuth.
 */

import { ZOHO } from '../lib/constants.js';
import { getSettings, getZohoTokens, saveZohoTokens, clearZohoTokens, getLocalStorage, setLocalStorage } from '../lib/storage.js';
import {
  extractZohoAuthorizationCode,
  formatZohoOAuthError,
  normalizeZohoCredential,
} from './zoho-oauth-utils.mjs';

/**
 * Start Zoho OAuth flow.
 * Opens OAuth consent page and captures the authorization code.
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function startZohoAuth() {
  const stored = await getLocalStorage('zohoClientId');
  const zohoClientId = normalizeZohoCredential(stored.zohoClientId);

  if (!zohoClientId) {
    throw new Error('Zoho Client ID not configured. Set it in extension settings.');
  }

  const redirectUrl = chrome.identity.getRedirectURL();

  const authUrl = new URL(ZOHO.AUTH_URL);
  authUrl.searchParams.set('scope', ZOHO.SCOPES);
  authUrl.searchParams.set('client_id', zohoClientId);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('redirect_uri', redirectUrl);
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  try {
    const responseUrl = await new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.toString(), interactive: true },
        (callbackUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          resolve(callbackUrl);
        }
      );
    });

    const code = extractZohoAuthorizationCode(responseUrl, redirectUrl);

    // Exchange code for tokens
    await exchangeCodeForTokens(code, zohoClientId, redirectUrl);

    return { success: true };
  } catch (err) {
    console.error('[Stratus Auth] OAuth flow failed:', err);
    const rawMessage = normalizeZohoCredential(err?.message);
    const message = rawMessage.startsWith('Zoho ')
      ? rawMessage
      : formatZohoOAuthError({
        data: { error: rawMessage },
        redirectUri: redirectUrl,
        phase: 'authorization',
      });
    return { success: false, error: message };
  }
}

/**
 * Exchange authorization code for access + refresh tokens.
 */
export async function exchangeCodeForTokens(code, clientId, redirectUri) {
  const stored = await getLocalStorage('zohoClientSecret');
  const zohoClientSecret = normalizeZohoCredential(stored.zohoClientSecret);
  if (!zohoClientSecret) {
    throw new Error('Zoho Client Secret not configured.');
  }

  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: zohoClientSecret,
    code,
    redirect_uri: redirectUri,
  });

  const response = await fetch(ZOHO.TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const responseText = await response.text();
  let data = {};
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    data = {};
  }

  if (!response.ok || data.error || !data.access_token) {
    throw new Error(formatZohoOAuthError({
      data,
      status: response.status,
      statusText: response.statusText,
      redirectUri,
      phase: 'token',
    }));
  }

  const tokens = {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in * 1000) - 60000, // 1 min buffer
  };

  await saveZohoTokens(tokens);
  console.log('[Stratus Auth] Zoho tokens saved successfully.');
}

/**
 * Get a valid Zoho access token, refreshing if expired.
 * @returns {Promise<string|null>} Access token or null if not authenticated
 */
export async function getValidZohoToken() {
  const tokens = await getZohoTokens();
  if (!tokens) return null;

  // Token still valid
  if (tokens.expiresAt > Date.now()) {
    return tokens.accessToken;
  }

  // Token expired — refresh
  try {
    const refreshed = await refreshZohoToken(tokens.refreshToken);
    return refreshed.accessToken;
  } catch (err) {
    console.error('[Stratus Auth] Token refresh failed:', err);
    return null;
  }
}

/**
 * Refresh an expired Zoho access token.
 */
async function refreshZohoToken(refreshToken) {
  const stored = await getLocalStorage(['zohoClientId', 'zohoClientSecret']);
  const zohoClientId = normalizeZohoCredential(stored.zohoClientId);
  const zohoClientSecret = normalizeZohoCredential(stored.zohoClientSecret);

  if (!zohoClientId || !zohoClientSecret) {
    throw new Error('Zoho credentials not configured.');
  }

  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: zohoClientId,
    client_secret: zohoClientSecret,
    refresh_token: refreshToken,
  });

  const response = await fetch(ZOHO.TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  const data = await response.json();

  if (data.error) {
    // Refresh token might be revoked — clear tokens
    await clearZohoTokens();
    throw new Error(`Zoho refresh failed: ${data.error}. Please re-authenticate.`);
  }

  const tokens = {
    accessToken: data.access_token,
    refreshToken: refreshToken, // Refresh token doesn't change on refresh
    expiresAt: Date.now() + (data.expires_in * 1000) - 60000,
  };

  await saveZohoTokens(tokens);
  return tokens;
}

/**
 * Check if user is authenticated with Zoho.
 * @returns {Promise<{authenticated: boolean, email?: string}>}
 */
export async function getAuthStatus() {
  const tokens = await getZohoTokens();
  const settings = await getSettings();

  return {
    hasApiKey: !!settings.apiKey,
    zohoAuthenticated: !!tokens,
    zohoTokenExpired: tokens ? tokens.expiresAt < Date.now() : false,
    zohoRedirectUrl: chrome.identity.getRedirectURL(),
    userEmail: settings.userEmail || '',
    userName: settings.userName || '',
  };
}

/**
 * Disconnect Zoho (clear tokens).
 */
export async function disconnectZoho() {
  await clearZohoTokens();
  return { success: true };
}
