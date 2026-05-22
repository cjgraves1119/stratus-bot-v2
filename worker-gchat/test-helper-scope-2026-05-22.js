// Regression: the geo / field-alias / placeholder / contact-name / meraki-isr
// helper functions were accidentally defined INSIDE the fetch() handler —
// written at column 0, so they looked module-level but weren't. That made them
// invisible to executeToolCall, throwing `ReferenceError: applyFieldAliases is
// not defined` on every zoho_update_record / zoho_create_record call.
// They must stay at genuine module scope. `node --check` does NOT catch this;
// ESLint no-undef does — and so does this test.
// Run: node test-helper-scope-2026-05-22.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

console.log('── module-scope helpers regression ──');

// `export default { async fetch(...) }` is the worker entry point; everything
// inside it is fetch-scoped. These helpers are called from executeToolCall (a
// module-level function), so they MUST be defined before `export default {`.
const exportIdx = src.indexOf('\nexport default {');
check('export default { marker found', exportIdx > 0);

const MODULE_SCOPE_HELPERS = [
  'normalizeStateCode', 'normalizeCountryCode', 'applyFieldAliases',
  'detectPlaceholderAddress', 'deriveContactNameFields', 'normalizeMerakiIsrPayload',
];
for (const name of MODULE_SCOPE_HELPERS) {
  const defIdx = src.indexOf('function ' + name + '(');
  check(`${name} defined at module scope (before export default, not inside fetch)`,
    defIdx > 0 && exportIdx > 0 && defIdx < exportIdx);
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
