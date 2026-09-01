// MR Advanced license SKUs (EXT-MR-ADV-2026-08-31)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

function extractRealFunctions(baseDir, label) {
  const escPath = rel => path.join(baseDir, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(baseDir, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg,
    (_, name, rel) => `const ${name} = require('${escPath(rel)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m,
    'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const edIdx = src.indexOf('export default');
  if (edIdx > -1) {
    let depth = 0, started = false, end = edIdx;
    for (let i = edIdx; i < src.length; i++) {
      if (src[i] === '{') { depth++; started = true; }
      if (src[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
    }
    src = src.slice(0, edIdx) + src.slice(end + 1);
  }
  const workerOnly = label === 'worker'
    ? ', buildQuoteFromV2, normalizeRequestedTier, hasMsAdvancedTierIntent'
    : '';
  const gchatOnly = label === 'gchat'
    ? ', isExplicitMrAdvancedDraftOnlyRequest, requestedTierForHardware'
    : '';
  src += `
module.exports = { parseMessage, buildQuoteResponse, _getLicenseSkusRaw${workerOnly}${gchatOnly} };
`;
  const tmpPath = path.join('/tmp', `.tmp-extract-mr-adv-${label}-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

const gchat = extractRealFunctions(__dirname, 'gchat');
const worker = extractRealFunctions(path.resolve(__dirname, '..', 'worker'), 'worker');

function decodeUrls(msg) {
  const out = [];
  const re = /[?&]item=([^&\s)]+)&qty=([^&\s)]+)/g;
  let m;
  while ((m = re.exec(String(msg || ''))) !== null) {
    out.push({ items: decodeURIComponent(m[1]).split(','), qtys: m[2].split(',').map(Number) });
  }
  return out;
}

test('_getLicenseSkusRaw MR44 A vs default', () => {
  for (const [label, mod] of [['gchat', gchat], ['worker', worker]]) {
    const adv = (mod._getLicenseSkusRaw('MR44', 'A') || []).map((r) => r.sku);
    assert.deepEqual(adv, ['LIC-MR-ADV-1Y', 'LIC-MR-ADV-3Y', 'LIC-MR-ADV-5Y'], label);
    const def = (mod._getLicenseSkusRaw('MR44') || []).map((r) => r.sku);
    assert.deepEqual(def, ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR'], label);
  }
});

function assertAdvancedQuote(mod, label) {
  const parsed = mod.parseMessage('3 MR44 advanced');
  assert.ok(parsed, 'must parse');
  const mr = (parsed.items || []).find((i) => /^MR44/i.test(String(i.baseSku || i.sku || '')));
  assert.equal((mr && mr.requestedTier) || parsed.requestedTier, 'A', label);
  assert.equal(mr && mr.qty, 3);
  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(quote && !quote.needsLlm, 'deterministic');
  const urls = decodeUrls(quote.message);
  assert.ok(urls.length >= 1, 'has order urls');
  const joined = urls.flatMap((u) => u.items).join(',');
  assert.match(joined, /LIC-MR-ADV-1Y/);
  assert.match(joined, /LIC-MR-ADV-3Y/);
  assert.match(joined, /LIC-MR-ADV-5Y/);
  assert.equal(/LIC-ENT/.test(joined), false);
  assert.equal(/LIC-MR-ADV-\d+YR/.test(joined), false);
  assert.equal(/LIC-MR-UPGR/.test(joined), false);
  assert.equal(/E3N-MR-ADV/.test(joined), false);
  for (const u of urls) {
    const hwIdx = u.items.findIndex((s) => /^MR44(-HW)?$/i.test(s));
    assert.ok(hwIdx >= 0, 'hardware MR44 or MR44-HW');
    assert.equal(u.qtys[hwIdx], 3);
    const licIdx = u.items.findIndex((s) => /^LIC-MR-ADV-[135]Y$/i.test(s));
    assert.ok(licIdx >= 0, 'advanced license on url');
    assert.equal(u.qtys[licIdx], 3);
  }
}

test('gchat: 3 MR44 advanced publishes LIC-MR-ADV Y SKUs qty 3', () => {
  assertAdvancedQuote(gchat, 'gchat');
});

test('worker: 3 MR44 advanced publishes LIC-MR-ADV Y SKUs qty 3', () => {
  assertAdvancedQuote(worker, 'worker');
});

test('3 MR44 without advanced keeps LIC-ENT YR', () => {
  for (const [label, mod] of [['gchat', gchat], ['worker', worker]]) {
    const parsed = mod.parseMessage('3 MR44');
    assert.ok(parsed, label);
    const quote = mod.buildQuoteResponse(parsed);
    const joined = decodeUrls(quote.message).flatMap((u) => u.items).join(',');
    assert.match(joined, /LIC-ENT-1YR/, label);
    assert.match(joined, /LIC-ENT-3YR/, label);
    assert.match(joined, /LIC-ENT-5YR/, label);
    assert.equal(/LIC-MR-ADV/.test(joined), false, label);
  }
});

function publishedSkus(mod, text) {
  const parsed = mod.parseMessage(text);
  assert.ok(parsed, text);
  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(quote && !quote.needsLlm, text);
  return decodeUrls(quote.message).flatMap((u) => u.items).join(',');
}

test('mixed MR and switch requests keep Advanced scoped to its own clause', () => {
  for (const [label, mod] of [['gchat', gchat], ['worker', worker]]) {
    const switchAdvanced = publishedSkus(mod, '3 MR44 plus 2 MS130-24P advanced');
    assert.match(switchAdvanced, /LIC-ENT-1YR/, `${label} default MR`);
    assert.match(switchAdvanced, /LIC-MS130-24A-1Y/, `${label} advanced switch`);
    assert.equal(/LIC-MR-ADV/.test(switchAdvanced), false, `${label} MR must not inherit switch Advanced`);

    const mrAdvanced = publishedSkus(mod, '3 MR44 advanced plus 2 MS130-24P');
    assert.match(mrAdvanced, /LIC-MR-ADV-1Y/, `${label} advanced MR`);
    assert.match(mrAdvanced, /LIC-MS130-24-1Y/, `${label} default switch`);
    assert.equal(/LIC-MS130-24A-/.test(mrAdvanced), false, `${label} switch must not inherit MR Advanced`);
  }
});

test('reviewer reproduction: multiline C9200L Advanced does not upgrade default MR', () => {
  for (const [label, mod] of [['gchat', gchat], ['worker', worker]]) {
    const published = publishedSkus(mod, '3 MR44\n2 C9200L-24P-4G-M advanced');
    assert.match(published, /LIC-ENT-1YR/, `${label} default MR`);
    assert.match(published, /LIC-C9200L-24A-1Y/, `${label} advanced C9200L`);
    assert.equal(/LIC-MR-ADV/.test(published), false, `${label} MR must not inherit C9200L Advanced`);
  }
});

test('active Webex V2 adapter preserves Advanced for MR and Meraki-managed CW916x', () => {
  assert.equal(worker.hasMsAdvancedTierIntent('3 MR44 advanced'), true);
  assert.equal(worker.hasMsAdvancedTierIntent('3 CW9164I advanced'), true);
  assert.equal(worker.normalizeRequestedTier('A', '3 MR44 advanced'), 'A');
  assert.equal(worker.normalizeRequestedTier('A', '3 CW9164I advanced'), 'A');

  const v2 = {
    intent: 'quote',
    items: [{ sku: 'MR44', qty: 3, sku_type: 'hardware' }],
    modifiers: {
      hardware_only: false,
      license_only: false,
      with_license: true,
      term_years: null,
      tier: 'A',
      show_pricing: false,
      all_terms: true,
      separate_quotes: false,
    },
    reference: {},
  };
  const parsed = worker.buildQuoteFromV2(v2, '3 MR44 advanced');
  assert.equal(parsed.requestedTier, 'A');
  const quote = worker.buildQuoteResponse(parsed);
  const joined = decodeUrls(quote.message).flatMap((url) => url.items).join(',');
  assert.match(joined, /LIC-MR-ADV-1Y/);
  assert.equal(/LIC-ENT/.test(joined), false);
});

test('active V3 prompts teach Advanced for MR and Meraki-managed CW916x', () => {
  for (const rel of ['../worker/src/index.js', 'src/index.js']) {
    const source = fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
    assert.match(source, /const CF_CLASSIFIER_PROMPT_V3_ACTIVE =/);
    assert.match(source, /MR ADVANCED TIER RULE:/);
    assert.match(source, /Meraki-managed CW916x access point/);
    assert.match(source, /Other CW families retain their existing rules/);
    assert.match(source, /content: CF_CLASSIFIER_PROMPT_V3_ACTIVE/);
  }
});

test('chat-tab draft-only guard accepts exact no-write MR Advanced prompts for every standard term', () => {
  for (const term of [1, 3, 5]) {
    const text = `Quote 1 MR44 with Advanced licensing for ${term} year${term === 1 ? '' : 's'}. Draft only. Do not create any CRM record.`;
    assert.equal(gchat.isExplicitMrAdvancedDraftOnlyRequest(text), true, `${term}Y guard`);
    const parsed = gchat.parseMessage(text);
    assert.ok(parsed, `${term}Y parsed`);
    const quote = gchat.buildQuoteResponse(parsed);
    const joined = decodeUrls(quote.message).flatMap((url) => url.items).join(',');
    assert.match(joined, new RegExp(`LIC-MR-ADV-${term}Y`), `${term}Y advanced`);
    assert.equal(/LIC-ENT/.test(joined), false, `${term}Y no enterprise fallback`);
  }
});

test('chat-tab guard stays closed without both draft-only and explicit no-write language', () => {
  assert.equal(gchat.isExplicitMrAdvancedDraftOnlyRequest('Quote 1 MR44 Advanced for 3 years.'), false);
  assert.equal(gchat.isExplicitMrAdvancedDraftOnlyRequest('Quote 1 MR44 Advanced for 3 years. Draft only.'), false);
  assert.equal(gchat.isExplicitMrAdvancedDraftOnlyRequest('Quote 1 MR44 Advanced Security for 3 years. Draft only. Do not create any CRM record.'), false);
  assert.equal(gchat.isExplicitMrAdvancedDraftOnlyRequest('Quote 1 CW9164 Advanced for 3 years. Draft only. Do not create any CRM record.'), true);
});

test('CRM auto-pair tier is explicit and scoped to MR / Meraki-managed CW916x hardware', () => {
  assert.equal(gchat.requestedTierForHardware('MR44', { license_tier: 'A' }), 'A');
  assert.equal(gchat.requestedTierForHardware('MR44-HW', {}, 'Quote MR44 with Advanced licensing'), 'A');
  assert.equal(gchat.requestedTierForHardware('MR44', {}, 'Quote MR44 with Advanced Security'), null);
  assert.equal(gchat.requestedTierForHardware('CW9164I', { license_tier: 'A' }), 'A');
  assert.equal(gchat.requestedTierForHardware('MS130-24P', { license_tier: 'A' }), null);
});

test('active CRM prompt, schema, and chat waterfall enforce MR Advanced mapping', () => {
  const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');
  assert.match(source, /Explicit Advanced\/ADV on MR or CW916x uses \*\*LIC-MR-ADV-\{term\}Y\*\*/);
  assert.match(source, /license_tier:\"A\"/);
  assert.doesNotMatch(source, /MR Enterprise License — UNIVERSAL across all MR APs/);
  assert.match(source, /deterministic-mr-advanced-draft/);
  assert.match(source, /getLicenseSkus\(rawSku, requestedLicenseTier\)/);
});
