# Handoff to Stratus Developer

This POC ships ~80% complete. What's working, what you finish, and how to ship.

## What's working (POC scope)

1. **Worker scaffolding** — full module split, no monolithic `index.js`
2. **Gmail polling ingestion** — historyId cursor + fallback to recent-messages on cursor expiry
3. **Loop guard** — all RFC header checks, dedupe, signature marker self-detection
4. **Sender match** — Zoho Contact/Account lookup with fail-closed ruleset
5. **Email-specific classifier** — Llama 4 Scout primary, Claude fallback, strict schema
6. **Risk gate** — narrowed auto-send allowlist (Codex council-approved)
7. **5 handlers** — `url_quote`, `licensing_faq`, `order_status`, `escalation`, `draft_only`
8. **Reply builder** — voice + signature + AI disclosure (banner for Chris OOO path)
9. **Gmail send/draft** — full MIME, 3 SEND_MODE modes (dry_run/draft_only/auto_send)
10. **D1 audit log** — every envelope produces a row
11. **OOO toggle + kill switch** — admin API + KV state
12. **Test corpus** — 10 synthetic envelope fixtures + loop-guard unit tests
13. **Smoke tests** — `tests/smoke.sh` runs against deployed worker
14. **Docs** — architecture, voice guide, identity decisions, dashboard wiring

## What you finish (production gap)

### 1. Google Workspace setup (~1 day)

- [ ] Create `ai@stratusinfosystems.com` as a real Google Workspace mailbox (not just an alias on Chris)
  - Decide: dedicated user license vs Google Group with multiple readers
  - Recommend: dedicated user, ~$6/mo, simpler permissions
- [ ] Verify Workspace admin has API access enabled
- [ ] Create OAuth client (or reuse existing gchat client if scopes match)
  - Required scopes: `gmail.readonly` + `gmail.compose` + `gmail.send`
- [ ] Run OAuth flow once from `ai@` mailbox → get refresh token → set as `GOOGLE_REFRESH_TOKEN_AI` secret
- [ ] Run OAuth flow once from `chrisg@` mailbox → get refresh token → set as `GOOGLE_REFRESH_TOKEN_CHRIS` secret
- [ ] Verify SPF includes `_spf.google.com` already (it does; check anyway). DKIM/DMARC: Google handles since Gmail sends.

### 2. Cloudflare secrets + KV (~30 min)

```bash
cd stratus-ai-email-responder

# Create the KV namespace, replace ID in wrangler.toml
wrangler kv namespace create STATE_KV
# → copy the id into wrangler.toml [[kv_namespaces]] section

# Set secrets
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put GOOGLE_REFRESH_TOKEN_AI
wrangler secret put GOOGLE_REFRESH_TOKEN_CHRIS
wrangler secret put GCHAT_INTERNAL_TOKEN     # the API_KEY value from gchat worker
wrangler secret put ADMIN_KEY                # generate a fresh random string
```

### 3. D1 migration (~1 min)

```bash
# From the email-responder directory (uses the shared analytics DB)
wrangler d1 execute stratus-bot-analytics --file=migrations/0001_email_ai_audit.sql --remote
```

### 4. First deploy in dry-run mode (~5 min)

```bash
wrangler deploy
# Verify
curl https://stratus-ai-email-responder.chrisg-ec1.workers.dev/api/health
# Should return { ok: true, sendMode: "dry_run", ... }

# Smoke tests
WORKER_URL=https://stratus-ai-email-responder.chrisg-ec1.workers.dev \
ADMIN_KEY=<your_admin_key> \
bash tests/smoke.sh
```

### 5. Bring up real traffic

Run for at least 3 days in `dry_run` while sending test emails. Inspect the D1 audit log:

```bash
wrangler d1 execute stratus-bot-analytics --remote \
  --command "SELECT ts, path, intent, confidence, decision_action, outcome FROM email_ai_audit ORDER BY ts DESC LIMIT 50"
```

When intents + decisions look right, flip to `draft_only`:

```bash
wrangler deploy --var SEND_MODE:draft_only
```

Chris reviews drafts on his phone for a week. Then `auto_send`.

### 6. Dashboard toggle UI (~2-4 hours)

See `docs/DASHBOARD-TOGGLE.md` for the full spec. Add 1 endpoint + 1 settings card to `stratus-tasks-dashboard`.

### 7. GHA wire-up (~1 hour)

Add the new worker to `.github/workflows/deploy-stratus-bots.yml` in the `stratus-bot-v2` repo:

```yaml
- name: Deploy email-responder
  run: |
    cd stratus-ai-email-responder
    npx wrangler deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
```

Optional: only deploy on changes to `stratus-ai-email-responder/**` (path filter).

## Stretch goals (post-launch)

- [ ] Replace Gmail polling with Pub/Sub watch (real-time, but adds GCP infra)
- [ ] Daily digest to Chris via Webex DM at 6 PM with all auto-sends that day
- [ ] R2 archive of inbound bodies + outbound replies for compliance (90-day retention)
- [ ] Per-customer reply-style learning (build prompts from prior thread voice)
- [ ] Inline thread context (read last 2-3 messages in the thread, not just current one)
- [ ] Web UI for managing the KB (`src/kb/licensing-faq.json`) without a deploy
- [ ] Slackbot version (different alias, different channel)

## Things to NOT do without re-running council

These changes have safety/legal implications. If you want them, re-trigger the council protocol (Claude + Codex review):

- Send-as Chris from the `ai@` mailbox (mix the two paths)
- Remove the subject prefix `[Auto-reply via Stratus AI]` from Chris's OOO mode replies
- Auto-send for `hardware_recommend` intent
- Auto-send for `financial_legal` intent
- Lower the classifier confidence floor below 0.75
- Raise rate limits above 1 thread/24h or 3 sender/day
- Remove BCC Chris from his own OOO mode replies

## Production burn risks (Codex flagged)

Read these before flipping `auto_send`:

1. **OAuth refresh token concentration** — one revoke and the bot dies. Plan: schedule rotation reminder, consider a backup refresh token for `ai@`.
2. **Prompt injection in inbound email** — mitigated by strict classifier output schema. Don't relax that.
3. **Audit log retention** — D1 row contains `reply_preview` (200 chars). Decide a retention policy + GDPR-style erasure path.
4. **Jay CC noise loops** — if Jay's mailbox starts looking like a CC firehose, the bot has misclassified something. Daily-cap Jay CCs at 10 (already implemented in `rate-limit.js`) and watch the audit.
5. **Gmail history cursor loss** — if the worker is down >7 days, cursor expires. Fallback to recent-messages list handles this, but you'll get a brief catchup spike — expected.

## Contact for council review

Architecture decisions and adversarial review tracked under Codex thread `019e28a7-c43b-7840-94f5-26a946fb4feb`. To continue, run the `codex-cowork-bridge-v1-0` skill in this repo's working dir.

Brain notebook ID (Cloudflare-side context): `8d7f7d3c-0a85-4054-91a7-69434a6430f2` (Bot Engineering Brain). After deploy, push a canonical reference doc for this worker as a new source.
