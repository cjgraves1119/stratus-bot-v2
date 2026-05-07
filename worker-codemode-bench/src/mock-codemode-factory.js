/**
 * Mock factory for @cloudflare/codemode createCodeTool, used in CLI mode so
 * we can iterate without needing a deployed Worker with a worker_loaders binding.
 *
 * Differences from real Cloudflare runtime: no isolate boundary, no subrequest
 * accounting, no runtime timeout enforcement (uses AbortSignal/setTimeout),
 * no external network blocking. These don't affect directional comparison.
 */

export async function mockCodemodeFactory({ env, readTools, dryRun, timeoutMs, onRpcDispatch }) {
  const codemode = {};
  for (const tool of readTools) {
    codemode[tool.name] = async (input) => {
      const startMs = Date.now();
      const result = await mockExecuteRead({ name: tool.name, input, env, dryRun });
      if (onRpcDispatch) onRpcDispatch(tool.name, input, result, Date.now() - startMs);
      return result;
    };
  }

  return {
    name: 'code',
    description: 'Execute a JavaScript program that orchestrates read-side Stratus tools. Available methods: ' +
      readTools.map(t => `codemode.${t.name}(args)`).join(', ') +
      '. Write an async arrow function that returns a result.',
    input_schema: { type: 'object', properties: { code: { type: 'string', description: 'An async JavaScript program. Will be wrapped as an async function.' } }, required: ['code'] },
    execute: async ({ code }, options) => {
      const wrapped = `(async () => { ${code} })()`;
      // eslint-disable-next-line no-new-func
      const fn = new Function('codemode', `return ${wrapped};`);
      try {
        const result = await Promise.race([
          fn(codemode),
          new Promise((_, reject) => setTimeout(() => reject(new Error('codemode_timeout')), timeoutMs || 60000))
        ]);
        return { success: true, result };
      } catch (err) {
        return { success: false, error: err.message, error_class: err.constructor.name, program: code.slice(0, 500) };
      }
    }
  };
}

async function mockExecuteRead({ name, input, env, dryRun }) {
  const { executeTool } = await import('./tool-executor.js');
  return executeTool({ name, input, env, dryRun });
}
