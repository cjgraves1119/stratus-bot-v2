/**
 * Code Mode runner.
 * Wraps the read tool surface with @cloudflare/codemode createCodeTool. Model
 * sees one `code` tool plus the write tools as standard tool calls (Cloudflare
 * needsApproval limitation — destructive ops can't live in the sandbox).
 */

import { getToolsForCodemodeRunner } from './tool-surface.js';
import { callModel } from './model-clients.js';
import { executeTool } from './tool-executor.js';
import { summarizeToolResult } from './shared.js';

export async function runWithCodemode(opts) {
  const t0 = Date.now();
  const { codemodeWrappedReadTools, standardWriteTools } = getToolsForCodemodeRunner();
  const toolCalls = [];
  let iterations = 0;
  let finalReply = null;
  let success = false;
  const errors = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let codemodeProgramLines = 0;
  let codemodeRpcDispatches = 0;
  let codemodeSandboxWallMs = 0;

  try {
    const codemodeTool = await buildCodemodeTool({
      env: opts.env, readTools: codemodeWrappedReadTools, dryRun: opts.dryRun, timeoutMs: opts.timeoutMs,
      onRpcDispatch: (toolName, input, result, sandboxMs) => {
        codemodeRpcDispatches++;
        codemodeSandboxWallMs += sandboxMs;
        toolCalls.push({ name: toolName, input, result_summary: summarizeToolResult(result), framework: 'codemode', via_sandbox: true });
      },
      factory: opts.codemodeFactory
    });

    const tools = [codemodeTool, ...standardWriteTools];
    const messages = [{ role: 'user', content: opts.userMessage }];

    while (iterations < opts.maxIterations) {
      iterations++;
      const callResult = await callModel({
        model: opts.model, systemPrompt: appendCodemodeSystemHint(opts.systemPrompt), messages, tools,
        env: opts.env, timeoutMs: opts.timeoutMs - (Date.now() - t0)
      });
      tokensIn += callResult.usage?.input_tokens || 0;
      tokensOut += callResult.usage?.output_tokens || 0;

      if (!callResult.toolCalls || callResult.toolCalls.length === 0) {
        finalReply = callResult.reply;
        success = true;
        break;
      }

      const toolResults = [];
      for (const tc of callResult.toolCalls) {
        if (tc.name === 'code') {
          const programResult = await executeCodemodeProgram({
            program: tc.input.code, codemodeTool, timeoutMs: opts.timeoutMs - (Date.now() - t0)
          });
          codemodeProgramLines += String(tc.input.code || '').split('\n').length;
          toolResults.push({ id: tc.id, name: 'code', result: programResult });
          toolCalls.push({ name: 'code', input: { code_lines: codemodeProgramLines }, result_summary: summarizeToolResult(programResult), framework: 'codemode', via_sandbox: false });
        } else {
          const result = await executeTool({ name: tc.name, input: tc.input, env: opts.env, dryRun: opts.dryRun });
          toolCalls.push({ name: tc.name, input: tc.input, result_summary: summarizeToolResult(result), framework: 'tools', via_sandbox: false });
          toolResults.push({ id: tc.id, name: tc.name, result });
        }
      }

      messages.push({ role: 'assistant', content: callResult.raw });
      messages.push({
        role: 'user',
        content: toolResults.map(t => ({ type: 'tool_result', tool_use_id: t.id, content: JSON.stringify(t.result).slice(0, 4000) }))
      });
    }
    if (iterations >= opts.maxIterations && !success) {
      errors.push({ phase: 'iteration_limit', reason: `Hit max ${opts.maxIterations} iterations without final reply` });
    }
  } catch (err) {
    errors.push({ phase: 'runner_exception', error: err.message });
  }

  return {
    framework: 'codemode', model: opts.model,
    wall_ms: Date.now() - t0, tokens_in: tokensIn, tokens_out: tokensOut,
    iterations, success, final_reply: finalReply, tool_calls: toolCalls, errors,
    framework_meta: {
      codemode_program_lines: codemodeProgramLines,
      codemode_rpc_dispatches: codemodeRpcDispatches,
      codemode_sandbox_wall_ms: codemodeSandboxWallMs,
      tool_loop_hit: iterations >= opts.maxIterations
    }
  };
}

async function buildCodemodeTool({ env, readTools, dryRun, timeoutMs, onRpcDispatch, factory }) {
  const useFactory = factory || defaultCodemodeFactory;
  return useFactory({ env, readTools, dryRun, timeoutMs, onRpcDispatch });
}

async function defaultCodemodeFactory({ env, readTools, dryRun, timeoutMs, onRpcDispatch }) {
  const { createCodeTool } = await import('@cloudflare/codemode/ai');
  const { DynamicWorkerExecutor } = await import('@cloudflare/codemode');
  const wrappedTools = {};
  for (const tool of readTools) {
    wrappedTools[tool.name] = {
      description: tool.description,
      inputSchema: tool.input_schema,
      execute: async (input) => {
        const startMs = Date.now();
        const result = await executeTool({ name: tool.name, input, env, dryRun });
        if (onRpcDispatch) onRpcDispatch(tool.name, input, result, Date.now() - startMs);
        return result;
      }
    };
  }
  const executor = new DynamicWorkerExecutor({ loader: env.LOADER, timeout: timeoutMs });
  return createCodeTool({ tools: wrappedTools, executor });
}

async function executeCodemodeProgram({ program, codemodeTool, timeoutMs }) {
  if (!codemodeTool || typeof codemodeTool.execute !== 'function') throw new Error('codemode tool not constructed');
  return codemodeTool.execute({ code: program }, { abortSignal: AbortSignal.timeout(timeoutMs) });
}

function appendCodemodeSystemHint(systemPrompt) {
  return (systemPrompt || '') + '\n\n' +
    'You have access to a `code` tool that runs JavaScript in a secure sandbox. ' +
    'Inside the sandbox you can call read-side Stratus operations as `codemode.toolName(args)` and chain them with normal control flow. ' +
    'Prefer ONE call to `code` with a multi-step program over many sequential tool calls. ' +
    'Destructive actions (creating, updating, deleting, sending) are NOT in the sandbox — use the standard tool calls for those AFTER the code program returns.';
}
