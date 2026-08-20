globalThis.SP="/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify"; globalThis.WORKER_DIR="/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/worker-gchat"; load(globalThis.SP+"/loader.js");
load("/Users/chris/Documents/Codex/2026-08-13/install-and-verify-the-newly-rebuilt/work/stratus-v1.26.8/tools/jsc-verify/node-test-shim.js");
// Fix #3 (2026-08-18): typo'd / explicit license SKUs in a MIXED cart.
//
// Bug: parseMessage's hardware regexes scanned the raw text, so the "MX67C"
// INSIDE "LIC-MX67C-ENT-3YY" matched as a hardware model. The typed licence and
// its quantity were destroyed, a phantom device was added, and buildQuoteResponse
// then re-invented a correct LIC-MX67C-ENT-3YR from that phantom model, so a
// typo quoted "successfully" with no chip and a silently rewritten cart.
//
// Fix: mask LIC- tokens out of a SCAN COPY (same-length blanks, so every
// position-based quantity rule is unaffected), keep the typed token as a
// first-class licence item, resolve it against the LICENCE catalog (never
// validateSku), and fail closed with catalog alternatives when it does not
// resolve. The term-agnostic aliases (LIC-ENT / LIC-MV / LIC-MT / MR-ENT) stay
// valid-by-definition: chipping them is the exact regression that forced the
// Bug 4 revert.
//
// Extracts the REAL functions from src/index.js, no mocks.











const mod = globalThis;
const skusOf = (parsed) => (parsed?.items || []).map(i => String(i.baseSku || i.sku || '').toUpperCase());
const itemFor = (parsed, sku) => (parsed?.items || []).find(i => String(i.baseSku || i.sku || '').toUpperCase() === sku);

test('agnostic aliases are never catalog-validated and never dropped', () => {
  // The Bug 4 revert instruction: these are not catalog SKUs.
  const parsed = mod.parseMessage('quote 7 MR licenses');
  assert.ok(parsed, 'termless MR licence request must still parse');
  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(!quote.needsLlm, 'must stay deterministic');
  assert.match(quote.message, /LIC-ENT-1YR/);
  assert.match(quote.message, /LIC-ENT-3YR/);
  assert.match(quote.message, /LIC-ENT-5YR/);
  assert.doesNotMatch(quote.message, /not in the eCommerce license catalog/);

  // A bare alias typed alongside hardware must not become a concrete item.
  const mixed = mod.parseMessage('quote 2 MR44 and 3 LIC-ENT');
  assert.ok(!skusOf(mixed).includes('LIC-ENT'), 'LIC-ENT alias must not be promoted to a catalog item');
  assert.ok(!mod.buildQuoteResponse(mixed).message.includes('not in the eCommerce license catalog'));
});

test('a typo\'d license in a mixed cart keeps its quantity, invents no hardware, and chips', () => {
  const parsed = mod.parseMessage('quote 2 MR44 and 3 LIC-MX67C-ENT-3YY');
  assert.ok(parsed, 'must parse');

  const skus = skusOf(parsed);
  assert.ok(skus.includes('LIC-MX67C-ENT-3YY'), `typed licence must survive, got ${JSON.stringify(skus)}`);
  assert.ok(!skus.includes('MX67C'), 'no phantom MX67C hardware may be invented from inside the LIC token');

  assert.equal(itemFor(parsed, 'LIC-MX67C-ENT-3YY').qty, 3, 'typed quantity must be 3, not 1');
  assert.equal(itemFor(parsed, 'MR44').qty, 2, 'the hardware line must be untouched');

  const resolution = mod.resolveDirectLicenseCatalogItems([{ sku: 'LIC-MX67C-ENT-3YY', qty: 3 }]);
  assert.equal(resolution.ok, false, 'the typo must not resolve in the catalog');

  const alternatives = mod.directLicenseCatalogAlternatives('LIC-MX67C-ENT-3YY');
  assert.ok(alternatives.includes('LIC-MX67C-ENT-3YR'),
    `chip candidates must include the intended SKU, got ${JSON.stringify(alternatives)}`);

  // Fails closed: the bad licence is reported and never reaches an order URL,
  // while the valid hardware still quotes (same shape as an invalid hardware SKU).
  const quote = mod.buildQuoteResponse(parsed);
  assert.match(quote.message, /LIC-MX67C-ENT-3YY/);
  assert.match(quote.message, /not in the eCommerce license catalog/);
  assert.match(quote.message, /Did you mean: LIC-MX67C-ENT-3YR/);
  for (const url of quote.message.match(/https:\/\/\S+/g) || []) {
    assert.ok(!url.includes('LIC-MX67C-ENT-3YY'), 'never build an order URL for an unresolved SKU');
    assert.ok(!url.includes('MX67C-NA'), 'never add hardware the user did not ask for');
  }
});

test('a valid explicit license in a mixed cart quotes at its typed quantity with no chip', () => {
  const parsed = mod.parseMessage('quote 2 MR44 and 3 LIC-MX67C-ENT-3YR');
  assert.deepEqual(skusOf(parsed), ['MR44', 'LIC-MX67C-ENT-3YR']);
  assert.equal(itemFor(parsed, 'LIC-MX67C-ENT-3YR').qty, 3);

  assert.equal(mod.resolveDirectLicenseCatalogItems([{ sku: 'LIC-MX67C-ENT-3YR', qty: 3 }]).ok, true);

  const quote = mod.buildQuoteResponse(parsed);
  assert.doesNotMatch(quote.message, /not in the eCommerce license catalog/);
  // Term set is rewritten alongside the rest of the cart, hardware is not invented.
  assert.match(quote.message, /item=MR44-HW,LIC-ENT-1YR,LIC-MX67C-ENT-1YR&qty=2,2,3/);
  assert.match(quote.message, /item=MR44-HW,LIC-ENT-3YR,LIC-MX67C-ENT-3YR&qty=2,2,3/);
  assert.match(quote.message, /item=MR44-HW,LIC-ENT-5YR,LIC-MX67C-ENT-5YR&qty=2,2,3/);
  assert.ok(!quote.message.includes('MX67C-NA'));
});

test('the editor requote format behaves identically to the chat format', () => {
  // This is exactly what editableQuoteSkuText sends back on Update quote.
  const parsed = mod.parseMessage('2 MR44-HW\n3 LIC-MX67C-ENT-3YY');
  const skus = skusOf(parsed);
  assert.ok(skus.includes('LIC-MX67C-ENT-3YY'));
  assert.ok(!skus.includes('MX67C'));
  assert.equal(itemFor(parsed, 'LIC-MX67C-ENT-3YY').qty, 3);
  assert.equal(itemFor(parsed, 'MR44').qty, 2);
});

test('license-only carts are unchanged: a typo still routes to directLicense, a valid SKU to the list', () => {
  const typo = mod.parseMessage('3 LIC-MX67C-ENT-3YY');
  assert.deepEqual(typo.items, []);
  assert.deepEqual(typo.directLicense, { sku: 'LIC-MX67C-ENT-3YY', qty: 3 });

  const good = mod.parseMessage('3 LIC-MX67C-ENT-3YR');
  assert.deepEqual(good.items, []);
  assert.deepEqual(good.directLicenseList, [{ sku: 'LIC-MX67C-ENT-3YR', qty: 3 }]);
});

test('directLicenseCatalogAlternatives recovers the stem from a mistyped term tail', () => {
  // Before the fix the malformed "-3YY" tail was treated as part of the stem, so
  // no catalog key could prefix-match and the chip list came back EMPTY.
  assert.deepEqual(mod.directLicenseCatalogAlternatives('LIC-MX67C-ENT-3YY'), ['LIC-MX67C-ENT-3YR']);
  assert.ok(mod.directLicenseCatalogAlternatives('LIC-MX67C-ENT-3YRS').includes('LIC-MX67C-ENT-3YR'));
  // A well-formed SKU keeps its existing behavior.
  assert.ok(mod.directLicenseCatalogAlternatives('LIC-MX67C-ENT-3YR').includes('LIC-MX67C-ENT-3YR'));
});

test('mixed hardware + agnostic license no longer discards the hardware', () => {
  // "quote 7 MR licenses and 1 MX67C license" used to early-return a licence-only
  // term-option quote and silently drop every hardware token in the request.
  const parsed = mod.parseMessage('quote 7 MR licenses and 1 MX67C license');
  const skus = skusOf(parsed);
  assert.ok(skus.includes('MR-AGN'), `MR licences must survive, got ${JSON.stringify(skus)}`);
  assert.ok(skus.includes('MX67C'), `MX67C must no longer be dropped, got ${JSON.stringify(skus)}`);
  assert.equal(itemFor(parsed, 'MR-AGN').qty, 7);

  const quote = mod.buildQuoteResponse(parsed);
  assert.ok(!quote.needsLlm);
  assert.match(quote.message, /LIC-ENT-3YR/);
  assert.match(quote.message, /LIC-MX67C-SEC-3YR/);

  // A pure agnostic request (no other hardware) keeps the original early return.
  const pure = mod.parseMessage('quote 7 MR licenses');
  assert.equal(pure.isTermOptionQuote, true);
  assert.deepEqual(skusOf(pure), ['LIC-ENT-1YR', 'LIC-ENT-3YR', 'LIC-ENT-5YR']);
});

test('editorReadyParsedItems collapses per-term presentations into one editable row', () => {
  const parsed = mod.parseMessage('quote 7 MR licenses');
  const rows = parsed.items.map(i => ({ sku: i.baseSku, qty: i.qty, validation: { valid: true } }));
  const editable = mod.editorReadyParsedItems(rows, parsed);
  assert.equal(editable.length, 1, 'one licence line, not one row per term');
  assert.equal(editable[0].sku, 'LIC-ENT-3YR');
  assert.equal(editable[0].qty, 7);
});

test('editorReadyParsedItems attaches the resolved license SKU to a license-only row', () => {
  const parsed = mod.parseMessage('quote 7 MR licenses and 1 MX67C license');
  const rows = parsed.items.map(i => ({ sku: i.baseSku === 'MR-AGN' ? 'MR-ENT' : i.baseSku, qty: i.qty, validation: { valid: true } }));
  const editable = mod.editorReadyParsedItems(rows, parsed);
  const mx = editable.find(r => r.sku === 'MX67C');
  assert.ok(mx, 'the MX67C row must still be present');
  assert.equal(mx.licenseOnly, true);
  assert.equal(mx.resolvedSku, 'LIC-MX67C-SEC-3YR',
    'the editor needs the licence the quote actually contains, not the bare model');
});

test('a plain hardware quote is untouched by any of the above', () => {
  const parsed = mod.parseMessage('quote 2 MR44 and 1 MX67C');
  assert.deepEqual(skusOf(parsed), ['MR44', 'MX67C']);
  const rows = parsed.items.map(i => ({ sku: i.baseSku, qty: i.qty, validation: { valid: true } }));
  const editable = mod.editorReadyParsedItems(rows, parsed);
  assert.deepEqual(editable.map(r => [r.sku, r.qty, r.resolvedSku]), [['MR44', 2, undefined], ['MX67C', 1, undefined]]);
  const quote = mod.buildQuoteResponse(parsed);
  assert.match(quote.message, /MR44-HW/);
  assert.match(quote.message, /MX67C-NA/);
});

print("\n  %d passed, %d failed".replace("%d", "").length ? "" : "");
print("");
print("  " + globalThis.__testPass + " passed, " + globalThis.__testFails + " failed");
if (globalThis.__testFails > 0) { throw new Error("TEST FAILURES: " + globalThis.__testFails); }
