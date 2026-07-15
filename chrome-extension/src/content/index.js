/**
 * Stratus AI Chrome Extension — Content Script (Gmail DOM)
 *
 * Runs in the Gmail page context. Responsible for:
 * - Detecting email opens/changes via MutationObserver
 * - Extracting email data from the DOM
 * - Adding the Send + Task button to the compose toolbar
 * - Clipboard operations
 */

import { MSG, DEAL_ID_PATTERN, CONSUMER_DOMAINS, COLORS } from '../lib/constants.js';
import { sendToBackground, onMessage } from '../lib/messaging.js';
import './gmail-observer.js';

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

window.addEventListener('error', (event) => {
  console.error('[Stratus AI] Gmail content script error:', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno,
    stack: event.error?.stack,
  });
});

window.addEventListener('unhandledrejection', (event) => {
  console.error(
    '[Stratus AI] Gmail content script promise rejection:',
    event.reason?.stack || event.reason?.message || event.reason
  );
});

console.log('[Stratus AI] Content script loaded on Gmail.');

let lastEmailHash = '';
let lastCrmLookupEmail = '';
// Set on every Gmail SPA navigation. During a thread switch there is a brief
// window where the subject h2 still carries the PREVIOUS thread's perm id
// while the new thread's messages are already rendering — cache reads/writes
// keyed by perm id are suppressed until the view settles (see Pass 4).
let lastThreadNavAt = Date.now();
const THREAD_NAV_SETTLE_MS = 600;

// Bot/notification emails — exclude from contact extraction (module-scoped for reuse)
const BOT_EMAILS = new Set([
  'notifications@mixmax.com',
  'notificationsapp@cisco.com',
  'eweichel@cisco.com',
  'noreply@webex.com',
  'noreply@google.com',
  'mailer-daemon@googlemail.com',
  'mailer-daemon@google.com',
  'no-reply@accounts.google.com',
  'no-reply@cisco.com',
  'donotreply@cisco.com',
]);

// ── Per-thread participant memory + print-view header fetch ──
//
// 2026-07: Gmail virtualizes the thread view — middle messages collapse into
// an "N older" pill with no per-message DOM, and recipient chips in expanded
// headers no longer carry email attributes until hovered. Any single DOM pass
// can therefore miss participants entirely (intro threads often expose ONLY
// the Cisco rep's address). Two defenses:
//   1. threadContactsCache accumulates every participant ever seen for a
//      thread (grow-only — real thread participants never shrink), so a
//      later sparse re-render can't lose people found earlier.
//   2. fetchThreadHeaderParticipants pulls the thread's print view
//      (?view=pt&permthid=...), whose From/To/Cc header lines list every
//      participant regardless of DOM virtualization.
const threadContactsCache = new Map(); // permId -> Map<lowerEmail, {email,name,role}>
const printFetchState = new Map();     // permId -> 'pending' | 'done' | <failedAt ms>
const THREAD_CACHE_MAX = 50;
const PRINT_RETRY_MS = 120000;

function getThreadPermId() {
  const el = document.querySelector('[data-thread-perm-id]');
  return el ? el.getAttribute('data-thread-perm-id') : null;
}

function threadCacheFor(permId) {
  let cache = threadContactsCache.get(permId);
  if (!cache) {
    cache = new Map();
    threadContactsCache.set(permId, cache);
    if (threadContactsCache.size > THREAD_CACHE_MAX) {
      const oldest = threadContactsCache.keys().next().value;
      if (oldest !== permId) {
        threadContactsCache.delete(oldest);
        printFetchState.delete(oldest);
      }
    }
  }
  return cache;
}

/**
 * Convert a fragment of Gmail print-view HTML to plain text. Pure string
 * transforms only — Gmail's page enforces Trusted Types, which makes
 * DOMParser.parseFromString throw, and textContent would drop the line
 * structure the header parser needs anyway.
 */
function printHtmlToText(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br[^>]*>/gi, '\n')
    .replace(/<\/(?:tr|td|th|div|p|font|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/**
 * Parse participants out of a Gmail print view (?view=pt). Each message is a
 * class="message" block laid out as: sender line + class="recipient" To:/Cc:
 * lines, THEN a <table> wrapping the message body. Only the pre-table header
 * region is scanned, so body content (quoted reply headers, signatures,
 * attacker-crafted "To: x <y@z>" lines) can never inject participants, and
 * Bcc lines are deliberately never harvested (blind-copied addresses must
 * not surface as thread participants). Returns most-mentioned participants
 * first so downstream "pick the customer" defaults favor real counterparties
 * over one-off Cc's.
 */
function parsePrintHeaderParticipants(html) {
  const found = new Map(); // lowerEmail -> {email, name, role, count}
  const collectPairs = (segment, role) => {
    // Quoted display name first (may contain commas: "Goosic, Kevin"),
    // then unquoted name, then bare address.
    const pairRe = /"([^"<>]{1,80})"\s*<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>|([^"<>@,;\n]{1,80}?)\s*<([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})>|([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
    let pair;
    while ((pair = pairRe.exec(segment)) !== null) {
      const email = (pair[2] || pair[4] || pair[5] || '').trim();
      if (!email) continue;
      const lower = email.toLowerCase();
      if (lower.includes('@stratusinfosystems.com')) continue;
      if (BOT_EMAILS.has(lower)) continue;
      const name = (pair[1] || pair[3] || '').trim();
      const cur = found.get(lower);
      if (cur) {
        cur.count += 1;
        if (name && name.length > cur.name.length) cur.name = name;
      } else {
        found.set(lower, { email, name, role, count: 1 });
      }
    }
  };
  const chunks = html.split(/class="message"/).slice(1);
  for (const chunk of chunks) {
    let end = chunk.indexOf('<table');
    if (end === -1) {
      const quote = chunk.search(/class="gmail_(?:quote|attr)"/);
      end = quote !== -1 ? quote : Math.min(chunk.length, 1200);
    }
    const headerText = printHtmlToText(chunk.slice(0, end));
    for (const rawLine of headerText.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      const labeled = line.match(/^(To|Cc):\s*(.*)$/i);
      if (labeled) {
        collectPairs(labeled[2], labeled[1].toLowerCase() === 'to' ? 'to' : 'cc');
      } else if (/^(?:Bcc|Reply-To|Date|Subject|Sent):/i.test(line)) {
        continue;
      } else if (/<[A-Za-z0-9._%+-]+@/.test(line)) {
        collectPairs(line, 'sender'); // unlabeled sender line: "Name <email>"
      }
    }
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

/**
 * Fetch the thread's print view and fold its header participants into the
 * per-thread cache. Fire-and-forget: on success it re-triggers detection so
 * the enriched context is re-broadcast (the participant-aware hash in
 * onEmailChanged lets it through).
 */
async function fetchThreadHeaderParticipants(permId) {
  if (!permId) return;
  const state = printFetchState.get(permId);
  if (state === 'pending' || state === 'done') return;
  if (typeof state === 'number' && Date.now() - state < PRINT_RETRY_MS) return;
  printFetchState.set(permId, 'pending');
  try {
    const acct = (window.location.pathname.match(/^\/mail\/u\/(\d+)/) || [])[1] || '0';
    const res = await fetch(
      `/mail/u/${acct}/?view=pt&search=all&permthid=${encodeURIComponent(permId)}`,
      { credentials: 'include' }
    );
    if (!res.ok) {
      printFetchState.set(permId, Date.now());
      return;
    }
    const participants = parsePrintHeaderParticipants(await res.text());
    if (!participants.length) {
      // A 200 with zero parsed participants is a soft failure (interstitial,
      // truncated body, layout change) — schedule a retry instead of latching
      // 'done' and silently disabling this source for the thread.
      printFetchState.set(permId, Date.now());
      return;
    }
    const cache = threadCacheFor(permId);
    for (const p of participants) {
      const lower = p.email.toLowerCase();
      const existing = cache.get(lower);
      if (existing) {
        if (p.name && p.name.length > (existing.name || '').length) existing.name = p.name;
      } else {
        cache.set(lower, { email: p.email, name: p.name, role: p.role || 'cc' });
      }
    }
    printFetchState.set(permId, 'done');
    checkForEmailView();
  } catch {
    printFetchState.set(permId, Date.now());
  }
}

// ─────────────────────────────────────────────
// Email Detection
// ─────────────────────────────────────────────

/**
 * Extract email data from Gmail's DOM when an email/thread is opened.
 * Gmail's DOM is complex and class names change, so we use multiple strategies.
 */
function extractVisibleThreadBody() {
  const candidates = Array.from(document.querySelectorAll('.a3s.aiL, .gs .a3s, [data-message-id] .a3s'));
  const seen = new Set();
  const parts = [];

  for (const el of candidates) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;

    const text = (el.innerText || el.textContent || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{4,}/g, '\n\n\n')
      .trim();
    if (!text) continue;

    const fingerprint = text.substring(0, 500);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    parts.push(text);
  }

  return parts.join('\n\n--- message ---\n\n').substring(0, 20000);
}

/**
 * R8b (corp error_reports 2026-07-14): scan the visible thread DOM for Stratus
 * ecomm order links (stratusinfosystems.com/order/?item=…). Gmail usually
 * renders these as anchors whose VISIBLE text is truncated or friendly, so the
 * innerText-based thread extraction above never sees the actual URL — the href
 * is DOM-only, which left the quote quick-action blind to a quote link sitting
 * right in the email. Collects hrefs (unwrapping Google's google.com/url?q=
 * redirect) plus literal in-text URLs, dedupes, and caps at 5. The worker's
 * STRATUS URL ECHOBACK / parse_quote_url machinery resolves exact items+qtys.
 */
function extractThreadOrderUrls() {
  const containers = Array.from(document.querySelectorAll('.a3s.aiL, .gs .a3s, [data-message-id] .a3s'));
  const urls = [];
  const seen = new Set();
  const ORDER_URL_RE = /https?:\/\/[^\s)\]>"']*stratusinfosystems\.com\/order\/\?[^\s)\]>"']+/i;
  for (const el of containers) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
    const hrefs = Array.from(el.querySelectorAll('a[href]')).map((a) => a.getAttribute('href') || '');
    const textMatches = (el.innerText || '').match(new RegExp(ORDER_URL_RE.source, 'gi')) || [];
    for (let raw of [...hrefs, ...textMatches]) {
      if (!raw || !/stratusinfosystems\.com/i.test(raw)) continue;
      const gm = raw.match(/^https?:\/\/www\.google\.com\/url\?.*?[?&]q=([^&]+)/i);
      if (gm) { try { raw = decodeURIComponent(gm[1]); } catch { /* keep raw */ } }
      const m = raw.match(ORDER_URL_RE);
      if (!m) continue;
      const url = m[0];
      if (seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
      if (urls.length >= 5) return urls;
    }
  }
  return urls;
}

function normalizeVisibleMessageText(el, maxLength = 8000) {
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) return '';
  return (el.innerText || el.textContent || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
    .substring(0, maxLength);
}

function extractVisibleMessageContexts() {
  const bodies = Array.from(document.querySelectorAll('.a3s.aiL, .gs .a3s, [data-message-id] .a3s'));
  const seen = new Set();
  const contexts = [];

  bodies.forEach((bodyEl, index) => {
    const body = normalizeVisibleMessageText(bodyEl, 8000);
    if (!body) return;

    const fingerprint = body.substring(0, 500);
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);

    const container = bodyEl.closest('[data-message-id], .adn, .gs') || bodyEl.parentElement || bodyEl;
    const senderEl = container.querySelector('.gD[email], .gD[data-hovercard-id], [email].gD, [data-hovercard-id].gD')
      || container.querySelector('[email], [data-hovercard-id]');
    let fromEmail = senderEl?.getAttribute('email') || senderEl?.getAttribute('data-hovercard-id') || '';
    let fromName = senderEl?.getAttribute('name') || senderEl?.textContent?.trim() || '';

    if (!fromEmail) {
      const fromMatch = body.match(/(?:^|\n)\s*From:\s*([^<\n]+)?<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/i);
      if (fromMatch) {
        fromName = (fromMatch[1] || '').trim() || fromName;
        fromEmail = fromMatch[2] || '';
      }
    }

    const allMessageEmails = new Set();
    container.querySelectorAll('[email], [data-hovercard-id]').forEach(el => {
      const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
      if (email && email.includes('@')) allMessageEmails.add(email.toLowerCase());
    });
    const bodyEmailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    let m;
    while ((m = bodyEmailPattern.exec(body)) !== null) {
      allMessageEmails.add(m[0].toLowerCase());
    }

    contexts.push({
      index,
      fromEmail,
      fromName,
      fromDomain: fromEmail.includes('@') ? fromEmail.split('@')[1].toLowerCase() : '',
      emails: [...allMessageEmails],
      body: body.substring(0, 4000),
      signatureTail: body.slice(-3000),
    });
  });

  return contexts;
}

function extractEmailData(options = {}) {
  // Strategy 1: URL-based detection
  const hash = window.location.hash;
  // Gmail thread hashes: #inbox/FMfcg..., #sent/FMfcg..., #label/FMfcg..., etc.
  const isThreadView = hash && /^#[a-zA-Z0-9_/]+\/[A-Za-z0-9]+/.test(hash);
  if (!hash || (!isThreadView && !hash.includes('/'))) return null;

  // Strategy 2: Subject line detection (try multiple selectors)
  const subjectEl = document.querySelector('h2.hP')
    || document.querySelector('[data-thread-perm-id] h2')
    || document.querySelector('.ha h2')
    || document.querySelector('[role="main"] h2');
  if (!subjectEl) {
    console.log('[Stratus AI] No subject element found. Selectors tried: h2.hP, [data-thread-perm-id] h2, .ha h2, [role="main"] h2');
    return null;
  }

  const subject = subjectEl.textContent.trim();

  // Strategy 3: Sender info from expanded email header (try multiple selectors)
  const senderEl = document.querySelector('.gD')
    || document.querySelector('[data-hovercard-id]')
    || document.querySelector('.go [email]');
  let senderEmail = '';
  let senderName = '';
  if (senderEl) {
    senderEmail = senderEl.getAttribute('email') || senderEl.getAttribute('data-hovercard-id') || '';
    senderName = senderEl.getAttribute('name') || senderEl.textContent.trim();
  }

  // Get email body (try multiple selectors)
  const bodyEl = document.querySelector('.a3s.aiL')
    || document.querySelector('.ii.gt div')
    || document.querySelector('[data-message-id] .a3s');
  const fullThreadBody = options.includeFullThread ? extractVisibleThreadBody() : '';
  const messageContexts = extractVisibleMessageContexts();
  const body = options.includeFullThread
    ? (fullThreadBody || bodyEl?.innerText || '').substring(0, 12000)
    : (bodyEl ? bodyEl.innerText.substring(0, 8000) : '');

  // Collect all participants with role information
  const allEmails = new Set();
  const allDomains = new Set();
  const threadContacts = [];
  const contactsByEmail = new Map(); // For deduplication while preserving role

  // ── SCOPED THREAD CONTAINER ──
  // Gmail wraps the active thread view in a container. We MUST scope all
  // contact queries to this container, otherwise we pick up email addresses
  // from the inbox list, other collapsed threads, and workspace notifications.
  //
  // 2026-07: Gmail moved data-thread-perm-id onto the <h2 class="hP"> subject
  // heading itself — it no longer marks a wrapper around the messages, so a
  // bare [data-thread-perm-id] match scopes to the headline and finds zero
  // contacts. Only trust a candidate that actually contains message contacts;
  // the conversation is now reliably wrapped by [role="main"] [role="list"].
  const permIdEl = document.querySelector('div[data-thread-perm-id]');
  const threadContainer =
    (permIdEl && permIdEl.querySelector('[email], [data-hovercard-id]') ? permIdEl : null) ||
    document.querySelector('[role="main"] [role="list"]') || // Conversation message list (2026 Gmail)
    document.querySelector('.nH.if') ||                     // Thread view container (legacy)
    document.querySelector('.AO') ||                        // Fallback: main content area
    document.querySelector('[role="main"]');                 // Last resort

  // If no thread container found, fall back to document but log a warning
  const scopeEl = threadContainer || document;
  if (!threadContainer) {
    console.warn('[Stratus AI] No thread container found — contact extraction may be inaccurate');
  }

  // Helper function to determine role based on DOM context
  function determineRole(element) {
    // Check if element is within a "To:" section
    const toSection = element.closest('[data-tooltip="To"]') ||
                     element.closest('.a8T') ||
                     (element.parentElement?.textContent.includes('To:') ? element.parentElement : null);
    if (toSection) return 'to';

    // Check if element is within a "Cc:" section
    const ccSection = element.closest('[data-tooltip="Cc"]') ||
                     element.closest('.a8T') ||
                     (element.parentElement?.textContent.includes('Cc:') ? element.parentElement : null);
    if (ccSection) return 'cc';

    // Default to sender (elements from email headers without explicit to/cc context)
    return 'sender';
  }

  // BOT_EMAILS is defined at module scope (top of file)

  // Track Cisco rep emails on the thread (cisco.com domain, non-bot)
  const ciscoEmails = [];

  // ── Pass 1: Scoped query within thread container ──
  function collectFromEl(el, defaultRole = 'sender') {
    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    if (lower.includes('@stratusinfosystems.com')) return;
    if (BOT_EMAILS.has(lower)) return;

    allEmails.add(lower);
    const domain = email.split('@')[1];
    if (domain) allDomains.add(domain);

    const name = el.getAttribute('name') || el.textContent.trim();
    const role = el.closest ? (determineRole(el) || defaultRole) : defaultRole;

    if (!contactsByEmail.has(lower)) {
      contactsByEmail.set(lower, { email, name, role });
    } else {
      const existing = contactsByEmail.get(lower);
      const roleMap = { sender: 3, cc: 2, to: 1 };
      if ((roleMap[role] || 0) > (roleMap[existing.role] || 0)) existing.role = role;
      if (name && name.length > (existing.name || '').length) existing.name = name;
    }
    if (domain === 'cisco.com' && !ciscoEmails.includes(lower)) ciscoEmails.push(lower);
  }

  // Broad set of Gmail email-attribute selectors (covers sender chips, recipient chips,
  // To/CC labels, hovercard data) — scoped to thread first
  const EMAIL_SELECTORS = '.gD, .g2, .go, .hb, [email], [data-hovercard-id], .afv [email], .T-I-ax7 [email]';
  scopeEl.querySelectorAll(EMAIL_SELECTORS).forEach(el => collectFromEl(el, 'sender'));

  // ── Pass 2: Broader document scan as fallback ──
  // Gmail thread participants in collapsed messages are often outside the scoped container.
  // Expand by scanning the entire [role="main"] for any element with email attributes.
  const mainEl = document.querySelector('[role="main"]') || document.body;
  mainEl.querySelectorAll('[email], [data-hovercard-id]').forEach(el => {
    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    if (lower.includes('@stratusinfosystems.com')) return;
    if (BOT_EMAILS.has(lower)) return;
    // Only include if inside a message view or email header (not inbox row)
    const isInboxRow = el.closest('.zA') || el.closest('.xT') || el.closest('.yX') || el.closest('.aDP');
    if (isInboxRow) return;
    // No already-captured skip here: collectFromEl dedupes by email and merges
    // in a longer name — the first DOM hit for a participant is often the
    // avatar element (data-hovercard-id, empty text), so skipping seen emails
    // left contacts permanently nameless.
    collectFromEl(el, 'cc');
  });

  // ── Pass 3: Look for reply/forward headers in email body ──
  // Gmail often includes "From: Name <email@domain.com>" lines in quoted replies
  document.querySelectorAll('.a3s.aiL, .gs .a3s').forEach(bodyEl => {
    const text = bodyEl.innerText || bodyEl.textContent || '';
    // Match "From: Name <email>" or "To: Name <email>" patterns in quoted text
    const headerPattern = /(?:From|To|Cc|Reply-To):.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let m;
    while ((m = headerPattern.exec(text)) !== null) {
      const email = m[1].toLowerCase();
      if (allEmails.has(email)) continue;
      if (email.includes('@stratusinfosystems.com')) continue;
      if (BOT_EMAILS.has(email)) continue;
      const domain = email.split('@')[1] || '';
      if (!domain) continue;
      allEmails.add(email);
      allDomains.add(domain);
      if (!contactsByEmail.has(email)) {
        contactsByEmail.set(email, { email, name: email.split('@')[0], role: 'cc' });
      }
      if (domain === 'cisco.com' && !ciscoEmails.includes(email)) ciscoEmails.push(email);
    }
  });

  // ── Pass 4: per-thread memory + print-view header participants ──
  // Fold this extraction's finds into the grow-only thread cache, fold the
  // cache (DOM finds from earlier renders + print-view header participants)
  // back into this result, and kick off the print-view fetch on first sight.
  // Suppressed while a thread switch is settling: the perm id and the message
  // list can transiently belong to DIFFERENT threads, and one mismatched merge
  // would poison the grow-only cache (wrong customer into CRM/quoting). The
  // debounced observer path and the 2s recheck re-run this after settling.
  const navSettled = Date.now() - lastThreadNavAt > THREAD_NAV_SETTLE_MS;
  const threadPermId = navSettled ? getThreadPermId() : null;
  if (threadPermId) {
    const cache = threadCacheFor(threadPermId);
    const roleMap = { sender: 3, cc: 2, to: 1 };
    for (const [lower, contact] of contactsByEmail) {
      const cached = cache.get(lower);
      if (!cached) {
        cache.set(lower, { ...contact });
      } else {
        if (contact.name && contact.name.length > (cached.name || '').length) cached.name = contact.name;
        if ((roleMap[contact.role] || 0) > (roleMap[cached.role] || 0)) cached.role = contact.role;
      }
    }
    for (const [lower, cached] of cache) {
      if (!contactsByEmail.has(lower)) {
        // DOM finds stay first in insertion order, so visible participants
        // keep priority when the customer default is picked below.
        contactsByEmail.set(lower, { ...cached });
        allEmails.add(lower);
        const domain = lower.split('@')[1];
        if (domain) allDomains.add(domain);
        if (domain === 'cisco.com' && !ciscoEmails.includes(lower)) ciscoEmails.push(lower);
      } else {
        const contact = contactsByEmail.get(lower);
        if (cached.name && cached.name.length > (contact.name || '').length) contact.name = cached.name;
      }
    }
    fetchThreadHeaderParticipants(threadPermId);
  }

  // Populate threadContacts — filter consumer domains for CRM lookup
  for (const contact of contactsByEmail.values()) {
    threadContacts.push(contact);
  }

  const isOutbound = senderEmail.toLowerCase().includes('@stratusinfosystems.com');

  // Find customer email — prefer non-Cisco, non-Stratus participants.
  // Stratus emails are already filtered out during extraction. Cisco reps
  // still appear in threadContacts (for the dropdown/ciscoEmails list) but
  // should never be the default customerEmail. Fall back to first Cisco
  // rep only if literally no other external participant is present.
  let customerEmail = '';
  let customerName = '';
  let customerDomain = '';
  let fallbackCiscoContact = null;
  for (const contact of threadContacts) {
    const domain = (contact.email.split('@')[1] || '').toLowerCase();
    if (domain === 'cisco.com') {
      if (!fallbackCiscoContact) fallbackCiscoContact = contact;
      continue;
    }
    customerEmail = contact.email;
    customerName = contact.name;
    customerDomain = domain;
    break;
  }
  if (!customerEmail && fallbackCiscoContact) {
    customerEmail = fallbackCiscoContact.email;
    customerName = fallbackCiscoContact.name;
    customerDomain = (fallbackCiscoContact.email.split('@')[1] || '').toLowerCase();
  }

  // CCW Deal ID detection from subject line (Cisco Commerce notification emails)
  // Subject pattern: "CCW Quote #123456789012345" or "Deal ID: 123456789012345"
  let ccwDealNumber = null;
  const ccwSubjectMatch = subject.match(/(?:CCW[^\d]*|Deal\s*(?:ID|Number|#)[:\s#]*|Quote\s*#\s*)(\d{5,20})/i);
  if (ccwSubjectMatch) ccwDealNumber = ccwSubjectMatch[1];

  // Also check if this is a Cisco Commerce notification email
  const isCiscoNotification = senderEmail.toLowerCase() === 'notificationsapp@cisco.com'
    || senderEmail.toLowerCase().includes('@cisco.com');

  return {
    subject,
    body,
    ...(options.includeFullThread ? { fullThreadBody } : {}),
    // R8b: Stratus /order/ links found in the thread DOM (href-only links are
    // invisible to the innerText extraction above). Always included — cheap,
    // and the quote quick-action needs it even without the full thread body.
    threadOrderUrls: extractThreadOrderUrls(),
    senderEmail,
    senderName,
    customerEmail,
    customerName,
    customerDomain,
    isOutbound,
    allEmails: [...allEmails],
    allDomains: [...allDomains],
    threadContacts,
    messageContexts,
    ciscoEmails,         // Cisco rep emails detected on thread
    ccwDealNumber,       // CCW Deal ID if detected in subject
    isCiscoNotification, // True for notificationsapp@cisco.com
    url: window.location.href,
    extractedAt: Date.now(),
  };
}

/**
 * Called when we detect an email has been opened/changed.
 */
async function onEmailChanged() {
  const data = extractEmailData();
  if (!data) return;

  // Deduplicate — don't re-process the same extraction result. The hash MUST
  // include the participant set: Gmail hydrates a thread progressively, so an
  // early extraction can see only the first message's sender (often a Cisco
  // rep). A subject+sender-only hash froze that partial snapshot — richer
  // re-extractions were discarded, and the sidebar never saw the customer.
  // Name lengths are included so late-hydrating display names (hover chips,
  // print-view headers) also re-broadcast, not just new addresses.
  const participantDigest = (data.threadContacts || [])
    .map((c) => `${(c.email || '').toLowerCase()}:${(c.name || '').length}`)
    .sort()
    .join(',');
  const emailHash = `${data.subject}_${data.senderEmail}_${participantDigest}`;
  if (emailHash === lastEmailHash) return;
  lastEmailHash = emailHash;

  // Notify background service worker
  await sendToBackground(MSG.EMAIL_CHANGED, data).catch(() => {});

  // Re-check after Gmail finishes hydrating collapsed messages. If nothing
  // changed, the hash gate above makes this a no-op; if late-rendered
  // participants appeared, this re-sends the richer context. Only scheduled
  // on a successful send, so it converges instead of looping.
  setTimeout(() => checkForEmailView(), 2000);

  // Auto-CRM lookup for non-consumer domains
  const primaryEmail = (data.isOutbound && data.customerEmail) ? data.customerEmail : data.senderEmail;
  const primaryDomain = primaryEmail ? primaryEmail.split('@')[1] || '' : '';

  // Participant-growth re-sends shouldn't re-fire an identical CRM lookup —
  // but only skip the lookup itself, never the rest of this function.
  if (primaryEmail && primaryEmail === lastCrmLookupEmail) return;
  lastCrmLookupEmail = primaryEmail;

  if (primaryDomain && !CONSUMER_DOMAINS.has(primaryDomain)) {
    try {
      // Populate the background CRM context for the sidebar to read
      // (GET_CRM_CONTEXT). The in-email CRM banner was removed 2026-06-17.
      await sendToBackground(MSG.CRM_LOOKUP, {
        email: primaryEmail,
        domain: primaryDomain,
      });
    } catch {
      // CRM lookup failure is non-fatal
    }
  }

  // 2026-05-12: Removed Deal ID green-highlight feature (decorated 13–19
  // digit Deal IDs in approval emails, opened Zoho deal on click). Function
  // definitions for highlightDealIdsInEmail / handleDealIdHover /
  // handleDealIdClick removed below as well.
}

// ─────────────────────────────────────────────
// Deal ID highlighting was removed on 2026-05-12 per Chris.
// The previous behavior decorated 13–19 digit Deal IDs in approval emails
// with a green pill (background #e8f5e9, color #2e7d32, border #4caf50)
// that opened the Zoho deal on click and showed a Velocity Hub hint on
// hover. The feature is gone; DEAL_ID_PATTERN import is intentionally kept
// in case future tooling needs it elsewhere.
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// Contact Chip Hover Popups (Gmail thread headers)
// Mirrors the Zoho CRM Chrome extension hover behavior.
// Targets the sender/recipient name chips in email header rows.
// ─────────────────────────────────────────────

// Cache CRM lookups for the current page session
const chipCrmCache = new Map();

function buildAvatarColor(email) {
  // Deterministic color from email
  const colors = ['#1a73e8','#0077b5','#00a67e','#e37400','#9c27b0','#c62828','#2e7d32'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function showContactChipPopup(anchorEl, email) {
  // Remove any existing chip popup
  document.querySelector('.stratus-chip-popup')?.remove();

  const rawName = anchorEl.getAttribute('name') || anchorEl.textContent.trim() || '';
  const displayName = rawName || email.split('@')[0];
  const domain = email.split('@')[1] || '';
  const avatarColor = buildAvatarColor(email);
  const avatarLetter = (displayName[0] || '?').toUpperCase();

  const popup = document.createElement('div');
  popup.className = 'stratus-chip-popup';
  popup.style.cssText = `
    position: fixed; z-index: 2147483646; background: white;
    border: 1px solid #dadce0; border-radius: 8px;
    box-shadow: 0 2px 16px rgba(60,64,67,0.2), 0 1px 4px rgba(60,64,67,0.15);
    font-family: 'Google Sans', -apple-system, sans-serif;
    width: 248px; overflow: hidden; pointer-events: auto;
    animation: stratusChipIn 0.15s ease;
  `;

  popup.innerHTML = `
    <div style="padding:14px 16px 10px;display:flex;align-items:center;gap:12px;">
      <div style="
        width:40px;height:40px;border-radius:50%;flex-shrink:0;
        background:${avatarColor};color:white;
        display:flex;align-items:center;justify-content:center;
        font-size:18px;font-weight:500;
      ">${avatarLetter}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:14px;font-weight:500;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayName}</div>
        <div style="font-size:12px;color:#5f6368;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${email}</div>
      </div>
    </div>
    <div class="chip-crm-info" style="padding:0 16px 10px;min-height:20px;font-size:12px;color:#5f6368;">
      <span class="chip-loading" style="color:#5f6368;">Checking Zoho CRM…</span>
    </div>
    <div style="padding:0 12px 12px;">
      <button class="chip-open-btn" style="
        width:100%;padding:8px;border:none;border-radius:6px;
        background:#1a73e8;color:white;font-size:13px;font-weight:500;
        cursor:pointer;letter-spacing:0.01em;
      ">Search in Zoho CRM</button>
    </div>
  `;

  // Position below anchor, avoid viewport overflow
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 264));
  const top = rect.bottom + 4;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  document.body.appendChild(popup);

  // Keep popup open while hovering it or the anchor
  let leaveTimer = null;
  function scheduleClose() {
    leaveTimer = setTimeout(() => popup.remove(), 250);
  }
  function cancelClose() {
    if (leaveTimer) clearTimeout(leaveTimer);
  }
  anchorEl.addEventListener('mouseleave', scheduleClose);
  popup.addEventListener('mouseenter', cancelClose);
  popup.addEventListener('mouseleave', scheduleClose);

  // "Search in Zoho CRM" / "Open in Stratus AI" button
  popup.querySelector('.chip-open-btn').addEventListener('click', () => {
    popup.remove();
    // Tell background to open the side panel + navigate to CRM tab with this email
    chrome.runtime.sendMessage({
      type: MSG.SIDEBAR_NAVIGATE,
      panel: 'crm',
      data: { preloadEmail: email },
      openPanel: true,
    }, () => {});
  });

  // CRM lookup (use cache to avoid re-querying same email)
  const crmInfoEl = popup.querySelector('.chip-crm-info');
  if (chipCrmCache.has(email)) {
    renderChipCrmInfo(crmInfoEl, chipCrmCache.get(email), email, domain);
  } else if (!CONSUMER_DOMAINS.has(domain)) {
    sendToBackground(MSG.CRM_LOOKUP, { email, domain })
      .then(result => {
        chipCrmCache.set(email, result);
        if (crmInfoEl.parentNode) renderChipCrmInfo(crmInfoEl, result, email, domain);
      })
      .catch(() => {
        if (crmInfoEl.parentNode) crmInfoEl.innerHTML = '';
      });
  } else {
    // Consumer domain — still show the button but no CRM info
    crmInfoEl.innerHTML = '';
    popup.querySelector('.chip-open-btn').textContent = 'Look up in Stratus AI';
  }

  return popup;
}

function renderChipCrmInfo(el, result, email, domain) {
  if (!result || !result.found) {
    el.innerHTML = `<span style="color:#80868b;font-size:11px;">Not in Zoho CRM</span>`;
    return;
  }
  const acc = result.account;
  const con = result.contact;
  let html = '';
  if (acc?.name) {
    html += `<div style="font-weight:500;color:#202124;margin-bottom:1px;">${acc.name}</div>`;
  }
  if (con?.title) {
    html += `<div style="color:#5f6368;">${con.title}</div>`;
  }
  if (con?.phone) {
    html += `<div style="color:#5f6368;">${con.phone}</div>`;
  }
  if (!html) html = `<div style="color:#2e7d32;font-size:11px;">✓ Found in Zoho CRM</div>`;
  el.innerHTML = html;
}

function attachChipHover(el) {
  if (el.dataset.stratusChipAttached) return;
  const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
  if (!email || !email.includes('@') || !email.includes('.')) return;
  if (email.toLowerCase().includes('@stratusinfosystems.com')) return;
  if (BOT_EMAILS.has(email.toLowerCase())) return;

  el.dataset.stratusChipAttached = 'true';

  let hoverTimer = null;
  el.addEventListener('mouseenter', () => {
    hoverTimer = setTimeout(() => {
      showContactChipPopup(el, email.toLowerCase());
    }, 180); // Short delay — snappy but not jittery
  });
  el.addEventListener('mouseleave', () => {
    if (hoverTimer) clearTimeout(hoverTimer);
  });
}

function setupContactChipHovers() {
  // Gmail chip selectors — sender (.gD), To/Cc recipients (.g2), avatar hover targets
  const CHIP_SEL = '.gD[email], .g2[email], .go[email], [data-hovercard-id*="@"]';

  // Attach to chips already in DOM
  document.querySelectorAll(CHIP_SEL).forEach(attachChipHover);

  // Watch for chips added by Gmail's SPA rendering (debounced 200ms)
  let _chipTimer = null;
  const chipObserver = new MutationObserver(() => {
    if (_chipTimer) clearTimeout(_chipTimer);
    _chipTimer = setTimeout(() => {
      _chipTimer = null;
      document.querySelectorAll(CHIP_SEL).forEach(attachChipHover);
    }, 200);
  });
  chipObserver.observe(document.body, { childList: true, subtree: true, attributeFilter: ['email', 'data-hovercard-id'] });
}

// ─────────────────────────────────────────────
// Email Address Hover Popups
// ─────────────────────────────────────────────

function setupEmailHoverPopups() {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt div');

  bodyEls.forEach((el) => {
    // Skip if already processed
    if (el.dataset.stratusEmailHoverProcessed) return;
    el.dataset.stratusEmailHoverProcessed = 'true';

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.textContent;
      if (!emailPattern.test(text)) {
        emailPattern.lastIndex = 0;
        return;
      }

      // Reset regex lastIndex
      emailPattern.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = emailPattern.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        // Create email span wrapper
        const span = document.createElement('span');
        span.className = 'stratus-email-address';
        span.textContent = match[0];
        span.dataset.email = match[0].toLowerCase();
        span.style.cssText = `
          color: ${COLORS.STRATUS_BLUE}; text-decoration: underline; cursor: pointer;
          position: relative; padding: 0 2px;
        `;

        // Hover popup on mouseenter
        span.addEventListener('mouseenter', async (e) => {
          const email = e.target.getAttribute('data-email');
          const domain = email.split('@')[1];

          // Skip consumer domains
          if (CONSUMER_DOMAINS.has(domain)) {
            return;
          }

          // Show loading popup
          let popup = document.querySelector('.stratus-email-popup');
          if (!popup) {
            popup = document.createElement('div');
            popup.className = 'stratus-email-popup';
            popup.style.cssText = `
              position: fixed; background: white; border: 1px solid ${COLORS.BORDER};
              border-radius: 8px; padding: 12px 14px; font-size: 12px;
              font-family: -apple-system, sans-serif; z-index: 9999;
              box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 280px;
            `;
            document.body.appendChild(popup);
          }

          popup.innerHTML = `<div style="color: ${COLORS.TEXT_SECONDARY};">Looking up ${email}...</div>`;

          // Position near cursor
          const rect = e.target.getBoundingClientRect();
          popup.style.left = (rect.left + 10) + 'px';
          popup.style.top = (rect.bottom + 5) + 'px';
          popup.style.display = 'block';

          try {
            // Lookup CRM data for this email
            const crmResult = await sendToBackground(MSG.CRM_LOOKUP, { email, domain });

            if (crmResult && crmResult.found) {
              const account = crmResult.account;
              const contact = crmResult.contact;
              const accountName = account?.name || 'Unknown Account';
              const contactName = contact?.name || contact?.email || email;
              const contactTitle = contact?.title || '';
              const accountZoho = account?.zohoUrl || '#';

              popup.innerHTML = `
                <div style="margin-bottom: 8px;">
                  <div style="font-weight: 600; color: ${COLORS.TEXT_PRIMARY}; margin-bottom: 4px;">
                    ${accountName}
                  </div>
                  <div style="color: ${COLORS.TEXT_SECONDARY}; font-size: 11px;">
                    ${contactName}${contactTitle ? ` • ${contactTitle}` : ''}
                  </div>
                </div>
                <a href="${accountZoho}" target="_blank" rel="noopener"
                   style="color: ${COLORS.STRATUS_BLUE}; text-decoration: none; font-size: 11px; font-weight: 500;">
                  View in Zoho →
                </a>
              `;
            } else {
              popup.innerHTML = `<div style="color: ${COLORS.TEXT_SECONDARY};">No CRM record for ${email}</div>`;
            }
          } catch (err) {
            popup.innerHTML = `<div style="color: ${COLORS.ERROR}; font-size: 11px;">Lookup failed</div>`;
          }
        });

        // Hide popup on mouseleave
        span.addEventListener('mouseleave', () => {
          const popup = document.querySelector('.stratus-email-popup');
          if (popup) popup.style.display = 'none';
        });

        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      node.parentNode.replaceChild(fragment, node);
    });
  });
}

// ─────────────────────────────────────────────
// Compose Toolbar Button
// ─────────────────────────────────────────────

function getComposeRecipients(composeEl) {
  // Extract recipient emails from the compose To/Cc/Bcc fields ONLY (not thread body)
  const recipients = new Set();

  // Priority 1: Gmail compose chip elements with [email] attribute in To/Cc/Bcc containers
  // These are the actual recipient chips, not thread participant hover cards
  const chipSelectors = [
    'div[name="to"] span[email]',
    'div[name="cc"] span[email]',
    'div[name="bcc"] span[email]',
    '.aoD span[email]',            // Reply-to chip container
    '.GG span[email]',             // Compose To field chips
    '.wO span[email]',             // Another To field variant
  ];
  chipSelectors.forEach(sel => {
    composeEl.querySelectorAll(sel).forEach(el => {
      const email = el.getAttribute('email') || '';
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });
  });

  // Priority 2: Hidden/text inputs for To/Cc/Bcc
  const toInput = composeEl.querySelector('input[aria-label*="To"], textarea[aria-label*="To"]');
  if (toInput && toInput.value) {
    toInput.value.split(/[,;]/).forEach(e => {
      const trimmed = e.trim().replace(/.*<(.+)>/, '$1');
      if (trimmed.includes('@')) recipients.add(trimmed.toLowerCase());
    });
  }

  // Priority 3: Fallback to broader [data-hovercard-id] only if nothing found above
  // (avoids picking up thread participants like mixmax, automated senders, etc.)
  if (recipients.size === 0) {
    composeEl.querySelectorAll('[data-hovercard-id], [email]').forEach(el => {
      const email = el.getAttribute('data-hovercard-id') || el.getAttribute('email') || '';
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });
  }

  return [...recipients].filter(e => !e.includes('@stratusinfosystems.com'));
}

function getComposeSubject(composeEl) {
  const subjectInput = composeEl.querySelector('input[aria-label*="Subject"], input[name="subjectbox"]')
    || document.querySelector('.aoT'); // Gmail subject field
  return subjectInput?.value || '';
}

function injectComposeButton(composeEl) {
  // Check if already injected (keyed on the surviving Send + Task button)
  if (composeEl.querySelector('.stratus-send-task-btn')) return;

  const toolbar = composeEl.querySelector('.btC') || composeEl.querySelector('[role="toolbar"]');
  if (!toolbar) return;

  // ── Send + Update Task button (injected FIRST so S button can be placed before it) ──
  const sendTaskBtn = document.createElement('div');
  sendTaskBtn.className = 'stratus-send-task-btn';
  sendTaskBtn.title = 'Send email and update related Zoho task';
  sendTaskBtn.style.cssText = `
    display: inline-flex; align-items: center; gap: 4px; padding: 0 10px;
    height: 32px; border-radius: 16px; cursor: pointer;
    background: #1a73a7; color: white; font-size: 11px;
    font-weight: 600; margin-left: 6px; transition: background 0.2s;
    white-space: nowrap; border: none; position: relative; z-index: 10;
    user-select: none; -webkit-user-select: none;
  `;
  sendTaskBtn.innerHTML = '📋 Send + Task';
  sendTaskBtn.addEventListener('mouseenter', () => { if (!sendTaskBtn._busy) sendTaskBtn.style.background = '#0d4f73'; });
  sendTaskBtn.addEventListener('mouseleave', () => { if (!sendTaskBtn._busy) sendTaskBtn.style.background = '#1a73a7'; });

  sendTaskBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    // Prevent double-clicks
    if (sendTaskBtn._busy) return;
    sendTaskBtn._busy = true;

    // ── Immediate visual feedback ──
    const originalHTML = sendTaskBtn.innerHTML;
    sendTaskBtn.innerHTML = '⏳ Sending...';
    sendTaskBtn.style.background = '#0d4f73';
    sendTaskBtn.style.pointerEvents = 'none';

    try {
      // 1. Wake up background service worker with a ping first
      try {
        await sendToBackground(MSG.GET_SETTINGS);
      } catch {
        // If background is dormant, try to open sidebar to wake it up
        console.log('[Stratus] Background unreachable, attempting sidebar open to wake service worker...');
        try {
          await chrome.runtime.sendMessage({ type: MSG.SIDEBAR_NAVIGATE, panel: 'zoho', openPanel: true });
          await new Promise(r => setTimeout(r, 500)); // Give sidebar time to initialize
        } catch (sidebarErr) {
          console.warn('[Stratus] Could not wake service worker:', sidebarErr);
        }
      }

      // 2. Capture compose data BEFORE sending
      const recipients = getComposeRecipients(composeEl);
      const subject = getComposeSubject(composeEl);

      // 3. Click Gmail's native Send button (expanded selector list for Gmail DOM variations)
      const sendButton = composeEl.querySelector('[data-tooltip="Send"]')
        || composeEl.querySelector('[data-tooltip="Send ‪(⌘Enter)‬"]')
        || composeEl.querySelector('[data-tooltip="Send ‪(Ctrl-Enter)‬"]')
        || composeEl.querySelector('.aoO[role="button"]')
        || composeEl.querySelector('div[aria-label="Send"]')
        || composeEl.querySelector('div[aria-label*="Send "]')
        || composeEl.querySelector('.T-I.J-J5-Ji.aoO.T-I-atl.L3')
        || composeEl.querySelector('[aria-label="Send ‪(Ctrl-Enter)‬"]');

      if (sendButton) {
        sendButton.click();
      } else {
        // Fallback: use keyboard shortcut Ctrl+Enter / Cmd+Enter to send
        console.warn('[Stratus] Send button not found, attempting keyboard shortcut');
        const composeBody = composeEl.querySelector('[role="textbox"][aria-label*="Body"], div[aria-label*="Message Body"]');
        if (composeBody) {
          composeBody.focus();
          composeBody.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }));
        }
      }

      sendTaskBtn.innerHTML = '✓ Sent! Checking tasks...';

      // 4. Wait for send to complete, then check for related tasks
      await new Promise(r => setTimeout(r, 1500));

      try {
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: recipients.map(r => r.split('@')[1]).filter(Boolean),
          emails: recipients,
        });
        const tasks = taskResult?.tasks || [];
        if (tasks.length > 0) {
          showSendTaskPopup(tasks, recipients, subject);
        } else {
          // No open tasks — prompt to create one with contact selector
          showCreateTaskPrompt(recipients, subject);
        }
      } catch (taskErr) {
        console.warn('[Stratus] Task fetch error:', taskErr);
        showSendConfirmation('Email sent! Could not check tasks: ' + (taskErr.message || 'connection error'));
      }
    } catch (outerErr) {
      console.error('[Stratus] Send+Task error:', outerErr);
      sendTaskBtn.innerHTML = '❌ Error';
      sendTaskBtn.style.background = '#d93025';
      setTimeout(() => {
        sendTaskBtn.innerHTML = originalHTML;
        sendTaskBtn.style.background = '#1a73a7';
        sendTaskBtn.style.pointerEvents = '';
        sendTaskBtn._busy = false;
      }, 2000);
      return;
    }

    // Reset button state after a delay (compose may already be gone)
    setTimeout(() => {
      try {
        sendTaskBtn.innerHTML = originalHTML;
        sendTaskBtn.style.background = '#1a73a7';
        sendTaskBtn.style.pointerEvents = '';
        sendTaskBtn._busy = false;
      } catch { /* compose already removed from DOM */ }
    }, 3000);
  });

  // Append the Send + Task button. The round "S" AI-draft button was removed
  // 2026-06-17 — draft-reply generation now lives in the sidebar Chat tab.
  toolbar.appendChild(sendTaskBtn);
}

// ─────────────────────────────────────────────
// Brief confirmation toast (email sent, no tasks found)
// ─────────────────────────────────────────────

function showSendConfirmation(message) {
  // Remove any existing popup/toast
  document.querySelector('.stratus-send-task-popup')?.remove();
  document.querySelector('.stratus-send-confirm')?.remove();

  const toast = document.createElement('div');
  toast.className = 'stratus-send-confirm';
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    background: white; border-radius: 12px; padding: 14px 18px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 320px; min-width: 240px; border: 1px solid #e0e0e0;
    animation: stratusSlideIn 0.25s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = `@keyframes stratusSlideIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">✅</span>
      <span style="font-size:13px;color:#1a1a1a;">${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─────────────────────────────────────────────
// Send + Task Confirmation Popup
// ─────────────────────────────────────────────

function showSendTaskPopup(tasks, recipients, subject) {
  // Remove any existing popup
  document.querySelector('.stratus-send-task-popup')?.remove();

  const task = tasks[0]; // Focus on the most relevant task
  const popup = document.createElement('div');
  popup.className = 'stratus-send-task-popup';

  const dueDate = task.dueDate || '';
  const isOverdue = dueDate && new Date(dueDate) < new Date();
  const dealInfo = task.dealName ? `<div style="font-size:11px;color:#5f6368;margin-top:2px;">Deal: ${task.dealName}</div>` : '';
  const otherCount = tasks.length > 1 ? `<div style="font-size:11px;color:#5f6368;margin-top:4px;">+ ${tasks.length - 1} other task${tasks.length > 1 ? 's' : ''}</div>` : '';

  popup.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    background: white; border-radius: 12px; padding: 16px 18px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 320px; min-width: 280px; border: 1px solid #e0e0e0;
    animation: stratusSlideIn 0.25s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = `
      @keyframes stratusSlideIn {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:700;color:#1a1a1a;">📋 Email Sent — Update Task?</div>
      <button class="stp-close" style="background:none;border:none;cursor:pointer;color:#5f6368;font-size:18px;padding:0 2px;line-height:1;">×</button>
    </div>
    <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:#1a1a1a;">${task.subject || 'Follow-up Task'}</div>
      <div style="font-size:11px;color:${isOverdue ? '#d93025' : '#5f6368'};margin-top:2px;">
        Due: ${dueDate || 'No date'}${isOverdue ? ' ⚠️ Overdue' : ''}
      </div>
      ${dealInfo}
      ${otherCount}
    </div>
    <div style="display:flex;flex-direction:column;gap:7px;">
      <button class="stp-complete" style="
        padding:9px 14px;background:#1a73e8;color:white;border:none;border-radius:8px;
        font-size:12px;font-weight:600;cursor:pointer;text-align:left;
      ">✓ Complete + Add Follow-Up (3 days)</button>
      <button class="stp-extend" style="
        padding:9px 14px;background:transparent;color:#1a73e8;
        border:1px solid #1a73e8;border-radius:8px;font-size:12px;
        font-weight:600;cursor:pointer;text-align:left;
      ">📅 Extend Due Date +3 Days</button>
      <button class="stp-dismiss" style="
        padding:7px 14px;background:transparent;color:#5f6368;
        border:1px solid #e0e0e0;border-radius:8px;font-size:12px;
        cursor:pointer;text-align:left;
      ">Dismiss</button>
    </div>
    <div class="stp-status" style="margin-top:10px;font-size:11px;color:#5f6368;display:none;"></div>
  `;

  document.body.appendChild(popup);

  // Auto-dismiss after 30 seconds
  const autoDismiss = setTimeout(() => popup.remove(), 30000);

  function setStatus(msg, isError = false) {
    const el = popup.querySelector('.stp-status');
    el.textContent = msg;
    el.style.color = isError ? '#d93025' : '#137333';
    el.style.display = 'block';
  }

  function disableButtons() {
    popup.querySelectorAll('button:not(.stp-close)').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.5';
    });
  }

  popup.querySelector('.stp-close').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-dismiss').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-complete').addEventListener('click', async () => {
    disableButtons();
    setStatus('Completing task...');
    try {
      await sendToBackground(MSG.TASK_ACTION, {
        action: 'complete_and_followup',
        taskId: task.id,
        dealId: task.dealId || '',
        contactId: task.contactId || '',
        newSubject: `Follow up: ${task.subject}`,
      });
      setStatus('✓ Task completed. Follow-up created.');
      setTimeout(() => { clearTimeout(autoDismiss); popup.remove(); }, 2500);
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    }
  });

  popup.querySelector('.stp-extend').addEventListener('click', async () => {
    disableButtons();
    setStatus('Rescheduling...');
    try {
      const newDate = addDays(3);
      await sendToBackground(MSG.TASK_ACTION, {
        action: 'reschedule',
        taskId: task.id,
        newDueDate: newDate,
      });
      setStatus(`✓ Due date moved to ${newDate}`);
      setTimeout(() => { clearTimeout(autoDismiss); popup.remove(); }, 2500);
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    }
  });
}

function addDays(days) {
  let d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────
// No Tasks Found — Prompt to Create One
// ─────────────────────────────────────────────

function showCreateTaskPrompt(recipients, subject) {
  // Remove any existing popup/toast
  document.querySelector('.stratus-send-task-popup')?.remove();
  document.querySelector('.stratus-send-confirm')?.remove();

  const popup = document.createElement('div');
  popup.className = 'stratus-send-task-popup';

  popup.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    background: white; border-radius: 12px; padding: 16px 18px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 340px; min-width: 280px; border: 1px solid #e0e0e0;
    animation: stratusSlideIn 0.25s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = `@keyframes stratusSlideIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`;
    document.head.appendChild(style);
  }

  const defaultDue = addDays(3);
  const taskSubject = subject ? `Follow up: ${subject}` : 'Follow up';

  // Build contact selector HTML if multiple recipients
  let contactSelectorHTML = '';
  if (recipients.length > 1) {
    const options = recipients.map((r, i) =>
      `<label style="display:flex;align-items:center;gap:6px;padding:4px 0;cursor:pointer;">
        <input type="radio" name="stratus-task-contact" value="${r}" ${i === 0 ? 'checked' : ''} style="margin:0;accent-color:#1a73e8;" />
        <span style="font-size:12px;color:#1a1a1a;">${r}</span>
      </label>`
    ).join('');
    contactSelectorHTML = `
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;font-weight:600;color:#5f6368;margin-bottom:4px;">Create task under:</div>
        <div style="background:#f8f9fa;border-radius:6px;padding:6px 10px;max-height:100px;overflow-y:auto;">
          ${options}
        </div>
      </div>
    `;
  } else if (recipients.length === 1) {
    contactSelectorHTML = `
      <div style="font-size:12px;color:#5f6368;margin-bottom:10px;">
        Contact: <strong style="color:#1a1a1a;">${recipients[0]}</strong>
        <input type="hidden" name="stratus-task-contact" value="${recipients[0]}" />
      </div>
    `;
  }

  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:700;color:#1a1a1a;">✅ Email Sent — Create Task?</div>
      <button class="stp-close" style="background:none;border:none;cursor:pointer;color:#5f6368;font-size:18px;padding:0 2px;line-height:1;">×</button>
    </div>
    <div style="font-size:12px;color:#5f6368;margin-bottom:10px;">
      No open Zoho tasks found for ${recipients.length > 1 ? 'these recipients' : (recipients[0] || 'this contact')}.
      Would you like to create a follow-up?
    </div>
    ${contactSelectorHTML}
    <div style="margin-bottom:10px;">
      <div style="font-size:11px;font-weight:600;color:#5f6368;margin-bottom:3px;">Task subject:</div>
      <input type="text" class="stp-subject" value="${taskSubject.replace(/"/g, '&quot;')}" style="
        width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dadce0;border-radius:6px;
        font-size:12px;font-family:inherit;color:#1a1a1a;outline:none;
      " />
    </div>
    <div style="margin-bottom:12px;">
      <div style="font-size:11px;font-weight:600;color:#5f6368;margin-bottom:3px;">Due date:</div>
      <input type="date" class="stp-due" value="${defaultDue}" style="
        width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #dadce0;border-radius:6px;
        font-size:12px;font-family:inherit;color:#1a1a1a;outline:none;
      " />
    </div>
    <div style="display:flex;gap:8px;">
      <button class="stp-create" style="
        flex:1;padding:9px 14px;background:#1a73e8;color:white;border:none;border-radius:8px;
        font-size:12px;font-weight:600;cursor:pointer;
      ">📋 Create Task</button>
      <button class="stp-dismiss" style="
        padding:9px 14px;background:transparent;color:#5f6368;
        border:1px solid #e0e0e0;border-radius:8px;font-size:12px;cursor:pointer;
      ">No Thanks</button>
    </div>
    <div class="stp-status" style="margin-top:10px;font-size:11px;color:#5f6368;display:none;"></div>
  `;

  document.body.appendChild(popup);

  // Auto-dismiss after 30 seconds
  const autoDismiss = setTimeout(() => popup.remove(), 30000);

  function setStatus(msg, isError = false) {
    const el = popup.querySelector('.stp-status');
    el.textContent = msg;
    el.style.color = isError ? '#d93025' : '#137333';
    el.style.display = 'block';
  }

  function disableButtons() {
    popup.querySelectorAll('button:not(.stp-close)').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.5';
    });
    popup.querySelectorAll('input').forEach(i => { i.disabled = true; i.style.opacity = '0.7'; });
  }

  popup.querySelector('.stp-close').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-dismiss').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-create').addEventListener('click', async () => {
    disableButtons();
    setStatus('Creating task...');
    try {
      const selectedContact = popup.querySelector('input[name="stratus-task-contact"]:checked')?.value
        || popup.querySelector('input[name="stratus-task-contact"]')?.value
        || recipients[0] || '';
      const taskSub = popup.querySelector('.stp-subject')?.value || taskSubject;
      const dueDate = popup.querySelector('.stp-due')?.value || defaultDue;

      // Look up contact in CRM by email to get contactId
      let contactId = '';
      if (selectedContact) {
        try {
          const searchResult = await sendToBackground(MSG.CRM_SEARCH, {
            query: selectedContact,
            module: 'Contacts',
          });
          const contacts = searchResult?.records || searchResult?.results || [];
          if (contacts.length > 0) {
            contactId = contacts[0].id || contacts[0].Id || '';
          }
        } catch { /* proceed without contactId */ }
      }

      await sendToBackground(MSG.CRM_CREATE_TASK, {
        subject: taskSub,
        dueDate: dueDate,
        contactId: contactId,
        priority: 'Normal',
        description: `Auto-created from Send+Task after email to ${selectedContact || recipients.join(', ')}`,
      });

      setStatus('✓ Task created!');
      setTimeout(() => { clearTimeout(autoDismiss); popup.remove(); }, 2500);
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Could not create task'), true);
    }
  });
}

// ─────────────────────────────────────────────
// MutationObserver for Gmail SPA
// ─────────────────────────────────────────────

// Debounce helper — batches rapid MutationObserver fires into one call
let _emailChangeTimer = null;
let _composeCheckTimer = null;

function checkForEmailView() {
  // Strategy 1: Check for subject line (most reliable indicator of email open)
  const subjectEl = document.querySelector('h2.hP') || document.querySelector('[data-thread-perm-id] h2');
  if (subjectEl) {
    if (_emailChangeTimer) clearTimeout(_emailChangeTimer);
    _emailChangeTimer = setTimeout(() => {
      _emailChangeTimer = null;
      onEmailChanged();
    }, 250); // Slightly longer debounce for reliability
  }
}

const observer = new MutationObserver((mutations) => {
  checkForEmailView();

  // Debounced Send + Task button injection (300ms)
  if (_composeCheckTimer) clearTimeout(_composeCheckTimer);
  _composeCheckTimer = setTimeout(() => {
    _composeCheckTimer = null;
    document.querySelectorAll('.T-I.J-J5-Ji').forEach((el) => {
      const composeContainer = el.closest('.nH');
      if (composeContainer) {
        injectComposeButton(composeContainer);
      }
    });
  }, 300);
});

// Start observing Gmail DOM — observe attributes too for Gmail SPA transitions
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'aria-hidden'],
  characterData: false,
});

// Inject popup animation CSS once
(function injectPopupStyles() {
  if (document.getElementById('stratus-chip-styles')) return;
  const style = document.createElement('style');
  style.id = 'stratus-chip-styles';
  style.textContent = `
    @keyframes stratusChipIn {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .stratus-chip-popup button.chip-open-btn:hover {
      background: #1558b0 !important;
    }
  `;
  document.head.appendChild(style);
})();

// Initialize contact chip hovers + email body hover popups
setupContactChipHovers();
setupEmailHoverPopups();

// Also do an initial check after page settles (Gmail takes a moment to render)
setTimeout(() => {
  console.log('[Stratus AI] Initial email check after load');
  checkForEmailView();
  setupEmailHoverPopups();
}, 1500);

// Second delayed check for slower connections
setTimeout(() => {
  checkForEmailView();
}, 3000);

// ─────────────────────────────────────────────
// Email Sent Detection
// ─────────────────────────────────────────────

function detectEmailSent() {
  // Watch for the email sent toast notification in Gmail
  const toastObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Gmail shows a toast with aria-live="polite" containing "Message sent" text
          if (node.textContent && (node.textContent.includes('Message sent') || node.textContent.includes('Undo'))) {
            // Extract email data from the just-sent compose window
            const recipientsInput = document.querySelector('input[aria-label*="To"]');
            const subjectEl = document.querySelector('input[aria-label*="Subject"]');

            if (recipientsInput && subjectEl) {
              const recipients = recipientsInput.value || '';
              const subject = subjectEl.value || '';

              if (recipients) {
                // Send EMAIL_SENT message to background with recipient info
                chrome.runtime.sendMessage({
                  type: MSG.EMAIL_SENT,
                  data: {
                    recipients: recipients.split(',').map(r => r.trim().toLowerCase()),
                    subject,
                    sentAt: new Date().toISOString(),
                  },
                }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.warn('[Stratus] EMAIL_SENT handler error:', chrome.runtime.lastError);
                  }
                });
              }
            }
          }
        }
      });
    });
  });

  // Observe the document body for new toasts (they're typically direct children or in a container)
  toastObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Start email sent detection
detectEmailSent();

// ─────────────────────────────────────────────
// Message Handlers (from background)
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'COPY_TO_CLIPBOARD':
      navigator.clipboard.writeText(message.text).then(() => {
        sendResponse({ success: true });
      }).catch(() => {
        sendResponse({ success: false });
      });
      return true;

    case MSG.GET_FULL_EMAIL_CONTEXT:
      sendResponse(extractEmailData({ includeFullThread: true }) || { empty: true });
      break;

    case MSG.GET_EMAIL_CONTEXT:
      // Live extraction on demand — lets the background serve the sidebar
      // current participants instead of a possibly-partial cached snapshot.
      sendResponse(extractEmailData() || { empty: true });
      break;
  }
});

// Also detect URL hash changes (Gmail navigation)
let lastHash = window.location.hash;

function onHashChange() {
  const currentHash = window.location.hash;
  if (currentHash !== lastHash) {
    lastHash = currentHash;
    lastEmailHash = ''; // Reset to trigger re-detection
    lastCrmLookupEmail = ''; // Allow a fresh CRM lookup on the new thread
    lastThreadNavAt = Date.now(); // Suppress perm-id cache merges until settled
    // Clean up stale per-thread processing markers
    document.querySelectorAll('[data-stratus-deals-processed]').forEach(el => {
      el.removeAttribute('data-stratus-deals-processed');
    });
    document.querySelectorAll('[data-stratus-email-hover-processed]').forEach(el => {
      el.removeAttribute('data-stratus-email-hover-processed');
    });

    // Check for new email after DOM settles
    setTimeout(() => {
      checkForEmailView();
      setupEmailHoverPopups();
    }, 500);
  }
}

// Use both hashchange event and polling for maximum reliability
window.addEventListener('hashchange', onHashChange);
setInterval(onHashChange, 1000);
