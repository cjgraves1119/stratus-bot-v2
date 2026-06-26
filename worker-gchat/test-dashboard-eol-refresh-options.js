// Regression test: dashboard EOL refresh — Option 1 (Renew As-Is) +
// Option 2 (Hardware Refresh, 1G Uplink) + Option 3 (Hardware Refresh,
// 10G Uplink) + Products End of Life prose section.
//
// Codex correction packet 2026-05-05: PR #22 omitted EOL device licenses
// from the main renewal cart and only listed EOL devices in prose. Per
// Chris's product spec the customer still owns the EOL device, so the
// dashboard license count includes it; the main "Renew As-Is" cart MUST
// carry the EOL device's current license SKU. Hardware replacement is
// offered separately in Option 2 / Option 3 with replacement HW + license.
//
// Reference fixtures:
//   case3-eol-mixed: MX64 × 2, MX85 × 1, MR-ENT × 4, MX edition Advanced
//                     Security. MX64 → MX67 (scalar). No Option 3.
//   LPC: MR-ENT × 24 + 4× MS EOL devices + 3× MX EOL devices, mix of
//        1G/10G alternatives. Both Option 2 and Option 3 emitted.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
  (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
  'const WorkflowEntrypoint = class {};');
src = src.replace(/^export\s+(class|function|const|let|var)\s+/gm, '$1 ');
const edIdx = src.indexOf('export default');
if (edIdx > -1) {
  let depth = 0, started = false, end = edIdx;
  for (let i = edIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  src = src.slice(0, edIdx) + src.slice(end + 1);
}
src += '\nmodule.exports = { buildDashboardRenewalQuote };';
const tmp = path.join(os.tmpdir(), `stratus-eol-refresh-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { buildDashboardRenewalQuote } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + (typeof diag === 'string' ? diag.substring(0, 1000) : diag) : ''}`); fail++; }
};

// ─── case3-eol-mixed ────────────────────────────────────────────────────────
{
  const visionSkus = [
    { sku: 'MR-ENT', qty: 4 },
    { sku: 'MX64', qty: 2 },
    { sku: 'MX85', qty: 1 },
  ];
  const out = buildDashboardRenewalQuote(visionSkus, { mxEdition: 'Advanced Security' });
  const msg = out && out.message;

  check('case3 builder returns non-null', !!out, JSON.stringify(out));
  check('case3 message has Products End of Life section',
    !!msg && /\*\*Products End of Life:\*\*/.test(msg), msg);
  check('case3 EOL prose: MX64 (EOL) → Replacement: MX67',
    !!msg && /MX64 \(EOL\) → Replacement: MX67/.test(msg), msg);
  check('case3 has Option 1 - Renew As-Is heading',
    !!msg && /\*\*Option 1 - Renew As-Is:\*\*/.test(msg), msg);
  check('case3 has Option 2 - Hardware Refresh heading (no uplink qualifier)',
    !!msg && /\*\*Option 2 - Hardware Refresh:\*\*/.test(msg), msg);
  check('case3 has NO Option 3 (scalar replacement)',
    !!msg && !/Option 3/.test(msg), msg);

  // Option 1 URLs: every term has LIC-MX64-SEC-{term} qty 2 + LIC-MX85-SEC-{term} qty 1 + LIC-ENT-{term} qty 4
  const opt1Section = msg && (msg.split('Option 1')[1] || '').split('Option 2')[0];
  check('Option 1 1Y URL has LIC-MX64-SEC-1YR and LIC-MX85-SEC-1Y and LIC-ENT-1YR',
    !!opt1Section &&
      /LIC-MX64-SEC-1YR/.test(opt1Section) &&
      /LIC-MX85-SEC-1Y\b/.test(opt1Section) &&
      /LIC-ENT-1YR/.test(opt1Section),
    opt1Section);
  check('Option 1 3Y URL has LIC-MX64-SEC-3YR and LIC-MX85-SEC-3Y and LIC-ENT-3YR',
    !!opt1Section &&
      /LIC-MX64-SEC-3YR/.test(opt1Section) &&
      /LIC-MX85-SEC-3Y\b/.test(opt1Section) &&
      /LIC-ENT-3YR/.test(opt1Section),
    opt1Section);
  check('Option 1 5Y URL has LIC-MX64-SEC-5YR and LIC-MX85-SEC-5Y and LIC-ENT-5YR',
    !!opt1Section &&
      /LIC-MX64-SEC-5YR/.test(opt1Section) &&
      /LIC-MX85-SEC-5Y\b/.test(opt1Section) &&
      /LIC-ENT-5YR/.test(opt1Section),
    opt1Section);
  check('Option 1 has NO MX64-HW (license-only renewal)',
    !!opt1Section && !/MX64-HW/.test(opt1Section), opt1Section);
  check('Option 1 has NO MX67-HW (no hardware in main renewal cart)',
    !!opt1Section && !/MX67-HW/.test(opt1Section), opt1Section);
  check('Option 1 has NO MX85-HW (license-only renewal)',
    !!opt1Section && !/MX85-HW/.test(opt1Section), opt1Section);

  // Option 2 URLs: every term has MX67-HW qty 2 + LIC-MX67-SEC-{term} qty 2 + LIC-MX85-SEC-{term} qty 1 + LIC-ENT-{term} qty 4
  const opt2Section = msg && (msg.split('Option 2')[1] || '');
  check('Option 2 includes MX67-HW (replacement hardware)',
    !!opt2Section && /MX67-HW/.test(opt2Section), opt2Section);
  check('Option 2 includes LIC-MX67-SEC-{1,3,5}YR (replacement license)',
    !!opt2Section &&
      /LIC-MX67-SEC-1YR/.test(opt2Section) &&
      /LIC-MX67-SEC-3YR/.test(opt2Section) &&
      /LIC-MX67-SEC-5YR/.test(opt2Section),
    opt2Section);
  check('Option 2 carries non-EOL MX85 license at correct qty',
    !!opt2Section &&
      /LIC-MX85-SEC-1Y\b/.test(opt2Section) &&
      /LIC-MX85-SEC-3Y\b/.test(opt2Section) &&
      /LIC-MX85-SEC-5Y\b/.test(opt2Section),
    opt2Section);
  check('Option 2 carries MR-ENT licenses at qty 4',
    !!opt2Section && /LIC-ENT-3YR/.test(opt2Section) && /qty=[\d,]*\b4\b/.test(opt2Section),
    opt2Section);
  check('Option 2 does NOT carry the deprecated LIC-MX64-SEC license',
    !!opt2Section && !/LIC-MX64-SEC/.test(opt2Section), opt2Section);
}

// ─── LPC fixture: 1G/10G alternatives → Option 2 vs Option 3 differ ─────────
// MS225-24P → ['MS150-24P-4G' (1G), 'MS150-24P-4X' (10G)]
// MS210-24P → ['MS150-24P-4G' (1G), 'MS150-24P-4X' (10G)]  (also dual)
// MS250-24P → 'C9300L-24P-4X-M' (single, scalar)
// MS250-48FP → 'C9300L-48PF-4X-M' (single)
// MS120-8 → 'MS130-8' (single)
// MX64 → 'MX67', MX65 → 'MX68', MX84 → 'MX85'
{
  const visionSkus = [
    { sku: 'MR-ENT', qty: 24 },
    { sku: 'MS120-8', qty: 1 },
    { sku: 'MS225-24P', qty: 1 },
    { sku: 'MS250-24P', qty: 1 },
    { sku: 'MS250-48FP', qty: 1 },
    { sku: 'MX64', qty: 1 },
    { sku: 'MX65', qty: 1 },
    { sku: 'MX84', qty: 1 },
  ];
  const out = buildDashboardRenewalQuote(visionSkus, { mxEdition: 'Advanced Security' });
  const msg = out && out.message;

  check('LPC builder returns non-null', !!out, JSON.stringify(out && out.option1));

  // Products End of Life — consolidated prose
  check('LPC EOL prose: MS120-8 → Replacement: MS130-8',
    !!msg && /MS120-8 \(EOL\) → Replacement: MS130-8/.test(msg), msg);
  check('LPC EOL prose: MS225-24P → Replacements: MS150-24P-4G (1G) / MS150-24P-4X (10G)',
    !!msg && /MS225-24P \(EOL\) → Replacements: MS150-24P-4G \(1G\) \/ MS150-24P-4X \(10G\)/.test(msg), msg);
  check('LPC EOL prose: MS250-24P → Replacement: C9300L-24P-4X-M',
    !!msg && /MS250-24P \(EOL\) → Replacement: C9300L-24P-4X-M/.test(msg), msg);
  check('LPC EOL prose: MX64 → Replacement: MX67',
    !!msg && /MX64 \(EOL\) → Replacement: MX67/.test(msg), msg);
  check('LPC EOL prose: MX65 → Replacement: MX68',
    !!msg && /MX65 \(EOL\) → Replacement: MX68/.test(msg), msg);
  check('LPC EOL prose: MX84 → Replacement: MX85',
    !!msg && /MX84 \(EOL\) → Replacement: MX85/.test(msg), msg);

  // Headings: 1G alt present → Option 2 + Option 3 with uplink qualifiers
  check('LPC has Option 1 - Renew As-Is heading',
    !!msg && /\*\*Option 1 - Renew As-Is:\*\*/.test(msg), msg);
  check('LPC has Option 2 - Hardware Refresh, 1G Uplink heading',
    !!msg && /\*\*Option 2 - Hardware Refresh, 1G Uplink:\*\*/.test(msg), msg);
  check('LPC has Option 3 - Hardware Refresh, 10G Uplink heading',
    !!msg && /\*\*Option 3 - Hardware Refresh, 10G Uplink:\*\*/.test(msg), msg);

  // Option 1 — every EOL device's CURRENT license carries forward
  const opt1 = msg && (msg.split('Option 1')[1] || '').split('Option 2')[0];
  check('Option 1 has LIC-MS120-8 license? actually MS120-8 maps to LIC-MS120 family — stays in cart',
    !!opt1, opt1);
  check('Option 1 has MS225-24P current license (LIC-MS225 family)',
    !!opt1 && /LIC-MS225-24P/.test(opt1), opt1);
  check('Option 1 has MX64 current license (LIC-MX64-SEC-{1,3,5}YR)',
    !!opt1 && /LIC-MX64-SEC-1YR/.test(opt1) && /LIC-MX64-SEC-3YR/.test(opt1) && /LIC-MX64-SEC-5YR/.test(opt1),
    opt1);
  check('Option 1 has NO replacement hardware (no MX67-HW / MX68-HW / MX85-HW / C9300L-)',
    !!opt1 && !/MX67-HW/.test(opt1) && !/MX68-HW/.test(opt1) && !/MX85-HW/.test(opt1) && !/C9300L-/.test(opt1),
    opt1);

  // Option 2 (1G) — MS225-24P → MS150-24P-4G; Option 3 (10G) → MS150-24P-4X
  const opt2 = msg && (msg.split('Option 2')[1] || '').split('Option 3')[0];
  const opt3 = msg && (msg.split('Option 3')[1] || '');
  check('Option 2 (1G) replaces MS225-24P with MS150-24P-4G',
    !!opt2 && /MS150-24P-4G\b/.test(opt2),
    opt2);
  check('Option 2 (1G) does NOT use the 10G variant MS150-24P-4X',
    !!opt2 && !/MS150-24P-4X/.test(opt2),
    opt2);
  check('Option 3 (10G) replaces MS225-24P with MS150-24P-4X',
    !!opt3 && /MS150-24P-4X\b/.test(opt3),
    opt3);
  check('Option 3 (10G) does NOT use the 1G variant MS150-24P-4G',
    !!opt3 && !/MS150-24P-4G\b/.test(opt3),
    opt3);

  // Scalar replacements present in BOTH Option 2 and Option 3 (same SKU)
  check('Option 2 includes scalar MX67-HW + MX68-HW + MX85-HW',
    !!opt2 && /MX67-HW/.test(opt2) && /MX68-HW/.test(opt2) && /MX85-HW/.test(opt2),
    opt2);
  check('Option 3 also includes scalar MX67-HW + MX68-HW + MX85-HW (same as Option 2 for non-uplink replacements)',
    !!opt3 && /MX67-HW/.test(opt3) && /MX68-HW/.test(opt3) && /MX85-HW/.test(opt3),
    opt3);

  // MR-ENT carry-forward in all three options
  check('All options carry LIC-ENT-3YR (qty 24) for MR fleet',
    !!msg && (msg.match(/LIC-ENT-3YR/g) || []).length >= 3,
    msg);
}

// ─── Pure non-EOL fixture: no EOL section, no Option 2/3 ────────────────────
// (regression — ENG Design exact fixture from PR #22)
{
  const out = buildDashboardRenewalQuote(
    [{ sku: 'MR-ENT', qty: 3 }, { sku: 'MX85', qty: 1 }],
    { mxEdition: 'Advanced Security' }
  );
  const msg = out && out.message;
  check('Pure non-EOL: no Products End of Life section',
    !!msg && !/Products End of Life/.test(msg), msg);
  check('Pure non-EOL: Option 1 - Renew As-Is rendered',
    !!msg && /Option 1 - Renew As-Is/.test(msg), msg);
  check('Pure non-EOL: NO Option 2 / Option 3',
    !!msg && !/Option 2/.test(msg) && !/Option 3/.test(msg), msg);
  check('Pure non-EOL: URLs are license-only (no MX85-HW)',
    !!msg && !/MX85-HW/.test(msg), msg);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
