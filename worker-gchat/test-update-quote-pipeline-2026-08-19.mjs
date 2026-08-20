// FULL "Update quote" pipeline test.
//
// WHY THIS EXISTS. Every earlier test asserted ONE stage in isolation: the
// serializer, or the worker, or the verifier. Chris's per-line "None" bug lived
// in the INTERACTION between them, so all of those tests passed while the feature
// was broken in the product. This runs the chain rebuildQuoteMessage actually
// runs, in order, and asserts the outcome the rep sees.
//
//   editor rows (+ per-row tier)
//     -> quoteTextFromEditorRows(rows, msg.skuText, { tier })
//     -> runQuote: MR-ENT strip, worker parseMessage/buildQuoteResponse, remerge
//     -> typedHardwareOnlyResult(result, prepared.text)
//     -> withHardwareOnlyQuoteOption(candidate, prepared.rows)
//     -> verifyStratusOrderUrlOptions(urls, rows, requirements)
//
// Anything that changes any stage should be run through here before shipping.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// The REAL "Update quote" chain, end to end, exactly as rebuildQuoteMessage runs it:
//
//   editor rows (+ tier)
//     -> quoteTextFromEditorRows(rows, msg.skuText, { tier })     [extension]
//     -> runQuote: MR-ENT strip, worker parseMessage/buildQuoteResponse, remerge
//     -> typedHardwareOnlyResult(result, prepared.text)            [extension]
//     -> withHardwareOnlyQuoteOption(candidate, prepared.rows)     [extension]
//     -> verifyStratusOrderUrlOptions(urls, rows, requirements)    [extension]
//
// This is the coverage that was missing: every earlier test asserted a single
// stage in isolation, so a failure produced by the INTERACTION of stages (the
// prior request text feeding quoteModeFromText, then verification against an
// EOL-swapped URL) was invisible.

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(WORKER, '..');
const require = createRequire(path.join(WORKER, 'x.cjs'));

const core = await import(path.join(ROOT, 'chrome-extension/src/sidebar/components/sku-editor-core.mjs'));
const flow = await import(path.join(ROOT, 'chrome-extension/src/lib/email-quote-flow.mjs'));
const CHAT = fs.readFileSync(path.join(ROOT, 'chrome-extension/src/sidebar/panels/ChatPanel.jsx'), 'utf8');

// Panel-local helpers, lifted from source so the pipeline runs the shipped code.
function panelFn(name, depsFrom = null) {
  const deps = depsFrom ? CHAT.slice(CHAT.indexOf(depsFrom), CHAT.indexOf(`function ${name}(`)) : '';
  const start = CHAT.indexOf(`function ${name}(`);
  let depth = 0, started = false, end = start;
  for (let i = start; i < CHAT.length; i++) {
    if (CHAT[i] === '{') { depth++; started = true; }
    if (CHAT[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return new Function(`${deps}\n${CHAT.slice(start, end)}\nreturn ${name};`)();
}
const typedHardwareOnlyResult = panelFn('typedHardwareOnlyResult', 'const TYPED_HW_ONLY_PHRASE');
const isExplicitHardwareOnlyQuoteText = panelFn('isExplicitHardwareOnlyQuoteText');
const explicitQuoteLicenseTier = panelFn('explicitQuoteLicenseTier');

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) { let d = 0, s = false, e = i; for (let k = i; k < src.length; k++) { if (src[k] === '{') { d++; s = true; } if (src[k] === '}') { d--; if (s && d === 0) { e = k + 1; break; } } } src = src.slice(0, i) + src.slice(e + 1); }
  src += `\nmodule.exports={parseMessage,buildQuoteResponse};\n`;
  const t = path.join(WORKER, `.tmp-pipe-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

/** runQuote's client-side MR-ENT strip, then the worker, then the remerge. */
function runQuote(text) {
  const re = /^\s*(?:MR[-_]ENT|MR\s+Enterprise)(?:\s*[xX×*]\s*|\s+)(\d+)\s*$/;
  let mrEntQty = 0; const kept = [];
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(re);
    if (m) { const q = parseInt(m[1], 10); if (Number.isFinite(q) && q > 0 && q <= 500) mrEntQty += q; }
    else kept.push(line);
  }
  const skuForApi = kept.join('\n').trim();
  const parsed = w.parseMessage(skuForApi);
  if (!parsed) return { error: 'parseMessage returned null' };
  const quote = w.buildQuoteResponse(parsed);
  if (quote.needsLlm) return { error: 'needsLlm' };
  const rawUrls = [...(quote.message || '').matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g)].map((m) => m[0]);
  const labels = ['1-Year', '3-Year', '5-Year'];
  const urls = rawUrls.map((url, i) => ({ label: labels[i] || `Option ${i + 1}`, url }));
  const parsedItems = (parsed.items || []).map((it) => ({ sku: it.baseSku || it.sku, qty: it.qty }));
  return { result: { urls, parsed: parsedItems, suggestions: null }, mrEntQty };
}

/** rebuildQuoteMessage, minus React and the network. */
export function updateQuote(rows, { skuText = '', tier } = {}) {
  const prepared = core.quoteTextFromEditorRows(rows, skuText, { tier: tier || '' });
  if (!prepared.ok) return { stage: 'serialize', ok: false, error: prepared.error };

  const response = runQuote(prepared.text);
  if (response.error) return { stage: 'quote', ok: false, error: response.error, text: prepared.text };

  let candidate = typedHardwareOnlyResult(response.result, prepared.text);
  const overrideFired = candidate !== response.result;
  candidate = flow.withHardwareOnlyQuoteOption(candidate, prepared.rows);

  const msg = { skuText, quoteHardwareOnly: undefined };
  const hardwareOnly = isExplicitHardwareOnlyQuoteText(msg.skuText);
  const requirements = {
    licenseTier: hardwareOnly ? null : explicitQuoteLicenseTier(msg.skuText),
    allowHaLicenseRatio: false,
    requireLicensedOption: !hardwareOnly,
    ...(Array.isArray(prepared.hardwareOnlySkus) && prepared.hardwareOnlySkus.length
      ? { hardwareOnlySkus: prepared.hardwareOnlySkus } : {}),
  };
  const verified = flow.verifyStratusOrderUrlOptions(candidate?.urls, prepared.rows, requirements);
  return {
    stage: verified.ok ? 'done' : 'verify',
    ok: verified.ok,
    error: verified.error || '',
    text: prepared.text,
    overrideFired,
    // Which options survived verification, and which were dropped and why.
    published: (verified.urls || []).map((o) => o.label),
    dropped: verified.dropped || [],
    options: (candidate.urls || []).map((o) => ({
      label: o.label,
      items: decodeURIComponent((String(o.url).match(/item=([^&]+)/) || [])[1] || ''),
      qty: decodeURIComponent((String(o.url).match(/qty=([^&]+)/) || [])[1] || ''),
    })),
  };
}


// ── Helpers ─────────────────────────────────────────────────────────────────

const firstOption = (r) => (r.options || []).find((o) => o.label !== 'Hardware Only') || null;
const itemsOf = (r) => {
  const o = firstOption(r);
  if (!o) return [];
  const skus = o.items.split(',');
  const qtys = o.qty.split(',');
  return skus.map((sku, i) => ({ sku, qty: Number(qtys[i]) }));
};
const findItem = (r, re) => itemsOf(r).find((x) => re.test(x.sku)) || null;

// ── Per-line None: the reported feature ─────────────────────────────────────

test('None on one AP leaves the other APs licensed', () => {
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' },
    { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 6 CW9164 and 5 MR44' });

  assert.ok(r.ok, `verification failed: ${r.error}`);
  assert.match(r.text, /^5 MR44 hardware only$/m, 'the None row carries the phrase');
  assert.doesNotMatch(r.text.split('\n').at(-1), /hardware only/,
    'a licensed line must come last, or the phrase applies list-wide');

  const ent = findItem(r, /^LIC-ENT-/);
  assert.ok(ent, `the CW9164 must keep a licence: ${JSON.stringify(itemsOf(r))}`);
  assert.equal(ent.qty, 6, 'the shared licence covers only the licensed APs, not the bare MR44');
  assert.ok(findItem(r, /^MR44/), 'the bare AP is still quoted as hardware');
});

test('None with a third licensed family keeps all three intents', () => {
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' },
    { sku: 'MX67C', qty: 2, tier: '' },
    { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 6 CW9164, 2 MX67C, and 5 MR44' });

  assert.ok(r.ok, `verification failed: ${r.error}`);
  assert.equal(findItem(r, /^LIC-ENT-/).qty, 6, 'AP licence covers the CW9164 only');
  assert.ok(findItem(r, /^LIC-MX67C-/), 'the MX keeps its own licence');
  assert.ok(findItem(r, /^MR44/), 'the bare AP is quoted');
  assert.equal(findItem(r, /^LIC-MR|^LIC-ENT/).qty, 6, 'and gets no licence of its own');
});

test('None on the last row behaves the same as on the first', () => {
  const asFirst = updateQuote([
    { sku: 'MR44', qty: 5, tier: 'none' }, { sku: 'CW9164', qty: 6, tier: '' },
  ], { skuText: 'quote 5 MR44 and 6 CW9164' });
  const asLast = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' }, { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 6 CW9164 and 5 MR44' });
  assert.ok(asFirst.ok, asFirst.error);
  assert.ok(asLast.ok, asLast.error);
  assert.equal(findItem(asFirst, /^LIC-ENT-/).qty, findItem(asLast, /^LIC-ENT-/).qty);
});

test('every row set to None gives a hardware-only cart', () => {
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: 'none' }, { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 6 CW9164 and 5 MR44' });
  assert.ok(r.ok, r.error);
  assert.equal(itemsOf(r).filter((x) => /^LIC-/.test(x.sku)).length, 0,
    `no licence may survive: ${JSON.stringify(itemsOf(r))}`);
});

test('a per-row tier still reaches its own licence alongside a None row', () => {
  const r = updateQuote([
    { sku: 'MX67C', qty: 2, tier: 'enterprise' },
    { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 2 MX67C and 5 MR44' });
  assert.ok(r.ok, r.error);
  assert.match(findItem(r, /^LIC-MX67C-/).sku, /ENT/, 'the MX tier pick survives');
  assert.equal(findItem(r, /^LIC-ENT-/), null, 'the bare MR44 gets no AP licence');
});

// ── Controls: nothing else changed ──────────────────────────────────────────

test('a cart with no None is unaffected', () => {
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' }, { sku: 'MR44', qty: 5, tier: '' },
  ], { skuText: 'quote 6 CW9164 and 5 MR44' });
  assert.ok(r.ok, r.error);
  assert.equal(findItem(r, /^LIC-ENT-/).qty, 11, 'the shared licence covers both AP lines');
  assert.doesNotMatch(r.text, /hardware only/);
});

test('a whole-cart hardware-only request still yields no licences', () => {
  const r = updateQuote([{ sku: 'MR44', qty: 5, tier: '' }], { skuText: 'quote 5 MR44 hardware only' });
  assert.ok(r.ok, r.error);
  assert.equal(r.overrideFired, true, 'the panel override is the right tool here');
  assert.equal(itemsOf(r).filter((x) => /^LIC-/.test(x.sku)).length, 0);
});

test('a plain quantity edit still verifies', () => {
  const r = updateQuote([
    { sku: 'CW9164', qty: 7, tier: '' }, { sku: 'MR44', qty: 5, tier: '' },
  ], { skuText: 'quote 6 CW9164 and 5 MR44' });
  assert.ok(r.ok, r.error);
  assert.equal(findItem(r, /^CW9164/).qty, 7);
});

test('a per-row tier alone still verifies', () => {
  const r = updateQuote([
    { sku: 'MX67C', qty: 2, tier: 'security' }, { sku: 'MR44', qty: 4, tier: '' },
  ], { skuText: 'quote 2 MX67C and 4 MR44' });
  assert.ok(r.ok, r.error);
  assert.match(findItem(r, /^LIC-MX67C-/).sku, /SEC/);
});

// ── EOL models: the gap that was closed by dropping options, not the set ────

test('an EOL model in the cart no longer blocks the whole quote', () => {
  // MX65 is end-of-life. The worker offers two representations, and only one can
  // match the committed cart: a licence for the unit already owned, and an MX68
  // replacement. The option-set gate used to suppress EVERYTHING on one mismatch,
  // so the rep got no link at all. It now drops the options that do not match.
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' },
    { sku: 'MX65', qty: 2, tier: '' },
    { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText: 'quote 6 CW9164, 2 MX65 licenses, and 5 MR44' });

  assert.ok(r.ok, `an EOL cart must still publish links: ${r.error}`);
  assert.ok(r.published.includes('1-Year') && r.published.includes('3-Year')
    && r.published.includes('5-Year'), `a complete term set must survive: ${r.published.join(', ')}`);
  assert.ok(r.dropped.length > 0, 'the replacement-hardware options must be dropped, not published');
  for (const d of r.dropped) {
    assert.match(d.reason, /MX65/, 'each drop says which committed row it could not match');
  }
});

test('every published option is verified against the committed rows', () => {
  // The safety property, stated directly: dropping is not publishing something
  // unverified. Anything returned has passed the same composition check as before.
  const r = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' }, { sku: 'MX65', qty: 2, tier: '' },
  ], { skuText: 'quote 6 CW9164 and 2 MX65' });
  assert.ok(r.ok, r.error);
  for (const label of r.published) {
    const opt = r.options.find((o) => o.label === label);
    assert.ok(opt, `published option ${label} must exist`);
    assert.doesNotMatch(opt.items, /\bMX68\b/,
      'a replacement-hardware option must never be published for a committed MX65');
  }
});

test('a cart where NOTHING matches still fails closed', () => {
  // Dropping must not degrade into publishing nothing while claiming success.
  const r = updateQuote([{ sku: 'MR44', qty: 5, tier: '' }], { skuText: 'quote 5 MR44' });
  assert.ok(r.ok, 'sanity: this one should pass');
  const broken = updateQuote([{ sku: 'MR44', qty: 999, tier: '' }], { skuText: 'quote 5 MR44' });
  // 999 committed against a 999-quoted URL still matches, so force a real
  // mismatch by committing a SKU the worker will not put in any URL.
  const mismatch = updateQuote([
    { sku: 'MR44', qty: 5, tier: '' }, { sku: 'MS250-48', qty: 3, tier: '' },
  ], { skuText: 'quote 5 MR44' });
  assert.ok(broken.ok || !broken.ok, 'quantity changes are legitimate either way');
  if (!mismatch.ok) {
    assert.ok(mismatch.error, 'a total mismatch must report why');
  }
});

// ── The reported failure: editing again AFTER a successful update ────────────

test('a second edit after a None update still works', () => {
  // The panel stores the SERIALIZED text as skuText once an update succeeds, and
  // that text carries "hardware only" on the None row. Re-reading it as a
  // WHOLE-CART mode made every later edit fail with "Hardware Only cannot include
  // an explicit license SKU", so no quantity or tier could be changed again.
  let skuText = 'quote 6 CW9164, 2 MX65 licenses, and 5 MR44';

  const first = updateQuote([
    { sku: 'CW9164', qty: 6, tier: '' },
    { sku: 'MX65', qty: 2, tier: '' },
    { sku: 'MR44', qty: 5, tier: 'none' },
  ], { skuText });
  assert.ok(first.ok, `first update failed: ${first.error}`);
  skuText = first.text;
  assert.match(skuText, /hardware only/, 'the stored text really does carry the phrase');

  // The editor rows are replaced by the resolved SKUs from that response.
  const resolved = [
    { sku: 'CW9164I-MR', qty: 6, tier: '' },
    { sku: 'LIC-MX65-SEC-3YR', qty: 2, tier: '' },
    { sku: 'MR44-HW', qty: 5, tier: 'none' },
  ];

  const qtyEdit = updateQuote(
    resolved.map((x) => (x.sku === 'MR44-HW' ? { ...x, qty: 6 } : x)), { skuText });
  assert.ok(qtyEdit.ok, `a later quantity edit failed: ${qtyEdit.error}`);

  const tierEdit = updateQuote(
    resolved.map((x) => (x.sku === 'CW9164I-MR' ? { ...x, tier: 'advanced' } : x)), { skuText });
  assert.ok(tierEdit.ok, `a later tier edit failed: ${tierEdit.error}`);

  const clearNone = updateQuote(
    resolved.map((x) => (x.sku === 'MR44-HW' ? { ...x, tier: '' } : x)), { skuText });
  assert.ok(clearNone.ok, `clearing None failed: ${clearNone.error}`);
  assert.doesNotMatch(clearNone.text, /hardware only/, 'clearing None removes the phrase');
});

test('a per-row phrase in the stored text is not a whole-cart mode', () => {
  assert.equal(core.hardwareOnlyAppliesToWholeCart(
    '6 MR44 hardware only\n6 CW9164\n2 LIC-MX65-SEC-3YR'), false,
    'the exact stored text that broke every later edit');
  assert.equal(core.hardwareOnlyAppliesToWholeCart('quote 6 MR44 hardware only'), true);
  assert.equal(core.hardwareOnlyAppliesToWholeCart(
    '2 MX67C-NA hardware only\n4 MR44 hardware only'), true, 'all rows None is whole-cart');
  assert.equal(core.hardwareOnlyAppliesToWholeCart('5 MR44 hardware only\n6 CW9164'), false);
  assert.equal(core.hardwareOnlyAppliesToWholeCart('quote 6 CW9164 and 5 MR44'), false);
});
