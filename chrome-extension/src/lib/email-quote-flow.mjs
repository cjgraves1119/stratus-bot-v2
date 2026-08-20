const SAFE_SKU = /^[A-Z0-9][A-Z0-9._/-]{1,79}$/;
const STRATUS_ORDER_HOSTS = new Set(['stratusinfosystems.com', 'www.stratusinfosystems.com']);
const MAX_EMAIL_ORDER_URLS = 5;
const MAX_EDITABLE_QUOTE_LINES = 100;
const PRODUCT_OVERRIDE_KEYS = new Set([
  'skus',
  'license_term',
  'term_years',
  'renewal',
  'license_only',
  'hardware_only',
  'include_licenses',
  'ha_mode',
  'ha_recalculate_license_qty',
]);

function editableQuoteLineError(index, code, message) {
  return { index, code, message: `Line ${index + 1}: ${message}` };
}

/**
 * Strictly normalize user-edited quote lines without silently discarding any
 * row. This differs intentionally from normalizeQuoteIntakeLines(), whose
 * legacy intake behavior ignores unresolved parser output.
 *
 * The returned `lines` array is empty whenever validation fails so callers
 * cannot accidentally build a partial quote from the valid subset.
 */
export function normalizeEditableQuoteLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return {
      ok: false,
      lines: [],
      errors: [{ index: -1, code: 'no_lines', message: 'Add at least one SKU before updating the quote.' }],
      error: 'Add at least one SKU before updating the quote.',
    };
  }
  if (lines.length > MAX_EDITABLE_QUOTE_LINES) {
    const message = `A quote can contain at most ${MAX_EDITABLE_QUOTE_LINES} editable lines.`;
    return {
      ok: false,
      lines: [],
      errors: [{ index: -1, code: 'too_many_lines', message }],
      error: message,
    };
  }

  const quantities = new Map();
  const errors = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sku = String(line?.sku || '').trim().toUpperCase();
    const rawQty = line?.qty;
    const qtyText = typeof rawQty === 'number' ? String(rawQty) : String(rawQty ?? '').trim();
    const qty = /^\d{1,5}$/.test(qtyText) ? Number(qtyText) : NaN;

    if (!SAFE_SKU.test(sku)) {
      errors.push(editableQuoteLineError(index, 'invalid_sku', 'enter a valid 2-80 character SKU.'));
    }
    if (!Number.isInteger(qty) || qty < 1 || qty > 99999) {
      errors.push(editableQuoteLineError(index, 'invalid_quantity', 'quantity must be a whole number from 1 to 99,999.'));
    }
    if (!SAFE_SKU.test(sku) || !Number.isInteger(qty) || qty < 1 || qty > 99999) continue;

    const mergedQty = (quantities.get(sku) || 0) + qty;
    if (mergedQty > 99999) {
      errors.push(editableQuoteLineError(index, 'quantity_overflow', `${sku} exceeds the maximum merged quantity of 99,999.`));
      continue;
    }
    quantities.set(sku, mergedQty);
  }

  if (errors.length) {
    return { ok: false, lines: [], errors, error: errors[0].message };
  }
  return {
    ok: true,
    lines: [...quantities.entries()].map(([sku, qty]) => ({ sku, qty })),
    errors: [],
    error: '',
  };
}

export function editableQuoteSkuText(lines) {
  const normalized = normalizeEditableQuoteLines(lines);
  return normalized.ok
    ? { ...normalized, text: normalized.lines.map(({ sku, qty }) => `${qty} ${sku}`).join('\n') }
    : { ...normalized, text: '' };
}

// Stratus e-commerce URLs append -HW to a narrow set of Meraki hardware
// families. Do not generalize this equivalence to arbitrary Cisco SKUs.
const MERAKI_HARDWARE_BASE = /^(?:MR\d{2,3}[A-Z]*|MS\d{3}[A-Z0-9-]*|MX\d{2,3}[A-Z]*|MV\d{2,3}[A-Z]*|MT\d{2,3}[A-Z]*|MG\d{2,3}[A-Z]*|Z\d[A-Z0-9]*|CW\d{4}[A-Z]*)$/;

function canonicalOrderCompositionSku(value) {
  const sku = String(value || '').trim().toUpperCase();
  const regionalHardware = sku.match(/^(.+)-HW-(?:NA|WW)$/);
  if (regionalHardware && MERAKI_HARDWARE_BASE.test(regionalHardware[1])) {
    return regionalHardware[1];
  }
  if (sku.endsWith('-HW')) {
    const base = sku.slice(0, -3);
    if (MERAKI_HARDWARE_BASE.test(base)) return base;
  }
  if (sku.endsWith('-MR')) {
    const base = sku.slice(0, -3);
    if (/^CW916\d[A-Z]*$/.test(base)) return base;
  }
  if (sku.endsWith('-RTG')) {
    const base = sku.slice(0, -4);
    if (/^CW917\d[A-Z]*$/.test(base)) return base;
  }
  // Region-only variants ("MX67C-NA", "MX68CW-NA", "Z3C-HW-NA" -> handled above).
  // Some cellular/wireless models ship only as a regional SKU with no bare form in
  // the catalog, so a typed "MX67C" and the resolved "MX67C-NA" are the same
  // appliance. Without this they compare unequal and the edit path fails closed
  // even though the original URL was built correctly.
  const regionalOnly = sku.match(/^(.+)-(?:NA|WW)$/);
  if (regionalOnly && MERAKI_HARDWARE_BASE.test(regionalOnly[1])) return regionalOnly[1];
  return sku;
}

// A Cisco Wireless AP number with no radio-variant letter, as typed into the SKU
// editor: "CW9164" for CW9164I. Restricted to CW on purpose. In these families
// the bare number is never itself a product, only shorthand, so resolving it to
// the one catalog form in the URL cannot change which appliance is quoted.
//
// It must NOT be widened to Meraki families, where a trailing letter marks a
// genuinely different appliance: Z4 and Z4C, MX67 and MX67C, MX68 and MX68CW are
// distinct products, and treating one as a variant of the other would let a
// quote verify against hardware the rep did not commit. Those already resolve
// through canonicalOrderCompositionSku's narrow -HW/-NA/-WW equivalence.
const BARE_HARDWARE_STEM = /^CW\d{4}$/;

/**
 * Resolve a committed bare model stem to the single catalog form the URL used.
 *
 * The editor commits what the rep typed. Typing "5 CW9164s" leaves the row as
 * "CW9164" while the resolver builds "CW9164I-MR" (canonically "CW9164I"), and
 * the strict comparison then failed with "did not contain the committed quantity
 * for CW9164" — which blocked EVERY quote update on that cart, including edits
 * to unrelated rows (2026-08-19).
 *
 * Resolution is one-directional and requires exactly one candidate, so an
 * ambiguous stem still fails closed and an explicitly typed variant is never
 * satisfied by a different one.
 */
function resolveBareHardwareStems(expectedMap, actualMap) {
  if (!expectedMap || !actualMap) return expectedMap;
  const resolved = new Map();
  for (const [sku, qty] of expectedMap) {
    let key = sku;
    if (!actualMap.has(sku) && BARE_HARDWARE_STEM.test(sku)) {
      const stemPattern = new RegExp(`^${sku.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[A-Z]$`);
      const candidates = [...actualMap.keys()].filter((actualSku) => stemPattern.test(actualSku));
      if (candidates.length === 1) key = candidates[0];
    }
    resolved.set(key, (resolved.get(key) || 0) + qty);
  }
  return resolved;
}

function canonicalCompositionMap(lines) {
  const map = new Map();
  for (const { sku, qty } of lines) {
    const canonicalSku = canonicalOrderCompositionSku(sku);
    const next = (map.get(canonicalSku) || 0) + qty;
    if (next > 99999) return null;
    map.set(canonicalSku, next);
  }
  return map;
}

// Model shorthand typed in the SKU editor ("MX67C", "MR44") that the resolver
// expands into a full catalog SKU ("LIC-MX67C-ENT-3YR", "MR44-HW"). Used only as
// a fallback when the literal token is absent from the URL, so an exact match
// still takes the strict comparison path and stays as tight as before.
function bareModelAliasPattern(sku) {
  const value = String(sku || '').toUpperCase();
  if (!/^(?:MX|MS|MR|MV|MG|MT|CW|C9)[0-9][A-Z0-9]*(?:-[A-Z0-9]+)*$/.test(value)) return null;
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Licence expansion only. Hardware-suffix equivalence stays with
  // canonicalOrderCompositionSku, which is deliberately narrow (Meraki -HW/-NA/-WW)
  // so "-HW" is never stripped from arbitrary Cisco SKUs.
  return new RegExp(`^LIC-${escaped}-[A-Z0-9]+-\\d{1,2}Y(?:R)?$`);
}

function termAgnosticLicenseAliasPattern(sku) {
  const value = String(sku || '').toUpperCase();
  if (value === 'LIC-ENT' || value === 'MR-ENT') return /^LIC-ENT-(?:1|3|5)YR$/;
  if (value === 'LIC-MV') return /^LIC-MV-(?:1|3|5)YR$/;
  if (value === 'LIC-MT') return /^LIC-MT-(?:1|3|5)Y(?:R)?$/;
  // Deliberately does NOT cover model shorthand. Callers such as
  // verifyStratusOrderUrlOptions use this to decide whether a term-agnostic
  // licence was requested; widening it there would force a term label onto
  // hardware-only carts. Shorthand is resolved via bareModelAliasPattern.
  return null;
}

function termAgnosticLicenseAliasKey(sku) {
  const value = String(sku || '').toUpperCase();
  if (value === 'LIC-ENT' || value === 'MR-ENT') return 'LIC-ENT';
  if (value === 'LIC-MV') return 'LIC-MV';
  if (value === 'LIC-MT') return 'LIC-MT';
  return '';
}

/**
 * `hardwareOnlySkus` names committed rows that deliberately carry no licence
 * (the editor's per-line "None"). They are excluded from the companion quantity,
 * or a shared licence such as LIC-ENT would be required to cover access points
 * the rep explicitly asked to quote bare (2026-08-19).
 */
function automaticLicenseCompanionAssociation(sku, expectedMap, hardwareOnlySkus = null) {
  const bare = hardwareOnlySkus instanceof Set
    ? hardwareOnlySkus
    : new Set((Array.isArray(hardwareOnlySkus) ? hardwareOnlySkus : [])
      .map((value) => canonicalOrderCompositionSku(value)));
  const hardware = [...expectedMap.entries()]
    .filter(([value]) => !value.startsWith('LIC-') && !bare.has(value));
  if (!hardware.length) return null;
  const match = (key, predicate, haEligible = false) => {
    const expectedQty = hardware.reduce((sum, [item, qty]) => sum + (predicate(item) ? qty : 0), 0);
    return expectedQty > 0 ? { key, expectedQty, haEligible } : null;
  };

  const exactModel = sku.match(/^LIC-((?:MX|MG)\d+[A-Z]*)-/);
  if (exactModel) return match(exactModel[1], (item) => item === exactModel[1]
    || item.startsWith(`${exactModel[1]}-`)
    || (exactModel[1].startsWith('MG') && item === `${exactModel[1]}E`), exactModel[1].startsWith('MX'));

  const switchLicense = sku.match(/^LIC-(MS\d{3})-(.+)-(\d{1,2})Y(?:R)?$/);
  if (switchLicense) {
    const [, family, rawVariant] = switchLicense;
    if (/^CMPTA?$/.test(rawVariant)) {
      return match(`${family}:CMPT`, (item) => /^MS130(?:R)?-(?:8|12)/.test(item));
    }
    const portOnly = rawVariant.match(/^(\d+)[AE]?$/)?.[1] || '';
    if (portOnly) return match(`${family}:${portOnly}`, (item) => item.startsWith(`${family}-${portOnly}`));
    return match(`${family}:${rawVariant}`, (item) => item.startsWith(`${family}-${rawVariant}`));
  }

  const catalystLicense = sku.match(/^LIC-(C9\d{3}[LX]?)-(\d+)[AE]-(\d{1,2})Y(?:R)?$/);
  if (catalystLicense) {
    let family = catalystLicense[1];
    let port = catalystLicense[2];
    if (family === 'C9300L' || family === 'C9300X') family = 'C9300';
    if (port === '12' && family === 'C9300') port = '24';
    return match(`${family}:${port}`, (item) => {
      const parsed = item.match(/^(C9\d{3}[LX]?)-(\d+)/);
      if (!parsed) return false;
      let itemFamily = parsed[1];
      let itemPort = parsed[2];
      if (itemFamily === 'C9300L' || itemFamily === 'C9300X') itemFamily = 'C9300';
      if (itemPort === '12' && itemFamily === 'C9300') itemPort = '24';
      return itemFamily === family && itemPort === port;
    });
  }

  const c8Family = sku.match(/^LIC-(C8\d{3})-/);
  if (c8Family) return match(c8Family[1], (item) => item.startsWith(c8Family[1]));

  const zFamily = sku.match(/^LIC-(Z\d+C?)-/);
  if (zFamily) return match(zFamily[1], (item) => item === zFamily[1] || item.startsWith(`${zFamily[1]}X`));

  if (/^LIC-(?:ENT|MR)-/.test(sku)) return match('MR-CW', (item) => /^(?:MR|CW)\d/.test(item));
  if (/^LIC-MV-/.test(sku)) return match('MV', (item) => /^MV\d/.test(item));
  if (/^LIC-MT-/.test(sku)) return match('MT', (item) => /^MT\d/.test(item));
  return null;
}

function unusableOrderUrl(code, error, expectedLines = [], urlLines = []) {
  return { ok: false, usable: false, usableUrl: '', code, error, expectedLines, urlLines };
}

/**
 * Verify that a public Stratus order URL represents the committed editable
 * hardware/SKU lines. Automatically generated LIC-* companions are permitted,
 * but every requested line must be present at the exact quantity and no
 * unexpected non-license SKU may appear. A mismatch never returns a usable URL.
 */
export function verifyStratusOrderUrlComposition(value, expectedInputLines, requirements = {}) {
  const expected = normalizeEditableQuoteLines(expectedInputLines);
  if (!expected.ok) {
    return unusableOrderUrl('invalid_expected_lines', expected.error);
  }
  const safeUrl = sanitizeStratusOrderUrls([value])[0] || '';
  if (!safeUrl) {
    return unusableOrderUrl('invalid_order_url', 'The generated Stratus order URL was not valid.', expected.lines);
  }

  const url = new URL(safeUrl);
  const itemTokens = String(url.searchParams.get('item') || '').split(',').map((token) => token.trim());
  const qtyTokens = String(url.searchParams.get('qty') || '').split(',').map((token) => token.trim());
  if (!itemTokens.length || itemTokens.length !== qtyTokens.length) {
    return unusableOrderUrl('invalid_url_composition', 'The generated order URL had mismatched item and quantity fields.', expected.lines);
  }
  const actual = normalizeEditableQuoteLines(itemTokens.map((sku, index) => ({ sku, qty: qtyTokens[index] })));
  if (!actual.ok) {
    return unusableOrderUrl('invalid_url_composition', 'The generated order URL contained an invalid line item.', expected.lines);
  }

  const expectedMap = resolveBareHardwareStems(
    canonicalCompositionMap(expected.lines),
    canonicalCompositionMap(actual.lines),
  );
  const actualMap = canonicalCompositionMap(actual.lines);
  if (!expectedMap || !actualMap) {
    return unusableOrderUrl('invalid_url_composition', 'The generated order URL exceeded safe quantity limits.', expected.lines, actual.lines);
  }
  const bareHardwareSkus = new Set(
    (Array.isArray(requirements?.hardwareOnlySkus) ? requirements.hardwareOnlySkus : [])
      .map((value) => canonicalOrderCompositionSku(value)),
  );
  const allowedAliasActualSkus = new Set();
  const aliasGroups = new Map();
  // Aliases resolved from model shorthand. The shorthand IS the license line, so
  // it must not also be counted as hardware owed an automatic companion license.
  const shorthandAliasKeys = new Set();
  for (const [sku, qty] of expectedMap) {
    const aliasKey = termAgnosticLicenseAliasKey(sku);
    if (aliasKey) {
      aliasGroups.set(aliasKey, (aliasGroups.get(aliasKey) || 0) + qty);
      continue;
    }
    if (actualMap.get(sku) !== qty) {
      // The literal token is missing from the URL. Before failing, allow model
      // shorthand the resolver expanded into a full catalog SKU — but only when
      // exactly one URL line matches, so an ambiguous expansion still fails closed.
      if (!actualMap.has(sku)) {
        const shorthand = bareModelAliasPattern(sku);
        if (shorthand && [...actualMap.keys()].filter((actualSku) => shorthand.test(actualSku)).length === 1) {
          aliasGroups.set(sku, (aliasGroups.get(sku) || 0) + qty);
          shorthandAliasKeys.add(sku);
          continue;
        }
      }
      return unusableOrderUrl('composition_mismatch', `The generated order URL did not contain the committed quantity for ${sku}.`, expected.lines, actual.lines);
    }
  }
  for (const [aliasKey, explicitQty] of aliasGroups) {
    const aliasPattern = shorthandAliasKeys.has(aliasKey)
      ? bareModelAliasPattern(aliasKey)
      : termAgnosticLicenseAliasPattern(aliasKey);
    const aliasMatches = [...actualMap.entries()].filter(([actualSku]) => aliasPattern.test(actualSku));
    if (aliasMatches.length !== 1) {
      return unusableOrderUrl('composition_mismatch', `The generated order URL did not contain one unambiguous ${aliasKey} term license.`, expected.lines, actual.lines);
    }
    const [actualSku, actualQty] = aliasMatches[0];
    const automaticQty = shorthandAliasKeys.has(aliasKey)
      ? 0
      : (automaticLicenseCompanionAssociation(actualSku, expectedMap, bareHardwareSkus)?.expectedQty || 0);
    if (actualQty !== explicitQty + automaticQty) {
      return unusableOrderUrl('composition_mismatch', `The generated order URL did not contain the committed quantity for ${aliasKey}.`, expected.lines, actual.lines);
    }
    allowedAliasActualSkus.add(actualSku);
  }
  const automaticLicenseAssociations = new Set();
  for (const [sku, qty] of actualMap) {
    if (expectedMap.has(sku)) continue;
    if (allowedAliasActualSkus.has(sku)) continue;
    const companion = sku.startsWith('LIC-') ? automaticLicenseCompanionAssociation(sku, expectedMap, bareHardwareSkus) : null;
    if (!companion) {
      return unusableOrderUrl('composition_mismatch', `The generated order URL contained an unexpected item (${sku}).`, expected.lines, actual.lines);
    }
    if (automaticLicenseAssociations.has(companion.key)) {
      return unusableOrderUrl('composition_mismatch', `The generated order URL contained duplicate license companions for ${companion.key}.`, expected.lines, actual.lines);
    }
    const validQty = qty === companion.expectedQty
      || (requirements?.allowHaLicenseRatio === true
        && companion.haEligible === true
        && companion.expectedQty % 2 === 0
        && qty === companion.expectedQty / 2);
    if (!validQty) {
      return unusableOrderUrl('composition_mismatch', `The generated order URL contained the wrong license quantity for ${sku}.`, expected.lines, actual.lines);
    }
    automaticLicenseAssociations.add(companion.key);
  }

  return {
    ok: true,
    usable: true,
    usableUrl: safeUrl,
    code: '',
    error: '',
    expectedLines: expected.lines,
    urlLines: actual.lines,
  };
}

/**
 * Verify an entire displayed option set against one committed SKU/quantity
 * snapshot. A single mismatch suppresses the whole set so callers cannot
 * publish a partly stale collection of Copy/Open actions.
 */
/**
 * Restate committed licence lines at a specific term.
 *
 * The committed cart describes PRODUCTS and QUANTITIES; the 1/3/5-year options are
 * term variants of that same cart. Comparing an explicit committed term SKU
 * ("LIC-ENT-1YR", e.g. after picking one from the read-only autocomplete or
 * applying a suggestion chip) against every option meant two of the three options
 * could never match, and one mismatch suppresses the whole set — so choosing a
 * concrete term SKU silently killed every link.
 *
 * Only the term digits change: family, tier and quantity are untouched, and the
 * caller still enforces that every licence in the option carries that option's
 * term. Passing a non-integer term leaves the lines alone.
 */
function committedLinesAtTerm(lines, term) {
  if (!Number.isInteger(term)) return lines;
  return lines.map((line) => {
    const sku = String(line?.sku || '').toUpperCase();
    const match = sku.match(/^(LIC-.+?)-(\d{1,2})(YR|Y)$/);
    if (!match) return line;
    return { ...line, sku: `${match[1]}-${term}${match[3]}` };
  });
}

export function verifyStratusOrderUrlOptions(values, expectedInputLines, requirements = {}) {
  const options = Array.isArray(values) ? values : [];
  if (!options.length) {
    return { ok: false, urls: [], error: 'No current quote link was generated for the committed SKU quantities.' };
  }
  const urls = [];
  const expected = normalizeEditableQuoteLines(expectedInputLines);
  const hasTermAgnosticLicenseAlias = expected.ok
    && expected.lines.some(({ sku }) => termAgnosticLicenseAliasPattern(sku));
  const requestedTier = String(requirements?.licenseTier || '').trim().toUpperCase();
  // When every hardware row was committed as "None (hardware only)" the cart IS
  // hardware-only, whatever the original request said, so demanding a licensed
  // term option rejects a correct quote with "No licensed term option was
  // generated" (2026-08-19).
  const bareRows = new Set(
    (Array.isArray(requirements?.hardwareOnlySkus) ? requirements.hardwareOnlySkus : [])
      .map((value) => canonicalOrderCompositionSku(value)),
  );
  const committedHardware = expected.ok
    ? expected.lines.filter(({ sku }) => !String(sku).toUpperCase().startsWith('LIC-'))
    : [];
  const everyHardwareRowIsBare = bareRows.size > 0 && committedHardware.length > 0
    && committedHardware.every(({ sku }) => bareRows.has(canonicalOrderCompositionSku(sku)));
  const requireLicensedOption = !everyHardwareRowIsBare
    && (requirements?.requireLicensedOption === true
      || (['ENT', 'SEC', 'SDW', 'A'].includes(requestedTier) && requirements?.requireLicensedOption !== false));
  let sawLicensedOption = false;
  // An option that does not match the committed cart is DROPPED, not fatal to the
  // whole set. The worker legitimately offers alternative representations of the
  // same request: for an end-of-life model it returns both a licence for the unit
  // already owned and a replacement-hardware option, and the committed cart can
  // only ever match one family. Suppressing everything left the rep with no link
  // at all (2026-08-19). The safety property is unchanged, and in fact stated more
  // directly: every URL returned here has been verified against the CURRENT
  // committed rows, so a stale or mismatched option can never be published.
  const dropped = [];
  optionLoop:
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const rawUrl = option && typeof option === 'object' ? option.url : option;
    // Compare against the committed cart restated at THIS option's term, so an
    // explicit term SKU in the editor does not invalidate the other term options.
    const optionTerm = option && typeof option === 'object' && option.hardwareOnly === true
      ? null
      : quoteOptionTerm({ label: option?.label || '', url: rawUrl || '' });
    const expectedForOption = Number.isInteger(optionTerm)
      ? committedLinesAtTerm(expected.ok ? expected.lines : expectedInputLines, optionTerm)
      : expectedInputLines;
    const verification = verifyStratusOrderUrlComposition(rawUrl, expectedForOption, requirements);
    if (verification.usable !== true || !verification.usableUrl) {
      // Drop this representation, keep looking. See the note on `dropped`.
      dropped.push({
        option: index + 1,
        label: String(option?.label || `Option ${index + 1}`),
        reason: verification.error || `Quote option ${index + 1} did not match the committed SKU quantities.`,
      });
      continue optionLoop;
    }
    const licenseLines = verification.urlLines.filter(({ sku }) => String(sku).startsWith('LIC-'));
    const hardwareOnly = option && typeof option === 'object' && option.hardwareOnly === true;
    const expectedTier = String(requirements?.licenseTier || '').trim().toUpperCase();
    if (hardwareOnly && licenseLines.length) {
      { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: 'The Hardware Only option unexpectedly contained a license SKU.' }); continue optionLoop; }
    }
    if (!hardwareOnly) {
      if (['ENT', 'SEC', 'SDW', 'A'].includes(expectedTier) && !licenseLines.length) {
        { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: `The generated option did not contain a license SKU when ${expectedTier} was requested.` }); continue optionLoop; }
      }
      const labelTerm = quoteOptionTerm({ label: option?.label || '', url: '' });
      if (hasTermAgnosticLicenseAlias && labelTerm == null) {
        { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: 'The generated option did not identify a term for the term-agnostic license request.' }); continue optionLoop; }
      }
      if (labelTerm != null) {
        if (!licenseLines.length) {
          { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: `The ${labelTerm}-year option did not contain a license SKU.` }); continue optionLoop; }
        }
        for (const { sku } of licenseLines) {
          const term = String(sku).match(/-(\d{1,2})(?:Y|YR)$/i);
          if (!term || Number(term[1]) !== labelTerm) {
            { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: `The ${labelTerm}-year option contained a mismatched license term (${sku}).` }); continue optionLoop; }
          }
        }
      }
      if (['ENT', 'SEC', 'SDW'].includes(expectedTier)) {
        for (const { sku } of licenseLines) {
          const tier = String(sku).match(/(?:^LIC-|-)\b(ENT|SEC|SDW)-/i)?.[1]?.toUpperCase() || '';
          const requiresNamedTier = /^LIC-(?:(?:MX|MG)\d|C8\d{3}|Z\d|ENT-|MR-)/i.test(String(sku));
          if ((requiresNamedTier && tier !== expectedTier) || (tier && tier !== expectedTier)) {
            { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: `The generated option contained a ${tier || 'missing/unknown'} license tier when ${expectedTier} was requested (${sku}).` }); continue optionLoop; }
          }
        }
      } else if (expectedTier === 'A') {
        for (const { sku } of licenseLines) {
          const value = String(sku).toUpperCase();
          const tieredSwitchLicense = /^LIC-(?:C9\d{3}[LX]?-\d+[AE]|MS(?:130|150)-(?:CMPTA?|\d+A?)|MS390-\d+[AE])-\d{1,2}Y(?:R)?$/.test(value);
          const advancedSwitchLicense = /^LIC-(?:C9\d{3}[LX]?-\d+A|MS(?:130|150)-(?:CMPTA|\d+A)|MS390-\d+A)-\d{1,2}Y(?:R)?$/.test(value);
          if (tieredSwitchLicense && !advancedSwitchLicense) {
            { dropped.push({ option: index + 1, label: String(option?.label || `Option ${index + 1}`), reason: `The generated option contained an Essentials license when Advanced was requested (${sku}).` }); continue optionLoop; }
          }
        }
      }
      if (licenseLines.length) sawLicensedOption = true;
    }
    urls.push(option && typeof option === 'object'
      ? { ...option, url: verification.usableUrl }
      : { label: `Option ${index + 1}`, url: verification.usableUrl });
  }
  if (!urls.length) {
    return {
      ok: false,
      urls: [],
      dropped,
      error: dropped[0]?.reason || 'No quote option matched the committed SKU quantities.',
    };
  }
  if (requireLicensedOption && !sawLicensedOption) {
    return { ok: false, urls: [], dropped, error: 'No licensed term option was generated for this quote request.' };
  }
  return { ok: true, urls, dropped, error: '' };
}

export function normalizeQuoteIntakeLines(lines) {
  const quantities = new Map();
  for (const line of Array.isArray(lines) ? lines : []) {
    if (!line || line.status !== 'resolved') continue;
    const sku = String(line.sku || '').trim().toUpperCase();
    const qty = Number(line.qty);
    if (!SAFE_SKU.test(sku) || !Number.isInteger(qty) || qty < 1 || qty > 99999) continue;
    const nextQty = (quantities.get(sku) || 0) + qty;
    if (nextQty > 99999) return [];
    quantities.set(sku, nextQty);
  }
  return [...quantities.entries()].map(([sku, qty]) => ({ sku, qty }));
}

export function sanitizeStratusOrderUrls(values) {
  const urls = [];
  const seen = new Set();
  // Preserve Gmail's oldest-to-newest DOM order. Intake selects the final valid
  // entry as the current cart and never merges multiple order URLs.
  const candidates = Array.isArray(values) ? values : [];
  for (const value of candidates) {
    const raw = String(value || '').trim();
    if (!raw || raw.length > 2000) continue;
    try {
      const url = new URL(raw);
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.hash) continue;
      if (!STRATUS_ORDER_HOSTS.has(url.hostname.toLowerCase()) || url.pathname !== '/order/') continue;
      if (url.searchParams.getAll('item').length !== 1 || url.searchParams.getAll('qty').length !== 1) continue;
      if (!url.searchParams.get('item') || !url.searchParams.get('qty')) continue;
      const normalized = url.toString();
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      urls.push(normalized);
      if (urls.length > MAX_EMAIL_ORDER_URLS) urls.shift();
    } catch { /* invalid or non-URL values are ignored */ }
  }
  return urls;
}

export function applyMxWarmSpareToOrderUrl(value) {
  const safe = sanitizeStratusOrderUrls([value])[0] || '';
  if (!safe) return '';
  const url = new URL(safe);
  const items = String(url.searchParams.get('item') || '').split(',').map((item) => item.trim().toUpperCase());
  const qtys = String(url.searchParams.get('qty') || '').split(',').map(Number);
  const mxHardware = new Map();
  for (let index = 0; index < items.length; index += 1) {
    const canonicalSku = canonicalOrderCompositionSku(items[index]);
    if (!/^MX[A-Z0-9]+$/.test(canonicalSku)) continue;
    // A URL containing both a canonical and suffixed spelling for the same MX
    // model is ambiguous; do not guess which license line belongs to which row.
    if (mxHardware.has(canonicalSku)) return '';
    mxHardware.set(canonicalSku, { index, qty: qtys[index] });
  }
  if (!mxHardware.size) return '';
  for (const { qty } of mxHardware.values()) {
    if (!Number.isInteger(qty) || qty < 2 || qty % 2 !== 0) return '';
  }
  const matched = new Set();
  for (let index = 0; index < items.length; index += 1) {
    const match = items[index].match(/^LIC-(MX[A-Z0-9]+)-(?:ENT|SEC|SDW)-[1-5]Y(?:R)?$/);
    if (!match || !mxHardware.has(match[1])) continue;
    if (matched.has(match[1])) return '';
    const hardware = mxHardware.get(match[1]);
    if (qtys[index] !== hardware.qty && qtys[index] !== hardware.qty / 2) return '';
    qtys[index] = hardware.qty / 2;
    matched.add(match[1]);
  }
  if (matched.size !== mxHardware.size) return '';
  // Keep the canonical Stratus order-link shape. URLSearchParams.set() would
  // encode the comma separators as %2C, which is technically decodable but is
  // not the stable human-reviewable format used everywhere else in the app.
  return `https://stratusinfosystems.com/order/?item=${items.join(',')}&qty=${qtys.join(',')}`;
}

/** Apply the 2:1 MX warm-spare rule only from an explicit trusted HA boolean. */
export function applyExplicitMxWarmSpareToQuoteOptions(values, haRequested) {
  const options = Array.isArray(values) ? values : [];
  if (haRequested !== true) return options.slice();
  const adjustedOptions = [];
  for (const option of options) {
    if (option && typeof option === 'object' && option.hardwareOnly === true) {
      adjustedOptions.push({ ...option });
      continue;
    }
    const rawUrl = option && typeof option === 'object' ? option.url : option;
    const adjusted = applyMxWarmSpareToOrderUrl(rawUrl);
    if (!adjusted) return [];
    adjustedOptions.push(option && typeof option === 'object' ? { ...option, url: adjusted } : adjusted);
  }
  return adjustedOptions;
}

/**
 * Recognize only explicit MX/firewall high-availability intent. Quantities,
 * generic redundancy language, and unrelated spare parts must never enable
 * the shared-license workflow. A nearby negation wins fail-closed.
 */
export function hasExplicitMxHaIntent(value) {
  const text = String(value || '').toUpperCase().replace(/[’]/g, "'");
  const intent = /\b(?:WARM(?:[\s-]+)SPARES?|HIGH(?:[\s-]+)AVAILABILITY|HIGHLY(?:[\s-]+)AVAILABLE|ACTIVE(?:[\s/-]+)(?:PASSIVE|STANDBY)|HA(?:[\s-]+(?:PAIR|CONFIG(?:URATION)?|SETUP))?|FAILOVER|SPARES?(?:[\s-]+)(?:MX[A-Z0-9-]*|FIREWALLS?|APPLIANCES?|UNITS?|DEVICES?|EQUIPMENT))\b/g;
  const boundary = '[,;:?!./()\\[\\]—–-]';
  const leadingBoundary = `^\\s*(?:${boundary}+\\s*)*`;
  const testsAny = (subject, patterns) => patterns.some((pattern) => pattern.test(subject));
  const stripMx84Exclusions = (subject) => subject.replace(
    /\b(?:NO|WITHOUT|EXCLUD(?:E|ES|ED|ING)|REMOV(?:E|ES|ED|ING))\s+(?:(?:THE|ANY)\s+)?(?:(?:HISTORICAL|OLD|LEGACY|PREVIOUS|PRIOR)\s+)?MX84(?:-HW(?:-(?:NA|WW))?)?S?\b/g,
    ' ',
  );
  // Keep positive and negative governing verbs structurally symmetric. Any
  // negated action that could otherwise authorize HA must win fail-closed;
  // affirmative double-negatives are exempted at the call site below.
  const governingActionPattern = String.raw`(?:EXPLICIT(?:LY)?|APPROV(?:E|ES|ED|ING)|AUTHORIZ(?:E|ES|ED|ING)|CONFIRM(?:S|ED|ING)?|COMMIT(?:S|TED|TING)?\s+TO|SIGN(?:S|ED|ING)?\s+OFF\s+ON|ELECT(?:S|ED|ING)?|CONFIGUR(?:E|ES|ED|ING)|US(?:E|ES|ED|ING)|INCLUD(?:E|ES|ED|ING)|ENABL(?:E|ES|ED|ING)|ACTIVAT(?:E|ES|ED|ING)|TURN(?:S|ED|ING)?(?:\s+ON)?|SWITCH(?:ES|ED|ING)?\s+ON|SET(?:S|TING)?(?:\s+UP)?|DEPLOY(?:S|ED|ING)?|IMPLEMENT(?:S|ED|ING)?|PROCEED(?:S|ED|ING)?|PROVID(?:E|ES|ED|ING)|GIV(?:E|ES|ING)|GAVE|ENSUR(?:E|ES|ED|ING)|MAK(?:E|ES|ING)|APPL(?:Y|IES|IED|YING)|BUILD(?:S|ING)?|DELIVER(?:S|ED|ING)?|DESIGN(?:S|ED|ING)?|PUT(?:S|TING)?|PLAC(?:E|ES|ED|ING)|KEEP(?:S|ING)?|OPT(?:S|ED|ING)?\s+FOR|DECID(?:E|ES|ED|ING)|ASK(?:S|ED|ING)?\s+FOR|MUST(?:\s+HAVE)?|WOULD\s+LIKE|REQUIRE(?:S|D|ING)?|NEED(?:S|ED|ING)?|WANT(?:S|ED|ING)?|PREFER(?:S|RED|RING)?|SELECT(?:S|ED|ING)?|CHOOSE|CHOSE|REQUEST(?:S|ED|ING)?|QUOTE(?:S|D|ING)?|ADD(?:S|ED|ING)?|RUN(?:S|NING)?|AS|WITH)`;
  const negatedGoverningActionPattern = new RegExp(
    String.raw`\b(?:DO\s+NOT|DON'T|DOES\s+NOT|DOESN'T|DID\s+NOT|DIDN'T|HAVE\s+NOT|HAVEN'T|HAS\s+NOT|HASN'T|HAD\s+NOT|HADN'T|IS\s+NOT|ISN'T|ARE\s+NOT|AREN'T|WAS\s+NOT|WASN'T|WERE\s+NOT|WEREN'T|NEED\s+NOT|NEEDN'T|NEVER|CANNOT|CAN'T|WILL\s+NOT|WON'T|SHALL\s+NOT|SHAN'T|SHOULD\s+NOT|SHOULDN'T|WOULD\s+NOT|WOULDN'T|COULD\s+NOT|COULDN'T|MAY\s+NOT|MIGHT\s+NOT|MUST\s+NOT|MUSTN'T|NOT)\b[^.!?;\n]{0,100}\b(?:${governingActionPattern}|HAV(?:E|ES|ING)|HAD|LEAV(?:E|ES|ING))\b(?:\s+[A-Z0-9'-]+){0,10}\s*$`,
  );

  for (const match of text.matchAll(intent)) {
    const afterStart = match.index + match[0].length;
    const beforeAll = text.slice(0, match.index);
    const sentenceStart = Math.max(
      beforeAll.lastIndexOf('.'), beforeAll.lastIndexOf('!'), beforeAll.lastIndexOf('?'),
      beforeAll.lastIndexOf(';'), beforeAll.lastIndexOf('\n'),
    ) + 1;
    const afterAll = text.slice(afterStart);
    const sentenceBoundary = afterAll.search(/[.!?;\n]/);
    const sentenceEnd = sentenceBoundary < 0 ? text.length : afterStart + sentenceBoundary + 1;
    const rawPrefix = text.slice(sentenceStart, match.index);
    const rawTail = text.slice(afterStart, afterStart + 180);
    const excludedHistoricalMx84HaScope = testsAny(rawTail, [
      /^\s+(?:FOR|ON|WITH)\s+(?:THE\s+)?(?:HISTORICAL|OLD|LEGACY|PREVIOUS|PRIOR)\s+MX84(?:-HW(?:-(?:NA|WW))?)?S?\s+ONLY\b/,
    ]) || /\b(?:NO|WITHOUT|EXCLUD(?:E|ES|ED|ING))\s+(?:(?:THE|ANY)\s+)?(?:(?:HISTORICAL|OLD|LEGACY|PREVIOUS|PRIOR)\s+)?MX84(?:-HW(?:-(?:NA|WW))?)?S?\s*$/.test(rawPrefix);
    if (excludedHistoricalMx84HaScope) continue;
    const sentence = stripMx84Exclusions(text.slice(sentenceStart, sentenceEnd));
    const prefix = stripMx84Exclusions(text.slice(sentenceStart, match.index));
    const localTail = stripMx84Exclusions(text.slice(afterStart, sentenceEnd));
    const tail = stripMx84Exclusions(text.slice(afterStart, afterStart + 180));

    // These are affirmative double negatives, not vetoes: "do not omit HA",
    // "never switch off HA", "HA is not optional", and equivalent wording.
    const affirmativeDoubleNegative = testsAny(prefix, [
      /\b(?:DO\s+NOT|DON'T|NEVER)\s+(?:(?:EVER|PLEASE|ACCIDENTALLY)\s+)?(?:FORGET|OMIT|SKIP|LEAVE\s+OUT|TURN\s+OFF|SWITCH\s+OFF|KEEP\s+OFF|EXCLUD(?:E|ES|ED|ING)|DISABL(?:E|ES|ED|ING)|AVOID|REMOVE|PROHIBIT)\s+(?:(?:A|AN|THE)\s+)?$/,
      new RegExp(String.raw`\b(?:DO\s+NOT|DON'T|NEVER|CANNOT|CAN'T|MUST\s+NOT|MUSTN'T|SHOULD\s+NOT|SHOULDN'T)\b[^.!?;\n]{0,100}\b(?:FORGET|FAIL|NEGLECT|HESITATE)\s+TO\s+${governingActionPattern}\b(?:\s+[A-Z0-9'-]+){0,8}\s*$`),
      /\bWITHOUT\s+(?:OMITTING|SKIPPING|LEAVING\s+OUT|TURNING\s+OFF|SWITCHING\s+OFF|KEEPING\s+OFF|EXCLUDING|DISABLING|REMOVING)\s+(?:(?:A|AN|THE)\s+)?$/,
      /\b(?:DO\s+NOT|DON'T|CANNOT|CAN'T|WILL\s+NOT|WON'T|MUST\s+NOT|MUSTN'T|NEVER)\b(?:\s+[A-Z0-9'-]+){0,8}\s+WITHOUT\s+(?:(?:A|AN|THE)\s+)?$/,
    ]);
    const affirmativeNegativeTail = testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:(?:IS|ARE|WAS|WERE|SHOULD|WOULD|MUST|CAN|WILL)\\s+(?:CURRENTLY\\s+)?NOT|(?:ISN'T|AREN'T|WASN'T|WEREN'T|SHOULDN'T|WOULDN'T|MUSTN'T|CAN'T|CANNOT|WON'T)|NOT)\\s+(?:BE\\s+|REMAIN\\s+)?(?:OPTIONAL|STANDARD(?:\\s+(?:LICENSING|MODE|DEPLOYMENT))?|STANDALONE(?:\\s+MODE)?)\\b`),
      new RegExp(`${leadingBoundary}(?:(?:IS|ARE|WAS|WERE|SHOULD|WOULD|MUST|CAN|WILL)\\s+(?:CURRENTLY\\s+)?NOT|(?:ISN'T|AREN'T|WASN'T|WEREN'T|SHOULDN'T|WOULDN'T|MUSTN'T|CAN'T|CANNOT|WON'T))\\s+(?:BE\\s+)?(?:OMITTED|SKIPPED|LEFT\\s+OUT|EXCLUDED|DISABLED|AVOIDED|REMOVED|PROHIBITED|TURNED\\s+OFF|SWITCHED\\s+OFF)\\b`),
      new RegExp(`${leadingBoundary}(?:IS|ARE)\\s+NON[-\\s]?OPTIONAL\\b`),
    ]);

    // An explicit negative governing this mention always wins, except for the
    // narrow affirmative double-negative forms above.
    const negativeTail = testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:(?:(?:IS|ARE|WAS|WERE|BE|SHOULD|WOULD|MUST|CAN|WILL|HAS|HAVE|REMAINS?|STAYS?)\\s+)?(?:(?:CURRENTLY|PRESENTLY|NOW|ACTUALLY|REALLY|PROBABLY)\\s+)?NOT\\b|(?:(?:IS|ARE|WAS|WERE|HAS|HAVE|REMAINS?|STAYS?)\\s+)?(?:NO\\s+LONGER|NEVER)\\b|(?:ISN'T|AREN'T|WASN'T|WEREN'T|SHOULDN'T|WOULDN'T|MUSTN'T|CAN'T|CANNOT|WON'T)\\b)`),
      new RegExp(`${leadingBoundary}(?:(?:IS|ARE|WAS|WERE|REMAINS?|STAYS?)\\s+|(?:SHOULD|WOULD|MUST|CAN|WILL)\\s+BE\\s+)?(?:OFF|OPTIONAL|UNNEEDED|UNNECESSARY|UNWANTED|UNSUPPORTED|UNAVAILABLE|IMPOSSIBLE|FORBIDDEN|PROHIBITED|REJECTED|DECLINED|CANCELLED|EXCLUDED|DISABLED|OMITTED|SKIPPED|AVOIDED|OUT\\s+OF\\s+SCOPE|RULED\\s+OUT)\\b`),
      new RegExp(`${leadingBoundary}(?:WAS|IS|HAS\\s+BEEN)\\s+(?:REJECTED|DECLINED|CANCELLED|EXCLUDED|DISABLED|RULED\\s+OUT)\\b`),
    ]);
    const standaloneNoTail = sentence.includes('?')
      && new RegExp(`${leadingBoundary}NO(?:\\s+THANKS?)?(?=\\s|[.!?,;:]|$)`).test(tail);
    if (!affirmativeNegativeTail && (negativeTail || standaloneNoTail)) continue;

    const directNegative = !affirmativeDoubleNegative && testsAny(prefix, [
      /\bNON[-\s]*$/,
      /\b(?:NO|NOT|WITHOUT|AVOID|OMIT|SKIP|REJECT(?:S|ED|ING)?|DECLIN(?:E|ES|ED|ING)|EXCLUD(?:E|ES|ED|ING)|DISABL(?:E|ES|ED|ING)|PROHIBIT|REMOVE)\s+(?:(?:A|AN|THE)\s+)?$/,
      negatedGoverningActionPattern,
      /\b(?:NO|NEITHER)\s+(?:CUSTOMERS?|CLIENTS?|USERS?|ONE|PERSON|TEAM|SITE)\b(?:\s+[A-Z0-9'-]+){0,6}\s+(?:APPROV(?:E|ES|ED)|CONFIRM(?:S|ED)?|CHOSE|SELECT(?:S|ED)?|PREFER(?:S|RED)?|REQUEST(?:S|ED)?|ASK(?:S|ED)?|WANT(?:S|ED)?|NEED(?:S|ED)?|INCLUD(?:E|ES|ED)?)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\b(?:NONE\s+OF\s+(?:(?:THE|OUR|THEIR)\s+)?(?:OPTIONS?|CONFIGURATIONS?|DESIGNS?|QUOTES?)|NO\s+ONE|NOBODY)\b(?:\s+[A-Z0-9'-]+){0,8}\s+(?:APPROV(?:E|ES|ED)|CONFIRM(?:S|ED)?|CHOSE|SELECT(?:S|ED)?|PREFER(?:S|RED)?|REQUEST(?:S|ED)?|ASK(?:S|ED)?|WANT(?:S|ED)?|NEED(?:S|ED)?|INCLUD(?:E|ES|ED)?)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\b(?:THERE\s+IS|WE\s+HAVE|CUSTOMERS?\s+HAVE)\s+NO\s+(?:(?:CURRENT|PRESENT)\s+)?(?:NEEDS?|REQUIREMENTS?|REQUESTS?|DESIRES?|PLANS?|INTENTIONS?)\s+(?:FOR|OF\s+(?:USING|CONFIGURING|INCLUDING|ENABLING|DEPLOYING)|TO\s+(?:USE|CONFIGURE|INCLUDE|ENABLE|DEPLOY))\s*$/,
      /\bNO\s+(?:(?:CURRENT|PRESENT)\s+)?(?:NEEDS?|REQUIREMENTS?|REQUESTS?|DESIRES?|PLANS?|INTENTIONS?)\s+(?:FOR|OF\s+(?:USING|CONFIGURING|INCLUDING|ENABLING|DEPLOYING)|TO\s+(?:USE|CONFIGURE|INCLUDE|ENABLE|DEPLOY))\s*$/,
      /\b(?:REFUS(?:E|ES|ED|ING)|DECLIN(?:E|ES|ED|ING))\s+TO\s+(?:USE|INCLUDE|ENABLE|CONFIGURE|DEPLOY|ADD|QUOTE)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:DECID(?:E|ES|ED|ING)|ELECT(?:S|ED|ING)?|CHOSE|CHOOSE)\s+(?:NOT\s+TO|AGAINST)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:OPT(?:S|ED|ING)?\s+OUT\s+OF|VOT(?:E|ES|ED|ING)\s+AGAINST|DECID(?:E|ES|ED|ING)\s+AGAINST|MOVE(?:S|D|ING)?\s+AWAY\s+FROM)\s*$/,
      /\b(?:INSTEAD\s+OF|RATHER\s+THAN|IN\s+PLACE\s+OF|OVER|AGAINST|OUT\s+OF)\s*$/,
      /\b(?:PREFER(?:S|RED|RING)?|SELECT(?:S|ED|ING)?|CHOOS(?:E|ES|ING)|CHOSE|USE(?:S|D|ING)?)\b(?:\s+[A-Z0-9'-]+){1,8}\s+(?:TO|OVER|RATHER\s+THAN|INSTEAD\s+OF|IN\s+PLACE\s+OF)\s*$/,
      /\b(?:TURN(?:S|ED|ING)?|SWITCH(?:ES|ED|ING)?|KEEP(?:S|ING)?)\s+(?:IT\s+)?OFF(?:\s+[A-Z0-9'-]+){0,4}\s*$/,
      /\b(?:STOP(?:S|PED|PING)?|CEAS(?:E|ES|ED|ING))\s+(?:WANTING|NEEDING|REQUIRING|REQUESTING|ASKING|INCLUDING|USING|ENABLING|CONFIGURING|DEPLOYING|ADDING)(?:\s+[A-Z0-9'-]+){0,6}\s*$/,
      /\b(?:AVOID|OMIT|SKIP|EXCLUD(?:E|ES|ED|ING)|DISABL(?:E|ES|ED|ING)|PROHIBIT|REMOVE)\s+(?:WANTING|NEEDING|REQUIRING|REQUESTING|ASKING|INCLUDING|USING|ENABLING|CONFIGURING|DEPLOYING|ADDING)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\bWITHOUT\s+(?:CURRENTLY\s+)?(?:WANTING|NEEDING|REQUIRING|REQUESTING|ASKING|INCLUDING|USING|ENABLING|CONFIGURING|DEPLOYING|ADDING)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:AVOID|OMIT|SKIP|EXCLUD(?:E|ES|ED|ING)|DISABL(?:E|ES|ED|ING)|PROHIBIT|REMOVE)\s+(?:ANY\s+)?(?:USE|INCLUSION|CONFIGURATION|DEPLOYMENT|ENABLEMENT)\s+OF\s*$/,
      /\b(?:WITHDRAW(?:S|ING)?|WITHDREW|CANCEL(?:S|LED|LING)?)\s+(?:(?:THE|OUR|THEIR|A)\s+)?(?:REQUEST|PLANS?|SELECTION|CHOICE)\s+(?:FOR|TO\s+(?:USE|INCLUDE|ENABLE|CONFIGURE|DEPLOY))\s*$/,
      /\b(?:UNSURE|UNCERTAIN|NOT\s+SURE|DOUBTFUL)\b(?:\s+[A-Z0-9'-]+){0,5}\s+(?:WANT|NEED|REQUIRE|REQUEST|INCLUDE|USE|ENABLE|CONFIGURE|DEPLOY)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\b(?:DO\s+NOT|DON'T|NEVER|ISN'T|AREN'T|WASN'T|WEREN'T|SHOULDN'T|WOULDN'T|WON'T|NOT)\b(?:\s+[A-Z0-9'-]+){0,8}\s+(?:THINK|BELIEVE|PLAN|EXPECT|INTEND|LOOK)(?:S|ED|ING)?\b(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:IS|ARE|WAS|WERE)\s+NOT\s+(?:CURRENTLY\s+)?(?:PLANNING|LOOKING|INTENDING|EXPECTING)\b(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\bNO\s+LONGER\s+(?:WANT|NEED|REQUIRE|REQUEST|INCLUDE|USE|ENABLE|CONFIGURE|DEPLOY|ADD)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
    ]);
    if (directNegative) continue;

    // Pending, hypothetical, explanatory, capability-only, and historical
    // references do not authorize the shared-license transformation.
    const nonFinal = testsAny(prefix, [
      new RegExp(String.raw`\b(?:HAVE|HAS|HAD)\s+YET\s+TO\b[^.!?;\n]{0,100}\b${governingActionPattern}\b(?:\s+[A-Z0-9'-]+){0,10}\s*$`),
      new RegExp(String.raw`\b(?:(?:AM|IS|ARE|WAS|WERE)\s+)?WAITING\s+TO\b[^.!?;\n]{0,100}\b${governingActionPattern}\b(?:\s+[A-Z0-9'-]+){0,10}\s*$`),
      /\b(?:OPTIONAL|POSSIBLE|POTENTIAL|TENTATIVE|MAYBE|PROPOSED|TBD|PENDING|UNDECIDED)\s*$/,
      /\b(?:POSSIBLY|POTENTIALLY|TENTATIVELY|PROVISIONALLY|CONDITIONALLY|MAYBE|PERHAPS)\b(?:\s+[A-Z0-9'-]+){0,10}\s*$/,
      /\b(?:MAY|MIGHT|COULD)\s+(?:STILL\s+)?(?:WANT|LIKE|NEED|REQUIRE|REQUEST|ASK|INCLUDE|USE|ENABLE|TURN|PROVIDE|CONFIGURE|DEPLOY|ADD)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:PENDING|AWAITING)\s+(?:CUSTOMER\s+)?APPROVAL\b\s*[,\-:—–]?\s*(?:[A-Z0-9'-]+\s+){0,10}$/,
      /\b(?:WHEN|ONCE|AFTER|UPON)\s+(?:(?:THE\s+)?CUSTOMER\s+)?(?:APPROV(?:E|ES|ED|ING)|SIGN(?:S|ED|ING)?\s+OFF|CONFIRM(?:S|ED|ING)?)\b\s*[,\-:—–]?\s*(?:[A-Z0-9'-]+\s+){0,10}$/,
      /\bFOR\s+(?:DISCUSSION|REVIEW|CONSIDERATION|PLANNING)\s+ONLY\b\s*[,\-:—–]?\s*(?:[A-Z0-9'-]+\s+){0,8}$/,
      /\bBUDGET\s+(?:PERMITTING|ALLOWING|DEPENDENT)\b\s*[,\-:—–]?\s*(?:[A-Z0-9'-]+\s+){0,8}$/,
      /\bPROPOSED\s+(?:CONFIGURATION|DESIGN|QUOTE|OPTION)\b(?:\s+[A-Z0-9'-]+){0,6}\s+(?:INCLUD(?:E|ES|ED|ING)|USE(?:S|D|ING)?|ENABL(?:E|ES|ED|ING)|CONFIGUR(?:E|ES|ED|ING))\s*$/,
    ]) || testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:IF|UNLESS|PENDING|SUBJECT\\s+TO|WHEN|ONCE|AFTER|UPON|ONLY\\s+(?:IF|AFTER|WHEN|ONCE|UPON|WITH)|APPROVAL\\s+(?:IS\\s+)?PENDING)\\b`),
      new RegExp(`${leadingBoundary}(?:PROVIDED(?:\\s+THAT)?|CONTINGENT\\s+(?:ON|UPON)|CONDITIONAL\\s+ON)\\b`),
      new RegExp(`${leadingBoundary}(?:DEPENDENT\\s+(?:ON|UPON)|DEPENDING\\s+ON|ASSUMING|FOLLOWING|AS\\s+LONG\\s+AS|IN\\s+THE\\s+EVENT(?:\\s+THAT)?)\\b`),
      new RegExp(`${leadingBoundary}(?:SHOULD\\b[^.!?;\\n]{0,80}\\b(?:APPROV(?:E|ES|ED)|FUND(?:S|ED|ING)?|AUTHORIZE(?:S|D)?))\\b`),
      new RegExp(`${leadingBoundary}CONDITIONALLY\\b`),
      new RegExp(`${leadingBoundary}(?:IS|ARE|WAS|WERE)?\\s*(?:TBD|TO\\s+BE\\s+DETERMINED|PENDING|UNDECIDED|MAYBE|TENTATIVE|PROPOSED)\\b`),
      new RegExp(`${leadingBoundary}(?:APPROVAL|CONFIRMATION|SIGN[-\\s]?OFF)\\s+(?:IS\\s+)?(?:PENDING|TBD|TO\\s+BE\\s+DETERMINED)\\b`),
    ]);
    if (nonFinal) continue;

    const informationalTail = testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:(?:IS|ARE|WAS|WERE|SHOULD|WOULD|MUST|CAN|WILL)\\s+(?:BE\\s+)?)?(?:SUPPORT(?:ED|ABILITY)?|AVAILABLE|POSSIBLE|CAPABLE|FEASIBLE)\\b`),
      new RegExp(`${leadingBoundary}(?:SUPPORT|CAPABILITY|AVAILABILITY|DOCUMENTATION|INFORMATION|INFO|DETAILS|GUIDANCE|ADVICE|EXPLANATION|OVERVIEW|SUMMARY|SECTION|NOTE|DIAGRAM|ESTIMATE|EVALUATION|COMPARISON|COST|PRICE)\\b`),
      new RegExp(`${leadingBoundary}(?:IN|FOR)\\s+(?:AN?\\s+|THE\\s+)?(?:DOCUMENTATION|COMPARISON\\s+TABLE|EVALUATION|AGENDA)\\b`),
      new RegExp(`${leadingBoundary}ON\\s+(?:THE\\s+)?AGENDA\\b`),
      new RegExp(`${leadingBoundary}AS\\s+(?:AN?\\s+)?CONSIDERATION\\b`),
      new RegExp(`${leadingBoundary}(?:(?:WAS|WERE|IS|ARE)\\s+)?(?:CONSIDERED|DISCUSSED|EVALUATED|REVIEWED|TESTED|USED\\s+BEFORE)\\b`),
    ]);
    const informationalPrefix = testsAny(prefix, [
      /\b(?:EXPLAIN|DESCRIBE|DEFINE|DISCUSS|COMPARE|EVALUAT(?:E|ES|ED|ING)|CONSIDER|SUPPORTS?|HANDLE|ALLOW|TELL|ADVIS(?:E|ES|ED|ING)|UNDERSTAND|REVIEW)\b(?:\s+[A-Z0-9'-]+){0,10}\s*$/,
      /\bASK(?:S|ED|ING)?\s+(?:ABOUT|FOR\s+(?:MORE\s+)?(?:INFORMATION|INFO|DETAILS|GUIDANCE|ADVICE)\s+(?:ABOUT|ON))\s*$/,
      /\b(?:REQUEST|SEEK|WANT|NEED|ASK(?:S|ED|ING)?)\s+(?:(?:MORE|SOME|AN?|THE)\s+)?(?:INFORMATION|INFO|DETAILS|GUIDANCE|ADVICE|DOCUMENTATION|EXPLANATION|OVERVIEW|SUMMARY|SECTION|NOTE|DIAGRAM|COST(?:\s+(?:INFORMATION|INFO|DETAILS|COMPARISON))?|PRIC(?:E|ING)(?:\s+(?:INFORMATION|INFO|DETAILS|COMPARISON))?|APPROVAL)\s+(?:OF|FOR|ABOUT|ON)\s*$/,
      /\b(?:INCLUDE|ADD|PROVIDE)\s+(?:(?:AN?|THE)\s+)?(?:EXPLANATION|OVERVIEW|SUMMARY|SECTION|NOTE|DOCUMENTATION|DIAGRAM|COST(?:\s+(?:INFORMATION|INFO|DETAILS))?|PRIC(?:E|ING)(?:\s+(?:INFORMATION|INFO|DETAILS))?)\s+(?:OF|FOR|ABOUT|ON)\s*$/,
      /\b(?:INCLUDE|ADD|PROVIDE)\s+(?:(?:AN?|THE)\s+)?(?:EXPLANATION|OVERVIEW|SUMMARY|SECTION|NOTE|DOCUMENTATION|DIAGRAM)\s+(?:EXPLAINING|DESCRIBING|COVERING)\s*$/,
      /\b(?:PROVIDE|INCLUDE|ADD)\s+(?:(?:MORE|SOME|AN?|THE)\s+)?(?:INFORMATION|INFO|DETAILS|DOCUMENTATION|COMPARISON)\s+(?:OF|FOR|ABOUT|ON|BETWEEN)\b(?:\s+[A-Z0-9'-]+){0,8}\s+(?:AND|VERSUS|VS\.?|TO)\s*$/,
      /\b(?:PROVIDE|INCLUDE|ADD)\s+(?:(?:MORE|SOME|AN?|THE)\s+)?(?:INFORMATION|INFO|DETAILS|DOCUMENTATION)\s+(?:OF|FOR|ABOUT|ON)\s*$/,
      /\b(?:PROVIDE|INCLUDE|ADD|MAKE|NEED|WANT|REQUEST)\b[^.!?\n]{0,80}\bCOMPARISON\b[^.!?\n]{0,40}\b(?:FOR|ABOUT|OF|BETWEEN|AND|VERSUS|VS\.?|TO)\s*$/,
      /\b(?:CAPABLE|ABILITY)\s+OF\s*$/,
      /\b(?:NEED|WANT|HAVE)\s+TO\s+(?:DECIDE|CHOOSE|DETERMINE|REVIEW|EVALUATE|DISCUSS|CONSIDER|TALK)\s+(?:ON|ABOUT)?\s*$/,
      /\b(?:WHETHER|IF)\b[^.!?\n]{0,80}\s*$/,
      /\b(?:WE|THEY|IT|CUSTOMERS?|CLIENTS?|SITES?|DEVICES?|APPLIANCES?|FIREWALLS?|MX[A-Z0-9-]*S?)\s+(?:CAN|COULD)\s+(?:INCLUDE|USE|ENABLE|CONFIGURE|DEPLOY|SUPPORT|HANDLE|ALLOW)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:DO|DOES|DID|CAN|COULD|WOULD|WILL)\b[^.!?\n]{0,80}\b(?:SUPPORTS?|HANDLES?|ALLOWS?)\s*$/,
    ]);
    if (informationalTail || informationalPrefix) continue;

    const historical = testsAny(prefix, [
      // A subject commonly sits between the temporal adverb and the verb
      // ("previously WE used", "previously THE CUSTOMER deployed"), so allow a
      // short gap. Direction of error matters here: over-matching only
      // suppresses HA, while under-matching silently halves the license
      // quantities on a customer-facing quote.
      /\b(?:PREVIOUSLY|EARLIER|INITIALLY|FORMERLY|HISTORICALLY)(?:\s+[A-Z0-9'-]+){0,3}\s+(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\bONCE\s+(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,8}\s*$/,
      /\b(?:OLD|PREVIOUS|PRIOR|HISTORICAL|LEGACY|PAST|SUPERSEDED|ARCHIVED)\b(?:\s+[A-Z0-9'-]+){0,10}\s*(?:QUOTE|DESIGN|CONFIGURATION|DEPLOYMENT|SCOPE)?\s*[:=-]?\s*(?:(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)\b(?:\s+[A-Z0-9'-]+){0,5})?\s*$/,
      /\b(?:ON\s+)?(?:THE\s+)?(?:OLD|PREVIOUS|PRIOR|LAST|SUPERSEDED|ARCHIVED)\s+(?:QUOTE|DESIGN|CONFIGURATION|DEPLOYMENT|SCOPE|PHASE)\b[^.!?;\n]{0,80}\b(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,6}\s*$/,
      /\b(?:HISTORY|HISTORICAL)\s*:\s*[^.!?;\n]{0,80}\b(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,6}\s*$/,
      /\bEARLIER\s+(?:CORRESPONDENCE|EMAIL|MESSAGE|DISCUSSION|NOTES?)\b[^.!?;\n]{0,60}\b(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,6}\s*$/,
      /\b(?:IN\s+20\d{2}|LAST\s+(?:YEAR|MONTH|QUARTER|WEEK)|YESTERDAY)\b(?:\s+[A-Z0-9'-]+){0,10}\s+(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\b(?:(?:\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\s+(?:DAYS?|WEEKS?|MONTHS?|QUARTERS?|YEARS?)\s+AGO|LAST\s+(?:MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY))\b(?:\s+[A-Z0-9'-]+){0,12}\s+(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\bIN\s+Q[1-4]\b(?:\s+[A-Z0-9'-]+){0,10}\s+(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSE|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)(?:\s+[A-Z0-9'-]+){0,5}\s*$/,
      /\bMINUTES?\s+FROM\s+(?:JANUARY|FEBRUARY|MARCH|APRIL|MAY|JUNE|JULY|AUGUST|SEPTEMBER|OCTOBER|NOVEMBER|DECEMBER|20\d{2})\b(?:\s+[A-Z0-9'-]+){0,10}\s*$/,
    ]) || testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:(?:WAS|WERE|IS|ARE)\\s+)?(?:USED\\s+BEFORE|CONSIDERED|DISCUSSED|EVALUATED|REVIEWED|TESTED)\\b`),
      new RegExp(`${leadingBoundary}(?:(?:WAS|WERE)\\s+)?(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSEN|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)?\\s*(?:PREVIOUSLY|EARLIER|INITIALLY|FORMERLY|HISTORICALLY|IN\\s+20\\d{2}|LAST\\s+(?:YEAR|MONTH|QUARTER|WEEK)|YESTERDAY)\\b`),
      new RegExp(`${leadingBoundary}(?:USED|HAD|NEEDED|REQUIRED|REQUESTED|APPROVED|AUTHORIZED|SELECTED|CHOSEN|ELECTED|CONFIGURED|DEPLOYED|ENABLED|INCLUDED)\\s+(?:ON|IN|AT|FOR|DURING)\\s+(?:THE\\s+)?(?:OLD|PREVIOUS|PRIOR|LAST|SUPERSEDED|ARCHIVED)\\s+(?:QUOTE|DESIGN|CONFIGURATION|DEPLOYMENT|SCOPE|PHASE|SITE|LOCATION|CAMPUS|OFFICE|BRANCH|BUILDING|FACILITY|NETWORK|SETUP)\\b`),
      // A prior deployment mentioned in passing ("...at the old site",
      // "...on the previous design") describes history, not a request to
      // enable HA on the quote being built now. FOR is deliberately excluded:
      // "HA for the old site" reads as a request to add HA there, not as a
      // description of what that site already ran.
      new RegExp(`${leadingBoundary}(?:IN|ON|AT)\\s+(?:THE\\s+)?(?:OLD|PREVIOUS|PRIOR|LAST|SUPERSEDED|ARCHIVED)\\s+(?:QUOTE|DESIGN|CONFIGURATION|DEPLOYMENT|SCOPE|PHASE|SITE|LOCATION|CAMPUS|OFFICE|BRANCH|BUILDING|FACILITY|NETWORK|SETUP)\\b`),
    ]);
    const stateOnlyPrefix = /\b(?:EXISTING|CURRENT|PRESENT|PREVIOUS|PRIOR|OLD|LEGACY)\b(?:\s+[A-Z0-9'-]+){0,8}\s*$/.test(prefix)
      && !/\b(?:QUOTE|CONFIGURE|INCLUDE|ENABLE|USE|ADD|DEPLOY|REQUIREMENT|REQUIRE|NEED|WANT|PREFER|SELECT|CHOOSE|OPT|PUT|PLACE|ENSURE)\b/.test(prefix);
    const laterNegative = /\b(?:BUT|HOWEVER|ACTUALLY|CORRECTION|INSTEAD|THEN|LATER|ON\s+SECOND\s+THOUGHT)\b[^.!?;\n]{0,100}\b(?:(?:DO\s+NOT|DON'T|DID\s+NOT|DIDN'T|ISN'T|AREN'T|WASN'T|WEREN'T|SHOULDN'T|WOULDN'T|MUSTN'T|CAN'T|WON'T|NO\s+LONGER)\s+(?:WANT|NEED|REQUIRE|REQUEST|INCLUDE|USE|ENABLE|CONFIGURE|DEPLOY|ADD|KEEP)|NOT\s+(?:WANTED|NEEDED|REQUIRED|REQUESTED|INCLUDED|USED|ENABLED|CONFIGURED|DEPLOYED|ADDED)|NO\b|(?:USE|CHOOSE|SELECT|QUOTE|CONFIGURE|DEPLOY|KEEP)\s+(?:THE\s+)?(?:STANDARD|STANDALONE|NON[-\s]?HA)\b|(?:IS|ARE|WILL\s+BE)\s+(?:THE\s+)?(?:STANDARD|STANDALONE|NON[-\s]?HA)\b|SUPERSEDED\s+BY\s+(?:THE\s+)?(?:STANDARD|STANDALONE)|WITHDREW|REMOVED|REJECTED|DECLINED|CANCELLED|OPTED\s+OUT)\b/.test(tail);
    const laterContext = stripMx84Exclusions(text.slice(afterStart, afterStart + 600));
    const globalLaterCorrection = testsAny(laterContext, [
      /\b(?:CHANGED\s+(?:OUR|THEIR|THE|HIS|HER)\s+MIND|CANCEL\s+THAT|DISREGARD\s+THAT|SCRATCH\s+THAT|IGNORE\s+THAT|REVISED\s+INSTRUCTION|LATEST\s+DIRECTION|FINAL\s+(?:ANSWER|DIRECTION)|CORRECTION|UPDATE|ON\s+SECOND\s+THOUGHT|ACTUALLY)\b[\s\S]{0,140}\b(?:NO\s+HA|STANDARD|STANDALONE|NON[-\s]?HA|LEAVE\s+IT\s+OUT|DO\s+NOT\s+INCLUDE|DON'T\s+INCLUDE|REMOVE|CANCEL)\b/,
      /(?:^|[.!?;\n])\s*(?:NO\s*[,;:]?|DO\s+NOT|DON'T)\s+(?:(?:USE|INCLUDE|KEEP|WANT|NEED|QUOTE|CONFIGURE|DEPLOY)\s+)?(?:IT|HA|HIGH\s+AVAILABILITY|WARM\s+SPARE|STANDARD|STANDALONE)\b/,
      /\b(?:REVISED\s+INSTRUCTION|LATEST\s+DIRECTION|FINAL\s+(?:ANSWER|DIRECTION))\b[\s\S]{0,100}\b(?:QUOTE|USE|SELECT|CHOOSE|IS)\s+(?:THE\s+)?(?:STANDARD|STANDALONE)\b/,
    ]);
    if (historical || stateOnlyPrefix || laterNegative || globalLaterCorrection) continue;

    // Questions are affirmative only when they are a direct request to the
    // recipient to perform a concrete HA action. Capability/advice questions
    // have already been rejected above.
    if (sentence.includes('?')) {
      const explicitQuestionRequest = /\b(?:CAN|COULD|WILL|WOULD)\s+YOU(?:\s+PLEASE)?\b[^.!?\n]{0,80}\b(?:QUOTE|CONFIGURE|INCLUDE|ENABLE|USE|ADD|DEPLOY|ENSURE|TURN|SWITCH|ACTIVATE|IMPLEMENT|PUT|PLACE|RUN|KEEP|SET|PROVIDE|GIVE|MAKE|APPLY|BUILD|DELIVER|DESIGN)\b[^.!?\n]*$/.test(prefix)
        || /^\s*(?:PLEASE\s+)?(?:QUOTE|CONFIGURE|INCLUDE|ENABLE|USE|ADD|DEPLOY|ENSURE|TURN|SWITCH|ACTIVATE|IMPLEMENT|PUT|PLACE|RUN|KEEP|SET|PROVIDE|GIVE|MAKE|APPLY|BUILD|DELIVER|DESIGN)\b/.test(sentence);
      if (!explicitQuestionRequest && !affirmativeDoubleNegative) continue;
    }

    const affirmativeAction = new RegExp(
      String.raw`\b${governingActionPattern}\b(?:\s+[A-Z0-9'-]+){0,10}\s*[:=-]?\s*$`,
    ).test(prefix);
    const affirmativePredicatePrefix = /\b(?:CHOICE|SELECTION|PREFERENCE|REQUIREMENT|DECISION)\s+IS\s*$/.test(prefix)
      || /\bAPPROVAL\s+(?:HAS\s+BEEN|WAS|IS)\s+GRANTED\s+FOR\s*$/.test(prefix)
      || /\bFINAL\s+(?:SELECTION|CHOICE|DECISION)\s*[:=-]?\s*$/.test(prefix);
    const positiveTail = testsAny(tail, [
      new RegExp(`${leadingBoundary}(?:(?:(?:IS|ARE|WAS|WERE|SHOULD|WILL)\\s+(?:BE\\s+)?)|(?:(?:HAS|HAVE)\\s+BEEN\\s+)|(?:MUST\\s+(?:BE|REMAIN)\\s+))?(?:(?:AN?|THE)\\s+)?(?:REQUIRED|NEEDED|REQUESTED|DESIRED|WANTED|PREFERRED|APPROVED|AUTHORIZED|CONFIRMED|SELECTED|CHOSEN|ELECTED|INCLUDED|ENABLED|CONFIGURED|DEPLOYED|MANDATORY|ESSENTIAL|COMPULSORY|HARD\\s+REQUIREMENT|NON[-\\s]?OPTIONAL)\\b`),
      new RegExp(`${leadingBoundary}(?:IS|ARE)\\s+(?:(?:THE|OUR|THEIR|THE\\s+CUSTOMER'?S)\\s+)?(?:SELECTED\\s+OPTION|CHOICE|SELECTION|PREFERENCE)\\b`),
      new RegExp(`${leadingBoundary}(?:HAS|HAVE)\\s+(?:(?:THE|A)\\s+)?(?:CUSTOMER|CLIENT)\\s+APPROVAL\\b`),
    ]);
    const hardwareModifier = /^\s+(?:(?:(?:FOR|ON|WITH)\s+)?(?:THE\s+)?(?:(?:\d+|ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN|EIGHT|NINE|TEN|ELEVEN|TWELVE)\s*(?:X\s*)?)?MX[A-Z0-9-]*|FIREWALLS?|APPLIANCES?|UNITS?|DEVICES?|EQUIPMENT|PAIR|MODE|DEPLOYMENT)\b/.test(localTail);
    const remainder = `${prefix} ${localTail}`
      .replace(/\b(?:PLEASE|EXPLICIT|EXPLICITLY)\b/g, ' ')
      .replace(/[^A-Z0-9]+/g, ' ')
      .trim();
    const bareRequest = !remainder;
    const productModifier = /\bMX[A-Z0-9-]*\b/.test(sentence)
      && (/[,;+&]\s*$/.test(prefix) || /\b(?:MX[A-Z0-9-]*|ENT|ENTERPRISE|SEC|SDW|LICENSING)\s*$/.test(prefix));
    const mx84ExclusionTail = /^\s*[,;:]?\s*(?:NO|WITHOUT|EXCLUD(?:E|ES|ED|ING)|REMOV(?:E|ES|ED|ING))\s+(?:(?:HISTORICAL|OLD|LEGACY|PREVIOUS|PRIOR)\s+)?MX84S?\b/.test(text.slice(afterStart));
    if (affirmativeAction || affirmativePredicatePrefix || affirmativeDoubleNegative || affirmativeNegativeTail
        || positiveTail || hardwareModifier || bareRequest || productModifier || mx84ExclusionTail) return true;
  }
  return false;
}

export function quoteSkuTextFromLines(lines) {
  return normalizeQuoteIntakeLines(lines).map(({ sku, qty }) => `${qty} ${sku}`).join('\n');
}

export function normalizeHaMode(value) {
  return value === 'warm_spare' ? 'warm_spare' : 'standard';
}

export function oneshotHaStateForQuoteOption({ haAvailable = false, hardwareOnly = false, currentMode = 'standard' } = {}) {
  const available = haAvailable === true;
  return {
    ha_mode: hardwareOnly ? 'standard' : (available ? 'warm_spare' : normalizeHaMode(currentMode)),
    ha_recalculate_license_qty: !hardwareOnly && available,
    ...(available ? { ha_available: true } : {}),
  };
}

export function isProductChangingOneshotOverride(overrides) {
  return Object.keys(overrides || {}).some((key) => PRODUCT_OVERRIDE_KEYS.has(key));
}

/**
 * Re-plan inputs rebuilt from the panel's CURRENT thread and pin.
 *
 * A one-shot card started away from the Gmail thread captures no participants,
 * so it plans with nothing to resolve a customer from and stops at
 * missing_contact. Opening the right thread afterwards did not help: the card
 * kept the empty list it was born with and offered no way to look again, so the
 * only route was to abandon it and requote (Chris, 2026-08-19).
 *
 * Returns ONLY re-plan inputs the existing pickers already send, so the server
 * re-resolves the plan and every downstream guard still applies. Nothing here
 * writes to Zoho. A contact is forwarded only when the thread actually lists
 * them, exactly as the initial plan does, so a pick from another conversation
 * still cannot leak in. An explicitly pinned Contact is authoritative and rides
 * along with its id.
 */
export function oneshotContextRefreshOverrides({
  threadContacts = [],
  selectedContactEmail = '',
  shownContactEmail = '',
  pin = null,
} = {}) {
  const participants = (Array.isArray(threadContacts) ? threadContacts : [])
    .map((c) => ({
      email: String(c?.email || '').trim().toLowerCase(),
      name: c?.name || '',
      role: c?.role || '',
    }))
    .filter((c) => c.email.includes('@'))
    .slice(0, 50);

  const overrides = { participants };
  const selected = String(selectedContactEmail || '').trim().toLowerCase();
  const shown = String(shownContactEmail || '').trim().toLowerCase();
  const onThread = (email) => !!email && participants.some((c) => c.email === email);
  const forwarded = onThread(selected) ? selected : (onThread(shown) ? shown : '');
  if (forwarded) overrides.contact_email = forwarded;

  const module = String(pin?.module || '');
  const recordId = String(pin?.recordId || '');
  if (module === 'Accounts' && recordId) overrides.account_id = recordId;
  if (module === 'Deals' && recordId) {
    overrides.existing_deal_id = recordId;
    if (pin.accountId) overrides.account_id = String(pin.accountId);
  }
  if (module === 'Contacts' && recordId) {
    // The pin names the person outright, so it outranks the thread heuristic
    // above and does not need them to appear in the participant list.
    overrides.contact_id = recordId;
    const pinnedEmail = String(pin.email || '').trim().toLowerCase();
    if (pinnedEmail) overrides.contact_email = pinnedEmail;
    if (pin.accountId && !overrides.account_id) overrides.account_id = String(pin.accountId);
  }
  return overrides;
}

/** Plain-English summary of what a context refresh will send, for the button. */
export function oneshotContextRefreshSummary(overrides) {
  const parts = [];
  const count = Array.isArray(overrides?.participants) ? overrides.participants.length : 0;
  parts.push(count === 1 ? '1 person on this thread' : `${count} people on this thread`);
  if (overrides?.contact_email) parts.push(overrides.contact_email);
  if (overrides?.account_id) parts.push('pinned Account');
  if (overrides?.existing_deal_id) parts.push('pinned Deal');
  return parts.join(' · ');
}

export function buildOneshotReplanPayload(base, overrides, reviewToken) {
  const next = { ...(base || {}), ...(overrides || {}) };
  next.ha_mode = normalizeHaMode(next.ha_mode);
  if (!isProductChangingOneshotOverride(overrides) && reviewToken) {
    next.prior_review_token = reviewToken;
  } else {
    delete next.prior_review_token;
  }
  return next;
}

export function oneshotProductSnapshotHash(plan) {
  const value = String(plan?.product_validation?.snapshot_hash || '').trim();
  return value.length <= 300 ? value : '';
}

export function bindOneshotQuoteOptions(quoteOptions, selectedQuoteOptionIndex, plan) {
  const options = Array.isArray(quoteOptions) ? quoteOptions.slice() : [];
  const snapshotHash = oneshotProductSnapshotHash(plan);
  const selected = Number.isInteger(selectedQuoteOptionIndex) ? selectedQuoteOptionIndex : NaN;
  if (!snapshotHash || !options.length || !Number.isInteger(selected) || selected < 0 || selected >= options.length) {
    return {
      quoteOptions: [],
      selectedQuoteOptionIndex: null,
      quoteOptionsSnapshotHash: undefined,
    };
  }
  return {
    quoteOptions: options,
    selectedQuoteOptionIndex: selected,
    quoteOptionsSnapshotHash: snapshotHash,
  };
}

/**
 * Carry term-option authority across a new signed plan only when the old set
 * was bound to the current product snapshot. Manual product/HA/licensing edits
 * invalidate the set; an explicit selection from the still-bound set may
 * retain and atomically rebind it to the replacement snapshot.
 */
export function nextOneshotQuoteOptionState({
  quoteOptions,
  selectedQuoteOptionIndex,
  quoteOptionsSnapshotHash,
  currentPlan,
  nextPlan,
  productChanging = false,
  boundOptionSelection = false,
  nextSelectedQuoteOptionIndex,
} = {}) {
  const currentHash = oneshotProductSnapshotHash(currentPlan);
  const bindingMatches = !!currentHash && String(quoteOptionsSnapshotHash || '') === currentHash;
  if (!bindingMatches || (productChanging && !boundOptionSelection)) {
    return bindOneshotQuoteOptions([], null, nextPlan);
  }
  const selected = Number.isInteger(nextSelectedQuoteOptionIndex)
    ? nextSelectedQuoteOptionIndex
    : selectedQuoteOptionIndex;
  return bindOneshotQuoteOptions(quoteOptions, selected, nextPlan);
}

const ONESHOT_ACCOUNT_DRAFT_FIELDS = ['name', 'street', 'city', 'state', 'zip', 'country', 'website'];

// A plan revision remounts its review card. Carry the user's current local
// account review values through every re-plan so a later Deal/lead/term/HA
// choice cannot silently restore stale server-prefill values.
export function withOneshotAccountDraft(messagePatch, accountDraft) {
  const snapshot = {};
  for (const field of ONESHOT_ACCOUNT_DRAFT_FIELDS) {
    const value = accountDraft?.[field];
    if (value != null) snapshot[field] = String(value);
  }
  return { ...(messagePatch || {}), accountDraft: snapshot };
}

export function quoteOptionTerm(option) {
  const text = `${option?.label || ''} ${option?.url || ''}`;
  const match = text.match(/(?:^|[^0-9])([1-5])\s*(?:-?\s*(?:year|yr)|YR\b)/i);
  return match ? Number(match[1]) : null;
}

export function selectableQuoteTerms(options) {
  const seen = new Set();
  const result = [];
  for (const [index, option] of (Array.isArray(options) ? options : []).entries()) {
    const url = sanitizeStratusOrderUrls([option?.url])[0] || '';
    if (!url) continue;
    const years = quoteOptionTerm(option);
    const key = years || `option-${index}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ index, years, label: option?.label || (years ? `${years}-Year` : `Option ${index + 1}`), url });
  }
  return result;
}

export function validateGmailQuoteContext(context, {
  expectedThreadPermId = '',
  expectedSubject = '',
  requireFresh = false,
  now = Date.now(),
  maxAgeMs = 15000,
} = {}) {
  if (!context || context.empty) return { ok: false, error: 'No Gmail conversation is available.' };
  const threadPermId = String(context.threadPermId || '').trim();
  const subject = String(context.subject || '').trim();
  const fullThreadBody = String(context.fullThreadBody || '').trim();
  const orderUrls = sanitizeStratusOrderUrls(context.threadOrderUrls);
  if (!threadPermId || !subject) {
    return { ok: false, error: 'The Gmail conversation identity could not be verified.' };
  }
  if (expectedThreadPermId && threadPermId !== String(expectedThreadPermId).trim()) {
    return { ok: false, error: 'Gmail changed conversations while Create Quote was starting. Nothing was created.' };
  }
  if (expectedSubject && subject !== String(expectedSubject).trim()) {
    return { ok: false, error: 'The Gmail subject changed while Create Quote was starting. Nothing was created.' };
  }
  if (requireFresh) {
    const extractedAt = Number(context.extractedAt);
    if (!Number.isFinite(extractedAt) || extractedAt <= 0 || Math.abs(Number(now) - extractedAt) > maxAgeMs) {
      return { ok: false, error: 'The Gmail conversation snapshot was not fresh enough to quote safely.' };
    }
  }
  if (!fullThreadBody && orderUrls.length === 0) {
    return { ok: false, error: 'The complete visible Gmail thread could not be read. A partial message was not used.' };
  }
  if (context.fullThreadExpanded === false && orderUrls.length === 0) {
    return { ok: false, error: 'Gmail still has collapsed messages. Expand all messages and try Create Quote again.' };
  }
  return {
    ok: true,
    context: { ...context, threadPermId, subject, fullThreadBody, threadOrderUrls: orderUrls },
    orderUrls,
  };
}

const ACCOUNT_FIELD_ALIASES = {
  name: 'name',
  account_name: 'name',
  street: 'street',
  billing_street: 'street',
  'billing.street': 'street',
  city: 'city',
  billing_city: 'city',
  'billing.city': 'city',
  state: 'state',
  billing_state: 'state',
  'billing.state': 'state',
  zip: 'zip',
  postal_code: 'zip',
  billing_code: 'zip',
  'billing.zip': 'zip',
  country: 'country',
  billing_country: 'country',
  'billing.country': 'country',
  website: 'website',
};

export function enrichmentComparisonRows(comparison) {
  if (Array.isArray(comparison?.differences)) {
    return comparison.differences.map((row) => {
      const fieldKey = String(row?.field || '').trim().toLowerCase().replace(/\s+/g, '_');
      const field = ACCOUNT_FIELD_ALIASES[fieldKey];
      if (!field || row?.candidate == null || String(row.candidate).trim() === '') return null;
      return {
        field,
        current: String(row.current ?? comparison.current?.[field] ?? ''),
        candidate: String(row.candidate),
        source: String(comparison.provenance?.source || comparison.provenance?.tier || 'Zia/Web enrichment'),
      };
    }).filter(Boolean);
  }
  const raw = comparison?.fields || comparison?.comparison || comparison;
  const entries = Array.isArray(raw)
    ? raw.map((row, index) => [row?.field || row?.name || String(index), row])
    : (raw && typeof raw === 'object' ? Object.entries(raw) : []);
  const rows = [];
  for (const [rawField, rawValue] of entries) {
    const fieldKey = String(rawField || '').trim().toLowerCase().replace(/\s+/g, '_');
    const field = ACCOUNT_FIELD_ALIASES[fieldKey];
    if (!field) continue;
    const value = rawValue && typeof rawValue === 'object' ? rawValue : { candidate: rawValue };
    const current = value.current ?? value.before ?? value.existing ?? value.original ?? '';
    const candidate = value.candidate ?? value.after ?? value.refreshed ?? value.value ?? '';
    if (candidate == null || String(candidate).trim() === '') continue;
    rows.push({
      field,
      current: String(current ?? ''),
      candidate: String(candidate),
      source: String(value.source || value.provenance || value.tier || 'Zia/Web enrichment'),
    });
  }
  return rows;
}

/**
 * Add the Hardware Only option to a quote result whose committed rows are all
 * hardware. Lives here rather than inside ChatPanel because it decides what a
 * rep can order: a missing option is invisible in the UI and, as a panel-local
 * closure, it could not be covered by the workflow sweep. It went unnoticed for
 * a release that a fresh chat quote never offered the option at all, because
 * only the "Update quote" path called it (2026-08-19).
 *
 * The all-hardware gate is the safety property: it makes the synthesized URL
 * exactly the committed rows, so the option verifies trivially against them.
 */
export function withHardwareOnlyQuoteOption(result, committedRows) {
  const rows = Array.isArray(committedRows) ? committedRows : [];
  const hardwareLines = rows.filter(({ sku }) => !String(sku || '').toUpperCase().startsWith('LIC-'));
  if (!hardwareLines.length || hardwareLines.length !== rows.length) return result;
  const url = `https://stratusinfosystems.com/order/?item=${hardwareLines.map((line) => line.sku).join(',')}&qty=${hardwareLines.map((line) => line.qty).join(',')}`;
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  return {
    ...(result || {}),
    urls: [...urls.filter((option) => String(option?.url || option) !== url), { label: 'Hardware Only', url, hardwareOnly: true }],
  };
}

// Plain-English meaning for the one-shot stop codes, held locally so the reason
// survives even when the worker's `detail`/`instruction` does not reach the panel.
// Chris hit "One-shot stopped: reviewed_deal_target_changed" and then
// "review_mismatch" with no explanation at all, and there was nothing on screen
// to act on (2026-08-19).
const ONESHOT_STOP_EXPLANATIONS = {
  reviewed_deal_target_changed:
    "the Deal, its Account, or its Contact in Zoho does not match what this quote was reviewed against, or the review carries no id to bind to. Nothing was written. A common cause is choosing a Deal that belongs to a different contact at the same Account.",
  review_mismatch:
    'a choice on the card no longer matches the signed review. The specific fields are listed above; a blank Cisco rep after a retry is the most common cause.',
  product_review_required:
    'the product review could not sign this cart. Fix the flagged lines and re-plan.',
  deal_not_open:
    'the reviewed Deal has since been closed in Zoho. Pick an open Deal and re-plan.',
  prior_review_invalid:
    'the previous review token could not be reused. Open a fresh Plan.',
  review_expired:
    'the review expired. Re-plan to sign a fresh one.',
  source_read_only:
    'this intake source cannot write to Zoho.',
  ambiguous_contact:
    'more than one person is on the thread and no contact was explicitly picked.',
  unresolved_sku:
    'a SKU on the quote does not exist in the Zoho product catalog.',
  inactive_sku:
    'a SKU on the quote is marked inactive in Zoho.',
  eol_sku:
    'a SKU on the quote is end-of-life and needs its replacement.',
  isr_not_found:
    'the Cisco rep on the thread has no Meraki_ISRs record in Zoho.',
  explicit_license_quantity_conflict:
    'a licence quantity does not match the hardware it covers.',
  invalid_sku_quantity:
    'a line has a quantity outside the allowed range.',
};

/**
 * Human-readable suffix for a one-shot failure. Prefers whatever the worker sent
 * (missing list, then instruction/detail) and falls back to the local map, so a
 * bare code never reaches the rep on its own.
 */
export function oneshotStopExplanation(response) {
  const parts = [];
  const missing = Array.isArray(response?.missing) ? response.missing.filter(Boolean) : [];
  if (missing.length) parts.push(missing.join('; '));
  const fromWorker = String(response?.instruction || response?.detail || '').trim();
  if (fromWorker) parts.push(fromWorker);
  if (!parts.length) {
    const explanation = ONESHOT_STOP_EXPLANATIONS[String(response?.error || '').trim()];
    if (explanation) parts.push(explanation);
  }
  return parts.length ? ` — ${parts.join(' — ')}` : '';
}
