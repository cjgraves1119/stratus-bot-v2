// Scripted CRM delete + undo endpoints.
//
// WHY THIS EXISTS. Deleting a record could only run through the chat agent:
// ask, let it search, confirm, let it call the tool. Two LLM round trips at
// roughly 15 seconds each (Chris, 2026-08-19). Everywhere the record_id or
// quote_number is already known, that is pure waste.
//
// The route adds NO capability the chat did not already have. It delegates to
// the same zoho_delete_record tool, so the subform refusal, the
// Quote_Number-as-record_id check, the pre-delete snapshot and the undo token
// all still apply. These tests pin the parts a UI mistake could otherwise slip
// past: the confirm requirement, the module allowlist, and the delegation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.dirname(fileURLToPath(import.meta.url));
const SRC = fs.readFileSync(path.join(WORKER, 'src/index.js'), 'utf8');

function routeBlock(name) {
  const start = SRC.indexOf(`case '/api/${name}': {`);
  assert.ok(start > 0, `/api/${name} not found`);
  const end = SRC.indexOf("case '/api/", start + 20);
  return SRC.slice(start, end > start ? end : start + 6000);
}

test('the delete route refuses without confirm', () => {
  const block = routeBlock('crm-delete');
  assert.match(block, /normalizeDeleteConfirmFlag\(apiBody\?\.confirm\) !== true/,
    'the same normalizer the tool uses must gate the route');
  assert.match(block, /confirm must be true to delete/);
});

test('the delete route refuses a module outside the allowlist', () => {
  const block = routeBlock('crm-delete');
  assert.match(block, /CRM_DELETE_ALLOWED_MODULES\.includes\(cdModule\)/);
});

test('customer records are NOT deletable through this route', () => {
  // Deleting an Account or a Contact is not an "undo the thing I just made"
  // action, so it stays a deliberate, chat-only act.
  const start = SRC.indexOf('const CRM_DELETE_ALLOWED_MODULES');
  const line = SRC.slice(start, SRC.indexOf('\n', start));
  for (const module of ['Accounts', 'Contacts', 'Leads']) {
    assert.ok(!line.includes(`'${module}'`), `${module} must not be in the allowlist`);
  }
  for (const module of ['Quotes', 'Deals']) {
    assert.ok(line.includes(`'${module}'`), `${module} should be deletable`);
  }
});

test('the delete route needs something to identify the record', () => {
  assert.match(routeBlock('crm-delete'), /record_id or quote_number is required/);
});

test('the delete route delegates to the guarded tool, not raw Zoho', () => {
  const block = routeBlock('crm-delete');
  assert.match(block, /executeToolCall\('zoho_delete_record'/);
  assert.ok(!/zohoApiCall\('DELETE'/.test(block),
    'it must not bypass the tool and delete directly');
});

test('the delete route returns the undo token', () => {
  // Without it the UI cannot offer Undo, which is the whole safety net.
  assert.match(routeBlock('crm-delete'), /undo_token: cdResult\?\._undo_token/);
});

test('the undo route delegates to undo_crm_action and needs a token', () => {
  const block = routeBlock('crm-undo');
  assert.match(block, /undo_token is required/);
  assert.match(block, /executeToolCall\('undo_crm_action'/);
});

test('both routes are logged', () => {
  assert.match(SRC, /crm_delete_scripted/);
  assert.match(SRC, /crm_undo_scripted/);
});

test('a failed delete never reports success', () => {
  const block = routeBlock('crm-delete');
  assert.match(block, /success: cdResult\?\.success === true/);
});
