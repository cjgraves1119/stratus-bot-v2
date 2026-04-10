/**
 * Search Panel
 * Search Zoho CRM across modules with clickable Zoho links.
 */

import { useState, useEffect, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

const ZOHO_ORG = 'org647122552';
const MODULE_MAP = {
  Accounts: { label: 'Accounts', tab: 'Accounts' },
  Contacts: { label: 'Contacts', tab: 'Contacts' },
  Deals: { label: 'Deals', tab: 'Potentials' },
  Quotes: { label: 'Quotes', tab: 'Quotes' },
  Sales_Orders: { label: 'POs', tab: 'SalesOrders' },
  Invoices: { label: 'Invoices', tab: 'Invoices' },
};

function buildZohoUrl(moduleId, recordId) {
  const tab = MODULE_MAP[moduleId]?.tab || moduleId;
  return `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/${tab}/${recordId}`;
}

export default function SearchPanel({ navData }) {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState('Accounts');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (navData?.query) {
      setQuery(navData.query);
      const mod = navData.module || module;
      if (navData.module) setModule(navData.module);
      handleSearch(navData.query, mod);
    }
  }, [navData]);

  async function handleSearch(q, mod) {
    const searchQuery = q || query;
    if (!searchQuery.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const result = await sendToBackground(MSG.CRM_SEARCH, {
        query: searchQuery.trim(),
        module: mod || module,
      });
      setResults({ ...result, searchModule: mod || module });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSearch();
  }

  function getFieldValue(obj) {
    if (obj == null) return null;
    if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
    if (typeof obj === 'object' && obj.name) return obj.name;
    return null;
  }

  function renderRecord(record, mod, i) {
    const zohoUrl = buildZohoUrl(mod, record.id);

    switch (mod) {
      case 'Accounts': {
        const name = getFieldValue(record.name) || getFieldValue(record.Account_Name) || 'Unnamed Account';
        const phone = getFieldValue(record.phone) || getFieldValue(record.Phone);
        const website = getFieldValue(record.website) || getFieldValue(record.Website);
        const city = getFieldValue(record.billingCity) || getFieldValue(record.Billing_City);
        const state = getFieldValue(record.billingState) || getFieldValue(record.Billing_State);
        const location = [city, state].filter(Boolean).join(', ');

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE, marginBottom: 2 }}>
              {name}
            </div>
            {phone && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{phone}</div>}
            {website && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{website}</div>}
            {location && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{location}</div>}
            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      case 'Contacts': {
        const firstName = getFieldValue(record.First_Name) || '';
        const lastName = getFieldValue(record.Last_Name) || '';
        const name = `${firstName} ${lastName}`.trim() || 'Unnamed Contact';
        const email = getFieldValue(record.Email);
        const phone = getFieldValue(record.Phone);
        const account = getFieldValue(record.Account_Name);

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE }}>{name}</div>
            {account && <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>{account}</div>}
            {email && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{email}</div>}
            {phone && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{phone}</div>}
            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      case 'Deals': {
        const name = getFieldValue(record.Deal_Name) || 'Unnamed Deal';
        const stage = getFieldValue(record.Stage);
        const amount = getFieldValue(record.Amount);
        const account = getFieldValue(record.Account_Name);
        const closeDate = getFieldValue(record.Closing_Date);

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE }}>{name}</div>
            {account && <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>{account}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
              {stage && (
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: stage.includes('Closed') ? '#e8f5e9' : '#e3f2fd',
                  color: stage.includes('Closed') ? '#2e7d32' : '#1565c0',
                }}>
                  {stage}
                </span>
              )}
              {amount && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>
                  ${Number(amount).toLocaleString()}
                </span>
              )}
              {closeDate && (
                <span style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{closeDate}</span>
              )}
            </div>
            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      case 'Quotes': {
        const subject = getFieldValue(record.Subject) || 'Unnamed Quote';
        const quoteNum = getFieldValue(record.Quote_Number);
        const total = getFieldValue(record.Grand_Total);
        const deal = getFieldValue(record.Deal_Name);
        const stage = getFieldValue(record.Stage);

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE }}>{subject}</div>
            {quoteNum && <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>#{quoteNum}</div>}
            {deal && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>Deal: {deal}</div>}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              {total && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>
                  ${Number(total).toLocaleString()}
                </span>
              )}
              {stage && (
                <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: '#f5f5f5' }}>
                  {stage}
                </span>
              )}
            </div>
            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      case 'Sales_Orders': {
        const poSubject = getFieldValue(record.Subject) || 'Unnamed PO';
        const soNumber = getFieldValue(record.SO_Number);
        const poTotal = getFieldValue(record.Grand_Total);
        const poStatus = getFieldValue(record.Status);
        const poDeal = getFieldValue(record.Deal_Name);
        const poAccount = getFieldValue(record.Account_Name);
        const signed = getFieldValue(record.Client_Send_Status);
        const tracking = getFieldValue(record.Disti_Tracking_Number);
        const estShip = getFieldValue(record.Disti_Estimated_Ship_Date);
        const vendorSo = getFieldValue(record.Vendor_SO_Number);

        const isSigned = signed && signed.toLowerCase() === 'signed';
        const statusColor = poStatus === 'Delivered' ? '#2e7d32'
          : poStatus === 'Cancelled' ? '#d93025'
          : poStatus === 'Created' ? '#1565c0'
          : '#5f6368';

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE }}>{poSubject}</div>
            {soNumber && <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>SO# {soNumber}</div>}
            {poAccount && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{poAccount}</div>}
            {poDeal && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>Deal: {poDeal}</div>}

            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {poStatus && (
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: poStatus === 'Delivered' ? '#e8f5e9' : poStatus === 'Cancelled' ? '#fce8e6' : '#e3f2fd',
                  color: statusColor, fontWeight: 600,
                }}>
                  {poStatus}
                </span>
              )}
              {signed && (
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: isSigned ? '#e8f5e9' : '#fff3e0',
                  color: isSigned ? '#2e7d32' : '#e65100',
                  fontWeight: 500,
                }}>
                  {isSigned ? '✓ Signed' : signed}
                </span>
              )}
              {poTotal && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>
                  ${Number(poTotal).toLocaleString()}
                </span>
              )}
            </div>

            {(tracking || vendorSo || estShip) && (
              <div style={{ marginTop: 6, padding: '6px 8px', background: '#f8f9fa', borderRadius: 6, fontSize: 11 }}>
                {vendorSo && <div style={{ color: COLORS.TEXT_PRIMARY }}>Vendor SO: <strong>{vendorSo}</strong></div>}
                {tracking && <div style={{ color: COLORS.TEXT_PRIMARY, marginTop: 2 }}>Tracking: <strong>{tracking}</strong></div>}
                {estShip && <div style={{ color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>Est. Ship: {estShip}</div>}
              </div>
            )}

            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      case 'Invoices': {
        const invSubject = getFieldValue(record.Subject) || 'Unnamed Invoice';
        const invNumber = getFieldValue(record.Invoice_Number);
        const invTotal = getFieldValue(record.Grand_Total);
        const invStatus = getFieldValue(record.Status);
        const invDue = getFieldValue(record.Due_Date);
        const invAccount = getFieldValue(record.Account_Name);
        const invDate = getFieldValue(record.Invoice_Date);

        const isOverdue = invStatus === 'Overdue' || (invDue && new Date(invDue) < new Date() && invStatus !== 'Paid');
        const statusColor = invStatus === 'Paid' ? '#2e7d32'
          : isOverdue ? '#d93025'
          : invStatus === 'Sent' ? '#1565c0'
          : '#5f6368';

        return (
          <a key={i} href={zohoUrl} target="_blank" rel="noopener"
            style={{
              display: 'block', background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8, textDecoration: 'none',
              cursor: 'pointer', transition: 'border-color 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = COLORS.STRATUS_BLUE}
            onMouseLeave={e => e.currentTarget.style.borderColor = COLORS.BORDER}
          >
            <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.STRATUS_BLUE }}>{invSubject}</div>
            {invNumber && <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>INV# {invNumber}</div>}
            {invAccount && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{invAccount}</div>}

            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              {invStatus && (
                <span style={{
                  fontSize: 11, padding: '2px 6px', borderRadius: 4,
                  background: invStatus === 'Paid' ? '#e8f5e9' : isOverdue ? '#fce8e6' : '#e3f2fd',
                  color: statusColor, fontWeight: 600,
                }}>
                  {isOverdue && invStatus !== 'Overdue' ? 'Overdue' : invStatus}
                </span>
              )}
              {invTotal && (
                <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>
                  ${Number(invTotal).toLocaleString()}
                </span>
              )}
            </div>

            {(invDue || invDate) && (
              <div style={{ marginTop: 4, fontSize: 11, color: COLORS.TEXT_SECONDARY }}>
                {invDate && <span>Issued: {invDate}</span>}
                {invDate && invDue && <span> · </span>}
                {invDue && <span style={{ color: isOverdue ? '#d93025' : 'inherit', fontWeight: isOverdue ? 600 : 400 }}>Due: {invDue}</span>}
              </div>
            )}

            <div style={{ fontSize: 10, color: COLORS.STRATUS_BLUE, marginTop: 4 }}>Open in Zoho →</div>
          </a>
        );
      }

      default:
        return null;
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Search Input */}
      <div style={{ marginBottom: 12 }}>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search Zoho CRM..."
          style={{
            width: '100%', padding: '10px 12px', border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, fontSize: 13, outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Module Selector */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {Object.entries(MODULE_MAP).map(([id, { label }]) => (
          <button
            key={id}
            onClick={() => { setModule(id); if (query) handleSearch(query, id); }}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${module === id ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
              background: module === id ? COLORS.STRATUS_LIGHT : 'transparent',
              color: module === id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
              fontSize: 11, fontWeight: module === id ? 600 : 400, cursor: 'pointer',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search Button */}
      <button
        onClick={() => handleSearch()}
        disabled={loading || !query.trim()}
        style={{
          width: '100%', padding: '10px', background: COLORS.STRATUS_BLUE,
          color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
          fontWeight: 600, cursor: 'pointer', opacity: loading || !query.trim() ? 0.7 : 1,
        }}
      >
        {loading ? 'Searching...' : 'Search'}
      </button>

      {/* Error */}
      {error && (
        <div style={{ padding: 12, background: '#fce8e6', borderRadius: 8, color: COLORS.ERROR, fontSize: 13, marginTop: 12 }}>
          {error}
        </div>
      )}

      {/* Results */}
      {results && (
        <div style={{ marginTop: 12 }}>
          {results.records && results.records.length > 0 && (
            <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>
              {results.records.length} result{results.records.length > 1 ? 's' : ''} in {MODULE_MAP[results.searchModule]?.label || results.searchModule}
            </div>
          )}

          {(!results.records || results.records.length === 0) ? (
            <div style={{
              textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20,
              background: COLORS.BG_PRIMARY, borderRadius: 8, border: `1px solid ${COLORS.BORDER}`,
            }}>
              <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
              <div style={{ fontSize: 13 }}>No results found for "{query}"</div>
              <div style={{ fontSize: 11, marginTop: 4 }}>Try a different search term or module</div>
            </div>
          ) : (
            results.records.map((record, i) => renderRecord(record, results.searchModule, i))
          )}
        </div>
      )}
    </div>
  );
}
