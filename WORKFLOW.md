# Stratus source, release, and deployment workflow

Updated: 2026-09-01

This public repository is a source and staging control plane. A source PR, extension release, personal/staging Worker deployment, corporate deployment, and installed-browser update are separate actions with separate evidence and authority.

## Source changes

1. Work in an isolated Git worktree from an explicitly verified base.
2. Keep baseline reconciliation separate from focused feature changes.
3. Run the maintained suites, secret scans, sync checks, reproducible extension build, and locked Wrangler dry-runs before review.
4. Open a draft PR when provenance, governance, review, release, installation, or deployment evidence is incomplete.
5. Source-only PRs do not require a Worker deployment or browser reload. They must state `NOT-DEPLOYED` and `NOT-INSTALLED` rather than treating those checks as failed or implied.
6. Never commit customer data, credentials, browser state, raw handoffs, or internal email/plan artifacts.

## GitHub governance gate

Before `main` can be a release source, independently verify:

- branch protection or a repository ruleset applies to `main`;
- required checks include the Worker build/test matrix, extension reproducible build, sync check, and gitleaks;
- force-push and branch deletion are disabled;
- `ext-v*` tags cannot be moved or deleted through ordinary contributor permissions;
- production environments require designated human reviewers;
- the baseline PR has independent owner review appropriate to its full changed-file scope.

Repository connection or write permission is not evidence that these controls exist.

## Extension release

After the approved source baseline is merged:

1. create the immutable version tag at the exact protected `main` tip;
2. invoke the reviewed manual release workflow with the matching tag/version;
3. retain the CRX or package, embedded provenance, checksum manifest, build/tree hashes, and workflow run IDs;
4. verify published update metadata separately;
5. install or reload only when the current task authorizes the exact browser/profile target;
6. record installed extension ID, version, artifact hash, source commit, and focused runtime results.

DEV snapshot builds are evidence/runtime-test artifacts and are not release eligible.

## Worker deployment

Worker deployment is never implied by a source PR or Wrangler dry-run. It requires explicit approval for the exact account, Worker, environment, bindings, and commit. Use the reviewed workflow or repository deploy script; never reconstruct authorization from local config files or use raw token upload commands.

Retain deployment/version IDs, binding verification, rollback target, and sanitized live checks. Corporate Cloudflare remains outside this repository's standing mutation authority unless the current task names the authorized operator and exact target.

## Historical personal/corporate flow

Older instructions described a personal staging fork followed by a separately controlled corporate repository. Preserve that ownership separation where it still exists, but do not assume names, remotes, operators, or deployment authority from historical documentation. Reverify them for every release or deployment task.
