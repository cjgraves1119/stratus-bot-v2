var EXT = globalThis.EXT_DIR || "/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/chrome-extension";
globalThis.__EXT = EXT;
function stripModule(src) {
  src = src.replace(/^import\s+\{[\s\S]*?\}\s+from\s+'[^']+';?\s*$/mg, "");
  src = src.replace(/^import\s+[^;]+;?\s*$/mg, "");
  src = src.replace(/^export\s+(class|function|const|let|default)\s/mg, "$1 ");
  return src;
}
globalThis.stripModule = stripModule;
// node:fs shims used by the existing test files (they read source files to
// assert on their contents).
globalThis.fs = { readFileSync: function (p) { return readFile(String(p)); } };
globalThis.readFileSync = globalThis.fs.readFileSync;
globalThis.createRequire = function () { return function () { return {}; }; };
(0, eval)(stripModule(readFile(EXT + "/src/lib/email-quote-flow.mjs")));
(0, eval)(stripModule(readFile(EXT + "/src/lib/context-lock.mjs")));
(0, eval)(stripModule(readFile(EXT + "/src/lib/product-search.mjs")));
(0, eval)(stripModule(readFile(EXT + "/src/sidebar/components/sku-editor-core.mjs")));
