import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { nextFollowUpSubject, requiredBusinessText } from './src/lib/task-subjects.mjs';

test('successive tasks receive stable ordinal follow-up names', () => {
  assert.equal(nextFollowUpSubject('Call customer'), 'First Follow-Up: Call customer');
  assert.equal(nextFollowUpSubject('Follow up: Call customer'), 'Second Follow-Up: Call customer');
  assert.equal(nextFollowUpSubject('Follow up: Follow up: Call customer'), 'Third Follow-Up: Call customer');
  assert.equal(nextFollowUpSubject('First Follow-Up: Call customer'), 'Second Follow-Up: Call customer');
  assert.equal(nextFollowUpSubject('Second Follow-Up: Call customer'), 'Third Follow-Up: Call customer');
  assert.equal(nextFollowUpSubject('20th Follow-Up: Call customer'), '21st Follow-Up: Call customer');
});

test('placeholder business text fails closed without blocking ordinary prose', () => {
  for (const value of ['', null, undefined, 'undefined', 'undefined - SKU', 'null:', '[object Object]',
    'DR01: Reminder to Set a Task. Deal undefined -', 'Call Account null:', 'Contact NaN -']) {
    assert.throws(() => requiredBusinessText(value, 'Task subject'), /missing|placeholder/i);
  }
  assert.equal(requiredBusinessText('EOQ still undefined?', 'Task subject'), 'EOQ still undefined?');
  assert.equal(requiredBusinessText('Resolve undefined behavior', 'Task subject'), 'Resolve undefined behavior');
});

test('both extension task entry points use the ordinal helper and +3 remains reschedule-only', () => {
  const content = fs.readFileSync(new URL('./src/content/index.js', import.meta.url), 'utf8');
  const crm = fs.readFileSync(new URL('./src/sidebar/panels/CrmPanel.jsx', import.meta.url), 'utf8');
  const background = fs.readFileSync(new URL('./src/background/index.js', import.meta.url), 'utf8');
  assert.match(content, /newSubject: nextFollowUpSubject\(task\.subject\)/);
  assert.match(crm, /newSubject: nextFollowUpSubject\(task\.subject\)/);
  assert.match(content, /action: 'reschedule'/);
  assert.match(crm, /handleTaskAction\('reschedule'/);
  assert.match(background, /neither its Deal nor Contact association could be verified/);
  assert.match(background, /neither a Deal nor Contact association could be verified/);
});
