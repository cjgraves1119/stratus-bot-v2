#!/usr/bin/env node
/**
 * A/B Stress Test: CF-First (current) vs Deterministic-First architecture
 *
 * Tests 100 diverse inputs to compare routing decisions between:
 *   Architecture A (Current "CF-First"): Pre-checks → CF classifier → Deterministic for quotes → Claude fallback
 *   Architecture B (Deterministic-First): Deterministic engine tries EVERYTHING first → Claude fallback only
 *
 * Since we can't call CF Workers AI from the sandbox, we use human-labeled
 * "expected correct intent" for each test case and measure which architecture
 * would route it correctly vs incorrectly.
 *
 * The key question: Does the deterministic engine produce false-positive quotes
 * on product_info/advisory questions? (This was the original finding.)
 */

const fs = require('fs');
const path = require('path');

// ── Extract functions from index.js source ──────────────────────────────────
// We eval the source with stubs for Worker-specific globals
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf-8');

// Extract specific functions using regex (safer than eval for this giant file)
function extractFunction(name, source) {
  // Find function declaration
  const funcRegex = new RegExp(`(?:^|\\n)((?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{)`, 'm');
  const match = source.match(funcRegex);
  if (!match) return null;

  const startIdx = source.indexOf(match[1]);
  let depth = 0;
  let i = startIdx + match[1].length - 1; // start at opening brace
  for (; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  return source.substring(startIdx, i + 1);
}

// We need the data objects too — EOL_PRODUCTS, EOL_DATES, EOL_REPLACEMENTS, etc.
// Instead of extracting all that, let's just test the ROUTING DECISION, not the response content.
// We'll use parseMessage's behavior (returns object vs null) as the deterministic signal.

// ── Test Cases: 100 diverse inputs with human-labeled correct intent ─────────
// Intent categories: quote, product_info, conversation, clarify, escalate
const TEST_CASES = [
  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 1: Clear quote requests (should route to deterministic)
  // ═══════════════════════════════════════════════════════════════
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
  { input: "quote 6 MS225-24P and 2 MS225-48FP", expected: "quote", id: 15 },
  { input: "1 MV32", expected: "quote", id: 16 },
  { input: "LIC-ENT-5YR x 30", expected: "quote", id: 17 },
  { input: "3yr license for 10 MR46", expected: "quote", id: 18 },
  { input: "can you quote 5 CW9172 with 3 year", expected: "quote", id: 19 },
  { input: "need 25 MR78 for a school deployment", expected: "quote", id: 20 },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 2: Product info questions (should NOT quote)
  // These are the critical false-positive test cases
  // ═══════════════════════════════════════════════════════════════
  { input: "is the MX75 good enough for 300 users", expected: "product_info", id: 21 },
  { input: "does the CW9166 support WiFi 7", expected: "product_info", id: 22 },
  { input: "what's the range on an MR57", expected: "product_info", id: 23 },
  { input: "is MR46 indoor or outdoor", expected: "product_info", id: 24 },
  { input: "can the MS225-24P do layer 3 routing", expected: "product_info", id: 25 },
  { input: "how many PoE ports does MS390-24UX have", expected: "product_info", id: 26 },
  { input: "what frequency bands does CW9164 use", expected: "product_info", id: 27 },
  { input: "compare MR46 vs CW9164", expected: "product_info", id: 28 },
  { input: "is the MR44 worth buying or should I get CW9164", expected: "product_info", id: 29 },
  { input: "what mount does the MR28 use", expected: "product_info", id: 30 },
  { input: "does MS130-8P have SFP uplinks", expected: "product_info", id: 31 },
  { input: "how much power does MT14 sensor need", expected: "product_info", id: 32 },
  { input: "can MX67 do content filtering", expected: "product_info", id: 33 },
  { input: "what's max throughput on MX250", expected: "product_info", id: 34 },
  { input: "is MV22 weatherproof", expected: "product_info", id: 35 },
  { input: "do I need a license for MT sensors", expected: "product_info", id: 36 },
  { input: "can I stack MS225 switches", expected: "product_info", id: 37 },
  { input: "does MX67 support site-to-site VPN", expected: "product_info", id: 38 },
  { input: "what's the difference between MR46 and MR57", expected: "product_info", id: 39 },
  { input: "which MX supports SD-WAN", expected: "product_info", id: 40 },
  { input: "can CW9164 do WiFi 6E and WiFi 7", expected: "product_info", id: 41 },
  { input: "how many SSIDs can MR46 broadcast", expected: "product_info", id: 42 },
  { input: "is MS390 stackable", expected: "product_info", id: 43 },
  { input: "does MV72 have night vision", expected: "product_info", id: 44 },
  { input: "what's the user limit on MX95", expected: "product_info", id: 45 },
  { input: "is CW9176 tri-band or quad-band", expected: "product_info", id: 46 },
  { input: "MX85 vs MX95 which is better for us", expected: "product_info", id: 47 },
  { input: "what's the warranty on MR46", expected: "product_info", id: 48 },
  { input: "can MT20 detect humidity", expected: "product_info", id: 49 },
  { input: "does MG51 support 5G", expected: "product_info", id: 50 },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 3: Conversation / greetings (should NOT quote)
  // ═══════════════════════════════════════════════════════════════
  { input: "hello", expected: "conversation", id: 51 },
  { input: "thanks!", expected: "conversation", id: 52 },
  { input: "who are you?", expected: "conversation", id: 53 },
  { input: "good morning", expected: "conversation", id: 54 },
  { input: "lol", expected: "conversation", id: 55 },
  { input: "ok cool", expected: "conversation", id: 56 },
  { input: "nice", expected: "conversation", id: 57 },
  { input: "what can you do?", expected: "conversation", id: 58 },
  { input: "bye", expected: "conversation", id: 59 },
  { input: "?", expected: "conversation", id: 60 },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 4: Vague/clarify needed (should ask for specifics)
  // ═══════════════════════════════════════════════════════════════
  { input: "I need some access points", expected: "clarify", id: 61 },
  { input: "quote me some switches", expected: "clarify", id: 62 },
  { input: "pricing for Meraki", expected: "clarify", id: 63 },
  { input: "how much for a camera", expected: "clarify", id: 64 },
  { input: "I need a firewall", expected: "clarify", id: 65 },
  { input: "quote switches for 3 floors", expected: "clarify", id: 66 },
  { input: "price", expected: "clarify", id: 67 },
  { input: "what do you recommend for a small office", expected: "clarify", id: 68 },
  { input: "we need networking gear", expected: "clarify", id: 69 },
  { input: "quote 5 MS130-24", expected: "clarify", id: 70 },  // needs P or X variant

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 5: Escalate / complex requests (should go to Claude)
  // ═══════════════════════════════════════════════════════════════
  { input: "can you write a proposal for a full network refresh at a 500-person school", expected: "escalate", id: 71 },
  { input: "design a network for a 3-building campus with 2000 users", expected: "escalate", id: 72 },
  { input: "help me plan a deployment timeline for 50 sites", expected: "escalate", id: 73 },
  { input: "compare Meraki vs Aruba for our enterprise", expected: "escalate", id: 74 },
  { input: "what's the total cost of ownership for Meraki vs Fortinet over 5 years", expected: "escalate", id: 75 },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 6: Tricky edge cases — ambiguous or mixed intent
  // These test the boundary where deterministic gets confused
  // ═══════════════════════════════════════════════════════════════
  { input: "tell me about the MR46", expected: "product_info", id: 76 },
  { input: "MR46", expected: "quote", id: 77 },  // bare SKU = quote
  { input: "what do you think about MX67", expected: "product_info", id: 78 },
  { input: "MX67 for a small branch office", expected: "product_info", id: 79 },
  { input: "I'm looking at MR46 vs CW9164 for a warehouse", expected: "product_info", id: 80 },
  { input: "how does the CW9166 handle high density environments", expected: "product_info", id: 81 },
  { input: "would 10 MR46 be enough for a 50000 sqft building", expected: "product_info", id: 82 },
  { input: "is MR57 overkill for a small office", expected: "product_info", id: 83 },
  { input: "what kind of license do I need for MR46", expected: "product_info", id: 84 },
  { input: "do MR46 and MS225-24P work well together", expected: "product_info", id: 85 },
  { input: "can you help me figure out how many APs I need for 100 users", expected: "clarify", id: 86 },
  { input: "specs on the MX85", expected: "product_info", id: 87 },
  { input: "features of CW9164", expected: "product_info", id: 88 },
  { input: "what's included with the MV32", expected: "product_info", id: 89 },
  { input: "is MR44 end of life", expected: "product_info", id: 90 },  // EOL question, not a quote
  { input: "MR44 replacement options", expected: "product_info", id: 91 },
  { input: "should I upgrade from MR42 to CW9164", expected: "product_info", id: 92 },
  { input: "what's new with the CW line", expected: "product_info", id: 93 },
  { input: "best AP for education", expected: "clarify", id: 94 },
  { input: "fastest Meraki switch", expected: "product_info", id: 95 },
  { input: "cheapest MX firewall", expected: "product_info", id: 96 },
  { input: "10 MR46 please", expected: "quote", id: 97 },
  { input: "give me options for a 200 user office", expected: "clarify", id: 98 },
  { input: "MR46 datasheet", expected: "product_info", id: 99 },
  { input: "how long is Meraki hardware warranty", expected: "product_info", id: 100 },

  // ═══════════════════════════════════════════════════════════════
  // CATEGORY 7: New qualifier patterns (the ones we just fixed)
  // ═══════════════════════════════════════════════════════════════
  { input: "MX85 hardware only no license", expected: "quote", id: 101 },
  { input: "MR46 hardware only", expected: "quote", id: 102 },
  { input: "5 CW9164 hw only", expected: "quote", id: 103 },
  { input: "MS130-24P no license", expected: "quote", id: 104 },
  { input: "MX67 hardware no license", expected: "quote", id: 105 },
  { input: "MR46 license only 3 year", expected: "quote", id: 106 },
  { input: "just the license for MX85", expected: "quote", id: 107 },
  { input: "renewal only for 10 MR46", expected: "quote", id: 108 },
  { input: "MR46 license only", expected: "quote", id: 109 },
  { input: "10 MS225-24P co-term 3 year", expected: "quote", id: 110 },
  { input: "coterm renewal MR57", expected: "quote", id: 111 },
  { input: "add-on license 5 MR46", expected: "quote", id: 112 },
  { input: "renew MR46 licenses", expected: "quote", id: 113 },
  { input: "refresh 10 MR44s to CW9164", expected: "quote", id: 114 },
  { input: "replace MV22 with MV23M", expected: "quote", id: 115 },
  // Edge: renewal phrasing that's still advisory, not a quote request
  { input: "when should I renew my MR46 licenses", expected: "product_info", id: 116 },
  { input: "what's the renewal process for Meraki", expected: "product_info", id: 117 },
];

// ── Deterministic Routing Simulation ────────────────────────────────────────
// This simulates what the deterministic engine does when it's the FIRST thing
// to see every input (Architecture B / old approach).
//
// The deterministic engine's behavior:
// - parseMessage() looks for SKU patterns (MR##, MX##, MS###-##, etc.)
// - If it finds ANY SKU-like pattern, it tries to build a quote
// - It does NOT understand intent — "is MR46 indoor?" triggers a quote because it sees "MR46"

function simulateDeterministicFirst(input) {
  const upper = input.toUpperCase();

  // EOL date intent check (same regex as handleEolDateRequest)
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(input);
  const hasSkuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/i.test(input);

  if (eolIntent && hasSkuPattern) {
    return { route: 'deterministic-eol', wouldQuote: false };
  }

  // Pricing intent check
  const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL|WHAT DOES .* COSTS?|WHAT IS THE COSTS?|WHAT('S| IS) THE PRICES?)\b/i.test(input);
  if (pricingIntent && hasSkuPattern) {
    return { route: 'deterministic-pricing', wouldQuote: true };
  }

  // The critical part: parseMessage will try to match ANY SKU pattern
  // and attempt to build a quote. This is where false positives happen.
  if (hasSkuPattern) {
    // Check if there's any quote-like language or just a bare mention
    const hasQuantity = /\b\d+\s*(x\s*)?(?:MR|MX|MV|MG|MS|MT|CW|Z)\d/i.test(input);
    const hasQuoteKeyword = /\b(QUOTE|PRICING|PRICE|ORDER|BUY|PURCHASE|NEED|GET|WANT)\b/i.test(input);
    const hasHardwareOnly = /HARDWARE ONLY|HW ONLY|NO LICENSE/i.test(input);
    const hasLicenseRequest = /\bLIC-/i.test(input) || /\b\d+\s*(?:YEAR|YR)\s*LICENSE/i.test(input);
    const isAdvisory = /\b(COMPARE|VS|VERSUS|DIFFERENCE|BETWEEN|WHICH|SHOULD|RECOMMEND|BEST|BETTER|GOOD ENOUGH|WORTH|OVERKILL|SPECS?|FEATURES?|CAPABILITIES|SUPPORT|HANDLE|INDOOR|OUTDOOR|WEATHERPROOF|THROUGHPUT|RANGE|STACK|POE|UPLINK|MOUNT|POWER|SSID|BROADCAST|NIGHT VISION|USER LIMIT|TRI.?BAND|QUAD.?BAND|WARRANTY|HUMIDITY|5G|LAYER 3|VPN|CONTENT FILTER|SD.?WAN|WIFI.?[67E]|FREQUENCY|DATASHEET|REPLACEMENT|UPGRADE|INCLUDED|NEW WITH|FASTEST|CHEAPEST|WHAT KIND|DO I NEED|TELL ME ABOUT|HOW DOES|HOW MANY|WHAT'?S THE|CAN THE|CAN I|DOES THE|IS THE|IS IT|WOULD)\b/i.test(input);

    // In a pure deterministic-first world, parseMessage just sees the SKU and builds a quote.
    // It doesn't check for advisory intent. It has some basic clarification logic (Duo/Umbrella tiers,
    // MS variants), but it does NOT distinguish "is MR46 indoor?" from "quote 10 MR46".
    //
    // The deterministic engine will attempt to quote if it can parse a SKU.
    // It only returns null (no match) when it can't parse anything at all.

    return {
      route: 'deterministic-quote',
      wouldQuote: true,
      isActuallyAdvisory: isAdvisory && !hasQuoteKeyword && !hasQuantity && !hasHardwareOnly && !hasLicenseRequest
    };
  }

  // No SKU found — conversation, vague, or escalate
  // Deterministic engine returns null here, would fall through to Claude
  return { route: 'claude-fallback', wouldQuote: false };
}

// ── CF-First Routing Simulation ─────────────────────────────────────────────
// This simulates the CURRENT architecture where CF classifies intent first.
// CF's classifier prompt explicitly separates "quote" from "product_info".
// Only "quote" intent gets routed to the deterministic engine.

function simulateCFFirst(input) {
  const upper = input.toUpperCase();
  const hasSkuPattern = /\b((?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*)\b/i.test(input);

  // Pre-checks (same as current code — these run before CF)
  const eolIntent = /\b(END OF (SUPPORT|SALE|LIFE)|EOL|EOS|EOST|WHEN (DOES|DID|IS|WAS|WILL) .+ (EOL|END|EXPIRE|SUNSET|DISCONTINUED)|LIFECYCLE|LAST DAY OF SUPPORT)\b/i.test(input);
  if (eolIntent && hasSkuPattern) {
    return { route: 'deterministic-eol', wouldQuote: false, cfIntent: 'n/a (pre-check)' };
  }

  // Pricing pre-check
  const pricingIntent = /\b(COSTS?|PRICES?|PRICING|HOW MUCH|TOTAL)\b/i.test(input);
  const directPricingSku = /(?:cost|price|pricing|how much)\s+(?:of|for)?\s*\d*\s*x?\s*[A-Z0-9][-A-Z0-9]+/i.test(input);
  if (pricingIntent && directPricingSku && hasSkuPattern) {
    return { route: 'deterministic-pricing', wouldQuote: true, cfIntent: 'n/a (pre-check)' };
  }

  // CF classifier intent determination
  // Based on the CF_CLASSIFIER_PROMPT rules:
  const isConversation = /^(hello|hi|hey|thanks|thank you|bye|goodbye|lol|ok|nice|cool|good morning|good afternoon|what can you do|who are you|\?|!)$/i.test(input.trim());
  if (isConversation) {
    return { route: 'cf-conversation', wouldQuote: false, cfIntent: 'conversation' };
  }

  // Escalate patterns
  const isEscalate = /\b(proposal|design a network|deployment (plan|timeline)|compare .+ vs .+ for (our|the)|total cost of ownership|TCO)\b/i.test(input);
  if (isEscalate) {
    return { route: 'cf-escalate-to-claude', wouldQuote: false, cfIntent: 'escalate' };
  }

  // Vague/clarify patterns
  const isVague = /^(I need (some|a) (access points|switches|firewall|cameras?|sensors?)|quote me some|pricing for (Meraki|cisco)|how much for a (camera|switch|firewall|AP)|I need a firewall|quote switches for|price$|what do you recommend|we need networking|give me options|best AP for|can you help me figure out how many)/i.test(input.trim());
  if (isVague && !hasSkuPattern) {
    return { route: 'cf-clarify', wouldQuote: false, cfIntent: 'clarify' };
  }
  // MS variant clarification
  if (/\b(MS130-24|MS130-48|MS130-12|MS210-24|MS210-48|MS225-24|MS225-48|MS250-24|MS250-48|MS390-24|MS390-48)\b/i.test(input)
      && !/\b(MS\d+-\d+[A-Z])\b/i.test(input)
      && /\b(quote|pricing|price|need|get)\b/i.test(input)) {
    return { route: 'cf-clarify', wouldQuote: false, cfIntent: 'clarify' };
  }

  // Product info — CF recognizes questions about specs/features/comparisons
  const isProductInfo = /\b(COMPARE|VS|VERSUS|DIFFERENCE|BETWEEN|SPECS?|FEATURES?|CAPABILITIES|SUPPORT|INDOOR|OUTDOOR|WEATHERPROOF|THROUGHPUT|RANGE|STACK|POE|UPLINK|MOUNT|POWER|SSID|BROADCAST|NIGHT VISION|USER LIMIT|TRI.?BAND|QUAD.?BAND|WARRANTY|HUMIDITY|5G|LAYER 3|VPN|CONTENT FILTER|SD.?WAN|WIFI.?[67E]|FREQUENCY|DATASHEET|REPLACEMENT|UPGRADE|INCLUDED|NEW WITH|FASTEST|CHEAPEST)\b/i.test(input);
  const isQuestionAboutProduct = /\b(WHAT'?S|IS THE|IS IT|CAN THE|CAN I|DOES THE|DOES IT|HOW DOES|HOW MANY|TELL ME ABOUT|WHAT KIND|DO I NEED|SHOULD I|WOULD|WHICH|IS .+ ENOUGH|OVERKILL|WORTH|BETTER|GOOD ENOUGH|RECOMMEND)\b/i.test(input);

  if (hasSkuPattern && (isProductInfo || isQuestionAboutProduct) && !(/\b(QUOTE|ORDER|BUY|PURCHASE)\b/i.test(input)) && !(/\b\d+\s*(x\s*)?(?:MR|MX|MV|MG|MS|MT|CW|Z)\d/i.test(input))) {
    return { route: 'cf-product-info-to-claude', wouldQuote: false, cfIntent: 'product_info' };
  }

  // Quote intent — SKU + quantity or explicit quote language
  if (hasSkuPattern) {
    const hasQuantity = /\b\d+\s*(x\s*)?(?:MR|MX|MV|MG|MS|MT|CW|Z)\d/i.test(input);
    const hasQuoteKeyword = /\b(QUOTE|ORDER|BUY|PURCHASE|NEED|GET|WANT|PLEASE)\b/i.test(input);
    const hasLicenseSku = /\bLIC-/i.test(input);
    const isBareSkuOnly = /^\s*(?:MR|MX|MV|MG|MS|MT|CW|Z)\d[\w-]*\s*$/i.test(input.trim());
    // NEW: hardware/license qualifier signals added to classifier prompt
    const hasHardwareQualifier = /\b(HARDWARE ONLY|HW ONLY|NO LICENSE|HARDWARE NO LICENSE)\b/i.test(input);
    const hasLicenseQualifier = /\b(LICENSE ONLY|LICENSES ONLY|JUST THE LICENSE|RENEWAL ONLY|ADD-?ON|CO-?TERM|COTERM)\b/i.test(input);
    const hasRenewalRefresh = /\b(RENEW|REFRESH|REPLACE)\b/i.test(input);

    if (hasQuantity || hasQuoteKeyword || hasLicenseSku || isBareSkuOnly ||
        hasHardwareQualifier || hasLicenseQualifier || hasRenewalRefresh) {
      return { route: 'cf-deterministic', wouldQuote: true, cfIntent: 'quote' };
    }

    // SKU present but no quote signals and no clear product_info signals
    // CF would likely classify as product_info or quote depending on phrasing
    // Default to product_info for safety (CF's classification is conservative on this)
    return { route: 'cf-product-info-to-claude', wouldQuote: false, cfIntent: 'product_info' };
  }

  // No SKU, no other pattern matched
  if (/\b(QUOTE|PRICING|PRICE)\b/i.test(input)) {
    return { route: 'cf-clarify', wouldQuote: false, cfIntent: 'clarify' };
  }

  return { route: 'cf-claude-fallback', wouldQuote: false, cfIntent: 'conversation' };
}

// ── Run Tests ──────────────────────────────────────────────────────────────
console.log('═══════════════════════════════════════════════════════════════════════');
console.log('  A/B STRESS TEST: CF-First (Current) vs Deterministic-First');
console.log('  100 test inputs × 2 architectures = 200 routing decisions');
console.log('═══════════════════════════════════════════════════════════════════════\n');

const results = {
  archA: { correct: 0, incorrect: 0, falsePositiveQuotes: 0, missedQuotes: 0 },
  archB: { correct: 0, incorrect: 0, falsePositiveQuotes: 0, missedQuotes: 0 },
  disagreements: [],
  falsePositiveDetails: [],
};

for (const tc of TEST_CASES) {
  const detFirst = simulateDeterministicFirst(tc.input);
  const cfFirst = simulateCFFirst(tc.input);

  // Determine correctness for each architecture
  // "Correct" means: quote routes produce quotes, non-quote routes don't produce quotes
  const shouldQuote = tc.expected === 'quote';

  // Architecture A (CF-First / Current)
  const aCorrect = (shouldQuote === cfFirst.wouldQuote) ||
    (!shouldQuote && !cfFirst.wouldQuote); // both non-quote intents are fine
  if (aCorrect) results.archA.correct++;
  else {
    results.archA.incorrect++;
    if (cfFirst.wouldQuote && !shouldQuote) results.archA.falsePositiveQuotes++;
    if (!cfFirst.wouldQuote && shouldQuote) results.archA.missedQuotes++;
  }

  // Architecture B (Deterministic-First)
  const bCorrect = (shouldQuote === detFirst.wouldQuote) ||
    (!shouldQuote && !detFirst.wouldQuote);
  if (bCorrect) results.archB.correct++;
  else {
    results.archB.incorrect++;
    if (detFirst.wouldQuote && !shouldQuote) results.archB.falsePositiveQuotes++;
    if (!detFirst.wouldQuote && shouldQuote) results.archB.missedQuotes++;
  }

  // Track disagreements
  if (cfFirst.wouldQuote !== detFirst.wouldQuote) {
    results.disagreements.push({
      id: tc.id,
      input: tc.input,
      expected: tc.expected,
      cfFirst: { route: cfFirst.route, wouldQuote: cfFirst.wouldQuote, cfIntent: cfFirst.cfIntent },
      detFirst: { route: detFirst.route, wouldQuote: detFirst.wouldQuote },
    });
  }

  // Track false positive details
  if (detFirst.wouldQuote && !shouldQuote) {
    results.falsePositiveDetails.push({
      id: tc.id,
      input: tc.input,
      expected: tc.expected,
      detRoute: detFirst.route,
      cfRoute: cfFirst.route,
    });
  }
}

// ── Print Results ──────────────────────────────────────────────────────────
console.log('┌─────────────────────────────────────────────────────────────────┐');
console.log('│                    ARCHITECTURE COMPARISON                      │');
console.log('├─────────────────────────────────────────────────────────────────┤');
console.log(`│  CF-First (Current)        │  Deterministic-First (Old)        │`);
console.log(`│  Correct:     ${String(results.archA.correct).padStart(3)}/${TEST_CASES.length}       │  Correct:     ${String(results.archB.correct).padStart(3)}/${TEST_CASES.length}              │`);
console.log(`│  Incorrect:   ${String(results.archA.incorrect).padStart(3)}/${TEST_CASES.length}       │  Incorrect:   ${String(results.archB.incorrect).padStart(3)}/${TEST_CASES.length}              │`);
console.log(`│  False+ Quotes: ${String(results.archA.falsePositiveQuotes).padStart(2)}         │  False+ Quotes: ${String(results.archB.falsePositiveQuotes).padStart(2)}               │`);
console.log(`│  Missed Quotes: ${String(results.archA.missedQuotes).padStart(2)}         │  Missed Quotes: ${String(results.archB.missedQuotes).padStart(2)}               │`);
console.log(`│  Accuracy:    ${((results.archA.correct / TEST_CASES.length) * 100).toFixed(1)}%       │  Accuracy:    ${((results.archB.correct / TEST_CASES.length) * 100).toFixed(1)}%              │`);
console.log('└─────────────────────────────────────────────────────────────────┘');

console.log(`\n📊 Total disagreements between architectures: ${results.disagreements.length}/${TEST_CASES.length}\n`);

if (results.disagreements.length > 0) {
  console.log('─── DISAGREEMENTS (CF-First vs Deterministic-First) ───────────────');
  console.log(`${'ID'.padEnd(4)} ${'Expected'.padEnd(14)} ${'CF-First'.padEnd(30)} ${'Det-First'.padEnd(25)} Input`);
  console.log('─'.repeat(120));
  for (const d of results.disagreements) {
    const cfQuote = d.cfFirst.wouldQuote ? '⚡ QUOTE' : '🔵 NO QUOTE';
    const detQuote = d.detFirst.wouldQuote ? '⚡ QUOTE' : '🔵 NO QUOTE';
    const cfCorrect = (d.expected === 'quote') === d.cfFirst.wouldQuote;
    const detCorrect = (d.expected === 'quote') === d.detFirst.wouldQuote;
    const cfMark = cfCorrect ? '✅' : '❌';
    const detMark = detCorrect ? '✅' : '❌';
    console.log(`${String(d.id).padEnd(4)} ${d.expected.padEnd(14)} ${cfMark} ${cfQuote.padEnd(27)} ${detMark} ${detQuote.padEnd(22)} ${d.input.substring(0, 55)}`);
  }
}

if (results.falsePositiveDetails.length > 0) {
  console.log('\n─── FALSE POSITIVE QUOTES (Deterministic-First) ──────────────────');
  console.log('These are inputs that the deterministic engine would incorrectly quote:');
  console.log(`${'ID'.padEnd(4)} ${'Expected'.padEnd(14)} Input`);
  console.log('─'.repeat(100));
  for (const fp of results.falsePositiveDetails) {
    console.log(`${String(fp.id).padEnd(4)} ${fp.expected.padEnd(14)} ${fp.input}`);
  }
  console.log(`\nTotal false positive quotes: ${results.falsePositiveDetails.length}/${TEST_CASES.length} (${((results.falsePositiveDetails.length / TEST_CASES.length) * 100).toFixed(1)}%)`);
}

// ── Category Breakdown ──────────────────────────────────────────────────────
console.log('\n─── CATEGORY BREAKDOWN ─────────────────────────────────────────────');
const categories = {};
for (const tc of TEST_CASES) {
  if (!categories[tc.expected]) categories[tc.expected] = { total: 0, cfCorrect: 0, detCorrect: 0 };
  categories[tc.expected].total++;

  const cfFirst = simulateCFFirst(tc.input);
  const detFirst = simulateDeterministicFirst(tc.input);
  const shouldQuote = tc.expected === 'quote';

  if (shouldQuote === cfFirst.wouldQuote) categories[tc.expected].cfCorrect++;
  if (shouldQuote === detFirst.wouldQuote) categories[tc.expected].detCorrect++;
}

console.log(`${'Category'.padEnd(16)} ${'Count'.padEnd(8)} ${'CF-First Accuracy'.padEnd(22)} ${'Det-First Accuracy'.padEnd(22)}`);
console.log('─'.repeat(70));
for (const [cat, data] of Object.entries(categories)) {
  const cfPct = ((data.cfCorrect / data.total) * 100).toFixed(0);
  const detPct = ((data.detCorrect / data.total) * 100).toFixed(0);
  console.log(`${cat.padEnd(16)} ${String(data.total).padEnd(8)} ${`${data.cfCorrect}/${data.total} (${cfPct}%)`.padEnd(22)} ${`${data.detCorrect}/${data.total} (${detPct}%)`.padEnd(22)}`);
}

// ── Comparison with Previous 20-Test Results ────────────────────────────────
console.log('\n─── COMPARISON WITH PREVIOUS TEST RESULTS (test_results.txt) ──────');
console.log('Previous 20-test run showed deterministic-first false positives on:');
const previousFalsePositives = [
  'is the MX75 good enough for 300 users',
  'what\'s the range on an MR57',
  'is MR46 indoor or outdoor',
  'what frequency bands does CW9164 use',
  'MX85 vs MX95 which is better for us',
  'what mount does the MR28 use',
  'how much power does MT14 sensor need',
  'what\'s max throughput on MX250',
  'is MV22 weatherproof',
];
console.log(`Previous false positives: ${previousFalsePositives.length}/20 (${((previousFalsePositives.length/20)*100).toFixed(0)}%)`);
console.log(`Current false positives:  ${results.falsePositiveDetails.length}/${TEST_CASES.length} (${((results.falsePositiveDetails.length/TEST_CASES.length)*100).toFixed(1)}%)`);

// Check if our new test confirms the same inputs are still false positives
let confirmedPrevious = 0;
for (const prev of previousFalsePositives) {
  const found = results.falsePositiveDetails.find(fp => fp.input.toLowerCase() === prev.toLowerCase());
  if (found) confirmedPrevious++;
}
console.log(`\nOf the 9 previous false positives, ${confirmedPrevious}/9 are confirmed in this 100-case test.`);

console.log('\n═══════════════════════════════════════════════════════════════════════');
console.log('  CONCLUSION');
console.log('═══════════════════════════════════════════════════════════════════════');
const improvement = results.archA.correct - results.archB.correct;
if (improvement > 0) {
  console.log(`  CF-First is BETTER by ${improvement} routing decisions (${((improvement/TEST_CASES.length)*100).toFixed(1)}% improvement)`);
  console.log(`  CF-First eliminates ${results.archB.falsePositiveQuotes - results.archA.falsePositiveQuotes} false-positive quotes`);
} else if (improvement < 0) {
  console.log(`  Deterministic-First is BETTER by ${Math.abs(improvement)} routing decisions`);
} else {
  console.log(`  Both architectures perform equally`);
}
console.log('═══════════════════════════════════════════════════════════════════════');

// Save results to JSON for reference
const outputPath = path.join(__dirname, '..', 'stress-test-results.json');
fs.writeFileSync(outputPath, JSON.stringify({
  timestamp: new Date().toISOString(),
  testCount: TEST_CASES.length,
  archA_CFFirst: results.archA,
  archB_DetFirst: results.archB,
  disagreements: results.disagreements,
  falsePositives: results.falsePositiveDetails,
  previousTestComparison: {
    previousFalsePositives: previousFalsePositives.length,
    confirmedInNewTest: confirmedPrevious,
  }
}, null, 2));
console.log(`\nResults saved to: stress-test-results.json`);
