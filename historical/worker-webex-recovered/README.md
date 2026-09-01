# Historical compiled Webex Worker evidence — non-deployable

This directory is quarantined historical evidence recovered from a live Cloudflare deployment in August 2026. `src/index.js` is a compiled/live-derived bundle, not the canonical modular Worker source.

## Boundary

- Excluded from maintained Worker test discovery and Wrangler dry-runs.
- Not a release, deployment, rollback, or source-edit target.
- `wrangler.toml.historical-disabled` is retained only to explain prior bindings; its disabled filename is intentional and it must never be passed to Wrangler.
- The configuration is incomplete and cannot safely reproduce live variables, secrets, or bindings.
- No raw-token extraction, API upload, secret recreation, or deployment instructions are retained here.

The bundle may be used read-only to compare historical behavior while locating the canonical modular source. Findings must be reproduced against maintained source and tests before they influence a release decision.

If canonical source is confirmed to supersede every useful behavior in this bundle, remove the quarantine in a separately reviewed history-cleanup change. Until then, its presence is historical evidence only and must not be mistaken for a deployable Worker.
