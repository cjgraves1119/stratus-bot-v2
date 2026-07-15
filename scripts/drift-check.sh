#!/bin/bash
# One-command drift report: personal main vs corp main vs local HEAD vs what's
# actually deployed/installed. Run at session start and before any corp PR.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git fetch origin main -q 2>/dev/null || echo "(warn: origin fetch failed)"
git fetch corp main -q 2>/dev/null || echo "(warn: corp fetch failed)"

echo "== 1. personal main vs corp main — shared source paths =="
DRIFT="$(git diff --name-only origin/main corp/main -- worker-gchat/src worker/src chrome-extension/src 2>/dev/null)"
if [ -z "$DRIFT" ]; then
  echo "   CONVERGED (no file-level drift in shipped source)"
else
  echo "$DRIFT" | sed 's/^/   /'
  git diff --shortstat origin/main corp/main -- worker-gchat/src worker/src chrome-extension/src | sed 's/^/   /'
  echo "   ^ expected while corp PRs are unmerged; anything here with NO open corp PR is real drift."
fi

echo "== 2. local HEAD vs personal main =="
AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo '?')"
BEHIND="$(git rev-list --count HEAD..origin/main 2>/dev/null || echo '?')"
echo "   ahead $AHEAD / behind $BEHIND ($(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD))"
[ "$BEHIND" != "0" ] && echo "   ^ BEHIND main — rebase/merge before deploying, or you will revert main's work"

echo "== 3. uncommitted shipped source (the 07-15 silent-revert hazard) =="
DIRTY="$(git status --porcelain -- worker-gchat/src chrome-extension/src worker/src)"
if [ -z "$DIRTY" ]; then echo "   clean"; else echo "$DIRTY" | sed 's/^/   /'; echo "   ^ COMMIT OR STASH before any deploy"; fi

echo "== 4. last dev deploy vs HEAD =="
if [ -f deploys.log ]; then
  LAST="$(tail -1 deploys.log)"
  echo "   $LAST"
  DEPLOYED_SHA="$(echo "$LAST" | grep -oE 'sha=[0-9a-f]+' | cut -d= -f2)"
  if [ -n "$DEPLOYED_SHA" ] && ! git merge-base --is-ancestor "$DEPLOYED_SHA" HEAD 2>/dev/null; then
    echo "   ^ deployed commit is NOT in HEAD's history — a deploy would REVERT live code"
  fi
else
  echo "   no deploys.log yet (first deploy via scripts/deploy-dev.sh will create it)"
fi

echo "== 5. DEV extension bundle staleness =="
SRC_V="$(grep -o '"version": *"[^"]*"' chrome-extension/manifest.json | head -1 | grep -o '[0-9.]*')"
DEV_MANIFEST="$HOME/Documents/Claude/Projects/Bots/stratus-bot-v2-DEV/chrome-extension/dist/manifest.json"
DEV_V="$( [ -f "$DEV_MANIFEST" ] && grep -o '"version": *"[^"]*"' "$DEV_MANIFEST" | head -1 | grep -o '[0-9.]*' )"
echo "   source=$SRC_V installed=${DEV_V:-missing}"
[ "$SRC_V" != "${DEV_V:-}" ] && echo "   ^ STALE — run chrome-extension/build-dev.sh then reload 'Stratus AI (DEV)'"

exit 0
