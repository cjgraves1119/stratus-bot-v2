import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  applyExplicitMxWarmSpareToQuoteOptions,
  applyMxWarmSpareToOrderUrl,
  bindOneshotQuoteOptions,
  buildOneshotReplanPayload,
  enrichmentComparisonRows,
  hasExplicitMxHaIntent,
  isProductChangingOneshotOverride,
  nextOneshotQuoteOptionState,
  normalizeQuoteIntakeLines,
  oneshotAutoEnrichmentReplan,
  mergeOneshotAccountDraftWithPlan,
  quoteIntakeTierLabel,
  oneshotHaStateForQuoteOption,
  oneshotProductSnapshotHash,
  quoteSkuTextFromLines,
  sanitizeStratusOrderUrls,
  selectableQuoteTerms,
  validateGmailQuoteContext,
  verifyStratusOrderUrlOptions,
  withOneshotAccountDraft,
} from './src/lib/email-quote-flow.mjs';
import { normalizeStoredChatSession, serializeChatSession } from './src/lib/context-lock.mjs';

const chatSource = fs.readFileSync(new URL('./src/sidebar/panels/ChatPanel.jsx', import.meta.url), 'utf8');
const quoteSource = fs.readFileSync(new URL('./src/sidebar/components/QuoteResult.jsx', import.meta.url), 'utf8');
const content = fs.readFileSync(new URL('./src/content/index.js', import.meta.url), 'utf8');

function functionSlice(name, nextMarker) {
  const start = chatSource.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const end = chatSource.indexOf(nextMarker, start);
  assert.ok(end > start, `${name} end marker must exist`);
  return chatSource.slice(start, end);
}

test('visible Create Quote opens a manual builder; Gmail population is separate and never generic chat', () => {
  assert.match(chatSource, /\{ label: 'Create Quote', action: 'manual-ecomm-quote' \}/);
  assert.match(chatSource, /action\.action === 'manual-ecomm-quote'[\s\S]{0,120}startManualEcommQuote\(\)/);
  assert.doesNotMatch(chatSource, /\{ label: 'Create Quote', text:/);

  const manual = functionSlice('startManualEcommQuote', 'async function populateManualQuoteFromGmail');
  assert.match(manual, /blankQuoteEditorRows\(\)/);
  assert.match(manual, /source: 'manual-quote-builder'/);
  assert.doesNotMatch(manual, /sendToBackground|runQuote|MSG\.ONESHOT_/);

  const intake = functionSlice('populateManualQuoteFromGmail', 'function resolveIntakeLine');
  assert.match(intake, /MSG\.ONESHOT_INTAKE/);
  assert.match(intake, /MSG\.GET_FULL_EMAIL_CONTEXT/);
  assert.match(content, /function findVisibleExpandAllControl\(\)/);
  assert.match(content, /expandAll\.click\(\)/);
  assert.match(content, /fullThreadExpanded: !findVisibleExpandAllControl\(\)/);
  assert.match(intake, /validateGmailQuoteContext\(fresh/);
  assert.match(intake, /expectedThreadPermId: emailContext\?\.threadPermId/);
  assert.match(intake, /emailQuoteStartRef\.current/);
  assert.match(intake, /order_urls: validation\.orderUrls/);
  assert.match(intake, /messages: \(Array\.isArray\(quoteContext\.messageContexts\)/);
  assert.match(intake, /intent: res\.intent \|\| null/);
  assert.match(intake, /quoteEditorRowsFromIntake\(res\.lines \|\| \[\], res\.intent \|\| \{\}\)/);
  assert.match(chatSource, />\s*\{msg\.gmailPopulated \? 'Gmail context populated' : 'Populate from Gmail context'\}/);
  assert.match(chatSource, /quoteUpdateLabel=[\s\S]{0,180}'Generate quote'/);
  assert.doesNotMatch(intake, /handleSend\(/);
  assert.doesNotMatch(intake, /runQuote|buildEcommQuoteFromIntake|MSG\.ONESHOT_PLAN|MSG\.ONESHOT_EXECUTE|MSG\.CHAT_HANDOFF/);

  const build = functionSlice('buildEcommQuoteFromIntake', '// Post-plan');
  assert.match(build, /runQuote\(skuText, personIdRef\.current\)/);
  assert.match(build, /license_tier === 'ENT'/);
  assert.match(build, /label: 'Hardware Only'/);
  assert.match(build, /hardwareOnly: true/);
  assert.match(build, /quoteModifiers\.push\('use warm spare HA'\)/,
    'reviewed Gmail HA intent must reach the Worker before a structured EOL contract is built');
  assert.match(build, /Pricing\/link generation was unavailable/);
  assert.doesNotMatch(build, /MSG\.ONESHOT_PLAN|MSG\.ONESHOT_EXECUTE|CRM_/);
});

test('Gmail intake preserves bounded exact Stratus order URLs in DOM order', () => {
  const oldest = 'https://stratusinfosystems.com/order/?item=MR44&qty=1';
  const newest = 'https://www.stratusinfosystems.com/order/?item=MR46&qty=2';
  assert.deepEqual(sanitizeStratusOrderUrls([
    oldest,
    'http://stratusinfosystems.com/order/?item=MR45&qty=1',
    'https://evil.example/order/?item=MR45&qty=1',
    'https://stratusinfosystems.com/cart/?item=MR45&qty=1',
    'https://stratusinfosystems.com/order?item=MR45&qty=1',
    'https://stratusinfosystems.com/order/?item=MR45',
    newest,
  ]), [oldest, newest]);
  const many = Array.from({ length: 8 }, (_, index) => `https://stratusinfosystems.com/order/?item=MR${40 + index}&qty=1`);
  assert.equal(sanitizeStratusOrderUrls(many).length, 5);
  assert.match(sanitizeStratusOrderUrls(many)[0], /item=MR43/);
  assert.match(sanitizeStratusOrderUrls(many)[4], /item=MR47/);
});

test('normalized email intake retains SKU output even when pricing is absent', () => {
  const lines = [
    { status: 'resolved', sku: 'mr44', qty: 2 },
    { status: 'resolved', sku: 'MR44', qty: 3 },
    { status: 'resolved', sku: 'LIC-MR-ADV-3YR', qty: 5 },
    { status: 'needs_term', sku: null, qty: 8 },
  ];
  assert.deepEqual(normalizeQuoteIntakeLines(lines), [
    { sku: 'MR44', qty: 5 },
    { sku: 'LIC-MR-ADV-3YR', qty: 5 },
  ]);
  assert.equal(quoteSkuTextFromLines(lines), '5 MR44\n5 LIC-MR-ADV-3YR');
  assert.match(quoteSource, /Parsed SKU quantities \(retained even though pricing\/links were unavailable\)/);
  assert.match(quoteSource, /Zoho quote option/);
});

test('email intake preserves same-SKU row tiers and serializes each occurrence explicitly', () => {
  const lines = [
    { status: 'resolved', sku: 'MX67', qty: 1, tier: 'SEC' },
    { status: 'resolved', sku: 'mx67', qty: 2, tier: 'enterprise' },
    { status: 'resolved', sku: 'LIC-ENT-3YR', qty: 2, tier: 'ENT' },
  ];
  assert.deepEqual(normalizeQuoteIntakeLines(lines), [
    { sku: 'MX67', qty: 1, tier: 'SEC' },
    { sku: 'MX67', qty: 2, tier: 'ENT' },
    { sku: 'LIC-ENT-3YR', qty: 2 },
  ]);
  assert.equal(quoteSkuTextFromLines(lines),
    '1 MX67 security\n2 MX67 enterprise\n2 LIC-ENT-3YR');
  assert.equal(quoteIntakeTierLabel('SEC'), 'Advanced Security (SEC)');
  assert.equal(quoteIntakeTierLabel('ENT'), 'Enterprise (ENT)');
  assert.match(chatSource, /quoteIntakeTierLabel\(l\.tier\)/,
    'the fresh intake card must visibly label each preserved row tier');
  assert.match(chatSource, /quoteIntakeTierLabel\(line\.tier\)/,
    'the inert restored card must visibly label each preserved row tier');
  assert.deepEqual(normalizeQuoteIntakeLines([
    { status: 'resolved', sku: 'MX67', qty: 1, tier: 'untrusted-tier' },
  ]), [], 'unknown non-empty row tier must fail the intake closed');
});

test('returned 1-5-year options are explicit and only the separate button enters Zoho review', () => {
  const options = [1, 2, 3, 4, 5].map((years) => ({
    label: `${years}-Year Co-Term`,
    url: `https://stratusinfosystems.com/order/?item=LIC-ENT-${years}YR&qty=2`,
  }));
  assert.deepEqual(selectableQuoteTerms(options).map((option) => option.years), [1, 2, 3, 4, 5]);
  assert.deepEqual(selectableQuoteTerms([...options, {
    label: 'Hardware Only',
    url: 'https://stratusinfosystems.com/order/?item=MX85&qty=2',
  }]).map((option) => option.years), [1, 2, 3, 4, 5, null]);
  assert.equal(selectableQuoteTerms([
    { label: '1-Year', url: 'https://stratusinfosystems.com/order/?item=MR44&item=MR46&qty=1' },
    options[2],
  ])[0].index, 1, 'unsafe slots must not be compacted');
  // Term/Hardware-Only selection moved from a single-select dropdown to a
  // checkbox multiselect (2026-08-17) so 1/3/5-year options can be checked
  // together and created as separate quotes under the same deal.
  assert.match(quoteSource, /Create Zoho CRM quote from selected/);
  assert.match(quoteSource, /type="checkbox"[\s\S]*checked=\{validSelectedIndexes\.includes\(option\.index\)\}/);
  assert.match(quoteSource, /onChange=\{\(\) => toggleIndex\(option\.index\)\}/);
  assert.match(quoteSource, /onSendToZoho\(result, validSelectedIndexes\)/);
  assert.doesNotMatch(quoteSource, /<option value="" disabled>Select a term or Hardware Only…<\/option>/);
  assert.match(quoteSource, /disabled=\{busy \|\| !hasExplicitTermSelection\}/);
  assert.doesNotMatch(quoteSource, /Math\.max\(0, urls\.findIndex/);
  const conversion = functionSlice('startOneshotFromUrl', 'async function replanOneshot');
  assert.match(conversion, /MSG\.ONESHOT_PLAN/);
  assert.match(conversion, /consentSource: 'quote-card-button'/);
  assert.match(conversion, /Array\.isArray\(capturedParticipants\)/);
  assert.match(conversion, /participants\.some\(\(c\) => c\.email === explicitlySelectedEmail\)/);
  assert.match(chatSource, /handleSendQuoteToZoho\(msg, result, selectedUrlIdx\)/);
  assert.doesNotMatch(conversion, /MSG\.ONESHOT_EXECUTE/);
});

test('explicit MX warm spare rewrites each even hardware pair to one shared license', () => {
  const adjusted = applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105,LIC-MX105-ENT-5Y,MX85,LIC-MX85-ENT-5Y&qty=2,2,2,2');
  assert.match(adjusted, /item=MX105,LIC-MX105-ENT-5Y,MX85,LIC-MX85-ENT-5Y/);
  assert.match(adjusted, /qty=2,1,2,1/);
  assert.equal(applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105,LIC-MX105-ENT-5Y&qty=3,3'), '');
  assert.equal(applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105&qty=2'), '');
  assert.equal(applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,LIC-MX105-ENT-3Y&qty=2,2,2'), '');
  assert.equal(applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,LIC-MX105-SEC-3Y&qty=2,2,2'), '');
});

test('explicit HA detector accepts deliberate MX failover language and rejects quantity or unrelated-spare hints', () => {
  for (const text of [
    '2 MX105 and 2 MX85 configured as explicit high-availability warm spares',
    'high availability firewalls',
    'warm spare MX pair',
    'HA configuration',
    'failover appliances',
    'spare MX85',
    'High availability is required, not optional',
    'Quote two MX85 with high availability, not standard licensing',
    'Do not omit the warm spare',
    'Configure failover, not standalone mode',
    'No standard deployment, use high availability',
    '2 MX105 and 2 MX85, no MX84, enterprise licensing, high availability',
    'high availability, no MX84',
    'exclude historical MX84 and configure high availability for MX105 and MX85',
    'without MX84 but use high availability for MX105 and MX85',
    '2x MX105 + 2x MX85, ENT licensing, HA; exclude historical MX84.',
    'HA',
    'HA required for these MX85s',
    'Use HA for the MX105 and MX85',
    'Quote 2 MX85; high availability is not optional.',
    'High availability must not be omitted',
    'High availability cannot be omitted',
    'HA for 2 MX85s',
    'Warm spare for 2 MX85s',
    'HA for two MX85s',
    'Warm spare for the MX85 pair',
    'High availability for the MX85 pair',
    'Customer approved HA',
    'HA is preferred',
    "Don't forget the warm spare",
    'Never forget the warm spare',
    'Put the MX85s in HA',
    'Ensure high availability',
    'HA on two MX85s',
    'HA with two MX85s',
    'We opted for HA',
    'HA chosen',
    'Customer asked for HA',
    'Please turn on HA',
    'We would like HA',
    'Must have HA',
    'Provide an HA pair',
    'Customer request: HA',
    'Make it high availability',
    'Apply HA to these MX85s',
    'Build HA into the quote',
    'Deliver the MX85s with HA',
    'Design for high availability',
    'Can you ensure high availability?',
    'Could you turn on HA?',
    'Would you set up failover?',
    'Do not leave out HA',
    'HA should not be left out',
    'HA is our choice',
    'Can you activate HA?',
    'Would you implement failover?',
    'Could you put the MX85s in HA?',
    'Would you run both MX85s in HA?',
    'Can you place the MX85s in HA?',
    'Would you keep HA enabled?',
    'HA is the selected option',
    "The customer's preference is HA",
    'Please give us HA',
    'HA must remain enabled',
    "Please don't turn off HA",
    'Never turn off HA',
    "Please don't switch off HA",
    'Never switch off HA',
    'Customer signed off on HA',
    'HA has been approved',
    'Customer elected HA',
    'HA was elected',
    'HA is non-optional',
    'Quote 2 MX85 without omitting HA',
    'Deploy the MX85s without disabling HA',
    'Configure the MX85 pair as active-passive',
    'Deploy the MX105s in active standby',
    'Use HA instead of standalone mode',
    'Customer selected HA over standard mode',
    'Quote HA rather than standalone mode',
    'Deploy HA in place of standard mode',
    'Remove old MX84 and include HA.',
    'Do not quote without HA',
    'We cannot proceed without HA',
    'HA is essential',
    'HA is compulsory',
    'HA is a hard requirement',
    'Customer committed to HA',
    'Customer authorized HA',
    'Make the firewalls highly available',
    'Run the MX85s as active-passive',
    'Configure the MX105s active/standby',
    'Approval has been granted for HA.',
    'HA has customer approval.',
    'Proceed using a warm spare.',
    'Customer proceeded with HA.',
    'Customer gave approval for HA.',
    'Final selection: HA.',
    'Customer decided on HA.',
    'This is explicit HA.',
    'Configure these as a warm spare.',
    'Quote the MX85s with HA.',
    'Do not forget to include HA.',
    'Do not fail to include HA.',
    'Do not hesitate to configure HA.',
    'Never forget to keep HA enabled.',
    'Do not, under any circumstances, forget to include HA.',
  ]) assert.equal(hasExplicitMxHaIntent(text), true, text);

  for (const text of [
    '2 MX105 and 2 MX85',
    'spare parts and a spare cable',
    'backup config with redundant links',
    'no warm spare',
    'do not configure these for high availability',
    'without a failover appliance',
    'Please do not configure these appliances for high availability',
    'These are not intended to be configured as a warm spare',
    'Quote two MX85 for a non-high-availability pair',
    'High availability is not required for these MX85s',
    'Warm spare is not needed',
    'Failover should be excluded',
    "High availability isn't required",
    "Warm spare isn't needed",
    "Failover shouldn't be included",
    'Avoid high availability',
    'Omit the warm spare',
    'Skip failover',
    'High availability is prohibited',
    'High availability, not required',
    'Warm spare: not needed',
    'High availability? No.',
    'Never configure high availability',
    'Never use a warm spare',
    'We never want failover',
    'High availability is optional',
    'Warm spare is optional',
    'High availability is out of scope',
    'High availability was ruled out',
    'Warm spare is unneeded',
    'Failover is forbidden',
    'Do these MX85s support failover?',
    'Explain high availability for 2 MX85',
    'Can you quote 2 MX85 and tell me whether they support failover?',
    'No HA',
    'HA is optional',
    'Do these MX85s support HA?',
    'High availability (not required)',
    'Warm spare — not needed',
    'Failover / not needed',
    'High availability is no longer required',
    'We do not think we need high availability',
    "I don't believe a warm spare is needed",
    "We aren't looking for high availability",
    "We don't plan to use a warm spare",
    'We are not planning to use HA',
    'HA is unsupported',
    'HA is supported',
    'HA is available',
    'Quote 2 MX85. No need for high availability.',
    "Quote 2 MX85; we won't use high availability.",
    'High availability should be avoided.',
    'Should we use high availability?',
    "Quote 2 MX85. We aren't using high availability.",
    'Quote 2 MX85 without needing high availability.',
    'Quote 2 MX85; avoid using high availability.',
    'Quote 2 MX85; high availability is never needed.',
    'Quote 2 MX85; high availability was rejected.',
    'Quote 2 MX85. They had a warm spare last year but do not need one now.',
    'Quote 2 MX85; can these use warm spare mode?',
    'Do not quote HA',
    'We cannot use HA',
    'We do not currently need HA',
    'HA was declined',
    'HA is currently not required',
    'Reject the warm spare',
    'No thanks on HA',
    'There is no current need for high availability',
    'We have no plans for HA',
    'We have no intention of using HA',
    'We decided not to use high availability',
    'High availability remains disabled',
    'High availability was used before, but not requested now',
    'High availability was considered but rejected',
    'Warm spare was discussed but declined',
    'The customer declined high availability',
    'HA is probably not needed',
    'Can MX85s use warm spare mode?',
    'Quote 2 MX85 with optional HA',
    'Quote 2 MX85; we may need HA',
    'Quote 2 MX85, HA TBD',
    'Quote 2 MX85. We no longer use HA.',
    'Quote 2 MX85. Customer previously used high availability.',
    "Quote 2 MX85. Don't leave high availability enabled.",
    "Please don't automatically include HA",
    'The customer has not requested HA',
    "The customer hasn't requested HA",
    'We no longer want HA',
    'Do not explicitly quote HA',
    'Customer may want HA',
    'We might use HA',
    'We previously used HA',
    'We never formally requested HA',
    'Quote 2 MX85. Old design used failover; new quote is standalone.',
    "Quote 2 MX85. Last year they needed high availability, now they don't.",
    'Quote 2 MX85; maybe use HA',
    'Omit any use of high availability',
    'Quote 2 MX85 with possible HA',
    'Can you tell me whether to include HA?',
    'Could you advise whether we should use HA?',
    'We are evaluating whether to include HA',
    'We want to understand HA',
    'Request information about HA',
    'Need info about HA',
    'Need to decide whether to use HA',
    'Existing MX85 HA configuration',
    'MX85 HA support',
    'We can use HA',
    'Advise whether to use HA',
    'Include HA if customer confirms',
    'Configure HA if approved',
    'Need to decide on HA',
    'Need an explanation of HA',
    'Quote 2 MX85 with potentially needed HA',
    'Customer did not approve HA',
    'We did not choose HA',
    "We don't prefer HA",
    'No one requested HA',
    'The customer refused to use HA',
    'Customer cancelled plans to use HA',
    'We have not selected HA',
    'The customer did not select HA',
    "We haven't selected HA",
    'Do not select HA',
    'Do not activate HA',
    'Do not implement HA',
    'Do not implement failover',
    'Do not put the MX85s in HA',
    'Do not place the MX85s in HA',
    'Do not run the MX85s in HA',
    'Do not set up failover',
    'We did not confirm HA',
    'We have not confirmed HA',
    'No customer asked for HA',
    'Neither customer requested HA',
    'None of the options include HA',
    'We stopped requesting HA',
    'Customer withdrew the request for HA',
    'We are unsure we want HA',
    'Include HA only after approval',
    'For discussion only, include HA',
    'Proposed configuration includes HA',
    'Turn off HA',
    'Switch off HA',
    'Please keep HA off',
    'Customer asked about HA',
    'Customer asked for more info on HA',
    'Need documentation on HA',
    'Need to review HA',
    'Need approval for HA',
    'Pending approval, use HA',
    'Tentatively configure HA',
    'Include an explanation about HA',
    'Include a section on HA',
    'Include a note about HA',
    'Need a diagram of HA',
    'Need cost information about HA',
    'Configure HA once approved',
    'When approved, configure HA',
    'Enable HA after customer signs off',
    'Use HA — approval pending',
    'Request approval for HA',
    'The previous quote required HA',
    'In 2024 we required HA',
    'The appliances are HA capable',
    'Use standalone instead of HA',
    'Customer selected standard mode over HA',
    'Quote standalone rather than HA',
    'Deploy standard mode in place of HA',
    'The customer decided against HA',
    'The customer opted out of HA',
    'Configure HA, but the customer later declined it',
    'Use HA. Correction: do not include it.',
    'Customer requested HA, then withdrew the request',
    'Do not deploy active-passive',
    'Active standby is optional',
    'Need an HA estimate before deciding',
    'Budget permitting, use HA',
    'HA required. Actually do not include HA',
    'Include HA. Correction use standard',
    'Use HA. Actually no, use standard',
    'HA selected earlier but removed now.',
    'HA approved earlier but superseded by standard.',
    'Enable HA provided that approval is received.',
    'Include HA contingent on approval.',
    'Add HA dependent upon budget approval.',
    'Configure HA assuming the customer agrees.',
    'Configure HA following approval.',
    'Use HA as long as the customer approves.',
    'Use HA in the event the customer approves.',
    'Use HA depending on approval.',
    'Include HA conditionally.',
    'Provisionally include HA.',
    'Use HA, approval TBD.',
    'We will use HA should funding be approved.',
    'Provide a comparison between standard and HA.',
    'Quote hardware capable of HA.',
    'Could you add a note explaining HA?',
    'Quote 2 MX85 for an HA evaluation.',
    'Include HA in the documentation.',
    'Include HA in the comparison table.',
    'Provide information about HA.',
    'Provide details about HA.',
    'We need to talk about HA.',
    'Put HA on the agenda.',
    'The customer previously selected HA.',
    'The customer previously chose HA.',
    'The customer previously approved HA.',
    'Last week we required HA.',
    'HA approved last year.',
    'Prior quote: HA required.',
    'Old quote: HA required.',
    'The superseded design used an HA pair.',
    'Minutes from March say warm spare was approved.',
    'The archived scope included failover.',
    'We initially requested HA. We changed our mind; use standard.',
    'HA requested. Cancel that; use standard.',
    'Use HA. No, standard instead.',
    'Quote HA. On second thought, leave it out.',
    'Use a warm spare. Revised instruction: quote standalone.',
    'HA was approved, but the latest direction is standard.',
    'Include high availability. Final answer: no HA.',
    'Can you make a comparison for HA?',
    'Add HA as a consideration.',
    'The customer once required HA.',
    'In Q1 we selected HA.',
    'On the old quote, customer selected HA.',
    'HA selected on the prior quote.',
    'History: customer requested HA.',
    'Historical: customer requested HA.',
    'The last quote requested HA.',
    'The customer required HA in the previous phase.',
    'Earlier correspondence requested HA.',
    'Configure HA. Update: the customer chose standalone.',
    'Use HA for the historical MX84 only; exclude it from this quote.',
    'Exclude the old MX84 HA pair. Quote 2 MX85 standard.',
    'Do not authorize HA',
    'Customer did not authorize HA',
    'Customer has not authorized HA',
    'Customer did not elect HA',
    'Never commit to HA',
    'Customer did not commit to HA',
    "Don't sign off on HA",
    'Customer did not sign off on HA',
    'Do not proceed with HA',
    'Customer did not proceed with HA',
    'Customer did not give approval for HA',
    'Use HA only with approval',
    'Two years ago we used HA',
    'Three months ago the customer requested HA',
    'Last Tuesday the customer approved HA',
    'Use HA. Disregard that; use standard.',
    'Use HA. Scratch that; use standalone.',
    'Use HA. Ignore that; quote standard.',
    'Use HA. Final direction: standard.',
    'Do not ensure HA',
    'Customer did not ensure high availability',
    'Do not make it HA',
    'Never make the firewalls highly available',
    'Do not apply HA',
    'Customer did not apply HA to these MX85s',
    "Don't build HA into the quote",
    'Customer did not build high availability into the design',
    'Do not deliver the MX85s with HA',
    'Customer did not deliver HA',
    'Do not design for HA',
    'Customer did not design the network for high availability',
    'We did not decide on HA',
    'Customer has not decided on HA',
    'This is not explicit HA',
    'Not with HA',
    'Use standard, not with HA',
    'Not as HA',
    'Configure these not as a warm spare',
    'The MX85s are not with high availability',
    'The quote must not have HA',
    'Customer does not want HA',
    'Customer could not approve HA',
    'Customer might not choose HA',
    'We did not, after review, authorize HA',
    'Do not, under any circumstances, enable HA',
    "We haven't (yet) approved HA",
    'We did not — after review — authorize HA',
    'We did not at any point ever authorize HA',
    'We have yet to approve HA',
    'We are waiting to approve HA',
    // 2026-08-17: past-tense and other-site mentions were read as present
    // intent, which silently halved license quantities on the published cart.
    // A subject between the adverb and the verb defeated the historical guard.
    'Previously we used HA. Quote 4 MX75-HW with 4 LIC-MX75-ENT-3YR.',
    'Previously the customer deployed HA. Quote 4 MX75-HW.',
    'They use failover at the old site, but the new site is standard. Quote 4 MX75-HW.',
    'We use HA on the previous design; new design is standard.',
  ]) assert.equal(hasExplicitMxHaIntent(text), false, text);
});

test('historical HA suppression does not swallow a genuine request that mentions prior state', () => {
  for (const text of [
    'Quote 2 MX75-HW with HA for the old site.',
    'We are replacing the old firewalls; please configure HA on the new pair.',
    'The previous quote was standalone. This time we want HA.',
    'Previously standalone. Please add HA now.',
    'Their old design had no redundancy — quote high availability.',
  ]) assert.equal(hasExplicitMxHaIntent(text), true, text);
});

test('general quote HA publication stores intent, verifies all URLs, and forwards it into one-shot planning', () => {
  const general = functionSlice('runAndPushQuote', 'function quoteDraftRows');
  assert.match(general, /const quoteHaRequested = hasExplicitMxHaIntent\(text\)/);
  assert.match(general, /applyExplicitMxWarmSpareToQuoteOptions\(candidate\?\.urls, true\)/);
  assert.match(general, /verifyStratusOrderUrlOptions\(candidate\?\.urls, committedRows, \{/);
  assert.match(general, /allowHaLicenseRatio: quoteHaRequested/);
  assert.match(general, /result: \{ \.\.\.candidate, urls: \[\] \}/);
  assert.match(general, /skuText: text,[\s\S]{0,80}quoteHaRequested/);
  assert.match(chatSource, /msg\?\.quoteHaRequested === true/);
  assert.match(chatSource, /sourceMessage\?\.quoteHaRequested === true \? \{ ha_requested: true \} : null/);
});

test('explicit MX warm spare accepts canonical -HW forms and never infers intent from quantities', () => {
  const canonical = applyMxWarmSpareToOrderUrl('https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-5Y,MX85-HW,LIC-MX85-ENT-5Y&qty=2,2,2,2');
  assert.match(canonical, /item=MX105-HW,LIC-MX105-ENT-5Y,MX85-HW,LIC-MX85-ENT-5Y/);
  assert.match(canonical, /qty=2,1,2,1/);

  const options = [
    {
      label: '3-Year',
      url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y&qty=2,2',
    },
    {
      label: 'Hardware Only',
      url: 'https://stratusinfosystems.com/order/?item=MX105-HW&qty=2',
      hardwareOnly: true,
    },
  ];
  assert.equal(new URL(applyExplicitMxWarmSpareToQuoteOptions(options, false)[0].url).searchParams.get('qty'), '2,2');
  const explicit = applyExplicitMxWarmSpareToQuoteOptions(options, true);
  assert.equal(new URL(explicit[0].url).searchParams.get('qty'), '2,1');
  assert.deepEqual(explicit[1], options[1], 'Hardware Only must remain available and unchanged');

  assert.deepEqual(applyExplicitMxWarmSpareToQuoteOptions([
    options[0],
    { label: '5-Year', url: 'https://stratusinfosystems.com/order/?item=MX105-HW&qty=2' },
    options[1],
  ], true), [], 'one unrewritable licensed option must suppress the entire actionable set');
});

test('Gmail option verification suppresses every URL on an MX84 or quantity mismatch', () => {
  const expected = [{ sku: 'MX105', qty: 2 }, { sku: 'MX85', qty: 2 }];
  const leakedHistory = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,MX85-HW,LIC-MX85-ENT-3Y,MX84-HW&qty=2,1,2,1,1',
  }], expected, { allowHaLicenseRatio: true });
  assert.equal(leakedHistory.ok, false);
  assert.deepEqual(leakedHistory.urls, []);
  assert.match(leakedHistory.error, /unexpected item \(MX84\)/i);

  for (const leakedLicense of ['LIC-MX84-ENT-3Y', 'LIC-MX75-ENT-3Y', 'LIC-MR-ADV-3YR']) {
    const licensedHistory = verifyStratusOrderUrlOptions([{
      label: '3-Year',
      url: `https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,MX85-HW,LIC-MX85-ENT-3Y,${leakedLicense}&qty=2,1,2,1,1`,
    }], expected, { allowHaLicenseRatio: true });
    assert.equal(licensedHistory.ok, false, leakedLicense);
    assert.deepEqual(licensedHistory.urls, [], leakedLicense);
    assert.match(licensedHistory.error, new RegExp(`unexpected item \\(${leakedLicense}\\)`, 'i'));
  }

  const wrongQty = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,MX85-HW,LIC-MX85-ENT-3Y&qty=2,1,1,1',
  }], expected, { allowHaLicenseRatio: true });
  assert.equal(wrongQty.ok, false);
  assert.deepEqual(wrongQty.urls, []);

  const wrongTier = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-SEC-3Y,MX85-HW,LIC-MX85-SEC-3Y&qty=2,1,2,1',
  }], expected, { licenseTier: 'ENT', allowHaLicenseRatio: true });
  assert.equal(wrongTier.ok, false);
  assert.deepEqual(wrongTier.urls, []);

  for (const malformedTier of ['LIC-MX105-BOGUS-3Y', 'LIC-MX105-3Y', 'LIC-MX105-A-3Y']) {
    const missingTier = verifyStratusOrderUrlOptions([{
      label: '3-Year',
      url: `https://stratusinfosystems.com/order/?item=MX105-HW,${malformedTier}&qty=2,1`,
    }], [{ sku: 'MX105', qty: 2 }], { licenseTier: 'ENT', allowHaLicenseRatio: true });
    assert.equal(missingTier.ok, false, malformedTier);
    assert.deepEqual(missingTier.urls, [], malformedTier);
  }

  const wrongTerm = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-5Y,MX85-HW,LIC-MX85-ENT-5Y&qty=2,1,2,1',
  }], expected, { licenseTier: 'ENT', allowHaLicenseRatio: true });
  assert.equal(wrongTerm.ok, false);
  assert.deepEqual(wrongTerm.urls, []);

  const valid = verifyStratusOrderUrlOptions([{
    label: '3-Year',
    url: 'https://stratusinfosystems.com/order/?item=MX105-HW,LIC-MX105-ENT-3Y,MX85-HW,LIC-MX85-ENT-3Y&qty=2,1,2,1',
  }], expected, { licenseTier: 'ENT', allowHaLicenseRatio: true });
  assert.equal(valid.ok, true);
  assert.equal(valid.urls.length, 1);

  const noLicense = verifyStratusOrderUrlOptions([{
    label: 'Enterprise',
    url: 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2',
  }], [{ sku: 'MX85', qty: 2 }], { licenseTier: 'ENT' });
  assert.equal(noLicense.ok, false);
  const hardwareOnly = verifyStratusOrderUrlOptions([{
    label: 'Hardware Only',
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2',
  }], [{ sku: 'MX85', qty: 2 }], { licenseTier: 'ENT' });
  assert.equal(hardwareOnly.ok, false, 'a licensed request cannot silently degrade to only Hardware Only');
  assert.equal(verifyStratusOrderUrlOptions([{
    label: 'Hardware Only',
    hardwareOnly: true,
    url: 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2',
  }], [{ sku: 'MX85', qty: 2 }], { requireLicensedOption: false }).ok, true);
  const licensedAndHardware = verifyStratusOrderUrlOptions([
    {
      label: '3-Year',
      url: 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,1',
    },
    {
      label: 'Hardware Only',
      hardwareOnly: true,
      url: 'https://stratusinfosystems.com/order/?item=MX85-HW&qty=2',
    },
  ], [{ sku: 'MX85', qty: 2 }], {
    licenseTier: 'ENT', allowHaLicenseRatio: true, requireLicensedOption: true,
  });
  assert.equal(licensedAndHardware.ok, true);
});

test('fresh Gmail validation rejects partial, stale, and mismatched context', () => {
  const base = {
    threadPermId: 'thread-1',
    subject: 'Synthetic quote request',
    fullThreadBody: 'Please quote 2 MR44-HW',
    threadOrderUrls: [],
    extractedAt: 10000,
  };
  assert.equal(validateGmailQuoteContext(base, {
    expectedThreadPermId: 'thread-1', expectedSubject: base.subject, requireFresh: true, now: 12000,
  }).ok, true);
  assert.match(validateGmailQuoteContext({ ...base, fullThreadBody: '', body: 'partial only' }, {
    requireFresh: true, now: 12000,
  }).error, /complete visible Gmail thread/i);
  assert.match(validateGmailQuoteContext({ ...base, fullThreadExpanded: false }, {
    expectedThreadPermId: base.threadPermId,
    expectedSubject: base.subject,
    requireFresh: true,
    now: base.extractedAt,
  }).error, /collapsed messages/i);
  assert.match(validateGmailQuoteContext(base, { requireFresh: true, now: 30000 }).error, /not fresh/i);
  assert.match(validateGmailQuoteContext(base, {
    expectedThreadPermId: 'thread-2', requireFresh: true, now: 12000,
  }).error, /changed conversations/i);
});

test('non-product replans reuse signed validation; product/term/HA changes do not', () => {
  const base = { skus: [{ sku: 'MR44', qty: 2 }], ha_mode: 'standard' };
  const token = 'signed-review-token';
  assert.equal(isProductChangingOneshotOverride({ account_id: '123' }), false);
  assert.equal(buildOneshotReplanPayload(base, { account_id: '123' }, token).prior_review_token, token);
  assert.equal(buildOneshotReplanPayload(base, { refresh_enrichment: true, enrichment_mode: 'compare' }, token).prior_review_token, token);
  assert.equal(buildOneshotReplanPayload(base, { skus: [{ sku: 'MR44', qty: 3 }] }, token).prior_review_token, undefined);
  assert.equal(buildOneshotReplanPayload(base, { ha_mode: 'warm_spare' }, token).prior_review_token, undefined);
  assert.equal(buildOneshotReplanPayload(base, { ha_recalculate_license_qty: true }, token).prior_review_token, undefined);
  assert.match(chatSource, /MSG\.ENRICH_COMPANY/);
  assert.match(chatSource, /cache_bust: true,[\s\S]{0,100}start_tier: startTier/);
  assert.match(chatSource, /useEnrichmentResult\(enrichmentAlternate\)/);
  assert.match(chatSource, /haAvailable && <div/);
  assert.match(chatSource, /value="warm_spare"/);
  assert.match(chatSource, /ha_recalculate_license_qty: nextHaMode === 'warm_spare'/);
  assert.match(chatSource, /Warm spare \/ HA pair — recalculate to 2 hardware : 1 shared license/);

  assert.deepEqual(enrichmentComparisonRows({
    differences: [{ field: 'street', current: '1 Old Way', candidate: '2 New Way' }],
    provenance: { source: 'web', tier: 'company-site' },
  }), [{ field: 'street', current: '1 Old Way', candidate: '2 New Way', source: 'web' }]);
  assert.match(chatSource, /Choose account enrichment source/);
  assert.match(chatSource, /setEnrichmentAlternate\(result\)/);
  assert.doesNotMatch(chatSource, /JSON\.stringify\(p\.enrichment_comparison/);
  assert.match(chatSource, /'invalid_sku_quantity', 'unresolved_sku', 'inactive_sku', 'eol_sku', 'product_lookup_failed'/);
  assert.match(chatSource, /p\.product_validation \|\| \{\}/);
  assert.match(chatSource, /productValidation\.snapshot_hash/);
  assert.match(chatSource, /productValidation\.product_validation_count/);
  assert.match(chatSource, /productValidation\.reused === true/);
});

test('new-account auto enrichment retries once, fills blanks, and never masks the result with the old draft', () => {
  const partial = {
    name: 'Omaha Zoo',
    street: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    website: 'www.omahazoo.com',
  };
  const retry = oneshotAutoEnrichmentReplan({
    accountPlan: { mode: 'create', prefill: partial },
    accountDraft: partial,
  });
  assert.deepEqual(retry, {
    overrides: {
      enrich_cache_bust: true,
      account_prefill: partial,
    },
    messagePatch: {
      accountDraft: null,
      oneshotAutoEnrichDomain: 'www.omahazoo.com',
    },
  });
  assert.equal(retry.overrides.refresh_enrichment, undefined, 'automatic retry must fill blanks, not request compare-only');
  assert.equal(retry.overrides.enrichment_mode, undefined, 'manual Refresh remains the compare-only path');

  const complete = { ...partial, street: '3701 S 10th St', city: 'Omaha', state: 'NE', zip: '68107' };
  assert.equal(oneshotAutoEnrichmentReplan({
    accountPlan: { mode: 'create', prefill: complete },
    accountDraft: complete,
  }), null, 'a complete review must not trigger another lookup');
  assert.equal(oneshotAutoEnrichmentReplan({
    attemptedDomain: 'WWW.OMAHAZOO.COM',
    accountPlan: { mode: 'create', prefill: partial },
    accountDraft: partial,
  }), null, 'the automatic lookup runs at most once per selected domain');
  assert.equal(oneshotAutoEnrichmentReplan({
    accountPlan: { mode: 'existing', prefill: partial },
    accountDraft: partial,
  }), null, 'existing Accounts are never enriched by this create-only retry');

  assert.match(chatSource, /requestReplan\(retry\.overrides, retry\.messagePatch\)/);
  assert.match(chatSource, /if \(autoEnrichmentAttemptedRef\.current\) return/);
  assert.match(chatSource, /autoEnrichmentAttemptedRef\.current = true/);
  assert.doesNotMatch(chatSource, /refresh_enrichment: true, enrichment_mode: 'compare', account_prefill: \{ \.\.\.acct \}/);
  assert.match(chatSource, /delete base\.enrich_cache_bust/);
});

test('cached enrichment fills blank draft fields after a contact/account re-plan', () => {
  const localDraft = {
    name: 'Omaha Zoo',
    street: '',
    city: '',
    state: '',
    zip: '',
    country: 'United States',
    website: 'www.omahazoo.com',
  };
  const nextPlan = {
    account: {
      mode: 'create',
      prefill: {
        name: 'Omaha Zoo and Aquarium',
        street: '3701 S 10th St',
        city: 'Omaha',
        state: 'NE',
        zip: '68107',
        country: 'United States',
        website: 'omahazoo.com',
        enrich_tier: 'cache',
      },
    },
  };
  assert.deepEqual(mergeOneshotAccountDraftWithPlan(localDraft, nextPlan), {
    name: 'Omaha Zoo',
    street: '3701 S 10th St',
    city: 'Omaha',
    state: 'NE',
    zip: '68107',
    country: 'United States',
    website: 'www.omahazoo.com',
  }, 'nonblank reviewed values win while cached enrichment fills every blank');
  assert.equal(mergeOneshotAccountDraftWithPlan(null, nextPlan), null);
  assert.match(chatSource, /mergeOneshotAccountDraftWithPlan\([\s\S]{0,160}messagePatch\.accountDraft,[\s\S]{0,80}res\.plan/);
});

test('explicit HA availability survives Hardware Only and licensed-term round trips', () => {
  const hardware = oneshotHaStateForQuoteOption({ haAvailable: true, hardwareOnly: true, currentMode: 'warm_spare' });
  assert.deepEqual(hardware, {
    ha_mode: 'standard',
    ha_recalculate_license_qty: false,
    ha_available: true,
  });
  const licensed = oneshotHaStateForQuoteOption({
    haAvailable: hardware.ha_available,
    hardwareOnly: false,
    currentMode: hardware.ha_mode,
  });
  assert.deepEqual(licensed, {
    ha_mode: 'warm_spare',
    ha_recalculate_license_qty: true,
    ha_available: true,
  });
  assert.deepEqual(oneshotHaStateForQuoteOption({ hardwareOnly: true, currentMode: 'standard' }), {
    ha_mode: 'standard',
    ha_recalculate_license_qty: false,
  });
  assert.match(chatSource, /oneshotHaStateForQuoteOption\(\{ haAvailable: haRequested, hardwareOnly \}\)/);
});

test('one-shot quote options stay snapshot-bound and manual product or HA replans clear stale URLs', () => {
  const oldPlan = { product_validation: { snapshot_hash: 'sha256:old-mx-products' } };
  const newPlan = { product_validation: { snapshot_hash: 'sha256:new-catalyst-products' } };
  const termPlan = { product_validation: { snapshot_hash: 'sha256:old-mx-products-5yr' } };
  const options = [
    { label: '3-Year', url: 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-3Y&qty=2,1' },
    { label: '5-Year', url: 'https://stratusinfosystems.com/order/?item=MX85-HW,LIC-MX85-ENT-5Y&qty=2,1' },
  ];
  const initial = bindOneshotQuoteOptions(options, 0, oldPlan);
  assert.equal(initial.quoteOptionsSnapshotHash, oneshotProductSnapshotHash(oldPlan));

  const manualSku = nextOneshotQuoteOptionState({
    ...initial,
    currentPlan: oldPlan,
    nextPlan: newPlan,
    productChanging: true,
  });
  assert.deepEqual(manualSku.quoteOptions, []);
  assert.equal(manualSku.selectedQuoteOptionIndex, null);
  assert.equal(manualSku.quoteOptionsSnapshotHash, undefined);

  const manualHa = nextOneshotQuoteOptionState({
    ...initial,
    currentPlan: oldPlan,
    nextPlan: termPlan,
    productChanging: true,
    boundOptionSelection: false,
  });
  assert.deepEqual(manualHa.quoteOptions, []);

  const termSwitch = nextOneshotQuoteOptionState({
    ...initial,
    currentPlan: oldPlan,
    nextPlan: termPlan,
    productChanging: true,
    boundOptionSelection: true,
    nextSelectedQuoteOptionIndex: 1,
  });
  assert.deepEqual(termSwitch.quoteOptions, options);
  assert.equal(termSwitch.selectedQuoteOptionIndex, 1);
  assert.equal(termSwitch.quoteOptionsSnapshotHash, 'sha256:old-mx-products-5yr');

  const accountOnly = nextOneshotQuoteOptionState({
    ...initial,
    currentPlan: oldPlan,
    nextPlan: oldPlan,
    productChanging: false,
  });
  assert.deepEqual(accountOnly.quoteOptions, options);
  assert.equal(accountOnly.selectedQuoteOptionIndex, 0);

  assert.match(chatSource, /quoteOptionsSnapshotHash !== currentSnapshotHash/);
  assert.match(chatSource, /boundOptionSelection: true/);
});

test('reviewed account edits survive every replan and remain the Execute values', () => {
  const initialDraft = {
    name: 'Synthetic Account',
    street: '1 Old Way',
    city: 'Test',
    state: 'TX',
    zip: '75001',
    country: 'United States',
    website: 'https://reference-only.example.test',
  };
  const afterCandidate = { ...initialDraft, street: '2 Candidate Way' };
  const messagePatch = withOneshotAccountDraft({ selectedQuoteOptionIndex: 1 }, afterCandidate);
  const replannedMessage = {
    accountDraft: initialDraft,
    plan: { account: { prefill: initialDraft } },
    ...messagePatch,
    planRevision: 2,
  };

  assert.equal(replannedMessage.accountDraft.street, '2 Candidate Way');
  assert.equal(replannedMessage.selectedQuoteOptionIndex, 1);
  assert.notEqual(replannedMessage.accountDraft, afterCandidate, 'replan state must be a bounded snapshot');
  assert.match(chatSource, /requestReplan\(overrides, withOneshotAccountDraft\(messagePatch, acct\)\)/);
  assert.match(chatSource, /requestQuoteOptionChange\([\s\S]{0,160}withOneshotAccountDraft\(\{\}, acct\)/);
  assert.match(chatSource, /billing: \{ street: acct\.street, city: acct\.city, state: acct\.state, zip: acct\.zip, country: acct\.country \}/);
});

test('one-shot retry boundary survives side-panel recreation without raw Gmail body', () => {
  const rawGmailSentinel = 'RAW_GMAIL_SENTINEL_20260817';
  const reviewToken = 'signed-token-abc';
  const idempotencyKey = 'ext:fixed-retry-key';
  const executePayload = {
    idempotency_key: idempotencyKey,
    review_token: reviewToken,
    skus: [{ sku: 'MR44', qty: 2 }],
    participants: [{ email: 'safe@example.test', name: 'Synthetic User' }],
    ha_mode: 'standard',
    account: { create: { name: 'Synthetic Account', billing: { street: '1 Test Way', city: 'Test', state: 'TX', zip: '75001', country: 'United States' } } },
  };
  const serialized = serializeChatSession({
    sessionId: 'chat-test',
    messages: [{
      id: 7,
      role: 'assistant',
      kind: 'oneshot',
      consentSource: 'quote-card-button',
      base: { skus: [{ sku: 'MR44', qty: 2 }], participants: executePayload.participants, source: 'ext-oneshot', ha_mode: 'standard' },
      plan: { lines: [{ sku: 'MR44', qty: 2 }], customer: { status: 'resolved' }, sku_snapshot: { hash: 'sha256:test' } },
      blockers: [],
      reviewToken,
      reviewExpiresAt: '2099-01-01T00:00:00.000Z',
      idempotencyKey,
      accountDraft: { name: 'Synthetic Account', street: '1 Test Way', city: 'Test', state: 'TX', zip: '75001', country: 'United States' },
      executeAttempted: true,
      executePayload,
      planRevision: 2,
    }],
    contextLock: null,
  });
  const restored = normalizeStoredChatSession(JSON.parse(JSON.stringify(serialized)));
  const card = restored.messages[0];
  assert.equal(card.kind, 'oneshot');
  assert.equal(card.consentSource, 'quote-card-button');
  assert.equal(card.reviewToken, reviewToken);
  assert.equal(card.idempotencyKey, idempotencyKey);
  assert.deepEqual(card.executePayload, executePayload);
  assert.equal(card.accountDraft.street, '1 Test Way');
  assert.equal(card.busy, false);
  assert.doesNotMatch(JSON.stringify(restored), /fullThreadBody|body_text|raw_email/);

  const intakeStored = serializeChatSession({
    sessionId: 'privacy-intake',
    messages: [{
      id: 9,
      role: 'assistant',
      kind: 'email-quote-intake',
      intake: {
        lines: [{ status: 'resolved', sku: 'MR44', qty: 2, evidence: rawGmailSentinel, unexpected: rawGmailSentinel }],
        facts: { raw_excerpt: rawGmailSentinel },
      },
    }],
  });
  assert.doesNotMatch(JSON.stringify(intakeStored), new RegExp(rawGmailSentinel));
  assert.deepEqual(intakeStored.messages[0].intake.lines, [{ status: 'resolved', qty: 2, sku: 'MR44' }]);

  const dirtyOneshotStored = serializeChatSession({
    sessionId: 'privacy-oneshot',
    messages: [{
      ...serialized.messages[0],
      id: 10,
      plan: {
        ...serialized.messages[0].plan,
        explanation: rawGmailSentinel,
        arbitrary_server_field: { evidence: rawGmailSentinel },
      },
      blockers: [{ code: 'account_create_review', detail: rawGmailSentinel, evidence: rawGmailSentinel }],
      base: { ...serialized.messages[0].base, raw_email_context: rawGmailSentinel },
      executePayload: { ...executePayload, arbitrary_retry_field: rawGmailSentinel },
    }],
  });
  assert.equal(dirtyOneshotStored.messages[0].kind, 'oneshot');
  assert.doesNotMatch(JSON.stringify(dirtyOneshotStored), new RegExp(rawGmailSentinel));
  assert.deepEqual(dirtyOneshotStored.messages[0].executePayload, executePayload, 'required frozen retry shape must still round-trip exactly');

  const rejected = serializeChatSession({
    sessionId: 'chat-test-2',
    messages: [{
      ...serialized.messages[0],
      id: 8,
      executePayload: { ...executePayload, review_token: 'different-token' },
    }],
  });
  assert.notEqual(rejected.messages[0]?.kind, 'oneshot', 'mismatched retry token must restore inert, never actionable');
});
