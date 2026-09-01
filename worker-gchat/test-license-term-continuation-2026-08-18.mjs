// Real end-to-end test for the license-term-gate continuation fix (2026-08-18).
//
// Bug: "7 MR licenses" (no term) -> detectAmbiguousLicenseTerm asks "Which
// MR Enterprise license term should I use: 1 year, 3 year, or 5 year?".
// A bare "3 year" reply had NO deterministic continuation (unlike Duo/
// Umbrella), so it fell through to CRM-follow-up-forced-Claude routing
// instead of re-quoting deterministically. Fix: buildTierClarifyContinuation
// now recognizes the license-term gate's own question and reconstructs
// "<original request> <term> year" so it re-enters parseMessage/
// buildQuoteResponse cleanly, just like a fresh typed request.
//
// This test extracts the REAL functions from src/index.js (no mocks) using
// the same require-after-strip pattern as stratus_probe/extract.js, then
// exercises the full continuation -> parse -> quote pipeline end-to-end.

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

  // Same strip-and-require pattern as stratus_probe/extract.js: rewrite JSON
  // imports to require(), drop the cloudflare:workers import, de-export
  // top-level declarations, and cut the `export default { fetch... }` block.
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
module.exports = {
  parseMessage,
  buildQuoteResponse,
  detectAmbiguousLicenseTerm,
  buildTierClarifyContinuation,
  validateSku,
};
`;

  const tmpPath = path.join(here, `.tmp-extract-lic-term-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const mod = extractRealFunctions();

test('detectAmbiguousLicenseTerm still fires for a bare "7 MR licenses" request', () => {
  const gate = mod.detectAmbiguousLicenseTerm('7 MR licenses');
  assert.ok(gate, 'expected the ambiguous-term gate to fire for a termless request');
  assert.match(gate.askMessage || gate.message || '', /license term should I use/i);
});

test('buildTierClarifyContinuation reconstructs a bare "3 year" reply into a full quote request', () => {
  const gateQuestion = 'Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year?';
  const priorUserText = '7 MR licenses and 1 MX67C license';

  const reconstructed = mod.buildTierClarifyContinuation('3 year', gateQuestion, priorUserText);
  assert.equal(reconstructed, '7 MR licenses and 1 MX67C license 3 year');
});

test('buildTierClarifyContinuation handles bare digit and word-number term replies', () => {
  const gateQuestion = 'Which MV Cloud license term should I use: 1 year, 3 year, or 5 year?';
  const priorUserText = '4 MV cameras';

  assert.equal(mod.buildTierClarifyContinuation('1 year', gateQuestion, priorUserText), '4 MV cameras 1 year');
  assert.equal(mod.buildTierClarifyContinuation('5yr', gateQuestion, priorUserText), '4 MV cameras 5 year');
  assert.equal(mod.buildTierClarifyContinuation('five years', gateQuestion, priorUserText), '4 MV cameras 5 year');
});

test('buildTierClarifyContinuation returns null without a prior user message (no silent guess)', () => {
  const gateQuestion = 'Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year?';
  assert.equal(mod.buildTierClarifyContinuation('3 year', gateQuestion, null), null);
  assert.equal(mod.buildTierClarifyContinuation('3 year', gateQuestion, ''), null);
});

test('buildTierClarifyContinuation ignores non-term replies to the license-term gate (falls through)', () => {
  const gateQuestion = 'Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year?';
  const priorUserText = '7 MR licenses';
  assert.equal(mod.buildTierClarifyContinuation('what is the difference', gateQuestion, priorUserText), null);
  assert.equal(mod.buildTierClarifyContinuation('cost of 3 year', gateQuestion, priorUserText), null);
});

test('END-TO-END: reconstructed request parses into a valid, LLM-free quote (no dropped items, no bogus suggestions)', () => {
  const gateQuestion = 'Which MR Enterprise license term should I use: 1 year, 3 year, or 5 year?';
  const priorUserText = '7 MR licenses and 1 MX67C license';

  const reconstructed = mod.buildTierClarifyContinuation('3 year', gateQuestion, priorUserText);
  assert.ok(reconstructed, 'continuation must produce a reconstructed request');

  const parsed = mod.parseMessage(reconstructed);
  assert.ok(parsed, 'parseMessage must return a result for the reconstructed request');
  assert.ok(Array.isArray(parsed.items) && parsed.items.length > 0, 'parsed items must not be empty');

  // Every parsed baseSku must be something the quote engine can actually
  // resolve: a real hardware model, a LIC-prefixed licence, or one of the
  // valid-by-definition aliases the /api/quote validation loop also exempts
  // (the model-agnostic "-AGN" families and the CW Wi-Fi 6E/7 bare stems,
  // which buildQuoteResponse promotes itself). validateSku only knows hardware
  // models, so applying it to the others is a false negative, not a finding.
  //
  // 2026-08-18: MR-AGN legitimately appears here now. The agnostic-licence
  // handler used to early-return a licence-only quote and silently DROP the
  // MX67C in this very request; it now defers to the mixed-cart path, so the
  // request parses as MR-AGN + MX67C and both survive into the quote.
  const validByDefinition = (sku) => sku.startsWith('LIC-')
    || /^(MR|MV|MT|SME)-AGN$/.test(sku)
    || /^CW9(16|17)\d/.test(sku);
  for (const item of parsed.items) {
    const upper = String(item.baseSku || '').toUpperCase();
    if (!validByDefinition(upper)) {
      const v = mod.validateSku(upper);
      assert.ok(v.valid, `expected ${upper} to validate as a real SKU, got: ${JSON.stringify(v)}`);
    }
  }
  // The hardware token in the original request must not be dropped.
  const parsedSkus = parsed.items.map(i => String(i.baseSku || '').toUpperCase());
  assert.ok(parsedSkus.includes('MX67C'), `MX67C must survive the continuation, got ${JSON.stringify(parsedSkus)}`);

  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(quote, 'buildQuoteResponse must return a result for the reconstructed request');
  assert.ok(!quote.needsLlm, 'the reconstructed request must resolve deterministically, without invoking Claude');
});

test('Duo/Umbrella continuation behavior is unchanged by the license-term branch (regression guard)', () => {
  const duoQuestion = 'Which Cisco Duo tier do you need? (qty: 25)';
  const reconstructed = mod.buildTierClarifyContinuation('Essentials', duoQuestion, 'irrelevant prior text');
  assert.ok(reconstructed, 'Duo tier continuation must still work');
  assert.match(reconstructed, /Essentials/i);
});
