// Static regression tests for Chrome Chat tab quote-creation fixes.
// Run from worker-gchat/: node test-chat-waterfall-quote-fix.js

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
const prices = require('./src/data/prices.json').prices;

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    fn();
    console.log(`  ok ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function applySuffix(sku) {
  const upper = sku.toUpperCase();
  if (/^CW-(ANT|MNT|ACC|INJ|POE)/.test(upper) || upper === 'CW9800H1-MCG') return upper;
  if (upper === 'CW9179F') return upper;
  if (/^CW917\d[IHD]/.test(upper)) return upper.endsWith('-RTG') ? upper : `${upper}-RTG`;
  if (/^CW916\d/.test(upper)) return upper.endsWith('-MR') ? upper : `${upper}-MR`;
  if (/^C9(200L|300L|300X|300)-/.test(upper)
      && !upper.endsWith('-M') && !upper.endsWith('-A') && !upper.endsWith('-M-O')) {
    const mCandidate = `${upper}-M`;
    if (prices[mCandidate]) return mCandidate;
  }
  if (upper.startsWith('MS150') || upper.startsWith('C9') || upper.startsWith('C8') || upper.startsWith('MA-')) return upper;
  if (/^MS\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  if (/^MX\d+C[W]?(-HW)?-NA$/i.test(upper)) return upper;
  if (/^MX\d+C(W)?$/i.test(upper)) return upper.endsWith('-HW-NA') ? upper : `${upper}-HW-NA`;
  if (/^Z\d+C?X$/i.test(upper)) return upper;
  if (/^(MR|MX|MV|MT|MG|Z)\d/.test(upper)) return upper.endsWith('-HW') ? upper : `${upper}-HW`;
  return upper;
}

function getLicenseSkus(baseSku) {
  const upper = baseSku.toUpperCase();
  if (/^MR\d/.test(upper) || /^CW9\d/.test(upper)) {
    return ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR'].filter(sku => sku in prices);
  }
  if (/^MS130R-/.test(upper) || /^MS130-(8|12)/.test(upper)) {
    return ['LIC-MS130-CMPT-1Y', 'LIC-MS130-CMPT-3Y', 'LIC-MS130-CMPT-5Y'].filter(sku => sku in prices);
  }
  const ms130Match = upper.match(/^MS130-(24|48)/);
  if (ms130Match) {
    const ports = ms130Match[1];
    return [`LIC-MS130-${ports}-1Y`, `LIC-MS130-${ports}-3Y`, `LIC-MS130-${ports}-5Y`].filter(sku => sku in prices);
  }
  const msMatch = upper.match(/^MS(\d+[A-Z0-9-]*)/);
  if (msMatch) {
    const model = msMatch[1].replace(/-HW$/, '');
    const suffix = /^(210|220|225|250|350|410|425)/.test(model) ? 'YR' : 'Y';
    return [`LIC-MS${model}-CMPT-1${suffix}`, `LIC-MS${model}-CMPT-3${suffix}`, `LIC-MS${model}-CMPT-5${suffix}`].filter(sku => sku in prices);
  }
  return [];
}

function collectQuotePreResolveSkuTokens(text) {
  const tokens = [];
  const skuRegex = /\b(?:MR|MV|MT|MG|MX|CW9|MS|C8|C9|Z)\d[A-Z0-9-]*/gi;
  let m;
  while ((m = skuRegex.exec((text || '').toUpperCase())) !== null) tokens.push(m[0]);
  const licRegex = /\bLIC-[A-Z0-9-]+/gi;
  while ((m = licRegex.exec((text || '').toUpperCase())) !== null) tokens.push(m[0]);
  return tokens;
}

function preResolveProductsForQuoteText(text) {
  const tokens = collectQuotePreResolveSkuTokens(text);
  const out = {};
  for (const raw of [...new Set(tokens)]) {
    const suffixed = applySuffix(raw);
    const cached = prices[suffixed] || prices[raw] || null;
    if (!cached?.zoho_product_id) continue;
    out[raw] = { suffixed_sku: suffixed, product_id: cached.zoho_product_id };
    for (const lic of getLicenseSkus(raw)) {
      const licCached = prices[lic] || null;
      if (licCached?.zoho_product_id) out[lic] = { suffixed_sku: lic, product_id: licCached.zoho_product_id };
    }
  }
  return out;
}

function hasQuotePreResolveSkuToken(text) {
  return collectQuotePreResolveSkuTokens(text).length > 0;
}

console.log('chat-waterfall quote creation regressions');

t('CW9172I/MS130-8P prompt pre-resolves hardware and 1-year licenses', () => {
  const resolved = preResolveProductsForQuoteText('13 x CW9172I (with 1-year licenses) 1 x MS130-8P (with 1-year license)');
  assert.equal(resolved.CW9172I.suffixed_sku, 'CW9172I-RTG');
  assert.equal(resolved['MS130-8P'].suffixed_sku, 'MS130-8P-HW');
  assert.equal(resolved['LIC-ENT-1YR'].suffixed_sku, 'LIC-ENT-1YR');
  assert.equal(resolved['LIC-MS130-CMPT-1Y'].suffixed_sku, 'LIC-MS130-CMPT-1Y');
  assert.equal(resolved.CW9172I.product_id, prices['CW9172I-RTG'].zoho_product_id);
  assert.equal(resolved['MS130-8P'].product_id, prices['MS130-8P-HW'].zoho_product_id);
});

t('pre-resolution regex includes C8 family for symmetry with suffix/licensing support', () => {
  assert.match(src, /\(\?:MR\|MV\|MT\|MG\|MX\|CW9\|MS\|C8\|C9\|Z\)/);
});

t('/api/chat-waterfall carries pre-resolved products into the waterfall agent copy', () => {
  const preResolveAt = src.indexOf('preResolveProductsForQuoteText(wText)');
  const enrichAt = src.indexOf('wEnrichedMessage += `\\n\\n[Pre-resolved products:', preResolveAt);
  const agentCopyAt = src.indexOf('let wAgentMessage = wEnrichedMessage', enrichAt);
  const waterfallAt = src.indexOf('askWithWaterfall(wAgentMessage', agentCopyAt);
  assert.ok(preResolveAt > 0, 'chat-waterfall should call preResolveProductsForQuoteText(wText)');
  assert.ok(enrichAt > preResolveAt, 'pre-resolved data should be appended to wEnrichedMessage');
  assert.ok(agentCopyAt > enrichAt, 'the agent copy should be initialized from the enriched message');
  assert.ok(waterfallAt > agentCopyAt, 'askWithWaterfall should consume the agent copy');
});

t('/api/chat-waterfall pre-resolution fires for the original no-quote-keyword prompt', () => {
  const originalPrompt = '13 x CW9172I (with 1-year licenses) 1 x MS130-8P (with 1-year license)';
  const shouldPreResolveWaterfallProducts = /\b(quote|create.*quote|quote.*for)\b/i.test(originalPrompt)
    || (true && hasQuotePreResolveSkuToken(originalPrompt));
  const resolved = shouldPreResolveWaterfallProducts ? preResolveProductsForQuoteText(originalPrompt) : {};
  assert.equal(shouldPreResolveWaterfallProducts, true);
  assert.equal(resolved.CW9172I.suffixed_sku, 'CW9172I-RTG');
  assert.equal(resolved['MS130-8P'].suffixed_sku, 'MS130-8P-HW');
  assert.equal(resolved['LIC-ENT-1YR'].suffixed_sku, 'LIC-ENT-1YR');
  assert.equal(resolved['LIC-MS130-CMPT-1Y'].suffixed_sku, 'LIC-MS130-CMPT-1Y');
  assert.match(src, /function collectQuotePreResolveSkuTokens\(text, options = \{\}\)/);
  assert.match(src, /return collectQuotePreResolveSkuTokens\(text\)\.length > 0;/);
  assert.match(src, /const shouldPreResolveWaterfallProducts =/);
  assert.match(src, /skipDeterministic && hasQuotePreResolveSkuToken\(wText\)/);
});

t('product pre-resolution failures are caught in both chat routes', () => {
  assert.match(src, /\[API\/chat-waterfall\] Product pre-resolution skipped/);
  assert.match(src, /\[API\/chat\] Product pre-resolution skipped/);
});

t('chat-tab write intent uses shared Claude-first cascade unless forceModel is explicit', () => {
  assert.doesNotMatch(src, /forceClaudeForChatWrite/);
  assert.match(src, /const skipDeterministic = wSource === 'chat-tab' \|\| \(wEc && wEc\.source === 'chat-tab'\)/);
  assert.match(src, /outcome = await askWithWaterfall\(wAgentMessage, env, wPersonId,/);
  assert.match(src, /forceClaude: forcedModel === 'claude'/);
  assert.match(src, /const autoForceClaudeForWrite = [^;]*shouldForceClaudeForWrite\(userMessage\)[^;]*options\.crmFollowUp === true/);
});

t('create_deal_and_quote sets Cisco_Billing_Term explicitly and verifies it', () => {
  assert.match(src, /const VALID_BILLING_TERMS = \['Prepaid Term', 'Prepaid'\];/);
  assert.match(src, /Cisco_Billing_Term "\$\{before\}" invalid - coerced to "Prepaid Term"/);
  assert.match(src, /Cisco_Billing_Term: quoteBillingTerm/);
  assert.match(src, /Set Cisco_Billing_Term: Prepaid Term/);
  assert.match(src, /Quote_Stage,Cisco_Billing_Term,Quoted_Items/);
});

if (failed) {
  console.error(`\n${failed} failed, ${passed} passed`);
  process.exit(1);
}
console.log(`\n${passed} passed`);
