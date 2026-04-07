/**
 * Stratus AI Chrome Extension — Sidebar App
 *
 * Main sidebar application with tabbed navigation.
 * Panels: Email Analysis, CRM, Quotes, Tasks, Drafts, Search
 */

import { useState, useEffect, useCallback, lazy, Suspense } from 'react';
import { sendToBackground, onMessage } from '../lib/messaging';
import { MSG, COLORS } from '../lib/constants';

// Eager load the default panel; lazy load the rest for faster initial render
import EmailPanel from './panels/EmailPanel';
const CrmPanel = lazy(() => import('./panels/CrmPanel'));
const QuotePanel = lazy(() => import('./panels/QuotePanel'));
const TaskPanel = lazy(() => import('./panels/TaskPanel'));
const DraftPanel = lazy(() => import('./panels/DraftPanel'));
const ChatPanel = lazy(() => import('./panels/ChatPanel'));
const SearchPanel = lazy(() => import('./panels/SearchPanel'));

function PanelLoader() {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
      Loading...
    </div>
  );
}

const TABS = [
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'crm', label: 'CRM', icon: '🏢' },
  { id: 'quote', label: 'Quote', icon: '📋' },
  { id: 'tasks', label: 'Tasks', icon: '✅' },
  { id: 'draft', label: 'Draft', icon: '✏️' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'search', label: 'Search', icon: '🔍' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('email');
  const [emailContext, setEmailContext] = useState(null);
  const [crmContext, setCrmContext] = useState(null);
  const [navData, setNavData] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);

  // Load initial state
  useEffect(() => {
    sendToBackground(MSG.GET_EMAIL_CONTEXT).then((ctx) => {
      if (ctx && !ctx.empty) setEmailContext(ctx);
    }).catch(() => {});

    sendToBackground(MSG.GET_CRM_CONTEXT).then((ctx) => {
      if (ctx && !ctx.empty) setCrmContext(ctx);
    }).catch(() => {});

    sendToBackground(MSG.GET_AUTH_STATUS).then(setAuthStatus).catch(() => {});
  }, []);

  // Listen for email changes from content script
  useEffect(() => {
    return onMessage(MSG.EMAIL_CHANGED, (data) => {
      setEmailContext(data);
      setCrmContext(null);
    });
  }, []);

  // Listen for navigation requests (from keyboard shortcuts, context menus, etc.)
  useEffect(() => {
    return onMessage(MSG.SIDEBAR_NAVIGATE, (data) => {
      if (data.panel) {
        setActiveTab(data.panel);
        if (data.data) setNavData(data.data);
        if (data.action) setNavData(prev => ({ ...prev, action: data.action }));
      }
    });
  }, []);

  // Listen for CRM data
  useEffect(() => {
    return onMessage(MSG.CRM_DATA_READY, (data) => {
      setCrmContext(data.data);
    });
  }, []);

  const handleTabChange = useCallback((tabId) => {
    setActiveTab(tabId);
    setNavData(null);
  }, []);

  // Auth check
  if (authStatus && !authStatus.hasApiKey) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>🔑</div>
        <h2 style={{ fontSize: 18, marginBottom: 12, color: COLORS.TEXT_PRIMARY }}>
          Welcome to Stratus AI
        </h2>
        <p style={{ color: COLORS.TEXT_SECONDARY, marginBottom: 20, lineHeight: 1.5 }}>
          Set up your API key and Zoho CRM connection to get started.
        </p>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          style={{
            background: COLORS.STRATUS_BLUE, color: 'white', border: 'none',
            borderRadius: 8, padding: '10px 24px', fontSize: 14, fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Open Settings
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.BG_SECONDARY }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 16px',
        background: COLORS.STRATUS_DARK, color: 'white',
      }}>
        <div style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>Stratus AI</div>
        <button
          onClick={() => chrome.runtime.openOptionsPage()}
          style={{
            background: 'none', border: 'none', color: 'white', cursor: 'pointer',
            fontSize: 18, opacity: 0.7, padding: 4,
          }}
          title="Settings"
        >
          ⚙️
        </button>
      </div>

      {/* Tab Bar */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${COLORS.BORDER}`,
        background: COLORS.BG_PRIMARY, overflowX: 'auto',
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleTabChange(tab.id)}
            style={{
              flex: 1, padding: '8px 4px', border: 'none', cursor: 'pointer',
              background: activeTab === tab.id ? COLORS.STRATUS_LIGHT : 'transparent',
              borderBottom: activeTab === tab.id ? `2px solid ${COLORS.STRATUS_BLUE}` : '2px solid transparent',
              color: activeTab === tab.id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
              fontSize: 11, fontWeight: activeTab === tab.id ? 600 : 400,
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
              transition: 'all 0.15s ease',
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 16 }}>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Panel Content */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        <Suspense fallback={<PanelLoader />}>
          {activeTab === 'email' && <EmailPanel emailContext={emailContext} navData={navData} />}
          {activeTab === 'crm' && <CrmPanel emailContext={emailContext} crmContext={crmContext} />}
          {activeTab === 'quote' && <QuotePanel navData={navData} />}
          {activeTab === 'tasks' && <TaskPanel emailContext={emailContext} crmContext={crmContext} />}
          {activeTab === 'draft' && <DraftPanel emailContext={emailContext} />}
          {activeTab === 'chat' && <ChatPanel emailContext={emailContext} />}
          {activeTab === 'search' && <SearchPanel navData={navData} />}
        </Suspense>
      </div>
    </div>
  );
}
