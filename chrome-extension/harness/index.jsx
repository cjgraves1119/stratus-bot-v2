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
  applyExplicitMxWarmSpareToQuoteOptions,
  hasExplicitMxHaIntent,
  verifyStratusOrderUrlComposition,
  normalizeEditableQuoteLines,
  normalizeQuoteIntakeLines,
  quoteIntakeTierLabel,
  quoteSkuTextFromLines,
  selectableQuoteTerms,
  verifyStratusOrderUrlOptions,
} from '../src/lib/email-quote-flow.mjs';
import {
  buildOneshotIntake as workerBuildOneshotIntake,
  buildQuoteResponse as workerBuildQuoteResponse,
  HARNESS_WORKER_SOURCE_SHA256,
  parseMessage as workerParseMessage,
  validateExplicitMxMsQuoteComposition as workerValidateQuoteComposition,
} from '../../worker-gchat/src/index.js';
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

// ── Real extension -> Worker -> verifier pipeline ──────────────────────────
//
// This is deliberately separate from rebuildAndVerify above. That older loop
// uses mock-worker.mjs to keep interactive component demos fast. These cases
// execute the actual editor serializer, the actual Worker parseMessage /
// buildQuoteResponse implementation (exposed only by the harness build loader),
// and the actual extension option-set verifier. No HTTP or CRM action occurs.

const WORKER_ORDER_URL_RE = /https:\/\/stratusinfosystems\.com\/order\/\?item=[^\s)\]]+/g;
const PIPELINE_TERMS = [1, 3, 5];

function optionTermFromUrl(rawUrl) {
  try {
    const items = String(new URL(rawUrl).searchParams.get('item') || '').split(',');
    const terms = [...new Set(items
      .map((sku) => String(sku).match(/-([135])YR?$/i)?.[1] || '')
      .filter(Boolean))];
    return terms.length === 1 ? Number(terms[0]) : null;
  } catch {
    return null;
  }
}

function workerOptionsFromMessage(message) {
  return [...String(message || '').matchAll(WORKER_ORDER_URL_RE)].map((match, index) => {
    const url = match[0];
    const term = optionTermFromUrl(url);
    return {
      label: term ? `${term}-Year` : `Option ${index + 1}`,
      url,
      ...(term ? { termYears: term } : {}),
    };
  });
}

function decodePipelineOption(option) {
  try {
    const url = new URL(String(option?.url || ''));
    const skus = String(url.searchParams.get('item') || '').split(',').map((sku) => sku.trim().toUpperCase());
    const qtys = String(url.searchParams.get('qty') || '').split(',').map(Number);
    return skus.map((sku, index) => ({ sku, qty: qtys[index] }));
  } catch {
    return [];
  }
}

const verificationTier = (modeTier) => ({
  enterprise: 'ENT', security: 'SEC', advanced: 'A', 'SD-WAN': 'SDW',
}[modeTier] || null);

export function runActualQuotePipeline(rows, {
  sourceText = '',
  workerInputText = '',
  workerParsedInput = null,
} = {}) {
  const haRequested = hasExplicitMxHaIntent(sourceText);
  const prepared = quoteTextFromEditorRows(rows, sourceText, { haRequested });
  if (!prepared.ok) {
    return { ok: false, stage: 'serialize', error: prepared.error, haRequested, options: [] };
  }
  // The editor serializer deliberately carries only reviewed quote modes
  // (term/tier/hardware-only/HA). Initial-message routing such as "separate
  // quotes" is tested with the exact initial request while still executing the
  // real serializer above and using its committed rows for downstream checks.
  const workerText = String(workerInputText || '').trim() || prepared.text;

  let parsed;
  let built;
  try {
    // Most cases exercise the real parser. The optional parsed fixture exists
    // only for builder states which the parser intentionally rejects before
    // quote construction (for example, an unknown EOL licence tier). It lets
    // the visible harness prove that buildQuoteResponse itself fails closed.
    parsed = workerParsedInput
      ? JSON.parse(JSON.stringify(workerParsedInput))
      : workerParseMessage(workerText);
    built = workerBuildQuoteResponse(parsed);
  } catch (error) {
    return {
      ok: false, stage: 'worker', error: `Worker quote core threw: ${error.message}`,
      text: workerText, serializedText: prepared.text, haRequested, options: [],
    };
  }

  let options = workerOptionsFromMessage(built?.message);
  const workerComposition = workerValidateQuoteComposition(workerText, parsed, options, []);
  const workerParsedRows = (Array.isArray(parsed?.items) ? parsed.items : []).map((item) => ({
    sku: String(item?.baseSku || item?.sku || '').toUpperCase(),
    qty: Number(item?.qty) || 0,
    tier: String(item?.requestedTier || '').toUpperCase(),
  }));
  const workerOptions = options.map((option) => ({
    ...option,
    items: decodePipelineOption(option),
  }));
  options = applyExplicitMxWarmSpareToQuoteOptions(options, haRequested);
  if (!options.length) {
    return {
      ok: false,
      stage: built?.compositionBlocked ? 'composition' : 'worker',
      error: String(built?.message || built?.errors?.join('; ') || 'Worker generated no quote links.'),
      text: workerText,
      serializedText: prepared.text,
      haRequested,
      workerHaRequested: parsed?.haRequested === true,
      workerRequestedTerm: Number(parsed?.requestedTerm) || null,
      workerSeparateQuotes: parsed?.modifiers?.separateQuotes === true,
      workerComposition,
      workerParsedRows,
      workerOptions,
      compositionBlocked: built?.compositionBlocked === true,
      publishedOptionCount: 0,
      options: [],
    };
  }

  const verified = verifyStratusOrderUrlOptions(options, prepared.rows, {
    licenseTier: verificationTier(prepared.mode?.tier),
    allowHaLicenseRatio: haRequested,
    requireLicensedOption: prepared.mode?.hardwareOnly !== true,
    ...(prepared.hardwareOnlySkus?.length ? { hardwareOnlySkus: prepared.hardwareOnlySkus } : {}),
  });
  return {
    ok: verified.ok,
    stage: verified.ok ? 'done' : 'verify',
    error: verified.error || '',
    text: workerText,
    serializedText: prepared.text,
    rows: prepared.rows,
    haRequested,
    workerHaRequested: parsed?.haRequested === true,
    workerRequestedTerm: Number(parsed?.requestedTerm) || null,
    workerSeparateQuotes: parsed?.modifiers?.separateQuotes === true,
    workerComposition,
    workerParsedRows,
    workerOptions,
    compositionBlocked: built?.compositionBlocked === true,
    publishedOptionCount: verified.urls.length,
    options: (verified.ok ? verified.urls : options).map((option) => ({
      ...option,
      items: decodePipelineOption(option),
    })),
  };
}

function optionForTerm(outcome, term) {
  return (outcome?.options || []).find((option) => Number(option.termYears || optionTermFromUrl(option.url)) === term) || null;
}

function itemForTerm(outcome, term, matcher) {
  const option = optionForTerm(outcome, term);
  return option?.items?.find((item) => matcher.test(item.sku)) || null;
}

function exactTerms(outcome) {
  const actual = (outcome?.options || [])
    .map((option) => Number(option.termYears || optionTermFromUrl(option.url)))
    .filter(Boolean)
    .sort();
  return JSON.stringify(actual) === JSON.stringify(PIPELINE_TERMS)
    ? null : `expected 1/3/5-year options, got ${actual.join('/') || 'none'}`;
}

function requireLine(outcome, term, matcher, qty, label) {
  const item = itemForTerm(outcome, term, matcher);
  if (!item) return `${term}Y missing ${label}`;
  return item.qty === qty ? null : `${term}Y ${label} qty ${item.qty}, expected ${qty}`;
}

function successfulCaseChecks(outcome, lineChecks = []) {
  const failures = [];
  if (!outcome.ok) failures.push(`${outcome.stage}: ${outcome.error}`);
  else {
    const termError = exactTerms(outcome);
    if (termError) failures.push(termError);
    for (const check of lineChecks) {
      for (const term of PIPELINE_TERMS) {
        const error = requireLine(outcome, term, check.matcher(term), check.qty, check.label);
        if (error) failures.push(error);
      }
    }
  }
  return failures;
}

function qtyInPipelineOption(option, matcher) {
  return (option?.items || [])
    .filter((item) => matcher.test(item.sku))
    .reduce((sum, item) => sum + item.qty, 0);
}

function pipelineOptionForTerm(options, term) {
  return (options || []).find((option) =>
    Number(option.termYears || optionTermFromUrl(option.url)) === term) || null;
}

function eolDirectLicenseCase(tier, suffix) {
  const sourceSku = `LIC-MX64-${tier}-3${suffix}`;
  return {
    name: `EOL MX64 ${tier} refresh preserves row tier and unrelated LIC-ENT`,
    rows: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: sourceSku, qty: 1 },
    ],
    sourceText: `renew LIC-ENT-3YR x2 and ${sourceSku} x1`,
    workerInputText: `renew LIC-ENT-3YR x2 and ${sourceSku} x1`,
    stageLabel: 'worker-eol-refresh',
    check: (outcome) => {
      const failures = [];
      if (outcome.compositionBlocked) failures.push(`Worker blocked a supported ${tier} EOL tier: ${outcome.error}`);
      const refreshOptions = (outcome.workerOptions || []).filter((option) =>
        (option.items || []).some((item) => /^MX67(?:-HW)?$/.test(item.sku)));
      if (refreshOptions.length !== PIPELINE_TERMS.length) {
        failures.push(`expected 3 MX67 refresh URLs, got ${refreshOptions.length}`);
      }
      for (const term of PIPELINE_TERMS) {
        const option = refreshOptions.find((candidate) =>
          Number(candidate.termYears || optionTermFromUrl(candidate.url)) === term);
        if (!option) {
          failures.push(`${term}Y MX67 refresh URL is missing`);
          continue;
        }
        const items = option.items || [];
        const qtyFor = (matcher) => items
          .filter((item) => matcher.test(item.sku))
          .reduce((sum, item) => sum + item.qty, 0);
        const expectedReplacement = `LIC-MX67-${tier}-${term}${suffix}`;
        if (qtyFor(/^MX67(?:-HW)?$/) !== 1) failures.push(`${term}Y MX67 hardware quantity was not 1`);
        if (qtyFor(new RegExp(`^${expectedReplacement}$`)) !== 1) {
          failures.push(`${term}Y missing ${expectedReplacement} x1`);
        }
        if (qtyFor(new RegExp(`^LIC-ENT-${term}YR$`)) !== 2) {
          failures.push(`${term}Y did not retain unrelated LIC-ENT x2`);
        }
        const wrongTier = items.find((item) =>
          /^LIC-MX67-(?:ENT|SEC|SDW)-/.test(item.sku) && item.sku !== expectedReplacement);
        if (wrongTier) failures.push(`${term}Y ${tier} row was changed to ${wrongTier.sku}`);
      }
      return failures;
    },
  };
}

const REAL_PIPELINE_CASES = [
  {
    name: 'reported cart: explicit MX67 SEC companion is total, not additive',
    rows: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: 'MX67', qty: 1, tier: 'security' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    sourceText: 'MX67 refresh with the listed renewal licences',
    check: (outcome) => successfulCaseChecks(outcome, [
      { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
      { label: 'MX67 hardware', qty: 1, matcher: () => /^MX67(?:-HW)?$/ },
      { label: 'MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR?$`) },
    ]),
  },
  {
    name: 'implicit MX67 SEC companion is derived once',
    rows: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: 'MX67', qty: 1, tier: 'security' },
    ],
    sourceText: 'MX67 refresh with the listed renewal licences',
    check: (outcome) => successfulCaseChecks(outcome, [
      { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
      { label: 'MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR?$`) },
    ]),
  },
  {
    name: 'reported remove-companion path keeps blank MX67 on default SEC beside LIC-ENT',
    rows: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: 'MX67', qty: 1 },
    ],
    sourceText: 'quote 2 LIC-ENT-3YR, 1 MX67, and 1 LIC-MX67-SEC-3YR',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
        { label: 'MX67 hardware', qty: 1, matcher: () => /^MX67$/ },
        { label: 'default MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
      ]);
      if (outcome.serializedText !== '2 LIC-ENT-3YR\n1 MX67') {
        failures.push(`removed companion leaked tier intent: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      for (const term of PIPELINE_TERMS) {
        if (itemForTerm(outcome, term, /^LIC-MX67-ENT-/)) failures.push(`${term}Y literal LIC-ENT retiered blank MX67`);
      }
      return failures;
    },
  },
  {
    name: 'blank MX67 row retains the prior global Enterprise tier',
    rows: [{ sku: 'MX67', qty: 1 }],
    sourceText: 'quote 1 MX67 enterprise',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'MX67 hardware', qty: 1, matcher: () => /^MX67$/ },
        { label: 'MX67 ENT companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-ENT-${term}YR$`) },
      ]);
      if (outcome.serializedText !== '1 MX67\nenterprise') {
        failures.push(`global Enterprise was not preserved: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      if (outcome.rows?.[0]?.tier !== 'enterprise') failures.push('committed row did not retain Enterprise');
      for (const term of PIPELINE_TERMS) {
        if (itemForTerm(outcome, term, /^LIC-MX67-SEC-/)) failures.push(`${term}Y default SEC overrode global ENT`);
      }
      return failures;
    },
  },
  {
    name: 'blank MX67 row keeps default Security without a global tier',
    rows: [{ sku: 'MX67', qty: 1 }],
    sourceText: 'quote 1 MX67',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'MX67 hardware', qty: 1, matcher: () => /^MX67$/ },
        { label: 'MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
      ]);
      if (outcome.serializedText !== '1 MX67') {
        failures.push(`default-tier serializer changed: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      if (outcome.rows?.[0]?.tier) failures.push(`blank row gained unexpected tier ${outcome.rows[0].tier}`);
      for (const term of PIPELINE_TERMS) {
        if (itemForTerm(outcome, term, /^LIC-MX67-ENT-/)) failures.push(`${term}Y default SEC changed to ENT`);
      }
      return failures;
    },
  },
  {
    name: 'requested-term separate quotes suppress the automatic MX SEC companion',
    rows: [
      { sku: 'MX67', qty: 1, tier: 'security' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    sourceText: 'quote the listed products with 3 year licenses',
    workerInputText: 'quote 1 MX67 security and 1 LIC-MX67-SEC-3YR with 3 year licenses in separate quotes',
    stageLabel: 'worker-aggregate',
    check: (outcome) => {
      const failures = [];
      if (!/^1 MX67 security\n1 LIC-MX67-SEC-3YR\n3 year$/m.test(outcome.serializedText || '')) {
        failures.push(`serializer produced an unexpected committed snapshot: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      if (outcome.workerRequestedTerm !== 3) failures.push(`Worker requested term was ${outcome.workerRequestedTerm || 'unset'}, expected 3`);
      if (outcome.workerSeparateQuotes !== true) failures.push('Worker did not retain separateQuotes');
      if (outcome.workerComposition?.ok !== true) {
        failures.push(`Worker aggregate guard failed: ${(outcome.workerComposition?.failures || []).join('; ') || 'unknown failure'}`);
      }
      const separatedOptions = outcome.workerOptions || [];
      if (separatedOptions.length !== 2) {
        const rendered = separatedOptions.map((option) => (option.items || []).map((item) => `${item.qty}x${item.sku}`).join('+')).join(' | ');
        failures.push(`expected 2 separate URLs, got ${separatedOptions.length}${rendered ? ` (${rendered})` : ''}`);
      }
      const optionItems = separatedOptions.map((option) => option.items || []);
      const hardwareOptions = optionItems.filter((items) => items.some((item) => /^MX67(?:-HW)?$/.test(item.sku)));
      const licenseOptions = optionItems.filter((items) => items.some((item) => item.sku === 'LIC-MX67-SEC-3YR'));
      const hardwareQty = optionItems.flat().filter((item) => /^MX67(?:-HW)?$/.test(item.sku))
        .reduce((sum, item) => sum + item.qty, 0);
      const licenseQty = optionItems.flat().filter((item) => item.sku === 'LIC-MX67-SEC-3YR')
        .reduce((sum, item) => sum + item.qty, 0);
      if (hardwareOptions.length !== 1 || hardwareQty !== 1) failures.push(`MX67 appeared in ${hardwareOptions.length} option(s) at total qty ${hardwareQty}`);
      if (licenseOptions.length !== 1 || licenseQty !== 1) failures.push(`LIC-MX67-SEC-3YR appeared in ${licenseOptions.length} option(s) at total qty ${licenseQty}`);
      if (hardwareOptions.some((items) => items.some((item) => item.sku === 'LIC-MX67-SEC-3YR'))) {
        failures.push('automatic SEC companion leaked into the separate hardware URL');
      }
      return failures;
    },
  },
  {
    name: 'aggregate shared LIC-ENT exact coverage suppresses automatic copies',
    rows: [
      { sku: 'CW9164', qty: 6, tier: 'enterprise' },
      { sku: 'MR44', qty: 5, tier: 'enterprise' },
      { sku: 'LIC-ENT-3YR', qty: 11 },
    ],
    sourceText: 'quote the listed access points',
    check: (outcome) => successfulCaseChecks(outcome, [
      { label: 'aggregate LIC-ENT', qty: 11, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
    ]),
  },
  {
    name: 'aggregate shared LIC-ENT under-coverage blocks every link',
    rows: [
      { sku: 'CW9164', qty: 6, tier: 'enterprise' },
      { sku: 'MR44', qty: 5, tier: 'enterprise' },
      { sku: 'LIC-ENT-3YR', qty: 10 },
    ],
    sourceText: 'quote the listed access points',
    check: (outcome) => (!outcome.ok && outcome.options.length === 0
      && /quantity 10.+hardware quantity 11/i.test(outcome.error)
      ? [] : [`under-coverage did not fail closed: ${outcome.error || 'links were published'}`]),
  },
  {
    name: 'aggregate shared LIC-ENT over-coverage blocks every link',
    rows: [
      { sku: 'CW9164', qty: 6, tier: 'enterprise' },
      { sku: 'MR44', qty: 5, tier: 'enterprise' },
      { sku: 'LIC-ENT-3YR', qty: 12 },
    ],
    sourceText: 'quote the listed access points',
    check: (outcome) => (!outcome.ok && outcome.options.length === 0
      && /quantity 12.+hardware quantity 11/i.test(outcome.error)
      ? [] : [`over-coverage did not fail closed: ${outcome.error || 'links were published'}`]),
  },
  {
    name: 'affirmative warm-spare HA permits reviewed 2:1 MX coverage',
    rows: [
      { sku: 'MX67', qty: 2, tier: 'security' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    sourceText: 'Quote the MX67s with warm spare HA.',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'MX67 SEC HA companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR?$`) },
      ]);
      if (outcome.haRequested !== true || outcome.workerHaRequested !== true) {
        failures.push('affirmative HA was not preserved through both detectors');
      }
      return failures;
    },
  },
  {
    name: 'negated HA never authorizes 2:1 MX coverage',
    rows: [
      { sku: 'MX67', qty: 2, tier: 'security' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    sourceText: 'Do not enable HA on these firewalls.',
    check: (outcome) => (!outcome.ok && !outcome.haRequested && !outcome.workerHaRequested
      && outcome.options.length === 0 && /quantity 1.+hardware quantity 2/i.test(outcome.error)
      ? [] : [`negated HA did not fail closed: ${outcome.error || 'links were published'}`]),
  },
  {
    name: 'historical HA never authorizes the current 2:1 quote',
    rows: [
      { sku: 'MX67', qty: 2, tier: 'security' },
      { sku: 'LIC-MX67-SEC-3YR', qty: 1 },
    ],
    sourceText: 'Previously we used HA. Quote the current MX67 deployment as standard.',
    check: (outcome) => (!outcome.ok && !outcome.haRequested && !outcome.workerHaRequested
      && outcome.options.length === 0 && /quantity 1.+hardware quantity 2/i.test(outcome.error)
      ? [] : [`historical HA did not fail closed: ${outcome.error || 'links were published'}`]),
  },
  {
    name: 'row tiers stay isolated from an unrelated standalone ENT renewal',
    rows: [
      { sku: 'LIC-ENT-3YR', qty: 2 },
      { sku: 'MX67', qty: 1, tier: 'security' },
      { sku: 'MX75', qty: 1, tier: 'enterprise' },
    ],
    sourceText: 'quote the listed renewal and firewall refresh',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
        { label: 'MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR?$`) },
        { label: 'MX75 ENT companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX75-ENT-${term}YR?$`) },
      ]);
      for (const term of PIPELINE_TERMS) {
        if (itemForTerm(outcome, term, /^LIC-MX67-ENT-/)) failures.push(`${term}Y MX67 was globally overwritten to ENT`);
        if (itemForTerm(outcome, term, /^LIC-MX75-SEC-/)) failures.push(`${term}Y MX75 inherited SEC from another row`);
      }
      return failures;
    },
  },
  eolDirectLicenseCase('ENT', 'YR'),
  eolDirectLicenseCase('SEC', 'YR'),
  eolDirectLicenseCase('SDW', 'Y'),
  {
    name: 'malformed EOL MX64 tier fails closed without a default SEC refresh',
    rows: [{ sku: 'LIC-MX64-NOPE-3YR', qty: 1 }],
    sourceText: 'renew LIC-MX64-NOPE-3YR x1',
    workerParsedInput: {
      directLicenseList: [{ sku: 'LIC-MX64-NOPE-3YR', qty: 1 }],
      requestedTerm: null,
      requestedTier: null,
      modifiers: {},
    },
    stageLabel: 'worker-eol-fail-closed',
    check: (outcome) => {
      const failures = [];
      if (outcome.compositionBlocked !== true) failures.push('malformed tier was not composition-blocked');
      if ((outcome.workerOptions || []).length || (outcome.options || []).length) {
        failures.push('malformed tier published a quote URL');
      }
      if (!/does not contain a supported replacement license tier/i.test(outcome.error || '')) {
        failures.push(`missing supported-tier error: ${outcome.error || 'none'}`);
      }
      if (/LIC-MX67-SEC-|stratusinfosystems\.com\/order/i.test(outcome.error || '')) {
        failures.push('malformed tier silently published a default SEC refresh');
      }
      return failures;
    },
  },
  {
    name: 'paired MX64/MX64W EOL rows keep tiered explicit companions by occurrence',
    rows: [
      { sku: 'MX64', qty: 1, tier: 'enterprise' },
      { sku: 'LIC-MX64-ENT-3YR', qty: 1 },
      { sku: 'MX64W', qty: 2, tier: 'security' },
      { sku: 'LIC-MX64W-SEC-3YR', qty: 2 },
    ],
    sourceText: 'quote 1 MX64 enterprise and 1 LIC-MX64-ENT-3YR and 2 MX64W security and 2 LIC-MX64W-SEC-3YR',
    workerInputText: 'quote 1 MX64 enterprise and 1 LIC-MX64-ENT-3YR and 2 MX64W security and 2 LIC-MX64W-SEC-3YR',
    stageLabel: 'worker-occurrence-eol-pair',
    check: (outcome) => {
      const failures = [];
      if (outcome.compositionBlocked) failures.push(`paired EOL cart was blocked: ${outcome.error}`);
      const parsedRows = outcome.workerParsedRows || [];
      const parsedHardware = parsedRows.filter((row) => /^MX64W?$/.test(row.sku));
      if (JSON.stringify(parsedHardware) !== JSON.stringify([
        { sku: 'MX64', qty: 1, tier: 'ENT' },
        { sku: 'MX64W', qty: 2, tier: 'SEC' },
      ])) failures.push(`paired hardware parser rows changed: ${JSON.stringify(parsedHardware)}`);
      const parsedCompanions = parsedRows.filter((row) => /^LIC-MX64W?-(?:ENT|SEC)-3YR$/.test(row.sku));
      if (parsedCompanions.length !== 2
        || !parsedCompanions.some((row) => row.sku === 'LIC-MX64-ENT-3YR' && row.qty === 1)
        || !parsedCompanions.some((row) => row.sku === 'LIC-MX64W-SEC-3YR' && row.qty === 2)) {
        failures.push(`paired explicit companion parser rows changed: ${JSON.stringify(parsedCompanions)}`);
      }
      const rawOptions = outcome.workerOptions || [];
      const refreshOptions = rawOptions.filter((option) =>
        (option.items || []).some((item) => item.sku === 'MX67' || item.sku === 'MX67W'));
      const asIsOptions = rawOptions.filter((option) =>
        (option.items || []).some((item) => /^LIC-MX64W?-(?:ENT|SEC)-[135]YR$/.test(item.sku)));
      if (refreshOptions.length !== 3) failures.push(`expected 3 paired refresh URLs, got ${refreshOptions.length}`);
      if (asIsOptions.length !== 3) failures.push(`expected 3 paired as-is URLs, got ${asIsOptions.length}`);
      for (const term of PIPELINE_TERMS) {
        const refresh = pipelineOptionForTerm(refreshOptions, term);
        const asIs = pipelineOptionForTerm(asIsOptions, term);
        if (!refresh) failures.push(`${term}Y paired refresh URL is missing`);
        else {
          if (qtyInPipelineOption(refresh, /^MX67$/) !== 1) failures.push(`${term}Y MX67 quantity was not 1`);
          if (qtyInPipelineOption(refresh, /^MX67W$/) !== 2) failures.push(`${term}Y MX67W quantity was not 2`);
          if (qtyInPipelineOption(refresh, new RegExp(`^LIC-MX67-ENT-${term}YR$`)) !== 1) {
            failures.push(`${term}Y MX64 ENT replacement companion was not x1`);
          }
          if (qtyInPipelineOption(refresh, new RegExp(`^LIC-MX67W-SEC-${term}YR$`)) !== 2) {
            failures.push(`${term}Y MX64W SEC replacement companion was not x2`);
          }
          if ((refresh.items || []).some((item) => /^LIC-MX64W?-/.test(item.sku))) {
            failures.push(`${term}Y obsolete MX64 companion leaked into refresh`);
          }
        }
        if (!asIs) failures.push(`${term}Y paired as-is URL is missing`);
        else {
          if (qtyInPipelineOption(asIs, new RegExp(`^LIC-MX64-ENT-${term}YR$`)) !== 1) {
            failures.push(`${term}Y explicit MX64 ENT total was not exactly x1`);
          }
          if (qtyInPipelineOption(asIs, new RegExp(`^LIC-MX64W-SEC-${term}YR$`)) !== 2) {
            failures.push(`${term}Y explicit MX64W SEC total was not exactly x2`);
          }
        }
      }
      return failures;
    },
  },
  {
    name: 'repeated MX67 occurrences retain row-local SEC and ENT tiers',
    rows: [
      { sku: 'MX67', qty: 1, tier: 'security' },
      { sku: 'MX67', qty: 2, tier: 'enterprise' },
    ],
    sourceText: 'quote 1 MX67 security and 2 MX67 enterprise',
    workerInputText: 'quote 1 MX67 security and 2 MX67 enterprise',
    stageLabel: 'worker-occurrence-row-tier',
    check: (outcome) => {
      const failures = [];
      if (outcome.compositionBlocked) failures.push(`repeated MX67 cart was blocked: ${outcome.error}`);
      if (!/^1 MX67 security\n2 MX67 enterprise$/m.test(outcome.serializedText || '')) {
        failures.push(`serializer lost repeated row-local tiers: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      const parsedRows = (outcome.workerParsedRows || []).filter((row) => row.sku === 'MX67');
      if (JSON.stringify(parsedRows) !== JSON.stringify([
        { sku: 'MX67', qty: 1, tier: 'SEC' },
        { sku: 'MX67', qty: 2, tier: 'ENT' },
      ])) failures.push(`repeated parser rows changed: ${JSON.stringify(parsedRows)}`);
      const rawOptions = outcome.workerOptions || [];
      if (rawOptions.length !== 3) failures.push(`expected 3 repeated-row URLs, got ${rawOptions.length}`);
      for (const term of PIPELINE_TERMS) {
        const option = pipelineOptionForTerm(rawOptions, term);
        if (!option) {
          failures.push(`${term}Y repeated-row URL is missing`);
          continue;
        }
        if (qtyInPipelineOption(option, /^MX67$/) !== 3) failures.push(`${term}Y MX67 total was not x3`);
        if (qtyInPipelineOption(option, new RegExp(`^LIC-MX67-SEC-${term}YR$`)) !== 1) {
          failures.push(`${term}Y SEC occurrence was not x1`);
        }
        if (qtyInPipelineOption(option, new RegExp(`^LIC-MX67-ENT-${term}YR$`)) !== 2) {
          failures.push(`${term}Y ENT occurrence was not x2`);
        }
      }
      return failures;
    },
  },
  {
    name: 'repeated MX67 blank/default and ENT rows scope SEC to the blank quantity',
    rows: [
      { sku: 'MX67', qty: 1 },
      { sku: 'MX67', qty: 2, tier: 'enterprise' },
    ],
    sourceText: 'quote 1 MX67 and 2 MX67 enterprise',
    workerInputText: 'quote 1 MX67 and 2 MX67 enterprise',
    stageLabel: 'worker-occurrence-default-tier',
    check: (outcome) => {
      const failures = successfulCaseChecks(outcome, [
        { label: 'aggregate MX67 hardware', qty: 3, matcher: () => /^MX67$/ },
        { label: 'default MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
        { label: 'row-local MX67 ENT companion', qty: 2, matcher: (term) => new RegExp(`^LIC-MX67-ENT-${term}YR$`) },
      ]);
      if (outcome.serializedText !== '1 MX67\n2 MX67 enterprise') {
        failures.push(`serializer lost blank/default occurrence: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      const parsedRows = (outcome.workerParsedRows || []).filter((row) => row.sku === 'MX67');
      if (JSON.stringify(parsedRows) !== JSON.stringify([
        { sku: 'MX67', qty: 1, tier: '' },
        { sku: 'MX67', qty: 2, tier: 'ENT' },
      ])) failures.push(`default/ENT parser rows changed: ${JSON.stringify(parsedRows)}`);
      return failures;
    },
  },
  {
    name: 'legacy Z3 blank/default and ENT rows share the ENT-only family default',
    rows: [
      { sku: 'Z3', qty: 1 },
      { sku: 'Z3', qty: 2, tier: 'enterprise' },
    ],
    sourceText: 'quote 1 Z3 and 2 Z3 enterprise',
    workerInputText: 'quote 1 Z3 and 2 Z3 enterprise',
    stageLabel: 'worker-occurrence-z3-default',
    check: (outcome) => {
      const failures = [];
      if (outcome.serializedText !== '1 Z3\n2 Z3 enterprise') {
        failures.push(`serializer lost Z3 blank/default occurrence: ${JSON.stringify(outcome.serializedText || '')}`);
      }
      const parsedRows = (outcome.workerParsedRows || []).filter((row) => row.sku === 'Z3');
      if (JSON.stringify(parsedRows) !== JSON.stringify([
        { sku: 'Z3', qty: 1, tier: '' },
        { sku: 'Z3', qty: 2, tier: 'ENT' },
      ])) failures.push(`Z3 default/ENT parser rows changed: ${JSON.stringify(parsedRows)}`);
      if (outcome.compositionBlocked) failures.push(`Worker blocked the reviewed Z3 request: ${outcome.error}`);
      const rawOptions = outcome.workerOptions || [];
      const asIsOptions = rawOptions.filter((option) =>
        (option.items || []).some((item) => /^LIC-Z3-ENT-[135]YR$/.test(item.sku)));
      const refreshOptions = rawOptions.filter((option) =>
        (option.items || []).some((item) => item.sku === 'Z4-HW'));
      if (asIsOptions.length !== 3) failures.push(`expected 3 Z3 as-is URLs, got ${asIsOptions.length}`);
      if (refreshOptions.length !== 3) failures.push(`expected 3 Z4 refresh URLs, got ${refreshOptions.length}`);
      for (const term of PIPELINE_TERMS) {
        const asIs = pipelineOptionForTerm(asIsOptions, term);
        const refresh = pipelineOptionForTerm(refreshOptions, term);
        if (!asIs) failures.push(`${term}Y Z3 as-is URL is missing`);
        else {
          if (qtyInPipelineOption(asIs, new RegExp(`^LIC-Z3-ENT-${term}YR$`)) !== 3) {
            failures.push(`${term}Y Z3 ENT-only total was not x3`);
          }
          if ((asIs.items || []).some((item) => /^Z3(?:-HW)?(?:-NA)?$/.test(item.sku))) {
            failures.push(`${term}Y Z3 as-is alternative unexpectedly retained EOL hardware`);
          }
        }
        if (!refresh) failures.push(`${term}Y Z4 refresh URL is missing`);
        else {
          if (qtyInPipelineOption(refresh, /^Z4-HW$/) !== 3) failures.push(`${term}Y Z4-HW total was not x3`);
          if (qtyInPipelineOption(refresh, new RegExp(`^LIC-Z4-SEC-${term}Y$`)) !== 1) {
            failures.push(`${term}Y Z3 blank/default occurrence did not map to Z4 SEC x1`);
          }
          if (qtyInPipelineOption(refresh, new RegExp(`^LIC-Z4-ENT-${term}Y$`)) !== 2) {
            failures.push(`${term}Y explicit Z3 ENT occurrence did not map to Z4 ENT x2`);
          }
        }
      }
      if (outcome.ok || outcome.stage !== 'verify') failures.push('transformed Z3 alternatives did not fail the exact committed-row verifier');
      if (!/committed quantity for Z3/i.test(outcome.error || '')) {
        failures.push(`exact verifier returned an unexpected reason: ${outcome.error || 'none'}`);
      }
      if (outcome.publishedOptionCount !== 0) failures.push(`${outcome.publishedOptionCount} transformed Z3 URL(s) were published`);
      return failures;
    },
  },
  {
    name: 'MS150 overlapping scanner patterns publish only the longest source interval',
    rows: [{ sku: 'MS150-24P-4X', qty: 2 }],
    sourceText: 'quote 2 MS150-24P-4X hardware only',
    workerInputText: 'quote 2 MS150-24P-4X hardware only',
    stageLabel: 'worker-occurrence-overlap',
    check: (outcome) => {
      const failures = [];
      if (outcome.compositionBlocked) failures.push(`MS150 overlap cart was blocked: ${outcome.error}`);
      const parsedRows = outcome.workerParsedRows || [];
      if (JSON.stringify(parsedRows) !== JSON.stringify([
        { sku: 'MS150-24P-4X', qty: 2, tier: '' },
      ])) failures.push(`MS150 parser emitted overlapping rows: ${JSON.stringify(parsedRows)}`);
      const rawOptions = outcome.workerOptions || [];
      if (!rawOptions.length) failures.push('MS150 hardware-only URL was not published');
      for (const option of rawOptions) {
        if (qtyInPipelineOption(option, /^MS150-24P-4X$/) !== 2) failures.push('MS150-24P-4X quantity was not x2');
        const phantom = (option.items || []).find((item) => /^MS150-24P(?:-HW)?$/.test(item.sku));
        if (phantom) failures.push(`overlap scanner published phantom ${phantom.sku}`);
      }
      return failures;
    },
  },
];

function runActualPipelineMatrix() {
  return REAL_PIPELINE_CASES.map((testCase) => {
    const outcome = runActualQuotePipeline(testCase.rows, {
      sourceText: testCase.sourceText,
      workerInputText: testCase.workerInputText,
      workerParsedInput: testCase.workerParsedInput,
    });
    const failures = testCase.check(outcome);
    return {
      name: testCase.name,
      pass: failures.length === 0,
      detail: failures.join(' | '),
      stage: testCase.stageLabel || outcome.stage,
      text: outcome.text,
      haRequested: outcome.haRequested,
      options: outcome.options,
    };
  });
}

// ── Real Gmail intake -> extension review -> Worker -> verifier pipeline ───
//
// This crosses the same boundary as EmailQuoteIntakeCard. Literal cases must
// never invoke the LLM extractor and no request here performs a network or CRM
// action. The result is asynchronous because buildOneshotIntake is the actual
// Worker intake implementation.

function gmailIntakeInput(body) {
  return {
    source: 'ext-email-ecomm-intake',
    subject: 'Synthetic quote request',
    body_text: body,
    participants: [{ email: 'customer@example.com', name: 'Synthetic Customer', role: 'customer' }],
    messages: [{ index: 0, from_email: 'customer@example.com', body }],
  };
}

function intakeModifiers(intent) {
  if (intent?.hardware_only === true) return ['hardware only'];
  return ({ ENT: ['enterprise'], SEC: ['security'], SDW: ['SD-WAN'], A: ['advanced license'] })[
    String(intent?.license_tier || '').toUpperCase()
  ] || [];
}

async function runActualGmailIntakePipeline(body) {
  let extractorCalls = 0;
  let intake;
  try {
    intake = await workerBuildOneshotIntake(
      gmailIntakeInput(body),
      {},
      'sales@example.com',
      async () => {
        extractorCalls += 1;
        throw new Error('literal intake must not invoke the extractor');
      },
    );
  } catch (error) {
    return { ok: false, stage: 'intake', error: `Worker intake threw: ${error.message}`, extractorCalls, options: [], rawOptions: [] };
  }
  if (intake?.success !== true) {
    return {
      ok: false,
      stage: 'intake',
      error: String(intake?.detail || intake?.error || 'Worker intake failed.'),
      extractorCalls,
      intake,
      options: [],
      rawOptions: [],
    };
  }

  const lines = Array.isArray(intake.lines) ? intake.lines : [];
  const allResolved = lines.length > 0 && lines.every((line) => line.status === 'resolved');
  const normalized = normalizeQuoteIntakeLines(lines);
  if (!allResolved || !normalized.length) {
    return {
      ok: false,
      stage: 'intake',
      error: lines.map((line) => line.reason).filter(Boolean).join(' | ') || 'Intake rows need review.',
      extractorCalls,
      intake,
      allResolved,
      normalized,
      skuText: '',
      options: [],
      rawOptions: [],
      publishedOptionCount: 0,
    };
  }

  const intent = intake.intent || {};
  const skuText = [quoteSkuTextFromLines(lines), ...intakeModifiers(intent)].filter(Boolean).join('\n');
  let parsed;
  let built;
  try {
    parsed = workerParseMessage(skuText);
    built = workerBuildQuoteResponse(parsed);
  } catch (error) {
    return {
      ok: false,
      stage: 'worker',
      error: `Worker quote core threw after intake: ${error.message}`,
      extractorCalls,
      intake,
      allResolved,
      normalized,
      skuText,
      options: [],
      rawOptions: [],
      publishedOptionCount: 0,
    };
  }

  let candidates = workerOptionsFromMessage(built?.message);
  candidates = applyExplicitMxWarmSpareToQuoteOptions(candidates, intent.ha_requested === true);
  const verified = verifyStratusOrderUrlOptions(candidates, normalized, {
    licenseTier: intent.hardware_only === true ? null : intent.license_tier,
    allowHaLicenseRatio: intent.ha_requested === true,
    requireLicensedOption: intent.hardware_only !== true,
  });
  const decode = (option) => ({ ...option, items: decodePipelineOption(option) });
  return {
    ok: verified.ok,
    stage: verified.ok ? 'done' : (built?.compositionBlocked ? 'composition' : 'verify'),
    error: verified.error || String(built?.message || built?.errors?.join('; ') || ''),
    extractorCalls,
    intake,
    allResolved,
    normalized,
    skuText,
    parsed,
    built,
    rawOptions: candidates.map(decode),
    options: (verified.ok ? verified.urls : []).map(decode),
    publishedOptionCount: verified.urls.length,
  };
}

function intakeOptionForTerm(outcome, term) {
  return pipelineOptionForTerm(outcome?.options || [], term);
}

function intakeQty(outcome, term, matcher) {
  return qtyInPipelineOption(intakeOptionForTerm(outcome, term), matcher);
}

function successfulIntakeChecks(outcome, lineChecks = []) {
  const failures = [];
  if (!outcome.ok) failures.push(`${outcome.stage}: ${outcome.error}`);
  if (outcome.extractorCalls !== 0) failures.push(`literal intake invoked the extractor ${outcome.extractorCalls} time(s)`);
  const terms = (outcome.options || [])
    .map((option) => Number(option.termYears || optionTermFromUrl(option.url)))
    .filter(Boolean)
    .sort();
  if (outcome.ok && JSON.stringify(terms) !== JSON.stringify(PIPELINE_TERMS)) {
    failures.push(`expected verified 1/3/5-year intake options, got ${terms.join('/') || 'none'}`);
  }
  for (const check of lineChecks) {
    for (const term of PIPELINE_TERMS) {
      const qty = intakeQty(outcome, term, check.matcher(term));
      if (qty !== check.qty) failures.push(`${term}Y ${check.label} qty ${qty}, expected ${check.qty}`);
    }
  }
  return failures;
}

function proseTierIntakeCase(word, tier) {
  return {
    name: `Gmail prose ${word} remains a real MX tier`,
    body: `Please quote 2 LIC-ENT-3YR and 1 MX67 ${word}.`,
    check: (outcome) => {
      const failures = successfulIntakeChecks(outcome, [
        { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
        { label: `MX67 ${tier} companion`, qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-${tier}-${term}YR$`) },
      ]);
      if (outcome.intake?.intent?.license_tier !== tier) failures.push(`intake global tier was ${outcome.intake?.intent?.license_tier || 'unset'}`);
      for (const line of outcome.intake?.lines || []) {
        if (/^LIC-/.test(line.sku || '') && line.tier) failures.push(`${line.sku} received redundant tier ${line.tier}`);
      }
      return failures;
    },
  };
}

function mixedOccurrenceIntakeCase(firstTier, secondTier) {
  const first = firstTier === 'SEC' ? { word: 'security', qty: 1 } : { word: 'enterprise', qty: 2 };
  const second = secondTier === 'SEC' ? { word: 'security', qty: 1 } : { word: 'enterprise', qty: 2 };
  return {
    name: `Gmail same-SKU occurrences preserve ${firstTier} then ${secondTier}`,
    body: `Please quote ${first.qty} MX67 ${first.word} and ${second.qty} MX67 ${second.word}.`,
    preview: true,
    check: (outcome) => {
      const failures = successfulIntakeChecks(outcome, [
        { label: 'MX67 hardware', qty: 3, matcher: () => /^MX67$/ },
        { label: 'MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
        { label: 'MX67 ENT companion', qty: 2, matcher: (term) => new RegExp(`^LIC-MX67-ENT-${term}YR$`) },
      ]);
      const actual = (outcome.intake?.lines || []).map(({ sku, qty, tier, status }) => ({ sku, qty, tier, status }));
      const expected = [firstTier, secondTier].map((tier) => ({
        sku: 'MX67', qty: tier === 'SEC' ? 1 : 2, tier, status: 'resolved',
      }));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`intake occurrence rows changed: ${JSON.stringify(actual)}`);
      const expectedText = `${first.qty} MX67 ${first.word}\n${second.qty} MX67 ${second.word}`;
      if (outcome.skuText !== expectedText) failures.push(`review serializer changed: ${JSON.stringify(outcome.skuText || '')}`);
      return failures;
    },
  };
}

function explicitCompanionIntakeCase(firstTier, secondTier) {
  const skuFor = (tier) => `LIC-MX67-${tier}-3YR`;
  const qtyFor = (tier) => (tier === 'SEC' ? 1 : 2);
  return {
    name: `Gmail bare MX67 with explicit companions preserves ${firstTier} then ${secondTier}`,
    body: `Please quote 3 MX67, ${qtyFor(firstTier)} ${skuFor(firstTier)}, and ${qtyFor(secondTier)} ${skuFor(secondTier)}.`,
    check: (outcome) => {
      const failures = successfulIntakeChecks(outcome, [
        { label: 'MX67 hardware', qty: 3, matcher: () => /^MX67$/ },
        { label: 'explicit MX67 SEC total', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
        { label: 'explicit MX67 ENT total', qty: 2, matcher: (term) => new RegExp(`^LIC-MX67-ENT-${term}YR$`) },
      ]);
      const licenseLines = (outcome.intake?.lines || []).filter((line) => /^LIC-/.test(line.sku || ''));
      if (licenseLines.length !== 2 || licenseLines.some((line) => line.status !== 'resolved' || line.tier)) {
        failures.push(`explicit LIC rows were not resolved tier-free: ${JSON.stringify(licenseLines)}`);
      }
      if (/^\d+ LIC-[^\n]+\s(?:enterprise|security|SD-WAN|advanced)$/m.test(outcome.skuText || '')) {
        failures.push(`review serializer added a redundant tier: ${JSON.stringify(outcome.skuText)}`);
      }
      return failures;
    },
  };
}

const REAL_INTAKE_CASES = [
  {
    name: 'literal LIC-ENT never reties blank MX67 away from default SEC',
    body: 'Please quote 2 LIC-ENT-3YR and 1 MX67.',
    check: (outcome) => {
      const failures = successfulIntakeChecks(outcome, [
        { label: 'standalone LIC-ENT', qty: 2, matcher: (term) => new RegExp(`^LIC-ENT-${term}YR$`) },
        { label: 'MX67 hardware', qty: 1, matcher: () => /^MX67$/ },
        { label: 'default MX67 SEC companion', qty: 1, matcher: (term) => new RegExp(`^LIC-MX67-SEC-${term}YR$`) },
      ]);
      if (outcome.intake?.intent?.license_tier != null) failures.push(`literal LIC-ENT became global tier ${outcome.intake.intent.license_tier}`);
      if (outcome.skuText !== '2 LIC-ENT-3YR\n1 MX67') failures.push(`literal review text changed: ${JSON.stringify(outcome.skuText || '')}`);
      const lic = (outcome.intake?.lines || []).find((line) => line.sku === 'LIC-ENT-3YR');
      if (!lic || lic.status !== 'resolved' || lic.tier) failures.push(`explicit LIC-ENT row was not resolved tier-free: ${JSON.stringify(lic)}`);
      for (const term of PIPELINE_TERMS) {
        if (intakeQty(outcome, term, /^LIC-MX67-ENT-/)) failures.push(`${term}Y blank MX67 inherited literal ENT`);
      }
      return failures;
    },
  },
  proseTierIntakeCase('enterprise', 'ENT'),
  proseTierIntakeCase('security', 'SEC'),
  mixedOccurrenceIntakeCase('SEC', 'ENT'),
  mixedOccurrenceIntakeCase('ENT', 'SEC'),
  explicitCompanionIntakeCase('SEC', 'ENT'),
  explicitCompanionIntakeCase('ENT', 'SEC'),
  {
    name: 'Gmail multi-tier explicit companion under-total fails closed',
    body: 'Please quote 3 MX67, 1 LIC-MX67-SEC-3YR, and 1 LIC-MX67-ENT-3YR.',
    check: (outcome) => (!outcome.ok && outcome.publishedOptionCount === 0 && !(outcome.rawOptions || []).length
      && /does not cover|quantity|review|matching hardware/i.test(`${outcome.error} ${outcome.built?.message || ''}`)
      ? [] : [`under-total did not fail closed: ${outcome.error || 'URLs were published'}`]),
  },
  {
    name: 'Gmail multi-tier explicit companion over-total fails closed',
    body: 'Please quote 3 MX67, 2 LIC-MX67-SEC-3YR, and 2 LIC-MX67-ENT-3YR.',
    check: (outcome) => (!outcome.ok && outcome.publishedOptionCount === 0 && !(outcome.rawOptions || []).length
      && /does not cover|quantity|review|matching hardware/i.test(`${outcome.error} ${outcome.built?.message || ''}`)
      ? [] : [`over-total did not fail closed: ${outcome.error || 'URLs were published'}`]),
  },
  {
    name: 'Gmail mixed-term explicit companions stay review-blocked',
    body: 'Please quote 3 MX67, 1 LIC-MX67-SEC-1YR, and 2 LIC-MX67-ENT-3YR.',
    check: (outcome) => (!outcome.ok && outcome.stage === 'intake' && outcome.allResolved === false
      && outcome.publishedOptionCount === 0 && !(outcome.rawOptions || []).length
      && /different terms.*review/i.test(outcome.error || '')
      ? [] : [`mixed terms did not fail closed at intake: ${outcome.error || 'URLs were published'}`]),
  },
];

async function runActualIntakeMatrix() {
  const results = [];
  for (const testCase of REAL_INTAKE_CASES) {
    const outcome = await runActualGmailIntakePipeline(testCase.body);
    const failures = testCase.check(outcome);
    results.push({
      name: testCase.name,
      pass: failures.length === 0,
      detail: failures.join(' | '),
      stage: outcome.stage,
      lines: outcome.intake?.lines || [],
      preview: testCase.preview === true,
    });
  }
  return results;
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
  const [actualPipeline, setActualPipeline] = useState(null);
  const [intakePipeline, setIntakePipeline] = useState(null);
  const [intakeRunning, setIntakeRunning] = useState(false);
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

  function actualPipelineLoopTest() {
    const all = runActualPipelineMatrix();
    setActualPipeline(all);
    const failed = all.filter((resultRow) => !resultRow.pass);
    say(`actual quote pipeline: ${all.length - failed.length}/${all.length} passed`,
      failed.length ? 'assert-fail' : 'assert-pass');
    failed.forEach((failure) => say(`  FAIL ${failure.name} — ${failure.detail}`, 'assert-fail'));
  }

  async function actualIntakeLoopTest() {
    setIntakeRunning(true);
    try {
      const all = await runActualIntakeMatrix();
      setIntakePipeline(all);
      const failed = all.filter((resultRow) => !resultRow.pass);
      say(`actual Gmail intake pipeline: ${all.length - failed.length}/${all.length} passed`,
        failed.length ? 'assert-fail' : 'assert-pass');
      failed.forEach((failure) => say(`  FAIL ${failure.name} — ${failure.detail}`, 'assert-fail'));
    } catch (error) {
      setIntakePipeline([{
        name: 'matrix runner', pass: false, detail: error.message, stage: 'harness', lines: [],
      }]);
      say(`actual Gmail intake pipeline threw — ${error.message}`, 'assert-fail');
    } finally {
      setIntakeRunning(false);
    }
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

  const intakePreviewLines = intakePipeline?.find((resultRow) => resultRow.preview && resultRow.pass)?.lines || [];
  const restoredIntakePreviewLines = normalizeQuoteIntakeLines(intakePreviewLines);

  return (
    <div className="wrap">
      <div className="rail">
        <div className="card">
          <h2>Actual quote pipeline</h2>
          <p className="hint">
            Real editor serializer → Worker parser/builder → extension verifier.
            Split-quote cases use the Worker's aggregate endpoint guard.
            No network or CRM calls. Worker source: {HARNESS_WORKER_SOURCE_SHA256.slice(0, 12)}…
          </p>
          <button id="actual-pipeline-loop" className="scenario" onClick={actualPipelineLoopTest}
            style={{ borderColor: '#188038' }}>
            <strong>▶ Run actual pipeline ({REAL_PIPELINE_CASES.length} cases)</strong>
          </button>
        </div>

        {actualPipeline && (
          <div className="card">
            <h2>Actual pipeline results</h2>
            <div className="log" id="actual-pipeline-out" data-worker-sha256={HARNESS_WORKER_SOURCE_SHA256}>
              <div className={actualPipeline.every((resultRow) => resultRow.pass) ? 'assert-pass' : 'assert-fail'}>
                {actualPipeline.filter((resultRow) => resultRow.pass).length}/{actualPipeline.length} actual-pipeline cases passed
              </div>
              {actualPipeline.map((resultRow, index) => (
                <div key={index} className={resultRow.pass ? 'assert-pass' : 'assert-fail'}>
                  {resultRow.pass ? 'PASS' : 'FAIL'} — {resultRow.name} [{resultRow.stage}]
                  {!resultRow.pass && resultRow.detail ? ` — ${resultRow.detail}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <h2>Actual Gmail intake pipeline</h2>
          <p className="hint">
            Real Worker Gmail intake → extension line normalizer/serializer →
            Worker parser/builder → extension verifier. Literal inputs never use
            the extractor; no network or CRM calls are made.
          </p>
          <button id="actual-intake-loop" className="scenario" onClick={actualIntakeLoopTest}
            disabled={intakeRunning} style={{ borderColor: '#188038' }}>
            <strong>{intakeRunning ? 'Running…' : `▶ Run Gmail intake pipeline (${REAL_INTAKE_CASES.length} cases)`}</strong>
          </button>
        </div>

        {intakePipeline && (
          <div className="card">
            <h2>Gmail intake results</h2>
            <div className="log" id="actual-intake-out" data-worker-sha256={HARNESS_WORKER_SOURCE_SHA256}>
              <div className={intakePipeline.every((resultRow) => resultRow.pass) ? 'assert-pass' : 'assert-fail'}>
                {intakePipeline.filter((resultRow) => resultRow.pass).length}/{intakePipeline.length} Gmail-intake cases passed
              </div>
              {intakePipeline.map((resultRow, index) => (
                <div key={index} className={resultRow.pass ? 'assert-pass' : 'assert-fail'}>
                  {resultRow.pass ? 'PASS' : 'FAIL'} — {resultRow.name} [{resultRow.stage}]
                  {!resultRow.pass && resultRow.detail ? ` — ${resultRow.detail}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}

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
        {intakePreviewLines.length > 0 && (
          <div className="panel" style={{ marginBottom: 16 }} id="intake-card-tier-previews">
            <div className="panelhead">Gmail intake tier-label previews</div>
            <div id="fresh-intake-card-preview" style={{ padding: 10, borderRadius: 8, background: '#f8f9fa', marginBottom: 10, fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 5 }}>🛒 Fresh eCommerce quote intake</div>
              {intakePreviewLines.map((line, index) => (
                <div key={`${line.sku}-${line.tier || 'default'}-${index}`}>
                  <b>{line.sku || line.family}</b> × {line.qty}
                  {quoteIntakeTierLabel(line.tier) ? ` · ${quoteIntakeTierLabel(line.tier)}` : ''}
                </div>
              ))}
            </div>
            <div id="restored-intake-card-preview" style={{ padding: 10, borderRadius: 8, background: '#f8f9fa', fontSize: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 5 }}>Restored Gmail quote intake — review only</div>
              {restoredIntakePreviewLines.map((line, index) => (
                <div key={`${line.sku}-${line.tier || 'default'}-${index}`}>
                  {line.sku} × {line.qty}
                  {quoteIntakeTierLabel(line.tier) ? ` · ${quoteIntakeTierLabel(line.tier)}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}

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
  // Actual extension serializer -> actual Worker parser/builder -> actual
  // extension verifier. Safe and deterministic: no fetch and no CRM writes.
  actualQuotePipeline: runActualQuotePipeline,
  actualPipelineLoop: runActualPipelineMatrix,
  ACTUAL_PIPELINE_CASES: REAL_PIPELINE_CASES,
  actualGmailIntakePipeline: runActualGmailIntakePipeline,
  actualIntakeLoop: runActualIntakeMatrix,
  ACTUAL_INTAKE_CASES: REAL_INTAKE_CASES,
  workerSourceSha256: HARNESS_WORKER_SOURCE_SHA256,
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
