// CRM-context persistence after compound creates — SEDA postmortem (2026-06-09):
// create_deal_and_quote's nested result {records:{account,deal,quote:{verification}}}
// matched NONE of the flat extractor markers (the "Quote_Number" branch fired but read
// top-level rec.id, which is absent), so crm_context was silently dropped after every
// compound create. The next turn ("add the switches too") started blind and re-asked
// SKUs/qty/term the user had already confirmed — twice in the live transcript.
//
// Drives the REAL extractCrmContextFromMessages with synthetic tool_use/tool_result
// message pairs. Run: node worker-gchat/test-crm-context-persistence-2026-06-09.js

const fs = require('fs'), path = require('path'), os = require('os');

function loadEngine() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${esc('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${esc('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${esc('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${esc('src/data/accessories.json')}');`);
  src = src.replace(/^import voiceSkillData from '\.\/email-reply-voice-skill\.json';?$/m, `const voiceSkillData = require('${esc('src/email-reply-voice-skill.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
  src = src.replace(/^export class QuotePoWorkflow/m, 'class QuotePoWorkflow');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { extractCrmContextFromMessages };`;
  const tmp = path.join(os.tmpdir(), `crmctx-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { extractCrmContextFromMessages } = loadEngine();
const env = {}; // DID-sync write-back is fire-and-forget and not exercised here

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; console.log('  ✅ ' + msg); } else { fail++; console.log('  ❌ ' + msg); } };

// Build a tool_use + tool_result message pair the way askClaude's loop does.
const turn = (toolName, toolInput, result, truncateAt = null) => {
  let raw = typeof result === 'string' ? result : JSON.stringify(result);
  if (truncateAt && raw.length > truncateAt) raw = raw.substring(0, truncateAt) + '...(truncated)';
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'tu_1', name: toolName, input: toolInput }] },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: raw }] },
  ];
};

// Realistic create_deal_and_quote success shape (SEDA scenario, correct 3-line BOM at qty 2)
const SEDA_RESULT = {
  success: true,
  steps: ['Account resolved', 'Deal created', 'Quote created', 'Verified: 3 items, Grand Total: $11130.54'],
  errors: [],
  records: {
    account: { id: '2570562000000334455', name: 'SEDA North America', url: 'https://crm.zoho.com/crm/org647122552/tab/Accounts/2570562000000334455' },
    deal: { id: '2570562000410596025', name: 'SEDA North America - C9200L-24T-4G-M', url: 'https://crm.zoho.com/crm/org647122552/tab/Deals/2570562000410596025' },
    quote: {
      id: '2570562000410500034',
      url: 'https://crm.zoho.com/crm/org647122552/tab/Quotes/2570562000410500034',
      quote_number: '2570562000410500036',
      verification: {
        Quote_Number: '2570562000410500036',
        Grand_Total: 11130.54, Sub_Total: 11130.54, Quote_Stage: 'Draft', Cisco_Billing_Term: null,
        item_count: 3,
        items: [
          { product: 'Catalyst 9200L 24-port data, 4x1G uplink (Meraki)', qty: 2, unit_price: 1106, total: 2212, id: 'li_1', sku: 'C9200L-24T-4G-M', product_id: 'p_1' },
          { product: '125W AC Config 5 Power Supply (Meraki)', qty: 2, unit_price: 1309, total: 2618, id: 'li_2', sku: 'PWR-C5-125WAC-M', product_id: 'p_2' },
          { product: 'C9200L Meraki Essentials 24-port 3 Year', qty: 2, unit_price: 832.14, total: 1664.28, id: 'li_3', sku: 'LIC-C9200L-24E-3Y', product_id: 'p_3' },
        ],
      },
    },
  },
  _user_visible_summary: 'Created Deal + Quote for SEDA North America',
};

(async () => {
  console.log('Compound-create context extraction (the SEDA fix)');

  let ctx = extractCrmContextFromMessages(turn('create_deal_and_quote', { account_name: 'SEDA North America' }, SEDA_RESULT), env);
  ok(ctx.quote_id === '2570562000410500034', 'create_deal_and_quote → quote_id captured');
  ok(ctx.quote_number === '2570562000410500036', '→ quote_number captured');
  ok(ctx.deal_id === '2570562000410596025', '→ deal_id captured');
  ok(ctx.account_id === '2570562000000334455' && ctx.account_name === 'SEDA North America', '→ account id+name captured');
  ok(Array.isArray(ctx.line_items) && ctx.line_items.length === 3, '→ all 3 line items captured');
  ok(ctx.line_items && ctx.line_items[1] && ctx.line_items[1].sku === 'PWR-C5-125WAC-M' && ctx.line_items[1].qty === 2 && ctx.line_items[1].id === 'li_2' && ctx.line_items[1].product_id === 'p_2',
    '→ line item carries {id, sku, qty, product_id} (modify-after-create no longer blind)');

  ctx = extractCrmContextFromMessages(turn('create_quote_on_deal', { deal_id: 'd1' }, SEDA_RESULT), env);
  ok(ctx.quote_id === '2570562000410500034' && ctx.line_items?.length === 3, 'create_quote_on_deal → same extraction');

  console.log('Failure + truncation safety');
  const failResult = { success: false, error: 'quote_create_verify_failed', records: { account: { id: 'a1', name: 'X' } }, errors: ['verify failed'] };
  ctx = extractCrmContextFromMessages(turn('create_deal_and_quote', {}, failResult), env);
  ok(!ctx.quote_id, 'success:false result → NO quote_id saved (failed create never looks resumable)');

  ctx = extractCrmContextFromMessages(turn('create_deal_and_quote', {}, SEDA_RESULT, 2000), env);
  ok(typeof ctx === 'object', 'truncated-at-2000 result → no throw (graceful)');
  // With the truncLimit raised to 8000 for compound creates, the real path never cuts this result:
  ok(JSON.stringify(SEDA_RESULT).length < 8000, 'realistic compound result fits the raised 8000-char limit');

  console.log('Existing extractor branches unaffected');
  const getRecordResult = { data: [{ id: 'q9', Quote_Number: 'QN-9', Account_Name: { name: 'Acme', id: 'a9' }, Deal_Name: { id: 'd9' }, Quoted_Items: [{ id: 'li9', Product_Code: 'MR44-HW', Quantity: 5, Product_Name: { id: 'p9', name: 'MR44' } }] }] };
  ctx = extractCrmContextFromMessages(turn('zoho_get_record', { module_name: 'Quotes', record_id: 'q9' }, getRecordResult), env);
  ok(ctx.quote_id === 'q9' && ctx.line_items?.[0]?.sku === 'MR44-HW', 'zoho_get_record Quotes branch still extracts');

  const cloneResult = { success: true, cloned_quote_id: 'qc1', cloned_quote_number: 'QN-C1', facts: { line_items: [{ id: 'lic1', product_code: 'MX67-HW', quantity: 2, product_id: 'pc1' }] } };
  ctx = extractCrmContextFromMessages(turn('clone_quote', { quote_id: 'q0' }, cloneResult), env);
  ok(ctx.quote_id === 'qc1' && ctx.line_items?.[0]?.sku === 'MX67-HW', 'clone_quote branch still extracts');

  const createRecResult = { data: [{ status: 'success', details: { id: 'newq1' }, message: 'record added' }] };
  ctx = extractCrmContextFromMessages(turn('zoho_create_record', { module_name: 'Quotes' }, createRecResult), env);
  ok(ctx.quote_id === 'newq1', 'zoho_create_record "record added" branch still extracts');

  console.log('Compaction hole (codex round 1: same-turn later tool compacted the create result)');
  // A compacted block is unparseable — proves the incremental accumulator is load-bearing.
  const compactedPair = turn('create_deal_and_quote', {}, SEDA_RESULT);
  compactedPair[1].content[0].content = compactedPair[1].content[0].content.substring(0, 300) + '...(compacted)';
  ctx = extractCrmContextFromMessages(compactedPair, env);
  ok(!ctx.quote_id && !ctx.line_items, 'compacted-to-300 create result → extractor gets nothing (why incremental capture exists)');

  // Source-level revert guards for the changes a behavioral test cannot reach
  // (truncation sites + incremental wiring live inside askClaude's loop).
  console.log('Source revert-guards');
  const src = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  const truncSites = (src.match(/isCompoundCreate\) \? 8000 : 2000|isCompoundCreate\s*\)\s*\?\s*8000/g) || []).length
    + (src.match(/isQuoteData \|\| isCompoundCreate\) \? 8000/g) || []).length;
  ok(/const isCompoundCreate = \['create_deal_and_quote', 'create_quote_on_deal'\]\.includes\(block\.name\);/.test(src)
     && (src.match(/isCompoundCreate/g) || []).length >= 4,
    'both truncation sites exempt compound creates from the 2000-char cut');
  ok(/id: item\.id \|\| null,\s*\n\s*sku: item\.Product_Code \|\| item\.Product_Name\?\.Product_Code \|\| null,\s*\n\s*product_id: item\.Product_Name\?\.id \|\| item\.product\?\.id \|\| null/.test(src),
    'verification.items carries id/sku/product_id (extractor schema source)');
  const pushIdx = src.indexOf("messages.push({ role: 'user', content: toolResults });");
  const incIdx = src.indexOf('Object.assign(_turnCrmCtx, extractCrmContextFromMessages(messages.slice(-2), env));');
  const compactIdx = src.indexOf('...(compacted)');
  ok(pushIdx > -1 && incIdx > pushIdx && compactIdx > -1 && incIdx < src.indexOf('Message compaction: when conversation grows beyond 4 messages'),
    'incremental capture wired AFTER the tool_result push and BEFORE compaction');
  ok(/const crmCtx = _turnCrmCtx;/.test(src),
    'final save persists the pre-compaction accumulator (not a lossy re-scan)');

  console.log('');
  console.log(fail === 0 ? `✅ ${pass}/${pass + fail} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
  process.exit(fail === 0 ? 0 : 1);
})();
