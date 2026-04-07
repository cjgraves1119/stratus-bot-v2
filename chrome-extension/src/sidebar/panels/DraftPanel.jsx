/**
 * Draft Reply Panel
 * AI-generated reply drafts with tone selection and custom instructions.
 */

import { useState } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

const TONES = [
  { id: 'warm', label: 'Warm', emoji: '🤝' },
  { id: 'professional', label: 'Professional', emoji: '💼' },
  { id: 'brief', label: 'Brief', emoji: '⚡' },
];

export default function DraftPanel({ emailContext }) {
  const [tone, setTone] = useState('warm');
  const [instructions, setInstructions] = useState('');
  const [drafts, setDrafts] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);

  async function handleGenerate() {
    if (!emailContext) return;
    setLoading(true);
    setError(null);
    setDrafts(null);

    try {
      const result = await sendToBackground(MSG.DRAFT_REPLY, {
        subject: emailContext.subject,
        body: emailContext.body,
        senderEmail: emailContext.senderEmail,
        senderName: emailContext.senderName,
        tone,
        instructions,
      });
      setDrafts(result.drafts || [result]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(text, index) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(index);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  }

  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>✏️</div>
        <p>Open an email to generate reply drafts.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Tone Selection */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>Tone</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {TONES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTone(t.id)}
              style={{
                flex: 1, padding: '8px', borderRadius: 8, border: `1px solid ${COLORS.BORDER}`,
                background: tone === t.id ? COLORS.STRATUS_LIGHT : COLORS.BG_PRIMARY,
                color: tone === t.id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
                fontWeight: tone === t.id ? 600 : 400, fontSize: 12, cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {t.emoji} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Instructions */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
          Instructions (optional)
        </div>
        <textarea
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g., Include pricing for MS130-24P, mention the renewal deadline"
          rows={2}
          style={{
            width: '100%', padding: '8px 10px', border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={loading}
        style={{
          width: '100%', padding: '10px 16px', background: loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
          color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
          fontWeight: 600, cursor: loading ? 'default' : 'pointer',
        }}
      >
        {loading ? 'Generating Drafts...' : '✏️ Generate Draft Replies'}
      </button>

      {/* Error */}
      {error && (
        <div style={{ padding: 12, background: '#fce8e6', borderRadius: 8, color: COLORS.ERROR, fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}

      {/* Draft Results */}
      {drafts && drafts.map((draft, i) => (
        <div key={i} style={{
          background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
          borderRadius: 8, padding: 14, marginTop: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>
            Draft {i + 1}
          </div>
          <div style={{
            fontSize: 13, lineHeight: 1.6, color: COLORS.TEXT_PRIMARY,
            whiteSpace: 'pre-wrap', marginBottom: 10,
          }}>
            {draft.body || draft.text || draft}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => handleCopy(draft.body || draft.text || draft, i)}
              style={{
                flex: 1, padding: '6px 12px', background: COLORS.STRATUS_BLUE,
                color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              {copied === i ? '✓ Copied!' : '📋 Copy'}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
