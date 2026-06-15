# Corporate deploy configuration

This folder is the **corp-specific configuration reference** for deploying this repo to the
corporate Cloudflare account (`it-262`). The committed `wrangler.toml` in each worker targets the
**personal** account (`chrisg-ec1`); this doc is the exact set of overrides for corp.

> **Why a reference instead of `[env.corp]` blocks in the toml?** Wrangler named environments do
> **not** inherit `vars` or bindings from the top level — every binding must be repeated under
> `[env.corp]`, which doubles each toml and means every future binding change has to be mirrored.
> Two clean ways to apply the overrides below: (A) keep a corp-only copy of each `wrangler.toml`
> (CI deploys it with the corp token), or (B) add full `[env.corp]` sections and deploy with
> `wrangler deploy -e corp` (see the worked example at the bottom). Either way, the values to change
> are identical and listed here.

---

## 0. Pre-reqs (verify on the corp account BEFORE deploying)
- Corp Cloudflare account is on **Workers Paid** — Queues + Workflows require it; a free account
  fails to provision `stratus-gchat-crm-queue` and the two Workflows at deploy time.
- **Workers AI** and a **CF AI Gateway** are enabled (the gateway name is embedded in
  `ANTHROPIC_GATEWAY_URL` — create one and use its name).
- Corp has its **own** GCP project + Google Chat app, and its **own** Zoho self-client (see the
  control-plane notes in the migration handoff — sharing the personal ones makes Chat/Zoho a hard
  cutover, not a parallel run).
- Corp Webex bot identity (`GET https://webexapis.com/v1/people/me` with the corp token) is
  **different** from personal's before repointing any webhook.

## 1. Create the corp account-scoped resources (none are shareable across accounts)
```bash
# run with the corp CLOUDFLARE_API_TOKEN
wrangler d1 create stratus-bot-analytics            # → CORP_D1_ID
wrangler kv namespace create CONVERSATION_KV_WEBEX  # → CORP_KV_WEBEX  (replaces 360fbb8a… in worker/)
wrangler kv namespace create SHARED_KV              # → CORP_KV_SHARED (replaces af24db17… everywhere else)
wrangler r2 bucket create stratus-bot-storage
wrangler queues create stratus-gchat-crm-queue
wrangler queues create stratus-gchat-crm-dlq
# Analytics Engine dataset + both Workflows auto-create on first write/deploy.
# Create the AI Gateway in the dashboard; note its name for ANTHROPIC_GATEWAY_URL.
```
> **KV note:** the personal namespace `af24db17…` is reused for BOTH `CONVERSATION_KV` and
> `PRICES_KV` across gchat/gateway/tdsynnex and `PRICES_KV` in worker/. Create **one** corp namespace
> (`CORP_KV_SHARED`) and use its id for all of those slots. Only worker/`CONVERSATION_KV` (`360fbb8a…`)
> is a genuinely separate namespace → `CORP_KV_WEBEX`.

## 2. D1 schema (the base tables have NO DDL in the repo — do this BEFORE first traffic)
```bash
# Export schema from the PERSONAL D1, apply to the CORP D1. Without this, bot_usage/crm_operations/
# quote_history/sales_orders/prices don't exist on corp and every write silently no-ops.
wrangler d1 export stratus-bot-analytics --remote --no-data --output=schema.sql   # personal token
wrangler d1 execute <CORP_D1_ID> --remote --file=schema.sql                       # corp token
# then apply the dated files in ../migrations/ in order (CI does NOT run these)
```

## 3. Per-worker overrides (replace personal `ec1888c5a0b51dc3eebf6bae13a3922b` everywhere)

### worker/ (Webex — `stratus-ai-bot`)
| Key | Personal value | Corp value |
|---|---|---|
| `account_id` | `ec1888c5…3922b` | `<CORP_ACCOUNT_ID>` |
| `[vars] ANTHROPIC_GATEWAY_URL` | `…/v1/ec1888c5…/stratus-ai-bot/anthropic/v1/messages` | `…/v1/<CORP_ACCOUNT_ID>/<CORP_GATEWAY_NAME>/anthropic/v1/messages` |
| D1 `ANALYTICS_DB` id | `d4c3c112…` | `<CORP_D1_ID>` |
| KV `CONVERSATION_KV` id | `360fbb8a…` | `<CORP_KV_WEBEX>` |
| KV `PRICES_KV` id | `af24db17…` | `<CORP_KV_SHARED>` |
| R2 `BOT_STORAGE` | `stratus-bot-storage` | same name, corp bucket |
**Secrets:** `WEBEX_BOT_TOKEN` (corp bot), `ANTHROPIC_API_KEY`. Do **not** set `CF_QUOTE_V3_ENABLED`.

### worker-gchat/ (Google Chat + extension backend — `stratus-ai-bot-gchat`)
| Key | Personal value | Corp value |
|---|---|---|
| `account_id` | `ec1888c5…` | `<CORP_ACCOUNT_ID>` |
| `[vars] ANTHROPIC_GATEWAY_URL` | personal gateway | corp gateway URL |
| `[vars] SYSTEM_OWNER_ID` | `2570562000141711002` (Chris) | `<CORP_ZOHO_USER_ID>` |
| `[vars] SYSTEM_OWNER_EMAIL` | `chrisg@…` | corp operator email |
| `[vars] SYSTEM_OWNER_NAME` | `Chris Graves` | corp operator name |
| `[vars] PRICE_CRON_NOTIFY_EMAIL` | `chrisg@…` | corp ops distro |
| both `[[workflows]] account_id` | `ec1888c5…` | `<CORP_ACCOUNT_ID>` |
| D1 `ANALYTICS_DB` id | `d4c3c112…` | `<CORP_D1_ID>` |
| KV `CONVERSATION_KV` + `PRICES_KV` ids | `af24db17…` | `<CORP_KV_SHARED>` (both) |
| Queues / R2 | same names | corp resources |
**New `[vars]` to ADD on corp (defaults are unsafe — see §4):**
```
BOT_ADDRESS_GUARD_ENABLED = "true"
JWT_VERIFY_ENFORCE        = "true"
PRICE_CRON_READONLY       = "true"   # corp should NOT own the shared prices.json commit (see §5)
```
**Secrets:** `ANTHROPIC_API_KEY`, `ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN`, `GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN`,
`GCP_SERVICE_ACCOUNT_KEY`, `GOOGLE_PROJECT_NUMBER`, `GMAIL_ADDON_API_KEY`, `GATEWAY_INTERNAL_SECRET`
(must match gateway), and **only** set `GITHUB_PAT` if corp needs GitHub-write features (not required
for the price cron — see §5). Do **not** set `CF_QUOTE_V3_ENABLED`.

### worker-gateway/ (`stratus-ai-bot-gateway`)
Change `account_id`; KV `CONVERSATION_KV` id → `<CORP_KV_SHARED>`; D1 id → `<CORP_D1_ID>`.
**Secrets:** `GATEWAY_API_KEY`, `GATEWAY_INTERNAL_SECRET` (must match gchat).
> The exported constant `worker-gateway/src/index.js` `API_BASE` (`chrisg-ec1`) is the **extension's**
> default base, not a worker setting — override it at **extension build** with `STRATUS_API_BASE`, not here.

### worker-tdsynnex/ (`stratus-tdsynnex-pricing`)
Has **no** `account_id` line (inherits the deploy token's account — good). Re-point **D1 id → `<CORP_D1_ID>`**
and **PRICES_KV id → `<CORP_KV_SHARED>`** (today it reuses the personal ids). Verify `QUALIFIER = "MG"` is
correct for corp's TD SYNNEX account. **Secret:** `TDSYNNEX_AUTH_TOKEN` (corp's).

## 4. Flags whose DEFAULT is UNSAFE on a fresh deploy — set explicitly on corp
| Flag | Set | If left default |
|---|---|---|
| `ANTHROPIC_GATEWAY_URL` | corp gateway | falls back to the **personal** gateway literal → corp Claude bills/caches through Chris's account |
| `BOT_ADDRESS_GUARD_ENABLED` | `"true"` | quote billing/shipping guard (#147) is OFF → blank/mismatched address bug returns |
| `JWT_VERIFY_ENFORCE` | `"true"` | Google Chat webhook JWT failures are logged but **accepted** |
| `CF_QUOTE_V3_ENABLED` | **unset** | keeps corp on the stable quoting path (V3 is personal-only testing) |
| `PRICE_CRON_READONLY` | `"true"` | (see §5) corp's cron would try to commit to the shared price book |

## 5. The price cron (`scheduled()`)
Phase 1 only **reads** Zoho WooProducts (GET) and writes **per-account KV** (safe). The cron's only
shared write is the **Phase-5 GitHub commit** to `prices.json`. Exactly one deployment should own that.
On corp set **`PRICE_CRON_READONLY="true"`** — corp's cron still populates its own `prices_live` KV but
skips the commit. (`PRICE_CRON_REPO` can also retarget the commit repo if corp ever wants to own it.)

## 6. Deploy order + cutover
Deploy **gchat first** (it's the service-binding target for the gateway and itself), then gateway,
worker, tdsynnex. The full cutover is **atomic** (both deployments write the same live Zoho CRM, Gmail,
price book, Anthropic key) — see the migration handoff doc for the freeze-personal → repoint-all-surfaces
sequence. Do not run personal and corp simultaneously on writes.

## 7. Post-deploy validation
`SELECT 1 FROM bot_usage` on corp D1 succeeds · corp Webex DM returns a quote and logs to **corp** D1 ·
extension corp build hits `it-262` and a personal key returns 401 · a test quote auto-fills billing AND
shipping · corp Claude traffic appears in the **corp** AI Gateway · `CF_QUOTE_V3_ENABLED` unset.

---

## Appendix — worked `[env.corp]` example (worker-gchat, option B)
If you prefer `wrangler deploy -e corp`, every binding must be repeated under `[env.corp]` (named envs
do not inherit vars/bindings). Replicate this pattern for the other three workers.
```toml
[env.corp]
name = "stratus-ai-bot-gchat"          # keep the base name (different account → no collision)
account_id = "<CORP_ACCOUNT_ID>"

[env.corp.vars]
USE_DEEPSEEK_TIER_3 = "false"
USE_DEEPSEEK_ADVISORY = "false"
QUOTE_PO_WORKFLOW_ENABLED = "true"
BOT_ADDRESS_GUARD_ENABLED = "true"
JWT_VERIFY_ENFORCE = "true"
PRICE_CRON_READONLY = "true"
SYSTEM_OWNER_ID = "<CORP_ZOHO_USER_ID>"
SYSTEM_OWNER_EMAIL = "<corp-operator-email>"
SYSTEM_OWNER_NAME = "<Corp Operator>"
PRICE_CRON_NOTIFY_EMAIL = "<corp-ops-distro>"
ANTHROPIC_GATEWAY_URL = "https://gateway.ai.cloudflare.com/v1/<CORP_ACCOUNT_ID>/<CORP_GATEWAY_NAME>/anthropic/v1/messages"

[[env.corp.kv_namespaces]]
binding = "CONVERSATION_KV"
id = "<CORP_KV_SHARED>"
[[env.corp.kv_namespaces]]
binding = "PRICES_KV"
id = "<CORP_KV_SHARED>"

[[env.corp.d1_databases]]
binding = "ANALYTICS_DB"
database_name = "stratus-bot-analytics"
database_id = "<CORP_D1_ID>"
migrations_dir = "../migrations"

[[env.corp.services]]
binding = "SELF"
service = "stratus-ai-bot-gchat"

[[env.corp.queues.producers]]
queue = "stratus-gchat-crm-queue"
binding = "CRM_QUEUE"
[[env.corp.queues.consumers]]
queue = "stratus-gchat-crm-queue"
max_batch_size = 1
max_retries = 3
max_batch_timeout = 30
retry_delay = 30
dead_letter_queue = "stratus-gchat-crm-dlq"

[env.corp.ai]
binding = "AI"

[env.corp.triggers]
crons = ["0 11 * * *"]

[[env.corp.workflows]]
name = "stratus-gchat-crm-workflow"
account_id = "<CORP_ACCOUNT_ID>"
binding = "CRM_WORKFLOW"
class_name = "CrmWorkflow"
[[env.corp.workflows]]
name = "stratus-gchat-quote-po-workflow"
account_id = "<CORP_ACCOUNT_ID>"
binding = "QUOTE_PO_WORKFLOW"
class_name = "QuotePoWorkflow"

[[env.corp.analytics_engine_datasets]]
binding = "BOT_METRICS"
dataset = "stratus_bot_metrics"

[[env.corp.r2_buckets]]
binding = "BOT_STORAGE"
bucket_name = "stratus-bot-storage"
```
