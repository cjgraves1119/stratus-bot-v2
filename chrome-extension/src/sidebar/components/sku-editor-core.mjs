import {
  normalizeEditableQuoteLines,
  normalizeQuoteIntakeLines,
} from '../../lib/email-quote-flow.mjs';
import { collapseSpokenPluralRows, dropSpokenPluralSuggestionRows } from '../../lib/nl-plural-sku.mjs';

const SAFE_SKU = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/;
const MAX_ROWS = 100;

// ── Synthetic agnostic-license placeholder (2026-08-18) ──
// quote-client.js's mapQuoteResponse()/mrOnlyResult() puts a display-only
// stand-in row into result.parsed for a term-agnostic "N MR licenses" line
// ("MR-ENT" when mixed with hardware, "LIC-ENT" when it's the whole quote)
// because a single real SKU doesn't exist yet -- there are 3 term options.
// Neither token is a real catalog SKU (the real worker's validateSku/
// parseMessage reject both), so editableRowsFromResult must not hand it to
// the editor as an ordinary freely-retypeable SKU cell: sending it back as
// "<qty> MR-ENT" text (the normal row-serialization order) fails the whole
// requote and forces the user to replace every row by hand, including the
// unrelated hardware row they never touched. Quantity edits on this row must
// stay possible without ever asking the user to reselect a concrete SKU.
const SYNTHETIC_AGNOSTIC_LICENSE_SKUS = new Set(['MR-ENT', 'MR_ENT', 'LIC-ENT', 'LIC_ENT']);

export function isSyntheticAgnosticSku(sku) {
  return SYNTHETIC_AGNOSTIC_LICENSE_SKUS.has(String(sku || '').trim().toUpperCase());
}

// Friendly, non-editable label for the synthetic row (mirrors quote-client.js's
// own parsedDisplaySku so the editor and the read-only Parsed Items list agree).
export function syntheticAgnosticSkuLabel() {
  return 'MR Enterprise (LIC-ENT)';
}

/** Translate a quote result into the controlled rows shown by the editor. */
export function editableRowsFromResult(result) {
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const unresolved = new Set(suggestions
    .map((suggestion) => String(suggestion?.input || '').trim().toUpperCase())
    .filter(Boolean));
  const rows = (Array.isArray(result?.parsed) ? result.parsed : []).map((item) => {
    const typedSku = String(item?.baseSku || item?.sku || '').trim().toUpperCase();
    // A license-only line resolves to a real licence SKU (LIC-MX67C-SEC-3YR)
    // even though the user typed the bare model (MX67C). Pre-fill the row with
    // the resolved SKU: re-quoting the bare model would silently re-add the
    // hardware, which is exactly why a quantity-only edit previously required
    // reselecting the full SKU by hand on every row. The typed model is kept on
    // the row so callers can still show what the user originally asked for.
    const resolvedSku = String(item?.resolvedSku || '').trim().toUpperCase();
    const sku = resolvedSku || typedSku;
    const rawTier = String(item?.tier || item?.requestedTier || '').trim().toUpperCase().replace(/[\s_-]+/g, '');
    const tier = sku.startsWith('LIC-')
      ? ''
      : (item?.hardwareOnly === true ? 'none' : ({
        ENT: 'enterprise', ENTERPRISE: 'enterprise',
        SEC: 'security', SECURITY: 'security', ADVANCEDSECURITY: 'security',
        SDW: 'sdwan', SDWAN: 'sdwan', SDWANPLUS: 'sdwan',
        A: 'advanced', ADV: 'advanced', ADVANCED: 'advanced', ADVANTAGE: 'advanced',
      })[rawTier] || '');
    const rawAvailability = String(item?.availability || '').trim().toLowerCase();
    const availability = ['ecomm', 'zoho_only'].includes(rawAvailability) ? rawAvailability : '';
    const productSource = String(item?.productSource || item?.product_source || '').trim();
    const licenseIntent = String(item?.licenseIntent || item?.license_intent || '').trim().toLowerCase();
    return {
      sku,
      qty: Number(item?.qty ?? item?.quantity) || 1,
      unresolved: unresolved.has(sku) || unresolved.has(typedSku),
      synthetic: isSyntheticAgnosticSku(sku),
      ...(tier ? { tier } : {}),
      ...(availability ? { availability } : {}),
      ...(productSource ? { productSource } : {}),
      ...(['paired', 'standalone'].includes(licenseIntent) ? { licenseIntent } : {}),
      ...(resolvedSku && resolvedSku !== typedSku ? { typedSku } : {}),
    };
  }).filter((row) => row.sku);

  for (const suggestion of suggestions) {
    const sku = String(suggestion?.input || '').trim().toUpperCase();
    if (!sku || rows.some((row) => row.sku === sku)) continue;
    rows.push({ sku, qty: Number(suggestion?.qty) || 1, unresolved: true });
  }
  // Exact hardware/license matches default to device-associated. A user can
  // still opt a license into Standalone renewal, but a normal generated quote
  // should not require a second confirmation before quantities can stay in
  // sync. This is metadata only; final SKU aggregation remains in the Worker.
  return withDefaultPairedLicenseIntents(
    collapseSpokenPluralRows(dropSpokenPluralSuggestionRows(rows)).slice(0, MAX_ROWS),
  );
}

/** The manual-first Create Quote card always starts with one usable blank row. */
export function blankQuoteEditorRows() {
  return [{ sku: '', qty: 1, unresolved: false }];
}

/** A deliberately separate row for an additive licence renewal. */
export function blankStandaloneRenewalRow() {
  return {
    sku: '',
    qty: 1,
    unresolved: false,
    licenseIntent: 'standalone',
    // Editor-only purpose. Normalization deliberately drops this field, but it
    // keeps a blank renewal row in the right section and prevents a hardware
    // result from silently changing the meaning of the dedicated add action.
    editorPurpose: 'standalone',
  };
}

/** True only after the rep has entered at least one SKU. Quantities alone do not count. */
export function quoteEditorHasSkuInput(rows) {
  return (Array.isArray(rows) ? rows : []).some((row) => String(row?.sku || '').trim() !== '');
}

/**
 * Convert the existing fail-closed Gmail intake result into the SAME controlled
 * rows used by manual entry. This is deliberately a presentation adapter: the
 * Gmail parser remains the authority for SKU/tier/quantity, while the user must
 * still press Generate quote before any links are built.
 */
export function quoteEditorRowsFromIntake(lines, intent = {}) {
  const normalized = normalizeQuoteIntakeLines(lines);
  if (!normalized.length) return [];
  const source = (Array.isArray(lines) ? lines : []).filter((line) => line?.status === 'resolved');
  const parsed = normalized.map((line) => {
    const matchingSource = source.filter((candidate) => (
      String(candidate?.sku || '').trim().toUpperCase() === line.sku
      && (!line.tier || String(candidate?.tier || '').trim().toUpperCase() === line.tier)
    ));
    const availability = matchingSource.some((candidate) => candidate?.availability === 'zoho_only')
      ? 'zoho_only'
      : (matchingSource.length > 0 && matchingSource.every((candidate) => candidate?.availability === 'ecomm')
        ? 'ecomm'
        : '');
    const productSource = matchingSource
      .map((candidate) => String(candidate?.productSource || candidate?.product_source || '').trim())
      .find(Boolean) || '';
    return {
      baseSku: line.sku,
      qty: line.qty,
      ...(line.tier ? { tier: line.tier } : {}),
      ...(availability ? { availability } : {}),
      ...(productSource ? { productSource } : {}),
      ...((intent?.hardware_only === true || matchingSource.some((candidate) => candidate?.hardwareOnly === true))
        ? { hardwareOnly: true }
        : {}),
    };
  });
  return editableRowsFromResult({ parsed });
}

/**
 * Row-level storefront routing evidence.
 *
 *   'ecomm'     exact active Product_Code proven on the eCommerce storefront
 *   'zoho_only' exact active Product proven absent from the storefront
 *   'unknown'   an active live Zoho product the rep selected or committed whose
 *               storefront classification has not been proven yet. The search
 *               source travels with it as evidence of that selection.
 *   ''          no proof at all: typed rows, restored rows, derived paired
 *               projections. The Worker still validates these on rebuild.
 *
 * A bare 'unknown' without a source is legacy typed-row state and means "no
 * proof", exactly like an absent value. Unknown is never promoted to either
 * proven state here; only a fresh exact search result may do that.
 */
export function rowAvailabilityState(row) {
  const availability = String(row?.availability || '').trim().toLowerCase();
  if (availability === 'ecomm' || availability === 'zoho_only') return availability;
  if (availability === 'unknown' && String(row?.productSource || '').trim()) return 'unknown';
  return '';
}

function mergeAvailabilityStates(a, b) {
  if (a === b) return a;
  // An unresolved selection blocks the whole merged row until it is retried.
  if (a === 'unknown' || b === 'unknown') return 'unknown';
  // One proof that the SKU is absent from the storefront routes it via Zoho.
  if (a === 'zoho_only' || b === 'zoho_only') return 'zoho_only';
  // eCommerce proof beside an unproven duplicate cannot claim eCommerce.
  return '';
}

/**
 * Fail-closed routing matrix for a cart:
 *   every row proven eCommerce (or unproven)  -> 'ecomm'     regular quote
 *   any row proven Zoho-only                  -> 'zoho_only' whole-cart Zoho review
 *   any selected row still unknown            -> 'blocked'   no link, no Zoho, no CRM
 * The Worker remains authoritative for the final SKU set; this only decides
 * which client action is allowed to start.
 */
export function quoteRouteForRows(rows) {
  const unknownSkus = [];
  const zohoOnlySkus = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku) continue;
    const state = rowAvailabilityState(row);
    if (state === 'unknown' && !unknownSkus.includes(sku)) unknownSkus.push(sku);
    else if (state === 'zoho_only' && !zohoOnlySkus.includes(sku)) zohoOnlySkus.push(sku);
  }
  const route = unknownSkus.length ? 'blocked' : (zohoOnlySkus.length ? 'zoho_only' : 'ecomm');
  return { route, unknownSkus, zohoOnlySkus };
}

/** Adapt the canonical strict line validator to the editor's `{ rows }` shape. */
export function normalizeSkuEditorRows(rows) {
  // Run the shared validator over the complete list first. Besides validating
  // each row, it enforces the 99,999 aggregate cap for an exact SKU even when
  // that SKU is intentionally split across multiple tier groups below.
  const validated = normalizeEditableQuoteLines(rows);
  if (!validated.ok) {
    return { ok: false, rows: [], error: validated.error, errors: validated.errors };
  }

  // A row's tier is quote intent, not display-only metadata. Merge duplicates
  // only when BOTH the canonical SKU and supported row-local intent match.
  // Merging by SKU alone turned MX67 SEC x1 + MX67 ENT x2 into MX67 SEC x3.
  // A stale tier on a literal LIC-* row is deliberately ignored because the
  // concrete licence SKU already binds its tier and the editor hides that
  // dropdown; this preserves the existing stale-state cleanup behavior.
  const grouped = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    const qty = Number(row?.qty);
    const tier = sku.startsWith('LIC-')
      ? ''
      : String(row?.tier || '').trim().toLowerCase();
    const licenseIntent = sku.startsWith('LIC-')
      ? String(row?.licenseIntent || '').trim().toLowerCase()
      : '';
    if (licenseIntent && !['paired', 'standalone'].includes(licenseIntent)) {
      const message = `${sku} has an invalid license-use choice.`;
      return { ok: false, rows: [], error: message, errors: [{ index: -1, code: 'invalid_license_intent', message }] };
    }
    // A paired and a standalone copy of the same catalogue license have
    // different commercial meaning. Keep them as distinct editable rows.
    const key = `${sku}\u0000${tier}\u0000${licenseIntent}`;
    const availability = rowAvailabilityState(row);
    const productSource = String(row?.productSource || '').trim();
    const existing = grouped.get(key);
    if (existing) {
      existing.qty += qty;
      // Conservative merge: an unresolved selection blocks the merged row; one
      // proof that a duplicate SKU is absent from the storefront routes the
      // combined row through Zoho; anything else can never claim eCommerce.
      const merged = mergeAvailabilityStates(rowAvailabilityState(existing), availability);
      if (merged) existing.availability = merged;
      else delete existing.availability;
      if (!existing.productSource && productSource) existing.productSource = productSource;
    } else {
      grouped.set(key, {
        sku,
        qty,
        ...(tier ? { tier } : {}),
        ...(licenseIntent ? { licenseIntent } : {}),
        ...(availability ? { availability } : {}),
        // The search source is the evidence behind an explicit unknown and is
        // kept for proven rows too so a rebuild can show where the proof came
        // from. It is metadata only; the Worker never receives it as a claim.
        ...(productSource ? { productSource } : {}),
        // A locally re-targeted projection stays marked so direct serialization
        // can refuse to publish it as if the Worker had derived it.
        ...(licenseIntent === 'paired' && row?.projectionPending === true ? { projectionPending: true } : {}),
      });
    }
  }

  // The same hardware SKU may intentionally be split into licensed and
  // hardware-only quantities (for example one production appliance plus one
  // spare). Keep those rows separate here; quoteTextFromEditorRows publishes a
  // quantity-scoped hardwareOnlyLines contract so verification never excludes
  // the whole SKU merely because one occurrence is bare.

  // Meraki licensing tiers are family-wide, not independently selectable per
  // device. MX and current Z4 appliances share one policy; MR and CW access
  // points share another; licensed switches share a third. Hardware-only rows
  // and legacy Z3 are intentionally excluded. This gate catches pasted or
  // restored mixed-tier state; normal dropdown edits are synchronized by
  // applyLinkedQuoteRowPatch() before they reach this validator.
  const familyConflict = quoteLicenseFamilyTierConflict([...grouped.values()]);
  if (familyConflict) {
    const message = `${familyConflict.label} cannot mix ${familyConflict.tiers.join(' and ')} licensing in one quote.`;
    return {
      ok: false,
      rows: [],
      error: message,
      errors: [{ index: -1, code: 'mixed_family_license_tier', message }],
    };
  }

  return {
    ok: true,
    rows: [...grouped.values()].map((line) => ({ ...line, unresolved: false })),
    error: '',
    errors: [],
  };
}

/**
 * Apply a catalog suggestion at the controlled-row boundary. `apply` replaces
 * every occurrence of the unresolved input while retaining quantities and all
 * unrelated rows; `stack` is the explicit add-another-item action.
 */
export function applySkuSuggestion(rows, suggestion, mode = 'apply', { allowHaLicenseRatio = false } = {}) {
  const current = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const input = String(suggestion?.input || '').trim().toUpperCase();
  const replacement = String(suggestion?.suggest?.[0] || '').trim().toUpperCase();
  if (!SAFE_SKU.test(replacement)) return current;

  if (mode === 'stack') {
    current.push({ sku: replacement, qty: Number(suggestion?.qty) || 1, unresolved: false });
    return current;
  }

  const warmSpareScopes = warmSpareCoverageKeys(licensePairReviewForRows(current, { allowHaLicenseRatio }));
  let replaced = false;
  const orphanCoverageKeys = new Set();
  const next = current.map((row) => {
    if (String(row?.sku || '').trim().toUpperCase() !== input) return row;
    replaced = true;
    const changedIdentity = input !== replacement;
    if (changedIdentity
        && (row?.editorPurpose === 'standalone' || row?.licenseIntent === 'standalone')
        && !replacement.startsWith('LIC-')
        && !isSyntheticAgnosticSku(replacement)) return row;
    const updated = { ...row, sku: replacement, unresolved: false };
    if (changedIdentity) {
      // A suggestion proves spelling only. Availability belongs to the old
      // identity and must never transfer to the replacement SKU.
      delete updated.availability;
      delete updated.productSource;
      delete updated.pairedSuspended;
      delete updated.projectionPending;
      delete updated.tierBeforeHardwareOnly;
      const previousPolicy = quoteLicensePolicyFamilyForSku(input);
      const nextPolicy = quoteLicensePolicyFamilyForSku(replacement);
      const selectedTier = String(updated?.tier || '').trim().toLowerCase();
      const supportedTier = licenseTierOptionsForSku(replacement).some((option) => option.value === selectedTier);
      if (replacement.startsWith('LIC-') || previousPolicy !== nextPolicy || !supportedTier) delete updated.tier;
      const previousCoverage = input.startsWith('LIC-') ? '' : quoteLicenseCoverageKeyForSku(input);
      const nextCoverage = replacement.startsWith('LIC-') ? '' : quoteLicenseCoverageKeyForSku(replacement);
      if (previousCoverage && previousCoverage !== nextCoverage) orphanCoverageKeys.add(previousCoverage);
      if (updated.licenseIntent === 'paired'
          && quoteLicenseCoverageKeyForSku(input) !== quoteLicenseCoverageKeyForSku(replacement)) {
        delete updated.licenseIntent;
      }
    }
    return updated;
  });
  if (!replaced) next.push({ sku: replacement, qty: Number(suggestion?.qty) || 1, unresolved: false });
  return reconcileLinkedQuoteRows(next, { allowHaLicenseRatio, warmSpareScopes, orphanCoverageKeys });
}

/**
 * The exact active product a search response proves for one SKU, reduced to
 * the routing evidence the editor stores. Anything a live Zoho row did not
 * classify stays 'unknown'; nothing here may promote it.
 */
export function exactProductSearchMatch(searchResponse, rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku || searchResponse?.ok !== true || !Array.isArray(searchResponse.results)) return null;
  const match = searchResponse.results.find((product) => (
    String(product?.sku || '').trim().toUpperCase() === sku && product?.active !== false
  ));
  if (!match) return null;
  const availability = String(match.availability || '').trim().toLowerCase();
  return {
    sku,
    availability: availability === 'ecomm' || availability === 'zoho_only' ? availability : 'unknown',
    source: String(match.source || '').trim() || 'zoho',
  };
}

/**
 * Commit the combobox draft for one row. Typing never reaches the reducer;
 * only this commit (Enter, leaving the field, or a picked result) changes the
 * canonical SKU, so a row cannot regroup or reorder mid-keystroke.
 *
 * A retyped identity drops the previous availability proof. If the current
 * search response proves the exact typed SKU, that proof (including a still
 * unknown storefront status) is adopted so manual exact entry is routed with
 * the same fail-closed rule as a picked result.
 */
export function commitQuoteEditorSkuDraft(rows, index, draftText, searchResponse = null, { allowHaLicenseRatio = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const sku = String(draftText || '').trim().toUpperCase();
  if (!list[index]) return { ok: false, changed: false, rows: list, sku, error: 'That row no longer exists.' };
  const standalonePurpose = list[index]?.editorPurpose === 'standalone';
  const preserveStandalone = standalonePurpose || list[index]?.licenseIntent === 'standalone';
  const current = String(list[index]?.sku || '').trim().toUpperCase();
  if (sku === '') {
    if (current === '') return { ok: true, changed: false, rows: list, sku };
    return {
      ok: true,
      changed: true,
      sku,
      rows: applyLinkedQuoteRowPatch(list, index, {
        sku: '', unresolved: false, availability: undefined, productSource: undefined,
      }, { allowHaLicenseRatio }),
    };
  }
  if (!SAFE_SKU.test(sku)) {
    return { ok: false, changed: false, rows: list, sku, error: 'Enter a valid 2-80 character SKU (letters, numbers, . _ / -).' };
  }
  if (preserveStandalone && !sku.startsWith('LIC-') && !isSyntheticAgnosticSku(sku)) {
    return {
      ok: false,
      changed: false,
      rows: list,
      sku,
      error: 'A standalone renewal must use a license SKU beginning with LIC-. Use Add product for hardware.',
    };
  }
  const exact = exactProductSearchMatch(searchResponse, sku);
  // Even a same-SKU retype is an explicit commit. Without proof from the
  // current search request it must fail closed instead of inheriting either a
  // restored no-proof state or an older SKU-bound availability decision.
  return {
    ok: true,
    changed: true,
    sku,
    exact,
    rows: applyLinkedQuoteRowPatch(list, index, {
      sku,
      unresolved: false,
      // A changed identity without current exact evidence is selected-but-
      // unclassified, not ordinary catalog input. Mark it synchronously so an
      // async lookup failure can never expose Generate against stale eCommerce
      // assumptions in the render between commit and the retry response.
      availability: exact ? exact.availability : 'unknown',
      productSource: exact ? exact.source : 'manual',
      ...(preserveStandalone ? { licenseIntent: 'standalone' } : {}),
    }, { allowHaLicenseRatio }),
  };
}

/** Apply a picked search result to a row; an unknown storefront status is kept, never guessed. */
export function selectQuoteEditorProduct(rows, index, product, { allowHaLicenseRatio = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const sku = String(product?.sku || '').trim().toUpperCase();
  if (!list[index] || !SAFE_SKU.test(sku)) return list;
  const preserveStandalone = list[index]?.editorPurpose === 'standalone'
    || list[index]?.licenseIntent === 'standalone';
  if (preserveStandalone && !sku.startsWith('LIC-') && !isSyntheticAgnosticSku(sku)) return list;
  const availability = String(product?.availability || '').trim().toLowerCase();
  return applyLinkedQuoteRowPatch(list, index, {
    sku,
    unresolved: false,
    availability: availability === 'ecomm' || availability === 'zoho_only' ? availability : 'unknown',
    productSource: String(product?.source || '').trim() || 'zoho',
    ...(preserveStandalone ? { licenseIntent: 'standalone' } : {}),
  }, { allowHaLicenseRatio });
}

/**
 * Resolve a row's storefront status from a fresh exact search. Only rows that
 * are unknown or carry no proof are candidates, located by SKU as well as
 * index so a late response cannot stamp a proof onto a row whose identity
 * changed while the check was in flight. A typed SKU that the exact search
 * finds as an active live product adopts its status, including a still
 * unknown one, so manual entry is routed with the same fail-closed rule.
 * Rows that already hold a proof, and SKUs the exact search does not know,
 * are left untouched for the Worker to validate.
 */
export function resolveRowAvailabilityFromSearch(rows, index, rawSku, searchResponse) {
  const list = Array.isArray(rows) ? rows : [];
  const sku = String(rawSku || '').trim().toUpperCase();
  const isTarget = (row) => String(row?.sku || '').trim().toUpperCase() === sku
    && ['unknown', ''].includes(rowAvailabilityState(row));
  const target = isTarget(list[index]) ? index : list.findIndex(isTarget);
  if (target < 0) return { changed: false, rows: list, availability: '', index: -1 };
  const previous = rowAvailabilityState(list[target]);
  const exact = exactProductSearchMatch(searchResponse, sku);
  if (!exact) return { changed: false, rows: list, availability: previous, index: target };
  const next = { ...list[target], availability: exact.availability, productSource: exact.source };
  if (rowAvailabilityState(next) === previous
      && String(next.productSource || '') === String(list[target]?.productSource || '')) {
    return { changed: false, rows: list, availability: previous, index: target };
  }
  return {
    changed: true,
    availability: exact.availability,
    index: target,
    rows: list.map((row, rowIndex) => (rowIndex === target ? next : { ...row })),
  };
}

/**
 * Selectable license tiers. `modifier` is the exact wording the WORKER's
 * parseMessage tier detection understands, so picking one here is identical to
 * the user having typed it:
 *   "enterprise"        -> /\bENT(ERPRISE)?\b/            -> ENT
 *   "security"          -> /\b(ADVANCED\s+SECURITY|SEC(URITY)?)\b/ -> SEC
 *   "advanced license"  -> hasMsAdvancedTierIntent()       -> A   (Catalyst/MS only)
 *   "SD-WAN"            -> /\b(SD[\s-]?WAN|SDW)\b/         -> SDW
 * `null` means "leave it alone", which keeps today's defaults exactly.
 */
export const LICENSE_TIER_OPTIONS = [
  { value: '', label: 'Default license tier', modifier: null },
  { value: 'enterprise', label: 'Enterprise (ENT)', modifier: 'enterprise' },
  { value: 'security', label: 'Advanced Security (SEC)', modifier: 'security' },
  // Deliberately the bare word. "advanced license" also matches the worker's
  // tier regex, but the trailing "LICENSE" makes assignClauseIntent read the
  // whole request as LICENSE-ONLY and silently drop the switch from the cart.
  { value: 'advanced', label: 'Advanced / Advantage (A)', modifier: 'advanced' },
  { value: 'sdwan', label: 'SD-WAN Plus (SDW)', modifier: 'SD-WAN' },
  // Per-line hardware-only. Lets one device be quoted bare while every other
  // line keeps its licence, which a request-level "hardware only" cannot express
  // (2026-08-19). Carries no tier modifier: it suppresses the licence instead.
  { value: 'none', label: 'None (hardware only)', modifier: null },
];

/** One quote-wide term selector; blank deliberately means the standard matrix. */
export const QUOTE_TERM_OPTIONS = [
  { value: '', label: 'All standard (1/3/5)' },
  { value: '1', label: '1 year' },
  { value: '3', label: '3 years' },
  { value: '5', label: '5 years' },
];

/** True when a row was set to the per-line "None (hardware only)" option. */
export function rowIsHardwareOnly(row) {
  return String(row?.tier || '').trim().toLowerCase() === 'none';
}

/** Hardware owns the paired-vs-bare choice; accessories and licenses do not. */
export function quoteEditorHardwareLicenseUse(row) {
  const sku = String(row?.sku || '').trim().toUpperCase();
  if (!sku || sku.startsWith('LIC-') || !quoteLicensePolicyFamilyForSku(sku)) return '';
  return rowIsHardwareOnly(row) ? 'hardware_only' : 'paired';
}

/**
 * Apply the hardware-owned licence-use control without losing an explicit tier.
 * The remembered tier is editor metadata and is dropped by normalization.
 */
export function applyQuoteEditorHardwareLicenseUse(rows, index, use, { allowHaLicenseRatio = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const row = list[index];
  if (!row || !quoteEditorHardwareLicenseUse(row)) return list.map((item) => ({ ...item }));
  if (use === 'hardware_only') {
    const tier = String(row?.tier || '').trim().toLowerCase();
    return applyLinkedQuoteRowPatch(list, index, {
      tier: 'none',
      tierBeforeHardwareOnly: tier && tier !== 'none' ? tier : (row?.tierBeforeHardwareOnly || ''),
    }, { allowHaLicenseRatio });
  }
  if (use === 'paired') {
    if (!rowIsHardwareOnly(row)) return list.map((item) => ({ ...item }));
    const policyFamily = quoteLicensePolicyFamilyForSku(row?.sku);
    const activeFamilyRows = list.filter((candidate, candidateIndex) => (
      candidateIndex !== index
      && !/^LIC-/i.test(String(candidate?.sku || ''))
      && !rowIsHardwareOnly(candidate)
      && quoteLicensePolicyFamilyForSku(candidate?.sku) === policyFamily
    ));
    // A row returning from hardware-only joins the family's CURRENT reviewed
    // edition. It must not roll active peers back to the tier remembered when
    // this row was first parked as bare hardware.
    const restore = activeFamilyRows.length
      ? String(activeFamilyRows[0]?.tier || '').trim().toLowerCase()
      : String(row?.tierBeforeHardwareOnly || '').trim().toLowerCase();
    return applyLinkedQuoteRowPatch(list, index, {
      tier: restore,
      tierBeforeHardwareOnly: undefined,
    }, { allowHaLicenseRatio });
  }
  return list.map((item) => ({ ...item }));
}

export function licenseTierModifier(value) {
  const found = LICENSE_TIER_OPTIONS.find((option) => option.value === String(value || ''));
  return found ? found.modifier : null;
}

/** Physical accessory rows do not own device licences or tier selectors. */
export function isLicenseExemptAccessorySku(rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku || sku.startsWith('LIC-')) return false;
  return /^(?:MA|PWR|GLC|SFP|QSFP|CAB)-/.test(sku)
    || /(?:^|-)(?:STA|STAK|STACK)-?KIT\d*(?:-|$)/.test(sku)
    || /(?:^|-)NM-[A-Z0-9-]+$/.test(sku);
}

/** Family used to decide which license-tier picks are valid on a row. */
export function licenseFamilyForSku(sku) {
  const s = String(sku || '').trim().toUpperCase();
  if (!s || s.startsWith('LIC-') || isSyntheticAgnosticSku(s)) return 'license';
  if (isLicenseExemptAccessorySku(s)) return 'unknown';
  if (/^MX/.test(s) || /^C(8111|8121|8455)/.test(s)) return 'mx';
  if (/^Z\d/.test(s)) return 'z';
  if (/^MR/.test(s)) return 'mr';
  if (/^CW/.test(s)) return 'cw';
  if (/^(MS130|MS150|MS390)/.test(s)) return 'ms';
  if (/^(C9\d{3}|C9200L|C9300)/.test(s)) return 'c9';
  return 'unknown';
}

/**
 * Quote-wide tier policy. This is intentionally broader than the concrete
 * catalogue license family: MX and current Z4 appliances must share one tier,
 * and different switch models must share Essentials/Advanced even though they
 * resolve to different license SKUs. Legacy Z3 remains outside the policy
 * because it cannot use the current Z4/MX tiers.
 */
export function quoteLicensePolicyFamilyForSku(rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku || isLicenseExemptAccessorySku(sku)) return '';
  if (sku.startsWith('LIC-')) {
    if (/^LIC-(?:MX\d|Z4C?(?:-|$)|C8\d{3})/.test(sku)) return 'security-appliances';
    if (/^LIC-(?:ENT(?:-|$)|MR-ADV(?:-|$))/.test(sku)) return 'access-points';
    if (/^LIC-(?:MS\d{3}|C9\d{3})/.test(sku)) return 'switches';
    return '';
  }
  const family = licenseFamilyForSku(sku);
  if (family === 'mx') return 'security-appliances';
  if (family === 'z') return /^Z4C?(?:-|$)/.test(sku) ? 'security-appliances' : '';
  if (family === 'mr') return 'access-points';
  if (family === 'cw') return /^CW(?!9800)\d/.test(sku) ? 'access-points' : '';
  if (family === 'ms' || family === 'c9') return 'switches';
  return '';
}

function quoteLicensePolicyLabel(family) {
  if (family === 'security-appliances') return 'Security appliances (MX + Z4)';
  if (family === 'access-points') return 'Access points (MR + CW)';
  if (family === 'switches') return 'Switches';
  return 'This product family';
}

/** Effective tier, including the catalog-backed default hidden by a blank row. */
export function effectiveQuoteLicenseFamilyTier(row) {
  const family = quoteLicensePolicyFamilyForSku(row?.sku);
  if (!family || rowIsHardwareOnly(row)) return '';
  const sku = String(row?.sku || '').trim().toUpperCase();
  if (sku.startsWith('LIC-')) return deviceLicenseTierFromSku(sku);
  const selected = String(row?.tier || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (family === 'security-appliances') {
    if (!selected || selected === 'security' || selected === 'sec' || selected === 'advancedsecurity') return 'security';
    if (selected === 'enterprise' || selected === 'ent') return 'enterprise';
    if (selected === 'sdwan' || selected === 'sdwanplus' || selected === 'sdw') return 'sdwan';
    return '';
  }
  if (family === 'access-points') {
    if (!selected || selected === 'enterprise' || selected === 'ent') return 'enterprise';
    if (selected === 'advanced' || selected === 'advantage' || selected === 'adv' || selected === 'a') return 'advanced';
    return '';
  }
  if (family === 'switches') {
    if (!selected || selected === 'standard' || selected === 'essentials' || selected === 'e') return 'standard';
    if (selected === 'advanced' || selected === 'advantage' || selected === 'adv' || selected === 'a') return 'advanced';
  }
  return '';
}

export function quoteLicenseFamilyTierConflict(rows) {
  const tiersByFamily = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    // The gate governs the per-device tier dropdowns: hardware in one policy
    // family must share an edition. Explicit licence rows stay outside it. A
    // paired projection may still name the old tier right after the linked
    // dropdown changes (rowsForLinkedQuoteRebuild drops it and the Worker
    // re-derives it); an undecided licence at the wrong tier is reported by the
    // pair review as a mismatch; and a standalone renewal is an additive
    // commercial line for devices already in the field, which the committed
    // contracts (MX Enterprise beside a standalone SEC renewal, Advanced APs
    // beside a standalone ENT renewal) publish rather than refuse.
    if (/^LIC-/i.test(String(row?.sku || ''))) continue;
    const family = quoteLicensePolicyFamilyForSku(row?.sku);
    const tier = effectiveQuoteLicenseFamilyTier(row);
    if (!family || !tier) continue;
    if (!tiersByFamily.has(family)) tiersByFamily.set(family, new Set());
    tiersByFamily.get(family).add(tier);
  }
  for (const [family, tiers] of tiersByFamily) {
    if (tiers.size > 1) return { family, label: quoteLicensePolicyLabel(family), tiers: [...tiers] };
  }
  return null;
}

/** Per-row dropdown options. Mixed carts can pick MX SEC and MR ADV together. */
/**
 * The tier the worker applies when a row is left on its default, named so the
 * rep can see it. "Default license tier" hid the actual choice: an MX quietly
 * gets Advanced Security and an MR gets Enterprise, and nothing on screen said
 * so (2026-08-19). Mirrors the worker's per-family defaults in getLicenseSkus.
 */
export function defaultLicenseTierLabelForSku(sku) {
  const normalized = String(sku || '').trim().toUpperCase();
  if (/^Z(?:1|3)C?(?:X)?(?:-|$)/.test(normalized)) return 'Enterprise (ENT) · only';
  switch (licenseFamilyForSku(sku)) {
    case 'mx':
    case 'z':
      return 'Advanced Security (SEC) · default';
    case 'mr':
    case 'cw':
      return 'Enterprise (ENT) · default';
    case 'ms':
    case 'c9':
      return 'Standard · default';
    default:
      return 'Default license tier';
  }
}

export function licenseTierOptionsForSku(sku) {
  const byValue = Object.fromEntries(LICENSE_TIER_OPTIONS.map((option) => [option.value, option]));
  const pick = (...values) => [byValue[''], ...values.map((value) => byValue[value]).filter(Boolean)];
  switch (licenseFamilyForSku(sku)) {
    case 'mx':
      return pick('enterprise', 'security', 'sdwan', 'none');
    case 'z': {
      const normalized = String(sku || '').trim().toUpperCase();
      if (/^Z(?:1|3)C?(?:X)?(?:-|$)/.test(normalized)) return pick('enterprise', 'none');
      return pick('enterprise', 'security', 'none');
    }
    case 'mr':
      return pick('enterprise', 'advanced', 'none');
    case 'cw':
      // Every CW access point uses the shared Meraki co-term AP licensing
      // family: Enterprise by default, with MR Advanced available explicitly.
      // CW9800 is a controller rather than an access point and stays outside.
      return /^CW(?!9800)\d/i.test(String(sku || '').trim())
        ? pick('enterprise', 'advanced', 'none')
        : [byValue['']];
    case 'ms':
    case 'c9':
      return pick('advanced', 'none');
    default:
      return [byValue['']];
  }
}

// Map a tier the worker already resolved back onto a dropdown value, so the
// control opens showing what the current quote actually used.
export function licenseTierValueFromMode(tier) {
  switch (String(tier || '')) {
    case 'enterprise': return 'enterprise';
    case 'security': return 'security';
    case 'advanced':
    case 'advanced license': return 'advanced';
    case 'SD-WAN': return 'sdwan';
    default: return '';
  }
}

/**
 * Concrete tier encoded by a device-specific licence SKU.
 *
 * This is intentionally stricter than the Worker's general SKU parsing.
 * Shared AP licenses are identified by their exact catalog family and are
 * reviewed against the aggregate eligible AP quantity, never one arbitrarily
 * chosen model row. Device-specific MX and Catalyst 9K licences remain
 * reviewable; legacy Z models stay outside this contract because their
 * blank-tier defaults differ.
 */
export function deviceLicenseTierFromSku(sku) {
  const value = String(sku || '').trim().toUpperCase();
  if (!value.startsWith('LIC-')) return '';
  if (/^LIC-ENT-(?:10|[1357])YR$/.test(value)) return 'enterprise';
  if (/^LIC-MR-ADV-(?:10|[1357])Y$/.test(value)) return 'advanced';
  const catalyst = value.match(/^LIC-C9\d{3}L?-\d+(A|E)-\d+Y$/);
  if (catalyst) return catalyst[1] === 'A' ? 'advanced' : 'standard';
  const merakiSwitch = value.match(/^LIC-(?:MS130|MS150)-(?:CMPT(A)?|\d+(A)?)-\d+Y$/);
  if (merakiSwitch) return merakiSwitch[1] || merakiSwitch[2] ? 'advanced' : 'standard';
  const ms390 = value.match(/^LIC-MS390-\d+(A|E)-\d+Y$/);
  if (ms390) return ms390[1] === 'A' ? 'advanced' : 'standard';
  const segments = value.slice(4).split('-').filter(Boolean);
  if (segments.includes('ENT') || segments.includes('ENTERPRISE')) return 'enterprise';
  if (segments.includes('SEC') || segments.includes('SECURITY')) return 'security';
  if (segments.includes('SDW') || segments.includes('SDWAN')) return 'sdwan';
  return '';
}

/**
 * The catalog licence a paired PROJECTION should show once its hardware moves
 * to another edition, keeping the projection's own term. This mirrors the
 * families deviceLicenseTierFromSku() already understands and nothing more:
 * shared AP (LIC-ENT-*YR <-> LIC-MR-ADV-*Y), Catalyst/MS390 (E <-> A), MS130/
 * MS150 (bare/CMPT <-> A/CMPTA) and MX/Z4/C8 appliances (ENT/SEC/SDW).
 *
 * It is a review view only. rowsForLinkedQuoteRebuild() still strips every
 * projection so the Worker derives and aggregates the final licence line; an
 * unrecognised shape returns '' and the projection is merely flagged pending.
 */
export function pairedLicenseSkuForTier(rawSku, tier) {
  const sku = String(rawSku || '').trim().toUpperCase();
  const edition = String(tier || '').trim().toLowerCase();
  let match = sku.match(/^LIC-ENT-(10|[1357])YR$/) || sku.match(/^LIC-MR-ADV-(10|[1357])Y$/);
  if (match) {
    if (edition === 'enterprise') return `LIC-ENT-${match[1]}YR`;
    if (edition === 'advanced') return `LIC-MR-ADV-${match[1]}Y`;
    return '';
  }
  match = sku.match(/^(LIC-(?:C9\d{3}L?|MS390)-\d+)(A|E)(-\d+Y)$/);
  if (match) {
    if (edition === 'advanced') return `${match[1]}A${match[3]}`;
    if (edition === 'standard') return `${match[1]}E${match[3]}`;
    return '';
  }
  match = sku.match(/^(LIC-(?:MS130|MS150)-(?:CMPT|\d+))(A?)(-\d+Y)$/);
  if (match) {
    if (edition === 'advanced') return `${match[1]}A${match[3]}`;
    if (edition === 'standard') return `${match[1]}${match[3]}`;
    return '';
  }
  match = sku.match(/^(LIC-(?:MX\d+(?:CW?|W)?|Z4C?|C(?:8111|8121|8455))-)(?:ENT|SEC|SDW)(-(?:10|[1357])YR?)$/);
  if (match) {
    const token = { enterprise: 'ENT', security: 'SEC', sdwan: 'SDW' }[edition];
    return token ? `${match[1]}${token}${match[2]}` : '';
  }
  return '';
}

/** Effective reviewed tier for hardware whose concrete licence can be paired. */
export function effectivePairableHardwareTier(row) {
  const family = licenseFamilyForSku(row?.sku);
  const selected = String(row?.tier || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  const sharedAp = family === 'mr'
    || (family === 'cw' && /^CW(?!9800)\d/i.test(String(row?.sku || '').trim()));
  if (sharedAp) {
    if (!selected || selected === 'enterprise' || selected === 'ent') return 'enterprise';
    if (selected === 'advanced' || selected === 'advantage' || selected === 'adv' || selected === 'a') return 'advanced';
    return '';
  }
  if (family === 'c9') {
    if (!selected || selected === 'standard' || selected === 'essentials' || selected === 'e') return 'standard';
    if (selected === 'advanced' || selected === 'advantage' || selected === 'adv' || selected === 'a') return 'advanced';
    return '';
  }
  if (family === 'ms') {
    if (!selected || selected === 'standard' || selected === 'essentials' || selected === 'e') return 'standard';
    if (selected === 'advanced' || selected === 'advantage' || selected === 'adv' || selected === 'a') return 'advanced';
    return '';
  }
  const currentZ = family === 'z' && /^Z4C?(?:-|$)/i.test(String(row?.sku || '').trim());
  if (family !== 'mx' && !currentZ) return '';
  if (!selected) return 'security';
  if (selected === 'enterprise' || selected === 'ent') return 'enterprise';
  if (selected === 'security' || selected === 'sec' || selected === 'advancedsecurity') return 'security';
  if (selected === 'sdwan' || selected === 'sdwanplus' || selected === 'sdw') return 'sdwan';
  return '';
}

function reviewQuantity(row) {
  const raw = typeof row?.qty === 'number' ? String(row.qty) : String(row?.qty ?? '').trim();
  if (!/^\d{1,5}$/.test(raw)) return null;
  const qty = Number(raw);
  return Number.isInteger(qty) && qty > 0 && qty <= 99999 ? qty : null;
}

function uniqueReviewSkus(rows, indexes) {
  return [...new Set(indexes
    .map((index) => String(rows[index]?.sku || '').trim().toUpperCase())
    .filter(Boolean))];
}

/**
 * Catalog license-coverage identity used only by the editor's review layer.
 *
 * This mirrors the Worker's already-authoritative relationship mapping without
 * aggregating or emitting a final quote line. Several hardware variants share
 * one license product (for example MS130-24/24P and C9300X-12Y/C9300L-24), so
 * model-token equality is not sufficient for quantity synchronization.
 */
export function quoteLicenseCoverageKeyForSku(rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku) return '';

  if (/^LIC-(?:ENT-(?:10|[1357])YR|MR-ADV-(?:10|[1357])Y)$/.test(sku)) return 'AP:SHARED';
  if (/^(?:MR\d|CW(?!9800)\d)/.test(sku)) return 'AP:SHARED';

  if (/^LIC-MS130-CMPTA?-\d+Y$/.test(sku)) return 'MS130:CMPT';
  if (/^MS130R-/.test(sku) || /^MS130-(?:8|12)/.test(sku)) return 'MS130:CMPT';

  let match = sku.match(/^LIC-(MS130|MS150)-(\d+)(?:A)?-\d+Y$/);
  if (match) return `${match[1]}:${match[2]}`;
  match = sku.match(/^(MS130|MS150)-(24|48)/);
  if (match) return `${match[1]}:${match[2]}`;

  match = sku.match(/^LIC-MS390-(\d+)(?:A|E)-\d+Y$/);
  if (match) return `MS390:${match[1]}`;
  match = sku.match(/^MS390-(\d+)/);
  if (match) return `MS390:${match[1]}`;

  match = sku.match(/^LIC-(C9\d{3}L?)-(\d+)(?:A|E)-\d+Y$/);
  if (match) {
    const family = ['C9300X', 'C9300L'].includes(match[1]) ? 'C9300' : match[1];
    const ports = match[2] === '12' ? '24' : match[2];
    return `${family}:${ports}`;
  }
  match = sku.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (match) {
    const family = ['C9300X', 'C9300L'].includes(match[1]) ? 'C9300' : match[1];
    const ports = match[2] === '12' ? '24' : match[2];
    return `${family}:${ports}`;
  }

  match = sku.match(/^LIC-(MX\d+(?:CW?|W)?|Z4C?|C(?:8111|8121|8455))-(?:ENT|SEC|SDW)-(?:10|[1357])YR?$/);
  if (match) return `APPLIANCE:${match[1]}`;
  match = sku.match(/^(MX\d+(?:CW?|W)?|Z4C?|C(?:8111|8121|8455))(?:-(?:NA|HW|M))?$/);
  if (match) return `APPLIANCE:${match[1]}`;

  return '';
}

/**
 * Derive read-only hardware/licence pairing annotations from the CURRENT rows.
 * No flag is persisted on a row, so changing a SKU, quantity, or tier always
 * recomputes the review and stale "paired" state cannot survive an edit.
 *
 * Pairing is conservative:
 * - MX and Catalyst 9K device-specific licences participate;
 * - shared LIC-ENT / LIC-MR-ADV rows pair only with the aggregate quantity of
 *   MR and CW access-point hardware at the matching tier;
 * - device identity and effective tier must match;
 * - duplicate rows aggregate, but multiple distinct licence products (for
 *   example mixed 1YR and 3YR terms) are a mismatch rather than one pair;
 * - exact aggregate quantities are paired; same-scope differences are marked
 *   as mismatches; unrelated or different-tier licences remain unpaired.
 */
export function licensePairReviewForRows(rows, { allowHaLicenseRatio = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const review = list.map(() => ({ kind: 'none' }));
  const hardwareGroups = [];
  const unmatchedLicenseIndexes = new Set();
  // Coverage keys of rows the rep set to "None (hardware only)". A paired
  // projection whose every covered device is bare is suspended, not orphaned:
  // it must stay visible so restoring the tier can restore its quantity.
  const bareCoverageKeys = new Set();

  list.forEach((row, index) => {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku || sku.startsWith('LIC-')) return;
    const coverageKey = quoteLicenseCoverageKeyForSku(sku);
    if (!coverageKey) return;
    if (rowIsHardwareOnly(row)) {
      bareCoverageKeys.add(coverageKey);
      return;
    }
    const tier = effectivePairableHardwareTier(row);
    if (!tier) return;
    let group = hardwareGroups.find((candidate) => (
      candidate.tier === tier
      && candidate.coverageKey === coverageKey
    ));
    if (!group) {
      group = { anchorSku: sku, tier, coverageKey, hardwareIndexes: [], licenseIndexes: [], standaloneIndexes: [] };
      hardwareGroups.push(group);
    }
    group.hardwareIndexes.push(index);
  });

  list.forEach((row, index) => {
    const sku = String(row?.sku || '').trim().toUpperCase();
    const tier = deviceLicenseTierFromSku(sku);
    if (!tier) return;
    const coverageKey = quoteLicenseCoverageKeyForSku(sku);
    if (row?.licenseIntent === 'standalone') {
      // A standalone renewal never joins the paired quantity, but the hardware
      // it also covers is still annotated so the rep can see the additive total.
      const covered = coverageKey
        ? hardwareGroups.find((candidate) => candidate.coverageKey === coverageKey && candidate.tier === tier)
        : null;
      if (covered) covered.standaloneIndexes.push(index);
      review[index] = {
        kind: 'standalone',
        role: 'license',
        licenseQty: reviewQuantity(row),
        licenseSkus: uniqueReviewSkus(list, [index]),
        tier,
        ...(coverageKey ? { coverageKey } : {}),
        ...(covered ? {
          hardwareIndexes: [...covered.hardwareIndexes],
          hardwareSkus: uniqueReviewSkus(list, covered.hardwareIndexes),
        } : {}),
      };
      return;
    }
    if (!coverageKey) return;
    const identityMatches = hardwareGroups.filter((candidate) => candidate.coverageKey === coverageKey);
    const matches = identityMatches.filter((candidate) => candidate.tier === tier);
    if (matches.length === 1) matches[0].licenseIndexes.push(index);
    else if (identityMatches.length > 0 && row?.licenseIntent === 'paired' && row?.projectionPending === true) {
      // A projection the reducer could not re-target after a tier change is
      // not a rep error to correct: it is waiting for the Worker rebuild that
      // derives the licence at the new edition. Keep it visible and inert.
      review[index] = {
        kind: 'pending',
        role: 'license',
        licenseQty: reviewQuantity(row),
        licenseSkus: uniqueReviewSkus(list, [index]),
        tier,
        coverageKey,
      };
    }
    else if (identityMatches.length > 0) unmatchedLicenseIndexes.add(index);
    else if (row?.licenseIntent === 'paired' && bareCoverageKeys.has(coverageKey)) {
      review[index] = {
        kind: 'suspended',
        role: 'license',
        licenseQty: reviewQuantity(row),
        licenseSkus: uniqueReviewSkus(list, [index]),
        tier,
        coverageKey,
      };
    }
  });

  for (const group of hardwareGroups) {
    if (!group.licenseIndexes.length) {
      if (!group.standaloneIndexes.length) continue;
      const hardwareQuantities = group.hardwareIndexes.map((index) => reviewQuantity(list[index]));
      const standaloneQuantities = group.standaloneIndexes.map((index) => reviewQuantity(list[index]));
      const standaloneCommon = {
        kind: 'standalone',
        role: 'hardware',
        hardwareQty: hardwareQuantities.every(Number.isInteger)
          ? hardwareQuantities.reduce((sum, qty) => sum + qty, 0)
          : null,
        licenseQty: standaloneQuantities.every(Number.isInteger)
          ? standaloneQuantities.reduce((sum, qty) => sum + qty, 0)
          : null,
        hardwareSkus: uniqueReviewSkus(list, group.hardwareIndexes),
        licenseSkus: uniqueReviewSkus(list, group.standaloneIndexes),
        hardwareIndexes: [...group.hardwareIndexes],
        licenseIndexes: [],
        standaloneIndexes: [...group.standaloneIndexes],
        tier: group.tier,
        coverageKey: group.coverageKey,
      };
      group.hardwareIndexes.forEach((index) => { review[index] = { ...standaloneCommon }; });
      continue;
    }
    const hardwareQuantities = group.hardwareIndexes.map((index) => reviewQuantity(list[index]));
    const licenseQuantities = group.licenseIndexes.map((index) => reviewQuantity(list[index]));
    const hardwareQty = hardwareQuantities.every(Number.isInteger)
      ? hardwareQuantities.reduce((sum, qty) => sum + qty, 0)
      : null;
    const licenseQty = licenseQuantities.every(Number.isInteger)
      ? licenseQuantities.reduce((sum, qty) => sum + qty, 0)
      : null;
    const hardwareSkus = uniqueReviewSkus(list, group.hardwareIndexes);
    const licenseSkus = uniqueReviewSkus(list, group.licenseIndexes);
    const contributionTotals = new Map();
    for (const hardwareIndex of group.hardwareIndexes) {
      const contributionSku = String(list[hardwareIndex]?.sku || '').trim().toUpperCase();
      const contributionQty = reviewQuantity(list[hardwareIndex]);
      if (!contributionSku || contributionQty === null) continue;
      contributionTotals.set(contributionSku, (contributionTotals.get(contributionSku) || 0) + contributionQty);
    }
    const hardwareContributions = [...contributionTotals.entries()].map(([sku, qty]) => ({ sku, qty }));
    const exactProduct = licenseSkus.length === 1;
    const exactPair = exactProduct && hardwareQty !== null && licenseQty !== null && hardwareQty === licenseQty;
    const warmSparePair = allowHaLicenseRatio === true
      && exactProduct
      && hardwareQty !== null
      && licenseQty !== null
      && hardwareQty === licenseQty * 2;
    const pairedIntent = group.licenseIndexes.every((index) => list[index]?.licenseIntent === 'paired');
    const kind = (exactPair || warmSparePair)
      ? (pairedIntent ? 'paired' : 'needs_review')
      : 'mismatch';
    const common = {
      kind,
      hardwareQty,
      licenseQty,
      hardwareSkus,
      licenseSkus,
      hardwareIndexes: [...group.hardwareIndexes],
      licenseIndexes: [...group.licenseIndexes],
      ...(group.standaloneIndexes.length ? { standaloneIndexes: [...group.standaloneIndexes] } : {}),
      hardwareContributions,
      tier: group.tier,
      coverageKey: group.coverageKey,
      ...(warmSparePair ? { warmSpare: true } : {}),
    };
    group.hardwareIndexes.forEach((index) => { review[index] = { ...common, role: 'hardware' }; });
    group.licenseIndexes.forEach((index) => { review[index] = { ...common, role: 'license' }; });
  }

  // A license that targets hardware in this cart but disagrees on tier must
  // never disappear into `{ kind: 'none' }`. That would hide the license-use
  // control and let the Worker derive the selected hardware tier while also
  // retaining the pasted license as an unintended extra. Keep the hardware's
  // existing review intact and fail closed on the mismatched license row.
  unmatchedLicenseIndexes.forEach((index) => {
    review[index] = {
      kind: 'mismatch',
      role: 'license',
      licenseQty: reviewQuantity(list[index]),
      licenseSkus: uniqueReviewSkus(list, [index]),
      tier: deviceLicenseTierFromSku(list[index]?.sku),
    };
  });

  return review;
}

/**
 * Exact matching licenses are device-associated by default. The opt-out is an
 * explicit Standalone renewal selection; ambiguous products/quantities remain
 * unresolved and continue to fail closed.
 */
export function withDefaultPairedLicenseIntents(rows, { allowHaLicenseRatio = false } = {}) {
  return consolidatePairedLicenseProjections(defaultPairedLicenseIntents(rows, { allowHaLicenseRatio }));
}

function defaultPairedLicenseIntents(rows, { allowHaLicenseRatio = false } = {}) {
  const list = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const review = licensePairReviewForRows(list, { allowHaLicenseRatio });
  return list.map((row, index) => (
    review[index]?.role === 'license'
      && review[index]?.kind === 'needs_review'
      && row?.licenseIntent !== 'standalone'
      ? { ...row, licenseIntent: 'paired' }
      : row
  ));
}

function isPairedLicenseProjection(row) {
  return /^LIC-/i.test(String(row?.sku || '')) && row?.licenseIntent === 'paired';
}

/**
 * Collapse only exact duplicate editor projections. These rows are a review
 * view derived by the Worker and are stripped before rebuild, so this is not a
 * second quote aggregation path. Standalone renewals and differing terms stay
 * independent commercial lines.
 */
export function consolidatePairedLicenseProjections(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  const byKey = new Map();
  for (const source of list) {
    const row = { ...source };
    if (!isPairedLicenseProjection(row)) {
      out.push(row);
      continue;
    }
    const qty = reviewQuantity(row);
    const key = pairedProjectionConsolidationKey(row);
    if (!key || qty === null) {
      out.push(row);
      continue;
    }
    const existingIndex = byKey.get(key);
    if (existingIndex == null) {
      byKey.set(key, out.length);
      out.push(row);
      continue;
    }
    const existing = out[existingIndex];
    existing.qty = (reviewQuantity(existing) || 0) + qty;
    if (row?.projectionPending === true) existing.projectionPending = true;
    if (row?.pairedSuspended === true) existing.pairedSuspended = true;
  }
  return out;
}

function pairedProjectionConsolidationKey(row) {
  if (!isPairedLicenseProjection(row) || reviewQuantity(row) === null) return '';
  const sku = String(row?.sku || '').trim().toUpperCase();
  if (!sku) return '';
  // A literal license SKU already binds its edition. Ignore stale hidden tier
  // metadata so visually identical projections really do consolidate.
  return [
    sku,
    rowAvailabilityState(row),
    String(row?.productSource || '').trim(),
  ].join('\u0000');
}

function consolidatedInputIndex(rows, targetIndex) {
  if (!Array.isArray(rows) || !rows[targetIndex]) return -1;
  const byKey = new Map();
  let outputIndex = -1;
  let mapped = -1;
  rows.forEach((row, index) => {
    const key = pairedProjectionConsolidationKey(row);
    if (key && byKey.has(key)) {
      if (index === targetIndex) mapped = byKey.get(key);
      return;
    }
    outputIndex += 1;
    if (key) byKey.set(key, outputIndex);
    if (index === targetIndex) mapped = outputIndex;
  });
  return mapped;
}

/** Coverage keys whose paired review is currently a reviewed 2:1 warm-spare pair. */
function warmSpareCoverageKeys(review) {
  return new Set((Array.isArray(review) ? review : [])
    .filter((entry) => entry?.warmSpare === true && entry?.coverageKey)
    .map((entry) => entry.coverageKey));
}

/**
 * Spread one target quantity over the paired projections of a coverage scope.
 * Existing editable rows are preserved and only the aggregate contribution
 * moves; rows reduced to zero are removed. The final SKU consolidation still
 * happens solely in the Worker.
 */
function distributePairedQuantity(next, linkedIndexes, targetQty) {
  const currentQty = linkedIndexes.reduce((total, licenseIndex) => (
    total + (reviewQuantity(next[licenseIndex]) || 0)
  ), 0);
  let delta = targetQty - currentQty;
  const remove = new Set();
  if (delta >= 0) {
    const first = linkedIndexes[0];
    next[first] = {
      ...next[first],
      qty: (reviewQuantity(next[first]) || 0) + delta,
    };
  } else {
    for (const licenseIndex of [...linkedIndexes].reverse()) {
      if (delta === 0) break;
      const qty = reviewQuantity(next[licenseIndex]) || 0;
      const reduction = Math.min(qty, -delta);
      const remaining = qty - reduction;
      delta += reduction;
      if (remaining > 0) next[licenseIndex] = { ...next[licenseIndex], qty: remaining };
      else remove.add(licenseIndex);
    }
  }
  return remove;
}

/**
 * Post-edit reconciliation of paired license projections against the CURRENT
 * hardware rows. Runs after every reducer change so a projection can never
 * carry a quantity its hardware no longer supports:
 *  - active covered hardware: the paired total follows the hardware total
 *    (2:1 for a reviewed warm-spare scope);
 *  - every covered device is "None (hardware only)": the projection is
 *    suspended in place so restoring a tier restores the quantity;
 *  - no covered hardware at all: the projection is an orphan. It is removed
 *    only for the coverage scopes named in `orphanCoverageKeys` (explicit row
 *    removal); a SKU being retyped never deletes rows mid-keystroke.
 * Standalone renewals and undecided licenses are never touched here.
 */
function reconcileLinkedQuoteRows(rows, {
  allowHaLicenseRatio = false,
  warmSpareScopes = new Set(),
  orphanCoverageKeys = new Set(),
} = {}) {
  const next = withDefaultPairedLicenseIntents(rows, { allowHaLicenseRatio });
  const projectionsByKey = new Map();
  next.forEach((row, index) => {
    if (!isPairedLicenseProjection(row)) return;
    const coverageKey = quoteLicenseCoverageKeyForSku(row.sku);
    if (!coverageKey) return;
    if (!projectionsByKey.has(coverageKey)) projectionsByKey.set(coverageKey, []);
    projectionsByKey.get(coverageKey).push(index);
  });
  if (!projectionsByKey.size) return next;

  const remove = new Set();
  for (const [coverageKey, linkedIndexes] of projectionsByKey) {
    const covered = [];
    next.forEach((row, index) => {
      const sku = String(row?.sku || '').trim().toUpperCase();
      if (!sku || sku.startsWith('LIC-')) return;
      if (quoteLicenseCoverageKeyForSku(sku) === coverageKey) covered.push(index);
    });
    const active = covered.filter((index) => !rowIsHardwareOnly(next[index]));

    if (!covered.length) {
      if (orphanCoverageKeys.has(coverageKey)) linkedIndexes.forEach((index) => remove.add(index));
      continue;
    }
    if (!active.length) {
      linkedIndexes.forEach((index) => {
        next[index] = { ...next[index], pairedSuspended: true };
      });
      continue;
    }

    // Hardware owns the licence edition. When every active covered device now
    // sits on one tier that the projection no longer names (MR36 moved from
    // Enterprise to Advanced), the projection follows it immediately as a
    // pending review row: LIC-ENT-3YR becomes LIC-MR-ADV-3Y at the same term
    // instead of lingering as a hard mismatch until the next rebuild. The
    // Worker still derives the final licence when the cart is rebuilt.
    const activeTiers = new Set(active
      .map((index) => effectivePairableHardwareTier(next[index]))
      .filter(Boolean));
    if (activeTiers.size === 1) {
      const [hardwareTier] = activeTiers;
      linkedIndexes.forEach((index) => {
        const row = next[index];
        if (deviceLicenseTierFromSku(row.sku) === hardwareTier) return;
        const retargeted = pairedLicenseSkuForTier(row.sku, hardwareTier);
        next[index] = {
          ...row,
          ...(retargeted ? { sku: retargeted } : {}),
          projectionPending: true,
        };
      });
    }

    const hardwareQuantities = active.map((index) => reviewQuantity(next[index]));
    // While the rep is typing (for example clearing "2" before entering "3"),
    // keep the current projection intact. Validation disables Update until the
    // new whole-number quantity is complete.
    if (!hardwareQuantities.every(Number.isInteger)) continue;
    const hardwareQty = hardwareQuantities.reduce((total, qty) => total + qty, 0);
    const targetQty = allowHaLicenseRatio === true && warmSpareScopes.has(coverageKey)
      ? (Number.isInteger(hardwareQty / 2) ? hardwareQty / 2 : null)
      : hardwareQty;
    linkedIndexes.forEach((index) => {
      const { pairedSuspended: _suspended, ...restored } = next[index];
      next[index] = restored;
    });
    if (targetQty === null) continue;
    for (const index of distributePairedQuantity(next, linkedIndexes, targetQty)) remove.add(index);
  }
  return remove.size ? next.filter((_, index) => !remove.has(index)) : next;
}

/**
 * Apply one editor change plus the two linked invariants:
 *  - one compatible tier per quote-wide product family;
 *  - paired license quantity follows its covered hardware quantity.
 *
 * This reducer never resolves, derives, or aggregates a final license SKU.
 */
export function applyLinkedQuoteRowPatch(rows, index, patch, { allowHaLicenseRatio = false } = {}) {
  const defaulted = defaultPairedLicenseIntents(rows, { allowHaLicenseRatio });
  const baseIndex = consolidatedInputIndex(defaulted, index);
  const base = consolidatePairedLicenseProjections(defaulted);
  if (!base[baseIndex]) return base;
  const warmSpareScopes = warmSpareCoverageKeys(licensePairReviewForRows(base, { allowHaLicenseRatio }));
  const previousSku = String(base[baseIndex]?.sku || '').trim().toUpperCase();
  let next = base.map((row, rowIndex) => (rowIndex === baseIndex ? { ...row, ...(patch || {}) } : { ...row }));
  // An `undefined` patch value clears the field (a retyped identity drops its
  // availability proof) rather than leaving a dangling key on the row.
  for (const key of Object.keys(patch || {})) {
    if (patch[key] === undefined) delete next[baseIndex][key];
  }

  const editedSku = String(next[baseIndex]?.sku || '').trim().toUpperCase();
  const skuIdentityChanged = Object.prototype.hasOwnProperty.call(patch || {}, 'sku')
    && editedSku !== previousSku;
  const orphanCoverageKeys = new Set();
  if (skuIdentityChanged) {
    // Availability, pairing state and a pending projection prove facts about a
    // specific product identity. A committed replacement cannot inherit them.
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'availability')) delete next[baseIndex].availability;
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'productSource')) delete next[baseIndex].productSource;
    if (!Object.prototype.hasOwnProperty.call(patch || {}, 'licenseIntent')) delete next[baseIndex].licenseIntent;
    delete next[baseIndex].pairedSuspended;
    delete next[baseIndex].projectionPending;
    delete next[baseIndex].tierBeforeHardwareOnly;

    const previousPolicy = quoteLicensePolicyFamilyForSku(previousSku);
    const nextPolicy = quoteLicensePolicyFamilyForSku(editedSku);
    const selectedTier = String(next[baseIndex]?.tier || '').trim().toLowerCase();
    const supportedTier = licenseTierOptionsForSku(editedSku).some((option) => option.value === selectedTier);
    if (editedSku.startsWith('LIC-') || previousPolicy !== nextPolicy || !supportedTier) delete next[baseIndex].tier;

    const previousCoverage = previousSku && !previousSku.startsWith('LIC-')
      ? quoteLicenseCoverageKeyForSku(previousSku)
      : '';
    const nextCoverage = editedSku && !editedSku.startsWith('LIC-')
      ? quoteLicenseCoverageKeyForSku(editedSku)
      : '';
    if (previousCoverage && previousCoverage !== nextCoverage) orphanCoverageKeys.add(previousCoverage);
  }
  if (patch?.licenseIntent === 'standalone') delete next[baseIndex].pairedSuspended;

  const hasTierPatch = Object.prototype.hasOwnProperty.call(patch || {}, 'tier') && !editedSku.startsWith('LIC-');
  if (hasTierPatch && String(patch?.tier || '').trim().toLowerCase() !== 'none') {
    const policyFamily = quoteLicensePolicyFamilyForSku(editedSku);
    if (policyFamily) {
      next = next.map((row, rowIndex) => {
        if (rowIndex === baseIndex || rowIsHardwareOnly(row) || /^LIC-/i.test(String(row?.sku || ''))) return row;
        return quoteLicensePolicyFamilyForSku(row?.sku) === policyFamily
          ? { ...row, tier: patch.tier }
          : row;
      });
    }
  }

  return reconcileLinkedQuoteRows(next, { allowHaLicenseRatio, warmSpareScopes, orphanCoverageKeys });
}

/**
 * Remove one editor row and reconcile the paired projections it covered.
 * Removing hardware shrinks its paired license total; removing the last
 * covered device (bare or licensed) removes the now-orphaned projection.
 * Removing a license row itself never touches hardware. Rows outside the
 * removed row's coverage scope are never modified.
 */
export function removeLinkedQuoteRow(rows, index, { allowHaLicenseRatio = false } = {}) {
  const defaulted = defaultPairedLicenseIntents(rows, { allowHaLicenseRatio });
  const baseIndex = consolidatedInputIndex(defaulted, index);
  const base = consolidatePairedLicenseProjections(defaulted);
  if (!base[baseIndex]) return base;
  const warmSpareScopes = warmSpareCoverageKeys(licensePairReviewForRows(base, { allowHaLicenseRatio }));
  const removedSku = String(base[baseIndex]?.sku || '').trim().toUpperCase();
  const orphanCoverageKeys = new Set();
  if (removedSku && !removedSku.startsWith('LIC-')) {
    const coverageKey = quoteLicenseCoverageKeyForSku(removedSku);
    if (coverageKey) orphanCoverageKeys.add(coverageKey);
  }
  const next = base.filter((_, rowIndex) => rowIndex !== baseIndex);
  return reconcileLinkedQuoteRows(next, { allowHaLicenseRatio, warmSpareScopes, orphanCoverageKeys });
}

/**
 * Paired license rows are a review projection. Rebuild from hardware and let
 * the existing Worker mapping derive them once; retain only explicitly
 * standalone licenses. This prevents a second editor-side aggregation path.
 */
export function rowsForLinkedQuoteRebuild(rows, { allowHaLicenseRatio = false } = {}) {
  return withDefaultPairedLicenseIntents(rows, { allowHaLicenseRatio })
    .filter((row) => !isPairedLicenseProjection(row))
    .map((row) => ({ ...row }));
}

/**
 * Term-agnostic licence identity for matching committed rows against the term
 * variant a quote option actually used: "LIC-ENT-3YR", "LIC-ENT-1YR" and the
 * synthetic "MR-ENT" placeholder all reduce to "LIC-ENT".
 */
function licenseProductStem(sku) {
  const value = String(sku || '').trim().toUpperCase();
  if (isSyntheticAgnosticSku(value)) return 'LIC-ENT';
  return value.replace(/-\d{1,2}YR?$/, '');
}

/**
 * Keep the editor's paired projections across a rebuild attempt that did NOT
 * replace the quote (validation, unresolved SKU, verification failure). The
 * committed rows exclude them by design; nothing about the hardware changed,
 * so the pre-attempt projections are still the accurate review view.
 */
export function retainPairedLicenseProjections(committedRows, editorRows) {
  const committed = (Array.isArray(committedRows) ? committedRows : []).map((row) => ({ ...row }));
  const projections = (Array.isArray(editorRows) ? editorRows : [])
    .filter((row) => isPairedLicenseProjection(row))
    .map((row) => ({ ...row }));
  return consolidatePairedLicenseProjections([...committed, ...projections]);
}

/**
 * Re-project device-associated licences after a SUCCESSFUL rebuild from the
 * lines of a verified quote option. The Worker derived those companions; the
 * editor only shows them as paired review rows so the rep can keep seeing
 * (and unpairing) the licence total behind each hardware row.
 *
 * Every committed explicit licence (standalone renewals, typed LIC rows,
 * term-agnostic aliases) consumes its own quantity from the option first, so
 * only the Worker-derived remainder becomes a projection. A remainder is kept
 * only when the review layer confirms it pairs exactly with committed hardware;
 * anything else stays out of the editor exactly as before.
 */
export function withPairedLicenseProjections(committedRows, quoteLines, { allowHaLicenseRatio = false } = {}) {
  const rows = (Array.isArray(committedRows) ? committedRows : []).map((row) => ({ ...row }));
  const explicitByStem = new Map();
  for (const row of rows) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!/^LIC-/.test(sku) && !isSyntheticAgnosticSku(sku)) continue;
    const qty = reviewQuantity(row);
    if (qty === null) continue;
    const stem = licenseProductStem(sku);
    explicitByStem.set(stem, (explicitByStem.get(stem) || 0) + qty);
  }
  const candidates = [];
  for (const line of (Array.isArray(quoteLines) ? quoteLines : [])) {
    const sku = String(line?.sku || '').trim().toUpperCase();
    if (!sku.startsWith('LIC-')) continue;
    const qty = reviewQuantity(line);
    if (qty === null || !deviceLicenseTierFromSku(sku) || !quoteLicenseCoverageKeyForSku(sku)) continue;
    const stem = licenseProductStem(sku);
    const explicit = explicitByStem.get(stem) || 0;
    const consumed = Math.min(explicit, qty);
    explicitByStem.set(stem, explicit - consumed);
    const remaining = qty - consumed;
    if (remaining > 0) candidates.push({ sku, qty: remaining, licenseIntent: 'paired', unresolved: false });
  }
  if (!candidates.length) return rows;
  const combined = consolidatePairedLicenseProjections([...rows, ...candidates]);
  const review = licensePairReviewForRows(combined, { allowHaLicenseRatio });
  return combined.filter((row, index) => index < rows.length || review[index]?.kind === 'paired');
}

/**
 * One-shot `skus` lines from committed editor rows. The per-row "None" tier is
 * an editor concept that travels separately as `hardware_only_lines`; the
 * Worker's tier vocabulary has no "none" and rejects it as an invalid tier,
 * which made every Zoho-only manual quote with a bare row fail closed.
 */
export function oneshotSkusFromCommittedRows(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku) return null;
    const line = { sku, qty: Number(row?.qty) || 1 };
    const tier = String(row?.tier || '').trim().toUpperCase();
    if (tier && tier !== 'NONE') line.tier = tier;
    const licenseIntent = String(row?.licenseIntent || '').trim().toLowerCase();
    if (sku.startsWith('LIC-') && ['paired', 'standalone'].includes(licenseIntent)) line.licenseIntent = licenseIntent;
    const availability = String(row?.availability || '').trim().toLowerCase();
    if (['ecomm', 'zoho_only'].includes(availability)) line.availability = availability;
    return line;
  }).filter(Boolean);
}

/**
 * Carry reviewed standalone renewals into a cart parsed from a quote URL.
 *
 * A verified order URL aggregates the Worker's derived companion with an
 * additive standalone copy of the same licence (MX95 x2 + standalone x1 gives
 * LIC-MX95-SEC-3Y x3). Handing that single line to the one-shot plan makes the
 * Worker treat all three as device coverage and refuse the cart. Split the
 * reviewed standalone quantity back out as its own intent-bearing line; the
 * remainder keeps the blank (device companion) meaning. Matching is
 * term-agnostic because the selected option may use a different term than the
 * row the rep typed. A URL line that cannot fund the standalone quantity is
 * left untouched so the Worker still fails closed.
 */
export function oneshotSkusWithReviewedLicenseIntents(urlLines, committedRows) {
  const lines = (Array.isArray(urlLines) ? urlLines : [])
    .map((line) => ({ sku: String(line?.sku || '').trim().toUpperCase(), qty: Number(line?.qty) }))
    .filter((line) => line.sku && Number.isInteger(line.qty) && line.qty > 0);
  const standaloneByStem = new Map();
  for (const row of (Array.isArray(committedRows) ? committedRows : [])) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku.startsWith('LIC-') || row?.licenseIntent !== 'standalone') continue;
    const qty = reviewQuantity(row);
    if (qty === null) continue;
    const stem = licenseProductStem(sku);
    standaloneByStem.set(stem, (standaloneByStem.get(stem) || 0) + qty);
  }
  if (!standaloneByStem.size) return lines;
  const out = [];
  for (const line of lines) {
    const stem = line.sku.startsWith('LIC-') ? licenseProductStem(line.sku) : '';
    const standaloneQty = stem ? (standaloneByStem.get(stem) || 0) : 0;
    if (!standaloneQty || standaloneQty > line.qty) {
      out.push(line);
      continue;
    }
    standaloneByStem.delete(stem);
    if (line.qty > standaloneQty) out.push({ sku: line.sku, qty: line.qty - standaloneQty });
    out.push({ sku: line.sku, qty: standaloneQty, licenseIntent: 'standalone' });
  }
  return out;
}

function quoteEditorGroupDescriptor(row, pairing = {}) {
  const ownSku = String(row?.sku || '').trim().toUpperCase();
  if (!ownSku && row?.editorPurpose === 'standalone') {
    return { key: 'standalone-licenses', label: 'Standalone renewals', order: 80 };
  }
  const pairedHardwareSku = pairing?.role === 'license' ? pairing?.hardwareSkus?.[0] : '';
  const sku = String(pairedHardwareSku || ownSku).trim().toUpperCase();
  const policyFamily = quoteLicensePolicyFamilyForSku(sku);
  if (policyFamily === 'security-appliances' || /^LIC-(?:MX|Z4|C8)/.test(ownSku)) {
    return { key: 'security-appliances', label: 'Security appliances', order: 10 };
  }
  if (policyFamily === 'access-points' || /^LIC-(?:ENT-|MR-ADV-)/.test(ownSku)) {
    return { key: 'access-points', label: 'Access points', order: 20 };
  }
  if (policyFamily === 'switches' || /^LIC-(?:MS|C9)/.test(ownSku)) {
    return { key: 'switches', label: 'Switches', order: 30 };
  }
  if (/^MV\d/.test(sku) || /^LIC-MV-/.test(ownSku)) return { key: 'cameras', label: 'Cameras', order: 40 };
  if (/^MT\d/.test(sku) || /^LIC-MT-/.test(ownSku)) return { key: 'sensors', label: 'Sensors', order: 50 };
  if (/^MG\d/.test(sku) || /^LIC-MG/.test(ownSku)) return { key: 'cellular', label: 'Cellular gateways', order: 60 };
  if (isLicenseExemptAccessorySku(ownSku)) return { key: 'accessories', label: 'Accessories', order: 70 };
  if (ownSku.startsWith('LIC-') || isSyntheticAgnosticSku(ownSku)) return { key: 'standalone-licenses', label: 'Standalone licenses', order: 80 };
  return { key: 'other', label: 'Other products', order: 90 };
}

/** Stable presentation role; canonical row order remains untouched. */
export function quoteEditorPresentationRole(row, pairing = {}) {
  const sku = String(row?.sku || '').trim().toUpperCase();
  if (!sku.startsWith('LIC-') && !isSyntheticAgnosticSku(sku)) return 'product';
  if (row?.licenseIntent === 'paired'
      || (pairing?.role === 'license' && ['paired', 'pending', 'suspended'].includes(pairing?.kind))) {
    return 'paired_license';
  }
  return 'standalone_license';
}

/**
 * Presentation-only grouping; entries retain their original row indexes.
 *
 * `productCount` counts the rows a rep can independently quote. A paired
 * license projection is the review view of hardware already counted, so it is
 * reported separately as `pairedLicenseCount` rather than inflating the group.
 */
export function groupQuoteEditorRows(rows, pairReview = null) {
  const list = Array.isArray(rows) ? rows : [];
  const review = Array.isArray(pairReview) ? pairReview : licensePairReviewForRows(list);
  const groups = new Map();
  list.forEach((row, index) => {
    const descriptor = quoteEditorGroupDescriptor(row, review[index]);
    if (!groups.has(descriptor.key)) {
      groups.set(descriptor.key, { ...descriptor, entries: [], productCount: 0, pairedLicenseCount: 0 });
    }
    const group = groups.get(descriptor.key);
    group.entries.push({ row, index, role: quoteEditorPresentationRole(row, review[index]) });
    if (isPairedLicenseProjection(row)) group.pairedLicenseCount += 1;
    else group.productCount += 1;
  });
  const roleOrder = { product: 0, paired_license: 1, standalone_license: 2 };
  return [...groups.values()]
    .map((group) => ({
      ...group,
      entries: [...group.entries].sort((a, b) => (
        (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9) || a.index - b.index
      )),
    }))
    .sort((a, b) => a.order - b.order);
}

/**
 * The model a SKU belongs to, used to tell a hardware-paired licence from a
 * standalone one. "LIC-MX67C-SEC-1YR" and "MX67C-NA" both reduce to "MX67C".
 * Term-agnostic aliases reduce to their own stem ("LIC-ENT" -> "ENT"), which
 * matches no hardware model, so they are always treated as standalone.
 */
export function skuModelToken(sku) {
  const value = String(sku || '').toUpperCase().trim();
  if (!value) return '';
  const token = (value.startsWith('LIC-') ? value.slice(4) : value).split('-')[0];
  // C9300L hardware uses the C9300 licence family. Keep other suffix-bearing
  // Catalyst families exact until their own catalogue relationship is proven.
  return token === 'C9300L' ? 'C9300' : token;
}

/**
 * The variant digits that distinguish two devices sharing a model token:
 * "MS130-48" -> "48", "MS150-48LP-4G" -> "48", "C9200L-24P-4G-M" -> "24",
 * "LIC-MS130-24A-1Y" -> "24". Returns "" when the second segment carries no
 * port count ("MX67C-NA", "LIC-MX67C-SEC-1YR", "LIC-ENT-1YR"), which means the
 * model token alone identifies the device.
 */
export function skuVariantDigits(sku) {
  const value = String(sku || '').toUpperCase().trim();
  if (!value) return '';
  const segments = (value.startsWith('LIC-') ? value.slice(4) : value).split('-');
  const second = segments[1] || '';
  // A term suffix is not a variant: "LIC-ENT-1YR" must not read as variant "1".
  if (/^\d+YR?$/.test(second)) return '';
  return (second.match(/\d+/) || [''])[0];
}

/**
 * Whether two SKUs describe the same device, so a licence can be matched to the
 * hardware it belongs to (or to another licence for that hardware). They must
 * share a model token, and where both name a port count those must agree too:
 * an MS130-24 in the cart does not derive a LIC-MS130-48 licence, even though
 * both reduce to the token "MS130" (2026-08-19).
 */
export function sameDeviceIdentity(a, b) {
  const token = skuModelToken(a);
  if (!token || token !== skuModelToken(b)) return false;
  const variantA = skuVariantDigits(a);
  const variantB = skuVariantDigits(b);
  if (!variantA || !variantB) return true;
  return variantA === variantB;
}

/**
 * The licence term a plan is already built for, read from its own licence rows
 * ("LIC-MX67C-SEC-3YR" and "LIC-MS150-48-3Y" both give "3"). Used so a requote
 * keeps the term the customer is being quoted instead of guessing one. Returns
 * null when the rows disagree or carry no term, so the caller can decide.
 */
export function licenseTermFromSku(rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku.startsWith('LIC-')) return '';
  return (sku.match(/-(\d{1,2})YR?$/) || [])[1] || '';
}

export function termFromLicenseRows(rows) {
  const terms = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const term = licenseTermFromSku(row?.sku);
    if (term) terms.add(term);
  }
  return terms.size === 1 ? [...terms][0] : null;
}

/**
 * Resolve the single term a direct Zoho review needs without inventing one.
 * A reviewed dropdown selection wins; otherwise one concrete LIC-* suffix may
 * supply the term. Mixed concrete terms and licensable hardware without either
 * source fail closed. Accessories and rows explicitly set to hardware-only do
 * not need a licence term at all.
 */
export function directZohoQuoteTerm(rows, requestedTerm = '') {
  const requested = String(requestedTerm || '').trim();
  if (requested) {
    return ['1', '3', '5'].includes(requested)
      ? { ok: true, term: requested, source: 'selected', error: '' }
      : { ok: false, term: null, source: '', error: 'Choose 1, 3, or 5 years for this Zoho-only cart.' };
  }

  const list = Array.isArray(rows) ? rows : [];
  const concreteTerms = new Set(list.map((row) => licenseTermFromSku(row?.sku)).filter(Boolean));
  if (concreteTerms.size === 1) {
    const inferred = [...concreteTerms][0];
    return ['1', '3', '5'].includes(inferred)
      ? { ok: true, term: inferred, source: 'license_sku', error: '' }
      : { ok: false, term: null, source: '', error: `The ${inferred}-year license term is not supported by direct Zoho review.` };
  }
  if (concreteTerms.size > 1) {
    return { ok: false, term: null, source: '', error: 'This Zoho-only cart contains mixed license terms. Choose one reviewed 1, 3, or 5 year term.' };
  }

  const needsDerivedLicense = list.some((row) => quoteEditorHardwareLicenseUse(row) === 'paired');
  if (needsDerivedLicense) {
    return {
      ok: false,
      term: null,
      source: '',
      error: 'Choose 1, 3, or 5 years for a Zoho-only cart. All standard creates multiple eCommerce options, but this direct Zoho review needs one reviewed term.',
    };
  }
  return { ok: true, term: null, source: 'not_required', error: '' };
}

/** Concrete explicit license rows may not contradict a selected quote term. */
export function quoteTermConflictForRows(rows, requestedTerm) {
  const term = String(requestedTerm || '').trim();
  if (!term) return null;
  const conflicts = (Array.isArray(rows) ? rows : [])
    .filter((row) => /^LIC-/i.test(String(row?.sku || '')) && row?.licenseIntent !== 'paired')
    .map((row) => ({ sku: String(row.sku).trim().toUpperCase(), term: licenseTermFromSku(row.sku) }))
    .filter((row) => row.term && row.term !== term);
  return conflicts.length ? { requestedTerm: term, conflicts } : null;
}

/**
 * Split editor rows for a tier requote.
 *
 * A one-shot plan holds hardware AND the licences the worker derived from that
 * hardware. Changing a row's licence tier means asking the worker to derive the
 * licences again, so only the hardware may be sent back: re-sending the derived
 * licences makes the worker quote both copies (doubled licence quantities), and
 * before the 2026-08-18 worker fix it made the whole cart read as licence-only
 * and dropped every device (that is the "Revalidate / re-plan deletes all of the
 * hardware" report).
 *
 * A licence naming a device that is in this cart is derived, so the requote
 * rebuilds it. Everything else is provisionally standalone; the caller then
 * drops any of those the requote turned out to produce anyway, which is what
 * catches family-spelled licences ("3 MR44" derives "LIC-ENT-1YR", whose token
 * is a bare "ENT" and matches no hardware model). Checking the requote output
 * rather than guessing from the spelling keeps a genuine standalone licence,
 * such as 7 MR licences bought alongside an MX, out of the discard pile.
 */
export function splitRowsForTierRequote(rows) {
  const list = withDefaultPairedLicenseIntents(Array.isArray(rows) ? rows : []);
  const isLicense = (row) => /^LIC-/i.test(String(row?.sku || ''));
  const hardwareRows = list.filter((row) => !isLicense(row));
  const licenseRows = list.filter(isLicense);
  const isDerived = (row) => row?.licenseIntent === 'paired'
    || (row?.licenseIntent !== 'standalone' && hardwareRows.some((hw) => sameDeviceIdentity(row?.sku, hw?.sku)));
  return {
    hardwareRows,
    derivedLicenseRows: licenseRows.filter(isDerived),
    standaloneLicenseRows: licenseRows.filter((row) => !isDerived(row)),
  };
}

/**
 * Whether a hardware-only phrase covers the WHOLE cart rather than one line.
 *
 * Some lines carrying the phrase while other SKU lines do not is the per-row
 * "None (hardware only)" shape produced by this module's own serializer, and
 * must stay local. All SKU lines carrying it, or a single-line request, is a
 * whole-cart ask.
 */
export function hardwareOnlyAppliesToWholeCart(value) {
  const text = String(value || '');
  const PHRASE = /\b(?:hardware[ -]?only|hw[ -]?only|no\s+licenses?|without\s+licenses?|just\s+(?:the\s+)?hardware)\b/i;
  if (!PHRASE.test(text)) return false;
  const SKU_LINE = /(?:^|\s)(?:LIC-[A-Z0-9-]+|(?:MX|MS|MR|MV|MT|MG|MA|CW|C8|C9|Z)\d[A-Z0-9-]*)/i;
  const skuLines = text.split(/\n/).map((line) => line.trim()).filter((line) => SKU_LINE.test(line));
  if (skuLines.length <= 1) return true;
  return skuLines.every((line) => PHRASE.test(line));
}

export function quoteModeFromText(value) {
  const text = String(value || '');
  // Tier and term must be read from what the USER asked for, never from the
  // inside of a license SKU that happens to be in the same string. A prior
  // quote of "2 MR44 and 3 LIC-MX67C-ENT-3YR" made \bENT\b and \b3YR\b match
  // inside the SKU, so every requote silently appended "enterprise" and
  // "3 year" and collapsed a 1/3/5-year quote down to a single 3-year URL.
  // The worker's own term regex guards against this the same way. Hardware-only
  // and license-only wording ("license only", "no hardware") never appears
  // inside a SKU, so those still read the raw text.
  const scan = text.replace(/\bLIC-[A-Z0-9-]+/gi, ' ');
  // A per-row "hardware only" must NOT read as a whole-cart mode. After a
  // successful update the panel stores the SERIALIZED text as skuText, and that
  // text carries the phrase on the one line the rep set to None. Re-reading it
  // globally made the next edit fail with "Hardware Only cannot include an
  // explicit license SKU", so no quantity or tier could be changed again after
  // the first update (2026-08-19).
  const hardwareOnly = hardwareOnlyAppliesToWholeCart(text);
  const licenseOnly = !hardwareOnly && /\b(?:license[ -]?only|licenses?[ -]?only|no\s+hardware|without\s+hardware)\b/i.test(text);
  let tier = null;
  if (/\b(?:SDW|SD[-\s]?WAN(?:\s+PLUS)?)\b/i.test(scan)) tier = 'SD-WAN';
  else if (/\b(?:ENT|ENTERPRISE)\b/i.test(scan)) tier = 'enterprise';
  else if (/\b(?:SEC|SECURITY|ADVANCED\s+SECURITY)\b/i.test(scan)) tier = 'security';
  // Emitted as the bare word for the same reason as the dropdown option above:
  // a trailing "LICENSE" would turn the rebuilt request license-only.
  else if (/\b(?:ADVANCED\s+(?:LICENSE|LICENSING|FEATURES?)|ADAPTIVE\s+POLICY)\b/i.test(scan)) tier = 'advanced';
  const term = (scan.match(/(?<![\w-])([135])\s*(?:-|\s)?(?:year|yr)s?\b/i) || [])[1] || null;
  return { hardwareOnly, licenseOnly, tier, term };
}

/**
 * Serialize the synthetic agnostic-license rows in the exact "MR-ENT x{qty}"
 * order runQuote()'s own mrEntLineRe expects (token first, qty second) --
 * the opposite of every other row's "{qty} {sku}" order. Getting this order
 * wrong is what silently breaks quantity-only edits on this row: the text
 * comes back unrecognized, parseMessage() returns null, and the whole quote
 * (including untouched hardware rows) fails, forcing a full manual reselect.
 */
function syntheticAgnosticLines(rows) {
  const lines = [];
  const errors = [];
  rows.forEach((row, index) => {
    const rawQty = row?.qty;
    const qtyText = typeof rawQty === 'number' ? String(rawQty) : String(rawQty ?? '').trim();
    const qty = /^\d{1,5}$/.test(qtyText) ? Number(qtyText) : NaN;
    if (!Number.isInteger(qty) || qty < 1 || qty > 500) {
      errors.push({
        index,
        code: 'invalid_quantity',
        message: `Line ${index + 1}: MR Enterprise quantity must be a whole number from 1 to 500.`,
      });
      return;
    }
    lines.push({ sku: 'MR-ENT', qty, text: `MR-ENT x${qty}` });
  });
  return { lines, errors };
}

/**
 * Build the exact quote request from canonical normalized rows plus prior mode.
 *
 * `overrides.tier` is a LICENSE_TIER_OPTIONS value chosen in the editor. It
 * replaces the tier inferred from the prior request text, so changing ENT to SEC
 * is a dropdown pick instead of retyping the whole request. An empty/absent
 * override keeps the inferred tier, so existing behavior is unchanged.
 */
export function quoteTextFromEditorRows(rows, priorText = '', overrides = {}) {
  const rowList = Array.isArray(rows) ? rows : [];
  const hasTermOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'term');
  const termOverride = hasTermOverride ? String(overrides?.term ?? '').trim() : '';
  if (hasTermOverride && termOverride && !['1', '3', '5'].includes(termOverride)) {
    const message = 'Quote term must be All standard, 1 year, 3 years, or 5 years.';
    return {
      ok: false,
      rows: [],
      text: '',
      error: message,
      errors: [{ index: -1, code: 'invalid_quote_term', message }],
    };
  }
  const syntheticRows = rowList.filter((row) => isSyntheticAgnosticSku(row?.sku));
  const normalRows = rowList.filter((row) => !isSyntheticAgnosticSku(row?.sku));

  const synthetic = syntheticAgnosticLines(syntheticRows);
  if (synthetic.errors.length) {
    return { ok: false, rows: [], text: '', error: synthetic.errors[0].message, errors: synthetic.errors };
  }

  let normalized = { ok: true, lines: [], text: '' };
  if (normalRows.length > 0) {
    const editorNormalized = normalizeSkuEditorRows(normalRows);
    if (!editorNormalized.ok) {
      return { ok: false, rows: [], text: '', error: editorNormalized.error, errors: editorNormalized.errors };
    }
    const lines = editorNormalized.rows.map(({ unresolved: _unresolved, ...line }) => line);
    // A selected live product whose storefront classification is still unknown
    // has no safe route: an eCommerce link could sell a Zoho-only product and a
    // Zoho review could bypass the storefront. Nothing downstream may start
    // until the exact availability check is retried and resolves.
    const route = quoteRouteForRows(lines);
    if (route.route === 'blocked') {
      const message = `eCommerce availability is still unknown for ${route.unknownSkus.join(', ')}. Retry the availability check before generating; no link, Zoho review, or CRM write was started.`;
      return {
        ok: false,
        rows: lines,
        text: '',
        error: message,
        errors: [{ index: -1, code: 'availability_unknown', message }],
      };
    }
    const pairReview = licensePairReviewForRows(lines, { allowHaLicenseRatio: overrides?.haRequested === true });
    // A pending projection is waiting for the Worker to derive the licence at
    // the new hardware tier. Rebuild callers strip it beforehand; a direct
    // caller must not publish a locally re-targeted licence as a final line.
    const pendingProjection = lines.some((line, index) => (
      /^LIC-/i.test(String(line?.sku || ''))
      && line?.licenseIntent === 'paired'
      && (line?.projectionPending === true || pairReview[index]?.kind === 'pending')
    ));
    if (pendingProjection) {
      return {
        ok: false,
        rows: lines,
        text: '',
        error: 'A device-associated license is waiting to be rebuilt at the new hardware tier. Update the quote to derive it.',
        errors: [{ index: -1, code: 'pending_paired_projection', message: 'A paired license projection must be rebuilt before it can be published.' }],
      };
    }
    const unresolvedPair = pairReview.some((entry) => entry.kind === 'needs_review');
    if (unresolvedPair) {
      return {
        ok: false,
        rows: lines,
        text: '',
        error: 'Choose whether each matching hardware/license row is device-associated or a standalone renewal before updating the quote.',
        errors: [{ index: -1, code: 'license_intent_required', message: 'Matching hardware/license rows require a license-use choice.' }],
      };
    }
    const unresolvedMismatch = lines.some((line, index) => (
      /^LIC-/i.test(String(line?.sku || ''))
      && pairReview[index]?.kind === 'mismatch'
      && line?.licenseIntent !== 'standalone'
    ));
    if (unresolvedMismatch) {
      return {
        ok: false,
        rows: lines,
        text: '',
        error: 'A license does not match the current hardware tier or quantity. Choose Standalone renewal / additional license, or correct the hardware, tier, or quantity.',
        errors: [{ index: -1, code: 'license_pair_mismatch', message: 'A mismatched hardware/license row requires correction or an explicit standalone choice.' }],
      };
    }
    const stalePairedIntent = lines.some((line, index) => (
      /^LIC-/i.test(String(line?.sku || ''))
      && line?.licenseIntent === 'paired'
      && pairReview[index]?.kind === 'none'
    ));
    if (stalePairedIntent) {
      return {
        ok: false,
        rows: lines,
        text: '',
        error: 'A device-associated license no longer matches the current hardware tier. Choose its license use again or update the hardware tier.',
        errors: [{ index: -1, code: 'stale_paired_license_intent', message: 'The reviewed device-associated license no longer matches the hardware.' }],
      };
    }
    // A suspended projection has a zero effective quantity. Callers that rebuild
    // through rowsForLinkedQuoteRebuild never reach this; a direct caller must
    // not be allowed to re-licence hardware the rep set to None.
    const suspendedPaired = lines.some((line, index) => (
      /^LIC-/i.test(String(line?.sku || ''))
      && line?.licenseIntent === 'paired'
      && pairReview[index]?.kind === 'suspended'
    ));
    if (suspendedPaired) {
      return {
        ok: false,
        rows: lines,
        text: '',
        error: 'A device-associated license has no licensed hardware left because every covered device is hardware only. Remove the license row or choose Standalone renewal.',
        errors: [{ index: -1, code: 'suspended_paired_license', message: 'A device-associated license covers only hardware-only rows.' }],
      };
    }
    normalized = {
      ok: true,
      lines,
      text: lines.map(({ sku, qty }) => `${qty} ${sku}`).join('\n'),
      error: '',
      errors: [],
    };
  } else if (!syntheticRows.length) {
    return {
      ok: false,
      rows: [],
      text: '',
      error: 'Add at least one SKU before updating the quote.',
      errors: [{ index: -1, code: 'no_lines', message: 'Add at least one SKU before updating the quote.' }],
    };
  }

  const inferred = quoteModeFromText(priorText);
  const hasTierOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'tier')
    && String(overrides.tier || '') !== '';
  let mode = hasTierOverride
    ? { ...inferred, tier: licenseTierModifier(overrides.tier) }
    : inferred;
  if (hasTermOverride) mode = { ...mode, term: termOverride || null };
  const termConflict = quoteTermConflictForRows(normalized.lines, mode.term);
  if (termConflict) {
    const names = termConflict.conflicts.map(({ sku, term }) => `${sku} (${term}-year)`).join(', ');
    const message = `${names} conflicts with the selected ${mode.term}-year quote term. Select All standard or choose a matching standalone license SKU.`;
    return {
      ok: false,
      rows: normalized.lines,
      text: '',
      error: message,
      errors: [{ index: -1, code: 'mixed_quote_term', message }],
    };
  }
  if (mode.hardwareOnly && normalized.lines.some((row) => row.sku.startsWith('LIC-'))) {
    return {
      ok: false,
      rows: normalized.lines,
      text: '',
      error: 'Hardware Only cannot include an explicit license SKU. Remove the license row or change the quote mode.',
      errors: [],
    };
  }
  if (mode.hardwareOnly && syntheticRows.length) {
    return {
      ok: false,
      rows: normalized.lines,
      text: '',
      error: 'Hardware Only cannot include an explicit license SKU. Remove the license row or change the quote mode.',
      errors: [],
    };
  }

  // Per-row tiers win. Emit "2 MX67W security" on that line so the worker can
  // apply SEC to the MX and a different pick (enterprise / advanced) to an MR
  // on the same quote. A global modifier would collapse mixed carts.
  const fallbackMod = (!mode.hardwareOnly && hasTierOverride) ? licenseTierModifier(overrides.tier) : null;
  // A tier only means something on a hardware line: it tells the worker which
  // licence to derive. On a line that IS a licence there is nothing to derive,
  // and appending the word produced shapes like "2 LIC-MX67C-SEC-1YR enterprise"
  // that ask for two different tiers at once (2026-08-19). The dropdown is
  // hidden for licence rows, but row state survives editing a SKU from hardware
  // to a licence, so the tier is dropped here rather than trusting the UI.
  // normalizeSkuEditorRows has already merged only (SKU + intent)-equivalent
  // rows, so each normalized line carries its own tier/None state. Looking the
  // state up by SKU would again collapse SEC and ENT occurrences of one model.
  const rowMods = normalized.lines.map((line) => (
    /^LIC-/i.test(String(line.sku || ''))
      ? null
      : licenseTierModifier(line.tier)
  ));
  const rowHardwareOnly = normalized.lines.map((line) => (
    !/^LIC-/i.test(String(line.sku || '')) && rowIsHardwareOnly(line)
  ));
  // A "None" row carries no tier modifier, so rowMods alone would not trigger
  // per-line emission for a cart whose only choice is None.
  const anyRowTier = rowMods.some(Boolean) || rowHardwareOnly.some(Boolean);

  let skuBlock = normalized.text;
  if (anyRowTier && !mode.hardwareOnly) {
    const rendered = normalized.lines.map((line, index) => {
      const isLicenseLine = /^LIC-/i.test(String(line.sku || ''));
      if (!isLicenseLine && rowHardwareOnly[index]) {
        // Per-line "None": the phrase is attached to this SKU's own clause, so
        // the worker's clause intent strips this licence and no other.
        return { text: `${line.qty} ${line.sku} hardware only`, hardwareOnly: true };
      }
      const mod = isLicenseLine ? null : (rowMods[index] || fallbackMod);
      return { text: mod ? `${line.qty} ${line.sku} ${mod}` : `${line.qty} ${line.sku}`, hardwareOnly: false };
    });
    // Hardware-only lines are emitted FIRST. A strong "hardware only" sitting
    // after the LAST item is read as covering the whole request (that is what
    // fixes a typed "2 MX67C and 4 MR44 hardware only"), so a per-line None on
    // the final row would otherwise strip every licence in the cart. Ordering
    // keeps at least one licensed line after it and the intent stays local.
    // When every line is None the request really is hardware-only, and the
    // list-level reading is then correct anyway (2026-08-19).
    const ordered = [
      ...rendered.filter((line) => line.hardwareOnly),
      ...rendered.filter((line) => !line.hardwareOnly),
    ];
    skuBlock = ordered.map((line) => line.text).join('\n');
  }

  // A concrete LIC-ENT-* row contains the word ENT inside its SKU. If a real
  // request-global tier is emitted only as a trailing line, the Worker sees a
  // row tier on that literal license first and correctly stops global fallback
  // from reaching blank hardware. Attach the reviewed prose tier directly to
  // each hardware clause in this mixed literal-license shape; the concrete LIC
  // row remains untouched and no token can impersonate a global choice.
  const globalTierRenderedPerHardware = !anyRowTier && !mode.hardwareOnly && Boolean(mode.tier)
    && normalized.lines.some((line) => /^LIC-/i.test(String(line.sku || '')))
    && normalized.lines.some((line) => !/^LIC-/i.test(String(line.sku || '')));
  if (globalTierRenderedPerHardware) {
    skuBlock = normalized.lines.map((line) => (
      /^LIC-/i.test(String(line.sku || ''))
        ? `${line.qty} ${line.sku}`
        : `${line.qty} ${line.sku} ${mode.tier}`
    )).join('\n');
  }

  const modifiers = [];
  if (mode.hardwareOnly) modifiers.push('hardware only');
  else if (mode.licenseOnly) modifiers.push('license only');
  if (!mode.hardwareOnly && mode.tier && !anyRowTier && !globalTierRenderedPerHardware) modifiers.push(mode.tier);
  if (!mode.hardwareOnly && mode.term) modifiers.push(`${mode.term} year`);
  // The UI has already reduced the original thread to the hardened explicit-HA
  // boolean. Carry that reviewed authorization into the fresh Worker session;
  // otherwise an editor rebuild loses the wording and a valid 2:1 companion is
  // indistinguishable from an underlicensed cart.
  if (!mode.hardwareOnly && overrides?.haRequested === true) modifiers.push('use warm spare HA');

  const combinedLines = [skuBlock, ...synthetic.lines.map((line) => line.text)].filter(Boolean);
  // Published so verification can be told which committed rows deliberately
  // carry no licence. Without it the shared LIC-ENT companion check demanded a
  // quantity covering EVERY access point, so a per-line None failed the whole
  // quote with "wrong license quantity for LIC-ENT-1YR" (2026-08-19).
  //
  // `hardwareOnlyLines` is the quantity-scoped contract: one SKU may be split
  // into a bare spare and licensed production units (MX67 x1 None + MX67 x2
  // SEC). `hardwareOnlySkus` remains the legacy whole-SKU list and therefore
  // names only SKUs whose ENTIRE committed quantity is bare. A consumer that
  // understands only the legacy list sees a split SKU as fully licensed and
  // fails closed on the missing companion quantity instead of silently
  // excluding licensed units from coverage.
  const hardwareOnlyLines = normalized.lines
    .filter((line, index) => rowHardwareOnly[index])
    .map(({ sku, qty }) => ({ sku, qty }));
  const licensedHardwareSkus = new Set(normalized.lines
    .filter((line, index) => !/^LIC-/i.test(String(line.sku || '')) && !rowHardwareOnly[index])
    .map((line) => line.sku));
  const hardwareOnlySkus = hardwareOnlyLines
    .filter(({ sku }) => !licensedHardwareSkus.has(sku))
    .map(({ sku }) => sku);
  // The normalized lines already retain the row-local intent used to render
  // them. When every row is blank, however, the tier can still come from the
  // prior/global request ("1 MX67 enterprise"). Stamp that effective choice
  // onto committed hardware rows so verification reviews the same intent the
  // worker received instead of treating the rows as family defaults. Do not
  // stamp a global tier into a cart that already has row-local choices.
  const effectiveGlobalTier = !anyRowTier && !mode.hardwareOnly
    ? licenseTierValueFromMode(mode.tier)
    : '';
  const committedRows = normalized.lines.map((line) => ({
    ...line,
    ...(!/^LIC-/i.test(String(line.sku || '')) && effectiveGlobalTier
      ? { tier: effectiveGlobalTier }
      : {}),
  }));
  return {
    ok: true,
    hardwareOnlySkus,
    hardwareOnlyLines,
    rows: [...committedRows, ...synthetic.lines.map(({ sku, qty }) => ({ sku, qty }))],
    licenseIntents: committedRows
      .filter((line) => /^LIC-/i.test(String(line.sku || '')) && line.licenseIntent)
      .map(({ sku, qty, licenseIntent }) => ({ sku, qty, intent: licenseIntent })),
    text: [...combinedLines, ...modifiers].filter(Boolean).join('\n'),
    mode,
    error: '',
    errors: [],
  };
}
