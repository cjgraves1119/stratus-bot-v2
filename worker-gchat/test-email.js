#!/usr/bin/env node
// Local, synthetic regression for detectEmailContent. This test intentionally
// extracts only the pure helper: importing the Worker entrypoint in Node would
// require the Cloudflare runtime, and reading /tmp/test_email.txt made the old
// test depend on an untracked machine-local fixture.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'src/index.js'), 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = source.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`Could not isolate ${name}`);
}

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(extractFunction('detectEmailContent'), sandbox);

const syntheticForward = [
  'Please review the request below.',
  '',
  '---------- Forwarded message ----------',
  'From: Pat Customer <pat.customer@example.test>',
  'Subject: Synthetic access-point request',
  '',
  'Could you quote 4 MR44 access points?',
  'Thanks,',
  'Pat',
].join('\n');

assert.equal(sandbox.detectEmailContent(syntheticForward), true,
  'a checked-in synthetic forwarded email should be detected');
assert.equal(sandbox.detectEmailContent('Subject: Synthetic quote request\nBody text'), true,
  'a Subject header should be detected');
assert.equal(sandbox.detectEmailContent('Please quote 4 MR44 access points.'), false,
  'ordinary chat text should not be classified as an email');

console.log('3 passed, 0 failed');
