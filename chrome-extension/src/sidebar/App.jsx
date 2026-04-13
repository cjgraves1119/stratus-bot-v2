/**
 * Stratus AI Chrome Extension — Sidebar App
 *
 * Main sidebar application with tabbed navigation.
 * Panels: Email (with Draft), CRM (with Info/Deals/Tasks), Quote, Chat, Search
 */

import { useState, useEffect, useCallback, lazy, Suspense, Component } from 'react';
import { sendToBackground, onMessage } from '../lib/messaging';
import { MSG, COLORS } from '../lib/constants';

// Eager load the default panel; lazy load the rest for faster initial render
import EmailPanel from './panels/EmailPanel';
const CrmPanel = lazy(() => import('./panels/CrmPanel'));
const QuotePanel = lazy(() => import('./panels/QuotePanel'));
const ChatPanel = lazy(() => import('./panels/ChatPanel'));
const SearchPanel = lazy(() => import('./panels/SearchPanel'));

function PanelLoader() {
  return (
    <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
      Loading...
    </div>
  );
}

// Error boundary to catch runtime errors in lazy-loaded panels
class PanelErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[Stratus AI] Panel error:', error, info);
  }
  componentDidUpdate(prevProps) {
    if (prevProps.activeTab !== this.props.activeTab && this.state.hasError) {
      this.setState({ hasError: false, error: null });
    }
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>⚠️</div>
          <p style={{ color: COLORS.ERROR, fontSize: 13, marginBottom: 8 }}>
            Something went wrong loading this panel.
          </p>
          <p style={{ color: COLORS.TEXT_SECONDARY, fontSize: 12, marginBottom: 16 }}>
            {this.state.error?.message || 'Unknown error'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '8px 16px', background: COLORS.STRATUS_BLUE, color: 'white',
              border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const TABS = [
  { id: 'crm', label: 'Zoho', icon: '🏢' },
  { id: 'email', label: 'Email', icon: '📧' },
  { id: 'quote', label: 'Quote', icon: '📋' },
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'search', label: 'Search', icon: '🔍' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('crm');
  const [emailContext, setEmailContext] = useState(null);
  const [crmContext, setCrmContext] = useState(null);
  const [navData, setNavData] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  // Lift chat state here so it persists when switching tabs
  const [chatMessages, setChatMessages] = useState([]);

  const [pageType, setPageType] = useState(null); // 'gmail' | 'zoho' | 'other'
  const [zohoPageContext, setZohoPageContext] = useState(null);

  // Detect page context first, then load appropriate data
  useEffect(() => {
    sendToBackground(MSG.GET_AUTH_STATUS).then(setAuthStatus).catch(() => {});

    // Ask background what page we're on
    sendToBackground(MSG.GET_PAGE_CONTEXT).then((ctx) => {
      const type = ctx?.pageType || 'other';
      setPageType(type);

      if (type === 'gmail') {
        // On Gmail: load email context with retries, default to CRM tab
        setActiveTab('crm');
        loadEmailContextWithRetry();
        sendToBackground(MSG.GET_CRM_CONTEXT).then((c) => {
          if (c && !c.empty) setCrmContext(c);
        }).catch(() => {});
      } else if (type === 'zoho') {
        // On Zoho: load Zoho record context, default to CRM tab
        setActiveTab('crm');
        if (ctx?.zohoContext) {
          setZohoPageContext(ctx.zohoContext);
          // If we have a record, trigger a CRM lookup
          triggerZohoRecordLookup(ctx.zohoContext);
        }
      } else {
        // On any other page: default to Search tab
        setActiveTab('search');
      }
    }).catch(() => {
      // Fallback: default to search
      setPageType('other');
      setActiveTab('search');
    });
  }, []);

  function loadEmailContextWithRetry() {
    let retryCount = 0;
    const maxRetries = 5;
    const retryDelay = 800;

    function fetchEmailContext() {
      sendToBackground(MSG.GET_EMAIL_CONTEXT).then((ctx) => {
        if (ctx && !ctx.empty) {
          setEmailContext(ctx);
        } else if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(fetchEmailContext, retryDelay);
        }
      }).catch(() => {
        if (retryCount < maxRetries) {
          retryCount++;
          setTimeout(fetchEmailContext, retryDelay);
        }
      });
    }

    fetchEmailContext();
  }

  /**
   * When on a Zoho record page, trigger the CRM lookup using the record's
   * email, account name, or domain so the CRM panel shows relevant data.
   */
  function triggerZohoRecordLookup(zohoCtx) {
    if (!zohoCtx || zohoCtx.page !== 'record') return;

    const { module, recordId, recordName, email, accountName, website } = zohoCtx;

    // For contacts with email, do a contact lookup
    if (module === 'Contacts' && email) {
      sendToBackground(MSG.CRM_LOOKUP, { email, domain: email.split('@')[1] }).then((result) => {
        if (result && result.found) setCrmContext(result);
      }).catch(() => {});
      return;
    }

    // For accounts, search by account name or website domain
    if (module === 'Accounts') {
      const searchTerm = recordName || accountName;
      if (searchTerm) {
        sendToBackground(MSG.CRM_ACCOUNT_SEARCH, { query: searchTerm, domain: website }).then((result) => {
          if (result && result.found) setCrmContext(result);
        }).catch(() => {});
      }
      return;
    }

    // For deals, quotes, etc. — try account name or email
    if (accountName) {
      sendToBackground(MSG.CRM_ACCOUNT_SEARCH, { query: accountName }).then((result) => {
        if (result && result.found) setCrmContext(result);
      }).catch(() => {});
    } else if (email) {
      sendToBackground(MSG.CRM_LOOKUP, { email, domain: email.split('@')[1] }).then((result) => {
        if (result && result.found) setCrmContext(result);
      }).catch(() => {});
    }
  }

  // Listen for email changes from content script
  useEffect(() => {
    return onMessage(MSG.EMAIL_CHANGED, (data) => {
      setEmailContext(data);
      setCrmContext(null);
    });
  }, []);

  // Listen for Zoho page navigation (record changes within Zoho SPA)
  useEffect(() => {
    return onMessage(MSG.ZOHO_CONTEXT_CHANGED, (data) => {
      setZohoPageContext(data);
      setPageType('zoho');
      setCrmContext(null); // Reset so CRM panel re-fetches

      if (data?.page === 'record') {
        setActiveTab('crm');
        triggerZohoRecordLookup(data);
      }
    });
  }, []);

  // Listen for navigation requests
  useEffect(() => {
    return onMessage(MSG.SIDEBAR_NAVIGATE, (data) => {
      if (data.panel) {
        // Map legacy 'tasks'/'draft' routes to new locations
        const panelMap = { tasks: 'crm', draft: 'email' };
        const targetPanel = panelMap[data.panel] || data.panel;
        setActiveTab(targetPanel);
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

  const handleNavigate = useCallback((panel, data) => {
    const panelMap = { tasks: 'crm', draft: 'email' };
    const targetPanel = panelMap[panel] || panel;
    setActiveTab(targetPanel);
    setNavData(data || null);
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
        <PanelErrorBoundary activeTab={activeTab}>
          <Suspense fallback={<PanelLoader />}>
            {activeTab === 'email' && <EmailPanel emailContext={emailContext} navData={navData} />}
            {activeTab === 'crm' && <CrmPanel emailContext={emailContext} crmContext={crmContext} onNavigate={handleNavigate} navData={navData} />}
            {activeTab === 'quote' && <QuotePanel navData={navData} emailContext={emailContext} onNavigate={handleNavigate} />}
            {activeTab === 'chat' && <ChatPanel emailContext={emailContext} navData={navData} messages={chatMessages} onMessagesChange={setChatMessages} />}
            {activeTab === 'search' && <SearchPanel navData={navData} />}
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </div>
  );
}
