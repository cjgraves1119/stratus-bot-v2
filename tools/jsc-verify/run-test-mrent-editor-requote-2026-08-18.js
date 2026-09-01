load("/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify/jsc-ext-harness.js");
load("/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify/node-test-shim.js");



// Fix #2 (2026-08-18): the editor must never require the user to reselect a
// full SKU just to bump a quantity when the row is the synthetic MR-ENT /
// LIC-ENT agnostic-license placeholder (quote-client.js's mapQuoteResponse()
// / mrOnlyResult()). Previously the row round-tripped as "<qty> MR-ENT" text,
// which the real worker cannot parse (parseMessage returns null for it),
// breaking the whole requote and forcing a full manual reselect on every row.

test('isSyntheticAgnosticSku recognizes every placeholder token, case-insensitively', () => {
  assert.equal(isSyntheticAgnosticSku('MR-ENT'), true);
  assert.equal(isSyntheticAgnosticSku('mr-ent'), true);
  assert.equal(isSyntheticAgnosticSku('MR_ENT'), true);
  assert.equal(isSyntheticAgnosticSku('LIC-ENT'), true);
  assert.equal(isSyntheticAgnosticSku('lic_ent'), true);
  assert.equal(isSyntheticAgnosticSku('LIC-ENT-3YR'), false);
  assert.equal(isSyntheticAgnosticSku('MX105'), false);
  assert.equal(isSyntheticAgnosticSku(''), false);
});

test('editableRowsFromResult tags the mixed-cart MR-ENT placeholder row as synthetic', () => {
  const rows = editableRowsFromResult({
    parsed: [
      { baseSku: 'MX105', qty: 2 },
      { baseSku: 'MR-ENT', qty: 7 },
    ],
  });
  assert.deepEqual(rows, [
    { sku: 'MX105', qty: 2, unresolved: false, synthetic: false },
    { sku: 'MR-ENT', qty: 7, unresolved: false, synthetic: true },
  ]);
});

test('editableRowsFromResult tags the license-only LIC-ENT placeholder row as synthetic', () => {
  const rows = editableRowsFromResult({ parsed: [{ baseSku: 'LIC-ENT', qty: 10 }] });
  assert.deepEqual(rows, [{ sku: 'LIC-ENT', qty: 10, unresolved: false, synthetic: true }]);
});

test('bumping only the MR-ENT quantity in a mixed cart requotes both rows without reselecting SKUs', () => {
  // Regression case: user only touched the license row's quantity (7 -> 12);
  // the hardware row is untouched. Before the fix this serialized as
  // "2 MX105\n12 MR-ENT", which fails the worker's parseMessage() entirely.
  const rows = [
    { sku: 'MX105', qty: 2 },
    { sku: 'MR-ENT', qty: 12 },
  ];
  const prepared = quoteTextFromEditorRows(rows, 'quote 2 MX105 and 7 licenses');
  assert.equal(prepared.ok, true);
  // MR-ENT line must be in "TOKEN xQTY" order (matches runQuote's mrEntLineRe),
  // not "QTY TOKEN" -- that reversed order is exactly what silently broke it.
  assert.equal(prepared.text, '2 MX105\nMR-ENT x12');
  assert.deepEqual(prepared.rows, [
    { sku: 'MX105', qty: 2 },
    { sku: 'MR-ENT', qty: 12 },
  ]);
});

test('bumping quantity on a license-only LIC-ENT placeholder requotes without reselecting a SKU', () => {
  const rows = [{ sku: 'LIC-ENT', qty: 15 }];
  const prepared = quoteTextFromEditorRows(rows, 'quote 10 MR licenses');
  assert.equal(prepared.ok, true);
  // Canonicalized to MR-ENT regardless of which placeholder label the row carried,
  // since that's the only token runQuote()'s stripper recognizes.
  assert.equal(prepared.text, 'MR-ENT x15');
});

test('a synthetic row combines correctly with a real license row and term modifier', () => {
  const rows = [
    { sku: 'C9300-24P-M', qty: 1 },
    { sku: 'MR-ENT', qty: 3 },
  ];
  const prepared = quoteTextFromEditorRows(rows, 'quote these 3 year');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, '1 C9300-24P-M\nMR-ENT x3\n3 year');
});

test('an out-of-range MR-ENT quantity fails loudly instead of silently dropping the line', () => {
  const rows = [{ sku: 'MR-ENT', qty: 900 }];
  const prepared = quoteTextFromEditorRows(rows, 'quote 900 MR Enterprise licenses');
  assert.equal(prepared.ok, false);
  assert.match(prepared.error, /whole number from 1 to 500/i);
});

test('hardware-only mode still rejects a synthetic license row exactly like an explicit LIC- row', () => {
  const rows = [
    { sku: 'MX85', qty: 2 },
    { sku: 'MR-ENT', qty: 5 },
  ];
  const prepared = quoteTextFromEditorRows(rows, 'quote these hardware only');
  assert.equal(prepared.ok, false);
  assert.match(prepared.error, /cannot include an explicit license SKU/i);
});

test('existing non-synthetic behavior is unchanged: pure hardware rows still serialize identically', () => {
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX105', qty: 2 },
    { sku: 'MX85', qty: 2 },
  ], 'quote these hardware only');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, '2 MX105\n2 MX85\nhardware only');
});

print("\n  %d passed, %d failed".replace("%d", "").length ? "" : "");
print("");
print("  " + globalThis.__testPass + " passed, " + globalThis.__testFails + " failed");
if (globalThis.__testFails > 0) { throw new Error("TEST FAILURES: " + globalThis.__testFails); }
