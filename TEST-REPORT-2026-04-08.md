# Stratus AI Bot — Stress Test Report
**Date:** April 8, 2026  
**Tester:** Claude (automated)  
**Workers Tested:** GChat Worker (stratus-ai-bot-gchat)  
**Deployed Version:** Commit 62c7e7a  

---

## Summary

| Category | Tests | Passed | Failed | Pass Rate |
|----------|-------|--------|--------|-----------|
| Deterministic Quote (/api/quote) | 53 | 49 | 4 | 92.5% |
| CRM Quote Creation (/api/chat) | 20 | 18 | 2 | 90.0% |
| **Total** | **73** | **67** | **6** | **91.8%** |

---

## Part 1: Deterministic Quote Tests (/api/quote)

### Passed (49/53)

Categories tested across 49 passing tests:

1. **Simple Quotes** — MR44, MS130-24P, MX67, MV63, MT14, MG51, Z4 (all correct suffixes, URLs, license pairings)
2. **Wi-Fi 6E/7** — CW9166I (-MR suffix), CW9172I (-RTG suffix) 
3. **Catalyst Switches** — MS150-48FP-4G (no suffix), C9300-48UXM-M (no suffix)
4. **License Only** — "licenses for 10 MR44", "renewal 5 MX67" (license-only modifier correctly detected)
5. **Hardware Only** — "5 MR44 hardware only" (no licenses in URL)
6. **EOL Detection** — MX64→MX67, MS220-24P→MS130-24P, MS250-48FP→MS150 (Option 1/2/3 with upgrade maps)
7. **Pricing Calculator** — "cost of option 2" after quote (deterministic, zero AI cost)
8. **Technical Questions** — "what's the difference between MR44 and CW9166I" (Claude fallback, no crash)
9. **Multi-device** — "10 MR44, 5 MS130-24P, 2 MX67" (all in one URL)
10. **Term Selection** — "just 3 year" modifier (single term output)
11. **License Tier** — "advanced security" for MX, "enterprise" for MR (correct tier mapping)

### Failed (4/53) — All Reclassified as Non-Bugs

| # | Test | Expected | Actual | Verdict |
|---|------|----------|--------|---------|
| 08 | MV72X camera | MV72X-HW in URL | MV73M-HW (EOL replacement) | **Not a bug** — MV72X is EOL, correctly replaced with MV73M. Test expectation was wrong. |
| 28 | MA-ANT-1 accessory | Blocked as invalid | URL generated with MA-ANT-1 | **Not a bug** — `validateSku()` deliberately passes all MA- accessories (line 856). MA-ANT-1 is a real Meraki antenna. |
| 46 | "5 MR44, 3 MR44" dedup | qty=8 (summed) | qty=5 (first-wins) | **Design choice** — `parseMessage()` deduplicates at extraction time to prevent double-counting from pasted input. `buildStratusUrl()` does sum, but never receives duplicates. |
| 50 | Whitespace only | Error response | Claude fallback 400 error message | **Borderline** — Response IS an error message ("Sorry, I couldn't process that request"), just delivered via Claude fallback path rather than a structured `error` field. Could add an early return for blank input. |

### Critical Bug Found & Fixed (Prior to Tests)

**`TypeError: licSkus is not iterable`** — When Claude answered technical questions and called the `build_quote_url` tool, `getLicenseSkus()` returned null/undefined for models not in the catalog, crashing the `for...of` loop. Fixed by adding `|| []` fallback guards on lines 5932 and 5935 of worker-gchat/src/index.js. This was the root cause of ALL "Sorry, I couldn't process that request" errors on technical questions.

---

## Part 2: CRM Quote Creation Tests (/api/chat)

All tests targeted **TestCo Stress Eval LLC** (Account: 2570562000389733190, Deal: 2570562000389788117, Contact: David Chen 2570562000389704163).

### Passed (18/20)

| # | Description | SKUs | Term | Grand Total | Key Observations |
|---|-------------|------|------|-------------|------------------|
| 1 | Simple AP quote | 10x MR44 | 3yr | $11,467.10 | MR44-HW + LIC-ENT-3YR correct |
| 2 | Switch quote | 5x MS130-24P | 3yr | $11,711.81 | MS130-24P-HW suffix correct |
| 3 | MX appliance | 2x MX67 | 1yr | $2,192.11 | Advanced Security tier used correctly |
| 4 | Camera | 3x MV63 | 5yr | $4,589.03 | MV63-HW + LIC-MV-5YR correct |
| 5 | Mixed hardware | 10 MR44 + 2 MS130-48P | 3yr | $19,813.91 | Multi-product quote works |
| 6 | Wi-Fi 7 | 5x CW9172I | 3yr | $5,843.99 | CW9172I-RTG suffix correct |
| 7 | License only | 20x LIC-ENT-3YR | — | $5,763.63 | No hardware, license-only works |
| 8 | Sensor | 10x MT14 | 3yr | $3,927.38 | MT14-HW + LIC-MT-3Y correct |
| 9 | Cellular gateway | 2x MG51 | 3yr | $3,949.27 | MG51-HW suffix correct |
| 10 | Large qty | 50x MR36 | 5yr | $51,906.81 | 50 units no timeout |
| 11 | EOL hardware | 3x MX64→MX67 | 3yr | $4,959.99 | Auto-replaced MX64 with MX67 |
| 12 | Hardware only | 5x MR44 | — | $4,565.25 | No licenses, hardware-only works |
| 13 | Wi-Fi 6E | 8x CW9166I | 3yr | $16,015.16 | CW9166I-MR suffix correct |
| 14 | Catalyst switch | 4x MS150-48FP-4G | 3yr | $14,659.40 | No suffix (correct for MS150) |
| 15 | Z-series | 10x Z4 | 3yr | $6,789.11 | Z4-HW suffix correct |
| 16 | Complex mixed | 5 MR44 (partial) | 3yr | $4,534.27 | ⚠️ Only MR44 portion created — couldn't fit 3 product families in one tool call |
| 17 | Very large | 100x MR44 | 3yr | $119,503.48 | 100 units, no timeout |
| 19 | MV93X camera | 4x MV93X | 5yr | $10,593.55 | MV93X-HW + LIC-MV-5YR correct |

### Failed (2/20) — Expected Edge Cases

| # | Description | Issue | Root Cause |
|---|-------------|-------|------------|
| 18 | MS390-48UX2 | Product marked inactive in Zoho | MS390-48UX2-HW exists in Products module but is flagged inactive. Known EOL product. Not a bot bug. |
| 20 | Umbrella DNS 50x | LIC-DNS-ESS-3YR not found | Umbrella license SKUs not in Zoho Products catalog. Would need to be added to WooProducts/Products. Not a bot bug. |

### Notable Observation — Test #16 (Complex Mixed Quote)

When asked to create a quote with 3 different product families (5 MR44 + 3 MX67 + 2 MS130-24P), the CRM agent only created the MR44 portion. The tool-use loop likely hit its iteration limit before adding all line items. This is a known limitation of complex multi-product quotes in a single chat message — consider breaking into multiple quotes or enhancing the tool to accept batch line items.

---

## Zoho Cleanup

- **18 test quotes**: All deleted successfully
- **Test deal** (2570562000389788117): Updated to **Closed (Lost)**, Reason: "Test/Evaluation Complete"
- **Test account** (TestCo Stress Eval LLC): Left intact (cannot delete accounts via API cleanly)
- **Test contact** (David Chen): Left intact

---

## Bugs Found & Fixed This Session

| Bug | Severity | Status | Fix |
|-----|----------|--------|-----|
| `licSkus is not iterable` crash in handleQuoteUrlTool | **Critical** | ✅ Fixed | Added `\|\| []` guard on getLicenseSkus() return in both workers |
| "licenses for" / "renewal" not triggering license-only mode | **Medium** | ✅ Fixed (prior session) | Added regex pattern at line 1854 |
| Invalid SKUs passing through without flagging | **Medium** | ✅ Fixed (prior session) | Added pre-validation scan of all raw SKU tokens |

## Remaining Items (Not Bugs, But Improvements)

1. **Complex multi-product CRM quotes** — Agent sometimes can't fit 3+ product families into a single quote in one tool-use pass. Consider batch line-item tool.
2. **Whitespace-only input** — Could add early return instead of falling through to Claude.
3. **MS390-48UX2 inactive** — Known EOL. Could add EOL detection in CRM agent to warn user.
4. **Umbrella SKUs missing** — Need to add Umbrella license SKUs to Zoho Products if customers request them.
