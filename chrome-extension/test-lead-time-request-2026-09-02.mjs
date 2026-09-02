import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  buildLeadTimePayload,
  collectLeadTimeHardwareSkus,
  formatLeadTimeResult,
  requestLeadTimes,
  toLeadTimeHardwareSku,
} from './src/lib/lead-time-request.mjs';

const CART_ROWS = [
  { sku: 'MR46', qty: 2 },
  { sku: 'LIC-ENT-3YR', qty: 2 },
  { sku: 'MX67', qty: 1 },
  { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  { sku: 'MS130-24P', qty: 1 },
  { sku: 'C9300-24S-M', qty: 1 },
];

test('lead-time payload is hardware -HW only and never includes license SKUs', () => {
  const payload = buildLeadTimePayload(CART_ROWS);
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.skus, ['MR46-HW', 'MX67-HW', 'MS130-24P-HW']);
  assert.equal(payload.text, 'lead time of MR46-HW,MX67-HW,MS130-24P-HW');
  assert.ok(!payload.skus.some((sku) => sku.startsWith('LIC-')));
  assert.ok(!payload.skus.includes('C9300-24S-M'));
  assert.equal(toLeadTimeHardwareSku('LIC-ENT-3YR'), null);
  assert.equal(toLeadTimeHardwareSku('C9300-24S-M'), null);
});

test('selected hardware rows or an ecomm cart URL produce the same hardware-only list', () => {
  const fromRows = collectLeadTimeHardwareSkus({
    rows: CART_ROWS,
    selectedIndexes: [0, 2, 4],
  });
  const fromUrl = collectLeadTimeHardwareSkus({
    orderUrl: 'https://stratusinfosystems.com/order/?item=MR46-HW,LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR,MS130-24P&qty=2,2,1,1,1',
  });
  assert.deepEqual(fromRows, ['MR46-HW', 'MX67-HW', 'MS130-24P-HW']);
  assert.deepEqual(fromUrl, ['MR46-HW', 'MX67-HW', 'MS130-24P-HW']);
});

test('requestLeadTimes POSTs to the existing gateway with X-API-Key and never includes licenses', async () => {
  let captured = null;
  const result = await requestLeadTimes({
    apiBase: 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev',
    apiKey: 'test-gateway-key',
    skus: CART_ROWS,
    fetch: async (url, init) => {
      captured = { url, init };
      return new Response(JSON.stringify({
        ok: true, sent: false, dryRun: true, skuCount: 3, text: 'lead time of MR46-HW,MX67-HW,MS130-24P-HW',
      }), { status: 200 });
    },
  });
  assert.equal(captured.url, 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev/api/lead-time');
  assert.equal(captured.init.headers['X-API-Key'], 'test-gateway-key');
  const body = JSON.parse(captured.init.body);
  assert.deepEqual(body.skus, ['MR46-HW', 'MX67-HW', 'MS130-24P-HW']);
  assert.ok(!JSON.stringify(body).includes('LIC-'));
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.sent, false);
  assert.match(formatLeadTimeResult(result), /dry-run/);
});

test('license-only selection is rejected and does not fetch', async () => {
  let fetched = false;
  const result = await requestLeadTimes({
    apiBase: 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev',
    apiKey: 'test-gateway-key',
    skus: [{ sku: 'LIC-ENT-3YR', qty: 2 }],
    fetch: async () => {
      fetched = true;
      throw new Error('must not fetch');
    },
  });
  assert.equal(fetched, false);
  assert.equal(result.ok, false);
  assert.match(result.error, /hardware SKU/i);
});

test('extension lead-time UI talks only to the gateway (no Webex/Composio hosts)', () => {
  const quoteResult = readFileSync(new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url), 'utf8');
  const manifest = readFileSync(new URL('./manifest.json', import.meta.url), 'utf8');
  assert.match(quoteResult, /requestLeadTimes/);
  assert.match(quoteResult, /lead-time-panel/);
  assert.doesNotMatch(quoteResult, /webex\.com|composio\.dev|pipedream/i);
  assert.match(manifest, /stratus-ai-bot-gateway\.chrisg-ec1\.workers\.dev/);
  assert.doesNotMatch(manifest, /webex\.com|composio\.dev/);
});
