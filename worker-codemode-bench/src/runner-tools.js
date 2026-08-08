/**
 * Standard tool-calling runner.
 * Mirrors askWithWaterfall pattern. Returns a normalized result so
 * runner-codemode.js is comparable apples-to-apples.
 */

import { getToolsForToolsRunner } from './tool-surface.js';
import { callModel } from './model-clients.js';
import { executeTool } from './tool-executor.js';
import { summarizeToolResult } from './shared.js';

export async function runWithTools(opts) {
  const t0 = Date.now();
  const tools = getToolsForToolsRunner();
  const toolCalls = [];
  let iterations = 0;
  let finalReply = null;
  let success = false;
  const errors = [];
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    const messages = [{ role: 'user', content: opts.userMessage }];
    while (iterations < opts.maxIterations) {
      iterations++;
      const callResult = await callModel({
        model: opts.model, systemPrompt: opts.systemPrompt, messages, tools,
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
        const result = await executeTool({ name: tc.name, input: tc.input, env: opts.env, dryRun: opts.dryRun });
        toolCalls.push({ name: tc.name, input: tc.input, result_summary: summarizeToolResult(result), framework: 'tools' });
        toolResults.push({ id: tc.id, name: tc.name, result });
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
    framework: 'tools', model: opts.model,
    wall_ms: Date.now() - t0, tokens_in: tokensIn, tokens_out: tokensOut,
    iterations, success, final_reply: finalReply, tool_calls: toolCalls, errors,
    framework_meta: { tool_loop_hit: iterations >= opts.maxIterations }
  };
}
