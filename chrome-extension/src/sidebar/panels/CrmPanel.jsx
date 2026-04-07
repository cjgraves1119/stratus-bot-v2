/**
 * CRM Panel (Zoho Tab)
 *
 * - Manual email entry + participant selector
 * - Sub-tabs: Info | Deals | Tasks
 * - Deals: SO number, tracking, ship date, Velocity Hub, Cisco rep assignment per deal
 * - Tasks: complete, create, suggest-task two-step preview → confirm
 * - Add Contact: domain-matched account auto-select with search
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS, CONSUMER_DOMAINS } from '../../lib/constants';

const ZOHO_ORG = 'org647122552';

const SUB_TABS = [
  { id: 'info', label: 'Info' },
  { id: 'deals', label: 'Deals' },
  { id: 'tasks', label: 'Tasks' },
];

export default function CrmPanel({ emailContext, crmContext, onNavigate, navData }) {
  const [data, setData] = useState(crmContext || null);
  const [deals, setDeals] = useState(null);
  const [tasks, setTasks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [selectedContact, setSelectedContact] = useState('');
  const [manualEmail, setManualEmail] = useState('');
  const [activeSubTab, setActiveSubTab] = useState('info');
  const [isrDeals, setIsrDeals] = useState(null);

  // Add Contact form state
  const [showAddForm, setShowAddForm] = useState(false);
  const [addFormData, setAddFormData] = useState({ firstName: '', lastName: '', email: '', phone: '', title: '' });
  const [addFormAccountId, setAddFormAccountId] = useState('');
  const [addFormLoading, setAddFormLoading] = useState(false);
  const [addFormError, setAddFormError] = useState(null);
  const [addFormSuccess, setAddFormSuccess] = useState(null);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [accountSearchResults, setAccountSearchResults] = useState([]);
  const [accountSearchLoading, setAccountSearchLoading] = useState(false);
  const accountSearchTimer = useRef(null);

  // Task action state
  const [taskActionLoading, setTaskActionLoading] = useState(null);

  // Create Task form state
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [createTaskData, setCreateTaskData] = useState({ subject: '', dueDate: '', priority: 'Normal', description: '' });
  const [createTaskLoading, setCreateTaskLoading] = useState(false);
  const [createTaskError, setCreateTaskError] = useState(null);
  const [createTaskSuccess, setCreateTaskSuccess] = useState(null);

  // Suggest Task state
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestPreview, setSuggestPreview] = useState(null);
  const [suggestConfirmLoading, setSuggestConfirmLoading] = useState(false);
  const [suggestResult, setSuggestResult] = useState(null);

  // Deal-level Velocity Hub / rep assignment state
  const [dealActions, setDealActions] = useState({}); // keyed by dealId

  // Build contact options — include ALL participants regardless of domain
  // (user should be able to select any participant to look up)
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
  // Filter to external (non-Stratus) but keep ALL domains including consumer
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
    setManualEmail('');
    // Auto-lookup only for business domains — consumer domains need manual action
    if (!domain || CONSUMER_DOMAINS.has(domain)) {
      setData(null); setDeals(null); setTasks(null);
      return; // Dropdown still shows (user can click a different participant or use manual search)
    }
    lookupCrm(email, domain);
  }, [emailContext?.senderEmail, emailContext?.customerEmail]);

  useEffect(() => {
    if (crmContext && crmContext.found) setData(crmContext);
  }, [crmContext]);

  // Handle navData from sidebar navigation (e.g. "Send + Task" button)
  useEffect(() => {
    if (navData?.activeSubTab) setActiveSubTab(navData.activeSubTab);
  }, [navData]);

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
    setManualEmail('');
    setShowAddForm(false);
    setAddFormSuccess(null);
    if (!email) return;
    const domain = email.split('@')[1] || '';
    // Always look up when user explicitly selects — even consumer domains may have Zoho records
    lookupCrm(email, domain);
  }

  function handleManualSearch(e) {
    e.preventDefault();
    const email = manualEmail.trim();
    if (!email) return;
    setSelectedContact(email);
    const domain = email.split('@')[1] || '';
    lookupCrm(email, domain);
  }

  // ── Task actions ──
  async function handleTaskAction(action, taskId, options = {}) {
    setTaskActionLoading(taskId);
    try {
      const result = await sendToBackground(MSG.TASK_ACTION, { action, taskId, ...options });
      // Show success briefly
      if (result?.success) {
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: emailContext?.allDomains || [],
          emails: emailContext?.allEmails || [],
        }).catch(() => null);
        if (taskResult) setTasks(taskResult);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setTaskActionLoading(null);
    }
  }

  // ── Create Task ──
  async function handleCreateTask(e) {
    e.preventDefault();
    if (!createTaskData.subject.trim()) return;
    setCreateTaskLoading(true);
    setCreateTaskError(null);
    setCreateTaskSuccess(null);
    try {
      const result = await sendToBackground(MSG.CRM_CREATE_TASK, {
        subject: createTaskData.subject,
        dueDate: createTaskData.dueDate,
        dealId: data?.deals?.[0]?.id || deals?.deals?.[0]?.id || '',
        contactId: data?.contact?.id || '',
        priority: createTaskData.priority,
        description: createTaskData.description,
      });
      if (result?.success) {
        setCreateTaskSuccess('Task created' + (result.zohoUrl ? '' : ''));
        setCreateTaskData({ subject: '', dueDate: '', priority: 'Normal', description: '' });
        setShowCreateTask(false);
        const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
          domains: emailContext?.allDomains || [],
          emails: emailContext?.allEmails || [],
        }).catch(() => null);
        if (taskResult) setTasks(taskResult);
      } else {
        setCreateTaskError(result?.error || 'Task creation failed');
      }
    } catch (err) {
      setCreateTaskError(err.message);
    } finally {
      setCreateTaskLoading(false);
    }
  }

  // ── Suggest Task ──
  async function handleSuggestTaskPreview() {
    setSuggestLoading(true);
    setSuggestPreview(null);
    setSuggestResult(null);
    try {
      // Use the best available customer email — never send Stratus's own email
      const customerEmail = selectedContact
        || data?.contact?.email
        || emailContext?.customerEmail
        || (emailContext?.senderEmail?.includes('@stratusinfosystems.com') ? '' : emailContext?.senderEmail)
        || '';
      const customerName = data?.contact?.name
        || emailContext?.customerName
        || emailContext?.senderName
        || '';
      const preview = await sendToBackground(MSG.SUGGEST_TASK_PREVIEW, {
        senderEmail: customerEmail,
        senderName: customerName,
        subject: emailContext?.subject || '',
        accountId: data?.account?.id || '',
        threadDomains: emailContext?.allDomains || [],
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
        deal_id: suggestPreview.deal_id || suggestPreview.dealId || deals?.deals?.[0]?.id || '',
        contact_id: suggestPreview.contact_id || suggestPreview.contactId || data?.contact?.id || '',
        priority: suggestPreview.priority || 'Normal',
        description: suggestPreview.description || '',
      });
      setSuggestResult(result);
      setSuggestPreview(null);
      const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
        domains: emailContext?.allDomains || [],
        emails: emailContext?.allEmails || [],
      }).catch(() => null);
      if (taskResult) setTasks(taskResult);
    } catch (err) {
      setSuggestResult({ error: err.message });
    } finally {
      setSuggestConfirmLoading(false);
    }
  }

  // ── Deal Actions (Velocity Hub / Assign Rep) ──
  async function handleDealVelocityHub(dealId) {
    setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], vhLoading: true, vhResult: null } }));
    try {
      const result = await sendToBackground(MSG.VELOCITY_HUB_SUBMIT, { dealId, country: 'United States' });
      setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], vhLoading: false, vhResult: result } }));
    } catch (err) {
      setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], vhLoading: false, vhResult: { error: err.message } } }));
    }
  }

  async function handleDealAssignRep(dealId, repEmail) {
    setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], repLoading: true, repResult: null } }));
    try {
      const result = await sendToBackground(MSG.ASSIGN_REP, { dealId, repEmail, repName: '' });
      setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], repLoading: false, repResult: result } }));
    } catch (err) {
      setDealActions(prev => ({ ...prev, [dealId]: { ...prev[dealId], repLoading: false, repResult: { error: err.message } } }));
    }
  }

  // ── Add Contact ──
  function openAddForm() {
    const contact = externalContacts.find(c => c.email?.toLowerCase() === selectedContact?.toLowerCase());
    const nameParts = (contact?.name || '').split(' ');
    const domain = (selectedContact || '').split('@')[1] || '';
    setAddFormData({
      firstName: nameParts[0] || '',
      lastName: nameParts.slice(1).join(' ') || '',
      email: selectedContact || '',
      phone: '',
      title: '',
    });
    // Auto-populate account from existing data
    setAddFormAccountId(data?.account?.id || '');
    setAccountSearchQuery(data?.account?.name || domain || '');
    setAccountSearchResults(data?.account ? [data.account] : []);
    setShowAddForm(true);
    setAddFormError(null);
    setAddFormSuccess(null);
  }

  function handleAccountSearchChange(q, skipSearch = false) {
    setAccountSearchQuery(q);
    if (accountSearchTimer.current) clearTimeout(accountSearchTimer.current);
    if (!q || q.length < 2 || skipSearch) { setAccountSearchResults([]); return; }
    accountSearchTimer.current = setTimeout(async () => {
      setAccountSearchLoading(true);
      try {
        const res = await sendToBackground(MSG.CRM_ACCOUNT_SEARCH, { query: q });
        const records = res?.records || res?.accounts || [];
        setAccountSearchResults(records);
      } catch (_) {}
      setAccountSearchLoading(false);
    }, 300);
  }

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
        accountId: addFormAccountId || data?.account?.id || '',
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

  if (!emailContext) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🏢</div>
        <p>Open an email to see Zoho CRM data.</p>
      </div>
    );
  }

  const isConsumerDomain = selectedContact && CONSUMER_DOMAINS.has(selectedContact.split('@')[1] || '');
  const hasData = data && data.found;
  const { account, contact } = hasData ? data : {};
  const taskList = tasks?.tasks || [];
  const dealList = deals?.deals || [];
  const isrDealList = isrDeals?.deals || [];
  const ciscoEmails = emailContext?.ciscoEmails || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* ── Contact Header ── */}
      <div style={{ padding: '12px 16px', background: COLORS.BG_PRIMARY, borderBottom: `1px solid ${COLORS.BORDER}` }}>

        {/* Participant Dropdown */}
        {externalContacts.length > 0 && (
          <select
            value={selectedContact || ''}
            onChange={(e) => handleContactChange(e.target.value)}
            style={{
              width: '100%', padding: '6px 10px', fontSize: 12,
              borderRadius: 6, border: `1px solid ${COLORS.BORDER}`,
              background: COLORS.BG_SECONDARY, color: COLORS.TEXT_PRIMARY,
              cursor: 'pointer', marginBottom: 8,
            }}
          >
            <option value="">Select participant...</option>
            {externalContacts.map((c, idx) => (
              <option key={idx} value={c.email}>
                {c.name !== c.email.split('@')[0] ? `${c.name} (${c.email})` : c.email}
              </option>
            ))}
          </select>
        )}

        {/* Manual email search */}
        <form onSubmit={handleManualSearch} style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
          <input
            type="text"
            value={manualEmail}
            onChange={e => setManualEmail(e.target.value)}
            placeholder="Search any email or domain..."
            style={{
              flex: 1, padding: '6px 10px', fontSize: 12, borderRadius: 6,
              border: `1px solid ${COLORS.BORDER}`, outline: 'none',
              background: COLORS.BG_PRIMARY, color: COLORS.TEXT_PRIMARY,
            }}
          />
          <button type="submit" style={{
            padding: '6px 12px', background: COLORS.STRATUS_BLUE, color: 'white',
            border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}>
            Go
          </button>
        </form>

        {/* Loading / Contact card */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '6px 0', color: COLORS.TEXT_SECONDARY, fontSize: 12 }}>
            Looking up...
          </div>
        )}

        {!loading && contact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: COLORS.STRATUS_BLUE,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0,
            }}>
              {(contact.name || contact.firstName || 'U')[0].toUpperCase()}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.TEXT_PRIMARY, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()}
              </div>
              {contact.title && <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>{contact.title}</div>}
            </div>
          </div>
        )}

        {!loading && hasData && account && !contact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', background: '#78909c',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'white', fontWeight: 700, fontSize: 16, flexShrink: 0,
            }}>
              {account.name[0].toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, color: COLORS.TEXT_PRIMARY }}>{account.name}</div>
              <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>No contact record</div>
            </div>
          </div>
        )}

        {!loading && !hasData && (selectedContact || manualEmail) && (
          <div style={{ textAlign: 'center', padding: '4px 0' }}>
            <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
              No CRM record for <strong style={{ color: COLORS.TEXT_PRIMARY }}>{selectedContact || manualEmail}</strong>
            </div>
            <button onClick={openAddForm} style={{
              padding: '4px 12px', background: COLORS.STRATUS_BLUE, color: 'white',
              border: 'none', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            }}>
              + Add Contact
            </button>
          </div>
        )}

        {error && !loading && (
          <div style={{ fontSize: 12, color: COLORS.ERROR, marginTop: 4 }}>{error}</div>
        )}
      </div>

      {/* ── Sub-Tab Bar ── */}
      <div style={{ display: 'flex', borderBottom: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY }}>
        {SUB_TABS.map((tab) => {
          const count = tab.id === 'deals' ? (dealList.length + isrDealList.length)
            : tab.id === 'tasks' ? taskList.length : null;
          return (
            <button key={tab.id} onClick={() => setActiveSubTab(tab.id)} style={{
              flex: 1, padding: '8px 6px', border: 'none', cursor: 'pointer',
              background: 'transparent',
              borderBottom: activeSubTab === tab.id ? `2px solid ${COLORS.STRATUS_BLUE}` : '2px solid transparent',
              color: activeSubTab === tab.id ? COLORS.STRATUS_BLUE : COLORS.TEXT_SECONDARY,
              fontSize: 12, fontWeight: activeSubTab === tab.id ? 600 : 400,
            }}>
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
            {showAddForm && (
              <AddContactForm
                formData={addFormData}
                setFormData={setAddFormData}
                accountId={addFormAccountId}
                setAccountId={setAddFormAccountId}
                accountSearchQuery={accountSearchQuery}
                onAccountSearchChange={handleAccountSearchChange}
                accountSearchResults={accountSearchResults}
                accountSearchLoading={accountSearchLoading}
                onSubmit={handleAddContact}
                onCancel={() => setShowAddForm(false)}
                loading={addFormLoading}
                error={addFormError}
                accountName={account?.name}
              />
            )}

            {addFormSuccess && (
              <div style={{ padding: 8, background: '#e8f5e9', borderRadius: 6, color: '#2e7d32', fontSize: 12, marginBottom: 12, textAlign: 'center' }}>
                {addFormSuccess}
              </div>
            )}

            {account && (
              <Card>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 4 }}>Account</div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: COLORS.TEXT_PRIMARY }}>{account.name}</div>
                    {account.industry && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.industry}</div>}
                    {account.phone && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{account.phone}</div>}
                  </div>
                  <a href={account.zohoUrl || `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Accounts/${account.id}`}
                    target="_blank" rel="noopener"
                    style={{ color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500, whiteSpace: 'nowrap' }}>
                    Open in Zoho →
                  </a>
                </div>
              </Card>
            )}

            {contact && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 6 }}>Contact Details</div>
                <div style={{ fontSize: 13, color: COLORS.TEXT_PRIMARY }}>
                  <div style={{ fontWeight: 500 }}>{contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`}</div>
                  {contact.title && <div style={{ color: COLORS.TEXT_SECONDARY, fontSize: 12 }}>{contact.title}</div>}
                  <div style={{ fontSize: 12, marginTop: 4 }}>{contact.email}</div>
                  {contact.phone && <div style={{ fontSize: 12 }}>{contact.phone}</div>}
                  {contact.merakiTeam && <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Team: {contact.merakiTeam}</div>}
                </div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(contact.zohoUrl || contact.id) && (
                    <a href={contact.zohoUrl || `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Contacts/${contact.id}`}
                       target="_blank" rel="noopener"
                       style={{ color: COLORS.STRATUS_BLUE, fontSize: 11, fontWeight: 500 }}>
                      View in Zoho →
                    </a>
                  )}
                  {account && selectedContact && contact.email?.toLowerCase() !== selectedContact.toLowerCase() && (
                    <button onClick={openAddForm} style={{
                      background: 'none', color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}44`,
                      borderRadius: 4, fontSize: 11, cursor: 'pointer', padding: '2px 8px',
                    }}>
                      + Add {selectedContact}
                    </button>
                  )}
                </div>
              </Card>
            )}

            {!hasData && !loading && !selectedContact && !manualEmail && (
              <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20 }}>
                <p style={{ fontSize: 13 }}>Select a participant or enter an email above.</p>
              </div>
            )}
          </>
        )}

        {/* ═══ DEALS TAB ═══ */}
        {activeSubTab === 'deals' && (
          <>
            {isrDealList.length > 0 && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Deals as Meraki ISR ({isrDealList.length})
                </div>
                {isrDealList.slice(0, 10).map((deal, i) => (
                  <DealRow key={deal.id || i} deal={deal} isLast={i >= Math.min(isrDealList.length, 10) - 1}
                    ciscoEmails={ciscoEmails}
                    actions={dealActions[deal.id] || {}}
                    onVelocityHub={() => handleDealVelocityHub(deal.id)}
                    onAssignRep={(repEmail) => handleDealAssignRep(deal.id, repEmail)}
                  />
                ))}
              </Card>
            )}

            {dealList.length > 0 && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Deals ({dealList.length})
                </div>
                {dealList.map((deal, i) => (
                  <DealRow key={deal.id || i} deal={deal} isLast={i >= dealList.length - 1}
                    ciscoEmails={ciscoEmails}
                    actions={dealActions[deal.id] || {}}
                    onVelocityHub={() => handleDealVelocityHub(deal.id)}
                    onAssignRep={(repEmail) => handleDealAssignRep(deal.id, repEmail)}
                  />
                ))}
              </Card>
            )}

            {/* Weborders (orphan SOs) */}
            {deals?.weborders?.length > 0 && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Weborders / POs ({deals.weborders.length})
                </div>
                {deals.weborders.map((wo, i) => (
                  <WeborderRow key={wo.id || i} wo={wo} isLast={i >= deals.weborders.length - 1} />
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
            {/* Header row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_SECONDARY }}>
                Open Tasks ({taskList.length})
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => { setShowCreateTask(v => !v); setSuggestPreview(null); }}
                  style={{
                    padding: '4px 10px', background: 'transparent',
                    border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: 6,
                    fontSize: 11, cursor: 'pointer', color: COLORS.STRATUS_BLUE, fontWeight: 600,
                  }}>
                  + Create
                </button>
                <button onClick={handleSuggestTaskPreview} disabled={suggestLoading}
                  style={{
                    padding: '4px 10px', background: COLORS.STRATUS_BLUE, color: 'white',
                    border: 'none', borderRadius: 6, fontSize: 11,
                    cursor: suggestLoading ? 'default' : 'pointer',
                    opacity: suggestLoading ? 0.7 : 1, fontWeight: 600,
                  }}>
                  {suggestLoading ? '...' : '✨ Suggest'}
                </button>
                <button
                  onClick={async () => {
                    const taskResult = await sendToBackground(MSG.FETCH_TASKS, {
                      domains: emailContext?.allDomains || [],
                      emails: emailContext?.allEmails || [],
                    }).catch(() => null);
                    if (taskResult) setTasks(taskResult);
                  }}
                  style={{
                    padding: '4px 8px', background: 'transparent', border: `1px solid ${COLORS.BORDER}`,
                    borderRadius: 6, fontSize: 11, cursor: 'pointer', color: COLORS.TEXT_SECONDARY,
                  }}>
                  ↻
                </button>
              </div>
            </div>

            {/* Create Task Form */}
            {showCreateTask && (
              <Card>
                <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 8 }}>
                  Create Task
                </div>
                <form onSubmit={handleCreateTask}>
                  <input type="text" placeholder="Task subject *" value={createTaskData.subject}
                    onChange={e => setCreateTaskData(p => ({ ...p, subject: e.target.value }))} required
                    style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input type="date" value={createTaskData.dueDate}
                      onChange={e => setCreateTaskData(p => ({ ...p, dueDate: e.target.value }))}
                      style={{ ...inputStyle, flex: 1 }} />
                    <select value={createTaskData.priority}
                      onChange={e => setCreateTaskData(p => ({ ...p, priority: e.target.value }))}
                      style={{ ...inputStyle, flex: 1 }}>
                      <option>Normal</option>
                      <option>High</option>
                      <option>Low</option>
                    </select>
                  </div>
                  <input type="text" placeholder="Description (optional)" value={createTaskData.description}
                    onChange={e => setCreateTaskData(p => ({ ...p, description: e.target.value }))}
                    style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
                  {createTaskError && <div style={{ fontSize: 12, color: COLORS.ERROR, marginBottom: 6 }}>{createTaskError}</div>}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="submit" disabled={createTaskLoading} style={{
                      flex: 1, padding: '7px', background: COLORS.STRATUS_BLUE, color: 'white',
                      border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                      cursor: createTaskLoading ? 'default' : 'pointer', opacity: createTaskLoading ? 0.7 : 1,
                    }}>
                      {createTaskLoading ? 'Creating...' : 'Create Task'}
                    </button>
                    <button type="button" onClick={() => setShowCreateTask(false)} style={{
                      padding: '7px 12px', background: 'transparent', border: `1px solid ${COLORS.BORDER}`,
                      borderRadius: 6, fontSize: 12, cursor: 'pointer', color: COLORS.TEXT_SECONDARY,
                    }}>
                      Cancel
                    </button>
                  </div>
                </form>
              </Card>
            )}

            {createTaskSuccess && (
              <div style={{ padding: 8, background: '#e8f5e9', borderRadius: 6, color: '#2e7d32', fontSize: 12, marginBottom: 10, textAlign: 'center' }}>
                {createTaskSuccess} ✓
              </div>
            )}

            {/* Suggest Task Preview */}
            {suggestPreview && (
              <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 8, padding: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#2e7d32', marginBottom: 6, textTransform: 'uppercase' }}>
                  Suggested Follow-Up
                </div>
                <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 4 }}>
                  {suggestPreview.subject}
                </div>
                {suggestPreview.description && (
                  <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginBottom: 4 }}>{suggestPreview.description}</div>
                )}
                <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>
                  Due: {suggestPreview.due_date || suggestPreview.dueDate || '3 business days'}
                  {suggestPreview.priority ? ` · ${suggestPreview.priority}` : ''}
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
                    padding: '7px 12px', background: 'transparent', border: '1px solid #a5d6a7',
                    borderRadius: 6, fontSize: 12, cursor: 'pointer', color: '#2e7d32',
                  }}>
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            {suggestResult && (
              <div style={{
                padding: 10, borderRadius: 6, marginBottom: 12, fontSize: 12,
                background: suggestResult.error ? '#fce8e6' : '#e8f5e9',
                color: suggestResult.error ? COLORS.ERROR : '#2e7d32',
              }}>
                {suggestResult.error || suggestResult.message || 'Task created ✓'}
                <button onClick={() => setSuggestResult(null)} style={{
                  float: 'right', background: 'none', border: 'none', cursor: 'pointer', fontSize: 11,
                }}>✕</button>
              </div>
            )}

            {taskList.length === 0 && !loading && !showCreateTask && (
              <div style={{ textAlign: 'center', color: COLORS.TEXT_SECONDARY, padding: 20, fontSize: 13 }}>
                No open tasks for this account.
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
                onOpenDeal={task.dealId ? () => window.open(`https://crm.zoho.com/crm/${ZOHO_ORG}/tab/Potentials/${task.dealId}`, '_blank') : null}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ──

function DealRow({ deal, isLast, ciscoEmails, actions, onVelocityHub, onAssignRep }) {
  const [expanded, setExpanded] = useState(false);
  const [selectedRep, setSelectedRep] = useState('');

  const dealName = typeof (deal.name || deal.Deal_Name) === 'object'
    ? (deal.name || deal.Deal_Name)?.name : (deal.name || deal.Deal_Name);
  const stage = typeof (deal.stage || deal.Stage) === 'object'
    ? (deal.stage || deal.Stage)?.name : (deal.stage || deal.Stage);
  const amount = Number(deal.amount || deal.Amount || 0);

  const hasSoData = deal.soNumber || deal.trackingNumber || deal.estimatedShipDate || deal.poStatus;

  return (
    <div style={{ borderBottom: !isLast ? `1px solid ${COLORS.BORDER}` : 'none', paddingBottom: 8, marginBottom: 8 }}>
      <div
        style={{ cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
          <div style={{ fontWeight: 500, fontSize: 12, color: COLORS.TEXT_PRIMARY, flex: 1 }}>{dealName}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {amount > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>${amount.toLocaleString()}</span>}
            <span style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY }}>{expanded ? '▲' : '▼'}</span>
          </div>
        </div>
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
          {stage}{deal.closingDate ? ` · Close: ${deal.closingDate}` : ''}
          {deal.soNumber && <span style={{ marginLeft: 6, color: '#1565c0' }}>SO: {deal.soNumber}</span>}
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 8, padding: 8, background: COLORS.BG_SECONDARY, borderRadius: 6 }}>
          {/* Zoho link */}
          {deal.zohoUrl && (
            <a href={deal.zohoUrl} target="_blank" rel="noopener"
              style={{ fontSize: 11, color: COLORS.STRATUS_BLUE, fontWeight: 500, display: 'block', marginBottom: 6 }}>
              Open Deal in Zoho →
            </a>
          )}

          {/* SO / Tracking details */}
          {hasSoData && (
            <div style={{ marginBottom: 8 }}>
              {deal.soNumber && <div style={{ fontSize: 11 }}><strong>SO #:</strong> {deal.soNumber}</div>}
              {deal.vendorSoNumber && <div style={{ fontSize: 11 }}><strong>Vendor SO:</strong> {deal.vendorSoNumber}</div>}
              {deal.poStatus && <div style={{ fontSize: 11 }}><strong>PO Status:</strong> {deal.poStatus}</div>}
              {deal.trackingNumber && <div style={{ fontSize: 11 }}><strong>Tracking:</strong> {deal.trackingNumber}</div>}
              {deal.estimatedShipDate && <div style={{ fontSize: 11 }}><strong>Est. Ship:</strong> {deal.estimatedShipDate}</div>}
            </div>
          )}

          {/* Velocity Hub */}
          <button onClick={onVelocityHub} disabled={actions.vhLoading} style={{
            width: '100%', padding: '6px', marginBottom: 6,
            background: actions.vhLoading ? COLORS.TEXT_SECONDARY : '#00bceb',
            color: 'white', border: 'none', borderRadius: 5, fontSize: 11,
            fontWeight: 700, cursor: actions.vhLoading ? 'default' : 'pointer',
          }}>
            {actions.vhLoading ? 'Submitting...' : '🚀 Velocity Hub'}
          </button>
          {actions.vhResult && (
            <div style={{
              fontSize: 11, padding: '4px 8px', borderRadius: 4, marginBottom: 6,
              background: actions.vhResult.error ? '#fce8e6' : '#e6f4ea',
              color: actions.vhResult.error ? COLORS.ERROR : '#137333',
            }}>
              {actions.vhResult.error || actions.vhResult.message || 'Submitted ✓'}
            </div>
          )}

          {/* Assign Cisco Rep */}
          {ciscoEmails.length > 0 && (
            <div>
              {ciscoEmails.length > 1 ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={selectedRep} onChange={e => setSelectedRep(e.target.value)}
                    style={{ flex: 1, padding: '5px', border: `1px solid ${COLORS.BORDER}`, borderRadius: 5, fontSize: 11 }}>
                    <option value="">Select rep...</option>
                    {ciscoEmails.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <button onClick={() => onAssignRep(selectedRep)} disabled={!selectedRep || actions.repLoading}
                    style={{
                      padding: '5px 10px', background: COLORS.STRATUS_BLUE, color: 'white',
                      border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600,
                      cursor: !selectedRep || actions.repLoading ? 'default' : 'pointer',
                      opacity: !selectedRep || actions.repLoading ? 0.6 : 1,
                    }}>
                    Assign
                  </button>
                </div>
              ) : (
                <button onClick={() => onAssignRep(ciscoEmails[0])} disabled={actions.repLoading} style={{
                  width: '100%', padding: '6px', background: COLORS.STRATUS_BLUE, color: 'white',
                  border: 'none', borderRadius: 5, fontSize: 11, fontWeight: 600,
                  cursor: actions.repLoading ? 'default' : 'pointer',
                }}>
                  {actions.repLoading ? 'Assigning...' : `Assign ${ciscoEmails[0]}`}
                </button>
              )}
              {actions.repResult && (
                <div style={{
                  fontSize: 11, padding: '4px 8px', borderRadius: 4, marginTop: 4,
                  background: actions.repResult.error ? '#fce8e6' : '#e6f4ea',
                  color: actions.repResult.error ? COLORS.ERROR : '#137333',
                }}>
                  {actions.repResult.error || actions.repResult.message || 'Rep assigned ✓'}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WeborderRow({ wo, isLast }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: !isLast ? `1px solid ${COLORS.BORDER}` : 'none' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div style={{ fontWeight: 500, fontSize: 12, color: COLORS.TEXT_PRIMARY }}>{wo.subject || `PO ${wo.soNumber}`}</div>
        {wo.grandTotal > 0 && <span style={{ fontSize: 12, fontWeight: 600, color: '#2e7d32' }}>${Number(wo.grandTotal).toLocaleString()}</span>}
      </div>
      <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>
        {wo.soNumber && `SO: ${wo.soNumber} `}
        {wo.status && `· ${wo.status} `}
        {wo.poStatus && `· ${wo.poStatus}`}
      </div>
      {wo.trackingNumber && (
        <div style={{ fontSize: 11, color: '#1565c0' }}>Tracking: {wo.trackingNumber}</div>
      )}
      {wo.estimatedShipDate && (
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>Est. Ship: {wo.estimatedShipDate}</div>
      )}
      {wo.zohoUrl && (
        <a href={wo.zohoUrl} target="_blank" rel="noopener"
          style={{ fontSize: 11, color: COLORS.STRATUS_BLUE, fontWeight: 500 }}>View PO →</a>
      )}
    </div>
  );
}

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
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 2 }}>Deal: {task.dealName}</div>
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
          <SmallButton onClick={onOpenDeal} disabled={false} color={COLORS.STRATUS_BLUE}>Open Deal</SmallButton>
        )}
      </div>
    </div>
  );
}

function AddContactForm({ formData, setFormData, accountId, setAccountId, accountSearchQuery, onAccountSearchChange, accountSearchResults, accountSearchLoading, onSubmit, onCancel, loading, error, accountName }) {
  return (
    <Card>
      <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', marginBottom: 10 }}>
        Add New Contact
      </div>
      <form onSubmit={onSubmit}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input type="text" placeholder="First Name" value={formData.firstName}
            onChange={e => setFormData(p => ({ ...p, firstName: e.target.value }))} required style={inputStyle} />
          <input type="text" placeholder="Last Name" value={formData.lastName}
            onChange={e => setFormData(p => ({ ...p, lastName: e.target.value }))} required style={inputStyle} />
        </div>
        <input type="email" placeholder="Email" value={formData.email}
          onChange={e => setFormData(p => ({ ...p, email: e.target.value }))} required
          style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
        <input type="text" placeholder="Title / Role" value={formData.title}
          onChange={e => setFormData(p => ({ ...p, title: e.target.value }))}
          style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />
        <input type="text" placeholder="Phone" value={formData.phone}
          onChange={e => setFormData(p => ({ ...p, phone: e.target.value }))}
          style={{ ...inputStyle, width: '100%', marginBottom: 8, boxSizing: 'border-box' }} />

        {/* Account Search */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 4, fontWeight: 500 }}>
            Account {accountId ? '✓' : '(search to assign)'}
          </div>
          <input
            type="text"
            placeholder="Search account by name or domain..."
            value={accountSearchQuery}
            onChange={e => onAccountSearchChange(e.target.value)}
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
          {accountSearchLoading && (
            <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, padding: '4px 0' }}>Searching...</div>
          )}
          {accountSearchResults.length > 0 && !accountId && (
            <div style={{ border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, marginTop: 4, maxHeight: 120, overflowY: 'auto', background: 'white' }}>
              {accountSearchResults.map((acct, i) => (
                <div key={acct.id || i}
                  onMouseDown={(e) => {
                    // onMouseDown fires before onBlur, so we can reliably capture the click
                    e.preventDefault();
                    setAccountId(acct.id);
                    // Set query to account name, skip new search, clear results
                    onAccountSearchChange(acct.name || '', true);
                  }}
                  style={{
                    padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                    borderBottom: i < accountSearchResults.length - 1 ? `1px solid ${COLORS.BORDER}` : 'none',
                    background: 'white',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f1f3f4'}
                  onMouseLeave={e => e.currentTarget.style.background = 'white'}
                >
                  {acct.name} {acct.industry ? <span style={{ color: COLORS.TEXT_SECONDARY, fontSize: 11 }}>({acct.industry})</span> : ''}
                </div>
              ))}
            </div>
          )}
          {accountId && (
            <div style={{ fontSize: 11, color: '#2e7d32', marginTop: 4 }}>
              ✓ Linked to account
              <button type="button" onClick={() => { setAccountId(''); onAccountSearchChange(''); }}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: COLORS.ERROR, cursor: 'pointer', fontSize: 11 }}>
                Remove
              </button>
            </div>
          )}
        </div>

        {accountName && !accountId && (
          <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, marginBottom: 8 }}>
            Current account: <strong>{accountName}</strong>
          </div>
        )}
        {error && <div style={{ fontSize: 12, color: COLORS.ERROR, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" disabled={loading} style={{
            flex: 1, padding: '8px', background: COLORS.STRATUS_BLUE, color: 'white',
            border: 'none', borderRadius: 6, fontSize: 12, cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? 'Creating...' : 'Create Contact'}
          </button>
          <button type="button" onClick={onCancel} style={{
            padding: '8px 12px', background: COLORS.BG_SECONDARY, color: COLORS.TEXT_SECONDARY,
            border: `1px solid ${COLORS.BORDER}`, borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}>
            Cancel
          </button>
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
  flex: 1, padding: '7px 10px', fontSize: 12, borderRadius: 6,
  border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY,
  color: COLORS.TEXT_PRIMARY, outline: 'none', fontFamily: 'inherit',
};
