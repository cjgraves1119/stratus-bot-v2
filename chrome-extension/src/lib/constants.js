/**
 * Stratus AI Chrome Extension — Constants & Configuration
 */

export const API_BASE = 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev';

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
  FETCH_TASKS: 'FETCH_TASKS',
  TASK_ACTION: 'TASK_ACTION',
  GET_PRICE: 'GET_PRICE',

  // Background → Content
  EMAIL_CHANGED: 'EMAIL_CHANGED',
  CRM_DATA_READY: 'CRM_DATA_READY',
  SKU_PRICES_READY: 'SKU_PRICES_READY',

  // Sidebar ↔ Background
  GET_EMAIL_CONTEXT: 'GET_EMAIL_CONTEXT',
  GET_CRM_CONTEXT: 'GET_CRM_CONTEXT',
  OPEN_SIDEBAR: 'OPEN_SIDEBAR',
  SIDEBAR_NAVIGATE: 'SIDEBAR_NAVIGATE',

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

  // CCW / Velocity Hub
  CCW_LOOKUP: 'CCW_LOOKUP',
  VELOCITY_HUB_SUBMIT: 'VELOCITY_HUB_SUBMIT',
  ASSIGN_REP: 'ASSIGN_REP',

  // Task suggestion
  SUGGEST_TASK_PREVIEW: 'SUGGEST_TASK_PREVIEW',
  SUGGEST_TASK: 'SUGGEST_TASK',

  // CRM account search (for Add Contact form)
  CRM_ACCOUNT_SEARCH: 'CRM_ACCOUNT_SEARCH',

  // Create CRM account (for Add Contact form)
  CRM_CREATE_ACCOUNT: 'CRM_CREATE_ACCOUNT',

  // Create CRM task manually
  CRM_CREATE_TASK: 'CRM_CREATE_TASK',

  // Tab Screenshot Capture
  CAPTURE_TAB: 'CAPTURE_TAB',
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
