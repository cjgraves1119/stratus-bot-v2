#!/usr/bin/env node
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { dirname, join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');
const priceSource = readFileSync(join(here, 'src/data/prices.json'), 'utf8');
const staticPriceSnapshot = JSON.parse(priceSource).prices;

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists`);
  const sliceStart = source.slice(Math.max(0, start - 6), start) === 'async ' ? start - 6 : start;
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} signature has an opening body brace`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') depth--;
    if (depth === 0) return source.slice(sliceStart, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function getFunction(name) {
  return Function(`"use strict"; ${extractFunction(name)}; return ${name};`)();
}

const shouldForceClaudeForWrite = getFunction('shouldForceClaudeForWrite');
const isHardwareOnlyQuoteIntent = getFunction('isHardwareOnlyQuoteIntent');
const salesOrderEsignErrorMessage = getFunction('salesOrderEsignErrorMessage');
const salesOrderVendorReference = Function(`"use strict";
function zohoLookupId(value) {
  if (!value) return null;
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'object') return value.id || value.ID || value.value || value.name || null;
  return null;
}
${extractFunction('salesOrderVendorReference')}
return salesOrderVendorReference;
`)();
const quoteVendorHelpers = Function(`"use strict";
const staticPrices = ${JSON.stringify(staticPriceSnapshot)};
let livePrices = null;
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
let _productIdToSku = null;
function zohoLookupId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || value.ID || value.record_id || null;
}
const DEFAULT_QUOTE_VENDOR = 'TD SYNNEX CORPORATION';
${extractFunction('applySuffix')}
${extractFunction('resolveApprovedCatalogSku')}
${extractFunction('approvedCatalogEntry')}
${extractFunction('getProductIdToSkuMap')}
${extractFunction('quoteLineItemSku')}
${extractFunction('productRefId')}
${extractFunction('vendorDisplayValue')}
${extractFunction('quoteRequiredVendorValue')}
${extractFunction('quoteVendorDiagnostics')}
${extractFunction('quoteVendorValue')}
${extractFunction('quotePoLineItems')}
${extractFunction('quoteRequiredFieldIssues')}
${extractFunction('quoteRequiredFieldPayload')}
return { quoteRequiredVendorValue, quoteVendorDiagnostics, quoteVendorValue, quoteRequiredFieldIssues, quoteRequiredFieldPayload };
`)();
const zohoTopLevelModuleFromCreatePath = Function(`"use strict";
const ZOHO_AI_CREATED_TAG_MODULES = new Set([
  'Accounts',
  'Contacts',
  'Deals',
  'Leads',
  'Quotes',
  'Sales_Orders',
  'Purchase_Orders',
  'Invoices',
  'Tasks'
]);
${extractFunction('zohoTopLevelModuleFromCreatePath')}
return zohoTopLevelModuleFromCreatePath;
`)();
const zohoCreatedRecordIds = getFunction('zohoCreatedRecordIds');
const catalogHelpers = Function(`"use strict";
const staticPrices = ${JSON.stringify(JSON.parse(priceSource).prices)};
let livePrices = null;
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
${extractFunction('applySuffix')}
${extractFunction('resolveApprovedCatalogSku')}
${extractFunction('approvedCatalogEntry')}
${extractFunction('approvedCatalogAlternatives')}
${extractFunction('notApprovedCatalogMessage')}
return { resolveApprovedCatalogSku, approvedCatalogEntry, approvedCatalogAlternatives, notApprovedCatalogMessage };
`)();
const rawQuoteGuardHelpers = Function(`"use strict";
const staticPrices = ${JSON.stringify(staticPriceSnapshot)};
let livePrices = null;
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
${extractFunction('isHardwareOnlyQuoteIntent')}
${extractFunction('applySuffix')}
${extractFunction('collectQuotePreResolveSkuTokens')}
${extractFunction('resolveApprovedCatalogSku')}
${extractFunction('approvedCatalogEntry')}
${extractFunction('approvedCatalogAlternatives')}
${extractFunction('notApprovedCatalogMessage')}
${extractFunction('rawUserPromptFromEnv')}
${extractFunction('rawUserPromptFromIncomingText')}
${extractFunction('rawPromptRequestsPoOrEsign')}
${extractFunction('rawPromptQuoteOnly')}
${extractFunction('requestedSkuBlocksFromRawPrompt')}
${extractFunction('rawQuoteSkuBlockPayload')}
${extractFunction('toolLooksLikeQuoteWrite')}
${extractFunction('validateRawQuoteSkuIntent')}
${extractFunction('validatePoOrEsignRequested')}
${extractFunction('validateStaleCatalogLookup')}
return {
  rawUserPromptFromIncomingText,
  rawPromptQuoteOnly,
  rawPromptRequestsPoOrEsign,
  requestedSkuBlocksFromRawPrompt,
  toolLooksLikeQuoteWrite,
  validateRawQuoteSkuIntent,
  validatePoOrEsignRequested,
  validateStaleCatalogLookup
};
`)();
const executeToolCallGuardOnly = Function(`"use strict";
const staticPrices = ${JSON.stringify(staticPriceSnapshot)};
let livePrices = null;
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
${extractFunction('isHardwareOnlyQuoteIntent')}
${extractFunction('applySuffix')}
${extractFunction('collectQuotePreResolveSkuTokens')}
${extractFunction('resolveApprovedCatalogSku')}
${extractFunction('approvedCatalogEntry')}
${extractFunction('approvedCatalogAlternatives')}
${extractFunction('notApprovedCatalogMessage')}
${extractFunction('rawUserPromptFromEnv')}
${extractFunction('rawPromptRequestsPoOrEsign')}
${extractFunction('rawPromptQuoteOnly')}
${extractFunction('requestedSkuBlocksFromRawPrompt')}
${extractFunction('rawQuoteSkuBlockPayload')}
${extractFunction('toolLooksLikeQuoteWrite')}
${extractFunction('validateRawQuoteSkuIntent')}
${extractFunction('validatePoOrEsignRequested')}
${extractFunction('executeToolCall')}
return executeToolCall;
`)();
const truthGuardHelpers = Function(`"use strict";
${extractFunction('zohoCrmTabModule')}
${extractFunction('verifiedSetHas')}
${extractFunction('addVerifiedSetValue')}
${extractFunction('quoteOrSalesOrderNumber')}
${extractFunction('collectVerifiedZohoRecordNumbers')}
${extractFunction('zohoRecordClaimSentenceBounds')}
${extractFunction('zohoRecordClaimLooksActionable')}
${extractFunction('sanitizeUnverifiedZohoRecordNumberClaims')}
${extractFunction('crmSummaryContainsRecordActionClaims')}
${extractFunction('verifiedCrmMutationSummaryReply')}
${extractFunction('unverifiedCrmMutationClaimFallback')}
${extractFunction('normalizeUndoTokenClaim')}
${extractFunction('sanitizeUnverifiedUndoTokenClaims')}
${extractFunction('replaceMixedUnverifiedCrmSummaryClaim')}
${extractFunction('sanitizeUnverifiedZohoUrls')}
return {
  addVerifiedSetValue,
  collectVerifiedZohoRecordNumbers,
  sanitizeUnverifiedZohoRecordNumberClaims,
  crmSummaryContainsRecordActionClaims,
  verifiedCrmMutationSummaryReply,
  sanitizeUnverifiedUndoTokenClaims,
  replaceMixedUnverifiedCrmSummaryClaim,
  sanitizeUnverifiedZohoUrls
};
`)();
const quotePreflightHelpers = Function(`"use strict";
const staticPrices = ${JSON.stringify(staticPriceSnapshot)};
let livePrices = null;
const prices = new Proxy(staticPrices, {
  get(target, prop) {
    if (livePrices && livePrices[prop]) return livePrices[prop];
    return target[prop];
  },
  has(target, prop) {
    if (livePrices && prop in livePrices) return true;
    return prop in target;
  }
});
let _productIdToSku = null;
${extractFunction('applySuffix')}
${extractFunction('resolveApprovedCatalogSku')}
${extractFunction('approvedCatalogEntry')}
${extractFunction('getProductIdToSkuMap')}
${extractFunction('isLikelyLicenseSku')}
${extractFunction('preflightQuotedItemsProductActive')}
return { preflightQuotedItemsProductActive };
`)();
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
assert.equal(catalogHelpers.resolveApprovedCatalogSku('MV73-HW'), null, 'legacy/plain MV73-HW is not in the approved ecomm catalog');
assert.equal(catalogHelpers.approvedCatalogEntry('MV73-HW'), null, 'legacy MV73-HW has no approved ecomm catalog entry');
assert.equal(catalogHelpers.resolveApprovedCatalogSku('MV73M-HW'), 'MV73M-HW', 'MV73M-HW is approved');
assert.deepEqual(
  catalogHelpers.approvedCatalogAlternatives('MV73'),
  ['MV73M-HW', 'MV73X-HW'],
  'bare MV73 suggestions come from the approved catalog, not a hardcoded SKU gate'
);
assert.match(catalogHelpers.notApprovedCatalogMessage('MV73', 'MV73-HW'), /MV73M-HW, MV73X-HW/, 'unapproved SKU failures surface approved alternatives');
assert.deepEqual(collectQuotePreResolveSkuTokens('MV73M-HW plus LIC-MV-1YR hardware only'), ['MV73M-HW']);

const badMv73Env = { __RAW_USER_PROMPT: 'Create a quote for 1 MV73 hardware only.' };
const badMv73Block = rawQuoteGuardHelpers.validateRawQuoteSkuIntent('create_deal_and_quote', { skus: ['MV73-HW'] }, badMv73Env);
assert.equal(badMv73Block.success, false, 'raw MV73 hardware-only request is blocked before compound quote creation');
assert.equal(badMv73Block.error, 'not_approved_ecomm_catalog', 'raw MV73 block uses the catalog hard-gate error');
assert.equal(badMv73Block.action, 'create_blocked', 'raw MV73 block is marked as a pre-create stop');
assert.match(badMv73Block.message, /No Deal, Quote, PO, DID, Sales Order, or e-signature was created/, 'raw MV73 block explicitly says no CRM records were created');
assert.match(badMv73Block._user_visible_summary, /MV73M-HW/, 'raw MV73 block suggests MV73M-HW');
assert.match(badMv73Block._user_visible_summary, /MV73X-HW/, 'raw MV73 block suggests MV73X-HW');
assert.equal(
  rawQuoteGuardHelpers.validateRawQuoteSkuIntent('zoho_create_record', { module_name: 'Quotes', data: { Quoted_Items: [] } }, badMv73Env).error,
  'not_approved_ecomm_catalog',
  'raw MV73 block also catches direct Quote create attempts'
);
assert.equal(rawQuoteGuardHelpers.toolLooksLikeQuoteWrite('clone_quote', { quote_id: 'q1' }), true, 'quote clone is covered by quote-write guards');
assert.equal(rawQuoteGuardHelpers.toolLooksLikeQuoteWrite('zoho_create_record', { module_name: 'Sales_Orders', data: {} }), true, 'direct Sales_Orders writes are covered by quote-write guards');

const goodMv73mEnv = { __RAW_USER_PROMPT: 'Create a quote for 1 MV73M hardware only.' };
assert.equal(
  rawQuoteGuardHelpers.validateRawQuoteSkuIntent('create_deal_and_quote', { skus: ['MV73M'], hardware_only: true, include_licenses: false }, goodMv73mEnv),
  null,
  'approved MV73M hardware-only quote may proceed through quote creation'
);
assert.equal(
  rawQuoteGuardHelpers.validatePoOrEsignRequested('create_deal_and_quote', { skus: ['MV73M'], hardware_only: true, include_licenses: false }, goodMv73mEnv),
  null,
  'approved MV73M hardware-only quote is not blocked as PO/e-signature work'
);
const mv73mProductId = staticPriceSnapshot['MV73M-HW'].zoho_product_id;
const mvLicenseProductId = staticPriceSnapshot['LIC-MV-1YR'].zoho_product_id;
assert.equal(
  quotePreflightHelpers.preflightQuotedItemsProductActive([{ Product_Name: { id: mv73mProductId }, Quantity: 1 }], { hardwareOnly: true }).valid,
  true,
  'approved MV73M hardware-only line passes preflight without a license'
);
const quoteOnlyPoBlock = rawQuoteGuardHelpers.validatePoOrEsignRequested('quote_to_po_and_esign', { quote_id: '2570562000000000001' }, goodMv73mEnv);
assert.equal(quoteOnlyPoBlock.error, 'po_or_esign_not_requested', 'quote-only prompt blocks quote_to_po_and_esign');
assert.match(quoteOnlyPoBlock.message, /Do not run Quote Admin_Action, quote-to-PO, Sales_Order creation, or LIVE_SendToEsign/, 'quote-only PO block names the prohibited tool paths');
assert.equal(
  rawQuoteGuardHelpers.validatePoOrEsignRequested('zoho_create_record', { module_name: 'Sales_Orders', data: {} }, goodMv73mEnv).error,
  'po_or_esign_not_requested',
  'quote-only prompt blocks direct Sales_Orders creation'
);
assert.equal(
  rawQuoteGuardHelpers.validatePoOrEsignRequested('zoho_update_record', { module_name: 'Sales_Orders', data: { Admin_Action: 'LIVE_SendToEsign' } }, goodMv73mEnv).error,
  'po_or_esign_not_requested',
  'quote-only prompt blocks direct Sales_Orders e-signature admin action'
);
assert.equal(
  rawQuoteGuardHelpers.validatePoOrEsignRequested('zoho_update_record', { module_name: 'Quotes', data: { Admin_Action: 'LIVE_ConvertQuoteToSO' } }, goodMv73mEnv).error,
  'po_or_esign_not_requested',
  'quote-only prompt blocks direct Quote conversion admin action'
);
const wrappedChatText = '[Current Zoho page: Sales_Orders SO-01012. This is context only.]\n(Source: active-tab)\n\nUser message: Create a quote for 1 MV73M hardware only.';
assert.equal(
  rawQuoteGuardHelpers.rawUserPromptFromIncomingText(wrappedChatText),
  'Create a quote for 1 MV73M hardware only.',
  'raw prompt extraction strips extension context wrappers'
);
assert.equal(
  rawQuoteGuardHelpers.validatePoOrEsignRequested('quote_to_po_and_esign', { quote_id: '2570562000000000001' }, { __RAW_USER_PROMPT: rawQuoteGuardHelpers.rawUserPromptFromIncomingText(wrappedChatText) }).error,
  'po_or_esign_not_requested',
  'context text mentioning Sales_Orders does not opt in quote-to-PO when user only asked for a quote'
);
const hwOnlyLicenseCheck = quotePreflightHelpers.preflightQuotedItemsProductActive([{ Product_Name: { id: mvLicenseProductId }, Quantity: 1 }], { hardwareOnly: true });
assert.equal(hwOnlyLicenseCheck.valid, false, 'hardware-only preflight rejects license line items');
assert.match(hwOnlyLicenseCheck.errors.join('\n'), /UNREQUESTED_LICENSE_LINE_ITEM: LIC-MV-1YR/, 'hardware-only preflight reports LIC-MV-1YR as unrequested');
const missingProductIdCheck = quotePreflightHelpers.preflightQuotedItemsProductActive([{ Product_Name: { name: 'MV73M-HW' }, Quantity: 1 }], { hardwareOnly: false });
assert.equal(missingProductIdCheck.valid, false, 'preflight rejects quote line items missing Product_Name.id');
assert.match(missingProductIdCheck.errors.join('\n'), /QUOTED_ITEMS_MISSING_PRODUCT_ID/, 'missing Product_Name.id failures are explicit');

assert.equal(
  salesOrderEsignErrorMessage({ Admin_Action: 'LIVE_SendToEsign__Done', Client_Send_Status: 'Error', Log_Message: 'No any Vendor in Sales_Orders (+ trigger)' }),
  'Error | LIVE_SendToEsign__Done | No any Vendor in Sales_Orders (+ trigger)',
  'Sales Order send errors override generic admin-action done status'
);
assert.equal(salesOrderEsignErrorMessage({ Client_Send_Status: 'Envelope Sent' }), null, 'sent statuses are not treated as errors');
assert.match(source, /const DEFAULT_QUOTE_VENDOR = 'TD SYNNEX CORPORATION'/, 'Quote default vendor uses the exact existing Zoho picklist value');
assert.match(source, /Vendor: DEFAULT_QUOTE_VENDOR/, 'Quote creation writes the default vendor picklist value');
assert.match(source, /data: \[\{ id: quoteId, Vendor: DEFAULT_QUOTE_VENDOR \}\]/, 'Quote-to-PO repairs missing Vendor using the same default picklist value');
assert.match(source, /existing Zoho picklist value "TD SYNNEX CORPORATION"/, 'tool descriptions tell the model to use the existing picklist value');
assert.match(source, /"Vendor": "TD SYNNEX CORPORATION"/, 'standard quote creation payload includes the default Vendor field');
assert.match(source, /Secondary\/display fields like Vendor_Name do not satisfy admin-action readiness/, 'standard quote prompt warns Vendor_Name is not enough');
assert.doesNotMatch(source, /TD Synnex/, 'Quote default vendor never uses the informal display label');
assert.match(source, /'Billing_Street'[\s\S]{0,160}'Shipping_Country'/, 'Quote create validation enforces the complete required payload including billing address');
assert.match(source, /Missing required field "Quoted_Items" for Quote creation/, 'Quote create validation blocks empty line items');
assert.equal(quoteVendorHelpers.quoteRequiredVendorValue({ Vendor_Name: 'TD SYNNEX CORPORATION' }), '', 'Quote vendor preflight does not accept secondary Vendor_Name');
assert.equal(quoteVendorHelpers.quoteVendorValue({ Vendor_Name: 'TD SYNNEX CORPORATION' }), '', 'Quote vendor display helper is strict for admin-action readiness');
assert.equal(quoteVendorHelpers.quoteRequiredVendorValue({ Vendor: 'TD SYNNEX CORPORATION' }), 'TD SYNNEX CORPORATION', 'Quote vendor preflight accepts the top-level Vendor field');
assert.deepEqual(
  quoteVendorHelpers.quoteVendorDiagnostics({ Vendor: '', Vendor_Name: 'TD SYNNEX CORPORATION' }),
  { Vendor: null, Vendor_Name: 'TD SYNNEX CORPORATION', Vendor_Lookup: null, Distributor: null, Disti: null, Supplier: null },
  'Quote vendor diagnostics preserve secondary fields without treating them as ready'
);
assert.deepEqual(
  quoteVendorHelpers.quoteRequiredFieldIssues({
    Subject: 'Test',
    Deal_Name: { id: 'd1' },
    Account_Name: { id: 'a1' },
    Contact_Name: { id: 'c1' },
    Valid_Till: '2026-06-06',
    Cisco_Billing_Term: 'Prepaid Term',
    Billing_Street: '123 Main St',
    Billing_City: 'Cedar Rapids',
    Billing_State: 'IA',
    Billing_Code: '52402',
    Billing_Country: 'US',
    Shipping_Country: 'US',
    Vendor_Name: 'TD SYNNEX CORPORATION',
    Quoted_Items: [{ Product_Name: { id: 'p1' }, Quantity: 1 }]
  }).map(issue => issue.field),
  ['Vendor'],
  'required-field preflight blocks Vendor_Name-only quotes before admin actions'
);
assert.deepEqual(
  quoteVendorHelpers.quoteRequiredFieldIssues({
    Subject: 'Test',
    Deal_Name: { id: 'd1' },
    Account_Name: { id: 'a1' },
    Contact_Name: { id: 'c1' },
    Valid_Till: '2026-06-06',
    Cisco_Billing_Term: 'Prepaid Term',
    Billing_Street: '123 Main St',
    Billing_City: 'Cedar Rapids',
    Billing_State: 'IA',
    Billing_Code: '52402',
    Billing_Country: 'US',
    Shipping_Country: 'US',
    Vendor: 'TD SYNNEX CORPORATION',
    Quoted_Items: [{ Product_Name: { id: 'p1' }, Quantity: 1 }]
  }),
  [],
  'required-field preflight passes only when top-level Vendor and line items are present'
);
assert.deepEqual(
  quoteVendorHelpers.quoteRequiredFieldIssues({
    Subject: 'Test',
    Deal_Name: { id: 'd1' },
    Account_Name: { id: 'a1' },
    Contact_Name: { id: 'c1' },
    Valid_Till: '2026-06-06',
    Cisco_Billing_Term: 'Prepaid Term',
    Billing_Street: '123 Main St',
    Billing_City: 'Cedar Rapids',
    Billing_State: 'IA',
    Billing_Code: '52402',
    Billing_Country: 'US',
    Shipping_Country: 'US',
    Vendor: 'TD SYNNEX CORPORATION',
    Quoted_Items: [{ Product_Name: { id: mv73mProductId }, Quantity: 1 }]
  }, { requireApprovedCatalog: true }),
  [],
  'required-field preflight accepts approved catalog line items with Product_Name.id'
);
assert.deepEqual(
  quoteVendorHelpers.quoteRequiredFieldIssues({
    Subject: 'Test',
    Deal_Name: { id: 'd1' },
    Account_Name: { id: 'a1' },
    Contact_Name: { id: 'c1' },
    Valid_Till: '2026-06-06',
    Cisco_Billing_Term: 'Prepaid Term',
    Billing_Street: '123 Main St',
    Billing_City: 'Cedar Rapids',
    Billing_State: 'IA',
    Billing_Code: '52402',
    Billing_Country: 'US',
    Shipping_Country: 'US',
    Vendor: 'TD SYNNEX CORPORATION',
    Quoted_Items: [{ Product_Name: { name: 'MV73M-HW' }, Quantity: 1 }]
  }, { requireApprovedCatalog: true }).filter(issue => issue.field === 'Quoted_Items[1].Product_Name'),
  [{ field: 'Quoted_Items[1].Product_Name', reason: 'missing_product_id' }],
  'required-field preflight rejects missing Product_Name IDs'
);
assert.deepEqual(
  quoteVendorHelpers.quoteRequiredFieldPayload({
    quote: {
      id: 'q1',
      Subject: 'Test',
      Deal_Name: { id: 'd1' },
      Account_Name: { id: 'a1' },
      Contact_Name: { id: 'c1' },
      Valid_Till: '2026-06-06',
      Cisco_Billing_Term: 'Prepaid Term',
      Billing_Street: '123 Main St',
      Billing_City: 'Cedar Rapids',
      Billing_State: 'IA',
      Billing_Code: '52402',
      Billing_Country: 'US',
      Shipping_Country: 'US',
      Vendor: 'TD SYNNEX CORPORATION',
      Quoted_Items: [{ Product_Name: { id: 'legacy-mv73-id', name: 'MV73-HW' }, Quantity: 1 }]
    },
    state: 'quote_required_fields_not_verified',
    errorPrefix: 'blocked',
    requireApprovedCatalog: true
  }).required_field_issues.filter(issue => issue.reason === 'not_approved_ecomm_catalog'),
  [{ field: 'Quoted_Items[1].Product_Name', reason: 'not_approved_ecomm_catalog', product_id: 'legacy-mv73-id', sku: 'MV73-HW' }],
  'required-field payload preserves approved-catalog failures in quote-to-PO blocks'
);
assert.match(source, /const current = quoteRequiredVendorValue\(quote\)/, 'Quote-to-PO verifies the required top-level Vendor field');
assert.match(source, /const vendor = quoteRequiredVendorValue\(refreshed\)/, 'Quote vendor repair verifies the refreshed top-level Vendor field');
assert.match(source, /Secondary fields such as Vendor_Name do not satisfy the admin-action preflight/, 'Vendor failure explains why Vendor_Name is insufficient');
assert.match(source, /module_name === 'Quotes' && !quoteRequiredVendorValue\(recordData\)/, 'generic Quote create defaulting checks the required Vendor field only');
assert.match(source, /quote_vendor_not_persisted/, 'Quote create verification returns a vendor-specific failure when Zoho drops Vendor');
assert.match(source, /state: 'quote_required_fields_not_verified'/, 'quote-to-PO blocks before admin actions when required fields are missing');
assert.match(source, /state: 'quote_required_fields_not_verified_before_po'/, 'quote-to-PO revalidates required fields before PO conversion');
assert.match(source, /_quote_required_fields_verified = true/, 'generic Quote creation records required-field verification');
assert.match(source, /Vendor: quoteRequiredVendorValue\(fq\)/, 'compound quote creation verification includes top-level Vendor');
assert.equal(salesOrderVendorReference({ Vendor: { id: 'v123', name: 'TD SYNNEX CORPORATION' } }), 'v123', 'Sales Order vendor lookup accepts Zoho lookup fields');
assert.equal(salesOrderVendorReference({ Vendor_SO_Number: 'not-a-vendor' }), null, 'Sales Order vendor preflight does not confuse vendor SO number with Vendor');

assert.match(source, /case 'quote_to_po_and_esign'/, 'tool executor handles quote_to_po_and_esign');
assert.match(source, /name: 'quote_to_po_and_esign'/, 'tool schema exposes quote_to_po_and_esign');
assert.match(source, /case 'create_quote_on_deal'/, 'tool executor handles quote creation on existing deals');
assert.match(source, /name: 'create_quote_on_deal'/, 'tool schema exposes quote creation on existing deals');
assert.match(source, /existing_deal_id: deal_id/, 'create_quote_on_deal delegates without creating a duplicate Deal');
assert.match(source, /Reused existing Deal/, 'existing Deal quote path records that it reused the Deal');
assert.match(source, /Current CRM context\/page is a Deal\/Potentials record/, 'prompt routes Deal page quote requests to create_quote_on_deal');
assert.match(source, /not_approved_ecomm_catalog/, 'non-approved SKUs have a deterministic server-side hard gate');
assert.match(source, /Do not fall back to stale Zoho Products or WooProducts records/, 'catalog failures block stale Zoho fallback');
assert.match(source, /Only SKUs in the approved Stratus ecomm catalog are quotable/, 'model prompt uses the general catalog rule');
assert.match(source, /QUOTED_ITEMS_MISSING_PRODUCT_ID/, 'quote line items cannot be created from product-name text');
assert.match(source, /return 'Potentials'/, 'Deal URLs use the valid Zoho Potentials tab path');
assert.match(source, /force_create_po/, 'existing PO override is explicit');
assert.match(source, /state: 'existing_po_found'/, 'existing PO block is present');
assert.match(source, /findLinkedSalesOrderFromQuote/, 'quote linkage fallback is present');
assert.match(source, /fetchSalesOrderByReference/, 'quote linkage can resolve SO id or SO_Number');
assert.match(source, /LIVE_SendToEsign/, 'e-sign admin action is present');
assert.match(source, /moduleName: 'Sales_Orders'[\s\S]{0,180}actionName: 'LIVE_SendToEsign'/, 'LIVE_SendToEsign runs on Sales_Orders');
assert.match(source, /actionName: 'LIVE_GetQuoteData'[\s\S]{0,900}actionName: 'LIVE_ConvertQuoteToSO'/, 'quote workflow refreshes vendor/disti data before PO conversion');
assert.match(source, /salesOrderEsignErrorMessage\(finalState\)[\s\S]{0,500}Admin_Action === `\$\{actionName\}__Done`/, 'e-sign polling checks explicit send errors before treating Admin_Action__Done as success');
assert.match(source, /e-signature was not sent/, 'e-sign failures are reported without claiming the PO was sent');
assert.match(source, /state: 'po_missing_vendor'/, 'workflow blocks e-signature when converted PO has no Vendor');
assert.match(source, /salesOrderVendorReference\(candidate\)/, 'newly converted PO has deterministic Vendor preflight before e-signature');
assert.match(source, /include_licenses/, 'hardware-only quote path exposes include_licenses');
assert.match(source, /hardware_only_no_licenses/, 'hardware-only quote path records license policy');
assert.match(source, /Admin_Action updates must not include Quote_Stage/, 'Quote admin-action stage guard is present');
assert.match(source, /Quotes do not use the Deal Stage field/, 'Quote Stage guard is present');
assert.match(source, /claude-write-intent/, 'Claude-first write routing is tagged');
assert.match(source, /cascading to normal waterfall/, 'Claude-first routing has fallback');
assert.doesNotMatch(source, /forceClaudeForChatWrite/, 'chat tab uses the same Claude-first cascade path as chat-waterfall');
assert.match(source, /case '\/api\/chat-waterfall':[\s\S]{0,900}env\.__RAW_USER_PROMPT = rawUserPromptFromIncomingText\(wText\);/, '/api/chat-waterfall preserves only the raw user prompt before enrichment');
assert.match(source, /case '\/api\/chat':[\s\S]{0,320}env\.__RAW_USER_PROMPT = rawUserPromptFromIncomingText\(chatText\);/, 'direct /api/chat preserves only the raw user prompt before enrichment');
assert.match(source, /state: 'sales_order_deal_mismatch'/, 'explicit Sales Order e-sign path validates Deal linkage');
assert.match(source, /requestedDealId !== dealId/, 'Sales Order mismatch prevents wrong-Deal e-signature send');
assert.match(source, /Net_Terms was blank, so it was defaulted to Cash/, 'automatic Cash terms are surfaced to the user');
assert.match(source, /writeProgressEvent\(env, env\.__PROGRESS_ID/, 'compound quote workflow emits progress events');
assert.match(source, /slice\(0, 20\)/, 'quote-specific SO matching checks more than the first eight Sales Orders');
assert.match(source, /state: 'po_financial_mismatch'/, 'workflow blocks e-signature on non-tax financial mismatch');
assert.match(source, /automatically tax only some line items, all line items, or no line items/, 'tool schema allows mixed automatic tax behavior');
assert.match(source, /Taxes are informational only/, 'workflow does not block e-signature solely because of tax');
assert.match(source, /pre-tax\/ecomm line economics match/, 'admin prompt treats pre-tax ecomm economics as the approval gate');
assert.match(source, /reconcileQuoteToEcommPricing/, 'compound quote creation reconciles persisted quote lines to ecomm pricing');
assert.match(source, /fetchLiveSkuPricing/, 'compound quote creation fetches live SKU pricing before writing quotes');
assert.match(source, /WooProducts\/search\?criteria=\(WooProduct_Code:equals:/, 'live ecomm pricing comes from Zoho WooProducts, not remembered discounts');
assert.match(source, /Products\/\$\{existing\.zoho_product_id\}\?fields=id,Product_Code,Unit_Price/, 'price refresh reads live Zoho Product Unit_Price');
assert.match(source, /Product_Code !== sku[\s\S]{0,500}Products\/search\?criteria=\(Product_Code:equals:/, 'price refresh falls back by SKU when cached product id does not match');
assert.match(source, /existing\.list = liveListPrice/, 'price refresh stores live Zoho Product list price before recalculating discounts');
assert.match(source, /existing\.zoho_product_id = liveProductId/, 'price refresh refreshes cached Zoho product id from live SKU lookup');
assert.match(source, /if \(live\.product_id\) product\.product_id = live\.product_id/, 'quote creation uses live SKU product id before writing line items');
assert.match(source, /live_ecomm_pricing_unavailable/, 'quote creation blocks when live ecomm pricing is unavailable');
assert.match(source, /Do NOT create a Deal or Quote from cached or remembered discounts/, 'live pricing failure refuses cached discount fallback');
assert.match(source, /quote_ecomm_pricing_reconciliation_failed/, 'quote creation blocks PO conversion if ecomm correction does not persist');
assert.match(source, /expected_product_missing_from_created_quote/, 'reconciliation fails when persisted quote products do not match expected products');
assert.match(source, /if \(pricingReconcile\.success === false\)/, 'quote creation blocks failed reconciliation even when no patch was attempted');
assert.match(source, /Do_Not_Auto_Update_Prices: true[\s\S]{0,120}Quoted_Items: patches/, 'ecomm reconciliation preserves quote line pricing via Zoho control flag');
assert.match(extractFunction('correctQuotedItemDiscounts'), /product_id_not_in_idMap/, 'discount correction fails closed when Product_Name.id is not in the approved id map');

const unverifiedClaim = truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims(
  'Quote QUO-02207, $3,063.68. Sales Order SO-01012 sent for e-signature.',
  new Map()
);
assert.equal(unverifiedClaim.changed, true, 'plain-text unverified Quote/Sales Order number claims are sanitized');
assert.doesNotMatch(unverifiedClaim.text, /QUO-02207|SO-01012/, 'unverified bare record numbers are removed from final summaries');
assert.doesNotMatch(unverifiedClaim.text, /SO-01012 sent for e-signature/, 'unverified e-signature action claims are removed');
const unverifiedNumericQuoteClaim = truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims(
  'Done! Quote #2570562000401481079 — Hardware Only.',
  new Map()
);
assert.equal(unverifiedNumericQuoteClaim.changed, true, 'numeric Zoho Quote_Number claims are sanitized when unverified');
assert.doesNotMatch(unverifiedNumericQuoteClaim.text, /2570562000401481079/, 'unverified numeric Quote_Number is removed');
const unverifiedPurchaseOrderClaim = truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims(
  'Purchase Order #2570562000401481099 was sent for e-signature.',
  new Map()
);
assert.equal(unverifiedPurchaseOrderClaim.changed, true, 'numeric Purchase Order claims are sanitized when unverified');
assert.doesNotMatch(unverifiedPurchaseOrderClaim.text, /2570562000401481099/, 'unverified Purchase Order number is removed');
assert.equal(
  truthGuardHelpers.crmSummaryContainsRecordActionClaims('Purchase Order #2570562000401481099 was sent for e-signature.'),
  true,
  'Purchase Order e-signature success text is recognized as an action claim'
);
const verifiedNumbers = new Map();
truthGuardHelpers.addVerifiedSetValue(verifiedNumbers, 'Quotes', 'QUO-02208');
truthGuardHelpers.addVerifiedSetValue(verifiedNumbers, 'Sales_Orders', 'SO-01013');
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims('Quote QUO-02208 and Sales Order SO-01013 are verified.', verifiedNumbers).changed,
  false,
  'verified Quote/Sales Order numbers survive the final-summary sanitizer'
);
truthGuardHelpers.addVerifiedSetValue(verifiedNumbers, 'Quotes', '2570562000401481080');
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims('Quote #2570562000401481080 is verified.', verifiedNumbers).changed,
  false,
  'verified numeric Quote_Number survives the final-summary sanitizer'
);
const harvestedNumbers = new Map();
truthGuardHelpers.collectVerifiedZohoRecordNumbers(
  'create_deal_and_quote',
  {},
  { records: { quote: { id: 'q1', quote_number: 'QUO-02209' } } },
  harvestedNumbers
);
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedZohoRecordNumberClaims('Created Quote QUO-02209.', harvestedNumbers).changed,
  false,
  'compound quote creation whitelists the verified Quote_Number returned by the tool'
);
const mixedUnverifiedSummary = [
  'Done! Here is the summary:',
  'Deal: TestCo Stress Eval LLC - MV73M - Quote',
  '[URL removed: unverified]',
  'Quote #2570562000401481079 — Hardware Only',
  'Follow-up Task due 2025-07-17 ✓',
  'Undo tokens: Deal `u_45f6c7d8` · Quote `u_b3e8a1f2`'
].join('\n');
assert.equal(
  truthGuardHelpers.crmSummaryContainsRecordActionClaims(mixedUnverifiedSummary),
  true,
  'CRM summary-shaped success text is recognized as an action claim'
);
const collapsedNoVerifiedSummary = truthGuardHelpers.replaceMixedUnverifiedCrmSummaryClaim(
  mixedUnverifiedSummary,
  mixedUnverifiedSummary.replace('2570562000401481079', '[Quote number removed: unverified]'),
  true,
  []
);
assert.equal(collapsedNoVerifiedSummary.changed, true, 'mixed unverified CRM success summaries are collapsed');
assert.match(collapsedNoVerifiedSummary.text, /could not verify the CRM records\/actions claimed/i, 'collapsed summary fails closed when no verified mutation summary exists');
assert.doesNotMatch(collapsedNoVerifiedSummary.text, /u_45f6c7d8|u_b3e8a1f2|2570562000401481079/, 'collapsed summary removes unverified undo tokens and record numbers');
const unverifiedUndoTokens = truthGuardHelpers.sanitizeUnverifiedUndoTokenClaims(
  'Undo tokens: Deal `u_45f6c7d8` · Quote `u_b3e8a1f2` · Task `u d9c2e4a7` (say "undo" to reverse)',
  []
);
assert.equal(unverifiedUndoTokens.changed, true, 'unverified CRM undo tokens are sanitized');
assert.doesNotMatch(unverifiedUndoTokens.text, /u_45f6c7d8|u_b3e8a1f2|u d9c2e4a7/, 'unverified undo tokens are removed');
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedUndoTokenClaims('Undo token: `u_45f6c7d8`', [{ undoToken: 'u_45f6c7d8' }]).changed,
  false,
  'verified undo token survives sanitizer'
);
const collapsedWithVerifiedSummary = truthGuardHelpers.replaceMixedUnverifiedCrmSummaryClaim(
  mixedUnverifiedSummary,
  mixedUnverifiedSummary,
  true,
  [{ isError: false, summary: 'Created Quote #2570562000404940066 for TestCo Stress Eval LLC — [Open in Zoho](https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404940064)' }]
);
assert.equal(
  collapsedWithVerifiedSummary.text,
  'Created Quote #2570562000404940066 for TestCo Stress Eval LLC — [Open in Zoho](https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000404940064)',
  'mixed summary is replaced by the verified mutation summary when one exists'
);
const urlMap = new Map();
truthGuardHelpers.addVerifiedSetValue(urlMap, 'Quotes', '2570562000000000001');
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedZohoUrls('Open https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000000000001', urlMap).changed,
  false,
  'verified Zoho URLs survive the shared sanitizer'
);
assert.equal(
  truthGuardHelpers.sanitizeUnverifiedZohoUrls('Open https://crm.zoho.com/crm/org647122552/tab/Sales_Orders/2570562000000000002', urlMap).changed,
  true,
  'unverified Zoho URLs are stripped by the shared sanitizer'
);
assert.match(priceSource, /MV73M-HW"[\s\S]{0,120}"list": 2720\.41[\s\S]{0,120}"price": 1830[\s\S]{0,120}"discount_per_unit": 890\.41/, 'MV73M-HW fallback snapshot mirrors current live Zoho list and ecomm pricing');
assert.match(source, /blocks if line-item detail is unavailable/, 'tool schema blocks when line detail is unavailable');
assert.equal(shouldForceClaudeForWrite('send Lisa a contract for 1 MV73M'), true);
assert.match(source, /const ZOHO_AI_CREATED_TAG = 'Stratus AI Created'/, 'Zoho AI-created tag name is centralized');
assert.match(source, /settings\/tags\?module=/, 'Zoho tag is created or reused per module before assignment');
assert.match(source, /actions\/add_tags/, 'Zoho native add_tags endpoint is used');
assert.match(source, /tagZohoCreatedRecordsIfNeeded\(method, path, env, token, body, parsed, options\)/, 'central Zoho create path tags created records');
assert.match(source, /addZohoAiCreatedTagWithEnv\('Sales_Orders', candidate\.id, env\)/, 'admin-action-created Sales Orders are tagged after conversion');
assert.match(source, /addZohoAiCreatedTag\('Quotes', clonedId, token\)/, 'native quote clone path tags cloned Quotes');
assert.match(source, /tagCreatedRecord: false/, 'undo restore can suppress AI-created tagging');
assert.equal(zohoTopLevelModuleFromCreatePath('POST', 'Deals', { data: [{}] }), 'Deals', 'Deal creates are taggable');
assert.equal(zohoTopLevelModuleFromCreatePath('POST', 'Quotes', { data: [{}] }), 'Quotes', 'Quote creates are taggable');
assert.equal(zohoTopLevelModuleFromCreatePath('POST', 'coql', { select_query: 'select id from Deals' }), null, 'COQL reads are not taggable');
assert.equal(zohoTopLevelModuleFromCreatePath('POST', 'Deals/123/Notes', { data: [{}] }), null, 'nested note creates are not treated as top-level CRM records');
assert.equal(zohoTopLevelModuleFromCreatePath('POST', 'Deals', { data: [{}] }, { tagCreatedRecord: false }), null, 'suppression option disables tagging');
assert.deepEqual(zohoCreatedRecordIds({ data: [{ code: 'SUCCESS', details: { id: '123' } }, { status: 'error', details: { id: '456' } }] }), ['123'], 'created record id extraction ignores failed rows');

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

async function runAsyncRegressionChecks() {
  const executeBlock = await executeToolCallGuardOnly(
    'create_deal_and_quote',
    { skus: ['MV73-HW'] },
    { __RAW_USER_PROMPT: 'Create a quote for 1 MV73 hardware only.' },
    'test-person'
  );
  assert.equal(executeBlock.success, false, 'executeToolCall itself blocks raw MV73 before entering CRM write logic');
  assert.equal(executeBlock.error, 'not_approved_ecomm_catalog', 'executeToolCall raw guard returns the approved-catalog error');
  assert.match(executeBlock._user_visible_summary, /MV73M-HW/, 'executeToolCall raw guard suggests MV73M-HW');
  assert.match(executeBlock._user_visible_summary, /MV73X-HW/, 'executeToolCall raw guard suggests MV73X-HW');
}

runAsyncRegressionChecks()
  .then(() => console.log('quote/PO admin workflow regression checks passed'))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
