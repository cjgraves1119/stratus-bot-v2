#!/usr/bin/env node

// Load index.js functions into scope
const fs = require('fs');
const path = require('path');

const indexCode = fs.readFileSync(path.join(__dirname, 'worker/src/index.js'), 'utf-8');

// Create a function to extract and run specific functions
const funcMatch = indexCode.match(/function parseMessage\(text\)[^}]*(?:{[^}]*})*\}/s);
if (!funcMatch) {
  console.error('Could not extract parseMessage function');
  process.exit(1);
}

// Build a minimal test environment
eval(`
  const VALID_SKUS = new Set(${indexCode.match(/const VALID_SKUS = new Set\(\[(.*?)\]\);/s)?.[0] || 'new Set();'});

  ${indexCode.match(/function detectFamily\(baseSku\)[^}]*(?:{[^}]*})*\}/s)?.[0] || 'function detectFamily(){return null;}'}

  ${indexCode.match(/function parseMessage\(text\)[^}]*(?:{[\s\S]*?\n\})/)?.[0] || ''}
`);

// Test the user's input
const testInput = "MR36 7 MR42 1 MR44 340 MR76 1 MS120-24P 11 MS120-48FP 8 MS120-48LP 1 MS130-24P 3 MS130-48P 5 MS130-8P 1 MX85 13";

console.log('Testing inline quantity parsing fix...\n');
console.log(`Input: ${testInput}\n`);

try {
  const parsed = parseMessage(testInput);

  if (!parsed || !parsed.items) {
    console.error('Parse failed or no items found');
    process.exit(1);
  }

  console.log('Parsed items:');
  const items = parsed.items;
  const itemMap = new Map();

  for (const item of items) {
    itemMap.set(item.baseSku, item.qty);
    console.log(`  ${item.baseSku}: qty=${item.qty}`);
  }

  console.log('\n=== VALIDATION ===\n');

  const expected = {
    'MR36': 7,
    'MR42': 1,
    'MR44': 340,
    'MR76': 1,
    'MS120-24P': 11,
    'MS120-48FP': 8,
    'MS120-48LP': 1,
    'MS130-24P': 3,
    'MS130-48P': 5,
    'MS130-8P': 1,
    'MX85': 13
  };

  let allPass = true;
  for (const [sku, expectedQty] of Object.entries(expected)) {
    const actualQty = itemMap.get(sku);
    const pass = actualQty === expectedQty;
    allPass = allPass && pass;
    const status = pass ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${sku} expected qty=${expectedQty}, got qty=${actualQty}`);
  }

  console.log(`\n${allPass ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}`);
  process.exit(allPass ? 0 : 1);

} catch (err) {
  console.error('Error during test:', err.message);
  console.error(err.stack);
  process.exit(1);
}
