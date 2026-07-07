// Regression test for two dashboard-screenshot bugs (Naf Naf Middle Eastern Grill):
//   1. Systems Manager row was silently dropped — never parsed, never quoted.
//      Fix: vision prompt emits the row as SM-ENT; buildDashboardRenewalQuote
//      rolls SM-ENT into LIC-SME-{term}YR at the active device count.
//   2. "Option 1 — As Quoted" included hardware (MX68CW-HW-NA, MX68W-HW) on a
//      license renewal. Fix: the renewal builder is license-only — Option 1
//      (Renew As-Is) must contain NO "-HW" SKUs.
//
// Loader mirrors test-dashboard-license-only-renewal.js: read src/index.js,
// rewrite the data imports to require(), strip the `export default` Worker
// block, and re-export the pure functions under test.

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
src += '\nmodule.exports = { buildDashboardRenewalQuote, extractSkusFromVisionText, getDashboardVisionPrompt };';
const tmp = path.join(os.tmpdir(), `stratus-dash-sm-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildDashboardRenewalQuote, extractSkusFromVisionText, getDashboardVisionPrompt } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// Pull the text of a single "Option N" block out of the rendered message.
const optionBlock = (msg, n) => {
  const re = new RegExp(`Option ${n}[\\s\\S]*?(?=\\*\\*Option |$)`);
  const m = msg.match(re);
  return m ? m[0] : '';
};
// Decode a stratusinfosystems.com/order URL into [{sku, qty}].
const decodeUrl = (block, termLabel) => {
  const line = block.split('\n').find(l => l.startsWith(`${termLabel} Co-Term:`));
  if (!line) return null;
  const m = line.match(/[?&]item=([^&]+)&qty=([^&\s]+)/);
  if (!m) return null;
  const items = decodeURIComponent(m[1]).split(',');
  const qtys = m[2].split(',');
  return items.map((sku, i) => ({ sku, qty: Number(qtys[i]) }));
};

// ─── 1. extractSkusFromVisionText handles the SM-ENT row ─────────────────────
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: MR-ENT | LIMIT: 5 | ACTIVE: 5
SKU: SM-ENT | LIMIT: 85 | ACTIVE: 84
---
MX_EDITION: Advanced Security
MR_EDITION: Enterprise`;
  const skus = extractSkusFromVisionText(text);
  const sm = skus.find(s => s.sku === 'SM-ENT');
  check('extractSkusFromVisionText parses SM-ENT row', !!sm, `got: ${JSON.stringify(skus)}`);
  check('SM-ENT qty = active device count (84)', sm && sm.qty === 84, `got qty=${sm && sm.qty}`);
}

// ─── 2. SM-ENT with ACTIVE=0 is skipped (rule 3) ─────────────────────────────
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: MR-ENT | LIMIT: 5 | ACTIVE: 5
SKU: SM-ENT | LIMIT: 10 | ACTIVE: 0
---`;
  const skus = extractSkusFromVisionText(text);
  check('SM-ENT with ACTIVE=0 is skipped', !skus.some(s => s.sku === 'SM-ENT'), `got: ${JSON.stringify(skus)}`);
}

// ─── 2b. Literal "Systems Manager" label (model ignored the SM-ENT token) ────
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: MR-ENT | LIMIT: 5 | ACTIVE: 5
SKU: Systems Manager | LIMIT: 85 | ACTIVE: 84
---`;
  const skus = extractSkusFromVisionText(text);
  const sm = skus.find(s => s.sku === 'SM-ENT');
  check('literal "Systems Manager" label recovered as SM-ENT', !!sm, `got: ${JSON.stringify(skus)}`);
  check('recovered SM-ENT qty = 84', sm && sm.qty === 84, `got qty=${sm && sm.qty}`);
}

// ─── 2c. SM token + literal label both present → no double count ─────────────
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: SM-ENT | LIMIT: 85 | ACTIVE: 84
Systems Manager also enabled
---`;
  const skus = extractSkusFromVisionText(text);
  const smRows = skus.filter(s => /^(SM|SME|SM-ENT)$/.test(s.sku));
  check('no double-count when token + label both appear', smRows.length === 1 && smRows[0].qty === 84,
    `got: ${JSON.stringify(smRows)}`);
}

// ─── 2d. Literal-label fallback is scoped to the SKU block (no caption capture) ─
{
  const text = `LICENSE_DASHBOARD_PARSE_V1
---
SKU: MR-ENT | LIMIT: 5 | ACTIVE: 5
---
Note from caption: Systems Manager LIMIT: 99 ACTIVE: 99 (ignore me)`;
  const skus = extractSkusFromVisionText(text);
  check('SM mention OUTSIDE the --- block is not captured', !skus.some(s => s.sku === 'SM-ENT'),
    `got: ${JSON.stringify(skus)}`);
}

// ─── 3. Full Naf Naf dashboard → renewal quote ───────────────────────────────
// MR-ENT×5, MS350-24P×1, MS350-48FP×2, MX68CW×36, MX68W×3, MX84×1, SM-ENT×84.
{
  const visionSkus = [
    { sku: 'MR-ENT', qty: 5 },
    { sku: 'MS350-24P', qty: 1 },
    { sku: 'MS350-48FP', qty: 2 },
    { sku: 'MX68CW', qty: 36 },
    { sku: 'MX68W', qty: 3 },
    { sku: 'MX84', qty: 1 },
    { sku: 'SM-ENT', qty: 84 },
  ];
  const q = buildDashboardRenewalQuote(visionSkus, { mxEdition: 'Advanced Security', mrEdition: 'Enterprise' });
  check('buildDashboardRenewalQuote returns a message', !!(q && q.message));
  const msg = (q && q.message) || '';

  // BUG 1 — Systems Manager is now in the renewal cart, but 5-year SME is deprecated.
  check('quote includes replacement 1YR', /\bLIC-MI-EMSC-D-1YMC-A-1YR\b/.test(msg));
  check('quote includes replacement 3YR', /\bLIC-MI-EMSC-D-1YMC-A-3YR\b/.test(msg));
  check('quote does NOT include any legacy LIC-SME SKU', !/\bLIC-SME-\d/.test(msg));
  check('quote flags the SME replacement', /Systems Manager \(LIC-SME\) licenses are discontinued/.test(msg));

  // MR-ENT regression — still maps to LIC-ENT.
  check('quote still includes LIC-ENT-1YR (MR-ENT)', /\bLIC-ENT-1YR\b/.test(msg));
  check('quote still includes LIC-ENT-5YR for non-SME 5-year terms', /\bLIC-ENT-5YR\b/.test(msg));

  const opt1 = optionBlock(msg, 1);
  check('Option 1 (Renew As-Is) block present', opt1.length > 0);

  // BUG 2 — Option 1 is a license renewal: it must contain NO hardware SKU.
  check('Option 1 contains NO "-HW" hardware SKU', opt1.length > 0 && !/-HW\b/.test(opt1),
    `Option 1 leaked hardware:\n   ${opt1.split('\n').filter(l => /-HW/.test(l)).join('\n   ')}`);
  check('Option 1 specifically excludes MX68CW-HW-NA', !/MX68CW-HW/.test(opt1));
  check('Option 1 specifically excludes MX68W-HW', !/MX68W-HW/.test(opt1));

  // SM-ENT quantity rides through at 84 in the Option 1 1-Year URL.
  const opt1Items = decodeUrl(opt1, '1-Year');
  const smLine = opt1Items && opt1Items.find(i => i.sku === 'LIC-MI-EMSC-D-1YMC-A-1YR');
  check('Option 1 1-Year URL carries LIC-MI-EMSC-D-1YMC-A-1YR × 84', !!smLine && smLine.qty === 84,
    `decoded SME line: ${JSON.stringify(smLine)}`);
  const opt1Items5 = decodeUrl(opt1, '5-Year');
  const sm5Line = opt1Items5 && opt1Items5.find(i => i.sku === 'LIC-MI-EMSC-D-1YMC-A-5YR');
  check('Option 1 5-Year URL carries replacement 5YR × 84', !!sm5Line && sm5Line.qty === 84,
    `decoded SME 5-year line: ${JSON.stringify(sm5Line)}`);

  // Dashboard top-to-bottom order: MR Enterprise is row 1 (→ LIC-ENT first),
  // Systems Manager is the last row (→ LIC-SME last).
  check('Option 1 is in dashboard order — MR (LIC-ENT-1YR) is first',
    !!opt1Items && opt1Items[0] && opt1Items[0].sku === 'LIC-ENT-1YR',
    `first item: ${opt1Items && JSON.stringify(opt1Items[0])}`);
  check('Option 1 is in dashboard order — Systems Manager replacement is last',
    !!opt1Items && opt1Items[opt1Items.length - 1] && opt1Items[opt1Items.length - 1].sku === 'LIC-MI-EMSC-D-1YMC-A-1YR',
    `last item: ${opt1Items && JSON.stringify(opt1Items[opt1Items.length - 1])}`);

  // Paragraph spacing so it pastes into Gmail without looking cramped.
  check('blank line between Option 1 header and the first co-term URL',
    /\*\*Option 1 - Renew As-Is:\*\*\n\n1-Year Co-Term:/.test(msg),
    `msg head: ${msg.slice(0, 160)}`);
  check('blank line between each co-term option',
    /1-Year Co-Term:[^\n]*\n\n3-Year Co-Term:[^\n]*\n\n5-Year Co-Term:/.test(msg),
    `msg: ${msg}`);
}

// ─── 4. SM-only renewal stays license-only ───────────────────────────────────
{
  const q = buildDashboardRenewalQuote([{ sku: 'SM-ENT', qty: 84 }], { mxEdition: 'Advanced Security' });
  const msg = (q && q.message) || '';
  check('SM-only renewal includes the replacement', /\bLIC-MI-EMSC-D-1YMC-A-1YR\b/.test(msg));
  check('SM-only renewal does NOT include any legacy LIC-SME SKU', !/\bLIC-SME-\d/.test(msg));
  check('SM-only renewal has no "-HW" SKU', !/-HW\b/.test(msg));
}

// ─── 5. Vision prompt instructs the model to emit Systems Manager ────────────
{
  const p = getDashboardVisionPrompt();
  check('vision prompt mentions Systems Manager', /Systems Manager/.test(p));
  check('vision prompt defines the SM-ENT token', /SM-ENT/.test(p));
}

console.log(`\n${fail === 0 ? '🎉' : '⚠️ '} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
