import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.STRATUS_API_BASE = 'https://snapshot.invalid';
globalThis.STRATUS_ENV = 'dev';

const redirectUri = 'https://mlneckemiamiojeppkafdacgipbbiaid.chromiumapp.org/';
const localStore = {
  zohoClientId: '  1000.TESTCLIENT  ',
  zohoClientSecret: '  test-secret  ',
};
let launchBehavior = null;
let launchedUrl = '';
let fetchResponse = null;
let fetchBody = '';

function valuesFor(keys, source) {
  const names = Array.isArray(keys) ? keys : [keys];
  return Object.fromEntries(names.map((key) => [key, source[key]]));
}

globalThis.chrome = {
  identity: {
    getRedirectURL: () => redirectUri,
    launchWebAuthFlow: ({ url }, callback) => {
      launchedUrl = url;
      launchBehavior(callback);
    },
  },
  runtime: { lastError: null },
  storage: {
    local: {
      get: (keys, callback) => callback(valuesFor(keys, localStore)),
      set: (items, callback) => { Object.assign(localStore, items); callback(); },
      remove: (keys, callback) => {
        for (const key of Array.isArray(keys) ? keys : [keys]) delete localStore[key];
        callback();
      },
    },
    sync: {
      get: (_keys, callback) => callback({ settings: {} }),
      set: (_items, callback) => callback(),
    },
  },
};

globalThis.fetch = async (_url, options) => {
  fetchBody = options.body;
  return fetchResponse;
};

const { getAuthStatus, startZohoAuth } = await import('./src/background/auth.js');

function response({ ok, status, statusText, body }) {
  return { ok, status, statusText, text: async () => body };
}

test('classifies launchWebAuthFlow Unauthorized with the exact redirect URI', async () => {
  launchBehavior = (callback) => {
    chrome.runtime.lastError = { message: 'Unauthorized' };
    callback(undefined);
    chrome.runtime.lastError = null;
  };

  const result = await startZohoAuth();
  assert.equal(result.success, false);
  assert.match(result.error, /Client ID and Client Secret come from the same Server-based client/);
  assert.match(result.error, new RegExp(redirectUri.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('classifies callback invalid-client and redirect errors before token exchange', async () => {
  launchBehavior = (callback) => callback(`${redirectUri}?error=invalid_client`);
  assert.match((await startZohoAuth()).error, /same Server-based client/);

  launchBehavior = (callback) => callback(`${redirectUri}?error=invalid_redirect_uri`);
  assert.match((await startZohoAuth()).error, /Register this exact Authorized Redirect URI/);
});

test('classifies token invalid-client, non-JSON, and missing-token responses', async () => {
  launchBehavior = (callback) => callback(`${redirectUri}?code=one-time-code`);

  fetchResponse = response({ ok: false, status: 400, statusText: 'Bad Request', body: '{"error":"invalid_client"}' });
  assert.match((await startZohoAuth()).error, /same Server-based client/);

  fetchResponse = response({ ok: false, status: 502, statusText: 'Bad Gateway', body: '<html>failure</html>' });
  assert.equal((await startZohoAuth()).error, 'Zoho token exchange failed (HTTP 502): Bad Gateway');

  fetchResponse = response({ ok: true, status: 200, statusText: 'OK', body: '{"expires_in":3600}' });
  assert.equal((await startZohoAuth()).error, 'Zoho token exchange failed (HTTP 200): OK');
});

test('trims the client pair before authorization and token exchange', async () => {
  launchBehavior = (callback) => callback(`${redirectUri}?code=one-time-code`);
  fetchResponse = response({
    ok: true,
    status: 200,
    statusText: 'OK',
    body: '{"access_token":"access","refresh_token":"refresh","expires_in":3600}',
  });

  const result = await startZohoAuth();
  assert.equal(result.success, true);
  assert.equal(new URL(launchedUrl).searchParams.get('client_id'), '1000.TESTCLIENT');
  const body = new URLSearchParams(fetchBody);
  assert.equal(body.get('client_id'), '1000.TESTCLIENT');
  assert.equal(body.get('client_secret'), 'test-secret');
  assert.equal(body.get('redirect_uri'), redirectUri);
});

test('auth status exposes the exact runtime redirect URI', async () => {
  assert.equal((await getAuthStatus()).zohoRedirectUrl, redirectUri);
});
