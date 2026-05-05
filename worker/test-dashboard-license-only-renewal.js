// Regression test: dashboard vision parses must produce LICENSE-ONLY renewal
// URLs, never hardware-purchase URLs. Codex's live test on 2026-05-05T15:32Z
// (post-PR #20) showed the bot returning MX85-HW alongside the license, turning
// a renewal quote into a hardware-purchase quote.
//
// Per Chris's product spec:
//   - Active count > 0 → license SKU(s) at qty=ACTIVE for each term.
//   - MR-ENT → LIC-ENT-{term}YR at MR-ENT qty.
//   - EOL devices → separate "Optional Upgrade" section, never the renewal cart.
//   - Hardware SKUs (e.g. MX85-HW) are NEVER added to a dashboard renewal.

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
src += '\nmodule.exports = { buildDashboardRenewalQuote, extractDashboardMetadata };';
const tmp = path.join(os.tmpdir(), `stratus-dash-renewal-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildDashboardRenewalQuote, extractDashboardMetadata } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// ─── extractDashboardMetadata ───────────────────────────────────────────────
{
  const t = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: MR-ENT | LIMIT: 5 | ACTIVE: 3
SKU: MX85 | LIMIT: 1 | ACTIVE: 1
---
EXPIRATION: 2026-12-15
MX_EDITION: Advanced Security
MR_EDITION: Enterprise`;
  const meta = extractDashboardMetadata(t);
  check('extractDashboardMetadata pulls MX_EDITION', meta.mxEdition === 'Advanced Security');
  check('extractDashboardMetadata pulls MR_EDITION', meta.mrEdition === 'Enterprise');
  check('extractDashboardMetadata pulls EXPIRATION', meta.expiration === '2026-12-15');
}

// ─── Codex's exact ENG Design fixture ───────────────────────────────────────
// Ground truth: MR-ENT × 3, MT × 0 (skip), MX65 × 0 (skip), MX85 × 1.
// Expected URLs: license-only, no MX85-HW.
{
  const visionSkus = [
    { sku: 'MR-ENT', qty: 3 },
    { sku: 'MX85', qty: 1 },
    // MX65 / MT excluded upstream because ACTIVE=0; we pass only what
    // extractSkusFromVisionText would have returned.
  ];
  const out = buildDashboardRenewalQuote(visionSkus, {
    mxEdition: 'Advanced Security',
    mrEdition: 'Enterprise'
  });
  check('Builder returns non-null result', !!out, JSON.stringify(out));

  const msg = out && out.message;
  check('Renewal message has 1Y / 3Y / 5Y URLs',
    !!msg && /1-Year Co-Term/.test(msg) && /3-Year Co-Term/.test(msg) && /5-Year Co-Term/.test(msg),
    `msg=${msg}`);

  // Critical: no hardware SKU.
  check('Renewal URLs do NOT contain MX85-HW',
    !!msg && !msg.includes('MX85-HW'),
    `msg=${msg}`);

  // 1Y URL: LIC-MX85-SEC-1Y qty 1 + LIC-ENT-1YR qty 3
  check('1Y URL contains LIC-MX85-SEC-1Y',
    !!msg && /LIC-MX85-SEC-1Y\b/.test(msg) && msg.match(/LIC-MX85-SEC-1Y[^\n]*qty=[^\n]*\b1\b/),
    `msg=${msg}`);
  check('1Y URL contains LIC-ENT-1YR with qty 3',
    !!msg && /LIC-ENT-1YR/.test(msg),
    `msg=${msg}`);
  check('3Y URL contains LIC-MX85-SEC-3Y',
    !!msg && /LIC-MX85-SEC-3Y\b/.test(msg),
    `msg=${msg}`);
  check('3Y URL contains LIC-ENT-3YR',
    !!msg && /LIC-ENT-3YR/.test(msg),
    `msg=${msg}`);
  check('5Y URL contains LIC-MX85-SEC-5Y',
    !!msg && /LIC-MX85-SEC-5Y\b/.test(msg),
    `msg=${msg}`);
  check('5Y URL contains LIC-ENT-5YR',
    !!msg && /LIC-ENT-5YR/.test(msg),
    `msg=${msg}`);

  // Critical: each URL must have qty=1,3 (MX85 license, MR-ENT)
  check('1Y URL has qty=1,3',
    !!msg && /LIC-MX85-SEC-1Y,LIC-ENT-1YR&qty=1,3/.test(msg),
    `msg=${msg}`);
  check('3Y URL has qty=1,3',
    !!msg && /LIC-MX85-SEC-3Y,LIC-ENT-3YR&qty=1,3/.test(msg),
    `msg=${msg}`);
  check('5Y URL has qty=1,3',
    !!msg && /LIC-MX85-SEC-5Y,LIC-ENT-5YR&qty=1,3/.test(msg),
    `msg=${msg}`);

  // No upgrade block in this fixture (MX85 is not EOL).
  check('No upgrade block when no EOL devices',
    !out.upgradeBlock || out.upgradeBlock === null,
    `upgradeBlock=${out.upgradeBlock}`);
}

// ─── MX_EDITION = Secure SD-WAN Plus → SDW tier ─────────────────────────────
{
  const out = buildDashboardRenewalQuote(
    [{ sku: 'MX85', qty: 2 }],
    { mxEdition: 'Secure SD-WAN Plus' }
  );
  const msg = out && out.message;
  check('MX_EDITION SD-WAN Plus → SDW tier in license SKUs',
    !!msg && /LIC-MX85-SDW-3Y/.test(msg),
    `msg=${msg}`);
  check('SDW tier does NOT use SEC',
    !!msg && !/LIC-MX85-SEC-/.test(msg),
    `msg=${msg}`);
}

// ─── MR-ENT only screenshot ─────────────────────────────────────────────────
{
  const out = buildDashboardRenewalQuote(
    [{ sku: 'MR-ENT', qty: 5 }],
    { mxEdition: '', mrEdition: 'Enterprise' }
  );
  const msg = out && out.message;
  check('MR-only renewal: 1Y URL has LIC-ENT-1YR qty 5',
    !!msg && /LIC-ENT-1YR&qty=5\b/.test(msg),
    `msg=${msg}`);
  check('MR-only renewal: 3Y URL has LIC-ENT-3YR qty 5',
    !!msg && /LIC-ENT-3YR&qty=5\b/.test(msg),
    `msg=${msg}`);
  check('MR-only renewal: no hardware in URLs',
    !!msg && !/MR\d.*-HW|MX\d.*-HW|MS\d.*-HW/.test(msg),
    `msg=${msg}`);
}

// ─── EOL device → upgrade block, NOT in renewal cart ────────────────────────
// MX64 is EOL (replaced by MX67). With ACTIVE=2, it should NOT appear in the
// per-term URLs but should be flagged in the upgrade block.
{
  const out = buildDashboardRenewalQuote(
    [{ sku: 'MX64', qty: 2 }, { sku: 'MR-ENT', qty: 4 }],
    { mxEdition: 'Advanced Security' }
  );
  const msg = out && out.message;
  check('EOL MX64 NOT in renewal URLs',
    !!msg && !/LIC-MX64-/.test(msg) && !/MX64-HW/.test(msg),
    `msg=${msg}`);
  check('EOL device surfaces in upgrade block',
    out && out.upgradeBlock && /MX64/.test(out.upgradeBlock) && /Optional Upgrade/i.test(out.upgradeBlock),
    `upgradeBlock=${out && out.upgradeBlock}`);
  check('Renewal URLs still have LIC-ENT for the MR fleet',
    !!msg && /LIC-ENT-3YR&qty=4\b/.test(msg),
    `msg=${msg}`);
}

// ─── ACTIVE=0 inputs are filtered upstream — builder gracefully handles ─────
{
  const out = buildDashboardRenewalQuote(
    [{ sku: 'MX85', qty: 0 }, { sku: 'MR-ENT', qty: 3 }],
    {}
  );
  const msg = out && out.message;
  check('ACTIVE=0 SKU is skipped — no MX85 in URL',
    !!msg && !/MX85/.test(msg),
    `msg=${msg}`);
  check('Other items still render correctly',
    !!msg && /LIC-ENT-3YR&qty=3\b/.test(msg),
    `msg=${msg}`);
}

// ─── Empty input → null ─────────────────────────────────────────────────────
{
  check('Empty input returns null', buildDashboardRenewalQuote([], {}) === null);
  check('All-zero qty input returns null',
    buildDashboardRenewalQuote([{ sku: 'MX85', qty: 0 }], {}) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
