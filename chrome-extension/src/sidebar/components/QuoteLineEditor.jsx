/**
 * Quote Line Editor (2026-08-20)
 *
 * Quantity and discount edits, multi select delete and drag reorder on a Zoho
 * Quote, committed in ONE atomic worker PUT with an undo token.
 *
 * Fully controlled, exactly like SkuQuantityEditor: this file renders and
 * dispatches, and every decision (what changed, what dollars, what description,
 * whether the commit is legal) lives in quote-line-editor-core.mjs so it can be
 * unit tested without a DOM. Do not move logic in here.
 *
 * Mounted twice from the same source: standalone in the side panel via
 * sidebar.html?view=quote-lines, and inside the iframe overlay that
 * zoho-content.js pins onto the Zoho record page.
 *
 * Styled with the inline `S` object copied from ChatPanel.jsx:1305 and COLORS
 * from lib/constants.js. This codebase has no CSS class system.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COLORS } from '../../lib/constants';
import {
  applyBulkDiscount,
  applyEcommPricing,
  applyMarginPricing,
  buildOpsPayload,
  clampPct,
  descriptionForPct,
  diffAgainstOriginal,
  effectiveDollars,
  fmtPct,
  linesFromApi,
  marginPctForRow,
  markRowForDelete,
  unmarkRowForDelete,
  markSelectedForDelete,
  moveRow,
  moveRowToIndex,
  netForRow,
  resequence,
  setAllSelected,
  setRowDiscount,
  setRowQuantity,
  summarizeDiff,
  rowMatchesEcomm,
  toggleRowSelected,
  totalsForRows,
  undoDeletes,
  validateRows,
} from './quote-line-editor-core.mjs';

const cardStyle = { marginTop: 8, padding: 10, borderRadius: 8, border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY };
const S = {
  card: cardStyle,
  sec: cardStyle,
  lab: { fontSize: 10, fontWeight: 700, color: COLORS.TEXT_SECONDARY, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  in: { fontSize: 12, padding: '5px 8px', marginRight: 6, marginBottom: 4, borderRadius: 6, border: `1px solid ${COLORS.BORDER}`, background: COLORS.BG_PRIMARY, color: COLORS.TEXT_PRIMARY },
  btn: { fontSize: 11, fontWeight: 600, padding: '5px 10px', marginRight: 6, marginBottom: 4, borderRadius: 6, border: `1px solid ${COLORS.STRATUS_BLUE}`, background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_DARK, cursor: 'pointer' },
};

// The purple already used for Zoho actions elsewhere in the extension.
const ZOHO_PURPLE = '#7b1fa2';

// Terms the clone offers. 1/3/5 are the standard catalog terms and price at
// ecomm; 7 and 10 are co-term, Zoho-quote-only, and have no ecomm price by
// design, so the worker gives them the fixed co-term discount instead.
const CLONE_TERMS = [1, 3, 5, 7, 10];

const money = (value) => `$${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Exact, bounded refresh option sent to preview and write. */
export function cloneEolRefreshRequest(enabled, replacementPath = '') {
  const normalizedPath = String(replacementPath || '').trim().toLowerCase();
  return {
    enabled: enabled === true,
    replacementPath: enabled === true && ['1g', '10g'].includes(normalizedPath) ? normalizedPath : null,
  };
}

/** Refresh transforms selected term clones; it does not add another clone. */
export function requestedCloneCount(terms, refreshEnabled = false) {
  const uniqueTerms = new Set((Array.isArray(terms) ? terms : []).map(Number).filter((term) => CLONE_TERMS.includes(term)));
  return uniqueTerms.size || (refreshEnabled === true ? 1 : 0);
}

/** Fail closed unless this exact refresh request has a complete worker preview. */
export function refreshClonePreviewReady(previews, terms, refreshEnabled = false, replacementPath = '') {
  if (refreshEnabled !== true || !Array.isArray(previews)) return false;
  const expectedCount = requestedCloneCount(terms, true);
  if (expectedCount < 1 || previews.length !== expectedCount) return false;
  const expectedPath = cloneEolRefreshRequest(true, replacementPath).replacementPath;
  return previews.every((preview) => {
    const refresh = preview?.eol_refresh;
    if (preview?.available !== true || refresh?.enabled !== true || refresh?.complete !== true) return false;
    if (!expectedPath) return true;
    return String(refresh.replacement_path || '').trim().toLowerCase() === expectedPath;
  });
}

const arrayOf = (value) => (Array.isArray(value) ? value : []);

/** Normalize the worker's public refresh plan for one shared preview/result view. */
export function cloneEolRefreshDetails(entry) {
  const refresh = entry?.eol_refresh && typeof entry.eol_refresh === 'object' ? entry.eol_refresh : null;
  const warnings = [...new Set([
    ...arrayOf(refresh?.review_warnings),
    ...arrayOf(entry?.review_warnings),
    ...arrayOf(entry?.warnings),
  ].map((warning) => String(warning || '').trim()).filter(Boolean))];
  const unresolved = [...new Set([
    ...arrayOf(refresh?.unresolved),
    ...arrayOf(entry?.unresolved),
  ].map((item) => {
    if (typeof item === 'string' || typeof item === 'number') return String(item).trim();
    return String(item?.source_model || item?.sku || item?.model || item?.id || item?.description || '').trim();
  }).filter(Boolean))];
  const rawAlternatives = arrayOf(refresh?.alternatives).length
    ? refresh.alternatives
    : arrayOf(entry?.alternatives);
  const alternatives = rawAlternatives.map((item) => {
    if (typeof item === 'string') return item;
    return String(item?.sku || item?.model || item?.path || '').trim();
  }).filter(Boolean);
  return {
    refresh,
    replacements: arrayOf(refresh?.replacements),
    warnings,
    unresolved,
    alternatives,
  };
}

export function eolReplacementDescription(replacement, targetLine) {
  const explicit = String(targetLine?.description || replacement?.description || '').trim();
  if (explicit) return explicit;
  const source = String(replacement?.source_model || '').trim().toUpperCase();
  return source ? `Replaces EOL ${source}` : 'EOL replacement';
}

function EolRefreshSummary({ entry }) {
  const details = cloneEolRefreshDetails(entry);
  if (!details.refresh && details.warnings.length === 0 && details.unresolved.length === 0) return null;
  const pathLabel = details.refresh?.replacement_path
    ? ` · ${String(details.refresh.replacement_path).toUpperCase()} path`
    : '';
  return (
    <div style={{ marginTop: 5, padding: 6, borderRadius: 6, background: '#fff8e1', border: '1px solid #f0d9a0' }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#8a6100' }}>
        EOL refresh{pathLabel}: {details.replacements.length} replacement{details.replacements.length === 1 ? '' : 's'}
      </div>
      {details.replacements.map((replacement, replacementIndex) => (
        <div key={`${replacement.source_model || 'eol'}-${replacementIndex}`} style={{ marginTop: 4 }}>
          <div style={{ fontSize: 10, fontWeight: 600, color: COLORS.TEXT_PRIMARY }}>
            EOL {replacement.source_model || 'equipment'} → {arrayOf(replacement.target_lines).map((line) => line.sku).filter(Boolean).join(' + ') || 'replacement pending'}
          </div>
          {arrayOf(replacement.target_lines).map((line, lineIndex) => (
            <div key={`${line.sku || 'target'}-${lineIndex}`} style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, paddingLeft: 8 }}>
              {line.quantity} x {line.sku || 'target'}{line.role ? ` (${line.role})` : ''}
              {Number(line.unit_price) > 0 ? ` at ${money(line.unit_price)} each` : ''}
              {' · '}Description: "{eolReplacementDescription(replacement, line)}"
            </div>
          ))}
          {replacement.license_review_required && (
            <div style={{ fontSize: 9, color: '#8a6100', paddingLeft: 8 }}>License review required for this replacement.</div>
          )}
        </div>
      ))}
      {details.alternatives.length > 0 && (
        <div style={{ fontSize: 9, color: '#8a6100', marginTop: 4 }}>
          Available replacement paths: {details.alternatives.join(', ')}. Choose 1G or 10G above and preview again.
        </div>
      )}
      {details.unresolved.length > 0 && (
        <div style={{ fontSize: 9, color: '#c5221f', marginTop: 4 }}>
          Unresolved EOL lines: {details.unresolved.join(', ')}
        </div>
      )}
      {details.warnings.map((warning, index) => (
        <div key={`${warning}-${index}`} style={{ fontSize: 9, color: '#8a6100', marginTop: 3 }}>
          Review warning: {warning}
        </div>
      ))}
    </div>
  );
}

/**
 * @param {object}   props
 * @param {string}   props.recordId    Zoho record id parsed from the page URL
 * @param {string}   [props.module]    Quotes | Sales_Orders | Invoices | Purchase_Orders
 * @param {Function} props.onLoad      async (recordId, module) => api payload
 * @param {Function} props.onCommit    async (payload) => worker result
 * @param {Function} [props.onMatchEcomm] async (recordId, module) => ecomm prices
 * @param {Function} [props.onLoadCosts]  async (recordId, module) => distributor costs
 * @param {Function} [props.onPreviewCloneTerms] async (recordId, terms, eolRefresh) => clone previews
 * @param {Function} [props.onCloneTerms]  async (payload) => one result per term
 * @param {Function} [props.onClose]   present in the overlay, absent in the panel
 * @param {string}   [props.personId]
 */
export default function QuoteLineEditor({
  recordId,
  module = 'Quotes',
  onLoad,
  onCommit,
  onMatchEcomm,
  onLoadCosts,
  onPreviewCloneTerms,
  onCloneTerms,
  onClose,
  personId = '',
}) {
  const [meta, setMeta] = useState(null);
  const [original, setOriginal] = useState([]);
  const [rows, setRows] = useState([]);
  const [bulkPct, setBulkPct] = useState('');
  const [writeDescriptions, setWriteDescriptions] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [commitError, setCommitError] = useState('');
  const [commitResult, setCommitResult] = useState(null);
  const [ecommBusy, setEcommBusy] = useState(false);
  const [ecommNote, setEcommNote] = useState('');
  const [cloneTerms, setCloneTerms] = useState([]);
  const [cloneEolRefresh, setCloneEolRefresh] = useState(false);
  const [cloneReplacementPath, setCloneReplacementPath] = useState('');
  const [clonePreviews, setClonePreviews] = useState(null);
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneNote, setCloneNote] = useState('');
  const [cloneResults, setCloneResults] = useState(null);
  const [marginPct, setMarginPct] = useState('');
  const [marginBusy, setMarginBusy] = useState(false);
  const [marginNote, setMarginNote] = useState('');
  // Retain one idempotency key across an ambiguous network failure and any
  // manual retry of the exact same clone request. Changing terms/refresh
  // options creates a new fingerprint and therefore a new deliberate request.
  const cloneRequestRef = useRef(null);

  // The callbacks are held in a ref so the load effect depends on the RECORD,
  // not on prop identity. A parent that passes an inline arrow (the harness
  // does, and so would any casual caller) would otherwise hand this component a
  // new onLoad on every render, re-running the effect and wiping the rep's
  // uncommitted edits on every keystroke.
  const handlers = useRef({ onLoad, onCommit, onMatchEcomm, onLoadCosts, onPreviewCloneTerms, onCloneTerms });
  handlers.current = { onLoad, onCommit, onMatchEcomm, onLoadCosts, onPreviewCloneTerms, onCloneTerms };

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setCommitError('');
    setCommitResult(null);
    setEcommNote('');
    setMarginNote('');
    setCloneResults(null);
    setClonePreviews(null);
    setCloneNote('');
    setCloneTerms([]);
    setCloneEolRefresh(false);
    setCloneReplacementPath('');
    cloneRequestRef.current = null;
    try {
      const payload = await handlers.current.onLoad(recordId, module);
      if (payload?.error) { setLoadError(payload.error); setRows([]); setOriginal([]); setMeta(null); return; }
      const loaded = linesFromApi(payload);
      if (loaded.length === 0) { setLoadError('This record has no line items to edit.'); }
      setMeta(payload || null);
      setOriginal(loaded);
      setRows(loaded.map((row) => ({ ...row })));
    } catch (err) {
      setLoadError(err?.message || 'Could not load the quote line items.');
    } finally {
      setLoading(false);
    }
  }, [recordId, module]);

  useEffect(() => { load(); }, [load]);

  const validation = useMemo(() => validateRows(rows), [rows]);
  const diff = useMemo(
    () => diffAgainstOriginal(original, rows, { writeDescriptions }),
    [original, rows, writeDescriptions],
  );
  const totals = useMemo(() => totalsForRows(original, rows), [original, rows]);
  const selectedCount = rows.filter((row) => row.selected && !row.deleted).length;
  const deletedCount = rows.filter((row) => row.deleted).length;
  const cloneCount = requestedCloneCount(cloneTerms, cloneEolRefresh);
  const cloneRequestReady = cloneCount > 0;
  const cloneWriteReady = cloneRequestReady && (!cloneEolRefresh || refreshClonePreviewReady(
    clonePreviews,
    cloneTerms,
    cloneEolRefresh,
    cloneReplacementPath,
  ));
  // A refresh clone can be started immediately. If the rep has not previewed
  // it, runClones performs the identical read-only safety preview internally
  // and writes only after that exact plan is complete. A visible incomplete
  // preview remains a hard stop until the options change or it is re-run.
  const cloneActionReady = cloneRequestReady
    && (!cloneEolRefresh || clonePreviews === null || cloneWriteReady);

  // Same idea as QuoteResult.jsx:81's quoteActionsBlocked: uncommitted edits
  // invalidate every downstream artifact, so the customer-facing affordances
  // (open in Zoho, export PDF) stay hidden until the commit succeeds. A stale
  // PDF pulled mid edit is worse than no PDF.
  const quoteActionsBlocked = busy || ecommBusy || marginBusy || cloneBusy || diff.hasChanges;

  const commitDisabled = busy || ecommBusy || marginBusy || cloneBusy || !diff.hasChanges || !validation.ok;

  function update(next) {
    setRows(next);
    setCommitError('');
    setCommitResult(null);
  }

  function applyBulk() {
    const pct = clampPct(bulkPct);
    if (pct === null) return;
    update(applyBulkDiscount(rows, pct));
  }

  /**
   * Bring every line back into parity with the storefront.
   *
   * Read-only on its own: it resolves live prices, fills the rows in, and lets
   * the rep review the diff. Nothing reaches Zoho until Write to Zoho. Lines the
   * worker could not price are left exactly as they were and say why.
   */
  async function matchEcomm() {
    if (!onMatchEcomm) return;
    setEcommBusy(true);
    setEcommNote('');
    setCommitError('');
    setCommitResult(null);
    try {
      const response = await handlers.current.onMatchEcomm(recordId, module);
      if (response?.error) { setEcommNote(response.error); return; }
      const quotes = Array.isArray(response?.quotes) ? response.quotes : [];
      if (quotes.length === 0) { setEcommNote('The worker returned no ecomm prices for this record.'); return; }
      const next = applyEcommPricing(rows, quotes);
      setRows(next);
      const unpriced = next.filter((row) => row.ecommError).length;
      const priced = next.filter((row) => row.ecomm).length;
      setEcommNote(unpriced
        ? `${priced} line(s) matched to ecomm. ${unpriced} could not be priced and were left unchanged.`
        : `${priced} line(s) matched to ecomm. Review the diff, then write.`);
    } catch (err) {
      setEcommNote(err?.message || 'The ecomm price lookup failed.');
    } finally {
      setEcommBusy(false);
    }
  }

  /**
   * Price every line to a target profit margin off distributor cost, mirroring
   * Zoho's own "Costs By Lines" margin function.
   *
   * Read-only until the rep commits: it pulls the Vendor_Lines costs, fills the
   * rows in, and shows the diff. Lines with no cost row, or whose cost row is
   * priced for a different quantity, are left alone and say why.
   */
  async function applyMargin() {
    if (!onLoadCosts) return;
    const target = clampPct(marginPct);
    if (target === null || target < 0 || target >= 95) {
      setMarginNote('Enter a margin between 0 and 95 percent.');
      return;
    }
    setMarginBusy(true);
    setMarginNote('');
    setCommitError('');
    setCommitResult(null);
    try {
      const response = await handlers.current.onLoadCosts(recordId, module);
      if (response?.error) { setMarginNote(response.error); return; }
      const costs = Array.isArray(response?.costs) ? response.costs : [];
      if (costs.length === 0) { setMarginNote('This quote has no distributor cost lines, so no margin can be priced.'); return; }
      const next = applyMarginPricing(rows, costs, target);
      setRows(next);
      const priced = next.filter((row) => row.cost).length;
      const blocked = next.filter((row) => row.costError).length;
      setMarginNote(blocked
        ? `${priced} line(s) priced to ${fmtPct(target)}% margin. ${blocked} had no usable cost row and were left unchanged.`
        : `${priced} line(s) priced to ${fmtPct(target)}% margin. Review the diff, then write.`);
    } catch (err) {
      setMarginNote(err?.message || 'The distributor cost lookup failed.');
    } finally {
      setMarginBusy(false);
    }
  }

  function toggleCloneTerm(term) {
    setCloneResults(null);
    setClonePreviews(null);
    setCloneNote('');
    setCloneTerms((current) => (current.includes(term)
      ? current.filter((t) => t !== term)
      : [...current, term].sort((a, b) => a - b)));
  }

  function toggleCloneEolRefresh(on) {
    setCloneEolRefresh(on);
    setCloneResults(null);
    setClonePreviews(null);
    setCloneNote('');
  }

  function chooseCloneReplacementPath(path) {
    setCloneReplacementPath(path);
    setCloneResults(null);
    setClonePreviews(null);
    setCloneNote('');
  }

  /** Read-only: show what each selected term would produce, before creating anything. */
  async function previewClones() {
    if (!onPreviewCloneTerms || !cloneRequestReady) return;
    setCloneBusy(true);
    setCloneNote('');
    setCloneResults(null);
    setClonePreviews(null);
    try {
      const response = await handlers.current.onPreviewCloneTerms(
        recordId,
        cloneTerms,
        cloneEolRefreshRequest(cloneEolRefresh, cloneReplacementPath),
      );
      if (response?.error) { setCloneNote(response.error); return; }
      setClonePreviews(Array.isArray(response?.previews) ? response.previews : []);
    } catch (err) {
      setCloneNote(err?.message || 'The clone preview failed.');
    } finally {
      setCloneBusy(false);
    }
  }

  /**
   * Create one NEW Zoho quote per selected term.
   *
   * Hardware is carried over untouched; only termed licence lines are swapped,
   * priced at ecomm (7YR/10YR take the fixed co-term discount, which has no
   * ecomm equivalent). Never auto-retried: a retry after a partial failure
   * would leave duplicate quotes behind.
   */
  async function runClones() {
    if (!onCloneTerms || !cloneRequestReady) return;
    setCloneBusy(true);
    setCloneNote('');
    setCloneResults(null);
    try {
      if (cloneEolRefresh && !refreshClonePreviewReady(
        clonePreviews,
        cloneTerms,
        cloneEolRefresh,
        cloneReplacementPath,
      )) {
        if (!handlers.current.onPreviewCloneTerms) {
          setCloneNote('The required refresh safety preview is unavailable. Nothing was cloned.');
          return;
        }
        const previewResponse = await handlers.current.onPreviewCloneTerms(
          recordId,
          cloneTerms,
          cloneEolRefreshRequest(cloneEolRefresh, cloneReplacementPath),
        );
        if (previewResponse?.error) {
          setCloneNote(`${previewResponse.error} Nothing was cloned.`);
          return;
        }
        const previews = Array.isArray(previewResponse?.previews) ? previewResponse.previews : [];
        setClonePreviews(previews);
        if (!refreshClonePreviewReady(
          previews,
          cloneTerms,
          cloneEolRefresh,
          cloneReplacementPath,
        )) {
          setCloneNote('The automatic refresh safety preview was incomplete or unsupported. Nothing was cloned.');
          return;
        }
      }
      const requestFingerprint = JSON.stringify({
        recordId,
        terms: [...cloneTerms].map(Number).sort((a, b) => a - b),
        eolRefresh: cloneEolRefreshRequest(cloneEolRefresh, cloneReplacementPath),
      });
      if (cloneRequestRef.current?.fingerprint !== requestFingerprint) {
        cloneRequestRef.current = {
          fingerprint: requestFingerprint,
          requestId: globalThis.crypto?.randomUUID
            ? globalThis.crypto.randomUUID()
            : `clone-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        };
      }
      const response = await handlers.current.onCloneTerms({
        recordId,
        terms: cloneTerms,
        personId,
        eolRefresh: cloneEolRefreshRequest(cloneEolRefresh, cloneReplacementPath),
        requestId: cloneRequestRef.current.requestId,
      });
      if (response?.error) { cloneRequestRef.current = null; setCloneNote(response.error); return; }
      const results = Array.isArray(response?.results) ? response.results : [];
      setCloneResults(results);
      const ok = results.filter((r) => r.success).length;
      if (results.length > 0 && ok === results.length) cloneRequestRef.current = null;
      setCloneNote(ok === results.length
        ? `${ok} quote(s) created and verified.`
        : `${ok} of ${results.length} clone(s) succeeded. Read each result below before using them.`);
    } catch (err) {
      setCloneNote(err?.message || 'The clone failed to reach the worker.');
    } finally {
      setCloneBusy(false);
    }
  }

  async function commit() {
    const built = buildOpsPayload(original, rows, {
      recordId,
      module,
      personId,
      writeDescriptions,
    });
    if (!built.ok) { setCommitError(built.error); return; }
    setBusy(true);
    setCommitError('');
    setCommitResult(null);
    try {
      // apiCall has no retry and zohoApiCall has no 429 retry, so a failed
      // commit is never retried automatically. The local edits stay on screen
      // so the rep can decide to send it again.
      const result = await handlers.current.onCommit(built.payload);
      setCommitResult(result || null);
      if (result?.success) {
        const committed = rows.filter((row) => !row.deleted).map((row) => ({ ...row, dirty: false, selected: false }));
        const fresh = resequence(committed);
        setOriginal(fresh.map((row) => ({ ...row })));
        setRows(fresh);
      } else {
        setCommitError(result?.verification?.WARNING || result?.message || 'The write did not verify. Nothing here was changed locally.');
      }
    } catch (err) {
      setCommitError(err?.message || 'The commit failed to reach the worker.');
    } finally {
      setBusy(false);
    }
  }

  function onDragStart(event, id) {
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
  }
  function onDrop(event, index) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain');
    if (id) update(moveRowToIndex(rows, id, index));
  }

  if (loading) {
    return <div style={{ padding: 16, fontSize: 12, color: COLORS.TEXT_SECONDARY }}>Loading quote line items…</div>;
  }

  return (
    <div style={{ padding: 10, background: COLORS.BG_SECONDARY, minHeight: '100%', boxSizing: 'border-box' }}>
      {/* ── 1. Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span style={{
          background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_DARK, borderRadius: 10,
          padding: '2px 8px', fontSize: 10, fontWeight: 700, letterSpacing: 0.4,
        }}>
          ⚡ QUOTE LINES
        </span>
        <span style={{ fontSize: 12, fontWeight: 700, color: COLORS.TEXT_PRIMARY, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {meta?.subject || meta?.quoteNumber || recordId}
        </span>
        {meta?.quoteNumber && (
          <span style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY }}>{meta.quoteNumber}</span>
        )}
        {onClose && (
          <button type="button" onClick={onClose} title="Close the quote line editor"
            style={{ ...S.btn, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', color: COLORS.TEXT_SECONDARY, marginRight: 0 }}>
            ✕
          </button>
        )}
      </div>

      <div style={{ ...S.card, display: 'flex', gap: 14, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <div style={S.lab}>Net now</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: COLORS.TEXT_PRIMARY }}>{money(totals.before)}</div>
        </div>
        <div>
          <div style={S.lab}>Net after</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: diff.hasChanges ? ZOHO_PURPLE : COLORS.TEXT_PRIMARY }}>{money(totals.after)}</div>
        </div>
        <div>
          <div style={S.lab}>Change</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: totals.delta < 0 ? '#188038' : COLORS.TEXT_SECONDARY }}>
            {totals.delta === 0 ? 'none' : money(totals.delta)}
          </div>
        </div>
        <div style={{ flex: 1 }} />
        {!quoteActionsBlocked && meta?.quoteId && (
          <a
            href={`https://crm.zoho.com/crm/org647122552/tab/${module}/${meta.quoteId}`}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: 11, color: COLORS.STRATUS_BLUE, textDecoration: 'none' }}
          >
            Open in Zoho ↗
          </a>
        )}
        {quoteActionsBlocked && (
          <span style={{ fontSize: 10, color: '#8a6100' }}>
            Uncommitted edits. Zoho links and PDF export are hidden until you write.
          </span>
        )}
      </div>

      {loadError && (
        <div style={{ ...S.card, background: '#fce8e6', border: '1px solid #f5c6c2', color: COLORS.ERROR, fontSize: 11 }}>
          {loadError}
          <button type="button" onClick={load} style={{ ...S.btn, marginLeft: 8 }}>Retry</button>
        </div>
      )}

      {/* ── 2. Bulk action bar ── */}
      <div style={S.sec}>
        <div style={S.lab}>Bulk actions</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
          <input
            aria-label="Bulk discount percent"
            type="number"
            inputMode="decimal"
            min="0"
            max="100"
            step="0.01"
            placeholder="%"
            value={bulkPct}
            disabled={busy}
            onChange={(event) => setBulkPct(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') applyBulk(); }}
            style={{ ...S.in, width: 68, marginRight: 2 }}
          />
          <button type="button" style={S.btn} disabled={busy || clampPct(bulkPct) === null} onClick={applyBulk}>
            Apply to all
          </button>
          {onMatchEcomm && (
            <button
              type="button"
              title="Set every line's discount so its unit price equals the live stratusinfosystems.com price"
              style={{ ...S.btn, borderColor: '#188038', background: '#e6f4ea', color: '#188038' }}
              disabled={busy || ecommBusy}
              onClick={matchEcomm}
            >
              {ecommBusy ? 'Resolving ecomm prices…' : 'Match ecomm pricing'}
            </button>
          )}
          <button type="button" style={S.btn} disabled={busy} onClick={() => update(setAllSelected(rows, true))}>
            Select all
          </button>
          <button type="button" style={S.btn} disabled={busy || selectedCount === 0} onClick={() => update(setAllSelected(rows, false))}>
            Clear
          </button>
          <button
            type="button"
            style={{ ...S.btn, border: '1px solid #f5c6c2', background: '#fce8e6', color: '#c5221f' }}
            disabled={busy || selectedCount === 0}
            onClick={() => update(resequence(markSelectedForDelete(rows)))}
          >
            Delete selected ({selectedCount})
          </button>
          <button type="button" style={S.btn} disabled={busy || deletedCount === 0} onClick={() => update(resequence(undoDeletes(rows)))}>
            Undo delete ({deletedCount})
          </button>
        </div>
        {onLoadCosts && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <input
              aria-label="Target margin percent"
              type="number"
              inputMode="decimal"
              min="0"
              max="94.99"
              step="0.01"
              placeholder="margin %"
              value={marginPct}
              disabled={busy || marginBusy}
              onChange={(event) => setMarginPct(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') applyMargin(); }}
              style={{ ...S.in, width: 78, marginRight: 2 }}
            />
            <button
              type="button"
              title="Discount every line so it earns this profit margin over distributor cost, the same maths as Zoho's Costs By Lines"
              style={{ ...S.btn, borderColor: '#7b1fa2', background: '#f3e5f5', color: '#7b1fa2' }}
              disabled={busy || marginBusy || clampPct(marginPct) === null}
              onClick={applyMargin}
            >
              {marginBusy ? 'Reading distributor cost…' : 'Apply margin'}
            </button>
            <span style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY }}>
              sell = cost / (1 - margin)
            </span>
          </div>
        )}
        {marginNote && (
          <div style={{ fontSize: 10, color: /had no usable|failed|Enter a margin|no distributor/.test(marginNote) ? '#8a6100' : '#188038', marginTop: 4 }}>
            {marginNote}
          </div>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 10, color: COLORS.TEXT_PRIMARY, cursor: busy ? 'default' : 'pointer' }}>
          <input
            type="checkbox"
            aria-label="Include discount percentage in line descriptions"
            checked={writeDescriptions}
            disabled={busy}
            onChange={(event) => {
              setWriteDescriptions(event.target.checked);
              setCommitError('');
              setCommitResult(null);
            }}
          />
          Include discount percentage in line descriptions
        </label>
        <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginTop: 3 }}>
          {writeDescriptions
            ? 'Edited discount lines replace their description with the discount; 0% clears it.'
            : 'Existing line descriptions, including blanks, will be preserved.'}
        </div>
        {ecommNote && (
          <div style={{ fontSize: 10, color: ecommNote.includes('could not') || ecommNote.includes('failed') ? '#8a6100' : '#188038', marginTop: 4 }}>
            {ecommNote}
          </div>
        )}
      </div>

      {/* ── 3. Row grid ── */}
      <div style={S.sec}>
        <div style={S.lab}>Line items ({rows.length})</div>
        {rows.map((row, index) => {
          const dollars = effectiveDollars(row);
          const matched = rowMatchesEcomm(row);
          return (
            <div
              key={row.id}
              draggable={!busy && !row.deleted}
              onDragStart={(event) => onDragStart(event, row.id)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => onDrop(event, index)}
              style={{
                padding: '4px 2px', marginBottom: 2,
                borderBottom: `1px solid ${COLORS.BORDER}`,
                opacity: row.deleted ? 0.5 : 1,
                background: row.dirty && !row.deleted ? '#fffdf5' : 'transparent',
              }}
            >
              {/* Line 1: identity. Kept on its own row so a long SKU is never
                  squeezed out of existence by the numeric controls, which is
                  what a single flex row did at side-panel width. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  type="checkbox"
                  aria-label={`Select line ${index + 1}`}
                  checked={!!row.selected}
                  disabled={busy || row.deleted}
                  onChange={() => update(toggleRowSelected(rows, row.id))}
                />
                <span title="Drag to reorder" style={{ cursor: row.deleted ? 'default' : 'grab', color: COLORS.TEXT_SECONDARY, fontSize: 12 }}>⋮⋮</span>
                <span style={{ minWidth: 14, fontSize: 10, color: COLORS.TEXT_SECONDARY, textAlign: 'right' }}>{row.sequence ?? ''}</span>
                <span
                  title={row.name || row.sku}
                  style={{
                    flex: 1, minWidth: 0, fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY,
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    textDecoration: row.deleted ? 'line-through' : 'none',
                  }}
                >
                  {row.sku || row.name || row.id}
                </span>
                {row.cost && (
                  <span title={`Distributor cost ${money(row.cost.distiTotal)}, sell ${money(row.cost.sell)}, gross profit ${money(row.cost.grossProfit)}`}
                    style={{ fontSize: 9, fontWeight: 700, color: '#7b1fa2', background: '#f3e5f5', borderRadius: 8, padding: '1px 5px' }}>
                    {fmtPct(marginPctForRow(row) ?? row.cost.marginPct)}% MARGIN
                  </span>
                )}
                {matched && (
                  <span title={`Matched to the ecomm price ${money(row.ecomm.price)} per unit`}
                    style={{ fontSize: 9, fontWeight: 700, color: '#188038', background: '#e6f4ea', borderRadius: 8, padding: '1px 5px' }}>
                    ECOMM
                  </span>
                )}
                <button
                  type="button"
                  title={row.deleted ? 'Keep this line' : 'Remove this line'}
                  disabled={busy}
                  onClick={() => update(resequence(row.deleted ? unmarkRowForDelete(rows, row.id) : markRowForDelete(rows, row.id)))}
                  style={{ padding: '1px 6px', borderRadius: 4, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', color: row.deleted ? COLORS.STRATUS_BLUE : '#c5221f', cursor: 'pointer', fontSize: 11 }}
                >
                  {row.deleted ? '↺' : '×'}
                </button>
              </div>

              {/* Line 2: the numbers. */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2, paddingLeft: 18 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  {/* Keyboard reorder, for accessibility and for when dragging
                      inside the overlay iframe misbehaves. */}
                  <button type="button" aria-label={`Move line ${index + 1} up`} disabled={busy || index === 0}
                    onClick={() => update(moveRow(rows, row.id, 'up'))}
                    style={{ fontSize: 7, lineHeight: 1, padding: '1px 3px', border: `1px solid ${COLORS.BORDER}`, borderRadius: 3, background: 'transparent', cursor: 'pointer' }}>▲</button>
                  <button type="button" aria-label={`Move line ${index + 1} down`} disabled={busy || index === rows.length - 1}
                    onClick={() => update(moveRow(rows, row.id, 'down'))}
                    style={{ fontSize: 7, lineHeight: 1, padding: '1px 3px', border: `1px solid ${COLORS.BORDER}`, borderRadius: 3, background: 'transparent', cursor: 'pointer' }}>▼</button>
                </div>
                <input
                  aria-label={`Quantity for line ${index + 1}`}
                  title="Quantity"
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="99999"
                  step="1"
                  value={row.qty}
                  disabled={busy || row.deleted}
                  onChange={(event) => update(setRowQuantity(rows, row.id, event.target.value))}
                  style={{ ...S.in, width: 54, marginRight: 0, marginBottom: 0, padding: '3px 4px' }}
                />
                <span style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, whiteSpace: 'nowrap' }}>
                  x {money(row.listPrice)}
                </span>
                <div style={{ flex: 1 }} />
                <input
                  aria-label={`Discount percent for line ${index + 1}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  max="100"
                  step="0.01"
                  value={row.discountPct}
                  disabled={busy || row.deleted}
                  onChange={(event) => update(setRowDiscount(rows, row.id, event.target.value))}
                  style={{ ...S.in, width: 58, marginRight: 0, marginBottom: 0, padding: '3px 4px' }}
                />
                <span style={{ minWidth: 70, fontSize: 10, color: COLORS.TEXT_SECONDARY, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(dollars)}</span>
                <span style={{ minWidth: 78, fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY, textAlign: 'right', whiteSpace: 'nowrap' }}>{money(netForRow(row))}</span>
              </div>

              {/* Line 3: only when there is something to say. */}
              {row.dirty && !row.deleted && (
                <div style={{ fontSize: 9, color: '#8a6100', paddingLeft: 18, marginTop: 1 }}>
                  {writeDescriptions
                    ? `description becomes "${descriptionForPct(row.discountPct) || '(blank)'}"`
                    : 'description stays as-is'}
                  {row.ecomm ? ` · ecomm ${money(row.ecomm.price)} each` : ''}
                  {row.cost ? ` · cost ${money(row.cost.distiTotal)}, profit ${money(row.cost.grossProfit)}` : ''}
                </div>
              )}
              {row.ecommError && (
                <div style={{ fontSize: 9, color: '#c5221f', paddingLeft: 18, marginTop: 1 }}>{row.ecommError}</div>
              )}
              {row.costError && (
                <div style={{ fontSize: 9, color: '#c5221f', paddingLeft: 18, marginTop: 1 }}>{row.costError}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 4. Diff summary. Nothing commits until this is non empty. ── */}
      {diff.hasChanges && (
        <div style={{ ...S.sec, background: '#fef7e0', border: '1px solid #f0d9a0' }}>
          <div style={{ ...S.lab, color: '#8a6100' }}>Pending changes</div>
          <div style={{ fontSize: 11, color: '#8a6100', fontWeight: 600 }}>{summarizeDiff(diff)}</div>
          {diff.descriptionChanges.length > 0 && (
            <div style={{ marginTop: 6 }}>
              {diff.descriptionChanges.map((change) => (
                <div key={change.id} style={{ fontSize: 10, color: '#8a6100' }}>
                  {change.sku || change.id}: "{change.from || '(blank)'}" becomes "{change.to || '(blank)'}"
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!validation.ok && (
        <div style={{ ...S.sec, background: '#fce8e6', border: '1px solid #f5c6c2', color: COLORS.ERROR, fontSize: 11 }}>
          {validation.error}
        </div>
      )}

      {/* ── 5. Clone onto other licence terms and/or refresh EOL equipment ── */}
      {onCloneTerms && (
        <div style={{ ...S.sec, background: '#f3e5f5', border: '1px solid #e1bee7' }}>
          <div style={{ ...S.lab, color: ZOHO_PURPLE }}>Clone quote options</div>
          <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
            Creates a NEW quote per selected term. Term clones reprice the matching licences.
            The optional EOL refresh replaces retired model-specific equipment with current
            catalog models on each clone. Refresh can also create one clone without changing terms.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {CLONE_TERMS.map((term) => (
              <label key={term} style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: COLORS.TEXT_PRIMARY, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  aria-label={`Clone to ${term} year`}
                  checked={cloneTerms.includes(term)}
                  disabled={busy || cloneBusy}
                  onChange={() => toggleCloneTerm(term)}
                />
                {term}yr
              </label>
            ))}
          </div>
          <div style={{ marginTop: 7, paddingTop: 7, borderTop: `1px solid ${COLORS.BORDER}` }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: COLORS.TEXT_PRIMARY, cursor: busy || cloneBusy ? 'default' : 'pointer' }}>
              <input
                type="checkbox"
                aria-label="Include end-of-life equipment refresh"
                checked={cloneEolRefresh}
                disabled={busy || cloneBusy}
                onChange={(event) => toggleCloneEolRefresh(event.target.checked)}
              />
              Replace EOL equipment with current models
            </label>
            {cloneEolRefresh && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 5, flexWrap: 'wrap' }}>
                <label htmlFor="clone-eol-replacement-path" style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY }}>
                  Replacement path
                </label>
                <select
                  id="clone-eol-replacement-path"
                  aria-label="EOL replacement path preference"
                  value={cloneReplacementPath}
                  disabled={busy || cloneBusy}
                  onChange={(event) => chooseCloneReplacementPath(event.target.value)}
                  style={{ ...S.in, marginRight: 0, marginBottom: 0, padding: '3px 5px' }}
                >
                  <option value="">Choose only when needed</option>
                  <option value="1g">Prefer 1G replacement</option>
                  <option value="10g">Prefer 10G replacement</option>
                </select>
                <span style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY }}>
                  A choice is required only when an EOL model has both paths.
                </span>
              </div>
            )}
            {cloneEolRefresh && (
              <div style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, marginTop: 4 }}>
                Replacement line descriptions always name the retired model as "Replaces EOL [model]".
                {' '}Model-agnostic MR, MV, MT, and Systems Manager licences stay unchanged on a
                refresh-only clone; selected term clones still move them to the selected term.
              </div>
            )}
            {cloneEolRefresh && (
              <div style={{ fontSize: 9, color: clonePreviews && !cloneWriteReady ? '#c5221f' : COLORS.TEXT_SECONDARY, marginTop: 4 }}>
                {cloneWriteReady
                  ? 'Refresh preview is complete. Review it below before cloning.'
                  : clonePreviews
                    ? 'Refresh preview is incomplete or unsupported. No quote can be created.'
                    : 'Clone runs this exact safety preview automatically. Use Preview if you want to review it first.'}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7, flexWrap: 'wrap' }}>
            <div style={{ flex: 1 }} />
            {onPreviewCloneTerms && (
              <button type="button" style={S.btn} disabled={busy || cloneBusy || !cloneRequestReady} onClick={previewClones}>
                {cloneBusy ? 'Working…' : 'Preview'}
              </button>
            )}
            <button
              type="button"
              title="Create the Zoho clone or clones after the refresh safety check"
              style={{
                padding: '6px 12px', borderRadius: 6, border: 'none', fontSize: 11, fontWeight: 700,
                background: (busy || cloneBusy || !cloneActionReady) ? '#9aa0a6' : ZOHO_PURPLE,
                color: '#fff', cursor: (busy || cloneBusy || !cloneActionReady) ? 'default' : 'pointer',
              }}
              disabled={busy || cloneBusy || !cloneActionReady}
              onClick={runClones}
            >
              {cloneBusy ? 'Cloning…' : `Clone ${cloneCount} quote${cloneCount === 1 ? '' : 's'}`}
            </button>
          </div>

          {diff.hasChanges && (
            <div style={{ fontSize: 10, color: '#8a6100', marginTop: 5 }}>
              The clone is made from what Zoho holds now, not your uncommitted edits. Write them
              first if you want them included.
            </div>
          )}
          {cloneNote && (
            <div style={{ fontSize: 10, marginTop: 5, color: /fail|could not|of \d+ clone|must|required|nothing/i.test(cloneNote) ? '#c5221f' : '#188038' }}>
              {cloneNote}
            </div>
          )}

          {/* Preview: what each term would produce. Nothing has been created. */}
          {clonePreviews && !cloneResults && clonePreviews.map((preview, previewIndex) => {
            const swaps = arrayOf(preview.swaps);
            const refresh = cloneEolRefreshDetails(preview);
            const label = preview.target_term ? `${preview.target_term} year` : 'Refresh only';
            return (
              <div key={`${preview.target_term ?? 'refresh'}-${previewIndex}`} style={{ marginTop: 6, paddingTop: 5, borderTop: `1px solid ${COLORS.BORDER}` }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: preview.available ? COLORS.TEXT_PRIMARY : '#c5221f' }}>
                  {label}
                  {preview.available
                    ? ` · ${swaps.length} licence line(s), ${refresh.replacements.length} EOL replacement(s), ${preview.untouched_count || 0} carried over`
                    : ' · not possible'}
                </div>
                {!preview.available && (
                  <div style={{ fontSize: 9, color: '#c5221f' }}>{preview.message}</div>
                )}
                {preview.available && swaps.map((swap, swapIndex) => (
                  <div key={`${swap.sku || 'swap'}-${swapIndex}`} style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY }}>
                    {swap.quantity} x {swap.sku} becomes {swap.target_sku} at {money(swap.unit_price)} each
                    {swap.pricing === 'ecomm' ? ' (ecomm)' : ` (${swap.discount_pct}% off list, co-term)`}
                  </div>
                ))}
                {preview.available && swaps.length > 0 && (
                  <div style={{ fontSize: 10, color: COLORS.TEXT_PRIMARY, marginTop: 2 }}>
                    licences {money(preview.licence_total_before)} becomes {money(preview.licence_total_after)}
                  </div>
                )}
                <EolRefreshSummary entry={preview} />
              </div>
            );
          })}

          {/* Results: real records now exist, so every one is reported. */}
          {cloneResults && cloneResults.map((result, resultIndex) => {
            const refresh = cloneEolRefreshDetails(result);
            const label = result.target_term ? `${result.target_term} year` : 'Refresh only';
            return (
              <div
                key={`${result.cloned_quote_id || result.target_term || 'refresh'}-${resultIndex}`}
                style={{
                  marginTop: 6, padding: 6, borderRadius: 6,
                  background: result.success ? '#e6f4ea' : '#fce8e6',
                  border: `1px solid ${result.success ? '#b7e1c4' : '#f5c6c2'}`,
                }}
              >
                <div style={{ fontSize: 11, fontWeight: 700, color: result.success ? '#188038' : COLORS.ERROR }}>
                  {label} {result.success ? 'created and verified' : 'did not complete'}
                </div>
                {result.success && (
                  <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY }}>
                    {arrayOf(result.swaps).length} licence line(s) swapped, {refresh.replacements.length} EOL replacement(s), {arrayOf(result.untouched).length} carried over.
                    {result.clone_grand_total != null ? ` Total ${money(result.clone_grand_total)}.` : ''}
                  </div>
                )}
                {!result.success && (
                  <div style={{ fontSize: 10, color: COLORS.ERROR }}>{result.message}</div>
                )}
                <EolRefreshSummary entry={result} />
                {result.cloned_quote_url && (
                  <a href={result.cloned_quote_url} target="_blank" rel="noreferrer"
                    style={{ display: 'inline-block', marginTop: 3, fontSize: 10, color: COLORS.STRATUS_BLUE }}>
                    Open {result.cloned_quote_number || 'the clone'} in Zoho ↗
                  </a>
                )}
                {result._undo_token && (
                  <div style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, marginTop: 2 }}>
                    Undo token: <code>{result._undo_token}</code>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── 6. Commit row ── */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
        <button
          type="button"
          disabled={commitDisabled}
          onClick={commit}
          style={{
            padding: '7px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 700,
            background: commitDisabled ? '#9aa0a6' : ZOHO_PURPLE, color: '#fff',
            cursor: commitDisabled ? 'default' : 'pointer',
          }}
        >
          {busy ? 'Writing to Zoho…' : 'Write to Zoho'}
        </button>
        <button type="button" style={S.btn} disabled={busy || !diff.hasChanges} onClick={() => update(original.map((row) => ({ ...row })))}>
          Discard edits
        </button>
        <button type="button" style={S.btn} disabled={busy} onClick={load}>Reload from Zoho</button>
      </div>

      {commitError && (
        <div style={{ ...S.sec, background: '#fce8e6', border: '1px solid #f5c6c2', color: COLORS.ERROR, fontSize: 11 }}>
          {commitError}
          <div style={{ color: COLORS.TEXT_SECONDARY, marginTop: 4 }}>
            Your edits are still here. Nothing is retried automatically; press Write to Zoho again when you are ready.
          </div>
        </div>
      )}

      {commitResult?.success && (
        <div style={{ ...S.sec, background: '#e6f4ea', border: '1px solid #b7e1c4', color: '#188038', fontSize: 11 }}>
          <div style={{ fontWeight: 700 }}>{summarizeCommit(commitResult)}</div>
          {commitResult._undo_token && (
            <div style={{ marginTop: 4, color: COLORS.TEXT_SECONDARY }}>
              Undo token: <code>{commitResult._undo_token}</code> (say "undo" in chat to reverse).
            </div>
          )}
          {commitResult._record_url && (
            <a href={commitResult._record_url} target="_blank" rel="noreferrer" style={{ display: 'inline-block', marginTop: 4, color: COLORS.STRATUS_BLUE }}>
              Open in Zoho ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/** Success banner text. Kept out of the JSX so the copy is easy to read. */
function summarizeCommit(result) {
  const parts = [];
  if (result?.lines?.length) parts.push(`${result.lines.length} line${result.lines.length === 1 ? '' : 's'} repriced`);
  if (result?.quantities?.length) parts.push(`${result.quantities.length} quantity change${result.quantities.length === 1 ? '' : 's'}`);
  if (result?.deletes?.length) parts.push(`${result.deletes.length} deleted`);
  if (result?.reorder?.length) parts.push('reordered');
  const detail = parts.length ? parts.join(', ') : 'quote updated';
  return `Written and verified: ${detail}.`;
}
