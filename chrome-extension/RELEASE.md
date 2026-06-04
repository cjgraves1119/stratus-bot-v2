# Releasing the Stratus AI Chrome Extension (self-hosted auto-update)

The extension is **not** on the Chrome Web Store. It is self-hosted: a signed
CRX3 and a Chrome update manifest are published to **GitHub Pages**, and every
installed copy auto-updates from there with zero local-machine involvement.

```
manifest.json  ─ update_url ─►  https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml
update-manifest.xml ─ codebase ─►  https://cjgraves1119.github.io/stratus-bot-v2/stratus-ai-<version>.crx
```

Chrome polls the `update_url` on its own schedule (roughly every few hours).
When the manifest advertises a higher `version` than what is installed, Chrome
downloads the new `.crx`, verifies its signature, and updates silently.

The pipeline:

- `scripts/pack-crx.mjs` — the single source of truth. Reads `dist/` + an RSA
  private key, derives the extension ID, writes a signed **CRX3** and a matching
  `update-manifest.xml` into `release/`.
- `.github/workflows/release-extension.yml` — builds, signs, and deploys the two
  files to GitHub Pages on demand or on an `ext-v*` tag.
- `scripts/build-crx.sh` — thin local wrapper (build + pack) for manual
  inspection only. You normally never run it.

---

## The signing key controls the extension ID

The extension ID is derived from the **public half of the signing key**:
the first 16 bytes of `SHA-256(SubjectPublicKeyInfo DER)`, with each hex nibble
mapped `0-f → a-p`.

The stable ID for this extension is:

```
idkfeabnpcnpklbgknibidbgjcpbcmkh
```

That ID only comes from the **one original signing key**. As long as CI signs
with that key:

- the published ID stays `idkfe…`,
- `update-manifest.xml` advertises updates for the already-installed extension,
- everyone auto-updates.

**If that key is ever lost, the ID changes.** A new key produces a different ID,
which Chrome treats as a different extension — existing installs will *not*
auto-update to it. Recovery then requires a **one-time manual reinstall** by each
user (drag the new `.crx` into `chrome://extensions` once). So: **back up the key.**

> The packer prints a non-fatal warning whenever the derived ID is not `idkfe…`
> (e.g. when you sign with a throwaway test key locally). In CI that warning
> means the wrong secret is configured — fix it before shipping.

---

## (a) One-time setup

### 1. Add the signing key as a repo secret

From a checkout that has the **existing** signing key PEM (the one that yields
`idkfe…`), base64-encode it:

```sh
base64 -i key.pem | pbcopy        # macOS, copies to clipboard
# or: base64 -i key.pem            # then copy the output
```

Then in GitHub: **Settings → Secrets and variables → Actions → New repository
secret**

- **Name:** `EXT_SIGNING_KEY`
- **Value:** the base64 string from above

The workflow decodes this back to a PEM at runtime, signs with it, and deletes
it. The job **fails fast** if the secret is missing or is not a valid private
key PEM.

> Don't have the original key? Then you've lost the stable ID. Generate a fresh
> one with `openssl genrsa 2048 > key.pem`, store it as the secret, and accept
> that the published ID will change to whatever that key derives (run the packer
> once to see it) — every user must reinstall once. Update the `EXPECTED_ID`
> constant in `scripts/pack-crx.mjs` and the ID in this doc to the new value.

### 2. Enable GitHub Pages with the Actions source

GitHub: **Settings → Pages → Build and deployment → Source = "GitHub Actions"**.

Do **not** pick "Deploy from a branch" — this pipeline publishes via the Pages
deployment action, which requires the "GitHub Actions" source. The repo must be
public (or the org must have Pages enabled for private repos) for Chrome to
reach the files unauthenticated.

A `github-pages` environment is created automatically the first time the
workflow deploys.

---

## (b) Per release

1. **Bump the version** in `chrome-extension/manifest.json` (e.g. `1.12.3` →
   `1.12.4`). Chrome only updates to a strictly higher version, so this is
   required every release.
2. **Merge to `main`** (the version bump must be on the branch CI checks out).
3. **Trigger the release**, either:
   - **Actions → "Release Extension (CRX3 → Pages)" → Run workflow**, or
   - push a tag: `git tag ext-v1.12.4 && git push origin ext-v1.12.4`.

CI then builds, signs the CRX3, regenerates `update-manifest.xml` (with the real
ID + the new version + the Pages codebase URL), and publishes **only** those two
files to Pages. Installed extensions pick up the update on Chrome's next poll
(force it sooner via `chrome://extensions` → **Update**).

Verify after deploy:

```sh
curl -s https://cjgraves1119.github.io/stratus-bot-v2/update-manifest.xml
# appid should be idkfeabnpcnpklbgknibidbgjcpbcmkh and version should match.
```

---

## (c) First-time install (once per machine)

Auto-update only applies to an already-installed extension, so each user
installs once by hand:

1. Open `https://cjgraves1119.github.io/stratus-bot-v2/stratus-ai-<version>.crx`
   in Chrome to download the `.crx` (use the current version from the manifest).
2. Open `chrome://extensions`, enable **Developer mode** (top-right).
3. **Drag the downloaded `.crx` file onto the `chrome://extensions` page** and
   confirm. (Double-clicking the file is blocked by Chrome; drag-and-drop works.)

After that, every future release auto-updates — no further manual steps.

---

## Local inspection (optional, not a release path)

To produce a `.crx` locally for inspection (it will have a *different* ID
because you're not using the production key):

```sh
cd chrome-extension
openssl genrsa 2048 > /tmp/test-key.pem
npm run build
EXT_SIGNING_KEY_PEM_PATH=/tmp/test-key.pem npm run pack:crx
# or the all-in-one wrapper:
npm run build:crx -- --key /tmp/test-key.pem
```

Outputs land in `chrome-extension/release/` (gitignored). The CRX3 begins with
the bytes `Cr24` followed by format version `3`.

---

## Caveats / risks

- **Windows & managed Chrome block off-store extensions.** Self-hosted CRX
  auto-update works fine on **macOS** (and Linux), but on **Windows** and any
  enterprise-managed Chrome, off-store extensions are blocked unless allow-listed
  via enterprise policy (`ExtensionInstallAllowlist` / `ExtensionInstallForcelist`
  + a policy `update_url`). Stratus is macOS-first, so this is acceptable, but
  Windows users need a policy or they cannot install/update.
- **`CRX_REQUIRED_PROOF_MISSING`** can appear if a user tries to install the
  `.crx` without Developer mode enabled (Chrome wants a Web Store signature for
  normal installs). The drag-and-drop + Developer-mode flow above avoids it.
- **Update latency is Chrome's call.** Chrome decides when to poll the
  `update_url` (typically a few hours). Users can force it from
  `chrome://extensions`.
- **The key is the whole game.** Lose `EXT_SIGNING_KEY` and you lose the stable
  ID (forces a one-time reinstall for everyone). Leak it and someone else can
  publish a CRX that Chrome would accept as an update for this ID. Keep it only
  in the GitHub Actions secret and a secure backup; never commit it
  (`*.pem` is gitignored).
- **Pages serves the whole site.** The workflow stages a directory containing
  *only* `update-manifest.xml` + the `.crx`, so nothing else from the repo is
  exposed via Pages by this deploy.
