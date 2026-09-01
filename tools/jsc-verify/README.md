# jsc-verify — run the test suites without Node

This Mac has **no Node runtime** (`/usr/local`, `/opt` are empty; `node`, `npm`,
`brew` are all absent), so `node --test`, `webpack` and `wrangler` cannot run
here. These scripts execute the same code and the same test assertions under
macOS's built-in JavaScriptCore shell instead:

    /System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc

They are a **stopgap verification harness**, not a replacement for `node --test`.
Once Node is installed, run the real suites and delete or ignore this folder.

## What each file does

| File | Purpose |
|---|---|
| `loader.js` | Strips `worker-gchat/src/index.js` to a script (inlines the JSON imports, stubs `cloudflare:workers`, removes `export default`) and evals it, putting every top-level function in global scope. Set `globalThis.WORKER_DIR` (and optionally `WORKER_FILE`) before `load()`. |
| `jsc-ext-harness.js` | Same idea for the chrome-extension pure-ESM modules (`email-quote-flow.mjs`, `context-lock.mjs`, `product-search.mjs`, `sku-editor-core.mjs`). |
| `node-test-shim.js` | Minimal `node:test` + `node:assert/strict` shim so the real `.mjs` test files run unmodified. |
| `run-test-file.py` | Rewrites a `.mjs` test file (drops the ESM imports and the `extractRealFunctions` bootstrap, binds `mod` to global scope) and runs it under jsc. |
| `corpus.js` / `snap.js` | A 71-input parser regression corpus and a snapshot dumper. Snapshot two revisions of `index.js` and diff the JSON to see exactly which inputs changed behavior. |

## Usage

Run one test file:

```bash
python3 tools/jsc-verify/run-test-file.py worker-gchat/test-mixed-cart-license-typo-chip-2026-08-18.mjs worker
python3 tools/jsc-verify/run-test-file.py chrome-extension/test-editor-resolved-sku-autofill-2026-08-18.mjs ext
```

Snapshot-diff the parser against a backup copy of `index.js`:

```bash
JSC=/System/Library/Frameworks/JavaScriptCore.framework/Versions/A/Helpers/jsc
SP=tools/jsc-verify
cat > /tmp/run.js <<EOS
globalThis.SP = "$PWD/$SP";
globalThis.WORKER_DIR = "$PWD/worker-gchat";
globalThis.WORKER_FILE = "$PWD/worker-gchat/index.js-backup-pre-fix123-20260818";
load(globalThis.SP + "/snap.js");
EOS
$JSC /tmp/run.js > /tmp/before.json
# drop WORKER_FILE to snapshot the current file, then diff the two JSON dumps
```

## Known harness limits

- Test files that compile JSX with `@babel/core` cannot run here
  (`chrome-extension/test-quote-sku-editor-2026-08-17.mjs`).
- `test-editable-quote-lines-2026-08-17.mjs` (4 fails) and
  `test-email-quote-flow-2026-08-17.mjs` (5 fails) fail under jsc because of
  missing browser/Node APIs, **not** because of product bugs. Verified by
  running each file against both the pristine and the patched sources and
  diffing per-test results: identical.
