// The shared delete control used by the one-shot card and the Zoho tab.
// Source-level assertions: this is a destructive control, and the properties
// that keep it safe must not be edited away silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.join(EXT, rel), 'utf8');
const CONTROL = read('src/sidebar/components/CrmDeleteControl.jsx');
const CHAT = read('src/sidebar/panels/ChatPanel.jsx');
const CRM = read('src/sidebar/panels/CrmPanel.jsx');
const API = read('src/background/api-client.js');
const BG = read('src/background/index.js');
const CONST = read('src/lib/constants.js');

test('deleting always takes two deliberate steps', () => {
  // The first click only arms and names the record; the second sends it.
  assert.match(CONTROL, /const \[armed, setArmed\] = useState\(false\)/);
  assert.match(CONTROL, /Yes, delete it/);
  assert.match(CONTROL, /onClick=\{arm\}/);
});

test('an armed delete disarms itself', () => {
  // A destructive button left armed on screen is a trap for the next stray click.
  assert.match(CONTROL, /setTimeout\(\(\) => setArmed/);
});

test('the control offers Undo from the returned token', () => {
  assert.match(CONTROL, /Undo delete/);
  assert.match(CONTROL, /MSG\.CRM_UNDO/);
});

test('a failed delete says nothing was deleted', () => {
  assert.match(CONTROL, /Nothing was deleted/);
});

test('a failed undo does not pretend the record is back', () => {
  assert.match(CONTROL, /The record is still deleted/);
});

test('confirm is always sent explicitly as a boolean', () => {
  assert.match(CONTROL, /confirm: true/);
  assert.match(API, /confirm: confirm === true/);
});

test('the message channel and background handlers exist', () => {
  assert.match(CONST, /CRM_DELETE: 'CRM_DELETE'/);
  assert.match(CONST, /CRM_UNDO: 'CRM_UNDO'/);
  assert.match(BG, /\[MSG\.CRM_DELETE\]/);
  assert.match(BG, /\[MSG\.CRM_UNDO\]/);
  assert.match(API, /'\/api\/crm-delete'/);
  assert.match(API, /'\/api\/crm-undo'/);
});

test('the one-shot card offers delete only after it created something', () => {
  assert.match(CHAT, /msg\.executed && \(msg\.records\?\.quote\?\.id \|\| msg\.records\?\.deal\?\.id\)/);
  assert.match(CHAT, /moduleName="Quotes"/);
  assert.match(CHAT, /moduleName="Deals"/);
});

test('the Zoho tab exposes the same control for any known record', () => {
  assert.match(CRM, /function ManualCrmDelete\(\)/);
  assert.match(CRM, /<ManualCrmDelete \/>/);
  assert.match(CRM, /CrmDeleteControl/);
});

test('the manual form distinguishes a record id from a quote number', () => {
  // Passing one as the other is the classic mistake on this path.
  assert.match(CRM, /looksLikeRecordId = \/\^\\d\{15,25\}\$\//);
  assert.match(CRM, /quoteNumber = \(!looksLikeRecordId && isQuote\)/);
});

test('the manual form cannot offer delete with nothing entered', () => {
  assert.match(CRM, /usable \? \(/);
});
