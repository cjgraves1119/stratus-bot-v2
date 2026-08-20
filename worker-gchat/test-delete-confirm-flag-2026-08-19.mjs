// The delete safety gate must not throw away a well-formed yes.
//
// WHY THIS EXISTS. Chris asked to delete a quote, confirmed, and got
// "confirm:true is required" twice in a row, with the assistant insisting it had
// passed confirm:true. The gate compared the model's raw tool argument with
// `!== true`, so a serialized STRING "true" was refused (2026-08-19). It read as
// a server bug, cost two extra LLM round trips, and left the quote undeleted.
//
// The gate itself is unchanged in strength: anything that is not an explicit
// affirmative still refuses. These tests pin BOTH halves, and the second half
// matters more.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');

function loadFn(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let depth = 0, started = false, end = start;
  for (let i = start; i < SRC.length; i++) {
    if (SRC[i] === '{') { depth++; started = true; }
    if (SRC[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return new Function(`${SRC.slice(start, end)}\nreturn ${name};`)();
}
const normalize = loadFn('normalizeDeleteConfirmFlag');

test('a real boolean still works', () => {
  assert.equal(normalize(true), true);
  assert.equal(normalize(false), false);
});

test('the string the model actually sent is accepted', () => {
  for (const value of ['true', 'True', 'TRUE', ' true ', 'yes', 'y', '1', 'confirm']) {
    assert.equal(normalize(value), true, `${JSON.stringify(value)} should authorize`);
  }
});

test('an explicit no is still a dry run, not a delete', () => {
  for (const value of ['false', 'False', 'no', 'n', '0', 'dry-run']) {
    assert.equal(normalize(value), false, `${JSON.stringify(value)} should preview`);
  }
});

test('an absent or empty confirm still refuses', () => {
  for (const value of [undefined, null, '', '   ']) {
    assert.notEqual(normalize(value), true);
  }
});

test('this is NOT a truthiness test', () => {
  // The whole point of the gate: a stray value must never authorize a delete.
  // A record id is the dangerous one, since it is exactly what a confused model
  // is most likely to put in the wrong field.
  for (const value of ['2570562000423032087', 'maybe', 'ok', 'sure', 'delete', {}, [], 42, -1, NaN]) {
    assert.notEqual(normalize(value), true, `${JSON.stringify(value)} must NOT authorize a delete`);
  }
});

test('an unrecognized value refuses rather than silently previewing', () => {
  // null is distinct from false: false is a deliberate dry run, null is junk.
  assert.equal(normalize('banana'), null);
  assert.equal(normalize({}), null);
});

test('the delete path uses the normalizer and keeps the refusal', () => {
  const start = SRC.indexOf("case 'zoho_delete_record': {");
  assert.ok(start > 0);
  const block = SRC.slice(start, start + 12000);
  assert.match(block, /confirm = normalizeDeleteConfirmFlag\(confirm\)/);
  assert.match(block, /if \(confirm !== true\)/, 'the gate itself must remain');
});

test('the refusal reports what was actually received', () => {
  // So the next occurrence is diagnosable from the reply and the tail, instead
  // of from a screenshot and a model's own account of what it sent.
  const start = SRC.indexOf('zoho_delete_confirm_refused');
  assert.ok(start > 0, 'refusal is logged');
  const block = SRC.slice(start - 400, start + 900);
  assert.match(block, /confirm_type/);
  assert.match(block, /no confirm field was sent/);
});
