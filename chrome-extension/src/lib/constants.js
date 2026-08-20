/**
 * Stratus AI Chrome Extension — Constants & Configuration
 */

// Pointed at the gateway worker (Gemma-first waterfall with Claude fallback).
// Gateway transparently forwards non-chat /api/* paths to the main worker.
// ROLLBACK: change to 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev' to
// revert to the original Claude-only path. No other code changes needed.
// API_BASE is overridable at build time via webpack DefinePlugin (STRATUS_API_BASE) or a
// global, so one bundle works for personal and corporate. Falls back to the personal-account
// gateway for backward compat.
export const API_BASE = (typeof STRATUS_API_BASE !== 'undefined' && STRATUS_API_BASE)
  || (typeof globalThis !== 'undefined' && globalThis.STRATUS_API_BASE)
  || 'https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev';

// Build environment. 'dev' for a locally-loaded unpacked TEST build (set STRATUS_ENV=dev at
// build time); 'prod' otherwise. Drives the DEV header color/label so you can visually tell a
// test build apart from the published one. Production/Web-Store builds leave this unset -> 'prod'.
export const STRATUS_ENV_NAME = (typeof STRATUS_ENV !== 'undefined' && STRATUS_ENV) || 'prod';
export const IS_DEV_BUILD = STRATUS_ENV_NAME === 'dev';

export const ZOHO = {
  ORG_URL: 'https://crm.zoho.com/crm/org647122552',
  AUTH_URL: 'https://accounts.zoho.com/oauth/v2/auth',
  TOKEN_URL: 'https://accounts.zoho.com/oauth/v2/token',
  API_BASE: 'https://www.zohoapis.com/crm/v5',
  // Scopes needed for CRM read/write
  SCOPES: [
    'ZohoCRM.modules.ALL',
    'ZohoCRM.settings.ALL',
    'ZohoCRM.users.READ',
  ].join(','),
  // Client ID is set per-install in options page
  // Client Secret stored in chrome.storage.local
};

export const COLORS = {
  STRATUS_BLUE: '#1a73a7',
  STRATUS_DARK: '#0d4f73',
  STRATUS_LIGHT: '#e8f4f8',
  SUCCESS: '#34a853',
  WARNING: '#fbbc04',
  ERROR: '#ea4335',
  TEXT_PRIMARY: '#202124',
  TEXT_SECONDARY: '#5f6368',
  BORDER: '#dadce0',
  BG_PRIMARY: '#ffffff',
  BG_SECONDARY: '#f8f9fa',
  BG_HOVER: '#f1f3f4',
  DEV_HEADER: '#c2410c', // DEV-build header (orange) — only shown in STRATUS_ENV=dev unpacked builds
};

export const CACHE_TTL = {
  CRM_CONTACT: 15 * 60 * 1000,     // 15 minutes
  CRM_DEALS: 10 * 60 * 1000,       // 10 minutes
  EMAIL_ANALYSIS: 30 * 60 * 1000,  // 30 minutes
  PRICE_CATALOG: 24 * 60 * 60 * 1000, // 24 hours
  SKU_PATTERNS: Infinity,           // Extension lifetime
};

export const MAX_EMAIL_BODY_CHARS = 8000;

// SKU detection regex — matches Cisco/Meraki model numbers
export const SKU_PATTERN = /\b(MR\d{2,3}[A-Z]*|MS\d{3}[A-Z0-9-]*|MX\d{2,3}[A-Z]*|CW\d{4}[A-Z]*|MV\d{2,3}[A-Z]*|MT\d{2,3}[A-Z]*|MG\d{2,3}[A-Z]*|Z\d[A-Z]*|C9\d{3}[A-Z0-9-]*|LIC-[A-Z0-9-]+)\b/gi;

// Deal ID detection regex — matches Zoho Deal IDs (13-19 digit numeric IDs)
export const DEAL_ID_PATTERN = /\b(\d{13,19})\b/g;

// Consumer email domains — skip CRM lookup for these
export const CONSUMER_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'aol.com',
  'icloud.com', 'protonmail.com', 'live.com', 'msn.com', 'me.com', 'mac.com',
  'comcast.net', 'att.net', 'verizon.net', 'sbcglobal.net', 'cox.net',
]);

// Message types for chrome.runtime messaging
export const MSG = {
  // Content → Background
  CRM_LOOKUP: 'CRM_LOOKUP',
  CRM_LOOKUP_CONTACT: 'CRM_LOOKUP_CONTACT',
  CRM_DEALS: 'CRM_DEALS',
  CRM_ISR_DEALS: 'CRM_ISR_DEALS',
  CRM_SEARCH: 'CRM_SEARCH',
  ANALYZE_EMAIL: 'ANALYZE_EMAIL',
  GENERATE_QUOTE: 'GENERATE_QUOTE',
  DRAFT_REPLY: 'DRAFT_REPLY',
  DETECT_SKUS: 'DETECT_SKUS',
  PRODUCT_SEARCH: 'PRODUCT_SEARCH',
  FETCH_TASKS: 'FETCH_TASKS',
  TASK_ACTION: 'TASK_ACTION',
  GET_PRICE: 'GET_PRICE',

  // Background → Content
  EMAIL_CHANGED: 'EMAIL_CHANGED',
  CRM_DATA_READY: 'CRM_DATA_READY',
  SKU_PRICES_READY: 'SKU_PRICES_READY',

  // Sidebar ↔ Background
  GET_EMAIL_CONTEXT: 'GET_EMAIL_CONTEXT',
  GET_FULL_EMAIL_CONTEXT: 'GET_FULL_EMAIL_CONTEXT',
  GET_CRM_CONTEXT: 'GET_CRM_CONTEXT',
  OPEN_SIDEBAR: 'OPEN_SIDEBAR',
  SIDEBAR_NAVIGATE: 'SIDEBAR_NAVIGATE',
  SIDEBAR_ACTION_AVAILABLE: 'SIDEBAR_ACTION_AVAILABLE',
  SIDEBAR_ACTION_CLAIM: 'SIDEBAR_ACTION_CLAIM',
  SIDEBAR_ACTION_ACK: 'SIDEBAR_ACTION_ACK',

  // Auth
  ZOHO_AUTH_START: 'ZOHO_AUTH_START',
  ZOHO_AUTH_COMPLETE: 'ZOHO_AUTH_COMPLETE',
  GET_AUTH_STATUS: 'GET_AUTH_STATUS',

  // Settings
  GET_SETTINGS: 'GET_SETTINGS',
  SAVE_SETTINGS: 'SAVE_SETTINGS',

  // Email Sent Detection & Task Rescheduling
  EMAIL_SENT: 'EMAIL_SENT',
  CHECK_OPEN_TASKS: 'CHECK_OPEN_TASKS',
  TASK_RESCHEDULE_PROMPT: 'TASK_RESCHEDULE_PROMPT',

  // Deal ID Detection & Velocity Hub
  VELOCITY_HUB: 'VELOCITY_HUB',
  OPEN_DEAL: 'OPEN_DEAL',

  // Image Analysis
  ANALYZE_IMAGE: 'ANALYZE_IMAGE',

  // CRM Write Operations
  CRM_ADD_CONTACT: 'CRM_ADD_CONTACT',

  // Chat Handoff
  CHAT_HANDOFF: 'CHAT_HANDOFF',
  CHAT_STOP: 'CHAT_STOP',
  CHAT_PROGRESS: 'CHAT_PROGRESS',

  // CCW / Velocity Hub
  CCW_LOOKUP: 'CCW_LOOKUP',
  VELOCITY_HUB_SUBMIT: 'VELOCITY_HUB_SUBMIT',
  ASSIGN_REP: 'ASSIGN_REP',
  FIND_LICENSE_KEY: 'FIND_LICENSE_KEY',

  // Deal Close Lost — confirm-gated Stage update with server-side read-back verify
  DEAL_CLOSE_LOST: 'DEAL_CLOSE_LOST',

  // One-shot customer-to-quote: deterministic reviewed plan + execute (no agent loop)
  CRM_DELETE: 'CRM_DELETE',
  CRM_UNDO: 'CRM_UNDO',
  ONESHOT_PLAN: 'ONESHOT_PLAN',
  ONESHOT_EXECUTE: 'ONESHOT_EXECUTE',
  // Email intake: parse the open email once into catalog-resolved lines (read-only)
  ONESHOT_INTAKE: 'ONESHOT_INTAKE',

  // Task suggestion
  SUGGEST_TASK_PREVIEW: 'SUGGEST_TASK_PREVIEW',
  SUGGEST_TASK: 'SUGGEST_TASK',

  // CRM account search (for Add Contact form)
  CRM_ACCOUNT_SEARCH: 'CRM_ACCOUNT_SEARCH',

  // Create CRM account (for Add Contact form)
  CRM_CREATE_ACCOUNT: 'CRM_CREATE_ACCOUNT',

  // Enrich company info from domain (for Add Contact → New Account)
  ENRICH_COMPANY: 'ENRICH_COMPANY',

  // Create CRM task manually
  CRM_CREATE_TASK: 'CRM_CREATE_TASK',

  // Tab Screenshot Capture
  CAPTURE_TAB: 'CAPTURE_TAB',

  // Zoho Page Context Detection
  ZOHO_CONTEXT_CHANGED: 'ZOHO_CONTEXT_CHANGED',
  GET_PAGE_CONTEXT: 'GET_PAGE_CONTEXT',

  // WS4 — Build a URL quote from a Zoho Quotes record page.
  // GET_ZOHO_QUOTE_ITEMS: background → active Zoho tab content script; scrapes
  //   the Product_Details grid for { sku, qty } line items.
  // BUILD_URL_QUOTE: sidebar → background; POSTs "<qty> <sku>" lines to
  //   /api/quote (same engine as the bots) and returns the order URL(s).
  GET_ZOHO_QUOTE_ITEMS: 'GET_ZOHO_QUOTE_ITEMS',
  BUILD_URL_QUOTE: 'BUILD_URL_QUOTE',

  // Download Zoho's native templated Quote PDF (the web-UI "Export to PDF").
  // Sidebar → background → it opens an inactive crm.zoho.com preview tab and
  // forwards this to the content script, which runs the 2-step export
  // (preview page → ExportPDF.do) and returns the PDF as base64.
  EXPORT_ZOHO_PDF: 'EXPORT_ZOHO_PDF',
  EXPORT_ZOHO_PDF_DIRECT: 'EXPORT_ZOHO_PDF_DIRECT',

  // Quote Line Editor (2026-08-20). Bulk discount / batch delete / reorder on a
  // Zoho Quote, committed in ONE atomic worker PUT.
  //   GET_QUOTE_LINES:        sidebar/overlay -> background -> POST /api/quote-lines
  //                           (INTERNAL: returns list price and discount)
  //   COMMIT_QUOTE_LINE_OPS:  the deterministic write, POST /api/quote-line-ops
  //   OPEN_QUOTE_LINE_EDITOR: chip / context menu / side panel -> the Zoho tab's
  //                           content script, which mounts the iframe overlay
  GET_QUOTE_LINES: 'GET_QUOTE_LINES',
  //   MATCH_QUOTE_LINES_TO_ECOMM: resolve each line's live storefront price,
  //                           POST /api/quote-line-ecomm (read-only preview)
  MATCH_QUOTE_LINES_TO_ECOMM: 'MATCH_QUOTE_LINES_TO_ECOMM',
  //   GET_QUOTE_LINE_COSTS:   distributor cost per line (the Costs By Lines /
  //                           Vendor_Lines related list), POST
  //                           /api/quote-line-costs, for margin pricing
  GET_QUOTE_LINE_COSTS: 'GET_QUOTE_LINE_COSTS',
  //   PREVIEW_QUOTE_CLONE_TERMS / CLONE_QUOTE_TERMS: clone the quote onto other
  //   licence terms. Preview writes nothing; the clone creates one new Zoho
  //   quote per term, each verified with its own undo token.
  PREVIEW_QUOTE_CLONE_TERMS: 'PREVIEW_QUOTE_CLONE_TERMS',
  CLONE_QUOTE_TERMS: 'CLONE_QUOTE_TERMS',
  COMMIT_QUOTE_LINE_OPS: 'COMMIT_QUOTE_LINE_OPS',
  OPEN_QUOTE_LINE_EDITOR: 'OPEN_QUOTE_LINE_EDITOR',

  // Report Issue — sidebar → background → POST /api/report-issue with a snapshot
  REPORT_ISSUE: 'REPORT_ISSUE',
};

// Keyboard shortcut command names (match manifest.json)
export const COMMANDS = {
  OPEN_SIDEBAR: 'open-sidebar',
  QUICK_QUOTE: 'quick-quote',
  CRM_LOOKUP: 'crm-lookup',
  ANALYZE_EMAIL: 'analyze-email',
  VIEW_TASKS: 'view-tasks',
  DRAFT_REPLY: 'draft-reply',
};
