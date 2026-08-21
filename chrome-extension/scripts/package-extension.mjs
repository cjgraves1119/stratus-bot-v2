#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import targetModule from '../release-targets.cjs';
import {
  createSanitizedStage,
  installFrozenReleaseDependencies,
  sha256File,
  writeDeterministicZip,
  writeSha256Sums,
} from './release-artifact.mjs';

const { resolveBuildTarget } = targetModule;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extensionDirectory = resolve(scriptDirectory, '..');
const repositoryDirectory = resolve(extensionDirectory, '..');
const releaseDirectory = join(extensionDirectory, 'release');
const packageJsonPath = join(extensionDirectory, 'package.json');

function die(message) {
  console.error(`package-extension failed: ${message}`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: repositoryDirectory,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function verifyToolchain() {
  const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
  if (process.version !== 'v24.19.0' || pnpmVersion !== '11.19.0') {
    die(`expected Node 24.19.0 and pnpm 11.19.0, received ${process.version.slice(1)} and ${pnpmVersion}`);
  }
  return pnpmVersion;
}

function verifyReviewedCheckout(commit, tag) {
  if (git('rev-parse', 'HEAD') !== commit) {
    die('the checked-out source does not match STRATUS_RELEASE_COMMIT');
  }
  if (git('status', '--porcelain', '--untracked-files=all')) {
    die('the checkout has tracked or untracked source changes; package only an exact reviewed commit');
  }
  const tags = git('tag', '--points-at', commit).split('\n').filter(Boolean);
  if (!tags.includes(tag)) {
    die(`tag ${tag} does not point at STRATUS_RELEASE_COMMIT`);
  }
}

try {
  const pnpmVersion = verifyToolchain();
  const targetName = process.env.STRATUS_RELEASE_TARGET;
  if (!targetName || targetName === 'snapshot-dev') {
    die('STRATUS_RELEASE_TARGET must be prod or team-dev; snapshot-dev is evidence-only');
  }
  const profile = resolveBuildTarget(targetName);
  const sourceCommit = process.env.STRATUS_RELEASE_COMMIT || '';
  const sourceTag = process.env.STRATUS_RELEASE_TAG || '';
  verifyReviewedCheckout(sourceCommit, sourceTag);

  // A clean source checkout is insufficient if ignored node_modules contains
  // a stale or locally modified graph. Recreate it from the committed lockfile
  // without network access before rebuilding the ignored dist/ directory.
  installFrozenReleaseDependencies(extensionDirectory);
  execFileSync('pnpm', ['run', `build:${targetName}`], {
    cwd: extensionDirectory,
    env: process.env,
    stdio: 'inherit',
  });
  verifyReviewedCheckout(sourceCommit, sourceTag);

  mkdirSync(releaseDirectory, { recursive: true });
  const stageDirectory = join(releaseDirectory, `.stage-${targetName}`);
  const staged = createSanitizedStage({
    distDirectory: join(extensionDirectory, 'dist'),
    stageDirectory,
    profile,
    sourceCommit,
    sourceTag,
    lockfilePath: join(extensionDirectory, 'pnpm-lock.yaml'),
    packageJsonPath,
    nodeVersion: process.version.slice(1),
    pnpmVersion,
  });

  const packageName = `stratus-ai-${targetName}-${staged.manifest.version}.zip`;
  const packagePath = join(releaseDirectory, packageName);
  writeDeterministicZip({
    stageDirectory,
    files: staged.files,
    outputPath: packagePath,
  });

  const provenanceName = `stratus-ai-${targetName}-${staged.manifest.version}.provenance.json`;
  const provenancePath = join(releaseDirectory, provenanceName);
  const provenance = {
    ...staged.provenance,
    package: packageName,
    packageSha256: sha256File(packagePath),
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });
  const sumsPath = join(releaseDirectory, `SHA256SUMS-${targetName}`);
  writeSha256Sums({
    [packageName]: packagePath,
    [provenanceName]: provenancePath,
  }, sumsPath);
  rmSync(stageDirectory, { recursive: true, force: true });

  console.log(`sanitized ${targetName} package: ${packagePath}`);
  console.log(`package SHA-256: ${provenance.packageSha256}`);
  console.log(`source: ${sourceCommit} (${sourceTag})`);
} catch (error) {
  die(error.message);
}
