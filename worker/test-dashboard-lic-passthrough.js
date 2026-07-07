// Regression test for the screenshot→empty-quote bug (Arch Technology, LLC —
// Meraki license dashboard, 2026-06-25).
//
// The dashboard "License information" table lists ALREADY fully-formed license
// SKUs (LIC-ENT-3YR ×1, LIC-MV-3YR ×12, LIC-MX67W-SEC-3YR ×2). OCR reads them
// correctly, but buildDashboardRenewalQuote routed every row through
// getLicenseSkus — which only maps *hardware* models → licenses and returns
// null for LIC- input. Result: option1 empty → no URLs → both webex and the
// extension produced a bare "Detected SKUs" list (or zero links) instead of a
// quote.
//
// Fix (F1): licenseTermSiblings() resolves a termed LIC- SKU to its 1/3/5yr
// siblings (limited to SKUs present in prices.json); buildDashboardRenewalQuote
// carries dashboard license rows forward as kind:'lic' directly.
//
// Loader mirrors test-dashboard-systems-manager.js.

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
src += '\nmodule.exports = { buildDashboardRenewalQuote, extractSkusFromVisionText, licenseTermSiblings, collapseLicenseTermlessDuplicates };';
const tmp = path.join(os.tmpdir(), `stratus-dash-lic-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildDashboardRenewalQuote, extractSkusFromVisionText, licenseTermSiblings, collapseLicenseTermlessDuplicates } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// Decode every stratusinfosystems.com/order URL in a message into
// [{ items:[...], qtys:[...] }].
const decodeAllUrls = (msg) => {
  const out = [];
  const re = /[?&]item=([^&\s)]+)&qty=([^&\s)]+)/g;
  let m;
  while ((m = re.exec(msg)) !== null) {
    out.push({
      items: decodeURIComponent(m[1]).split(','),
      qtys: m[2].split(',').map(Number),
    });
  }
  return out;
};
// Is there a URL whose item list (in order) === expectItems and qtys === expectQtys?
const hasUrl = (urls, expectItems, expectQtys) =>
  urls.some(u =>
    u.items.length === expectItems.length &&
    u.items.every((s, i) => s === expectItems[i]) &&
    u.qtys.every((q, i) => q === expectQtys[i])
  );

// ─── 1. licenseTermSiblings: termed LIC- SKU → 1/3/5yr siblings ──────────────
{
  const ent = licenseTermSiblings('LIC-ENT-3YR');
  check('licenseTermSiblings(LIC-ENT-3YR) returns a sibling map', !!ent, `got ${JSON.stringify(ent)}`);
  check('  → 3Y maps to LIC-ENT-3YR', ent && ent['3Y'] === 'LIC-ENT-3YR', `got ${ent && ent['3Y']}`);
  check('  → 1Y maps to LIC-ENT-1YR', ent && ent['1Y'] === 'LIC-ENT-1YR', `got ${ent && ent['1Y']}`);
  check('  → 5Y maps to LIC-ENT-5YR', ent && ent['5Y'] === 'LIC-ENT-5YR', `got ${ent && ent['5Y']}`);
}

// ─── 2. licenseTermSiblings rejects non-license / term-less / hardware input ─
{
  check('term-less LIC-ENT → null (OCR phantom, not a quotable row)', licenseTermSiblings('LIC-ENT') === null);
  check('subscription SKU LIC-MR-E → null (not in ecomm catalog)', licenseTermSiblings('LIC-MR-E') === null);
  check('subscription SKU LIC-MX-M-E → null (not in ecomm catalog)', licenseTermSiblings('LIC-MX-M-E') === null);
  check('subscription SKU LIC-MS-100-L-E → null (not in ecomm catalog)', licenseTermSiblings('LIC-MS-100-L-E') === null);
  check('hardware model MX67W → null (falls through to getLicenseSkus)', licenseTermSiblings('MX67W') === null);
  check('hardware model MR44 → null', licenseTermSiblings('MR44') === null);
  check('empty input → null', licenseTermSiblings('') === null);
}

// ─── 3. Full Arch Technology dashboard → real per-term quote URLs ────────────
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: LIC-ENT-3YR | LIMIT: 1 | ACTIVE: 1
SKU: LIC-MV-3YR | LIMIT: 12 | ACTIVE: 12
SKU: LIC-MX67W-SEC-3YR | LIMIT: 2 | ACTIVE: 2
---
EXPIRATION: 2026-02-19
MX_EDITION: Advanced Security
MR_EDITION: Enterprise`;
  const skus = extractSkusFromVisionText(text);
  check('vision parse yields exactly 3 rows', skus.length === 3, `got ${JSON.stringify(skus)}`);

  const q = buildDashboardRenewalQuote(skus, { mxEdition: 'Advanced Security', mrEdition: 'Enterprise' });
  check('buildDashboardRenewalQuote returns a quote (NOT null) — the core bug', !!(q && q.message), `got ${q && q.message ? 'message' : JSON.stringify(q)}`);

  const urls = decodeAllUrls((q && q.message) || '');
  check('quote contains order URLs', urls.length >= 3, `got ${urls.length} urls`);
  check('3-Year option = LIC-ENT-3YR,LIC-MV-3YR,LIC-MX67W-SEC-3YR @ 1,12,2 (dashboard order)',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]),
    `urls: ${JSON.stringify(urls)}`);
  check('1-Year sibling option = LIC-ENT-1YR,LIC-MV-1YR,LIC-MX67W-SEC-1YR @ 1,12,2',
    hasUrl(urls, ['LIC-ENT-1YR', 'LIC-MV-1YR', 'LIC-MX67W-SEC-1YR'], [1, 12, 2]),
    `urls: ${JSON.stringify(urls)}`);
  check('5-Year sibling option = LIC-ENT-5YR,LIC-MV-5YR,LIC-MX67W-SEC-5YR @ 1,12,2',
    hasUrl(urls, ['LIC-ENT-5YR', 'LIC-MV-5YR', 'LIC-MX67W-SEC-5YR'], [1, 12, 2]),
    `urls: ${JSON.stringify(urls)}`);
  check('renewal quote is license-only (no "-HW" hardware SKU)', !/-HW\b/.test(q.message), 'found a -HW SKU in a renewal');
}

// ─── 3b. Dashboard subscription SKUs are ignored for ecomm quoting ───────────
{
  const subOnly = [
    { sku: 'LIC-MR-E', qty: 2 },
    { sku: 'LIC-MX-M-E', qty: 1 },
    { sku: 'LIC-MS-100-L-E', qty: 5 },
  ];
  const q = buildDashboardRenewalQuote(subOnly, { mxEdition: 'Advanced Security', mrEdition: 'Enterprise' });
  check('subscription-only dashboard rows produce no ecomm quote',
    q === null,
    JSON.stringify(q));
}

{
  const mixed = [
    { sku: 'LIC-MR-E', qty: 2 },
    { sku: 'LIC-MX-M-E', qty: 1 },
    { sku: 'MR-ENT', qty: 2 },
    { sku: 'MX64', qty: 1 },
  ];
  const q = buildDashboardRenewalQuote(mixed, { mxEdition: 'Advanced Security', mrEdition: 'Enterprise' });
  const msg = (q && q.message) || '';
  const urls = decodeAllUrls(msg);
  check('mixed subscription + co-term dashboard rows still quote real co-term renewal',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MX64-SEC-3YR'], [2, 1]),
    `urls: ${JSON.stringify(urls)}`);
  check('mixed dashboard quote never includes subscription SKUs',
    !/LIC-MR-E|LIC-MX-M-E|LIC-MS-100-L-E/.test(msg),
    msg);
}

// ─── 4. OCR-garbage resilience: 3 real rows + 3 term-less phantoms ───────────
// The extension's vision pass free-formed 6 rows (3 correct + phantoms with the
// term stripped and a bogus qty 67 bled from "MX67W"). The phantom rows must be
// dropped, the real rows quoted at their TRUE quantities (1,12,2 — never 67).
{
  const visionSkus = [
    { sku: 'LIC-ENT-3YR', qty: 1 },
    { sku: 'LIC-MV-3YR', qty: 12 },
    { sku: 'LIC-MX67W-SEC-3YR', qty: 2 },
    { sku: 'LIC-ENT', qty: 67 },        // phantom: term stripped, qty bled from MX67W
    { sku: 'LIC-MV', qty: 67 },         // phantom
    { sku: 'LIC-MX67W-SEC', qty: 1 },   // phantom: term stripped
  ];
  const q = buildDashboardRenewalQuote(visionSkus, { mxEdition: 'Advanced Security' });
  check('garbage input still builds a quote', !!(q && q.message), `got ${JSON.stringify(q)}`);
  const urls = decodeAllUrls((q && q.message) || '');
  check('3-Year option intact @ true qty 1,12,2 (phantom qty 67 ignored)',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]),
    `urls: ${JSON.stringify(urls)}`);
  check('no URL carries the bogus qty 67',
    urls.every(u => !u.qtys.includes(67)),
    `urls: ${JSON.stringify(urls)}`);
  check('no term-less LIC token leaks into a URL item list',
    urls.every(u => u.items.every(s => /-([135])(YR?)$/.test(s))),
    `urls: ${JSON.stringify(urls)}`);
}

// ─── 5. SME discontinued — LIC-SME maps to the replacement (Ivanti MDM) family ───
{
  const sme = licenseTermSiblings('LIC-SME-3YR');
  check('licenseTermSiblings(LIC-SME-3YR) returns a map', !!sme, `got ${JSON.stringify(sme)}`);
  check('  → includes 1Y (replacement)', sme && sme['1Y'] === 'LIC-MI-EMSC-D-1YMC-A-1YR', `got ${sme && sme['1Y']}`);
  check('  → includes 3Y (replacement)', sme && sme['3Y'] === 'LIC-MI-EMSC-D-1YMC-A-3YR', `got ${sme && sme['3Y']}`);
  check('  → includes 5Y (replacement supports all terms)', sme && sme['5Y'] === 'LIC-MI-EMSC-D-1YMC-A-5YR', `got ${sme && sme['5Y']}`);

  // And the rendered quote for an SME dashboard row must carry no 5-Year SME line.
  const q = buildDashboardRenewalQuote([{ sku: 'LIC-SME-3YR', qty: 10 }]);
  if (q && q.message) check('SME renewal quote contains no legacy LIC-SME SKU', !/LIC-SME-\d/.test(q.message), q.message);
}

// ─── 6. F6 OCR sanity filter — collapse term-less LIC duplicates ─────────────
{
  const collapsed = collapseLicenseTermlessDuplicates([
    { sku: 'LIC-ENT-3YR', qty: 1 },
    { sku: 'LIC-ENT', qty: 67 },              // OCR fragment of the above
    { sku: 'LIC-MX67W-SEC-3YR', qty: 2 },
    { sku: 'LIC-MX67W-SEC', qty: 1 },         // OCR fragment
    { sku: 'MR44', qty: 3 },                  // unrelated hardware — keep
  ]);
  const skus = collapsed.map(s => s.sku);
  check('drops term-less LIC-ENT when LIC-ENT-3YR present', !skus.includes('LIC-ENT'), `got ${JSON.stringify(skus)}`);
  check('drops term-less LIC-MX67W-SEC when termed sibling present', !skus.includes('LIC-MX67W-SEC'), `got ${JSON.stringify(skus)}`);
  check('keeps the termed LIC-ENT-3YR', skus.includes('LIC-ENT-3YR'), `got ${JSON.stringify(skus)}`);
  check('keeps unrelated hardware MR44', skus.includes('MR44'), `got ${JSON.stringify(skus)}`);

  // A standalone term-less LIC row (no termed sibling) must NOT be dropped.
  const keep = collapseLicenseTermlessDuplicates([{ sku: 'LIC-ENT', qty: 5 }, { sku: 'MR44', qty: 1 }]);
  check('standalone term-less LIC row kept (no sibling)', keep.some(s => s.sku === 'LIC-ENT'), `got ${JSON.stringify(keep.map(s => s.sku))}`);

  // End-to-end: vision text with both termed + term-less rows → only termed survive.
  const visionText = `LIC-ENT-3YR x 1\nLIC-MV-3YR x 12\nLIC-MX67W-SEC-3YR x 2\nLIC-ENT x 67\nLIC-MV x 67\nLIC-MX67W-SEC x 1`;
  const parsed = extractSkusFromVisionText(visionText).map(s => s.sku);
  check('extractSkusFromVisionText collapses the 6-row OCR garbage to 3 termed rows',
    parsed.length === 3 && parsed.every(s => /-3YR$/.test(s)),
    `got ${JSON.stringify(parsed)}`);
}

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
