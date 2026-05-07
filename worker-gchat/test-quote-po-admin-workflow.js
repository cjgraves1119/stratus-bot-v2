#!/usr/bin/env node
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} signature has an opening body brace`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function getFunction(name) {
  return Function(`"use strict"; ${extractFunction(name)}; return ${name};`)();
}

const shouldForceClaudeForWrite = getFunction('shouldForceClaudeForWrite');
const isHardwareOnlyQuoteIntent = getFunction('isHardwareOnlyQuoteIntent');
const collectQuotePreResolveSkuTokens = Function(`"use strict";
${extractFunction('isHardwareOnlyQuoteIntent')}
${extractFunction('collectQuotePreResolveSkuTokens')}
return collectQuotePreResolveSkuTokens;
`)();

assert.equal(shouldForceClaudeForWrite('convert quote to PO, then send PO using admin actions'), true);
assert.equal(shouldForceClaudeForWrite('fire the DID and submit to CCW'), true);
assert.equal(shouldForceClaudeForWrite('create quote for 1 MV73M hardware only'), true);
assert.equal(shouldForceClaudeForWrite('what is the most recent Zanesville quote total?'), false);

assert.equal(isHardwareOnlyQuoteIntent('1 MV73M hardware only'), true);
assert.equal(isHardwareOnlyQuoteIntent('just the hardware, no license'), true);
assert.deepEqual(collectQuotePreResolveSkuTokens('MV73M-HW plus LIC-MV-1YR hardware only'), ['MV73M-HW']);

assert.match(source, /case 'quote_to_po_and_esign'/, 'tool executor handles quote_to_po_and_esign');
assert.match(source, /name: 'quote_to_po_and_esign'/, 'tool schema exposes quote_to_po_and_esign');
assert.match(source, /force_create_po/, 'existing PO override is explicit');
assert.match(source, /state: 'existing_po_found'/, 'existing PO block is present');
assert.match(source, /findLinkedSalesOrderFromQuote/, 'quote linkage fallback is present');
assert.match(source, /fetchSalesOrderByReference/, 'quote linkage can resolve SO id or SO_Number');
assert.match(source, /LIVE_SendToEsign/, 'e-sign admin action is present');
assert.match(source, /moduleName: 'Sales_Orders'[\s\S]{0,180}actionName: 'LIVE_SendToEsign'/, 'LIVE_SendToEsign runs on Sales_Orders');
assert.match(source, /include_licenses/, 'hardware-only quote path exposes include_licenses');
assert.match(source, /hardware_only_no_licenses/, 'hardware-only quote path records license policy');
assert.match(source, /Admin_Action updates must not include Quote_Stage/, 'Quote admin-action stage guard is present');
assert.match(source, /Quotes do not use the Deal Stage field/, 'Quote Stage guard is present');
assert.match(source, /claude-write-intent/, 'Claude-first write routing is tagged');
assert.match(source, /cascading to normal waterfall/, 'Claude-first routing has fallback');
assert.doesNotMatch(source, /forceClaudeForChatWrite/, 'chat tab uses the same Claude-first cascade path as chat-waterfall');
assert.match(source, /state: 'sales_order_deal_mismatch'/, 'explicit Sales Order e-sign path validates Deal linkage');
assert.match(source, /requestedDealId !== dealId/, 'Sales Order mismatch prevents wrong-Deal e-signature send');
assert.match(source, /Net_Terms was blank, so it was defaulted to Cash/, 'automatic Cash terms are surfaced to the user');
assert.match(source, /writeProgressEvent\(env, env\.__PROGRESS_ID/, 'compound quote workflow emits progress events');
assert.match(source, /slice\(0, 20\)/, 'quote-specific SO matching checks more than the first eight Sales Orders');

const workflowBody = extractFunction('handleQuoteToPoAndEsign');
assert.doesNotMatch(workflowBody, /Stage\s*:/, 'quote_to_po workflow never writes Stage');
assert.doesNotMatch(workflowBody, /Quote_Stage\s*:/, 'quote_to_po workflow never writes Quote_Stage');

console.log('quote/PO admin workflow regression checks passed');
