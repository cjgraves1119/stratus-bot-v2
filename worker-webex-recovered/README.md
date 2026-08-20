# Webex bot (stratus-ai-bot) — recovered

`src/index.js` was pulled from the LIVE Cloudflare worker on 2026-08-19, patched,
and re-uploaded. It is the deployed **bundle**, not the original modular source.
It redeploys correctly, but treat the real repo as preferable if it turns up.

## What was fixed (ported from stratus-ai-bot-gchat)

1. Inline quantity shift-by-one. "2 MS130-24 3 MR44 4 MX67C" parsed as 3/4/4.
   Silently wrong quantities on customer quotes, so the most serious of the four.
2. Trailing singular "license" was read as a whole-cart modifier, so
   "1 C8111-G2-MX and 1 z3 license" deleted the C8111 hardware from the cart.
   Plural "licenses" still covers the whole list.
3. A strong phrase before the first item or after the last now covers every item,
   so "2 MX67C and 4 MR44 hardware only" no longer licenses the MX67C.
4. Z model plural. "2 Z4s" resolved to a nonexistent Z4S.

Verified before upload by running the bundle's own parser over 445 phrasings:
255 unchanged, 110 quantity corrections, 80 intent corrections, 0 errors. Every
change fell into an intended bucket; plural "licenses" was untouched.

## Rollback

    npx wrangler rollback 29ea302e-befd-4176-a573-e9aed44f2044 --name stratus-ai-bot

`src/index.js.pre-fix-20260722-snapshot` is the exact pre-fix code as a fallback.

## Secrets

Six secrets are bound and their values are NOT readable through the API. They
were preserved on upload using `inherit` bindings. A deploy from this folder with
plain `wrangler deploy` will NOT recreate them — set them with `wrangler secret put`
if this worker is ever recreated from scratch.

## Pricing

This worker has no cron and does not need one. It reads the shared PRICES_KV
namespace that the daily 11:00 UTC cron on stratus-ai-bot-gchat refreshes.

## 2026-08-20 — non -HW is the default for duplicate codes

Ported from stratus-ai-bot-gchat so both workers agree (they share the price KV,
so a SKU meaning different things in each would price an ecomm quote and a CRM
quote differently).

`applySuffix` is now a post-pass over the family rules: if the resolved code ends
in `-HW` and the catalog knows the bare form, the bare form wins. Gated on the
catalog, not a hardcoded family list, so a family that migrates later is handled
the day its bare entry lands. `Object.assign(staticPrices, {...})` right after
`staticPrices` is bound carries the migrated entries; the price proxy also lets a
`_superseded_by` static entry beat KV, because a dead code's KV value can never
refresh.

Verified before upload by running the bundle's own resolver over all 1,082
catalog SKUs: 1,023 unchanged, 59 changed, 0 unexpected. Of the 59, 52 are the
intended migrations (MS130, MX, several MV) and 7 are repairs of codes that were
picking up a SECOND suffix (`Z3C-HW-NA-HW`).

## DO NOT `wrangler deploy` this worker

The reconstructed `wrangler.toml` is INCOMPLETE. The live worker has 14 bindings
including two plain_text vars (`ANTHROPIC_GATEWAY_URL`, `USE_PRODUCT_INFO_WATERFALL`)
and six secrets, and the toml has an EMPTY `[vars]` block and a blank D1
`database_name`. A `wrangler deploy` would drop the vars and mis-bind D1.

Upload through the API with every binding re-declared as `{"type":"inherit"}`:

    TOK=$(grep oauth_token ~/Library/Preferences/.wrangler/config/default.toml | cut -d'"' -f2)
    ACC=ec1888c5a0b51dc3eebf6bae13a3922b
    # metadata.json: {"main_module":"index.js","compatibility_date":"2024-01-01",
    #                 "compatibility_flags":[],"bindings":[{"type":"inherit","name":"AI"}, ...]}
    curl -X PUT -H "Authorization: Bearer $TOK" \
      -F "metadata=@metadata.json;type=application/json" \
      -F "index.js=@src/index.js;type=application/javascript+module" \
      "https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/stratus-ai-bot"

Read the current binding list from `.../scripts/stratus-ai-bot/settings` first and
build the inherit list from it, then re-read it afterwards to confirm the count.

Rollback for this change: version `b5600a5d-f048-41f4-9dfc-f8c3be862740`
(2026-08-19), or `src/index.js.pre-bare-sku-20260820`.
