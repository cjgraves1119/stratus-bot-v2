# Stratus Bot — Production Issues & Fix Plan
**Date:** 2026-06-03 (covering issues observed 2026-06-02)
**Source:** D1 production logs (`stratus-bot-analytics`) + live Zoho verification + code trace
**Companion to:** `docs/AUDIT-2026-05-22.md`, `docs/REMEDIATION-PLAN-2026-05-22.md`
**Status:** DRAFT — evidence-based, NOT approved, NO code changed yet

> This plan is driven by REAL production logs, not the static audit. Where the
> audit and the logs disagree, the logs win. Every root cause below is verified
> against the actual code and (for Zoho) the live CRM.

---

## 1. What actually broke on 2026-06-02 (from D1)

16 CRM operations, **6 failed (38%)**. By impact:

| # | Issue | Count today | Severity | Status |
|---|-------|-------------|----------|--------|
| P1 | Quote update rejected: "can't add inactive product" | 4 | **Critical** — blocked core workflow | Root-caused ✓ |
| P2 | Opaque "API 400" after 1–2 min agent loop | (same events) | **High** — terrible UX, hides real error | Root-caused ✓ |
| P3 | Cross-tab context bleed (Gmail context into Zoho request) | reported | **High** — wrong-context answers | Root-caused ✓ |
| P4 | CRM agent latency 20–110s | pervasive | **High** | Quantifying (agent) |
| P5 | Task create failed: `MANDATORY_NOT_FOUND $se_module` | 1 (self-healed) | Low | Located ✓ |
| P6 | Contact create failed: `DUPLICATE_DATA` (no link recovery) | 1 | Low | Located ✓ |

---

## 2. P1 — Inactive product blocks quote updates (THE big one)

### Evidence
- 4 failed Quote updates (crm_operations ids 1292, 1296, 1298, 1299), all:
  `NOT_ALLOWED — can't add inactive product in the inventory` at
  `Quoted_Items[*].Product_Name.id`.
- The product the bot kept writing: `2570562000001277655`, qty 84.
- **Live Zoho verification:** `LIC-SME-5YR` (id `…277655`) = **`Product_Active: false`**.
  `LIC-SME-3YR` (…654) and `LIC-SME-1YR` (…653) are active. No active 5YR record exists.
- You were changing the Naf Naf Grill SME licenses to 5-year — but the 5-year SME
  license product is deactivated in Zoho.

### Root-cause chain (all verified in code)
1. `worker-gchat/src/data/prices.json:2320` maps `LIC-SME-5YR` →
   `zoho_product_id: "2570562000001277655"` (the inactive record).
2. `batch_product_lookup` returns `product_active: true` **hardcoded** for every
   prices.json cache hit (`index.js:8773, 8797, 10394`). The agent is told it's active.
3. `preflightQuotedItemsProductActive` (`index.js:6510`) only blocks (a) product_ids
   NOT in the cache (treated as hallucinated) and (b) SKUs our catalog flags `isEol()`.
   `LIC-SME-5YR` is in the cache and not EOL-flagged → **passes preflight**.
4. Zoho rejects the write. `parseZohoResponse` (`index.js:6839`) returns a generic
   `{success:false}` that the agent treats as retryable → it loops (see P2).

### Fix (layered, low-risk → robust)
**Fix 2a — Terminal, actionable error on inactive product (safety net, covers ALL cases).**
In `parseZohoResponse` (`index.js:6861`) — when `record.code === 'NOT_ALLOWED'` and the
message includes `inactive product`, return a TERMINAL result:
`{ success:false, _no_retry:true, message:"❌ A product in this quote is INACTIVE in
Zoho's inventory and cannot be added. Do NOT retry. Identify the inactive line item,
remove it, and ask the user for an active alternative (e.g., a different term)." }`.
Add `_no_retry`/terminal handling in the agentic tool loop so it stops instead of looping.
*Risk: low — only changes behavior on an already-failing path.*

**Fix 2b — Name the SKU + suggest active terms (higher value).**
At the `zoho_update_record` / `zoho_create_record` handlers (`index.js:~9156/~9490`),
which have the request items: on the NOT_ALLOWED-inactive failure, parse the
`json_path` index, reverse-map that item's `Product_Name.id` → SKU via
`getProductIdToSkuMap()`, and return `"❌ {SKU} is inactive in Zoho (5-year SME is
not an active product). Active alternatives: LIC-SME-1YR, LIC-SME-3YR. Ask the user
which to use."` *Risk: low–moderate.*

**Fix 2c — Stop claiming cached products are active (preventive).**
Add `"zoho_active": false` to the `LIC-SME-5YR` entry in `prices.json` (all copies),
and make `batch_product_lookup` + the cache-resolver return `product_active: false`
when that flag is present (instead of hardcoded `true`). Then preflight blocks it
*before* the write. *Risk: low (data + small code). Requires the discovery sweep below
to find ALL inactive-mapped SKUs.*

**Discovery D-LOG-1:** sweep Zoho Products for `Product_Active:false`, cross-reference
every `zoho_product_id` in prices.json, and list all stale mappings. (Partially covered
by the running log agent; a definitive Zoho sweep is a follow-up task.)

---

## 3. P2 — Opaque "API 400" / agent loops for 1–2 minutes

### Evidence
- bot_usage 19:40:43 (108s) and 19:46:44 (74s), both `crm_agent`/sonnet, both ended:
  *"Sorry, I couldn't process that CRM/email request (API 400). Please try again shortly."*
- These coincide with the P1 inactive-product retries.

### Root cause
The agent retries the impossible write (P1), the tool-loop conversation grows, and the
**Anthropic** API returns 400. `index.js:15866` discards the real reason and shows a
generic message. Two compounding defects: (a) no terminal-error signal stops the loop
(fixed by 2a), (b) the 400 reason is masked.

### Fix
- **Fix 3a:** primarily resolved by **Fix 2a** (terminal error stops the loop, so the
  conversation never balloons to the 400).
- **Fix 3b:** improve `index.js:15862-15867` — log/surface the actual Anthropic error
  category (the body is already saved to KV `api_error_*` at 15837). For tool-loop 400s,
  return a more honest message and consider trimming the oldest tool-results before the
  final call to avoid the structural 400 entirely. *Risk: low–moderate; needs care in the
  hot path — gate behind a flag.*

---

## 4. P3 — Cross-tab context bleed (extension)

### Root cause (verified by sub-agent, file:line)
Context is stored in **single global keys** (`zohoPageContext`, `emailContext`) +
background singletons — NOT keyed by browser `tabId`. The functional bug: Zoho and Gmail
contexts are independent globals that are **both alive at once**, and `ChatPanel`
injects **both**. On `onActivated` into a Zoho tab the code **deliberately does not clear
`currentEmailContext`** (`background/index.js:493-495`), so the previous Gmail email rides
into the Zoho request → the bot conflates them. Compounded by EXT-CRIT-1
(`zoho-content.js:168` `{...ctx}` clobbers the message `type`, killing live push so
everything relies on a 2s poll → race window). The side panel shows on every tab because
`setPanelBehavior({openPanelOnActionClick:true})` (index.js:49) + `setOptions({tabId,
enabled:true})` for **every** tab (index.js:458-464).

### Fix (ranked)
- **Fix 4a (immediate, low risk):** on entering a Zoho tab, clear email context
  (symmetric to `clearZohoContext`); and in `ChatPanel.handleSendMessage`, only inject
  email context when the active page is Gmail. Kills the reported Gmail→Zoho leak.
- **Fix 4b:** fix EXT-CRIT-1 (`zoho-content.js:168`) so live updates work and the race
  shrinks; add tabId-based filtering to the email listener (`App.jsx:247`).
- **Fix 4c (proper):** key context storage by `sender.tab.id` (tab-scoped keys in
  `chrome.storage.session`, swept on `tabs.onRemoved`). True per-tab isolation.
- **Fix 4d (panel, OPTIONAL — confirm UX):** per-tab `setOptions({tabId, enabled})` so
  the panel only shows on Zoho/Gmail tabs. *Changes UX — needs your sign-off.*

---

## 5. P4 — CRM agent latency (now quantified — #1 SYSTEMIC issue over 30 days)
`crm_agent` = 76% of all bot traffic. On **claude-sonnet-4-6**: avg **31.4s**, p90 66s,
p95 89s, p99 136s, **max 148s**; 31 calls >60s. The Llama tier is ~2.5x faster but
handles few calls. Gateway `claude-forced-write` avg **59.4s**.

**Why (corrected):** caching is NOT missing — it already exists
(`splitSystemPromptForCaching`, `cache_control: ephemeral`, KV kill-switch
`prompt_caching_enabled`, `index.js:218-289, 15452`). The dominant cost is the
**multi-iteration agentic loop**: ~10 sequential Claude calls per CRM task, each a full
round-trip on a slow model. Levers, in order:
- **5a — Verify cache hit-rate.** Check `cache_read_input_tokens` in API usage; the
  workload is 9.56M input vs 268K output tokens (30d) — extremely input-heavy, so cache
  misses would be very expensive. If the static prefix isn't stable, hits are low.
- **5b — Reduce tool iterations.** Fewer round-trips per task (e.g., batch reads, tighter
  tool guidance) cuts latency linearly.
- **5c — Model choice** (ties to §7): a faster/stronger model per call changes the whole
  curve.
*This is the highest-leverage systemic fix; it also reduces P2 (fewer/shorter loops →
fewer Anthropic 400s).*

---

## 5B. Additional systemic findings (30-day logs) — with live-vs-historical triage

> CRITICAL: the 30-day window includes errors from **May 8–22, before the last code
> commits** (margin/clone work landed ~May 22). Several named errors reference symbols
> that ARE defined in the current code, so they are **likely already fixed**. Each must be
> verified against current code before any "fix" — do NOT blindly re-fix resolved bugs.

| Finding | Evidence | Live or historical? | Action |
|---------|----------|---------------------|--------|
| **Deals update reports failure as SUCCESS** | 7/8 Deals updates returned `✅ completed` while the Zoho body was an error (`INVALID_URL_PATTERN` ×6 May 14, `INVALID_DATA`) | **Logic still live** — `parseZohoResponse` fallback (`index.js:6872`) defaults to `success:true` for unrecognized shapes | **Fix:** default the fallback to FAILURE (or detect error shapes). Correctness/data-integrity bug. Med priority, low risk. |
| Inactive-product is recurring | 13 errors / 5 days / **~6 distinct dead product ids** (incl. `…277655` SME-5YR) | **Live** (Jun 2) | Covered by §2 fixes — ensure they cover ALL ~6 ids, not just SME. Add Zoho sweep (D-LOG-1). |
| `bot_usage.error_message` unused | 5/1916 populated; failures hide in `response_text` | **Live** | **Fix:** populate `error_message` on failures so errors stop hiding. (Ties to audit CRIT-11 telemetry.) Low risk. |
| `quote_to_po_and_esign` CCW race | 5 "CCW_Deal_Number not populated yet" failures | **Live** (logic present) | **Fix:** poll/backoff for CCW_Deal_Number. Med effort. |
| Named code errors to users: `callerEmail is not defined` (blocked quote create, May 20), `applyFieldAliases is not defined` (May 22), `outcome` TDZ | shipped verbatim to users | **Likely HISTORICAL** — `callerEmail` (params at 5590/5658) and `applyFieldAliases` (def at 19038) are defined now → probably fixed post-May-22 | **Verify each against current code; only fix if still reproducible.** Do NOT assume. |
| Datasheet live-fetch ships placeholder text | `## LIVE DATASHEET CONTENT (fetching…)` / "fetch came back empty" to users (May 6) | Verify | Low priority; check the datasheet fetch path. |
| `quote_history` / `quote_po_workflow_runs` empty (30d) | no rows in window | Verify | Quote logging may be broken or writing elsewhere — investigate (telemetry gap). |

### Cost (informs §7 model decision)
30-day total **$34.40**; **95% is claude-sonnet-4-6**; 9.56M input vs 268K output tokens.
At ~$34/mo there is ample headroom to use a smarter model on the CRM path — the binding
constraint is latency, not cost.

---

## 6. P5 / P6 — Minor self-healing failures
- **P5 (Task `$se_module`):** a Task was created with `What_Id` but no `$se_module`
  (required when `What_Id` is set). Helpers elsewhere set them together
  (`index.js:888-889, 21336-21337, 21721-21725`); the generic `zoho_create_record` Task
  path does not auto-inject it. **Fix:** in `zoho_create_record` for Tasks, if `What_Id`
  is set and `$se_module` is missing, infer it from the `What_Id` module. *Risk: low.*
- **P6 (Contact `DUPLICATE_DATA`):** standalone Contact create (`index.js:~23808`) returns
  a bare failure; Zoho returns the existing record's id in the error. `create_deal_and_quote`
  already handles this (`index.js:5915`) — the generic path does not. **Fix:** catch
  `DUPLICATE_DATA`, extract `duplicate_record.id`, and link/use the existing contact.
  *Risk: low. Also mitigated by fixing CRIT-4 contact lookup.*

---

## 7. Model strategy (your "pay for the smart model first" idea)
Sound, and reversible given the flag architecture. Proposal: a flag
(e.g. `CRM_AGENT_FORCE_MODEL=sonnet|opus|off`) that forces the CRM/agent path to one
strong model and **bypasses the llama/gemma tiers**, with the waterfall preserved behind
the flag to re-enable per-tier once stable. The session logs showed llama→sonnet→haiku
churn within one task, which may add confusion and latency. **Decision needed:** which
model (Sonnet 4.6 vs Opus), and is cost acceptable (30-day cost-by-model from the log
agent will inform this).

---

## 8. Cleanup / organization (verified)

**Data flow — DEFINITIVE.** Canonical source = `worker/src/data/` → mirrored to
`worker-gchat/src/data/` (CI-enforced by `sync-check.yml`). The Chrome extension bundles
`chrome-extension/src/lib/auto-catalog.json` (byte-identical to canonical) at build time
for SKU/EOL logic, and fetches **live prices** via extension → gateway → gchat worker
(canonical `prices.json` + `PRICES_KV`). The extension has **no prices.json**. Root
`data/` is **stale** (991 vs 1056 price entries, old schema, no Zoho IDs) with **no
runtime consumer** except the orphaned root `index.js`.

**Safe cleanup actions (each verified):**
- **Delete root `data/` + root `index.js` + root `package.json`** — orphaned legacy Express
  bot + stale data island; no CI/deploy/runtime references. *(Verify-first: decide if you
  still want `data/build-catalog.js` as a generator — if so it must be re-pointed at
  `worker/src/data/`; today it reads/writes the stale island.)*
- **Add `chrome-extension/src/lib/auto-catalog.json` to the CI sync/drift check** — it's the
  catalog that actually ships in the extension and is currently NOT guarded against drift.
- **Move 48 scattered `test-*.js`** (16 in `worker/`, 32 in `worker-gchat/`) into `tests/`
  subdirs (path-check imports first; none are wired to a runner).
- **GitHub: 77 branches are safe to delete** (their PRs are merged — repo uses squash-merge,
  so `git --merged` is useless; judged by PR state). 7 keep (open PRs). 5 verify-first
  (no PR; old pre-squash snapshots).
- **Cloudflare: orphan worker `stratus-bot-v2`** (last modified 2026-04-23, not in repo) —
  verify no route/traffic, then delete. `stratus-ai-email-responder` is live but its source
  is only on PR #80 (not in main) — merge or formally retire.

**Note — several "code bugs" in the 30-day logs are ALREADY FIXED** (merged PRs):
`callerEmail is not defined` → PR #98; `outcome` TDZ → PR #13; helper module-scope
(`applyFieldAliases`) → PR #100. Do NOT re-fix. This is why §5B requires per-item
verification against current code.

---

## 9. Proposed execution order (safest-first; all on branch, reviewed before deploy)

**Wave A — stop today's bleeding (low risk, high impact):**
1. **Fix 2a + 3a** — terminal inactive-product error so the agent fails *fast and clearly*
   instead of looping into "API 400." Stops the 4×-failure / 2-min-wait pattern. *Lowest risk.*
2. **Fix 5B-Deals** — make `parseZohoResponse` default to FAILURE on unrecognized shapes
   (`index.js:6872`) so Zoho errors stop being reported as "✅ completed." *Correctness/data-integrity.*
3. **Fix 2c + data** — mark inactive-in-Zoho SKUs (LIC-SME-5YR + the ~6 known dead ids) so
   preflight blocks them pre-write. *After the Zoho active-status sweep (D-LOG-1).*

**Wave B — latency + model (the #1 systemic issue + your strategy):**
4. **Fix 7 + 5a/5b** — verify prompt-cache hit-rate; single-strong-model flag for the CRM
   path (your call: Sonnet 4.6 vs Opus); reduce tool iterations. *Biggest latency lever.*

**Wave C — cross-tab + minor CRM:**
5. **Fix 4a/4b** — cross-tab email-context leak (immediate) + EXT-CRIT-1 type-clobber.
6. **Fix 2b, 5, 6** — SKU-named errors, Task `$se_module` auto-inject, duplicate-contact linking.
7. **Fix 4c/4d** — proper per-tab context isolation + optional per-tab panel (panel needs your UX sign-off).

**Wave D — cleanup + audit backlog:**
8. **Cleanup** — §8; per-item approval for anything destructive (branches, root files, orphan worker).
9. **Audit Wave 1** — the previously-converged safe fixes (eosLabel, delete-try/catch, queue loop, etc.).

Each item: one commit, dry-run + smoke test, deploy one worker at a time, `wrangler
rollback` ready. Nothing deployed without your go-ahead.

---

*Investigation complete (3 agents: cross-tab, cleanup, 30-day logs). Root causes verified
against code + live Zoho. No code or data changed yet — awaiting your steer on §7 (model)
and which wave to start.*
