# Cloudflare Workers AI Model Contender Audit

Date: 2026-05-06

## Scope

Reviewed the live Cloudflare Workers AI catalog as exposed by `wrangler ai models --json`.

- Total models: 91
- Text-generation models: 55
- Decision-grade classifier benchmark endpoint: `https://stratus-ai-bot.chrisg-ec1.workers.dev/api/benchmark-classifier`
- All benchmark calls below were live Workers AI calls through the deployed Worker, not local simulations.

## Current Baselines

| Model | Prompt | Overall | Intent | Parse Fail | p50 | p95 | Decision |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Llama 4 Scout | production V2 | 95.1% | 95.9% | 0 | 2.1s | 2.8s | Current free-model benchmark to beat |
| Gemma 4 26B | production V2 | 96.1% | 97.3% | 0 | 14.0s | 35.7s | Accurate but too slow for primary |
| Kimi K2.6 | strict JSON | 89.5% | 91.9% | 2 | 12.2s | 101.3s | Exclude from production waterfall |

## Full-Pass New Contenders

These models survived the initial 10-fixture smoke screen and were promoted to the full 74-fixture classifier benchmark.

| Model | Prompt | Overall | Intent | Parse Fail | p50 | p95 | Assessment |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | production V2 | 92.0% | 93.2% | 0 | 3.2s | 4.2s | Best new contender; worth shadow testing |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | production V2 | 91.5% | 94.6% | 0 | 4.9s | 7.2s | Good fallback candidate; slower than Llama 4 |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | production V2 | 87.8% | 91.9% | 0 | 3.6s | 5.4s | Not enough accuracy for classifier primary |

Full eval run:

- `eval-contenders-full-1778092974`
- D1 `bot_usage_eval`: 222 rows, 222 `live_llm_call`, 3 distinct executed models

## Smoke-Screened Models

The following likely contenders were screened on 10 representative fixtures before deciding whether to promote them to a full pass.

| Model | Best Observed Result | Main Failure Shape | Prompt-Tuning Potential | Decision |
| --- | ---: | --- | --- | --- |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | 90.6% smoke, 100% intent | Clean JSON, fast | High enough to justify full pass | Promote; shadow candidate |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 85.9% smoke, 90% intent | Boundary misses | Moderate | Promote; fallback candidate |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | 82.8% smoke, 90% intent | License/price intent confusion | Moderate | Promote; below parity |
| `@cf/google/gemma-4-26b-a4b-it` | 84.4% smoke, 80% intent | Slow tail latency | Prompt already strong in baseline | Keep existing Gemma 4 fallback only |
| `@cf/ibm-granite/granite-4.0-h-micro` | 54.5% strict smoke | Partial schema following | Some, but too far from parity | Do not promote |
| `@cf/openai/gpt-oss-120b` | 43.6% smoke | JSON truncation / output length | Possible with compact schema + higher cap | Revisit only if a GPT-specific endpoint is added |
| `@cf/qwen/qwen3-30b-a3b-fp8` | 47.4% smoke | JSON contract failure | Low to moderate | Do not promote now |
| `@cf/qwen/qwq-32b` | 34.6% smoke | Reasoning-model verbosity, slow | Low for classifier use | Do not promote |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | 39.5% strict smoke | Reasoning verbosity, parse misses | Low for classifier use | Do not promote |
| `@cf/zai-org/glm-4.7-flash` | 0% smoke | Answer appears in reasoning field, content null | Provider-specific extraction needed, still not proven | Do not promote |
| `@cf/nvidia/nemotron-3-120b-a12b` | 19.5% smoke | JSON contract failure | Low in current endpoint | Do not promote |
| `@cf/moonshotai/kimi-k2.5` | 50.0% smoke | Slow, errors, parse failures | Low; Kimi K2.6 already failed full eval | Do not promote |

## Remaining Text-Generation Catalog

The remaining text-generation models were not promoted because they are old, tiny, low-capacity, language-specialized, safety-specialized, code/SQL/math-specialized, LoRA-host models, or legacy 7B-class models. Prompt refinement cannot reasonably make these beat Llama 4 Scout on this strict schema classifier task.

Examples:

- Tiny/low-capacity: TinyLlama 1.1B, Qwen 0.5B/1.8B, Llama 3.2 1B/3B, Gemma 2B
- Legacy 7B/8B class: Llama 2 7B/13B, Llama 3 8B, Mistral 7B, Falcon 7B, OpenChat 3.5, Zephyr 7B, OpenHermes 7B, NeuralChat 7B, Starling 7B
- Specialist or wrong task: Llama Guard, SQLCoder, DeepSeek Coder, DeepSeek Math, German DiscoLM, LoRA host models
- Vision/image-capable but not better text classifier candidates: Llama 3.2 11B vision

## Recommendation

Do not replace Llama 4 Scout.

Recommended waterfall order for future canary work:

1. Tier 0 deterministic gates
2. Llama 4 Scout for approved low-risk classes
3. Optional shadow/fallback experiment: Gemma SEA-LION 27B
4. Optional fallback only: Gemma 4 26B, when accuracy matters more than latency
5. Claude

Do not place Kimi K2.6, Kimi K2.5, QwQ, DeepSeek R1 distill, GLM, Nemotron, GPT OSS, Granite, or Mistral Small before Claude in production yet.

GPT OSS 120B deserves a narrow follow-up only if we build a GPT-specific compact schema prompt and raise the benchmark token cap; the current evidence is an endpoint-contract mismatch plus weak smoke score, not a clean model-quality result.

## Appendix: Text-Generation Model Disposition

| Model | Disposition |
| --- | --- |
| `@cf/aisingapore/gemma-sea-lion-v4-27b-it` | Full eval contender: shadow candidate |
| `@cf/deepseek-ai/deepseek-math-7b-instruct` | Specialist model; wrong task |
| `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b` | Smoke failed; reasoning-model mismatch |
| `@cf/defog/sqlcoder-7b-2` | Specialist model; wrong task |
| `@cf/fblgit/una-cybertron-7b-v2-bf16` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/google/gemma-2b-it-lora` | LoRA host/base path; not a direct contender |
| `@cf/google/gemma-3-12b-it` | Too small/low capacity |
| `@cf/google/gemma-4-26b-a4b-it` | Existing fallback candidate; high latency |
| `@cf/google/gemma-7b-it-lora` | LoRA host/base path; not a direct contender |
| `@cf/ibm-granite/granite-4.0-h-micro` | Smoke failed; too far from parity |
| `@cf/meta-llama/llama-2-7b-chat-hf-lora` | LoRA host/base path; not a direct contender |
| `@cf/meta/llama-2-7b-chat-fp16` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-2-7b-chat-int8` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-3-8b-instruct` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-3-8b-instruct-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-3.1-8b-instruct-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-3.1-8b-instruct-fp8` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/meta/llama-3.2-11b-vision-instruct` | Too small/low capacity |
| `@cf/meta/llama-3.2-1b-instruct` | Too small/low capacity |
| `@cf/meta/llama-3.2-3b-instruct` | Too small/low capacity |
| `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Full eval contender: fallback candidate |
| `@cf/meta/llama-4-scout-17b-16e-instruct` | Current benchmark |
| `@cf/meta/llama-guard-3-8b` | Safety classifier; wrong task |
| `@cf/microsoft/phi-2` | Too small/low capacity |
| `@cf/mistral/mistral-7b-instruct-v0.1` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/mistral/mistral-7b-instruct-v0.2-lora` | LoRA host/base path; not a direct contender |
| `@cf/mistralai/mistral-small-3.1-24b-instruct` | Full eval contender: below parity |
| `@cf/moonshotai/kimi-k2.5` | Smoke failed; inferior to Kimi K2.6 |
| `@cf/moonshotai/kimi-k2.6` | Full eval failed latency/accuracy |
| `@cf/nvidia/nemotron-3-120b-a12b` | Smoke failed; JSON contract weakness |
| `@cf/openai/gpt-oss-120b` | Smoke failed; possible compact-schema follow-up |
| `@cf/openai/gpt-oss-20b` | Smoke failed; too many parse misses |
| `@cf/openchat/openchat-3.5-0106` | Not promoted after catalog review |
| `@cf/qwen/qwen1.5-0.5b-chat` | Too small/low capacity |
| `@cf/qwen/qwen1.5-1.8b-chat` | Too small/low capacity |
| `@cf/qwen/qwen1.5-14b-chat-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/qwen/qwen1.5-7b-chat-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/qwen/qwen2.5-coder-32b-instruct` | Specialist model; wrong task |
| `@cf/qwen/qwen3-30b-a3b-fp8` | Smoke failed; JSON contract weakness |
| `@cf/qwen/qwq-32b` | Smoke failed; reasoning-model mismatch |
| `@cf/thebloke/discolm-german-7b-v1-awq` | Language-specialized; see SEA-LION exception above |
| `@cf/tiiuae/falcon-7b-instruct` | Legacy/small class; unlikely to beat Llama 4 |
| `@cf/tinyllama/tinyllama-1.1b-chat-v1.0` | Too small/low capacity |
| `@cf/zai-org/glm-4.7-flash` | Smoke failed; content null/reasoning field |
| `@hf/google/gemma-7b-it` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/mistral/mistral-7b-instruct-v0.2` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/nexusflow/starling-lm-7b-beta` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/nousresearch/hermes-2-pro-mistral-7b` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/thebloke/deepseek-coder-6.7b-base-awq` | Specialist model; wrong task |
| `@hf/thebloke/deepseek-coder-6.7b-instruct-awq` | Specialist model; wrong task |
| `@hf/thebloke/llama-2-13b-chat-awq` | Too small/low capacity |
| `@hf/thebloke/mistral-7b-instruct-v0.1-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/thebloke/neural-chat-7b-v3-1-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/thebloke/openhermes-2.5-mistral-7b-awq` | Legacy/small class; unlikely to beat Llama 4 |
| `@hf/thebloke/zephyr-7b-beta-awq` | Legacy/small class; unlikely to beat Llama 4 |
