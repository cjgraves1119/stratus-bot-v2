const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

function grab(name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start === -1) start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const body = source.indexOf('{', source.indexOf('(', start));
  let depth = 0;
  for (let i = body; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

function grabConst(name) {
  const start = source.indexOf(`const ${name} =`);
  assert.ok(start >= 0, `${name} not found`);
  const end = source.indexOf(';', start);
  return source.slice(start, end + 1);
}

function load() {
  const module = { exports: {} };
  const code = [
    grabConst('MERAKI_PRODUCT_SEEN_KEY'),
    grab('isMerakiProductRecord'),
    grab('selectNewMerakiProductNotifications'),
    grab('_escapeHtml'),
    grab('buildNewMerakiProductEmailHtml'),
    `let __send = async (...args) => { __calls.push(args); return {id:'sent'}; };`,
    `const __calls = [];`,
    `const sendDigestEmail = (...args) => __send(...args);`,
    grab('notifyNewMerakiProducts'),
    `module.exports={isMerakiProductRecord,selectNewMerakiProductNotifications,buildNewMerakiProductEmailHtml,notifyNewMerakiProducts,calls:__calls,setSend(fn){__send=fn;}};`,
  ].join('\n');
  new Function('module', code)(module);
  return module.exports;
}

function kvMock() {
  const values = new Map();
  return {
    values,
    async get(key, type) {
      const value = values.get(key);
      if (value == null) return null;
      return type === 'json' ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
  };
}

(async () => {
  const h = load();
  assert.equal(h.isMerakiProductRecord({ Product_Code: 'CW9174E-RTG', Product_Name: 'Cisco Wireless', Product_Active: true }), true);
  assert.equal(h.isMerakiProductRecord({ Product_Code: 'MR44-HW', Product_Name: 'Access Point', Product_Active: true }), true);
  assert.equal(h.isMerakiProductRecord({ Product_Code: 'ODD-NEW', Product_Name: 'Meraki special', Product_Active: true }), true);
  assert.equal(h.isMerakiProductRecord({ Product_Code: 'C9300-24P', Product_Name: 'Cisco Catalyst', Product_Active: true }), false);
  assert.equal(h.isMerakiProductRecord({ Product_Code: 'CW9174E-RTG', Product_Name: 'Cisco Wireless', Product_Active: false }), false);

  const recent = new Date(Date.now() - 2 * 86400000).toISOString();
  const old = new Date(Date.now() - 90 * 86400000).toISOString();
  const rows = [
    { sku: 'CW9174E-RTG', name: 'New AP', created_at: recent, list_price: 2495 },
    { sku: 'MR44-HW', name: 'Old AP', created_at: old, list_price: 995 },
  ];
  assert.deepStrictEqual(
    h.selectNewMerakiProductNotifications(rows, null).map((row) => row.sku),
    [],
    'bootstrap must establish a silent baseline regardless of product age',
  );
  assert.deepStrictEqual(
    h.selectNewMerakiProductNotifications(rows, { initialized: true, skus: ['CW9174E-RTG'] }).map((row) => row.sku),
    ['MR44-HW'],
    'after baseline, every genuinely unseen active product is eligible',
  );

  const html = h.buildNewMerakiProductEmailHtml([{
    sku: '<CW9174E>', name: '<script>alert(1)</script>', list_price: 2495,
    created_at: recent, ecomm_available: false,
  }]);
  assert.ok(!html.includes('<script>'));
  assert.match(html, /not detected — use Zoho review/);
  assert.match(html, /\$2,495\.00/);

  const kv = kvMock();
  const env = { CONVERSATION_KV: kv, SYSTEM_OWNER_EMAIL: 'owner@example.com' };
  const first = await h.notifyNewMerakiProducts(env, [rows[0]], new Set());
  assert.equal(first.sent, 0, 'first successful scan must establish a silent baseline');
  assert.equal(h.calls.length, 0);
  const second = await h.notifyNewMerakiProducts(env, rows, new Set());
  assert.equal(second.sent, 1);
  assert.equal(h.calls.length, 1, 'the same product must not email twice');
  assert.match(h.calls[0][2], /MR44-HW/);
  const third = await h.notifyNewMerakiProducts(env, rows, new Set());
  assert.equal(third.sent, 0);
  assert.equal(h.calls.length, 1, 'an already reported product must not email again');

  const retryKv = kvMock();
  await h.notifyNewMerakiProducts(
    { CONVERSATION_KV: retryKv, SYSTEM_OWNER_EMAIL: 'owner@example.com' },
    [rows[0]],
    new Set(),
  );
  h.setSend(async () => { throw new Error('gmail down'); });
  await assert.rejects(
    h.notifyNewMerakiProducts({ CONVERSATION_KV: retryKv, SYSTEM_OWNER_EMAIL: 'owner@example.com' }, rows, new Set()),
    /gmail down/,
  );
  const retryState = JSON.parse(retryKv.values.get('meraki_product_seen_v1'));
  assert.deepStrictEqual(retryState.skus, ['CW9174E-RTG'], 'failed email must not advance the dedupe baseline');

  console.log('PASS new Meraki product silent baseline, email, and durable dedupe');
})().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
