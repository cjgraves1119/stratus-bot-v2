#!/usr/bin/env node
/**
 * Comprehensive SKU Audit for Stratus AI Webex Bot
 *
 * Validates every SKU path through the bot:
 *   1. applySuffix() produces valid suffixed SKUs for every catalog entry
 *   2. getLicenseSkus() returns license SKUs that exist in prices.json
 *   3. Every EOL product has a valid replacement (not another EOL product)
 *   4. Every EOL replacement's license pairing works and exists in prices.json
 *   5. Every SKU in prices.json is reachable (no orphaned prices)
 *   6. Every catalog SKU has pricing (no missing prices)
 *   7. Option 1 (renewal) and Option 2 (refresh) generate valid license URLs for EOL products
 *   8. Special families (Duo, Umbrella, C8111, C8455) resolve correctly
 *
 * Run: node test-audit.js
 */

const catalog = require('./src/data/auto-catalog.json');
const pricesData = require('./src/data/prices.json');
const prices = pricesData.prices;

const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const EOL_DATES = catalog._EOL_DATES || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const PASSTHROUGH = new Set(catalog._PASSTHROUGH || []);

// ─── COLORS ─────────────────────────────────────────────────────────────────
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// ─── COPY OF CORE FUNCTIONS FROM index.js ───────────────────────────────────
// These must stay in sync with worker/src/index.js

function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (upper.startsWith('MS450')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS130R?-/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (upper.startsWith('MS390')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS[1-4]\d{2}-/.test(upper) && !upper.startsWith('MS150') && !upper.startsWith('MS130') && !upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }
  if (/^MX\d+C[W]?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

function getLicenseSkus(baseSku, requestedTier) {
  const upper = baseSku.toUpperCase();

  const c8Match = upper.match(/^C(8111|8455)/);
  if (c8Match) {
    const model = c8Match[1];
    const tier = requestedTier || 'ENT';
    return [
      { term: '1Y', sku: `LIC-C${model}-${tier}-1Y` },
      { term: '3Y', sku: `LIC-C${model}-${tier}-3Y` },
      { term: '5Y', sku: `LIC-C${model}-${tier}-5Y` }
    ];
  }

  if (/^CW9800/.test(upper)) return null;

  if (/^MR\d/.test(upper) || /^CW9\d/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-ENT-1YR' },
      { term: '3Y', sku: 'LIC-ENT-3YR' },
      { term: '5Y', sku: 'LIC-ENT-5YR' }
    ];
  }

  const mxNaMatch = upper.match(/^MX(\d+C[W]?)-NA$/);
  if (mxNaMatch) {
    const model = mxNaMatch[1];
    const tier = requestedTier || 'SEC';
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const isNewer = modelNum >= 75;
    const suffix = isNewer ? 'Y' : 'YR';
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  const mxMatch = upper.match(/^MX(\d+(?:CW?|W)?)/);
  if (mxMatch) {
    const model = mxMatch[1];
    const tier = requestedTier || 'SEC';
    const numMatch = model.match(/^(\d+)/);
    const modelNum = numMatch ? parseInt(numMatch[1]) : 0;
    const newerModels = [75, 85, 95, 105];
    const isNewer = newerModels.includes(modelNum);
    const suffix = isNewer ? 'Y' : 'YR';
    const termSuffix = tier === 'SDW' ? 'Y' : suffix;
    return [
      { term: '1Y', sku: `LIC-MX${model}-${tier}-1${termSuffix}` },
      { term: '3Y', sku: `LIC-MX${model}-${tier}-3${termSuffix}` },
      { term: '5Y', sku: `LIC-MX${model}-${tier}-5${termSuffix}` }
    ];
  }

  const zMatch = upper.match(/^Z(\d+)(C)?(X)?$/);
  if (zMatch) {
    const zNum = zMatch[1];
    const hasC = !!zMatch[2];
    const licModel = `Z${zNum}${hasC ? 'C' : ''}`;
    if (zNum === '1' || zNum === '3') {
      return [
        { term: '1Y', sku: `LIC-${licModel}-ENT-1YR` },
        { term: '3Y', sku: `LIC-${licModel}-ENT-3YR` },
        { term: '5Y', sku: `LIC-${licModel}-ENT-5YR` }
      ];
    }
    const zTier = (requestedTier === 'ENT') ? 'ENT' : 'SEC';
    return [
      { term: '1Y', sku: `LIC-${licModel}-${zTier}-1Y` },
      { term: '3Y', sku: `LIC-${licModel}-${zTier}-3Y` },
      { term: '5Y', sku: `LIC-${licModel}-${zTier}-5Y` }
    ];
  }

  const mgMatch = upper.match(/^MG(\d+)/);
  if (mgMatch) {
    // MG21E uses same license as MG21, MG51E uses MG51, etc.
    const model = mgMatch[1];
    return [
      { term: '1Y', sku: `LIC-MG${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-MG${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }

  if (/^MS130R-/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    return [
      { term: '1Y', sku: `LIC-MS150-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS150-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS150-${ports}-5Y` }
    ];
  }

  // MS125: Uses -Y suffix (not -YR) — LIC-MS125-{variant}-{1Y|3Y|5Y}
  const ms125Match = upper.match(/^MS125-(.+)/);
  if (ms125Match) {
    const variant = ms125Match[1];
    return [
      { term: '1Y', sku: `LIC-MS125-${variant}-1Y` },
      { term: '3Y', sku: `LIC-MS125-${variant}-3Y` },
      { term: '5Y', sku: `LIC-MS125-${variant}-5Y` }
    ];
  }

  // MS390: Uses {portCount}{A|E}-{term}Y format (NOT legacy -1YR format)
  const ms390Match = upper.match(/^MS390-(\d+)/);
  if (ms390Match) {
    const portCount = ms390Match[1];
    const tier = (requestedTier === 'A') ? 'A' : 'E';
    return [
      { term: '1Y', sku: `LIC-MS390-${portCount}${tier}-1Y` },
      { term: '3Y', sku: `LIC-MS390-${portCount}${tier}-3Y` },
      { term: '5Y', sku: `LIC-MS390-${portCount}${tier}-5Y` }
    ];
  }

  // Catalyst M-series: C9200L, C9300, C9350 — LIC-{family}-{portCount}{A|E}-{term}
  // C9300X and C9300L map to C9300 licenses. C9350 has no 1Y. 12Y maps to 24.
  const catMatch = upper.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (catMatch) {
    let family = catMatch[1];
    let portCount = catMatch[2];
    const tier = (requestedTier === 'A') ? 'A' : 'E';

    if (family === 'C9300X' || family === 'C9300L') {
      family = 'C9300';
    }

    if (portCount === '12') portCount = '24';

    if (family === 'C9350') {
      return [
        { term: '3Y', sku: `LIC-C9350-${portCount}${tier}-3Y` },
        { term: '5Y', sku: `LIC-C9350-${portCount}${tier}-5Y` }
      ];
    }

    return [
      { term: '1Y', sku: `LIC-${family}-${portCount}${tier}-1Y` },
      { term: '3Y', sku: `LIC-${family}-${portCount}${tier}-3Y` },
      { term: '5Y', sku: `LIC-${family}-${portCount}${tier}-5Y` }
    ];
  }

  const mvMatch = upper.match(/^MV(\d+)/);
  if (mvMatch) {
    return [
      { term: '1Y', sku: 'LIC-MV-1YR' },
      { term: '3Y', sku: 'LIC-MV-3YR' },
      { term: '5Y', sku: 'LIC-MV-5YR' }
    ];
  }

  const mtMatch = upper.match(/^MT(\d+)/);
  if (mtMatch) {
    return [
      { term: '1Y', sku: 'LIC-MT-1Y' },
      { term: '3Y', sku: 'LIC-MT-3Y' },
      { term: '5Y', sku: 'LIC-MT-5Y' }
    ];
  }

  const legacyMatch = upper.match(/^(MS\d{3})-(.+)/);
  if (legacyMatch && !upper.startsWith('MS130') && !upper.startsWith('MS150')) {
    const model = legacyMatch[1];
    let port = legacyMatch[2];
    if (model === 'MS350' && port === '48X') port = '48';
    return [
      { term: '1Y', sku: `LIC-${model}-${port}-1YR` },
      { term: '3Y', sku: `LIC-${model}-${port}-3YR` },
      { term: '5Y', sku: `LIC-${model}-${port}-5YR` }
    ];
  }

  return null;
}

function detectFamily(sku) {
  if (/^MR\d/.test(sku)) return 'MR';
  if (/^MX\d/.test(sku)) return 'MX';
  if (/^MV\d/.test(sku)) return 'MV';
  if (/^MT\d/.test(sku)) return 'MT';
  if (/^MG\d/.test(sku)) return 'MG';
  if (/^Z\d/.test(sku)) return 'Z';
  if (/^MS130/.test(sku)) return 'MS130';
  if (/^MS150/.test(sku)) return 'MS150';
  if (/^MS390/.test(sku)) return 'MS390';
  if (/^MS450/.test(sku)) return 'MS450';
  if (/^CW9/.test(sku)) return 'CW';
  if (/^C9300X/.test(sku)) return 'C9300X';
  if (/^C9300L/.test(sku)) return 'C9300L';
  if (/^C9300/.test(sku)) return 'C9300';
  if (/^C9200L/.test(sku)) return 'C9200L';
  if (/^C8111/.test(sku)) return 'C8111';
  if (/^C8455/.test(sku)) return 'C8455';
  return null;
}

// ─── HELPER: Check if a base SKU is EOL ─────────────────────────────────────
function isEolSku(baseSku) {
  const upper = baseSku.toUpperCase();
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    for (const variant of variants) {
      const isMeraki = ['MR', 'MX', 'MV', 'MG', 'Z'].includes(family);
      const eolBase = isMeraki ? `${family}${variant}` : `${family}-${variant}`;
      if (upper === eolBase.toUpperCase()) return true;
    }
  }
  return false;
}

// ─── HELPER: Check if a SKU exists in prices ────────────────────────────────
function priceExists(sku) {
  const upper = sku.toUpperCase();
  if (prices[upper]) return true;
  // Try without -HW / -HW-NA suffix (hardware SKUs stored without suffix in prices)
  const noHw = upper.replace(/-HW(-NA)?$/, '');
  if (prices[noHw]) return true;
  // Try without -MR / -RTG suffix
  const noMr = upper.replace(/-(MR|RTG)$/, '');
  if (prices[noMr]) return true;
  return false;
}

// ─── BUILD FULL SKU LIST ────────────────────────────────────────────────────
// Catalog stores full SKU names in each family array (e.g., MR: ["MR28","MR36",...])
function getAllCatalogSkus() {
  const skus = [];
  for (const [family, variants] of Object.entries(catalog)) {
    if (family.startsWith('_')) continue;
    for (const variant of variants) {
      // variant IS the full base SKU (e.g., "MR28", "C9300-24P-M", "MS130-24P")
      skus.push({ base: variant, family });
    }
  }
  return skus;
}

function getAllEolSkus() {
  const skus = [];
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    for (const variant of variants) {
      // EOL_PRODUCTS stores just suffixes: MR: ["12","16",...], MS210: ["24","24P",...]
      const isSingleToken = ['MR', 'MX', 'MV', 'MG', 'Z'].includes(family);
      const base = isSingleToken ? `${family}${variant}` : `${family}-${variant}`;
      skus.push({ base, family });
    }
  }
  return skus;
}

// ─── SHARED HELPERS ─────────────────────────────────────────────────────────
const isLicenseSku = (s) => s.toUpperCase().startsWith('LIC-');
const isAccessory = (s) => {
  const u = s.toUpperCase();
  if (/^(CW-(ANT|MNT|ACC|INJ|POE)|MA-|AIR-)/.test(u)) return true;
  if (/^(4PT-KIT|CAB-|FAN-|IM-\d|PWR-)/.test(u)) return true;
  if (/-NM-/.test(u)) return true;
  if (/STAK/.test(u) || /STA-KIT/.test(u)) return true;
  return false;
};

// ─── AUDIT CATEGORIES ───────────────────────────────────────────────────────
const errors = [];
const warnings = [];
let passCount = 0;

function fail(category, msg) {
  errors.push({ category, msg });
}
function warn(category, msg) {
  warnings.push({ category, msg });
}
function pass() {
  passCount++;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 1: applySuffix() produces valid results for every catalog SKU
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 1: applySuffix() validation ═══${RESET}`);
{
  const allSkus = getAllCatalogSkus();
  let checked = 0;
  for (const { base, family } of allSkus) {
    const suffixed = applySuffix(base);
    checked++;

    // Verify the suffixed SKU has pricing
    if (!priceExists(suffixed)) {
      if (PASSTHROUGH.has(base.toUpperCase())) {
        if (!prices[base.toUpperCase()]) {
          warn('SUFFIX', `${base} is PASSTHROUGH but has no price in prices.json`);
        } else {
          pass();
        }
      } else if (isEolSku(base) || isAccessory(base) || /^CW9800/.test(base.toUpperCase())) {
        warn('SUFFIX', `${base} → ${suffixed} has no price (EOL/accessory/controller, expected)`);
      } else {
        fail('SUFFIX', `${base} → ${suffixed} has no price in prices.json`);
      }
    } else {
      pass();
    }
  }
  console.log(`  Checked ${checked} catalog SKUs through applySuffix()`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 2: getLicenseSkus() returns valid licenses for every hardware SKU
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 2: getLicenseSkus() → prices.json validation ═══${RESET}`);
{
  const allSkus = getAllCatalogSkus();
  let checked = 0;
  let noLicense = 0;

  // SKUs that legitimately have no license association
  const noLicenseExpected = new Set([
    'CW9800H1-MCG', // Wireless controller
    'CW9800H1',     // Wireless controller (without MCG suffix)
  ]);
  // (isLicenseSku and isAccessory are defined at top level)

  for (const { base, family } of allSkus) {
    if (isLicenseSku(base) || isAccessory(base) || PASSTHROUGH.has(base.toUpperCase())) continue;
    if (noLicenseExpected.has(base.toUpperCase())) continue;

    const lics = getLicenseSkus(base);
    checked++;

    if (!lics) {
      fail('LICENSE', `${base} (${family}) → getLicenseSkus() returned null (no license mapping)`);
      noLicense++;
      continue;
    }

    for (const { term, sku } of lics) {
      if (!prices[sku]) {
        fail('LICENSE', `${base} → license ${sku} (${term}) NOT FOUND in prices.json`);
      } else {
        pass();
      }
    }
  }
  console.log(`  Checked ${checked} hardware SKUs for license mappings (${noLicense} returned null)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 3: EOL products have valid replacements (not circular / not EOL themselves)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 3: EOL replacement chain validation ═══${RESET}`);
{
  const eolSkus = getAllEolSkus();
  let checked = 0;

  // Build set of all EOL base SKUs for circular detection
  const allEolBases = new Set();
  for (const { base } of eolSkus) {
    allEolBases.add(base.toUpperCase());
  }

  for (const { base, family } of eolSkus) {
    checked++;
    const replacement = EOL_REPLACEMENTS[base];

    if (!replacement) {
      fail('EOL', `${base} is EOL but has NO replacement mapping in _EOL_REPLACEMENTS`);
      continue;
    }

    const replacements = Array.isArray(replacement) ? replacement : [replacement];

    for (const rep of replacements) {
      // Check if replacement is itself EOL
      if (allEolBases.has(rep.toUpperCase())) {
        fail('EOL-CHAIN', `${base} → ${rep} but ${rep} is ALSO EOL (circular replacement)`);
      }

      // Check if replacement has a valid suffix
      const suffixed = applySuffix(rep);
      if (!priceExists(suffixed)) {
        fail('EOL-PRICE', `${base} → replacement ${rep} (suffixed: ${suffixed}) has no price in prices.json`);
      } else {
        pass();
      }
    }
  }
  console.log(`  Checked ${checked} EOL products for valid replacements`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 4: EOL replacement license pairings work
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 4: EOL replacement license pairing (Option 2 refresh) ═══${RESET}`);
{
  const eolSkus = getAllEolSkus();
  let checked = 0;

  for (const { base } of eolSkus) {
    const replacement = EOL_REPLACEMENTS[base];
    if (!replacement) continue;

    const replacements = Array.isArray(replacement) ? replacement : [replacement];

    for (const rep of replacements) {
      checked++;
      const lics = getLicenseSkus(rep);

      if (!lics) {
        fail('EOL-LIC', `${base} → replacement ${rep}: getLicenseSkus() returned null`);
        continue;
      }

      for (const { term, sku } of lics) {
        if (!prices[sku]) {
          fail('EOL-LIC', `${base} → replacement ${rep}: license ${sku} (${term}) NOT FOUND in prices.json`);
        } else {
          pass();
        }
      }
    }
  }
  console.log(`  Checked ${checked} EOL replacement → license paths`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 5: EOL Option 1 (renewal) — license SKUs for original EOL hardware
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 5: EOL Option 1 renewal license validation ═══${RESET}`);
{
  const eolSkus = getAllEolSkus();
  let checked = 0;

  for (const { base, family } of eolSkus) {
    checked++;
    const lics = getLicenseSkus(base);

    if (!lics) {
      // Try legacy fallback (same as _getEolRenewalLicenses in index.js)
      const legacyMatch = base.toUpperCase().match(/^(MS\d{3})-(.+)/);
      if (legacyMatch) {
        const testSkus = [
          `LIC-${legacyMatch[1]}-${legacyMatch[2]}-1YR`,
          `LIC-${legacyMatch[1]}-${legacyMatch[2]}-3YR`,
          `LIC-${legacyMatch[1]}-${legacyMatch[2]}-5YR`
        ];
        let anyFound = false;
        for (const sku of testSkus) {
          if (prices[sku]) { anyFound = true; pass(); }
          else fail('RENEW', `${base} Option 1 (legacy fallback): ${sku} NOT FOUND in prices.json`);
        }
        if (!anyFound) {
          fail('RENEW', `${base} Option 1: NO valid renewal licenses (getLicenseSkus=null, legacy fallback all missing)`);
        }
      } else {
        fail('RENEW', `${base} (${family}) Option 1: getLicenseSkus() returned null and no legacy fallback available`);
      }
      continue;
    }

    for (const { term, sku } of lics) {
      if (!prices[sku]) {
        fail('RENEW', `${base} Option 1: license ${sku} (${term}) NOT FOUND in prices.json`);
      } else {
        pass();
      }
    }
  }
  console.log(`  Checked ${checked} EOL products for Option 1 renewal licenses`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 6: Orphaned prices (in prices.json but not reachable from catalog)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 6: Orphaned prices check ═══${RESET}`);
{
  // Build set of all reachable SKUs
  const reachable = new Set();

  // Hardware SKUs from catalog (with suffix)
  for (const { base } of getAllCatalogSkus()) {
    const suffixed = applySuffix(base);
    reachable.add(suffixed.toUpperCase());
    reachable.add(base.toUpperCase());
    // Also add without suffix variants
    reachable.add(base.toUpperCase().replace(/-HW(-NA)?$/, ''));
  }

  // Passthrough
  for (const pt of (catalog._PASSTHROUGH || [])) {
    reachable.add(pt.toUpperCase());
  }

  // EOL products (with suffix)
  for (const { base } of getAllEolSkus()) {
    const suffixed = applySuffix(base);
    reachable.add(suffixed.toUpperCase());
    reachable.add(base.toUpperCase());
  }

  // License SKUs generated by getLicenseSkus for all catalog + EOL hardware
  const allHw = [...getAllCatalogSkus(), ...getAllEolSkus()];
  for (const { base } of allHw) {
    const lics = getLicenseSkus(base);
    if (lics) {
      for (const { sku } of lics) {
        reachable.add(sku.toUpperCase());
      }
    }
    // Also try with different tiers
    for (const tier of ['ENT', 'SEC', 'SDW']) {
      const lics2 = getLicenseSkus(base, tier);
      if (lics2) {
        for (const { sku } of lics2) {
          reachable.add(sku.toUpperCase());
        }
      }
    }
  }

  // Add known shared/generic license SKUs
  ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR',
   'LIC-MV-1YR', 'LIC-MV-3YR', 'LIC-MV-5YR',
   'LIC-MT-1Y', 'LIC-MT-3Y', 'LIC-MT-5Y',
   'LIC-MS130-CMPT-1Y', 'LIC-MS130-CMPT-3Y', 'LIC-MS130-CMPT-5Y'
  ].forEach(s => reachable.add(s));

  const allPriceSkus = Object.keys(prices);
  let orphaned = 0;
  const orphanedList = [];

  for (const priceSku of allPriceSkus) {
    if (!reachable.has(priceSku.toUpperCase())) {
      orphaned++;
      orphanedList.push(priceSku);
    }
  }

  if (orphanedList.length > 0) {
    // Group by prefix for readability
    const groups = {};
    for (const sku of orphanedList) {
      const prefix = sku.split('-').slice(0, 2).join('-');
      if (!groups[prefix]) groups[prefix] = [];
      groups[prefix].push(sku);
    }
    for (const [prefix, skus] of Object.entries(groups).sort()) {
      warn('ORPHAN', `${prefix}: ${skus.join(', ')}`);
    }
  }

  console.log(`  ${allPriceSkus.length} total SKUs in prices.json, ${orphaned} orphaned (unreachable)`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 7: Missing prices (catalog SKU has no pricing)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 7: Missing prices check ═══${RESET}`);
{
  const allSkus = getAllCatalogSkus();
  let missing = 0;

  for (const { base } of allSkus) {
    if (PASSTHROUGH.has(base.toUpperCase())) {
      if (!prices[base.toUpperCase()]) {
        fail('MISSING-PRICE', `${base} (passthrough) has no price in prices.json`);
        missing++;
      } else {
        pass();
      }
      continue;
    }

    const suffixed = applySuffix(base);
    if (!priceExists(suffixed)) {
      if (isEolSku(base) || isAccessory(base) || /^CW9800/.test(base.toUpperCase())) {
        warn('MISSING-PRICE', `${base} → ${suffixed} (EOL/accessory/controller, no price expected)`);
      } else {
        fail('MISSING-PRICE', `${base} → ${suffixed} has no price in prices.json`);
      }
      missing++;
    } else {
      pass();
    }
  }
  console.log(`  ${missing} catalog SKUs missing from prices.json`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 8: Special family validation (Duo, Umbrella, C8111, C8455, CW9800)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 8: Special family validation ═══${RESET}`);
{
  // Duo
  const duoSkus = ['LIC-DUO-ESSENTIALS-1YR', 'LIC-DUO-ESSENTIALS-3YR', 'LIC-DUO-ESSENTIALS-5YR',
                   'LIC-DUO-ADVANTAGE-1YR', 'LIC-DUO-ADVANTAGE-3YR', 'LIC-DUO-ADVANTAGE-5YR',
                   'LIC-DUO-PREMIER-1YR', 'LIC-DUO-PREMIER-3YR', 'LIC-DUO-PREMIER-5YR'];
  for (const sku of duoSkus) {
    if (!prices[sku]) fail('SPECIAL', `Duo license ${sku} NOT FOUND in prices.json`);
    else if (!PASSTHROUGH.has(sku)) fail('SPECIAL', `Duo license ${sku} not in _PASSTHROUGH`);
    else pass();
  }

  // Umbrella
  const umbSkus = ['LIC-UMB-DNS-ESS-K9-1YR', 'LIC-UMB-DNS-ESS-K9-3YR', 'LIC-UMB-DNS-ESS-K9-5YR',
                   'LIC-UMB-DNS-ADV-K9-1YR', 'LIC-UMB-DNS-ADV-K9-3YR', 'LIC-UMB-DNS-ADV-K9-5YR',
                   'LIC-UMB-SIG-ESS-K9-1YR', 'LIC-UMB-SIG-ESS-K9-3YR', 'LIC-UMB-SIG-ESS-K9-5YR',
                   'LIC-UMB-SIG-ADV-K9-1YR', 'LIC-UMB-SIG-ADV-K9-3YR', 'LIC-UMB-SIG-ADV-K9-5YR'];
  for (const sku of umbSkus) {
    if (!prices[sku]) fail('SPECIAL', `Umbrella license ${sku} NOT FOUND in prices.json`);
    else if (!PASSTHROUGH.has(sku)) fail('SPECIAL', `Umbrella license ${sku} not in _PASSTHROUGH`);
    else pass();
  }

  // C8111 / C8455
  for (const model of ['C8111-G2-MX', 'C8455-G2-MX']) {
    for (const tier of ['ENT', 'SEC', 'SDW']) {
      const lics = getLicenseSkus(model, tier);
      if (!lics) {
        fail('SPECIAL', `${model} tier=${tier}: getLicenseSkus() returned null`);
        continue;
      }
      for (const { sku } of lics) {
        if (!prices[sku]) fail('SPECIAL', `${model} tier=${tier}: license ${sku} NOT FOUND in prices.json`);
        else pass();
      }
    }
  }

  // CW9800 should return null (no license)
  const cw9800lics = getLicenseSkus('CW9800H1-MCG');
  if (cw9800lics !== null) {
    fail('SPECIAL', `CW9800H1-MCG should have no license mapping but got: ${JSON.stringify(cw9800lics)}`);
  } else {
    pass();
  }

  console.log(`  Validated Duo (9), Umbrella (12), C8111 (3 tiers), C8455 (3 tiers), CW9800`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 9: MS390 license format (known bug area)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 9: MS390 license format validation (known bug area) ═══${RESET}`);
{
  // MS390 variants in catalog (catalog stores full SKU like "MS390-24UX")
  const ms390Variants = catalog.MS390 || [];
  for (const base of ms390Variants) {
    const lics = getLicenseSkus(base);
    if (!lics) {
      fail('MS390', `${base}: getLicenseSkus() returned null`);
      continue;
    }
    for (const { term, sku } of lics) {
      if (!prices[sku]) {
        const portMatch = base.match(/MS390-(\d+)/);
        const port = portMatch ? portMatch[1] : '??';
        const possibles = Object.keys(prices).filter(k => k.startsWith(`LIC-MS390-${port}`));
        fail('MS390', `${base} → ${sku} (${term}) NOT in prices. Available: ${possibles.join(', ') || 'none'}`);
      } else {
        pass();
      }
    }
  }

  // MS390 in EOL products (EOL stores just suffix like "24", "48UX")
  const ms390Eol = (EOL_PRODUCTS.MS390 || []);
  for (const variant of ms390Eol) {
    const base = `MS390-${variant}`;
    const lics = getLicenseSkus(base);
    if (!lics) {
      fail('MS390-EOL', `${base} (EOL): getLicenseSkus() returned null for renewal`);
      continue;
    }
    for (const { term, sku } of lics) {
      if (!prices[sku]) {
        const portMatch = variant.match(/^(\d+)/);
        const port = portMatch ? portMatch[1] : '??';
        const possibles = Object.keys(prices).filter(k => k.startsWith(`LIC-MS390-${port}`));
        fail('MS390-EOL', `${base} (EOL renewal) → ${sku} (${term}) NOT in prices. Available: ${possibles.join(', ') || 'none'}`);
      } else {
        pass();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 10: Catalyst M-series license format (known bug area)
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 10: Catalyst M-series license validation (C9200L/C9300/C9300X/C9300L/C9350) ═══${RESET}`);
{
  for (const family of ['C9200L', 'C9300', 'C9300X', 'C9300L']) {
    const variants = catalog[family] || [];
    for (const base of variants) {
      // Skip accessories (NM modules, stacking kits)
      if (isAccessory(base)) continue;
      // base is already the full SKU like "C9300-24P-M"
      const lics = getLicenseSkus(base);
      if (!lics) {
        fail('CATALYST', `${base}: getLicenseSkus() returned null`);
        continue;
      }
      for (const { term, sku } of lics) {
        if (!prices[sku]) {
          const portMatch = base.match(new RegExp(`${family}-(\\d+)`));
          const port = portMatch ? portMatch[1] : '??';
          const possibles = Object.keys(prices).filter(k => k.startsWith(`LIC-${family}-${port}`));
          fail('CATALYST', `${base} → ${sku} (${term}) NOT in prices. Available: ${possibles.join(', ') || 'none'}`);
        } else {
          pass();
        }
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUDIT 11: MS450 license validation
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${BOLD}${CYAN}═══ AUDIT 11: MS450 license validation ═══${RESET}`);
{
  const ms450Variants = catalog.MS450 || [];
  for (const base of ms450Variants) {
    // base is already full SKU like "MS450-12"
    const lics = getLicenseSkus(base);
    if (!lics) {
      fail('MS450', `${base}: getLicenseSkus() returned null`);
      continue;
    }
    for (const { term, sku } of lics) {
      if (!prices[sku]) {
        const possibles = Object.keys(prices).filter(k => k.startsWith('LIC-MS450'));
        fail('MS450', `${base} → ${sku} (${term}) NOT in prices. Available: ${possibles.join(', ') || 'none'}`);
      } else {
        pass();
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRINT RESULTS
// ═══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(70)}`);
console.log(`${BOLD}AUDIT RESULTS${RESET}`);
console.log(`${'═'.repeat(70)}`);
console.log(`${GREEN}✓ ${passCount} checks passed${RESET}`);

if (warnings.length > 0) {
  console.log(`\n${YELLOW}${BOLD}⚠ ${warnings.length} WARNINGS:${RESET}`);
  const warnGroups = {};
  for (const { category, msg } of warnings) {
    if (!warnGroups[category]) warnGroups[category] = [];
    warnGroups[category].push(msg);
  }
  for (const [cat, msgs] of Object.entries(warnGroups)) {
    console.log(`\n  ${YELLOW}[${cat}]${RESET}`);
    for (const msg of msgs) {
      console.log(`    ⚠ ${msg}`);
    }
  }
}

if (errors.length > 0) {
  console.log(`\n${RED}${BOLD}✗ ${errors.length} ERRORS:${RESET}`);
  const errGroups = {};
  for (const { category, msg } of errors) {
    if (!errGroups[category]) errGroups[category] = [];
    errGroups[category].push(msg);
  }
  for (const [cat, msgs] of Object.entries(errGroups)) {
    console.log(`\n  ${RED}[${cat}] (${msgs.length} issues)${RESET}`);
    for (const msg of msgs) {
      console.log(`    ✗ ${msg}`);
    }
  }
  console.log(`\n${RED}${BOLD}AUDIT FAILED — ${errors.length} errors need fixing${RESET}`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}${BOLD}AUDIT PASSED — all SKU paths validated${RESET}`);
  process.exit(0);
}
