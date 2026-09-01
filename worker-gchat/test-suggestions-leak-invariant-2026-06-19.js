// HARDENING (Codex Q1) — the "[[SUGGESTIONS]] rendering invariant": every
// agent-returning endpoint strips the chip block from the VISIBLE reply, so raw
// chip JSON can never leak into customer-facing text (the Round E /api/quote bug).
// extractSuggestionsBlock is the chokepoint both /api/quote and /api/chat-waterfall
// run their agent replies through; this guards it directly, plus confirms the
// deterministic synthesizer never re-introduces the marker.
//
// Run: node worker-gchat/test-suggestions-leak-invariant-2026-06-19.js

const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');

function load() {
  const here = path.join(__dirname);
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
  src = src.replace(/^export default /m, 'module.exports.__worker = ');
  src += `\nmodule.exports.extractSuggestionsBlock = extractSuggestionsBlock;`;
  src += `\nmodule.exports.synthesizeSuggestionsFromReply = synthesizeSuggestionsFromReply;`;
  const tmp = path.join(os.tmpdir(), `sugleak-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const { extractSuggestionsBlock, synthesizeSuggestionsFromReply } = load();
const LEAK = /\[\[\/?SUGGESTIONS\]\]/; // the marker must NEVER survive into a visible reply

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); console.log(`  ✅ ${name}`); pass++; } catch (e) { console.log(`  ❌ ${name}\n     ${e.message}`); fail++; } }

(async () => {
  console.log('── INVARIANT: extractSuggestionsBlock leaves NO marker in the visible reply ──');

  t('valid block is stripped + parsed', () => {
    const raw = 'Pick a config.\n\n[[SUGGESTIONS]]{"groups":[{"label":"PoE","options":[{"label":"PoE+","send":"C9200L-48P-4X-M"}]}]}[[/SUGGESTIONS]]';
    const { reply, suggestions } = extractSuggestionsBlock(raw);
    assert.ok(!LEAK.test(reply), 'marker leaked into reply: ' + reply);
    assert.ok(!/"groups"|"options"|"send"/.test(reply), 'raw chip JSON leaked');
    assert.ok(suggestions && suggestions.groups && suggestions.groups.length === 1, 'chips parsed');
    assert.strictEqual(reply.trim(), 'Pick a config.');
  });

  t('malformed JSON block is still stripped (no leak), suggestions null', () => {
    const raw = 'Which one?\n[[SUGGESTIONS]]{ this is : not json , }[[/SUGGESTIONS]]';
    const { reply, suggestions } = extractSuggestionsBlock(raw);
    assert.ok(!LEAK.test(reply), 'marker leaked on malformed JSON: ' + reply);
    assert.strictEqual(suggestions, null);
  });

  t('block mid-text: surrounding prose preserved, marker gone', () => {
    const raw = 'Intro line.\n[[SUGGESTIONS]]{"groups":[{"label":"x","options":[{"label":"a","send":"a"}]}]}[[/SUGGESTIONS]]\nOutro line.';
    const { reply } = extractSuggestionsBlock(raw);
    assert.ok(!LEAK.test(reply), 'marker leaked: ' + reply);
    assert.ok(/Intro line/.test(reply) && /Outro line/.test(reply), 'prose dropped');
  });

  t('no block → reply unchanged, no false marker', () => {
    const raw = 'Just a normal answer with no chips.';
    const { reply, suggestions } = extractSuggestionsBlock(raw);
    assert.strictEqual(reply, raw);
    assert.strictEqual(suggestions, null);
    assert.ok(!LEAK.test(reply));
  });

  t('options-only shape ({label,options}) also stripped', () => {
    const raw = 'Choose:\n[[SUGGESTIONS]]{"label":"Term","options":[{"label":"3yr","send":"3 year"}]}[[/SUGGESTIONS]]';
    const { reply, suggestions } = extractSuggestionsBlock(raw);
    assert.ok(!LEAK.test(reply), 'marker leaked: ' + reply);
    assert.ok(suggestions && suggestions.groups.length === 1, 'normalized to groups');
  });

  t('non-string input is safe', () => {
    const { reply, suggestions } = extractSuggestionsBlock(null);
    assert.strictEqual(reply, null);
    assert.strictEqual(suggestions, null);
  });

  console.log('── INVARIANT: synthesizeSuggestionsFromReply never emits the marker ──');

  t('synth returns chips object or null — never a string with the marker', () => {
    const cases = [
      '**PoE class** — PoE+, PoE-lite, or multigig UPOE?',
      'Just prose, no question here.',
      'See https://stratusinfosystems.com/order/?item=MR44 — create it?',
    ];
    for (const c of cases) {
      const out = synthesizeSuggestionsFromReply(c);
      assert.ok(out === null || (out && Array.isArray(out.groups)), 'unexpected shape for: ' + c);
      assert.ok(!LEAK.test(JSON.stringify(out || '')), 'synth produced a marker');
    }
  });

  console.log(`\n${fail === 0 ? '✅ ALL PASS' : '❌ FAIL'} — ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
