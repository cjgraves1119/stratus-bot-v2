#!/usr/bin/env node
/**
 * pack-crx.mjs — Build a signed CRX3 + Chrome update manifest for self-hosted
 * auto-updates published to GitHub Pages.
 *
 * Reads:
 *   - chrome-extension/dist/            (the webpack build output; must exist)
 *   - $EXT_SIGNING_KEY_PEM_PATH         (path to an RSA private key in PEM format)
 *
 * Writes:
 *   - chrome-extension/release/stratus-ai-<version>.crx   (CRX3, signed)
 *   - chrome-extension/release/update-manifest.xml        (gupdate protocol 2.0)
 *
 * The version is read from dist/manifest.json. The extension ID is derived from
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
 * This is implemented directly with node:crypto + a tiny protobuf encoder
 * (no third-party CRX library) so it has no Node-version engine constraints and
 * produces exactly the bytes Chrome's CRX3 verifier expects.
 */

import { createHash, createSign, createPublicKey, createPrivateKey } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXT_DIR = resolve(__dirname, '..');
const DIST_DIR = join(EXT_DIR, 'dist');
const RELEASE_DIR = join(EXT_DIR, 'release');

const EXPECTED_ID = 'idkfeabnpcnpklbgknibidbgjcpbcmkh';
const PAGES_BASE = 'https://cjgraves1119.github.io/stratus-bot-v2';
// Minimum Chrome version that supports CRX3 (Chromium switched in late 2017).
const PRODVERSION_MIN = '64.0.3242';

function die(msg) {
  console.error(`\n✗ pack-crx: ${msg}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal protobuf (proto2) wire-format encoder.
// We only need field type 2 (length-delimited / bytes) and the ability to nest
// messages, which is all CrxFileHeader / AsymmetricKeyProof / SignedData use.
// ---------------------------------------------------------------------------

/** Encode an unsigned integer as a protobuf base-128 varint. */
function varint(value) {
  const bytes = [];
  let v = value;
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}

/** Encode one length-delimited (wire type 2) field: tag, length, payload. */
function bytesField(fieldNumber, payload) {
  const tag = varint((fieldNumber << 3) | 2); // wire type 2 = length-delimited
  const len = varint(payload.length);
  return Buffer.concat([tag, len, payload]);
}

/**
 * SignedData { optional bytes crx_id = 1; }
 * Returns the serialized SignedData message bytes.
 */
function encodeSignedData(crxId) {
  return bytesField(1, crxId);
}

/**
 * AsymmetricKeyProof { optional bytes public_key = 1; optional bytes signature = 2; }
 */
function encodeAsymmetricKeyProof(publicKeyDer, signature) {
  return Buffer.concat([bytesField(1, publicKeyDer), bytesField(2, signature)]);
}

/**
 * CrxFileHeader {
 *   repeated AsymmetricKeyProof sha256_with_rsa = 2;
 *   optional bytes signed_header_data = 10000;
 * }
 */
function encodeCrxFileHeader(proofMsg, signedHeaderData) {
  return Buffer.concat([
    bytesField(2, proofMsg), // sha256_with_rsa (single proof)
    bytesField(10000, signedHeaderData), // signed_header_data
  ]);
}

// ---------------------------------------------------------------------------
// Extension ID derivation: SHA-256 of SPKI DER, first 16 bytes, hex nibble
// 0-f -> a-p. Equivalent to Chrome's (nibble + 0x0a).toString(26).
// ---------------------------------------------------------------------------
function deriveExtensionId(publicKeyDer) {
  const fullHash = createHash('sha256').update(publicKeyDer).digest();
  const idHash = fullHash.subarray(0, 16);
  let id = '';
  for (const byte of idHash) {
    const hi = byte >> 4;
    const lo = byte & 0x0f;
    id += String.fromCharCode(97 + hi); // 'a' + hi nibble
    id += String.fromCharCode(97 + lo); // 'a' + lo nibble
  }
  return id;
}

// ---------------------------------------------------------------------------
// Build the ZIP of the dist/ directory. We shell out to the `zip` CLI (present
// on macOS and ubuntu-latest runners). Files are stored relative to dist/ so
// the archive has manifest.json at its root (required by Chrome). Source maps
// are excluded to keep the package lean.
// ---------------------------------------------------------------------------
function zipDist(outZipPath) {
  if (existsSync(outZipPath)) rmSync(outZipPath);
  // -r recurse, -q quiet, -9 max compression, -X strip extra file attrs,
  // -x exclude source maps. Run with cwd=dist so paths are root-relative.
  execFileSync('zip', ['-r', '-q', '-9', '-X', outZipPath, '.', '-x', '*.map'], {
    cwd: DIST_DIR,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  return readFileSync(outZipPath);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  // 1. Validate inputs.
  if (!existsSync(DIST_DIR) || !existsSync(join(DIST_DIR, 'manifest.json'))) {
    die(`built extension not found at ${DIST_DIR}. Run "npm run build" first.`);
  }

  const keyPath = process.env.EXT_SIGNING_KEY_PEM_PATH;
  if (!keyPath) {
    die('EXT_SIGNING_KEY_PEM_PATH is not set (path to the RSA private key PEM).');
  }
  if (!existsSync(keyPath)) {
    die(`signing key not found at EXT_SIGNING_KEY_PEM_PATH="${keyPath}".`);
  }

  const manifest = JSON.parse(readFileSync(join(DIST_DIR, 'manifest.json'), 'utf8'));
  const version = manifest.version;
  if (!version) die('dist/manifest.json has no "version" field.');

  // 2. Load the private key and derive the public key (SPKI DER).
  let privateKey;
  try {
    privateKey = createPrivateKey(readFileSync(keyPath));
  } catch (err) {
    die(`could not parse private key as PEM: ${err.message}`);
  }
  if (privateKey.asymmetricKeyType !== 'rsa') {
    die(`signing key must be RSA, got "${privateKey.asymmetricKeyType}". CRX3 sha256_with_rsa requires an RSA key.`);
  }
  const publicKeyDer = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });

  // 3. Derive the extension ID.
  const extensionId = deriveExtensionId(publicKeyDer);

  mkdirSync(RELEASE_DIR, { recursive: true });

  // 4. Zip the build.
  const tmpZipPath = join(RELEASE_DIR, `.stratus-ai-${version}.zip`);
  const zipBytes = zipDist(tmpZipPath);

  // 5. Build the CRX3 signed-header and signature.
  //    crx_id = first 16 bytes of the public-key hash (raw, not a-p encoded).
  const crxId = createHash('sha256').update(publicKeyDer).digest().subarray(0, 16);
  const signedHeaderData = encodeSignedData(crxId);

  //    Signed payload = magic + uint32LE(len) + signedHeaderData + zip.
  const sizeOctets = Buffer.alloc(4);
  sizeOctets.writeUInt32LE(signedHeaderData.length, 0);
  const signer = createSign('sha256');
  signer.update(Buffer.from('CRX3 SignedData\x00', 'binary'));
  signer.update(sizeOctets);
  signer.update(signedHeaderData);
  signer.update(zipBytes);
  // RSASSA-PKCS1-v1_5 over SHA-256 — Node's default RSA signature padding,
  // which is exactly the "sha256_with_rsa" proof Chrome's CRX3 verifier expects.
  const signature = signer.sign(privateKey);

  // 6. Assemble the CrxFileHeader protobuf.
  const proof = encodeAsymmetricKeyProof(publicKeyDer, signature);
  const header = encodeCrxFileHeader(proof, signedHeaderData);

  // 7. Assemble the final CRX3 file.
  const magic = Buffer.from('Cr24', 'utf8');
  const formatVersion = Buffer.alloc(4);
  formatVersion.writeUInt32LE(3, 0); // CRX3
  const headerSize = Buffer.alloc(4);
  headerSize.writeUInt32LE(header.length, 0);

  const crxBuffer = Buffer.concat([magic, formatVersion, headerSize, header, zipBytes]);

  const crxName = `stratus-ai-${version}.crx`;
  const crxPath = join(RELEASE_DIR, crxName);
  writeFileSync(crxPath, crxBuffer);

  // Clean up the intermediate zip — only the .crx + .xml ship to Pages.
  rmSync(tmpZipPath, { force: true });

  // 8. Generate the update manifest (gupdate protocol 2.0).
  const codebase = `${PAGES_BASE}/${crxName}`;
  const xml =
    `<?xml version='1.0' encoding='UTF-8'?>\n` +
    `<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>\n` +
    `  <app appid='${extensionId}'>\n` +
    `    <updatecheck codebase='${codebase}' version='${version}' prodversionmin='${PRODVERSION_MIN}' />\n` +
    `  </app>\n` +
    `</gupdate>\n`;
  const xmlPath = join(RELEASE_DIR, 'update-manifest.xml');
  writeFileSync(xmlPath, xml);

  // 9. Report.
  console.log('✓ pack-crx complete');
  console.log(`  version:       ${version}`);
  console.log(`  extension ID:  ${extensionId}`);
  console.log(`  crx:           ${crxPath} (${crxBuffer.length} bytes)`);
  console.log(`  manifest:      ${xmlPath}`);
  console.log(`  codebase:      ${codebase}`);

  if (extensionId !== EXPECTED_ID) {
    console.warn(
      `\n⚠ WARNING: derived extension ID (${extensionId}) does NOT match the ` +
        `expected stable ID (${EXPECTED_ID}).\n` +
        `  This is normal when signing with a throwaway/test key. In CI the real ` +
        `EXT_SIGNING_KEY secret must be the key that yields the expected ID, or ` +
        `installed users will not receive updates.`
    );
  } else {
    console.log(`  ✓ extension ID matches the expected stable ID.`);
  }
}

main();
