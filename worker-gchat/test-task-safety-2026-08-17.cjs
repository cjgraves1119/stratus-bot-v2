const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('src/index.js', 'utf8');
const start = source.indexOf('const TASK_PLACEHOLDER_ROOT_RE');
const end = source.indexOf('// DST-safe UTC offset', start);
assert.ok(start >= 0 && end > start, 'task safety helper block must exist');
const helperBlock = `${source.slice(start, end)}\nthis.hooks={requiredBusinessText,normalizeRequestedFollowUpSubject};`;
const sandbox = {};
vm.runInNewContext(helperBlock, sandbox);
const { requiredBusinessText, normalizeRequestedFollowUpSubject } = sandbox.hooks;

assert.equal(normalizeRequestedFollowUpSubject('Follow up: Call customer'), 'First Follow-Up: Call customer');
assert.equal(normalizeRequestedFollowUpSubject('Follow up: Follow up: Call customer'), 'Second Follow-Up: Call customer');
assert.equal(normalizeRequestedFollowUpSubject('Third Follow-Up: Call customer'), 'Third Follow-Up: Call customer');
assert.equal(requiredBusinessText('EOQ still undefined?', 'Task subject'), 'EOQ still undefined?');
assert.equal(requiredBusinessText('Resolve undefined behavior', 'Task subject'), 'Resolve undefined behavior');

for (const invalid of ['', null, undefined, 'undefined', 'undefined - SKU', 'null:', '[object Object]',
  'DR01: Reminder to Set a Task. Deal undefined -', 'Account null:', 'Contact NaN -']) {
  assert.throws(() => requiredBusinessText(invalid, 'Task subject'), /missing|placeholder/i);
}

assert.match(source, /existingResp = await zohoApiCall\('GET', `Tasks\/\$\{taskId\}\?fields=Subject,What_Id,Who_Id,Owner`/);
assert.match(source, /Neither the successor Deal nor Contact association could be verified/);
assert.match(source, /owner: existingTask\.Owner\?\.id/);
assert.match(source, /Original task completed, but Zoho did not confirm successor task creation/);
assert.match(source, /A verified Deal or Contact association is required before creating a task/);
assert.match(source, /subject: normalizeRequestedFollowUpSubject\(`Follow up: \$\{requiredBusinessText\(subjectLabel/);
assert.match(source, /PLACEHOLDER_NAME_RE[\s\S]{0,500}undefined\|null/);

console.log('PASS worker task ordinal, placeholder, association, and owner-preservation guards');
