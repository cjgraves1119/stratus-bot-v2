// Scope of a trailing "… license" / "… licenses" after the item list.
//
// WHY THIS EXISTS. "quote 1 C8111-G2-MX and 1 z3 license" is a full quote for the
// C8111 (hardware AND licence) plus a licence for the Z3. The trailing singular
// word was read as a whole-cart licence-only modifier, so the C8111 HARDWARE was
// deleted from the cart. The extension then refused to publish any link at all,
// and the same parse runs the Webex/Chat bot, so both surfaces were broken
// (Chris, 2026-08-19).
//
// The list-wide reading is still correct for the PLURAL form: "quote 4 MR44 and
// 2 MX67C licenses" means licences for both. Plurality is the discriminator, so
// both halves are pinned here. A broad before/after sweep over 220 phrasings
// changed exactly the 16 that end in a singular "license" with more than one
// item; everything else was byte-identical.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(WORKER, 'x.cjs'));

function extractWorker() {
  const esc = (r) => path.join(WORKER, 'src', r).replace(/\\/g, '\\\\');
  let src = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');
  src = src.replace(/^import\s+(\w+)\s+from\s+'(\.\/[^']+\.json)';?$/mg, (_, n, r) => `const ${n} = require('${esc(r)}');`);
  src = src.replace(/^import\s+\{[^}]*\}\s+from\s+'cloudflare:workers';?$/m, 'const WorkflowEntrypoint = class {};');
  src = src.replace(/^export\s+(class|function|const|let)\s/mg, '$1 ');
  const i = src.indexOf('export default');
  if (i > -1) { let d = 0, s = false, e = i; for (let k = i; k < src.length; k++) { if (src[k] === '{') { d++; s = true; } if (src[k] === '}') { d--; if (s && d === 0) { e = k + 1; break; } } } src = src.slice(0, i) + src.slice(e + 1); }
  src += `\nmodule.exports={parseMessage,buildQuoteResponse};\n`;
  const t = path.join(WORKER, `.tmp-tls-${process.pid}.cjs`);
  fs.writeFileSync(t, src);
  try { delete require.cache[require.resolve(t)]; return require(t); } finally { fs.unlinkSync(t); }
}
const w = extractWorker();

const intent = async (text) => {
  const parsed = await w.parseMessage(text);
  const map = new Map();
  for (const item of (parsed.items || [])) {
    map.set(item.baseSku, item.licenseOnly ? 'license' : (item.hardwareOnly ? 'hardware' : 'both'));
  }
  return map;
};
const urlsFor = async (text) => {
  const quote = w.buildQuoteResponse(await w.parseMessage(text));
  return [...String(quote.message || '').matchAll(/https:\/\/stratusinfosystems\.com\/order\/\?item=([^\s&]+)&qty=([^\s)\]]+)/g)]
    .map((m) => decodeURIComponent(m[1]));
};

test('the request Chris could not quote', async () => {
  const map = await intent('quote 1 C8111-G2-MX and 1 z3 license');
  assert.equal(map.get('C8111-G2-MX'), 'both', 'the C8111 keeps its hardware');
  assert.equal(map.get('Z3'), 'license', 'the Z3 is the licence-only one');
});

test('the C8111 hardware actually reaches the cart', async () => {
  // The parse flag alone is not the thing that was broken for the rep: the
  // symptom was a URL with no hardware in it, so assert the URL.
  const first = (await urlsFor('quote 1 C8111-G2-MX and 1 z3 license'))[0] || '';
  assert.match(first, /(^|,)C8111-G2-MX(,|$)/, `hardware missing from ${first}`);
  assert.match(first, /LIC-C8111-/, 'the C8111 still gets its own licence');
  assert.match(first, /LIC-Z3-/, 'the Z3 licence is still there');
});

test('the PLURAL form still covers the whole list', async () => {
  const map = await intent('quote 4 MR44 and 2 MX67C licenses');
  assert.equal(map.get('MR44'), 'license');
  assert.equal(map.get('MX67C'), 'license');
});

test('a plural comma list still covers every item', async () => {
  const map = await intent('quote 1 MR44, 1 MX67C, 1 MS130-24 licenses');
  for (const model of ['MR44', 'MX67C', 'MS130-24']) {
    assert.equal(map.get(model), 'license', `${model} should be licence-only`);
  }
});

test('a singular word stranded in its own clause still covers the list', async () => {
  // "no license" holds no item, so it is a request-level statement. This mirrors
  // the trailing bare-hardware rule.
  const map = await intent('quote 2 MR46, no license');
  assert.equal(map.get('MR46'), 'hardware');
});

test('a single item reads the same either way', async () => {
  assert.equal((await intent('quote 1 Z3 license')).get('Z3'), 'license');
  assert.equal((await intent('quote 4 MR44 licenses')).get('MR44'), 'license');
});

test('leading list-level phrasing is untouched', async () => {
  const map = await intent('renewal for 4 MR44 and 2 MX67C');
  assert.equal(map.get('MR44'), 'license');
  assert.equal(map.get('MX67C'), 'license');
});

test('trailing hardware-only phrasing is untouched', async () => {
  const map = await intent('quote 2 MX67C and 4 MR44 hardware only');
  assert.equal(map.get('MX67C'), 'hardware');
  assert.equal(map.get('MR44'), 'hardware');
});

test('a mid-list intent word still stays local', async () => {
  const map = await intent('quote 1 z3 license and 1 C8111-G2-MX');
  assert.equal(map.get('Z3'), 'license');
  assert.equal(map.get('C8111-G2-MX'), 'both');
});
