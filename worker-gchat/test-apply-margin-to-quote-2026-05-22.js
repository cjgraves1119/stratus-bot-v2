// Static guards for applyMarginToQuote (Fix B — margin-target pricing).
// The helper runs the LIVE_GetQuoteData admin action and writes to live Zoho,
// so this is a source-level regression test, not an executed call.
//
// The CRITICAL invariant: the undo pre-state snapshot must carry the FULL line
// shape (Product_Name / Quantity / List_Price / Discount). undo_crm_action's
// Quote smart-diff keys on Product_Name.id — a thin {id,Discount} snapshot
// makes itemKey() return null, and undo could then delete every line item.
// (Codex round-2 finding, 2026-05-22.)
// Run: node test-apply-margin-to-quote-2026-05-22.js

const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
function check(label, cond) {
  if (cond) { pass++; console.log('  ✅ ' + label); }
  else { fail++; console.log('  ❌ ' + label); }
}

console.log('── apply_margin_to_quote (Fix B) static guards ──');

// Isolate the applyMarginToQuote function body.
const fnStart = src.indexOf('async function applyMarginToQuote(');
check('applyMarginToQuote is defined', fnStart > 0);
const fnEnd = src.indexOf('\nasync function ensureQuoteDidAndVelocity', fnStart);
const fnBody = fnStart > 0 ? src.slice(fnStart, fnEnd > fnStart ? fnEnd : fnStart + 12000) : '';

// Isolate just the preState snapshot object literal.
const preIdx = fnBody.indexOf('const preState = {');
check('preState snapshot exists', preIdx > 0);
const preBody = preIdx > 0 ? fnBody.slice(preIdx, fnBody.indexOf('};', preIdx) + 2) : '';

// CRITICAL undo-safety invariant — the snapshot must carry the full line shape.
for (const field of ['Product_Name', 'Quantity', 'List_Price', 'Discount']) {
  check(`undo snapshot preState.Quoted_Items carries ${field}`, preBody.includes(field));
}

// The write PUT must be additive-safe and bypass the ecomm corrector:
// {id, Discount} only (no Product_Name) + Do_Not_Auto_Update_Prices.
check('write PUT sets Do_Not_Auto_Update_Prices: true', fnBody.includes('Do_Not_Auto_Update_Prices: true'));
check('write PUT uses {id, Discount}-only line shape (no Product_Name on the write)',
  fnBody.includes('id: l.id, Discount: l.discount'));

// Fail-closed behavior.
check('fails closed when Vendor_Lines is empty (cost_data_unavailable)',
  fnBody.includes("'cost_data_unavailable'"));
check('requires CCW_Deal_Number before pricing (no_ccw_deal_number + isCiscoDid)',
  fnBody.includes("'no_ccw_deal_number'") && fnBody.includes('isCiscoDid'));
check('blocks above-list pricing (targetSell vs listTotal guard)',
  fnBody.includes('targetSell > listTotal'));

// Tool wiring.
check('apply_margin_to_quote tool is registered in CRM_EMAIL_TOOLS',
  src.includes("name: 'apply_margin_to_quote'"));
check('apply_margin_to_quote is in the crm_write tool subset',
  /crm_write:[\s\S]{0,400}'apply_margin_to_quote'/.test(src));
check('executeToolCall has the apply_margin_to_quote case',
  src.includes("case 'apply_margin_to_quote':"));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
