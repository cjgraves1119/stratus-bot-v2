# Dashboard Toggle — Wiring Spec

The OOO toggle UI lives in `stratus-tasks-dashboard`. POC doesn't ship dashboard changes; this doc is the spec for the dev (or for Chris to add later via Codex).

## Where it goes

`stratus-tasks-dashboard` already renders a settings drawer or could add one. Two new toggles:

1. **AI Email Responder — OOO Mode** (master switch)
2. **Watch My Inbox** (sub-toggle, only takes effect when OOO is on)

## API contract

Both toggles POST to the email responder worker:

```
POST https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/ooo-toggle
Headers:
  X-Admin-Key: <ADMIN_KEY>
  Content-Type: application/json

Body:
  { "ooo": "on" | "off", "watchInbox": "on" | "off" }

Response:
  { "ok": true, "ooo": "on", "watchInbox": "on", "sendMode": "draft_only",
    "note": null }
```

The `sendMode` returned in the response is informational — it reflects the current `SEND_MODE` env var on the worker (`dry_run` / `draft_only` / `auto_send`). The dashboard should show this so Chris always knows what mode it's in.

State endpoint (for dashboard to read on load):

```
GET https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/state
Headers:
  X-Admin-Key: <ADMIN_KEY>

Response:
  {
    "sendMode": "draft_only",
    "killSwitch": "off",
    "ooo": "on",
    "watchInbox": "on",
    "cursors": { "ai_alias": "12345", "chris_ooo": "12348" }
  }
```

## Dashboard UI sketch

```
┌─────────────────────────────────────────────────────────┐
│ AI Email Responder                                       │
│                                                          │
│ Status: ON · DRAFT-ONLY MODE                             │
│                                                          │
│ [X] Auto-reply via AI when I'm OOO                       │
│ [ ] Watch my inbox while OOO (chrisg@)                   │
│                                                          │
│ Bot is replying as: Stratus AI Assistant <ai@stratus...> │
│ ↓ when "Watch my inbox" is on, also as:                  │
│ Bot is replying as: Chris Graves <chrisg@...>            │
│   (with mandatory disclosure banner)                     │
│                                                          │
│ Today's activity: 12 received · 4 auto-sent · 2 drafts   │
│                · 3 escalated · 3 skipped (loop guard)    │
│                                                          │
│ [View audit log →] [Kill switch] [Send mode: draft_only ▼]│
└─────────────────────────────────────────────────────────┘
```

## Wiring in stratus-tasks-dashboard

Pseudocode for the dashboard's settings-panel handler:

```javascript
// In stratus-tasks-dashboard worker.js, add a new endpoint that proxies to
// the email responder worker. Don't expose ADMIN_KEY to the frontend.

if (url.pathname === "/api/email-responder/toggle" && req.method === "POST") {
  await requireAuth(req, env);  // dashboard's existing user auth
  const body = await req.json();
  const proxy = await fetch(
    "https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/ooo-toggle",
    {
      method: "POST",
      headers: {
        "X-Admin-Key": env.EMAIL_RESPONDER_ADMIN_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  return new Response(await proxy.text(), {
    status: proxy.status,
    headers: { "content-type": "application/json" },
  });
}
```

The dashboard worker holds the `EMAIL_RESPONDER_ADMIN_KEY` as its own secret. The browser never sees it.

## Activity counter

Dashboard reads `/api/audit?days=1` to compute today's counters. Simple aggregation:

```javascript
const audit = await fetch("...email-responder.../api/audit?days=1", { headers: { "X-Admin-Key": ... } });
const rows = await audit.json();
const counts = {
  received: rows.length,
  auto_sent: rows.filter(r => r.outcome === "sent" && r.decision_action === "auto_send").length,
  drafted: rows.filter(r => r.outcome === "drafted").length,
  escalated: rows.filter(r => r.decision_action === "escalate_to_jay").length,
  skipped: rows.filter(r => r.outcome === "skipped").length,
};
```

## Kill switch

Same pattern. Dashboard exposes a big red button:

```
POST /api/email-responder/kill
  → proxy to /api/kill-switch with { state: "on" }
```

And a green undo:

```
POST /api/email-responder/unkill
  → proxy to /api/kill-switch with { state: "off" }
```

## Send mode dropdown (Chris-only, advanced)

The `SEND_MODE` env var requires a `wrangler deploy` to change today. For a runtime-changeable mode, the dev should add:

```javascript
// In email responder src/index.js, replace
const mode = env.SEND_MODE || "dry_run";
// with
const mode = (await env.STATE_KV.get("send_mode_override")) || env.SEND_MODE || "dry_run";
```

Then expose `/api/send-mode` PUT endpoint. POC ships with env-var-only, deliberately, to avoid one more lever to forget.
