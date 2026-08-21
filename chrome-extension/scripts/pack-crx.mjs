#!/usr/bin/env node
/**
 * pack-crx.mjs — Build a signed CRX3 + Chrome update manifest for self-hosted
 * auto-updates published to GitHub Pages.
 *
 * Phases and trust boundary:
 *   - prepare: verifies the reviewed checkout/tag, installs pinned dependencies,
 *     rebuilds production source, and writes a sanitized unsigned ZIP + receipt
 *     to chrome-extension/release/.prepared-prod without reading a signing key.
 *   - verify-prepared: validates that transferred ZIP/receipt pair using only
 *     audited Node built-ins and the canonical manifest/package metadata.
 *   - sign-prepared: repeats that validation, then reads
 *     $EXT_SIGNING_KEY_PEM_PATH and signs the hash-bound prepared ZIP. It never
 *     invokes webpack, package-manager code, or build dependencies.
 *
 * Writes:
 *   - chrome-extension/release/stratus-ai-<version>.crx   (CRX3, signed)
 *   - chrome-extension/release/update-manifest.xml        (gupdate protocol 2.0)
 *   - chrome-extension/release/*.provenance.json           (commit/build evidence)
 *   - chrome-extension/release/SHA256SUMS                  (published hashes)
 *
 * The version is bound across the canonical source manifest, package.json,
 * release tag, prepared receipt, and ZIP-embedded manifest. The extension ID is derived from
 * the public key (first 16 bytes of SHA-256 of the SubjectPublicKeyInfo DER,
 * with each hex nibble 0-f mapped to a-p — Chrome's "mpdecimal" encoding).
 *
 * CRX3 file layout (see Chromium components/crx_file/crx3.proto):
 *   "Cr24"                          4 bytes  magic
 *   version = 3                     4 bytes  little-endian uint32
 *   headerSize = N                  4 bytes  little-endian uint32
 *   CrxFileHeader (protobuf)        N bytes
 *   ZIP archive                     remainder
 *
 * The RSA-SHA256 signature is computed over:
 *   "CRX3 SignedData\x00" + uint32LE(len(signedHeaderData)) + signedHeaderData + zipBytes
 * where signedHeaderData is a SignedData protobuf carrying the 16-byte crx_id.
 *
 * CRX framing is implemented directly with node:crypto + a tiny protobuf
 * encoder. Build and package execution is nevertheless pinned to the exact
 * Node/pnpm versions recorded in package.json.
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import targetModule from '../release-targets.cjs';
import {
  signCrx3,
  validatePreparedPayloadBinding,
} from './crx3-core.mjs';
import {
  createSanitizedStage,
  installFrozenReleaseDependencies,
  sha256File,
  validatePackageManifestVersion,
  validateSourceIdentity,
  writeDeterministicZip,
  writeSha256Sums,
} from './release-artifact.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, '..');
const DIST_DIR = join(EXT_DIR, 'dist');
const RELEASE_DIR = join(EXT_DIR, 'release');
const REPOSITORY_DIR = resolve(EXT_DIR, '..');
const LOCKFILE_PATH = join(EXT_DIR, 'pnpm-lock.yaml');
const PACKAGE_JSON_PATH = join(EXT_DIR, 'package.json');
const PREPARED_DIR = join(RELEASE_DIR, '.prepared-prod');
const PREPARED_ZIP_PATH = join(PREPARED_DIR, 'unsigned-payload.zip');
const PREPARED_RECEIPT_PATH = join(PREPARED_DIR, 'receipt.json');

const { resolveBuildTarget } = targetModule;
const EXPECTED_ID = 'haangicfjfkenoilhdadbnljcacighih';
const PAGES_BASE = 'https://cjgraves1119.github.io/stratus-bot-v2';
// Minimum Chrome version that supports CRX3 (Chromium switched in late 2017).
const PRODVERSION_MIN = '64.0.3242';

function die(msg) {
  console.error(`\n✗ pack-crx: ${msg}\n`);
  process.exit(1);
}

function git(...args) {
  return execFileSync('git', args, {
    cwd: REPOSITORY_DIR,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function verifyReviewedCheckout(commit, tag) {
  if (git('rev-parse', 'HEAD') !== commit) {
    die('the checked-out source does not match STRATUS_RELEASE_COMMIT');
  }
  if (git('status', '--porcelain', '--untracked-files=all')) {
    die('the checkout has tracked or untracked source changes; release only an exact reviewed commit');
  }
  if (!git('tag', '--points-at', commit).split('\n').filter(Boolean).includes(tag)) {
    die(`tag ${tag} does not point at STRATUS_RELEASE_COMMIT`);
  }
}

function verifyToolchain() {
  const pnpmVersion = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim();
  if (process.version !== 'v24.19.0' || pnpmVersion !== '11.19.0') {
    die(`expected Node 24.19.0 and pnpm 11.19.0, received ${process.version.slice(1)} and ${pnpmVersion}`);
  }
  return pnpmVersion;
}

function verifyNodeVersion() {
  if (process.version !== 'v24.19.0') {
    die(`expected Node 24.19.0, received ${process.version.slice(1)}`);
  }
}

function releaseInputs() {
  if (process.env.STRATUS_RELEASE_TARGET !== 'prod') {
    die('STRATUS_RELEASE_TARGET must be prod; DEV artifacts are never self-updating CRX releases.');
  }
  return {
    profile: resolveBuildTarget('prod'),
    sourceCommit: process.env.STRATUS_RELEASE_COMMIT || '',
    sourceTag: process.env.STRATUS_RELEASE_TAG || '',
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function prepareUnsignedPayload() {
  if (process.env.EXT_SIGNING_KEY || process.env.EXT_SIGNING_KEY_PEM_PATH) {
    die('prepare must run before any production signing secret or key path is exposed');
  }

  const pnpmVersion = verifyToolchain();
  const { profile, sourceCommit, sourceTag } = releaseInputs();
  verifyReviewedCheckout(sourceCommit, sourceTag);

  // Recreate ignored dependencies from the exact committed lock without
  // network access, build, then prove the build did not mutate reviewed source.
  installFrozenReleaseDependencies(EXT_DIR);
  execFileSync('pnpm', ['run', 'build:prod'], {
    cwd: EXT_DIR,
    env: process.env,
    stdio: 'inherit',
  });
  if (!existsSync(DIST_DIR) || !existsSync(join(DIST_DIR, 'manifest.json'))) {
    die(`production build did not create ${DIST_DIR}/manifest.json`);
  }
  verifyReviewedCheckout(sourceCommit, sourceTag);

  // Release output is ignored, derived state. Recreate this narrow directory so
  // no prior CRX, manifest, or receipt can survive into the reviewed payload.
  rmSync(RELEASE_DIR, { recursive: true, force: true });
  mkdirSync(PREPARED_DIR, { recursive: true, mode: 0o755 });
  const tempRoot = mkdtempSync(join(tmpdir(), 'stratus-crx-prepare-'));
  try {
    const staged = createSanitizedStage({
      distDirectory: DIST_DIR,
      stageDirectory: join(tempRoot, 'stage'),
      profile,
      sourceCommit,
      sourceTag,
      lockfilePath: LOCKFILE_PATH,
      packageJsonPath: PACKAGE_JSON_PATH,
      nodeVersion: process.version.slice(1),
      pnpmVersion,
    });
    const zipBytes = writeDeterministicZip({
      stageDirectory: staged.stageDirectory,
      files: staged.files,
      outputPath: PREPARED_ZIP_PATH,
    });
    const receipt = {
      schemaVersion: 1,
      target: 'prod',
      version: staged.manifest.version,
      sourceCommit,
      sourceTag,
      unsignedPayload: 'unsigned-payload.zip',
      unsignedPayloadBytes: zipBytes.length,
      unsignedPayloadSha256: sha256File(PREPARED_ZIP_PATH),
      provenance: staged.provenance,
    };
    writeFileSync(PREPARED_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o644 });
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  verifyReviewedCheckout(sourceCommit, sourceTag);
  console.log('✓ unsigned CRX payload prepared before signing-key exposure');
  console.log(`  receipt: ${PREPARED_RECEIPT_PATH}`);
  console.log(`  payload SHA-256: ${sha256File(PREPARED_ZIP_PATH)}`);
}

function readAndValidatePreparedPayload({ profile, sourceCommit, sourceTag }) {
  if (!existsSync(PREPARED_RECEIPT_PATH) || !existsSync(PREPARED_ZIP_PATH)) {
    die('hash-bound unsigned payload is missing; run pack:crx:prepare before exposing the signing key');
  }
  const releaseEntries = readdirSync(RELEASE_DIR).sort();
  if (releaseEntries.length !== 1 || releaseEntries[0] !== '.prepared-prod') {
    die('release directory contains output outside the prepared payload boundary');
  }

  const receipt = JSON.parse(readFileSync(PREPARED_RECEIPT_PATH, 'utf8'));
  const sourceManifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
  const packageJson = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));
  validatePackageManifestVersion({
    packageVersion: packageJson.version,
    manifestVersion: sourceManifest.version,
  });
  validateSourceIdentity({
    commit: sourceCommit,
    tag: sourceTag,
    target: 'prod',
    version: sourceManifest.version,
  });
  const zipBytes = readFileSync(PREPARED_ZIP_PATH);
  const packageManagerMatch = /^pnpm@(.+)$/.exec(packageJson.packageManager || '');
  if (!packageManagerMatch) {
    die('package.json must pin pnpm with an exact packageManager field');
  }
  const expectedProvenance = {
    schemaVersion: 1,
    product: 'Stratus AI Chrome Extension',
    target: 'prod',
    version: sourceManifest.version,
    sourceCommit,
    sourceTag,
    apiOrigin: profile.apiBase,
    environment: profile.stratusEnv,
    nodeVersion: process.version.slice(1),
    pnpmVersion: packageManagerMatch[1],
    lockfile: 'pnpm-lock.yaml',
    lockfileSha256: sha256File(LOCKFILE_PATH),
    packageJson: 'package.json',
    packageJsonSha256: sha256File(PACKAGE_JSON_PATH),
  };
  return validatePreparedPayloadBinding({
    receipt,
    zipBytes,
    sourceCommit,
    sourceTag,
    version: sourceManifest.version,
    target: 'prod',
    unsignedPayload: 'unsigned-payload.zip',
    expectedProvenance,
  });
}

function signPreparedPayload() {
  verifyNodeVersion();
  const { profile, sourceCommit, sourceTag } = releaseInputs();
  verifyReviewedCheckout(sourceCommit, sourceTag);
  const { receipt, zipBytes } = readAndValidatePreparedPayload({ profile, sourceCommit, sourceTag });

  // No package manager, dependency install, webpack loader, or source build runs
  // after this point. Only the hash-bound ZIP and Node built-ins see the key.
  const keyPath = process.env.EXT_SIGNING_KEY_PEM_PATH;
  if (!keyPath || !existsSync(keyPath)) {
    die('EXT_SIGNING_KEY_PEM_PATH must name the protected RSA private key PEM');
  }
  const privateKeyPem = readFileSync(keyPath);
  let signedCrx;
  try {
    signedCrx = signCrx3({
      zipBytes,
      privateKeyPem,
      expectedExtensionId: EXPECTED_ID,
    });
  } finally {
    privateKeyPem.fill(0);
  }
  const { crxBytes: crxBuffer, extensionId } = signedCrx;

  const version = receipt.version;
  const crxName = `stratus-ai-${version}.crx`;
  const crxPath = join(RELEASE_DIR, crxName);
  writeFileSync(crxPath, crxBuffer, { mode: 0o644 });
  const codebase = `${PAGES_BASE}/${crxName}`;
  const xml =
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n` +
    `  <app appid='${extensionId}'>\n` +
    `    <updatecheck codebase='${codebase}' version='${version}' prodversionmin='${PRODVERSION_MIN}' />\n` +
    `  </app>\n` +
    `</gupdate>\n`;
  const xmlPath = join(RELEASE_DIR, 'update-manifest.xml');
  writeFileSync(xmlPath, xml, { mode: 0o644 });

  const provenanceName = `stratus-ai-${version}.provenance.json`;
  const provenancePath = join(RELEASE_DIR, provenanceName);
  const provenance = {
    ...receipt.provenance,
    unsignedPayloadSha256: receipt.unsignedPayloadSha256,
    extensionId,
    crx: crxName,
    crxSha256: sha256File(crxPath),
    updateManifest: 'update-manifest.xml',
    updateManifestSha256: sha256File(xmlPath),
  };
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });
  const sumsPath = join(RELEASE_DIR, 'SHA256SUMS');
  writeSha256Sums({
    [crxName]: crxPath,
    [provenanceName]: provenancePath,
    'update-manifest.xml': xmlPath,
  }, sumsPath);
  rmSync(PREPARED_DIR, { recursive: true, force: true });

  console.log('✓ hash-bound CRX payload signed');
  console.log(`  version: ${version}`);
  console.log(`  extension ID: ${extensionId}`);
  console.log(`  CRX SHA-256: ${provenance.crxSha256}`);
}

function verifyPreparedPayload() {
  verifyNodeVersion();
  const { profile, sourceCommit, sourceTag } = releaseInputs();
  verifyReviewedCheckout(sourceCommit, sourceTag);
  const { receipt } = readAndValidatePreparedPayload({ profile, sourceCommit, sourceTag });
  console.log(`✓ prepared payload verified for ${sourceCommit} (${sourceTag})`);
  console.log(`  unsigned payload SHA-256: ${receipt.unsignedPayloadSha256}`);
}

try {
  const phase = process.argv[2];
  if (phase === 'prepare') prepareUnsignedPayload();
  else if (phase === 'verify-prepared') verifyPreparedPayload();
  else if (phase === 'sign-prepared') signPreparedPayload();
  else die('expected phase argument: prepare, verify-prepared, or sign-prepared');
} catch (error) {
  die(error.message);
}
