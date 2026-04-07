/**
 * Popup — Quick Actions
 *
 * Lightweight popup for quick access when not on Gmail.
 * On Gmail tabs, clicking the icon opens the side panel instead.
 */

import { useState, useEffect } from 'react';
import { sendToBackground } from '../lib/messaging';
import { MSG, COLORS } from '../lib/constants';

export default function QuickActions() {
  const [skuText, setSkuText] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [activeTab, setActiveTab] = useState('quote');

  useEffect(() => {
    sendToBackground(MSG.GET_AUTH_STATUS).then(setAuthStatus).catch(() => {});
  }, []);

  async function handleQuote() {
    if (!skuText.trim()) return;
    setLoading(true);
    try {
      const res = await sendToBackground(MSG.GENERATE_QUOTE, { skuText: skuText.trim() });
      setResult({ type: 'quote', data: res });
    } catch (err) {
      setResult({ type: 'error', data: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleSearch() {
    if (!searchQuery.trim()) return;
    setLoading(true);
    try {
      const res = await sendToBackground(MSG.CRM_SEARCH, { query: searchQuery.trim(), module: 'Accounts' });
      setResult({ type: 'search', data: res });
    } catch (err) {
      setResult({ type: 'error', data: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(text) {
    await navigator.clipboard.writeText(text);
  }

  if (authStatus && !authStatus.hasApiKey) {
    return (
      <div style={{ padding: 20, textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>🔑</div>
        <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12 }}>Set up your API key to get started.</p>
        <button onClick={() => chrome.runtime.openOptionsPage()} style={{
          padding: '8px 16px', background: COLORS.STRATUS_BLUE, color: 'white',
          border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer',
        }}>Open Settings</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 12 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ fontWeight: 700, fontSize: 15, color: COLORS.STRATUS_DARK }}>Stratus AI</div>
        <button onClick={() => chrome.runtime.openOptionsPage()} style={{
          background: 'none', border: 'none', cursor: 'pointer', fontSize: 14,
        }}>⚙️</button>
      </div>

      {/* Tab Toggle */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <TabBtn active={activeTab === 'quote'} onClick={() => { setActiveTab('quote'); setResult(null); }}>
          Quick Quote
        </TabBtn>
        <TabBtn active={activeTab === 'search'} onClick={() => { setActiveTab('search'); setResult(null); }}>
          CRM Search
        </TabBtn>
      </div>

      {/* Quick Quote */}
      {activeTab === 'quote' && (
        <>
          <textarea
            value={skuText}
            onChange={(e) => setSkuText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleQuote(); } }}
            placeholder="e.g., 10 MR44, 2 MX67"
            rows={3}
            style={{
              width: '100%', padding: '8px 10px', border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6, fontSize: 13, fontFamily: 'inherit', resize: 'none',
              outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button onClick={handleQuote} disabled={loading || !skuText.trim()} style={{
            width: '100%', padding: '8px', background: COLORS.STRATUS_BLUE, color: 'white',
            border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', marginTop: 8, opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Generating...' : 'Generate Quote'}
          </button>
        </>
      )}

      {/* CRM Search */}
      {activeTab === 'search' && (
        <>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
            placeholder="Search accounts, contacts, deals..."
            style={{
              width: '100%', padding: '8px 10px', border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
            }}
          />
          <button onClick={handleSearch} disabled={loading || !searchQuery.trim()} style={{
            width: '100%', padding: '8px', background: COLORS.STRATUS_BLUE, color: 'white',
            border: 'none', borderRadius: 6, fontSize: 13, fontWeight: 600,
            cursor: 'pointer', marginTop: 8, opacity: loading ? 0.7 : 1,
          }}>
            {loading ? 'Searching...' : 'Search CRM'}
          </button>
        </>
      )}

      {/* Results */}
      {result?.type === 'error' && (
        <div style={{ padding: 8, background: '#fce8e6', borderRadius: 6, color: COLORS.ERROR, fontSize: 12, marginTop: 8 }}>
          {result.data}
        </div>
      )}

      {result?.type === 'quote' && result.data?.quoteUrls && (
        <div style={{ marginTop: 8 }}>
          {result.data.quoteUrls.map((url, i) => (
            <div key={i} style={{
              background: COLORS.BG_SECONDARY, borderRadius: 6, padding: 8, marginBottom: 6,
              fontSize: 12,
            }}>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>{url.label || `Option ${i + 1}`}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => handleCopy(url.url || url)} style={{
                  flex: 1, padding: '4px 8px', background: COLORS.STRATUS_BLUE, color: 'white',
                  border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer',
                }}>Copy</button>
                <a href={url.url || url} target="_blank" rel="noopener" style={{
                  flex: 1, padding: '4px 8px', border: `1px solid ${COLORS.STRATUS_BLUE}`,
                  color: COLORS.STRATUS_BLUE, borderRadius: 4, fontSize: 11,
                  textDecoration: 'none', textAlign: 'center',
                }}>Open</a>
              </div>
            </div>
          ))}
        </div>
      )}

      {result?.type === 'search' && result.data?.records && (
        <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto' }}>
          {result.data.records.length === 0 ? (
            <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, fontSize: 12, padding: 12 }}>No results.</div>
          ) : result.data.records.map((r, i) => (
            <div key={i} style={{
              padding: 8, borderBottom: `1px solid ${COLORS.BORDER}`, fontSize: 12,
              display: 'flex', justifyContent: 'space-between',
            }}>
              <span style={{ fontWeight: 500 }}>{r.name || r.Account_Name || r.Deal_Name || 'Unnamed'}</span>
              {r.zohoUrl && <a href={r.zohoUrl} target="_blank" rel="noopener" style={{
                color: COLORS.STRATUS_BLUE, fontSize: 11,
              }}>Zoho →</a>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, padding: '6px 8px', borderRadius: 6, fontSize: 12, cursor: 'pointer',
      background: active ? COLORS.STRATUS_LIGHT : 'transparent',
      border: `1px solid ${active ? COLORS.STRATUS_BLUE : COLORS.BORDER}`,
      color: active ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
      fontWeight: active ? 600 : 400,
    }}>{children}</button>
  );
}
