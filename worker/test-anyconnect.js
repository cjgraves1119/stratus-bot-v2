// Focused AnyConnect parser test — exercises the new natural-language handler.
// Run: node test-anyconnect.js

const fs = require('fs');
const path = require('path');

// Build the same CJS shim as test-local.js does
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
  const tmp = path.join(require('os').tmpdir(), 'ac-shim.cjs');
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { parseMessage } = buildParserShim();

// Helper: extract base SKUs + quantities from a parse result
function itemsSummary(res) {
  if (!res) return '(null result)';
  if (res.isClarification) return `CLARIFY: ${res.clarificationMessage?.slice(0, 80)}...`;
  const items = res.items || [];
  return items.map(it => `${it.baseSku} x${it.qty}`).join(', ');
}

const tests = [
  {
    name: 'Direct AnyConnect Apex 50',
    input: '50 AnyConnect Apex',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.includes('LIC-L-AC-APX-1Y-S1') && skus.includes('LIC-L-AC-APX-3Y-S1') && skus.includes('LIC-L-AC-APX-5Y-S1')
        && !skus.some(s => s.includes('PLS')) && r.items.every(i => i.qty === 50);
    },
  },
  {
    name: 'Direct AnyConnect Plus 100',
    input: 'AnyConnect Plus 100',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.includes('LIC-L-AC-PLS-1Y-S1') && skus.length === 3 && r.items.every(i => i.qty === 100);
    },
  },
  {
    name: 'No tier → both Apex + Plus (6 SKUs)',
    input: 'AnyConnect 50',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.length === 6 && skus.includes('LIC-L-AC-APX-1Y-S1') && skus.includes('LIC-L-AC-PLS-5Y-S1')
        && r.items.every(i => i.qty === 50);
    },
  },
  {
    name: 'Cisco VPN alias → both tiers',
    input: 'quote Cisco VPN 75',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.length === 6 && skus.includes('LIC-L-AC-APX-1Y-S1') && skus.includes('LIC-L-AC-PLS-5Y-S1');
    },
  },
  {
    name: 'Cisco Secure Client alias → both tiers',
    input: 'quote 40 Cisco Secure Client',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.length === 6 && r.items.every(i => i.qty === 40);
    },
  },
  {
    name: 'Secure Client alias (no Cisco)',
    input: 'Secure Client 50 apex',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.every(s => s.includes('-APX-')) && skus.length === 3;
    },
  },
  {
    name: 'Min qty 25 — below-minimum clamp (5 → 25)',
    input: '5 AnyConnect Plus',
    expect: (r) => {
      return r.items.every(i => i.qty === 25) && !!r.clarificationNote
        && r.clarificationNote.includes('25-user');
    },
  },
  {
    name: 'Explicit term filter (3 year)',
    input: '100 AnyConnect Apex 3 year',
    expect: (r) => {
      const skus = (r.items || []).map(it => it.baseSku);
      return skus.length === 1 && skus[0] === 'LIC-L-AC-APX-3Y-S1' && r.items[0].qty === 100;
    },
  },
  {
    name: 'Direct SKU — LIC-L-AC-APX-1Y-S1 still parses',
    input: 'LIC-L-AC-APX-1Y-S1 50',
    expect: (r) => {
      // Direct SKU path doesn't go through AnyConnect handler; should produce the single SKU.
      const all = [...(r.items || []), ...(r.directLicenseList || [])];
      return all.some(it => (it.sku || it.baseSku) === 'LIC-L-AC-APX-1Y-S1');
    },
  },
];

let passed = 0, failed = 0;
for (const t of tests) {
  let result;
  try { result = parseMessage(t.input); }
  catch (e) { console.log(`✗ ${t.name}\n    ERROR: ${e.message}`); failed++; continue; }
  const ok = t.expect(result);
  if (ok) {
    console.log(`✓ ${t.name}  →  ${itemsSummary(result)}${result.clarificationNote ? ' [note]' : ''}`);
    passed++;
  } else {
    console.log(`✗ ${t.name}`);
    console.log(`   input: "${t.input}"`);
    console.log(`   got:   ${JSON.stringify(result, null, 2).slice(0, 500)}`);
    failed++;
  }
}
console.log(`\n${passed}/${passed + failed} passed`);
process.exit(failed > 0 ? 1 : 0);
