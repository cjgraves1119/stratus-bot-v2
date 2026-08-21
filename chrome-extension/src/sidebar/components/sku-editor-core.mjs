import {
  normalizeEditableQuoteLines,
} from '../../lib/email-quote-flow.mjs';

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
    return {
      sku,
      qty: Number(item?.qty ?? item?.quantity) || 1,
      unresolved: unresolved.has(sku) || unresolved.has(typedSku),
      synthetic: isSyntheticAgnosticSku(sku),
      ...(tier ? { tier } : {}),
      ...(resolvedSku && resolvedSku !== typedSku ? { typedSku } : {}),
    };
  }).filter((row) => row.sku);

  for (const suggestion of suggestions) {
    const sku = String(suggestion?.input || '').trim().toUpperCase();
    if (!sku || rows.some((row) => row.sku === sku)) continue;
    rows.push({ sku, qty: Number(suggestion?.qty) || 1, unresolved: true });
  }
  return rows.slice(0, MAX_ROWS);
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
  const intentsBySku = new Map();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const sku = String(row?.sku || '').trim().toUpperCase();
    const qty = Number(row?.qty);
    const tier = sku.startsWith('LIC-')
      ? ''
      : String(row?.tier || '').trim().toLowerCase();
    const key = `${sku}\u0000${tier}`;
    const existing = grouped.get(key);
    if (existing) existing.qty += qty;
    else grouped.set(key, { sku, qty, ...(tier ? { tier } : {}) });

    if (!sku.startsWith('LIC-')) {
      if (!intentsBySku.has(sku)) intentsBySku.set(sku, new Set());
      intentsBySku.get(sku).add(tier);
    }
  }

  // `hardwareOnlySkus` is intentionally a SKU list, so it cannot represent a
  // partial quantity such as MX67 x1 bare + MX67 x2 licensed. Publishing that
  // shape would make verification exclude all MX67 units from companion
  // coverage. Refuse it explicitly until the review contract carries per-row
  // quantities; separate tiered licensed rows remain fully supported.
  for (const [sku, intents] of intentsBySku) {
    if (!intents.has('none') || intents.size === 1) continue;
    const message = `${sku} cannot be split between hardware-only and licensed rows in one quote. Use separate quotes for those quantities.`;
    return {
      ok: false,
      rows: [],
      error: message,
      errors: [{ index: -1, code: 'mixed_same_sku_license_intent', message }],
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
export function applySkuSuggestion(rows, suggestion, mode = 'apply') {
  const current = Array.isArray(rows) ? rows.map((row) => ({ ...row })) : [];
  const input = String(suggestion?.input || '').trim().toUpperCase();
  const replacement = String(suggestion?.suggest?.[0] || '').trim().toUpperCase();
  if (!SAFE_SKU.test(replacement)) return current;

  if (mode === 'stack') {
    current.push({ sku: replacement, qty: Number(suggestion?.qty) || 1, unresolved: false });
    return current;
  }

  let replaced = false;
  const next = current.map((row) => {
    if (String(row?.sku || '').trim().toUpperCase() !== input) return row;
    replaced = true;
    return { ...row, sku: replacement, unresolved: false };
  });
  if (!replaced) next.push({ sku: replacement, qty: Number(suggestion?.qty) || 1, unresolved: false });
  return next;
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

/** True when a row was set to the per-line "None (hardware only)" option. */
export function rowIsHardwareOnly(row) {
  return String(row?.tier || '').trim().toLowerCase() === 'none';
}

export function licenseTierModifier(value) {
  const found = LICENSE_TIER_OPTIONS.find((option) => option.value === String(value || ''));
  return found ? found.modifier : null;
}

/** Family used to decide which license-tier picks are valid on a row. */
export function licenseFamilyForSku(sku) {
  const s = String(sku || '').trim().toUpperCase();
  if (!s || s.startsWith('LIC-') || isSyntheticAgnosticSku(s)) return 'license';
  if (/^MX/.test(s) || /^C(8111|8121|8455)/.test(s)) return 'mx';
  if (/^Z\d/.test(s)) return 'z';
  if (/^MR/.test(s)) return 'mr';
  if (/^CW/.test(s)) return 'cw';
  if (/^(MS130|MS150|MS390)/.test(s)) return 'ms';
  if (/^(C9\d{3}|C9200L|C9300)/.test(s)) return 'c9';
  return 'unknown';
}

/** Per-row dropdown options. Mixed carts can pick MX SEC and MR ADV together. */
/**
 * The tier the worker applies when a row is left on its default, named so the
 * rep can see it. "Default license tier" hid the actual choice: an MX quietly
 * gets Advanced Security and an MR gets Enterprise, and nothing on screen said
 * so (2026-08-19). Mirrors the worker's per-family defaults in getLicenseSkus.
 */
export function defaultLicenseTierLabelForSku(sku) {
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
    case 'z':
      return pick('enterprise', 'security', 'sdwan', 'none');
    case 'mr':
    case 'cw':
      return pick('enterprise', 'advanced', 'none');
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
 * This is intentionally stricter than the Worker's general SKU parsing. A
 * shared family licence such as LIC-ENT-3YR does not name the device it covers,
 * so the review UI must not claim that it is paired with one particular MR or
 * CW row. This first review contract is MX-only: legacy Z models have a
 * different blank-tier default from Z4, which cannot be inferred safely from
 * licenseFamilyForSku() alone.
 */
export function deviceLicenseTierFromSku(sku) {
  const value = String(sku || '').trim().toUpperCase();
  if (!value.startsWith('LIC-')) return '';
  const segments = value.slice(4).split('-').filter(Boolean);
  if (segments.includes('ENT') || segments.includes('ENTERPRISE')) return 'enterprise';
  if (segments.includes('SEC') || segments.includes('SECURITY')) return 'security';
  if (segments.includes('SDW') || segments.includes('SDWAN')) return 'sdwan';
  return '';
}

/** Effective reviewed tier for hardware whose concrete licence can be paired. */
export function effectivePairableHardwareTier(row) {
  const family = licenseFamilyForSku(row?.sku);
  if (family !== 'mx') return '';
  const selected = String(row?.tier || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
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
 * Derive read-only hardware/licence pairing annotations from the CURRENT rows.
 * No flag is persisted on a row, so changing a SKU, quantity, or tier always
 * recomputes the review and stale "paired" state cannot survive an edit.
 *
 * Pairing is conservative:
 * - only MX device-specific licences participate;
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

  list.forEach((row, index) => {
    const sku = String(row?.sku || '').trim().toUpperCase();
    if (!sku || sku.startsWith('LIC-')) return;
    const tier = effectivePairableHardwareTier(row);
    if (!tier) return;
    let group = hardwareGroups.find((candidate) => (
      candidate.tier === tier && sameDeviceIdentity(candidate.anchorSku, sku)
    ));
    if (!group) {
      group = { anchorSku: sku, tier, hardwareIndexes: [], licenseIndexes: [] };
      hardwareGroups.push(group);
    }
    group.hardwareIndexes.push(index);
  });

  list.forEach((row, index) => {
    const sku = String(row?.sku || '').trim().toUpperCase();
    const tier = deviceLicenseTierFromSku(sku);
    if (!tier) return;
    // licenseFamilyForSku() quite correctly calls every LIC-* row "license";
    // inspect its device token to keep this visual contract MX-only.
    const deviceFamily = licenseFamilyForSku(skuModelToken(sku));
    if (deviceFamily !== 'mx') return;
    const matches = hardwareGroups.filter((candidate) => (
      candidate.tier === tier && sameDeviceIdentity(candidate.anchorSku, sku)
    ));
    // Ambiguous identity must never be dressed up as a confirmed pairing.
    if (matches.length === 1) matches[0].licenseIndexes.push(index);
  });

  for (const group of hardwareGroups) {
    if (!group.licenseIndexes.length) continue;
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
    const exactProduct = licenseSkus.length === 1;
    const exactPair = exactProduct && hardwareQty !== null && licenseQty !== null && hardwareQty === licenseQty;
    const warmSparePair = allowHaLicenseRatio === true
      && exactProduct
      && hardwareQty !== null
      && licenseQty !== null
      && hardwareQty === licenseQty * 2;
    const kind = exactPair || warmSparePair ? 'paired' : 'mismatch';
    const common = {
      kind,
      hardwareQty,
      licenseQty,
      hardwareSkus,
      licenseSkus,
      tier: group.tier,
      ...(warmSparePair ? { warmSpare: true } : {}),
    };
    group.hardwareIndexes.forEach((index) => { review[index] = { ...common, role: 'hardware' }; });
    group.licenseIndexes.forEach((index) => { review[index] = { ...common, role: 'license' }; });
  }

  return review;
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
  return (value.startsWith('LIC-') ? value.slice(4) : value).split('-')[0];
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
export function termFromLicenseRows(rows) {
  const terms = new Set();
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const sku = String(row?.sku || '').toUpperCase();
    if (!sku.startsWith('LIC-')) continue;
    const match = sku.match(/-([135])YR?$/);
    if (match) terms.add(match[1]);
  }
  return terms.size === 1 ? [...terms][0] : null;
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
  const list = Array.isArray(rows) ? rows : [];
  const isLicense = (row) => /^LIC-/i.test(String(row?.sku || ''));
  const hardwareRows = list.filter((row) => !isLicense(row));
  const licenseRows = list.filter(isLicense);
  const isDerived = (row) => hardwareRows.some((hw) => sameDeviceIdentity(row?.sku, hw?.sku));
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
  const mode = hasTierOverride
    ? { ...inferred, tier: licenseTierModifier(overrides.tier) }
    : inferred;
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
  const hardwareOnlySkus = normalized.lines
    .filter((line, index) => rowHardwareOnly[index])
    .map((line) => line.sku);
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
    rows: [...committedRows, ...synthetic.lines.map(({ sku, qty }) => ({ sku, qty }))],
    text: [...combinedLines, ...modifiers].filter(Boolean).join('\n'),
    mode,
    error: '',
    errors: [],
  };
}
