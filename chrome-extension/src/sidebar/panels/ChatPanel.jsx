/**
 * Stratus AI Chrome Extension — Chat Panel
 *
 * CRM-aware Claude chat with persistent history, abort/stop support,
 * and forced Zoho execution for quote/deal modification requests.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendToBackground, onMessage } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';
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
export default function ChatPanel({ emailContext, navData, messages, onMessagesChange }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedContextEmail, setSelectedContextEmail] = useState(null);
  const [contextDropdownOpen, setContextDropdownOpen] = useState(false);
  const [zohoPageContext, setZohoPageContext] = useState(null);
  const messagesEndRef = useRef(null);
  // AbortController ref for stop functionality
  const abortRef = useRef(null);
  const lastSendRef = useRef(0); // Rate-limit: min 1s between sends

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Reset context selection when email changes
  useEffect(() => {
    setSelectedContextEmail(null);
  }, [emailContext?.customerEmail, emailContext?.subject]);

  // Pull current page context (Zoho record, if any) on mount and when user returns to chat tab.
  //
  // Two-path read strategy:
  //   1. Try sendToBackground(GET_PAGE_CONTEXT) — fast if the service worker is alive.
  //   2. If the message fails OR returns nothing, fall back to chrome.storage.local directly.
  //      Content scripts write zohoPageContext straight to storage now (MV3-safe), so the
  //      value is always there even when the background worker has gone idle.
  useEffect(() => {
    let cancelled = false;
    async function refreshPageCtx() {
      let zohoCtx = null;

      // Path 1: background message (best-effort — worker may be sleeping)
      try {
        const ctx = await sendToBackground(MSG.GET_PAGE_CONTEXT, {});
        if (!cancelled && ctx?.zohoContext?.recordId) {
          zohoCtx = ctx.zohoContext;
        }
      } catch (err) {
        console.warn('[Stratus Chat] GET_PAGE_CONTEXT via background failed:', err?.message);
      }

      // Path 2: read chrome.storage.local directly (always available in MV3 content/sidebar)
      if (!zohoCtx) {
        try {
          const stored = await chrome.storage.local.get('zohoPageContext');
          if (stored?.zohoPageContext?.recordId) {
            zohoCtx = stored.zohoPageContext;
            console.log('[Stratus Chat] Zoho context recovered from storage directly:', zohoCtx);
          }
        } catch (err) {
          console.warn('[Stratus Chat] chrome.storage.local read failed:', err?.message);
        }
      }

      if (cancelled) return;
      setZohoPageContext(zohoCtx || null);
    }

    refreshPageCtx();
    // Poll every 2s while the panel is open to catch navigation within Zoho
    const interval = setInterval(refreshPageCtx, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

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
      // ── Deterministic quoting intercept ──
      // Detect if the user is asking for a URL quote (not a Zoho CRM quote)
      // Route through worker API — same parseMessage + buildQuoteResponse as Webex/GChat bots
      const isQuoteIntent = /^\s*(quote|price|cost|order|get me|give me|generate)\s/i.test(messageText) &&
        /\b(MR|MS|MX|MV|MT|MG|CW|C9|C8|Z\d|LIC-)\w*/i.test(messageText) &&
        !/\b(zoho|crm|deal|account)\b/i.test(messageText);
      const isDirectSku = /^\s*\d+\s*(x\s*)?(MR|MS|MX|MV|MT|MG|CW|C9|Z\d)/i.test(messageText);

      if (isQuoteIntent || isDirectSku) {
        try {
          const apiResult = await sendToBackground(MSG.GENERATE_QUOTE, { skuText: messageText.trim(), personId: 'chrome-ext-chat-' + Date.now() });
          if (apiResult) {
            const rawUrls = apiResult.quoteUrls || apiResult.urls || [];
            const urlsArr = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
            const eolArr = Array.isArray(apiResult.eolWarnings) ? apiResult.eolWarnings : [];
            const suggestArr = Array.isArray(apiResult.suggestions) ? apiResult.suggestions : [];

            let replyText = '';

            // Suggestions (invalid/incomplete SKUs)
            if (suggestArr.length > 0) {
              replyText += '**⚠️ SKU Validation Issues:**\n\n';
              for (const s of suggestArr) {
                replyText += `• **${s.input}**: ${s.reason}`;
                if (s.suggest && s.suggest.length > 0) {
                  replyText += ` → Did you mean: ${s.suggest.join(', ')}?`;
                }
                replyText += '\n';
              }
              replyText += '\nPlease correct the SKUs and try again.\n';
            }

            // Pricing response
            if (apiResult.pricingResponse) {
              replyText += '**💰 Pricing:**\n\n' + apiResult.pricingResponse;
            }

            // EOL date response
            if (apiResult.eolDateResponse) {
              replyText += apiResult.eolDateResponse;
            }

            // Claude advisory response
            if (apiResult.claudeResponse) {
              replyText += apiResult.claudeResponse;
            }

            // Quote URLs
            if (urlsArr.length > 0) {
              if (replyText) replyText += '\n\n';
              replyText += '**⚡ Deterministic Quote:**\n\n';
              if (eolArr.length > 0) {
                replyText += '**EOL Warnings:**\n';
                for (const w of eolArr) replyText += `• ${w}\n`;
                replyText += '\n';
              }
              for (const urlObj of urlsArr) {
                const u = (typeof urlObj === 'object') ? urlObj : { url: String(urlObj), label: 'Quote' };
                replyText += `**${u.label}:**\n[${u.url.length > 80 ? u.url.substring(0, 80) + '...' : u.url}](${u.url})\n\n`;
              }
            }

            if (replyText.trim()) {
              const assistantMsg = {
                id: Date.now() + 1,
                role: 'assistant',
                content: replyText.trim(),
                usedTools: false,
                timestamp: new Date().toISOString(),
              };
              onMessagesChange([...updatedMessages, assistantMsg]);
              setLoading(false);
              return;
            }
          }
        } catch (quoteErr) {
          console.warn('[Stratus] Quote API intercept failed, falling back to chat:', quoteErr);
        }
      }

      const historyForApi = (messages || []).slice(-10).map(m => ({
        role: m.role,
        content: m.content,
      }));

      // Build effective context: if user selected a specific email, override customerEmail
      const effectiveContext = selectedContextEmail === '__none__'
        ? null
        : selectedContextEmail && emailContext
          ? { ...emailContext, customerEmail: selectedContextEmail, customerName: participantOptions.find(p => p.email === selectedContextEmail)?.name || '' }
          : emailContext || null;

      // Inject active Zoho page context so "this quote", "this deal", "modify this",
      // etc. resolve to whatever record the user is currently viewing in Zoho CRM.
      // The hint is prepended to the user message so the LLM sees it as part of
      // the query context — not injected into system prompt (which Claude flags as
      // prompt injection when it looks like capability claims).
      let textToSend = messageText;
      const zohoHint = buildZohoPageContextHint(zohoPageContext);
      if (zohoHint) {
        textToSend = `${zohoHint}\n\nUser message: ${messageText}`;
      }

      const response = await sendToBackground(MSG.CHAT_HANDOFF, {
        text: textToSend,
        emailContext: effectiveContext,
        history: historyForApi,
        systemContext: buildSystemContext(emailContext, selectedContextEmail === '__none__' ? null : selectedContextEmail),
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
      if (!thisAbort.aborted) setLoading(false);
    }
  }, [input, loading, messages, emailContext, onMessagesChange]);

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
            {zohoPageContext && zohoPageContext.recordId && (
              <div style={{
                marginTop: 12, padding: '6px 10px', background: '#e8f4f8',
                border: `1px solid ${COLORS.STRATUS_BLUE}55`, borderRadius: 6,
                fontSize: 11, color: COLORS.STRATUS_BLUE, display: 'flex',
                alignItems: 'center', gap: 6
              }}>
                <span>📄</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  Viewing {({Quotes:'Quote',Potentials:'Deal',Deals:'Deal',Accounts:'Account',Contacts:'Contact',Tasks:'Task',SalesOrders:'Sales Order',Invoices:'Invoice'}[zohoPageContext.module] || zohoPageContext.module)}
                  {zohoPageContext.recordName ? ': ' + zohoPageContext.recordName : ' ' + zohoPageContext.recordId}
                </span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>— referenced by "this"</span>
              </div>
            )}
            {participantOptions.length > 0 && (
              <div style={{ marginTop: 12, position: 'relative' }}>
                <button
                  onClick={(e) => { e.stopPropagation(); setContextDropdownOpen(v => !v); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '5px 10px', background: activeContextEmail ? COLORS.STRATUS_LIGHT : COLORS.BG_SECONDARY,
                    border: `1px solid ${activeContextEmail ? COLORS.STRATUS_BLUE + '55' : COLORS.BORDER}`,
                    borderRadius: 6, fontSize: 11, color: activeContextEmail ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
                    cursor: 'pointer', width: '100%', textAlign: 'left',
                  }}
                  title="Select which thread participant to use as CRM context"
                >
                  <span style={{ opacity: 0.7 }}>Context:</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: activeContextEmail ? 600 : 400 }}>
                    {activeContextEmail
                      ? (activeContact?.name || activeContextEmail)
                      : 'None (no CRM context)'}
                  </span>
                  <span style={{ opacity: 0.6, fontSize: 9 }}>▼</span>
                </button>
                {contextDropdownOpen && (
                  <div onClick={(e) => e.stopPropagation()} style={{
                    position: 'absolute', bottom: '100%', left: 0, right: 0,
                    background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
                    borderRadius: 6, boxShadow: '0 -4px 12px rgba(0,0,0,0.12)',
                    zIndex: 999, overflow: 'hidden', marginBottom: 4,
                  }}>
                    <div style={{ padding: '4px 0' }}>
                      {/* No context option */}
                      <button
                        onClick={() => { setSelectedContextEmail('__none__'); setContextDropdownOpen(false); }}
                        style={{
                          display: 'block', width: '100%', textAlign: 'left',
                          padding: '6px 12px', background: selectedContextEmail === '__none__' ? COLORS.BG_SECONDARY : 'transparent',
                          border: 'none', cursor: 'pointer', fontSize: 11, color: COLORS.TEXT_SECONDARY,
                        }}
                      >
                        No context (general chat)
                      </button>
                      {/* Participant options */}
                      {participantOptions.map((p) => (
                        <button
                          key={p.email}
                          onClick={() => { setSelectedContextEmail(p.email); setContextDropdownOpen(false); }}
                          style={{
                            display: 'block', width: '100%', textAlign: 'left',
                            padding: '6px 12px',
                            background: (selectedContextEmail === p.email || (!selectedContextEmail && p.email === emailContext?.customerEmail)) ? COLORS.STRATUS_LIGHT : 'transparent',
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
                    </div>
                  </div>
                )}
              </div>
            )}
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
            alignSelf: 'flex-start', padding: '10px 14px',
            background: COLORS.BG_SECONDARY, borderRadius: 8,
            color: COLORS.TEXT_SECONDARY, fontSize: 13,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>●●●</span>
              <span style={{ fontSize: 11 }}>Working...</span>
              <button onClick={handleStop} style={{
                marginLeft: 4, padding: '2px 8px',
                background: '#fce8e6', color: COLORS.ERROR,
                border: `1px solid ${COLORS.ERROR}44`, borderRadius: 4,
                fontSize: 11, cursor: 'pointer', fontWeight: 600,
              }}>
                Stop
              </button>
            </div>
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

      {/* Input Area */}
      <div style={{ borderTop: `1px solid ${COLORS.BORDER}`, padding: '10px 16px', background: COLORS.BG_PRIMARY }}>
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
