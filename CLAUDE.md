# CLAUDE.md

Guidance for AI assistants (Claude Code and others) working in this repository.

## What this is

**stratus-bot-v2** is the codebase for **Stratus AI** — a Claude-powered sales
assistant for quoting Cisco/Meraki networking products and working with Zoho
CRM. It is a multi-component monorepo: the same quoting engine is surfaced
through a Webex bot, a Google Chat bot, a Chrome extension, and a (legacy)
Gmail add-on.

The core quoting flow turns a natural-language request ("quote 5 MR46") into
Stratus order URLs of the form:

```
https://stratusinfosystems.com/order/?item={SKU1},{SKU2}&qty={qty1},{qty2}
```

Quoting is **deterministic first** (a JSON catalog parser), with Claude used
as a fallback for requests the parser cannot resolve, and for agentic CRM /
email work.

## Repository layout

| Path | What it is | Runtime |
|---|---|---|
| `index.js` + `data/` | **Legacy** Express/Node Webex bot (the original). `node index.js`. | Node 18+ |
| `worker/` | **Production Webex bot** — `stratus-ai-bot`. | Cloudflare Workers |
| `worker-gchat/` | **Production Google Chat bot** — `stratus-ai-bot-gchat`. Largest, most feature-rich worker; also serves the `/api/*` backend for the Chrome extension and Gmail add-on. | Cloudflare Workers |
| `worker-gateway/` | Thin routing worker — `stratus-ai-bot-gateway`. Gemma-first → Claude-fallback waterfall; delegates to `worker-gchat` via service binding. | Cloudflare Workers |
| `chrome-extension/` | Manifest V3 Chrome extension (React + webpack). Gmail sidebar / CRM assistant. Replaces `gmail-addon/`. | Chromium |
| `gmail-addon/` | **Legacy** Google Apps Script Gmail add-on (`clasp`). Being replaced by `chrome-extension/`. | Apps Script |
| `migrations/` | D1 SQL migrations. Shared by `worker` and `worker-gchat` (both reference `migrations_dir = "../migrations"`). | Cloudflare D1 |
| `test-harness/` | Live eval runner against the deployed endpoints. See `LIVE_EVALS.md`. | Node |
| `tests/vision-compare/` | Vision-model comparison script. | Node |
| `docs/` | Implementation plans / design notes. | — |
| `test.js` | Test suite for the legacy root `index.js`. | Node |
| `benchmark-3variant.js` | Classifier benchmark across model variants. | Node |
| `sync-engine.sh` | Keeps shared data files (and checks function signatures) in sync between `worker/` and `worker-gchat/`. | Bash |

### Which Webex code is live?

`worker/src/index.js` is the deployed Webex bot. The root `index.js` is the
original Express version it was ported from — keep it in mind for history, but
new Webex work generally belongs in `worker/`.

## Cloudflare architecture

All three workers live in **one** Cloudflare account
(`ec1888c5a0b51dc3eebf6bae13a3922b`) and share infrastructure:

- **D1** `stratus-bot-analytics` — quote history, usage analytics, CRM op log,
  pricing history, eval telemetry. Bound as `ANALYTICS_DB` in all three.
- **KV** namespace `af24db17...` — used for both `CONVERSATION_KV` (chat
  history) and `PRICES_KV` (daily-refreshed live prices). `worker-gchat`'s
  daily cron (11:00 UTC) writes `prices_live`; the other workers read it.
- **Analytics Engine** `stratus_bot_metrics` — real-time latency/cost telemetry.
- **R2** `stratus-bot-storage` — generated PDFs/attachments.
- **Workers AI** (`AI` binding) — Llama/Gemma for cheap intent classification.

`worker-gchat` additionally uses **Cloudflare Workflows** (`CrmWorkflow`,
`QuotePoWorkflow`), a **Queue** (`stratus-gchat-crm-queue` + DLQ), and a
**service binding to itself** (`SELF`) — all to escape the 30s `ctx.waitUntil`
wall-clock limit on multi-step agentic CRM loops.

### Request flow

- **Webex / Google Chat**: inbound message → `/webhook` → intent detection →
  deterministic quoting engine (`parseMessage` → `buildQuoteResponse`) **or**,
  for CRM/email intent, a Claude tool-use agentic loop (up to ~8 iterations).
  Long jobs are handed off to a Workflow/Queue so the request returns fast.
- **Gateway**: implements the Gemma-first waterfall — cheap Workers AI model
  classifies; only hard cases escalate to Claude on the main worker.
- Anthropic API calls are routed through the **Cloudflare AI Gateway** for
  caching, cost tracking, and rate limiting (with a direct-API fallback).

## Conventions

### Workers runtime
Workers code is **ES modules** with a `fetch()` (and `scheduled`/`queue`)
handler. No Node built-ins — no `fs`, no `Buffer`. JSON is `import`ed (embedded
at build time by wrangler); use Web APIs (`btoa`, `Uint8Array`, native
`fetch`). The root `index.js` is the exception (real Node/Express).

### Secrets vs. config
- **Secrets** (API keys, OAuth tokens): `wrangler secret put <NAME>` — never in
  the repo. `gitleaks` (CI + pre-commit) and GitHub push protection guard this.
- **Non-secret config & feature flags**: `[vars]` blocks in `wrangler.toml`.
  Flags are string `"true"`/`"false"`; new kill switches default **off** so the
  first deploy after a merge does not change behavior. The toml files contain
  extensive inline comments explaining each binding/flag — read them before
  changing anything.

### Shared data files — keep them in sync
`worker/src/data/` and `worker-gchat/src/data/` (`prices.json`,
`auto-catalog.json`, `specs.json`, `accessories.json`) must be **byte-identical**.

- Treat `worker/src/data/` as the source; after editing run
  `bash sync-engine.sh --sync` to copy into `worker-gchat/src/data/`.
- `bash sync-engine.sh` (no flag) reports diffs and function-signature drift.
- CI (`sync-check.yml`) fails the PR if these files diverge.
- `data/build-catalog.js` regenerates `data/auto-catalog.json` from
  `data/prices.json` (`node data/build-catalog.js`) — the root `data/` dir is
  the catalog-build workspace.

### Generated artifacts — do not hand-edit
`chrome-extension/dist/` and `worker-gchat/dist/` are build output. Edit `src/`
and rebuild.

### Commit messages
Conventional-commit style with a component scope, e.g.
`feat(gchat): ...`, `fix(gchat): ...`, `chore(ext): ...`, `opt(gchat): ...`.
Common scopes: `gchat`, `ext`. PRs squash-merge to `main`.

### Claude models
Code references current Claude 4.x model IDs (e.g. `claude-sonnet-4-6`,
`claude-haiku-4-5-20251001`, `claude-opus-4-6`). When touching model selection,
keep to the IDs already present unless explicitly asked to upgrade.

## Build, test, deploy

### Workers (`worker/`, `worker-gchat/`, `worker-gateway/`)
```bash
cd worker            # or worker-gchat / worker-gateway
npm install
npm run dev          # wrangler dev (local)        — worker/ only has these scripts
npx wrangler deploy --dry-run --outdir /tmp/dry    # build check, no upload
npm run deploy       # wrangler deploy             — usually left to CI
npm run tail         # live logs
```
Always run the **dry-run build check** before pushing worker changes. It
catches esbuild errors that `node -c` does not — notably inline backticks
inside a template-literal-delimited prompt string, which has broken a real
deploy before.

### Tests
Most worker tests are plain Node scripts that shim the ES-module `src/index.js`
into CommonJS — run them directly:
```bash
node test.js                                 # legacy root index.js suite
node worker/test-local.js                    # worker deterministic engine
node worker/test-<name>.js                   # individual regression tests
node worker-gchat/test-<name>.js             # individual regression tests
node test-harness/run-tests.js               # LIVE eval vs deployed gateway
```
There is no aggregate `npm test`. The `worker*/test-*.js` files are a regression
corpus — many are dated (`test-...-2026-05-13.js`) and pinned to a specific
fix. When you fix a bug, add a matching dated test next to the others.

`test-harness/run-tests.js` hits **deployed** endpoints; it defaults to
`DRY_RUN=1` so write-shaped prompts do not mutate Zoho. Only set `DRY_RUN=0`
for an explicitly approved live-write pass. See `test-harness/LIVE_EVALS.md` —
decision-grade waterfall/routing claims must be backed by live LLM calls, not
fixture-only simulations.

### Chrome extension
```bash
cd chrome-extension
npm install
npm run dev          # webpack --watch (development)
npm run build        # production bundle into dist/
npm run build:crx    # build + package signed .crx
```

### CI / CD (`.github/workflows/`)
- `build-check.yml` — wrangler dry-run for all three workers on PRs and pushes
  to `main`. Blocks the PR until all three build.
- `sync-check.yml` — verifies the shared data files match.
- `gitleaks.yml` — secret scanning.
- `deploy.yml` — on push to `main`, deploys all three workers
  (gateway after gchat). Requires the `CLOUDFLARE_API_TOKEN` repo secret.

Pushing to `main` deploys to production. Do real work on feature branches and
open PRs.

## Migrations
`migrations/*.sql` are dated D1 migrations applied via wrangler. Both `worker`
and `worker-gchat` point `migrations_dir` at the shared `migrations/` folder.
Add new migrations as `YYYY-MM-DD-<description>.sql`; use `IF NOT EXISTS` /
idempotent DDL where practical and document the context in a leading comment
(see existing files for the pattern).

## Working in this repo — checklist

- Editing a shared data file → run `bash sync-engine.sh --sync` so both workers
  match, or `sync-check.yml` will fail.
- Editing worker `src/index.js` → run the wrangler `--dry-run` build check and
  the relevant `test-*.js` scripts.
- Adding a binding/flag → update the right `wrangler.toml`, keep the explanatory
  comment style, default new kill switches to `"false"`.
- Never commit secrets; they go through `wrangler secret put`.
- Don't hand-edit `dist/` directories.
- Prefer feature branches + PRs — a merge to `main` ships to production.
