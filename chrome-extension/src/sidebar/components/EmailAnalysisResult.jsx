/**
 * EmailAnalysisResult — renders an AI email-analysis result inline in the Chat
 * thread. Extracted from the old Email tab (EmailPanel) when its capabilities
 * were folded into Chat as quick-actions (2026-06-17).
 *
 * Props:
 *   analysis        { summary, urgency, actionItems[], detectedSkus[], crmAccount }
 *   onQuoteSkus(skuText)   generate ecomm links for the detected SKUs
 */

import { COLORS } from '../../lib/constants';

function detectedSkuText(detectedSkus) {
  return (detectedSkus || [])
    .map(item => {
      if (typeof item === 'string') return item;
      const sku = item.sku || item.product || item.model || item.name || '';
      if (!sku) return '';
      const qty = item.qty || item.quantity || item.count || 1;
      return qty && Number(qty) > 1 ? `${qty} ${sku}` : sku;
    })
    .filter(Boolean)
    .join(', ');
}

function UrgencyBadge({ level }) {
  const config = {
    high: { bg: '#fce8e6', color: '#c5221f', label: 'High' },
    medium: { bg: '#fef7e0', color: '#e37400', label: 'Medium' },
    low: { bg: '#e6f4ea', color: '#137333', label: 'Low' },
  };
  const c = config[level?.toLowerCase()] || config.low;
  return (
    <span style={{ background: c.bg, color: c.color, padding: '3px 9px', borderRadius: 12, fontSize: 12, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

function Row({ title, children }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 4 }}>
        {title}
      </div>
      {children}
    </div>
  );
}

export default function EmailAnalysisResult({ analysis, onQuoteSkus }) {
  if (!analysis) return null;
  const skuText = detectedSkuText(analysis.detectedSkus);

  return (
    <div>
      <div style={{
        display: 'inline-block', padding: '3px 9px', borderRadius: 4,
        fontSize: 10, fontWeight: 600, marginBottom: 8, background: '#e3f2fd', color: '#1565c0',
      }}>
        🔎 Email Analysis
      </div>

      {analysis.summary && (
        <Row title="Summary">
          <p style={{ fontSize: 13, lineHeight: 1.5, color: COLORS.TEXT_PRIMARY, margin: 0 }}>{analysis.summary}</p>
        </Row>
      )}

      {analysis.urgency && (
        <Row title="Urgency"><UrgencyBadge level={analysis.urgency} /></Row>
      )}

      {analysis.actionItems?.length > 0 && (
        <Row title="Action Items">
          {analysis.actionItems.map((item, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
              <span style={{ color: COLORS.STRATUS_BLUE }}>•</span>
              <span style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY }}>{item}</span>
            </div>
          ))}
        </Row>
      )}

      {analysis.detectedSkus?.length > 0 && (
        <Row title="Detected SKUs">
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {analysis.detectedSkus.map((sku, i) => (
              <span key={i} style={{
                background: COLORS.STRATUS_LIGHT, border: `1px solid ${COLORS.STRATUS_BLUE}33`,
                borderRadius: 4, padding: '3px 8px', fontSize: 12, fontWeight: 500, color: COLORS.STRATUS_DARK,
              }}>
                {sku.sku || sku}{sku.qty > 1 ? ` (x${sku.qty})` : ''}
              </span>
            ))}
          </div>
          {skuText && onQuoteSkus && (
            <button
              onClick={() => onQuoteSkus(skuText)}
              style={{
                marginTop: 8, padding: '7px 10px', background: COLORS.STRATUS_BLUE,
                color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                fontWeight: 600, cursor: 'pointer',
              }}
            >
              Generate ecomm links for these SKUs
            </button>
          )}
        </Row>
      )}

      {analysis.crmAccount && (
        <Row title="CRM Account">
          <div style={{ fontSize: 13 }}>
            <div style={{ fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>{analysis.crmAccount.name}</div>
            {analysis.crmAccount.zohoUrl && (
              <a href={analysis.crmAccount.zohoUrl} target="_blank" rel="noopener" style={{ color: COLORS.STRATUS_BLUE, fontSize: 12 }}>
                Open in Zoho →
              </a>
            )}
          </div>
        </Row>
      )}
    </div>
  );
}
