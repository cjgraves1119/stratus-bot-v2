/**
 * CF Workers AI Model Benchmark
 *
 * Tests all viable text generation models against standardized prompts
 * covering: conversation, clarification, product info, intent classification.
 *
 * Deploy as a temporary route handler, hit /test-models to run.
 * Results returned as JSON + formatted markdown.
 */

// ═══════════════════════════════════════════════════════════════
// Models to test (filtered: no guard models, no <3B, no known-dead)
// ═══════════════════════════════════════════════════════════════
const MODELS = [
  { id: '@cf/google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B', size: '26B' },
  { id: '@cf/google/gemma-3-12b-it', name: 'Gemma 3 12B (current)', size: '12B' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', size: '17B' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B', size: '70B' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', name: 'Llama 3.1 8B', size: '8B' },
  { id: '@cf/qwen/qwq-32b', name: 'QwQ 32B (reasoning)', size: '32B' },
  { id: '@cf/qwen/qwen3-30b-a3b-fp8', name: 'Qwen3 30B', size: '30B' },
  { id: '@cf/qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B', size: '32B' },
  { id: '@cf/deepseek/deepseek-r1-distill-qwen-32b', name: 'DeepSeek R1 32B', size: '32B' },
  { id: '@cf/nvidia/nemotron-3-120b-a12b', name: 'Nemotron 120B', size: '120B' },
  { id: '@cf/mistralai/mistral-small-3.1-24b-instruct', name: 'Mistral Small 3.1', size: '24B' },
  { id: '@cf/ibm/granite-4.0-h-micro', name: 'Granite 4.0 Micro', size: 'micro' },
  { id: '@cf/openai/gpt-oss-120b', name: 'GPT-OSS 120B', size: '120B' },
  { id: '@cf/openai/gpt-oss-20b', name: 'GPT-OSS 20B', size: '20B' },
  { id: '@cf/zhipu/glm-4.7-flash', name: 'GLM 4.7 Flash', size: 'flash' },
];

// ═══════════════════════════════════════════════════════════════
// System prompt (same one the bot would use)
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products.

Key product knowledge:
- MX security appliances: MX67 ($595), MX67W ($695), MX68 ($795), MX68W ($895), MX75 ($2,195), MX85 ($3,995), MX95 ($7,995), MX105 ($12,995), MX250 ($19,995), MX450 ($34,995)
- MR access points: MR28 ($495), MR36H ($595), MR44 ($995), MR46 ($1,295), MR56 ($1,695), MR57 ($1,895), MR78 ($2,495)
- MS switches: MS120-8 ($595), MS130-8 ($695), MS210-24 ($2,495), MS225-24 ($3,495), MS250-24 ($4,995), MS350-24 ($6,995), MS390-24 ($7,995)
- CW Wi-Fi 7: CW9162 ($995), CW9164 ($1,495), CW9166 ($1,995), CW9172 ($2,495), CW9176 ($3,995)
- MV cameras: MV2 ($495), MV12 ($995), MV22 ($1,295), MV32 ($1,995), MV52 ($2,495), MV72 ($3,495), MV93 ($4,995)
- MT sensors: MT14 ($149), MT15 ($199), MT20 ($129), MT40 ($199)
- All hardware requires a license (1yr/3yr/5yr). Longer terms = better per-year pricing.
- All APs (MR and CW models) use Enterprise licensing (LIC-ENT-).
- MX appliances need Advanced Security (LIC-SEC-) or Enterprise (LIC-ENT-) licenses.

Be friendly, concise, and professional. Keep responses under 4 sentences unless the question requires detail. You can generate instant quotes — just tell users to say "quote [quantity] [model]".`;

// ═══════════════════════════════════════════════════════════════
// Test prompts — covering all intent categories
// ═══════════════════════════════════════════════════════════════
const TEST_PROMPTS = [
  // Conversation (should handle without Claude)
  { category: 'conversation', input: 'Hey there!', expect: 'Friendly greeting, mentions quoting capability' },
  { category: 'conversation', input: 'Thanks for the help!', expect: 'Warm acknowledgment, brief' },
  { category: 'conversation', input: 'Who are you?', expect: 'Identifies as Stratus AI, mentions Cisco/Meraki quoting' },
  { category: 'conversation', input: 'What can you do?', expect: 'Lists capabilities: quoting, pricing, product info' },

  // Clarification (ambiguous product requests)
  { category: 'clarify', input: 'How much is a MX?', expect: 'Asks which MX model, lists options with prices' },
  { category: 'clarify', input: 'I need some switches', expect: 'Asks which MS model, port count, PoE needs' },
  { category: 'clarify', input: 'Quote me some access points', expect: 'Asks which AP model (MR or CW), lists options' },
  { category: 'clarify', input: 'What cameras do you have?', expect: 'Lists MV models with brief descriptions/prices' },

  // Product info (specs, comparisons, recommendations)
  { category: 'product_info', input: 'What is the difference between MR46 and MR57?', expect: 'Accurate comparison of the two AP models' },
  { category: 'product_info', input: 'Which MX do I need for 500 users?', expect: 'Recommends MX95 or MX105 based on throughput' },
  { category: 'product_info', input: 'Are MR44 end of life?', expect: 'Provides EOL status info' },
  { category: 'product_info', input: 'Do I need a license for the MT sensors?', expect: 'Explains MT sensor licensing (free tier vs paid)' },

  // Quote requests (should extract cleanly for deterministic engine)
  { category: 'quote', input: 'Quote me 10 MR46 with 3 year licenses', expect: 'Provides pricing or quote for 10x MR46 + 3yr LIC-ENT' },
  { category: 'quote', input: 'How much for 5 MX67 and 5 MS130-8?', expect: 'Provides pricing for both products' },
  { category: 'quote', input: 'I need 2 CW9166 with 5 year enterprise', expect: 'Provides pricing for CW9166 + 5yr license' },

  // Edge cases
  { category: 'edge', input: 'Can you help me configure a VLAN?', expect: 'Politely redirects — quoting bot, not config tool' },
  { category: 'edge', input: 'asdfghjkl', expect: 'Handles gracefully, asks to clarify' },
  { category: 'edge', input: 'What is the meaning of life?', expect: 'Light humor, redirects to quoting capabilities' },
  { category: 'edge', input: '', expect: 'Handles empty input gracefully' },
];

// ═══════════════════════════════════════════════════════════════
// Test runner
// ═══════════════════════════════════════════════════════════════
async function runModelTest(model, prompt, env) {
  const startMs = Date.now();
  try {
    const result = await Promise.race([
      env.AI.run(model.id, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt.input || '(empty)' }
        ],
        max_tokens: 300
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_15S')), 15000))
    ]);
    const elapsed = Date.now() - startMs;
    const response = (result?.response || '').trim();
    return {
      model: model.name,
      modelId: model.id,
      size: model.size,
      category: prompt.category,
      input: prompt.input,
      expected: prompt.expect,
      response: response,
      responseLength: response.length,
      elapsed,
      status: response.length > 5 ? 'OK' : 'EMPTY',
      error: null
    };
  } catch (err) {
    return {
      model: model.name,
      modelId: model.id,
      size: model.size,
      category: prompt.category,
      input: prompt.input,
      expected: prompt.expect,
      response: null,
      responseLength: 0,
      elapsed: Date.now() - startMs,
      status: 'ERROR',
      error: err.message
    };
  }
}

// Run all prompts against a single model sequentially
async function benchmarkModel(model, env) {
  const results = [];
  for (const prompt of TEST_PROMPTS) {
    const result = await runModelTest(model, prompt, env);
    results.push(result);
    // Small delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  return results;
}

// ═══════════════════════════════════════════════════════════════
// HTTP handler — mount at /test-models
// ═══════════════════════════════════════════════════════════════
export async function handleModelBenchmark(request, env) {
  const url = new URL(request.url);

  // Allow testing a single model: /test-models?model=gemma-4
  const modelFilter = url.searchParams.get('model');
  // Allow testing a single category: /test-models?category=conversation
  const categoryFilter = url.searchParams.get('category');

  let modelsToTest = MODELS;
  if (modelFilter) {
    modelsToTest = MODELS.filter(m =>
      m.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase())
    );
    if (modelsToTest.length === 0) {
      return new Response(JSON.stringify({ error: `No model matching "${modelFilter}"`, available: MODELS.map(m => m.name) }), {
        headers: { 'content-type': 'application/json' }
      });
    }
  }

  let promptsToTest = TEST_PROMPTS;
  if (categoryFilter) {
    promptsToTest = TEST_PROMPTS.filter(p => p.category === categoryFilter);
  }

  const allResults = [];
  const modelSummaries = [];

  for (const model of modelsToTest) {
    console.log(`[Benchmark] Testing ${model.name}...`);
    const modelStart = Date.now();
    const results = [];

    for (const prompt of promptsToTest) {
      const result = await runModelTest(model, prompt, env);
      results.push(result);
      await new Promise(r => setTimeout(r, 100));
    }

    const modelElapsed = Date.now() - modelStart;
    const okCount = results.filter(r => r.status === 'OK').length;
    const errCount = results.filter(r => r.status === 'ERROR').length;
    const emptyCount = results.filter(r => r.status === 'EMPTY').length;
    const avgLatency = Math.round(results.filter(r => r.status === 'OK').reduce((sum, r) => sum + r.elapsed, 0) / Math.max(okCount, 1));

    modelSummaries.push({
      model: model.name,
      modelId: model.id,
      size: model.size,
      totalTests: results.length,
      ok: okCount,
      errors: errCount,
      empty: emptyCount,
      avgLatencyMs: avgLatency,
      totalTimeMs: modelElapsed
    });

    allResults.push(...results);
  }

  // Build response
  const output = {
    timestamp: new Date().toISOString(),
    totalModels: modelsToTest.length,
    totalTests: allResults.length,
    filters: { model: modelFilter, category: categoryFilter },
    summary: modelSummaries,
    results: allResults
  };

  return new Response(JSON.stringify(output, null, 2), {
    headers: { 'content-type': 'application/json' }
  });
}
