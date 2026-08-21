#!/bin/bash
# Rebuild the historical 1.29.0 DEV snapshot inside this checkout only.
# This never copies into an installed extension and never reloads a browser.
set -euo pipefail
cd "$(dirname "$0")"

pnpm run build:snapshot-dev

echo "Snapshot DEV build complete: $(pwd)/dist"
echo "No installed extension or external project was modified."
echo "Use the reviewed team-dev release process for team packaging; do not distribute this snapshot target."
