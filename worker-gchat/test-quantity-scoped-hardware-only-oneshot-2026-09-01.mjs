// Quantity-scoped "None (hardware only)" in the one-shot plan.
//
// The editor lets one SKU be split into a bare spare and licensed production
// units (MX67 x1 None + MX67 x2 Advanced Security). The verified order URL
// aggregates that to "MX67 x3, LIC-MX67-SEC-3YR x2". The whole-SKU
// hardware_only_skus contract could not describe it: naming MX67 silenced the
// licence for all three units, and omitting it demanded three licences.
//
// hardware_only_lines = [{ sku, qty }] carries the bare quantity itself. These
// tests pin the expansion, the fingerprint binding, and that the whole-SKU
// contract and every fail-closed guard behave exactly as before.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(WORKER, 'x.cjs'));

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) { let d = 0, s = false, e = i; for (let k = i; k < src.length; k++) { if (src[k] === '{') { d++; s = true; } if (src[k] === '}') { d--; if (s && d === 0) { e = k + 1; break; } } } src = src.slice(0, i) + src.slice(e + 1); }
  src += `\nmodule.exports={expandOneshotRequestedProducts,oneshotProductRequestDescriptor,aggregateOneshotLines,buildStratusUrl};\n`;
  const t = path.join(WORKER, `.tmp-hwlines-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

const plan = (skus, extra = {}) => w.expandOneshotRequestedProducts({
  skus,
  license_term: '3',
  hardware_only: false,
  include_licenses: true,
  ha_mode: 'standard',
  ...extra,
});
const codes = (r) => [...new Set((r.blockers || []).map((b) => b?.code))];
const line = (r, sku) => (r.lines || []).find((l) => l.sku.toUpperCase() === sku);

// The URL-parsed cart for "MX67 x1 None + MX67 x2 SEC" after the editor commit.
const SPLIT_URL_CART = [
  { sku: 'MX67-HW', qty: 3 },
  { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
];

test('a split SKU plans with its explicit companion covering only the licensed units', () => {
  const r = plan(SPLIT_URL_CART, { hardware_only_lines: [{ sku: 'MX67', qty: 1 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'MX67-HW').qty, 3);
  assert.equal(line(r, 'LIC-MX67-SEC-3YR').qty, 2);
  assert.equal((r.lines || []).filter((l) => /^LIC-/.test(l.sku)).length, 1);
});

test('without the bare quantity the same cart is STILL refused as under-licensed', () => {
  const r = plan(SPLIT_URL_CART);
  assert.equal(r.success, false);
  assert.ok(codes(r).includes('explicit_license_quantity_conflict'));
});

test('the whole-SKU contract still silences every unit and rejects the leftover licence', () => {
  // Naming MX67 in hardware_only_skus means ALL THREE are bare, so an explicit
  // LIC-MX67 line binds to nothing and the wrong-model guard is not involved;
  // the cart must not silently accept two licences for zero licensed units.
  const r = plan(SPLIT_URL_CART, { hardware_only_skus: ['MX67'] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'LIC-MX67-SEC-3YR').qty, 2, 'explicit licence lines are passed through as typed');
  const before = plan([{ sku: 'MX67-HW', qty: 3 }], { hardware_only_skus: ['MX67'] });
  assert.equal(before.success, true);
  assert.ok(!(before.lines || []).some((l) => /^LIC-/.test(l.sku)), 'a wholly bare SKU derives no licence');
});

test('a derived companion is produced only for the licensed remainder', () => {
  // No explicit licence typed: the Worker derives it for 3 - 1 = 2 units.
  const r = plan([{ sku: 'MX67-HW', qty: 3 }], { hardware_only_lines: [{ sku: 'MX67', qty: 1 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  const licence = (r.lines || []).find((l) => /^LIC-MX67-SEC-3YR?$/i.test(l.sku));
  assert.ok(licence, `expected a derived MX67 SEC licence, got ${(r.lines || []).map((l) => l.sku).join(', ')}`);
  assert.equal(licence.qty, 2);
});

test('a bare quantity covering the whole line derives no licence', () => {
  const r = plan([{ sku: 'MX67-HW', qty: 3 }], { hardware_only_lines: [{ sku: 'MX67', qty: 3 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.ok(!(r.lines || []).some((l) => /^LIC-/.test(l.sku)));
});

test('a bare quantity larger than the cart line cannot remove licences from other SKUs', () => {
  const r = plan([
    { sku: 'MX67-HW', qty: 1 },
    { sku: 'MX75', qty: 2 },
  ], { hardware_only_lines: [{ sku: 'MX67', qty: 5 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.ok(!(r.lines || []).some((l) => /^LIC-MX67/.test(l.sku)));
  const mx75 = (r.lines || []).find((l) => /^LIC-MX75-SEC-3YR?$/i.test(l.sku));
  assert.equal(mx75?.qty, 2);
});

test('model-agnostic AP coverage subtracts only the bare units of a split AP line', () => {
  // 6 MR44, 2 of them bare, plus 6 CW9164I: LIC-ENT covers 4 + 6 = 10.
  const r = plan([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-3YR', qty: 10 },
  ], { hardware_only_lines: [{ sku: 'MR44', qty: 2 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 10);
  const wrong = plan([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-3YR', qty: 12 },
  ], { hardware_only_lines: [{ sku: 'MR44', qty: 2 }] });
  assert.equal(wrong.success, false);
  assert.ok(codes(wrong).includes('explicit_license_quantity_conflict'));
});

test('the bare CW stem widening applies to the quantity budget too', () => {
  const r = plan([
    { sku: 'CW9164I-MR', qty: 4 },
    { sku: 'LIC-ENT-3YR', qty: 3 },
  ], { hardware_only_lines: [{ sku: 'CW9164', qty: 1 }] });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 3);
});

test('a paired companion and an additive standalone copy of the same licence coexist', () => {
  // Editor: MX95 x2 (paired) + a reviewed standalone LIC-MX95-SEC-3YR x1 renewal.
  // The URL line "LIC-MX95-SEC-3YR x3" is split back into intent-bearing lines.
  const r = plan([
    { sku: 'MX95-HW', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 1, licenseIntent: 'standalone' },
  ]);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  // aggregateOneshotLines remains the single place the final quote lines merge.
  assert.equal(line(r, 'LIC-MX95-SEC-3YR').qty, 3);
  assert.equal((r.lines || []).filter((l) => l.sku === 'LIC-MX95-SEC-3YR').length, 1);
  const unsplit = plan([
    { sku: 'MX95-HW', qty: 2 },
    { sku: 'LIC-MX95-SEC-3YR', qty: 3 },
  ]);
  assert.equal(unsplit.success, false, 'an unsplit aggregate is still read as device coverage and refused');
  assert.ok(codes(unsplit).includes('explicit_license_quantity_conflict'));
});

test('malformed bare lines are dropped and can only add licences, never remove one', () => {
  const r = plan([{ sku: 'MX67-HW', qty: 2 }], {
    hardware_only_lines: [{ sku: 'MX67', qty: 'two' }, { sku: '', qty: 1 }, { sku: 'LIC-MX67-SEC-3YR', qty: 1 }, null],
  });
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  const licence = (r.lines || []).find((l) => /^LIC-MX67-SEC-3YR?$/i.test(l.sku));
  assert.equal(licence?.qty, 2);
});

test('the bare quantities are bound into the review fingerprint', () => {
  const skus = SPLIT_URL_CART;
  const withLines = w.oneshotProductRequestDescriptor({ skus, hardware_only_lines: [{ sku: 'MX67', qty: 1 }] });
  const without = w.oneshotProductRequestDescriptor({ skus });
  assert.notDeepEqual(withLines, without);
  assert.deepEqual(withLines.hardware_only_lines, [{ sku: 'MX67', qty: 1 }]);
  assert.equal('hardware_only_lines' in without, false, 'unused feature leaves existing fingerprints untouched');
  // Quantity is part of the identity; casing, -HW suffix, order and split entries are not.
  const a = w.oneshotProductRequestDescriptor({ skus, hardware_only_lines: [{ sku: 'mx67-hw', qty: 1 }, { sku: 'MR44', qty: 2 }] });
  const b = w.oneshotProductRequestDescriptor({ skus, hardware_only_lines: [{ sku: 'MR44', qty: 1 }, { sku: 'MR44', qty: 1 }, { sku: 'MX67', qty: 1 }] });
  assert.deepEqual(a, b);
  const c = w.oneshotProductRequestDescriptor({ skus, hardware_only_lines: [{ sku: 'MX67', qty: 2 }] });
  assert.notDeepEqual(withLines, c);
  // The legacy list is a distinct field with its unchanged shape.
  const legacy = w.oneshotProductRequestDescriptor({ skus, hardware_only_skus: ['MX67'] });
  assert.deepEqual(legacy.hardware_only_skus, ['MX67']);
  assert.equal('hardware_only_lines' in legacy, false);
});

test('the authoritative aggregation functions are unchanged by the quantity-scoped path', () => {
  const merged = w.aggregateOneshotLines([
    { sku: 'MX67-HW', qty: 1 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 2 },
    { sku: 'MX67-HW', qty: 2 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
  ]);
  assert.deepEqual(merged, [
    { sku: 'MX67-HW', qty: 3 },
    { sku: 'LIC-MX67-SEC-3YR', qty: 3 },
  ]);
  // buildStratusUrl still emits the storefront's canonical model token (no -HW).
  const url = w.buildStratusUrl([{ sku: 'MX67-HW', qty: 3 }, { sku: 'LIC-MX67-SEC-3YR', qty: 2 }]);
  assert.equal(String(url), 'https://stratusinfosystems.com/order/?item=MX67,LIC-MX67-SEC-3YR&qty=3,2');
});
