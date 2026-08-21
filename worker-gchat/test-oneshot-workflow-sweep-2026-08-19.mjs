// FULL one-shot workflow sweep, as a permanent test.
//
// WHY THIS EXISTS. The browser QA harness mocks the worker, so it never executed
// natural-language parsing, quote-option composition, the one-shot payload, or
// the product plan. Every bug found in live testing on 2026-08-19 lived in one of
// those stages: a shift-by-one quantity parse, a missing Hardware Only option, a
// shared licence that blocked the plan, and a trailing "hardware only" that
// reached only the last item. Confirming individual fixes could not have found
// any of them; only running the whole chain does.
//
// WHAT IT DOES. Request text is GENERATED from a structured cart spec, so the
// expected quantities are known by construction instead of hand-written. Each
// generated request is driven through the real chain and checked against stage
// invariants:
//
//   text -> parseMessage -> buildQuoteResponse -> option set
//        -> option selection -> one-shot payload -> product expansion
//
// Stage 1  quantities and models survive the parse, nothing is invented
// Stage 2  option set is complete, terms are consistent, Hardware Only offered
// Stage 3  the payload the sidebar builds from an option is self-consistent
// Stage 4  an option the engine produced is always plannable, and the signed
//          plan preserves hardware, avoids duplicates and covers its licences
// Stage 5  composition and term modifiers reach every item they should
//
// Adding a cart or a phrasing here multiplies coverage across every stage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WORKER = path.join(ROOT, 'worker-gchat');
const require = createRequire(import.meta.url);

const flow = await import(path.join(ROOT, 'chrome-extension/src/lib/email-quote-flow.mjs'));
const core = await import(path.join(ROOT, 'chrome-extension/src/sidebar/components/sku-editor-core.mjs'));

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) { let d = 0, s = false, e = i; for (let k = i; k < src.length; k++) { if (src[k] === '{') { d++; s = true; } if (src[k] === '}') { d--; if (s && d === 0) { e = k + 1; break; } } } src = src.slice(0, i) + src.slice(e + 1); }
  src += `\nmodule.exports={parseMessage,buildQuoteResponse,expandOneshotRequestedProducts};\n`;
  const t = path.join(os.tmpdir(), `stratus-oneshot-sweep-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

// ── Findings ────────────────────────────────────────────────────────────────
const findings = [];
const known = [];
function fail(stage, invariant, detail, ctx) {
  findings.push({ stage, invariant, detail, ...ctx });
}

// ── Cart specs. Quantities are the ground truth. ────────────────────────────
// Model tokens are compared, not exact catalog SKUs, because a legitimate
// resolution (MR44 -> MR44-HW, MX67C -> MX67C-NA) must not read as a failure.
const CARTS = [
  { id: 'ap-single',      items: [['MR44', 3]] },
  { id: 'ap-pair',        items: [['MR44', 4], ['MR46', 2]] },
  { id: 'ap-cw',          items: [['CW9166I', 5]] },
  { id: 'ap-two-family',  items: [['CW9176', 3], ['MR44', 4]] },
  { id: 'fw-single',      items: [['MX67C', 2]] },
  { id: 'fw-ap',          items: [['MX67C', 2], ['MR44', 4]] },
  { id: 'sw-meraki',      items: [['MS130-24', 2]] },
  { id: 'sw-variants',    items: [['MS130-24', 2], ['MS130-48', 3]] },
  { id: 'sw-catalyst',    items: [['C9200L-24P-4G-M', 1]] },
  { id: 'sw-mixed',       items: [['C9200L-24P-4G-M', 1], ['MS150-48LP-4G', 2]] },
  { id: 'three-family',   items: [['CW9176', 3], ['MR44', 4], ['MX67C', 2]] },
  { id: 'full-house',     items: [['MX67C', 2], ['MS130-24', 4], ['MR44', 6]] },
  { id: 'big-qty',        items: [['MR44', 48], ['MX67C', 2]] },
  { id: 'qty-one',        items: [['MR44', 1], ['MX67C', 1]] },
  // 2026-08-19, from live testing: a bare CW stem, a Z appliance, four families.
  { id: 'cw-stem-cart',   items: [['MR44', 3], ['CW9164', 5], ['MX67C', 1], ['Z4', 2]] },
  { id: 'cw-stem-only',   items: [['CW9164', 5]] },
  { id: 'z-appliance',    items: [['Z4', 2]] },
  { id: 'cw-variant',     items: [['CW9164I', 5]] },
];

// ── Phrasing templates. Each must yield the same parse. ─────────────────────
const TEMPLATES = [
  { id: 'n-x-space',  render: (it) => 'quote ' + it.map(([s, q]) => `${q} x ${s}`).join(' ') },
  { id: 'n-x-tight',  render: (it) => 'quote ' + it.map(([s, q]) => `${q}x ${s}`).join(' ') },
  { id: 'bare',       render: (it) => 'quote ' + it.map(([s, q]) => `${q} ${s}`).join(' ') },
  { id: 'commas',     render: (it) => 'quote ' + it.map(([s, q]) => `${q} ${s}`).join(', ') },
  { id: 'and',        render: (it) => 'quote ' + it.map(([s, q]) => `${q} ${s}`).join(' and ') },
  { id: 'comma-and',  render: (it) => {
      const parts = it.map(([s, q]) => `${q} ${s}`);
      return 'quote ' + (parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts.at(-1) : parts[0]);
    } },
  { id: 'trailing',   render: (it) => 'quote ' + it.map(([s, q]) => `${s} x${q}`).join(' ') },
  { id: 'newlines',   render: (it) => it.map(([s, q]) => `${q} ${s}`).join('\n') },
  { id: 'prose',      render: (it) => 'can you get me pricing on ' + it.map(([s, q]) => `${q} ${s}`).join(' and ') },
  // Plurals. "quote 2 Z4s" produced no URL because the Z extraction pattern was
  // /Z\d+[A-Z]*/ and swallowed the plural S into a bogus Z4S, which then failed
  // isValidSkuToken. Every family must strip a trailing plural S identically, so
  // this runs the plural of every cart through the whole chain.
  { id: 'plural',     render: (it) => 'quote ' + it.map(([s, q]) => `${q} ${s}s`).join(' and ') },
];

const token = (sku) => core.skuModelToken(sku);
/** token + port variant, so MS130-24 and MS130-48 are distinct keys. */
const identity = (sku) => `${core.skuModelToken(sku)}:${core.skuVariantDigits(sku)}`;
const isLic = (sku) => /^LIC-/i.test(String(sku || ''));

/** Model-token -> qty map for the hardware the user asked for. */
function expectedHardware(items) {
  const map = new Map();
  for (const [sku, qty] of items) map.set(identity(sku), qty);
  return map;
}

function urlItems(url) {
  const item = (String(url).match(/[?&]item=([^&]+)/) || [])[1];
  const qty = (String(url).match(/[?&]qty=([^&]+)/) || [])[1];
  if (!item || !qty) return [];
  const skus = decodeURIComponent(item).split(',');
  const qtys = decodeURIComponent(qty).split(',');
  return skus.map((sku, i) => ({ sku: sku.trim().toUpperCase(), qty: Number(qtys[i]) }));
}

/** The option set as mapQuoteResponse would hand it to the sidebar. */
function optionSet(quoteMessage) {
  const urls = [...String(quoteMessage || '').matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g)].map((m) => m[0]);
  const labels = ['1-Year', '3-Year', '5-Year'];
  return urls.map((url, i) => ({ url, label: labels[i] || `Option ${i + 1}`, items: urlItems(url) }));
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1 + 2: parse and option composition
// ─────────────────────────────────────────────────────────────────────────────
let parseCases = 0;
for (const cart of CARTS) {
  for (const tpl of TEMPLATES) {
    const text = tpl.render(cart.items);
    const ctx = { cart: cart.id, template: tpl.id, text };
    parseCases++;

    const parsed = w.parseMessage(text);
    if (!parsed) { fail(1, 'parses deterministically', 'parseMessage returned null', ctx); continue; }

    const items = (parsed.items || []).map((i) => ({ sku: String(i.baseSku || i.sku || '').toUpperCase(), qty: Number(i.qty) }));
    if (!items.length) { fail(1, 'parses deterministically', 'no items parsed', ctx); continue; }

    const want = expectedHardware(cart.items);
    const got = new Map();
    for (const it of items) {
      if (isLic(it.sku)) continue;
      got.set(identity(it.sku), (got.get(identity(it.sku)) || 0) + it.qty);
    }

    // I1: every requested model is present at the requested quantity.
    for (const [model, qty] of want) {
      if (!got.has(model)) fail(1, 'no model is dropped', `${model} missing (got ${[...got.keys()].join(', ') || 'nothing'})`, ctx);
      else if (got.get(model) !== qty) fail(1, 'quantity is preserved', `${model} qty ${got.get(model)}, asked for ${qty}`, ctx);
    }
    // I2: nothing was invented.
    for (const model of got.keys()) {
      if (!want.has(model)) fail(1, 'no model is invented', `${model} was never requested`, ctx);
    }

    const quote = w.buildQuoteResponse(parsed);
    if (quote.needsLlm) { fail(2, 'stays deterministic', 'buildQuoteResponse asked for the LLM', ctx); continue; }
    const options = optionSet(quote.message);
    if (!options.length) { fail(2, 'produces at least one option', 'no order URL in the response', ctx); continue; }

    // I3: hardware is identical across every term option.
    const hwSig = (o) => o.items.filter((x) => !isLic(x.sku)).map((x) => `${x.qty}x${x.sku}`).join('|');
    const sigs = new Set(options.map(hwSig));
    if (sigs.size > 1) {
      fail(2, 'hardware identical across term options', `options differ: ${[...sigs].join('   vs   ')}`, ctx);
    }

    // I4: each option's licences carry that option's term.
    for (const opt of options) {
      const term = flow.quoteOptionTerm(opt);
      if (!term) { fail(2, 'every option has a readable term', `label ${JSON.stringify(opt.label)} has no term`, ctx); continue; }
      for (const line of opt.items.filter((x) => isLic(x.sku))) {
        const licTerm = (line.sku.match(/-([135])YR?$/) || [])[1];
        if (licTerm && licTerm !== String(term)) {
          fail(2, 'licence term matches its option', `${opt.label} contains ${line.sku}`, ctx);
        }
      }
    }

    // I5: quantities are usable integers.
    for (const opt of options) {
      for (const line of opt.items) {
        if (!Number.isInteger(line.qty) || line.qty < 1 || line.qty > 99999) {
          fail(2, 'quantities are valid integers', `${opt.label} ${line.sku} qty ${line.qty}`, ctx);
        }
      }
    }

    // I6: hardware quantities in the URL match what was asked for.
    for (const line of options[0].items.filter((x) => !isLic(x.sku))) {
      const model = identity(line.sku);
      if (want.has(model) && want.get(model) !== line.qty) {
        fail(2, 'URL hardware quantity matches the request', `${line.sku} qty ${line.qty}, asked for ${want.get(model)}`, ctx);
      }
    }

    // I6b: the committed rows the EDITOR holds must verify against the options
    // the panel is about to publish. This is the gate that blocked every quote
    // update when a bare "CW9164" row met a "CW9164I-MR" URL (2026-08-19). The
    // sweep did not previously run the verifier at all, which is how it shipped.
    const editorRows = (parsed.items || [])
      .map((i) => ({ sku: String(i.baseSku || i.sku).toUpperCase(), qty: Number(i.qty) }))
      .filter((r) => r.sku && Number.isInteger(r.qty) && r.qty > 0);
    if (editorRows.length) {
      const verified = flow.verifyStratusOrderUrlOptions(options, editorRows, { requireLicensedOption: true });
      if (!verified.ok) {
        fail(2, 'the committed editor rows verify against the published options',
          verified.error || '(no message)', ctx);
      }
    }

    // I7: an all-hardware committed cart must be offered Hardware Only.
    const committed = (parsed.items || [])
      .filter((i) => !isLic(String(i.baseSku || i.sku)))
      .map((i) => ({ sku: String(i.baseSku || i.sku).toUpperCase(), qty: Number(i.qty) }));
    const withHwOnly = flow.withHardwareOnlyQuoteOption({ urls: options }, committed);
    const hasHwOnly = (withHwOnly.urls || []).some((o) => o?.hardwareOnly === true);
    if (committed.length && !hasHwOnly) {
      fail(2, 'all-hardware cart offers Hardware Only', 'no Hardware Only option was produced', ctx);
    }

    // ─────────────────────────────────────────────────────────────────────
    // STAGE 3 + 4: option selection -> one-shot payload -> expansion
    // ─────────────────────────────────────────────────────────────────────
    for (const opt of [...options, ...(hasHwOnly ? [(withHwOnly.urls || []).find((o) => o.hardwareOnly)] : [])]) {
      const hardwareOnly = opt.hardwareOnly === true;
      const termYears = hardwareOnly ? null : flow.quoteOptionTerm(opt);
      const skus = urlItems(opt.url);
      const octx = { ...ctx, option: opt.label };

      // I8: the payload the sidebar builds is self-consistent.
      const ha = flow.oneshotHaStateForQuoteOption({ haAvailable: false, hardwareOnly });
      const payload = {
        skus,
        license_term: termYears ? String(termYears) : null,
        hardware_only: hardwareOnly,
        include_licenses: !hardwareOnly,
        ...ha,
      };
      if (hardwareOnly && payload.include_licenses !== false) {
        fail(3, 'hardware-only payload excludes licences', 'include_licenses was not false', octx);
      }
      if (!hardwareOnly && !payload.license_term) {
        fail(3, 'a termed option carries its term', 'license_term is null on a termed option', octx);
      }
      if (!skus.length) { fail(3, 'the option yields quoteable SKUs', 'no SKUs parsed from the option URL', octx); continue; }

      // I9: an option the engine itself produced MUST be plannable.
      const expanded = w.expandOneshotRequestedProducts({
        ...payload,
        ha_mode: flow.normalizeHaMode(payload.ha_mode) || 'standard',
      });
      if (expanded.success !== true) {
        const codes = [...new Set((expanded.blockers || []).map((b) => b?.code))].join(', ');
        fail(4, 'the engine\'s own option is plannable', `blocked by ${codes || '(no code)'}`, octx);
        // I13: a refusal must always say why.
        if (!(expanded.blockers || []).length) {
          fail(4, 'a refusal names a blocker', 'expansion failed with no blocker code', octx);
        }
        continue;
      }

      const lines = (expanded.lines || []).map((l) => ({ sku: String(l.sku).toUpperCase(), qty: Number(l.qty) }));

      // I10: hardware survives the expansion at the same quantity.
      for (const line of skus.filter((x) => !isLic(x.sku))) {
        const match = lines.find((l) => !isLic(l.sku) && token(l.sku) === token(line.sku)
          && core.skuVariantDigits(l.sku) === core.skuVariantDigits(line.sku));
        if (!match) fail(4, 'hardware survives expansion', `${line.sku} missing from the expanded plan`, octx);
        else if (match.qty !== line.qty) fail(4, 'hardware quantity survives expansion', `${line.sku} ${line.qty} -> ${match.qty}`, octx);
      }

      // I11: no duplicate SKU rows in a signed plan.
      const seen = new Set();
      for (const line of lines) {
        if (seen.has(line.sku)) fail(4, 'no duplicate line in the plan', `${line.sku} appears twice`, octx);
        seen.add(line.sku);
      }

      // I12: hardware-only expansion has no licences.
      if (hardwareOnly && lines.some((l) => isLic(l.sku))) {
        fail(4, 'hardware-only plan has no licences', lines.filter((l) => isLic(l.sku)).map((l) => l.sku).join(', '), octx);
      }

      // I14: licence totals cover the hardware they belong to.
      if (!hardwareOnly) {
        for (const lic of lines.filter((l) => isLic(l.sku))) {
          const covered = lines.filter((l) => !isLic(l.sku) && core.sameDeviceIdentity(lic.sku, l.sku));
          if (covered.length) {
            const total = covered.reduce((n, l) => n + l.qty, 0);
            if (lic.qty !== total) {
              fail(4, 'licence quantity covers its hardware', `${lic.sku} qty ${lic.qty}, hardware total ${total}`, octx);
            }
          }
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 5: modifier phrasings that change the shape of the request
// ─────────────────────────────────────────────────────────────────────────────
const MODIFIERS = [
  { id: 'hardware-only', suffix: ' hardware only', expect: 'no-licences' },
  { id: 'no-licenses', suffix: ' no licenses', expect: 'no-licences' },
  { id: 'license-only', suffix: ' license only', expect: 'licences-only' },
  { id: 'tier-sec', suffix: ' security', expect: 'tier:SEC' },
  { id: 'tier-ent', suffix: ' enterprise', expect: 'tier:ENT' },
  { id: 'term-3', suffix: ' 3 year', expect: 'term:3' },
  { id: 'term-5', suffix: ' 5 year', expect: 'term:5' },
];
for (const cart of [CARTS[4], CARTS[5], CARTS[0]]) {   // fw-single, fw-ap, ap-single
  for (const mod of MODIFIERS) {
    const text = 'quote ' + cart.items.map(([s, q]) => `${q} ${s}`).join(' and ') + mod.suffix;
    const ctx = { cart: cart.id, template: `mod:${mod.id}`, text };
    const parsed = w.parseMessage(text);
    if (!parsed) { fail(5, 'a modifier phrasing still parses', 'parseMessage returned null', ctx); continue; }

    // The modifier must not corrupt the quantities.
    const want = expectedHardware(cart.items);
    for (const it of (parsed.items || [])) {
      const sku = String(it.baseSku || it.sku).toUpperCase();
      if (isLic(sku)) continue;
      const model = identity(sku);
      if (want.has(model) && want.get(model) !== Number(it.qty)) {
        fail(5, 'a modifier does not change quantities', `${model} qty ${it.qty}, asked for ${want.get(model)}`, ctx);
      }
    }

    const quote = w.buildQuoteResponse(parsed);
    if (quote.needsLlm) continue;   // advisory phrasings may hand off deliberately
    const options = optionSet(quote.message);
    if (!options.length) continue;
    const first = options[0].items;
    if (mod.expect === 'no-licences' && first.some((x) => isLic(x.sku))) {
      fail(5, 'hardware-only wording yields no licences', first.filter((x) => isLic(x.sku)).map((x) => x.sku).join(', '), ctx);
    }
    if (mod.expect === 'licences-only' && first.some((x) => !isLic(x.sku))) {
      fail(5, 'licence-only wording yields no hardware', first.filter((x) => !isLic(x.sku)).map((x) => x.sku).join(', '), ctx);
    }
    if (mod.expect.startsWith('tier:')) {
      const code = mod.expect.slice(5);
      const mxLic = first.filter((x) => /^LIC-MX/.test(x.sku));
      // A tier word binds to the clause it sits in. In a multi-item cart a
      // TRAILING tier word therefore reaches only the adjacent item, which is
      // documented behaviour, not a defect: forcing ENT onto an MX would
      // downgrade it from its Advanced Security default, and the reading of
      // "2 MX67C and 4 MR44 enterprise" is genuinely ambiguous. Assert the
      // unambiguous form instead, and record the gap separately.
      const tierIsInItsOwnClause = cart.items.length === 1;
      if (tierIsInItsOwnClause && mxLic.length && !mxLic.some((x) => x.sku.includes(code))) {
        fail(5, 'a tier word reaches the licence', `asked ${code}, got ${mxLic.map((x) => x.sku).join(', ')}`, ctx);
      }
      if (!tierIsInItsOwnClause && mxLic.length && !mxLic.some((x) => x.sku.includes(code))) {
        known.push(`trailing "${mod.suffix.trim()}" did not reach ${mxLic.map((x) => x.sku).join(', ')} in cart ${cart.id}`);
      }
      // The unambiguous per-clause form must always work.
      const perClause = 'quote ' + cart.items.map(([sku, q], i) => `${q} ${sku}${i === 0 ? mod.suffix : ''}`).join(' and ');
      const pc = w.parseMessage(perClause);
      if (pc && !w.buildQuoteResponse(pc).needsLlm) {
        const pcItems = optionSet(w.buildQuoteResponse(pc).message)[0]?.items || [];
        const pcMx = pcItems.filter((x) => /^LIC-MX/.test(x.sku));
        if (pcMx.length && !pcMx.some((x) => x.sku.includes(code))) {
          fail(5, 'a tier word in the item\'s own clause reaches its licence',
            `asked ${code}, got ${pcMx.map((x) => x.sku).join(', ')}`, { ...ctx, text: perClause });
        }
      }
    }
    if (mod.expect.startsWith('term:')) {
      const years = mod.expect.slice(5);
      const licences = first.filter((x) => isLic(x.sku));
      if (licences.length && !licences.every((x) => new RegExp(`-${years}YR?$`).test(x.sku))) {
        fail(5, 'an explicit term is honoured', `asked ${years}-year, got ${licences.map((x) => x.sku).join(', ')}`, ctx);
      }
    }
  }
}

// ── Assertions ──────────────────────────────────────────────────────────────

test('the whole one-shot workflow holds every stage invariant', () => {
  if (findings.length) {
    const byInvariant = new Map();
    for (const f of findings) {
      const key = `S${f.stage} ${f.invariant}`;
      if (!byInvariant.has(key)) byInvariant.set(key, []);
      byInvariant.get(key).push(f);
    }
    const lines = [];
    for (const [key, list] of [...byInvariant.entries()].sort()) {
      lines.push(`${key}  (${list.length} case${list.length > 1 ? 's' : ''})`);
      for (const f of list.slice(0, 4)) {
        lines.push(`    [${f.cart} / ${f.template}${f.option ? ' / ' + f.option : ''}] ${f.detail}`);
        lines.push(`       text: ${JSON.stringify(f.text)}`);
      }
      if (list.length > 4) lines.push(`    ... and ${list.length - 4} more`);
    }
    assert.fail(`${findings.length} workflow finding(s) across ${byInvariant.size} invariant(s):\n${lines.join('\n')}`);
  }
});

test('the sweep actually covered a meaningful matrix', () => {
  // Guards against a refactor that silently stops generating cases: a green run
  // over zero cases would otherwise look like success.
  assert.ok(parseCases >= 100, `only ${parseCases} parse cases ran`);
  assert.ok(CARTS.length >= 12 && TEMPLATES.length >= 8,
    `matrix shrank to ${CARTS.length} carts x ${TEMPLATES.length} phrasings`);
});

test('known behaviour gaps are recorded, not silently passing', () => {
  // A trailing tier word binds to its own clause, so in a multi-item cart it
  // reaches only the adjacent item. Documented rather than asserted, because
  // forcing the tier list-wide would change licence tiers and therefore pricing.
  // If this list empties, the behaviour changed and the note should be removed.
  assert.ok(known.length >= 1,
    'the trailing-tier gap disappeared; re-check whether it was fixed deliberately');
});
