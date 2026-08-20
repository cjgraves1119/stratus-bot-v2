// Side-by-side proof: OLD worker code vs NEW worker code, same inputs.
//
//   node tools/prove-fixes.mjs
//
// Loads BOTH the pre-change backup of worker-gchat/src/index.js and the current
// one, runs the same requests through each, and prints what changed. Nothing is
// mocked: these are the real parseMessage / buildQuoteResponse functions.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const WORKER = path.join(ROOT, 'worker-gchat');
const OLD_FILE = path.join(WORKER, 'index.js-backup-pre-fix123-20260818');
const NEW_FILE = path.join(WORKER, 'src/index.js');
const require = createRequire(import.meta.url);

function load(file, tag) {
  const esc = (rel) => path.join(WORKER, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(file, 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${esc(rel)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const ed = src.indexOf('export default');
  if (ed > -1) {
    let depth = 0, started = false, end = ed;
    for (let i = ed; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      else if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, ed) + src.slice(end + 1);
  }
  src += '\nmodule.exports = { parseMessage, buildQuoteResponse };\n';
  const tmp = path.join(WORKER, `.tmp-prove-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  try { return require(tmp); } finally { fs.unlinkSync(tmp); }
}

const OLD = load(OLD_FILE, 'old');
const NEW = load(NEW_FILE, 'new');

const B = (s) => `\x1b[1m${s}\x1b[0m`;
const RED = (s) => `\x1b[31m${s}\x1b[0m`;
const GRN = (s) => `\x1b[32m${s}\x1b[0m`;
const DIM = (s) => `\x1b[2m${s}\x1b[0m`;

function run(mod, text) {
  try {
    const parsed = mod.parseMessage(text);
    if (!parsed) return { cart: '(nothing parsed)', urls: [], warn: '' };
    const cart = (parsed.items || []).map((i) => `${i.baseSku} x${i.qty}`).join(', ')
      || (parsed.directLicense ? `${parsed.directLicense.sku} x${parsed.directLicense.qty}`
        : (parsed.directLicenseList || []).map((i) => `${i.sku} x${i.qty}`).join(', '))
      || '(empty)';
    const quote = mod.buildQuoteResponse(parsed);
    const msg = (quote && quote.message) || '';
    return {
      cart,
      urls: msg.match(/https:\/\/stratusinfosystems\.com\/order\/\S+/g) || [],
      warn: (msg.match(/^⚠️.*$/mg) || []).join(' | '),
    };
  } catch (err) { return { cart: `ERROR ${err.message}`, urls: [], warn: '' }; }
}

function show(label, text, whatToLookFor) {
  const o = run(OLD, text), n = run(NEW, text);
  console.log('\n' + '='.repeat(78));
  console.log(B(label));
  console.log(DIM('  input: ') + JSON.stringify(text));
  console.log(DIM('  look for: ') + whatToLookFor);
  console.log('\n  ' + RED('BEFORE') + '  cart: ' + o.cart);
  if (o.warn) console.log('          warn: ' + o.warn);
  o.urls.forEach((u) => console.log('          ' + u));
  console.log('\n  ' + GRN('AFTER') + '   cart: ' + n.cart);
  if (n.warn) console.log('          warn: ' + n.warn);
  n.urls.forEach((u) => console.log('          ' + u));
}

console.log(B('\nOLD = ') + OLD_FILE.replace(ROOT + '/', ''));
console.log(B('NEW = ') + NEW_FILE.replace(ROOT + '/', ''));

show('1. Typo\'d licence in a mixed cart (the Bug 4 repro)',
  'quote 2 MR44 and 3 LIC-MX67C-ENT-3YY',
  'BEFORE invents MX67C hardware, drops the typo, loses qty 3, and quotes "successfully" with no warning. AFTER keeps the typed SKU at qty 3, warns, suggests LIC-MX67C-ENT-3YR, and never puts the bad SKU in a URL.');

show('2. A VALID explicit licence in a mixed cart',
  'quote 2 MR44 and 3 LIC-MX67C-ENT-3YR',
  'BEFORE throws the licence away, invents MX67C-NA hardware and silently changes qty 3 to 1. AFTER keeps it at qty 3 with no phantom hardware.');

show('3. Same thing in the SKU editor requote format',
  '2 MR44-HW\n3 LIC-MX67C-ENT-3YY',
  'This is exactly what the editor sends on Update quote. Same improvement as case 1.');

show('4. Licences mixed with hardware (your screenshot case)',
  'quote 7 MR licenses and 1 MX67C license',
  'BEFORE silently DROPS the MX67C entirely, so the quote is simply wrong. AFTER quotes both lines.');

show('5. Hardware first, then licences',
  'quote 2 MX105 and 7 MR licenses',
  'BEFORE drops the MX105 entirely. AFTER quotes both.');

show('6. REGRESSION GUARD: plain licence-only request',
  'quote 7 MR licenses',
  'Must be IDENTICAL before and after. This is the request that broke last time (Bug 4 revert).');

show('7. REGRESSION GUARD: plain hardware',
  'quote 2 MR44 and 1 MX67C',
  'Must be IDENTICAL before and after.');

show('8. REGRESSION GUARD: licence-only typo (already worked)',
  '3 LIC-MX67C-ENT-3YY',
  'Cart must be IDENTICAL. The chip list behind it got better, see prove-chips below.');

console.log('\n' + '='.repeat(78));
console.log(B('9. Chip suggestions for a typo (this is what makes the chip clickable)'));
const chip = load(NEW_FILE, 'chip2');
for (const [tag, mod] of [['BEFORE', OLD], ['AFTER', NEW]]) {
  let alts = '(helper not exported in this build)';
  try {
    const f = path.join(WORKER, `.tmp-alts-${tag}-${process.pid}.cjs`);
    let src = fs.readFileSync(tag === 'BEFORE' ? OLD_FILE : NEW_FILE, 'utf8');
    const esc = (rel) => path.join(WORKER, 'src', rel).replace(/\\/g, '\\\\');
    src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n2, rel) => `const ${n2} = require('${esc(rel)}');`);
    src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
    src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
    const ed = src.indexOf('export default');
    if (ed > -1) {
      let d = 0, st = false, e2 = ed;
      for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; st = true; } else if (src[i] === '}') { d--; if (st && d === 0) { e2 = i + 1; break; } } }
      src = src.slice(0, ed) + src.slice(e2 + 1);
    }
    src += '\nmodule.exports = { directLicenseCatalogAlternatives };\n';
    fs.writeFileSync(f, src);
    const m = require(f); fs.unlinkSync(f);
    const r = m.directLicenseCatalogAlternatives('LIC-MX67C-ENT-3YY');
    alts = r.length ? r.join(', ') : '(EMPTY - nothing to click)';
  } catch (e) { alts = 'ERROR ' + e.message; }
  console.log(`  ${tag === 'BEFORE' ? RED(tag) : GRN(tag)}  suggestions for LIC-MX67C-ENT-3YY: ${alts}`);
}
void chip;
console.log('\n' + '='.repeat(78));
console.log(B('10. Editor rows: what you have to retype before a quantity edit'));
{
  const ext = await import(path.join(ROOT, 'chrome-extension/src/sidebar/components/sku-editor-core.mjs'));
  const AGN = { 'MR-AGN': 'MR-ENT', 'MV-AGN': 'LIC-MV', 'MT-AGN': 'LIC-MT' };
  const rowsFor = (mod, text) => {
    const p = mod.parseMessage(text);
    if (!p) return ['(nothing parsed)'];
    let rows = (p.items || []).map((i) => ({ sku: AGN[String(i.baseSku).toUpperCase()] || i.baseSku, qty: i.qty }));
    if (typeof mod.editorReadyParsedItems === 'function') rows = mod.editorReadyParsedItems(rows, p);
    return ext.editableRowsFromResult({ parsed: rows.map((r) => ({ baseSku: r.sku, qty: r.qty, resolvedSku: r.resolvedSku, licenseOnly: r.licenseOnly })) })
      .map((r) => r.sku + ' x' + r.qty);
  };
  for (const t of ['quote 7 MR licenses and 1 MX67C license', 'quote 7 MR licenses']) {
    console.log('  input: ' + JSON.stringify(t));
    let before;
    try { before = rowsFor(OLD, t); } catch (e) { before = ['(old build has no editorReadyParsedItems)']; }
    console.log('    ' + RED('BEFORE') + ' rows: ' + JSON.stringify(before));
    console.log('    ' + GRN('AFTER') + '  rows: ' + JSON.stringify(rowsFor(NEW, t)));
  }
  console.log(DIM('  AFTER rows are real catalog SKUs, so a quantity-only edit re-quotes with no retyping.'));

  console.log('\n' + B('11. License tier dropdown (new)'));
  for (const [label, rows, prior, tier] of [
    ['MX105 default   ', [{ sku: 'MX105', qty: 2 }], 'quote 2 MX105', ''],
    ['MX105 Enterprise', [{ sku: 'MX105', qty: 2 }], 'quote 2 MX105', 'enterprise'],
    ['MX105 SD-WAN    ', [{ sku: 'MX105', qty: 2 }], 'quote 2 MX105', 'sdwan'],
    ['C9200L default  ', [{ sku: 'C9200L-24P-4G-M', qty: 1 }], 'quote 1 C9200L-24P', ''],
    ['C9200L Advanced ', [{ sku: 'C9200L-24P-4G-M', qty: 1 }], 'quote 1 C9200L-24P', 'advanced'],
  ]) {
    const prep = ext.quoteTextFromEditorRows(rows, prior, { tier });
    const out = prep.ok ? run(NEW, prep.text).urls[1] || '(no url)' : 'FAIL ' + prep.error;
    console.log('  ' + label + ' -> ' + out);
  }
  console.log(DIM('  The tier changes the licence SKU and the hardware stays in the cart.'));
}

console.log('\n' + '='.repeat(78));
console.log(B('Done.') + ' Cases 1-5, 9, 10, 11 should differ or improve. Cases 6-8 must be identical.\n');
