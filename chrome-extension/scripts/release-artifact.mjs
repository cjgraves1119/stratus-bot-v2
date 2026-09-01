import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

export const REPRODUCIBLE_MTIME = new Date('2000-01-01T00:00:00.000Z');
const FORBIDDEN_SEGMENTS = new Set([
  '.git',
  '.wrangler',
  'backup',
  'backups',
  'dist',
  'env',
  'harness-dist',
  'node_modules',
  'release',
]);
export const REQUIRED_ARTIFACT_FILES = new Set([
  'manifest.json',
  'background.bundle.js',
  'content.bundle.js',
  'options.bundle.js',
  'popup.bundle.js',
  'sidebar.bundle.js',
  'zoho-content.bundle.js',
  'content.css',
  'options.html',
  'popup.html',
  'sidebar.html',
  'stratus-cart-core.js',
  'stratus-cart-popup.js',
  'stratus-task-email-optin.js',
  'icons/icon-16.png',
  'icons/icon-32.png',
  'icons/icon-48.png',
  'icons/icon-128.png',
]);
const OPTIONAL_ARTIFACT_FILES = new Set([
  'options.bundle.js.LICENSE.txt',
  'popup.bundle.js.LICENSE.txt',
  'sidebar.bundle.js.LICENSE.txt',
]);
const NUMERIC_CHUNK_BUNDLE = /^\d+\.bundle\.js$/;
export const RELEASE_DEPENDENCY_INSTALL_ARGS = Object.freeze([
  'install',
  '--frozen-lockfile',
  '--offline',
  '--ignore-scripts',
  '--ignore-workspace',
  '--verify-store-integrity',
]);
const ZIP_MAX_UINT16 = 0xffff;
const ZIP_MAX_UINT32 = 0xffffffff;
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_NEEDED = 20;
const ZIP_VERSION_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION_NEEDED;
const ZIP_UTF8_FLAG = 1 << 11;
const ZIP_STORE_METHOD = 0;
const ZIP_FIXED_DOS_TIME = 0;
// 2000-01-01 in the MS-DOS date format: (year - 1980) << 9 | month << 5 | day.
const ZIP_FIXED_DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const ZIP_FIXED_UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function slashPath(value) {
  return value.split(sep).join('/');
}

function assertInside(root, candidate) {
  const relativePath = relative(root, candidate);
  if (!relativePath || relativePath.startsWith(`..${sep}`) || relativePath === '..') {
    throw new Error(`path is outside artifact root: ${candidate}`);
  }
  return slashPath(relativePath);
}

function assertAllowedArtifactPath(relativePath) {
  const lower = relativePath.toLowerCase();
  const segments = lower.split('/');
  if (segments.some((segment) => FORBIDDEN_SEGMENTS.has(segment))) {
    throw new Error(`forbidden artifact path: ${relativePath}`);
  }
  if (
    lower.endsWith('.map')
    || lower.endsWith('.pem')
    || lower.endsWith('.bak')
    || lower.includes('.backup-')
    || lower.startsWith('.env')
    || lower.includes('/.env')
    || lower.endsWith('.crx')
    || lower.endsWith('.zip')
  ) {
    throw new Error(`forbidden artifact file: ${relativePath}`);
  }

  const allowed = REQUIRED_ARTIFACT_FILES.has(relativePath)
    || OPTIONAL_ARTIFACT_FILES.has(relativePath)
    || NUMERIC_CHUNK_BUNDLE.test(relativePath);
  if (!allowed) {
    throw new Error(`artifact path is not on the sanitized allowlist: ${relativePath}`);
  }
}

export function collectSanitizedFiles(rootDirectory) {
  const root = resolve(rootDirectory);
  if (!existsSync(root)) throw new Error(`artifact root does not exist: ${root}`);
  if (!lstatSync(root).isDirectory()) throw new Error(`artifact root is not a directory: ${root}`);

  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = join(directory, entry.name);
      const relativePath = assertInside(root, absolutePath);
      if (entry.isSymbolicLink()) throw new Error(`symlinks are forbidden in artifacts: ${relativePath}`);
      if (entry.isDirectory()) {
        if (relativePath !== 'icons') throw new Error(`artifact directory is not on the allowlist: ${relativePath}`);
        walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) throw new Error(`non-regular artifact entry: ${relativePath}`);
      assertAllowedArtifactPath(relativePath);
      files.push(relativePath);
    }
  };
  walk(root);

  files.sort((a, b) => a.localeCompare(b, 'en'));
  const fileSet = new Set(files);
  const missingFiles = [...REQUIRED_ARTIFACT_FILES].filter((relativePath) => !fileSet.has(relativePath));
  if (missingFiles.length) {
    throw new Error(`sanitized artifact is missing required files: ${missingFiles.join(', ')}`);
  }
  return files;
}

export function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(path) {
  return sha256Buffer(readFileSync(path));
}

/**
 * Resolve node_modules against the exact committed lockfile without consulting
 * the network, then verify pnpm's active graph is byte-identical to that lock.
 * Release workflows first hydrate pnpm's content-addressed store; controlled
 * local release builds must do the same once before entering this offline gate.
 */
export function installFrozenReleaseDependencies(extensionDirectory, {
  run = execFileSync,
  remove = rmSync,
  environment = process.env,
} = {}) {
  const extensionRoot = resolve(extensionDirectory);
  if (extensionRoot === dirname(extensionRoot)) {
    throw new Error('release dependency root must not be the filesystem root');
  }
  const lockfilePath = join(extensionRoot, 'pnpm-lock.yaml');
  if (!existsSync(lockfilePath)) {
    throw new Error(`release dependency lockfile does not exist: ${lockfilePath}`);
  }

  const nodeModulesPath = join(extensionRoot, 'node_modules');
  if (dirname(nodeModulesPath) !== extensionRoot || basename(nodeModulesPath) !== 'node_modules') {
    throw new Error('refusing to clean a dependency path outside the extension root');
  }

  try {
    remove(nodeModulesPath, { recursive: true, force: true });
  } catch (error) {
    throw new Error('failed to clean extension node_modules before frozen dependency preparation', {
      cause: error,
    });
  }

  try {
    run('pnpm', RELEASE_DEPENDENCY_INSTALL_ARGS, {
      cwd: extensionRoot,
      env: { ...environment, CI: environment.CI || 'true' },
      stdio: 'inherit',
    });
  } catch (error) {
    throw new Error(
      'offline frozen dependency preparation failed; hydrate the pnpm store '
      + 'with `pnpm install --frozen-lockfile --ignore-scripts`, then retry the exact reviewed checkout',
      { cause: error },
    );
  }

  const activeLockfilePath = join(extensionRoot, 'node_modules', '.pnpm', 'lock.yaml');
  if (!existsSync(activeLockfilePath)) {
    throw new Error('pnpm completed without an active node_modules/.pnpm/lock.yaml');
  }
  if (sha256File(activeLockfilePath) !== sha256File(lockfilePath)) {
    throw new Error('installed dependency graph does not match pnpm-lock.yaml');
  }
}

export function hashArtifactTree(rootDirectory, files = collectSanitizedFiles(rootDirectory)) {
  const hash = createHash('sha256');
  for (const relativePath of files) {
    const bytes = readFileSync(join(rootDirectory, relativePath));
    hash.update(relativePath, 'utf8');
    hash.update('\0');
    hash.update(String(bytes.length), 'utf8');
    hash.update('\0');
    hash.update(createHash('sha256').update(bytes).digest());
    hash.update('\n');
  }
  return hash.digest('hex');
}

export function validateArtifactManifest(manifest, profile) {
  if (manifest.manifest_version !== 3) throw new Error('artifact manifest must use Manifest V3');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version || '')) {
    throw new Error('artifact manifest version is missing or invalid');
  }
  if (manifest.name !== profile.manifestName) {
    throw new Error(`artifact branding does not match ${profile.name}`);
  }
  if (manifest.action?.default_title !== profile.actionTitle) {
    throw new Error(`artifact action title does not match ${profile.name}`);
  }

  const expectedHost = `${profile.apiBase}/*`;
  const workerHosts = [
    ...(Array.isArray(manifest.host_permissions) ? manifest.host_permissions : []),
    ...(Array.isArray(manifest.optional_host_permissions) ? manifest.optional_host_permissions : []),
  ].filter((value) => {
    try {
      return new URL(value.replace(/\/\*$/, '/')).hostname.endsWith('.workers.dev');
    } catch {
      return false;
    }
  });
  if (workerHosts.length !== 1 || workerHosts[0] !== expectedHost) {
    throw new Error(`artifact must grant exactly the ${profile.name} gateway host permission`);
  }

  if (profile.updateUrl && manifest.update_url !== profile.updateUrl) {
    throw new Error('production artifact update_url is missing or incorrect');
  }
  if (!profile.updateUrl && Object.hasOwn(manifest, 'update_url')) {
    throw new Error(`${profile.name} artifact must not contain a production update_url`);
  }
}

export function validateSourceIdentity({ commit, tag, target, version }) {
  if (!/^[0-9a-f]{40}$/.test(commit || '')) {
    throw new Error('STRATUS_RELEASE_COMMIT must be the full lowercase 40-character reviewed commit SHA');
  }

  const expectedTag = target === 'prod' ? `ext-v${version}` : `ext-${target}-v${version}`;
  if (tag !== expectedTag) {
    throw new Error(`release tag must be exactly ${expectedTag}`);
  }
}

export function validatePackageManifestVersion({ packageVersion, manifestVersion }) {
  if (typeof packageVersion !== 'string' || !packageVersion) {
    throw new Error('package.json version is missing or invalid');
  }
  if (packageVersion !== manifestVersion) {
    throw new Error(
      `package.json version ${packageVersion} does not match built manifest version ${manifestVersion}`,
    );
  }
}

export function createSanitizedStage({
  distDirectory,
  stageDirectory,
  profile,
  sourceCommit,
  sourceTag,
  lockfilePath,
  packageJsonPath,
  nodeVersion,
  pnpmVersion,
}) {
  const distRoot = resolve(distDirectory);
  const stageRoot = resolve(stageDirectory);
  if (stageRoot === dirname(stageRoot) || stageRoot === distRoot || stageRoot.startsWith(`${distRoot}${sep}`)) {
    throw new Error('stageDirectory must be a narrow directory outside distDirectory');
  }
  const distFiles = collectSanitizedFiles(distRoot);
  const manifest = JSON.parse(readFileSync(join(distRoot, 'manifest.json'), 'utf8'));
  validateArtifactManifest(manifest, profile);
  if (!packageJsonPath || !existsSync(packageJsonPath)) {
    throw new Error(`package.json does not exist: ${packageJsonPath || '(missing path)'}`);
  }
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
  validatePackageManifestVersion({
    packageVersion: packageJson.version,
    manifestVersion: manifest.version,
  });
  validateSourceIdentity({
    commit: sourceCommit,
    tag: sourceTag,
    target: profile.name,
    version: manifest.version,
  });

  if (!existsSync(lockfilePath)) throw new Error(`lockfile does not exist: ${lockfilePath}`);

  rmSync(stageRoot, { recursive: true, force: true });
  mkdirSync(stageRoot, { recursive: true, mode: 0o755 });
  for (const relativePath of distFiles) {
    const sourcePath = join(distRoot, relativePath);
    const destinationPath = join(stageRoot, relativePath);
    mkdirSync(dirname(destinationPath), { recursive: true, mode: 0o755 });
    copyFileSync(sourcePath, destinationPath);
    chmodSync(destinationPath, 0o644);
    utimesSync(destinationPath, REPRODUCIBLE_MTIME, REPRODUCIBLE_MTIME);
  }

  const sanitizedDistTreeSha256 = hashArtifactTree(stageRoot, distFiles);
  const provenance = {
    schemaVersion: 1,
    product: 'Stratus AI Chrome Extension',
    target: profile.name,
    version: manifest.version,
    sourceCommit,
    sourceTag,
    apiOrigin: profile.apiBase,
    environment: profile.stratusEnv,
    nodeVersion,
    pnpmVersion,
    lockfile: basename(lockfilePath),
    lockfileSha256: sha256File(lockfilePath),
    packageJson: basename(packageJsonPath),
    packageJsonSha256: sha256File(packageJsonPath),
    sanitizedDistTreeSha256,
    files: distFiles,
  };
  const provenancePath = join(stageRoot, 'STRATUS-PROVENANCE.json');
  writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, { mode: 0o644 });
  utimesSync(provenancePath, REPRODUCIBLE_MTIME, REPRODUCIBLE_MTIME);

  return {
    files: [...distFiles, 'STRATUS-PROVENANCE.json'].sort((a, b) => a.localeCompare(b, 'en')),
    manifest,
    provenance,
    stageDirectory: stageRoot,
  };
}

export function writeDeterministicZip({ stageDirectory, files, outputPath }) {
  if (!Array.isArray(files) || !files.length) throw new Error('cannot package an empty artifact');
  if (files.length > ZIP_MAX_UINT16) {
    throw new Error(`classic ZIP supports at most ${ZIP_MAX_UINT16} entries`);
  }

  const stageRoot = resolve(stageDirectory);
  const output = resolve(outputPath);
  mkdirSync(dirname(output), { recursive: true });
  rmSync(output, { force: true });

  const seenPaths = new Set();
  const entries = files.map((relativePath) => {
    if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) {
      throw new Error('ZIP entry paths must be non-empty strings without NUL bytes');
    }
    if (relativePath.includes('\\')) {
      throw new Error(`ZIP entry path must use forward slashes: ${relativePath}`);
    }

    const nameBytes = Buffer.from(relativePath, 'utf8');
    if (nameBytes.toString('utf8') !== relativePath) {
      throw new Error(`ZIP entry path is not valid UTF-8: ${relativePath}`);
    }
    if (nameBytes.length > ZIP_MAX_UINT16) {
      throw new Error(`ZIP entry name is too long: ${relativePath}`);
    }

    const absolutePath = resolve(stageRoot, relativePath);
    const canonicalPath = assertInside(stageRoot, absolutePath);
    if (canonicalPath !== relativePath) {
      throw new Error(`ZIP entry path is not canonical or escapes the stage: ${relativePath}`);
    }
    if (seenPaths.has(relativePath)) throw new Error(`duplicate ZIP entry path: ${relativePath}`);
    seenPaths.add(relativePath);

    const stats = lstatSync(absolutePath);
    if (stats.isSymbolicLink()) throw new Error(`symlinks are forbidden in ZIP artifacts: ${relativePath}`);
    if (!stats.isFile()) throw new Error(`ZIP artifact entry is not a regular file: ${relativePath}`);
    if (!Number.isSafeInteger(stats.size) || stats.size > ZIP_MAX_UINT32) {
      throw new Error(`ZIP artifact entry exceeds the classic ZIP size limit: ${relativePath}`);
    }

    const data = readFileSync(absolutePath);
    if (data.length !== stats.size) {
      throw new Error(`ZIP artifact entry changed while being read: ${relativePath}`);
    }
    return {
      relativePath,
      nameBytes,
      data,
      crc32: crc32Buffer(data),
      localHeaderOffset: 0,
    };
  }).sort((a, b) => Buffer.compare(a.nameBytes, b.nameBytes));

  const localChunks = [];
  let localSize = 0;
  for (const entry of entries) {
    entry.localHeaderOffset = localSize;
    assertZipUint32(entry.localHeaderOffset, `local header offset for ${entry.relativePath}`);

    const header = Buffer.alloc(30);
    header.writeUInt32LE(ZIP_LOCAL_FILE_HEADER_SIGNATURE, 0);
    header.writeUInt16LE(ZIP_VERSION_NEEDED, 4);
    header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
    header.writeUInt16LE(ZIP_STORE_METHOD, 8);
    header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 10);
    header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 12);
    header.writeUInt32LE(entry.crc32, 14);
    header.writeUInt32LE(entry.data.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(entry.nameBytes.length, 26);
    header.writeUInt16LE(0, 28);
    localChunks.push(header, entry.nameBytes, entry.data);
    localSize = checkedZipSum(
      localSize,
      header.length + entry.nameBytes.length + entry.data.length,
      `local ZIP data through ${entry.relativePath}`,
    );
  }

  const centralChunks = [];
  let centralSize = 0;
  for (const entry of entries) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_SIGNATURE, 0);
    header.writeUInt16LE(ZIP_VERSION_MADE_BY_UNIX, 4);
    header.writeUInt16LE(ZIP_VERSION_NEEDED, 6);
    header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
    header.writeUInt16LE(ZIP_STORE_METHOD, 10);
    header.writeUInt16LE(ZIP_FIXED_DOS_TIME, 12);
    header.writeUInt16LE(ZIP_FIXED_DOS_DATE, 14);
    header.writeUInt32LE(entry.crc32, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(entry.nameBytes.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(ZIP_FIXED_UNIX_FILE_ATTRIBUTES, 38);
    header.writeUInt32LE(entry.localHeaderOffset, 42);
    centralChunks.push(header, entry.nameBytes);
    centralSize = checkedZipSum(
      centralSize,
      header.length + entry.nameBytes.length,
      `central directory through ${entry.relativePath}`,
    );
  }

  const archiveSizeWithoutEocd = checkedZipSum(localSize, centralSize, 'ZIP archive data');
  checkedZipSum(archiveSizeWithoutEocd, 22, 'complete ZIP archive');
  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entries.length, 8);
  endOfCentralDirectory.writeUInt16LE(entries.length, 10);
  endOfCentralDirectory.writeUInt32LE(centralSize, 12);
  endOfCentralDirectory.writeUInt32LE(localSize, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  const archive = Buffer.concat([...localChunks, ...centralChunks, endOfCentralDirectory]);
  if (archive.length !== archiveSizeWithoutEocd + endOfCentralDirectory.length) {
    throw new Error('deterministic ZIP size accounting mismatch');
  }
  writeFileSync(output, archive, { mode: 0o644 });
  return archive;
}

function crc32Buffer(value) {
  let crc = 0xffffffff;
  for (const byte of value) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function assertZipUint32(value, label) {
  if (!Number.isSafeInteger(value) || value < 0 || value > ZIP_MAX_UINT32) {
    throw new Error(`${label} exceeds the classic ZIP 32-bit limit`);
  }
}

function checkedZipSum(left, right, label) {
  const result = left + right;
  assertZipUint32(result, label);
  return result;
}

export function writeSha256Sums(entries, outputPath) {
  const lines = Object.entries(entries)
    .sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, path]) => `${sha256File(path)}  ${name}`);
  writeFileSync(outputPath, `${lines.join('\n')}\n`, { mode: 0o644 });
}
