#!/usr/bin/env node
import assert from 'node:assert/strict';
import { listFixtures } from '../src/fixtures.js';

const fixtures = listFixtures();
const required = ['read_simple', 'read_multi_step', 'write_prep', 'write_prep_complex', 'multi_step', 'multi_step_full'];
const present = new Set(fixtures.map(f => f.category));
for (const cat of required) assert.ok(present.has(cat), `missing required category: ${cat}`);

const requiredIds = ['fix_005_clone_quote_with_discount_change', 'fix_009_long_subform_update', 'fix_007_disambiguate_then_write'];
const ids = new Set(fixtures.map(f => f.id));
for (const id of requiredIds) assert.ok(ids.has(id), `missing required fixture: ${id}`);

for (const f of fixtures) {
  assert.ok(f.user_message.length > 10, `${f.id}: user_message too short`);
  assert.ok(f.expected_tools.length >= 1, `${f.id}: should have ≥1 expected tool`);
}

console.log(`test-fixtures: ok (${fixtures.length} fixtures, ${present.size} categories)`);
