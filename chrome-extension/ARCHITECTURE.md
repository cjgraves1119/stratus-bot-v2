# Stratus AI Chrome extension architecture

## Source and runtime

This Manifest V3 extension is an editable webpack/React application. The same
source supports Chrome, Comet, and Chromium browsers. Its major runtime pieces
are:

- `src/background/`: service worker, API routing, CRM/auth operations, and
  cross-surface messaging;
- `src/content/`: Gmail and Zoho content scripts;
- `src/sidebar/`: React chat, CRM, quote, and task interfaces;
- `src/popup/` and `src/options/`: browser action and settings interfaces;
- `src/lib/`: shared configuration, storage, quote, catalog, and context logic;
- `public/`: static HTML shells and cart/task helper scripts.

Webpack emits the unpacked extension to `dist/`. Compiled output, dependencies,
browser-installed copies, environment files, Wrangler state, and release
packages are not source and are excluded from Git.

## API path

All extension API calls use the single `API_BASE` compiled into the bundle. The
value has no runtime or personal-gateway fallback. `release-targets.cjs` resolves
it together with branding, environment label, manifest host permission, and
update behavior.

```text
named target
    ├── API origin
    ├── prod/DEV runtime flag
    ├── extension name and action title
    ├── one Workers host permission
    └── production update feed present/absent
```

This prevents independent flags from silently mixing branding, gateways, and
update behavior. The explicitly named `snapshot-dev` evidence target retains
the historical production gateway so its executable output can be compared to
the installed 1.29.0 evidence; it is not distributable. The `team-dev` target
fails closed unless a distinct reviewed gateway is selected. Neither DEV target
inherits the production auto-update feed.

## Target roles

The root `manifest.json` is the canonical production manifest. Build-time
manifest transformation is narrow and deterministic:

- `prod` preserves production branding and update feed;
- `snapshot-dev` reconstructs the historical DEV runtime for evidence work but
  removes the update feed and is deliberately named at every build/watch call;
- `team-dev` uses separate team branding and a separately approved gateway.

The historical snapshot and future team package are products of the reviewed
commit, never separate source directories. See `RELEASE.md` for the current
team-gateway blocker and packaging gates.

## Build and release boundary

Node `24.19.0`, pnpm `11.19.0`, and `pnpm-lock.yaml` define the extension
toolchain. Production/team packages exclude source maps. The sanitizer accepts
only the expected manifest, bundles, styles, HTML, licenses, and four icon
files; any unexpected path or symlink fails the package.

Each distributable carries embedded provenance and published SHA-256 hashes.
Production self-update additionally requires the signing key for extension ID
`haangicfjfkenoilhdadbnljcacighih`. Team DEV has no production `update_url` and
must not reuse the production gateway.

Production preparation and signing use separate ephemeral CI runners. The
no-secret runner rebuilds and hash-binds the sanitized payload; a fresh
protected runner downloads and verifies it before key access, then runs only
the built-in-Node signer. Build dependencies never execute in the key-bearing
runner.

Worker deployment is a separate manual-only workflow. Building or packaging an
extension never deploys a Worker, reloads a browser, or changes CRM/browser data.
The workflow compiles all three coupled Workers in dry-run mode before its first
deployment command. Cloudflare does not provide a single atomic transaction
across the three Worker services, so protected-environment approval and an
operator rollback plan remain mandatory for the separately authorized deploy.

## Security boundaries

- OAuth tokens, API keys, Worker secrets, environment files, and signing keys
  are never part of the extension source or package.
- Zoho writes remain explicit user actions in the runtime; build scripts do not
  access Zoho, Gmail, CRM, or browser state.
- Customer-facing UI must not expose margin or margin percentage.
- Local QA harness output is written to `harness-dist/`, outside `dist/`.
- The QA harness has no implicit gateway. `build:harness:team` uses the
  fail-closed reviewed team target; `build:harness:snapshot-evidence` is named
  explicitly because it reproduces the historical production-gateway path and
  is only for controlled lineage comparison.
- Installed/minified copies are evidence or deployment outputs, never editable
  inputs.

## Verification layers

Release review distinguishes four claims:

1. source tests passed;
2. webpack and Wrangler dry-runs built locally;
3. a sanitized package was generated from an exact commit/tag;
4. a browser or Worker was actually deployed and verified.

Earlier layers do not prove later ones. Browser reloads and Cloudflare deploys
always require separate authorization and post-state evidence.
