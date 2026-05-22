# Stratus Bot v2 — Audit Remediation Plan
**Date:** 2026-05-22
**Companion to:** `docs/AUDIT-2026-05-22.md`
**Status:** v2 — revised after Round 1 adversarial review. NOT approved. NO code changed.

---

## 0. CRITICAL CONTEXT — The Audit Is Unreliable

Round 1 adversarial review verified the audit's claims against the actual source
and found **multiple audit findings are factually wrong**:

| Audit finding | Reality (verified against code) |
|---------------|--------------------------------|
| CRIT-10 `enrichCompanyV2` inside `fetch()` | FALSE — it is at module scope (line 19505/19681, column 0). Not a bug. |
| CRIT-12 vision `slice(2)` off-by-one | FALSE — `slice(2)` correctly extracts the tail of a 3-part split. The audit's `slice(1)` IS the regression. |
| CRIT-2 undo regex causes a crash | FALSE — real tokens come from `crypto.randomUUID()` (8 hex chars); the existing `[a-f0-9]` regex already matches them. |
| CRIT-4 "5 sites" need the lookup fix | FALSE — only line 6094 is broken. Sites 9112/9128/10752/10952 are correct today; the "fix" breaks them. |
| CRIT-5 "5 double-write sites" | MOSTLY FALSE — most listed sites are the *sole* history writer on continuation paths. |
| CRIT-13 add-pricing "produces no pricing" | FALSE — the live branch at line 3279 already prices every term. The dead branch is redundant. |
| CRIT-11 fix `env.ctx?.waitUntil(...)` | The proposed fix is a silent no-op — `env.ctx` is never assigned. |

**Governing rule for this entire plan:** the audit is a list of **LEADS, not
facts**. Every fix has a mandatory per-fix verification step that confirms the
bug exists against the current code before any edit is made. No fix is applied
on the audit's word alone. The audit doc itself now carries a corrections banner.

---

## 1. Objective & Hard Constraints

The bot is in production and working well. Fix real bugs **without regressing any
working behavior**. Constraints:

1. Every change is individually revertable.
2. The highest-risk behavioral changes are toggleable **without a redeploy**.
3. Nothing reaches production without: per-fix verification + `wrangler deploy
   --dry-run` + relevant test-suite pass + a manual smoke test on the live bot.
4. Workers deploy **one at a time**, with an observation window between each.
5. At any sign of regression: revert first, diagnose second.

---

## 2. Rollback Architecture — 4 Layers (CORRECTED)

### Layer 1 — Cloudflare deployment rollback
`wrangler rollback <id>` (or dashboard → Deployments → Rollback) restores a
previous Worker **script** version in seconds.
**CORRECTED LIMITATION — this does NOT revert:**
- **D1 migrations** — D1 has no automatic down-migrations. A migration applied
  by `wrangler deploy` stays applied after a script rollback.
- **KV data** already corrupted by a bug before the rollback (e.g. doubled
  conversation history written before we noticed).
- **In-flight Queue messages** or **running Workflow instances** created against
  the buggy script.
So Layer 1 is the fast path for *code* regressions, not a universal undo.

### Layer 2 — Git atomic revert
One logical fix = one commit. `git revert <sha>` undoes any single fix.

### Layer 3 — Feature flags (CORRECTED — they are STRINGS)
Cloudflare `[vars]` values are **strings, not booleans**. The repo already proves
this: every existing flag uses `env.X === 'true' || env.X === '1'` (see
`worker-gchat/src/index.js:9399, 14946, 21127`, and the helper at line 16658).
A naive `if (env.FLAG)` treats the string `"false"` as **truthy** — the flag
would be stuck ON and un-revertable.
**Mandate:** every new flag (`HISTORY_SINGLE_WRITE`, `FIX_CONTACT_LOOKUP`) MUST
branch on `env.FLAG === 'true'` (or reuse the line-16658 helper). Phase 0 must
verify the **committed string value** is `"false"` — note `wrangler.toml`
already has flags (`QUOTE_PO_WORKFLOW_ENABLED`) whose committed value contradicts
their "Default off" comment, so trust the value, not the comment.

### Layer 4 — Known-good tag (nuclear restore)
`pre-audit-fixes-2026-05-22` tags current `main`. Reset + redeploy = full source
restore (subject to the Layer-1 D1/KV caveats above).

### KV-repair contingency (for the history fix specifically)
Because Layer 1 cannot un-corrupt KV, the history fix (Phase 6) needs its own
safety net: a small read-only script that detects doubled consecutive identical
turns in a conversation history blob, runnable to trim corruption if the fix
misbehaves. This is authored **before** Phase 6 ships, not after.

---

## 3. Phase 0 — Pre-flight (no behavior change)

| Step | Action |
|------|--------|
| 0.1 | Create + push tag `pre-audit-fixes-2026-05-22` on current `main` |
| 0.2 | Record active deployment IDs for all 3 workers → Appendix A |
| 0.3 | Run ALL existing test suites; establish a green baseline (document any pre-existing failures) |
| 0.4 | Add `.dev.vars` + `*.dev.vars` to `.gitignore` |
| 0.5 | Verify the committed string value of every existing `[vars]` flag in all 3 wrangler.toml files |
| 0.6 | Determine whether ANY planned phase introduces a D1 migration; if so, that phase must ship a forward-fix migration too (no auto down-migration) |

**GATE:** baseline green, tag pushed, deployment IDs recorded.

---

## 4. Corrected Finding Triage

### 4A. VERIFIED REAL BUGS — safe to fix
| ID | Location | Bug | Class |
|----|----------|-----|-------|
| CRIT-3 | gchat:2552, webex:2992 | `eosLabel` ternary — both branches `'End of Sale'` | A |
| CRIT-13 | webex:3284-3288 | `if (isAddPricing && !showPricing)` always false — redundant dead block (live branch at 3279 already prices) → **delete** | A |
| CRIT-8 | gchat `zoho_delete_record` ~13203 | `DELETE` call outside try/catch — a throw aborts the whole agentic turn | A |
| CRIT-6 | gchat:24940 | `lastUserMsg.content` deref when history empty — needs null guard | A |
| CRIT-4 | gchat:6094 **ONLY** | `fetchPrimaryContactForAccount` searches `Account_Name:equals:<recordId>` — wrong; needs COQL | C |
| CRIT-7 | gchat:25482 | Queue consumer has no `__continuation` loop | B/C |
| CRIT-9 | gchat:19634, 23934 | Two `api.anthropic.com` literals bypass the gateway constant | B |
| CRIT-1 | gchat:1170 | `substring(-8)` in the `generateUndoToken` **fallback** path | A (cosmetic) |
| DLQ | gchat wrangler.toml:92 | `stratus-gchat-crm-dlq` referenced, never declared | B |

### 4B. VERIFIED NON-BUGS — DROPPED from the plan
| ID | Why it is not a bug |
|----|---------------------|
| CRIT-10 | `enrichCompanyV2` + TTL constants are already at module scope. Nothing to hoist. |
| CRIT-12 | Vision `slice(2)` correctly extracts the tail of the 3-part split. The audit's "fix" is the regression. |
| CRIT-2 | The undo regex matches all real (hex) tokens. No crash occurs. (Widening to `[0-9a-z]` is optional cleanup, not a fix.) |
| CRIT-4 sites 9112, 9128, 10752, 10952 | Correct today — Accounts-module primary field or legacy name-based lookup. The "fix" breaks them. |

### 4C. LEADS NEEDING VERIFICATION before any fix
| ID | What must be verified |
|----|----------------------|
| CRIT-5 | Real double-writes occur ONLY where `askClaude` completes without a `__continuation` AND the caller also writes. The audit's site list is wrong — must be re-derived (Discovery D1). |
| CRIT-11 | Real issue, but the audit's fix is a no-op. Root cause is L-15 (`env.ctx` never assigned). Needs real `ctx` plumbing (Discovery D4). |
| CRIT-14 | `logShadowClassification` per-request DDL — confirm no existing guard, confirm `globalThis` guard pattern is safe here. |
| EXT-CRIT-1..4 | Chrome extension findings — not yet verified against code (Discovery D5). |

---

## 5. Phased Rollout (revised)

Each phase = one PR. A phase does not start until the previous one is deployed
and observed clean. **Every phase begins with re-verifying its findings.**

### Phase 1 — Verified Class-A only (one PR: worker + worker-gchat)
**Changes:** CRIT-3 eosLabel — use `eosDate <= now ? 'End of Sale (passed)' :
'End of Sale'` (mirrors the adjacent `eostLabel` convention); CRIT-6 null guard
before `lastUserMsg.content`; CRIT-8 try/catch around `zoho_delete_record`'s
DELETE — the catch MUST return the **same error shape** as the existing
returned-error branch (`{success:false, error, _no_partial_success:true,
message:'...did NOT succeed...'}`) so the model never falsely claims success;
CRIT-13 **delete** the dead block at webex:3284-3288.
**Removed from Phase 1 vs v1:** CRIT-11 (audit fix is a no-op — moved to Phase 4),
CRIT-12 (not a bug — dropped).
**Verification:** dry-run; full test suites; smoke-test an EOL date query on
both bots; smoke-test a brand-new GChat session (empty history); smoke-test an
"add pricing" follow-up (confirm no duplicate pricing block).

### Phase 2 — Undo token + API URL (one PR: worker-gchat)
**Changes:** CRIT-1 `substring(-8)`→`slice(-8)` in the `generateUndoToken`
fallback. **Severity downgraded:** the fallback is dead code in production
(`crypto.randomUUID` is always available in CF Workers) — this is correctness
hygiene, not a live bug. CRIT-9: route the two `api.anthropic.com` literals
through the gateway **while preserving a direct-API fallback** — `api.anthropic.com`
(`ANTHROPIC_API_DIRECT`, line 22) is an *intentional* documented fallback;
`askClaudeContinue` (line 14890) deliberately fails over to it. The fix must
replicate that gateway→direct pattern, not just swap to gateway-only.
**Verification:** dry-run; undo-token test files; smoke-test a create→undo cycle;
smoke-test `/api/detect-account` (one of the CRIT-9 call sites).

### Phase 3 — Queue consumer + DDL guard + DLQ (one PR: worker-gchat)
**Changes:** CRIT-7 add a `__continuation` loop to the queue consumer (line
25482) mirroring `/_work`; **note** the consumer also writes history at line
25505 — after Phase 3 that becomes the sole writer for continued queue jobs, a
fact Phase 6 must respect. CRIT-14 add a `globalThis` guard to
`logShadowClassification`. Resolve Q1: declare `stratus-gchat-crm-dlq` or remove
the reference.
**Verification:** dry-run; enqueue a long CRM job in a test space if possible.

### Phase 4 — CRIT-11 done correctly (one PR: worker)
**Blocked by Discovery D4.**
**Changes:** fix `logBotUsageToD1` telemetry loss properly. The audit's
`env.ctx?.waitUntil` is a no-op because `env.ctx` is never assigned. The real fix
(per D4): either assign `env.ctx = ctx` at the top of `fetch()`, or thread the
real `ctx` parameter down to the `askClaude` call site (line 7773). This is the
same root cause as audit finding L-15.
**Verification:** dry-run; confirm a D1 row with `cost_usd` is written for a
fast-completing request.

### Phase 5 — Account_Name lookup, line 6094 ONLY (one PR, FLAG-GATED: worker-gchat)
**Blocked by Discovery D2.**
**Changes:** behind `FIX_CONTACT_LOOKUP` (`=== 'true'`), fix **only line 6094**
(`fetchPrimaryContactForAccount`) using **COQL** — matching the proven pattern at
line 6157 (`select ... from Contacts where ...`), NOT legacy-criteria
`.id:equals`. **Sites 9112/9128/10752/10952 are explicitly OUT of scope** — they
are correct today.
**Why flag-gated:** this query currently always returns 0 results, so the bot has
only ever run the "no contact found" branch. The fix activates the less-tested
"contact found" branch. The flag allows instant revert.
**Verification:** D2 confirms COQL syntax against live Zoho via the ZohoCRM MCP
tools; smoke-test primary-contact resolution against a known account.

### Phase 6 — History single-writer (one PR, FLAG-GATED: worker-gchat)
**Blocked by Discovery D1.**
**Approach (corrected from v1):** the v1 plan — "remove the redundant second
call" — was wrong. `askClaude` writes history (lines 16114-16115) ONLY when it
completes without a `__continuation`. On continuation paths it returns early at
line 15724 and never writes; `askClaudeContinue` never writes at all. So the
endpoint-level / workflow-level writes are the **sole** writer on every
continuation path. **The fix must make exactly one writer per path** — the safe
direction is to keep the endpoint/workflow writes (which fire after the
`while(__continuation)` loop) and instead gate `askClaude`'s internal write
(16114-16115) so it only fires when the caller will NOT also write. D1 produces
the authoritative per-path writer map first.
**Flag-gated** (`HISTORY_SINGLE_WRITE === 'true'`); KV-repair script ready first.
**Verification:** D1 map; multi-turn conversation smoke test on both bots
including a long (continuation-triggering) CRM job; confirm KV history length is
correct and not zero on continuation paths.

### Phase 7 — Mechanical refactors (one PR: worker-gchat)
**Changes:** org-ID → `ZOHO_ORG_ID` constant (verify the literal count first —
audit says 62; confirm by grep); `addBusinessDays` → one shared util; Velocity
Hub URL → `env.VELOCITY_HUB_URL` with the current URL as the fallback default.
**Verification:** grep shows zero remaining literals; the constant `===` the old
literal; spot-check 5 generated URLs byte-for-byte.

### Phase 8 — Chrome extension (one PR — separate pipeline)
**Blocked by Discovery D5.**
**Changes:** EXT-CRIT-1..4 — only those D5 confirms are real.
**Rollback (corrected):** the extension auto-updates via `update_url` and Chrome
will NOT auto-downgrade. Rollback = rebuild from the tag, **bump the version
up**, AND republish `update-manifest.xml`. Propagation is not instant (Chrome
polls every few hours).
**Verification:** load unpacked, manually exercise each fixed path in a browser.

### Phase 9 — Org/infra cleanup (Class E — per-item explicit approval)
Branch deletion, root `index.js`/`data/` removal, stale `stratus-bot-v2` worker
deletion, test-file reorg, open-PR resolution. **Each destructive item needs a
separate explicit go-ahead.** Nothing bundled.

---

## 6. Discovery Tasks (MUST finish before the dependent phase)

| ID | Task | Blocks | Method |
|----|------|--------|--------|
| **D1** | Build the authoritative history-writer map: for EVERY ingress path (`/_work`, `/_continue`, `/api/chat`, `/api/chat-waterfall`, `CrmWorkflow`, queue consumer, handoff, EOL/gmailShare), trace whether it calls `askClaude` / `askClaudeContinue` / `askWithWaterfall`, whether that path can return `__continuation`, and which `addToHistory` call is the sole vs. duplicate writer **on each branch**. | Phase 6 | Code read — no changes |
| **D2** | Verify the exact COQL syntax to fetch Contacts by parent Account ID, against the live org. | Phase 5 | `ZohoCRM_searchRecords` / COQL MCP tool on a real account |
| **D4** | Decide the `env.ctx` remediation: `env.ctx = ctx` assignment at `fetch()` top vs. threading `ctx` to line 7773. Check every other `env.ctx` reader won't be affected. | Phase 4 | Code read of the Webex `fetch` entrypoint |
| **D5** | Verify each Chrome-extension finding EXT-CRIT-1..4 against the actual extension source before any edit. | Phase 8 | Code read of `chrome-extension/src/**` |
| **D6** | Confirm whether any phase requires a D1 migration; if so author the forward-fix migration. | Phase 0 gate | wrangler.toml + migrations dir review |

---

## 7. Open Questions for Chris

- **Q1 — Dead-letter queue:** declare `stratus-gchat-crm-dlq` as a real queue, or
  remove the reference (accepting that exhausted-retry messages are dropped)?
- **Q3 — Flag defaults:** ship `HISTORY_SINGLE_WRITE` / `FIX_CONTACT_LOOKUP`
  **OFF** (deploy dark, flip on after observation) — recommended — or ON?
- **Q4 — Email responder (PR #80):** worker is live but its source is not in
  `main`. Fold into this effort or keep separate?
- **Q5 — Scope:** given the audit's unreliability, recommend we fix only the
  **4A verified bugs** now and treat 4C as a second wave after verification —
  rather than attempting "all findings" in one effort. Confirm?

---

## 8. Per-Worker Deploy Protocol (every phase)

1. Re-verify the phase's findings against current code.
2. `wrangler deploy --dry-run` — must pass.
3. Run that worker's test suite — must pass.
4. Merge the phase PR to `main`.
5. Deploy **one worker**; record the new deployment ID.
6. Observe (smoke tests + real traffic) for an agreed window.
7. Only then proceed. At any regression: `wrangler rollback` + diagnose.

---

## 9. Consciously Deferred / Out of Scope (decision, not omission)

- Audit Part-2 logic errors L-1..L-14 — **except L-9** (`TOOL_SUBSETS.subscription`
  missing `create_quote_on_deal`, a real functional gap) which is promoted to a
  candidate for a future phase pending verification.
- Cron-corruption findings (gchat `unescape` at line 25911; silent GitHub PATCH
  failure at line 25968) — real, can corrupt `prices.json` commits; promoted to
  a candidate future phase pending verification.
- Config mismatches in audit Part 3 not in Phase 7 (dead gateway bindings,
  `DEEPSEEK_API_KEY` undocumented, `WORKER_MANIFEST` wrong binding name) —
  deferred; low operational risk.
- Email responder bugs (audit Part 10) — deferred via Q4.
- All Part 5/6 dead-code and duplicate-logic cleanup — deferred; cosmetic.

---

## Appendix A — Rollback Reference (filled in Phase 0)

| Worker | Pre-change deployment ID | Recorded |
|--------|--------------------------|----------|
| stratus-ai-bot | _TBD_ | ☐ |
| stratus-ai-bot-gchat | _TBD_ | ☐ |
| stratus-ai-bot-gateway | _TBD_ | ☐ |

Known-good git tag: `pre-audit-fixes-2026-05-22` — ☐ created ☐ pushed

---

## Appendix B — Round 1 Review Outcome

Round 1 (independent adversarial review) verified plan v1's claims against
source. Result: 3 Blockers, 5 High, 5 Medium, 5 Low. Key corrections folded into
v2: audit findings CRIT-10/CRIT-12 dropped as non-bugs; CRIT-2 severity removed;
CRIT-4 scoped to one site; CRIT-5 approach inverted; CRIT-11 reclassified;
feature-flag string semantics mandated; `wrangler rollback` limitations
documented. v2 is pending Round 2 review.

---

*v2 DRAFT. Under continued adversarial review. Not executed until reviewed,
revised, and explicitly approved by Chris.*
