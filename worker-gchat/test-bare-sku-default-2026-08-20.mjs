/**
 * Non -HW is the default wherever both forms exist (2026-08-20).
 *
 * Chris's rule. Meraki has been migrating product codes off the -HW suffix.
 * When a family moves, the OLD -HW code keeps a separate Zoho product record
 * and loses its storefront row, so the nightly price refresh returns early for
 * that key and its price and list freeze at whatever they last held. Silently,
 * and forever.
 *
 * What it had already cost, both measured against live data on 2026-08-20:
 *   MS130, 12 switches   quoting up to $527 ABOVE the website
 *   MX,     10 appliances quoting 28% BELOW the website, to $7,419 a unit
 *
 * The rule is driven by the CATALOG, not a hardcoded family list: a family that
 * migrates next month is handled the day its bare entry lands. It runs as a
 * post-pass over the family rules, so it can only ever turn an -HW answer into
 * a bare one the catalog already knows.
 *
 * Both workers implement it identically and are checked against each other
 * here, because they share the price KV and must agree on what a SKU means.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(WORKER, 'x.cjs'));
const SOURCE = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');
const PRICES = require(path.join(WORKER, 'src/data/prices.json')).prices;
const WEBEX = path.join(WORKER, '../worker-webex-recovered/src/index.js');

function resolverFrom(src, prices) {
  const a = src.indexOf('function applySuffix(sku) {');
  const fam = src.indexOf('function applySuffixFamilyRules(sku) {');
  const end = src.indexOf('\n}', src.indexOf('return upper;', fam)) + 2;
  return new Function('__name', 'prices', `${src.slice(a, end)}\nreturn applySuffix;`)(() => {}, prices);
}
const applySuffix = resolverFrom(SOURCE, PRICES);

/** Verified live 2026-08-20: storefront carries the BARE code, no -HW row. */
const MIGRATED = [
  'MS130-8', 'MS130-8P', 'MS130-8P-I', 'MS130-8X', 'MS130-12X', 'MS130-24',
  'MS130-24P', 'MS130-24X', 'MS130-48', 'MS130-48P', 'MS130-48X', 'MS130R-8P',
  'MX67', 'MX67W', 'MX68', 'MX68W', 'MX75', 'MX85', 'MX95', 'MX105', 'MX250', 'MX450',
  'MV2', 'MV22', 'MV32', 'MV53X', 'MV72', 'MV72X', 'MV84X',
];

/** Verified live 2026-08-20: storefront still carries the -HW code only. */
const STILL_HW = [
  'MR44', 'MR46', 'MR46E', 'MR52', 'MR57', 'MR76', 'MR78', 'MR86', 'MR36', 'MR36H', 'MR28',
  'MG41', 'MG41E', 'MG51', 'MG51E', 'MG52', 'MG52E',
  'MT10', 'MT11', 'MT12', 'MT14', 'MT15', 'MT20', 'MT30', 'MT40',
  'MV13', 'MV13M', 'MV23M', 'MV23X', 'MV33', 'MV33M', 'MV63', 'MV63M', 'MV63X',
  'MV73M', 'MV73X', 'MV93', 'MV93M', 'MV93X',
  'Z4',
  'MS120-48', 'MS125-24P', 'MS210-24P', 'MS225-48LP', 'MS250-24P',
  'MS350-24X', 'MS390-48UX', 'MS425-16', 'MS450-12',
];

test('a migrated code resolves BARE from either input form', () => {
  for (const sku of MIGRATED) {
    assert.equal(applySuffix(sku), sku, `${sku} must stay bare`);
    assert.equal(applySuffix(`${sku}-HW`), sku, `${sku}-HW must reduce to ${sku}`);
    assert.equal(applySuffix(sku.toLowerCase()), sku, 'case must not matter');
  }
});

test('a code the storefront still sells as -HW KEEPS -HW', () => {
  // The rule is not "strip -HW everywhere". MR, MG, MT, most MV and the EOL
  // switch families have no bare storefront row; stripping would strand them.
  for (const sku of STILL_HW) {
    assert.equal(applySuffix(sku), `${sku}-HW`, `${sku} must keep -HW`);
    assert.equal(applySuffix(`${sku}-HW`), `${sku}-HW`, 'already-suffixed stays put');
  }
});

test('the rule is gated on the catalog, so it cannot invent a bare code', () => {
  // Every migration must land on a code the catalog actually knows, otherwise
  // the SKU becomes unresolvable rather than merely mispriced.
  for (const sku of MIGRATED) {
    assert.ok(PRICES[sku], `${sku} must exist in the catalog`);
    assert.ok(PRICES[sku].price > 0, `${sku} needs an ecomm price`);
    assert.ok(PRICES[sku].list > 0, `${sku} needs a list price`);
    assert.match(String(PRICES[sku].zoho_product_id), /^\d{15,}$/, `${sku} needs a product id`);
  }
  // A bare code with no catalog entry must NOT be produced.
  assert.equal(applySuffix('MS999-48'), 'MS999-48-HW');
  assert.equal(applySuffix('MR99'), 'MR99-HW');
});

test('regional and non -HW suffixes are untouched', () => {
  // "-HW-NA" does not end in "-HW", so the post-pass must not touch it. Some
  // catalog codes ALSO used to pick up a second suffix (Z3C-HW-NA-HW); those
  // now collapse correctly.
  assert.equal(applySuffix('MX67C'), 'MX67C-HW-NA');
  assert.equal(applySuffix('MX68CW'), 'MX68CW-HW-NA');
  assert.equal(applySuffix('Z3C-HW-NA'), 'Z3C-HW-NA', 'no double suffix');
  assert.equal(applySuffix('MG21-HW-NA'), 'MG21-HW-NA');
  assert.equal(applySuffix('CW9164I'), 'CW9164I-MR');
  assert.equal(applySuffix('CW9172H'), 'CW9172H-RTG');
  assert.equal(applySuffix('C9300-48P-M'), 'C9300-48P-M');
  assert.equal(applySuffix('MS150-48LP-4X'), 'MS150-48LP-4X');
  assert.equal(applySuffix('LIC-ENT-1YR'), 'LIC-ENT-1YR');
  assert.equal(applySuffix('MA-PWR-30W'), 'MA-PWR-30W');
});

test('migrated codes carry the LIVE storefront price, not the frozen one', () => {
  // The numbers that were wrong, and what they are now. Verified against
  // WooProducts Stratus_Price and Zoho Products Unit_Price on 2026-08-20.
  const EXPECTED = {
    'MS130-48X': [4947, 10625.63], 'MS130-24X': [3318, 7126.95], 'MS130R-8P': [3049, 4534.04],
    'MX68': [820, 1759.18], 'MX68W': [1295, 2475.21], 'MX75': [1322, 2839.03],
    'MX85': [2967, 4411.20], 'MX95': [5939, 8831.22], 'MX105': [8910, 13251.24],
    'MX250': [13191, 19616.07], 'MX450': [26386, 39240.97],
    'MX67': [572, 1228.77], 'MX67W': [994, 1900.61], 'MV22': [908, 1349.89],
    // These bare entries already existed but had gone stale, so the rule would
    // have migrated onto a wrong price. Found by this test, 2026-08-20.
    'MV2': [276, 538.51], 'MV53X': [2764, 4109.89], 'MV84X': [8002, 11900.10],
    'MV32': [769, 1142.05], 'MV72': [1048, 1557.72], 'MV72X': [1187, 1765.55],
  };
  for (const [sku, [price, list]] of Object.entries(EXPECTED)) {
    assert.equal(PRICES[sku].price, price, `${sku} ecomm`);
    assert.equal(PRICES[sku].list, list, `${sku} list`);
  }
  // The two reported symptoms, end to end.
  assert.equal(PRICES['MS130-48X'].price * 6, 29682);
  // MX75 was quoting 951 against a website price of 1322.
  assert.notEqual(PRICES['MX75'].price, 951);
});

test('every orphaned -HW twin is superseded and mirrors its live twin', () => {
  for (const sku of MIGRATED) {
    const twin = PRICES[`${sku}-HW`];
    if (!twin) continue;
    assert.equal(twin._superseded_by, sku, `${sku}-HW must be marked superseded`);
    assert.equal(twin.price, PRICES[sku].price, `${sku}-HW must mirror the live price`);
    assert.equal(twin.list, PRICES[sku].list);
    assert.equal(twin.zoho_product_id, PRICES[sku].zoho_product_id,
      'and point at the product that actually sells');
  }
  // A superseded key must beat a stale KV entry: its KV value can never
  // refresh, because the storefront has no row under that code.
  const proxy = SOURCE.slice(SOURCE.indexOf('const prices = new Proxy('), SOURCE.indexOf('function canonicalDirectMsLicenseSku('));
  assert.match(proxy, /_superseded_by/);
  assert.ok(proxy.indexOf('_superseded_by') < proxy.indexOf('const live = livePrices[prop]'),
    'the supersede check must run before the KV value is taken');
});

test('the Webex worker resolves every catalog SKU identically', () => {
  // Both workers read the SAME price KV, so a SKU that means different things
  // in each is a split brain: an ecomm quote and a CRM quote for the same
  // request would price differently.
  const webexSrc = fs.readFileSync(WEBEX, 'utf8');
  assert.match(webexSrc, /function applySuffixFamilyRules\(sku\)/, 'Webex must carry the same post-pass');
  assert.match(webexSrc, /Bare-code migrations/, 'Webex must carry the migration overrides');
  assert.match(webexSrc, /_superseded_by/, 'Webex must honour superseded keys over KV');

  // Build the Webex resolver over its own catalog plus its override block.
  const ps = webexSrc.indexOf('var prices_default = ');
  const objStart = webexSrc.indexOf('{', ps);
  let depth = 0, end = -1;
  for (let i = objStart; i < webexSrc.length; i++) {
    if (webexSrc[i] === '{') depth++;
    else if (webexSrc[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  const catalog = (0, eval)(`(${webexSrc.slice(objStart, end)})`).prices;
  const o = webexSrc.indexOf('Object.assign(staticPrices, {');
  const os = webexSrc.indexOf('{', o + 20);
  let d2 = 0, oe = -1;
  for (let i = os; i < webexSrc.length; i++) {
    if (webexSrc[i] === '{') d2++;
    else if (webexSrc[i] === '}') { d2--; if (d2 === 0) { oe = i + 1; break; } }
  }
  const webexPrices = Object.assign({}, catalog, (0, eval)(`(${webexSrc.slice(os, oe)})`));
  const webexResolve = resolverFrom(webexSrc, webexPrices);

  const disagreements = [];
  for (const sku of [...MIGRATED, ...STILL_HW, 'MX67C', 'Z3C-HW-NA', 'CW9164I', 'MS150-48LP-4X']) {
    if (applySuffix(sku) !== webexResolve(sku)) {
      disagreements.push(`${sku}: gchat ${applySuffix(sku)} vs webex ${webexResolve(sku)}`);
    }
  }
  assert.deepEqual(disagreements, [], `the two workers must agree:\n${disagreements.join('\n')}`);

  // And the migrated SKUs must carry the same money in both.
  for (const sku of MIGRATED) {
    assert.equal(webexPrices[sku].price, PRICES[sku].price, `${sku} ecomm must match gchat`);
    assert.equal(webexPrices[sku].list, PRICES[sku].list, `${sku} list must match gchat`);
  }
});
