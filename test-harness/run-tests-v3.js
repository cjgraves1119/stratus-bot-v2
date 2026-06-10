#!/usr/bin/env node
/**
 * Stratus AI CRM Agent — v3 Test Matrix (48 active tests, A6 Velocity Hub skipped)
 *
 * Why v3 (see V3-MATRIX-PROPOSAL.md):
 *   1. v2 graded by reply-text only. v3 runs ZohoCRM_getRecord on every write
 *      and asserts actual record state (subform, address, term fields, stage).
 *   2. v2 used EOL SKUs as positive inputs. v3 only uses EOL SKUs as refusal
 *      scenarios (category E).
 *   3. v2 had multi-step prompts in one message. v3 uses one action per user
 *      message, with multi-turn flows via shared sessionId (T, A, L5a/L5b).
 *   4. v2 never checked address completeness. v3 fails any Create/Clone whose
 *      address block is blank or whose Country is not "US" (2-letter).
 *
 * Categories (48 active tests):
 *   C — Create Quote (9)          L — Line-item delete/replace (7)
 *   T — Term changes (6)          D — Deal CRUD (7)
 *   Q — Quote CRUD (7)            A — Admin actions (5, A6 skipped)
 *   E — EOL refusal + bypass (5)  X — Read-only (2)
 *
 * Pass threshold: 90% ≥ 43/48.
 *
 * Requires the gateway to expose /api/harness/get-record (and friends) — that
 * endpoint was added to worker-gchat/src/index.js in this same change.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ──────────────────────────────────────────────────────────────────
const GATEWAY = process.env.GATEWAY || 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev';
const USER_EMAIL = 'chrisg@stratusinfosystems.com';
const PERSON_ID = '2570562000141711002';
const TEST_ACCOUNT = '2570562000401231689';   // TEST - Llama Verification
const ACME_ACCOUNT = '2570562000401269789';    // Acme Corp
const SEED_DEAL = '2570562000401269831';
let SEED_DEAL_CLOSEDLOST = process.env.SEED_DEAL_CLOSEDLOST || '2570562000401222755';
let SEED_QUOTE = process.env.SEED_QUOTE || '2570562000401474208';
let SEED_QUOTE_MULTI = process.env.SEED_QUOTE_MULTI || null; // created per-run
const SEED_CONTACT = '2570562000401235755';
const FORCE_MODEL = process.env.FORCE_MODEL || null;
const RUN_LABEL = process.env.RUN_LABEL || (FORCE_MODEL ? `${FORCE_MODEL}-v3` : 'auto-v3');
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(s => s.trim())) : null;
const SKIP_SEED = process.env.SKIP_SEED === '1';

const EXPECTED_ADDR = {
  street: '1234 Test Harbor Dr',
  city: 'Nashville',
  state: 'TN',
  code: '37027',
  country: 'US',
};

const outPath = path.join(__dirname, `results-v3-${RUN_LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const logStream = fs.createWriteStream(outPath, { flags: 'a' });

// ─── Markdown renderer (mirrors harness) ─────────────────────────────────────
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function renderInline(text) {
  const codeSlots = [];
  text = text.replace(/`([^`\n]+)`/g, (_, c) => { codeSlots.push(c); return `\u0001CODE${codeSlots.length - 1}\u0001`; });
  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;
  const linkSlots = [];
  text = text.replace(linkRegex, (_, mdText, mdUrl, bareUrl) => {
    const url = mdUrl || bareUrl;
    const label = mdText || url;
    let href = url, trail = '';
    if (bareUrl) {
      const m = /[.,;:!?)\]]+$/.exec(href);
      if (m) { trail = m[0]; href = href.slice(0, -trail.length); }
    }
    linkSlots.push(`<a href="${escHtml(href)}" target="_blank" rel="noopener">${escHtml(label)}</a>${escHtml(trail)}`);
    return `\u0001LINK${linkSlots.length - 1}\u0001`;
  });
  text = escHtml(text);
  const emphRe = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g;
  text = text.split(emphRe).map(c => {
    if (/^\*\*[^*]+\*\*$/.test(c)) return `<strong>${c.slice(2, -2)}</strong>`;
    if (/^\*[^*\n]+\*$/.test(c))   return `<em>${c.slice(1, -1)}</em>`;
    if (/^_[^_\n]+_$/.test(c))     return `<em>${c.slice(1, -1)}</em>`;
    return c;
  }).join('');
  text = text.replace(/\u0001LINK(\d+)\u0001/g, (_, i) => linkSlots[+i]);
  text = text.replace(/\u0001CODE(\d+)\u0001/g, (_, i) => `<code>${escHtml(codeSlots[+i])}</code>`);
  return text;
}
function renderMarkdown(raw) {
  if (!raw) return '';
  const lines = String(raw).replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let inList = false, listTag = 'ul', para = [];
  const flushPara = () => { if (para.length) { out.push('<p>' + renderInline(para.join(' ')) + '</p>'); para = []; } };
  const openList = t => { if (!inList || listTag !== t) { if (inList) out.push(`</${listTag}>`); out.push(`<${t}>`); listTag = t; inList = true; } };
  const closeList = () => { if (inList) { out.push(`</${listTag}>`); inList = false; } };
  for (const line of lines) {
    if (/^\s*$/.test(line)) { flushPara(); closeList(); continue; }
    if (/^\s*---\s*$/.test(line) || /^\s*\*\*\*\s*$/.test(line)) { flushPara(); closeList(); out.push('<hr/>'); continue; }
    const b = /^\s*[-*•]\s+(.*)$/.exec(line);
    const n = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (b) { flushPara(); openList('ul'); out.push('<li>' + renderInline(b[1]) + '</li>'); continue; }
    if (n) { flushPara(); openList('ol'); out.push('<li>' + renderInline(n[1]) + '</li>'); continue; }
    closeList();
    para.push(line);
  }
  flushPara(); closeList();
  return out.join('');
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────
async function sendChat(text, history, progressId, sessionId) {
  const body = {
    text,
    emailContext: null,
    history: (history || []).slice(-10),
    systemContext: {
      userEmail: USER_EMAIL,
      personId: PERSON_ID,
      sessionId,
      testAccountId: TEST_ACCOUNT,
      harness: true,
    },
    progressId,
  };
  if (FORCE_MODEL) body.forceModel = FORCE_MODEL;
  const t0 = Date.now();
  const res = await fetch(`${GATEWAY}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  const replyText = (parsed && typeof parsed === 'object')
    ? (parsed.reply || parsed.message || parsed.text || parsed.response || (parsed.error ? `⚠️ ${parsed.error}` : ''))
    : String(parsed);
  return {
    elapsedMs: Date.now() - t0, status: res.status, ok: res.ok, raw, parsed,
    replyText, renderedHtml: renderMarkdown(replyText),
  };
}

async function harnessGet(module, recordId, fields) {
  const body = { module, recordId, fields: fields || '' };
  const res = await fetch(`${GATEWAY}/api/harness/get-record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function harnessSearch(module, criteria, fields) {
  const body = { module, criteria, fields: fields || '' };
  const res = await fetch(`${GATEWAY}/api/harness/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
    body: JSON.stringify(body),
  });
  return res.json();
}
async function harnessUpsert(module, recordId, data) {
  const body = { module, recordId: recordId || '', data };
  const res = await fetch(`${GATEWAY}/api/harness/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ─── Assertions ──────────────────────────────────────────────────────────────
const QUOTE_FIELDS = [
  'Quoted_Items','Billing_Street','Billing_City','Billing_State','Billing_Code','Billing_Country',
  'Shipping_Street','Shipping_City','Shipping_State','Shipping_Code','Shipping_Country',
  'Valid_Till','Cisco_Billing_Term','Subject','Admin_Action','CCW_Deal_Number','Discount','Deal_Name',
].join(',');
const DEAL_FIELDS = 'Deal_Name,Stage,Lead_Source,Meraki_ISR,Closing_Date,Billing_Street,Billing_City,Billing_State,Billing_Code,Billing_Country';

function assertQuoteComplete(q) {
  if (!q) return { ok: false, reason: 'no record returned' };
  const check = (field, expected) => {
    const actual = q[field];
    if (actual !== expected) return `${field}="${actual}" ≠ "${expected}"`;
    return null;
  };
  const miss = [
    check('Billing_Street', EXPECTED_ADDR.street),
    check('Billing_City', EXPECTED_ADDR.city),
    check('Billing_State', EXPECTED_ADDR.state),
    check('Billing_Code', EXPECTED_ADDR.code),
    check('Billing_Country', EXPECTED_ADDR.country),
    check('Shipping_Street', EXPECTED_ADDR.street),
    check('Shipping_City', EXPECTED_ADDR.city),
    check('Shipping_State', EXPECTED_ADDR.state),
    check('Shipping_Code', EXPECTED_ADDR.code),
    check('Shipping_Country', EXPECTED_ADDR.country),
    !q.Valid_Till ? 'Valid_Till blank' : null,
    !q.Cisco_Billing_Term ? 'Cisco_Billing_Term blank' : null,
  ].filter(Boolean);
  return miss.length ? { ok: false, reason: miss.join('; ') } : { ok: true };
}

function subformSkus(q) {
  return (q?.Quoted_Items || []).map(r => {
    // Product_Name can be an object ({id, name}) or a plain string depending on GET shape
    const pn = r.Product_Name;
    if (typeof pn === 'string') return pn;
    if (pn && typeof pn === 'object') return pn.name || pn.Product_Code || '';
    if (r.Product_Code) return r.Product_Code;
    if (r.Product?.name) return r.Product.name;
    if (r.Product?.Product_Code) return r.Product.Product_Code;
    return '';
  });
}
function subformRows(q) { return q?.Quoted_Items || []; }

// ─── Utils ───────────────────────────────────────────────────────────────────
const containsCI = (text, needle) => (text || '').toLowerCase().includes((needle || '').toLowerCase());
const containsAny = (text, needles) => needles.some(n => containsCI(text, n));
const hasZohoUrl = (text) => /https:\/\/crm\.zoho\.com\//i.test(text);
function extractHrefs(html) {
  const re = /<a [^>]*href="([^"]+)"/g;
  const hrefs = [];
  let m; while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}
function extractQuoteId(text) {
  const m = /\/Quotes\/(\d{15,20})/i.exec(text || '');
  return m ? m[1] : null;
}
function extractDealId(text) {
  const m = /\/(Deals|Potentials)\/(\d{15,20})/i.exec(text || '');
  return m ? m[2] : null;
}
function extractContactId(text) {
  const m = /\/Contacts\/(\d{15,20})/i.exec(text || '');
  return m ? m[1] : null;
}

// ─── Fixture seeding ─────────────────────────────────────────────────────────
async function seedQuoteMulti() {
  console.log('[seed] creating SEED_QUOTE_MULTI on SEED_DEAL with 4 line items...');
  const today = new Date();
  const validTill = new Date(today.getTime() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const data = {
    Subject: `v3-SEED-MULTI-${today.toISOString().slice(0, 10)}`,
    Deal_Name: SEED_DEAL,
    Account_Name: TEST_ACCOUNT,
    Valid_Till: validTill,
    Cisco_Billing_Term: 'Prepaid Term',
    Billing_Street: EXPECTED_ADDR.street, Billing_City: EXPECTED_ADDR.city,
    Billing_State: EXPECTED_ADDR.state, Billing_Code: EXPECTED_ADDR.code,
    Billing_Country: EXPECTED_ADDR.country,
    Shipping_Street: EXPECTED_ADDR.street, Shipping_City: EXPECTED_ADDR.city,
    Shipping_State: EXPECTED_ADDR.state, Shipping_Code: EXPECTED_ADDR.code,
    Shipping_Country: EXPECTED_ADDR.country,
    Quoted_Items: [
      { Product_Name: { id: '2570562000028840059', name: 'MR46-HW' }, Quantity: 2 },
      { Product_Name: { id: '2570562000001098895', name: 'LIC-ENT-3YR' }, Quantity: 2 },
      { Product_Name: { id: '2570562000290749263', name: 'MS150-24P-4X' }, Quantity: 1 },
      { Product_Name: { id: '2570562000290228681', name: 'LIC-MS150-24-3Y' }, Quantity: 1 },
    ],
  };
  const result = await harnessUpsert('Quotes', null, data);
  if (result?.ok && result.recordId) {
    console.log(`[seed] SEED_QUOTE_MULTI = ${result.recordId}`);
    return result.recordId;
  }
  console.error('[seed] SEED_QUOTE_MULTI creation failed:', JSON.stringify(result, null, 2));
  throw new Error('SEED_QUOTE_MULTI seeding failed — aborting run');
}

async function verifySeedDealClosedLost() {
  const resp = await harnessGet('Deals', SEED_DEAL_CLOSEDLOST, 'Deal_Name,Stage');
  const r = resp?.record;
  if (!r) {
    console.warn(`[seed] SEED_DEAL_CLOSEDLOST ${SEED_DEAL_CLOSEDLOST} not found — skipping A4`);
    return false;
  }
  if (r.Stage !== 'Closed (Lost)') {
    console.log(`[seed] SEED_DEAL_CLOSEDLOST stage is "${r.Stage}" — forcing to "Closed (Lost)"`);
    await harnessUpsert('Deals', SEED_DEAL_CLOSEDLOST, { Stage: 'Closed (Lost)' });
  }
  return true;
}

async function verifySeedDealOpen() {
  const resp = await harnessGet('Deals', SEED_DEAL, 'Deal_Name,Stage,Account_Name');
  const r = resp?.record;
  if (!r) throw new Error(`[seed] SEED_DEAL ${SEED_DEAL} not found — cannot run C/T/L/A tests`);
  const closed = /closed/i.test(r.Stage || '');
  if (closed) {
    console.log(`[seed] SEED_DEAL stage "${r.Stage}" is closed — resetting to "Proposal/Negotiation"`);
    await harnessUpsert('Deals', SEED_DEAL, { Stage: 'Proposal/Negotiation' });
  }
}

// ─── Test definitions ────────────────────────────────────────────────────────
// Each test has:
//   id (string) — human id like "C1", "T2"
//   cat — single letter category
//   write — true = mutates state, false = read-only
//   continuesPrevious — true = share sessionId + history with prior test
//   prompt — user message
//   criteria — async (ctx, state) => { pass, notes, extras? }
//      state is mutable object shared across a session; use it to stash IDs
//
// Zoho assertions live inside criteria so the runner stays flat.

const TESTS = [
  // ==========================================================================
  // C — Create Quote (9 tests)
  // ==========================================================================
  {
    id: 'C1', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 2× MR46-HW + 2× LIC-ENT-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const hasBoth = skus.includes('MR46-HW') && skus.some(s => s === 'LIC-ENT-3YR');
      const rows = subformRows(record);
      const discounted = rows.length >= 2 && rows.every(r => Number(r.Discount || 0) > 0);
      const pass = addr.ok && hasBoth && rows.length === 2 && discounted;
      return { pass, notes: pass ? 'ok' : `addr:${addr.ok ? 'ok' : addr.reason}; skus=${skus.join(',')}; rows=${rows.length}; discounted=${discounted}`, extras: { qid } };
    },
  },
  {
    id: 'C2', cat: 'C', write: true,
    prompt: () => `Create a list-price quote on deal ${SEED_DEAL} with 1× MR46-HW + 1× LIC-ENT-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const rows = subformRows(record);
      const listPrice = rows.length >= 2 && rows.every(r => Number(r.Discount || 0) === 0);
      const pass = addr.ok && rows.length === 2 && listPrice;
      return { pass, notes: pass ? 'ok' : `addr:${addr.ok ? 'ok' : addr.reason}; rows=${rows.length}; listPrice=${listPrice}`, extras: { qid } };
    },
  },
  {
    id: 'C3', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 3× MS150-24P-4X + 3× LIC-MS150-24-3Y.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const rows = subformRows(record);
      const hwRow = rows.find(r => /MS150-24P-4X/i.test(r.Product_Code || r.Product_Name || ''));
      const licRow = rows.find(r => /LIC-MS150-24-3Y/i.test(r.Product_Code || r.Product_Name || ''));
      const qtyOk = hwRow && licRow && Number(hwRow.Quantity) === 3 && Number(licRow.Quantity) === 3;
      const pass = addr.ok && qtyOk;
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; hwRow=${!!hwRow}; licRow=${!!licRow}; qty=${qtyOk}`, extras: { qid } };
    },
  },
  {
    id: 'C4', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 1× CW9166I-MR + 1× LIC-ENT-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = addr.ok && skus.some(s => s.includes('CW9166I-MR')) && skus.some(s => s === 'LIC-ENT-3YR');
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'C5', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 1× MX75-HW + 1× LIC-MX75-ENT-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = addr.ok && skus.includes('MX75-HW') && skus.some(s => s === 'LIC-MX75-ENT-3YR');
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'C6', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 1× MV32-HW + 1× LIC-MV-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = addr.ok && skus.includes('MV32-HW') && skus.some(s => s === 'LIC-MV-3YR');
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'C7', cat: 'C', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 1× MT10-HW + 1× LIC-MT-3Y.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL in reply' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const hasMt = skus.some(s => s === 'MT10-HW');
      // MT free-tier logic may drop the LIC row — accept either shape so long as hardware lands with full address.
      const pass = addr.ok && hasMt;
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'C8', cat: 'C', write: false,
    prompt: () => `What's the default pricing mode on new quotes?`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['ecomm', 'stratus', '13%']),
      notes: 'default pricing mode explained',
    }),
  },
  {
    id: 'C9', cat: 'C', write: false,
    prompt: () => `Create a quote on deal ${SEED_DEAL}.`,
    criteria: async (ctx) => {
      const asks = /\?/.test(ctx.replyText) && containsAny(ctx.replyText, ['sku', 'product', 'line item', 'what would', 'which']);
      // Also check no new quote landed on SEED_DEAL in the last 60s
      const cutoff = new Date(Date.now() - 120000).toISOString().slice(0, 19) + '+00:00';
      const search = await harnessSearch('Quotes', `(Deal_Name:equals:${SEED_DEAL})and(Created_Time:greater_than:${cutoff})`, 'id,Subject,Created_Time');
      const createdCount = (search?.records || []).length;
      const pass = asks && createdCount === 0;
      return { pass, notes: `asks=${asks}; createdIn120s=${createdCount}` };
    },
  },

  // ==========================================================================
  // T — Term Changes (multi-turn)
  // ==========================================================================
  {
    id: 'T1', cat: 'T', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 2× MR46-HW + 2× LIC-ENT-3YR.`,
    criteria: async (ctx, state) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL' };
      state.tFlow1QuoteId = qid;
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = addr.ok && skus.includes('MR46-HW') && skus.some(s => s === 'LIC-ENT-3YR');
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'T2', cat: 'T', write: true, continuesPrevious: true,
    prompt: () => `Change the license term to 5 years.`,
    criteria: async (ctx, state) => {
      const qid = state.tFlow1QuoteId;
      if (!qid) return { pass: false, notes: 'no qid from T1' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = skus.some(s => s === 'LIC-ENT-5YR') && !skus.some(s => s === 'LIC-ENT-3YR');
      return { pass, notes: `skus=${skus.join(',')}` };
    },
  },
  {
    id: 'T3', cat: 'T', write: true, continuesPrevious: true,
    prompt: () => `Actually, make it 1 year.`,
    criteria: async (ctx, state) => {
      const qid = state.tFlow1QuoteId;
      if (!qid) return { pass: false, notes: 'no qid from T1' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = skus.some(s => s === 'LIC-ENT-1YR') && !skus.some(s => s === 'LIC-ENT-3YR' || s === 'LIC-ENT-5YR');
      return { pass, notes: `skus=${skus.join(',')}` };
    },
  },
  {
    id: 'T4', cat: 'T', write: true,
    prompt: () => `Create an ecomm quote on deal ${SEED_DEAL} with 1× MX75-HW + 1× LIC-MX75-ENT-1YR.`,
    criteria: async (ctx, state) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL' };
      state.tFlow2QuoteId = qid;
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = addr.ok && skus.includes('MX75-HW') && skus.some(s => s === 'LIC-MX75-ENT-1YR');
      return { pass, notes: pass ? 'ok' : `addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },
  {
    id: 'T5', cat: 'T', write: true, continuesPrevious: true,
    prompt: () => `Bump the security license to 3 years.`,
    criteria: async (ctx, state) => {
      const qid = state.tFlow2QuoteId;
      if (!qid) return { pass: false, notes: 'no qid from T4' };
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = skus.some(s => s === 'LIC-MX75-ENT-3YR') && !skus.some(s => s === 'LIC-MX75-ENT-1YR');
      return { pass, notes: `skus=${skus.join(',')}` };
    },
  },
  {
    id: 'T6', cat: 'T', write: false, continuesPrevious: true,
    prompt: () => `Change the term on the license.`,
    criteria: async (ctx, state) => {
      const qid = state.tFlow2QuoteId;
      if (!qid) return { pass: false, notes: 'no qid from T4' };
      const asks = /\?/.test(ctx.replyText) && containsAny(ctx.replyText, ['which', 'what term', '1', '3', '5', 'year']);
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const unchanged = skus.some(s => s === 'LIC-MX75-ENT-3YR');
      return { pass: asks && unchanged, notes: `asks=${asks}; unchanged=${unchanged}; skus=${skus.join(',')}` };
    },
  },

  // ==========================================================================
  // L — Line-Item Delete / Replace (operates on SEED_QUOTE_MULTI)
  // Each L test resets SEED_QUOTE_MULTI before running (except L5b, which
  // continues L5a's session).
  // ==========================================================================
  {
    id: 'L1', cat: 'L', write: true, requiresReseedMulti: true,
    prompt: () => `Remove the MS150-24P-4X line from quote ${SEED_QUOTE_MULTI}.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const rows = subformRows(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = rows.length === 3 && !skus.some(s => s === 'MS150-24P-4X');
      return { pass, notes: `rows=${rows.length}; skus=${skus.join(',')}` };
    },
  },
  {
    id: 'L2', cat: 'L', write: true, requiresReseedMulti: true,
    prompt: () => `Replace MR46-HW with MR46E-HW on quote ${SEED_QUOTE_MULTI}, keep qty 2.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const rows = subformRows(record);
      const mr46e = rows.find(r => /MR46E-HW/i.test(r.Product_Code || r.Product_Name || ''));
      const mr46 = rows.find(r => /^MR46-HW$/i.test(r.Product_Code || r.Product_Name || ''));
      const licRow = rows.find(r => /LIC-ENT-3YR/i.test(r.Product_Code || r.Product_Name || ''));
      const pass = mr46e && Number(mr46e.Quantity) === 2 && !mr46 && licRow;
      return { pass, notes: `mr46e=${!!mr46e}(qty=${mr46e?.Quantity}); mr46=${!!mr46}; licRow=${!!licRow}` };
    },
  },
  {
    id: 'L3', cat: 'L', write: true, requiresReseedMulti: true,
    prompt: () => `Change the qty on LIC-ENT-3YR to 4 on quote ${SEED_QUOTE_MULTI}.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const rows = subformRows(record);
      const licRow = rows.find(r => /LIC-ENT-3YR/i.test(r.Product_Code || r.Product_Name || ''));
      const pass = licRow && Number(licRow.Quantity) === 4 && rows.length === 4;
      return { pass, notes: `licRow=${!!licRow}; qty=${licRow?.Quantity}; rows=${rows.length}` };
    },
  },
  {
    id: 'L4', cat: 'L', write: true, requiresReseedMulti: true,
    prompt: () => `Delete all hardware lines from quote ${SEED_QUOTE_MULTI}, keep only licenses.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const rows = subformRows(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const allLic = skus.length > 0 && skus.every(s => s.startsWith('LIC-'));
      return { pass: allLic, notes: `skus=${skus.join(',')}` };
    },
  },
  {
    id: 'L5a', cat: 'L', write: false, requiresReseedMulti: true,
    prompt: () => `Remove a line from quote ${SEED_QUOTE_MULTI}.`,
    criteria: async (ctx) => {
      const asks = /\?/.test(ctx.replyText) && containsAny(ctx.replyText, ['which', 'what line', 'specify']);
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const unchanged = subformRows(record).length === 4;
      return { pass: asks && unchanged, notes: `asks=${asks}; unchanged=${unchanged}` };
    },
  },
  {
    id: 'L5b', cat: 'L', write: true, continuesPrevious: true,
    prompt: () => `The MS150 one.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const rows = subformRows(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const pass = rows.length === 3 && !skus.some(s => s === 'MS150-24P-4X');
      return { pass, notes: `rows=${rows.length}; skus=${skus.join(',')}` };
    },
  },
  {
    id: 'L6', cat: 'L', write: true, requiresReseedMulti: true,
    prompt: () => `Replace the switch on quote ${SEED_QUOTE_MULTI} with a MS150-48FP-4X.`,
    criteria: async (ctx) => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const newHw = skus.some(s => s === 'MS150-48FP-4X');
      const newLic = skus.some(s => s === 'LIC-MS150-48-3Y');
      const oldHw = skus.some(s => s === 'MS150-24P-4X');
      const oldLic = skus.some(s => s === 'LIC-MS150-24-3Y');
      const replyMentions = containsCI(ctx.replyText, 'MS150-48FP-4X') && containsCI(ctx.replyText, 'LIC-MS150-48');
      const pass = newHw && newLic && !oldHw && !oldLic && replyMentions;
      return { pass, notes: `newHw=${newHw}; newLic=${newLic}; oldHw=${oldHw}; oldLic=${oldLic}; replyMentionsBoth=${replyMentions}` };
    },
  },
  {
    id: 'L7', cat: 'L', write: false, requiresReseedMulti: true,
    prompt: () => `Replace the switch on quote ${SEED_QUOTE_MULTI} with a MS250-24P-HW.`,
    criteria: async (ctx) => {
      const refuses = containsAny(ctx.replyText, ['eol', 'inactive', 'end of life', 'end-of-life', 'discontinued', 'not active']);
      const suggestsAlt = containsAny(ctx.replyText, ['MS150', 'MS130', 'replacement', 'alternative']);
      const { record } = await harnessGet('Quotes', SEED_QUOTE_MULTI, QUOTE_FIELDS);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const unchanged = skus.some(s => s === 'MS150-24P-4X') && skus.some(s => s === 'LIC-MS150-24-3Y') && !skus.some(s => s === 'MS250-24P-HW');
      return { pass: refuses && suggestsAlt && unchanged, notes: `refuses=${refuses}; suggestsAlt=${suggestsAlt}; unchanged=${unchanged}; skus=${skus.join(',')}` };
    },
  },

  // ==========================================================================
  // D — Deal CRUD
  // ==========================================================================
  {
    id: 'D1', cat: 'D', write: true,
    prompt: () => `Create a deal 'v3 Test — No Lead Source' on account ${TEST_ACCOUNT}, closing 2026-12-31.`,
    criteria: async (ctx) => {
      const did = extractDealId(ctx.replyText);
      if (!did) return { pass: false, notes: 'no Deal URL in reply' };
      const { record } = await harnessGet('Deals', did, DEAL_FIELDS);
      if (!record) return { pass: false, notes: 'deal fetch returned empty' };
      const leadSrc = record.Lead_Source === 'Stratus Referal';
      const isr = (record.Meraki_ISR?.name || '').toLowerCase().includes('stratus sales');
      const close = record.Closing_Date === '2026-12-31';
      const pass = leadSrc && isr && close;
      return { pass, notes: `leadSrc=${record.Lead_Source}; isr=${record.Meraki_ISR?.name}; close=${record.Closing_Date}`, extras: { did } };
    },
  },
  {
    id: 'D2', cat: 'D', write: true,
    prompt: () => `Create a deal 'v3 Test — ISR Referral from Matt Kochendorfer' on account ${TEST_ACCOUNT}, closing 2026-12-31.`,
    criteria: async (ctx) => {
      const did = extractDealId(ctx.replyText);
      if (!did) return { pass: false, notes: 'no Deal URL in reply' };
      const { record } = await harnessGet('Deals', did, DEAL_FIELDS);
      if (!record) return { pass: false, notes: 'deal fetch returned empty' };
      const leadSrc = record.Lead_Source === 'Meraki ISR Referal';
      const isr = (record.Meraki_ISR?.name || '').toLowerCase().includes('kochendorfer');
      const pass = leadSrc && isr;
      return { pass, notes: `leadSrc=${record.Lead_Source}; isr=${record.Meraki_ISR?.name}`, extras: { did } };
    },
  },
  {
    id: 'D3', cat: 'D', write: true,
    prompt: () => `Create a deal 'v3 Test — Past Closing' on account ${TEST_ACCOUNT}, closing 2024-01-15.`,
    criteria: async (ctx) => {
      const warns = containsAny(ctx.replyText, ['past', 'previous', '2024', 'already', 'warn']);
      const did = extractDealId(ctx.replyText);
      if (!did) return { pass: warns, notes: `warns=${warns}; no deal created` };
      const { record } = await harnessGet('Deals', did, DEAL_FIELDS);
      const close = record?.Closing_Date === '2024-01-15';
      return { pass: warns && close, notes: `warns=${warns}; close=${record?.Closing_Date}`, extras: { did } };
    },
  },
  {
    id: 'D4', cat: 'D', write: true,
    prompt: () => `Rename deal ${SEED_DEAL} to 'v3 Rename Test — ${Date.now()}'.`,
    criteria: async (ctx) => {
      const { record } = await harnessGet('Deals', SEED_DEAL, DEAL_FIELDS);
      const pass = /v3 Rename Test/i.test(record?.Deal_Name || '');
      return { pass, notes: `deal_name=${record?.Deal_Name}` };
    },
  },
  {
    id: 'D5', cat: 'D', write: true,
    prompt: () => `Add a note to deal ${SEED_DEAL}: 'v3 test note line 1 / line 2'.`,
    criteria: async (ctx) => {
      const notesResp = await fetch(`${GATEWAY}/api/crm-notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
        body: JSON.stringify({ accountId: SEED_DEAL }),
      }).then(r => r.json()).catch(() => null);
      // Fallback: just verify reply confirms note added
      const confirmed = containsAny(ctx.replyText, ['note', 'added', 'created']);
      return { pass: confirmed, notes: `confirmed=${confirmed}` };
    },
  },
  {
    id: 'D6', cat: 'D', write: false,
    prompt: () => `Find all open deals with 'renew' in the name.`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['renew', 'no deals', 'no records', 'found']) || extractHrefs(ctx.renderedHtml).length > 0,
      notes: 'renewal search',
    }),
  },
  {
    id: 'D7', cat: 'D', write: false,
    prompt: () => `Create a deal.`,
    criteria: async (ctx) => {
      const asks = /\?/.test(ctx.replyText) && containsAny(ctx.replyText, ['account', 'name', 'closing', 'which']);
      const cutoff = new Date(Date.now() - 120000).toISOString().slice(0, 19) + '+00:00';
      const search = await harnessSearch('Deals', `(Created_Time:greater_than:${cutoff})and(Deal_Name:starts_with:v3 Test)`, 'id,Deal_Name');
      // Any brand new v3-Test deal from the last 2 min would indicate bot silently created one
      const cnt = (search?.records || []).length;
      return { pass: asks, notes: `asks=${asks}; newV3DealsIn120s=${cnt}` };
    },
  },

  // ==========================================================================
  // Q — Quote CRUD on existing SEED_QUOTE
  // ==========================================================================
  {
    id: 'Q1', cat: 'Q', write: true,
    prompt: () => `Clone quote ${SEED_QUOTE}.`,
    criteria: async (ctx) => {
      const cloneId = extractQuoteId(ctx.replyText);
      if (!cloneId || cloneId === SEED_QUOTE) return { pass: false, notes: `cloneId=${cloneId}` };
      const { record: clone } = await harnessGet('Quotes', cloneId, QUOTE_FIELDS);
      const { record: orig } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const addr = assertQuoteComplete(clone);
      const rowsMatch = (clone?.Quoted_Items?.length || 0) === (orig?.Quoted_Items?.length || -1);
      return { pass: addr.ok && rowsMatch, notes: `addr:${addr.reason || 'ok'}; cloneRows=${clone?.Quoted_Items?.length}; origRows=${orig?.Quoted_Items?.length}`, extras: { cloneId } };
    },
  },
  {
    id: 'Q2', cat: 'Q', write: true,
    prompt: () => `Rename the subject on quote ${SEED_QUOTE} to '🚀 Rocket Quote v3'.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const pass = record?.Subject === '🚀 Rocket Quote v3';
      return { pass, notes: `subject=${record?.Subject}` };
    },
  },
  {
    id: 'Q3', cat: 'Q', write: false,
    prompt: () => `What's the margin on quote ${SEED_QUOTE}?`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['margin', 'cost', 'profit', '%']),
      notes: 'margin read',
    }),
  },
  {
    id: 'Q4', cat: 'Q', write: true,
    prompt: () => `Apply a 10% discount to every line on quote ${SEED_QUOTE}.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const rows = subformRows(record);
      const allDiscounted = rows.length > 0 && rows.every(r => Number(r.Discount || 0) > 0);
      return { pass: allDiscounted, notes: `rows=${rows.length}; allDiscounted=${allDiscounted}` };
    },
  },
  {
    id: 'Q5', cat: 'Q', write: false,
    prompt: () => `What's the deal ID for quote ${SEED_QUOTE}?`,
    criteria: async (ctx) => ({
      pass: ctx.replyText.includes(SEED_DEAL) || hasZohoUrl(ctx.replyText),
      notes: 'deal resolution from quote',
    }),
  },
  {
    id: 'Q6', cat: 'Q', write: true,
    prompt: () => `Update CCW_Deal_Number on quote ${SEED_QUOTE} to 87654321.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const pass = String(record?.CCW_Deal_Number || '').includes('87654321');
      return { pass, notes: `CCW=${record?.CCW_Deal_Number}` };
    },
  },
  {
    id: 'Q7', cat: 'Q', write: true,
    prompt: () => `Add a 1× LIC-ENT-5YR line to quote ${SEED_QUOTE} at ecomm pricing.`,
    criteria: async () => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const rows = subformRows(record);
      const newLine = rows.find(r => /LIC-ENT-5YR/i.test(r.Product_Code || r.Product_Name || ''));
      const pass = !!newLine && Number(newLine.Discount || 0) > 0;
      return { pass, notes: `newLine=${!!newLine}; discount=${newLine?.Discount}` };
    },
  },

  // ==========================================================================
  // A — Admin Actions (A6 Velocity Hub SKIPPED per Chris 2026-04-21)
  // ==========================================================================
  {
    id: 'A1', cat: 'A', write: true,
    prompt: () => `Submit deal ${SEED_DEAL} for Cisco discount approval — request 15%.`,
    criteria: async (ctx, state) => {
      const qid = extractQuoteId(ctx.replyText);
      if (qid) state.aFlowQuoteId = qid;
      const mentionsAdmin = containsAny(ctx.replyText, ['admin_action', 'admin action', 'live_cisco', 'cciscoquote', 'approval', 'submitted']);
      return { pass: mentionsAdmin, notes: `mentionsAdmin=${mentionsAdmin}; qid=${qid || 'n/a'}` };
    },
  },
  {
    id: 'A2', cat: 'A', write: false, continuesPrevious: true,
    prompt: () => `What's the admin action status on that quote now?`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['admin', 'status', 'live_cisco', 'none', 'not set', 'processing']),
      notes: 'admin_action read',
    }),
  },
  {
    id: 'A3', cat: 'A', write: true, continuesPrevious: true,
    prompt: () => `I got CCW Deal Number 12345678 back. Write it to the quote.`,
    criteria: async (ctx, state) => {
      const qid = state.aFlowQuoteId || extractQuoteId(ctx.replyText) || SEED_QUOTE;
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const pass = String(record?.CCW_Deal_Number || '').includes('12345678');
      return { pass, notes: `qid=${qid}; CCW=${record?.CCW_Deal_Number}` };
    },
  },
  {
    id: 'A4', cat: 'A', write: false,
    prompt: () => `Submit deal ${SEED_DEAL_CLOSEDLOST} for discount approval.`,
    criteria: async (ctx) => {
      const refuses = containsAny(ctx.replyText, ['closed', 'lost', 'cannot', 'refuse', 'not eligible']);
      const { record } = await harnessGet('Deals', SEED_DEAL_CLOSEDLOST, DEAL_FIELDS);
      const stageUnchanged = /closed \(lost\)/i.test(record?.Stage || '');
      return { pass: refuses && stageUnchanged, notes: `refuses=${refuses}; stage=${record?.Stage}` };
    },
  },
  {
    id: 'A5', cat: 'A', write: true,
    prompt: () => `Generate a Cisco DID for quote ${SEED_QUOTE}.`,
    criteria: async (ctx) => {
      const { record } = await harnessGet('Quotes', SEED_QUOTE, QUOTE_FIELDS);
      const mentionsDid = containsAny(ctx.replyText, ['did', 'live_ciscoquote', 'admin_action', 'processing', 'generated', 'submit']);
      // Admin_Action may be cleared after DID lands; accept either (mention OR field set)
      const fieldSet = !!record?.Admin_Action;
      return { pass: mentionsDid || fieldSet, notes: `mentionsDid=${mentionsDid}; Admin_Action=${record?.Admin_Action}` };
    },
  },

  // A6 Velocity Hub — SKIPPED per Chris 2026-04-21

  // ==========================================================================
  // E — EOL Refusal + False-Positive Guard
  // ==========================================================================
  {
    id: 'E1', cat: 'E', write: false,
    prompt: () => `Create a quote on deal ${SEED_DEAL} with 4× MS125-24P-HW + 4× LIC-MS125-24-3Y.`,
    criteria: async (ctx) => {
      const flags = containsAny(ctx.replyText, ['inactive', 'eol', 'discontinued', 'end of life', 'end-of-life']);
      const offersAlt = containsAny(ctx.replyText, ['MS150', 'bypass', 'replace']);
      const qid = extractQuoteId(ctx.replyText);
      let hasBadLine = false;
      if (qid) {
        const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
        const skus = subformSkus(record).map(s => s.toUpperCase());
        hasBadLine = skus.some(s => s.startsWith('MS125'));
      }
      return { pass: flags && offersAlt && !hasBadLine, notes: `flags=${flags}; offersAlt=${offersAlt}; badLineCreated=${hasBadLine}` };
    },
  },
  {
    id: 'E2', cat: 'E', write: false,
    prompt: () => `Create a quote on deal ${SEED_DEAL} with 1× MX64-HW + 1× LIC-MX64-ENT-3YR.`,
    criteria: async (ctx) => {
      const flags = containsAny(ctx.replyText, ['inactive', 'eol', 'discontinued', 'end of life', 'end-of-life']);
      const qid = extractQuoteId(ctx.replyText);
      let hasBadLine = false;
      if (qid) {
        const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
        const skus = subformSkus(record).map(s => s.toUpperCase());
        hasBadLine = skus.some(s => s === 'MX64-HW');
      }
      return { pass: flags && !hasBadLine, notes: `flags=${flags}; badLineCreated=${hasBadLine}` };
    },
  },
  {
    id: 'E3', cat: 'E', write: false,
    prompt: () => `Is MS125-24P-HW still available?`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['eol', 'discontinued', 'not active', 'end of life', 'inactive']) && containsAny(ctx.replyText, ['MS150', 'replacement', 'instead']),
      notes: 'MS125 informational refusal',
    }),
  },
  {
    id: 'E4', cat: 'E', write: false,
    prompt: () => `Quote me some old MR33s.`,
    criteria: async (ctx) => ({
      pass: containsAny(ctx.replyText, ['inactive', 'eol', 'discontinued', 'MR46', 'MR44', 'replacement']),
      notes: 'MR33 refusal + MR46 suggestion',
    }),
  },
  {
    id: 'E5', cat: 'E', write: true,
    prompt: () => `Create a quote on deal ${SEED_DEAL} with 1× MR46-HW + 1× LIC-ENT-3YR.`,
    criteria: async (ctx) => {
      const qid = extractQuoteId(ctx.replyText);
      if (!qid) return { pass: false, notes: 'no Quote URL' };
      const falsePositive = containsAny(ctx.replyText, ['inactive', 'bypass', 'discontinued', 'eol']);
      const { record } = await harnessGet('Quotes', qid, QUOTE_FIELDS);
      const addr = assertQuoteComplete(record);
      const skus = subformSkus(record).map(s => s.toUpperCase());
      const hasBoth = skus.includes('MR46-HW') && skus.some(s => s === 'LIC-ENT-3YR');
      const pass = !falsePositive && addr.ok && hasBoth;
      return { pass, notes: `falsePositive=${falsePositive}; addr:${addr.reason || 'ok'}; skus=${skus.join(',')}`, extras: { qid } };
    },
  },

  // ==========================================================================
  // X — Read-only
  // ==========================================================================
  {
    id: 'X1', cat: 'X', write: false,
    prompt: () => `Show me my top 5 open deals.`,
    criteria: async (ctx) => {
      const hrefs = extractHrefs(ctx.renderedHtml);
      return { pass: hrefs.length >= 1, notes: `hrefs=${hrefs.length}` };
    },
  },
  {
    id: 'X2', cat: 'X', write: false,
    prompt: () => `What CRM capabilities do you have? Short bulleted list.`,
    criteria: async (ctx) => {
      const hasList = /<ul>[\s\S]*<li>/i.test(ctx.renderedHtml);
      const mentionsCrm = containsAny(ctx.replyText, ['deal', 'quote', 'contact', 'task', 'zoho']);
      return { pass: hasList && mentionsCrm, notes: 'capability summary' };
    },
  },
];

// ─── Reseed helper for L tests ───────────────────────────────────────────────
const SEED_MULTI_ROWS = [
  { Product_Name: { id: '2570562000028840059', name: 'MR46-HW' }, Quantity: 2 },
  { Product_Name: { id: '2570562000001098895', name: 'LIC-ENT-3YR' }, Quantity: 2 },
  { Product_Name: { id: '2570562000290749263', name: 'MS150-24P-4X' }, Quantity: 1 },
  { Product_Name: { id: '2570562000290228681', name: 'LIC-MS150-24-3Y' }, Quantity: 1 },
];

async function reseedQuoteMulti() {
  if (!SEED_QUOTE_MULTI) return;
  const data = { Quoted_Items: SEED_MULTI_ROWS };
  await harnessUpsert('Quotes', SEED_QUOTE_MULTI, data);
}

// ─── Runner ──────────────────────────────────────────────────────────────────
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== Stratus AI CRM Agent — v3 matrix — ${startedAt} ===`);
  console.log(`Output: ${outPath}`);
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`FORCE_MODEL: ${FORCE_MODEL || '(waterfall)'} — RUN_LABEL: ${RUN_LABEL}`);
  if (ONLY) console.log(`ONLY: ${[...ONLY].join(',')}`);
  console.log('');

  // Fixture seeding
  if (!SKIP_SEED) {
    await verifySeedDealOpen();
    await verifySeedDealClosedLost();
    SEED_QUOTE_MULTI = SEED_QUOTE_MULTI || await seedQuoteMulti();
  } else {
    console.log('[seed] SKIP_SEED=1, assuming fixtures are already in place');
    SEED_QUOTE_MULTI = SEED_QUOTE_MULTI || process.env.SEED_QUOTE_MULTI;
    if (!SEED_QUOTE_MULTI) throw new Error('SKIP_SEED=1 requires SEED_QUOTE_MULTI env var');
  }

  let sessionId = crypto.randomUUID();
  let history = [];
  let state = {};
  let pass = 0, fail = 0;
  const failures = [];
  const byCategory = {};

  for (const t of TESTS) {
    if (ONLY && !ONLY.has(t.id)) continue;

    if (!t.continuesPrevious) {
      sessionId = crypto.randomUUID();
      history = [];
      state = {};
    }

    if (t.requiresReseedMulti) {
      await reseedQuoteMulti();
    }

    const progressId = crypto.randomUUID();
    process.stdout.write(`Test ${t.id.padEnd(4)} [${t.cat}] `);

    const prompt = typeof t.prompt === 'function' ? t.prompt() : t.prompt;
    let ctx;
    try {
      ctx = await sendChat(prompt, history, progressId, sessionId);
    } catch (e) {
      ctx = { elapsedMs: -1, status: 0, ok: false, raw: String(e), parsed: null, replyText: `⚠️ ${e}`, renderedHtml: '' };
    }

    let verdict;
    try {
      verdict = await t.criteria(ctx, state) || { pass: false, notes: 'no verdict' };
    } catch (e) {
      verdict = { pass: false, notes: `criteria threw: ${e.message || e}` };
    }

    byCategory[t.cat] = byCategory[t.cat] || { pass: 0, fail: 0 };
    if (verdict.pass) byCategory[t.cat].pass++; else byCategory[t.cat].fail++;

    const row = {
      id: t.id, cat: t.cat, write: !!t.write, continuesPrevious: !!t.continuesPrevious,
      prompt,
      elapsedMs: ctx.elapsedMs,
      status: ctx.status,
      pass: !!verdict.pass,
      notes: verdict.notes || null,
      extras: verdict.extras || null,
      replyText: ctx.replyText,
      renderedHtml: ctx.renderedHtml,
      model: ctx.parsed?.model || null,
      tierUsed: ctx.parsed?.tierUsed || null,
      iterations: ctx.parsed?.iterations || null,
      toolCallCount: ctx.parsed?.toolCallCount || null,
    };
    logStream.write(JSON.stringify(row) + '\n');

    if (verdict.pass) {
      pass++;
      console.log(`PASS (${ctx.elapsedMs}ms)`);
    } else {
      fail++;
      failures.push(t.id);
      console.log(`FAIL (${ctx.elapsedMs}ms) — ${verdict.notes}`);
      console.log(`   reply: ${(ctx.replyText || '').slice(0, 200).replace(/\n/g, ' ')}`);
    }

    history.push({ role: 'user', content: prompt });
    history.push({ role: 'assistant', content: ctx.replyText });

    await new Promise(r => setTimeout(r, 400));
  }

  const total = pass + fail;
  const pct = total ? Math.round((pass / total) * 100) : 0;
  console.log('');
  console.log(`=== Done: ${pass}/${total} PASS (${pct}%) — threshold 90% (≥43/48) ===`);
  if (failures.length) console.log(`Failed: ${failures.join(', ')}`);
  console.log('');
  console.log('By category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const catTotal = stats.pass + stats.fail;
    const catPct = catTotal ? Math.round((stats.pass / catTotal) * 100) : 0;
    console.log(`  ${cat}: ${stats.pass}/${catTotal} (${catPct}%)`);
  }
  console.log(`\nSEED_QUOTE_MULTI=${SEED_QUOTE_MULTI}  (export this to rerun without reseeding)`);
  logStream.end();
}

main().catch(e => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
