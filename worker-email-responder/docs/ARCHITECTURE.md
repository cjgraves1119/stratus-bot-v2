# Architecture

## Council protocol

This design was reviewed by Codex (`019e28a7-c43b-7840-94f5-26a946fb4feb`) in an adversarial pass. Codex's main pushback drove these changes from the original sketch:

1. No Cloudflare Email Routing for `stratusinfosystems.com` (would require moving MX off Google Workspace and break the entire company's mail). Both paths use Gmail API instead.
2. Polling instead of Pub/Sub for POC. Pub/Sub adds GCP infra burden; polling at 60s is enough for OOO use cases.
3. Identity disclosure made unmissable. Chris OOO mode reply prepends a top-of-body banner AND a `[Auto-reply via Stratus AI]` subject prefix. AI alias replies use display name "Stratus AI Assistant" so no one mistakes it for Chris.
4. Fresh email-specific classifier prompt. The Webex V2 SKU classifier won't generalize to messy email.
5. Narrowed auto-send allowlist. `hardware_recommend` is NOT low-risk — implies compatibility/licensing/contractual judgment, always drafts.
6. Full RFC loop-guard header set + signature-marker self-detection.
7. Rate limits at the floor: 1 thread/24h, 3 sender/day, 10 Jay CCs/day.
8. POC owns the plumbing. `dry_run` is the default mode. The dev does NOT inherit "make ingestion work" — POC ships with ingestion working end-to-end.
9. Sender-match policy is fail-closed (see "Sender match ruleset" below).

## High level

```
                        Google Workspace (existing MX, do not touch)
                                   │
        ┌──────────────────────────┴───────────────────────────┐
        │                                                       │
    ai@stratusinfosystems.com               chrisg@stratusinfosystems.com
    (always on, alias mailbox)              (Chris's real inbox)
        │                                                       │
        │   Gmail API watch + polling     Gmail API watch + polling
        │   (60s cron, history cursor)    (only when ooo:chris="on")
        │                                                       │
        └──────────────────────────┬───────────────────────────┘
                                   │
                  ┌────────────────▼───────────────┐
                  │ stratus-ai-email-responder     │
                  │  (this worker)                 │
                  │                                │
                  │  - dedupe (KV 7d)              │
                  │  - loop guard (RFC headers)    │
                  │  - rate limit (KV daily)       │
                  │  - sender match (calls gchat)  │
                  │  - classifier (Workers AI)     │
                  │  - risk gate                   │
                  │  - handler dispatch            │
                  │  - reply builder (voice + AI   │
                  │    signature + disclosure)     │
                  │  - send/draft via Gmail API    │
                  │  - audit -> D1                 │
                  └────────────────┬───────────────┘
                                   │ service binding
                                   ▼
                  ┌────────────────────────────────┐
                  │ stratus-ai-bot-gchat           │
                  │  (existing worker, unchanged)  │
                  │                                │
                  │  - /api/chat-waterfall         │
                  │    (Llama → Gemma → Claude     │
                  │     + 24 tools)                │
                  │  - /api/crm-* (Zoho)           │
                  │  - quote_url_build             │
                  │  - bot_pricing_quote           │
                  └────────────────────────────────┘
```

## Why a new worker (not extending gchat)

- **Smaller blast radius.** gchat is production-critical (24 CRM tools, ~17K LoC). Email autonomy is new territory.
- **Cleaner handoff.** The Stratus dev gets one folder, one repo path, one wrangler.toml. Doesn't need to read gchat's index.js (17K lines) to onboard.
- **Independent rollback.** Bad release on email responder doesn't take down GChat/Chrome ext/Gmail Add-on.
- **Different operational profile.** gchat is request-driven; this one is cron-driven. Different telemetry, different errors-care-about, different on-call cost.

Trade-off: extra service-binding hop for every CRM lookup. Acceptable — gchat is in the same account so latency is sub-ms.

## Sender match ruleset (fail-closed)

| Match level | What it means | Allowed intents |
|---|---|---|
| `exact_contact` | Sender email matches a Zoho Contact exactly | All low-risk intents |
| `single_account_domain` | Domain matches exactly one Zoho Account (and only one) | `licensing_faq`, `routing_acknowledgment`, generic `url_quote_generic` |
| `multi_domain` | Domain matches multiple Accounts (reseller, conglomerate) | **Escalate** — never disclose account-specific data |
| `free_email` | Domain is gmail/yahoo/etc. AND no exact Contact match | **Escalate** |
| `no_match` | Unknown sender on corporate domain with no Account | Allowed for generic `url_quote` URL only; no account-specific disclosure |

Special rules:
- `order_status` requires `exact_contact` AND a specific reference token (SO#/PO#/quote#/tracking#) in the inbound body. Sales Order must belong to the matched Contact's Account.
- `url_quote` with account-specific pricing requires `exact_contact`. Generic URL OK on domain match.

## Three SEND_MODE modes

| Mode | Behavior | Use case |
|---|---|---|
| `dry_run` | Classify, draft, log. Never sends. | POC bring-up, regression testing |
| `draft_only` | Creates Gmail drafts in the appropriate mailbox for human approval. | First week of real traffic — Chris reviews drafts on phone |
| `auto_send` | Sends approved low-risk intents (url_quote, licensing_faq, order_status, routing_ack). Drafts everything else. | Steady state |

## Loop guard checklist (every check Codex flagged)

The full set, implemented in `src/loop-guard.js`:

- `Auto-Submitted` header ≠ `no`
- `Precedence` ∈ {bulk, list, junk, auto_reply}
- `List-Id` present
- `List-Unsubscribe` present
- `X-Auto-Response-Suppress` present
- Sender pattern: `mailer-daemon@*`, `postmaster@*`, empty envelope
- `Return-Path: <>` + system sender
- Sender is our own automation (`ai@`, `noreply@`)
- Sender is internal Stratus domain
- `Content-Type` is `text/calendar`
- Attachments-only with no body
- Our AI signature marker token in body (already-replied detection)
- Jay already on `To`/`Cc` (don't pile on)
- Transactional sender pattern (`no-reply@`, `notifications@`, `alerts@`, `billing@`)
- Subject pattern (Out of Office, Delivery Failure, etc.)

Dedupe is separate (by `(gmail msg id, RFC Message-ID)` triple, 7-day TTL).

## Data flow per envelope

```
1. Gmail history.list → list of new message ids
2. messages.get(format=full) → raw Gmail message
3. parseEnvelope → normalized Envelope { fromEmail, subject, bodyText, ...headers }
4. checkAndMarkSeen → dedupe (KV)
5. shouldSkip → loop guard
6. checkRateLimit → KV daily counters
7. matchSender → Zoho lookup via gchat /api/crm-search
8. classifyEmail → Llama 4 Scout via Workers AI (fallback Claude via gchat gateway)
9. decideAction → risk gate (intent + match + extracted features)
10. Run handler (5 handlers, one per action)
11. buildReply → MIME + voice + signature + disclosure
12. sendOrDraft → Gmail API (mode-aware)
13. writeAudit → D1 email_ai_audit row
```

## Failure modes & recovery

| Failure | Detection | Recovery |
|---|---|---|
| Gmail history cursor expired (404) | `intake.js` catches "history not found" | Fallback to last-1h message list, dedupe via KV, reset cursor |
| Classifier error | Both Llama + Claude failed | Returns `{intent: "unknown", confidence: 0}` → escalates |
| gchat service binding unreachable | `fetch` throws | Handler returns escalation path |
| Gmail send 4xx (token expired, scope) | `sendOrDraft` returns `send_failed` | Audit logged with reason; admin investigates |
| KV write fails | Error logged, doesn't crash | Worst case: duplicate reply; rate limit catches |
| Worker hits 30s wall clock | Codex warned about gchat sub-call timeouts | gchat call is the slow path; falls back to escalation if no response in 25s |

## Cost envelope (estimate)

Assuming 200 emails/day at peak:
- Workers requests: 200 × 1 invocation + 1440 cron ticks = ~1650/day, well under free tier (100K/day on Paid plan included)
- Workers AI Llama 4 Scout: 200 × 1 classifier call ≈ $0.50/day at current pricing
- D1 writes: 200 × 1 audit row + ~200 KV writes = negligible
- KV: thousands of read/writes/day, no issue
- Anthropic fallback: only on classifier failure, ~$0.10/day budget

POC running cost: well under $5/month incremental on top of existing Cloudflare Paid plan.

## Open questions for the dev

1. **Send-as identity in Google Workspace for `chrisg@`** — does Chris want Gmail to mark the outbound as "via Stratus AI" in the From header (e.g. `Chris Graves (via Stratus AI) <chrisg@>`) or just rely on the body banner? Has UX implications.
2. **Pub/Sub watch vs polling for production** — POC is polling. Watch + Pub/Sub gives near-real-time but adds GCP infra. Decide before launch.
3. **Daily digest delivery** — POC doesn't ship this. Should it go to Chris via Gmail (email) or via Webex DM? Probably the latter.
4. **R2 archive of inbound bodies** — for audit/compliance, do we want to store full email bodies in R2 with 90-day retention? D1 audit only keeps a 200-char preview today.
5. **Domain authorization for `ai@`** — single-mailbox alias, or a Google Group with multiple Stratus humans on the same alias as backup readers?

## References

- Codex council thread: `019e28a7-c43b-7840-94f5-26a946fb4feb`
- Brain notebook: Bot Engineering Brain (`8d7f7d3c-0a85-4054-91a7-69434a6430f2`) — query "Stratus AI Email Responder" once POC canonical doc is pushed.
- Cloudflare Email Routing docs (rejected approach): https://developers.cloudflare.com/email-routing/get-started/enable-email-routing/
- Gmail push notifications (production path): https://developers.google.com/workspace/gmail/api/guides/push
- Google Workspace SPF (for outbound): https://knowledge.workspace.google.com/admin/security/set-up-spf
