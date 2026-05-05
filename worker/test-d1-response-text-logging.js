// Regression test: every WebEx send path must log the rendered reply into
// bot_usage.response_text. Codex has flagged this gap on every WebEx D1 row
// since 2026-05-01 — without it, post-hoc diagnosis of dashboard / quote
// regressions has to fall back to scraping the WebEx room API.
//
// We don't actually hit D1 in this test — we stub env.ANALYTICS_DB.prepare()
// to capture the bind() argument list and assert response_text + tool_calls_json
// columns end up in the right slots, with sensible truncation.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
const edIdx = src.indexOf('export default');
if (edIdx > -1) {
  let depth = 0, started = false, end = edIdx;
  for (let i = edIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  src = src.slice(0, edIdx) + src.slice(end + 1);
}
src += '\nmodule.exports = { logBotUsageToD1 };';
const tmp = path.join(os.tmpdir(), `stratus-d1-resp-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { logBotUsageToD1 } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + (typeof diag === 'string' ? diag : JSON.stringify(diag)) : ''}`); fail++; }
};

function makeStubEnv() {
  const captured = { sql: null, binds: null };
  const stmt = {
    bind: (...args) => {
      captured.binds = args;
      return { run: async () => ({ success: true }) };
    }
  };
  const env = {
    ANALYTICS_DB: {
      prepare: (sql) => {
        captured.sql = sql;
        return stmt;
      }
    }
  };
  return { env, captured };
}

// ─── 1. SQL contract: INSERT now lists response_text + tool_calls_json ──────
{
  const { env, captured } = makeStubEnv();
  return_p1();
  async function return_p1() {
    await logBotUsageToD1(env, {
      personId: 'p1',
      requestText: 'quote 100 Duo essentials',
      responsePath: 'cf-deterministic',
      durationMs: 1234,
      responseText: 'Duo Essentials: 1-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=100'
    });
    check('INSERT statement includes response_text column',
      typeof captured.sql === 'string' && captured.sql.includes('response_text'),
      `sql=${captured.sql}`);
    check('INSERT statement includes tool_calls_json column',
      typeof captured.sql === 'string' && captured.sql.includes('tool_calls_json'),
      `sql=${captured.sql}`);
    check('INSERT has 11 placeholders (was 9) — schema parity with bot_usage table',
      typeof captured.sql === 'string' && (captured.sql.match(/\?/g) || []).length === 11,
      `placeholder count: ${captured.sql ? (captured.sql.match(/\?/g) || []).length : 'n/a'}`);

    // Bind order from new function:
    //   personId, requestText, responsePath, model, inputTokens, outputTokens,
    //   costUsd, durationMs, errorMessage, responseText, toolCallsJson
    check('Bind[0] is personId',
      Array.isArray(captured.binds) && captured.binds[0] === 'p1', JSON.stringify(captured.binds));
    check('Bind[1] is request text',
      Array.isArray(captured.binds) && captured.binds[1] === 'quote 100 Duo essentials',
      JSON.stringify(captured.binds));
    check('Bind[9] is response_text (the rendered reply)',
      Array.isArray(captured.binds) && captured.binds[9] && captured.binds[9].includes('LIC-DUO-ESSENTIALS-1YR'),
      JSON.stringify(captured.binds));
    check('Bind[10] is tool_calls_json (null when not provided)',
      Array.isArray(captured.binds) && captured.binds[10] === null, JSON.stringify(captured.binds));
  }
}

// ─── 2. response_text is truncated at 4000 chars ────────────────────────────
setTimeout(async () => {
  const { env, captured } = makeStubEnv();
  const huge = 'X'.repeat(10000);
  await logBotUsageToD1(env, {
    personId: 'p2',
    requestText: 'huge dashboard',
    responsePath: 'cf-vision-quote',
    responseText: huge
  });
  check('response_text bind value is truncated to 4000 chars',
    captured.binds && typeof captured.binds[9] === 'string' && captured.binds[9].length === 4000,
    `len=${captured.binds && captured.binds[9] && captured.binds[9].length}`);
}, 10);

// ─── 3. Missing response_text → null bind (back-compat for callers) ─────────
setTimeout(async () => {
  const { env, captured } = makeStubEnv();
  await logBotUsageToD1(env, {
    personId: 'p3',
    requestText: 'no reply provided',
    responsePath: 'claude'
  });
  check('When responseText is omitted, bind[9] is null (not undefined or empty string)',
    captured.binds && captured.binds[9] === null, JSON.stringify(captured.binds));
}, 30);

// ─── 4. tool_calls_json passes through verbatim (string or null) ────────────
setTimeout(async () => {
  const { env, captured } = makeStubEnv();
  const json = JSON.stringify([{ name: 'build_quote_url', input: { devices: [{ model: 'MR44', qty: 5 }] } }]);
  await logBotUsageToD1(env, {
    personId: 'p4',
    requestText: 'quote 5 MR44',
    responsePath: 'claude',
    responseText: 'Here is your quote',
    toolCallsJson: json
  });
  check('tool_calls_json bind is the verbatim JSON string passed in',
    captured.binds && captured.binds[10] === json, JSON.stringify(captured.binds));
}, 50);

// ─── 5. requestText still truncated at 500 chars (existing behavior) ────────
setTimeout(async () => {
  const { env, captured } = makeStubEnv();
  const longReq = 'Y'.repeat(800);
  await logBotUsageToD1(env, {
    personId: 'p5',
    requestText: longReq,
    responsePath: 'cf-conversation'
  });
  check('request_text still truncated to 500 chars (no regression)',
    captured.binds && typeof captured.binds[1] === 'string' && captured.binds[1].length === 500,
    `len=${captured.binds && captured.binds[1] && captured.binds[1].length}`);

  setTimeout(() => {
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
  }, 50);
}, 80);
