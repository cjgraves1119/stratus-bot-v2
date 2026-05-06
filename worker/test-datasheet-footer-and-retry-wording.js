// Regression test: PR #28 polish — duplicate source/model footer dedupe +
// retry-reroute wording fix. Two backlog items Codex flagged after the PR #27
// live regression (2026-05-05T20:09Z).
//
// Failure shapes addressed:
//   A. Datasheet replies appended TWO source attribution lines — the worker's
//      own `_📄 Source: live datasheet — MS150 (documentation.meraki.com)_`
//      footer plus a Claude-echoed `Source: live datasheet — MS150 ...` line
//      that Claude parroted from the injected '## LIVE DATASHEET CONTENT'.
//   B. Retry-reroute reply said "send another message to trigger the fetch"
//      instead of just answering this turn. Root cause: SYSTEM_PROMPT block
//      added in PR #27 said "trigger another live fetch on the next turn",
//      and the retry-rerouting inline note made Claude think the fetch
//      happens later.

const fs = require('fs'), path = require('path'), os = require('os');
const here = path.resolve(__dirname);
const fileSrc = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
const check = (desc, cond, diag) => {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + (typeof diag === 'string' ? diag.substring(0, 600) : diag) : ''}`); fail++; }
};

// ─── A1. Source-level: SYSTEM_PROMPT no longer says "next turn" / "send another" ─
{
  const block = (fileSrc.match(/## LIVE DATASHEET CAPABILITY[\s\S]*?## CRITICAL/) || [''])[0];
  check('LIVE DATASHEET CAPABILITY block found', block.length > 0);
  check('Block does NOT say "trigger another live fetch on the next turn"',
    !/trigger\s+another\s+live\s+fetch\s+on\s+the\s+next\s+turn/i.test(block),
    block.substring(0, 400));
  check('Block DOES say "THE SAME TURN" or equivalent (fetch happens this turn)',
    /THE SAME TURN|same\s+turn|this turn/i.test(block),
    block.substring(0, 400));
  check('Block forbids "send another message to trigger" wording',
    /NEVER tell the user to "send another message/i.test(block),
    block.substring(0, 400));
}

// ─── A2. Source-level: cf-conversation retry-reroute note rewords ─────────
{
  const note = (fileSrc.match(/The user is retrying a prior datasheet[\s\S]*?\)\)/) || [''])[0];
  check('Retry-reroute note found', note.length > 0);
  check('Note says "this turn IS the retry" (no extra round-trip ask)',
    /this turn IS the retry|already attempted a live datasheet fetch THIS turn/i.test(note),
    note);
  check('Note explicitly forbids "send another message to trigger"',
    /do NOT ask the user to 'send another message to trigger the fetch'/i.test(note),
    note);
}

// ─── B1. Source-level: stripEchoedSourceFooter helper exists + is called ──
{
  check('stripEchoedSourceFooter helper exists',
    /function stripEchoedSourceFooter\(reply\)/.test(fileSrc),
    'helper not found');
  check('Final-reply assembly calls stripEchoedSourceFooter',
    /const dedupedReply = stripEchoedSourceFooter\(reply\);/.test(fileSrc) &&
    /\$\{dedupedReply\}.*\$\{sourceFooter\}/s.test(fileSrc),
    'dedupedReply not threaded into finalReply');
}

// ─── B2. Functional: stripEchoedSourceFooter behavior ─────────────────────
// Build a runnable shim by extracting the helper definition, since it's a
// pure synchronous function with no JSON imports.
function loadHelper() {
  let src = fileSrc;
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m, `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m, `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m, `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m, `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  src += '\nmodule.exports = { stripEchoedSourceFooter };';
  const tmp = path.join(os.tmpdir(), `stratus-strip-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp).stripEchoedSourceFooter;
}
const stripEchoedSourceFooter = loadHelper();

const cases = [
  // Echo shapes that should be stripped
  {
    name: 'Strips Claude-echoed "Source: live datasheet — MS150 (...)"',
    input: `Here are the MS150 48-port variants...\n\nSource: live datasheet — MS150 (documentation.meraki.com)`,
    expectStripped: 'Source:'
  },
  {
    name: 'Strips italicized "*Live datasheet: MS150*"',
    input: `Here are the variants.\n\n*Live datasheet: MS150*`,
    expectStripped: 'Live datasheet:'
  },
  {
    name: 'Strips underscored "_Source: live datasheet ..._" with emoji',
    input: `Variants.\n\n_📄 Source: live datasheet — MS150 (documentation.meraki.com)_`,
    expectStripped: 'Source:'
  },
  {
    name: 'Strips trailing "[Datasheet: https://...]" reference',
    input: `Variants here.\n\n[Datasheet: https://documentation.meraki.com/MS150]`,
    expectStripped: '[Datasheet:'
  },
  {
    name: 'Strips multiple trailing attribution lines + blank lines',
    input: `Variants.\n\n*Live datasheet: MS150*\n\nSource: live datasheet — MS150 (documentation.meraki.com)\n`,
    expectStripped: ['Live datasheet:', 'Source:']
  },
];
for (const c of cases) {
  const out = stripEchoedSourceFooter(c.input);
  const expects = Array.isArray(c.expectStripped) ? c.expectStripped : [c.expectStripped];
  for (const phrase of expects) {
    check(`${c.name} — strips "${phrase}"`,
      typeof out === 'string' && !out.includes(phrase),
      `out=${out}`);
  }
  // Body must survive
  check(`${c.name} — preserves body content`,
    typeof out === 'string' && out.length > 0 && (out.includes('Variants') || out.includes('variants')),
    `out=${out}`);
}

// ─── B3. Negative cases — must NOT strip non-attribution content ──────────
{
  // Body that mentions "datasheet" but isn't an attribution footer must NOT be stripped.
  const body = `The MS150 datasheet says the 48-port models support PoE+. The Source for this is the live datasheet content fetched.\n\nSee the spec section for details.`;
  const out = stripEchoedSourceFooter(body);
  check('Does NOT strip "datasheet" / "Source for this" inside body prose',
    out === body || out === body.trimEnd(),
    `out=${out}`);
}
{
  // Empty / null inputs survive without throwing.
  check('Empty string returns empty string', stripEchoedSourceFooter('') === '');
  check('null input returns empty string', stripEchoedSourceFooter(null) === '');
}
{
  // Reply with no echo — passes through unchanged (modulo trailing whitespace).
  const clean = `Here are the MS150 variants:\n- MS150-48LP-4G\n- MS150-48FP-4G`;
  check('Reply with no echo passes through',
    stripEchoedSourceFooter(clean) === clean.trimEnd(),
    `out=${stripEchoedSourceFooter(clean)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
