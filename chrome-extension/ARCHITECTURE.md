# Stratus AI Chrome Extension — Architecture

## Overview

Replaces the Gmail Add-on (Apps Script Card Service) with a Manifest V3 Chrome extension. Compatible with Chrome, Comet, and all Chromium-based browsers. Multi-user via per-user Zoho OAuth + per-user API key storage.

## Key Advantages Over Gmail Add-on

| Capability | Gmail Add-on | Chrome Extension |
|---|---|---|
| API latency | 2-4s (Apps Script cold start + relay) | 200-500ms (direct fetch) |
| Execution timeout | 60 seconds | None |
| UI placement | Sidebar only (Card Service) | Sidebar + inline DOM injection |
| Clipboard | Blocked | Full Clipboard API |
| Background tasks | None | Service worker (persistent) |
| Cache/storage | CacheService (5 min TTL) | IndexedDB (unlimited, persistent) |
| SKU highlighting | Not possible | Content script inline injection |
| Compose integration | Separate trigger | Button in compose toolbar |
| Keyboard shortcuts | Not possible | Fully customizable |
| Notifications | Not possible | Desktop Notifications API |
| Real-time updates | Polling only | WebSocket-ready |
| Browser support | Gmail only | Chrome, Comet, Chromium |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Chrome Extension                    │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Background  │  │   Content    │  │   Sidebar   │ │
│  │   Service    │  │   Script     │  │    Panel    │ │
│  │   Worker     │  │  (Gmail DOM) │  │   (React)   │ │
│  │              │  │              │  │             │ │
│  │ - API client │  │ - SKU detect │  │ - Analysis  │ │
│  │ - Auth/OAuth │  │ - CRM banner │  │ - CRM view  │ │
│  │ - Cache mgr  │  │ - Compose    │  │ - Quotes    │ │
│  │ - Shortcuts  │  │   toolbar    │  │ - Drafts    │ │
│  │ - Notifs     │  │ - Highlights │  │ - Tasks     │ │
│  │ - Price sync │  │ - Tooltips   │  │ - Settings  │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘ │
│         │                  │                  │        │
│         └──────────────────┼──────────────────┘        │
│                    Message Passing                      │
│                            │                            │
└────────────────────────────┼────────────────────────────┘
                             │
                    ┌────────▼────────┐
                    │  GChat Worker   │
                    │  /api/* routes  │
                    │  (Cloudflare)   │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │   Zoho CRM      │
                    │  (per-user      │
                    │   OAuth token)  │
                    └─────────────────┘
```

## File Structure

```
chrome-extension/
├── manifest.json              # Manifest V3 config
├── package.json               # Build dependencies (webpack, React)
├── webpack.config.js          # Build config
├── scripts/
│   ├── build-crx.sh           # Build .crx for distribution
│   └── update-manifest.xml    # Auto-update XML for self-hosted
├── public/
│   ├── sidebar.html           # Sidebar panel HTML shell
│   ├── popup.html             # Popup HTML shell
│   └── options.html           # Settings/options page
├── src/
│   ├── background/
│   │   ├── index.js           # Service worker entry
│   │   ├── api-client.js      # All /api/* endpoint calls
│   │   ├── auth.js            # Zoho OAuth + API key management
│   │   ├── cache.js           # IndexedDB cache manager
│   │   ├── notifications.js   # Desktop notifications
│   │   ├── shortcuts.js       # Keyboard shortcut handlers
│   │   ├── context-menus.js   # Right-click context menus
│   │   └── price-sync.js      # Background price refresh
│   ├── content/
│   │   ├── index.js           # Content script entry (Gmail DOM)
│   │   ├── gmail-observer.js  # MutationObserver for Gmail SPA
│   │   ├── sku-highlighter.js # Inline SKU detection + tooltips
│   │   ├── crm-banner.js      # CRM info banner on threads
│   │   ├── compose-toolbar.js # Quote button in compose window
│   │   └── email-extractor.js # Extract email data from DOM
│   ├── sidebar/
│   │   ├── index.jsx          # Sidebar React entry
│   │   ├── App.jsx            # Main sidebar app
│   │   ├── panels/
│   │   │   ├── EmailPanel.jsx    # Email analysis view
│   │   │   ├── CrmPanel.jsx      # CRM account/contact/deal view
│   │   │   ├── QuotePanel.jsx    # Quote builder
│   │   │   ├── TaskPanel.jsx     # Task management
│   │   │   ├── DraftPanel.jsx    # Reply draft generator
│   │   │   └── SearchPanel.jsx   # CRM search
│   │   └── components/
│   │       ├── Header.jsx
│   │       ├── ContactCard.jsx
│   │       ├── DealCard.jsx
│   │       ├── TaskCard.jsx
│   │       ├── QuoteResult.jsx
│   │       └── SkuInput.jsx
│   ├── popup/
│   │   ├── index.jsx          # Popup React entry
│   │   └── QuickActions.jsx   # Quick quote, CRM search, shortcuts
│   ├── lib/
│   │   ├── constants.js       # Config, API URLs, colors
│   │   ├── messaging.js       # Chrome message passing helpers
│   │   ├── storage.js         # chrome.storage wrapper (sync + local)
│   │   └── zoho-oauth.js      # Zoho OAuth flow helpers
│   ├── styles/
│   │   ├── global.css         # Shared styles
│   │   ├── sidebar.css        # Sidebar-specific
│   │   ├── content.css        # Gmail injected styles
│   │   └── popup.css          # Popup styles
│   └── icons/
│       ├── icon-16.png
│       ├── icon-32.png
│       ├── icon-48.png
│       └── icon-128.png
```

## Multi-User Design

### Authentication Flow

```
1. User installs extension
2. Extension opens options page on first run
3. User enters:
   a. Stratus API key (provided by admin / auto-provisioned)
   b. Clicks "Connect Zoho CRM" → OAuth flow
4. Zoho OAuth tokens stored in chrome.storage.local (encrypted)
5. API key stored in chrome.storage.sync (syncs across devices)
6. Each API call includes user's API key in X-API-Key header
7. CRM calls include user's Zoho access token (refreshed automatically)
```

### Per-User Data Isolation

- `chrome.storage.sync` — settings, preferences, API key (synced across devices)
- `chrome.storage.local` — Zoho OAuth tokens, cached CRM data, price cache
- IndexedDB — large data (full price catalog, conversation history, analysis cache)

### Worker Changes Needed

The GChat worker needs minor updates to support per-user auth:
1. Accept Zoho OAuth token in header (alongside or instead of using worker's own token)
2. New endpoint: `/api/auth/zoho-refresh` to refresh expired tokens
3. API key provisioning: admin creates keys per user in worker config

## Content Script — Gmail DOM Integration

### Email Detection (MutationObserver)

Gmail is a SPA. Content script uses MutationObserver to detect:
- Email thread opened (DOM class: `.nH .if`, subject in `.hP`)
- Compose window opened (DOM class: `.T-I.J-J5-Ji`)
- Navigation changes (URL hash changes: `#inbox/`, `#sent/`, etc.)

### SKU Highlighting

Content script scans email body text for known Cisco/Meraki SKU patterns:
- Regex: `/\b(MR\d{2,3}|MS\d{3}|MX\d{2,3}|CW\d{4}|MV\d{2,3}|MT\d{2}|MG\d{2}|Z\d[A-Z]*)\b/gi`
- Wraps matches in `<span class="stratus-sku" data-sku="...">` with CSS highlight
- Hover tooltip shows: product name, list price, ecomm price, stock status
- Click opens Quick Quote pre-filled with that SKU

### CRM Banner

When an email thread is opened:
1. Content script extracts sender email + domain
2. Sends message to background worker: `{type: 'CRM_LOOKUP', email, domain}`
3. Background calls `/api/crm-contact` + `/api/crm-deals`
4. If CRM data found, content script injects a banner above the email:
   ```
   ┌─────────────────────────────────────────────────┐
   │ 🏢 Acme Corp  │  3 Open Deals ($45K)  │ Zoho ↗ │
   └─────────────────────────────────────────────────┘
   ```
5. Banner is collapsible, shows last activity, primary contact, deal summary

### Compose Toolbar Button

When a compose window opens:
1. Content script detects the compose toolbar (`.btC` container)
2. Injects a "Stratus Quote" button with the Stratus icon
3. Click opens a floating quote builder panel (React rendered in shadow DOM)
4. Generated quote URL is inserted directly into the compose body

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| Alt+Q | Open/focus Quick Quote (sidebar or popup) |
| Alt+S | Open Stratus sidebar |
| Alt+C | CRM lookup for current email sender |
| Alt+A | Run AI analysis on current email |
| Alt+T | View tasks for current account |
| Alt+D | Generate draft reply |

Configured via `chrome.commands` in manifest. User-customizable via chrome://extensions/shortcuts.

## Context Menus

Right-click context menus:
- **On selected text**: "Quote these SKUs with Stratus" → opens quote builder pre-filled
- **On selected text**: "Look up in Zoho CRM" → CRM search
- **On email link**: "View in Zoho CRM" → opens CRM record if match found

## Desktop Notifications

Background service worker sends notifications for:
- CRM task due today (checked on extension startup + hourly)
- Quote request completed (if quote generation takes >2s)
- Price refresh completed (daily background sync)

## Caching Strategy

| Data | Storage | TTL | Size |
|---|---|---|---|
| CRM contact/account | IndexedDB | 15 min | ~2KB per record |
| Email analysis | IndexedDB | 30 min | ~5KB per analysis |
| Price catalog | IndexedDB | 24 hours | ~200KB |
| User settings | chrome.storage.sync | Persistent | <8KB |
| Zoho tokens | chrome.storage.local | Persistent (auto-refresh) | <1KB |
| SKU patterns (regex) | In-memory | Extension lifetime | <10KB |

## Distribution

Self-hosted CRX via GitHub Releases with auto-update:

1. GitHub Actions workflow on push to `main`:
   - Runs `npm run build` in chrome-extension/
   - Packages as .crx signed with extension private key
   - Creates GitHub Release with .crx attachment
   - Updates `update-manifest.xml` on GitHub Pages

2. Extension manifest includes:
   ```json
   "update_url": "https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml"
   ```

3. Chromium checks this URL periodically and auto-updates.

4. For Google Workspace managed devices: force-install via Admin Console policy.

## Comet Browser Compatibility

Comet is Chromium-based and supports:
- Manifest V3 extensions ✓
- chrome.* APIs ✓
- Content scripts ✓
- Side panel API ✓ (Chromium 114+)
- Self-hosted .crx install ✓ (no Web Store dependency)

Key consideration: Comet may not support `chrome.sidePanel` API if on older Chromium. Fallback: use `chrome.action` popup as sidebar alternative, or inject sidebar via content script into a fixed-position panel.

## Migration Path

Phase 1 (this build):
- Full extension with all features
- Gmail Add-on remains available as fallback
- Team tests extension for 1-2 weeks

Phase 2:
- Disable Gmail Add-on
- Extension becomes primary tool
- Add features not possible in add-on (WebSocket notifications, etc.)

Phase 3 (future):
- Extend to Google Calendar (meeting prep with CRM context)
- Extend to other webmail (Outlook web) if needed
