// Local test harness for deterministic quoting engine
// Run: node test-local.js

// Import the catalog data
const catalog = require('./src/data/auto-catalog.json');
const VALID_SKUS = catalog.validSkus || {};
const SKU_FAMILIES = catalog.skuFamilies || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const PRICES = catalog.prices || {};

// Copy the core functions from index.js inline for testing
// (We extract them so we don't need to refactor the worker)

function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;  // CW9179F has no -RTG suffix
  if (/^CW917\d/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (upper.startsWith('MS450')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS130R?-/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (upper.startsWith('MS390')) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MS[1-4]\d{2}-/.test(upper) && !upper.startsWith('MS150') && !upper.startsWith('MS130') && !upper.startsWith('MS390')) {
    return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  }
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

function getLicenseSkus(baseSku, requestedTier) {
  const upper = baseSku.toUpperCase();

  // C8111 / C8455 Secure Routers — ENT/SEC/SDW license tiers
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

  // CW9800 Wireless Controller — no standard license association
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
    // Only MX75, MX85, MX95, MX105 use -Y for ENT/SEC. All others use -YR.
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
    // License SKUs never include the E suffix
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
  // MS390-24UX → LIC-MS390-24E-1Y, MS390-48P → LIC-MS390-48E-1Y
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
  // C9300X and C9300L have no license SKUs in prices, they use C9300 licenses
  // C9300X-12Y uses the 24-port license (LIC-C9300-24E)
  // C9350 has only 3Y and 5Y (no 1Y)
  const catMatch = upper.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (catMatch) {
    let family = catMatch[1];
    let portCount = catMatch[2];
    const tier = (requestedTier === 'A') ? 'A' : 'E';

    // C9300X and C9300L map to C9300 license SKUs
    if (family === 'C9300X' || family === 'C9300L') {
      family = 'C9300';
    }

    // C9300X-12Y uses the 24-port license
    if (portCount === '12') portCount = '24';

    // C9350 has no 1Y option
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
    // MS350-48X uses the 48-port license (LIC-MS350-48, no X)
    if (model === 'MS350' && port === '48X') port = '48';
    return [
      { term: '1Y', sku: `LIC-${model}-${port}-1YR` },
      { term: '3Y', sku: `LIC-${model}-${port}-3YR` },
      { term: '5Y', sku: `LIC-${model}-${port}-5YR` }
    ];
  }

  return null;
}

function _extractVariant(upper, family) {
  const raw = upper.slice(family.length);
  return raw.startsWith('-') ? raw.slice(1) : raw;
}

function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  if (EOL_REPLACEMENTS[upper]) return EOL_REPLACEMENTS[upper];
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = _extractVariant(upper, family);
      if (variants.includes(variant)) {
        return EOL_REPLACEMENTS[upper] || EOL_REPLACEMENTS[family] || null;
      }
    }
  }
  return null;
}

function isEol(baseSku) {
  const upper = baseSku.toUpperCase();
  for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
    if (upper.startsWith(family)) {
      const variant = _extractVariant(upper, family);
      if (variants.includes(variant)) return true;
    }
  }
  return false;
}

function buildStratusUrl(items) {
  const merged = new Map();
  for (const { sku, qty } of items) {
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }
  const skus = [...merged.keys()];
  const qtys = skus.map(s => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${skus.join(',')}&qty=${qtys.join(',')}`;
}

// ─── Prices lookup helper ────────────────────────────────────────────────────
const pricesData = require('./src/data/prices.json');
const priceMap = pricesData.prices || {};
function priceExists(sku) { return sku in priceMap; }

// ─── Test Cases ──────────────────────────────────────────────────────────────
// 200+ tests organized by category

const tests = [

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 1: applySuffix() — Hardware suffix rules (~45 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // MR family → -HW
  ...[
    ['MR28', 'MR28-HW'], ['MR36', 'MR36-HW'], ['MR36H', 'MR36H-HW'],
    ['MR44', 'MR44-HW'], ['MR46', 'MR46-HW'], ['MR46E', 'MR46E-HW'],
    ['MR57', 'MR57-HW'], ['MR76', 'MR76-HW'], ['MR78', 'MR78-HW'], ['MR86', 'MR86-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // CW Wi-Fi 6E → -MR
  ...[
    ['CW9162I', 'CW9162I-MR'], ['CW9163E', 'CW9163E-MR'],
    ['CW9164I', 'CW9164I-MR'], ['CW9166I', 'CW9166I-MR'], ['CW9166D1', 'CW9166D1-MR'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // CW Wi-Fi 7 → -RTG
  ...[
    ['CW9171I', 'CW9171I-RTG'], ['CW9172H', 'CW9172H-RTG'], ['CW9172I', 'CW9172I-RTG'],
    ['CW9174I', 'CW9174I-RTG'], ['CW9176D1', 'CW9176D1-RTG'], ['CW9176I', 'CW9176I-RTG'],
    ['CW9178I', 'CW9178I-RTG'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // CW special cases — no suffix
  ...[
    ['CW9179F', 'CW9179F'],           // CW9179F exception
    ['CW9800H1-MCG', 'CW9800H1-MCG'], // controller passthrough
    ['CW-ANT-D1-NS-00', 'CW-ANT-D1-NS-00'],  // accessory
    ['CW-MNT-ART2-00', 'CW-MNT-ART2-00'],    // mount accessory
    ['CW-INJ-8', 'CW-INJ-8'],                  // injector
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected} (no suffix)`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MX standard → -HW
  ...[
    ['MX67', 'MX67-HW'], ['MX68', 'MX68-HW'], ['MX68W', 'MX68W-HW'],
    ['MX75', 'MX75-HW'], ['MX85', 'MX85-HW'], ['MX95', 'MX95-HW'],
    ['MX105', 'MX105-HW'], ['MX250', 'MX250-HW'], ['MX450', 'MX450-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MX cellular → -HW-NA
  ...[
    ['MX67C', 'MX67C-HW-NA'], ['MX68CW', 'MX68CW-HW-NA'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MX cellular already -NA → stays
  ...[
    ['MX67C-NA', 'MX67C-NA'], ['MX68CW-NA', 'MX68CW-NA'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected} (already -NA)`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // Z family
  ...[
    ['Z4', 'Z4-HW'], ['Z4C', 'Z4C-HW'],     // standard → -HW
    ['Z4X', 'Z4X'], ['Z4CX', 'Z4CX'],         // X models → no suffix
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MG → -HW
  ...[
    ['MG41', 'MG41-HW'], ['MG41E', 'MG41E-HW'],
    ['MG52', 'MG52-HW'], ['MG52E', 'MG52E-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MV → -HW, MT → -HW
  ...[
    ['MV63X', 'MV63X-HW'], ['MV13', 'MV13-HW'], ['MV2', 'MV2-HW'],
    ['MT10', 'MT10-HW'], ['MT14', 'MT14-HW'], ['MT30', 'MT30-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MS130/MS130R → -HW
  ...[
    ['MS130-8P', 'MS130-8P-HW'], ['MS130-24P', 'MS130-24P-HW'],
    ['MS130-48', 'MS130-48-HW'], ['MS130R-8P', 'MS130R-8P-HW'],
    ['MS130-8P-I', 'MS130-8P-I-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MS150 → no suffix (critical: no -HW)
  ...[
    ['MS150-24P-4G', 'MS150-24P-4G'], ['MS150-48FP-4X', 'MS150-48FP-4X'],
    ['MS150-48LP-4G', 'MS150-48LP-4G'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected} (no suffix)`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // MS390 → -HW
  { name: '[SUFFIX] MS390-24UX → MS390-24UX-HW',
    customTest: () => ({ pass: applySuffix('MS390-24UX') === 'MS390-24UX-HW', actual: applySuffix('MS390-24UX') }) },

  // MS450 → -HW (was broken before fix)
  { name: '[SUFFIX] MS450-12 → MS450-12-HW (previously missed)',
    customTest: () => ({ pass: applySuffix('MS450-12') === 'MS450-12-HW', actual: applySuffix('MS450-12') }) },

  // Catalyst M-series → no suffix
  ...[
    ['C9200L-24P-4G-M', 'C9200L-24P-4G-M'], ['C9300-48P-M', 'C9300-48P-M'],
    ['C9300X-12Y-M', 'C9300X-12Y-M'], ['C9300L-24P-4X-M', 'C9300L-24P-4X-M'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected} (no suffix)`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // C8xxx → no suffix
  { name: '[SUFFIX] C8111-G2-MX → C8111-G2-MX (no suffix)',
    customTest: () => ({ pass: applySuffix('C8111-G2-MX') === 'C8111-G2-MX', actual: applySuffix('C8111-G2-MX') }) },
  { name: '[SUFFIX] C8455-G2-MX → C8455-G2-MX (no suffix)',
    customTest: () => ({ pass: applySuffix('C8455-G2-MX') === 'C8455-G2-MX', actual: applySuffix('C8455-G2-MX') }) },

  // MA- → no suffix
  { name: '[SUFFIX] MA-SFP-10GB-SR → MA-SFP-10GB-SR (no suffix)',
    customTest: () => ({ pass: applySuffix('MA-SFP-10GB-SR') === 'MA-SFP-10GB-SR', actual: applySuffix('MA-SFP-10GB-SR') }) },

  // Legacy MS → -HW
  ...[
    ['MS210-24P', 'MS210-24P-HW'], ['MS225-48FP', 'MS225-48FP-HW'],
    ['MS250-48FP', 'MS250-48FP-HW'], ['MS350-24X', 'MS350-24X-HW'],
    ['MS355-48X', 'MS355-48X-HW'], ['MS410-16', 'MS410-16-HW'],
    ['MS420-48', 'MS420-48-HW'], ['MS425-16', 'MS425-16-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // Idempotency: already-suffixed SKUs should not double-suffix
  ...[
    ['MR44-HW', 'MR44-HW'], ['MS130-24P-HW', 'MS130-24P-HW'],
    ['MX67C-HW-NA', 'MX67C-HW-NA'], ['CW9172H-RTG', 'CW9172H-RTG'],
    ['CW9162I-MR', 'CW9162I-MR'], ['MS390-24UX-HW', 'MS390-24UX-HW'],
    ['MS450-12-HW', 'MS450-12-HW'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX-IDEMPOTENT] ${input} → ${expected}`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 2: getLicenseSkus() — License generation (~80 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // MR/CW → LIC-ENT-{1,3,5}YR
  ...[
    'MR28', 'MR44', 'MR57', 'MR86',
    'CW9162I', 'CW9172H', 'CW9178I',
  ].map(sku => ({
    name: `[LICENSE] ${sku} → LIC-ENT-*YR`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const pass = lics && lics.length === 3 &&
        lics[0].sku === 'LIC-ENT-1YR' && lics[1].sku === 'LIC-ENT-3YR' && lics[2].sku === 'LIC-ENT-5YR';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  })),

  // CW9800 → null (controller, no license)
  { name: '[LICENSE] CW9800H1 → null (controller)',
    customTest: () => {
      const lics = getLicenseSkus('CW9800H1');
      return { pass: lics === null, actual: JSON.stringify(lics) };
    }
  },

  // MX legacy (67, 68, 68W) → -YR suffix
  ...[
    ['MX67', 'SEC', ['LIC-MX67-SEC-1YR', 'LIC-MX67-SEC-3YR', 'LIC-MX67-SEC-5YR']],
    ['MX67', 'ENT', ['LIC-MX67-ENT-1YR', 'LIC-MX67-ENT-3YR', 'LIC-MX67-ENT-5YR']],
    ['MX67', 'SDW', ['LIC-MX67-SDW-1Y', 'LIC-MX67-SDW-3Y', 'LIC-MX67-SDW-5Y']],
    ['MX67W', null, ['LIC-MX67W-SEC-1YR', 'LIC-MX67W-SEC-3YR', 'LIC-MX67W-SEC-5YR']],
    ['MX67C', null, ['LIC-MX67C-SEC-1YR', 'LIC-MX67C-SEC-3YR', 'LIC-MX67C-SEC-5YR']],
    ['MX68', null, ['LIC-MX68-SEC-1YR', 'LIC-MX68-SEC-3YR', 'LIC-MX68-SEC-5YR']],
    ['MX68W', null, ['LIC-MX68W-SEC-1YR', 'LIC-MX68W-SEC-3YR', 'LIC-MX68W-SEC-5YR']],
    ['MX68CW', null, ['LIC-MX68CW-SEC-1YR', 'LIC-MX68CW-SEC-3YR', 'LIC-MX68CW-SEC-5YR']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'default'} → ${expected[0].replace('LIC-','').split('-').slice(-1)[0]} suffix`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MX cellular -NA variant
  ...[
    ['MX67C-NA', null, ['LIC-MX67C-SEC-1YR', 'LIC-MX67C-SEC-3YR', 'LIC-MX67C-SEC-5YR']],
    ['MX68CW-NA', null, ['LIC-MX68CW-SEC-1YR', 'LIC-MX68CW-SEC-3YR', 'LIC-MX68CW-SEC-5YR']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} → correct -NA handling`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MX newer (75, 85, 95, 105) → -Y suffix
  ...[
    ['MX75', null, ['LIC-MX75-SEC-1Y', 'LIC-MX75-SEC-3Y', 'LIC-MX75-SEC-5Y']],
    ['MX85', 'ENT', ['LIC-MX85-ENT-1Y', 'LIC-MX85-ENT-3Y', 'LIC-MX85-ENT-5Y']],
    ['MX95', 'SDW', ['LIC-MX95-SDW-1Y', 'LIC-MX95-SDW-3Y', 'LIC-MX95-SDW-5Y']],
    ['MX105', null, ['LIC-MX105-SEC-1Y', 'LIC-MX105-SEC-3Y', 'LIC-MX105-SEC-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'default'} → -Y suffix (newer)`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MX250/MX450 → -YR suffix (NOT newer, critical edge case)
  ...[
    ['MX250', null, ['LIC-MX250-SEC-1YR', 'LIC-MX250-SEC-3YR', 'LIC-MX250-SEC-5YR']],
    ['MX450', null, ['LIC-MX450-SEC-1YR', 'LIC-MX450-SEC-3YR', 'LIC-MX450-SEC-5YR']],
    ['MX250', 'SDW', ['LIC-MX250-SDW-1Y', 'LIC-MX250-SDW-3Y', 'LIC-MX250-SDW-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'default'} → -YR suffix (not newer)`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // Z family
  ...[
    ['Z1', null, ['LIC-Z1-ENT-1YR', 'LIC-Z1-ENT-3YR', 'LIC-Z1-ENT-5YR']],
    ['Z3', null, ['LIC-Z3-ENT-1YR', 'LIC-Z3-ENT-3YR', 'LIC-Z3-ENT-5YR']],
    ['Z3C', null, ['LIC-Z3C-ENT-1YR', 'LIC-Z3C-ENT-3YR', 'LIC-Z3C-ENT-5YR']],
    ['Z4', null, ['LIC-Z4-SEC-1Y', 'LIC-Z4-SEC-3Y', 'LIC-Z4-SEC-5Y']],
    ['Z4', 'ENT', ['LIC-Z4-ENT-1Y', 'LIC-Z4-ENT-3Y', 'LIC-Z4-ENT-5Y']],
    ['Z4C', null, ['LIC-Z4C-SEC-1Y', 'LIC-Z4C-SEC-3Y', 'LIC-Z4C-SEC-5Y']],
    ['Z4X', null, ['LIC-Z4-SEC-1Y', 'LIC-Z4-SEC-3Y', 'LIC-Z4-SEC-5Y']],
    ['Z4CX', null, ['LIC-Z4C-SEC-1Y', 'LIC-Z4C-SEC-3Y', 'LIC-Z4C-SEC-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'default'} → Z license`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MG — E-suffix stripping
  ...[
    ['MG41', ['LIC-MG41-ENT-1Y', 'LIC-MG41-ENT-3Y', 'LIC-MG41-ENT-5Y']],
    ['MG41E', ['LIC-MG41-ENT-1Y', 'LIC-MG41-ENT-3Y', 'LIC-MG41-ENT-5Y']],
    ['MG52', ['LIC-MG52-ENT-1Y', 'LIC-MG52-ENT-3Y', 'LIC-MG52-ENT-5Y']],
    ['MG52E', ['LIC-MG52-ENT-1Y', 'LIC-MG52-ENT-3Y', 'LIC-MG52-ENT-5Y']],
  ].map(([sku, expected]) => ({
    name: `[LICENSE] ${sku} → strips E for license`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MS130R → CMPT
  { name: '[LICENSE] MS130R-8P → LIC-MS130-CMPT-*',
    customTest: () => {
      const lics = getLicenseSkus('MS130R-8P');
      const pass = lics && lics[0].sku === 'LIC-MS130-CMPT-1Y';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },

  // MS130 small (8, 12) → CMPT
  ...[
    'MS130-8', 'MS130-8P', 'MS130-8X', 'MS130-12X',
  ].map(sku => ({
    name: `[LICENSE] ${sku} → LIC-MS130-CMPT-*`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const pass = lics && lics[0].sku === 'LIC-MS130-CMPT-1Y';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  })),

  // MS130 large (24, 48) → port-based
  ...[
    ['MS130-24', ['LIC-MS130-24-1Y', 'LIC-MS130-24-3Y', 'LIC-MS130-24-5Y']],
    ['MS130-24P', ['LIC-MS130-24-1Y', 'LIC-MS130-24-3Y', 'LIC-MS130-24-5Y']],
    ['MS130-48', ['LIC-MS130-48-1Y', 'LIC-MS130-48-3Y', 'LIC-MS130-48-5Y']],
    ['MS130-48P', ['LIC-MS130-48-1Y', 'LIC-MS130-48-3Y', 'LIC-MS130-48-5Y']],
  ].map(([sku, expected]) => ({
    name: `[LICENSE] ${sku} → port-based`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MS150 → port-based -Y
  ...[
    ['MS150-24P-4G', ['LIC-MS150-24-1Y', 'LIC-MS150-24-3Y', 'LIC-MS150-24-5Y']],
    ['MS150-48FP-4X', ['LIC-MS150-48-1Y', 'LIC-MS150-48-3Y', 'LIC-MS150-48-5Y']],
    ['MS150-48LP-4G', ['LIC-MS150-48-1Y', 'LIC-MS150-48-3Y', 'LIC-MS150-48-5Y']],
  ].map(([sku, expected]) => ({
    name: `[LICENSE] ${sku} → ${expected[0]}`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MS125 → -Y (not -YR)
  ...[
    ['MS125-24P', ['LIC-MS125-24P-1Y', 'LIC-MS125-24P-3Y', 'LIC-MS125-24P-5Y']],
  ].map(([sku, expected]) => ({
    name: `[LICENSE] ${sku} → -Y suffix (not -YR)`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MS390 → {portCount}{A|E}-{term}Y
  ...[
    ['MS390-24UX', null, ['LIC-MS390-24E-1Y', 'LIC-MS390-24E-3Y', 'LIC-MS390-24E-5Y']],
    ['MS390-48P', null, ['LIC-MS390-48E-1Y', 'LIC-MS390-48E-3Y', 'LIC-MS390-48E-5Y']],
    ['MS390-48UX2', null, ['LIC-MS390-48E-1Y', 'LIC-MS390-48E-3Y', 'LIC-MS390-48E-5Y']],
    ['MS390-24', 'A', ['LIC-MS390-24A-1Y', 'LIC-MS390-24A-3Y', 'LIC-MS390-24A-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'E'} → MS390 format`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // Catalyst C9200L
  ...[
    ['C9200L-24P-4G-M', null, ['LIC-C9200L-24E-1Y', 'LIC-C9200L-24E-3Y', 'LIC-C9200L-24E-5Y']],
    ['C9200L-48P-4X-M', null, ['LIC-C9200L-48E-1Y', 'LIC-C9200L-48E-3Y', 'LIC-C9200L-48E-5Y']],
    ['C9200L-24T-4G-M', 'A', ['LIC-C9200L-24A-1Y', 'LIC-C9200L-24A-3Y', 'LIC-C9200L-24A-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'E'} → C9200L`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // Catalyst C9300
  ...[
    ['C9300-24P-M', null, ['LIC-C9300-24E-1Y', 'LIC-C9300-24E-3Y', 'LIC-C9300-24E-5Y']],
    ['C9300-48UXM-M', null, ['LIC-C9300-48E-1Y', 'LIC-C9300-48E-3Y', 'LIC-C9300-48E-5Y']],
    ['C9300-48T-M', 'A', ['LIC-C9300-48A-1Y', 'LIC-C9300-48A-3Y', 'LIC-C9300-48A-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'E'} → C9300`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // C9300X → maps to C9300 licenses
  ...[
    ['C9300X-24Y-M', null, ['LIC-C9300-24E-1Y', 'LIC-C9300-24E-3Y', 'LIC-C9300-24E-5Y']],
    ['C9300X-48HX-M', null, ['LIC-C9300-48E-1Y', 'LIC-C9300-48E-3Y', 'LIC-C9300-48E-5Y']],
    ['C9300X-12Y-M', null, ['LIC-C9300-24E-1Y', 'LIC-C9300-24E-3Y', 'LIC-C9300-24E-5Y']], // 12→24 port mapping
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} → maps to C9300 (${sku.includes('12Y') ? '12→24 port' : 'family mapping'})`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // C9300L → maps to C9300 licenses
  ...[
    ['C9300L-24P-4X-M', null, ['LIC-C9300-24E-1Y', 'LIC-C9300-24E-3Y', 'LIC-C9300-24E-5Y']],
    ['C9300L-48PF-4X-M', null, ['LIC-C9300-48E-1Y', 'LIC-C9300-48E-3Y', 'LIC-C9300-48E-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} → maps to C9300`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // C9350 → only 3Y and 5Y (no 1Y)
  ...[
    ['C9350-24', null, ['LIC-C9350-24E-3Y', 'LIC-C9350-24E-5Y']],
    ['C9350-48', null, ['LIC-C9350-48E-3Y', 'LIC-C9350-48E-5Y']],
    ['C9350-48', 'A', ['LIC-C9350-48A-3Y', 'LIC-C9350-48A-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'E'} → C9350 no-1Y (${expected.length} terms)`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = lics && lics.length === 2 && JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // C8111/C8455
  ...[
    ['C8111-G2-MX', null, ['LIC-C8111-ENT-1Y', 'LIC-C8111-ENT-3Y', 'LIC-C8111-ENT-5Y']],
    ['C8111-G2-MX', 'SDW', ['LIC-C8111-SDW-1Y', 'LIC-C8111-SDW-3Y', 'LIC-C8111-SDW-5Y']],
    ['C8111-G2-MX', 'SEC', ['LIC-C8111-SEC-1Y', 'LIC-C8111-SEC-3Y', 'LIC-C8111-SEC-5Y']],
    ['C8455-G2-MX', null, ['LIC-C8455-ENT-1Y', 'LIC-C8455-ENT-3Y', 'LIC-C8455-ENT-5Y']],
  ].map(([sku, tier, expected]) => ({
    name: `[LICENSE] ${sku} ${tier || 'ENT'} → C8xxx router`,
    customTest: () => {
      const lics = getLicenseSkus(sku, tier);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // MV → LIC-MV-{1,3,5}YR
  ...[
    'MV13', 'MV63X', 'MV93',
  ].map(sku => ({
    name: `[LICENSE] ${sku} → LIC-MV-*YR`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const pass = lics && lics[0].sku === 'LIC-MV-1YR' && lics[2].sku === 'LIC-MV-5YR';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  })),

  // MT → LIC-MT-{1,3,5}Y
  ...[
    'MT10', 'MT14', 'MT30',
  ].map(sku => ({
    name: `[LICENSE] ${sku} → LIC-MT-*Y`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const pass = lics && lics[0].sku === 'LIC-MT-1Y' && lics[2].sku === 'LIC-MT-5Y';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  })),

  // MS450 → legacy -YR format
  { name: '[LICENSE] MS450-12 → LIC-MS450-12-*YR',
    customTest: () => {
      const lics = getLicenseSkus('MS450-12');
      const expected = ['LIC-MS450-12-1YR', 'LIC-MS450-12-3YR', 'LIC-MS450-12-5YR'];
      const actual = lics?.map(l => l.sku);
      return { pass: JSON.stringify(actual) === JSON.stringify(expected), actual: JSON.stringify(actual) };
    }
  },

  // Legacy MS (210, 225, 250, 350, 355, 410, 420, 425) → -YR
  ...[
    ['MS210-24P', ['LIC-MS210-24P-1YR', 'LIC-MS210-24P-3YR', 'LIC-MS210-24P-5YR']],
    ['MS225-48FP', ['LIC-MS225-48FP-1YR', 'LIC-MS225-48FP-3YR', 'LIC-MS225-48FP-5YR']],
    ['MS250-48FP', ['LIC-MS250-48FP-1YR', 'LIC-MS250-48FP-3YR', 'LIC-MS250-48FP-5YR']],
    ['MS350-24X', ['LIC-MS350-24X-1YR', 'LIC-MS350-24X-3YR', 'LIC-MS350-24X-5YR']],
    ['MS350-48X', ['LIC-MS350-48-1YR', 'LIC-MS350-48-3YR', 'LIC-MS350-48-5YR']], // 48X → 48
    ['MS350-48', ['LIC-MS350-48-1YR', 'LIC-MS350-48-3YR', 'LIC-MS350-48-5YR']],
    ['MS355-24X', ['LIC-MS355-24X-1YR', 'LIC-MS355-24X-3YR', 'LIC-MS355-24X-5YR']],
    ['MS355-48X2', ['LIC-MS355-48X2-1YR', 'LIC-MS355-48X2-3YR', 'LIC-MS355-48X2-5YR']],
    ['MS410-16', ['LIC-MS410-16-1YR', 'LIC-MS410-16-3YR', 'LIC-MS410-16-5YR']],
    ['MS410-32', ['LIC-MS410-32-1YR', 'LIC-MS410-32-3YR', 'LIC-MS410-32-5YR']],
    ['MS420-24', ['LIC-MS420-24-1YR', 'LIC-MS420-24-3YR', 'LIC-MS420-24-5YR']],
    ['MS420-48', ['LIC-MS420-48-1YR', 'LIC-MS420-48-3YR', 'LIC-MS420-48-5YR']],
    ['MS425-16', ['LIC-MS425-16-1YR', 'LIC-MS425-16-3YR', 'LIC-MS425-16-5YR']],
    ['MS425-32', ['LIC-MS425-32-1YR', 'LIC-MS425-32-3YR', 'LIC-MS425-32-5YR']],
  ].map(([sku, expected]) => ({
    name: `[LICENSE] ${sku} → legacy -YR`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      const actual = lics?.map(l => l.sku);
      const pass = JSON.stringify(actual) === JSON.stringify(expected);
      return { pass, actual: JSON.stringify(actual) };
    }
  })),

  // LICENSE → prices.json cross-check (every generated license must exist in prices)
  ...[
    'MR44', 'MX67', 'MX75', 'MX250', 'MX67C-NA', 'MX68CW-NA',
    'Z4', 'Z4C', 'MG41', 'MG52E', 'MS130-24', 'MS130-8P', 'MS130R-8P',
    'MS150-24P-4G', 'MS150-48FP-4X', 'MS125-24P',
    'MS390-24UX', 'C9200L-24P-4G-M', 'C9300-48P-M',
    'C9300X-12Y-M', 'C9300L-48PF-4X-M', 'C8111-G2-MX', 'C8455-G2-MX',
    'MV63X', 'MT10', 'MS450-12',
    'MS210-24P', 'MS350-24X', 'MS355-48X', 'MS425-32',
  ].map(sku => ({
    name: `[LICENSE-PRICE] ${sku} → all licenses exist in prices.json`,
    customTest: () => {
      const lics = getLicenseSkus(sku);
      if (!lics) return { pass: false, actual: 'null licenses' };
      const missing = lics.filter(l => !priceExists(l.sku));
      return { pass: missing.length === 0, actual: missing.length > 0 ? `Missing: ${missing.map(l => l.sku).join(', ')}` : 'all exist' };
    }
  })),

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 3: EOL detection and replacement (~30 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // MR EOL
  ...[
    ['MR12', 'MR28'], ['MR18', 'MR28'], ['MR34', 'MR44'], ['MR42', 'MR44'],
    ['MR42E', 'MR46E'], ['MR53', 'MR57'], ['MR55', 'MR57'], ['MR70', 'MR78'],
    ['MR72', 'MR86'], ['MR84', 'MR86'], ['MR74', 'MR76'],
  ].map(([eol, repl]) => ({
    name: `[EOL] ${eol} → ${repl}`,
    customTest: () => {
      const r = checkEol(eol);
      return { pass: r === repl, actual: JSON.stringify(r) };
    }
  })),

  // MX EOL
  ...[
    ['MX60', 'MX67'], ['MX60W', 'MX67W'], ['MX64', 'MX67'], ['MX64W', 'MX67W'],
    ['MX65', 'MX68'], ['MX65W', 'MX68W'], ['MX80', 'MX85'], ['MX84', 'MX85'],
    ['MX100', 'MX95'], ['MX400', 'MX450'], ['MX600', 'MX450'],
  ].map(([eol, repl]) => ({
    name: `[EOL] ${eol} → ${repl}`,
    customTest: () => {
      const r = checkEol(eol);
      return { pass: r === repl, actual: JSON.stringify(r) };
    }
  })),

  // MG/Z EOL
  ...[
    ['MG21', 'MG41'], ['MG21E', 'MG41E'], ['MG51', 'MG52'], ['MG51E', 'MG52E'],
    ['Z1', 'Z4'], ['Z3', 'Z4'], ['Z3C', 'Z4C'],
  ].map(([eol, repl]) => ({
    name: `[EOL] ${eol} → ${repl}`,
    customTest: () => {
      const r = checkEol(eol);
      return { pass: r === repl, actual: JSON.stringify(r) };
    }
  })),

  // MS EOL → single replacement
  ...[
    ['MS120-8FP', 'MS130-8P'], ['MS120-24P', 'MS130-24P'], ['MS120-48LP', 'MS130-48P'],
    ['MS220-24P', 'MS130-24P'], ['MS220-48FP', 'MS130-48P'],
    ['MS250-24P', 'C9300L-24P-4X-M'], ['MS250-48FP', 'C9300L-48PF-4X-M'],
    ['MS350-48FP', 'C9300-48P-M'], ['MS350-48X', 'C9300-48UXM-M'],
    ['MS390-48UX', 'C9300-48UXM-M'], ['MS390-24UX', 'C9300-24UX-M'],
    ['MS390-48UX2', 'C9300-48UN-M'],
    ['MS425-16', 'C9300X-24Y-M'], ['MS425-32', 'C9300X-24Y-M'],
    ['MS355-24X', 'C9300X-24HX-M'], ['MS355-48X2', 'C9300X-48HX-M'],
  ].map(([eol, repl]) => ({
    name: `[EOL] ${eol} → ${repl}`,
    customTest: () => {
      const r = checkEol(eol);
      return { pass: r === repl, actual: JSON.stringify(r) };
    }
  })),

  // MS EOL → dual uplink replacement
  ...[
    ['MS210-24P', ['MS150-24P-4G', 'MS150-24P-4X']],
    ['MS210-48FP', ['MS150-48FP-4G', 'MS150-48FP-4X']],
    ['MS225-24P', ['MS150-24P-4G', 'MS150-24P-4X']],
    ['MS225-48LP', ['MS150-48LP-4G', 'MS150-48LP-4X']],
    ['MS320-48LP', ['MS150-48LP-4G', 'MS150-48LP-4X']],
    ['MS320-24P', ['MS150-24P-4G', 'MS150-24P-4X']],
  ].map(([eol, repl]) => ({
    name: `[EOL-DUAL] ${eol} → dual uplink`,
    customTest: () => {
      const r = checkEol(eol);
      return { pass: JSON.stringify(r) === JSON.stringify(repl), actual: JSON.stringify(r) };
    }
  })),

  // Non-EOL models should return null/false
  ...[
    'MR44', 'MR57', 'MX67', 'MX85', 'MS130-24P', 'MS150-48FP-4G',
    'C9300-48P-M', 'C9200L-24P-4G-M', 'MT10', 'MV63X', 'Z4',
  ].map(sku => ({
    name: `[NOT-EOL] ${sku} → not EOL`,
    customTest: () => {
      const eol = isEol(sku);
      return { pass: !eol, actual: `isEol=${eol}` };
    }
  })),

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 4: buildStratusUrl() (~8 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  { name: '[URL] Single item',
    customTest: () => {
      const url = buildStratusUrl([{ sku: 'MR44-HW', qty: 5 }]);
      return { pass: url === 'https://stratusinfosystems.com/order/?item=MR44-HW&qty=5', actual: url };
    }
  },
  { name: '[URL] Multiple items',
    customTest: () => {
      const url = buildStratusUrl([{ sku: 'MR44-HW', qty: 5 }, { sku: 'LIC-ENT-3YR', qty: 5 }]);
      return { pass: url.includes('item=MR44-HW,LIC-ENT-3YR') && url.includes('qty=5,5'), actual: url };
    }
  },
  { name: '[URL] Dedup consolidation sums quantities',
    customTest: () => {
      const url = buildStratusUrl([
        { sku: 'MS130-8P-HW', qty: 1 }, { sku: 'LIC-MS130-CMPT-3Y', qty: 1 },
        { sku: 'MS130-8P-HW', qty: 2 }, { sku: 'LIC-MS130-CMPT-3Y', qty: 2 },
      ]);
      return { pass: url.includes('qty=3,3'), actual: url };
    }
  },
  { name: '[URL] Triple dedup',
    customTest: () => {
      const url = buildStratusUrl([
        { sku: 'MR44-HW', qty: 1 }, { sku: 'MR44-HW', qty: 1 }, { sku: 'MR44-HW', qty: 1 },
      ]);
      return { pass: url.includes('item=MR44-HW&qty=3'), actual: url };
    }
  },
  { name: '[URL] No double-counting with different SKUs',
    customTest: () => {
      const url = buildStratusUrl([
        { sku: 'MR44-HW', qty: 2 }, { sku: 'MR57-HW', qty: 3 },
      ]);
      return { pass: url.includes('item=MR44-HW,MR57-HW') && url.includes('qty=2,3'), actual: url };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 5: Full chain tests — EOL → replacement → suffix → license → price (~15 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  ...[
    ['MS220-24P', 'MS130-24P', 'MS130-24P-HW', 'LIC-MS130-24-3Y'],
    ['MS120-8FP', 'MS130-8P', 'MS130-8P-HW', 'LIC-MS130-CMPT-3Y'],
    ['MX64', 'MX67', 'MX67-HW', 'LIC-MX67-SEC-3YR'],
    ['MX80', 'MX85', 'MX85-HW', 'LIC-MX85-SEC-3Y'],
    ['MX100', 'MX95', 'MX95-HW', 'LIC-MX95-SEC-3Y'],
    ['MR42', 'MR44', 'MR44-HW', 'LIC-ENT-3YR'],
    ['MR70', 'MR78', 'MR78-HW', 'LIC-ENT-3YR'],
    ['MG51', 'MG52', 'MG52-HW', 'LIC-MG52-ENT-3Y'],
    ['Z1', 'Z4', 'Z4-HW', 'LIC-Z4-SEC-3Y'],
    ['Z3C', 'Z4C', 'Z4C-HW', 'LIC-Z4C-SEC-3Y'],
    ['MS390-48UX', 'C9300-48UXM-M', 'C9300-48UXM-M', 'LIC-C9300-48E-3Y'],
    ['MS425-32', 'C9300X-24Y-M', 'C9300X-24Y-M', 'LIC-C9300-24E-3Y'],
    ['MS250-48FP', 'C9300L-48PF-4X-M', 'C9300L-48PF-4X-M', 'LIC-C9300-48E-3Y'],
    ['MS355-24X', 'C9300X-24HX-M', 'C9300X-24HX-M', 'LIC-C9300-24E-3Y'],
    ['MS350-48X', 'C9300-48UXM-M', 'C9300-48UXM-M', 'LIC-C9300-48E-3Y'],
  ].map(([eol, expectedRepl, expectedSuffix, expectedLic]) => ({
    name: `[CHAIN] ${eol} → ${expectedRepl} → suffix → license → price`,
    customTest: () => {
      const repl = checkEol(eol);
      const primary = Array.isArray(repl) ? repl[0] : repl;
      if (primary !== expectedRepl) return { pass: false, actual: `replacement: ${primary} (expected ${expectedRepl})` };
      const suffixed = applySuffix(primary);
      if (suffixed !== expectedSuffix) return { pass: false, actual: `suffix: ${suffixed} (expected ${expectedSuffix})` };
      const lics = getLicenseSkus(primary);
      if (!lics) return { pass: false, actual: `no licenses for ${primary}` };
      const lic3y = lics.find(l => l.term === '3Y');
      if (!lic3y || lic3y.sku !== expectedLic) return { pass: false, actual: `3Y license: ${lic3y?.sku} (expected ${expectedLic})` };
      if (!priceExists(expectedLic)) return { pass: false, actual: `${expectedLic} missing from prices.json` };
      return { pass: true, actual: 'full chain valid' };
    }
  })),

  // Chain for dual uplink EOL
  ...[
    ['MS210-24P', ['MS150-24P-4G', 'MS150-24P-4X'], 'LIC-MS150-24-3Y'],
    ['MS225-48FP', ['MS150-48FP-4G', 'MS150-48FP-4X'], 'LIC-MS150-48-3Y'],
    ['MS320-48LP', ['MS150-48LP-4G', 'MS150-48LP-4X'], 'LIC-MS150-48-3Y'],
  ].map(([eol, expectedRepl, expectedLic]) => ({
    name: `[CHAIN-DUAL] ${eol} → dual uplink → license → price`,
    customTest: () => {
      const repl = checkEol(eol);
      if (JSON.stringify(repl) !== JSON.stringify(expectedRepl)) return { pass: false, actual: `replacement: ${JSON.stringify(repl)}` };
      // Both variants should produce same license
      for (const r of repl) {
        const lics = getLicenseSkus(r);
        if (!lics) return { pass: false, actual: `no licenses for ${r}` };
        const lic3y = lics.find(l => l.term === '3Y');
        if (lic3y.sku !== expectedLic) return { pass: false, actual: `${r} 3Y: ${lic3y.sku} (expected ${expectedLic})` };
      }
      if (!priceExists(expectedLic)) return { pass: false, actual: `${expectedLic} missing from prices.json` };
      return { pass: true, actual: 'dual chain valid' };
    }
  })),

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 6: Parser tests (~12 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  { name: '[PARSE] Multi-line license CSV',
    input: 'LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MS220-8P-3YR,2\nLIC-MS225-24P-3YR,5\nLIC-MS225-48FP-3YR,1\nLIC-MS250-48FP-3YR,6\nLIC-MS425-32-3YR,1\nLIC-MT-3Y,1',
    expect: { directLicense: true, itemCount: 8, firstQty: 26 }
  },
  { name: '[PARSE] Multi-line license CSV (double-pasted with header)',
    input: 'LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MT-3Y,1\nSKU,Count\nLIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MT-3Y,1',
    expect: { directLicense: true, itemCount: 3, firstQty: 26 }
  },
  { name: '[PARSE] Single hardware item with qty',
    input: '5 MR44',
    expect: { notEol: true }
  },
  { name: '[PARSE] Multiple hardware items',
    input: '2 MS220-24P, 3 MR44',
    expect: { eolCount: 1, resolvedCount: 1 }
  },
  { name: '[PARSE] Mixed EOL + non-EOL (3 items)',
    input: '10 MR42, 5 MR44, 2 MX64',
    expect: { eolCount: 2, resolvedCount: 1 }
  },
  { name: '[PARSE] Direct MS150 not EOL',
    input: '1 MS150-48FP-4G',
    expect: { notEol: true }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 7: EOL dates loaded correctly (~4 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  { name: '[EOL-DATE] MX64 dates loaded',
    customTest: () => {
      const dates = (catalog._EOL_DATES || {})['MX64'];
      return { pass: dates && dates.eos === '2022-07-26' && dates.eost === '2027-07-26', actual: JSON.stringify(dates) };
    }
  },
  { name: '[EOL-DATE] MS390-48UX dates loaded',
    customTest: () => {
      const dates = (catalog._EOL_DATES || {})['MS390-48UX'];
      return { pass: dates && dates.eos === '2025-03-28' && dates.eost === '2032-03-28', actual: JSON.stringify(dates) };
    }
  },
  { name: '[EOL-DATE] MS120-8FP dates loaded',
    customTest: () => {
      const dates = (catalog._EOL_DATES || {})['MS120-8FP'];
      return { pass: dates && dates.eos === '2025-02-20', actual: JSON.stringify(dates) };
    }
  },
  { name: '[EOL-DATE] MS125-24 dates loaded',
    customTest: () => {
      const dates = (catalog._EOL_DATES || {})['MS125-24'];
      return { pass: dates && dates.eos === '2025-03-28', actual: JSON.stringify(dates) };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 8: Edge cases and regressions (~10 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // Case insensitivity
  { name: '[EDGE] case insensitive: mr44 → MR44-HW',
    customTest: () => ({ pass: applySuffix('mr44') === 'MR44-HW', actual: applySuffix('mr44') }) },
  { name: '[EDGE] case insensitive: mx67c → MX67C-HW-NA',
    customTest: () => ({ pass: applySuffix('mx67c') === 'MX67C-HW-NA', actual: applySuffix('mx67c') }) },
  { name: '[EDGE] case insensitive license: mr44 → LIC-ENT',
    customTest: () => {
      const lics = getLicenseSkus('mr44');
      return { pass: lics && lics[0].sku === 'LIC-ENT-1YR', actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },

  // MS130-8P-I (industrial variant) suffix and license
  { name: '[EDGE] MS130-8P-I suffix → MS130-8P-I-HW',
    customTest: () => ({ pass: applySuffix('MS130-8P-I') === 'MS130-8P-I-HW', actual: applySuffix('MS130-8P-I') }) },

  // MX67W suffix
  { name: '[EDGE] MX67W → MX67W-HW (W variant, not cellular)',
    customTest: () => ({ pass: applySuffix('MX67W') === 'MX67W-HW', actual: applySuffix('MX67W') }) },

  // MS350-24X vs MS350-48X license difference
  { name: '[EDGE] MS350-24X keeps X in license, MS350-48X strips X',
    customTest: () => {
      const lics24x = getLicenseSkus('MS350-24X');
      const lics48x = getLicenseSkus('MS350-48X');
      const pass24 = lics24x && lics24x[0].sku === 'LIC-MS350-24X-1YR';
      const pass48 = lics48x && lics48x[0].sku === 'LIC-MS350-48-1YR';
      return { pass: pass24 && pass48, actual: `24X→${lics24x?.[0]?.sku}, 48X→${lics48x?.[0]?.sku}` };
    }
  },

  // MG21E → MG41E EOL, then MG41E strips E for license
  { name: '[EDGE] MG21E EOL → MG41E → license strips E → LIC-MG41-ENT',
    customTest: () => {
      const repl = checkEol('MG21E');
      if (repl !== 'MG41E') return { pass: false, actual: `repl=${repl}` };
      const lics = getLicenseSkus('MG41E');
      return { pass: lics && lics[0].sku === 'LIC-MG41-ENT-1Y', actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },

  // Z4X license uses Z4 (strips X)
  { name: '[EDGE] Z4X → uses Z4 license (strips X)',
    customTest: () => {
      const lics = getLicenseSkus('Z4X');
      return { pass: lics && lics[0].sku === 'LIC-Z4-SEC-1Y', actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },

  // Z4CX license uses Z4C (strips X)
  { name: '[EDGE] Z4CX → uses Z4C license (strips X)',
    customTest: () => {
      const lics = getLicenseSkus('Z4CX');
      return { pass: lics && lics[0].sku === 'LIC-Z4C-SEC-1Y', actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },

  // SDW tier always uses -Y regardless of model age
  { name: '[EDGE] MX67 SDW → always -Y (not -YR)',
    customTest: () => {
      const lics = getLicenseSkus('MX67', 'SDW');
      const pass = lics && lics[0].sku === 'LIC-MX67-SDW-1Y';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },
  { name: '[EDGE] MX250 SDW → always -Y',
    customTest: () => {
      const lics = getLicenseSkus('MX250', 'SDW');
      const pass = lics && lics[0].sku === 'LIC-MX250-SDW-1Y';
      return { pass, actual: JSON.stringify(lics?.map(l => l.sku)) };
    }
  },
];

// ─── Simple parseMessage for testing (extracts items from text) ──────────────
function testParseItems(text) {
  const upper = text.toUpperCase().trim();

  // Multi-line license parser
  const lines = text.trim().split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  if (lines.length >= 2) {
    const licItems = [];
    for (const line of lines) {
      const csvMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[,\s]\s*(\d+)\s*$/i);
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else {
        const singleMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
        if (singleMatch) {
          licItems.push({ sku: singleMatch[1].toUpperCase(), qty: 1 });
        }
      }
    }
    // Deduplicate
    const seenSkus = new Set();
    const dedupedItems = [];
    for (const item of licItems) {
      if (!seenSkus.has(item.sku)) {
        seenSkus.add(item.sku);
        dedupedItems.push(item);
      }
    }
    if (dedupedItems.length >= 2) {
      return { directLicenseList: dedupedItems };
    }
  }

  // Hardware items parser (simplified)
  const items = [];
  const pattern = /(\d+)\s*[xX×]?\s*([A-Z][A-Z0-9-]+)/g;
  let match;
  while ((match = pattern.exec(upper)) !== null) {
    items.push({ baseSku: match[2], qty: parseInt(match[1]) });
  }
  // Single item without qty
  if (items.length === 0) {
    const singleMatch = upper.match(/^([A-Z][A-Z0-9-]+)$/);
    if (singleMatch) {
      items.push({ baseSku: singleMatch[1], qty: 1 });
    }
  }
  return { items };
}

// ─── Run Tests ───────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

for (const test of tests) {
  process.stdout.write(`  ${test.name}... `);

  if (test.customTest) {
    const result = test.customTest();
    if (result.pass) {
      console.log('✅ PASS');
      passed++;
    } else {
      console.log(`❌ FAIL — ${result.actual}`);
      failed++;
    }
    continue;
  }

  const parsed = testParseItems(test.input);
  const expect = test.expect;
  let pass = true;
  let detail = '';

  if (expect.directLicense) {
    if (!parsed.directLicenseList) {
      pass = false;
      detail = 'Expected directLicenseList but got hardware items';
    } else {
      if (expect.itemCount && parsed.directLicenseList.length !== expect.itemCount) {
        pass = false;
        detail = `Expected ${expect.itemCount} items, got ${parsed.directLicenseList.length}`;
      }
      if (expect.firstQty && parsed.directLicenseList[0].qty !== expect.firstQty) {
        pass = false;
        detail = `Expected first qty ${expect.firstQty}, got ${parsed.directLicenseList[0].qty}`;
      }
    }
  } else if (expect.notEol) {
    const baseSku = parsed.items?.[0]?.baseSku;
    if (isEol(baseSku || '')) {
      pass = false;
      detail = `${baseSku} should NOT be EOL`;
    }
  } else if (expect.replacement) {
    const baseSku = parsed.items?.[0]?.baseSku;
    const repl = checkEol(baseSku || '');
    if (JSON.stringify(repl) !== JSON.stringify(expect.replacement)) {
      pass = false;
      detail = `Expected replacement ${JSON.stringify(expect.replacement)}, got ${JSON.stringify(repl)}`;
    }
    if (expect.hwSku) {
      const primary = Array.isArray(repl) ? repl[0] : repl;
      const hw = applySuffix(primary);
      if (hw !== expect.hwSku) {
        pass = false;
        detail = `Expected hwSku ${expect.hwSku}, got ${hw}`;
      }
    }
    if (expect.qty) {
      const qty = parsed.items?.[0]?.qty;
      if (qty !== expect.qty) {
        pass = false;
        detail = `Expected qty ${expect.qty}, got ${qty}`;
      }
    }
  } else if (expect.eolCount !== undefined) {
    let eolC = 0, resC = 0;
    for (const { baseSku } of (parsed.items || [])) {
      if (isEol(baseSku)) eolC++;
      else resC++;
    }
    if (eolC !== expect.eolCount || resC !== expect.resolvedCount) {
      pass = false;
      detail = `Expected ${expect.eolCount} EOL + ${expect.resolvedCount} resolved, got ${eolC} EOL + ${resC} resolved`;
    }
  }

  if (pass) {
    console.log('✅ PASS');
    passed++;
  } else {
    console.log(`❌ FAIL — ${detail}`);
    failed++;
  }
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
