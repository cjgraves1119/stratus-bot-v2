/**
 * A/B Vision Comparison: Anthropic Claude vs Cloudflare Workers AI
 * Tests dashboard screenshot parsing accuracy, latency, and cost.
 *
 * Claude path: calls deployed GChat worker /api/parse-dashboard (production path)
 * CF Workers AI: calls Llama 3.2 11B Vision directly via REST API
 *
 * Usage: node compare-vision.js [path-to-image.png]
 */

const fs = require('fs');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────────
const CF_ACCOUNT_ID = 'ec1888c5a0b51dc3eebf6bae13a3922b';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
if (!CF_API_TOKEN) {
  console.error('ERROR: CLOUDFLARE_API_TOKEN env var is required');
  process.exit(1);
}

// Production GChat worker (already has ANTHROPIC_API_KEY as secret)
const GCHAT_WORKER_URL = 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev';

// CF Workers AI vision model
const CF_VISION_URL = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.2-11b-vision-instruct`;

// ─── Ground Truth (from the actual Meraki dashboard screenshot) ────────────────
const GROUND_TRUTH = {
  licenseStatus: 'Ok',
  licenseModel: 'Co-termination',
  expiration: 'May 18, 2026',
  mxEdition: 'Advanced Security',
  mrEdition: 'Enterprise',
  devices: [
    { name: 'MG51/MG51E', limit: '1', count: '1' },
    { name: 'MR Enterprise', limit: '2', count: '2' },
    { name: 'MS220-8P', limit: '2', count: '2' },
    { name: 'MT', limit: '5 free', count: '0' },
    { name: 'MX60', limit: '1', count: '1' },
    { name: 'MX60W', limit: '1', count: '1' },
    { name: 'MX64W', limit: '1', count: '1' },
    { name: 'MX65', limit: '1', count: '1' },
    { name: 'MX65W', limit: '1', count: '1' },
    { name: 'MX75', limit: '1', count: '1' },
    { name: 'Z1', limit: '1', count: '1' },
    { name: 'Z4', limit: '1', count: '1' },
  ]
};

// Structured extraction prompt (used for both)
const EXTRACTION_PROMPT = `Analyze this Meraki license dashboard screenshot. Extract ALL information in this exact JSON format:
{
  "licenseStatus": "Ok or other status",
  "licenseModel": "Co-termination or Per-device",
  "expiration": "date string",
  "mxEdition": "edition name",
  "mrEdition": "edition name",
  "devices": [
    {"name": "device/license name exactly as shown", "limit": "license limit value", "count": "current device count"}
  ]
}
Return ONLY the JSON object, no other text.`;

// ─── Test A: Claude via deployed GChat worker ──────────────────────────────────
async function testClaude(base64Image, mediaType) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST A: Claude Sonnet (via GChat worker /api/parse-dashboard)');
  console.log('══════════════════════════════════════════════════');

  const start = Date.now();

  const body = {
    action: '/api/parse-dashboard',
    imageBase64: base64Image,
    mediaType: mediaType,
    instructions: EXTRACTION_PROMPT
  };

  try {
    const res = await fetch(GCHAT_WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    const latency = Date.now() - start;

    if (!res.ok) {
      const err = await res.text();
      console.log(`  ❌ Error: ${res.status} — ${err.substring(0, 300)}`);
      return { error: err, latency, provider: 'Claude (GChat worker)' };
    }

    const data = await res.json();
    const rawText = data.analysis || JSON.stringify(data);

    // Estimate: Sonnet input ~$3/M tokens, output ~$15/M tokens
    // A dashboard image is roughly 1000-1500 input tokens as base64 via vision
    // Typical output is ~200-400 tokens
    const estInputTokens = Math.round(base64Image.length * 0.75 / 4); // rough
    const estOutputTokens = 400;
    const costEstimate = (estInputTokens * 3 / 1_000_000) + (estOutputTokens * 15 / 1_000_000);

    console.log(`  ⏱  Latency: ${latency}ms`);
    console.log(`  💰 Est. cost: ~$${costEstimate.toFixed(4)} (Sonnet vision)`);
    console.log(`  📝 Raw response (first 600 chars):\n${String(rawText).substring(0, 600)}`);

    // Try to parse JSON from response
    let parsed = null;
    try {
      const jsonMatch = String(rawText).match(/\{[\s\S]*\}/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      console.log(`  ⚠️  JSON parse failed: ${e.message}`);
    }

    return { rawText: String(rawText), parsed, latency, costEstimate, provider: 'Claude (GChat worker)', quoteUrls: data.quoteUrls };
  } catch (err) {
    const latency = Date.now() - start;
    console.log(`  ❌ Fetch error: ${err.message}`);
    return { error: err.message, latency, provider: 'Claude (GChat worker)' };
  }
}

// ─── Test B: Cloudflare Workers AI (Llama 3.2 Vision) ──────────────────────────
async function testWorkersAI(base64Image, mediaType) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  TEST B: Cloudflare Workers AI (Llama 3.2 11B Vision)');
  console.log('══════════════════════════════════════════════════');

  const start = Date.now();

  // Try multiple API formats — CF docs show different patterns
  const formats = [
    {
      name: 'image[] array format',
      body: {
        messages: [{ role: 'user', content: EXTRACTION_PROMPT }],
        image: [base64Image],
        max_tokens: 2048
      }
    },
    {
      name: 'OpenAI-compatible format',
      body: {
        messages: [{
          role: 'user',
          content: [
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64Image}` } },
            { type: 'text', text: EXTRACTION_PROMPT }
          ]
        }],
        max_tokens: 2048
      }
    },
    {
      name: 'raw image field',
      body: {
        messages: [{ role: 'user', content: EXTRACTION_PROMPT }],
        image: base64Image,
        max_tokens: 2048
      }
    }
  ];

  for (const fmt of formats) {
    console.log(`\n  🔄 Trying: ${fmt.name}...`);
    const fmtStart = Date.now();

    try {
      const res = await fetch(CF_VISION_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CF_API_TOKEN}`
        },
        body: JSON.stringify(fmt.body)
      });

      const latency = Date.now() - fmtStart;

      if (!res.ok) {
        const err = await res.text();
        console.log(`  ❌ ${fmt.name} failed: ${res.status} — ${err.substring(0, 200)}`);
        continue; // Try next format
      }

      const data = await res.json();

      if (!data.success && data.errors?.length) {
        console.log(`  ❌ ${fmt.name} API error: ${JSON.stringify(data.errors).substring(0, 200)}`);
        continue;
      }

      const rawText = data.result?.response || JSON.stringify(data.result || data);

      console.log(`  ✅ ${fmt.name} succeeded!`);
      console.log(`  ⏱  Latency: ${latency}ms`);
      console.log(`  💰 Cost: FREE (10,000 neurons/day free tier)`);
      console.log(`  📝 Raw response (first 600 chars):\n${String(rawText).substring(0, 600)}`);

      let parsed = null;
      try {
        const jsonMatch = String(rawText).match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch (e) {
        console.log(`  ⚠️  JSON parse failed: ${e.message}`);
      }

      return { rawText: String(rawText), parsed, latency, costEstimate: 0, provider: 'Workers AI (Llama 3.2)', format: fmt.name };

    } catch (err) {
      console.log(`  ❌ ${fmt.name} fetch error: ${err.message}`);
      continue;
    }
  }

  // All formats failed
  const totalLatency = Date.now() - start;
  console.log(`\n  ❌ All CF Workers AI formats failed.`);
  return { error: 'All formats failed', latency: totalLatency, costEstimate: 0, provider: 'Workers AI (Llama 3.2)' };
}

// ─── Accuracy Scoring ──────────────────────────────────────────────────────────
function scoreAccuracy(parsed, provider) {
  console.log(`\n  📊 Accuracy Score — ${provider}:`);

  if (!parsed) {
    console.log('    ❌ No parseable JSON — score: 0%');
    return { score: 0, deviceMatches: 0, headerMatches: 0 };
  }

  let correct = 0;
  let total = 0;
  let headerMatches = 0;

  // Header fields
  const headerChecks = [
    ['licenseStatus', GROUND_TRUTH.licenseStatus],
    ['licenseModel', GROUND_TRUTH.licenseModel],
    ['mxEdition', GROUND_TRUTH.mxEdition],
    ['mrEdition', GROUND_TRUTH.mrEdition],
  ];

  for (const [field, expected] of headerChecks) {
    total++;
    const actual = String(parsed[field] || '').trim();
    const match = actual.toLowerCase().includes(expected.toLowerCase());
    console.log(`    ${match ? '✅' : '❌'} ${field}: "${actual}" ${match ? '==' : '!='} "${expected}"`);
    if (match) { correct++; headerMatches++; }
  }

  // Expiration
  total++;
  const expStr = String(parsed.expiration || '');
  const expMatch = expStr.includes('May') && expStr.includes('2026');
  console.log(`    ${expMatch ? '✅' : '❌'} expiration: "${expStr}" contains "May 2026"?`);
  if (expMatch) correct++;

  // Devices
  const parsedDevices = parsed.devices || [];
  let deviceMatches = 0;

  for (const gtDevice of GROUND_TRUTH.devices) {
    total++;
    const found = parsedDevices.find(pd => {
      const pdName = String(pd.name || '').toLowerCase().replace(/[^a-z0-9/]/g, '');
      const gtName = gtDevice.name.toLowerCase().replace(/[^a-z0-9/]/g, '');
      return pdName.includes(gtName) || gtName.includes(pdName);
    });

    if (found) {
      deviceMatches++;
      correct++;
      const limitOk = String(found.limit).includes(String(gtDevice.limit).replace(' free', ''));
      const countOk = String(found.count) === String(gtDevice.count);
      const detail = `limit:${limitOk ? '✓' : '✗'}(${found.limit}) count:${countOk ? '✓' : '✗'}(${found.count})`;
      console.log(`    ✅ ${gtDevice.name} → "${found.name}" ${detail}`);
    } else {
      console.log(`    ❌ Missing: ${gtDevice.name}`);
    }
  }

  // False positives
  const extras = parsedDevices.filter(pd => {
    return !GROUND_TRUTH.devices.find(gt => {
      const pdName = String(pd.name || '').toLowerCase().replace(/[^a-z0-9/]/g, '');
      const gtName = gt.name.toLowerCase().replace(/[^a-z0-9/]/g, '');
      return pdName.includes(gtName) || gtName.includes(pdName);
    });
  });
  if (extras.length) console.log(`    ⚠️  False positives: ${extras.map(d => d.name).join(', ')}`);

  const score = Math.round((correct / total) * 100);
  console.log(`\n    🎯 Total: ${correct}/${total} = ${score}%`);
  console.log(`    📱 Devices: ${deviceMatches}/${GROUND_TRUTH.devices.length}`);
  console.log(`    📋 Headers: ${headerMatches}/4 + expiration: ${expMatch ? '✓' : '✗'}`);

  return { score, deviceMatches, headerMatches };
}

// ─── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const imgPath = process.argv[2] || path.join(__dirname, 'test-dashboard.png');

  if (!fs.existsSync(imgPath)) {
    console.error(`Image not found: ${imgPath}`);
    process.exit(1);
  }

  const imageBuffer = fs.readFileSync(imgPath);
  const base64Image = imageBuffer.toString('base64');
  const ext = path.extname(imgPath).toLowerCase();
  const mediaType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║   Vision API A/B Comparison: Claude vs CF Workers AI    ║');
  console.log('║   Meraki License Dashboard Screenshot Parsing           ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log(`\n  📷 Image: ${path.basename(imgPath)} (${(imageBuffer.length / 1024).toFixed(1)} KB)`);
  console.log(`  📦 Base64: ${(base64Image.length / 1024).toFixed(1)} KB`);
  console.log(`  🕐 Started: ${new Date().toISOString()}\n`);

  // Run both tests in parallel
  const [claudeResult, cfResult] = await Promise.all([
    testClaude(base64Image, mediaType),
    testWorkersAI(base64Image, mediaType)
  ]);

  // Score both
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   ACCURACY COMPARISON                                    ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const claudeAcc = scoreAccuracy(claudeResult.parsed, claudeResult.provider);
  const cfAcc = scoreAccuracy(cfResult.parsed, cfResult.provider);

  // Final summary table
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║   FINAL COMPARISON                                       ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`
  ┌───────────────────┬────────────────────┬────────────────────────┐
  │ Metric            │ Claude (Sonnet)    │ CF Workers AI (Llama)  │
  ├───────────────────┼────────────────────┼────────────────────────┤
  │ Latency           │ ${pad(claudeResult.latency + 'ms', 18)} │ ${pad(cfResult.latency + 'ms', 22)} │
  │ Accuracy          │ ${pad(claudeAcc.score + '%', 18)} │ ${pad(cfAcc.score + '%', 22)} │
  │ Devices found     │ ${pad(claudeAcc.deviceMatches + '/12', 18)} │ ${pad(cfAcc.deviceMatches + '/12', 22)} │
  │ Headers correct   │ ${pad(claudeAcc.headerMatches + '/4', 18)} │ ${pad(cfAcc.headerMatches + '/4', 22)} │
  │ Est. cost/call    │ ${pad('~$' + (claudeResult.costEstimate || 0).toFixed(4), 18)} │ ${pad('$0 (free tier)', 22)} │
  │ JSON parseable    │ ${pad(claudeResult.parsed ? 'Yes' : 'No', 18)} │ ${pad(cfResult.parsed ? 'Yes' : 'No', 22)} │
  └───────────────────┴────────────────────┴────────────────────────┘
  `);

  // Recommendation
  console.log('  ─── RECOMMENDATION ───');
  if (cfAcc.score >= 90) {
    console.log('  ✅ CF Workers AI is accurate enough for production use.');
    console.log('  → Use as default (free + fast), Claude as fallback for edge cases.');
  } else if (cfAcc.score >= 70) {
    console.log('  🟡 CF Workers AI is decent but needs JS post-processing help.');
    console.log('  → Hybrid: CF extracts raw data → JS validates/normalizes → Claude fallback on errors.');
  } else if (cfAcc.score >= 40) {
    console.log('  🟠 CF Workers AI gets partial data. May work for simple dashboards.');
    console.log('  → Use for pre-processing/OCR step, then Claude for full analysis.');
  } else {
    console.log('  ❌ CF Workers AI is not reliable enough for dashboard parsing.');
    console.log('  → Stick with Claude. Consider CF for simpler vision tasks (logo detection, etc.).');
  }

  // Save full results
  const results = {
    timestamp: new Date().toISOString(),
    image: path.basename(imgPath),
    imageSizeKB: +(imageBuffer.length / 1024).toFixed(1),
    groundTruth: GROUND_TRUTH,
    claude: {
      provider: claudeResult.provider,
      latencyMs: claudeResult.latency,
      costEstimate: claudeResult.costEstimate || 0,
      accuracy: claudeAcc,
      parsed: claudeResult.parsed,
      rawResponse: String(claudeResult.rawText || '').substring(0, 2000),
      error: claudeResult.error || null
    },
    workersAI: {
      provider: cfResult.provider,
      format: cfResult.format || null,
      latencyMs: cfResult.latency,
      costEstimate: 0,
      accuracy: cfAcc,
      parsed: cfResult.parsed,
      rawResponse: String(cfResult.rawText || '').substring(0, 2000),
      error: cfResult.error || null
    }
  };

  const outPath = path.join(__dirname, 'comparison-results.json');
  fs.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n  📁 Full results: ${outPath}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
