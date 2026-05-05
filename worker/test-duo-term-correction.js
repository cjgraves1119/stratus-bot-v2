// Unit test: regression for the WebEx Duo Essentials term-correction bug
// Chris flagged on 2026-05-01 (and follow-up bugs surfaced in the council
// packet). Six cases the fix MUST cover end to end:
//
//   1. Base "100 Duo Essentials" deterministic quote keeps default (1Y/3Y/5Y).
//   2. Explicit "Generate a quote for 15 Duo Essentials for 1 year" emits 1YR.
//   3. After a single-term Duo quote, "change to 3 year" rewrites to 3YR.
//   4. After a single-term Duo quote, "change to 1 year" rewrites to 1YR.
//   5. Multi-year request returns 1YR + 3YR + 5YR with the same qty.
//   6. After "100 Duo Essentials 1YR", bare "3 year" rewrites to 3YR.
//
// We exercise three internal seams:
//   - applyV2Revision({...prior...}, {revision:{action:'change_term', new_term:N}})
//   - extractPriorFromAssistantUrl(<assistant message containing the URL>)
//   - handleFollowUpModifier('3 year', personId, mockKv)
//
// All output is checked at the rendered URL level so the test fails on any
// regression in either the revision logic or the renderer.

const fs = require('fs');
const path = require('path');
const os = require('os');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
  // Strip the worker's `export default { ... }` block so we can require() it.
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
  applyV2Revision,
  extractPriorFromAssistantUrl,
  buildQuoteResponse,
  parseMessage,
  handleFollowUpModifier,
  rewriteSkuTerm
};`;
  const tmp = path.join(os.tmpdir(), `stratus-duo-term-shim-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const {
  applyV2Revision,
  extractPriorFromAssistantUrl,
  buildQuoteResponse,
  parseMessage,
  handleFollowUpModifier,
  rewriteSkuTerm,
} = buildShim();

let pass = 0, fail = 0;
function check(desc, cond, diag) {
  if (cond) { console.log(`✅ ${desc}`); pass++; }
  else { console.log(`❌ ${desc}${diag ? '\n   ' + diag : ''}`); fail++; }
}

// ─── rewriteSkuTerm unit ────────────────────────────────────────────────────
check(
  'rewriteSkuTerm Duo 1YR → 3YR',
  rewriteSkuTerm('LIC-DUO-ESSENTIALS-1YR', 3) === 'LIC-DUO-ESSENTIALS-3YR'
);
check(
  'rewriteSkuTerm Umbrella 5YR → 1YR',
  rewriteSkuTerm('LIC-UMB-DNS-ESS-K9-5YR', 1) === 'LIC-UMB-DNS-ESS-K9-1YR'
);
check(
  'rewriteSkuTerm AnyConnect 1Y-S1 → 3Y-S1',
  rewriteSkuTerm('LIC-L-AC-APX-1Y-S1', 3) === 'LIC-L-AC-APX-3Y-S1'
);
check(
  'rewriteSkuTerm MT 1Y → 5Y (single-Y suffix)',
  rewriteSkuTerm('LIC-MT-1Y', 5) === 'LIC-MT-5Y'
);
check(
  'rewriteSkuTerm MV-1YR → 5YR',
  rewriteSkuTerm('LIC-MV-1YR', 5) === 'LIC-MV-5YR'
);
check(
  'rewriteSkuTerm rejects non-term suffix',
  rewriteSkuTerm('MR44-HW', 3) === null
);
check(
  'rewriteSkuTerm rejects invalid term',
  rewriteSkuTerm('LIC-DUO-ESSENTIALS-1YR', 2) === null
);

// ─── Case 3: applyV2Revision change_term on single-license directLicense ────
{
  const priorMsg = 'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=100';
  const prior = extractPriorFromAssistantUrl(priorMsg);
  check('extractPriorFromAssistantUrl returns prior shape for single Duo URL',
    !!prior, JSON.stringify(prior));

  const revised = applyV2Revision(prior, { revision: { action: 'change_term', new_term: 3 } });
  check('Case 3: applyV2Revision change_term to 3y returns revised shape',
    !!revised, `revised=${JSON.stringify(revised)}`);

  const out = revised && buildQuoteResponse(revised);
  const msg = out && out.message;
  check('Case 3: rendered URL contains LIC-DUO-ESSENTIALS-3YR',
    !!msg && msg.includes('LIC-DUO-ESSENTIALS-3YR'),
    `msg=${msg}`);
  check('Case 3: rendered URL preserves qty=100',
    !!msg && /qty=100\b/.test(msg),
    `msg=${msg}`);
  check('Case 3: rendered URL no longer contains LIC-DUO-ESSENTIALS-1YR',
    !!msg && !msg.includes('LIC-DUO-ESSENTIALS-1YR'),
    `msg=${msg}`);
}

// ─── Case 4: applyV2Revision change_term back to 1 year ─────────────────────
{
  const priorMsg = 'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=100';
  const prior = extractPriorFromAssistantUrl(priorMsg);
  const revised = applyV2Revision(prior, { revision: { action: 'change_term', new_term: 1 } });
  const out = revised && buildQuoteResponse(revised);
  const msg = out && out.message;
  check('Case 4: 3YR prior + change_term 1 → URL has LIC-DUO-ESSENTIALS-1YR',
    !!msg && msg.includes('LIC-DUO-ESSENTIALS-1YR'),
    `msg=${msg}`);
}

// ─── Case 5: multi-term prior + change_term filters cleanly (no regression) ─
{
  const priorMsg = `**Duo Essentials:**
1-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=55
3-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=55
5-Year Co-Term: https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-5YR&qty=55`;
  const prior = extractPriorFromAssistantUrl(priorMsg);
  check('Case 5 prior is isTermOptionQuote with 3 items',
    prior && prior.isTermOptionQuote && prior.items && prior.items.length === 3,
    `prior=${JSON.stringify(prior)}`);

  const revised = applyV2Revision(prior, { revision: { action: 'change_term', new_term: 3 } });
  const out = revised && buildQuoteResponse(revised);
  const msg = out && out.message;
  check('Case 5: change_term 3 narrows multi-term prior to only 3YR',
    !!msg && msg.includes('LIC-DUO-ESSENTIALS-3YR') &&
    !msg.includes('LIC-DUO-ESSENTIALS-1YR') &&
    !msg.includes('LIC-DUO-ESSENTIALS-5YR'),
    `msg=${msg}`);
}

// ─── Case 6: bare "3 year" follow-up after single-term Duo quote ───────────
async function testFollowUp() {
  const priorAssistant = 'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-1YR&qty=100';
  const history = [
    { role: 'user', content: 'quote 100 Duo essentials' },
    { role: 'assistant', content: priorAssistant },
  ];
  const mockKv = {
    get: async (key, type) => {
      if (!key.startsWith('conv:')) return null;
      const data = { messages: history };
      // KV's `json` shorthand returns a parsed object; otherwise return string.
      return type === 'json' ? data : JSON.stringify(data);
    },
    put: async () => {},
  };
  const reply = await handleFollowUpModifier('3 year', 'test-person', mockKv);
  check('Case 6: bare "3 year" follow-up returns a non-null reply',
    typeof reply === 'string' && reply.length > 0,
    `reply=${reply}`);
  check('Case 6: reply contains LIC-DUO-ESSENTIALS-3YR',
    typeof reply === 'string' && reply.includes('LIC-DUO-ESSENTIALS-3YR'),
    `reply=${reply}`);
  check('Case 6: reply preserves qty=100',
    typeof reply === 'string' && /qty=100\b/.test(reply),
    `reply=${reply}`);

  // "change to 3 year" should also flow through followup-modifier now
  const reply2 = await handleFollowUpModifier('change to 3 year', 'test-person', mockKv);
  check('Case 6b: "change to 3 year" follow-up returns LIC-DUO-ESSENTIALS-3YR',
    typeof reply2 === 'string' && reply2.includes('LIC-DUO-ESSENTIALS-3YR'),
    `reply2=${reply2}`);

  // "change to 1 year license" — verify trailing "license(s)" is tolerated
  const history3yr = [
    { role: 'user', content: 'quote 100 Duo essentials 3 year' },
    { role: 'assistant', content: 'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=100' },
  ];
  const mockKv3 = {
    get: async (key, type) => {
      if (!key.startsWith('conv:')) return null;
      const data = { messages: history3yr };
      return type === 'json' ? data : JSON.stringify(data);
    },
    put: async () => {},
  };
  const reply3 = await handleFollowUpModifier('change to 1 year license', 'test-person', mockKv3);
  check('Case 6c: "change to 1 year license" follow-up returns LIC-DUO-ESSENTIALS-1YR',
    typeof reply3 === 'string' && reply3.includes('LIC-DUO-ESSENTIALS-1YR'),
    `reply3=${reply3}`);
}

// ─── Cases 1, 2, 5 base-line: parseMessage + buildQuoteResponse renders ─────
function rendered(text) {
  const parsed = parseMessage(text);
  if (!parsed) return null;
  const out = buildQuoteResponse(parsed);
  return out && out.message;
}
{
  const m = rendered('quote 100 Duo essentials');
  check('Case 1: bare "100 Duo essentials" renders SOME Duo URL',
    !!m && /LIC-DUO-ESSENTIALS-[135]YR/.test(m),
    `m=${m}`);

  const m2 = rendered('Generate a quote for 15 Duo Essentials for 1 year');
  check('Case 2: explicit 1-year Duo Essentials includes LIC-DUO-ESSENTIALS-1YR',
    !!m2 && m2.includes('LIC-DUO-ESSENTIALS-1YR'),
    `m2=${m2}`);

  // Bare-family Duo prompt that works in production (verified in WebEx
  // transcript 2026-05-01T19:32:19Z) — should render all three terms.
  const m5 = rendered('100 duo essentials licenses');
  check('Case 5 base: bare "100 duo essentials licenses" renders all 3 terms',
    !!m5 &&
      m5.includes('LIC-DUO-ESSENTIALS-1YR') &&
      m5.includes('LIC-DUO-ESSENTIALS-3YR') &&
      m5.includes('LIC-DUO-ESSENTIALS-5YR'),
    `m5=${m5}`);

  // KNOWN PARSER GAP (out of scope for this PR — tracked for follow-up):
  // "Quote 55 duo premier 1yr, 3yr 5yr" comma-list syntax only emits 1YR.
  // Captured here as a soft check so we notice if it ever starts passing.
  const m5b = rendered('Quote 55 duo premier 1yr, 3yr 5yr');
  const m5bWorks = !!m5b &&
    m5b.includes('LIC-DUO-PREMIER-1YR') &&
    m5b.includes('LIC-DUO-PREMIER-3YR') &&
    m5b.includes('LIC-DUO-PREMIER-5YR');
  console.log(`${m5bWorks ? '🎉' : 'ℹ️ '} KNOWN-GAP probe: comma-list "1yr, 3yr 5yr" multi-term ${m5bWorks ? 'NOW WORKS — promote to assertion' : 'still emits only first term (out of scope)'}`);
}

// ─── Family coverage: Duo Advantage / Umbrella / AnyConnect / MV / MT / agnostic-MR ──
// Each block exercises the same flow as Case 3 (single-license prior + change_term)
// for one product family, asserting the rendered URL contains the expected
// rewritten SKU and quantity. These are the WebEx packet cases Codex called
// out as needing executable assertions, plus MV/MT/agnostic-MR coverage to
// match the PR body's stated scope.

function reviseAndRender(priorMsg, action, payload) {
  const prior = extractPriorFromAssistantUrl(priorMsg);
  if (!prior) return { prior: null, msg: null };
  const revised = applyV2Revision(prior, { revision: { action, ...payload } });
  if (!revised) return { prior, msg: null };
  const out = buildQuoteResponse(revised);
  return { prior, revised, msg: out && out.message };
}

// Duo Advantage 5YR → change to 3 year
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=25',
    'change_term', { new_term: 3 }
  );
  check('Duo Advantage 5YR → change_term=3 renders LIC-DUO-ADVANTAGE-3YR&qty=25',
    !!msg && msg.includes('LIC-DUO-ADVANTAGE-3YR') && /qty=25\b/.test(msg) &&
      !msg.includes('LIC-DUO-ADVANTAGE-5YR'),
    `msg=${msg}`);
}

// Umbrella DNS Essentials 1YR → swap to 5 year
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-1YR&qty=50',
    'change_term', { new_term: 5 }
  );
  check('Umbrella DNS Ess 1YR → change_term=5 renders LIC-UMB-DNS-ESS-K9-5YR&qty=50',
    !!msg && msg.includes('LIC-UMB-DNS-ESS-K9-5YR') && /qty=50\b/.test(msg) &&
      !msg.includes('LIC-UMB-DNS-ESS-K9-1YR'),
    `msg=${msg}`);
}

// AnyConnect Apex 3Y-S1 → change to 1 year
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-L-AC-APX-3Y-S1&qty=10',
    'change_term', { new_term: 1 }
  );
  check('AnyConnect Apex 3Y-S1 → change_term=1 renders LIC-L-AC-APX-1Y-S1&qty=10',
    !!msg && msg.includes('LIC-L-AC-APX-1Y-S1') && /qty=10\b/.test(msg) &&
      !msg.includes('LIC-L-AC-APX-3Y-S1'),
    `msg=${msg}`);
}

// MV camera license 1YR → change to 5 year
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-MV-1YR&qty=8',
    'change_term', { new_term: 5 }
  );
  check('MV 1YR → change_term=5 renders LIC-MV-5YR&qty=8',
    !!msg && msg.includes('LIC-MV-5YR') && /qty=8\b/.test(msg) &&
      !msg.includes('LIC-MV-1YR'),
    `msg=${msg}`);
}

// MT sensor license 1Y → change to 3 year (single-Y suffix variant)
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-MT-1Y&qty=12',
    'change_term', { new_term: 3 }
  );
  check('MT 1Y → change_term=3 renders LIC-MT-3Y&qty=12',
    !!msg && msg.includes('LIC-MT-3Y') && /qty=12\b/.test(msg) &&
      !msg.includes('LIC-MT-1Y'),
    `msg=${msg}`);
}

// Agnostic-MR LIC-ENT-1YR → change to 3 year
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-ENT-1YR&qty=20',
    'change_term', { new_term: 3 }
  );
  check('Agnostic MR LIC-ENT-1YR → change_term=3 renders LIC-ENT-3YR&qty=20',
    !!msg && msg.includes('LIC-ENT-3YR') && /qty=20\b/.test(msg) &&
      !msg.includes('LIC-ENT-1YR'),
    `msg=${msg}`);
}

// ─── handleFollowUpModifier family coverage ────────────────────────────────
// Mirrors the V2-revise tests above through the deterministic follow-up path.

function makeKv(history) {
  return {
    get: async (key, type) => {
      if (!key.startsWith('conv:')) return null;
      const data = { messages: history };
      return type === 'json' ? data : JSON.stringify(data);
    },
    put: async () => {},
  };
}

async function followupFamilyTests() {
  const cases = [
    {
      label: 'Duo Advantage follow-up "3 year" after 5YR',
      priorUrl: 'https://stratusinfosystems.com/order/?item=LIC-DUO-ADVANTAGE-5YR&qty=25',
      msg: '3 year',
      expectIncludes: 'LIC-DUO-ADVANTAGE-3YR',
      expectQty: 25,
    },
    {
      label: 'Umbrella DNS Ess follow-up "swap to 5 year" after 1YR',
      priorUrl: 'https://stratusinfosystems.com/order/?item=LIC-UMB-DNS-ESS-K9-1YR&qty=50',
      msg: 'swap to 5 year',
      expectIncludes: 'LIC-UMB-DNS-ESS-K9-5YR',
      expectQty: 50,
    },
    {
      label: 'AnyConnect Apex follow-up "change to 1 year" after 3Y',
      priorUrl: 'https://stratusinfosystems.com/order/?item=LIC-L-AC-APX-3Y-S1&qty=10',
      msg: 'change to 1 year',
      expectIncludes: 'LIC-L-AC-APX-1Y-S1',
      expectQty: 10,
    },
  ];
  for (const c of cases) {
    const history = [
      { role: 'user', content: 'prior request' },
      { role: 'assistant', content: c.priorUrl },
    ];
    const reply = await handleFollowUpModifier(c.msg, 'test-person', makeKv(history));
    const ok = typeof reply === 'string' &&
               reply.includes(c.expectIncludes) &&
               new RegExp(`qty=${c.expectQty}\\b`).test(reply);
    check(c.label, ok, `reply=${reply}`);
  }
}

// ─── Fail-closed assertions (Codex pushback round 1) ───────────────────────
// When prior bears a recognizable term suffix and rewrite can't produce a
// validated replacement, both code paths must return null instead of silently
// re-rendering the original SKU.

{
  // Forge a fake term-bearing SKU not in prices.json. extractPriorFromAssistantUrl
  // doesn't validate against prices, so this gives us a controllable test.
  const fakePrior = {
    items: [],
    directLicense: { sku: 'LIC-FAKE-MADEUP-1YR', qty: 1 },
    modifiers: { hardwareOnly: false, licenseOnly: true },
    isTermOptionQuote: false,
    requestedTerm: null,
    isAdvisory: false,
    isRevision: false,
  };
  const revised = applyV2Revision(fakePrior, { revision: { action: 'change_term', new_term: 3 } });
  check('Fail-closed: directLicense with term-bearing SKU not in prices → applyV2Revision returns null',
    revised === null, `revised=${JSON.stringify(revised)}`);
}

async function failClosedFollowupTest() {
  const history = [
    { role: 'user', content: 'fake' },
    // URL with a fake term-bearing SKU. Renderer would parse this back out, but
    // rewriteSkuTerm + prices validation should reject the rewrite candidate.
    { role: 'assistant', content: 'https://stratusinfosystems.com/order/?item=LIC-FAKE-MADEUP-1YR&qty=1' },
  ];
  const reply = await handleFollowUpModifier('change to 3 year', 'test-person', makeKv(history));
  check('Fail-closed: followup-modifier with term-bearing SKU not in prices returns null (no stale URL)',
    reply === null, `reply=${reply}`);
}

// Same-term no-op: "change to 3 year" after a 3YR prior should produce the
// same SKU (no rewrite needed) — must NOT trigger fail-closed.
{
  const { msg } = reviseAndRender(
    'https://stratusinfosystems.com/order/?item=LIC-DUO-ESSENTIALS-3YR&qty=7',
    'change_term', { new_term: 3 }
  );
  check('Same-term no-op: 3YR prior + change_term=3 keeps LIC-DUO-ESSENTIALS-3YR (not null)',
    !!msg && msg.includes('LIC-DUO-ESSENTIALS-3YR&qty=7'),
    `msg=${msg}`);
}

// // ─── Run async test, then summarise ────────────────────────────────────────
(async () => {
  await testFollowUp();
  await followupFamilyTests();
  await failClosedFollowupTest();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
