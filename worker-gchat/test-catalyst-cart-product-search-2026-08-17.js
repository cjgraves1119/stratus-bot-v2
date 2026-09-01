// Focused offline regression coverage for the editable-SKU Worker seams:
//   * both short and long Catalyst -M SKUs parse into the actual cart;
//   * C9300 + MT produces exact 1/3/5-year URLs;
//   * explicit bundle/license composition fails closed on a partial cart;
//   * authenticated product search is bounded, active-only, read-only, and stripped.

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
  src += `\nmodule.exports.__test = {
    parseMessage,
    buildQuoteResponse,
    validateExplicitMxMsQuoteComposition,
    buildOneshotIntake,
    normalizeProductSearchQuery,
    searchActiveProducts,
  };`;

  const loaded = new Module(indexPath);
  loaded.filename = indexPath;
  loaded.paths = Module._nodeModulePaths(here);
  loaded._compile(src, indexPath);
  return loaded.exports;
}

function createKv(initial = {}) {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, String(value)]));
  return {
    get: async (key, type) => {
      const value = values.get(key);
      if (value == null) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    put: async (key, value) => { values.set(key, String(value)); },
    list: async () => ({ keys: [...values.keys()].map(name => ({ name })) }),
    getWithMetadata: async (key, type) => ({
      value: await (async () => {
        const value = values.get(key);
        if (value == null) return null;
        return type === 'json' ? JSON.parse(value) : value;
      })(),
      metadata: null,
    }),
  };
}

const { __worker: worker, __test: testApi } = loadWorker();
const kv = createKv({ zoho_access_token: 'offline-test-token' });
const db = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ success: true }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
    run: async () => ({ success: true }),
    first: async () => null,
    all: async () => ({ results: [] }),
  }),
};
const env = {
  GMAIL_ADDON_API_KEY: 'test-key',
  CONVERSATION_KV: kv,
  PRICES_KV: kv,
  BOT_STORAGE: kv,
  ANALYTICS_DB: db,
  BOT_METRICS: { writeDataPoint: () => {} },
};
const ctx = { waitUntil: promise => { if (promise?.catch) promise.catch(() => {}); } };

async function callApi(pathname, body, apiKey = 'test-key') {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey != null) headers['X-API-Key'] = apiKey;
  const request = new Request(`https://offline.invalid${pathname}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const response = await worker.fetch(request, env, ctx);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function urlsFromBuild(parsed) {
  const built = testApi.buildQuoteResponse(parsed);
  const message = String(built?.message || built || '');
  return message.match(/https:\/\/stratusinfosystems\.com\/order\/\?[^\s)>\]]+/g) || [];
}

function itemsFromUrl(value) {
  const url = new URL(value);
  return {
    skus: (url.searchParams.get('item') || '').split(',').filter(Boolean),
    qtys: (url.searchParams.get('qty') || '').split(',').map(Number),
  };
}

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

const originalFetch = global.fetch;
let unexpectedNetwork = [];
global.fetch = async (url, options = {}) => {
  unexpectedNetwork.push({ url: String(url), method: options.method || 'GET' });
  throw new Error(`unexpected external call: ${url}`);
};

(async () => {
  await test('short and long Catalyst -M forms both enter parsed.items', () => {
    const short = testApi.parseMessage('quote 1 C9300-24P-M, 1 MT12, 1 MT10');
    const long = testApi.parseMessage('quote 1 C9300L-24P-4X-M, 1 MT12');
    assert.deepStrictEqual(short.items.map(item => item.baseSku), ['C9300-24P-M', 'MT12', 'MT10']);
    assert.deepStrictEqual(long.items.map(item => item.baseSku), ['C9300L-24P-4X-M', 'MT12']);
  });

  await test('/api/quote emits exact C9300 + MT all-term carts', async () => {
    unexpectedNetwork = [];
    const result = await callApi('/api/quote', {
      text: 'quote 1 C9300-24P-M, 1 MT12, 1 MT10',
      personId: 'catalyst-mt-regression',
    });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.handlerType, 'deterministic', JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.quoteUrls, [
      {
        label: '1-Year',
        url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-1Y,MT12-HW,LIC-MT-1Y,MT10-HW&qty=1,1,1,2,1',
      },
      {
        label: '3-Year',
        url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-3Y,MT12-HW,LIC-MT-3Y,MT10-HW&qty=1,1,1,2,1',
      },
      {
        label: '5-Year',
        url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-5Y,MT12-HW,LIC-MT-5Y,MT10-HW&qty=1,1,1,2,1',
      },
    ]);
    assert.deepStrictEqual(unexpectedNetwork, [], 'deterministic quote attempted an external call');
  });

  await test('/api/quote preserves multiline Add SKU quantities on the first request', async () => {
    unexpectedNetwork = [];
    for (const [suffix, text, expected] of [
      ['lf', '2 MX85\n1 MX75\nhardware only', [['MX85', 2], ['MX75', 1]]],
      ['cascade', '2 MX85\n1 MX75\n3 MX105\nhardware only', [['MX85', 2], ['MX75', 1], ['MX105', 3]]],
      ['crlf', '2 MX85\r\n1 MX75\r\nhardware only', [['MX85', 2], ['MX75', 1]]],
      ['suffix', 'MX85 x2\nMX75 x1\nhardware only', [['MX85', 2], ['MX75', 1]]],
    ]) {
      const result = await callApi('/api/quote', {
        text,
        personId: 'editable-sku-first-attempt-' + suffix,
      });
      assert.strictEqual(result.status, 200, JSON.stringify(result.body));
      assert.strictEqual(result.body.handlerType, 'deterministic', JSON.stringify(result.body));
      assert.deepStrictEqual(
        result.body.parsedItems.map(item => [item.sku, item.qty]),
        expected,
        JSON.stringify(result.body),
      );
      assert.strictEqual(result.body.quoteUrls.length, 1, JSON.stringify(result.body));
      const composition = itemsFromUrl(result.body.quoteUrls[0].url);
      assert.deepStrictEqual(
        composition.skus.map((sku, index) => [sku.replace(/-HW(?:-(?:NA|WW))?$/, ''), composition.qtys[index]]),
        expected,
      );
      assert.ok(!composition.skus.some(sku => sku.startsWith('LIC-')), JSON.stringify(composition));
    }
    assert.deepStrictEqual(unexpectedNetwork, [], 'first-attempt editor quote attempted an external call');
  });

  await test('/api/quote preserves multiline bundle quantities and paired licenses', async () => {
    unexpectedNetwork = [];
    const result = await callApi('/api/quote', {
      text: '2 MX85\n1 MX75',
      personId: 'editable-sku-bundle-first-attempt',
    });
    assert.strictEqual(result.status, 200, JSON.stringify(result.body));
    assert.deepStrictEqual(result.body.parsedItems.map(item => [item.sku, item.qty]), [
      ['MX85', 2],
      ['MX75', 1],
    ]);
    for (const option of result.body.quoteUrls) {
      const composition = itemsFromUrl(option.url);
      const rows = composition.skus.map((sku, index) => [sku, composition.qtys[index]]);
      assert.ok(rows.some(([sku, qty]) => /^MX85(?:-HW(?:-(?:NA|WW))?)?$/.test(sku) && qty === 2), JSON.stringify(rows));
      assert.ok(rows.some(([sku, qty]) => /^LIC-MX85-/.test(sku) && qty === 2), JSON.stringify(rows));
      assert.ok(rows.some(([sku, qty]) => /^MX75(?:-HW(?:-(?:NA|WW))?)?$/.test(sku) && qty === 1), JSON.stringify(rows));
      assert.ok(rows.some(([sku, qty]) => /^LIC-MX75-/.test(sku) && qty === 1), JSON.stringify(rows));
    }
    assert.deepStrictEqual(unexpectedNetwork, [], 'bundle regression attempted an external call');
  });

  await test('generalized bundle invariant blocks a partial Catalyst + MT cart without requiring explicit scope words', () => {
    const raw = 'quote 1 C9300-24P-M and 1 MT12 3yr';
    const parsed = testApi.parseMessage(raw);
    const partial = [{
      label: '3-Year',
      url: 'https://stratusinfosystems.com/order/?item=MT12-HW,LIC-MT-3Y&qty=1,1',
    }];
    const blocked = testApi.validateExplicitMxMsQuoteComposition(raw, parsed, partial);
    assert.strictEqual(blocked.ok, false, JSON.stringify(blocked));
    assert.ok(blocked.failures.includes('C9300-24P-M quantity is 0; expected 1'), JSON.stringify(blocked));

    const complete = [{
      label: '3-Year',
      url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-3Y,MT12-HW,LIC-MT-3Y&qty=1,1,1,1',
    }];
    assert.strictEqual(testApi.validateExplicitMxMsQuoteComposition(raw, parsed, complete).ok, true);
  });

  await test('a valid raw SKU omitted by the parser is still protected while invalid suggestions remain partial-quote eligible', () => {
    const raw = 'quote 1 C9300-24P-M and 1 MT12';
    const parsedWithoutCatalyst = testApi.parseMessage('quote 1 MT12');
    const partial = [{
      label: '1-Year',
      url: 'https://stratusinfosystems.com/order/?item=MT12-HW,LIC-MT-1Y&qty=1,1',
    }];
    const blocked = testApi.validateExplicitMxMsQuoteComposition(raw, parsedWithoutCatalyst, partial, [
      { sku: 'C9300-24P-M', qty: 1, validation: { valid: true } },
      { sku: 'MX999', qty: 1, validation: { valid: false } },
    ]);
    assert.strictEqual(blocked.ok, false, JSON.stringify(blocked));
    assert.ok(blocked.failures.includes('C9300-24P-M hardware is missing'), JSON.stringify(blocked));

    const completeMtUrls = urlsFromBuild(parsedWithoutCatalyst).map((url, index) => ({ label: String(index), url }));
    const invalidOnly = testApi.validateExplicitMxMsQuoteComposition('quote 1 MT12 and 1 MX999', parsedWithoutCatalyst, completeMtUrls, [
      { sku: 'MX999', qty: 1, validation: { valid: false } },
    ]);
    assert.strictEqual(invalidOnly.ok, true, JSON.stringify(invalidOnly));
  });

  await test('generalized invariant preserves license-only and hardware-only flows', () => {
    const licenseText = '3-year licenses for 1 C9300-24P-M and 1 MT12';
    const licenseParsed = testApi.parseMessage(licenseText);
    const licenseUrls = urlsFromBuild(licenseParsed).map((url, index) => ({ label: String(index), url }));
    assert.deepStrictEqual(licenseUrls.map(entry => itemsFromUrl(entry.url).skus), [
      ['LIC-C9300-24E-3Y', 'LIC-MT-3Y'],
    ]);
    assert.strictEqual(testApi.validateExplicitMxMsQuoteComposition(licenseText, licenseParsed, licenseUrls).ok, true);

    const leakedHardware = [{
      label: '3-Year',
      url: 'https://stratusinfosystems.com/order/?item=C9300-24P-M,LIC-C9300-24E-3Y,LIC-MT-3Y&qty=1,1,1',
    }];
    const blocked = testApi.validateExplicitMxMsQuoteComposition(licenseText, licenseParsed, leakedHardware);
    assert.strictEqual(blocked.ok, false);
    assert.ok(blocked.failures.includes('license-only URL contains C9300-24P-M hardware'));

    const hardwareText = 'hardware only for 1 C9300-24P-M and 1 MT12';
    const hardwareParsed = testApi.parseMessage(hardwareText);
    const hardwareUrls = urlsFromBuild(hardwareParsed);
    assert.deepStrictEqual(hardwareUrls.map(itemsFromUrl).map(row => row.skus), [['C9300-24P-M', 'MT12-HW']]);
    assert.strictEqual(testApi.validateExplicitMxMsQuoteComposition(hardwareText, hardwareParsed, hardwareUrls).ok, true);
  });

  await test('real Gmail intake selects the exact customer request and excludes historical MX84 subject/chatter', async () => {
    let extracted = 0;
    const result = await testApi.buildOneshotIntake({
      source: 'ext-email-ecomm-intake',
      subject: 'Legacy MX84 replacement planning',
      body_text: 'Flattened history mentions MX84, MX105, and MX85.',
      order_urls: [],
      participants: [{ email: 'jody@example.com', name: 'Jody' }],
      messages: [
        {
          index: 0,
          from_email: 'jody@example.com',
          body: 'Looking to get a quote for 2 - MX105 and 2 - MX85 with Enterprise licensing and warm spare failover.',
        },
        { index: 1, from_email: 'rep@stratusinfosystems.com', body: 'I am working on the quote.' },
        {
          index: 2,
          from_email: 'jody@example.com',
          body: 'We may order soon. This replaces old MX84 appliances at other locations.',
        },
      ],
    }, {}, 'rep@stratusinfosystems.com', async () => {
      extracted++;
      return {};
    });
    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.deepStrictEqual(result.lines.map((line) => [line.sku, line.qty]), [
      ['MX105', 2],
      ['MX85', 2],
    ]);
    assert.strictEqual(result.selected_message_index, 0);
    assert.strictEqual(result.intent.license_tier, 'ENT');
    assert.strictEqual(result.intent.ha_requested, true);
    assert.strictEqual(extracted, 0, 'literal SKU intake must not call the extractor');
  });

  await test('real Gmail parser excludes only an explicitly excluded historical SKU', async () => {
    let extracted = 0;
    const exact = await testApi.buildOneshotIntake({
      source: 'ext-email-ecomm-intake',
      body_text: '2x MX105 + 2x MX85, ENT licensing, HA; exclude historical MX84.',
      participants: [{ email: 'synthetic@example.com', name: 'Synthetic' }],
    }, {}, 'rep@stratusinfosystems.com', async () => {
      extracted += 1;
      return {};
    });
    assert.strictEqual(exact.success, true, JSON.stringify(exact));
    assert.deepStrictEqual(exact.lines.map((line) => [line.sku, line.qty]), [
      ['MX105', 2],
      ['MX85', 2],
    ]);
    assert.strictEqual(exact.intent.license_tier, 'ENT');
    assert.strictEqual(exact.intent.ha_requested, true);
    assert.strictEqual(extracted, 0, 'literal SKU intake must not call the extractor');

    for (const body_text of ['Quote 2 MX84', 'Quote 2 MX84, no license']) {
      const control = await testApi.buildOneshotIntake({
        source: 'ext-email-ecomm-intake',
        body_text,
      }, {}, 'rep@stratusinfosystems.com', async () => {
        extracted += 1;
        return {};
      });
      assert.strictEqual(control.success, true, JSON.stringify(control));
      assert.deepStrictEqual(control.lines.map((line) => [line.sku, line.qty]), [['MX84', 2]], body_text);
    }
    const exclusionOnly = await testApi.buildOneshotIntake({
      source: 'ext-email-ecomm-intake',
      body_text: 'Exclude historical MX84.',
    }, {}, 'rep@stratusinfosystems.com', async () => {
      extracted += 1;
      return { requested_products: [{ family: 'MX84', qty: 1 }] };
    });
    assert.strictEqual(exclusionOnly.success, true, JSON.stringify(exclusionOnly));
    assert.deepStrictEqual(exclusionOnly.lines, []);
    assert.strictEqual(exclusionOnly.used_llm, false);
    assert.strictEqual(extracted, 0, 'control literal SKU intake must not call the extractor');
  });

  await test('/api/product-search inherits API auth and rejects unbounded/unsafe queries', async () => {
    assert.strictEqual((await callApi('/api/product-search', { query: 'C9300' }, null)).status, 401);
    assert.strictEqual((await callApi('/api/product-search', { query: 'C9300' }, 'wrong-key')).status, 401);
    assert.strictEqual((await callApi('/api/product-search', { query: 'x' })).status, 400);
    assert.strictEqual((await callApi('/api/product-search', { query: 'x'.repeat(81) })).status, 400);
    assert.strictEqual((await callApi('/api/product-search', { query: 'MX85):or:(' })).status, 400);
  });

  await test('/api/product-search live rows are active-only, max 10, and stripped', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', body: options.body });
      if (String(url).startsWith('https://www.zohoapis.com/crm/v8/WooProducts/search?')) {
        return new Response(JSON.stringify({
          data: Array.from({ length: 5 }, (_, index) => ({
            WooProduct_Code: `C9300-LIVE-${String(index * 2).padStart(2, '0')}`,
            Stratus_Price: 900,
            Inactive: false,
          })),
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      assert.ok(String(url).startsWith('https://www.zohoapis.com/crm/v8/Products/search?'));
      const active = Array.from({ length: 12 }, (_, index) => ({
        id: String(2570562000400000000n + BigInt(index)),
        Product_Code: `C9300-LIVE-${String(index).padStart(2, '0')}`,
        Product_Name: `C9300 live product ${index}`,
        Product_Active: true,
        Unit_Price: 999999,
        raw_secret: 'must-not-leak',
      }));
      return new Response(JSON.stringify({
        data: [...active, {
          id: '2570562000499999999',
          Product_Code: 'C9300-INACTIVE',
          Product_Name: 'inactive product',
          Product_Active: false,
          Unit_Price: 123,
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };

    const result = await callApi('/api/product-search', { query: 'C9300' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.query, 'C9300');
    assert.strictEqual(result.body.live, true);
    assert.strictEqual(result.body.results.length, 10);
    for (const row of result.body.results) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['active', 'availability', 'name', 'sku', 'source']);
      assert.strictEqual(row.active, true);
      assert.strictEqual(row.source, 'zoho');
      const sequence = Number(row.sku.split('-').at(-1));
      assert.strictEqual(row.availability, sequence % 2 === 0 ? 'ecomm' : 'zoho_only');
      assert.notStrictEqual(row.sku, 'C9300-INACTIVE');
    }
    const serialized = JSON.stringify(result.body);
    assert.ok(!/Unit_Price|raw_secret|2570562000/.test(serialized), serialized);
    assert.strictEqual(calls.length, 2);
    assert.ok(calls.every(call => call.method === 'GET' && call.body == null), JSON.stringify(calls));
    const liveUrl = new URL(calls.find((call) => call.url.includes('/Products/search?')).url);
    assert.strictEqual(
      liveUrl.searchParams.get('criteria'),
      '((Product_Code:starts_with:C9300)or(Product_Name:equals:C9300))',
    );
    const wooUrl = new URL(calls.find((call) => call.url.includes('/WooProducts/search?')).url);
    assert.match(wooUrl.searchParams.get('criteria'), /WooProduct_Code:equals:C9300-LIVE-00/);
  });

  await test('/api/product-search does not treat a cached price as eCommerce proof', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push(String(url));
      if (String(url).includes('/Products/search?')) {
        return new Response(JSON.stringify({ data: [{
          Product_Code: 'CW9174E-RTG', Product_Name: 'Cisco Wireless 9174E', Product_Active: true,
        }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (String(url).includes('/WooProducts/search?')) {
        return new Response(null, { status: 204 });
      }
      throw new Error(`unexpected URL ${url}`);
    };
    const result = await testApi.searchActiveProducts('CW9174E-RTG', env);
    assert.strictEqual(result.live, true);
    assert.deepStrictEqual(result.results.map((row) => ({ sku: row.sku, availability: row.availability })), [
      { sku: 'CW9174E-RTG', availability: 'zoho_only' },
    ]);
    assert.strictEqual(calls.length, 2);
  });

  await test('/api/product-search fails over to stripped active catalog rows', async () => {
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET' });
      throw new Error('simulated read outage');
    };
    const result = await callApi('/api/product-search', { query: 'C9300-24P' });
    assert.strictEqual(result.status, 200);
    assert.strictEqual(result.body.ok, true);
    assert.strictEqual(result.body.live, false);
    assert.ok(result.body.results.some(row => row.sku === 'C9300-24P-M'), JSON.stringify(result.body));
    assert.ok(result.body.results.length <= 10);
    for (const row of result.body.results) {
      assert.deepStrictEqual(Object.keys(row).sort(), ['active', 'availability', 'name', 'sku', 'source']);
      assert.strictEqual(row.active, true);
      assert.strictEqual(row.source, 'catalog');
      assert.strictEqual(row.availability, 'ecomm');
    }
    assert.strictEqual(calls.length, 1);
    assert.ok(calls.every(call => call.method === 'GET'), JSON.stringify(calls));
  });

  await test('/api/product-search bounds the live read, aborts it, and falls back to catalog', async () => {
    const calls = [];
    let observedAbort = false;
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), method: options.method || 'GET', signal: options.signal });
      assert.ok(options.signal, 'bounded live product read must carry an AbortSignal');
      return await new Promise((resolve, reject) => {
        const onAbort = () => {
          observedAbort = true;
          reject(new DOMException('aborted', 'AbortError'));
        };
        if (options.signal.aborted) onAbort();
        else options.signal.addEventListener('abort', onAbort, { once: true });
      });
    };

    const started = Date.now();
    const result = await testApi.searchActiveProducts('C9300-24P', env, { deadlineMs: 20 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 500, `deadline fallback took ${elapsed}ms`);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.live, false);
    assert.ok(result.results.some(row => row.sku === 'C9300-24P-M'), JSON.stringify(result));
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].method, 'GET');
    assert.strictEqual(calls[0].signal.aborted, true);
    assert.strictEqual(observedAbort, true);
  });

  await test('/api/product-search never waits on an unbounded KV price refresh', async () => {
    let kvReads = 0;
    const hangingKv = {
      get: async () => {
        kvReads += 1;
        return await new Promise(() => {});
      },
    };
    global.fetch = async (url) => String(url).includes('/WooProducts/search?')
      ? new Response(null, { status: 204 })
      : new Response(JSON.stringify({
        data: [{ Product_Code: 'C9300-24P-M', Product_Name: 'Catalyst 9300', Product_Active: true }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const started = Date.now();
    const result = await testApi.searchActiveProducts('C9300-24P', {
      ...env,
      PRICES_KV: hangingKv,
    }, { deadlineMs: 20 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 150, `product search waited ${elapsed}ms on KV`);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.live, true);
    assert.strictEqual(kvReads, 0, 'interactive product search must not enter an unbounded KV preflight');
  });

  await test('product-search implementation has no write/tool path', () => {
    const source = fs.readFileSync(indexPath, 'utf8');
    const helper = source.slice(source.indexOf('async function searchActiveProducts'), source.indexOf('\n}', source.indexOf('async function searchActiveProducts')) + 2);
    const route = source.slice(source.indexOf("case '/api/product-search'"), source.indexOf("case '/api/analyze-email'"));
    assert.ok(helper.includes("zohoApiCall(\n      'GET'"), helper);
    assert.ok(!/executeToolCall|POST|PUT|PATCH|DELETE/.test(helper + route), helper + route);
  });
})().finally(() => {
  global.fetch = originalFetch;
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
});
