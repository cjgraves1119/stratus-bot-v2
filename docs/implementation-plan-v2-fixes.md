# Stratus AI Bot — V2 Classifier + Anti-Hallucination Fixes

## Implementation Prompt for New Session

Use this document as context when starting a fresh Opus session to implement all changes. Copy the entire prompt section below.

---

## PROMPT (paste into new session)

```
I need to implement a series of fixes to the Stratus AI Webex bot. The worker code is at:
/sessions/$(basename $PWD)/mnt/Bots/stratus-bot-v2-cf/worker/src/index.js

Start by: cd /sessions/$(basename $PWD)/mnt/Bots/stratus-bot-v2-cf && git pull origin main

There are 8 changes to make. Each one has the exact location in the file, the problem, and the fix. Apply them all, then run `node test-local.js` to verify, and ask me before deploying.

═══════════════════════════════════════════════════════════════════════
CHANGE 1: Fix CF_CLASSIFIER_PROMPT_V2 — SDW tier extraction
═══════════════════════════════════════════════════════════════════════

LOCATION: The CF_CLASSIFIER_PROMPT_V2 constant (around line 631), in the ═══ MODIFIER RULES ═══ section.

PROBLEM: When users write "MX85-SDW 1yr 3yr 5yr", both Llama and Gemma put "MX85-SDW" as the SKU and leave tier=null. They don't know to split the tier suffix from the SKU.

FIX: Add this rule to the MODIFIER RULES section, after the `tier` rule:

```
- IMPORTANT: If a SKU has a tier suffix appended (e.g., "MX85-SDW", "MX67-SEC", "MX75-ENT"), SPLIT it: put the base model in items[].sku (e.g., "MX85") and the tier in modifiers.tier (e.g., "SDW"). Never include the tier suffix as part of the SKU string.
```

═══════════════════════════════════════════════════════════════════════
CHANGE 2: Fix benchmark grading — qty:null should mean "don't care"
═══════════════════════════════════════════════════════════════════════

LOCATION: /sessions/$(basename $PWD)/work/benchmark-runner.js, function itemEq() around line 26-33.

PROBLEM: The swap fixture expects `qty: null` (meaning "any qty is fine") but the grading function treats null as a literal value that must match. Both models output qty:1 which is correct behavior.

FIX: Change line 31 from:
```js
if (a.qty !== undefined && b.qty !== undefined && a.qty !== b.qty) return false;
```
to:
```js
if (a.qty != null && b.qty != null && a.qty !== b.qty) return false;
```

This makes null/undefined qty mean "any quantity matches."

═══════════════════════════════════════════════════════════════════════
CHANGE 3: Add MS150/MS130/MS390/C9300/CW bare family parsing
═══════════════════════════════════════════════════════════════════════

LOCATION: In parseMessage() function (~line 3093), the skuPatterns array and surrounding logic.

PROBLEM: "quote 2 MS150 switches" — the regex patterns all require a dash after the family prefix. Bare "MS150" doesn't match, so it's silently dropped. Falls to LLM which hallucinates model options.

FIX: After the existing skuPatterns array (around line 3103 after the last pattern), add a NEW section that catches bare family names and injects them as items that will get routed through validateSku() for proper variant disambiguation:

```js
// ── Bare multi-variant family names ──
// Catches "MS150", "MS130", "MS390", "C9300", "CW" etc. when used without a full variant suffix.
// These are valid families that need variant clarification, NOT invalid SKUs.
const bareFamilyPatterns = [
  { re: /\bMS150\b(?!-)/gi, family: 'MS150' },
  { re: /\bMS130\b(?!-\d)/gi, family: 'MS130' },  // MS130 bare, but not MS130-24P etc.
  { re: /\bMS390\b(?!-)/gi, family: 'MS390' },
  { re: /\bMS450\b(?!-)/gi, family: 'MS450' },
  { re: /\bC9300L?\b(?!-)/gi, family: 'C9300' },   // C9300 or C9300L bare
  { re: /\bC9200L\b(?!-)/gi, family: 'C9200L' },
  { re: /\bCW\b(?!\d)/gi, family: 'CW' },          // bare "CW" without model number
];

for (const { re, family } of bareFamilyPatterns) {
  let m;
  while ((m = re.exec(upper)) !== null) {
    const pos = m.index;
    // Skip if this position is already covered by a more specific match
    const alreadyCovered = rawMatches.some(rm => 
      pos >= rm.position && pos < rm.position + rm.baseSku.length
    );
    if (alreadyCovered) continue;
    
    // Extract quantity from before/after the match
    const before = upper.slice(Math.max(0, pos - 20), pos);
    const after = upper.slice(pos + m[0].length, pos + m[0].length + 15);
    let qty = 1;
    const beforeQty = before.match(/(?:^|[^A-Z0-9])(\d+)\s*[X×]?\s*(?:OF\s+)?(?:THE\s+)?$/);
    const afterQty = after.match(/^\s*[X×]?\s*(\d+)(?![A-Z0-9])/i);
    if (afterQty) qty = parseInt(afterQty[1]);
    else if (beforeQty) qty = parseInt(beforeQty[1]);
    
    rawMatches.push({ baseSku: family, qty, position: pos });
  }
}
```

IMPORTANT: This must go AFTER the existing skuPatterns loop (after line ~3152) but BEFORE the `foundItems` filter (line ~3154). The bare family names like "MS150" will then flow through validateSku() which already handles partial matches correctly and returns the real catalog variants.

═══════════════════════════════════════════════════════════════════════
CHANGE 4: Fix multi-product split — show quote + clarify together
═══════════════════════════════════════════════════════════════════════

LOCATION: In the quote generation function, around lines 3535-3543 (the section that starts "// If some items are invalid but others are valid/EOL, proceed with valid items").

PROBLEM: When MR36 is valid and MS150 needs clarification, the current code says "_The items above were skipped. Quote generated for recognized models below._" This is wrong for partial-match items — they weren't invalid, they just need variant selection.

FIX: Replace lines 3538-3543:
```js
  let lines = [];
  // Prepend invalid SKU warnings when processing alongside valid items
  if (errors.length > 0) {
    lines.push(...errors, '');
    lines.push('_The items above were skipped. Quote generated for recognized models below._', '');
  }
```

With:
```js
  let lines = [];
  // Separate truly invalid SKUs from those that just need variant clarification
  if (errors.length > 0) {
    // Check which errors are actually partial-match variant questions
    const variantPrompts = [];
    const trueErrors = [];
    for (const err of errors) {
      // Errors that contain bullet points (•) are variant suggestions, not true errors
      if (err.includes('•') || err.includes('Which one do you need?') || err.includes('Did you mean')) {
        variantPrompts.push(err);
      } else {
        trueErrors.push(err);
      }
    }
    if (trueErrors.length > 0) {
      lines.push(...trueErrors, '');
      lines.push('_The items above could not be quoted._', '');
    }
    if (variantPrompts.length > 0) {
      lines.push(...variantPrompts, '');
    }
  }
```

Also, the logic that builds "errors" array needs to include the variant disambiguation messages. Currently, when ALL items are invalid AND partial matches (lines 3502-3531), it returns early with the clarify message. But when SOME items are valid, the partial-match items get added to `errors[]` as just their raw error string without the suggestion bullets. 

Find where errors are built (around line 3450-3500 area). The error messages for items that have partial matches should include the variant suggestions inline, like:
```
⚠️ **MS150** needs a variant — which one do you need?\n• MS150-24T-4G\n• MS150-24P-4G\n• MS150-48FP-4X\n...
```

Look for where `errors.push()` is called for invalid items in the resolvedItems loop. It probably just pushes a generic error string. Update it to include variant suggestions when available:

```js
// Where errors are accumulated (in the items processing loop):
const v = validateSku(baseSku);
if (!v.valid) {
  if (v.suggest && v.suggest.length > 0 && (v.isPartialMatch || v.isFuzzyMatch || v.isCommonMistake)) {
    // Include suggestions in the error message
    const family = detectFamily(baseSku.toUpperCase()) || baseSku.toUpperCase();
    let msg = `**${baseSku.toUpperCase()}** — which variant do you need?`;
    for (const s of v.suggest.slice(0, 8)) msg += `\n• ${s}`;
    errors.push(msg);
  } else {
    errors.push(`⚠️ **${baseSku.toUpperCase()}** is not a recognized SKU.`);
  }
}
```

═══════════════════════════════════════════════════════════════════════
CHANGE 5: Fix accessory 3-identical-URL display
═══════════════════════════════════════════════════════════════════════

LOCATION: In the URL generation section of the quote output, after all URLs are built (search for where 1-Year/3-Year/5-Year labels are applied — around line 3700-3800 area).

PROBLEM: Accessories (MA- prefix) have no license. The bot shows 3 identical URLs with different term labels.

FIX: Before outputting the final 1Y/3Y/5Y URLs, check if ALL items in this quote are license-free (accessories). If so, output a single URL without term labels:

```js
// Check if ALL resolved items are accessories (no license component)
const allAccessories = resolvedItems.every(item => 
  item.licenseSkus.length === 0 || item.baseSku.startsWith('MA-')
);

if (allAccessories) {
  // Single URL output — no term differentiation needed
  const itemSkus = resolvedItems.map(i => i.hwSku);
  const qtys = resolvedItems.map(i => i.qty);
  const url = `https://stratusinfosystems.com/order/?item=${itemSkus.join(',')}&qty=${qtys.join(',')}`;
  lines.push(`**Order Link:** ${url}`);
} else {
  // Normal 1Y/3Y/5Y output...
  [existing code]
}
```

Find the exact location by searching for where "1-Year Co-Term:" is composed in the output lines.

═══════════════════════════════════════════════════════════════════════
CHANGE 6: Fix Claude fallback — anti-hallucination + specs injection
═══════════════════════════════════════════════════════════════════════

LOCATION: In the askClaude() function (~line 4260), and the SYSTEM_PROMPT constant (~line 3879).

PROBLEM A: Advisory questions like "what firewall for 100 employees" have no model names, so getStaticSpecsContext() returns null. Claude hallucinates specs from training data.

PROBLEM B: The wantsLiveDatasheet regex doesn't catch "did you check the datasheet" or "check it to make sure".

PROBLEM C: When specs.json is injected but history has conflicting hallucinated specs, Claude may trust its history.

FIX A — Add category-based specs injection in askClaude() (after line 4309):

After `const staticContext = getStaticSpecsContext(userMessage);` add:
```js
    // If no static context from model names, try category keywords for advisory questions
    let categoryContext = null;
    if (!staticContext) {
      const catUpper = userMessage.toUpperCase();
      const families = [];
      if (/\b(FIREWALL|SECURITY\s*APPLIANCE|MX|GATEWAY)\b/.test(catUpper)) families.push('MX');
      if (/\b(ACCESS\s*POINT|WIFI|WI-?FI|WIRELESS|AP)\b/.test(catUpper)) families.push('MR', 'CW');
      if (/\b(SWITCH|SWITCHING)\b/.test(catUpper)) families.push('MS130', 'MS150');
      if (/\b(CAMERA|SURVEILLANCE|VIDEO)\b/.test(catUpper)) families.push('MV');
      if (/\b(SENSOR)\b/.test(catUpper)) families.push('MT');
      if (/\b(CELLULAR|LTE|5G|WAN\s*GATEWAY)\b/.test(catUpper)) families.push('MG');
      
      if (families.length > 0) {
        let ctx = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE)\n';
        ctx += 'Use ONLY these specs. Do NOT supplement with training data. If a spec is not listed here, say you do not have that data and offer to check the datasheet.\n\n';
        for (const fam of families) {
          const familyData = specs[fam];
          if (familyData) {
            for (const [model, modelSpecs] of Object.entries(familyData)) {
              ctx += `${model}: ${JSON.stringify(modelSpecs)}\n`;
            }
          }
        }
        categoryContext = ctx;
      }
    }
    if (staticContext) systemPrompt += '\n\n' + staticContext;
    else if (categoryContext) systemPrompt += '\n\n' + categoryContext;
```

Remove the original line 4310: `if (staticContext) systemPrompt += '\n\n' + staticContext;` since it's now in the if/else block above.

FIX B — Broaden the wantsLiveDatasheet regex (line 4264):

Replace:
```js
let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?LATEST|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET)\b/i.test(userMessage);
```

With:
```js
let wantsLiveDatasheet = /\b(VERIFY|CHECK\s+(THE\s+)?(LATEST|DATASHEET|SPECS?)|LATEST\s+DATASHEET|PULL\s+(THE\s+)?DATASHEET|SCAN\s+(THE\s+)?DATASHEET|CHECK\s+FOR\s+UPDATES|CHECK\s+IT|MAKE\s+SURE|CONFIRM\s+(THE\s+)?(SPECS?|DATA)|DID\s+YOU\s+CHECK|YES.*DATASHEET|YEAH.*DATASHEET|SURE.*DATASHEET|PLEASE.*DATASHEET)\b/i.test(userMessage);
```

FIX C — Add history-override preamble. In the getStaticSpecsContext() function (line 382-384), change:

```js
let context = '## PRODUCT SPECS (from specs.json, current as of March 2026)\n';
context += 'Use ONLY these specs when answering. Do not supplement with training data.\n';
context += 'After answering, add: "*Specs current as of March 2026. Want me to pull the latest datasheet to check for updates?"\n\n';
```

To:
```js
let context = '## PRODUCT SPECS (from specs.json — AUTHORITATIVE SOURCE)\n';
context += 'CRITICAL: Use ONLY these specs when answering. Do NOT supplement with training data. These specs OVERRIDE any conflicting information in conversation history — if prior messages contain different numbers, they were wrong and these are correct.\n';
context += 'If the user asks about a spec not listed here, say "I don\'t have that specific spec cached — want me to pull the latest datasheet to confirm?"\n';
context += 'After answering, add: "*Specs from product database. Want me to pull the latest datasheet to verify?*"\n\n';
```

FIX D — Add to SYSTEM_PROMPT (line 3887 area, after "NEVER assume a product exists"):

Add after "NEVER assume a product exists. NEVER invent SKUs, pricing, or specifications.":
```
CRITICAL ANTI-HALLUCINATION RULES:
- NEVER state product specifications unless they are provided in this prompt via a "PRODUCT SPECS" section.
- If no specs are provided and the user asks about throughput, user counts, performance, etc., say: "I don't have verified specs for that model in my current data. Want me to pull the latest datasheet?"
- When listing model options or variants, ONLY list models from the VALID PRODUCT CATALOG section. Never suggest model numbers that aren't explicitly listed.
- If conversation history contains specs that conflict with an injected PRODUCT SPECS section, the injected specs are ALWAYS correct.
```

═══════════════════════════════════════════════════════════════════════
CHANGE 7: Fix Workers AI clarify path — add MS150 + current families to variant tables
═══════════════════════════════════════════════════════════════════════

LOCATION: The CF_CLASSIFIER_PROMPT constant (around line 544-604), specifically the "VARIANT CLARIFICATION TABLES" section.

PROBLEM: The variant tables only cover MS130/MS210/MS225/MS250/MS390. When the classifier encounters "MS150" it has no table to reference, so it hallucinates variants.

FIX: Add these entries to the "MS switches with variants" table (after the MS390 entries, around line 581):

```
- MS150-24: 24-port → MS150-24T-4G (no PoE, 1G uplinks), MS150-24P-4G (PoE, 1G uplinks), MS150-24T-4X (no PoE, 10G uplinks), MS150-24P-4X (PoE, 10G uplinks), MS150-24MP-4X (mGig PoE, 10G uplinks)
- MS150-48: 48-port → MS150-48T-4G (no PoE, 1G), MS150-48LP-4G (partial PoE, 1G), MS150-48FP-4G (full PoE, 1G), MS150-48T-4X (no PoE, 10G), MS150-48LP-4X (partial PoE, 10G), MS150-48FP-4X (full PoE, 10G), MS150-48MP-4X (mGig PoE, 10G)
- MS150 (no port count): Ask "24-port or 48-port?" first, then ask variant.
```

Also add to the "CRITICAL RULES" section of CF_CLASSIFIER_PROMPT:
```
- When generating variant clarifications, ONLY suggest models from the variant tables above. NEVER invent model numbers like "MS150-8" or "MS150-16" — those do not exist.
- If a bare family name is given (e.g., "MS150", "MS130") with a port count ambiguity, ask port count FIRST, then variant.
```

Also update the Product families list (line 595) to replace outdated info:
```
MS switches: MS130 (8/12/24/48-port, 1G/10G), MS150 (24/48-port, 1G/10G, replaces MS210/220/225/320), MS390 (24/48-port, mGig), MS450 (12-port)
```

═══════════════════════════════════════════════════════════════════════
CHANGE 8: Classifier prompt — prepare for Llama V2 cutover
═══════════════════════════════════════════════════════════════════════

NOTE: Do NOT flip the router yet. Just prepare the code path so it's ready to enable with a single flag change.

LOCATION: Near the top of the webhook handler (~line 5000 area), where classification drives routing.

Add a feature flag constant near the top of the file (after the model constants around line 542):

```js
// Feature flag: when true, Schema V2 classifier (Llama) drives routing instead of legacy
const USE_V2_CLASSIFIER = false; // Flip to true after shadow data confirms parity
```

Then in the webhook handler, after the three-way classification Promise.all, add a conditional that would use v2Classification for routing when enabled:

```js
// Prepare for V2 cutover — when enabled, v2 drives routing with legacy fallback
let activeClassification = classification; // legacy by default
if (USE_V2_CLASSIFIER && v2Classification && !v2Classification.parseError) {
  // Map V2 schema intent to legacy format for routing compatibility
  activeClassification = {
    intent: v2Classification.intent,
    reply: v2Classification.reply || '',
    extracted: v2Classification.items?.map(i => `${i.qty || 1} ${i.sku}`).join(', ') || '',
    elapsed: v2Classification.elapsed,
    // Preserve V2 rich structure for downstream use
    _v2: v2Classification
  };
  console.log(`[V2-Active] Using V2 classifier: intent=${activeClassification.intent}`);
} else if (USE_V2_CLASSIFIER && !v2Classification) {
  console.log(`[V2-Fallback] V2 failed, using legacy classifier`);
}
```

Then replace all instances of `classification.intent` in the routing logic with `activeClassification.intent`, `classification.reply` with `activeClassification.reply`, and `classification.elapsed` with `activeClassification.elapsed`.

═══════════════════════════════════════════════════════════════════════
TESTING
═══════════════════════════════════════════════════════════════════════

After all changes:

1. Run `node test-local.js` in the worker directory
2. Send test messages via Webex MCP to the bot DM room:
   - "2 MS150 switches" → should get variant disambiguation from deterministic engine
   - "what firewall for 100 employees" → should get response with correct MX specs from specs.json
   - "MX85-SDW 1yr 3yr 5yr" → should route through deterministic with SDW tier
   - "MA-INJ-4 x 2" → should show single URL
   - "3 MR36 and 2 MS150" → should show MR36 quote + MS150 variant question together
3. Run the benchmark: `node benchmark-runner.js --limit 74` from /work directory

═══════════════════════════════════════════════════════════════════════
DEPLOY
═══════════════════════════════════════════════════════════════════════

Do NOT deploy without Chris's explicit approval. Use GitHub API push pattern (never git add/commit from sandbox on mounted repos):

1. Create blob via GitHub API
2. Create tree
3. Create commit  
4. Update ref

GitHub Actions CI auto-deploys both workers on push to main.

PAT: <stored in local CLAUDE.md (rotated every 30 days, never committed)>
Repo: cjgraves1119/stratus-bot-v2
```

---

## Summary of All Changes

| # | Area | Problem | Fix |
|---|---|---|---|
| 1 | Classifier V2 prompt | "MX85-SDW" kept as one SKU, tier not extracted | Add rule: split tier suffix from SKU |
| 2 | Benchmark runner | qty:null treated as literal value | Use != null instead of !== undefined |
| 3 | parseMessage() | Bare family names (MS150, MS130, etc.) not matched by regex | Add bareFamilyPatterns section |
| 4 | Quote output | Valid items quoted, ambiguous items "skipped" silently | Show quote + variant prompt together |
| 5 | Quote output | Accessories show 3 identical URLs | Detect all-accessory quotes, single URL |
| 6 | askClaude() | No specs for advisory questions, weak datasheet regex, history conflicts | Category injection, broader regex, override preamble |
| 7 | CF_CLASSIFIER_PROMPT | No MS150 variant table, allows hallucinated models | Add MS150 variants, anti-hallucination rule |
| 8 | Webhook routing | Prepare V2 cutover path | Feature flag + mapping layer (disabled) |
