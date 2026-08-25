/**
 * Stratus AI Chrome Extension — Sidebar App
 *
 * Main sidebar application with tabbed navigation.
 * Panels: CRM/Zoho, Chat (quoting + email reply/analyze), Search.
 * (Email and Quote tabs were folded into Chat on 2026-06-17.)
 */

import { useState, useEffect, useCallback, useRef, lazy, Suspense, Component } from 'react';
import { sendToBackground, onMessage } from '../lib/messaging';
import { MSG, COLORS, IS_DEV_BUILD, API_BASE } from '../lib/constants';
import { installErrorCapture, getRecentErrors } from '../lib/errorBuffer';
import {
  parseZohoRecordUrl,
  contextMatchesUrl,
  minimalContextFromUrl,
} from '../lib/zoho-url.js';
import {
  CHAT_SESSION_STORAGE_KEY,
  contextLockLabel,
  contextLockReportMetadata,
  createContextLock,
  createEmptyChatSession,
  isLockSourceAvailable,
  normalizeStoredChatSession,
  serializeChatSession,
} from '../lib/context-lock.mjs';
import { PENDING_SIDEBAR_ACTIONS_KEY } from '../lib/pending-sidebar-action.mjs';

// Lazy load panels for faster initial render
const CrmPanel = lazy(() => import('./panels/CrmPanel'));
const ChatPanel = lazy(() => import('./panels/ChatPanel'));
const SearchPanel = lazy(() => import('./panels/SearchPanel'));
const QuoteLineEditor = lazy(() => import('./components/QuoteLineEditor'));

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

// Only meaningful on a Zoho Quote record, so it is appended to TABS rather than
// living in it: on Gmail or a Deal page there is nothing for it to edit.
const QUOTE_LINES_TAB = { id: 'quote-lines', label: 'Lines', icon: '📊' };

// Valid panel ids — guards deep-link navigations that may still target a
// now-removed tab (Email/Quote were folded into Chat 2026-06-17).
const VALID_PANELS = new Set([...TABS.map((t) => t.id), QUOTE_LINES_TAB.id]);

/**
 * The Quote Line Editor, wired to the background service worker.
 *
 * Shared by BOTH surfaces: the side panel's "Lines" tab renders it inline, and
 * sidebar.html?view=quote-lines renders it standalone inside the iframe overlay
 * that zoho-content.js pins onto the Zoho page. One component, one code path,
 * so the overlay can never drift from the panel.
 */
export function QuoteLinesView({ recordId, module = 'Quotes', onClose }) {
  const load = useCallback(
    (id, mod) => sendToBackground(MSG.GET_QUOTE_LINES, { recordId: id, module: mod }),
    [],
  );
  const commit = useCallback(
    (payload) => sendToBackground(MSG.COMMIT_QUOTE_LINE_OPS, payload),
    [],
  );
  const loadCosts = useCallback(
    (id, mod) => sendToBackground(MSG.GET_QUOTE_LINE_COSTS, { recordId: id, module: mod }),
    [],
  );
  const previewCloneTerms = useCallback(
    (id, terms) => sendToBackground(MSG.PREVIEW_QUOTE_CLONE_TERMS, { recordId: id, terms }),
    [],
  );
  const cloneTerms = useCallback(
    (payload) => sendToBackground(MSG.CLONE_QUOTE_TERMS, payload),
    [],
  );
  const matchEcomm = useCallback(
    (id, mod) => sendToBackground(MSG.MATCH_QUOTE_LINES_TO_ECOMM, { recordId: id, module: mod }),
    [],
  );
  if (!recordId) {
    return (
      <div style={{ padding: 16, fontSize: 12, color: COLORS.TEXT_SECONDARY }}>
        Open a Zoho Quote record to edit its line items.
      </div>
    );
  }
  return (
    <Suspense fallback={<PanelLoader />}>
      <QuoteLineEditor
        recordId={recordId}
        module={module}
        onLoad={load}
        onCommit={commit}
        onMatchEcomm={matchEcomm}
        onLoadCosts={loadCosts}
        onPreviewCloneTerms={previewCloneTerms}
        onCloneTerms={cloneTerms}
        onClose={onClose}
      />
    </Suspense>
  );
}

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
  // Lift conversation state here so it persists when switching tabs. The
  // Zoho record pin must survive ChatPanel's conditional unmount when an SPA
  // navigation auto-switches the sidebar to the CRM tab.
  const [chatMessages, setChatMessages] = useState([]);
  const [chatAutoPinnedRecord, setChatAutoPinnedRecord] = useState(null);
  const [chatManualPinnedRecord, setChatManualPinnedRecord] = useState(null);
  const [chatContextLock, setChatContextLock] = useState(null);
  const [chatSessionId, setChatSessionId] = useState(null);
  const [chatSessionHydrated, setChatSessionHydrated] = useState(false);
  const lastPersistedChatRef = useRef('');
  const lastObservedActiveTabRef = useRef('');
  const pendingActionClaimStateRef = useRef({ running: false, rerun: false });
  const acceptedPendingActionIdsRef = useRef(new Set());

  const claimPendingSidebarAction = useCallback(async () => {
    const state = pendingActionClaimStateRef.current;
    if (state.running) {
      state.rerun = true;
      return;
    }
    state.running = true;
    try {
      do {
        state.rerun = false;
        let active;
        try {
          [active] = await chrome.tabs.query({ active: true, currentWindow: true });
        } catch (_) {
          active = null;
        }
        if (!active?.id || !Number.isInteger(active.windowId)) continue;
        let claim = null;
        try {
          const response = await sendToBackground(MSG.SIDEBAR_ACTION_CLAIM, {
            tabId: active.id,
            windowId: active.windowId,
          });
          claim = response?.claim || null;
        } catch (_) { /* the next storage/wake event retries */ }
        const action = claim?.action;
        if (!action?.actionId || action.type !== 'quote-selection' || !action.quoteSkuText) continue;

        if (!acceptedPendingActionIdsRef.current.has(action.actionId)) {
          acceptedPendingActionIdsRef.current.add(action.actionId);
          setActiveTab('chat');
          setNavData({
            quoteSkuText: action.quoteSkuText,
            quoteActionId: action.actionId,
            quoteContext: action.gmailContext || null,
          });
        }
        try {
          await sendToBackground(MSG.SIDEBAR_ACTION_ACK, {
            actionId: action.actionId,
            claimId: claim.claimId,
          });
        } catch (_) { /* the lease expires; the in-document id guard prevents duplicates */ }
      } while (state.rerun);
    } finally {
      state.running = false;
    }
  }, []);

  // A context-menu click may open a brand-new side-panel document. Claim once
  // on mount, again when durable storage changes, and on the optional runtime
  // wake-up. Hydrate the saved session first: otherwise a fast right-click
  // quote can append its fresh, actionable card and then be overwritten by an
  // inert restored card when storage.session resolves.
  useEffect(() => {
    if (!chatSessionHydrated) return undefined;
    let cancelled = false;
    const requestClaim = () => { if (!cancelled) claimPendingSidebarAction(); };
    requestClaim();
    const stopWakeListener = onMessage(MSG.SIDEBAR_ACTION_AVAILABLE, requestClaim);
    const onStorageChanged = (changes, areaName) => {
      if (areaName === 'session' && changes[PENDING_SIDEBAR_ACTIONS_KEY]) requestClaim();
    };
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      cancelled = true;
      stopWakeListener();
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, [claimPendingSidebarAction, chatSessionHydrated]);

  // An empty thread is a new conversation, so its record snapshot must not
  // leak into the next first message.
  useEffect(() => {
    if (!chatMessages || chatMessages.length === 0) {
      setChatAutoPinnedRecord(null);
    }
  }, [chatMessages && chatMessages.length]);

  // Restore one browser-session-scoped chat across side-panel document
  // recreation, tab switches, and extension reloads. chrome.storage.session is
  // memory-backed and clears on browser shutdown; it is intentionally not
  // storage.local because a Gmail lock can contain bounded thread text.
  useEffect(() => {
    let cancelled = false;
    async function hydrate() {
      let restored = null;
      try {
        const stored = await chrome.storage.session.get(CHAT_SESSION_STORAGE_KEY);
        restored = normalizeStoredChatSession(stored?.[CHAT_SESSION_STORAGE_KEY]);
      } catch (_) { /* use a fresh session */ }
      if (cancelled) return;
      const session = restored || createEmptyChatSession();
      lastPersistedChatRef.current = JSON.stringify(session);
      setChatSessionId(session.sessionId);
      setChatMessages(session.messages || []);
      setChatAutoPinnedRecord(session.autoPinnedRecord || null);
      setChatManualPinnedRecord(session.manualPinnedRecord || null);
      setChatContextLock(session.contextLock || null);
      setChatSessionHydrated(true);
    }

    const onStorageChanged = (changes, areaName) => {
      if (areaName !== 'session' || !changes[CHAT_SESSION_STORAGE_KEY]?.newValue) return;
      const session = normalizeStoredChatSession(changes[CHAT_SESSION_STORAGE_KEY].newValue);
      if (!session) return;
      const serialized = JSON.stringify(session);
      if (serialized === lastPersistedChatRef.current) return;
      lastPersistedChatRef.current = serialized;
      setChatSessionId(session.sessionId);
      setChatMessages(session.messages || []);
      setChatAutoPinnedRecord(session.autoPinnedRecord || null);
      setChatManualPinnedRecord(session.manualPinnedRecord || null);
      setChatContextLock(session.contextLock || null);
      setChatSessionHydrated(true);
    };

    hydrate();
    chrome.storage.onChanged.addListener(onStorageChanged);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(onStorageChanged);
    };
  }, []);

  useEffect(() => {
    if (!chatSessionHydrated || !chatSessionId) return;
    const session = serializeChatSession({
      sessionId: chatSessionId,
      messages: chatMessages,
      autoPinnedRecord: chatAutoPinnedRecord,
      manualPinnedRecord: chatManualPinnedRecord,
      contextLock: chatContextLock,
    });
    const serialized = JSON.stringify(session);
    if (serialized === lastPersistedChatRef.current) return;
    lastPersistedChatRef.current = serialized;
    chrome.storage.session.set({ [CHAT_SESSION_STORAGE_KEY]: session }).catch(() => {});
  }, [chatSessionHydrated, chatSessionId, chatMessages, chatAutoPinnedRecord, chatManualPinnedRecord, chatContextLock]);

  const [pageType, setPageType] = useState(null); // 'gmail' | 'zoho' | 'other'
  const [zohoPageContext, setZohoPageContext] = useState(null);

  // If DOM enrichment arrives for the record already pinned to the
  // conversation, fold those non-empty fields into the snapshot even when
  // ChatPanel has been auto-unmounted. Never update a different-record pin.
  useEffect(() => {
    if (!zohoPageContext || !zohoPageContext.recordId) return;
    setChatAutoPinnedRecord((snapshot) => {
      if (!snapshot || snapshot.recordId !== zohoPageContext.recordId) return snapshot;
      let enriched = snapshot;
      for (const [key, value] of Object.entries(zohoPageContext)) {
        if (value == null || value === '' || snapshot[key] === value) continue;
        if (enriched === snapshot) enriched = { ...snapshot };
        enriched[key] = value;
      }
      return enriched;
    });
  }, [zohoPageContext]);

  // ── Report Issue ── one-click bug/glitch reporting for the team.
  const [reportOpen, setReportOpen] = useState(false);
  const [reportNote, setReportNote] = useState('');
  const [reportStatus, setReportStatus] = useState('idle'); // idle | sending | sent | error

  // Capture recent console errors / uncaught exceptions so a report shows what
  // actually broke. Installed once, off the render path.
  useEffect(() => { installErrorCapture(); }, []);

  const handleReportIssue = useCallback(async () => {
    setReportStatus('sending');
    let activeUrl = '';
    try {
      const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
      // Redact: keep only origin + path. Gmail/Zoho URLs carry message ids,
      // search terms, and tokens in the query/hash we should not exfiltrate.
      if (t?.url) { const u = new URL(t.url); activeUrl = (u.origin + u.pathname).slice(0, 300); }
    } catch (_) { /* ignore */ }
    try {
      const snapshot = {
        note: String(reportNote || '').slice(0, 4000),
        version: (chrome?.runtime?.getManifest?.().version) || 'unknown',
        env: IS_DEV_BUILD ? 'dev' : 'prod',
        url: activeUrl,
        activeTab,
        pageType,
        context: {
          email: emailContext ? {
            subject: emailContext.subject, senderEmail: emailContext.senderEmail,
            senderName: emailContext.senderName, customerDomain: emailContext.customerDomain,
          } : null,
          zoho: zohoPageContext ? {
            module: zohoPageContext.module, recordId: zohoPageContext.recordId,
            recordName: zohoPageContext.recordName,
          } : null,
          lock: contextLockReportMetadata(chatContextLock),
        },
        lastChat: (chatMessages || []).slice(-6).map((m) => ({
          role: m.role, content: String(m.content || '').slice(0, 1500),
        })),
        recentErrors: getRecentErrors().slice(-15),
        userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
      };
      await sendToBackground(MSG.REPORT_ISSUE, snapshot);
      setReportStatus('sent');
      setReportNote('');
      setTimeout(() => { setReportOpen(false); setReportStatus('idle'); }, 1800);
    } catch (e) {
      console.error('[Stratus AI] report failed:', e?.message);
      setReportStatus('error');
    }
  }, [reportNote, activeTab, pageType, emailContext, zohoPageContext, chatMessages, chatContextLock]);

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
    return onMessage(MSG.EMAIL_CHANGED, async (data, sender) => {
      try {
        const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // Every Gmail content script can emit this runtime message. Only the
        // active Gmail tab is authoritative for the live (unlocked) context.
        if (!activeTab?.url?.startsWith('https://mail.google.com/')) return;
        if (sender?.tab?.id == null || sender.tab.id !== activeTab.id) return;
        setEmailContext(data?.empty ? null : data);
        setPageType('gmail');
        setCrmContext(null);
        setNavData(null);
      } catch (_) {
        // Fail closed: an unverified sender must not repoint live context.
      }
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
        const activeKey = `${activeTabId ?? 'none'}:${activeUrl}`;
        const activeChanged = activeKey !== lastObservedActiveTabRef.current;
        lastObservedActiveTabRef.current = activeKey;

        if (!urlInfo?.isZoho) {
          if (!cancelled) {
            setZohoPageContext((prev) => (prev ? null : prev));
            if (activeUrl.startsWith('https://mail.google.com/')) {
              setPageType('gmail');
              if (activeChanged) {
                sendToBackground(MSG.GET_EMAIL_CONTEXT).then((ctx) => {
                  if (!cancelled) setEmailContext(ctx && !ctx.empty ? ctx : null);
                }).catch(() => {});
              }
            } else {
              setPageType('other');
            }
          }
          return;
        }
        if (!cancelled) setPageType('zoho');
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

  const captureCurrentContextLock = useCallback(async () => {
    let activeTabInfo = null;
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      activeTabInfo = activeTab || null;
    } catch (_) { /* create a no-context lock */ }

    const activeUrl = activeTabInfo?.url || '';
    let fullEmailContext = null;
    let currentZohoContext = null;

    if (activeUrl.startsWith('https://mail.google.com/')) {
      try {
        const ctx = await sendToBackground(MSG.GET_FULL_EMAIL_CONTEXT);
        if (ctx && !ctx.empty) fullEmailContext = ctx;
      } catch (_) { /* an explicit no-context lock is safer than stale email */ }
    } else {
      const urlInfo = parseZohoRecordUrl(activeUrl);
      if (urlInfo?.isRecord) {
        if (contextMatchesUrl(zohoPageContext, urlInfo)) {
          currentZohoContext = zohoPageContext;
        } else {
          try {
            const ctx = await sendToBackground(MSG.GET_PAGE_CONTEXT);
            if (contextMatchesUrl(ctx?.zohoContext, urlInfo)) currentZohoContext = ctx.zohoContext;
          } catch (_) { /* use the URL-derived record below */ }
        }
        if (!currentZohoContext) currentZohoContext = minimalContextFromUrl(urlInfo);
      }
    }

    const lock = createContextLock({
      pageUrl: activeUrl,
      tabId: activeTabInfo?.id ?? null,
      emailContext: fullEmailContext,
      zohoContext: currentZohoContext,
    });
    setChatContextLock(lock);
    // The old R7 auto-pin is an unlocked heuristic. A first-class lock owns
    // context selection while active, so do not retain a competing snapshot.
    setChatAutoPinnedRecord(null);
    if (!chatSessionId) setChatSessionId(createEmptyChatSession().sessionId);
    setActiveTab('chat');
    return lock;
  }, [zohoPageContext, chatSessionId]);

  const unlockChatContext = useCallback(() => {
    setChatContextLock(null);
    setChatAutoPinnedRecord(null);
  }, []);

  const startNewChatSession = useCallback(() => {
    const empty = createEmptyChatSession();
    setChatSessionId(empty.sessionId);
    setChatMessages([]);
    setChatAutoPinnedRecord(null);
    setChatManualPinnedRecord(null);
    setChatContextLock(null);
  }, []);

  // A closed/navigated source tab makes the lock stale, but never swaps in a
  // new page. The self-contained snapshot remains usable and the UI turns
  // amber so the user can replace or unlock it deliberately.
  useEffect(() => {
    const sourceTabId = chatContextLock?.lockedFromTabId;
    if (sourceTabId == null) return undefined;
    let cancelled = false;

    async function refreshAvailability() {
      let available = false;
      try {
        const tab = await chrome.tabs.get(sourceTabId);
        available = isLockSourceAvailable(chatContextLock, tab);
      } catch (_) { /* tab closed */ }
      if (cancelled || available === chatContextLock.sourceAvailable) return;
      setChatContextLock((current) => current ? { ...current, sourceAvailable: available } : current);
    }

    const onRemoved = (tabId) => {
      if (tabId === sourceTabId) {
        setChatContextLock((current) => current ? { ...current, sourceAvailable: false } : current);
      }
    };
    const onUpdated = (tabId) => { if (tabId === sourceTabId) refreshAvailability(); };

    refreshAvailability();
    chrome.tabs.onRemoved.addListener(onRemoved);
    chrome.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      chrome.tabs.onRemoved.removeListener(onRemoved);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [chatContextLock?.lockedFromTabId, chatContextLock?.sourceUrl, chatContextLock?.kind, chatContextLock?.snapshot?.recordId, chatContextLock?.sourceAvailable]);

  // The Lines tab only exists while a Zoho Quote is the active record. If the
  // rep navigates away while it is open, fall back to the CRM tab rather than
  // leaving an editor pointed at a record that is no longer on screen.
  const quoteLinesRecordId = (pageType === 'zoho' && zohoPageContext?.module === 'Quotes')
    ? zohoPageContext.recordId
    : null;
  const visibleTabs = quoteLinesRecordId ? [...TABS, QUOTE_LINES_TAB] : TABS;

  useEffect(() => {
    if (activeTab === QUOTE_LINES_TAB.id && !quoteLinesRecordId) setActiveTab('crm');
  }, [activeTab, quoteLinesRecordId]);

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
          Stratus AI{IS_DEV_BUILD ? ` · DEV v${chrome.runtime.getManifest().version}` : ''}
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

        {chatSessionHydrated && (
          <button
            onClick={chatContextLock ? unlockChatContext : captureCurrentContextLock}
            title={chatContextLock
              ? `Context locked for this chat. Click to unlock. ${contextLockLabel(chatContextLock)}`
              : 'Lock the current Gmail, Zoho, or general page context to this chat'}
            style={{
              display: 'flex', alignItems: 'center', gap: 4,
              background: chatContextLock
                ? (chatContextLock.sourceAvailable === false ? '#b06000' : '#0b8043')
                : 'transparent',
              border: `1px solid ${chatContextLock ? '#ffffff66' : '#ffffff55'}`,
              borderRadius: 12, padding: '2px 8px', color: 'white',
              fontSize: 10, fontWeight: 700, cursor: 'pointer', maxWidth: 190,
            }}
          >
            <span>{chatContextLock ? '🔒' : '🔓'}</span>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {chatContextLock ? contextLockLabel(chatContextLock) : 'Lock context'}
            </span>
          </button>
        )}

        <button
          onClick={() => { setReportStatus('idle'); setReportOpen((v) => !v); }}
          style={{
            background: 'none', border: 'none', color: 'white', cursor: 'pointer',
            fontSize: 16, opacity: reportOpen ? 1 : 0.7, padding: 4,
          }}
          title="Report an issue"
        >
          🐛
        </button>

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

      {/* Report Issue form — appears under the header when 🐛 is clicked */}
      {reportOpen && (
        <div style={{
          padding: '10px 16px', background: COLORS.BG_PRIMARY,
          borderBottom: `1px solid ${COLORS.BORDER}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 6 }}>
            Report an issue
          </div>
          <textarea
            value={reportNote}
            onChange={(e) => setReportNote(e.target.value)}
            placeholder="What went wrong? (optional) — a snapshot of your recent activity and any errors is included automatically."
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', fontSize: 12, padding: 6,
              border: `1px solid ${COLORS.BORDER}`, borderRadius: 4, resize: 'vertical',
              fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
            <button
              onClick={handleReportIssue}
              disabled={reportStatus === 'sending'}
              style={{
                background: COLORS.STRATUS_BLUE, color: 'white', border: 'none',
                borderRadius: 4, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
                opacity: reportStatus === 'sending' ? 0.6 : 1,
              }}
            >
              {reportStatus === 'sending' ? 'Sending…' : 'Send report'}
            </button>
            <button
              onClick={() => { setReportOpen(false); setReportStatus('idle'); }}
              style={{
                background: 'none', border: `1px solid ${COLORS.BORDER}`, color: COLORS.TEXT_SECONDARY,
                borderRadius: 4, padding: '5px 12px', fontSize: 12, cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            {reportStatus === 'sent' && <span style={{ fontSize: 12, color: COLORS.SUCCESS }}>Thanks — reported ✓</span>}
            {reportStatus === 'error' && <span style={{ fontSize: 12, color: COLORS.ERROR }}>Failed to send — try again</span>}
          </div>
        </div>
      )}

      {/* Tab Bar */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${COLORS.BORDER}`,
        background: COLORS.BG_PRIMARY, overflowX: 'auto',
      }}>
        {visibleTabs.map((tab) => (
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
            {activeTab === 'chat' && <ChatPanel
              emailContext={emailContext}
              navData={navData}
              messages={chatMessages}
              onMessagesChange={setChatMessages}
              zohoPageContext={zohoPageContext}
              autoPinnedRecord={chatAutoPinnedRecord}
              onAutoPinnedRecordChange={setChatAutoPinnedRecord}
              manualPinnedRecord={chatManualPinnedRecord}
              onManualPinnedRecordChange={setChatManualPinnedRecord}
              contextLock={chatContextLock}
              onLockCurrentContext={captureCurrentContextLock}
              onUnlockContext={unlockChatContext}
              onStartNewConversation={startNewChatSession}
            />}
            {activeTab === 'search' && <SearchPanel navData={navData} />}
            {activeTab === QUOTE_LINES_TAB.id && quoteLinesRecordId
              && <QuoteLinesView recordId={quoteLinesRecordId} module="Quotes" />}
          </Suspense>
        </PanelErrorBoundary>
      </div>
    </div>
  );
}
