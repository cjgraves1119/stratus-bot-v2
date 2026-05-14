/**
 * Stratus AI Email Responder — entrypoint
 *
 * Two paths converge on the same pipeline:
 *   1. Public alias  ai@stratusinfosystems.com (always on)
 *   2. Chris's inbox (opt-in, gated by KV ooo:chris)
 *
 * Cron poll fires every minute, processes both paths if enabled.
 * fetch handler exposes admin endpoints and health.
 *
 * No HTTP-side receive of mail. Gmail API is the ingestion contract — there is
 * no inbound webhook from Workspace. Polling owns the cursor.
 */

import { pollMailbox } from "./intake.js";
import { processEnvelope } from "./pipeline.js";
import { handleOooToggle } from "./ooo-toggle.js";
import { handleKillSwitch } from "./kill-switch.js";
import { auditQuery } from "./audit.js";

const PATH_AI = "ai_alias";
const PATH_CHRIS = "chris_ooo";

export default {
  /* ─────────────────────────────── HTTP ─────────────────────────────── */
  async fetch(req, env, ctx) {
    const url = new URL(req.url);

    // Health (no auth)
    if (url.pathname === "/api/health") {
      return json({
        ok: true,
        worker: "stratus-ai-email-responder",
        sendMode: env.SEND_MODE,
        time: new Date().toISOString(),
      });
    }

    // All other endpoints require ADMIN_KEY
    const adminKey = req.headers.get("x-admin-key");
    if (!adminKey || adminKey !== env.ADMIN_KEY) {
      return json({ error: "unauthorized" }, 401);
    }

    if (url.pathname === "/api/ooo-toggle" && req.method === "POST") {
      return handleOooToggle(req, env);
    }
    if (url.pathname === "/api/kill-switch" && req.method === "POST") {
      return handleKillSwitch(req, env);
    }
    if (url.pathname === "/api/poll" && req.method === "POST") {
      const result = await runPoll(env, ctx);
      return json(result);
    }
    if (url.pathname === "/api/audit" && req.method === "GET") {
      return auditQuery(req, env);
    }
    if (url.pathname === "/api/state" && req.method === "GET") {
      return json(await readState(env));
    }
    return json({ error: "not_found" }, 404);
  },

  /* ─────────────────────────────── Cron ─────────────────────────────── */
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runPoll(env, ctx));
  },
};

/**
 * Single tick. Runs both ingestion paths if enabled.
 * Idempotent — safe to run more than once per minute.
 */
async function runPoll(env, ctx) {
  // Global kill switch trumps everything
  const killed = await env.STATE_KV.get("kill_switch:email_ai");
  if (killed === "on") {
    return { skipped: "kill_switch_on" };
  }

  const out = { paths: {}, time: new Date().toISOString() };

  // Path A: ai@ alias — always on (no toggle)
  out.paths[PATH_AI] = await runPath(env, ctx, PATH_AI);

  // Path B: Chris's inbox — gated
  const ooo = await env.STATE_KV.get("ooo:chris");
  const watchInbox = await env.STATE_KV.get("ooo:chris:watchInbox");
  if (ooo === "on" && watchInbox === "on") {
    out.paths[PATH_CHRIS] = await runPath(env, ctx, PATH_CHRIS);
  } else {
    out.paths[PATH_CHRIS] = { skipped: ooo === "on" ? "watch_off" : "ooo_off" };
  }

  return out;
}

async function runPath(env, ctx, path) {
  try {
    const envelopes = await pollMailbox(env, path);
    const results = [];
    for (const env_ of envelopes) {
      // Each envelope is processed sequentially within a path.
      // Don't parallelize: shared rate limits + state machine need ordering.
      const r = await processEnvelope(env, env_, path);
      results.push({ id: env_.gmailMessageId, outcome: r.outcome, intent: r.intent });
    }
    return { ok: true, count: envelopes.length, results };
  } catch (err) {
    console.error(`[${path}] poll failed: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

async function readState(env) {
  const [killSwitch, ooo, watch, cursorAi, cursorChris] = await Promise.all([
    env.STATE_KV.get("kill_switch:email_ai"),
    env.STATE_KV.get("ooo:chris"),
    env.STATE_KV.get("ooo:chris:watchInbox"),
    env.STATE_KV.get("cursor:" + PATH_AI),
    env.STATE_KV.get("cursor:" + PATH_CHRIS),
  ]);
  return {
    sendMode: env.SEND_MODE,
    killSwitch: killSwitch ?? "off",
    ooo: ooo ?? "off",
    watchInbox: watch ?? "off",
    cursors: {
      ai_alias: cursorAi,
      chris_ooo: cursorChris,
    },
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json" },
  });
}
