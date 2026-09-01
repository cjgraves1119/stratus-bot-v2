import assert from 'node:assert/strict';
import test from 'node:test';
import { extractExactStratusOrderUrl } from './src/lib/stratus-order-url.mjs';

const CART = 'https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MX60-ENT-3YR,LIC-MX64-ENT-3YR,LIC-Z1-ENT-3YR&qty=7,3,2,4';

test('Gmail order-link extraction preserves every license quantity through direct and redirect-wrapped links', () => {
  const doubleEncoded = encodeURIComponent(encodeURIComponent(CART));
  const cases = [
    CART,
    `https://www.google.com/url?sa=D&q=${encodeURIComponent(CART)}`,
    `https://mail.google.com/mail/u/0/?continue=${doubleEncoded}`,
    `Review this cart: ${CART}&amp;source=gmail`,
  ];
  for (const raw of cases) {
    const actual = extractExactStratusOrderUrl(raw);
    assert.ok(actual, `the exact cart was lost for ${raw}`);
    const parsed = new URL(actual);
    assert.deepEqual(parsed.searchParams.get('item').split(','), [
      'LIC-ENT-3YR', 'LIC-MX60-ENT-3YR', 'LIC-MX64-ENT-3YR', 'LIC-Z1-ENT-3YR',
    ]);
    assert.deepEqual(parsed.searchParams.get('qty').split(',').map(Number), [7, 3, 2, 4]);
  }
});

test('Gmail order-link extraction rejects non-Stratus and malformed carts', () => {
  assert.equal(extractExactStratusOrderUrl('https://evil.example/order/?item=LIC-ENT-3YR&qty=9'), '');
  assert.equal(extractExactStratusOrderUrl('https://stratusinfosystems.com/order/?item=LIC-ENT-3YR'), '');
  assert.equal(extractExactStratusOrderUrl('https://stratusinfosystems.com/cart/?item=LIC-ENT-3YR&qty=9'), '');
});
