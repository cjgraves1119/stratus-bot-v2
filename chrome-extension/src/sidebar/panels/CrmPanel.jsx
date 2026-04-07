/**
 * CRM Panel — Contact-Centric View
 *
 * Mirrors the Gmail Add-on sidebar layout:
 * - Contact header card (avatar, name, title) with participant selector
 * - Sub-tabs: Info | Deals | Tasks
 * - Each sub-tab shows data scoped to the selected contact/account
 */

import { useState, useEffect, useCallback } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS, CONSUMER_DOMAINS } from '../../lib/constants';

const ZOHO_ORG = 'org647122552';

// ── Sub-tab definitions ──
const SUB_TABS = [
  { id: 'info', label: 'Info' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
];

export default function CrmPanel({ emailContext, crmContext, onNavigate }) {
  const [data, setData] = useState(crmContext || null);
  const [deals, setDeals] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedContact, setSelectedContact] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('info');
  const [isrDeals, setIsrDeals] = useState(null);

  // Add Contact form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormData, setAddFormData] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '' });
  const [addFormLoading, setAddFormLoading] = useState(false);
  const [addFormError, setAddFormError] = useState(null);
  const [addFormSuccess, setAddFormSuccess] = useState(null);

  // Task action state
  const [taskActionLoading, setTaskActionLoading] = useState(null);

  // Suggest Task state (two-step: preview → confirm)
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestPreview, setSuggestPreview] = useState(null);
  const [suggestConfirmLoading, setSuggestConfirmLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState(null);

  // Build contact options from thread participants
  const threadContacts = emailContext?.threadContacts || [];
  const allEmails = emailContext?.allEmails || [];
  const contactOptions = [...threadContacts];
  const existingEmails = new Set(threadContacts.map(c => c.email?.toLowerCase()));
  allEmails.forEach(email => {
    if (!existingEmails.has(email.toLowerCase())) {
      contactOptions.push({ email, name: email.split('@')[0], role: 'unknown' });
      existingEmails.add(email.toLowerCase());
    }
  });
  const externalContacts = contactOptions.filter(
    c => !c.email?.toLowerCase().includes('@stratusinfosystems.com')
  );

  // Auto-lookup when email context changes
  useEffect(() => {
    if (!emailContext) return;
    const email = (emailContext.isOutbound && emailContext.customerEmail)
      ? emailContext.customerEmail : emailContext.senderEmail;
    const domain = email ? email.split('@')[1] : '';

    setSelectedContact(email || '');

    if (!domain || CONSUMER_DOMAINS.has(domain)) {
      setData(null);
      setDeals(null);
      setTasks(null);
      return;
    }

    lookupCrm(email, domain);
  }, [emailContext?.senderEmail, emailContext?.customerEmail]);

  // Use passed crmContext
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

  const lookupCrm = useCallback(async (email, domain) => {
    setLoading(true);
    setError(null);
    setData(null);
    setDeals(null);
    setTasks(null);
    setIsrDeals(null);
    try {
      const result = await sendToBackground(MSG.CRM_LOOKUP, { email, domain });
      setData(result);

      if (result?.account?.id) {
        // Fetch deals and tasks in parallel
        const [dealResult, taskResult] = await Promise.all([
          sendToBackground(MSG.CRM_DEALS, {
            accountId: result.account.id,
            contactEmail: email,
          }).catch(() => null),
          sendToBackground(MSG.FETCH_TASKS, {
            domains: emailContext?.allDomains || (domain ? [domain] : []),
            emails: emailContext?.allEmails || (email ? [email] : []),
          }).catch(() => null),
        ]);
        setDeals(dealResult);
        setTasks(taskResult);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [emailContext]);

  function handleContactChange(email) {
    setSelectedContact(email);
    setShowAddForm(false);
    setAddFormSuccess(null);
    setAddFormError(null);
    if (!email) return;
    const domain = email.split('@')[1] || '';
    lookupCrm(email, domain);
  }

  function handleManualLookup() {
    if (!selectedContact) return;
    const domain = selectedContact.split('@')[1] || '';
    lookupCrm(selectedContact, domain);
  }

  // ── Task actions ──
  async function handleTaskAction(action, taskId, options = {}) {
    setTaskActionLoading(taskId);
    try {
      await sendToBackground(MSG.TASK_ACTION, { action, taskId, ...options });
      // Re-fetch tasks
      if (data?.account?.id) {
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: emailContext?.allDomains || [],
          emails: emailContext?.allEmails || [],
        }).catch(() => null);
        setTasks(taskResult);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTaskActionLoading(null);
    }
  }

  // ── Add Contact ──
  async function handleAddContact(e) {
    e.preventDefault();
    setAddFormLoading(true);
    setAddFormError(null);
    setAddFormSuccess(null);
    try {
      const result = await sendToBackground(MSG.CRM_ADD_CONTACT, {
        firstName: addFormData.firstName,
        lastName: addFormData.lastName,
        email: addFormData.email || selectedContact,
        phone: addFormData.phone,
        title: addFormData.title,
        accountId: data?.account?.id || '',
      });
      if (result && (result.success || result.id || result.contactId)) {
        setAddFormSuccess('Contact created!');
        setShowAddForm(false);
        const email = addFormData.email || selectedContact;
        const domain = email.split('@')[1] || '';
        if (domain) setTimeout(() => lookupCrm(email, domain), 500);
      } else {
        setAddFormError(result?.error || result?.message || 'Failed to create contact');
      }
    } catch (err) {
      setAddFormError(err.message || 'Failed to create contact');
    } finally {
      setAddFormLoading(false);
    }
  }

  // ── Suggest Task ──
  async function handleSuggestTaskPreview() {
    setSuggestLoading(true);
    setSuggestPreview(null);
    setSuggestResult(null);
    try {
      const senderEmail = emailContext?.senderEmail || selectedContact || '';
      const senderName = emailContext?.senderName || '';
      const subject = emailContext?.subject || '';
      const accountId = data?.account?.id || '';
      const threadDomains = emailContext?.allDomains || [];
      const preview = await sendToBackground(MSG.SUGGEST_TASK_PREVIEW, {
        senderEmail, senderName, subject, accountId, threadDomains,
      });
      setSuggestPreview(preview);
    } catch (err) {
      setSuggestResult({ error: err.message });
    } finally {
      setSuggestLoading(false);
    }
  }

  async function handleSuggestTaskConfirm() {
    if (!suggestPreview) return;
    setSuggestConfirmLoading(true);
    try {
      const result = await sendToBackground(MSG.SUGGEST_TASK, {
        subject: suggestPreview.subject,
        due_date: suggestPreview.due_date || suggestPreview.dueDate,
        deal_id: suggestPreview.deal_id || suggestPreview.dealId || data?.deals?.[0]?.id || '',
        contact_id: suggestPreview.contact_id || suggestPreview.contactId || data?.contact?.id || '',
        priority: suggestPreview.priority || 'Normal',
        description: suggestPreview.description || '',
      });
      setSuggestResult(result);
      setSuggestPreview(null);
      // Refresh tasks
      if (data?.account?.id) {
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: emailContext?.allDomains || [],
          emails: emailContext?.allEmails || [],
        }).catch(() => null);
        if (taskResult) setTasks(taskResult);
      }
    } catch (err) {
      setSuggestResult({ error: err.message });
    } finally {
      setSuggestConfirmLoading(false);
    }
  }

  function openAddForm() {
    const contact = externalContacts.find(c => c.email?.toLowerCase() === selectedContact?.toLowerCase());
    const nameParts = (contact?.name || '').split(' ');
    setAddFormData({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      email: selectedContact || '',
      phone: '',
      title: '',
    });
    setShowAddForm(true);
    setAddFormError(null);
    setAddFormSuccess(null);
  }

  // ── No email context ──
  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
        <p>Open an email to see CRM data.</p>
      </div>
    );
  }

  const isConsumerDomain = selectedContact && CONSUMER_DOMAINS.has(selectedContact.split('@')[1] || '');
  const hasData = data && data.found;
  const { account, contact } = hasData ? data : {};

  // Count tasks and deals for sub-tab badges
  const taskList = tasks?.tasks || [];
  const dealList = deals?.deals || [];
  const isrDealList = isrDeals?.deals || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Contact Header ── */}
      <div style={{ padding: '12px 16px', background: COLORS.BG_PRIMARY, borderBottom: `1px solid ${COLORS.BORDER}` }}>
        {/* Contact selector */}
        {externalContacts.length > 0 && (
          <select
            value={selectedContact || ''}
            onChange={(e) => handleContactChange(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px', fontSize: 12,
              borderRadius: 6, border: `1px solid ${COLORS.BORDER}`,
              background: COLORS.BG_SECONDARY, color: COLORS.TEXT_PRIMARY, cursor: 'pointer',
              marginBottom: 10,
            }}
          >
            <option value="">Select a contact...</option>
            {externalContacts.map((c, idx) => (
              <option key={idx} value={c.email}>
                {c.name !== c.email.split('@')[0] ? `${c.name} (${c.email})` : c.email}
              </option>
            ))}
          </select>
        )}

        {/* Contact card / loading / not found */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '8px 0', color: COLORS.TEXT_SECONDARY, fontSize: 12 }}>
            <span className="spinner" style={{ display: 'inline-block', marginRight: 8 }} />
            Looking up...
          </div>
        )}

        {!loading && contact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Avatar */}
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: COLORS.STRATUS_BLUE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: 18, flexShrink: 0,
            }}>
              {(contact.name || contact.firstName || 'U')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()}
              </div>
              {contact.title && (
                <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {contact.title}
                </div>
              )}
            </div>
          </div>
        )}

        {!loading && hasData && account && !contact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%', background: '#78909c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: 18, flexShrink: 0,
            }}>
              {account.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.TEXT_PRIMARY }}>{account.name}</div>
              <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>No contact record</div>
            </div>
          </div>
        )}

        {!loading && !hasData && selectedContact && (
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 4 }}>
              No CRM record for <strong style={{ color: COLORS.TEXT_PRIMARY }}>{selectedContact}</strong>
            </div>
            {isConsumerDomain && (
              <button onClick={handleManualLookup} style={{
                background: 'none', border: 'none', color: COLORS.STRATUS_BLUE,
                cursor: 'pointer', fontSize: 11, textDecoration: 'underline', padding: 0,
              }}>
                Search anyway
              </button>
            )}
            <div style={{ marginTop: 6 }}>
              <button onClick={openAddForm} style={{
                padding: '4px 12px', background: COLORS.STRATUS_BLUE, color: 'white',
                border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer',
              }}>
                + Add Contact
              </button>
            </div>
          </div>
        )}

        {error && !loading && (
          <div style={{ fontSize: 12, color: COLORS.ERROR, marginTop: 6 }}>{error}</div>
        )}
      </div>

      {/* ── Sub-Tab Bar ── */}
      <div style={{
        display: 'flex', borderBottom: `1px solid ${COLORS.BORDER}`,
        background: COLORS.BG_PRIMARY,
      }}>
        {SUB_TABS.map((tab) => {
          const count = tab.id === 'deals' ? (dealList.length + isrDealList.length)
            : tab.id === 'tasks' ? taskList.length : null;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveSubTab(tab.id)}
              style={{
                flex: 1, padding: '8px 6px', border: 'none', cursor: 'pointer',
                background: 'transparent',
                borderBottom: activeSubTab === tab.id
                  ? `2px solid ${COLORS.STRATUS_BLUE}` : '2px solid transparent',
                color: activeSubTab === tab.id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
                fontSize: 12, fontWeight: activeSubTab === tab.id ? 600 : 400,
                transition: 'all 0.15s ease',
              }}
            >
              {tab.label}{count != null && count > 0 ? ` (${count})` : ''}
            </button>
          );
        })}
      </div>

      {/* ── Sub-Tab Content ── */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>

        {/* ═══ INFO TAB ═══ */}
        {activeSubTab === 'info' && (
          <>
            {/* Add Contact Form */}
            {showAddForm && <AddContactForm
              formData={addFormData}
              setFormData={setAddFormData}
              onSubmit={handleAddContact}
              onCancel={() => setShowAddForm(false)}
              loading={addFormLoading}
              error={addFormError}
              accountName={account?.name}
            />}

            {addFormSuccess && (
              <div style={{ padding: 8, background: '#e8f5e9', borderRadius: 6, color: '#2e7d32', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
                {addFormSuccess}
              </div>
            )}

            {/* Account Card */}
            {account && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 4 }}>Account</div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.TEXT_PRIMARY }}>{account.name}</div>
                    {account.industry && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.industry}</div>}
                    {account.phone && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.phone}</div>}
                    {account.website && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.website}</div>}
                  </div>
                  <a
                    href={account.zohoUrl || `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Accounts/${account.id}`}
                    target="_blank" rel="noopener"
                    style={{ color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}
                  >
                    Open in Zoho →
                  </a>
                </div>
              </Card>
            )}

            {/* Contact Details Card */}
            {contact && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 6 }}>Contact Details</div>
                <div style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY }}>
                  <div style={{ fontWeight: 500 }}>{contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`}</div>
                  {contact.title && <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 12 }}>{contact.title}</div>}
                  <div style={{ fontSize: 12, marginTop: 4 }}>{contact.email}</div>
                  {contact.phone && <div style={{ fontSize: 12 }}>{contact.phone}</div>}
                  {contact.merakiTeam && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Team: {contact.merakiTeam}</div>}
                  {contact.vertical && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Vertical: {contact.vertical}</div>}
                  {contact.pointsCurrent && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Rewards: {contact.pointsCurrent} pts</div>}
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8 }}>
                  {(contact.zohoUrl || contact.id) && (
                    <a href={contact.zohoUrl || `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Contacts/${contact.id}`}
                       target="_blank" rel="noopener"
                       style={{ color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500 }}>
                      View in Zoho →
                    </a>
                  )}
                </div>

                {/* Add contact for selected email if different from found contact */}
                {account && selectedContact && contact.email?.toLowerCase() !== selectedContact.toLowerCase() && (
                  <button onClick={openAddForm} style={{
                    marginTop: 8, padding: '4px 10px', background: 'none',
                    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}44`,
                    borderRadius: 4, fontSize: 11, cursor: 'pointer',
                  }}>
                    + Add {selectedContact} as contact
                  </button>
                )}
              </Card>
            )}

            {!hasData && !loading && !selectedContact && (
              <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20 }}>
                <p style={{ fontSize: 13 }}>Select a participant above to view CRM info.</p>
              </div>
            )}
          </>
        )}

        {/* ═══ DEALS TAB ═══ */}
        {activeSubTab === 'deals' && (
          <>
            {/* ISR Deals (Cisco Rep) */}
            {isrDealList.length > 0 && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Deals as Meraki ISR ({isrDealList.length})
                </div>
                {isrDealList.slice(0, 10).map((deal, i) => (
                  <DealRow key={i} deal={deal} isLast={i >= Math.min(isrDealList.length, 10) - 1} />
                ))}
                {isrDealList.length > 10 && (
                  <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, textAlign: 'center', marginTop: 6 }}>
                    +{isrDealList.length - 10} more
                  </div>
                )}
              </Card>
            )}

            {/* Account Deals */}
            {dealList.length > 0 && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Deals ({dealList.length})
                </div>
                {dealList.map((deal, i) => (
                  <DealRow key={i} deal={deal} isLast={i >= dealList.length - 1} />
                ))}
              </Card>
            )}

            {dealList.length === 0 && isrDealList.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20, fontSize: 13 }}>
                No deals found for this account.
              </div>
            )}
          </>
        )}

        {/* ═══ TASKS TAB ═══ */}
        {activeSubTab === 'tasks' && (
          <>
            {/* Task header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_SECONDARY }}>
                Open Tasks ({taskList.length})
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={handleSuggestTaskPreview}
                  disabled={suggestLoading}
                  style={{
                    padding: '4px 10px', background: COLORS.STRATUS_BLUE, color: 'white',
                    border: 'none', borderRadius: 6, fontSize: 11, cursor: suggestLoading ? 'default' : 'pointer',
                    opacity: suggestLoading ? 0.7 : 1, fontWeight: 600,
                  }}
                >
                  {suggestLoading ? '...' : '+ Suggest Task'}
                </button>
                <button
                  onClick={() => {
                    if (data?.account?.id) {
                      sendToBackground(MSG.FETCH_TASKS, {
                        domains: emailContext?.allDomains || [],
                        emails: emailContext?.allEmails || [],
                      }).then(setTasks).catch(() => {});
                    }
                  }}
                  style={{
                    padding: '4px 10px', background: 'transparent', border: `1px solid ${COLORS.BORDER}`,
                    borderRadius: 6, fontSize: 11, cursor: 'pointer', color: COLORS.TEXT_SECONDARY,
                  }}
                >
                  Refresh
                </button>
              </div>
            </div>

            {/* Suggest Task Preview Card */}
            {suggestPreview && (
              <div style={{
                background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8,
                padding: 12, marginBottom: 12,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32', marginBottom: 6, textTransform: 'uppercase' }}>
                  Suggested Follow-Up Task
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
                  {suggestPreview.subject}
                </div>
                {suggestPreview.description && (
                  <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 4 }}>
                    {suggestPreview.description}
                  </div>
                )}
                <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>
                  Due: {suggestPreview.due_date || suggestPreview.dueDate || '3 business days'}{' '}
                  {suggestPreview.priority && `· Priority: ${suggestPreview.priority}`}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button onClick={handleSuggestTaskConfirm} disabled={suggestConfirmLoading} style={{
                    flex: 1, padding: '7px', background: '#2e7d32', color: 'white',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: suggestConfirmLoading ? 'default' : 'pointer',
                    opacity: suggestConfirmLoading ? 0.7 : 1,
                  }}>
                    {suggestConfirmLoading ? 'Creating...' : '✓ Confirm & Create'}
                  </button>
                  <button onClick={() => setSuggestPreview(null)} style={{
                    padding: '7px 12px', background: 'transparent',
                    border: '1px solid #a5d6a7', borderRadius: 6, fontSize: 12,
                    cursor: 'pointer', color: '#2e7d32',
                  }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {/* Suggest Task Result */}
            {suggestResult && (
              <div style={{
                padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12,
                background: suggestResult.error ? '#fce8e6' : '#e8f5e9',
                color: suggestResult.error ? COLORS.ERROR : '#2e7d32',
              }}>
                {suggestResult.error || suggestResult.message || 'Task created successfully'}
                {!suggestResult.error && (
                  <button onClick={() => setSuggestResult(null)} style={{
                    float: 'right', background: 'none', border: 'none',
                    cursor: 'pointer', fontSize: 11, color: '#137333',
                  }}>✕</button>
                )}
              </div>
            )}

            {taskList.length === 0 && !loading && (
              <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20, fontSize: 13 }}>
                No open tasks found for this account.
              </div>
            )}

            {taskList.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                isLoading={taskActionLoading === task.id}
                onComplete={() => handleTaskAction('complete_and_followup', task.id, {
                  dealId: task.dealId,
                  contactId: task.contactId,
                  newSubject: `Follow up: ${task.subject}`,
                })}
                onClose={() => handleTaskAction('complete', task.id)}
                onReschedule={() => handleTaskAction('reschedule', task.id, {
                  newDueDate: addBusinessDays(new Date(), 3),
                })}
                onOpenDeal={task.dealId ? () => {
                  const dealUrl = `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Potentials/${task.dealId}`;
                  window.open(dealUrl, '_blank');
                } : null}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function TaskCard({ task, isLoading, onComplete, onClose, onReschedule, onOpenDeal }) {
  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();
  return (
    <div style={{
      background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
      borderRadius: 8, padding: 12, marginBottom: 8,
      borderLeft: `3px solid ${isOverdue ? COLORS.ERROR : COLORS.STRATUS_BLUE}`,
    }}>
      <div style={{ fontWeight: 500, fontSize: 13, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
        {task.subject}
      </div>
      <div style={{ fontSize: 12, color: isOverdue ? COLORS.ERROR : COLORS.TEXT_SECONDARY, marginBottom: 2 }}>
        Due: {task.dueDate || 'No date'} {isOverdue ? '(Overdue)' : ''}
      </div>
      {task.dealName && (
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 2 }}>
          Deal: {task.dealName}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
        <SmallButton onClick={onComplete} disabled={isLoading} color={COLORS.SUCCESS || '#2e7d32'}>
          Complete + Follow Up
        </SmallButton>
        <SmallButton onClick={onClose} disabled={isLoading} color={COLORS.TEXT_SECONDARY}>
          Close Task
        </SmallButton>
        <SmallButton onClick={onReschedule} disabled={isLoading} color={COLORS.WARNING || '#e37400'}>
          +3 Days
        </SmallButton>
        {onOpenDeal && (
          <SmallButton onClick={onOpenDeal} disabled={false} color={COLORS.STRATUS_BLUE}>
            Open
          </SmallButton>
        )}
      </div>
    </div>
  );
}

function DealRow({ deal, isLast }) {
  const dealName = typeof (deal.name || deal.Deal_Name) === 'object'
    ? (deal.name || deal.Deal_Name)?.name : (deal.name || deal.Deal_Name);
  const stage = typeof (deal.stage || deal.Stage) === 'object'
    ? (deal.stage || deal.Stage)?.name : (deal.stage || deal.Stage);
  const amount = Number(deal.amount || deal.Amount || 0);
  const accountName = typeof deal.accountName === 'object' ? deal.accountName?.name : deal.accountName;

  return (
    <div style={{ padding: '6px 0', borderBottom: !isLast ? `1px solid ${COLORS.BORDER}` : 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: COLORS.TEXT_PRIMARY, flex: 1 }}>{dealName}</div>
        {amount > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>${amount.toLocaleString()}</span>}
      </div>
      <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
        {stage}{accountName ? ` | ${accountName}` : ''}{deal.closingDate ? ` | Close: ${deal.closingDate}` : ''}
      </div>
      {deal.zohoUrl && (
        <a href={deal.zohoUrl} target="_blank" rel="noopener" style={{ color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500 }}>
          View Deal →
        </a>
      )}
    </div>
  );
}

function AddContactForm({ formData, setFormData, onSubmit, onCancel, loading, error, accountName }) {
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 10 }}>
        Add New Contact
      </div>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input type="text" placeholder="First Name" value={formData.firstName}
            onChange={(e) => setFormData(prev => ({ ...prev, firstName: e.target.value }))} required style={inputStyle} />
          <input type="text" placeholder="Last Name" value={formData.lastName}
            onChange={(e) => setFormData(prev => ({ ...prev, lastName: e.target.value }))} required style={inputStyle} />
        </div>
        <input type="email" placeholder="Email" value={formData.email}
          onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))} required
          style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
        <input type="text" placeholder="Title / Role" value={formData.title}
          onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
          style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
        <input type="text" placeholder="Phone" value={formData.phone}
          onChange={(e) => setFormData(prev => ({ ...prev, phone: e.target.value }))}
          style={{ ...inputStyle, width: '100%', marginBottom: 12, boxSizing: 'border-box' }} />
        {accountName && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>Links to: <strong>{accountName}</strong></div>}
        {error && <div style={{ fontSize: 12, color: COLORS.ERROR, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={loading} style={{
            flex: 1, padding: '8px', background: COLORS.STRATUS_BLUE, color: 'white',
            border: 'none', borderRadius: 6, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
          }}>{loading ? 'Creating...' : 'Create Contact'}</button>
          <button type="button" onClick={onCancel} style={{
            padding: '8px 12px', background: COLORS.BG_SECONDARY, color: COLORS.TEXT_SECONDARY,
            border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}>Cancel</button>
        </div>
      </form>
    </Card>
  );
}

function SmallButton({ children, onClick, disabled, color }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: '4px 8px', background: `${color}15`, color,
      border: `1px solid ${color}33`, borderRadius: 4, fontSize: 11,
      fontWeight: 500, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
    }}>
      {children}
    </button>
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

function addBusinessDays(date, days) {
  const result = new Date(date);
  let added = 0;
  while (added < days) {
    result.setDate(result.getDate() + 1);
    if (result.getDay() !== 0 && result.getDay() !== 6) added++;
  }
  return result.toISOString().split('T')[0];
}

const inputStyle = {
  flex: 1, padding: '7px 10px', fontSize: 13, borderRadius: 6,
  border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY,
  color: COLORS.TEXT_PRIMARY, outline: 'none', fontFamily: 'inherit',
};
