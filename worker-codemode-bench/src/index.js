/**
 * Worker entrypoint for stratus-codemode-bench.
 * Endpoints: POST /run, POST /run-batch, GET /fixtures, GET /health
 */

import { runWithTools } from './runner-tools.js';
import { runWithCodemode } from './runner-codemode.js';
import { listFixtures, getFixture } from './fixtures.js';

const DEFAULT_SYSTEM_PROMPT =
  'You are the Stratus AI CRM assistant. Use the provided tools to answer the user. ' +
  'Be precise. When the task is read-only, prefer one efficient tool call sequence over many.';

export default {
  async fetch(request, env, ctx) {
    if (!authOk(request, env)) return json({ error: 'unauthorized' }, 401);
    const url = new URL(request.url);
    try {
      switch (`${request.method} ${url.pathname}`) {
        case 'GET /health':     return json(await health(env));
        case 'GET /fixtures':   return json({ fixtures: listFixtures() });
        case 'POST /run':       return json(await handleRun(await request.json(), env));
        case 'POST /run-batch': return json(await handleRunBatch(await request.json(), env, ctx));
        default:                return json({ error: 'not_found', path: url.pathname }, 404);
      }
    } catch (err) {
      return json({ error: 'exception', message: err.message, stack: err.stack }, 500);
    }
  }
};

function authOk(request, env) {
  const required = env.STRATUS_BENCH_AUTH_TOKEN;
  if (!required) return true;
  return request.headers.get('x-bench-auth') === required;
}

async function health(env) {
  return {
    ok: true,
    deps: { anthropic: !!env.ANTHROPIC_API_KEY, workers_ai: !!env.AI, worker_loader: !!env.LOADER, gchat_url: !!env.GCHAT_URL },
    fixtures: listFixtures().length,
    timestamp: new Date().toISOString()
  };
}

async function handleRun(body, env) {
  const fixtureId = body.fixture_id;
  const framework = body.framework || env.DEFAULT_FRAMEWORK || 'tools';
  const model = body.model || env.DEFAULT_MODEL || 'llama-4-scout';
  const dryRun = body.dry_run !== false;
  const maxIterations = body.max_iterations || parseInt(env.MAX_ITERATIONS || '30', 10);
  const timeoutMs = body.timeout_ms || parseInt(env.SANDBOX_TIMEOUT_MS || '120000', 10);
  const systemPrompt = body.system_prompt || DEFAULT_SYSTEM_PROMPT;
  const fixture = getFixture(fixtureId);
  if (!fixture) return { error: 'unknown_fixture', fixture_id: fixtureId };

  const opts = { model, userMessage: fixture.user_message, systemPrompt, env, dryRun, maxIterations, timeoutMs };
  const result = framework === 'codemode' ? await runWithCodemode(opts) : await runWithTools(opts);

  return {
    fixture_id: fixtureId,
    fixture_category: fixture.category,
    user_message: fixture.user_message,
    expected_tools: fixture.expected_tools,
    ...result,
    matched_expected: matchesExpected(result.tool_calls, fixture.expected_tools)
  };
}

async function handleRunBatch(body, env, ctx) {
  const fixtureIds = body.fixture_ids || listFixtures().map(f => f.id);
  const frameworks = body.frameworks || ['tools', 'codemode'];
  const models = body.models || ['llama-4-scout', 'claude-sonnet-4-6'];
  const concurrency = Math.min(body.concurrency || 4, 8);
  const dryRun = body.dry_run !== false;

  const tasks = [];
  for (const fid of fixtureIds) for (const fw of frameworks) for (const m of models) tasks.push({ fixture_id: fid, framework: fw, model: m });

  const results = [];
  for (let i = 0; i < tasks.length; i += concurrency) {
    const slice = tasks.slice(i, i + concurrency);
    const sliceResults = await Promise.all(slice.map(t => handleRun({ ...t, dry_run: dryRun }, env).catch(err => ({ ...t, error: err.message }))));
    results.push(...sliceResults);
  }

  return { started_at: new Date().toISOString(), total_runs: results.length, completed: results.filter(r => !r.error).length, failed: results.filter(r => r.error).length, results };
}

function matchesExpected(toolCalls, expected) {
  if (!expected || !Array.isArray(expected)) return null;
  const actual = (toolCalls || []).map(tc => tc.name);
  const expectedSet = new Set(expected);
  const allMatched = expected.every(e => actual.includes(e));
  const noUnexpected = actual.every(a => expectedSet.has(a) || a === 'code');
  return { all_expected_present: allMatched, no_unexpected_calls: noUnexpected, actual, expected, overall: allMatched && noUnexpected };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { 'content-type': 'application/json' } });
}
