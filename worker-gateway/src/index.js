/**
 * Stratus AI Gateway Worker
 *
 * Thin routing layer that implements the Gemma 4 → Claude waterfall for
 * all CRM tool-use calls. Delegates heavy lifting to the main worker
 * (stratus-ai-bot-gchat) via service binding.
 *
 * Architecture:
 *   Client (Chrome ext, Webex, GChat) → Gateway /api/chat
 *     → Main worker /api/chat-waterfall (runs Gemma first, Claude fallback)
 *     → Returns unified response
 *
 * The gateway exists so clients can be pointed here for testing the
 * Gemma-first strategy without modifying the production main worker.
 * Rollback = flip client API_BASE back to the main worker URL.
 */

const MAIN_WORKER_PATH = '/api/chat-waterfall';

// ─── CORS ────────────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-API-Key, x-user-email, X-Force-Model',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders }
  });
}

// ─── Telemetry ───────────────────────────────────────────────────────────
async function logGatewayHit(env, record) {
  if (!env.ANALYTICS_DB) return;
  try {
    // Ensure the table exists (idempotent DDL)
    await env.ANALYTICS_DB.prepare(
      'CREATE TABLE IF NOT EXISTS gateway_log (ts TEXT, endpoint TEXT, tier TEXT, stall_reason TEXT, total_ms INTEGER, model TEXT, tool_count INTEGER, user_email TEXT, status INTEGER)'
    ).run();
    await env.ANALYTICS_DB.prepare(
      'INSERT INTO gateway_log (ts, endpoint, tier, stall_reason, total_ms, model, tool_count, user_email, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      new Date().toISOString(),
      record.endpoint || 'unknown',
      record.tier || 'unknown',
      record.stallReason || '',
      record.totalMs || 0,
      record.model || '',
      record.toolCount || 0,
      record.userEmail || 'anonymous',
      record.status || 200
    ).run();
  } catch (err) {
    console.log('[GATEWAY] Telemetry insert failed (non-fatal):', err.message);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// Forward a request to the main worker via service binding.
// The main worker treats service-binding requests the same as external ones.
async function forwardToMain(env, pathname, body, extraHeaders = {}) {
  // The main worker is reached via env.MAIN_WORKER.fetch() — same host,
  // zero latency cost, no auth required for whitelisted endpoints.
  const url = `https://stratus-ai-bot-gchat.internal${pathname}`;
  const req = new Request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify(body)
  });
  const resp = await env.MAIN_WORKER.fetch(req);
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text, parseError: true }; }
  return { status: resp.status, data };
}

// ─── Dashboard HTML ──────────────────────────────────────────────────────
const GATEWAY_DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Stratus AI Gateway — Waterfall Status</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 1100px; margin: 40px auto; padding: 20px; background: #f6f8fa; }
  h1 { font-size: 28px; margin-bottom: 4px; }
  .sub { color: #586069; margin-bottom: 24px; }
  .card { background: white; border-radius: 8px; padding: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 16px; }
  .card h2 { font-size: 16px; margin: 0 0 12px 0; }
  pre { background: #f6f8fa; padding: 10px; border-radius: 4px; overflow-x: auto; font-size: 12px; }
  .pill { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: 600; background: #d4edda; color: #155724; }
  .metric { font-size: 32px; font-weight: 700; color: #0366d6; }
  .metric-label { font-size: 12px; color: #586069; }
  .row { display: flex; gap: 16px; }
  .row > .card { flex: 1; }
  textarea { width: 100%; min-height: 80px; font-family: -apple-system, sans-serif; font-size: 14px; padding: 8px; border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box; }
  button { background: #0366d6; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 600; }
  button:hover { background: #0256c1; }
  button.secondary { background: #e1e4e8; color: #24292e; }
  select, input[type=text] { padding: 8px; border-radius: 4px; border: 1px solid #ccc; font-size: 14px; }
  .outcome { margin-top: 16px; padding: 12px; background: #f6f8fa; border-radius: 6px; font-size: 13px; }
  .tier-gemma { color: #155724; font-weight: 600; }
  .tier-claude-fallback { color: #856404; font-weight: 600; }
  .tier-claude { color: #6f42c1; font-weight: 600; }
</style>
</head>
<body>
<h1>Stratus AI Gateway</h1>
<div class="sub">Waterfall routing: Gemma 4 (tier 1) → Claude Sonnet 4.6 (tier 2 on stall). <span class="pill">ACTIVE</span></div>

<div class="card">
  <h2>Endpoint</h2>
  <pre>POST /api/chat
Body: { text, emailContext?, history?, forceModel?, dryRun? }
forceModel: "gemma" | "claude" | undefined (default: waterfall)</pre>
</div>

<div class="card">
  <h2>Live Test</h2>
  <textarea id="testText" placeholder="e.g., Find the Zoho account for Stratus Information Systems"></textarea>
  <div style="margin: 12px 0;">
    <label>Mode:
      <select id="forceMode">
        <option value="">Waterfall (Gemma → Claude)</option>
        <option value="gemma">Force Gemma only</option>
        <option value="claude">Force Claude only</option>
      </select>
    </label>
    &nbsp;
    <label><input type="checkbox" id="dryRunBox" checked> Dry-run (writes mocked)</label>
    &nbsp;
    <button onclick="runTest()">▶ Send</button>
  </div>
  <div id="testOutcome" class="outcome" style="display:none;"></div>
</div>

<div class="card">
  <h2>How to point a client here</h2>
  <pre>// Chrome extension — src/lib/constants.js
export const API_BASE = 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev';

// To roll back: change back to:
// export const API_BASE = 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev';</pre>
</div>

<div class="card">
  <h2>Architecture</h2>
  <pre>Client request
   │
   ▼
Gateway /api/chat
   │ (service binding, ~1ms overhead)
   ▼
Main worker /api/chat-waterfall
   │
   ├─► Tier 1: Gemma 4 26B (free, CF Workers AI)
   │    └─► If stalls → escalate
   └─► Tier 2: Claude Sonnet 4.6 (Anthropic API, paid)
   │
   ▼
Response flows back through gateway to client</pre>
</div>

<script>
async function runTest() {
  const text = document.getElementById('testText').value.trim();
  if (!text) return alert('Enter a test prompt first');
  const forceModel = document.getElementById('forceMode').value || undefined;
  const dryRun = document.getElementById('dryRunBox').checked;
  const out = document.getElementById('testOutcome');
  out.style.display = 'block';
  out.innerHTML = '⏳ Sending…';
  const start = Date.now();
  try {
    const resp = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, forceModel, dryRun })
    });
    const data = await resp.json();
    const elapsed = Date.now() - start;
    const tierClass = 'tier-' + (data.tierUsed || 'unknown');
    out.innerHTML =
      '<div>Tier: <span class="' + tierClass + '">' + (data.tierUsed || 'unknown') + '</span>' +
      ' | Model: ' + (data.model || 'unknown') +
      ' | ' + (data.totalMs || elapsed) + 'ms' +
      (data.stallReason ? ' | Stall: ' + data.stallReason : '') +
      ' | Tools: ' + (data.toolCallCount || 0) + '</div>' +
      '<div style="margin-top:10px;white-space:pre-wrap;">' + escapeHtml(data.reply || data.error || '(no reply)') + '</div>';
  } catch (err) {
    out.innerHTML = '✗ Error: ' + err.message;
  }
}
function escapeHtml(s) { return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[c])); }
</script>
</body>
</html>`;

// ─── Main fetch handler ──────────────────────────────────────────────────
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Health check
    if (request.method === 'GET' && (pathname === '/' || pathname === '/health')) {
      return jsonResponse({
        status: 'Stratus AI Gateway running',
        version: env.GATEWAY_VERSION || '1.0.0',
        mode: 'waterfall: gemma-first → claude-fallback',
        mainWorkerBinding: 'connected'
      });
    }

    // Dashboard
    if (request.method === 'GET' && pathname === '/dashboard') {
      return new Response(GATEWAY_DASHBOARD_HTML, {
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      });
    }

    // Main chat endpoint — drop-in replacement for main worker /api/chat
    if (request.method === 'POST' && pathname === '/api/chat') {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: 'invalid JSON body' }, 400);
      }

      const userEmail = request.headers.get('x-user-email') || 'anonymous';
      const forceHeader = request.headers.get('X-Force-Model');
      // Merge header override into body for downstream
      if (forceHeader && !body.forceModel) body.forceModel = forceHeader;

      const start = Date.now();
      let forwarded;
      try {
        forwarded = await forwardToMain(env, MAIN_WORKER_PATH, body, {
          'x-user-email': userEmail
        });
      } catch (err) {
        return jsonResponse({ error: 'gateway_forward_failed', detail: err.message }, 502);
      }

      // Telemetry (async, non-blocking)
      ctx.waitUntil(logGatewayHit(env, {
        endpoint: '/api/chat',
        tier: forwarded.data.tierUsed || 'unknown',
        stallReason: forwarded.data.stallReason,
        totalMs: forwarded.data.totalMs || (Date.now() - start),
        model: forwarded.data.model,
        toolCount: forwarded.data.toolCallCount,
        userEmail,
        status: forwarded.status
      }));

      return jsonResponse(forwarded.data, forwarded.status);
    }

    // ── Transparent passthrough for all other /api/* paths ──
    // The extension calls 30+ endpoints (crm-lookup, quote, analyze-email, etc.)
    // that live on the main worker. Forward them as-is so clients can point
    // their entire API_BASE at the gateway. Only /api/chat gets the waterfall;
    // everything else is pass-through with zero modification.
    if (pathname.startsWith('/api/') && pathname !== '/api/chat') {
      try {
        const forwardHeaders = {};
        for (const [k, v] of request.headers.entries()) {
          // Skip hop-by-hop headers that service binding handles itself
          if (['host', 'content-length', 'cf-connecting-ip', 'cf-ray'].includes(k.toLowerCase())) continue;
          forwardHeaders[k] = v;
        }
        const init = {
          method: request.method,
          headers: forwardHeaders
        };
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          init.body = await request.arrayBuffer();
        }
        const targetUrl = `https://stratus-ai-bot-gchat.internal${pathname}${url.search || ''}`;
        const resp = await env.MAIN_WORKER.fetch(new Request(targetUrl, init));
        // Pass through response with CORS headers added
        const respHeaders = new Headers(resp.headers);
        for (const [k, v] of Object.entries(CORS_HEADERS)) respHeaders.set(k, v);
        return new Response(resp.body, { status: resp.status, headers: respHeaders });
      } catch (err) {
        return jsonResponse({ error: 'gateway_passthrough_failed', path: pathname, detail: err.message }, 502);
      }
    }

    // Stats endpoint — quick glance at gateway_log table
    if (request.method === 'GET' && pathname === '/stats') {
      if (!env.ANALYTICS_DB) return jsonResponse({ error: 'analytics not configured' }, 500);
      try {
        const recent = await env.ANALYTICS_DB.prepare(
          'SELECT tier, COUNT(*) as count, AVG(total_ms) as avg_ms FROM gateway_log WHERE ts > datetime("now", "-24 hours") GROUP BY tier'
        ).all();
        const stalls = await env.ANALYTICS_DB.prepare(
          'SELECT stall_reason, COUNT(*) as count FROM gateway_log WHERE ts > datetime("now", "-24 hours") AND stall_reason != "" GROUP BY stall_reason'
        ).all();
        return jsonResponse({ window: '24h', tiers: recent.results, stalls: stalls.results });
      } catch (err) {
        return jsonResponse({ error: err.message }, 500);
      }
    }

    return jsonResponse({ error: 'not_found', path: pathname }, 404);
  }
};
