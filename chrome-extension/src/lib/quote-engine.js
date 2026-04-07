/**
 * Deterministic Quoting Engine - Client-Side Port
 *
 * Full port of the Webex/GChat bot's quoting engine including:
 * - SKU validation with fuzzy matching and "did you mean?" suggestions
 * - Common mistake correction from auto-catalog.json
 * - EOL detection with replacement mapping
 * - Hardware/license modifiers
 * - Multi-format parsing (CSV, lists, natural language)
 * - Option 1/2/3 output for EOL replacements with dual uplink
 */

import catalog from './auto-catalog.json';

// ============================================================================
// CATALOG DATA
// ============================================================================

const COMMON_MISTAKES = catalog._COMMON_MISTAKES || {};
const EOL_REPLACEMENTS = catalog._EOL_REPLACEMENTS || {};

// _EOL_PRODUCTS can be either a flat array OR a family-keyed object {MR: [...], MX: [...]}
// Normalize to a flat Set of base SKU strings
const EOL_PRODUCTS = (() => {
  const raw = catalog._EOL_PRODUCTS;
  if (!raw) return new Set();
  if (Array.isArray(raw)) return new Set(raw.map(s => String(s).toUpperCase()));
  // Object form: { MR: ["44","46",...], MX: ["67",...] } → expand to "MR44", "MX67", etc.
  const flat = new Set();
  for (const [family, variants] of Object.entries(raw)) {
    if (Array.isArray(variants)) {
      variants.forEach(v => flat.add((family + v).toUpperCase()));
    }
  }
  return flat;
})();

// Build VALID_SKUS set from all family arrays in catalog
const VALID_SKUS = new Set();
for (const [key, val] of Object.entries(catalog)) {
  if (!key.startsWith('_') && Array.isArray(val)) {
    val.forEach(sku => VALID_SKUS.add(sku.toUpperCase()));
  }
}

// ============================================================================
// SKU SUFFIX RULES
// ============================================================================

export function applySuffix(sku) {
  const upper = sku.toUpperCase();

  // License SKUs: no suffix
  if (/^LIC-/.test(upper)) return upper;
  // MA- accessories: no suffix
  if (/^MA-/.test(upper)) return upper;

  // Z-series (except Z4X, Z4CX which have no suffix)
  if (/^Z[0-3]/.test(upper)) return upper + '-HW';
  if (/^Z4(C)?X$/.test(upper)) return upper;
  if (/^Z4/.test(upper)) return upper + '-HW';

  // MR, MV, MT, MG series
  if (/^MR\d+/.test(upper)) return upper + '-HW';
  if (/^MV\d+/.test(upper)) return upper + '-HW';
  if (/^MT\d+/.test(upper)) return upper + '-HW';
  if (/^MG\d+/.test(upper)) return upper + '-HW';

  // MX series
  if (/^MX\d+C/.test(upper)) return upper + '-HW-NA'; // Cellular
  if (/^MX/.test(upper)) return upper + '-HW';

  // CW Wi-Fi series
  if (/^CW917\d/.test(upper)) return upper + '-RTG'; // Wi-Fi 7
  if (/^CW916\d/.test(upper)) return upper + '-MR'; // Wi-Fi 6E

  // MS130, MS130R, MS390
  if (/^MS130/.test(upper)) return upper + '-HW';
  if (/^MS390/.test(upper)) return upper + '-HW';

  // MS150, MS450, C9xxx: no suffix
  if (/^MS150|^MS450|^C[89]\d/.test(upper)) return upper;

  return upper;
}

// ============================================================================
// FAMILY DETECTION
// ============================================================================

function detectFamily(sku) {
  const upper = sku.toUpperCase();
  if (/^MR\d/.test(upper)) return 'MR';
  if (/^MX\d/.test(upper)) return 'MX';
  if (/^MV\d/.test(upper)) return 'MV';
  if (/^MT\d/.test(upper)) return 'MT';
  if (/^MG\d/.test(upper)) return 'MG';
  if (/^Z\d/.test(upper)) return 'Z';
  if (/^MS130/.test(upper)) return 'MS130';
  if (/^MS150/.test(upper)) return 'MS150';
  if (/^MS120/.test(upper)) return 'MS120';
  if (/^MS125/.test(upper)) return 'MS125';
  if (/^MS210/.test(upper)) return 'MS210';
  if (/^MS220/.test(upper)) return 'MS220';
  if (/^MS225/.test(upper)) return 'MS225';
  if (/^MS250/.test(upper)) return 'MS250';
  if (/^MS320/.test(upper)) return 'MS320';
  if (/^MS350/.test(upper)) return 'MS350';
  if (/^MS355/.test(upper)) return 'MS355';
  if (/^MS390/.test(upper)) return 'MS390';
  if (/^MS410/.test(upper)) return 'MS410';
  if (/^MS420/.test(upper)) return 'MS420';
  if (/^MS425/.test(upper)) return 'MS425';
  if (/^MS450/.test(upper)) return 'MS450';
  if (/^CW9/.test(upper)) return 'CW';
  if (/^C9300X/.test(upper)) return 'C9300X';
  if (/^C9300L/.test(upper)) return 'C9300L';
  if (/^C9300/.test(upper)) return 'C9300';
  if (/^C9200L/.test(upper)) return 'C9200L';
  if (/^C8/.test(upper)) return 'C8111';
  return null;
}

// ============================================================================
// FUZZY MATCHING (Levenshtein)
// ============================================================================

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatchInFamily(sku, family) {
  const familySkus = catalog[family] || [];
  const matches = [];
  for (const candidate of familySkus) {
    const dist = levenshtein(sku.toUpperCase(), candidate.toUpperCase());
    if (dist <= 3) {
      matches.push({ sku: candidate, distance: dist });
    }
  }
  return matches.sort((a, b) => a.distance - b.distance).slice(0, 5);
}

function fuzzyMatchAllFamilies(sku) {
  const matches = [];
  for (const [key, val] of Object.entries(catalog)) {
    if (key.startsWith('_') || !Array.isArray(val)) continue;
    for (const candidate of val) {
      const dist = levenshtein(sku.toUpperCase(), candidate.toUpperCase());
      if (dist <= 3) {
        matches.push({ sku: candidate, distance: dist });
      }
    }
  }
  return matches.sort((a, b) => a.distance - b.distance).slice(0, 5);
}

// ============================================================================
// COMMON MISTAKES
// ============================================================================

function fixCommonMistake(sku) {
  const upper = sku.toUpperCase();

  // Exact match first
  const mistake = COMMON_MISTAKES[upper];
  if (mistake && mistake.suggest && mistake.suggest.length > 0) {
    return { error: mistake.error, suggest: mistake.suggest };
  }

  // Prefix match
  for (const [key, val] of Object.entries(COMMON_MISTAKES)) {
    if (upper.startsWith(key + '-') && val.suggest && val.suggest.length > 0) {
      const suffix = upper.slice(key.length).toUpperCase();
      const appended = val.suggest
        .map(s => s + suffix)
        .filter(s => VALID_SKUS.has(s.toUpperCase()) || isEol(s));
      if (appended.length > 0) return { error: val.error, suggest: appended };
      const filtered = val.suggest.filter(s => s.toUpperCase().endsWith(suffix));
      if (filtered.length > 0) return { error: val.error, suggest: filtered };
      return { error: val.error, suggest: val.suggest };
    }
  }

  return null;
}

// ============================================================================
// EOL DETECTION
// ============================================================================

export function isEol(baseSku) {
  const upper = baseSku.toUpperCase();
  return EOL_PRODUCTS.has(upper) || !!EOL_REPLACEMENTS[upper];
}

export function checkEol(baseSku) {
  const upper = baseSku.toUpperCase();
  return EOL_REPLACEMENTS[upper] || null;
}

// ============================================================================
// SKU VALIDATION
// ============================================================================

export function validateSku(baseSku) {
  const upper = baseSku.toUpperCase();

  // Check common mistakes first
  const mistake = fixCommonMistake(upper);
  if (mistake) {
    return { valid: false, reason: mistake.error, suggest: mistake.suggest, isCommonMistake: true };
  }

  // Check if it's a valid current SKU
  if (VALID_SKUS.has(upper)) {
    const eol = isEol(upper);
    return eol ? { valid: true, eol: true } : { valid: true };
  }

  // Check if it's a known EOL SKU (still valid, just EOL)
  if (isEol(upper)) return { valid: true, eol: true };

  // Accessories pass through
  if (/^MA-/.test(upper)) return { valid: true };

  // License SKUs pass through
  if (/^LIC-/.test(upper)) return { valid: true };

  // Try family-based matching
  const family = detectFamily(upper);
  if (family && catalog[family]) {
    // Partial string match
    const partialMatches = catalog[family].filter(s =>
      s.toUpperCase().includes(upper) || upper.includes(s.toUpperCase())
    );
    if (partialMatches.length > 0) {
      return {
        valid: false,
        reason: `${upper} is not a recognized model`,
        suggest: partialMatches,
        isPartialMatch: true,
      };
    }

    // Fuzzy match within family
    const fuzzyMatches = fuzzyMatchInFamily(upper, family);
    if (fuzzyMatches.length > 0) {
      return {
        valid: false,
        reason: `${upper} is not a recognized model`,
        suggest: fuzzyMatches.map(m => m.sku),
        isFuzzyMatch: true,
        closestDistance: fuzzyMatches[0].distance,
      };
    }

    // Fallback: show first 5 variants in family
    const suggestions = catalog[family].slice(0, 5);
    return { valid: false, reason: `${upper} is not a recognized model`, suggest: suggestions };
  }

  // Cross-family fuzzy match
  const crossMatches = fuzzyMatchAllFamilies(upper);
  if (crossMatches.length > 0) {
    return {
      valid: false,
      reason: `${upper} is not a recognized SKU`,
      suggest: crossMatches.map(m => m.sku),
      isFuzzyMatch: true,
    };
  }

  return { valid: false, reason: `${upper} is not a recognized SKU` };
}

// ============================================================================
// LICENSE SKU GENERATION
// ============================================================================

export function getLicenseSkus(baseSku, requestedTerm = null) {
  const upper = baseSku.toUpperCase();
  const terms = requestedTerm ? [String(requestedTerm)] : ['1', '3', '5'];

  let termSuffix = 'Y'; // Newer products

  // Older product families use YR
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

  const skus = [];

  // Catalyst C8/C9
  if (/^C[89]\d+/.test(upper)) {
    for (const term of terms) skus.push(`LIC-C9-${term}Y`);
    return skus;
  }

  // MS130 specific licenses
  if (/^MS130/.test(upper)) {
    for (const term of terms) skus.push(`LIC-MS130-${term}Y`);
    return skus;
  }

  // MS150 specific licenses
  if (/^MS150/.test(upper)) {
    for (const term of terms) skus.push(`LIC-MS150-${term}Y`);
    return skus;
  }

  // MS450 specific licenses
  if (/^MS450/.test(upper)) {
    for (const term of terms) skus.push(`LIC-MS450-${term}Y`);
    return skus;
  }

  // All others use LIC-ENT-
  for (const term of terms) skus.push(`LIC-ENT-${term}${termSuffix}`);
  return skus;
}

// ============================================================================
// PARSING
// ============================================================================

export function parseSkuInput(text) {
  const items = [];
  const upper = text.toUpperCase();

  // Detect modifiers
  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|WITHOUT\s+(A\s+)?LICENSE|NO\s+LICENSE|HW\s+ONLY)\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  if (/\b(LICENSE\s+ONLY|JUST\s+THE\s+LICENSE|NO\s+HARDWARE|RENEWAL\s+ONLY|LICENSE\s+RENEWAL|RENEW\s+(THE\s+)?LICENSES?)\b/.test(upper)) {
    modifiers.licenseOnly = true;
  }

  // Strip command words
  const cleaned = text
    .replace(/\b(quote|price|cost|how much|for|please|can you|get me|i need)\b/gi, '')
    .trim();

  const rawLines = cleaned.split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  // Strip bullet markers
  const lines = rawLines.map(l =>
    l.replace(/^[\s•\-\*·▸▹►‣⁃◦]+\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
  ).filter(Boolean);

  // Multi-line license list (CSV format)
  if (lines.length >= 2) {
    const licItems = [];
    for (const line of lines) {
      const csvMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*[,\s]\s*(\d+)\s*$/i);
      const qtyFirstMatch = !csvMatch && line.match(/^\s*(\d+)\s*[xX×]?\s*(LIC-[A-Z0-9-]+)\s*$/i);
      if (csvMatch) {
        licItems.push({ baseSku: csvMatch[1].toUpperCase(), qty: parseInt(csvMatch[2]) });
      } else if (qtyFirstMatch) {
        licItems.push({ baseSku: qtyFirstMatch[2].toUpperCase(), qty: parseInt(qtyFirstMatch[1]) });
      } else {
        const singleMatch = line.match(/^\s*(LIC-[A-Z0-9-]+)\s*$/i);
        if (singleMatch) licItems.push({ baseSku: singleMatch[1].toUpperCase(), qty: 1 });
      }
    }
    if (licItems.length >= 2) {
      return { items: licItems, modifiers: { ...modifiers, licenseOnly: true }, isLicenseList: true };
    }
  }

  // Multi-line bare model list
  if (lines.length >= 3) {
    const modelPattern = /^\s*((?:MR|MV|MT|MG|MX|CW9|MS|C9|C8|Z)\d[A-Z0-9-]*)\s*$/i;
    const modelLines = lines.filter(l => modelPattern.test(l));
    if (modelLines.length >= 3 && modelLines.length / lines.length >= 0.7) {
      const counts = new Map();
      for (const line of modelLines) {
        const m = line.match(modelPattern);
        if (m) {
          const sku = m[1].toUpperCase();
          counts.set(sku, (counts.get(sku) || 0) + 1);
        }
      }
      return {
        items: [...counts.entries()].map(([baseSku, qty]) => ({ baseSku, qty })),
        modifiers,
        isModelList: true,
      };
    }
  }

  // Standard parsing: extract SKUs with quantities from single or comma-separated input
  // Patterns: "10 MR44", "MR44 x10", "MR44 x 10", "MR44 10", "2x MR44 5x MS130-24P"
  // NOTE: SKU-first pattern requires whitespace OR explicit x/× to avoid treating model
  // digits as quantity (e.g. "MS150-24" must NOT parse as SKU="MS150-2", qty=4)
  const skuRegex = /(\d+)\s*[xX×]?\s*([A-Z][A-Z0-9](?:[A-Z0-9-]*[A-Z0-9]))|([A-Z][A-Z0-9](?:[A-Z0-9-]*[A-Z0-9]))(?:\s+[xX×]?\s*|\s*[xX×]\s*)(\d+)|([A-Z][A-Z0-9](?:[A-Z0-9-]*[A-Z0-9]))/gi;

  const joinedText = lines.join(', ');
  let match;
  while ((match = skuRegex.exec(joinedText)) !== null) {
    let baseSku, qty;
    if (match[1] && match[2]) {
      // qty-first: "10 MR44"
      qty = parseInt(match[1]);
      baseSku = match[2].toUpperCase();
    } else if (match[3] && match[4]) {
      // sku-first: "MR44 x10"
      baseSku = match[3].toUpperCase();
      qty = parseInt(match[4]);
    } else if (match[5]) {
      // bare SKU
      baseSku = match[5].toUpperCase();
      qty = 1;
    }

    if (baseSku && qty > 0) {
      // Filter out noise words that look like SKUs
      if (/^(QUOTE|PRICE|COST|FOR|PLEASE|CAN|YOU|GET|NEED|HARDWARE|LICENSE|ONLY|JUST|THE|WITH)$/.test(baseSku)) continue;
      // Must look like a product SKU (starts with known prefix or has digits)
      if (/^(MR|MV|MT|MG|MX|MS|CW|C8|C9|Z\d|LIC-|MA-)/.test(baseSku)) {
        items.push({ baseSku, qty });
      }
    }
  }

  return { items, modifiers };
}

// ============================================================================
// URL GENERATION
// ============================================================================

export function buildStratusUrl(items, modifiers = {}) {
  if (!items || items.length === 0) return null;

  const merged = new Map();

  for (const item of items) {
    const { baseSku, qty } = item;
    if (!baseSku) continue;
    const upper = baseSku.toUpperCase();
    const isLic = upper.startsWith('LIC-');

    // Hardware
    if (!modifiers.licenseOnly && !isLic) {
      const hwSku = applySuffix(baseSku);
      merged.set(hwSku, (merged.get(hwSku) || 0) + qty);
    }

    // Licenses
    if (!modifiers.hardwareOnly && !isLic) {
      const licSkus = getLicenseSkus(baseSku);
      for (const licSku of licSkus) {
        merged.set(licSku, (merged.get(licSku) || 0) + qty);
      }
    }

    // Direct license SKU
    if (isLic) {
      merged.set(upper, (merged.get(upper) || 0) + qty);
    }
  }

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

export function generateLocalQuote(text) {
  if (!text || text.trim().length === 0) {
    return { url: null, needsApi: true, error: 'No input provided' };
  }

  try {
    const parsed = parseSkuInput(text);
    const { items, modifiers } = parsed;

    if (!items || items.length === 0) {
      return { url: null, needsApi: true, error: 'No valid SKUs found in input' };
    }

    // Validate each SKU and collect results
    const validationResults = [];
    const validItems = [];
    const eolWarnings = [];
    const suggestions = [];
    let hasInvalid = false;

    for (const item of items) {
      const validation = validateSku(item.baseSku);

      if (!validation.valid) {
        hasInvalid = true;
        const suggestion = {
          input: item.baseSku,
          reason: validation.reason,
          suggest: validation.suggest || [],
          isCommonMistake: validation.isCommonMistake || false,
        };
        suggestions.push(suggestion);
        validationResults.push({ ...item, validation });
      } else {
        if (validation.eol) {
          const replacement = checkEol(item.baseSku);
          eolWarnings.push({
            sku: item.baseSku,
            replacement,
            isDualUplink: Array.isArray(replacement),
          });
        }
        validItems.push(item);
        validationResults.push({ ...item, validation });
      }
    }

    // If ALL items are invalid, return suggestions without URL
    if (validItems.length === 0 && suggestions.length > 0) {
      return {
        url: null,
        needsApi: false,
        error: null,
        parsed: validationResults,
        suggestions,
        eolWarnings: [],
      };
    }

    // Build URLs based on EOL analysis
    const urls = [];

    // Check if any EOL items have dual uplink replacements
    const hasDualUplink = eolWarnings.some(w => w.isDualUplink);
    const hasEol = eolWarnings.length > 0;
    const nonEolItems = validItems.filter(item => !isEol(item.baseSku));
    const eolItems = validItems.filter(item => isEol(item.baseSku));

    if (hasEol && eolItems.length > 0) {
      // Option 1: Renew existing licenses (license only for EOL hardware)
      const option1Items = [
        ...eolItems.map(item => ({ ...item })), // license-only for EOL
        ...nonEolItems.map(item => ({ ...item })),
      ];
      const option1Url = buildStratusUrl(
        eolItems.map(item => ({ baseSku: item.baseSku, qty: item.qty })),
        { licenseOnly: true }
      );
      if (option1Url) {
        // If there are non-EOL items too, combine
        let fullOption1 = option1Url;
        if (nonEolItems.length > 0) {
          const nonEolUrl = buildStratusUrl(nonEolItems, modifiers);
          // Merge URLs: just use the license-only for EOL + full for non-EOL
          fullOption1 = option1Url; // Simplified - just EOL licenses
        }
        urls.push({ url: fullOption1, label: 'Option 1: Renew Existing Licenses' });
      }

      if (hasDualUplink) {
        // Option 2: Hardware Refresh, 1G Uplink
        const opt2Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (Array.isArray(replacement)) {
            opt2Items.push({ baseSku: replacement[0], qty: item.qty }); // 4G variant
          } else if (replacement) {
            opt2Items.push({ baseSku: replacement, qty: item.qty });
          }
        }
        opt2Items.push(...nonEolItems);
        const opt2Url = buildStratusUrl(opt2Items, modifiers);
        if (opt2Url) urls.push({ url: opt2Url, label: 'Option 2: Hardware Refresh, 1G Uplink' });

        // Option 3: Hardware Refresh, 10G Uplink
        const opt3Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (Array.isArray(replacement)) {
            opt3Items.push({ baseSku: replacement[1], qty: item.qty }); // 4X variant
          } else if (replacement) {
            opt3Items.push({ baseSku: replacement, qty: item.qty });
          }
        }
        opt3Items.push(...nonEolItems);
        const opt3Url = buildStratusUrl(opt3Items, modifiers);
        if (opt3Url) urls.push({ url: opt3Url, label: 'Option 3: Hardware Refresh, 10G Uplink' });
      } else {
        // Option 2: Hardware Refresh (single replacement, no dual uplink)
        const opt2Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (replacement) {
            const target = Array.isArray(replacement) ? replacement[0] : replacement;
            opt2Items.push({ baseSku: target, qty: item.qty });
          }
        }
        opt2Items.push(...nonEolItems);
        const opt2Url = buildStratusUrl(opt2Items, modifiers);
        if (opt2Url) urls.push({ url: opt2Url, label: 'Option 2: Hardware Refresh' });
      }
    } else {
      // No EOL - just generate the standard URL
      const url = buildStratusUrl(validItems, modifiers);
      if (url) urls.push({ url, label: 'Quote' });
    }

    // Format EOL warnings as strings
    const eolWarningStrings = eolWarnings.map(w => {
      const rep = w.replacement;
      if (Array.isArray(rep)) {
        return `${w.sku} is End-of-Life → replaced by ${rep[0]} (1G) / ${rep[1]} (10G)`;
      }
      return `${w.sku} is End-of-Life` + (rep ? ` → replaced by ${rep}` : '');
    });

    return {
      urls,
      needsApi: false,
      error: null,
      parsed: validationResults,
      suggestions: suggestions.length > 0 ? suggestions : null,
      eolWarnings: eolWarningStrings,
      modifiers,
    };
  } catch (error) {
    console.error('Quote generation error:', error);
    return { url: null, needsApi: true, error: error.message };
  }
}
