#!/bin/bash
# The ONLY sanctioned way to deploy worker-gchat to personal dev (chrisg-ec1).
# Exists because on 2026-07-15 a deploy from a tree with UNCOMMITTED fixes was
# silently reverted by the next session's deploy — deploys must be reproducible
# from git, full stop.
#
#   scripts/deploy-dev.sh            gate + deploy + provenance log
#   scripts/deploy-dev.sh --dry-run  gate + wrangler dry-run (no upload)
#   ALLOW_DIRTY=1 scripts/deploy-dev.sh   escape hatch (logs the dirty state)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DIRTY="$(git status --porcelain -- worker-gchat/src chrome-extension/src worker/src 2>/dev/null || true)"
if [ -n "$DIRTY" ] && [ "${ALLOW_DIRTY:-0}" != "1" ]; then
  echo "REFUSED: uncommitted changes in shipped source paths — commit first." >&2
  echo "$DIRTY" | head -10 >&2
  echo "(Deploys must be reproducible from a commit. ALLOW_DIRTY=1 to override — the override is itself logged.)" >&2
  exit 1
fi

cd worker-gchat
node --check src/index.js
# Fast regression gate — the suite covering the active fix batch.
if [ -f test-corp-error-reports-2026-07-15.js ]; then
  node test-corp-error-reports-2026-07-15.js >/dev/null || { echo "REFUSED: regression suite red" >&2; exit 1; }
fi

# shellcheck disable=SC1090
source ~/.stratus-personal-credentials
if [ "${1:-}" = "--dry-run" ]; then
  npx wrangler deploy --dry-run
  exit 0
fi
OUT="$(npx wrangler deploy 2>&1)" || { echo "$OUT" >&2; exit 1; }
echo "$OUT" | tail -4
VER="$(echo "$OUT" | grep -oiE 'Version ID: [a-f0-9-]+' | awk '{print $3}' | head -1)"
SHA="$(git rev-parse --short HEAD)"
FLAG=""; [ -n "$DIRTY" ] && FLAG=" DIRTY-OVERRIDE"
echo "$(date -u +%FT%TZ) sha=$SHA version=${VER:-unknown}$FLAG" >> "$ROOT/deploys.log"
echo "provenance: sha=$SHA -> version=${VER:-unknown} (deploys.log)"
