/**
 * Stratus AI Chrome Extension — Chat Panel
 *
 * CRM-aware Claude chat with persistent history, abort/stop support,
 * and forced Zoho execution for quote/deal modification requests.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendToBackground, onMessage } from '../../lib/messaging';
import { MSG, COLORS, SKU_PATTERN } from '../../lib/constants';
import { getLocalStorage, setLocalStorage } from '../../lib/storage';
import {
  parseZohoRecordUrl,
  contextMatchesUrl,
  minimalContextFromUrl,
} from '../../lib/zoho-url.js';
import QuoteResult from '../components/QuoteResult';
import EmailAnalysisResult from '../components/EmailAnalysisResult';
// Quoting + screenshot parsing routed through the worker API (the same
// deterministic engine the Webex/GChat bots use), consolidated into Chat
// 2026-06-17 when the standalone Quote and Email tabs were removed.
import { runQuote, analyzeImage, orderSummaryFromResult } from '../../lib/quote-client';

// Per-tab storage key prefix — must match the background service worker.
// Reading by tab id ensures the chat panel never picks up a different
// tab's Zoho record from the storage fallback.
const ZOHO_CTX_KEY_PREFIX = 'zohoCtx_';
const zohoCtxKey = (tabId) => `${ZOHO_CTX_KEY_PREFIX}${tabId}`;

/**
 * Read the per-tab Zoho context for a specific tab id directly from
 * chrome.storage.session. Caller is responsible for validating against the
 * active URL via `contextMatchesUrl`.
 */
async function readTabZohoCtx(tabId) {
  if (tabId == null) return null;
  try {
    const key = zohoCtxKey(tabId);
    const stored = await chrome.storage.session.get(key);
    if (stored && stored[key]) return stored[key];
  } catch (_) { /* ignore */ }
  return null;
}

// ─────────────────────────────────────────────
// Markdown renderer
// Handles: [text](url) links, bare URLs, **bold**, *bold*, _italic_, --- hr
// ─────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const linkStyle = { color: COLORS.STRATUS_BLUE, textDecoration: 'underline', wordBreak: 'break-all' };

  return lines.map((line, i) => {
    // Horizontal rule
    if (/^\s*---+\s*$/.test(line)) {
      return <hr key={i} style={{ border: 'none', borderTop: `1px solid ${COLORS.BORDER}`, margin: '8px 0' }} />;
    }

    // Process inline elements: markdown links first, then bare URLs, then emphasis
    const parts = [];
    let lastIdx = 0;
    // Combined regex: [text](url) OR bare http(s)://... URL
    const combinedRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"')]+)/g;
    let match;
    while ((match = combinedRegex.exec(line)) !== null) {
      if (match.index > lastIdx) parts.push(line.substring(lastIdx, match.index));
      if (match[1] && match[2]) {
        // Markdown-style link: [text](url)
        parts.push(
          <a key={`l-${i}-${match.index}`} href={match[2]} target="_blank" rel="noopener" style={linkStyle}>
            {match[1]}
          </a>
        );
      } else if (match[3]) {
        // Bare URL — link with the URL as its own text
        const url = match[3];
        const display = url.length > 80 ? url.substring(0, 77) + '...' : url;
        parts.push(
          <a key={`u-${i}-${match.index}`} href={url} target="_blank" rel="noopener" style={linkStyle}>
            {display}
          </a>
        );
      }
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < line.length) parts.push(line.substring(lastIdx));
    const processed = parts.length > 0 ? parts : [line];

    // Apply **bold**, *bold* (single-asterisk), and _italic_ to string parts
    const final = processed.map((part, pi) => {
      if (typeof part !== 'string') return part;
      // Split on **bold**, *bold*, or _italic_ (capture groups preserve the delimiters)
      const segments = part.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_)/g);
      return segments.map((seg, si) => {
        if (/^\*\*[^*]+\*\*$/.test(seg)) {
          return <strong key={`b-${i}-${pi}-${si}`}>{seg.slice(2, -2)}</strong>;
        }
        if (/^\*[^*\n]+\*$/.test(seg)) {
          return <strong key={`sb-${i}-${pi}-${si}`}>{seg.slice(1, -1)}</strong>;
        }
        if (/^_[^_\n]+_$/.test(seg)) {
          return <em key={`it-${i}-${pi}-${si}`} style={{ color: COLORS.TEXT_SECONDARY }}>{seg.slice(1, -1)}</em>;
        }
        return seg;
      });
    });

    return (
      <div key={i} style={{ minHeight: line.trim() === '' ? 8 : 'auto' }}>
        {final}
      </div>
    );
  });
}

// Small "Copy" affordance shown under assistant replies and drafts.
function CopyButton({ text }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  }
  return (
    <button
      onClick={copy}
      title="Copy to clipboard"
      style={{
        marginTop: 6, background: 'none', border: 'none', padding: 0,
        fontSize: 10, color: COLORS.STRATUS_BLUE, cursor: 'pointer', opacity: 0.8,
      }}
    >
      {done ? '✓ Copied' : '⧉ Copy'}
    </button>
  );
}

// Extract ALL Zoho Quotes record references from assistant text — the CRM
// agent returns a crm.zoho.com/.../tab/Quotes/{id} link whenever it creates or
// finds a quote, which is exactly where the "Download Zoho PDF" affordance
// belongs. When one message creates MULTIPLE quotes (e.g. a 3-year and a
// 5-year option), the old first-match-only version bound the button to an
// arbitrary quote — now every quote gets its own labeled button. Each ref
// carries a best-effort term label pulled from the text just before the link
// ("3-Year" / "5YR" / "1 yr" → "3-Year" etc.), used to caption the buttons.
function extractZohoQuoteRefs(text) {
  if (!text) return [];
  const s = String(text);
  const re = /crm\.zoho\.com\/crm\/(org\d+)\/tab\/Quotes\/(\d{10,19})/gi;
  const refs = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(s)) !== null) {
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    // Look backward a short window for the nearest term mention (the quote's
    // heading, e.g. "*Quote 1 — 3-Year (...)*" precedes its URL).
    const windowText = s.slice(Math.max(0, m.index - 250), m.index);
    const termMatches = [...windowText.matchAll(/(\d+)\s*[-–]?\s*(?:year|yr)s?\b/gi)];
    const label = termMatches.length ? `${termMatches[termMatches.length - 1][1]}-Year` : null;
    refs.push({ org: m[1], recordId: m[2], label });
  }
  // Labels only help when they disambiguate — drop them if duplicated (e.g.
  // two quotes both preceded by "3-Year" text would mislabel; fall back to
  // positional labels at the render site instead).
  const labels = refs.map((r) => r.label).filter(Boolean);
  if (new Set(labels).size !== labels.length) refs.forEach((r) => { r.label = null; });
  return refs;
}

function downloadBase64Pdf(base64, filename) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'quote.pdf';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

const DEFAULT_PDF_TEMPLATES = ['Hardware Quote', 'Professional Services Quote'];

// "Download Zoho PDF" — pulls Zoho's OWN templated PDF for a quote via the
// background (which drives a hidden crm.zoho.com tab on the live session).
// Defaults to Hardware Quote, remembers the last pick, and on any non-PDF
// response shows a graceful error + an "open in Zoho" link.
function QuotePdfButton({ recordId, org, label }) {
  const [state, setState] = useState('idle'); // idle | working | done | error
  const [err, setErr] = useState('');
  const [template, setTemplate] = useState('Hardware Quote');
  const [templates, setTemplates] = useState(DEFAULT_PDF_TEMPLATES);

  useEffect(() => {
    getLocalStorage(['zohoPdfTemplate', 'zohoPdfTemplates']).then((s) => {
      if (s.zohoPdfTemplate) setTemplate(s.zohoPdfTemplate);
      if (Array.isArray(s.zohoPdfTemplates) && s.zohoPdfTemplates.length) setTemplates(s.zohoPdfTemplates);
    });
  }, []);

  async function download() {
    setState('working');
    setErr('');
    try {
      const res = await sendToBackground(MSG.EXPORT_ZOHO_PDF, { recordId, org, templateName: template });
      if (res && res.success && res.base64) {
        downloadBase64Pdf(res.base64, res.filename);
        if (Array.isArray(res.templates) && res.templates.length) {
          setTemplates(res.templates);
          setLocalStorage({ zohoPdfTemplates: res.templates });
        }
        setState('done');
        setTimeout(() => setState('idle'), 2500);
      } else {
        setErr((res && res.error) || 'failed');
        setState('error');
      }
    } catch (e) {
      setErr(e.message || 'failed');
      setState('error');
    }
  }

  function onTemplateChange(e) {
    setTemplate(e.target.value);
    setLocalStorage({ zohoPdfTemplate: e.target.value });
  }

  const errText =
    err === 'not_pdf' ? 'Zoho didn’t return a PDF'
      : err === 'not_logged_in' ? 'Log into Zoho, then retry'
      : err === 'no_templates' ? 'No print template found'
      : `Export failed${err && err !== 'failed' ? ` (${String(err).slice(0, 60)})` : ''}`;

  return (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <button
        onClick={download}
        disabled={state === 'working'}
        title="Download Zoho's templated PDF for this quote"
        style={{
          background: COLORS.STRATUS_BLUE, color: 'white', border: 'none',
          borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600,
          cursor: state === 'working' ? 'default' : 'pointer', opacity: state === 'working' ? 0.7 : 1,
        }}
      >
        {state === 'working' ? '⏳ Downloading…' : state === 'done' ? '✓ Downloaded' : (label ? `⬇ ${label} PDF` : '⬇ Download Zoho PDF')}
      </button>
      <select
        value={template}
        onChange={onTemplateChange}
        title="Quote template"
        style={{
          fontSize: 11, padding: '3px 4px', borderRadius: 6,
          border: `1px solid ${COLORS.BORDER}`, color: COLORS.TEXT_PRIMARY, background: 'white',
        }}
      >
        {templates.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {state === 'error' && (
        <span style={{ fontSize: 10, color: '#c5221f' }}>
          {errText} —{' '}
          <a
            href={`https://crm.zoho.com/crm/${org || 'org647122552'}/tab/Quotes/${recordId}`}
            target="_blank" rel="noreferrer"
            style={{ color: COLORS.STRATUS_BLUE }}
          >
            open in Zoho
          </a>
        </span>
      )}
    </div>
  );
}

// ── Confirmation form (clickable picklist) ──────────────────────────────────
// The worker attaches `suggestions` to a clarifying reply; the agent groups them
// (Contact / License term / Cisco rep / which deal …) and marks one recommended
// default per group. This renders a SELECT-THEN-CONFIRM form, NOT fire-on-click:
// each group is a single-choice picklist with the default pre-selected; the user
// can change ANY of them, then hits one "Confirm" that submits all picks as a
// single combined message. Layout stacks vertically so it reads cleanly at any
// width. Submits via handleSendMessage(text,{bypassRateLimit}) so the combined
// answer reaches the CRM agent (not the ecomm URL engine) and isn't debounced.
function normalizeSuggestionGroups(suggestions) {
  let groups = [];
  if (Array.isArray(suggestions)) groups = [{ options: suggestions }];
  else if (Array.isArray(suggestions?.groups)) groups = suggestions.groups;
  else if (Array.isArray(suggestions?.options)) groups = [{ label: suggestions.question, options: suggestions.options }];
  return groups
    .map((g) => ({ label: g?.label, options: (Array.isArray(g?.options) ? g.options : []).filter((o) => o && (o.send || o.label)) }))
    .filter((g) => g.options.length);
}

function SuggestionChips({ suggestions, onPick, disabled }) {
  const groups = normalizeSuggestionGroups(suggestions);
  // Selected option index per group — default to the recommended one (else first).
  const [sel, setSel] = useState(() => groups.map((g) => {
    const r = g.options.findIndex((o) => o.recommended);
    return r >= 0 ? r : 0;
  }));
  const [submitted, setSubmitted] = useState(false);
  if (!groups.length) return null;

  const sendText = (o) => (o.send != null ? o.send : o.label);
  const confirm = () => {
    if (disabled || submitted) return;
    const parts = groups.map((g, gi) => g.options[sel[gi]]).filter(Boolean).map(sendText);
    if (!parts.length) return;
    setSubmitted(true);
    onPick(parts.join('. '));
  };
  const locked = disabled || submitted;

  return (
    <div style={{
      marginTop: 8, border: `1px solid ${COLORS.STRATUS_BLUE}33`, borderRadius: 10,
      padding: 12, background: COLORS.BG_SECONDARY,
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 }}>
        Tap to choose · then Confirm
      </div>
      {groups.map((g, gi) => (
        <div key={gi} style={{ marginBottom: 12 }}>
          {g.label && (
            <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 5 }}>{g.label}</div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {g.options.map((o, oi) => {
              const isSel = sel[gi] === oi;
              return (
                <button
                  key={oi}
                  onClick={() => !locked && setSel((s) => { const n = [...s]; n[gi] = oi; return n; })}
                  disabled={locked}
                  title={sendText(o)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 7,
                    background: isSel ? COLORS.STRATUS_BLUE : 'white',
                    color: isSel ? 'white' : COLORS.STRATUS_BLUE,
                    border: `1.5px solid ${COLORS.STRATUS_BLUE}`,
                    borderRadius: 18, padding: '6px 13px', fontSize: 12,
                    fontWeight: isSel ? 700 : 500, lineHeight: 1.2,
                    cursor: locked ? 'default' : 'pointer',
                    opacity: submitted && !isSel ? 0.4 : 1,
                  }}
                >
                  <span style={{
                    width: 13, height: 13, borderRadius: '50%', flexShrink: 0,
                    border: `2px solid ${isSel ? 'white' : COLORS.STRATUS_BLUE}`,
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSel && <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'white' }} />}
                  </span>
                  {o.label || sendText(o)}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <button
        onClick={confirm}
        disabled={locked}
        style={{
          width: '100%', marginTop: 2, padding: '9px 12px', borderRadius: 8, border: 'none',
          background: submitted ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE, color: 'white',
          fontSize: 13, fontWeight: 700, cursor: locked ? 'default' : 'pointer', opacity: disabled && !submitted ? 0.6 : 1,
        }}
      >
        {submitted ? '✓ Sent' : '✓ Confirm'}
      </button>
      <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, opacity: 0.8, marginTop: 7, textAlign: 'center' }}>
        or type your own answer below
      </div>
    </div>
  );
}

// Chat history sent to the worker MUST have non-empty content for every turn —
// Anthropic 400s with "messages.N.content: Field required" otherwise. Structured
// messages (quote / analysis cards) carry no `content`, so render a short text
// stand-in so they ride along in history without breaking the request.
function messageHistoryText(m) {
  if (m && m.content) return m.content;
  if (m && m.kind === 'quote' && m.result) {
    const urls = (m.result.urls || []).map((u) => `${u.label || 'Option'}: ${u.url}`).join('\n');
    const head = `[Generated an ecomm quote]${m.skuText ? ` for: ${m.skuText}` : ''}`;
    return (urls ? `${head}\n${urls}` : head).trim();
  }
  if (m && m.kind === 'analysis' && m.analysis) {
    return `[Analyzed the open email]${m.analysis.summary ? `: ${m.analysis.summary}` : ''}`;
  }
  return (m && m.note) || '[message]';
}

const QUICK_ACTIONS = [
  { label: 'Recent Quotes', text: 'Show my most recent quotes in Zoho' },
  { label: 'Open Deals', text: 'Show my open deals in Zoho CRM' },
  { label: 'Create Quote', text: 'Help me create a quote in Zoho CRM' },
  { label: 'Look Up Account', text: 'Look up the account for this email in Zoho CRM' },
  { label: 'Find License Key', text: 'Find the license key for this deal' },
];

function isQuoteFromEmailRequest(text) {
  const value = (text || '').toLowerCase();
  if (!/(quote|quoted|quoting|zoho quote|crm quote)/.test(value)) return false;
  return /\b(this|the|current)\s+(email|thread|conversation)\b/.test(value)
    || /\bbased on (this|the|current) (email|thread|conversation)\b/.test(value)
    || /\bfrom (this|the|current) (email|thread|conversation)\b/.test(value)
    || /\brequested items?\b/.test(value)
    || /\bwhat (needs|need) to be quoted\b/.test(value);
}

// 2026-07-09 (corp bug report #4): drafting asks ("generate a response", "draft a
// reply") previously only got the full thread when they HAPPENED to trip the
// quote-extraction detector above — and then with a quote-extraction banner that
// biased the agent toward quoting. Detect drafting intent in its own right so the
// reply is grounded in the whole thread with drafting framing.
function isDraftReplyRequest(text) {
  const value = (text || '').toLowerCase();
  // The compose verb must bind DIRECTLY to the reply noun — a loose gap made
  // "create a quote from this email in response to their request" a draft ask.
  return /\b(generate|draft|write|compose|create)\s+(an?\s+|the\s+|a\s+(?:quick|short|brief)\s+)?(response|reply|follow[\s-]?up)\b/.test(value)
    || /\b(draft|write|compose)\s+(an?\s+|the\s+)?email\b/.test(value)
    || /\breply\s+to\s+(this|the|him|her|them)\b/.test(value)
    || /\brespond\s+to\s+(this|the)\s+(email|thread|message)\b/.test(value);
}

function newQuotePersonId() {
  const suffix = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return `chrome-ext-chat-quote-${suffix}`;
}

// Detect a deterministic ecommerce/URL quote request (the Webex-bot path: SKUs
// in → 1/3/5-year order links out). Deliberately conservative: anything that
// targets Zoho/CRM, references "this quote/deal", asks to modify a record, or
// quotes from the email goes to the CRM agent (/api/chat) instead.
// Accessory / PSU SKU-find requests must go to the CRM agent (/api/chat-waterfall),
// which resolves the SKU AND strips+renders the [[SUGGESTIONS]] chip block. The
// deterministic /api/quote engine would quote the HOST switch and leaks the raw block
// (Round E bug). Mirrors the worker's isAccessorySkuFindRequest (2026-06-19).
function isAccessoryRequest(text) {
  const t = text || '';
  // Explicit orderable accessory SKU present → normal quote, not a discovery (Codex review).
  if (/\b(pwr-[a-z0-9][a-z0-9-]+|ma-pwr-[a-z0-9-]+|ma-inj-[a-z0-9-]+|glc-[a-z0-9-]+|sfp-[a-z0-9-]+|qsfp-[a-z0-9-]+|stack-[a-z0-9-]+|[a-z0-9]{2,}-stk-[a-z0-9-]+|cab-[a-z0-9-]+)\b/i.test(t)) return false;
  return /\b(power\s*supply|psu|power\s*adapter|power\s*injector|stack(?:ing)?\s*(?:cable|kit|module)|transceiver|sfp\+?|qsfp\+?|gbic|patch\s*cable|mounting\s*(?:kit|bracket)|rack\s*(?:kit|mount)|rail\s*kit|antenna|wall\s*(?:mount|adapter))\b/i.test(t);
}

function isEcommQuoteRequest(text) {
  const v = (text || '').toLowerCase().trim();
  if (!v) return false;
  if (isAccessoryRequest(v)) return false; // PSU/accessory → CRM agent (chip-capable), not the deterministic /api/quote engine
  if (/\b(zoho|crm)\b/.test(v)) return false;
  if (isQuoteFromEmailRequest(text)) return false;
  if (/\b(add|remove|update|change|modify|edit|append|delete|convert|attach)\b/.test(v)) return false;
  if (/\b(this|that|the)\s+(quote|deal|order|account|invoice|so|po)\b/.test(v)) return false;
  SKU_PATTERN.lastIndex = 0;
  // SKU_PATTERN doesn't cover the synthetic MR-ENT / "MR Enterprise" token,
  // which quote-client handles — match it explicitly so typed MR-ENT asks
  // still route to the deterministic engine.
  const hasSku = SKU_PATTERN.test(text) || /\b(MR[-_]ENT|MR\s+Enterprise)\b/i.test(text);
  SKU_PATTERN.lastIndex = 0;
  if (!hasSku) return false;
  const wantsQuote = /\b(quote|price|pricing|cost|order link|order url|url quote|ecomm|e-comm|ecommerce|buy|purchase|co-?term|link|links)\b/.test(v);
  const skuDominant = /^\s*(\d+\s*[xX×]?\s*)?(mr|ms|mx|cw|mv|mt|mg|z\d|c9|lic-)/i.test(v) && v.length <= 160;
  return wantsQuote || skuDominant;
}

// A short follow-up about an ALREADY-generated quote ("cost of option 2",
// "hardware only", "the 3-year option") carries no SKU, so it would otherwise
// fall through to the CRM agent. Route it back to the deterministic engine
// (same personId quote session) — but only when a prior quote exists in the
// thread, and never for Zoho/CRM/email asks.
function isQuoteFollowUp(text) {
  const v = (text || '').toLowerCase().trim();
  if (!v || v.length > 80) return false;
  if (/\b(zoho|crm|deal|account|invoice|task|email)\b/.test(v)) return false;
  // 2026-07-09: license-removal corrections ("remove the licenses", "no licenses",
  // "just the hardware") must reach the deterministic quote session — previously
  // the remove/change verb guard in isEcommQuoteRequest sent them to the CRM agent.
  return /\b(option\s*\d|opt\s*\d|cost(\s+of)?|how much|price|pricing|grand total|\btotal\b|hardware[ -]?only|license[ -]?only|\d\s*-?\s*year|co-?term|cheaper|the\s+(1|3|5)\s*-?\s*year)\b/.test(v)
    || /\b(no\s+licenses?|without\s+licenses?|just\s+(the\s+)?hardware|(remove|drop)\s+(the\s+|all\s+)?licen[sc]es?|take\s+(the\s+)?licen[sc]es?\s+(out|off))\b/.test(v);
}

function buildRequestedQuoteEmailContext(emailContext) {
  if (!emailContext) return '';
  const threadText = (emailContext.fullThreadBody || emailContext.body || '').trim();
  if (!threadText) return '';
  const lines = [
    '[User explicitly requested quote extraction from the current Gmail thread.]',
    `Subject: ${emailContext.subject || ''}`,
  ];
  if (emailContext.senderName || emailContext.senderEmail) {
    lines.push(`From: ${emailContext.senderName || ''} <${emailContext.senderEmail || ''}>`);
  }
  if (emailContext.customerEmail) {
    lines.push(`Customer: ${emailContext.customerName || ''} <${emailContext.customerEmail}>`);
  }
  lines.push(
    '',
    'Full visible Gmail thread text for identifying requested quote items:',
    threadText.substring(0, 18000),
    '',
    'Use this thread text only because the user asked for it. Identify the requested items and quantities from the email before creating or preparing a quote. Default deliverable: Stratus ecomm order URL(s) for those items — create a Zoho CRM quote ONLY if the user explicitly asked for a Zoho/CRM quote. If the thread is ambiguous, ask one concise clarification instead of guessing.'
  );
  return lines.join('\n');
}

// Neutral drafting framing — same thread payload as the quote-extraction builder,
// but instructs the agent to mine the WHOLE thread for the reply instead of
// treating it as a line-item source.
function buildDraftReplyEmailContext(emailContext) {
  if (!emailContext) return '';
  const threadText = (emailContext.fullThreadBody || emailContext.body || '').trim();
  if (!threadText) return '';
  const lines = [
    '[User asked to draft a reply in the current Gmail thread.]',
    `Subject: ${emailContext.subject || ''}`,
  ];
  if (emailContext.senderName || emailContext.senderEmail) {
    lines.push(`From: ${emailContext.senderName || ''} <${emailContext.senderEmail || ''}>`);
  }
  if (emailContext.customerEmail) {
    lines.push(`Customer: ${emailContext.customerName || ''} <${emailContext.customerEmail}>`);
  }
  lines.push(
    '',
    'Full visible Gmail thread text for grounding the reply:',
    threadText.substring(0, 18000),
    '',
    'Ground the reply in this ENTIRE thread: prior asks, commitments, and topics other participants raised. Render the complete email body inline in your chat response (body only). Do not invent facts that are not in the thread.'
  );
  return lines.join('\n');
}

// ─────────────────────────────────────────────
// Zoho intent detection
// When user asks to modify a quote/deal, inject enforcement
// ─────────────────────────────────────────────
function buildSystemContext(emailContext, selectedEmail) {
  // NOTE: Zoho capability rules are NOT injected here. They live in the backend's
  // CRM system prompt (buildCrmSystemPrompt). Injecting them in the user message
  // causes Claude to interpret them as prompt injection and refuse to comply.
  // This function only provides email/customer context for CRM pre-fill.
  let ctx = '';

  // Use selectedEmail override if provided, else fall back to customerEmail
  const activeEmail = selectedEmail || (emailContext && emailContext.customerEmail);
  if (emailContext && activeEmail) {
    // Find matching contact from threadContacts for name lookup
    const contacts = emailContext.threadContacts || [];
    const match = contacts.find(c => c.email?.toLowerCase() === activeEmail.toLowerCase());
    const name = match?.name || (activeEmail === emailContext.customerEmail ? emailContext.customerName : '') || '';
    const domain = activeEmail.split('@')[1] || emailContext.customerDomain || '';
    ctx += `\n\nActive email context:
- Customer: ${name} <${activeEmail}>
- Subject: ${emailContext.subject || ''}
- Domain: ${domain}
- Use this context to pre-fill account/contact when creating quotes or deals`;
  }
  return ctx;
}

// Build unique participant list for dropdown
function buildParticipantOptions(emailContext) {
  if (!emailContext) return [];
  const seen = new Set();
  const opts = [];

  const add = (email, name, role) => {
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    if (seen.has(lower)) return;
    seen.add(lower);
    opts.push({ email: lower, name: name || '', role: role || '' });
  };

  // Prefer threadContacts (has role info + dedup)
  if (emailContext.threadContacts && emailContext.threadContacts.length > 0) {
    emailContext.threadContacts.forEach(c => add(c.email, c.name, c.role));
  }
  // Fall back: at least add customerEmail + senderEmail
  if (emailContext.customerEmail) add(emailContext.customerEmail, emailContext.customerName, 'customer');
  if (emailContext.senderEmail && emailContext.senderEmail !== emailContext.customerEmail) {
    add(emailContext.senderEmail, emailContext.senderName, 'sender');
  }

  return opts;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function ChatPanel({
  emailContext,
  navData,
  messages,
  onMessagesChange,
  // Active Zoho page context — lifted into App.jsx so the header pill and
  // the chat panel share a single source of truth. URL-validated there.
  zohoPageContext: zohoPageContextProp,
}) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedContextEmail, setSelectedContextEmail] = useState(null);
  const [contextDropdownOpen, setContextDropdownOpen] = useState(false);
  // Local fallback state for cases where the panel is rendered without the
  // prop wired (e.g. legacy entry points). Primary reader is the computed
  // `zohoPageContext` below.
  const [zohoPageContextLocal, setZohoPageContextLocal] = useState(null);
  const zohoPageContext = zohoPageContextProp ?? zohoPageContextLocal;
  // Manually-pinned CRM record from search (overrides zohoPageContext when set)
  // Shape: { module, recordId, recordName, accountName, email }
  const [manualRecord, setManualRecord] = useState(null);
  // Manual CRM search state (rendered inside the context dropdown)
  const [searchMode, setSearchMode] = useState(false);
  const [searchModule, setSearchModule] = useState('Accounts');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState(null);
  // Progress steps — populated via polling while a chat request is in flight
  const [progressSteps, setProgressSteps] = useState([]);
  const messagesEndRef = useRef(null);
  // AbortController ref for stop functionality
  const abortRef = useRef(null);
  const lastSendRef = useRef(0); // Rate-limit: min 1s between sends
  // Active progress poll interval — cleared when request completes
  const progressIntervalRef = useRef(null);
  // Persistent personId for deterministic quotes (lets the worker keep a quote
  // session for pricing follow-ups / revisions, mirroring the old Quote tab).
  const personIdRef = useRef(newQuotePersonId());
  // Hidden <input type=file> for the "Upload image" action (attachments / pasted images).
  const fileInputRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset context selection when email changes
  useEffect(() => {
    setSelectedContextEmail(null);
  }, [emailContext?.customerEmail, emailContext?.subject]);

  // Legacy fallback: when the parent did not pass zohoPageContext via props
  // (older embedding, tests, etc.) we still refresh locally. When the prop
  // IS wired (default path), this effect is a no-op.
  //
  // URL is authoritative: we only trust cached/stored context when its
  // recordId + module match the active tab URL. Storage reads use the
  // per-tab key zohoCtx_<activeTabId> so a different tab's record can
  // never bleed in.
  useEffect(() => {
    if (zohoPageContextProp !== undefined && zohoPageContextProp !== null) return;
    let cancelled = false;
    async function refreshPageCtx() {
      let activeUrl = '';
      let activeTabId = null;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeUrl = activeTab?.url || '';
        activeTabId = activeTab?.id ?? null;
      } catch (_) { /* ignore */ }

      const urlInfo = parseZohoRecordUrl(activeUrl);
      if (!urlInfo?.isRecord) {
        if (!cancelled) setZohoPageContextLocal(null);
        return;
      }

      // Path 1: background message.
      let zohoCtx = null;
      try {
        const ctx = await sendToBackground(MSG.GET_PAGE_CONTEXT, {});
        if (contextMatchesUrl(ctx?.zohoContext, urlInfo)) {
          zohoCtx = ctx.zohoContext;
        }
      } catch (err) {
        console.warn('[Stratus Chat] GET_PAGE_CONTEXT via background failed:', err?.message);
      }

      // Path 2: per-tab storage read with matching validation.
      if (!zohoCtx) {
        const stored = await readTabZohoCtx(activeTabId);
        if (contextMatchesUrl(stored, urlInfo)) {
          zohoCtx = stored;
        }
      }

      // Path 3: URL-derived minimal context (always beats null when on a
      // record page, so the chat header shows the right id even before
      // DOM enrichment finishes).
      if (!zohoCtx) zohoCtx = minimalContextFromUrl(urlInfo);

      if (cancelled) return;
      setZohoPageContextLocal(zohoCtx);
    }

    refreshPageCtx();
    const interval = setInterval(refreshPageCtx, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [zohoPageContextProp]);

  // Build a context hint string for "this {record}"-style references.
  // MODULE-SCOPED wording (Phase 1, 2026-05-12): "this quote" on an Account
  // page must NOT be interpreted as the Account itself. Same for Deals and
  // every non-Quotes module. Quote-specific follow-ups should defer to the
  // most-recent-quote session header injected by the worker. The active page
  // is parent/customer context for new creates, not the quote itself.
  function buildZohoPageContextHint(ctx) {
    if (!ctx || !ctx.recordId) return '';
    const moduleLabel = ({
      Quotes: 'Quote',
      Potentials: 'Deal',
      Deals: 'Deal',
      Accounts: 'Account',
      Contacts: 'Contact',
      Tasks: 'Task',
      SalesOrders: 'Sales Order',
      Invoices: 'Invoice',
    })[ctx.module] || ctx.module || 'Record';
    const url = `https://crm.zoho.com/crm/org647122552/tab/${ctx.module}/${ctx.recordId}`;
    const lines = [
      `[Active Zoho page: user is currently viewing ${moduleLabel} ${ctx.recordId}`,
    ];
    if (ctx.recordName) lines[0] += ` — "${ctx.recordName}"`;
    lines[0] += `]`;
    lines.push(`URL: ${url}`);
    if (ctx.accountName) lines.push(`Account: ${ctx.accountName}`);
    if (ctx.email) lines.push(`Contact email: ${ctx.email}`);

    // Module-specific interpretation of deictic phrases ("this quote", etc.)
    if (ctx.module === 'Quotes') {
      lines.push(`Quote-specific wording — "this quote", "that quote", "the quote", "modify this", "convert this", "send this for signature" — means Quote ${ctx.recordId}. Act on it directly without asking which quote.`);
    } else if (ctx.module === 'Accounts') {
      lines.push(`This Account is the CUSTOMER/PARENT CONTEXT for any new Deals, Quotes, Contacts, or Tasks the user asks you to create. Do NOT treat this Account as "this quote". If the user says "the quote", "that quote", or "the quote you just created", use the most-recent quote from the chat/session (see [Session: Most recently worked quote] header if present). If no recent quote exists in this session, ASK which quote rather than assuming this Account is one.`);
    } else if (ctx.module === 'Potentials' || ctx.module === 'Deals') {
      lines.push(`This Deal is the PARENT CONTEXT for quote creation, line edits, and PO/e-sign workflows on this deal. Do NOT treat this Deal as "this quote". If the user says "the quote", "that quote", or "the quote you just created", prefer the most-recent quote from the chat/session linked to this Deal (see [Session: Most recently worked quote] header if present). If no recent session quote exists, ASK which quote on this Deal rather than assuming.`);
    } else {
      lines.push(`When the user says "this" or "modify this", they mean ${moduleLabel} ${ctx.recordId}. For quote-specific follow-ups ("the quote", "that quote", "send this for signature"), prefer the most-recent quote from the chat/session (see [Session: Most recently worked quote] header if present). Do NOT assume this ${moduleLabel} is a quote unless the module is Quotes.`);
    }
    return lines.join('\n');
  }

  // Pre-fill from navData
  useEffect(() => {
    if (navData?.prefillText) setInput(navData.prefillText);
  }, [navData]);

  // Screenshot / image capture routed in from the right-click menu (or the
  // in-chat 📷 button). Parsed SKUs become a deterministic quote in the thread.
  useEffect(() => {
    if (navData?.imageBase64) handleImageQuote(null, navData.imageBase64);
    else if (navData?.imageUrl) handleImageQuote(navData.imageUrl, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navData?.imageBase64, navData?.imageUrl]);

  // "Quote these SKUs with Stratus" from the right-click selection menu.
  useEffect(() => {
    if (navData?.quoteSkuText) runAndPushQuote(navData.quoteSkuText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navData?.quoteSkuText]);

  // Email quick-actions deep-linked from keyboard shortcuts.
  useEffect(() => {
    if (navData?.action === 'analyze') handleAnalyzeEmail();
    else if (navData?.action === 'draft') handleDraftReply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navData?.action]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!contextDropdownOpen) return;
    const handler = () => setContextDropdownOpen(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextDropdownOpen]);

  // Computed participant options for dropdown
  const participantOptions = buildParticipantOptions(emailContext);
  const activeContextEmail = selectedContextEmail === '__none__' ? null
    : (selectedContextEmail || emailContext?.customerEmail || null);
  const activeContact = participantOptions.find(p => p.email === activeContextEmail);

  const handleSendMessage = useCallback(async (overrideText, opts = {}) => {
    const messageText = overrideText || input.trim();
    if (!messageText || loading) return;
    const now = Date.now();
    // Rate-limit: 1 send/sec. Chip clicks bypass it — the deterministic gate can
    // reply in <1s, so a fast confirmation click would otherwise be silently
    // dropped (Codex review finding 5).
    if (!opts.bypassRateLimit && now - lastSendRef.current < 1000) return;
    lastSendRef.current = now;

    const userMsg = {
      id: Date.now(),
      role: 'user',
      content: messageText,
      timestamp: new Date().toISOString(),
    };

    const updatedMessages = [...(messages || []), userMsg];
    onMessagesChange(updatedMessages);
    if (!overrideText) setInput('');
    setLoading(true);
    setError(null);

    // Create abort controller for this request
    abortRef.current = { aborted: false };
    const thisAbort = abortRef.current;

    try {
      const historyForApi = (messages || []).slice(-10).map(m => ({
        role: m.role,
        content: messageHistoryText(m),
      }));

      // ── Resolve the ACTIVE Zoho record from the active tab URL ─────────
      //
      // The URL is authoritative for "what record is the user currently
      // viewing". We re-read it synchronously here so a message sent
      // immediately after SPA navigation targets the NEW record, not
      // whatever is cached in state from 2 seconds ago.
      //
      // Storage reads are keyed by tab id (zohoCtx_<activeTabId>) so a
      // different tab's record can never satisfy this lookup.
      let activeZohoRecord = null;
      let activeUrlInfo = null;
      let activeUrl = '';
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeUrl = activeTab?.url || '';
        const activeTabId = activeTab?.id ?? null;
        activeUrlInfo = parseZohoRecordUrl(activeUrl);
        if (activeUrlInfo?.isRecord) {
          // Prefer the enriched state if it matches the URL; else fall
          // back to per-tab storage (matching only); else the URL-only
          // minimal.
          if (contextMatchesUrl(zohoPageContext, activeUrlInfo)) {
            activeZohoRecord = zohoPageContext;
          } else {
            const stored = await readTabZohoCtx(activeTabId);
            if (contextMatchesUrl(stored, activeUrlInfo)) {
              activeZohoRecord = stored;
            }
            if (!activeZohoRecord) {
              activeZohoRecord = minimalContextFromUrl(activeUrlInfo);
            }
          }
        }
      } catch (err) {
        console.warn('[Stratus Chat] Pre-send page context refresh failed:', err?.message);
      }

      // ── Page-type gating for email context injection ──────────────────
      //
      // (Fix A, Wave B 2026-06-03.) Only attach email context to the
      // outgoing request when the user is ACTUALLY on Gmail right now.
      // Without this gate, a stale email from a Gmail tab the user opened
      // earlier would ride into a request issued while they're on a Zoho
      // record — the bot then conflates the two and answers the wrong
      // question. React's `emailContext` state is allowed to keep holding
      // the value (so the Email panel still works when the user switches
      // back to Gmail), but it must not leak across into a Zoho-tab send.
      const activeIsGmail =
        typeof activeUrl === 'string'
        && activeUrl.startsWith('https://mail.google.com/');
      const gatedEmailContext = activeIsGmail ? emailContext : null;

      // Build effective context: if user selected a specific email, override
      // customerEmail. Source the email pieces from the gated value so a
      // Zoho-tab send never gets an email block, regardless of dropdown
      // state.
      let effectiveContext = selectedContextEmail === '__none__'
        ? null
        : selectedContextEmail && gatedEmailContext
          ? { ...gatedEmailContext, customerEmail: selectedContextEmail, customerName: participantOptions.find(p => p.email === selectedContextEmail)?.name || '' }
          : gatedEmailContext || null;

      const isDraftAsk = isDraftReplyRequest(messageText);
      const shouldReadFullEmailForQuote = isQuoteFromEmailRequest(messageText) || isDraftAsk;
      if (shouldReadFullEmailForQuote) {
        try {
          const fullEmailContext = await sendToBackground(MSG.GET_FULL_EMAIL_CONTEXT, {});
          if (fullEmailContext && !fullEmailContext.empty) {
            effectiveContext = selectedContextEmail === '__none__'
              ? null
              : selectedContextEmail
                ? {
                    ...fullEmailContext,
                    customerEmail: selectedContextEmail,
                    customerName: participantOptions.find(p => p.email === selectedContextEmail)?.name || fullEmailContext.customerName || '',
                  }
                : fullEmailContext;
          }
        } catch (err) {
          console.warn('[Stratus Chat] Full email context requested but unavailable:', err?.message);
        }
      }

      // ── Priority rules for which record the LLM targets ───────────────
      //
      // The user can pin an Account (or any record) via the search flow.
      // Previously `activeRecord = manualRecord || freshZohoCtx`, which
      // meant a pinned Account would HIDE the active Quote the user was
      // looking at. That caused Codex's live repro:
      //
      //   User on Quote 2570562000402426396, pinned Account TestCo Stress
      //   Eval LLC. Asked "what quote am I viewing?" Bot answered:
      //   "You're currently viewing Account 'TestCo Stress Eval LLC'...
      //    but no specific quote is open." — wrong.
      //
      // New rules:
      //   - If the user is ACTIVELY on a non-Account record (Quote/Deal/
      //     Contact/SalesOrder/Invoice/Task), the active record is the
      //     primary target for deictic commands like "this quote".
      //     A pinned Account becomes SUPPLEMENTAL context (account for
      //     creation, account for lookup) but never hides the active
      //     record.
      //   - If there's no active record page, the pinned record becomes
      //     the primary target.
      //   - If the user pinned a non-Account record, that wins over any
      //     conflicting active page (explicit > implicit).
      //
      // ────────────────────────────────────────────────────────────────
      const pinnedIsAccount =
        !!manualRecord && manualRecord.module === 'Accounts';
      const activeIsNonAccountRecord =
        !!activeZohoRecord
        && activeZohoRecord.page === 'record'
        && activeZohoRecord.module
        && activeZohoRecord.module !== 'Accounts';

      let primaryRecord = null;
      let supplementalAccount = null; // pinned Account alongside a non-Account active record

      if (manualRecord && !pinnedIsAccount) {
        // Pinned a Quote/Deal/Contact explicitly — that's the user's choice.
        primaryRecord = manualRecord;
      } else if (activeIsNonAccountRecord) {
        // Active page is a Quote/Deal/Contact — never let a pinned Account
        // override it for deictic commands.
        primaryRecord = activeZohoRecord;
        if (pinnedIsAccount) supplementalAccount = manualRecord;
      } else if (manualRecord) {
        // Pinned Account and no active non-Account record → Account is primary.
        primaryRecord = manualRecord;
      } else if (activeZohoRecord) {
        primaryRecord = activeZohoRecord;
      }

      // ── Build the natural-language context hint ──────────────────────
      let textToSend = messageText;
      const primaryHint = buildZohoPageContextHint(primaryRecord);
      let sourceLabel = null;
      if (primaryRecord) {
        if (primaryRecord === activeZohoRecord) sourceLabel = 'currently viewing';
        else if (primaryRecord === manualRecord) sourceLabel = 'pinned by user';
        else sourceLabel = 'context';
      }

      if (primaryHint) {
        let hint = primaryHint;
        if (supplementalAccount) {
          const accLine = `Pinned Account (supplemental, NOT the primary record): ${supplementalAccount.recordName || supplementalAccount.recordId} (id: ${supplementalAccount.recordId}). Use this account only for lookups or new-record parentage; deictic commands like "this quote" still refer to the primary record above.`;
          hint = `${hint}\n\n${accLine}`;
        }
        textToSend = `${hint}\n(Source: ${sourceLabel})\n\nUser message: ${messageText}`;
      } else if (supplementalAccount) {
        // No primary record, but a pinned account is useful context too.
        const accHint = buildZohoPageContextHint(supplementalAccount);
        if (accHint) textToSend = `${accHint}\n(Source: pinned by user)\n\nUser message: ${messageText}`;
      }

      if (shouldReadFullEmailForQuote) {
        // Drafting asks take drafting framing; quote asks keep the quote-extraction
        // banner. A message that is both (rare) is treated as a draft — the reply
        // body is the deliverable and the agent can still reference quote items.
        const fullEmailBlock = isDraftAsk
          ? buildDraftReplyEmailContext(effectiveContext)
          : buildRequestedQuoteEmailContext(effectiveContext);
        if (fullEmailBlock) {
          textToSend = `${fullEmailBlock}\n\n${textToSend}`;
        } else if (isDraftAsk) {
          // Same '[User asked to draft a reply' marker prefix as the full banner —
          // the worker classifier keys on it to force the email toolset.
          textToSend = `[User asked to draft a reply, but the extension could not read the visible thread text. Fetch the thread with gmail_search_messages / gmail_read_thread before drafting, and tell the user if there is context you could not see.]\n\n${textToSend}`;
        } else {
          textToSend = `[User explicitly asked to generate a quote from the current email, but the extension could not read visible thread body text. Ask the user to open/expand the Gmail thread or paste the requested items before creating the quote.]\n\n${textToSend}`;
        }
      }

      // ── Fail-closed guard ─────────────────────────────────────────────
      //
      // If the active tab URL is a record page AND the outgoing hint does
      // not mention that record id, something went wrong (primary was
      // overridden or resolution failed). Abort rather than send a
      // request that might target a stale/wrong record.
      if (activeUrlInfo?.isRecord
          && !textToSend.includes(activeUrlInfo.recordId)
          // Only enforce when no user-pinned non-Account record is the
          // explicit winner — the user can deliberately target a
          // different record by pinning it.
          && !(manualRecord && !pinnedIsAccount)) {
        setError(
          `Active Zoho page (${activeUrlInfo.module} ${activeUrlInfo.recordId}) did not reach the outgoing request. Refusing to send to avoid targeting a stale record. Please retry — the extension will re-read the active page.`
        );
        return;
      }

      // ── Structured context flags passed to the worker ─────────────────
      //
      // `source: 'chat-tab'` tells /api/chat-waterfall to SKIP the Tier 0
      // deterministic engine pre-check — URL quotes live in the Quote tab,
      // Chat tab quote requests always go through Zoho.
      //
      // `pinnedAccount` — resolved Account id (skips the 4-tier account
      // waterfall on the worker side).
      //
      // `activeZohoRecord` — structured representation of the primary
      // record so the worker doesn't have to parse natural language to
      // know which record to target. Includes a `source` tag so the
      // worker can tell whether the user is looking at it ('active-tab')
      // vs. explicitly pinned it ('pinned').
      const pinnedAccountPayload = (() => {
        // Always emit a uniform { id, name, module: 'Accounts' } payload.
        //
        // The `module` is hardcoded to 'Accounts' because `id` is always an
        // Account id in every branch below — even when sourced from a Quote/
        // Deal/Contact's parent reference. (Previous version leaked the
        // parent record's module through, which was a payload-contract
        // footgun for the worker.)

        // 1. User explicitly pinned an Account → that Account is the pin.
        if (pinnedIsAccount && manualRecord) {
          return {
            id: manualRecord.recordId,
            name: manualRecord.recordName || manualRecord.accountName || null,
            module: 'Accounts',
          };
        }
        // 2. Primary record IS an Account (active page is an Account, no
        //    pinned non-Account record overriding it).
        if (primaryRecord && primaryRecord.module === 'Accounts') {
          return {
            id: primaryRecord.recordId,
            name: primaryRecord.recordName || primaryRecord.accountName || null,
            module: 'Accounts',
          };
        }
        // 3. Primary record is a Quote/Deal/Contact whose parent Account
        //    we captured (accountId/accountName from the record page).
        if (primaryRecord && primaryRecord.accountId) {
          return {
            id: primaryRecord.accountId,
            name: primaryRecord.accountName || null,
            module: 'Accounts',
          };
        }
        return null;
      })();

      const activeRecordPayload = (() => {
        if (!primaryRecord || !primaryRecord.recordId) return null;
        const explicitlyPinned = primaryRecord === manualRecord;
        return {
          module: primaryRecord.module,
          recordId: primaryRecord.recordId,
          recordName: primaryRecord.recordName || null,
          accountId: primaryRecord.accountId || null,
          accountName: primaryRecord.accountName || null,
          email: primaryRecord.email || null,
          url: primaryRecord.url || null,
          source: explicitlyPinned ? 'pinned' : 'active-tab',
        };
      })();

      effectiveContext = {
        ...(effectiveContext || {}),
        source: 'chat-tab',
        ...(pinnedAccountPayload ? { pinnedAccount: pinnedAccountPayload } : {}),
        ...(activeRecordPayload ? { activeZohoRecord: activeRecordPayload } : {}),
      };

      // ── Progress tracking ────────────────────────────────────────────
      const progressId = `p_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      setProgressSteps([]);

      // Clear any prior interval (defensive — shouldn't happen, but safe)
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }

      progressIntervalRef.current = setInterval(async () => {
        if (thisAbort.aborted) {
          if (progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
          return;
        }
        try {
          const progress = await sendToBackground(MSG.CHAT_PROGRESS, { progressId });
          if (progress && Array.isArray(progress.steps)) {
            setProgressSteps(progress.steps);
          }
          if (progress?.status === 'complete' && progressIntervalRef.current) {
            clearInterval(progressIntervalRef.current);
            progressIntervalRef.current = null;
          }
        } catch (_) { /* ignore poll failures */ }
      }, 1000);

      const response = await sendToBackground(MSG.CHAT_HANDOFF, {
        text: textToSend,
        emailContext: effectiveContext,
        history: historyForApi,
        // Page-type-gated: buildSystemContext stays empty when the user
        // isn't on Gmail, so a stale email never gets baked into the
        // system prompt for a Zoho-tab request.
        systemContext: buildSystemContext(gatedEmailContext, selectedContextEmail === '__none__' ? null : selectedContextEmail),
        progressId,
      });

      if (thisAbort.aborted) return; // Stopped by user

      if (response && response.success && response.reply) {
        const assistantMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: response.reply,
          usedTools: response.usedTools || false,
          // Clickable confirmation chips emitted by the worker (license term,
          // SKU fix, which-deal, …). Absent on older replies => no chips.
          suggestions: response.suggestions || null,
          timestamp: new Date().toISOString(),
        };
        onMessagesChange([...updatedMessages, assistantMsg]);
      } else if (response && response.error) {
        setError(response.error);
      } else {
        setError('No response from Claude');
      }
    } catch (err) {
      if (!thisAbort.aborted) {
        setError(err.message || 'Failed to send message');
      }
    } finally {
      // Always clean up progress polling when the request ends
      if (progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
      if (!thisAbort.aborted) {
        setLoading(false);
        // Clear progress steps after a short delay so the user can see the
        // final state briefly before it disappears
        setTimeout(() => setProgressSteps([]), 1500);
      }
    }
  }, [input, loading, messages, emailContext, onMessagesChange, zohoPageContext, manualRecord, selectedContextEmail, participantOptions]);

  // ─────────────────────────────────────────────
  // Consolidated quoting + email actions (from the former Quote / Email tabs)
  // ─────────────────────────────────────────────
  const nextId = () => Date.now() + Math.floor(Math.random() * 1000);
  const appendMessage = (msg) => onMessagesChange((prev) => [...(prev || []), msg]);
  const updateMessage = (id, patch) =>
    onMessagesChange((prev) => (prev || []).map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const infoMsg = (text) => ({ id: nextId(), role: 'assistant', content: text, timestamp: new Date().toISOString() });

  // Run the deterministic engine for free-text SKUs and push a quote card.
  async function runAndPushQuote(skuText, { pushUser = true } = {}) {
    const text = (skuText || '').trim();
    if (!text || loading) return;
    lastSendRef.current = Date.now();
    if (pushUser) appendMessage({ id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString() });
    setLoading(true);
    setError(null);
    const { result, error } = await runQuote(text, personIdRef.current);
    setLoading(false);
    if (error) { appendMessage(infoMsg(`⚠️ ${error}`)); return; }
    appendMessage({ id: nextId(), role: 'assistant', kind: 'quote', result, skuText: text, timestamp: new Date().toISOString() });
  }

  // Apply / stack a "did you mean?" suggestion: re-quote and replace the card.
  async function handleQuoteSuggestion(msg, suggestion, mode) {
    if (loading) return;
    const base = msg.skuText || '';
    const replacement = suggestion.suggest && suggestion.suggest[0];
    if (!replacement) return;
    let newText;
    if (mode === 'apply') {
      const escaped = String(suggestion.input).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped + '(?![A-Z0-9-])', 'gi');
      newText = base.replace(re, replacement);
      if (newText === base) newText = replacement;
    } else {
      newText = base.trim() ? `${base.trim()}, ${replacement}` : replacement;
    }
    updateMessage(msg.id, { busy: true });
    setLoading(true);
    setError(null);
    const { result, error } = await runQuote(newText, personIdRef.current);
    setLoading(false);
    if (error) { updateMessage(msg.id, { busy: false }); appendMessage(infoMsg(`⚠️ ${error}`)); return; }
    updateMessage(msg.id, { result, skuText: newText, busy: false });
  }

  // Vision: parse a screenshot/dashboard image into SKUs and quote them.
  async function handleImageQuote(imageUrl, imageBase64) {
    if (loading) return;
    setLoading(true);
    setError(null);
    const out = await analyzeImage(imageUrl, imageBase64);
    if (out.error) { setLoading(false); appendMessage(infoMsg(`⚠️ ${out.error}`)); return; }
    if (out.kind === 'message') { setLoading(false); appendMessage(infoMsg(out.note)); return; }
    if (out.kind === 'result') {
      setLoading(false);
      appendMessage({ id: nextId(), role: 'assistant', kind: 'quote', result: out.result, note: out.note, eolMapping: out.eolMapping, skuText: (out.detectedSkus || []).join(', '), timestamp: new Date().toISOString() });
      return;
    }
    // kind === 'skus' → run the deterministic engine on the detected SKUs.
    const { result, error } = await runQuote(out.skuText, personIdRef.current);
    setLoading(false);
    if (error) { appendMessage(infoMsg(`⚠️ ${error}`)); return; }
    appendMessage({ id: nextId(), role: 'assistant', kind: 'quote', result, note: out.note, eolMapping: out.eolMapping, skuText: out.skuText, timestamp: new Date().toISOString() });
  }

  async function handleCaptureScreenshot() {
    if (loading) return;
    try {
      const cap = await sendToBackground(MSG.CAPTURE_TAB, {});
      if (!cap || !cap.success) throw new Error(cap?.error || 'Screenshot capture failed');
      await handleImageQuote(null, cap.base64);
    } catch (err) {
      appendMessage(infoMsg('⚠️ Screenshot capture failed: ' + (err?.message || err)));
    }
  }

  // Upload or paste an image (e.g. a dashboard that arrived as an email
  // attachment, or a screenshot copied to the clipboard) → parse SKUs → quote,
  // same pipeline as the capture button.
  function handleImageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      appendMessage(infoMsg("That doesn't look like an image file. Use a PNG/JPG of the dashboard."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
      if (base64) handleImageQuote(null, base64);
    };
    reader.onerror = () => appendMessage(infoMsg('⚠️ Could not read that image file.'));
    reader.readAsDataURL(file);
  }

  // Paste an image straight into the chat input (Cmd/Ctrl-V) to quote it.
  function handlePasteImage(e) {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (const it of items) {
      if (it.type && it.type.startsWith('image/')) {
        const file = it.getAsFile();
        if (file) { e.preventDefault(); handleImageFile(file); return; }
      }
    }
  }

  // Draft a reply to the current Gmail thread. Any text in the input box is
  // used as optional instructions. Output gets a Copy button.
  async function handleDraftReply() {
    if (loading) return;
    if (!emailContext) { appendMessage(infoMsg('Open an email thread in Gmail, then use "Reply to email".')); return; }
    const instructions = input.trim();
    setLoading(true);
    setError(null);
    try {
      // Address the reply to the person being replied to, never to ourselves.
      // Prefer the participant the user selected; else the detected inbound sender
      // IF it is external. If neither yields an external correspondent (the
      // detected sender is our own @stratusinfosystems.com address, or extraction
      // failed), send NO sender and let the worker's ADDRESSING guard infer the
      // correct external recipient from the thread. Never pass our own address as
      // the person being greeted, and do not guess a wrong external contact.
      const isStratus = (e) => (e || '').toLowerCase().includes('@stratusinfosystems.com');
      const picked = participantOptions.find((p) => p.email === selectedContextEmail);
      let recName = '';
      let recEmail = '';
      if (picked && !isStratus(picked.email)) {
        recName = picked.name || picked.email;
        recEmail = picked.email;
      } else if (emailContext.senderEmail && !isStratus(emailContext.senderEmail)) {
        recName = emailContext.senderName || emailContext.senderEmail;
        recEmail = emailContext.senderEmail;
      }
      const result = await sendToBackground(MSG.DRAFT_REPLY, {
        subject: emailContext.subject,
        body: emailContext.body,
        senderEmail: recEmail,
        senderName: recName,
        tone: 'professional',
        instructions,
      });
      const drafts = (result && result.drafts) || (result && result.draft ? [result.draft] : []);
      if (!drafts.length) {
        appendMessage(infoMsg('No draft generated. Try again, or add instructions in the input box first.'));
      } else {
        if (instructions) setInput('');
        drafts.forEach((d, i) => appendMessage({
          id: nextId() + i,
          role: 'assistant',
          kind: 'draft',
          content: typeof d === 'string' ? d : (d.body || d.text || ''),
          label: drafts.length > 1 ? `Draft option ${i + 1}` : 'Draft reply',
          timestamp: new Date().toISOString(),
        }));
      }
    } catch (err) {
      appendMessage(infoMsg('⚠️ Draft failed: ' + (err?.message || err)));
    } finally {
      setLoading(false);
    }
  }

  // Analyze the current Gmail thread (summary / urgency / action items / SKUs).
  async function handleAnalyzeEmail() {
    if (loading) return;
    if (!emailContext) { appendMessage(infoMsg('Open an email in Gmail, then use "Analyze email".')); return; }
    setLoading(true);
    setError(null);
    try {
      const analysis = await sendToBackground(MSG.ANALYZE_EMAIL, {
        subject: emailContext.subject,
        body: emailContext.body,
        senderEmail: emailContext.senderEmail,
        senderName: emailContext.senderName,
      });
      if (!analysis || (!analysis.summary && !analysis.actionItems?.length && !analysis.detectedSkus?.length)) {
        appendMessage(infoMsg('No analysis returned for this email.'));
      } else {
        appendMessage({ id: nextId(), role: 'assistant', kind: 'analysis', analysis, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      appendMessage(infoMsg('⚠️ Analysis failed: ' + (err?.message || err)));
    } finally {
      setLoading(false);
    }
  }

  // Hand a finished ecomm quote to the CRM agent to create a Zoho quote.
  // selectedUrlIdx is the term the user copied/opened in the card.
  function handleSendQuoteToZoho(result, selectedUrlIdx = 0) {
    const { orderUrl, skuSummary } = orderSummaryFromResult(result, selectedUrlIdx);
    let text = 'Create a Zoho CRM quote from this Stratus quote';
    if (orderUrl) text += `: ${orderUrl}`;
    if (skuSummary) text += `\nLine items: ${skuSummary}`;
    handleSendMessage(text);
  }

  // Send dispatcher: route obvious ecomm-quote asks to the deterministic
  // engine; everything else goes to the CRM chat agent.
  function handleSend(overrideText) {
    const text = overrideText || input.trim();
    if (!text || loading) return;
    const hasPriorQuote = (messages || []).some((m) => m.kind === 'quote');
    if (isEcommQuoteRequest(text) || (hasPriorQuote && isQuoteFollowUp(text))) {
      if (!overrideText) setInput('');
      runAndPushQuote(text);
    } else {
      handleSendMessage(overrideText);
    }
  }

  // ── Manual CRM search (inside context dropdown) ──
  const handleCrmSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults(null);
    try {
      const result = await sendToBackground(MSG.CRM_SEARCH, {
        query: q,
        module: searchModule,
      });
      setSearchResults(result);
    } catch (err) {
      setSearchError(err?.message || 'Search failed');
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, searchModule]);

  // Pin a result from the search as the active CRM record for this chat
  const handlePinRecord = useCallback((record, mod) => {
    if (!record || !record.id) return;
    // Normalize module: backend uses "Deals" but Zoho URL tab is "Potentials"
    // We preserve the search module so URLs resolve correctly
    const getV = (obj) => {
      if (obj == null) return null;
      if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
      if (typeof obj === 'object' && obj.name) return obj.name;
      return null;
    };
    // Zoho returns lookup fields like Account_Name as {id, name} objects.
    // Capture the id so we can pass pinnedAccount.id to the worker and skip
    // the account resolution waterfall entirely.
    const getId = (obj) => {
      if (obj && typeof obj === 'object' && obj.id) return String(obj.id);
      return null;
    };
    let recordName = null;
    let accountName = null;
    let accountId = null;
    let email = null;
    if (mod === 'Accounts') {
      recordName = getV(record.name) || getV(record.Account_Name);
      accountName = recordName;
      accountId = record.id; // the record IS the account
    } else if (mod === 'Contacts') {
      const fn = getV(record.First_Name) || '';
      const ln = getV(record.Last_Name) || '';
      recordName = `${fn} ${ln}`.trim() || null;
      accountName = getV(record.Account_Name);
      accountId = getId(record.Account_Name);
      email = getV(record.Email);
    } else if (mod === 'Deals') {
      recordName = getV(record.Deal_Name);
      accountName = getV(record.Account_Name);
      accountId = getId(record.Account_Name);
    } else if (mod === 'Quotes') {
      const subject = getV(record.Subject);
      const quoteNum = getV(record.Quote_Number);
      recordName = quoteNum ? `${subject || 'Quote'} #${quoteNum}` : subject;
      accountName = getV(record.Account_Name);
      accountId = getId(record.Account_Name);
    }
    setManualRecord({
      module: mod,
      recordId: record.id,
      recordName: recordName || record.id,
      accountName: accountName || null,
      accountId: accountId || null,
      email: email || null,
    });
    // Collapse dropdown + search UI
    setSearchMode(false);
    setSearchResults(null);
    setSearchQuery('');
    setContextDropdownOpen(false);
  }, []);

  const handleClearPinned = useCallback(() => {
    setManualRecord(null);
  }, []);

  const handleStop = useCallback(() => {
    if (abortRef.current) abortRef.current.aborted = true;
    setLoading(false);
    setError(null);
  }, []);

  const handleNewConversation = useCallback(() => {
    if (abortRef.current) abortRef.current.aborted = true;
    personIdRef.current = newQuotePersonId();
    setLoading(false);
    setError(null);
    setInput('');
    onMessagesChange([]);
  }, [onMessagesChange]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const msgList = messages || [];

  const chipStyle = (disabled) => ({
    padding: '5px 10px', background: COLORS.BG_SECONDARY,
    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
    borderRadius: 14, fontSize: 11, fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: COLORS.BG_PRIMARY }}>
      {/* Messages */}
      <div style={{
        flex: 1, overflowY: 'auto', padding: '12px 16px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {msgList.length === 0 && !error && (
          <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: '16px' }}>
            <div style={{ fontSize: 28, marginBottom: 8 }}>💬</div>
            <p style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 16 }}>
              Chat with Stratus AI. Full Zoho CRM access — create deals, quotes, look up accounts, manage tasks.
              Ask for an ecomm quote (e.g. <em>"quote 10 MR44 with 3yr license"</em>) to get 1/3/5-year order links,
              or use the actions below the input to reply to or analyze the open email.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {QUICK_ACTIONS.map((action, i) => (
                <button key={i} onClick={() => handleSend(action.text)}
                  style={{
                    padding: '6px 12px', background: COLORS.STRATUS_LIGHT,
                    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
                    borderRadius: 16, fontSize: 11, fontWeight: 500, cursor: 'pointer',
                  }}>
                  {action.label}
                </button>
              ))}
            </div>
            {/* Context + Zoho-page-context chips are now rendered in the persistent
                bar above the input (see ContextBar below) so they stay visible
                after the first message is sent. */}
          </div>
        )}

        {msgList.map((msg) => {
          // Deterministic ecomm quote card (1/3/5-yr URLs + refresh suggestions)
          if (msg.role === 'assistant' && msg.kind === 'quote') {
            return (
              <div key={msg.id} style={{
                alignSelf: 'stretch', maxWidth: '100%', padding: '10px 12px',
                borderRadius: 8, background: COLORS.BG_SECONDARY, fontSize: 13,
              }}>
                {msg.note && (
                  <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>{msg.note}</div>
                )}
                {msg.eolMapping && msg.eolMapping.length > 0 && (
                  <div style={{
                    marginBottom: 8, padding: 8, background: '#fef7e0',
                    border: '1px solid #fbbc0433', borderRadius: 8,
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: '#e37400', marginBottom: 4 }}>
                      EOL → Replacement
                    </div>
                    {msg.eolMapping.map((line, idx) => (
                      <div key={idx} style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, padding: '1px 0' }}>{line}</div>
                    ))}
                  </div>
                )}
                <QuoteResult
                  result={msg.result}
                  busy={msg.busy}
                  onApplySuggestion={(s) => handleQuoteSuggestion(msg, s, 'apply')}
                  onStackSuggestion={(s) => handleQuoteSuggestion(msg, s, 'stack')}
                  onSendToZoho={handleSendQuoteToZoho}
                />
              </div>
            );
          }
          // Email analysis card
          if (msg.role === 'assistant' && msg.kind === 'analysis') {
            return (
              <div key={msg.id} style={{
                alignSelf: 'stretch', maxWidth: '100%', padding: '10px 12px',
                borderRadius: 8, background: COLORS.BG_SECONDARY,
              }}>
                <EmailAnalysisResult analysis={msg.analysis} onQuoteSkus={(t) => runAndPushQuote(t)} />
              </div>
            );
          }
          // Draft reply (copy-only handoff)
          if (msg.role === 'assistant' && msg.kind === 'draft') {
            return (
              <div key={msg.id} style={{
                alignSelf: 'flex-start', maxWidth: '95%', padding: '8px 12px',
                borderRadius: 8, background: COLORS.BG_SECONDARY, color: COLORS.TEXT_PRIMARY,
                fontSize: 13, lineHeight: 1.5,
              }}>
                <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 4 }}>
                  {msg.label || 'Draft reply'}
                </div>
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                <CopyButton text={msg.content} />
              </div>
            );
          }
          // Default text bubble (user message or CRM-agent reply)
          return (
            <div key={msg.id} style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%', padding: '8px 12px', borderRadius: 8,
              background: msg.role === 'user' ? COLORS.STRATUS_BLUE : COLORS.BG_SECONDARY,
              color: msg.role === 'user' ? 'white' : COLORS.TEXT_PRIMARY,
              fontSize: 13, lineHeight: 1.5, wordWrap: 'break-word',
            }}>
              {msg.role === 'assistant' ? renderMarkdown(msg.content) : msg.content}
              {msg.usedTools && (
                <div style={{ fontSize: 10, color: msg.role === 'user' ? '#ffffff99' : '#7b1fa2', marginTop: 4 }}>
                  Used CRM tools
                </div>
              )}
              {msg.role === 'assistant' && msg.content && <CopyButton text={msg.content} />}
              {msg.role === 'assistant' && (() => {
                const refs = extractZohoQuoteRefs(msg.content);
                if (!refs.length) return null;
                // One labeled button per quote — a 2-quote message (3yr + 5yr
                // options) renders "⬇ 3-Year PDF" and "⬇ 5-Year PDF" instead of
                // a single ambiguous button bound to the first link.
                return refs.map((ref, i) => (
                  <QuotePdfButton
                    key={ref.recordId}
                    recordId={ref.recordId}
                    org={ref.org}
                    label={ref.label || (refs.length > 1 ? `Quote ${i + 1}` : null)}
                  />
                ));
              })()}
              {msg.role === 'assistant' && msg.suggestions && (
                <SuggestionChips
                  suggestions={msg.suggestions}
                  onPick={(send) => handleSendMessage(send, { bypassRateLimit: true })}
                  disabled={loading}
                />
              )}
            </div>
          );
        })}

        {loading && (
          <div style={{
            alignSelf: 'flex-start', maxWidth: '95%',
            padding: '10px 14px',
            background: COLORS.BG_SECONDARY, borderRadius: 8,
            color: COLORS.TEXT_SECONDARY, fontSize: 13,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>●●●</span>
              <span style={{ fontSize: 11 }}>
                {progressSteps.length > 0
                  ? progressSteps[progressSteps.length - 1].message
                  : 'Working...'}
              </span>
              <button onClick={handleStop} style={{
                marginLeft: 4, padding: '2px 8px',
                background: '#fce8e6', color: COLORS.ERROR,
                border: `1px solid ${COLORS.ERROR}44`, borderRadius: 4,
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}>
                Stop
              </button>
            </div>
            {/* Prior steps rendered as a compact history below the current one */}
            {progressSteps.length > 1 && (
              <div style={{
                marginTop: 8, paddingTop: 8,
                borderTop: `1px solid ${COLORS.BORDER}`,
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                {progressSteps.slice(0, -1).map((step, idx) => (
                  <div key={idx} style={{
                    fontSize: 10, color: COLORS.TEXT_SECONDARY,
                    opacity: 0.75, lineHeight: 1.4,
                  }}>
                    <span style={{ marginRight: 6 }}>✓</span>{step.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {error && (
          <div style={{
            alignSelf: 'flex-start', maxWidth: '85%',
            padding: '8px 12px', borderRadius: 8,
            background: '#fce8e6', color: COLORS.ERROR, fontSize: 12, lineHeight: 1.4,
          }}>
            {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Persistent Context Bar — always visible so Chris can change the
          Related Record (thread participant, Zoho page, or manually-searched
          record) at any point in the conversation, not just the first message. */}
      <div style={{ borderTop: `1px solid ${COLORS.BORDER}`, padding: '8px 16px 0 16px', background: COLORS.BG_PRIMARY, position: 'relative' }}>
        {/* Summary of what's currently driving CRM context */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={(e) => { e.stopPropagation(); setContextDropdownOpen(v => !v); if (!contextDropdownOpen) { setSearchMode(false); } }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px',
              background: (manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_LIGHT : COLORS.BG_SECONDARY,
              border: `1px solid ${(manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_BLUE + '55' : COLORS.BORDER}`,
              borderRadius: 6, fontSize: 11,
              color: (manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
              cursor: 'pointer', width: '100%', textAlign: 'left',
            }}
            title="Change which record or contact is attached as CRM context for this chat"
          >
            <span style={{ opacity: 0.75 }}>
              {manualRecord ? '📌' : (zohoPageContext && zohoPageContext.recordId ? '📄' : '📎')}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {(() => {
                const MOD = {Quotes:'Quote',Potentials:'Deal',Deals:'Deal',Accounts:'Account',Contacts:'Contact',Tasks:'Task',SalesOrders:'Sales Order',Invoices:'Invoice'};
                const active = (zohoPageContext && zohoPageContext.recordId) ? zohoPageContext : null;
                const pinnedAccount = manualRecord && manualRecord.module === 'Accounts' ? manualRecord : null;
                const pinnedOther = manualRecord && manualRecord.module !== 'Accounts' ? manualRecord : null;
                // User explicitly pinned a non-Account record — that wins.
                if (pinnedOther) {
                  const m = MOD[pinnedOther.module] || pinnedOther.module;
                  return `${m}: ${pinnedOther.recordName || pinnedOther.recordId}`;
                }
                // Active non-Account record + pinned Account supplement — show BOTH so the
                // user never sees their active Quote get hidden by a pinned Account.
                if (active && active.module !== 'Accounts' && pinnedAccount) {
                  const m = MOD[active.module] || active.module;
                  return `Viewing ${m}: ${active.recordName || active.recordId}  •  Pinned Acct: ${pinnedAccount.recordName || pinnedAccount.recordId}`;
                }
                if (active) {
                  const m = MOD[active.module] || active.module;
                  return `Viewing ${m}: ${active.recordName || active.recordId}`;
                }
                if (pinnedAccount) {
                  return `Account: ${pinnedAccount.recordName || pinnedAccount.recordId}`;
                }
                if (activeContextEmail) {
                  return `Contact: ${activeContact?.name || activeContextEmail}`;
                }
                return 'No CRM context — click to pick a record';
              })()}
            </span>
            {manualRecord && (
              <span
                onClick={(e) => { e.stopPropagation(); handleClearPinned(); }}
                style={{ fontSize: 11, opacity: 0.7, padding: '0 4px', cursor: 'pointer' }}
                title="Unpin this record"
              >
                ✕
              </span>
            )}
            <span style={{ opacity: 0.6, fontSize: 9 }}>▼</span>
          </button>
          {contextDropdownOpen && (
            <div onClick={(e) => e.stopPropagation()} style={{
              position: 'absolute', bottom: '100%', left: 0, right: 0,
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6, boxShadow: '0 -4px 12px rgba(0,0,0,0.12)',
              zIndex: 999, overflow: 'hidden', marginBottom: 4,
              maxHeight: 360, overflowY: 'auto',
            }}>
              {!searchMode ? (
                <div style={{ padding: '4px 0' }}>
                  {/* No context option */}
                  <button
                    onClick={() => { setSelectedContextEmail('__none__'); setManualRecord(null); setContextDropdownOpen(false); }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '6px 12px',
                      background: (selectedContextEmail === '__none__' && !manualRecord) ? COLORS.BG_SECONDARY : 'transparent',
                      border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.TEXT_SECONDARY,
                    }}
                  >
                    No context (general chat)
                  </button>

                  {/* Current Zoho page record — click to pin it explicitly */}
                  {zohoPageContext && zohoPageContext.recordId && (
                    <>
                      <div style={{ padding: '4px 12px 2px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.TEXT_SECONDARY, opacity: 0.7 }}>
                        Current Zoho Page
                      </div>
                      <button
                        onClick={() => {
                          setManualRecord({
                            module: zohoPageContext.module,
                            recordId: zohoPageContext.recordId,
                            recordName: zohoPageContext.recordName,
                            accountName: zohoPageContext.accountName,
                            // If the current page IS an Account, the recordId is the accountId.
                            // Otherwise preserve any accountId the page context captured.
                            accountId: zohoPageContext.module === 'Accounts'
                              ? zohoPageContext.recordId
                              : (zohoPageContext.accountId || null),
                            email: zohoPageContext.email,
                          });
                          setContextDropdownOpen(false);
                        }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '6px 12px', background: 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.TEXT_PRIMARY,
                        }}
                      >
                        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          📄 {({Quotes:'Quote',Potentials:'Deal',Deals:'Deal',Accounts:'Account',Contacts:'Contact',Tasks:'Task',SalesOrders:'Sales Order',Invoices:'Invoice'}[zohoPageContext.module] || zohoPageContext.module)}
                        </div>
                        <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {zohoPageContext.recordName || zohoPageContext.recordId}
                        </div>
                      </button>
                    </>
                  )}

                  {/* Email thread participants */}
                  {participantOptions.length > 0 && (
                    <>
                      <div style={{ padding: '6px 12px 2px', fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.5, color: COLORS.TEXT_SECONDARY, opacity: 0.7 }}>
                        Thread Participants
                      </div>
                      {participantOptions.map((p) => (
                        <button
                          key={p.email}
                          onClick={() => { setSelectedContextEmail(p.email); setManualRecord(null); setContextDropdownOpen(false); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '6px 12px',
                            background: (!manualRecord && (selectedContextEmail === p.email || (!selectedContextEmail && p.email === emailContext?.customerEmail))) ? COLORS.STRATUS_LIGHT : 'transparent',
                            border: 'none', cursor: 'pointer', fontSize: 11,
                            color: COLORS.TEXT_PRIMARY,
                          }}
                        >
                          <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name || p.email}
                          </div>
                          {p.name && (
                            <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {p.email}
                            </div>
                          )}
                          {p.role && (
                            <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 10, textTransform: 'capitalize' }}>{p.role}</div>
                          )}
                        </button>
                      ))}
                    </>
                  )}

                  {/* Open the inline CRM search */}
                  <div style={{ borderTop: `1px solid ${COLORS.BORDER}`, marginTop: 4 }}>
                    <button
                      onClick={() => { setSearchMode(true); setSearchResults(null); setSearchError(null); }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '8px 12px', background: 'transparent',
                        border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.STRATUS_BLUE, fontWeight: 600,
                      }}
                    >
                      🔍 Search CRM for Account, Contact, Deal, Quote...
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ padding: '8px 10px' }}>
                  {/* Search header + back */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <button
                      onClick={() => { setSearchMode(false); setSearchResults(null); setSearchError(null); }}
                      style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        fontSize: 11, color: COLORS.TEXT_SECONDARY, padding: '2px 4px',
                      }}
                      title="Back to context list"
                    >
                      ← Back
                    </button>
                    <span style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
                      Search Zoho CRM
                    </span>
                  </div>

                  {/* Module selector */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    {['Accounts', 'Contacts', 'Deals', 'Quotes'].map(m => (
                      <button
                        key={m}
                        onClick={() => { setSearchModule(m); setSearchResults(null); }}
                        style={{
                          flex: 1, padding: '4px 0', fontSize: 10, fontWeight: 600,
                          background: searchModule === m ? COLORS.STRATUS_BLUE : COLORS.BG_SECONDARY,
                          color: searchModule === m ? 'white' : COLORS.TEXT_SECONDARY,
                          border: `1px solid ${searchModule === m ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
                          borderRadius: 4, cursor: 'pointer',
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {/* Search input */}
                  <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleCrmSearch(); }}
                      autoFocus
                      placeholder={`Search ${searchModule.toLowerCase()}...`}
                      style={{
                        flex: 1, padding: '5px 8px',
                        border: `1px solid ${COLORS.BORDER}`, borderRadius: 4,
                        fontSize: 11, color: COLORS.TEXT_PRIMARY, backgroundColor: COLORS.BG_PRIMARY,
                        outline: 'none',
                      }}
                    />
                    <button
                      onClick={handleCrmSearch}
                      disabled={!searchQuery.trim() || searchLoading}
                      style={{
                        padding: '5px 10px',
                        background: !searchQuery.trim() || searchLoading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
                        color: 'white', border: 'none', borderRadius: 4, fontSize: 11, fontWeight: 600,
                        cursor: !searchQuery.trim() || searchLoading ? 'not-allowed' : 'pointer',
                        opacity: !searchQuery.trim() || searchLoading ? 0.5 : 1,
                      }}
                    >
                      {searchLoading ? '...' : 'Go'}
                    </button>
                  </div>

                  {searchError && (
                    <div style={{
                      padding: '6px 8px', background: '#fce8e6', color: COLORS.ERROR,
                      fontSize: 11, borderRadius: 4, marginBottom: 6,
                    }}>
                      {searchError}
                    </div>
                  )}

                  {/* Results */}
                  {searchResults && (() => {
                    const recs = searchResults.results || searchResults.records || [];
                    if (!recs.length) {
                      return (
                        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, padding: '8px 4px', textAlign: 'center' }}>
                          No {searchModule.toLowerCase()} found for "{searchQuery}".
                        </div>
                      );
                    }
                    const getV = (obj) => {
                      if (obj == null) return null;
                      if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
                      if (typeof obj === 'object' && obj.name) return obj.name;
                      return null;
                    };
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 220, overflowY: 'auto' }}>
                        {recs.slice(0, 20).map((r, idx) => {
                          let title = 'Unnamed';
                          let subtitle = '';
                          let meta = '';
                          if (searchModule === 'Accounts') {
                            title = getV(r.name) || getV(r.Account_Name) || 'Unnamed Account';
                            const city = getV(r.billingCity) || getV(r.Billing_City);
                            const state = getV(r.billingState) || getV(r.Billing_State);
                            subtitle = getV(r.website) || getV(r.Website) || '';
                            meta = [city, state].filter(Boolean).join(', ');
                          } else if (searchModule === 'Contacts') {
                            const fn = getV(r.First_Name) || '';
                            const ln = getV(r.Last_Name) || '';
                            title = `${fn} ${ln}`.trim() || 'Unnamed Contact';
                            subtitle = getV(r.Email) || '';
                            meta = getV(r.Account_Name) || '';
                          } else if (searchModule === 'Deals') {
                            title = getV(r.Deal_Name) || 'Unnamed Deal';
                            subtitle = getV(r.Account_Name) || '';
                            const stage = getV(r.Stage);
                            const amount = getV(r.Amount);
                            meta = [stage, amount ? `$${Number(amount).toLocaleString()}` : null].filter(Boolean).join(' • ');
                          } else if (searchModule === 'Quotes') {
                            title = getV(r.Subject) || 'Unnamed Quote';
                            const qn = getV(r.Quote_Number);
                            subtitle = qn ? `#${qn}` : '';
                            const total = getV(r.Grand_Total);
                            meta = [getV(r.Deal_Name), total ? `$${Number(total).toLocaleString()}` : null].filter(Boolean).join(' • ');
                          }
                          return (
                            <button
                              key={idx}
                              onClick={() => handlePinRecord(r, searchModule)}
                              style={{
                                display: 'block', width: '100%', textAlign: 'left',
                                padding: '6px 8px', background: COLORS.BG_SECONDARY,
                                border: `1px solid ${COLORS.BORDER}`, borderRadius: 4,
                                cursor: 'pointer', fontSize: 11, color: COLORS.TEXT_PRIMARY,
                              }}
                              onMouseEnter={(e) => { e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE; }}
                              onMouseLeave={(e) => { e.currentTarget.style.borderColor = COLORS.BORDER; }}
                            >
                              <div style={{ fontWeight: 600, color: COLORS.STRATUS_BLUE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {title}
                              </div>
                              {subtitle && (
                                <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {subtitle}
                                </div>
                              )}
                              {meta && (
                                <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {meta}
                                </div>
                              )}
                            </button>
                          );
                        })}
                        {recs.length > 20 && (
                          <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, textAlign: 'center', padding: '4px 0' }}>
                            Showing first 20 of {recs.length} — refine search for more.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Input Area */}
      <div style={{ padding: '8px 16px 10px 16px', background: COLORS.BG_PRIMARY }}>
        {/* Top action row */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY }}>
            {msgList.length > 0 ? `${msgList.length} message${msgList.length !== 1 ? 's' : ''}` : ''}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {loading && (
              <button onClick={handleStop} style={{
                background: '#fce8e6', border: `1px solid ${COLORS.ERROR}44`,
                color: COLORS.ERROR, borderRadius: 4, padding: '3px 8px',
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}>
                ⏹ Stop
              </button>
            )}
            <button onClick={handleNewConversation} style={{
              background: 'none', border: `1px solid ${COLORS.BORDER}`,
              color: COLORS.TEXT_SECONDARY, borderRadius: 4, padding: '3px 8px',
              fontSize: 11, cursor: 'pointer',
            }}
            title="Start new conversation (clears history)">
              🔄 New Chat
            </button>
          </div>
        </div>

        {/* Consolidated quick actions: screenshot quote + email reply/analyze */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 6 }}>
          <button onClick={handleCaptureScreenshot} disabled={loading} style={chipStyle(loading)}
            title="Capture the visible browser tab and quote the SKUs shown in it">
            📷 Screenshot quote
          </button>
          <button onClick={() => fileInputRef.current && fileInputRef.current.click()} disabled={loading} style={chipStyle(loading)}
            title="Upload or paste a dashboard image (use this when it's an email attachment, not shown on screen)">
            🖼️ Upload image
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) handleImageFile(f); e.target.value = ''; }}
          />
          {emailContext && (
            <button onClick={handleDraftReply} disabled={loading} style={chipStyle(loading)}
              title="Draft a reply to the open email (uses input box text as instructions)">
              ✉️ Reply to email
            </button>
          )}
          {emailContext && (
            <button onClick={handleAnalyzeEmail} disabled={loading} style={chipStyle(loading)}
              title="Analyze the open email">
              🔎 Analyze email
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            onPaste={handlePasteImage}
            placeholder={loading ? 'Working on it...' : 'Ask, quote SKUs, or paste a dashboard image...'}
            disabled={loading}
            style={{
              flex: 1, padding: '8px 12px', border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'none',
              height: 40, color: COLORS.TEXT_PRIMARY, backgroundColor: COLORS.BG_PRIMARY,
              opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'text', outline: 'none',
            }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || loading}
            style={{
              padding: '8px 16px',
              background: !input.trim() || loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
              color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
              cursor: !input.trim() || loading ? 'not-allowed' : 'pointer',
              opacity: !input.trim() || loading ? 0.5 : 1,
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
