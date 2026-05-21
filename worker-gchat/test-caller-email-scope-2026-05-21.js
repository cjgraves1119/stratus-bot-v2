// Regression: ReferenceError 'callerEmail is not defined' — a worker-side bug,
// NOT a Zoho 500. Commit 172cad3 (#87 "depersonalize owner mapping") added
// references to `callerEmail` at 6 deep call sites where it is not in lexical
// scope; `callerEmail` is only ever a parameter of getOwnerContext /
// getOwnerForCaller. Every record-creating quote path (create_deal_and_quote,
// create_quote_on_deal, zoho_create_record) threw before the Zoho POST.
// `node --check` does NOT catch ReferenceErrors, so this guards the regression
// at the source level.
// Run: node test-caller-email-scope-2026-05-21.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

// Brace-match a function declaration and return its full source, including an
// `async ` prefix when present.
function grab(name) {
  let i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found in source: ' + name);
  if (src.slice(i - 6, i) === 'async ') i -= 6;
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

console.log('── callerEmail scope regression ──');

// 1. No call site may pass `callerEmail` into getOwnerForCaller. The helper
//    reads env.__CALLER_EMAIL itself; deep call sites must call it with env only.
check('no getOwnerForCaller(env, callerEmail) call site remains',
  !/await\s+getOwnerForCaller\s*\(\s*env\s*,\s*callerEmail\s*\)/.test(src));

// 2. `callerEmail` may appear ONLY inside getOwnerContext / getOwnerForCaller.
//    Strip those two function bodies and assert no `callerEmail` token survives.
const restAfterStrip = src
  .split(grab('getOwnerContext')).join('')
  .split(grab('getOwnerForCaller')).join('');
check('callerEmail does not leak outside getOwnerContext/getOwnerForCaller',
  !/\bcallerEmail\b/.test(restAfterStrip));

// 3. Runtime: the fixed call form getOwnerForCaller(env) must resolve an owner
//    id without throwing — no email, an explicit email, and env.__CALLER_EMAIL.
const _ownerCache = new Map();
const SEED_USERS = [];
const OWNER_CACHE_TTL_MS = 60000;
async function ensureUsersTable() {}
eval(grab('getOwnerContext'));
eval(grab('getOwnerForCaller'));

(async () => {
  const env = { SYSTEM_OWNER_ID: '2570562000141711002' };
  try {
    const noEmail = await getOwnerForCaller(env);
    check('getOwnerForCaller(env) resolves system owner without throwing',
      noEmail === env.SYSTEM_OWNER_ID);
    const explicit = await getOwnerForCaller(env, 'someone@example.com');
    check('getOwnerForCaller(env, email) still works',
      typeof explicit === 'string' && explicit.length > 0);
    const viaEnv = await getOwnerForCaller({ ...env, __CALLER_EMAIL: 'x@example.com' });
    check('getOwnerForCaller reads env.__CALLER_EMAIL fallback',
      typeof viaEnv === 'string' && viaEnv.length > 0);
  } catch (e) {
    check('getOwnerForCaller threw: ' + e.message, false);
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
