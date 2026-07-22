// Corp error_reports fix regression suite (2026-07-15) — R1 / R11 / R6 / R4 /
// R5 / R8a from PLAN-corp-error-reports-2026-07-14.md.
//
//   R1  — classifyCrmIntent write-rule article widening ("add THE contact") +
//         write-verb escalation net + never-enumerate-tools prompt rule.
//   R11 — active-record binding: explicit-ecomm ask > Zoho page context >
//         lexical quote heuristics (classifier rule 6 'quote' verb, waterfall
//         Tier-0 pin, prompt binding rules).
//   R6  — follow-up Task owner: requesting user → Deal Owner → SYSTEM_OWNER_ID.
//   R4  — Quote Valid_Till + Deal Closing_Date default = creation + 14 days,
//         always matching; month-end window (≤7 days to month end) asks the
//         user instead of silently defaulting.
//   R5  — MX/C81xx license tier never defaults to ENT (assume SEC + offer).
//   R8a — batch_product_lookup always surfaces eol/replaced_by.
//
// All assertions are pure-Node — no Cloudflare bindings, no live LLM calls.
// Run: node worker-gchat/test-corp-error-reports-2026-07-15.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

async function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  // Keep the module in ESM form (the file is authored as ESM; converting to CJS
  // trips the brace-walking export-default strip other suites use on template
  // literals in the corp tree). Data imports become inline JSON reads; the
  // workflow base class is stubbed; symbols are re-exported and loaded via
  // dynamic import of a .mjs temp file.
  src = `import { readFileSync as __rfs } from 'node:fs';\n` + src;
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m,
    'class WorkflowEntrypoint {}');
  for (const [name, rel] of [
    ['pricesData', 'src/data/prices.json'],
    ['catalogData', 'src/data/auto-catalog.json'],
    ['specsData', 'src/data/specs.json'],
    ['accessoriesData', 'src/data/accessories.json'],
    ['voiceSkillData', 'src/email-reply-voice-skill.json'],
  ]) {
    const re = new RegExp(`^import ${name} from '[^']+';?$`, 'm');
    src = src.replace(re, `const ${name} = JSON.parse(__rfs('${escPath(rel)}', 'utf8'));`);
  }
  src += `
export {
  classifyCrmIntent,
  isExplicitEcommUrlAsk,
  hasActiveZohoPageContext,
  defaultQuoteDealDate,
  validateCrmWrite,
  callerEmailFromPersonId,
  checkEol,
  looksLikeZohoQuoteIntent,
  fedrampCandidateSkus,
  FEDRAMP_DEFAULT_DISCOUNT,
  CRM_AGENT_SYSTEM_PROMPT_BASE,
  CRM_EMAIL_TOOLS,
  TOOL_SUBSETS,
  BENCHMARK_TASKS
};`;
  const tmp = path.join(os.tmpdir(), `stratus-gchat-corp-err-${process.pid}.mjs`);
  fs.writeFileSync(tmp, src);
  const mod = await import('file://' + tmp);
  return { mod, rawSrc: fs.readFileSync(path.join(here, 'src/index.js'), 'utf8') };
}

let mod, rawSrc;
let classifyCrmIntent, isExplicitEcommUrlAsk, hasActiveZohoPageContext, defaultQuoteDealDate, validateCrmWrite, callerEmailFromPersonId, checkEol, looksLikeZohoQuoteIntent, fedrampCandidateSkus, FEDRAMP_DEFAULT_DISCOUNT, CRM_AGENT_SYSTEM_PROMPT_BASE, CRM_EMAIL_TOOLS, TOOL_SUBSETS, BENCHMARK_TASKS;

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
async function ta(name, fn) {
  try { await fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

(async () => {

({ mod, rawSrc } = await buildShim());
({ classifyCrmIntent, isExplicitEcommUrlAsk, hasActiveZohoPageContext, defaultQuoteDealDate, validateCrmWrite, callerEmailFromPersonId, checkEol, looksLikeZohoQuoteIntent, fedrampCandidateSkus, FEDRAMP_DEFAULT_DISCOUNT, CRM_AGENT_SYSTEM_PROMPT_BASE, CRM_EMAIL_TOOLS, TOOL_SUBSETS, BENCHMARK_TASKS } = mod);

console.log('\nR1 — classifier write-rule articles + escalation net');
console.log('────────────────────────────────────────────────────────────────');

t('incident phrasing: "add the contact Michael Gray …" → crm_write', () => {
  const r = classifyCrmIntent("add the contact Michael Gray michael.gray@example.org to the St. John's Prep account");
  assert.strictEqual(r.class, 'crm_write');
});
t('"add another contact for this account" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('add another contact for this account').class, 'crm_write');
});
t('"create the account Acme Holdings LLC" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('create the account Acme Holdings LLC').class, 'crm_write');
});
t('"add this contact to zoho" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('add this contact to zoho').class, 'crm_write');
});
t('"add new contact Jane Doe" → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('add new contact Jane Doe').class, 'crm_write');
});
t('regression: "add a contact" (original working phrasing) → crm_write', () => {
  assert.strictEqual(classifyCrmIntent('you can add a contact — add a contact named Michael Gray').class, 'crm_write');
});
t('escalation net: read-shaped message with a write verb → crm_write', () => {
  // Read rule matches "the latest quote"; 'set' is a bare write verb the
  // mutation rules failed to bind (shipping CITY is not in the noun list).
  const r = classifyCrmIntent('the latest quote needs attention — set the shipping city to Reno');
  assert.strictEqual(r.class, 'crm_write');
});
t('escalation net respects "update me on …" (pure status ask stays read)', () => {
  const r = classifyCrmIntent('update me on the latest deal for Acme');
  assert.strictEqual(r.class, 'crm_read');
});
t('pure read stays read: "show me the latest contact for Acme"', () => {
  assert.strictEqual(classifyCrmIntent('show me the latest contact for Acme').class, 'crm_read');
});
t('prompt: never enumerate internal tool names to the user', () => {
  assert.ok(/NEVER enumerate internal tool names/i.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});

console.log('\nR11 — explicit-ecomm ask > Zoho page context > lexical heuristics');
console.log('────────────────────────────────────────────────────────────────');

t('isExplicitEcommUrlAsk: all decided phrasings fire', () => {
  for (const s of ['send me a url quote for 2 MR46', 'give me an ecomm quote', 'can I get a quote link',
    'quote url please', 'order link for 3 MX85', 'the stratus url for this', 'send me a link to order',
    'ecommerce link', 'ecomm link please', 'shopping cart link']) {
    assert.ok(isExplicitEcommUrlAsk(s), `should fire: "${s}"`);
  }
});
t('isExplicitEcommUrlAsk: plain quote asks do NOT fire', () => {
  for (const s of ['create a quote for 2 MX84 SEC licenses and 2 Z3 ENT licenses',
    'quote 2 mx84 sec licenses', 'add 2 licenses to the quote', 'make this a 3 year quote']) {
    assert.ok(!isExplicitEcommUrlAsk(s), `should NOT fire: "${s}"`);
  }
});
t('hasActiveZohoPageContext detects the extension header', () => {
  assert.ok(hasActiveZohoPageContext('[Active Zoho page: user is currently viewing Quote 2570562000399909180]\ncreate a quote'));
  assert.ok(!hasActiveZohoPageContext('create a quote for 2 MX84 SEC licenses'));
});
t('classifier: incident phrasing + page ctx → crm_write (rule 0)', () => {
  const r = classifyCrmIntent('create a quote for 2 MX84 SEC licenses and 2 Z3 ENT licenses', { hasActivePageContext: true });
  assert.strictEqual(r.class, 'crm_write');
});
t('classifier: bare "quote …" verb + page ctx → crm_write (rule 6)', () => {
  const r = classifyCrmIntent('quote 2 MX84 SEC licenses and 2 Z3 ENT licenses', { hasActivePageContext: true });
  assert.strictEqual(r.class, 'crm_write');
});
t('classifier: explicit ecomm ask beats page ctx → quote_url', () => {
  for (const s of ['send me a url quote for 2 MR46', 'give me an order link for 3 MX85', 'need the ecomm quote for this']) {
    const r = classifyCrmIntent(s, { hasActivePageContext: true });
    assert.strictEqual(r.class, 'quote_url', `"${s}" → ${r.class}`);
  }
});
t('waterfall Tier-0: page-context pin wired into skipDeterministic', () => {
  assert.ok(/wZohoPagePinned = hasActiveZohoPageContext\(wText\) && !isExplicitEcommUrlAsk\(wText\)/.test(rawSrc));
  assert.ok(/skipDeterministic = wSource === 'chat-tab' \|\| \(wEc && wEc\.source === 'chat-tab'\) \|\| wZohoPagePinned/.test(rawSrc));
});
t('prompt: ACTIVE RECORD BINDING + fast-path rules present', () => {
  assert.ok(/ACTIVE RECORD BINDING/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/on a Quote page → that quote; else → its Deal; else → its Account/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/FAST-PATH — quote on the active\/known Deal/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/EXCEPTION — \[Active Zoho page\] present: every quote ask is a ZOHO CRM quote/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});
t('benchmarks: R11 fixtures assert CRM routing + zero zoho_search_records', () => {
  const t76 = BENCHMARK_TASKS.find(x => x.id === 'task_76');
  const t77 = BENCHMARK_TASKS.find(x => x.id === 'task_77');
  const t78 = BENCHMARK_TASKS.find(x => x.id === 'task_78');
  assert.ok(t76 && t76.expected.includes('create_quote_on_deal') && t76.forbidden.includes('zoho_search_records'));
  assert.ok(t77 && t77.expected.includes('create_quote_on_deal') && t77.forbidden.includes('zoho_search_records'));
  assert.ok(t78 && t78.expected.includes('zoho_update_record') && t78.forbidden.includes('zoho_search_records'));
});

console.log('\nR6 — follow-up Task owner resolution');
console.log('────────────────────────────────────────────────────────────────');

t('callerEmailFromPersonId: gw:/ext: emails extract, others null', () => {
  assert.strictEqual(callerEmailFromPersonId('gw:chrisg@stratusinfosystems.com'), 'chrisg@stratusinfosystems.com');
  assert.strictEqual(callerEmailFromPersonId('ext:Amir@StratusInfoSystems.com'), 'amir@stratusinfosystems.com');
  assert.strictEqual(callerEmailFromPersonId('gw:gateway-user'), null);
  assert.strictEqual(callerEmailFromPersonId('chrome-ext-chat-quote-abc123'), null);
  assert.strictEqual(callerEmailFromPersonId(null), null);
});
t('createFollowUpTaskForDeal resolves user → deal owner → system (static evidence)', () => {
  const fnStart = rawSrc.indexOf('async function createFollowUpTaskForDeal');
  const fnBody = rawSrc.slice(fnStart, fnStart + 8000); // widened 2026-07-21: dedupe preamble precedes owner resolution
  assert.ok(/requesting_user/.test(fnBody), 'requesting-user branch');
  assert.ok(/deal_owner/.test(fnBody), 'deal-owner branch');
  assert.ok(/system_fallback/.test(fnBody), 'system fallback branch');
  assert.ok(/Deals\/\$\{dealId\}\?fields=Owner/.test(fnBody), 'parent Deal Owner fetch');
  const userIdx = fnBody.indexOf('requesting_user');
  const dealIdx = fnBody.indexOf("'deal_owner'");
  const sysIdx = fnBody.indexOf("'system_fallback'");
  assert.ok(userIdx < dealIdx && dealIdx < sysIdx, 'resolution order user → deal → system');
});
t('roster fallback ids are NOT accepted as the requesting user', () => {
  const fnStart = rawSrc.indexOf('async function createFollowUpTaskForDeal');
  const fnBody = rawSrc.slice(fnStart, fnStart + 8000); // widened 2026-07-21: dedupe preamble precedes owner resolution
  assert.ok(/_source === 'd1' \|\| _octx\._source === 'seed'/.test(fnBody));
});
t('zoho_create_record default-Owner injection covers Tasks', () => {
  assert.ok(/module_name === 'Accounts' \|\| module_name === 'Deals' \|\| module_name === 'Tasks'\) && !recordData\.Owner/.test(rawSrc));
});

console.log('\nR4v2 — EOM matching date defaults + month-end/fiscal confirmation');
console.log('────────────────────────────────────────────────────────────────');

t('defaultQuoteDealDate: end of month, UTC (fiscal-capped suggestion)', () => {
  const r = defaultQuoteDealDate(new Date(Date.UTC(2026, 6, 15)));
  assert.strictEqual(r.date, '2026-07-31');
  // July 2026: EOM sits past the FY26 Q4 end (2026-07-25) → confirm + cap.
  assert.strictEqual(r.suggested, '2026-07-25');
  assert.strictEqual(r.needsConfirmation, true);
  const aug = defaultQuoteDealDate(new Date(Date.UTC(2026, 7, 10)));
  assert.strictEqual(aug.date, '2026-08-31');
  assert.strictEqual(aug.needsConfirmation, false);
});
t('month-end window: last 7 days of the month need confirmation', () => {
  assert.strictEqual(defaultQuoteDealDate(new Date(Date.UTC(2026, 7, 24))).needsConfirmation, false); // Aug 24: 7 days left
  assert.strictEqual(defaultQuoteDealDate(new Date(Date.UTC(2026, 7, 25))).needsConfirmation, true);  // Aug 25: 6 days left
  assert.strictEqual(defaultQuoteDealDate(new Date(Date.UTC(2026, 7, 31))).needsConfirmation, true);  // Aug 31: month end
});
t('month-end window respects February + leap years', () => {
  assert.strictEqual(defaultQuoteDealDate(new Date(Date.UTC(2026, 1, 22))).needsConfirmation, true);  // 2026-02-22: 6 days left
  assert.strictEqual(defaultQuoteDealDate(new Date(Date.UTC(2028, 1, 22))).needsConfirmation, false); // 2028-02-22 (leap): 7 days left
});
await ta('validateCrmWrite corrects a past Closing_Date to +14d (or asks in the window)', async () => {
  // Deal_Name must be a realistic name — the 2026-07-21 placeholder gate
  // rejects sub-2-char / template names on create.
  const data = { Deal_Name: 'Acme Corp - 3x MX75', Stage: 'Qualification', Lead_Source: 'Stratus Referal', Owner: { id: '1' }, Closing_Date: '2020-01-01', Account_Name: { id: '2' } };
  const res = await validateCrmWrite('Deals', data, true, null);
  const dd = defaultQuoteDealDate();
  if (dd.needsConfirmation) {
    assert.ok(!res.valid && /closing_date_needs_confirmation/.test(res.error));
  } else {
    assert.ok(res.valid, res.error);
    assert.strictEqual(data.Closing_Date, dd.suggested);
  }
});
await ta('validateCrmWrite corrects a past Valid_Till to +14d (or asks in the window)', async () => {
  const data = { Subject: 'Acme Corp - 3x MX75', Deal_Name: { id: '1' }, Valid_Till: '2020-01-01' };
  const res = await validateCrmWrite('Quotes', data, true, null);
  const dd = defaultQuoteDealDate();
  if (dd.needsConfirmation) {
    assert.ok(!res.valid && /valid_till_needs_confirmation/.test(res.error));
  } else {
    assert.strictEqual(data.Valid_Till, dd.suggested);
  }
});
t('create_deal_and_quote: closing_date param + month-end gate + deal matching (static evidence)', () => {
  assert.ok(/closing_date_needs_confirmation/.test(rawSrc));
  assert.ok(/toolInput\.closing_date/.test(rawSrc));
  assert.ok(/existingDealData\?\.Closing_Date/.test(rawSrc));
  assert.ok(/const validTill = closingDate;/.test(rawSrc), 'Valid_Till always matches Closing_Date');
});
t('prompt templates: EOM default + fiscal cap, no +14/+30 anywhere, DATE RULE present', () => {
  assert.ok(/END OF THE CURRENT MONTH/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(!/today \+ 14 days/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(!/today \+ 30 days/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/DATE RULE \(Chris, 2026-07-21\)/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/within 7 days of the end of the month/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/Cisco fiscal quarter/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});
t('server: no remaining 30-day Closing_Date/Valid_Till defaults', () => {
  assert.ok(!/30 \* 86400000\).toISOString\(\).split\('T'\)\[0\]/.test(rawSrc.replace(/taskDueDate[^]*?dueDateStr/g, '')));
});

console.log('\nR5 — MX license tier never defaults ENT');
console.log('────────────────────────────────────────────────────────────────');

t('prompt: MX/C81xx tier rule — assume SEC, state it, offer ENT/SDW', () => {
  assert.ok(/NEVER default to ENT/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/assume \*\*SEC\*\*/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/offer ENT and SDW/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});
t('benchmark fixture task_79 covers the MX-tier default', () => {
  const f = BENCHMARK_TASKS.find(x => x.id === 'task_79');
  assert.ok(f && /MX84 licenses/.test(f.prompt));
});

console.log('\nR8a — EOL replacement is default CRM-agent behavior');
console.log('────────────────────────────────────────────────────────────────');

t('checkEol returns a replacement for a known EOL model', () => {
  // MS220-8P is a canonical EOL switch; any truthy replacement is acceptable —
  // the catalog map is data, this asserts the plumbing.
  const r = checkEol('MS220-8P');
  assert.ok(r, 'expected an EOL replacement for MS220-8P');
});
t('batch_product_lookup wires eol/replaced_by/eol_note in BOTH paths (static evidence)', () => {
  const count = (rawSrc.match(/eol_note = `\$\{rawSku\} is END-OF-LIFE/g) || []).length;
  assert.strictEqual(count, 2, `expected 2 wiring sites (cache + API), found ${count}`);
});
t('prompt: EOL upgrade mapping is default behavior', () => {
  assert.ok(/EOL \/ UPGRADE MAPPING IS DEFAULT BEHAVIOR/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/quote the returned replacement by default/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});

console.log('\nR2 — FedRAMP license conversion (fixed 35% off list)');
console.log('────────────────────────────────────────────────────────────────');

t('FEDRAMP_DEFAULT_DISCOUNT is the decided fixed 35%', () => {
  assert.strictEqual(FEDRAMP_DEFAULT_DISCOUNT, 0.35);
});
t('fedrampCandidateSkus: LIC→FED with Y↔YR suffix twins (live catalog is inconsistent)', () => {
  assert.deepStrictEqual(fedrampCandidateSkus('LIC-ENT-3YR'), ['FED-ENT-3YR', 'FED-ENT-3Y']);
  assert.deepStrictEqual(fedrampCandidateSkus('LIC-MX85-SEC-1Y'), ['FED-MX85-SEC-1Y', 'FED-MX85-SEC-1YR']);
  assert.deepStrictEqual(fedrampCandidateSkus('LIC-MS150-24-3YR'), ['FED-MS150-24-3YR', 'FED-MS150-24-3Y']);
  assert.deepStrictEqual(fedrampCandidateSkus('lic-ms120-48-5yr'), ['FED-MS120-48-5YR', 'FED-MS120-48-5Y']);
  // 10Y co-term (two-digit term) keeps both spellings too
  assert.deepStrictEqual(fedrampCandidateSkus('LIC-C8121-SEC-10Y'), ['FED-C8121-SEC-10Y', 'FED-C8121-SEC-10YR']);
});
t('fedrampCandidateSkus: hardware and already-FED SKUs yield no candidates', () => {
  assert.deepStrictEqual(fedrampCandidateSkus('MX85-HW'), []);
  assert.deepStrictEqual(fedrampCandidateSkus('FED-ENT-3Y'), []);
  assert.deepStrictEqual(fedrampCandidateSkus(''), []);
});
t('classifier: fedramp/government license asks → crm_write', () => {
  for (const s of ['convert this quote to fedramp licenses', 'convert to FedRAMP', 'make these government licenses',
    'switch the licenses to fed-ramp']) {
    assert.strictEqual(classifyCrmIntent(s).class, 'crm_write', `"${s}"`);
  }
});
t('tool is registered: schema + crm_write/general subsets + executor + dry-run mocks', () => {
  const tool = CRM_EMAIL_TOOLS.find(x => x.name === 'convert_quote_licenses_fedramp');
  assert.ok(tool, 'tool schema present');
  assert.ok(/35% off the FED list price/.test(tool.description), 'description states fixed 35%');
  assert.ok(TOOL_SUBSETS.crm_write.includes('convert_quote_licenses_fedramp'), 'in crm_write subset');
  assert.ok(TOOL_SUBSETS.general.includes('convert_quote_licenses_fedramp'), 'in general subset');
  assert.ok(/case 'convert_quote_licenses_fedramp':/.test(rawSrc), 'executor case wired');
  const mocks = (rawSrc.match(/'convert_quote_licenses_fedramp': \{ success: true/g) || []).length;
  assert.strictEqual(mocks, 2, `expected 2 dry-run mock sites, found ${mocks}`);
});
t('atomic fail-closed implementation markers', () => {
  const fnStart = rawSrc.indexOf('async function convertQuoteLicensesFedramp');
  assert.ok(fnStart > -1, 'function exists');
  const body = rawSrc.slice(fnStart, fnStart + 12000);
  assert.ok(/unmapped_licenses/.test(body), 'fail-closed unmapped error');
  assert.ok(/Do_Not_Auto_Update_Prices: true/.test(body), 'price-lock on the PUT');
  assert.ok(/resolveTargetLicenseEconomics/.test(body), 'live economics resolution');
  assert.ok(/verification\.success = mismatches\.length === 0/.test(body), 'verification gate');
});
t('generic write path enforces the 35% FED discount (double-enforcement)', () => {
  const fnStart = rawSrc.indexOf('async function correctQuotedItemDiscounts');
  const body = rawSrc.slice(fnStart, fnStart + 6000);
  assert.ok(/isFedRamp = liveSku && \/\^FED-\/\.test\(liveSku\)/.test(body));
  assert.ok(/isFedRamp.*FEDRAMP_DEFAULT_DISCOUNT|if \(isFedRamp\)/.test(body));
});
t('prompt documents the conversion tool + fixed 35%', () => {
  assert.ok(/FedRAMP \/ Government License Conversion/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
  assert.ok(/FIXED 35% off the FED list price/.test(CRM_AGENT_SYSTEM_PROMPT_BASE));
});

console.log('\n────────────────────────────────────────────────────────────────');
console.log(`Total: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

})();
