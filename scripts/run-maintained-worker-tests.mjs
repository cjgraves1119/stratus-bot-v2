#!/usr/bin/env node

import { readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const maintainedRoots = Object.freeze(['worker', 'worker-gchat', 'worker-gateway']);
const testName = /^(?:test.*|.*\.(?:test|spec))\.(?:js|mjs|cjs)$/;
const excludedDirectories = new Set(['.git', '.wrangler', 'dist', 'node_modules']);

function toRepoPath(path) {
  return relative(repositoryRoot, path).split(sep).join('/');
}

function enumerateTests(root) {
  const tests = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) walk(absolutePath);
      else if (entry.isFile() && testName.test(entry.name)) tests.push(absolutePath);
    }
  };
  walk(root);
  return tests.sort((a, b) => toRepoPath(a).localeCompare(toRepoPath(b), 'en'));
}

const inventory = maintainedRoots.flatMap((directory) => {
  const root = join(repositoryRoot, directory);
  if (!statSync(root).isDirectory()) throw new Error(`missing maintained test root: ${directory}`);
  return enumerateTests(root).map((file) => ({ directory, file }));
});

console.log(`Maintained Worker test inventory (${inventory.length} files):`);
for (const { file } of inventory) console.log(`  ${toRepoPath(file)}`);

for (const requiredRoot of ['worker', 'worker-gchat']) {
  if (!inventory.some(({ directory }) => directory === requiredRoot)) {
    throw new Error(`no maintained tests found under ${requiredRoot}`);
  }
}
const gatewayCount = inventory.filter(({ directory }) => directory === 'worker-gateway').length;
console.log(`worker-gateway test files: ${gatewayCount} (Wrangler dry-run remains required)`);

const safeEnvironment = Object.fromEntries(
  ['PATH', 'TMPDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]),
);
safeEnvironment.CI = 'true';

let failures = 0;
for (const { directory, file } of inventory) {
  const args = file.endsWith('.mjs') ? ['--test', file] : [file];
  const startedAt = Date.now();
  const result = spawnSync(process.execPath, args, {
    cwd: join(repositoryRoot, directory),
    encoding: 'utf8',
    env: safeEnvironment,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 180_000,
  });
  const timedOut = result.error?.code === 'ETIMEDOUT';
  const passed = result.status === 0 && !timedOut;
  const label = passed ? 'PASS' : timedOut ? 'TIMEOUT' : 'FAIL';
  console.log(`${label} ${toRepoPath(file)} (${Date.now() - startedAt} ms)`);
  if (!passed) {
    failures += 1;
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) console.error(result.error.message);
  }
}

if (failures) {
  console.error(`${failures} maintained Worker test file(s) failed`);
  process.exit(1);
}
console.log(`All ${inventory.length} maintained Worker test files passed`);
