/** V3 fixture set for the Code Mode A/B bench. */

const FIXTURES = [
  { id: 'fix_001_account_lookup_simple', category: 'read_simple', user_message: 'Look up the Zoho account for Acme Corp', expected_tools: ['zoho_search_records'], notes: 'Single tool call. Both frameworks should be near-identical.' },
  { id: 'fix_002_deal_with_quotes', category: 'read_multi_step', user_message: 'Show me the open deals for City of Zanesville and any quotes attached', expected_tools: ['zoho_search_records', 'zoho_get_related_records'], notes: 'Two-step read.' },
  { id: 'fix_003_pricing_lookup_batch', category: 'read_multi_step', user_message: 'Get current pricing for MR44, MX68, MS130-12X, and any matching licenses', expected_tools: ['batch_product_lookup'], notes: 'Batch lookup.' },
  { id: 'fix_004_existing_account_quote', category: 'write_prep', user_message: 'Send a hardware-only quote for 2 MX68 to the existing Acme Corp account. Use the primary contact.', expected_tools: ['zoho_search_records', 'zoho_get_related_records', 'create_deal_and_quote'], notes: 'Lookup account + contact, then call the compound write.' },
  { id: 'fix_005_clone_quote_with_discount_change', category: 'write_prep_complex', user_message: 'Clone quote 2570562000404963049 and change the MV73M-HW discount to 35%', expected_tools: ['zoho_get_record', 'zoho_update_record'], notes: 'KNOWN LLAMA WEAKNESS. Subform id tracking + discount math. Brain says Llama 0% reliability here.' },
  { id: 'fix_006_deal_with_existing_po', category: 'write_prep', user_message: 'Send PO 2570562000404907145 for City of Zanesville for e-signature', expected_tools: ['zoho_get_record', 'quote_to_po_and_esign'], notes: 'Read PO, validate vendor, then compound esign.' },
  { id: 'fix_007_disambiguate_then_write', category: 'multi_step', user_message: 'Send a quote for 1 mv73 hardware only to Lisa Hittle at City of Zanesville', expected_tools: ['zoho_search_records'], notes: 'MV73 is ambiguous. Both frameworks must ASK for disambiguation before any write tool fires.' },
  { id: 'fix_008_read_signal_branching', category: 'multi_step', user_message: "What's the status of all my open quotes for City of Zanesville? Tell me which need follow-up.", expected_tools: ['zoho_search_records', 'zoho_get_related_records'], notes: 'Conditional analysis. Code Mode hypothesis: one program with control flow vs many round trips.' },
  { id: 'fix_009_long_subform_update', category: 'write_complex', user_message: 'On quote 2570562000404963049, change the quantity of MR44 to 5, the discount on MR-license to 40%, and add a Verkada license at 1 unit.', expected_tools: ['zoho_get_record', 'zoho_update_record'], notes: 'Multiple subform changes. Llama tool_loop > 10 here. Best test for whether Code Mode rescues this class.' },
  { id: 'fix_010_full_workflow_dry', category: 'multi_step_full', user_message: 'Create a hardware-only quote for 1 MV73M-HW to City of Zanesville Lisa Hittle, then immediately send it for esign as a PO.', expected_tools: ['create_quote_on_deal', 'quote_to_po_and_esign'], notes: 'End-to-end framework routing.' }
];

const FIXTURES_BY_ID = Object.fromEntries(FIXTURES.map((f) => [f.id, f]));

export function listFixtures() {
  return FIXTURES.map((f) => ({ id: f.id, category: f.category, user_message: f.user_message, expected_tools: f.expected_tools }));
}

export function getFixture(id) { return FIXTURES_BY_ID[id]; }
