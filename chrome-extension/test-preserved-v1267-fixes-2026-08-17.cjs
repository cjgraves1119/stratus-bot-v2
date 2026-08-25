"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const read = (name) => fs.readFileSync(path.join(__dirname, name), "utf8");
const manifest = JSON.parse(read("manifest.json"));
const content = read("src/content/index.js");
const snooze = read("src/content/gmail-send-task-snooze.js");
const optIn = read("public/stratus-task-email-optin.js");
const sidebar = read("public/sidebar.html");
const popup = read("public/popup.html");
const webpack = read("webpack.config.js");
const app = read("src/sidebar/App.jsx");
const contextLock = read("src/lib/context-lock.mjs");
const { manifestForTarget, resolveBuildTarget } = require("./release-targets.cjs");

assert.equal(manifest.name, "Stratus AI");
assert.equal(manifest.action.default_title, "Stratus AI");
assert.equal(manifest.version, "1.29.5");
assert.equal(manifest.update_url, "https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml");
assert.ok(manifest.optional_host_permissions.includes("https://stratusinfosystems.com/*"));
assert.ok(manifest.optional_host_permissions.includes("https://www.stratusinfosystems.com/*"));

const snapshotManifest = manifestForTarget(manifest, resolveBuildTarget("snapshot-dev", { environment: {} }));
assert.equal(snapshotManifest.name, "Stratus AI (DEV)");
assert.equal(snapshotManifest.action.default_title, "Stratus AI (DEV)");
assert.equal(snapshotManifest.version, "1.29.5");
assert.match(app, /DEV v\$\{chrome\.runtime\.getManifest\(\)\.version\}/);
assert.equal(Object.hasOwn(snapshotManifest, "update_url"), false);
assert.ok(snapshotManifest.optional_host_permissions.includes("https://stratusinfosystems.com/*"));
assert.ok(snapshotManifest.optional_host_permissions.includes("https://www.stratusinfosystems.com/*"));

assert.match(content, /import '\.\/gmail-send-task-snooze\.js'/);
assert.match(snooze, /Snooze only — no Zoho task/);
assert.match(snooze, /Task only — do not snooze/);
assert.match(snooze, /Snooze \+ Task — use the task date when available/);
assert.match(snooze, /makeModeChoice\(state,"snooze-task"[^\n]*true\)/, "Snooze + Task must remain the default");
assert.match(snooze, /snoozeTargetForTaskAction/);
assert.match(snooze, /movedDueDate\(outcome\)/);
assert.match(snooze, /back to search results/);
assert.match(snooze, /Snoozed until \$\{label\}/);
assert.match(snooze, /outcome could not be verified/);

const sandbox = {
  console,
  Date,
  Intl,
  Set,
  WeakMap,
  globalThis: null,
  window: null,
  __STRATUS_SNOOZE_TEST__: true,
};
sandbox.globalThis = sandbox;
sandbox.window = sandbox;
vm.runInNewContext(snooze, sandbox, { filename: "gmail-send-task-snooze.js" });
const hooks = sandbox.__STRATUS_SNOOZE_TEST_HOOKS__;
const friday = new Date(2026, 7, 14, 12, 0, 0);
assert.equal(hooks.localIsoDate(hooks.addBusinessDays(3, friday)), "2026-08-19", "3 business days must skip the weekend");
assert.equal(hooks.snoozeTargetForTaskAction({ classList: { contains: () => true } }, {
  querySelector: () => ({ value: "2026-08-27" }),
}), "2026-08-27", "manual Create Task due date must drive Snooze");
assert.equal(hooks.movedDueDate({ state: "success", message: "✓ Due date moved to 2026-08-28" }), "2026-08-28");

assert.match(optIn, /input\.type="checkbox"/);
assert.doesNotMatch(optIn, /input\.checked\s*=\s*true/, "task email-link opt-in must default off");
assert.match(optIn, /gmailThreadUrl:""/);

for (const html of [sidebar, popup]) {
  assert.match(html, /stratus-cart-core\.js/);
  assert.match(html, /stratus-cart-popup\.js/);
}
assert.match(sidebar, /stratus-task-email-optin\.js/);
assert.match(webpack, /public\/stratus-cart-core\.js/);
assert.match(webpack, /public\/stratus-task-email-optin\.js/);

assert.match(app, /SIDEBAR_ACTION_CLAIM/);
assert.match(app, /SIDEBAR_ACTION_ACK/);
assert.match(app, /chrome\.storage\.onChanged\.addListener/);
assert.match(contextLock, /sanitizeStoredQuoteMessage/);
assert.match(contextLock, /sanitizeStoredOneshotMessage/);
assert.match(contextLock, /executePayload/);
assert.match(contextLock, /consentSource: 'quote-card-button'/);

console.log("PASS source-preserved v1.26.7 Gmail, cart, persistence, and durable handoff fixes");
