#!/bin/bash
# Build the DEV extension and sync it to the separate "Stratus AI (DEV)" load folder.
# Points at your personal worker by default. To point at a different worker:
#   STRATUS_API_BASE="https://stratus-ai-bot-gateway.it-262.workers.dev" ./build-dev.sh
set -e
cd "$(dirname "$0")"

API="${STRATUS_API_BASE:-https://stratus-ai-bot-gateway.chrisg-ec1.workers.dev}"
DEST="$HOME/Documents/Claude/Projects/Bots/stratus-bot-v2-DEV/chrome-extension"

STRATUS_API_BASE="$API" STRATUS_ENV=dev npm run build

mkdir -p "$DEST"
rm -rf "$DEST/dist"
cp -R dist "$DEST/dist"
# Rename so chrome://extensions shows it as "Stratus AI (DEV)" (distinct from the Web Store one)
perl -pi -e 's/"name":\s*"Stratus AI"/"name": "Stratus AI (DEV)"/' "$DEST/dist/manifest.json"

echo ""
echo "DEV build synced -> $DEST/dist"
echo "API base: $API"
echo "Now click reload on the 'Stratus AI (DEV)' card in chrome://extensions."
