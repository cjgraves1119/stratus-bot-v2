#!/usr/bin/env node
/**
 * Local CLI for the bench. Runs without Cloudflare runtime.
 * Uses mockCodemodeFactory in code-mode runs (no real Worker sandbox).
 */

import { runWithTools } from './runner-tools.js';
import { runWithCodemode } from './runner-codemode.js';
import { listFixtures, getFixture } from './fixtures.js';
import { mockCodemodeFactory } from './mock-codemode-factory.js';

function parseArgs(argv) {
  const args = { fixture: null, framework: 'tools', model: 'llama-4-scout', batch: false, output: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i]; const next = argv[i + 1];
    if (a === '--fixture') { args.fixture = next; i++; }
    else if (a === '--framework') { args.framework = next; i++; }
    else if (a === '--frameworks') { args.frameworks = next.split(','); i++; }
    else if (a === '--model') { args.model = next; i++; }
    else if (a === '--models') { args.models = next.split(','); i++; }
    else if (a === '--batch') args.batch = true;
    else if (a === '--output') { args.output = next; i++; }
    else if (a === '--list') args.list = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`
stratus-codemode-bench CLI

Single fixture:
  node src/cli.js --fixture fix_004 --framework codemode --model llama-4-scout

Batch (cartesian product):
  node src/cli.js --batch --frameworks tools,codemode --models llama-4-scout,claude-sonnet-4-6 --output results.jsonl

List fixtures:  node src/cli.js --list

Env: ANTHROPIC_API_KEY, GCHAT_URL, GCHAT_AUTH
`);
}

async function runOne({ fixture_id, framework, model, env }) {
  const fixture = getFixture(fixture_id);
  if (!fixture) throw new Error(`Unknown fixture: ${fixture_id}`);
  const opts = {
    model, userMessage: fixture.user_message,
    systemPrompt: 'You are the Stratus AI CRM assistant. Use the provided tools to answer the user.',
    env, dryRun: true, maxIterations: 30, timeoutMs: 120000,
    codemodeFactory: framework === 'codemode' ? mockCodemodeFactory : undefined
  };
  const result = framework === 'codemode' ? await runWithCodemode(opts) : await runWithTools(opts);
  return { fixture_id, fixture_category: fixture.category, expected_tools: fixture.expected_tools, framework, model, ...result };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) return printHelp();
  if (args.list) { console.table(listFixtures()); return; }

  const env = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    GCHAT_URL: process.env.GCHAT_URL,
    GCHAT_AUTH: process.env.GCHAT_AUTH
  };

  if (args.batch) {
    const fixtureIds = listFixtures().map(f => f.id);
    const frameworks = args.frameworks || ['tools', 'codemode'];
    const models = args.models || ['llama-4-scout'];
    const results = [];
    for (const fid of fixtureIds) {
      for (const fw of frameworks) {
        for (const m of models) {
          process.stderr.write(`▶ ${fid} ${fw} ${m}... `);
          const t0 = Date.now();
          try {
            const r = await runOne({ fixture_id: fid, framework: fw, model: m, env });
            results.push(r);
            process.stderr.write(`${Date.now() - t0}ms ${r.success ? 'ok' : 'FAIL'}\n`);
          } catch (err) {
            results.push({ fixture_id: fid, framework: fw, model: m, success: false, errors: [{ phase: 'cli', error: err.message }] });
            process.stderr.write(`exception: ${err.message}\n`);
          }
        }
      }
    }
    if (args.output) {
      const fs = await import('node:fs');
      fs.writeFileSync(args.output, results.map(r => JSON.stringify(r)).join('\n'));
      process.stderr.write(`\nWrote ${results.length} rows to ${args.output}\n`);
    } else {
      console.log(JSON.stringify(results, null, 2));
    }
    return;
  }

  if (!args.fixture) { printHelp(); process.exit(1); }
  const result = await runOne({ fixture_id: args.fixture, framework: args.framework, model: args.model, env });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => { console.error('CLI error:', err); process.exit(1); });
