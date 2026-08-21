# Stratus AI extension release process

The canonical repository contains one editable extension source tree. Production,
personal snapshot DEV, and team DEV are build targets from that source; they
are not forks and must never be maintained as copied/minified extension folders.

## Required toolchain

- Node.js `24.19.0`
- pnpm `11.19.0`
- `chrome-extension/pnpm-lock.yaml` with `pnpm install --frozen-lockfile --ignore-scripts`

`package-lock.json` is intentionally absent. Build commands run the exact
toolchain check before webpack.

## Atomic targets

| Target | Branding | API origin | `update_url` | Permitted use |
|---|---|---|---|---|
| `prod` | Stratus AI | reviewed production gateway in `release-targets.cjs` | production Pages feed | reviewed production release |
| `snapshot-dev` | Stratus AI (DEV) | reviewed personal DEV gateway | absent | local DEV testing and artifact lineage evidence only |
| `team-dev` | Stratus AI (TEAM DEV) | explicit reviewed team origin | absent | future sanitized team package |

One named target selects API origin, runtime environment, branding, host
permission, and update behavior together. Legacy `STRATUS_API_BASE` and
`STRATUS_ENV` overrides fail closed because they could mix those decisions.
There is intentionally no ambiguous `pnpm dev` shortcut. Use the explicitly
named `pnpm run dev:snapshot` only for reviewed personal DEV work, or
`pnpm run dev:team` after the separate team gateway has been approved.

The team DEV gateway is not yet authoritative. `APPROVED_TEAM_DEV_API_BASES` is
therefore empty, so `pnpm run build:team-dev` intentionally fails. A future PR
must add the reviewed team gateway origin to that allowlist. The build still
requires the same origin through `STRATUS_TEAM_DEV_API_BASE` and rejects the
production origin. Do not infer that the historical `it-262` host is the team
gateway.

## Build commands

```sh
cd chrome-extension
pnpm install --frozen-lockfile --ignore-scripts
pnpm run build:prod
pnpm run build:snapshot-dev
pnpm run test:all
```

`build-dev.sh` is a repository-local wrapper for `build:snapshot-dev`. It does
not copy into an installed extension, another project, or a browser profile.

Production and team DEV builds omit source maps. The snapshot target retains
source maps solely so reviewed personal DEV source can be compared with the
installed evidence artifact. Snapshot DEV also removes the production
`update_url`; that intentional manifest safety delta means a post-reconciliation
snapshot is not expected to be byte-identical to the installed manifest.

## Release gates

Before any package is generated, all of these must be true:

1. The exact source commit has been reviewed and all maintained tests, Worker
   dry-runs, and the secret scan are green.
2. The version in `package.json` and the canonical production `manifest.json`
   matches the release version.
3. The checkout is clean and exactly equals a full 40-character reviewed commit.
4. An exact versioned tag points to that commit:
   - production: `ext-v<version>`
   - team DEV: `ext-team-dev-v<version>`
5. For team DEV, a separate gateway is reviewed and committed to the allowlist.
6. Production signing uses the key that derives the stable self-hosted ID
   `haangicfjfkenoilhdadbnljcacighih`.

Repository policy is part of the release gate, not an assumption: protect
`main`, require the source-build, complete test, sync, and gitleaks checks,
disable force-pushes, protect `ext-v*` tags from movement/deletion, and require
reviewers on both `github-pages` and `cloudflare-production` environments. The
manual workflows additionally require the exact current `main` tip; a branch or
older repository commit cannot be released or deployed.

Configure `CLOUDFLARE_API_TOKEN` only as a secret on the protected
`cloudflare-production` environment, not as a repository-wide secret. It is
referenced only by the three post-preflight deployment steps.

The historical Chrome Web Store ID `idkfeabnpcnpklbgknibidbgjcpbcmkh`
belongs to an older distribution channel. The unpacked local ID
`fkopkkoaedjgkcdhgblkoaaicmkpnhhb` is path/key dependent and is not a release
identity. Neither should replace the stable self-hosted ID.

## Reproducible sanitized artifacts

`scripts/release-artifact.mjs` is shared by production and team packaging. It:

- accepts only the reviewed extension artifact allowlist;
- rejects symlinks, source maps, environments, dependencies, Wrangler state,
  backups, existing packages, and unexpected paths;
- requires every runtime entry bundle, HTML shell, helper, style, and icon;
- rematerializes `node_modules` from the frozen offline pnpm store before build;
- writes the ZIP with reviewed Node code using sorted members, STORE mode,
  normalized Unix file modes, and a fixed timestamp rather than a host `zip`;
- embeds `STRATUS-PROVENANCE.json` with version, target, exact commit/tag,
  API origin, toolchain, lockfile hash, file inventory, and sanitized tree hash;
- emits a provenance sidecar and SHA-256 checksum manifest.

Synthetic tests exercise exclusion, provenance, and two-run ZIP determinism.
They do not generate or publish a real Stratus package.

Both package entry points first verify an exact clean commit/tag and then invoke
the named build themselves. They recheck Git after the build and never stamp a
pre-existing or ignored `dist/` directory as belonging to the reviewed commit.

`pnpm run test:all` prints the complete maintained extension-test inventory
before running it. The production workflow uses that dynamic inventory so a new
test cannot be silently omitted from the release gate.

For a future approved team DEV package:

```sh
STRATUS_TEAM_DEV_API_BASE=https://reviewed-team-gateway.example.workers.dev \
  pnpm run build:team-dev
STRATUS_RELEASE_COMMIT=<full-reviewed-sha> \
STRATUS_RELEASE_TAG=ext-team-dev-v<version> \
STRATUS_TEAM_DEV_API_BASE=https://reviewed-team-gateway.example.workers.dev \
  pnpm run package:team-dev
```

The placeholders are deliberate. Do not run this until the source and gateway
gates are met. Never package the installed/minified extension folder.

## Production workflow

The `Release Extension` GitHub Actions workflow is manual-only. It requires the
exact current protected-`main` SHA and matching immutable `ext-v<version>` tag.
It runs in three boundaries:

1. a no-secret verifier reruns the full extension and Worker suites, two-build
   comparison, catalog sync, all three Wrangler dry-runs, and gitleaks;
2. a second no-secret runner rebuilds and uploads only a sanitized, hash-bound
   unsigned payload plus receipt;
3. a fresh protected-environment runner verifies the transferred payload, then
   exposes the signing key only to the built-in-Node CRX signer. No package
   manager, webpack loader, or build dependency runs on that signing runner.

The signer verifies the stable extension ID and checksums, then stages only:

- `stratus-ai-<version>.crx`
- `update-manifest.xml`
- `stratus-ai-<version>.provenance.json`
- `SHA256SUMS`

The protected tag ruleset and environment reviewer settings are external
controls and must be confirmed before a production GO. Never move an existing
release tag or use the workflow to roll back the published version. A workflow
run, build, or dry-run is not proof that a browser updated; installed browser
state requires a separate authorized verification.

Configure `EXT_SIGNING_KEY` specifically as a `github-pages` environment
secret, never as a repository-wide Actions secret, and retain only a secure
offline backup. Checkout credentials are not persisted on the signing runner.
The packer hard-fails if the key derives any ID other than the stable production
ID. Every third-party Action is pinned to a reviewed full commit SHA; deliberate
upgrades must resolve and review a new SHA rather than restoring a floating tag.
