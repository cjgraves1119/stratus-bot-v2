/**
 * Lead-time + inbound webhook routes for stratus-ai-bot-gateway.
 *
 * Commerce BOT email is ccwbot@webex.bot (comment only — never used to send).
 * Live execute is gated by LEAD_TIME_SEND_ENABLED === "1" (unset = dry-run).
 * Secret values live in Worker secrets; this file references names only.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-user-email, X-Force-Model, X-Eval-Run-Id',
};

const COMPOSIO_EXECUTE_BASE = 'https://backend.composio.dev/api/v3.1/tools/execute';
const COMPOSIO_CONNECTED_ACCOUNT_ID = 'webex_curite-bazaar';
const COMPOSIO_CREATE_MESSAGE_SLUG = 'WEBEX_MESSAGING_CREATE_MESSAGE';
const WEBHOOK_MAX_AGE_SECONDS = 300;

// Stratus Bot Group room (config, not a secret).
const STRATUS_BOT_GROUP_ROOM_ID =
  'Y2lzY29zcGFyazovL3VzL1JPT00vNjBiZWVmMDAtZDYzMi0xMWYwLThmYmMtZWRhMTE1OTNjY2Vh';

// Commerce BOT person id used only in spark-mention markdown (config, not a secret).
const COMMERCE_BOT_PERSON_ID =
  'Y2lzY29zcGFyazovL3VzL1BFT1BMRS9hY2YwMTUxOC02MDFmLTRlY2YtOTYzYy1lMWZmZjliYzFkNGY';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function unauthorized() {
  return jsonResponse({ error: 'Unauthorized' }, 401);
}

export function healthPayload(env) {
  return {
    ok: true,
    status: 'Stratus AI Gateway running',
    version: env.GATEWAY_VERSION || '1.0.0',
    mode: 'waterfall: gemma-first → claude-fallback',
    mainWorkerBinding: 'connected',
  };
}

export function handleHealth(env) {
  return jsonResponse(healthPayload(env));
}

function isHardwareSku(raw) {
  const sku = String(raw ?? '').trim();
  if (!sku) return false;
  const upper = sku.toUpperCase();
  if (upper.startsWith('LIC-')) return false;
  return upper.endsWith('-HW');
}

export function collectHardwareSkus(body) {
  const candidates = [];
  if (!body || typeof body !== 'object') return [];
  if (typeof body.sku === 'string') candidates.push(body.sku);
  if (Array.isArray(body.skus)) {
    for (const item of body.skus) {
      if (typeof item === 'string') candidates.push(item);
    }
  } else if (typeof body.skus === 'string') {
    for (const part of body.skus.split(',')) candidates.push(part);
  }
  const hardware = [];
  for (const raw of candidates) {
    const sku = String(raw).trim();
    if (isHardwareSku(sku)) hardware.push(sku);
  }
  return hardware;
}

export function buildLeadTimeQuery(skus) {
  const joined = skus.join(',');
  const text = `lead time of ${joined}`;
  const markdown =
    `<spark-mention data-object-type="person" data-object-id="${COMMERCE_BOT_PERSON_ID}"></spark-mention> ` +
    text;
  return {
    roomId: STRATUS_BOT_GROUP_ROOM_ID,
    text,
    markdown,
  };
}

/**
 * Path A helper. POSTs to Composio tools.execute.
 * Callers must not invoke this when LEAD_TIME_SEND_ENABLED is unset.
 */
export async function composioExecute(env, toolSlug, args, fetchFn = globalThis.fetch) {
  const url = `${COMPOSIO_EXECUTE_BASE}/${encodeURIComponent(toolSlug)}`;
  return fetchFn(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.COMPOSIO_API_KEY,
    },
    body: JSON.stringify({
      connected_account_id: COMPOSIO_CONNECTED_ACCOUNT_ID,
      arguments: args,
    }),
  });
}

export async function handleLeadTime(request, env, options = {}) {
  const fetchFn = options.fetch || globalThis.fetch;
  const apiKey = request.headers.get('X-API-Key');
  if (!env.GATEWAY_API_KEY || apiKey !== env.GATEWAY_API_KEY) {
    return unauthorized();
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid JSON body' }, 400);
  }

  const skus = collectHardwareSkus(body);
  if (!skus.length) {
    return jsonResponse({ error: 'no_hardware_skus', reason: 'hardware SKUs only' }, 400);
  }

  const query = buildLeadTimeQuery(skus);
  const sendEnabled = env.LEAD_TIME_SEND_ENABLED === '1';

  if (!sendEnabled) {
    return jsonResponse({
      ok: true,
      sent: false,
      dryRun: true,
      skuCount: skus.length,
      text: query.text,
    });
  }

  if (!env.COMPOSIO_API_KEY) {
    return jsonResponse({ error: 'service_unavailable', reason: 'COMPOSIO_API_KEY missing' }, 503);
  }

  try {
    const resp = await composioExecute(env, COMPOSIO_CREATE_MESSAGE_SLUG, {
      roomId: query.roomId,
      text: query.text,
      markdown: query.markdown,
    }, fetchFn);
    const status = resp && typeof resp.status === 'number' ? resp.status : 502;
    if (status < 200 || status >= 300) {
      return jsonResponse({ error: 'composio_execute_failed' }, 502);
    }
    return jsonResponse({
      ok: true,
      sent: true,
      dryRun: false,
      skuCount: skus.length,
      text: query.text,
    });
  } catch {
    return jsonResponse({ error: 'composio_execute_failed' }, 502);
  }
}

function parseUnixSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n > 1e12 ? n / 1000 : n;
}

function isTimestampFresh(rawTs, nowMs = Date.now()) {
  const ts = parseUnixSeconds(rawTs);
  if (ts == null) return false;
  return (nowMs / 1000) - ts <= WEBHOOK_MAX_AGE_SECONDS;
}

function extractSignatureValue(header) {
  if (!header) return '';
  const trimmed = String(header).trim();
  if (!trimmed) return '';
  return trimmed.includes(',') ? trimmed.slice(trimmed.indexOf(',') + 1).trim() : trimmed;
}

function base64ToBytes(b64) {
  try {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function hexToBytes(hex) {
  const clean = String(hex || '').trim();
  if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function hmacVerify(hashName, secret, data, signatureBytes) {
  if (!secret || !signatureBytes || !signatureBytes.byteLength) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: hashName },
    false,
    ['verify'],
  );
  const payload = typeof data === 'string' ? enc.encode(data) : data;
  return crypto.subtle.verify('HMAC', key, signatureBytes, payload);
}

function asId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 256 || /\s/.test(trimmed)) return null;
  return trimmed;
}

function redactComposioEvent(payload, webhookTimestamp) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const data = root.data && typeof root.data === 'object' ? root.data : root;
  return {
    messageId: asId(data.messageId) || asId(data.message_id) || asId(data.id),
    roomId: asId(data.roomId) || asId(data.room_id),
    timestamp: asId(String(webhookTimestamp || '')) || asId(root.timestamp) || null,
  };
}

async function persistRedactedComposio(env, webhookId, redacted) {
  if (!env.CONVERSATION_KV || typeof env.CONVERSATION_KV.put !== 'function') return;
  const key = `lead-time:composio:${asId(webhookId) || 'unknown'}`;
  try {
    await env.CONVERSATION_KV.put(key, JSON.stringify(redacted), { expirationTtl: 86400 });
  } catch {
    // Persistence is best-effort; webhook ACK must stay fast.
  }
}

export async function handleComposioWebhook(request, env) {
  const secret = env.COMPOSIO_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get('webhook-signature');
  const webhookId = request.headers.get('webhook-id');
  const webhookTimestamp = request.headers.get('webhook-timestamp');
  const rawBody = await request.text();

  if (!secret || !signatureHeader || !webhookId || !webhookTimestamp) {
    return unauthorized();
  }
  if (!isTimestampFresh(webhookTimestamp)) {
    return unauthorized();
  }

  const provided = extractSignatureValue(signatureHeader);
  const signatureBytes = base64ToBytes(provided);
  const signingString = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const ok = await hmacVerify('SHA-256', secret, signingString, signatureBytes);
  if (!ok) return unauthorized();

  let payload = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    payload = {};
  }
  await persistRedactedComposio(env, webhookId, redactComposioEvent(payload, webhookTimestamp));
  return jsonResponse({}, 200);
}

export async function handleWebexWebhook(request, env) {
  const secret = env.WEBEX_WEBHOOK_SECRET;
  const signatureHeader = request.headers.get('X-Spark-Signature');
  const rawBody = await request.text();

  if (!secret || !signatureHeader) {
    return unauthorized();
  }

  const signatureBytes = hexToBytes(signatureHeader);
  const ok = await hmacVerify('SHA-1', secret, rawBody, signatureBytes);
  if (!ok) return unauthorized();

  return jsonResponse({}, 200);
}

/**
 * Handles lead-time + webhook routes. Returns a Response or null if the
 * request should fall through to the rest of the gateway (including /api passthrough).
 */
export async function dispatchLeadTimeRoutes(request, env, options = {}) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  if (request.method === 'GET' && pathname === '/health') {
    return handleHealth(env);
  }
  if (request.method === 'POST' && pathname === '/api/lead-time') {
    return handleLeadTime(request, env, options);
  }
  if (request.method === 'POST' && pathname === '/webhooks/composio') {
    return handleComposioWebhook(request, env);
  }
  if (request.method === 'POST' && pathname === '/webhooks/webex') {
    return handleWebexWebhook(request, env);
  }
  return null;
}
