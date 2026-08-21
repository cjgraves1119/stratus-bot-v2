#!/usr/bin/env node

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const extensionDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const testName = /^(?:test.*\.(?:js|mjs|cjs)|.*\.(?:test|spec)\.(?:js|mjs|cjs))$/;
const excludedDirectories = new Set([
  '.git',
  '.wrangler',
  'dist',
  'harness-dist',
  'node_modules',
  'release',
]);
const files = [];
const walk = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath);
    else if (entry.isFile() && testName.test(entry.name)) files.push(absolutePath);
  }
};
walk(extensionDirectory);
files.sort((a, b) => a.localeCompare(b, 'en'));

const displayPath = (file) => relative(extensionDirectory, file).split(sep).join('/');

if (!files.length) {
  console.error('no maintained extension tests found');
  process.exit(1);
}

console.log(`maintained extension test inventory (${files.length}):`);
for (const file of files) console.log(`  ${displayPath(file)}`);

const safeEnvironment = Object.fromEntries(
  ['PATH', 'TMPDIR', 'LANG', 'LC_ALL']
    .filter((name) => process.env[name])
    .map((name) => [name, process.env[name]]),
);
const failures = [];

for (const file of files) {
  const args = file.endsWith('.mjs') ? ['--test', file] : [file];
  const result = spawnSync(process.execPath, args, {
    cwd: extensionDirectory,
    env: safeEnvironment,
    encoding: 'utf8',
    stdio: 'inherit',
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) failures.push(file);
}

if (failures.length) {
  console.error(`maintained extension suite failed (${failures.length}/${files.length}): ${failures.map(displayPath).join(', ')}`);
  process.exit(1);
}

console.log(`maintained extension suite passed (${files.length}/${files.length})`);
