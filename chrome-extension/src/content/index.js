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
  if (!hash || hash === '#inbox' || hash === '#sent') return null;

  // Strategy 2: Subject line detection
  const subjectEl = document.querySelector('h2.hP') || document.querySelector('[data-thread-perm-id] h2');
  if (!subjectEl) return null;

  const subject = subjectEl.textContent.trim();

  // Strategy 3: Sender info from expanded email header
  const senderEl = document.querySelector('.gD');
  let senderEmail = '';
  let senderName = '';
  if (senderEl) {
    senderEmail = senderEl.getAttribute('email') || '';
    senderName = senderEl.getAttribute('name') || senderEl.textContent.trim();
  }

  // Get email body
  const bodyEl = document.querySelector('.a3s.aiL') || document.querySelector('.ii.gt div');
  const body = bodyEl ? bodyEl.innerText.substring(0, 8000) : '';

  // Collect all participants with role information
  const allEmails = new Set();
  const allDomains = new Set();
  const threadContacts = [];
  const contactsByEmail = new Map(); // For deduplication while preserving role

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

  // Collect sender from expanded email header (.gD elements)
  document.querySelectorAll('.gD').forEach((el) => {
    const email = el.getAttribute('email');
    if (email && !email.toLowerCase().includes('@stratusinfosystems.com')) {
      allEmails.add(email.toLowerCase());
      const domain = email.split('@')[1];
      if (domain) allDomains.add(domain);

      const name = el.getAttribute('name') || el.textContent.trim();
      const lowerEmail = email.toLowerCase();

      // Deduplicate: if email exists, upgrade role from 'sender' if needed
      if (!contactsByEmail.has(lowerEmail)) {
        contactsByEmail.set(lowerEmail, { email, name, role: 'sender' });
      }
    }
  });

  // Collect To/Cc recipients (.g2 elements and [email] attributes)
  document.querySelectorAll('.g2, [email]').forEach((el) => {
    const email = el.getAttribute('email');
    if (email && !email.toLowerCase().includes('@stratusinfosystems.com')) {
      allEmails.add(email.toLowerCase());
      const domain = email.split('@')[1];
      if (domain) allDomains.add(domain);

      const name = el.getAttribute('name') || el.textContent.trim();
      const role = determineRole(el);
      const lowerEmail = email.toLowerCase();

      // Deduplicate: preserve highest priority role (sender > cc > to)
      if (!contactsByEmail.has(lowerEmail)) {
        contactsByEmail.set(lowerEmail, { email, name, role });
      } else {
        const existing = contactsByEmail.get(lowerEmail);
        // Upgrade role priority if needed
        const roleMap = { sender: 3, cc: 2, to: 1 };
        if (roleMap[role] > roleMap[existing.role]) {
          existing.role = role;
        }
        // Update name if we have a better one
        if (name && name.length > existing.name.length) {
          existing.name = name;
        }
      }
    }
  });

  // Populate threadContacts array from contactsByEmail Map
  threadContacts.push(...contactsByEmail.values());

  const isOutbound = senderEmail.toLowerCase().includes('@stratusinfosystems.com');

  // Find customer email (first non-Stratus participant)
  let customerEmail = '';
  let customerName = '';
  let customerDomain = '';
  for (const contact of threadContacts) {
    customerEmail = contact.email;
    customerName = contact.name;
    customerDomain = contact.email.split('@')[1] || '';
    break;
  }

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

function injectComposeButton(composeEl) {
  // Check if already injected
  if (composeEl.querySelector('.stratus-compose-btn')) return;

  const toolbar = composeEl.querySelector('.btC') || composeEl.querySelector('[role="toolbar"]');
  if (!toolbar) return;

  const btn = document.createElement('div');
  btn.className = 'stratus-compose-btn';
  btn.title = 'Insert Stratus Quote';
  btn.style.cssText = `
    display: inline-flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; border-radius: 50%; cursor: pointer;
    background: ${COLORS.STRATUS_BLUE}; color: white; font-size: 14px;
    font-weight: 700; margin-left: 8px; transition: background 0.2s;
  `;
  btn.textContent = 'S';

  btn.addEventListener('mouseenter', () => { btn.style.background = COLORS.STRATUS_DARK; });
  btn.addEventListener('mouseleave', () => { btn.style.background = COLORS.STRATUS_BLUE; });

  btn.addEventListener('click', () => {
    // Open sidebar to quote panel
    sendToBackground(MSG.SIDEBAR_NAVIGATE, { panel: 'quote' }).catch(() => {});
  });

  toolbar.appendChild(btn);
}

// ─────────────────────────────────────────────
// MutationObserver for Gmail SPA
// ─────────────────────────────────────────────

// Debounce helper — batches rapid MutationObserver fires into one call
let _emailChangeTimer = null;
let _composeCheckTimer = null;

const observer = new MutationObserver((mutations) => {
  // Debounced email view change detection (150ms)
  const subjectEl = document.querySelector('h2.hP');
  if (subjectEl) {
    if (_emailChangeTimer) clearTimeout(_emailChangeTimer);
    _emailChangeTimer = setTimeout(() => {
      _emailChangeTimer = null;
      onEmailChanged();
    }, 150);
  }

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

// Start observing Gmail DOM
observer.observe(document.body, {
  childList: true,
  subtree: true,
  attributes: false,
  characterData: false,
});

// Initialize email hover popups
setupEmailHoverPopups();

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
setInterval(() => {
  const currentHash = window.location.hash;
  if (currentHash !== lastHash) {
    lastHash = currentHash;
    lastEmailHash = ''; // Reset to trigger re-detection
    // Clean up old banners and highlights
    document.querySelectorAll('.stratus-crm-banner').forEach(el => el.remove());
    document.querySelectorAll('[data-stratus-processed]').forEach(el => {
      el.removeAttribute('data-stratus-processed');
    });
  }
}, 1000);
