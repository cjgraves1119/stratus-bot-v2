// Regression test for WS1: the DETERMINISTIC builder (buildQuoteResponse) must
// match the vision builder's gold standard — emit quote lines in REQUEST order
// (not bucketed EOL-first), use hyphen "Option 1 - Renew As-Is" / "- As Quoted"
// / "- Hardware Refresh" labels, and put a blank line after each Option header.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m, 'class WorkflowEntrypoint {}');
src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
src = src.replace(/^export\s+(class|function|const|let|var)\s+/gm, '$1 ');
const edIdx = src.indexOf('export default');
if (edIdx > -1) {
  let depth = 0, started = false, end = edIdx;
  for (let i = edIdx; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  src = src.slice(0, edIdx) + src.slice(end + 1);
}
src += '\nmodule.exports = { parseMessage, buildQuoteResponse };';
const tmp = path.join(os.tmpdir(), `stratus-det-order-${process.pid}.cjs`);
fs.writeFileSync(tmp, src);
const { parseMessage, buildQuoteResponse } = require(tmp);

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + String(diag).slice(0, 400) : ''}`); fail++; }
};
const optBlock = (msg, n) => {
  const m = msg.match(new RegExp(`Option ${n}[\\s\\S]*?(?=\\*\\*Option |$)`));
  return m ? m[0] : '';
};
const firstUrl = (block) => (block.split('\n').find(l => l.includes('Co-Term: http')) || '');

// ─── Mixed non-EOL (first) + EOL (second): order must be preserved ───────────
// MX85 is non-EOL; MX64 is EOL → MX67. Request order: MX85 then MX64.
// Old bucketed builder emitted the EOL license FIRST (wrong). New builder keeps
// request order, so MX85 precedes MX64/MX67.
{
  const parsed = parseMessage('quote 1 MX85, 1 MX64');
  const out = buildQuoteResponse(parsed);
  const msg = (out && out.message) || '';
  check('builder returns a message', !!msg, JSON.stringify(out).slice(0, 200));

  // Labels standardized to hyphen, no em-dash in Option headers
  check('Option 1 uses hyphen "As Quoted" label', /\*\*Option 1 - As Quoted:\*\*/.test(msg), msg);
  check('no em-dash Option headers remain', !/\*\*Option [123] —/.test(msg), msg);
  check('Option 2 uses hyphen "Hardware Refresh" label', /\*\*Option 2 - Hardware Refresh/.test(msg), msg);

  // Spacing: blank line after the Option 1 header
  check('blank line after Option 1 header', /\*\*Option 1 - As Quoted:\*\*\n\n1-Year Co-Term:/.test(msg), msg);

  // 1/3/5 all present
  check('Option 1 shows 1/3/5-Year', /1-Year Co-Term/.test(msg) && /3-Year Co-Term/.test(msg) && /5-Year Co-Term/.test(msg), msg);

  // ORDER: in the Option 1 1-Year URL, MX85 license appears before the MX64 license
  const o1 = firstUrl(optBlock(msg, 1));
  check('Option 1: MX85 before MX64 (request order, not bucketed)',
    o1.indexOf('MX85') > -1 && o1.indexOf('MX64') > -1 && o1.indexOf('MX85') < o1.indexOf('MX64'),
    o1);

  // ORDER in refresh: MX85 (carried) before MX67 (MX64's replacement)
  const o2 = firstUrl(optBlock(msg, 2));
  check('Option 2: replacement MX67-HW present', /MX67-HW/.test(o2), o2);
  check('Option 2: MX85 before MX67 (request order)',
    o2.indexOf('MX85') > -1 && o2.indexOf('MX67') > -1 && o2.indexOf('MX85') < o2.indexOf('MX67'),
    o2);
  check('Option 1 is license-only for the EOL device (no MX67-HW / MX64-HW in renewal cart)',
    !/MX67-HW/.test(o1) && !/MX64-HW/.test(o1), o1);
}

// ─── licenseOnly renewal → "Renew As-Is" label (matches vision builder) ──────
{
  const parsed = parseMessage('renew licenses for 1 MX85, 1 MX64');
  const out = parsed ? buildQuoteResponse(parsed) : null;
  const msg = (out && out.message) || '';
  // Only assert if this routed through the EOL/renewal block with an Option 1
  if (/Option 1/.test(msg)) {
    check('licenseOnly path label is "Option 1 - Renew As-Is"', /\*\*Option 1 - Renew As-Is:\*\*/.test(msg), msg);
  } else {
    check('licenseOnly fixture produced a quote (skip label check if no Option block)', !!msg, msg);
  }
}

console.log(`\n${fail === 0 ? '🎉' : '⚠️ '} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
