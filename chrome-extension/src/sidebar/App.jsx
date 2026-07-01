/**
 * Stratus AI Chrome Extension — Sidebar App
 *
 * Main sidebar application with tabbed navigation.
 * Panels: CRM/Zoho, Chat (quoting + email reply/analyze), Search.
 * (Email and Quote tabs were folded into Chat on 2026-06-17.)
 */

import { useState, useEffect, useCallback, lazy, Suspense, Component } from 'react';
import { sendToBackground, onMessage } from '../lib/messaging';
import { MSG, COLORS, IS_DEV_BUILD, API_BASE } from '../lib/constants';
import {
  parseZohoRecordUrl,
  contextMatchesUrl,
  minimalContextFromUrl,
} from '../lib/zoho-url.js';

// Lazy load panels for faster initial render
const CrmPanel = lazy(() => import('./panels/CrmPanel'));
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
  { id: 'chat', label: 'Chat', icon: '💬' },
  { id: 'search', label: 'Search', icon: '🔍' },
];

// Valid panel ids — guards deep-link navigations that may still target a
// now-removed tab (Email/Quote were folded into Chat 2026-06-17).
const VALID_PANELS = new Set(TABS.map((t) => t.id));

// Per-tab storage key prefix — must match the background service worker.
// The Zoho content script's context is keyed by the tab it lives in so that
// reading "the Zoho context for the active tab" never picks up a different
// tab's record.
const ZOHO_CTX_KEY_PREFIX = 'zohoCtx_';
const zohoCtxKey = (tabId) => `${ZOHO_CTX_KEY_PREFIX}${tabId}`;

/**
 * Read the per-tab Zoho context for the active tab directly from
 * chrome.storage.session. Returns the raw stored value (or null) — caller
 * is responsible for validating it against the active URL via
 * `contextMatchesUrl` before trusting it.
 */
async function readActiveTabZohoCtx(activeTabId) {
  if (activeTabId == null) return null;
  try {
    const key = zohoCtxKey(activeTabId);
    const stored = await chrome.storage.session.get(key);
    if (stored && stored[key]) return stored[key];
  } catch (_) { /* ignore */ }
  return null;
}

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

  // Detect page context first, then load appropriate data.
  //
  // Two-path strategy (MV3-safe):
  //   1. sendToBackground(GET_PAGE_CONTEXT) — fast if service worker is alive.
  //   2. If that fails or returns no zohoContext, read chrome.storage.session
  //      directly under the per-tab key zohoCtx_<activeTabId>.
  //
  // The background is now the single writer to storage and uses per-tab keys
  // so that the sidebar's active-tab read path can never see a different
  // tab's record (cross-tab bleed fix, Wave B 2026-06-03).
  useEffect(() => {
    sendToBackground(MSG.GET_AUTH_STATUS).then(setAuthStatus).catch(() => {});

    async function initPageContext() {
      // Single source of truth: the currently active tab URL.
      // Parse it first so every downstream decision uses the same anchor.
      let activeUrl = '';
      let activeTabId = null;
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeUrl = activeTab?.url || '';
        activeTabId = activeTab?.id ?? null;
      } catch (err) {
        console.warn('[Stratus App] chrome.tabs.query failed:', err?.message);
      }
      const urlInfo = parseZohoRecordUrl(activeUrl);
      let type = 'other';
      if (activeUrl.startsWith('https://mail.google.com/')) type = 'gmail';
      else if (urlInfo?.isZoho) type = 'zoho';

      let zohoCtx = null;

      if (urlInfo?.isZoho) {
        // Path 1: ask the background worker. It already runs the same URL
        // validation and returns cached context only when it matches, or a
        // minimal URL-derived context otherwise.
        try {
          const ctx = await sendToBackground(MSG.GET_PAGE_CONTEXT);
          if (ctx?.zohoContext && contextMatchesUrl(ctx.zohoContext, urlInfo)) {
            zohoCtx = ctx.zohoContext;
          }
        } catch (err) {
          console.warn('[Stratus App] GET_PAGE_CONTEXT via background failed:', err?.message);
        }

        // Path 2: direct storage read (fallback when the service worker
        // response came back null). Same validation — we only trust the
        // stored value if module + recordId match the active tab URL.
        if (!zohoCtx) {
          const stored = await readActiveTabZohoCtx(activeTabId);
          if (contextMatchesUrl(stored, urlInfo)) {
            zohoCtx = stored;
            console.log('[Stratus App] Zoho context recovered from per-tab storage:', zohoCtx);
          }
        }

        // Path 3: still nothing that matches the active URL — fall back to a
        // URL-derived minimal context so the header pill at least shows the
        // correct record id while DOM enrichment is still loading.
        if (!zohoCtx && urlInfo.isRecord) {
          zohoCtx = minimalContextFromUrl(urlInfo);
        }
      }

      setPageType(type);

      if (type === 'gmail') {
        setActiveTab('crm');
        loadEmailContextWithRetry();
        sendToBackground(MSG.GET_CRM_CONTEXT).then((c) => {
          if (c && !c.empty) setCrmContext(c);
        }).catch(() => {});
      } else if (type === 'zoho') {
        setActiveTab('crm');
        if (zohoCtx) {
          setZohoPageContext(zohoCtx);
          triggerZohoRecordLookup(zohoCtx);
        }
      } else {
        setActiveTab('search');
      }
    }

    initPageContext();
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
      setNavData(null);
    });
  }, []);

  // Listen for Zoho page navigation (record changes within Zoho SPA).
  // The content script publishes a minimal URL-derived context on nav and
  // then enriches it; both passes come through here.
  //
  // CRITICAL: content scripts run in EVERY Zoho tab, so a background tab
  // that the user is not currently looking at can also fire this message
  // (storage update from another tab → background → fanout). Without
  // validation, the header/chat would briefly flip to the inactive tab's
  // record until the 2s active-URL poll corrected it. To prevent that,
  // we validate the incoming context against the ACTIVE tab URL here too.
  useEffect(() => {
    return onMessage(MSG.ZOHO_CONTEXT_CHANGED, async (data) => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeUrl = activeTab?.url || '';
        const urlInfo = parseZohoRecordUrl(activeUrl);

        // Active tab is not Zoho at all — ignore. Header/chat should be
        // cleared by the polling effect / page-type listener anyway.
        if (!urlInfo?.isZoho) {
          return;
        }

        // Active tab is Zoho but on a list/dashboard (no record) — clear
        // the primary record context. A record-page message from an
        // inactive tab must not appear as "the record I'm viewing".
        if (!urlInfo.isRecord) {
          setZohoPageContext(null);
          setPageType('zoho');
          setCrmContext(null);
          return;
        }

        // Active tab IS a record page. Only accept the incoming context
        // when it describes that same record.
        if (!contextMatchesUrl(data, urlInfo)) {
          // Inactive-tab update — drop it. The poll effect re-derives
          // primary context from the active URL on its own cadence.
          return;
        }

        setZohoPageContext(data);
        setPageType('zoho');
        setCrmContext(null); // Reset so CRM panel re-fetches

        if (data?.page === 'record') {
          setActiveTab('crm');
          triggerZohoRecordLookup(data);
        }
      } catch (err) {
        // tabs.query can fail in odd MV3 states. On error, conservatively
        // ignore the message rather than risk applying a stale record.
        console.warn('[Stratus App] ZOHO_CONTEXT_CHANGED validation failed:', err?.message);
      }
    });
  }, []);

  // Active-URL-synced polling for the Zoho context. The MV3 service worker
  // sleeps after ~30s idle and the ZOHO_CONTEXT_CHANGED message won't wake
  // the sidebar if the user has it pinned open. This loop re-derives the
  // active-page context every 2s directly from the active tab URL and
  // the per-tab session storage entry (zohoCtx_<activeTabId>), discarding
  // any stale value whose module/recordId don't match the current URL.
  // This is the single source of truth fed into both the header pill and
  // the ChatPanel via props.
  //
  // Now that ZOHO_CONTEXT_CHANGED actually fires (EXT-CRIT-1 fix), this
  // polling is more of a belt-and-suspenders safety net than the primary
  // update path it used to be.
  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        const activeUrl = activeTab?.url || '';
        const activeTabId = activeTab?.id ?? null;
        const urlInfo = parseZohoRecordUrl(activeUrl);

        if (!urlInfo?.isZoho) {
          // User is off Zoho entirely — clear the header pill.
          if (!cancelled) setZohoPageContext((prev) => (prev ? null : prev));
          return;
        }
        if (!urlInfo.isRecord) {
          // List view / dashboard: no active record.
          if (!cancelled) setZohoPageContext((prev) => (prev ? null : prev));
          return;
        }

        // Prefer per-tab stored context iff it matches active URL; else
        // synthesize from the URL. Per-tab keying guarantees we cannot
        // accidentally pick up a different tab's record here.
        let next = null;
        const stored = await readActiveTabZohoCtx(activeTabId);
        if (contextMatchesUrl(stored, urlInfo)) {
          next = stored;
        }
        if (!next) next = minimalContextFromUrl(urlInfo);

        if (cancelled) return;
        setZohoPageContext((prev) => {
          // Avoid unnecessary re-renders — only replace when id/module/recordName change.
          if (prev
            && prev.recordId === next.recordId
            && prev.module === next.module
            && (prev.recordName || null) === (next.recordName || null)) {
            return prev;
          }
          return next;
        });
      } catch (_) { /* ignore */ }
    }

    refresh();
    const interval = setInterval(refresh, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // Listen for navigation requests
  useEffect(() => {
    return onMessage(MSG.SIDEBAR_NAVIGATE, (data) => {
      if (data.panel) {
        // Email/Quote/Draft now live in Chat; Tasks/Zoho in the CRM panel.
        // Unknown/removed ids fall back to CRM so a stale deep-link never
        // lands on a blank pane.
        const panelMap = { tasks: 'crm', draft: 'chat', email: 'chat', quote: 'chat', zoho: 'crm' };
        const mapped = panelMap[data.panel] || data.panel;
        const targetPanel = VALID_PANELS.has(mapped) ? mapped : 'crm';
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
    const panelMap = { tasks: 'crm', draft: 'chat', email: 'chat', quote: 'chat', zoho: 'crm' };
    const mapped = panelMap[panel] || panel;
    const targetPanel = VALID_PANELS.has(mapped) ? mapped : 'crm';
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

  // Derive a short label for the blue pill from the active Zoho page context
  const zohoModuleLabel = zohoPageContext?.module
    ? ({ Quotes: 'Quote', Potentials: 'Deal', Deals: 'Deal', Accounts: 'Account',
         Contacts: 'Contact', Tasks: 'Task', SalesOrders: 'Sales Order',
         Invoices: 'Invoice' })[zohoPageContext.module] || zohoPageContext.module
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: COLORS.BG_SECONDARY }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', padding: '10px 16px',
        background: IS_DEV_BUILD ? COLORS.DEV_HEADER : COLORS.STRATUS_DARK, color: 'white',
        flexWrap: 'wrap', gap: 6,
      }}>
        <div
          style={{ fontWeight: 700, fontSize: 15, flex: 1 }}
          title={IS_DEV_BUILD ? 'DEV build → ' + API_BASE : undefined}
        >
          Stratus AI{IS_DEV_BUILD ? ' · DEV' : ''}
        </div>

        {/* Blue pill — shows current Zoho record across ALL tabs, always visible */}
        {zohoPageContext?.recordId && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: '#1a73e8cc', border: '1px solid #4fa3f780',
            borderRadius: 12, padding: '2px 8px',
            fontSize: 10, fontWeight: 600, color: 'white',
            maxWidth: 160, overflow: 'hidden',
            title: `${zohoModuleLabel} ${zohoPageContext.recordId}`,
          }}>
            <span>📄</span>
            <span style={{
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {zohoModuleLabel}{zohoPageContext.recordName ? ': ' + zohoPageContext.recordName : ' ' + zohoPageContext.recordId}
            </span>
          </div>
        )}

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
            {activeTab === 'crm' && <CrmPanel emailContext={emailContext} crmContext={crmContext} onNavigate={handleNavigate} navData={navData} />}
            {activeTab === 'chat' && <ChatPanel emailContext={emailContext} navData={navData} messages={chatMessages} onMessagesChange={setChatMessages} zohoPageContext={zohoPageContext} />}
            {activeTab === 'search' && <SearchPanel navData={navData} />}
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </div>
  );
}
