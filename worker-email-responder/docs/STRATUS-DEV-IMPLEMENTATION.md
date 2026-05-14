# Stratus AI Email Responder — Implementation Guide

**Purpose:** Hand off a working POC to a Stratus developer who will finish the production wiring under Stratus's accounts (Google Workspace, Cloudflare org, DNS).

**Branch / PR:** `feat/email-responder-poc` — [PR #80](https://github.com/cjgraves1119/stratus-bot-v2/pull/80)

**Council audit:** Codex thread `019e28a7-c43b-7840-94f5-26a946fb4feb`. Architecture decisions, rejected alternatives, and Codex's pushback are recorded in `worker-email-responder/docs/ARCHITECTURE.md`.

## Status

The worker is **already deployed and live** in Chris's personal Cloudflare account (`ec1888c5a0b51dc3eebf6bae13a3922b`) under `https://stratus-ai-email-responder.chrisg-ec1.workers.dev/`. It is running in `SEND_MODE=dry_run`, which means it will classify, draft, and log every inbound email but **never send anything**. Nothing will actually reach a customer until you complete the steps below AND change `SEND_MODE` to `auto_send`.

Verified working:
- Health endpoint returns `{ ok: true, sendMode: "dry_run" }`
- `/api/state` returns full state shape with `ADMIN_KEY` auth
- `/api/ooo-toggle` flips KV state correctly
- `/api/poll` and `/api/audit` reachable (won't fire until Gmail OAuth is wired)
- Chrome extension OOO toggle UI added to Options page

Verified working at the infrastructure layer in **Chris's** Cloudflare account. **You will need to replicate the infra under Stratus's org account** (`262c72fed2f9afbdde835af45c5dcd0c`).

## Architecture quick reference

| Component | Where it lives | What it does |
|---|---|---|
| `stratus-ai-email-responder` worker | New CF worker | Polls Gmail every 60s, classifies intent, sends/drafts replies |
| `stratus-email-responder-STATE_KV` | KV namespace | OOO flag, kill switch, dedupe, history cursor, rate limits |
| `email_ai_audit` | D1 table on `stratus-bot-analytics` | One row per envelope processed |
| `/api/email-responder/*` proxy | Added to `worker-gchat` | Chrome ext talks here; gchat forwards with ADMIN_KEY |
| Chrome ext `OptionsPage` | New section | Master OOO toggle + watch-inbox sub-toggle + kill switch |

Two ingestion paths:

- **`ai@stratusinfosystems.com`** — public alias, always on, replies as "Stratus AI Assistant"
- **`chrisg@stratusinfosystems.com`** — opt-in, only acts when KV `ooo:chris` AND `ooo:chris:watchInbox` are both `on`. Replies AS Chris with mandatory `[Auto-reply via Stratus AI]` subject prefix and unmissable disclosure banner.

## Implementation checklist for Stratus dev

### Phase 1 — Google Workspace setup (~1 hour)

1. **Create `ai@stratusinfosystems.com` mailbox** (Google Workspace Admin):
   - Recommend: dedicated user (not a group). $6/mo seat. Simpler permissions, cleaner OAuth.
   - Set display name: `Stratus AI Assistant`
   - Set forwarding rule: none. Mail stays in the mailbox.

2. **Decide OAuth model:**
   - **Easiest for POC**: per-user OAuth. Run the OAuth flow once from `ai@` and once from `chrisg@`. Two refresh tokens, two secrets.
   - **Production**: Domain-Wide Delegation. Service account JSON, no user-driven consent. Required if you want to support multiple sales reps with their own OOO mode without re-running OAuth flows for each one.

3. **Create OAuth client** (Google Cloud Console, project `swift-catfish-474413-d5` if reusing the existing gchat project, or a new project under Stratus's CF org):
   - OAuth 2.0 Client ID, type "Desktop app" (for the manual flow) or "Web app" (for a hosted flow)
   - Authorized scopes: `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.compose`, `https://www.googleapis.com/auth/gmail.send`
   - Add `ai@stratusinfosystems.com` and `chrisg@stratusinfosystems.com` as test users (if app is in testing mode) OR publish to internal users (if Workspace org is Stratus).

4. **Get refresh tokens.** Two ways:

   **Manual one-shot script (recommended for POC):**
   ```bash
   # From any machine with node:
   npx @google-cloud/oauth2-cli --client-id $CLIENT_ID --client-secret $CLIENT_SECRET \
     --scope "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.compose https://www.googleapis.com/auth/gmail.send" \
     --output refresh-token.txt
   # Browser opens; sign in as ai@. Token is saved to refresh-token.txt.
   # Repeat signing in as chrisg@ for the second token.
   ```

   **Or use the existing gchat OAuth.** The gchat worker already has `GOOGLE_REFRESH_TOKEN` for one mailbox. You can issue a new token from the same client for `ai@` without changing scopes.

### Phase 2 — Cloudflare setup under Stratus org (~30 minutes)

The POC lives in Chris's personal account. Move it to Stratus's:

1. **Pin the account** in `worker-email-responder/wrangler.toml`:
   ```toml
   account_id = "262c72fed2f9afbdde835af45c5dcd0c"  # Stratus org, not Chris's personal
   ```

2. **Create the KV namespace under Stratus org:**
   ```bash
   wrangler kv namespace create STATE_KV
   # Copy the new id into worker-email-responder/wrangler.toml
   ```
   (The POC currently references KV id `45d01f4b96104f8a8e1184a37864119d` which is in Chris's account — replace this.)

3. **Apply D1 migration to Stratus's analytics DB:**
   - If Stratus already has a `stratus-bot-analytics` D1 database, reuse it.
   - Otherwise create one: `wrangler d1 create stratus-bot-analytics`
   - Update `database_id` in `worker-email-responder/wrangler.toml`
   - Run the migration: `wrangler d1 execute stratus-bot-analytics --file=worker-email-responder/migrations/0001_email_ai_audit.sql --remote`

4. **Set all 6 secrets via wrangler:**
   ```bash
   cd worker-email-responder
   wrangler secret put GOOGLE_CLIENT_ID
   wrangler secret put GOOGLE_CLIENT_SECRET
   wrangler secret put GOOGLE_REFRESH_TOKEN_AI       # from ai@ OAuth flow
   wrangler secret put GOOGLE_REFRESH_TOKEN_CHRIS    # from chrisg@ OAuth flow
   wrangler secret put GCHAT_INTERNAL_TOKEN          # the API_KEY for the gchat worker; can reuse GMAIL_ADDON_API_KEY
   wrangler secret put ADMIN_KEY                     # generate fresh: openssl rand -hex 32
   ```

5. **Set the matching secret on the gchat worker** so the chrome ext proxy works:
   ```bash
   cd ../worker-gchat
   wrangler secret put EMAIL_RESPONDER_ADMIN_KEY     # same value as ADMIN_KEY above
   ```

6. **Deploy:**
   ```bash
   cd ../worker-email-responder
   wrangler deploy
   # Then redeploy gchat with the new EMAIL_RESPONDER_ADMIN_KEY secret:
   cd ../worker-gchat
   wrangler deploy
   ```

### Phase 3 — Validation in dry_run mode (~3 days)

1. **Send 5-10 test emails to `ai@stratusinfosystems.com`** covering each intent:
   - "Pricing on 10 MR46 with 3yr licenses?" → `url_quote` → should auto-classify, not send
   - "How do I claim a Meraki license?" → `licensing_faq` → should match KB
   - "Status on PO 12345?" → `order_status` → should look up by reference token
   - "Can we get 25% off?" → `financial_legal` → should escalate to Jay
   - "We need a wireless solution for our new office" → `hardware_recommend` → should draft only
   - "Out of Office: Re: ..." (auto-reply) → should be SKIPPED by loop guard

2. **Verify D1 rows:**
   ```bash
   wrangler d1 execute stratus-bot-analytics --remote --command \
     "SELECT ts, path, intent, confidence, decision_action, outcome FROM email_ai_audit ORDER BY ts DESC LIMIT 20"
   ```
   Every test email should have a row. Intents and decisions should match expectations.

3. **Verify cron is running:**
   ```bash
   wrangler tail stratus-ai-email-responder
   # Then send a test email. Within 60s you should see "[ai_alias] poll" logs.
   ```

### Phase 4 — Flip to `draft_only` (~1 week)

When you're satisfied dry_run is classifying correctly:

```bash
# Update the SEND_MODE var in wrangler.toml from "dry_run" to "draft_only"
sed -i 's/SEND_MODE = "dry_run"/SEND_MODE = "draft_only"/' worker-email-responder/wrangler.toml
cd worker-email-responder && wrangler deploy
```

Now real Gmail drafts are created in the `ai@` mailbox for every inbound that would have been auto-sent. Chris (or whoever) reviews the drafts on phone, hits send. Run for a week.

### Phase 5 — Flip to `auto_send` (production)

```bash
sed -i 's/SEND_MODE = "draft_only"/SEND_MODE = "auto_send"/' worker-email-responder/wrangler.toml
cd worker-email-responder && wrangler deploy
```

Now the bot actually sends low-risk replies. Everything else still drafts or escalates. Monitor:
- Audit log: `wrangler d1 execute stratus-bot-analytics --remote --command "SELECT outcome, COUNT(*) FROM email_ai_audit WHERE ts > datetime('now', '-1 day') GROUP BY outcome"`
- Chrome extension's OOO toggle banner shows current mode

## How Chris uses it day-to-day

1. **Open extension Options page** → "AI Email Responder (OOO Mode)" section
2. **Master toggle**: "OOO mode (ai@ alias)" — always available, even when Chris is in the office. When ON, the bot replies to anything landing at `ai@stratusinfosystems.com` as "Stratus AI Assistant".
3. **Sub-toggle**: "Watch my inbox (chrisg@)" — only takes effect when master is on. When ON, the bot watches Chris's inbox too and replies as Chris with disclosure banner.
4. **Emergency stop**: Big red button. Kills all responder activity until turned off. Persistent across reloads.
5. **Mode badge**: Shows current `SEND_MODE` (DRY RUN / DRAFT-ONLY / AUTO-SEND). Mode is changed via wrangler deploy, not the UI — deliberately to avoid one more lever to forget.

## Production burn risks (Codex flagged)

Read before flipping `auto_send`:

1. **OAuth refresh token concentration** — one revoke and the bot dies. Plan: schedule quarterly rotation reminders.
2. **Prompt injection in inbound email** — mitigated by strict classifier output schema. Don't relax.
3. **Audit log retention** — `reply_preview` is 200 chars. Decide GDPR retention.
4. **Jay CC noise loops** — daily cap of 10 CCs/day already implemented. Monitor weekly.
5. **Gmail history cursor loss >7d** — fallback to recent-messages list handles this with a one-time catchup spike.
6. **Identity disclosure** — current pattern uses `Chris Graves <chrisg@>` From + `[Auto-reply via Stratus AI]` subject prefix + top banner. If legal review wants stricter (e.g., Gmail "via" header pattern), one-line change in `src/reply-builder.js`.

## Useful endpoints reference

All admin endpoints require `X-Admin-Key: <ADMIN_KEY>` header.

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/health` | GET | No auth. Returns worker liveness + current `sendMode`. |
| `/api/state` | GET | Full state: send mode, kill switch, OOO flags, cursors |
| `/api/ooo-toggle` | POST | Body `{ooo,watchInbox}` |
| `/api/kill-switch` | POST | Body `{state}` |
| `/api/poll` | POST | Force a poll tick |
| `/api/audit?days=N&limit=N` | GET | Recent audit rows |

Chrome extension proxy on gchat (gated by `X-API-Key`):

- `POST /api/email-responder/state`
- `POST /api/email-responder/toggle`
- `POST /api/email-responder/kill`
- `POST /api/email-responder/poll`

## Reference files in repo

```
worker-email-responder/
├── README.md                          ← start here
├── HANDOFF.md                         ← original dev handoff
├── wrangler.toml
├── package.json
├── migrations/0001_email_ai_audit.sql
├── docs/
│   ├── ARCHITECTURE.md                ← council protocol + decisions
│   ├── VOICE-GUIDE.md                 ← Chris voice for email
│   ├── IDENTITY-DECISIONS.md          ← send-as rationale
│   └── DASHBOARD-TOGGLE.md            ← (stretch — not built; chrome ext was wired instead)
├── src/                               ← 18 files, ~1836 LoC
└── tests/
    ├── loop-guard.test.js             ← 10/10 PASS
    └── fixtures/*.json                ← 10 synthetic envelopes
```

```
chrome-extension/src/
├── options/EmailResponderToggle.jsx   ← new component
├── options/OptionsPage.jsx            ← +import + section render
├── background/index.js                ← +4 MSG handlers
├── background/api-client.js           ← +4 helper fns
└── lib/constants.js                   ← +4 MSG types

worker-gchat/src/index.js              ← +/api/email-responder/* proxy (1 case block)
.github/workflows/deploy.yml           ← +deploy-email-responder job
```

## Rollback

If anything goes wrong:

1. **Immediate halt:** chrome ext kill switch (or `curl POST /api/kill-switch -d '{"state":"on"}'`)
2. **Revert deploy:** `git revert <commit>` and push; GHA redeploys without the worker
3. **Remove worker entirely:** `wrangler delete stratus-ai-email-responder`
4. **Keep audit log for postmortem.** Don't drop the `email_ai_audit` table.

## Contact

- Council thread for re-review: Codex `019e28a7-c43b-7840-94f5-26a946fb4feb`
- Brain notebook (Cloudflare ops + bot infra): `8d7f7d3c-0a85-4054-91a7-69434a6430f2`
- The canonical Brain entry for this worker was pushed 2026-05-14 and titled "Stratus AI Email Responder — Canonical Reference (POC, 2026-05-14)"
