// Regression tests for Llama V2 routing hardening guards.
// These are post-classifier safety rails: they do not tune the model, they
// prevent known confidently-wrong shapes from falling through to Claude.

const fs = require('fs');
const path = require('path');
const os = require('os');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += `
module.exports = {
  buildClassifierClarifyReply,
  normalizeV2ClassifierForRouting,
  parseMessage,
  buildQuoteResponse
};`;
  const tmp = path.join(os.tmpdir(), `stratus-llama-routing-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const {
  buildClassifierClarifyReply,
  normalizeV2ClassifierForRouting,
  parseMessage,
  buildQuoteResponse,
} = buildShim();

let pass = 0, fail = 0;
function check(desc, cond, diag) {
  if (cond) { console.log(`PASS ${desc}`); pass++; }
  else { console.log(`FAIL ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
}

function renderQuote(text) {
  const parsed = parseMessage(text);
  return parsed && buildQuoteResponse(parsed);
}

{
  const v2 = { intent: 'quote', confidence: 1, reply: '', items: [], modifiers: {} };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote me some switches', false);
  check('empty quote + generic switch request becomes clarify',
    normalized.intent === 'clarify' && /switch model/i.test(normalized.reply),
    JSON.stringify(normalized));
  check('generic switch clarify is deterministic',
    normalized._deterministicRouting === 'deterministic-guard-empty-items',
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'quote',
    confidence: 1,
    reply: '',
    items: [{ sku: 'MS130-24', qty: 5, sku_type: 'hardware' }],
    modifiers: {}
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote 5 MS130-24', false);
  check('ambiguous MS130-24 quote becomes clarify',
    normalized.intent === 'clarify' && /MS130-24P/.test(normalized.reply) && /MS130-24X/.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const v2 = { intent: 'quote', confidence: 1, reply: '', items: [], modifiers: {} };
  const normalized = normalizeV2ClassifierForRouting(v2, 'I need switches', false);
  check('empty quote + need switches becomes clarify',
    normalized.intent === 'clarify' && /switch model/i.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const v2 = { intent: 'quote', confidence: 1, reply: '', items: [], modifiers: {} };
  const normalized = normalizeV2ClassifierForRouting(v2, 'I want access points', false);
  check('empty quote + want access points becomes clarify',
    normalized.intent === 'clarify' && /AP model/i.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'quote',
    confidence: 1,
    reply: '',
    items: [{ sku: 'MS130-48', qty: 5, sku_type: 'hardware' }],
    modifiers: {}
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote 5 MS130-48', false);
  check('ambiguous MS130-48 quote becomes clarify',
    normalized.intent === 'clarify' && /MS130-48P/.test(normalized.reply) && /MS130-48X/.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'quote',
    confidence: 1,
    reply: '',
    items: [{ sku: 'MS425-16', qty: 1, sku_type: 'hardware' }],
    modifiers: {}
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote 1 MS425-16', false);
  check('exact MS425-16 quote is unchanged',
    normalized.intent === 'quote' && !normalized._deterministicRouting,
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'quote',
    confidence: 1,
    reply: '',
    items: [],
    modifiers: {}
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote 5 LIC-MS130-24-3Y', false);
  check('valid MS130 license SKU is not treated as ambiguous stem',
    normalized.intent === 'quote' && !normalized._deterministicRouting,
    JSON.stringify(normalized));
}

{
  const out = renderQuote('quote 5 LIC-MS130-24P-3YR');
  check('invalid MS130 PoE direct license canonicalizes to port-count license',
    out && /LIC-MS130-24-3Y/.test(out.message) && !/item=LIC-MS130-24P-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS130-8P-I-3YR');
  check('MS130 compact direct license canonicalizes to CMPT license',
    out && /LIC-MS130-CMPT-3Y/.test(out.message) && !/item=LIC-MS130-8P-I-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS130-24Z-3YR');
  check('hallucinated MS130 direct license variant is blocked',
    out && /not a recognized switch license SKU/.test(out.message) && !/Order in Stratus/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote 2 LIC-MS130-48X-5Y');
  check('invalid MS130 X direct license canonicalizes to port-count license',
    out && /LIC-MS130-48-5Y/.test(out.message) && !/item=LIC-MS130-48X-5Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS150-24P-4G-3YR');
  check('invalid MS150 variant direct license canonicalizes to port-count license',
    out && /LIC-MS150-24-3Y/.test(out.message) && !/item=LIC-MS150-24P-4G-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS150-24MP-4X-3YR');
  check('MS150 24-port MP direct license canonicalizes to port-count license',
    out && /LIC-MS150-24-3Y/.test(out.message) && !/item=LIC-MS150-24MP-4X-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS150-48MP-4X-3YR');
  check('MS150 48-port MP direct license canonicalizes to port-count license',
    out && /LIC-MS150-48-3Y/.test(out.message) && !/item=LIC-MS150-48MP-4X-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS390-24UX-3YR');
  check('invalid MS390 variant direct license canonicalizes to tiered port license',
    out && /LIC-MS390-24E-3Y/.test(out.message) && !/item=LIC-MS390-24UX-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS390-24P-3YR');
  check('MS390 24-port renewal direct license canonicalizes from real non-stocked variant',
    out && /LIC-MS390-24E-3Y/.test(out.message) && !/item=LIC-MS390-24P-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS390-48P-3YR');
  check('MS390 48-port renewal direct license canonicalizes from real non-stocked variant',
    out && /LIC-MS390-48E-3Y/.test(out.message) && !/item=LIC-MS390-48P-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote 1 MS130-24P with 3 year advanced license');
  check('MS130 advanced request maps to port-count A-tier license',
    out && /LIC-MS130-24A-3Y/.test(out.message) && !/LIC-MS130-24-3Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote 1 MS150-24P-4G with 3 year advanced license');
  check('MS150 advanced request maps to port-count A-tier license',
    out && /LIC-MS150-24A-3Y/.test(out.message) && !/LIC-MS150-24-3Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote 1 MS390-24UX with 3 year advanced license');
  check('MS390 advanced request maps to A-tier port license',
    out && /LIC-MS390-24A-3Y/.test(out.message) && !/LIC-MS390-24E-3Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS130-24A-3YR');
  check('direct MS130 Advanced license normalizes suffix without downgrading tier',
    out && /LIC-MS130-24A-3Y/.test(out.message) && !/LIC-MS130-24-3Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS390-24A-3YR');
  check('direct MS390 Advanced license normalizes suffix without downgrading tier',
    out && /LIC-MS390-24A-3Y/.test(out.message) && !/LIC-MS390-24E-3Y/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS350-48X-3YR');
  check('invalid MS350 48X direct license blocks instead of canonicalizing',
    out && /couldn't quote LIC-MS350-48X-3YR/.test(out.message) && /not a recognized switch license SKU/.test(out.message) && !/Order in Stratus/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MS125-24P-3YR');
  check('MS125 direct license keeps P variant but normalizes YR to Y',
    out && /LIC-MS125-24P-3Y/.test(out.message) && !/item=LIC-MS125-24P-3YR/.test(out.message),
    out ? out.message : 'no output');
}

[
  ['LIC-MS210-48LP-3Y', 'LIC-MS210-48LP-3YR'],
  ['LIC-MS225-48FP-3Y', 'LIC-MS225-48FP-3YR'],
  ['LIC-MS250-48FP-3Y', 'LIC-MS250-48FP-3YR'],
  ['LIC-MS425-32-3Y', 'LIC-MS425-32-3YR'],
].forEach(([inputSku, expectedSku]) => {
  const out = renderQuote(`quote ${inputSku}`);
  check(`${inputSku} canonicalizes to catalog SKU ${expectedSku}`,
    out && new RegExp(expectedSku).test(out.message)
      && !out.message.includes(`item=${inputSku}&`)
      && !out.message.includes(`item=${inputSku},`),
    out ? out.message : 'no output');
});

{
  const out = renderQuote('quote LIC-MS999-24P-3YR');
  check('unknown MS direct license is blocked instead of quoted',
    out && /not a recognized switch license SKU/.test(out.message) && !/stratusinfosystems\.com\/order/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-MX67-SEC-3YR');
  check('valid MX direct license passes through untouched',
    out && /item=LIC-MX67-SEC-3YR/.test(out.message),
    out ? out.message : 'no output');
}

{
  const out = renderQuote('quote LIC-ENT-3YR');
  check('valid MR ENT direct license passes through untouched',
    out && /item=LIC-ENT-3YR/.test(out.message),
    out ? out.message : 'no output');
}

[
  'LIC-MR-ENT-3YR',
  'LIC-DUO-ESSENTIALS-3YR',
  'LIC-L-AC-APX-3Y-S1',
].forEach(sku => {
  const out = renderQuote(`quote ${sku}`);
  check(`${sku} direct license is not touched by MS canonicalizer`,
    out && new RegExp(`item=${sku}`).test(out.message),
    out ? out.message : 'no output');
});
{
  // LIC-SME is discontinued: the canonicalizer must not mangle it, and the
  // engine substitutes the replacement (Ivanti MDM) SKU.
  const out = renderQuote('quote LIC-SME-3YR');
  check('LIC-SME-3YR direct license renders the replacement, untouched by MS canonicalizer',
    out && /item=LIC-MI-EMSC-D-1YMC-A-3YR/.test(out.message) && !/item=LIC-SME/.test(out.message),
    out ? out.message : 'no output');
}

{
  const reply24 = buildClassifierClarifyReply('quote MS150-24', {
    intent: 'quote',
    items: [{ sku: 'MS150-24', qty: 1, sku_type: 'hardware' }]
  });
  const reply48 = buildClassifierClarifyReply('quote MS150-48', {
    intent: 'quote',
    items: [{ sku: 'MS150-48', qty: 1, sku_type: 'hardware' }]
  });
  check('MS150 clarify copy includes MP variants',
    /MS150-24MP-4X/.test(reply24) && /MS150-48MP-4X/.test(reply48),
    `${reply24} / ${reply48}`);
}

{
  const v2 = {
    intent: 'revise',
    confidence: 1,
    reply: '',
    items: [{ sku: 'MR46', qty: 10, sku_type: 'hardware' }],
    modifiers: { term_years: 5 },
    revision: { action: 'change_term', new_term: 5 },
    reference: { is_pronoun_ref: false, option_ref: null, resolve_from_history: true }
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'just show me the 5 year for 10 MR46', false);
  check('no-history revise with concrete fresh quote language becomes quote',
    normalized.intent === 'quote' && normalized.items[0].sku === 'MR46' && normalized.modifiers.term_years === 5,
    JSON.stringify(normalized));
  check('fresh quote rewrite gets telemetry tag',
    normalized._deterministicRouting === 'deterministic-guard-revise-to-quote',
    JSON.stringify(normalized));
  check('fresh quote rewrite clears history reference',
    normalized.reference && normalized.reference.resolve_from_history === false,
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'revise',
    confidence: 1,
    reply: '',
    items: [],
    modifiers: {},
    revision: { action: 'change_term', new_term: 5 },
    reference: { is_pronoun_ref: true, option_ref: null, resolve_from_history: true }
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'change that to 5 year', false);
  check('no-history true revision stays revise',
    normalized.intent === 'revise',
    JSON.stringify(normalized));
}

{
  const v2 = {
    intent: 'quote',
    confidence: 1,
    reply: '',
    items: [{ sku: 'MR46', qty: 10, sku_type: 'hardware' }],
    modifiers: {}
  };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote 10 MR46', false);
  check('ordinary concrete quote is unchanged',
    normalized.intent === 'quote' && !normalized._deterministicRouting,
    JSON.stringify(normalized));
}

{
  const reply = buildClassifierClarifyReply('what is the cost?', { intent: 'quote', items: [] });
  check('bare pricing question gets product clarify wording',
    /SKU or product/i.test(reply),
    String(reply));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
