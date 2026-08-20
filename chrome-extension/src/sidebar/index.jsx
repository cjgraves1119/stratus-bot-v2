import { createRoot } from 'react-dom/client';
import App, { QuoteLinesView } from './App';
import '../styles/sidebar.css';

const container = document.getElementById('root');
const root = createRoot(container);

// ── Standalone views (2026-08-20) ──
//
// sidebar.html is already in web_accessible_resources for crm.zoho.com, so the
// Zoho content script can mount it in an iframe overlay. `?view=quote-lines`
// renders the Quote Line Editor ALONE, without the tabbed shell, so the overlay
// is the same component the side panel shows and cannot drift from it.
//
// The iframe gives complete CSS and JS isolation from Zoho's very aggressive
// stylesheets without introducing shadow DOM, and needs no webpack change.
const params = new URLSearchParams(window.location.search);
const view = params.get('view');

if (view === 'quote-lines') {
  const recordId = String(params.get('recordId') || '').trim();
  const module = String(params.get('module') || 'Quotes').trim() || 'Quotes';
  // Only the overlay passes a closable frame; the panel's tab has no close.
  const close = params.get('closable') === '1'
    ? () => window.parent?.postMessage({ type: 'STRATUS_QLE_CLOSE' }, '*')
    : undefined;
  root.render(
    <QuoteLinesView
      recordId={/^\d{10,25}$/.test(recordId) ? recordId : ''}
      module={module}
      onClose={close}
    />,
  );
} else {
  root.render(<App />);
}
