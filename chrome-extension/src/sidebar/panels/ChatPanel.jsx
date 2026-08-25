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
import {
  contextLockLabel,
  effectivePinnedZohoRecord,
  hasEffectiveZohoRecord,
  lockedEmailBodyUnavailable,
  resolveLockedContexts,
  shouldBlockForActiveZohoMismatch,
} from '../../lib/context-lock.mjs';
import QuoteResult from '../components/QuoteResult';
import EmailAnalysisResult from '../components/EmailAnalysisResult';
import SkuQuantityEditor from '../components/SkuQuantityEditor';
import { rebaseQuoteOptionIndexes } from '../components/quote-option-selection.mjs';
import { resolveQuoteVariantCorrection } from '../components/quote-variant-correction.mjs';
import { CrmDeleteControl } from '../components/CrmDeleteControl.jsx';
import {
  applySkuSuggestion,
  blankQuoteEditorRows,
  editableRowsFromResult,
  quoteEditorHasSkuInput,
  quoteEditorRowsFromIntake,
  quoteTextFromEditorRows,
  sameDeviceIdentity,
  splitRowsForTierRequote,
  termFromLicenseRows,
} from '../components/sku-editor-core.mjs';
// Quoting + screenshot parsing routed through the worker API (the same
// deterministic engine the Webex/GChat bots use), consolidated into Chat
// 2026-06-17 when the standalone Quote and Email tabs were removed.
import { runQuote, analyzeImage } from '../../lib/quote-client';
import catalog from '../../lib/auto-catalog.json';
import {
  applyExplicitMxWarmSpareToQuoteOptions,
  bindOneshotQuoteOptions,
  buildOneshotReplanPayload,
  hasExplicitMxHaIntent,
  isProductChangingOneshotOverride,
  nextOneshotQuoteOptionState,
  normalizeHaMode,
  oneshotStopExplanation,
  oneshotContextRefreshOverrides,
  oneshotContextRefreshSummary,
  normalizeEditableQuoteLines,
  normalizeQuoteIntakeLines,
  quoteIntakeTierLabel,
  oneshotHaStateForQuoteOption,
  oneshotProductSnapshotHash,
  quoteOptionTerm,
  quoteSkuTextFromLines,
  sanitizeStratusOrderUrls,
  validateGmailQuoteContext,
  verifyStratusOrderUrlOptions,
  withHardwareOnlyQuoteOption,
  withOneshotAccountDraft,
} from '../../lib/email-quote-flow.mjs';

// Per-tab storage key prefix — must match the background service worker.
// Reading by tab id ensures the chat panel never picks up a different
// tab's Zoho record from the storage fallback.
const ZOHO_CTX_KEY_PREFIX = 'zohoCtx_';
const zohoCtxKey = (tabId) => `${ZOHO_CTX_KEY_PREFIX}${tabId}`;
// The deterministic card-local correction path verifies a proposed full SKU
// before it changes a reviewed row. Only catalog arrays contain sellable SKU
// values; metadata objects such as EOL mappings are deliberately excluded.
const ACTIVE_QUOTE_CATALOG_SKUS = new Set(
  Object.values(catalog)
    .flatMap((value) => Array.isArray(value) ? value : [])
    .map((sku) => String(sku || '').trim().toUpperCase())
    .filter(Boolean),
);

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
        // Bare URL — link with the FULL URL as its own text. No truncation
        // (2026-07-10): quote order URLs encode the SKU list and reps read/copy
        // them from chat; linkStyle's wordBreak:'break-all' wraps them cleanly.
        const url = match[3];
        parts.push(
          <a key={`u-${i}-${match.index}`} href={url} target="_blank" rel="noopener" style={linkStyle}>
            {url}
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
      // Split on **bold**, *bold*, or _italic_ (capture groups preserve the delimiters).
      // Underscores only open/close emphasis at a word boundary, matching CommonMark.
      // Without this, snake_case error codes render as garbled italics — e.g.
      // "product_review_required" displayed as "productreviewrequired".
      const segments = part.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*|(?<![A-Za-z0-9])_[^_\n]+_(?![A-Za-z0-9]))/g);
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

// Copy a draft reply together with the ENGINE-BUILT quote URLs (result.quoteUrls),
// writing text/html so a paste into Gmail compose keeps them as real hyperlinks.
// Port of corp PR #9, hardened in two places the corp version gets wrong:
//   1. both payloads are built BEFORE any clipboard call, so a malformed url can
//      never throw between the rich path and the fallback;
//   2. success is only claimed when a path actually succeeded (the corp version
//      reports "✓ Copied with links" even when every path failed).
function CopyDraftWithLinks({ text, quoteUrls }) {
  const [state, setState] = useState('idle'); // idle | done | failed
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const flash = (next) => { setState(next); setTimeout(() => setState('idle'), 1800); };

  async function copy() {
    const links = (Array.isArray(quoteUrls) ? quoteUrls : [])
      .map((q, i) => ({
        url: typeof q === 'string' ? q : (q && q.url) || '',
        label: (q && q.label) || `Quote ${i + 1}`,
      }))
      .filter((q) => /^https?:\/\//i.test(q.url));
    const plain = links.length
      ? `${text}\n\n${links.map((q) => `${q.label}: ${q.url}`).join('\n')}`
      : text;
    const html = `<div style="white-space:pre-wrap">${esc(text)}</div>`
      + (links.length ? `<div><br>${links.map((q) => `<div><a href="${esc(q.url)}">${esc(q.label)}</a></div>`).join('')}</div>` : '');

    if (navigator.clipboard && navigator.clipboard.write && typeof window.ClipboardItem === 'function') {
      try {
        await navigator.clipboard.write([new window.ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })]);
        flash('done');
        return;
      } catch { /* rich write unavailable or denied — fall through */ }
    }
    try {
      await navigator.clipboard.writeText(plain);
      flash('done');
      return;
    } catch { /* fall through to the legacy path */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = plain;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      flash(ok ? 'done' : 'failed');
    } catch {
      flash('failed');
    }
  }

  return (
    <button
      onClick={copy}
      title="Copy the draft with the engine-built quote links as hyperlinks"
      style={{
        marginTop: 6, background: 'none', border: 'none', padding: 0,
        fontSize: 10, color: COLORS.STRATUS_BLUE, cursor: 'pointer', opacity: 0.8,
      }}
    >
      {state === 'done' ? '✓ Copied with links' : state === 'failed' ? '⚠ Copy failed' : '⧉ Copy with links'}
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
  if (m && m.kind === 'email-quote-intake') {
    return `[Read-only Gmail eCommerce quote intake; no CRM action]\n${quoteSkuTextFromLines(m.intake?.lines || [])}`.trim();
  }
  if (m && m.kind === 'quote-clarification') {
    return `[Dashboard quote blocked pending MX edition]\nDetected rows:\n${m.skuText || ''}\n${m.content || m.note || ''}`.trim();
  }
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
  // This action is intentionally not a chat prompt. It opens the read-only
  // manual eCommerce builder; Gmail parsing is a separate explicit action on
  // that card, and CRM planning remains a separate action after verification.
  { label: 'Create Quote', action: 'manual-ecomm-quote' },
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

// R11 (Chris directive, 2026-07-15): the EXPLICIT ecomm-URL phrasings — the
// ONLY thing that routes to the deterministic ecomm engine while the user has
// an active Zoho record page open. Explicit-ecomm ask beats page context; page
// context beats every other lexical quote heuristic; off-Zoho routing unchanged.
// Mirrors the worker's isExplicitEcommUrlAsk.
function isExplicitEcommUrlAsk(text) {
  const v = (text || '').toLowerCase();
  return /\b(url\s+quote|e-?comm(?:erce)?\s+(?:quote|link|url)|quote\s+(?:link|url)|order\s+(?:link|url)|shopping\s+cart\s+link|stratus\s+url|send\s+me\s+a\s+link)\b/.test(v);
}

// A direct request to make a new quote must never be mistaken for an edit of
// the last card simply because it contains an SKU. This keeps "make a quote
// for 4x MX67" on the normal fresh-quote path, where 4x is a quantity.
function isExplicitNewEcommQuoteRequest(text) {
  const value = String(text || '').trim();
  if (!value || /\b(?:zoho|crm)\b/i.test(value)) return false;
  return /\b(?:create|make|start|prepare|build)\s+(?:(?:a|an|new)\s+)?(?:e-?comm(?:erce)?\s+)?quote\s+(?:for|with)\b/i.test(value)
    || /\bnew\s+(?:e-?comm(?:erce)?\s+)?quote\s+(?:for|with)\b/i.test(value);
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
    || isMxEditionQuoteFollowUp(v)
    || /\b(no\s+licenses?|without\s+licenses?|just\s+(the\s+)?hardware|(remove|drop)\s+(the\s+|all\s+)?licen[sc]es?|take\s+(the\s+)?licen[sc]es?\s+(out|off))\b/.test(v);
}

// A correction belongs to the most recent eCommerce quote, not to the general
// CRM chat agent.  Keep this deliberately bounded: it needs an edit verb plus
// either an exact SKU, a quantity, or a licensing/tier instruction.  Ordinary
// conversational questions remain chat turns.
function isQuoteEditorCorrectionRequest(text) {
  const value = String(text || '').trim();
  if (!value || value.length > 240 || /\b(?:zoho|crm)\b/i.test(value)) return false;
  // Existing MX-edition follow-ups include terse replies such as "ENT instead"
  // that deliberately omit an edit verb.  They still belong to the current
  // reviewable quote card rather than creating a second quote reply.
  if (isMxEditionQuoteFollowUp(value)) return true;
  if (!/\b(?:add|remove|drop|delete|change|update|replace|swap|switch|convert|correct|make|set)\b/i.test(value)) return false;
  SKU_PATTERN.lastIndex = 0;
  const hasSku = SKU_PATTERN.test(value) || /\b(?:MR[-_]ENT|MR\s+Enterprise)\b/i.test(value);
  SKU_PATTERN.lastIndex = 0;
  return hasSku
    || /\b(?:\d+\s*(?:x|×)?\s*(?:license|licen[sc]e|hardware)|enterprise|security|sd[-\s]?wan|advanced|hardware[ -]?only|no\s+licenses?)\b/i.test(value);
}

function isZohoQuoteReviewRequest(text) {
  const value = String(text || '').trim();
  return /\b(?:create|make|start|prepare|build)\s+(?:an?\s+)?(?:zoho|crm)(?:\s+crm)?\s+quote\b/i.test(value)
    || /\b(?:create|make|start|prepare|build)\s+(?:an?\s+)?quote\s+(?:in|on|through)\s+(?:zoho|crm)\b/i.test(value)
    || /\b(?:make|turn|convert)\s+(?:(?:this|it|that)\s+)?into\s+(?:an?\s+)?(?:zoho|crm)(?:\s+crm)?\s+quote\b/i.test(value)
    || /\b(?:create|make|start|prepare|build|turn|convert)\s+(?:this|it|that)\s+(?:an?\s+)?(?:zoho|crm)(?:\s+crm)?\s+quote\b/i.test(value);
}

function requestedQuoteTermYears(text) {
  const match = String(text || '').match(/\b([135])\s*[- ]?year\b/i);
  return match ? Number(match[1]) : null;
}

function isExplicitHardwareOnlyQuoteText(text) {
  return /\b(?:hardware[ -]?only|no\s+licenses?|without\s+licenses?|just\s+(?:the\s+)?hardware)\b/i.test(String(text || ''));
}

const TYPED_HW_ONLY_PHRASE = /\b(?:hardware[ -]?only|hw[ -]?only|no\s+licen[sc]es?|without\s+licen[sc]es?|just\s+(?:the\s+)?hardware)\b/i;

/**
 * True only when the request is hardware-only for the WHOLE cart.
 *
 * The phrase appearing anywhere is not enough. "quote 6 CW9164, 2 MX65 licenses,
 * and 5 MR44 hardware only" is MIXED, and so is the editor's re-serialization of
 * a per-line None ("5 MR44 hardware only\n6 CW9164\n2 MX65"). Treating either as
 * whole-cart discarded a correct six-option quote and replaced it with a single
 * all-hardware link (2026-08-19).
 *
 * Mirrors the worker's own clause rule so the two cannot disagree:
 *   - any surviving licence intent means the cart is mixed;
 *   - a phrase OUTSIDE the item list (before the first SKU or after the last)
 *     covers everything;
 *   - a phrase BETWEEN items belongs to its own clause, unless every SKU clause
 *     carries one.
 */
function isWholeCartHardwareOnlyText(text) {
  const value = String(text || '');
  if (!TYPED_HW_ONLY_PHRASE.test(value)) return false;
  // "2 MX65 licenses" beside a hardware-only line means the cart is mixed.
  const withoutHwPhrases = value.replace(new RegExp(TYPED_HW_ONLY_PHRASE.source, 'gi'), ' ');
  if (/\b(?:licen[sc]es?|licensing|renewals?|renew)\b/i.test(withoutHwPhrases)) return false;

  const MODEL = /\b(?:MX|MS|MR|MV|MT|MG|MA|CW|C8|C9|Z)\d[A-Z0-9-]*/gi;
  const modelPositions = [...value.matchAll(MODEL)].map((m) => m.index);
  if (!modelPositions.length) return false;

  const clauses = value.split(/\n|,|;|\s+and\s+|\s+plus\s+|\s+then\s+/i)
    .map((clause) => clause.trim())
    .filter((clause) => /\b(?:MX|MS|MR|MV|MT|MG|MA|CW|C8|C9|Z)\d/i.test(clause));
  if (clauses.length && clauses.every((clause) => TYPED_HW_ONLY_PHRASE.test(clause))) return true;

  // Positional fallback: a phrase sitting outside the run of models covers them
  // all, which is how a trailing "… 1 MT10 hardware only" reads.
  const phrase = value.match(TYPED_HW_ONLY_PHRASE);
  if (!phrase) return false;
  const phraseAt = phrase.index;
  return phraseAt > Math.max(...modelPositions) || phraseAt < Math.min(...modelPositions);
}

function typedHardwareOnlyResult(result, text) {
  if (!result || !isWholeCartHardwareOnlyText(text)) {
    return result;
  }
  const unresolved = new Set((Array.isArray(result.suggestions) ? result.suggestions : [])
    .map((suggestion) => String(suggestion?.input || '').trim().toUpperCase())
    .filter(Boolean));
  const hardware = (Array.isArray(result.parsed) ? result.parsed : [])
    .map((line) => ({
      sku: String(line?.baseSku || line?.sku || '').trim().toUpperCase(),
      qty: Number(line?.qty || line?.quantity),
    }))
    .filter((line) => line.sku && !unresolved.has(line.sku) && !line.sku.startsWith('LIC-')
      && /^[A-Z0-9][A-Z0-9._/-]{0,63}$/.test(line.sku)
      && Number.isInteger(line.qty) && line.qty > 0 && line.qty <= 99999);
  if (!hardware.length) return result;
  const url = `https://stratusinfosystems.com/order/?item=${hardware.map((line) => line.sku).join(',')}&qty=${hardware.map((line) => line.qty).join(',')}`;
  return {
    ...result,
    urls: [{ label: 'Hardware Only', url, hardwareOnly: true }],
  };
}

function explicitQuoteLicenseTier(text) {
  const value = String(text || '').toUpperCase();
  if (/\b(?:HARDWARE[ -]?ONLY|NO\s+LICEN[SC]ES?|WITHOUT\s+LICEN[SC]ES?|JUST\s+THE\s+HARDWARE)\b/.test(value)) return null;
  // A literal product token such as LIC-ENT-3YR binds only that line. It is
  // not prose authorizing Enterprise for unrelated blank hardware rows.
  const prose = value.replace(/\bLIC-[A-Z0-9-]+\b/g, ' ');
  if (/\b(?:ENTERPRISE|ENT)(?:\s+LICEN[SC](?:E|ING)S?)?\b/.test(prose)) return 'ENT';
  if (/\b(?:SD[ -]?WAN|SDW)(?:\s+PLUS)?\b/.test(prose)) return 'SDW';
  if (/\b(?:ADVANCED\s+SECURITY|SECURITY|SEC)(?:\s+LICEN[SC](?:E|ING)S?)?\b/.test(prose)) return 'SEC';
  if (/\b(?:ADVANCED|ADV)(?:\s+LICEN[SC](?:E|ING)S?|\s+TIER)?\b/.test(prose)) return 'A';
  return null;
}

// Anchored MX edition corrections are safe to keep in the local ecomm quote
// session, including while the sidebar is open on a Zoho record. The prior
// quote card is still required by handleSend, and a later Zoho-quote takeover
// disables this exception.
function isMxEditionQuoteFollowUp(text) {
  const v = String(text || '').trim();
  if (!v || v.length > 80) return false;
  const tier = '(?:ENT(?:ERPRISE)?|SEC(?:URITY)?|ADVANCED\\s+SECURITY|SDW|SD[-\\s]?WAN(?:\\s+PLUS)?)';
  return new RegExp(`^(?:please\\s+)?(?:actually\\s+)?(?:${tier})(?:\\s+(?:instead|please|licenses?))?[.!?]*$`, 'i').test(v)
    || new RegExp(`^(?:please\\s+)?(?:change|swap|switch|convert|correct|make)(?:\\s+(?:it|them|that|this|the\\s+(?:quote|licenses?)))?(?:\\s+from)?\\s+${tier}\\s+(?:to|with)\\s+${tier}(?:\\s+instead)?[.!?]*$`, 'i').test(v)
    || new RegExp(`^(?:please\\s+)?(?:change|swap|switch|convert|correct|make)(?:\\s+(?:it|them|that|this|the\\s+(?:quote|licenses?)))?\\s+(?:to|with)\\s+${tier}(?:\\s+instead)?[.!?]*$`, 'i').test(v);
}

function buildRequestedQuoteEmailContext(emailContext) {
  if (!emailContext) return '';
  const threadText = (emailContext.fullThreadBody || emailContext.body || '').trim();
  // R8b: an order URL found in the thread DOM is enough to proceed even when
  // the visible thread text extraction came back empty.
  if (!threadText && !(Array.isArray(emailContext.threadOrderUrls) && emailContext.threadOrderUrls.length)) return '';
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
  // R8b (corp error_reports 2026-07-14): surface Stratus /order/ links found in
  // the thread DOM. Gmail renders them as anchors whose visible text may be
  // truncated/friendly, so the thread TEXT below often lacks the actual URL —
  // and the worker's parse_quote_url / line-item lock machinery keys on the URL.
  const orderUrls = Array.isArray(emailContext.threadOrderUrls) ? emailContext.threadOrderUrls : [];
  if (orderUrls.length) {
    lines.push(
      '',
      `Stratus ecomm order URL(s) found in this thread — these ARE the requested line items. Resolve exact items and quantities with parse_quote_url on the most recent URL; do NOT re-ask what to quote:`,
      ...orderUrls.map((u) => `- ${u}`)
    );
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

// Parse a stratus /order/ link (item=A,B&qty=1,2) into [{sku, qty}] for the
// one-shot plan payload.
function parseOrderUrlItems(url) {
  const items = ((String(url || '').match(/[?&]item=([^&]*)/) || [])[1] || '')
    .split(',').map(decodeURIComponent).map((s) => s.trim()).filter(Boolean);
  const qtys = ((String(url || '').match(/[?&]qty=([^&]*)/) || [])[1] || '')
    .split(',').map((q) => parseInt(q, 10));
  return items.map((sku, i) => ({ sku, qty: Number.isFinite(qtys[i]) && qtys[i] > 0 ? qtys[i] : 1 }));
}

// ─────────────────────────────────────────────
// One-shot email-intake card (pre-plan stage, 2026-07-31)
// ─────────────────────────────────────────────
// Chips appear ONLY for unresolved fields (edition/term); resolved lines are
// plain text. No Execute exists at this stage — the plan card (with its review
// token) appears only after "Build review", and Execute lives there. Chip
// clicks resolve locally against the returned catalog matrix; nothing
// re-parses the email.
function EmailQuoteIntakeCard({ msg, busy, onUpdate, onRemove, onBuildQuote, onManualSkus }) {
  const [manual, setManual] = useState('');
  const it = msg.intake || {};
  const lines = it.lines || [];
  const allResolved = lines.length > 0 && lines.every((l) => l.status === 'resolved');
  const chip = (sel) => ({
    fontSize: 11, padding: '3px 9px', marginRight: 4, marginBottom: 3, borderRadius: 12,
    cursor: 'pointer', fontWeight: sel ? 700 : 400,
    border: `1px solid ${sel ? '#1a73e8' : 'rgba(0,0,0,0.25)'}`,
    background: sel ? '#e8f0fe' : 'transparent', color: 'inherit',
  });
  const lab = { fontSize: 10, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 2 };
  return (
    <div style={{ alignSelf: 'stretch', maxWidth: '100%', padding: '10px 12px', borderRadius: 8, background: COLORS.BG_SECONDARY, fontSize: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>🛒 eCommerce quote from this Gmail thread</div>
      <div style={{ color: COLORS.TEXT_SECONDARY, marginBottom: 5 }}>
        Read-only preview. Confirm the normalized SKU quantities; pricing is best effort and never blocks the SKU output.
      </div>
      {it.extract_error && (
        <div style={{ color: '#e37400', marginBottom: 4 }}>
          Could not extract products automatically ({it.extract_error}) — enter SKUs below.
        </div>
      )}
      {lines.map((l, i) => (
        <div key={i} style={{ marginTop: 6 }}>
          {l.status === 'unsupported' && (
            <div style={{ color: '#c5221f' }}>
              ⛔ {l.reason || `“${l.sku || l.family}” is not in the quoting catalog`} — remove the line or correct it before building.{' '}
              <button style={chip(false)} disabled={busy} onClick={() => onRemove(msg, i)}>Remove line</button>
            </div>
          )}
          {l.status === 'needs_sku' && (
            <div style={{ color: '#e37400' }}>
              <div>⚠️ “{l.sku}” needs an exact catalog variant; it was not dropped.</div>
              {l.reason && <div style={{ color: COLORS.TEXT_SECONDARY }}>{l.reason}</div>}
              {(l.suggestions || []).map((suggestion) => (
                <button key={suggestion} style={chip(false)} disabled={busy}
                  onClick={() => onUpdate(msg, i, { sku: suggestion, status: 'resolved', suggestions: [], reason: null })}>
                  Use {suggestion}
                </button>
              ))}
              <button style={chip(false)} disabled={busy} onClick={() => onRemove(msg, i)}>Remove line</button>
            </div>
          )}
          {!['unsupported', 'needs_sku'].includes(l.status) && (
            <div>
              <b>{l.sku || l.family}</b>
              {' × '}
              <input type="number" min="1" max="99999" value={l.qty} disabled={busy}
                style={{ width: 56, fontSize: 12, padding: '2px 4px' }}
                onChange={(e) => onUpdate(msg, i, { qty: Math.max(1, Math.min(99999, parseInt(e.target.value, 10) || 1)) })} />
              {quoteIntakeTierLabel(l.tier) && (
                <span style={{ color: COLORS.TEXT_SECONDARY }}> · {quoteIntakeTierLabel(l.tier)}</span>
              )}
              {l.evidence && <span style={{ color: COLORS.TEXT_SECONDARY }} title={l.evidence}> · “{String(l.evidence).slice(0, 60)}”</span>}
              {l.options && l.status === 'resolved' && (
                <button style={chip(false)} disabled={busy} title="Change edition/term"
                  onClick={() => onUpdate(msg, i, { edition: null, term_years: null })}>✎</button>
              )}
              {l.options && !l.edition && (
                <div style={{ marginTop: 2 }}>
                  <div style={lab}>Edition — pick one</div>
                  {l.options.editions.map((ed) => (
                    <button key={ed} style={chip(l.edition === ed)} disabled={busy}
                      onClick={() => onUpdate(msg, i, { edition: ed })}>{ed.charAt(0) + ed.slice(1).toLowerCase()}</button>
                  ))}
                </div>
              )}
              {l.options && l.edition && !l.term_years && (
                <div style={{ marginTop: 2 }}>
                  <div style={lab}>Term — pick one</div>
                  {l.options.terms.map((t) => (
                    <button key={t} style={chip(l.term_years === t)} disabled={busy}
                      onClick={() => onUpdate(msg, i, { term_years: t })}>{t}-year</button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
      {lines.length === 0 && (
        <div style={{ marginTop: 4 }}>
          <div style={lab}>No products detected — enter SKUs (e.g. “MR44,2 LIC-MR-ADV-3YR,2”)</div>
          <input style={{ fontSize: 12, padding: '3px 6px', width: '70%' }} value={manual} disabled={busy}
            onChange={(e) => setManual(e.target.value)} />
          <button style={chip(false)} disabled={busy || !manual.trim()} onClick={() => onManualSkus(manual)}>Quote these SKUs</button>
        </div>
      )}
      {lines.length > 0 && (
        <button
          style={{ marginTop: 8, padding: '6px 12px', borderRadius: 6, border: 'none', cursor: 'pointer', background: (!allResolved || busy) ? '#9aa0a6' : '#1a73e8', color: '#fff', fontWeight: 600 }}
          disabled={!allResolved || busy}
          onClick={() => onBuildQuote(msg)}
        >{busy ? 'Building eCommerce quote…' : 'Build eCommerce quote options →'}</button>
      )}
      <div style={{ color: COLORS.TEXT_SECONDARY, marginTop: 4 }}>Nothing is written to Zoho at this step. Zoho conversion is a separate explicit action on the finished quote.</div>
    </div>
  );
}

// ─────────────────────────────────────────────
// One-shot reviewed-plan card (customer→quote)
// ── Live Zoho lookup for the one-shot required fields (2026-08-18) ──
// The one-shot card could only resolve a contact/account from what it parsed out
// of the email thread. When that produced nothing (missing_contact, or an
// account block with every field empty) there was no way to attach an existing
// Zoho record without abandoning the card and restarting the flow from a Zoho
// page. This is a READ-ONLY search: it never creates or edits a record, it only
// feeds the SAME re-plan inputs the existing thread pickers already use
// (contact_email / account_id), so the server re-resolves the whole plan and
// every downstream guard still applies.
function OneshotZohoLookup({
  styles, disabled, onPickContact, onPickAccount, onAddContact, onAddAccount,
  defaultDomain, filterAccountId, filterAccountName, filterContactAccountId,
}) {
  const [mode, setMode] = useState('Contacts');
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: false, records: [], error: '', ran: false });
  const tokenRef = useRef(0);

  async function runSearch() {
    const trimmed = String(query || '').trim();
    const domain = String(defaultDomain || '').trim();
    if (!trimmed && !(mode === 'Accounts' && domain)) {
      setState({ loading: false, records: [], error: 'Type a name or email to search.', ran: true });
      return;
    }
    const token = ++tokenRef.current;
    setState({ loading: true, records: [], error: '', ran: true });
    let response;
    try {
      response = mode === 'Accounts'
        ? await sendToBackground(MSG.CRM_ACCOUNT_SEARCH, { query: trimmed, domain: trimmed ? '' : domain })
        : await sendToBackground(MSG.CRM_SEARCH, { query: trimmed, module: 'Contacts' });
    } catch (error) {
      response = { error: error?.message || 'search_failed' };
    }
    if (token !== tokenRef.current) return;
    if (!response || response.error) {
      setState({ loading: false, records: [], error: response?.error || 'Zoho search is unavailable. Nothing was changed.', ran: true });
      return;
    }
    const raw = Array.isArray(response.records) ? response.records : [];
    let records = mode === 'Accounts'
      ? raw.map((r) => ({ id: r.id, primary: r.name || '(unnamed account)', secondary: [r.website, r.billingCity, r.billingState].filter(Boolean).join(' · ') }))
        .filter((r) => r.id)
      : raw.map((r) => {
        const accountObj = r.Account_Name && typeof r.Account_Name === 'object' ? r.Account_Name : null;
        const accountId = accountObj?.id || r.Account_Name_Id || '';
        const accountName = accountObj?.name || (typeof r.Account_Name === 'string' ? r.Account_Name : '');
        return {
          id: r.id,
          email: String(r.Email || '').trim(),
          accountId,
          primary: [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || String(r.Email || '(unnamed contact)'),
          secondary: [r.Email, accountName].filter(Boolean).join(' · '),
        };
      }).filter((r) => r.email);
    if (mode === 'Contacts' && filterAccountId) {
      records = records.filter((r) => String(r.accountId || '') === String(filterAccountId));
    }
    if (mode === 'Accounts' && filterContactAccountId) {
      records = records.filter((r) => String(r.id) === String(filterContactAccountId));
    }
    setState({ loading: false, records: records.slice(0, 10), error: '', ran: true });
  }

  return (
    <div style={styles.sec}>
      <div style={styles.lab}>Find an existing Zoho record (read-only search)</div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          aria-label="Zoho lookup module"
          style={{ ...styles.in, marginBottom: 0 }}
          value={mode}
          disabled={disabled}
          onChange={(e) => { setMode(e.target.value); setState({ loading: false, records: [], error: '', ran: false }); }}
        >
          <option value="Contacts">Contact</option>
          <option value="Accounts">Account</option>
        </select>
        <input
          aria-label="Zoho lookup query"
          style={{ ...styles.in, flex: 1, minWidth: 140, marginBottom: 0 }}
          placeholder={mode === 'Accounts' ? 'Account name (blank uses the thread domain)' : 'Name or email'}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
        />
        <button
          type="button"
          disabled={disabled || state.loading}
          onClick={runSearch}
          style={{ padding: '4px 9px', borderRadius: 6, border: `1px solid ${COLORS.STRATUS_BLUE}`, background: 'transparent', color: COLORS.STRATUS_BLUE, cursor: disabled || state.loading ? 'default' : 'pointer', fontSize: 11 }}
        >
          {state.loading ? 'Searching…' : 'Search'}
        </button>
      </div>
      {filterAccountId && mode === 'Contacts' && (
        <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 3 }}>
          Showing contacts on {filterAccountName || 'the selected account'} only.
        </div>
      )}
      {filterContactAccountId && mode === 'Accounts' && (
        <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 3 }}>
          Showing the account already linked to the selected contact.
        </div>
      )}
      {state.error && <div style={{ color: COLORS.ERROR, fontSize: 10, marginTop: 3 }}>{state.error}</div>}
      {!state.loading && state.ran && !state.error && state.records.length === 0 && (
        <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 3 }}>No matching Zoho records.</div>
      )}
      {state.records.length > 0 && (
        <div style={{ marginTop: 4, border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, maxHeight: 150, overflowY: 'auto' }}>
          {state.records.map((record) => (
            <button
              key={record.id}
              type="button"
              disabled={disabled}
              onClick={() => (mode === 'Accounts' ? onPickAccount(record.id) : onPickContact(record.email))}
              style={{ display: 'block', width: '100%', textAlign: 'left', padding: '5px 7px', border: 'none', borderBottom: `1px solid ${COLORS.BORDER}`, background: '#fff', cursor: disabled ? 'default' : 'pointer', fontSize: 11 }}
            >
              <b>{record.primary}</b>
              {record.secondary && <span style={{ display: 'block', color: COLORS.TEXT_SECONDARY, fontSize: 10 }}>{record.secondary}</span>}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddContact?.()}
          style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${COLORS.BORDER}`, background: '#fff', fontSize: 11, cursor: disabled ? 'default' : 'pointer' }}
        >
          Add new contact
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onAddAccount?.()}
          style={{ padding: '4px 8px', borderRadius: 6, border: `1px solid ${COLORS.BORDER}`, background: '#fff', fontSize: 11, cursor: disabled ? 'default' : 'pointer' }}
        >
          Add new account
        </button>
      </div>
    </div>
  );
}

function OneshotIsrLookup({ styles, disabled, onPick }) {
  const [query, setQuery] = useState('');
  const [state, setState] = useState({ loading: false, records: [], error: '', ran: false });
  const tokenRef = useRef(0);

  async function runSearch() {
    const trimmed = String(query || '').trim();
    if (!trimmed) {
      setState({ loading: false, records: [], error: 'Type a Cisco/Meraki rep name or email.', ran: true });
      return;
    }
    const token = ++tokenRef.current;
    setState({ loading: true, records: [], error: '', ran: true });
    let response;
    try {
      response = await sendToBackground(MSG.CRM_SEARCH, { query: trimmed, module: 'Meraki_ISRs' });
    } catch (error) {
      response = { error: error?.message || 'search_failed' };
    }
    if (token !== tokenRef.current) return;
    if (!response || response.error) {
      setState({ loading: false, records: [], error: response?.error || 'ISR search is unavailable.', ran: true });
      return;
    }
    const raw = Array.isArray(response.records) ? response.records : [];
    const records = raw.map((r) => ({
      id: r.id,
      email: String(r.Email || r.email || r.ISR_Email || '').trim(),
      name: String(r.Name || r.name || [r.First_Name, r.Last_Name].filter(Boolean).join(' ') || '').trim(),
    })).filter((r) => r.email.includes('@')).slice(0, 10);
    setState({ loading: false, records, error: '', ran: true });
  }

  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          aria-label="ISR lookup query"
          style={{ ...styles.in, flex: 1, minWidth: 140, marginBottom: 0 }}
          placeholder="Search live Meraki ISR records"
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); runSearch(); } }}
        />
        <button
          type="button"
          disabled={disabled || state.loading}
          onClick={runSearch}
          style={{ padding: '4px 9px', borderRadius: 6, border: `1px solid ${COLORS.STRATUS_BLUE}`, background: 'transparent', color: COLORS.STRATUS_BLUE, cursor: disabled || state.loading ? 'default' : 'pointer', fontSize: 11 }}
        >
          {state.loading ? 'Searching…' : 'Search ISR'}
        </button>
      </div>
      {state.error && <div style={{ color: COLORS.ERROR, fontSize: 10, marginTop: 3 }}>{state.error}</div>}
      {!state.loading && state.ran && !state.error && state.records.length === 0 && (
        <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 3 }}>No matching Meraki ISR records.</div>
      )}
      {state.records.map((record) => (
        <button
          key={record.id || record.email}
          type="button"
          disabled={disabled}
          onClick={() => onPick(record)}
          style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 6px', marginTop: 3, border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, background: '#fff', cursor: disabled ? 'default' : 'pointer', fontSize: 11 }}
        >
          <b>{record.name || record.email}</b>
          <span style={{ display: 'block', color: COLORS.TEXT_SECONDARY, fontSize: 10 }}>{record.email}</span>
        </button>
      ))}
    </div>
  );
}

const ONESHOT_ENRICH_SOURCE_OPTIONS = [
  { value: 'zia', label: 'Zia enrichment' },
  { value: 'haiku', label: 'Web search' },
  { value: 'sonnet', label: 'Deep web search' },
];

const ONESHOT_ENRICH_TIER_LABELS = {
  zia: 'Zia enrichment',
  'haiku-web': 'Web search',
  'sonnet-web': 'Deep web search',
  cache: 'Cached result',
  'zoho-existing': 'Zoho CRM',
};

function oneshotEnrichTierLabel(tier) {
  return ONESHOT_ENRICH_TIER_LABELS[String(tier || '').toLowerCase()]
    || String(tier || 'Unknown source');
}

function oneshotEnrichStartTier(tier) {
  const normalized = String(tier || '').toLowerCase();
  if (normalized === 'zia') return 'zia';
  if (normalized === 'haiku' || normalized === 'haiku-web') return 'haiku';
  if (normalized === 'sonnet' || normalized === 'sonnet-web') return 'sonnet';
  return 'zia';
}

function oneshotEnrichmentDomain(value) {
  return String(value || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');
}

function oneshotEnrichmentFields(result) {
  const source = result || {};
  return {
    name: String(source.name || '').trim(),
    street: String(source.address || source.street || '').trim(),
    city: String(source.city || '').trim(),
    state: String(source.state || '').trim(),
    zip: String(source.zip || source.postalCode || '').trim(),
    country: String(source.country || '').trim(),
    website: String(source.website || source.domain || '').trim(),
  };
}

function OneshotPlanCard({ msg, busy, onReplan: requestReplan, onRefreshContext, onQuoteOptionChange: requestQuoteOptionChange, onExecute, onEditProducts, onProductSearch }) {
  const p = msg.plan || {};
  const blockers = msg.blockers || [];
  const cust = p.customer || {};
  const acctPlan = p.account || {};
  const ct = p.contact || null;
  const deal = p.deal || {};
  const isr = p.isr || { status: 'not_required' };
  const linkedElse = blockers.find((b) => b.code === 'contact_linked_elsewhere');
  const accountConfirm = blockers.find((b) => b.code === 'account_confirm');
  const contactDefaults = (ct && ct.defaults) || {};
  const accountDraft = msg.accountDraft && typeof msg.accountDraft === 'object' ? msg.accountDraft : {};
  const [acct, setAcct] = useState(() => ({
    name: accountDraft.name ?? (acctPlan.prefill && acctPlan.prefill.name) ?? '',
    street: accountDraft.street ?? (acctPlan.prefill && acctPlan.prefill.street) ?? '',
    city: accountDraft.city ?? (acctPlan.prefill && acctPlan.prefill.city) ?? '',
    state: accountDraft.state ?? (acctPlan.prefill && acctPlan.prefill.state) ?? '',
    zip: accountDraft.zip ?? (acctPlan.prefill && acctPlan.prefill.zip) ?? '',
    country: accountDraft.country ?? (acctPlan.prefill && acctPlan.prefill.country) ?? 'United States',
    website: accountDraft.website ?? (acctPlan.prefill && acctPlan.prefill.website) ?? '',
  }));
  const [contactFirst, setContactFirst] = useState(
    contactDefaults.first_name || (!(ct && ct.name) ? ((acctPlan.prefill && acctPlan.prefill.name) || '') : '')
  );
  const [contactLast, setContactLast] = useState(
    contactDefaults.last_name || (!(ct && ct.name) && acctPlan.prefill && acctPlan.prefill.name ? 'IT' : '')
  );
  const [contactNameEdited, setContactNameEdited] = useState(false);
  const [contactEmail, setContactEmail] = useState((ct && ct.email) || '');
  // When the read-only plan proves there are zero open Deals, the only valid
  // association is a new Deal, so select it automatically. Any existing Deal
  // keeps the choice empty until the user selects an option explicitly.
  const [dealChoice, setDealChoice] = useState(() => deal.mode === 'new' ? '__new__' : '');
  const dealChoiceScope = `${deal.mode || ''}:${(deal.open_deals || []).map((item) => item.id).join(',')}`;
  useEffect(() => {
    setDealChoice(deal.mode === 'new' ? '__new__' : '');
  }, [dealChoiceScope]);
  const [lead, setLead] = useState(p.lead_source || 'Stratus Referal');
  // With exactly one candidate there is nothing to choose between, so it is
  // preselected. Leaving it blank cost Chris an Execute: the retry came back on
  // "— pick the rep —" and failed as review_mismatch because the reviewed ISR
  // choice was missing (2026-08-19). More than one candidate still requires an
  // explicit pick, and a rep is still only accepted if the review verified it.
  const isrSoleCandidate = Array.isArray(isr.candidates) && isr.candidates.length === 1
    ? String(isr.candidates[0]?.email || '')
    : '';
  const [isrEmail, setIsrEmail] = useState((isr.rep && isr.rep.email) || isrSoleCandidate || '');
  const [reactivate, setReactivate] = useState(false);
  // A contact linked to a different Account no longer walls off Execute: the rep
  // approves it here and the quote is created anyway (2026-08-19).
  const [approveContactAccount, setApproveContactAccount] = useState(false);
  const contactAccountMismatch = blockers.find((b) => b.code === 'contact_account_mismatch') || null;
  const [date, setDate] = useState((p.date && p.date.suggested) || '');
  const [overQuarter, setOverQuarter] = useState(false);
  const haMode = normalizeHaMode(p.ha_mode || p.ha?.mode || msg.base?.ha_mode);
  const haAvailable = msg.base?.ha_available === true || haMode === 'warm_spare';
  const [err, setErr] = useState(null);
  const [forceCreateContact, setForceCreateContact] = useState(false);
  const [forceCreateAccount, setForceCreateAccount] = useState(false);
  const [isrVerified, setIsrVerified] = useState([]);
  const initialEnrichment = acctPlan.prefill?.enrich_tier ? {
    tier: acctPlan.prefill.enrich_tier,
    confidence: acctPlan.prefill.enrich_confidence,
    source_url: acctPlan.prefill.enrich_source_url || '',
  } : null;
  const [activeEnrichment, setActiveEnrichment] = useState(initialEnrichment);
  const [enrichmentAlternate, setEnrichmentAlternate] = useState(null);
  const [enrichmentLoading, setEnrichmentLoading] = useState(false);
  const [enrichmentError, setEnrichmentError] = useState('');
  const [productRows, setProductRows] = useState(() => {
    const baseSkus = Array.isArray(msg.base?.skus) ? msg.base.skus : [];
    const planLines = Array.isArray(p.lines) ? p.lines : [];
    const keepLicenses = msg.base?.hardware_only !== true && msg.base?.include_licenses !== false;
    const planHasLicenses = planLines.some((line) => String(line?.sku || '').toUpperCase().startsWith('LIC-'));
    const source = (keepLicenses && planHasLicenses) ? planLines : (baseSkus.length ? baseSkus : planLines);
    return source.map((line) => ({ sku: String(line?.sku || '').trim().toUpperCase(), qty: line?.qty ?? 1, tier: line?.tier || '' }));
  });
  const [productDirty, setProductDirty] = useState(false);
  const [productStatus, setProductStatus] = useState('');
  const quoteOptionsBound = !!oneshotProductSnapshotHash(p)
    && msg.quoteOptionsSnapshotHash === oneshotProductSnapshotHash(p);
  const quoteOptions = quoteOptionsBound && Array.isArray(msg.quoteOptions) ? msg.quoteOptions : [];
  const selectedQuoteOptionIndex = quoteOptionsBound
    && Number.isInteger(msg.selectedQuoteOptionIndex)
    && msg.selectedQuoteOptionIndex >= 0
    && msg.selectedQuoteOptionIndex < quoteOptions.length
    ? msg.selectedQuoteOptionIndex : null;
  const productValidation = p.product_validation || {};
  const productSnapshotLabel = productValidation.snapshot_hash
    || productValidation.plan_id
    || p.sku_snapshot_id
    || p.sku_snapshot?.hash;
  // Once Execute crosses the write boundary, every reviewed decision is
  // frozen. A retry may resume only the exact snapshotted payload and
  // idempotency key from the first attempt.
  const immutableReviewLocked = busy || msg.executeAttempted === true;
  const reviewLocked = immutableReviewLocked || productDirty;
  // Advisory blockers (e.g. a Cisco address on the thread with no Meraki_ISRs
  // record, when the lead source doesn't require an ISR) inform the reviewer
  // but must never disable Execute — error_reports #12.
  const advisory = blockers.filter((b) => b.advisory === true);
  const hard = blockers.filter((b) => b.advisory !== true).filter((b) => String(b.code || '').startsWith('ha_') || (b.code === 'deal_choice' && b.read_failed) || [
    'ambiguous_contact', 'missing_contact', 'contact_not_eligible',
    'account_not_readable', 'account_confirm', 'account_billing_incomplete',
    // contact_account_mismatch is handled separately: it is approvable, so it
    // gates Execute through `missing` rather than as a permanent hard block.
    'contact_linked_elsewhere',
    'deal_not_readable', 'deal_not_open',
    'pinned_deal_account_missing', 'pinned_deal_contact_missing',
    'pinned_deal_contact_not_readable', 'pinned_deal_contact_email_missing',
    'pinned_deal_contact_account_missing',
    'pinned_deal_account_mismatch', 'pinned_deal_contact_mismatch',
    'invalid_sku_quantity', 'unresolved_sku', 'inactive_sku', 'eol_sku', 'product_lookup_failed',
    'isr_not_found',
  ].includes(b.code));
  // Card-per-section design (2026-08-18 redesign): every reviewed field group
  // renders as its own bordered white card against the bubble's grey backdrop
  // instead of one flat block, so blockers/decisions are easy to scan. `sec`
  // is kept as an alias of `card` because OneshotZohoLookup/OneshotIsrLookup
  // are handed this same object as `styles` and reference `styles.sec`.
  const cardStyle = { marginTop: 8, padding: 10, borderRadius: 8, border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY };
  const S = {
    card: cardStyle,
    sec: cardStyle,
    lab: { fontSize: 10, fontWeight: 700, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
    in: { fontSize: 12, padding: '5px 8px', marginRight: 6, marginBottom: 4, borderRadius: 6, border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY, color: COLORS.TEXT_PRIMARY },
    btn: { fontSize: 11, fontWeight: 600, padding: '5px 10px', marginRight: 6, marginBottom: 4, borderRadius: 6, border: `1px solid ${COLORS.STRATUS_BLUE}`, background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_DARK, cursor: 'pointer' },
  };

  function collect() {
    const missing = [];
    const d = {};
    if (productDirty) missing.push('revalidate / re-plan the edited SKU quantities');
    if (forceCreateAccount) {
      ['name', 'street', 'city', 'state', 'zip', 'country'].forEach((f) => { if (!String(acct[f] || '').trim()) missing.push('account ' + f); });
      d.account = { create: { name: acct.name, billing: { street: acct.street, city: acct.city, state: acct.state, zip: acct.zip, country: acct.country } } };
    } else if (acctPlan.mode === 'existing') d.account = { id: acctPlan.id, name: acctPlan.name };
    else if (acctPlan.mode === 'create') {
      ['name', 'street', 'city', 'state', 'zip', 'country'].forEach((f) => { if (!String(acct[f] || '').trim()) missing.push('account ' + f); });
      d.account = { create: { name: acct.name, billing: { street: acct.street, city: acct.city, state: acct.state, zip: acct.zip, country: acct.country } } };
    } else missing.push('account (pick the customer above first)');
    if (forceCreateContact) {
      if (!String(contactFirst || '').trim()) missing.push('contact first name');
      if (!String(contactLast || '').trim()) missing.push('contact last name');
      if (!String(contactEmail || '').trim().includes('@')) missing.push('contact email');
      d.contact = { create: {
        first_name: String(contactFirst || '').trim(),
        last_name: String(contactLast || '').trim(),
        email: String(contactEmail || '').trim().toLowerCase(),
      } };
    } else if (ct && ct.mode === 'existing') d.contact = { id: ct.id };
    else if (ct && ct.mode === 'create') {
      if (!String(contactFirst || '').trim()) missing.push('contact first name');
      if (!String(contactLast || '').trim()) missing.push('contact last name');
      if (/@|\bmailto\s*:/i.test(`${contactFirst || ''} ${contactLast || ''}`)) missing.push('remove the email address from the contact name');
      if (!String(contactEmail || '').trim().includes('@')) missing.push('contact email');
      if (String(contactEmail || '').trim().toLowerCase() !== String(ct.email || '').trim().toLowerCase()) {
        missing.push('re-plan the edited contact email');
      }
      d.contact = { create: {
        first_name: String(contactFirst || '').trim(),
        last_name: String(contactLast || '').trim(),
        email: String(contactEmail || '').trim().toLowerCase(),
      } };
    } else missing.push('contact (pick the customer above first)');
    if (deal.mode === 'attach') d.deal = { existing_deal_id: deal.existing_deal_id };
    else if (!dealChoice) missing.push('deal choice');
    else if (dealChoice !== '__new__') d.deal = { existing_deal_id: dealChoice };
    else d.deal = { new: true, confirmed: true };
    d.lead_source = lead;
    if (isrEmail && isrEmail.includes('@')) d.meraki_isr_email = isrEmail.trim();
    if (lead === 'Meraki ISR Referal' && !d.meraki_isr_email) missing.push('Cisco rep email');
    if (d.meraki_isr_email && ![
      isr.rep && isr.rep.email,
      ...(isr.candidates || []).map((c) => c.email),
      ...isrVerified.map((c) => c.email),
    ].filter(Boolean).some((email) => String(email).toLowerCase() === d.meraki_isr_email.toLowerCase())) {
      missing.push('verify the Cisco/Meraki rep before Execute');
    }
    if (isr.status === 'inactive' && lead === 'Meraki ISR Referal' && !reactivate) missing.push('approve reactivating the inactive rep (or change lead source)');
    if (reactivate) d.reactivate_inactive_isr = true;
    if (approveContactAccount) d.approve_contact_account_mismatch = true;
    if (contactAccountMismatch && !approveContactAccount) {
      missing.push('approve quoting a contact linked to a different Account');
    }
    if (!date) missing.push('close date');
    d.closing_date = date;
    if (overQuarter) d.date_beyond_quarter_confirmed = true;
    if (date && p.date && p.date.fiscal_quarter_end && date > p.date.fiscal_quarter_end && !overQuarter) {
      missing.push('approve the past-fiscal-quarter date');
    }
    d.ha_mode = haMode;
    return { missing, decisions: d };
  }

  // Every re-plan increments planRevision and remounts this card. Snapshot the
  // reviewed account fields for every route through that boundary, including
  // non-product choices and product/term/HA changes.
  function onReplan(overrides = {}, messagePatch = {}) {
    return requestReplan(overrides, withOneshotAccountDraft(messagePatch, acct));
  }

  // ── Auto-enrich a brand-new account (2026-08-18) ──
  // The Zoho tab already auto-enriches when a domain has no matching CRM
  // account (CrmPanel: domain lookup miss -> ENRICH_COMPANY). The one-shot card
  // had the SAME capability but only behind the "Refresh & compare" button, so a
  // new customer landed with every account field blank and "source: empty", and
  // Execute stayed blocked with nothing to act on. Fire the identical compare
  // re-plan once, automatically, under strict conditions.
  //
  // Guarded so it can never loop: the flag rides the re-plan's messagePatch, so
  // it survives the card remount that every re-plan causes. It also never runs
  // once the review is locked, while a request is in flight, or when any account
  // field already carries a value (nothing the user or the parser supplied is
  // ever overwritten).
  useEffect(() => {
    if (msg.oneshotAutoEnrichDone) return;
    if (reviewLocked || busy) return;
    if (acctPlan.mode !== 'create') return;
    const domain = String(acctPlan.prefill?.website || acctPlan.domain || p.domain || '').trim();
    if (!domain) return;
    const alreadyHasData = ['name', 'street', 'city', 'state', 'zip']
      .some((field) => String(acct[field] || '').trim());
    if (alreadyHasData) return;
    onReplan(
      { refresh_enrichment: true, enrichment_mode: 'compare', account_prefill: { ...acct } },
      { accountDraft: { ...acct }, oneshotAutoEnrichDone: true },
    );
    // Intentionally keyed on the plan revision only: this must fire at most once
    // per card, not on every keystroke in the account fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msg.planRevision, msg.oneshotAutoEnrichDone, reviewLocked, busy, acctPlan.mode]);

  async function revalidateEditedProducts(rows) {
    const hardwareOnly = msg.base?.hardware_only === true;
    const prepared = quoteTextFromEditorRows(rows, '', {});
    if (!prepared.ok) {
      setProductStatus(prepared.error || 'The edited SKU quantities are invalid.');
      return;
    }
    setProductStatus('Revalidating products and rebuilding the read-only plan…');
    let skus = prepared.rows;
    const hasRowTier = (rows || []).some((row) => String(row?.tier || '').trim());
    if (hasRowTier && !hardwareOnly) {
      // Only the hardware is requoted. The licences already in this plan were
      // derived from that hardware, so the worker regenerates them at the new
      // tier; sending them back too makes it quote both copies. Licences that
      // belong to no device here cannot be regenerated, so they are re-attached
      // after the requote instead. See splitRowsForTierRequote (2026-08-18).
      const { hardwareRows, standaloneLicenseRows } = splitRowsForTierRequote(rows);
      const requote = hardwareRows.length ? quoteTextFromEditorRows(hardwareRows, '', {}) : prepared;
      if (requote.ok) {
        const quoteRes = await runQuote(requote.text, 'oneshot-replan');
        // Keep the term this plan is already quoting. base.license_term is only
        // set when a quote option was explicitly picked, so when it is absent
        // the plan's own licence rows are the next best evidence; a bare "3"
        // default silently re-terms a customer's 1 or 5 year quote (2026-08-19).
        const term = String(msg.base?.license_term || termFromLicenseRows(rows) || '3');
        const urls = Array.isArray(quoteRes?.result?.urls) ? quoteRes.result.urls : [];
        const match = urls.find((option) => String(option?.termYears || quoteOptionTerm(option)) === term) || urls[0];
        const parsed = match?.url ? parseOrderUrlItems(match.url) : [];
        if (parsed.length) {
          // Belt and braces: if the requote already produced a licence for the
          // same device, that licence is derived after all and must not be
          // added a second time. Matched on device identity, not just the model
          // token, so a LIC-MS130-48 is not swallowed by a LIC-MS130-24.
          const carried = standaloneLicenseRows
            .filter((row) => !parsed.some((item) => sameDeviceIdentity(item.sku, row.sku)))
            .map(({ sku, qty }) => ({ sku, qty }));
          skus = hardwareRows.length ? [...parsed, ...carried] : parsed;
        }
      }
    }
    const outcome = await onReplan({
      skus,
      include_licenses: !hardwareOnly,
      hardware_only: hardwareOnly,
    });
    if (outcome?.success !== true) {
      setProductStatus(`Re-plan failed: ${outcome?.error || 'the reviewed plan was not replaced'}. Execute remains disabled.`);
    }
  }

  function onQuoteOptionChange(selectedQuoteOptionIndex) {
    requestQuoteOptionChange(
      selectedQuoteOptionIndex,
      withOneshotAccountDraft({}, acct),
    );
  }

  async function fetchAccountEnrichment(startTier) {
    const domain = oneshotEnrichmentDomain(
      acct.website || acctPlan.domain || p.domain || cust.contact?.email?.split('@')[1],
    );
    if (!domain) {
      setEnrichmentError('Add a customer domain or website first.');
      return;
    }
    setEnrichmentLoading(true);
    setEnrichmentError('');
    try {
      const result = await sendToBackground(MSG.ENRICH_COMPANY, {
        domain,
        cache_bust: true,
        start_tier: startTier,
      });
      if (!result || result.error) {
        setEnrichmentAlternate(null);
        setEnrichmentError(result?.error || 'No enrichment result was returned.');
        return;
      }
      setEnrichmentAlternate(result);
    } catch (error) {
      setEnrichmentAlternate(null);
      setEnrichmentError(error?.message || 'Enrichment lookup failed.');
    } finally {
      setEnrichmentLoading(false);
    }
  }

  function useEnrichmentResult(result) {
    const candidate = oneshotEnrichmentFields(result);
    setAcct((current) => Object.entries(candidate).reduce(
      (next, [field, value]) => value ? { ...next, [field]: value } : next,
      current,
    ));
    if (candidate.name && ct && ct.mode === 'create' && !ct.name && !contactNameEdited) {
      setContactFirst(candidate.name);
      setContactLast('IT');
    }
    setActiveEnrichment(result);
    setEnrichmentAlternate(null);
    setEnrichmentError('');
  }

  function renderEnrichmentBadge(result, prefix = 'via') {
    if (!result) return null;
    const confidence = Number(result.confidence);
    const hasConfidence = Number.isFinite(confidence);
    const sourceUrl = String(result.source_url || result.zohoUrl || '').trim();
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ color: hasConfidence && confidence >= 0.5 ? '#188038' : COLORS.TEXT_SECONDARY, fontWeight: 700 }}>
          {hasConfidence && confidence >= 0.5 ? '✓' : '•'}
        </span>
        <span style={{ color: COLORS.TEXT_SECONDARY }}>{prefix} {oneshotEnrichTierLabel(result.tier)}</span>
        {hasConfidence && <span style={{ color: COLORS.TEXT_SECONDARY }}>({Math.round(confidence * 100)}%)</span>}
        {sourceUrl && <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.STRATUS_BLUE }}>source</a>}
      </div>
    );
  }

  return (
    <div style={{ alignSelf: 'stretch', maxWidth: '100%', padding: 12, borderRadius: 10, background: COLORS.BG_SECONDARY, fontSize: 12, border: `1px solid ${COLORS.BORDER}` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 4, fontSize: 10, fontWeight: 700, letterSpacing: 0.3, background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_DARK }}>⚡ ONE-SHOT</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.TEXT_PRIMARY }}>Review, then create in Zoho CRM</span>
      </div>
      {onEditProducts && !msg.executed && (
        <button style={{ fontSize: 10, marginBottom: 6, cursor: 'pointer', background: 'transparent', border: 'none', color: COLORS.STRATUS_BLUE, padding: 0, fontWeight: 600 }}
          disabled={reviewLocked} onClick={onEditProducts}>‹ Edit products (drops this plan — re-review required)</button>
      )}
      {msg.executed && (
        <div style={{ padding: 10, borderRadius: 8, background: '#e6f4ea', border: `1px solid ${COLORS.SUCCESS}55`, color: '#188038', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>✓ Created</span>
          {msg.records?.deal?.url && <a href={msg.records.deal.url} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.STRATUS_BLUE, fontWeight: 600 }}>Deal ↗</a>}
          {msg.records?.quote?.url && <a href={msg.records.quote.url} target="_blank" rel="noopener noreferrer" style={{ color: COLORS.STRATUS_BLUE, fontWeight: 600 }}>Quote ↗</a>}
        </div>
      )}
      {msg.executed && (msg.records?.quote?.id || msg.records?.deal?.id) && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {/* Made a mistake? Take it back here rather than asking the chat agent
              to find the record again. The id is already known. */}
          {msg.records?.quote?.id && (
            <CrmDeleteControl
              styles={S}
              sendToBackground={sendToBackground}
              moduleName="Quotes"
              recordId={msg.records.quote.id}
              label={`quote ${msg.records.quote.Quote_Number || msg.records.quote.id}`}
            />
          )}
          {msg.records?.deal?.id && (
            <CrmDeleteControl
              styles={S}
              sendToBackground={sendToBackground}
              moduleName="Deals"
              recordId={msg.records.deal.id}
              label={`deal ${msg.records.deal.Deal_Name || msg.records.deal.id}`}
            />
          )}
        </div>
      )}
      {!msg.executed && (
        <>
          {msg.executeAttempted === true ? (
            <div style={{ padding: 8, borderRadius: 8, background: '#fef7e0', border: `1px solid ${COLORS.WARNING}66`, color: '#8a6100', marginBottom: 8, fontSize: 11 }}>
              Product editing is unavailable after an Execute attempt. Retry/resume can use only the original snapshotted payload.
            </div>
          ) : (
            <SkuQuantityEditor
              rows={productRows}
              onRowsChange={(rows) => {
                setProductRows(rows);
                setProductDirty(true);
                setProductStatus('Products changed. Execute and other plan choices are disabled until this card is revalidated and replaced.');
              }}
              onUpdate={revalidateEditedProducts}
              onProductSearch={onProductSearch}
              dirty={productDirty}
              disabled={busy}
              title="Zoho plan products"
              updateLabel="Revalidate / re-plan"
              status={productStatus}
              allowHaLicenseRatio={msg.base?.ha_mode === 'warm_spare'}
            />
          )}
          {quoteOptions.length > 1 && (
            <div style={S.sec}>
              <div style={S.lab}>Quote option</div>
              <select
                style={S.in}
                value={selectedQuoteOptionIndex}
                disabled={reviewLocked}
                onChange={(e) => onQuoteOptionChange(Number(e.target.value))}
              >
                {quoteOptions.map((option, index) => (
                  <option key={`${index}:${option.url}`} value={index}>
                    {option.label || `Option ${index + 1}`}
                  </option>
                ))}
              </select>
              {msg.executeAttempted === true && (
                <div style={{ color: '#8a6100', fontSize: 11 }}>
                  Review fields and term are locked after an Execute attempt. Retry/resume reuses the exact original payload.
                </div>
              )}
            </div>
          )}
          {hard.length > 0 && (
            <div style={{ padding: 8, borderRadius: 8, background: '#fce8e6', border: `1px solid ${COLORS.ERROR}55`, color: COLORS.ERROR, marginBottom: 8, fontSize: 11 }}>
              <b>Blocked:</b> {hard.map((b) => b.code + (b.sku ? ` (${b.sku})` : '')).join(' · ')} — fix in Zoho/catalog first.
            </div>
          )}
          {advisory.length > 0 && (
            <div style={{ padding: 8, borderRadius: 8, background: '#fef7e0', border: `1px solid ${COLORS.WARNING}66`, color: '#8a6100', marginBottom: 8, fontSize: 11 }}>
              <b>Note:</b> {advisory.map((b) => {
                if (b.code === 'isr_not_found') {
                  return `${b.query || 'a Cisco contact'} is on this thread but has no Meraki_ISRs record — not attributed. Switch Lead source to “Meraki ISR Referal” only after adding them in Zoho.`;
                }
                // Warn here rather than at Execute: attaching to a Deal whose Zoho
                // Contact is someone else at the same Account is allowed, but it
                // used to fail only on Execute with a misleading "changed after
                // Plan" (2026-08-19).
                if (b.code === 'deal_contact_differs') {
                  return `“${b.deal_name || 'that Deal'}” lists ${b.deal_contact_name || 'another contact'} as its primary contact in Zoho. This quote is for ${b.reviewed_contact_name || 'this contact'}, which is fine — the quote carries its own contact.`;
                }
                return b.code;
              }).join(' · ')}
            </div>
          )}
          {contactAccountMismatch && (
            <div style={{ padding: 8, borderRadius: 8, background: '#fef7e0', border: `1px solid ${COLORS.WARNING}66`, color: '#8a6100', marginBottom: 8, fontSize: 11 }}>
              <b>Contact is on a different Account:</b>{' '}
              {contactAccountMismatch.contact_name || 'this contact'} is linked to{' '}
              {contactAccountMismatch.contact_account_name || 'another Account'} in Zoho, not the Account above.
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, fontWeight: 600 }}>
                <input
                  type="checkbox"
                  checked={approveContactAccount}
                  disabled={reviewLocked}
                  onChange={(e) => setApproveContactAccount(e.target.checked)}
                />
                create the quote anyway
              </label>
            </div>
          )}
          {typeof onRefreshContext === 'function' && (
            <div style={S.sec}>
              <div style={S.lab}>Re-check this page</div>
              <button
                style={S.btn}
                disabled={reviewLocked || busy}
                onClick={() => onRefreshContext()}
              >
                Refresh from current page / pin
              </button>
            </div>
          )}
          <OneshotZohoLookup
            styles={S}
            disabled={reviewLocked || busy}
            defaultDomain={acctPlan.prefill?.website || acctPlan.domain || p.domain || ''}
            filterAccountId={acctPlan.mode === 'existing' ? acctPlan.id : ''}
            filterAccountName={acctPlan.name || ''}
            filterContactAccountId={(ct && (ct.linked_account?.id || ct.account_id)) || ''}
            onPickContact={(email) => {
              if (!email) return;
              setForceCreateContact(false);
              onReplan({ contact_email: email });
            }}
            onPickAccount={(id) => {
              if (!id) return;
              setForceCreateAccount(false);
              onReplan({ account_id: id });
            }}
            onAddContact={() => setForceCreateContact(true)}
            onAddAccount={() => setForceCreateAccount(true)}
          />
          {cust.status === 'ambiguous' && (
            <div style={S.sec}>
              <div style={S.lab}>Customer</div>
              <select style={S.in} defaultValue="" onChange={(e) => e.target.value && onReplan({ contact_email: e.target.value })} disabled={reviewLocked}>
                <option value="">— pick the customer —</option>
                {(cust.candidates || []).map((c) => (
                  <option key={c.email} value={c.email}>
                    {(c.name ? c.name + ' ' : '') + '<' + c.email + '>'}{cust.suggested && cust.suggested.email === c.email ? ' — suggested' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}
          {acctPlan.mode === 'existing' && (
            <div style={S.sec}><div style={S.lab}>Account (existing)</div>
              <b>{acctPlan.name}</b>{acctPlan.missing_fields && acctPlan.missing_fields.length > 0 && (
                <span style={{ color: '#e37400' }}> — missing in Zoho: {acctPlan.missing_fields.join(', ')} (Execute will block until fixed)</span>
              )}
              {accountConfirm && (acctPlan.candidates || []).length > 1 && (
                <select style={S.in} defaultValue="" disabled={reviewLocked}
                  onChange={(e) => e.target.value && onReplan({ account_id: e.target.value })}>
                  <option value="">— choose the matching Account —</option>
                  {(acctPlan.candidates || []).map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.id}</option>
                  ))}
                </select>
              )}
              {accountConfirm && (acctPlan.candidates || []).length <= 1 && (
                <button style={S.btn} disabled={reviewLocked}
                  onClick={() => onReplan({ account_id: acctPlan.id })}>Confirm this Account and re-plan</button>
              )}
            </div>
          )}
          {(forceCreateAccount || acctPlan.mode === 'create') && !linkedElse && (
            <div style={S.sec}><div style={S.lab}>New account</div>
              <div style={{ padding: 8, border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, background: '#f5f7fa', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                  {activeEnrichment ? renderEnrichmentBadge(activeEnrichment) : (
                    <span style={{ color: COLORS.TEXT_SECONDARY, fontSize: 11 }}>No enrichment source selected</span>
                  )}
                  <button
                    type="button"
                    style={{ ...S.btn, marginLeft: 'auto', marginBottom: 0 }}
                    disabled={reviewLocked || enrichmentLoading}
                    onClick={() => fetchAccountEnrichment(oneshotEnrichStartTier(activeEnrichment?.tier))}
                  >
                    {enrichmentLoading ? 'checking…' : 'refresh'}
                  </button>
                  <select
                    aria-label="Choose account enrichment source"
                    value=""
                    disabled={reviewLocked || enrichmentLoading}
                    onChange={(e) => e.target.value && fetchAccountEnrichment(e.target.value)}
                    style={{ ...S.in, margin: 0, color: COLORS.STRATUS_BLUE }}
                  >
                    <option value="">choose source…</option>
                    {ONESHOT_ENRICH_SOURCE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                {enrichmentError && <div style={{ color: COLORS.ERROR, fontSize: 10, marginTop: 5 }}>{enrichmentError}</div>}
              </div>
              {enrichmentAlternate && !enrichmentLoading && (
                <div style={{ marginBottom: 8, padding: 8, background: '#fffdf5', border: '1px solid #e6c86e', borderRadius: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {renderEnrichmentBadge(enrichmentAlternate, 'from')}
                    <button type="button" style={{ ...S.btn, marginLeft: 'auto', marginBottom: 0 }} disabled={reviewLocked}
                      onClick={() => useEnrichmentResult(enrichmentAlternate)}>use</button>
                  </div>
                  {(() => {
                    const candidate = oneshotEnrichmentFields(enrichmentAlternate);
                    const locality = [candidate.city, [candidate.state, candidate.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
                    const rows = [
                      ['Name', candidate.name],
                      ['Street', candidate.street],
                      ['City', locality],
                      ['Website', candidate.website],
                    ].filter(([, value]) => value);
                    return rows.length > 0 && (
                      <div style={{ marginTop: 6, padding: '6px 8px', background: '#fff8d8', borderRadius: 4 }}>
                        {rows.map(([label, value]) => (
                          <div key={label} style={{ display: 'grid', gridTemplateColumns: '52px minmax(0, 1fr)', gap: 6, marginBottom: 2 }}>
                            <b style={{ color: COLORS.TEXT_SECONDARY }}>{label}</b><span>{value}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
              <input style={{ ...S.in, width: '100%', boxSizing: 'border-box' }} placeholder="Account name" value={acct.name} disabled={reviewLocked}
                onChange={(e) => {
                  const value = e.target.value;
                  setAcct((current) => ({ ...current, name: value }));
                  if (ct && ct.mode === 'create' && !ct.name && !contactNameEdited) {
                    setContactFirst(value);
                    setContactLast(value.trim() ? 'IT' : '');
                  }
                }} />
              <input style={{ ...S.in, width: '100%', boxSizing: 'border-box' }} placeholder="Street address" value={acct.street} disabled={reviewLocked}
                onChange={(e) => setAcct((current) => ({ ...current, street: e.target.value }))} />
              <div style={{ display: 'flex', gap: 4 }}>
                <input style={{ ...S.in, flex: 2, minWidth: 0 }} placeholder="City" value={acct.city} disabled={reviewLocked}
                  onChange={(e) => setAcct((current) => ({ ...current, city: e.target.value }))} />
                <input style={{ ...S.in, flex: 1, minWidth: 0 }} placeholder="State" value={acct.state} disabled={reviewLocked}
                  onChange={(e) => setAcct((current) => ({ ...current, state: e.target.value }))} />
                <input style={{ ...S.in, flex: 1, minWidth: 0 }} placeholder="Zip" value={acct.zip} disabled={reviewLocked}
                  onChange={(e) => setAcct((current) => ({ ...current, zip: e.target.value }))} />
              </div>
              <input style={{ ...S.in, width: '100%', boxSizing: 'border-box' }} placeholder="Country" value={acct.country} disabled={reviewLocked}
                onChange={(e) => setAcct((current) => ({ ...current, country: e.target.value }))} />
              <input style={{ ...S.in, width: '100%', boxSizing: 'border-box' }} placeholder="Website" value={acct.website} disabled={reviewLocked}
                onChange={(e) => setAcct((current) => ({ ...current, website: e.target.value }))} />
            </div>
          )}
          {linkedElse && ct && ct.linked_account && (
            <div style={S.sec}><div style={S.lab}>Pairing — this contact already belongs to {ct.linked_account.name || 'another account'}</div>
              <button style={S.btn} disabled={reviewLocked}
                onClick={() => onReplan({ account_id: ct.linked_account.id })}>
                Use {ct.linked_account.name || ct.linked_account.id} and re-plan
              </button>
            </div>
          )}
          {ct && ct.mode === 'existing' && !linkedElse && (
            <div style={S.sec}><div style={S.lab}>Contact (existing)</div><b>{ct.name}</b> &lt;{ct.email}&gt;</div>
          )}
          {(forceCreateContact || (ct && ct.mode === 'create')) && (
            <div style={S.sec}><div style={S.lab}>New contact</div>
              <input style={S.in} value={contactFirst} placeholder="First name" disabled={reviewLocked} onChange={(e) => { setContactNameEdited(true); setContactFirst(e.target.value); }} />
              <input style={S.in} value={contactLast} placeholder="Last name" disabled={reviewLocked} onChange={(e) => { setContactNameEdited(true); setContactLast(e.target.value); }} />
              <input style={S.in} type="email" value={contactEmail} placeholder="Email" disabled={reviewLocked} onChange={(e) => setContactEmail(e.target.value)} />
              {String(contactEmail || '').trim().toLowerCase() !== String(ct.email || '').trim().toLowerCase() && (
                <button style={S.btn} disabled={reviewLocked || !String(contactEmail || '').includes('@')}
                  onClick={() => onReplan({
                    contact_email: String(contactEmail || '').trim().toLowerCase(),
                    contact_name: `${String(contactFirst || '').trim()} ${String(contactLast || '').trim()}`.trim(),
                    add_participant_email: String(contactEmail || '').trim().toLowerCase(),
                  })}>
                  Re-plan edited email
                </button>
              )}
            </div>
          )}
          <div style={S.sec}><div style={S.lab}>Deal</div>
            {deal.mode === 'attach' && <span>Attach quote to existing Deal {deal.existing_deal_id}</span>}
            {deal.mode === 'choose' && (
              <select style={S.in} value={dealChoice} onChange={(e) => setDealChoice(e.target.value)} disabled={reviewLocked}>
                <option value="">— choose the Deal for this quote —</option>
                {(deal.open_deals || []).map((od) => (
                  <option key={od.id} value={od.id}>
                    {`Attach to ${od.name} (${od.stage || '-'}${od.amount != null ? ` · $${od.amount}` : ''})`}
                  </option>
                ))}
                <option value="__new__">Create a SEPARATE new Deal</option>
              </select>
            )}
            {deal.mode === 'new' && (
              <label style={{ display: 'block' }}>
                <input type="radio" name={`os_deal_${msg.id}`} checked={dealChoice === '__new__'} onChange={() => setDealChoice('__new__')} disabled={reviewLocked} />{' '}
                A NEW Deal will be created
              </label>
            )}
          </div>
          <div style={S.sec}><div style={S.lab}>Lead source / Cisco rep</div>
            <select style={S.in} value={lead} onChange={(e) => {
              const nextLead = e.target.value;
              setLead(nextLead);
              onReplan({
                lead_source: nextLead,
                ...(isrEmail && isrEmail.includes('@') ? { meraki_isr_email: isrEmail.trim().toLowerCase() } : {}),
              });
            }} disabled={reviewLocked}>
              <option value="Stratus Referal">Stratus Referal</option>
              <option value="Meraki ISR Referal">Meraki ISR Referal</option>
            </select>
            {isr.status === 'resolved' && <span>Rep: <b>{isr.rep.name}</b> &lt;{isr.rep.email}&gt;</span>}
            {isr.status === 'inactive' && (
              <span>Rep <b>{isr.rep.name}</b> is INACTIVE — <label><input type="checkbox" checked={reactivate} onChange={(e) => setReactivate(e.target.checked)} disabled={reviewLocked} /> approve reactivation</label></span>
            )}
            {isr.status === 'ambiguous' && (
              <select style={S.in} value={isrEmail} onChange={(e) => setIsrEmail(e.target.value)} disabled={reviewLocked}>
                <option value="">— pick the rep —</option>
                {(isr.candidates || []).map((c) => <option key={c.id} value={c.email || ''}>{c.name} &lt;{c.email || 'no email'}&gt;{c.inactive ? ' (inactive)' : ''}</option>)}
              </select>
            )}
            {(isr.status === 'none' || isr.status === 'not_required' || lead === 'Meraki ISR Referal') && (
              <>
                <input style={S.in} placeholder="rep@cisco.com (only for ISR referral)" value={isrEmail} disabled={reviewLocked} onChange={(e) => setIsrEmail(e.target.value)} />
                {isrEmail && (
                  <button style={S.btn} disabled={reviewLocked || !isrEmail.includes('@')}
                    onClick={() => onReplan({ meraki_isr_email: isrEmail.trim().toLowerCase(), lead_source: lead })}>
                    Verify rep and re-plan
                  </button>
                )}
                <OneshotIsrLookup
                  styles={S}
                  disabled={reviewLocked}
                  onPick={(record) => {
                    setIsrEmail(record.email);
                    setIsrVerified((current) => {
                      const email = String(record.email || '').toLowerCase();
                      if (current.some((item) => String(item.email || '').toLowerCase() === email)) return current;
                      return [...current, record];
                    });
                    onReplan({ meraki_isr_email: String(record.email).trim().toLowerCase(), lead_source: 'Meraki ISR Referal' });
                  }}
                />
              </>
            )}
          </div>
          <div style={S.sec}><div style={S.lab}>Close date (Deal Closing Date = Quote Valid Till · fiscal quarter ends {(p.date && p.date.fiscal_quarter_end) || '?'})</div>
            <input type="date" style={S.in} value={date} disabled={reviewLocked} onChange={(e) => setDate(e.target.value)} />
            <label style={{ marginLeft: 6 }}><input type="checkbox" checked={overQuarter} onChange={(e) => setOverQuarter(e.target.checked)} disabled={reviewLocked} /> approve past-quarter date</label>
          </div>
          {haAvailable && <div style={S.sec}><div style={S.lab}>High availability / warm spare</div>
            <select style={S.in} value={haMode} disabled={reviewLocked}
              onChange={(e) => {
                const nextHaMode = normalizeHaMode(e.target.value);
                onReplan({
                  ha_mode: nextHaMode,
                  ha_recalculate_license_qty: nextHaMode === 'warm_spare',
                });
              }}>
              <option value="standard">Standard — no shared warm-spare license (default)</option>
              <option value="warm_spare">Warm spare / HA pair — recalculate to 2 hardware : 1 shared license</option>
            </select>
          </div>}
          {(p.lines || []).length > 0 && (
            <div style={S.sec}><div style={S.lab}>Quote lines (ecomm)</div>
              {(p.lines || []).map((l, i) => (
                <div key={i}>• {l.sku} × {l.qty}{typeof l.ecomm_price === 'number' ? ` — $${l.ecomm_price} ea` : ' — price unavailable (SKU retained)'}</div>
              ))}
              {typeof p.total_ecomm === 'number' && <div style={{ fontWeight: 700 }}>Total: ${p.total_ecomm}</div>}
              {productSnapshotLabel && (
                <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 10 }}>
                  Product validation: {productSnapshotLabel}
                  {Number.isInteger(productValidation.product_validation_count) ? ` · #${productValidation.product_validation_count}` : ''}
                  {productValidation.reused === true ? ' · reused' : ''}. Non-product re-review reuses this signed snapshot.
                </div>
              )}
            </div>
          )}
          {err && (
            <div style={{ padding: 8, borderRadius: 8, background: '#fce8e6', border: `1px solid ${COLORS.ERROR}55`, color: COLORS.ERROR, marginTop: 8, fontSize: 11 }}>
              Still needed: {err}
            </div>
          )}
          <button
            style={{ width: '100%', marginTop: 10, padding: '10px 14px', borderRadius: 8, border: 'none', fontSize: 13, cursor: hard.length || busy || productDirty ? 'default' : 'pointer', background: hard.length || busy || productDirty ? COLORS.BORDER : COLORS.STRATUS_BLUE, color: hard.length || busy || productDirty ? COLORS.TEXT_SECONDARY : '#fff', fontWeight: 700 }}
            disabled={hard.length > 0 || busy || productDirty}
            onClick={() => {
              if (productDirty) { setErr('revalidate / re-plan the edited SKU quantities'); return; }
              if (msg.executeAttempted === true) { onExecute(); return; }
              const col = collect();
              if (col.missing.length) { setErr(col.missing.join('; ')); return; }
              setErr(null);
              onExecute(col.decisions);
            }}
          >{busy ? 'Executing…' : (msg.executeAttempted ? 'Retry / resume Zoho creation' : 'Execute — create in Zoho CRM')}</button>
        </>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function ChatPanel({
  emailContext: liveEmailContext,
  navData,
  messages,
  onMessagesChange,
  // Active Zoho page context — lifted into App.jsx so the header pill and
  // the chat panel share a single source of truth. URL-validated there.
  zohoPageContext: zohoPageContextProp,
  // R7 conversation pin — owned by App.jsx alongside chatMessages so it
  // survives ChatPanel unmount/remount during automatic sidebar tab changes.
  autoPinnedRecord,
  onAutoPinnedRecordChange: setAutoPinnedRecord,
  manualPinnedRecord: manualPinnedRecordProp,
  onManualPinnedRecordChange,
  contextLock,
  onLockCurrentContext,
  onUnlockContext,
  onStartNewConversation,
}) {
  // Every chat-side email action resolves from the explicit lock first. A
  // non-Gmail lock deliberately exposes no email context, so quick actions
  // cannot silently fall through to whichever Gmail tab is currently live.
  const emailContext = contextLock?.kind === 'gmail'
    ? contextLock.snapshot
    : (contextLock ? null : liveEmailContext);
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
  const [manualRecordLocal, setManualRecordLocal] = useState(null);
  const manualRecord = manualPinnedRecordProp === undefined ? manualRecordLocal : manualPinnedRecordProp;
  const setManualRecord = onManualPinnedRecordChange || setManualRecordLocal;
  // R7 conversation context pin (corp error_reports 2026-07-14): the first
  // message that resolves an active Zoho record SNAPSHOTS it for the rest of
  // the conversation — browsing other tabs mid-thought no longer swaps the
  // context under the conversation. "Use current tab" in the context dropdown
  // re-pins deliberately; an explicit manual pin still beats it. Shape
  // matches the resolved active record. App.jsx clears it with an empty thread.
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
  const previousLockIdentityRef = useRef(contextLock ? `${contextLock.kind}:${contextLock.lockedAt}` : 'unlocked');
  // Imperative per-card guard closes the gap before React commits `busy`.
  // A term re-plan and Execute must never overlap because the review token is
  // bound to the exact SKU snapshot.
  const oneshotInFlightRef = useRef(new Set());
  // React state updates are not synchronous enough to stop a rapid double
  // click from starting two initial plans. This imperative guard closes that
  // window before the first await and prevents duplicate executable cards.
  const oneshotPlanStartRef = useRef(false);
  // Close the pre-await gap so rapid trusted clicks cannot launch duplicate
  // Gmail intake cards before React commits `loading`.
  const emailQuoteStartRef = useRef(false);
  // Each quote card owns a monotonically increasing update sequence. Editing
  // invalidates any in-flight response immediately; only the newest request
  // may replace a card or re-enable its links.
  const quoteUpdateSequenceRef = useRef(new Map());
  // Hidden <input type=file> for the "Upload image" action (attachments / pasted images).
  const fileInputRef = useRef(null);

  const searchQuoteProducts = useCallback(async (query) => {
    try {
      const response = await sendToBackground(MSG.PRODUCT_SEARCH, { query });
      if (response?.ok !== true || !Array.isArray(response.results)) {
        return {
          ok: false, query: String(query || ''), results: [], live: false,
          error: response?.error || 'Product search returned an invalid response.',
        };
      }
      // The background boundary already strips identifiers/pricing/CRM data;
      // keep this UI boundary narrow too.
      return {
        ok: true,
        query: String(response.query || query || ''),
        results: response.results.slice(0, 10).map((product) => ({
          sku: String(product?.sku || '').trim().toUpperCase(),
          name: String(product?.name || '').trim(),
          active: product?.active === true,
          source: String(product?.source || (response.live === true ? 'zoho' : 'catalog')),
        })).filter((product) => product.sku && product.active),
        live: response.live === true,
        error: '',
      };
    } catch (productSearchError) {
      return {
        ok: false, query: String(query || ''), results: [], live: false,
        error: productSearchError?.message || 'Product search is unavailable.',
      };
    }
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset context selection when email changes
  useEffect(() => {
    setSelectedContextEmail(null);
  }, [emailContext?.customerEmail, emailContext?.subject]);

  // Lock, replace, and unlock are deliberate context boundaries. Rotate the
  // worker-side quote session and clear older manual selectors so hidden state
  // cannot bleed across an explicit context change.
  useEffect(() => {
    const nextIdentity = contextLock ? `${contextLock.kind}:${contextLock.lockedAt}` : 'unlocked';
    if (nextIdentity === previousLockIdentityRef.current) return;
    previousLockIdentityRef.current = nextIdentity;
    personIdRef.current = newQuotePersonId();
    setManualRecord(null);
    setSelectedContextEmail(null);
    setContextDropdownOpen(false);
  }, [contextLock?.kind, contextLock?.lockedAt]);

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
    // A right-clicked URL/SKU selection is already an explicit quote gesture.
    // Keep the returned links, but render the same editable rows as the manual
    // quote builder so the rep can adjust the parsed cart before either using
    // a link or beginning the separately-confirmed Zoho review.
    if (navData?.quoteSkuText) runAndPushQuote(navData.quoteSkuText, {
      editable: true,
      source: 'context-menu',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navData?.quoteActionId || navData?.quoteSkuText]);

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

      // ── R7: conversation context pin ───────────────────────────────────
      // An existing conversation pin replaces a DIFFERENT live-tab record for
      // this send (a manual pin from search still beats both, below). Live
      // enrichment for the SAME record refreshes the snapshot. The first send
      // that resolves an active Zoho record establishes the pin, so a
      // mid-conversation tab switch can no longer swap the record under the
      // conversation. Deliberate switches go through "Use current tab" in the
      // context dropdown (or a new conversation, which re-pins).
      const liveZohoRecord = activeZohoRecord;
      const lockResolution = resolveLockedContexts(contextLock, emailContext, liveZohoRecord);
      if (lockResolution.locked) {
        // A first-class lock is an immutable snapshot. Live page enrichment,
        // broadcasts, and the older R7 auto-pin may not replace it.
        activeZohoRecord = lockResolution.zohoContext;
      } else {
        if (autoPinnedRecord && autoPinnedRecord.recordId) {
          if (liveZohoRecord && liveZohoRecord.recordId === autoPinnedRecord.recordId) {
            // Same authoritative record: prefer the current enriched context and
            // refresh the lifted snapshot. This avoids freezing a URL-minimal
            // first-send context (no name/account id) for the whole conversation.
            activeZohoRecord = liveZohoRecord;
            setAutoPinnedRecord({ ...liveZohoRecord });
          } else {
            // Different/no live record: retain the conversation's original
            // subject while the user browses elsewhere.
            activeZohoRecord = autoPinnedRecord;
          }
        } else if (activeZohoRecord && activeZohoRecord.recordId) {
          setAutoPinnedRecord({ ...activeZohoRecord });
        }
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
      const gatedEmailContext = lockResolution.locked
        ? lockResolution.emailContext
        : (activeIsGmail ? emailContext : null);

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
      if (shouldReadFullEmailForQuote && contextLock && contextLock.kind !== 'gmail') {
        setError('This chat is locked to non-email context. Replace the lock with the Gmail thread or unlock it before using the current email.');
        return;
      }
      if (shouldReadFullEmailForQuote && contextLock?.kind === 'gmail' && lockedEmailBodyUnavailable(contextLock)) {
        setError('The locked Gmail thread text is unavailable. Replace the lock from the open thread or unlock it; the extension will not substitute a different live page.');
        return;
      }
      if (shouldReadFullEmailForQuote && !contextLock) {
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
      const effectiveManualRecord = contextLock ? null : manualRecord;
      const pinnedIsAccount =
        !!effectiveManualRecord && effectiveManualRecord.module === 'Accounts';
      const activeIsNonAccountRecord =
        !!activeZohoRecord
        && activeZohoRecord.page === 'record'
        && activeZohoRecord.module
        && activeZohoRecord.module !== 'Accounts';

      let primaryRecord = null;
      let supplementalAccount = null; // pinned Account alongside a non-Account active record

      if (effectiveManualRecord && !pinnedIsAccount) {
        // Pinned a Quote/Deal/Contact explicitly — that's the user's choice.
        primaryRecord = effectiveManualRecord;
      } else if (activeIsNonAccountRecord) {
        // Active page is a Quote/Deal/Contact — never let a pinned Account
        // override it for deictic commands.
        primaryRecord = activeZohoRecord;
        if (pinnedIsAccount) supplementalAccount = effectiveManualRecord;
      } else if (effectiveManualRecord) {
        // Pinned Account and no active non-Account record → Account is primary.
        primaryRecord = effectiveManualRecord;
      } else if (activeZohoRecord) {
        primaryRecord = activeZohoRecord;
      }

      // ── Build the natural-language context hint ──────────────────────
      let textToSend = messageText;
      const primaryHint = buildZohoPageContextHint(primaryRecord);
      let sourceLabel = null;
      if (primaryRecord) {
        if (contextLock?.kind === 'zoho') sourceLabel = 'explicitly locked to this chat';
        else if (primaryRecord === effectiveManualRecord) sourceLabel = 'pinned by user';
        else if (primaryRecord === autoPinnedRecord
            && (!liveZohoRecord || liveZohoRecord.recordId !== autoPinnedRecord.recordId)) {
          // R7: pinned at the conversation's first message; the user is now on
          // a different tab — say so, so the model knows the record is the
          // conversation's subject, not the current screen.
          sourceLabel = 'pinned to this conversation at its first message';
        }
        else if (primaryRecord === activeZohoRecord) sourceLabel = 'currently viewing';
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
      if (shouldBlockForActiveZohoMismatch({
        activeRecordId: activeUrlInfo?.isRecord ? activeUrlInfo.recordId : null,
        outgoingText: textToSend,
        manualPinnedRecord: effectiveManualRecord,
        autoPinnedRecord,
        contextLock,
      })) {
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
        if (pinnedIsAccount && effectiveManualRecord) {
          return {
            id: effectiveManualRecord.recordId,
            name: effectiveManualRecord.recordName || effectiveManualRecord.accountName || null,
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
        const explicitlyPinned = contextLock?.kind === 'zoho' || primaryRecord === effectiveManualRecord;
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

      // R8b: accept suggestions-only replies too — chips must render even when
      // the reply text came back empty (the bubble shows a visible fallback).
      if (response && response.success && (response.reply || response.suggestions || response.recovery)) {
        const assistantMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: response.reply || '',
          usedTools: response.usedTools || false,
          // Clickable confirmation chips emitted by the worker (license term,
          // SKU fix, which-deal, …). Absent on older replies => no chips.
          suggestions: response.suggestions || null,
          // Structured terminal recovery from the Worker. This is intentionally
          // display-only; it never auto-retries a potentially mutating CRM turn.
          recovery: response.recovery || null,
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
  }, [input, loading, messages, emailContext, onMessagesChange, zohoPageContext, manualRecord, autoPinnedRecord, selectedContextEmail, participantOptions, contextLock]);

  // ─────────────────────────────────────────────
  // Consolidated quoting + email actions (from the former Quote / Email tabs)
  // ─────────────────────────────────────────────
  const nextId = () => Date.now() + Math.floor(Math.random() * 1000);
  const appendMessage = (msg) => onMessagesChange((prev) => [...(prev || []), msg]);
  const updateMessage = (id, patch) =>
    onMessagesChange((prev) => (prev || []).map((m) => {
      if (m.id !== id) return m;
      const resolvedPatch = typeof patch === 'function' ? patch(m) : patch;
      return { ...m, ...(resolvedPatch || {}) };
    }));
  const infoMsg = (text) => ({ id: nextId(), role: 'assistant', content: text, timestamp: new Date().toISOString() });

  // Run the deterministic engine for free-text SKUs and push a quote card.
  async function runAndPushQuote(skuText, {
    pushUser = true,
    priorQuoteText = null,
    editable = true,
    source = '',
  } = {}) {
    const text = (skuText || '').trim();
    if (!text || loading) return;
    lastSendRef.current = Date.now();
    if (pushUser) appendMessage({ id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString() });
    setLoading(true);
    setError(null);
    const { result, error } = await runQuote(text, personIdRef.current, priorQuoteText);
    setLoading(false);
    if (error) { appendMessage(infoMsg(`⚠️ ${error}`)); return; }
    const quoteHaRequested = hasExplicitMxHaIntent(text);
    const quoteLicenseTier = explicitQuoteLicenseTier(text);
    const quoteHardwareOnly = isExplicitHardwareOnlyQuoteText(text);
    let candidate = typedHardwareOnlyResult(result, text);
    const committedRows = editableRowsFromResult(candidate);
    // A fresh chat quote must offer Hardware Only too. Only the "Update quote"
    // path used to call this, so the option appeared only after an edit
    // (2026-08-19).
    candidate = withHardwareOnlyQuoteOption(candidate, committedRows);
    if (quoteHaRequested) {
      candidate = {
        ...candidate,
        urls: applyExplicitMxWarmSpareToQuoteOptions(candidate?.urls, true),
      };
    }
    // Initial legacy quote results can intentionally transform requested rows
    // (renewal hardware -> license-only options, term matrices, minimum seats).
    // Only gate initial paths whose committed snapshot is independently exact;
    // every manual editor rebuild and Gmail intake is verified separately.
    const exactC9300Correction = /\bC9300-24P(?:-M)?\b/i.test(text)
      && committedRows.length > 0
      && committedRows.every(({ sku }) => String(sku || '').toUpperCase() === 'C9300-24P-M');
    const verifyInitialComposition = quoteHaRequested
      || quoteHardwareOnly
      || exactC9300Correction;
    if (verifyInitialComposition) {
      const verified = verifyStratusOrderUrlOptions(candidate?.urls, committedRows, {
        licenseTier: quoteLicenseTier,
        allowHaLicenseRatio: quoteHaRequested,
        requireLicensedOption: !quoteHardwareOnly,
      });
      if (!verified.ok) {
        appendMessage({
          id: nextId(), role: 'assistant', kind: 'quote',
          result: { ...candidate, urls: [] },
          skuText: text,
          quoteHaRequested,
          quoteLicenseTier,
          quoteHardwareOnly,
          note: `${quoteHaRequested ? 'Explicit HA intent was detected, but ' : ''}Every action link was suppressed because the generated composition could not be verified (${verified.error}).`,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      candidate = { ...candidate, urls: verified.urls };
    }
    const draftRows = editable ? editableRowsFromResult(candidate) : undefined;
    appendMessage({
      id: nextId(), role: 'assistant', kind: 'quote', result: candidate,
      skuText: text,
      quoteHaRequested,
      quoteLicenseTier,
      quoteHardwareOnly,
      ...(draftRows?.length ? {
        draftRows,
        draftDirty: false,
        draftStatus: 'Parsed from the selected text. Edit or add SKU rows, then update the quote before using links or starting Zoho review.',
        quoteSource: source || 'editable-quote',
      } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  function quoteDraftRows(msg) {
    return Array.isArray(msg?.draftRows) ? msg.draftRows : editableRowsFromResult(msg?.result);
  }

  // A hardware-variant correction is resolved against the quote card itself,
  // not conversational history. That gives "change the 4G to the 4X" a
  // deterministic, reviewable meaning while preserving ordinary "4x SKU"
  // quantity syntax for the normal quote parser.
  async function applyDeterministicQuoteVariantCorrection(msg, decision, correctionText, { requestZoho = false } = {}) {
    if (!msg || loading) return;
    appendMessage({ id: nextId(), role: 'user', content: correctionText, timestamp: new Date().toISOString() });
    if (decision?.kind !== 'apply') {
      updateMessage(msg.id, {
        busy: false,
        draftStatus: decision?.message || 'I could not safely determine the requested hardware-variant change. The quote is unchanged.',
      });
      appendMessage(infoMsg(`⚠️ ${decision?.message || 'Choose or enter the exact SKU to change. The quote is unchanged.'}`));
      return;
    }

    updateMessage(msg.id, {
      busy: true,
      draftStatus: `Replacing ${decision.sourceSku} with ${decision.targetSku} in this quote…`,
    });
    const rebuilt = await rebuildQuoteMessage(msg, decision.rows, { sourceText: msg?.skuText || '' });
    if (!requestZoho || !rebuilt?.success) return;

    const requestedTerm = requestedQuoteTermYears(correctionText);
    const options = Array.isArray(rebuilt?.result?.urls) ? rebuilt.result.urls : [];
    const selectedIndex = requestedTerm == null
      ? -1
      : options.findIndex((option) => quoteOptionTerm(option) === requestedTerm);
    if (selectedIndex >= 0) {
      await handleSendQuoteToZoho(msg, rebuilt.result, selectedIndex);
      return;
    }
    updateMessage(msg.id, {
      draftStatus: 'Quote updated. Select the term option to review, then choose “Create Zoho CRM quote from selected”.',
    });
    appendMessage(infoMsg('Select a term on the updated quote card to open its One Shot review. No Zoho record has been created.'));
  }

  // A natural-language correction first uses the same deterministic follow-up
  // session that already understands phrases such as "change MX67 to
  // Enterprise".  Its corrected SKU snapshot is then rebuilt through the
  // editor's canonical, quantity-verified path.  The existing card changes in
  // place; it never becomes an unreviewable prose answer or a second stale
  // quote card.
  async function applyNaturalLanguageQuoteCorrection(msg, correctionText) {
    if (!msg || loading) return;
    appendMessage({ id: nextId(), role: 'user', content: correctionText, timestamp: new Date().toISOString() });
    updateMessage(msg.id, {
      busy: true,
      draftStatus: 'Applying your chat correction to these editable SKU rows…',
    });
    setLoading(true);
    setError(null);
    const response = await runQuote(correctionText, newQuotePersonId(), messageHistoryText(msg));
    if (response?.error || !response?.result) {
      updateMessage(msg.id, {
        busy: false,
        draftStatus: `Chat correction could not be applied: ${response?.error || 'the quote service returned no SKU result'}. Review or edit the rows directly.`,
      });
      setLoading(false);
      return;
    }
    const correctedRows = editableRowsFromResult(typedHardwareOnlyResult(response.result, correctionText));
    if (!correctedRows.length) {
      updateMessage(msg.id, {
        busy: false,
        draftStatus: 'Chat correction did not produce reviewable SKU rows. The existing quote was left unchanged.',
      });
      setLoading(false);
      return;
    }
    // rebuildQuoteMessage owns the new request sequence, verification, and
    // spinner cleanup.  The previous quote stays inert until it succeeds.
    setLoading(false);
    await rebuildQuoteMessage(msg, correctedRows, { sourceText: correctionText });
  }

  function invalidateQuoteUpdate(messageId) {
    const nextSequence = (quoteUpdateSequenceRef.current.get(messageId) || 0) + 1;
    quoteUpdateSequenceRef.current.set(messageId, nextSequence);
    return nextSequence;
  }

  // Picking a license tier is a draft change like any quantity edit: it disables
  // the stale links and Zoho actions until Update quote rebuilds and verifies.
  function handleQuoteDraftTierChange(msg, tier) {
    invalidateQuoteUpdate(msg.id);
    updateMessage(msg.id, {
      draftTier: String(tier || ''),
      draftDirty: true,
      draftStatus: 'License tier changed. Existing links and Zoho actions are disabled until Update quote succeeds.',
      busy: false,
    });
  }

  function handleQuoteDraftRowsChange(msg, rows) {
    invalidateQuoteUpdate(msg.id);
    updateMessage(msg.id, {
      draftRows: Array.isArray(rows) ? rows : [],
      draftDirty: true,
      draftStatus: 'SKU quantities changed. Existing links and Zoho actions are disabled until Update quote succeeds.',
      busy: false,
    });
  }

  function quoteVerificationRequirements(msg) {
    const intent = msg?.intake?.intent || msg?.emailQuoteContext?.intent || {};
    const hardwareOnly = intent?.hardware_only === true
      || msg?.quoteHardwareOnly === true
      || isExplicitHardwareOnlyQuoteText(msg?.skuText);
    return {
      licenseTier: hardwareOnly ? null : (intent?.license_tier || msg?.quoteLicenseTier || explicitQuoteLicenseTier(msg?.skuText)),
      allowHaLicenseRatio: explicitQuoteHaRequested(msg),
      requireLicensedOption: !hardwareOnly,
    };
  }

  function verifiedQuoteUrls(result, committedRows, msg = null, hardwareOnlySkus = null) {
    return verifyStratusOrderUrlOptions(result?.urls, committedRows, {
      ...quoteVerificationRequirements(msg),
      // Rows the rep set to "None (hardware only)". Without these the shared
      // licence companion check requires a quantity covering every access point
      // in the cart, so one bare row failed the whole quote (2026-08-19).
      ...(Array.isArray(hardwareOnlySkus) && hardwareOnlySkus.length ? { hardwareOnlySkus } : {}),
    });
  }

  function explicitQuoteHaRequested(msg) {
    return msg?.quoteHaRequested === true
      || msg?.intake?.intent?.ha_requested === true
      || msg?.emailQuoteContext?.intent?.ha_requested === true;
  }


  async function rebuildQuoteMessage(msg, rows, { sourceText = msg?.skuText || '', tier } = {}) {
    // An explicit dropdown pick wins over the tier inferred from the prior
    // request text; undefined means "leave the inferred tier alone".
    const tierOverride = tier === undefined ? msg?.draftTier : tier;
    const prepared = quoteTextFromEditorRows(rows, sourceText, {
      tier: tierOverride || '',
      haRequested: explicitQuoteHaRequested(msg),
    });
    if (!prepared.ok) {
      invalidateQuoteUpdate(msg.id);
      updateMessage(msg.id, {
        draftRows: Array.isArray(rows) ? rows : [],
        draftDirty: true,
        draftStatus: prepared.error || 'The edited SKU quantities are invalid.',
        busy: false,
      });
      return { success: false, error: prepared.error };
    }

    const requestSequence = invalidateQuoteUpdate(msg.id);
    updateMessage(msg.id, {
      draftRows: prepared.rows,
      draftDirty: true,
      draftStatus: 'Updating quote… Existing links and Zoho actions remain disabled.',
      busy: true,
    });
    setLoading(true);
    setError(null);
    // An editor rebuild is a complete canonical snapshot, not a conversational
    // follow-up. Use a fresh deterministic quote session so the Worker's
    // history modifier path cannot reinterpret an added row against the prior
    // cart and silently drop an existing SKU.
    const response = await runQuote(prepared.text, newQuotePersonId(), null, {
      licenseIntents: prepared.licenseIntents,
    });
    if (quoteUpdateSequenceRef.current.get(msg.id) !== requestSequence) {
      // A user edit invalidated this response while it was in flight. The edit
      // handler already left the card dirty and hid its stale actions; release
      // the panel-level spinner so the newer draft can now be rebuilt.
      setLoading(false);
      return { success: false, ignored: true, error: 'A newer edit replaced this quote update.' };
    }

    if (response?.error || !response?.result) {
      updateMessage(msg.id, {
        draftDirty: true,
        draftStatus: `Quote update failed: ${response?.error || 'the quote service returned no result'}. Existing links remain disabled.`,
        busy: false,
      });
      setLoading(false);
      return { success: false, error: response?.error || 'quote_update_failed' };
    }

    let candidate = typedHardwareOnlyResult(response.result, prepared.text);
    candidate = withHardwareOnlyQuoteOption(candidate, prepared.rows);
    candidate = {
      ...candidate,
      urls: applyExplicitMxWarmSpareToQuoteOptions(candidate?.urls, explicitQuoteHaRequested(msg)),
    };
    const suggestions = Array.isArray(candidate?.suggestions) ? candidate.suggestions : [];
    if (suggestions.length > 0) {
      const unresolved = new Set(suggestions
        .map((suggestion) => String(suggestion?.input || '').trim().toUpperCase())
        .filter(Boolean));
      updateMessage(msg.id, {
        result: { ...candidate, urls: [] },
        skuText: prepared.text,
        draftRows: prepared.rows.map((row) => ({ ...row, unresolved: unresolved.has(row.sku) })),
        draftDirty: true,
        draftStatus: 'The quote service did not recognize every SKU. Apply a suggestion or edit the unresolved row, then update again.',
        resultRevision: (msg.resultRevision || 0) + 1,
        busy: false,
      });
      setLoading(false);
      return { success: false, error: 'unresolved_sku' };
    }

    const verified = verifiedQuoteUrls(candidate, prepared.rows, msg, prepared.hardwareOnlySkus);
    if (!verified.ok) {
      updateMessage(msg.id, {
        result: { ...candidate, urls: [] },
        skuText: prepared.text,
        draftRows: prepared.rows,
        draftDirty: true,
        draftStatus: `Quote could not be verified: ${verified.error} No link or Zoho action is available.`,
        resultRevision: (msg.resultRevision || 0) + 1,
        busy: false,
      });
      setLoading(false);
      return { success: false, error: verified.error };
    }

    updateMessage(msg.id, (current) => ({
      result: { ...candidate, urls: verified.urls },
      skuText: prepared.text,
      draftRows: prepared.rows,
      // Which committed rows the rep set to "None (hardware only)". The one-shot
      // plan needs this: LIC-ENT is model-agnostic, so without it the worker's
      // coverage check demands a licence for access points the rep deliberately
      // quoted bare and refuses the cart (Chris, 2026-08-19).
      quoteHardwareOnlySkus: Array.isArray(prepared.hardwareOnlySkus) ? prepared.hardwareOnlySkus : [],
      draftDirty: false,
      draftStatus: 'Quote updated and every displayed link matches the committed SKU quantities.',
      resultRevision: (current.resultRevision || 0) + 1,
      busy: false,
    }));
    setLoading(false);
    return { success: true, result: { ...candidate, urls: verified.urls }, rows: prepared.rows };
  }

  // Suggestion correction and manual editing share the same canonical rebuild
  // and URL-composition verification boundary.
  async function handleQuoteSuggestion(msg, suggestion, mode, rows = quoteDraftRows(msg)) {
    if (loading) return;
    const nextRows = applySkuSuggestion(rows, suggestion, mode);
    handleQuoteDraftRowsChange(msg, nextRows);
    return rebuildQuoteMessage(msg, nextRows, { sourceText: msg.skuText || '' });
  }

  // Vision: parse a screenshot/dashboard image into SKUs and quote them.
  async function handleImageQuote(imageUrl, imageBase64) {
    if (loading) return;
    setLoading(true);
    setError(null);
    const out = await analyzeImage(imageUrl, imageBase64);
    if (out.error) { setLoading(false); appendMessage(infoMsg(`⚠️ ${out.error}`)); return; }
    if (out.kind === 'recovery') {
      setLoading(false);
      appendMessage({
        id: nextId(), role: 'assistant', content: out.note,
        recovery: out.recovery || null,
        timestamp: new Date().toISOString(),
      });
      return;
    }
    if (out.kind === 'clarification') {
      setLoading(false);
      appendMessage({
        id: nextId(), role: 'assistant', kind: 'quote-clarification',
        content: out.note, skuText: out.skuText || '',
        timestamp: new Date().toISOString(),
      });
      return;
    }
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
      // Engine-built quote URLs travel alongside the draft. Keep them: the model
      // must never be the source of a quote link (corp PR #9).
      const draftQuoteUrls = (result && Array.isArray(result.quoteUrls)) ? result.quoteUrls : [];
      if (result?.recovery) {
        appendMessage({
          id: nextId(), role: 'assistant',
          content: result.recovery.detail || 'Quote links require review before this draft is used.',
          recovery: result.recovery,
          timestamp: new Date().toISOString(),
        });
      }
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
          quoteUrls: draftQuoteUrls,
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
  // One-shot: the reviewed plan card replaces the free-text "send to Zoho" chat
  // turn (American Implement postmortem — the old path inherited whatever
  // contact the panel defaulted to and re-entered every agent gate). The FULL
  // participant list goes to the server; ambiguity comes back as a picker on
  // the card, and Execute drives the deterministic endpoint. Creating the plan
  // itself is consent-gated by the explicit quote-card button below.

  async function handleSendQuoteToZoho(sourceMessage, result, selectedUrlIdx = 0) {
    const selectedIndexes = (Array.isArray(selectedUrlIdx) ? selectedUrlIdx : [selectedUrlIdx])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 0);
    const requestedIndexes = selectedIndexes.length ? selectedIndexes : [0];
    const indexedQuoteOptions = (Array.isArray(result?.urls) ? result.urls : [])
      .map((option, index) => ({
        sourceIndex: index,
        label: (option && typeof option === 'object' && option.label) || `Option ${index + 1}`,
        url: option && typeof option === 'object' ? String(option.url || '') : String(option || ''),
        hardwareOnly: option && typeof option === 'object' && option.hardwareOnly === true,
        // Preserve the reviewed alternative identity after the URL itself has
        // passed composition verification. Renewal and EOL refresh options can
        // share the same term but represent different product scopes.
        optionKind: option && typeof option === 'object' ? String(option.optionKind || '') : '',
        optionGroupId: option && typeof option === 'object' ? String(option.optionGroupId || '') : '',
        termYears: option && typeof option === 'object' && Number.isInteger(option.termYears)
          ? option.termYears : quoteOptionTerm(option),
      }))
      .filter((option) => /^https:\/\/(?:www\.)?stratusinfosystems\.com\/order\//i.test(option.url));
    const rebasedSelectedIndexes = rebaseQuoteOptionIndexes(
      requestedIndexes,
      indexedQuoteOptions.map((option) => option.sourceIndex),
    );
    if (!rebasedSelectedIndexes.length) {
      appendMessage(infoMsg('⚠️ The selected quote option is no longer available. Review the current links and select it again.'));
      return null;
    }
    const normalizedSelectedIndex = rebasedSelectedIndexes[0];
    const extraQuoteOptionIndexes = rebasedSelectedIndexes.slice(1);
    const quoteOptions = indexedQuoteOptions.map(({ sourceIndex: _sourceIndex, ...option }) => option);
    const orderUrl = quoteOptions[normalizedSelectedIndex]?.url || '';
    return startOneshotFromUrl(orderUrl, {
      quoteOptions,
      selectedQuoteOptionIndex: normalizedSelectedIndex,
      extraQuoteOptionIndexes,
      // A manually typed/chat quote must not inherit whichever Gmail thread
      // happens to be open. Gmail-intake cards carry explicit reviewed
      // participants; every other card deliberately starts One Shot with
      // blank, editable account/contact fields.
      capturedParticipants: Array.isArray(sourceMessage?.emailQuoteContext?.participants)
        ? sourceMessage.emailQuoteContext.participants : [],
      hardwareOnlySkus: sourceMessage?.quoteHardwareOnlySkus,
      intakeIntent: sourceMessage?.emailQuoteContext?.intent
        || (sourceMessage?.quoteHaRequested === true ? { ha_requested: true } : null),
    });
  }

  async function startOneshotFromUrl(orderUrl, {
    quoteOptions = [],
    selectedQuoteOptionIndex = 0,
    extraQuoteOptionIndexes = [],
    capturedParticipants = null,
    hardwareOnlySkus = null,
    intakeIntent = null,
  } = {}) {
    if (oneshotPlanStartRef.current) return;
    oneshotPlanStartRef.current = true;
    try {
      const skus = parseOrderUrlItems(orderUrl);
      if (!skus.length) { appendMessage(infoMsg('⚠️ No SKUs found on the selected quote URL.')); return; }
      const participants = (Array.isArray(capturedParticipants)
        ? capturedParticipants
        : (emailContext?.threadContacts || []))
        .map((c) => ({ email: String(c?.email || '').trim().toLowerCase(), name: c?.name || '', role: c?.role || '' }))
        .filter((c) => c.email.includes('@'))
        .slice(0, 50);
      const explicitlySelectedEmail = (selectedContextEmail && selectedContextEmail !== '__none__')
        ? String(selectedContextEmail).trim().toLowerCase()
        : '';
      const selectedOption = quoteOptions[selectedQuoteOptionIndex] || {};
      const hardwareOnly = selectedOption.hardwareOnly === true;
      const termYears = Number.isInteger(selectedOption.termYears) ? selectedOption.termYears : null;
      const haRequested = intakeIntent?.ha_requested === true;
      // The contact the panel is ALREADY showing as this chat's context. Only an
      // explicit dropdown pick used to ride along, so the card displayed
      // "Contact: Trevor Goode" while the plan was told nothing and blocked on
      // ambiguous_contact. Forwarding the shown contact is what Chris asked for
      // (2026-08-19); it stays gated on the captured participant list, so a pick
      // from another conversation still cannot leak, and the card keeps the
      // customer picker so the rep can override before anything is written.
      const shownContextEmail = String(activeContextEmail || '').trim().toLowerCase();
      const forwardedContactEmail = participants.some((c) => c.email === explicitlySelectedEmail)
        ? explicitlySelectedEmail
        : (participants.some((c) => c.email === shownContextEmail) ? shownContextEmail : undefined);
      const base = {
        skus,
        participants,
        contact_email: forwardedContactEmail,
        // Tells the card the contact came from the thread rather than a click, so
        // it can say so instead of implying the rep chose it.
        ...(forwardedContactEmail && forwardedContactEmail !== explicitlySelectedEmail
          ? { contact_email_source: 'panel-context' }
          : {}),
        source: 'ext-oneshot',
        ...(termYears ? { license_term: String(termYears) } : {}),
        ...(hardwareOnly ? { hardware_only: true, include_licenses: false } : { include_licenses: true }),
        // Per-line "None (hardware only)" rows. Without these the worker's
        // model-agnostic licence coverage check counts access points the rep
        // deliberately quoted bare and refuses the cart.
        ...(Array.isArray(hardwareOnlySkus) && hardwareOnlySkus.length
          ? { hardware_only_skus: hardwareOnlySkus }
          : {}),
        ...oneshotHaStateForQuoteOption({ haAvailable: haRequested, hardwareOnly }),
      };
      const pin = effectivePinnedZohoRecord({ contextLock, manualPinnedRecord: manualRecord, autoPinnedRecord });
      if (pin && pin.module === 'Accounts' && pin.recordId) base.account_id = pin.recordId;
      if (pin && pin.module === 'Deals' && pin.recordId) {
        base.existing_deal_id = pin.recordId;
        if (pin.accountId) base.account_id = pin.accountId;
      }
      // A pinned Contact already names the person this quote is for, so seed the
      // plan with them instead of making the rep pick a customer the extension
      // already knows (2026-08-19). The plan resolves the contact by email, and
      // the pin's account is carried across so the Account section binds too.
      // Only an explicit pin does this — never a guess from the thread.
      if (pin && pin.module === 'Contacts' && pin.recordId) {
        // The id always rides along: the pin's email is filled in by a DOM
        // enrichment pass that may not have run, and without the id the plan fell
        // back to "pick the customer" for a contact already pinned (2026-08-19).
        base.contact_id = pin.recordId;
        if (pin.email) base.contact_email = pin.email;
        if (pin.accountId) base.account_id = base.account_id || pin.accountId;
      }
      setLoading(true);
      const res = await sendToBackground(MSG.ONESHOT_PLAN, base).catch((e) => ({ success: false, error: e.message }));
      if (!res || res.success !== true) {
        appendMessage(infoMsg(`⚠️ One-shot plan failed: ${res?.error || 'unknown'}${oneshotStopExplanation(res)}`));
        return;
      }
      const quoteOptionState = bindOneshotQuoteOptions(quoteOptions, selectedQuoteOptionIndex, res.plan);
      appendMessage({
        id: nextId(), role: 'assistant', kind: 'oneshot', timestamp: new Date().toISOString(),
        plan: res.plan, blockers: res.blockers, base,
        ...quoteOptionState,
        extraQuoteOptionIndexes: Array.isArray(extraQuoteOptionIndexes) ? extraQuoteOptionIndexes : [],
        consentSource: 'quote-card-button',
        reviewToken: res.review_token, reviewExpiresAt: res.review_expires_at,
        planRevision: 0,
        idempotencyKey: 'ext:' + (globalThis.crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)),
      });
    } finally {
      setLoading(false);
      oneshotPlanStartRef.current = false;
    }
  }

  // Re-plan a card against the thread the panel is showing RIGHT NOW. A card
  // started away from Gmail captured no participants and stopped at
  // missing_contact, and opening the correct thread afterwards did not reach it
  // (Chris, 2026-08-19). Read-only: it sends the same re-plan inputs the
  // pickers already send and writes nothing to Zoho.
  async function refreshOneshotFromContext(msg) {
    const pin = effectivePinnedZohoRecord({
      contextLock,
      manualPinnedRecord: manualRecord,
      autoPinnedRecord,
    });
    const overrides = oneshotContextRefreshOverrides({
      threadContacts: emailContext?.threadContacts || [],
      selectedContactEmail: (selectedContextEmail && selectedContextEmail !== '__none__')
        ? selectedContextEmail
        : '',
      shownContactEmail: activeContextEmail || '',
      pin,
    });
    if (!overrides.participants.length && !overrides.contact_email && !overrides.contact_id) {
      appendMessage(infoMsg('Nothing to refresh from: open the Gmail thread for this customer, or pin the Contact, then try again.'));
      return { success: false, error: 'no_context' };
    }
    const outcome = await replanOneshot(msg, overrides);
    if (outcome?.success === true) {
      appendMessage(infoMsg(`Re-planned against this page: ${oneshotContextRefreshSummary(overrides)}.`));
    }
    return outcome;
  }

  async function replanOneshot(msg, overrides = {}, messagePatch = {}, { boundOptionSelection = false } = {}) {
    if (msg.executeAttempted) return { success: false, error: 'Product re-planning is unavailable after an Execute attempt.' };
    if (oneshotInFlightRef.current.has(msg.id)) return { success: false, error: 'A re-plan is already in progress.' };
    oneshotInFlightRef.current.add(msg.id);
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? { ...m, busy: true } : m));
    setLoading(true);
    try {
      const next = { ...overrides };
      const addedEmail = String(next.add_participant_email || '').trim().toLowerCase();
      delete next.add_participant_email;
      const participants = [...(msg.base.participants || [])];
      if (addedEmail && !participants.some((p) => String(p?.email || '').trim().toLowerCase() === addedEmail)) {
        participants.push({ email: addedEmail, name: next.contact_name || '', role: 'customer-user-edited' });
      }
      const request = buildOneshotReplanPayload(
        { ...msg.base, participants },
        next,
        msg.reviewToken,
      );
      const res = await sendToBackground(MSG.ONESHOT_PLAN, request).catch((e) => ({ success: false, error: e.message }));
      if (!res || res.success !== true) {
        const replanError = res?.detail || res?.error || 'unknown';
        onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? { ...m, busy: false } : m));
        appendMessage(infoMsg(`⚠️ Re-plan failed: ${replanError}`));
        return { success: false, error: replanError };
      }
      const base = { ...request };
      delete base.prior_review_token;
      delete base.refresh_enrichment;
      delete base.enrichment_mode;
      delete base.account_prefill;
      const quoteOptionState = nextOneshotQuoteOptionState({
        quoteOptions: msg.quoteOptions,
        selectedQuoteOptionIndex: msg.selectedQuoteOptionIndex,
        quoteOptionsSnapshotHash: msg.quoteOptionsSnapshotHash,
        currentPlan: msg.plan,
        nextPlan: res.plan,
        productChanging: isProductChangingOneshotOverride(next),
        boundOptionSelection,
        nextSelectedQuoteOptionIndex: messagePatch.selectedQuoteOptionIndex,
      });
      onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? {
        ...m,
        ...messagePatch,
        ...quoteOptionState,
        plan: res.plan,
        blockers: res.blockers,
        base,
        reviewToken: res.review_token,
        reviewExpiresAt: res.review_expires_at,
        planRevision: (m.planRevision || 0) + 1,
        busy: false,
      } : m));
      return { success: true };
    } finally {
      setLoading(false);
      oneshotInFlightRef.current.delete(msg.id);
    }
  }

  async function changeOneshotQuoteOption(msg, selectedQuoteOptionIndex, messagePatch = {}) {
    if (msg.busy || msg.executed || msg.executeAttempted || oneshotInFlightRef.current.has(msg.id)) return;
    const options = Array.isArray(msg.quoteOptions) ? msg.quoteOptions : [];
    const currentSnapshotHash = oneshotProductSnapshotHash(msg.plan);
    if (!currentSnapshotHash || msg.quoteOptionsSnapshotHash !== currentSnapshotHash) {
      appendMessage(infoMsg('⚠️ These eCommerce term options no longer match the reviewed product snapshot. Rebuild the quote before selecting another term.'));
      return;
    }
    const option = options[selectedQuoteOptionIndex];
    if (!option || selectedQuoteOptionIndex === msg.selectedQuoteOptionIndex) return;
    const skus = parseOrderUrlItems(option.url);
    if (!skus.length) {
      appendMessage(infoMsg('⚠️ The selected eCommerce option did not contain any quoteable SKUs.'));
      return;
    }
    const hardwareOnly = option.hardwareOnly === true;
    const termYears = Number.isInteger(option.termYears) ? option.termYears : quoteOptionTerm(option);
    await replanOneshot(msg, {
      skus,
      ...(termYears ? { license_term: String(termYears) } : { license_term: null }),
      hardware_only: hardwareOnly,
      include_licenses: !hardwareOnly,
      ...oneshotHaStateForQuoteOption({
        haAvailable: msg.base?.ha_available === true,
        hardwareOnly,
        currentMode: msg.base?.ha_mode,
      }),
    }, { ...messagePatch, selectedQuoteOptionIndex }, { boundOptionSelection: true });
  }

  async function executeOneshotCard(msg, decisions) {
    if (msg.busy || msg.executed || oneshotInFlightRef.current.has(msg.id)) return;
    const payload = msg.executeAttempted === true
      ? msg.executePayload
      : {
        idempotency_key: msg.idempotencyKey,
        skus: msg.base.skus,
        participants: msg.base.participants,
        review_token: msg.reviewToken,
        source: msg.base.source || 'ext-oneshot',
        ...(msg.base.license_term != null ? { license_term: String(msg.base.license_term) } : {}),
        ...(msg.base.renewal === true ? { renewal: true } : {}),
        ...(msg.base.license_only === true ? { license_only: true } : {}),
        ...(msg.base.hardware_only === true ? { hardware_only: true } : {}),
        ...(msg.base.include_licenses === false ? { include_licenses: false } : {}),
        ha_mode: normalizeHaMode(msg.base.ha_mode || msg.plan?.ha_mode || msg.plan?.ha?.mode),
        ...(msg.base.ha_recalculate_license_qty === true ? { ha_recalculate_license_qty: true } : {}),
        // Bound into the review fingerprint on the worker, so Execute must send
        // exactly what Plan sent or the review will not validate.
        ...(Array.isArray(msg.base.hardware_only_skus) && msg.base.hardware_only_skus.length
          ? { hardware_only_skus: msg.base.hardware_only_skus }
          : {}),
        ...decisions,
      };
    if (!payload) {
      appendMessage(infoMsg('⚠️ This older attempt has no safe payload snapshot to resume. Start a fresh card from the eCommerce quote.'));
      return;
    }
    oneshotInFlightRef.current.add(msg.id);
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id
      ? { ...m, busy: true, executeAttempted: true, executePayload: payload }
      : m));
    try {
      const res = await sendToBackground(MSG.ONESHOT_EXECUTE, payload).catch((e) => ({ success: false, error: e.message }));
      if (res && res.success === true) {
        onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? { ...m, busy: false, executed: true, records: res.records } : m));
        const q = res.records?.quote || {}; const d = res.records?.deal || {};
        appendMessage(infoMsg(`Created in Zoho${res.replayed ? ' (replayed, already existed)' : ''}.${d.url ? ` Deal: ${d.url}` : ''}${q.url ? ` Quote: ${q.url}` : ''}`));
        const extraIndexes = Array.isArray(msg.extraQuoteOptionIndexes) ? msg.extraQuoteOptionIndexes : [];
        const dealId = d.id || d.deal_id;
        if (dealId && extraIndexes.length) {
          for (const extraIdx of extraIndexes) {
            const option = (msg.quoteOptions || [])[extraIdx];
            if (!option?.url) continue;
            const extraSkus = parseOrderUrlItems(option.url);
            if (!extraSkus.length) {
              appendMessage(infoMsg(`Extra term ${option.label || extraIdx} had no SKUs and was skipped.`));
              continue;
            }
            const extraHardwareOnly = option.hardwareOnly === true;
            const extraTerm = Number.isInteger(option.termYears) ? option.termYears : quoteOptionTerm(option);
            const planRes = await sendToBackground(MSG.ONESHOT_PLAN, {
              ...msg.base,
              skus: extraSkus,
              existing_deal_id: dealId,
              ...(extraTerm ? { license_term: String(extraTerm) } : {}),
              hardware_only: extraHardwareOnly,
              include_licenses: !extraHardwareOnly,
            }).catch((e) => ({ success: false, error: e.message }));
            if (!planRes || planRes.success !== true) {
              appendMessage(infoMsg(`Extra term ${option.label || extraIdx} plan failed: ${planRes?.detail || planRes?.error || 'unknown'}`));
              continue;
            }
            const extraDecisions = {
              ...(payload.account ? { account: payload.account } : {}),
              ...(payload.contact ? { contact: payload.contact } : {}),
              deal: { existing_deal_id: dealId },
              ...(payload.lead_source ? { lead_source: payload.lead_source } : {}),
              ...(payload.meraki_isr_email ? { meraki_isr_email: payload.meraki_isr_email } : {}),
              ...(payload.closing_date ? { closing_date: payload.closing_date } : {}),
              ...(payload.ha_mode ? { ha_mode: payload.ha_mode } : {}),
            };
            const extraExec = await sendToBackground(MSG.ONESHOT_EXECUTE, {
              idempotency_key: `${msg.idempotencyKey}:term:${extraTerm || extraIdx}`,
              skus: extraSkus,
              participants: msg.base.participants,
              review_token: planRes.review_token,
              source: msg.base.source || 'ext-oneshot',
              ...(extraTerm ? { license_term: String(extraTerm) } : {}),
              hardware_only: extraHardwareOnly,
              include_licenses: !extraHardwareOnly,
              // The extra-term PLAN above spreads msg.base, so these reach it.
              // Both are bound into the review fingerprint, so Execute has to
              // send them too or the snapshot cannot validate. Omitting
              // hardware_only_skus here failed the 5-year quote with
              // product_snapshot_mismatch while the 3-year one succeeded
              // (Chris, 2026-08-19).
              ...(Array.isArray(msg.base.hardware_only_skus) && msg.base.hardware_only_skus.length
                ? { hardware_only_skus: msg.base.hardware_only_skus }
                : {}),
              ...(msg.base.ha_recalculate_license_qty === true
                ? { ha_recalculate_license_qty: true }
                : {}),
              ...extraDecisions,
            }).catch((e) => ({ success: false, error: e.message }));
            if (extraExec && extraExec.success === true) {
              const extraQ = extraExec.records?.quote || {};
              appendMessage(infoMsg(`Also created ${option.label || extraTerm + '-year'} under the same deal.${extraQ.url ? ` Quote: ${extraQ.url}` : ''}`));
            } else {
              appendMessage(infoMsg(`Extra term ${option.label || extraIdx} execute failed: ${extraExec?.error || 'unknown'}`));
            }
          }
        }
      } else {
        onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? { ...m, busy: false } : m));
        const extra = oneshotStopExplanation(res);
        appendMessage(infoMsg(`⚠️ One-shot stopped: ${res?.error || 'failed'}${extra}${res?.records?.deal?.id ? ' (CRM records from this attempt are preserved — Execute again resumes)' : ''}`));
      }
    } finally {
      oneshotInFlightRef.current.delete(msg.id);
    }
  }

  // ── Manual-first eCommerce quote builder ──
  // Create Quote itself does no parsing or network work. It gives the rep an
  // empty controlled editor backed by read-only Zoho product search. Generating
  // links remains an explicit second step; CRM review remains a third step.
  function startManualEcommQuote() {
    if (loading) return;
    appendMessage({
      id: nextId(),
      role: 'assistant',
      kind: 'quote',
      manualQuoteBuilder: true,
      result: { urls: [], parsed: [], eolWarnings: [], suggestions: null, source: 'manual-quote-builder' },
      draftRows: blankQuoteEditorRows(),
      draftDirty: true,
      draftStatus: 'Enter an exact SKU, select an active Zoho product, or populate from the current Gmail context.',
      note: 'Manual quote builder — review the SKU rows, then generate read-only eCommerce options.',
      timestamp: new Date().toISOString(),
    });
  }

  // Populate an EXISTING manual card from Gmail. This reuses the strict intake
  // boundary but deliberately does not auto-run the quote: the parsed rows land
  // in the editor for review and the rep must still press Generate quote.
  async function populateManualQuoteFromGmail(msg) {
    if (loading || emailQuoteStartRef.current || !msg?.manualQuoteBuilder) return;
    if (quoteEditorHasSkuInput(quoteDraftRows(msg))) {
      updateMessage(msg.id, {
        draftStatus: 'Clear the current manual SKU rows before populating from Gmail; existing work was not replaced.',
      });
      return;
    }
    if (contextLock && contextLock.kind !== 'gmail') {
      updateMessage(msg.id, {
        draftStatus: 'Gmail population is unavailable because this chat is locked to non-Gmail context. Manual entry remains available.',
      });
      return;
    }

    emailQuoteStartRef.current = true;
    setLoading(true);
    updateMessage(msg.id, { busy: true, draftStatus: 'Reading the current Gmail conversation… Nothing is being written to Zoho.' });
    try {
      let validation = null;
      if (contextLock?.kind === 'gmail') {
        validation = validateGmailQuoteContext(contextLock.snapshot, { requireFresh: false });
      } else {
        const fresh = await sendToBackground(MSG.GET_FULL_EMAIL_CONTEXT)
          .catch((e) => ({ empty: true, error: e.message }));
        validation = validateGmailQuoteContext(fresh, {
          expectedThreadPermId: emailContext?.threadPermId || '',
          expectedSubject: emailContext?.subject || '',
          requireFresh: true,
        });
      }
      if (!validation?.ok) {
        updateMessage(msg.id, {
          busy: false,
          draftStatus: `Gmail population stopped: ${validation?.error || 'the Gmail conversation could not be verified.'} Manual entry remains available.`,
        });
        return;
      }

      const quoteContext = validation.context;
      const participants = (quoteContext.threadContacts || []).map((contact) => ({
        email: contact.email,
        name: contact.name || '',
        role: contact.role || '',
      }));
      const res = await sendToBackground(MSG.ONESHOT_INTAKE, {
        subject: quoteContext.subject,
        body_text: quoteContext.fullThreadBody.slice(0, 20000),
        messages: (Array.isArray(quoteContext.messageContexts) ? quoteContext.messageContexts : [])
          .slice(0, 50)
          .map((message) => ({
            index: message?.index,
            from_email: String(message?.fromEmail || '').trim().toLowerCase(),
            body: String(message?.body || '').slice(0, 12000),
          })),
        participants,
        sender: { email: quoteContext.senderEmail || '', name: quoteContext.senderName || '' },
        order_urls: validation.orderUrls,
        source: 'ext-email-ecomm-intake',
      }).catch((error) => ({ success: false, error: error.message }));
      if (!res || res.success !== true) {
        const why = res?.error === 'intake_disabled'
          ? 'Email intake is not enabled on this worker (CHAT_ONESHOT_ROUTE_ENABLED).'
          : (res?.detail || res?.error || 'unknown');
        updateMessage(msg.id, {
          busy: false,
          draftStatus: `Gmail population failed: ${why}. Manual entry remains available.`,
        });
        return;
      }

      const rows = quoteEditorRowsFromIntake(res.lines || [], res.intent || {});
      const unresolvedCount = (Array.isArray(res.lines) ? res.lines : [])
        .filter((line) => line?.status !== 'resolved').length;
      if (!rows.length) {
        updateMessage(msg.id, {
          busy: false,
          draftStatus: 'Gmail did not contain any safely resolved SKU rows. Enter or select the products manually.',
          intake: {
            lines: res.lines || [], facts: res.facts || null, intent: res.intent || null,
            selected_message_index: res.selected_message_index ?? null,
            selected_message_from: res.selected_message_from || null,
            extract_error: res.extract_error || null,
          },
        });
        return;
      }

      invalidateQuoteUpdate(msg.id);
      updateMessage(msg.id, (current) => ({
        result: { urls: [], parsed: [], eolWarnings: [], suggestions: null, source: 'manual-quote-builder-gmail' },
        draftRows: rows,
        draftDirty: true,
        draftStatus: unresolvedCount === 0
          ? `Populated ${rows.length} SKU line${rows.length === 1 ? '' : 's'} from Gmail. Review them, then generate the quote.`
          : `Populated ${rows.length} safely resolved Gmail SKU line${rows.length === 1 ? '' : 's'}; ${unresolvedCount} unresolved line${unresolvedCount === 1 ? '' : 's'} still need manual review.`,
        intake: {
          lines: res.lines || [], facts: res.facts || null, intent: res.intent || null,
          selected_message_index: res.selected_message_index ?? null,
          selected_message_from: res.selected_message_from || null,
          extract_error: res.extract_error || null,
        },
        emailQuoteContext: {
          participants,
          isrPrefill: res.isr_prefill || null,
          intent: res.intent || null,
        },
        skuText: quoteSkuTextFromLines(res.lines || []),
        gmailPopulated: true,
        resultRevision: (current.resultRevision || 0) + 1,
        busy: false,
      }));
    } finally {
      setLoading(false);
      emailQuoteStartRef.current = false;
    }
  }

  // Locally re-derive a line after a chip/qty change — matrix lookup only.
  function resolveIntakeLine(line, patch) {
    const next = { ...line, ...patch };
    if (patch?.sku && patch?.status === 'resolved') {
      next.sku = String(patch.sku).trim().toUpperCase();
      next.status = 'resolved';
      next.suggestions = [];
      next.reason = null;
    }
    if (next.options) {
      const fam = next.options.sku_matrix || {};
      next.sku = (next.edition && next.term_years && fam[next.edition])
        ? (fam[next.edition][String(next.term_years)] || null) : null;
      next.status = next.sku ? 'resolved' : (!next.edition ? 'needs_edition' : 'needs_term');
    }
    return next;
  }

  function handleIntakeUpdate(msg, lineIdx, patch) {
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id
      ? { ...m, intake: { ...m.intake, lines: (m.intake.lines || []).map((l, i) => (i === lineIdx ? resolveIntakeLine(l, patch) : l)) } }
      : m));
  }

  function handleIntakeRemove(msg, lineIdx) {
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id
      ? { ...m, intake: { ...m.intake, lines: (m.intake.lines || []).filter((_, i) => i !== lineIdx) } }
      : m));
  }

  async function buildEcommQuoteFromIntake(msg, linesOverride = null, allowWhileIntake = false) {
    const lines = (linesOverride || (msg.intake && msg.intake.lines) || []).filter((l) => l.status === 'resolved' && l.sku);
    if (!lines.length || (loading && !allowWhileIntake)) return;
    const normalized = normalizeQuoteIntakeLines(lines);
    const intakeIntent = msg.intake?.intent || msg.emailQuoteContext?.intent || {};
    const quoteModifiers = [];
    if (intakeIntent.hardware_only === true) quoteModifiers.push('hardware only');
    else if (intakeIntent.license_tier === 'ENT') quoteModifiers.push('enterprise');
    else if (intakeIntent.license_tier === 'SEC') quoteModifiers.push('security');
    else if (intakeIntent.license_tier === 'SDW') quoteModifiers.push('SD-WAN');
    else if (intakeIntent.license_tier === 'A') quoteModifiers.push('advanced license');
    // Carry the already-reviewed Gmail HA boolean into the deterministic
    // Worker request. Mutating only the returned URL to 2:1 leaves a structured
    // EOL source/target contract stale; the Worker must build both together.
    if (intakeIntent.ha_requested === true && intakeIntent.hardware_only !== true) {
      quoteModifiers.push('use warm spare HA');
    }
    const skuText = [quoteSkuTextFromLines(lines), ...quoteModifiers].filter(Boolean).join('\n');
    if (!normalized.length || !skuText) {
      appendMessage(infoMsg('⚠️ No safe SKU quantities were available for the eCommerce quote.'));
      return;
    }
    setLoading(true);
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? { ...m, busy: true } : m));
    const out = await runQuote(skuText, personIdRef.current);
    const hardwareLines = normalized.filter(({ sku }) => !String(sku).startsWith('LIC-'));
    const hardwareOnlyUrl = hardwareLines.length === normalized.length && hardwareLines.length > 0
      ? `https://stratusinfosystems.com/order/?item=${hardwareLines.map((line) => line.sku).join(',')}&qty=${hardwareLines.map((line) => line.qty).join(',')}`
      : '';
    let quoteResult = out.result ? { ...out.result } : null;
    if (hardwareOnlyUrl) {
      const hardwareOption = { label: 'Hardware Only', url: hardwareOnlyUrl, hardwareOnly: true };
      const returned = Array.isArray(quoteResult?.urls) ? quoteResult.urls : [];
      quoteResult = {
        ...(quoteResult || {}),
        urls: intakeIntent.hardware_only === true
          ? [hardwareOption]
          : [...returned.filter((option) => String(option?.url || option) !== hardwareOnlyUrl), hardwareOption],
      };
    }
    let quoteVerificationError = '';
    if (quoteResult) {
      quoteResult = {
        ...quoteResult,
        urls: applyExplicitMxWarmSpareToQuoteOptions(quoteResult.urls, intakeIntent.ha_requested === true),
      };
      const verified = verifyStratusOrderUrlOptions(quoteResult.urls, normalized, {
        licenseTier: intakeIntent.hardware_only === true ? null : intakeIntent.license_tier,
        allowHaLicenseRatio: intakeIntent.ha_requested === true,
        requireLicensedOption: intakeIntent.hardware_only !== true,
      });
      if (verified.ok) quoteResult = { ...quoteResult, urls: verified.urls };
      else {
        quoteVerificationError = verified.error;
        quoteResult = { ...quoteResult, urls: [] };
      }
    }
    setLoading(false);
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id ? {
      ...m,
      kind: 'quote',
      result: quoteResult
        ? { ...quoteResult, parsed: normalized.map(({ sku, qty, tier }) => ({ baseSku: sku, qty, ...(tier ? { tier } : {}) })) }
        : {
          urls: [],
          parsed: normalized.map(({ sku, qty, tier }) => ({ baseSku: sku, qty, ...(tier ? { tier } : {}) })),
          eolWarnings: [],
          suggestions: null,
          source: 'email-intake-sku-only',
        },
      note: quoteVerificationError
        ? `Parsed ${normalized.length} SKU line${normalized.length === 1 ? '' : 's'} from the requested Gmail message, but every action link was suppressed because the generated composition could not be verified (${quoteVerificationError}).`
        : out.error
        ? `Parsed ${normalized.length} SKU line${normalized.length === 1 ? '' : 's'} from the locked Gmail thread. Pricing/link generation was unavailable (${out.error}); the normalized SKU output is still retained.`
        : `Parsed ${normalized.length} SKU line${normalized.length === 1 ? '' : 's'} from the requested Gmail message. Select a returned term or Hardware Only; no CRM records have been created.`,
      skuText,
      emailQuoteContext: m.emailQuoteContext,
      busy: false,
    } : m));
  }

  // Post-plan "edit products": drop the plan + token so the card returns to
  // the intake stage — Execute disappears with the token (fail-closed by
  // absence, never by a disabled-but-present button).
  function handleEditProducts(msg) {
    if (msg.executed || msg.busy) return;
    onMessagesChange((msgs) => msgs.map((m) => m.id === msg.id
      ? { ...m, plan: undefined, blockers: undefined, reviewToken: undefined, reviewExpiresAt: undefined }
      : m));
  }

  // Send dispatcher: route obvious ecomm-quote asks to the deterministic
  // engine; everything else goes to the CRM chat agent.
  function handleSend(overrideText) {
    const text = overrideText || input.trim();
    if (!text || loading) return;
    const msgs = messages || [];
    let lastQuoteIdx = -1;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].kind === 'quote' || msgs[i].kind === 'quote-clarification') { lastQuoteIdx = i; break; }
    }
    const hasPriorQuote = lastQuoteIdx !== -1;
    // 2026-07-09: once the quote moved to Zoho (Send-to-Zoho handoff, or a created
    // Zoho quote link appearing after the ecomm card), follow-ups like "remove the
    // licenses" mean the ZOHO quote — routing them to the stale ecomm session
    // would mutate the wrong quote. Let the CRM agent handle them instead.
    const zohoTookOver = hasPriorQuote && msgs.slice(lastQuoteIdx + 1).some((m) => {
      const body = typeof m.content === 'string' ? m.content : '';
      return /create a zoho crm quote from this stratus quote/i.test(body)
        || /crm\.zoho\.com\/crm\/[^\s)]*\/tab\/Quotes\//i.test(body);
    });
    // R11 routing rule (Chris, 2026-07-15): with an active Zoho record page
    // (or a pinned record), NEVER route to the deterministic ecomm engine
    // unless the user EXPLICITLY asked for an ecomm quote/link ("url quote",
    // "ecomm quote", "quote link/url", "order link", "stratus url", "send me
    // a link"). This fixes the corp R3 misroute where "create a quote for 2
    // MX84 SEC licenses..." sent ON a Zoho Quote page returned an /order/ URL.
    // Off Zoho pages the existing heuristics stand unchanged.
    const onZohoRecord = hasEffectiveZohoRecord({
      contextLock,
      liveZohoContext: zohoPageContext,
      manualPinnedRecord: manualRecord,
      autoPinnedRecord,
    });
    const priorQuote = hasPriorQuote ? msgs[lastQuoteIdx] : null;
    const quoteVariantDecision = hasPriorQuote && !zohoTookOver
      ? resolveQuoteVariantCorrection(quoteDraftRows(priorQuote), text, { activeSkus: ACTIVE_QUOTE_CATALOG_SKUS })
      : null;
    const quoteVariantCorrection = quoteVariantDecision?.kind === 'apply' || quoteVariantDecision?.kind === 'clarify';
    const mxEditionCorrection = hasPriorQuote && !zohoTookOver && isMxEditionQuoteFollowUp(text);
    const explicitNewEcommQuote = isExplicitNewEcommQuoteRequest(text);
    const quoteEditorCorrection = hasPriorQuote && !zohoTookOver && !quoteVariantCorrection
      && !explicitNewEcommQuote && isQuoteEditorCorrectionRequest(text);
    const zohoReviewRequest = hasPriorQuote && !zohoTookOver && isZohoQuoteReviewRequest(text);
    const ecommAllowed = mxEditionCorrection || !onZohoRecord || isExplicitEcommUrlAsk(text);
    if (quoteVariantCorrection) {
      if (!overrideText) setInput('');
      applyDeterministicQuoteVariantCorrection(priorQuote, quoteVariantDecision, text, { requestZoho: zohoReviewRequest });
    } else if (zohoReviewRequest) {
      if (!overrideText) setInput('');
      const requestedTerm = requestedQuoteTermYears(text);
      const options = Array.isArray(priorQuote?.result?.urls) ? priorQuote.result.urls : [];
      const selectedIndex = requestedTerm == null ? -1 : options.findIndex((option) => quoteOptionTerm(option) === requestedTerm);
      appendMessage({ id: nextId(), role: 'user', content: text, timestamp: new Date().toISOString() });
      if (selectedIndex >= 0) {
        handleSendQuoteToZoho(priorQuote, priorQuote.result, selectedIndex);
      } else {
        updateMessage(priorQuote.id, {
          draftStatus: 'Zoho review requested. Select the term option to review, then choose “Create Zoho CRM quote from selected”.',
        });
        appendMessage(infoMsg('Select a term on the current quote card to open its One Shot review. No Zoho record has been created.'));
      }
    } else if (quoteEditorCorrection) {
      if (!overrideText) setInput('');
      applyNaturalLanguageQuoteCorrection(priorQuote, text);
    } else if (ecommAllowed && (isEcommQuoteRequest(text) || (hasPriorQuote && !zohoTookOver && isQuoteFollowUp(text)))) {
      if (!overrideText) setInput('');
      runAndPushQuote(text, {
        priorQuoteText: (mxEditionCorrection || hasPriorQuote && isQuoteFollowUp(text))
          ? messageHistoryText(msgs[lastQuoteIdx]) : null,
        editable: true,
        source: 'chat-quote',
      });
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
    setManualRecord(null);
    setSelectedContextEmail(null);
    setContextDropdownOpen(false);
    if (onStartNewConversation) onStartNewConversation();
    else {
      setAutoPinnedRecord(null);
      onMessagesChange([]);
      if (onUnlockContext) onUnlockContext();
    }
  }, [onMessagesChange, setAutoPinnedRecord, onStartNewConversation, onUnlockContext]);

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
                <button key={i} onClick={() => action.action === 'manual-ecomm-quote'
                  ? startManualEcommQuote()
                  : handleSend(action.text)}
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
          if (msg.role === 'assistant' && msg.kind === 'email-quote-intake') {
            if (msg.restored === true) {
              const restoredLines = normalizeQuoteIntakeLines(msg.intake?.lines || []);
              return (
                <div key={msg.id} style={{ alignSelf: 'stretch', padding: '9px 10px', borderRadius: 8, background: COLORS.BG_SECONDARY, fontSize: 12 }}>
                  <div style={{ fontWeight: 700, marginBottom: 5 }}>Restored Gmail quote intake — review only</div>
                  {restoredLines.map((line, index) => (
                    <div key={`${line.sku}-${line.tier || 'default'}-${index}`}>
                      {line.sku} × {line.qty}
                      {quoteIntakeTierLabel(line.tier) ? ` · ${quoteIntakeTierLabel(line.tier)}` : ''}
                    </div>
                  ))}
                  <div style={{ color: '#e37400', marginTop: 6 }}>
                    Gmail intent, participants, and message provenance are not retained with this restored card. Reopen the intended Gmail conversation and use Create Quote again before rebuilding or starting Zoho review.
                  </div>
                </div>
              );
            }
            return (
              <EmailQuoteIntakeCard
                key={msg.id}
                msg={msg}
                busy={msg.busy === true || loading}
                onUpdate={handleIntakeUpdate}
                onRemove={handleIntakeRemove}
                onBuildQuote={buildEcommQuoteFromIntake}
                onManualSkus={(text) => runAndPushQuote(text)}
              />
            );
          }
          // Deterministic ecomm quote card (1/3/5-yr URLs + refresh suggestions)
          if (msg.role === 'assistant' && msg.kind === 'quote') {
            const draftRows = Array.isArray(msg.draftRows) ? msg.draftRows : editableRowsFromResult(msg.result);
            return (
              <div key={msg.id} style={{
                alignSelf: 'stretch', maxWidth: '100%', padding: '10px 12px',
                borderRadius: 8, background: COLORS.BG_SECONDARY, fontSize: 13,
              }}>
                {msg.note && (
                  <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>{msg.note}</div>
                )}
                {msg.manualQuoteBuilder === true && (!Array.isArray(msg.result?.urls) || msg.result.urls.length === 0) && (
                  <div style={{ marginBottom: 8, padding: 8, border: `1px solid ${COLORS.BORDER}`, borderRadius: 8, background: COLORS.BG_PRIMARY }}>
                    <button
                      type="button"
                      disabled={msg.busy || loading || quoteEditorHasSkuInput(draftRows)}
                      onClick={() => populateManualQuoteFromGmail(msg)}
                      title={quoteEditorHasSkuInput(draftRows)
                        ? 'Clear the current SKU rows before replacing them with Gmail context'
                        : 'Read the current Gmail conversation and populate reviewable SKU rows'}
                      style={{
                        width: '100%', padding: '7px 10px', borderRadius: 6,
                        border: `1px solid ${COLORS.STRATUS_BLUE}`, background: 'transparent',
                        color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 700,
                        cursor: msg.busy || loading || quoteEditorHasSkuInput(draftRows) ? 'default' : 'pointer',
                        opacity: msg.busy || loading || quoteEditorHasSkuInput(draftRows) ? 0.55 : 1,
                      }}
                    >
                      {msg.gmailPopulated ? 'Gmail context populated' : 'Populate from Gmail context'}
                    </button>
                    <div style={{ marginTop: 5, color: COLORS.TEXT_SECONDARY, fontSize: 10 }}>
                      Optional and read-only. Existing manual SKU rows are never overwritten.
                    </div>
                  </div>
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
                  busy={msg.busy || loading}
                  draftRows={msg.restored ? undefined : draftRows}
                  draftDirty={msg.draftDirty === true}
                  draftStatus={msg.draftStatus || ''}
                  resultRevision={msg.resultRevision || 0}
                  onDraftRowsChange={msg.restored ? undefined : (rows) => handleQuoteDraftRowsChange(msg, rows)}
                  draftTier={msg.draftTier || ''}
                  onDraftTierChange={msg.restored ? undefined : (tier) => handleQuoteDraftTierChange(msg, tier)}
                  onUpdateQuote={msg.restored ? undefined : (rows) => rebuildQuoteMessage(msg, rows)}
                  quoteUpdateLabel={msg.manualQuoteBuilder === true && (!Array.isArray(msg.result?.urls) || msg.result.urls.length === 0)
                    ? 'Generate quote'
                    : 'Update quote'}
                  onProductSearch={msg.restored ? undefined : searchQuoteProducts}
                  allowHaLicenseRatio={explicitQuoteHaRequested(msg)}
                  onApplySuggestion={msg.restored ? undefined : (s) => handleQuoteSuggestion(msg, s, 'apply', draftRows)}
                  onStackSuggestion={msg.restored ? undefined : (s) => handleQuoteSuggestion(msg, s, 'stack', draftRows)}
                  onSendToZoho={msg.restored ? undefined : (result, selectedUrlIdx) => handleSendQuoteToZoho(msg, result, selectedUrlIdx)}
                />
                {msg.restored && (
                  <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 4 }}>
                    Restored safely from this browser session. Copy or open these links; re-run the quote before starting a CRM workflow.
                  </div>
                )}
              </div>
            );
          }
          // One-shot reviewed-plan card (customer→quote). Only cards created
          // from the explicit eCommerce quote button are actionable; legacy
          // intake/auto cards render inert so they cannot bypass that consent.
          if (msg.role === 'assistant' && msg.kind === 'oneshot') {
            if (msg.consentSource !== 'quote-card-button') {
              return (
                <div key={`${msg.id}:retired`} style={{ alignSelf: 'stretch', padding: '8px 10px', borderRadius: 8, background: COLORS.BG_SECONDARY, fontSize: 12 }}>
                  This older one-shot draft is inactive. Generate an eCommerce quote, then click “Create Zoho CRM quote from this.”
                </div>
              );
            }
            return (
              <OneshotPlanCard
                key={`${msg.id}:${msg.planRevision || 0}`}
                msg={msg}
                busy={msg.busy === true || loading}
                onReplan={(overrides, messagePatch) => replanOneshot(msg, overrides, messagePatch)}
                onRefreshContext={() => refreshOneshotFromContext(msg)}
                onQuoteOptionChange={(selectedQuoteOptionIndex, messagePatch) => changeOneshotQuoteOption(msg, selectedQuoteOptionIndex, messagePatch)}
                onExecute={(decisions) => executeOneshotCard(msg, decisions)}
                onEditProducts={msg.intake ? () => handleEditProducts(msg) : undefined}
                onProductSearch={searchQuoteProducts}
              />
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
            // NOTE: msg.quoteUrls is the DRAFT shape (from result.quoteUrls) and is
            // not interchangeable with msg.result.urls used by the quote card.
            const dUrls = Array.isArray(msg.quoteUrls) ? msg.quoteUrls : [];
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
                {dUrls.length > 0 && (
                  <div style={{ marginTop: 8, paddingTop: 6, borderTop: `1px solid ${COLORS.BORDER || 'rgba(0,0,0,0.12)'}` }}>
                    <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 3 }}>
                      Quote links (engine-built)
                    </div>
                    {dUrls.map((q, qi) => {
                      const url = typeof q === 'string' ? q : (q && q.url) || '';
                      const label = (q && q.label) || `Quote ${qi + 1}`;
                      if (!/^https?:\/\//i.test(url)) return null;
                      return (
                        <div key={qi} style={{ fontSize: 12, marginBottom: 2 }}>
                          <a href={url} target="_blank" rel="noreferrer" style={{ color: COLORS.STRATUS_BLUE }}>{label}</a>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <CopyButton text={msg.content} />
                  {dUrls.length > 0 && <CopyDraftWithLinks text={msg.content} quoteUrls={dUrls} />}
                </div>
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
              {msg.role === 'assistant'
                // R8b (corp error_reports 2026-07-14): NEVER render an empty
                // assistant bubble — the corp misroute returned a quote-URL
                // reply that displayed as a blank message. Empty/whitespace
                // content gets a visible fallback so the user can recover
                // instead of staring at a blank bubble.
                ? (String(msg.content || '').trim()
                  ? renderMarkdown(msg.content)
                  : <em style={{ color: COLORS.TEXT_SECONDARY }}>
                    ⚠️ Empty reply received. If you asked for a quote, say "resend that quote link" or rephrase the request.
                  </em>)
                : msg.content}
              {msg.role === 'assistant' && msg.recovery && (
                <div style={{
                  marginTop: 8, padding: '8px 10px', borderRadius: 7,
                  border: `1px solid ${msg.recovery.write_state === 'possible' ? '#d9302566' : '#f9ab0066'}`,
                  background: msg.recovery.write_state === 'possible' ? '#fce8e6' : '#fef7e0',
                  color: COLORS.TEXT_PRIMARY,
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
                    {msg.recovery.title || 'Recovery required'}
                  </div>
                  {Array.isArray(msg.recovery.actions) && msg.recovery.actions.map((action, index) => (
                    <div key={index} style={{ fontSize: 11, marginTop: 2 }}>
                      {index + 1}. {action}
                    </div>
                  ))}
                </div>
              )}
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
              background: contextLock
                ? (contextLock.sourceAvailable === false ? '#fff4e5' : '#e6f4ea')
                : ((manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_LIGHT : COLORS.BG_SECONDARY),
              border: `1px solid ${contextLock
                ? (contextLock.sourceAvailable === false ? '#e37400' : '#0b8043')
                : ((manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_BLUE + '55' : COLORS.BORDER)}`,
              borderRadius: 6, fontSize: 11,
              color: contextLock
                ? (contextLock.sourceAvailable === false ? '#b06000' : '#0b8043')
                : ((manualRecord || activeContextEmail || (zohoPageContext && zohoPageContext.recordId)) ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY),
              cursor: 'pointer', width: '100%', textAlign: 'left',
            }}
            title={contextLock
              ? 'Context is locked to this chat. Open for Unlock or Replace.'
              : 'Change or lock which page context is attached to this chat'}
          >
            <span style={{ opacity: 0.75 }}>
              {contextLock ? '🔒' : (manualRecord ? '📌' : ((autoPinnedRecord && autoPinnedRecord.recordId) ? '📌' : (zohoPageContext && zohoPageContext.recordId ? '📄' : '📎')))}
            </span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 500 }}>
              {(() => {
                const MOD = {Quotes:'Quote',Potentials:'Deal',Deals:'Deal',Accounts:'Account',Contacts:'Contact',Tasks:'Task',SalesOrders:'Sales Order',Invoices:'Invoice'};
                const active = (zohoPageContext && zohoPageContext.recordId) ? zohoPageContext : null;
                if (contextLock) {
                  const viewing = active && contextLock.kind !== 'zoho'
                    ? `  •  Viewing: ${active.recordName || active.recordId}`
                    : '';
                  const stale = contextLock.sourceAvailable === false ? '  •  source unavailable' : '';
                  return `Locked: ${contextLockLabel(contextLock)}${viewing}${stale}`;
                }
                const pinnedAccount = manualRecord && manualRecord.module === 'Accounts' ? manualRecord : null;
                const pinnedOther = manualRecord && manualRecord.module !== 'Accounts' ? manualRecord : null;
                // User explicitly pinned a non-Account record — that wins.
                if (pinnedOther) {
                  const m = MOD[pinnedOther.module] || pinnedOther.module;
                  return `${m}: ${pinnedOther.recordName || pinnedOther.recordId}`;
                }
                // R7: when a conversation pin differs from the live tab, show
                // both. A supplemental manual Account must never hide the
                // conversation pin because deictic actions still target it.
                const convPin = (autoPinnedRecord && autoPinnedRecord.recordId) ? autoPinnedRecord : null;
                if (convPin && (pinnedAccount || !active || active.recordId !== convPin.recordId)) {
                  const m = MOD[convPin.module] || convPin.module;
                  const viewing = active && active.recordId !== convPin.recordId
                    ? `  •  Viewing: ${active.recordName || active.recordId}`
                    : '';
                  const account = pinnedAccount
                    ? `  •  Acct: ${pinnedAccount.recordName || pinnedAccount.recordId}`
                    : '';
                  return `📌 Pinned ${m}: ${convPin.recordName || convPin.recordId}${viewing}${account}`;
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
            {!contextLock && autoPinnedRecord && autoPinnedRecord.recordId && (
              <span
                onClick={(e) => { e.stopPropagation(); setAutoPinnedRecord(null); }}
                style={{ fontSize: 10, opacity: 0.7, padding: '0 3px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                title="Clear the conversation's pinned record"
              >
                Pin ✕
              </span>
            )}
            {!contextLock && manualRecord && (
              <span
                onClick={(e) => { e.stopPropagation(); handleClearPinned(); }}
                style={{ fontSize: 10, opacity: 0.7, padding: '0 3px', cursor: 'pointer', whiteSpace: 'nowrap' }}
                title="Unpin the manually selected record"
              >
                {manualRecord.module === 'Accounts' && autoPinnedRecord && autoPinnedRecord.recordId ? 'Acct ✕' : '✕'}
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
              {contextLock ? (
                <div style={{ padding: '8px 10px' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: contextLock.sourceAvailable === false ? '#b06000' : '#0b8043' }}>
                    🔒 Locked to this chat
                  </div>
                  <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, margin: '4px 0 8px' }}>
                    {contextLockLabel(contextLock)}
                    {contextLock.sourceAvailable === false
                      ? ' · The source tab moved or closed; the captured snapshot remains authoritative.'
                      : ' · Page switches cannot replace this snapshot.'}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => { onUnlockContext?.(); setContextDropdownOpen(false); }}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: 4,
                        border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_SECONDARY,
                        color: COLORS.TEXT_PRIMARY, fontSize: 11, cursor: 'pointer',
                      }}
                    >
                      🔓 Unlock
                    </button>
                    <button
                      onClick={async () => {
                        await onLockCurrentContext?.();
                        setContextDropdownOpen(false);
                      }}
                      style={{
                        flex: 1, padding: '6px 8px', borderRadius: 4,
                        border: `1px solid ${COLORS.STRATUS_BLUE}`, background: COLORS.STRATUS_BLUE,
                        color: 'white', fontSize: 11, cursor: 'pointer', fontWeight: 600,
                      }}
                    >
                      🔄 Replace with current page
                    </button>
                  </div>
                </div>
              ) : !searchMode ? (
                <div style={{ padding: '4px 0' }}>
                  <button
                    onClick={async () => {
                      await onLockCurrentContext?.();
                      setContextDropdownOpen(false);
                    }}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '7px 12px', background: '#e6f4ea',
                      border: 'none', cursor: 'pointer', fontSize: 11,
                      color: '#0b8043', fontWeight: 700,
                    }}
                    title="Freeze the current Gmail, Zoho, or general page context for this chat"
                  >
                    🔒 Lock current page context
                  </button>
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

                  {/* R7: conversation pin controls — visible when the pinned
                      record differs from the tab the user is on. "Use current
                      tab" re-pins deliberately; the model then targets the
                      record the user is actually looking at. */}
                  {autoPinnedRecord && autoPinnedRecord.recordId
                    && (!zohoPageContext || zohoPageContext.recordId !== autoPinnedRecord.recordId) && (
                    <button
                      onClick={() => {
                        setAutoPinnedRecord(zohoPageContext && zohoPageContext.recordId ? { ...zohoPageContext } : null);
                        setContextDropdownOpen(false);
                      }}
                      style={{
                        display: 'block', width: '100%', textAlign: 'left',
                        padding: '6px 12px', background: 'transparent',
                        border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.STRATUS_BLUE, fontWeight: 600,
                      }}
                      title="Replace the conversation's pinned record with the tab you are viewing now"
                    >
                      🔄 Use current tab{zohoPageContext && zohoPageContext.recordId
                        ? ` (${zohoPageContext.recordName || zohoPageContext.recordId})`
                        : ' (no Zoho record open — unpins)'}
                    </button>
                  )}

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
