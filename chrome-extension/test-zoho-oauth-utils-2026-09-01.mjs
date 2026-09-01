import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractZohoAuthorizationCode,
  formatZohoOAuthError,
  normalizeZohoCredential,
} from './src/background/zoho-oauth-utils.mjs';

const redirectUri = 'https://mlneckemiamiojeppkafdacgipbbiaid.chromiumapp.org/';

test('normalizes pasted Zoho credentials without changing their contents', () => {
  assert.equal(normalizeZohoCredential('  1000.CLIENT123  '), '1000.CLIENT123');
  assert.equal(normalizeZohoCredential('  secret-value\n'), 'secret-value');
  assert.equal(normalizeZohoCredential(null), '');
});

test('explains invalid client failures without exposing the secret', () => {
  const message = formatZohoOAuthError({
    data: { error: 'invalid_client' },
    status: 400,
    statusText: 'Bad Request',
    redirectUri,
  });

  assert.match(message, /same Server-based client/);
  assert.match(message, new RegExp(redirectUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(message, /secret-value/);
});

test('explains unauthorized failures as a client pair or redirect mismatch', () => {
  const message = formatZohoOAuthError({
    data: { error: 'Unauthorized' },
    status: 401,
    statusText: 'Unauthorized',
    redirectUri,
  });

  assert.match(message, /Client ID and Client Secret/);
  assert.match(message, /Authorized Redirect URI/);
});

test('gives a dedicated exact redirect instruction', () => {
  const message = formatZohoOAuthError({
    data: { error: 'invalid_redirect_uri' },
    status: 400,
    statusText: 'Bad Request',
    redirectUri,
  });

  assert.equal(
    message,
    `Zoho rejected the redirect URI. Register this exact Authorized Redirect URI in the same Server-based client: ${redirectUri}`,
  );
});

test('keeps a bounded generic failure for unknown responses', () => {
  assert.equal(
    formatZohoOAuthError({
      data: {},
      status: 502,
      statusText: 'Bad Gateway',
      redirectUri,
    }),
    'Zoho token exchange failed (HTTP 502): Bad Gateway',
  );
});

test('extracts a callback code and classifies callback errors before token exchange', () => {
  assert.equal(
    extractZohoAuthorizationCode(`${redirectUri}?code=one-time-code`, redirectUri),
    'one-time-code',
  );
  assert.throws(
    () => extractZohoAuthorizationCode(`${redirectUri}?error=invalid_client`, redirectUri),
    /same Server-based client/,
  );
  assert.throws(
    () => extractZohoAuthorizationCode(`${redirectUri}#error=invalid_redirect_uri`, redirectUri),
    /Register this exact Authorized Redirect URI/,
  );
  assert.throws(
    () => extractZohoAuthorizationCode(redirectUri, redirectUri),
    /no_authorization_code/,
  );
});

test('bounds arbitrary authorization errors and never echoes punctuation payloads', () => {
  const message = formatZohoOAuthError({
    data: { error: '<script>unexpected</script>' },
    redirectUri,
    phase: 'authorization',
  });
  assert.equal(message, 'Zoho authorization failed: scriptunexpectedscript');
});
