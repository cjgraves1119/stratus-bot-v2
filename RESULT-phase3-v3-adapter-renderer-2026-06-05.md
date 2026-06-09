# RESULT — Phase 3: buildQuoteFromV3 + standalone-license-group renderer

**Date:** 2026-06-05 · **Branch:** `feat/v3-quote-render` (off `fix/quoting-per-item-intent` `fbac778`)
**Account:** personal (ec1888) only · **Status:** validated, NOT deployed/merged (awaiting Chris)

## What was built
1. **`buildQuoteFromV3(v3, rawText)`** (`worker/src/index.js`, after `buildQuoteFromV2`): converts the V3
   classifier contract (per-item `{product, qty, intent}`, top-level `clarify`, NO model SKUs) into a `parsed`
   object in the SAME shape `buildQuoteFromV2` returns — so the caller's existing `buildQuoteResponse(qp)` seam is
   unchanged. Each item is synthesized to NL (`synthV3Item`, mirrors the proven eval `synthV3`) and run through
   `parseMessage` **in isolation** (this is what prevents the bare-family sibling-drop), then per-item
   `hardwareOnly`/`licenseOnly` are stamped and the items flattened into one `parsed.items[]`.
2. **Pre-resolved-license branch** in `buildQuoteResponse`'s resolution loop (the "standalone-license-group
   renderer"): when a flattened item is a bare `LIC-*-{term}` SKU (named/term-option licenses — Duo, Umbrella,
   SME, AnyConnect, attached MX-ENT), place it at its own term as an agnostic license-only item (mirrors the
   `MR-AGN` path). The existing term loop + `buildStratusUrl` then group it one-per-term and SUM shared SKUs.

## Council design vs. what shipped (a real correction)
The 3-architect / 3-judge council unanimously picked "open-robust" (flatten → single `buildQuoteResponse`, "no new
renderer code"). **Empirical verification proved that insufficient:** named term-option licenses
(`isTermOptionQuote`) carry already-resolved `LIC-*-{term}` SKUs that the default branch can't resolve —
`cov:sme-1-3yr-cap` rendered EMPTY (`llm`), and Duo **mis-grouped** (all three term SKUs leaked into every term
URL). The surgical pre-resolved-license branch (22 lines) fixes both within the single-pass design. Lesson: the
council got the skeleton right; only adversarial empirical testing caught the term-option gap.

## Verification (all green)
- **498/498** existing engine regression suite (`worker/test-local.js`) — the shared-renderer change regresses nothing.
- **36/36 (100%)** full-corpus live, N=10 (`CONSUMER=v3prod`: live V3 classifier → `buildQuoteFromV3` →
  `buildQuoteResponse`) — equals the `consumeV3` oracle, now with REAL URL grouping. Only the known diagnostic
  `parked:bare-family-drop-mv` fails (out of scope). 0 JSON errors, 380/380 calls.
- **9/9** offline grouping probe (`probe-v3prod-grouping.cjs`) incl. a strict per-term no-leak invariant:
  - `cov:duo+mr-normal`: 1Y url = DUO-1YR+MR44-HW+ENT-1YR, 3Y = …-3YR, 5Y = …-5YR (no term-leak).
  - `cov:sme-1-3yr-cap`: SME-1YR + SME-3YR, **no 5YR** (cap respected).
  - `order:liconly+bareNormal`: shared `LIC-ENT` **summed to qty 2** (production beats `consumeV3`'s MAX-of-1).
  - hardware-only items carry no license; license-only items carry no hardware; EOL + separate_quotes intact.

## Scope / not done
- **gchat `/api/quote`** classifier+adapter wiring = Phase 4 (separate). Webex-first per the design.
- The V3 prompt variant + `prompt_override` are not yet in this branch's `/api/benchmark-classifier` (the eval
  serves the classifier from the feat-v3 worker, which has them; engine = this branch). Porting the V3 variant
  into this branch's benchmark endpoint is a Phase-6 wiring task.
- NOT wired into the production hot path; V2 stays live until the Phase-6 gate + Chris's approval.

## Reproduce
```
# classifier server (has prompt_override): from /tmp/feat-v3/worker → wrangler dev --remote :8787
cd /tmp/phase3 && node probe-v3prod-grouping.cjs   # offline grouping (no server)
BASE_URL=http://127.0.0.1:8787 PROMPT_FILE=CF_CLASSIFIER_PROMPT_V3-draft-2026-06-04.js \
  CONSUMER=v3prod ENGINE_DIR=/tmp/phase3/worker N=10 node eval-model-intent-2026-06-04.js
cd /tmp/phase3/worker && node test-local.js   # 498/498 regression
```

## Adversarial review round (3 reviewers, empirical) — 3 high-sev defects found & fixed (commit fd7b535)
The first cut (commit 7e7b88b) passed 36/36 + 498/498, but an adversarial pass caught 3 real defects the
38-item corpus never exercised — all now fixed:
1. **SME 5yr cap broken** — `SME@5yr` dropped the line / emptied the quote (no 5Y→3YR fallback), and the
   cap NOTE was dropped. Violated the documented SME-cap business rule.
2. **`separate_quotes` + named multi-term license** → dangling empty headers / link-less "quote".
3. **MS "advanced" (tier="A") downgraded to Essentials** when rawText didn't contain the literal "advanced".

**Fix:** `buildQuoteFromV3` now **collapses** each named license (directLicense/directLicenseList/
isTermOptionQuote) into ONE multi-term `_v3PreLicense` item (a new `buildQuoteResponse` resolution branch,
mirrors `MR-AGN`) — so it renders as one clean group under separate_quotes, one-per-term in default, with a
natural home for the SME 5Y→3YR cap (gated on an explicit 5yr request) + the cap note (now also prepended in
the default renderer). Tier is taken from the engine's per-item resolution instead of re-derived from rawText.
Reviewer dims (a) regex and (b) renderer-safety were proven SOUND (no leak; 498/498 holds).

**Post-fix verification:** 498/498; 9/9 grouping probe; native-vs-V3 differential (SME no-term/5yr,
separate_quotes, MS-advanced all match/beat native); 8/8 named-license families (Duo/Umbrella/AnyConnect/
agnostic/SME/multi-list — V3 ⊇ native, keeps siblings native drops); 8/8 edge cases (AnyConnect 25-user
clamp 10→25, empty/0/negative/missing-intent, garbage-among-good survives, all-garbage→fallback, clarify
passthrough). Full-corpus live N=10 = **35/36** — the one miss (`cov:mr-3yr-normal`) is upstream classifier
intent variance (intent=license on 2/10 runs); deterministic offline = correct. That's a **Phase-2 prompt**
item, not a Phase-3 engine defect.
