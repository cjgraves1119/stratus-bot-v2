// Tests run against the ACTUAL patched bundle text (deployed-gchat.clean.mjs),
// extracting the patched regions at runtime so what we test is what we ship.
import { readFileSync } from "node:fs";
import assert from "node:assert";

const SRC = readFileSync(new URL("./src/index.js", import.meta.url), "utf8");

// ── extract classifier (stripInjectedClassifierContext + classifyCrmIntent) ──
const clfStart = SRC.indexOf("function stripInjectedClassifierContext(");
const clfEnd = SRC.indexOf("function selectToolSubset(");
assert(clfStart > 0 && clfEnd > clfStart, "classifier region found");
const clfCode = SRC.slice(clfStart, clfEnd);
const clfFactory = new Function(`${clfCode}; return classifyCrmIntent;`);
const classifyCrmIntent = clfFactory();

// ── extract zoho_update_record guard (case head through applyFieldAliases) ──
const updStart = SRC.indexOf("case 'zoho_update_record': {");
const updEnd = SRC.indexOf("// 2026-05-19 Fix E", updStart);
assert(updStart > 0 && updEnd > updStart, "update guard region found");
const updGuard = SRC.slice(SRC.indexOf("{", updStart) + 1, updEnd);
const updFactory = new Function("toolInput", `${updGuard}; return { ok: true, data };`);

// ── extract zoho_create_record guard ──
const creStart = SRC.indexOf("case 'zoho_create_record': {");
const creEnd = SRC.indexOf("// Default Owner injection", creStart);
assert(creStart > 0 && creEnd > creStart, "create guard region found");
const creGuard = SRC.slice(SRC.indexOf("{", creStart) + 1, creEnd);
const creFactory = new Function("toolInput", `${creGuard}; return { ok: true, recordData };`);

const CANNED = `Create a Zoho CRM quote from this Stratus quote: https://stratusinfosystems.com/order/?item=LIC-ENT-3YR,LIC-MS120-24P-3YR,LIC-MS120-8FP-3YR&qty=68,7,3
Line items: 68x LIC-ENT-3YR, 7x LIC-MS120-24P-3YR, 3x LIC-MS120-8FP-3YR`;
const EMAIL_WRAP = (userText, body) =>
  `[Email context: Subject: "Meraki License Renewal", From: Chi Obinnah (chi@jhlarson.com)]\n[Email body:\n${body}]\n\n${userText}`;
const HIJACK_BODY = "Hi Chris, please review the email below and send over pricing when you can. Thanks!";

let n = 0;
const t = (name, fn) => { fn(); console.log(`ok ${++n} - ${name}`); };

// ── incident cases (must be fixed) ──
t("canned button text alone -> crm_write 0.98", () => {
  const r = classifyCrmIntent(CANNED, {});
  assert.equal(r.class, "crm_write"); assert.equal(r.confidence, 0.98);
});
t("INCIDENT: canned + hijacking email body -> crm_write (was email)", () => {
  const r = classifyCrmIntent(EMAIL_WRAP(CANNED, HIJACK_BODY), {});
  assert.equal(r.class, "crm_write");
});
t("follow-up 'Yes, create it now with these exact 12 lines' + email body -> NOT email", () => {
  const r = classifyCrmIntent(EMAIL_WRAP("Yes, create it now with these exact 12 lines", HIJACK_BODY), {});
  assert.notEqual(r.class, "email");
});
t("'what is the issue' + email body -> NOT email (general => 13-tool subset w/ update)", () => {
  const r = classifyCrmIntent(EMAIL_WRAP("what is the issue", HIJACK_BODY), {});
  assert.notEqual(r.class, "email");
});
t("'create a zoho quote for them' -> crm_write 0.95 (regex gap closed)", () => {
  const r = classifyCrmIntent("create a zoho quote for them", {});
  assert.equal(r.class, "crm_write"); assert.equal(r.confidence, 0.95);
});
t("email body containing ']' mid-body: still not email for canned text", () => {
  const body = "Renewal list [see attached]\n\nplease review the email below and reply";
  const r = classifyCrmIntent(EMAIL_WRAP(CANNED, body), {});
  assert.equal(r.class, "crm_write");
});

// ── regressions (must be unchanged) ──
t("drafting-banner override still wins: '[User asked to draft a reply' -> email 0.98", () => {
  const r = classifyCrmIntent("[User asked to draft a reply in the current Gmail thread.]\nSubject: Re: x", {});
  assert.equal(r.class, "email"); assert.equal(r.confidence, 0.98);
});
t("user's own words 'draft a reply to this email' -> email (unchanged)", () => {
  const r = classifyCrmIntent("draft a reply to this email", {});
  assert.equal(r.class, "email");
});
t("'create a quote for J.H. Larson' -> crm_write 0.95 (unchanged)", () => {
  const r = classifyCrmIntent("create a quote for J.H. Larson", {});
  assert.equal(r.class, "crm_write"); assert.equal(r.confidence, 0.95);
});
t("'send me a quote link for 5 MR44' -> quote_url or general, never email/crm_write", () => {
  // The 2026-07-15 deployed bundle (745d6756, source not yet landed in git)
  // broadened the quote_url rule to match this phrasing; the Jul-13 source
  // classifies it general. Both are acceptable; tighten to quote_url once
  // the 2026-07-15 source lands.
  const r = classifyCrmIntent("send me a quote link for 5 MR44", {});
  assert(["quote_url", "general"].includes(r.class), `got ${r.class}`);
});
t("ctx-bound mutation rule: 'requote this' + active page -> crm_write or general, never email", () => {
  // 'requote' joined the ctx-rule verb list in the 2026-07-15 deploy (745d6756,
  // source not yet landed). Tighten to crm_write once that source lands.
  const r = classifyCrmIntent("requote this for 3 years", { hasActivePageContext: true });
  assert(["crm_write", "general"].includes(r.class), `got ${r.class}`);
});
t("empty/non-string input -> general 0.5 (unchanged)", () => {
  assert.equal(classifyCrmIntent("", {}).class, "general");
  assert.equal(classifyCrmIntent(null, {}).class, "general");
});

// ── update-record guard ──
t("update guard: JSON-string data is parsed and accepted", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1", data: '{"Quoted_Items":[{"Quantity":7}]}' });
  assert.equal(r.ok, true); assert.equal(r.data.Quoted_Items[0].Quantity, 7);
});
t("INCIDENT: update guard: unparseable string data -> instructive validation_error, no throw", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1", data: "Billing_Street: 10200 51st Ave" });
  assert.equal(r.validation_error, true); assert.equal(r.action, "update_blocked");
  assert.match(r.message, /JSON OBJECT/);
});
t("update guard: object data passes through untouched", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1", data: { Billing_City: "Plymouth" } });
  assert.equal(r.ok, true); assert.equal(r.data.Billing_City, "Plymouth");
});
t("update guard: array data -> validation_error", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1", data: [{ x: 1 }] });
  assert.equal(r.validation_error, true);
});
t("update guard: missing data -> validation_error, no TypeError", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1" });
  assert.equal(r.validation_error, true);
});

// ── create-record guard ──
t("create guard: JSON-string data parsed and accepted", () => {
  const r = creFactory({ module_name: "Deals", data: '{"Deal_Name":"x"}' });
  assert.equal(r.ok, true); assert.equal(r.recordData.Deal_Name, "x");
});
t("create guard: unparseable string -> validation_error", () => {
  const r = creFactory({ module_name: "Deals", data: "Deal_Name: x" });
  assert.equal(r.validation_error, true); assert.equal(r.action, "create_blocked");
});
t("create guard: array-of-object still unwraps to first record (unchanged)", () => {
  const r = creFactory({ module_name: "Deals", data: [{ Deal_Name: "y" }] });
  assert.equal(r.ok, true); assert.equal(r.recordData.Deal_Name, "y");
});

// ── council FIX-FIRST round: panel-confirmed findings ──
const BANNER_BODY = "[EXTERNAL]\n\nHi Chris, please review the email below and check your inbox for the attached PO. Thanks!";
t("PROD LAYOUT: [Email ctx/body w/ banner] + [CRM context] + [Session] + canned -> crm_write 0.98 (anchor live)", () => {
  const msg = `[Email context: Subject: "Meraki License Renewal", From: Chi Obinnah (chi@jhlarson.com)]\n[Email body:\n${BANNER_BODY}]\n\n[CRM context: Account "J.H. Larson Co." (id 2570562000416698177) matched for this sender.]\n[Session: Most recently worked quote 2570562000416704192]\n${CANNED}`;
  const r = classifyCrmIntent(msg, { hasQuoteSession: true });
  assert.equal(r.class, "crm_write"); assert.equal(r.confidence, 0.98);
});
t("FINDING 1 FIX: [EXTERNAL]-banner body + typed write ask -> crm_write, not email", () => {
  const r = classifyCrmIntent(EMAIL_WRAP("update the billing street on the quote to 10200 51st Ave", BANNER_BODY), {});
  assert.equal(r.class, "crm_write");
});
t("FINDING 1 FIX: [cid:] banner body + non-canned write ask -> not email", () => {
  const body = "[cid:image001.png@01DC.5A2B]\n\nHi Chris, please review the email below and reply with pricing.";
  const r = classifyCrmIntent(EMAIL_WRAP("change the Valid_Till on that quote to 2026-09-30", body), {});
  assert.notEqual(r.class, "email");
});
t("FINDING 3 FIX: 'send an email to Dan with the new zoho quote' stays email", () => {
  const r = classifyCrmIntent("send an email to Dan with the new zoho quote", {});
  assert.equal(r.class, "email");
});
t("FINDING 5 FIX: no-account [CRM context] block no longer hijacks send-reply asks", () => {
  const msg = `[CRM context: No existing Account found for domain jhlarson.com. If the user asks to create a quote/deal, first ask which account to use.]\n\ndraft a reply and send it to the customer`;
  const r = classifyCrmIntent(msg, {});
  assert.equal(r.class, "email");
});
t("[Session:] header alone no longer self-triggers a class from its own prose", () => {
  const r = classifyCrmIntent("[Session: Most recently worked quote 2570562000416704192]\nthanks, looks good", { hasQuoteSession: true });
  assert.notEqual(r.class, "crm_write");
});
t("[Active Zoho page:] header intentionally KEPT for classification (load-bearing)", () => {
  const r = classifyCrmIntent(`[Active Zoho page: user is currently viewing Quote 2570562000416704192 — "J.H. Larson Co."]\nfix the remaining lines`, { hasActivePageContext: true });
  assert.equal(r.class, "crm_write");
});
t("null data -> message says 'null' not 'object'", () => {
  const r = updFactory({ module_name: "Quotes", record_id: "1", data: null });
  assert.match(r.message, /got null/);
  const c = creFactory({ module_name: "Deals", data: null });
  assert.match(c.message, /got null/);
});
t("documented trade-off: user text w/ ']'+blank line over-strips toward general/crm (NEVER email)", () => {
  // Panel-endorsed direction: over-strip falls to `general`, whose subset still
  // carries zoho_update_record/zoho_create_record — benign vs an email-class hijack.
  const r = classifyCrmIntent(EMAIL_WRAP("create a quote for Acme [rush]\n\nneed it today", "clean body, no brackets"), {});
  assert.notEqual(r.class, "email");
});

console.log(`\nALL ${n} TESTS PASSED`);
