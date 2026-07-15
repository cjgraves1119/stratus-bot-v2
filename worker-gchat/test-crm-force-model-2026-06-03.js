// Tests for the 2026-06-03 §7 model-strategy change: the reversible
// CRM_AGENT_FORCE_MODEL flag + resolveForcedCrmModel() + Opus 4.8 pricing.
//
// What this verifies:
//   1. resolveForcedCrmModel() maps aliases (opus/sonnet/haiku), accepts full
//      claude-* ids verbatim, treats off/''/false/undefined as "no override"
//      (null), and rejects non-claude garbage.
//   2. MODEL_PRICING carries claude-opus-4-8 at the corrected $5/$25 rate.
//   3. Both model-selection sites (askClaude main loop + askClaudeContinue)
//      gate on a forced model BEFORE the Haiku-dispatch swap (source check).
//
// Run: node test-crm-force-model-2026-06-03.js

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
  src += `\nmodule.exports = { resolveForcedCrmModel, MODEL_PRICING };`;
  const tmp = path.join(os.tmpdir(), `stratus-force-model-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { resolveForcedCrmModel, MODEL_PRICING } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('── resolveForcedCrmModel: aliases + passthrough ──');
t('opus → claude-opus-4-8', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'opus' }), 'claude-opus-4-8'));
t('sonnet → claude-sonnet-4-6', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'sonnet' }), 'claude-sonnet-4-6'));
t('haiku → claude-haiku-4-5-20251001', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'haiku' }), 'claude-haiku-4-5-20251001'));
t('case-insensitive (OPUS)', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'OPUS' }), 'claude-opus-4-8'));
t('full claude-* id passthrough', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'claude-opus-4-8' }), 'claude-opus-4-8'));

console.log('── resolveForcedCrmModel: "no override" cases return null ──');
t('off → null', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'off' }), null));
t('false → null', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'false' }), null));
t('empty string → null', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: '' }), null));
t('undefined env key → null', () => assert.strictEqual(resolveForcedCrmModel({}), null));
t('missing env → null', () => assert.strictEqual(resolveForcedCrmModel(undefined), null));
t('non-claude garbage → null (safety)', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: 'gpt-4o' }), null));
t('whitespace trimmed', () => assert.strictEqual(resolveForcedCrmModel({ CRM_AGENT_FORCE_MODEL: '  opus  ' }), 'claude-opus-4-8'));

console.log('── MODEL_PRICING: Opus 4.8 corrected rate ──');
t('claude-opus-4-8 present', () => assert.ok(MODEL_PRICING['claude-opus-4-8']));
t('opus-4-8 input = $5/M', () => assert.strictEqual(MODEL_PRICING['claude-opus-4-8'].input, 5.00));
t('opus-4-8 output = $25/M', () => assert.strictEqual(MODEL_PRICING['claude-opus-4-8'].output, 25.00));

console.log('── source: forced model gates BEFORE Haiku dispatch (both loops) ──');
const srcText = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
t('main loop: _forcedCrmModel used in activeModel', () => assert.ok(/const activeModel = _forcedCrmModel\s*\n\s*\|\|/.test(srcText)));
t('continuation: _forcedCrmModelCont used in contModel', () => assert.ok(/const contModel = _forcedCrmModelCont\s*\n\s*\|\|/.test(srcText)));

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
