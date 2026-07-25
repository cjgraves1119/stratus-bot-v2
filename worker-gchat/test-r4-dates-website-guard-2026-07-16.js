// R4 date policy port + Website lead-source guard (2026-07-16).
//
// Incident: Llama's first live failover deal (Delta Tau Delta, 17:58) shipped
// Lead_Source "Website" (inferred from a pasted stratusinfosystems.com order
// URL) and Closing_Date +30 days — the R4 policy (Chris, 2026-07-15: +14 days,
// Deal Closing_Date === Quote Valid_Till, month-end window asks instead of
// defaulting) lived only on the corp-fixes branch and never reached this one.
//
// Pins:
//   (1) defaultQuoteDealDate: +14d, needsConfirmation inside the last 7 days
//       of the month, boundary at exactly 7 days-to-month-end = no confirm;
//   (2) validateCrmWrite Deals: past/invalid Closing_Date on CREATE corrected
//       to +14d (or needs_confirmation error in the window); valid past date
//       on UPDATE preserved (backfill);
//   (3) validateCrmWrite Quotes: missing Valid_Till defaults to +14d;
//   (4) Website guard: chat-caller "Website" lead source overridden to
//       "Stratus Referal" when the user text (URLs stripped) never says
//       website/weborder; kept when it does; fail-open without raw prompt;
//   (5) static: create_deal_and_quote closing_date param + confirmation gate
//       + executor-level Website guard survive in source.
//
// Run: node worker-gchat/test-r4-dates-website-guard-2026-07-16.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function loadEngine() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import\s+(\w+)\s+from\s+'\.\/([^']+\.json)';?$/mg, (_, n, rel) => `const ${n} = require('${esc('src/' + rel)}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { defaultQuoteDealDate, earliestAcceptedUserDate, validateCrmWrite };`;
  const tmp = path.join(os.tmpdir(), `r4-dates-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const RAW_SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
const { defaultQuoteDealDate, earliestAcceptedUserDate, validateCrmWrite } = loadEngine();

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log(`  ✅ ${name}`); }
  catch (e) { fail++; console.log(`  ❌ ${name}: ${e.message}`); }
};

const OWNER = { id: '2570562000141711002' };
const dealData = (over = {}) => ({
  Deal_Name: 'Test Deal', Stage: 'Qualification', Lead_Source: 'Stratus Referal',
  Owner: OWNER, Meraki_ISR: { id: '2570562000027286729' },
  Closing_Date: defaultQuoteDealDate().date, Account_Name: { id: '2570562000389733190' },
  ...over
});

(async () => {
  console.log('defaultQuoteDealDate — R4v2 policy math (EOM + Cisco fiscal cap, 2026-07-21)');
  await t('mid-month: end of month, no confirmation (2026-08-10 → 2026-08-31)', () => {
    const d = defaultQuoteDealDate(new Date('2026-08-10T12:00:00Z'));
    assert.strictEqual(d.date, '2026-08-31');
    assert.strictEqual(d.suggested, '2026-08-31');
    assert.strictEqual(d.needsConfirmation, false);
  });
  await t('July mid-month: EOM crosses FY26 Q4 end → confirm, suggest 2026-07-25', () => {
    const d = defaultQuoteDealDate(new Date('2026-07-16T12:00:00Z'));
    assert.strictEqual(d.date, '2026-07-31');
    assert.strictEqual(d.crossesFiscalQuarter, true);
    assert.strictEqual(d.suggested, '2026-07-25');
    assert.strictEqual(d.needsConfirmation, true);
  });
  await t('month-end window: within 7 days → needsConfirmation (2026-07-27)', () => {
    const d = defaultQuoteDealDate(new Date('2026-07-27T12:00:00Z'));
    assert.strictEqual(d.needsConfirmation, true);
    assert.strictEqual(d.daysToMonthEnd, 4);
  });
  await t('boundary: exactly 7 days to month end → NO confirmation (2026-08-24, fiscal-neutral month)', () => {
    const d = defaultQuoteDealDate(new Date('2026-08-24T12:00:00Z'));
    assert.strictEqual(d.daysToMonthEnd, 7);
    assert.strictEqual(d.needsConfirmation, false);
  });
  await t('February non-leap month end handled (2026-02-26 → 2 days left, confirm)', () => {
    const d = defaultQuoteDealDate(new Date('2026-02-26T12:00:00Z'));
    assert.strictEqual(d.daysToMonthEnd, 2);
    assert.strictEqual(d.needsConfirmation, true);
  });
  await t('earliestAcceptedUserDate is one day behind UTC today', () => {
    const e = earliestAcceptedUserDate(new Date('2026-07-16T01:00:00Z'));
    assert.strictEqual(e, '2026-07-15');
  });

  console.log('\nvalidateCrmWrite Deals — Closing_Date enforcement');
  {
    const dd = defaultQuoteDealDate();
    const data = dealData({ Closing_Date: '2020-01-01' });
    const res = await validateCrmWrite('Deals', data, true, {});
    if (dd.needsConfirmation) {
      await t('past date on CREATE inside month-end window → needs_confirmation error', () =>
        assert.ok(res.valid === false && /closing_date_needs_confirmation/.test(res.error)));
    } else {
      await t('past date on CREATE corrected to the EOM/fiscal-capped default', () =>
        assert.ok(res.valid === true && data.Closing_Date === dd.suggested));
    }
  }
  await t('valid past date on UPDATE preserved (intentional backfill)', async () => {
    const data = { Closing_Date: '2025-01-15' };
    const res = await validateCrmWrite('Deals', data, false, {});
    assert.ok(res.valid === true && data.Closing_Date === '2025-01-15');
  });

  console.log('\nvalidateCrmWrite Deals — Website lead-source guard');
  await t('pasted order URL, no website wording → overridden to Stratus Referal', async () => {
    const env = { __USER_PROMPT_RAW: 'create quote in zoho for https://stratusinfosystems.com/order/?item=MS130-8P-HW&qty=1' };
    const data = dealData({ Lead_Source: 'Website' });
    await validateCrmWrite('Deals', data, true, env);
    assert.strictEqual(data.Lead_Source, 'Stratus Referal');
  });
  await t('explicit weborder wording → Website kept', async () => {
    const env = { __USER_PROMPT_RAW: 'new weborder came in from the website — create the deal for Acme' };
    const data = dealData({ Lead_Source: 'Website' });
    await validateCrmWrite('Deals', data, true, env);
    assert.strictEqual(data.Lead_Source, 'Website');
  });
  await t('no raw prompt available (non-chat caller) → fail-open, Website kept', async () => {
    const data = dealData({ Lead_Source: 'Website' });
    await validateCrmWrite('Deals', data, true, {});
    assert.strictEqual(data.Lead_Source, 'Website');
  });
  await t('guard is create-only — updates never touched', async () => {
    const env = { __USER_PROMPT_RAW: 'change the amount to 5000' };
    const data = { Lead_Source: 'Website' };
    await validateCrmWrite('Deals', data, false, env);
    assert.strictEqual(data.Lead_Source, 'Website');
  });

  console.log('\nvalidateCrmWrite Quotes — Valid_Till R4v2 default');
  await t('missing Valid_Till → EOM/fiscal-capped default applied to payload', async () => {
    const data = { Subject: 'T', Deal_Name: { id: '1' }, Contact_Name: { id: '1' }, Owner: OWNER };
    await validateCrmWrite('Quotes', data, true, {});
    assert.strictEqual(data.Valid_Till, defaultQuoteDealDate().suggested);
  });

  console.log('\nstatic source pins');
  await t('create_deal_and_quote accepts user-confirmed closing_date (schema + destructure)', () =>
    assert.ok(RAW_SRC.includes("closing_date: { type: 'string', description: 'Optional YYYY-MM-DD close date") && RAW_SRC.includes('toolInput.closing_date')));
  await t('create_deal_and_quote month-end confirmation gate present', () =>
    assert.ok(RAW_SRC.includes("error: 'closing_date_needs_confirmation'") && RAW_SRC.includes('suggested_date: _dd.suggested') && RAW_SRC.includes('suggested_date: _fiscalEnd')));
  await t('executor-level Website guard present in create_deal_and_quote', () =>
    assert.ok(RAW_SRC.includes('reserved for weborders; a pasted order URL is not a website lead')));
  await t('no +30-day defaults remain on deal/quote create paths', () =>
    assert.ok(!/closingDate = new Date\(Date\.now\(\) \+ 30 \* 86400000\)/.test(RAW_SRC)));
  await t('Llama prompt: order URL ≠ Website lead + date-confirmation relay rules', () =>
    assert.ok(RAW_SRC.includes('is ONLY for actual weborders') && RAW_SRC.includes('closing_date_needs_confirmation" (month-end window or fiscal-quarter slip), ASK the user')));

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
