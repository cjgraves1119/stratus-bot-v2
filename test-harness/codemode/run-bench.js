#!/usr/bin/env node
/**
 * Drives the deployed stratus-codemode-bench Worker through the V3 fixtures.
 * Writes JSONL for build-dashboard.js consumption.
 */

import { writeFileSync } from 'node:fs';

function parseArgs(argv) {
  const a = {
    target: null, auth: null, fixtures: null,
    frameworks: ['tools', 'codemode'], models: ['llama-4-scout'],
    output: `./results-${new Date().toISOString().slice(0, 10)}.jsonl`,
    concurrency: 2
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]; const v = argv[i + 1];
    if (k === '--target') { a.target = v; i++; }
    else if (k === '--auth') { a.auth = v; i++; }
    else if (k === '--fixtures') { a.fixtures = v.split(','); i++; }
    else if (k === '--frameworks') { a.frameworks = v.split(','); i++; }
    else if (k === '--models') { a.models = v.split(','); i++; }
    else if (k === '--output') { a.output = v; i++; }
    else if (k === '--concurrency') { a.concurrency = parseInt(v, 10); i++; }
    else if (k === '--help' || k === '-h') a.help = true;
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.target) {
    console.log('Usage: run-bench.js --target <url> [--auth <token>] [--fixtures id1,id2] [--frameworks tools,codemode] [--models llama-4-scout,claude-sonnet-4-6] [--output file.jsonl]');
    process.exit(args.help ? 0 : 1);
  }
  const auth = args.auth || process.env.STRATUS_BENCH_AUTH_TOKEN || '';

  const fixturesRes = await fetch(`${args.target}/fixtures`, { headers: auth ? { 'x-bench-auth': auth } : {} });
  if (!fixturesRes.ok) { console.error(`Failed: ${fixturesRes.status}`); process.exit(2); }
  const fixtures = (await fixturesRes.json()).fixtures;
  const ids = args.fixtures || fixtures.map(f => f.id);

  const tasks = [];
  for (const id of ids) for (const fw of args.frameworks) for (const m of args.models) tasks.push({ fixture_id: id, framework: fw, model: m });

  console.error(`Running ${tasks.length} tasks (${ids.length} × ${args.frameworks.length} × ${args.models.length}) concurrency=${args.concurrency}`);

  const results = [];
  const startedAt = Date.now();
  for (let i = 0; i < tasks.length; i += args.concurrency) {
    const slice = tasks.slice(i, i + args.concurrency);
    const sliceResults = await Promise.all(slice.map(async (task) => {
      const t0 = Date.now();
      try {
        const res = await fetch(`${args.target}/run`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(auth ? { 'x-bench-auth': auth } : {}) },
          body: JSON.stringify({ ...task, dry_run: true })
        });
        const body = await res.json();
        return { ...task, status: res.status, ...body, harness_wall_ms: Date.now() - t0 };
      } catch (err) {
        return { ...task, error: err.message, harness_wall_ms: Date.now() - t0 };
      }
    }));
    for (const r of sliceResults) {
      results.push(r);
      const ok = r.success && (r.status === undefined || r.status === 200);
      process.stderr.write(`[${results.length}/${tasks.length}] ${r.fixture_id} ${r.framework} ${r.model} ${ok ? '✓' : '✗'} ${r.wall_ms || r.harness_wall_ms}ms\n`);
    }
  }

  writeFileSync(args.output, results.map(r => JSON.stringify(r)).join('\n') + '\n');
  console.error(`\nWrote ${results.length} rows to ${args.output} (${((Date.now() - startedAt) / 60000).toFixed(2)} min)`);
  printSummary(results);
}

function printSummary(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.framework}::${r.model}`;
    if (!groups.has(key)) groups.set(key, { ok: 0, fail: 0, wall: 0, tin: 0, tout: 0, iter: 0, count: 0 });
    const g = groups.get(key);
    g.count++; if (r.success) g.ok++; else g.fail++;
    g.wall += r.wall_ms || 0; g.tin += r.tokens_in || 0; g.tout += r.tokens_out || 0; g.iter += r.iterations || 0;
  }
  console.error('\n--- Summary ---');
  for (const [key, g] of groups) {
    const pct = ((g.ok / g.count) * 100).toFixed(1);
    console.error(`${key.padEnd(40)} ${pct}% ok  avg ${(g.wall / g.count).toFixed(0)}ms  in ${(g.tin / g.count).toFixed(0)}t  out ${(g.tout / g.count).toFixed(0)}t  iter ${(g.iter / g.count).toFixed(1)}`);
  }
}

main().catch(err => { console.error('Harness error:', err); process.exit(1); });
