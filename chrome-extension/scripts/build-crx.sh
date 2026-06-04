#!/bin/bash
# Build + sign the Stratus AI extension as a CRX3 for local testing.
#
# This is a thin convenience wrapper around scripts/pack-crx.mjs (the single
# source of truth for CRX3 packing + update-manifest generation, used by both
# local builds and the release-extension GitHub Actions workflow).
#
# Production releases are published to GitHub Pages by CI — you normally do NOT
# run this by hand. Use it only to produce a local .crx for manual inspection.
#
# Usage:
#   bash scripts/build-crx.sh --key path/to/key.pem
#   EXT_SIGNING_KEY_PEM_PATH=path/to/key.pem bash scripts/build-crx.sh
#
# Output (gitignored):
#   release/stratus-ai-<version>.crx
#   release/update-manifest.xml

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"

# Parse --key (optional; otherwise rely on EXT_SIGNING_KEY_PEM_PATH).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key) export EXT_SIGNING_KEY_PEM_PATH="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

if [[ -z "${EXT_SIGNING_KEY_PEM_PATH:-}" ]]; then
  echo "✗ No signing key. Pass --key <path> or set EXT_SIGNING_KEY_PEM_PATH."
  echo "  Generate a throwaway test key with: openssl genrsa 2048 > /tmp/test-key.pem"
  echo "  NOTE: only the official signing key yields the stable extension ID;"
  echo "  a test key produces a different ID (fine for local inspection only)."
  exit 1
fi

echo "→ Building extension (npm run build)..."
cd "$EXT_DIR"
npm run build

echo "→ Packing CRX3 + update manifest (scripts/pack-crx.mjs)..."
node scripts/pack-crx.mjs

echo ""
echo "✓ Done. Artifacts in $EXT_DIR/release/"
echo "  For production, do NOT distribute this file by hand — push an ext-v<version>"
echo "  tag (or run the 'Release Extension' workflow) to publish to GitHub Pages."
