// Parity regression test (gchat worker) for the screenshot→empty-quote bug
// (Arch Technology, LLC license dashboard, 2026-06-25). The gchat worker carries
// its own copy of buildDashboardRenewalQuote + licenseTermSiblings; this asserts
// the F1 LIC- passthrough fix landed identically here. See
// worker/test-dashboard-lic-passthrough.js for the full rationale.
//
// Uses a GENERIC import→require rewrite so the loader survives gchat's extra
// JSON imports (data/*.json + email-reply-voice-skill.json) without per-file drift.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
// Imports are relative to src/index.js, so resolve their paths under src/.
const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
// Rewrite every `import X from './….json';` to a require() of the absolute path.
src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
  (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
// Stub the `cloudflare:workers` runtime import (only the Workflow classes use it,
// and those live in the stripped export region) so CommonJS can load the file.
src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
  'const WorkflowEntrypoint = class {};');
// Demote `export class …`/`export function …` to local declarations.
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
src += '\nmodule.exports = { buildDashboardRenewalQuote, extractSkusFromVisionText, licenseTermSiblings, collapseLicenseTermlessDuplicates };';
const tmp = path.join(os.tmpdir(), `stratus-gchat-dash-lic-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildDashboardRenewalQuote, extractSkusFromVisionText, licenseTermSiblings, collapseLicenseTermlessDuplicates } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};
const decodeAllUrls = (msg) => {
  const out = [];
  const re = /[?&]item=([^&\s)]+)&qty=([^&\s)]+)/g;
  let m;
  while ((m = re.exec(msg)) !== null) {
    out.push({ items: decodeURIComponent(m[1]).split(','), qtys: m[2].split(',').map(Number) });
  }
  return out;
};
const hasUrl = (urls, expectItems, expectQtys) =>
  urls.some(u =>
    u.items.length === expectItems.length &&
    u.items.every((s, i) => s === expectItems[i]) &&
    u.qtys.every((q, i) => q === expectQtys[i]));

// licenseTermSiblings basics
check('licenseTermSiblings(LIC-ENT-3YR).3Y === LIC-ENT-3YR', licenseTermSiblings('LIC-ENT-3YR') ?.['3Y'] === 'LIC-ENT-3YR');
check('licenseTermSiblings(LIC-ENT-3YR).1Y === LIC-ENT-1YR', licenseTermSiblings('LIC-ENT-3YR') ?.['1Y'] === 'LIC-ENT-1YR');
check('term-less LIC-ENT → null', licenseTermSiblings('LIC-ENT') === null);
check('subscription LIC-MR-E → null', licenseTermSiblings('LIC-MR-E') === null);
check('subscription LIC-MX-M-E → null', licenseTermSiblings('LIC-MX-M-E') === null);
check('subscription LIC-MS-100-L-E → null', licenseTermSiblings('LIC-MS-100-L-E') === null);
check('hardware MX67W → null', licenseTermSiblings('MX67W') === null);

// Full Arch Technology dashboard → real per-term URLs
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: LIC-ENT-3YR | LIMIT: 1 | ACTIVE: 1
SKU: LIC-MV-3YR | LIMIT: 12 | ACTIVE: 12
SKU: LIC-MX67W-SEC-3YR | LIMIT: 2 | ACTIVE: 2
---
MX_EDITION: Advanced Security
MR_EDITION: Enterprise`;
  const skus = extractSkusFromVisionText(text);
  const q = buildDashboardRenewalQuote(skus, { mxEdition: 'Advanced Security' });
  check('gchat buildDashboardRenewalQuote returns a quote (NOT null)', !!(q && q.message), JSON.stringify(q));
  const urls = decodeAllUrls((q && q.message) || '');
  check('3-Year option = LIC-ENT-3YR,LIC-MV-3YR,LIC-MX67W-SEC-3YR @ 1,12,2',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]), JSON.stringify(urls));
  check('1-Year sibling present', hasUrl(urls, ['LIC-ENT-1YR', 'LIC-MV-1YR', 'LIC-MX67W-SEC-1YR'], [1, 12, 2]), JSON.stringify(urls));
  check('5-Year sibling present', hasUrl(urls, ['LIC-ENT-5YR', 'LIC-MV-5YR', 'LIC-MX67W-SEC-5YR'], [1, 12, 2]), JSON.stringify(urls));
}

// Dashboard subscription SKUs are ignored for ecomm quoting
{
  const q = buildDashboardRenewalQuote([
    { sku: 'LIC-MR-E', qty: 2 },
    { sku: 'LIC-MX-M-E', qty: 1 },
    { sku: 'LIC-MS-100-L-E', qty: 5 },
  ], { mxEdition: 'Advanced Security' });
  check('subscription-only dashboard rows produce no ecomm quote', q === null, JSON.stringify(q));
}

{
  const q = buildDashboardRenewalQuote([
    { sku: 'LIC-MR-E', qty: 2 },
    { sku: 'LIC-MX-M-E', qty: 1 },
    { sku: 'MR-ENT', qty: 2 },
    { sku: 'MX64', qty: 1 },
  ], { mxEdition: 'Advanced Security' });
  const msg = (q && q.message) || '';
  const urls = decodeAllUrls(msg);
  check('mixed subscription + co-term rows still quote real renewal',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MX64-SEC-3YR'], [2, 1]), JSON.stringify(urls));
  check('mixed dashboard quote never includes subscription SKUs',
    !/LIC-MR-E|LIC-MX-M-E|LIC-MS-100-L-E/.test(msg), msg);
}

// Garbage resilience: phantom term-less rows dropped, true qtys kept
{
  const visionSkus = [
    { sku: 'LIC-ENT-3YR', qty: 1 }, { sku: 'LIC-MV-3YR', qty: 12 }, { sku: 'LIC-MX67W-SEC-3YR', qty: 2 },
    { sku: 'LIC-ENT', qty: 67 }, { sku: 'LIC-MV', qty: 67 }, { sku: 'LIC-MX67W-SEC', qty: 1 },
  ];
  const q = buildDashboardRenewalQuote(visionSkus, { mxEdition: 'Advanced Security' });
  const urls = decodeAllUrls((q && q.message) || '');
  check('garbage input: 3-Year intact @ 1,12,2 (phantom 67 ignored)',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]), JSON.stringify(urls));
  check('no URL carries qty 67', urls.every(u => !u.qtys.includes(67)), JSON.stringify(urls));
}

// SME 3-year cap (Codex council)
{
  const sme = licenseTermSiblings('LIC-SME-3YR');
  check('gchat: LIC-SME-3YR omits deprecated 5Y', sme && sme['1Y'] === 'LIC-SME-1YR' && sme['3Y'] === 'LIC-SME-3YR' && sme['5Y'] === undefined, JSON.stringify(sme));
}
// F6 collapse parity
{
  const parsed = extractSkusFromVisionText(`LIC-ENT-3YR x 1\nLIC-MV-3YR x 12\nLIC-MX67W-SEC-3YR x 2\nLIC-ENT x 67\nLIC-MV x 67\nLIC-MX67W-SEC x 1`).map(s => s.sku);
  check('gchat: 6-row OCR garbage collapses to 3 termed rows', parsed.length === 3 && parsed.every(s => /-3YR$/.test(s)), JSON.stringify(parsed));
}

console.log(`\n${fail === 0 ? '🎉' : '⚠️'} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
