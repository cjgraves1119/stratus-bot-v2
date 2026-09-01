import assert from 'node:assert/strict';
import {
  createHash,
  createPublicKey,
  createVerify,
  generateKeyPairSync,
} from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import targetModule from './release-targets.cjs';
import {
  deriveExtensionId,
  signCrx3,
  validatePreparedPayloadBinding,
} from './scripts/crx3-core.mjs';
import {
  collectSanitizedFiles,
  createSanitizedStage,
  hashArtifactTree,
  installFrozenReleaseDependencies,
  RELEASE_DEPENDENCY_INSTALL_ARGS,
  REQUIRED_ARTIFACT_FILES,
  sha256Buffer,
  validateArtifactManifest,
  validatePackageManifestVersion,
  validateSourceIdentity,
  writeDeterministicZip,
} from './scripts/release-artifact.mjs';

const {
  APPROVED_TEAM_DEV_API_BASES,
  PRODUCTION_API_BASE,
  manifestForTarget,
  resolveBuildTarget,
} = targetModule;

const canonicalManifest = JSON.parse(readFileSync(new URL('./manifest.json', import.meta.url), 'utf8'));
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const packageScript = readFileSync(new URL('./scripts/package-extension.mjs', import.meta.url), 'utf8');
const crxScript = readFileSync(new URL('./scripts/pack-crx.mjs', import.meta.url), 'utf8');
const crxCoreScript = readFileSync(new URL('./scripts/crx3-core.mjs', import.meta.url), 'utf8');
const crxWrapper = readFileSync(new URL('./scripts/build-crx.sh', import.meta.url), 'utf8');
const releaseArtifactScript = readFileSync(new URL('./scripts/release-artifact.mjs', import.meta.url), 'utf8');
const harnessScript = readFileSync(new URL('./harness/webpack.harness.js', import.meta.url), 'utf8');
const releaseWorkflow = readFileSync(new URL('../.github/workflows/release-extension.yml', import.meta.url), 'utf8');
const deployWorkflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const buildWorkflow = readFileSync(new URL('../.github/workflows/build-check.yml', import.meta.url), 'utf8');

function readProtoVarint(bytes, start) {
  let result = 0;
  let shift = 0;
  let cursor = start;
  while (cursor < bytes.length && shift <= 49) {
    const value = bytes[cursor];
    cursor += 1;
    result += (value & 0x7f) * (2 ** shift);
    if ((value & 0x80) === 0) return { value: result, cursor };
    shift += 7;
  }
  throw new Error('invalid protobuf varint');
}

function readLengthDelimitedProto(bytes) {
  const fields = new Map();
  let cursor = 0;
  while (cursor < bytes.length) {
    const tag = readProtoVarint(bytes, cursor);
    cursor = tag.cursor;
    const wireType = tag.value & 7;
    const fieldNumber = Math.floor(tag.value / 8);
    assert.equal(wireType, 2, `protobuf field ${fieldNumber} must be length-delimited`);
    const length = readProtoVarint(bytes, cursor);
    cursor = length.cursor;
    assert.ok(cursor + length.value <= bytes.length, `protobuf field ${fieldNumber} is truncated`);
    const payload = bytes.subarray(cursor, cursor + length.value);
    cursor += length.value;
    const existing = fields.get(fieldNumber) || [];
    existing.push(payload);
    fields.set(fieldNumber, existing);
  }
  return fields;
}

function onlyProtoField(fields, fieldNumber) {
  const values = fields.get(fieldNumber) || [];
  assert.equal(values.length, 1, `expected exactly one protobuf field ${fieldNumber}`);
  return values[0];
}

const sourceManifest = {
  manifest_version: 3,
  name: 'Stratus AI',
  version: '1.29.0',
  action: { default_title: 'Stratus AI' },
  host_permissions: [
    'https://mail.google.com/*',
    `${PRODUCTION_API_BASE}/*`,
  ],
  update_url: 'https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml',
};

function writeRequiredArtifactFixture(root, { manifest = '{}\n', omit = [] } = {}) {
  const omitted = new Set(omit);
  mkdirSync(join(root, 'icons'), { recursive: true });
  for (const relativePath of REQUIRED_ARTIFACT_FILES) {
    if (omitted.has(relativePath)) continue;
    const contents = relativePath === 'manifest.json'
      ? manifest
      : (relativePath.endsWith('.png') ? Buffer.from([137, 80, 78, 71]) : 'fixture\n');
    writeFileSync(join(root, relativePath), contents);
  }
}

function testCrc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inspectStoredZip(bytes, stageDirectory) {
  const eocdOffset = bytes.length - 22;
  assert.equal(bytes.readUInt32LE(eocdOffset), 0x06054b50);
  assert.equal(bytes.readUInt16LE(eocdOffset + 4), 0);
  assert.equal(bytes.readUInt16LE(eocdOffset + 6), 0);
  assert.equal(bytes.readUInt16LE(eocdOffset + 20), 0);

  const entryCount = bytes.readUInt16LE(eocdOffset + 10);
  assert.equal(bytes.readUInt16LE(eocdOffset + 8), entryCount);
  const centralSize = bytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = bytes.readUInt32LE(eocdOffset + 16);
  assert.equal(centralOffset + centralSize, eocdOffset);

  const names = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    assert.equal(bytes.readUInt32LE(cursor), 0x02014b50);
    assert.equal(bytes.readUInt16LE(cursor + 4), 0x0314);
    assert.equal(bytes.readUInt16LE(cursor + 6), 20);
    assert.equal(bytes.readUInt16LE(cursor + 8), 0x0800);
    assert.equal(bytes.readUInt16LE(cursor + 10), 0);
    assert.equal(bytes.readUInt16LE(cursor + 12), 0);
    assert.equal(bytes.readUInt16LE(cursor + 14), 0x2821);
    assert.equal(bytes.readUInt16LE(cursor + 30), 0);
    assert.equal(bytes.readUInt16LE(cursor + 32), 0);
    assert.equal(bytes.readUInt16LE(cursor + 34), 0);
    assert.equal(bytes.readUInt16LE(cursor + 36), 0);
    assert.equal(bytes.readUInt32LE(cursor + 38) >>> 16, 0o100644);

    const crc32 = bytes.readUInt32LE(cursor + 16);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const uncompressedSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const name = bytes.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');
    const localOffset = bytes.readUInt32LE(cursor + 42);
    names.push(name);

    assert.equal(compressedSize, uncompressedSize);
    assert.equal(bytes.readUInt32LE(localOffset), 0x04034b50);
    assert.equal(bytes.readUInt16LE(localOffset + 4), 20);
    assert.equal(bytes.readUInt16LE(localOffset + 6), 0x0800);
    assert.equal(bytes.readUInt16LE(localOffset + 8), 0);
    assert.equal(bytes.readUInt16LE(localOffset + 10), 0);
    assert.equal(bytes.readUInt16LE(localOffset + 12), 0x2821);
    assert.equal(bytes.readUInt32LE(localOffset + 14), crc32);
    assert.equal(bytes.readUInt32LE(localOffset + 18), compressedSize);
    assert.equal(bytes.readUInt32LE(localOffset + 22), uncompressedSize);
    assert.equal(bytes.readUInt16LE(localOffset + 28), 0);

    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localNameStart = localOffset + 30;
    assert.equal(bytes.subarray(localNameStart, localNameStart + localNameLength).toString('utf8'), name);
    const data = bytes.subarray(localNameStart + localNameLength, localNameStart + localNameLength + compressedSize);
    assert.deepEqual(data, readFileSync(join(stageDirectory, name)));
    assert.equal(testCrc32(data), crc32);

    cursor += 46 + nameLength;
  }
  assert.equal(cursor, centralOffset + centralSize);
  assert.deepEqual(names, [...names].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  return names;
}

function createSyntheticPreparedCrxFixture({ provenanceOverrides = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'stratus-crx3-core-'));
  const stageDirectory = join(root, 'stage');
  mkdirSync(stageDirectory, { recursive: true });
  writeFileSync(join(stageDirectory, 'fixture.js'), 'globalThis.STRATUS_CRX_FIXTURE = true;\n');
  writeFileSync(join(stageDirectory, 'manifest.json'), '{"manifest_version":3,"version":"1.29.0"}\n');

  const sourceCommit = 'a'.repeat(40);
  const sourceTag = 'ext-v1.29.0';
  const version = '1.29.0';
  const expectedProvenance = {
    schemaVersion: 1,
    product: 'Stratus AI Chrome Extension',
    target: 'prod',
    version,
    sourceCommit,
    sourceTag,
    apiOrigin: 'https://stratus-ai-bot-gateway.synthetic.workers.dev',
    environment: 'production',
    nodeVersion: '24.19.0',
    pnpmVersion: '11.19.0',
    lockfile: 'pnpm-lock.yaml',
    lockfileSha256: 'b'.repeat(64),
    packageJson: 'package.json',
    packageJsonSha256: 'c'.repeat(64),
  };
  const artifactFiles = ['fixture.js', 'manifest.json']
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  const provenance = {
    ...expectedProvenance,
    ...provenanceOverrides,
    sanitizedDistTreeSha256: hashArtifactTree(stageDirectory, artifactFiles),
    files: artifactFiles,
  };
  writeFileSync(
    join(stageDirectory, 'STRATUS-PROVENANCE.json'),
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
  const zipPath = join(root, 'unsigned-payload.zip');
  const zipBytes = writeDeterministicZip({
    stageDirectory,
    files: [...artifactFiles, 'STRATUS-PROVENANCE.json'],
    outputPath: zipPath,
  });
  const receipt = {
    schemaVersion: 1,
    target: 'prod',
    version,
    sourceCommit,
    sourceTag,
    unsignedPayload: 'unsigned-payload.zip',
    unsignedPayloadBytes: zipBytes.length,
    unsignedPayloadSha256: sha256Buffer(zipBytes),
    provenance,
  };
  return {
    expectedProvenance,
    provenance,
    receipt,
    root,
    sourceCommit,
    sourceTag,
    version,
    zipBytes,
  };
}

test('canonical config uses one lockfile, exact toolchain, and production branding', () => {
  assert.equal(packageJson.version, canonicalManifest.version);
  assert.equal(packageJson.version, '1.29.13');
  assert.equal(packageJson.packageManager, 'pnpm@11.19.0');
  assert.deepEqual(packageJson.engines, { node: '24.19.0', pnpm: '11.19.0' });
  assert.equal(canonicalManifest.name, 'Stratus AI');
  assert.equal(canonicalManifest.action.default_title, 'Stratus AI');
  assert.equal(existsSync(new URL('./pnpm-lock.yaml', import.meta.url)), true);
  assert.equal(existsSync(new URL('./package-lock.json', import.meta.url)), false);
});

test('named targets select branding, origin, and updates atomically', () => {
  const prod = resolveBuildTarget('prod', { environment: {} });
  const snapshot = resolveBuildTarget('snapshot-dev', { environment: {} });
  const prodManifest = manifestForTarget(sourceManifest, prod);
  const snapshotManifest = manifestForTarget(sourceManifest, snapshot);

  assert.equal(prodManifest.name, 'Stratus AI');
  assert.equal(prodManifest.update_url, prod.updateUrl);
  assert.deepEqual(prodManifest.host_permissions.filter((value) => value.includes('workers.dev')), [`${prod.apiBase}/*`]);

  assert.equal(snapshotManifest.name, 'Stratus AI (DEV)');
  assert.equal(Object.hasOwn(snapshotManifest, 'update_url'), false);
  assert.deepEqual(snapshotManifest.host_permissions.filter((value) => value.includes('workers.dev')), [`${snapshot.apiBase}/*`]);
});

test('legacy independent switches and implicit team targets fail closed', () => {
  assert.deepEqual(APPROVED_TEAM_DEV_API_BASES, []);
  assert.throws(
    () => resolveBuildTarget('prod', { environment: { STRATUS_ENV: 'dev' } }),
    /unsupported/,
  );
  assert.throws(
    () => resolveBuildTarget('team-dev', { environment: {} }),
    /required/,
  );
  assert.throws(
    () => resolveBuildTarget('team-dev', {
      environment: { STRATUS_TEAM_DEV_API_BASE: PRODUCTION_API_BASE },
    }),
    /must not use the production/,
  );
});

test('team DEV accepts only a separately approved synthetic origin', () => {
  const synthetic = 'https://stratus-ai-bot-gateway.synthetic-team.workers.dev';
  const profile = resolveBuildTarget('team-dev', {
    environment: { STRATUS_TEAM_DEV_API_BASE: synthetic },
    approvedTeamDevApiBases: [synthetic],
  });
  const manifest = manifestForTarget(sourceManifest, profile);

  assert.equal(profile.apiBase, synthetic);
  assert.equal(manifest.name, 'Stratus AI (TEAM DEV)');
  assert.equal(Object.hasOwn(manifest, 'update_url'), false);
  assert.deepEqual(manifest.host_permissions.filter((value) => value.includes('workers.dev')), [`${synthetic}/*`]);
});

test('artifact validation binds action title and all Worker permissions to each target', () => {
  const synthetic = 'https://stratus-ai-bot-gateway.synthetic-team.workers.dev';
  const profiles = [
    resolveBuildTarget('prod', { environment: {} }),
    resolveBuildTarget('team-dev', {
      environment: { STRATUS_TEAM_DEV_API_BASE: synthetic },
      approvedTeamDevApiBases: [synthetic],
    }),
  ];

  for (const profile of profiles) {
    const manifest = manifestForTarget(sourceManifest, profile);
    assert.doesNotThrow(() => validateArtifactManifest(manifest, profile));

    const mixedTitle = structuredClone(manifest);
    mixedTitle.action.default_title = profile.name === 'prod' ? 'Stratus AI (TEAM DEV)' : 'Stratus AI';
    assert.throws(
      () => validateArtifactManifest(mixedTitle, profile),
      /artifact action title does not match/,
      `${profile.name} mixed action title`,
    );

    const extraOptionalOrigin = structuredClone(manifest);
    const otherOrigin = profile.name === 'prod' ? synthetic : PRODUCTION_API_BASE;
    extraOptionalOrigin.optional_host_permissions = [
      ...(extraOptionalOrigin.optional_host_permissions || []),
      `${otherOrigin}/*`,
    ];
    assert.throws(
      () => validateArtifactManifest(extraOptionalOrigin, profile),
      /artifact must grant exactly the .* gateway host permission/,
      `${profile.name} extra optional Worker origin`,
    );
  }
});

test('sanitizer rejects source maps and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'stratus-sanitize-reject-'));
  writeFileSync(join(root, 'manifest.json'), '{}\n');
  writeFileSync(join(root, 'background.bundle.js.map'), '{}\n');
  assert.throws(() => collectSanitizedFiles(root), /forbidden artifact file/);

  const symlinkRoot = mkdtempSync(join(tmpdir(), 'stratus-sanitize-link-'));
  writeFileSync(join(symlinkRoot, 'manifest.json'), '{}\n');
  symlinkSync(join(symlinkRoot, 'manifest.json'), join(symlinkRoot, 'linked.js'));
  assert.throws(() => collectSanitizedFiles(symlinkRoot), /symlinks are forbidden/);
});

test('sanitizer rejects unapproved top-level text, scripts, and license notices', () => {
  for (const unexpectedFile of [
    'credentials.txt',
    'unexpected-debug.js',
    'background.bundle.js.LICENSE.txt',
  ]) {
    const root = mkdtempSync(join(tmpdir(), 'stratus-sanitize-unapproved-'));
    writeFileSync(join(root, 'manifest.json'), '{}\n');
    writeFileSync(join(root, unexpectedFile), 'must not ship\n');
    assert.throws(
      () => collectSanitizedFiles(root),
      /artifact path is not on the sanitized allowlist/,
      unexpectedFile,
    );
  }
});

test('sanitizer rejects every missing required runtime file', () => {
  for (const missingFile of REQUIRED_ARTIFACT_FILES) {
    const root = mkdtempSync(join(tmpdir(), 'stratus-sanitize-missing-'));
    writeRequiredArtifactFixture(root, { omit: [missingFile] });
    assert.throws(
      () => collectSanitizedFiles(root),
      (error) => error.message.includes('sanitized artifact is missing required files:')
        && error.message.includes(missingFile),
      missingFile,
    );
  }
});

test('sanitizer accepts the complete expected production output inventory', () => {
  const root = mkdtempSync(join(tmpdir(), 'stratus-sanitize-expected-'));
  const expectedFiles = [
    '136.bundle.js',
    '330.bundle.js',
    '543.bundle.js',
    '761.bundle.js',
    'background.bundle.js',
    'content.bundle.js',
    'content.css',
    'manifest.json',
    'options.bundle.js',
    'options.bundle.js.LICENSE.txt',
    'options.html',
    'popup.bundle.js',
    'popup.bundle.js.LICENSE.txt',
    'popup.html',
    'sidebar.bundle.js',
    'sidebar.bundle.js.LICENSE.txt',
    'sidebar.html',
    'stratus-cart-core.js',
    'stratus-cart-popup.js',
    'stratus-task-email-optin.js',
    'zoho-content.bundle.js',
    'icons/icon-16.png',
    'icons/icon-32.png',
    'icons/icon-48.png',
    'icons/icon-128.png',
  ];

  mkdirSync(join(root, 'icons'), { recursive: true });
  for (const relativePath of expectedFiles) {
    writeFileSync(join(root, relativePath), relativePath.endsWith('.png') ? Buffer.from([137, 80, 78, 71]) : 'fixture\n');
  }

  assert.deepEqual(
    collectSanitizedFiles(root),
    [...expectedFiles].sort((a, b) => a.localeCompare(b, 'en')),
  );
});

test('sanitized ZIP and provenance are reproducible from synthetic fixtures', () => {
  assert.doesNotMatch(releaseArtifactScript, /execFileSync\(['"]zip['"]/);
  const root = mkdtempSync(join(tmpdir(), 'stratus-release-fixture-'));
  const dist = join(root, 'dist-input');
  const stageA = join(root, 'stage-a');
  const stageB = join(root, 'stage-b');
  mkdirSync(join(dist, 'icons'), { recursive: true });

  const profile = resolveBuildTarget('prod', { environment: {} });
  writeRequiredArtifactFixture(dist, {
    manifest: `${JSON.stringify(sourceManifest, null, 2)}\n`,
  });
  const lockfile = join(root, 'pnpm-lock.yaml');
  writeFileSync(lockfile, "lockfileVersion: '9.0'\n");
  const packageJsonPath = join(root, 'package.json');
  writeFileSync(packageJsonPath, '{"name":"fixture","version":"1.29.0"}\n');

  const common = {
    distDirectory: dist,
    profile,
    sourceCommit: 'a'.repeat(40),
    sourceTag: 'ext-v1.29.0',
    lockfilePath: lockfile,
    packageJsonPath,
    nodeVersion: '24.19.0',
    pnpmVersion: '11.19.0',
  };
  const first = createSanitizedStage({ ...common, stageDirectory: stageA });
  const second = createSanitizedStage({ ...common, stageDirectory: stageB });
  chmodSync(join(stageB, 'background.bundle.js'), 0o777);
  const unrelatedMtime = new Date('2026-08-21T19:20:21.000Z');
  utimesSync(join(stageB, 'background.bundle.js'), unrelatedMtime, unrelatedMtime);
  const zipA = join(root, 'artifact-a.zip');
  const zipB = join(root, 'artifact-b.zip');
  const bytesA = writeDeterministicZip({ stageDirectory: stageA, files: first.files, outputPath: zipA });
  const bytesB = writeDeterministicZip({
    stageDirectory: stageB,
    files: [...second.files].reverse(),
    outputPath: zipB,
  });

  assert.equal(sha256Buffer(bytesA), sha256Buffer(bytesB));
  const expectedZipNames = [...first.files]
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  assert.deepEqual(inspectStoredZip(bytesA, stageA), expectedZipNames);
  assert.deepEqual(inspectStoredZip(bytesB, stageB), expectedZipNames);
  assert.equal(
    readFileSync(join(stageA, 'STRATUS-PROVENANCE.json'), 'utf8'),
    readFileSync(join(stageB, 'STRATUS-PROVENANCE.json'), 'utf8'),
  );
  assert.equal(first.provenance.sourceCommit, 'a'.repeat(40));
  assert.equal(first.provenance.sourceTag, 'ext-v1.29.0');
  assert.equal(first.provenance.packageJsonSha256.length, 64);

  writeFileSync(packageJsonPath, '{"name":"fixture","version":"1.28.0"}\n');
  assert.throws(
    () => createSanitizedStage({ ...common, stageDirectory: join(root, 'stage-version-mismatch') }),
    /package.json version 1.28.0 does not match built manifest version 1.29.0/,
  );
});

test('deterministic ZIP writer rejects traversal, symlinks, duplicates, and classic ZIP overflows', () => {
  const root = mkdtempSync(join(tmpdir(), 'stratus-zip-reject-'));
  const output = join(root, 'out', 'fixture.zip');
  writeFileSync(join(root, 'fixture.js'), 'fixture\n');

  assert.throws(
    () => writeDeterministicZip({ stageDirectory: root, files: [], outputPath: output }),
    /empty artifact/,
  );
  assert.throws(
    () => writeDeterministicZip({
      stageDirectory: root,
      files: new Array(0x10000).fill('fixture.js'),
      outputPath: output,
    }),
    /at most 65535 entries/,
  );
  assert.throws(
    () => writeDeterministicZip({ stageDirectory: root, files: ['fixture.js', 'fixture.js'], outputPath: output }),
    /duplicate ZIP entry path/,
  );
  assert.throws(
    () => writeDeterministicZip({ stageDirectory: root, files: ['../fixture.js'], outputPath: output }),
    /outside artifact root/,
  );
  assert.throws(
    () => writeDeterministicZip({ stageDirectory: root, files: ['a'.repeat(0x10000)], outputPath: output }),
    /entry name is too long/,
  );

  symlinkSync(join(root, 'fixture.js'), join(root, 'fixture-link.js'));
  assert.throws(
    () => writeDeterministicZip({ stageDirectory: root, files: ['fixture-link.js'], outputPath: output }),
    /symlinks are forbidden/,
  );
});

test('prepared CRX receipt is bound to exact source, bytes, hash, and embedded provenance', () => {
  const fixture = createSyntheticPreparedCrxFixture();
  const validate = ({
    receipt = fixture.receipt,
    zipBytes = fixture.zipBytes,
    expectedProvenance = fixture.expectedProvenance,
  } = {}) => validatePreparedPayloadBinding({
    receipt,
    zipBytes,
    sourceCommit: fixture.sourceCommit,
    sourceTag: fixture.sourceTag,
    version: fixture.version,
    target: 'prod',
    unsignedPayload: 'unsigned-payload.zip',
    expectedProvenance,
  });

  try {
    const validated = validate();
    assert.deepEqual(validated.provenance, fixture.provenance);
    assert.deepEqual(validated.zipBytes, fixture.zipBytes);

    assert.throws(
      () => validate({ receipt: { ...fixture.receipt, unexpected: true } }),
      /receipt fields do not match schema version 1/,
    );
    assert.throws(
      () => validate({
        receipt: { ...fixture.receipt, unsignedPayloadSha256: '0'.repeat(64) },
      }),
      /hash or byte count does not match/,
    );
    assert.throws(
      () => validate({
        receipt: { ...fixture.receipt, unsignedPayloadBytes: fixture.zipBytes.length + 1 },
      }),
      /hash or byte count does not match/,
    );
    assert.throws(
      () => validate({
        receipt: { ...fixture.receipt, sourceCommit: 'd'.repeat(40) },
      }),
      /does not match the exact reviewed source identity/,
    );
    assert.throws(
      () => validate({ receipt: { ...fixture.receipt, version: '1.29.1' } }),
      /does not match the exact reviewed source identity/,
    );
    assert.throws(
      () => validate({
        receipt: {
          ...fixture.receipt,
          provenance: { ...fixture.provenance, apiOrigin: 'https://mutated.invalid' },
        },
      }),
      /prepared provenance apiOrigin does not match/,
    );

    const changedZipBytes = Buffer.from(fixture.zipBytes);
    changedZipBytes[30] ^= 1;
    assert.throws(
      () => validate({ zipBytes: changedZipBytes }),
      /hash or byte count does not match/,
    );

    // Even if an artifact producer rewrites both the embedded provenance and
    // receipt, then refreshes byte count/hash, source-known provenance is an
    // independent input on the signing runner and rejects the mutation.
    const rewritten = createSyntheticPreparedCrxFixture({
      provenanceOverrides: { apiOrigin: 'https://mutated.invalid' },
    });
    try {
      assert.throws(
        () => validate({ receipt: rewritten.receipt, zipBytes: rewritten.zipBytes }),
        /prepared provenance apiOrigin does not match/,
      );
    } finally {
      rmSync(rewritten.root, { recursive: true, force: true });
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('pure CRX3 core derives the ID and produces independently verifiable framing and signature', () => {
  const fixture = createSyntheticPreparedCrxFixture();
  try {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicExponent: 0x10001,
    });
    const publicKeyDer = publicKey.export({ type: 'spki', format: 'der' });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    const expectedExtensionId = deriveExtensionId(publicKeyDer);
    const signed = signCrx3({
      zipBytes: fixture.zipBytes,
      privateKeyPem,
      expectedExtensionId,
    });

    assert.equal(signed.extensionId, expectedExtensionId);
    assert.deepEqual(signed.publicKeyDer, publicKeyDer);
    assert.equal(signed.crxBytes.subarray(0, 4).toString('ascii'), 'Cr24');
    assert.equal(signed.crxBytes.readUInt32LE(4), 3);
    const headerSize = signed.crxBytes.readUInt32LE(8);
    const headerEnd = 12 + headerSize;
    assert.ok(headerEnd < signed.crxBytes.length);
    const headerFields = readLengthDelimitedProto(signed.crxBytes.subarray(12, headerEnd));
    const proofFields = readLengthDelimitedProto(onlyProtoField(headerFields, 2));
    const signedHeaderData = onlyProtoField(headerFields, 10000);
    const proofPublicKeyDer = onlyProtoField(proofFields, 1);
    const signature = onlyProtoField(proofFields, 2);
    const signedDataFields = readLengthDelimitedProto(signedHeaderData);
    const crxId = onlyProtoField(signedDataFields, 1);
    const embeddedZip = signed.crxBytes.subarray(headerEnd);

    assert.deepEqual(embeddedZip, fixture.zipBytes);
    assert.deepEqual(proofPublicKeyDer, publicKeyDer);
    assert.deepEqual(
      crxId,
      createHash('sha256').update(publicKeyDer).digest().subarray(0, 16),
    );
    assert.equal(deriveExtensionId(proofPublicKeyDer), expectedExtensionId);

    const signedHeaderSize = Buffer.alloc(4);
    signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);
    const verifier = createVerify('sha256');
    verifier.update(Buffer.from('CRX3 SignedData\x00', 'binary'));
    verifier.update(signedHeaderSize);
    verifier.update(signedHeaderData);
    verifier.update(embeddedZip);
    assert.equal(
      verifier.verify(createPublicKey({ key: proofPublicKeyDer, type: 'spki', format: 'der' }), signature),
      true,
    );

    const wrongExtensionId = `${expectedExtensionId[0] === 'a' ? 'b' : 'a'}${expectedExtensionId.slice(1)}`;
    assert.throws(
      () => signCrx3({
        zipBytes: fixture.zipBytes,
        privateKeyPem,
        expectedExtensionId: wrongExtensionId,
      }),
      /not the expected extension ID/,
    );
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test('source identity requires matching package, built manifest, and target tag versions', () => {
  assert.doesNotThrow(() => validatePackageManifestVersion({
    packageVersion: '1.29.0',
    manifestVersion: '1.29.0',
  }));
  assert.throws(
    () => validatePackageManifestVersion({ packageVersion: '1.28.0', manifestVersion: '1.29.0' }),
    /does not match built manifest version/,
  );
  assert.throws(
    () => validateSourceIdentity({ commit: 'abc', tag: 'ext-v1.29.0', target: 'prod', version: '1.29.0' }),
    /full lowercase 40-character/,
  );
  assert.throws(
    () => validateSourceIdentity({ commit: 'a'.repeat(40), tag: 'ext-v1.28.0', target: 'prod', version: '1.29.0' }),
    /exactly ext-v1.29.0/,
  );
});

test('release dependency preparation is frozen, offline, scoped, and lock-verified', () => {
  assert.throws(
    () => installFrozenReleaseDependencies('/', { remove() {}, run() {} }),
    /must not be the filesystem root/,
  );
  const root = mkdtempSync(join(tmpdir(), 'stratus-release-dependencies-'));
  const activeLockDirectory = join(root, 'node_modules', '.pnpm');
  mkdirSync(activeLockDirectory, { recursive: true });
  const lockfileContents = "lockfileVersion: '9.0'\n";
  writeFileSync(join(root, 'pnpm-lock.yaml'), lockfileContents);
  writeFileSync(join(activeLockDirectory, 'stale-before-install.txt'), 'must be removed\n');
  const siblingSentinel = join(root, 'must-survive.txt');
  writeFileSync(siblingSentinel, 'outside node_modules\n');

  let invocation;
  const order = [];
  installFrozenReleaseDependencies(root, {
    environment: {},
    remove(target, options) {
      order.push('remove');
      assert.equal(target, join(root, 'node_modules'));
      assert.deepEqual(options, { recursive: true, force: true });
      rmSync(target, options);
      assert.equal(existsSync(target), false);
      assert.equal(readFileSync(siblingSentinel, 'utf8'), 'outside node_modules\n');
    },
    run(command, args, options) {
      order.push('run');
      assert.equal(existsSync(join(root, 'node_modules')), false);
      assert.equal(readFileSync(siblingSentinel, 'utf8'), 'outside node_modules\n');
      invocation = { command, args, options };
      mkdirSync(activeLockDirectory, { recursive: true });
      writeFileSync(join(activeLockDirectory, 'lock.yaml'), lockfileContents);
    },
  });

  assert.deepEqual(order, ['remove', 'run']);
  assert.equal(invocation.command, 'pnpm');
  assert.deepEqual(invocation.args, [...RELEASE_DEPENDENCY_INSTALL_ARGS]);
  assert.deepEqual(invocation.args, [
    'install',
    '--frozen-lockfile',
    '--offline',
    '--ignore-scripts',
    '--ignore-workspace',
    '--verify-store-integrity',
  ]);
  assert.equal(invocation.options.cwd, root);
  assert.equal(invocation.options.env.CI, 'true');
  assert.equal(existsSync(join(activeLockDirectory, 'stale-before-install.txt')), false);
  assert.equal(readFileSync(siblingSentinel, 'utf8'), 'outside node_modules\n');

  assert.throws(
    () => installFrozenReleaseDependencies(root, {
      run() {
        mkdirSync(activeLockDirectory, { recursive: true });
        writeFileSync(join(activeLockDirectory, 'lock.yaml'), "lockfileVersion: 'stale'\n");
      },
    }),
    /installed dependency graph does not match pnpm-lock.yaml/,
  );
});

test('packagers reject untracked source and rebuild instead of trusting stale dist', () => {
  for (const source of [packageScript, crxScript]) {
    assert.match(source, /--untracked-files=all/);
    assert.match(source, /installFrozenReleaseDependencies\(/);
    assert.match(source, /execFileSync\('pnpm', \['run',/);
    assert.match(source, /packageJsonPath:|packageJsonPath,/);
  }
  assert.match(packageScript, /`build:\$\{targetName\}`/);
  assert.match(crxScript, /\['run', 'build:prod'\]/);
  assert.doesNotMatch(crxWrapper, /pnpm run build:prod/);
  assert.match(crxWrapper, /pnpm run pack:crx/);
});

test('developer commands make every production-gateway DEV path explicit', () => {
  assert.equal(packageJson.scripts.dev, undefined);
  assert.equal(packageJson.scripts['build:harness'], undefined);
  assert.match(packageJson.scripts['dev:snapshot'], /target=snapshot-dev/);
  assert.match(packageJson.scripts['dev:team'], /target=team-dev/);
  assert.match(packageJson.scripts['build:harness:team'], /target=team-dev/);
  assert.match(packageJson.scripts['build:harness:snapshot-evidence'], /target=snapshot-dev/);
  assert.doesNotMatch(harnessScript, /resolveBuildTarget\(['"]snapshot-dev['"]\)/);
  assert.match(harnessScript, /QA harness requires --env target=team-dev/);
});

test('CRX preparation and signing phases enforce a fresh-runner key boundary', () => {
  assert.equal(packageJson.scripts['pack:crx'], undefined);
  assert.match(packageJson.scripts['pack:crx:prepare'], /pack-crx\.mjs prepare/);
  assert.match(packageJson.scripts['pack:crx:sign'], /pack-crx\.mjs sign-prepared/);
  assert.match(crxScript, /phase === 'prepare'/);
  assert.match(crxScript, /phase === 'verify-prepared'/);
  assert.match(crxScript, /phase === 'sign-prepared'/);

  const prepareStart = crxScript.indexOf('function prepareUnsignedPayload()');
  const signStart = crxScript.indexOf('function signPreparedPayload()');
  const verifyStart = crxScript.indexOf('function verifyPreparedPayload()');
  assert.ok(prepareStart >= 0 && signStart > prepareStart && verifyStart > signStart);
  const prepareBody = crxScript.slice(prepareStart, signStart);
  const signBody = crxScript.slice(signStart, verifyStart);
  assert.match(prepareBody, /prepare must run before any production signing secret/);
  assert.match(prepareBody, /installFrozenReleaseDependencies\(EXT_DIR\)/);
  assert.match(prepareBody, /\['run', 'build:prod'\]/);
  assert.doesNotMatch(signBody, /installFrozenReleaseDependencies\(|execFileSync\('pnpm'|\['run', 'build:prod'\]/);
  assert.deepEqual(
    [...crxCoreScript.matchAll(/from '([^']+)'/g)].map((match) => match[1]).sort(),
    ['node:crypto', 'node:util'],
  );
  assert.doesNotMatch(crxCoreScript, /process\.env/);
  assert.match(crxScript, /const EXPECTED_ID = 'haangicfjfkenoilhdadbnljcacighih';/);
  assert.match(signBody, /signCrx3\(\{[\s\S]*expectedExtensionId:\s*EXPECTED_ID/);
  assert.doesNotMatch(crxScript, /process\.env\.(?:CRX|EXTENSION|EXPECTED)[A-Z0-9_]*/);

  const verifyJob = releaseWorkflow.indexOf('  verify-source:');
  const prepareJob = releaseWorkflow.indexOf('  prepare-payload:');
  const signJob = releaseWorkflow.indexOf('  build-sign-deploy:');
  assert.ok(verifyJob >= 0 && prepareJob > verifyJob && signJob > prepareJob);
  const signerJobText = releaseWorkflow.slice(signJob);
  assert.match(signerJobText, /uses:\s+actions\/download-artifact@[0-9a-f]{40}\b/);
  assert.ok(signerJobText.indexOf('pack-crx.mjs verify-prepared') < signerJobText.indexOf('Require protected signing secret'));
  assert.ok(signerJobText.indexOf('Require protected signing secret') < signerJobText.indexOf('pack-crx.mjs sign-prepared'));
  assert.doesNotMatch(signerJobText, /pnpm|npm ci|webpack|build:prod/);
  assert.match(releaseWorkflow.slice(prepareJob, signJob), /uses:\s+actions\/upload-artifact@[0-9a-f]{40}\b/);
  assert.match(releaseWorkflow, /refs\/remotes\/origin\/main/);
});

test('every external action in release, deploy, and build workflows is commit-pinned', () => {
  for (const [name, workflow] of [
    ['release-extension', releaseWorkflow],
    ['deploy', deployWorkflow],
    ['build-check', buildWorkflow],
  ]) {
    const usesLines = workflow.split('\n').filter((line) => /^\s*(?:-\s*)?uses:/.test(line));
    assert.ok(usesLines.length > 0, `${name} should use at least one external action`);
    for (const line of usesLines) {
      assert.match(
        line,
        /^\s*(?:-\s*)?uses:\s+[^\s@]+@[0-9a-f]{40}(?:\s+#.*)?$/,
        `${name}: ${line.trim()}`,
      );
    }
  }
});

test('CI gates use least privilege, full local suites, preflight, and protected main', () => {
  assert.match(buildWorkflow, /permissions:\s*\n\s+contents: read/);
  assert.match(buildWorkflow, /node scripts\/run-maintained-worker-tests\.mjs/);
  assert.match(buildWorkflow, /pnpm run test:all/);
  assert.match(deployWorkflow, /permissions:\s*\n\s+contents: read/);
  assert.match(deployWorkflow, /refs\/remotes\/origin\/main/);
  assert.ok(
    deployWorkflow.indexOf('Preflight all coupled Worker bundles before any deployment')
      < deployWorkflow.indexOf('Deploy Webex Worker'),
  );
});
