// Per-line "None (hardware only)" must survive into the one-shot plan.
//
// WHY THIS EXISTS. Chris built a quote for 6 CW9164 + 2 MX65 licences + 6 MR44,
// set the MR44 row's tier dropdown to "None (hardware only)", and Create in Zoho
// failed with product_review_required. The quote was CORRECT: LIC-ENT x6 covers
// the 6 CW9164 only, because the MR44s are deliberately bare. LIC-ENT is
// model-agnostic, so the expander's coverage check summed BOTH AP lines and
// demanded 12.
//
// This was an INTERACTION between two fixes that were each correct alone:
// per-line hardware-only (extension) and the shared-agnostic-licence coverage
// check (worker). Neither one's own tests could see it.
//
// The fix forwards the marked rows to the worker. These tests pin BOTH halves:
// the cart now plans, AND an under-licensed cart with nothing forwarded is still
// refused. The second half matters more: the guard must stay fail-closed.

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
  src += `\nmodule.exports={expandOneshotRequestedProducts,oneshotProductRequestDescriptor};\n`;
  const t = path.join(WORKER, `.tmp-hwonly-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

const plan = (skus, hardwareOnlySkus) => w.expandOneshotRequestedProducts({
  skus,
  license_term: '3',
  hardware_only: false,
  include_licenses: true,
  ha_mode: 'standard',
  ...(hardwareOnlySkus === undefined ? {} : { hardware_only_skus: hardwareOnlySkus }),
});
const codes = (r) => [...new Set((r.blockers || []).map((b) => b?.code))];
const line = (r, sku) => (r.lines || []).find((l) => l.sku.toUpperCase() === sku);

// Chris's exact cart, 2026-08-19.
const CHRIS = [
  { sku: 'MR44-HW', qty: 6 },
  { sku: 'CW9164I-MR', qty: 6 },
  { sku: 'LIC-ENT-3YR', qty: 6 },
  { sku: 'LIC-MX65-SEC-3YR', qty: 2 },
];

test('the cart that failed in the product now plans', () => {
  const r = plan(CHRIS, ['MR44']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  // The bare row survives at full quantity and gains no licence.
  assert.equal(line(r, 'MR44-HW').qty, 6);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 6);
  assert.ok(!(r.lines || []).some((l) => /^LIC-ENT/.test(l.sku) && l.qty === 12));
});

test('the same cart with nothing forwarded is STILL refused', () => {
  const r = plan(CHRIS, []);
  assert.equal(r.success, false);
  assert.ok(codes(r).includes('explicit_license_quantity_conflict'));
});

test('a genuinely under-licensed cart is still refused', () => {
  // 12 access points, 9 licences, no row marked bare. This must never pass.
  const r = plan([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-3YR', qty: 9 },
  ], []);
  assert.equal(r.success, false);
  assert.ok(codes(r).includes('explicit_license_quantity_conflict'));
});

test('an omitted field behaves exactly as before', () => {
  const r = plan([
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-3YR', qty: 12 },
    { sku: 'MR44-HW', qty: 6 },
  ], undefined);
  assert.equal(r.success, true);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 12);
});

test('a committed bare CW stem names the variant it resolved to', () => {
  // The rep commits "CW9164"; the engine resolves "CW9164I-MR".
  const r = plan([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-3YR', qty: 6 },
  ], ['CW9164']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 6);
});

test('the stem widening does NOT reach across port variants', () => {
  // MS130-24 marked bare must not silence MS130-48. Handoff item 10.
  const r = plan([
    { sku: 'MS130-24', qty: 2 },
    { sku: 'MS130-48', qty: 3 },
    { sku: 'LIC-MS130-48-3Y', qty: 3 },
  ], ['MS130-24']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'MS130-24').qty, 2);
  // MS130-24 stayed bare: it must not have acquired its own licence.
  assert.ok(!(r.lines || []).some((l) => /^LIC-MS130-24/.test(l.sku)));
});

test('two lines of the SAME family, one bare', () => {
  const r = plan([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'MR46-HW', qty: 4 },
    { sku: 'LIC-ENT-3YR', qty: 6 },
  ], ['MR46']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.equal(line(r, 'LIC-ENT-3YR').qty, 6);
});

test('a bare row never acquires an automatic licence', () => {
  // No explicit LIC-ENT at all: the bare row must still get nothing.
  const r = plan([{ sku: 'MR44-HW', qty: 6 }], ['MR44']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.ok(!(r.lines || []).some((l) => /^LIC-/.test(l.sku)),
    `expected no licence, got ${(r.lines || []).map((l) => l.sku).join(', ')}`);
});

test('the marked rows are bound into the review fingerprint', () => {
  // Otherwise Plan and Execute could disagree about which rows are bare while
  // hashing identically, which would let the licence change after review.
  const withRows = w.oneshotProductRequestDescriptor({ skus: CHRIS, hardware_only_skus: ['MR44'] });
  const without = w.oneshotProductRequestDescriptor({ skus: CHRIS });
  assert.notDeepEqual(withRows, without);
  // Order and casing must not change the fingerprint.
  const a = w.oneshotProductRequestDescriptor({ skus: CHRIS, hardware_only_skus: ['MR44', 'CW9164'] });
  const b = w.oneshotProductRequestDescriptor({ skus: CHRIS, hardware_only_skus: ['cw9164', 'mr44'] });
  assert.deepEqual(a, b);
});

// ── Wrong-model MX guard vs a legitimate licence-only renewal ───────────────
// Adding an MX75 to a cart that already held a licence-only MX65 renewal blocked
// the whole plan with explicit_license_family_conflict (Chris, 2026-08-19). The
// guard fired on "the cart contains ANY MX hardware", so an unrelated renewal
// became illegal by proximity. It now fires only when an MX appliance in the
// cart has no licence of its own, which is the actual wrong-model signature.

const plan5 = (skus, hardwareOnlySkus) => w.expandOneshotRequestedProducts({
  skus,
  license_term: '5',
  hardware_only: false,
  include_licenses: true,
  ha_mode: 'standard',
  ...(hardwareOnlySkus === undefined ? {} : { hardware_only_skus: hardwareOnlySkus }),
});

test('adding hardware does not invalidate a licence-only renewal for another model', () => {
  const r = plan5([
    { sku: 'MR44-HW', qty: 6 },
    { sku: 'CW9164I-MR', qty: 6 },
    { sku: 'LIC-ENT-5YR', qty: 6 },
    { sku: 'LIC-MX65-SEC-5YR', qty: 2 },
    { sku: 'MX75', qty: 1 },
    { sku: 'LIC-MX75-SEC-5Y', qty: 1 },
  ], ['MR44']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  // The renewal survives at its own quantity and the MX75 keeps its own licence.
  assert.equal(line(r, 'LIC-MX65-SEC-5YR').qty, 2);
  assert.equal(line(r, 'LIC-MX75-SEC-5Y').qty, 1);
  assert.equal(line(r, 'MX75').qty, 1);
});

test('the wrong-model MX licence is STILL blocked', () => {
  // The case the guard exists for: MX75 bought, MX85 licence attached, and the
  // MX75 itself left with no licence of its own.
  const r = w.expandOneshotRequestedProducts({
    skus: [{ sku: 'MX75', qty: 2 }, { sku: 'LIC-MX85-ENT-3Y', qty: 2 }],
    license_term: '3',
    hardware_only: false,
    include_licenses: true,
    ha_mode: 'standard',
  });
  assert.equal(r.success, false);
  assert.ok(codes(r).includes('explicit_license_family_conflict'));
});

test('a stray MX licence still blocks when the MX hardware is unlicensed', () => {
  // MX75 has no licence of its own, so the loose LIC-MX65 is still suspicious.
  const r = plan5([
    { sku: 'MX75', qty: 1 },
    { sku: 'LIC-MX65-SEC-5YR', qty: 2 },
  ], []);
  assert.equal(r.success, false);
  assert.ok(codes(r).includes('explicit_license_family_conflict'));
});

test('a hardware-only MX does not count as unlicensed MX hardware', () => {
  // The rep deliberately quoted the MX75 bare, so it is not a missing licence.
  const r = plan5([
    { sku: 'MX75', qty: 1 },
    { sku: 'LIC-MX65-SEC-5YR', qty: 2 },
  ], ['MX75']);
  assert.equal(r.success, true, `blocked by ${codes(r).join(', ')}`);
  assert.ok(!(r.lines || []).some((l) => /^LIC-MX75/.test(l.sku)));
});
