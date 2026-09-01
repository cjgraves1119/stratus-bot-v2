# MR Advanced Chat-tab incident — 2026-09-01

## Symptom

The installed Stratus AI DEV 1.29.12 extension returned `LIC-ENT-1YR` for:

> Quote 1 MR44 with Advanced licensing for 1 year. Draft only. Do not create any CRM record.

Isolated `parseMessage()` and `buildQuoteResponse()` tests were already returning the correct `LIC-MR-ADV-*Y` family, so those tests alone gave a false sense of completion.

## Root cause

The extension Chat tab sets `emailContext.source = "chat-tab"`. The gateway forwards `/api/chat` to the gchat Worker's `/api/chat-waterfall`, where Chat-tab requests intentionally skipped Tier 0 and used the CRM agent. Its active and reference prompts still described `LIC-ENT-{term}YR` as universal across all MR APs. Claude therefore returned Enterprise even though the deterministic quote engine understood MR Advanced.

A separate stale-chunk error occurred after unpacked extension contents changed without a Chrome extension reload. That was a browser artifact issue, not the license-selection root cause.

## Fix

- Added a narrow deterministic Chat-tab route only when the request explicitly contains MR Advanced, `Draft only`, and an explicit no-CRM-write instruction.
- Corrected both CRM prompts: default/Enterprise MR uses `LIC-ENT-{term}YR`; explicit MR Advanced uses `LIC-MR-ADV-{term}Y` for 1/3/5 years; CW remains Enterprise-only; “Advanced Security” remains MX-specific.
- Added `license_tier` to quote-creation tool schemas and server-side MR-only tier preservation for future user-approved CRM writes.
- Added regression tests for exact 1/3/5-year Chat-tab prompts, negative routing cases, prompt/schema wiring, and default Enterprise behavior.
- Uploaded Worker script content only, preserving configuration and all 43 bindings.

## Verified production result

Worker `stratus-ai-bot-gchat` deployment `fa512d54-a2ca-4040-bf1a-3d6734e09831`, version `1fd20808-70c6-4075-aa91-5ca7f41f4c87`:

- MR44 Advanced 1Y → `LIC-MR-ADV-1Y`
- MR44 Advanced 3Y → `LIC-MR-ADV-3Y`
- MR44 Advanced 5Y → `LIC-MR-ADV-5Y`
- MR44 Enterprise 3Y → `LIC-ENT-3YR`

All four were run through the actual installed cloud extension as draft-only tests with no CRM context selected and no CRM record created. Worker and gateway health returned HTTP 200 after deployment.

## Stop wasting time rule

For future extension quote incidents, trace the entire live route before changing code: installed extension → gateway → deployed Worker endpoint → deterministic or CRM-agent path. A helper test is not a live-path test. After changing unpacked extension files, reload the extension before interpreting chunk errors. Do not call the issue fixed until the exact user-visible SKU is verified through the installed extension.
