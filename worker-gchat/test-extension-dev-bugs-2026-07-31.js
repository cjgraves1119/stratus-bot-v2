// Focused regressions for personal extension error_reports #9 and #10.
// No network, CRM, or Cloudflare resources are used.
//
// Run: node worker-gchat/test-extension-dev-bugs-2026-07-31.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function loadWorkerModule() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  for (const pair of [
    ['pricesData', 'src/data/prices.json'],
    ['catalogData', 'src/data/auto-catalog.json'],
    ['specsData', 'src/data/specs.json'],
    ['accessoriesData', 'src/data/accessories.json'],
    ['voiceSkillData', 'src/email-reply-voice-skill.json'],
  ]) {
    const imp = pair[0];
    const file = pair[1];
    src = src.replace(
      new RegExp('^import ' + imp + " from '[^']+';?$", 'm'),
      'const ' + imp + ' = require(' + JSON.stringify(path.join(here, file)) + ');'
    );
  }
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += '\nmodule.exports.__test = { getDashboardVisionPrompt, normalizeDashboardMxEdition, dashboardRowsNeedMxEdition, dashboardSkuDisposition, buildDashboardRenewalQuote, parseMxEditionCorrection, handleMxEditionCorrection, resolveOrderLinkItems, buildStratusUrl, buildLabeledOrderUrlsAtomically, swapEolUrlsInText, extractEolWarningsFromMessage, isComplexityExhaustionReply, buildComplexityRecovery, normalizeComplexityReply };';
  const tmp = path.join(os.tmpdir(), 'stratus-extension-dev-bugs-' + process.pid + '.cjs');
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const loaded = loadWorkerModule();
const worker = loaded.__worker;
const M = loaded.__test;

const store = new Map();
const kv = {
  get: async (key, type) => {
    const value = store.get(key);
    if (value == null) return null;
    return type === 'json' || type === undefined
      ? (typeof value === 'string' ? JSON.parse(value) : value)
      : value;
  },
  put: async (key, value) => { store.set(key, value); },
  list: async () => ({ keys: [] }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
};
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
  PRICES_KV: { get: async () => null, put: async () => {} },
  ANALYTICS_DB: db,
  BOT_METRICS: { writeDataPoint: () => {} },
  BOT_STORAGE: kv,
};
const ctx = { waitUntil: (promise) => { try { if (promise && promise.catch) promise.catch(() => {}); } catch (_) {} } };

async function callQuote(text, priorQuoteText) {
  const req = new Request('https://example.test/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, priorQuoteText, personId: 'extension-dev-bug-test' }),
  });
  return (await worker.fetch(req, env, ctx)).json();
}

async function callDashboard(visionResponse) {
  const dashboardEnv = {
    ...env,
    AI: { run: async () => ({ response: visionResponse }) },
  };
  const req = new Request('https://example.test/api/parse-dashboard', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ imageBase64: 'aGVsbG8=', mediaType: 'image/png' }),
  });
  return (await worker.fetch(req, dashboardEnv, ctx)).json();
}

function dashboardFixture(rows, mxEdition) {
  return [
    'LICENSE_DASHBOARD_PARSE_V1',
    '---',
    ...rows.map(({ sku, qty }) => `SKU: ${sku} | LIMIT: ${qty} | ACTIVE: ${qty}`),
    '---',
    'EXPIRATION: 2027-07-31',
    `MX_EDITION: ${mxEdition}`,
    'MR_EDITION: Enterprise',
  ].join('\n');
}

let passed = 0;
let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('  ✅ ' + name);
  } catch (err) {
    failed++;
    console.log('  ❌ ' + name + '\n     ' + err.message);
  }
}

const threeTermPrior = [
  '1-Year: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-1Y,MR44-HW,LIC-ENT-1YR&qty=2,2,4,4',
  '3-Year: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y,MR44-HW,LIC-ENT-3YR&qty=2,2,4,4',
  '5-Year: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-5Y,MR44-HW,LIC-ENT-5YR&qty=2,2,4,4',
].join('\n');

(async () => {
  console.log('Dashboard MX edition ambiguity');
  await test('vision contract includes Enterprise and unknown and forbids edition inference', () => {
    const prompt = M.getDashboardVisionPrompt();
    assert.ok(/MX_EDITION: <Advanced Security \| Enterprise \| Secure SD-WAN Plus \| unknown>/.test(prompt), prompt);
    assert.ok(/Never infer it from the models or silently default it/.test(prompt), prompt);
  });
  await test('missing, unknown, and conflicting edition values all block with zero links', () => {
    for (const edition of ['', 'none', 'unknown', 'Advanced Security / Enterprise', 'maybe Enterprise', 'Enterprise or unknown']) {
      const result = M.buildDashboardRenewalQuote([{ sku: 'MX85', qty: 1 }], { mxEdition: edition });
      assert.strictEqual(result.needsClarification, true, 'did not clarify for ' + JSON.stringify(edition));
      assert.ok(!/stratusinfosystems\.com\/order\//.test(result.message), 'link leaked for ' + JSON.stringify(edition));
      assert.strictEqual(result.termGroups, null);
    }
  });
  await test('Enterprise screenshot metadata generates ENT, never SEC', () => {
    const result = M.buildDashboardRenewalQuote([{ sku: 'MX85', qty: 2 }], { mxEdition: 'Enterprise' });
    assert.ok(/LIC-MX85-ENT-3Y/.test(result.message), result.message);
    assert.ok(!/LIC-MX85-SEC-/.test(result.message), result.message);
  });
  await test('zero-count MX does not block an MR-only renewal', () => {
    const result = M.buildDashboardRenewalQuote(
      [{ sku: 'MX85', qty: 0 }, { sku: 'MR-ENT', qty: 3 }],
      { mxEdition: '' }
    );
    assert.ok(result && !result.needsClarification, JSON.stringify(result));
    assert.ok(/LIC-ENT-3YR&qty=3/.test(result.message), result.message);
  });
  await test('editionless vMX plus SDW fails closed instead of silently becoming ENT', () => {
    const result = M.buildDashboardRenewalQuote(
      [{ sku: 'LIC-VMX-S-3YR', qty: 1 }],
      { mxEdition: 'SDW' }
    );
    assert.strictEqual(result.needsClarification, true, JSON.stringify(result));
    assert.ok(/do not have a confirmed SDW catalog equivalent/.test(result.message), result.message);
    assert.ok(!/stratusinfosystems\.com\/order\//.test(result.message), result.message);
  });
  await test('vMX-only unknown dashboard retains its row and resumes without a clarification loop', async () => {
    const parsed = await callDashboard(dashboardFixture([
      { sku: 'LIC-VMX-S-3YR', qty: 1 },
    ], 'unknown'));
    assert.strictEqual(parsed.needsClarification, true, JSON.stringify(parsed));
    assert.deepStrictEqual(parsed.quoteUrls, []);
    assert.deepStrictEqual(parsed.parsedItems, [{ sku: 'LIC-VMX-S-3YR', qty: 1 }]);
    const prior = [
      '[Dashboard quote blocked pending MX edition]',
      'Detected rows:',
      ...parsed.parsedItems.map(row => `${row.sku} x ${row.qty}`),
    ].join('\n');
    const resumed = await callQuote('Enterprise', prior);
    assert.strictEqual(resumed.handlerType, 'mx-edition-correction', JSON.stringify(resumed));
    assert.ok(/LIC-VMX-S-ENT-3Y/.test(JSON.stringify(resumed.quoteUrls)), JSON.stringify(resumed));
    assert.ok((resumed.eolWarnings || []).some(w => /vMX licenses now require an edition/i.test(w)), JSON.stringify(resumed));
  });
  await test('clarification retains transformable vMX and Insight rows but filters unsupported subscription rows', async () => {
    const rows = [
      { sku: 'MX85', qty: 1 },
      { sku: 'LIC-VMX-S-3YR', qty: 1 },
      { sku: 'LIC-MI-M-3YR', qty: 1 },
      { sku: 'LIC-MX84-SEC-3YR', qty: 2 },
      { sku: 'LIC-MR-E', qty: 5 },
    ];
    const parsed = await callDashboard(dashboardFixture(rows, 'unknown'));
    assert.strictEqual(parsed.needsClarification, true, JSON.stringify(parsed));
    assert.deepStrictEqual(parsed.parsedItems.map(row => row.sku), [
      'MX85', 'LIC-VMX-S-3YR', 'LIC-MI-M-3YR', 'LIC-MX84-SEC-3YR',
    ]);
    const prior = [
      '[Dashboard quote blocked pending MX edition]',
      'Detected rows:',
      ...parsed.parsedItems.map(row => `${row.sku} x ${row.qty}`),
    ].join('\n');
    const resumed = await callQuote('ENT', prior);
    const payload = JSON.stringify(resumed);
    assert.strictEqual(resumed.handlerType, 'mx-edition-correction', payload);
    assert.ok(/LIC-VMX-S-ENT-3Y/.test(payload), payload);
    assert.ok(/LIC-MX84-SDW-3Y/.test(payload), payload);
    assert.ok(!/LIC-MI-M-3YR/.test(JSON.stringify(resumed.quoteUrls)), payload);
    assert.ok((resumed.eolWarnings || []).some(w => /Meraki Insight is retired/i.test(w)), payload);
  });
  await test('known-edition dashboard treats intentional vMX and Insight transforms as represented', async () => {
    const parsed = await callDashboard(dashboardFixture([
      { sku: 'LIC-VMX-S-3YR', qty: 1 },
      { sku: 'LIC-MI-M-3YR', qty: 1 },
      { sku: 'LIC-MX84-SEC-3YR', qty: 2 },
      { sku: 'LIC-MR-E', qty: 5 },
    ], 'Advanced Security'));
    const payload = JSON.stringify(parsed);
    assert.ok(/LIC-VMX-S-SEC-3Y/.test(payload), payload);
    assert.ok(/LIC-MX84-SDW-3Y/.test(payload), payload);
    assert.deepStrictEqual(parsed.dropFlags, [], payload);
    assert.deepStrictEqual(parsed.parsedItems.map(row => row.sku), [
      'LIC-VMX-S-3YR', 'LIC-MI-M-3YR', 'LIC-MX84-SEC-3YR',
    ]);
  });

  console.log('Deterministic SEC to ENT correction');
  await test('all terms are corrected atomically while labels, quantities, and unrelated MR licenses survive', () => {
    const result = M.handleMxEditionCorrection('change SEC to ENT', threeTermPrior);
    assert.strictEqual(result.handled, true);
    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.strictEqual(result.quoteUrls.length, 3);
    const urls = result.quoteUrls.map((item) => item.url).join('\n');
    assert.ok(/LIC-MX85-ENT-1Y/.test(urls) && /LIC-MX85-ENT-3Y/.test(urls) && /LIC-MX85-ENT-5Y/.test(urls), urls);
    assert.ok(!/LIC-MX85-SEC-/.test(urls), urls);
    assert.ok(/LIC-ENT-3YR/.test(urls), 'generic MR enterprise license was altered');
    assert.ok(/qty=2,2,4,4/.test(urls), 'quantities changed: ' + urls);
    assert.deepStrictEqual(result.quoteUrls.map((item) => item.label), ['1-Year', '3-Year', '5-Year']);
    assert.ok(/item=MX85,/.test(urls) && !/MX85-HW/.test(urls), 'inactive MX85-HW survived correction: ' + urls);
    assert.ok(/MR44-HW/.test(urls), 'non-MX/MS hardware spelling changed: ' + urls);
  });
  await test('Z4 and Z4C SEC lines follow the same explicit ENT correction atomically', () => {
    const prior = '3-Year: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y,Z4-HW,LIC-Z4-SEC-3Y,Z4C-HW,LIC-Z4C-SEC-3Y&qty=2,2,1,1,3,3';
    const result = M.handleMxEditionCorrection('change SEC to ENT', prior);
    const payload = JSON.stringify(result);
    assert.strictEqual(result.success, true, payload);
    assert.ok(/LIC-MX85-ENT-3Y/.test(payload), payload);
    assert.ok(/LIC-Z4-ENT-3Y/.test(payload), payload);
    assert.ok(/LIC-Z4C-ENT-3Y/.test(payload), payload);
    assert.ok(!/-SEC-/.test(JSON.stringify(result.quoteUrls)), payload);
    assert.ok(/qty=2,2,1,1,3,3/.test(payload), payload);
  });
  await test('Z4 SDW correction fails closed instead of silently mapping back to SEC', () => {
    const prior = '3-Year: https://stratusinfosystems.com/order/?item=Z4-HW,LIC-Z4-SEC-3Y&qty=1,1';
    const result = M.handleMxEditionCorrection('change SEC to SDW', prior);
    assert.strictEqual(result.success, false, JSON.stringify(result));
    assert.strictEqual(result.error, 'target_edition_unavailable');
    assert.deepStrictEqual(result.quoteUrls, []);
  });
  await test('mismatched prior URL quantities fail closed instead of resetting to one', () => {
    const prior = 'Quote: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y&qty=5';
    const result = M.handleMxEditionCorrection('change SEC to ENT', prior);
    assert.strictEqual(result.success, false, JSON.stringify(result));
    assert.strictEqual(result.error, 'prior_quote_invalid');
    assert.deepStrictEqual(result.quoteUrls, []);
    assert.ok(/mismatched or invalid quantities/i.test(result.message), result.message);
  });
  await test('actually Enterprise resumes a blocked dashboard without ever creating SEC links', () => {
    const prior = [
      '[Dashboard quote blocked pending MX edition]',
      'Detected rows:',
      'MX85 x 1',
      'MR-ENT x 2',
      'Which MX license edition is shown?',
    ].join('\n');
    const result = M.handleMxEditionCorrection('actually Enterprise', prior);
    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.strictEqual(result.quoteUrls.length, 3);
    const urls = JSON.stringify(result.quoteUrls);
    assert.ok(/LIC-MX85-ENT-3Y/.test(urls), urls);
    assert.ok(!/LIC-MX85-SEC-/.test(urls), urls);
  });
  await test('blocked-dashboard resume derives labels from each rendered term', () => {
    const prior = [
      '[Dashboard quote blocked pending MX edition]',
      'Detected rows:',
      'MX70 x 1',
    ].join('\n');
    const result = M.handleMxEditionCorrection('ENT', prior);
    assert.strictEqual(result.success, true, JSON.stringify(result));
    assert.strictEqual(result.quoteUrls.length, 1, JSON.stringify(result.quoteUrls));
    assert.ok(/3-Year/.test(result.quoteUrls[0].label) && !/1-Year/.test(result.quoteUrls[0].label), result.quoteUrls[0].label);
    assert.ok(/LIC-MX70-ENT-3YR/.test(result.quoteUrls[0].url), result.quoteUrls[0].url);
  });
  await test('missing target sibling fails the whole correction with zero URLs', () => {
    const prior = [
      '1-Year: https://stratusinfosystems.com/order/?item=LIC-MX70-SEC-1YR&qty=1',
      '3-Year: https://stratusinfosystems.com/order/?item=LIC-MX70-SEC-3YR&qty=1',
      '5-Year: https://stratusinfosystems.com/order/?item=LIC-MX70-SEC-5YR&qty=1',
    ].join('\n');
    const result = M.handleMxEditionCorrection('change SEC to ENT', prior);
    assert.strictEqual(result.success, false);
    assert.strictEqual(result.error, 'target_edition_unavailable');
    assert.deepStrictEqual(result.quoteUrls, []);
    assert.ok(/fail-closed/i.test(result.message), result.message);
  });
  await test('/api/quote intercepts SEC to ENT before any model path', async () => {
    const result = await callQuote('correct SEC to ENT', threeTermPrior);
    assert.strictEqual(result.handlerType, 'mx-edition-correction', JSON.stringify(result));
    assert.strictEqual(result.correctedEdition, 'ENT');
    assert.strictEqual(result.quoteUrls.length, 3);
    assert.ok(!/LIC-MX85-SEC-/.test(JSON.stringify(result.quoteUrls)));
  });

  console.log('Active non-HW order-link resolution');
  await test('MX/MS remove only the literal HW token and preserve geography; other families are unchanged', () => {
    const result = M.resolveOrderLinkItems([
      { sku: 'MX85-HW', qty: 1 },
      { sku: 'MS130-24P-HW', qty: 2 },
      { sku: 'MX68CW-HW-NA', qty: 3 },
      { sku: 'MR44-HW', qty: 4 },
    ]);
    assert.strictEqual(result.ok, true, JSON.stringify(result));
    assert.deepStrictEqual(result.items.map((item) => item.sku), ['MX85', 'MS130-24P', 'MX68CW-NA', 'MR44-HW']);
  });
  await test('one missing non-HW equivalent blocks the entire cart', () => {
    const result = M.resolveOrderLinkItems([
      { sku: 'MX85-HW', qty: 1 },
      { sku: 'MX67C-HW-WW', qty: 1 },
    ]);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'order_sku_unavailable');
    assert.deepStrictEqual(result.items, []);
    assert.ok(result.blocked.some((item) => item.candidate === 'MX67C-WW'));
  });
  await test('related labeled carts publish atomically when a later cart is unavailable', () => {
    assert.throws(() => M.buildLabeledOrderUrlsAtomically([
      { label: 'Renewal', items: [{ sku: 'LIC-MX85-SEC-3Y', qty: 1 }] },
      { label: 'Upgrade', items: [{ sku: 'MX67C-HW-WW', qty: 1 }] },
    ]), (err) => err && err.code === 'order_sku_unavailable' && err.details.blocked[0].candidate === 'MX67C-WW');
    const urls = M.buildLabeledOrderUrlsAtomically([
      { label: 'Renewal', items: [{ sku: 'LIC-MX85-SEC-3Y', qty: 1 }] },
      { label: 'Upgrade', items: [{ sku: 'MX85-HW', qty: 1 }] },
    ]);
    assert.deepStrictEqual(urls.map(row => row.label), ['Renewal', 'Upgrade']);
    assert.ok(!/-HW/.test(JSON.stringify(urls)), JSON.stringify(urls));
  });
  await test('central URL builder emits non-HW MX/MS order SKUs', () => {
    const url = M.buildStratusUrl([
      { sku: 'MX85-HW', qty: 1 },
      { sku: 'LIC-MX85-SEC-3Y', qty: 1 },
      { sku: 'MS130-24P-HW', qty: 2 },
    ]);
    assert.ok(/item=MX85,LIC-MX85-SEC-3Y,MS130-24P&qty=1,1,2/.test(url), url);
    assert.ok(!/-HW/.test(url), url);
  });
  await test('model-composed URL sanitizer removes an unresolvable inactive link', () => {
    const sanitized = M.swapEolUrlsInText(
      'Quote: https://stratusinfosystems.com/order/?item=MX67C-HW-WW&qty=1'
    );
    assert.ok(/order link removed/.test(sanitized), sanitized);
    assert.ok(!/MX67C-HW-WW/.test(sanitized), sanitized);
  });
  await test('/api/quote returns typed recovery for an unavailable pasted order SKU', async () => {
    const result = await callQuote('https://stratusinfosystems.com/order/?item=MX67C-HW-WW&qty=1');
    assert.strictEqual(result.errorCode, 'order_sku_unavailable', JSON.stringify(result));
    assert.deepStrictEqual(result.quoteUrls, []);
    assert.strictEqual(result.recovery.write_state, 'none');
    assert.ok(!/MX67C-HW-WW/.test(JSON.stringify(result.quoteUrls)));
  });

  console.log('Complexity exhaustion recovery');
  await test('both historical generic dead ends are recognized exactly', () => {
    assert.strictEqual(M.isComplexityExhaustionReply('I ran into a complex operation that required too many steps. Could you break it into smaller pieces?'), true);
    assert.strictEqual(M.isComplexityExhaustionReply('I ran into a complex operation that required too many steps. Could you break your request into smaller pieces?'), true);
    assert.strictEqual(M.isComplexityExhaustionReply('Please break this into smaller pieces.'), false);
  });
  await test('no-write exhaustion returns a typed specific route, not the generic dead end', () => {
    const result = M.buildComplexityRecovery([]);
    assert.strictEqual(result.recovery.kind, 'complexity_exhausted');
    assert.strictEqual(result.recovery.write_state, 'none');
    assert.strictEqual(result.recovery.code, 'retry_specific_request');
    assert.ok(/exact Quote number or ID/.test(result.reply), result.reply);
    assert.ok(!/break (?:it|your request) into smaller pieces/i.test(result.reply), result.reply);
  });
  await test('write-tracked exhaustion never retries and tells the user to verify', () => {
    const result = M.buildComplexityRecovery([
      { name: 'zoho_get_record' },
      { name: 'zoho_update_record' },
    ]);
    assert.strictEqual(result.recovery.write_state, 'possible');
    assert.strictEqual(result.recovery.code, 'verify_after_possible_write');
    assert.deepStrictEqual(result.recovery.tool_names, ['zoho_update_record']);
    assert.ok(/did not retry/.test(result.reply) && /Verify the record in Zoho/.test(result.reply), result.reply);
  });
  await test('quote and dashboard exhaustion normalize to surface-specific inert recovery', () => {
    const generic = 'I ran into a complex operation that required too many steps. Could you break your request into smaller pieces?';
    const quote = M.normalizeComplexityReply(generic, { surface: 'quote' });
    assert.strictEqual(quote.exhausted, true);
    assert.strictEqual(quote.recovery.code, 'retry_deterministic_quote');
    assert.strictEqual(quote.recovery.write_state, 'unknown');
    assert.ok(/did not retry automatically/i.test(quote.reply), quote.reply);
    const dashboard = M.normalizeComplexityReply(generic, { surface: 'dashboard' });
    assert.strictEqual(dashboard.recovery.code, 'retry_dashboard_capture');
    assert.strictEqual(dashboard.recovery.write_state, 'none');
    assert.ok(!/break (?:it|your request) into smaller pieces/i.test(dashboard.reply), dashboard.reply);
  });

  console.log('');
  console.log(failed === 0
    ? '✅ ' + passed + '/' + (passed + failed) + ' assertions passed'
    : '❌ ' + failed + ' FAILED, ' + passed + ' passed');
  process.exit(failed === 0 ? 0 : 1);
})();
