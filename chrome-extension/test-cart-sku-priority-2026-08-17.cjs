"use strict";

const assert = require("node:assert/strict");
const core = require("./public/stratus-cart-core.js");

const rows = [
  {
    title: "Hardware + License, Wireless CW9176D1 Access Point Directional Antenna w/ 1YR Enterprise License",
    quantity: 31,
    activeUnitCents: null,
    subtotalCents: null,
    explicitSkus: [],
  },
  {
    title: "Hardware + License, Meraki MS150-48LP-4X Hardware and Essentials License Renewal, 1 Year",
    quantity: 36,
    activeUnitCents: 389700,
    subtotalCents: 1,
    explicitSkus: [],
  },
  {
    title: "Hardware + License, Meraki MS130-48X Cloud Mgd. 40GE + 8x(2.5GE) 740W PoE Switch w/ 1Y Enterprise License",
    quantity: 6,
    activeUnitCents: undefined,
    subtotalCents: undefined,
    explicitSkus: [],
  },
];

const resolved = core.resolveCartRows({ sourceUrl: "https://stratusinfosystems.com/cart/", rows });
assert.equal(resolved.complete, true, "optional/mismatched price metadata must not block SKU output");
assert.deepEqual(resolved.items, [
  { sku: "CW9176D1-RTG", qty: 31 },
  { sku: "LIC-ENT-1YR", qty: 31 },
  { sku: "MS150-48LP-4X", qty: 36 },
  { sku: "LIC-MS150-48-1Y", qty: 36 },
  { sku: "MS130-48X", qty: 6 },
  { sku: "LIC-MS130-48-1Y", qty: 6 },
]);
assert.deepEqual(resolved.bundleRows.map((row) => row.pricingStatus), ["unavailable", "mismatch", "unavailable"]);

const explicit = core.resolveCartRows({ rows: [{
  title: "A title may be absent from future templates",
  quantity: 4,
  activeUnitCents: null,
  subtotalCents: 999,
  explicitSkus: ["MR44", "LIC-MR-ADV-3YR"],
}] });
assert.equal(explicit.complete, true);
assert.deepEqual(explicit.items, [
  { sku: "MR44", qty: 4 },
  { sku: "LIC-MR-ADV-3YR", qty: 4 },
]);

const explicitWins = core.resolveCartRows({ rows: [{
  title: rows[0].title,
  quantity: 2,
  activeUnitCents: 100,
  subtotalCents: 1,
  explicitSkus: ["DIRECT-SKU"],
}] });
assert.deepEqual(explicitWins.items, [{ sku: "DIRECT-SKU", qty: 2 }], "explicit SKU evidence must outrank a title inference");

const noQty = core.resolveCartRows({ rows: [{ title: "Explicit", quantity: null, explicitSkus: ["MR44"] }] });
assert.equal(noQty.complete, false, "a live quantity is still required");
assert.match(noQty.unresolved[0].reason, /live whole-number quantity/);

console.log("PASS cart SKU-first parsing with optional price metadata");
