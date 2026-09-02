import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  composioExecute,
  dispatchLeadTimeRoutes,
} from './src/lead-time.js';

const GATEWAY_API_KEY = 'test-gateway-api-key';
const COMPOSIO_WEBHOOK_SECRET = 'test-composio-webhook-secret';
const WEBEX_WEBHOOK_SECRET = 'test-webex-webhook-secret';
const COMPOSIO_API_KEY = 'test-composio-api-key';

function throwingFetch() {
  throw new Error('composio fetch must not be invoked');
}

function baseEnv(overrides = {}) {
  return {
    GATEWAY_VERSION: '1.0.0',
    GATEWAY_API_KEY,
    COMPOSIO_WEBHOOK_SECRET,
    WEBEX_WEBHOOK_SECRET,
    ...overrides,
  };
}

async function dispatch(method, path, { headers = {}, body, env, fetch: fetchFn } = {}) {
  const init = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers['Content-Type']) init.headers['Content-Type'] = 'application/json';
  }
  const request = new Request(`https://gateway.test${path}`, init);
  return dispatchLeadTimeRoutes(request, env || baseEnv(), { fetch: fetchFn || throwingFetch });
}

function composioSignature(rawBody, webhookId, webhookTimestamp, secret = COMPOSIO_WEBHOOK_SECRET) {
  const signingString = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  return `v1,${createHmac('sha256', secret).update(signingString).digest('base64')}`;
}

function webexSignature(rawBody, secret = WEBEX_WEBHOOK_SECRET) {
  return createHmac('sha1', secret).update(rawBody).digest('hex');
}

test('GET /health includes ok: true and existing fields', async () => {
  const resp = await dispatch('GET', '/health');
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.ok, true);
  assert.equal(data.status, 'Stratus AI Gateway running');
  assert.equal(typeof data.version, 'string');
  assert.equal(typeof data.mode, 'string');
  assert.equal(data.mainWorkerBinding, 'connected');
});

test('unsigned POST /webhooks/composio returns 401', async () => {
  const resp = await dispatch('POST', '/webhooks/composio', {
    body: '{"id":"msg_unsigned"}',
  });
  assert.equal(resp.status, 401);
});

test('unsigned POST /webhooks/webex returns 401', async () => {
  const resp = await dispatch('POST', '/webhooks/webex', {
    body: '{"id":"evt_unsigned"}',
  });
  assert.equal(resp.status, 401);
});

test('valid Composio HMAC-SHA256 returns 200', async () => {
  const webhookId = 'msg_test_valid';
  const webhookTimestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = '{"id":"msg_test_valid","data":{"messageId":"mid-1","roomId":"rid-1"}}';
  const resp = await dispatch('POST', '/webhooks/composio', {
    headers: {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': composioSignature(rawBody, webhookId, webhookTimestamp),
    },
    body: rawBody,
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), {});
});

test('valid Webex HMAC-SHA1 returns 200', async () => {
  const rawBody = '{"id":"evt_test_valid"}';
  const resp = await dispatch('POST', '/webhooks/webex', {
    headers: { 'X-Spark-Signature': webexSignature(rawBody) },
    body: rawBody,
  });
  assert.equal(resp.status, 200);
  assert.deepEqual(await resp.json(), {});
});

test('POST /api/lead-time without API key returns 401', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    body: { sku: 'MR44-HW' },
  });
  assert.equal(resp.status, 401);
});

test('POST /api/lead-time with key + LIC-ENT-1Y returns 400 and does not fetch', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { sku: 'LIC-ENT-1Y' },
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 400);
  const data = await resp.json();
  assert.equal(data.error, 'no_hardware_skus');
});

test('POST /api/lead-time with key + MR44-HW is dry-run with exact text', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { sku: 'MR44-HW' },
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.ok, true);
  assert.equal(data.sent, false);
  assert.equal(data.dryRun, true);
  assert.equal(data.skuCount, 1);
  assert.equal(data.text, 'lead time of MR44-HW');
});

test('batch hardware SKUs join with no spaces after commas', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { skus: ['MR44-HW', 'MS130-12X-HW'] },
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.text, 'lead time of MR44-HW,MS130-12X-HW');
  assert.equal(data.skuCount, 2);
  assert.equal(data.sent, false);
  assert.equal(data.dryRun, true);
});

test('mixed hardware + license keeps only hardware', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { skus: ['MR44-HW', 'LIC-ENT-1Y'] },
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.text, 'lead time of MR44-HW');
  assert.equal(data.skuCount, 1);
});

test('LEAD_TIME_SEND_ENABLED unset does not invoke composio fetch', async () => {
  const env = baseEnv();
  assert.equal(env.LEAD_TIME_SEND_ENABLED, undefined);
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { sku: 'MR44-HW' },
    env,
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 200);
  const data = await resp.json();
  assert.equal(data.dryRun, true);
  assert.equal(data.sent, false);
});

test('send-enabled without COMPOSIO_API_KEY returns 503 and does not fetch', async () => {
  const resp = await dispatch('POST', '/api/lead-time', {
    headers: { 'X-API-Key': GATEWAY_API_KEY },
    body: { sku: 'MR44-HW' },
    env: baseEnv({ LEAD_TIME_SEND_ENABLED: '1' }),
    fetch: throwingFetch,
  });
  assert.equal(resp.status, 503);
  const data = await resp.json();
  assert.equal(data.error, 'service_unavailable');
});

test('composioExecute posts to v3.1 with connected_account_id (injected fetch)', async () => {
  let captured = null;
  const fakeFetch = async (url, init) => {
    captured = { url, init };
    return new Response(JSON.stringify({ successful: true }), { status: 200 });
  };
  const env = { COMPOSIO_API_KEY };
  await composioExecute(env, 'WEBEX_MESSAGING_CREATE_MESSAGE', {
    roomId: 'room-test',
    text: 'lead time of MR44-HW',
    markdown: 'lead time of MR44-HW',
  }, fakeFetch);
  assert.equal(
    captured.url,
    'https://backend.composio.dev/api/v3.1/tools/execute/WEBEX_MESSAGING_CREATE_MESSAGE',
  );
  assert.equal(captured.init.headers['x-api-key'], COMPOSIO_API_KEY);
  const posted = JSON.parse(captured.init.body);
  assert.equal(posted.connected_account_id, 'webex_curite-bazaar');
  assert.equal(posted.arguments.text, 'lead time of MR44-HW');
});

test('stale Composio timestamp is rejected', async () => {
  const webhookId = 'msg_test_stale';
  const webhookTimestamp = String(Math.floor(Date.now() / 1000) - 400);
  const rawBody = '{"id":"msg_test_stale"}';
  const resp = await dispatch('POST', '/webhooks/composio', {
    headers: {
      'webhook-id': webhookId,
      'webhook-timestamp': webhookTimestamp,
      'webhook-signature': composioSignature(rawBody, webhookId, webhookTimestamp),
    },
    body: rawBody,
  });
  assert.equal(resp.status, 401);
});

test('index.js wires lead-time before /api passthrough and does not revive Pipedream', () => {
  const src = readFileSync(fileURLToPath(new URL('./src/index.js', import.meta.url)), 'utf8');
  assert.match(src, /dispatchLeadTimeRoutes/);
  assert.match(src, /\/api\/lead-time/);
  const dispatchIdx = src.indexOf('dispatchLeadTimeRoutes');
  const passthroughIdx = src.indexOf("pathname.startsWith('/api/')");
  assert.ok(dispatchIdx > 0 && passthroughIdx > dispatchIdx, 'lead-time dispatch must run before /api passthrough');
  assert.doesNotMatch(src, /pipedream\.net/i);
  assert.doesNotMatch(src, /submitVelocityHubDid/);
  assert.doesNotMatch(src, /PIPEDREAM_WEBEX/);
});
