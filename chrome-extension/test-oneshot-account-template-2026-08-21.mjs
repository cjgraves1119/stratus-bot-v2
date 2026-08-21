import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const source = fs.readFileSync(path.join(import.meta.dirname, 'src/sidebar/panels/ChatPanel.jsx'), 'utf8');
const lookupStart = source.indexOf('function OneshotZohoLookup');
const lookupEnd = source.indexOf('function OneshotIsrLookup', lookupStart);
const cardStart = source.indexOf('function OneshotPlanCard');
const cardEnd = source.indexOf('export default function ChatPanel', cardStart + 1);
const lookup = source.slice(lookupStart, lookupEnd);
const card = source.slice(cardStart, cardEnd > cardStart ? cardEnd : source.length);

test('one-shot account template omits the long helper descriptions', () => {
  assert.doesNotMatch(card, /Re-plans this card using the Gmail thread/);
  assert.doesNotMatch(lookup, /Picking a record re-plans the card against it/);
  assert.doesNotMatch(card, /Results are shown for review/);
  assert.doesNotMatch(card, /Applied values only change this review card/);
  assert.doesNotMatch(card, /review every field/i);
  assert.doesNotMatch(card, /source: \{provenanceLabel\}/);
  assert.doesNotMatch(card, /Changing this option re-plans the same card/);
  assert.doesNotMatch(card, /This control appears only when the request mentions HA/);
  assert.doesNotMatch(card, /Name was unavailable: Account name/);
});

test('one-shot new account exposes the same enrichment choices as the Zoho tab', () => {
  assert.match(source, /value: 'zia', label: 'Zia enrichment'/);
  assert.match(source, /value: 'haiku', label: 'Web search'/);
  assert.match(source, /value: 'sonnet', label: 'Deep web search'/);
  assert.match(card, /MSG\.ENRICH_COMPANY/);
  assert.match(card, /cache_bust: true/);
  assert.match(card, /start_tier: startTier/);
  assert.match(card, /aria-label="Choose account enrichment source"/);
});

test('one-shot enrichment remains preview-first and locally applied', () => {
  assert.match(card, /setEnrichmentAlternate\(result\)/);
  assert.match(card, /onClick=\{\(\) => useEnrichmentResult\(enrichmentAlternate\)\}/);
  assert.doesNotMatch(card, /CRM_CREATE_ACCOUNT/);
  assert.doesNotMatch(card, /ONESHOT_EXECUTE/);
});
