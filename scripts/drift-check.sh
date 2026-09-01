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
DEV_MANIFEST="$HOME/Documents/Stratus extensions/stratus bot dev/manifest.json"
DEV_V="$( [ -f "$DEV_MANIFEST" ] && grep -o '"version": *"[^"]*"' "$DEV_MANIFEST" | head -1 | grep -o '[0-9.]*' )"
echo "   source=$SRC_V installed=${DEV_V:-missing}"
[ "$SRC_V" != "${DEV_V:-}" ] && echo "   ^ STALE — build snapshot-dev, sync the reviewed unpacked target, then reload 'Stratus AI (DEV)'"

echo "== 6. corp PR audit (merged-into-branch trap — the #21/#22 failure) =="
if command -v gh >/dev/null 2>&1; then
  PRS="$(gh pr list -R StratusInfoSystems/stratus-bot-v2 --state all --limit 20 \
        --json number,state,baseRefName,headRefName \
        --template '{{range .}}{{.number}} {{.state}} base={{.baseRefName}} head={{.headRefName}}{{"\n"}}{{end}}' 2>/dev/null)"
  if [ -n "$PRS" ]; then
    echo "$PRS" | sed 's/^/   /'
    echo "$PRS" | awk '$2=="MERGED" && $3!="base=main" {print "   ^ SCREAM: PR #"$1" MERGED into a BRANCH, not main — nothing reached corp prod"}'
    echo "$PRS" | awk '$2=="OPEN" && $3!="base=main" {print "   ^ WARN: open PR #"$1" does not target main"}'
  else
    echo "   (gh query failed — check gh auth)"
  fi
else
  echo "   (gh not installed — cannot audit corp PR state)"
fi

echo "== 7. corp PR-branch ancestry (WORKFLOW rule 4, mechanized) =="
for B in $(git branch -r --list 'corp/fix/*' 'corp/feat/*' | tr -d ' '); do
  ANC="ok"
  git merge-base --is-ancestor corp/main "$B" 2>/dev/null || ANC="NOT-corp-based"
  FOREIGN=""
  git merge-base --is-ancestor origin/main "$B" 2>/dev/null && FOREIGN=" +CONTAINS-personal-main"
  if [ "$ANC" != "ok" ] || [ -n "$FOREIGN" ]; then
    echo "   SCREAM: $B  [$ANC$FOREIGN] — rebuild via worktree-split off corp/main before Amir merges"
  fi
done
echo "   (silence above = all corp branches clean)"

echo "== 8. extension version monotonicity vs corp Web Store line =="
CORP_V="$(git show corp/main:chrome-extension/manifest.json 2>/dev/null | grep -o '"version"[^,]*' | grep -o '[0-9.]*' | head -1)"
LOCAL_V="$(grep -o '"version"[^,]*' chrome-extension/manifest.json | grep -o '[0-9.]*' | head -1)"
echo "   corp/main=$CORP_V  local=$LOCAL_V"
if [ -n "$CORP_V" ] && [ -n "$LOCAL_V" ] && [ "$(printf '%s\n%s\n' "$CORP_V" "$LOCAL_V" | sort -V | tail -1)" = "$CORP_V" ] && [ "$CORP_V" != "$LOCAL_V" ]; then
  echo "   ^ SCREAM: local manifest sorts BELOW corp Web Store $CORP_V — a corp port from this tree would DOWNGRADE (Web Store rejects); hand-bump above $CORP_V"
fi

echo "== 9. live worker vs deploys.log (out-of-band/bundle deploy detector) =="
if [ -f ~/.stratus-personal-credentials ] && [ -f deploys.log ]; then
  # shellcheck disable=SC1090
  source ~/.stratus-personal-credentials 2>/dev/null
  LIVE_ID="$(cd worker-gchat 2>/dev/null && npx --no-install wrangler deployments status 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const m=s.match(/Version\(s\):\s+\(100%\)\s+([0-9a-f-]{36})/i);process.stdout.write((m?.[1]||"").slice(0,8));})')"
  LOGGED_ID="$(tail -1 deploys.log | grep -oE 'version=[0-9a-f-]+' | cut -d= -f2 | cut -c1-8)"
  echo "   live=$LIVE_ID  last-logged=$LOGGED_ID"
  if [ -n "$LIVE_ID" ] && [ -n "$LOGGED_ID" ] && [ "$LIVE_ID" != "$LOGGED_ID" ]; then
    echo "   ^ SCREAM: live deployment was NOT made via deploy-dev.sh (out-of-band wrangler or bundle content-deploy) — reconcile source before ANY deploy or you will revert live code"
  fi
else
  echo "   (skipped: needs ~/.stratus-personal-credentials + deploys.log)"
fi
