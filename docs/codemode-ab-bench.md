# Code Mode A/B bench — plan & Codex review

## What this is

Standalone benchmark worker (`worker-codemode-bench`) for comparing Cloudflare
Code Mode against standard tool-calling on the Stratus AI CRM agent surface.
Zero production touch. Designed to answer "is Code Mode better out of the box?"
without instrumenting prod with shadow logging or rollout flags.

## Why we want to know

Per the Bot Engineering Brain (queried 2026-05-07):

- worker-gchat exposes 24 Zoho CRM tools, eating context window space
- Tier 1 Llama 4 Scout has documented 0% reliability on complex CRM tasks
  (subform edits, clone_quote pricing desync) — gets stuck in sequential JSON
  formatting and triggers `tool_loop > 10` stall heuristic
- Cloudflare Code Mode's CodeAct premise: LLMs are better at writing code than
  at sequential JSON tool-calling. Anthropic also independently introduced this
  pattern as "Code Execution with MCP"
- Cloudflare's internal MCP portal: 52 tools = ~9,400 tokens collapsed to ~600
  with Code Mode (94% reduction); their full API exposed at ~1,000 tokens
  regardless of 2,500+ endpoints (99.9% reduction)
- The Stratus pricing/correctness gates we just deployed are deterministic
  compound tools — they MUST stay outside Code Mode (Cloudflare's
  `needsApproval` workflow not yet supported), but the routing/discovery
  logic AROUND them is the exact failure mode CodeAct targets

## What this PR adds

- `worker-codemode-bench/` — standalone Worker with `/run` and `/run-batch`
  endpoints. Invokes either runner against fixtures, returns normalized
  results.
- `test-harness/codemode/run-bench.js` — driver that hits the deployed bench
  and writes JSONL.
- `test-harness/codemode/build-dashboard.js` — renders side-by-side HTML
  comparison.
- 10 V3 fixtures covering read-simple, read-multi-step, write-prep,
  write-prep-complex (Llama-weakness), multi-step decision trees, and full
  end-to-end. Includes `clone_quote_with_discount_change` and
  `long_subform_update` cases the brain flagged.

## What this PR does NOT add

- Shadow-mode wiring in production worker-gchat
- D1 schema migration
- Feature flags in prod (`USE_CODEMODE_*`)
- Any change to existing prod hot paths

If the bench shows Code Mode is materially better, those become a follow-up
PR. If it's neutral or worse, we delete `worker-codemode-bench/` and move on.

## How to use it

### Local CLI (no Cloudflare runtime)

```bash
cd worker-codemode-bench
npm ci
npm run check                                    # node --check on every src file
npm test                                          # all tests, no LLM calls

# Single fixture (mocked sandbox)
ANTHROPIC_API_KEY=... node src/cli.js \
  --fixture fix_005_clone_quote_with_discount_change \
  --framework codemode \
  --model llama-4-scout

# Batch
ANTHROPIC_API_KEY=... node src/cli.js \
  --batch \
  --frameworks tools,codemode \
  --models llama-4-scout,claude-sonnet-4-6 \
  --output ./local-results.jsonl
```

### Deployed (real Cloudflare runtime)

```bash
source ~/Bots/.stratus-secrets
cd worker-codemode-bench
npm ci
echo $ANTHROPIC_API_KEY | npx wrangler secret put ANTHROPIC_API_KEY
echo "<random-token>" | npx wrangler secret put STRATUS_BENCH_AUTH_TOKEN
# Optional: route reads to live worker-gchat
echo "https://stratus-bot-v2-gchat.cjgraves1119.workers.dev" | npx wrangler secret put GCHAT_URL
echo "$GCHAT_BENCH_AUTH" | npx wrangler secret put GCHAT_AUTH

CLOUDFLARE_API_TOKEN=$STRATUS_CF_API_TOKEN npx wrangler deploy

node ../test-harness/codemode/run-bench.js \
  --target https://stratus-codemode-bench.chrisg-ec1.workers.dev \
  --auth "$STRATUS_BENCH_AUTH_TOKEN" \
  --frameworks tools,codemode \
  --models llama-4-scout,claude-sonnet-4-6 \
  --output ./results-$(date +%Y%m%d).jsonl

node ../test-harness/codemode/build-dashboard.js results-*.jsonl > dashboard.html
open dashboard.html
```

## Decision criteria — what counts as "Code Mode wins"

Per-fixture-per-framework-per-model the bench reports: success, wall_ms,
tokens_in/out, iterations, expected vs actual tool sequence.

Code Mode is recommended for production adoption if ALL of:

1. **Llama-on-Code-Mode success rate ≥ Llama-on-tools** on Llama-weakness
   fixtures (`fix_005_clone_quote_with_discount_change`,
   `fix_009_long_subform_update`) — minimum threshold: lifts from ~0% to ≥60%.
2. **No regression on simple reads** — Code Mode doesn't underperform
   tool-calling on `fix_001_account_lookup_simple`,
   `fix_007_disambiguate_then_write`.
3. **Token cost wins** for multi-step fixtures — ≥30% input-token reduction
   on multi-step categories.
4. **No correctness regression on write_prep fixtures** — write tools must
   still be called with correct arguments under Code Mode.

If 1 holds but 2/3 don't, narrow adoption to Llama-weakness category only. If
nothing holds, abandon and document why.

## Codex review checklist

### Code structure / safety

- [ ] **Production worker-gchat untouched.** `git diff main..HEAD -- worker-gchat/`
  shows no changes. Same for worker, worker-gateway.
- [ ] **No new tracked files in production paths.** All new code under
  `worker-codemode-bench/`, `test-harness/codemode/`, `docs/`.
- [ ] **wrangler.toml has worker_loaders binding.** Required by `@cloudflare/codemode`.
- [ ] **Auth gate works.** `STRATUS_BENCH_AUTH_TOKEN` checked on every endpoint.
- [ ] **dryRun is default true.** Destructive tools NEVER fire real Zoho writes
  unless operator explicitly sets `dry_run: false` AND `STRATUS_BENCH_ALLOW_REAL_WRITES=1`.

### Bench fairness

- [ ] **Same destructive surface on both runners.** Both `runner-tools.js` and
  `runner-codemode.js` import `WRITE_TOOLS` from the same `src/tool-surface.js`
  and pass them as standard tool calls. Code Mode wraps only `READ_TOOLS`.
- [ ] **Same model dispatch.** Both runners call `callModel` from `src/model-clients.js`.
- [ ] **Same tool execution path.** Both runners dispatch every tool call
  through `src/tool-executor.js executeTool`.
- [ ] **No prompt cherry-picking.** Base system prompt identical; Code Mode
  appends a hint about the `code` tool but doesn't rewrite the prompt.
- [ ] **Result shapes are identical.** `test-runner-shapes.js` validates
  both runners emit the same keys.

### Adversarial corners

- [ ] **Subform id round-tripping.** When Code Mode's typed bindings serialize
  Zoho subform records, do they preserve the `id` field on each line so the
  generated code can reference them? Spike: load a quote with multiple
  Quoted_Items in the CLI, have Code Mode read it and return the line ids,
  verify they match.
- [ ] **Conversation memory.** The bench is single-turn. Real prod has multi-
  turn flows. Document explicitly that this experiment doesn't measure that.
- [ ] **D1 telemetry resolution.** When deployed, every Code Mode run logs
  ONE bot_usage row vs N rows per tool call on standard. The bench captures
  `codemode_rpc_dispatches` and individual `tool_calls[]` entries to
  compensate, but real visibility gap if Code Mode goes to prod later.
- [ ] **Sandbox timeout default.** Default 30s; bench config 120s. Confirm
  enough for largest fixture.
- [ ] **`@cloudflare/codemode` package version pinning.** Currently `"*"` —
  needs to be pinned before deploy. Brain says: "Codemode is experimental
  and may have breaking changes."

### Fixture coverage

- [ ] **Llama-weakness category present.** `fix_005`, `fix_009` cover subform
  edits and tool_loop > 10 cases.
- [ ] **MV73 disambiguation gate present.** `fix_007` validates the gate
  fires equally under both frameworks.
- [ ] **Pricing-correctness fixtures.** `fix_006` tests the
  `quote_to_po_and_esign` compound tool path, ensuring Code Mode doesn't
  bypass the just-deployed Zanesville fixes.

### Disposal plan

- [ ] **README documents disposal.** Worker deleted from Cloudflare,
  directory removed, decision documented.

## Open questions for Codex

1. **Read-side stub vs live round-trip.** `tool-executor.js` defaults to
   fixture stubs when `GCHAT_URL` isn't set. Should the harness require live
   round-trips for realistic latency, or are stubs acceptable for first-pass
   directional answer? Recommendation: live round-trips via `GCHAT_URL`, but
   a `/api/bench-tool` endpoint on worker-gchat needs to be added (thin RPC
   wrapper). Should that land in this PR or a follow-up?
2. **Workers AI tool-call shape.** `model-clients.js` has placeholder shape
   conversion for Workers AI. Llama 4 Scout via `env.AI.run()` has its own
   format that differs from Anthropic's. Current conversion is a guess; needs
   validation against a real Workers AI response.
3. **Cost cap.** Should the harness enforce a hard daily budget or is the
   bench operator responsible for cost control via fixture/model selection?
4. **Real package version.** Pin `@cloudflare/codemode` and `ai` to the
   versions Codex tests against before merging.

## Disposal

When the experiment concludes:
1. Decision documented in `docs/codemode-bench-result.md` (success-or-fail
   with the dashboard screenshot and rollup numbers).
2. `wrangler delete stratus-codemode-bench`.
3. `rm -rf worker-codemode-bench/ test-harness/codemode/` and PR removing.
4. No prod cleanup needed (none was added).
