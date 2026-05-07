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
  normalizeV2ClassifierForRouting
};`;
  const tmp = path.join(os.tmpdir(), `stratus-llama-routing-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const {
  buildClassifierClarifyReply,
  normalizeV2ClassifierForRouting,
} = buildShim();

let pass = 0, fail = 0;
function check(desc, cond, diag) {
  if (cond) { console.log(`PASS ${desc}`); pass++; }
  else { console.log(`FAIL ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
}

{
  const v2 = { intent: 'quote', confidence: 1, reply: '', items: [], modifiers: {} };
  const normalized = normalizeV2ClassifierForRouting(v2, 'quote me some switches', false);
  check('empty quote + generic switch request becomes clarify',
    normalized.intent === 'clarify' && /switch model/i.test(normalized.reply),
    JSON.stringify(normalized));
  check('generic switch clarify is deterministic',
    normalized._deterministicRouting === 'clarify-known-empty-or-ambiguous',
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
