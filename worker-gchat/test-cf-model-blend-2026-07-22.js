// Tests for the 2026-07-22 CF model-blend wiring: CF_MODEL_PRICING /
// estimateCfCostUsd (closes the CF-cost-blindness gap) and the two new
// getReasoningControl branches (Nemotron verified-safe disable, Qwen3
// deliberately left unsupported — its disable knob breaks tool_calls).
//
// Run: node test-cf-model-blend-2026-07-22.js

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
  src += `\nmodule.exports = { CF_MODEL_PRICING, estimateCfCostUsd, getReasoningControl, BENCHMARK_MODELS };`;
  const tmp = path.join(os.tmpdir(), `stratus-cf-blend-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { CF_MODEL_PRICING, estimateCfCostUsd, getReasoningControl, BENCHMARK_MODELS } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

const SIX = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/moonshotai/kimi-k2.7-code',
  '@cf/zai-org/glm-5.2',
  '@cf/qwen/qwen3-30b-a3b-fp8',
  '@cf/google/gemma-4-26b-a4b-it',
  '@cf/nvidia/nemotron-3-120b-a12b',
];

console.log('── CF_MODEL_PRICING: all 6 blend models present with official rates ──');
for (const id of SIX) {
  t(`${id} has a pricing entry`, () => assert.ok(CF_MODEL_PRICING[id], `missing entry for ${id}`));
}
t('kimi-k2.7-code input = $0.95/M', () => assert.strictEqual(CF_MODEL_PRICING['@cf/moonshotai/kimi-k2.7-code'].input, 0.950));
t('kimi-k2.7-code output = $4.00/M', () => assert.strictEqual(CF_MODEL_PRICING['@cf/moonshotai/kimi-k2.7-code'].output, 4.000));
t('glm-5.2 output = $4.40/M (priciest of the six)', () => assert.strictEqual(CF_MODEL_PRICING['@cf/zai-org/glm-5.2'].output, 4.400));
t('qwen3-30b-a3b-fp8 output = $0.335/M (cheapest of the six)', () => assert.strictEqual(CF_MODEL_PRICING['@cf/qwen/qwen3-30b-a3b-fp8'].output, 0.335));

console.log('── estimateCfCostUsd: computes real $, never NaN/throws on bad input ──');
t('llama-4-scout 1M in + 1M out = $1.12', () => {
  const c = estimateCfCostUsd('@cf/meta/llama-4-scout-17b-16e-instruct', 1_000_000, 1_000_000);
  assert.ok(Math.abs(c - 1.12) < 1e-9, `got ${c}`);
});
t('unknown model id → 0, not NaN/throw', () => assert.strictEqual(estimateCfCostUsd('@cf/nonexistent/model', 1000, 1000), 0));
t('missing token counts → 0, not NaN/throw', () => assert.strictEqual(estimateCfCostUsd('@cf/meta/llama-4-scout-17b-16e-instruct', undefined, undefined), 0));

console.log('── getReasoningControl: Nemotron verified-safe disable ──');
t('nemotron-3-120b-a12b → disabled, enable_thinking:false', () => {
  const rc = getReasoningControl('@cf/nvidia/nemotron-3-120b-a12b');
  assert.strictEqual(rc.reasoningDisableSupported, true);
  assert.deepStrictEqual(rc.requestOptions, { chat_template_kwargs: { enable_thinking: false } });
});

console.log('── getReasoningControl: Qwen3 deliberately left UNSUPPORTED (disable knob breaks tool_calls) ──');
t('qwen3-30b-a3b-fp8 → unsupported, no requestOptions override', () => {
  const rc = getReasoningControl('@cf/qwen/qwen3-30b-a3b-fp8');
  assert.strictEqual(rc.reasoningDisableSupported, false);
  assert.deepStrictEqual(rc.requestOptions, {});
});

console.log('── getReasoningControl: existing Kimi/GLM/Gemma branches unregressed ──');
t('kimi-k2.7-code unchanged: chat_template_kwargs.thinking=false', () => {
  const rc = getReasoningControl('@cf/moonshotai/kimi-k2.7-code');
  assert.deepStrictEqual(rc.requestOptions, { chat_template_kwargs: { thinking: false } });
});
t('glm-5.2 unchanged: chat_template_kwargs.enable_thinking=false', () => {
  const rc = getReasoningControl('@cf/zai-org/glm-5.2');
  assert.deepStrictEqual(rc.requestOptions, { chat_template_kwargs: { enable_thinking: false } });
});
t('gemma-4-26b-a4b-it unchanged: thinking:{type:disabled}', () => {
  const rc = getReasoningControl('@cf/google/gemma-4-26b-a4b-it');
  assert.deepStrictEqual(rc.requestOptions, { thinking: { type: 'disabled' } });
});

console.log('── BENCHMARK_MODELS roster: all 6 blend models still present ──');
for (const id of SIX) {
  t(`${id} in BENCHMARK_MODELS`, () => assert.ok(BENCHMARK_MODELS.some(m => m.id === id), `missing from roster`));
}

console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
