// Regression tests for Google Chat Llama routing hardening guards.

const fs = require('fs');
const path = require('path');
const os = require('os');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m,
    'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  src = src.replace(/^export class CrmWorkflow/m, 'class CrmWorkflow');
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
  normalizeClassifierForRouting
};`;
  const tmp = path.join(os.tmpdir(), `stratus-gchat-llama-routing-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const {
  buildClassifierClarifyReply,
  normalizeClassifierForRouting,
} = buildShim();

let pass = 0, fail = 0;
function check(desc, cond, diag) {
  if (cond) { console.log(`PASS ${desc}`); pass++; }
  else { console.log(`FAIL ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
}

{
  const cls = { intent: 'quote', confidence: 1, reply: '', extracted: '' };
  const normalized = normalizeClassifierForRouting(cls, 'quote me some switches', false);
  check('empty quote + generic switch request becomes clarify',
    normalized.intent === 'clarify' && /switch model/i.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const cls = { intent: 'quote', confidence: 1, reply: '', extracted: '' };
  const normalized = normalizeClassifierForRouting(cls, 'I need APs', false);
  check('empty quote + need APs becomes clarify',
    normalized.intent === 'clarify' && /AP model/i.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const cls = { intent: 'quote', confidence: 1, reply: '', extracted: 'quote 5 MS130-48' };
  const normalized = normalizeClassifierForRouting(cls, 'quote 5 MS130-48', false);
  check('ambiguous MS130-48 quote becomes clarify',
    normalized.intent === 'clarify' && /MS130-48P/.test(normalized.reply) && /MS130-48X/.test(normalized.reply),
    JSON.stringify(normalized));
}

{
  const cls = { intent: 'quote', confidence: 1, reply: '', extracted: 'quote 1 MS425-16' };
  const normalized = normalizeClassifierForRouting(cls, 'quote 1 MS425-16', false);
  check('exact MS425-16 quote is unchanged',
    normalized.intent === 'quote' && !normalized._deterministicRouting,
    JSON.stringify(normalized));
}

{
  const reply24 = buildClassifierClarifyReply('quote MS150-24', { intent: 'quote', extracted: 'quote MS150-24' });
  const reply48 = buildClassifierClarifyReply('quote MS150-48', { intent: 'quote', extracted: 'quote MS150-48' });
  check('MS150 clarify copy includes MP variants',
    /MS150-24MP-4X/.test(reply24) && /MS150-48MP-4X/.test(reply48),
    `${reply24} / ${reply48}`);
}

{
  const cls = { intent: 'revise', confidence: 1, reply: '', extracted: '' };
  const normalized = normalizeClassifierForRouting(cls, 'just show me the 5 year for 10 MR46', false);
  check('no-history revise with concrete fresh quote language becomes quote',
    normalized.intent === 'quote' && /MR46/i.test(normalized.extracted),
    JSON.stringify(normalized));
}

{
  const cls = { intent: 'revise', confidence: 1, reply: '', extracted: '' };
  const normalized = normalizeClassifierForRouting(cls, 'change that to 5 year', false);
  check('no-history true revision stays revise',
    normalized.intent === 'revise',
    JSON.stringify(normalized));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
