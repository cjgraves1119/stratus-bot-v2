/**
 * Loop guard test corpus.
 * Runs the loop-guard module against all 10 synthetic envelopes and asserts
 * the expected_outcome / expected_reasons match.
 *
 * Run: node --test tests/loop-guard.test.js
 */

import { describe, it } from "node:test";
import { strict as assert } from "node:assert";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldSkip } from "../src/loop-guard.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "fixtures");

const env = {
  AI_ALIAS_EMAIL: "ai@stratusinfosystems.com",
  CHRIS_EMAIL: "chrisg@stratusinfosystems.com",
  JAY_FLORENDO_EMAIL: "jayf@stratusinfosystems.com",
  STRATUS_DOMAINS: "stratusinfosystems.com,stratusbots.com",
  BOT_SIGNATURE_TOKEN: "x-stratus-ai-msg-v1",
};

const fixtures = readdirSync(fixtureDir)
  .filter(f => f.endsWith(".json"))
  .sort()
  .map(f => ({ name: f, data: JSON.parse(readFileSync(join(fixtureDir, f), "utf8")) }));

describe("loop guard", () => {
  for (const { name, data } of fixtures) {
    it(name, () => {
      const result = shouldSkip(env, data.envelope);
      if (data.expected_outcome === "skipped") {
        assert.equal(result.skip, true, `expected skip for ${name}, got ${JSON.stringify(result)}`);
        if (data.expected_reasons) {
          for (const reason of data.expected_reasons) {
            assert.ok(
              result.reasons.some(r => r.includes(reason.split("=")[0])),
              `expected reason "${reason}" not found in ${JSON.stringify(result.reasons)}`,
            );
          }
        }
      } else {
        assert.equal(
          result.skip,
          false,
          `expected NOT skip for ${name}, got skip with reasons ${JSON.stringify(result.reasons)}`,
        );
      }
    });
  }
});
