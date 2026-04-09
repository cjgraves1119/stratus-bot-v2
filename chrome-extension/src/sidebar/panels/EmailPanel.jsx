/**
 * Email Panel
 * AI email analysis + Draft Reply + CCW/Velocity Hub + Cisco Rep Assignment
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function Section({ title, children, collapsible = false, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{
      background: COLORS.BG_PRIMARY, borderRadius: 8, padding: 12,
      marginBottom: 12, border: `1px solid ${COLORS.BORDER}`,
    }}>
      <div
        style={{
          fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY,
          textTransform: 'uppercase', marginBottom: open ? 8 : 0,
          cursor: collapsible ? 'pointer' : 'default',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}
        onClick={() => collapsible && setOpen(v => !v)}
      >
        <span>{title}</span>
        {collapsible && <span style={{ fontSize: 10 }}>{open ? '▲' : '▼'}</span>}
      </div>
      {open && children}
    </div>
  );
}

function UrgencyBadge({ level }) {
  const config = {
    high: { bg: '#fce8e6', color: '#c5221f', label: 'High' },
    medium: { bg: '#fef7e0', color: '#e37400', label: 'Medium' },
    low: { bg: '#e6f4ea', color: '#137333', label: 'Low' },
  };
  const c = config[level?.toLowerCase()] || config.low;
  return (
    <span style={{ background: c.bg, color: c.color, padding: '4px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

// ─────────────────────────────────────────────
// Draft Reply Panel (merged into Email)
// ─────────────────────────────────────────────
function DraftSection({ emailContext }) {
  const [tone, setTone] = useState('warm');
  const [instructions, setInstructions] = useState('');
  const [drafts, setDrafts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const lastRequestRef = useRef(0);

  async function handleGenerate() {
    if (!emailContext) return;
    const now = Date.now();
    if (now - lastRequestRef.current < 1000) return; // Rate-limit: 1 request/sec
    lastRequestRef.current = now;
    setLoading(true);
    setError(null);
    try {
      const result = await sendToBackground(MSG.DRAFT_REPLY, {
        subject: emailContext.subject,
        body: emailContext.body,
        senderEmail: emailContext.senderEmail,
        senderName: emailContext.senderName,
        tone,
        instructions,
      });
      if (result && result.drafts) setDrafts(result.drafts);
      else if (result && result.draft) setDrafts([result.draft]);
      else setError('No draft generated.');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateGmailDraft(draftBody) {
    // Open Gmail compose with the draft pre-filled
    const to = emailContext?.customerEmail || emailContext?.senderEmail || '';
    const subject = `Re: ${emailContext?.subject || ''}`;
    const body = encodeURIComponent(draftBody);
    const gmailUrl = `https://mail.google.com/mail/?view=cm&to=${encodeURIComponent(to)}&su=${encodeURIComponent(subject)}&body=${body}`;
    window.open(gmailUrl, '_blank');
  }

  async function handleCopy(text) {
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

  return (
    <Section title="Draft Reply" collapsible defaultOpen={false}>
      {/* Quick Tone Buttons */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, flexWrap: 'wrap' }}>
        {['warm', 'professional', 'brief', 'follow-up'].map(t => (
          <button key={t} onClick={() => setTone(t)} style={{
            flex: '1 1 auto', padding: '6px 4px', border: `1px solid ${tone === t ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
            borderRadius: 6, background: tone === t ? COLORS.STRATUS_LIGHT : 'transparent',
            color: tone === t ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
            fontSize: 11, fontWeight: tone === t ? 600 : 400, cursor: 'pointer',
            textTransform: 'capitalize', whiteSpace: 'nowrap',
          }}>
            {t}
          </button>
        ))}
      </div>

      {/* Custom Instructions */}
      <textarea
        value={instructions}
        onChange={e => setInstructions(e.target.value)}
        placeholder="Optional: include a 3-year quote, mention promo end date..."
        rows={2}
        style={{
          width: '100%', padding: '8px 10px', border: `1px solid ${COLORS.BORDER}`,
          borderRadius: 6, fontSize: 12, fontFamily: 'inherit', resize: 'vertical',
          outline: 'none', boxSizing: 'border-box', marginBottom: 8,
        }}
      />

      <button onClick={handleGenerate} disabled={loading} style={{
        width: '100%', padding: '8px', background: loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
        color: 'white', border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
        cursor: loading ? 'default' : 'pointer', opacity: loading ? 0.7 : 1,
      }}>
        {loading ? 'Generating...' : 'Generate Draft'}
      </button>

      {error && <div style={{ fontSize: 12, color: COLORS.ERROR, marginTop: 8 }}>{error}</div>}

      {drafts.map((draft, i) => (
        <div key={i} style={{
          marginTop: 12, padding: 10, background: COLORS.BG_SECONDARY,
          borderRadius: 6, border: `1px solid ${COLORS.BORDER}`,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
            Option {i + 1}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', marginBottom: 8, color: COLORS.TEXT_PRIMARY }}>
            {draft}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => handleCreateGmailDraft(draft)} style={{
              flex: 1, padding: '6px', background: COLORS.STRATUS_BLUE, color: 'white',
              border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
              Open in Gmail
            </button>
            <button onClick={() => handleCopy(draft)} style={{
              flex: 1, padding: '6px', background: 'transparent', color: COLORS.STRATUS_BLUE,
              border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: 5, fontSize: 11, fontWeight: 600, cursor: 'pointer',
            }}>
              Copy
            </button>
          </div>
        </div>
      ))}
    </Section>
  );
}

// ─────────────────────────────────────────────
// CCW / Velocity Hub Section
// ─────────────────────────────────────────────
function CcwSection({ emailContext }) {
  const [ccwData, setCcwData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [vhLoading, setVhLoading] = useState(false);
  const [repLoading, setRepLoading] = useState(false);
  const [vhResult, setVhResult] = useState(null);
  const [repResult, setRepResult] = useState(null);
  const [selectedRep, setSelectedRep] = useState('');
  const [error, setError] = useState(null);

  const ccwDealNumber = emailContext?.ccwDealNumber;
  const ciscoEmails = emailContext?.ciscoEmails || [];

  useEffect(() => {
    if (ccwDealNumber && !ccwData && !loading) {
      handleLookup();
    }
  }, [ccwDealNumber]);

  async function handleLookup() {
    setLoading(true);
    setError(null);
    try {
      const result = await sendToBackground(MSG.CCW_LOOKUP, {
        ccwDealNumber,
        dealName: emailContext?.subject || '',
      });
      setCcwData(result);
    } catch (err) {
      setError('CCW lookup failed: ' + err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleVelocityHub() {
    if (!ccwData?.ccwQuote?.dealId && !ccwDealNumber) return;
    setVhLoading(true);
    setVhResult(null);
    try {
      const result = await sendToBackground(MSG.VELOCITY_HUB_SUBMIT, {
        dealId: ccwDealNumber,
        country: 'United States',
      });
      setVhResult(result);
    } catch (err) {
      setVhResult({ error: err.message });
    } finally {
      setVhLoading(false);
    }
  }

  async function handleAssignRep() {
    const repEmail = selectedRep || ciscoEmails[0];
    if (!repEmail || !ccwData?.ccwQuote?.dealId) return;
    setRepLoading(true);
    setRepResult(null);
    try {
      const result = await sendToBackground(MSG.ASSIGN_REP, {
        dealId: ccwData.ccwQuote.dealId,
        repEmail,
        repName: '',
      });
      setRepResult(result);
    } catch (err) {
      setRepResult({ error: err.message });
    } finally {
      setRepLoading(false);
    }
  }

  if (!ccwDealNumber && ciscoEmails.length === 0) return null;

  return (
    <Section title="CCW Deal">
      {loading && (
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, textAlign: 'center', padding: 8 }}>
          Looking up CCW Deal #{ccwDealNumber}...
        </div>
      )}

      {error && <div style={{ fontSize: 12, color: COLORS.ERROR }}>{error}</div>}

      {ccwDealNumber && !loading && !ccwData && (
        <button onClick={handleLookup} style={{
          width: '100%', padding: '8px', background: COLORS.STRATUS_BLUE,
          color: 'white', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer',
        }}>
          Look Up CCW Deal #{ccwDealNumber}
        </button>
      )}

      {ccwData && ccwData.found && ccwData.ccwQuote && (
        <div>
          <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, marginBottom: 8 }}>
            <strong>{ccwData.ccwQuote.dealName || ccwData.ccwQuote.subject || 'Quote Found'}</strong>
            {ccwData.ccwQuote.stage && (
              <span style={{ marginLeft: 8, color: COLORS.TEXT_SECONDARY }}>{ccwData.ccwQuote.stage}</span>
            )}
            {ccwData.ccwQuote.grandTotal && (
              <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
                ${Number(ccwData.ccwQuote.grandTotal).toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            {ccwData.ccwQuote.zohoUrl && (
              <a href={ccwData.ccwQuote.zohoUrl} target="_blank" rel="noopener" style={{
                flex: 1, padding: '6px', background: COLORS.STRATUS_LIGHT,
                color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
                borderRadius: 5, fontSize: 11, fontWeight: 600, textDecoration: 'none',
                textAlign: 'center', display: 'inline-block',
              }}>
                Open Quote
              </a>
            )}
            {ccwData.ccwQuote.dealUrl && (
              <a href={ccwData.ccwQuote.dealUrl} target="_blank" rel="noopener" style={{
                flex: 1, padding: '6px', background: 'transparent',
                color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}`,
                borderRadius: 5, fontSize: 11, fontWeight: 600, textDecoration: 'none',
                textAlign: 'center', display: 'inline-block',
              }}>
                Open Deal
              </a>
            )}
          </div>
          {/* Velocity Hub */}
          <button onClick={handleVelocityHub} disabled={vhLoading} style={{
            width: '100%', padding: '9px', marginBottom: 6,
            background: vhLoading ? COLORS.TEXT_SECONDARY : '#00bceb',
            color: 'white', border: 'none', borderRadius: 6, fontSize: 13,
            fontWeight: 700, cursor: vhLoading ? 'default' : 'pointer',
          }}>
            {vhLoading ? 'Submitting...' : '🚀 Submit to Velocity Hub'}
          </button>
          {vhResult && (
            <div style={{ fontSize: 12, padding: 8, borderRadius: 5, marginBottom: 6,
              background: vhResult.error ? '#fce8e6' : '#e6f4ea',
              color: vhResult.error ? COLORS.ERROR : '#137333' }}>
              {vhResult.error || vhResult.message || 'Submitted successfully'}
            </div>
          )}
        </div>
      )}

      {ccwData && !ccwData.found && (
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>
          No matching quote found for Deal #{ccwDealNumber}
        </div>
      )}

      {/* Cisco Rep Assignment */}
      {ciscoEmails.length > 0 && ccwData?.ccwQuote?.dealId && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.BORDER}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6, textTransform: 'uppercase' }}>
            Assign Cisco Rep
          </div>
          {ciscoEmails.length > 1 ? (
            <select value={selectedRep} onChange={e => setSelectedRep(e.target.value)}
              style={{ width: '100%', padding: '7px', border: `1px solid ${COLORS.BORDER}`,
                borderRadius: 6, fontSize: 12, marginBottom: 6, outline: 'none' }}>
              <option value="">Select rep...</option>
              {ciscoEmails.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          ) : (
            <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, marginBottom: 6 }}>
              {ciscoEmails[0]}
            </div>
          )}
          <button onClick={handleAssignRep} disabled={repLoading || (ciscoEmails.length > 1 && !selectedRep)}
            style={{
              width: '100%', padding: '7px', background: COLORS.STRATUS_BLUE, color: 'white',
              border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
              cursor: repLoading ? 'default' : 'pointer', opacity: repLoading ? 0.7 : 1,
            }}>
            {repLoading ? 'Assigning...' : 'Assign to Deal'}
          </button>
          {repResult && (
            <div style={{ fontSize: 12, padding: 8, borderRadius: 5, marginTop: 6,
              background: repResult.error ? '#fce8e6' : '#e6f4ea',
              color: repResult.error ? COLORS.ERROR : '#137333' }}>
              {repResult.error || repResult.message || 'Rep assigned'}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

// ─────────────────────────────────────────────
// Main EmailPanel
// ─────────────────────────────────────────────
export default function EmailPanel({ emailContext, navData }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (navData?.action === 'analyze' && emailContext) handleAnalyze();
  }, [navData]);

  async function handleAnalyze() {
    if (!emailContext) return;
    setLoading(true);
    setError(null);
    try {
      const result = await sendToBackground(MSG.ANALYZE_EMAIL, {
        subject: emailContext.subject,
        body: emailContext.body,
        senderEmail: emailContext.senderEmail,
        senderName: emailContext.senderName,
      });
      setAnalysis(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>📧</div>
        <p>Open an email to see analysis options.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Email Header */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
          {emailContext.subject}
        </div>
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>
          {emailContext.isOutbound ? 'To' : 'From'}: {emailContext.senderName || emailContext.senderEmail}
          {emailContext.customerEmail && emailContext.isOutbound && (
            <span> | {emailContext.customerName || emailContext.customerEmail}</span>
          )}
        </div>
        {emailContext.ciscoEmails?.length > 0 && (
          <div style={{ fontSize: 11, color: '#00bceb', marginTop: 3 }}>
            Cisco rep on thread: {emailContext.ciscoEmails.join(', ')}
          </div>
        )}
      </div>

      {/* CCW / Velocity Hub (auto-shown if CCW deal ID or Cisco rep detected) */}
      {(emailContext.ccwDealNumber || emailContext.ciscoEmails?.length > 0) && (
        <CcwSection emailContext={emailContext} />
      )}

      {/* Velocity Hub Quick Action from navData (context menu) */}
      {navData?.velocityHubDealId && (
        <Section title="Deal ID Detected">
          <div style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY, marginBottom: 8 }}>
            Deal ID: <strong style={{ color: '#2e7d32' }}>{navData.velocityHubDealId}</strong>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={() => window.open(`https://crm.zoho.com/crm/org647122552/tab/Potentials/${navData.velocityHubDealId}`, '_blank')}
              style={{
                flex: 1, padding: '8px', background: COLORS.STRATUS_BLUE, color: 'white',
                border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
              }}>
              Open Deal in Zoho
            </button>
          </div>
        </Section>
      )}

      {/* AI Analysis */}
      {!analysis && !loading && (
        <button onClick={handleAnalyze} style={{
          width: '100%', padding: '10px 16px', background: COLORS.STRATUS_BLUE,
          color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
          fontWeight: 600, cursor: 'pointer', marginBottom: 16,
        }}>
          🤖 Analyze Email
        </button>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: 20, color: COLORS.TEXT_SECONDARY }}>
          Analyzing email...
        </div>
      )}

      {error && (
        <div style={{ padding: 12, background: '#fce8e6', borderRadius: 8, color: COLORS.ERROR, fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {analysis && (
        <div>
          {analysis.summary && (
            <Section title="Summary">
              <p style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.TEXT_PRIMARY }}>{analysis.summary}</p>
            </Section>
          )}
          {analysis.urgency && (
            <Section title="Urgency">
              <UrgencyBadge level={analysis.urgency} />
            </Section>
          )}
          {analysis.actionItems?.length > 0 && (
            <Section title="Action Items">
              {analysis.actionItems.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '6px 0', borderBottom: i < analysis.actionItems.length - 1 ? `1px solid ${COLORS.BORDER}` : 'none' }}>
                  <span style={{ color: COLORS.STRATUS_BLUE }}>•</span>
                  <span style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY }}>{item}</span>
                </div>
              ))}
            </Section>
          )}
          {analysis.detectedSkus?.length > 0 && (
            <Section title="Detected SKUs">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {analysis.detectedSkus.map((sku, i) => (
                  <span key={i} style={{
                    background: COLORS.STRATUS_LIGHT, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
                    borderRadius: 4, padding: '3px 8px', fontSize: 12, fontWeight: 500,
                    color: COLORS.STRATUS_DARK, cursor: 'pointer',
                  }}
                  onClick={() => sendToBackground(MSG.SIDEBAR_NAVIGATE, { panel: 'quote', data: { skuText: sku.sku || sku } })}>
                    {sku.sku || sku}{sku.qty > 1 ? ` (x${sku.qty})` : ''}
                  </span>
                ))}
              </div>
            </Section>
          )}
          {analysis.crmAccount && (
            <Section title="CRM Account">
              <div style={{ fontSize: 13 }}>
                <div style={{ fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>{analysis.crmAccount.name}</div>
                {analysis.crmAccount.zohoUrl && (
                  <a href={analysis.crmAccount.zohoUrl} target="_blank" rel="noopener"
                    style={{ color: COLORS.STRATUS_BLUE, fontSize: 12 }}>
                    Open in Zoho →
                  </a>
                )}
              </div>
            </Section>
          )}
          <button onClick={() => { setAnalysis(null); handleAnalyze(); }} style={{
            width: '100%', padding: '8px', background: 'transparent',
            border: `1px solid ${COLORS.BORDER}`, borderRadius: 8,
            color: COLORS.TEXT_SECONDARY, fontSize: 13, cursor: 'pointer', marginBottom: 12,
          }}>
            Re-analyze
          </button>
        </div>
      )}

      {/* Draft Reply (always visible, collapsed by default) */}
      <DraftSection emailContext={emailContext} />
    </div>
  );
}
