// Worker-side explicit MX HA intent regressions (2026-08-18).
// Run: node test-ha-intent-2026-08-18.js
//
// The worker half of hasExplicitMxHaIntent had no coverage at all: the existing
// one-shot suites never exercised it. That mattered because a false positive here
// silently HALVES customer-facing licence quantities (warm spare shares one licence
// across an HA pair), and the chrome copy is expected to stay byte-identical.
//
// This extracts the real function from src/index.js and runs it, rather than
// asserting over source text.

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const SRC = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

function grab(name) {
  const start = SRC.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  let paren = SRC.indexOf('(', start);
  let pDepth = 0;
  let body = -1;
  for (let i = paren; i < SRC.length; i++) {
    if (SRC[i] === '(') pDepth++;
    else if (SRC[i] === ')' && --pDepth === 0) { body = SRC.indexOf('{', i); break; }
  }
  let depth = 0;
  for (let i = body; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++;
    else if (SRC[i] === '}' && --depth === 0) return SRC.slice(start, i + 1);
  }
  throw new Error(`could not extract ${name}`);
}

// hasExplicitMxHaIntent is self-contained: testsAny and stripMx84Exclusions are
// declared inside its own body, so no additional helpers need hoisting.
const hasExplicitMxHaIntent = new Function(`${grab('hasExplicitMxHaIntent')}; return hasExplicitMxHaIntent;`)();

let pass = 0;
let fail = 0;
const check = (expected, text, label) => {
  let actual;
  try { actual = hasExplicitMxHaIntent(text); } catch (error) {
    fail++; console.log(`  ✗ ${label}\n      threw: ${error.message}`); return;
  }
  if (actual === expected) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}\n      got ${actual}, expected ${expected} for: ${text}`); }
};

console.log('\n=== Explicit HA intent (worker copy) ===\n');

console.log('Historical / other-site mentions must NOT enable HA:');
check(false, 'Previously we used HA. Quote 4 MX75-HW with 4 LIC-MX75-ENT-3YR.', 'subject between adverb and verb');
check(false, 'Previously the customer deployed HA. Quote 4 MX75-HW.', 'noun-phrase subject');
check(false, 'They use failover at the old site, but the new site is standard. Quote 4 MX75-HW.', 'other-site + copular standard');
check(false, 'We use HA on the previous design; new design is standard.', 'on the previous design');
check(false, 'Previously used HA. Quote 4 MX75-HW.', 'bare past tense');

console.log('\nNegations must NOT enable HA:');
check(false, 'Do not enable HA on these firewalls.', 'do not enable');
check(false, 'Add HA for the MX75s. Scratch that; use standard.', 'later correction');
check(false, 'We have not yet approved HA.', 'not yet approved');
check(false, 'We did not, after review, authorize HA', 'negation across a clause');
check(false, 'Does the MX75 support high availability?', 'capability question');

console.log('\nGenuine requests MUST still enable HA:');
check(true, 'Quote 4 MX75-HW in an HA pair.', 'explicit HA pair');
check(true, 'Please configure high availability for the MX75s.', 'configure HA');
check(true, 'Add HA for the MX75s.', 'bare add HA');
check(true, 'We need warm spare failover on the MX105 units.', 'warm spare failover');
check(true, 'Quote 2 MX75-HW with HA for the old site.', 'request naming a prior site');
check(true, 'The previous quote was standalone. This time we want HA.', 'contrast with prior quote');
check(true, 'Previously standalone. Please add HA now.', 'prior state then request');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
