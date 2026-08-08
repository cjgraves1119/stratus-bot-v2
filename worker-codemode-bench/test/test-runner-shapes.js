#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mockCodemodeFactory } from '../src/mock-codemode-factory.js';

const expectedShape = {
  framework: 'string', model: 'string',
  wall_ms: 'number', tokens_in: 'number', tokens_out: 'number',
  iterations: 'number', success: 'boolean',
  final_reply: ['string', 'object'],
  tool_calls: 'array', errors: 'array', framework_meta: 'object'
};

function assertShape(result, label) {
  for (const [key, type] of Object.entries(expectedShape)) {
    if (Array.isArray(type)) {
      const actual = typeof result[key];
      assert.ok(type.includes(actual) || result[key] === null, `${label}: ${key} expected one of ${type.join('|')}, got ${actual}`);
    } else if (type === 'array') {
      assert.ok(Array.isArray(result[key]), `${label}: ${key} should be array`);
    } else if (type === 'object') {
      assert.ok(typeof result[key] === 'object' && result[key] !== null, `${label}: ${key} should be object`);
    } else {
      assert.equal(typeof result[key], type, `${label}: ${key} should be ${type}`);
    }
  }
}

const sampleTools = { framework: 'tools', model: 'llama-4-scout', wall_ms: 1234, tokens_in: 100, tokens_out: 20, iterations: 1, success: true, final_reply: 'ok', tool_calls: [], errors: [], framework_meta: { tool_loop_hit: false } };
assertShape(sampleTools, 'tools-runner sample');

const sampleCm = { framework: 'codemode', model: 'llama-4-scout', wall_ms: 1234, tokens_in: 100, tokens_out: 20, iterations: 1, success: true, final_reply: 'ok', tool_calls: [{ name: 'code', framework: 'codemode', via_sandbox: false }], errors: [], framework_meta: { codemode_program_lines: 5, codemode_rpc_dispatches: 2, codemode_sandbox_wall_ms: 800, tool_loop_hit: false } };
assertShape(sampleCm, 'codemode-runner sample');

const mockTool = await mockCodemodeFactory({ env: {}, readTools: [{ name: 'foo', description: 'foo', input_schema: { type: 'object' } }], dryRun: true, timeoutMs: 5000, onRpcDispatch: () => {} });
assert.equal(mockTool.name, 'code');
assert.ok(mockTool.input_schema?.properties?.code, 'mock tool exposes code input field');
assert.ok(typeof mockTool.execute === 'function', 'mock tool has execute');

const programResult = await mockTool.execute({ code: 'return 42;' }, { abortSignal: AbortSignal.timeout(2000) });
assert.equal(programResult.success, true);
assert.equal(programResult.result, 42);

const programWithCodemode = await mockTool.execute({ code: 'const r = await codemode.foo({}); return r;' }, { abortSignal: AbortSignal.timeout(2000) });
assert.equal(programWithCodemode.success, true);
assert.ok(programWithCodemode.result, 'codemode call inside program returns a result');

console.log('test-runner-shapes: ok');
