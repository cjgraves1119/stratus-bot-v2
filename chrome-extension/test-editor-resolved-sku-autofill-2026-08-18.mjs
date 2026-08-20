import assert from 'node:assert/strict';
import test from 'node:test';

import {
  editableRowsFromResult,
  quoteModeFromText,
  quoteTextFromEditorRows,
} from './src/sidebar/components/sku-editor-core.mjs';

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

// ── License tier dropdown (2026-08-18) ──
// Chris: "Need drop down selector of license type (ENT/SEC for MX's) or the 'A'
// (Advanced) tier for the compatible switches or ADV for MR's - keeping the same
// defaults though but making it easier to make the change without needing to type."
// The dropdown must emit the exact wording the WORKER's tier detection accepts,
// and picking nothing must leave today's behavior byte-identical.

test('every tier option emits wording the worker tier detector actually matches', async () => {
  const { LICENSE_TIER_OPTIONS, licenseTierModifier } =
    await import('./src/sidebar/components/sku-editor-core.mjs');

  // These mirror parseMessage's own regexes in worker-gchat/src/index.js.
  const workerTier = (text) => {
    const upper = String(text).toUpperCase();
    const msAdvanced = /\b(MS130|MS150|MS390|C9\d{3}|C9200L|C9300)\b/.test(upper)
      && !/\bADVANCED\s+SECURITY\b/.test(upper)
      && (/\b(ADVANCED|ADV)\s*(LICENSE|LICENSING|LICENCE|LIC|FEATURES?|TIER)?\b/.test(upper)
        || /\bADAPTIVE\s+POLICY\b/.test(upper));
    if (msAdvanced) return 'A';
    if (/\b(ADVANCED\s+SECURITY|SEC(URITY)?)\b/.test(upper) && !/\bENTERPRISE\b/.test(upper)) return 'SEC';
    if (/\bENT(ERPRISE)?\b/.test(upper) && !/\bSEC(URITY)?\b/.test(upper)) return 'ENT';
    if (/\b(SD[\s-]?WAN|SDW)\b/.test(upper)) return 'SDW';
    return null;
  };

  assert.equal(LICENSE_TIER_OPTIONS[0].value, '', 'first option must be the no-op default');
  assert.equal(licenseTierModifier(''), null, 'the default must add no modifier at all');

  // A Catalyst model has to be in the cart for the "A" tier to be detectable,
  // which is exactly the worker's own rule.
  assert.equal(workerTier(`2 C9200L-24P\n${licenseTierModifier('advanced')}`), 'A');
  assert.equal(workerTier(`2 MX105\n${licenseTierModifier('security')}`), 'SEC');
  assert.equal(workerTier(`2 MR44\n${licenseTierModifier('enterprise')}`), 'ENT');
  assert.equal(workerTier(`2 MX105\n${licenseTierModifier('sdwan')}`), 'SDW');
});

test('a tier pick overrides the inferred tier, and no pick changes nothing', async () => {
  const { quoteTextFromEditorRows, licenseTierValueFromMode } =
    await import('./src/sidebar/components/sku-editor-core.mjs');
  const rows = [{ sku: 'MX105', qty: 2 }];

  // No override: byte-identical to the two-argument call.
  assert.equal(
    quoteTextFromEditorRows(rows, 'quote 2 MX105').text,
    quoteTextFromEditorRows(rows, 'quote 2 MX105', {}).text,
  );
  assert.equal(quoteTextFromEditorRows(rows, 'quote 2 MX105', { tier: '' }).text, '2 MX105');

  // Explicit pick wins.
  assert.equal(quoteTextFromEditorRows(rows, 'quote 2 MX105', { tier: 'security' }).text, '2 MX105\nsecurity');
  assert.equal(quoteTextFromEditorRows(rows, 'quote 2 MX105', { tier: 'enterprise' }).text, '2 MX105\nenterprise');

  // Explicit pick replaces a tier that came from the prior request text.
  assert.equal(
    quoteTextFromEditorRows(rows, 'quote 2 MX105 enterprise', { tier: 'security' }).text,
    '2 MX105\nsecurity',
  );
  // and with no pick, the inferred tier still carries through
  assert.equal(quoteTextFromEditorRows(rows, 'quote 2 MX105 enterprise').text, '2 MX105\nenterprise');

  // The control reopens showing whatever tier the quote actually used.
  assert.equal(licenseTierValueFromMode('security'), 'security');
  assert.equal(licenseTierValueFromMode('advanced license'), 'advanced');
  assert.equal(licenseTierValueFromMode(null), '');
});

test('a tier pick never overrides Hardware Only', async () => {
  const { quoteTextFromEditorRows } = await import('./src/sidebar/components/sku-editor-core.mjs');
  const prepared = quoteTextFromEditorRows([{ sku: 'MX105', qty: 2 }], 'quote 2 MX105 hardware only', { tier: 'security' });
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, '2 MX105\nhardware only', 'hardware only must still suppress the tier word');
});

test('the Advanced tier keeps the hardware in the cart', async () => {
  // Regression: the option originally emitted "advanced license". The worker's
  // assignClauseIntent saw the trailing LICENSE and read the whole request as
  // license-only, so picking Advanced silently DROPPED the switch and quoted a
  // bare licence. The modifier must stay the bare word.
  const { quoteTextFromEditorRows, licenseTierModifier, quoteModeFromText } =
    await import('./src/sidebar/components/sku-editor-core.mjs');
  const LIC_ONLY = /\b(LICENSE[S]?|LICENCE[S]?|RENEWAL[S]?|RENEW)\b/i;

  for (const option of ['enterprise', 'security', 'advanced', 'sdwan']) {
    const modifier = licenseTierModifier(option);
    assert.ok(modifier, `${option} must have a modifier`);
    assert.doesNotMatch(modifier, LIC_ONLY,
      `tier modifier "${modifier}" must not contain a license-only keyword`);
  }

  const prepared = quoteTextFromEditorRows([{ sku: 'C9200L-24P-4G-M', qty: 1 }], 'quote 1 C9200L-24P', { tier: 'advanced' });
  assert.equal(prepared.text, '1 C9200L-24P-4G-M\nadvanced');

  // The same trap on the tier inferred from prior request text.
  assert.equal(quoteModeFromText('quote 2 C9300-24P-M advanced license').tier, 'advanced');
  assert.doesNotMatch(
    quoteTextFromEditorRows([{ sku: 'C9300-24P-M', qty: 2 }], 'quote 2 C9300-24P-M advanced license').text,
    LIC_ONLY,
  );
});


test('family-specific tier options hide MX SEC on an MR row', async () => {
  const { licenseFamilyForSku, licenseTierOptionsForSku } =
    await import('./src/sidebar/components/sku-editor-core.mjs');
  assert.equal(licenseFamilyForSku('MX67W'), 'mx');
  assert.equal(licenseFamilyForSku('MR44'), 'mr');
  assert.equal(licenseFamilyForSku('C9200L-24P-4G-M'), 'c9');
  // 'none' is the per-line hardware-only pick added 2026-08-19. The point of this
  // test is unchanged: SEC and SD-WAN stay off an MR row, and a licence row has
  // no tier choice at all.
  assert.deepEqual(licenseTierOptionsForSku('MX67W').map((o) => o.value), ['', 'enterprise', 'security', 'sdwan', 'none']);
  assert.deepEqual(licenseTierOptionsForSku('MR44').map((o) => o.value), ['', 'enterprise', 'advanced', 'none']);
  assert.deepEqual(licenseTierOptionsForSku('C9200L-24P-4G-M').map((o) => o.value), ['', 'advanced', 'none']);
  assert.deepEqual(licenseTierOptionsForSku('LIC-MX67W-SEC-3YR').map((o) => o.value), ['']);
});

test('mixed per-row tiers emit a modifier on each line, not one global word', async () => {
  const { quoteTextFromEditorRows } = await import('./src/sidebar/components/sku-editor-core.mjs');
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX67W', qty: 2, tier: 'security' },
    { sku: 'MX67C', qty: 1, tier: 'security' },
    { sku: 'MR44', qty: 2, tier: 'enterprise' },
  ], 'quote 2 MX67W, 1 MX67C, 2 MR44');
  assert.equal(prepared.ok, true);
  assert.equal(prepared.text, '2 MX67W security\n1 MX67C security\n2 MR44 enterprise');
  assert.doesNotMatch(prepared.text, /^security$/m);
});

test('a per-row Advanced pick stays on that switch line', async () => {
  const { quoteTextFromEditorRows } = await import('./src/sidebar/components/sku-editor-core.mjs');
  const prepared = quoteTextFromEditorRows([
    { sku: 'MX67W', qty: 2, tier: 'security' },
    { sku: 'C9200L-24P-4G-M', qty: 1, tier: 'advanced' },
  ], 'quote 2 MX67W and 1 C9200L-24P');
  assert.equal(prepared.text, '2 MX67W security\n1 C9200L-24P-4G-M advanced');
  assert.doesNotMatch(prepared.text, /\badvanced license\b/i);
});
