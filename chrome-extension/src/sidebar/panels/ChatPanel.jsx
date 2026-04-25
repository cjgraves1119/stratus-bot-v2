/**
 * Stratus AI Chrome Extension — Chat Panel
 *
 * CRM-aware Claude chat with persistent history, abort/stop support,
 * and forced Zoho execution for quote/deal modification requests.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendToBackground, onMessage } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';
import {
  parseZohoRecordUrl,
  contextMatchesUrl,
  minimalContextFromUrl,
} from '../../lib/zoho-url.js';
// Quote generation routed through worker API (same engine as Webex/GChat bots)

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

const QUICK_ACTIONS = [
  { label: 'Recent Quotes', text: 'Show my most recent quotes in Zoho' },
  { label: 'Open Deals', text: 'Show my open deals in Zoho CRM' },
  { label: 'Create Quote', text: 'Help me create a quote in Zoho CRM' },
  { label: 'Look Up Account', text: 'Look up the account for this email in Zoho CRM' },
];

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
  // recordId + module match the active tab URL.
  useEffect(() => {
    if (zohoPageContextProp !== undefined && zohoPageContextProp !== null) return;
    let cancelled = false;
    async function refreshPageCtx() {
      let activeUrl = '';
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeUrl = activeTab?.url || '';
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

      // Path 2: direct storage read with matching validation.
      if (!zohoCtx) {
        try {
          const stored = await chrome.storage.local.get('zohoPageContext');
          if (contextMatchesUrl(stored?.zohoPageContext, urlInfo)) {
            zohoCtx = stored.zohoPageContext;
          }
        } catch (_) { /* ignore */ }
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

  // Build a context hint string for "this quote"-style references
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
    lines.push(`When the user says "this", "this quote", "the quote", "modify this", etc., they mean ${moduleLabel} ${ctx.recordId}. Act on it directly without asking which one.`);
    return lines.join('\n');
  }

  // Pre-fill from navData
  useEffect(() => {
    if (navData?.prefillText) setInput(navData.prefillText);
  }, [navData]);

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

  const handleSendMessage = useCallback(async (overrideText) => {
    const messageText = overrideText || input.trim();
    if (!messageText || loading) return;
    const now = Date.now();
    if (now - lastSendRef.current < 1000) return; // Rate-limit: 1 send/sec
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
        content: m.content,
      }));

      // Build effective context: if user selected a specific email, override customerEmail
      let effectiveContext = selectedContextEmail === '__none__'
        ? null
        : selectedContextEmail && emailContext
          ? { ...emailContext, customerEmail: selectedContextEmail, customerName: participantOptions.find(p => p.email === selectedContextEmail)?.name || '' }
          : emailContext || null;

      // ── Resolve the ACTIVE Zoho record from the active tab URL ─────────
      //
      // The URL is authoritative for "what record is the user currently
      // viewing". We re-read it synchronously here so a message sent
      // immediately after SPA navigation targets the NEW record, not
      // whatever is cached in state from 2 seconds ago.
      let activeZohoRecord = null;
      let activeUrlInfo = null;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeUrl = activeTab?.url || '';
        activeUrlInfo = parseZohoRecordUrl(activeUrl);
        if (activeUrlInfo?.isRecord) {
          // Prefer the enriched state if it matches the URL; else fall
          // back to storage (matching only); else the URL-only minimal.
          if (contextMatchesUrl(zohoPageContext, activeUrlInfo)) {
            activeZohoRecord = zohoPageContext;
          } else {
            try {
              const stored = await chrome.storage.local.get('zohoPageContext');
              if (contextMatchesUrl(stored?.zohoPageContext, activeUrlInfo)) {
                activeZohoRecord = stored.zohoPageContext;
              }
            } catch (_) { /* ignore */ }
            if (!activeZohoRecord) {
              activeZohoRecord = minimalContextFromUrl(activeUrlInfo);
            }
          }
        }
      } catch (err) {
        console.warn('[Stratus Chat] Pre-send page context refresh failed:', err?.message);
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
        systemContext: buildSystemContext(emailContext, selectedContextEmail === '__none__' ? null : selectedContextEmail),
        progressId,
      });

      if (thisAbort.aborted) return; // Stopped by user

      if (response && response.success && response.reply) {
        const assistantMsg = {
          id: Date.now() + 1,
          role: 'assistant',
          content: response.reply,
          usedTools: response.usedTools || false,
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
    setLoading(false);
    setError(null);
    setInput('');
    onMessagesChange([]);
  }, [onMessagesChange]);

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const msgList = messages || [];

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
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
              {QUICK_ACTIONS.map((action, i) => (
                <button key={i} onClick={() => handleSendMessage(action.text)}
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

        {msgList.map((msg) => (
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
          </div>
        ))}

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

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={loading ? 'Working on it...' : 'Ask about CRM, quotes, accounts...'}
            disabled={loading}
            style={{
              flex: 1, padding: '8px 12px', border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'none',
              height: 40, color: COLORS.TEXT_PRIMARY, backgroundColor: COLORS.BG_PRIMARY,
              opacity: loading ? 0.6 : 1, cursor: loading ? 'not-allowed' : 'text', outline: 'none',
            }}
          />
          <button
            onClick={() => handleSendMessage()}
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
