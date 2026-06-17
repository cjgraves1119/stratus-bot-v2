/**
 * Email Responder OOO Toggle Panel
 *
 * Renders inside OptionsPage. Talks to the gchat worker via the
 * /api/email-responder/* proxy endpoints (background message handlers
 * EMAIL_RESPONDER_STATE / TOGGLE / KILL / POLL).
 *
 * Three controls:
 *   1. Master OOO toggle (auto-reply on/off via ai@ alias)
 *   2. Sub-toggle: watch Chris's inbox (only takes effect when master is on)
 *   3. Kill switch (emergency stop, killed-state hides all toggles)
 *
 * Also shows current SEND_MODE (dry_run / draft_only / auto_send), today's
 * activity counts (via /api/audit?days=1), and the last poll cursor.
 */

import { useState, useEffect, useCallback } from 'react';
import { sendToBackground } from '../lib/messaging';
import { MSG, COLORS } from '../lib/constants';

export default function EmailResponderToggle() {
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const s = await sendToBackground(MSG.EMAIL_RESPONDER_STATE);
      setState(s);
    } catch (err) {
      setError(err.message);
      setState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  async function applyToggle(ooo, watchInbox) {
    setBusy(true);
    setError(null);
    try {
      const res = await sendToBackground(MSG.EMAIL_RESPONDER_TOGGLE, { ooo, watchInbox });
      setState(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function applyKill(killState) {
    if (killState === 'on' && !confirm('Turn the kill switch ON?\n\nThis halts ALL email responder activity (both ai@ alias and your inbox watch) until you turn it off. Use only if something is misbehaving.')) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await sendToBackground(MSG.EMAIL_RESPONDER_KILL, { state: killState });
      await reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p style={{ color: COLORS.TEXT_SECONDARY }}>Checking responder status...</p>;
  if (error) {
    return (
      <div>
        <p style={{ color: COLORS.ERROR, fontSize: 13 }}>{error}</p>
        <p style={{ color: COLORS.TEXT_SECONDARY, fontSize: 12, marginTop: 6 }}>
          The email-responder worker may not be deployed yet, or the gchat worker hasn't been
          configured with EMAIL_RESPONDER_ADMIN_KEY. See <code>worker-email-responder/HANDOFF.md</code>.
        </p>
        <button onClick={reload} style={btnSecondary}>Retry</button>
      </div>
    );
  }
  if (!state) return null;

  const killed = state.killSwitch === 'on';
  const oooOn = state.ooo === 'on';
  const watchOn = state.watchInbox === 'on';
  const modeBadge = badgeForMode(state.sendMode);

  return (
    <div>
      <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12, lineHeight: 1.5 }}>
        AI responds to inbound email when you're OOO. Replies via the <code>ai@stratusinfosystems.com</code>
        alias always; optionally also from your own inbox while you're away.
        {' '}<a href="https://github.com/cjgraves1119/stratus-bot-v2/blob/main/worker-email-responder/README.md" target="_blank" rel="noopener" style={{ color: COLORS.STRATUS_BLUE }}>Docs</a>.
      </p>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, padding: 10, background: COLORS.BG_SECONDARY, borderRadius: 6 }}>
        <span style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Send mode:</span>
        <span style={{ ...modeBadge.style, padding: '3px 10px', borderRadius: 10, fontSize: 11, fontWeight: 600 }}>{modeBadge.label}</span>
        <span style={{ flex: 1 }} />
        <button onClick={reload} disabled={busy} style={btnGhost}>↻</button>
      </div>

      {killed && (
        <div style={{ padding: 12, background: '#fce6e6', border: '1px solid #f5b6b6', borderRadius: 6, marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#a02828', marginBottom: 4 }}>KILL SWITCH IS ON</div>
          <div style={{ fontSize: 12, color: '#a02828', marginBottom: 8 }}>All email responder activity is halted.</div>
          <button onClick={() => applyKill('off')} disabled={busy} style={{ ...btnPrimary, background: '#a02828' }}>
            Turn kill switch OFF
          </button>
        </div>
      )}

      <SettingRow
        label="OOO mode (ai@ alias)"
        description="Auto-reply to inbound email arriving at ai@stratusinfosystems.com. Always uses 'Stratus AI Assistant' display name + signature."
        checked={oooOn}
        disabled={busy || killed}
        onChange={(v) => applyToggle(v ? 'on' : 'off', watchOn ? 'on' : 'off')}
      />

      <SettingRow
        label="Watch my inbox (chrisg@)"
        description="Also reply to email landing in your own inbox. Reply will be sent AS YOU with a mandatory '[Auto-reply via Stratus AI]' subject prefix and disclosure banner. You're BCC'd on every reply."
        checked={watchOn}
        disabled={busy || killed || !oooOn}
        onChange={(v) => applyToggle(oooOn ? 'on' : 'off', v ? 'on' : 'off')}
        warning={!oooOn && watchOn ? 'Turn OOO mode on first.' : null}
      />

      <div style={{ marginTop: 16, padding: 10, background: COLORS.BG_SECONDARY, borderRadius: 6, fontSize: 11, color: COLORS.TEXT_SECONDARY, fontFamily: 'monospace' }}>
        cursors: ai={state.cursors?.ai_alias || '—'} · chris={state.cursors?.chris_ooo || '—'}
      </div>

      {!killed && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => applyKill('on')} disabled={busy} style={btnDanger}>
            Emergency stop (kill switch)
          </button>
        </div>
      )}
    </div>
  );
}

function SettingRow({ label, description, checked, disabled, onChange, warning }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '14px 0', borderBottom: `1px solid ${COLORS.BORDER}`, gap: 12,
    }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.TEXT_PRIMARY }}>{label}</div>
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY, marginTop: 2, lineHeight: 1.5 }}>{description}</div>
        {warning && <div style={{ fontSize: 11, color: COLORS.WARNING, marginTop: 4 }}>{warning}</div>}
      </div>
      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, flex: '0 0 40px' }}>
        <input type="checkbox" checked={checked} disabled={disabled}
          onChange={(e) => onChange(e.target.checked)}
          style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: checked ? COLORS.STRATUS_BLUE : '#ccc',
          borderRadius: 11, transition: '0.2s',
        }}>
          <span style={{
            position: 'absolute', height: 18, width: 18, left: checked ? 20 : 2, bottom: 2,
            backgroundColor: 'white', borderRadius: '50%', transition: '0.2s',
          }} />
        </span>
      </label>
    </div>
  );
}

function badgeForMode(mode) {
  if (mode === 'auto_send') return { label: 'AUTO-SEND', style: { background: '#e3f4e9', color: '#1f7a40' } };
  if (mode === 'draft_only') return { label: 'DRAFT-ONLY', style: { background: '#fdf0d8', color: '#b15a00' } };
  if (mode === 'dry_run') return { label: 'DRY RUN', style: { background: '#eef1f5', color: COLORS.TEXT_SECONDARY } };
  return { label: String(mode || 'unknown').toUpperCase(), style: { background: '#eef1f5', color: COLORS.TEXT_SECONDARY } };
}

const btnPrimary = {
  padding: '8px 16px', background: COLORS.STRATUS_BLUE, color: 'white',
  border: 'none', borderRadius: 6, fontSize: 13, cursor: 'pointer', fontWeight: 500,
};
const btnSecondary = {
  padding: '6px 12px', background: 'transparent', color: COLORS.STRATUS_BLUE,
  border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: 6, fontSize: 12, cursor: 'pointer',
};
const btnDanger = {
  padding: '6px 12px', background: 'transparent', color: '#a02828',
  border: `1px solid #a02828`, borderRadius: 6, fontSize: 12, cursor: 'pointer',
};
const btnGhost = {
  padding: '4px 10px', background: 'transparent', color: COLORS.TEXT_SECONDARY,
  border: `1px solid ${COLORS.BORDER}`, borderRadius: 4, fontSize: 12, cursor: 'pointer',
};
