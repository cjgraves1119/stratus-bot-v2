/**
 * Stratus AI Chrome Extension — Zoho CRM Content Script
 *
 * Detects email addresses in Zoho CRM and adds "View in Gmail" quick links.
 * Runs only on crm.zoho.com pages.
 */

const GMAIL_SEARCH_BASE = 'https://mail.google.com/mail/u/0/#search/';

/**
 * Build a Gmail search URL for a contact email.
 */
function buildGmailSearchUrl(email) {
  const query = encodeURIComponent(`from:${email} OR to:${email}`);
  return `${GMAIL_SEARCH_BASE}${query}`;
}

/**
 * Inject "Gmail" quick-link buttons next to email fields in Zoho CRM.
 */
function injectGmailLinks() {
  // Target email fields in Zoho record views
  const emailElements = document.querySelectorAll(
    'a[href^="mailto:"], ' +
    '.zcrmEmailLink, ' +
    '[data-field-name="Email"] .zcrmLink, ' +
    '[data-field-name="Email"] a, ' +
    'span[data-type="email"]'
  );

  emailElements.forEach((el) => {
    // Skip if already processed
    if (el.dataset.stratusGmailLink) return;
    el.dataset.stratusGmailLink = 'true';

    let email = '';
    if (el.href && el.href.startsWith('mailto:')) {
      email = el.href.replace('mailto:', '').split('?')[0];
    } else {
      email = el.textContent.trim();
    }

    // Validate it looks like an email
    if (!email || !email.includes('@')) return;

    // Create Gmail link button
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

    // Insert after the email element
    el.parentNode.insertBefore(gmailBtn, el.nextSibling);
  });
}

// Run on page load and periodically (Zoho is a SPA)
injectGmailLinks();

// Re-run when Zoho navigates (SPA)
const zohoObserver = new MutationObserver(() => {
  injectGmailLinks();
});

zohoObserver.observe(document.body, {
  childList: true,
  subtree: true,
});

// Also add right-click context menu support
document.addEventListener('contextmenu', (e) => {
  const emailEl = e.target.closest('a[href^="mailto:"], .zcrmEmailLink, [data-field-name="Email"] a');
  if (emailEl) {
    // Store the email for the context menu handler
    window.__stratusSelectedEmail = emailEl.textContent.trim() ||
      (emailEl.href || '').replace('mailto:', '').split('?')[0];
  }
});

console.log('[Stratus AI] Zoho CRM content script loaded.');
