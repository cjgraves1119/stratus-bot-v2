const ev = require("./eval-model-intent-2026-06-04.js");
const eng = ev.loadEngine("/tmp/phase3/worker");

const v3 = (items, mods = {}) => ({
  intent: "quote",
  clarify: { needed: false, question: "" },
  items,
  modifiers: { term_years: null, tier: null, show_pricing: false, all_terms: false, separate_quotes: false, ...mods },
});

// Run a V3 classification through the prod path
function runV3(items, mods, text = "...") {
  return ev.consumeV3prod(eng, v3(items, mods), text);
}

// Run a raw NL string through parseMessage->buildQuoteResponse (the existing engine path)
// to compare against, so we can tell buildQuoteFromV3 defects from engine limits.
function runNL(text) {
  let p;
  try { p = eng.parseMessage(text); } catch (e) { return { kind: "err", err: e.message }; }
  if (!p) return { kind: "none" };
  if (p.isClarification && p.clarificationMessage) return { kind: "clarify", question: p.clarificationMessage };
  let r;
  try { r = eng.buildQuoteResponse(p); } catch (e) { return { kind: "err", err: e.message }; }
  if (!r) return { kind: "none" };
  if (!r.message || r.needsLlm || (r.errors && r.errors.length)) return { kind: "llm", errors: r.errors || null };
  return { kind: "quote", skus: skuQty(r.message), message: r.message };
}

function skuQty(text) {
  const map = {};
  for (const m of (text || "").matchAll(/item=([^&\s]+)&qty=([0-9,]+)/g)) {
    const skus = decodeURIComponent(m[1]).split(",");
    const qtys = m[2].split(",");
    skus.forEach((s, i) => { const q = parseInt(qtys[i] || "0", 10); if (!map[s] || q > map[s]) map[s] = q; });
  }
  return map;
}

// count number of distinct order URLs (grouping inspector)
function urlGroups(text) {
  return [...(text || "").matchAll(/order\/\?item=([^&\s]+)&qty=([0-9,]+)/g)].map(m => ({
    items: decodeURIComponent(m[1]),
    qtys: m[2],
  }));
}

module.exports = { runV3, runNL, skuQty, urlGroups, eng, v3 };
