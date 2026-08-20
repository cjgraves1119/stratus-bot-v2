// Fix (2026-08-19): a MIXED cart must never be read as a direct licence list.
//
// Bug: parseMessage's multi-line licence-list branch collected every "LIC-…"
// line and SKIPPED everything else as "headers, garbage, double-pasted data",
// then returned items:[] with licenseOnly:true. When the text was a real cart
// (hardware lines AND licence lines) the hardware was silently destroyed.
//
// This is what the one-shot "Revalidate / re-plan" button hit: the sidebar sent
//   1 C9200L-24P-4G-M / 1 MS150-48LP-4G / 2 MX67C-NA security
//   1 LIC-C9200L-24E-1Y / 1 LIC-MS150-48-1Y / 2 LIC-MX67C-SEC-1YR
// and got back a licence-only quote, so the plan lost all three devices.
//
// Fix: both direct-licence branches now share textNamesHardwareModel(), the
// guard extractEmbeddedDirectLicenseList already had. A text naming real
// hardware falls through to the normal item parser instead of early-returning.
//
// Extracts the REAL functions from src/index.js, no mocks.

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
  const escPath = (rel) => path.join(here, 'src', rel).replace(/\\/g, '\\\\');
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
module.exports = {
  parseMessage,
  buildQuoteResponse,
  textNamesHardwareModel,
  extractEmbeddedDirectLicenseList,
};
`;
  const tmpPath = path.join(here, `.tmp-extract-mixed-hw-${process.pid}.cjs`);
  fs.writeFileSync(tmpPath, src);
  try {
    delete require.cache[require.resolve(tmpPath)];
    return require(tmpPath);
  } finally {
    fs.unlinkSync(tmpPath);
  }
}

const mod = extractRealFunctions();
const skusOf = (parsed) => (parsed?.items || []).map((i) => String(i.baseSku || i.sku || '').toUpperCase());
const firstUrlItems = (parsed) => {
  const quote = mod.buildQuoteResponse(parsed);
  const m = (quote.message || '').match(/item=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]).split(',') : [];
};

// The exact payload the one-shot re-plan sent when Chris set the MX row to SEC.
const REPLAN_TEXT = [
  '1 C9200L-24P-4G-M',
  '1 MS150-48LP-4G',
  '2 MX67C-NA security',
  '1 LIC-C9200L-24E-1Y',
  '1 LIC-MS150-48-1Y',
  '2 LIC-MX67C-SEC-1YR',
].join('\n');

test('the one-shot re-plan payload keeps every device', () => {
  const parsed = mod.parseMessage(REPLAN_TEXT);
  assert.ok(parsed, 'a mixed cart must parse deterministically');
  assert.ok(!parsed.directLicenseList,
    'a cart naming hardware must never route to the direct-licence list');
  assert.notEqual(parsed.modifiers?.licenseOnly, true,
    'the mixed cart must not be forced licence-only');

  const skus = skusOf(parsed);
  for (const hw of ['C9200L-24P-4G-M', 'MS150-48LP-4G', 'MX67C-NA']) {
    assert.ok(skus.includes(hw), `${hw} must survive parsing, got ${skus.join(', ')}`);
  }
});

test('the rendered quote still carries the hardware SKUs', () => {
  const items = firstUrlItems(mod.parseMessage(REPLAN_TEXT));
  for (const hw of ['C9200L-24P-4G-M', 'MS150-48LP-4G', 'MX67C-NA']) {
    assert.ok(items.includes(hw), `${hw} missing from the order URL: ${items.join(', ')}`);
  }
});

test('a hardware line survives even with three licence lines around it', () => {
  // The branch needs >= 2 LIC lines to fire, so one device plus three licences
  // is the smallest shape that reproduced the drop.
  const parsed = mod.parseMessage('2 MX67C-NA\n1 LIC-ENT-1YR\n1 LIC-MV-1YR\n1 LIC-MT-1YR');
  assert.ok(parsed, 'must parse');
  assert.ok(skusOf(parsed).includes('MX67C-NA'), 'the MX must not be discarded');
});

test('comma-separated licences with a device in the list keep the device', () => {
  const parsed = mod.parseMessage('LIC-ENT-1YR, LIC-MV-1YR, 2 MR44');
  assert.ok(parsed, 'must parse');
  assert.ok(!parsed.directLicenseList,
    'a comma list naming hardware is a cart, not a licence export');
});

// ── Regressions: a genuine licence-only paste must still take the fast path ──

test('a pure multi-line dashboard licence export still routes to directLicenseList', () => {
  const parsed = mod.parseMessage('LIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4\nLIC-MX68-SEC-3YR,2');
  assert.ok(Array.isArray(parsed?.directLicenseList),
    'a licence-only export must keep using the direct-licence path');
  assert.equal(parsed.directLicenseList.length, 3);
  assert.equal(parsed.modifiers.licenseOnly, true);
});

test('a pure comma-separated licence list still routes to directLicenseList', () => {
  const parsed = mod.parseMessage('LIC-MX68W-SEC-1YR, LIC-ENT-1YR, LIC-MS220-8P-1YR');
  assert.ok(Array.isArray(parsed?.directLicenseList),
    'a single-line licence list must keep using the direct-licence path');
  assert.equal(parsed.directLicenseList.length, 3);
});

test('a CSV header line is still ignored, it is not hardware', () => {
  const parsed = mod.parseMessage('SKU,Count\nLIC-ENT-3YR,26\nLIC-MS120-8FP-3YR,4');
  assert.ok(Array.isArray(parsed?.directLicenseList),
    'a header row must not be mistaken for a hardware line');
  assert.equal(parsed.directLicenseList.length, 2);
});

// ── The shared guard itself ──

test('textNamesHardwareModel sees devices and ignores licence SKUs', () => {
  assert.equal(mod.textNamesHardwareModel('1 LIC-MX67C-SEC-1YR\n1 LIC-ENT-3YR'), false,
    'a licence SKU embedding a model name must not count as hardware');
  assert.equal(mod.textNamesHardwareModel('2 MX67C-NA'), true);
  assert.equal(mod.textNamesHardwareModel('1 C9200L-24P-4G-M'), true);
  assert.equal(mod.textNamesHardwareModel('1 MS150-48LP-4G'), true);
  assert.equal(mod.textNamesHardwareModel('SKU,Count'), false);
});

test('extractEmbeddedDirectLicenseList still declines a mixed cart', () => {
  assert.equal(mod.extractEmbeddedDirectLicenseList(REPLAN_TEXT), null,
    'the embedded extractor kept its guard through the refactor');
  assert.ok(mod.extractEmbeddedDirectLicenseList('renew LIC-ENT-3YR and LIC-MV-3YR'),
    'a licence-only sentence must still be extracted');
});
