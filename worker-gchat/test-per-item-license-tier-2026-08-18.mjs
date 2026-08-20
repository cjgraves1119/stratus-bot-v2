// Per-item license tiers (2026-08-18): MX SEC + switch Advanced on one quote.
// Global requestedTier used to win for every item, so mixed carts were impossible.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function extractRealFunctions() {
  const here = __dirname;
  const escPath = rel => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(here, 'src/index.js'), 'utf8');
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
  src += `
module.exports = { parseMessage, buildQuoteResponse };
`;
  const tmpPath = path.join('/tmp', `.tmp-extract-item-tier-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

const mod = extractRealFunctions();

function licensesFor(parsed, sku) {
  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(quote && !quote.needsLlm, 'must stay deterministic');
  const three = String(quote.message || '').split('\n').find((line) => /3-Year|3 Year|LIC-.*-3Y/i.test(line) && /stratusinfosystems\.com\/order/i.test(line))
    || String(quote.message || '').split('\n').find((line) => /stratusinfosystems\.com\/order/i.test(line));
  return three || quote.message;
}

test('mixed MX SEC + Catalyst Advanced keeps both item licenses', () => {
  const parsed = mod.parseMessage('2 MX67W security\n1 C9200L-24P-4G-M advanced');
  assert.ok(parsed, 'mixed request must parse');
  const mx = (parsed.items || []).find((i) => String(i.baseSku).toUpperCase().startsWith('MX67W'));
  const sw = (parsed.items || []).find((i) => String(i.baseSku).toUpperCase().includes('C9200L'));
  assert.equal(mx?.requestedTier, 'SEC');
  assert.equal(sw?.requestedTier, 'A');
  const message = licensesFor(parsed, 'MX67W');
  assert.match(message, /LIC-MX67W-SEC-/);
  assert.doesNotMatch(message, /LIC-MX67W-ENT-/);
  assert.match(message, /LIC-C9200L-24A-/);
});

test('global security without per-row modifiers still applies to MX', () => {
  const parsed = mod.parseMessage('quote 2 MX105 security');
  assert.ok(parsed);
  const quote = mod.buildQuoteResponse(parsed);
  assert.match(quote.message, /LIC-MX105-SEC-/);
});
