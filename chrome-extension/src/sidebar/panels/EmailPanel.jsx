/**
 * Email Analysis Panel
 * Shows AI-powered email summary, urgency, action items, and detected SKUs.
 */

import { useState, useEffect } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

export default function EmailPanel({ emailContext, navData }) {
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Auto-analyze if triggered by keyboard shortcut
  useEffect(() => {
    if (navData?.action === 'analyze' && emailContext) {
      handleAnalyze();
    }
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
      {/* Email Summary */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
          {emailContext.subject}
        </div>
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>
          {emailContext.isOutbound ? 'To' : 'From'}: {emailContext.senderName || emailContext.senderEmail}
          {emailContext.customerEmail && emailContext.isOutbound && (
            <span> | Customer: {emailContext.customerName || emailContext.customerEmail}</span>
          )}
        </div>
      </div>

      {/* Analyze Button */}
      {!analysis && !loading && (
        <button
          onClick={handleAnalyze}
          style={{
            width: '100%', padding: '10px 16px', background: COLORS.STRATUS_BLUE,
            color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
            fontWeight: 600, cursor: 'pointer', marginBottom: 16,
          }}
        >
          🤖 Analyze Email
        </button>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 20, color: COLORS.TEXT_SECONDARY }}>
          <div className="spinner" style={{ margin: '0 auto 12px' }} />
          Analyzing email...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          padding: 12, background: '#fce8e6', borderRadius: 8,
          color: COLORS.ERROR, fontSize: 13, marginBottom: 16,
        }}>
          {error}
        </div>
      )}

      {/* Analysis Results */}
      {analysis && (
        <div>
          {/* Summary */}
          {analysis.summary && (
            <Section title="Summary">
              <p style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.TEXT_PRIMARY }}>{analysis.summary}</p>
            </Section>
          )}

          {/* Urgency */}
          {analysis.urgency && (
            <Section title="Urgency">
              <UrgencyBadge level={analysis.urgency} />
            </Section>
          )}

          {/* Action Items */}
          {analysis.actionItems && analysis.actionItems.length > 0 && (
            <Section title="Action Items">
              {analysis.actionItems.map((item, i) => (
                <div key={i} style={{
                  display: 'flex', gap: 8, padding: '6px 0',
                  borderBottom: i < analysis.actionItems.length - 1 ? `1px solid ${COLORS.BORDER}` : 'none',
                }}>
                  <span style={{ color: COLORS.STRATUS_BLUE }}>•</span>
                  <span style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY }}>{item}</span>
                </div>
              ))}
            </Section>
          )}

          {/* Detected SKUs */}
          {analysis.detectedSkus && analysis.detectedSkus.length > 0 && (
            <Section title="Detected SKUs">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {analysis.detectedSkus.map((sku, i) => (
                  <span key={i} style={{
                    background: COLORS.STRATUS_LIGHT, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
                    borderRadius: 4, padding: '3px 8px', fontSize: 12, fontWeight: 500,
                    color: COLORS.STRATUS_DARK, cursor: 'pointer',
                  }}
                  onClick={() => sendToBackground(MSG.SIDEBAR_NAVIGATE, { panel: 'quote', data: { skuText: sku.sku || sku } })}
                  >
                    {sku.sku || sku}{sku.qty > 1 ? ` (x${sku.qty})` : ''}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* CRM Account */}
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

          {/* Velocity Hub Quick Action */}
          {navData?.velocityHubDealId && (
            <Section title="Deal ID Detected">
              <div style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY, marginBottom: 8 }}>
                Deal ID: <span style={{ fontWeight: 600, color: '#2e7d32' }}>{navData.velocityHubDealId}</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => window.open(`https://crm.zoho.com/crm/org647122552/tab/Potentials/${navData.velocityHubDealId}`, '_blank')}
                  style={{
                    flex: 1, padding: '8px 12px', background: COLORS.STRATUS_BLUE,
                    color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Open Deal in Zoho
                </button>
              </div>
            </Section>
          )}

          {/* Re-analyze button */}
          <button
            onClick={() => { setAnalysis(null); handleAnalyze(); }}
            style={{
              width: '100%', padding: '8px', background: 'transparent',
              border: `1px solid ${COLORS.BORDER}`, borderRadius: 8,
              color: COLORS.TEXT_SECONDARY, fontSize: 13, cursor: 'pointer', marginTop: 12,
            }}
          >
            Re-analyze
          </button>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{
      background: COLORS.BG_PRIMARY, borderRadius: 8, padding: 12,
      marginBottom: 12, border: `1px solid ${COLORS.BORDER}`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
        {title}
      </div>
      {children}
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
    <span style={{
      background: c.bg, color: c.color, padding: '4px 10px',
      borderRadius: 12, fontSize: 12, fontWeight: 600,
    }}>
      {c.label}
    </span>
  );
}
