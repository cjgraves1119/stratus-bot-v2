// Regression test: AnyConnect 25-user minimum clamp must surface the
// clarificationNote in the rendered message. Without this, Codex's live
// regression saw qty=10 → URL with qty=25 and NO indication anything had
// happened — which looked like a "qty bleed from prior context" bug.
//
// Two render paths to cover:
//   1. directLicense (single AnyConnect license)
//   2. directLicenseList (multiple AnyConnect licenses, only one < 25)

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
const edIdx = src.indexOf('export default');
if (edIdx > -1) {
  let depth = 0, started = false, end = edIdx;
  for (let i = edIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  src = src.slice(0, edIdx) + src.slice(end + 1);
}
src += '\nmodule.exports = { buildQuoteResponse, buildQuoteFromV2 };';
const tmp = path.join(os.tmpdir(), `stratus-ac-clamp-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildQuoteResponse, buildQuoteFromV2 } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// ─── Codex's live failure case: V2 quote with qty=10 AnyConnect Apex 3y ───
// buildQuoteFromV2 should clamp to 25 AND set clarificationNote.
{
  const v2 = {
    intent: 'quote',
    items: [{ sku: 'LIC-L-AC-APX-3Y-S1', qty: 10, sku_type: 'license' }],
    modifiers: {},
  };
  const parsed = buildQuoteFromV2(v2, 'quote 10 AnyConnect Apex 3 year');
  check('buildQuoteFromV2 returns parsed result',
    !!parsed, JSON.stringify(parsed));
  check('buildQuoteFromV2 clamps qty 10 → 25',
    parsed && parsed.directLicense && parsed.directLicense.qty === 25,
    `qty=${parsed && parsed.directLicense && parsed.directLicense.qty}`);
  check('buildQuoteFromV2 sets clarificationNote',
    parsed && /AnyConnect.*25.*minimum/i.test(parsed.clarificationNote || ''),
    `note=${parsed && parsed.clarificationNote}`);

  const out = parsed && buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('Rendered message contains the URL with qty=25',
    !!msg && msg.includes('LIC-L-AC-APX-3Y-S1') && /qty=25\b/.test(msg),
    `msg=${msg}`);
  check('Rendered message ALSO contains the clarificationNote',
    !!msg && /AnyConnect.*25.*minimum/i.test(msg),
    `msg=${msg}`);
  check('Note appears BEFORE the URL (so user sees it first)',
    !!msg && msg.indexOf('25-user minimum') < msg.indexOf('LIC-L-AC-APX-3Y-S1'),
    `msg=${msg}`);
}

// ─── At-or-above minimum (qty=25) — note should NOT appear ──────────────
{
  const v2 = {
    intent: 'quote',
    items: [{ sku: 'LIC-L-AC-APX-3Y-S1', qty: 25, sku_type: 'license' }],
    modifiers: {},
  };
  const parsed = buildQuoteFromV2(v2, 'quote 25 AnyConnect Apex 3 year');
  const out = parsed && buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('qty=25 (at minimum) — no clarificationNote rendered',
    !!msg && !/25-user minimum/i.test(msg),
    `msg=${msg}`);
  check('qty=25 — URL still has qty=25',
    !!msg && /qty=25\b/.test(msg),
    `msg=${msg}`);
}

// ─── Above minimum (qty=100) — note should NOT appear ───────────────────
{
  const v2 = {
    intent: 'quote',
    items: [{ sku: 'LIC-L-AC-PLS-1Y-S1', qty: 100, sku_type: 'license' }],
    modifiers: {},
  };
  const parsed = buildQuoteFromV2(v2, 'quote 100 AnyConnect Plus 1 year');
  const out = parsed && buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('qty=100 — no clarificationNote rendered',
    !!msg && !/25-user minimum/i.test(msg),
    `msg=${msg}`);
  check('qty=100 — URL has qty=100',
    !!msg && /qty=100\b/.test(msg),
    `msg=${msg}`);
}

// ─── Non-AnyConnect license (e.g. Duo Essentials qty=10) — no clamp ─────
{
  const v2 = {
    intent: 'quote',
    items: [{ sku: 'LIC-DUO-ESSENTIALS-3YR', qty: 10, sku_type: 'license' }],
    modifiers: {},
  };
  const parsed = buildQuoteFromV2(v2, 'quote 10 Duo Essentials 3 year');
  const out = parsed && buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('Non-AnyConnect qty=10 — no clamp, no note',
    !!msg && /qty=10\b/.test(msg) && !/minimum/i.test(msg),
    `msg=${msg}`);
}

// ─── directLicenseList path: 2 AnyConnect licenses with one < 25 ────────
// Hand-built parsed shape that triggers the directLicenseList renderer.
{
  const parsed = {
    items: [],
    directLicenseList: [
      { sku: 'LIC-L-AC-APX-1Y-S1', qty: 25 },
      { sku: 'LIC-L-AC-APX-3Y-S1', qty: 25 },
    ],
    requestedTerm: null,
    modifiers: { hardwareOnly: false, licenseOnly: true },
    requestedTier: null,
    isAdvisory: false,
    isRevision: false,
    showPricing: false,
    unresolvedCategories: [],
    clarificationNote: 'AnyConnect has a 25-user minimum — bumped quantity to 25.',
  };
  const out = buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('directLicenseList renderer surfaces clarificationNote',
    !!msg && /25-user minimum/i.test(msg),
    `msg=${msg}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
