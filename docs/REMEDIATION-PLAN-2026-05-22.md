# Stratus Bot v2 — Audit Remediation Plan
**Date:** 2026-05-22
**Companion to:** `docs/AUDIT-2026-05-22.md`
**Status:** v4 — revised after Rounds 1-3 adversarial review. Wave 1 converged. NOT approved. NO code changed.

---

## 0. CRITICAL CONTEXT — The Audit Is Unreliable

The audit was produced by parallel sub-agents. Two rounds of independent
adversarial review verified its findings against the actual source and found
**many are wrong**. Verified-wrong findings:

| Audit finding | Reality (verified against code) |
|---------------|--------------------------------|
| CRIT-10 `enrichCompanyV2` inside `fetch()` | FALSE — module scope already (lines 19505/19681). |
| CRIT-12 vision `slice(2)` off-by-one | FALSE — `slice(2)` is correct; `slice(1)` would be the regression. |
| CRIT-2 undo regex crash | FALSE — real tokens are `crypto.randomUUID()` hex; existing regex matches. |
| CRIT-4 "5 sites" | FALSE — only line 6094 is broken; the other 4 are correct today. |
| CRIT-5 "5 double-write sites" | WRONG LIST — most are sole writers on continuation paths. |
| CRIT-13 "produces no pricing" | FALSE — live branch already prices; dead block is redundant. |
| CRIT-11 fix `env.ctx?.waitUntil` | The proposed fix is a silent no-op. |
| CRIT-6 `lastUserMsg.content` deref | FALSE — already guarded at line 24948 (`lastUserMsg && ...`). |

**Governing rule:** the audit is a list of **LEADS, not facts**. Every fix has a
mandatory per-fix verification step against current code before any edit. The
audit doc carries a corrections banner.

---

## 1. Objective & Hard Constraints

The bot is in production and working well. Fix real bugs **without regressing any
working behavior**.

1. Every change is individually revertable.
2. Highest-risk behavioral changes are toggleable or trivially revertable.
3. Nothing ships without: per-fix verification + `wrangler deploy --dry-run` +
   test-suite pass + manual smoke test on the live bot.
4. Workers deploy one at a time, with an observation window between each.
5. At any sign of regression: revert first, diagnose second.

---

## 2. Rollback Architecture — 4 Layers

### Layer 1 — Cloudflare deployment rollback
`wrangler rollback <id>` restores a previous Worker **script** version in seconds.
**Does NOT revert:** D1 migrations (no auto down-migration), KV data already
corrupted before rollback, in-flight Queue messages, running Workflow instances.
Layer 1 is the fast path for *code* regressions, not a universal undo.

### Layer 2 — Git atomic revert
One logical fix = one commit. `git revert <sha>` undoes any single fix. For
pervasive multi-site changes (Phase 6), per-commit `git revert` + redeploy is the
primary revert path.

### Layer 3 — Feature flags (CF `[vars]` are STRINGS)
CF `[vars]` are strings. The repo proves it: every flag uses
`env.X === 'true' || env.X === '1'` (gchat lines 9399, 14946, 21127; helper at
16658). A naive `if (env.FLAG)` treats `"false"` as truthy. **Mandate:** every
new flag branches on `env.FLAG === 'true'` (or reuses the line-16658 helper).
Phase 0 verifies the committed string value (existing flags in `wrangler.toml`
already contradict their "Default off" comments — trust the value, not the
comment). Flags are used for `FIX_CONTACT_LOOKUP` (Phase 5). For Phase 6, see the
note in that phase — a flag may be more trouble than git-revert.

### Layer 4 — Known-good tag
`pre-audit-fixes-2026-05-22` tags current `main`. Reset + redeploy = full source
restore (subject to Layer-1 D1/KV caveats).

### KV-repair contingency (Phase 6 only)
Because Layer 1 cannot un-corrupt KV, before Phase 6 ships we author a read-only
script that detects doubled consecutive identical turns in a history blob and can
trim them. Authored *before* Phase 6, not after.

---

## 3. Phase 0 — Pre-flight (no behavior change)

| Step | Action |
|------|--------|
| 0.1 | Create + push tag `pre-audit-fixes-2026-05-22` on current `main` |
| 0.2 | Record active deployment IDs for all 3 workers → Appendix A |
| 0.3 | Run all existing test suites; establish a green baseline (document pre-existing failures) |
| 0.4 | Add `.dev.vars` + `*.dev.vars` to `.gitignore` |
| 0.5 | Verify the committed string value of every `[vars]` flag in all 3 wrangler.toml files |
| 0.6 | `wrangler queues list` — confirm whether `stratus-gchat-crm-dlq` exists as a resource (see DLQ item) |
| 0.7 | Confirm whether any planned phase needs a D1 migration; if so author its forward-fix migration |

**GATE:** baseline green, tag pushed, deployment IDs + queue list recorded.

---

## 4. Corrected Finding Triage

### 4A. VERIFIED REAL BUGS — safe to fix (re-verified in Round 1/2)
| ID | Location | Bug | Class |
|----|----------|-----|-------|
| CRIT-3 | gchat:2552, webex:2993 | `eosLabel` ternary — both branches `'End of Sale'` (verified byte-identical) | A |
| CRIT-13 | webex:3284-3288 | `if (isAddPricing && !showPricing)` always false; live branch at 3279 already prices → **delete the block** | A |
| CRIT-8 | gchat:13203 | `zoho_delete_record` DELETE outside try/catch; a fetch-throw escapes the agentic loop | A |
| CRIT-7 | gchat:25482 | Queue consumer has no `__continuation` loop | B |
| CRIT-14 | webex:1674-1754 | `logShadowClassification` runs 11 DDL statements per request, no guard | B |
| CRIT-9 | gchat:19634, 23934 | Two `api.anthropic.com` literals bypass the gateway constant | B |
| CRIT-1 | gchat:1170 | `substring(-8)` in the `generateUndoToken` **fallback** path (dead in prod) | A (cosmetic) |
| CRIT-11 | webex:7773 (root cause = L-15) | `logBotUsageToD1` telemetry lost; `env.ctx` never assigned | C |
| CRIT-4 | gchat:6094 **ONLY** | `fetchPrimaryContactForAccount` searches a lookup field by record ID | C |
| EXT-CRIT-1 | zoho-content.js:168 | `{...ctx}` clobbers `message.type` with `'zoho'` | B |
| EXT-CRIT-2 | OptionsPage.jsx:145 | `ZOHO_DISCONNECT` string has no handler | B |
| EXT-CRIT-3 | background/index.js:201 | `EMAIL_SENT` handler destructures flat, payload is `{data:{...}}` | B |
| EXT-CRIT-4 | notifications.js:49 | `NAVIGATE_TO_TASKS` has no case in the content-script switch | B |

### 4B. VERIFIED NON-BUGS — DROPPED
| ID | Why it is not a bug |
|----|---------------------|
| CRIT-10 | `enrichCompanyV2` + TTL constants already at module scope. |
| CRIT-12 | Vision `slice(2)` correctly extracts the 3-part-split tail. |
| CRIT-2 | Undo regex matches all real (hex) tokens. (Widening is optional cleanup.) |
| CRIT-4 sites 9112, 9128, 10752, 10952 | Correct today — Accounts primary field or legacy name lookup. |
| CRIT-6 | `lastUserMsg.content` is already guarded by `lastUserMsg &&` at gchat:24948. |
| CRIT-5 (as scoped by the audit) | The audit's site list is wrong. The *real* narrow double-write is addressed in Phase 6 with a corrected design. |

### 4C. RECLASSIFIED
| ID | Reclassification |
|----|------------------|
| DLQ | **NOT a code bug.** A DLQ does not need `[[queues.producers]]`; CF auto-routes. It needs the queue *resource* to exist. Phase 0.6 checks via `wrangler queues list`. Action depends on the result. |

---

## 5. Phased Rollout — Two Waves

### WAVE 1 — Verified, low-risk fixes (do these first)

#### Phase 1 — Class-A (one PR: worker + worker-gchat)
**Changes:**
- **CRIT-3** — `eosDate <= now ? 'End of Sale (passed)' : 'End of Sale'` (mirrors the adjacent `eostLabel` convention). Both workers.
- **CRIT-8** — try/catch around the `zoho_delete_record` DELETE (gchat:13203). The catch MUST return the same shape as the existing error branch (13222-13228): `{ success:false, error:'Delete failed: '+e.message, _no_partial_success:true, message:'Delete did NOT succeed. Do not claim '+module_name+'/'+record_id+' was deleted.' }`. The catch should also call `logCrmOpToD1` (best-effort), matching the existing error branch (13207-13221), so a thrown DELETE still produces a CRM-op telemetry row.
- **CRIT-13** — delete the dead block webex:3284-3288.
**Verification:** dry-run; test suites; smoke-test EOL query on both bots;
smoke-test an "add pricing" follow-up (confirm no duplicate pricing block).

#### Phase 2 — Undo token + API URL (one PR: worker-gchat)
**Changes:**
- **CRIT-1** — `substring(-8)`→`slice(-8)` in the `generateUndoToken` fallback. Cosmetic; the fallback is dead in production.
- **CRIT-9** — route the two `api.anthropic.com` literals (19634, 23934) through the gateway **while preserving a direct-API fallback**. `ANTHROPIC_API_DIRECT` (line 22) is an intentional fallback; `askClaudeContinue` (14890) deliberately fails over to it. The fix replicates that gateway→direct pattern.
**Verification:** dry-run; undo-token tests; create→undo smoke test; smoke-test `/api/detect-account`.

#### Phase 3 — Queue consumer + DDL guard + DLQ (one PR: worker-gchat)
**Changes:**
- **CRIT-7** — after gchat:25483 add: `while (result && result.__continuation) { result = await askClaudeContinue(result.messages, result.tools, result.systemPrompt, result.iteration, env, progressCallback, 300000, personId); }` (mirrors the handoff loop at 22628-22634).
- **CRIT-14** — guard the DDL only: `if (!globalThis.__shadowTableReady) { <run CREATE + 10 ALTER>; globalThis.__shadowTableReady = true; }`. The INSERT still runs every call.
- **DLQ** — per Phase 0.6: if `stratus-gchat-crm-dlq` exists, add a wrangler.toml comment only; if absent, `wrangler queues create stratus-gchat-crm-dlq`.
**Note for Phase 6:** the queue consumer also writes history at 25505. Today
non-continuation queue jobs **double-write** (askClaude internal + 25505);
continuation jobs single-write via 25505. Both branches are mapped in D1.
**Verification:** dry-run; enqueue a long CRM job in a test space if possible.

#### Phase 4 — CRIT-11 telemetry (one PR: worker)
**Blocked by Discovery D4.**
**The bug line is webex:7773 — INSIDE `askClaude`**, not a call site.
**Fix:** add a `ctx` parameter to `askClaude` (signature at webex:7286) and pass
the real `ctx` from all 8 call sites (8159, 8570, 8677, 8723, 8932, 8947, 8977,
8997); use it as `ctx.waitUntil(logBotUsageToD1(...))` at 7773. **Threading is
preferred over `env.ctx = ctx`** — assigning onto `env` is observable by
concurrent requests and can attach a `waitUntil` to the wrong request's
lifetime. Also migrate the existing dead `env.ctx` readers at webex:7321-7322 to
the threaded `ctx`, or they remain broken.
**Verification:** dry-run; confirm a D1 row with `cost_usd` for a fast request.

**WAVE 1 GATE:** all four phases deployed and observed clean in production before
Wave 2 is even scheduled.

---

### WAVE 2 — Behavioral changes (higher risk; RECOMMEND deferring until Wave 1 is proven)

These two fixes change paths the bot currently relies on. Recommendation: do not
attempt them in the same sitting as Wave 1. Land Wave 1, watch it for a real
period, then decide on Wave 2 separately. Both are blocked on discovery tasks.

#### Phase 5 — Account_Name lookup, line 6094 ONLY (one PR, FLAG-GATED: worker-gchat)
**Blocked by Discovery D2.**
**Concrete fix:** rewrite `fetchPrimaryContactForAccount` (gchat:6089-6098) as a
COQL POST, behind `FIX_CONTACT_LOOKUP === 'true'`:
```
zohoApiCall('POST', 'coql', env, { select_query:
  "select id,First_Name,Last_Name,Full_Name,Email,Secondary_Email,Phone,Mobile,Title,"
  + "Account_Name,Mailing_Street,Mailing_City,Mailing_State,Mailing_Zip "
  + "from Contacts where Account_Name = '" + accountId + "' "
  + "order by Modified_Time desc limit 1" })
```
This mirrors the **proven lookup-by-ID COQL** at gchat:10870 (`where Account_Name
= '<id>'`, the exact bare form used above) — NOT the email-LIKE COQL at 6157.
(gchat:23188 does the same lookup with the equivalent dotted form
`Account_Name.id = '<id>'`; both forms work in Zoho COQL — use the bare form to
match 10870.) Notes:
- The search-API params `sort_by=Modified_Time&sort_order=desc&per_page=1` must be
  translated to COQL `order by Modified_Time desc limit 1` (done above).
- **D2 must validate the entire select field list against the live org** — COQL
  rejects some fields the search API tolerates. Drop any field D2 flags.
- COQL response shape: `r.data` is the rows array (same as search) — the existing
  `r?.data?.[0]` access is unchanged.
**Why flag-gated:** the query currently always returns 0 results, so only the "no
contact found" branch has ever run. The fix activates the less-tested "contact
found" branch. Flag = instant revert.
**Out of scope:** sites 9112/9128/10752/10952 — correct today, do not touch.
**Verification:** D2 confirms COQL syntax + field list against live Zoho via the
ZohoCRM MCP tools; smoke-test primary-contact resolution for a known account.

#### Phase 6 — History double-write (DEFERRED — recommended)
**Status: NOT designed. Do not schedule until Discovery D1 is complete and reviewed.**

The history double-write is real but **bounded** — on non-continuation paths
where both `askClaude` and the caller write, a turn is recorded twice (history
grows ~2x). The bot works well despite it; it is NOT a crash or data-loss bug.

**Why this phase is deferred, not specified:** all three review rounds each
uncovered new landmines in every concrete fix design attempted:
- `askClaude` writes history only on non-continuation; `askClaudeContinue` never
  writes — so "redundant" caller writes are the *sole* writer on continuation
  paths (Round 1).
- The sync GChat fallback relies on `askClaude`'s internal write as the SOLE
  writer — gating it off erases history on the most common bot path (Round 2).
- The waterfall reaches `askClaude` via `askClaudeForBenchmark` (which is ALSO
  the eval-harness entry point — non-trivial blast radius); the Gmail-share path
  and the handoff's 2nd `askClaude` call site are additional unlisted
  double-writers; a `didContinue` flag does NOT survive Cloudflare Workflow
  hibernation in `CrmWorkflow` (must be returned from the `step.do` result); and
  `/_work`'s write is a non-continuation write that should simply be deleted, not
  made conditional (Round 3).

A fix is achievable, but only AFTER an expanded **D1** produces a complete,
verified writer map. **D1 is the deliverable for this phase — not a fix.** Once
D1 exists, a corrected design (likely direction: `askClaude` and
`askClaudeForBenchmark` gain a `skipHistory` parameter; exactly one writer per
fully-enumerated path) can be drafted and put through its own review round.

**Recommendation:** defer Phase 6 indefinitely unless the doubled history is
causing an *observed* problem (e.g. premature context truncation in long
conversations). The regression risk outweighs the benefit of halving history
size. If later pursued: its own PR, per-commit `git revert` is the revert path,
and the KV-repair script must exist first.

---

### WAVE 3 — Cleanup (low urgency)

#### Phase 7 — Mechanical refactors (one PR: worker-gchat)
org-ID → `ZOHO_ORG_ID` constant (grep-confirm the count first); `addBusinessDays`
→ one shared util; Velocity Hub URL → `env.VELOCITY_HUB_URL` with the current URL
as fallback default. Verification: grep shows zero remaining literals; constant
`===` old literal; spot-check 5 URLs byte-for-byte.

#### Phase 8 — Chrome extension (one PR — separate pipeline)
**Changes (all 4 verified real in Round 2):**
- EXT-CRIT-1 — `chrome.runtime.sendMessage({ ...ctx, type: 'ZOHO_CONTEXT_CHANGED' })` (spread first, type last).
- EXT-CRIT-2 — add `ZOHO_DISCONNECT` to `MSG` in constants.js; register `[MSG.ZOHO_DISCONNECT]: async () => disconnectZoho()` in background/index.js (`disconnectZoho` is already imported, unused); update OptionsPage.jsx:145 to `sendToBackground(MSG.ZOHO_DISCONNECT)`.
- EXT-CRIT-3 — handler-side fix in background/index.js:201: `async ({ data }) => { const { recipients, subject, sentAt } = data || {}; ... }`.
- EXT-CRIT-4 — add `case 'NAVIGATE_TO_TASKS':` to the content/index.js switch (1777-1794) forwarding to the sidebar; add the constant. Depends on EXT-CRIT-3 (else the notification is never shown).
**Rollback:** Chrome will NOT auto-downgrade. Revert = rebuild from the tag, bump
the version UP, AND republish `update-manifest.xml`; propagation is not instant.
**Verification:** load unpacked, exercise each fixed path in a browser.

#### Phase 9 — Org/infra cleanup (Class E — per-item explicit approval)
Branch deletion, root `index.js`/`data/` removal, stale `stratus-bot-v2` worker
deletion, test-file reorg, open-PR resolution. Each destructive item needs a
separate explicit go-ahead. Nothing bundled.

---

## 6. Discovery Tasks (MUST finish before the dependent phase)

| ID | Task | Blocks | Method |
|----|------|--------|--------|
| **D1** | Complete, verified history-writer map — the prerequisite *deliverable* for Phase 6. Trace the full call chain for every path that can write conversation history and identify the sole-vs-duplicate writer on each branch (continuation AND non-continuation). MUST cover: top-level `askClaude`, `askClaudeContinue`, `askWithWaterfall`; the wrapper `askClaudeForBenchmark` (the real waterfall→Claude hop — and the eval-harness entry point, so note its blast radius); the wrapper handlers `processGmailShareToChat` and `processEmailThread`; and every ingress path — `/_work`, `/_continue`, `/api/chat`, `/api/chat-waterfall` (each waterfall tier), `/api/quote`, CrmWorkflow, queue consumer, handoff (BOTH `askClaude` call sites — 22652 and 22671), sync GChat fallback (25226/25236/25245), gmail-addon dashboard (20765), EOL/gmailShare (24817). Output: a table of every `addToHistory` call with sole/duplicate status per branch. | Phase 6 | Code read |
| **D2** | Verify the exact COQL `select` field list AND the lookup-by-ID WHERE clause for Contacts-by-Account-ID, against the live org. | Phase 5 | ZohoCRM / COQL MCP tool on a real account |
| **D4** | Confirm the `askClaude` `ctx`-threading plan: 8 call sites, signature change, and that webex:7321-7322 migrate cleanly. | Phase 4 | Code read |
| **D6** | `wrangler queues list`; confirm D1-migration needs per phase. | Phase 0 / Phase 3 | wrangler CLI |

---

## 7. Open Questions for Chris

- **Q1 — DLQ:** if `wrangler queues list` shows `stratus-gchat-crm-dlq` is missing,
  create it (recommended) or remove the `dead_letter_queue` line?
- **Q3 — Flag default:** ship `FIX_CONTACT_LOOKUP` **OFF** (deploy dark, flip on
  after observation) — recommended.
- **Q4 — Email responder (PR #80):** live worker, source not in `main`. Fold in or
  keep separate?
- **Q5 — Scope (IMPORTANT):** recommend executing **Wave 1 only** for now (all
  verified, low-risk), proving it in production, then deciding on Wave 2
  separately — rather than attempting everything at once. Phase 6 in particular
  may be best deferred indefinitely. Confirm this staged approach?

---

## 8. Per-Worker Deploy Protocol (every phase)

1. Re-verify the phase's findings against current code.
2. `wrangler deploy --dry-run` — must pass.
3. Run that worker's test suite — must pass.
4. Merge the phase PR to `main`.
5. Deploy one worker; record the new deployment ID.
6. Observe (smoke tests + real traffic) for an agreed window.
7. At any regression: `wrangler rollback` + diagnose.

---

## 9. Consciously Deferred / Out of Scope (decision, not omission)

- Audit Part-2 logic errors L-1..L-14 — except **L-9** (`TOOL_SUBSETS.subscription`
  missing `create_quote_on_deal`) and the **cron-corruption** findings (gchat
  `unescape` 25911, silent GitHub PATCH failure 25968), which are real and
  promoted to candidate future phases pending verification.
- Audit Part-3 config mismatches not in Phase 7 — deferred, low risk.
- Email responder bugs (audit Part 10) — deferred via Q4.
- Part 5/6 dead-code and duplicate-logic cleanup — deferred, cosmetic.

---

## Appendix A — Rollback Reference (filled in Phase 0)

| Worker | Pre-change deployment ID | Recorded |
|--------|--------------------------|----------|
| stratus-ai-bot | _TBD_ | ☐ |
| stratus-ai-bot-gchat | _TBD_ | ☐ |
| stratus-ai-bot-gateway | _TBD_ | ☐ |

Known-good git tag: `pre-audit-fixes-2026-05-22` — ☐ created ☐ pushed
`wrangler queues list` output — ☐ recorded

---

## Appendix B — Review History

- **Round 1** — verified plan v1 against source. 3 Blockers, 5 High, 5 Medium, 5
  Low. Dropped audit CRIT-10/12 as non-bugs; scoped CRIT-4 to one site; inverted
  the CRIT-5 approach; mandated feature-flag string semantics; documented
  `wrangler rollback` limits.
- **Round 2** — verified plan v2. 2 Blockers (Phase 5 COQL exemplar wrong; Phase
  6 gating approach not implementable) + plan errors in Phase 3/4 wording and a
  false CRIT-6 "verified" label. Verified CRIT-3/7/8/14 and EXT-CRIT-1..4 as real;
  CRIT-6 confirmed non-bug; DLQ reclassified.
- **Round 3** — convergence review of v3. **Verdict: Wave 1 (Phases 1-4) has
  converged — verified safe to execute after D4/D6.** Wave 2 needs more work:
  Phase 6's class taxonomy was still incomplete (missed the `askClaudeForBenchmark`
  hop, the Gmail-share double-write at 24817, the handoff 2nd call site at 22671,
  Workflow hibernation of `didContinue`, and `/_work`'s structure); Phase 5's
  exemplar citation was imprecise; CRIT-8 catch omitted a telemetry call.
- **Round 4 (folded into v4)** — Phase 6 no longer presents an authoritative
  design: it is explicitly DEFERRED, with an expanded D1 as its sole prerequisite
  deliverable. Phase 5 citation corrected; CRIT-8 telemetry note added; D1 scope
  expanded to trace `askClaudeForBenchmark` and the wrapper handlers.

---

*v4. Wave 1 (Phases 1-4) has passed three review rounds and is ready for Chris's
approval. Wave 2: Phase 5 is gated and blocked on D2; Phase 6 is deferred pending
the expanded D1. Nothing is executed until explicitly approved by Chris.*
