// Two fixes from Chris's 2026-08-19 test of "quote 3 x CW9176 4 mr44 and 2 MX67C".
//
// 1. INLINE QUANTITY SHIFT. The hardware scanner preferred the number AFTER a
//    model over the one before it, unconditionally. Both shapes are real:
//      "MR44 3 MX67C 4"    quantity after each model
//      "3 x MR44 4 MX67C"  quantity before each model
//    In the second shape every model but the last took the NEXT model's number,
//    so "2 x MS130-24 3 x MR44 4 x MX67C" parsed as 3 / 4 / 4 and the whole
//    cart shifted by one position. Chris's 3 CW9176 became 4, and the shared
//    licence line followed it (8 instead of 7).
//
// 2. SHARED AGNOSTIC LICENCE BLOCKED THE ONE-SHOT. A model-agnostic licence
//    covers every access point in the cart as one aggregated line, which is what
//    the quote engine itself emits ("4x CW9176I-RTG, 4x MR44-HW, 8x LIC-ENT").
//    expandOneshotRequestedProducts compared that 8 against each 4 in turn and
//    raised explicit_license_quantity_conflict, so a cart the engine had just
//    built could not be planned. It now checks once per licence, against the
//    total of the hardware that licence covers.
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
  expandOneshotRequestedProducts,
  afterQuantityBelongsToNextModel,
};
`;
  const tmpPath = path.join(here, `.tmp-extract-inline-qty-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const mod = extractRealFunctions();
const cart = (text) => (mod.parseMessage(text)?.items || [])
  .map((i) => `${i.qty}x ${String(i.baseSku || i.sku).toUpperCase()}`);

// ── 1. Inline quantity binding ──────────────────────────────────────────────

test('the reported request keeps all three quantities', () => {
  assert.deepEqual(cart('quote 3 x CW9176 4 mr44 and 2 MX67C'),
    ['3x CW9176', '4x MR44', '2x MX67C']);
});

test('a leading quantity is not overwritten by the next model\'s quantity', () => {
  assert.deepEqual(cart('quote 3 x MR44 9 MX67C'), ['3x MR44', '9x MX67C']);
  assert.deepEqual(cart('quote 7 x MR44 2 MX67C'), ['7x MR44', '2x MX67C']);
  assert.deepEqual(cart('quote 3 MR44 4 MX67C'), ['3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote 3x MR44 4 MX67C'), ['3x MR44', '4x MX67C']);
});

test('three models in the leading-quantity shape do not shift by one', () => {
  assert.deepEqual(cart('quote 2 x MS130-24 3 x MR44 4 x MX67C'),
    ['2x MS130-24', '3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote 5 CW9166I 6 MR46'), ['5x CW9166I', '6x MR46']);
});

test('the trailing-quantity shape still binds to the model in front of it', () => {
  // Regression guard for what the old unconditional preference was protecting.
  assert.deepEqual(cart('quote MR44 3 MX67C 4'), ['3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote MR44 x3 MX67C x4'), ['3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote MR44 3'), ['3x MR44']);
});

test('separators that already worked are unchanged', () => {
  assert.deepEqual(cart('quote 3 x MR44, 4 MX67C'), ['3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote 3 x MR44 and 4 MX67C'), ['3x MR44', '4x MX67C']);
  assert.deepEqual(cart('quote 2 MR44, 3 MS130-24 and 4 MX67C'),
    ['2x MR44', '3x MS130-24', '4x MX67C']);
});

test('a multi-line editor snapshot does not steal the next line\'s quantity', () => {
  assert.deepEqual(cart('2 MX85\n1 MX75'), ['2x MX85', '1x MX75']);
  assert.deepEqual(cart('4 MR44\n2 MX67C'), ['4x MR44', '2x MX67C']);
});

test('a term specifier is never read as a quantity', () => {
  assert.deepEqual(cart('quote 3 MR44 3 year'), ['3x MR44']);
  assert.deepEqual(cart('quote 4 MX67C 5 yr'), ['4x MX67C']);
});

test('afterQuantityBelongsToNextModel only fires with a model straight after', () => {
  assert.equal(mod.afterQuantityBelongsToNextModel(' 4 MX67C', '4'), true);
  assert.equal(mod.afterQuantityBelongsToNextModel(' 4 x MX67C', '4'), true);
  assert.equal(mod.afterQuantityBelongsToNextModel(' 4', '4'), false);
  assert.equal(mod.afterQuantityBelongsToNextModel(' 4 year', '4'), false);
  assert.equal(mod.afterQuantityBelongsToNextModel(' 4 MX67C', ''), false);
});

// ── 2. Shared agnostic licence in the one-shot expander ─────────────────────

const expand = (skus, term = '3') => mod.expandOneshotRequestedProducts({
  skus, license_term: term, include_licenses: true, ha_mode: 'standard',
});
const codesOf = (r) => (r.blockers || []).map((b) => b.code);

test('one aggregated LIC-ENT line covers every access point in the cart', () => {
  // Exactly the cart the engine emits for "3 CW9176, 4 MR44, 2 MX67C" (with the
  // quantities Chris actually asked for): 7 APs share one 7-unit ENT line.
  const r = expand([
    { sku: 'CW9176I-RTG', qty: 3 },
    { sku: 'MR44-HW', qty: 4 },
    { sku: 'LIC-ENT-3YR', qty: 7 },
    { sku: 'MX67C-NA', qty: 2 },
    { sku: 'LIC-MX67C-SEC-3YR', qty: 2 },
  ]);
  assert.equal(r.success, true, `expected success, got ${JSON.stringify(codesOf(r))}`);
  const lines = r.lines.map((l) => `${l.qty}x ${l.sku}`);
  assert.ok(lines.includes('7x LIC-ENT-3YR'), `aggregated licence missing: ${lines.join(', ')}`);
  assert.ok(lines.includes('3x CW9176I-RTG'));
  assert.ok(lines.includes('4x MR44-HW'));
});

test('a model-specific licence is still matched one to one', () => {
  const r = expand([
    { sku: 'C9200L-24P-4G-M', qty: 1 }, { sku: 'LIC-C9200L-24E-3Y', qty: 1 },
    { sku: 'MS150-48LP-4G', qty: 1 }, { sku: 'LIC-MS150-48-3Y', qty: 1 },
    { sku: 'MX67C-NA', qty: 2 }, { sku: 'LIC-MX67C-SEC-3YR', qty: 2 },
  ]);
  assert.equal(r.success, true, `expected success, got ${JSON.stringify(codesOf(r))}`);
});

test('MS130 24-port hardware variants reuse the existing exact-SKU aggregation path', () => {
  const r = expand([
    { sku: 'MS130-24P', qty: 2 },
    { sku: 'MS130-24', qty: 4 },
  ]);
  assert.equal(r.success, true, `expected success, got ${JSON.stringify(codesOf(r))}`);
  assert.deepEqual(
    r.lines.filter((line) => line.sku === 'LIC-MS130-24-3Y'),
    [{ sku: 'LIC-MS130-24-3Y', qty: 6 }],
    'the canonical worker aggregator must emit one standard license line totaling both hardware variants',
  );
});

test('MS130 24-port Advanced variants reuse the same exact-SKU aggregation path', () => {
  const r = expand([
    { sku: 'MS130-24P', qty: 2, tier: 'A' },
    { sku: 'MS130-24', qty: 4, tier: 'A' },
  ]);
  assert.equal(r.success, true, `expected success, got ${JSON.stringify(codesOf(r))}`);
  assert.deepEqual(
    r.lines.filter((line) => line.sku === 'LIC-MS130-24A-3Y'),
    [{ sku: 'LIC-MS130-24A-3Y', qty: 6 }],
    'the canonical worker aggregator must emit one Advanced license line totaling both hardware variants',
  );
});

test('a genuine quantity shortfall on a shared licence still blocks', () => {
  const r = expand([
    { sku: 'CW9176I-RTG', qty: 4 }, { sku: 'MR44-HW', qty: 4 },
    { sku: 'LIC-ENT-3YR', qty: 5 },
  ]);
  assert.equal(r.success, false, 'a 5-unit licence cannot cover 8 access points');
  assert.deepEqual(codesOf(r), ['explicit_license_quantity_conflict']);
  const blocker = r.blockers[0];
  assert.equal(blocker.expected, 8, 'the expected quantity is the total of the covered hardware');
  assert.equal(blocker.received, 5);
  assert.deepEqual(blocker.covers, ['CW9176I-RTG', 'MR44-HW'],
    'the blocker names the hardware the licence had to cover');
});

test('a one-to-one mismatch still blocks and reports once', () => {
  const r = expand([{ sku: 'MX67C-NA', qty: 2 }, { sku: 'LIC-MX67C-SEC-3YR', qty: 3 }]);
  assert.equal(r.success, false);
  assert.deepEqual(codesOf(r), ['explicit_license_quantity_conflict']);
  assert.equal(r.blockers[0].expected, 2);
  assert.equal(r.blockers[0].covers, undefined,
    'a single covered line needs no covers list');
});

test('a licence term that disagrees with the plan still blocks', () => {
  const r = expand([{ sku: 'MX67C-NA', qty: 2 }, { sku: 'LIC-MX67C-SEC-1YR', qty: 2 }], '3');
  assert.equal(r.success, false);
  assert.ok(codesOf(r).includes('explicit_license_term_conflict'));
});

test('a cart with no explicit licence still has them derived', () => {
  const r = expand([
    { sku: 'CW9176I-RTG', qty: 3 }, { sku: 'MR44-HW', qty: 4 }, { sku: 'MX67C-NA', qty: 2 },
  ]);
  assert.equal(r.success, true, `expected success, got ${JSON.stringify(codesOf(r))}`);
  const lines = r.lines.map((l) => `${l.qty}x ${l.sku}`);
  assert.ok(lines.includes('7x LIC-ENT-3YR'),
    `the derived ENT licence must total both AP lines: ${lines.join(', ')}`);
});

// ── 3. The plan must say WHY it refused ─────────────────────────────────────

test('a failed product review reports its blocker codes, not a bare error', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.match(source, /The product review could not sign this cart: \$\{codes\.join\(', '\)\}/,
    'product_review_required must name the blockers that caused it');
  assert.match(source, /blockers: productBlockers,/,
    'the blockers must ride along on the response');
});
