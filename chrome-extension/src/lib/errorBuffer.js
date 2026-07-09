/**
 * Lightweight in-memory ring buffer of recent runtime errors, for the
 * "Report Issue" snapshot. Installed once at sidebar boot; captures the last N
 * console.error calls and uncaught errors/rejections so a bug report shows what
 * actually went wrong, not just what the user typed.
 *
 * Deliberately tiny + dependency-free: no network, no storage, no PII scraping.
 * It only holds strings already headed for the console.
 */

const MAX_ENTRIES = 25;
const _buffer = [];
let _installed = false;

function _push(kind, parts) {
  try {
    const text = parts
      .map((p) => {
        if (p instanceof Error) return `${p.name}: ${p.message}${p.stack ? '\n' + p.stack : ''}`;
        if (typeof p === 'string') return p;
        try { return JSON.stringify(p); } catch { return String(p); }
      })
      .join(' ')
      .slice(0, 2000); // cap each entry
    _buffer.push({ kind, text, at: new Date().toISOString() });
    if (_buffer.length > MAX_ENTRIES) _buffer.shift();
  } catch {
    /* never let logging break the app */
  }
}

/**
 * Install the capture hooks. Safe to call multiple times (no-ops after first).
 * Wraps console.error (preserving original) and listens for window 'error' and
 * 'unhandledrejection'.
 */
export function installErrorCapture() {
  if (_installed || typeof window === 'undefined') return;
  _installed = true;

  const origError = console.error.bind(console);
  console.error = (...args) => {
    _push('console.error', args);
    origError(...args);
  };

  window.addEventListener('error', (e) => {
    _push('window.error', [e.message || 'Uncaught error', e.filename ? `(${e.filename}:${e.lineno}:${e.colno})` : '', e.error || '']);
  });

  window.addEventListener('unhandledrejection', (e) => {
    _push('unhandledrejection', [e.reason instanceof Error ? e.reason : `Unhandled rejection: ${String(e.reason)}`]);
  });
}

/** Return a shallow copy of the recent errors (most recent last). */
export function getRecentErrors() {
  return _buffer.slice();
}

/** Manually record an error into the buffer (e.g. a caught panel error). */
export function recordError(...parts) {
  _push('manual', parts);
}

/** Clear the buffer (used after a successful report, optional). */
export function clearErrors() {
  _buffer.length = 0;
}
