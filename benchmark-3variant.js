/**
 * 3-variant classifier benchmark — Legacy vs V2/Llama vs V2/Gemma 4.
 *
 * Runs each of 74 fixtures through three configurations via the deployed
 * /api/benchmark-classifier endpoint (which now accepts prompt_variant).
 *
 * Variants:
 *   - legacy   → prompt_variant=legacy, model=Llama 4 Scout
 *   - v2-llama → prompt_variant=v2,     model=Llama 4 Scout
 *   - v2-gemma → prompt_variant=v2,     model=Gemma 4 26B
 *
 * Grading:
 *   - For V2 variants: full rubric (intent 3 + items 2 + modifiers 2 + revision 2 + reference 1).
 *   - For legacy: intent-only (3 pts max). Legacy schema is {intent, reply, extracted}
 *     and cannot express items/modifiers/revision/reference. An intent-accuracy line
 *     is reported for all three so they are apples-to-apples on the primary signal.
 *
 * SDW + swap breakdown reported separately.
 *
 * Usage: node benchmark-3variant.js [--limit N] [--concurrency C]
 */

const fs = require('fs');
const path = require('path');

const ENDPOINT = 'https://stratus-ai-bot.chrisg-ec1.workers.dev/api/benchmark-classifier';
const KEY = 'Biscuit4';

const VARIANTS = [
  { id: 'legacy',      label: 'Legacy prompt (Llama)',  promptVariant: 'legacy', model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  { id: 'v2-llama',    label: 'V2 prompt (Llama)',      promptVariant: 'v2',     model: '@cf/meta/llama-4-scout-17b-16e-instruct' },
  { id: 'v2-gemma4',   label: 'V2 prompt (Gemma 4 26B)', promptVariant: 'v2',    model: '@cf/google/gemma-4-26b-a4b-it' },
  { id: 'v2-gemma3-12b', label: 'V2 prompt (Gemma 3 12B)', promptVariant: 'v2',  model: '@cf/google/gemma-3-12b-it' },
];

const fixtures = require('./classifier-fixtures.json').fixtures;

// ─── Grading helpers (same semantics as benchmark-runner.js) ───
function normalizeIntent(s) { return String(s || '').toLowerCase().trim(); }
function itemEq(a, b) {
  if (!a || !b) return false;
  const au = String(a.sku || '').toUpperCase().replace(/-(HW|MR|RTG|HW-NA)$/,'');
  const bu = String(b.sku || '').toUpperCase().replace(/-(HW|MR|RTG|HW-NA)$/,'');
  if (au !== bu) return false;
  if (a.qty !== undefined && b.qty !== undefined && a.qty !== null && b.qty !== null && a.qty !== b.qty) return false;
  return true;
}
function itemsMatch(expected, actual) {
  if (!expected || expected.length === 0) return { pass: true, detail: 'none expected' };
  if (!actual || !Array.isArray(actual)) return { pass: false, detail: 'no items in response' };
  for (const e of expected) {
    if (!actual.some(a => itemEq(e, a))) return { pass: false, detail: `missing ${e.sku}x${e.qty ?? '*'}` };
  }
  return { pass: true, detail: `${expected.length} items matched` };
}
function modifiersMatch(expected, actual) {
  if (!expected || Object.keys(expected).length === 0) return { pass: true, detail: 'none expected' };
  const a = actual || {};
  for (const [k, v] of Object.entries(expected)) {
    if (a[k] !== v) return { pass: false, detail: `${k}: expected ${v}, got ${a[k]}` };
  }
  return { pass: true, detail: 'all modifiers matched' };
}
function revisionMatch(expected, actual) {
  if (!expected) return { pass: true, detail: 'none expected' };
  const a = actual || {};
  if (expected.action && a.action !== expected.action) return { pass: false, detail: `action: expected ${expected.action}, got ${a.action}` };
  if (expected.hw_lic_toggle && a.hw_lic_toggle !== expected.hw_lic_toggle) return { pass: false, detail: `toggle: ${expected.hw_lic_toggle} vs ${a.hw_lic_toggle}` };
  if (expected.new_term !== undefined && expected.new_term !== null && a.new_term !== expected.new_term) return { pass: false, detail: `new_term: ${expected.new_term} vs ${a.new_term}` };
  if (expected.new_tier && a.new_tier !== expected.new_tier) return { pass: false, detail: `new_tier: ${expected.new_tier} vs ${a.new_tier}` };
  if (expected.new_qty !== undefined && expected.new_qty !== null && a.new_qty !== expected.new_qty) return { pass: false, detail: `new_qty: ${expected.new_qty} vs ${a.new_qty}` };
  if (expected.target_sku && String(a.target_sku||'').toUpperCase() !== String(expected.target_sku).toUpperCase()) return { pass: false, detail: `target: ${expected.target_sku} vs ${a.target_sku}` };
  if (expected.add_items && expected.add_items.length > 0) {
    if (!a.add_items || !Array.isArray(a.add_items)) return { pass: false, detail: 'add_items missing' };
    for (const e of expected.add_items) {
      if (!a.add_items.some(ai => itemEq(e, ai))) return { pass: false, detail: `add_items missing ${e.sku}` };
    }
  }
  return { pass: true, detail: 'revision matched' };
}
function referenceMatch(expected, actual) {
  if (!expected) return { pass: true, detail: 'none expected' };
  const a = actual || {};
  if (expected.is_pronoun_ref !== undefined && a.is_pronoun_ref !== expected.is_pronoun_ref) return { pass: false, detail: 'is_pronoun_ref mismatch' };
  if (expected.option_ref !== undefined && expected.option_ref !== null && a.option_ref !== expected.option_ref) return { pass: false, detail: 'option_ref mismatch' };
  if (expected.resolve_from_history !== undefined && a.resolve_from_history !== expected.resolve_from_history) return { pass: false, detail: 'resolve_from_history mismatch' };
  return { pass: true, detail: 'reference matched' };
}

function gradeV2(fixture, parsed) {
  if (!parsed) return { total: 0, max: 10, intentOk: false, details: { intent: 'NO_PARSE' } };
  const exp = fixture.expected;
  let total = 0, max = 0;
  const details = {};

  max += 3;
  const intentOk = normalizeIntent(parsed.intent) === normalizeIntent(exp.intent);
  if (intentOk) { total += 3; details.intent = `✓ ${parsed.intent}`; }
  else details.intent = `✗ expected ${exp.intent}, got ${parsed.intent}`;

  if (exp.items && exp.items.length > 0) {
    max += 2;
    const r = itemsMatch(exp.items, parsed.items);
    if (r.pass) { total += 2; details.items = `✓ ${r.detail}`; } else details.items = `✗ ${r.detail}`;
  }
  if (exp.modifiers && Object.keys(exp.modifiers).length > 0) {
    max += 2;
    const r = modifiersMatch(exp.modifiers, parsed.modifiers);
    if (r.pass) { total += 2; details.modifiers = `✓ ${r.detail}`; } else details.modifiers = `✗ ${r.detail}`;
  }
  if (exp.revision) {
    max += 2;
    const r = revisionMatch(exp.revision, parsed.revision);
    if (r.pass) { total += 2; details.revision = `✓ ${r.detail}`; } else details.revision = `✗ ${r.detail}`;
  }
  if (exp.reference) {
    max += 1;
    const r = referenceMatch(exp.reference, parsed.reference);
    if (r.pass) { total += 1; details.reference = `✓ ${r.detail}`; } else details.reference = `✗ ${r.detail}`;
  }
  return { total, max, intentOk, details };
}

// Legacy schema output: {intent, reply, extracted}. Only intent is graded.
// For apples-to-apples intent comparison, we also collapse V2 intents that
// don't exist in the legacy taxonomy into their legacy equivalents:
//   price_lookup     → quote  (legacy treats "how much is X" as quote)
//   revise           → quote  (legacy has no revise — it just classifies as quote)
//   dashboard_parse  → quote  (legacy has no dashboard — screenshots routed as quote)
function mapToLegacyIntent(i) {
  const n = normalizeIntent(i);
  if (n === 'price_lookup' || n === 'revise' || n === 'dashboard_parse') return 'quote';
  return n;
}
function gradeLegacy(fixture, parsed) {
  if (!parsed) return { total: 0, max: 3, intentOk: false, details: { intent: 'NO_PARSE' } };
  const expIntent = mapToLegacyIntent(fixture.expected.intent);
  const gotIntent = normalizeIntent(parsed.intent);
  const intentOk = gotIntent === expIntent;
  return {
    total: intentOk ? 3 : 0,
    max: 3,
    intentOk,
    details: {
      intent: intentOk ? `✓ ${parsed.intent}` : `✗ expected ${expIntent} (orig ${fixture.expected.intent}), got ${parsed.intent}`
    }
  };
}

// SDW + swap sub-probes — work for both schemas.
function probeSDW(fixture, parsed, variantId) {
  if (!parsed) return null;
  const expTier = (fixture.expected.modifiers || {}).tier;
  if (expTier !== 'SDW') return null;  // not an SDW fixture
  if (variantId === 'legacy') {
    const blob = ((parsed.extracted || '') + ' ' + (parsed.reply || '')).toLowerCase();
    const hasSdw = /sd-?wan|sdw(?!\S)/i.test(blob);
    const intentIsQuote = normalizeIntent(parsed.intent) === 'quote';
    return { pass: hasSdw && intentIsQuote, got: parsed.extracted || parsed.reply || '', note: hasSdw ? (intentIsQuote ? 'SDW in extracted, intent=quote' : 'SDW in extracted but intent='+parsed.intent) : 'SDW token missing' };
  } else {
    const tier = (parsed.modifiers || {}).tier;
    return { pass: tier === 'SDW', got: tier, note: tier === 'SDW' ? 'tier=SDW' : `tier=${tier}` };
  }
}
function probeSwap(fixture, parsed, variantId) {
  if (!parsed) return null;
  const expAction = (fixture.expected.revision || {}).action;
  if (expAction !== 'swap') return null;
  if (variantId === 'legacy') {
    const blob = (parsed.extracted || '').toUpperCase();
    const target = (fixture.expected.revision || {}).target_sku || '';
    const replacement = ((fixture.expected.revision || {}).add_items || [])[0] || {};
    const hasBoth = blob.includes(String(target).toUpperCase()) && blob.includes(String(replacement.sku || '').toUpperCase());
    const intentIsQuote = normalizeIntent(parsed.intent) === 'quote';
    return { pass: hasBoth && intentIsQuote, got: parsed.extracted || '', note: hasBoth ? (intentIsQuote ? 'both SKUs in extracted, intent=quote' : 'both SKUs but intent='+parsed.intent) : 'missing SKU pair' };
  } else {
    const action = (parsed.revision || {}).action;
    return { pass: action === 'swap', got: action, note: action === 'swap' ? 'revision.action=swap' : `revision.action=${action}` };
  }
}

async function runOne(fixture, variant) {
  const body = {
    input: fixture.input,
    model: variant.model,
    prompt_variant: variant.promptVariant
  };
  if (fixture.prior_context) body.prior_context = fixture.prior_context;
  const wallStart = Date.now();
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bench-Key': KEY },
      body: JSON.stringify(body)
    });
    const wall = Date.now() - wallStart;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: `HTTP ${res.status} ${txt.substring(0,120)}`, latency: wall };
    }
    const data = await res.json();
    return { parsed: data.parsed, raw: data.raw, parseError: data.parseError, err: data.err, latency: data.elapsed || wall };
  } catch (e) {
    return { error: e.message, latency: Date.now() - wallStart };
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const args = process.argv.slice(2);
  const limit = args.includes('--limit') ? parseInt(args[args.indexOf('--limit') + 1]) : fixtures.length;
  const concurrency = args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1]) : 4;
  const subset = fixtures.slice(0, limit);

  console.log(`\n════════════════════════════════════════════════════════════`);
  console.log(`  3-Variant Classifier Benchmark`);
  console.log(`  ${subset.length} fixtures × ${VARIANTS.length} variants`);
  console.log(`  Concurrency: ${concurrency}`);
  console.log(`  Endpoint: ${ENDPOINT}`);
  console.log(`════════════════════════════════════════════════════════════\n`);

  const results = {};  // variant.id → { fixture_id → { grade, latency, parsed } }
  for (const v of VARIANTS) results[v.id] = {};

  // Build all jobs (fixture × variant) and run with bounded concurrency
  const jobs = [];
  for (const v of VARIANTS) for (const fx of subset) jobs.push({ variant: v, fixture: fx });

  let completed = 0;
  async function worker() {
    while (jobs.length) {
      const job = jobs.shift();
      if (!job) return;
      const r = await runOne(job.fixture, job.variant);
      const gradeFn = job.variant.id === 'legacy' ? gradeLegacy : gradeV2;
      const grade = r.parsed ? gradeFn(job.fixture, r.parsed) : { total: 0, max: job.variant.id === 'legacy' ? 3 : 10, intentOk: false, details: { intent: r.error || r.err || 'PARSE_FAIL' } };
      const sdw  = probeSDW(job.fixture, r.parsed, job.variant.id);
      const swap = probeSwap(job.fixture, r.parsed, job.variant.id);
      results[job.variant.id][job.fixture.id] = {
        grade, sdw, swap,
        latency: r.latency,
        parsed: r.parsed,
        raw: typeof r.raw === 'string' ? r.raw.substring(0, 300) : r.raw,
        error: r.error || r.err || r.parseError || null,
      };
      completed++;
      if (completed % 10 === 0 || completed === subset.length * VARIANTS.length) {
        process.stdout.write(`  Progress: ${completed}/${subset.length * VARIANTS.length}\n`);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // ─── Aggregate ───
  const summary = {};
  for (const v of VARIANTS) {
    const perFixture = results[v.id];
    const latencies = [];
    let totalPts = 0, maxPts = 0, intentOk = 0, intentCount = 0, parseFail = 0, errors = 0;
    for (const fx of subset) {
      const r = perFixture[fx.id];
      if (!r) continue;
      if (r.error && !r.parsed) errors++;
      if (!r.parsed) parseFail++;
      totalPts += r.grade.total;
      maxPts   += r.grade.max;
      if (r.parsed) {
        intentCount++;
        if (r.grade.intentOk) intentOk++;
      }
      if (typeof r.latency === 'number') latencies.push(r.latency);
    }
    latencies.sort((a, b) => a - b);
    summary[v.id] = {
      label: v.label,
      model: v.model,
      promptVariant: v.promptVariant,
      overallScore: `${totalPts}/${maxPts}`,
      overallPct: maxPts > 0 ? Math.round((totalPts / maxPts) * 1000) / 10 : 0,
      intentAcc: intentCount > 0 ? Math.round((intentOk / subset.length) * 1000) / 10 : 0,
      intentOk, fixtures: subset.length, parseFail, errors,
      p50ms: percentile(latencies, 50),
      p95ms: percentile(latencies, 95),
      avgMs: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0,
    };
  }

  console.log(`\n\n════════════════════════════════════════════════════════════`);
  console.log(`  OVERALL RESULTS`);
  console.log(`════════════════════════════════════════════════════════════\n`);
  console.log(`  Variant                   | Overall     | Intent Acc | p50    | p95    | Parse-Fail`);
  console.log(`  --------------------------|-------------|------------|--------|--------|------------`);
  for (const v of VARIANTS) {
    const s = summary[v.id];
    const pad = (x, n) => String(x).padEnd(n);
    console.log(`  ${pad(s.label, 26)}| ${pad(s.overallScore + ' (' + s.overallPct + '%)', 12)}| ${pad(s.intentOk + '/' + s.fixtures + ' (' + s.intentAcc + '%)', 11)}| ${pad(s.p50ms + 'ms', 7)}| ${pad(s.p95ms + 'ms', 7)}| ${s.parseFail}`);
  }

  // SDW breakdown
  console.log(`\n── SDW tier extraction (fixtures with expected tier=SDW) ──`);
  const sdwFixtures = subset.filter(f => (f.expected.modifiers || {}).tier === 'SDW');
  console.log(`  Fixtures: ${sdwFixtures.length} → ${sdwFixtures.map(f => f.id).join(', ')}`);
  for (const v of VARIANTS) {
    const pass = sdwFixtures.filter(f => results[v.id][f.id]?.sdw?.pass).length;
    console.log(`  ${v.label.padEnd(26)} ${pass}/${sdwFixtures.length} passed`);
    for (const f of sdwFixtures) {
      const probe = results[v.id][f.id]?.sdw;
      const mark = probe?.pass ? '✓' : '✗';
      console.log(`    ${mark} ${f.id.padEnd(22)} ${probe?.note || '-'}`);
    }
  }

  // Swap breakdown
  console.log(`\n── Swap action detection (fixtures with expected revision.action=swap) ──`);
  const swapFixtures = subset.filter(f => (f.expected.revision || {}).action === 'swap');
  console.log(`  Fixtures: ${swapFixtures.length} → ${swapFixtures.map(f => f.id).join(', ')}`);
  for (const v of VARIANTS) {
    const pass = swapFixtures.filter(f => results[v.id][f.id]?.swap?.pass).length;
    console.log(`  ${v.label.padEnd(26)} ${pass}/${swapFixtures.length} passed`);
    for (const f of swapFixtures) {
      const probe = results[v.id][f.id]?.swap;
      const mark = probe?.pass ? '✓' : '✗';
      console.log(`    ${mark} ${f.id.padEnd(22)} ${probe?.note || '-'}`);
    }
  }

  // Sample failures per variant
  console.log(`\n── Top intent failures per variant (up to 10) ──`);
  for (const v of VARIANTS) {
    const fails = subset
      .map(f => ({ f, r: results[v.id][f.id] }))
      .filter(x => x.r && !x.r.grade.intentOk)
      .slice(0, 10);
    console.log(`\n  ${v.label} (${fails.length} shown):`);
    for (const { f, r } of fails) {
      const dlist = Object.values(r.grade.details).filter(d => String(d).startsWith('✗'));
      console.log(`    ${f.id.padEnd(28)} ${dlist[0] || r.error || 'unknown'}`);
    }
  }

  // Persist
  const outPath = path.join(__dirname, 'benchmark-3variant-results.json');
  fs.writeFileSync(outPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    fixtureCount: subset.length,
    summary,
    results,
  }, null, 2));
  console.log(`\n  📁 Full results: ${outPath}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
