load("/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify/jsc-ext-harness.js");
load("/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify/node-test-shim.js");



// Fix #4 (2026-08-18). Chris's testing note: "when i need to make the change, i
// need to go back into both line items and select the full sku to make quantity
// edits in order properly requote."
//
// Two causes, both fixed here:
//
//   1. A license-only line was pre-filled with the bare HARDWARE model (MX67C)
//      even though the quote actually contains LIC-MX67C-SEC-3YR. Re-quoting the
//      bare model silently re-added hardware the user never asked for, so the
//      only way to get a faithful requote was to retype the full SKU by hand.
//      The worker now sends an additive `resolvedSku`; the row uses it.
//   2. quoteModeFromText read the tier and term out of the INSIDE of a license
//      SKU in the prior request text. A prior quote of "2 MR44 and 3
//      LIC-MX67C-ENT-3YR" matched \bENT\b and \b3YR\b within the SKU, so every
//      requote appended "enterprise" and "3 year" and collapsed a 1/3/5-year
//      quote to a single 3-year URL.

test('a license-only row is pre-filled with the resolved license SKU, not the bare model', () => {
  const rows = editableRowsFromResult({
    parsed: [
      { baseSku: 'MR-ENT', qty: 7 },
      { baseSku: 'MX67C', qty: 1, licenseOnly: true, resolvedSku: 'LIC-MX67C-SEC-3YR' },
    ],
  });
  assert.deepEqual(rows, [
    { sku: 'MR-ENT', qty: 7, unresolved: false, synthetic: true },
    { sku: 'LIC-MX67C-SEC-3YR', qty: 1, unresolved: false, synthetic: false, typedSku: 'MX67C' },
  ]);
});

test('a row without resolvedSku keeps exactly its previous shape', () => {
  const rows = editableRowsFromResult({ parsed: [{ baseSku: 'MX105', qty: 2 }] });
  assert.deepEqual(rows, [{ sku: 'MX105', qty: 2, unresolved: false, synthetic: false }]);
});

test('an unresolved suggestion still flags the row when the worker resolved it', () => {
  const rows = editableRowsFromResult({
    parsed: [{ baseSku: 'MX67C', qty: 1, resolvedSku: 'LIC-MX67C-SEC-3YR' }],
    suggestions: [{ input: 'MX67C', suggest: ['MX67C-HW'] }],
  });
  assert.equal(rows[0].unresolved, true, 'the suggestion targets the typed model, not the resolved SKU');
});

test('quoteModeFromText does not read a tier or term out of a license SKU', () => {
  const mode = quoteModeFromText('quote 2 MR44 and 3 LIC-MX67C-ENT-3YR');
  assert.equal(mode.tier, null, 'the ENT inside the SKU is not a tier request');
  assert.equal(mode.term, null, 'the 3YR inside the SKU is not a term request');
  assert.equal(mode.hardwareOnly, false);
  assert.equal(mode.licenseOnly, false);
});

test('quoteModeFromText still reads a tier and term the user actually typed', () => {
  assert.deepEqual(quoteModeFromText('quote 20 MR44 security 5 year'), {
    hardwareOnly: false, licenseOnly: false, tier: 'security', term: '5',
  });
  assert.deepEqual(quoteModeFromText('quote 5 MR36 hardware only'), {
    hardwareOnly: true, licenseOnly: false, tier: null, term: null,
  });
  assert.equal(quoteModeFromText('quote 3 MX105 enterprise 3 year').tier, 'enterprise');
  // license-only wording never appears inside a SKU, so it still reads raw text
  assert.equal(quoteModeFromText('quote 4 MR44 license only').licenseOnly, true);
});

test('a quantity-only edit on a resolved license row round-trips without extra modifiers', () => {
  const priorText = 'quote 2 MR44 and 3 LIC-MX67C-ENT-3YR';
  const rows = editableRowsFromResult({
    parsed: [
      { baseSku: 'MR44', qty: 2 },
      { baseSku: 'LIC-MX67C-ENT-3YR', qty: 3, licenseOnly: true },
    ],
  });
  const edited = rows.map((row) => (row.sku.startsWith('LIC-') ? { ...row, qty: 10 } : row));
  const prepared = quoteTextFromEditorRows(edited.map(({ sku, qty }) => ({ sku, qty })), priorText);
  assert.equal(prepared.ok, true);
  // No phantom "enterprise" / "3 year" tail: those would pin the requote to a
  // single term and throw away the 1-year and 5-year options.
  assert.equal(prepared.text, '2 MR44\n10 LIC-MX67C-ENT-3YR');
});

print("\n  %d passed, %d failed".replace("%d", "").length ? "" : "");
print("");
print("  " + globalThis.__testPass + " passed, " + globalThis.__testFails + " failed");
if (globalThis.__testFails > 0) { throw new Error("TEST FAILURES: " + globalThis.__testFails); }
