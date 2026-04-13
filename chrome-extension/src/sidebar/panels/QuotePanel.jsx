/**
 * Quote Panel
 * Full quoting interface with deterministic engine, SKU validation,
 * EOL detection, "Send to Zoho" CRM quote creation, and API fallback.
 */

import { useState, useEffect, useRef } from 'react';
import { sendToBackground } from '../../lib/messaging';
import { MSG, COLORS } from '../../lib/constants';

export default function QuotePanel({ navData, emailContext, onNavigate }) {
  const [skuText, setSkuText] = useState('');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState(null);
  const [analyzingImage, setAnalyzingImage] = useState(false);
  const [imageAnalysis, setImageAnalysis] = useState(null);
  const [showZohoPrompt, setShowZohoPrompt] = useState(false);
  const inputRef = useRef(null);
  const lastRequestRef = useRef(0); // Rate-limit: min 1s between requests

  // Persistent personId for conversation history (enables pricing follow-ups, revisions, confirmations)
  const personIdRef = useRef('chrome-ext-quote-' + (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now()));

  // Pre-fill from navData — additive: append clicked SKUs as comma-separated
  useEffect(() => {
    if (navData?.skuText) {
      setSkuText((prev) => {
        const incoming = navData.skuText.trim();
        if (!prev.trim()) return incoming;
        // Avoid duplicates: check if this SKU is already in the list
        const existing = prev.split(',').map(s => s.trim().toUpperCase());
        if (existing.includes(incoming.toUpperCase())) return prev;
        return `${prev.trim()}, ${incoming}`;
      });
      setResult(null);
      setImageAnalysis(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [navData]);

  // Handle image analysis from navData (base64 or URL)
  useEffect(() => {
    if (navData?.imageBase64) handleImageAnalysis(null, navData.imageBase64);
    else if (navData?.imageUrl) handleImageAnalysis(navData.imageUrl);
  }, [navData?.imageUrl, navData?.imageBase64]);

  async function handleImageAnalysis(imageUrl, imageBase64) {
    setAnalyzingImage(true);
    setError(null);
    setResult(null);
    setImageAnalysis(null);
    try {
      const res = await sendToBackground(MSG.ANALYZE_IMAGE, { imageUrl, imageBase64 });

      if (res && res.quoteUrls && Array.isArray(res.quoteUrls) && res.quoteUrls.length > 0) {
        // API returned full quote URLs — show them directly
        setResult({
          urls: res.quoteUrls.map(u => (u && typeof u === 'object') ? u : { url: String(u), label: 'Quote' }),
          eolWarnings: [],
          suggestions: null,
          parsed: [],
          source: 'api',
        });
        setImageAnalysis({ analysis: res.analysis, hasUrls: true });
      } else if (res && res.analysis) {
        // Got analysis text, try to extract SKUs from it
        // Filter out license SKUs (LIC-*) — image parsing should only extract hardware models
        const skuRegex = /\b((?:MR|MV|MT|MG|MX|MS|CW|C9|C8|Z)[A-Z0-9-]+)\b/gi;
        const rawMatches = res.analysis.match(skuRegex) || [];
        const matches = [...new Set(rawMatches.map(s => s.toUpperCase()))]
          .filter(s => !s.startsWith('LIC-')); // Exclude license keys from hardware detection
        if (matches.length > 0) {
          setSkuText(matches.join('\n'));
          setImageAnalysis({ skus: matches, message: `Detected ${matches.length} hardware SKU(s) from image` });
        } else {
          setImageAnalysis({ skus: [], message: 'No hardware SKUs detected in this image.', analysis: res.analysis });
        }
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
    const now = Date.now();
    if (now - lastRequestRef.current < 1000) return; // Rate-limit: 1 request/sec
    lastRequestRef.current = now;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowZohoPrompt(false);

    try {
      // Route ALL requests through the worker API — uses the exact same
      // handler chain as Webex and GChat bots: EOL dates → confirmations → pricing → SKU quotes → Claude
      const res = await sendToBackground(MSG.GENERATE_QUOTE, {
        skuText: skuText.trim(),
        personId: personIdRef.current,
      });
      if (res) {
        const rawUrls = res.quoteUrls || res.urls || [];
        const urlsArr = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
        const eolArr = Array.isArray(res.eolWarnings) ? res.eolWarnings : [];
        const parsedRaw = Array.isArray(res.parsedItems) ? res.parsedItems : [];
        const suggestArr = Array.isArray(res.suggestions) ? res.suggestions : null;

        // Handle all response types from the full handler chain
        if (res.pricingResponse) {
          // Deterministic pricing calculator response
          setResult({
            urls: [],
            eolWarnings: [],
            suggestions: null,
            parsed: [],
            pricingResponse: res.pricingResponse,
            handlerType: 'pricing',
            source: 'pricing',
          });
        } else if (res.eolDateResponse) {
          // EOL date lookup response
          setResult({
            urls: [],
            eolWarnings: [],
            suggestions: null,
            parsed: [],
            eolDateResponse: res.eolDateResponse,
            handlerType: 'eol-date',
            source: 'eol-date',
          });
        } else if (urlsArr.length > 0 || (suggestArr && suggestArr.length > 0) || res.claudeResponse) {
          setResult({
            urls: urlsArr.map(u => (u && typeof u === 'object') ? u : { url: String(u), label: 'Quote' }),
            eolWarnings: eolArr,
            suggestions: suggestArr,
            parsed: parsedRaw.map(p => ({ baseSku: p.sku || p.baseSku || '', qty: p.qty || 1 })),
            claudeResponse: res.claudeResponse || null,
            handlerType: res.handlerType || 'deterministic',
            source: res.claudeResponse && urlsArr.length === 0 ? 'claude' : 'api',
          });
        } else if (res.error) {
          setError(res.error);
        } else {
          setError('No quote generated. Check your SKU input.');
        }
      } else {
        setError('No response from quote API.');
      }
    } catch (err) {
      console.error('[Stratus] Quote generation error:', err);
      setError(err.message || 'Quote generation failed');
    } finally {
      setLoading(false);
    }
  }

  function handleApplySuggestion(suggestion) {
    const replacement = suggestion.suggest[0];
    const escapedInput = suggestion.input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // Replace the invalid SKU with the suggested correction
    const regex = new RegExp(escapedInput + '(?![A-Z0-9-])', 'gi');
    let newText = skuText.replace(regex, replacement);
    if (newText === skuText) {
      // Fallback: replace entire text
      newText = replacement;
    }
    setSkuText(newText);
    setResult(null);
    // Auto-generate quote after applying suggestion
    setTimeout(() => {
      handleGenerateWithText(newText);
    }, 50);
  }

  async function handleGenerateWithText(text) {
    if (!text || !text.trim()) return;
    const now = Date.now();
    if (now - lastRequestRef.current < 1000) return; // Rate-limit: 1 request/sec
    lastRequestRef.current = now;
    setLoading(true);
    setError(null);
    setResult(null);
    setShowZohoPrompt(false);
    try {
      const res = await sendToBackground(MSG.GENERATE_QUOTE, {
        skuText: text.trim(),
        personId: personIdRef.current,
      });
      if (res) {
        const rawUrls = res.quoteUrls || res.urls || [];
        const urlsArr = Array.isArray(rawUrls) ? rawUrls : (rawUrls ? [rawUrls] : []);
        const eolArr = Array.isArray(res.eolWarnings) ? res.eolWarnings : [];
        const parsedRaw = Array.isArray(res.parsedItems) ? res.parsedItems : [];
        const suggestArr = Array.isArray(res.suggestions) ? res.suggestions : null;
        if (urlsArr.length > 0 || (suggestArr && suggestArr.length > 0) || res.claudeResponse || res.pricingResponse || res.eolDateResponse) {
          setResult({
            urls: urlsArr.map(u => (u && typeof u === 'object') ? u : { url: String(u), label: 'Quote' }),
            eolWarnings: eolArr,
            suggestions: suggestArr,
            parsed: parsedRaw.map(p => ({ baseSku: p.sku || p.baseSku || '', qty: p.qty || 1 })),
            claudeResponse: res.claudeResponse || null,
            pricingResponse: res.pricingResponse || null,
            eolDateResponse: res.eolDateResponse || null,
            handlerType: res.handlerType || 'deterministic',
            source: res.pricingResponse ? 'pricing' : res.eolDateResponse ? 'eol-date' : res.claudeResponse ? 'claude' : 'api',
          });
        } else if (res.error) {
          setError(res.error);
        }
      }
    } catch (err) {
      setError(err.message || 'Quote generation failed');
    } finally {
      setLoading(false);
    }
  }

  function handleStackSuggestion(suggestion) {
    // Stack: append the suggested SKU to the current input (for building multi-SKU quotes)
    const replacement = suggestion.suggest[0];
    const current = skuText.trim();
    if (current) {
      setSkuText(current + ', ' + replacement);
    } else {
      setSkuText(replacement);
    }
    setResult(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function handleCaptureScreenshot() {
    setAnalyzingImage(true);
    setError(null);
    setResult(null);
    setImageAnalysis(null);
    try {
      const captureResult = await sendToBackground(MSG.CAPTURE_TAB, {});
      if (!captureResult || !captureResult.success) {
        throw new Error(captureResult?.error || 'Screenshot capture failed');
      }
      await handleImageAnalysis(null, captureResult.base64);
    } catch (err) {
      setError('Screenshot capture failed: ' + err.message);
      setAnalyzingImage(false);
    }
  }

  async function handleCopy(text, idx) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 2000);
  }

  function handleSendToZoho() {
    // Build a message with the parsed SKUs for the chat panel to create a Zoho quote
    const items = result?.parsed?.filter(p => p.validation?.valid !== false) || result?.parsed || [];
    const skuSummary = items.map(i => `${i.qty || 1}x ${i.baseSku}`).join(', ');
    const customerName = emailContext?.customerName || emailContext?.senderName || '';
    const customerDomain = emailContext?.customerDomain || '';

    // Build the CRM request text
    let requestText = `Create a Zoho CRM quote with: ${skuSummary}`;
    if (customerName || customerDomain) {
      requestText += ` for ${customerName || customerDomain}`;
    }

    // Navigate to chat panel with the pre-filled request
    if (onNavigate) {
      onNavigate('chat', { prefillText: requestText });
    }
  }

  function handleSendToGChat() {
    // Open GChat with a pre-composed message for CRM quote creation
    const items = result?.parsed?.filter(p => p.validation?.valid !== false) || result?.parsed || [];
    const skuSummary = items.map(i => `${i.qty || 1}x ${i.baseSku}`).join(', ');
    const customerName = emailContext?.customerName || emailContext?.senderName || '';

    let msg = `Create a quote with ${skuSummary}`;
    if (customerName) msg += ` for ${customerName}`;

    // Open GChat in new tab with the Stratus AI bot space
    const gchatUrl = `https://chat.google.com/room/AAAAnp6E_Yw?cls=7`;
    window.open(gchatUrl, '_blank');
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
          Analyzing image for SKUs...
        </div>
      )}

      {imageAnalysis && (
        <div style={{
          padding: 10, borderRadius: 8, marginBottom: 12, fontSize: 12,
          background: imageAnalysis.skus?.length ? '#e8f5e9' : '#fef7e0',
          color: imageAnalysis.skus?.length ? '#2e7d32' : '#e37400',
        }}>
          {imageAnalysis.skus?.length
            ? `Detected ${imageAnalysis.skus.length} SKU${imageAnalysis.skus.length > 1 ? 's' : ''} from image`
            : imageAnalysis.message || 'No SKUs found in image'}
        </div>
      )}

      {/* SKU Input */}
      <textarea
        ref={inputRef}
        value={skuText}
        onChange={(e) => setSkuText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Enter SKUs (e.g., 10 MR44, 5 MS130-24P, 2 MX67)"
        rows={4}
        style={{
          width: '100%', padding: '10px 12px', border: `1px solid ${COLORS.BORDER}`,
          borderRadius: 8, fontSize: 13, fontFamily: 'monospace', resize: 'vertical',
          outline: 'none', boxSizing: 'border-box', marginBottom: 12,
        }}
      />

      {/* Generate Button */}
      {/* Button Row: Generate + Screenshot */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
        <button
          onClick={handleGenerate}
          disabled={loading || !skuText.trim()}
          style={{
            flex: 1, padding: '10px 16px',
            background: loading ? COLORS.TEXT_SECONDARY : COLORS.STRATUS_BLUE,
            color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
            fontWeight: 600, cursor: loading ? 'default' : 'pointer',
            opacity: loading || !skuText.trim() ? 0.7 : 1,
          }}
        >
          {loading ? 'Generating...' : 'Generate Quote'}
        </button>
        <button
          onClick={handleCaptureScreenshot}
          disabled={analyzingImage}
          title="Capture visible tab as screenshot and analyze for SKUs"
          style={{
            padding: '10px 14px',
            background: analyzingImage ? COLORS.TEXT_SECONDARY : '#ff6f00',
            color: 'white', border: 'none', borderRadius: 8, fontSize: 14,
            cursor: analyzingImage ? 'default' : 'pointer',
            opacity: analyzingImage ? 0.7 : 1,
          }}
        >
          {analyzingImage ? '...' : '📷'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div style={{
          padding: 12, background: '#fce8e6', borderRadius: 8,
          color: COLORS.ERROR, fontSize: 13, marginTop: 12,
        }}>
          {error}
        </div>
      )}

      {/* Validation Suggestions (Did you mean?) */}
      {result?.suggestions && result.suggestions.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {result.suggestions.map((s, i) => (
            <div key={i} style={{
              padding: 10, background: '#fff3e0', borderRadius: 8,
              border: '1px solid #ff980033', marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#e65100', marginBottom: 4 }}>
                {s.isCommonMistake ? '⚠️' : '❓'} {s.input}: {s.reason}
              </div>
              {s.suggest && s.suggest.length > 0 && (
                <div style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY }}>
                  <span style={{ color: COLORS.TEXT_SECONDARY }}>Did you mean: </span>
                  {s.suggest.map((sug, j) => (
                    <span key={j} style={{ display: 'inline-flex', gap: 2, marginRight: 6, marginTop: 4 }}>
                      <button
                        onClick={() => handleApplySuggestion({ ...s, suggest: [sug] })}
                        title="Replace invalid SKU with this"
                        style={{
                          background: COLORS.STRATUS_LIGHT, color: COLORS.STRATUS_BLUE,
                          border: `1px solid ${COLORS.STRATUS_BLUE}44`, borderRadius: '4px 0 0 4px',
                          padding: '2px 8px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                        }}
                      >
                        {sug}
                      </button>
                      <button
                        onClick={() => handleStackSuggestion({ ...s, suggest: [sug] })}
                        title="Add to quote (stack)"
                        style={{
                          background: COLORS.STRATUS_BLUE, color: 'white',
                          border: `1px solid ${COLORS.STRATUS_BLUE}`, borderRadius: '0 4px 4px 0',
                          padding: '2px 5px', fontSize: 11, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        +
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Pricing Response (deterministic calculator) */}
      {result && result.pricingResponse && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, marginBottom: 12,
            background: '#e8f5e9', color: '#2e7d32',
          }}>
            💰 Pricing Calculator
          </div>
          <div style={{
            background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.6,
            color: COLORS.TEXT_PRIMARY, whiteSpace: 'pre-wrap', fontFamily: 'monospace',
          }}>
            {result.pricingResponse.split('\n').map((line, i) => {
              const isBold = line.startsWith('**') || line.includes('**');
              const cleaned = line.replace(/\*\*/g, '');
              const isTotal = /total|cart/i.test(cleaned);
              return (
                <div key={i} style={{
                  fontWeight: (isBold || isTotal) ? 700 : 400,
                  borderTop: isTotal ? `1px solid ${COLORS.BORDER}` : 'none',
                  paddingTop: isTotal ? 6 : 0,
                  marginTop: isTotal ? 6 : 0,
                }}>
                  {cleaned}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* EOL Date Response */}
      {result && result.eolDateResponse && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, marginBottom: 12,
            background: '#fef7e0', color: '#e37400',
          }}>
            📅 EOL Date Lookup
          </div>
          <div style={{
            background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.6,
            color: COLORS.TEXT_PRIMARY, whiteSpace: 'pre-wrap',
          }}>
            {result.eolDateResponse.split('\n').map((line, i) => {
              const cleaned = line.replace(/\*\*/g, '');
              const isBold = line.startsWith('**') || line.includes('**');
              return (
                <div key={i} style={{ fontWeight: isBold ? 700 : 400 }}>
                  {cleaned}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Claude AI Response (technical questions, advisory) */}
      {result && result.claudeResponse && (!result.urls || result.urls.length === 0) && (
        <div style={{ marginTop: 16 }}>
          <div style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, marginBottom: 12,
            background: '#e3f2fd', color: '#1565c0',
          }}>
            🤖 AI Response
          </div>
          <div style={{
            background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
            borderRadius: 8, padding: 12, fontSize: 13, lineHeight: 1.6,
            color: COLORS.TEXT_PRIMARY, whiteSpace: 'pre-wrap',
          }}>
            {result.claudeResponse.split('\n').map((line, i) => {
              // Basic markdown: bold, links, URLs
              const parts = [];
              let remaining = line;
              // Bold
              remaining = remaining.replace(/\*\*([^*]+)\*\*/g, (_, t) => `<b>${t}</b>`);
              // Inline URLs
              const urlRegex = /(https:\/\/stratusinfosystems\.com\/order\/[^\s)>\]]+)/g;
              let match, lastIdx = 0;
              const lineElements = [];
              while ((match = urlRegex.exec(remaining)) !== null) {
                if (match.index > lastIdx) lineElements.push(<span key={`t${i}-${lastIdx}`} dangerouslySetInnerHTML={{ __html: remaining.substring(lastIdx, match.index) }} />);
                lineElements.push(<a key={`u${i}-${match.index}`} href={match[1]} target="_blank" rel="noopener" style={{ color: COLORS.STRATUS_BLUE, wordBreak: 'break-all' }}>{match[1].length > 60 ? match[1].substring(0, 60) + '...' : match[1]}</a>);
                lastIdx = match.index + match[0].length;
              }
              if (lastIdx < remaining.length) lineElements.push(<span key={`e${i}`} dangerouslySetInnerHTML={{ __html: remaining.substring(lastIdx) }} />);
              return <div key={i}>{lineElements.length > 0 ? lineElements : <span dangerouslySetInnerHTML={{ __html: remaining }} />}</div>;
            })}
          </div>
        </div>
      )}

      {/* Results */}
      {result && result.urls && result.urls.length > 0 && (
        <div style={{ marginTop: 16 }}>
          {/* Source Badge */}
          <div style={{
            display: 'inline-block', padding: '4px 10px', borderRadius: 4,
            fontSize: 11, fontWeight: 600, marginBottom: 12,
            background: '#e8f5e9',
            color: '#2e7d32',
          }}>
            ⚡ Deterministic
          </div>

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
                <div key={i} style={{ fontSize: 12, color: COLORS.TEXT_PRIMARY, padding: '2px 0' }}>
                  {typeof w === 'string' ? w : `${w.sku} is End-of-Life`}
                </div>
              ))}
            </div>
          )}

          {/* Quote URLs */}
          {result.urls.map((urlObj, i) => (
            <div key={i} style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginBottom: 8,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.TEXT_PRIMARY, marginBottom: 6 }}>
                {urlObj.label || `Option ${i + 1}`}
              </div>
              <div style={{
                background: COLORS.BG_SECONDARY, borderRadius: 6, padding: '8px 10px',
                fontSize: 11, wordBreak: 'break-all', color: COLORS.STRATUS_BLUE, marginBottom: 8,
              }}>
                <a href={urlObj.url} target="_blank" rel="noopener" style={{ color: 'inherit', textDecoration: 'none' }}>
                  {urlObj.url.length > 120 ? urlObj.url.substring(0, 120) + '...' : urlObj.url}
                </a>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => handleCopy(urlObj.url, i)}
                  style={{
                    flex: 1, padding: '6px 10px', background: COLORS.STRATUS_BLUE,
                    color: 'white', border: 'none', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {copiedIdx === i ? '✓ Copied!' : 'Copy'}
                </button>
                <a
                  href={urlObj.url} target="_blank" rel="noopener"
                  style={{
                    flex: 1, padding: '6px 10px', background: 'transparent',
                    color: COLORS.STRATUS_BLUE, border: `1px solid ${COLORS.STRATUS_BLUE}`,
                    borderRadius: 6, fontSize: 12, fontWeight: 600, textDecoration: 'none',
                    textAlign: 'center', display: 'inline-block',
                  }}
                >
                  Open
                </a>
              </div>
            </div>
          ))}

          {/* Send to Zoho CRM / GChat */}
          <div style={{
            marginTop: 8, padding: 12, background: '#f3e5f5', borderRadius: 8,
            border: '1px solid #ce93d8',
          }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#7b1fa2', marginBottom: 8 }}>
              Create CRM Quote
            </div>
            {!showZohoPrompt ? (
              <button
                onClick={() => setShowZohoPrompt(true)}
                style={{
                  width: '100%', padding: '8px 12px', background: '#7b1fa2',
                  color: 'white', border: 'none', borderRadius: 6, fontSize: 13,
                  fontWeight: 600, cursor: 'pointer',
                }}
              >
                Send to Zoho CRM
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#4a148c', marginBottom: 4 }}>
                  Route quote creation through:
                </div>
                <button
                  onClick={handleSendToZoho}
                  style={{
                    padding: '8px 12px', background: '#7b1fa2', color: 'white',
                    border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Extension Chat (recommended)
                </button>
                <button
                  onClick={handleSendToGChat}
                  style={{
                    padding: '8px 12px', background: 'transparent', color: '#7b1fa2',
                    border: '1px solid #7b1fa2', borderRadius: 6, fontSize: 12,
                    fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  Open Google Chat
                </button>
              </div>
            )}
          </div>

          {/* Parsed Items */}
          {result.parsed && result.parsed.length > 0 && (
            <div style={{
              background: COLORS.BG_PRIMARY, border: `1px solid ${COLORS.BORDER}`,
              borderRadius: 8, padding: 12, marginTop: 8,
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: COLORS.TEXT_SECONDARY, marginBottom: 6 }}>
                Parsed Items
              </div>
              {result.parsed.map((item, i) => {
                const v = item.validation;
                const isValid = !v || v.valid;
                const isEol = v?.eol;
                return (
                  <div key={i} style={{
                    fontSize: 12, padding: '3px 0', display: 'flex', alignItems: 'center', gap: 6,
                    color: !isValid ? COLORS.ERROR : isEol ? '#e37400' : COLORS.TEXT_PRIMARY,
                  }}>
                    <span style={{ fontWeight: 600 }}>{item.qty || 1}x</span>
                    <span>{item.baseSku}</span>
                    {isEol && <span style={{ fontSize: 10, color: '#e37400' }}>(EOL)</span>}
                    {!isValid && <span style={{ fontSize: 10 }}>✗</span>}
                    {isValid && !isEol && <span style={{ fontSize: 10, color: '#2e7d32' }}>✓</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tips */}
      <div style={{
        marginTop: 16, padding: 10, background: COLORS.BG_PRIMARY,
        borderRadius: 8, border: `1px solid ${COLORS.BORDER}`,
      }}>
        <div style={{ fontSize: 11, color: COLORS.TEXT_SECONDARY, lineHeight: 1.5 }}>
          <strong>Tips:</strong> Enter SKUs with quantities (10 MR44, 5 MS130-24P).
          Supports CSV, lists, and natural language. EOL products auto-generate replacement options.
          Use "hardware only" or "license only" modifiers. Ask "cost of option 2" for pricing.
          Try "when does MR44 go EOL?" or "MR46 vs MR44" for technical questions.
        </div>
      </div>
    </div>
  );
}
