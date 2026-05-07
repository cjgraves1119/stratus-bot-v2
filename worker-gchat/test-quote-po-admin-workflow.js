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
const validateQuoteToPoFinancialParity = Function(`"use strict";
const MAX_AUTO_TAX_RATE = 0.13;
${extractFunction('moneyValue')}
${extractFunction('roundMoney')}
${extractFunction('closeMoney')}
${extractFunction('booleanishTaxValue')}
${extractFunction('detectTaxExemptContext')}
${extractFunction('quotePoLineItems')}
${extractFunction('recordTaxTotal')}
${extractFunction('recordGrandTotal')}
${extractFunction('recordPreTaxTotal')}
${extractFunction('quotePoProductKey')}
${extractFunction('quotePoLineNet')}
${extractFunction('quotePoLineNetTotal')}
${extractFunction('quotePoLineFingerprint')}
${extractFunction('quotePoLineItemsMatch')}
${extractFunction('validateQuoteToPoFinancialParity')}
return validateQuoteToPoFinancialParity;
`)();
const detectTaxExemptContext = Function(`"use strict";
${extractFunction('booleanishTaxValue')}
${extractFunction('detectTaxExemptContext')}
return detectTaxExemptContext;
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
assert.match(source, /state: 'po_financial_mismatch'/, 'workflow blocks e-signature on non-tax financial mismatch');
assert.match(source, /automatically tax only some line items, all line items, or no line items/, 'tool schema allows mixed automatic tax behavior');
assert.match(source, /Taxes are informational only/, 'workflow does not block e-signature solely because of tax');
assert.match(source, /pre-tax\/ecomm line economics match/, 'admin prompt treats pre-tax ecomm economics as the approval gate');
assert.match(source, /blocks if line-item detail is unavailable/, 'tool schema blocks when line detail is unavailable');
assert.equal(shouldForceClaudeForWrite('send Lisa a contract for 1 MV73M'), true);

const workflowBody = extractFunction('handleQuoteToPoAndEsign');
assert.doesNotMatch(workflowBody, /Stage\s*:/, 'quote_to_po workflow never writes Stage');
assert.doesNotMatch(workflowBody, /Quote_Stage\s*:/, 'quote_to_po workflow never writes Quote_Stage');

const quote = {
  Grand_Total: 1830,
  All_Taxes_Total: 0,
  Quoted_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 1830 }
  ]
};
const taxablePo = {
  Grand_Total: 2031.41,
  All_Taxes_Total: 201.41,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 1830 }
  ]
};
const taxablePoMissingHeaderTax = {
  Grand_Total: 2031.41,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 1830 }
  ]
};
const taxExemptQuote = {
  ...quote,
  Tax_Exempt: 'Yes'
};
const nonTaxableAccountContext = {
  checked: true,
  tax_exempt: true,
  source: 'Account',
  field: 'Taxable',
  value: false
};
const taxableAccountContext = {
  checked: true,
  tax_exempt: false,
  source: 'Account',
  field: 'Taxable',
  value: true
};
const unknownTaxContext = {
  checked: false,
  tax_exempt: false,
  reason: 'tax_status_not_found'
};
const taxExemptBadPo = {
  Grand_Total: 2031.41,
  All_Taxes_Total: 0,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 2031.41 }
  ]
};
const excessiveTaxPo = {
  Grand_Total: 2130,
  All_Taxes_Total: 300,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 1830 }
  ]
};
const noLineDetailPo = {
  Grand_Total: 2031.41,
  All_Taxes_Total: 201.41
};
const productMismatchPo = {
  Grand_Total: 1830,
  All_Taxes_Total: 0,
  Ordered_Items: [
    { Product_Name: { id: 'MV73X-HW' }, Quantity: 1, Total_After_Discount: 1830 }
  ]
};
const qtyMismatchPo = {
  Grand_Total: 1830,
  All_Taxes_Total: 0,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 2, Total_After_Discount: 1830 }
  ]
};
const lowerTotalPo = {
  Grand_Total: 1628.59,
  All_Taxes_Total: 0,
  Ordered_Items: [
    { Product_Name: { id: 'MV73M-HW' }, Quantity: 1, Total_After_Discount: 1628.59 }
  ]
};

assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo, { tax_exempt_context: taxableAccountContext }).ok, true, 'confirmed-taxable tax-only grand total drift is allowed');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo).mismatch_is_tax_only, true, 'tax-only drift is identified');
assert.equal(validateQuoteToPoFinancialParity(taxExemptQuote, taxablePo).ok, true, 'tax-exempt quote still approves when pre-tax ecomm pricing matches');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo, { tax_exempt_context: nonTaxableAccountContext }).ok, true, 'tax-exempt account context does not block automatic tax when pre-tax ecomm pricing matches');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePoMissingHeaderTax).ok, true, 'line net totals approve tax-only drift even when header tax total is unavailable');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo, { tax_exempt_context: unknownTaxContext }).tax_status_undetermined_with_tax, false, 'unknown tax status with nonzero PO tax is not a validation flag');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo, { tax_exempt_context: unknownTaxContext }).tax_observation.tax_status_undetermined_with_tax, true, 'unknown tax status with nonzero PO tax is retained as informational context');
assert.equal(validateQuoteToPoFinancialParity(quote, taxablePo, { tax_exempt_context: unknownTaxContext }).ok, true, 'unknown tax status does not block when pre-tax ecomm pricing matches');
assert.equal(detectTaxExemptContext([
  { source: 'Quote', record: { Taxable: true } },
  { source: 'Account', record: { Tax_Exempt: 'Yes' } }
]).tax_exempt, true, 'any exempt Account signal wins over a taxable Quote default');
assert.equal(detectTaxExemptContext([
  { source: 'Account', record: { Tax_Status: 'Government' } }
]).tax_exempt, true, 'tax status picklist values can identify exempt accounts');
assert.equal(detectTaxExemptContext([
  { source: 'Account', record: { Tax_Exemption_Number: '31-1234567' } }
]).tax_exempt, true, 'non-empty tax exemption identifiers identify exempt accounts');
assert.equal(detectTaxExemptContext([
  { source: 'Quote', record: { Taxable: true } },
  { source: 'Account', record: { Account_Name: 'City of Zanesville' } }
]).checked, false, 'quote-level taxable default does not confirm taxable status when Account tax context is missing');
assert.equal(validateQuoteToPoFinancialParity(
  { ...quote, Taxable: true },
  taxablePo,
  { tax_exempt_context: detectTaxExemptContext([{ source: 'Account', record: { __tax_context_fetch_error: 'timeout' } }]) }
).ok, true, 'Account fetch errors do not block when pre-tax ecomm pricing matches');
assert.equal(validateQuoteToPoFinancialParity(
  { ...quote, Taxable: true },
  taxablePo,
  { tax_exempt_context: detectTaxExemptContext([{ source: 'Account', record: { __tax_context_account_unresolved: 'Account_Name did not contain a readable Account id' } }]) }
).ok, true, 'unresolvable Account_Name does not block when pre-tax ecomm pricing matches');
assert.equal(validateQuoteToPoFinancialParity(quote, taxExemptBadPo).ok, false, 'tax-exempt non-tax drift is blocked');
assert.equal(validateQuoteToPoFinancialParity(quote, excessiveTaxPo).ok, true, 'tax amount alone does not block when pre-tax ecomm pricing matches');
assert.equal(validateQuoteToPoFinancialParity(quote, noLineDetailPo).ok, false, 'missing PO line detail is blocked');
assert.equal(validateQuoteToPoFinancialParity(quote, productMismatchPo).ok, false, 'product mismatch is blocked even when totals match');
assert.equal(validateQuoteToPoFinancialParity(quote, qtyMismatchPo).ok, false, 'quantity mismatch is blocked even when totals match');
assert.equal(validateQuoteToPoFinancialParity(quote, lowerTotalPo).ok, false, 'lower PO total is not explained by tax and is blocked');

console.log('quote/PO admin workflow regression checks passed');
