# Stratus DEV source provenance

Canonical restored source baseline used for the v1.26.8 rebuild:

`/Users/chris/Documents/Codex/2026-08-13/cloud-migration-plan-chatgpt-conversation-6a7d4d31/work/migration-restore-2026-08-17/projects/Documents/Codex/2026-08-13/airdrop-stratus-dev-extension/work/mx-ms-nonhw-deal-default-v1.26.3`

Isolated editable working copy:

`/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8`

Verification recorded on 2026-08-17:

- `worker-gchat` builds byte-for-byte to the JavaScript module deployed as Cloudflare Worker `stratus-ai-bot-gchat` version 976 (`fc36b864-d238-40e4-bf75-7c9d989cd1b1`, deployed 2026-08-13T08:16:29Z).
- `chrome-extension/src/sidebar/panels/ChatPanel.jsx` SHA-256 is `6b93f3f35fd650206df7ec41d61e941c1de33a9c1594d6e97be49c6052df9566`, matching the embedded `sourcesContent` in the installed DEV v1.26.7 sidebar source map.
- The restored baseline contains complete editable source, tests, build dependencies, and v1.26.3 build artifacts, but no `.git` metadata.
- Installed DEV v1.26.7 also contains later local post-build fixes that are not in the restored source baseline. Those fixes must be ported into editable source and regression-tested before replacing the installed package.

Do not treat `/Users/chris/Documents/Stratus extensions/stratus bot dev` as source. It is the currently loaded compiled unpacked extension and must only be replaced from a verified source build with a recoverable sibling backup.

## v1.26.8 reviewed build and deployment state

Recorded on 2026-08-17:

- Extension source and dist passed independent review with no actionable findings. Manifest version is `1.26.8`; the active DEV gateway is `https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev`.
- Deterministic extension-dist tree SHA-256 is `bf43a1e50a109ef6be228833b8aa08e82061b8763549e0a4235d0d56441e246c` across 33 regular files. Manifest SHA-256 is `c7e368ee64c604e2f5e99ca0ad783c92ffabd5816b7784293307e6dfbe0bf96e`.
- Worker source `worker-gchat/src/index.js` SHA-256 is `e39a9e37a53d60c2b240647a99e47531206cccedf15cccded537317657467775`. Independent focused review passed 167 tests with zero failures; a fresh Wrangler dry-run bundle SHA-256 was `5286a6ad6f27fbe07a3463bd5b04d40f61f6f681130f858ef22a4965ff4dea6b`.
- D1 migration `migrations/0001_oneshot_claims.sql` was applied to `stratus-bot-analytics` and read-only schema verification confirmed `oneshot_claims` exists. Wrangler reports no pending migrations.
- Cloudflare Worker `stratus-ai-bot-gchat` version 977 (`34b2dcf3-aa34-4e0e-bd94-9b9da03b94d9`) was deployed at 100% on 2026-08-17T21:41:30Z. Its script ETag is `8da3673a95b6c4e579cc0d866a41cfa0dcccd45abcb57784c033c6f18ec4579c`. The rollback version is 976 (`fc36b864-d238-40e4-bf75-7c9d989cd1b1`).
- The complete prior compiled v1.26.7 folder was preserved at `/Users/chris/Documents/Stratus extensions/stratus bot dev-backup-v1.26.7-20260817-164455`; its deterministic tree SHA-256 is `c90a39b2a6506346d329f2f480f017bcc51d2e2227b2bbfd9f7dd089b7e7af1b` across 35 regular files.
- The reviewed v1.26.8 dist was copied byte-for-byte to `/Users/chris/Documents/Stratus extensions/stratus bot dev`; its post-copy tree hash exactly matches `bf43a1e50a109ef6be228833b8aa08e82061b8763549e0a4235d0d56441e246c`.
- Comet Extensions visibly reports `Stratus AI (DEV)` version `1.26.8`, enabled, loaded unpacked from `/Users/chris/Documents/Stratus extensions/stratus bot dev`, extension ID `fkopkkoaedjgkcdhgblkoaaicmkpnhhb`, and gateway `https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev`. Developer Mode is on and Comet confirmed `Reloaded` after the reviewed folder was installed.
- A synthetic typed request, `Quote MR36 x 2`, produced a deterministic e-commerce card with parsed `MR36 × 2`, exact 1/3/5-year Stratus order links, and a separate explicit `Create Zoho CRM quote from this` action. No Zoho action was clicked.
- After closing and recreating the side panel, the card restored safe SKU/quantity labels and all three Stratus order URLs. It did not display the old non-durable placeholder. The restored card intentionally requires the quote to be rerun before a CRM workflow.
- Repeating the identical synthetic request succeeded and produced the same deterministic links. D1 `bot_usage` recorded both requests at `2026-08-17 22:01:41` and `22:02:14` as `bot=addon`, `response_path=deterministic`, with no model, no error, and no tool calls.
- A post-deploy read-only D1 audit found zero one-shot execute claims, zero `bot_usage` errors since deployment, and zero non-2xx gateway entries since deployment. The audit wrote zero rows.
- On the synthetic Stratus cart reached from the generated order link, the live cart reader reported `MR36-HW × 2` and `LIC-ENT-1YR × 2`. It did not require pricing and reported that Quick Quote was not populated on that surface. No CRM action was invoked.
- A live Gmail Create Quote test was not run because the foreground changed to a customer thread during the synthetic repeat test. No Gmail control or extension email-context action was used there. Email intake and context-menu startup behavior remain covered by local automated tests unless an explicitly synthetic Gmail thread/text is selected for a separate manual check.
