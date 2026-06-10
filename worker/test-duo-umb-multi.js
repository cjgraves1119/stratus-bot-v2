// Quick sanity test for multi-tier Duo + multi-type/tier Umbrella and separateQuotes.
// Loads the real parseMessage via the test-local.js shim pattern.
const fs = require('fs');
const path = require('path');
const os = require('os');

function buildParserShim() {
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
  src += '\nmodule.exports = { parseMessage };\n';
  const shimPath = path.join(os.tmpdir(), `stratus-duo-umb-shim-${process.pid}.cjs`);
  fs.writeFileSync(shimPath, src);
  return require(shimPath);
}

const { parseMessage } = buildParserShim();

const cases = [
  {
    name: 'duo essentials 3yr — single tier, single term → narrow to 3YR, not separateQuotes',
    input: 'quote 50 duo essentials 3 year',
    expect: p => p.isQuote === true &&
                 p.items.length === 1 &&
                 p.items[0].baseSku === 'LIC-DUO-ESSENTIALS-3YR' &&
                 p.items[0].qty === 50 &&
                 p.modifiers?.separateQuotes === false
  },
  {
    name: 'duo essentials, advantage, premier → 3 tiers × 3 terms = 9 items, separateQuotes=true',
    input: '50 duo essentials, advantage, and premier',
    expect: p => p.isQuote === true &&
                 p.items.length === 9 &&
                 p.modifiers?.separateQuotes === true &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ESSENTIALS-1YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ADVANTAGE-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-PREMIER-5YR')
  },
  {
    name: 'duo essentials + advantage, 3yr + as separate quotes → 2 items narrowed to 3YR, separateQuotes=true',
    input: '3 year duo essentials and advantage as separate quotes',
    expect: p => p.isQuote === true &&
                 p.items.length === 2 &&
                 p.items.every(i => i.baseSku.endsWith('-3YR')) &&
                 p.modifiers?.separateQuotes === true
  },
  {
    name: 'duo essentials+premier+advantage 3yr as separate quotes → 3 items narrowed to 3YR, separateQuotes=true',
    input: '3 year duo essentials, premier, and advantage as separate quotes',
    expect: p => p.isQuote === true &&
                 p.items.length === 3 &&
                 p.items.every(i => i.baseSku.endsWith('-3YR')) &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ESSENTIALS-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-PREMIER-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ADVANTAGE-3YR') &&
                 p.modifiers?.separateQuotes === true
  },
  {
    name: '"quote all duo as separate links" → 9 items (3 tiers × 3 terms), separateQuotes=true',
    input: 'quote all duo as separate links',
    expect: p => p.isQuote === true &&
                 p.items.length === 9 &&
                 p.modifiers?.separateQuotes === true &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ESSENTIALS-1YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ADVANTAGE-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-PREMIER-5YR')
  },
  {
    name: '"3 year all duo" → 3 items narrowed to 3YR, all 3 tiers, separateQuotes=true (auto)',
    input: '3 year all duo',
    expect: p => p.isQuote === true &&
                 p.items.length === 3 &&
                 p.items.every(i => i.baseSku.endsWith('-3YR')) &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ESSENTIALS-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-PREMIER-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-DUO-ADVANTAGE-3YR') &&
                 p.modifiers?.separateQuotes === true
  },
  {
    name: 'umbrella DNS essentials 3yr — single combo, single term → narrow',
    input: '25 umbrella DNS essentials 3 year',
    expect: p => p.isQuote === true &&
                 p.items.length === 1 &&
                 p.items[0].baseSku === 'LIC-UMB-DNS-ESS-K9-3YR' &&
                 p.items[0].qty === 25 &&
                 p.modifiers?.separateQuotes === false
  },
  {
    name: 'umbrella DNS essentials + SIG advantage → 2 types × 2 tiers × 3 terms = 12 items, separateQuotes=true',
    input: 'umbrella DNS essentials and SIG advantage',
    expect: p => p.isQuote === true &&
                 p.items.length === 12 &&
                 p.modifiers?.separateQuotes === true &&
                 p.items.some(i => i.baseSku === 'LIC-UMB-DNS-ESS-K9-1YR') &&
                 p.items.some(i => i.baseSku === 'LIC-UMB-SIG-ADV-K9-5YR') &&
                 p.items.some(i => i.baseSku === 'LIC-UMB-DNS-ADV-K9-3YR') &&
                 p.items.some(i => i.baseSku === 'LIC-UMB-SIG-ESS-K9-1YR')
  },
  {
    name: 'umbrella DNS both tiers (ess + adv) → 2 combos × 3 terms, separateQuotes=true',
    input: 'DNS essentials and DNS advantage umbrella',
    expect: p => p.isQuote === true &&
                 p.items.length === 6 &&
                 p.modifiers?.separateQuotes === true
  },
  {
    name: 'umbrella missing tier → clarification',
    input: 'umbrella DNS',
    expect: p => p.isClarification === true
  },
  {
    name: 'umbrella missing type → clarification',
    input: 'umbrella essentials',
    expect: p => p.isClarification === true
  },
];

let pass = 0, fail = 0;
for (const c of cases) {
  try {
    const parsed = parseMessage(c.input);
    const ok = c.expect(parsed);
    if (ok) { console.log(`✅ ${c.name}`); pass++; }
    else {
      console.log(`❌ ${c.name}`);
      console.log('   parsed:', JSON.stringify({
        isQuote: parsed.isQuote,
        isClarification: parsed.isClarification,
        itemsLen: parsed.items?.length,
        items: parsed.items?.map(i => i.baseSku + '×' + i.qty),
        modifiers: parsed.modifiers
      }, null, 2));
      fail++;
    }
  } catch (e) {
    console.log(`💥 ${c.name} — ${e.message}`);
    fail++;
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail === 0 ? 0 : 1);
