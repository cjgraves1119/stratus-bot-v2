// WS6B (2026-06-04): worker-gchat license NLP parity with worker/ (Webex).
// Covers Duo/Umbrella/AnyConnect named-term filtering, AnyConnect separate
// tier quotes, multi-tier license families, bare CW stem promotion, and
// bare-family quantity fallback.
//
// Run: node worker-gchat/test-ws6b-license-nlp-parity-2026-06-04.js

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

function buildShim(rootDir) {
  const here = path.resolve(rootDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
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

  src += '\nmodule.exports = { parseMessage, buildQuoteResponse, applySuffix };';
  const mod = new Module(path.join(here, 'src/index.js'));
  mod.filename = path.join(here, 'src/index.js');
  mod.paths = Module._nodeModulePaths(here);
  mod._compile(src, mod.filename);
  return mod.exports;
}

const gchat = buildShim(__dirname);
const webex = buildShim(path.resolve(__dirname, '../worker'));

const render = (shim, text) => {
  const parsed = shim.parseMessage(text);
  assert.ok(parsed, `${text}: parseMessage returned null`);
  const out = shim.buildQuoteResponse(parsed);
  assert.ok(out && out.message, `${text}: buildQuoteResponse returned no message`);
  return { parsed, out, message: out.message };
};

const urlCount = msg => (msg.match(/https:\/\/stratusinfosystems\.com\/order\/\?item=/g) || []).length;
const hasCombinedUrl = (msg, skuA, skuB) => {
  const urls = msg.match(/https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s]+/g) || [];
  return urls.some(url => url.includes(skuA) && url.includes(skuB));
};

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    pass++;
  } catch (err) {
    console.log(`FAIL ${name}\n  ${err.message}`);
    fail++;
  }
}

function sameAsWebex(input) {
  const g = render(gchat, input).message;
  const w = render(webex, input).message;
  assert.strictEqual(g, w, `${input}: gchat output differs from worker/`);
  return g;
}

console.log('Part 1: named terms narrow Duo/Umbrella/AnyConnect');
t('Duo named 3-year emits only LIC-DUO-ESSENTIALS-3YR', () => {
  const msg = sameAsWebex('quote 10 duo essentials 3 year');
  assert.ok(/LIC-DUO-ESSENTIALS-3YR/.test(msg), msg);
  assert.ok(!/LIC-DUO-ESSENTIALS-1YR|LIC-DUO-ESSENTIALS-5YR/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 1, msg);
});
t('Umbrella named 3-year emits only LIC-UMB-DNS-ESS-K9-3YR', () => {
  const msg = sameAsWebex('quote 10 umbrella DNS essentials 3 year');
  assert.ok(/LIC-UMB-DNS-ESS-K9-3YR/.test(msg), msg);
  assert.ok(!/LIC-UMB-DNS-ESS-K9-1YR|LIC-UMB-DNS-ESS-K9-5YR/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 1, msg);
});
t('AnyConnect named 3-year emits only 3Y-S1, split by tier', () => {
  const msg = sameAsWebex('quote 10 AnyConnect 3 year');
  assert.ok(/\*\*AnyConnect Apex:\*\*/.test(msg) && /\*\*AnyConnect Plus:\*\*/.test(msg), msg);
  assert.ok(/LIC-L-AC-APX-3Y-S1/.test(msg) && /LIC-L-AC-PLS-3Y-S1/.test(msg), msg);
  assert.ok(!/LIC-L-AC-(?:APX|PLS)-[15]Y-S1/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 2, msg);
  assert.ok(!hasCombinedUrl(msg, 'LIC-L-AC-APX-3Y-S1', 'LIC-L-AC-PLS-3Y-S1'), msg);
});

console.log('Part 2: untiered AnyConnect is separate per tier');
t('Untiered AnyConnect renders APX and PLS as separate tier blocks', () => {
  const msg = sameAsWebex('quote 10 AnyConnect');
  assert.ok(/\*\*AnyConnect Apex:\*\*/.test(msg) && /\*\*AnyConnect Plus:\*\*/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 6, msg);
  for (const term of ['1Y', '3Y', '5Y']) {
    assert.ok(!hasCombinedUrl(msg, `LIC-L-AC-APX-${term}-S1`, `LIC-L-AC-PLS-${term}-S1`), msg);
  }
});

console.log('Part 3: multi-tier Duo/Umbrella keeps all named tiers');
t('Multi-tier Duo keeps Essentials, Premier, and Advantage', () => {
  const msg = sameAsWebex('quote 10 duo essentials, premier, and advantage');
  for (const label of ['Duo Essentials', 'Duo Premier', 'Duo Advantage']) {
    assert.ok(msg.includes(`**${label}:**`), msg);
  }
  assert.strictEqual(urlCount(msg), 9, msg);
});
t('Multi-combo Umbrella keeps DNS Essentials, DNS Advantage, and SIG Advantage', () => {
  const msg = sameAsWebex('quote 10 umbrella DNS essentials, DNS advantage, SIG advantage');
  for (const label of ['Umbrella DNS Essentials', 'Umbrella DNS Advantage', 'Umbrella SIG Advantage']) {
    assert.ok(msg.includes(`**${label}:**`), msg);
  }
  assert.strictEqual(urlCount(msg), 12, msg);
});
t('All Duo 3-year emits all three Duo tiers at 3-year only', () => {
  const msg = sameAsWebex('quote all duo 3 year');
  for (const sku of ['LIC-DUO-ESSENTIALS-3YR', 'LIC-DUO-ADVANTAGE-3YR', 'LIC-DUO-PREMIER-3YR']) {
    assert.ok(msg.includes(sku), msg);
  }
  assert.ok(!/LIC-DUO-[A-Z]+-[15]YR/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 3, msg);
});
t('All Umbrella 3-year emits all four type/tier combos at 3-year only', () => {
  const msg = render(gchat, 'quote all umbrella 3 year').message;
  for (const sku of [
    'LIC-UMB-DNS-ESS-K9-3YR',
    'LIC-UMB-DNS-ADV-K9-3YR',
    'LIC-UMB-SIG-ESS-K9-3YR',
    'LIC-UMB-SIG-ADV-K9-3YR'
  ]) {
    assert.ok(msg.includes(sku), msg);
  }
  assert.ok(!/LIC-UMB-[A-Z]+-[A-Z]+-K9-[15]YR/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 4, msg);
});

console.log('Part 4: CW bare stems promote like worker/');
for (const [input, expected] of [
  ['CW9164', 'CW9164I-MR'],
  ['CW9166', 'CW9166I-MR'],
  ['CW9172', 'CW9172I-RTG'],
  ['CW9176', 'CW9176I-RTG']
]) {
  t(`${input} renders ${expected}`, () => {
    const msg = sameAsWebex(input);
    assert.ok(msg.includes(expected), msg);
    assert.strictEqual(gchat.applySuffix(input), webex.applySuffix(input));
  });
}

console.log('Part 5: bare-family + quantity fallback');
t('"quote 5 MS150" returns the deterministic variant list', () => {
  const msg = sameAsWebex('quote 5 MS150');
  assert.ok(/\*\*MS150\*\* is not a recognized SKU/.test(msg), msg);
  assert.ok(/MS150-24MP-4X/.test(msg) && /MS150-48FP-4X/.test(msg), msg);
  assert.strictEqual(urlCount(msg), 0, msg);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
