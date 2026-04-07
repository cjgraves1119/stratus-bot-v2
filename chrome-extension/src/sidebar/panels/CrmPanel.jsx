/**
 * CRM Panel
 * Shows Zoho CRM account, contacts, deals, and activities for the current email.
 */

import { useState, useEffect } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS, CONSUMER_DOMAINS } from '../../lib/constants';

export default function CrmPanel({ emailContext, crmContext }) {
  const [data, setData] = useState(crmContext || null);
  const [deals, setDeals] = useState(null);
  const [activities, setActivities] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedContact, setSelectedContact] = useState(null);
  const [isrDeals, setIsrDeals] = useState(null);

  // Thread contacts come from the content script's DOM extraction
  const threadContacts = emailContext?.threadContacts || [];

  // Auto-lookup when email context changes
  useEffect(() => {
    if (!emailContext) return;

    // Use customer email if outbound, otherwise sender email
    const email = (emailContext.isOutbound && emailContext.customerEmail)
      ? emailContext.customerEmail : emailContext.senderEmail;
    const domain = email ? email.split('@')[1] : '';

    if (!domain || CONSUMER_DOMAINS.has(domain)) return;

    setSelectedContact(email);
    lookupCrm(email, domain);
  }, [emailContext?.senderEmail, emailContext?.customerEmail]);

  // Use passed crmContext if available
  useEffect(() => {
    if (crmContext && crmContext.found) setData(crmContext);
  }, [crmContext]);

  // Fetch ISR deals for Cisco reps
  useEffect(() => {
    if (!data?.contact) return;
    const email = data.contact.email || '';
    const isCiscoRep = email.includes('@cisco.com') || data.contact.merakiTeam || data.contact.vertical;

    if (isCiscoRep) {
      sendToBackground(MSG.CRM_ISR_DEALS, {
        repEmail: email,
        repName: data.contact.name || `${data.contact.firstName || ''} ${data.contact.lastName || ''}`.trim(),
      }).then(setIsrDeals).catch(() => setIsrDeals(null));
    } else {
      setIsrDeals(null);
    }
  }, [data?.contact?.email]);

  async function lookupCrm(email, domain) {
    setLoading(true);
    setError(null);
    try {
      const result = await sendToBackground(MSG.CRM_LOOKUP, { email, domain });
      setData(result);

      // Fetch deals if account found
      if (result?.account?.id) {
        const dealResult = await sendToBackground(MSG.CRM_DEALS, {
          accountId: result.account.id,
          contactEmail: email,
        });
        setDeals(dealResult);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleContactChange(email) {
    setSelectedContact(email);
    const domain = email ? email.split('@')[1] : '';
    if (domain && !CONSUMER_DOMAINS.has(domain)) {
      lookupCrm(email, domain);
    }
  }

  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
        <p>Open an email to see CRM data.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div className="spinner" style={{ margin: '0 auto 12px' }} />
        Looking up CRM data...
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 16 }}>
        <div style={{ padding: 12, background: '#fce8e6', borderRadius: 8, color: COLORS.ERROR, fontSize: 13 }}>
          {error}
        </div>
      </div>
    );
  }

  if (!data || !data.found) {
    const email = (emailContext.isOutbound && emailContext.customerEmail)
      ? emailContext.customerEmail : emailContext.senderEmail;
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
        <p>No CRM record found for {email}</p>
        <button
          onClick={() => {/* TODO: open add contact form */}}
          style={{
            marginTop: 12, padding: '8px 16px', background: COLORS.STRATUS_BLUE,
            color: 'white', border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer',
          }}
        >
          + Add Contact
        </button>
      </div>
    );
  }

  const { account, contact } = data;

  return (
    <div style={{ padding: 16 }}>
      {/* Contact Selector */}
      {threadContacts.length > 1 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
            Participant
          </label>
          <select
            value={selectedContact || ''}
            onChange={(e) => handleContactChange(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: `1px solid ${COLORS.BORDER}`,
              background: COLORS.BG_PRIMARY,
              color: COLORS.TEXT_PRIMARY,
              cursor: 'pointer',
            }}
          >
            <option value="">Select a contact...</option>
            {threadContacts.map((contact, idx) => (
              <option key={idx} value={contact.email}>
                {contact.name} ({contact.email})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Account Card */}
      {account && (
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 15, color: COLORS.TEXT_PRIMARY }}>{account.name}</div>
              {account.industry && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.industry}</div>}
              {account.phone && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.phone}</div>}
            </div>
            {account.zohoUrl && (
              <a href={account.zohoUrl} target="_blank" rel="noopener" style={{
                color: COLORS.STRATUS_BLUE, fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap',
              }}>Zoho →</a>
            )}
          </div>
        </Card>
      )}

      {/* Contact Card */}
      {contact && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 6 }}>
            Contact
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.TEXT_PRIMARY }}>
            {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`}
          </div>
          {contact.title && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{contact.title}</div>}
          <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{contact.email}</div>
          {contact.phone && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{contact.phone}</div>}
          {contact.merakiTeam && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Team: {contact.merakiTeam}</div>}
          {contact.vertical && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Vertical: {contact.vertical}</div>}
          {contact.pointsCurrent && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Rewards: {contact.pointsCurrent} pts</div>}
          {contact.zohoUrl && (
            <a href={contact.zohoUrl} target="_blank" rel="noopener" style={{
              color: COLORS.STRATUS_BLUE, fontSize: 12, fontWeight: 500, display: 'inline-block', marginTop: 4,
            }}>View Contact →</a>
          )}
        </Card>
      )}

      {/* ISR Deals (Cisco Rep) */}
      {isrDeals && isrDeals.deals && isrDeals.deals.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
            Deals as Meraki ISR ({isrDeals.deals.length})
          </div>
          {isrDeals.deals.slice(0, 10).map((deal, i) => (
            <div key={i} style={{
              padding: '6px 0',
              borderBottom: i < Math.min(isrDeals.deals.length, 10) - 1 ? `1px solid ${COLORS.BORDER}` : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ fontWeight: 500, fontSize: 12, color: COLORS.TEXT_PRIMARY, flex: 1 }}>
                  {deal.name || deal.Deal_Name}
                </div>
                {(deal.amount || deal.Amount) && (
                  <span style={{ fontSize: 12, fontWeight: 600, color: COLORS.SUCCESS }}>
                    ${Number(deal.amount || deal.Amount || 0).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
                {deal.stage || deal.Stage} {deal.accountName ? `| ${deal.accountName}` : ''}
              </div>
              {deal.zohoUrl && (
                <a href={deal.zohoUrl} target="_blank" rel="noopener" style={{
                  color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500,
                }}>View Deal →</a>
              )}
            </div>
          ))}
          {isrDeals.deals.length > 10 && (
            <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, textAlign: 'center', marginTop: 6 }}>
              +{isrDeals.deals.length - 10} more deals
            </div>
          )}
        </Card>
      )}

      {/* Deals */}
      {deals && deals.deals && deals.deals.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
            Deals ({deals.deals.length})
          </div>
          {deals.deals.map((deal, i) => (
            <div key={i} style={{
              padding: '8px 0',
              borderBottom: i < deals.deals.length - 1 ? `1px solid ${COLORS.BORDER}` : 'none',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div style={{ fontWeight: 500, fontSize: 13, color: COLORS.TEXT_PRIMARY, flex: 1 }}>
                  {deal.name || deal.Deal_Name}
                </div>
                {deal.amount && (
                  <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.SUCCESS }}>
                    ${Number(deal.amount || deal.Amount || 0).toLocaleString()}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
                {deal.stage || deal.Stage} {deal.closingDate ? `| Close: ${deal.closingDate}` : ''}
              </div>
              {deal.zohoUrl && (
                <a href={deal.zohoUrl} target="_blank" rel="noopener" style={{
                  color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500,
                }}>View Deal →</a>
              )}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

function Card({ children }) {
  return (
    <div style={{
      background: COLORS.BG_PRIMARY, borderRadius: 8, padding: 14,
      marginBottom: 12, border: `1px solid ${COLORS.BORDER}`,
    }}>
      {children}
    </div>
  );
}
