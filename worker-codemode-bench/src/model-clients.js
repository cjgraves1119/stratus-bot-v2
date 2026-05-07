/**
 * Model dispatch — same call shape used by both runners so the comparison
 * is apples-to-apples. Returns normalized:
 *   { reply, toolCalls: [{id,name,input}], raw, usage: {input_tokens, output_tokens} }
 */

const MODEL_REGISTRY = {
  'claude-sonnet-4-6': { provider: 'anthropic', apiModel: 'claude-sonnet-4-6' },
  'llama-4-scout':     { provider: 'cf-workers-ai', apiModel: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  'gemma-4-26b':       { provider: 'cf-workers-ai', apiModel: '@cf/google/gemma-4-26b-a4b-it' }
};

export async function callModel({ model, systemPrompt, messages, tools, env, timeoutMs }) {
  const config = MODEL_REGISTRY[model];
  if (!config) throw new Error(`Unknown model: ${model}`);
  if (config.provider === 'anthropic') return callAnthropic({ apiModel: config.apiModel, systemPrompt, messages, tools, env, timeoutMs });
  if (config.provider === 'cf-workers-ai') return callWorkersAi({ apiModel: config.apiModel, systemPrompt, messages, tools, env, timeoutMs });
  throw new Error(`Unknown provider: ${config.provider}`);
}

async function callAnthropic({ apiModel, systemPrompt, messages, tools, env, timeoutMs }) {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs || 60000));
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: apiModel, max_tokens: 4096, system: systemPrompt, tools: anthropicToolShape(tools), messages }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 500)}`);
    const json = await res.json();
    return {
      reply: (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'),
      toolCalls: (json.content || []).filter(c => c.type === 'tool_use').map(c => ({ id: c.id, name: c.name, input: c.input })),
      raw: json.content,
      usage: { input_tokens: json.usage?.input_tokens || 0, output_tokens: json.usage?.output_tokens || 0 }
    };
  } finally { clearTimeout(timer); }
}

async function callWorkersAi({ apiModel, systemPrompt, messages, tools, env, timeoutMs }) {
  if (!env.AI) throw new Error('Workers AI binding (env.AI) not available');
  const wMessages = [
    { role: 'system', content: systemPrompt || '' },
    ...messages.map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
  ];
  const result = await env.AI.run(apiModel, { messages: wMessages, tools: workersAiToolShape(tools), max_tokens: 4096 });
  return {
    reply: result.response || '',
    toolCalls: (result.tool_calls || []).map((tc, idx) => ({ id: `tc_${idx}`, name: tc.name || tc.function?.name, input: tc.arguments || tc.function?.arguments || {} })),
    raw: result,
    usage: { input_tokens: result.usage?.prompt_tokens || 0, output_tokens: result.usage?.completion_tokens || 0 }
  };
}

function anthropicToolShape(tools) {
  return (tools || []).map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema || t.inputSchema || { type: 'object', properties: {} } }));
}

function workersAiToolShape(tools) {
  return (tools || []).map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.input_schema || t.inputSchema || { type: 'object', properties: {} } } }));
}
