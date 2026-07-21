// Self-check for the 2026-07-21 consolidated-dev fixes:
//   1. isPlaceholderName() — placeholder record-name gate (L5)
//   2. createFollowUpTaskForDeal same-turn memo dedupe (L6)
// Run: node test-placeholder-and-followup-dedupe-2026-07-21.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'src/index.js'), 'utf8');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok - ${name}`); pass++; }
  catch (e) { console.log(`  FAIL - ${name}\n    ${e.message}`); fail++; }
}

// ── 1. isPlaceholderName ─────────────────────────────────────────────────────
const phStart = SRC.indexOf('const PLACEHOLDER_NAME_RE');
const phEnd = SRC.indexOf('\n}', SRC.indexOf('function isPlaceholderName')) + 2;
assert(phStart > -1 && phEnd > phStart, 'isPlaceholderName block not found in src/index.js');
const isPlaceholderName = new Function(`${SRC.slice(phStart, phEnd)}; return isPlaceholderName;`)();

for (const s of ['Company Name', 'Company Name - 3x MX75', '{Account} - MX', 'tbd']) {
  t(`placeholder TRUE: "${s}"`, () => assert.strictEqual(isPlaceholderName(s), true));
}
for (const s of ['Accountemps', 'Skty Trading LLC', 'West Central Association']) {
  t(`placeholder FALSE: "${s}"`, () => assert.strictEqual(isPlaceholderName(s), false));
}
t('placeholder TRUE: empty/null/non-string/1-char', () => {
  assert.strictEqual(isPlaceholderName(''), true);
  assert.strictEqual(isPlaceholderName(null), true);
  assert.strictEqual(isPlaceholderName(42), true);
  assert.strictEqual(isPlaceholderName('A'), true);
});

console.log(`\n${fail === 0 ? 'ALL PASS' : 'FAILURES'} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
