# Stratus AI v1.29.12 source provenance

Recorded: 2026-09-01

## Canonical lineage

- Repository: `cjgraves1119/stratus-bot-v2`
- Remote `main` at reconciliation start: `919536bfd364a9d0db2b066ff0b8b77f2eeb4c7c` (extension v1.23.0)
- Reconciled v1.29.0 snapshot: `eaa8849678a9f7b40cc794e69f315ee1c698090d`
- v1.29.12 candidate: `852e117cbcdcc90ee20df85a0fa489b4868aca05`
- Candidate Git tree: `5d8a80f8e4edad9e88b6c139edbccf90582772a4`
- Baseline branch: `codex/reconcile-dev-1.29.12-20260901`
- Draft baseline PR: `#157`

The v1.29.12 candidate is 86 commits ahead and 0 behind the recorded `main` tip. It contains exactly 21 commits after the reconciled v1.29.0 snapshot. Package and extension manifest both declare `1.29.12`.

## Post-snapshot commits

1. `0682939` reconcile Worker quote behavior and product catalogs
2. `511a9db` add explicit reproducible 1.29 release targets
3. `a0af42f` enforce tests, scans, and locked dry-runs in CI
4. `0ef4fbd` through `852e117` add the reviewed One Shot, Gmail, editable-quote, tier-isolation, context, enrichment, and EOL follow-up changes represented by the remaining 18 commits

Use `git log --reverse --oneline eaa8849..852e117` for the exact immutable list. This document summarizes the lineage without rewriting it.

## Current CI evidence

GitHub checks on PR #157 completed successfully on 2026-09-01:

- Worker Build Check run `33472800468`: built-in secret-pattern scan, complete maintained Worker suite, extension tests plus reproducible build, and Wrangler dry-runs for `worker`, `worker-gchat`, and `worker-gateway`;
- Sync Check run `33472800465`;
- gitleaks runs `33472800491` and `33472785431`.

The maintained CI inventory covered 36 extension test files and 141 Worker test files. The production extension build was reproduced byte-identically, the snapshot-dev manifest was validated, and all three Wrangler checks were dry-runs only.

## Historical install comparison

The v1.29.0 reconciliation used an unchanged installed DEV artifact as comparison evidence. That historical comparison established editable-source lineage; it did not make the installed artifact canonical and does not prove that the v1.29.12 source is currently installed.

## Explicitly unproven states

- No immutable `ext-v1.29.12` tag exists.
- The protected release workflow has not produced or retained a signed CRX, release ZIP, provenance receipt, or published checksum for v1.29.12.
- No installed browser extension has been reloaded from this source and no installed ID/version/tree comparison is claimed.
- No Worker was deployed from this baseline and no live functional result is claimed.
- GitHub branch protection, required checks, tag immutability, and environment reviewers must be independently verified before approval.

This is source-lineage provenance only. Build, package, install, deploy, and live-runtime provenance require their own receipts and cannot be inferred from green source CI.
