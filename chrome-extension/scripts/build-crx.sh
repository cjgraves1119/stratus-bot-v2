#!/bin/bash
# Build + sign the production Stratus AI extension from an exact reviewed tag.
#
# This is a thin convenience wrapper around scripts/pack-crx.mjs (the single
# source of truth for CRX3 packing + update-manifest generation, used by both
# local builds and the release-extension GitHub Actions workflow).
#
# Production releases are published by the protected GitHub workflow. This
# wrapper exists for controlled offline reproduction with the production key;
# it is not a throwaway-key or DEV packaging path.
#
# Usage:
#   STRATUS_RELEASE_COMMIT=<full-sha> STRATUS_RELEASE_TAG=ext-v<version> \
#     EXT_SIGNING_KEY_PEM_PATH=path/to/official-key.pem bash scripts/build-crx.sh
#
# Output (gitignored):
#   release/stratus-ai-<version>.crx
#   release/update-manifest.xml
#   release/stratus-ai-<version>.provenance.json
#   release/SHA256SUMS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse --key (optional; otherwise read EXT_SIGNING_KEY_PEM_PATH once). Keep the
# path in a non-exported shell variable while the dependency/build phase runs.
SIGNING_KEY_PATH="${EXT_SIGNING_KEY_PEM_PATH:-}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key) SIGNING_KEY_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "$SIGNING_KEY_PATH" ]]; then
  echo "✗ No signing key. Pass --key <path> or set EXT_SIGNING_KEY_PEM_PATH."
  echo "  Only the official protected key for the stable production ID is accepted."
  exit 1
fi

if [[ -z "${STRATUS_RELEASE_COMMIT:-}" || -z "${STRATUS_RELEASE_TAG:-}" ]]; then
  echo "✗ STRATUS_RELEASE_COMMIT and STRATUS_RELEASE_TAG are required."
  exit 1
fi

cd "$EXT_DIR"
unset EXT_SIGNING_KEY EXT_SIGNING_KEY_PEM_PATH
echo "→ Verifying dependencies, building, sanitizing, and hash-binding without the key..."
STRATUS_RELEASE_TARGET=prod pnpm run pack:crx:prepare

echo "→ Signing only the prepared payload..."
STRATUS_RELEASE_TARGET=prod EXT_SIGNING_KEY_PEM_PATH="$SIGNING_KEY_PATH" \
  node scripts/pack-crx.mjs sign-prepared

echo ""
echo "✓ Done. Artifacts in $EXT_DIR/release/"
echo "  For production, do NOT distribute this file by hand. Create/push the reviewed"
echo "  ext-v<version> tag, then manually run the protected 'Release Extension'"
echo "  workflow with that exact commit SHA and tag."
