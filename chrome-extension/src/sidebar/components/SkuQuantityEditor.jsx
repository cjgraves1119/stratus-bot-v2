import { useEffect, useRef, useState } from 'react';
import { COLORS } from '../../lib/constants';
import {
  defaultLicenseTierLabelForSku,
  licensePairReviewForRows,
  licenseTierOptionsForSku,
  normalizeSkuEditorRows,
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
  const values = Array.isArray(rows) ? rows : [];
  const validation = normalizeSkuEditorRows(values);
  // Derived on every render from the controlled rows. Pairing is review-only:
  // it never removes a line or changes what the serializer sends to the Worker.
  const pairReview = licensePairReviewForRows(values, { allowHaLicenseRatio });
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
    publish(values.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));
  }

  function moveRow(index, delta) {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= values.length) return;
    const nextRows = [...values];
    [nextRows[index], nextRows[nextIndex]] = [nextRows[nextIndex], nextRows[index]];
    searchTokenRef.current += 1;
    setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
    publish(nextRows);
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
      <div style={{ fontSize: 10, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
        Edit exact SKU quantities or search active Zoho products. Search and quote updates are read-only.
      </div>
      {values.map((row, index) => {
        const pairing = pairReview[index] || { kind: 'none' };
        const mismatch = pairing.kind === 'mismatch';
        const paired = pairing.kind === 'paired';
        const needsReview = pairing.kind === 'needs_review';
        const standalone = pairing.kind === 'standalone';
        const warmSpare = pairing.warmSpare === true;
        const annotationColor = mismatch || needsReview ? '#e37400' : standalone ? COLORS.STRATUS_BLUE : '#188038';
        const hardwareLabel = pairing.hardwareSkus?.join(' + ') || 'hardware';
        const licenseLabel = pairing.licenseSkus?.join(' + ') || 'license';
        let annotation = '';
        if (warmSpare && pairing.role === 'hardware') {
          annotation = `Warm-spare license supplied by paired ${licenseLabel} — one license covers this HA pair`;
        } else if (warmSpare && pairing.role === 'license') {
          annotation = `Paired with warm-spare ${hardwareLabel} — counted once for this HA pair`;
        } else if (paired && pairing.role === 'hardware') {
          annotation = `License supplied by paired ${licenseLabel}`;
        } else if (paired && pairing.role === 'license') {
          annotation = `Paired with ${hardwareLabel} — counted once, not an extra license`;
        } else if (standalone && pairing.role === 'license') {
          annotation = `Standalone renewal/additional license — ${hardwareLabel} adds its own license; this row adds x${pairing.licenseQty ?? '?'}.`;
        } else if (standalone && pairing.role === 'hardware') {
          annotation = `Device license plus standalone renewal — total ${licenseLabel} coverage is x${(pairing.hardwareQty || 0) + (pairing.licenseQty || 0)}.`;
        } else if (needsReview && pairing.role === 'license') {
          annotation = `Review required: is ${licenseLabel} the license for ${hardwareLabel}, or an additional standalone renewal?`;
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
                    patchRow(index, { sku, unresolved: false });
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
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          patchRow(index, { sku: product.sku, unresolved: false });
                          searchTokenRef.current += 1;
                          setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
                        }}
                        style={{ display: 'block', width: '100%', padding: '6px 7px', textAlign: 'left', border: 'none', borderBottom: `1px solid ${COLORS.BORDER}`, background: '#fff', color: COLORS.TEXT_PRIMARY, cursor: 'pointer', fontSize: 10 }}
                      >
                        <b>{product.sku}</b>{product.name ? ` — ${product.name}` : ''}
                        <span style={{ display: 'block', color: COLORS.TEXT_SECONDARY }}>
                          {product.source === 'zoho' ? 'live Zoho' : product.source}
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
                disabled={disabled}
                onChange={(event) => patchRow(index, { qty: event.target.value })}
                style={{ width: 62, boxSizing: 'border-box', fontSize: 11, padding: '5px 4px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}` }}
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
                disabled={disabled || index === 0}
                onClick={() => moveRow(index, -1)}
                title="Move up"
                style={{ padding: '4px 6px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', cursor: disabled || index === 0 ? 'default' : 'pointer' }}
              >↑</button>
              <button
                type="button"
                aria-label={`Move SKU row ${index + 1} down`}
                disabled={disabled || index === values.length - 1}
                onClick={() => moveRow(index, 1)}
                title="Move down"
                style={{ padding: '4px 6px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', cursor: disabled || index === values.length - 1 ? 'default' : 'pointer' }}
              >↓</button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  searchTokenRef.current += 1;
                  setSearch({ index: -1, query: '', loading: false, products: [], error: '' });
                  publish(values.filter((_, rowIndex) => rowIndex !== index));
                }}
                title="Remove this SKU"
                style={{ padding: '4px 7px', borderRadius: 5, border: `1px solid ${COLORS.BORDER}`, background: 'transparent', color: '#c5221f', cursor: disabled ? 'default' : 'pointer' }}
              >
                Remove
              </button>
            </div>
            {(pairing.role === 'license' && (needsReview || paired || standalone)) && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 3, paddingLeft: 3 }}>
                <span style={{ fontSize: 9, color: COLORS.TEXT_SECONDARY }}>License use</span>
                <select
                  aria-label={`License use row ${index + 1}`}
                  value={row?.licenseIntent || ''}
                  disabled={disabled}
                  onChange={(event) => patchRow(index, { licenseIntent: event.target.value })}
                  style={{ fontSize: 10, padding: '3px 4px', borderRadius: 5, border: `1px solid ${needsReview ? '#e37400' : COLORS.BORDER}`, background: '#fff' }}
                >
                  <option value="">Choose…</option>
                  <option value="paired">Device-associated license (one total)</option>
                  <option value="standalone">Standalone renewal / additional license</option>
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
          </div>
        );
      })}
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
