import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');

test('new Deal is selected only when the plan proves there are no open Deals', () => {
  assert.match(source, /useState\(\(\) => deal\.mode === 'new' \? '__new__' : ''\)/);
  assert.match(source, /setDealChoice\(deal\.mode === 'new' \? '__new__' : ''\)/);
  assert.match(source, /deal\.mode === 'new'[\s\S]*A NEW Deal will be created/);
});

test('existing Deals require an explicit dropdown selection', () => {
  assert.match(source, /deal\.mode === 'choose'[\s\S]*<select[\s\S]*— choose the Deal for this quote —/);
  assert.match(source, /Attach to \$\{od\.name\}/);
  assert.match(source, /<option value="__new__">Create a SEPARATE new Deal<\/option>/);
  assert.doesNotMatch(source, /deal\.mode === 'choose' \? '__new__'/);
});

test('ambiguous account candidates are rendered as a dropdown', () => {
  assert.match(source, /acctPlan\.candidates[\s\S]*— choose the matching Account —/);
  assert.match(source, /onReplan\(\{ account_id: e\.target\.value \}\)/);
});
