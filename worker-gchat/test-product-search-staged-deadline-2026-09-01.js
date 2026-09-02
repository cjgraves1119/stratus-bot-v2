// Offline regression for the product picker's two independent live reads.
//
// searchActiveProducts() answers identity from Products/search and storefront
// classification from WooProducts/search. Until 2026-09-01 both reads raced ONE
// deadline promise: when the identity read used most of the window, the Woo
// read was left with the remainder and every live row came back `unknown`
// even though WooProducts would have answered a few hundred milliseconds
// later. Each read now has its own bounded budget (each capped at
// PRODUCT_SEARCH_DEADLINE_MS, so the whole call stays under 2x that).
//
// Staged latency below: identity takes ~75% of the budget, Woo takes another
// ~65%. Old behaviour: Woo aborted, rows unknown. New behaviour: classified.
// Run: node worker-gchat/test-product-search-staged-deadline-2026-09-01.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const here = __dirname;
const indexPath = path.join(here, 'src/index.js');

function loadWorker() {
  let src = fs.readFileSync(indexPath, 'utf8');
  const quote = value => value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${quote(path.join(here, 'src', rel.slice(2)))}');`);
  src = src.replace(/^export\s+class\s+/mg, 'class ');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += `\nmodule.exports.__test = { searchActiveProducts, PRODUCT_SEARCH_DEADLINE_MS };`;
  const loaded = new Module(indexPath);
  loaded.filename = indexPath;
  loaded.paths = Module._nodeModulePaths(here);
  loaded._compile(src, indexPath);
  return loaded.exports;
}

const { __test: testApi } = loadWorker();

const kv = {
  get: async (key) => (key === 'zoho_access_token' ? 'offline-test-token' : null),
  put: async () => {},
  list: async () => ({ keys: [] }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
};
const env = {
  GMAIL_ADDON_API_KEY: 'test-key',
  CONVERSATION_KV: kv,
  PRICES_KV: kv,
  BOT_STORAGE: kv,
  BOT_METRICS: { writeDataPoint: () => {} },
};

// SKUs that exist in no embedded catalog, so the fail-soft daily-scan marker
// cannot classify them: only the live Woo read can.
const IDENTITY_ROWS = [
  { Product_Code: 'ZZ-STAGED-01', Product_Name: 'Staged product one', Product_Active: true },
  { Product_Code: 'ZZ-STAGED-02', Product_Name: 'Staged product two', Product_Active: true },
];
const WOO_ROWS = [{ WooProduct_Code: 'ZZ-STAGED-01', Stratus_Price: 1234, Inactive: false }];

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

// Resolve `body` after `delayMs` unless the request's AbortSignal fires first.
function delayed(delayMs, body, signal, record) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      record.completed = true;
      resolve(body);
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      record.aborted = true;
      reject(new DOMException('aborted', 'AbortError'));
    };
    if (signal?.aborted) onAbort();
    else signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function installFetch({ identityMs, wooMs, wooBody = json({ data: WOO_ROWS }) }) {
  const calls = { identity: { started: 0 }, woo: { started: 0 }, all: [] };
  global.fetch = async (url, options = {}) => {
    const target = String(url);
    calls.all.push({ url: target, method: options.method || 'GET', signal: options.signal });
    assert.ok(options.signal, `every live read must carry an AbortSignal: ${target}`);
    if (target.includes('/Products/search?')) {
      calls.identity.started = Date.now();
      calls.identity.signal = options.signal;
      return delayed(identityMs, json({ data: IDENTITY_ROWS }), options.signal, calls.identity);
    }
    if (target.includes('/WooProducts/search?')) {
      calls.woo.started = Date.now();
      calls.woo.signal = options.signal;
      return delayed(wooMs, wooBody, options.signal, calls.woo);
    }
    throw new Error(`unexpected URL ${target}`);
  };
  return calls;
}

const originalFetch = global.fetch;
let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}\n  ${error.stack || error.message}`);
    failed++;
  }
}

function classification(result) {
  return result.results.map((row) => [row.sku, row.source, row.availability]).sort();
}

(async () => {
  await test('staged latency: identity consumes most of the budget and Woo still classifies on its own budget', async () => {
    const deadlineMs = 200;
    const calls = installFetch({ identityMs: 150, wooMs: 130 });
    const started = Date.now();
    const result = await testApi.searchActiveProducts('ZZ-STAGED', env, { deadlineMs });
    const elapsed = Date.now() - started;

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.live, true);
    assert.deepStrictEqual(classification(result), [
      ['ZZ-STAGED-01', 'zoho', 'ecomm'],
      ['ZZ-STAGED-02', 'zoho', 'zoho_only'],
    ]);
    assert.strictEqual(calls.identity.completed, true);
    assert.strictEqual(calls.woo.completed, true, 'Woo read must be allowed to finish');
    assert.notStrictEqual(calls.woo.aborted, true, 'Woo read must not be aborted by the identity deadline');
    // The two reads run sequentially (Woo needs the identity SKUs) and each
    // had its own budget: total sits above one budget and below two.
    assert.ok(elapsed >= 250 && elapsed < deadlineMs * 2 + 150, `elapsed ${elapsed}ms`);
    assert.ok(calls.woo.started - calls.identity.started >= 140, 'Woo read starts only after identity resolves');
    // Independent controllers: aborting one budget can never cancel the other.
    assert.notStrictEqual(calls.identity.signal, calls.woo.signal, 'reads must not share one AbortSignal');
    assert.strictEqual(calls.all.length, 2);
    assert.ok(calls.all.every((call) => call.method === 'GET'));
  });

  await test('Woo exhausting its own budget leaves rows unknown (never ecomm, never zoho_only) and stays bounded', async () => {
    const deadlineMs = 120;
    const calls = installFetch({ identityMs: 10, wooMs: 5000 });
    const started = Date.now();
    const result = await testApi.searchActiveProducts('ZZ-STAGED', env, { deadlineMs });
    const elapsed = Date.now() - started;

    assert.strictEqual(result.live, true, 'identity succeeded, so the response is live');
    assert.deepStrictEqual(classification(result), [
      ['ZZ-STAGED-01', 'zoho', 'unknown'],
      ['ZZ-STAGED-02', 'zoho', 'unknown'],
    ]);
    assert.strictEqual(calls.woo.aborted, true, 'Woo read must be aborted at its own deadline');
    assert.strictEqual(calls.woo.signal.aborted, true);
    assert.ok(elapsed >= deadlineMs && elapsed < deadlineMs * 2 + 150, `elapsed ${elapsed}ms`);
  });

  await test('identity exhausting its budget falls back to the catalog without ever starting the Woo read', async () => {
    const deadlineMs = 60;
    const calls = installFetch({ identityMs: 5000, wooMs: 5 });
    const started = Date.now();
    const result = await testApi.searchActiveProducts('C9300-24P', env, { deadlineMs });
    const elapsed = Date.now() - started;

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.live, false);
    assert.ok(result.results.every((row) => row.source === 'catalog'));
    assert.strictEqual(calls.identity.aborted, true);
    assert.strictEqual(calls.woo.started, 0, 'no identity, no classification read');
    assert.ok(elapsed < deadlineMs + 150, `elapsed ${elapsed}ms`);
  });

  await test('a Woo read failure inside its budget also leaves unknown rather than guessing', async () => {
    installFetch({ identityMs: 5, wooMs: 5, wooBody: new Response('nope', { status: 500 }) });
    const result = await testApi.searchActiveProducts('ZZ-STAGED', env, { deadlineMs: 200 });
    assert.strictEqual(result.live, true);
    assert.ok(result.results.length === 2);
    assert.ok(result.results.every((row) => row.availability === 'unknown'), JSON.stringify(result.results));
  });

  await test('an exact post-selection re-read of one SKU classifies it with the same independent budget', async () => {
    const deadlineMs = 200;
    const calls = installFetch({ identityMs: 150, wooMs: 120 });
    global.fetch = ((inner) => async (url, options) => {
      // The exact re-read narrows identity to the single selected SKU.
      if (String(url).includes('/Products/search?')) {
        const response = await inner(url, options);
        const body = await response.json();
        return json({ data: body.data.filter((row) => row.Product_Code === 'ZZ-STAGED-01') });
      }
      return inner(url, options);
    })(global.fetch);
    const result = await testApi.searchActiveProducts('ZZ-STAGED-01', env, { deadlineMs });
    assert.strictEqual(result.live, true);
    assert.deepStrictEqual(classification(result), [['ZZ-STAGED-01', 'zoho', 'ecomm']]);
    assert.strictEqual(calls.woo.completed, true);
    assert.match(new URL(calls.all[1].url).searchParams.get('criteria'), /WooProduct_Code:equals:ZZ-STAGED-01/);
  });

  await test('the deadline option is capped so both budgets together stay under 2x PRODUCT_SEARCH_DEADLINE_MS', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const helper = source.slice(
      source.indexOf('async function searchActiveProducts'),
      source.indexOf('\n}', source.indexOf('async function searchActiveProducts')) + 2,
    );
    assert.match(helper, /Math\.min\(PRODUCT_SEARCH_DEADLINE_MS, Math\.floor\(Number\(deadlineMs\)\)\)/);
    assert.match(helper, /const availabilityController = new AbortController\(\);/);
    assert.match(helper, /availabilityController\.abort\('product_availability_deadline'\)/);
    assert.match(helper, /lookupActiveEcommSkus\(\[\.\.\.bySku\.keys\(\)\], env, \{ signal: availabilityController\.signal \}\)/);
    assert.doesNotMatch(helper, /Promise\.race\(\[availabilityRead, deadline\]\)/, 'Woo read must not race the identity deadline');
    assert.strictEqual(testApi.PRODUCT_SEARCH_DEADLINE_MS, 2500);
  });
})().finally(() => {
  global.fetch = originalFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
});
