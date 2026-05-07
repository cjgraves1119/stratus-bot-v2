#!/usr/bin/env node
import assert from 'node:assert/strict';
import { READ_TOOLS, WRITE_TOOLS, getToolsForToolsRunner, getToolsForCodemodeRunner } from '../src/tool-surface.js';
import { listFixtures, getFixture } from '../src/fixtures.js';
import { canonicalToolSequence, summarizeToolResult } from '../src/shared.js';

assert.ok(READ_TOOLS.length >= 5, 'READ_TOOLS has several entries');
assert.ok(WRITE_TOOLS.length >= 5, 'WRITE_TOOLS has several entries');
assert.equal(getToolsForToolsRunner().length, READ_TOOLS.length + WRITE_TOOLS.length, 'tools runner exposes union');

const split = getToolsForCodemodeRunner();
assert.equal(split.codemodeWrappedReadTools.length, READ_TOOLS.length, 'codemode runner wraps all reads');
assert.equal(split.standardWriteTools.length, WRITE_TOOLS.length, 'codemode runner keeps writes standard');

const readNames = new Set(READ_TOOLS.map(t => t.name));
const writeNames = new Set(WRITE_TOOLS.map(t => t.name));
const overlap = [...readNames].filter(n => writeNames.has(n));
assert.equal(overlap.length, 0, `read/write must not overlap, got: ${overlap.join(',')}`);

for (const name of ['zoho_create_record', 'zoho_update_record', 'create_deal_and_quote', 'create_quote_on_deal', 'quote_to_po_and_esign', 'gmail_send_email']) {
  assert.ok(writeNames.has(name), `destructive tool ${name} missing from WRITE_TOOLS`);
}

const fixtures = listFixtures();
assert.ok(fixtures.length >= 8, `fixture set non-trivial, got ${fixtures.length}`);
for (const f of fixtures) {
  assert.ok(f.id && f.user_message && Array.isArray(f.expected_tools) && f.category, `fixture ${f.id} valid`);
  assert.equal(getFixture(f.id).id, f.id, 'fixture round-trips');
}
const cats = new Set(fixtures.map(f => f.category));
assert.ok(cats.size >= 3, `≥3 categories, got: ${[...cats].join(',')}`);

const a = canonicalToolSequence([{ name: 'a', input: { x: 1, y: 2 }, framework: 'tools' }, { name: 'b', input: { z: 3 }, framework: 'tools' }]);
const b = canonicalToolSequence([{ name: 'a', input: { y: 2, x: 1 }, framework: 'tools' }, { name: 'b', input: { z: 3 }, framework: 'tools' }]);
assert.deepEqual(a, b, 'canonical tool sequence is order-invariant on keys');

const s = summarizeToolResult({ success: true, data: [1, 2, 3] });
assert.equal(s.success, true);
assert.equal(s.record_count, 3);

console.log('test-tool-surface: ok');
