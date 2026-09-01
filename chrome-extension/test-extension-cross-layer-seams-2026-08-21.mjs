import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  normalizeStoredChatSession,
  serializeChatSession,
} from './src/lib/context-lock.mjs';
import { verifyStratusOrderUrlOptions } from './src/lib/email-quote-flow.mjs';
import {
  editableRowsFromResult,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';
import {
  rebaseQuoteOptionIndexes,
  selectQuoteOptionIndex,
  toggleQuoteOptionIndex,
} from './src/sidebar/components/quote-option-selection.mjs';

const quoteClientSource = readFileSync(new URL('./src/lib/quote-client.js', import.meta.url), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0;
  let opened = false;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') { depth += 1; opened = true; }
    if (source[index] === '}') {
      depth -= 1;
      if (opened && depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`could not extract ${name}`);
}

function quoteResponseMapper() {
  const toUrlObj = extractFunction(quoteClientSource, 'toUrlObj');
  const mergeMrEnt = extractFunction(quoteClientSource, 'mergeMrEntIntoQuoteOptions');
  const mapQuoteResponse = extractFunction(quoteClientSource, 'mapQuoteResponse');
  return Function(`const ORDER_BASE = 'https://stratusinfosystems.com/order/'; ${toUrlObj}; ${mergeMrEnt}; return (${mapQuoteResponse});`)();
}

test('worker hardware-only and resolved-license row semantics survive mapping, storage, restore, and edit serialization', () => {
  const map = quoteResponseMapper();
  const mapped = map({
    quoteUrls: [{
      label: 'Reviewed mixed intent',
      url: 'https://stratusinfosystems.com/order/?item=MX64-HW,LIC-MX67-SEC-3YR&qty=1,2',
    }],
    parsedItems: [
      { sku: 'MX64', resolvedSku: 'MX64-HW', qty: 1, hardwareOnly: true, requestedTier: 'SEC' },
      { sku: 'MX67', resolvedSku: 'LIC-MX67-SEC-3YR', qty: 2, licenseOnly: true },
    ],
  });
  assert.deepEqual(mapped.result.parsed, [
    { baseSku: 'MX64', qty: 1, resolvedSku: 'MX64-HW', hardwareOnly: true, requestedTier: 'SEC' },
    { baseSku: 'MX67', qty: 2, resolvedSku: 'LIC-MX67-SEC-3YR', licenseOnly: true },
  ]);

  const stored = serializeChatSession({
    sessionId: 'cross_layer_hardware_only',
    messages: [{ id: 1, role: 'assistant', kind: 'quote', result: mapped.result }],
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(stored))).messages[0];
  assert.deepEqual(restored.result.parsed, mapped.result.parsed);

  const rows = editableRowsFromResult(restored.result);
  assert.deepEqual(rows, [
    { sku: 'MX64-HW', qty: 1, unresolved: false, synthetic: false, tier: 'none', typedSku: 'MX64' },
    { sku: 'LIC-MX67-SEC-3YR', qty: 2, unresolved: false, synthetic: false, typedSku: 'MX67' },
  ]);
  const updated = quoteTextFromEditorRows(rows.map((row, index) => (
    index === 0 ? { ...row, qty: 2 } : row
  )), '');
  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.text, '2 MX64-HW hardware only\n2 LIC-MX67-SEC-3YR');
  assert.deepEqual(updated.hardwareOnlySkus, ['MX64-HW']);
});

test('quote selection identity is one reviewed index even when distinct options share a URL', () => {
  const sharedUrl = 'https://stratusinfosystems.com/order/?item=MX67&qty=1';
  const options = [
    { optionGroupId: 'renew-as-is', termYears: 3, url: sharedUrl },
    { optionGroupId: 'eol-refresh', termYears: 3, url: sharedUrl },
  ];
  let selected = selectQuoteOptionIndex([], 1, options.length);
  assert.deepEqual(selected, [1]);
  selected = toggleQuoteOptionIndex(selected, 0, options.length);
  assert.deepEqual(selected, [1, 0]);
  selected = toggleQuoteOptionIndex(selected, 1, options.length);
  assert.deepEqual(selected, [0]);
  assert.deepEqual(selectQuoteOptionIndex(selected, 1, options.length, { exclusive: true }), [1]);
  assert.deepEqual(rebaseQuoteOptionIndexes([1], [0, 1]), [1],
    'downstream handoff must not remap the selected refresh to the first equal URL');
  assert.deepEqual(rebaseQuoteOptionIndexes([1, 0], [0, 1]), [1, 0],
    'downstream handoff must preserve both reviewed option identities and order');
  assert.deepEqual(rebaseQuoteOptionIndexes([2, 1], [0, 2]), [1],
    'unsafe filtered slots must be dropped without shifting a different selection into place');
});

function eolRefreshOption() {
  return {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    url: 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1, tier: 'SEC' }],
      targetLines: [
        { sku: 'MX67', qty: 1 },
        { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
      ],
      replacements: [{
        kind: 'eol_replace',
        from: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1, tier: 'SEC' }],
        to: [
          { sku: 'MX67', qty: 1, role: 'hardware' },
          { sku: 'LIC-MX67-SEC-3YR', qty: 1, role: 'license' },
        ],
      }],
    },
  };
}

test('synthetic MR-ENT merge extends an EOL proof source, target, and URL atomically', () => {
  const map = quoteResponseMapper();
  const mapped = map({
    quoteUrls: [eolRefreshOption()],
    parsedItems: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1, licenseOnly: true }],
  }, 2);
  assert.equal(mapped.result.urls.length, 1);
  const option = mapped.result.urls[0];
  assert.equal(option.url, 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR,LIC-ENT-3YR&qty=1,1,2');
  assert.deepEqual(option.verification.sourceLines, [
    { sku: 'LIC-MX64-SEC-3YR', qty: 1, tier: 'SEC' },
    { sku: 'LIC-ENT-3YR', qty: 2 },
  ]);
  assert.deepEqual(option.verification.targetLines, [
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    { sku: 'LIC-ENT-3YR', qty: 2 },
  ]);
  const verified = verifyStratusOrderUrlOptions(mapped.result.urls, [
    { sku: 'LIC-MX64-SEC-3YR', qty: 1 },
    { sku: 'MR-ENT', qty: 2 },
  ]);
  assert.equal(verified.ok, true, verified.error);
});

test('synthetic MR-ENT turns a globally hardware-only EOL cart into a licensed mixed cart', () => {
  const map = quoteResponseMapper();
  const option = {
    label: 'Hardware Refresh — 3-Year',
    optionKind: 'eol_refresh',
    optionGroupId: 'eol-refresh',
    termYears: 3,
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX67&qty=1',
    verification: {
      schema: 'quote-option-v1',
      mode: 'eol_transform',
      sourceLines: [{ sku: 'MX64', qty: 1 }],
      targetLines: [{ sku: 'MX67', qty: 1 }],
      replacements: [{
        kind: 'eol_replace',
        hardwareOnly: true,
        from: [{ sku: 'MX64', qty: 1 }],
        to: [{ sku: 'MX67', qty: 1, role: 'hardware' }],
      }],
    },
  };
  const mapped = map({
    quoteUrls: [option],
    parsedItems: [{ sku: 'MX64', qty: 1, hardwareOnly: true }],
  }, 2);
  assert.equal(mapped.result.urls.length, 1);
  const merged = mapped.result.urls[0];
  assert.equal(merged.hardwareOnly, undefined,
    'adding a license must clear the whole-cart Hardware Only flag');
  assert.equal(merged.verification.replacements[0].hardwareOnly, true,
    'the reviewed bare EOL replacement proof must remain intact');
  assert.equal(merged.url,
    'https://stratusinfosystems.com/order/?item=MX67,LIC-ENT-3YR&qty=1,2');
  const verified = verifyStratusOrderUrlOptions([merged], [
    { sku: 'MX64', qty: 1, tier: 'none' },
    { sku: 'MR-ENT', qty: 2 },
  ], { hardwareOnlySkus: ['MX64'] });
  assert.equal(verified.ok, true, verified.error);
});

test('synthetic MR-ENT merge fails closed instead of repairing a stale EOL proof', () => {
  const map = quoteResponseMapper();
  const stale = eolRefreshOption();
  stale.verification.targetLines[0].qty = 2;
  const mapped = map({
    quoteUrls: [stale],
    parsedItems: [{ sku: 'LIC-MX64-SEC-3YR', qty: 1, licenseOnly: true }],
  }, 2);
  assert.deepEqual(mapped.result.urls, []);
});
