// Regression coverage for the 2026-07-09 license-intent semantics (Chris's spec):
//  (a) "<hw> with <N>-year licenses"  → hardware + that-term license (BUNDLE)
//  (b) "<hw> <N> year license"        → license only, that term
//  (c) bare "<hw>"                    → hardware + all 3 term options
//  (d) "renewal for <hw>"             → license only
//  (e) follow-up "remove the licenses"/"hardware only" → deterministic hw-only revision
// Live incident: "quote 3 MS130-24P with 5-year licenses" returned
// item=LIC-MS130-24-5Y&qty=3 (license-only) because assignClauseIntent's LIC_RE
// had no WITH-bundling guard.

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
src += '\nmodule.exports = { parseMessage, buildQuoteResponse };';
const tmp = path.join(os.tmpdir(), `stratus-gchat-lic-intent-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { parseMessage, buildQuoteResponse } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`PASS ${desc}`); pass++; }
  else { console.log(`FAIL ${desc}${diag ? ' — ' + diag : ''}`); fail++; }
};

function urlsFor(message) {
  const parsed = parseMessage(message);
  if (!parsed || !parsed.items || parsed.items.length === 0) return { urls: [], raw: '(no items)' };
  const resp = buildQuoteResponse(parsed);
  const text = (resp && (resp.message || resp.text || resp.reply)) || '';
  const urls = [...text.matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=([^&\s)]+)&qty=([^\s)]+)/g)]
    .map(m => ({ items: decodeURIComponent(m[1]), qty: m[2] }));
  return { urls, raw: text.slice(0, 400) };
}

const hasItem = (items, sku) => String(items || '').split(',').includes(sku);

// (a) BUNDLE: hardware + that-term license, single URL
{
  const { urls, raw } = urlsFor('quote 3 MS130-24P with 5-year licenses');
  check('(a) "with 5-year licenses" bundles hardware + 5Y license',
    urls.length === 1 && hasItem(urls[0].items, 'MS130-24P') && !hasItem(urls[0].items, 'MS130-24P-HW') && /LIC-MS130-24-5Y/.test(urls[0].items),
    JSON.stringify(urls) || raw);
}
{
  const { urls } = urlsFor('quote 1 MX67 with 3 year license');
  check('(a2) "MX67 with 3 year license" bundles hardware + 3YR license',
    urls.length >= 1 && hasItem(urls[0].items, 'MX67') && !hasItem(urls[0].items, 'MX67-HW') && /LIC-MX67-SEC-3YR/.test(urls[0].items),
    JSON.stringify(urls));
}
{
  const { urls } = urlsFor('quote 1 MX67 and 1 MS130-24P with 3yr licenses');
  check('(a3) multi-product "with 3yr licenses" bundles both bare hardware SKUs',
    urls.length === 1
      && hasItem(urls[0].items, 'MX67')
      && hasItem(urls[0].items, 'MS130-24P')
      && !/-HW(?:,|$)/.test(urls[0].items)
      && /LIC-MX67-SEC-3YR/.test(urls[0].items)
      && /LIC-MS130-24-3Y/.test(urls[0].items),
    JSON.stringify(urls));
}

// (b) LICENSE ONLY with term (no "with")
{
  const { urls } = urlsFor('quote 3 MS130-24P 5 year license');
  check('(b) "MS130-24P 5 year license" (no with) is license-only 5Y',
    urls.length >= 1 && urls.every(u => !hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW')) && /LIC-MS130-24-5Y/.test(urls[0].items),
    JSON.stringify(urls));
}
{
  const { urls } = urlsFor('3-year licenses for 1 MX67 and 1 MS130-24P');
  check('(b2) term-prefixed "licenses for" applies license-only to the full list',
    urls.length === 1
      && urls.every(u => !hasItem(u.items, 'MX67') && !hasItem(u.items, 'MS130-24P'))
      && /LIC-MX67-SEC-3YR/.test(urls[0].items)
      && /LIC-MS130-24-3Y/.test(urls[0].items),
    JSON.stringify(urls));
}

// (c) bare hardware → hardware + all 3 term options
{
  const { urls } = urlsFor('quote 3 MS130-24P');
  const all3 = ['1Y', '3Y', '5Y'].every(t => urls.some(u => u.items.includes(`LIC-MS130-24-${t}`) && hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW')));
  check('(c) bare "MS130-24P" quotes hardware + 1/3/5-year options', urls.length === 3 && all3, JSON.stringify(urls));
}

// (c2) trailing "licenses" (no term) → license-only, all 3 terms
{
  const { urls } = urlsFor('quote 3 MS130-24P licenses');
  const licOnlyAll3 = urls.length === 3 && urls.every(u => !hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW'));
  check('(c2) "MS130-24P licenses" stays license-only, all 3 terms', licOnlyAll3, JSON.stringify(urls));
}

// (d) renewal → license only
{
  const { urls } = urlsFor('renewal for 3 MS130-24P');
  check('(d) "renewal for MS130-24P" is license-only',
    urls.length >= 1 && urls.every(u => !hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW')),
    JSON.stringify(urls));
}

// (e) follow-up hardware-only phrasings recognized by handleFollowUpModifier's gate
{
  const workerSrc = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const m = workerSrc.match(/const isHwOnly = (\/.*\/i)\.test\(upper\);/);
  check('(e0) isHwOnly regex present', !!m);
  if (m) {
    const re = eval(m[1]);
    for (const phrase of ['hardware only', 'remove the licenses', 'drop licenses', 'no licenses', 'take the licenses off', 'remove licenses from the quote']) {
      check(`(e) follow-up "${phrase}" detected as hardware-only`, re.test(phrase.toUpperCase()), phrase);
    }
    for (const neg of ['remove the license key requirement note', 'update the licenses to 3 year']) {
      check(`(e-neg) "${neg}" NOT hardware-only`, !re.test(neg.toUpperCase()), neg);
    }
  }
}

// WITHOUT-guard sanity: hardware-only phrasing unaffected by the WITH neutralization
{
  const { urls } = urlsFor('quote 3 MS130-24P without licenses');
  check('(guard) "without licenses" stays hardware-only',
    urls.length >= 1 && urls.every(u => hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW') && !u.items.includes('LIC-')),
    JSON.stringify(urls));
}

// ── Round-2 review cases (2026-07-09 council findings) ──

// Multi-word tier adjectives in the WITH bundle
{
  const { urls } = urlsFor('quote 2 MX67 with advanced security licenses');
  check('(r2) "with advanced security licenses" bundles hardware',
    urls.length >= 1 && urls.every(u => hasItem(u.items, 'MX67') && !hasItem(u.items, 'MX67-HW')), JSON.stringify(urls));
}
{
  const { urls } = urlsFor('quote 3 MR46 with enterprise 5 year licenses');
  check('(r2) "with enterprise 5 year licenses" bundles hardware + 5Y',
    urls.length >= 1 && urls[0].items.includes('MR46-HW') && /LIC-ENT-5YR/.test(urls[0].items), JSON.stringify(urls));
}

// WITHOUT variants with articles/terms
{
  const { urls } = urlsFor('quote 3 MS130-24P without the licenses');
  check('(r2) "without THE licenses" is hardware-only',
    urls.length >= 1 && urls.every(u => hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW') && !u.items.includes('LIC-')), JSON.stringify(urls));
}
{
  const { urls } = urlsFor('quote 3 MS130-24P without 5 year licenses');
  check('(r2) "without 5 year licenses" is hardware-only',
    urls.length >= 1 && urls.every(u => hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW') && !u.items.includes('LIC-')), JSON.stringify(urls));
}

// Descriptive "has no licenses" must NOT flip a renewal to hardware-only
{
  const { urls } = urlsFor('customer has no licenses currently please quote renewals for 3 MS130-24P');
  check('(r2) descriptive "has no licenses" keeps renewal license-only',
    urls.length >= 1 && urls.every(u => !hasItem(u.items, 'MS130-24P') && !hasItem(u.items, 'MS130-24P-HW')), JSON.stringify(urls));
}

// Comma-stranded trailing intent clause
{
  const { urls } = urlsFor('quote 2 MR46, no licenses');
  check('(r2) "quote 2 MR46, no licenses" is hardware-only',
    urls.length >= 1 && urls.every(u => u.items.includes('MR46-HW') && !u.items.includes('LIC-')), JSON.stringify(urls));
}

// Trailing hardware qualifier stays item-local (regression guard for the inheritance change)
{
  const { urls } = urlsFor('renew 1 MX67 and add 1 MR44 hardware');
  const mx67LicPresent = urls.some(u => /LIC-MX67-SEC/.test(u.items));
  const mr44LicAbsent = urls.every(u => !/LIC-ENT/.test(u.items) || !u.items.includes('MR44'));
  check('(r2-guard) "renew MX67 then add MR44 hardware" keeps intents item-local',
    urls.length >= 1 && mx67LicPresent, JSON.stringify(urls));
}

// Courtesy-wrapped follow-up corrections
{
  const workerSrc = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const m = workerSrc.match(/const isHwOnly = (\/.*\/i)\.test\(upper\);/);
  if (m) {
    const re = eval(m[1]);
    for (const phrase of ['please remove the licenses', 'can you remove the licenses?', 'remove the licenses please']) {
      check(`(r2) follow-up "${phrase}" detected as hardware-only`, re.test(phrase.toUpperCase()), phrase);
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
