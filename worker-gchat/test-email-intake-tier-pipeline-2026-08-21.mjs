// Exact-source regression matrix for the Gmail "Create quote" boundary.
//
// This deliberately crosses every stage used by EmailQuoteIntakeCard:
//   real Worker buildOneshotIntake
//   -> real extension normalizeQuoteIntakeLines / quoteSkuTextFromLines
//   -> real Worker parseMessage / buildQuoteResponse
//   -> real extension verifyStratusOrderUrlOptions
//
// It exists because stage-local parser and editor tests can all pass while the
// intake JSON silently drops a row-local tier between the Worker and extension.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import {
  normalizeQuoteIntakeLines,
  quoteSkuTextFromLines,
  verifyStratusOrderUrlOptions,
} from '../chrome-extension/src/lib/email-quote-flow.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const require = createRequire(import.meta.url);
const CHAT_SOURCE = fs.readFileSync(
  path.join(ROOT, 'chrome-extension/src/sidebar/panels/ChatPanel.jsx'),
  'utf8',
);

function extractRealWorker() {
  const escapePath = (relative) => path.join(HERE, 'src', relative).replace(/\\/g, '\\\\');
  let source = fs.readFileSync(path.join(HERE, 'src/index.js'), 'utf8');
  source = source.replace(
    /^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, relative) => `const ${name} = require('${escapePath(relative)}');`,
  );
  source = source.replace(
    /^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};',
  );
  source = source.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const exportDefault = source.indexOf('export default');
  if (exportDefault > -1) {
    let depth = 0;
    let started = false;
    let end = exportDefault;
    for (let index = exportDefault; index < source.length; index++) {
      if (source[index] === '{') { depth++; started = true; }
      if (source[index] === '}') {
        depth--;
        if (started && depth === 0) { end = index + 1; break; }
      }
    }
    source = source.slice(0, exportDefault) + source.slice(end + 1);
  }
  source += '\nmodule.exports={buildOneshotIntake,parseMessage,buildQuoteResponse};\n';
  const temporary = path.join(HERE, `.tmp-email-intake-tier-${process.pid}.cjs`);
  fs.writeFileSync(temporary, source);
  try {
    delete require.cache[require.resolve(temporary)];
    return require(temporary);
  } finally {
    fs.unlinkSync(temporary);
  }
}

const worker = extractRealWorker();
const ORDER_URL_RE = /https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g;

function optionTerm(rawUrl) {
  const items = String(new URL(rawUrl).searchParams.get('item') || '').split(',');
  const terms = [...new Set(items
    .map((sku) => String(sku).match(/-([135])Y(?:R)?$/i)?.[1] || '')
    .filter(Boolean))];
  return terms.length === 1 ? Number(terms[0]) : null;
}

function optionsFromWorkerMessage(message) {
  return [...String(message || '').matchAll(ORDER_URL_RE)].map((match, index) => {
    const url = match[0];
    const term = optionTerm(url);
    return { label: term ? `${term}-Year` : `Option ${index + 1}`, url };
  });
}

function cartOf(rawUrl) {
  const url = new URL(rawUrl);
  const skus = String(url.searchParams.get('item') || '').split(',').filter(Boolean);
  const quantities = String(url.searchParams.get('qty') || '').split(',').map(Number);
  const cart = new Map();
  skus.forEach((sku, index) => {
    const key = sku.toUpperCase();
    cart.set(key, (cart.get(key) || 0) + quantities[index]);
  });
  return cart;
}

function intakeInput(body) {
  return {
    source: 'ext-email-ecomm-intake',
    subject: 'Quote request',
    body_text: body,
    participants: [{ email: 'customer@example.com', name: 'Synthetic Customer', role: 'customer' }],
    messages: [{ index: 0, from_email: 'customer@example.com', body }],
  };
}

async function runIntakePipeline(body) {
  let extractorCalls = 0;
  const intake = await worker.buildOneshotIntake(
    intakeInput(body),
    {},
    'sales@example.com',
    async () => { extractorCalls++; throw new Error('literal intake must not use the extractor'); },
  );
  assert.equal(intake.success, true, intake.detail || intake.error);
  assert.equal(extractorCalls, 0, 'literal SKU intake unexpectedly used the LLM extractor');

  const allResolved = intake.lines.length > 0
    && intake.lines.every((line) => line.status === 'resolved');
  const normalized = normalizeQuoteIntakeLines(intake.lines);
  if (!allResolved || !normalized.length) {
    return {
      stage: 'intake',
      ok: false,
      intake,
      allResolved,
      normalized,
      skuText: '',
      options: [],
      verified: null,
    };
  }

  const intent = intake.intent || {};
  const modifiers = [];
  if (intent.hardware_only === true) modifiers.push('hardware only');
  else if (intent.license_tier === 'ENT') modifiers.push('enterprise');
  else if (intent.license_tier === 'SEC') modifiers.push('security');
  else if (intent.license_tier === 'SDW') modifiers.push('SD-WAN');
  else if (intent.license_tier === 'A') modifiers.push('advanced license');
  const skuText = [quoteSkuTextFromLines(intake.lines), ...modifiers].filter(Boolean).join('\n');

  const parsed = worker.parseMessage(skuText);
  assert.ok(parsed, `real Worker could not parse normalized intake:\n${skuText}`);
  const built = worker.buildQuoteResponse(parsed);
  const options = optionsFromWorkerMessage(built.message);
  const verified = verifyStratusOrderUrlOptions(options, normalized, {
    licenseTier: intent.hardware_only === true ? null : intent.license_tier,
    allowHaLicenseRatio: intent.ha_requested === true,
    requireLicensedOption: intent.hardware_only !== true,
  });
  return {
    stage: verified.ok ? 'done' : 'verify',
    ok: verified.ok,
    intake,
    allResolved,
    normalized,
    skuText,
    parsed,
    built,
    options,
    verified,
  };
}

function licensedOptions(result) {
  return (result.verified?.urls || []).filter((option) => option.hardwareOnly !== true);
}

function assertMixedMxTiers(result, secQty, entQty) {
  assert.equal(result.ok, true, result.verified?.error || result.built?.message);
  assert.equal(licensedOptions(result).length, 3, 'expected verified 1/3/5-year options');
  for (const option of licensedOptions(result)) {
    const term = optionTerm(option.url);
    const cart = cartOf(option.url);
    assert.equal(cart.get('MX67'), secQty + entQty);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), secQty);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), entQty);
  }
}

test('intake review preserves same-SKU Security then Enterprise rows through final verification', async () => {
  const result = await runIntakePipeline('Please quote 1 MX67 security and 2 MX67 enterprise.');
  assert.deepEqual(result.intake.lines.map(({ sku, qty, tier, status }) => ({ sku, qty, tier, status })), [
    { sku: 'MX67', qty: 1, tier: 'SEC', status: 'resolved' },
    { sku: 'MX67', qty: 2, tier: 'ENT', status: 'resolved' },
  ]);
  assert.deepEqual(result.normalized, [
    { sku: 'MX67', qty: 1, tier: 'SEC' },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
  ]);
  assert.equal(result.skuText, '1 MX67 security\n2 MX67 enterprise');
  assertMixedMxTiers(result, 1, 2);
});

test('intake review preserves same-SKU Enterprise then Security rows in reverse order', async () => {
  const result = await runIntakePipeline('Please quote 2 MX67 enterprise and 1 MX67 security.');
  assert.deepEqual(result.intake.lines.map(({ sku, qty, tier }) => ({ sku, qty, tier })), [
    { sku: 'MX67', qty: 2, tier: 'ENT' },
    { sku: 'MX67', qty: 1, tier: 'SEC' },
  ]);
  assert.equal(result.skuText, '2 MX67 enterprise\n1 MX67 security');
  assertMixedMxTiers(result, 1, 2);
});

test('same-SKU rows aggregate only inside the same tier', async () => {
  const result = await runIntakePipeline('Please quote 1 MX67 security and 2 MX67 security.');
  assert.deepEqual(result.normalized, [{ sku: 'MX67', qty: 3, tier: 'SEC' }]);
  assert.match(result.skuText, /^3 MX67 security$/m);
  assert.equal(result.ok, true, result.verified?.error);
  for (const option of licensedOptions(result)) {
    const term = optionTerm(option.url);
    assert.equal(cartOf(option.url).get(`LIC-MX67-SEC-${term}YR`), 3);
  }
});

test('literal LIC-ENT never becomes a global tier for blank MX hardware', async () => {
  const result = await runIntakePipeline('Please quote 2 LIC-ENT-3YR and 1 MX67.');
  assert.equal(result.intake.intent.license_tier, null);
  assert.equal(result.skuText, '2 LIC-ENT-3YR\n1 MX67');
  assert.equal(result.ok, true, result.verified?.error);
  for (const option of licensedOptions(result)) {
    const term = optionTerm(option.url);
    const cart = cartOf(option.url);
    assert.equal(cart.get(`LIC-ENT-${term}YR`), 2);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.has(`LIC-MX67-ENT-${term}YR`), false);
  }
});

test('explicit LIC rows carry no redundant tier and remain committed totals', async () => {
  const result = await runIntakePipeline(
    'Please quote 2 LIC-ENT-3YR, 1 MX67, and 1 LIC-MX67-SEC-3YR.',
  );
  const licenseLines = result.intake.lines.filter((line) => line.sku.startsWith('LIC-'));
  assert.ok(licenseLines.length >= 2);
  assert.ok(licenseLines.every((line) => !line.tier), 'literal license row received redundant tier metadata');
  assert.equal(result.intake.intent.license_tier, null);
  assert.doesNotMatch(result.skuText, /^\d+ LIC-[^\n]+\s(?:enterprise|security|SD-WAN|advanced)$/m);
  assert.equal(result.ok, true, result.verified?.error);
  for (const option of licensedOptions(result)) {
    const term = optionTerm(option.url);
    const cart = cartOf(option.url);
    assert.equal(cart.get(`LIC-ENT-${term}YR`), 2);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1, 'explicit companion was duplicated');
  }
});

test('explicit SEC and ENT companion totals survive both source orders', async () => {
  const hardware = '3 MX67';
  const security = '1 LIC-MX67-SEC-3YR';
  const enterprise = '2 LIC-MX67-ENT-3YR';
  for (const clauses of [
    [hardware, security, enterprise],
    [hardware, enterprise, security],
    [security, hardware, enterprise],
    [security, enterprise, hardware],
    [enterprise, hardware, security],
    [enterprise, security, hardware],
  ]) {
    const body = `Please quote ${clauses.join(', ')}.`;
    const result = await runIntakePipeline(body);
    assert.equal(result.ok, true, `${body}: ${result.verified?.error || result.built?.message}\n${JSON.stringify({ intake: result.intake, skuText: result.skuText, parsed: result.parsed, built: result.built, options: result.options }, null, 2)}`);
    for (const option of licensedOptions(result)) {
      const term = optionTerm(option.url);
      const cart = cartOf(option.url);
      assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
      assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 2);
    }
  }
});

test('duplicate explicit companions of one tier aggregate to the hardware total', async () => {
  const result = await runIntakePipeline(
    'Please quote 3 MX67, 1 LIC-MX67-SEC-3YR, and 2 LIC-MX67-SEC-3YR.',
  );
  assert.deepEqual(result.normalized, [
    { sku: 'MX67', qty: 3 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 3 },
  ]);
  assert.equal(result.ok, true, result.verified?.error || result.built?.message);
  for (const option of licensedOptions(result)) {
    const term = optionTerm(option.url);
    assert.equal(cartOf(option.url).get(`LIC-MX67-SEC-${term}YR`), 3);
  }
});

test('multi-tier explicit companion totals under or over hardware fail closed', async () => {
  for (const body of [
    'Please quote 3 MX67, 1 LIC-MX67-SEC-3YR, and 1 LIC-MX67-ENT-3YR.',
    'Please quote 3 MX67, 2 LIC-MX67-SEC-3YR, and 2 LIC-MX67-ENT-3YR.',
  ]) {
    const result = await runIntakePipeline(body);
    assert.equal(result.ok, false, `${body} must not publish a mismatched cart`);
    assert.equal(result.options.length, 0, `${body} leaked an unverified Worker URL`);
    assert.equal(result.verified?.urls?.length || 0, 0, `${body} leaked a verified URL`);
    assert.match(
      [
        result.built?.message,
        ...(result.built?.errors || []),
        ...result.intake.lines.map((line) => line.reason),
      ].filter(Boolean).join(' '),
      /does not cover|quantity|review|No quote link|matching hardware/i,
    );
  }
});

test('multi-tier explicit companions with conflicting terms stay review-blocked', async () => {
  const result = await runIntakePipeline(
    'Please quote 3 MX67, 1 LIC-MX67-SEC-1YR, and 2 LIC-MX67-ENT-3YR.',
  );
  assert.equal(result.ok, false);
  assert.equal(result.stage, 'intake');
  assert.equal(result.allResolved, false);
  assert.equal(result.options.length, 0);
  assert.match(
    result.intake.lines.map((line) => line.reason).filter(Boolean).join(' '),
    /different terms.*review/i,
  );
});

test('unsupported catalog line stays visible and blocks Build quote', async () => {
  const result = await runIntakePipeline(
    'Please quote 1 MX67 and 2 LIC-MX67-NOPE-3YR.',
  );
  const bad = result.intake.lines.find((line) => line.sku === 'LIC-MX67-NOPE-3YR');
  assert.ok(bad, 'unsupported line was silently dropped from intake review');
  assert.ok(['unsupported', 'needs_sku'].includes(bad.status), `unsafe status: ${bad.status}`);
  assert.equal(result.allResolved, false);
  assert.equal(result.stage, 'intake');
  assert.equal(result.options.length, 0, 'blocked intake should never publish a quote URL');
});

test('malformed explicit EOL license tier also fails closed in the Worker', () => {
  const parsed = worker.parseMessage('Please quote 1 LIC-MX64-NOPE-3YR.');
  const built = worker.buildQuoteResponse(parsed);
  assert.equal(optionsFromWorkerMessage(built.message).length, 0);
  assert.ok(
    built.compositionBlocked === true || built.needsLlm === true,
    JSON.stringify({ parsed, built }, null, 2),
  );
  assert.match(
    [built.message, ...(built.errors || [])].filter(Boolean).join(' '),
    /not in the .*catalog|supported replacement license tier|needs review/i,
  );
});

test('Gmail thread scope keeps the original MX64 renewal request ahead of sent carts and a later approval', async () => {
  const originalRequest = [
    'Hi Chris,',
    'Please quote renewal options for 2 x LIC-ENT-3YR and 1 x LIC-MX64-SEC-3YR.',
    'Thanks!',
  ].join('\n');
  const renew1 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,LIC-MX64-SEC-1YR&qty=2,1';
  const renew3 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MX64-SEC-3YR&qty=2,1';
  const renew5 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,LIC-MX64-SEC-5YR&qty=2,1';
  const refresh1 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR,MX67,LIC-MX67-SEC-1YR&qty=2,1,1';
  const refresh3 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,MX67,LIC-MX67-SEC-3YR&qty=2,1,1';
  const refresh5 = 'https://stratusinfosystems.com/order/?item=LIC-ENT-5YR,MX67,LIC-MX67-SEC-5YR&qty=2,1,1';
  const orderUrls = [renew1, renew3, renew5, refresh1, refresh3, refresh5];
  const sentOptions = [
    'Here are the Renew As-Is and MX67 Refresh options:',
    ...orderUrls,
  ].join('\n');
  const approvalReply = 'The MX67 refresh quote looks good. Please proceed with that option.';

  let extractorCalls = 0;
  const intake = await worker.buildOneshotIntake({
    source: 'ext-email-ecomm-intake',
    subject: 'Re: Meraki renewal options',
    body_text: [originalRequest, sentOptions, approvalReply].join('\n\n'),
    participants: [{ email: 'customer@example.com', name: 'Synthetic Customer', role: 'customer' }],
    messages: [
      { index: 0, from_email: 'customer@example.com', body: originalRequest },
      { index: 1, from_email: 'chrisg@stratusinfosystems.com', body: sentOptions },
      { index: 2, from_email: 'customer@example.com', body: approvalReply },
    ],
    order_urls: orderUrls,
  }, {}, 'sales@example.com', async () => {
    extractorCalls += 1;
    throw new Error('literal intake must not use the extractor');
  });

  assert.equal(intake.success, true, intake.detail || intake.error);
  assert.equal(extractorCalls, 0);
  assert.equal(intake.used_order_url, false, 'the last sent refresh cart replaced the customer request');
  assert.equal(intake.used_structured_message, true);
  assert.equal(intake.selected_message_index, 0, 'the approval reply replaced the original quote request');
  assert.deepEqual(intake.lines.map(({ sku, qty, status }) => ({ sku, qty, status })), [
    { sku: 'LIC-ENT-3YR', qty: 2, status: 'resolved' },
    { sku: 'LIC-MX64-SEC-3YR', qty: 1, status: 'resolved' },
  ]);

  // Prove the selected source rows still reach the deterministic EOL builder:
  // three renewal carts and three replacement carts, with no cross-cart merge.
  const parsed = worker.parseMessage(quoteSkuTextFromLines(intake.lines));
  const built = worker.buildQuoteResponse(parsed);
  const options = optionsFromWorkerMessage(built.message);
  assert.equal(options.length, 6, built.message);
  const carts = options.map((option) => cartOf(option.url));
  const renewals = carts.filter((cart) => [...cart.keys()].some((sku) => sku.startsWith('LIC-MX64-SEC-')));
  const refreshes = carts.filter((cart) => cart.has('MX67'));
  assert.equal(renewals.length, 3, 'renew-as-is alternatives were lost');
  assert.equal(refreshes.length, 3, 'MX67 EOL refresh alternatives were lost');
  assert.ok(carts.every((cart) => [...cart.entries()].some(([sku, qty]) => /^LIC-ENT-[135]YR$/.test(sku) && qty === 2)));
  assert.ok(refreshes.every((cart) => [...cart.entries()].some(([sku, qty]) => /^LIC-MX67-SEC-[135]YR$/.test(sku) && qty === 1)));
});

test('link-only Gmail handoff still falls back to the most recent exact cart without merging history', async () => {
  const oldCart = 'https://stratusinfosystems.com/order/?item=OLD-SKU&qty=99';
  const selectedCart = 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=1,1';
  let extractorCalls = 0;
  const intake = await worker.buildOneshotIntake({
    source: 'ext-email-ecomm-intake',
    subject: '',
    body_text: '',
    messages: [],
    order_urls: [oldCart, selectedCart],
  }, {}, 'sales@example.com', async () => { extractorCalls += 1; return {}; });
  assert.equal(intake.success, true);
  assert.equal(intake.used_order_url, true);
  assert.equal(intake.selected_order_url_index, 1);
  assert.equal(intake.selected_order_url, selectedCart);
  assert.deepEqual(intake.lines.map(({ sku, qty }) => ({ sku, qty })), [
    { sku: 'MX67', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]);
  assert.equal(extractorCalls, 0);
});

test('Gmail context preserves exact order-link quantities when the cart belongs to the parsed request', async () => {
  const cart = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MX60-ENT-3YR,LIC-MX64-ENT-3YR,LIC-Z1-ENT-3YR&qty=1,3,1,1';
  // This is intentionally shaped like Gmail-visible copy: literal SKUs are
  // present, but no textual x3 quantity accompanies MX60. The exact cart is
  // therefore the authority for quantity, as it is in the right-click path.
  const body = [
    'Renew Existing Equipment As-Is:',
    cart,
  ].join('\n');
  const intake = await worker.buildOneshotIntake({
    source: 'ext-email-ecomm-intake',
    subject: 'Meraki License Renewal',
    body_text: body,
    messages: [{ index: 4, from_email: 'chrisg@stratusinfosystems.com', body }],
    order_urls: [cart],
  }, {}, 'sales@example.com', async () => { throw new Error('must not extract'); });

  assert.equal(intake.success, true, intake.detail || intake.error);
  assert.equal(intake.used_order_url, true);
  assert.equal(intake.selected_order_url, cart);
  assert.deepEqual(intake.lines.map(({ sku, qty }) => [sku, qty]), [
    ['LIC-ENT-3YR', 1],
    ['LIC-MX60-ENT-3YR', 3],
    ['LIC-MX64-ENT-3YR', 1],
    ['LIC-Z1-ENT-3YR', 1],
  ]);
});

test('a safe selected request ignores malformed historical thread URLs instead of consuming them', async () => {
  const request = 'Please quote 2 LIC-ENT-3YR and 1 LIC-MX64-SEC-3YR.';
  const intake = await worker.buildOneshotIntake({
    source: 'ext-email-ecomm-intake',
    subject: 'Renewal request',
    body_text: request,
    messages: [{ index: 7, from_email: 'customer@example.com', body: request }],
    order_urls: ['https://evil.example/order/?item=MX67&qty=100'],
  }, {}, 'sales@example.com', async () => { throw new Error('must not extract'); });
  assert.equal(intake.success, true);
  assert.equal(intake.used_order_url, false);
  assert.equal(intake.selected_message_index, 7);
  assert.deepEqual(intake.lines.map(({ sku, qty }) => [sku, qty]), [
    ['LIC-ENT-3YR', 2],
    ['LIC-MX64-SEC-3YR', 1],
  ]);
});

test('descriptive Catalyst email becomes five exact quantity-two rows and routes the AO optic away from eCommerce', async () => {
  const body = [
    'Could I get another quote for the following:',
    '2-Cisco Meraki Catalyst 9300L switch (C9300L-48P-4X-M)',
    '2-(PWR-C1-715WAC-P-M) power supplies',
    '2-(LIC-C9300-48E-3Y) licenses for the switches',
    '2-Cisco Meraki stacking cable kit (C9300L-STAK-KIT2-M)',
    '2-SFP + XCVR CISCO MA-SFP-10GB-SR COMP TAA (MA-SFP-10GB-SR-AO)',
  ].join('\n');
  const result = await runIntakePipeline(body);

  assert.deepEqual(result.intake.lines.map(({ sku, qty, status }) => ({ sku, qty, status })), [
    { sku: 'C9300L-48P-4X-M', qty: 2, status: 'resolved' },
    { sku: 'PWR-C1-715WAC-P-M', qty: 2, status: 'resolved' },
    { sku: 'LIC-C9300-48E-3Y', qty: 2, status: 'resolved' },
    { sku: 'C9300L-STAK-KIT2-M', qty: 2, status: 'resolved' },
    { sku: 'MA-SFP-10GB-SR-AO', qty: 2, status: 'resolved' },
  ]);
  assert.doesNotMatch(result.skuText, /\n2 MA-SFP-10GB-SR\n/);
  assert.equal(result.built?.compositionBlocked, true);
  assert.match(result.built?.message || '', /available through Zoho only/i);
  assert.equal(result.options.length, 0, 'the Zoho-only AO optic must never publish an eCommerce URL');

  const ecommResult = await runIntakePipeline(body.replaceAll('MA-SFP-10GB-SR-AO', 'MA-SFP-10GB-SR'));
  assert.equal(ecommResult.ok, true, ecommResult.verified?.error || ecommResult.built?.message);
  for (const option of licensedOptions(ecommResult)) {
    const term = optionTerm(option.url);
    const cart = cartOf(option.url);
    assert.equal(cart.get('C9300L-48P-4X-M'), 2);
    assert.equal(cart.get(`LIC-C9300-48E-${term}Y`), 2, 'explicit Catalyst licence is counted once');
    assert.equal(cart.get('PWR-C1-715WAC-P-M'), 2);
    assert.equal(cart.get('C9300L-STAK-KIT2-M'), 2);
    assert.equal(cart.get('MA-SFP-10GB-SR'), 2);
    assert.equal([...cart.keys()].some((sku) => sku.startsWith('LIC-C9300L-STAK')), false);
  }
});

test('intake card visibly labels row tiers and gates unresolved rows', () => {
  const cardStart = CHAT_SOURCE.indexOf('function EmailQuoteIntakeCard(');
  const cardEnd = CHAT_SOURCE.indexOf('function OneshotZohoLookup(', cardStart);
  const card = CHAT_SOURCE.slice(cardStart, cardEnd);
  assert.match(card, /lines\.every\(\(l\) => l\.status === 'resolved'\)/);
  assert.match(card, /disabled=\{!allResolved \|\| busy\}/);
  assert.match(card, /not in the quoting catalog/);
  assert.match(card, /needs an exact catalog variant; it was not dropped/);
  assert.match(card, /quoteIntakeTierLabel\(l\.tier\)/);
  assert.match(card, /<b>\{l\.sku \|\| l\.family\}<\/b>/);
});
