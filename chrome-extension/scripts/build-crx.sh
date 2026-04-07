#!/bin/bash
# Build and package the Stratus AI Chrome Extension as a .crx file
# Usage: bash scripts/build-crx.sh [--key path/to/key.pem]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_DIR="$(dirname "$SCRIPT_DIR")"
DIST_DIR="$EXT_DIR/dist"
RELEASE_DIR="$EXT_DIR/release"

# Parse arguments
KEY_FILE=""
while [[ $# -gt 0 ]]; do
  case $1 in
    --key) KEY_FILE="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

echo "╔═══════════════════════════════════════╗"
echo "║   Stratus AI Chrome Extension Build   ║"
echo "╚═══════════════════════════════════════╝"

# Step 1: Build with webpack
echo ""
echo "→ Building with webpack..."
cd "$EXT_DIR"
npm run build

# Step 2: Create release directory
mkdir -p "$RELEASE_DIR"

# Step 3: Get version from manifest
VERSION=$(node -e "console.log(require('./dist/manifest.json').version)")
echo "→ Version: $VERSION"

# Step 4: Create zip (for Chrome Web Store or manual distribution)
ZIP_FILE="$RELEASE_DIR/stratus-ai-${VERSION}.zip"
cd "$DIST_DIR"
zip -r "$ZIP_FILE" . -x "*.map"
echo "→ Created: $ZIP_FILE"

# Step 5: Create .crx if key provided
if [ -n "$KEY_FILE" ] && [ -f "$KEY_FILE" ]; then
  echo "→ Signing .crx with key: $KEY_FILE"

  # Chrome's crx format requires specific packaging
  # For self-hosted distribution, the zip + update_url approach works too
  CRX_FILE="$RELEASE_DIR/stratus-ai-${VERSION}.crx"

  # Use Chrome to pack if available, otherwise just use zip
  if command -v google-chrome &> /dev/null; then
    google-chrome --pack-extension="$DIST_DIR" --pack-extension-key="$KEY_FILE" 2>/dev/null || true
    [ -f "$DIST_DIR.crx" ] && mv "$DIST_DIR.crx" "$CRX_FILE"
  elif command -v chromium-browser &> /dev/null; then
    chromium-browser --pack-extension="$DIST_DIR" --pack-extension-key="$KEY_FILE" 2>/dev/null || true
    [ -f "$DIST_DIR.crx" ] && mv "$DIST_DIR.crx" "$CRX_FILE"
  else
    echo "  ⚠ Chrome/Chromium not found. Using zip as fallback."
    cp "$ZIP_FILE" "$CRX_FILE"
  fi

  [ -f "$CRX_FILE" ] && echo "→ Created: $CRX_FILE"
fi

# Step 6: Generate update manifest XML
echo "→ Generating update manifest..."
cat > "$RELEASE_DIR/update-manifest.xml" << EOF
<?xml version='1.0' encoding='UTF-8'?>
<gupdate xmlns='http://www.google.com/update2/response' protocol='2.0'>
  <app appid='EXTENSION_ID_PLACEHOLDER'>
    <updatecheck codebase='https://github.com/cjgraves1119/stratus-bot-v2/releases/download/v${VERSION}/stratus-ai-${VERSION}.zip' version='${VERSION}' />
  </app>
</gupdate>
EOF
echo "→ Created: $RELEASE_DIR/update-manifest.xml"

echo ""
echo "✓ Build complete!"
echo "  Zip:    $ZIP_FILE"
echo "  Update: $RELEASE_DIR/update-manifest.xml"
echo ""
echo "Next steps:"
echo "  1. Load unpacked from dist/ for testing: chrome://extensions"
echo "  2. Create GitHub Release with the .zip file attached"
echo "  3. Update the appid in update-manifest.xml with your extension ID"
