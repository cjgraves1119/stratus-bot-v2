/**
 * Deterministic Quoting Engine - Client-Side Port
 *
 * This module provides client-side quote generation for the Stratus AI Chrome Extension.
 * It ports core functions from the Webex/GChat bot's deterministic quoting engine to enable
 * offline quote URL generation without API calls.
 *
 * Key Functions:
 * - parseSkuInput(text): Parses SKU input text and extracts items with quantities
 * - applySuffix(sku): Adds correct product family suffix to SKU
 * - getLicenseSkus(baseSku, requestedTerm): Generates license SKU array for a hardware model
 * - buildStratusUrl(items): Constructs the Stratus quote URL with deduplication
 * - checkEol(baseSku): Returns replacement SKU or null if not EOL
 * - generateLocalQuote(text): End-to-end quote generation, returns {urls, parsed, needsApi}
 */

// ============================================================================
// SKU SUFFIX RULES
// ============================================================================

/**
 * Determines the appropriate suffix for a SKU based on product family.
 * @param {string} sku - Base SKU without suffix
 * @returns {string} Uppercase SKU with appropriate suffix
 */
export function applySuffix(sku) {
  const upper = sku.toUpperCase();

  // Z-series (except Z4X, Z4CX which have no suffix)
  if (/^Z[0-3]/.test(upper)) return upper + '-HW';
  if (/^Z4(C)?X$/.test(upper)) return upper; // Z4X, Z4CX: no suffix

  // MR, MV, MT, MG series
  if (/^MR\d+/.test(upper)) return upper + '-HW';
  if (/^MV\d+/.test(upper)) return upper + '-HW';
  if (/^MT\d+/.test(upper)) return upper + '-HW';
  if (/^MG\d+/.test(upper)) return upper + '-HW';

  // MX series
  if (/^MXC/.test(upper)) return upper + '-HW-NA'; // MX cellular (e.g., MX67C, MX68C)
  if (/^MX/.test(upper)) return upper + '-HW'; // Non-cellular MX

  // CW Wi-Fi series
  if (/^CW917\d/.test(upper)) return upper + '-RTG'; // CW917x: Wi-Fi 7
  if (/^CW916\d/.test(upper)) return upper + '-MR'; // CW916x: Wi-Fi 6E

  // MS130 and MS390
  if (/^MS130/.test(upper)) return upper + '-HW';
  if (/^MS390/.test(upper)) return upper + '-HW';

  // MS150, MS450, C9xxx: no suffix
  if (/^MS150|^MS450|^C[89]\d|^C9300|^C9350/.test(upper)) return upper;

  // License SKUs: no suffix
  if (/^LIC-/.test(upper)) return upper;

  // Default: return uppercase, no suffix
  return upper;
}

// ============================================================================
// EOL REPLACEMENT MAPPING
// ============================================================================

const EOL_REPLACEMENTS = {
  // MR series
  "MR12": "MR28",
  "MR16": "MR28",
  "MR18": "MR28",
  "MR24": "MR36",
  "MR26": "MR36",
  "MR30H": "MR36H",
  "MR32": "MR36",
  "MR33": "MR36",
  "MR34": "MR44",
  "MR42": "MR44",
  "MR42E": "MR46E",
  "MR52": "MR57",
  "MR53": "MR57",
  "MR53E": "MR57",
  "MR56": "MR57",
  "MR74": "MR76",
  "MR62": "MR76",
  "MR66": "MR78",
  "MR72": "MR86",
  "MR84": "MR86",

  // MX series
  "MX60": "MX67",
  "MX60W": "MX67W",
  "MX64": "MX67",
  "MX64W": "MX67W",
  "MX65": "MX68",
  "MX65W": "MX68W",
  "MX80": "MX85",
  "MX84": "MX85",
  "MX100": "MX95",
  "MX400": "MX450",
  "MX600": "MX450",

  // MV series
  "MV21": "MV23M",
  "MV12N": "MV13",
  "MV12W": "MV13",
  "MV12WE": "MV13",
  "MV22": "MV23M",
  "MV22X": "MV23M",
  "MV32": "MV33",
  "MV52": "MV53X",
  "MV72": "MV73M",
  "MV72X": "MV73M",
  "MV71": "MV73M",

  // MG series
  "MG21": "MG41",
  "MG21E": "MG41E",

  // Z series
  "Z1": "Z4",
  "Z3": "Z4",
  "Z3C": "Z4C",

  // MS legacy to MS130
  "MS120": "MS130",
  "MS120-8": "MS130-8",
  "MS120-8LP": "MS130-8P",
  "MS120-8FP": "MS130-8P",
  "MS120-24": "MS130-24",
  "MS120-24P": "MS130-24P",
  "MS120-48": "MS130-48",
  "MS120-48LP": "MS130-48P",
  "MS120-48FP": "MS130-48P",
  "MS125": "MS130",
  "MS125-24": "MS130-24",
  "MS125-24P": "MS130-24P",
  "MS125-48": "MS130-48",
  "MS125-48LP": "MS130-48P",
  "MS125-48FP": "MS130-48P",
  "MS220": "MS130",
  "MS220-8": "MS130-8",
  "MS220-8P": "MS130-8P",
  "MS220-24": "MS130-24",
  "MS220-24P": "MS130-24P",
  "MS220-48": "MS130-48",
  "MS220-48LP": "MS130-48P",
  "MS220-48FP": "MS130-48P",

  // MS legacy to MS150 (dual uplink options)
  "MS210": "MS150",
  "MS210-24": ["MS150-24T-4G", "MS150-24T-4X"],
  "MS210-24P": ["MS150-24P-4G", "MS150-24P-4X"],
  "MS210-48": ["MS150-48T-4G", "MS150-48T-4X"],
  "MS210-48LP": ["MS150-48LP-4G", "MS150-48LP-4X"],
  "MS210-48FP": ["MS150-48FP-4G", "MS150-48FP-4X"],
  "MS225": "MS150",
  "MS225-24": ["MS150-24T-4G", "MS150-24T-4X"],
  "MS225-24P": ["MS150-24P-4G", "MS150-24P-4X"],
  "MS225-48": ["MS150-48T-4G", "MS150-48T-4X"],
  "MS225-48LP": ["MS150-48LP-4G", "MS150-48LP-4X"],
  "MS225-48FP": ["MS150-48FP-4G", "MS150-48FP-4X"],
  "MS250-24P": ["MS150-24P-4G", "MS150-24P-4X"],
  "MS250-48LP": ["MS150-48LP-4G", "MS150-48LP-4X"],
  "MS250-48FP": ["MS150-48FP-4G", "MS150-48FP-4X"],
  "MS310": "MS150",
  "MS310-24": ["MS150-24T-4G", "MS150-24T-4X"],
  "MS310-24P": ["MS150-24P-4G", "MS150-24P-4X"],
  "MS310-48": ["MS150-48T-4G", "MS150-48T-4X"],
  "MS310-48LP": ["MS150-48LP-4G", "MS150-48LP-4X"],
  "MS310-48FP": ["MS150-48FP-4G", "MS150-48FP-4X"],
  "MS320": "MS150",
  "MS320-24": ["MS150-24T-4G", "MS150-24T-4X"],
  "MS320-24P": ["MS150-24P-4G", "MS150-24P-4X"],
  "MS320-48": ["MS150-48T-4G", "MS150-48T-4X"],
  "MS320-48LP": ["MS150-48LP-4G", "MS150-48LP-4X"],
  "MS320-48FP": ["MS150-48FP-4G", "MS150-48FP-4X"],

  // MS legacy to Catalyst
  "MS355": "C9300X",
  "MS355-24X": "C9300X-24HX-M",
  "MS355-24X2": "C9300X-24HX-M",
  "MS355-48X": "C9300X-48HX-M",
  "MS355-48X2": "C9300X-48HX-M",
  "MS350": "C9300",
  "MS350-24": "C9300-24T-M",
  "MS350-24P": "C9300-24P-M",
  "MS350-24X": "C9300-24UX-M",
  "MS350-48": "C9300-48T-M",
  "MS350-48LP": "C9300-48P-M",
  "MS350-48FP": "C9300-48P-M",
  "MS350-48X": "C9300-48UXM-M",
  "MS410": "C9300",
  "MS410-16": "C9300-24S-M",
  "MS410-32": "C9300-48S-M",
  "MS420": "C9300",
  "MS420-24": "C9300-24S-M",
  "MS420-48": "C9300-48S-M",
  "MS425": "C9300X",
  "MS425-16": "C9300X-24Y-M",
  "MS425-32": "C9300X-24Y-M",
  "MS390": "C9300",
  "MS390-24": "C9300-24T-M",
  "MS390-24P": "C9300-24P-M",
  "MS390-24U": "C9300-24U-M",
  "MS390-24UX": "C9300-24UX-M",
  "MS390-48": "C9300-48T-M",
  "MS390-48P": "C9300-48P-M",
  "MS390-48U": "C9300-48U-M",
  "MS390-48UX": "C9300-48UXM-M",
  "MS390-48UX2": "C9300-48UN-M"
};

/**
 * Checks if a SKU is EOL and returns its replacement.
 * @param {string} baseSku - Base SKU (without suffix)
 * @returns {string|string[]|null} Replacement SKU(s) or null if not EOL
 */
export function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  return EOL_REPLACEMENTS[upper] || null;
}

// ============================================================================
// LICENSE SKU GENERATION
// ============================================================================

/**
 * Returns the appropriate license SKU array for a hardware model.
 * Applies the correct term suffix based on product family conventions.
 * @param {string} baseSku - Base hardware SKU (without suffix)
 * @param {string} requestedTerm - Optional override term ('1', '3', '5')
 * @returns {string[]} Array of license SKU strings with term variations
 */
export function getLicenseSkus(baseSku, requestedTerm = null) {
  const upper = baseSku.toUpperCase();
  let terms = requestedTerm ? [requestedTerm] : ['1', '3', '5'];

  // Detect family and apply appropriate term suffix (Y vs YR)
  let termSuffix = 'Y'; // default: newer products use Y (1Y, 3Y, 5Y)

  // Older product families use YR (1YR, 3YR, 5YR)
  if (
    /^MR(12|16|18|24|26|30|32|33|34|42|52|53|56|62|66|72|74|84)/.test(upper) ||
    /^MX(60|64|65|80|84|100|400|600|67W)/.test(upper) ||
    /^MV(12|21|22|32|52|72)/.test(upper) ||
    /^MG(21)/.test(upper) ||
    /^Z[0-3]/.test(upper) ||
    /^MS(12|21|22|25|31|32|35)/.test(upper)
  ) {
    termSuffix = 'YR';
  }

  // Build license SKUs
  const skus = [];

  // C8 and C9 Catalyst
  if (/^C[89]\d+/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-C9-${term}Y`);
    }
    return skus;
  }

  // MR access points
  if (/^MR\d+/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // CW WiFi products
  if (/^CW/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}Y`);
    }
    return skus;
  }

  // MX series
  if (/^MX/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // MS series
  if (/^MS\d+/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // Z series
  if (/^Z[0-4]/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // MV camera series
  if (/^MV\d+/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // MT sensors and MG cellular
  if (/^MT|^MG/.test(upper)) {
    for (const term of terms) {
      skus.push(`LIC-ENT-${term}${termSuffix}`);
    }
    return skus;
  }

  // Default
  for (const term of terms) {
    skus.push(`LIC-ENT-${term}Y`);
  }
  return skus;
}

// ============================================================================
// PARSING AND URL GENERATION
// ============================================================================

/**
 * Simple SKU input parser. Extracts SKUs and quantities from user text.
 * Handles formats like:
 * - "quote 10 MR44"
 * - "MR44 qty 10, MR45 qty 5"
 * - CSV: "SKU,QTY\nMR44,10\nMR45,5"
 * @param {string} text - User input text
 * @returns {Array} Array of {baseSku, qty} objects
 */
export function parseSkuInput(text) {
  const items = [];
  const lines = text.split(/[\n,;]/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Pattern: SKU and quantity together (e.g., "MR44 10" or "10 MR44")
    const match = trimmed.match(/([A-Z0-9\-]+)\s+(\d+)|(\d+)\s+([A-Z0-9\-]+)/i);
    if (match) {
      let sku, qty;
      if (match[1]) {
        sku = match[1];
        qty = parseInt(match[2], 10);
      } else {
        qty = parseInt(match[3], 10);
        sku = match[4];
      }

      if (sku && qty > 0) {
        items.push({ baseSku: sku.toUpperCase(), qty });
      }
      continue;
    }

    // Just a SKU number (qty defaults to 1)
    if (/^[A-Z0-9\-]+$/i.test(trimmed)) {
      items.push({ baseSku: trimmed.toUpperCase(), qty: 1 });
    }
  }

  return items;
}

/**
 * Builds a Stratus quote URL from items array.
 * Deduplicates SKUs by summing quantities.
 * @param {Array} items - Array of {baseSku, qty, includeHardware?, includeLicense?}
 * @returns {string} Stratus quote URL
 */
export function buildStratusUrl(items) {
  if (!items || items.length === 0) return null;

  // Deduplicate and build merged items
  const merged = new Map();
  for (const item of items) {
    const {
      baseSku,
      qty,
      includeHardware = true,
      includeLicense = true
    } = item;

    if (!baseSku) continue;

    // Hardware
    if (includeHardware && !baseSku.toUpperCase().startsWith('LIC-')) {
      const hwSku = applySuffix(baseSku);
      merged.set(hwSku, (merged.get(hwSku) || 0) + qty);
    }

    // License
    if (includeLicense && !baseSku.toUpperCase().startsWith('LIC-')) {
      const licSkus = getLicenseSkus(baseSku);
      for (const licSku of licSkus) {
        merged.set(licSku, (merged.get(licSku) || 0) + qty);
      }
    }

    // Direct license SKU
    if (baseSku.toUpperCase().startsWith('LIC-')) {
      merged.set(applySuffix(baseSku), (merged.get(baseSku) || 0) + qty);
    }
  }

  // Build URL
  const skus = Array.from(merged.keys());
  const qtys = Array.from(merged.values());

  if (skus.length === 0) return null;

  const params = new URLSearchParams();
  params.set('item', skus.join(','));
  params.set('qty', qtys.join(','));

  return `https://stratusinfosystems.com/order/?${params.toString()}`;
}

// ============================================================================
// END-TO-END QUOTE GENERATION
// ============================================================================

/**
 * Complete quote generation function.
 * Parses input, handles EOL detection, and generates quote URL.
 * @param {string} text - User input text with SKUs
 * @returns {object} {url, parsed, hasEol, eolInfo, needsApi}
 */
export function generateLocalQuote(text) {
  if (!text || text.trim().length === 0) {
    return { url: null, needsApi: true, error: 'No input provided' };
  }

  try {
    // Parse input
    const items = parseSkuInput(text);
    if (items.length === 0) {
      return { url: null, needsApi: true, error: 'No valid SKUs found' };
    }

    // Check for EOL
    const eolInfo = {};
    let hasEol = false;
    for (const item of items) {
      const replacement = checkEol(item.baseSku);
      if (replacement) {
        hasEol = true;
        eolInfo[item.baseSku] = replacement;
      }
    }

    // Generate URL
    const url = buildStratusUrl(items);

    return {
      url,
      parsed: items,
      hasEol,
      eolInfo: hasEol ? eolInfo : null,
      needsApi: false
    };
  } catch (error) {
    console.error('Quote generation error:', error);
    return { url: null, needsApi: true, error: error.message };
  }
}
