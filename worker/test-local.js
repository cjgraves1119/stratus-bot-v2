// Local test harness for deterministic quoting engine
// Run: node test-local.js
//
// IMPORTANT: This file must stay in sync with worker/src/index.js.
// A sync check runs automatically before tests — if functions diverge,
// the suite fails immediately with clear instructions.

const fs = require('fs');
const crypto = require('crypto');

// Import the catalog data
const catalog = require('./src/data/auto-catalog.json');
const VALID_SKUS = catalog.validSkus || {};
const SKU_FAMILIES = catalog.skuFamilies || {};
const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const EOL_PRODUCTS = catalog._EOL_PRODUCTS || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};
const PRICES = catalog.prices || {};

// Load prices.json for getLicenseSkus validation wrapper (mirrors the `prices` Proxy in index.js)
const _pricesJson = require('./src/data/prices.json');
const prices = _pricesJson.prices || {};

// ─── Real parseMessage loader (CJS shim of src/index.js) ─────────────────────
// Rationale: testParseItems() below is a simplified mini-parser that does NOT
// exercise the real parseMessage(). Every parser bug fixed in recent sessions
// (preamble strip, qty-term collision, unicode ×, X-greedy absorption,
// requestedTerm detection) lives in the real parseMessage and would pass
// silently in the mini-parser. This shim transforms the ES-module worker
// source into a CJS module so Node can require() it directly.
function buildParserShim() {
  const path = require('path');
  const os = require('os');
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');

  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);

  // Strip `export default { ... };` (the Worker handler) — its fetch/scheduled
  // bodies pull in classes/globals that don't exist under plain Node.
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }

  src += '\nmodule.exports = { parseMessage, buildStratusUrl: typeof buildStratusUrl !== "undefined" ? buildStratusUrl : null, getLicenseSkus: typeof getLicenseSkus !== "undefined" ? getLicenseSkus : null, validateSku: typeof validateSku !== "undefined" ? validateSku : null, applySuffix: typeof applySuffix !== "undefined" ? applySuffix : null, buildQuoteFromV2: typeof buildQuoteFromV2 !== "undefined" ? buildQuoteFromV2 : null, applyV2Revision: typeof applyV2Revision !== "undefined" ? applyV2Revision : null, extractPriorFromAssistantUrl: typeof extractPriorFromAssistantUrl !== "undefined" ? extractPriorFromAssistantUrl : null };\n';

  // Include Date.now() alongside pid so a stale file from a prior run
  // (common in containerized sandboxes that reuse pid 3, etc.) can't
  // block the write with EACCES. Fresh path per test invocation.
  const shimPath = path.join(os.tmpdir(), `stratus-parser-shim-${process.pid}-${Date.now()}.cjs`);
  fs.writeFileSync(shimPath, src);
  return require(shimPath);
}

let _realParseMessage = null;
let _realBuildQuoteFromV2 = null;
let _realApplyV2Revision = null;
let _realExtractPriorFromAssistantUrl = null;
try {
  const shim = buildParserShim();
  _realParseMessage = shim.parseMessage;
  _realBuildQuoteFromV2 = shim.buildQuoteFromV2;
  _realApplyV2Revision = shim.applyV2Revision;
  _realExtractPriorFromAssistantUrl = shim.extractPriorFromAssistantUrl;
} catch (e) {
  console.warn(`⚠️  Could not build parseMessage shim: ${e.message}`);
  console.warn('   Parser integration tests will be skipped.');
}

// ─── Sync Verification ──────────────────────────────────────────────────────
// Extracts a function body from source code and returns a normalized hash.
// This catches drift between test-local.js and index.js.
function extractFunctionBody(source, funcName) {
  // Match "function funcName(" and capture everything until balanced braces close
  const startPattern = new RegExp(`function ${funcName}\\s*\\(`);
  const match = startPattern.exec(source);
  if (!match) return null;

  let depth = 0;
  let started = false;
  let bodyStart = match.index;
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) {
      // Normalize: strip whitespace and comments for comparison
      const body = source.slice(bodyStart, i + 1)
        .replace(/\/\/.*$/gm, '')     // strip line comments
        .replace(/\/\*[\s\S]*?\*\//g, '') // strip block comments
        .replace(/\s+/g, ' ')         // normalize whitespace
        .trim();
      return crypto.createHash('md5').update(body).digest('hex');
    }
  }
  return null;
}

// Functions that MUST stay in sync between test-local.js and index.js
const SYNC_FUNCTIONS = [
  'applySuffix',
  'getLicenseSkus',
  'checkEol',
  'isEol',
  'buildStratusUrl',
  'handleEolDateRequest',
];

const indexSource = fs.readFileSync('./src/index.js', 'utf-8');
const testSource = fs.readFileSync('./test-local.js', 'utf-8');

let syncErrors = 0;
console.log('─── Sync Check: test-local.js vs index.js ───');
for (const fn of SYNC_FUNCTIONS) {
  const indexHash = extractFunctionBody(indexSource, fn);
  const testHash = extractFunctionBody(testSource, fn);
  if (!indexHash) {
    console.log(`  ⚠️  ${fn}: not found in index.js (skipping)`);
    continue;
  }
  if (!testHash) {
    console.log(`  ⚠️  ${fn}: not found in test-local.js (skipping)`);
    continue;
  }
  if (indexHash !== testHash) {
    console.log(`  ❌ ${fn}: OUT OF SYNC — test copy differs from index.js`);
    syncErrors++;
  } else {
    console.log(`  ✅ ${fn}: in sync`);
  }
}

if (syncErrors > 0) {
  console.log(`\n🚨 ${syncErrors} function(s) out of sync! Tests are using stale code.`);
  console.log('   Copy the updated function(s) from src/index.js into test-local.js,');
  console.log('   or run: node sync-test-functions.js');
  process.exit(1);
}
console.log('  All synced ✅\n');

// ─── Core functions (must match index.js — see sync check above) ────────────

function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;  // CW9179F has no -RTG suffix
  // CW Wi-Fi 7 (917x): add -RTG suffix on recognized stems only.
  // Valid letter variants: I (internal), H (hospitality), D (directional).
  // Typos like CW9172L fall through unchanged so downstream lookup fails cleanly.
  if (/^CW917\d/.test(upper)) {
    let cwBase = upper;
    // Bare stem (e.g. "CW9172") → auto-promote to I variant (CW9172I)
    if (/^CW917\dI?$/.test(cwBase) && !cwBase.endsWith('I')) cwBase = `${cwBase}I`;
    // Only recognized letter variants get -RTG; anything else returns unchanged.
    if (!/^CW917\d[IHD]/.test(cwBase)) return upper;
    return cwBase.endsWith('-RTG') ? cwBase : `${cwBase}-RTG`;
  }
  // CW Wi-Fi 6E (916x): auto-append I for standard internal-antenna model, add -MR suffix
  if (/^CW916\d/.test(upper)) {
    let cwBase = upper;
    // CW9162→CW9162I, CW9164→CW9164I, CW9166→CW9166I (but not CW9163E, CW9166D1, etc.)
    if (/^CW916\dI?$/.test(cwBase) && !cwBase.endsWith('I')) cwBase = `${cwBase}I`;
    return cwBase.endsWith('-MR') ? cwBase : `${cwBase}-MR`;
  }
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (/^MS\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

function getLicenseSkus(baseSku, requestedTier) {
  const raw = _getLicenseSkusRaw(baseSku, requestedTier);
  if (!raw || raw.length === 0) return null;

  // Validate every generated license SKU exists in prices.json.
  // Regex-based generation can produce fictitious SKUs for invalid models
  // (e.g. MX44 → LIC-MX44-SEC-3YR which doesn't exist).
  const validated = raw.filter(entry => entry.sku in prices);
  if (validated.length === 0) {
    console.warn(`[LICENSE] All generated SKUs invalid for ${baseSku}: ${raw.map(e => e.sku).join(', ')}`);
    return null;
  }
  if (validated.length < raw.length) {
    const dropped = raw.filter(e => !(e.sku in prices)).map(e => e.sku);
    console.warn(`[LICENSE] Dropped invalid SKUs for ${baseSku}: ${dropped.join(', ')}`);
  }
  return validated;
}

function _getLicenseSkusRaw(baseSku, requestedTier) {
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
    const model = mgMatch[1];
    return [
      { term: '1Y', sku: `LIC-MG${model}-ENT-1Y` },
      { term: '3Y', sku: `LIC-MG${model}-ENT-3Y` },
      { term: '5Y', sku: `LIC-MG${model}-ENT-5Y` }
    ];
  }

  // MS130R (compact) — uses LIC-MS130-CMPT
  if (/^MS130R-/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130-8P, MS130-12P (small form factor) — uses LIC-MS130-CMPT
  if (/^MS130-(8|12)/.test(upper)) {
    return [
      { term: '1Y', sku: 'LIC-MS130-CMPT-1Y' },
      { term: '3Y', sku: 'LIC-MS130-CMPT-3Y' },
      { term: '5Y', sku: 'LIC-MS130-CMPT-5Y' }
    ];
  }

  // MS130-24/48 — uses LIC-MS130-{portCount}
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [
      { term: '1Y', sku: `LIC-MS130-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS130-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS130-${ports}-5Y` }
    ];
  }

  // MS150 — uses LIC-MS150-{portCount}
  const ms150Match = upper.match(/^MS150-(24|48)/);
  if (ms150Match) {
    const ports = ms150Match[1];
    return [
      { term: '1Y', sku: `LIC-MS150-${ports}-1Y` },
      { term: '3Y', sku: `LIC-MS150-${ports}-3Y` },
      { term: '5Y', sku: `LIC-MS150-${ports}-5Y` }
    ];
  }

  // MS125: Uses -Y suffix — LIC-MS125-{variant}-{1Y|3Y|5Y}
  const ms125Match = upper.match(/^MS125-(.+)/);
  if (ms125Match) {
    const variant = ms125Match[1];
    return [
      { term: '1Y', sku: `LIC-MS125-${variant}-1Y` },
      { term: '3Y', sku: `LIC-MS125-${variant}-3Y` },
      { term: '5Y', sku: `LIC-MS125-${variant}-5Y` }
    ];
  }

  // MS390: Uses {portCount}{A|E}-{term}Y format
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

  // Legacy MS switches (MS210, MS220, MS225, MS250, MS350, MS410, MS425) — LIC-{model}-{port}-{term}YR
  const legacyMsMatch = upper.match(/^(MS\d{3})-(.+)/);
  if (legacyMsMatch && !upper.startsWith('MS130') && !upper.startsWith('MS150')) {
    const model = legacyMsMatch[1];
    let port = legacyMsMatch[2];
    if (model === 'MS350' && port === '48X') port = '48';
    return [
      { term: '1Y', sku: `LIC-${model}-${port}-1YR` },
      { term: '3Y', sku: `LIC-${model}-${port}-3YR` },
      { term: '5Y', sku: `LIC-${model}-${port}-5YR` }
    ];
  }

  // Catalyst M-series: C9200L, C9300, C9350
  const catMatch = upper.match(/^(C9\d{3}[LX]?)-(\d+)/);
  if (catMatch) {
    let family = catMatch[1];
    let portCount = catMatch[2];
    const tier = (requestedTier === 'A') ? 'A' : 'E';
    if (family === 'C9300X' || family === 'C9300L') family = 'C9300';
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

  return null;
}

// ─── EOL Date Lookup (mirrors index.js) ──────────────────────────────────────
const EOL_DATES_DATA = catalog._EOL_DATES || {};
const EOL_DATES = EOL_DATES_DATA; // alias used by synced handleEolDateRequest from index.js

function handleEolDateRequest(text) {
  const upper = text.toUpperCase();

  // Detect EOL date intent
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(text);
  if (!eolIntent) return null;

  // Extract SKU-like tokens from the message
  const skuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/gi;
  const matches = [...upper.matchAll(skuPattern)].map(m => m[1]);

  // Deduplicate
  const skus = [...new Set(matches)];
  if (skus.length === 0) return null;

  const lines = [];

  for (const sku of skus) {
    const skuUpper = sku.toUpperCase();

    // Check if EOL
    let isEolProduct = false;
    let fullSkuKey = skuUpper;

    // Direct date lookup first
    if (EOL_DATES[skuUpper]) {
      isEolProduct = true;
    } else {
      // Try family + variant lookup
      for (const [family, variants] of Object.entries(EOL_PRODUCTS)) {
        if (skuUpper.startsWith(family)) {
          const raw = skuUpper.slice(family.length);
          const variant = raw.startsWith('-') ? raw.slice(1) : raw;
          if (variants.includes(variant)) {
            isEolProduct = true;
            fullSkuKey = skuUpper;
            break;
          }
        }
      }
    }

    if (!isEolProduct) {
      lines.push(`**${skuUpper}** — ✅ Active product (not end-of-life)`);
      continue;
    }

    const dates = EOL_DATES[fullSkuKey];
    const replacement = EOL_REPLACEMENTS[fullSkuKey];

    let line = `**${skuUpper}**`;
    if (dates) {
      const eosDate = new Date(dates.eos);
      const eostDate = new Date(dates.eost);
      const now = new Date();
      const eosLabel = eosDate <= now ? 'End of Sale' : 'End of Sale';
      const eostLabel = eostDate <= now ? 'End of Support (passed)' : 'End of Support';
      line += `\n  📅 ${eosLabel}: **${dates.eos}**`;
      line += `\n  🛡️ ${eostLabel}: **${dates.eost}**`;

      // Days until/since EOST
      const daysToEost = Math.round((eostDate - now) / (1000 * 60 * 60 * 24));
      if (daysToEost > 0) {
        line += ` _(${daysToEost} days remaining)_`;
      } else {
        line += ` _(${Math.abs(daysToEost)} days ago)_`;
      }
    } else {
      line += '\n  📅 EOL confirmed (exact dates not available)';
    }

    if (replacement) {
      if (Array.isArray(replacement)) {
        line += `\n  🔄 Replacement: **${replacement[0]}** (1G) or **${replacement[1]}** (10G)`;
      } else {
        line += `\n  🔄 Replacement: **${replacement}**`;
      }
    }

    lines.push(line);
  }

  if (lines.length === 0) return null;

  const header = skus.length === 1 ? '**End-of-Life Status**' : `**End-of-Life Status (${skus.length} products)**`;
  return `${header}\n\n${lines.join('\n\n')}`;
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
  // Consolidate duplicate SKUs by summing quantities
  const merged = new Map();
  for (const { sku, qty } of items) {
    merged.set(sku, (merged.get(sku) || 0) + qty);
  }

  // Preserve insertion order (= request order). Hardware is pushed before its
  // license in every call site, so each device's HW+LIC stay grouped naturally.
  const orderedSkus = [...merged.keys()];
  const qtys = orderedSkus.map(s => merged.get(s));
  return `https://stratusinfosystems.com/order/?item=${orderedSkus.join(',')}&qty=${qtys.join(',')}`;
}

// ─── Prices lookup helper ────────────────────────────────────────────────────
const pricesData = require('./src/data/prices.json');
const priceMap = pricesData.prices || {};
function priceExists(sku) { return sku in priceMap; }

// ─── Accessory Resolver Functions (Phase 2 tests) ────────────────────────────
const accessoriesData = require('./src/data/accessories.json');
const portProfiles = accessoriesData.port_profiles;
const sfpModules = accessoriesData.sfp_modules;
const stackingDataTest = accessoriesData.stacking;
const uplinkModulesTest = accessoriesData.uplink_modules;

function getPortProfile(deviceModel) {
  const upper = deviceModel.toUpperCase().replace(/-HW(-NA)?$/, '').replace(/-MR$/, '').replace(/-RTG$/, '');
  for (const [family, models] of Object.entries(portProfiles)) {
    if (models[upper]) return { profile: models[upper], family, model: upper };
    if (models[upper + '-M']) return { profile: models[upper + '-M'], family, model: upper + '-M' };
    const noM = upper.replace(/-M$/, '');
    if (models[noM]) return { profile: models[noM], family, model: noM };
  }
  return null;
}

function getDeviceUplinkPorts(profileData) {
  if (!profileData) return [];
  const { profile, family } = profileData;
  if (profile.uplinks === 'modular') {
    const mods = uplinkModulesTest[family];
    if (!mods) return [];
    return mods.modules.map(m => ({ speed: m.speed, form: m.type, count: m.ports, sku: m.sku, modular: true, recommended: m.recommended || false }));
  }
  const ports = [];
  if (profile.sfp_uplinks) for (const p of profile.sfp_uplinks) ports.push({ speed: p.speed, form: p.form, count: p.count });
  if (profile.uplinks && Array.isArray(profile.uplinks)) for (const p of profile.uplinks) ports.push({ speed: p.speed, form: p.form, count: p.count });
  if (profile.sfp_lan) for (const p of profile.sfp_lan) ports.push({ speed: p.speed, form: p.form, count: p.count, isLan: true });
  return ports;
}

function findCommonSpeed(portsA, portsB) {
  const speedRank = { '100G': 5, '40G': 4, '25G': 3, '10G': 2, '1G': 1 };
  const speedsA = new Set(portsA.map(p => p.speed));
  const speedsB = new Set(portsB.map(p => p.speed));
  const expandedA = new Set(speedsA);
  const expandedB = new Set(speedsB);
  if (speedsA.has('25G')) { expandedA.add('10G'); expandedA.add('1G'); }
  if (speedsA.has('10G')) expandedA.add('1G');
  if (speedsB.has('25G')) { expandedB.add('10G'); expandedB.add('1G'); }
  if (speedsB.has('10G')) expandedB.add('1G');
  let bestSpeed = null;
  let bestRank = 0;
  for (const speed of expandedA) {
    if (expandedB.has(speed) && (speedRank[speed] || 0) > bestRank) {
      bestSpeed = speed;
      bestRank = speedRank[speed];
    }
  }
  return bestSpeed;
}

function getCompatibleSfps(speed, deviceFamilies) {
  const speedCategories = { '1G': '1G_SFP', '10G': ['10G_SFP+', '10G_DAC'], '25G': '25G_SFP28', '40G': '40G_QSFP', '100G': '100G_QSFP28' };
  const cats = speedCategories[speed];
  if (!cats) return [];
  const categoryList = Array.isArray(cats) ? cats : [cats];
  const results = [];
  for (const cat of categoryList) {
    const modules = sfpModules[cat] || [];
    for (const mod of modules) {
      const isIncompat = mod.incompatible_with.some(f => deviceFamilies.includes(f));
      if (!isIncompat) results.push({ ...mod, category: cat });
    }
  }
  return results;
}

function getStackingSuggestion(baseSku, qty) {
  if (qty < 2) return null;
  const profile = getPortProfile(baseSku);
  if (!profile || !profile.profile.stackable) return null;
  const stackType = profile.profile.stack_type;
  if (!stackType) return null;
  const stackFamily = stackingDataTest.families[stackType];
  if (!stackFamily) return null;
  const defaultCable = Object.entries(stackFamily.cables).find(([_, v]) => v.use_case && v.use_case.includes('default'));
  const cableSku = defaultCable ? defaultCable[0] : Object.keys(stackFamily.cables)[1];
  const cableQty = qty;
  const result = { stackType, bandwidth: stackFamily.bandwidth, cableSku, cableQty };
  if (stackFamily.requires_kit) { result.kitSku = stackFamily.requires_kit; result.kitQty = qty; }
  return result;
}

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

  // CW Wi-Fi 7 auto-I promotion for bare stems (2026-04-24 forensic — CW9172l typo fix)
  ...[
    ['CW9172', 'CW9172I-RTG'],  // bare stem auto-promotes to I variant
    ['CW9171', 'CW9171I-RTG'],
    ['CW9174', 'CW9174I-RTG'],
    ['CW9176', 'CW9176I-RTG'],
    ['CW9178', 'CW9178I-RTG'],
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} (bare) → ${expected} (auto-I promote)`,
    customTest: () => ({ pass: applySuffix(input) === expected, actual: applySuffix(input) })
  })),

  // CW Wi-Fi 7 typo guards — invalid letter variants fall through unchanged
  // so downstream catalog lookup fails cleanly instead of fabricating a fake -RTG SKU.
  // Reproduces the CW9172l (lowercase L typo for I) Braun Intertec incident.
  ...[
    ['CW9172L', 'CW9172L'],    // L is not a recognized variant
    ['CW9172l', 'CW9172L'],    // lowercase l — uppers to CW9172L, still invalid
    ['CW9172O', 'CW9172O'],    // O typo for 0 or I
    ['CW9172Q', 'CW9172Q'],    // arbitrary invalid letter
    ['CW91720', 'CW91720'],    // trailing 0, no letter variant
  ].map(([input, expected]) => ({
    name: `[SUFFIX] ${input} → ${expected} (invalid variant, unchanged)`,
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

  // MS150 → no suffix (ends in 4G/4X like C9200/C9300 Catalyst switches)
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

  // MS450 → legacy -YR format (Meraki licensing)
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
  { name: '[PARSE] Multi-line license qty-first format (2 x LIC-ENT-1YR)',
    input: '2 x LIC-ENT-1YR\n1 x LIC-MS225-48FP-1YR\n1 x LIC-MX100-ENT-1YR',
    expect: { directLicense: true, itemCount: 3, firstQty: 2 }
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

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY 9: handleEolDateRequest() — EOL date lookup (~20 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // Single product EOL queries
  { name: '[EOL-LOOKUP] "when does MX64 go end of support"',
    customTest: () => {
      const r = handleEolDateRequest('when does MX64 go end of support');
      const pass = r && r.includes('MX64') && r.includes('2022-07-26') && r.includes('2027-07-26') && r.includes('MX67');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] "EOL date for MS220-24P"',
    customTest: () => {
      const r = handleEolDateRequest('EOL date for MS220-24P');
      const pass = r && r.includes('MS220-24P') && r.includes('MS130-24P');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] "end of life MS390-48UX"',
    customTest: () => {
      const r = handleEolDateRequest('end of life MS390-48UX');
      const pass = r && r.includes('MS390-48UX') && r.includes('2025-03-28') && r.includes('C9300-48UXM-M');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] "EOS for MR42"',
    customTest: () => {
      const r = handleEolDateRequest('EOS for MR42');
      const pass = r && r.includes('MR42') && r.includes('MR44');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },

  // Batch EOL queries
  { name: '[EOL-LOOKUP] batch: "end of support for MX64, MS220-24P, MS390-48UX"',
    customTest: () => {
      const r = handleEolDateRequest('end of support for MX64, MS220-24P, MS390-48UX');
      const pass = r && r.includes('3 products') && r.includes('MX64') && r.includes('MS220-24P') && r.includes('MS390-48UX');
      return { pass, actual: r ? `len=${r.length}, has3=${r.includes('3 products')}` : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] batch: "EOL MR42 MR72 MG51"',
    customTest: () => {
      const r = handleEolDateRequest('EOL MR42 MR72 MG51');
      const pass = r && r.includes('3 products') && r.includes('MR44') && r.includes('MR86') && r.includes('MG52');
      return { pass, actual: r ? `has_replacements=${r.includes('MR44') && r.includes('MR86') && r.includes('MG52')}` : 'null' };
    }
  },

  // Active product (not EOL)
  { name: '[EOL-LOOKUP] active product: "EOL MR44"',
    customTest: () => {
      const r = handleEolDateRequest('EOL MR44');
      const pass = r && r.includes('Active product');
      return { pass, actual: r ? r.substring(0, 80) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] active product: "end of support MX67"',
    customTest: () => {
      const r = handleEolDateRequest('end of support MX67');
      const pass = r && r.includes('Active product');
      return { pass, actual: r ? r.substring(0, 80) : 'null' };
    }
  },

  // Mixed EOL + active
  { name: '[EOL-LOOKUP] mixed: "EOL for MX64, MR44"',
    customTest: () => {
      const r = handleEolDateRequest('EOL for MX64, MR44');
      const pass = r && r.includes('2 products') && r.includes('2027-07-26') && r.includes('Active product');
      return { pass, actual: r ? `len=${r.length}` : 'null' };
    }
  },

  // Dual uplink replacement shows 1G/10G
  { name: '[EOL-LOOKUP] dual uplink: "end of support MS210-24P"',
    customTest: () => {
      const r = handleEolDateRequest('end of support MS210-24P');
      const pass = r && r.includes('MS150-24P-4G') && r.includes('MS150-24P-4X') && r.includes('1G') && r.includes('10G');
      return { pass, actual: r ? r.substring(0, 150) : 'null' };
    }
  },

  // No intent → returns null
  { name: '[EOL-LOOKUP] no intent: "quote 10 MR44" → null',
    customTest: () => {
      const r = handleEolDateRequest('quote 10 MR44');
      return { pass: r === null, actual: r === null ? 'null (correct)' : r.substring(0, 50) };
    }
  },
  { name: '[EOL-LOOKUP] no intent: "cost of MX64" → null',
    customTest: () => {
      const r = handleEolDateRequest('cost of MX64');
      return { pass: r === null, actual: r === null ? 'null (correct)' : r.substring(0, 50) };
    }
  },

  // No SKU in message → null
  { name: '[EOL-LOOKUP] no SKU: "when does it go end of life" → null',
    customTest: () => {
      const r = handleEolDateRequest('when does it go end of life');
      return { pass: r === null, actual: r === null ? 'null (correct)' : r.substring(0, 50) };
    }
  },

  // Various phrasing variations
  { name: '[EOL-LOOKUP] "is MX80 discontinued"',
    customTest: () => {
      const r = handleEolDateRequest('is MX80 discontinued');
      return { pass: r === null, actual: r === null ? 'null (no EOL keyword match)' : r.substring(0, 80) };
    }
  },
  { name: '[EOL-LOOKUP] "when was MX80 end of sale"',
    customTest: () => {
      const r = handleEolDateRequest('when was MX80 end of sale');
      const pass = r && r.includes('MX80') && r.includes('MX85');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] "lifecycle MR72"',
    customTest: () => {
      const r = handleEolDateRequest('lifecycle MR72');
      const pass = r && r.includes('MR72') && r.includes('MR86');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },
  { name: '[EOL-LOOKUP] "last day of support for Z1"',
    customTest: () => {
      const r = handleEolDateRequest('last day of support for Z1');
      const pass = r && r.includes('Z1') && r.includes('Z4');
      return { pass, actual: r ? r.substring(0, 120) : 'null' };
    }
  },

  // Dedup: same SKU mentioned twice
  { name: '[EOL-LOOKUP] dedup: "EOL MX64 MX64" → single entry',
    customTest: () => {
      const r = handleEolDateRequest('EOL MX64 MX64');
      const pass = r && r.includes('End-of-Life Status') && !r.includes('2 products');
      return { pass, actual: r ? `single=${!r.includes('2 products')}` : 'null' };
    }
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY: Accessory Resolver Engine (Phase 2 tests)
  // ═══════════════════════════════════════════════════════════════════════════

  // Port profile lookups
  { name: '[ACCESSORIES] getPortProfile MX95 → has 10G SFP+ uplinks',
    customTest: () => {
      const p = getPortProfile('MX95');
      const pass = p && p.family === 'MX' && p.profile.sfp_uplinks.some(u => u.speed === '10G');
      return { pass, actual: p ? `family=${p.family}, uplinks=${JSON.stringify(p.profile.sfp_uplinks)}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getPortProfile C9300-48P → modular uplinks',
    customTest: () => {
      const p = getPortProfile('C9300-48P');
      const pass = p && p.family === 'C9300' && p.profile.uplinks === 'modular';
      return { pass, actual: p ? `family=${p.family}, uplinks=${p.profile.uplinks}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getPortProfile MS130-24P → 1G SFP uplinks, not stackable',
    customTest: () => {
      const p = getPortProfile('MS130-24P');
      const pass = p && p.family === 'MS130' && !p.profile.stackable && p.profile.uplinks.some(u => u.speed === '1G');
      return { pass, actual: p ? `stackable=${p.profile.stackable}, speed=${p.profile.uplinks[0].speed}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getPortProfile MS150-48FP-4X → 10G SFP+ uplinks, stackable',
    customTest: () => {
      const p = getPortProfile('MS150-48FP-4X');
      const pass = p && p.family === 'MS150' && p.profile.stackable && p.profile.uplinks.some(u => u.speed === '10G');
      return { pass, actual: p ? `stackable=${p.profile.stackable}, speed=${p.profile.uplinks[0].speed}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getPortProfile MX67 → no SFP ports (RJ45 only)',
    customTest: () => {
      const p = getPortProfile('MX67');
      const ports = getDeviceUplinkPorts(p);
      const pass = p && ports.length === 0;
      return { pass, actual: p ? `ports=${ports.length}` : 'null' };
    }
  },

  // Speed matching
  { name: '[ACCESSORIES] findCommonSpeed: MX95 (10G) + MS150-4X (10G) → 10G',
    customTest: () => {
      const pA = getPortProfile('MX95');
      const pB = getPortProfile('MS150-48FP-4X');
      const portsA = getDeviceUplinkPorts(pA);
      const portsB = getDeviceUplinkPorts(pB);
      const speed = findCommonSpeed(portsA, portsB);
      return { pass: speed === '10G', actual: `speed=${speed}` };
    }
  },
  { name: '[ACCESSORIES] findCommonSpeed: MS130-24P (1G) + MX75 (1G+10G) → 1G',
    customTest: () => {
      const pA = getPortProfile('MS130-24P');
      const pB = getPortProfile('MX75');
      const portsA = getDeviceUplinkPorts(pA);
      const portsB = getDeviceUplinkPorts(pB);
      const speed = findCommonSpeed(portsA, portsB);
      return { pass: speed === '1G', actual: `speed=${speed}` };
    }
  },

  // SFP compatibility filtering
  { name: '[ACCESSORIES] getCompatibleSfps 1G: MA-SFP-1GB-TX excluded for C9300',
    customTest: () => {
      const sfps = getCompatibleSfps('1G', ['C9300']);
      const hasTX = sfps.some(s => s.sku === 'MA-SFP-1GB-TX');
      const hasSX = sfps.some(s => s.sku === 'MA-SFP-1GB-SX');
      return { pass: !hasTX && hasSX, actual: `TX=${hasTX}, SX=${hasSX}` };
    }
  },
  { name: '[ACCESSORIES] getCompatibleSfps 10G: MA-SFP-10GB-LRM excluded for C9300X',
    customTest: () => {
      const sfps = getCompatibleSfps('10G', ['C9300X']);
      const hasLRM = sfps.some(s => s.sku === 'MA-SFP-10GB-LRM');
      const hasSR = sfps.some(s => s.sku === 'MA-SFP-10GB-SR');
      return { pass: !hasLRM && hasSR, actual: `LRM=${hasLRM}, SR=${hasSR}` };
    }
  },
  { name: '[ACCESSORIES] getCompatibleSfps 10G generic: includes DAC cables',
    customTest: () => {
      const sfps = getCompatibleSfps('10G', ['MS150']);
      const hasDAC = sfps.some(s => s.type === 'DAC');
      const hasSFP = sfps.some(s => s.type === 'SFP+');
      return { pass: hasDAC && hasSFP, actual: `DAC=${hasDAC}, SFP+=${hasSFP}` };
    }
  },

  // Stacking suggestions
  { name: '[ACCESSORIES] getStackingSuggestion: 4x MS150-48FP-4X → 100G, 4 cables',
    customTest: () => {
      const s = getStackingSuggestion('MS150-48FP-4X', 4);
      const pass = s && s.stackType === '100G' && s.cableQty === 4 && s.cableSku.includes('100G');
      return { pass, actual: s ? `type=${s.stackType}, cables=${s.cableQty}x ${s.cableSku}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getStackingSuggestion: 3x C9300-48P → STACK-T1, 3 cables',
    customTest: () => {
      const s = getStackingSuggestion('C9300-48P', 3);
      const pass = s && s.stackType === 'STACK-T1' && s.cableQty === 3 && s.cableSku.includes('STACK-T1');
      return { pass, actual: s ? `type=${s.stackType}, cables=${s.cableQty}x ${s.cableSku}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getStackingSuggestion: C9300L needs kit module',
    customTest: () => {
      const s = getStackingSuggestion('C9300L-48P-4X', 2);
      const pass = s && s.kitSku === 'C9300L-STACK-KIT2-M' && s.kitQty === 2;
      return { pass, actual: s ? `kit=${s.kitSku}, kitQty=${s.kitQty}` : 'null' };
    }
  },
  { name: '[ACCESSORIES] getStackingSuggestion: MS130-24P → null (not stackable)',
    customTest: () => {
      const s = getStackingSuggestion('MS130-24P', 3);
      return { pass: s === null, actual: s ? JSON.stringify(s) : 'null (correct)' };
    }
  },
  { name: '[ACCESSORIES] getStackingSuggestion: qty=1 → null (need 2+ to stack)',
    customTest: () => {
      const s = getStackingSuggestion('MS150-48FP-4X', 1);
      return { pass: s === null, actual: s ? JSON.stringify(s) : 'null (correct)' };
    }
  },
  { name: '[ACCESSORIES] getStackingSuggestion: MS390 → 120G StackWise480',
    customTest: () => {
      const s = getStackingSuggestion('MS390-48UX', 2);
      const pass = s && s.stackType === '120G_StackWise480' && s.cableSku.includes('120G');
      return { pass, actual: s ? `type=${s.stackType}, cable=${s.cableSku}` : 'null' };
    }
  },

  // All accessory SKUs in prices.json validation
  { name: '[ACCESSORIES] all SFP SKUs exist in prices.json',
    customTest: () => {
      const missing = [];
      for (const [cat, mods] of Object.entries(sfpModules)) {
        for (const mod of mods) {
          if (!priceExists(mod.sku)) missing.push(mod.sku);
        }
      }
      return { pass: missing.length === 0, actual: missing.length > 0 ? `missing: ${missing.join(', ')}` : 'all present' };
    }
  },
  { name: '[ACCESSORIES] stacking cable SKUs exist in prices.json',
    customTest: () => {
      const missing = [];
      for (const [type, family] of Object.entries(stackingDataTest.families)) {
        for (const sku of Object.keys(family.cables)) {
          if (!priceExists(sku)) missing.push(sku);
        }
      }
      return { pass: missing.length === 0, actual: missing.length > 0 ? `missing: ${missing.join(', ')}` : 'all present' };
    }
  },
];

// ─── Fuzzy Match Functions (duplicated from index.js for testing) ────────────
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let curr = new Array(n + 1);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function fuzzyMatchInFamily(input, family) {
  const upper = input.toUpperCase();
  const variants = catalog[family];
  if (!variants || !Array.isArray(variants)) return [];
  return variants.map(v => ({ sku: v, distance: levenshtein(upper, v.toUpperCase()) }))
    .filter(c => c.distance <= 3 && c.distance > 0)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
}

function fuzzyMatchAllFamilies(input) {
  const upper = input.toUpperCase();
  const results = [];
  for (const [family, variants] of Object.entries(catalog)) {
    if (family.startsWith('_') || !Array.isArray(variants)) continue;
    for (const sku of variants) {
      const dist = levenshtein(upper, sku.toUpperCase());
      if (dist <= 2) results.push({ sku, distance: dist });
    }
  }
  return results.sort((a, b) => a.distance - b.distance).slice(0, 5);
}

// Build VALID_SKUS set for fuzzy test validation
const VALID_SKUS_SET = new Set();
for (const [family, variants] of Object.entries(catalog)) {
  if (family.startsWith('_')) continue;
  if (Array.isArray(variants)) variants.forEach(v => VALID_SKUS_SET.add(v.toUpperCase()));
}

function testFixCommonMistake(sku) {
  const upper = sku.toUpperCase();
  const exact = COMMON_MISTAKES[upper];
  if (exact && exact.suggest && exact.suggest.length > 0) {
    return { error: exact.error, suggest: exact.suggest };
  }
  for (const [key, val] of Object.entries(COMMON_MISTAKES)) {
    if (upper.startsWith(key + '-') && val.suggest && val.suggest.length > 0) {
      const suffix = upper.slice(key.length).toUpperCase();
      const appended = val.suggest.map(s => s + suffix).filter(s => VALID_SKUS_SET.has(s.toUpperCase()) || isEol(s));
      if (appended.length > 0) return { error: val.error, suggest: appended };
      const filtered = val.suggest.filter(s => s.toUpperCase().endsWith(suffix));
      if (filtered.length > 0) return { error: val.error, suggest: filtered };
      return { error: val.error, suggest: val.suggest };
    }
  }
  return null;
}

function testDetectFamily(sku) {
  if (/^MR\d/.test(sku)) return 'MR';
  if (/^MX\d/.test(sku)) return 'MX';
  if (/^MV\d/.test(sku)) return 'MV';
  if (/^MT\d/.test(sku)) return 'MT';
  if (/^MG\d/.test(sku)) return 'MG';
  if (/^Z\d/.test(sku)) return 'Z';
  if (/^MS130/.test(sku)) return 'MS130';
  if (/^MS150/.test(sku)) return 'MS150';
  if (/^MS120/.test(sku)) return 'MS120';
  if (/^MS125/.test(sku)) return 'MS125';
  if (/^MS210/.test(sku)) return 'MS210';
  if (/^MS220/.test(sku)) return 'MS220';
  if (/^MS225/.test(sku)) return 'MS225';
  if (/^MS250/.test(sku)) return 'MS250';
  if (/^MS320/.test(sku)) return 'MS320';
  if (/^MS350/.test(sku)) return 'MS350';
  if (/^MS355/.test(sku)) return 'MS355';
  if (/^MS390/.test(sku)) return 'MS390';
  if (/^MS410/.test(sku)) return 'MS410';
  if (/^MS420/.test(sku)) return 'MS420';
  if (/^MS425/.test(sku)) return 'MS425';
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

function testValidateSku(baseSku) {
  const upper = baseSku.toUpperCase();
  const mistake = testFixCommonMistake(upper);
  if (mistake) return { valid: false, reason: mistake.error, suggest: mistake.suggest };
  if (VALID_SKUS_SET.has(upper)) {
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }
  if (isEol(upper)) return { valid: true, eol: true };
  if (/^MA-/.test(upper)) return { valid: true };
  const family = testDetectFamily(upper);
  if (family && catalog[family]) {
    const partialMatches = catalog[family].filter(s => s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase()));
    if (partialMatches.length > 0) {
      return { valid: false, reason: `${upper} is not a recognized model`, suggest: partialMatches, isPartialMatch: true };
    }
    const fuzzyMatches = fuzzyMatchInFamily(upper, family);
    if (fuzzyMatches.length > 0) {
      return { valid: false, reason: `${upper} is not a recognized model`, suggest: fuzzyMatches.map(m => m.sku), isFuzzyMatch: true };
    }
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: catalog[family].slice(0, 5) };
  }
  const crossMatches = fuzzyMatchAllFamilies(upper);
  if (crossMatches.length > 0) {
    return { valid: false, reason: `${upper} is not a recognized SKU`, suggest: crossMatches.map(m => m.sku), isFuzzyMatch: true };
  }
  return { valid: false, reason: `${upper} is not a recognized SKU` };
}

// ─── Fuzzy Match Test Cases ─────────────────────────────────────────────────
const fuzzyTests = [
  { name: '[FUZZY] MS150-48P-4X → suggests MS150-48FP-4X or MS150-48LP-4X',
    customTest: () => {
      const result = testValidateSku('MS150-48P-4X');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      if (!result.suggest || result.suggest.length === 0) return { pass: false, actual: 'No suggestions' };
      const sugs = result.suggest.map(s => s.toUpperCase());
      const hasMatch = sugs.includes('MS150-48FP-4X') || sugs.includes('MS150-48LP-4X');
      return { pass: hasMatch, actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] MS150-48P-4G → suggests MS150-48FP-4G or MS150-48LP-4G',
    customTest: () => {
      const result = testValidateSku('MS150-48P-4G');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      const hasMatch = sugs.includes('MS150-48FP-4G') || sugs.includes('MS150-48LP-4G');
      return { pass: hasMatch, actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] MR43 → suggests MR44 (distance 1, not a real SKU)',
    customTest: () => {
      const result = testValidateSku('MR43');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('MR44'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] MX86 → suggests MX85',
    customTest: () => {
      const result = testValidateSku('MX86');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('MX85'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] CW9162E → suggests CW9162I',
    customTest: () => {
      const result = testValidateSku('CW9162E');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('CW9162I'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] MS390-48P-4G → suggests MS390-48UX',
    customTest: () => {
      const result = testValidateSku('MS390-48P-4G');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('MS390-48UX') || sugs.includes('MS390-48UX2'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] C9300-48P → suggests C9300-48P-M (missing -M)',
    customTest: () => {
      const result = testValidateSku('C9300-48P');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('C9300-48P-M'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] valid SKU MS150-48FP-4G → passes (no false positive)',
    customTest: () => {
      const result = testValidateSku('MS150-48FP-4G');
      return { pass: result.valid === true, actual: result.valid ? 'valid' : 'invalid: ' + result.reason };
    }
  },
  { name: '[FUZZY] valid SKU MR44 → passes (no false positive)',
    customTest: () => {
      const result = testValidateSku('MR44');
      return { pass: result.valid === true, actual: result.valid ? 'valid' : 'invalid: ' + result.reason };
    }
  },
  { name: '[FUZZY] MS130-48FP → suggests MS130-48P (exact common mistake)',
    customTest: () => {
      const result = testValidateSku('MS130-48FP');
      if (result.valid) return { pass: false, actual: 'Should be invalid' };
      const sugs = (result.suggest || []).map(s => s.toUpperCase());
      return { pass: sugs.includes('MS130-48P'), actual: sugs.join(', ') };
    }
  },
  { name: '[FUZZY] C9300L-48PF-4X → valid (existing SKU, no false rejection)',
    customTest: () => {
      const result = testValidateSku('C9300L-48PF-4X-M');
      return { pass: result.valid === true, actual: result.valid ? 'valid' : 'invalid: ' + result.reason };
    }
  },
  { name: '[FUZZY] MS250-48FP → valid EOL (no false rejection)',
    customTest: () => {
      const result = testValidateSku('MS250-48FP');
      return { pass: result.valid === true, actual: result.valid ? 'valid (eol: ' + result.eol + ')' : 'invalid: ' + result.reason };
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
      const qtyFirstMatch = !csvMatch && line.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      if (csvMatch) {
        licItems.push({ sku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else if (qtyFirstMatch) {
        licItems.push({ sku: qtyFirstMatch[2].toUpperCase(), qty: parseInt(qtyFirstMatch[1]) });
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
const allTests = [...tests, ...fuzzyTests];
let passed = 0;
let failed = 0;

for (const test of allTests) {
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

// ─── parseMessage integration tests (uses REAL parseMessage via CJS shim) ───
// These fixtures are the regression suite for the real parser. Every entry
// here corresponds to a bug that actually shipped to prod at some point.
// If you touch parseMessage in src/index.js, these must stay green.
if (_realParseMessage) {
  console.log('\n─── parseMessage integration tests (real src/index.js) ───');

  const parserFixtures = [
    // ═══════════════════════════════════════════════════════════════════════
    // Session regression fixtures — bugs fixed on 2026-04-20
    // ═══════════════════════════════════════════════════════════════════════
    {
      name: '[PARSER] lic-mv-1yr x 30 → qty=30 (preamble/trailer tolerance)',
      run: () => {
        const r = _realParseMessage('lic-mv-1yr x 30');
        return {
          pass: r?.directLicense?.sku === 'LIC-MV-1YR' && r?.directLicense?.qty === 30,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] LIC-MV-1YR × 30 (unicode ×) → qty=30',
      run: () => {
        const r = _realParseMessage('LIC-MV-1YR \u00D7 30');
        return {
          pass: r?.directLicense?.sku === 'LIC-MV-1YR' && r?.directLicense?.qty === 30,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] "pricing on LIC-MV-1YR x 30" → qty=30 (CF rewrite shape)',
      run: () => {
        const r = _realParseMessage('pricing on LIC-MV-1YR x 30');
        return {
          pass: r?.directLicense?.sku === 'LIC-MV-1YR' && r?.directLicense?.qty === 30,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] "quote me LIC-ENT-3YR x 50" → qty=50',
      run: () => {
        const r = _realParseMessage('quote me LIC-ENT-3YR x 50');
        return {
          pass: r?.directLicense?.sku === 'LIC-ENT-3YR' && r?.directLicense?.qty === 50,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] "LIC-MV-3YR qty 12" → qty=12',
      run: () => {
        const r = _realParseMessage('LIC-MV-3YR qty 12');
        return {
          pass: r?.directLicense?.sku === 'LIC-MV-3YR' && r?.directLicense?.qty === 12,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] "5 MR36 3 year" → qty=5, term=3 (not MR36x3)',
      run: () => {
        const r = _realParseMessage('5 MR36 3 year');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR36' && it?.qty === 5 && r?.requestedTerm === 3,
          actual: `items=${JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty })))} term=${r?.requestedTerm}`,
        };
      },
    },
    {
      name: '[PARSER] "10 MR44 5yr" → qty=10, term=5 (no qty-term collision)',
      run: () => {
        const r = _realParseMessage('10 MR44 5yr');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR44' && it?.qty === 10 && r?.requestedTerm === 5,
          actual: `items=${JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty })))} term=${r?.requestedTerm}`,
        };
      },
    },
    {
      name: '[PARSER] "MR36x10" → baseSku=MR36, qty=10 (not MR36X)',
      run: () => {
        const r = _realParseMessage('MR36x10');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR36' && it?.qty === 10,
          actual: JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty }))),
        };
      },
    },
    {
      name: '[PARSER] "quote 10 MR36 just 3yr" → requestedTerm=3',
      run: () => {
        const r = _realParseMessage('quote 10 MR36 just 3yr');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR36' && it?.qty === 10 && r?.requestedTerm === 3,
          actual: `items=${JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty })))} term=${r?.requestedTerm}`,
        };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // General parseMessage coverage — not session-specific but high-value
    // ═══════════════════════════════════════════════════════════════════════
    {
      name: '[PARSER] single "MR44" → qty=1',
      run: () => {
        const r = _realParseMessage('MR44');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR44' && it?.qty === 1,
          actual: JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty }))),
        };
      },
    },
    {
      name: '[PARSER] "2x MR57" → qty=2 (x-shorthand with space)',
      run: () => {
        const r = _realParseMessage('2x MR57');
        const it = r?.items?.[0];
        return {
          pass: it?.baseSku === 'MR57' && it?.qty === 2,
          actual: JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty }))),
        };
      },
    },
    {
      name: '[PARSER] mixed "5 MR46 and 2 MS225-24P" → two items',
      run: () => {
        const r = _realParseMessage('quote 5 MR46 and 2 MS225-24P');
        const skus = (r?.items || []).map(i => i.baseSku);
        const qtys = (r?.items || []).map(i => i.qty);
        return {
          pass: skus.includes('MR46') && skus.includes('MS225-24P') &&
                qtys.includes(5) && qtys.includes(2),
          actual: JSON.stringify(r?.items?.map(i => ({ sku: i.baseSku, qty: i.qty }))),
        };
      },
    },
    {
      name: '[PARSER] "LIC-ENT-3YR" bare → qty=1 directLicense',
      run: () => {
        const r = _realParseMessage('LIC-ENT-3YR');
        return {
          pass: r?.directLicense?.sku === 'LIC-ENT-3YR' && r?.directLicense?.qty === 1,
          actual: JSON.stringify(r?.directLicense ?? r?.items ?? null),
        };
      },
    },
    {
      name: '[PARSER] multi-line licenses CSV → directLicenseList',
      run: () => {
        const r = _realParseMessage('LIC-ENT-3YR,10\nLIC-MS225-24P-3YR,3');
        return {
          pass: Array.isArray(r?.directLicenseList) && r.directLicenseList.length === 2 &&
                r.directLicenseList[0].qty === 10 && r.directLicenseList[1].qty === 3,
          actual: JSON.stringify(r?.directLicenseList ?? null),
        };
      },
    },

    // ═══════════════════════════════════════════════════════════════════════
    // Wi-Fi category phrase detection (2026-04-20)
    // Bug: "MX75 with the Wifi 7 AP, and 3 years" produced a quote with only
    // MX75 — silently dropped the AP reference that Claude had previously
    // recommended as CW9172I. Fix: parseMessage now flags unresolved AP
    // category phrases in `unresolvedCategories` so buildQuoteResponse can
    // append an AP-choice clarify prompt alongside the quote.
    // ═══════════════════════════════════════════════════════════════════════
    {
      name: '[PARSER] "MX75 with the Wifi 7 AP, and 3 years" → MX75 + wifi-7 unresolved',
      run: () => {
        const r = _realParseMessage('MX75 with the Wifi 7 AP, and 3 years');
        const it = r?.items?.[0];
        const cat = r?.unresolvedCategories?.[0];
        return {
          pass: it?.baseSku === 'MX75' && r?.requestedTerm === 3 &&
                cat?.kind === 'ap' && cat?.generation === '7' && cat?.qty === 1,
          actual: `items=${JSON.stringify(r?.items)} term=${r?.requestedTerm} cats=${JSON.stringify(r?.unresolvedCategories)}`,
        };
      },
    },
    {
      name: '[PARSER] "MX75 and 5 wifi 6 aps" → MX75 + wifi-6 qty=5 unresolved',
      run: () => {
        const r = _realParseMessage('MX75 and 5 wifi 6 aps');
        const it = r?.items?.[0];
        const cat = r?.unresolvedCategories?.[0];
        return {
          pass: it?.baseSku === 'MX75' && cat?.generation === '6' && cat?.qty === 5,
          actual: `items=${JSON.stringify(r?.items?.map(i => i.baseSku))} cats=${JSON.stringify(r?.unresolvedCategories)}`,
        };
      },
    },
    {
      name: '[PARSER] "MX75 and 10 wi-fi 6e access points" → 6E qty=10 unresolved',
      run: () => {
        const r = _realParseMessage('MX75 and 10 wi-fi 6e access points');
        const cat = r?.unresolvedCategories?.[0];
        return {
          pass: cat?.generation === '6E' && cat?.qty === 10,
          actual: JSON.stringify(r?.unresolvedCategories),
        };
      },
    },
    {
      name: '[PARSER] "MX75 with CW9172I and 3 years" → no category (resolved by SKU)',
      run: () => {
        const r = _realParseMessage('MX75 with CW9172I and 3 years');
        const skus = (r?.items || []).map(i => i.baseSku);
        const cats = r?.unresolvedCategories || [];
        return {
          pass: skus.includes('MX75') && skus.includes('CW9172I') && cats.length === 0,
          actual: `items=${JSON.stringify(skus)} cats=${JSON.stringify(cats)}`,
        };
      },
    },
    {
      name: '[PARSER] bare "wifi 7 ap" → isClarification with wifi-7 prompt',
      run: () => {
        const r = _realParseMessage('wifi 7 ap');
        const cat = r?.unresolvedCategories?.[0];
        return {
          pass: r?.isClarification === true &&
                /CW9172I/.test(r?.clarificationMessage || '') &&
                cat?.generation === '7',
          actual: `isClarification=${r?.isClarification} msg="${(r?.clarificationMessage||'').substring(0,80)}" cat=${JSON.stringify(cat)}`,
        };
      },
    },
    {
      name: '[PARSER] bare "5 wifi 6 aps" → isClarification with wifi-6 qty=5',
      run: () => {
        const r = _realParseMessage('5 wifi 6 aps');
        const cat = r?.unresolvedCategories?.[0];
        return {
          pass: r?.isClarification === true && cat?.generation === '6' && cat?.qty === 5 &&
                /MR36/.test(r?.clarificationMessage || ''),
          actual: `isClarification=${r?.isClarification} cat=${JSON.stringify(cat)}`,
        };
      },
    },
  ];

  for (const t of parserFixtures) {
    process.stdout.write(`  ${t.name}... `);
    try {
      const res = t.run();
      if (res.pass) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log(`❌ FAIL — ${res.actual}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ THROW — ${e.message}`);
      failed++;
    }
  }
}

// ─── V2 Classifier adapter tests (PR 2) ─────────────────────────────────────
// buildQuoteFromV2 adapts the V2 rich schema into parseMessage-shape so the
// deterministic quote path can consume V2 output directly, preserving modifier
// and item fidelity that a parseMessage round-trip would lose.
// applyV2Revision mutates a prior parseMessage result based on a V2 revise
// classification (change_term, change_tier, toggle_hw_lic, change_qty,
// remove, add, swap).
if (_realBuildQuoteFromV2 && _realApplyV2Revision) {
  console.log('\n─── V2 adapter tests (buildQuoteFromV2 + applyV2Revision) ───');

  const v2Fixtures = [
    // ═══ buildQuoteFromV2 ═══
    {
      name: '[V2] quote 10 MR44 → items[MR44 qty=10], no term (all_terms default)',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [{ sku: 'MR44', qty: 10 }],
          modifiers: { show_pricing: false },
        };
        const r = _realBuildQuoteFromV2(v2, '10 MR44');
        return {
          pass: r && r.items?.length === 1 && r.items[0].baseSku === 'MR44' && r.items[0].qty === 10 && r.requestedTerm === null && r._fromV2 === true,
          actual: JSON.stringify(r),
        };
      },
    },
    {
      name: '[V2] quote 10 MR44 3yr → requestedTerm=3',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [{ sku: 'MR44', qty: 10 }],
          modifiers: { term_years: 3 },
        };
        const r = _realBuildQuoteFromV2(v2, '10 MR44 3yr');
        return {
          pass: r && r.requestedTerm === 3 && r.items?.[0]?.qty === 10,
          actual: JSON.stringify({ term: r?.requestedTerm, items: r?.items }),
        };
      },
    },
    {
      name: '[V2] hardware_only modifier → modifiers.hardwareOnly=true',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [{ sku: 'MR44', qty: 5 }],
          modifiers: { hardware_only: true },
        };
        const r = _realBuildQuoteFromV2(v2, '5 MR44 hardware only');
        return {
          pass: r && r.modifiers?.hardwareOnly === true,
          actual: JSON.stringify(r?.modifiers),
        };
      },
    },
    {
      name: '[V2] tier ENT (modifiers.tier) → requestedTier=ENT',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [{ sku: 'MX75', qty: 1 }],
          modifiers: { tier: 'ENT' },
        };
        const r = _realBuildQuoteFromV2(v2, 'MX75 enterprise');
        return {
          pass: r && r.requestedTier === 'ENT',
          actual: r?.requestedTier,
        };
      },
    },
    {
      name: '[V2] hw + LIC-ENT-3YR → term inferred to 3 from license SKU',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [
            { sku: 'MR44', qty: 10 },
            { sku: 'LIC-ENT-3YR', qty: 10 },
          ],
          modifiers: {},
        };
        const r = _realBuildQuoteFromV2(v2, '10 MR44 with LIC-ENT-3YR');
        const hasHw = r?.items?.some(i => i.baseSku === 'MR44');
        return {
          pass: hasHw && r.requestedTerm === 3 && r.items.length === 1,
          actual: JSON.stringify({ items: r?.items, term: r?.requestedTerm }),
        };
      },
    },
    {
      name: '[V2] license-only → directLicense with qty',
      run: () => {
        const v2 = {
          intent: 'quote',
          items: [{ sku: 'LIC-ENT-3YR', qty: 50 }],
          modifiers: {},
        };
        const r = _realBuildQuoteFromV2(v2, 'LIC-ENT-3YR x 50');
        const ok = (r?.directLicense?.sku === 'LIC-ENT-3YR' && r?.directLicense?.qty === 50)
          || (r?.directLicenseList?.[0]?.sku === 'LIC-ENT-3YR' && r?.directLicenseList?.[0]?.qty === 50);
        return {
          pass: ok,
          actual: JSON.stringify({ dl: r?.directLicense, dll: r?.directLicenseList }),
        };
      },
    },
    {
      name: '[V2] empty items → returns null (falls back to parseMessage)',
      run: () => {
        const v2 = { intent: 'quote', items: [], modifiers: {} };
        const r = _realBuildQuoteFromV2(v2, '');
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    {
      name: '[V2] non-quote intent → returns null',
      run: () => {
        const v2 = { intent: 'conversation', items: [], modifiers: {} };
        const r = _realBuildQuoteFromV2(v2, 'hey');
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    // ═══ applyV2Revision ═══
    {
      name: '[V2R] change_term: 3yr → 5yr on prior 10 MR44',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        const v2 = {
          intent: 'revise',
          revision: { action: 'change_term', new_term: 5 },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r && r.requestedTerm === 5 && r._revised === 'change_term',
          actual: JSON.stringify({ term: r?.requestedTerm, revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] change_tier: ENT → SEC on prior MX75',
      run: () => {
        const prior = _realParseMessage('MX75 enterprise');
        const v2 = {
          intent: 'revise',
          revision: { action: 'change_tier', new_tier: 'SEC' },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r && r.requestedTier === 'SEC' && r._revised === 'change_tier',
          actual: JSON.stringify({ tier: r?.requestedTier, revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] toggle_hw_lic: enable hardware_only on prior quote',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        const v2 = {
          intent: 'revise',
          revision: { action: 'toggle_hw_lic', hw_lic_toggle: 'hardware_only' },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r && r.modifiers?.hardwareOnly === true && r._revised === 'toggle_hw_lic',
          actual: JSON.stringify({ mods: r?.modifiers, revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] change_qty: update all MR44 items from 10 → 25',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        const v2 = {
          intent: 'revise',
          revision: { action: 'change_qty', new_qty: 25 },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mr44 = r?.items?.find(i => i.baseSku === 'MR44');
        return {
          pass: mr44?.qty === 25 && r?._revised === 'change_qty',
          actual: JSON.stringify({ mr44, revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] change_qty with target_sku: only MS125 changes, MR44 untouched',
      run: () => {
        const prior = _realParseMessage('5 MR46 and 2 MS225-24P');
        const v2 = {
          intent: 'revise',
          revision: { action: 'change_qty', new_qty: 8, target_sku: 'MS225-24P' },
        };
        const r = _realApplyV2Revision(prior, v2);
        const ms = r?.items?.find(i => /MS225/.test(i.baseSku));
        const mr = r?.items?.find(i => /MR46/.test(i.baseSku));
        return {
          pass: ms?.qty === 8 && mr?.qty === 5,
          actual: JSON.stringify({ ms, mr }),
        };
      },
    },
    {
      name: '[V2R] remove: drop MS225 from mixed prior',
      run: () => {
        const prior = _realParseMessage('5 MR46 and 2 MS225-24P');
        const v2 = {
          intent: 'revise',
          revision: { action: 'remove', target_sku: 'MS225-24P' },
        };
        const r = _realApplyV2Revision(prior, v2);
        const hasMs = r?.items?.some(i => /MS225/.test(i.baseSku));
        return {
          pass: r && !hasMs && r._revised === 'remove' && r.items.length === 1,
          actual: JSON.stringify({ items: r?.items?.map(i => i.baseSku), revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] add: append MS125-24P to prior MR44',
      run: () => {
        const prior = _realParseMessage('10 MR44');
        const v2 = {
          intent: 'revise',
          revision: { action: 'add', add_items: [{ sku: 'MS125-24P', qty: 2 }] },
        };
        const r = _realApplyV2Revision(prior, v2);
        const hasMs = r?.items?.some(i => /MS125/.test(i.baseSku));
        return {
          pass: r && hasMs && r._revised === 'add',
          actual: JSON.stringify({ items: r?.items?.map(i => `${i.qty}x${i.baseSku}`), revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] swap: MR44 → MR46 preserving qty=10',
      run: () => {
        const prior = _realParseMessage('10 MR44');
        const v2 = {
          intent: 'revise',
          revision: { action: 'swap', target_sku: 'MR44', add_items: [{ sku: 'MR46' }] },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mr46 = r?.items?.find(i => /MR46/.test(i.baseSku));
        const mr44 = r?.items?.find(i => /MR44/.test(i.baseSku));
        return {
          pass: r && mr46?.qty === 10 && !mr44 && r._revised === 'swap',
          actual: JSON.stringify({ items: r?.items?.map(i => `${i.qty}x${i.baseSku}`), revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] unhandled action → returns null (caller falls back to Claude)',
      run: () => {
        const prior = _realParseMessage('10 MR44');
        const v2 = {
          intent: 'revise',
          revision: { action: 'reformat_output_for_excel' },
        };
        const r = _realApplyV2Revision(prior, v2);
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    {
      name: '[V2R] null priorParsed → returns null',
      run: () => {
        const r = _realApplyV2Revision(null, { intent: 'revise', modifiers: { action: 'change_term' } });
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    // ═══ show_pricing action (PR 3) ═══
    {
      name: '[V2R] show_pricing: flips showPricing=true on prior 10 MR44 3yr, keeps items/term/tier',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mr44 = r?.items?.find(i => i.baseSku === 'MR44');
        return {
          pass: r?.showPricing === true && mr44?.qty === 10 && r?.requestedTerm === 3 && r?._revised === 'show_pricing',
          actual: JSON.stringify({ showPricing: r?.showPricing, qty: mr44?.qty, term: r?.requestedTerm, revised: r?._revised }),
        };
      },
    },
    {
      name: '[V2R] show_pricing preserves tier (MX75 SEC 5yr → same + pricing)',
      run: () => {
        const prior = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX-SEC-5YR&qty=2,2');
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r?.showPricing === true && r?.requestedTier === 'SEC' && r?.requestedTerm === 5 && r?.items?.[0]?.baseSku === 'MX75',
          actual: JSON.stringify({ showPricing: r?.showPricing, tier: r?.requestedTier, term: r?.requestedTerm, items: r?.items }),
        };
      },
    },
    {
      name: '[V2R] show_pricing on chained revision state — MR46 5yr + pricing',
      run: () => {
        // Simulate: user quoted MR44 3yr, revised to 5yr, swapped to MR46, now asks for cost
        const prior = _realExtractPriorFromAssistantUrl('5-Year Co-Term: https://stratusinfosystems.com/order/?item=MR46-HW,LIC-ENT-5YR&qty=10,10');
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mr46 = r?.items?.find(i => i.baseSku === 'MR46');
        return {
          pass: r?.showPricing === true && mr46?.qty === 10 && r?.requestedTerm === 5 && r?.requestedTier === 'ENT',
          actual: JSON.stringify({ showPricing: r?.showPricing, mr46, term: r?.requestedTerm, tier: r?.requestedTier }),
        };
      },
    },
    {
      name: '[V2R] show_pricing on directLicense-only prior preserves license',
      run: () => {
        const prior = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=LIC-ENT-3YR&qty=50');
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r?.showPricing === true && r?.directLicense?.sku === 'LIC-ENT-3YR' && r?.directLicense?.qty === 50,
          actual: JSON.stringify({ showPricing: r?.showPricing, dl: r?.directLicense }),
        };
      },
    },
    {
      name: '[V2R] back-compat: action=null + modifiers.show_pricing=true still applies show_pricing',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        const v2 = {
          intent: 'revise',
          revision: { action: null },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r?.showPricing === true && r?._revised === 'show_pricing' && r?.items?.[0]?.qty === 10,
          actual: JSON.stringify({ showPricing: r?.showPricing, revised: r?._revised, items: r?.items }),
        };
      },
    },
    {
      name: '[V2R] show_pricing is idempotent — prior already showPricing=true stays that way',
      run: () => {
        const prior = _realParseMessage('10 MR44 3yr');
        prior.showPricing = true;
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision(prior, v2);
        return {
          pass: r?.showPricing === true && r?.items?.[0]?.qty === 10 && r?.requestedTerm === 3,
          actual: JSON.stringify({ showPricing: r?.showPricing, qty: r?.items?.[0]?.qty, term: r?.requestedTerm }),
        };
      },
    },
    {
      name: '[V2R] show_pricing with empty prior → returns null (nothing to price)',
      run: () => {
        // Empty prior (no items, no direct license) shouldn't synthesize anything.
        const v2 = {
          intent: 'revise',
          revision: { action: 'show_pricing' },
          modifiers: { show_pricing: true },
        };
        const r = _realApplyV2Revision({ items: [], modifiers: {} }, v2);
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    // ═══ extractPriorFromAssistantUrl (chained-revision state) ═══
    {
      name: '[URL] single hw+lic → items=MR44, term=5 from LIC-ENT-5YR',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('5-Year Co-Term: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=10,10');
        return {
          pass: r && r.items[0]?.baseSku === 'MR44' && r.items[0]?.qty === 10 && r.requestedTerm === 5 && r.requestedTier === 'ENT',
          actual: JSON.stringify({ items: r?.items, term: r?.requestedTerm, tier: r?.requestedTier }),
        };
      },
    },
    {
      name: '[URL] hardware-only (no LIC) → hardwareOnly=true, term=null',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('Hardware only: https://stratusinfosystems.com/order/?item=MR44-HW&qty=5');
        return {
          pass: r && r.items[0]?.baseSku === 'MR44' && r.items[0]?.qty === 5 && r.modifiers?.hardwareOnly === true && r.requestedTerm === null,
          actual: JSON.stringify({ items: r?.items, mods: r?.modifiers }),
        };
      },
    },
    {
      name: '[URL] SEC tier MX75 → tier=SEC',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=MX75-HW,LIC-MX-SEC-3YR&qty=1,1');
        return {
          pass: r && r.requestedTier === 'SEC' && r.requestedTerm === 3,
          actual: JSON.stringify({ tier: r?.requestedTier, term: r?.requestedTerm }),
        };
      },
    },
    {
      name: '[URL] multiple URLs with distinct terms → requestedTerm=null (1/3/5Y re-emitted on revise)',
      run: () => {
        const content = '1-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-1YR&qty=10,10 3-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR&qty=10,10 5-Year: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=10,10';
        const r = _realExtractPriorFromAssistantUrl(content);
        return {
          pass: r && r.requestedTerm === null && r.items[0]?.baseSku === 'MR44' && r.items[0]?.qty === 10 && r.requestedTier === 'ENT',
          actual: JSON.stringify({ term: r?.requestedTerm, items: r?.items, tier: r?.requestedTier }),
        };
      },
    },
    {
      name: '[URL] no URL in content → returns null',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('Could you clarify what you want to quote?');
        return { pass: r === null, actual: JSON.stringify(r) };
      },
    },
    {
      name: '[URL] pure license → directLicenseList preserves qty + term',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=LIC-ENT-3YR&qty=50');
        return {
          pass: r && r.directLicense?.sku === 'LIC-ENT-3YR' && r.directLicense?.qty === 50 && r.requestedTerm === 3,
          actual: JSON.stringify({ dl: r?.directLicense, term: r?.requestedTerm }),
        };
      },
    },
    // ═══ Integration: assistant URL → applyV2Revision preserves chain ═══
    {
      name: '[CHAIN] MR44 5yr → swap to MR46 preserves 5YR term',
      run: () => {
        const prior = _realExtractPriorFromAssistantUrl('5-Year Co-Term: https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-5YR&qty=10,10');
        const v2 = {
          intent: 'revise',
          revision: { action: 'swap', target_sku: 'MR44', add_items: [{ sku: 'MR46' }] },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mr46 = r?.items?.find(i => i.baseSku === 'MR46');
        return {
          pass: mr46?.qty === 10 && r.requestedTerm === 5 && r.requestedTier === 'ENT',
          actual: JSON.stringify({ mr46, term: r?.requestedTerm, tier: r?.requestedTier }),
        };
      },
    },
    // ═══ LPC regression: multi-option/multi-term prior with MX-SEC + MR-ENT ═══
    {
      name: '[URL] MX-SEC hw + LIC-ENT (MR) → tier=SEC (MX wins, MR-ENT is fallback)',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-5YR,LIC-ENT-5YR&qty=1,1,24');
        return {
          pass: r && r.requestedTier === 'SEC',
          actual: JSON.stringify({ tier: r?.requestedTier, items: r?.items }),
        };
      },
    },
    {
      name: '[URL] LPC 3-term refresh (Option 3) → items + MR-AGN qty=24, term=null, tier=SEC',
      run: () => {
        const option3 = [
          '1-Year: https://stratusinfosystems.com/order/?item=MS130-8,LIC-MS130-8-1YR,C9300L-24P-4X-M,LIC-C9300L-24P-M-1Y-A,MX67-HW,LIC-MX67-SEC-1YR,MX68-HW,LIC-MX68-SEC-1YR,MX85-HW,LIC-MX85-SEC-1YR,LIC-ENT-1YR&qty=1,1,1,1,1,1,1,1,1,1,24',
          '3-Year: https://stratusinfosystems.com/order/?item=MS130-8,LIC-MS130-8-3YR,C9300L-24P-4X-M,LIC-C9300L-24P-M-3Y-A,MX67-HW,LIC-MX67-SEC-3YR,MX68-HW,LIC-MX68-SEC-3YR,MX85-HW,LIC-MX85-SEC-3YR,LIC-ENT-3YR&qty=1,1,1,1,1,1,1,1,1,1,24',
          '5-Year: https://stratusinfosystems.com/order/?item=MS130-8,LIC-MS130-8-5YR,C9300L-24P-4X-M,LIC-C9300L-24P-M-5Y-A,MX67-HW,LIC-MX67-SEC-5YR,MX68-HW,LIC-MX68-SEC-5YR,MX85-HW,LIC-MX85-SEC-5YR,LIC-ENT-5YR&qty=1,1,1,1,1,1,1,1,1,1,24',
        ].join('\n\n');
        const r = _realExtractPriorFromAssistantUrl(option3);
        const mrAgn = r?.items?.find(i => i.baseSku === 'MR-AGN');
        const mx85 = r?.items?.find(i => i.baseSku === 'MX85');
        return {
          pass: r && r.requestedTerm === null && r.requestedTier === 'SEC' && mrAgn?.qty === 24 && mx85?.qty === 1,
          actual: JSON.stringify({ term: r?.requestedTerm, tier: r?.requestedTier, mrAgn, mx85, itemCount: r?.items?.length }),
        };
      },
    },
    {
      name: '[CHAIN] LPC 3-term refresh → swap MX85 to MX95 preserves MR-AGN qty=24, tier=SEC, term=null',
      run: () => {
        const option3 = [
          '1-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-1YR,MX68-HW,LIC-MX68-SEC-1YR,MX85-HW,LIC-MX85-SEC-1YR,LIC-ENT-1YR&qty=1,1,1,1,1,1,24',
          '3-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-3YR,MX68-HW,LIC-MX68-SEC-3YR,MX85-HW,LIC-MX85-SEC-3YR,LIC-ENT-3YR&qty=1,1,1,1,1,1,24',
          '5-Year: https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-5YR,MX68-HW,LIC-MX68-SEC-5YR,MX85-HW,LIC-MX85-SEC-5YR,LIC-ENT-5YR&qty=1,1,1,1,1,1,24',
        ].join('\n\n');
        const prior = _realExtractPriorFromAssistantUrl(option3);
        const v2 = {
          intent: 'revise',
          revision: { action: 'swap', target_sku: 'MX85', add_items: [{ sku: 'MX95' }] },
        };
        const r = _realApplyV2Revision(prior, v2);
        const mx95 = r?.items?.find(i => i.baseSku === 'MX95');
        const mx85 = r?.items?.find(i => i.baseSku === 'MX85');
        const mx67 = r?.items?.find(i => i.baseSku === 'MX67');
        const mrAgn = r?.items?.find(i => i.baseSku === 'MR-AGN');
        return {
          pass: mx95?.qty === 1 && !mx85 && mx67?.qty === 1 && mrAgn?.qty === 24 && r.requestedTerm === null && r.requestedTier === 'SEC',
          actual: JSON.stringify({ mx95, mx85, mx67, mrAgn, term: r?.requestedTerm, tier: r?.requestedTier }),
        };
      },
    },
    {
      name: '[URL] pure MX-SEC (no agnostic) single term → tier=SEC, term=3, no MR-AGN injected',
      run: () => {
        const r = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-3YR&qty=2,2');
        const mrAgn = r?.items?.find(i => i.baseSku === 'MR-AGN');
        return {
          pass: r && r.requestedTier === 'SEC' && r.requestedTerm === 3 && !mrAgn,
          actual: JSON.stringify({ tier: r?.requestedTier, term: r?.requestedTerm, mrAgn, items: r?.items }),
        };
      },
    },
    {
      name: '[URL] hardware + multiple licenses — MX-tier wins over MR-ENT fallback',
      run: () => {
        // Order matters: MR (agnostic ENT) comes AFTER MX licenses in the URL.
        // Regression: previously the last license "won" tier inference, flipping
        // MX from SEC to ENT. Now MX is authoritative regardless of order.
        const r = _realExtractPriorFromAssistantUrl('https://stratusinfosystems.com/order/?item=MX67-HW,LIC-MX67-SEC-5YR,LIC-ENT-5YR&qty=1,1,10');
        return {
          pass: r && r.requestedTier === 'SEC',
          actual: JSON.stringify({ tier: r?.requestedTier }),
        };
      },
    },
    // ═══ Per-term standalone family promotion (MV/MT/agnostic-MR) ═══
    // Regression from the 2026-04-24 Webex MV quote-cost bug: "what are the
    // costs" after "30 MV licenses" collapsed into one merged URL because
    // only Duo/Umbrella were being promoted back to isTermOptionQuote on
    // URL-history reconstruction. These tests lock in promotion + guards.
    {
      name: '[PROMOTE] MV multi-term pool → isTermOptionQuote (3 items, licenseOnly)',
      run: () => {
        const prior = '1-Year: https://stratusinfosystems.com/order/?item=LIC-MV-1YR&qty=30\n3-Year: https://stratusinfosystems.com/order/?item=LIC-MV-3YR&qty=30\n5-Year: https://stratusinfosystems.com/order/?item=LIC-MV-5YR&qty=30';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && r.isTermOptionQuote === true && r.items?.length === 3 && r.modifiers?.licenseOnly === true && !r.directLicenseList && !r.directLicense,
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, itemCount: r?.items?.length, dll: !!r?.directLicenseList, dl: !!r?.directLicense }),
        };
      },
    },
    {
      name: '[PROMOTE] MT multi-term pool → isTermOptionQuote',
      run: () => {
        // MT uses single "Y" suffix (LIC-MT-1Y), not "YR".
        const prior = 'https://stratusinfosystems.com/order/?item=LIC-MT-1Y&qty=5\nhttps://stratusinfosystems.com/order/?item=LIC-MT-3Y&qty=5\nhttps://stratusinfosystems.com/order/?item=LIC-MT-5Y&qty=5';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && r.isTermOptionQuote === true && r.items?.length === 3 && r.items[0].baseSku === 'LIC-MT-1Y',
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, items: r?.items }),
        };
      },
    },
    {
      name: '[PROMOTE] agnostic MR ENT multi-term pool → isTermOptionQuote',
      run: () => {
        const prior = 'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR&qty=5\nhttps://stratusinfosystems.com/order/?item=LIC-ENT-3YR&qty=5\nhttps://stratusinfosystems.com/order/?item=LIC-ENT-5YR&qty=5';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && r.isTermOptionQuote === true && r.items?.length === 3 && r.requestedTier === 'ENT',
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, itemCount: r?.items?.length, tier: r?.requestedTier }),
        };
      },
    },
    {
      name: '[PROMOTE-NEG] mixed families MV+ENT → stays directLicenseList (single-family guard)',
      run: () => {
        // Both match PER_TERM_STANDALONE_RE but familyKeys.size === 2, so
        // promotion must NOT fire. Falls through to directLicenseList.
        const prior = 'https://stratusinfosystems.com/order/?item=LIC-MV-3YR,LIC-ENT-3YR&qty=30,5';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && !r.isTermOptionQuote && Array.isArray(r.directLicenseList) && r.directLicenseList.length === 2,
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, dll: r?.directLicenseList }),
        };
      },
    },
    {
      name: '[PROMOTE-NEG] single-term MV pool → directLicense (not promoted)',
      run: () => {
        // Only one term present — multi-term guard trips, falls to directLicense.
        const prior = 'https://stratusinfosystems.com/order/?item=LIC-MV-3YR&qty=30';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && !r.isTermOptionQuote && r.directLicense?.sku === 'LIC-MV-3YR' && r.directLicense?.qty === 30,
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, dl: r?.directLicense }),
        };
      },
    },
    {
      name: '[PROMOTE] show_pricing revise on MV pool preserves isTermOptionQuote shape',
      run: () => {
        // End-to-end: prior URL → extract → applyV2Revision(show_pricing).
        // Output must keep 3 items in isTermOptionQuote (no flatten to DLL).
        const prior = '1-Year: https://stratusinfosystems.com/order/?item=LIC-MV-1YR&qty=30\n3-Year: https://stratusinfosystems.com/order/?item=LIC-MV-3YR&qty=30\n5-Year: https://stratusinfosystems.com/order/?item=LIC-MV-5YR&qty=30';
        const priorParsed = _realExtractPriorFromAssistantUrl(prior);
        const v2 = { intent: 'revise', confidence: 0.95, items: [], modifiers: { show_pricing: true }, revision: { action: 'show_pricing' }, reference: { resolve_from_history: true } };
        const revised = _realApplyV2Revision(priorParsed, v2);
        return {
          pass: revised && revised.isTermOptionQuote === true && revised.showPricing === true && revised.items?.length === 3 && !revised.directLicenseList,
          actual: JSON.stringify({ isTermOptionQuote: revised?.isTermOptionQuote, showPricing: revised?.showPricing, itemCount: revised?.items?.length, dll: !!revised?.directLicenseList }),
        };
      },
    },
    {
      name: '[PROMOTE] chained revise — change_term=3 on promoted MV pool filters to LIC-MV-3YR only',
      run: () => {
        // After show_pricing promotion, a follow-up "3 year only" should
        // filter the 3 items down to just LIC-MV-3YR. This proves the
        // promotion restored a state shape the existing term-filter logic
        // can operate on.
        const prior = '1-Year: https://stratusinfosystems.com/order/?item=LIC-MV-1YR&qty=30\n3-Year: https://stratusinfosystems.com/order/?item=LIC-MV-3YR&qty=30\n5-Year: https://stratusinfosystems.com/order/?item=LIC-MV-5YR&qty=30';
        const priorParsed = _realExtractPriorFromAssistantUrl(prior);
        const v2 = { intent: 'revise', confidence: 0.95, items: [], modifiers: {}, revision: { action: 'change_term', new_term: 3 }, reference: { resolve_from_history: true } };
        const revised = _realApplyV2Revision(priorParsed, v2);
        return {
          pass: revised && Array.isArray(revised.items) && revised.items.length === 1 && revised.items[0].baseSku === 'LIC-MV-3YR',
          actual: JSON.stringify({ items: revised?.items }),
        };
      },
    },
    {
      name: '[PROMOTE-REGRESSION] DUO single-tier multi-term → promoted, separateQuotes=false',
      run: () => {
        // Assert the new per-term standalone block runs AFTER the existing
        // DUO/UMB block, not in front of it. Single-tier DUO must still
        // promote to isTermOptionQuote, with separateQuotes=false (one tier).
        const prior = 'Duo Essentials 1-Year: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=10\nDuo Essentials 3-Year: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=10';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && r.isTermOptionQuote === true && r.modifiers?.separateQuotes === false && r.items?.length === 2,
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, separateQuotes: r?.modifiers?.separateQuotes, itemCount: r?.items?.length }),
        };
      },
    },
    {
      name: '[PROMOTE-REGRESSION] DUO multi-tier multi-term → promoted with separateQuotes=true',
      run: () => {
        // The other half of the DUO regression: mixing DUO-ESSENTIALS and
        // DUO-ADVANTAGE across terms must still trip separateQuotes=true so
        // the renderer emits one URL per (tier, term) pair.
        const prior = 'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR,LIC-DUO-ADVANTAGE-1YR,LIC-DUO-ESSENTIALS-3YR,LIC-DUO-ADVANTAGE-3YR&qty=10,10,10,10';
        const r = _realExtractPriorFromAssistantUrl(prior);
        return {
          pass: r && r.isTermOptionQuote === true && r.modifiers?.separateQuotes === true && r.items?.length === 4,
          actual: JSON.stringify({ isTermOptionQuote: r?.isTermOptionQuote, separateQuotes: r?.modifiers?.separateQuotes, itemCount: r?.items?.length }),
        };
      },
    },
  ];

  for (const t of v2Fixtures) {
    process.stdout.write(`  ${t.name}... `);
    try {
      const res = t.run();
      if (res.pass) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log(`❌ FAIL — ${res.actual}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ THROW — ${e.message}`);
      failed++;
    }
  }
} else {
  console.log('\n─── V2 adapter tests ─── SKIPPED (functions not exported)');
}

console.log(`\n${passed}/${passed + failed} tests passed`);
if (failed > 0) process.exit(1);
