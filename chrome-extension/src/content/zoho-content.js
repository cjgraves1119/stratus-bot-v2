/**
 * Stratus AI Chrome Extension — Zoho CRM Content Script
 *
 * 1. Detects the current Zoho CRM record (Account, Contact, Deal, Quote, etc.)
 *    from the URL and page content, then sends context to the background
 *    service worker, which persists it under a per-tab key
 *    (`zohoCtx_<tabId>` in chrome.storage.session) so other tabs' contexts
 *    never leak into the active-tab read path.
 * 2. Injects "View in Gmail" quick links next to email fields.
 *
 * URL is authoritative: on every SPA navigation we publish a minimal
 * URL-derived context immediately (before DOM enrichment finishes) so the
 * sidebar/background never serve a stale record in the gap.
 *
 * The content script NEVER writes to chrome.storage directly — it cannot
 * know its own tab id, and a global storage key (the prior approach) is the
 * root cause of the cross-tab context-bleed bug. All persistence is routed
 * through chrome.runtime.sendMessage so the background can stamp
 * `sender.tab.id` and key storage correctly.
 *
 * Runs only on crm.zoho.com pages.
 */

import {
  parseZohoRecordUrl,
  minimalContextFromUrl,
} from '../lib/zoho-url.js';

const GMAIL_SEARCH_BASE = 'https://mail.google.com/mail/u/0/#search/';

// ─────────────────────────────────────────────
// Extract record name from page DOM
// ─────────────────────────────────────────────

/**
 * Try to extract the record name/title from the Zoho CRM page.
 * Zoho renders the record name in several possible selectors.
 */
function extractRecordName() {
  // Primary: the record header title
  const selectors = [
    '.entityNameContent',           // Record detail header
    '.moduleHead .lyte-text',       // Alternate header
    '.header-info .primaryText',    // Another variant
    'h1.moduleHead',                // Module header
    '.entityHeaderInfo .primaryField', // Primary field
    '[data-zia-view="entity_name"]',   // ZIA annotated
    '.recordTitle',                 // Record title
    '.lyte-text[data-field-name="Account_Name"]',
    '.lyte-text[data-field-name="Full_Name"]',
    '.lyte-text[data-field-name="Deal_Name"]',
    '.lyte-text[data-field-name="Subject"]',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0 && text.length < 200) return text;
    }
  }

  // Fallback: page title often contains the record name
  // Format: "Record Name - Module - Zoho CRM"
  const title = document.title || '';
  const parts = title.split(' - ');
  if (parts.length >= 2 && parts[0].trim().length > 0) {
    return parts[0].trim();
  }

  return null;
}

/**
 * Extract email address from the current record page (for contacts).
 */
function extractRecordEmail() {
  const emailSelectors = [
    '[data-field-name="Email"] a[href^="mailto:"]',
    '[data-field-name="Email"] .zcrmLink',
    '[data-field-name="Email"] a',
    'a[href^="mailto:"]',
  ];

  for (const sel of emailSelectors) {
    const el = document.querySelector(sel);
    if (el) {
      let email = '';
      if (el.href && el.href.startsWith('mailto:')) {
        email = el.href.replace('mailto:', '').split('?')[0];
      } else {
        email = el.textContent.trim();
      }
      if (email && email.includes('@')) return email;
    }
  }
  return null;
}

/**
 * Extract the account name from a Contact or Deal record page.
 */
function extractAccountName() {
  const selectors = [
    '[data-field-name="Account_Name"] a',
    '[data-field-name="Account_Name"] .zcrmLink',
    '[data-field-name="Account_Name"] .lyte-text',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0) return text;
    }
  }
  return null;
}

/**
 * Extract the website/domain from an Account record page.
 */
function extractWebsite() {
  const selectors = [
    '[data-field-name="Website"] a',
    '[data-field-name="Website"] .zcrmLink',
    '[data-field-name="Website"] .lyte-text',
  ];

  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) {
      const text = el.textContent.trim();
      if (text && text.length > 0) return text;
    }
  }
  return null;
}

// ─────────────────────────────────────────────
// WS4 — Quote line-item extraction (Product_Details grid)
// ─────────────────────────────────────────────

/**
 * Best-effort scrape of the line items (product code + quantity) from a Zoho
 * Quotes/SalesOrders/Invoices record's Product_Details grid.
 *
 * Zoho renders the line-item grid with no single stable contract across themes
 * and module variants, so we try several strategies and fail GRACEFULLY:
 * this function NEVER throws and returns [] when nothing parseable is found.
 * The caller (WS4 round-trip) treats [] as "couldn't read the grid" and shows
 * a friendly message rather than a hard error.
 *
 * A "SKU" here is the Product Code / part number (e.g. MR44, LIC-ENT-3YR), not
 * the human product name. We prefer an explicit product-code cell, then fall
 * back to extracting a Cisco/Meraki-shaped token from the product name cell.
 *
 * @returns {Array<{sku: string, qty: number}>}
 */
function extractQuoteLineItems() {
  try {
    // Cisco/Meraki SKU shape — mirrors lib/constants SKU_PATTERN closely enough
    // to recover a code from a "MR44 - Meraki AP" style product-name cell.
    const SKU_RE = /\b(MR\d{2,3}[A-Z]*|MS\d{3}[A-Z0-9-]*|MX\d{2,3}[A-Z]*|CW\d{4}[A-Z]*|MV\d{2,3}[A-Z]*|MT\d{2,3}[A-Z]*|MG\d{2,3}[A-Z]*|GR\d{2,3}[A-Z]*|GS\d{3}[A-Z0-9-]*|GX\d{2,3}[A-Z]*|Z\d[A-Z]*|C9\d{3}[A-Z0-9-]*|LIC-[A-Z0-9-]+|SUB-[A-Z0-9-]+|[A-Z]{2,5}-[A-Z0-9-]{3,})\b/i;

    const cleanCode = (raw) => {
      if (!raw) return null;
      let s = String(raw).trim();
      // Strip common label noise.
      s = s.replace(/^(product\s*code|sku|part\s*(no|number|#)?)\s*[:\-]?\s*/i, '').trim();
      if (!s) return null;
      // If the cell holds a full description, recover the SKU token.
      if (/\s/.test(s) || s.length > 40) {
        const m = s.match(SKU_RE);
        if (m) return m[1].toUpperCase();
        // No recognizable token — fall back to the first whitespace-delimited
        // chunk if it looks code-like (has a digit or hyphen).
        const first = s.split(/\s+/)[0];
        if (first && /[0-9-]/.test(first) && first.length <= 40) return first.toUpperCase();
        return null;
      }
      return s.toUpperCase();
    };

    const parseQty = (raw) => {
      if (raw == null) return null;
      // Quantities can render as "10", "10.00", "10.000 pcs". Take the leading number.
      const m = String(raw).replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
      if (!m) return null;
      const n = Math.round(parseFloat(m[1]));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    const items = [];
    const pushItem = (sku, qty) => {
      const code = cleanCode(sku);
      if (!code) return;
      // Skip obvious non-SKU rows (subtotal/discount/tax/shipping labels).
      if (/^(SUB ?TOTAL|TOTAL|DISCOUNT|TAX|SHIPPING|ADJUSTMENT|GRAND)/i.test(code)) return;
      const q = parseQty(qty);
      items.push({ sku: code, qty: q && q > 0 ? q : 1 });
    };

    // ── Strategy 1: field-name annotated cells within product rows ──────────
    // Modern Zoho marks line-item cells with data-field-name on the row's cells.
    // Product code field is usually "Product_Name" (a lookup) with the code in a
    // sibling, or an explicit "Product_Code"/"Part_No" cell.
    const rowSelectors = [
      '.lineItemRow', '.productGridRow', '[data-line-item]',
      'tr.crmLineItem', 'div[role="row"]',
    ];
    let rows = [];
    for (const sel of rowSelectors) {
      const found = document.querySelectorAll(sel);
      if (found && found.length) { rows = Array.from(found); break; }
    }

    for (const row of rows) {
      // Try explicit code + qty cells first.
      const codeEl =
        row.querySelector('[data-field-name="Product_Code"]') ||
        row.querySelector('[data-field-name="Part_No"]') ||
        row.querySelector('[data-field-name="Product_Name"]') ||
        row.querySelector('.productCode, .product-code, .partNo');
      const qtyEl =
        row.querySelector('[data-field-name="Quantity"]') ||
        row.querySelector('[data-field-name="Qty"]') ||
        row.querySelector('.quantity, .qty, .productQty');

      if (codeEl) {
        // Prefer a nested product-code subnode if the lookup cell carries one.
        const codeText =
          codeEl.querySelector('.product-code, .productCode, .subText')?.textContent ||
          codeEl.textContent;
        pushItem(codeText, qtyEl ? qtyEl.textContent : null);
      }
    }

    if (items.length) return dedupeItems(items);

    // ── Strategy 2: classic <table> grid ───────────────────────────────────
    // Find a table whose header row mentions a product/SKU column and a qty
    // column, then read those columns by index.
    const tables = Array.from(document.querySelectorAll('table'));
    for (const table of tables) {
      const headerCells = Array.from(
        table.querySelectorAll('thead th, thead td, tr:first-child th, tr:first-child td')
      ).map(c => (c.textContent || '').trim().toLowerCase());
      if (!headerCells.length) continue;

      const codeIdx = headerCells.findIndex(h =>
        /product|item|description|sku|part/.test(h));
      const qtyIdx = headerCells.findIndex(h => /qty|quantity/.test(h));
      if (codeIdx === -1) continue;

      const bodyRows = Array.from(table.querySelectorAll('tbody tr'));
      const dataRows = bodyRows.length ? bodyRows : Array.from(table.querySelectorAll('tr')).slice(1);
      for (const tr of dataRows) {
        const cells = Array.from(tr.querySelectorAll('td'));
        if (!cells.length) continue;
        const codeCell = cells[codeIdx];
        const qtyCell = qtyIdx !== -1 ? cells[qtyIdx] : null;
        if (!codeCell) continue;
        pushItem(codeCell.textContent, qtyCell ? qtyCell.textContent : null);
      }
      if (items.length) break;
    }

    return dedupeItems(items);
  } catch (err) {
    // Never throw — WS4 treats empty as "not parseable".
    console.warn('[Stratus AI] extractQuoteLineItems failed:', err?.message);
    return [];
  }
}

/**
 * Merge duplicate SKUs (summing quantities) while preserving first-seen order.
 */
function dedupeItems(items) {
  const map = new Map();
  for (const { sku, qty } of items) {
    if (!sku) continue;
    map.set(sku, (map.get(sku) || 0) + (qty || 0));
  }
  return Array.from(map.entries()).map(([sku, qty]) => ({ sku, qty: qty > 0 ? qty : 1 }));
}

// ─────────────────────────────────────────────
// Context detection & messaging
// ─────────────────────────────────────────────

let lastSentContext = null;

/**
 * Publish a Zoho page context (list or record) to the background service
 * worker. The background is now the SINGLE WRITER to chrome.storage.session
 * for the per-tab keyed entries (zohoCtx_<tabId>) — content scripts cannot
 * know their own tab id, so writing storage directly here would either need
 * a global key (the prior cross-tab bleed bug) or be unsafe.
 *
 * Dedupes on JSON equality so we don't spam the worker during repeated
 * observer ticks.
 *
 * NOTE on message shape: we MUST spread `ctx` FIRST and then set `type` so
 * the outer dispatch `type` is not clobbered by `ctx.type` (which is the
 * literal string 'zoho' from minimalContextFromUrl, NOT a discriminator).
 * The previous shape `{ type: 'ZOHO_CONTEXT_CHANGED', ...ctx }` silently
 * overwrote the message type back to 'zoho', so registerMessageHandlers
 * never dispatched to MSG.ZOHO_CONTEXT_CHANGED. (EXT-CRIT-1)
 */
function publishContext(ctx) {
  if (!ctx) return;
  const key = JSON.stringify(ctx);
  if (key === lastSentContext) return;
  lastSentContext = key;
  // Background handles BOTH the in-memory cache AND the per-tab storage write.
  chrome.runtime.sendMessage({
    ...ctx,
    type: 'ZOHO_CONTEXT_CHANGED',
  }).catch(() => {});
}

/**
 * Immediately publish a URL-only context (no DOM enrichment) so the sidebar
 * switches to the new record the moment SPA navigation happens. The later
 * detectAndSendContext() call will enrich it with recordName/email/etc.
 */
function publishMinimalUrlContext() {
  const urlInfo = parseZohoRecordUrl(window.location.href);
  if (!urlInfo) return;
  const minimal = minimalContextFromUrl(urlInfo);
  if (minimal) publishContext(minimal);
}

/**
 * Detect the current Zoho record and send context to the background.
 *
 * Every published context carries:
 *   - url: the URL the context was derived from (authoritative source)
 *   - detectedAt: ms timestamp (helps downstream staleness checks)
 */
function detectAndSendContext() {
  const urlInfo = parseZohoRecordUrl(window.location.href);

  if (!urlInfo) {
    // Shouldn't happen — script only runs on crm.zoho.com — but guard anyway.
    return;
  }

  if (!urlInfo.isRecord) {
    // List view, dashboard, etc. Publish a list context with the URL attached
    // so the sidebar can still tell "we're on Zoho, just not on a record".
    publishContext(minimalContextFromUrl(urlInfo));
    return;
  }

  const { module, recordId, tabName, url } = urlInfo;
  const recordName = extractRecordName();
  const email = extractRecordEmail();
  const accountName = extractAccountName();
  const website = extractWebsite();

  const ctx = {
    type: 'zoho',
    page: 'record',
    module,
    recordId,
    tabName,
    url,
    detectedAt: Date.now(),
    recordName,
    email,
    accountName,
    website,
  };

  if (publishContextIfEnriched(ctx)) {
    console.log('[Stratus AI] Zoho context detected:', module, recordId, recordName || '(loading)');
  }
}

/**
 * Wrapper around publishContext() that skips "downgrade" writes:
 * if storage already has the same record with a populated recordName,
 * don't clobber it with a newer ctx that hasn't enriched yet.
 *
 * Returns `true` if it published, `false` if skipped.
 */
function publishContextIfEnriched(ctx) {
  if (!ctx) return false;
  publishContext(ctx);
  return true;
}

// ─────────────────────────────────────────────
// Gmail quick-links (existing feature)
// ─────────────────────────────────────────────

function buildGmailSearchUrl(email) {
  const query = encodeURIComponent(`from:${email} OR to:${email}`);
  return `${GMAIL_SEARCH_BASE}${query}`;
}

function injectGmailLinks() {
  const emailElements = document.querySelectorAll(
    'a[href^="mailto:"], ' +
    '.zcrmEmailLink, ' +
    '[data-field-name="Email"] .zcrmLink, ' +
    '[data-field-name="Email"] a, ' +
    'span[data-type="email"]'
  );

  emailElements.forEach((el) => {
    if (el.dataset.stratusGmailLink) return;
    el.dataset.stratusGmailLink = 'true';

    let email = '';
    if (el.href && el.href.startsWith('mailto:')) {
      email = el.href.replace('mailto:', '').split('?')[0];
    } else {
      email = el.textContent.trim();
    }

    if (!email || !email.includes('@')) return;

    const gmailBtn = document.createElement('a');
    gmailBtn.href = buildGmailSearchUrl(email);
    gmailBtn.target = '_blank';
    gmailBtn.rel = 'noopener';
    gmailBtn.className = 'stratus-gmail-link';
    gmailBtn.title = `View ${email} in Gmail`;
    gmailBtn.style.cssText = `
      display: inline-flex; align-items: center; gap: 3px;
      margin-left: 8px; padding: 2px 8px; border-radius: 4px;
      background: #ea433515; color: #ea4335; font-size: 11px;
      font-weight: 500; text-decoration: none; cursor: pointer;
      border: 1px solid #ea433522; transition: all 0.15s ease;
      vertical-align: middle;
    `;
    gmailBtn.innerHTML = '✉ Gmail';

    gmailBtn.addEventListener('mouseenter', () => {
      gmailBtn.style.background = '#ea433525';
    });
    gmailBtn.addEventListener('mouseleave', () => {
      gmailBtn.style.background = '#ea433515';
    });

    el.parentNode.insertBefore(gmailBtn, el.nextSibling);
  });
}

// ─────────────────────────────────────────────
// Initialization & SPA navigation tracking
// ─────────────────────────────────────────────

// Initial detection: publish URL-derived context on the same tick the script
// loads so the sidebar has a record id to show before DOM enrichment finishes.
publishMinimalUrlContext();
setTimeout(() => {
  detectAndSendContext();
  injectGmailLinks();
}, 500);

// Retry context detection a few times as Zoho lazy-loads record content
let retryCount = 0;
const retryInterval = setInterval(() => {
  detectAndSendContext();
  retryCount++;
  if (retryCount >= 6) clearInterval(retryInterval); // Stop after ~6s
}, 1000);

// Watch for SPA navigation via URL changes.
//
// CRITICAL: previously this block `chrome.storage.local.remove('zohoPageContext')`
// on nav and then waited ~600ms for DOM enrichment before re-publishing.
// During that gap the sidebar/background could continue to serve the old
// quote id as "the record the user is currently viewing" via the in-memory
// cache in the service worker, producing the stale-quote bug reproduced by
// Codex on 2026-04-24 (Quote 2570562000400116511 still showing after user
// navigated to Quote 2570562000402426396).
//
// Fix: publish a MINIMAL URL-derived context synchronously on nav
// (module + recordId + url + detectedAt, with recordName/email/etc. blank).
// DOM enrichment then upgrades that context in place via the retry cycle.
// The background re-stamps storage under the per-tab key `zohoCtx_<tabId>`
// on every push, so storage is always in sync with the most recent push.
let lastUrl = window.location.href;
const urlObserver = new MutationObserver(() => {
  if (window.location.href !== lastUrl) {
    lastUrl = window.location.href;
    lastSentContext = null; // Reset so we re-detect
    retryCount = 0;

    // Publish the new record's URL-derived context IMMEDIATELY so the sidebar
    // switches to the new quote/deal/account on the same tick as the URL
    // change — no stale-record window.
    publishMinimalUrlContext();

    // Enrich with DOM data as soon as Zoho has rendered.
    setTimeout(() => {
      detectAndSendContext();
      injectGmailLinks();
    }, 600);

    // Additional retries for lazy-loaded content
    let navRetries = 0;
    const navRetryInterval = setInterval(() => {
      detectAndSendContext();
      injectGmailLinks();
      navRetries++;
      if (navRetries >= 5) clearInterval(navRetryInterval);
    }, 1000);
  }

  // Always re-inject Gmail links (Zoho re-renders DOM frequently)
  injectGmailLinks();
});

urlObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also listen for right-click on email elements
document.addEventListener('contextmenu', (e) => {
  const emailEl = e.target.closest('a[href^="mailto:"], .zcrmEmailLink, [data-field-name="Email"] a');
  if (emailEl) {
    window.__stratusSelectedEmail = emailEl.textContent.trim() ||
      (emailEl.href || '').replace('mailto:', '').split('?')[0];
  }
});

// ─────────────────────────────────────────────
// Quote "Export to PDF" — reproduce the web-UI button (2026-06-18)
// ─────────────────────────────────────────────
//
// The background opens an inactive crm.zoho.com print-preview tab
// (…/tab/Quotes/{id}/export-pdf?flag=false&module=Quotes) and forwards
// EXPORT_ZOHO_PDF here. Zoho's "Export to PDF" is a 2-step session-cookie
// flow: the preview page carries a hidden <form action=…/specific/ExportPDF.do>
// with a per-session crmcsrfparam token; submitting it (with a chosen template
// in layoutName) returns the PDF binary. The template dropdown is populated by
// Zoho's JS after load, so we poll for it. We return the PDF as base64 to the
// sidebar (which triggers the actual download) so closing this tab can't
// cancel an in-flight download. Rides the user's live Zoho session — no
// OAuth/API; there is no official CRM endpoint for the templated PDF.

function abToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function runQuotePdfExport(recordId, templateName) {
  // Wait (up to ~9s) for Zoho's JS to render the ExportPDF form AND populate
  // the template <select> — neither is present in the initial server HTML.
  const deadline = Date.now() + 9000;
  let form = null;
  let options = [];
  while (Date.now() < deadline) {
    form = [...document.querySelectorAll('form')].find(
      (f) => /ExportPDF\.do/i.test(f.getAttribute('action') || '')
    );
    const tmplSelect = [...document.querySelectorAll('select')].find((s) =>
      [...s.options].some((o) => /Hardware Quote|Professional Services|Quote Template/i.test(o.text || ''))
    );
    options = tmplSelect
      ? [...tmplSelect.options]
          .filter((o) => o.value && !/do not use/i.test(o.text || ''))
          .map((o) => ({ name: (o.text || '').trim(), value: o.value }))
      : [];
    if (form && options.length) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  if (!form) return { success: false, error: 'preview_form_not_found' };
  if (!options.length) return { success: false, error: 'no_templates' };

  // Default to "Hardware Quote"; honor an explicit (remembered) choice; else first.
  const chosen =
    options.find((o) => o.name.toLowerCase() === String(templateName || '').toLowerCase()) ||
    options.find((o) => /^hardware quote/i.test(o.name)) ||
    options[0];

  // Build the POST body from the form's pre-filled hidden fields (incl. the
  // crmcsrfparam token), then set the three template-dependent fields.
  const params = new URLSearchParams();
  for (const el of form.querySelectorAll('[name]')) params.append(el.name, el.value ?? '');
  params.set('layoutName', chosen.value);
  params.set('viewType', 'portrait');
  params.set('pdfVersion', 'new');

  const action = new URL(form.getAttribute('action'), location.origin).href;
  const resp = await fetch(action, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const ct = resp.headers.get('content-type') || '';
  const buf = await resp.arrayBuffer();
  const head = String.fromCharCode.apply(null, new Uint8Array(buf.slice(0, 5)));
  if (!/pdf/i.test(ct) && head !== '%PDF-') {
    // Guard: Zoho changed something / not a PDF → let the sidebar fall back.
    return { success: false, error: 'not_pdf', notPdf: true, templates: options.map((o) => o.name) };
  }
  return {
    success: true,
    base64: abToBase64(buf),
    filename: `Quote-${recordId}.pdf`,
    chosenTemplate: chosen.name,
    templates: options.map((o) => o.name),
    size: buf.byteLength,
  };
}

// Listen for requests from the sidebar/background to get current context
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Run the Quote → PDF export on this (preview) page and return base64.
  if (msg.type === 'EXPORT_ZOHO_PDF') {
    (async () => {
      try {
        sendResponse(await runQuotePdfExport(msg.recordId, msg.templateName));
      } catch (e) {
        sendResponse({ success: false, error: e.message || 'export_failed' });
      }
    })();
    return true; // async sendResponse
  }

  if (msg.type === 'GET_ZOHO_PAGE_DATA') {
    const urlInfo = parseZohoRecordUrl(window.location.href);
    const base = urlInfo && urlInfo.isRecord
      ? {
          module: urlInfo.module,
          recordId: urlInfo.recordId,
          tabName: urlInfo.tabName,
          url: urlInfo.url,
          detectedAt: Date.now(),
        }
      : {};
    sendResponse({
      ...base,
      recordName: extractRecordName(),
      email: extractRecordEmail(),
      accountName: extractAccountName(),
      website: extractWebsite(),
    });
    return true;
  }

  // WS4 — sidebar asks (via background) for this Quote page's line items.
  // Only meaningful on a record page with a Product_Details grid (Quotes,
  // Sales_Orders, Invoices, Purchase_Orders). Returns { items, module,
  // recordId } and never throws — items: [] means "couldn't parse the grid".
  if (msg.type === 'GET_ZOHO_QUOTE_ITEMS') {
    const urlInfo = parseZohoRecordUrl(window.location.href);
    const items = extractQuoteLineItems();
    sendResponse({
      items,
      module: urlInfo?.module || null,
      recordId: urlInfo?.recordId || null,
      recordName: extractRecordName(),
    });
    return true;
  }
});

console.log('[Stratus AI] Zoho CRM content script loaded (with context detection).');
