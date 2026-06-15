// Regression: create_deal_and_quote must auto-populate billing AND shipping
// from the resolved Account, and a PARTIAL model-supplied billing_address must
// NOT shadow the Account's real address (Goodwill Industries of Kansas bug,
// Quote 2026-06-15: model passed {country:'US'} with blank street → Quote had
// blank Billing_* despite the Account having 3351 N Webb Rd, Wichita, KS 67226).
//
// This mirrors the merge logic at worker-gchat/src/index.js STEP 6 verbatim.

const _coalesceAddr = (...vals) => {
  for (const v of vals) {
    if (v != null && String(v).trim() !== '') return String(v).trim();
  }
  return '';
};

// Account-authoritative: the resolved Account wins field-by-field; a caller
// billing_address only fills a field the Account genuinely lacks.
function buildAddrs(billing_address, accountData) {
  const _ba = billing_address || {};
  const billingAddr = {
    street: _coalesceAddr(accountData?.Billing_Street, _ba.street),
    city: _coalesceAddr(accountData?.Billing_City, _ba.city),
    state: _coalesceAddr(accountData?.Billing_State, _ba.state),
    zip: _coalesceAddr(accountData?.Billing_Code, _ba.zip),
    country: _coalesceAddr(accountData?.Billing_Country, _ba.country) || 'United States'
  };
  const shippingAddr = {
    street: _coalesceAddr(accountData?.Shipping_Street, billingAddr.street),
    city: _coalesceAddr(accountData?.Shipping_City, billingAddr.city),
    state: _coalesceAddr(accountData?.Shipping_State, billingAddr.state),
    zip: _coalesceAddr(accountData?.Shipping_Code, billingAddr.zip),
    country: _coalesceAddr(accountData?.Shipping_Country, billingAddr.country) || 'United States'
  };
  return { billingAddr, shippingAddr };
}

// The real Goodwill #1 account (id 2570562000052096032)
const GOODWILL = {
  Billing_Street: '3351 N Webb Rd', Billing_City: 'Wichita', Billing_State: 'KS',
  Billing_Code: '67226', Billing_Country: 'US',
  Shipping_Street: '3351 N Webb Rd', Shipping_City: 'Wichita', Shipping_State: 'KS',
  Shipping_Code: '67226', Shipping_Country: 'US'
};

let pass = 0, fail = 0;
function check(name, cond) { cond ? (pass++, console.log('  ✓ ' + name)) : (fail++, console.log('  ✗ FAIL: ' + name)); }

console.log('1) THE BUG: partial billing_address {country:US} + complete Account');
{
  const { billingAddr, shippingAddr } = buildAddrs({ country: 'US' }, GOODWILL);
  check('billing street filled from Account', billingAddr.street === '3351 N Webb Rd');
  check('billing city filled from Account', billingAddr.city === 'Wichita');
  check('billing state filled from Account', billingAddr.state === 'KS');
  check('billing zip filled from Account', billingAddr.zip === '67226');
  check('billing country from caller (US)', billingAddr.country === 'US');
  check('shipping street filled from Account', shippingAddr.street === '3351 N Webb Rd');
  check('shipping zip filled from Account', shippingAddr.zip === '67226');
}

console.log('2) billing_address fully omitted + complete Account → all from Account');
{
  const { billingAddr, shippingAddr } = buildAddrs(undefined, GOODWILL);
  check('billing street from Account', billingAddr.street === '3351 N Webb Rd');
  check('shipping street from Account', shippingAddr.street === '3351 N Webb Rd');
  check('country US from Account', billingAddr.country === 'US');
}

console.log('3) empty-string partial {street:"",city:"",...,country:"US"} (exact prod shape)');
{
  const { billingAddr } = buildAddrs({ street: '', city: '', state: '', zip: '', country: 'US' }, GOODWILL);
  check('blank-string street still backfilled from Account', billingAddr.street === '3351 N Webb Rd');
  check('blank-string zip still backfilled from Account', billingAddr.zip === '67226');
}

console.log('4) NEW account: caller address folded into accountData → used');
{
  // Mirrors the real new-account path: accountData == newAcctPayload (caller billing).
  const caller = { street: '1 Market St', city: 'SF', state: 'CA', zip: '94105', country: 'US' };
  const newAcct = { Billing_Street: caller.street, Billing_City: caller.city, Billing_State: caller.state, Billing_Code: caller.zip, Billing_Country: caller.country };
  const { billingAddr, shippingAddr } = buildAddrs(caller, newAcct);
  check('new-account street used', billingAddr.street === '1 Market St');
  check('new-account zip used', billingAddr.zip === '94105');
  check('new-account shipping falls back to billing', shippingAddr.street === '1 Market St');
}

console.log('4b) caller-only (no accountData yet) → caller fills (pre-create degenerate)');
{
  const caller = { street: '1 Market St', city: 'SF', state: 'CA', zip: '94105', country: 'US' };
  const { billingAddr } = buildAddrs(caller, null);
  check('caller street fills when no account', billingAddr.street === '1 Market St');
}

console.log('4c) CODEX FINDING 1: WRONG full caller address must NOT override complete Account');
{
  const wrong = { street: '123 Fake St', city: 'Nowhere', state: 'ZZ', zip: '00000', country: 'XX' };
  const { billingAddr, shippingAddr } = buildAddrs(wrong, GOODWILL);
  check('Account street wins over wrong caller', billingAddr.street === '3351 N Webb Rd');
  check('Account city wins over wrong caller', billingAddr.city === 'Wichita');
  check('Account state wins over wrong caller', billingAddr.state === 'KS');
  check('Account zip wins over wrong caller', billingAddr.zip === '67226');
  check('Account country wins over wrong caller', billingAddr.country === 'US');
  check('Account shipping wins over wrong caller', shippingAddr.street === '3351 N Webb Rd');
}

console.log('5) shipping differs from billing on Account → shipping kept distinct');
{
  const acct = { ...GOODWILL, Shipping_Street: 'PO Box 8169', Shipping_City: 'Wichita', Shipping_State: 'KS', Shipping_Code: '67208', Shipping_Country: 'US' };
  const { billingAddr, shippingAddr } = buildAddrs({ country: 'US' }, acct);
  check('billing = physical', billingAddr.street === '3351 N Webb Rd');
  check('shipping = PO Box (distinct)', shippingAddr.street === 'PO Box 8169');
  check('shipping zip distinct', shippingAddr.zip === '67208');
}

console.log('6) Account has billing but NO shipping → shipping falls back to billing');
{
  const acct = { Billing_Street: '500 Elm', Billing_City: 'Austin', Billing_State: 'TX', Billing_Code: '78701', Billing_Country: 'US' };
  const { shippingAddr } = buildAddrs(undefined, acct);
  check('shipping street falls back to billing', shippingAddr.street === '500 Elm');
  check('shipping zip falls back to billing', shippingAddr.zip === '78701');
  check('shipping country falls back to billing', shippingAddr.country === 'US');
}

console.log('7) country default when neither caller nor Account supply it');
{
  const acct = { Billing_Street: '9 Oak', Billing_City: 'Reno', Billing_State: 'NV', Billing_Code: '89501' };
  const { billingAddr, shippingAddr } = buildAddrs(undefined, acct);
  check('billing country defaults United States', billingAddr.country === 'United States');
  check('shipping country defaults United States', shippingAddr.country === 'United States');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
