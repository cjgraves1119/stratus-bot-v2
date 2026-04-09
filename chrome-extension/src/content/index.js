/**
 * Stratus AI Chrome Extension — Content Script (Gmail DOM)
 *
 * Runs in the Gmail page context. Responsible for:
 * - Detecting email opens/changes via MutationObserver
 * - Extracting email data from the DOM
 * - Injecting CRM banner above email threads
 * - Highlighting SKUs in email body text
 * - Adding quote button to compose toolbar
 * - Clipboard operations
 */

import { MSG, SKU_PATTERN, DEAL_ID_PATTERN, CONSUMER_DOMAINS, COLORS } from '../lib/constants.js';
import { sendToBackground, onMessage } from '../lib/messaging.js';
import './gmail-observer.js';

// ─────────────────────────────────────────────
// Initialization
// ─────────────────────────────────────────────

console.log('[Stratus AI] Content script loaded on Gmail.');

let lastEmailHash = '';
let settings = null;

// Load settings
async function loadSettings() {
  try {
    settings = await sendToBackground(MSG.GET_SETTINGS);
  } catch {
    settings = { enableSkuHighlighting: true, enableCrmBanner: true, enableComposeButton: true };
  }
}

loadSettings();

// Bot/notification emails — exclude from contact extraction (module-scoped for reuse)
const BOT_EMAILS = new Set([
  'notifications@mixmax.com',
  'notificationsapp@cisco.com',
  'eweichel@cisco.com',
  'noreply@webex.com',
  'noreply@google.com',
  'mailer-daemon@googlemail.com',
  'mailer-daemon@google.com',
  'no-reply@accounts.google.com',
  'no-reply@cisco.com',
  'donotreply@cisco.com',
]);

// ─────────────────────────────────────────────
// Email Detection
// ─────────────────────────────────────────────

/**
 * Extract email data from Gmail's DOM when an email/thread is opened.
 * Gmail's DOM is complex and class names change, so we use multiple strategies.
 */
function extractEmailData() {
  // Strategy 1: URL-based detection
  const hash = window.location.hash;
  // Gmail thread hashes: #inbox/FMfcg..., #sent/FMfcg..., #label/FMfcg..., etc.
  const isThreadView = hash && /^#[a-zA-Z0-9_/]+\/[A-Za-z0-9]+/.test(hash);
  if (!hash || (!isThreadView && !hash.includes('/'))) return null;

  // Strategy 2: Subject line detection (try multiple selectors)
  const subjectEl = document.querySelector('h2.hP')
    || document.querySelector('[data-thread-perm-id] h2')
    || document.querySelector('.ha h2')
    || document.querySelector('[role="main"] h2');
  if (!subjectEl) {
    console.log('[Stratus AI] No subject element found. Selectors tried: h2.hP, [data-thread-perm-id] h2, .ha h2, [role="main"] h2');
    return null;
  }

  const subject = subjectEl.textContent.trim();

  // Strategy 3: Sender info from expanded email header (try multiple selectors)
  const senderEl = document.querySelector('.gD')
    || document.querySelector('[data-hovercard-id]')
    || document.querySelector('.go [email]');
  let senderEmail = '';
  let senderName = '';
  if (senderEl) {
    senderEmail = senderEl.getAttribute('email') || senderEl.getAttribute('data-hovercard-id') || '';
    senderName = senderEl.getAttribute('name') || senderEl.textContent.trim();
  }

  // Get email body (try multiple selectors)
  const bodyEl = document.querySelector('.a3s.aiL')
    || document.querySelector('.ii.gt div')
    || document.querySelector('[data-message-id] .a3s');
  const body = bodyEl ? bodyEl.innerText.substring(0, 8000) : '';

  // Collect all participants with role information
  const allEmails = new Set();
  const allDomains = new Set();
  const threadContacts = [];
  const contactsByEmail = new Map(); // For deduplication while preserving role

  // ── SCOPED THREAD CONTAINER ──
  // Gmail wraps the active thread view in a container. We MUST scope all
  // contact queries to this container, otherwise we pick up email addresses
  // from the inbox list, other collapsed threads, and workspace notifications.
  const threadContainer =
    document.querySelector('[data-thread-perm-id]') ||     // Best: explicit thread wrapper
    document.querySelector('.nH.if') ||                     // Thread view container
    document.querySelector('.AO') ||                        // Fallback: main content area
    document.querySelector('[role="main"]');                 // Last resort

  // If no thread container found, fall back to document but log a warning
  const scopeEl = threadContainer || document;
  if (!threadContainer) {
    console.warn('[Stratus AI] No thread container found — contact extraction may be inaccurate');
  }

  // Helper function to determine role based on DOM context
  function determineRole(element) {
    // Check if element is within a "To:" section
    const toSection = element.closest('[data-tooltip="To"]') ||
                     element.closest('.a8T') ||
                     (element.parentElement?.textContent.includes('To:') ? element.parentElement : null);
    if (toSection) return 'to';

    // Check if element is within a "Cc:" section
    const ccSection = element.closest('[data-tooltip="Cc"]') ||
                     element.closest('.a8T') ||
                     (element.parentElement?.textContent.includes('Cc:') ? element.parentElement : null);
    if (ccSection) return 'cc';

    // Default to sender (elements from email headers without explicit to/cc context)
    return 'sender';
  }

  // BOT_EMAILS is defined at module scope (top of file)

  // Track Cisco rep emails on the thread (cisco.com domain, non-bot)
  const ciscoEmails = [];

  // ── Pass 1: Scoped query within thread container ──
  function collectFromEl(el, defaultRole = 'sender') {
    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    if (lower.includes('@stratusinfosystems.com')) return;
    if (BOT_EMAILS.has(lower)) return;

    allEmails.add(lower);
    const domain = email.split('@')[1];
    if (domain) allDomains.add(domain);

    const name = el.getAttribute('name') || el.textContent.trim();
    const role = el.closest ? (determineRole(el) || defaultRole) : defaultRole;

    if (!contactsByEmail.has(lower)) {
      contactsByEmail.set(lower, { email, name, role });
    } else {
      const existing = contactsByEmail.get(lower);
      const roleMap = { sender: 3, cc: 2, to: 1 };
      if ((roleMap[role] || 0) > (roleMap[existing.role] || 0)) existing.role = role;
      if (name && name.length > (existing.name || '').length) existing.name = name;
    }
    if (domain === 'cisco.com' && !ciscoEmails.includes(lower)) ciscoEmails.push(lower);
  }

  // Broad set of Gmail email-attribute selectors (covers sender chips, recipient chips,
  // To/CC labels, hovercard data) — scoped to thread first
  const EMAIL_SELECTORS = '.gD, .g2, .go, .hb, [email], [data-hovercard-id], .afv [email], .T-I-ax7 [email]';
  scopeEl.querySelectorAll(EMAIL_SELECTORS).forEach(el => collectFromEl(el, 'sender'));

  // ── Pass 2: Broader document scan as fallback ──
  // Gmail thread participants in collapsed messages are often outside the scoped container.
  // Expand by scanning the entire [role="main"] for any element with email attributes.
  const mainEl = document.querySelector('[role="main"]') || document.body;
  mainEl.querySelectorAll('[email], [data-hovercard-id]').forEach(el => {
    const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
    if (!email || !email.includes('@')) return;
    const lower = email.toLowerCase();
    // Skip if already captured
    if (allEmails.has(lower)) return;
    if (lower.includes('@stratusinfosystems.com')) return;
    if (BOT_EMAILS.has(lower)) return;
    // Only include if inside a message view or email header (not inbox row)
    const isInboxRow = el.closest('.zA') || el.closest('.xT') || el.closest('.yX') || el.closest('.aDP');
    if (isInboxRow) return;
    collectFromEl(el, 'cc');
  });

  // ── Pass 3: Look for reply/forward headers in email body ──
  // Gmail often includes "From: Name <email@domain.com>" lines in quoted replies
  document.querySelectorAll('.a3s.aiL, .gs .a3s').forEach(bodyEl => {
    const text = bodyEl.innerText || bodyEl.textContent || '';
    // Match "From: Name <email>" or "To: Name <email>" patterns in quoted text
    const headerPattern = /(?:From|To|Cc|Reply-To):.*?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/gi;
    let m;
    while ((m = headerPattern.exec(text)) !== null) {
      const email = m[1].toLowerCase();
      if (allEmails.has(email)) continue;
      if (email.includes('@stratusinfosystems.com')) continue;
      if (BOT_EMAILS.has(email)) continue;
      const domain = email.split('@')[1] || '';
      if (!domain) continue;
      allEmails.add(email);
      allDomains.add(domain);
      if (!contactsByEmail.has(email)) {
        contactsByEmail.set(email, { email, name: email.split('@')[0], role: 'cc' });
      }
      if (domain === 'cisco.com' && !ciscoEmails.includes(email)) ciscoEmails.push(email);
    }
  });

  // Populate threadContacts — filter consumer domains for CRM lookup
  for (const contact of contactsByEmail.values()) {
    threadContacts.push(contact);
  }

  const isOutbound = senderEmail.toLowerCase().includes('@stratusinfosystems.com');

  // Find customer email (first non-Stratus, non-consumer-domain participant)
  let customerEmail = '';
  let customerName = '';
  let customerDomain = '';
  for (const contact of threadContacts) {
    const domain = contact.email.split('@')[1] || '';
    customerEmail = contact.email;
    customerName = contact.name;
    customerDomain = domain;
    break;
  }

  // CCW Deal ID detection from subject line (Cisco Commerce notification emails)
  // Subject pattern: "CCW Quote #123456789012345" or "Deal ID: 123456789012345"
  let ccwDealNumber = null;
  const ccwSubjectMatch = subject.match(/(?:CCW[^\d]*|Deal\s*(?:ID|Number|#)[:\s#]*|Quote\s*#\s*)(\d{5,20})/i);
  if (ccwSubjectMatch) ccwDealNumber = ccwSubjectMatch[1];

  // Also check if this is a Cisco Commerce notification email
  const isCiscoNotification = senderEmail.toLowerCase() === 'notificationsapp@cisco.com'
    || senderEmail.toLowerCase().includes('@cisco.com');

  return {
    subject,
    body,
    senderEmail,
    senderName,
    customerEmail,
    customerName,
    customerDomain,
    isOutbound,
    allEmails: [...allEmails],
    allDomains: [...allDomains],
    threadContacts,
    ciscoEmails,         // Cisco rep emails detected on thread
    ccwDealNumber,       // CCW Deal ID if detected in subject
    isCiscoNotification, // True for notificationsapp@cisco.com
    url: window.location.href,
    extractedAt: Date.now(),
  };
}

/**
 * Called when we detect an email has been opened/changed.
 */
async function onEmailChanged() {
  const data = extractEmailData();
  if (!data) return;

  // Deduplicate — don't re-process the same email
  const emailHash = `${data.subject}_${data.senderEmail}`;
  if (emailHash === lastEmailHash) return;
  lastEmailHash = emailHash;

  // Notify background service worker
  await sendToBackground(MSG.EMAIL_CHANGED, data).catch(() => {});

  // Auto-CRM lookup for non-consumer domains
  const primaryEmail = (data.isOutbound && data.customerEmail) ? data.customerEmail : data.senderEmail;
  const primaryDomain = primaryEmail ? primaryEmail.split('@')[1] || '' : '';

  if (primaryDomain && !CONSUMER_DOMAINS.has(primaryDomain)) {
    try {
      const crmResult = await sendToBackground(MSG.CRM_LOOKUP, {
        email: primaryEmail,
        domain: primaryDomain,
      });

      if (crmResult && crmResult.found && settings?.enableCrmBanner) {
        injectCrmBanner(crmResult);
      }
    } catch {
      // CRM lookup failure is non-fatal
    }
  }

  // SKU highlighting
  if (settings?.enableSkuHighlighting && data.body) {
    highlightSkusInEmail();
  }

  // Deal ID highlighting (in approval-related emails)
  highlightDealIdsInEmail();
}

// ─────────────────────────────────────────────
// CRM Banner Injection
// ─────────────────────────────────────────────

function injectCrmBanner(crmData) {
  // Remove existing banner
  document.querySelectorAll('.stratus-crm-banner').forEach(el => el.remove());

  const account = crmData.account;
  const contact = crmData.contact;
  if (!account && !contact) return;

  const banner = document.createElement('div');
  banner.className = 'stratus-crm-banner';
  banner.style.cssText = `
    display: flex; align-items: center; gap: 12px; padding: 8px 16px;
    background: ${COLORS.STRATUS_LIGHT}; border: 1px solid ${COLORS.STRATUS_BLUE}33;
    border-radius: 8px; margin: 8px 0; font-family: -apple-system, sans-serif;
    font-size: 13px; color: ${COLORS.TEXT_PRIMARY};
  `;

  const accountName = account?.name || 'Unknown Account';
  const zohoUrl = account?.zohoUrl || '#';
  const contactName = contact?.name || contact?.email || '';
  const contactTitle = contact?.title || '';

  banner.innerHTML = `
    <div style="flex: 1; display: flex; align-items: center; gap: 8px;">
      <span style="font-weight: 600; color: ${COLORS.STRATUS_DARK};">${accountName}</span>
      ${contactName ? `<span style="color: ${COLORS.TEXT_SECONDARY};">|</span>
        <span>${contactName}${contactTitle ? ` (${contactTitle})` : ''}</span>` : ''}
    </div>
    <a href="${zohoUrl}" target="_blank" rel="noopener"
       style="color: ${COLORS.STRATUS_BLUE}; text-decoration: none; font-weight: 500; font-size: 12px;">
      Open in Zoho &rarr;
    </a>
    <button class="stratus-crm-banner-close" style="
      background: none; border: none; cursor: pointer; color: ${COLORS.TEXT_SECONDARY};
      font-size: 16px; padding: 0 4px; line-height: 1;
    ">&times;</button>
  `;

  // Close button
  banner.querySelector('.stratus-crm-banner-close').addEventListener('click', () => {
    banner.remove();
  });

  // Insert above the email content
  const emailContainer = document.querySelector('.nH.if') || document.querySelector('.AO');
  if (emailContainer) {
    emailContainer.insertBefore(banner, emailContainer.firstChild);
  }
}

// ─────────────────────────────────────────────
// SKU Highlighting
// ─────────────────────────────────────────────

function highlightSkusInEmail() {
  const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt div');

  bodyEls.forEach((el) => {
    // Skip if already processed
    if (el.dataset.stratusProcessed) return;
    el.dataset.stratusProcessed = 'true';

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.textContent;
      if (!SKU_PATTERN.test(text)) return;

      // Reset regex lastIndex
      SKU_PATTERN.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = SKU_PATTERN.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        // Create highlighted span
        const span = document.createElement('span');
        span.className = 'stratus-sku-highlight';
        span.textContent = match[0];
        span.dataset.sku = match[0].toUpperCase();
        span.style.cssText = `
          background: ${COLORS.STRATUS_LIGHT}; border: 1px solid ${COLORS.STRATUS_BLUE}44;
          border-radius: 3px; padding: 0 3px; cursor: pointer; font-weight: 500;
        `;

        // Tooltip on hover (async price lookup)
        span.addEventListener('mouseenter', handleSkuHover);
        span.addEventListener('click', handleSkuClick);

        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      node.parentNode.replaceChild(fragment, node);
    });
  });
}

async function handleSkuHover(event) {
  const span = event.target;
  const sku = span.dataset.sku;

  // Show loading tooltip
  let tooltip = document.querySelector('.stratus-sku-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'stratus-sku-tooltip';
    tooltip.style.cssText = `
      position: fixed; z-index: 99999; background: white; border: 1px solid ${COLORS.BORDER};
      border-radius: 8px; padding: 10px 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 12px; font-family: -apple-system, sans-serif; max-width: 280px;
      pointer-events: none;
    `;
    document.body.appendChild(tooltip);
  }

  const rect = span.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 6}px`;
  tooltip.innerHTML = `<div style="color: ${COLORS.TEXT_SECONDARY};">Loading ${sku}...</div>`;
  tooltip.style.display = 'block';

  // Fetch price from background
  try {
    const price = await sendToBackground(MSG.GET_PRICE, { sku });
    if (price) {
      tooltip.innerHTML = `
        <div style="font-weight: 600; color: ${COLORS.STRATUS_DARK}; margin-bottom: 4px;">${sku}</div>
        <div>List: $${price.list?.toLocaleString() || 'N/A'}</div>
        <div>Ecomm: $${price.ecomm?.toLocaleString() || 'N/A'}</div>
        <div style="color: ${COLORS.TEXT_SECONDARY}; margin-top: 4px; font-size: 11px;">Click to add to quote</div>
      `;
    } else {
      tooltip.innerHTML = `
        <div style="font-weight: 600; color: ${COLORS.STRATUS_DARK};">${sku}</div>
        <div style="color: ${COLORS.TEXT_SECONDARY};">Pricing not cached. Click to quote.</div>
      `;
    }
  } catch {
    tooltip.innerHTML = `<div style="font-weight: 600;">${sku}</div>`;
  }

  // Hide tooltip on mouse leave
  span.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  }, { once: true });
}

function handleSkuClick(event) {
  const sku = event.target.dataset.sku;
  // Open sidebar with quote panel pre-filled with this SKU
  sendToBackground(MSG.SIDEBAR_NAVIGATE, { panel: 'quote', data: { skuText: sku } }).catch(() => {});
}

// ─────────────────────────────────────────────
// Deal ID Detection & Highlighting
// ─────────────────────────────────────────────

function highlightDealIdsInEmail() {
  // Only look in approval-related emails
  const subjectEl = document.querySelector('h2.hP');
  const subject = subjectEl?.textContent || '';
  const isDealEmail = /deal|approval|DID|velocity|approved|submitted/i.test(subject);
  if (!isDealEmail) return;

  const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt div');
  bodyEls.forEach((el) => {
    if (el.dataset.stratusDealsProcessed) return;
    el.dataset.stratusDealsProcessed = 'true';

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);

    textNodes.forEach((node) => {
      const text = node.textContent;
      DEAL_ID_PATTERN.lastIndex = 0;
      if (!DEAL_ID_PATTERN.test(text)) return;
      DEAL_ID_PATTERN.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = DEAL_ID_PATTERN.exec(text)) !== null) {
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        const span = document.createElement('span');
        span.className = 'stratus-deal-id-highlight';
        span.textContent = match[0];
        span.dataset.dealId = match[0];
        span.style.cssText = `
          background: #e8f5e9; border: 1px solid #4caf5044;
          border-radius: 3px; padding: 0 3px; cursor: pointer; font-weight: 500;
          color: #2e7d32;
        `;

        span.addEventListener('click', handleDealIdClick);
        span.addEventListener('mouseenter', handleDealIdHover);
        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      node.parentNode.replaceChild(fragment, node);
    });
  });
}

async function handleDealIdHover(event) {
  const span = event.target;
  const dealId = span.dataset.dealId;

  let tooltip = document.querySelector('.stratus-deal-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.className = 'stratus-deal-tooltip';
    tooltip.style.cssText = `
      position: fixed; z-index: 99999; background: white; border: 1px solid ${COLORS.BORDER};
      border-radius: 8px; padding: 10px 14px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      font-size: 12px; font-family: -apple-system, sans-serif; max-width: 280px;
      pointer-events: none;
    `;
    document.body.appendChild(tooltip);
  }

  const rect = span.getBoundingClientRect();
  tooltip.style.left = `${rect.left}px`;
  tooltip.style.top = `${rect.bottom + 6}px`;
  tooltip.innerHTML = `
    <div style="font-weight: 600; color: #2e7d32; margin-bottom: 4px;">Deal ID: ${dealId}</div>
    <div style="color: ${COLORS.TEXT_SECONDARY};">Click to open deal in Zoho</div>
    <div style="color: ${COLORS.TEXT_SECONDARY}; font-size: 11px; margin-top: 2px;">Right-click for Velocity Hub</div>
  `;
  tooltip.style.display = 'block';

  span.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  }, { once: true });
}

function handleDealIdClick(event) {
  const dealId = event.target.dataset.dealId;
  window.open(`https://crm.zoho.com/crm/org647122552/tab/Potentials/${dealId}`, '_blank');
}

// ─────────────────────────────────────────────
// Contact Chip Hover Popups (Gmail thread headers)
// Mirrors the Zoho CRM Chrome extension hover behavior.
// Targets the sender/recipient name chips in email header rows.
// ─────────────────────────────────────────────

// Cache CRM lookups for the current page session
const chipCrmCache = new Map();

function buildAvatarColor(email) {
  // Deterministic color from email
  const colors = ['#1a73e8','#0077b5','#00a67e','#e37400','#9c27b0','#c62828','#2e7d32'];
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = email.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

function showContactChipPopup(anchorEl, email) {
  // Remove any existing chip popup
  document.querySelector('.stratus-chip-popup')?.remove();

  const rawName = anchorEl.getAttribute('name') || anchorEl.textContent.trim() || '';
  const displayName = rawName || email.split('@')[0];
  const domain = email.split('@')[1] || '';
  const avatarColor = buildAvatarColor(email);
  const avatarLetter = (displayName[0] || '?').toUpperCase();

  const popup = document.createElement('div');
  popup.className = 'stratus-chip-popup';
  popup.style.cssText = `
    position: fixed; z-index: 2147483646; background: white;
    border: 1px solid #dadce0; border-radius: 8px;
    box-shadow: 0 2px 16px rgba(60,64,67,0.2), 0 1px 4px rgba(60,64,67,0.15);
    font-family: 'Google Sans', -apple-system, sans-serif;
    width: 248px; overflow: hidden; pointer-events: auto;
    animation: stratusChipIn 0.15s ease;
  `;

  popup.innerHTML = `
    <div style="padding:14px 16px 10px;display:flex;align-items:center;gap:12px;">
      <div style="
        width:40px;height:40px;border-radius:50%;flex-shrink:0;
        background:${avatarColor};color:white;
        display:flex;align-items:center;justify-content:center;
        font-size:18px;font-weight:500;
      ">${avatarLetter}</div>
      <div style="min-width:0;flex:1;">
        <div style="font-size:14px;font-weight:500;color:#202124;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${displayName}</div>
        <div style="font-size:12px;color:#5f6368;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${email}</div>
      </div>
    </div>
    <div class="chip-crm-info" style="padding:0 16px 10px;min-height:20px;font-size:12px;color:#5f6368;">
      <span class="chip-loading" style="color:#5f6368;">Checking Zoho CRM…</span>
    </div>
    <div style="padding:0 12px 12px;">
      <button class="chip-open-btn" style="
        width:100%;padding:8px;border:none;border-radius:6px;
        background:#1a73e8;color:white;font-size:13px;font-weight:500;
        cursor:pointer;letter-spacing:0.01em;
      ">Search in Zoho CRM</button>
    </div>
  `;

  // Position below anchor, avoid viewport overflow
  const rect = anchorEl.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 264));
  const top = rect.bottom + 4;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  document.body.appendChild(popup);

  // Keep popup open while hovering it or the anchor
  let leaveTimer = null;
  function scheduleClose() {
    leaveTimer = setTimeout(() => popup.remove(), 250);
  }
  function cancelClose() {
    if (leaveTimer) clearTimeout(leaveTimer);
  }
  anchorEl.addEventListener('mouseleave', scheduleClose);
  popup.addEventListener('mouseenter', cancelClose);
  popup.addEventListener('mouseleave', scheduleClose);

  // "Search in Zoho CRM" / "Open in Stratus AI" button
  popup.querySelector('.chip-open-btn').addEventListener('click', () => {
    popup.remove();
    // Tell background to open the side panel + navigate to CRM tab with this email
    chrome.runtime.sendMessage({
      type: MSG.SIDEBAR_NAVIGATE,
      panel: 'crm',
      data: { preloadEmail: email },
      openPanel: true,
    }, () => {});
  });

  // CRM lookup (use cache to avoid re-querying same email)
  const crmInfoEl = popup.querySelector('.chip-crm-info');
  if (chipCrmCache.has(email)) {
    renderChipCrmInfo(crmInfoEl, chipCrmCache.get(email), email, domain);
  } else if (!CONSUMER_DOMAINS.has(domain)) {
    sendToBackground(MSG.CRM_LOOKUP, { email, domain })
      .then(result => {
        chipCrmCache.set(email, result);
        if (crmInfoEl.parentNode) renderChipCrmInfo(crmInfoEl, result, email, domain);
      })
      .catch(() => {
        if (crmInfoEl.parentNode) crmInfoEl.innerHTML = '';
      });
  } else {
    // Consumer domain — still show the button but no CRM info
    crmInfoEl.innerHTML = '';
    popup.querySelector('.chip-open-btn').textContent = 'Look up in Stratus AI';
  }

  return popup;
}

function renderChipCrmInfo(el, result, email, domain) {
  if (!result || !result.found) {
    el.innerHTML = `<span style="color:#80868b;font-size:11px;">Not in Zoho CRM</span>`;
    return;
  }
  const acc = result.account;
  const con = result.contact;
  let html = '';
  if (acc?.name) {
    html += `<div style="font-weight:500;color:#202124;margin-bottom:1px;">${acc.name}</div>`;
  }
  if (con?.title) {
    html += `<div style="color:#5f6368;">${con.title}</div>`;
  }
  if (con?.phone) {
    html += `<div style="color:#5f6368;">${con.phone}</div>`;
  }
  if (!html) html = `<div style="color:#2e7d32;font-size:11px;">✓ Found in Zoho CRM</div>`;
  el.innerHTML = html;
}

function attachChipHover(el) {
  if (el.dataset.stratusChipAttached) return;
  const email = el.getAttribute('email') || el.getAttribute('data-hovercard-id') || '';
  if (!email || !email.includes('@') || !email.includes('.')) return;
  if (email.toLowerCase().includes('@stratusinfosystems.com')) return;
  if (BOT_EMAILS.has(email.toLowerCase())) return;

  el.dataset.stratusChipAttached = 'true';

  let hoverTimer = null;
  el.addEventListener('mouseenter', () => {
    hoverTimer = setTimeout(() => {
      showContactChipPopup(el, email.toLowerCase());
    }, 180); // Short delay — snappy but not jittery
  });
  el.addEventListener('mouseleave', () => {
    if (hoverTimer) clearTimeout(hoverTimer);
  });
}

function setupContactChipHovers() {
  // Gmail chip selectors — sender (.gD), To/Cc recipients (.g2), avatar hover targets
  const CHIP_SEL = '.gD[email], .g2[email], .go[email], [data-hovercard-id*="@"]';

  // Attach to chips already in DOM
  document.querySelectorAll(CHIP_SEL).forEach(attachChipHover);

  // Watch for chips added by Gmail's SPA rendering (debounced 200ms)
  let _chipTimer = null;
  const chipObserver = new MutationObserver(() => {
    if (_chipTimer) clearTimeout(_chipTimer);
    _chipTimer = setTimeout(() => {
      _chipTimer = null;
      document.querySelectorAll(CHIP_SEL).forEach(attachChipHover);
    }, 200);
  });
  chipObserver.observe(document.body, { childList: true, subtree: true, attributeFilter: ['email', 'data-hovercard-id'] });
}

// ─────────────────────────────────────────────
// Email Address Hover Popups
// ─────────────────────────────────────────────

function setupEmailHoverPopups() {
  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const bodyEls = document.querySelectorAll('.a3s.aiL, .ii.gt div');

  bodyEls.forEach((el) => {
    // Skip if already processed
    if (el.dataset.stratusEmailHoverProcessed) return;
    el.dataset.stratusEmailHoverProcessed = 'true';

    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    const textNodes = [];
    while (walker.nextNode()) {
      textNodes.push(walker.currentNode);
    }

    textNodes.forEach((node) => {
      const text = node.textContent;
      if (!emailPattern.test(text)) {
        emailPattern.lastIndex = 0;
        return;
      }

      // Reset regex lastIndex
      emailPattern.lastIndex = 0;

      const fragment = document.createDocumentFragment();
      let lastIndex = 0;
      let match;

      while ((match = emailPattern.exec(text)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          fragment.appendChild(document.createTextNode(text.substring(lastIndex, match.index)));
        }

        // Create email span wrapper
        const span = document.createElement('span');
        span.className = 'stratus-email-address';
        span.textContent = match[0];
        span.dataset.email = match[0].toLowerCase();
        span.style.cssText = `
          color: ${COLORS.STRATUS_BLUE}; text-decoration: underline; cursor: pointer;
          position: relative; padding: 0 2px;
        `;

        // Hover popup on mouseenter
        span.addEventListener('mouseenter', async (e) => {
          const email = e.target.getAttribute('data-email');
          const domain = email.split('@')[1];

          // Skip consumer domains
          if (CONSUMER_DOMAINS.has(domain)) {
            return;
          }

          // Show loading popup
          let popup = document.querySelector('.stratus-email-popup');
          if (!popup) {
            popup = document.createElement('div');
            popup.className = 'stratus-email-popup';
            popup.style.cssText = `
              position: fixed; background: white; border: 1px solid ${COLORS.BORDER};
              border-radius: 8px; padding: 12px 14px; font-size: 12px;
              font-family: -apple-system, sans-serif; z-index: 9999;
              box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 280px;
            `;
            document.body.appendChild(popup);
          }

          popup.innerHTML = `<div style="color: ${COLORS.TEXT_SECONDARY};">Looking up ${email}...</div>`;

          // Position near cursor
          const rect = e.target.getBoundingClientRect();
          popup.style.left = (rect.left + 10) + 'px';
          popup.style.top = (rect.bottom + 5) + 'px';
          popup.style.display = 'block';

          try {
            // Lookup CRM data for this email
            const crmResult = await sendToBackground(MSG.CRM_LOOKUP, { email, domain });

            if (crmResult && crmResult.found) {
              const account = crmResult.account;
              const contact = crmResult.contact;
              const accountName = account?.name || 'Unknown Account';
              const contactName = contact?.name || contact?.email || email;
              const contactTitle = contact?.title || '';
              const accountZoho = account?.zohoUrl || '#';

              popup.innerHTML = `
                <div style="margin-bottom: 8px;">
                  <div style="font-weight: 600; color: ${COLORS.TEXT_PRIMARY}; margin-bottom: 4px;">
                    ${accountName}
                  </div>
                  <div style="color: ${COLORS.TEXT_SECONDARY}; font-size: 11px;">
                    ${contactName}${contactTitle ? ` • ${contactTitle}` : ''}
                  </div>
                </div>
                <a href="${accountZoho}" target="_blank" rel="noopener"
                   style="color: ${COLORS.STRATUS_BLUE}; text-decoration: none; font-size: 11px; font-weight: 500;">
                  View in Zoho →
                </a>
              `;
            } else {
              popup.innerHTML = `<div style="color: ${COLORS.TEXT_SECONDARY};">No CRM record for ${email}</div>`;
            }
          } catch (err) {
            popup.innerHTML = `<div style="color: ${COLORS.ERROR}; font-size: 11px;">Lookup failed</div>`;
          }
        });

        // Hide popup on mouseleave
        span.addEventListener('mouseleave', () => {
          const popup = document.querySelector('.stratus-email-popup');
          if (popup) popup.style.display = 'none';
        });

        fragment.appendChild(span);
        lastIndex = match.index + match[0].length;
      }

      // Add remaining text
      if (lastIndex < text.length) {
        fragment.appendChild(document.createTextNode(text.substring(lastIndex)));
      }

      node.parentNode.replaceChild(fragment, node);
    });
  });
}

// ─────────────────────────────────────────────
// Compose Toolbar Button
// ─────────────────────────────────────────────

function getComposeRecipients(composeEl) {
  // Extract recipient emails from the compose To/Cc/Bcc fields ONLY (not thread body)
  const recipients = new Set();

  // Priority 1: Gmail compose chip elements with [email] attribute in To/Cc/Bcc containers
  // These are the actual recipient chips, not thread participant hover cards
  const chipSelectors = [
    'div[name="to"] span[email]',
    'div[name="cc"] span[email]',
    'div[name="bcc"] span[email]',
    '.aoD span[email]',            // Reply-to chip container
    '.GG span[email]',             // Compose To field chips
    '.wO span[email]',             // Another To field variant
  ];
  chipSelectors.forEach(sel => {
    composeEl.querySelectorAll(sel).forEach(el => {
      const email = el.getAttribute('email') || '';
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });
  });

  // Priority 2: Hidden/text inputs for To/Cc/Bcc
  const toInput = composeEl.querySelector('input[aria-label*="To"], textarea[aria-label*="To"]');
  if (toInput && toInput.value) {
    toInput.value.split(/[,;]/).forEach(e => {
      const trimmed = e.trim().replace(/.*<(.+)>/, '$1');
      if (trimmed.includes('@')) recipients.add(trimmed.toLowerCase());
    });
  }

  // Priority 3: Fallback to broader [data-hovercard-id] only if nothing found above
  // (avoids picking up thread participants like mixmax, automated senders, etc.)
  if (recipients.size === 0) {
    composeEl.querySelectorAll('[data-hovercard-id], [email]').forEach(el => {
      const email = el.getAttribute('data-hovercard-id') || el.getAttribute('email') || '';
      if (email && email.includes('@')) recipients.add(email.toLowerCase());
    });
  }

  return [...recipients].filter(e => !e.includes('@stratusinfosystems.com'));
}

function getComposeSubject(composeEl) {
  const subjectInput = composeEl.querySelector('input[aria-label*="Subject"], input[name="subjectbox"]')
    || document.querySelector('.aoT'); // Gmail subject field
  return subjectInput?.value || '';
}

/**
 * Extract the original/quoted email from a Gmail compose window.
 * Gmail wraps the quoted text in a div.gmail_quote inside the compose body.
 * Also extracts sender info from the "On [date], [name] <email> wrote:" line.
 */
function getComposeQuotedEmail(composeEl) {
  const bodyEl = composeEl.querySelector('[role="textbox"][aria-label*="Body"], div[aria-label*="Message Body"], .Am.Al.editable');
  if (!bodyEl) return { body: '', senderEmail: '', senderName: '' };

  // Try gmail_quote first (standard reply format)
  const quoteEl = bodyEl.querySelector('.gmail_quote');
  let quotedBody = '';
  let senderEmail = '';
  let senderName = '';

  if (quoteEl) {
    quotedBody = quoteEl.innerText.substring(0, 8000);
    // Parse "On Mon, Apr 7, 2026 at 10:30 AM Sharon Halnyj <shalnyj@fitzfinishing.com> wrote:"
    const quoteHeader = quoteEl.previousElementSibling?.textContent || quoteEl.textContent.split('\n')[0] || '';
    const wroteMatch = quoteHeader.match(/([^<]+)<([^>]+)>\s*wrote/i);
    if (wroteMatch) {
      senderName = wroteMatch[1].trim().replace(/^.*?,\s*/, '').replace(/\s+at\s+.*/, '').trim();
      senderEmail = wroteMatch[2].trim();
    }
  }

  // Fallback: if no gmail_quote, look for the "--- Forwarded message ---" or "------" separator
  if (!quotedBody) {
    const fullText = bodyEl.innerText || '';
    const separators = [
      /^-+\s*Forwarded message\s*-+$/m,
      /^On\s.+wrote:$/m,
      /^>{1,}/m,
    ];
    for (const sep of separators) {
      const match = fullText.match(sep);
      if (match) {
        quotedBody = fullText.substring(match.index).substring(0, 8000);
        break;
      }
    }
  }

  // If we still don't have sender info, try the compose recipients (they ARE the original sender in a reply)
  if (!senderEmail) {
    const recipients = getComposeRecipients(composeEl);
    if (recipients.length > 0) senderEmail = recipients[0];
  }

  // Try to get sender name from recipient chip
  if (!senderName && senderEmail) {
    const chipEl = composeEl.querySelector(`span[email="${senderEmail}"]`);
    if (chipEl) {
      senderName = chipEl.getAttribute('name') || chipEl.textContent.trim();
    }
  }

  return { body: quotedBody, senderEmail, senderName };
}

/**
 * Show inline draft reply popup attached to a compose window.
 * Self-contained — no sidebar dependency.
 */
function showComposeDraftPopup(composeEl, drafts, subject) {
  // Remove existing popup
  document.querySelector('.stratus-draft-popup')?.remove();

  const popup = document.createElement('div');
  popup.className = 'stratus-draft-popup';
  popup.style.cssText = `
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    z-index: 99999; background: white; border-radius: 12px;
    box-shadow: 0 8px 40px rgba(0,0,0,0.25), 0 2px 8px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 540px; width: 90vw; max-height: 80vh; overflow-y: auto;
    border: 1px solid #e0e0e0; animation: stratusSlideIn 0.2s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = '@keyframes stratusSlideIn { from { opacity:0; transform:translate(-50%,-50%) translateY(16px); } to { opacity:1; transform:translate(-50%,-50%) translateY(0); } }';
    document.head.appendChild(style);
  }

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; gap: 10px; padding: 16px 20px;
    border-bottom: 1px solid #e8e8e8; background: #f8f9fa; border-radius: 12px 12px 0 0;
  `;
  header.innerHTML = `
    <div style="width:36px;height:36px;border-radius:50%;background:${COLORS.STRATUS_BLUE};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:16px;">S</div>
    <div>
      <div style="font-weight:600;font-size:14px;color:#202124;">Choose a Draft</div>
      <div style="font-size:12px;color:#5f6368;">Select the reply you prefer</div>
    </div>
    <div style="margin-left:auto;cursor:pointer;font-size:20px;color:#5f6368;padding:4px 8px;" class="stp-close">✕</div>
  `;
  popup.appendChild(header);

  // Draft options
  drafts.forEach((draft, i) => {
    const draftBody = typeof draft === 'string' ? draft : (draft.body || draft.text || '');
    const section = document.createElement('div');
    section.style.cssText = `padding: 16px 20px; ${i > 0 ? 'border-top: 1px solid #e8e8e8;' : ''}`;

    const label = document.createElement('div');
    label.style.cssText = 'font-size: 12px; color: #5f6368; margin-bottom: 8px; font-weight: 500;';
    label.textContent = `Option ${i + 1}`;
    section.appendChild(label);

    const preview = document.createElement('div');
    preview.style.cssText = 'font-size: 13px; color: #202124; line-height: 1.5; margin-bottom: 10px; white-space: pre-wrap;';
    preview.textContent = draftBody.length > 400 ? draftBody.substring(0, 400) + '…' : draftBody;
    section.appendChild(preview);

    const useBtn = document.createElement('button');
    useBtn.style.cssText = `
      padding: 8px 16px; background: ${COLORS.STRATUS_BLUE}; color: white;
      border: none; border-radius: 8px; font-size: 12px; font-weight: 600;
      cursor: pointer; transition: background 0.2s;
    `;
    useBtn.textContent = `Use Option ${i + 1}`;
    useBtn.addEventListener('mouseenter', () => { useBtn.style.background = COLORS.STRATUS_DARK; });
    useBtn.addEventListener('mouseleave', () => { useBtn.style.background = COLORS.STRATUS_BLUE; });
    useBtn.addEventListener('click', () => {
      // Insert draft into compose body
      const bodyInput = composeEl.querySelector('[role="textbox"][aria-label*="Body"], div[aria-label*="Message Body"], .Am.Al.editable');
      if (bodyInput) {
        // Preserve the quoted email — insert draft BEFORE the quote
        const quoteEl = bodyInput.querySelector('.gmail_quote');
        if (quoteEl) {
          const draftNode = document.createElement('div');
          draftNode.innerHTML = draftBody.replace(/\n/g, '<br>');
          draftNode.innerHTML += '<br>';
          bodyInput.insertBefore(draftNode, quoteEl);
        } else {
          // No quote — just set the body
          bodyInput.innerHTML = draftBody.replace(/\n/g, '<br>') + (bodyInput.innerHTML || '');
        }
        bodyInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      popup.remove();
      overlay.remove();
    });
    section.appendChild(useBtn);
    popup.appendChild(section);
  });

  // Back/close button
  const footer = document.createElement('div');
  footer.style.cssText = 'padding: 12px 20px; border-top: 1px solid #e8e8e8; text-align: center;';
  const backBtn = document.createElement('button');
  backBtn.style.cssText = `
    padding: 8px 20px; background: transparent; border: 1px solid #dadce0;
    border-radius: 8px; font-size: 12px; cursor: pointer; color: ${COLORS.STRATUS_BLUE};
    font-weight: 500;
  `;
  backBtn.textContent = '← Back';
  backBtn.addEventListener('click', () => { popup.remove(); overlay.remove(); });
  footer.appendChild(backBtn);
  popup.appendChild(footer);

  // Overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.3);z-index:99998;';
  overlay.addEventListener('click', () => { popup.remove(); overlay.remove(); });

  // Close button handler
  popup.querySelector('.stp-close').addEventListener('click', () => { popup.remove(); overlay.remove(); });

  document.body.appendChild(overlay);
  document.body.appendChild(popup);
}

function injectComposeButton(composeEl) {
  // Check if already injected
  if (composeEl.querySelector('.stratus-compose-btn')) return;

  const toolbar = composeEl.querySelector('.btC') || composeEl.querySelector('[role="toolbar"]');
  if (!toolbar) return;

  // ── Send + Update Task button (injected FIRST so S button can be placed before it) ──
  const sendTaskBtn = document.createElement('div');
  sendTaskBtn.className = 'stratus-send-task-btn';
  sendTaskBtn.title = 'Send email and update related Zoho task';
  sendTaskBtn.style.cssText = `
    display: inline-flex; align-items: center; gap: 4px; padding: 0 10px;
    height: 32px; border-radius: 16px; cursor: pointer;
    background: #1a73a7; color: white; font-size: 11px;
    font-weight: 600; margin-left: 6px; transition: background 0.2s;
    white-space: nowrap; border: none; position: relative; z-index: 10;
    user-select: none; -webkit-user-select: none;
  `;
  sendTaskBtn.innerHTML = '📋 Send + Task';
  sendTaskBtn.addEventListener('mouseenter', () => { if (!sendTaskBtn._busy) sendTaskBtn.style.background = '#0d4f73'; });
  sendTaskBtn.addEventListener('mouseleave', () => { if (!sendTaskBtn._busy) sendTaskBtn.style.background = '#1a73a7'; });

  sendTaskBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    e.preventDefault();

    // Prevent double-clicks
    if (sendTaskBtn._busy) return;
    sendTaskBtn._busy = true;

    // ── Immediate visual feedback ──
    const originalHTML = sendTaskBtn.innerHTML;
    sendTaskBtn.innerHTML = '⏳ Sending...';
    sendTaskBtn.style.background = '#0d4f73';
    sendTaskBtn.style.pointerEvents = 'none';

    try {
      // 1. Wake up background service worker with a ping first
      try {
        await sendToBackground(MSG.GET_SETTINGS);
      } catch {
        // If background is dormant, try to open sidebar to wake it up
        console.log('[Stratus] Background unreachable, attempting sidebar open to wake service worker...');
        try {
          await chrome.runtime.sendMessage({ type: MSG.SIDEBAR_NAVIGATE, panel: 'zoho', openPanel: true });
          await new Promise(r => setTimeout(r, 500)); // Give sidebar time to initialize
        } catch (sidebarErr) {
          console.warn('[Stratus] Could not wake service worker:', sidebarErr);
        }
      }

      // 2. Capture compose data BEFORE sending
      const recipients = getComposeRecipients(composeEl);
      const subject = getComposeSubject(composeEl);

      // 3. Click Gmail's native Send button (expanded selector list for Gmail DOM variations)
      const sendButton = composeEl.querySelector('[data-tooltip="Send"]')
        || composeEl.querySelector('[data-tooltip="Send ‪(⌘Enter)‬"]')
        || composeEl.querySelector('[data-tooltip="Send ‪(Ctrl-Enter)‬"]')
        || composeEl.querySelector('.aoO[role="button"]')
        || composeEl.querySelector('div[aria-label="Send"]')
        || composeEl.querySelector('div[aria-label*="Send "]')
        || composeEl.querySelector('.T-I.J-J5-Ji.aoO.T-I-atl.L3')
        || composeEl.querySelector('[aria-label="Send ‪(Ctrl-Enter)‬"]');

      if (sendButton) {
        sendButton.click();
      } else {
        // Fallback: use keyboard shortcut Ctrl+Enter / Cmd+Enter to send
        console.warn('[Stratus] Send button not found, attempting keyboard shortcut');
        const composeBody = composeEl.querySelector('[role="textbox"][aria-label*="Body"], div[aria-label*="Message Body"]');
        if (composeBody) {
          composeBody.focus();
          composeBody.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, metaKey: true, bubbles: true }));
        }
      }

      sendTaskBtn.innerHTML = '✓ Sent! Checking tasks...';

      // 4. Wait for send to complete, then check for related tasks
      await new Promise(r => setTimeout(r, 1500));

      try {
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: recipients.map(r => r.split('@')[1]).filter(Boolean),
          emails: recipients,
        });
        const tasks = taskResult?.tasks || [];
        if (tasks.length > 0) {
          showSendTaskPopup(tasks, recipients, subject);
        } else {
          // Show a brief "no tasks" confirmation so user knows it worked
          showSendConfirmation('Email sent! No open Zoho tasks found for ' + (recipients[0] || 'this contact') + '.');
        }
      } catch (taskErr) {
        console.warn('[Stratus] Task fetch error:', taskErr);
        showSendConfirmation('Email sent! Could not check tasks: ' + (taskErr.message || 'connection error'));
      }
    } catch (outerErr) {
      console.error('[Stratus] Send+Task error:', outerErr);
      sendTaskBtn.innerHTML = '❌ Error';
      sendTaskBtn.style.background = '#d93025';
      setTimeout(() => {
        sendTaskBtn.innerHTML = originalHTML;
        sendTaskBtn.style.background = '#1a73a7';
        sendTaskBtn.style.pointerEvents = '';
        sendTaskBtn._busy = false;
      }, 2000);
      return;
    }

    // Reset button state after a delay (compose may already be gone)
    setTimeout(() => {
      try {
        sendTaskBtn.innerHTML = originalHTML;
        sendTaskBtn.style.background = '#1a73a7';
        sendTaskBtn.style.pointerEvents = '';
        sendTaskBtn._busy = false;
      } catch { /* compose already removed from DOM */ }
    }, 3000);
  });

  // ── Stratus AI button (self-contained draft reply, no sidebar dependency) ──
  const btn = document.createElement('div');
  btn.className = 'stratus-compose-btn';
  btn.title = 'Generate AI Draft Reply';
  btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
    background: ${COLORS.STRATUS_BLUE}; color: white; font-size: 14px;
    font-weight: 700; margin-left: 6px; transition: background 0.2s;
    position: relative; z-index: 10;
  `;
  btn.textContent = 'S';
  btn.addEventListener('mouseenter', () => { if (!btn._busy) btn.style.background = COLORS.STRATUS_DARK; });
  btn.addEventListener('mouseleave', () => { if (!btn._busy) btn.style.background = COLORS.STRATUS_BLUE; });
  btn.addEventListener('click', async () => {
    if (btn._busy) return;
    btn._busy = true;
    btn.textContent = '…';
    btn.style.background = COLORS.STRATUS_DARK;
    btn.style.cursor = 'default';

    try {
      // Extract email context directly from the compose window
      const subject = getComposeSubject(composeEl);
      const { body, senderEmail, senderName } = getComposeQuotedEmail(composeEl);

      if (!senderEmail && !body) {
        // Fallback: try extracting from the thread behind the compose
        const threadData = extractEmailData();
        if (threadData) {
          const result = await sendToBackground(MSG.DRAFT_REPLY, {
            subject: threadData.subject || subject,
            body: threadData.body || '',
            senderEmail: threadData.customerEmail || threadData.senderEmail || '',
            senderName: threadData.senderName || '',
            tone: 'warm',
            instructions: '',
          });
          if (result?.drafts?.length) {
            showComposeDraftPopup(composeEl, result.drafts, subject);
          } else {
            showSendConfirmation('Could not generate drafts. Try the sidebar instead.');
          }
          return;
        }
        showSendConfirmation('No email context found. Open an email thread and reply to use this feature.');
        return;
      }

      // Call draft reply API directly (bypasses sidebar entirely)
      const result = await sendToBackground(MSG.DRAFT_REPLY, {
        subject,
        body,
        senderEmail,
        senderName,
        tone: 'warm',
        instructions: '',
      });

      if (result?.drafts?.length) {
        showComposeDraftPopup(composeEl, result.drafts, subject);
      } else if (result?.draft) {
        showComposeDraftPopup(composeEl, [result.draft], subject);
      } else {
        showSendConfirmation('No drafts generated. Check the email context and try again.');
      }
    } catch (err) {
      console.error('[Stratus] Draft reply error:', err);
      showSendConfirmation('Draft failed: ' + (err.message || 'connection error'));
    } finally {
      btn.textContent = 'S';
      btn.style.background = COLORS.STRATUS_BLUE;
      btn.style.cursor = 'pointer';
      btn._busy = false;
    }
  });

  // Append both buttons: S first, then Send+Task (right-side group)
  toolbar.appendChild(btn);
  toolbar.appendChild(sendTaskBtn);
}

// ─────────────────────────────────────────────
// Brief confirmation toast (email sent, no tasks found)
// ─────────────────────────────────────────────

function showSendConfirmation(message) {
  // Remove any existing popup/toast
  document.querySelector('.stratus-send-task-popup')?.remove();
  document.querySelector('.stratus-send-confirm')?.remove();

  const toast = document.createElement('div');
  toast.className = 'stratus-send-confirm';
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    background: white; border-radius: 12px; padding: 14px 18px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 320px; min-width: 240px; border: 1px solid #e0e0e0;
    animation: stratusSlideIn 0.25s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = `@keyframes stratusSlideIn { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }`;
    document.head.appendChild(style);
  }

  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:18px;">✅</span>
      <span style="font-size:13px;color:#1a1a1a;">${message}</span>
    </div>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}

// ─────────────────────────────────────────────
// Send + Task Confirmation Popup
// ─────────────────────────────────────────────

function showSendTaskPopup(tasks, recipients, subject) {
  // Remove any existing popup
  document.querySelector('.stratus-send-task-popup')?.remove();

  const task = tasks[0]; // Focus on the most relevant task
  const popup = document.createElement('div');
  popup.className = 'stratus-send-task-popup';

  const dueDate = task.dueDate || '';
  const isOverdue = dueDate && new Date(dueDate) < new Date();
  const dealInfo = task.dealName ? `<div style="font-size:11px;color:#5f6368;margin-top:2px;">Deal: ${task.dealName}</div>` : '';
  const otherCount = tasks.length > 1 ? `<div style="font-size:11px;color:#5f6368;margin-top:4px;">+ ${tasks.length - 1} other task${tasks.length > 1 ? 's' : ''}</div>` : '';

  popup.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 99999;
    background: white; border-radius: 12px; padding: 16px 18px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 6px rgba(0,0,0,0.1);
    font-family: -apple-system, BlinkMacSystemFont, 'Google Sans', sans-serif;
    max-width: 320px; min-width: 280px; border: 1px solid #e0e0e0;
    animation: stratusSlideIn 0.25s ease;
  `;

  // Inject keyframe if needed
  if (!document.querySelector('#stratus-popup-style')) {
    const style = document.createElement('style');
    style.id = 'stratus-popup-style';
    style.textContent = `
      @keyframes stratusSlideIn {
        from { opacity: 0; transform: translateY(16px); }
        to   { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }

  popup.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
      <div style="font-size:13px;font-weight:700;color:#1a1a1a;">📋 Email Sent — Update Task?</div>
      <button class="stp-close" style="background:none;border:none;cursor:pointer;color:#5f6368;font-size:18px;padding:0 2px;line-height:1;">×</button>
    </div>
    <div style="background:#f8f9fa;border-radius:8px;padding:10px 12px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:600;color:#1a1a1a;">${task.subject || 'Follow-up Task'}</div>
      <div style="font-size:11px;color:${isOverdue ? '#d93025' : '#5f6368'};margin-top:2px;">
        Due: ${dueDate || 'No date'}${isOverdue ? ' ⚠️ Overdue' : ''}
      </div>
      ${dealInfo}
      ${otherCount}
    </div>
    <div style="display:flex;flex-direction:column;gap:7px;">
      <button class="stp-complete" style="
        padding:9px 14px;background:#1a73e8;color:white;border:none;border-radius:8px;
        font-size:12px;font-weight:600;cursor:pointer;text-align:left;
      ">✓ Complete + Add Follow-Up (3 days)</button>
      <button class="stp-extend" style="
        padding:9px 14px;background:transparent;color:#1a73e8;
        border:1px solid #1a73e8;border-radius:8px;font-size:12px;
        font-weight:600;cursor:pointer;text-align:left;
      ">📅 Extend Due Date +3 Days</button>
      <button class="stp-dismiss" style="
        padding:7px 14px;background:transparent;color:#5f6368;
        border:1px solid #e0e0e0;border-radius:8px;font-size:12px;
        cursor:pointer;text-align:left;
      ">Dismiss</button>
    </div>
    <div class="stp-status" style="margin-top:10px;font-size:11px;color:#5f6368;display:none;"></div>
  `;

  document.body.appendChild(popup);

  // Auto-dismiss after 30 seconds
  const autoDismiss = setTimeout(() => popup.remove(), 30000);

  function setStatus(msg, isError = false) {
    const el = popup.querySelector('.stp-status');
    el.textContent = msg;
    el.style.color = isError ? '#d93025' : '#137333';
    el.style.display = 'block';
  }

  function disableButtons() {
    popup.querySelectorAll('button:not(.stp-close)').forEach(b => {
      b.disabled = true;
      b.style.opacity = '0.5';
    });
  }

  popup.querySelector('.stp-close').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-dismiss').addEventListener('click', () => {
    clearTimeout(autoDismiss);
    popup.remove();
  });

  popup.querySelector('.stp-complete').addEventListener('click', async () => {
    disableButtons();
    setStatus('Completing task...');
    try {
      await sendToBackground(MSG.TASK_ACTION, {
        action: 'complete_and_followup',
        taskId: task.id,
        dealId: task.dealId || '',
        contactId: task.contactId || '',
        newSubject: `Follow up: ${task.subject}`,
      });
      setStatus('✓ Task completed. Follow-up created.');
      setTimeout(() => { clearTimeout(autoDismiss); popup.remove(); }, 2500);
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    }
  });

  popup.querySelector('.stp-extend').addEventListener('click', async () => {
    disableButtons();
    setStatus('Rescheduling...');
    try {
      const newDate = addDays(3);
      await sendToBackground(MSG.TASK_ACTION, {
        action: 'reschedule',
        taskId: task.id,
        newDueDate: newDate,
      });
      setStatus(`✓ Due date moved to ${newDate}`);
      setTimeout(() => { clearTimeout(autoDismiss); popup.remove(); }, 2500);
    } catch (err) {
      setStatus('Error: ' + err.message, true);
    }
  });
}

function addDays(days) {
  let d = new Date();
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    if (d.getDay() !== 0 && d.getDay() !== 6) added++;
  }
  return d.toISOString().split('T')[0];
}

// ─────────────────────────────────────────────
// MutationObserver for Gmail SPA
// ─────────────────────────────────────────────

// Debounce helper — batches rapid MutationObserver fires into one call
let _emailChangeTimer = null;
let _composeCheckTimer = null;

function checkForEmailView() {
  // Strategy 1: Check for subject line (most reliable indicator of email open)
  const subjectEl = document.querySelector('h2.hP') || document.querySelector('[data-thread-perm-id] h2');
  if (subjectEl) {
    if (_emailChangeTimer) clearTimeout(_emailChangeTimer);
    _emailChangeTimer = setTimeout(() => {
      _emailChangeTimer = null;
      onEmailChanged();
    }, 250); // Slightly longer debounce for reliability
  }
}

const observer = new MutationObserver((mutations) => {
  checkForEmailView();

  // Debounced compose button injection (300ms)
  if (settings?.enableComposeButton) {
    if (_composeCheckTimer) clearTimeout(_composeCheckTimer);
    _composeCheckTimer = setTimeout(() => {
      _composeCheckTimer = null;
      document.querySelectorAll('.T-I.J-J5-Ji').forEach((el) => {
        const composeContainer = el.closest('.nH');
        if (composeContainer) {
          injectComposeButton(composeContainer);
        }
      });
    }, 300);
  }
});

// Start observing Gmail DOM — observe attributes too for Gmail SPA transitions
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ['class', 'style', 'aria-hidden'],
  characterData: false,
});

// Inject popup animation CSS once
(function injectPopupStyles() {
  if (document.getElementById('stratus-chip-styles')) return;
  const style = document.createElement('style');
  style.id = 'stratus-chip-styles';
  style.textContent = `
    @keyframes stratusChipIn {
      from { opacity: 0; transform: translateY(-4px) scale(0.97); }
      to   { opacity: 1; transform: translateY(0) scale(1); }
    }
    .stratus-chip-popup button.chip-open-btn:hover {
      background: #1558b0 !important;
    }
  `;
  document.head.appendChild(style);
})();

// Initialize contact chip hovers + email body hover popups
setupContactChipHovers();
setupEmailHoverPopups();

// Also do an initial check after page settles (Gmail takes a moment to render)
setTimeout(() => {
  console.log('[Stratus AI] Initial email check after load');
  checkForEmailView();
  setupEmailHoverPopups();
}, 1500);

// Second delayed check for slower connections
setTimeout(() => {
  checkForEmailView();
}, 3000);

// ─────────────────────────────────────────────
// Email Sent Detection
// ─────────────────────────────────────────────

function detectEmailSent() {
  // Watch for the email sent toast notification in Gmail
  const toastObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === 1) { // Element node
          // Gmail shows a toast with aria-live="polite" containing "Message sent" text
          if (node.textContent && (node.textContent.includes('Message sent') || node.textContent.includes('Undo'))) {
            // Extract email data from the just-sent compose window
            const recipientsInput = document.querySelector('input[aria-label*="To"]');
            const subjectEl = document.querySelector('input[aria-label*="Subject"]');

            if (recipientsInput && subjectEl) {
              const recipients = recipientsInput.value || '';
              const subject = subjectEl.value || '';

              if (recipients) {
                // Send EMAIL_SENT message to background with recipient info
                chrome.runtime.sendMessage({
                  type: MSG.EMAIL_SENT,
                  data: {
                    recipients: recipients.split(',').map(r => r.trim().toLowerCase()),
                    subject,
                    sentAt: new Date().toISOString(),
                  },
                }, (response) => {
                  if (chrome.runtime.lastError) {
                    console.warn('[Stratus] EMAIL_SENT handler error:', chrome.runtime.lastError);
                  }
                });
              }
            }
          }
        }
      });
    });
  });

  // Observe the document body for new toasts (they're typically direct children or in a container)
  toastObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Start email sent detection
detectEmailSent();

// ─────────────────────────────────────────────
// Message Handlers (from background)
// ─────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'COPY_TO_CLIPBOARD':
      navigator.clipboard.writeText(message.text).then(() => {
        sendResponse({ success: true });
      }).catch(() => {
        sendResponse({ success: false });
      });
      return true;

    case MSG.CRM_DATA_READY:
      if (settings?.enableCrmBanner) {
        injectCrmBanner(message.data);
      }
      sendResponse({ success: true });
      break;
  }
});

// Also detect URL hash changes (Gmail navigation)
let lastHash = window.location.hash;

function onHashChange() {
  const currentHash = window.location.hash;
  if (currentHash !== lastHash) {
    lastHash = currentHash;
    lastEmailHash = ''; // Reset to trigger re-detection
    // Clean up old banners and highlights
    document.querySelectorAll('.stratus-crm-banner').forEach(el => el.remove());
    document.querySelectorAll('[data-stratus-processed]').forEach(el => {
      el.removeAttribute('data-stratus-processed');
    });
    document.querySelectorAll('[data-stratus-deals-processed]').forEach(el => {
      el.removeAttribute('data-stratus-deals-processed');
    });
    document.querySelectorAll('[data-stratus-email-hover-processed]').forEach(el => {
      el.removeAttribute('data-stratus-email-hover-processed');
    });

    // Check for new email after DOM settles
    setTimeout(() => {
      checkForEmailView();
      setupEmailHoverPopups();
    }, 500);
  }
}

// Use both hashchange event and polling for maximum reliability
window.addEventListener('hashchange', onHashChange);
setInterval(onHashChange, 1000);
