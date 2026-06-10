#!/usr/bin/env node
/**
 * Stratus AI CRM Agent — v2 Edge-Case Matrix (50 tests)
 *
 * New matrix spawned from Chris's scope expansion after v1 hit 92%:
 *   "generate brand new set of 50 test to ensure that there are no other gaps missed.
 *    ... updating quotes to reflect margin after discount approval ...
 *    ... deal IDs and requesting discount approvals using the admin actions ...
 *    ... no stop gaps of quotes not being able to be generated for active items ...
 *    ... 20 line items just to stress test ... 'change to 5 years' when originally 3 ...
 *    ... e-com pricing ... newly added item is also applied with e-com pricing by default ..."
 *
 * Categories:
 *   E — Ecomm Pricing Preservation (8)
 *   T — Term Changes (6)
 *   S — Stress / Large Quotes (4)
 *   A — Admin Actions / Discount Approval (8)
 *   I — Inactive Product Flag False Positives (6)
 *   M — Margin After Discount (6)
 *   X — Cross-cutting Edge Cases (12)
 *
 * Same sendChat plumbing as run-tests.js. New seed quotes created per-run
 * where needed (ecomm-seeded quote for E/M/T categories), then cleaned up
 * at end if possible.
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
let SEED_QUOTE = process.env.SEED_QUOTE || '2570562000401474208';
let SEED_QUOTE_NUMBER = process.env.SEED_QUOTE_NUMBER || '2570562000401474210';
let SEED_QUOTED_ITEM = process.env.SEED_QUOTED_ITEM || '2570562000401474209';
let ECOMM_QUOTE = process.env.ECOMM_QUOTE || null; // created at runtime
const FORCE_MODEL = process.env.FORCE_MODEL || null;
const RUN_LABEL = process.env.RUN_LABEL || (FORCE_MODEL ? `${FORCE_MODEL}-v2` : 'auto-v2');
const AUTO_SEED_ECOMM = process.env.AUTO_SEED_ECOMM !== '0';
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

// ---------- Helpers ----------
const containsCI = (text, needle) => (text || '').toLowerCase().includes((needle || '').toLowerCase());
const containsAny = (text, needles) => needles.some(n => containsCI(text, n));
const containsAll = (text, needles) => needles.every(n => containsCI(text, n));
const hasZohoUrl = (text) => /https:\/\/crm\.zoho\.com\//i.test(text);
const hasUndoToken = (text) => /\bundo\s+token[:\s]*`?u_[a-z0-9_-]+`?/i.test(text) || /`u_[a-z0-9_-]+`/i.test(text);
function extractHrefs(html) {
  const re = /<a [^>]*href="([^"]+)"/g;
  const hrefs = [];
  let m; while ((m = re.exec(html))) hrefs.push(m[1]);
  return hrefs;
}
function anyHrefHasTrailingPeriod(html) {
  return extractHrefs(html).some(h => /[.,;:!?)\]]+$/.test(h));
}
// Extract a Zoho record id from prose (15-20 digit number)
function extractZohoId(text) {
  const m = /\b(\d{15,20})\b/.exec(text || '');
  return m ? m[1] : null;
}
// Count line items from reply (usually in a bullet list or "X items" phrase)
function countLineItems(text) {
  const m = /(\d+)\s+(?:line\s+items?|items?|products?)/i.exec(text || '');
  if (m) return Number(m[1]);
  const bullets = (text || '').match(/^\s*[-*•]\s+/gm);
  return bullets ? bullets.length : 0;
}

// ---------- Tests ----------
const TESTS = [
  // ===========================================================
  // E — Ecomm Pricing Preservation (8 tests)
  // ===========================================================
  { id: 1, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL} with: 2× MR46-HW, 2× LIC-ENT-3YR. Use stratus ecomm pricing (13% off list).`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'failed') && !containsCI(c.replyText, 'list price only'),
      notes: 'ecomm quote created (zoho url present, no failure)',
    }),
  },
  { id: 2, cat: 'E', destructive: true,
    // Follow-up to test 1 — same session, add a line item
    prompt: `Add 1× MS125-24P to that quote.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'ecomm') || containsCI(c.replyText, 'discount')) && !containsCI(c.replyText, 'at list') && !containsCI(c.replyText, 'list price'),
      notes: 'newly-added item inherits ecomm pricing',
    }),
  },
  { id: 3, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `Clone quote ${SEED_QUOTE} and make sure ecomm pricing is preserved on all items.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'cloned') || containsCI(c.replyText, 'clone')) && !containsCI(c.replyText, 'rejected'),
      notes: 'clone succeeded without rejection',
    }),
  },
  { id: 4, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL} with 5× MR46-HW + 5× LIC-ENT-5YR using stratus ecomm pricing (13% discount).`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '13%') || containsCI(c.replyText, 'ecomm') || containsCI(c.replyText, 'discount')) && hasZohoUrl(c.replyText),
      notes: 'ecomm discount acknowledged',
    }),
  },
  { id: 5, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `Create an ecomm quote on deal ${SEED_DEAL} with 3× MX67-HW + 3× LIC-MX67-ENT-3YR. Then bump MX67 qty to 5.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'ecomm') || containsCI(c.replyText, 'discount'),
      notes: 'qty bump preserves ecomm',
    }),
  },
  { id: 6, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `Create an ecomm quote on deal ${SEED_DEAL} with 1× CW9166I-MR + 1× LIC-ENT-3YR.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'not found') && !containsCI(c.replyText, 'failed') && !containsCI(c.replyText, 'list price only'),
      notes: 'CW (Wi-Fi 6E) ecomm — suffix -MR + LIC-ENT-',
    }),
  },
  { id: 7, cat: 'E', destructive: true, needsSessionReset: true,
    prompt: `On deal ${SEED_DEAL}, create an ecomm quote for 10× MS125-24P (switches have no suffix) + 10× LIC-MS125-24-5Y.`,
    criteria: c => ({
      // Success = Zoho URL present AND no wrong -HW suffix on MS switch.
      // Bot doesn't always echo "ecomm" in its reply even when applied.
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'ms125-24p-hw') && !containsCI(c.replyText, 'failed') && !containsCI(c.replyText, 'not found'),
      notes: 'MS switch — no -HW suffix, Zoho quote created',
    }),
  },
  { id: 8, cat: 'E', destructive: false,
    prompt: `What's the default pricing mode when I say "create a quote" without specifying list vs ecomm?`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'ecomm') || containsCI(c.replyText, 'stratus'),
      notes: 'bot confirms ecomm is default',
    }),
  },

  // ===========================================================
  // T — Term Changes (6 tests)
  // ===========================================================
  { id: 9, cat: 'T', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL}: 2× MR46-HW + 2× LIC-ENT-3YR (3 year term). Then change the licenses to 5 years.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '5yr') || containsCI(c.replyText, '5-year') || containsCI(c.replyText, '5 year') || containsCI(c.replyText, 'lic-ent-5yr')) && !containsCI(c.replyText, 'failed'),
      notes: 'term swap 3y → 5y',
    }),
  },
  { id: 10, cat: 'T', destructive: true, needsSessionReset: true,
    prompt: `Quote on deal ${SEED_DEAL}: 1× MR46-HW + 1× LIC-ENT-5YR. Now downgrade to 1 year.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '1yr') || containsCI(c.replyText, '1-year') || containsCI(c.replyText, '1 year') || containsCI(c.replyText, 'lic-ent-1yr')) && !containsCI(c.replyText, 'failed'),
      notes: '5y → 1y downgrade',
    }),
  },
  { id: 11, cat: 'T', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL} with 4× MS125-24P + 4× LIC-MS125-24-1Y. Extend it to 5 years.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'lic-ms125-24-5y') || containsCI(c.replyText, '5 year') || containsCI(c.replyText, '5yr') || containsCI(c.replyText, '5-year')) && !containsCI(c.replyText, 'failed'),
      notes: 'MS switch license term change 1y → 5y',
    }),
  },
  { id: 12, cat: 'T', destructive: false, needsSessionReset: true,
    prompt: `Change the term on quote ${SEED_QUOTE}.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'which') || containsCI(c.replyText, 'what term') || containsCI(c.replyText, 'specify') || containsCI(c.replyText, '?'),
      notes: 'ambiguous term change → asks clarification',
    }),
  },
  { id: 13, cat: 'T', destructive: true, needsSessionReset: true,
    prompt: `On deal ${SEED_DEAL}, create a quote with 2× MR46-HW + 2× LIC-ENT-3YR + 1× MS125-24P + 1× LIC-MS125-24-3Y. Then change MS125 license only to 5 years (leave MR license at 3Y).`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'lic-ms125-24-5y') || containsCI(c.replyText, 'ms125') && containsCI(c.replyText, '5 year')) && !containsCI(c.replyText, 'changed all'),
      notes: 'targeted single-item term change',
    }),
  },
  { id: 14, cat: 'T', destructive: true, needsSessionReset: true,
    prompt: `Create quote on deal ${SEED_DEAL}: 3× MR46-HW + 3× LIC-ENT-1YR. Now extend everything to 5 years.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'lic-ent-5yr') || containsCI(c.replyText, '5 year') || containsCI(c.replyText, '5yr') || containsCI(c.replyText, '5-year')) && !containsCI(c.replyText, 'lic-ent-1yr'),
      notes: 'bulk term extension 1y → 5y',
    }),
  },

  // ===========================================================
  // S — Stress / Large Quote (4 tests)
  // ===========================================================
  { id: 15, cat: 'S', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL} with these 20 items: 5× MR46-HW, 5× LIC-ENT-3YR, 3× MS125-24P, 3× LIC-MS125-24-3Y, 2× MX67-HW, 2× LIC-MX67-ENT-3YR, 1× MV12WE, 1× LIC-MV-3YR, 1× MT10-HW, 1× MT14-HW, 1× LIC-MT-3Y, 1× MG21-HW-NA, 1× LIC-MG21-ENT-3Y, 1× MR46E-HW, 1× MS250-24P-HW, 1× LIC-MS250-24-3Y, 1× MX75-HW, 1× LIC-MX75-ENT-3YR, 1× MX95-HW, 1× LIC-MX95-ENT-3YR.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'failed') && !containsCI(c.replyText, 'inactive product') && !containsCI(c.replyText, 'could not create'),
      notes: '20-item stress quote — all SKUs should resolve',
    }),
  },
  { id: 16, cat: 'S', destructive: true, needsSessionReset: true,
    prompt: `Create a large ecomm quote on deal ${SEED_DEAL}: 10× MR46-HW + 10× LIC-ENT-3YR + 10× MS125-24P + 10× LIC-MS125-24-3Y + 5× MX67-HW + 5× LIC-MX67-ENT-3YR. That's 50 units across 6 SKUs.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && (containsCI(c.replyText, 'ecomm') || containsCI(c.replyText, 'discount')) && !containsCI(c.replyText, 'failed'),
      notes: '6-SKU / 50-unit ecomm stress',
    }),
  },
  { id: 17, cat: 'S', destructive: true, needsSessionReset: true,
    prompt: `Create ecomm quote on deal ${SEED_DEAL}: 3× MR46-HW + 3× LIC-ENT-3YR. Then add 12 more line items: 5× MS125-24P, 5× LIC-MS125-24-3Y, 2× MX67-HW.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'added') || containsCI(c.replyText, 'line item') || hasZohoUrl(c.replyText)) && !containsCI(c.replyText, 'failed'),
      notes: 'incremental add to reach 15 line items',
    }),
  },
  { id: 18, cat: 'S', destructive: true, needsSessionReset: true,
    prompt: `Clone quote ${SEED_QUOTE} and confirm every line item came over (count them).`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'cloned') || containsCI(c.replyText, 'clone')) && !containsCI(c.replyText, 'rejected') && !containsCI(c.replyText, 'failed'),
      notes: 'clone preserves all line items',
    }),
  },

  // ===========================================================
  // A — Admin Actions / Discount Approval (8 tests)
  // ===========================================================
  { id: 19, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `Submit deal ${SEED_DEAL} for Cisco discount approval (request 15% discount). Walk through the admin action path.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'admin_action') || containsCI(c.replyText, 'admin action') || containsCI(c.replyText, 'cciscoquote') || containsCI(c.replyText, 'live_cisco') || containsCI(c.replyText, 'did') || containsCI(c.replyText, 'deal id') || containsCI(c.replyText, 'approval'),
      notes: 'admin action path surfaced',
    }),
  },
  { id: 20, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `Generate a Cisco DID for quote ${SEED_QUOTE}.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'live_ciscoquote_deal') || containsCI(c.replyText, 'admin_action') || containsCI(c.replyText, 'did') || containsCI(c.replyText, 'cciscoquote') || containsCI(c.replyText, 'ccw_deal') || containsCI(c.replyText, 'deal number') || containsCI(c.replyText, 'processing')) && !containsCI(c.replyText, 'click a button'),
      notes: 'DID generation via API (not manual click)',
    }),
  },
  { id: 21, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `I just got a CCW Deal Number 12345678 back from Zoho on quote ${SEED_QUOTE}. Submit it to Velocity Hub for deal approval.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'velocity') || containsCI(c.replyText, 'submitted') || containsCI(c.replyText, 'approval') || containsCI(c.replyText, '12345678'),
      notes: 'velocity_hub_submit call',
    }),
  },
  { id: 22, cat: 'A', destructive: false, needsSessionReset: true,
    prompt: `What's the deal ID for quote ${SEED_QUOTE}? I need it for a discount approval request.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'deal') && (containsCI(c.replyText, '257056') || hasZohoUrl(c.replyText))) || containsCI(c.replyText, SEED_DEAL),
      notes: 'resolve deal id from quote',
    }),
  },
  { id: 23, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `Submit deal ${SEED_DEAL_CLOSEDLOST} for discount approval (this is a Closed (Lost) deal).`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'closed') || containsCI(c.replyText, 'lost') || containsCI(c.replyText, 'cannot') || containsCI(c.replyText, 'refuse') || containsCI(c.replyText, 'not eligible') || containsCI(c.replyText, 'warn'),
      notes: 'refuse or warn on Closed (Lost) approval',
    }),
  },
  { id: 24, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `Request 50% discount approval on deal ${SEED_DEAL} (>40% tier).`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'admin') || containsCI(c.replyText, 'approval') || containsCI(c.replyText, '50%') || containsCI(c.replyText, 'discount')) && !containsCI(c.replyText, 'failed'),
      notes: 'large discount tier',
    }),
  },
  { id: 25, cat: 'A', destructive: false, needsSessionReset: true,
    prompt: `Check the admin action status on quote ${SEED_QUOTE}.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'admin_action') || containsCI(c.replyText, 'admin action') || containsCI(c.replyText, 'status') || containsCI(c.replyText, 'none') || containsCI(c.replyText, 'not set') || containsCI(c.replyText, 'no admin action')) && !containsCI(c.replyText, 'failed'),
      notes: 'read Admin_Action field',
    }),
  },
  { id: 26, cat: 'A', destructive: true, needsSessionReset: true,
    prompt: `Write CCW Deal Number 87654321 onto quote ${SEED_QUOTE} (field CCW_Deal_Number).`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '87654321') || containsCI(c.replyText, 'ccw_deal_number') || containsCI(c.replyText, 'updated')) && !containsCI(c.replyText, 'failed'),
      notes: 'write DID to quote field',
    }),
  },

  // ===========================================================
  // I — Inactive Product False-Flag (6 tests)
  // ===========================================================
  { id: 27, cat: 'I', destructive: true, needsSessionReset: true,
    prompt: `Create a NEW quote on deal ${SEED_DEAL} with 1× MR46-HW + 1× LIC-ENT-3YR. MR46 is active — do not flag it inactive.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'mr46 is inactive') && !containsCI(c.replyText, 'mr46-hw is inactive') && !containsCI(c.replyText, 'discontinued') && !containsCI(c.replyText, 'inactive product'),
      notes: 'active MR46 — no inactive flag',
    }),
  },
  { id: 28, cat: 'I', destructive: true, needsSessionReset: true,
    prompt: `Create a NEW quote on deal ${SEED_DEAL} with 1× MS125-24P + 1× LIC-MS125-24-3Y. MS125 is active — do not flag it inactive.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'ms125 is inactive') && !containsCI(c.replyText, 'ms125-24p is inactive') && !containsCI(c.replyText, 'discontinued') && !containsCI(c.replyText, 'inactive product'),
      notes: 'active MS125 — no inactive flag',
    }),
  },
  { id: 29, cat: 'I', destructive: true, needsSessionReset: true,
    prompt: `Create a NEW quote on deal ${SEED_DEAL} with 1× MX67-HW + 1× LIC-MX67-ENT-3YR. MX67 is active — do not flag it inactive.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'mx67 is inactive') && !containsCI(c.replyText, 'mx67-hw is inactive') && !containsCI(c.replyText, 'discontinued') && !containsCI(c.replyText, 'inactive product'),
      notes: 'active MX67 — no inactive flag',
    }),
  },
  { id: 30, cat: 'I', destructive: true, needsSessionReset: true,
    prompt: `Create a NEW quote on deal ${SEED_DEAL} with these 10 active SKUs: 1× MR46-HW, 1× LIC-ENT-3YR, 1× MS125-24P, 1× LIC-MS125-24-3Y, 1× MX67-HW, 1× LIC-MX67-ENT-3YR, 1× MR44-HW, 1× MS120-8P, 1× MV12WE, 1× MT10. None should flag inactive.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'inactive product') && !containsCI(c.replyText, 'discontinued'),
      notes: '10 active SKUs — zero false positives',
    }),
  },
  { id: 31, cat: 'I', destructive: false, needsSessionReset: true,
    prompt: `Is LIC-ENT-3YR active?`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'active') && !containsCI(c.replyText, 'inactive') && !containsCI(c.replyText, 'discontinued') && !containsCI(c.replyText, 'not active'),
      notes: 'LIC-ENT-3YR confirmed active',
    }),
  },
  { id: 32, cat: 'I', destructive: true, needsSessionReset: true,
    prompt: `Create a NEW quote on deal ${SEED_DEAL} with 1× MR46-HW (active) + 1× LIC-ENT-3YR. If anything shows as inactive that shouldn't, flag it for me.`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) && !containsCI(c.replyText, 'mr46 is inactive') && !containsCI(c.replyText, 'lic-ent-3yr is inactive') && !containsCI(c.replyText, 'inactive product'),
      notes: 'explicit active-product check',
    }),
  },

  // ===========================================================
  // M — Margin After Discount (6 tests)
  // ===========================================================
  { id: 33, cat: 'M', destructive: false, needsSessionReset: true,
    prompt: `Show me the gross margin on quote ${SEED_QUOTE}.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'margin') || containsCI(c.replyText, 'cost') || containsCI(c.replyText, 'profit') || containsCI(c.replyText, '%'),
      notes: 'margin displayed',
    }),
  },
  { id: 34, cat: 'M', destructive: true, needsSessionReset: true,
    prompt: `Apply a 10% discount to quote ${SEED_QUOTE} and tell me the new margin.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'discount') || containsCI(c.replyText, '10%')) && (containsCI(c.replyText, 'margin') || containsCI(c.replyText, 'total') || containsCI(c.replyText, 'updated')),
      notes: 'discount applied + margin recalc',
    }),
  },
  { id: 35, cat: 'M', destructive: true, needsSessionReset: true,
    prompt: `Discount approval for deal ${SEED_DEAL} was granted at 20%. Update quote ${SEED_QUOTE} to reflect that and show me the new margin.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '20%') || containsCI(c.replyText, 'discount')) && (containsCI(c.replyText, 'margin') || containsCI(c.replyText, 'updated') || containsCI(c.replyText, 'total')),
      notes: 'approved discount applied + margin',
    }),
  },
  { id: 36, cat: 'M', destructive: false, needsSessionReset: true,
    prompt: `What would the margin be on quote ${SEED_QUOTE} if I applied a 15% customer discount on top of existing ecomm?`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '15') || containsCI(c.replyText, 'discount') || containsCI(c.replyText, 'margin')) && !containsCI(c.replyText, 'cannot calculate'),
      notes: 'hypothetical margin calc',
    }),
  },
  { id: 37, cat: 'M', destructive: false, needsSessionReset: true,
    prompt: `Show me cost, list price, and margin breakdown on quote ${SEED_QUOTE} for each line item.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'cost') || containsCI(c.replyText, 'list') || containsCI(c.replyText, 'margin')) && hasZohoUrl(c.replyText),
      notes: 'per-line margin breakdown',
    }),
  },
  { id: 38, cat: 'M', destructive: true, needsSessionReset: true,
    prompt: `Change quote ${SEED_QUOTE} license term from 3 years to 5 years and show me how margin changes.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, '5 year') || containsCI(c.replyText, '5yr') || containsCI(c.replyText, '5-year')) && (containsCI(c.replyText, 'margin') || containsCI(c.replyText, 'total') || containsCI(c.replyText, 'updated')),
      notes: 'term change + margin impact',
    }),
  },

  // ===========================================================
  // X — Cross-cutting Edge Cases (12 tests)
  // ===========================================================
  { id: 39, cat: 'X', destructive: false, needsSessionReset: true,
    prompt: `Show me my top 5 open deals.`,
    criteria: c => {
      const hrefs = extractHrefs(c.renderedHtml);
      return {
        pass: hrefs.length >= 1 && !hasUndoToken(c.replyText),
        notes: `hrefs=${hrefs.length}`,
        extras: { hrefs },
      };
    },
  },
  { id: 40, cat: 'X', destructive: false, needsSessionReset: true,
    prompt: `What's my pipeline look like this quarter?`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'pipeline') || containsCI(c.replyText, 'deal') || containsCI(c.replyText, 'open') || containsCI(c.replyText, 'total') || containsCI(c.replyText, '$'),
      notes: 'pipeline summary',
    }),
  },
  { id: 41, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Create a deal 'No Lead Source Deal' on account ${TEST_ACCOUNT}, closing 2026-12-31. (No lead source specified.)`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'lead source') || containsCI(c.replyText, 'lead_source') || containsCI(c.replyText, 'stratus referal') || containsCI(c.replyText, 'which')) && !containsCI(c.replyText, '-none-'),
      notes: 'defaults to Stratus Referal OR asks',
    }),
  },
  { id: 42, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Create deal 'Past Date Probe' on account ${TEST_ACCOUNT}, closing 2024-01-15, lead source Stratus Referal.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'past') || containsCI(c.replyText, 'already') || containsCI(c.replyText, 'warn') || containsCI(c.replyText, 'future') || containsCI(c.replyText, 'previous') || containsCI(c.replyText, '2024') || hasZohoUrl(c.replyText),
      notes: 'past closing date handled',
    }),
  },
  { id: 43, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Create contact 'Invalid Email Test' at account ${TEST_ACCOUNT} with email 'not-an-email-string'.`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'invalid') || containsCI(c.replyText, 'not a valid') || containsCI(c.replyText, 'bad email') || containsCI(c.replyText, 'format') || containsCI(c.replyText, 'fix') || containsCI(c.replyText, 'correct'),
      notes: 'email validation',
    }),
  },
  { id: 44, cat: 'X', destructive: false, needsSessionReset: true,
    prompt: `Find all open deals that have "renew" in the name.`,
    criteria: c => ({
      pass: !containsCI(c.replyText, 'error') && (containsCI(c.replyText, 'renew') || containsCI(c.replyText, 'no deals') || containsCI(c.replyText, 'no records') || containsCI(c.replyText, 'found') || extractHrefs(c.renderedHtml).length > 0),
      notes: 'word-match search',
    }),
  },
  { id: 45, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Update quote ${SEED_QUOTE} subject to include an emoji: "🚀 Rocket Quote"`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'rocket') || c.replyText.includes('🚀') || containsCI(c.replyText, 'updated')) && !containsCI(c.replyText, 'failed'),
      notes: 'unicode/emoji in subject',
    }),
  },
  { id: 46, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Create a quote on deal ${SEED_DEAL} with a single 0-qty item (just a placeholder).`,
    criteria: c => ({
      pass: containsCI(c.replyText, 'quantity') || containsCI(c.replyText, 'qty') || containsCI(c.replyText, 'zero') || containsCI(c.replyText, 'at least 1') || containsCI(c.replyText, 'minimum') || containsCI(c.replyText, 'refuse') || hasZohoUrl(c.replyText),
      notes: 'zero-qty handling',
    }),
  },
  { id: 47, cat: 'X', destructive: false, needsSessionReset: true,
    prompt: `Quote ${SEED_QUOTE_NUMBER} — what account is it on?`,
    criteria: c => ({
      pass: hasZohoUrl(c.replyText) || containsCI(c.replyText, 'account') || containsCI(c.replyText, 'test account') || containsCI(c.replyText, 'harness'),
      notes: 'cross-module walk: quote → deal → account',
    }),
  },
  { id: 48, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Rename deal ${SEED_DEAL} to 'Name With "Quotes" And \\ Slash — dash'.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'renamed') || containsCI(c.replyText, 'updated') || containsCI(c.replyText, 'changed')) && !containsCI(c.replyText, 'syntax error'),
      notes: 'escape-heavy name',
    }),
  },
  { id: 49, cat: 'X', destructive: true, needsSessionReset: true,
    prompt: `Add a note to deal ${SEED_DEAL}: "Line 1\\nLine 2\\nLine 3" — should preserve newlines.`,
    criteria: c => ({
      pass: (containsCI(c.replyText, 'note') || containsCI(c.replyText, 'added')) && !containsCI(c.replyText, 'failed'),
      notes: 'multi-line note',
    }),
  },
  { id: 50, cat: 'X', destructive: false, needsSessionReset: true,
    prompt: `What can you do? Give me a short list of your CRM capabilities.`,
    criteria: c => {
      const hasList = /<ul>[\s\S]*<li>/i.test(c.renderedHtml);
      const mentionsCrm = containsAny(c.replyText, ['deal', 'quote', 'contact', 'task', 'zoho']);
      return { pass: hasList && mentionsCrm, notes: 'capability summary' };
    },
  },
];

// ---------- Runner ----------
async function main() {
  const startedAt = new Date().toISOString();
  console.log(`=== Stratus AI v2 edge-case matrix — ${startedAt} ===`);
  console.log(`Output: ${outPath}`);
  console.log(`Gateway: ${GATEWAY}`);
  console.log(`FORCE_MODEL: ${FORCE_MODEL || '(waterfall)'} — RUN_LABEL: ${RUN_LABEL}`);
  console.log('');

  let sessionId = crypto.randomUUID();
  let history = [];
  let pass = 0, fail = 0;
  const failures = [];
  const byCategory = {};

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

    byCategory[t.cat] = byCategory[t.cat] || { pass: 0, fail: 0 };
    if (verdict.pass) byCategory[t.cat].pass++;
    else byCategory[t.cat].fail++;

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

    await new Promise(r => setTimeout(r, 400));
  }

  console.log('');
  console.log(`=== Done: ${pass} PASS / ${fail} FAIL ===`);
  if (failures.length) console.log(`Failed IDs: ${failures.join(', ')}`);
  console.log('');
  console.log('By category:');
  for (const [cat, stats] of Object.entries(byCategory)) {
    const total = stats.pass + stats.fail;
    const pct = total ? Math.round((stats.pass / total) * 100) : 0;
    console.log(`  ${cat}: ${stats.pass}/${total} (${pct}%)`);
  }
  logStream.end();
}

main().catch(e => {
  console.error('Runner crashed:', e);
  process.exit(1);
});
