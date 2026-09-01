import {
  createHash,
  createPrivateKey,
  createPublicKey,
  createSign,
} from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const CRX3_MAGIC = Buffer.from('Cr24', 'ascii');
const CRX3_SIGNED_DATA_PREFIX = Buffer.from('CRX3 SignedData\x00', 'binary');
const PROVENANCE_ENTRY = 'STRATUS-PROVENANCE.json';
const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_VERSION_NEEDED = 20;
const ZIP_VERSION_MADE_BY_UNIX = (3 << 8) | ZIP_VERSION_NEEDED;
const ZIP_UTF8_FLAG = 1 << 11;
const ZIP_STORE_METHOD = 0;
const ZIP_FIXED_DOS_TIME = 0;
const ZIP_FIXED_DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1;
const ZIP_FIXED_UNIX_FILE_ATTRIBUTES = (0o100644 << 16) >>> 0;

const RECEIPT_KEYS = [
  'provenance',
  'schemaVersion',
  'sourceCommit',
  'sourceTag',
  'target',
  'unsignedPayload',
  'unsignedPayloadBytes',
  'unsignedPayloadSha256',
  'version',
].sort();

const EXPECTED_PROVENANCE_KEYS = [
  'apiOrigin',
  'environment',
  'lockfile',
  'lockfileSha256',
  'nodeVersion',
  'packageJson',
  'packageJsonSha256',
  'pnpmVersion',
  'product',
  'schemaVersion',
  'sourceCommit',
  'sourceTag',
  'target',
  'version',
].sort();

const COMPLETE_PROVENANCE_KEYS = [
  ...EXPECTED_PROVENANCE_KEYS,
  'files',
  'sanitizedDistTreeSha256',
].sort();

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function asBuffer(value, label) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  throw new Error(`${label} must be a Buffer or Uint8Array`);
}

function assertPlainObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
}

function assertExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  if (!isDeepStrictEqual(actualKeys, expectedKeys)) {
    throw new Error(`${label} fields do not match schema version 1`);
  }
}

function assertRange(buffer, offset, length, label) {
  if (
    !Number.isSafeInteger(offset)
    || !Number.isSafeInteger(length)
    || offset < 0
    || length < 0
    || offset + length > buffer.length
  ) {
    throw new Error(`${label} is outside the ZIP byte range`);
  }
}

function crc32(value) {
  let crc = 0xffffffff;
  for (const byte of value) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertCanonicalZipPath(name) {
  if (
    !name
    || name.includes('\0')
    || name.includes('\\')
    || name.startsWith('/')
    || name.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`prepared ZIP has a non-canonical entry path: ${name || '(empty)'}`);
  }
}

/**
 * Parse the exact deterministic, stored ZIP dialect emitted by
 * release-artifact.mjs. Strict framing keeps the signer from interpreting a
 * different byte range than Chrome or the provenance validator.
 */
function parseDeterministicStoredZip(value) {
  const zipBytes = asBuffer(value, 'zipBytes');
  if (zipBytes.length < 22) throw new Error('prepared ZIP is truncated');

  const eocdOffset = zipBytes.length - 22;
  if (zipBytes.readUInt32LE(eocdOffset) !== ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error('prepared ZIP is missing its terminal end-of-central-directory record');
  }
  if (
    zipBytes.readUInt16LE(eocdOffset + 4) !== 0
    || zipBytes.readUInt16LE(eocdOffset + 6) !== 0
    || zipBytes.readUInt16LE(eocdOffset + 20) !== 0
  ) {
    throw new Error('prepared ZIP must be single-disk and have no archive comment');
  }

  const entryCount = zipBytes.readUInt16LE(eocdOffset + 10);
  if (!entryCount || zipBytes.readUInt16LE(eocdOffset + 8) !== entryCount) {
    throw new Error('prepared ZIP entry count is missing or inconsistent');
  }
  const centralSize = zipBytes.readUInt32LE(eocdOffset + 12);
  const centralOffset = zipBytes.readUInt32LE(eocdOffset + 16);
  if (centralOffset + centralSize !== eocdOffset) {
    throw new Error('prepared ZIP central directory does not end at the terminal record');
  }

  const entries = [];
  const seenNames = new Set();
  let centralCursor = centralOffset;
  let previousNameBytes;
  for (let index = 0; index < entryCount; index += 1) {
    assertRange(zipBytes, centralCursor, 46, 'ZIP central-directory header');
    if (zipBytes.readUInt32LE(centralCursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('prepared ZIP central-directory signature is invalid');
    }

    const madeByVersion = zipBytes.readUInt16LE(centralCursor + 4);
    const versionNeeded = zipBytes.readUInt16LE(centralCursor + 6);
    const flags = zipBytes.readUInt16LE(centralCursor + 8);
    const method = zipBytes.readUInt16LE(centralCursor + 10);
    const modifiedTime = zipBytes.readUInt16LE(centralCursor + 12);
    const modifiedDate = zipBytes.readUInt16LE(centralCursor + 14);
    const checksum = zipBytes.readUInt32LE(centralCursor + 16);
    const compressedSize = zipBytes.readUInt32LE(centralCursor + 20);
    const uncompressedSize = zipBytes.readUInt32LE(centralCursor + 24);
    const nameLength = zipBytes.readUInt16LE(centralCursor + 28);
    const extraLength = zipBytes.readUInt16LE(centralCursor + 30);
    const commentLength = zipBytes.readUInt16LE(centralCursor + 32);
    const diskStart = zipBytes.readUInt16LE(centralCursor + 34);
    const internalAttributes = zipBytes.readUInt16LE(centralCursor + 36);
    const externalAttributes = zipBytes.readUInt32LE(centralCursor + 38);
    const localOffset = zipBytes.readUInt32LE(centralCursor + 42);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    assertRange(zipBytes, centralCursor, recordLength, 'ZIP central-directory record');

    if (
      madeByVersion !== ZIP_VERSION_MADE_BY_UNIX
      || versionNeeded !== ZIP_VERSION_NEEDED
      || flags !== ZIP_UTF8_FLAG
      || method !== ZIP_STORE_METHOD
      || modifiedTime !== ZIP_FIXED_DOS_TIME
      || modifiedDate !== ZIP_FIXED_DOS_DATE
      || compressedSize !== uncompressedSize
      || extraLength !== 0
      || commentLength !== 0
      || diskStart !== 0
      || internalAttributes !== 0
      || externalAttributes !== ZIP_FIXED_UNIX_FILE_ATTRIBUTES
    ) {
      throw new Error('prepared ZIP is not the deterministic stored release format');
    }

    const nameBytes = zipBytes.subarray(centralCursor + 46, centralCursor + 46 + nameLength);
    const name = nameBytes.toString('utf8');
    if (!Buffer.from(name, 'utf8').equals(nameBytes)) {
      throw new Error('prepared ZIP entry name is not valid UTF-8');
    }
    assertCanonicalZipPath(name);
    if (seenNames.has(name)) throw new Error(`prepared ZIP contains duplicate entry: ${name}`);
    if (previousNameBytes && Buffer.compare(previousNameBytes, nameBytes) >= 0) {
      throw new Error('prepared ZIP entries are not in deterministic byte order');
    }
    seenNames.add(name);
    previousNameBytes = Buffer.from(nameBytes);
    entries.push({
      checksum,
      flags,
      localOffset,
      method,
      name,
      nameBytes: Buffer.from(nameBytes),
      size: uncompressedSize,
    });
    centralCursor += recordLength;
  }
  if (centralCursor !== eocdOffset) {
    throw new Error('prepared ZIP central-directory size does not match its records');
  }

  const files = new Map();
  let expectedLocalOffset = 0;
  for (const entry of entries) {
    if (entry.localOffset !== expectedLocalOffset) {
      throw new Error('prepared ZIP local records are not contiguous and deterministic');
    }
    assertRange(zipBytes, entry.localOffset, 30, `ZIP local header for ${entry.name}`);
    if (zipBytes.readUInt32LE(entry.localOffset) !== ZIP_LOCAL_FILE_HEADER_SIGNATURE) {
      throw new Error(`prepared ZIP local-header signature is invalid for ${entry.name}`);
    }
    const localFlags = zipBytes.readUInt16LE(entry.localOffset + 6);
    const localVersionNeeded = zipBytes.readUInt16LE(entry.localOffset + 4);
    const localMethod = zipBytes.readUInt16LE(entry.localOffset + 8);
    const localModifiedTime = zipBytes.readUInt16LE(entry.localOffset + 10);
    const localModifiedDate = zipBytes.readUInt16LE(entry.localOffset + 12);
    const localChecksum = zipBytes.readUInt32LE(entry.localOffset + 14);
    const localCompressedSize = zipBytes.readUInt32LE(entry.localOffset + 18);
    const localUncompressedSize = zipBytes.readUInt32LE(entry.localOffset + 22);
    const localNameLength = zipBytes.readUInt16LE(entry.localOffset + 26);
    const localExtraLength = zipBytes.readUInt16LE(entry.localOffset + 28);
    const dataOffset = entry.localOffset + 30 + localNameLength + localExtraLength;
    assertRange(zipBytes, entry.localOffset, 30 + localNameLength + localExtraLength + entry.size, `ZIP local record for ${entry.name}`);

    const localNameBytes = zipBytes.subarray(entry.localOffset + 30, entry.localOffset + 30 + localNameLength);
    if (
      localVersionNeeded !== ZIP_VERSION_NEEDED
      || localFlags !== entry.flags
      || localMethod !== entry.method
      || localModifiedTime !== ZIP_FIXED_DOS_TIME
      || localModifiedDate !== ZIP_FIXED_DOS_DATE
      || localChecksum !== entry.checksum
      || localCompressedSize !== entry.size
      || localUncompressedSize !== entry.size
      || localExtraLength !== 0
      || !localNameBytes.equals(entry.nameBytes)
    ) {
      throw new Error(`prepared ZIP local and central records disagree for ${entry.name}`);
    }
    const data = Buffer.from(zipBytes.subarray(dataOffset, dataOffset + entry.size));
    if (crc32(data) !== entry.checksum) {
      throw new Error(`prepared ZIP CRC does not match for ${entry.name}`);
    }
    files.set(entry.name, data);
    expectedLocalOffset = dataOffset + entry.size;
  }
  if (expectedLocalOffset !== centralOffset) {
    throw new Error('prepared ZIP local records do not end at the central directory');
  }
  return files;
}

function hashArtifactFiles(files, fileNames) {
  const hash = createHash('sha256');
  for (const name of fileNames) {
    const bytes = files.get(name);
    hash.update(name, 'utf8');
    hash.update('\0');
    hash.update(String(bytes.length), 'utf8');
    hash.update('\0');
    hash.update(createHash('sha256').update(bytes).digest());
    hash.update('\n');
  }
  return hash.digest('hex');
}

/**
 * Validate the no-secret runner's receipt against the exact reviewed identity
 * and against the bytes/provenance embedded in its deterministic ZIP.
 */
export function validatePreparedPayloadBinding({
  receipt,
  zipBytes: zipValue,
  sourceCommit,
  sourceTag,
  version,
  target = 'prod',
  unsignedPayload = 'unsigned-payload.zip',
  expectedProvenance,
}) {
  assertPlainObject(receipt, 'prepared payload receipt');
  assertExactKeys(receipt, RECEIPT_KEYS, 'prepared payload receipt');
  assertPlainObject(expectedProvenance, 'expected provenance');
  assertExactKeys(expectedProvenance, EXPECTED_PROVENANCE_KEYS, 'expected provenance');
  if (!/^[0-9a-f]{40}$/.test(sourceCommit || '')) {
    throw new Error('expected source commit must be a full lowercase 40-character SHA');
  }
  if (typeof sourceTag !== 'string' || !sourceTag) throw new Error('expected source tag is missing');
  if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version || '')) throw new Error('expected version is invalid');

  if (
    receipt.schemaVersion !== 1
    || receipt.target !== target
    || receipt.version !== version
    || receipt.sourceCommit !== sourceCommit
    || receipt.sourceTag !== sourceTag
    || receipt.unsignedPayload !== unsignedPayload
  ) {
    throw new Error('prepared payload receipt does not match the exact reviewed source identity');
  }

  for (const [key, expectedValue] of Object.entries(expectedProvenance)) {
    if (!isDeepStrictEqual(receipt.provenance?.[key], expectedValue)) {
      throw new Error(`prepared provenance ${key} does not match the exact reviewed source`);
    }
  }
  if (
    expectedProvenance.sourceCommit !== sourceCommit
    || expectedProvenance.sourceTag !== sourceTag
    || expectedProvenance.version !== version
    || expectedProvenance.target !== target
  ) {
    throw new Error('expected provenance is inconsistent with the reviewed source identity');
  }

  const zipBytes = asBuffer(zipValue, 'zipBytes');
  if (!Number.isSafeInteger(receipt.unsignedPayloadBytes) || receipt.unsignedPayloadBytes <= 0) {
    throw new Error('prepared payload receipt has an invalid byte count');
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.unsignedPayloadSha256 || '')) {
    throw new Error('prepared payload receipt has an invalid SHA-256');
  }
  if (
    receipt.unsignedPayloadBytes !== zipBytes.length
    || receipt.unsignedPayloadSha256 !== sha256Hex(zipBytes)
  ) {
    throw new Error('prepared unsigned payload hash or byte count does not match its receipt');
  }

  const files = parseDeterministicStoredZip(zipBytes);
  const embeddedProvenanceBytes = files.get(PROVENANCE_ENTRY);
  if (!embeddedProvenanceBytes) {
    throw new Error(`prepared ZIP is missing ${PROVENANCE_ENTRY}`);
  }
  let embeddedProvenance;
  try {
    embeddedProvenance = JSON.parse(embeddedProvenanceBytes.toString('utf8'));
  } catch (error) {
    throw new Error(`prepared ZIP provenance is not valid JSON: ${error.message}`);
  }
  assertPlainObject(receipt.provenance, 'receipt provenance');
  assertPlainObject(embeddedProvenance, 'embedded ZIP provenance');
  assertExactKeys(receipt.provenance, COMPLETE_PROVENANCE_KEYS, 'receipt provenance');
  assertExactKeys(embeddedProvenance, COMPLETE_PROVENANCE_KEYS, 'embedded ZIP provenance');
  if (!isDeepStrictEqual(receipt.provenance, embeddedProvenance)) {
    throw new Error('receipt provenance does not exactly match the provenance embedded in the prepared ZIP');
  }

  const artifactFiles = [...files.keys()]
    .filter((name) => name !== PROVENANCE_ENTRY)
    .sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (!isDeepStrictEqual(embeddedProvenance.files, artifactFiles)) {
    throw new Error('prepared provenance file inventory does not match the ZIP entries');
  }
  if (
    !/^[0-9a-f]{64}$/.test(embeddedProvenance.sanitizedDistTreeSha256 || '')
    || embeddedProvenance.sanitizedDistTreeSha256 !== hashArtifactFiles(files, artifactFiles)
  ) {
    throw new Error('prepared provenance tree hash does not match the ZIP entries');
  }

  return { receipt, zipBytes, provenance: embeddedProvenance };
}

function varint(value) {
  const bytes = [];
  let remaining = value;
  while (remaining > 0x7f) {
    bytes.push((remaining & 0x7f) | 0x80);
    remaining >>>= 7;
  }
  bytes.push(remaining & 0x7f);
  return Buffer.from(bytes);
}

function bytesField(fieldNumber, payload) {
  return Buffer.concat([
    varint((fieldNumber << 3) | 2),
    varint(payload.length),
    payload,
  ]);
}

/** Derive Chrome's 32-character extension ID from an SPKI public key. */
export function deriveExtensionId(publicKeyDerValue) {
  const publicKeyDer = asBuffer(publicKeyDerValue, 'publicKeyDer');
  if (!publicKeyDer.length) throw new Error('publicKeyDer must not be empty');
  const idHash = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  let id = '';
  for (const byte of idHash) {
    id += String.fromCharCode(97 + (byte >> 4));
    id += String.fromCharCode(97 + (byte & 0x0f));
  }
  return id;
}

/** Sign and frame a deterministic ZIP as CRX3 using an explicitly pinned ID. */
export function signCrx3({ zipBytes: zipValue, privateKeyPem, expectedExtensionId }) {
  if (!/^[a-p]{32}$/.test(expectedExtensionId || '')) {
    throw new Error('expectedExtensionId must be an explicit 32-character Chrome extension ID');
  }
  const zipBytes = asBuffer(zipValue, 'zipBytes');
  parseDeterministicStoredZip(zipBytes);
  if (
    typeof privateKeyPem !== 'string'
    && !Buffer.isBuffer(privateKeyPem)
    && !(privateKeyPem instanceof Uint8Array)
  ) {
    throw new Error('privateKeyPem must be an RSA private key PEM string or bytes');
  }

  let privateKey;
  try {
    privateKey = createPrivateKey(privateKeyPem);
  } catch (error) {
    throw new Error(`could not parse private key as PEM: ${error.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'rsa') {
    throw new Error(`signing key must be RSA, got "${privateKey.asymmetricKeyType}"`);
  }

  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const extensionId = deriveExtensionId(publicKeyDer);
  if (extensionId !== expectedExtensionId) {
    throw new Error(`signing key derives ${extensionId}, not the expected extension ID ${expectedExtensionId}`);
  }

  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = bytesField(1, crxId);
  const signedHeaderSize = Buffer.alloc(4);
  signedHeaderSize.writeUInt32LE(signedHeaderData.length, 0);
  const signer = createSign('sha256');
  signer.update(CRX3_SIGNED_DATA_PREFIX);
  signer.update(signedHeaderSize);
  signer.update(signedHeaderData);
  signer.update(zipBytes);
  const signature = signer.sign(privateKey);

  const proof = Buffer.concat([
    bytesField(1, publicKeyDer),
    bytesField(2, signature),
  ]);
  const header = Buffer.concat([
    bytesField(2, proof),
    bytesField(10000, signedHeaderData),
  ]);
  const versionBytes = Buffer.alloc(4);
  versionBytes.writeUInt32LE(3, 0);
  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(header.length, 0);

  return {
    crxBytes: Buffer.concat([CRX3_MAGIC, versionBytes, headerSize, header, zipBytes]),
    extensionId,
    publicKeyDer,
  };
}
