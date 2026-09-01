import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const driftPath = join(root, 'scripts', 'drift-check.sh');
const source = readFileSync(driftPath, 'utf8');

assert.match(
  source,
  /Documents\/Stratus extensions\/stratus bot dev\/manifest\.json/,
  'drift report must inspect the unpacked DEV extension Chrome actually loads',
);
assert.doesNotMatch(
  source,
  /Documents\/Claude\/Projects\/Bots\/stratus-bot-v2-DEV/,
  'obsolete Claude-project artifact must not be reported as the installed extension',
);
assert.doesNotMatch(
  source,
  /\nexit 0\n[\s\S]*== 6\./,
  'the report must not exit before its corp, version, and live Worker checks',
);
assert.match(
  source,
  /npx --no-install wrangler deployments status/,
  'live drift must use the pinned Wrangler status command',
);
assert.doesNotMatch(
  source,
  /wrangler deployments list[^\n]*grep -m1/,
  'the oldest listed deployment must not be mistaken for the active version',
);
assert.match(source, /100%/, 'the live parser must select the version carrying all traffic');

const syntax = spawnSync('bash', ['-n', driftPath], { cwd: root, encoding: 'utf8' });
assert.equal(syntax.status, 0, syntax.stderr || 'drift-check.sh failed bash syntax validation');

console.log('PASS drift report reaches every section and checks the real DEV artifacts');
