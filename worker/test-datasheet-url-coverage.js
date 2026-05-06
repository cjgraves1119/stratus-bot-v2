// Regression test: live datasheet URL coverage + resolver hardening.
// Run source-level checks with:
//   node worker/test-datasheet-url-coverage.js
// Run live URL reachability checks with:
//   LIVE_DATASHEET_URL_CHECK=1 node worker/test-datasheet-url-coverage.js
// Run every configured datasheet URL live with:
//   LIVE_DATASHEET_ALL_URLS=1 node worker/test-datasheet-url-coverage.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '..');
const targets = [
  'worker/src/index.js',
  'worker-gchat/src/index.js',
];

const expectedUrls = {
  'C8455-G2-MX': 'https://documentation.meraki.com/SASE_and_SD-WAN/MX/Product_Information/Overviews_and_Datasheets/C8455-G2-MX_Data_Sheet',
  CW9171I: 'https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9171-series-acc-point-ds.html',
  CW9172I: 'https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9172-series-access-points-ds.html',
  CW9174I: 'https://www.cisco.com/c/en/us/products/collateral/wireless/catalyst-9100ax-access-points/wireless-9174-series-access-points-ds.html',
  CW9179F: 'https://www.cisco.com/site/us/en/products/collateral/networking/wireless/access-points/catalyst-9100-series/wireless-9179f-access-point-ds.html',
};

const liveMarkers = {
  'C8455-G2-MX': /C8455-G2-MX/i,
  CW9171I: /Cisco Wireless 9171|CW9171/i,
  CW9172I: /Cisco Wireless 9172|CW9172/i,
  CW9174I: /Cisco Wireless 9174|CW9174/i,
  CW9179F: /Cisco Wireless 9179F|CW9179F/i,
};

let pass = 0;
let fail = 0;

function check(desc, cond, diag) {
  if (cond) {
    console.log(`✅ ${desc}`);
    pass++;
  } else {
    console.log(`❌ ${desc}${diag ? '\n   ' + String(diag).slice(0, 800) : ''}`);
    fail++;
  }
}

function extractBalanced(src, startIdx, openChar, closeChar) {
  const openIdx = src.indexOf(openChar, startIdx);
  if (openIdx < 0) throw new Error(`open char ${openChar} not found`);
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = openIdx; i < src.length; i++) {
    const ch = src[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === openChar) depth++;
    if (ch === closeChar) {
      depth--;
      if (depth === 0) return src.slice(openIdx, i + 1);
    }
  }
  throw new Error(`balanced block ${openChar}${closeChar} not closed`);
}

function loadDatasheetBits(src) {
  const mapStart = src.indexOf('const DATASHEET_URLS =');
  const fnStart = src.indexOf('function getDatasheetKey(model)');
  if (mapStart < 0 || fnStart < 0) throw new Error('datasheet map or resolver not found');
  const mapLiteral = extractBalanced(src, mapStart, '{', '}');
  const fnSource = src.slice(fnStart, fnStart + extractBalanced(src, fnStart, '{', '}').length + 'function getDatasheetKey(model) '.length);
  const sandbox = { module: { exports: {} } };
  vm.runInNewContext(`
    const DATASHEET_URLS = ${mapLiteral};
    ${fnSource}
    module.exports = { DATASHEET_URLS, getDatasheetKey };
  `, sandbox);
  return sandbox.module.exports;
}

function runSourceChecks(target) {
  const abs = path.join(repoRoot, target);
  const src = fs.readFileSync(abs, 'utf8');
  const { DATASHEET_URLS, getDatasheetKey } = loadDatasheetBits(src);

  for (const [key, url] of Object.entries(expectedUrls)) {
    check(`${target}: ${key} URL is logged`, DATASHEET_URLS[key] === url, `${key}: ${DATASHEET_URLS[key]}`);
  }

  const resolverCases = {
    'C8455-G2-MX': 'C8455-G2-MX',
    'C8455-G2-MX-HW': 'C8455-G2-MX',
    'C8121-G2-MX': 'C8121-G2-MX',
    'CW9171I-RTG': 'CW9171I',
    'CW9172I-RTG': 'CW9172I',
    'CW9174I-RTG': 'CW9174I',
    CW9179F: 'CW9179F',
    'MR44-HW': 'MR44',
    'MV22X-HW': 'MV22X',
  };
  for (const [input, expected] of Object.entries(resolverCases)) {
    check(`${target}: resolver ${input} -> ${expected}`, getDatasheetKey(input) === expected, `${input}: ${getDatasheetKey(input)}`);
  }

  check(`${target}: live scanner includes C8/C9 Catalyst model pattern`,
    /\\b\(C\[89\]\\d\{3\}\(\?:-\[A-Z0-9\]\+\)\*\)/.test(src),
    'C[89] live model pattern missing');
  check(`${target}: fetch timeout is named and increased to 10s`,
    /DATASHEET_FETCH_TIMEOUT_MS\s*=\s*10000/.test(src) &&
    /AbortSignal\.timeout\(DATASHEET_FETCH_TIMEOUT_MS\)/.test(src) &&
    !/AbortSignal\.timeout\(5000\)/.test(src),
    'timeout constant or usage missing');
  check(`${target}: datasheet text cap is increased to 6000 chars`,
    /DATASHEET_TEXT_MAX_CHARS\s*=\s*6000/.test(src) &&
    /text\.slice\(0,\s*DATASHEET_TEXT_MAX_CHARS\)/.test(src),
    'text cap constant or usage missing');
  check(`${target}: multi-model live datasheet fetch cap covers CW AP set plus C8455`,
    /MAX_DATASHEET_FETCH_MODELS\s*=\s*5/.test(src) &&
    /slice\(0,\s*MAX_DATASHEET_FETCH_MODELS\)/.test(src),
    'live datasheet fetch cap can still drop the fourth/fifth model');
  check(`${target}: fetch rejects HTML 404/missing-page bodies`,
    /page not found\|404\\s\*-\\s\*page/i.test(src),
    'missing-page guard not found');
  check(`${target}: bad MS150 shortcut URL is not present`,
    !src.includes('documentation.meraki.com/MS/MS150'),
    'bad MS150 shortcut URL found');
  check(`${target}: no family/family-number shortcut URLs are present`,
    !/documentation\.meraki\.com\/(MS|MR|MX|MV|MT|MG|CW)\/\1\d/i.test(src),
    'bad shortcut URL shape found');
}

async function runLiveChecks() {
  if (process.env.LIVE_DATASHEET_URL_CHECK !== '1' && process.env.LIVE_DATASHEET_ALL_URLS !== '1') return;

  let entries = [...new Map(Object.entries(expectedUrls).map(([key, url]) => [url, key])).entries()];
  if (process.env.LIVE_DATASHEET_ALL_URLS === '1') {
    const firstTarget = path.join(repoRoot, targets[0]);
    const { DATASHEET_URLS } = loadDatasheetBits(fs.readFileSync(firstTarget, 'utf8'));
    entries = [...new Map(Object.entries(DATASHEET_URLS).map(([key, url]) => [url, key])).entries()];
  }

  for (const [url, key] of entries) {
    const started = Date.now();
    const res = await fetch(url, {
      headers: { 'User-Agent': 'StratusAI-Bot/1.0 (spec-lookup)' },
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    const elapsed = Date.now() - started;
    check(`live URL ${key}: HTTP ${res.status} in ${elapsed}ms`, res.ok, url);
    check(`live URL ${key}: body is not a missing-page response`,
      !/page not found|404\s*-\s*page/i.test(text.slice(0, 2000)),
      text.slice(0, 300));
    if (liveMarkers[key]) {
      check(`live URL ${key}: body contains expected datasheet marker`,
        liveMarkers[key].test(text),
        text.slice(0, 500));
    } else {
      check(`live URL ${key}: body is non-empty datasheet content`,
        text.length > 1000,
        `length=${text.length}`);
    }
  }
}

(async () => {
  for (const target of targets) runSourceChecks(target);
  await runLiveChecks();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
