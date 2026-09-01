#!/bin/bash
# The ONLY sanctioned way to deploy worker-gchat to personal dev (chrisg-ec1).
# Exists because on 2026-07-15 a deploy from a tree with UNCOMMITTED fixes was
# silently reverted by the next session's deploy — deploys must be reproducible
# from git, full stop.
#
#   scripts/deploy-dev.sh            gate + deploy + provenance log
#   scripts/deploy-dev.sh --dry-run  gate + wrangler dry-run (no upload)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [ "$#" -gt 1 ]; then
  echo "Usage: scripts/deploy-dev.sh [--dry-run]" >&2
  exit 2
fi
MODE="deploy"
if [ "$#" -eq 1 ]; then
  case "$1" in
    --dry-run) MODE="--dry-run" ;;
    *)
      echo "REFUSED: unknown argument '$1'. Use --dry-run or no argument." >&2
      exit 2
      ;;
  esac
fi

# Git errors must abort under `set -e`; a failed status check is never clean.
DIRTY="$(git status --porcelain --untracked-files=all)"
if [ -n "$DIRTY" ]; then
  echo "REFUSED: uncommitted repository changes — commit first." >&2
  echo "$DIRTY" | head -10 >&2
  echo "Deploys must be reproducible from a clean commit; there is no dirty-tree override." >&2
  exit 1
fi
SOURCE_SHA="$(git rev-parse HEAD)"

# The sanctioned path owns its complete local safety gate so a future caller
# cannot accidentally rely on tests from an earlier source state.
node --check worker-gchat/src/index.js
node scripts/run-maintained-worker-tests.mjs >/dev/null
(cd chrome-extension && pnpm run test:all >/dev/null)
node scripts/scan-secrets.mjs >/dev/null

cd worker-gchat
if ! npx --no-install wrangler whoami >/dev/null 2>&1; then
  echo "REFUSED: Wrangler is not authenticated." >&2
  exit 1
fi

# Wrangler without --keep-vars makes committed [vars] authoritative. The live
# binding-name preflight must be reviewed before deployment; secret bindings are
# preserved by Cloudflare independently of plaintext vars.
npx --no-install wrangler deploy --dry-run
if [ "$MODE" = "--dry-run" ]; then
  exit 0
fi

# The full gate can take several minutes. Refuse if any file or HEAD changed
# while it ran, so the uploaded bytes and recorded commit are the exact source
# snapshot that passed the tests above.
PREUPLOAD_DIRTY="$(git status --porcelain --untracked-files=all)"
PREUPLOAD_SHA="$(git rev-parse HEAD)"
if [ -n "$PREUPLOAD_DIRTY" ] || [ "$PREUPLOAD_SHA" != "$SOURCE_SHA" ]; then
  echo "REFUSED: repository changed during the DEV release gate; start again from a stable clean commit." >&2
  exit 1
fi

EXPECTED="${EXPECTED_LIVE_VERSION:-}"
if [[ ! "$EXPECTED" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]]; then
  echo "REFUSED: set EXPECTED_LIVE_VERSION to the reviewed current 100% DEV version UUID." >&2
  exit 1
fi

STATUS_OUT="$(npx --no-install wrangler deployments status 2>&1)" || { echo "$STATUS_OUT" >&2; exit 1; }
LIVE_VERSION="$(printf '%s\n' "$STATUS_OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/Version\(s\):\s+\(100%\)\s+([0-9a-f-]{36})/i);process.stdout.write(m?.[1]||"");})')"
if [ -z "$LIVE_VERSION" ] || [ "$LIVE_VERSION" != "$EXPECTED" ]; then
  echo "REFUSED: live DEV drifted (expected $EXPECTED, observed ${LIVE_VERSION:-unreadable})." >&2
  exit 1
fi

OUT="$(npx --no-install wrangler deploy --strict 2>&1)" || { echo "$OUT" >&2; exit 1; }
printf '%s\n' "$OUT" | tail -4
VER="$(printf '%s\n' "$OUT" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/Version ID:\s*([0-9a-f-]{36})/i);process.stdout.write(m?.[1]||"");})')"

POST_STATUS=""
if POST_STATUS="$(npx --no-install wrangler deployments status 2>&1)"; then
  POST_VERSION="$(printf '%s\n' "$POST_STATUS" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/Version\(s\):\s+\(100%\)\s+([0-9a-f-]{36})/i);process.stdout.write(m?.[1]||"");})')"
else
  POST_VERSION=""
fi
if [ -z "$VER" ]; then VER="$POST_VERSION"; fi

echo "$(date -u +%FT%TZ) sha=$SOURCE_SHA previous=$LIVE_VERSION version=${VER:-unknown}" >> "$ROOT/deploys.log"
echo "provenance: sha=$SOURCE_SHA previous=$LIVE_VERSION -> version=${VER:-unknown} (deploys.log)"
if [ -z "$VER" ] || [ -z "$POST_VERSION" ] || [ "$POST_VERSION" != "$VER" ]; then
  echo "WARNING: upload returned, but the active version could not be verified. Check deployments status before any retry." >&2
  exit 1
fi
