# Stratus AI CRM Agent — v3 Test Matrix

**Status: approved 2026-04-21, A6 (Velocity Hub) skipped per Chris.**

**Target pass threshold: 90% (≥43 of 48 active tests).**

## Why v3

v2 had four structural flaws:

1. **Multi-step prompts in a single message** — e.g. test 9 said "Create a quote AND change the licenses to 5 years" in one prompt. Not realistic. Users do these as sequential messages.
2. **EOL products treated as active inputs** — test 7 quoted MS125-24P-HW as a positive scenario. MS125 has been EOL since 2025. Bot created the quote anyway (Zoho accepts inactive products by ID reference — separate bug), and the test falsely counted that as a pass.
3. **Grading by bot reply text only** — tests used regex on the reply ("contains 'cloned'", "contains 'lic-ent-5yr'"). That's not verification. The Quote record could be empty and the test still passes.
4. **No completeness validation on created records** — v2 never checked that Quotes had Billing/Shipping address, Valid_Till, Cisco_Billing_Term, or Closing_Date populated. Screenshot audit showed live test Quotes with blank address blocks and Country = "United States" instead of the Zoho-standard 2-letter code "US".

## Design Rules for v3

| Rule | Applied To |
|------|-----------|
| One action per user message | All tests |
| Multi-turn flows split across sequential entries with shared `sessionId` | T, A, L categories |
| EOL products (MS125, MX64/65, MR33/42) only as refusal scenarios | E category only |
| Every write test has a post-check via Zoho MCP verifying actual record state | All write tests |
| Pass criteria includes ≥1 Zoho state assertion, not just reply-text regex | All write tests |
| Read tests can still grade on reply text | X category only |
| **Every Create/Clone test must verify required-field completeness** (address + billing term + valid_till + country = 'US'). Wrong address = hard fail. | C, Q1 (clone), D1/D2 |
| **Every Create test must include a "missing info → bot asks clarification" variant** | C9, D7 |
| Seeded test account addresses must propagate Account → Deal → Quote | All quote-create tests |
| Cleanup on demand only — Chris tells the harness when to delete v3-tagged records | All write tests |

## Seeded Test Address (applied on both test accounts)

For v3, both `Acme Corp` and `TEST - Llama Verification` accounts have this standardized address set on their Billing and Shipping fields so the bot has something to inherit:

```
Street:  1234 Test Harbor Dr
City:    Nashville
State:   TN
Code:    37027
Country: US   ← 2-letter code, not "United States"
```

Every Quote-creation test asserts these five fields land on the Quote (both Billing_* and Shipping_*). If any are blank or Country renders "United States", the test fails even if the line items are correct.

## EOL / Active Inventory (verified against Zoho `Product_Active` + unified-product-catalog-v2-0 EOL list)

**Active in Zoho today (safe for positive scenarios):**

| SKU | Product_Code in Zoho | Notes |
|-----|---------------------|-------|
| MR46-HW, MR44-HW, MR46E-HW | exact | Wi-Fi 6 APs |
| CW9166I-MR, CW9164I-MR | exact | Wi-Fi 6E APs, -MR suffix |
| MS150-24P-4X, MS150-48FP-4X, MS150-24T-4G | exact, **no -HW suffix** | MS150 family replaces MS125. Hardware has 4G/4X uplink variant suffix. Licenses drop the uplink suffix: LIC-MS150-24-*Y, LIC-MS150-48-*Y (no 4G/4X) |
| MS250-24P-HW | exact | higher-tier switch |
| MX75-HW, MX85-HW, MX95-HW | exact | firewalls |
| MX67 | **Zoho code is `MX67` (no `-HW`)** | still active; bot resolves MX67-HW request to this record |
| MX67W-HW | exact | wireless variant still active |
| MV12WE, MV32-HW | exact | cameras |
| MT10-HW, MT14-HW | exact | sensors |
| MG21-HW-NA | exact | gateway |
| Licenses: LIC-ENT-{1,3,5}YR | exact | MR/CW licensing |
| LIC-MX67-{ENT,SEC}-{1,3,5}YR, LIC-MX67-SDW-{1,3,5,7,10}Y | exact | all active |
| LIC-MS150-24-{1,3,5}Y, LIC-MS150-24A-{1,3,5}Y, LIC-MS150-48-{1,3,5}Y, LIC-MS150-48A-{1,3,5}Y | exact | MS150 switch licensing — `-24` pairs with 24P/24T, `-24A` pairs with 24MP, uplink suffix (4G/4X) not part of license SKU |
| LIC-MX75-{ENT,SEC}-{1,3,5}YR | exact | firewall licensing |
| LIC-MV-{1,3,5}YR | exact | camera licensing |

**EOL / Inactive in Zoho (refusal-only scenarios — reference unified-product-catalog-v2-0):**

| SKU | Product_Active | Replacement |
|-----|---------------|-------------|
| MS125-24-HW, MS125-24P-HW, MS125-48-HW, MS125-48LP-HW, MS125-48FP-HW | false | MS150 family |
| MS210-*, MS225-*, MS250-* (all variants, including MS250-24P-HW) | false (EOL / phased out per Chris) | MS150 / MS350 family depending on tier |
| MX64-HW, MX65-HW | false | MX67 / MX75 |
| MR33-HW, MR42-HW | false | MR44 / MR46 |

> **Rule: no EOL SKU appears in any test outside the E category.** If the bot accepts an EOL SKU via inactive-product bypass, that's tracked as bot bug #34 (worker-gchat), not a matrix change.

## Test Matrix (48 active tests, 8 categories — A6 Velocity Hub skipped)

### C — Create Quote (single-action, 9 tests)

Each test creates a quote with ONE prompt. Verification runs `ZohoCRM_getRecord` on the returned Quote ID and checks Quoted_Items subform **PLUS** address/completeness fields.

**Universal completeness assertion (applied to every C test + Q1 clone):**

```js
function assertQuoteComplete(quote) {
  return quote.Billing_Street === '1234 Test Harbor Dr'
      && quote.Billing_City === 'Nashville'
      && quote.Billing_State === 'TN'
      && quote.Billing_Code === '37027'
      && quote.Billing_Country === 'US'
      && quote.Shipping_Street === '1234 Test Harbor Dr'
      && quote.Shipping_City === 'Nashville'
      && quote.Shipping_State === 'TN'
      && quote.Shipping_Code === '37027'
      && quote.Shipping_Country === 'US'
      && quote.Valid_Till   // non-null
      && quote.Cisco_Billing_Term // non-null
      && quote.Closing_Date; // non-null on parent deal
}
```

| # | Prompt | Expected Zoho State | Pass Criteria |
|---|--------|---------------------|---------------|
| C1 | `Create an ecomm quote on deal ${SEED_DEAL} with 2× MR46-HW + 2× LIC-ENT-3YR.` | Quote created, 2 Quoted_Items rows, addresses populated, ecomm discount. | `subform.length === 2 AND skus contain MR46-HW and LIC-ENT-3YR AND per-line Discount > 0 AND assertQuoteComplete(quote)` |
| C2 | `Create a list-price quote on deal ${SEED_DEAL} with 1× MR46-HW + 1× LIC-ENT-3YR.` | Quote created, Discount = 0 on both lines, addresses populated. | `subform.length === 2 AND all Discount === 0 AND assertQuoteComplete(quote)` |
| C3 | `Create an ecomm quote on deal ${SEED_DEAL} with 3× MS150-24P-4X + 3× LIC-MS150-24-3Y.` | MS150 switches (replaces EOL MS125). No -HW on MS150. Uplink suffix 4X = 4 SFP+. License drops the uplink suffix. | `subform skus === ['MS150-24P-4X','LIC-MS150-24-3Y'] AND both qty=3 AND assertQuoteComplete(quote)` |
| C4 | `Create an ecomm quote on deal ${SEED_DEAL} with 1× CW9166I-MR + 1× LIC-ENT-3YR.` | CW (Wi-Fi 6E) uses -MR suffix + LIC-ENT- licensing. | `subform skus === ['CW9166I-MR','LIC-ENT-3YR'] AND assertQuoteComplete(quote)` |
| C5 | `Create an ecomm quote on deal ${SEED_DEAL} with 1× MX75-HW + 1× LIC-MX75-ENT-3YR.` | MX firewall + security license pairing. | `subform skus contain 'MX75-HW' AND 'LIC-MX75-ENT-3YR' AND assertQuoteComplete(quote)` |
| C6 | `Create an ecomm quote on deal ${SEED_DEAL} with 1× MV32-HW + 1× LIC-MV-3YR.` | Camera + camera license. | `subform skus contain 'MV32-HW' AND 'LIC-MV-3YR' AND assertQuoteComplete(quote)` |
| C7 | `Create an ecomm quote on deal ${SEED_DEAL} with 1× MT10-HW + 1× LIC-MT-3Y.` | Sensor + sensor license. MT free-tier logic may omit LIC line. | `subform contains MT10-HW AND assertQuoteComplete(quote). Document MT-free-tier behavior in reply.` |
| C8 | `What's the default pricing mode on new quotes?` | Read-only. No Zoho side-effect. | `reply contains 'ecomm' OR 'stratus'` |
| **C9** | `Create a quote on deal ${SEED_DEAL}.` *(intentionally incomplete — no SKUs or quantities)* | Bot MUST ask for clarification (SKUs? qty? term? pricing mode?). No quote created. | `reply contains '?' AND reply mentions sku/product/line AND no new Quote record attached to SEED_DEAL in the last 60s` |

### T — Term Change (multi-turn sequential flow, 6 tests)

T1–T3 share a session. T4–T6 share a session. After each destructive turn, Zoho verification runs.

**Flow 1 (T1→T2→T3):**

| # | Session | Prompt | Expected Zoho State | Pass Criteria |
|---|---------|--------|---------------------|---------------|
| T1 | NEW | `Create an ecomm quote on deal ${SEED_DEAL} with 2× MR46-HW + 2× LIC-ENT-3YR.` | Quote created, addresses populated, 3YR license. | Subform has LIC-ENT-3YR AND assertQuoteComplete(quote) |
| T2 | CONT | `Change the license term to 5 years.` | Same quote, LIC-ENT-3YR row replaced with LIC-ENT-5YR qty=2. | Subform has LIC-ENT-5YR AND NOT LIC-ENT-3YR |
| T3 | CONT | `Actually, make it 1 year.` | Same quote, LIC-ENT-5YR → LIC-ENT-1YR qty=2. | Subform has LIC-ENT-1YR only |

**Flow 2 (T4→T5→T6):**

| # | Session | Prompt | Expected Zoho State | Pass Criteria |
|---|---------|--------|---------------------|---------------|
| T4 | NEW | `Create an ecomm quote on deal ${SEED_DEAL} with 1× MX75-HW + 1× LIC-MX75-ENT-1YR.` | MX + security license 1YR. | Subform has LIC-MX75-ENT-1YR AND assertQuoteComplete(quote) |
| T5 | CONT | `Bump the security license to 3 years.` | Same quote, LIC-MX75-ENT-1YR → LIC-MX75-ENT-3YR. | Subform has LIC-MX75-ENT-3YR, not -1YR |
| T6 | CONT | `Change the term on the license.` *(ambiguous)* | Bot MUST ask clarification, not touch quote. | Reply contains "?" AND subform unchanged from T5 |

### L — Line-Item Delete / Replace (single-action + multi-turn, 7 tests)

Operates on a seeded quote `SEED_QUOTE_MULTI` that starts each run with 4 line items so license-pairing logic can be tested:

- Row 1: 2× MR46-HW
- Row 2: 2× LIC-ENT-3YR (for MR46)
- Row 3: 1× MS150-24P-4X (switch)
- Row 4: 1× LIC-MS150-24-3Y (license for switch)

Pre-run, the harness re-seeds SEED_QUOTE_MULTI to this exact state. Verification via `getRecord` on the quote's Quoted_Items subform.

| # | Session | Prompt | Expected Zoho State | Pass Criteria |
|---|---------|--------|---------------------|---------------|
| L1 | NEW | `Remove the MS150-24P-4X line from quote ${SEED_QUOTE_MULTI}.` | Subform has 3 rows remaining (MR46-HW + LIC-ENT-3YR + LIC-MS150-24-3Y, leaving the orphaned switch license). | `subform.length === 3 AND no row has SKU === 'MS150-24P-4X'` |
| L2 | NEW | `Replace MR46-HW with MR46E-HW on quote ${SEED_QUOTE_MULTI}, keep qty 2.` | MR46-HW row replaced with MR46E-HW qty=2. License row unchanged (same LIC-ENT-3YR works for MR46E). | `subform contains MR46E-HW qty=2 AND no MR46-HW row AND LIC-ENT-3YR still present` |
| L3 | NEW | `Change the qty on LIC-ENT-3YR to 4 on quote ${SEED_QUOTE_MULTI}.` | Row qty updated 2 → 4. No SKU change. | `LIC-ENT-3YR row qty === 4 AND subform.length unchanged` |
| L4 | NEW | `Delete all hardware lines from quote ${SEED_QUOTE_MULTI}, keep only licenses.` | Hardware rows removed (MR46-HW, MS150-24P-4X). Only LIC-* remains. | `every subform row SKU starts with 'LIC-'` |
| L5a | NEW | `Remove a line from quote ${SEED_QUOTE_MULTI}.` *(ambiguous)* | Bot MUST ask which line. No mutation. | Reply contains "?" AND subform unchanged |
| L5b | CONT | `The MS150 one.` | MS150-24P-4X row removed (license row untouched unless user asks). | `subform.length === original - 1 AND no MS150-24P-4X row` |
| L6 | NEW | `Replace the switch on quote ${SEED_QUOTE_MULTI} with a MS150-48FP-4X.` *(same family, bigger port count + PoE, both active)* | **Auto-swap both hardware and paired license.** MS150-24P-4X → MS150-48FP-4X (qty preserved). LIC-MS150-24-3Y → LIC-MS150-48-3Y (qty + term preserved). Reply confirms BOTH changes explicitly. | `subform contains MS150-48FP-4X AND subform contains LIC-MS150-48-3Y AND no MS150-24P-4X row AND no LIC-MS150-24-3Y row AND reply mentions both SKU changes (hardware AND license)` |
| **L7** | NEW | `Replace the switch on quote ${SEED_QUOTE_MULTI} with a MS250-24P-HW.` *(target is EOL)* | Bot MUST refuse the swap because MS250-24P-HW is EOL. Quote unchanged. Bot surfaces the EOL flag and suggests active replacement (MS150-* or MS130-* family). | `reply mentions MS250/EOL/inactive/end-of-life AND subform unchanged (still has MS150-24P-4X and LIC-MS150-24-3Y) AND reply suggests active alternative` |

### D — Deal CRUD (single-action + clarification, 7 tests)

| # | Prompt | Expected Zoho State | Pass Criteria |
|---|--------|---------------------|---------------|
| D1 | `Create a deal 'v3 Test — No Lead Source' on account ${TEST_ACCOUNT}, closing 2026-12-31.` | Deal created with Lead_Source = Stratus Referal. Meraki_ISR = Stratus Sales. Billing address inherited from account. | `Deal.Lead_Source === 'Stratus Referal' AND Deal.Meraki_ISR.name === 'Stratus Sales' AND Deal.Closing_Date === '2026-12-31'` |
| D2 | `Create a deal 'v3 Test — ISR Referral from Matt Kochendorfer' on account ${TEST_ACCOUNT}, closing 2026-12-31.` | Deal with Lead_Source = Meraki ISR Referal, Meraki_ISR = matching rep. | `Deal.Lead_Source === 'Meraki ISR Referal' AND Deal.Meraki_ISR.name contains 'Kochendorfer'` |
| D3 | `Create a deal 'v3 Test — Past Closing' on account ${TEST_ACCOUNT}, closing 2024-01-15.` | Bot warns or refuses past date. | Reply mentions past/previous/warn. If deal created, Closing_Date matches |
| D4 | `Rename deal ${SEED_DEAL} to 'v3 Rename Test — ${timestamp}'.` | Deal.Deal_Name updated. | `Deal.Deal_Name contains 'v3 Rename Test'` |
| D5 | `Add a note to deal ${SEED_DEAL}: 'v3 test note line 1\\nline 2'.` | Note appended to deal's related list. | Notes module shows new note with matching content |
| D6 | `Find all open deals with 'renew' in the name.` | Read-only search. | Reply contains deal names OR "no deals found" |
| **D7** | `Create a deal.` *(intentionally incomplete)* | Bot MUST ask for account, name, closing date. No deal created. | `reply contains '?' AND reply mentions account AND reply mentions (name OR closing) AND no new Deal created in last 60s` |

### Q — Quote CRUD on existing quote (7 tests)

Uses SEED_QUOTE. After each destructive test, re-fetch and verify.

| # | Prompt | Expected Zoho State | Pass Criteria |
|---|--------|---------------------|---------------|
| Q1 | `Clone quote ${SEED_QUOTE}.` | New Quote record with same Quoted_Items AND same address/term fields. | `clone.subform.length === original.subform.length AND assertQuoteComplete(clone)` |
| Q2 | `Rename the subject on quote ${SEED_QUOTE} to '🚀 Rocket Quote v3'.` | Quote.Subject updated with emoji. | `Quote.Subject === '🚀 Rocket Quote v3'` |
| Q3 | `What's the margin on quote ${SEED_QUOTE}?` | Read-only. | Reply mentions margin/cost/%. No Zoho change |
| Q4 | `Apply a 10% discount to every line on quote ${SEED_QUOTE}.` | Each Quoted_Item Discount increased. | Per-line Discount > pre-test baseline |
| Q5 | `What's the deal ID for quote ${SEED_QUOTE}?` | Read-only lookup. | Reply contains SEED_DEAL id |
| Q6 | `Update CCW_Deal_Number on quote ${SEED_QUOTE} to 87654321.` | Quote.CCW_Deal_Number === '87654321'. | Verified via getRecord |
| Q7 | `Add a 1× LIC-ENT-5YR line to quote ${SEED_QUOTE} at ecomm pricing.` | New Quoted_Item appended. | `subform.length === baseline + 1 AND new line.SKU === 'LIC-ENT-5YR' AND new line.Discount > 0` |

### A — Admin Actions / DID / Velocity Hub (multi-turn, 6 tests)

**Flow (A1→A2→A3):**

| # | Session | Prompt | Expected Zoho State | Pass Criteria |
|---|---------|--------|---------------------|---------------|
| A1 | NEW | `Submit deal ${SEED_DEAL} for Cisco discount approval — request 15%.` | Quote or Deal admin_action field set (live_ciscoquote_deal or equivalent). | `Quote.Admin_Action contains 'live_ciscoquote' OR reply confirms admin action invoked` |
| A2 | CONT | `What's the admin action status on that quote now?` | Read-only status check. | Reply reports current Admin_Action value matching A1 |
| A3 | CONT | `I got CCW Deal Number 12345678 back. Write it to the quote.` | Quote.CCW_Deal_Number === '12345678'. | Verified via getRecord |

**Standalone:**

| # | Session | Prompt | Expected Zoho State | Pass Criteria |
|---|---------|--------|---------------------|---------------|
| A4 | NEW | `Submit deal ${SEED_DEAL_CLOSEDLOST} for discount approval.` | Bot refuses — deal is Closed (Lost). No admin_action should fire. | Reply mentions closed/lost/refuse AND Deal.Stage unchanged AND no new Admin_Action written |
| A5 | NEW | `Generate a Cisco DID for quote ${SEED_QUOTE}.` | Admin_Action triggers DID generation. | Quote.Admin_Action set to DID-related value |
| ~~A6~~ | ~~NEW~~ | ~~Velocity Hub submission~~ | **SKIPPED** per Chris 2026-04-21 — no Velocity Hub calls from the harness | n/a |

### E — EOL Refusal & Bypass Flow (single-action + multi-turn, 5 tests)

**Bot behavior spec (applies to all Create / Add-line / Replace-line operations):**

Before finalizing any quote write — creates AND swaps — bot batches a `Product_Active` check across every SKU involved (existing line SKUs being removed don't need checking; only NEW or REPLACEMENT SKUs). For each SKU where `Product_Active === false`:

1. Bot DOES NOT silently use the Product ID to bypass.
2. Bot DOES NOT hallucinate inactivity when the SKU is actually active — the check must be grounded in Zoho's live response for that exact Product_Code.
3. Bot surfaces the flag to the user: "X is showing as inactive in Zoho. Want me to bypass and quote it anyway, or replace it with Y?"
4. If user says bypass → bot falls back to Product-ID method, creates the line, confirms.
5. If user picks a replacement or declines → bot respects the decision, no bypass.
6. **Replace/swap operations into EOL targets** (like L7) get the same bypass-ask treatment — bot does NOT silently push a new EOL SKU into the quote even if the existing line was active.

| # | Session | Prompt | Expected Behavior | Pass Criteria |
|---|---------|--------|-------------------|---------------|
| E1 | NEW | `Create a quote on deal ${SEED_DEAL} with 4× MS125-24P-HW + 4× LIC-MS125-24-3Y.` | MS125 flagged inactive. Bot asks bypass-or-replace. No line created yet. | `reply mentions inactive/EOL/discontinued AND reply offers bypass OR replacement (MS150) AND no quote line created with MS125` |
| E2 | NEW | `Create a quote on deal ${SEED_DEAL} with 1× MX64-HW + 1× LIC-MX64-ENT-3YR.` | MX64 flagged inactive. Bot asks bypass-or-replace. | `reply mentions inactive/EOL AND no quote created with MX64-HW in this turn` |
| E3 | NEW | `Is MS125-24P-HW still available?` | Read-only informational. | `reply says EOL/discontinued/not active, suggests replacement` |
| E4 | NEW | `Quote me some old MR33s.` | MR33 flagged inactive. Refusal or bypass-ask + MR46 suggestion. | `reply mentions inactive/EOL/MR46` |
| **E5** | NEW | `Create a quote on deal ${SEED_DEAL} with 1× MR46-HW + 1× LIC-ENT-3YR.` | Both SKUs are Product_Active: true. Bot must NOT ask for bypass (no hallucinated inactivity). Quote created normally. | `no mention of "inactive" or "bypass" in reply AND quote created with both lines AND assertQuoteComplete(quote)` |

### X — Read-only / Capabilities (reply-text grading OK, 2 tests)

| # | Prompt | Pass Criteria |
|---|--------|---------------|
| X1 | `Show me my top 5 open deals.` | Reply has ≥1 Zoho URL |
| X2 | `What CRM capabilities do you have? Short bulleted list.` | Reply contains a real `<ul><li>` list mentioning deal/quote/contact |

---

## Test Count Summary

| Category | Tests |
|----------|------:|
| C (Create + clarification) | 9 |
| T (Term changes) | 6 |
| L (Line-item delete/replace) | 7 |
| D (Deal CRUD + clarification) | 7 |
| Q (Quote CRUD) | 7 |
| A (Admin actions) | 6 |
| E (EOL refusal + bypass flow) | 5 |
| X (Read-only) | 2 |
| **Total** | **49** |

> Pass threshold at 90% = ≥45 passing. If address/completeness assertions push this lower initially (expected, since the bot currently doesn't populate Country='US' or propagate addresses), those failures are valid — they surface bot bugs, not test bugs.

---

## Verification Framework

For every destructive test, the runner will:

1. Capture `quoteId` / `dealId` / `recordId` from bot reply (regex on Zoho URL).
2. Run `ZohoCRM_getRecord` on that ID with `fields=Quoted_Items,Billing_Street,Billing_City,Billing_State,Billing_Code,Billing_Country,Shipping_*,Valid_Till,Cisco_Billing_Term,Subject,Admin_Action,CCW_Deal_Number,Discount`.
3. Run the test's `zohoAssertion(record)` against the live record.
4. Pass = reply-text criteria AND zohoAssertion both return true.

Extension to run-tests-v2.js:

```js
async function verifyZoho(recordId, module, assertFn) {
  const record = await zohoGetRecord(module, recordId, [
    'Quoted_Items','Billing_Street','Billing_City','Billing_State',
    'Billing_Code','Billing_Country','Shipping_Street','Shipping_City',
    'Shipping_State','Shipping_Code','Shipping_Country','Valid_Till',
    'Cisco_Billing_Term','Subject','Admin_Action','CCW_Deal_Number','Discount'
  ]);
  return { record, pass: assertFn(record) };
}
```

## Cleanup

Runs leave all v3-tagged records in place. Chris inspects the results and tells the harness when to clean up. On cleanup command:

- Delete all test-created Quotes (flag `Subject: 'v3-TEST-…'`).
- Revert SEED_QUOTE and SEED_QUOTE_MULTI to pre-run state.
- Delete test-created Deals (`Deal_Name: 'v3 Test — …'`).
- Leave seeded Account addresses in place (persistent fixtures).

## Timing Estimate

- 49 tests × ~6s avg model + ~1.5s Zoho verify = ~6.1 min per run
- One model at a time, no parallel (prevents cross-contamination)

---

## Pre-Run State (already seeded)

| Fixture | ID | State |
|---------|-----|-------|
| Account: Acme Corp | 2570562000401269789 | Billing + Shipping address set to 1234 Test Harbor Dr, Nashville TN 37027, US |
| Account: TEST - Llama Verification | 2570562000401231689 | Same address payload applied |
| SEED_DEAL | 2570562000401269831 | Stage reset from "Closed (Lost)" → "Proposal/Negotiation" (open) |
| MS125-24P-HW Product | 2570562000019405046 | Product_Active: false (correct — stays inactive for E1) |

**Still to seed before first run:**
- SEED_QUOTE — pick an existing quote on SEED_DEAL with ≥2 line items, OR create one during harness init
- SEED_QUOTE_MULTI — create fresh with 3 items (2× MR46-HW, 2× LIC-ENT-3YR, 1× MS150-24P-4X) at run start
- SEED_DEAL_CLOSEDLOST — clone SEED_DEAL and set Stage = "Closed (Lost)" for A4 refusal test

---

## Items for Chris to confirm before we run

All structural questions resolved. Matrix is ready to build.

*Resolved from prior drafts:*
- ~~Cleanup policy~~ → Chris triggers cleanup manually.
- ~~Address/Country soften?~~ → Hard fail, no softening. Country must be "US".
- ~~Clarification tests count as write-category?~~ → Yes, they test the refusal-to-write behavior.
- ~~L6 auto-swap vs flag?~~ → Auto-swap BOTH hardware and license, and flag/report what was done. Same intelligence as url-quoting-bot.
- ~~MS150 SKU format~~ → MS150 hardware ends in 4G or 4X (no -HW), licenses drop uplink suffix: LIC-MS150-24-*Y.
- ~~Inactive-product bypass handling~~ → Implement batched Product_Active pre-check. If any SKU flagged inactive, ask user to bypass or replace. No hallucinated inactivity on truly active SKUs (E5 tests the false-positive guard).
- ~~MR52-HW active?~~ → Dropped from active inventory. Wi-Fi 5 phased out.

Give the green light and I'll build run-tests-v3.js.
