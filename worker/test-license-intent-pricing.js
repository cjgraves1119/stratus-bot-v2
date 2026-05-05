// Regression test: `handlePricingRequest` license-intent detection.
// Codex 2026-05-04: "cost of 68 MX68CW licenses 3 year" returned hardware-only
// (item=MX68CW&qty=68) because the wantsLicense regex required a literal "with".
// Per Chris's product spec, "MODEL licenses [N year]" without "with" is a
// license-only renewal intent (customer already owns the device).
//
// Three modes after the fix:
//   bundle: "with [N year] license" → hardware + license (existing)
//   only:   trailing "licenses [N year]" → license-only (NEW, this PR)
//   null:   no license keyword → hardware-only (existing)

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
src += '\nmodule.exports = { handlePricingRequest };';
const tmp = path.join(os.tmpdir(), `stratus-licintent-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { handlePricingRequest } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + (typeof diag === 'string' ? diag.substring(0, 600) : diag) : ''}`); fail++; }
};

(async () => {
  // ─── Codex's exact failure case ─────────────────────────────────────────
  {
    const reply = await handlePricingRequest('cost of 68 MX68CW licenses 3 year');
    check('Codex case: "cost of 68 MX68CW licenses 3 year" returns a reply',
      typeof reply === 'string' && reply.length > 0,
      `reply=${reply}`);
    check('Codex case: reply contains LIC-MX68CW-SEC-3YR (license-only intent)',
      typeof reply === 'string' && /LIC-MX68CW-SEC-3YR/.test(reply),
      `reply=${reply}`);
    check('Codex case: reply does NOT contain bare MX68CW hardware SKU',
      typeof reply === 'string' && !/[?,]MX68CW(?:-HW-NA)?[&\s,]/.test(reply) && !/item=MX68CW(?:-HW-NA)?[&\s]/.test(reply),
      `reply=${reply}`);
    check('Codex case: reply mentions qty 68 in some form',
      typeof reply === 'string' && /\b68\b/.test(reply),
      `reply=${reply}`);
  }

  // ─── Variant phrasings — license-only intent ────────────────────────────
  {
    const r = await handlePricingRequest('price for 5 MR44 licenses 3 year');
    check('"price for 5 MR44 licenses 3 year" → license-only',
      typeof r === 'string' && /LIC-ENT-3YR/.test(r) && !/MR44-HW/.test(r),
      `r=${r}`);
  }
  {
    const r = await handlePricingRequest('cost of 10 MX85 license');
    check('"cost of 10 MX85 license" (singular) → license-only at default 3y',
      typeof r === 'string' && /LIC-MX85-SEC-3Y\b/.test(r) && !/MX85-HW/.test(r),
      `r=${r}`);
  }
  {
    const r = await handlePricingRequest('cost of 10 MX85 licenses 1 year');
    check('"cost of 10 MX85 licenses 1 year" → 1Y license-only',
      typeof r === 'string' && /LIC-MX85-SEC-1Y\b/.test(r) && !/LIC-MX85-SEC-3Y\b/.test(r) && !/MX85-HW/.test(r),
      `r=${r}`);
  }

  // ─── Bundle intent ("with") still bundles hardware + license ────────────
  {
    const r = await handlePricingRequest('cost of 5 MR44 with 3 year license');
    check('"cost of 5 MR44 with 3 year license" → bundle (HW + license)',
      typeof r === 'string' && /\bMR44\b/.test(r) && /LIC-ENT-3YR/.test(r),
      `r=${r}`);
  }
  {
    const r = await handlePricingRequest('how much is MR44 with licensing');
    check('"how much is MR44 with licensing" → bundle (HW + license)',
      typeof r === 'string' && /\bMR44\b/.test(r) && /LIC-ENT-3YR/.test(r),
      `r=${r}`);
  }

  // ─── No license keyword → hardware-only (existing behavior) ─────────────
  {
    const r = await handlePricingRequest('cost of 68 MX68CW-HW-NA hardware only');
    check('"cost of 68 MX68CW-HW-NA hardware only" → hardware-only (no license)',
      typeof r === 'string' && /MX68CW-HW-NA/.test(r) && !/LIC-/.test(r),
      `r=${r}`);
  }
  {
    const r = await handlePricingRequest('how much is MR44');
    check('"how much is MR44" (no license keyword) → hardware-only',
      typeof r === 'string' && /\bMR44\b/.test(r) && !/LIC-/.test(r),
      `r=${r}`);
  }

  // ─── "no licenses" / "without licenses" should NOT trigger license intent ─
  {
    const r = await handlePricingRequest('cost of 5 MR44 no licenses');
    check('"cost of 5 MR44 no licenses" → hardware-only (negation respected)',
      typeof r === 'string' && /\bMR44\b/.test(r) && !/LIC-/.test(r),
      `r=${r}`);
  }

  // ─── Tier override on license-only intent ───────────────────────────────
  {
    const r = await handlePricingRequest('cost of 10 MX85 SDW licenses 5 year');
    check('"cost of 10 MX85 SDW licenses 5 year" → SDW tier 5Y license-only',
      typeof r === 'string' && /LIC-MX85-SDW-5Y\b/.test(r) && !/LIC-MX85-SEC-/.test(r),
      `r=${r}`);
  }

  // ─── Singular phrasing without qty ──────────────────────────────────────
  {
    const r = await handlePricingRequest('cost of MX85 license');
    check('"cost of MX85 license" (no qty) → license-only at default qty 1',
      typeof r === 'string' && /LIC-MX85-SEC-3Y\b/.test(r) && !/MX85-HW/.test(r),
      `r=${r}`);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
