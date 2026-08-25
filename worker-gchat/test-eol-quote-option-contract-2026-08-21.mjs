import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { verifyStratusOrderUrlOptions } from '../chrome-extension/src/lib/email-quote-flow.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function loadWorkerAndHelpers() {
  const esc = (rel) => path.join(__dirname, rel).replace(/\\/g, '\\\\');
  let source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  source = source.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  source = source.replace(/^import\s+(\w+)\s+from\s+'\.\/([^']+\.json)';?$/mg,
    (_match, name, rel) => `const ${name} = require('${esc(`src/${rel}`)}');`);
  source = source.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  source = source.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  source = source.replace(/^export default /m, 'module.exports.__worker = ');
  source += '\nmodule.exports.__helpers = { attachTrustedQuoteOptionContracts, isTrustedEolQuoteOptionContract };\n';
  const temporary = path.join(os.tmpdir(), `eol-contract-${process.pid}.cjs`);
  fs.writeFileSync(temporary, source);
  try {
    delete require.cache[require.resolve(temporary)];
    return require(temporary);
  } finally {
    fs.unlinkSync(temporary);
  }
}

const { __worker: worker, __helpers: helpers } = loadWorkerAndHelpers();
const kv = {
  get: async () => null,
  put: async () => {},
  list: async () => ({ keys: [] }),
  getWithMetadata: async () => ({ value: null, metadata: null }),
};
const db = {
  prepare: () => ({
    bind: () => ({ run: async () => ({ success: true }), first: async () => null, all: async () => ({ results: [] }) }),
    run: async () => ({ success: true }),
    first: async () => null,
    all: async () => ({ results: [] }),
  }),
};
const env = {
  GMAIL_ADDON_API_KEY: 'test-key',
  CONVERSATION_KV: kv,
  PRICES_KV: kv,
  ANALYTICS_DB: db,
  BOT_METRICS: { writeDataPoint: () => {} },
  BOT_STORAGE: kv,
};
const ctx = { waitUntil: (promise) => promise?.catch?.(() => {}) };

async function quote(text) {
  const request = new Request('https://contract-test.workers.dev/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': 'test-key' },
    body: JSON.stringify({ text, personId: `contract-${Math.random()}` }),
  });
  const response = await worker.fetch(request, env, ctx);
  assert.equal(response.status, 200);
  return response.json();
}

function cartLines(rawUrl) {
  const parsed = new URL(rawUrl);
  const skus = parsed.searchParams.get('item').split(',');
  const qtys = parsed.searchParams.get('qty').split(',').map(Number);
  return skus.map((sku, index) => ({ sku: sku.toUpperCase(), qty: qtys[index] }));
}

test('direct EOL licence refresh options carry a term-bound exact transform contract', async () => {
  const result = await quote('renew LIC-ENT-3YR x2 and LIC-MX64-SEC-3YR x1');
  assert.equal(result.handlerType, 'deterministic');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  const renewals = result.quoteUrls.filter((option) => option.optionKind !== 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result.quoteUrls));
  assert.equal(renewals.length, 3);
  assert.ok(renewals.every((option) => option.verification === undefined), 'legacy renewal options must stay unannotated');

  for (const [index, term] of [1, 3, 5].entries()) {
    const option = refresh[index];
    assert.equal(option.optionGroupId, 'eol-refresh');
    assert.equal(option.termYears, term);
    assert.equal(option.verification.schema, 'quote-option-v1');
    assert.equal(option.verification.mode, 'eol_transform');
    assert.deepEqual(option.verification.sourceLines, [
      { sku: `LIC-ENT-${term}YR`, qty: 2 },
      { sku: `LIC-MX64-SEC-${term}YR`, qty: 1 },
    ]);
    assert.deepEqual(option.verification.targetLines, cartLines(option.url));
    assert.deepEqual(option.verification.targetLines, [
      { sku: `LIC-ENT-${term}YR`, qty: 2 },
      { sku: 'MX67', qty: 1 },
      { sku: `LIC-MX67-SEC-${term}YR`, qty: 1 },
    ]);
    assert.deepEqual(option.verification.replacements, [{
      kind: 'eol_replace',
      from: [{ sku: `LIC-MX64-SEC-${term}YR`, qty: 1, tier: 'SEC' }],
      to: [
        { sku: 'MX67', qty: 1, role: 'hardware' },
        { sku: `LIC-MX67-SEC-${term}YR`, qty: 1, role: 'license' },
      ],
    }]);
  }
});

test('parsed.items EOL contracts consume hardware and an approved explicit companion once', async () => {
  const result = await quote('quote 1 MX64 enterprise and 1 LIC-MX64-ENT-3YR');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result));
  for (const [index, term] of [1, 3, 5].entries()) {
    const option = refresh[index];
    assert.equal(option.termYears, term);
    assert.deepEqual(option.verification.sourceLines, [
      { sku: 'MX64', qty: 1, tier: 'ENT' },
      { sku: `LIC-MX64-ENT-${term}YR`, qty: 1 },
    ]);
    assert.deepEqual(option.verification.replacements[0].from, [
      { sku: 'MX64', qty: 1, tier: 'ENT' },
      { sku: `LIC-MX64-ENT-${term}YR`, qty: 1 },
    ]);
    assert.deepEqual(option.verification.targetLines, [
      { sku: 'MX67', qty: 1 },
      { sku: `LIC-MX67-ENT-${term}YR`, qty: 1 },
    ]);
  }
});

test('repeated identical EOL rows aggregate before a full explicit companion is assigned', async () => {
  const result = await quote('quote 1 MX64 enterprise, 1 MX64 enterprise, and 2 LIC-MX64-ENT-3YR');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result));
  for (const [index, term] of [1, 3, 5].entries()) {
    const replacement = refresh[index].verification.replacements[0];
    assert.equal(refresh[index].verification.replacements.length, 1);
    assert.deepEqual(replacement.from, [
      { sku: 'MX64', qty: 2, tier: 'ENT' },
      { sku: `LIC-MX64-ENT-${term}YR`, qty: 2 },
    ]);
    assert.deepEqual(replacement.to, [
      { sku: 'MX67', qty: 2, role: 'hardware' },
      { sku: `LIC-MX67-ENT-${term}YR`, qty: 2, role: 'license' },
    ]);
    const target = new Map(refresh[index].verification.targetLines.map((line) => [line.sku, line.qty]));
    assert.equal(target.get('MX67'), 2);
    assert.equal(target.get(`LIC-MX67-ENT-${term}YR`), 2);
  }
});

test('repeated identical EOL rows aggregate with the reviewed affirmative HA half companion', async () => {
  const result = await quote('quote 1 MX64 enterprise, 1 MX64 enterprise, and 1 LIC-MX64-ENT-3YR as a warm spare HA pair');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result));
  for (const [index, term] of [1, 3, 5].entries()) {
    const replacement = refresh[index].verification.replacements[0];
    assert.equal(refresh[index].verification.replacements.length, 1);
    assert.deepEqual(replacement.from, [
      { sku: 'MX64', qty: 2, tier: 'ENT' },
      { sku: `LIC-MX64-ENT-${term}YR`, qty: 1 },
    ]);
    assert.deepEqual(replacement.to, [
      { sku: 'MX67', qty: 2, role: 'hardware' },
      { sku: `LIC-MX67-ENT-${term}YR`, qty: 1, role: 'license' },
    ]);
  }
});

test('mixed EOL and current hardware retain ordinary deterministic companions outside replacements', async () => {
  const result = await quote('quote 1 MX64 enterprise and 2 MR44');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result));
  for (const [index, term] of [1, 3, 5].entries()) {
    const verification = refresh[index].verification;
    assert.equal(verification.replacements.length, 1);
    assert.deepEqual(verification.replacements[0].from, [{ sku: 'MX64', qty: 1, tier: 'ENT' }]);
    const target = new Map(verification.targetLines.map((line) => [line.sku, line.qty]));
    assert.equal(target.get('MX67'), 1);
    assert.equal(target.get(`LIC-MX67-ENT-${term}YR`), 1);
    assert.equal(target.get('MR44-HW'), 2);
    assert.equal(target.get(`LIC-ENT-${term}YR`), 2);
  }
});

test('the contract retains unrelated licence rows and preserves MX tier semantics', async () => {
  for (const { tier, suffix } of [
    { tier: 'ENT', suffix: 'YR' },
    { tier: 'SEC', suffix: 'YR' },
    { tier: 'SDW', suffix: 'Y' },
  ]) {
    const result = await quote(`renew LIC-ENT-3YR x2 and LIC-MX64-${tier}-3${suffix} x1`);
    const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
    assert.equal(refresh.length, 3, tier);
    for (const [index, term] of [1, 3, 5].entries()) {
      const target = new Map(refresh[index].verification.targetLines.map((line) => [line.sku, line.qty]));
      assert.equal(target.get(`LIC-ENT-${term}YR`), 2, `${tier}: unrelated licence missing`);
      assert.equal(target.get(`LIC-MX67-${tier}-${term}${suffix}`), 1, `${tier}: replacement tier changed`);
    }
  }
});

test('dual-uplink EOL replacements use stable distinct option groups', async () => {
  const result = await quote('renew LIC-MS225-24P-3YR x2 and LIC-ENT-3YR x1');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 6, JSON.stringify(result.quoteUrls));
  const byGroup = Map.groupBy(refresh, (option) => option.optionGroupId);
  assert.deepEqual([...byGroup.keys()], ['eol-refresh-1g', 'eol-refresh-10g']);
  assert.deepEqual(byGroup.get('eol-refresh-1g').map((option) => option.termYears), [1, 3, 5]);
  assert.deepEqual(byGroup.get('eol-refresh-10g').map((option) => option.termYears), [1, 3, 5]);
  assert.ok(byGroup.get('eol-refresh-1g').every((option) => option.verification.targetLines.some((line) => line.sku === 'MS150-24P-4G')));
  assert.ok(byGroup.get('eol-refresh-10g').every((option) => option.verification.targetLines.some((line) => line.sku === 'MS150-24P-4X')));
});

test('hardware-only EOL refreshes are explicit and keep distinct term proofs for identical URLs', async () => {
  const result = await quote('quote 1 MX64 hardware only');
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 3, JSON.stringify(result));
  assert.deepEqual(refresh.map((option) => option.termYears), [1, 3, 5]);
  assert.ok(refresh.every((option) => option.hardwareOnly === true));
  assert.ok(refresh.every((option) => option.verification.replacements.length === 1
    && option.verification.replacements[0].hardwareOnly === true));
  assert.ok(refresh.every((option) => option.verification.targetLines.every((line) => !line.sku.startsWith('LIC-'))));
  assert.ok(refresh.every((option) => option.verification.targetLines.some((line) => line.sku === 'MX67' && line.qty === 1)));
  assert.deepEqual(refresh.map((option) => option.url), [refresh[0].url, refresh[0].url, refresh[0].url]);
});

test('stale, malformed, and non-EOL contracts are never attached', () => {
  const option = { url: 'https://stratusinfosystems.com/order/?item=MX75,LIC-MX75-SEC-3Y&qty=1,1', label: 'do not trust this label' };
  const base = {
    url: option.url,
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1 }],
      targetLines: [{ sku: 'MX75', qty: 1 }, { sku: 'LIC-MX75-SEC-3Y', qty: 1 }],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1 }],
        to: [{ sku: 'MX75', qty: 1, role: 'hardware' }, { sku: 'LIC-MX75-SEC-3Y', qty: 1, role: 'license' }],
      }],
    },
  };
  assert.equal(helpers.isTrustedEolQuoteOptionContract(base), false, 'stale MX64→MX75 mapping was trusted');
  assert.deepEqual(helpers.attachTrustedQuoteOptionContracts([option], [base]), [option]);

  const malformed = structuredClone(base);
  malformed.verification.targetLines[0].qty = 2;
  assert.equal(helpers.isTrustedEolQuoteOptionContract(malformed), false);

  const noEol = structuredClone(base);
  noEol.verification.sourceLines = [{ sku: 'MR44', qty: 1 }];
  noEol.verification.replacements[0].from = [{ sku: 'MR44', qty: 1 }];
  assert.equal(helpers.isTrustedEolQuoteOptionContract(noEol), false);
});

test('validator rejects unrelated source consumption and any unreviewed hardware target', () => {
  const unrelatedSource = {
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'MX64', qty: 1, tier: 'SEC' }, { sku: 'MR44', qty: 1 }],
      targetLines: [{ sku: 'MX67', qty: 1 }, { sku: 'LIC-MX67-SEC-3YR', qty: 1 }],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'MX64', qty: 1, tier: 'SEC' }, { sku: 'MR44', qty: 1 }],
        to: [{ sku: 'MX67', qty: 1, role: 'hardware' }, { sku: 'LIC-MX67-SEC-3YR', qty: 1, role: 'license' }],
      }],
    },
  };
  assert.equal(helpers.isTrustedEolQuoteOptionContract(unrelatedSource), false);

  const extraTarget = {
    url: 'https://stratusinfosystems.com/order/?item=MX67,MX75,LIC-MX67-SEC-3YR&qty=1,1,2',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'LIC-MX64-SEC-3YR', qty: 2 }],
      targetLines: [{ sku: 'MX67', qty: 1 }, { sku: 'MX75', qty: 1 }, { sku: 'LIC-MX67-SEC-3YR', qty: 2 }],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'LIC-MX64-SEC-3YR', qty: 2, tier: 'SEC' }],
        to: [
          { sku: 'MX67', qty: 1, role: 'hardware' },
          { sku: 'MX75', qty: 1, role: 'hardware' },
          { sku: 'LIC-MX67-SEC-3YR', qty: 2, role: 'license' },
        ],
      }],
    },
  };
  assert.equal(helpers.isTrustedEolQuoteOptionContract(extraTarget), false);
});

test('/api/quote preserves reviewed row tiers and editor resolution markers', async () => {
  const bundle = await quote('quote 1 MX67 enterprise');
  assert.equal(bundle.parsedItems[0].requestedTier, 'ENT');

  const renewal = await quote('quote 1 MX67 enterprise license renewal');
  const row = renewal.parsedItems[0];
  assert.equal(row.requestedTier, 'ENT');
  assert.equal(row.licenseOnly, true);
  assert.equal(row.resolvedSku, 'LIC-MX67-ENT-3YR');
});

test('Omaha Zoo multi-EOL renewal publishes every trusted refresh alternative', async () => {
  const committed = [
    { sku: 'LIC-MS120-24P-3YR', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
    { sku: 'LIC-MX67C-SEC-3YR', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 193 },
    { sku: 'LIC-MS220-8P-3YR', qty: 1 },
    { sku: 'LIC-MS120-8-3YR', qty: 3 },
    { sku: 'LIC-MS210-24P-3YR', qty: 1 },
  ];
  const result = await quote(committed.map(({ sku, qty }) => `${sku} x${qty}`).join(', '));
  const refresh = result.quoteUrls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(refresh.length, 6, JSON.stringify(result.quoteUrls));
  assert.deepEqual(
    [...new Set(refresh.map((option) => option.optionGroupId))].sort(),
    ['eol-refresh-10g', 'eol-refresh-1g'],
  );

  const checked = verifyStratusOrderUrlOptions(result.quoteUrls, committed);
  assert.equal(checked.ok, true, checked.error);
  const publishedRefresh = checked.urls.filter((option) => option.optionKind === 'eol_refresh');
  assert.equal(publishedRefresh.length, 6, JSON.stringify({
    published: checked.urls.map((option) => option.label),
    dropped: checked.dropped,
  }));
});
