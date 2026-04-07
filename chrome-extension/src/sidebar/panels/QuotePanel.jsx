/**
 * Quote Panel
 * Quick quote builder with SKU input, URL generation, and clipboard copy.
 */

import { useState, useEffect, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';
import { generateLocalQuote } from '../../lib/quote-engine';

export default function QuotePanel({ navData }) {
  const [skuText, setSkuText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState(null);
  const inputRef = useRef(null);

  // Pre-fill from navData (context menu, SKU click, keyboard shortcut)
  useEffect(() => {
    if (navData?.skuText) {
      setSkuText(navData.skuText);
      setResult(null);
      setImageAnalysis(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [navData]);

  // Handle image analysis from right-click context menu
  useEffect(() => {
    if (navData?.imageUrl) {
      handleImageAnalysis(navData.imageUrl);
    }
  }, [navData?.imageUrl]);

  async function handleImageAnalysis(imageUrl) {
    setAnalyzingImage(true);
    setError(null);
    setResult(null);
    setImageAnalysis(null);

    try {
      const res = await sendToBackground(MSG.ANALYZE_IMAGE, { imageUrl });
      if (res && res.skus && res.skus.length > 0) {
        const skuString = res.skus.map(s => `${s.qty > 1 ? s.qty + ' ' : ''}${s.sku}`).join('\n');
        setSkuText(skuString);
        setImageAnalysis(res);
      } else {
        setImageAnalysis({ skus: [], message: 'No SKUs detected in this image.' });
      }
    } catch (err) {
      setError('Image analysis failed: ' + err.message);
    } finally {
      setAnalyzingImage(false);
    }
  }

  async function handleGenerate() {
    if (!skuText.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Try local quote generation first
      const localResult = generateLocalQuote(skuText.trim());

      // If local engine handled it without needing API, use that result
      if (!localResult.needsApi) {
        setResult({
          quoteUrls: [{ url: localResult.url, label: 'Local Quote' }],
          eolWarnings: localResult.eolWarnings || [],
          parsedItems: localResult.parsed || [],
          source: 'local',
        });
      } else {
        // Fall back to API for complex requests
        const res = await sendToBackground(MSG.GENERATE_QUOTE, { skuText: skuText.trim() });
        setResult({
          ...res,
          source: 'api',
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy(text) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-secure contexts
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <div style={{ padding: 16 }}>
      {/* Image Analysis Status */}
      {analyzingImage && (
        <div style={{
          padding: 12, background: '#e3f2fd', borderRadius: 8,
          marginBottom: 12, textAlign: 'center', color: '#1565c0', fontSize: 13,
        }}>
          <div className="spinner" style={{ margin: '0 auto 8px' }} />
          Analyzing image for SKUs...
        </div>
      )}

      {imageAnalysis && (
        <div style={{
          padding: 10, background: imageAnalysis.skus?.length ? '#e8f5e9' : '#fef7e0',
          borderRadius: 8, marginBottom: 12, fontSize: 12,
          color: imageAnalysis.skus?.length ? '#2e7d32' : '#e37400',
        }}>
          {imageAnalysis.skus?.length
            ? `📸 Detected ${imageAnalysis.skus.length} SKU${imageAnalysis.skus.length > 1 ? 's' : ''} from image`
            : imageAnalysis.message || 'No SKUs found in image'}
        </div>
      )}

      {/* SKU Input */}
      <div style={{ marginBottom: 12 }}>
        <textarea
          ref={inputRef}
          value={skuText}
          onChange={(e) => setSkuText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter SKUs (e.g., 10 MR44, 5 MS130-24P, 2 MX67)"
          rows={4}
          style={{
            width: '100%', padding: '10px 12px', border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, fontSize: 13, fontFamily: 'inherit', resize: 'vertical',
            outline: 'none', boxSizing: 'border-box',
          }}
        />
      </div>

      {/* Generate Button */}
      <button
        onClick={handleGenerate}
        disabled={loading || !skuText.trim()}
        style={{
          width: '100%', padding: '10px 16px', background: loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
          color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
          fontWeight: 600, cursor: loading ? 'default' : 'pointer',
          opacity: loading || !skuText.trim() ? 0.7 : 1,
        }}
      >
        {loading ? 'Generating...' : 'Generate Quote URL'}
      </button>

      {/* Error */}
      {error && (
        <div style={{
          padding: 12, background: '#fce8e6', borderRadius: 8,
          color: COLORS.ERROR, fontSize: 13, marginTop: 12,
        }}>
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <div style={{ marginTop: 16 }}>
          {/* Source Badge */}
          {result.source && (
            <div style={{
              display: 'inline-block', padding: '4px 10px', borderRadius: 4,
              fontSize: 11, fontWeight: 600, marginBottom: 12,
              background: result.source === 'local' ? '#e8f5e9' : '#e3f2fd',
              color: result.source === 'local' ? '#2e7d32' : '#1565c0',
            }}>
              {result.source === 'local' ? '⚡ Local' : '🔗 API'}
            </div>
          )}

          {/* EOL Warnings */}
          {result.eolWarnings && result.eolWarnings.length > 0 && (
            <div style={{
              padding: 10, background: '#fef7e0', borderRadius: 8,
              border: '1px solid #fbbc0433', marginBottom: 12,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#e37400', marginBottom: 4 }}>
                EOL Warnings
              </div>
              {result.eolWarnings.map((w, i) => (
                <div key={i} style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>{w}</div>
              ))}
            </div>
          )}

          {/* Quote URLs */}
          {result.quoteUrls && result.quoteUrls.map((url, i) => (
            <div key={i} style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                {url.label || `Option ${i + 1}`}
              </div>
              <div style={{
                background: COLORS.BG_SECONDARY, borderRadius: 6, padding: '8px 10px',
                fontSize: 12, wordBreak: 'break-all', color: COLORS.STRATUS_BLUE, marginBottom: 8,
              }}>
                <a href={url.url || url} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {(url.url || url).substring(0, 100)}...
                </a>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => handleCopy(url.url || url)}
                  style={{
                    flex: 1, padding: '6px 12px', background: COLORS.STRATUS_BLUE,
                    color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {copied ? '✓ Copied!' : 'Copy URL'}
                </button>
                <a
                  href={url.url || url}
                  target="_blank"
                  rel="noopener"
                  style={{
                    flex: 1, padding: '6px 12px', background: 'transparent',
                    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}`,
                    borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                    textAlign: 'center', display: 'inline-block',
                  }}
                >
                  Open Quote
                </a>
              </div>
            </div>
          ))}

          {/* Parsed Items Summary */}
          {result.parsedItems && result.parsedItems.length > 0 && (
            <div style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginTop: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                Parsed Items
              </div>
              {result.parsedItems.map((item, i) => (
                <div key={i} style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, padding: '2px 0' }}>
                  {item.qty}x {item.sku}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tips */}
      <div style={{
        marginTop: 16, padding: 10, background: COLORS.BG_PRIMARY,
        borderRadius: 8, border: `1px solid ${COLORS.BORDER}`,
      }}>
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY }}>
          <strong>Tips:</strong> Enter one SKU per line or comma-separated.
          Quantities default to 1. Press Enter to generate.
          Use "hardware only" or "license only" modifiers.
        </div>
      </div>
    </div>
  );
}
