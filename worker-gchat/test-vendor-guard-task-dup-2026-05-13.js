#!/usr/bin/env node
// 2026-05-13 council Items 1, 2, 4 regression:
// 1. validateCrmWrite intercepts Quote.Vendor text writes (rewrite or reject).
// 2. STEP 8 follow-up task uses fallback Subject derivation + better error logs.
// 4. handleQuoteToPoAndEsign short-circuits duplicate fires within 5 min.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const source = readFileSync(join(__dirname, 'src/index.js'), 'utf8');

let passed = 0, failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (err) { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
}

console.log('\n=== Item 1: validateCrmWrite Quote.Vendor guard ===\n');

t('Vendor + Vendor1 both present → drop Vendor text', () => {
  // Find the Vendor handling block in validateCrmWrite Quotes section
  assert.ok(
    /had both Vendor \(text\) and Vendor1 \(lookup\) — dropping Vendor text/.test(source),
    'dual-set drop-Vendor-text branch must log'
  );
});

t('Vendor as object → reroute to Vendor1', () => {
  assert.ok(
    /Quote\.Vendor passed as object — rerouting to Vendor1 lookup/.test(source),
    'object-form Vendor must be rerouted to Vendor1'
  );
});

t('Vendor text matching default → rewrite to Vendor1 lookup', () => {
  assert.ok(
    /Quote\.Vendor text "\$\{_textValue\}" rewritten to Vendor1 lookup/.test(source),
    'known-default text value must be rewritten to Vendor1'
  );
});

t('Vendor text with unknown value → hard reject', () => {
  assert.ok(
    /Quote\.Vendor is a text field that breaks Cisco CCW DID generation/.test(source),
    'unknown vendor text must be rejected with clear recovery instructions'
  );
  assert.ok(
    source.includes('To set the default vendor, pass:'),
    'reject message must include recovery instructions phrase'
  );
});

t('Behavioral sim — guard logic in isolation', () => {
  // Re-implement the guard rule inline and exercise it
  const DEFAULT_QUOTE_VENDOR_ID = '2570562000160732440';
  const DEFAULT_QUOTE_VENDOR_NAME = 'TD SYNNEX CORPORATION';
  const DEFAULT_QUOTE_VENDOR = { id: DEFAULT_QUOTE_VENDOR_ID, name: DEFAULT_QUOTE_VENDOR_NAME };

  function guard(data) {
    const errors = [];
    const _vendorTextHasValue = data.Vendor !== undefined && data.Vendor !== null && data.Vendor !== '';
    const _vendorLookupHasValue = data.Vendor1 !== undefined && data.Vendor1 !== null && data.Vendor1 !== '';
    if (_vendorTextHasValue) {
      if (_vendorLookupHasValue) {
        delete data.Vendor;
      } else if (typeof data.Vendor === 'object' && data.Vendor) {
        data.Vendor1 = data.Vendor;
        delete data.Vendor;
      } else {
        const _textValue = String(data.Vendor || '').trim();
        if (_textValue === DEFAULT_QUOTE_VENDOR_NAME) {
          data.Vendor1 = DEFAULT_QUOTE_VENDOR;
          delete data.Vendor;
        } else {
          errors.push('reject');
        }
      }
    }
    return { data, errors };
  }

  // Case A: both set → drop Vendor
  let out = guard({ Vendor: 'TD SYNNEX CORPORATION', Vendor1: { id: '1', name: 'TD' }, Subject: 'x' });
  assert.equal(out.data.Vendor, undefined, 'Vendor must be dropped');
  assert.deepEqual(out.data.Vendor1, { id: '1', name: 'TD' }, 'Vendor1 preserved');
  assert.equal(out.errors.length, 0);

  // Case B: only Vendor text matching default → rewrite
  out = guard({ Vendor: 'TD SYNNEX CORPORATION', Subject: 'x' });
  assert.equal(out.data.Vendor, undefined);
  assert.deepEqual(out.data.Vendor1, DEFAULT_QUOTE_VENDOR);

  // Case C: only Vendor as lookup-shaped object → reroute
  out = guard({ Vendor: { id: 'X', name: 'Custom Vendor' }, Subject: 'x' });
  assert.equal(out.data.Vendor, undefined);
  assert.deepEqual(out.data.Vendor1, { id: 'X', name: 'Custom Vendor' });

  // Case D: only Vendor text with unknown value → reject
  out = guard({ Vendor: 'Some Other Vendor', Subject: 'x' });
  assert.equal(out.errors.length, 1, 'unknown vendor must reject');

  // Case E: neither set → noop
  out = guard({ Subject: 'x' });
  assert.equal(out.data.Vendor, undefined);
  assert.equal(out.data.Vendor1, undefined);
  assert.equal(out.errors.length, 0);
});

console.log('\n=== Item 2: STEP 8 follow-up task Subject + error logging ===\n');

t('Task Subject derivation falls through 4 sources', () => {
  // accountData.Account_Name → account_name → existingDealData.Deal_Name → results.records.deal.name → `Deal ${dealId}`
  assert.ok(
    /const _taskAccountLabel = accountData\?\.Account_Name[\s\S]+\|\| account_name[\s\S]+\|\| existingDealData\?\.Deal_Name[\s\S]+\|\| `Deal \$\{dealId\}`/.test(source),
    'Task Subject derivation must have all four fallback sources'
  );
});

t('Task Subject uses the resolved label', () => {
  assert.ok(
    /Subject: `Follow up - \$\{_taskAccountLabel\}`/.test(source),
    'Subject must use _taskAccountLabel not raw account_name'
  );
});

t('Zoho error response gets logged with code+message+details', () => {
  assert.ok(
    /Follow-up Task creation rejected by Zoho: code=\$\{taskRow\.code/.test(source),
    'rejected-by-Zoho path must log code/message/details'
  );
});

t('Success-without-id path gets logged with raw response', () => {
  assert.ok(
    /Follow-up Task creation returned no id\. Raw response:/.test(source),
    'no-id-returned path must log raw response so anomalies are visible'
  );
});

t('Thrown error path still caught with explicit "threw" label', () => {
  assert.ok(
    /Follow-up Task creation threw: \$\{e\.message\}/.test(source),
    'thrown error path must distinguish itself from Zoho-rejected'
  );
});

console.log('\n=== Item 4: handleQuoteToPoAndEsign duplicate-fire short-circuit ===\n');

t('Duplicate-fire block present', () => {
  assert.ok(
    /Duplicate-fire short-circuit/.test(source),
    'duplicate-fire short-circuit block missing'
  );
});

t('Short-circuit gated on quoteId + no requestedSalesOrderId + no forceCreatePo', () => {
  assert.ok(
    /if \(quoteId && !requestedSalesOrderId && !forceCreatePo && env\?\.ANALYTICS_DB\)/.test(source),
    'gate must require quoteId, no SO id, no force-PO, and D1 binding'
  );
});

t('Short-circuit queries quote_po_workflow_runs in last 5 min', () => {
  assert.ok(
    /WHERE quote_id = \? AND status = 'success' AND sales_order_id IS NOT NULL[\s\S]+AND created_at > datetime\('now', '-5 minutes'\)/.test(source),
    'SQL must match status success + non-null sales_order_id + 5-min window'
  );
});

t('Short-circuit fetches existing SO + returns it', () => {
  assert.ok(
    /fetchRecordFull\('Sales_Orders', recent\.sales_order_id, env\)/.test(source),
    'must fetch full SO record by recent.sales_order_id'
  );
  assert.ok(
    /state: 'duplicate_call_recent_success'/.test(source),
    'short-circuit response must use the duplicate_call_recent_success state'
  );
});

t('Short-circuit logs to results.steps with user-visible summary', () => {
  assert.ok(
    /_user_visible_summary: `That quote was already converted to PO/.test(source),
    'user-visible summary must explain the duplicate-call short-circuit'
  );
});

t('Probe failure is non-blocking (warn + fall through)', () => {
  assert.ok(
    /\[QUOTE-PO\] Duplicate-detection probe failed \(proceeding with full flow\)/.test(source),
    'D1 probe failure must warn and fall through to the full flow'
  );
});

t('Short-circuit placement is AFTER finish const declaration', () => {
  // The block uses `finish` and `summarizeSalesOrdersForUser` — both must be in scope.
  // We position the block AFTER the netTermsNotice line (which is AFTER finish/progress).
  const finishIdx = source.indexOf('const finish = async (payload, status');
  const dupIdx = source.indexOf('Duplicate-fire short-circuit');
  assert.ok(finishIdx !== -1 && dupIdx !== -1, 'both markers must exist');
  assert.ok(finishIdx < dupIdx, 'finish const must be declared BEFORE the dup block (avoid TDZ ReferenceError)');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
