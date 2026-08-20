/**
 * Stratus AI — QA harness.
 *
 * Mounts the REAL QuoteResult / SkuQuantityEditor and drives them with the REAL lib
 * functions (verifyStratusOrderUrlComposition, selectableQuoteTerms,
 * normalizeEditableQuoteLines). Nothing here reimplements product logic, so what
 * renders here is what ships.
 *
 * Covers: the quote card — term / Hardware-Only dropdown, SKU editor, the live
 * product autocomplete, update-quote verification, suggestion chips, stale-link
 * blocking, and the edit -> rebuild -> verify round trip.
 *
 * Does NOT cover: Gmail DOM scraping, chrome.storage persistence, the one-shot
 * Plan/Execute round trip, or any Zoho write.
 */

import { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QuoteResult from '../src/sidebar/components/QuoteResult';
import {
  verifyStratusOrderUrlComposition,
  normalizeEditableQuoteLines,
  selectableQuoteTerms,
  verifyStratusOrderUrlOptions,
} from '../src/lib/email-quote-flow.mjs';
import { resolveForTerm, buildQuoteOptions, PRODUCT_POOL, resolveRequoteText, QLE_QUOTE, applyQuoteLineOps, resolveEcommPrices, QLE_COST_QUOTE, resolveLineCosts, ZOHO_DISCOUNT_AT_10, previewCloneTerms, cloneQuoteTerms } from './mock-worker.mjs';
import SkuQuantityEditor from '../src/sidebar/components/SkuQuantityEditor';
import QuoteLineEditor from '../src/sidebar/components/QuoteLineEditor';
import {
  applyBulkDiscount,
  applyEcommPricing,
  applyMarginPricing,
  marginPctForRow,
  buildOpsPayload,
  diffAgainstOriginal,
  linesFromApi,
  markSelectedForDelete,
  moveRowToIndex,
  resequence,
  setRowDiscount,
  toggleRowSelected,
} from '../src/sidebar/components/quote-line-editor-core.mjs';
import {
  splitRowsForTierRequote,
  quoteTextFromEditorRows,
  skuModelToken,
  sameDeviceIdentity,
  termFromLicenseRows,
} from '../src/sidebar/components/sku-editor-core.mjs';

const orderUrl = (items) =>
  `https://stratusinfosystems.com/order/?item=${items.map((i) => i.sku).join(',')}&qty=${items.map((i) => i.qty).join(',')}`;

/**
 * The extension's edit -> rebuild -> verify round trip, as the sidebar performs it.
 * Returns { ok, urls, message } so both the UI and the matrix runner share one path.
 */
function rebuildAndVerify(rows, { term = 3, hardwareOnly = false } = {}) {
  const normalized = normalizeEditableQuoteLines(rows);
  if (!normalized.ok) return { ok: false, urls: [], message: normalized.error };

  const rebuilt = orderUrl(resolveForTerm(normalized.lines, term, { hardwareOnly }));
  // The sidebar publishes through the OPTION-SET gate (see ChatPanel's
  // rebuildQuoteMessage), not a standalone single-URL check — it is stricter,
  // additionally requiring every licence in an option to carry that option's term.
  // Verifying one URL against un-retermed committed lines would be a harness-only
  // path and would report failures the real extension never produces.
  const options = buildQuoteOptions(normalized.lines);
  const set = verifyStratusOrderUrlOptions(options, normalized.lines);
  if (!set.ok) {
    return { ok: false, urls: [], message: set.error, url: rebuilt };
  }
  return { ok: true, urls: set.urls, message: '', url: rebuilt };
}

const SCENARIOS = [
  {
    id: 'terms',
    name: 'Term dropdown + Hardware Only',
    covers: 'Bug 1 / 1b',
    rows: [{ sku: 'C9300-48P-M', qty: 1 }],
  },
  {
    id: 'mrPlusMx',
    name: '7 MR licences + 1 MX67C',
    covers: 'Bug 4 regression / Bug 6',
    rows: [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }],
  },
  {
    id: 'bareSku',
    name: 'Bare SKU edit (MX67C)',
    covers: 'Bug 6',
    rows: [{ sku: 'LIC-ENT', qty: 8 }, { sku: 'MX67C', qty: 1 }],
  },
  {
    id: 'mixedCart',
    name: 'Mixed hardware cart',
    covers: 'autocomplete + update',
    rows: [{ sku: 'MR44', qty: 1 }, { sku: 'MS130-24', qty: 2 }, { sku: 'CW9164I', qty: 5 }],
  },
];

// ── Automated matrix ────────────────────────────────────────────────────────
// Each case: a starting cart, an edit, and the expectation. Every case runs the
// real normalizer + real verifier against a realistically-resolved URL.
const MATRIX = [
  ['baseline: MR licences + MX67C', [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }], (r) => r, true],
  ['qty change on bare model', [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }], (r) => [r[0], { ...r[1], qty: 2 }], true],
  ['qty change on agnostic licence', [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }], (r) => [{ ...r[0], qty: 9 }, r[1]], true],
  ['autocomplete: MX67C -> MX67C-NA', [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }], (r) => [r[0], { ...r[1], sku: 'MX67C-NA' }], true],
  ['autocomplete: LIC-ENT -> LIC-ENT-3YR', [{ sku: 'LIC-ENT', qty: 7 }, { sku: 'MX67C', qty: 1 }], (r) => [{ ...r[0], sku: 'LIC-ENT-3YR' }, r[1]], true],
  ['autocomplete: LIC-ENT -> LIC-ENT-1YR', [{ sku: 'LIC-ENT', qty: 7 }], (r) => [{ ...r[0], sku: 'LIC-ENT-1YR' }], true],
  ['add a SKU', [{ sku: 'MR44', qty: 1 }], (r) => [...r, { sku: 'MS130-24', qty: 2 }], true],
  ['remove a SKU', [{ sku: 'MR44', qty: 1 }, { sku: 'MS130-24', qty: 2 }], (r) => [r[0]], true],
  ['hardware only cart', [{ sku: 'C9300-48P-M', qty: 1 }], (r) => r, true],
  ['regional model MX68CW', [{ sku: 'MX68CW', qty: 2 }], (r) => r, true],
  ['CW access point', [{ sku: 'CW9164I', qty: 5 }], (r) => r, true],
  ['CW9172H (RTG form)', [{ sku: 'CW9172H', qty: 3 }], (r) => r, true],
  ['zero qty rejected', [{ sku: 'MR44', qty: 1 }], (r) => [{ ...r[0], qty: 0 }], false],
  ['blank sku rejected', [{ sku: 'MR44', qty: 1 }], (r) => [{ ...r[0], sku: '' }], false],
  ['duplicate SKUs merge', [{ sku: 'MR44', qty: 1 }, { sku: 'MR44', qty: 2 }], (r) => r, true],
];

// Reproduces the reported failure directly: the editor commits an EXPLICIT term
// SKU while the rebuild resolves for a DIFFERENT selected term. The committed SKU
// then never appears in the URL and verification fails closed — which is exactly
// the "did not contain the committed quantity for LIC-ENT-1YR" message.
export function termConflictProbe() {
  const rows = [{ sku: 'LIC-ENT-1YR', qty: 7 }, { sku: 'MX67C', qty: 1 }];
  const out = {};
  for (const term of [1, 3, 5]) {
    const r = rebuildAndVerify(rows, { term });
    out[`${term}Y`] = { ok: r.ok, message: r.message, url: r.url };
  }
  return out;
}

// ── One-shot re-plan (2026-08-19 regression) ────────────────────────────────
// The exact path that wiped Chris's hardware: a plan holding devices AND their
// derived licences, with a tier picked on a device row, pushed through
// "Revalidate / re-plan". This runs the REAL splitter and REAL serializer, then
// resolves the requote text the way the worker does.

/** The sidebar's revalidateEditedProducts, minus the React and the network. */
export function oneshotReplan(rows, term = null) {
  const effectiveTerm = Number(term || termFromLicenseRows(rows) || 3);
  return oneshotReplanAtTerm(rows, effectiveTerm);
}

function oneshotReplanAtTerm(rows, term) {
  // revalidateEditedProducts only requotes when a row carries a tier. With no
  // tier the committed rows are sent through untouched, so the harness must do
  // the same or it reports term changes the extension never performs.
  const hasRowTier = (Array.isArray(rows) ? rows : []).some((r) => String(r?.tier || '').trim());
  if (!hasRowTier) {
    const asIs = quoteTextFromEditorRows(rows, '', {});
    return asIs.ok
      ? { ok: true, message: '', skus: asIs.rows, text: asIs.text, requoted: false }
      : { ok: false, message: asIs.error, skus: [] };
  }
  const { hardwareRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
  const prepared = hardwareRows.length
    ? quoteTextFromEditorRows(hardwareRows, '', {})
    : quoteTextFromEditorRows(rows, '', {});
  if (!prepared.ok) return { ok: false, message: prepared.error, skus: [] };

  const fromWorker = resolveRequoteText(prepared.text, term);
  if (!fromWorker.length) return { ok: false, message: 'requote produced nothing', skus: [], text: prepared.text };

  const carried = standaloneLicenseRows
    .filter((row) => !fromWorker.some((i) => sameDeviceIdentity(i.sku, row.sku)))
    .map(({ sku, qty }) => ({ sku, qty }));
  const skus = hardwareRows.length ? [...fromWorker, ...carried] : fromWorker;
  return { ok: true, message: '', skus, text: prepared.text, requoted: true };
}

const isLic = (sku) => /^LIC-/i.test(sku);

/**
 * Invariants that must hold for any re-plan. Each returns an error string, or
 * null when it holds. These are the assertions the bug would have failed.
 */
const REPLAN_RULES = [
  ['no device is dropped', (rows, out) => {
    const wanted = rows.filter((r) => !isLic(r.sku)).map((r) => skuModelToken(r.sku));
    const got = new Set(out.skus.map((s) => skuModelToken(s.sku)));
    const missing = wanted.filter((t) => !got.has(t));
    return missing.length ? `hardware dropped: ${missing.join(', ')}` : null;
  }],
  ['no licence is quoted twice', (rows, out) => {
    // Keyed on device identity: an MS130-24 and an MS130-48 in one cart
    // legitimately carry two different MS130 licences.
    const seen = [];
    for (const item of out.skus.filter((s) => isLic(s.sku))) {
      const clash = seen.find((prev) => sameDeviceIdentity(prev, item.sku));
      if (clash) return `two licences for the same device: ${clash} and ${item.sku}`;
      seen.push(item.sku);
    }
    return null;
  }],
  ['no licence row is silently dropped', (rows, out) => {
    const planned = out.skus.filter((s) => isLic(s.sku));
    for (const row of rows.filter((r) => isLic(r.sku))) {
      const covered = planned.some((p) => sameDeviceIdentity(p.sku, row.sku))
        || rows.some((hw) => !isLic(hw.sku) && sameDeviceIdentity(row.sku, hw.sku));
      if (!covered) return `${row.sku} vanished from the plan`;
    }
    return null;
  }],
  ['the plan keeps the term it was quoting', (rows, out, ctx = {}) => {
    // The loop deliberately forces 1/3/5 to exercise every term; only the
    // unforced pass reflects what the sidebar itself would choose.
    if (ctx.forcedTerm) return null;
    const want = termFromLicenseRows(rows);
    if (!want) return null;
    const got = termFromLicenseRows(out.skus);
    return got && got !== want ? `plan was ${want}-year, re-planned to ${got}-year` : null;
  }],
  ['a tier word never lands on a licence line', (rows, out) =>
    /LIC-\S+\s+(enterprise|security|advanced|SD-WAN)/i.test(out.text || '')
      ? `requote text puts a tier on a licence: ${JSON.stringify(out.text)}`
      : null],
  ['licence quantity matches its device', (rows, out) => {
    for (const item of out.skus.filter((s) => isLic(s.sku))) {
      const device = out.skus.find((s) => !isLic(s.sku) && sameDeviceIdentity(item.sku, s.sku));
      if (device && device.qty !== item.qty) {
        return `${item.sku} qty ${item.qty} does not match ${device.sku} qty ${device.qty}`;
      }
    }
    return null;
  }],
  ['the requote never re-sends a derived licence', (rows, out) => {
    // Only meaningful when a requote actually ran. With no tier set the sidebar
    // sends the committed rows straight through, licences included, by design.
    if (out.requoted !== true) return null;
    return (out.text && /LIC-/i.test(out.text) && rows.some((r) => !isLic(r.sku)))
      ? `requote text still carries a licence: ${JSON.stringify(out.text)}`
      : null;
  }],
  ['each device keeps its own tier', (rows, out) => {
    for (const row of rows.filter((r) => !isLic(r.sku) && r.tier)) {
      const code = { security: 'SEC', enterprise: 'ENT', advanced: 'ADV', 'SD-WAN': 'SDW' }[row.tier];
      const token = skuModelToken(row.sku);
      const lic = out.skus.find((s) => isLic(s.sku) && skuModelToken(s.sku) === token);
      // Families whose licence carries no tier code (MR/CW resolve to LIC-ENT)
      // are exempt: there is nothing in the SKU to check.
      if (lic && /^LIC-(MX|Z)/i.test(lic.sku) && code && !lic.sku.includes(code)) {
        return `${row.sku} asked for ${code} but got ${lic.sku}`;
      }
    }
    return null;
  }],
];

const REPLAN_CASES = [
  {
    name: "reported cart, MX set to Advanced Security",
    rows: [
      { sku: 'C9200L-24P-4G-M', qty: 1, tier: '' },
      { sku: 'MS150-48LP-4G', qty: 1, tier: '' },
      { sku: 'MX67C-NA', qty: 2, tier: 'security' },
      { sku: 'LIC-C9200L-24E-1Y', qty: 1 },
      { sku: 'LIC-MS150-48-1Y', qty: 1 },
      { sku: 'LIC-MX67C-SEC-1YR', qty: 2 },
    ],
  },
  {
    name: 'mixed tiers on one quote (MX SEC + MR ADV)',
    rows: [
      { sku: 'MX67C-NA', qty: 2, tier: 'security' },
      { sku: 'MR44', qty: 3, tier: 'advanced' },
      { sku: 'LIC-MX67C-SEC-1YR', qty: 2 },
      { sku: 'LIC-ENT-1YR', qty: 3 },
    ],
  },
  {
    name: 'tier flipped ENT -> SEC on an existing plan',
    rows: [
      { sku: 'MX67C-NA', qty: 1, tier: 'security' },
      { sku: 'LIC-MX67C-ENT-1YR', qty: 1 },
    ],
  },
  {
    name: 'standalone licence for absent hardware survives',
    rows: [
      { sku: 'MX67C-NA', qty: 1, tier: 'security' },
      { sku: 'LIC-MX67C-SEC-1YR', qty: 1 },
      { sku: 'LIC-MS250-48-3YR', qty: 4 },
    ],
  },
  {
    name: 'port variants: MS130-24 cart with an MS130-48 licence',
    rows: [
      { sku: 'MS130-24', qty: 2, tier: 'advanced' },
      { sku: 'LIC-MS130-24-3Y', qty: 2 },
      { sku: 'LIC-MS130-48-3Y', qty: 4 },
    ],
  },
  {
    name: 'port variants: both MS130 sizes in one cart',
    rows: [
      { sku: 'MS130-24', qty: 2, tier: 'advanced' },
      { sku: 'MS130-48', qty: 3, tier: 'advanced' },
      { sku: 'LIC-MS130-24-3Y', qty: 2 },
      { sku: 'LIC-MS130-48-3Y', qty: 3 },
    ],
  },
  {
    name: 'stale tier left on a licence row',
    rows: [
      { sku: 'MX67C-NA', qty: 2, tier: 'security' },
      { sku: 'LIC-MX67C-SEC-5YR', qty: 2 },
      { sku: 'LIC-ENT-5YR', qty: 3, tier: 'advanced' },
    ],
  },
  {
    name: 'a 5-year plan must stay 5-year',
    rows: [
      { sku: 'MX67C-NA', qty: 1, tier: 'security' },
      { sku: 'LIC-MX67C-SEC-5YR', qty: 1 },
    ],
  },
  {
    name: 'licence-only cart passes straight through',
    rows: [
      { sku: 'LIC-C9200L-24E-3Y', qty: 1 },
      { sku: 'LIC-MS150-48-3Y', qty: 1 },
    ],
  },
  {
    name: 'hardware with no tier picked',
    rows: [
      { sku: 'MR44', qty: 4, tier: '' },
      { sku: 'LIC-ENT-1YR', qty: 4 },
    ],
  },
];

function runReplanMatrix() {
  const out = [];
  for (const term of [null, 1, 3, 5]) {
    for (const testCase of REPLAN_CASES) {
      let result;
      try { result = oneshotReplan(testCase.rows, term); }
      catch (e) { result = { ok: false, message: `threw: ${e.message}`, skus: [] }; }
      const ctx = { forcedTerm: term };
      const failures = result.ok
        ? REPLAN_RULES.map(([rule, check]) => {
            const err = check(testCase.rows, result, ctx);
            return err ? `${rule}: ${err}` : null;
          }).filter(Boolean)
        : [result.message];
      out.push({
        term: term || 'plan',
        name: testCase.name,
        pass: failures.length === 0,
        detail: failures.join(' | '),
        plan: (result.skus || []).map((s) => `${s.qty}x ${s.sku}`).join(', '),
        text: result.text,
      });
    }
  }
  return out;
}

function runMatrix(term) {
  return MATRIX.map(([name, start, edit, expectOk]) => {
    let got;
    try { got = rebuildAndVerify(edit(start), { term }); } catch (e) { got = { ok: false, message: `threw: ${e.message}` }; }
    return { name, expectOk, actualOk: got.ok, pass: got.ok === expectOk, detail: got.message, url: got.url };
  });
}

function Harness() {
  const [activeId, setActiveId] = useState(SCENARIOS[0].id);
  const scenario = useMemo(() => SCENARIOS.find((s) => s.id === activeId), [activeId]);

  const [rows, setRows] = useState(scenario.rows);
  const [result, setResult] = useState(() => ({ urls: buildQuoteOptions(scenario.rows), parsedItems: scenario.rows }));
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState('');
  const [log, setLog] = useState([]);
  const [matrix, setMatrix] = useState(null);
  const [replan, setReplan] = useState(null);
  const [planRows, setPlanRows] = useState(REPLAN_CASES[0].rows);
  const [planOut, setPlanOut] = useState(null);
  // Quote Line Editor: a mutable copy of the mock quote, so committing in the
  // card actually changes what a reload shows, the way Zoho would.
  const [qleQuote, setQleQuote] = useState(QLE_QUOTE);
  const [qleRuns, setQleRuns] = useState(null);
  const [qleKey, setQleKey] = useState(0);

  const say = (msg, kind = '') => setLog((prev) => [...prev, { msg, kind }]);

  function load(id) {
    const next = SCENARIOS.find((s) => s.id === id);
    setActiveId(id);
    setRows(next.rows);
    setResult({ urls: buildQuoteOptions(next.rows), parsedItems: next.rows });
    setDirty(false);
    setStatus('');
    setMatrix(null);
    setLog([{ msg: `— loaded: ${next.name} (${next.covers})` }]);
  }

  function onUpdateQuote() {
    const outcome = rebuildAndVerify(rows, { term: 3 });
    if (!outcome.ok) {
      setStatus(outcome.message);
      setResult((prev) => ({ ...prev, urls: [] }));
      say(`VERIFY FAILED — ${outcome.message}`, 'assert-fail');
      if (outcome.url) say(`  url was: ${outcome.url}`, '');
      return;
    }
    setResult((prev) => ({ ...prev, urls: outcome.urls, parsedItems: rows }));
    setDirty(false);
    setStatus('Quote updated and every displayed link matches the committed SKU quantities.');
    say(`verify OK — ${outcome.urls.length} option(s) republished`, 'assert-pass');
  }

  function loopTest() {
    const all = [1, 3, 5].flatMap((t) => runMatrix(t).map((r) => ({ ...r, term: t })));
    setMatrix(all);
    const failed = all.filter((r) => !r.pass);
    say(`loop test: ${all.length - failed.length}/${all.length} passed across terms 1/3/5`,
      failed.length ? 'assert-fail' : 'assert-pass');
    failed.forEach((f) => say(`  FAIL [${f.term}Y] ${f.name} — ${f.detail || '(no message)'}`, 'assert-fail'));
  }

  function replanLoopTest() {
    const all = runReplanMatrix();
    setReplan(all);
    const failed = all.filter((r) => !r.pass);
    say(`one-shot re-plan: ${all.length - failed.length}/${all.length} passed across terms 1/3/5`,
      failed.length ? 'assert-fail' : 'assert-pass');
    failed.forEach((f) => say(`  FAIL [${f.term}Y] ${f.name} — ${f.detail}`, 'assert-fail'));
  }

  function quoteLineLoopTest(builder = buildOpsPayload, label = 'real builder') {
    const all = runQuoteLineLoop(builder);
    setQleRuns(all);
    const failed = all.filter((r) => !r.pass);
    say(`quote line editor (${label}): ${all.length - failed.length}/${all.length} passed`,
      failed.length ? 'assert-fail' : 'assert-pass');
    failed.forEach((f) => say(`  FAIL ${f.name}: ${f.detail}`, 'assert-fail'));
  }

  function revalidatePlan() {
    const outcome = oneshotReplan(planRows);
    setPlanOut(outcome);
    if (!outcome.ok) { say(`re-plan failed — ${outcome.message}`, 'assert-fail'); return; }
    const broken = REPLAN_RULES.map(([rule, check]) => {
      const err = check(planRows, outcome, {});
      return err ? `${rule}: ${err}` : null;
    }).filter(Boolean);
    if (broken.length) broken.forEach((b) => say(`  INVARIANT BROKEN — ${b}`, 'assert-fail'));
    else say(`re-plan OK — ${outcome.skus.length} line(s), every invariant held`, 'assert-pass');
  }

  return (
    <div className="wrap">
      <div className="rail">
        <div className="card">
          <h2>One-shot re-plan</h2>
          <p className="hint">
            The path that dropped the hardware on 2026-08-19. Pick a cart, set a licence
            tier on a device row, then Revalidate.
          </p>
          {REPLAN_CASES.map((c) => (
            <button key={c.name} className="scenario"
              data-active={planRows === c.rows}
              onClick={() => { setPlanRows(c.rows); setPlanOut(null); say(`— re-plan cart: ${c.name}`); }}>
              <strong>{c.name}</strong>
            </button>
          ))}
          <button id="replan-loop" className="scenario" onClick={replanLoopTest}
            style={{ marginTop: 10, borderColor: '#188038' }}>
            <strong>▶ Run re-plan loop ({REPLAN_CASES.length} carts × 4 term modes)</strong>
          </button>
        </div>

        {replan && (
          <div className="card">
            <h2>Re-plan loop</h2>
            <div className="log" id="replan-out">
              {replan.filter((r) => !r.pass).length === 0
                ? <div className="assert-pass">all {replan.length} re-plan cases passed</div>
                : replan.filter((r) => !r.pass).map((r, i) => (
                  <div key={i} className="assert-fail">[{r.term}Y] {r.name} — {r.detail}</div>
                ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2>Quote line editor</h2>
          <p className="hint">
            Bulk discount, per-row override, multi-select delete and reorder on a mixed
            Zoho quote. The card at the bottom right is the real component.
          </p>
          <button id="qle-loop" className="scenario" onClick={() => quoteLineLoopTest()}
            style={{ borderColor: '#188038' }}>
            <strong>▶ Run quote line loop ({QLE_CASES.length} cases)</strong>
          </button>
          <button id="qle-loop-legacy" className="scenario"
            onClick={() => quoteLineLoopTest(qleLegacyBuildOpsPayload, 'deliberately broken builder')}
            style={{ borderColor: '#c5221f' }}>
            <strong>▶ Same loop, broken builder (must FAIL)</strong>
          </button>
          <button className="scenario" onClick={() => { setQleQuote(QLE_QUOTE); setQleKey((k) => k + 1); say('- quote line editor reset'); }}>
            <strong>Reset the mock quote</strong>
          </button>
          <button className="scenario" onClick={() => { setQleQuote(QLE_COST_QUOTE); setQleKey((k) => k + 1); say('- loaded the REAL cost quote (2570562000422125077)'); }}>
            <strong>Load the real cost quote (margin)</strong>
          </button>
        </div>

        {qleRuns && (
          <div className="card">
            <h2>Quote line loop</h2>
            <div className="log" id="qle-out">
              {qleRuns.filter((r) => !r.pass).length === 0
                ? <div className="assert-pass">all {qleRuns.length} quote line cases passed</div>
                : qleRuns.filter((r) => !r.pass).map((r, i) => (
                  <div key={i} className="assert-fail">{r.name}: {r.detail}</div>
                ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2>Scenarios</h2>
          <p className="hint">The card on the right is the actual extension component.</p>
          {SCENARIOS.map((s) => (
            <button key={s.id} className="scenario" data-active={s.id === activeId} onClick={() => load(s.id)}>
              <strong>{s.name}</strong>
              <span className="ok">covers: {s.covers}</span>
            </button>
          ))}
          <button id="loop" className="scenario" onClick={loopTest} style={{ marginTop: 10, borderColor: '#188038' }}>
            <strong>▶ Run loop test ({MATRIX.length} cases × 3 terms)</strong>
          </button>
        </div>

        {matrix && (
          <div className="card">
            <h2>Loop test</h2>
            <div className="log" id="matrix-out">
              {matrix.filter((r) => !r.pass).length === 0
                ? <div className="assert-pass">all {matrix.length} cases passed</div>
                : matrix.filter((r) => !r.pass).map((r, i) => (
                  <div key={i} className="assert-fail">[{r.term}Y] {r.name} — {r.detail}</div>
                ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2>Log</h2>
          <div className="log">{log.map((l, i) => <div key={i} className={l.kind}>{l.msg}</div>)}</div>
        </div>
      </div>

      <div className="stage">
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panelhead">One-shot plan products</div>
          <SkuQuantityEditor
            rows={planRows}
            onRowsChange={(next) => { setPlanRows(next); setPlanOut(null); }}
            onUpdate={revalidatePlan}
            onProductSearch={async (q) => {
              const needle = String(q || '').toUpperCase();
              return { ok: true, live: false, results: PRODUCT_POOL.filter((s) => s.includes(needle)).map((sku) => ({ sku, name: sku })) };
            }}
            dirty
            disabled={false}
            title="Zoho plan products"
            updateLabel="Revalidate / re-plan"
            status={planOut && !planOut.ok ? planOut.message : ''}
          />
          {planOut?.ok && (
            <div className="log" id="replan-plan" style={{ marginTop: 10 }}>
              <div><strong>sent to worker:</strong> {JSON.stringify(planOut.text)}</div>
              <div><strong>resulting plan:</strong> {planOut.skus.map((s) => `${s.qty}x ${s.sku}`).join(', ')}</div>
            </div>
          )}
        </div>

        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="panelhead">Quote line editor (mock quote {qleQuote.quoteNumber})</div>
          <QuoteLineEditor
            key={qleKey}
            recordId={qleQuote.quoteId}
            module="Quotes"
            onLoad={async () => qleQuote}
            onPreviewCloneTerms={async (id, terms) => {
              const out = previewCloneTerms(qleQuote, terms);
              say(`quote-clone-terms-preview -> ${out.previews.filter((p) => p.available).length}/${out.previews.length} terms available`);
              return out;
            }}
            onCloneTerms={async ({ terms }) => {
              const out = cloneQuoteTerms(qleQuote, terms);
              say(`quote-clone-terms -> ${out.succeeded}/${out.results.length} clone(s) created`, out.succeeded === out.results.length ? 'assert-pass' : 'assert-fail');
              return out;
            }}
            onLoadCosts={async () => {
              const resolved = resolveLineCosts(qleQuote);
              say(`quote-line-costs -> ${resolved.costs.filter((c) => c.distiTotal > 0).length}/${resolved.costs.length} lines have cost`);
              return resolved;
            }}
            onMatchEcomm={async () => {
              const resolved = resolveEcommPrices(qleQuote);
              say(`quote-line-ecomm -> ${resolved.quotes.filter((q) => q.ecommPrice > 0).length}/${resolved.quotes.length} priced`);
              return resolved;
            }}
            onCommit={async (payload) => {
              say(`quote-line-ops -> ${JSON.stringify(payload.ops)}`);
              const applied = applyQuoteLineOps(qleQuote, payload);
              if (!applied.success) { say(`worker rejected: ${applied.error}`, 'assert-fail'); return applied; }
              setQleQuote(applied.quote);
              say(`committed: ${applied.quote.lines.length} line(s) remain, total ${applied.grand_total_after}`, 'assert-pass');
              return applied;
            }}
          />
        </div>

        <div className="panel">
          <div className="panelhead">Stratus AI · DEV — harness</div>
          <QuoteResult
            result={result}
            busy={false}
            draftRows={rows}
            draftDirty={dirty}
            draftStatus={status}
            onDraftRowsChange={(next) => { setRows(next); setDirty(true); }}
            onUpdateQuote={onUpdateQuote}
            onProductSearch={async (q) => {
              const needle = String(q || '').toUpperCase();
              const hits = PRODUCT_POOL.filter((s) => s.includes(needle));
              say(`product-search "${q}" -> ${hits.length} hit(s)`);
              return { ok: true, live: false, results: hits.map((sku) => ({ sku, name: sku })) };
            }}
            onApplySuggestion={(s) => {
              const target = Array.isArray(s?.suggest) ? s.suggest[0] : s?.suggest;
              setRows((prev) => prev.map((r) => (r.sku === s.input ? { ...r, sku: target } : r)));
              setResult((prev) => ({ ...prev, suggestions: [] }));
              setDirty(true);
              say(`applied suggestion: ${s.input} -> ${target}`, 'assert-pass');
            }}
            onStackSuggestion={(s) => say(`stack: ${JSON.stringify(s?.suggest)}`)}
            onSendToZoho={(r, idx) => say(`send-to-Zoho: option #${idx} -> ${r?.urls?.[idx]?.url || '(none)'}`)}
          />
        </div>
      </div>
    </div>
  );
}

// ── Quote Line Editor loop (2026-08-20) ─────────────────────────────────────
//
// Drives the REAL core through bulk set, per-row override, multi-select delete
// and reorder, then asserts the payload the extension would POST and the quote
// the mock worker would return. The rules below MUST be able to fail: pass
// __stratus.qleLegacy as the builder to watch them fail on a builder that emits
// an op for every row whether or not the rep touched it.

const QLE_CASES = [
  {
    name: 'bulk 25% on every line',
    edit: (rows) => applyBulkDiscount(rows, 25),
    expect: (payload) => (payload.ops.setDiscounts.length === 5 && payload.ops.setDiscounts.every((o) => o.pct === 25)
      ? null : `expected 5 rows at 25%, got ${JSON.stringify(payload.ops.setDiscounts)}`),
  },
  {
    name: 'bulk 25% then one row overridden to 12.5%',
    edit: (rows) => setRowDiscount(applyBulkDiscount(rows, 25), 'ql3', 12.5),
    expect: (payload) => (payload.ops.setDiscounts.find((o) => o.id === 'ql3')?.pct === 12.5
      ? null : 'the per-row override did not survive the bulk fill'),
  },
  {
    name: 'one row back to 0% clears its description',
    edit: (rows) => setRowDiscount(applyBulkDiscount(rows, 25), 'ql2', 0),
    expect: (payload, diff) => (diff.descriptionChanges.find((c) => c.id === 'ql2')?.to === ''
      ? null : 'a 0% line must clear its description, not write "0% Discount"'),
  },
  {
    name: 'multi-select delete of two lines',
    edit: (rows) => resequence(markSelectedForDelete(toggleRowSelected(toggleRowSelected(rows, 'ql4'), 'ql5'))),
    expect: (payload) => (payload.ops.deletes.length === 2 && payload.ops.setDiscounts.length === 0 && payload.ops.reorder.length === 0
      ? null : 'a pure delete must emit deletes only'),
  },
  {
    name: 'match ecomm pricing',
    edit: (rows) => applyEcommPricing(rows, resolveEcommPrices(QLE_QUOTE).quotes),
    expect: (payload) => {
      // Three SKUs have a real storefront price; MA-PWR-30W resolves at list
      // (a 0% match, still a legitimate op) and LIC-MS130-24-3Y does not
      // resolve at all, so it must emit NOTHING.
      if (payload.ops.setDiscounts.some((o) => o.id === 'ql5')) return 'an unresolvable SKU must not be repriced';
      const mr = payload.ops.setDiscounts.find((o) => o.id === 'ql1');
      if (!mr) return 'MR44-HW should have been matched';
      // list 1495, ecomm 1121.25, qty 10 -> exactly $3,737.50 off.
      if (mr.dollars !== 3737.5) return `expected exact dollars 3737.5, got ${mr.dollars}`;
      if (mr.pct !== 25) return `expected the description percent 25, got ${mr.pct}`;
      return null;
    },
  },
  {
    // THE REGRESSION GUARD FOR MARGIN PRICING. Prices the REAL quote to 10% and
    // asserts every line lands on the discount Zoho itself stored.
    name: 'margin 10% reproduces Zoho exactly',
    quote: QLE_COST_QUOTE,
    edit: (rows) => applyMarginPricing(rows, resolveLineCosts(QLE_COST_QUOTE).costs, 10),
    expect: (payload) => {
      for (const [id, want] of Object.entries(ZOHO_DISCOUNT_AT_10)) {
        const op = payload.ops.setDiscounts.find((o) => o.id === id);
        if (!op) return `${id} was not priced`;
        if (op.dollars !== want) return `${id}: got ${op.dollars}, Zoho stored ${want}`;
      }
      if (payload.ops.setDiscounts.some((o) => o.id === 'v7')) return 'a line with no cost row must be left alone';
      return null;
    },
  },
  {
    name: 'reorder only',
    edit: (rows) => moveRowToIndex(rows, 'ql5', 0),
    expect: (payload) => (payload.ops.reorder[0] === 'ql5' && payload.ops.setDiscounts.length === 0
      ? null : 'a pure reorder must emit no discount ops'),
  },
  {
    name: 'discount plus delete plus reorder in ONE commit',
    edit: (rows) => moveRowToIndex(resequence(markSelectedForDelete(toggleRowSelected(applyBulkDiscount(rows, 20), 'ql4'))), 'ql3', 0),
    expect: (payload) => {
      if (payload.ops.deletes.length !== 1) return 'expected exactly one delete';
      for (const id of payload.ops.deletes) {
        if (payload.ops.setDiscounts.some((o) => o.id === id)) return `deleted row ${id} also carries a discount`;
        if (payload.ops.reorder.includes(id)) return `deleted row ${id} also carries a sequence`;
      }
      return payload.ops.reorder[0] === 'ql3' ? null : 'the reorder did not land';
    },
  },
];

/** Rules that hold for EVERY case, whatever the edit was. */
const QLE_RULES = [
  ['no id appears in two op lists', (payload) => {
    const del = new Set(payload.ops.deletes);
    const clash = [...payload.ops.setDiscounts.map((o) => o.id), ...payload.ops.reorder].filter((id) => del.has(id));
    return clash.length ? `${clash.join(', ')} is both deleted and modified` : null;
  }],
  ['every percent is inside 0 to 100', (payload) => {
    const bad = payload.ops.setDiscounts.filter((o) => !(o.pct >= 0 && o.pct <= 100));
    return bad.length ? `out-of-range percent: ${JSON.stringify(bad)}` : null;
  }],
  ['the mock worker accepts the payload', (payload, diff, quote = QLE_QUOTE) => {
    const applied = applyQuoteLineOps(quote, payload);
    return applied.success ? null : `worker rejected it: ${applied.error} ${applied.message}`;
  }],
  ['the resulting quote is never empty', (payload, diff, quote = QLE_QUOTE) => {
    const applied = applyQuoteLineOps(quote, payload);
    return applied.success && applied.quote.lines.length > 0 ? null : 'the quote was emptied';
  }],
  ['an exact-dollar op still matches its stated percent', (payload, diff, quote = QLE_QUOTE) => {
    // The worker refuses a Description that misstates the discount, so the
    // client must never build one. Tolerance is display rounding only.
    const line = new Map(quote.lines.map((l) => [l.id, l]));
    for (const op of payload.ops.setDiscounts) {
      if (op.dollars === undefined) continue;
      const l = line.get(op.id);
      const gross = l.listPrice * l.qty;
      const fromPct = Math.round(gross * op.pct / 100 * 100) / 100;
      if (Math.abs(op.dollars - fromPct) > Math.max(1, gross * 0.001)) {
        return `${op.id}: $${op.dollars} is not ${op.pct}% of $${gross}`;
      }
    }
    return null;
  }],
  ['every discount is computed against the LINE list price', (payload, diff, quote = QLE_QUOTE) => {
    // Zoho subtracts Discount from the LINE's stored List_Price x Quantity. If
    // an op is ever computed against the live catalog list instead, the net the
    // rep approved is not the net the customer sees.
    const line = new Map(quote.lines.map((l) => [l.id, l]));
    for (const op of payload.ops.setDiscounts) {
      const l = line.get(op.id);
      const gross = Math.round(l.listPrice * l.qty * 100) / 100;
      if (op.dollars !== undefined && op.dollars > gross + 0.005) {
        return `${op.id}: discount ${op.dollars} exceeds the line gross ${gross}`;
      }
    }
    return null;
  }],
  ['no description written mentions margin', (payload, diff) => {
    const bad = diff.descriptionChanges.filter((c) => /margin/i.test(c.to));
    return bad.length ? `margin wording in ${bad.map((c) => c.id).join(', ')}` : null;
  }],
];

function qleBuild(edit, builder = buildOpsPayload, quote = QLE_QUOTE) {
  const original = linesFromApi(quote);
  const rows = edit(original.map((r) => ({ ...r })));
  const built = builder(original, rows, { recordId: quote.quoteId, module: 'Quotes' });
  return { original, rows, built, diff: diffAgainstOriginal(original, rows) };
}

function runQuoteLineLoop(builder = buildOpsPayload) {
  return QLE_CASES.map((c) => {
    const quote = c.quote || QLE_QUOTE;
    const { built, diff } = qleBuild(c.edit, builder, quote);
    if (!built.ok) return { name: c.name, pass: false, detail: `payload refused: ${built.error}` };
    const failures = [
      c.expect(built.payload, diff),
      ...QLE_RULES.map(([rule, fn]) => { const e = fn(built.payload, diff, quote); return e ? `${rule}: ${e}` : null; }),
    ].filter(Boolean);
    return { name: c.name, pass: failures.length === 0, detail: failures.join('; ') };
  });
}

// The deliberately broken builder, kept for the same reason replanLegacy is: it
// leaves deleted ids in the reorder list and emits an op for every surviving
// row whether or not the rep touched it. The rules must be able to SHOW that.
// A harness whose checks cannot fail proves nothing.
//   __stratus.qleLoop(__stratus.qleLegacy)   -> failures
function qleLegacyBuildOpsPayload(original, rows, options) {
  const survivors = rows.filter((r) => !r.deleted);
  return {
    ok: true,
    error: '',
    diff: diffAgainstOriginal(original, rows),
    payload: {
      recordId: options.recordId,
      module: options.module,
      writeDescriptions: true,
      ops: {
        setDiscounts: survivors.map((r) => ({ id: r.id, pct: r.discountPct })),
        deletes: rows.filter((r) => r.deleted).map((r) => r.id),
        reorder: rows.map((r) => r.id),
      },
    },
  };
}

createRoot(document.getElementById('root')).render(<Harness />);

// Scriptable surface, so a re-plan regression can be driven from the browser
// console (or an agent's browser tool) without clicking through the UI:
//   __stratus.check(__stratus.CASES[0].rows)          -> invariants for one cart
//   __stratus.replan(rows, 3)                         -> the plan for a 3-year term
//   __stratus.check(rows, __stratus.replanLegacy)     -> what the old code did
// replanLegacy is kept deliberately: it is the pre-fix algorithm, so the rules
// can be shown to FAIL on it. A harness whose checks cannot fail proves nothing.
function replanLegacy(rows, term = 1) {
  const prepared = quoteTextFromEditorRows(rows, '', {});
  if (!prepared.ok) return { ok: false, message: prepared.error, skus: [] };
  const skus = resolveRequoteText(prepared.text, term);
  return { ok: skus.length > 0, message: skus.length ? '' : 'requote produced nothing', skus, text: prepared.text };
}

window.__stratus = {
  replan: oneshotReplan,
  replanLegacy,
  CASES: REPLAN_CASES,
  RULES: REPLAN_RULES,
  // Quote Line Editor (2026-08-20)
  QLE_QUOTE,
  QLE_CASES,
  QLE_RULES,
  qleLoop: runQuoteLineLoop,
  qleLegacy: qleLegacyBuildOpsPayload,
  qleBuild,
  QLE_COST_QUOTE,
  resolveLineCosts,
  ZOHO_DISCOUNT_AT_10,
  applyMarginPricing,
  marginPctForRow,
  splitRowsForTierRequote,
  quoteTextFromEditorRows,
  skuModelToken,
  /** Run every invariant against one cart. Returns [] when the cart is clean. */
  check(rows, algorithm = oneshotReplan, term = null) {
    const out = algorithm(rows, term);
    if (!out.ok) return [`re-plan failed: ${out.message}`];
    return REPLAN_RULES.map(([rule, fn]) => {
      const err = fn(rows, out, { forcedTerm: term });
      return err ? `${rule}: ${err}` : null;
    }).filter(Boolean);
  },
};
