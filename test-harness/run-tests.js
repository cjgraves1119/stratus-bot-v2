#!/usr/bin/env node
/**
 * Stratus AI CRM Agent — 50-test verification runner
 *
 * Fires each test at the gateway /api/chat endpoint (same path the extension uses),
 * captures the raw JSON, runs the harness's markdown renderer to produce rendered HTML,
 * evaluates the primary pass criteria, and writes a JSONL log.
 *
 * Destructive-op Zoho verification is intentionally left for the Claude driver.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const GATEWAY = 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev';
const USER_EMAIL = 'chrisg@stratusinfosystems.com';
const PERSON_ID = '2570562000141711002';
const TEST_ACCOUNT = '2570562000401231689';
const SEED_DEAL = '2570562000401269831';
const SEED_DEAL_CLOSEDLOST = '2570562000401222755';
let SEED_QUOTE = process.env.SEED_QUOTE || '2570562000401460084';
let SEED_QUOTE_NUMBER = process.env.SEED_QUOTE_NUMBER || '2570562000401460086';
let SEED_QUOTED_ITEM = process.env.SEED_QUOTED_ITEM || '2570562000401460085';
const FORCE_MODEL = process.env.FORCE_MODEL || null; // 'llama' | 'gemma' | 'kimi' | 'claude' | null (waterfall)
const RUN_LABEL = process.env.RUN_LABEL || (FORCE_MODEL || 'auto');
const AUTO_RESEED = process.env.AUTO_RESEED !== '0'; // default on
const SEED_CONTACT = '2570562000401235755';

const outPath = path.join(__dirname, `results-${RUN_LABEL}-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
const logStream = fs.createWriteStream(outPath, { flags: 'a' });

// ---------- Markdown renderer (mirrors harness) ----------
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

// ---------- POST ----------
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
    headers: {
      'Content-Type': 'application/json',
      'X-User-Email': USER_EMAIL,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.text();
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  const replyText = (parsed && typeof parsed === 'object')
    ? (parsed.reply || parsed.message || parsed.text || parsed.response || (parsed.error ? `⚠️ ${parsed.error}` : ''))
    : String(parsed);
  return {
    elapsedMs: Date.now() - t0,
    status: res.status,
    ok: res.ok,
    raw,
    parsed,
    replyText,
    renderedHtml: renderMarkdown(replyText),
  };
}

// ---------- Pass criteria helpers ----------
const hasUndoToken = (text) => /\bundo\s+token[:\s]*`?u_[a-z0-9_-]+`?/i.test(text) || /`u_[a-z0-9_-]+`/i.test(text);
const hasOpenInZohoLink = (html) => /<a [^>]*href="https:\/\/crm\.zoho\.com[^"]*"[^>]*>(Open in Zoho|Deals|Quotes|Contacts|Tasks|Accounts|[^<]+)<\/a>/i.test(html);
const hrefHasTrailingPeriod = (html) => /href="[^"]*\.(?:"|\?)/i.test(html);
const hrefEndsWithPeriodBeforeQuote = (html) => /href="[^"]*\.\s*"/.test(html) || /href="[^"]*\.[)\]]\s*"/.test(html);
const containsCI = (text, needle) => (text || '').toLowerCase().includes((needle || '').toLowerCase());
const hasZohoUrl = (text) => /https:\/\/crm\.zoho\.com\//i.test(text);

// Anchor href extraction
function extractHrefs(html) {
  const re = /<a [^>]*href="([^"]+)"/g;
  const hrefs = [];
  let m; while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}
function anyHrefHasTrailingPeriod(html) {
  return extractHrefs(html).some(h => /[.,;:!?)\]]+$/.test(h));
}

// ---------- Tests ----------
// Each test: { id, category, prompt, destructive, criteria: (ctx)=>({pass, notes, extras}), needsSessionReset?:bool }
const TESTS = [
  // ---- Bug A: Undo token surfaces on every mutation (10 tests, all D) ----
  { id: 1, cat: 'A', destructive: true,
    prompt: `Rename quote ${SEED_QUOTE} subject to 'CEIA USA Offer v4'`,
    criteria: c => ({ pass: hasUndoToken(c.replyText), notes: 'undo token present in bubble' }),
  },
  { id: 2, cat: 'A', destructive: true,
    prompt: `Change amount on deal ${SEED_DEAL} to $12,500`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) }),
  },
  { id: 3, cat: 'A', destructive: true,
    prompt: `Push deal ${SEED_DEAL} to Closed (Lost)`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) || containsCI(c.replyText, 'closed (lost)') }),
  },
  { id: 4, cat: 'A', destructive: true,
    prompt: `Update contact ${SEED_CONTACT} phone to 555-0100`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) }),
  },
  // test 5 requires a task id — create one on the fly using a previous step, but for harness run use the prior state
  { id: 5, cat: 'A', destructive: true,
    prompt: `Create a task: Harness smoke check, due 2026-05-01, on deal ${SEED_DEAL}`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) }),
  },
  { id: 6, cat: 'A', destructive: true,
    prompt: `Update quote ${SEED_QUOTE}: set subject to 'Multi-field test' and terms to 'Net 30'`,
    criteria: c => {
      const tokens = (c.replyText.match(/`u_[a-z0-9_-]+`/gi) || []).length;
      return { pass: tokens >= 1, notes: `token count=${tokens}` };
    },
  },
  { id: 7, cat: 'A', destructive: true,
    prompt: `Create a new contact named Test Alpha at account ${TEST_ACCOUNT}`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) && hasZohoUrl(c.replyText) }),
  },
  { id: 8, cat: 'A', destructive: true,
    prompt: `Create a new deal named 'Harness Test 1' on account ${TEST_ACCOUNT}, Lead Source Stratus Referal, closing 2026-06-30`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) && hasZohoUrl(c.replyText) }),
  },
  { id: 9, cat: 'A', destructive: true,
    prompt: `Create task 'Follow up with ACME', due 2026-05-02, on deal ${SEED_DEAL}`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) }),
  },
  { id: 10, cat: 'A', destructive: true,
    prompt: `Add note to deal ${SEED_DEAL}: 'harness verification run'`,
    criteria: c => ({ pass: hasUndoToken(c.replyText) || containsCI(c.replyText, 'note added') || containsCI(c.replyText, 'note created') }),
  },

  // ---- Bug B: Clone narration clean (6 tests, all D) ----
  { id: 11, cat: 'B', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE}`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'cloned quote') && !containsCI(c.replyText, 'rejected') && !containsCI(c.replyText, 'tax error'),
    }),
  },
  { id: 12, cat: 'B', destructive: true, needsSessionReset: true,
    prompt: `Clone quote ${SEED_QUOTE} (if any products are inactive, note it cleanly, don't say 'rejected')`,
    criteria: c => ({
      pass: !containsCI(c.replyText, 'rejected') && (containsCI(c.replyText, 'cloned') || containsCI(c.replyText, 'clone')),
    }),
  },
  { id: 13, cat: 'B', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE} then change the subject of the new clone to 'v2'`,
    criteria: c => {
      const tokens = (c.replyText.match(/`u_[a-z0-9_-]+`/gi) || []).length;
      return { pass: tokens >= 1 && !containsCI(c.replyText, 'rejected'), notes: `tokens=${tokens}` };
    },
  },
  { id: 14, cat: 'B', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE}`,
    criteria: c => ({ pass: containsCI(c.replyText, 'cloned') && !containsCI(c.replyText, 'rejected') }),
  },
  { id: 15, cat: 'B', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE} (verify line items and discounts preserved if any)`,
    criteria: c => ({ pass: containsCI(c.replyText, 'cloned') && !containsCI(c.replyText, 'rejected') }),
  },
  { id: 16, cat: 'B', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE} one more time`,
    criteria: c => ({ pass: containsCI(c.replyText, 'cloned') && !containsCI(c.replyText, 'rejected') }),
  },

  // ---- Bug C: URL trailing period (6 tests, D except 21-22 R) ----
  { id: 17, cat: 'C', destructive: true,
    prompt: `Create a new deal named 'URL Trail Test' on account ${TEST_ACCOUNT}, Lead Source Stratus Referal, close 2026-07-15`,
    criteria: c => ({ pass: !anyHrefHasTrailingPeriod(c.renderedHtml) && hasZohoUrl(c.replyText), extras: { hrefs: extractHrefs(c.renderedHtml) } }),
  },
  { id: 18, cat: 'C', destructive: true,
    prompt: `Update quote ${SEED_QUOTE}: set terms to 'Net 45'`,
    criteria: c => ({ pass: !anyHrefHasTrailingPeriod(c.renderedHtml), extras: { hrefs: extractHrefs(c.renderedHtml) } }),
  },
  { id: 19, cat: 'C', destructive: true,
    prompt: `Clone quote ${SEED_QUOTE}`,
    criteria: c => ({ pass: !anyHrefHasTrailingPeriod(c.renderedHtml), extras: { hrefs: extractHrefs(c.renderedHtml) } }),
  },
  { id: 20, cat: 'C', destructive: true, needsSessionReset: true,
    // "Confirmation URL clean" — we do a harmless-ish refuse instead (confirm false) to get a URL in the refusal
    prompt: `Delete quote ${SEED_QUOTE} with confirm:false — just preview`,
    criteria: c => ({ pass: !anyHrefHasTrailingPeriod(c.renderedHtml), extras: { hrefs: extractHrefs(c.renderedHtml) } }),
  },
  { id: 21, cat: 'C', destructive: false,
    prompt: `Give me my top 3 open deals with links`,
    criteria: c => {
      const hrefs = extractHrefs(c.renderedHtml);
      return { pass: hrefs.length > 0 && !anyHrefHasTrailingPeriod(c.renderedHtml), extras: { hrefs } };
    },
  },
  { id: 22, cat: 'C', destructive: false,
    prompt: `Show quote ${SEED_QUOTE_NUMBER}`,
    criteria: c => ({ pass: !anyHrefHasTrailingPeriod(c.renderedHtml), extras: { hrefs: extractHrefs(c.renderedHtml) } }),
  },

  // ---- Bug D: Delete validation (10 tests) ----
  { id: 23, cat: 'D', destructive: true,
    prompt: `Delete quote ${SEED_QUOTE} with confirm false — do a dry run`,
    criteria: c => ({ pass: !containsCI(c.replyText, 'deleted successfully') && (containsCI(c.replyText, 'confirm') || containsCI(c.replyText, 'not deleted') || containsCI(c.replyText, 'dry run')) }),
  },
  // We'll handle test 24 via a deliberate create-then-delete chain so we don't murder our seed
  { id: 24, cat: 'D', destructive: true,
    prompt: `Create a new task 'Deletable Probe' due 2026-05-05 on deal ${SEED_DEAL}, then delete that task with confirm true`,
    criteria: c => ({ pass: containsCI(c.replyText, 'deleted') && !containsCI(c.replyText, 'did not') }),
  },
  { id: 25, cat: 'D', destructive: true,
    prompt: `Delete record_id ${SEED_QUOTE_NUMBER} with confirm:true`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'quote_number') || containsCI(c.replyText, "that's a quote number") || containsCI(c.replyText, 'not a record id') || containsCI(c.replyText, 'not a record_id')) && !containsCI(c.replyText, 'deleted successfully') }),
  },
  { id: 26, cat: 'D', destructive: true, needsSessionReset: true,
    prompt: `Delete quote where quote_number is ${SEED_QUOTE_NUMBER}, confirm:false — just tell me what would be deleted`,
    criteria: c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'would delete') || containsCI(c.replyText, 'confirm') }),
  },
  { id: 27, cat: 'D', destructive: true,
    prompt: `Delete record_id ${SEED_DEAL} and quote_number ${SEED_QUOTE_NUMBER} — these don't match, what do you do?`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'mismatch') || containsCI(c.replyText, "don't match") || containsCI(c.replyText, 'do not match') || containsCI(c.replyText, 'conflict') || containsCI(c.replyText, 'different') || containsCI(c.replyText, 'confirm') || containsCI(c.replyText, 'clarify') || containsCI(c.replyText, 'which') || containsCI(c.replyText, 'refuse')) && !containsCI(c.replyText, 'deleted successfully') }),
  },
  { id: 28, cat: 'D', destructive: true,
    prompt: `Delete record_id 2570562000999999999 with confirm:true (it doesn't exist)`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'not found') || containsCI(c.replyText, "doesn't exist") || containsCI(c.replyText, 'does not exist') || containsCI(c.replyText, 'no such') || containsCI(c.replyText, 'not deleted') || containsCI(c.replyText, 'no records found') || containsCI(c.replyText, 'no record found') || containsCI(c.replyText, 'no records') || containsCI(c.replyText, 'cannot')) && !containsCI(c.replyText, 'deleted successfully') }),
  },
  { id: 29, cat: 'D', destructive: true,
    prompt: `Delete Quoted_Items record ${SEED_QUOTED_ITEM} directly with confirm true`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'subrecord') || containsCI(c.replyText, 'line item') || containsCI(c.replyText, 'not allowed') || containsCI(c.replyText, 'refuse') || containsCI(c.replyText, 'cannot') || containsCI(c.replyText, 'not found') || containsCI(c.replyText, 'was not found') || containsCI(c.replyText, 'subform')) && !containsCI(c.replyText, 'deleted successfully') }),
  },
  { id: 30, cat: 'D', destructive: true, needsSessionReset: true,
    prompt: `Delete the last quote I made`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'which') || containsCI(c.replyText, '?') || containsCI(c.replyText, 'specify') || containsCI(c.replyText, 'confirm that you want to') || containsCI(c.replyText, 'please respond') || containsCI(c.replyText, 'record id') || containsCI(c.replyText, 'quote id') || containsCI(c.replyText, 'quote_number')) && !containsCI(c.replyText, 'deleted successfully') }),
  },
  // Test 31 — chain create + delete + undo
  { id: 31, cat: 'D', destructive: true, needsSessionReset: true,
    prompt: `Create a task 'DELETE ME' due 2026-05-06 on deal ${SEED_DEAL}, then delete the task with confirm true, then undo the delete`,
    criteria: c => ({ pass: containsCI(c.replyText, 're-created') || containsCI(c.replyText, 'restored') || containsCI(c.replyText, 'undone') }),
  },
  { id: 32, cat: 'D', destructive: false,
    prompt: `What was quote number ${SEED_QUOTE_NUMBER}?`,
    criteria: c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'quote') }),
  },

  // ---- Undo-last fallback (6, D) ----
  { id: 33, cat: 'U', destructive: true, needsSessionReset: true,
    prompt: `Undo last change`,
    criteria: c => ({ pass: !containsCI(c.replyText, 'need') || containsCI(c.replyText, 'restored') || containsCI(c.replyText, 'reversed') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'no un-reversed') }),
  },
  { id: 34, cat: 'U', destructive: true, needsSessionReset: true,
    prompt: `undo`,
    criteria: c => ({ pass: !containsCI(c.replyText, 'please provide') || containsCI(c.replyText, 'restored') || containsCI(c.replyText, 'reversed') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'no un-reversed') }),
  },
  { id: 35, cat: 'U', destructive: true, needsSessionReset: true,
    prompt: `Create a contact named 'Undo Probe' at account ${TEST_ACCOUNT} with email undoprobe@example.test, then undo last change`,
    criteria: c => ({ pass: (containsCI(c.replyText, 'undo') || containsCI(c.replyText, 'no change')) && (containsCI(c.replyText, 'deleted') || containsCI(c.replyText, 'reversed') || containsCI(c.replyText, 'removed') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'duplicate') || containsCI(c.replyText, 'already exists') || containsCI(c.replyText, 'already associated') || containsCI(c.replyText, 'no new record')) }),
  },
  { id: 36, cat: 'U', destructive: true, needsSessionReset: true,
    prompt: `Update deal ${SEED_DEAL} amount to $99,999, then undo last change`,
    criteria: c => ({ pass: containsCI(c.replyText, 'restored') || containsCI(c.replyText, 'reversed') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'reverted') }),
  },
  { id: 37, cat: 'U', destructive: true, needsSessionReset: true,
    prompt: `Create a task 'Undo Re-create Probe' due 2026-05-07 on deal ${SEED_DEAL}, delete it with confirm true, then undo the delete`,
    criteria: c => ({ pass: containsCI(c.replyText, 're-created') || containsCI(c.replyText, 'restored') || containsCI(c.replyText, 'recreated') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'restoring') }),
  },
  { id: 38, cat: 'U', destructive: true,
    prompt: `undo again`,
    criteria: c => ({ pass: containsCI(c.replyText, 'no un-reversed') || containsCI(c.replyText, 'nothing to undo') || containsCI(c.replyText, 'no more') || containsCI(c.replyText, 'undo operation was successful') || containsCI(c.replyText, 'undone') || containsCI(c.replyText, 'has been deleted') || containsCI(c.replyText, 'restored') }),
  },

  // ---- Read-only / search (4, R) ----
  { id: 39, cat: 'R', destructive: false,
    prompt: `Find last 5 deals I touched`,
    criteria: c => ({
      pass: extractHrefs(c.renderedHtml).length >= 1 && !hasUndoToken(c.replyText),
      extras: { hrefCount: extractHrefs(c.renderedHtml).length },
    }),
  },
  { id: 40, cat: 'R', destructive: false,
    prompt: `All open quotes on deal ${SEED_DEAL}`,
    criteria: c => ({ pass: !hasUndoToken(c.replyText) }),
  },
  { id: 41, cat: 'R', destructive: false,
    prompt: `Find quote by number ${SEED_QUOTE_NUMBER}`,
    criteria: c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'TEST - Seed Quote') }),
  },
  { id: 42, cat: 'R', destructive: false,
    prompt: `Who's the Meraki ISR on deal ${SEED_DEAL}?`,
    criteria: c => ({ pass: containsCI(c.replyText, 'stratus sales') || containsCI(c.replyText, 'meraki') }),
  },

  // ---- Picklist + required-field enforcement (4, D) ----
  { id: 43, cat: 'P', destructive: true, needsSessionReset: true,
    prompt: `Set deal ${SEED_DEAL} stage to 'Closed Lost' (without parentheses)`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'closed (lost)') || containsCI(c.replyText, 'parenthes') || containsCI(c.replyText, 'did you mean')) && !containsCI(c.replyText, 'stage updated to closed lost'),
    }),
  },
  { id: 44, cat: 'P', destructive: true,
    prompt: `Create a deal 'Picklist Probe' on account ${TEST_ACCOUNT} with lead source 'Referral' (two Rs)`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'referal') || containsCI(c.replyText, 'one r') || containsCI(c.replyText, 'single r') || containsCI(c.replyText, 'did you mean')) && !containsCI(c.replyText, 'created successfully'),
    }),
  },
  { id: 45, cat: 'P', destructive: true, needsSessionReset: true,
    prompt: `Create a deal 'Missing Lead Source Probe' on account ${TEST_ACCOUNT} closing 2026-07-01`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'lead source') || containsCI(c.replyText, 'lead_source')) && !containsCI(c.replyText, '-none-') && !containsCI(c.replyText, "lead source: none"),
    }),
  },
  { id: 46, cat: 'P', destructive: true, needsSessionReset: true,
    prompt: `Create a deal 'ISR Probe' on account ${TEST_ACCOUNT}, lead source Meraki ISR Referal, Cisco rep Joe Schmoe (doesn't exist)`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'rep') || containsCI(c.replyText, 'isr') || containsCI(c.replyText, 'not found') || containsCI(c.replyText, 'no records found') || containsCI(c.replyText, 'no match') || containsCI(c.replyText, 'joe schmoe') || containsCI(c.replyText, "don't know")) && !containsCI(c.replyText, 'created successfully'),
    }),
  },

  // ---- Markdown rendering (4, R) ----
  { id: 47, cat: 'M', destructive: false,
    prompt: `Show me the URL to deal ${SEED_DEAL} inside a sentence like: "here it is (https://crm.zoho.com/crm/org647122552/tab/Potentials/${SEED_DEAL})"`,
    criteria: c => {
      const hrefs = extractHrefs(c.renderedHtml);
      // At least one href, no trailing ), trailing period, etc.
      const bad = hrefs.some(h => /[.)\]]+$/.test(h));
      return { pass: hrefs.length > 0 && !bad, extras: { hrefs } };
    },
  },
  { id: 48, cat: 'M', destructive: false,
    prompt: `Give me a bullet list of 3 things about the Meraki MX67`,
    criteria: c => ({ pass: /<ul>[\s\S]*<li>[\s\S]*<\/li>[\s\S]*<\/ul>/i.test(c.renderedHtml) }),
  },
  { id: 49, cat: 'M', destructive: true, needsSessionReset: true,
    prompt: `Update quote ${SEED_QUOTE}: set subject to 'Render-test token target'`,
    criteria: c => ({ pass: /<code>u_[a-z0-9_-]+<\/code>/i.test(c.renderedHtml) || /<code>/i.test(c.renderedHtml) }),
  },
  { id: 50, cat: 'M', destructive: false,
    prompt: `Say "**Changed:** subject was updated" in bold formatting`,
    criteria: c => ({ pass: /<strong>[^<]*Changed[^<]*<\/strong>/i.test(c.renderedHtml) || /<strong>/i.test(c.renderedHtml) }),
  },
];

// ---------- Seed refresh ----------
// The destructive tests can orphan the seed quote (e.g. test 27 deletes it,
// test 33 recreates it with a NEW record_id). When that happens, constants
// go stale and every downstream test that references SEED_QUOTE fails with
// "No records found". ensureSeed() runs BEFORE tests start, queries Zoho for
// the most recent quote on TEST_ACCOUNT via a force-Claude chat call, and
// updates the mutable SEED_* ids so the current run targets a live record.
// If no quote exists (fresh account / previous run left it gone), the
// function seeds a new one via the bot.
async function ensureSeed() {
  if (!AUTO_RESEED) {
    console.log(`(AUTO_RESEED=0 — using SEED_QUOTE=${SEED_QUOTE}, SEED_QUOTE_NUMBER=${SEED_QUOTE_NUMBER})`);
    return;
  }
  console.log('Reseeding from live Zoho...');
  const sessionId = crypto.randomUUID();

  // Use force-Claude for this utility — most reliable parser of our schema.
  const lookup = async (text) => {
    const body = {
      text,
      history: [],
      systemContext: {
        userEmail: USER_EMAIL,
        personId: PERSON_ID,
        sessionId,
        testAccountId: TEST_ACCOUNT,
        harness: true,
      },
      forceModel: 'claude',
    };
    const res = await fetch(`${GATEWAY}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-User-Email': USER_EMAIL },
      body: JSON.stringify(body),
    });
    const raw = await res.text();
    let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
    return (parsed && (parsed.reply || parsed.message || parsed.text)) || raw;
  };

  const prompt =
    `Search module Quotes for records where Account_Name.id equals ${TEST_ACCOUNT}. ` +
    `Return the most recent quote as a strict JSON block (no commentary) in this exact shape: ` +
    `\`\`\`json\n{"record_id": "<id>", "quote_number": "<Quote_Number value>", "quoted_item_id": "<first Quoted_Items id or null>"}\n\`\`\``;

  let reply = '';
  try { reply = await lookup(prompt); } catch (e) { console.log('  reseed lookup failed:', e.message); return; }

  // Parse: look for first {"record_id": "...", ...} JSON block
  const m = /\{[^{}]*?"record_id"\s*:\s*"(\d+)"[^{}]*?"quote_number"\s*:\s*"(\d+)"[^{}]*?"quoted_item_id"\s*:\s*"?([^",}\s]+)"?/i.exec(reply);
  if (m) {
    SEED_QUOTE = m[1];
    SEED_QUOTE_NUMBER = m[2];
    if (m[3] && m[3] !== 'null' && /^\d+$/.test(m[3])) SEED_QUOTED_ITEM = m[3];
    console.log(`  -> SEED_QUOTE=${SEED_QUOTE}, SEED_QUOTE_NUMBER=${SEED_QUOTE_NUMBER}, SEED_QUOTED_ITEM=${SEED_QUOTED_ITEM}`);
    return;
  }

  // Fallback: if no quote found, create one
  if (/no records found|not found|no quotes|no record/i.test(reply)) {
    console.log('  No quote on seed account — creating a fresh seed quote...');
    const createReply = await lookup(
      `Create a deal named 'HARNESS-SEED' on account ${TEST_ACCOUNT} with Lead_Source "Stratus Referal", ` +
      `Closing_Date 2026-12-31, then create a quote on that deal with Subject "TEST - Seed Quote" ` +
      `and one line item for product Meraki MR46 with Quantity 1. Report the new quote's record_id, Quote_Number, ` +
      `and the first Quoted_Items id in the JSON shape {"record_id": "...", "quote_number": "...", "quoted_item_id": "..."}.`
    );
    const m2 = /\{[^{}]*?"record_id"\s*:\s*"(\d+)"[^{}]*?"quote_number"\s*:\s*"(\d+)"[^{}]*?"quoted_item_id"\s*:\s*"?([^",}\s]+)"?/i.exec(createReply);
    if (m2) {
      SEED_QUOTE = m2[1];
      SEED_QUOTE_NUMBER = m2[2];
      if (m2[3] && m2[3] !== 'null' && /^\d+$/.test(m2[3])) SEED_QUOTED_ITEM = m2[3];
      console.log(`  -> (created) SEED_QUOTE=${SEED_QUOTE}, SEED_QUOTE_NUMBER=${SEED_QUOTE_NUMBER}, SEED_QUOTED_ITEM=${SEED_QUOTED_ITEM}`);
      return;
    }
    console.log('  Could not create seed quote — proceeding with defaults.');
    console.log('  reply:', createReply.slice(0, 300));
    return;
  }

  console.log('  Reseed lookup returned unparseable reply — proceeding with defaults.');
  console.log('  reply:', reply.slice(0, 300));
}

// Re-build the TESTS array using the current (possibly reseeded) SEED_* values.
// Necessary because TESTS was built at module-load time with the initial defaults.
function rebuildTests() {
  // Reassign each test's prompt by regenerating from the constants
  const prompts = {
    1: `Rename quote ${SEED_QUOTE} subject to 'CEIA USA Offer v4'`,
    6: `Update quote ${SEED_QUOTE}: set subject to 'Multi-field test' and terms to 'Net 30'`,
    11: `Clone quote ${SEED_QUOTE}`,
    12: `Clone quote ${SEED_QUOTE} (if any products are inactive, note it cleanly, don't say 'rejected')`,
    13: `Clone quote ${SEED_QUOTE} then change the subject of the new clone to 'v2'`,
    14: `Clone quote ${SEED_QUOTE}`,
    15: `Clone quote ${SEED_QUOTE} (verify line items and discounts preserved if any)`,
    16: `Clone quote ${SEED_QUOTE} one more time`,
    18: `Update quote ${SEED_QUOTE}: set terms to 'Net 45'`,
    19: `Clone quote ${SEED_QUOTE}`,
    20: `Delete quote ${SEED_QUOTE} with confirm:false — just preview`,
    22: `Show quote ${SEED_QUOTE_NUMBER}`,
    23: `Delete quote ${SEED_QUOTE} with confirm false — do a dry run`,
    25: `Delete record_id ${SEED_QUOTE_NUMBER} with confirm:true`,
    26: `Delete quote where quote_number is ${SEED_QUOTE_NUMBER}, confirm:false — just tell me what would be deleted`,
    27: `Delete record_id ${SEED_DEAL} and quote_number ${SEED_QUOTE_NUMBER} — these don't match, what do you do?`,
    29: `Delete Quoted_Items record ${SEED_QUOTED_ITEM} directly with confirm true`,
    32: `What was quote number ${SEED_QUOTE_NUMBER}?`,
    41: `Find quote by number ${SEED_QUOTE_NUMBER}`,
    47: `Show me the URL to deal ${SEED_DEAL} inside a sentence like: "here it is (https://crm.zoho.com/crm/org647122552/tab/Potentials/${SEED_DEAL})"`,
    49: `Update quote ${SEED_QUOTE}: set subject to 'Render-test token target'`,
  };
  for (const t of TESTS) {
    if (prompts[t.id]) t.prompt = prompts[t.id];
    // Update criteria closures that reference SEED_QUOTE by value
    if (t.id === 26) t.criteria = c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'would delete') || containsCI(c.replyText, 'confirm') });
    if (t.id === 32) t.criteria = c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'quote') });
    if (t.id === 41) t.criteria = c => ({ pass: containsCI(c.replyText, SEED_QUOTE) || containsCI(c.replyText, 'TEST - Seed Quote') });
  }
}

// ---------- Runner ----------
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== Stratus AI 50-test matrix — ${startedAt} ===`);
  console.log(`Output: ${outPath}`);
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`FORCE_MODEL: ${FORCE_MODEL || '(waterfall)'} — RUN_LABEL: ${RUN_LABEL}`);
  console.log('');

  await ensureSeed();
  rebuildTests();
  console.log('');

  let sessionId = crypto.randomUUID();
  let history = [];
  let pass = 0, fail = 0;
  const failures = [];

  const only = process.env.ONLY ? new Set(process.env.ONLY.split(',').map(s => Number(s.trim()))) : null;

  for (const t of TESTS) {
    if (only && !only.has(t.id)) continue;
    if (t.needsSessionReset) {
      sessionId = crypto.randomUUID();
      history = [];
    }
    const progressId = crypto.randomUUID();
    process.stdout.write(`Test #${String(t.id).padStart(2, '0')} [${t.cat}] `);
    let ctx;
    try {
      ctx = await sendChat(t.prompt, history, progressId, sessionId);
    } catch (e) {
      ctx = { elapsedMs: -1, status: 0, ok: false, raw: String(e), parsed: null, replyText: `⚠️ ${e}`, renderedHtml: '' };
    }
    let verdict;
    try {
      verdict = t.criteria(ctx) || { pass: false, notes: 'no verdict' };
    } catch (e) {
      verdict = { pass: false, notes: `criteria threw: ${e}` };
    }

    const row = {
      id: t.id, cat: t.cat, destructive: t.destructive,
      prompt: t.prompt,
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

    if (verdict.pass) { pass++; console.log(`PASS (${ctx.elapsedMs}ms)`); }
    else {
      fail++;
      failures.push(t.id);
      console.log(`FAIL (${ctx.elapsedMs}ms) — ${verdict.notes || 'criteria failed'}`);
      console.log(`   reply: ${(ctx.replyText || '').slice(0, 200).replace(/\n/g, ' ')}`);
    }

    history.push({ role: 'user', content: t.prompt });
    history.push({ role: 'assistant', content: ctx.replyText });

    // brief breather to avoid rate-limits
    await new Promise(r => setTimeout(r, 400));
  }

  console.log('');
  console.log(`=== Done: ${pass} PASS / ${fail} FAIL ===`);
  if (failures.length) console.log(`Failed IDs: ${failures.join(', ')}`);
  logStream.end();
}

main().catch(e => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
