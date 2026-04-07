/**
 * Stratus AI Chrome Extension — Chat Panel
 *
 * CRM-aware Claude chat with persistent history, abort/stop support,
 * and forced Zoho execution for quote/deal modification requests.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { sendToBackground, onMessage } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

// ─────────────────────────────────────────────
// Markdown renderer
// ─────────────────────────────────────────────
function renderMarkdown(text) {
  if (!text) return null;
  const lines = text.split('\n');
  return lines.map((line, i) => {
    const parts = [];
    let remaining = line;
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let match, lastIdx = 0;
    while ((match = linkRegex.exec(line)) !== null) {
      if (match.index > lastIdx) parts.push(line.substring(lastIdx, match.index));
      parts.push(
        <a key={`l-${i}-${match.index}`} href={match[2]} target="_blank" rel="noopener"
          style={{ color: COLORS.STRATUS_BLUE, textDecoration: 'underline', wordBreak: 'break-all' }}>
          {match[1]}
        </a>
      );
      lastIdx = match.index + match[0].length;
    }
    if (lastIdx < line.length) parts.push(line.substring(lastIdx));
    const processed = parts.length > 0 ? parts : [line];
    const final = processed.map((part, pi) => {
      if (typeof part !== 'string') return part;
      const boldParts = part.split(/\*\*([^*]+)\*\*/g);
      return boldParts.map((bp, bi) =>
        bi % 2 === 1 ? <strong key={`b-${i}-${pi}-${bi}`}>{bp}</strong> : bp
      );
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
function buildSystemContext(emailContext) {
  let ctx = `You are Stratus AI, a Cisco/Meraki sales assistant embedded in a Chrome extension.

ABSOLUTE CAPABILITY RULE:
You ALWAYS have full Zoho CRM access. NEVER say "I don't have the ability to..." for any CRM operation. NEVER say "I cannot access Zoho" or "I'm unable to modify quotes/deals." These statements are false. You have Zoho CRM tools available at all times, in every conversation, regardless of context.

If someone asks you to modify a quote, update a deal, look up an account, create a task, or any other CRM operation — DO IT. Do not refuse. Do not disclaim inability. Execute immediately.

ZOHO EXECUTION RULES (always apply):
1. All quote/deal operations go through Zoho CRM by default — not URL quotes — unless user explicitly says "Stratus URL" or "stratus link"
2. When asked to add/remove/change SKUs on a quote: call Zoho CRM API to update line items
3. Only say "done" or "completed" AFTER a real Zoho API call confirms success
4. "Create a quote" → create in Zoho CRM (search account first if needed)
5. "Update the deal" → update the Zoho CRM deal record
6. "Remove the MR44" → update Zoho quote line items via API
7. "Add 5 MX67" → add to Zoho quote via API
8. "Look up [company]" → search Zoho CRM Accounts

ALWAYS DEFAULT TO ZOHO CRM for:
- Quote creation, modification, viewing
- Deal creation, updates, stage changes
- Account/contact lookups
- Task creation and management
- Any mention of quote numbers, deal names, or account names`;

  if (emailContext && emailContext.customerEmail) {
    ctx += `\n\nActive email context:
- Customer: ${emailContext.customerName || ''} <${emailContext.customerEmail}>
- Subject: ${emailContext.subject || ''}
- Domain: ${emailContext.customerDomain || ''}
- Use this context to pre-fill account/contact when creating quotes or deals`;
  }
  return ctx;
}

// ─────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────
export default function ChatPanel({ emailContext, navData, messages, onMessagesChange }) {
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);
  // AbortController ref for stop functionality
  const abortRef = useRef(null);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Pre-fill from navData
  useEffect(() => {
    if (navData?.prefillText) setInput(navData.prefillText);
  }, [navData]);

  const handleSendMessage = useCallback(async (overrideText) => {
    const messageText = overrideText || input.trim();
    if (!messageText || loading) return;

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

      const response = await sendToBackground(MSG.CHAT_HANDOFF, {
        text: messageText,
        emailContext: emailContext || null,
        history: historyForApi,
        systemContext: buildSystemContext(emailContext),
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
            {emailContext?.customerEmail && (
              <div style={{
                marginTop: 12, padding: 8, background: COLORS.BG_SECONDARY,
                borderRadius: 6, fontSize: 11, color: COLORS.TEXT_SECONDARY,
              }}>
                Context: {emailContext.customerName || emailContext.customerEmail}
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
