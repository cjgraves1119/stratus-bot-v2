// SME follow-up substitution (2026-07-08): handleFollowUpModifier must never
// re-emit a discontinued LIC-SME SKU from conversation history — every branch
// (labeled-term filter, qty change, add, hw/lic-only, pricing) substitutes the
// Ivanti MDM replacement at urlToItems ingestion. Found by adversarial review
// (council round 2) after the round-1 fix only covered the term-rewrite loop.
//
// Run: node worker-gchat/test-sme-followup-substitution-2026-07-08.js
const fs = require('fs'), path = require('path'), os = require('os');
function loadEngine(root, workerDir, tag) {
  const here = path.join(root, workerDir);
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const esc = p => path.join(here, p);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, name, rel) => `const ${name} = require('${esc('src/' + rel.slice(2))}');`);
  src = src.replace(/^export class (CrmWorkflow|QuotePoWorkflow)/mg, 'class $1');
  const ed = src.indexOf('export default');
  if (ed > -1) { let d = 0, s = false, e = ed; for (let i = ed; i < src.length; i++) { if (src[i] === '{') { d++; s = true; } if (src[i] === '}') { d--; if (s && d === 0) { e = i + 1; break; } } } src = src.slice(0, ed) + src.slice(e + 1); }
  src += `\nmodule.exports = { handleFollowUpModifier };`;
  const tmp = path.join(os.tmpdir(), `r2probe-${tag}-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}
const kvWith = (assistantMsg) => ({
  get: async () => ({ messages: [
    { role: 'user', content: 'earlier request' },
    { role: 'assistant', content: assistantMsg },
  ] }),
  put: async () => {},
});
const SME_HIST = '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=MR44-HW,LIC-ENT-3YR,LIC-SME-3YR&qty=4,4,100';
const SME_ONLY = ['**1-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-SME-1YR&qty=100',
  '**3-Year Co-Term:** https://stratusinfosystems.com/order/?item=LIC-SME-3YR&qty=100'].join('\n\n');
(async () => {
  const root = path.join(__dirname, '..');
  let bad = 0;
  for (const [dir, tag] of [['worker', 'wbx'], ['worker-gchat', 'g']]) {
    const W = loadEngine(root, dir, tag);
    for (const [msg, hist] of [
      ['add 2 mr44', SME_HIST], ['double it', SME_ONLY], ['license only', SME_HIST],
      ['just the 3 year', SME_ONLY], ["what's the cost", SME_ONLY], ['hardware only', SME_HIST],
    ]) {
      let r = null;
      try { r = await W.handleFollowUpModifier(msg, 'p', kvWith(hist)); } catch (e) { console.log(`${tag} "${msg}": THREW ${e.message}`); bad++; continue; }
      const leak = /LIC-SME-\d/.test(String(r || ''));
      const repl = /LIC-MI-EMSC-D-1YMC-A/.test(String(r || ''));
      if (leak) bad++;
      console.log(`${tag} "${msg}": ${r === null ? 'null(LLM-fallthrough)' : (leak ? '❌ LEAK' : (repl ? '✅ substituted' : '✅ no SME in output'))}`);
    }
  }
  console.log(bad === 0 ? '✅ ALL PASS — 12 passed, 0 failed' : `❌ ${bad} FAILED`);
  if (bad > 0) process.exit(1);
})();
