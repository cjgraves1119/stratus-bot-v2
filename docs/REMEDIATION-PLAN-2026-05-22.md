# Stratus Bot v2 — Audit Remediation Plan
**Date:** 2026-05-22
**Companion to:** `docs/AUDIT-2026-05-22.md`
**Status:** DRAFT v1 — under multi-round review, NOT approved, NO code changed

---

## 1. Objective & Hard Constraints

The bot is currently in a known-good, well-functioning state. The goal is to fix
the audit findings **without regressing any working behavior**. Constraints:

1. Every change must be individually revertable.
2. The highest-risk behavioral changes must be toggleable **without a redeploy**.
3. Nothing reaches production without: `wrangler deploy --dry-run` pass +
   relevant test-suite pass + a manual smoke test on the live bot.
4. Workers deploy **one at a time**, with an observation window between each.
5. If anything looks wrong, we revert first and diagnose second.

---

## 2. Rollback Architecture — 4 Independent Layers

The user's explicit requirement: a worst-case "put everything back exactly as it
is right now" button. There are four layers, strongest first:

### Layer 1 — Cloudflare deployment rollback (INSTANT, no code, no git)
Before any deploy, record the **currently active deployment ID** for each worker.
Cloudflare retains deployment history. `wrangler rollback <deployment-id>` (or the
dashboard → Deployments → Rollback) restores the previous live worker in seconds.
**This is the worst-case "everything back to now" button.** It is independent of
git and works even if the repo is in a broken state.

### Layer 2 — Git atomic revert
Each logical fix = exactly one commit. `git revert <sha>` cleanly undoes any
single fix without disturbing the others.

### Layer 3 — Feature flags (revert behavior with no redeploy)
The two highest-risk behavioral fixes (history de-dup, contact-lookup) ship
behind `wrangler.toml [vars]` booleans. Flipping the var in the Cloudflare
dashboard reverts that behavior live, with no code change and no redeploy.

### Layer 4 — Known-good tag (nuclear restore)
`pre-audit-fixes-2026-05-22` tags the exact current `main`. `git reset --hard`
to that tag + redeploy = total restoration of source + live workers.

---

## 3. Phase 0 — Pre-flight (no behavior change, do this first)

| Step | Action |
|------|--------|
| 0.1 | Create + push tag `pre-audit-fixes-2026-05-22` on current `main` |
| 0.2 | Record active deployment IDs for `stratus-ai-bot`, `stratus-ai-bot-gchat`, `stratus-ai-bot-gateway` — paste into this doc's Appendix A |
| 0.3 | Run ALL existing test suites (`worker/test-*.js`, `worker-gchat/test-*.js`) to establish a green baseline. If any are already failing, document which — we must not be blamed for pre-existing failures |
| 0.4 | Add `.dev.vars` and `*.dev.vars` to `.gitignore` (only safe Phase-0 code change) |

**GATE:** baseline tests green (or pre-existing failures documented), tag pushed,
deployment IDs recorded.

---

## 4. Risk Classification

Every fix is classed A–E. Higher class = more caution, later phase.

| Class | Meaning | Examples |
|-------|---------|----------|
| **A** | Zero behavior risk — display-only, defensive guard, or grep-proven dead code | eosLabel string, null guards, try/catch |
| **B** | Confirmed bug, deterministic fix, tiny blast radius | undo token, API URL constant, vision slice |
| **C** | Fix is correct but **changes a path the bot currently relies on** | history de-dup, Account_Name query, handleFollowUpModifier |
| **D** | Mechanical mass-edit — low logic risk, high typo risk | org-ID constant (62 sites), addBusinessDays de-dup |
| **E** | Org/infra cleanup — destructive or out-of-band | branch deletion, file removal, stale worker deletion |

### Classification of every audit finding

| Finding | Class | Phase |
|---------|-------|-------|
| CRIT-3 eosLabel ternary (both workers) | A | 1 |
| CRIT-6 lastUserMsg null guard | A | 1 |
| CRIT-8 zoho_delete_record try/catch | A | 1 |
| CRIT-12 vision slice(2)→slice(1) | A→B | 1 |
| CRIT-11 logBotUsageToD1 → ctx.waitUntil | B | 1 |
| CRIT-1 + CRIT-2 undo token (slice + regex) | B | 2 |
| CRIT-9 hardcoded Anthropic URL → constant | B | 2 |
| CRIT-7 queue consumer continuation loop | B→C | 3 |
| CRIT-14 logShadowClassification DDL guard | B | 3 |
| CRIT-5 history double-write (5 paths) | **C** | 4 (flag-gated) |
| CRIT-4 Account_Name.id query (5 sites) | **C** | 5 (flag-gated) |
| CRIT-13 handleFollowUpModifier dead branch | **C** | 6 |
| CRIT-10 enrichCompanyV2 hoist to module scope | C | 6 |
| Dead-letter queue declare/remove | B | 3 |
| org-ID → ZOHO_ORG_ID constant (62 sites) | D | 7 |
| addBusinessDays de-dup (4 copies) | D | 7 |
| Velocity Hub URL → env var | B | 7 |
| Chrome extension bugs (EXT-CRIT-1..4) | B/C | 8 |
| Branch / file / stale-worker cleanup | E | 9 |

---

## 5. Phased Rollout

Each phase = **one PR**, separately reviewable, separately revertable. A phase
does not start until the previous phase is deployed and observed clean.

### Phase 1 — Class A + safest B (one PR, worker + worker-gchat)
**Changes:** eosLabel strings; lastUserMsg null guard; zoho_delete_record
try/catch; vision `slice(1)`; logBotUsageToD1 in `ctx.waitUntil`.
**Why safe:** display strings change nothing functional; guards only trigger on
paths that *currently crash*; `slice(1)` only affects already-broken metadata
parsing; waitUntil only affects telemetry, never user-facing output.
**Pre-req for logBotUsageToD1:** confirm `env.ctx` is actually populated at that
call site (audit flagged `env.ctx` as a non-standard shape — see Discovery D4).
**Verification:** dry-run; full test suites; smoke-test an EOL date query on both
bots; smoke-test a brand-new GChat session (empty history).
**Rollback:** `git revert` the PR, or `wrangler rollback`.

### Phase 2 — Undo token + API URL constant (one PR, worker-gchat)
**Changes:** CRIT-1 `substring(-8)`→`slice(-8)`; CRIT-2 regex
`[a-f0-9]`→`[0-9a-z]`; CRIT-9 two `api.anthropic.com` literals → `ANTHROPIC_API_URL`.
**Coupling:** CRIT-1 and CRIT-2 **must ship together** — fixing one without the
other leaves token generation and validation mismatched.
**In-flight token safety:** new regex `[0-9a-z]{4,}` *accepts* the old longer
tokens (they are base-36, ≥4 chars), so undo tokens issued before the deploy
still validate. No in-flight breakage.
**API URL safety:** `ANTHROPIC_API_URL` is already used successfully elsewhere in
the same file — swapping the 2 stragglers to it is low-risk, but verify the
gateway path returns 200 in a smoke test.
**Verification:** dry-run; undo-token test files; smoke-test a create→undo cycle.

### Phase 3 — Queue consumer + DDL guard + DLQ (one PR, worker-gchat)
**Changes:** CRIT-7 add `__continuation` loop to queue consumer (mirror `/_work`);
CRIT-14 add `globalThis.__shadowTableReady` guard to logShadowClassification;
declare `stratus-gchat-crm-dlq` as a `[[queues.producers]]` OR remove the
`dead_letter_queue` line (decision needed — see Open Question Q1).
**Risk note:** the queue consumer change is C-leaning because it alters behavior
of an async path — but only for jobs that currently *fail silently*, so the
downside of the fix is bounded.
**Verification:** dry-run; if possible, enqueue a long CRM job in a test space.

### Phase 4 — History double-write (one PR, FLAG-GATED, worker-gchat)
**Blocked by Discovery D1.** Do not start until the writer-audit table exists.
**Changes:** behind `HISTORY_SINGLE_WRITE` flag, remove the *redundant* second
`addToHistory` calls — only on paths where `askClaude()` already wrote.
**Why flag-gated:** this changes the conversation-context length the bot has been
running with. Even though 2x history is a bug, the bot is "working well" *with*
that behavior; halving history depth could subtly change responses. The flag lets
us A/B and instantly revert.
**Verification:** D1 table proves each removal; multi-turn conversation smoke
test on both bots; confirm history length in KV is correct post-fix.

### Phase 5 — Account_Name lookup query (one PR, FLAG-GATED, worker-gchat)
**Blocked by Discovery D2.**
**Changes:** behind `FIX_CONTACT_LOOKUP` flag, change `Account_Name:equals:<id>`
→ verified-correct syntax at all 5 sites (6094, 9128, 9112, 10752, 10952).
**Why flag-gated:** this is the riskiest fix. The query *currently always returns
0 results*, so the bot has been running the "no contact found" branch
exclusively. Fixing it suddenly activates the "contact found" branch — which is
less battle-tested. The flag lets us turn the fix off instantly if the
contact-found path misbehaves.
**Verification:** D2 confirms syntax against live Zoho via the ZohoCRM MCP tools;
smoke-test deal/quote creation against a known account with a known contact.

### Phase 6 — handleFollowUpModifier + enrichCompanyV2 hoist (one PR, both workers)
**Blocked by Discovery D3.**
**Changes:** CRIT-13 fix the `showPricing` logic (requires knowing intent — D3);
CRIT-10 hoist `enrichCompanyV2` + TTL constants to module scope.
**Risk:** CRIT-13 *enables a currently-dead code branch* — that branch has never
run in production. Heavy smoke testing of add-pricing follow-ups required.
**Verification:** dry-run; smoke-test "add pricing" follow-up requests.

### Phase 7 — Mechanical refactors (one PR, worker-gchat)
**Changes:** org-ID → `ZOHO_ORG_ID` constant (62 sites); addBusinessDays → one
shared util; Velocity Hub URL → `env.VELOCITY_HUB_URL` (with the current URL as
the fallback default so behavior is identical if the var is unset).
**Risk:** logic-safe but typo-prone. Mitigation: after the mass-edit, `grep` must
show **zero** remaining `org647122552` literals, and a diff review must confirm
every replacement site still produces a byte-identical URL string.
**Verification:** dry-run; the constant must `===` the old literal; spot-check 5
generated URLs.

### Phase 8 — Chrome extension (one PR — separate deploy pipeline)
**Changes:** EXT-CRIT-1 publishContext type clobber; EXT-CRIT-2 ZOHO_DISCONNECT
handler; EXT-CRIT-3 EMAIL_SENT payload destructuring; EXT-CRIT-4 NAVIGATE_TO_TASKS.
**Risk:** isolated from the workers — the extension has its own build + its own
`update_url` auto-update. Revert = rebuild from the tag + bump version.
**Verification:** load the unpacked extension, manually exercise each fixed path
in a browser.

### Phase 9 — Org/infra cleanup (Class E — per-item explicit approval)
Branch deletion, root `index.js`/`data/` removal, stale `stratus-bot-v2` worker
deletion, test-file reorg, open-PR resolution. **Each destructive item requires
a separate explicit go-ahead from Chris.** Nothing here is bundled.

---

## 6. Discovery Tasks (MUST finish before the dependent phase)

| ID | Task | Blocks | Method |
|----|------|--------|--------|
| **D1** | Map every `askClaude()` call site and every `addToHistory()` call site; build a table of which paths write history and how many times. Identify the single canonical writer per path. | Phase 4 | Code read — no changes |
| **D2** | Verify the correct Zoho search/COQL syntax for a lookup field against the live org. | Phase 5 | Use `ZohoCRM_searchRecords` MCP tool to test `Account_Name.id` vs alternatives on a real account |
| **D3** | Determine the *intended* behavior of `showPricing` in handleFollowUpModifier — what was the dead branch supposed to do? | Phase 6 | Code read + git blame; if unclear → Open Question Q2 |
| **D4** | Confirm whether `env.ctx` is actually populated at worker/src/index.js:7773 (audit flagged it as non-standard). | Phase 1 | Code read of the webhook entrypoint |

---

## 7. Open Questions for Chris

- **Q1 — Dead-letter queue:** declare `stratus-gchat-crm-dlq` as a real queue, or
  remove the `dead_letter_queue` reference entirely? (Declaring it adds a real
  failure-capture queue; removing it accepts that exhausted-retry messages are
  dropped.)
- **Q2 — handleFollowUpModifier:** if D3 can't determine intent from the code,
  what *should* an "add pricing" follow-up do when the primary path fails?
- **Q3 — Feature-flag defaults:** should `HISTORY_SINGLE_WRITE` and
  `FIX_CONTACT_LOOKUP` ship **OFF** (deploy the code dark, flip on after
  observation) or **ON** (flip off only if trouble)? Recommended: ship OFF, flip
  on one at a time.
- **Q4 — Email responder (PR #80):** the worker is live but its source is not in
  `main`. Out of scope for this plan, or fold in?

---

## 8. Per-Worker Deploy Protocol (every phase)

1. `wrangler deploy --dry-run` in the worker dir — must pass.
2. Run that worker's test suite — must pass.
3. Merge the phase PR to `main`.
4. Deploy **one worker**. Record the new deployment ID.
5. Observe for an agreed window (smoke tests + real traffic).
6. Only then proceed to the next worker / next phase.
7. At any sign of regression: `wrangler rollback` to the recorded prior ID,
   then diagnose.

---

## Appendix A — Rollback Reference (to be filled in Phase 0)

| Worker | Pre-change deployment ID | Recorded |
|--------|--------------------------|----------|
| stratus-ai-bot | _TBD_ | ☐ |
| stratus-ai-bot-gchat | _TBD_ | ☐ |
| stratus-ai-bot-gateway | _TBD_ | ☐ |

Known-good git tag: `pre-audit-fixes-2026-05-22` — ☐ created ☐ pushed

---

*DRAFT v1. This plan is under adversarial review. It will not be executed until
reviewed, revised, and explicitly approved by Chris.*
