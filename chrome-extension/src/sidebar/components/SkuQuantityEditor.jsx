import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../lib/constants';
import {
  applyLinkedQuoteRowPatch,
  defaultLicenseTierLabelForSku,
  groupQuoteEditorRows,
  licensePairReviewForRows,
  licenseTierOptionsForSku,
  normalizeSkuEditorRows,
  removeLinkedQuoteRow,
  withDefaultPairedLicenseIntents,
} from './sku-editor-core.mjs';

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
  const [search, setSearch] = useState({ index: -1, query: '', loading: false, products: [], error: '' });
  const searchTokenRef = useRef(0);
  const searchTimerRef = useRef(null);

  useEffect(() => () => {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTokenRef.current += 1;
  }, []);

  function publish(nextRows) {
    onRowsChange?.(nextRows);
  }

  function patchRow(index, patch) {
    publish(applyLinkedQuoteRowPatch(values, index, patch, { allowHaLicenseRatio }));
  }

  // Removing hardware shrinks or removes only ITS paired projection; removing
  // a licence row never touches hardware. Rows outside the removed row's
  // coverage scope are never modified.
  function removeRow(index) {
    searchTokenRef.current += 1;
    setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
    publish(removeLinkedQuoteRow(values, index, { allowHaLicenseRatio }));
  }

  function moveRow(index, delta) {
    const group = groupedRows.find((candidate) => candidate.key === groupKeyByIndex.get(index));
    const position = group?.entries.findIndex((entry) => entry.index === index) ?? -1;
    const nextIndex = group?.entries[position + delta]?.index;
    if (!Number.isInteger(nextIndex)) return;
    const nextRows = [...values];
    [nextRows[index], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[index]];
    searchTokenRef.current += 1;
    setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
    publish(nextRows);
  }

  function canMoveRow(index, delta) {
    const group = groupedRows.find((candidate) => candidate.key === groupKeyByIndex.get(index));
    const position = group?.entries.findIndex((entry) => entry.index === index) ?? -1;
    return Number.isInteger(group?.entries[position + delta]?.index);
  }

  function scheduleSearch(index, rawQuery) {
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    const query = String(rawQuery || '').trim().toUpperCase();
    const token = ++searchTokenRef.current;
    if (!onProductSearch || query.length < 2) {
      setSearch({ index: -1, query, loading: false, products: [], error: '' });
      return;
    }
    setSearch({ index, query, loading: true, products: [], error: '' });
    searchTimerRef.current = setTimeout(async () => {
      let response;
      try {
        response = await onProductSearch(query);
      } catch (error) {
        response = { ok: false, error: error?.message || 'product_search_failed', products: [] };
      }
      if (token !== searchTokenRef.current) return;
      const products = response?.ok === true && Array.isArray(response.results)
        ? response.results.slice(0, 10).map((product) => ({
          sku: String(product?.sku || '').trim().toUpperCase(),
          name: String(product?.name || '').trim(),
          source: String(product?.source || (response.live === true ? 'zoho' : 'catalog')).trim(),
          availability: ['ecomm', 'zoho_only'].includes(String(product?.availability || '').trim())
            ? String(product.availability).trim()
            : 'unknown',
        })).filter((product) => product.sku)
        : [];
      setSearch({
        index,
        query,
        loading: false,
        products,
        error: response?.ok === true ? '' : 'Live product search is unavailable. Enter an exact SKU; no Zoho changes were made.',
      });
    }, 250);
  }

  return (
    <div style={{ marginTop: 8, padding: 9, border: `1px solid ${COLORS.BORDER}`, borderRadius: 8, background: COLORS.BG_PRIMARY }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: COLORS.TEXT_PRIMARY, marginBottom: 3 }}>{title}</div>
      <div style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
        Edit quantity, tier, or license use. Paired license totals update automatically.
      </div>
      {groupedRows.map((group) => (
        <div key={group.key} style={{ marginBottom: 7 }}>
          <div
            aria-label={`Quote group ${group.label}`}
            style={{ display: 'flex', alignItems: 'center', gap: 5, margin: '7px 0 4px', color: COLORS.TEXT_SECONDARY, fontSize: 9, fontWeight: 800, letterSpacing: 0.45, textTransform: 'uppercase' }}
          >
            <span>{group.label}</span>
            {/* Paired projections are the review view of hardware already
                counted here, so they are named rather than added to the count. */}
            <span style={{ fontWeight: 500, letterSpacing: 0 }}>
              {group.productCount} {group.productCount === 1 ? 'item' : 'items'}
              {group.pairedLicenseCount > 0
                ? ` · ${group.pairedLicenseCount} paired ${group.pairedLicenseCount === 1 ? 'license' : 'licenses'}`
                : ''}
            </span>
          </div>
          {group.entries.map(({ row, index }) => {
        const pairing = pairReview[index] || { kind: 'none' };
        const mismatch = pairing.kind === 'mismatch';
        const paired = pairing.kind === 'paired';
        const needsReview = pairing.kind === 'needs_review';
        const standalone = pairing.kind === 'standalone';
        const suspended = pairing.kind === 'suspended';
        const warmSpare = pairing.warmSpare === true;
        const linkedLicenseQuantity = pairing.role === 'license' && row?.licenseIntent === 'paired';
        const annotationColor = mismatch || needsReview || suspended ? '#e37400' : standalone ? COLORS.STRATUS_BLUE : '#188038';
        const hardwareLabel = pairing.hardwareSkus?.join(' + ') || 'hardware';
        const licenseLabel = pairing.licenseSkus?.join(' + ') || 'license';
        const contributionLabel = (pairing.hardwareContributions || [])
          .map((item) => `${item.sku} ×${item.qty}`)
          .join(' + ');
        let annotation = '';
        if (warmSpare && pairing.role === 'hardware') {
          annotation = `Warm spare · ${licenseLabel} shared across this HA pair`;
        } else if (warmSpare && pairing.role === 'license') {
          annotation = `HA total ${pairing.licenseQty ?? '?'} · ${contributionLabel || hardwareLabel}`;
        } else if (paired && pairing.role === 'license' && (pairing.hardwareContributions || []).length > 1) {
          annotation = `Synced total ${pairing.licenseQty ?? '?'} · ${contributionLabel}`;
        } else if (standalone && pairing.role === 'license') {
          annotation = `Standalone renewal · quantity is independent`;
        } else if (standalone && pairing.role === 'hardware') {
          annotation = `Hardware license plus standalone ${licenseLabel} ×${pairing.licenseQty ?? '?'}`;
        } else if (needsReview && pairing.role === 'license') {
          annotation = `Choose paired or standalone renewal`;
        } else if (suspended) {
          annotation = `Paired license suspended: every covered device is hardware only. Restore a hardware tier, choose Standalone renewal, or remove this row.`;
        } else if (mismatch && pairing.hardwareQty == null) {
          annotation = `License tier mismatch: ${licenseLabel} does not match the selected hardware license tier.`;
        } else if (mismatch) {
          annotation = `License quantity mismatch for ${hardwareLabel}: hardware x${pairing.hardwareQty ?? '?'}, explicit ${licenseLabel} x${pairing.licenseQty ?? '?'}`;
        }
        return (
          <div key={index} style={{ position: 'relative', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <input
                  aria-label={`SKU row ${index + 1}`}
                  value={row?.sku ?? ''}
                  disabled={disabled}
                  autoComplete="off"
                  placeholder="Exact SKU"
                  onChange={(event) => {
                    const sku = event.target.value.toUpperCase();
                    // Typing changes the identity proof. The user must select a
                    // fresh search result before this row can be routed as a
                    // confirmed Zoho-only product.
                    patchRow(index, { sku, unresolved: false, availability: 'unknown', productSource: undefined });
                    scheduleSearch(index, sku);
                  }}
                  onFocus={() => scheduleSearch(index, row?.sku || '')}
                  onBlur={() => setTimeout(() => {
                    if (search.index === index) setSearch((current) => ({ ...current, index: -1 }));
                  }, 150)}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, padding: '5px 6px', borderRadius: 5, border: `1px solid ${row?.unresolved || mismatch ? '#e37400' : COLORS.BORDER}` }}
                />
                {search.index === index && (search.loading || search.products.length > 0 || search.error) && (
                  <div style={{ position: 'absolute', zIndex: 30, left: 0, right: 0, top: '100%', background: '#fff', border: `1px solid ${COLORS.BORDER}`, borderRadius: 5, boxShadow: '0 3px 8px rgba(0,0,0,.16)', maxHeight: 180, overflowY: 'auto' }}>
                    {search.loading && <div style={{ padding: 6, fontSize: 10, color: COLORS.TEXT_SECONDARY }}>Searching active Zoho products…</div>}
                    {!search.loading && search.products.map((product) => (
                      <button
                        key={product.sku}
                        type="button"
                        disabled={product.availability === 'unknown'}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          patchRow(index, {
                            sku: product.sku,
                            unresolved: false,
                            availability: product.availability,
                            productSource: product.source,
                          });
                          searchTokenRef.current += 1;
                          setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
                        }}
                        style={{ display: 'block', width: '100%', padding: '6px 7px', textAlign: 'left', border: 'none', borderBottom: `1px solid ${COLORS.BORDER}`, background: '#fff', color: COLORS.TEXT_PRIMARY, cursor: product.availability === 'unknown' ? 'default' : 'pointer', opacity: product.availability === 'unknown' ? 0.65 : 1, fontSize: 10 }}
                      >
                        <b>{product.sku}</b>{product.name ? ` — ${product.name}` : ''}
                        <span style={{ display: 'block', color: COLORS.TEXT_SECONDARY }}>
                          {product.availability === 'zoho_only'
                            ? 'live Zoho · not in eCommerce — Zoho review only'
                            : product.availability === 'unknown'
                              ? 'live Zoho · eCommerce status unavailable — retry search'
                              : (product.source === 'zoho' ? 'live Zoho · eCommerce available' : product.source)}
                        </span>
                      </button>
                    ))}
                    {!search.loading && search.error && <div style={{ padding: 6, fontSize: 10, color: '#c5221f' }}>{search.error}</div>}
                    {!search.loading && !search.error && search.products.length === 0 && (
                      <div style={{ padding: 6, fontSize: 10, color: COLORS.TEXT_SECONDARY }}>No active matching products.</div>
                    )}
                  </div>
                )}
              </div>
              <input
                aria-label={`Quantity row ${index + 1}`}
                type="number"
                inputMode="numeric"
                min="1"
                max="99999"
                step="1"
                value={row?.qty ?? ''}
                disabled={disabled || linkedLicenseQuantity}
                title={linkedLicenseQuantity ? 'Quantity follows the associated hardware total. Choose Standalone renewal to edit it.' : ''}
                onChange={(event) => patchRow(index, { qty: event.target.value })}
                style={{ width: 62, boxSizing: 'border-box', fontSize: 11, padding: '5px 4px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: linkedLicenseQuantity ? COLORS.BG_SECONDARY : '#fff' }}
              />
              {licenseTierOptionsForSku(row?.sku).length > 1 && (
                <select
                  aria-label={`License tier row ${index + 1}`}
                  value={row?.tier || ''}
                  disabled={disabled}
                  // This is a row-local choice. Publishing it as the old global
                  // draft tier also changed every blank-tier hardware row during
                  // serialization (for example MX67 ENT silently made MX75 ENT).
                  onChange={(event) => patchRow(index, { tier: event.target.value })}
                  style={{ width: 132, boxSizing: 'border-box', fontSize: 10, padding: '4px 3px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: '#fff' }}
                >
                  {licenseTierOptionsForSku(row?.sku).map((option) => (
                    <option key={option.value || 'default'} value={option.value}>
                      {/* Name the tier the row will actually get, rather than the
                          opaque "Default license tier". */}
                      {option.value === '' ? defaultLicenseTierLabelForSku(row?.sku) : option.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                aria-label={`Move SKU row ${index + 1} up`}
                disabled={disabled || !canMoveRow(index, -1)}
                onClick={() => moveRow(index, -1)}
                title="Move up"
                style={{ padding: '4px 6px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', cursor: disabled || !canMoveRow(index, -1) ? 'default' : 'pointer' }}
              >↑</button>
              <button
                type="button"
                aria-label={`Move SKU row ${index + 1} down`}
                disabled={disabled || !canMoveRow(index, 1)}
                onClick={() => moveRow(index, 1)}
                title="Move down"
                style={{ padding: '4px 6px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', cursor: disabled || !canMoveRow(index, 1) ? 'default' : 'pointer' }}
              >↓</button>
              <button
                type="button"
                aria-label={`Remove SKU row ${index + 1}`}
                disabled={disabled}
                onClick={() => removeRow(index)}
                title="Remove this SKU"
                style={{ padding: '4px 7px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', color: '#c5221f', cursor: disabled ? 'default' : 'pointer' }}
              >
                Remove
              </button>
            </div>
            {(pairing.role === 'license' && (needsReview || paired || standalone || mismatch || suspended)) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, paddingLeft: 3 }}>
                <span style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY }}>License use</span>
                <select
                  aria-label={`License use row ${index + 1}`}
                  value={row?.licenseIntent || ''}
                  disabled={disabled}
                  onChange={(event) => patchRow(index, { licenseIntent: event.target.value })}
                  style={{ fontSize: 10, padding: '3px 4px', borderRadius: 5, border: `1px solid ${needsReview || mismatch ? '#e37400' : COLORS.BORDER}`, background: '#fff' }}
                >
                  <option value="">Choose…</option>
                  <option value="paired">Paired to hardware</option>
                  <option value="standalone">Standalone renewal</option>
                </select>
              </div>
            )}
            {annotation && (
              <div
                aria-label={`License pairing row ${index + 1}`}
                style={{ marginTop: 3, paddingLeft: 3, fontSize: 9, lineHeight: 1.3, color: annotationColor, fontWeight: mismatch ? 700 : 600 }}
              >
                {annotation}
              </div>
            )}
            {row?.availability === 'zoho_only' && (
              <div
                aria-label={`Zoho-only SKU row ${index + 1}`}
                style={{ marginTop: 3, paddingLeft: 3, fontSize: 9, lineHeight: 1.3, color: '#8a6100', fontWeight: 700 }}
              >
                Zoho only — this cart will skip eCommerce and open the review-before-create workflow at Zoho list price.
              </div>
            )}
          </div>
        );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          type="button"
          disabled={disabled || values.length >= 100}
          onClick={() => publish([...values, { sku: '', qty: 1, unresolved: false }])}
          style={{ padding: '5px 9px', borderRadius: 5, border: `1px solid ${COLORS.STRATUS_BLUE}`, background: 'transparent', color: COLORS.STRATUS_BLUE, cursor: disabled ? 'default' : 'pointer', fontSize: 11 }}
        >
          + Add SKU
        </button>
        {onUpdate && (
          <button
            type="button"
            disabled={disabled || !dirty || !validation.ok}
            onClick={() => onUpdate(values)}
            style={{ padding: '5px 10px', borderRadius: 5, border: 'none', background: disabled || !dirty || !validation.ok ? '#9aa0a6' : COLORS.STRATUS_BLUE, color: '#fff', cursor: disabled || !dirty || !validation.ok ? 'default' : 'pointer', fontWeight: 700, fontSize: 11 }}
          >
            {updateLabel}
          </button>
        )}
      </div>
      {!validation.ok && <div style={{ color: '#c5221f', fontSize: 10, marginTop: 5 }}>{validation.error}</div>}
      {status && <div style={{ color: dirty ? '#e37400' : '#188038', fontSize: 10, marginTop: 5 }}>{status}</div>}
    </div>
  );
}
