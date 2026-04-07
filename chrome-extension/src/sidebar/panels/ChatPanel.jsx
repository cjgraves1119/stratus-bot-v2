/**
 * Stratus AI Chrome Extension — Chat Panel
 *
 * Inline Claude chat interface for CRM/quoting actions.
 * Sends messages to GChat worker's /api/handoff endpoint.
 */

import { useState, useRef, useEffect } from 'react';
import { sendToBackground, onMessage } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

export default function ChatPanel({ emailContext }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const messagesEndRef = useRef(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Listen for chat updates from background (future: streaming responses)
  useEffect(() => {
    return onMessage('CHAT_MESSAGE_UPDATE', (data) => {
      if (data.message) {
        setMessages((prev) => [...prev, data.message]);
      }
      if (data.error) {
        setError(data.error);
        setLoading(false);
      }
    });
  }, []);

  const handleSendMessage = async () => {
    if (!input.trim()) return;

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const response = await sendToBackground(MSG.CHAT_HANDOFF, {
        text: userMessage.content,
        emailContext: emailContext || null,
      });

      if (response && response.success && response.reply) {
        const assistantMessage = {
          id: Date.now() + 1,
          role: 'assistant',
          content: response.reply,
          timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
      } else if (response && response.error) {
        setError(response.error);
      } else {
        setError('No response from Claude');
      }
    } catch (err) {
      setError(err.message || 'Failed to send message');
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: COLORS.BG_PRIMARY,
      }}
    >
      {/* Messages Container */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {messages.length === 0 && !error && (
          <div
            style={{
              textAlign: 'center',
              color: COLORS.TEXT_SECONDARY,
              padding: '24px 16px',
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>💬</div>
            <p style={{ fontSize: 13, lineHeight: 1.5 }}>
              Start a conversation about CRM lookups, quoting, or email analysis.
            </p>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 8,
              background:
                msg.role === 'user' ? COLORS.STRATUS_BLUE : COLORS.BG_SECONDARY,
              color: msg.role === 'user' ? 'white' : COLORS.TEXT_PRIMARY,
              fontSize: 13,
              lineHeight: 1.4,
              wordWrap: 'break-word',
            }}
          >
            {msg.content}
          </div>
        ))}

        {loading && (
          <div
            style={{
              alignSelf: 'flex-start',
              padding: '8px 12px',
              color: COLORS.TEXT_SECONDARY,
              fontSize: 13,
            }}
          >
            <span style={{ animation: 'pulse 1s infinite' }}>●●●</span>
          </div>
        )}

        {error && (
          <div
            style={{
              alignSelf: 'flex-start',
              maxWidth: '85%',
              padding: '8px 12px',
              borderRadius: 8,
              background: COLORS.BG_SECONDARY,
              color: COLORS.ERROR,
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            Error: {error}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div
        style={{
          borderTop: `1px solid ${COLORS.BORDER}`,
          padding: '12px 16px',
          background: COLORS.BG_PRIMARY,
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask Claude something..."
            disabled={loading}
            style={{
              flex: 1,
              padding: '8px 12px',
              border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6,
              fontSize: 13,
              fontFamily: 'inherit',
              resize: 'none',
              height: 40,
              color: COLORS.TEXT_PRIMARY,
              backgroundColor: COLORS.BG_PRIMARY,
              opacity: loading ? 0.6 : 1,
              cursor: loading ? 'not-allowed' : 'text',
            }}
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || loading}
            style={{
              padding: '8px 16px',
              background: !input.trim() || loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
              color: 'white',
              border: 'none',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
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
