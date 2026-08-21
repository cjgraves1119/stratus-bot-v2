// Three defects from a 2026-08-21 report on the Chrome extension, all on
// the SAME request: a Gmail thread asking for "LIC-ENT-3YR (x2)" and
// "LIC-MX64-SEC-3YR (x1)".
//
// 1. HTTP 500 ON THE EOL LICENCE REFRESH PATH. _buildRefreshItems() referenced
//    `entry.ref.requestedTier`, but `entry` is not in scope there — it is the
//    hwMap value from a DIFFERENT loop further down. The reference threw
//    ReferenceError, which the /api/ handler turned into a 500. It only fired
//    when a direct licence list contained an EOL model, which is why it looked
//    intermittent: MX64 is EOL (→ MX67), so this exact request always 500'd.
//    worker/src/index.js and worker-webex-recovered both pass plain
//    `requestedTier` here; only worker-gchat had drifted.
//
// 2. "NOT IN THE QUOTING CATALOG" ON EVERY LICENCE-ONLY EMAIL. A licence-only
//    request parses into parsed.directLicenseList, never parsed.items.
//    buildOneshotIntake only consumed parsed.items, so the literal path found
//    nothing and fell through to LLM family extraction, whose matrix is
//    ONESHOT_INTAKE_FAMILIES = ['DUO']. "LIC-ENT-3YR" came back as family "ENT",
//    missed the DUO-only matrix, and rendered as unsupported — while the SKU sat
//    in prices.json the whole time with a Zoho product id.
//
// 3. SILENTLY DROPPED QUANTITIES. extractEmbeddedDirectLicenseList understood
//    "x2", "qty 2", ":2", "-2" and bare "(2)" — but not "(x2)", the shape Cisco
//    reps actually write. Every such line fell back to qty 1. This is the
//    dangerous one: it does not error, it just quotes the wrong number. Fixing
//    (2) without fixing (3) would have turned a loud failure into a quiet one.
//
// Extracts the REAL functions from src/index.js, no mocks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function extractRealFunctions() {
  const here = __dirname;
  const escPath = (rel) => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `
module.exports = {
  parseMessage,
  buildQuoteResponse,
  extractEmbeddedDirectLicenseList,
  buildOneshotIntake,
  resolveCachedProduct,
  validateSku,
};
`;
  const tmpPath = path.join(here, `.tmp-extract-lic-renewal-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const mod = extractRealFunctions();
const flow = await import(path.join(__dirname, '../chrome-extension/src/lib/email-quote-flow.mjs'));

// Synthetic equivalent of the reported Gmail request. Blank lines between the
// SKUs are load-bearing: they are what Gmail produces, and they are why the
// multi-line CSV branch does not claim this text.
const REPORTED_EMAIL = `Please quote this Meraki license renewal. The SKUs are below.

LIC-ENT-3YR (x2)

LIC-MX64-SEC-3YR (x1)

Thank you.`;

const intakeOf = (body, subject = 'Re: License Quote Request') => mod.buildOneshotIntake(
  { source: 'ext-email-ecomm-intake', subject, body_text: body, participants: [] },
  {},
  'sales@example.com',
  async () => { throw new Error('extractor must NOT run for a literal licence list'); },
);

// ── 1. The 500: EOL refresh on a direct licence list ────────────────────

// buildQuoteResponse returns { message, needsLlm }; the /api/quote handler is
// what later splits the message into quoteUrls.
const quoteMessage = (text) => {
  const res = mod.buildQuoteResponse(mod.parseMessage(text));
  assert.ok(res && typeof res.message === 'string', 'buildQuoteResponse returned no message');
  return res.message;
};
const urlsIn = (message) => message.match(/https:\/\/\S+/g) || [];
const cartOf = (rawUrl) => {
  const url = new URL(rawUrl);
  const skus = String(url.searchParams.get('item') || '').split(',').filter(Boolean);
  const qtys = String(url.searchParams.get('qty') || '').split(',').map(Number);
  return new Map(skus.map((sku, index) => [sku.toUpperCase(), qtys[index]]));
};

test('an EOL licence list builds a refresh option instead of throwing', () => {
  // MX64 is EOL, so this drives _buildRefreshItems — the branch that threw
  // ReferenceError: entry is not defined, which surfaced as HTTP 500.
  const message = quoteMessage(REPORTED_EMAIL);
  assert.match(message, /MX64 \(EOL\) → Replacement: MX67/);
  assert.match(message, /Option 2 - Hardware Refresh/);
  assert.ok(urlsIn(message).some((u) => /MX67/.test(u)), 'no MX67 hardware-refresh URL built');
});

test('the refresh option still produces a licence for the replacement', () => {
  const refresh = urlsIn(quoteMessage(REPORTED_EMAIL)).filter((u) => /MX67/.test(u));
  assert.ok(refresh.length > 0, 'expected hardware-refresh URLs');
  for (const u of refresh) {
    assert.match(u, /LIC-MX67-[A-Z]+-\dYR?/, `refresh URL carries no MX67 licence: ${u}`);
  }
});

test('an EOL MX refresh preserves the explicit license tier for every option', () => {
  for (const { tier, suffix } of [
    { tier: 'ENT', suffix: 'YR' },
    { tier: 'SEC', suffix: 'YR' },
    { tier: 'SDW', suffix: 'Y' },
  ]) {
    const refresh = urlsIn(quoteMessage(
      `renew LIC-ENT-3YR x2 and LIC-MX64-${tier}-3${suffix} x1`,
    )).filter((url) => /MX67/.test(url));
    assert.equal(refresh.length, 3, `${tier} did not produce 1/3/5-year refresh options`);
    for (const [index, term] of [1, 3, 5].entries()) {
      assert.match(refresh[index], new RegExp(`LIC-MX67-${tier}-${term}${suffix}`));
      assert.match(refresh[index], new RegExp(`LIC-ENT-${term}YR`), 'unrelated renewal was dropped');
      assert.doesNotMatch(
        refresh[index],
        new RegExp(`LIC-MX67-(?!${tier}-)(?:ENT|SEC|SDW)-`),
        `refresh silently changed ${tier}: ${refresh[index]}`,
      );
    }
  }
});

test('two EOL device rows keep their own independent tiers', () => {
  const refresh = urlsIn(quoteMessage(
    'renew LIC-MX64-ENT-3YR x2 and LIC-MX64W-SEC-3YR x1',
  )).filter((url) => /MX67/.test(url));
  assert.equal(refresh.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    assert.match(refresh[index], new RegExp(`LIC-MX67-ENT-${term}YR`));
    assert.match(refresh[index], new RegExp(`LIC-MX67W-SEC-${term}YR`));
  }
});

test('an unknown EOL device-license tier blocks instead of defaulting to SEC', () => {
  const result = mod.buildQuoteResponse({
    directLicenseList: [{ sku: 'LIC-MX64-NOPE-3YR', qty: 1 }],
    requestedTerm: null,
    requestedTier: null,
    modifiers: {},
  });
  assert.equal(result.compositionBlocked, true);
  assert.match(result.message, /does not contain a supported replacement license tier/);
  assert.doesNotMatch(result.message, /stratusinfosystems\.com\/order/);
  assert.doesNotMatch(result.message, /LIC-MX67-SEC-/);
});

test('a licence list with no EOL model is unaffected', () => {
  const message = quoteMessage('quote LIC-ENT-3YR x2 and LIC-MX95-SEC-3Y x1');
  assert.ok(urlsIn(message).length > 0, 'no quote URLs produced');
  assert.doesNotMatch(message, /Hardware Refresh/, 'invented a refresh option for a non-EOL cart');
  assert.doesNotMatch(message, /End of Life/, 'invented an EOL warning for a current cart');
});

// ── 1b. Mixed hardware + explicit companion on the parsed.items EOL path ──

test('an exact explicit EOL MX companion is total once, then maps to the replacement tier', () => {
  for (const tier of ['ENT', 'SEC']) {
    const message = quoteMessage(`quote 1 MX64 ${tier} and 1 LIC-MX64-${tier}-3YR`);
    const urls = urlsIn(message);
    const asIs = urls.filter((url) => cartOf(url).has(`LIC-MX64-${tier}-${url.includes('-1YR') ? '1YR' : url.includes('-5YR') ? '5YR' : '3YR'}`));
    const refresh = urls.filter((url) => cartOf(url).has('MX67'));
    assert.equal(asIs.length, 3, `${tier} as-is options missing`);
    assert.equal(refresh.length, 3, `${tier} refresh options missing`);
    for (const [index, term] of [1, 3, 5].entries()) {
      const asIsCart = cartOf(asIs[index]);
      assert.equal(asIsCart.get(`LIC-MX64-${tier}-${term}YR`), 1, `${tier} old companion duplicated`);
      const refreshCart = cartOf(refresh[index]);
      assert.equal(refreshCart.get('MX67'), 1);
      assert.equal(refreshCart.get(`LIC-MX67-${tier}-${term}YR`), 1, `${tier} replacement companion wrong`);
      assert.equal(refreshCart.has(`LIC-MX64-${tier}-${term}YR`), false, 'obsolete license leaked into refresh');
    }
  }
});

test('under- and over-sized explicit EOL companions fail closed', () => {
  for (const text of [
    'quote 2 MX64 enterprise and 1 LIC-MX64-ENT-3YR',
    'quote 1 MX64 enterprise and 2 LIC-MX64-ENT-3YR',
  ]) {
    const result = mod.buildQuoteResponse(mod.parseMessage(text));
    assert.equal(result.compositionBlocked, true, text);
    assert.match(result.message, /does not cover the matching hardware quantity/);
    assert.equal(urlsIn(result.message).length, 0);
  }
});

test('affirmative EOL HA uses the reviewed 2:1 license total; negated or historical HA blocks', () => {
  const affirmative = mod.buildQuoteResponse(mod.parseMessage(
    'quote 2 MX64 enterprise and 1 LIC-MX64-ENT-3YR as a warm spare HA pair',
  ));
  assert.notEqual(affirmative.compositionBlocked, true, affirmative.message);
  const refresh = urlsIn(affirmative.message).filter((url) => cartOf(url).has('MX67'));
  assert.equal(refresh.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(refresh[index]);
    assert.equal(cart.get('MX67'), 2);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 1);
    assert.equal(cart.has(`LIC-MX64-ENT-${term}YR`), false);
  }

  for (const text of [
    'quote 2 MX64 enterprise and 1 LIC-MX64-ENT-3YR; do not use HA',
    'quote 2 MX64 enterprise and 1 LIC-MX64-ENT-3YR; the old site used HA but this one is standard',
  ]) {
    const result = mod.buildQuoteResponse(mod.parseMessage(text));
    assert.equal(result.compositionBlocked, true, text);
    assert.equal(urlsIn(result.message).length, 0);
  }
});

test('a row-local EOL tier is not replaced by an unrelated explicit license tier', () => {
  const message = quoteMessage('quote 1 MX64 enterprise and 1 LIC-MX64-SEC-3YR');
  const refresh = urlsIn(message).filter((url) => cartOf(url).has('MX67'));
  assert.equal(refresh.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(refresh[index]);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX64-SEC-${term}YR`), 1, 'unrelated explicit renewal was dropped');
    assert.equal(cart.has(`LIC-MX67-SEC-${term}YR`), false, 'explicit sibling tier retiered EOL hardware');
  }
});

// ── 2. Licence-only intake resolves against prices.json ─────────────────────

test('the reported email resolves both SKUs without calling the extractor', async () => {
  const out = await intakeOf(REPORTED_EMAIL);
  assert.equal(out.success, true, `intake failed: ${out.error} ${out.detail || ''}`);
  assert.equal(out.used_llm, false, 'literal licence list must not reach the LLM');
  assert.deepEqual(
    out.lines.map((l) => ({ sku: l.sku, status: l.status })),
    [
      { sku: 'LIC-ENT-3YR', status: 'resolved' },
      { sku: 'LIC-MX64-SEC-3YR', status: 'resolved' },
    ],
  );
});

test('no resolved line carries a family instead of a SKU', async () => {
  const out = await intakeOf(REPORTED_EMAIL);
  for (const l of out.lines) {
    assert.ok(l.sku, `line resolved to a bare family (${l.family}) with no SKU`);
    assert.notEqual(l.status, 'unsupported', `"${l.sku || l.family}" wrongly marked unsupported`);
  }
});

test('a genuinely unknown LIC SKU is still reported, not silently resolved', async () => {
  const out = await intakeOf('Please quote LIC-NOPE-9YR (x1) and LIC-ALSONOPE-9YR (x1)');
  assert.equal(out.success, true);
  assert.equal(out.lines.length, 2, 'both unknown literals must remain visible for correction');
  // It must not claim these are real products.
  for (const l of out.lines) {
    assert.notEqual(l.status, 'resolved', `invented a resolution for ${l.sku}`);
  }
});

test('mixed hardware + licence carts still go down the items path', () => {
  const parsed = mod.parseMessage('quote 2 MR44 and LIC-ENT-3YR x2');
  // textNamesHardwareModel guards the licence-list branches; the cart must keep
  // its hardware rather than being reduced to a licence-only list.
  const skus = (parsed.items || []).map((i) => String(i.baseSku || i.sku).toUpperCase());
  assert.ok(skus.includes('MR44'), `hardware dropped from mixed cart: ${JSON.stringify(skus)}`);
});

test('mixed Gmail intake resolves explicit LIC rows through the real product catalog', async () => {
  const out = await intakeOf(
    'Please quote 2 LIC-ENT-3YR and 1 MX67 and 1 LIC-MX67-SEC-3YR.',
  );
  assert.equal(out.success, true);
  assert.equal(out.used_llm, false);
  const bySku = new Map(out.lines.map((line) => [line.sku, line]));
  for (const [sku, qty] of [['LIC-ENT-3YR', 2], ['MX67', 1], ['LIC-MX67-SEC-3YR', 1]]) {
    const line = bySku.get(sku);
    assert.ok(line, `${sku} was dropped: ${JSON.stringify(out.lines)}`);
    assert.equal(line.status, 'resolved', `${sku}: ${line.reason || 'not resolved'}`);
    assert.equal(line.qty, qty);
  }
  assert.equal(bySku.get('LIC-ENT-3YR').tier, undefined,
    'explicit licence rows must not carry redundant tier metadata');
  assert.equal(bySku.get('LIC-MX67-SEC-3YR').tier, undefined,
    'explicit licence rows must not carry redundant tier metadata');
});

test('Create Quote preserves mixed same-model tiers from Gmail intake through URL verification', async () => {
  const out = await intakeOf('Please quote 1 MX67 security and 2 MX67 enterprise.');
  assert.equal(out.success, true);
  assert.equal(out.intent.license_tier, null, 'mixed row tiers must not be flattened into a global tier');
  assert.deepEqual(out.lines.map(({ sku, qty, tier, status }) => ({ sku, qty, tier, status })), [
    { sku: 'MX67', qty: 1, tier: 'SEC', status: 'resolved' },
    { sku: 'MX67', qty: 2, tier: 'ENT', status: 'resolved' },
  ]);

  const committed = flow.normalizeQuoteIntakeLines(out.lines);
  assert.deepEqual(committed, [
    { sku: 'MX67', qty: 1, tier: 'SEC' },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
  ]);
  const serialized = flow.quoteSkuTextFromLines(out.lines);
  assert.equal(serialized, '1 MX67 security\n2 MX67 enterprise');

  const parsed = mod.parseMessage(serialized);
  assert.deepEqual(parsed.items.map((line) => ({
    sku: line.baseSku,
    qty: line.qty,
    tier: line.requestedTier,
  })), [
    { sku: 'MX67', qty: 1, tier: 'SEC' },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
  ]);
  const quote = mod.buildQuoteResponse(parsed);
  const options = urlsIn(quote.message).map((url, index) => ({ label: `Option ${index + 1}`, url }));
  const verified = flow.verifyStratusOrderUrlOptions(options, committed, {
    licenseTier: null,
    requireLicensedOption: true,
  });
  assert.equal(verified.ok, true, verified.error);
  assert.equal(verified.urls.length, 3);
  for (const [index, term] of [1, 3, 5].entries()) {
    const cart = cartOf(verified.urls[index].url);
    assert.equal(cart.get('MX67'), 3);
    assert.equal(cart.get(`LIC-MX67-SEC-${term}YR`), 1);
    assert.equal(cart.get(`LIC-MX67-ENT-${term}YR`), 2);
  }
});

// ── 3. Parenthesised quantities ─────────────────────────────────────────────

const qtyOf = (text) => {
  const items = mod.extractEmbeddedDirectLicenseList(text) || [];
  return items.map((i) => `${i.qty}x ${i.sku}`);
};

test('"(x2)" is read as a quantity', () => {
  assert.deepEqual(qtyOf('LIC-ENT-3YR (x2)\nLIC-MX64-SEC-3YR (x1)'),
    ['2x LIC-ENT-3YR', '1x LIC-MX64-SEC-3YR']);
});

test('the reported email carries its real quantities end to end', async () => {
  const out = await intakeOf(REPORTED_EMAIL);
  assert.deepEqual(out.lines.map((l) => `${l.qty}x ${l.sku}`),
    ['2x LIC-ENT-3YR', '1x LIC-MX64-SEC-3YR']);
});

test('bracket and qty-word variants also parse', () => {
  assert.deepEqual(qtyOf('LIC-ENT-3YR [x4]\nLIC-MX95-SEC-3Y [x2]'),
    ['4x LIC-ENT-3YR', '2x LIC-MX95-SEC-3Y']);
  assert.deepEqual(qtyOf('LIC-ENT-3YR (qty 6)\nLIC-MX95-SEC-3Y (qty: 3)'),
    ['6x LIC-ENT-3YR', '3x LIC-MX95-SEC-3Y']);
});

test('a bracketed marker cannot overwrite an explicit leading quantity', () => {
  assert.deepEqual(qtyOf(
    'renewal quote: 250 LIC-ENT-3YR (x1) and 12 LIC-MS120-8-3YR (x1)'),
  ['250x LIC-ENT-3YR', '12x LIC-MS120-8-3YR']);
});

test('every quantity shape that already worked still works', () => {
  assert.deepEqual(qtyOf('quote LIC-ENT-3YR x2 and LIC-MX95-SEC-3Y x1'),
    ['2x LIC-ENT-3YR', '1x LIC-MX95-SEC-3Y']);
  assert.deepEqual(qtyOf('LIC-ENT-3YR (2)\nLIC-MX95-SEC-3Y (1)'),
    ['2x LIC-ENT-3YR', '1x LIC-MX95-SEC-3Y']);
  assert.deepEqual(qtyOf('LIC-ENT-3YR: 5\nLIC-MX95-SEC-3Y: 2'),
    ['5x LIC-ENT-3YR', '2x LIC-MX95-SEC-3Y']);
  assert.deepEqual(qtyOf('quote 3 LIC-ENT-3YR, 2 LIC-MX95-SEC-3Y'),
    ['3x LIC-ENT-3YR', '2x LIC-MX95-SEC-3Y']);
});

test('a bare trailing number is still rejected as a quantity', () => {
  // The original guard: "...LIC-MV-3YR 2024" must not read 2024 as a quantity.
  assert.deepEqual(qtyOf('quote LIC-MV-3YR 2024 and LIC-ENT-3YR 2025'),
    ['1x LIC-MV-3YR', '1x LIC-ENT-3YR']);
});

test('a price is still not mistaken for a quantity', () => {
  assert.deepEqual(qtyOf('quote $500 LIC-ENT-3YR and $900 LIC-MX95-SEC-3Y'),
    ['1x LIC-ENT-3YR', '1x LIC-MX95-SEC-3Y']);
});

test('advisory questions are still not treated as licence lists', () => {
  assert.equal(mod.extractEmbeddedDirectLicenseList(
    'what is the difference between LIC-ENT-3YR (x2) and LIC-MX95-SEC-3Y (x1)?'), null);
});
