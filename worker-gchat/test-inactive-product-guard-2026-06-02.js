// Tests for the 2026-06-02 inactive-product / Zoho-error-surfacing fixes.
//
// Production incident (2026-06-02): the agent tried to add LIC-SME-5YR (Zoho
// product 2570562000001277655) to a quote. That product is INACTIVE in Zoho, so
// every update was rejected with "NOT_ALLOWED — can't add inactive product."
// The agent did not treat this as terminal, looped on the dead id for 1-2 min,
// and the user got an opaque "API 400". Also: top-level Zoho errors (e.g.
// INVALID_URL_PATTERN with no data[] array) were being reported as success.
//
// These tests verify:
//   1. parseZohoResponse marks inactive-product failures TERMINAL (_no_retry).
//   2. parseZohoResponse no longer masks top-level error shapes as success.
//   3. preflightQuotedItemsProductActive blocks new line items whose SKU is
//      flagged zoho_active:false, while leaving active SKUs alone.
// Run: node test-inactive-product-guard-2026-06-02.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${escPath('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `\nmodule.exports = { parseZohoResponse, preflightQuotedItemsProductActive, getProductIdToSkuMap, prices };`;
  const tmp = path.join(os.tmpdir(), `stratus-inactive-guard-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { parseZohoResponse, preflightQuotedItemsProductActive, prices } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const SME5_ID = '2570562000001277655'; // LIC-SME-5YR — inactive in Zoho
const SME3_ID = '2570562000001277654'; // LIC-SME-3YR — deactivated in Zoho 2026-06-26 (SME discontinued)
const IVANTI3_ID = '2570562000414875795'; // LIC-MI-EMSC-D-1YMC-A-3YR — active replacement

console.log('── parseZohoResponse: inactive-product terminal handling ──');

t('inactive-product error is terminal (_no_retry) with stop guidance', () => {
  const r = parseZohoResponse({
    data: [{ code: 'NOT_ALLOWED', message: "can't add inactive product in the inventory",
             details: { api_name: 'id', json_path: '$.data[0].Quoted_Items[0].Product_Name.id' } }]
  }, 'Quotes record update');
  assert.strictEqual(r.success, false, 'should be failure');
  assert.strictEqual(r._no_retry, true, 'should be flagged terminal');
  assert.ok(/TERMINAL/i.test(r.message) && /do NOT retry/i.test(r.message), 'message must tell the agent to stop');
});

t('a NON-inactive NOT_ALLOWED stays a normal (retryable) failure', () => {
  const r = parseZohoResponse({ data: [{ code: 'NOT_ALLOWED', message: 'permission denied' }] }, 'Quotes record update');
  assert.strictEqual(r.success, false);
  assert.ok(!r._no_retry, 'should NOT be marked terminal');
});

console.log('── parseZohoResponse: stop masking errors as success ──');

t('top-level error shape (INVALID_URL_PATTERN, no data[]) → failure', () => {
  const r = parseZohoResponse({ code: 'INVALID_URL_PATTERN', status: 'error', message: 'invalid url' }, 'Deals record update');
  assert.strictEqual(r.success, false, 'must NOT report a Zoho error as ✅ completed');
});

t('genuine non-standard success (no code/error) still succeeds', () => {
  const r = parseZohoResponse({ ok: true, foo: 'bar' }, 'operation');
  assert.strictEqual(r.success, true);
});

t('standard SUCCESS still succeeds', () => {
  const r = parseZohoResponse({ data: [{ code: 'SUCCESS', details: { id: '123' } }] }, 'Quotes record create');
  assert.strictEqual(r.success, true);
  assert.strictEqual(r.record_id, '123');
});

console.log('── preflightQuotedItemsProductActive: zoho_active guard ──');

t('catalog confirms LIC-SME-5YR is flagged zoho_active:false', () => {
  assert.strictEqual(prices['LIC-SME-5YR'].zoho_active, false);
});

t('NEW line item with inactive SME-5YR is blocked with INACTIVE guidance', () => {
  const res = preflightQuotedItemsProductActive([
    { Product_Name: { id: SME5_ID }, Quantity: 84, Discount: 3192 }
  ]);
  assert.strictEqual(res.valid, false, 'should block');
  assert.ok(res.errors.some(e => /INACTIVE in Zoho/i.test(e)), 'error should name it inactive in Zoho');
});

t('NEW line item with discontinued SME-3YR is blocked and points at the replacement', () => {
  const res = preflightQuotedItemsProductActive([
    { Product_Name: { id: SME3_ID }, Quantity: 84 }
  ]);
  const inactiveErr = (res.errors || []).find(e => /INACTIVE in Zoho/i.test(e));
  assert.ok(inactiveErr, 'discontinued SME-3YR must trip the inactive guard');
  assert.ok(/LIC-MI-EMSC-D-1YMC-A-3YR/.test(inactiveErr), `guidance must name the replacement: ${inactiveErr}`);
});

t('NEW line item with the ACTIVE Ivanti replacement is NOT blocked as inactive', () => {
  const res = preflightQuotedItemsProductActive([
    { Product_Name: { id: IVANTI3_ID }, Quantity: 84 }
  ]);
  const inactiveErr = (res.errors || []).some(e => /INACTIVE in Zoho/i.test(e));
  assert.ok(!inactiveErr, 'active replacement must not trip the inactive guard');
});

t('in-place modify (item has id) is left to the terminal-error net (not pre-blocked)', () => {
  // Existing line items (with an id) are intentionally skipped by preflight; the
  // parseZohoResponse terminal handler is the safety net for those.
  const res = preflightQuotedItemsProductActive([
    { id: '999', Product_Name: { id: SME5_ID }, Quantity: 84 }
  ]);
  assert.strictEqual(res.valid, true);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
