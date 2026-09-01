export function normalizeZohoCredential(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function boundedZohoError(value) {
  return normalizeZohoCredential(value)
    .slice(0, 120)
    .replace(/[^a-zA-Z0-9_. -]/g, '') || 'unknown_error';
}

export function formatZohoOAuthError({ data, status, statusText, redirectUri, phase = 'token' }) {
  const errorCode = boundedZohoError(data?.error || statusText || 'unknown_error');
  const normalizedCode = errorCode.toLowerCase().replaceAll(' ', '_');
  const exactRedirect = normalizeZohoCredential(redirectUri);

  if (normalizedCode.includes('redirect')) {
    return `Zoho rejected the redirect URI. Register this exact Authorized Redirect URI in the same Server-based client: ${exactRedirect}`;
  }

  if (normalizedCode.includes('invalid_client') || normalizedCode.includes('unauthorized')) {
    return `Zoho rejected the client credentials (${errorCode}). Confirm the Client ID and Client Secret come from the same Server-based client, and register this exact Authorized Redirect URI: ${exactRedirect}`;
  }

  if (normalizedCode.includes('access_denied') || normalizedCode.includes('user_denied')) {
    return 'Zoho authorization was denied or canceled. No CRM access was granted.';
  }

  const httpStatus = Number.isInteger(status) && status > 0 ? ` (HTTP ${status})` : '';
  const label = phase === 'authorization' ? 'authorization' : 'token exchange';
  return `Zoho ${label} failed${httpStatus}: ${errorCode}`;
}

export function extractZohoAuthorizationCode(responseUrl, redirectUri) {
  const url = new URL(responseUrl);
  const fragment = new URLSearchParams(url.hash.replace(/^#/, ''));
  const oauthError = url.searchParams.get('error') || fragment.get('error');
  if (oauthError) {
    throw new Error(formatZohoOAuthError({
      data: { error: oauthError },
      redirectUri,
      phase: 'authorization',
    }));
  }

  const code = url.searchParams.get('code') || fragment.get('code');
  if (!code) {
    throw new Error('Zoho authorization failed: no_authorization_code');
  }
  return code;
}
