// Regression test: License-dashboard vision extraction must not drop MX85
// when a colored annotation crosses between MX65 and MX85 rows.
//
// Codex's live test on 2026-05-05 sent the ENG Design dashboard screenshot
// and got back ONLY MR-ENT × 3 (no MX85). Ground truth: MR-ENT 3, MX85 1,
// MT 0 (skip), MX65 1/0 (skip). The first vision pass dropped MX85, likely
// because of a red underline that crosses between MX65 and MX85.
//
// Fix shape:
//   1. Prompt teaches that colored annotations are NOT table boundaries
//      and the row below the annotation must still be read.
//   2. shouldAuditDashboardVision() flags suspicious first-pass output
//      (MR-only OR MX65-without-other-MX) and triggers a second audit pass.
//   3. mergeVisionSkusMax() combines first + audit by MAX qty so
//      re-emitted rows (MR-ENT in both passes) don't double-count.
//   4. Caption handling: a user-supplied text caption no longer replaces
//      the dashboard prompt — it's appended as additional context.

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
src += `
module.exports = {
  getDashboardVisionPrompt,
  getDashboardVisionAuditPrompt,
  shouldAuditDashboardVision,
  mergeVisionSkusMax,
  extractSkusFromVisionText,
  parseMessage,
  buildQuoteResponse
};`;
const tmp = path.join(os.tmpdir(), `stratus-dashvision-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const m = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
};

// ─── 1. Prompt content ──────────────────────────────────────────────────────
{
  const prompt = m.getDashboardVisionPrompt();
  check('Prompt mentions red/yellow/blue annotation rule',
    /annotation|red\/yellow\/blue|underline/i.test(prompt));
  check('Prompt has the worked MX65 → MX85 example',
    /MX65[\s\S]*MX85/i.test(prompt));
}

// ─── 2. Audit prompt embeds first response ──────────────────────────────────
{
  const first = `LICENSE_DASHBOARD_PARSE_V1\n---\nSKU: MR-ENT | LIMIT: 5 | ACTIVE: 3\n---`;
  const audit = m.getDashboardVisionAuditPrompt(first);
  check('Audit prompt includes the first-pass output verbatim',
    audit.includes(first));
  check('Audit prompt mentions the MAX-qty merge rule',
    /MAX qty/i.test(audit));
  check('Audit prompt mentions MX65 → MX85 adjacency check',
    /MX65[\s\S]*MX85/i.test(audit));
}

// ─── 3. shouldAuditDashboardVision triggers ────────────────────────────────
{
  const mrOnly = `LICENSE_DASHBOARD_PARSE_V1\n---\nSKU: MR-ENT | LIMIT: 5 | ACTIVE: 3\n---`;
  check('Audit triggers on MR-ENT-only first pass',
    m.shouldAuditDashboardVision(mrOnly) === true);

  const mx65WithoutOtherMx = `LICENSE_DASHBOARD_PARSE_V1\n---\nSKU: MX65 | LIMIT: 1 | ACTIVE: 1\nSKU: MR-ENT | LIMIT: 5 | ACTIVE: 3\n---`;
  check('Audit triggers when MX65 present but no MX85/95/etc.',
    m.shouldAuditDashboardVision(mx65WithoutOtherMx) === true);

  const mxComplete = `LICENSE_DASHBOARD_PARSE_V1\n---\nSKU: MR-ENT | LIMIT: 5 | ACTIVE: 3\nSKU: MX85 | LIMIT: 1 | ACTIVE: 1\n---`;
  check('Audit does NOT trigger when MR + a real MX device are both present',
    m.shouldAuditDashboardVision(mxComplete) === false);

  check('Audit does NOT trigger on empty input',
    m.shouldAuditDashboardVision('') === false);
}

// ─── 4. mergeVisionSkusMax — recovers MX85 without double-counting MR-ENT ───
{
  const first = [{ sku: 'MR-ENT', qty: 3 }];
  const audit = [{ sku: 'MR-ENT', qty: 3 }, { sku: 'MX85', qty: 1 }];
  const merged = m.mergeVisionSkusMax(first, audit);
  const mrEnt = merged.find(s => s.sku === 'MR-ENT');
  const mx85 = merged.find(s => s.sku === 'MX85');
  check('Audit merge recovers MX85 missing from first pass',
    !!mx85 && mx85.qty === 1, JSON.stringify(merged));
  check('Audit merge does NOT double-count MR-ENT (max not sum)',
    !!mrEnt && mrEnt.qty === 3, JSON.stringify(merged));

  // If audit found a higher qty than first pass, take audit's qty.
  const merged2 = m.mergeVisionSkusMax([{sku:'MR-ENT',qty:2}], [{sku:'MR-ENT',qty:5}]);
  check('Audit merge takes the larger qty when first/audit disagree',
    merged2[0].qty === 5);
}

// ─── 5. End-to-end: MX85 from audit → renders MX85-HW + LIC-MX85-SEC-3Y ────
{
  // After the audit merge the deterministic engine should be able to quote
  // the recovered MX85. We exercise the same parseMessage + buildQuoteResponse
  // chain the worker uses post-vision to confirm the SKU is fully resolvable.
  const skuText = '1 MX85';
  const parsed = m.parseMessage(skuText);
  const out = parsed && m.buildQuoteResponse(parsed);
  const msg = out && out.message;
  check('MX85 vision-recovered SKU renders MX85-HW',
    !!msg && /MX85-HW\b/.test(msg), `msg=${msg}`);
  check('MX85 vision-recovered SKU includes LIC-MX85-SEC-3Y (default 3y)',
    !!msg && /LIC-MX85-SEC-3Y/.test(msg), `msg=${msg}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
