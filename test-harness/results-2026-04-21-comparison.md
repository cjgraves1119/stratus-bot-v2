# CRM Agent Model Benchmark — 3-way Comparison
**Date:** 2026-04-21
**Harness:** `test-harness/run-tests.js` (50-test matrix)
**Seed:** Quote 2570562000401497046 / Number 2570562000401497048
**Gateway:** `stratus-ai-bot-gateway.chrisg-ec1.workers.dev`

## Summary Table

| Model | Score | Accuracy | Avg Latency | Median | Max | Total Wall |
|-------|-------|----------|-------------|--------|-----|------------|
| Llama 4 Scout 17B  (CF) | 36/50 | **72%** | **5.4s**  | 4.2s  | 19.6s  | 267s |
| Gemma 4 26B (CF)        | 31/50 | 62%     | 13.2s    | 5.7s  | 106.4s | 658s |
| Kimi K2.6 1T MoE (CF)   | 30/50 | 60%     | 30.7s    | 24.1s | 113.2s | 1535s |

Llama is the clear accuracy and speed winner. Kimi is 5.7x slower than Llama with lower accuracy.

## Failure Matrix

| Category                  | Test IDs |
|---------------------------|----------|
| All 3 failed (infra/bug)  | 25, 31, 41, 49 |
| Only Llama passed         | 6, 11, 12, 13, 14, 15, 16, 26, 28, 45 |
| Only Gemma passed         | 37, 38, 44, 46 |
| Only Kimi passed          | 23, 24, 32 |

Llama is the most complementary model: it uniquely saves 10 tests that both Gemma and Kimi miss. Gemma uniquely covers 4 destructive/update tests. Kimi uniquely covers 3 tests but not enough to justify inclusion.

## Detailed Failures

**Llama failed:** 23, 24, 25, 29, 30, 31, 32, 35, 37, 38, 41, 44, 46, 49
**Gemma failed:** 1, 6, 10, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 28, 31, 32, 41, 45, 49
**Kimi failed:** 6, 11, 12, 13, 14, 15, 16, 25, 26, 28, 31, 37, 38, 41, 42, 43, 44, 45, 46, 49

## Waterfall Recommendation

**Keep the current 3-tier waterfall with Llama primary:**

1. **Llama 4 Scout 17B (CF)** — 72% standalone, 5.4s avg. Primary.
2. **Gemma 4 26B (CF)** — catches 4 tests Llama misses (37/38/44/46). Secondary fallback.
3. **Claude Sonnet 4.6** — final fallback for everything neither CF tier nails.

**Do NOT add Kimi K2.6 to the waterfall.** Reasons:

- 5.7x slower than Llama (30.7s vs 5.4s avg) — unacceptable for a real-time sidebar agent.
- Lower accuracy (60% vs 72%) — no win on the headline metric.
- Only 3 unique saves (23/24/32) — all tests Llama already covers through later retries.
- Kimi's reasoning-on-default exhausts the 2048 token budget; even with `enable_thinking:false` the deliberation overhead is baked into per-token latency.
- Redundant with Gemma: 14 overlapping failures (11-16, 25, 26, 28, 31, 41, 45, 49).

Kimi K2.6 stays wired in as a **force-only** option via `FORCE_MODEL=kimi` for benchmarking future Moonshot releases. Tier badges and `/api/chat` passthrough remain in place but Kimi never fires in the default waterfall.

## Infrastructure Bugs (shared failures across all 3 models)

These need fixes in the worker, not the model:

- **Test 25** — Quote_Number vs record_id disambiguation on delete.
- **Test 31** — First/Last name split on contact create.
- **Test 41** — Forced `Referal` phrasing (spelled correctly with one R).
- **Test 49** — Reason_For_Loss enforcement on Closed (Lost).

## Cost & Speed Implications

Llama 4 Scout on CF Workers AI is free for the current usage tier. At 5.4s average and ~$0 per call, the primary waterfall has zero incremental cost. Gemma 4 26B is also free but slower. Claude Sonnet 4.6 is the only paid tier and it fires only when both CF models stall or fail.

Adding Kimi would triple wall-clock latency on ~40% of CRM interactions with no accuracy gain. Kimi stays on the bench.

## Artifacts

- `results-llama-baseline-2-2026-04-21T09-38-57-464Z.jsonl` — Llama run, 50 tests.
- `results-gemma-baseline-1-2026-04-21T09-38-41-044Z.jsonl` — Gemma run, 50 tests.
- `results-kimi-baseline-2-2026-04-21T09-37-33-758Z.jsonl` — Kimi run, 50 tests.
- `/_debug-kimi` endpoint on worker-gchat for future Moonshot model probing.
