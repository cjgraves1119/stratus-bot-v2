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
src += '\nmodule.exports = { parseMessage, buildQuoteResponse, buildQuoteFromV3, parseExplicitDirectLicenseListBeforeClassifier, parseExplicitSkuRequestBeforeClassifier, canRewriteDirectLicenseListForAllTerms, canRewriteDirectLicenseListForTerm, rewriteDirectLicenseListForTerm };';
const tmp = path.join(os.tmpdir(), `stratus-direct-license-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const {
  parseMessage,
  buildQuoteResponse,
  buildQuoteFromV3,
  parseExplicitDirectLicenseListBeforeClassifier,
  parseExplicitSkuRequestBeforeClassifier,
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
  const input = 'LIC-ENT-3YR x1, LIC-MV-3YR x12, LIC-MX67W-SEC-3YR x2';
  const parsed = parseMessage(input);
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

  const bypassParsed = parseExplicitDirectLicenseListBeforeClassifier(input);
  check('typed Arch list bypasses V3 classifier when V3 is enabled',
    bypassParsed && Array.isArray(bypassParsed.directLicenseList) && bypassParsed.directLicenseList.length === 3,
    JSON.stringify(bypassParsed));
  const bypassUrls = decodeAllUrls(messageOf(buildQuoteResponse(bypassParsed)));
  check('typed Arch V3 bypass preserves 1/3/5 output',
    bypassUrls.length === 3 &&
      hasUrl(bypassUrls, ['LIC-ENT-1YR', 'LIC-MV-1YR', 'LIC-MX67W-SEC-1YR'], [1, 12, 2]) &&
      hasUrl(bypassUrls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]) &&
      hasUrl(bypassUrls, ['LIC-ENT-5YR', 'LIC-MV-5YR', 'LIC-MX67W-SEC-5YR'], [1, 12, 2]),
    JSON.stringify(bypassUrls));
  const v3Collapsed = buildQuoteFromV3({
    intent: 'quote',
    confidence: 1,
    clarify: { needed: false, question: '' },
    items: [
      { product: 'LIC-ENT-3YR', qty: 1, intent: 'license' },
      { product: 'LIC-MV-3YR', qty: 12, intent: 'license' },
      { product: 'LIC-MX67W-SEC-3YR', qty: 2, intent: 'license' },
    ],
    modifiers: { term_years: 3, tier: null, show_pricing: false, all_terms: false, separate_quotes: false },
  }, input);
  const v3Urls = decodeAllUrls(messageOf(buildQuoteResponse(v3Collapsed)));
  check('control: V3 collapsed direct license list would emit only 3-year',
    v3Urls.length === 1 &&
      hasUrl(v3Urls, ['LIC-ENT-3YR', 'LIC-MV-3YR', 'LIC-MX67W-SEC-3YR'], [1, 12, 2]),
    JSON.stringify(v3Urls));
}

expectArchDirectLicenseQuote('quote-prefixed direct list',
  'quote LIC-ENT-3YR x1 LIC-MV-3YR x12 LIC-MX67W-SEC-3YR x2');
expectArchDirectLicenseQuote('parenthesized quantity direct list',
  'LIC-ENT-3YR (1), LIC-MV-3YR (12), LIC-MX67W-SEC-3YR (2)');
expectArchDirectLicenseQuote('natural quantity-before direct list',
  'Please quote 1 LIC-ENT-3YR, 12 LIC-MV-3YR, and 2 LIC-MX67W-SEC-3YR.');

// Dashboard-export pair format. The comma binds each quantity to the SKU that
// precedes it; the legacy comma splitter used to shift every quantity forward.
{
  const input = 'LIC-C9300-24E-3Y,1  LIC-ENT-3YR,27  LIC-MS120-24-3YR,4  LIC-MS120-24P-3YR,1  LIC-MS120-48LP-3YR,6  LIC-MS120-8LP-3YR,2  LIC-MS125-48LP-3Y,5  LIC-MS130-CMPT-3Y,8  LIC-MS225-24P-3YR,3  LIC-MS425-16-3YR,1  LIC-MS450-12-3YR,2  LIC-MT-3Y,1  LIC-MX100-SEC-3YR,1  LIC-MX105-SEC-3Y,1  LIC-MX250-SEC-3YR,1  LIC-MX65-SEC-3YR,2  LIC-MX67W-SEC-3YR,5  LIC-MX75-SEC-3Y,4  LIC-MX85-SEC-3Y,1  LIC-MX95-SEC-3Y,1';
  const expected = {
    'LIC-C9300-24E-3Y': 1, 'LIC-ENT-3YR': 27, 'LIC-MS120-24-3YR': 4, 'LIC-MS120-24P-3YR': 1,
    'LIC-MS120-48LP-3YR': 6, 'LIC-MS120-8LP-3YR': 2, 'LIC-MS125-48LP-3Y': 5, 'LIC-MS130-CMPT-3Y': 8,
    'LIC-MS225-24P-3YR': 3, 'LIC-MS425-16-3YR': 1, 'LIC-MS450-12-3YR': 2, 'LIC-MT-3Y': 1,
    'LIC-MX100-SEC-3YR': 1, 'LIC-MX105-SEC-3Y': 1, 'LIC-MX250-SEC-3YR': 1, 'LIC-MX65-SEC-3YR': 2,
    'LIC-MX67W-SEC-3YR': 5, 'LIC-MX75-SEC-3Y': 4, 'LIC-MX85-SEC-3Y': 1, 'LIC-MX95-SEC-3Y': 1,
  };
  const parsed = parseMessage(input);
  check('Ohio Valley Gas 20-pair paste preserves every exact quantity',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 20 &&
      parsed.directLicenseList.every(({ sku, qty }) => expected[sku] === qty),
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('LIC-ENT-3YR,27  LIC-MS120-24-3YR,4\nLIC-MX65-SEC-3YR,2\nLIC-MT-3Y,1');
  const map = Object.fromEntries((parsed?.directLicenseList || []).map(({ sku, qty }) => [sku, qty]));
  check('multi-line input retains multiple SKU,qty pairs carried on one line',
    parsed && Array.isArray(parsed.directLicenseList) &&
      map['LIC-ENT-3YR'] === 27 && map['LIC-MS120-24-3YR'] === 4 &&
      map['LIC-MX65-SEC-3YR'] === 2 && map['LIC-MT-3Y'] === 1,
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('LIC-MX68W-SEC-1YR, LIC-ENT-1YR, LIC-MS220-8P-1YR');
  check('legacy SKU-only comma list remains quantity one per line',
    parsed && JSON.stringify(parsed.directLicenseList) === JSON.stringify([
      { sku: 'LIC-MX68W-SEC-1YR', qty: 1 },
      { sku: 'LIC-ENT-1YR', qty: 1 },
      { sku: 'LIC-MS220-8P-1YR', qty: 1 },
    ]),
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('LIC-ENT-1YR, 5 LIC-MX68-SEC-1YR');
  check('ambiguous mixed syntax preserves legacy quantity-first binding',
    parsed && JSON.stringify(parsed.directLicenseList) === JSON.stringify([
      { sku: 'LIC-ENT-1YR', qty: 1 },
      { sku: 'LIC-MX68-SEC-1YR', qty: 5 },
    ]),
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('PUBLIC-SECTOR,3 LIC-ENT-3YR,27 LIC-MX67-SEC-3YR,2');
  const map = Object.fromEntries((parsed?.directLicenseList || []).map(({ sku, qty }) => [sku, qty]));
  check('PUBLIC-SECTOR substring never mints a bogus LIC-SECTOR pair',
    parsed && Array.isArray(parsed.directLicenseList) && !('LIC-SECTOR' in map) &&
      map['LIC-ENT-3YR'] === 27 && map['LIC-MX67-SEC-3YR'] === 2,
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('LIC-ENT-3YR,0 LIC-MX67-SEC-3YR,2 LIC-MT-3Y,1');
  const map = Object.fromEntries((parsed?.directLicenseList || []).map(({ sku, qty }) => [sku, qty]));
  check('zero-quantity pairs are skipped without falling back or shifting',
    parsed && Array.isArray(parsed.directLicenseList) && !('LIC-ENT-3YR' in map) &&
      map['LIC-MX67-SEC-3YR'] === 2 && map['LIC-MT-3Y'] === 1,
    JSON.stringify(parsed));
}

{
  const input = 'LIC-ENT-3YR,100000 LIC-MX67-SEC-3YR,2 LIC-MT-3Y,1';
  const parsed = parseMessage(input);
  check('six-digit pair quantity fails closed before any shifted quote can form',
    parsed?.isClarification === true && !Array.isArray(parsed.directLicenseList) &&
      /between 1 and 99,999/i.test(parsed.clarificationMessage || ''),
    JSON.stringify(parsed));
  const bypassParsed = parseExplicitDirectLicenseListBeforeClassifier(input);
  check('pre-classifier direct-list bypass preserves six-digit fail-closed clarification',
    bypassParsed?.isClarification === true && !Array.isArray(bypassParsed.directLicenseList),
    JSON.stringify(bypassParsed));
}

{
  const parsed = parseMessage('LIC-ENT-3YR,27 LIC-MX67-SEC-3YR,2 2 MR44');
  check('single-line mixed license pairs plus hardware do not take over as license-only',
    parsed && !Array.isArray(parsed.directLicenseList) &&
      Array.isArray(parsed.items) && parsed.items.some(i => i.baseSku === 'MR44' && i.qty === 2),
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('LIC-ENT-3YR,27\nLIC-MX67-SEC-3YR,2\n2 MR44');
  check('multi-line mixed license pairs plus hardware preserve the hardware parse',
    parsed && !Array.isArray(parsed.directLicenseList) &&
      Array.isArray(parsed.items) && parsed.items.some(i => i.baseSku === 'MR44' && i.qty === 2),
    JSON.stringify(parsed));
}

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
expectNoEmbeddedDirectLicenseList('better-than advisory',
  'is LIC-ENT-3YR better than LIC-ENT-1YR?');
expectNoEmbeddedDirectLicenseList('or-choice advisory',
  'LIC-ENT-3YR or LIC-ENT-1YR?');
expectNoEmbeddedDirectLicenseList('from-to revision',
  'change LIC-ENT-3YR from 1 to 2 and LIC-MV-3YR from 12 to 14');
expectNoEmbeddedDirectLicenseList('license-to-license revision',
  'change LIC-ENT-3YR to LIC-ENT-5YR');
expectNoEmbeddedDirectLicenseList('existing order URL',
  'https://stratus.supply/?item=LIC-ENT-3YR,LIC-MV-3YR&qty=1,12');
{
  const parsed = parseMessage('MR44 with LIC-ENT-3YR and LIC-MV-3YR');
  check('hardware plus license text does not drop hardware into direct list',
    parsed && !Array.isArray(parsed.directLicenseList) &&
      Array.isArray(parsed.items) && parsed.items.some(i => i.baseSku === 'MR44'),
    JSON.stringify(parsed));
}

{
  const parsed = parseMessage('Can you quote LIC-ENT-3YR and LIC-MV-3YR?');
  check('explicit quote question still parses embedded LIC SKUs',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 2,
    JSON.stringify(parsed));
}

{
  // SME is discontinued: legacy LIC-SME lists rewrite onto the replacement
  // (Ivanti MDM) family, which supports every term including 5-year.
  const smeList = [{ sku: 'LIC-SME-3YR', qty: 10 }];
  check('legacy SME direct list is safe to rewrite across all terms (replacement family)',
    canRewriteDirectLicenseListForAllTerms(smeList));
  check('legacy SME direct list rewrites to replacement 1-year',
    rewriteDirectLicenseListForTerm(smeList, 1)[0].sku === 'LIC-MI-EMSC-D-1YMC-A-1YR');
  check('legacy SME direct list rewrites to replacement 5-year',
    rewriteDirectLicenseListForTerm(smeList, 5)[0].sku === 'LIC-MI-EMSC-D-1YMC-A-5YR');

  const requestedFive = messageOf(buildQuoteResponse({ directLicenseList: smeList, requestedTerm: 5 }));
  check('requested SME 5-year does not emit any legacy LIC-SME SKU',
    !/LIC-SME-\d/.test(requestedFive),
    requestedFive);
  check('requested SME 5-year renders the replacement at 5-year',
    /LIC-MI-EMSC-D-1YMC-A-5YR/.test(requestedFive) && /5-Year Co-Term/.test(requestedFive),
    requestedFive);
}

{
  const parsed = parseMessage('LIC-SME-3YR x10, LIC-ENT-3YR x1');
  check('mixed SME+ENT input parses as production directLicenseList',
    parsed && Array.isArray(parsed.directLicenseList) && parsed.directLicenseList.length === 2,
    JSON.stringify(parsed));
  const msg = messageOf(buildQuoteResponse(parsed));
  check('mixed SME+ENT directLicenseList does not emit any legacy LIC-SME SKU',
    !/LIC-SME-\d/.test(msg),
    msg);
  check('mixed SME+ENT directLicenseList quotes the replacement alongside ENT at 3-year',
    /LIC-MI-EMSC-D-1YMC-A-3YR/.test(msg) && /LIC-ENT-3YR/.test(msg),
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

{
  const parsed = parseExplicitSkuRequestBeforeClassifier('5 MR44 and 2 MX999');
  check('SKU-list pre-classifier bypass keeps mixed valid/invalid hardware parse',
    parsed && Array.isArray(parsed.items) &&
      parsed.items.some(i => i.baseSku === 'MR44' && i.qty === 5) &&
      parsed.items.some(i => i.baseSku === 'MX999' && i.qty === 2),
    JSON.stringify(parsed));
  check('SKU-list pre-classifier bypass ignores product-info questions',
    parseExplicitSkuRequestBeforeClassifier('what is MR44?') === null,
    JSON.stringify(parseExplicitSkuRequestBeforeClassifier('what is MR44?')));
}

{
  const cases = [
    { label: 'compact x-plus mixed hardware', input: '5x MR44 + 2x MX999' },
    { label: 'qty-word mixed hardware', input: 'MR44 qty 5, MX999 qty 2' },
    { label: 'quantity-word mixed hardware', input: 'MR44 quantity 5; MX999 quantity 2' },
    { label: 'equals-sign mixed hardware', input: 'MR44=5, MX999=2' },
  ];
  for (const { label, input } of cases) {
    const parsed = parseExplicitSkuRequestBeforeClassifier(input);
    check(`${label} bypass parses MR44 and MX999`,
      parsed && Array.isArray(parsed.items) &&
        parsed.items.some(i => i.baseSku === 'MR44' && i.qty === 5) &&
        parsed.items.some(i => i.baseSku === 'MX999' && i.qty === 2),
      JSON.stringify(parsed));
    if (parsed) {
      const msg = messageOf(buildQuoteResponse(parsed));
      const urls = decodeAllUrls(msg);
      check(`${label} renders partial quote plus invalid suggestion`,
        /MX999/.test(msg) && hasUrl(urls, ['MR44-HW', 'LIC-ENT-3YR'], [5, 5]),
        msg);
    }
  }
}

{
  const nonQuoteInputs = [
    'how much is 5 MR44?',
    'what licenses does MX67 need?',
    'compare MR44 and MR46',
    'is MX67 compatible with LIC-MX67-SEC-3YR?',
    'pricing for LIC-ENT-3YR x1 and LIC-MV-3YR x12',
  ];
  for (const input of nonQuoteInputs) {
    check(`SKU-list bypass ignores non-quote info question: ${input}`,
      parseExplicitSkuRequestBeforeClassifier(input) === null,
      JSON.stringify(parseExplicitSkuRequestBeforeClassifier(input)));
  }
}

{
  const directMx = parseExplicitSkuRequestBeforeClassifier('quote LIC-MX67-SEC-3YR');
  check('SKU-list bypass promotes single LIC-MX license token to all-term list',
    directMx && Array.isArray(directMx.directLicenseList) &&
      directMx.directLicenseList.length === 1 &&
      directMx.directLicenseList[0].sku === 'LIC-MX67-SEC-3YR' &&
      directMx.directLicenseList[0].qty === 1,
    JSON.stringify(directMx));
  const directMxUrls = decodeAllUrls(messageOf(buildQuoteResponse(directMx)));
  check('single LIC-MX bypass emits 1-year sibling',
    hasUrl(directMxUrls, ['LIC-MX67-SEC-1YR'], [1]),
    JSON.stringify(directMxUrls));
  check('single LIC-MX bypass emits 3-year sibling',
    hasUrl(directMxUrls, ['LIC-MX67-SEC-3YR'], [1]),
    JSON.stringify(directMxUrls));
  check('single LIC-MX bypass emits 5-year sibling',
    hasUrl(directMxUrls, ['LIC-MX67-SEC-5YR'], [1]),
    JSON.stringify(directMxUrls));

  const justDirectMx = parseExplicitSkuRequestBeforeClassifier('just quote LIC-MX67-SEC-3YR');
  const justDirectMxUrls = decodeAllUrls(messageOf(buildQuoteResponse(justDirectMx)));
  check('casual "just quote" wording still emits all LIC-MX siblings',
    hasUrl(justDirectMxUrls, ['LIC-MX67-SEC-1YR'], [1]) &&
      hasUrl(justDirectMxUrls, ['LIC-MX67-SEC-3YR'], [1]) &&
      hasUrl(justDirectMxUrls, ['LIC-MX67-SEC-5YR'], [1]),
    JSON.stringify(justDirectMxUrls));

  const trailingOnlyDirectMx = parseExplicitSkuRequestBeforeClassifier('quote LIC-MX67-SEC-3YR 3-year only');
  const trailingOnlyDirectMxUrls = decodeAllUrls(messageOf(buildQuoteResponse(trailingOnlyDirectMx)));
  check('explicit trailing term-only wording still stays direct-license only',
    trailingOnlyDirectMx && Array.isArray(trailingOnlyDirectMx.directLicenseList) &&
      !trailingOnlyDirectMx.items?.length &&
      !trailingOnlyDirectMxUrls.some(u => u.items.includes('MX67-HW')),
    JSON.stringify({ parsed: trailingOnlyDirectMx, urls: trailingOnlyDirectMxUrls }));
  check('explicit trailing term-only wording still emits all LIC-MX siblings',
    hasUrl(trailingOnlyDirectMxUrls, ['LIC-MX67-SEC-1YR'], [1]) &&
      hasUrl(trailingOnlyDirectMxUrls, ['LIC-MX67-SEC-3YR'], [1]) &&
      hasUrl(trailingOnlyDirectMxUrls, ['LIC-MX67-SEC-5YR'], [1]),
    JSON.stringify(trailingOnlyDirectMxUrls));

  const leadingOnlyDirectMx = parseExplicitSkuRequestBeforeClassifier('only 3-year quote LIC-MX67-SEC-3YR');
  const leadingOnlyDirectMxUrls = decodeAllUrls(messageOf(buildQuoteResponse(leadingOnlyDirectMx)));
  check('explicit leading term-only wording still emits all LIC-MX siblings',
    hasUrl(leadingOnlyDirectMxUrls, ['LIC-MX67-SEC-1YR'], [1]) &&
      hasUrl(leadingOnlyDirectMxUrls, ['LIC-MX67-SEC-3YR'], [1]) &&
      hasUrl(leadingOnlyDirectMxUrls, ['LIC-MX67-SEC-5YR'], [1]) &&
      !leadingOnlyDirectMxUrls.some(u => u.items.includes('MX67-HW')),
    JSON.stringify({ parsed: leadingOnlyDirectMx, urls: leadingOnlyDirectMxUrls }));

  const directMxQty = parseExplicitSkuRequestBeforeClassifier('quote LIC-MX67-SEC-3YR x2');
  check('SKU-list bypass preserves LIC-MX license token with explicit x quantity as all-term list',
    directMxQty && Array.isArray(directMxQty.directLicenseList) &&
      directMxQty.directLicenseList.length === 1 &&
      directMxQty.directLicenseList[0].sku === 'LIC-MX67-SEC-3YR' &&
      directMxQty.directLicenseList[0].qty === 2,
    JSON.stringify(directMxQty));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
