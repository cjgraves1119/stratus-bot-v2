/**
 * Sender → Zoho Contact/Account matcher, fail-closed.
 *
 * Codex's ruleset (council protocol):
 *   - exact_contact_match: allowed for normal low-risk actions, tied to that Account
 *   - single_account_domain_match: allowed ONLY for generic licensing_faq, routing_ack
 *   - multiple_domain_matches: escalate
 *   - free_email_domain: escalate unless exact Contact match
 *   - new sender + corporate domain: domain enriches context, no account-specific disclosure
 *   - order_status: require exact Contact + reference token (SO#/PO#/quote#/tracking#)
 *   - url_quote: domain-only OK for generic URL; account pricing requires exact Contact
 */

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com",
  "icloud.com", "me.com", "live.com", "msn.com", "proton.me", "protonmail.com",
  "mail.com", "ymail.com", "comcast.net", "att.net", "verizon.net", "cox.net",
]);

export const MATCH_LEVELS = Object.freeze({
  EXACT_CONTACT: "exact_contact",
  SINGLE_DOMAIN: "single_account_domain",
  MULTI_DOMAIN: "multi_domain",
  FREE_EMAIL: "free_email",
  NO_MATCH: "no_match",
});

/**
 * Returns:
 *   {
 *     level: MATCH_LEVELS.*,
 *     contact: { id, email, name } | null,
 *     account: { id, name } | null,
 *     candidates: [...]  // for multi-domain cases
 *   }
 */
export async function matchSender(env, fromEmail) {
  if (!fromEmail) return { level: MATCH_LEVELS.NO_MATCH, contact: null, account: null };

  const domain = fromEmail.split("@")[1]?.toLowerCase();
  const isFree = domain && FREE_EMAIL_DOMAINS.has(domain);

  // Tier 1: exact contact match
  const contact = await crmContactByEmail(env, fromEmail);
  if (contact) {
    return {
      level: MATCH_LEVELS.EXACT_CONTACT,
      contact: { id: contact.id, email: fromEmail, name: contact.Full_Name },
      account: contact.Account_Name
        ? { id: contact.Account_Name.id, name: contact.Account_Name.name }
        : null,
    };
  }

  // Free email + no contact = escalate (no domain enrichment)
  if (isFree) return { level: MATCH_LEVELS.FREE_EMAIL, contact: null, account: null };

  // Tier 2: account domain match
  const accounts = await crmAccountsByDomain(env, domain);
  if (accounts.length === 1) {
    return {
      level: MATCH_LEVELS.SINGLE_DOMAIN,
      contact: null,
      account: { id: accounts[0].id, name: accounts[0].Account_Name },
    };
  }
  if (accounts.length > 1) {
    return {
      level: MATCH_LEVELS.MULTI_DOMAIN,
      contact: null,
      account: null,
      candidates: accounts.map(a => ({ id: a.id, name: a.Account_Name })),
    };
  }
  return { level: MATCH_LEVELS.NO_MATCH, contact: null, account: null };
}

/**
 * Policy: given match level + intent, can the bot disclose account-specific data?
 * Note: risk-gate.js carries the canonical version of this logic. This helper
 * is exported only for testability — keep the two in sync.
 */
export function isAuthorizedForIntent(matchLevel, intent) {
  if (matchLevel === MATCH_LEVELS.EXACT_CONTACT) return true;
  if (matchLevel === MATCH_LEVELS.SINGLE_DOMAIN) {
    // Only generic / non-account-specific intents allowed on domain-only
    return ["licensing_faq", "routing_acknowledgment", "url_quote"].includes(intent);
  }
  return false;
}

/**
 * COQL value sanitizer. Zoho's COQL doesn't have a great escape, so we
 * restrict to safe characters and reject anything weird. Email domains
 * per RFC 5321 are: letters, digits, hyphen, period.
 */
function sanitizeDomain(domain) {
  if (!domain) return null;
  if (!/^[a-z0-9.\-]{3,253}$/i.test(domain)) return null;
  return domain.toLowerCase();
}

async function crmContactByEmail(env, email) {
  // Hit gchat /api/crm-search — it owns the COQL + auth + cache
  try {
    const res = await env.GCHAT.fetch("https://internal/api/crm-search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.GCHAT_INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        module: "Contacts",
        criteria: `(Email:equals:${email})`,
        fields: ["Full_Name", "Email", "Account_Name"],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.data?.[0] || null;
  } catch (err) {
    console.warn(`[sender-match] contact lookup failed: ${err.message}`);
    return null;
  }
}

async function crmAccountsByDomain(env, domain) {
  const safeDomain = sanitizeDomain(domain);
  if (!safeDomain) return [];
  try {
    const res = await env.GCHAT.fetch("https://internal/api/crm-search", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.GCHAT_INTERNAL_TOKEN,
      },
      body: JSON.stringify({
        module: "Accounts",
        criteria: `(Website:contains:${safeDomain})`,
        fields: ["Account_Name", "Website"],
        limit: 5,
      }),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data?.data || [];
  } catch (err) {
    console.warn(`[sender-match] account lookup failed: ${err.message}`);
    return [];
  }
}
