/**
 * Search Panel
 * Search Zoho CRM across modules.
 */

import { useState, useEffect, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

const MODULES = [
  { id: 'Accounts', label: 'Accounts' },
  { id: 'Contacts', label: 'Contacts' },
  { id: 'Deals', label: 'Deals' },
  { id: 'Quotes', label: 'Quotes' },
];

export default function SearchPanel({ navData }) {
  const [query, setQuery] = useState('');
  const [module, setModule] = useState('Accounts');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // Pre-fill from navData
  useEffect(() => {
    if (navData?.query) {
      setQuery(navData.query);
      handleSearch(navData.query, module);
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
      setResults(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter') handleSearch();
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
        {MODULES.map((m) => (
          <button
            key={m.id}
            onClick={() => { setModule(m.id); if (query) handleSearch(query, m.id); }}
            style={{
              flex: 1, padding: '6px 8px', borderRadius: 6,
              border: `1px solid ${module === m.id ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
              background: module === m.id ? COLORS.STRATUS_LIGHT : 'transparent',
              color: module === m.id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
              fontSize: 11, fontWeight: module === m.id ? 600 : 400, cursor: 'pointer',
            }}
          >
            {m.label}
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
          {(!results.records || results.records.length === 0) ? (
            <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20 }}>
              No results found.
            </div>
          ) : (
            results.records.map((record, i) => (
              <div key={i} style={{
                background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
                borderRadius: 8, padding: 12, marginBottom: 8,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.TEXT_PRIMARY }}>
                      {record.name || record.Account_Name || record.Deal_Name || record.Subject || record.Full_Name || 'Unnamed'}
                    </div>
                    {record.email && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{record.email}</div>}
                    {record.stage && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Stage: {record.stage}</div>}
                    {record.amount && (
                      <div style={{ fontSize: 12, color: COLORS.SUCCESS, fontWeight: 600 }}>
                        ${Number(record.amount).toLocaleString()}
                      </div>
                    )}
                  </div>
                  {record.zohoUrl && (
                    <a href={record.zohoUrl} target="_blank" rel="noopener" style={{
                      color: COLORS.STRATUS_BLUE, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
                    }}>Zoho →</a>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
