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
  check('Block forbids observed live "resend your request" wording',
    /please resend your request as a new message/i.test(block),
    block.substring(0, 800));
}

// ─── A2. Source-level: cf-conversation retry-reroute note rewords ─────────
{
  const note = (fileSrc.match(/The user is retrying a prior datasheet[\s\S]*?\)\)/) || [''])[0];
  check('Retry-reroute note found', note.length > 0);
  check('Note treats the same turn as the retry (no extra round-trip ask)',
    /same turn as the retry|this turn IS the retry/i.test(note),
    note);
  check('Note does NOT claim the fetch already ran before askClaude routing',
    !/already attempted a live datasheet fetch THIS turn/i.test(note),
    note);
  check('Note explicitly forbids "send another message to trigger"',
    /do NOT ask the user to 'send another message to trigger the fetch'/i.test(note),
    note);
  check('Note explicitly forbids one-model-at-a-time retry punts',
    /do NOT ask them to try one model at a time/i.test(note),
    note);
}

// ─── B1. Source-level: stripEchoedSourceFooter helper exists + is called ──
{
  check('stripEchoedSourceFooter helper exists',
    /function stripEchoedSourceFooter\(reply\)/.test(fileSrc),
    'helper not found');
  check('Final-reply assembly calls stripEchoedSourceFooter',
    /const sanitizedReply = sanitizeLiveFetchRetryWording\([\s\S]{0,160}reply[\s\S]{0,40}\);/.test(fileSrc) &&
    /const dedupedReply = stripEchoedSourceFooter\(sanitizedReply\);/.test(fileSrc) &&
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
  src += '\nmodule.exports = { stripEchoedSourceFooter, sanitizeLiveFetchRetryWording };';
  const tmp = path.join(os.tmpdir(), `stratus-strip-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}
const { stripEchoedSourceFooter, sanitizeLiveFetchRetryWording } = loadHelper();

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
  {
    name: 'Strips Claude-echoed model marker before worker footer',
    input: `Variants.\n\n_💎 Claude Sonnet 4.6 · 2.1s_\n\n_📄 Source: live datasheet — MS150 (documentation.meraki.com)_\n\n_💎 Claude Sonnet 4.6 · 4.2s_`,
    expectStripped: ['Claude Sonnet', 'Source:']
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

// ─── C. Functional: live-fetch retry wording sanitizer ────────────────────
{
  const liveFailure = `You're right — let me retry the live fetch now. Please resend your request as a new message saying something like **"fetch the full MS150 datasheet"** or **"pull the latest MS150 datasheet specs"** — that will trigger the worker to re-fetch the page server-side and inject the full content before I respond.\n\nThe truncation happened because the fetch on the previous turn only captured partial content. A fresh trigger will pull the complete page.\n\n_💎 Claude Sonnet 4.6 · 2.1s_`;
  const out = sanitizeLiveFetchRetryWording(liveFailure);
  check('Sanitizer removes observed "Please resend your request" live failure',
    !/Please resend your request|new message saying|that will trigger the worker|fresh trigger/i.test(out),
    `out=${out}`);
  check('Sanitizer replaces retry failure with same-turn wording',
    /tried the live fetch on this turn/i.test(out),
    `out=${out}`);
}
{
  const promptTwoFailure = `Let me fetch the full datasheet now — one moment!\n\n*(The live fetch will trigger on this request and inject the full content. If the datasheet content doesn't appear fully in my next response, I'll flag it and retry.)*\n\nI couldn't pull the full datasheet just now — want me to retry?`;
  const out = sanitizeLiveFetchRetryWording(promptTwoFailure);
  check('Sanitizer removes next-response retry wording',
    !/next response|Want me to retry|will trigger on this request/i.test(out),
    `out=${out}`);
}
{
  const unrelated = `Here are the MS150 variants from the datasheet. Source for this is the injected content.`;
  check('Sanitizer leaves normal datasheet prose unchanged',
    sanitizeLiveFetchRetryWording(unrelated) === unrelated,
    `out=${sanitizeLiveFetchRetryWording(unrelated)}`);
}

// ─── D. Round-2 regressions: Codex live regression 2026-05-06 ─────────────
// Variant A — "next turn" injection promise observed on PR #28 head 2297252.
{
  const variantA = `Here are the 48-port PoE MS150 variants:\n\n- MS150-48LP-4G\n- MS150-48FP-4G\n\n(The live fetch will inject the full spec table on the next turn. Once it loads, I'll compare all 48-port PoE models and flag any differences from what I listed above.)\n\n_💎 Claude Sonnet 4.6 · 2.0s_`;
  const out = sanitizeLiveFetchRetryWording(variantA);
  check('Variant A: "next turn" injection promise scrubbed',
    !/on the next turn|inject the full spec table on the next turn|Once it loads/i.test(out),
    `out=${out}`);
  check('Variant A: replacement uses same-turn wording',
    /attempted on this turn|came back empty or incomplete/i.test(out),
    `out=${out}`);
  check('Variant A: variant list preserved',
    /MS150-48LP-4G/.test(out) && /MS150-48FP-4G/.test(out),
    `out=${out}`);
}

// Variant B — "didn't inject this round / fetch times out / Just say try again" failure narration.
{
  const variantB = `It looks like the live content didn't inject this round — this can occasionally happen if the fetch times out.\n\nHere's what I'd suggest:\n\nWant me to retry? Just say "try again" and I'll attempt the fetch once more. These usually succeed on a second attempt.\n\n_💎 Claude Sonnet 4.6 · 2.4s_`;
  const out = sanitizeLiveFetchRetryWording(variantB);
  check('Variant B: "didn\'t inject this round" scrubbed',
    !/didn'?t inject this round|fetch times? out|occasionally happen/i.test(out),
    `out=${out}`);
  check('Variant B: "Just say try again" punt scrubbed',
    !/Just say "try again"|say "try again"|usually succeed|second attempt|Here'?s what I'?d suggest/i.test(out),
    `out=${out}`);
  check('Variant B: replacement standardized',
    /came back empty or incomplete/i.test(out),
    `out=${out}`);
}

// Variant C — closing tail "Say 'try again' and I'll retry the fetch!".
{
  const variantC = `The live fetch returned partial content this turn.\n\nSay "try again" and I'll retry the fetch!`;
  const out = sanitizeLiveFetchRetryWording(variantC);
  check('Variant C: trailing "Say try again" sign-off removed',
    !/Say "try again"|retry the fetch/i.test(out),
    `out=${out}`);
  check('Variant C: prior partial-content sentence preserved',
    /returned partial content/i.test(out),
    `out=${out}`);
}

// Variant C bis — "Just say 'try again'" form with period close.
{
  const variantCbis = `The live datasheet didn't fully inject. Just say "try again" and I'll retry the fetch.`;
  const out = sanitizeLiveFetchRetryWording(variantCbis);
  check('Variant C-bis: "Just say try again" with period removed',
    !/Just say "try again"|retry the fetch/i.test(out),
    `out=${out}`);
}

// Variant D — live retry after five-model batch suggested one-at-a-time retries.
{
  const variantD = `The fetch ran on this turn — here's what came back:\n\n**The live datasheet fetches came back empty or incomplete for this batch.**\n\nA few things that could help:\n\n**Try fetching one at a time** — batch fetches of 5 models may be hitting a timeout or content limit. Try:\n— "Pull the live datasheet for CW9172I"\n— "Pull the live datasheet for CW9179F"\n— "Pull the live datasheet for C8455-G2-MX"\n\n**What I can confirm from prior turns in this session:**\n— **C8455-G2-MX** — fetched successfully earlier this conversation.\n\n**What I can't confirm** — CW9171I specs from a live fetch this session. Try them one at a time and I'll use the injected content directly.`;
  const out = sanitizeLiveFetchRetryWording(variantD);
  check('Variant D: one-at-a-time retry instructions scrubbed',
    !/Try fetching one at a time|Try them one at a time|batch fetches of 5 models may be hitting/i.test(out),
    `out=${out}`);
  check('Variant D: prior successful live-source facts preserved',
    /C8455-G2-MX/.test(out) && /fetched successfully earlier/.test(out),
    `out=${out}`);
}

// Negative — generic non-fetch "try again" prose must be preserved.
{
  const benign = `If your test fails, try again with a fresh build.`;
  check('Sanitizer leaves benign "try again" prose alone (no fetch context)',
    sanitizeLiveFetchRetryWording(benign) === benign,
    `out=${sanitizeLiveFetchRetryWording(benign)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
