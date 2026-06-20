// Self-contained, network-free unit tests for the TD SYNNEX "Software licenses
// delivered" Dashboard Software License Claim Key matching helpers.
//
// These pure functions mirror what Agent A1 implements in src/index.js. They are
// inlined here intentionally: this test imports NO live worker code and makes NO
// network calls, so it runs deterministically with `node test-license-key-matching.js`.
//
// All keys/order numbers below are SYNTHETIC fixtures. The one canonical-format
// string ('Z29N-6SBM-5R9D') is a format example only, never a real recovered key.

'use strict';

// ── Inlined pure functions (mirror Agent A1) ───────────────────────────────────

// EXACT regex per spec. Label-anchored so bare keys/dates do not match.
// Generalized across distributor formats: TD SYNNEX ("Dashboard Software License
// Claim Key"), Comstor/Meraki ship-notification ("Dashboard license key:"), etc.
const CLAIM_KEY_RE =
  /(?:Dashboard\s+Software\s+License\s+Claim\s+Key|Dashboard\s+license\s+key|claim\s+key|license\s+key)\s*:?\s*([A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4})(?![A-Z0-9-])/i;

function extractClaimKey(text) {
  if (!text) return null;
  const m = String(text).match(CLAIM_KEY_RE);
  return m ? m[1].toUpperCase() : null;
}

function stripHtml(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')      // drop tags
    .replace(/&nbsp;/gi, ' ')       // decode non-breaking space
    .replace(/&amp;/gi, '&')        // decode ampersand
    .replace(/\s+/g, ' ')           // collapse whitespace
    .trim();
}

function buildGmailQuery({ webOrderId, po, soNumber } = {}) {
  const parts = [
    'from:ciscob2bupdates@tdsynnex.com',
    'subject:"Software licenses delivered"',
  ];
  const tokens = [];
  if (webOrderId) tokens.push(`"${webOrderId}"`);
  if (po) tokens.push(`"${po}"`);
  if (soNumber) tokens.push(`"${soNumber}"`);
  if (tokens.length) parts.push(tokens.join(' OR '));
  return parts.join(' ');
}

// deal_id contract: a Zoho record id is numeric, 13-19 digits.
function validateDealId(id) {
  return !!id && /^\d{13,19}$/.test(String(id).trim());
}

// Mirror the production safe()+filter: drop quotes/backslashes, keep alnum . _ -.
// Prevents a token from injecting Gmail operators or broadening the search.
function sanitizeTokens(...vals) {
  return vals
    .map((t) => String(t == null ? '' : t).replace(/["\\]/g, '').trim())
    .filter((t) => t && /^[A-Za-z0-9._\-]+$/.test(t));
}

// Ownership guard (production-faithful): only a HIGH-ENTROPY (>=6 char) identifier
// matched on a TOKEN BOUNDARY confirms the email belongs to this order, so generic
// values ("PO", "123") and substrings inside longer numbers cannot leak another key.
function ownedToken(text, tokens) {
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (tokens || [])
    .filter((t) => t && t.length >= 6)
    .find((t) => new RegExp(`(^|[^A-Za-z0-9._-])${esc(t)}([^A-Za-z0-9._-]|$)`).test(String(text))) || null;
}

// ── Tiny assert helper ─────────────────────────────────────────────────────────

let passed = 0;
let total = 0;
function check(name, cond) {
  total++;
  if (cond) { passed++; console.log(`  PASS ${name}`); }
  else { console.log(`  FAIL ${name}`); }
}
function eq(name, actual, expected) {
  check(`${name} (got ${JSON.stringify(actual)})`, actual === expected);
}

console.log('\nLicense claim-key matching\n────────────────────────────────────────────────────────────────');

// 1. extractClaimKey — positives
eq(
  'canonical-format key extracted',
  extractClaimKey('Dashboard Software License Claim Key Z29N-6SBM-5R9D'),
  'Z29N-6SBM-5R9D'
);
eq(
  'Comstor/Meraki "Dashboard license key:" format extracted',
  extractClaimKey('Cisco order number: 117191974 Dashboard license key: Z2AB-MBXG-MHDM Comstor PO number: 34267383'),
  'Z2AB-MBXG-MHDM'
);
eq(
  'prose "license key, which must be added" -> null (no key follows the label)',
  extractClaimKey('this e-mail contains your cloud Dashboard license key, which must be added to your Dashboard'),
  null
);
eq(
  'synthetic key extracted',
  extractClaimKey('Dashboard Software License Claim Key ABCD-1234-WXYZ'),
  'ABCD-1234-WXYZ'
);
eq(
  'lowercase input is uppercased',
  extractClaimKey('dashboard software license claim key abcd-1234-wxyz'),
  'ABCD-1234-WXYZ'
);
eq(
  'label with colon separator',
  extractClaimKey('Dashboard Software License Claim Key: ABCD-1234-WXYZ'),
  'ABCD-1234-WXYZ'
);
eq(
  'key embedded mid-sentence with surrounding text',
  extractClaimKey('Please see: Dashboard Software License Claim Key ABCD-1234-WXYZ for activation.'),
  'ABCD-1234-WXYZ'
);

// 1. extractClaimKey — negatives (must be null)
eq(
  'missing hyphen -> null',
  extractClaimKey('Dashboard Software License Claim Key ABCD1234WXYZ'),
  null
);
eq(
  'bare date -> null (no label anchor)',
  extractClaimKey('Order placed 2026-06-19 confirmed'),
  null
);
eq(
  'random HELLO-WORLD without label -> null',
  extractClaimKey('HELLO-WORLD is not a key'),
  null
);
eq(
  'key-shaped token without the label -> null',
  extractClaimKey('ABCD-1234-WXYZ'),
  null
);
eq(
  'empty input -> null',
  extractClaimKey(''),
  null
);

// 2. stripHtml — key inside HTML is still extractable
const htmlBody =
  '<div><span>Dashboard Software License Claim&nbsp;Key:</span>' +
  '<br/><b>ABCD-1234-WXYZ</b></div>';
const stripped = stripHtml(htmlBody);
check(
  'stripHtml removes tags',
  !/[<>]/.test(stripped)
);
check(
  'stripHtml decodes &nbsp; (no literal nbsp entity remains)',
  !/&nbsp;/i.test(stripped)
);
eq(
  'stripHtml decodes &amp; to &',
  stripHtml('Cisco &amp; Meraki'),
  'Cisco & Meraki'
);
check(
  'stripHtml collapses whitespace (no double spaces)',
  !/ {2,}/.test(stripHtml('a   b\n\nc'))
);
eq(
  'claim key extractable after stripHtml',
  extractClaimKey(stripped),
  'ABCD-1234-WXYZ'
);

// 3. buildGmailQuery
const allQ = buildGmailQuery({ webOrderId: 'WEB99001', po: 'PO-7788', soNumber: 'SO-55012' });
check(
  'query always has TD SYNNEX from: filter',
  allQ.includes('from:ciscob2bupdates@tdsynnex.com')
);
check(
  'query always has delivered subject filter',
  allQ.includes('subject:"Software licenses delivered"')
);
check(
  'all-present: OR-joins the three quoted tokens',
  allQ.includes('"WEB99001" OR "PO-7788" OR "SO-55012"')
);
const webOnlyQ = buildGmailQuery({ webOrderId: 'WEB99001' });
check(
  'only-webOrder: single quoted token, no OR',
  webOnlyQ.includes('"WEB99001"') && !webOnlyQ.includes(' OR ')
);
check(
  'only-webOrder: omits absent po/so tokens',
  !webOnlyQ.includes('PO-') && !webOnlyQ.includes('SO-')
);
const noneQ = buildGmailQuery({});
eq(
  'none-present: just from + subject filters',
  noneQ,
  'from:ciscob2bupdates@tdsynnex.com subject:"Software licenses delivered"'
);
check(
  'none-present: no stray OR / quotes',
  !noneQ.includes(' OR ') && !noneQ.includes('"WEB')
);
eq(
  'no-args call behaves like none-present',
  buildGmailQuery(),
  'from:ciscob2bupdates@tdsynnex.com subject:"Software licenses delivered"'
);

// 4. deal_id validation (numeric Zoho id, 13-19 digits) — codex hardening
check('valid 16-digit Zoho id', validateDealId('2570562000405654312'));
check('valid 13-digit id', validateDealId('1234567890123'));
check('rejects non-numeric id', !validateDealId('abc123'));
check('rejects too-short id', !validateDealId('12345'));
check('rejects COQL-injection attempt', !validateDealId("1' OR '1'='1"));
check('rejects empty id', !validateDealId(''));

// 5. token sanitization (block Gmail operator/quote injection + search broadening)
eq('keeps clean alnum/.-_ tokens',
  sanitizeTokens('WEB99001', 'PO-7788', 'SO_55012').join(','),
  'WEB99001,PO-7788,SO_55012');
const saniInj = sanitizeTokens('" OR from:victim@example.com', 'PO-7788');
check('drops a token containing quotes/operators',
  !saniInj.some((t) => t.includes('"') || t.includes('@') || t.includes(' ')));
check('keeps the safe token from a mixed set', saniInj.includes('PO-7788'));
eq('all-unsafe -> empty (caller must abort, no identifier)',
  sanitizeTokens('a b', 'y@z', 'p#q').length, 0);
check('quotes stripped, inner token kept (injection neutralized)',
  sanitizeTokens('"WEB123"').join(',') === 'WEB123');

// 6. ownership verification (never return another customer's key)
const ownBody = stripHtml('<p>Web order # WEB99001 ... Dashboard Software License Claim Key ABCD-1234-WXYZ</p>');
eq('high-entropy token on a boundary confirms ownership', ownedToken(ownBody, ['WEB99001']), 'WEB99001');
check('email body WITHOUT our token is rejected (no cross-customer leak)',
  ownedToken(ownBody, ['WEB-OTHER-999']) === null);
check('generic short token (<6 chars) cannot confirm ownership',
  ownedToken('PO PO PO ' + ownBody, ['PO']) === null);
check('substring inside a longer number does not match (token boundary)',
  ownedToken('ref 1239999 here', ['123999']) === null);
check('token that is a prefix of a longer DASHED id does not match (codex round-2)',
  ownedToken('ref ABC-123-999 here', ['ABC-123']) === null);
eq('key that is a prefix of a longer token -> null (trailing boundary, codex round-2)',
  extractClaimKey('Dashboard license key: ABCD-1234-WXYZ-9999'),
  null);

console.log(`\nPASS ${passed}/${total}`);
if (passed !== total) process.exit(1);
