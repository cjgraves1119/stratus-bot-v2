/**
 * QuoteResult — renders a deterministic-engine quote result inline in the Chat
 * thread. Extracted from the old Quote tab (QuotePanel) when quoting moved into
 * Chat (2026-06-17). Pure presentational + local copy state.
 *
 * Props:
 *   result          normalized result object from lib/quote-client
 *   onApplySuggestion(suggestion)  replace the bad SKU and re-quote
 *   onStackSuggestion(suggestion)  append the suggested SKU and re-quote
 *   onSendToZoho(result)           hand the chosen order URL to the CRM agent
 *   busy            true while a re-quote (apply/stack) is in flight
 *
 * Per the no-margin rule, labels + URLs only — never pricing/cost/margin.
 */

import { useState } from 'react';
import { COLORS } from '../../lib/constants';

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

async function writeRichClipboard({ text, html }) {
  if (navigator.clipboard?.write && window.ClipboardItem && html) {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return;
  }
  await navigator.clipboard.writeText(text);
}

async function plainCopy(text) {
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
}

export default function QuoteResult({ result, onApplySuggestion, onStackSuggestion, onSendToZoho, busy }) {
  const [copiedIdx, setCopiedIdx] = useState(null);
  // Track which order URL (term) the user last copied/opened so the Zoho
  // handoff sends THAT one, not always the first (1-year) option.
  const [selectedIdx, setSelectedIdx] = useState(0);

  if (!result) return null;

  async function handleCopy(text, idx) {
    await plainCopy(text);
    setCopiedIdx(idx);
    if (typeof idx === 'number') setSelectedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  async function handleCopyAll(urls) {
    const rows = (urls || []).filter(u => u?.url);
    const text = rows.map((u, i) => `${u.label || `Option ${i + 1}`}: ${u.url}`).join('\n');
    if (!text) return;
    const html = rows.map((u, i) => {
      const label = escapeHtml(u.label || `Option ${i + 1}`);
      const url = escapeHtml(u.url);
      return `<div><strong>${label}:</strong> <a href="${url}">${url}</a></div>`;
    }).join('');
    try {
      await writeRichClipboard({ text, html });
    } catch {
      await handleCopy(text, 'all');
      return;
    }
    setCopiedIdx('all');
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  const urls = Array.isArray(result.urls) ? result.urls : [];
  const suggestions = Array.isArray(result.suggestions) ? result.suggestions : [];

  return (
    <div style={{ opacity: busy ? 0.55 : 1 }}>
      {/* Validation suggestions ("Did you mean?") */}
      {suggestions.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {suggestions.map((s, i) => (
            <div key={i} style={{
              padding: 10, background: '#fff3e0', borderRadius: 8,
              border: '1px solid #ff980033', marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e65100', marginBottom: 4 }}>
                {s.isCommonMistake ? '⚠️' : '❓'} {s.input}: {s.reason}
              </div>
              {s.suggest && s.suggest.length > 0 && (
                <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>
                  <span style={{ color: COLORS.TEXT_SECONDARY }}>Did you mean: </span>
                  {s.suggest.map((sug, j) => (
                    <span key={j} style={{ display: 'inline-flex', gap: 2, marginRight: 6, marginTop: 4 }}>
                      <button
                        onClick={() => !busy && onApplySuggestion?.({ ...s, suggest: [sug] })}
                        title="Replace invalid SKU with this and re-quote"
                        disabled={busy}
                        style={{
                          background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_BLUE,
                          border: `1px solid ${COLORS.STRATUS_BLUE}44`, borderRadius: '4px 0 0 4px',
                          padding: '2px 8px', fontSize: 12, fontWeight: 600, cursor: busy ? 'default' : 'pointer',
                        }}
                      >
                        {sug}
                      </button>
                      <button
                        onClick={() => !busy && onStackSuggestion?.({ ...s, suggest: [sug] })}
                        title="Add to quote (stack)"
                        disabled={busy}
                        style={{
                          background: COLORS.STRATUS_BLUE, color: 'white',
                          border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: '0 4px 4px 0',
                          padding: '2px 5px', fontSize: 11, fontWeight: 700, cursor: busy ? 'default' : 'pointer',
                        }}
                      >
                        +
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pricing calculator response */}
      {result.pricingResponse && (
        <TextBlock badge="💰 Pricing" badgeBg="#e8f5e9" badgeColor="#2e7d32" mono text={result.pricingResponse} />
      )}

      {/* EOL date lookup response */}
      {result.eolDateResponse && (
        <TextBlock badge="📅 EOL Date Lookup" badgeBg="#fef7e0" badgeColor="#e37400" text={result.eolDateResponse} />
      )}

      {/* AI advisory response (technical questions) */}
      {result.claudeResponse && urls.length === 0 && (
        <TextBlock badge="🤖 AI Response" badgeBg="#e3f2fd" badgeColor="#1565c0" text={result.claudeResponse} />
      )}

      {/* Quote URLs */}
      {urls.length > 0 && (
        <div>
          <div style={{
            display: 'inline-block', padding: '3px 9px', borderRadius: 4,
            fontSize: 10, fontWeight: 600, marginBottom: 8,
            background: '#e8f5e9', color: '#2e7d32',
          }}>
            ⚡ Deterministic
          </div>

          {result.eolWarnings && result.eolWarnings.length > 0 && (
            <div style={{
              padding: 10, background: '#fef7e0', borderRadius: 8,
              border: '1px solid #fbbc0433', marginBottom: 10,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#e37400', marginBottom: 4 }}>
                EOL Warnings
              </div>
              {result.eolWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, padding: '2px 0' }}>
                  {typeof w === 'string' ? w : `${w.sku} is End-of-Life`}
                </div>
              ))}
            </div>
          )}

          <button
            onClick={() => handleCopyAll(urls)}
            style={{
              width: '100%', padding: '8px 10px', background: COLORS.STRATUS_BLUE,
              color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
              fontWeight: 700, cursor: 'pointer', marginBottom: 8,
            }}
          >
            {copiedIdx === 'all' ? '✓ Copied All Links!' : 'Copy All Links'}
          </button>

          {urls.map((urlObj, i) => (
            <div key={i} style={{
              background: COLORS.BG_PRIMARY,
              border: `1px solid ${selectedIdx === i && urls.length > 1 ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
              borderRadius: 8, padding: 10, marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 6 }}>
                {urlObj.label || `Option ${i + 1}`}
                {selectedIdx === i && urls.length > 1 && (
                  <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 600, color: COLORS.STRATUS_BLUE }}>
                    • selected for Zoho
                  </span>
                )}
              </div>
              <div style={{
                background: COLORS.BG_SECONDARY, borderRadius: 6, padding: '7px 9px',
                fontSize: 11, wordBreak: 'break-all', color: COLORS.STRATUS_BLUE, marginBottom: 8,
              }}>
                {/* Full URL, no truncation (2026-07-10): the container's
                    wordBreak:'break-all' wraps long order URLs; reps need to
                    see/verify the whole SKU list encoded in the link. */}
                <a href={urlObj.url} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {urlObj.url}
                </a>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleCopy(urlObj.url, i)}
                  style={{
                    flex: 1, padding: '6px 10px', background: COLORS.STRATUS_BLUE,
                    color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {copiedIdx === i ? '✓ Copied!' : 'Copy'}
                </button>
                <a
                  href={urlObj.url} target="_blank" rel="noopener"
                  onClick={() => setSelectedIdx(i)}
                  style={{
                    flex: 1, padding: '6px 10px', background: 'transparent',
                    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}`,
                    borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                    textAlign: 'center', display: 'inline-block',
                  }}
                >
                  Open
                </a>
              </div>
            </div>
          ))}

          {onSendToZoho && (
            <button
              onClick={() => onSendToZoho(result, selectedIdx)}
              style={{
                width: '100%', padding: '7px 10px', background: '#7b1fa2',
                color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                fontWeight: 600, cursor: 'pointer', marginTop: 2,
              }}
              title="Ask the CRM agent to create a Zoho quote from this order"
            >
              Create Zoho CRM quote from this
            </button>
          )}

          {result.parsed && result.parsed.length > 0 && (
            <div style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 10, marginTop: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                Parsed Items
              </div>
              {result.parsed.map((item, i) => (
                <div key={i} style={{ fontSize: 12, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6, color: COLORS.TEXT_PRIMARY }}>
                  <span style={{ fontWeight: 600 }}>{item.qty || 1}x</span>
                  <span>{item.baseSku}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Plain text block with a small badge (pricing / EOL / AI advisory).
function TextBlock({ badge, badgeBg, badgeColor, text, mono }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: 4,
        fontSize: 10, fontWeight: 600, marginBottom: 8, background: badgeBg, color: badgeColor,
      }}>
        {badge}
      </div>
      <div style={{
        background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
        borderRadius: 8, padding: 10, fontSize: 13, lineHeight: 1.6,
        color: COLORS.TEXT_PRIMARY, whiteSpace: 'pre-wrap',
        fontFamily: mono ? 'monospace' : 'inherit',
      }}>
        {String(text).split('\n').map((line, i) => {
          const cleaned = line.replace(/\*\*/g, '');
          const isBold = line.includes('**');
          return <div key={i} style={{ fontWeight: isBold ? 700 : 400 }}>{cleaned}</div>;
        })}
      </div>
    </div>
  );
}
