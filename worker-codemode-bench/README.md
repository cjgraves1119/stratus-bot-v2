# worker-codemode-bench

**Standalone benchmark worker.** Runs both Code Mode and standard tool-calling
side-by-side against the same fixtures. Zero production traffic. Disposable.

See `docs/codemode-ab-bench.md` for the full plan + Codex review checklist.

## Quick start

```bash
# Local CLI (mocked sandbox)
ANTHROPIC_API_KEY=... node src/cli.js --batch --frameworks tools,codemode --models llama-4-scout --output ./results.jsonl

# Deploy
CLOUDFLARE_API_TOKEN=$STRATUS_CF_API_TOKEN npx wrangler deploy

# Run from harness
node ../test-harness/codemode/run-bench.js --target https://stratus-codemode-bench.chrisg-ec1.workers.dev --auth $STRATUS_BENCH_AUTH_TOKEN --output ./results.jsonl
node ../test-harness/codemode/build-dashboard.js results.jsonl > dashboard.html
```
