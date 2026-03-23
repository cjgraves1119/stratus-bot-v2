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
  if (/^MX\d+C[W]?-NA$/i.test(upper)) return upper;
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

// ─── Test Cases ──────────────────────────────────────────────────────────────

const tests = [
  {
    name: 'Single EOL switch → proportional mapping',
    input: '1 MS220-24P',
    expect: { replacement: 'MS130-24P', hwSku: 'MS130-24P-HW' }
  },
  {
    name: 'EOL switch MS250-48FP → C9300L (official replacement)',
    input: '1 MS250-48FP',
    expect: { replacement: 'C9300L-48PF-4X-M' }
  },
  {
    name: 'MS250-24P → C9300L (official replacement)',
    input: '1 MS250-24P',
    expect: { replacement: 'C9300L-24P-4X-M' }
  },
  {
    name: 'MS320-48LP dual uplink',
    input: '1 MS320-48LP',
    expect: { replacement: ['MS150-48LP-4G', 'MS150-48LP-4X'] }
  },
  {
    name: 'MS350-48FP → C9300-48P-M (MS390 is EOL, skip to C9300)',
    input: '1 MS350-48FP',
    expect: { replacement: 'C9300-48P-M' }
  },
  {
    name: 'MS425-32 → C9300X-24Y-M (fixed per CLAUDE.md)',
    input: '1 MS425-32',
    expect: { replacement: 'C9300X-24Y-M' }
  },
  {
    name: 'MS120-8FP → MS130-8P',
    input: '1 MS120-8FP',
    expect: { replacement: 'MS130-8P', hwSku: 'MS130-8P-HW' }
  },
  {
    name: 'MS220-48LP → MS130-48P',
    input: '3 MS220-48LP',
    expect: { replacement: 'MS130-48P', qty: 3 }
  },
  {
    name: 'Multi-line license CSV (clean)',
    input: 'LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MS220-8P-3YR,2\nLIC-MS225-24P-3YR,5\nLIC-MS225-48FP-3YR,1\nLIC-MS250-48FP-3YR,6\nLIC-MS425-32-3YR,1\nLIC-MT-3Y,1',
    expect: { directLicense: true, itemCount: 8, firstQty: 26 }
  },
  {
    name: 'Multi-line license CSV (double-pasted with header)',
    input: 'LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MT-3Y,1\nSKU,Count\nLIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MT-3Y,1',
    expect: { directLicense: true, itemCount: 3, firstQty: 26 }
  },
  {
    name: 'Duplicate SKU consolidation in URL',
    input: 'url-test',
    customTest: () => {
      const url = buildStratusUrl([
        { sku: 'MS130-8P-HW', qty: 1 },
        { sku: 'LIC-MS130-CMPT-3Y', qty: 1 },
        { sku: 'MS130-8P-HW', qty: 1 },
        { sku: 'LIC-MS130-CMPT-3Y', qty: 1 }
      ]);
      const pass = url.includes('qty=2,2') && !url.includes('MS130-8P-HW,LIC-MS130-CMPT-3Y,MS130-8P-HW');
      return { pass, actual: url };
    }
  },
  {
    name: 'Direct MS150 request (no dual uplink)',
    input: '1 MS150-48FP-4G',
    expect: { notEol: true }
  },
  {
    name: 'Mixed EOL + non-EOL',
    input: '2 MS220-24P, 3 MR44',
    expect: { eolCount: 1, resolvedCount: 1 }
  },
  {
    name: 'MX64 → MX67',
    input: '1 MX64',
    expect: { replacement: 'MX67' }
  },
  {
    name: 'MX100 → MX95 (official Meraki replacement)',
    input: '1 MX100',
    expect: { replacement: 'MX95' }
  },
  {
    name: 'MX80 → MX85',
    input: '1 MX80',
    expect: { replacement: 'MX85' }
  },
  {
    name: 'MS390-48UX → C9300-48UXM-M (MS390 now EOL)',
    input: '1 MS390-48UX',
    expect: { replacement: 'C9300-48UXM-M' }
  },
  {
    name: 'MG51 → MG52 (new EOL product)',
    input: '1 MG51',
    expect: { replacement: 'MG52' }
  },
  {
    name: 'MR70 → MR78 (new EOL product)',
    input: '1 MR70',
    expect: { replacement: 'MR78' }
  },
  {
    name: 'MS210-24P dual uplink → MS150',
    input: '1 MS210-24P',
    expect: { replacement: ['MS150-24P-4G', 'MS150-24P-4X'] }
  },
  {
    name: 'EOL dates loaded for MX64',
    customTest: () => {
      const EOL_DATES = catalog._EOL_DATES || {};
      const dates = EOL_DATES['MX64'];
      const pass = dates && dates.eos === '2022-07-26' && dates.eost === '2027-07-26';
      return { pass, actual: JSON.stringify(dates) };
    }
  },
  {
    name: 'EOL dates loaded for MS390-48UX',
    customTest: () => {
      const EOL_DATES = catalog._EOL_DATES || {};
      const dates = EOL_DATES['MS390-48UX'];
      const pass = dates && dates.eos === '2025-03-28' && dates.eost === '2032-03-28';
      return { pass, actual: JSON.stringify(dates) };
    }
  }
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
