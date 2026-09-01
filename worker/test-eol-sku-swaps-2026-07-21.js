// EOL SKU swaps (Webex worker) — twin of worker-gchat/test-eol-sku-swaps-2026-07-21.js.
// Guards the three end-of-sale rules from HANDOFF-eol-sku-swaps.md (2026-07-13),
// ported to worker/ 2026-07-21:
//   1. vMX requires an edition: LIC-VMX-{S,M,L,XL}-{n}(YR|Y) →
//      LIC-VMX-{size}-{ENT|SEC}-{n}Y (dashboard edition → sibling MX → ENT).
//      Bare model-number vMX (LIC-VMX100) is flagged, never auto-sized.
//   2. Systems Manager retired: LIC-SME-{n}YR → LIC-MI-EMSC-D-1YMC-A-{n}YR
//      (Ivanti Neurons for MDM), quantity floor 50, product URL attached.
//   3. Meraki Insight retired: LIC-MI-{S,M,L}-* dropped, MX -SEC- lines
//      upgraded to -SDW-. LIC-MI-EMSC-… is the Ivanti target, NOT Insight.
//
// Run: node worker/test-eol-sku-swaps-2026-07-21.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine(exportNames) {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { ${exportNames.join(', ')} };`;
  const tmp = path.join(os.tmpdir(), `eol-swaps-wbx-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

const G = loadEngine([
  'applyEolSwaps', 'buildStratusUrl', 'buildPricingBlock', 'parseStratusUrl',
  'normalizeDirectLicenseSku', 'buildDashboardRenewalQuote', 'swapEolUrlsInText',
]);

const HANDOFF_INPUT = [
  { sku: 'LIC-VMX-S-3YR', qty: 1 },
  { sku: 'LIC-SME-3YR', qty: 8 },
  { sku: 'LIC-MI-M-3YR', qty: 1 },
  { sku: 'LIC-MX84-SEC-3YR', qty: 2 },
  { sku: 'LIC-ENT-3YR', qty: 20 },
];

(() => {
  // ── 1. The handoff's verified regression case (MX edition Advanced Security) ──
  console.log('applyEolSwaps: handoff verified case');
  const r = G.applyEolSwaps(HANDOFF_INPUT, 'Advanced Security');
  const skus = r.lines.map(l => `${l.sku} x${l.qty}`);
  ok(skus.join(', ') === 'LIC-VMX-S-SEC-3Y x1, LIC-MI-EMSC-D-1YMC-A-3YR x50, LIC-MX84-SDW-3Y x2, LIC-ENT-3YR x20',
    `verified output lines (got: ${skus.join(', ')})`);
  ok(r.notes.some(n => /Insight is retired.*SD-WAN Plus/.test(n)), 'Insight retirement + SDW upgrade note emitted');
  ok(r.ivantiUrl === 'https://www.stratusinfosystems.com/shop/product/ivanti-neurons-for-mdm-per-device',
    'Ivanti product URL attached');
  ok(r.lines.some(l => /qty raised from 8/.test(l.flag || '')), 'SME line flags the 8→50 qty raise');

  // Idempotent: re-running the swap on its own output changes nothing.
  const r2 = G.applyEolSwaps(r.lines, 'Advanced Security');
  ok(JSON.stringify(r2.lines.map(l => [l.sku, l.qty])) === JSON.stringify(r.lines.map(l => [l.sku, l.qty])),
    'idempotent on already-swapped lines');

  // ── 2. Order-link form through buildStratusUrl (the call-site safety net) ──
  console.log('buildStratusUrl safety net');
  const url = G.buildStratusUrl(HANDOFF_INPUT);
  ok(url === 'https://stratusinfosystems.com/order/?item=LIC-VMX-S-SEC-3Y,LIC-MI-EMSC-D-1YMC-A-3YR,LIC-MX84-SDW-3Y,LIC-ENT-3YR&qty=1,50,2,20',
    `order-link form matches handoff (got: ${url})`);
  ok(!/LIC-SME|LIC-MI-[SML]-|LIC-VMX-S-3YR/.test(url), 'no retired SKU in the link');

  // Pricing block agrees with the link (same swap applied).
  const block = G.buildPricingBlock(HANDOFF_INPUT, true);
  ok(/50 × LIC-MI-EMSC-D-1YMC-A-3YR/.test(block) && /LIC-MX84-SDW-3Y/.test(block) && !/LIC-SME|LIC-MI-M/.test(block),
    'pricing block shows swapped SKUs and floored qty');

  // ── 3. Edition resolution ──
  console.log('edition resolution');
  ok(G.applyEolSwaps([{ sku: 'LIC-VMX-S-3YR', qty: 1 }, { sku: 'LIC-MX84-SEC-3YR', qty: 1 }]).lines[0].sku === 'LIC-VMX-S-SEC-3Y',
    'no dashboard edition → inferred SEC from sibling MX-SEC line');
  ok(G.applyEolSwaps([{ sku: 'LIC-VMX-S-3YR', qty: 1 }]).lines[0].sku === 'LIC-VMX-S-ENT-3Y',
    'no dashboard edition, no siblings → default ENT');
  ok(G.applyEolSwaps([{ sku: 'LIC-VMX-M-1YR', qty: 2 }], 'Enterprise').lines[0].sku === 'LIC-VMX-M-ENT-1Y',
    'explicit Enterprise edition → ENT');

  // ── 4. Guardrails ──
  console.log('guardrails');
  const vmx100 = G.applyEolSwaps([{ sku: 'LIC-VMX100', qty: 1 }]);
  ok(vmx100.lines[0].sku === 'LIC-VMX100' && vmx100.lines[0].valid === false && /retired vMX/.test(vmx100.lines[0].flag),
    'model-number vMX (LIC-VMX100) flagged, never auto-sized');
  const ivanti = G.applyEolSwaps([{ sku: 'LIC-MI-EMSC-D-1YMC-A-3YR', qty: 100 }]);
  ok(ivanti.lines.length === 1 && ivanti.lines[0].sku === 'LIC-MI-EMSC-D-1YMC-A-3YR' && ivanti.lines[0].qty === 100,
    'LIC-MI-EMSC-… (Ivanti target) NOT matched as Insight, qty ≥50 untouched');
  ok(G.applyEolSwaps([{ sku: 'LIC-MI-EMSC-D-1YMC-A-3YR', qty: 8 }]).lines[0].qty === 50,
    'pre-substituted Ivanti line below the minimum floored to 50');
  const noMx = G.applyEolSwaps([{ sku: 'LIC-MI-M-3YR', qty: 1 }, { sku: 'LIC-ENT-3YR', qty: 5 }]);
  ok(noMx.lines.length === 1 && noMx.notes.some(n => /no MX Advanced Security line/.test(n)),
    'Insight with no MX-SEC line → dropped with manual-review note');
  ok(G.applyEolSwaps([{ sku: 'LIC-MX84-SEC-3YR', qty: 2 }]).lines[0].sku === 'LIC-MX84-SEC-3YR',
    'MX -SEC- untouched when no Insight line present');

  // ── 5. Legacy tokens in pasted/old URLs ──
  console.log('parseStratusUrl legacy swap');
  const parsed = G.parseStratusUrl('https://stratusinfosystems.com/order/?item=LIC-VMX-S-3YR,LIC-SME-3YR,LIC-MI-M-3YR,LIC-MX84-SEC-3YR&qty=1,8,1,2');
  ok(parsed && parsed.skus.join(',') === 'LIC-VMX-S-SEC-3Y,LIC-MI-EMSC-D-1YMC-A-3YR,LIC-MX84-SDW-3Y' && parsed.qtys.join(',') === '1,50,2',
    `pasted legacy URL re-parsed to swapped SKUs (got: ${parsed && parsed.skus.join(',')} @ ${parsed && parsed.qtys.join(',')})`);

  // ── 6. Typed single direct SKUs ──
  console.log('normalizeDirectLicenseSku');
  const vd = G.normalizeDirectLicenseSku('LIC-VMX-S-3YR');
  ok(vd.sku === 'LIC-VMX-S-ENT-3Y' && /require an edition/.test(vd.note), 'typed editionless vMX → ENT + note');
  const v100 = G.normalizeDirectLicenseSku('LIC-VMX100');
  ok(v100.invalid === true && /retired vMX/.test(v100.note), 'typed LIC-VMX100 → invalid + flag');
  const mi = G.normalizeDirectLicenseSku('LIC-MI-M-3YR');
  ok(mi.invalid === true && /Insight is retired/.test(mi.note), 'typed Insight SKU → invalid + retirement note');
  ok(G.normalizeDirectLicenseSku('LIC-MI-EMSC-D-1YMC-A-3YR').sku === 'LIC-MI-EMSC-D-1YMC-A-3YR',
    'typed Ivanti SKU passes through clean');

  // ── 7. Dashboard renewal flow (rows + MX_EDITION from the vision parse) ──
  console.log('buildDashboardRenewalQuote');
  const dash = G.buildDashboardRenewalQuote([
    { sku: 'LIC-VMX-S-3YR', qty: 1 },
    { sku: 'LIC-MI-M-3YR', qty: 1 },
    { sku: 'LIC-MX84-SEC-3YR', qty: 2 },
  ], { mxEdition: 'Advanced Security' });
  ok(dash && /LIC-VMX-S-SEC-3Y/.test(dash.message) && /LIC-MX84-SDW-3Y/.test(dash.message),
    'dashboard rows: vMX edition applied and MX SEC→SDW upgraded');
  ok(dash && !/LIC-MI-M-3YR|LIC-SME/.test(dash.message), 'no retired SKU in the dashboard renewal message');
  ok(dash && /Insight is retired/.test(dash.message), 'Insight retirement note reaches the dashboard message');

  // ── 8. Claude-composed reply text (URLs written by the model, not the builder) ──
  console.log('swapEolUrlsInText (Claude reply seam)');
  const claudeText = 'Here are the ecomm links for 20 licenses:\n' +
    '**1-Year:** https://stratusinfosystems.com/order/?item=LIC-MI-EMSC-D-1YMC-A-1YR&qty=20\n' +
    '**Legacy:** https://stratusinfosystems.com/order/?item=LIC-SME-3YR&qty=8\n' +
    'Let me know which term works.';
  const fixed = G.swapEolUrlsInText(claudeText);
  ok(/item=LIC-MI-EMSC-D-1YMC-A-1YR&qty=50/.test(fixed) && /item=LIC-MI-EMSC-D-1YMC-A-3YR&qty=50/.test(fixed)
    && !/LIC-SME|qty=20|qty=8/.test(fixed) && /Let me know which term works\./.test(fixed),
    'Claude-written URLs re-rendered through the swap (floor 50, SME→Ivanti), prose untouched');
  const cleanText = 'Quote: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=5,5 — thanks!';
  ok(G.swapEolUrlsInText(cleanText) === cleanText, 'clean URLs round-trip byte-identical');
  ok(G.swapEolUrlsInText(null) === '' && G.swapEolUrlsInText('no urls here') === 'no urls here', 'null/plain-text safe');

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
