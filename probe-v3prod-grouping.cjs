// Offline grouping probe for buildQuoteFromV3 (Phase 3). No live classifier.
// Hand-authored canonical V3 classifications for the cases where GROUPING matters.
// Prints the rendered message + asserts per-URL structure, and cross-checks the
// production path (consumeV3prod) against the proven consumeV3 (union) SKU set.
const { loadEngine, consumeV3, consumeV3prod, skuQty } = require('/tmp/phase3/eval-model-intent-2026-06-04.js');
const eng = loadEngine('/tmp/phase3/worker');

// canonical V3 classification builder
const v3 = (items, mods = {}) => ({ intent: 'quote', clarify: { needed: false, question: '' }, items, modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false, ...mods } });
const I = (product, intent, qty = 1) => ({ product, qty, intent });

const CASES = [
  { tag: 'order:liconly+bareNormal', text: '1 MR44 license renewal and 1 CW9172I',
    v3: v3([I('MR44', 'license', 1), I('CW9172I', 'normal', 1)]),
    assert: m => ({ 'CW9172I hw present': /CW9172I/.test(JSON.stringify(m)), 'LIC-ENT summed qty=2': m['LIC-ENT-1YR'] === 2 || m['LIC-ENT-3YR'] === 2 || m['LIC-ENT-5YR'] === 2, 'no MR44-HW': !Object.keys(m).some(k => /MR44-HW/.test(k)) }) },
  { tag: 'order:hwonly+normal', text: '1 CW9172I hardware only and 6 MR44',
    v3: v3([I('CW9172I', 'hardware', 1), I('MR44', 'normal', 6)]),
    assert: m => ({ 'CW9172I present': Object.keys(m).some(k => /CW9172I/.test(k)), 'MR44-HW qty6': Object.entries(m).some(([k, q]) => /MR44-HW/.test(k) && q === 6), 'LIC-ENT qty6': Object.entries(m).some(([k, q]) => /LIC-ENT/.test(k) && q === 6) }) },
  { tag: 'cov:duo+mr-normal (NAMED-LICENSE flatten risk)', text: '10 duo essentials and 6 mr44',
    v3: v3([I('duo essentials', 'normal', 10), I('mr44', 'normal', 6)]),
    assert: m => ({ 'LIC-DUO present (not dropped)': Object.keys(m).some(k => /DUO/.test(k)), 'MR44-HW present': Object.keys(m).some(k => /MR44-HW/.test(k)), 'LIC-ENT present': Object.keys(m).some(k => /LIC-ENT/.test(k)) }) },
  { tag: 'mixed:lic+lic+hwonly', text: '6 mr and 1 mx84 enterprise license renewal and 1 CW9172I hardware only',
    v3: v3([I('mr', 'license', 6), I('mx84', 'license', 1), I('CW9172I', 'hardware', 1)], { tier: 'ENT' }),
    assert: m => ({ 'LIC-ENT (mr) present': Object.keys(m).some(k => /^LIC-ENT/.test(k)), 'LIC-MX84 present': Object.keys(m).some(k => /MX84/.test(k) && /LIC/.test(k)), 'CW9172I present': Object.keys(m).some(k => /CW9172I/.test(k)), 'no MR-HW': !Object.keys(m).some(k => /MR.*-HW/.test(k)), 'no MX84-HW': !Object.keys(m).some(k => /MX84-HW/.test(k)) }) },
  { tag: 'cov:separate-quotes', text: '5 MR46 and 5 MR44 as separate quotes',
    v3: v3([I('MR46', 'normal', 5), I('MR44', 'normal', 5)], { separate_quotes: true }),
    assert: m => ({ 'MR46-HW present': Object.keys(m).some(k => /MR46-HW/.test(k)), 'MR44-HW present': Object.keys(m).some(k => /MR44-HW/.test(k)) }) },
  { tag: 'cov:sme-1-3yr-cap (SME 5YR must never appear)', text: 'SME license 1yr and 3yr',
    v3: v3([I('Systems Manager', 'license', 1)], { all_terms: true }),
    assert: m => ({ 'has SME 1YR or 3YR': Object.keys(m).some(k => /SME/.test(k) && /(1YR|3YR)/.test(k)), 'NO SME 5YR/5Y': !Object.keys(m).some(k => /SME/.test(k) && /5Y/.test(k)) }) },
  { tag: 'cov:mx-sec-5yr (tier+term)', text: '10 mx67 SEC 5 year',
    v3: v3([I('MX67', 'normal', 10)], { tier: 'SEC', term_years: 5 }),
    assert: m => ({ 'MX67 hw present': Object.keys(m).some(k => /MX67/.test(k) && !/LIC/.test(k)), 'SEC 5Y license present': Object.keys(m).some(k => /MX67/.test(k) && /SEC/.test(k) && /5Y/.test(k)), 'no 1Y/3Y license': !Object.keys(m).some(k => /LIC/.test(k) && /(1YR|3YR|-1Y|-3Y)/.test(k)) }) },
  // regression: singles must be unchanged
  { tag: 'single:normal', text: '6 mr44', v3: v3([I('mr44', 'normal', 6)]),
    assert: m => ({ 'MR44-HW qty6': Object.entries(m).some(([k, q]) => /MR44-HW/.test(k) && q === 6), 'LIC-ENT present': Object.keys(m).some(k => /LIC-ENT/.test(k)) }) },
  { tag: 'single:hwonly', text: '6 mr44 hardware only', v3: v3([I('mr44', 'hardware', 6)]),
    assert: m => ({ 'MR44-HW qty6': Object.entries(m).some(([k, q]) => /MR44-HW/.test(k) && q === 6), 'no license': !Object.keys(m).some(k => /LIC/.test(k)) }) },
];

// Per-term SKU map from a rendered message: { '1Y': {sku:qty}, '3Y': {...}, '5Y': {...}, 'NOTERM': {...} }
function perTermSkus(message) {
  const out = {};
  for (const line of (message || '').split('\n')) {
    const lm = line.match(/(\d)-Year Co-Term/);
    const um = line.match(/[?&]item=([^&\s]+)&qty=([0-9,]+)/);
    if (!um) continue;
    const term = lm ? `${lm[1]}Y` : 'NOTERM';
    out[term] = out[term] || {};
    const skus = decodeURIComponent(um[1]).split(','); const qtys = um[2].split(',');
    skus.forEach((s, i) => { out[term][s] = (out[term][s] || 0) + (parseInt(qtys[i] || '0', 10)); });
  }
  return out;
}
// STRICT term-grouping invariant: a term-suffixed license SKU must appear ONLY under its own term.
function termLeakCheck(pt) {
  const leaks = [];
  for (const term of Object.keys(pt)) {
    for (const sku of Object.keys(pt[term])) {
      const m = sku.match(/-([135])Y(?:R)?(?:-S\d+)?$/);
      if (m && term !== 'NOTERM' && `${m[1]}Y` !== term) leaks.push(`${sku} leaked into ${term} url`);
    }
  }
  return leaks;
}

let allPass = true;
for (const c of CASES) {
  const prod = consumeV3prod(eng, c.v3, c.text);
  const ref = consumeV3(eng, c.v3, c.text);
  console.log('\n━━━ ' + c.tag);
  console.log('  in       : ' + c.text);
  console.log('  prod.kind: ' + prod.kind + (prod.errors ? ' ERR=' + JSON.stringify(prod.errors) : ''));
  console.log('  prod.skus: ' + JSON.stringify(prod.skus || {}));
  console.log('  ref.skus : ' + JSON.stringify(ref.skus || {}) + '  (consumeV3 union — qtys MAX not SUM)');
  if (prod.message) console.log('  URLs     :\n' + (prod.message.match(/https:\/\/stratusinfosystems\.com\/order\/\S+/g) || []).map(u => '             ' + u).join('\n'));
  const checks = prod.kind === 'quote' ? c.assert(prod.skus) : { 'rendered a quote': false };
  // strict per-term leak check on every rendered quote
  if (prod.kind === 'quote' && prod.message) {
    const leaks = termLeakCheck(perTermSkus(prod.message));
    checks['no term-leak (each LIC-*-NY only under its own term url)'] = leaks.length === 0;
    if (leaks.length) console.log('    leaks: ' + JSON.stringify(leaks));
  }
  for (const [k, v] of Object.entries(checks)) { console.log('    ' + (v ? '✅' : '❌') + ' ' + k); if (!v) allPass = false; }
}
console.log('\n' + (allPass ? '✅ ALL GROUPING CHECKS PASS' : '❌ SOME CHECKS FAILED'));
process.exit(allPass ? 0 : 1);
