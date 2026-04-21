// Unit test: the two Duo revision flows Chris reported broken in Webex:
//   (2a) "just 3 year licenses" — narrows a 9-SKU Duo prior to 3 (one per tier, 3YR)
//   (2b) "as separate quotes"  — flips a legacy combined prior into per-tier mode
// Also verifies extractPriorFromAssistantUrl promotes Duo/Umbrella license
// pools into isTermOptionQuote shape so revisions are structural, not just
// metadata the renderer ignores.

const fs = require('fs');
const path = require('path');
const os = require('os');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += '\nmodule.exports = { applyV2Revision, extractPriorFromAssistantUrl, buildQuoteResponse };';
  const p = path.join(os.tmpdir(), `stratus-duo-revise-shim-${process.pid}.cjs`);
  fs.writeFileSync(p, src);
  return require(p);
}

const { applyV2Revision, extractPriorFromAssistantUrl, buildQuoteResponse } = buildShim();

let pass = 0, fail = 0;
function check(desc, cond, diag) {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
}

// Assistant's prior response: the 9 per-tier URLs from Chris's successful initial quote
const priorAssistantMsg = `**Duo Essentials:**
1-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=1
3-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=1
5-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-5YR&qty=1

**Duo Advantage:**
1-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-1YR&qty=1
3-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-3YR&qty=1
5-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=1

**Duo Premier:**
1-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-PREMIER-1YR&qty=1
3-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-PREMIER-3YR&qty=1
5-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-PREMIER-5YR&qty=1`;

// ── Prior extraction: should promote to isTermOptionQuote ─────────────────
const prior = extractPriorFromAssistantUrl(priorAssistantMsg);
check('prior promoted to isTermOptionQuote shape',
  prior?.isTermOptionQuote === true,
  `got isTermOptionQuote=${prior?.isTermOptionQuote}, hasDLL=${!!prior?.directLicenseList}`);
check('prior has 9 items',
  (prior?.items?.length || 0) === 9,
  `got ${prior?.items?.length} items`);
check('prior modifiers.separateQuotes=true',
  prior?.modifiers?.separateQuotes === true,
  `got ${prior?.modifiers?.separateQuotes}`);
check('prior has NO directLicenseList',
  prior?.directLicenseList === undefined,
  `still has DLL with ${prior?.directLicenseList?.length} items`);

// ── Revision 2a: change_term=3 ────────────────────────────────────────────
const v2changeTerm = { revision: { action: 'change_term', new_term: 3 }, modifiers: {} };
const revised1 = applyV2Revision(prior, v2changeTerm);
check('change_term=3 returned non-null', revised1 != null);
check('change_term=3 → 3 items (one per tier at 3YR)',
  (revised1?.items?.length || 0) === 3,
  `got ${revised1?.items?.length} items: ${revised1?.items?.map(i=>i.baseSku).join(',')}`);
check('change_term=3 → every SKU ends in -3YR',
  revised1?.items?.every(i => /-3YR$/i.test(i.baseSku)) === true,
  `skus: ${revised1?.items?.map(i => i.baseSku).join(',')}`);
check('change_term=3 preserves isTermOptionQuote',
  revised1?.isTermOptionQuote === true);
check('change_term=3 preserves separateQuotes',
  revised1?.modifiers?.separateQuotes === true);

const rendered1 = buildQuoteResponse(revised1);
check('change_term=3 render has **Duo Essentials:** label',
  /\*\*Duo Essentials:\*\*/.test(rendered1.message),
  rendered1.message.slice(0, 400));
check('change_term=3 render has **Duo Advantage:** label',
  /\*\*Duo Advantage:\*\*/.test(rendered1.message));
check('change_term=3 render has **Duo Premier:** label',
  /\*\*Duo Premier:\*\*/.test(rendered1.message));
check('change_term=3 render emits 3-Year Co-Term',
  /3-Year Co-Term/.test(rendered1.message));
check('change_term=3 render does NOT leak 1-Year or 5-Year',
  !/1-Year Co-Term/.test(rendered1.message) && !/5-Year Co-Term/.test(rendered1.message),
  rendered1.message.slice(0, 400));

// ── Revision 2b: toggle_separate_quotes on legacy directLicenseList prior ─
// (Mimics a state restored from KV before the promotion fix.)
const legacyPrior = {
  items: [],
  directLicenseList: [
    {sku:'LIC-DUO-ESSENTIALS-1YR',qty:1},{sku:'LIC-DUO-ESSENTIALS-3YR',qty:1},{sku:'LIC-DUO-ESSENTIALS-5YR',qty:1},
    {sku:'LIC-DUO-ADVANTAGE-1YR',qty:1},{sku:'LIC-DUO-ADVANTAGE-3YR',qty:1},{sku:'LIC-DUO-ADVANTAGE-5YR',qty:1},
    {sku:'LIC-DUO-PREMIER-1YR',qty:1},{sku:'LIC-DUO-PREMIER-3YR',qty:1},{sku:'LIC-DUO-PREMIER-5YR',qty:1}
  ],
  requestedTerm: null,
  modifiers: { hardwareOnly: false, licenseOnly: true },
  isTermOptionQuote: false
};
const v2toggle = { revision: { action: null }, modifiers: { separate_quotes: true } };
const revised2 = applyV2Revision(legacyPrior, v2toggle);
check('toggle_separate_quotes (legacy DLL prior) returned non-null', revised2 != null);
check('toggle_separate_quotes promoted to isTermOptionQuote',
  revised2?.isTermOptionQuote === true);
check('toggle_separate_quotes set separateQuotes=true',
  revised2?.modifiers?.separateQuotes === true);
check('toggle_separate_quotes migrated to 9 items',
  (revised2?.items?.length || 0) === 9);
check('toggle_separate_quotes dropped directLicenseList',
  revised2?.directLicenseList === undefined);

const rendered2 = buildQuoteResponse(revised2);
check('toggle render: per-tier labels present',
  /\*\*Duo Essentials:\*\*[\s\S]*Duo Advantage[\s\S]*Duo Premier/.test(rendered2.message),
  rendered2.message.slice(0, 400));
check('toggle render: all 3 terms present',
  /1-Year Co-Term/.test(rendered2.message) &&
  /3-Year Co-Term/.test(rendered2.message) &&
  /5-Year Co-Term/.test(rendered2.message));

console.log(`\n${pass}/${pass+fail} passed`);
process.exit(fail === 0 ? 0 : 1);
