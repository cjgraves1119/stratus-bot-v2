// Description→SKU mismatch confirmation gate — IMP-3 (SEDA postmortem, 2026-06-10):
// a customer email asked for a "125W AC CONFIG 5 POWER SUPPLY W/MERAKI"
// (PWR-C5-125WAC-M, ~$1,309) and the model mis-mapped that free text to
// MA-PWR-30W-US — a $30 Meraki AP wall adapter. create_deal_and_quote committed
// it silently because staging only checks cache membership. HARD GATE #6b now
// compares each line's source_text against the resolved SKU family and returns
// error:'resolved_items_need_confirmation' on confident conflicts, before any
// Deal/Quote/Task is written. confirm_resolved_items:true bypasses after the
// user confirms.
//
// Drives the REAL checkSkuDescriptionMismatch. Run:
//   node worker-gchat/test-sku-description-gate-2026-06-10.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine() {
  const here = __dirname;
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
  src += `\nmodule.exports = { checkSkuDescriptionMismatch };`;
  const tmp = path.join(os.tmpdir(), `skugate-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { checkSkuDescriptionMismatch } = loadEngine();

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };
const gate = (entries) => checkSkuDescriptionMismatch(entries);
const flags = (entries) => gate(entries).mismatches;

const SEDA_TEXT = '125W AC CONFIG 5 POWER SUPPLY W/MERAKI';

console.log('SEDA exact case (the failure this gate kills)');
{
  const m = flags([{ sku: 'MA-PWR-30W-US', qty: 2, source_text: SEDA_TEXT }]);
  ok(m.length === 1 && m[0].sku === 'MA-PWR-30W-US', 'psu-text → MA-PWR-30W-US flagged as MISMATCH');
  ok(m.length === 1 && /power supply/i.test(m[0].reason) && /MA-PWR-30W-US/.test(m[0].reason) && /adapter/i.test(m[0].reason),
    '→ reason names both sides plainly (power supply vs Meraki AC adapter)');
  ok(m.length === 1 && m[0].source_text === SEDA_TEXT, '→ mismatch carries the original source_text');
}
ok(flags([{ sku: 'PWR-C5-125WAC-M', qty: 2, source_text: SEDA_TEXT }]).length === 0,
  'same text → correct SKU PWR-C5-125WAC-M passes');

console.log('Full SEDA BOM: only the bad line flags');
{
  const m = flags([
    { sku: 'C9200L-24T-4G-M', qty: 2, source_text: 'C9200L 24-PORT DATA ONLY 4 X 1G W/MERAKI' },
    { sku: 'MA-PWR-30W-US', qty: 2, source_text: SEDA_TEXT },
    { sku: 'LIC-C9200L-24E-3Y', qty: 2, source_text: 'MERAKI ESSENTIALS LICENSE FOR C9200L 24-PORT 3 YEAR' },
  ]);
  ok(m.length === 1 && m[0].sku === 'MA-PWR-30W-US', '3-line BOM → exactly the mis-mapped line flagged');
}
ok(flags([{ sku: 'C9200L-24T-4G-M', qty: 2, source_text: 'C9200L 24-PORT DATA ONLY 4 X 1G W/MERAKI' }]).length === 0,
  'switch-text → C9200L switch passes');
ok(flags([{ sku: 'LIC-C9200L-24E-3Y', qty: 2, source_text: 'MERAKI ESSENTIALS LICENSE FOR C9200L 24-PORT 3 YEAR' }]).length === 0,
  'license-text → license SKU passes');

console.log('Other hard-conflict classes');
ok(flags([{ sku: 'MR44', qty: 5, source_text: 'MERAKI ENTERPRISE LICENSE 3 YEAR' }]).length === 1,
  'license-text → hardware SKU (MR44) = MISMATCH');
ok(flags([{ sku: 'PWR-C5-600WAC-M', qty: 1, source_text: '48 PORT GIGABIT SWITCH WITH POE' }]).length === 1,
  'switch-text → PWR- power supply = MISMATCH');
ok(flags([{ sku: 'MV63', qty: 3, source_text: 'OUTDOOR WIFI ACCESS POINT' }]).length === 1,
  'ap-text → MV camera = MISMATCH');

console.log('Conservative fail-open behavior (zero friction when uncertain)');
ok(flags([{ sku: 'MA-PWR-30W-US', qty: 1 }]).length === 0,
  'no source_text → never flags (exact-SKU flows untouched)');
ok(flags([{ sku: 'PWR-C5-125WAC-M', qty: 1, source_text: 'please quote PWR-C5-125WAC-M for the new switch' }]).length === 0,
  'source_text verbatim-contains the SKU → pass');
ok(flags([{ sku: 'PWR-C5-125WAC-M', qty: 1, source_text: 'pwr c5 125wac m power supply' }]).length === 0,
  'case/dash-insensitive SKU containment → pass');
ok(flags([{ sku: 'MR-AGN', qty: 21, source_text: 'renew the licenses for the access points' }]).length === 0,
  'model-agnostic alias (MR-AGN) → skipped');
ok(flags([{ sku: 'MT-AGN', qty: 4, source_text: 'sensor subscription renewal' }]).length === 0,
  'model-agnostic alias (MT-AGN) → skipped');
ok(flags([]).length === 0 && flags(null).length === 0 && flags(undefined).length === 0,
  'empty / non-array entries → empty result, no throw');
ok(flags([{ sku: 'PWR-C5-1KWAC-M', qty: 1, source_text: 'PWR-C5 1KW upgrade kit' }]).length === 0,
  'token overlap with SKU ("PWR-C5") vetoes a would-be mismatch');
ok(flags([{ sku: 'MA-MNT-MV-21', qty: 1, source_text: 'MV CAMERA MOUNT' }]).length === 0,
  'camera-text → MA- camera MOUNT is adjacent, not flagged (no false positive)');
ok(flags([{ sku: 'MX68', qty: 1, source_text: 'BRANCH OFFICE FIREWALL' }]).length === 0,
  'security-text → MX security appliance passes');
ok(flags([{ sku: 'MS130-48P', qty: 1, source_text: 'no recognizable keywords here' }]).length === 0,
  'no intent keywords in text → silence');

console.log('Wiring / source-guards (call-site placement + schema)');
{
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  const gateCall = src.indexOf('checkSkuDescriptionMismatch(_gateEntries)');
  const stagingLoopEnd = src.indexOf("error: 'unresolved_user_hardware'"); // HARD GATE #6, post-staging
  const dealCreate = src.indexOf('STEP 5: Create Deal');
  const step3c = src.indexOf('STEP 3c: Reorder resolved products');
  ok(gateCall > -1, 'create_deal_and_quote executor calls checkSkuDescriptionMismatch(_gateEntries)');
  ok(gateCall > stagingLoopEnd && stagingLoopEnd > -1, 'gate sits AFTER the skus[] staging loop (after HARD GATE #6)');
  ok(gateCall < step3c && step3c < dealCreate, 'gate sits BEFORE STEP 3c/STEP 5 — nothing written to Zoho on refusal');
  ok((src.match(/resolved_items_need_confirmation/g) || []).length >= 3,
    "error string 'resolved_items_need_confirmation' present (executor + both tool descriptions)");
  ok(/toolInput\.confirm_resolved_items !== true/.test(src), 'confirm_resolved_items bypass wired');
  ok((src.match(/source_text: \{ type: 'string'/g) || []).length === 2,
    'skus[] item schema gains source_text on BOTH create_deal_and_quote and create_quote_on_deal');
  ok((src.match(/confirm_resolved_items: \{ type: 'boolean'/g) || []).length === 2,
    'top-level confirm_resolved_items on BOTH tool schemas');
  // create_quote_on_deal delegates wholesale (...rest) into create_deal_and_quote,
  // so source_text + confirm_resolved_items flow through and the gate comes free.
  ok(/const \{ deal_id, \.\.\.rest \} = toolInput \|\| \{\};/.test(src)
     && /return await executeToolCall\('create_deal_and_quote', \{\s*\.\.\.rest,/.test(src),
    'create_quote_on_deal still forwards toolInput wholesale (gate inherited)');
  ok(/_gateEntries\.push\(\{ sku: rawSku, qty, source_text: sourceText \}\)/.test(src),
    'staging loop threads entry.source_text into the gate entries');

  // ── Codex round-1 HIGH: PWR is family-ambiguous — must never veto ──
  // 'PWR' appears in BOTH MA-PWR-* (AP wall adapters) and PWR-C* (switch PSUs):
  // text quoting the RIGHT psu family must still flag the WRONG accessory SKU.
  let rr = checkSkuDescriptionMismatch([{ sku: 'MA-PWR-30W-US', qty: 2, source_text: 'PWR-C5 125WAC power supply' }]);
  ok(rr.mismatches.length === 1, "'PWR-C5 125WAC power supply' → MA-PWR-30W-US still FLAGS (PWR token cannot veto)");
  rr = checkSkuDescriptionMismatch([{ sku: 'PWR-C5-125WAC-M', qty: 2, source_text: 'PWR-C5 125WAC power supply' }]);
  ok(rr.mismatches.length === 0, 'same text → PWR-C5-125WAC-M passes (squashed-prefix/125WAC veto)');
  rr = checkSkuDescriptionMismatch([{ sku: 'PWR-C5-125WAC-M', qty: 2, source_text: '125W AC CONFIG 5 POWER SUPPLY W/MERAKI' }]);
  ok(rr.mismatches.length === 0, 'canonical SEDA text → correct PSU still passes (125WAC token veto)');
  // Codex round-2: bare 'PWR' in text must NOT imply psu intent — a legit AP
  // power-adapter request resolved to the CORRECT accessory must never block.
  rr = checkSkuDescriptionMismatch([{ sku: 'MA-PWR-30W-US', qty: 1, source_text: 'PWR adapter for MR46' }]);
  ok(rr.mismatches.length === 0, "'PWR adapter for MR46' → MA-PWR-30W-US passes (no false-block)");
  rr = checkSkuDescriptionMismatch([{ sku: 'MA-PWR-30W-US', qty: 1, source_text: 'need a 125w pwr supply' }]);
  ok(rr.mismatches.length === 1, "'pwr supply' phrasing still carries psu intent → flags vs accessory");
  // multi-intent text ('...for the switch') stays SILENT by design (every-intent rule):
  rr = checkSkuDescriptionMismatch([{ sku: 'MA-PWR-30W-US', qty: 1, source_text: 'pwr supply for the switch' }]);
  ok(rr.mismatches.length === 0, 'psu+switch multi-intent → conservative silence (documented)');

  // ── Codex round-1 MEDIUM: structured retry names the ORIGINAL public tool ──
  ok(src.includes("tool: toolInput.existing_deal_id ? 'create_quote_on_deal' : 'create_deal_and_quote'"),
    'gate returns bypass_tool_call naming the original public tool');
}

console.log('');
console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
