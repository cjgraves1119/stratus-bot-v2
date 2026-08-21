// Offline unit test for the 7YR/10YR co-term re-term logic (2026-07-14).
// Covers the PURE parts only: retermTargetLicenseSku() SKU rewrite (bidirectional
// across 1/3/5/7/10) and the COTERM_DEFAULT_DISCOUNT constant. The live-Zoho target
// economics resolver (resolveTargetLicenseEconomics) needs a real Zoho call and is
// verified against a live quote at deploy time, not here.
//
// Run: node worker-gchat/test-reterm-coterm-2026-07-14.js

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
  src += `\nmodule.exports = { retermTargetLicenseSku, COTERM_DEFAULT_DISCOUNT, RETERM_ALLOWED_TERMS };`;
  const tmp = path.join(os.tmpdir(), `stratus-reterm-coterm-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { retermTargetLicenseSku, COTERM_DEFAULT_DISCOUNT, RETERM_ALLOWED_TERMS } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}

console.log('── retermTargetLicenseSku: apply co-term (3YR → 7/10) ──');
t('LIC-ENT-3YR → 7 = LIC-ENT-7YR', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-3YR', 7), 'LIC-ENT-7YR'));
t('LIC-ENT-3YR → 10 = LIC-ENT-10YR', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-3YR', 10), 'LIC-ENT-10YR'));
t('LIC-ENT-1YR → 7 = LIC-ENT-7YR', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-1YR', 7), 'LIC-ENT-7YR'));
t('preserves -Y unit: LIC-MT-3Y → 7 = LIC-MT-7Y', () => assert.strictEqual(retermTargetLicenseSku('LIC-MT-3Y', 7), 'LIC-MT-7Y'));

console.log('── retermTargetLicenseSku: revert co-term (7/10 → standard) ──');
t('LIC-ENT-7YR → 5 = LIC-ENT-5YR (revert)', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-7YR', 5), 'LIC-ENT-5YR'));
t('LIC-ENT-10YR → 3 = LIC-ENT-3YR (revert)', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-10YR', 3), 'LIC-ENT-3YR'));
t('LIC-ENT-7YR → 10 = LIC-ENT-10YR (co-term to co-term)', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-7YR', 10), 'LIC-ENT-10YR'));

console.log('── retermTargetLicenseSku: idempotent + standard + negative ──');
t('LIC-ENT-7YR → 7 = LIC-ENT-7YR (idempotent)', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-7YR', 7), 'LIC-ENT-7YR'));
t('LIC-ENT-3YR → 5 = LIC-ENT-5YR (standard path unchanged)', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-3YR', 5), 'LIC-ENT-5YR'));
t('non-license MR44-HW → 7 = null', () => assert.strictEqual(retermTargetLicenseSku('MR44-HW', 7), null));
t('non-termed LIC (no term suffix) → 7 = null', () => assert.strictEqual(retermTargetLicenseSku('LIC-DUO-ESSENTIALS', 7), null));
t('invalid term 4 → null', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-3YR', 4), null));
t('invalid term 6 → null', () => assert.strictEqual(retermTargetLicenseSku('LIC-ENT-3YR', 6), null));

console.log('── COTERM_DEFAULT_DISCOUNT: fixed term discounts ──');
t('7YR default discount = 0.50 (50%)', () => assert.strictEqual(COTERM_DEFAULT_DISCOUNT[7], 0.50));
t('10YR default discount = 0.55 (55%)', () => assert.strictEqual(COTERM_DEFAULT_DISCOUNT[10], 0.55));
t('1/3/5 have NO fixed discount (preserve source %)', () => {
  assert.strictEqual(COTERM_DEFAULT_DISCOUNT[1], undefined);
  assert.strictEqual(COTERM_DEFAULT_DISCOUNT[3], undefined);
  assert.strictEqual(COTERM_DEFAULT_DISCOUNT[5], undefined);
});
t('RETERM_ALLOWED_TERMS = [1,3,5,7,10]', () => assert.deepStrictEqual(RETERM_ALLOWED_TERMS, [1, 3, 5, 7, 10]));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
