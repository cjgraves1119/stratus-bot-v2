import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const deployPath = path.join(root, 'scripts', 'deploy-dev.sh');
const deploy = fs.readFileSync(deployPath, 'utf8');
const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

assert.match(
  deploy,
  /git status --porcelain --untracked-files=all/,
  'DEV deploy must refuse every tracked or untracked repository change',
);
assert.doesNotMatch(deploy, /git status[^\n]*\|\|\s*true/, 'Git errors must never be treated as a clean tree');
assert.doesNotMatch(deploy, /ALLOW_DIRTY/, 'there must be no dirty-tree escape hatch');
assert.match(deploy, /case "\$1" in[\s\S]*unknown argument/, 'unknown arguments must refuse, not upload');
assert.match(
  deploy,
  /npx --no-install wrangler whoami/,
  'DEV deploy must verify the pinned local Wrangler authentication before upload',
);
assert.doesNotMatch(deploy, /\bsource\s+[^\n]*credentials/i, 'deploy must not execute a configurable shell credential file');
assert.doesNotMatch(deploy, /wrangler deploy[^\n]*--keep-vars/, 'committed Wrangler vars must remain authoritative');
assert.match(deploy, /wrangler deploy --dry-run/, 'every dry or live path must compile through Wrangler first');
assert.match(deploy, /run-maintained-worker-tests\.mjs/, 'the sanctioned path must run the complete Worker inventory');
assert.match(deploy, /pnpm run test:all/, 'the sanctioned path must run the complete extension inventory');
assert.match(deploy, /scan-secrets\.mjs/, 'the sanctioned path must scan the exact clean commit');
assert.match(deploy, /EXPECTED_LIVE_VERSION/, 'live upload must be fenced to a reviewed current version');
assert.match(deploy, /wrangler deploy --strict/, 'live upload must reject conflicting remote changes atomically');
assert.match(deploy, /SOURCE_SHA="\$\(git rev-parse HEAD\)"/, 'the tested source commit must be captured before the long gate');
assert.ok(
  (deploy.match(/git status --porcelain --untracked-files=all/g) || []).length >= 2,
  'the tree must be checked again immediately before a live upload',
);
assert.match(deploy, /PREUPLOAD_SHA[^\n]*SOURCE_SHA/, 'HEAD must remain on the exact tested source commit');
assert.doesNotMatch(deploy, /^SHA="\$\(git rev-parse HEAD\)"[\s\S]*deploys\.log/m, 'post-upload provenance must not recapture a different HEAD');
assert.ok((deploy.match(/wrangler deployments status/g) || []).length >= 2, 'live version must be checked before and after upload');
assert.match(
  gitignore,
  /^\/deploys\.log$/m,
  'the local provenance log must not make the next whole-repository clean gate self-block',
);

for (const args of [['--definitely-not-a-mode'], ['--dry-run', 'extra']]) {
  const result = spawnSync('bash', [deployPath, ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 2, `unsafe argument shape was not refused: ${args.join(' ')}`);
  assert.match(`${result.stdout}\n${result.stderr}`, /Usage:|REFUSED: unknown argument/);
}
const ignored = spawnSync('git', ['check-ignore', '-q', 'deploys.log'], { cwd: root });
assert.equal(ignored.status, 0, 'deploys.log must be ignored by the actual Git matcher');

console.log('PASS DEV deploy provenance, authentication, drift-fence, and argument gates');
