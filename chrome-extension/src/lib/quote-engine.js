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
// PARSING — Ported from the proven Webex/GChat bot's parseMessage()
// Uses per-family SKU regex patterns with context-based quantity extraction
// ============================================================================

export function parseSkuInput(text) {
  const upper = text.toUpperCase();

  // ── Multi-line License SKU Input (CSV/list from dashboard export) ──
  const rawLines = text.trim().split(/[\n\r]+/).map(l => l.trim()).filter(Boolean);
  const lines = rawLines.map(l =>
    l.replace(/^[\s•\-\*·▸▹►‣⁃◦]+\s*/, '').replace(/^\d+[.)]\s*/, '').trim()
  ).filter(Boolean);

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
    // Dedup
    const seen = new Set();
    const deduped = [];
    for (const item of licItems) {
      if (!seen.has(item.baseSku)) { seen.add(item.baseSku); deduped.push(item); }
    }
    if (deduped.length >= 2) {
      return { items: deduped, modifiers: { hardwareOnly: false, licenseOnly: true }, isLicenseList: true };
    }
  }

  // ── Multi-line bare model list ──
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
      const nonModelLines = lines.filter(l => !modelPattern.test(l)).join(' ').toUpperCase();
      const isLicenseOnly = /\b(LICENSE|RENEWAL|RENEW|LIC)\b/.test(nonModelLines);
      return {
        items: [...counts.entries()].map(([baseSku, qty]) => ({ baseSku, qty })),
        modifiers: { hardwareOnly: false, licenseOnly: isLicenseOnly },
        isModelList: true,
      };
    }
  }

  // ── Direct License SKU Input (single line) ──
  const licDirectMatch = upper.match(/^\s*((?:LIC-[A-Z0-9-]+?)(?:\s+[X×]?\s*(\d+))?)\s*$/);
  if (licDirectMatch) {
    const fullInput = licDirectMatch[0].trim();
    const qtyAfter = fullInput.match(/\s+[X×]?\s*(\d+)\s*$/);
    let licSku = fullInput;
    let qty = 1;
    if (qtyAfter) {
      qty = parseInt(qtyAfter[1]);
      licSku = fullInput.slice(0, fullInput.length - qtyAfter[0].length).trim();
    }
    const qtyBefore = upper.match(/^\s*(\d+)\s*[X×]?\s*(LIC-[A-Z0-9-]+)\s*$/);
    if (qtyBefore) {
      qty = parseInt(qtyBefore[1]);
      licSku = qtyBefore[2];
    }
    if (licSku.startsWith('LIC-')) {
      return {
        items: [{ baseSku: licSku, qty }],
        modifiers: { hardwareOnly: false, licenseOnly: true },
        isDirectLicense: true,
      };
    }
  }

  // ── Detect modifiers ──
  const modifiers = { hardwareOnly: false, licenseOnly: false };
  if (/\b(HARDWARE\s+ONLY|HARDWARE|WITHOUT\s+(A\s+)?LICENSE|NO\s+LICENSE|JUST\s+THE\s+HARDWARE|HW\s+ONLY)\b/.test(upper)
      && !/\b(HARDWARE\s+(SPECS?|INFO|DETAILS?|QUESTION|ISSUE|PROBLEM|SUPPORT|FAILURE|WARRANTY))\b/.test(upper)) {
    modifiers.hardwareOnly = true;
  }
  if (/\b(LICENSE\s+ONLY|JUST\s+THE\s+LICENSE|JUST\s+LICENSE|LICENSE[S]?\s+ONLY|NO\s+HARDWARE|RENEWAL\s+ONLY|LICENSE\s+RENEWAL|RENEW\s+(THE\s+)?LICENSE[S]?|RENEWAL\s+FOR|RENEW\s+EXISTING)\b/.test(upper)) {
    modifiers.licenseOnly = true;
  }

  // ── Per-family SKU patterns (from bot's parseMessage) ──
  // Order matters: longer/more specific patterns first to prevent partial matches
  const skuPatterns = [
    /C9[23]\d{2}[LX]?-[\dA-Z]+-[\dA-Z]+-M(?:-O)?/gi,  // Catalyst 9000 (C9300-48UXM-M etc)
    /C8[14]\d{2}-G2-MX/gi,                               // Catalyst 8000
    /MA-[A-Z0-9-]+/gi,                                    // Accessories
    /LIC-[A-Z0-9-]+/gi,                                   // License SKUs (direct input in mixed text)
    /CW9\d{3}[A-Z0-9]*/gi,                               // CW Wi-Fi (CW9166I, CW9172H)
    /MS150-[\dA-Z]+-[\dA-Z]+/gi,                          // MS150 (MS150-48FP-4G)
    /MS450-\d+/gi,                                        // MS450
    /MS[12345]\d{2}R?-[\dA-Z]+(?:-RF)?/gi,               // All MS switches
    /(?:MR|MV|MT|MG)\d+[A-Z]?(?![A-Z])/gi,              // MR/MV/MT/MG (MR44, MV72, MT30)
    /MX\d+[A-Z]*(?:-NA)?/gi,                             // MX series (MX67, MX68C, MX67C-HW-NA)
    /Z\d+[A-Z]*/gi,                                       // Z-series (Z4, Z4X, Z4CX)
  ];

  const joinedUpper = lines.join(' ').toUpperCase();
  const rawMatches = [];
  const matched = new Set();

  for (const pattern of skuPatterns) {
    pattern.lastIndex = 0; // Reset regex state
    let match;
    while ((match = pattern.exec(joinedUpper)) !== null) {
      let sku = match[0];
      const pos = match.index;

      // Strip trailing 'S' (pluralization) if the stripped version is valid but full isn't
      if (sku.endsWith('S') && sku.length > 3) {
        const stripped = sku.slice(0, -1);
        const strippedValid = VALID_SKUS.has(stripped) || detectFamily(stripped) !== null;
        const fullValid = VALID_SKUS.has(sku);
        if (strippedValid && !fullValid) sku = stripped;
      }

      if (matched.has(sku)) continue;
      matched.add(sku);

      // ── Context-based quantity extraction (from bot) ──
      // Look at 20 chars before and 15 chars after the match
      const before = joinedUpper.slice(Math.max(0, pos - 20), pos);
      const after = joinedUpper.slice(pos + match[0].length, pos + match[0].length + 15);
      let qty = 1;
      const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*$/);
      const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9]|[A-Z]*-)/i);
      // Prefer afterQty for inline format (SKU1 qty1 SKU2 qty2...)
      if (afterQty) qty = parseInt(afterQty[1]);
      else if (beforeQty) qty = parseInt(beforeQty[1]);

      rawMatches.push({ baseSku: sku, qty, position: pos });
    }
  }

  // ── Overlap filtering: remove shorter matches contained within longer ones ──
  const foundItems = rawMatches.filter((item, idx) => {
    return !rawMatches.some((other, otherIdx) => {
      if (idx === otherIdx) return false;
      return other.baseSku.length > item.baseSku.length && other.baseSku.includes(item.baseSku);
    });
  });

  // Sort by position in original text
  foundItems.sort((a, b) => a.position - b.position);
  const items = foundItems.map(({ baseSku, qty }) => ({ baseSku, qty }));

  // ── Model-agnostic family detection ──
  // If no items found but text contains bare family names (MR, MV, MX, etc.),
  // return empty items with suggestions for popular models
  if (items.length === 0) {
    const FAMILY_SUGGESTIONS = {
      'MR': ['MR44', 'MR46', 'MR57', 'MR28', 'MR36'],
      'MV': ['MV13', 'MV22X', 'MV32', 'MV52', 'MV72X'],
      'MX': ['MX67', 'MX67W', 'MX68', 'MX75', 'MX85'],
      'MT': ['MT10', 'MT12', 'MT14', 'MT15', 'MT20'],
      'MG': ['MG41', 'MG41E', 'MG52', 'MG52E'],
      'MS': ['MS130-24P', 'MS130-48P', 'MS150-48FP-4G', 'MS150-24P-4X'],
      'CW': ['CW9172I', 'CW9166I', 'CW9174I', 'CW9176I', 'CW9178I'],
    };
    const familyMatch = upper.match(/\b(MR|MV|MX|MT|MG|MS|CW)\b/);
    if (familyMatch) {
      const family = familyMatch[1];
      const suggestions = FAMILY_SUGGESTIONS[family];
      if (suggestions) {
        // Extract quantity if present (e.g., "10 MR" or "quote 5 MV")
        const qtyMatch = upper.match(/(\d+)\s*[X×]?\s*(?:MR|MV|MX|MT|MG|MS|CW)\b/);
        const qty = qtyMatch ? parseInt(qtyMatch[1]) : 1;
        return {
          items: [],
          modifiers,
          familySuggestions: { family, suggestions, qty },
        };
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
  const term = modifiers.term || null; // Optional: '1', '3', or '5' for single-term URLs

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

    // Licenses — single term if specified, all terms otherwise
    if (!modifiers.hardwareOnly && !isLic) {
      const licSkus = getLicenseSkus(baseSku, term);
      for (const licSku of licSkus) {
        merged.set(licSku, (merged.get(licSku) || 0) + qty);
      }
    }

    // Direct license SKU
    if (isLic) {
      merged.set(upper, (merged.get(upper) || 0) + qty);
    }
  }

  if (merged.size === 0) return null;

  // Sort by product family group — hardware before licenses within each group
  // (Ported from bot's buildStratusUrl)
  const _skuSortKey = (sku) => {
    const u = sku.toUpperCase();
    const isLicense = u.startsWith('LIC-');
    let familyOrder;
    if (/^(MR\d|CW9|LIC-ENT|LIC-CW)/.test(u)) familyOrder = '1-AP';
    else if (/^(MS\d|LIC-MS)/.test(u)) familyOrder = '2-SW';
    else if (/^(C9\d|LIC-C9)/.test(u)) familyOrder = '3-CAT';
    else if (/^(MX\d|LIC-MX|Z\d|LIC-Z)/.test(u)) familyOrder = '4-SEC';
    else if (/^(MV\d|LIC-MV)/.test(u)) familyOrder = '5-CAM';
    else if (/^(MT\d|LIC-MT)/.test(u)) familyOrder = '6-SENS';
    else if (/^(MG\d|LIC-MG)/.test(u)) familyOrder = '7-CELL';
    else if (/^(MA-SFP|STACK)/.test(u)) familyOrder = '8-ACC';
    else familyOrder = '9-OTHER';
    return `${familyOrder}-${isLicense ? '1' : '0'}-${u}`;
  };

  const sortedSkus = [...merged.keys()].sort((a, b) => _skuSortKey(a).localeCompare(_skuSortKey(b)));
  const qtys = sortedSkus.map(s => merged.get(s));

  // Manual URL construction — NO URLSearchParams (which encodes commas as %2C)
  return `https://stratusinfosystems.com/order/?item=${sortedSkus.join(',')}&qty=${qtys.join(',')}`;
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
      // Check for model-agnostic family suggestions (e.g., "quote MR" → suggest MR44, MR46, etc.)
      if (parsed.familySuggestions) {
        const fs = parsed.familySuggestions;
        return {
          urls: [],
          needsApi: false,
          error: null,
          parsed: [],
          suggestions: [{
            input: fs.family,
            reason: `Which ${fs.family} model do you need?`,
            suggest: fs.suggestions,
            isCommonMistake: false,
            qty: fs.qty,
          }],
          eolWarnings: [],
        };
      }
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

    // Term labels for per-term URL generation (matches bot behavior)
    const termLabels = { '1': '1-Year Co-Term', '3': '3-Year Co-Term', '5': '5-Year Co-Term' };
    const terms = ['1', '3', '5'];

    if (hasEol && eolItems.length > 0) {
      // Option 1: Renew existing licenses (per-term URLs)
      const opt1Items = [
        ...eolItems.map(item => ({ baseSku: item.baseSku, qty: item.qty })),
        ...nonEolItems.map(item => ({ baseSku: item.baseSku, qty: item.qty })),
      ];
      for (const term of terms) {
        const url = buildStratusUrl(opt1Items, { ...modifiers, licenseOnly: true, term });
        if (url) urls.push({ url, label: `Option 1: Renew Existing (${termLabels[term]})` });
      }

      if (hasDualUplink) {
        // Option 2: Hardware Refresh, 1G Uplink (per-term URLs)
        const opt2Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (Array.isArray(replacement)) {
            opt2Items.push({ baseSku: replacement[0], qty: item.qty });
          } else if (replacement) {
            opt2Items.push({ baseSku: replacement, qty: item.qty });
          }
        }
        opt2Items.push(...nonEolItems);
        for (const term of terms) {
          const url = buildStratusUrl(opt2Items, { ...modifiers, term });
          if (url) urls.push({ url, label: `Option 2: 1G Refresh (${termLabels[term]})` });
        }

        // Option 3: Hardware Refresh, 10G Uplink (per-term URLs)
        const opt3Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (Array.isArray(replacement)) {
            opt3Items.push({ baseSku: replacement[1], qty: item.qty });
          } else if (replacement) {
            opt3Items.push({ baseSku: replacement, qty: item.qty });
          }
        }
        opt3Items.push(...nonEolItems);
        for (const term of terms) {
          const url = buildStratusUrl(opt3Items, { ...modifiers, term });
          if (url) urls.push({ url, label: `Option 3: 10G Refresh (${termLabels[term]})` });
        }
      } else {
        // Option 2: Hardware Refresh (per-term URLs)
        const opt2Items = [];
        for (const item of eolItems) {
          const replacement = checkEol(item.baseSku);
          if (replacement) {
            const target = Array.isArray(replacement) ? replacement[0] : replacement;
            opt2Items.push({ baseSku: target, qty: item.qty });
          }
        }
        opt2Items.push(...nonEolItems);
        for (const term of terms) {
          const url = buildStratusUrl(opt2Items, { ...modifiers, term });
          if (url) urls.push({ url, label: `Option 2: Hardware Refresh (${termLabels[term]})` });
        }
      }
    } else {
      // No EOL — generate 3 separate per-term URLs (matches bot behavior)
      if (modifiers.hardwareOnly) {
        // Hardware only = single URL, no license terms
        const url = buildStratusUrl(validItems, modifiers);
        if (url) urls.push({ url, label: 'Hardware Only' });
      } else {
        for (const term of terms) {
          const url = buildStratusUrl(validItems, { ...modifiers, term });
          if (url) urls.push({ url, label: termLabels[term] });
        }
      }
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
