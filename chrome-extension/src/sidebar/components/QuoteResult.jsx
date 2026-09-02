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

import { useEffect, useState } from 'react';
import { API_BASE, COLORS, MSG } from '../../lib/constants';
import { selectableQuoteTerms } from '../../lib/email-quote-flow.mjs';
import { sendToBackground } from '../../lib/messaging';
import { mixedTermApprovalState } from '../../lib/mixed-term-approval.mjs';
import {
  collectLeadTimeHardwareSkus,
  formatLeadTimeResult,
  requestLeadTimes,
  toLeadTimeHardwareSku,
} from '../../lib/lead-time-request.mjs';
import {
  normalizeQuoteOptionIndexes,
  selectQuoteOptionIndex,
  toggleQuoteOptionIndex,
} from './quote-option-selection.mjs';
import SkuQuantityEditor from './SkuQuantityEditor';

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

export default function QuoteResult({
  result,
  onApplySuggestion,
  onStackSuggestion,
  onSendToZoho,
  busy,
  draftRows,
  draftDirty = false,
  draftStatus = '',
  resultRevision = 0,
  onDraftRowsChange,
  onUpdateQuote,
  quoteUpdateLabel = 'Update quote',
  onProductSearch,
  draftTier = '',
  onDraftTierChange,
  draftTerm,
  onDraftTermChange,
  allowHaLicenseRatio = false,
}) {
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [editorDraftActive, setEditorDraftActive] = useState(false);
  const [mixedTermApproved, setMixedTermApproved] = useState(false);
  const [leadTimeSelected, setLeadTimeSelected] = useState(() => new Set());
  const [leadTimeUrlIndex, setLeadTimeUrlIndex] = useState(-1);
  const [leadTimeBusy, setLeadTimeBusy] = useState(false);
  const [leadTimeResult, setLeadTimeResult] = useState(null);
  // Copy/Open also select that option for Zoho. Multiple terms can be checked
  // so 1/3/5-year quotes are created under the same deal. Selection identity
  // is the reviewed option INDEX, not its URL: two semantically distinct
  // alternatives are allowed to share one deterministic cart URL.
  const [selectedIndexes, setSelectedIndexes] = useState([]);
  const urls = Array.isArray(result?.urls) ? result.urls : [];
  const suggestions = Array.isArray(result?.suggestions) ? result.suggestions : [];
  const termOptions = selectableQuoteTerms(urls);
  const isEditable = Array.isArray(draftRows)
    && typeof onDraftRowsChange === 'function'
    && typeof onUpdateQuote === 'function';
  // Suggestions are unresolved input, and edits are uncommitted input. In
  // either state every link/term/Zoho action from the prior response is stale.
  const quoteActionsBlocked = busy || draftDirty || editorDraftActive || suggestions.length > 0;
  const mixedTerm = mixedTermApprovalState({
    rows: Array.isArray(draftRows) ? draftRows : (result?.parsed || []),
    approved: mixedTermApproved,
  });
  const mixedTermBlocksActions = isEditable && mixedTerm.requiresApproval;
  const suggestionMutationLocked = busy || editorDraftActive;
  const validSelectedIndexes = normalizeQuoteOptionIndexes(selectedIndexes, urls.length);
  const hasExplicitTermSelection = validSelectedIndexes.length > 0;
  const leadTimeCandidates = (Array.isArray(draftRows) ? draftRows : (result?.parsed || []))
    .map((row, index) => ({
      index,
      sku: String(row?.sku || row?.baseSku || '').trim().toUpperCase(),
      hardwareSku: toLeadTimeHardwareSku(row?.sku || row?.baseSku),
    }))
    .filter((row) => row.hardwareSku);

  function selectIndex(index, { exclusive = false } = {}) {
    setSelectedIndexes((current) => selectQuoteOptionIndex(
      current, index, urls.length, { exclusive },
    ));
  }

  function toggleIndex(index) {
    setSelectedIndexes((current) => toggleQuoteOptionIndex(current, index, urls.length));
  }

  useEffect(() => {
    setSelectedIndexes([]);
    setMixedTermApproved(false);
    setLeadTimeSelected(new Set());
    setLeadTimeUrlIndex(-1);
    setLeadTimeResult(null);
  }, [resultRevision]);

  if (!result) return null;

  async function handleCopy(text, idx) {
    await plainCopy(text);
    const url = urls[idx]?.url;
    if (url) selectIndex(idx);
    setCopiedIdx(idx);
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

  function toggleLeadTimeSku(hardwareSku) {
    setLeadTimeSelected((current) => {
      const next = new Set(current);
      if (next.has(hardwareSku)) next.delete(hardwareSku);
      else next.add(hardwareSku);
      return next;
    });
    setLeadTimeUrlIndex(-1);
  }

  async function handleRequestLeadTimes() {
    if (leadTimeBusy || busy) return;
    setLeadTimeBusy(true);
    setLeadTimeResult(null);
    try {
      const settings = await sendToBackground(MSG.GET_SETTINGS).catch(() => ({}));
      const selectedSkus = leadTimeUrlIndex < 0 ? [...leadTimeSelected] : [];
      const orderUrl = leadTimeUrlIndex >= 0 ? urls[leadTimeUrlIndex]?.url : '';
      const out = await requestLeadTimes({
        apiBase: API_BASE,
        apiKey: settings?.apiKey || '',
        skus: selectedSkus.length ? selectedSkus : undefined,
        orderUrl: orderUrl || undefined,
        rows: selectedSkus.length || orderUrl ? undefined : (draftRows || result?.parsed || []),
      });
      setLeadTimeResult(out);
    } catch (error) {
      setLeadTimeResult({ ok: false, error: error?.message || 'Lead-time request failed.' });
    } finally {
      setLeadTimeBusy(false);
    }
  }

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
                        onClick={() => !suggestionMutationLocked && onApplySuggestion?.({ ...s, suggest: [sug] })}
                        title="Replace invalid SKU with this and re-quote"
                        disabled={suggestionMutationLocked}
                        style={{
                          background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_BLUE,
                          border: `1px solid ${COLORS.STRATUS_BLUE}44`, borderRadius: '4px 0 0 4px',
                          padding: '2px 8px', fontSize: 12, fontWeight: 600, cursor: suggestionMutationLocked ? 'default' : 'pointer',
                        }}
                      >
                        {sug}
                      </button>
                      <button
                        onClick={() => !suggestionMutationLocked && onStackSuggestion?.({ ...s, suggest: [sug] })}
                        title="Add to quote (stack)"
                        disabled={suggestionMutationLocked}
                        style={{
                          background: COLORS.STRATUS_BLUE, color: 'white',
                          border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: '0 4px 4px 0',
                          padding: '2px 5px', fontSize: 11, fontWeight: 700, cursor: suggestionMutationLocked ? 'default' : 'pointer',
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

      {isEditable && (
        <SkuQuantityEditor
          rows={draftRows}
          onRowsChange={onDraftRowsChange}
          onUpdate={onUpdateQuote}
          onProductSearch={onProductSearch}
          dirty={draftDirty || suggestions.length > 0}
          disabled={busy}
          title="Quote items (edit before using links)"
          updateLabel={suggestions.length > 0 ? 'Apply correction and update quote' : quoteUpdateLabel}
          status={draftStatus}
          tier={draftTier}
          onTierChange={onDraftTierChange}
          term={draftTerm}
          onTermChange={onDraftTermChange}
          onDraftActivityChange={setEditorDraftActive}
          allowHaLicenseRatio={allowHaLicenseRatio}
          generationHoldReason={mixedTerm.requiresApproval ? mixedTerm.message : ''}
        />
      )}

      {mixedTerm.mixed && (
        <div className="mixed-term-flag" role="alert">
          <div className="mixed-term-flag-title">{mixedTerm.flag}</div>
          <div className="mixed-term-flag-body">
            This cart mixes {mixedTerm.terms.map((term) => `${term}-year`).join(', ')} licenses.
            Generating eCommerce links or starting Zoho review stays blocked until you approve.
          </div>
          <label className="mixed-term-approve">
            <input
              type="checkbox"
              checked={mixedTermApproved}
              disabled={busy}
              onChange={(event) => setMixedTermApproved(event.target.checked)}
            />
            Approve mixed 1/3/5-year terms
          </label>
        </div>
      )}

      {isEditable && (
        <div className="lead-time-panel">
          <div className="lead-time-panel-title">Commerce Bot lead time</div>
          <div className="lead-time-panel-help">
            Hardware rows only (`-HW`). License SKUs are never sent. Requests go to the Stratus gateway.
          </div>
          {leadTimeCandidates.map((row) => (
            <label key={`${row.index}:${row.hardwareSku}`} className="lead-time-row">
              <input
                type="checkbox"
                checked={leadTimeSelected.has(row.hardwareSku)}
                disabled={busy || leadTimeBusy}
                onChange={() => toggleLeadTimeSku(row.hardwareSku)}
              />
              {row.sku}{row.hardwareSku !== row.sku ? ` → ${row.hardwareSku}` : ''}
            </label>
          ))}
          {urls.length > 0 && !quoteActionsBlocked && !mixedTermBlocksActions && (
            <div className="lead-time-urls">
              <div className="lead-time-panel-help">Or request from an eCommerce cart link:</div>
              {urls.map((urlObj, index) => (
                <label key={`lt-url-${index}`} className="lead-time-row">
                  <input
                    type="radio"
                    name="lead-time-url"
                    checked={leadTimeUrlIndex === index}
                    disabled={busy || leadTimeBusy}
                    onChange={() => {
                      setLeadTimeUrlIndex(index);
                      setLeadTimeSelected(new Set());
                    }}
                  />
                  {urlObj.label || `Option ${index + 1}`}
                </label>
              ))}
            </div>
          )}
          <button
            type="button"
            className="lead-time-request"
            disabled={busy || leadTimeBusy || (
              leadTimeUrlIndex < 0
              && leadTimeSelected.size === 0
              && collectLeadTimeHardwareSkus(draftRows || result?.parsed || []).length === 0
            )}
            onClick={handleRequestLeadTimes}
          >
            {leadTimeBusy ? 'Requesting lead times…' : 'Request lead times'}
          </button>
          {leadTimeResult && (
            <div
              role="status"
              className={`lead-time-result ${leadTimeResult.ok ? 'lead-time-result-ok' : 'lead-time-result-error'}`}
            >
              {formatLeadTimeResult(leadTimeResult)}
              {leadTimeResult.result?.text ? '' : ''}
            </div>
          )}
        </div>
      )}

      {isEditable && mixedTermBlocksActions && urls.length > 0 && (
        <div style={{ padding: 8, marginTop: 8, marginBottom: 8, borderRadius: 6, background: '#fef7e0', color: '#e37400', fontSize: 11 }}>
          Existing links, term selection, and Zoho conversion are hidden until mixed 1/3/5-year license terms are explicitly approved.
        </div>
      )}

      {isEditable && quoteActionsBlocked && urls.length > 0 && (
        <div style={{ padding: 8, marginTop: 8, marginBottom: 8, borderRadius: 6, background: '#fef7e0', color: '#e37400', fontSize: 11 }}>
          Existing links, term selection, and Zoho conversion are hidden until the edited SKU quantities are successfully rebuilt and verified.
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

      {/* Typed terminal recovery is inert: guidance only, with no retry or
          mutation button. This is important when a prior agent turn may have
          touched CRM or when deterministic catalog validation blocked a link. */}
      {result.recovery && (
        <div style={{
          padding: 10, marginBottom: 8, borderRadius: 8,
          border: `1px solid ${result.recovery.write_state === 'possible' ? '#d9302566' : '#f9ab0066'}`,
          background: result.recovery.write_state === 'possible' ? '#fce8e6' : '#fef7e0',
          color: COLORS.TEXT_PRIMARY,
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 3 }}>
            {result.recovery.title || 'Recovery required'}
          </div>
          {Array.isArray(result.recovery.actions) && result.recovery.actions.map((action, index) => (
            <div key={index} style={{ fontSize: 11, marginTop: 2 }}>
              {index + 1}. {action}
            </div>
          ))}
        </div>
      )}

      {/* AI advisory response (technical questions) */}
      {result.claudeResponse && urls.length === 0 && (
        <TextBlock badge="🤖 AI Response" badgeBg="#e3f2fd" badgeColor="#1565c0" text={result.claudeResponse} />
      )}

      {/* Quote URLs */}
      {urls.length > 0 && !quoteActionsBlocked && !mixedTermBlocksActions && (
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
              border: `1px solid ${validSelectedIndexes.includes(i) ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
              borderRadius: 8, padding: 10, marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, cursor: busy ? 'default' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={validSelectedIndexes.includes(i)}
                    disabled={busy}
                    onChange={() => toggleIndex(i)}
                  />
                  {urlObj.label || `Option ${i + 1}`}
                </label>
                {validSelectedIndexes.includes(i) && (
                  <span style={{ fontSize: 10, fontWeight: 600, color: COLORS.STRATUS_BLUE }}>
                    selected for Zoho
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
                  onClick={() => selectIndex(i)}
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
            <div style={{ marginTop: 8, padding: 8, border: `1px solid ${COLORS.BORDER}`, borderRadius: 8, background: COLORS.BG_PRIMARY }}>
              <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 4 }}>Zoho quote option</div>
              <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                Copy or Open also selects that option. Check 1, 3, and 5 year to create multiple quotes under the same deal.
              </div>
              {termOptions.map((option) => (
                <label key={`${option.index}:${option.url}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, marginBottom: 3, cursor: busy ? 'default' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={validSelectedIndexes.includes(option.index)}
                    disabled={busy}
                    onChange={() => toggleIndex(option.index)}
                  />
                  {option.years && option.label !== `${option.years}-Year`
                    ? `${option.years}-Year: ${option.label}`
                    : option.label}
                </label>
              ))}
              <button
                onClick={() => mixedTerm.canStartZohoReview && hasExplicitTermSelection && onSendToZoho(result, validSelectedIndexes)}
                disabled={busy || !hasExplicitTermSelection || !mixedTerm.canStartZohoReview}
                style={{
                  width: '100%', padding: '7px 10px', background: '#7b1fa2',
                  color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                  fontWeight: 600,                   cursor: busy || !hasExplicitTermSelection || !mixedTerm.canStartZohoReview ? 'default' : 'pointer', marginTop: 6,
                  opacity: busy || !hasExplicitTermSelection || !mixedTerm.canStartZohoReview ? 0.55 : 1,
                }}
                title={hasExplicitTermSelection
                  ? 'Begin a separate deterministic Zoho review; nothing is written until Execute'
                  : 'Select a quote option before starting Zoho review'}
              >
                {busy
                  ? 'Preparing Zoho review…'
                  : (validSelectedIndexes.length > 1
                    ? `Create ${validSelectedIndexes.length} Zoho CRM quotes from selected`
                    : (hasExplicitTermSelection ? 'Create Zoho CRM quote from selected' : 'Select an option to enable Zoho conversion'))}
              </button>
            </div>
          )}

          {!isEditable && result.parsed && result.parsed.length > 0 && (
            <div style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 10, marginTop: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                Parsed Items
              </div>
              {result.parsed.map((item, i) => (
                <div key={i} style={{ fontSize: 12, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6, color: COLORS.TEXT_PRIMARY }}>
                  <span>{item.baseSku}</span>
                  <span style={{ fontWeight: 600 }}>× {item.qty || 1}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!isEditable && urls.length === 0 && result.parsed && result.parsed.length > 0 && (
        <div style={{
          background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
          borderRadius: 8, padding: 10, marginTop: 8,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
            Parsed SKU quantities (retained even though pricing/links were unavailable)
          </div>
          {result.parsed.map((item, i) => (
            <div key={i} style={{ fontSize: 12, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6, color: COLORS.TEXT_PRIMARY }}>
              <span>{item.baseSku}</span>
              <span style={{ fontWeight: 600 }}>× {item.qty || 1}</span>
            </div>
          ))}
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
