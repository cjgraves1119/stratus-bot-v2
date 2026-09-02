import { useEffect, useId, useRef, useState } from 'react';
import { COLORS } from '../../lib/constants';
import {
  applyLinkedQuoteRowPatch,
  applyQuoteEditorHardwareLicenseUse,
  blankStandaloneRenewalRow,
  commitQuoteEditorSkuDraft,
  defaultLicenseTierLabelForSku,
  groupQuoteEditorRows,
  licenseTermFromSku,
  licensePairReviewForRows,
  licenseTierOptionsForSku,
  normalizeSkuEditorRows,
  QUOTE_TERM_OPTIONS,
  quoteEditorHardwareLicenseUse,
  quoteEditorPresentationRole,
  quoteRouteForRows,
  quoteTextFromEditorRows,
  removeLinkedQuoteRow,
  resolveRowAvailabilityFromSearch,
  rowsForLinkedQuoteRebuild,
  rowAvailabilityState,
  selectQuoteEditorProduct,
  termFromLicenseRows,
  withDefaultPairedLicenseIntents,
} from './sku-editor-core.mjs';

const EMPTY_SEARCH = { index: -1, query: '', loading: false, products: [], error: '', highlight: -1 };
// `baseSku` is the canonical SKU the row had when the draft started. Index
// alone is not a stable identity across a parent-driven row replacement
// (rebuild, restore), so a draft whose row no longer matches is discarded
// instead of being committed onto whichever row now sits at that index.
const EMPTY_DRAFT = { index: -1, text: '', baseSku: '' };
const CONTROL_STYLE = {
  width: '100%', minWidth: 0, boxSizing: 'border-box', fontSize: 10,
  padding: '5px 6px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`,
  background: '#fff', color: COLORS.TEXT_PRIMARY,
};
const PLACEHOLDER_STYLE = {
  minHeight: 28, display: 'flex', alignItems: 'center', color: COLORS.TEXT_SECONDARY,
  fontSize: 10, padding: '0 6px',
};

export default function SkuQuantityEditor({
  rows,
  onRowsChange,
  onUpdate,
  onProductSearch,
  dirty = false,
  disabled = false,
  title = 'Quote items',
  updateLabel = 'Update quote',
  status = '',
  tier = '',
  onTierChange,
  term,
  onTermChange,
  onDraftActivityChange,
  allowHaLicenseRatio = false,
}) {
  const values = withDefaultPairedLicenseIntents(Array.isArray(rows) ? rows : [], { allowHaLicenseRatio });
  const validation = normalizeSkuEditorRows(values);
  // Derived on every render from the controlled rows. The reducer uses this
  // relationship metadata for UI synchronization only; final SKU derivation
  // and aggregation remain in the Worker.
  const pairReview = licensePairReviewForRows(values, { allowHaLicenseRatio });
  const groupedRows = groupQuoteEditorRows(values, pairReview);
  const groupKeyByIndex = new Map(groupedRows.flatMap((group) => (
    group.entries.map(({ index }) => [index, group.key])
  )));
  // Fail-closed routing: a selected live product whose storefront status is
  // still unknown blocks Generate/Update here as well as in serialization.
  const route = quoteRouteForRows(values);
  const routeBlocked = route.route === 'blocked';
  const [search, setSearch] = useState(EMPTY_SEARCH);
  // Typing edits this local draft only. The canonical row SKU changes when the
  // rep picks a result, presses Enter, or leaves the field, so a row cannot
  // regroup or jump between sections mid-keystroke.
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [checkingSkus, setCheckingSkus] = useState(() => new Set());
  const searchTokenRef = useRef(0);
  const searchTimerRef = useRef(null);
  const mountedRef = useRef(true);
  // Latest controlled rows for async completions (availability checks) so a
  // late response patches the current rows rather than a stale render.
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const listIdPrefix = useId();

  const draftActive = draft.index >= 0;
  const effectiveTerm = term === undefined ? (termFromLicenseRows(values) || '') : String(term || '');
  const preflight = quoteTextFromEditorRows(
    rowsForLinkedQuoteRebuild(values, { allowHaLicenseRatio }),
    '',
    {
      haRequested: allowHaLicenseRatio,
      ...(term === undefined ? {} : { term: effectiveTerm }),
    },
  );
  const updateBlocked = draftActive || !validation.ok || routeBlocked || !preflight.ok;

  useEffect(() => {
    onDraftActivityChange?.(draftActive);
    return () => onDraftActivityChange?.(false);
  }, [draftActive, onDraftActivityChange]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTokenRef.current += 1;
  }, []);

  function publish(nextRows) {
    onRowsChange?.(nextRows);
  }

  function patchRow(index, patch) {
    publish(applyLinkedQuoteRowPatch(values, index, patch, { allowHaLicenseRatio }));
  }

  function closeSearch() {
    searchTokenRef.current += 1;
    setSearch(EMPTY_SEARCH);
  }

  // Removing hardware shrinks or removes only ITS paired projection; removing
  // a licence row never touches hardware. Rows outside the removed row's
  // coverage scope are never modified.
  function removeRow(index) {
    closeSearch();
    setDraft(EMPTY_DRAFT);
    publish(removeLinkedQuoteRow(values, index, { allowHaLicenseRatio }));
  }

  function moveRow(index, delta) {
    const group = groupedRows.find((candidate) => candidate.key === groupKeyByIndex.get(index));
    const role = quoteEditorPresentationRole(values[index], pairReview[index]);
    const peers = group?.entries.filter((entry) => entry.role === role) || [];
    const position = peers.findIndex((entry) => entry.index === index);
    const nextIndex = peers[position + delta]?.index;
    if (!Number.isInteger(nextIndex)) return;
    const nextRows = [...values];
    [nextRows[index], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[index]];
    closeSearch();
    setDraft(EMPTY_DRAFT);
    publish(nextRows);
  }

  function canMoveRow(index, delta) {
    const group = groupedRows.find((candidate) => candidate.key === groupKeyByIndex.get(index));
    const role = quoteEditorPresentationRole(values[index], pairReview[index]);
    const peers = group?.entries.filter((entry) => entry.role === role) || [];
    const position = peers.findIndex((entry) => entry.index === index);
    return Number.isInteger(peers[position + delta]?.index);
  }

  function normalizeSearchResponse(response, index) {
    const standaloneOnly = valuesRef.current[index]?.editorPurpose === 'standalone'
      || valuesRef.current[index]?.licenseIntent === 'standalone';
    const products = response?.ok === true && Array.isArray(response.results)
      ? response.results.map((product) => ({
        sku: String(product?.sku || '').trim().toUpperCase(),
        name: String(product?.name || '').trim(),
        source: String(product?.source || (response.live === true ? 'zoho' : 'catalog')).trim(),
        availability: ['ecomm', 'zoho_only'].includes(String(product?.availability || '').trim())
          ? String(product.availability).trim()
          : 'unknown',
      })).filter((product) => product.sku)
      : [];
    return standaloneOnly
      ? products.filter((product) => product.sku.startsWith('LIC-')).slice(0, 10)
      : products.slice(0, 10);
  }

  function scheduleSearch(index, rawQuery) {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const query = String(rawQuery || '').trim().toUpperCase();
    const token = ++searchTokenRef.current;
    if (!onProductSearch || query.length < 2) {
      setSearch({ ...EMPTY_SEARCH, query });
      return;
    }
    setSearch({ index, query, loading: true, products: [], error: '', highlight: -1 });
    searchTimerRef.current = setTimeout(async () => {
      let response;
      try {
        response = await onProductSearch(query);
      } catch (error) {
        response = { ok: false, error: error?.message || 'product_search_failed', products: [] };
      }
      if (token !== searchTokenRef.current || !mountedRef.current) return;
      setSearch({
        index,
        query,
        loading: false,
        products: normalizeSearchResponse(response, index),
        error: response?.ok === true ? '' : 'Live product search is unavailable. Enter an exact SKU; no Zoho changes were made.',
        highlight: -1,
      });
    }, 250);
  }

  // Exact post-selection classification. A live Zoho product can be picked
  // while its storefront status is still unknown; this re-reads only that
  // exact SKU and adopts a proven status. Unknown is never guessed either way.
  async function checkAvailability(index, rawSku) {
    const sku = String(rawSku || '').trim().toUpperCase();
    if (!onProductSearch || !sku) return;
    setCheckingSkus((current) => new Set(current).add(sku));
    let response;
    try {
      response = await onProductSearch(sku);
    } catch (error) {
      response = { ok: false, error: error?.message || 'product_search_failed', results: [] };
    }
    if (!mountedRef.current) return;
    setCheckingSkus((current) => {
      const next = new Set(current);
      next.delete(sku);
      return next;
    });
    const resolved = resolveRowAvailabilityFromSearch(valuesRef.current, index, sku, response);
    if (resolved.changed) publish(resolved.rows);
  }

  function selectProduct(index, product) {
    publish(selectQuoteEditorProduct(values, index, product, { allowHaLicenseRatio }));
    setDraft(EMPTY_DRAFT);
    closeSearch();
    if (product.availability === 'unknown') checkAvailability(index, product.sku);
  }

  // Explicit exact commit (Enter / leaving the field). The current search
  // response for this row is the only evidence consulted synchronously; when
  // the typed SKU is not in it, the exact status is checked afterwards so a
  // manually typed Zoho-only or unknown product is routed fail-closed too.
  function draftBelongsTo(index) {
    return draft.index === index
      && draft.baseSku === String(values[index]?.sku || '').trim().toUpperCase();
  }

  function commitDraft(index) {
    if (draft.index !== index) return;
    if (!draftBelongsTo(index)) {
      // The row under this index changed while the rep was typing; the draft
      // no longer describes it and must not be committed onto it.
      setDraft(EMPTY_DRAFT);
      return;
    }
    const text = draft.text;
    const response = search.index === index && !search.loading && !search.error
      ? { ok: true, results: search.products }
      : null;
    const committed = commitQuoteEditorSkuDraft(values, index, text, response, { allowHaLicenseRatio });
    if (!committed.ok) {
      // Keep the draft visible with its inline correction; nothing was published.
      return;
    }
    setDraft(EMPTY_DRAFT);
    if (committed.changed) {
      publish(committed.rows);
      const needsCheck = committed.sku && (!committed.exact || committed.exact.availability === 'unknown');
      if (needsCheck) checkAvailability(index, committed.sku);
    }
  }

  function handleSkuKeyDown(event, index) {
    const open = search.index === index && !search.loading && search.products.length > 0;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!open) return;
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setSearch((current) => {
        const count = current.products.length;
        if (!count) return current;
        const next = current.highlight < 0
          ? (delta > 0 ? 0 : count - 1)
          : (current.highlight + delta + count) % count;
        return { ...current, highlight: next };
      });
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (open && search.highlight >= 0 && search.products[search.highlight]) {
        selectProduct(index, search.products[search.highlight]);
        return;
      }
      if (draftBelongsTo(index)) commitDraft(index);
      else closeSearch();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(EMPTY_DRAFT);
      closeSearch();
    }
  }

  const draftValidation = draft.index >= 0 && draftBelongsTo(draft.index)
    ? commitQuoteEditorSkuDraft(values, draft.index, draft.text, null, { allowHaLicenseRatio })
    : null;

  const readiness = draftActive
    ? { kind: 'blocked', message: 'Finish or cancel the product edit before generating. The previous SKU is not submitted while a draft is open.' }
    : !validation.ok
      ? { kind: 'blocked', message: validation.error }
      : routeBlocked
        ? { kind: 'blocked', message: `eCommerce availability is unknown for ${route.unknownSkus.join(', ')}. Retry the check before generating.` }
        : !preflight.ok
          ? { kind: 'blocked', message: preflight.error }
          : checkingSkus.size > 0
            ? { kind: 'checking', message: 'Checking product availability…' }
            : route.route === 'zoho_only'
              ? { kind: 'zoho', message: 'Zoho only — this cart will skip eCommerce and open review before any CRM create.' }
              : dirty
                ? { kind: 'dirty', message: 'Ready to rebuild and verify these changes.' }
                : { kind: 'ready', message: 'Ready · displayed quote actions match these rows.' };

  return (
    <div className="sku-editor" style={{ marginTop: 8, padding: 9, border: `1px solid ${COLORS.BORDER}`, borderRadius: 8, background: COLORS.BG_PRIMARY }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.TEXT_PRIMARY, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, marginBottom: 7 }}>
        Hardware defaults to paired licensing. Paired license totals update automatically; tier choices stay family-synchronized and Term is quote-wide.
      </div>
      <div className="sku-editor-grid sku-editor-grid-header" aria-hidden="true">
        <span>Product</span><span>Qty</span><span>Tier</span><span>Term</span><span>License use</span><span>Actions</span>
      </div>
      {groupedRows.map((group) => (
        <section key={group.key} className="sku-editor-group">
          <div aria-label={`Quote group ${group.label}`} className="sku-editor-group-heading">
            <span>{group.label}</span>
            <span className="sku-editor-group-count">
              {group.productCount} {group.productCount === 1 ? 'item' : 'items'}
              {group.pairedLicenseCount > 0 ? ` · ${group.pairedLicenseCount} paired` : ''}
            </span>
          </div>
          {group.entries.map(({ row, index, role }) => {
            const pairing = pairReview[index] || { kind: 'none' };
            const mismatch = pairing.kind === 'mismatch';
            const paired = pairing.kind === 'paired';
            const needsReview = pairing.kind === 'needs_review';
            const standalone = pairing.kind === 'standalone';
            // The typed states remain explicit: needsReview || paired || standalone || mismatch.
            const suspended = pairing.kind === 'suspended';
            const pending = pairing.kind === 'pending' || (paired && row?.projectionPending === true);
            const warmSpare = pairing.warmSpare === true;
            const linkedLicenseQuantity = pairing.role === 'license' && row?.licenseIntent === 'paired';
            const annotationColor = mismatch || needsReview || suspended ? '#e37400' : standalone ? COLORS.STRATUS_BLUE : '#188038';
            const hardwareLabel = pairing.hardwareSkus?.join(' + ') || 'hardware';
            const licenseLabel = pairing.licenseSkus?.join(' + ') || 'license';
            const contributionLabel = (pairing.hardwareContributions || []).map((item) => `${item.sku} ×${item.qty}`).join(' + ');
            let annotation = '';
            if (warmSpare && pairing.role === 'hardware') annotation = `Warm spare · ${licenseLabel} shared across this HA pair`;
            else if (warmSpare && pairing.role === 'license') annotation = `HA total ${pairing.licenseQty ?? '?'} · ${contributionLabel || hardwareLabel}`;
            else if (paired && pairing.role === 'license' && (pairing.hardwareContributions || []).length > 1) annotation = `Synced total ${pairing.licenseQty ?? '?'} · ${contributionLabel}`;
            else if (standalone && pairing.role === 'license') annotation = 'Standalone renewal · quantity is independent';
            else if (standalone && pairing.role === 'hardware') annotation = `Paired hardware plus standalone ${licenseLabel} ×${pairing.licenseQty ?? '?'}`;
            else if (needsReview && pairing.role === 'license') annotation = 'Choose paired or standalone renewal';
            else if (suspended) annotation = 'Paired license suspended because all covered hardware is hardware only.';
            else if (mismatch && pairing.hardwareQty == null) annotation = `License tier mismatch: ${licenseLabel} does not match the selected hardware tier.`;
            else if (mismatch) annotation = `License quantity mismatch for ${hardwareLabel}: hardware ×${pairing.hardwareQty ?? '?'}, license ×${pairing.licenseQty ?? '?'}`;

            const sku = String(row?.sku || '');
            const isLicense = /^LIC-/i.test(sku);
            const hardwareUse = quoteEditorHardwareLicenseUse(row);
            const tierOptions = licenseTierOptionsForSku(sku).filter((option) => option.value !== 'none');
            const availability = rowAvailabilityState(row);
            const checking = availability === 'unknown' && checkingSkus.has(sku.toUpperCase());
            const isDrafting = draftBelongsTo(index);
            const inputValue = isDrafting ? draft.text : sku;
            const dropdownOpen = search.index === index && (search.loading || search.products.length > 0 || search.error);
            const listId = `${listIdPrefix}-options-${index}`;
            const draftError = isDrafting && draftValidation && !draftValidation.ok ? draftValidation.error : '';
            const detail = (label, content, color = COLORS.TEXT_SECONDARY, weight = 600) => (
              <div className="sku-editor-row-detail" aria-label={`${label} row ${index + 1}`} style={{ color, fontWeight: weight }}>{content}</div>
            );

            return (
              <div key={`${role}:${index}`} className="sku-editor-row-wrap">
                <div className="sku-editor-grid sku-editor-row">
                  <div className="sku-editor-cell sku-editor-product" data-label="Product" style={{ position: 'relative' }}>
                    <input
                      role="combobox"
                      aria-label={`SKU row ${index + 1}`}
                      aria-autocomplete="list"
                      aria-expanded={dropdownOpen ? 'true' : 'false'}
                      aria-controls={listId}
                      aria-activedescendant={dropdownOpen && search.highlight >= 0 ? `${listId}-${search.highlight}` : undefined}
                      value={inputValue}
                      disabled={disabled}
                      autoComplete="off"
                      placeholder={row?.editorPurpose === 'standalone' ? 'Exact LIC- SKU' : 'Search or enter SKU'}
                      onChange={(event) => {
                        // Draft only: canonical rows, grouping, and quote actions stay unchanged until commit.
                        const text = event.target.value.toUpperCase();
                        setDraft({ index, text, baseSku: sku.trim().toUpperCase() });
                        scheduleSearch(index, text);
                      }}
                      onKeyDown={(event) => handleSkuKeyDown(event, index)}
                      onFocus={() => scheduleSearch(index, row?.sku || '')}
                      onBlur={() => { commitDraft(index); closeSearch(); }}
                      style={{ ...CONTROL_STYLE, fontSize: 11, borderColor: row?.unresolved || mismatch || draftError ? '#e37400' : COLORS.BORDER }}
                    />
                    {dropdownOpen && (
                      <div id={listId} role="listbox" aria-label={`Product matches row ${index + 1}`} className="sku-editor-product-list">
                        {search.loading && <div className="sku-editor-product-message">Searching active Zoho products…</div>}
                        {!search.loading && search.products.map((product, optionIndex) => (
                          <button
                            key={product.sku}
                            id={`${listId}-${optionIndex}`}
                            role="option"
                            aria-selected={search.highlight === optionIndex ? 'true' : 'false'}
                            type="button"
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => setSearch((current) => ({ ...current, highlight: optionIndex }))}
                            onClick={() => selectProduct(index, product)}
                            className="sku-editor-product-option"
                            style={{ background: search.highlight === optionIndex ? COLORS.BG_HOVER : '#fff' }}
                          >
                            <b>{product.sku}</b>{product.name ? ` — ${product.name}` : ''}
                            <span>
                              {product.availability === 'zoho_only'
                                ? 'live Zoho · Zoho review only'
                                : product.availability === 'unknown'
                                  ? 'live Zoho · eCommerce status pending — selectable, checked after you pick it'
                                  : (product.source === 'zoho' ? 'live Zoho · eCommerce available' : product.source)}
                            </span>
                          </button>
                        ))}
                        {!search.loading && search.error && <div className="sku-editor-product-message" style={{ color: '#c5221f' }}>{search.error}</div>}
                        {!search.loading && !search.error && search.products.length === 0 && <div className="sku-editor-product-message">No active matching products.</div>}
                      </div>
                    )}
                  </div>

                  <div className="sku-editor-cell sku-editor-qty" data-label="Qty">
                    <input
                      aria-label={`Quantity row ${index + 1}`}
                      type="number" inputMode="numeric" min="1" max="99999" step="1"
                      value={row?.qty ?? ''}
                      disabled={disabled || linkedLicenseQuantity}
                      title={linkedLicenseQuantity ? 'Quantity follows associated hardware.' : ''}
                      onChange={(event) => patchRow(index, { qty: event.target.value })}
                      style={{ ...CONTROL_STYLE, background: linkedLicenseQuantity ? COLORS.BG_SECONDARY : '#fff' }}
                    />
                  </div>

                  <div className="sku-editor-cell sku-editor-tier" data-label="Tier">
                    {hardwareUse ? (
                      <select
                        aria-label={`License tier row ${index + 1}`}
                        value={row?.tier === 'none' ? (row?.tierBeforeHardwareOnly || '') : (row?.tier || '')}
                        disabled={disabled || hardwareUse === 'hardware_only'}
                        onChange={(event) => patchRow(index, { tier: event.target.value })}
                        style={{ ...CONTROL_STYLE, background: hardwareUse === 'hardware_only' ? COLORS.BG_SECONDARY : '#fff' }}
                      >
                        {tierOptions.map((option) => (
                          <option key={option.value || 'default'} value={option.value}>
                            {option.value === '' ? defaultLicenseTierLabelForSku(sku) : option.label}
                          </option>
                        ))}
                      </select>
                    ) : <span style={PLACEHOLDER_STYLE}>—</span>}
                  </div>

                  <div className="sku-editor-cell sku-editor-term" data-label="Term">
                    {hardwareUse && hardwareUse !== 'hardware_only' ? (
                      onTermChange ? (
                        <select aria-label={`Quote term row ${index + 1}`} value={effectiveTerm} disabled={disabled} onChange={(event) => onTermChange(event.target.value)} style={CONTROL_STYLE}>
                          {QUOTE_TERM_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{option.label}</option>)}
                        </select>
                      ) : <span className="sku-editor-readonly">{effectiveTerm ? `${effectiveTerm} year${effectiveTerm === '1' ? '' : 's'}` : 'All standard'}</span>
                    ) : isLicense && licenseTermFromSku(sku)
                      ? <span className="sku-editor-readonly">{licenseTermFromSku(sku)} year{licenseTermFromSku(sku) === '1' ? '' : 's'}</span>
                      : <span style={PLACEHOLDER_STYLE}>—</span>}
                  </div>

                  <div className="sku-editor-cell sku-editor-use" data-label="License use">
                    {hardwareUse ? (
                      <select
                        aria-label={`Hardware license use row ${index + 1}`}
                        value={hardwareUse}
                        disabled={disabled}
                        onChange={(event) => publish(applyQuoteEditorHardwareLicenseUse(values, index, event.target.value, { allowHaLicenseRatio }))}
                        style={CONTROL_STYLE}
                      >
                        <option value="paired">Paired licensing</option>
                        <option value="hardware_only">Hardware only</option>
                      </select>
                    ) : row?.licenseIntent === 'paired' ? (
                      <span className="sku-editor-readonly">{warmSpare ? 'Linked 2:1' : 'Linked 1:1'}</span>
                    ) : row?.licenseIntent === 'standalone' ? (
                      <span className="sku-editor-readonly sku-editor-standalone">Standalone renewal</span>
                    ) : pairing.role === 'license' && (needsReview || mismatch) ? (
                      <select aria-label={`License use row ${index + 1}`} value={row?.licenseIntent || ''} disabled={disabled} onChange={(event) => patchRow(index, { licenseIntent: event.target.value })} style={{ ...CONTROL_STYLE, borderColor: '#e37400' }}>
                        <option value="">Choose…</option>
                        <option value="paired">Paired to hardware</option>
                        <option value="standalone">Standalone renewal</option>
                      </select>
                    ) : <span style={PLACEHOLDER_STYLE}>—</span>}
                  </div>

                  <div className="sku-editor-cell sku-editor-actions" data-label="Actions">
                    <button type="button" aria-label={`Move SKU row ${index + 1} up`} disabled={disabled || !canMoveRow(index, -1)} onClick={() => moveRow(index, -1)} title="Move up">↑</button>
                    <button type="button" aria-label={`Move SKU row ${index + 1} down`} disabled={disabled || !canMoveRow(index, 1)} onClick={() => moveRow(index, 1)} title="Move down">↓</button>
                    <button type="button" aria-label={`Remove SKU row ${index + 1}`} disabled={disabled} onClick={() => removeRow(index)} title="Remove this row" className="sku-editor-remove">×</button>
                  </div>

                  {draftError && detail('SKU draft', <>{draftError} Press Escape to keep {sku || 'the row empty'}.</>, '#c5221f', 500)}
                  {annotation && detail('License pairing', annotation, annotationColor, mismatch ? 700 : 600)}
                  {pending && pairing.role === 'license' && detail('Pending license projection', <>Pending rebuild · follows hardware tier; {updateLabel} derives the final license.</>, '#8a6100')}
                  {availability === 'unknown' && detail('Availability check', checking ? 'Checking availability…' : (
                    <><span>eCommerce availability unknown — routing is blocked.</span>{' '}<button type="button" aria-label={`Retry availability check row ${index + 1}`} disabled={disabled || !onProductSearch} onClick={() => checkAvailability(index, sku)} className="sku-editor-retry">Retry</button></>
                  ), '#8a6100', 700)}
                  {availability === 'ecomm' && row?.productSource && detail('eCommerce availability', 'eCommerce available · verified active Zoho product', '#188038')}
                  {availability === 'zoho_only' && detail('Zoho-only SKU', 'Zoho only · eCommerce is skipped; review is required before any CRM create.', '#8a6100', 700)}
                </div>
              </div>
            );
          })}
        </section>
      ))}

      <div className="sku-editor-footer">
        <button type="button" disabled={disabled || values.length >= 100} onClick={() => publish([...values, { sku: '', qty: 1, unresolved: false }])}>+ Add product</button>
        <button type="button" disabled={disabled || values.length >= 100} onClick={() => publish([...values, blankStandaloneRenewalRow()])}>+ Add standalone renewal</button>
        {onUpdate && (
          <button
            type="button"
            disabled={disabled || !dirty || updateBlocked}
            onClick={() => !draftActive && onUpdate(values)}
            title={updateBlocked ? readiness.message : ''}
            className="sku-editor-primary"
          >{updateLabel}</button>
        )}
      </div>

      <div
        role={readiness.kind === 'blocked' ? 'alert' : 'status'}
        aria-label={`Quote editor ${readiness.kind}`}
        className={`sku-editor-readiness sku-editor-readiness-${readiness.kind}`}
      >
        {readiness.message}
      </div>
      {status && <div className="sku-editor-parent-status">{status}</div>}
    </div>
  );
}
