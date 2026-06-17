# Stratus AI Email Responder (POC)

AI sales assistant that responds to inbound email when Chris is OOO.

**Status:** Proof of concept. Hand off to Stratus dev for production hardening (see `HANDOFF.md`).

**Council review:** Claude (Cowork) + Codex co-designed. Architecture decisions recorded in `docs/ARCHITECTURE.md`. Codex pushback drove tightening of identity disclosure, classifier prompt, low-risk allowlist, loop guard, rate limits, and DRY_RUN default.

## What it does

Two ingestion paths, both via Gmail API (no Cloudflare Email Routing — Stratus MX stays on Google Workspace):

1. **Public alias `ai@stratusinfosystems.com`** — always on. Real Google Workspace mailbox. Bot replies as "Stratus AI Assistant".
2. **Chris's inbox (opt-in)** — gated by KV flag `ooo:chris`. Only acts when Chris flips the toggle. Bot replies as Chris with a mandatory `[Auto-reply via Stratus AI]` subject prefix and a loud disclosure banner at the top of every reply.

Both paths share the same processing pipeline. The bot:

1. Polls Gmail every 60s (POC) using a `historyId` cursor in KV
2. Dedupes by `(Gmail message id, RFC Message-ID, thread id)` triple
3. Runs loop guard against the full RFC header set (`Auto-Submitted`, `Precedence`, `List-Id`, `List-Unsubscribe`, `X-Auto-Response-Suppress`, NDR detection, internal sender match, etc.)
4. Matches sender to a Zoho Contact/Account using Codex's fail-closed ruleset
5. Classifies intent with a fresh email-specific prompt (not the Webex/SKU V2 classifier)
6. Risk-gates: only 4 intents auto-send. Everything else either drafts for review or sends an "I'm routing this to Jay" ack and CCs `jayf@stratusinfosystems.com`
7. Dispatches to a handler that calls the existing `stratus-ai-bot-gchat` worker for heavy lifting (CRM lookups, URL quote builds, etc.)
8. Composes the reply, runs voice + signature template, logs to D1 (`email_ai_audit`)
9. Sends via Gmail API using the existing gchat OAuth refresh token

## Modes

`SEND_MODE` env var (default `dry_run`):

- `dry_run` — classify, draft, log. **Never sends.** Use for POC bring-up.
- `draft_only` — creates Gmail drafts in the appropriate mailbox for human approval. Use for the first week of real traffic.
- `auto_send` — sends approved low-risk intents, drafts the rest. The "real" mode.

## Allowlist (only these auto-send in `auto_send` mode)

| Intent | Auto-send? | Notes |
|---|---|---|
| `url_quote` | Yes, with constraints | Only when SKU detection is unambiguous AND no pricing-exception language detected. Domain-only sender match OK if quote is generic; account-specific pricing requires exact Contact match. |
| `licensing_faq` | Yes | Answer must come from `src/kb/licensing-faq.json`. No free-form generation. |
| `order_status` | Yes, with constraints | Requires exact Contact match AND a specific reference token (SO#, PO#, quote#, tracking#) in the inbound body. Returns only `Status` + `Shipping_Tracking_Number`, never financial. |
| `routing_acknowledgment` | Yes | The "I'm Chris's AI, routing to Jay" reply. |
| `hardware_recommend` | **No** | Drafts only. Implies compatibility/licensing/contractual judgment. |
| `modify_order` | **No** | Always escalate to Jay. |
| `financial_legal` | **No** | Always escalate. |
| `unknown` / `low_confidence` (<0.75) | **No** | Always escalate. |

## Files

```
README.md                    This file
HANDOFF.md                   What the Stratus dev needs to finish (10-30%)
docs/
  ARCHITECTURE.md            Full architecture + Codex council notes
  VOICE-GUIDE.md             Email-adapted Chris voice rules
  IDENTITY-DECISIONS.md      Send-as identity rationale
wrangler.toml                Worker bindings
package.json                 npm scaffold
src/
  index.js                   fetch() handler + cron poller entry
  intake.js                  Gmail API polling + history cursor
  dedupe.js                  KV-based dedupe by id triple
  loop-guard.js              Header-based loop detection
  sender-match.js            Zoho Contact/Account matcher (fail-closed)
  classifier.js              Email-specific intent classifier (Llama 4 Scout)
  risk-gate.js               Allowlist + confidence threshold
  reply-builder.js           Voice + signature + disclosure banner
  sender.js                  Gmail send-as wrapper
  audit.js                   D1 audit log
  ooo-toggle.js              /api/ooo-toggle endpoint
  kill-switch.js             Global emergency stop
  handlers/
    url-quote.js
    licensing-faq.js
    order-status.js
    hardware-recommend.js    (draft-only)
    escalation.js
  kb/
    licensing-faq.json       Curated FAQ knowledge base seed
migrations/
  0001_email_ai_audit.sql    D1 schema for audit log
tests/
  smoke.sh                   curl smoke tests
  loop-guard.test.js         Loop guard test corpus
  fixtures/                  10 synthetic email samples
```

## Quick start (POC bring-up)

```bash
# 1. Apply D1 migration (run from gchat worker so binding matches)
wrangler d1 execute stratus-bot-analytics --file=migrations/0001_email_ai_audit.sql --remote

# 2. Set secrets (reuse gchat's Google + Zoho OAuth via secret-share or duplicate)
wrangler secret put GOOGLE_REFRESH_TOKEN
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GCHAT_INTERNAL_TOKEN     # API_KEY to call /api/chat-waterfall on gchat
wrangler secret put ADMIN_KEY                # gates /api/ooo-toggle and /api/kill-switch
wrangler secret put JAY_FLORENDO_EMAIL       # currently jayf@stratusinfosystems.com
wrangler secret put CHRIS_EMAIL              # chrisg@stratusinfosystems.com

# 3. Deploy in dry-run mode
SEND_MODE=dry_run wrangler deploy

# 4. Verify polling against test mailbox
curl https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/health

# 5. Trigger a test poll
curl -X POST https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/poll \
  -H "X-Admin-Key: $ADMIN_KEY"
```

## What's NOT included (dev finishes)

See `HANDOFF.md`. Short version:

- Google Workspace setup of `ai@stratusinfosystems.com` mailbox
- Send-as alias creation in Workspace for outbound `ai@` and OOO mode `chrisg@` send-as
- Optional Pub/Sub watch upgrade (POC uses polling)
- DKIM/SPF/DMARC verification for outbound
- Production GHA wire-up to existing stratus-bot-v2 deploy pipeline
- Dashboard toggle UI in `stratus-tasks-dashboard` (see `docs/DASHBOARD-TOGGLE.md`)

## Production burn risks (Codex flagged)

These are not addressed in POC. The dev must address before flipping `SEND_MODE=auto_send`:

1. Prompt injection in inbound email (mitigate: classifier output schema is strict, no free-form tool use; handler responses are templated)
2. OAuth refresh token concentration on one user account
3. Audit log retention + GDPR/data-protection review of CRM notes containing email bodies
4. Jay CC noise from looped escalations (mitigate: rate limit per Jay/day, dedupe by thread)
5. Gmail history cursor loss (mitigate: persist cursor + last-processed timestamp + reconciliation fallback)
