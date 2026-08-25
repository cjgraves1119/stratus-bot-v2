const MAX_QUOTE_CONTEXT_PARTICIPANTS = 50;

/**
 * Gmail identity is usable only while Gmail is the verified active page, or
 * when the user explicitly locked a Gmail snapshot to this chat. App.jsx keeps
 * the last emailContext in memory while browsing elsewhere, so checking merely
 * for a non-null context would reintroduce stale-customer leakage.
 */
export function quoteCustomerContextEnabled({ activePageType = '', contextLockKind = '' } = {}) {
  const lockKind = String(contextLockKind || '').trim().toLowerCase();
  if (lockKind) return lockKind === 'gmail';
  return String(activePageType || '').trim().toLowerCase() === 'gmail';
}

function cleanEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function cleanParticipants(value) {
  const participants = [];
  const seen = new Set();
  for (const candidate of Array.isArray(value) ? value : []) {
    const email = cleanEmail(candidate?.email || candidate);
    if (!email || seen.has(email) || participants.length >= MAX_QUOTE_CONTEXT_PARTICIPANTS) continue;
    seen.add(email);
    participants.push({
      email,
      name: String(candidate?.name || '').trim().slice(0, 300),
      role: String(candidate?.role || '').trim().slice(0, 80),
    });
  }
  return participants;
}

/**
 * Freeze the customer identity shown when an editable quote card is created.
 *
 * This snapshot deliberately excludes Gmail subject/body/order URLs. A chat
 * quote can therefore retain its associated Contact/Account without allowing
 * email prose to change the requested products. Context-menu snapshots remain
 * ambiguity-safe: they carry the participant set but never a heuristic chosen
 * customer. Ordinary chat/manual cards may retain the Contact visibly selected
 * in the Context bar, but only when that address belongs to the same snapshot.
 */
export function quoteCustomerContextSnapshot({
  source = '',
  context = null,
  shownContactEmail = '',
  disabled = false,
} = {}) {
  if (disabled || !context || typeof context !== 'object') return null;
  const threadPermId = String(context.threadPermId || '').trim().slice(0, 300);
  const participants = cleanParticipants(
    Array.isArray(context.participants) ? context.participants : context.threadContacts,
  );
  if (!threadPermId || !participants.length) return null;

  const contactEmail = cleanEmail(shownContactEmail || context.contactEmail);
  const mayBindShownContact = source !== 'context-menu'
    && participants.some((participant) => participant.email === contactEmail);
  return {
    threadPermId,
    participants,
    ...(mayBindShownContact ? { contactEmail } : {}),
  };
}

/**
 * Resolve the immutable identity inputs for One Shot. Gmail intake remains its
 * own reviewed path; all other quote cards must carry an explicit snapshot or
 * stay unscoped. This prevents a later Gmail tab from being borrowed.
 */
export function quoteCustomerContextForHandoff(sourceMessage) {
  const emailIntakeParticipants = cleanParticipants(sourceMessage?.emailQuoteContext?.participants);
  if (emailIntakeParticipants.length) {
    return {
      participants: emailIntakeParticipants,
      contactEmail: '',
      mode: 'gmail-intake',
    };
  }

  const snapshot = sourceMessage?.gmailParticipantSnapshot;
  const threadPermId = String(snapshot?.threadPermId || '').trim();
  const participants = threadPermId ? cleanParticipants(snapshot?.participants) : [];
  if (!participants.length) return { participants: [], contactEmail: '', mode: 'unscoped' };

  const contactEmail = cleanEmail(snapshot?.contactEmail);
  const boundContactEmail = participants.some((participant) => participant.email === contactEmail)
    ? contactEmail : '';
  return {
    participants,
    contactEmail: sourceMessage?.quoteSource === 'context-menu' ? '' : boundContactEmail,
    mode: sourceMessage?.quoteSource === 'context-menu' ? 'context-menu' : 'chat-context',
  };
}
