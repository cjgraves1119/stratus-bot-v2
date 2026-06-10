/**
 * CF Workers AI Model Benchmark — Local Runner
 *
 * Calls Cloudflare Workers AI REST API directly (no deploy needed).
 * Tests all viable text generation models against standardized prompts.
 *
 * Usage: node benchmark-models.js [--model gemma-4] [--category conversation]
 */

// Calls the /test-model endpoint on the deployed worker
const WORKER_URL = 'https://stratus-ai-bot.chrisg-ec1.workers.dev/test-model';

// ═══════════════════════════════════════════════════════════════
// Models to test
// ═══════════════════════════════════════════════════════════════
const MODELS = [
  { id: '@cf/google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B', size: '26B' },
  { id: '@cf/google/gemma-3-12b-it', name: 'Gemma 3 12B (current)', size: '12B' },
  { id: '@cf/meta/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B', size: '17B' },
  { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B', size: '70B' },
  { id: '@cf/meta/llama-3.1-8b-instruct-fp8', name: 'Llama 3.1 8B', size: '8B' },
  { id: '@cf/qwen/qwq-32b', name: 'QwQ 32B', size: '32B' },
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
// System prompt with embedded product data
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are Stratus AI, the internal quoting assistant for Stratus Information Systems, a Cisco-exclusive reseller specializing in Meraki networking products.

Key product knowledge:
- MX security appliances: MX67 ($595), MX67W ($695), MX68 ($795), MX68W ($895), MX75 ($2,195), MX85 ($3,995), MX95 ($7,995), MX105 ($12,995), MX250 ($19,995), MX450 ($34,995)
- MR access points: MR28 ($495), MR36H ($595), MR44 ($995), MR46 ($1,295), MR56 ($1,695), MR57 ($1,895), MR78 ($2,495)
- MS switches: MS120-8 ($595), MS130-8 ($695), MS210-24 ($2,495), MS225-24 ($3,495), MS250-24 ($4,995), MS350-24 ($6,995), MS390-24 ($7,995)
- CW Wi-Fi 7 APs: CW9162 ($995), CW9164 ($1,495), CW9166 ($1,995), CW9172 ($2,495), CW9176 ($3,995)
- MV cameras: MV2 ($495), MV12 ($995), MV22 ($1,295), MV32 ($1,995), MV52 ($2,495), MV72 ($3,495), MV93 ($4,995)
- MT sensors: MT14 ($149), MT15 ($199), MT20 ($129), MT40 ($199)
- MX sizing: MX67/68 (50 users), MX75 (200), MX85 (600), MX95 (2000), MX105 (5000), MX250 (10000), MX450 (unlimited)
- All hardware requires a license (1yr/3yr/5yr). Longer terms = better per-year pricing.
- All APs (MR and CW models) use Enterprise licensing (LIC-ENT-).
- MX appliances need Advanced Security (LIC-SEC-) or Enterprise (LIC-ENT-) licenses.
- MT sensors have a free tier (up to 100 sensors per org, no license needed).
- MR44 is end of sale (replaced by CW9164). MR36H still available.

Be friendly, concise, and professional. Keep responses under 4 sentences unless the question requires detail. You can generate instant quotes — just tell users to say "quote [quantity] [model]".`;

// ═══════════════════════════════════════════════════════════════
// Test prompts
// ═══════════════════════════════════════════════════════════════
const TEST_PROMPTS = [
  // Conversation
  { category: 'conversation', input: 'Hey there!', expect: 'Friendly greeting, mentions quoting capability' },
  { category: 'conversation', input: 'Thanks for the help!', expect: 'Warm acknowledgment, brief' },
  { category: 'conversation', input: 'Who are you?', expect: 'Identifies as Stratus AI, mentions Cisco/Meraki' },
  { category: 'conversation', input: 'What can you do?', expect: 'Lists capabilities: quoting, pricing, product info' },

  // Clarification
  { category: 'clarify', input: 'How much is a MX?', expect: 'Asks which MX model, lists options with prices' },
  { category: 'clarify', input: 'I need some switches', expect: 'Asks which MS model, port count, PoE needs' },
  { category: 'clarify', input: 'Quote me some access points', expect: 'Asks which AP model (MR or CW), lists options' },
  { category: 'clarify', input: 'What cameras do you have?', expect: 'Lists MV models with prices' },

  // Product info
  { category: 'product_info', input: 'What is the difference between MR46 and MR57?', expect: 'Comparison of the two AP models' },
  { category: 'product_info', input: 'Which MX do I need for 500 users?', expect: 'Recommends MX85 based on sizing chart' },
  { category: 'product_info', input: 'Is the MR44 end of life?', expect: 'Confirms MR44 is EoS, mentions CW9164 replacement' },
  { category: 'product_info', input: 'Do I need a license for MT sensors?', expect: 'Explains MT free tier (100 sensors)' },

  // Quote requests
  { category: 'quote', input: 'Quote me 10 MR46 with 3 year licenses', expect: 'Provides pricing for 10x MR46 + 3yr LIC-ENT' },
  { category: 'quote', input: 'How much for 5 MX67 and 5 MS130-8?', expect: 'Prices for both products' },
  { category: 'quote', input: 'I need 2 CW9166 with 5 year enterprise', expect: 'Pricing for CW9166 + 5yr license' },

  // Edge cases
  { category: 'edge', input: 'Can you help me configure a VLAN?', expect: 'Politely redirects — quoting bot, not config tool' },
  { category: 'edge', input: 'asdfghjkl', expect: 'Handles gracefully, asks to clarify' },
  { category: 'edge', input: 'What is the meaning of life?', expect: 'Light humor, redirects to quoting' },
  { category: 'edge', input: '', expect: 'Handles empty input gracefully' },
];

// ═══════════════════════════════════════════════════════════════
// API caller
// ═══════════════════════════════════════════════════════════════
const { execSync } = require('child_process');

function callWorkersAISync(modelId, messages) {
  const payload = JSON.stringify({ modelId, messages });
  // Escape single quotes in payload for shell
  const escaped = payload.replace(/'/g, "'\\''");
  const cmd = `curl -s -m 25 -X POST '${WORKER_URL}' -H 'Content-Type: application/json' -d '${escaped}'`;

  try {
    const stdout = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    const data = JSON.parse(stdout);
    return {
      response: data.response || null,
      elapsed: data.elapsed || 0,
      error: data.error || null
    };
  } catch (err) {
    return { response: null, elapsed: 0, error: err.message?.substring(0, 100) || 'curl failed' };
  }
}

// Wrap sync in async for compatibility
async function callWorkersAI(modelId, messages) {
  return callWorkersAISync(modelId, messages);
}

// ═══════════════════════════════════════════════════════════════
// Scoring heuristics
// ═══════════════════════════════════════════════════════════════
function scoreResponse(result, prompt) {
  if (!result.response || result.response.length < 5) return 0;

  let score = 5; // Base: got a response
  const r = result.response.toLowerCase();
  const expectWords = prompt.expect.toLowerCase().split(/[\s,]+/);

  // Length check: penalize overly verbose (>500 chars for conversation)
  if (prompt.category === 'conversation' && result.response.length > 500) score -= 1;
  // Penalize very short for product_info/clarify
  if ((prompt.category === 'product_info' || prompt.category === 'clarify') && result.response.length < 30) score -= 2;

  // Keyword relevance
  const keyHits = expectWords.filter(w => w.length > 3 && r.includes(w)).length;
  score += Math.min(keyHits, 3); // up to +3

  // Category-specific checks
  if (prompt.category === 'conversation') {
    // Should be concise and friendly
    if (result.response.length < 300) score += 1;
    if (r.includes('stratus') || r.includes('quote') || r.includes('meraki')) score += 1;
  }

  if (prompt.category === 'clarify') {
    // Should list specific models
    if (r.includes('mx67') || r.includes('mx68') || r.includes('mr46') || r.includes('ms130') || r.includes('mv') || r.includes('cw91')) score += 2;
    // Should ask a question
    if (r.includes('?')) score += 1;
  }

  if (prompt.category === 'product_info') {
    // Should reference the system prompt data
    if (r.includes('$') || r.includes('price') || r.includes('user')) score += 1;
    // MR44 EOL check
    if (prompt.input.includes('MR44') && (r.includes('end of') || r.includes('eol') || r.includes('eos') || r.includes('cw9164') || r.includes('replaced'))) score += 2;
    // MT free tier check
    if (prompt.input.includes('MT') && (r.includes('free') || r.includes('100'))) score += 2;
    // MX sizing check
    if (prompt.input.includes('500 users') && (r.includes('mx85') || r.includes('mx95'))) score += 2;
  }

  if (prompt.category === 'quote') {
    // Should include pricing or dollar amounts
    if (r.includes('$')) score += 2;
    // Should reference the right product
    if (prompt.input.includes('MR46') && r.includes('mr46')) score += 1;
    if (prompt.input.includes('MX67') && r.includes('mx67')) score += 1;
    if (prompt.input.includes('CW9166') && r.includes('cw9166')) score += 1;
  }

  if (prompt.category === 'edge') {
    // Should handle gracefully
    if (prompt.input === 'asdfghjkl' && (r.includes('clarif') || r.includes('understand') || r.includes('help') || r.includes('?'))) score += 2;
    if (prompt.input.includes('VLAN') && (r.includes('quot') || r.includes('special') || r.includes('help') || r.includes('pricing'))) score += 1;
  }

  // Latency bonus: under 3s = +1, under 5s = +0, over 8s = -1
  if (result.elapsed < 3000) score += 1;
  if (result.elapsed > 8000) score -= 1;

  return Math.max(0, Math.min(10, score));
}

// ═══════════════════════════════════════════════════════════════
// Main runner
// ═══════════════════════════════════════════════════════════════
async function main() {
  const args = process.argv.slice(2);
  let modelFilter = null;
  let categoryFilter = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) modelFilter = args[++i];
    if (args[i] === '--category' && args[i + 1]) categoryFilter = args[++i];
  }

  let modelsToTest = MODELS;
  if (modelFilter) {
    modelsToTest = MODELS.filter(m =>
      m.name.toLowerCase().includes(modelFilter.toLowerCase()) ||
      m.id.toLowerCase().includes(modelFilter.toLowerCase())
    );
    if (modelsToTest.length === 0) {
      console.error(`No model matching "${modelFilter}"`);
      process.exit(1);
    }
  }

  let promptsToTest = TEST_PROMPTS;
  if (categoryFilter) {
    promptsToTest = TEST_PROMPTS.filter(p => p.category === categoryFilter);
  }

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`  CF Workers AI Model Benchmark`);
  console.log(`  Models: ${modelsToTest.length} | Prompts: ${promptsToTest.length} | Total calls: ${modelsToTest.length * promptsToTest.length}`);
  console.log(`${'═'.repeat(70)}\n`);

  const allResults = [];
  const modelScores = {};

  for (const model of modelsToTest) {
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`  Testing: ${model.name} (${model.size})`);
    console.log(`  ID: ${model.id}`);
    console.log(`${'─'.repeat(50)}`);

    modelScores[model.name] = { scores: [], latencies: [], errors: 0, empty: 0 };

    for (const prompt of promptsToTest) {
      const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt.input || '(empty message)' }
      ];

      const result = await callWorkersAI(model.id, messages);

      if (result.error) {
        console.log(`  ❌ [${prompt.category}] "${prompt.input}" → ERROR: ${result.error.substring(0, 80)}`);
        modelScores[model.name].errors++;
        allResults.push({ model: model.name, size: model.size, ...prompt, ...result, score: 0 });

        // If first prompt fails with "No such model", skip remaining
        if (result.error.includes('No such model') || result.error.includes('could not resolve')) {
          console.log(`  ⚠️  Model not available, skipping remaining prompts.`);
          for (let i = 1; i < promptsToTest.length; i++) {
            modelScores[model.name].errors++;
          }
          break;
        }
      } else if (!result.response || result.response.length < 5) {
        console.log(`  ⬜ [${prompt.category}] "${prompt.input}" → EMPTY (${result.elapsed}ms)`);
        modelScores[model.name].empty++;
        allResults.push({ model: model.name, size: model.size, ...prompt, ...result, score: 0 });
      } else {
        const score = scoreResponse(result, prompt);
        modelScores[model.name].scores.push(score);
        modelScores[model.name].latencies.push(result.elapsed);

        const truncated = result.response.substring(0, 120).replace(/\n/g, ' ');
        console.log(`  ✅ [${prompt.category}] "${prompt.input}" → ${score}/10 (${result.elapsed}ms)`);
        console.log(`     "${truncated}${result.response.length > 120 ? '...' : ''}"`);

        allResults.push({ model: model.name, size: model.size, ...prompt, ...result, score });
      }

      // Rate limit buffer
      await new Promise(r => setTimeout(r, 300));
    }

    // Model summary
    const ms = modelScores[model.name];
    const avgScore = ms.scores.length > 0 ? (ms.scores.reduce((a, b) => a + b, 0) / ms.scores.length).toFixed(1) : 'N/A';
    const avgLatency = ms.latencies.length > 0 ? Math.round(ms.latencies.reduce((a, b) => a + b, 0) / ms.latencies.length) : 'N/A';
    console.log(`\n  📊 ${model.name}: Avg Score ${avgScore}/10 | Avg Latency ${avgLatency}ms | Errors: ${ms.errors} | Empty: ${ms.empty}`);
  }

  // ═══════════════════════════════════════════════════════════════
  // Final leaderboard
  // ═══════════════════════════════════════════════════════════════
  console.log(`\n\n${'═'.repeat(70)}`);
  console.log(`  LEADERBOARD`);
  console.log(`${'═'.repeat(70)}`);

  const leaderboard = Object.entries(modelScores)
    .map(([name, data]) => ({
      name,
      avgScore: data.scores.length > 0 ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length : 0,
      avgLatency: data.latencies.length > 0 ? Math.round(data.latencies.reduce((a, b) => a + b, 0) / data.latencies.length) : 999999,
      ok: data.scores.length,
      errors: data.errors,
      empty: data.empty,
      total: promptsToTest.length
    }))
    .sort((a, b) => b.avgScore - a.avgScore || a.avgLatency - b.avgLatency);

  console.log(`\n  ${'Rank'.padEnd(5)} ${'Model'.padEnd(28)} ${'Score'.padEnd(8)} ${'Latency'.padEnd(10)} ${'OK'.padEnd(5)} ${'Err'.padEnd(5)} ${'Empty'.padEnd(5)}`);
  console.log(`  ${'─'.repeat(66)}`);

  leaderboard.forEach((m, i) => {
    const rank = `#${i + 1}`;
    const scoreStr = m.ok > 0 ? `${m.avgScore.toFixed(1)}/10` : 'FAIL';
    const latStr = m.avgLatency < 999999 ? `${m.avgLatency}ms` : 'N/A';
    console.log(`  ${rank.padEnd(5)} ${m.name.padEnd(28)} ${scoreStr.padEnd(8)} ${latStr.padEnd(10)} ${String(m.ok).padEnd(5)} ${String(m.errors).padEnd(5)} ${String(m.empty).padEnd(5)}`);
  });

  // Save full results to JSON
  const outputPath = './benchmark-results.json';
  const fs = await import('fs');
  fs.writeFileSync(outputPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    leaderboard,
    results: allResults
  }, null, 2));
  console.log(`\n  📁 Full results saved to ${outputPath}`);
  console.log(`${'═'.repeat(70)}\n`);
}

main().catch(console.error);
