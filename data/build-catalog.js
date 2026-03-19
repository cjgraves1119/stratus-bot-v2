/**
 * Auto-generates valid SKU catalog from prices.json
 * Run: node data/build-catalog.js
 * Output: data/auto-catalog.json
 *
 * This replaces the hand-maintained valid_skus.json with a catalog
 * derived directly from prices.json — single source of truth.
 */

const fs = require('fs');
const path = require('path');

const prices = JSON.parse(fs.readFileSync(path.join(__dirname, 'prices.json'))).prices;
const priceKeys = Object.keys(prices);

// Also keep EOL/mistake data from valid_skus.json (those are curated, not in prices)
const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'valid_skus.json')));

// ─── Strip hardware suffixes to get base SKU ────────────────────────────────
function stripSuffix(sku) {
  return sku
    .replace(/-HW-NA$/, '')
    .replace(/-HW-WW$/, '')
    .replace(/-HW-EU$/, '')
    .replace(/-HW-UK$/, '')
    .replace(/-HW-AU$/, '')
    .replace(/-HW$/, '')
    .replace(/-MR$/, '')
    .replace(/-RTG$/, '')
    .replace(/-RTG-RF$/, '')
    .replace(/-CFG-RF$/, '')
    .replace(/-CFG\+\+$/, '');
}

// ─── Build sets of valid base SKUs by family ────────────────────────────────
const catalog = {
  // Families with simple prefix matching
  MR: new Set(),
  MX: new Set(),
  MV: new Set(),
  MT: new Set(),
  MG: new Set(),
  Z: new Set(),
  GX: new Set(),
  // Switch families need full base SKU (e.g., MS130-24P)
  MS130: new Set(),
  MS150: new Set(),
  MS390: new Set(),
  MS450: new Set(),
  // Legacy switch families (EOL but still in prices for renewals)
  MS120: new Set(),
  MS125: new Set(),
  MS210: new Set(),
  MS225: new Set(),
  MS250: new Set(),
  MS350: new Set(),
  MS425: new Set(),
  // CW families
  CW: new Set(),
  // Catalyst
  C9200L: new Set(),
  C9300: new Set(),
  C9300L: new Set(),
  C9300X: new Set(),
};

// Special SKUs that don't fit a family pattern (accessories, controllers, etc.)
const passthrough = new Set();

for (const rawSku of priceKeys) {
  // Skip licenses, accessories (MA-), and non-hardware categories
  if (rawSku.startsWith('LIC-') || rawSku.startsWith('MA-') ||
      rawSku.startsWith('BOUND-') || rawSku.startsWith('XCAT-') ||
      rawSku.startsWith('MSP-') || rawSku.startsWith('WPA-') ||
      rawSku.startsWith('COG-') || rawSku.startsWith('STACK-') ||
      rawSku.startsWith('PWR-') || rawSku.startsWith('CAB-') ||
      rawSku.startsWith('GA-') || rawSku.startsWith('FAN-') ||
      rawSku.startsWith('IM-') || rawSku.startsWith('OAD-') ||
      rawSku.startsWith('B-') || rawSku.startsWith('4PT-')) {
    continue;
  }

  const base = stripSuffix(rawSku);

  // CW accessories/mounts/antennas/injectors — passthrough, no license needed
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(base) || base === 'CW9800H1-MCG') {
    passthrough.add(base);
    continue;
  }

  // Route to correct family
  let matched = false;

  // AP families
  if (/^MR\d/.test(base)) { catalog.MR.add(base); matched = true; }
  else if (/^MX\d/.test(base)) { catalog.MX.add(base); matched = true; }
  else if (/^MV\d/.test(base)) { catalog.MV.add(base); matched = true; }
  else if (/^MT\d/.test(base)) { catalog.MT.add(base); matched = true; }
  else if (/^MG\d/.test(base)) { catalog.MG.add(base); matched = true; }
  else if (/^Z\d/.test(base)) { catalog.Z.add(base); matched = true; }
  else if (/^GX\d/.test(base)) { catalog.GX.add(base); matched = true; }
  // Switch families (order matters — more specific first)
  else if (/^MS130R?-/.test(base)) { catalog.MS130.add(base); matched = true; }
  else if (/^MS150-/.test(base)) { catalog.MS150.add(base); matched = true; }
  else if (/^MS390-/.test(base)) { catalog.MS390.add(base); matched = true; }
  else if (/^MS450-/.test(base)) { catalog.MS450.add(base); matched = true; }
  else if (/^MS120-/.test(base)) { catalog.MS120.add(base); matched = true; }
  else if (/^MS125-/.test(base)) { catalog.MS125.add(base); matched = true; }
  else if (/^MS210-/.test(base)) { catalog.MS210.add(base); matched = true; }
  else if (/^MS225-/.test(base)) { catalog.MS225.add(base); matched = true; }
  else if (/^MS250-/.test(base)) { catalog.MS250.add(base); matched = true; }
  else if (/^MS350-/.test(base)) { catalog.MS350.add(base); matched = true; }
  else if (/^MS425-/.test(base)) { catalog.MS425.add(base); matched = true; }
  // CW
  else if (/^CW9/.test(base)) { catalog.CW.add(base); matched = true; }
  // Catalyst
  else if (/^C9300X-/.test(base)) { catalog.C9300X.add(base); matched = true; }
  else if (/^C9300L-/.test(base)) { catalog.C9300L.add(base); matched = true; }
  else if (/^C9300-/.test(base)) { catalog.C9300.add(base); matched = true; }
  else if (/^C9200L-/.test(base)) { catalog.C9200L.add(base); matched = true; }

  if (!matched) {
    passthrough.add(base);
  }
}

// ─── Build output ───────────────────────────────────────────────────────────
const output = {
  _generated: new Date().toISOString(),
  _source: 'prices.json',
  _description: 'Auto-generated valid SKU catalog. Do not edit manually — run build-catalog.js instead.',
  _EOL_PRODUCTS: legacy._EOL_PRODUCTS || {},
  _EOL_REPLACEMENTS: legacy._EOL_REPLACEMENTS || {},
  _COMMON_MISTAKES: legacy._COMMON_MISTAKES || {},
  _PASSTHROUGH: [...passthrough].sort(),
};

// Convert sets to sorted arrays
for (const [family, skuSet] of Object.entries(catalog)) {
  output[family] = [...skuSet].sort();
}

fs.writeFileSync(
  path.join(__dirname, 'auto-catalog.json'),
  JSON.stringify(output, null, 2)
);

// Summary
console.log('Auto-catalog generated:');
let total = 0;
for (const [family, skuSet] of Object.entries(catalog)) {
  if (skuSet.size > 0) {
    console.log(`  ${family}: ${skuSet.size} SKUs → ${[...skuSet].join(', ')}`);
    total += skuSet.size;
  }
}
console.log(`  PASSTHROUGH: ${passthrough.size} → ${[...passthrough].join(', ')}`);
total += passthrough.size;
console.log(`\nTotal: ${total} valid base SKUs`);
console.log(`EOL products: ${Object.keys(output._EOL_PRODUCTS).length} families`);
console.log(`Common mistakes: ${Object.keys(output._COMMON_MISTAKES).length} entries`);
