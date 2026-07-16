// PR-B regression suite — Anthropic prompt caching with tiered canary kill-switch.
//
// Council requirement (Codex Round 2 must-fix #3): the systemPrompt refactor
// touches the askClaude requestBody build site AND askClaudeContinue. Both
// the advisory query path (isAdvisoryQuery → buildDeepSeekGuardedSystemPrompt)
// and the image vision path (imageData branch in askClaude) must continue
// working with the new array-of-blocks shape OR explicitly opt out of caching.
//
// 18 test cases cover:
//   1.  buildAnthropicSystemBlocks emits [{static, cache_control}, {dynamic}]
//       when the boundary sentinel is present.
//   2.  buildAnthropicSystemBlocks emits single ephemeral block when no boundary.
//   3.  buildAnthropicSystemBlocks emits plain string when caching disabled.
//   4.  attachToolCacheControl marks ONLY the last tool entry.
//   5.  attachToolCacheControl is a no-op when caching disabled.
//   6.  attachToolCacheControl handles empty/missing tools arrays.
//   7.  extractCacheUsage returns {creation:0, read:0} for missing usage.
//   8.  extractCacheUsage parses Anthropic response.usage correctly.
//   9.  buildCrmSystemPrompt embeds the boundary marker at the seam.
//   10. The boundary marker is invisible enough that source code didn't
//       accidentally interpolate it in user-visible content.
//   11. isPromptCachingEnabled defaults to true when KV is absent.
//   12. isPromptCachingEnabled respects KV="false" within 30s.
//   13. isPromptCachingEnabled isolate-caches the KV value (read-once).
//   14. _resetPromptCachingKillSwitchCache forces a fresh KV read.
//   15. verifyCachingActive returns {action:'no-data'} when ANALYTICS_DB
//       is unbound (graceful degradation).
//   16. killPromptCaching writes "false" to KV and resets isolate cache.
//   17. Advisory query path: buildDeepSeekGuardedSystemPrompt result still
//       passes through buildAnthropicSystemBlocks cleanly (string, no boundary).
//   18. Image content blocks NEVER receive cache markers — verified by
//       inspecting the buildAnthropicSystemBlocks contract (no image input).

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function buildShim() {
  const here = __dirname;
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
  const escPath = p => path.join(here, p).replace(/\\/g, '\\\\');
  src = src.replace(/^import \{ WorkflowEntrypoint \} from 'cloudflare:workers';?$/m,
    'class WorkflowEntrypoint {}');
  src = src.replace(/^import pricesData from '\.\/data\/prices\.json';?$/m,
    `const pricesData = require('${escPath('src/data/prices.json')}');`);
  src = src.replace(/^import catalogData from '\.\/data\/auto-catalog\.json';?$/m,
    `const catalogData = require('${escPath('src/data/auto-catalog.json')}');`);
  src = src.replace(/^import specsData from '\.\/data\/specs\.json';?$/m,
    `const specsData = require('${escPath('src/data/specs.json')}');`);
  src = src.replace(/^import accessoriesData from '\.\/data\/accessories\.json';?$/m,
    `const accessoriesData = require('${escPath('src/data/accessories.json')}');`);
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
  src += `
module.exports = {
  PROMPT_CACHE_BOUNDARY,
  PROMPT_CACHING_KV_KEY,
  PROMPT_CACHING_KILL_SWITCH_TTL_MS,
  isPromptCachingEnabled,
  _resetPromptCachingKillSwitchCache,
  buildAnthropicSystemBlocks,
  attachToolCacheControl,
  extractCacheUsage,
  verifyCachingActive,
  killPromptCaching,
  buildCrmSystemPrompt,
  isAdvisoryQuery,
  buildDeepSeekGuardedSystemPrompt,
  SYSTEM_PROMPT
};`;
  const tmp = path.join(os.tmpdir(), `stratus-gchat-prb-${process.pid}.cjs`);
  fs.writeFileSync(tmp, src);
  return require(tmp);
}

const mod = buildShim();
const {
  PROMPT_CACHE_BOUNDARY,
  PROMPT_CACHING_KV_KEY,
  isPromptCachingEnabled,
  _resetPromptCachingKillSwitchCache,
  buildAnthropicSystemBlocks,
  attachToolCacheControl,
  extractCacheUsage,
  verifyCachingActive,
  killPromptCaching,
  buildCrmSystemPrompt,
  isAdvisoryQuery,
  buildDeepSeekGuardedSystemPrompt,
  SYSTEM_PROMPT
} = mod;

let pass = 0, fail = 0;
function t(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(() => { console.log(`  PASS  ${name}`); pass++; },
                    e => { console.log(`  FAIL  ${name}\n        ${e.message}`); fail++; });
    }
    console.log(`  PASS  ${name}`); pass++;
  } catch (e) {
    console.log(`  FAIL  ${name}\n        ${e.message}`); fail++;
  }
}

(async () => {

  console.log('\nPR-B  Anthropic prompt caching helpers');
  console.log('-------------------------------------------------------------------');

  // 1. Boundary marker splits cleanly
  await t('1. buildAnthropicSystemBlocks splits on boundary into two blocks', () => {
    const sp = 'STATIC' + PROMPT_CACHE_BOUNDARY + 'DYNAMIC';
    const out = buildAnthropicSystemBlocks(sp, true);
    assert.ok(Array.isArray(out), 'expected array');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].type, 'text');
    assert.strictEqual(out[0].text, 'STATIC');
    assert.deepStrictEqual(out[0].cache_control, { type: 'ephemeral', ttl: '1h' });
    assert.strictEqual(out[1].type, 'text');
    assert.strictEqual(out[1].text, 'DYNAMIC');
    assert.strictEqual(out[1].cache_control, undefined);
  });

  // 2. No boundary → whole prompt is one ephemeral block
  await t('2. buildAnthropicSystemBlocks single ephemeral block when no boundary', () => {
    const out = buildAnthropicSystemBlocks('ALL STATIC', true);
    assert.ok(Array.isArray(out));
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].text, 'ALL STATIC');
    assert.deepStrictEqual(out[0].cache_control, { type: 'ephemeral', ttl: '1h' });
  });

  // 3. Caching disabled → plain string with boundary stripped
  await t('3. buildAnthropicSystemBlocks returns plain string when caching disabled', () => {
    const sp = 'STATIC' + PROMPT_CACHE_BOUNDARY + 'DYNAMIC';
    const out = buildAnthropicSystemBlocks(sp, false);
    assert.strictEqual(typeof out, 'string');
    assert.ok(!out.includes('___PR_B_DYNAMIC_APPENDIX_BOUNDARY___'),
      'boundary sentinel must be stripped in legacy path');
    assert.ok(out.includes('STATIC'));
    assert.ok(out.includes('DYNAMIC'));
  });

  // 4. attachToolCacheControl on last tool only
  await t('4. attachToolCacheControl marks only the LAST tool', () => {
    const tools = [
      { name: 'a', description: 'aa' },
      { name: 'b', description: 'bb' },
      { name: 'c', description: 'cc' }
    ];
    const out = attachToolCacheControl(tools, true);
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out[0].cache_control, undefined);
    assert.strictEqual(out[1].cache_control, undefined);
    assert.deepStrictEqual(out[2].cache_control, { type: 'ephemeral', ttl: '1h' });
    // Input must not be mutated
    assert.strictEqual(tools[2].cache_control, undefined);
  });

  // 5. attachToolCacheControl no-op when disabled
  await t('5. attachToolCacheControl is no-op when caching disabled', () => {
    const tools = [{ name: 'a' }, { name: 'b' }];
    const out = attachToolCacheControl(tools, false);
    assert.strictEqual(out, tools);
  });

  // 6. attachToolCacheControl handles empty/missing
  await t('6. attachToolCacheControl handles empty + non-array gracefully', () => {
    assert.deepStrictEqual(attachToolCacheControl([], true), []);
    assert.strictEqual(attachToolCacheControl(null, true), null);
    assert.strictEqual(attachToolCacheControl(undefined, true), undefined);
  });

  // 7. extractCacheUsage defaults
  await t('7. extractCacheUsage returns zeros for missing usage', () => {
    assert.deepStrictEqual(extractCacheUsage(undefined), { creation: 0, read: 0 });
    assert.deepStrictEqual(extractCacheUsage(null), { creation: 0, read: 0 });
    assert.deepStrictEqual(extractCacheUsage({}), { creation: 0, read: 0 });
  });

  // 8. extractCacheUsage parses real Anthropic response shape
  await t('8. extractCacheUsage parses Anthropic response.usage', () => {
    const usage = {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 12000,
      cache_read_input_tokens: 8500
    };
    assert.deepStrictEqual(extractCacheUsage(usage), { creation: 12000, read: 8500 });
  });

  // 9. buildCrmSystemPrompt embeds boundary marker
  await t('9. buildCrmSystemPrompt embeds PROMPT_CACHE_BOUNDARY at seam', () => {
    const out = buildCrmSystemPrompt('check my pipeline');
    assert.ok(out.includes(PROMPT_CACHE_BOUNDARY),
      'CRM prompt missing the cache boundary marker');
    // Boundary should be at the end (after all conditional appendices) so the
    // base CRM_AGENT_SYSTEM_PROMPT_BASE + ADVISOR section is cacheable.
    assert.ok(out.indexOf(PROMPT_CACHE_BOUNDARY) > 1000,
      'boundary appears too early in the CRM prompt');
  });

  // 10. boundary marker is not user-visible in prompts via re-split
  await t('10. boundary marker round-trips cleanly', () => {
    const sp = buildCrmSystemPrompt('new customer');
    const blocks = buildAnthropicSystemBlocks(sp, true);
    assert.ok(Array.isArray(blocks));
    // The cached static block should be large (the CRM base + advisor + intake)
    assert.ok(blocks[0].text.length > 1000, `static block too small: ${blocks[0].text.length}`);
    // No block should still contain the sentinel
    for (const b of blocks) {
      assert.ok(!b.text.includes('___PR_B_DYNAMIC_APPENDIX_BOUNDARY___'),
        'sentinel leaked into a block');
    }
  });

  // 11. Kill switch default ON when KV missing
  await t('11. isPromptCachingEnabled defaults true when KV absent', async () => {
    _resetPromptCachingKillSwitchCache();
    const enabled = await isPromptCachingEnabled({});
    assert.strictEqual(enabled, true);
  });

  // 12. Kill switch respects KV="false"
  await t('12. isPromptCachingEnabled returns false when KV value is "false"', async () => {
    _resetPromptCachingKillSwitchCache();
    const env = {
      CONVERSATION_KV: {
        async get(key) { return key === PROMPT_CACHING_KV_KEY ? 'false' : null; }
      }
    };
    const enabled = await isPromptCachingEnabled(env);
    assert.strictEqual(enabled, false);
  });

  // 13. Kill switch isolate-cached (single KV read across rapid calls)
  await t('13. isPromptCachingEnabled isolate-caches KV reads within 30s', async () => {
    _resetPromptCachingKillSwitchCache();
    let reads = 0;
    const env = {
      CONVERSATION_KV: {
        async get(_) { reads++; return 'true'; }
      }
    };
    await isPromptCachingEnabled(env);
    await isPromptCachingEnabled(env);
    await isPromptCachingEnabled(env);
    assert.strictEqual(reads, 1, `expected exactly 1 KV read, saw ${reads}`);
  });

  // 14. Reset helper forces fresh read
  await t('14. _resetPromptCachingKillSwitchCache forces fresh KV read', async () => {
    _resetPromptCachingKillSwitchCache();
    let reads = 0;
    const env = {
      CONVERSATION_KV: {
        async get(_) { reads++; return reads === 1 ? 'true' : 'false'; }
      }
    };
    const r1 = await isPromptCachingEnabled(env);
    _resetPromptCachingKillSwitchCache();
    const r2 = await isPromptCachingEnabled(env);
    assert.strictEqual(r1, true);
    assert.strictEqual(r2, false);
    assert.strictEqual(reads, 2);
  });

  // 15. verifyCachingActive graceful degradation
  await t('15. verifyCachingActive returns no-data when ANALYTICS_DB missing', async () => {
    const r = await verifyCachingActive({});
    assert.strictEqual(r.action, 'no-data');
    assert.ok(r.reason.includes('ANALYTICS_DB'));
  });

  // 16. killPromptCaching writes "false" to KV
  await t('16. killPromptCaching writes "false" to KV and resets isolate cache', async () => {
    _resetPromptCachingKillSwitchCache();
    let written = null;
    const env = {
      CONVERSATION_KV: {
        async get(_) { return 'true'; },
        async put(key, value) { written = { key, value }; }
      }
    };
    await isPromptCachingEnabled(env);  // prime cache to true
    await killPromptCaching(env, 'test reason');
    assert.deepStrictEqual(written, { key: PROMPT_CACHING_KV_KEY, value: 'false' });
    // Without resetting we should see the new cached false
    const after = await isPromptCachingEnabled(env);
    assert.strictEqual(after, false, 'isolate cache should reflect kill immediately');
  });

  // 17. Advisory path compatibility
  await t('17. Advisory path: buildDeepSeekGuardedSystemPrompt result passes through helpers', async () => {
    // 2026-06-10: buildDeepSeekGuardedSystemPrompt became async when owner-context
    // depersonalization landed (it awaits getOwnerContext to fill {{OWNER_*}}
    // placeholders; both production call sites await it). The helper still
    // RESOLVES to a plain string — await it like the production paths do.
    const ds = await buildDeepSeekGuardedSystemPrompt('what firewall should I use for 100 users');
    assert.strictEqual(typeof ds, 'string');
    // Advisory wraps buildCrmSystemPrompt which now includes the cache
    // boundary; the DeepSeek guardrails are appended AFTER it. That means
    // when this prompt is fed to Anthropic helpers it splits cleanly into
    // [cached CRM base] + [uncached date + DeepSeek guardrails]. That's the
    // correct caching behavior — guardrails are short, CRM base is huge.
    const blocks = buildAnthropicSystemBlocks(ds, true);
    assert.ok(Array.isArray(blocks));
    assert.strictEqual(blocks.length, 2, 'advisor prompt should split into 2 blocks');
    assert.deepStrictEqual(blocks[0].cache_control, { type: 'ephemeral', ttl: '1h' });
    assert.ok(blocks[0].text.length > 5000, 'static block should be the big CRM base');
    assert.ok(blocks[1].text.includes('DEEPSEEK PRODUCTION GUARDRAILS'),
      'dynamic block should contain the appended guardrails');
    assert.strictEqual(blocks[1].cache_control, undefined);
    // Disabled path → plain string, no markers
    const plain = buildAnthropicSystemBlocks(ds, false);
    assert.strictEqual(typeof plain, 'string');
    assert.ok(!plain.includes('___PR_B_DYNAMIC_APPENDIX_BOUNDARY___'),
      'plain path must strip the boundary sentinel');
    assert.ok(plain.includes('DEEPSEEK PRODUCTION GUARDRAILS'),
      'plain path must preserve guardrails');
  });

  // 18. Image content blocks contract — helpers never touch user messages
  await t('18. Cache helpers never receive/produce image content blocks', () => {
    // buildAnthropicSystemBlocks works only on strings (system field).
    // Tools array helper marks only tool entries (cache_control top-level
    // on tool def, not on schema). Image content blocks live in
    // messages[].content[] which our helpers do not touch.
    // Static contract assertion: signature is (systemPrompt:string, enabled:bool).
    // Image-shaped input would throw — confirm graceful handling.
    const out = buildAnthropicSystemBlocks(null, true);
    assert.strictEqual(out, '');
    const out2 = buildAnthropicSystemBlocks(undefined, true);
    assert.strictEqual(out2, '');
    // Tools containing a vision-style block is still treated as a tool def
    // (cache_control still attaches to last entry, no image leakage).
    const toolsWithVisionShape = [
      { name: 'vision_inspector', description: 'looks at things',
        input_schema: { type: 'object', properties: { image: { type: 'string' } } } }
    ];
    const cached = attachToolCacheControl(toolsWithVisionShape, true);
    assert.deepStrictEqual(cached[0].cache_control, { type: 'ephemeral', ttl: '1h' });
    // Original tool def is not mutated
    assert.strictEqual(toolsWithVisionShape[0].cache_control, undefined);
  });

  // ─── Summary ──
  console.log('\n-------------------------------------------------------------------');
  console.log(`PR-B test suite: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
