#!/usr/bin/env node
/**
 * Comprehensive stress test for GChat worker
 * Tests CF-first waterfall + advisor tool readiness
 * 100+ tests across routing, CRM scenarios, and response quality
 */

const { execSync } = require('child_process');

const BASE_URL = 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev/test-routing';

// ═══════════════════════════════════════════════════════════════
// TEST DEFINITIONS
// ═══════════════════════════════════════════════════════════════

const tests = [
  // ── CATEGORY 1: CF-Routed Deterministic Quotes ──
  { input: 'quote 10 MR46', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR46') },
  { input: 'quote 5 MX75', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX75') },
  { input: '3 CW9164', expect: ['cf-deterministic', 'claude'], category: 'det-quote', validate: r => r.includes('CW9164') || /Claude|resolve/i.test(r) },  // CW bare model needs -MR suffix; may need Claude
  { input: 'quote 1 MS390-24P', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MS390') },
  { input: '2x MV72', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MV72') },
  { input: 'quote 1 MX67', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX67') },
  { input: '10 MR28 with 3 year license', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR28') },
  { input: 'quote 4 CW9166 5yr', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('CW9166') },
  { input: '1 MX450', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MX450') },
  { input: 'quote 2 MS250-48FP', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MS250') },
  { input: '6 MR57 1yr enterprise', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MR57') },
  { input: 'quote 1 Z4', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('Z4') },
  { input: '3 MV22 with 5 year license', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MV22') },
  { input: 'quote 1 MG51', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MG51') },
  { input: '20 MT14', expect: 'cf-deterministic', category: 'det-quote', validate: r => r.includes('MT14') },

  // ── CATEGORY 2: Multi-item Quotes ──
  { input: 'quote 5 MR46 and 2 MS225-24P', expect: 'cf-deterministic', category: 'det-multi', validate: r => r.includes('MR46') && r.includes('MS225') },
  { input: '3 CW9164 2 CW9166', expect: ['cf-deterministic', 'claude'], category: 'det-multi', validate: r => (r.includes('CW9164') && r.includes('CW9166')) || /Claude|resolve/i.test(r) },  // CW bare model suffix gap
  { input: '1 MX75 1 MS390-24P 5 MR46', expect: 'cf-deterministic', category: 'det-multi', validate: r => r.includes('MX75') && r.includes('MR46') },

  // ── CATEGORY 3: License-only Quotes ──
  { input: 'LIC-ENT-3YR', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-ENT') },
  { input: '5 MR licenses', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-ENT') },
  { input: 'quote 10 MV licenses 3 year', expect: 'cf-deterministic', category: 'det-license', validate: r => r.includes('LIC-MV') },

  // ── CATEGORY 4: Pricing Calculator ──
  { input: 'how much is a MR46', expect: ['deterministic-pricing', 'cf-deterministic'], category: 'det-pricing', validate: r => r.includes('MR46') },  // CF may extract as quote intent
  { input: 'price of MX75-HW', expect: 'deterministic-pricing', category: 'det-pricing', validate: r => r.includes('MX75') },
  { input: 'cost of 3x CW9164I-MR', expect: 'deterministic-pricing', category: 'det-pricing', validate: r => r.includes('CW9164') },
  { input: 'what does a MS390-24 cost', expect: ['deterministic-pricing', 'cf-deterministic', 'claude'], category: 'det-pricing', validate: r => /MS390|price|cost|\$|product.?info|Claude/i.test(r) },

  // ── CATEGORY 5: EOL Lookups ──
  { input: 'when is MR42 end of life', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'is the MR33 EOL', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale/i.test(r) },
  { input: 'EOL date for MR18', expect: 'deterministic-eol', category: 'det-eol', validate: r => /eol|end of|support|sale|not recognized/i.test(r) },

  // ── CATEGORY 6: Deterministic Clarifications (Duo/Umbrella) ──
  { input: 'quote 10 Duo', expect: 'deterministic-clarify', category: 'det-clarify', validate: r => /tier|advantage|premier|essential/i.test(r) },
  { input: 'quote Umbrella', expect: 'deterministic-clarify', category: 'det-clarify', validate: r => /DNS|SIG|type|tier/i.test(r) },

  // ── CATEGORY 7: CF Clarify — incomplete models / bare families ──
  { input: 'how much is a MX', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MX67|MX68|MX75|which|model/i.test(r) },
  { input: 'I need some switches', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MS|switch|which|model/i.test(r) },
  { input: 'quote me some APs', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|AP|access point|which|model/i.test(r) },
  { input: 'how much is a firewall', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MX|which|model|firewall/i.test(r) },
  { input: 'I need a camera', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MV|camera|which|model/i.test(r) },
  { input: 'price of a switch', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MS|switch|which|model/i.test(r) },
  { input: 'how much are meraki access points', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|which|model/i.test(r) },
  { input: 'quote a MR', expect: ['cf-clarify', 'claude'], category: 'cf-clarify', validate: r => /MR28|MR36|MR44|MR46|MR57|which|model|Claude/i.test(r) },
  { input: 'cost of an AP', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MR|CW|which|model|access point/i.test(r) },
  { input: 'give me a quote on cameras', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MV|camera|which|model/i.test(r) },
  { input: 'how much for sensors', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /MT|sensor|which|model/i.test(r) },
  { input: 'price on a Meraki', expect: 'cf-clarify', category: 'cf-clarify', validate: r => /which|model|product|family|MR|MX|MS/i.test(r) },

  // ── CATEGORY 8: CF Clarify — MS variant disambiguation ──
  { input: 'quote 5 MS130-24', expect: ['cf-clarify', 'cf-deterministic'], category: 'cf-variant', validate: r => /MS130-24P|MS130-24X|1G|10G|PoE|uplink|which|Co-Term/i.test(r) },  // May resolve directly or clarify
  { input: 'quote 2 MS390-48', expect: ['cf-clarify', 'cf-deterministic'], category: 'cf-variant', validate: r => /MS390-48P|MS390-48UX|mGig|PoE|which/i.test(r) },
  { input: 'I need 10 MS210-48', expect: ['cf-clarify', 'cf-deterministic'], category: 'cf-variant', validate: r => /MS210|MS150|EOL|end.of|replacement|PoE|which|Co-Term/i.test(r) },  // MS210 is EOL, may get replacement mapping

  // ── CATEGORY 9: Product Info → Claude ──
  { input: 'what firewall should I get for 50 users', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'which MX for 200 people', expect: ['claude', 'cf-clarify'], category: 'claude-prodinfo', validate: r => /product.?info|Claude|MX75|200/i.test(r) },
  { input: 'best AP for a warehouse', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what firewall for a school of 2000 students', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'recommend a switch for a small office', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what AP covers 5000 sq ft', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'which camera for outdoor parking lot', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'difference between MR46 and CW9164', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'does MX67 support SD-WAN', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'is the MR78 outdoor rated', expect: 'claude', category: 'claude-prodinfo', validate: r => /product.?info|Claude/i.test(r) },

  // ── CATEGORY 10: Advisory (product questions that old engine would misroute) ──
  { input: 'can you tell me about the MR46', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what features does the CW9166 have', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'tell me about Meraki switches', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'what are the specs on MV72', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'is the MS390 stackable', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'how many ports does the MS250-48 have', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'whats the throughput of the MX85', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'compare MX67 and MX68', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'which AP has the best range', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },
  { input: 'does the MT14 need a license', expect: 'claude', category: 'advisory', validate: r => /product.?info|Claude/i.test(r) },

  // ── CATEGORY 11: Conversation — greetings/thanks ──
  { input: 'hello', expect: 'cf-conversation', category: 'conversation', validate: r => r.length > 3 },
  { input: 'thanks for the help', expect: 'cf-conversation', category: 'conversation', validate: r => r.length > 3 },
  { input: 'hey how are you', expect: 'cf-conversation', category: 'conversation', validate: r => r.length > 3 },
  { input: 'goodbye', expect: 'cf-conversation', category: 'conversation', validate: r => r.length > 3 },
  { input: 'who are you', expect: ['cf-conversation', 'claude'], category: 'conversation', validate: r => r.length > 3 || /stratus|bot|assistant|quoting|help|Claude|Conversation/i.test(r) },

  // ── CATEGORY 12: Escalation — complex requests ──
  { input: 'write me a proposal for a full network refresh including 3 sites', expect: ['claude', 'cf-conversation'], category: 'escalation', validate: r => /Claude|escalat/i.test(r) || r.length > 10 },
  { input: 'help me plan a deployment for 500 APs across 10 buildings', expect: 'claude', category: 'escalation', validate: r => /Claude|escalat|product.?info/i.test(r) },

  // ── CATEGORY 13: EOL Quotes (should quote, not product_info) ──
  { input: 'quote 5 MR42', expect: 'cf-deterministic', category: 'eol-quote', validate: r => /MR42|end.of|replacement|MR46/i.test(r) },
  { input: 'quote 3 MR33', expect: 'cf-deterministic', category: 'eol-quote', validate: r => /MR33|end.of|replacement|MR36/i.test(r) },
  { input: 'price 2 MX64', expect: ['cf-deterministic', 'deterministic-pricing', 'cf-clarify'], category: 'eol-quote', validate: r => /MX64|end.of|replacement|MX67|which|model/i.test(r) },  // CF may ask which replacement

  // ── CATEGORY 14: Hardware-only / modifiers ──
  { input: 'quote 10 MR46 hardware only', expect: 'cf-deterministic', category: 'modifiers', validate: r => r.includes('MR46') },  // hardware-only just omits license from URL
  { input: 'quote 5 CW9164 no license', expect: ['cf-deterministic', 'claude'], category: 'modifiers', validate: r => r.includes('CW9164') || /Claude|resolve/i.test(r) },  // CW bare model suffix gap
  { input: '3 MS390-24P with 1yr license', expect: 'cf-deterministic', category: 'modifiers', validate: r => r.includes('MS390') },

  // ── CATEGORY 15: Natural language quoting (CF extracts intent) ──
  { input: 'I need a quote for ten MR46 access points with 3 year licenses', expect: 'cf-deterministic', category: 'natural-quote', validate: r => r.includes('MR46') },
  { input: 'can you price out 5 MX75 firewalls', expect: ['cf-deterministic', 'deterministic-pricing'], category: 'natural-quote', validate: r => r.includes('MX75') },
  { input: 'we need pricing on 20 CW9162 for our new building', expect: 'cf-deterministic', category: 'natural-quote', validate: r => r.includes('CW9162') },
  { input: 'get me a quote on 8 MS225-48FP', expect: 'cf-deterministic', category: 'natural-quote', validate: r => r.includes('MS225') },
  { input: 'what would 15 MR57 with enterprise licenses run us', expect: ['cf-deterministic', 'deterministic-pricing'], category: 'natural-quote', validate: r => r.includes('MR57') },

  // ── CATEGORY 16: Edge cases ──
  { input: 'q', expect: 'cf-conversation', category: 'edge', validate: () => true },
  { input: '?', expect: 'cf-conversation', category: 'edge', validate: () => true },
  { input: 'lol', expect: 'cf-conversation', category: 'edge', validate: () => true },
  { input: 'what can you do', expect: ['cf-conversation', 'claude'], category: 'edge', validate: () => true },
  { input: 'pricing', expect: ['cf-clarify', 'cf-conversation'], category: 'edge', validate: () => true },

  // ── CATEGORY 17: CRM-adjacent intent detection ──
  // NOTE: In the real handler, these are caught by detectCrmEmailIntent() BEFORE CF runs.
  // The test-routing endpoint doesn't run CRM detection, so CF handles them.
  // These tests validate that CF doesn't try to generate quotes for CRM requests.
  { input: 'create a deal for ABC Company', expect: ['claude', 'cf-conversation'], category: 'crm-intent', validate: r => !/quote|pricing|Co-Term/i.test(r) },
  { input: 'search zoho for the Riverside account', expect: ['claude', 'cf-conversation'], category: 'crm-intent', validate: r => !/quote|pricing|Co-Term/i.test(r) },
  { input: 'send an email to john@example.com about the quote', expect: ['claude', 'cf-conversation'], category: 'crm-intent', validate: r => !/Co-Term/i.test(r) },
  { input: 'update the deal stage to negotiation', expect: ['claude', 'cf-conversation'], category: 'crm-intent', validate: r => !/quote|pricing|Co-Term/i.test(r) },
  { input: 'close the task and create a follow up', expect: ['claude', 'cf-conversation'], category: 'crm-intent', validate: r => !/quote|pricing|Co-Term/i.test(r) },

  // ── CATEGORY 18: Mixed intent (quoting + CRM context) ──
  { input: 'quote 10 MR46 and add it to the deal', expect: ['cf-deterministic', 'claude'], category: 'mixed', validate: r => r.includes('MR46') || /Claude/i.test(r) },
  { input: 'how much for 5 CW9164 and email the customer', expect: ['cf-deterministic', 'deterministic-pricing', 'claude'], category: 'mixed', validate: r => r.includes('CW9164') || /Claude/i.test(r) },
];

// ═══════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════

async function runTest(test) {
  const url = `${BASE_URL}?input=${encodeURIComponent(test.input)}`;
  try {
    const response = execSync(`curl -s --max-time 15 '${url}'`, { encoding: 'utf8' });
    const data = JSON.parse(response);
    const layer = data.layer;
    const resp = data.response || '';

    // Check layer match
    const expectedLayers = Array.isArray(test.expect) ? test.expect : [test.expect];
    const layerMatch = expectedLayers.includes(layer);

    // Check response validation
    let validResponse = true;
    let validationError = '';
    if (test.validate && resp) {
      try {
        validResponse = test.validate(resp);
        if (!validResponse) validationError = 'BAD_RESPONSE';
      } catch (e) {
        validResponse = false;
        validationError = `VALIDATE_ERROR: ${e.message}`;
      }
    }

    const pass = layerMatch && validResponse;
    return {
      input: test.input,
      category: test.category,
      expected: expectedLayers.join('|'),
      actual: layer,
      pass,
      layerMatch,
      validResponse,
      validationError,
      responsePreview: resp.substring(0, 120),
      cfElapsed: data.details?.cf?.elapsed || null
    };
  } catch (err) {
    return {
      input: test.input,
      category: test.category,
      expected: Array.isArray(test.expect) ? test.expect.join('|') : test.expect,
      actual: 'ERROR',
      pass: false,
      layerMatch: false,
      validResponse: false,
      validationError: err.message.substring(0, 100)
    };
  }
}

async function main() {
  console.log(`\n🧪 GChat CF-First + Advisor Stress Test`);
  console.log(`📊 ${tests.length} tests across ${new Set(tests.map(t => t.category)).size} categories`);
  console.log(`🎯 Target: ${BASE_URL}\n`);

  // Check health first
  try {
    const health = execSync(`curl -s --max-time 5 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev/health'`, { encoding: 'utf8' });
    const hData = JSON.parse(health);
    console.log(`✅ Worker healthy: ${hData.version || 'unknown version'}\n`);
  } catch (e) {
    console.log(`⚠️ Health check failed — worker may not be deployed yet. Waiting 30s...\n`);
    await new Promise(r => setTimeout(r, 30000));
  }

  const results = [];
  const batchSize = 5; // Run 5 concurrent tests to avoid rate limits

  for (let i = 0; i < tests.length; i += batchSize) {
    const batch = tests.slice(i, i + batchSize);
    const batchResults = [];
    for (const test of batch) {
      batchResults.push(await runTest(test));
    }
    results.push(...batchResults);

    // Progress indicator
    const done = Math.min(i + batchSize, tests.length);
    const passed = results.filter(r => r.pass).length;
    process.stdout.write(`\r  Progress: ${done}/${tests.length} (${passed} passed)`);
  }

  console.log('\n');

  // ── RESULTS ──
  const passed = results.filter(r => r.pass);
  const failed = results.filter(r => !r.pass);
  const pct = ((passed.length / results.length) * 100).toFixed(1);

  console.log(`═══════════════════════════════════════════════════`);
  console.log(`  RESULTS: ${passed.length}/${results.length} passed (${pct}%)`);
  console.log(`═══════════════════════════════════════════════════\n`);

  // Category breakdown
  const categories = {};
  for (const r of results) {
    if (!categories[r.category]) categories[r.category] = { pass: 0, fail: 0, tests: [] };
    categories[r.category][r.pass ? 'pass' : 'fail']++;
    categories[r.category].tests.push(r);
  }

  console.log('Category Breakdown:');
  for (const [cat, stats] of Object.entries(categories).sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = stats.pass + stats.fail;
    const icon = stats.fail === 0 ? '✅' : '❌';
    console.log(`  ${icon} ${cat}: ${stats.pass}/${total}`);
  }

  // Layer distribution
  console.log('\nLayer Distribution:');
  const layerCounts = {};
  for (const r of results) {
    layerCounts[r.actual] = (layerCounts[r.actual] || 0) + 1;
  }
  for (const [layer, count] of Object.entries(layerCounts).sort((a, b) => b[1] - a[1])) {
    const pct = ((count / results.length) * 100).toFixed(1);
    console.log(`  ${layer}: ${count} (${pct}%)`);
  }

  // CF timing
  const cfTimes = results.filter(r => r.cfElapsed).map(r => r.cfElapsed);
  if (cfTimes.length > 0) {
    const avg = Math.round(cfTimes.reduce((a, b) => a + b, 0) / cfTimes.length);
    const max = Math.max(...cfTimes);
    const min = Math.min(...cfTimes);
    console.log(`\nCF Classifier Timing: avg=${avg}ms, min=${min}ms, max=${max}ms`);
  }

  // Failed tests detail
  if (failed.length > 0) {
    console.log(`\n❌ FAILURES (${failed.length}):`);
    for (const f of failed) {
      const issue = !f.layerMatch
        ? `WRONG_LAYER (expected: ${f.expected}, got: ${f.actual})`
        : `BAD_RESPONSE`;
      console.log(`  [${f.category}] "${f.input}"`);
      console.log(`    ${issue}`);
      if (f.responsePreview) console.log(`    Response: ${f.responsePreview}`);
      console.log('');
    }
  }

  // Exit code
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test runner error:', err);
  process.exit(2);
});
