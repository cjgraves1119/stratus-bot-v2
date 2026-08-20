# Handoff: Stratus Quote 1.27.10 continuation

**To:** Claude (next session, zero context, different account, same Mac)
**From:** Claude Code (Opus 5), local agent mode on Chris's MacBook Air
**Date:** 2026-08-18
**User:** Chris Graves, Chicago, enterprise sales (Cisco/Meraki). ADHD.
**Supersedes:** `STRATUS-QUOTE-1.27.9-CLAUDE-HANDOFF.md` (Perplexity Computer). Read this one instead. The 1.27.9 file is still useful as background on the Bug 4 revert history, but every "not done yet" item in it is now done.

> **STATUS: SHIPPED AND VERIFIED.** All four fixes are implemented, both suites pass, the DEV extension is rebuilt, and the worker is deployed. Chris's live testing is the only step left. Section 1 records the Node situation, which was resolved mid-session.

---

## 0. How to talk to Chris

- ADHD. Short, scannable **Done / Left / Your move** updates. No prose walls.
- **Never use an em dash.** Anywhere. Especially in quote URLs, SKUs, and user-facing strings. Use commas or periods.
- No filler ("I will now generate", "Shall I proceed?").
- There is **no git repo** in this tree. Do not init one. Stopgap local edits, with timestamped backup copies next to the file.
- He is testing personally after each change, so tell him plainly which action unlocks which fix: Chrome reload vs worker deploy.

---

## 1. Node on this Mac (resolved, but read this)

For most of this session there was **no Node runtime** on the machine, so no test, build, or deploy could run. It is installed now, but the route matters if it ever has to be repeated.

**Homebrew does not work here.** `brew install node` aborts at its first step: Homebrew requires Apple's standalone Command Line Tools, and the Software Update server refuses to serve them:

> Can't install the software because it is not currently available from the Software Update server.

This is despite full Xcode being installed at `/Applications/Xcode.app` with `xcode-select` pointing at it. The standalone `/Library/Developer/CommandLineTools` is a separate package and it is still absent. Homebrew left nothing behind; `/opt/homebrew` does not exist.

**What worked:** the official Node installer, which needs neither Homebrew nor the Command Line Tools.

```
node-v24.19.0.pkg   (LTS, universal)
https://nodejs.org/dist/v24.19.0/node-v24.19.0.pkg    88.5 MB
signed: Developer ID Installer: Node.js Foundation (HX7739G8FX), Apple-notarized
installs node + npm into /usr/local/bin
```

Now present: **node v24.19.0, npm 11.17.0**.

If you ever need the Command Line Tools themselves (nothing in this project does), either retry once Apple's server recovers or download the DMG from developer.apple.com with an Apple ID.

### The jsc fallback harness

Before Node existed, everything was verified under macOS's built-in JavaScriptCore shell. That harness is still in the repo at **`tools/jsc-verify/`** and still works. It is redundant now that Node is back, but it is the only way to run these suites on a machine without Node, so it was left in place rather than deleted. See its README.

## 2. Environment map

```
Editable working copy (source of truth, no git):
/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8
  chrome-extension/
  worker-gchat/
  tools/jsc-verify/        <- NEW this session

Loaded unpacked DEV build (compiled output, NOT source):
/Users/chris/Documents/Stratus extensions/stratus bot dev
  = a copy of chrome-extension/dist
  REBUILT 2026-08-18 18:47 with every fix in this document.

Backups of the compiled folder:
/Users/chris/Documents/Stratus extensions/stratus bot dev-backup-*
```

Note: `chrome-extension/build-dev.sh` copies to
`$HOME/Documents/Claude/Projects/Bots/stratus-bot-v2-DEV/chrome-extension`,
which **does not exist**. The folder Chrome actually loads is
`/Users/chris/Documents/Stratus extensions/stratus bot dev`. Either fix `DEST`
in that script or copy `dist` across by hand after building.

### Chrome extensions

| Name | ID | Version | Role |
|---|---|---|---|
| **Stratus AI (DEV)** | `fkopkkoaedjgkcdhgblkoaaicmkpnhhb` | 1.27.9 | Keep enabled. Unpacked. Gateway `stratus-ai-bot-gateway.chrisg-ec1.workers.dev`. This is the one to reload. |
| **Stratus AI** (store) | `idkfeabnpcnpklbgknibidbgjcpbcmkh` | 1.27.2 | Chris said "Disable it". Still pending, he must do it by hand (`chrome://` blocks automation). |

Do **not** bump the manifest version unless Chris asks. Still 1.27.9.

### Cloudflare

| Worker | Host |
|---|---|
| Gateway (thin proxy) | `stratus-ai-bot-gateway.chrisg-ec1.workers.dev` |
| Main quote worker | `stratus-ai-bot-gchat.chrisg-ec1.workers.dev` (wrangler name `stratus-ai-bot-gchat`, account `ec1888c5a0b51dc3eebf6bae13a3922b`) |
| Currently live | version **`866a1c04-517e-4909-81d4-bdc3b58ff168`**, deployed 2026-08-18 with every fix in this document. |
| Rollback target | version **`4404e41e-d507-4f7a-a275-1f7454f8322e`**, the old Bug 4 revert. |

---

## 3. What was done this session

Four fixes. 1 and 2 were written by Perplexity Computer in a sandbox and had never reached this Mac; they are now applied here. 3 and 4 are new.

| # | Name | Where it runs | Status |
|---|---|---|---|
| 1 | License-term gate continuation | worker | Applied + 7 tests pass |
| 2 | Requote autofill for the synthetic MR-ENT row | chrome | Applied + 9 tests pass |
| 3 | Typo'd / explicit license SKUs in mixed carts | worker | **New.** Implemented + 10 tests pass |
| 4 | Editor rows autofilled with the full resolved SKU | worker + chrome | **New.** Implemented + 6 tests pass |

Plus one bug found while doing 4, fixed deliberately (section 3.5).

### 3.1 Fix #1 — license-term gate continuation

`worker-gchat/src/index.js`, `buildTierClarifyContinuation` (~line 25190).

"7 MR licenses" with no term makes `detectAmbiguousLicenseTerm` ask *"Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year?"*. A bare "3 year" reply had no deterministic continuation (unlike Duo/Umbrella), so it fell through to CRM-follow-up routing and forced Claude instead of re-quoting.

Added a branch that recognizes the gate's own question and reconstructs `"<original request> <term> year"`, then re-enters `parseMessage` / `buildQuoteResponse`. Returns `null` rather than guessing when the reply is not a bare term or the original request is unavailable.

**Change from the Perplexity version:** the Mac's `buildTierClarifyContinuation` only took `(text, lastAssistantContent)`. It now takes a third `priorUserContent`, and a new helper `priorUserBeforeLastAssistant(history)` supplies it. **Both call sites were updated** (`/api/quote` ~31745, gchat ~37170). If you only paste the Perplexity snippet you get `undefined` for the third argument and the branch silently never fires.

Honesty flag, carried forward: this is a real, provable gap that was fixed, but it has never been verified against the live LLM-routed chat path. Treat as "should fix it" until Chris confirms.

### 3.2 Fix #2 — requote autofill for the synthetic MR-ENT row

`chrome-extension/src/sidebar/components/sku-editor-core.mjs`.

`MR-ENT` / `LIC-ENT` are client-side display placeholders (`quote-client.js` `mrOnlyResult()` / `mapQuoteResponse()`), not catalog SKUs. Two serializers disagreed on token order: the editor wrote `"12 MR-ENT"` but `runQuote()`'s stripper wants `MR-ENT x12`. The literal `MR-ENT` reached the worker, `parseMessage` returned null, and the entire requote died, forcing a manual reselect of every row including untouched hardware.

Synthetic rows now serialize as `MR-ENT x{qty}` regardless of which placeholder label the row carried. Quantity must be an integer 1..500 or it fails loudly instead of silently dropping the line. Non-synthetic serialization is byte-identical to before.

### 3.3 Fix #3 — typo'd and explicit license SKUs in mixed carts

This is the one the 1.27.9 handoff left open. Its diagnosis was correct and was independently re-confirmed on this Mac before any code was written.

**The bug.** `parseMessage`'s hardware regexes scanned the raw uppercased text, so the `MX67C` *inside* `LIC-MX67C-ENT-3YY` matched as a hardware model. Live behavior was worse than "no chip":

```
parseMessage('quote 2 MR44 and 3 LIC-MX67C-ENT-3YY')
  -> items: [MR44 x2, MX67C x1]        typed licence destroyed, qty 3 -> 1
  -> buildQuoteResponse then re-invented the CORRECT LIC-MX67C-ENT-3YR
     from the phantom model + the ENT it also read out of the same token
  -> three successful URLs, no chip, silently rewritten cart
```

**The fix, in four parts:**

1. **`parseMessage`** (~6762): before the `skuPatterns` loop, blank every `LIC-…` token out of a **scan copy** using same-length spaces, so every position-based quantity rule is byte-for-byte unaffected. The hardware loop and the bare-family loop now read `hwScanText`; `upper` is untouched for tier, term, modifier and suggestion text. Concrete LIC tokens become first-class items carrying their own typed quantity. Term-agnostic aliases (`LIC-ENT`, `LIC-MV`, `LIC-MT`, `MR-ENT`) are hidden from the hardware scan but **never** promoted to concrete items, which is exactly what the Bug 4 revert demanded.
2. **`assignClauseIntent`**: an item flagged `isExplicitLicenseSku` is license-only by construction and is skipped, so clause intent cannot flip it to hardware.
3. **`buildQuoteResponse`** (~7428): a new branch resolves a concrete `LIC-*` item against the **licence** catalog (`resolveDirectLicenseCatalogItems` / `getPrice`, never `validateSku`, which only knows hardware and rejects even a perfectly valid licence). Resolvable -> rendered per term alongside the rest of the cart. Unresolvable -> **fails closed**: reported and skipped exactly like an invalid hardware SKU, never placed in an order URL.
4. **`directLicenseCatalogAlternatives`** (~4076): a mistyped term tail left the whole typo as the stem, so no catalog key could prefix-match and the chip list came back **empty**. It now recovers the stem from a malformed tail (`-3YY`, `-3YRS`, `-3R`) and falls back to the stem's other terms when nothing matches at the requested term. Without this there was no chip to click even on the license-only path.
5. **`/api/quote` validation loop** (~31821): the three-way branch. Agnostic aliases stay valid-by-definition; a concrete `LIC-*` is catalog-checked and produces a suggestion chip on failure; hardware still goes through `validateSku`.

Result:

```
quote 2 MR44 and 3 LIC-MX67C-ENT-3YY
  items: MR44 x2, LIC-MX67C-ENT-3YY x3     (qty preserved, no phantom MX67C)
  message: "LIC-MX67C-ENT-3YY: not in the eCommerce license catalog
            Did you mean: LIC-MX67C-ENT-3YR?"
  URLs contain only MR44-HW + LIC-ENT-*, never the bad SKU

quote 2 MR44 and 3 LIC-MX67C-ENT-3YR
  item=MR44-HW,LIC-ENT-1YR,LIC-MX67C-ENT-1YR&qty=2,2,3
  item=MR44-HW,LIC-ENT-3YR,LIC-MX67C-ENT-3YR&qty=2,2,3
  item=MR44-HW,LIC-ENT-5YR,LIC-MX67C-ENT-5YR&qty=2,2,3
```

### 3.4 Fix #4 — editor rows autofilled with the full resolved SKU

This is Chris's testing note from this session:

> "it gets the initial quote url correct. However when i need to make the change, i need to go back into both line items and select the full sku to make quantity edits in order properly requote. Need to update logic to have those autofilled appropriately... Not sure if it makes it easier to include the license Type (ENT/ADV ENT/SEC etc) now as well"

Three separate causes were found. All three are fixed.

**(a) `parsedItems` listed one row per TERM, not per cart line.**
A term-option quote ("7 MR licenses", any Duo / Umbrella / AnyConnect ask) carries `LIC-ENT-1YR`, `LIC-ENT-3YR` and `LIC-ENT-5YR` as three items. Those are three presentations of **one** line, but the editor rendered three rows. Bumping a quantity re-quoted 3x the licences across three terms.

New helper `editorReadyParsedItems(rows, parsed)` (`worker-gchat/src/index.js` ~4106), called once after both validation loops (~32040), collapses per-term presentations into a single row, canonically the 3-year one (a typed licence always re-renders the full 1/3/5 set, so nothing is lost).

**(b) A license-only line was pre-filled with the bare hardware model.**
The quote for "1 MX67C license" contains `LIC-MX67C-SEC-3YR`, but the row said `MX67C`. Re-quoting the bare model silently re-added hardware the user never asked for, so the only way to get a faithful requote was to retype the full SKU by hand, on every row. That is precisely what Chris described.

`editorReadyParsedItems` now attaches **additive** `licenseOnly` and `resolvedSku` fields. `sku` is deliberately left alone so the captured-items banner and Send to Zoho are byte-identical; only clients that opt in see the fuller token. `quote-client.js` `toParsedRow()` carries them through, and `editableRowsFromResult()` pre-fills the row with `resolvedSku` (keeping the typed model as `typedSku`).

This is also the "include the license Type" ask: the row now literally reads `LIC-MX67C-SEC-3YR`, so the tier and term are visible and directly editable.

**(c) `quoteModeFromText` read a phantom tier and term out of the inside of a licence SKU.**
`\bENT\b` and `\b3YR\b` both match *within* `LIC-MX67C-ENT-3YR`, because `-` is a non-word character. So a prior quote containing any licence SKU made every requote append `enterprise` and `3 year`, collapsing a 1/3/5-year quote to a single 3-year URL. The worker's own term regex has guarded against this for a while with a negative lookbehind; the extension's copy did not. It now masks `LIC-` tokens before reading tier/term and uses the same `(?<![\w-])` guard. Hardware-only and license-only wording never appears inside a SKU, so those still read the raw text.

Verified end to end, which is the actual acceptance test for Chris's complaint:

```
quote 2 MR44 and 3 LIC-MX67C-ENT-3YR
  rows: MR44 x2 | LIC-MX67C-ENT-3YR x3
  user changes ONLY the licence qty to 10, touches nothing else
  requote text: "2 MR44\n10 LIC-MX67C-ENT-3YR"
  -> item=MR44-HW,LIC-ENT-{1,3,5}YR,LIC-MX67C-ENT-{1,3,5}YR&qty=2,2,10
```

### 3.5 Extra fix, called out deliberately: hardware was being silently dropped

The 1.27.9 handoff flagged this as a separate known gap and said not to fix it silently. It is fixed, and this section is the not-silent part.

The model-agnostic licence handler matched "7 MR licenses" **anywhere** in the message and then early-returned a licence-only term-option quote, discarding every hardware token in the same request:

```
BEFORE  quote 7 MR licenses and 1 MX67C license  -> LIC-ENT only. MX67C gone from the URL.
BEFORE  quote 2 MX105 and 7 MR licenses          -> LIC-ENT only. MX105 gone from the URL.
```

That produces a wrong quote with no warning, and Chris is testing exactly these mixed license-plus-hardware flows. When other hardware is present the handler now defers instead of returning: the family is carried into the main path as an `<FAM>-AGN` item, which `buildQuoteResponse` already knows how to expand into the per-term LIC SKUs. It is suppressed when a concrete model of the same family is already in the cart, mirroring the existing `bareAgnosticItems` merge rule (that model carries its own licence).

A pure agnostic request with no other hardware keeps the original early return, byte for byte.

```
AFTER   quote 7 MR licenses and 1 MX67C license
        -> item=LIC-ENT-3YR,LIC-MX67C-SEC-3YR&qty=7,1   (and the 1Y / 5Y siblings)
AFTER   quote 7 MR licenses      -> unchanged, still the three LIC-ENT term URLs
```

One consequence: `MR-AGN` can now legitimately appear in `parsed.items` for a mixed cart. `test-license-term-continuation-2026-08-18.mjs` asserted it never could, so that assertion was updated to mirror the real validity rule the `/api/quote` loop uses (LIC-\*, PASSTHROUGH, `*-AGN`, CW stems are valid by definition), plus a new positive assertion that `MX67C` survives.

---

## 4. Verification performed

Everything below was run with real Node (v24.19.0) at the end of the session. The earlier jsc results agreed with these.

### chrome-extension

```
cd chrome-extension && node --test
-> tests 89   pass 89   fail 0
```

Baseline before this session was 83/83. The 6 new tests are `test-editor-resolved-sku-autofill-2026-08-18.mjs`.

**One real defect was caught here and fixed.** `test-mx-dashboard-correction-2026-07-31.js` extracts `mapQuoteResponse` from `quote-client.js` as a standalone function body and evaluates it in isolation, so any *sibling top-level* helper it calls is undefined in that scope. The first version of Fix #4 added `toParsedRow` as a top-level function and broke two assertions with `toParsedRow is not defined`. It is now a **local** inside `mapQuoteResponse`, which respects that extraction contract. If you add another helper that `mapQuoteResponse` calls, do the same or you will break this test again.

### worker-gchat

```
cd worker-gchat && node --test
-> tests 111   pass 84   fail 27
```

The 27 failures are pre-existing. This was not assumed, it was measured: the pristine `index.js-backup-pre-fix123-20260818` was swapped in, the two new test files were moved aside, and the suite was re-run.

```
pristine:  tests 94    pass 67   fail 27
patched:   tests 111   pass 84   fail 27
delta:     +17 tests, +17 passes  (exactly the 10 + 7 new tests)

failing-test-name diff, pristine vs patched:
  newly failing: none
  newly passing: none
```

The failing set is byte-identical. Nothing was broken and nothing was accidentally fixed.

### Parser regression corpus

A 71-input corpus (`tools/jsc-verify/corpus.js`) covering plain hardware, multi-line pastes, EOL swaps, bare families, Catalyst, CW, Z-series, accessories, Duo, Umbrella, license-only CSV, agnostic families, hardware-only and revision phrasings was snapshotted against the untouched backup and against the patched file, then diffed.

**17 of 71 changed, 54 byte-identical.** All 17 were inspected by hand and are intended fixes. No unintended drift.

### Deploy verification

The deployed bundle was pulled back down from the Cloudflare API and grepped. Comments are stripped during upload, so the code identifiers are the evidence:

```
hwScanText 10   isExplicitLicenseSku 3   explicitLicenseItems 3
AGNOSTIC_LICENSE_ALIAS_RE 2   LIC_TOKEN_RE 3   deferredAgnostic 5
editorReadyParsedItems 3   isAgnosticLicenseAlias 2
priorUserBeforeLastAssistant 4   resolvedSku 1
"not in the eCommerce license catalog" 2
```

### What was NOT verified

- **No live request was made against the deployed worker.** `/api/quote` requires the extension's auth header and I did not go looking for that secret. Correctness rests on the suites plus direct function-level probes, not on an end-to-end HTTP call.
- **The extension was not exercised in a browser.** Chris's live test is the first real run.
- Fix #1 in particular has never been seen working through the LLM-routed chat path. Treat it as "should work" until Chris confirms.

## 5. Files changed

Backups were taken next to each file before editing.

```
worker-gchat/src/index.js
  4076   directLicenseCatalogAlternatives     tolerate a mistyped term tail
  4106   editorReadyParsedItems               NEW helper (Fix #4)
  6707   parseMessage                         defer agnostic family when hardware present (3.5)
  6762   parseMessage                         LIC-token mask + explicit licence items (Fix #3)
  ~6900  parseMessage                         hardware + bare-family loops read hwScanText
  ~6990  parseMessage                         merge deferred agnostic + explicit licence items
  ~7050  assignClauseIntent                   isExplicitLicenseSku is license-only, always
  7428   buildQuoteResponse                   concrete LIC-* branch, fail-closed (Fix #3)
  25187  priorUserBeforeLastAssistant         NEW helper (Fix #1)
  25210  buildTierClarifyContinuation         licence-term branch + 3rd param (Fix #1)
  ~31745 /api/quote                           pass priorUserContent
  31821  /api/quote                           three-way licence validation branch (Fix #3)
  ~32040 /api/quote                           call editorReadyParsedItems (Fix #4)
  ~37170 gchat handler                        pass priorUserContent
  backup: worker-gchat/index.js-backup-pre-fix123-20260818

chrome-extension/src/sidebar/components/sku-editor-core.mjs
  synthetic MR-ENT helpers + serialization (Fix #2)
  editableRowsFromResult prefers resolvedSku (Fix #4b)
  quoteModeFromText masks LIC tokens (Fix #4c)
  backup: sku-editor-core.mjs.backup-pre-fix2-20260818

chrome-extension/src/lib/quote-client.js
  toParsedRow() carries resolvedSku / licenseOnly through mapQuoteResponse (Fix #4b).
  Declared as a LOCAL inside mapQuoteResponse on purpose, see section 4.

NEW:
  worker-gchat/test-mixed-cart-license-typo-chip-2026-08-18.mjs
  chrome-extension/test-editor-resolved-sku-autofill-2026-08-18.mjs
  tools/jsc-verify/*                          (harness + README)

INSTALLED FROM THE PERPLEXITY BUNDLE:
  worker-gchat/test-license-term-continuation-2026-08-18.mjs   (one assertion updated, see 3.5)
  chrome-extension/test-mrent-editor-requote-2026-08-18.mjs

NOT TOUCHED:
  manifest version (still 1.27.9)
  email-quote-flow.mjs, product-search.mjs, context-lock.mjs
  the compiled folder /Users/chris/Documents/Stratus extensions/stratus bot dev
  the live Cloudflare worker (still 4404e41e)
```

---

## 6. Shipped state, and what is left

### Already done, no action needed

```
Node                v24.19.0 + npm 11.17.0 installed (/usr/local/bin)
chrome-extension    89/89 pass
worker-gchat        84 pass / 27 pre-existing fail (fail set unchanged)
DEV extension       rebuilt and synced to
                    /Users/chris/Documents/Stratus extensions/stratus bot dev
                    manifest: "Stratus AI (DEV)" 1.27.9
                    gateway:  stratus-ai-bot-gateway.chrisg-ec1.workers.dev
   backup taken:    stratus bot dev-backup-pre-1.27.10-20260818-184732
worker deployed     stratus-ai-bot-gchat
   new version:     866a1c04-517e-4909-81d4-bdc3b58ff168
   rollback target: 4404e41e-d507-4f7a-a275-1f7454f8322e
```

Rollback if anything goes wrong:

```bash
cd worker-gchat
npx wrangler rollback 4404e41e-d507-4f7a-a275-1f7454f8322e
```

### Left for Chris

1. **Reload Stratus AI (DEV)** in `chrome://extensions`. The worker is already live; the reload is what picks up the extension half.
2. **Disable the store copy** of `Stratus AI` (`idkfeabnpcnpklbgknibidbgjcpbcmkh`) by hand.
3. Run the live test script below.

### Live test script

| Type this in Chat | Expect |
|---|---|
| `quote 2 MR44 and 3 LIC-MX67C-ENT-3YY` | A chip offering `LIC-MX67C-ENT-3YR`. No URL containing `3YY`. No invented MX67C hardware. MR44 still quoted. |
| `quote 2 MR44 and 3 LIC-MX67C-ENT-3YR` | Three co-term URLs, licence at qty 3, no MX67C-NA. |
| `quote 7 MR licenses` then reply `3 year` | Rebuilds the quote deterministically. No extra chips. |
| `quote 7 MR licenses and 1 MX67C license` | Both lines present. MX67C no longer disappears. |
| Any quote, then change only a quantity, Update quote | Rows already hold full SKUs. No reselect needed. Same URLs with the new qty. |

## 7. Known gaps, deliberately left

- **`quote 2 MR44 and 3 LIC-ENT`** still ignores the alias's qty 3 and quotes `LIC-ENT` x2 from the MR44 line. `LIC-ENT` is a term-agnostic alias, never a catalog item, and promoting it is the exact regression that forced the Bug 4 revert. Behavior is unchanged from before this session. Worth a proper design pass, not a stopgap.
- **`quote 2 MX67C and 5 MV licenses hardware only`** is contradictory input (hardware-only plus an explicit licence ask) and still renders a licence. Unchanged from before, edge case.
- **Original #7, the SEC/ENT/ADV licence dropdown**, is still not started. Fix #4 partially covers the intent by putting the full licence SKU (tier and term visible) directly in the editable row, which is what Chris asked for as a consolidation. A real dropdown is still open.
- **HA verb `UPGRADE`** still does not trigger warm-spare. Pre-existing, left on purpose.

## 8. Landmines

- `parseMessage` is huge and shared with Webex. The LIC mask blanks a **scan copy** with same-length spaces on purpose. Do not change it to a plain `replace` that shortens the string, or every position-based quantity rule below it breaks.
- Never use `validateSku` as licence truth. It only knows hardware and rejects valid licences. Use `resolveDirectLicenseCatalogItems` / `getPrice`.
- `LIC-ENT` is not `LIC-ENT-3YR`. The first is the alias, the second is a real catalog SKU.
- Never generate a quote URL for a SKU that did not resolve. Fail closed.
- `editorReadyParsedItems` only adds fields; it must never rewrite `sku`, or the captured-items banner and Send to Zoho change with it.
- Do not add a top-level helper that `mapQuoteResponse` calls. `test-mx-dashboard-correction-2026-07-31.js` evaluates that function in isolation and a sibling top-level helper will be undefined there. Keep such helpers local to the function.
- Homebrew cannot be installed on this Mac right now (Apple is not serving the Command Line Tools). Use the nodejs.org `.pkg` if Node ever needs reinstalling.
- No em dashes in any user-facing string, SKU, or URL.
