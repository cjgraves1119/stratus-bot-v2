// Unit tests for scrubMarginFromQuotedItems (PR 3 — post-QA hardening).
// Permanent rule (2026-05-22): Stratus margin must never reach a customer-
// facing Quote line Description. The scrubber strips ONLY margin wording and
// preserves discount labels + subscription add-on / change descriptions.
// Run: node test-margin-scrub-2026-05-22.js

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

// Build a Node-loadable shim of the worker module exporting the scrubber.
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
  src += `\nmodule.exports = { scrubMarginFromQuotedItems };`;
  const tmp = path.join(os.tmpdir(), `stratus-margin-scrub-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { scrubMarginFromQuotedItems } = buildShim();

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ✅ ${name}`); pass++; }
  catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; }
}
// Run the scrubber on one line and return the resulting Description (or the
// sentinel '<<deleted>>' when the field was removed entirely).
function scrubOne(description) {
  const item = { id: 'x', Description: description };
  scrubMarginFromQuotedItems([item], 'test');
  return ('Description' in item) ? item.Description : '<<deleted>>';
}

console.log('── scrubMarginFromQuotedItems (PR 3) ──');

// Legitimate customer text — must be left exactly as-is.
t('keeps a discount label', () => assert.strictEqual(scrubOne('15% Discount'), '15% Discount'));
t('keeps a subscription add-on description', () => assert.strictEqual(scrubOne('5-Year Subscription Add-on'), '5-Year Subscription Add-on'));
t('keeps a change description', () => assert.strictEqual(scrubOne('3YR to 5YR license change'), '3YR to 5YR license change'));
t('keeps hyphenated words intact (no spaced-dash split)', () => assert.strictEqual(scrubOne('Co-Term Add-on'), 'Co-Term Add-on'));
t('"Marginal" is not treated as margin', () => assert.strictEqual(scrubOne('Marginal lead-time note'), 'Marginal lead-time note'));

// Margin text — must be stripped.
t('deletes a pure margin Description', () => assert.strictEqual(scrubOne('20% Margin'), '<<deleted>>'));
t('deletes a "Stratus Margin" Description', () => assert.strictEqual(scrubOne('Stratus Margin 22%'), '<<deleted>>'));
t('strips the margin segment, keeps the rest', () => assert.strictEqual(scrubOne('5-Year Subscription Add-on — 20% Margin'), '5-Year Subscription Add-on'));
t('strips a leading margin segment', () => assert.strictEqual(scrubOne('Margin: 18%, License Renewal'), 'License Renewal'));
t('keeps the discount segment, drops the margin segment', () => assert.strictEqual(scrubOne('20% Margin, 15% Discount'), '15% Discount'));
t('strips a parenthetical margin, keeps the rest', () => assert.strictEqual(scrubOne('5-Year Subscription Add-on (20% Margin)'), '5-Year Subscription Add-on'));
t('strips a parenthetical margin after a discount label', () => assert.strictEqual(scrubOne('15% Discount (20% Margin)'), '15% Discount'));
t('deletes a Description that is only a parenthetical margin', () => assert.strictEqual(scrubOne('(Stratus Margin 22%)'), '<<deleted>>'));

// Shape / edge cases.
t('no Description field — no-op', () => {
  const item = { id: 'x', Quantity: 2 };
  scrubMarginFromQuotedItems([item], 'test');
  assert.deepStrictEqual(item, { id: 'x', Quantity: 2 });
});
t('delete marker is untouched', () => {
  const item = { id: 'x', _delete: null };
  scrubMarginFromQuotedItems([item], 'test');
  assert.deepStrictEqual(item, { id: 'x', _delete: null });
});
t('non-array input — no throw', () => {
  assert.doesNotThrow(() => scrubMarginFromQuotedItems(null));
  assert.doesNotThrow(() => scrubMarginFromQuotedItems(undefined));
});
t('reports scrubbed count', () => {
  const items = [{ Description: '20% Margin' }, { Description: '15% Discount' }, { Description: 'Co-Term' }];
  assert.strictEqual(scrubMarginFromQuotedItems(items, 'test').scrubbed, 1);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
