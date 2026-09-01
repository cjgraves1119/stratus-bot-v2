// Per-item license tiers (2026-08-18): MX SEC + switch Advanced on one quote.
// Global requestedTier used to win for every item, so mixed carts were impossible.

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
  const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
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
module.exports = { parseMessage, buildQuoteResponse, validateExplicitMxMsQuoteComposition };
`;
  const tmpPath = path.join('/tmp', `.tmp-extract-item-tier-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

const mod = extractRealFunctions();

function licensesFor(parsed, sku) {
  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(quote && !quote.needsLlm, 'must stay deterministic');
  const three = String(quote.message || '').split('\n').find((line) => /3-Year|3 Year|LIC-.*-3Y/i.test(line) && /stratusinfosystems\.com\/order/i.test(line))
    || String(quote.message || '').split('\n').find((line) => /stratusinfosystems\.com\/order/i.test(line));
  return three || quote.message;
}

test('mixed MX SEC + Catalyst Advanced keeps both item licenses', () => {
  const parsed = mod.parseMessage('2 MX67W security\n1 C9200L-24P-4G-M advanced');
  assert.ok(parsed, 'mixed request must parse');
  const mx = (parsed.items || []).find((i) => String(i.baseSku).toUpperCase().startsWith('MX67W'));
  const sw = (parsed.items || []).find((i) => String(i.baseSku).toUpperCase().includes('C9200L'));
  assert.equal(mx?.requestedTier, 'SEC');
  assert.equal(sw?.requestedTier, 'A');
  const message = licensesFor(parsed, 'MX67W');
  assert.match(message, /LIC-MX67W-SEC-/);
  assert.doesNotMatch(message, /LIC-MX67W-ENT-/);
  assert.match(message, /LIC-C9200L-24A-/);
});

test('global security without per-row modifiers still applies to MX', () => {
  const parsed = mod.parseMessage('quote 2 MX105 security');
  assert.ok(parsed);
  const quote = mod.buildQuoteResponse(parsed);
  assert.match(quote.message, /LIC-MX105-SEC-/);
});

function quoteUrls(quote) {
  return [...String(quote?.message || '').matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g)]
    .map((match) => ({ url: match[0] }));
}

test('endpoint composition guard honors a row-local MX SEC tier beside standalone ENT licenses', () => {
  const raw = '2 LIC-ENT-3YR\n1 MX67 security';
  const parsed = mod.parseMessage(raw);
  assert.ok(parsed);
  const mx = parsed.items.find((item) => String(item.baseSku).toUpperCase() === 'MX67');
  assert.equal(mx?.requestedTier, 'SEC');

  const quote = mod.buildQuoteResponse(parsed);
  const check = mod.validateExplicitMxMsQuoteComposition(raw, parsed, quoteUrls(quote), []);
  assert.equal(check.ok, true, `row-local SEC must not be validated as ENT: ${JSON.stringify(check.failures)}`);
});

test('endpoint composition guard honors the inverse row-local MX ENT tier beside standalone SEC licenses', () => {
  const raw = '1 LIC-MX64-SEC-3YR\n1 MX67 enterprise';
  const parsed = mod.parseMessage(raw);
  assert.ok(parsed);
  const mx = parsed.items.find((item) => String(item.baseSku).toUpperCase() === 'MX67');
  assert.equal(mx?.requestedTier, 'ENT');

  const quote = mod.buildQuoteResponse(parsed);
  const check = mod.validateExplicitMxMsQuoteComposition(raw, parsed, quoteUrls(quote), []);
  assert.equal(check.ok, true, `row-local ENT must not be validated as SEC: ${JSON.stringify(check.failures)}`);
});

test('requested-term endpoint guard accepts an exact matching explicit companion total', () => {
  const raw = '1 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year';
  const parsed = mod.parseMessage(raw);
  assert.equal(parsed?.requestedTerm, 3);
  const quote = mod.buildQuoteResponse(parsed);
  assert.equal(quote.compositionBlocked, undefined);
  const check = mod.validateExplicitMxMsQuoteComposition(raw, parsed, quoteUrls(quote), []);
  assert.equal(check.ok, true, JSON.stringify(check.failures));
});

test('requested-term endpoint guard accepts reviewed 2:1 MX HA and rejects it without authorization', () => {
  const haRaw = '2 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year\nuse warm spare HA';
  const haParsed = mod.parseMessage(haRaw);
  assert.equal(haParsed?.haRequested, true);
  const haQuote = mod.buildQuoteResponse(haParsed);
  assert.equal(haQuote.compositionBlocked, undefined, haQuote.message);
  const check = mod.validateExplicitMxMsQuoteComposition(haRaw, haParsed, quoteUrls(haQuote), []);
  assert.equal(check.ok, true, JSON.stringify(check.failures));

  for (const raw of [
    '2 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year',
    '2 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year\ndo not use HA',
    '2 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year\nthe old site used HA but this site is standard',
  ]) {
    const parsed = mod.parseMessage(raw);
    const quote = mod.buildQuoteResponse(parsed);
    assert.equal(parsed?.haRequested, false, raw);
    assert.equal(quote.compositionBlocked, true, raw);
    assert.equal(quote.needsLlm, false, 'a deterministic mismatch must never fall through to AI');
  }
});

test('a different-tier same-model explicit license remains a deliberate additive line', () => {
  const raw = '1 MX67 security\n1 LIC-MX67-ENT-3YR';
  const parsed = mod.parseMessage(raw);
  const quote = mod.buildQuoteResponse(parsed);
  assert.equal(quote.compositionBlocked, undefined, quote.message);
  assert.match(quote.message, /LIC-MX67-SEC-/);
  assert.match(quote.message, /LIC-MX67-ENT-/);
});

test('separate quotes suppress the automatic companion when an exact explicit total is present', () => {
  const raw = 'quote 1 MX67 security and 1 LIC-MX67-SEC-3YR with 3 year licenses in separate quotes';
  const parsed = mod.parseMessage(raw);
  assert.equal(parsed?.requestedTerm, 3);
  assert.equal(parsed?.modifiers?.separateQuotes, true);

  const quote = mod.buildQuoteResponse(parsed);
  assert.equal(quote.compositionBlocked, undefined, quote.message);
  assert.equal(quoteUrls(quote).length, 2, 'hardware and explicit license stay in their requested separate quotes');
  assert.equal((quote.message.match(/LIC-MX67-SEC-3YR/g) || []).length, 2,
    'the explicit SKU appears once in its label and once in its URL, never in the hardware URL');
  const check = mod.validateExplicitMxMsQuoteComposition(raw, parsed, quoteUrls(quote), []);
  assert.equal(check.ok, true, JSON.stringify(check.failures));
});

test('multi-term separate quotes do not reintroduce an automatic companion in any option', () => {
  const raw = 'quote 1 MX67 security and 1 LIC-MX67-SEC-3YR in separate quotes';
  const parsed = mod.parseMessage(raw);
  assert.equal(parsed?.requestedTerm, null);
  assert.equal(parsed?.modifiers?.separateQuotes, true);

  const quote = mod.buildQuoteResponse(parsed);
  assert.equal(quote.compositionBlocked, undefined, quote.message);
  const urls = quoteUrls(quote);
  assert.equal(urls.length, 6, 'two separate quote blocks each retain 1/3/5-year options');
  for (const term of [1, 3, 5]) {
    const sku = `LIC-MX67-SEC-${term}YR`;
    assert.equal(urls.filter((entry) => decodeURIComponent(entry.url).includes(sku)).length, 1,
      `${sku} appears in exactly one option and never as an automatic companion`);
  }
  const check = mod.validateExplicitMxMsQuoteComposition(raw, parsed, urls, []);
  assert.equal(check.ok, true, JSON.stringify(check.failures));
});
