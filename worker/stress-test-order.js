#!/usr/bin/env node
/**
 * A/B Test: Step Order Comparison
 *
 * Architecture A (CURRENT): Pre-checks → CF classifier → Deterministic → Claude
 * Architecture B (PROPOSED): CF classifier → Pre-checks → Deterministic → Claude
 *
 * The question: Should CF classify intent FIRST before any deterministic
 * pre-checks run? This tests whether the pricing/EOL/confirmation pre-checks
 * cause false positives that CF would have correctly routed elsewhere.
 *
 * Key concern: The pricing pre-check regex matches "how much" which could
 * intercept product_info questions like "how much power does MT14 need"
 * before CF ever sees them.
 */

// ── EOL pre-check simulation ──
// Matches: "end of life", "EOL", "EOS", "when does X go EOL", etc.
function wouldEolPreCheckFire(input) {
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(input);
  const hasSkuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/i.test(input);
  return eolIntent && hasSkuPattern;
}

// ── Pricing pre-check simulation ──
// Matches: "cost", "price", "pricing", "how much", "total", etc.
// PLUS requires a SKU pattern nearby in a pricing-specific format
function wouldPricingPreCheckFire(input) {
  const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?|CART TOTAL|BREAKDOWN|ESTIMATE|INCLUDE\s+(COST|COSTS|PRICE|PRICES|PRICING)|WITH\s+(COST|COSTS|PRICE|PRICES|PRICING))\b/i.test(input);
  if (!pricingIntent) return false;

  // Bail out on competitive analysis / vague category phrases — these need CF classification
  if (/\b(total cost of ownership|TCO|vs\s+\w+|versus|compared?\s+to|ROI)\b/i.test(input)) return false;
  if (/\b(pricing for|how much for|cost of)\s+(meraki|cisco|switches|aps?|access points?|cameras?|sensors?|firewalls?|routers?|networking)\s*$/i.test(input)) return false;

  // Duo/Umbrella natural language pricing
  if (/\b(?:DUO|CISCO\s*DUO|UMBRELLA)\b/i.test(input)) return true;

  // Direct SKU pricing: "cost of 2x MS150-48FP" or "price of MR44"
  const directSkuMatch = input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for))?\s+(\d+)\s*x?\s+([A-Z0-9][-A-Z0-9]+)/i);
  if (directSkuMatch) return true;

  // Single SKU pricing: "how much is MR46", "price of MX67"
  const singleSkuMatch = input.match(/(?:cost|price|pricing|how much)(?:\s+(?:of|for|is|does))?\s+(?:an?\s+)?([A-Z0-9][-A-Z0-9]+)/i);
  if (singleSkuMatch) {
    const sku = singleSkuMatch[1];
    // Filter common false positives and non-SKU words
    // Real Cisco SKUs always contain a digit (MR46, CW9164, MS130-24P) or start with LIC-
    if (!/^(OPTION|THE|THIS|THAT|MY|IT|A|AN|POWER|BANDWIDTH|SPACE|WEIGHT|TIME|STORAGE|MEMORY|DATA|TRAFFIC|ENERGY|POE|COVERAGE|CAPACITY)$/i.test(sku) && (/\d/.test(sku) || /^LIC-/i.test(sku))) {
      return true;
    }
  }

  // Reverse pattern: "what does MR46 cost"
  const reverseMatch = input.match(/(?:what|how)\s+(?:does|do|is|would)\s+(?:an?\s+)?(?:the\s+)?(\d+\s+)?([A-Z0-9][-A-Z0-9]+)\s+(?:cost|run|go for|price)/i);
  if (reverseMatch && !/^(OPTION|THE|THIS|THAT|MY|IT|A|AN)$/i.test(reverseMatch[2]) && (/\d/.test(reverseMatch[2]) || /^LIC-/i.test(reverseMatch[2]))) return true;

  // Option/term references (history-dependent, needs KV — always fires on "cost of option 2")
  if (/\bOPTION\s+\d/i.test(input)) return true;
  if (/\b\d\s*-?\s*YEAR/i.test(input) && pricingIntent) return true;

  return false;
}

// ── Quote confirmation pre-check simulation ──
// Matches: "yes", "yeah", "go ahead", "quote it", etc. (only with conversation history)
function wouldConfirmPreCheckFire(input) {
  return /^\s*(yes|yeah|yep|yea|sure|please|go ahead|do it|quote it|generate (a |the )?quote|yes.*quote|please.*quote|let'?s do it|go for it)\s*[.!]?\s*$/i.test(input);
}

// ── CF classifier simulation (with our new rules) ──
function simulateCFClassification(input) {
  const upper = input.toUpperCase();
  const hasSkuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/i.test(input);

  // Conversation
  const isConversation = /^(hello|hi|hey|thanks|thank you|bye|goodbye|lol|ok|nice|cool|good morning|good afternoon|what can you do|who are you|\?|!|yes|yeah|yep|sure|please|go ahead|do it|let's do it|go for it)$/i.test(input.trim());
  if (isConversation) return 'conversation';

  // Escalate
  if (/\b(proposal|design a network|deployment (plan|timeline)|compare .+ vs .+ for (our|the)|total cost of ownership|TCO)\b/i.test(input)) return 'escalate';

  // Vague/clarify
  const isVague = /^(I need (some|a) (access points|switches|firewall|cameras?|sensors?)|quote me some|pricing for (Meraki|cisco)|how much for a (camera|switch|firewall|AP)|I need a firewall|quote switches for|price$|what do you recommend|we need networking|give me options|best AP for|can you help me figure out how many)/i.test(input.trim());
  if (isVague && !hasSkuPattern) return 'clarify';

  // Product info signals
  const isProductInfo = /\b(COMPARE|VS|VERSUS|DIFFERENCE|BETWEEN|SPECS?|FEATURES?|CAPABILITIES|SUPPORT|INDOOR|OUTDOOR|WEATHERPROOF|THROUGHPUT|RANGE|STACK|POE|UPLINK|MOUNT|POWER|SSID|BROADCAST|NIGHT VISION|USER LIMIT|TRI.?BAND|QUAD.?BAND|WARRANTY|HUMIDITY|5G|LAYER 3|VPN|CONTENT FILTER|SD.?WAN|WIFI.?[67E]|FREQUENCY|DATASHEET|REPLACEMENT|UPGRADE|INCLUDED|NEW WITH|FASTEST|CHEAPEST)\b/i.test(input);
  const isQuestionAboutProduct = /\b(WHAT'?S|IS THE|IS IT|CAN THE|CAN I|DOES THE|DOES IT|HOW DOES|HOW MANY|HOW MUCH .+ (NEED|REQUIRE|DRAW|USE|CONSUME|WEIGH|HANDLE|SUPPORT)|TELL ME ABOUT|WHAT KIND|DO I NEED|SHOULD I|WOULD|WHICH|IS .+ ENOUGH|OVERKILL|WORTH|BETTER|GOOD ENOUGH|RECOMMEND)\b/i.test(input);

  if (hasSkuPattern && (isProductInfo || isQuestionAboutProduct) && !(/\b(QUOTE|ORDER|BUY|PURCHASE)\b/i.test(input)) && !(/\b\d+\s*(x\s*)?(?:MR|MX|MV|MG|MS|MT|CW|Z)\d/i.test(input))) {
    return 'product_info';
  }

  // Quote signals (including new rules: hardware only, license only, renewal, bare SKU)
  if (hasSkuPattern) {
    const hasQuantity = /\b\d+\s*(x\s*)?(?:MR|MX|MV|MG|MS|MT|CW|Z)\d/i.test(input);
    const hasQuoteKeyword = /\b(QUOTE|ORDER|BUY|PURCHASE|NEED|GET|WANT|PLEASE)\b/i.test(input);
    const hasLicenseSku = /\bLIC-/i.test(input);
    const isBareSkuOnly = /^\s*(?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*\s*$/i.test(input.trim());
    const hasHardwareQualifier = /\b(HARDWARE ONLY|HW ONLY|NO LICENSE|HARDWARE NO LICENSE)\b/i.test(input);
    const hasLicenseQualifier = /\b(LICENSE ONLY|LICENSES ONLY|JUST THE LICENSE|RENEWAL ONLY|ADD-?ON|CO-?TERM|COTERM)\b/i.test(input);
    const hasRenewalRefresh = /\b(RENEW|REFRESH|REPLACE)\b/i.test(input);
    const hasPricingKeyword = /\b(COSTS?|PRICES?|PRICING|HOW MUCH)\b/i.test(input);

    if (hasQuantity || hasQuoteKeyword || hasLicenseSku || isBareSkuOnly ||
        hasHardwareQualifier || hasLicenseQualifier || hasRenewalRefresh || hasPricingKeyword) {
      return 'quote';
    }

    return 'product_info';
  }

  // Pricing without SKU
  if (/\b(QUOTE|PRICING|PRICE|HOW MUCH)\b/i.test(input)) return 'clarify';

  return 'conversation';
}

// ── Architecture A: Current order (Pre-checks → CF → Deterministic → Claude) ──
function routeArchA(input, expected) {
  // Step 0: Pre-checks
  if (wouldEolPreCheckFire(input)) {
    return { route: 'precheck-eol', wouldQuote: false, handler: 'deterministic-eol' };
  }
  if (wouldConfirmPreCheckFire(input)) {
    return { route: 'precheck-confirm', wouldQuote: true, handler: 'deterministic-confirm' };
  }
  if (wouldPricingPreCheckFire(input)) {
    return { route: 'precheck-pricing', wouldQuote: true, handler: 'deterministic-pricing' };
  }

  // Step 1: CF classifier
  const intent = simulateCFClassification(input);
  if (intent === 'conversation') return { route: 'cf-conversation', wouldQuote: false, handler: 'cf' };
  if (intent === 'clarify') return { route: 'cf-clarify', wouldQuote: false, handler: 'cf' };
  if (intent === 'product_info') return { route: 'cf-product-info', wouldQuote: false, handler: 'claude' };
  if (intent === 'escalate') return { route: 'cf-escalate', wouldQuote: false, handler: 'claude' };
  if (intent === 'quote') return { route: 'cf-deterministic', wouldQuote: true, handler: 'deterministic' };

  return { route: 'claude-fallback', wouldQuote: false, handler: 'claude' };
}

// ── Architecture B: Proposed order (CF → Pre-checks → Deterministic → Claude) ──
function routeArchB(input, expected) {
  // Step 0: CF classifier FIRST
  const intent = simulateCFClassification(input);

  // CF handles these directly — pre-checks never run
  if (intent === 'conversation') return { route: 'cf-conversation', wouldQuote: false, handler: 'cf' };
  if (intent === 'clarify') return { route: 'cf-clarify', wouldQuote: false, handler: 'cf' };
  if (intent === 'product_info') return { route: 'cf-product-info', wouldQuote: false, handler: 'claude' };
  if (intent === 'escalate') return { route: 'cf-escalate', wouldQuote: false, handler: 'claude' };

  // CF says "quote" — now run pre-checks for optimized handling before full deterministic engine
  if (intent === 'quote') {
    if (wouldEolPreCheckFire(input)) {
      return { route: 'cf-then-eol', wouldQuote: false, handler: 'deterministic-eol' };
    }
    if (wouldConfirmPreCheckFire(input)) {
      return { route: 'cf-then-confirm', wouldQuote: true, handler: 'deterministic-confirm' };
    }
    if (wouldPricingPreCheckFire(input)) {
      return { route: 'cf-then-pricing', wouldQuote: true, handler: 'deterministic-pricing' };
    }
    return { route: 'cf-deterministic', wouldQuote: true, handler: 'deterministic' };
  }

  return { route: 'claude-fallback', wouldQuote: false, handler: 'claude' };
}

// ── Test Cases: 100 inputs with expected correct behavior ──
const TEST_CASES = [
  // ═══ CLEAR QUOTE REQUESTS (should produce a quote) ═══
  { input: "quote 10 MR46", expected: "quote", id: 1 },
  { input: "5 MS130-24P", expected: "quote", id: 2 },
  { input: "I need 3 MX67", expected: "quote", id: 3 },
  { input: "price on 20 CW9164", expected: "quote", id: 4 },
  { input: "quote me 2 MR57 and 1 MX75", expected: "quote", id: 5 },
  { input: "can I get 10 MR28 hardware only", expected: "quote", id: 6 },
  { input: "need pricing for 50 LIC-ENT-3YR", expected: "quote", id: 7 },
  { input: "quote 1 MS390-48UX2", expected: "quote", id: 8 },
  { input: "4 MT14 sensors", expected: "quote", id: 9 },
  { input: "2 Z4 and 3 MG51", expected: "quote", id: 10 },
  { input: "15 MR46 with 5 year license", expected: "quote", id: 11 },
  { input: "get me a quote for 8 CW9166", expected: "quote", id: 12 },
  { input: "MX85 hardware only no license", expected: "quote", id: 13 },
  { input: "pricing for 100 MR44", expected: "quote", id: 14 },
  { input: "1 MV32", expected: "quote", id: 15 },
  { input: "LIC-ENT-5YR x 30", expected: "quote", id: 16 },
  { input: "3yr license for 10 MR46", expected: "quote", id: 17 },
  { input: "MR46 license only", expected: "quote", id: 18 },
  { input: "coterm renewal MR57", expected: "quote", id: 19 },
  { input: "replace MV22 with MV23M", expected: "quote", id: 20 },

  // ═══ PRICING QUESTIONS (should return price breakdown, not a quote URL) ═══
  // These hit the pricing pre-check. Both architectures should handle them.
  { input: "how much is MR46", expected: "pricing", id: 21 },
  { input: "cost of 5 MR46", expected: "pricing", id: 22 },
  { input: "what's the price of MX67", expected: "pricing", id: 23 },
  { input: "pricing for CW9164", expected: "pricing", id: 24 },  // could be quote or pricing
  { input: "how much does MX85 cost", expected: "pricing", id: 25 },
  { input: "cost of option 2", expected: "pricing", id: 26 },
  { input: "what's the price of the 3-year", expected: "pricing", id: 27 },
  { input: "cost of Duo Advantage for 50 users", expected: "pricing", id: 28 },
  { input: "price of 10 Umbrella DNS Essentials", expected: "pricing", id: 29 },
  { input: "how much for 20 MS225-24P", expected: "pricing", id: 30 },

  // ═══ PRODUCT INFO (should NOT quote and NOT price — go to Claude) ═══
  // These are the CRITICAL false-positive tests for the pricing pre-check
  { input: "how much power does MT14 sensor need", expected: "product_info", id: 31 },
  { input: "how much PoE does MS390-24UX deliver", expected: "product_info", id: 32 },
  { input: "how much bandwidth does MX67 handle", expected: "product_info", id: 33 },
  { input: "how much coverage does MR46 provide", expected: "product_info", id: 34 },
  { input: "how much weight can the MV72 mount handle", expected: "product_info", id: 35 },
  { input: "how much storage does MV32 have", expected: "product_info", id: 36 },
  { input: "how much data can MG51 transfer per month", expected: "product_info", id: 37 },
  { input: "is the MX75 good enough for 300 users", expected: "product_info", id: 38 },
  { input: "does the CW9166 support WiFi 7", expected: "product_info", id: 39 },
  { input: "what's the range on an MR57", expected: "product_info", id: 40 },
  { input: "is MR46 indoor or outdoor", expected: "product_info", id: 41 },
  { input: "can the MS225-24P do layer 3 routing", expected: "product_info", id: 42 },
  { input: "compare MR46 vs CW9164", expected: "product_info", id: 43 },
  { input: "what frequency bands does CW9164 use", expected: "product_info", id: 44 },
  { input: "is MR44 worth buying or should I get CW9164", expected: "product_info", id: 45 },
  { input: "does MS130-8P have SFP uplinks", expected: "product_info", id: 46 },
  { input: "can MX67 do content filtering", expected: "product_info", id: 47 },
  { input: "what's max throughput on MX250", expected: "product_info", id: 48 },
  { input: "is MV22 weatherproof", expected: "product_info", id: 49 },
  { input: "do I need a license for MT sensors", expected: "product_info", id: 50 },
  { input: "can I stack MS225 switches", expected: "product_info", id: 51 },
  { input: "does MX67 support site-to-site VPN", expected: "product_info", id: 52 },
  { input: "what's the difference between MR46 and MR57", expected: "product_info", id: 53 },
  { input: "which MX supports SD-WAN", expected: "product_info", id: 54 },
  { input: "how many SSIDs can MR46 broadcast", expected: "product_info", id: 55 },
  { input: "does MV72 have night vision", expected: "product_info", id: 56 },
  { input: "what's the user limit on MX95", expected: "product_info", id: 57 },
  { input: "MX85 vs MX95 which is better for us", expected: "product_info", id: 58 },
  { input: "what's the warranty on MR46", expected: "product_info", id: 59 },
  { input: "can MT20 detect humidity", expected: "product_info", id: 60 },
  { input: "does MG51 support 5G", expected: "product_info", id: 61 },
  { input: "tell me about the MR46", expected: "product_info", id: 62 },
  { input: "specs on the MX85", expected: "product_info", id: 63 },
  { input: "features of CW9164", expected: "product_info", id: 64 },
  { input: "MR46 datasheet", expected: "product_info", id: 65 },
  { input: "is MR57 overkill for a small office", expected: "product_info", id: 66 },
  { input: "what kind of license do I need for MR46", expected: "product_info", id: 67 },
  { input: "should I upgrade from MR42 to CW9164", expected: "product_info", id: 68 },
  { input: "when should I renew my MR46 licenses", expected: "product_info", id: 69 },
  { input: "what's the renewal process for Meraki", expected: "product_info", id: 70 },

  // ═══ EOL DATE QUESTIONS (should give dates, not a quote) ═══
  { input: "when does MR44 go EOL", expected: "eol_date", id: 71 },
  { input: "MR42 end of life date", expected: "eol_date", id: 72 },
  { input: "when is MV22 end of support", expected: "eol_date", id: 73 },
  { input: "MS225-24P EOL timeline", expected: "eol_date", id: 74 },
  { input: "is MR33 discontinued", expected: "eol_date", id: 75 },
  { input: "when does MX64 end of sale", expected: "eol_date", id: 76 },
  { input: "MR44 last day of support", expected: "eol_date", id: 77 },
  { input: "lifecycle status of MV12", expected: "eol_date", id: 78 },
  { input: "is MR42 end of life", expected: "eol_date", id: 79 },
  { input: "when was MR33 discontinued", expected: "eol_date", id: 80 },

  // ═══ CONVERSATION (no product intent) ═══
  { input: "hello", expected: "conversation", id: 81 },
  { input: "thanks!", expected: "conversation", id: 82 },
  { input: "who are you?", expected: "conversation", id: 83 },
  { input: "good morning", expected: "conversation", id: 84 },
  { input: "lol", expected: "conversation", id: 85 },
  { input: "what can you do?", expected: "conversation", id: 86 },
  { input: "bye", expected: "conversation", id: 87 },
  { input: "?", expected: "conversation", id: 88 },
  { input: "ok cool", expected: "conversation", id: 89 },
  { input: "nice", expected: "conversation", id: 90 },

  // ═══ CLARIFY (vague, needs more info) ═══
  { input: "I need some access points", expected: "clarify", id: 91 },
  { input: "quote me some switches", expected: "clarify", id: 92 },
  { input: "pricing for Meraki", expected: "clarify", id: 93 },
  { input: "how much for a camera", expected: "clarify", id: 94 },
  { input: "I need a firewall", expected: "clarify", id: 95 },

  // ═══ ESCALATE (complex, needs Claude) ═══
  { input: "write a proposal for a full network refresh at a 500-person school", expected: "escalate", id: 96 },
  { input: "design a network for a 3-building campus", expected: "escalate", id: 97 },
  { input: "compare Meraki vs Aruba for our enterprise", expected: "escalate", id: 98 },
  { input: "total cost of ownership for Meraki vs Fortinet over 5 years", expected: "escalate", id: 99 },
  { input: "help me plan a deployment timeline for 50 sites", expected: "escalate", id: 100 },
];

// ── Determine if routing decision is correct ──
function isCorrect(result, expected) {
  switch (expected) {
    case 'quote':
      return result.wouldQuote === true;
    case 'pricing':
      // Pricing is "correct" if it hits the pricing pre-check OR produces a quote (both acceptable)
      return result.route.includes('pricing') || result.wouldQuote === true;
    case 'product_info':
      return result.wouldQuote === false && !result.route.includes('pricing');
    case 'eol_date':
      return result.route.includes('eol');
    case 'conversation':
      return result.route.includes('conversation');
    case 'clarify':
      return result.route.includes('clarify');
    case 'escalate':
      return result.route.includes('escalate');
    default:
      return false;
  }
}

// ── Run Tests ──
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  STEP ORDER A/B TEST');
console.log('  Arch A (CURRENT): Pre-checks → CF → Deterministic → Claude');
console.log('  Arch B (PROPOSED): CF → Pre-checks → Deterministic → Claude');
console.log(`  ${TEST_CASES.length} test inputs × 2 architectures`);
console.log('═══════════════════════════════════════════════════════════════════════\n');

const results = {
  archA: { correct: 0, incorrect: 0, details: [] },
  archB: { correct: 0, incorrect: 0, details: [] },
  disagreements: [],
  precheckInterceptions: [],
};

for (const tc of TEST_CASES) {
  const a = routeArchA(tc.input, tc.expected);
  const b = routeArchB(tc.input, tc.expected);

  const aCorrect = isCorrect(a, tc.expected);
  const bCorrect = isCorrect(b, tc.expected);

  if (aCorrect) results.archA.correct++; else { results.archA.incorrect++; results.archA.details.push({ id: tc.id, input: tc.input, expected: tc.expected, got: a }); }
  if (bCorrect) results.archB.correct++; else { results.archB.incorrect++; results.archB.details.push({ id: tc.id, input: tc.input, expected: tc.expected, got: b }); }

  if (a.route !== b.route) {
    results.disagreements.push({
      id: tc.id,
      input: tc.input,
      expected: tc.expected,
      archA: { route: a.route, correct: aCorrect },
      archB: { route: b.route, correct: bCorrect },
    });
  }

  // Track cases where a pre-check intercepted before CF in Arch A
  if (a.route.startsWith('precheck-') && !b.route.startsWith('precheck-')) {
    results.precheckInterceptions.push({
      id: tc.id,
      input: tc.input,
      expected: tc.expected,
      archA_route: a.route,
      archA_correct: aCorrect,
      archB_route: b.route,
      archB_correct: bCorrect,
    });
  }
}

// ── Print Results ──
console.log('┌─────────────────────────────────────────────────────────────────────┐');
console.log('│                      ARCHITECTURE COMPARISON                         │');
console.log('├─────────────────────────────────────────────────────────────────────┤');
console.log(`│  A: Pre-checks → CF (Current)  │  B: CF → Pre-checks (Proposed)    │`);
console.log(`│  Correct:   ${String(results.archA.correct).padStart(3)}/${TEST_CASES.length}              │  Correct:   ${String(results.archB.correct).padStart(3)}/${TEST_CASES.length}                  │`);
console.log(`│  Incorrect: ${String(results.archA.incorrect).padStart(3)}/${TEST_CASES.length}              │  Incorrect: ${String(results.archB.incorrect).padStart(3)}/${TEST_CASES.length}                  │`);
console.log(`│  Accuracy:  ${((results.archA.correct / TEST_CASES.length) * 100).toFixed(1)}%              │  Accuracy:  ${((results.archB.correct / TEST_CASES.length) * 100).toFixed(1)}%                  │`);
console.log('└─────────────────────────────────────────────────────────────────────┘');

// Category breakdown
console.log('\n─── CATEGORY BREAKDOWN ─────────────────────────────────────────────');
const categories = {};
for (const tc of TEST_CASES) {
  if (!categories[tc.expected]) categories[tc.expected] = { total: 0, aCorrect: 0, bCorrect: 0 };
  categories[tc.expected].total++;
  if (isCorrect(routeArchA(tc.input, tc.expected), tc.expected)) categories[tc.expected].aCorrect++;
  if (isCorrect(routeArchB(tc.input, tc.expected), tc.expected)) categories[tc.expected].bCorrect++;
}
console.log(`${'Category'.padEnd(16)} ${'Count'.padEnd(8)} ${'A: Pre→CF'.padEnd(20)} ${'B: CF→Pre'.padEnd(20)}`);
console.log('─'.repeat(65));
for (const [cat, data] of Object.entries(categories)) {
  const aPct = ((data.aCorrect / data.total) * 100).toFixed(0);
  const bPct = ((data.bCorrect / data.total) * 100).toFixed(0);
  console.log(`${cat.padEnd(16)} ${String(data.total).padEnd(8)} ${`${data.aCorrect}/${data.total} (${aPct}%)`.padEnd(20)} ${`${data.bCorrect}/${data.total} (${bPct}%)`.padEnd(20)}`);
}

// Disagreements
if (results.disagreements.length > 0) {
  console.log(`\n─── ROUTING DISAGREEMENTS (${results.disagreements.length}) ────────────────────────────────`);
  console.log(`${'ID'.padEnd(4)} ${'Expected'.padEnd(14)} ${'A: Pre→CF'.padEnd(28)} ${'B: CF→Pre'.padEnd(28)} Input`);
  console.log('─'.repeat(130));
  for (const d of results.disagreements) {
    const aMark = d.archA.correct ? '✅' : '❌';
    const bMark = d.archB.correct ? '✅' : '❌';
    console.log(`${String(d.id).padEnd(4)} ${d.expected.padEnd(14)} ${aMark} ${d.archA.route.padEnd(24)} ${bMark} ${d.archB.route.padEnd(24)} ${d.input.substring(0, 55)}`);
  }
}

// Pre-check interceptions
if (results.precheckInterceptions.length > 0) {
  console.log(`\n─── PRE-CHECK INTERCEPTIONS (${results.precheckInterceptions.length}) ─────────────────────────────`);
  console.log('Cases where Arch A pre-check fired BEFORE CF would have classified:');
  console.log(`${'ID'.padEnd(4)} ${'Expected'.padEnd(14)} ${'A (pre-check)'.padEnd(22)} ${'A ok?'.padEnd(7)} ${'B (CF-first)'.padEnd(22)} ${'B ok?'.padEnd(7)} Input`);
  console.log('─'.repeat(130));
  for (const p of results.precheckInterceptions) {
    const aMark = p.archA_correct ? '✅' : '❌';
    const bMark = p.archB_correct ? '✅' : '❌';
    console.log(`${String(p.id).padEnd(4)} ${p.expected.padEnd(14)} ${p.archA_route.padEnd(22)} ${aMark.padEnd(5)}   ${p.archB_route.padEnd(22)} ${bMark.padEnd(5)}   ${p.input.substring(0, 55)}`);
  }
}

// Arch A errors
if (results.archA.details.length > 0) {
  console.log(`\n─── ARCH A ERRORS (Pre-checks → CF) ────────────────────────────────`);
  for (const e of results.archA.details) {
    console.log(`  #${e.id} [${e.expected}] "${e.input}" → ${e.got.route}`);
  }
}

// Arch B errors
if (results.archB.details.length > 0) {
  console.log(`\n─── ARCH B ERRORS (CF → Pre-checks) ────────────────────────────────`);
  for (const e of results.archB.details) {
    console.log(`  #${e.id} [${e.expected}] "${e.input}" → ${e.got.route}`);
  }
}

// Conclusion
console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('  CONCLUSION');
console.log('═══════════════════════════════════════════════════════════════════════');
const diff = results.archB.correct - results.archA.correct;
if (diff > 0) {
  console.log(`  CF-FIRST (Arch B) wins by ${diff} routing decisions (${((diff/TEST_CASES.length)*100).toFixed(1)}% improvement)`);
  console.log(`  Recommendation: Move CF classifier to Step 0, pre-checks to Step 1`);
} else if (diff < 0) {
  console.log(`  PRE-CHECKS FIRST (Arch A) wins by ${Math.abs(diff)} routing decisions`);
  console.log(`  Recommendation: Keep current order`);
} else {
  console.log(`  Both architectures score identically (${results.archA.correct}/${TEST_CASES.length})`);
  if (results.disagreements.length > 0) {
    console.log(`  But they disagree on ${results.disagreements.length} inputs — inspect the details above.`);
  } else {
    console.log(`  No routing disagreements at all — order doesn't matter.`);
  }
}
console.log('═══════════════════════════════════════════════════════════════════════');
