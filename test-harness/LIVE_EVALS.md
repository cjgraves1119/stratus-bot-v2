# Live Waterfall Eval Guardrails

Decision-grade waterfall results must come from live calls against the deployed
Stratus endpoints and actual LLM providers. Fixture-only parser checks and local
simulation stress tests can remain useful regression coverage, but they must not
be used as evidence to relax Claude routing.

## Decision-Grade Sources

- `test-harness/run-tests.js` posts to the deployed gateway `/api/chat` path.
- `benchmark-3variant.js` posts to the deployed `/api/benchmark-classifier`
  endpoint, which calls the bound Workers AI model.
- `/api/benchmark-product-info` calls either Anthropic Claude Sonnet 4.6 or the
  bound Workers AI Llama/Gemma model path.

## Required Evidence Fields

Every decision-grade row should preserve:

- `decisionGrade: true`
- `liveLlmCall: true`
- `tier0Deterministic: true` when the deployed endpoint handled the request
  before any model call
- `simulated: false`
- `syntheticEval: true`
- `evalRunId`
- the deployed `endpoint`
- `requestedModel` for forced-model runs, or `null` for waterfall mode
- `executedModel` and `tierPath` when the endpoint returns model/tier metadata
- `attempts` and `transientErrors`
- `inputTokens` and `outputTokens` when the provider returns usage metadata
- elapsed milliseconds and raw response text

`tierPath` is exact when the endpoint returns iteration or waterfall-hop
metadata, for example `llama,gemma,claude`. A single value such as `claude` or
`llama` means only one tier was observed or the endpoint did not expose full
hop metadata; do not treat a single value as proof that other tiers were
incapable.

Token fields are decision-useful for Anthropic responses. Cloudflare Workers AI
response shapes vary by model, so Llama/Gemma `inputTokens` and `outputTokens`
may be `0` even when a live model call occurred. Treat CF token counts as
best-effort until the harness has per-model usage extraction.

For production gateway/chat eval traffic, the harness sends `X-Eval-Run-Id`.
The gateway forwards that header to the GChat worker, and the GChat worker
writes D1 telemetry to `bot_usage_eval` instead of normal `bot_usage` so
customer-facing usage reports stay clean.

## Non-Decision Sources

Files such as `worker/stress-test-ab.js` and `worker/stress-test-order.js`
explicitly simulate classifier or waterfall behavior. Their results are not
allowed to count toward Llama/Gemma parity or Claude fallback relaxation.
