import React, { useState } from 'react';
import { MSG } from '../../lib/constants.js';

/**
 * Scripted delete + undo for a Zoho record the caller already identifies.
 *
 * WHY THIS EXISTS. Deleting used to run only through the chat agent: ask, let it
 * search for the record, confirm, let it call the tool. Two LLM round trips at
 * roughly 15 seconds each, and it failed outright when the model serialized
 * confirm as a string (Chris, 2026-08-19). Anywhere the record_id or
 * quote_number is ALREADY known, none of that is necessary.
 *
 * Deliberate design points:
 *  - Two steps, always. The first click only arms the control and names the
 *    record; the second sends it. A destructive action never fires on one click.
 *  - The armed state times out on its own, so a forgotten armed button cannot be
 *    triggered later by a stray click.
 *  - The server still requires confirm:true and applies every guard the chat
 *    path applies, including the pre-delete snapshot.
 *  - Undo is offered inline from the token the delete returns, because the
 *    moment someone realises they deleted the wrong thing is right now.
 */
export function CrmDeleteControl({
  styles,
  sendToBackground,
  moduleName,
  recordId = '',
  quoteNumber = '',
  label = '',
  disabled = false,
  onDone,
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [undoToken, setUndoToken] = useState('');
  const [deleted, setDeleted] = useState(false);

  const S = styles || {};
  const what = label || `${moduleName} ${recordId || quoteNumber}`;
  const canSend = !!moduleName && !!(recordId || quoteNumber);

  function arm() {
    setError('');
    setStatus('');
    setArmed(true);
    // Disarm on its own. An armed destructive button left on screen is a trap.
    setTimeout(() => setArmed((current) => (current ? false : current)), 12000);
  }

  async function run() {
    if (!canSend || busy) return;
    setBusy(true);
    setError('');
    setStatus('Deleting...');
    const res = await sendToBackground(MSG.CRM_DELETE, {
      moduleName,
      recordId,
      quoteNumber,
      confirm: true,
    }).catch((e) => ({ success: false, error: e.message }));
    setBusy(false);
    setArmed(false);
    if (res && res.success === true) {
      setDeleted(true);
      setUndoToken(res.undo_token || '');
      setStatus(res.message || `Deleted ${what}.`);
      if (typeof onDone === 'function') onDone({ deleted: true, undoToken: res.undo_token || '' });
      return;
    }
    // Nothing was deleted. Say so plainly rather than leaving it ambiguous.
    setStatus('');
    setError(`${res?.error || 'Delete failed'} Nothing was deleted.`);
  }

  async function undo() {
    if (!undoToken || busy) return;
    setBusy(true);
    setError('');
    setStatus('Restoring...');
    const res = await sendToBackground(MSG.CRM_UNDO, { undoToken })
      .catch((e) => ({ success: false, error: e.message }));
    setBusy(false);
    if (res && res.success === true) {
      setDeleted(false);
      setUndoToken('');
      setStatus(res.message || `Restored ${what}.`);
      if (typeof onDone === 'function') onDone({ deleted: false, undoToken: '' });
      return;
    }
    setStatus('');
    setError(res?.error || 'Undo failed. The record is still deleted.');
  }

  if (deleted) {
    return (
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
        <span style={{ color: '#0b6b3a' }}>{status || `Deleted ${what}.`}</span>
        {undoToken && (
          <button style={S.btn} disabled={busy} onClick={undo}>
            {busy ? 'Restoring...' : 'Undo delete'}
          </button>
        )}
        {error && <span style={{ color: '#b00020' }}>{error}</span>}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', fontSize: 11 }}>
      {!armed && (
        <button style={S.btn} disabled={disabled || busy || !canSend} onClick={arm}>
          Delete {moduleName === 'Quotes' ? 'quote' : 'record'}
        </button>
      )}
      {armed && (
        <>
          <span style={{ color: '#8a6100' }}>Delete {what}?</span>
          <button style={S.btn} disabled={busy} onClick={run}>
            {busy ? 'Deleting...' : 'Yes, delete it'}
          </button>
          <button style={S.btn} disabled={busy} onClick={() => setArmed(false)}>
            Cancel
          </button>
        </>
      )}
      {status && !error && <span style={{ color: '#5f6368' }}>{status}</span>}
      {error && <span style={{ color: '#b00020' }}>{error}</span>}
    </div>
  );
}

export default CrmDeleteControl;
