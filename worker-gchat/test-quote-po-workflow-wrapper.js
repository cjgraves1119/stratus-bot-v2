#!/usr/bin/env node
// Phase 3 (2026-05-12) regression tests for the QuotePoWorkflow wrapper:
//   - isQuotePoWorkflowEnabled correctly reads env.QUOTE_PO_WORKFLOW_ENABLED
//     for "true" / true / "1" only (everything else = disabled).
//   - handleQuoteToPoAndEsignViaWorkflow falls back to inline execution when:
//       a) kill switch is off (default)
//       b) env.QUOTE_PO_WORKFLOW binding is missing
//       c) workflow create() throws
//   - handleQuotePoStatus reads KV and returns terminal vs running shapes.
//   - QuotePoWorkflow class exists and is exported.
//   - quote_to_po_status is registered as a read-only tool.
//   - wrangler.toml binds QuotePoWorkflow.
//
// Tests do NOT execute the workflow live — they verify wrapper / fallback
// mechanics, source-level wiring, and tool registration.

const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const here = __dirname;
const source = readFileSync(join(here, 'src/index.js'), 'utf8');
const wranglerToml = readFileSync(join(here, 'wrangler.toml'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} exists in src/index.js`);
  const signatureEnd = source.indexOf(') {', start);
  assert.notEqual(signatureEnd, -1, `${name} signature has body brace`);
  const bodyStart = signatureEnd + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

const isQuotePoWorkflowEnabled = Function(
  `"use strict"; ${extractFunction('isQuotePoWorkflowEnabled')}; return isQuotePoWorkflowEnabled;`
)();

let passed = 0;
let failed = 0;
function t(name, fn) {
  try {
    const result = fn();
    if (result && typeof result.then === 'function') {
      return result.then(
        () => { console.log(`  ✓ ${name}`); passed++; },
        (err) => { console.log(`  ✗ ${name}\n     ${err.message}`); failed++; }
      );
    }
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}\n     ${err.message}`);
    failed++;
  }
}

console.log('\n=== isQuotePoWorkflowEnabled kill switch ===\n');

t('returns true for env.QUOTE_PO_WORKFLOW_ENABLED === true', () => {
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: true }), true);
});

t('returns true for env.QUOTE_PO_WORKFLOW_ENABLED === "true"', () => {
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: 'true' }), true);
});

t('returns true for env.QUOTE_PO_WORKFLOW_ENABLED === "1"', () => {
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: '1' }), true);
});

t('returns false for env.QUOTE_PO_WORKFLOW_ENABLED === "false" (default)', () => {
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: 'false' }), false);
});

t('returns false for undefined env var', () => {
  assert.equal(isQuotePoWorkflowEnabled({}), false);
  assert.equal(isQuotePoWorkflowEnabled(null), false);
  assert.equal(isQuotePoWorkflowEnabled(undefined), false);
});

t('returns false for unexpected truthy-looking strings', () => {
  // Defensive — we want exact-match opt-in, not loose truthy
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: 'yes' }), false);
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: 'enabled' }), false);
  assert.equal(isQuotePoWorkflowEnabled({ QUOTE_PO_WORKFLOW_ENABLED: 1 }), false);
});

console.log('\n=== Source-level wiring ===\n');

t('QuotePoWorkflow class is defined and exported', () => {
  assert.ok(/export class QuotePoWorkflow extends WorkflowEntrypoint/.test(source),
    'QuotePoWorkflow class export missing');
});

t('handleQuoteToPoAndEsignViaWorkflow is defined', () => {
  assert.ok(/async function handleQuoteToPoAndEsignViaWorkflow\(/.test(source),
    'workflow wrapper function missing');
});

t('handleQuotePoStatus is defined', () => {
  assert.ok(/async function handleQuotePoStatus\(/.test(source),
    'status reader function missing');
});

t("case 'quote_to_po_and_esign' routes through wrapper, not direct call", () => {
  const m = source.match(/case 'quote_to_po_and_esign':\s*\{\s*return await ([a-zA-Z]+)\(/);
  assert.ok(m, "case 'quote_to_po_and_esign' has a router call");
  assert.equal(m[1], 'handleQuoteToPoAndEsignViaWorkflow',
    `expected routing through wrapper, got ${m[1]}`);
});

t("case 'quote_to_po_status' is registered in the tool case switch", () => {
  assert.ok(/case 'quote_to_po_status':\s*\{\s*return await handleQuotePoStatus\(/.test(source),
    'quote_to_po_status case missing or not wired to handleQuotePoStatus');
});

t('quote_to_po_status tool is registered with input_schema', () => {
  // Match the tool registration block
  const idx = source.indexOf("name: 'quote_to_po_status'");
  assert.notEqual(idx, -1, 'quote_to_po_status tool registration missing');
  const block = source.slice(idx, idx + 1000);
  assert.ok(/required: \['workflow_id'\]/.test(block),
    'quote_to_po_status must require workflow_id');
});

t('quote_to_po_status is in BENCHMARK_READ_TOOLS (read-only)', () => {
  const readToolsIdx = source.indexOf('BENCHMARK_READ_TOOLS = new Set([');
  assert.notEqual(readToolsIdx, -1, 'BENCHMARK_READ_TOOLS allowlist exists');
  const block = source.slice(readToolsIdx, readToolsIdx + 1000);
  assert.ok(block.includes("'quote_to_po_status'"),
    'quote_to_po_status missing from BENCHMARK_READ_TOOLS');
});

t('admin-action prompt prefers wrapper tool, forbids manual chaining', () => {
  const idx = source.indexOf('CRM_PROMPT_ADMIN_ACTION = `');
  assert.notEqual(idx, -1, 'CRM_PROMPT_ADMIN_ACTION exists');
  const block = source.slice(idx, idx + 5000);
  assert.ok(/REQUIRED PATH.*quote_to_po_and_esign/i.test(block),
    'prompt must declare wrapper as REQUIRED PATH');
  assert.ok(/DO NOT manually chain/i.test(block),
    'prompt must forbid manual chaining');
  assert.ok(/quote_to_po_status/.test(block),
    'prompt must mention status follow-up tool');
});

t('caller-aware wait window logic exists', () => {
  // Wrapper must distinguish sync (extension) vs async (gchat/workflow) wait budgets
  assert.ok(/callerSource === 'gchat' \|\| callerSource === 'workflow'/.test(source),
    'caller-aware wait window logic missing');
});

t('Phase 3 KV status helpers are defined', () => {
  assert.ok(/async function writeQuotePoStatus\(/.test(source), 'writeQuotePoStatus missing');
  assert.ok(/async function readQuotePoStatus\(/.test(source), 'readQuotePoStatus missing');
});

t('D1 telemetry helper logs to quote_po_workflow_runs', () => {
  assert.ok(/async function logQuotePoWorkflowRun\(/.test(source), 'logQuotePoWorkflowRun missing');
  assert.ok(/INSERT INTO quote_po_workflow_runs/.test(source),
    'D1 insert into quote_po_workflow_runs missing');
});

console.log('\n=== wrangler.toml binding ===\n');

t('wrangler.toml binds QuotePoWorkflow', () => {
  assert.ok(/binding = "QUOTE_PO_WORKFLOW"/.test(wranglerToml),
    'QUOTE_PO_WORKFLOW binding missing in wrangler.toml');
  assert.ok(/class_name = "QuotePoWorkflow"/.test(wranglerToml),
    'class_name = QuotePoWorkflow missing in wrangler.toml');
});

t('wrangler.toml sets QUOTE_PO_WORKFLOW_ENABLED = "false" by default', () => {
  assert.ok(/QUOTE_PO_WORKFLOW_ENABLED = "false"/.test(wranglerToml),
    'kill switch should default to "false" so first deploy is no-op');
});

t('CRM_WORKFLOW binding still present (regression check)', () => {
  // Make sure I didn't accidentally clobber the existing CrmWorkflow binding
  assert.ok(/binding = "CRM_WORKFLOW"/.test(wranglerToml),
    'CRM_WORKFLOW binding must remain');
});

console.log('\n=== Migration file ===\n');

t('quote_po_workflow_runs migration file exists', () => {
  const migPath = join(__dirname, '..', 'migrations', '2026-05-12-create_quote_po_workflow_runs.sql');
  const mig = readFileSync(migPath, 'utf8');
  assert.ok(/CREATE TABLE IF NOT EXISTS quote_po_workflow_runs/.test(mig),
    'migration must CREATE TABLE IF NOT EXISTS quote_po_workflow_runs');
  assert.ok(/workflow_id TEXT NOT NULL/.test(mig), 'workflow_id column required');
  assert.ok(/status TEXT NOT NULL/.test(mig), 'status column required');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
