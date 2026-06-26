// Regression coverage for typed direct license lists. A user-entered list such
// as "LIC-ENT-3YR x1, LIC-MV-3YR x12, LIC-MX67W-SEC-3YR x2" should render safe
// 1/3/5-year siblings, while capped families such as LIC-SME must never emit a
// deprecated 5-year SKU.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
  (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
  'const WorkflowEntrypoint = class {};');
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
src += '\nmodule.exports = { parseMessage, buildQuoteResponse, canRewriteDirectLicenseListForAllTerms, canRewriteDirectLicenseListForTerm, rewriteDirectLicenseListForTerm };';
const tmp = path.join(os.tmpdir(), `stratus-direct-license-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const {
  parseMessage,
  buildQuoteResponse,
  canRewriteDirectLicenseListForAllTerms,
  canRewriteDirectLicenseListForTerm,
  rewriteDirectLicenseListForTerm,
} = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`PASS ${desc}`); pass++; }
  else { console.log(`FAIL ${desc}${diag ? '\n  ' + diag : ''}`); fail++; }
};
const messageOf = result => String((result && (result.message || result)) || '');
const decodeAllUrls = msg => {
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
    u.qtys.every((q, i) => q === expectQtys[i])
  );
const expectNoEmbeddedDirectLicenseList = (label, input) => {
  const parsed = parseMessage(input);
  check(`${label} does not over-trigger embedded directLicenseList`,
    !(parsed && Array.isArray(parsed.directLicenseList)),
    JSON.stringify(parsed));
};
const expectArchDirectLicenseQuote = (label, input) => {
  const parsed = parseMessage(input);
  check(`${label} parses embedded LIC SKUs as directLicenseList`,
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 3 &&
      Array.isArray(parsed.items) && parsed.items.length === 0,
    JSON.stringify(parsed));
  const urls = decodeAllUrls(messageOf(buildQuoteResponse(parsed)));
  check(`${label} emits 1-year URL`,
    hasUrl(urls, ['LIC-ENT-1YR', 'LIC-MV-1YR', 'LIC-MX67W-SEC-1YR'], [1, 12, 2]),
    JSON.stringify(urls));
  check(`${label} emits 3-year URL`,
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]),
    JSON.stringify(urls));
  check(`${label} emits 5-year URL`,
    hasUrl(urls, ['LIC-ENT-5YR', 'LIC-MV-5YR', 'LIC-MX67W-SEC-5YR'], [1, 12, 2]),
    JSON.stringify(urls));
  check(`${label} does not quote MX67W as hardware fallback`,
    !urls.some(u => u.items.includes('MX67W') || u.items.includes('MX67W-HW')),
    JSON.stringify(urls));
};

{
  const parsed = parseMessage('LIC-ENT-3YR x1, LIC-MV-3YR x12, LIC-MX67W-SEC-3YR x2');
  check('typed Arch direct license list parses as directLicenseList',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 3,
    JSON.stringify(parsed));
  check('Arch direct list is safe to rewrite across all terms',
    canRewriteDirectLicenseListForAllTerms(parsed.directLicenseList));
  const urls = decodeAllUrls(messageOf(buildQuoteResponse(parsed)));
  check('typed Arch list emits 1-year URL',
    hasUrl(urls, ['LIC-ENT-1YR', 'LIC-MV-1YR', 'LIC-MX67W-SEC-1YR'], [1, 12, 2]),
    JSON.stringify(urls));
  check('typed Arch list emits 3-year URL',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]),
    JSON.stringify(urls));
  check('typed Arch list emits 5-year URL',
    hasUrl(urls, ['LIC-ENT-5YR', 'LIC-MV-5YR', 'LIC-MX67W-SEC-5YR'], [1, 12, 2]),
    JSON.stringify(urls));
}

expectArchDirectLicenseQuote('quote-prefixed direct list',
  'quote LIC-ENT-3YR x1 LIC-MV-3YR x12 LIC-MX67W-SEC-3YR x2');
expectArchDirectLicenseQuote('parenthesized quantity direct list',
  'LIC-ENT-3YR (1), LIC-MV-3YR (12), LIC-MX67W-SEC-3YR (2)');
expectArchDirectLicenseQuote('natural quantity-before direct list',
  'Please quote 1 LIC-ENT-3YR, 12 LIC-MV-3YR, and 2 LIC-MX67W-SEC-3YR.');

// R4: a stray trailing bare number / year after the last SKU must NOT be read
// as a quantity. Only explicit markers (x12, qty 12, (12), : 12) count.
{
  const parsed = parseMessage('quote LIC-ENT-3YR LIC-MV-3YR 2024');
  check('R4 trailing bare year is not absorbed as quantity',
    parsed && Array.isArray(parsed.directLicenseList) &&
      parsed.directLicenseList.length === 2 &&
      parsed.directLicenseList.every(l => l.qty === 1),
    JSON.stringify(parsed && parsed.directLicenseList));
  const urls = decodeAllUrls(messageOf(buildQuoteResponse(parsed)));
  check('R4 emits 3-year URL with qty 1,1 (no phantom 2024)',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR'], [1, 1]) &&
      !urls.some(u => u.qtys.includes(2024)),
    JSON.stringify(urls));
}

// R6: a leading number glued to a currency symbol ("$500") is a price, not a
// quantity, and must not become the first SKU's qty. A clean leading token
// like "1 LIC-..." (covered above) still counts.
{
  const parsed = parseMessage('$500 LIC-ENT-3YR and LIC-MV-3YR');
  check('R6 leading price is not absorbed as quantity',
    parsed && Array.isArray(parsed.directLicenseList) &&
      parsed.directLicenseList.length === 2 &&
      parsed.directLicenseList.every(l => l.qty === 1),
    JSON.stringify(parsed && parsed.directLicenseList));
  const urls = decodeAllUrls(messageOf(buildQuoteResponse(parsed)));
  check('R6 emits 3-year URL with qty 1,1 (no phantom 500)',
    hasUrl(urls, ['LIC-ENT-3YR', 'LIC-MV-3YR'], [1, 1]) &&
      !urls.some(u => u.qtys.includes(500)),
    JSON.stringify(urls));
}

expectNoEmbeddedDirectLicenseList('comparison advisory',
  'Can you compare LIC-ENT-3YR and LIC-MV-3YR?');
expectNoEmbeddedDirectLicenseList('difference advisory',
  'what is the difference between LIC-ENT-3YR and LIC-MV-3YR');
expectNoEmbeddedDirectLicenseList('from-to revision',
  'change LIC-ENT-3YR from 1 to 2 and LIC-MV-3YR from 12 to 14');
expectNoEmbeddedDirectLicenseList('existing order URL',
  'https://stratus.supply/?item=LIC-ENT-3YR,LIC-MV-3YR&qty=1,12');

{
  const parsed = parseMessage('Can you quote LIC-ENT-3YR and LIC-MV-3YR?');
  check('explicit quote question still parses embedded LIC SKUs',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 2,
    JSON.stringify(parsed));
}

{
  const smeList = [{ sku: 'LIC-SME-3YR', qty: 10 }];
  check('SME direct list is not safe to rewrite across all terms',
    !canRewriteDirectLicenseListForAllTerms(smeList));
  check('SME direct list can rewrite to 1-year',
    canRewriteDirectLicenseListForTerm(smeList, 1));
  check('SME direct list cannot rewrite to deprecated 5-year',
    !canRewriteDirectLicenseListForTerm(smeList, 5));
  check('SME rewrite-to-5 fallback preserves submitted 3-year SKU',
    rewriteDirectLicenseListForTerm(smeList, 5)[0].sku === 'LIC-SME-3YR');

  const requestedFive = messageOf(buildQuoteResponse({ directLicenseList: smeList, requestedTerm: 5 }));
  check('requested SME 5-year does not emit LIC-SME-5YR',
    !/LIC-SME-5YR/.test(requestedFive),
    requestedFive);
  check('requested SME 5-year falls back to the detected 3-year SKU',
    /LIC-SME-3YR/.test(requestedFive) && !/5-Year Co-Term/.test(requestedFive),
    requestedFive);
}

{
  const parsed = parseMessage('LIC-SME-3YR x10, LIC-ENT-3YR x1');
  check('mixed SME+ENT input parses as production directLicenseList',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 2,
    JSON.stringify(parsed));
  const msg = messageOf(buildQuoteResponse(parsed));
  check('mixed SME+ENT directLicenseList does not emit deprecated SME 5-year SKU',
    !/LIC-SME-5YR/.test(msg),
    msg);
  check('mixed SME+ENT directLicenseList stays on detected 3-year term',
    /LIC-SME-3YR/.test(msg) && /LIC-ENT-3YR/.test(msg) && !/5-Year Co-Term/.test(msg),
    msg);
}

{
  const parsed = parseMessage('5 MR44 and 2 MX999');
  check('mixed valid/invalid hardware parses both requested tokens',
    parsed && Array.isArray(parsed.items) &&
      parsed.items.some(i => i.baseSku === 'MR44' && i.qty === 5) &&
      parsed.items.some(i => i.baseSku === 'MX999' && i.qty === 2),
    JSON.stringify(parsed));
  const result = buildQuoteResponse(parsed);
  const msg = messageOf(result);
  const urls = decodeAllUrls(msg);
  check('mixed valid/invalid hardware stays deterministic',
    result && result.needsLlm === false,
    JSON.stringify(result));
  check('mixed valid/invalid hardware keeps invalid SKU warning',
    /MX999/.test(msg) && /which variant|not a recognized/i.test(msg),
    msg);
  check('mixed valid/invalid hardware still emits MR44 1-year URL',
    hasUrl(urls, ['MR44-HW', 'LIC-ENT-1YR'], [5, 5]),
    JSON.stringify(urls));
  check('mixed valid/invalid hardware still emits MR44 3-year URL',
    hasUrl(urls, ['MR44-HW', 'LIC-ENT-3YR'], [5, 5]),
    JSON.stringify(urls));
  check('mixed valid/invalid hardware still emits MR44 5-year URL',
    hasUrl(urls, ['MR44-HW', 'LIC-ENT-5YR'], [5, 5]),
    JSON.stringify(urls));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
