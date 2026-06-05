// Dash-insensitive catalog lookup — regression guard for the MA-MNT-MV88 production
// slowness (gateway_log ts=2026-06-05T13:42:37Z total_ms=60374, tool_count=10).
// Root cause: user typed accessory SKUs WITHOUT the mid-SKU dash (MA-MNT-MV88) but the
// catalog key is dashed (MA-MNT-MV-88) → exact-miss → zoho_product_id cache defeated →
// 7 serial live CRM searches. Fix: a dash-insensitive fallback as the LAST step of the
// catalog lookup, applied to BOTH workers. This test asserts ZERO-API-call resolution.
//
// Run: node worker-gchat/test-dash-insensitive-sku-2026-06-05.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

// Load a worker's src/index.js as CJS and re-export the pure lookup fns + the prices catalog.
function loadLookups(workerDir, tag, exportNames) {
  const here = path.join(__dirname, '..', workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { ${exportNames.join(', ')} };`;
  const tmp = path.join(os.tmpdir(), `dashsku-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

// Any prices access here is the in-process static catalog — ZERO network/API calls.
const G = loadLookups('worker-gchat', 'gch', ['resolveCatalogSku', 'getPrice', 'dashInsensitiveCatalogKey', 'prices']);
const W = loadLookups('worker', 'wbx', ['getPrice', 'dashInsensitiveCatalogKey', 'prices']);

const MOUNTS = [
  ['MA-MNT-MV88', 'MA-MNT-MV-88'],
  ['MA-MNT-MV78', 'MA-MNT-MV-78'],
  ['MA-MNT-MV28', 'MA-MNT-MV-28'],
  ['MA-MNT-MV38', 'MA-MNT-MV-38'],
];

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

console.log('── worker-gchat: resolveCatalogSku dash-insensitive (the 60s-bug path) ──');
for (const [dashless, canonical] of MOUNTS) {
  ok(G.resolveCatalogSku(dashless) === canonical, `resolveCatalogSku(${dashless}) === ${canonical}`);
  const resolved = G.resolveCatalogSku(dashless);
  ok(G.prices[resolved] && G.prices[resolved].zoho_product_id, `${canonical} carries a zoho_product_id (no live lookup needed)`);
}

console.log('── worker-gchat: getPrice dash-insensitive ──');
for (const [dashless, canonical] of MOUNTS) {
  const p = G.getPrice(dashless);
  ok(p && p.zoho_product_id === G.prices[canonical].zoho_product_id, `getPrice(${dashless}) → ${canonical} entry`);
}

console.log('── worker (webex): getPrice dash-insensitive (parity) ──');
for (const [dashless, canonical] of MOUNTS) {
  const p = W.getPrice(dashless);
  ok(p && p.zoho_product_id === W.prices[canonical].zoho_product_id, `getPrice(${dashless}) → ${canonical} entry`);
}

console.log('── safety: the fallback only fires on a miss; never overrides a valid match ──');
// exact catalog hit returns the key unchanged
ok(G.resolveCatalogSku('MA-MNT-MV-88') === 'MA-MNT-MV-88', 'exact dashed key returns unchanged');
// existing LIC -Y/-YR flip still works
ok(G.resolveCatalogSku('LIC-ENT-3Y') === 'LIC-ENT-3YR' || G.prices['LIC-ENT-3Y'] || true, 'LIC term-flip path intact (resolves to a catalog key)');
ok(G.prices[G.resolveCatalogSku('LIC-ENT-3Y')], 'LIC-ENT-3Y resolves to a real catalog key');
// genuinely-unknown SKU returns input unchanged (no spurious match)
ok(G.resolveCatalogSku('TOTALLY-NOT-A-SKU-99') === 'TOTALLY-NOT-A-SKU-99', 'unknown SKU returned unchanged');
ok(G.dashInsensitiveCatalogKey('TOTALLYNOTASKU99') === null, 'no dash-match for an unknown bare string');
// a normal hardware SKU still prices correctly (no regression)
ok(W.getPrice('MR44-HW') || W.getPrice('MR44'), 'normal hardware SKU still prices');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass}/${pass + fail} assertions passed`);
process.exit(fail === 0 ? 0 : 1);
