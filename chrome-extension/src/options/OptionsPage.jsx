/**
 * Options / Settings Page
 *
 * First-run setup and ongoing configuration.
 * Handles API key, Zoho OAuth, and feature toggles.
 */

import { useState, useEffect } from 'react';
import { sendToBackground } from '../lib/messaging';
import { MSG, COLORS } from '../lib/constants';
import { getSettings, saveSettings, getLocalStorage, setLocalStorage } from '../lib/storage';

export default function OptionsPage() {
  const [settings, setSettingsState] = useState(null);
  const [authStatus, setAuthStatus] = useState(null);
  const [zohoClientId, setZohoClientId] = useState('');
  const [zohoClientSecret, setZohoClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [zohoConnecting, setZohoConnecting] = useState(false);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    const s = await getSettings();
    setSettingsState(s);

    const auth = await sendToBackground(MSG.GET_AUTH_STATUS).catch(() => ({}));
    setAuthStatus(auth);

    const { zohoClientId: cid } = await getLocalStorage('zohoClientId');
    const { zohoClientSecret: csec } = await getLocalStorage('zohoClientSecret');
    if (cid) setZohoClientId(cid);
    if (csec) setZohoClientSecret(csec);
  }

  async function handleSave() {
    setSaving(true);
    await saveSettings(settings);
    await setLocalStorage({ zohoClientId, zohoClientSecret });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleZohoConnect() {
    if (!zohoClientId || !zohoClientSecret) {
      alert('Please enter Zoho Client ID and Client Secret first.');
      return;
    }
    // Save credentials first
    await setLocalStorage({ zohoClientId, zohoClientSecret });

    setZohoConnecting(true);
    const result = await sendToBackground(MSG.ZOHO_AUTH_START).catch((err) => ({ success: false, error: err.message }));
    setZohoConnecting(false);

    if (result.success) {
      await loadAll(); // Refresh auth status
    } else {
      alert(`Zoho connection failed: ${result.error}`);
    }
  }

  function updateSetting(key, value) {
    setSettingsState(prev => ({ ...prev, [key]: value }));
  }

  if (!settings) {
    return <div style={{ padding: 40, textAlign: 'center', color: COLORS.TEXT_SECONDARY }}>Loading...</div>;
  }

  return (
    <div style={{ fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: COLORS.STRATUS_DARK, marginBottom: 8 }}>
        Stratus AI Settings
      </h1>
      <p style={{ color: COLORS.TEXT_SECONDARY, marginBottom: 32 }}>
        Configure your extension for Gmail integration and Zoho CRM access.
      </p>

      {/* Quick Setup Banner */}
      {!settings.apiKey && (
        <Section title="Quick Setup">
          <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12 }}>
            Stratus team member? Click below to auto-fill your settings.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {[
              { name: 'Chris Graves', email: 'chrisg@stratusinfosystems.com' },
            ].map(user => (
              <button key={user.email} onClick={() => {
                updateSetting('userName', user.name);
                updateSetting('userEmail', user.email);
                updateSetting('apiKey', 'stratus-gao-55688852246aaea36c36b49f7a35c8f2');
              }} style={{
                padding: '8px 16px', background: COLORS.STRATUS_LIGHT,
                border: `1px solid ${COLORS.STRATUS_BLUE}33`, borderRadius: 8,
                fontSize: 13, cursor: 'pointer', color: COLORS.STRATUS_DARK, fontWeight: 500,
              }}>
                {user.name}
              </button>
            ))}
          </div>
        </Section>
      )}

      {/* User Info */}
      <Section title="Your Information">
        <Field label="Full Name" value={settings.userName} onChange={(v) => updateSetting('userName', v)} placeholder="Chris Graves" />
        <Field label="Email" value={settings.userEmail} onChange={(v) => updateSetting('userEmail', v)} placeholder="chrisg@stratusinfosystems.com" />
      </Section>

      {/* API Key */}
      <Section title="Stratus API Key">
        <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12 }}>
          Required for all API calls. Get this from your admin or the worker configuration.
        </p>
        <Field label="API Key" value={settings.apiKey} onChange={(v) => updateSetting('apiKey', v)} placeholder="stratus-gao-..." type="password" />
        {settings.apiKey && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: 12, color: COLORS.SUCCESS }}>✓ API key configured</span>
            <button onClick={async () => {
              try {
                const res = await fetch(`${settings.apiKey ? 'https://stratus-ai-bot-gchat.chrisg-ec1.workers.dev' : ''}/api/crm-search`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'X-API-Key': settings.apiKey },
                  body: JSON.stringify({ query: 'test', module: 'Accounts' }),
                });
                alert(res.ok ? 'Connection successful!' : `Connection failed (HTTP ${res.status})`);
              } catch (err) {
                alert('Connection failed: ' + err.message);
              }
            }} style={{
              padding: '3px 10px', background: 'transparent', border: `1px solid ${COLORS.STRATUS_BLUE}`,
              borderRadius: 4, fontSize: 11, color: COLORS.STRATUS_BLUE, cursor: 'pointer',
            }}>
              Test Connection
            </button>
          </div>
        )}
      </Section>

      {/* Zoho OAuth */}
      <Section title="Zoho CRM Connection">
        <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12 }}>
          Connect your Zoho CRM account for per-user access. Create a Server-based Client
          in <a href="https://api-console.zoho.com/" target="_blank" rel="noopener" style={{ color: COLORS.STRATUS_BLUE }}>Zoho API Console</a>.
        </p>
        <Field label="Client ID" value={zohoClientId} onChange={setZohoClientId} placeholder="1000.XXXX..." />
        <Field label="Client Secret" value={zohoClientSecret} onChange={setZohoClientSecret} placeholder="abcd1234..." type="password" />

        <div style={{ marginTop: 12 }}>
          {authStatus?.zohoAuthenticated ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: COLORS.SUCCESS, fontWeight: 600, fontSize: 13 }}>✓ Connected to Zoho CRM</span>
              <button onClick={async () => {
                await sendToBackground('ZOHO_DISCONNECT');
                await loadAll();
              }} style={{
                padding: '4px 12px', background: 'transparent', border: `1px solid ${COLORS.ERROR}`,
                color: COLORS.ERROR, borderRadius: 6, fontSize: 12, cursor: 'pointer',
              }}>Disconnect</button>
            </div>
          ) : (
            <button onClick={handleZohoConnect} disabled={zohoConnecting} style={{
              padding: '10px 20px', background: COLORS.STRATUS_BLUE, color: 'white',
              border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600,
              cursor: 'pointer', opacity: zohoConnecting ? 0.7 : 1,
            }}>
              {zohoConnecting ? 'Connecting...' : 'Connect Zoho CRM'}
            </button>
          )}
        </div>
      </Section>

      {/* Feature Toggles */}
      <Section title="Features">
        <Toggle label="Desktop Notifications" description="Task due reminders, quote completion alerts" checked={settings.enableNotifications} onChange={(v) => updateSetting('enableNotifications', v)} />
        <Toggle label="SKU Highlighting" description="Highlight Cisco/Meraki SKUs in email body text" checked={settings.enableSkuHighlighting} onChange={(v) => updateSetting('enableSkuHighlighting', v)} />
        <Toggle label="CRM Banner" description="Show account info banner when viewing emails" checked={settings.enableCrmBanner} onChange={(v) => updateSetting('enableCrmBanner', v)} />
        <Toggle label="Compose Button" description="Add quote button to Gmail compose toolbar" checked={settings.enableComposeButton} onChange={(v) => updateSetting('enableComposeButton', v)} />
      </Section>

      {/* Save */}
      <div style={{ marginTop: 24 }}>
        <button onClick={handleSave} disabled={saving} style={{
          padding: '12px 32px', background: COLORS.STRATUS_BLUE, color: 'white',
          border: 'none', borderRadius: 8, fontSize: 15, fontWeight: 600,
          cursor: 'pointer', opacity: saving ? 0.7 : 1,
        }}>
          {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Settings'}
        </button>
      </div>

      {/* Keyboard Shortcuts */}
      <Section title="Keyboard Shortcuts" style={{ marginTop: 32 }}>
        <p style={{ fontSize: 13, color: COLORS.TEXT_SECONDARY, marginBottom: 12 }}>
          Customize these at <code style={{ background: COLORS.BG_SECONDARY, padding: '2px 6px', borderRadius: 4 }}>
          chrome://extensions/shortcuts</code>
        </p>
        <ShortcutRow keys="Alt + S" action="Open sidebar" />
        <ShortcutRow keys="Alt + Q" action="Quick Quote" />
        <ShortcutRow keys="Alt + C" action="CRM lookup" />
        <ShortcutRow keys="Alt + A" action="AI email analysis" />
        <ShortcutRow keys="Alt + T" action="View tasks" />
        <ShortcutRow keys="Alt + D" action="Generate draft reply" />
      </Section>

      <div style={{ marginTop: 32, padding: 16, background: COLORS.BG_SECONDARY, borderRadius: 8, fontSize: 12, color: COLORS.TEXT_SECONDARY }}>
        Stratus AI Chrome Extension v{chrome.runtime.getManifest().version}
      </div>
    </div>
  );
}

function Section({ title, children, style }) {
  return (
    <div style={{
      marginBottom: 24, padding: 20, background: 'white', borderRadius: 12,
      border: `1px solid ${COLORS.BORDER}`, ...style,
    }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 16 }}>{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text' }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 4 }}>
        {label}
      </label>
      <input
        type={type}
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', padding: '8px 12px', border: `1px solid ${COLORS.BORDER}`,
          borderRadius: 6, fontSize: 13, outline: 'none', boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

function Toggle({ label, description, checked, onChange }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '10px 0', borderBottom: `1px solid ${COLORS.BORDER}`,
    }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, color: COLORS.TEXT_PRIMARY }}>{label}</div>
        <div style={{ fontSize: 12, color: COLORS.TEXT_SECONDARY }}>{description}</div>
      </div>
      <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ opacity: 0, width: 0, height: 0 }} />
        <span style={{
          position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: checked ? COLORS.STRATUS_BLUE : '#ccc',
          borderRadius: 22, transition: '0.3s',
        }}>
          <span style={{
            position: 'absolute', height: 18, width: 18, left: checked ? 19 : 2, bottom: 2,
            backgroundColor: 'white', borderRadius: '50%', transition: '0.3s',
          }} />
        </span>
      </label>
    </div>
  );
}

function ShortcutRow({ keys, action }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: 13 }}>
      <span style={{ color: COLORS.TEXT_PRIMARY }}>{action}</span>
      <kbd style={{
        background: COLORS.BG_SECONDARY, border: `1px solid ${COLORS.BORDER}`,
        borderRadius: 4, padding: '2px 8px', fontSize: 12, fontFamily: 'monospace',
      }}>{keys}</kbd>
    </div>
  );
}
