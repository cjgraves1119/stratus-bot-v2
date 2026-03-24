#!/usr/bin/env node
/**
 * Auto-syncs core function implementations from index.js → test-local.js
 * Run after modifying any shared function in src/index.js
 *
 * Usage: node sync-test-functions.js
 */

const fs = require('fs');

const SYNC_FUNCTIONS = [
  'applySuffix',
  'getLicenseSkus',
  'checkEol',
  'isEol',
  'buildStratusUrl',
  'handleEolDateRequest',
];

function extractFunctionBlock(source, funcName) {
  const startPattern = new RegExp(`function ${funcName}\\s*\\(`);
  const match = startPattern.exec(source);
  if (!match) return null;

  let depth = 0;
  let started = false;
  for (let i = match.index; i < source.length; i++) {
    if (source[i] === '{') { depth++; started = true; }
    if (source[i] === '}') { depth--; }
    if (started && depth === 0) {
      return source.slice(match.index, i + 1);
    }
  }
  return null;
}

const indexSource = fs.readFileSync('./src/index.js', 'utf-8');
let testSource = fs.readFileSync('./test-local.js', 'utf-8');

let updated = 0;
for (const fn of SYNC_FUNCTIONS) {
  const indexBlock = extractFunctionBlock(indexSource, fn);
  const testBlock = extractFunctionBlock(testSource, fn);

  if (!indexBlock) {
    console.log(`  ⚠️  ${fn}: not found in index.js`);
    continue;
  }
  if (!testBlock) {
    console.log(`  ⚠️  ${fn}: not found in test-local.js (add manually)`);
    continue;
  }

  if (indexBlock !== testBlock) {
    testSource = testSource.replace(testBlock, indexBlock);
    console.log(`  ✅ ${fn}: synced from index.js`);
    updated++;
  } else {
    console.log(`  ─  ${fn}: already in sync`);
  }
}

if (updated > 0) {
  fs.writeFileSync('./test-local.js', testSource);
  console.log(`\n${updated} function(s) updated in test-local.js`);
} else {
  console.log('\nAll functions already in sync');
}
