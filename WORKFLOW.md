# Dev → Corp workflow (anti-drift, 2026-07-15)

The personal fork (`origin`, PUBLIC) is the **staging environment**; corp
(`corp`, StratusInfoSystems/stratus-bot-v2, private) is **production, deployed
only by Amir**. Everything flows dev-first, then corp, in this exact pipeline.
Each rule below exists because its violation caused a real incident (cited).

## The pipeline

```
worktree branch → implement → test sweep → scripts/deploy-dev.sh → live-verify
      → corp PR (worktree-split off corp base, parity-checked) → Amir merges
      → sync personal main same day → scripts/drift-check.sh converges to zero
```

## Rules

1. **Sessions work in git worktrees, never the entangled main tree.**
   (07-15: main tree carried an unrelated uncommitted feature all day.)
2. **Nothing deploys uncommitted. Deploy ONLY via `scripts/deploy-dev.sh`.**
   It refuses a dirty tree and logs `sha → wrangler version` to `deploys.log`.
   (07-15: an uncommitted deployed fix was silently reverted by the next deploy.)
3. **Dev is a real staging gate:** full `node --check` + suite sweep (bar: no
   NEW failures vs baseline) + live verification on chrisg-ec1 BEFORE any corp PR.
4. **Corp PRs use the worktree-split recipe:** fresh worktree off the corp base
   branch, cherry-pick/apply only your hunks, byte-parity check (`+/-` lines of
   the personal commit vs the corp commit must be identical), corp tree must
   parse as ESM (`cp src/index.js /tmp/x.mjs && node --check /tmp/x.mjs`), run
   corp's suites. Check base drift before opening (PR #21's base drifted 4
   commits mid-flight).
5. **Pushes to the public fork go through the pre-push hook** (secret scan of
   every pushed commit + HANDOFF-/PLAN-/EMAIL- doc blocklist). Install once per
   clone: `git config core.hooksPath scripts/githooks`.
   (06-10: leaked live credential; 07-15: customer-named doc needed a
   filter-branch to keep out.)
6. **Internal docs (HANDOFF-*, PLAN-*, EMAIL-*) stay untracked. Never commit.**
7. **After Amir merges a corp PR, sync personal main the same day** (merge the
   port branch). Personal main should always be: corp main minus not-yet-merged
   corp PRs, plus nothing.
8. **`scripts/drift-check.sh` at session start and before every corp PR.**
   Section 1 must list only files covered by open corp PRs; anything else is
   unexplained drift — stop and reconcile before adding more work.
9. **Extension bundle is part of "deployed":** after ext changes, run
   `chrome-extension/build-dev.sh` and reload 'Stratus AI (DEV)'.
   (07-15: pin fixes sat unshipped in a stale bundle for 2 hours.)
10. **Corp Cloudflare is read-only forever** (D1 SELECTs via the scoped key).
    Deploys, KV writes, secrets on corp = Amir.

## One-time setup per clone

```sh
git config core.hooksPath scripts/githooks
chmod +x scripts/githooks/pre-push scripts/deploy-dev.sh scripts/drift-check.sh
```
