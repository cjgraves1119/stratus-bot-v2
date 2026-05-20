// Regression: model-agnostic renewal collapse (2026-05-20)
// Root cause: GChat routed "Generate a Meraki renewal quote for 20 cameras:
// 14x MV63, 1x MV93, 1x MV22, 2x MV12WE, 2x MV52" to the LLM crm_agent, which
// validated each camera as per-model HARDWARE (MV22-HW not found) instead of
// collapsing to model-agnostic LIC-MV. Webex cf-deterministic returned the
// correct 20x LIC-MV. This verifies the deterministic Layer-1 collapse that
// makes create_deal_and_quote match the Webex interpretation.
// Run: node test-mv-renewal-collapse-2026-05-20.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

function grab(name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('function not found in source: ' + name);
  let d = 0, started = false, j = i;
  for (; j < src.length; j++) {
    const c = src[j];
    if (c === '{') { d++; started = true; }
    else if (c === '}') { d--; if (started && d === 0) { j++; break; } }
  }
  return src.slice(i, j);
}

// Real EOL facts (kept in sync with auto-catalog _EOL_REPLACEMENTS).
const EOL_REPLACEMENTS = { 'MV22': 'MV23M', 'MV12WE': 'MV13', 'MV52': 'MV53X' };
function isEol(s) { return Object.prototype.hasOwnProperty.call(EOL_REPLACEMENTS, String(s).toUpperCase()); }
eval(grab('agnosticRenewalFamily'));
eval(grab('collapseAgnosticRenewalSkus'));

let pass = 0, fail = 0;
function eq(label, got, exp) {
  const g = JSON.stringify(got), e = JSON.stringify(exp);
  if (g === e) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label + '\n     got ' + g + '\n     exp ' + e); }
}

console.log('── model-agnostic renewal collapse ──');

// 1. Reported case under renewal:true → single MV-AGN qty 20 + EOL captured
const req = [
  { sku: 'MV63', qty: 14 }, { sku: 'MV93', qty: 1 }, { sku: 'MV22', qty: 1 },
  { sku: 'MV12WE', qty: 2 }, { sku: 'MV52', qty: 2 }
];
let r = collapseAgnosticRenewalSkus(req.map(x => ({ ...x })), { renewal: true });
eq('reported request collapses to one MV-AGN x20', r.skus, [{ sku: 'MV-AGN', qty: 20 }]);
eq('EOL units captured for refresh offer', r.eolUnits, [
  { eol: 'MV22', replacement: 'MV23M', qty: 1 },
  { eol: 'MV12WE', replacement: 'MV13', qty: 2 },
  { eol: 'MV52', replacement: 'MV53X', qty: 2 }
]);

// 2. New-hardware purchase (no renewal/license flag) must NOT collapse
eq('new hardware not collapsed (hardware preserved)',
  collapseAgnosticRenewalSkus(req.map(x => ({ ...x })), {}).collapsed, false);

// 3. Mixed family is family-scoped: MV/MR/CW/MT collapse, MS/MX stay per-model
let mixed = [
  { sku: 'MV63', qty: 5 }, { sku: 'MR46', qty: 3 }, { sku: 'CW9164', qty: 2 },
  { sku: 'MS130-8P', qty: 4 }, { sku: 'MX67', qty: 1 }, { sku: 'MT14', qty: 6 }
];
eq('mixed family-scoped collapse', collapseAgnosticRenewalSkus(mixed, { renewal: true }).skus, [
  { sku: 'MS130-8P', qty: 4 }, { sku: 'MX67', qty: 1 },
  { sku: 'MV-AGN', qty: 5 }, { sku: 'MR-AGN', qty: 5 }, { sku: 'MT-AGN', qty: 6 }
]);

// 4. license_only triggers collapse; explicit LIC-* passes through
eq('license_only + explicit LIC passthrough',
  collapseAgnosticRenewalSkus([{ sku: 'MV63', qty: 10 }, { sku: 'LIC-MV-3YR', qty: 2 }], { licenseOnly: true }).skus,
  [{ sku: 'LIC-MV-3YR', qty: 2 }, { sku: 'MV-AGN', qty: 10 }]);

// 5. EOL-only renewal still collapses to license, no hardware lookup
eq('EOL-only renewal → MV-AGN x5',
  collapseAgnosticRenewalSkus([{ sku: 'MV22', qty: 5 }], { renewal: true }).skus,
  [{ sku: 'MV-AGN', qty: 5 }]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
