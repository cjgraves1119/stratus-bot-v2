# RESULT — Live V3 classifier A/B (Phase 2b gate)

**Date:** 2026-06-05 · **Branch:** `feat/model-intent-quoting` · **Account:** personal (ec1888, chrisg-ec1) only
**Harness:** `eval-model-intent-2026-06-04.js` (LIVE classifier `@cf/meta/llama-4-scout-17b-16e-instruct`
via `/api/benchmark-classifier` over `wrangler dev --remote :8787` → DETERMINISTIC engine)
**Engine (held constant):** `/tmp/parked-engine/worker` (`fix/quoting-per-item-intent`, HEAD `fbac778`)
**Stability:** N=10 runs/input. **stable+correct = passes all 10 runs AND identical signature across all 10.**
**Corpus:** 36 headline items (CORE 16 / EXTENDED 7 / COVERAGE 13) + 2 DIAGNOSTIC (parked, excluded from headline).

## Headline

| Pipeline | stable+correct (headline /36) | CORE | EXTENDED | COVERAGE |
|---|---|---|---|---|
| **V2** (current prompt + v2 adapter) | **24/36 (67%)** | 10/16 (63%) | 6/7 (86%) | 8/13 (62%) |
| **V3** (per-item contract + v3 adapter, qty-fixed) | **36/36 (100%)** | 16/16 | 7/7 | 13/13 |

**+12 items, +33 points, zero regressions** — V3 passes every item V2 passed, plus all 12 V2 missed.
Same live model, same engine, same corpus, same N — the **only** variable is the classifier contract.
The same-session V2 number (67%) corroborates the previously documented ~61% baseline.

## Overfitting control (honest generalization check)

9 of 36 headline corpus inputs are **verbatim** V3 prompt examples (in-distribution). Partitioning:

| Slice | V2 | V3 |
|---|---|---|
| in-distribution (9 verbatim examples) | 3/9 (33%) | 9/9 (100%) |
| **HELD-OUT (27 non-example items)** | **21/27 (78%)** | **27/27 (100%)** |

V3 wins **+22 points on held-out items alone** (78%→100%) — the gain is generalization, not memorization.
**Caveat:** "held-out" = not a *verbatim* example; several are still close paraphrases of the same intent
families (the corpus is bug-#2-shaped). A genuinely novel-phrasing corpus is a **Phase-6 pre-rollout** task.

## Why V2 loses (correctness, not flakiness)

V2 is **fully stable** (16/16, 13/13 stable) but **wrong** on 12 — it reliably emits SKUs and reliably
mishandles per-item intent. The 12 V2 misses are exactly the bug-#2 cases the re-architecture targets:
`mixed:lic+lic+hwonly`, `order:hwonly+normal`, `then:renew+hardware(+no-add)`, `list:trailing-licenses`,
`guard:hardware-noun`, `clarify:hardware-refresh-no-target`, `cov:duo+mr-normal`, `cov:duo-adv-3yr+mr-hwonly`,
`cov:umbrella+mx-normal`, `cov:sme-1-3yr-cap`, `cov:clarify-upgrade-firewalls`. V3 fixes all of them.

## Finding: prompt JSON-format bug (fixed this session)

First V3 run scored 30/36 (83%) — depressed by a *prompt* bug, not an architecture ceiling. The Llama
classifier emitted the `qty` key **unquoted** inside `items` (`{"product":"mx67 SEC",qty:10,...}` → `JSON.parse`
throws), flakily, because **every example in the V3 prompt body used unquoted shorthand** `qty:N`. Fix
(in `CF_CLASSIFIER_PROMPT_V3-draft-2026-06-04.js`): quote `qty` in all examples + an explicit strict-JSON
closing directive (`write "qty":10 NEVER qty:10`). Re-run: **36/36, zero JSON parse errors.**

→ **Carry into Phase 6:** when the V3 prompt moves into `worker/src/index.js`, it MUST keep quoted-`qty`
examples + the strict-JSON directive. (Optional defense-in-depth: lenient bare-key repair before the
classifier `JSON.parse` — separate, touches the hot path, not required by this result.)

## DIAGNOSTIC tier (parked, out of scope — proves grader isn't rubber-stamping)

`parked:bare-family-drop-mv` ("4 mv and 6 mr44") → V3 **0/10** (still drops the MV sibling).
`parked:bare-family-drop-mx` ("6 mr renewal and 1 mx67") → V3 10/10 (resolves under V3+parked-engine).
Both are **stable**; the grader correctly fails the still-broken one. These are the parked bare-family
sibling-drop cases — explicitly out of scope.

## Gate verdict

V3 **clears the Phase-1/2 gate**: fixes the entire bug-#2 regression suite, beats V2 decisively on both
in-distribution and held-out slices, zero regressions, fully stable across 10 runs. Cleared to proceed to
**Phase 3** (`buildQuoteFromV3` + standalone-license-group renderer). **Not** wired into the production hot
path; V2 remains live until the Phase-6 gate + Chris's approval.

## Reproduce

```
# server (personal account; CF global key sourced from ~/.stratus-secrets)
cd /tmp/feat-v3/worker && wrangler dev --remote --port 8787 --ip 127.0.0.1
# V3 (winning)
cd /tmp/feat-v3 && BASE_URL=http://127.0.0.1:8787 PROMPT_FILE=CF_CLASSIFIER_PROMPT_V3-draft-2026-06-04.js \
  CONSUMER=v3 ENGINE_DIR=/tmp/parked-engine/worker N=10 node eval-model-intent-2026-06-04.js
# V2 baseline (drop PROMPT_FILE, CONSUMER=v2)
```
Logs: `/tmp/v3-ab-n10.log` (before-fix 30/36), `/tmp/v3-ab-n10-fixed.log` (36/36), `/tmp/v2-baseline-n10.log` (24/36).
