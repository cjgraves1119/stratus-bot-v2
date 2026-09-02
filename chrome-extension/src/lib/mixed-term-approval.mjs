/**
 * Mixed 1/3/5-year license terms are allowed on one cart, but links and
 * Zoho review stay blocked until the rep explicitly approves the mix.
 * This module is UI-gate only: it never writes CRM/Zoho.
 */

const SUPPORTED_TERMS = new Set(['1', '3', '5']);

function licenseTermFromSku(rawSku) {
  const sku = String(rawSku || '').trim().toUpperCase();
  if (!sku.startsWith('LIC-')) return '';
  return (sku.match(/-(\d{1,2})YR?$/) || [])[1] || '';
}

export function collectConcreteLicenseTerms(rows) {
  const terms = [];
  for (const row of (Array.isArray(rows) ? rows : [])) {
    const term = licenseTermFromSku(row?.sku || row?.baseSku || row?.resolvedSku);
    if (SUPPORTED_TERMS.has(term) && !terms.includes(term)) terms.push(term);
  }
  return terms.sort((a, b) => Number(a) - Number(b));
}

export function isMixedLicenseTermCart(rows) {
  return collectConcreteLicenseTerms(rows).length > 1;
}

const APPROVAL_MESSAGE = 'Mixed 1/3/5-year license terms require explicit approval before generating links or starting Zoho review.';

/**
 * @param {{ rows?: object[], approved?: boolean }} input
 */
export function mixedTermApprovalState({ rows = [], approved = false } = {}) {
  const terms = collectConcreteLicenseTerms(rows);
  const mixed = terms.length > 1;
  const requiresApproval = mixed && approved !== true;
  return {
    mixed,
    terms,
    approved: mixed ? approved === true : true,
    requiresApproval,
    canGenerateLinks: !requiresApproval,
    canStartZohoReview: !requiresApproval,
    flag: mixed ? 'Mixed 1/3/5-year license terms' : '',
    message: requiresApproval ? APPROVAL_MESSAGE : '',
  };
}

export function quoteActionsForMixedTerms(input) {
  return mixedTermApprovalState(input);
}
