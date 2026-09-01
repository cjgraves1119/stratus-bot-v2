// Consolidation seams: v1.26 incident fixes (#9/#10) landing on the PR#155 +
// one-shot + email-intake candidate lineage.
//
// These are BEHAVIORAL: the real worker module is loaded and the real
// functions run. They cover the five adversarial-review seams at the exact
// boundary the review flagged, PLUS the consolidation invariants — that the
// one-shot route/token/mutex safeguards still hold with v1.26 code present.
//
// test-extension-dev-bugs-2026-07-31.js covers the core #9/#10 behaviors;
// this file deliberately targets what that suite does NOT: typed recovery on
// the dashboard-resume and multi-option/draft seams, region fail-closed
// atomicity, and cross-feature (v1.26 x one-shot) non-interference.
//
// No network, CRM, Cloudflare, or customer data.
// Run: node worker-gchat/test-v126-consolidation-seams-2026-08-01.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function loadWorker() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  for (const [imp, file] of [
    ['pricesData', 'src/data/prices.json'],
    ['catalogData', 'src/data/auto-catalog.json'],
    ['specsData', 'src/data/specs.json'],
    ['accessoriesData', 'src/data/accessories.json'],
    ['voiceSkillData', 'src/email-reply-voice-skill.json'],
  ]) {
    src = src.replace(
      new RegExp('^import ' + imp + " from '[^']+';?$", 'm'),
      'const ' + imp + ' = require(' + JSON.stringify(path.join(here, file)) + ');'
    );
  }
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += `\nmodule.exports.__test = {
    buildDashboardRenewalQuote, dashboardSkuDisposition, dashboardRowsNeedMxEdition,
    normalizeDashboardMxEdition, resolveMxEditionTargetSku, handleMxEditionCorrection,
    parseMxEditionCorrection, resolveOrderLinkItems, buildStratusUrl,
    buildLabeledOrderUrlsAtomically, normalizeComplexityReply, buildComplexityRecovery,
    buildOneshotIntake, claimOneshotExecution, settleOneshotClaim, executeOneshot,
    validateOneshotReviewBinding, signOneshotReviewToken, buildOneshotReviewSnapshot,
  };`;
  const tmp = path.join(os.tmpdir(), 'stratus-v126-seams-' + process.pid + '.cjs');
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const M = loadWorker().__test;
let pass = 0, fail = 0;
const ok = (n) => { pass++; console.log(`  ✅ ${n}`); };
const bad = (n, e) => { fail++; console.log(`  ❌ ${n}\n      ${e}`); };
function check(n, fn) { try { fn(); ok(n); } catch (e) { bad(n, e.message); } }
async function checkAsync(n, fn) { try { await fn(); ok(n); } catch (e) { bad(n, e.message); } }

(async () => {

console.log('\n(1) Editionless vMX / Insight survive clarification AND resume');

check('vMX-only dashboard blocks for edition, survives the row filter, and resumes (no loop)', () => {
  const rows = [{ sku: 'LIC-VMX-S-3Y', qty: 2 }];
  assert.strictEqual(M.dashboardRowsNeedMxEdition(rows), true, 'editionless vMX must require an edition');
  const blocked = M.buildDashboardRenewalQuote(rows, {});
  assert.ok(blocked.needsClarification, 'must block, not guess');
  assert.ok(!/stratusinfosystems\.com\/order/.test(String(blocked.message || '')), 'a blocked card emits no link');
  // The loop bug was in the row filter the route applies before returning the
  // clarification card: 'unsupported' rows are dropped, and vMX/Insight used
  // to fall in that bucket, so a vMX-only dashboard came back with zero rows
  // and every answer produced another empty card. The disposition IS the fix.
  const survivors = rows.filter((r) => M.dashboardSkuDisposition(r.sku) !== 'unsupported');
  assert.strictEqual(survivors.length, 1, 'the vMX row must survive the clarification-card row filter');
  // And answering the edition must actually resume into a real quote.
  const resumed = M.buildDashboardRenewalQuote(rows, { mxEdition: 'Enterprise' });
  assert.ok(!resumed.needsClarification, 'answering the edition must resume, not re-block');
  assert.ok(/LIC-VMX-S-ENT/.test(JSON.stringify(resumed)), 'resume must produce the ENT vMX SKU');
});

check('Insight rows are transform-dispositioned, never dropped as unsupported', () => {
  assert.strictEqual(M.dashboardSkuDisposition('LIC-MI-S-3YR'), 'transform');
  assert.strictEqual(M.dashboardSkuDisposition('LIC-VMX-S-3Y'), 'transform');
  assert.strictEqual(M.dashboardSkuDisposition('MX85-HW'), 'direct');
  // A genuinely unsupported subscription-only LIC row still drops.
  assert.strictEqual(M.dashboardSkuDisposition('LIC-TOTALLY-MADE-UP-9Y'), 'unsupported');
});

check('mixed hardware + editionless vMX + Insight keeps EVERY row through the filter', () => {
  const rows = [{ sku: 'MX68-HW', qty: 1 }, { sku: 'LIC-VMX-S-3Y', qty: 2 }, { sku: 'LIC-MI-S-3YR', qty: 1 }];
  assert.ok(M.buildDashboardRenewalQuote(rows, {}).needsClarification, 'must block on the editionless vMX');
  const survivors = rows.filter((r) => M.dashboardSkuDisposition(r.sku) !== 'unsupported');
  assert.strictEqual(survivors.length, 3,
    'hardware (direct), vMX (transform) and Insight (transform) must all replay into the resume');
});

console.log('\n(2) order_sku_unavailable → typed recovery on resume / multi-option / draft seams');

check('buildStratusUrl throws a TYPED error (code preserved) for an unresolvable -HW SKU', () => {
  let threw = null;
  try { M.buildStratusUrl([{ sku: 'MX67C-HW-WW', qty: 1 }]); } catch (e) { threw = e; }
  assert.ok(threw, 'must throw rather than emit an -HW link');
  assert.strictEqual(threw.code, 'order_sku_unavailable', 'the error must be typed for callers to catch');
  assert.ok(threw.details && Array.isArray(threw.details.blocked), 'blocked list must ride the error');
});

check('correction seam converts the typed throw into a recovery, never a raw 500', () => {
  // A prior card whose cart carries an unresolvable regional -HW SKU alongside
  // a correctable MX license: rebuilding the link throws order_sku_unavailable
  // deep inside buildStratusUrl. That MUST surface as a typed recovery.
  const prior = 'Quote: https://stratusinfosystems.com/order/?item=MX67C-HW-WW,LIC-MX85-SEC-3Y&qty=1,1';
  let res;
  assert.doesNotThrow(() => { res = M.handleMxEditionCorrection('change SEC to ENT', prior); },
    'the typed throw must be caught, never escape to a raw 500');
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.success, false, 'an unavailable order SKU must fail closed');
  assert.strictEqual(res.error, 'order_sku_unavailable', 'the recovery must keep the typed code');
  assert.ok(res.recovery && res.recovery.kind === 'quote_correction', 'a typed recovery must be returned');
  assert.strictEqual(res.recovery.write_state, 'none', 'no write may be implied');
  assert.deepStrictEqual(res.quoteUrls, [], 'no partial/customer-facing link may be emitted');
});

check('a blocked-dashboard resume with no usable rows returns typed recovery, not a crash', () => {
  const prior = '[Dashboard quote blocked pending MX edition]\n(no rows captured)';
  let res;
  assert.doesNotThrow(() => { res = M.handleMxEditionCorrection('actually Enterprise', prior); });
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'dashboard_context_invalid');
  assert.strictEqual(res.recovery.write_state, 'none');
  assert.deepStrictEqual(res.quoteUrls, []);
});

check('multi-option staging is atomic: one bad cart yields NO urls at all', () => {
  let threw = null;
  try {
    M.buildLabeledOrderUrlsAtomically([
      { label: 'Option 1', items: [{ sku: 'MX68-HW', qty: 1 }] },
      { label: 'Option 2', items: [{ sku: 'MX67C-HW-WW', qty: 1 }] },
    ]);
  } catch (e) { threw = e; }
  assert.ok(threw, 'a bad cart must abort the whole labeled set');
  assert.strictEqual(threw.code, 'order_sku_unavailable');
  // The good option must NOT have been published on its own.
  assert.ok(!/stratusinfosystems\.com\/order/.test(String(threw.partialUrls || '')),
    'no partial option list may leak to the caller');
});

check('a fully-resolvable multi-option set still builds every option', () => {
  const staged = M.buildLabeledOrderUrlsAtomically([
    { label: 'Option 1', items: [{ sku: 'MX68-HW', qty: 1 }] },
    { label: 'Option 2', items: [{ sku: 'MX67-HW', qty: 2 }] },
  ]);
  assert.strictEqual(staged.length, 2);
  staged.forEach((s) => assert.ok(/^https:\/\/stratusinfosystems\.com\/order\/\?/.test(s.url)));
  // -HW must have been rewritten to the active order form on the way out.
  assert.ok(!/-HW/.test(staged.map((s) => s.url).join('|')), 'no -HW identifier may reach a customer link');
});

console.log('\n(3) Region preserved; unresolvable region fails the WHOLE cart');

check('-NA geography survives the -HW rewrite', () => {
  const r = M.resolveOrderLinkItems([{ sku: 'MX68CW-HW-NA', qty: 1 }]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.items[0].sku, 'MX68CW-NA', 'region suffix must be preserved, -HW removed');
});

check('non-MX/MS families and accessories are untouched', () => {
  const r = M.resolveOrderLinkItems([{ sku: 'MR44-HW', qty: 1 }, { sku: 'MA-CBL-LEAK-1', qty: 2 }]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.items.map((i) => i.sku), ['MR44-HW', 'MA-CBL-LEAK-1']);
});

check('one unresolvable line blocks the entire cart (no partial, no -HW fallback)', () => {
  const r = M.resolveOrderLinkItems([{ sku: 'MX85-HW', qty: 1 }, { sku: 'MX67C-HW-WW', qty: 1 }]);
  assert.strictEqual(r.ok, false, 'the whole cart must fail');
  assert.strictEqual(r.error, 'order_sku_unavailable');
  assert.deepStrictEqual(r.items, [], 'no items may be returned for a blocked cart');
  assert.ok(r.blocked.some((b) => b.sku === 'MX67C-HW-WW'));
});

console.log('\n(4) Z-series SEC→ENT consistent; SDW preserved; legacy Z untouched');

check('Z4 and Z4C map SEC→ENT at every catalog term', () => {
  for (const model of ['Z4', 'Z4C']) {
    for (const term of ['1', '3', '5']) {
      const r = M.resolveMxEditionTargetSku(`LIC-${model}-SEC-${term}Y`, 'ENT');
      assert.strictEqual(r.applies, true, `${model} ${term}Y must be correctable`);
      assert.strictEqual(r.target, `LIC-${model}-ENT-${term}Y`);
    }
  }
});

check('Z4 SDW fails closed (null target) instead of coercing back to SEC', () => {
  const r = M.resolveMxEditionTargetSku('LIC-Z4-SEC-3Y', 'SDW');
  assert.strictEqual(r.applies, true);
  assert.strictEqual(r.target, null, 'SDW has no Z catalog tier — must not silently map to SEC');
});

check('legacy ENT-only Z families are not treated as correctable', () => {
  for (const sku of ['LIC-Z1-ENT-3Y', 'LIC-Z3-ENT-3Y', 'LIC-Z3C-ENT-3Y']) {
    assert.strictEqual(M.resolveMxEditionTargetSku(sku, 'SEC').applies, false, `${sku} must not apply`);
  }
});

check('a mixed MX + Z4 correction rewrites BOTH lines or neither (no silent partial)', () => {
  const prior = 'Quote: https://stratusinfosystems.com/order/?item=LIC-MX85-SEC-3Y,LIC-Z4-SEC-3Y&qty=1,1';
  const res = M.handleMxEditionCorrection('change SEC to ENT', prior);
  assert.strictEqual(res.handled, true);
  assert.strictEqual(res.success, true, 'both lines have ENT equivalents');
  const changed = (res.changed_skus || []).map((c) => c.from).sort();
  assert.deepStrictEqual(changed, ['LIC-MX85-SEC-3Y', 'LIC-Z4-SEC-3Y'],
    'the Z line must not be silently skipped while the MX line flips');
  assert.ok(!/SEC/.test(res.quoteUrls[0].url), 'no SEC SKU may survive in the corrected link');
});

console.log('\n(5) Malformed prior-URL quantities are REJECTED, never silently reset');

check('qty count mismatched to item count fails closed', () => {
  const prior = 'Quote: https://stratusinfosystems.com/order/?item=LIC-MX85-SEC-3Y,LIC-MX84-SEC-3Y&qty=5';
  const res = M.handleMxEditionCorrection('change SEC to ENT', prior);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.error, 'prior_quote_invalid');
  assert.deepStrictEqual(res.quoteUrls, []);
});

check('zero and non-numeric quantities fail closed', () => {
  for (const qty of ['0', 'abc', '-2']) {
    const prior = `Quote: https://stratusinfosystems.com/order/?item=LIC-MX85-SEC-3Y&qty=${qty}`;
    const res = M.handleMxEditionCorrection('change SEC to ENT', prior);
    assert.strictEqual(res.success, false, `qty=${qty} must be rejected`);
    assert.strictEqual(res.error, 'prior_quote_invalid');
  }
});

check('a well-formed prior URL PRESERVES its quantities through the correction', () => {
  const prior = 'Quote: https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-SEC-3Y&qty=7,7';
  const res = M.handleMxEditionCorrection('change SEC to ENT', prior);
  assert.strictEqual(res.success, true);
  assert.ok(/qty=7,7/.test(res.quoteUrls[0].url), 'quantities must survive, not reset to 1');
});

console.log('\n(6) Exhaustion recovery is typed per surface and never auto-retries');

check('crm surface with a write tool → possible write, verify-first, no retry', () => {
  const r = M.normalizeComplexityReply(
    'I ran into a complex operation that required too many steps. Could you break it into smaller pieces?',
    { surface: 'crm', toolCalls: [{ name: 'create_deal_and_quote' }] }
  );
  assert.strictEqual(r.exhausted, true);
  assert.strictEqual(r.recovery.write_state, 'possible');
  assert.ok(/verify/i.test(r.recovery.detail));
});

check('quote surface → write_state unknown (never a false "no write")', () => {
  const r = M.normalizeComplexityReply(
    'I ran into a complex operation that required too many steps. Could you break your request into smaller pieces?',
    { surface: 'quote' }
  );
  assert.strictEqual(r.exhausted, true);
  assert.strictEqual(r.recovery.write_state, 'unknown');
});

check('dashboard surface → re-capture guidance, no quote link', () => {
  const r = M.normalizeComplexityReply(
    'I ran into a complex operation that required too many steps. Could you break it into smaller pieces?',
    { surface: 'dashboard' }
  );
  assert.strictEqual(r.recovery.code, 'retry_dashboard_capture');
  assert.ok(!/stratusinfosystems\.com\/order/.test(r.reply), 'no link may be offered');
});

check('an ordinary reply is passed through untouched', () => {
  const r = M.normalizeComplexityReply('Here is your quote.', { surface: 'quote' });
  assert.strictEqual(r.exhausted, false);
  assert.strictEqual(r.reply, 'Here is your quote.');
  assert.strictEqual(r.recovery, null);
});

console.log('\n(7) Consolidation invariants — v1.26 did not weaken one-shot/intake');

await checkAsync('intake still gates on flag + allowlist + real caller', async () => {
  const off = await M.buildOneshotIntake({ subject: 's', body_text: 'b' }, {}, 'chrisg@stratusinfosystems.com', async () => ({}));
  assert.strictEqual(off.error, 'intake_disabled');
  const env = { CHAT_ONESHOT_ROUTE_ENABLED: 'true', CHAT_ONESHOT_OWNER_ALLOWLIST: 'chrisg@stratusinfosystems.com' };
  const anon = await M.buildOneshotIntake({ subject: 's', body_text: 'b' }, env, 'chrome-extension-user', async () => ({}));
  assert.strictEqual(anon.error, 'caller_required');
  const other = await M.buildOneshotIntake({ subject: 's', body_text: 'b' }, env, 'nope@example.com', async () => ({}));
  assert.strictEqual(other.error, 'caller_not_allowed');
});

await checkAsync('execute still fails closed with no D1 binding — zero tool calls', async () => {
  const res = await M.executeOneshot({
    idempotency_key: 'ext:seam-test-1', review_token: 'x',
    skus: [{ sku: 'MX85-HW', qty: 1 }], closing_date: '2026-08-25',
    account: { id: 'A1' }, contact: { id: 'C1' }, deal: { new: true, confirmed: true },
  }, { /* no ANALYTICS_DB */ }, 'chrisg@stratusinfosystems.com');
  assert.strictEqual(res.success, false);
  // Either the review token is rejected first, or the mutex is unavailable —
  // both are fail-closed and neither reaches a CRM write.
  assert.ok(['review_required', 'review_invalid', 'mutex_unavailable'].includes(res.error),
    `unexpected error: ${res.error}`);
});

await checkAsync('claim reports migration_required when the table is absent', async () => {
  const db = { prepare: () => ({ bind: () => ({ run: async () => { throw new Error('D1_ERROR: no such table: oneshot_claims'); }, first: async () => { throw new Error('D1_ERROR: no such table: oneshot_claims'); } }) }) };
  const r = await M.claimOneshotExecution({ ANALYTICS_DB: db }, 'k', 'chrisg@stratusinfosystems.com');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.migration_required, true);
  assert.strictEqual(r.retryable, false);
});

check('the v1.26 correction path is NOT a one-shot execute path (no CRM write surface)', () => {
  const fnSrc = String(M.handleMxEditionCorrection);
  assert.ok(!/executeToolCall|create_deal_and_quote|create_quote_on_deal/.test(fnSrc),
    'the edition correction must never reach a CRM write executor');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
