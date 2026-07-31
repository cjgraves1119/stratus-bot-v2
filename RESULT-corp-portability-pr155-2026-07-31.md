# PR #155 — Corporate Portability & Production-Readiness Package (2026-07-31)

Scope: evidence-backed review of PR #155 (`e19b545`) for porting to the Corp Edition
(`StratusInfoSystems/stratus-bot-v2`, private — NOT accessed; all corp-side evidence
comes from the deployed corp worker bundle fetched read-only from the corp Cloudflare
account, corp D1 rows, and the email thread record). Nothing was merged, deployed,
or modified in any corporate resource.

Review method: 3 tracks — (1) adversarial diff review, (2) config/build/deploy
divergence sweep, (3) corp-bundle anchor verification. Tracks 1–2 ran as independent
Claude reviewers (Codex MCP bridge is not reachable from this remote session; a
ready-to-paste Codex packet is included at the end for the true third voice).

## A. Per-fix portability verdicts (corp-bundle line refs = deployed SHA 6d4b98e era)

| # | Fix (PR #155 hunk) | Corp anchor evidence | Verdict |
|---|---|---|---|
| 1 | `SKU,qty` pair parser (worker-gchat + worker) | Corp has the IDENTICAL vulnerable branch: `commaParts` split + qty-first `m3` (corp 14566), multi-line `csvMatch` (14523) | **Clean port** — corp is currently exposed to the same shift-by-one |
| 2 | Continuation-turn classifier rule | Corp `classifyCrmIntent` (25813) already computes on stripped `_userText`; ctx flags identical at callsite (27716–17). Corp's #31 incident routed into corp's `subscription` subset (update/search/get/reterm/PO = exactly that subset) | **Port the rule + patch corp's EXISTING strip in place** (add the `Active Zoho page` line-strip and the un-closed `[Email body:` tail-strip from round 2). NEVER add a second `stripInjectedClassifierContext` definition — duplicate module-scope declarations are a parse-time SyntaxError that kills the whole worker at deploy |
| 3a | `Quote_Stage` server-side default on create | Corp validator (17906) has NO default (no "Quote_Stage missing on create" anywhere in bundle); corp relies on prompt template only (25984) — which failed (report #39) | **Clean port** |
| 3b | Deterministic payload `Quote_Stage` + term-stamped Subject | Corp `quoteData` (23241) identical shape except Subject uses conditional `skuSummary` suffix — one-line anchor adaptation | **Port with trivial adaptation** |
| 3c | Quotes field-list `Stage`→`Quote_Stage` | Corp ALREADY fixed (20575 etc. — Amir's fix; this hunk was personal-repo catch-up) | **Skip on corp** (already present) |
| 4 | `isPlaceholderName` hardening (undefined/null/NaN, any casing, punctuation-only) | Corp already defines the function (17091) AND already guards the deterministic intake (22382/22391) — the 07-30 "undefined" Account happened because corp's REGEX misses literal `undefined`; corp `stripUndefinedLiterals` (17414) is case-sensitive | **Adaptation port**: replace corp's `PLACEHOLDER_NAME_RE` with the hardened one + swap the body for the unicode-aware version + make the strip case-insensitive — all IN PLACE. NEVER paste the helper-definition hunks as-is (duplicate `const`/`function` at module scope = SyntaxError, worker fails to boot). The Accounts-validator and deterministic-intake guard hunks: corp already has intake guards (22382/22391) — port only the Accounts-validator section |
| 5 | Term-label helpers (`deriveQuoteTermLabel`, `subjectHasTermToken`) | Zero matches in corp bundle — new code | **Clean port** |
| 6 | MT sensor map (MT12 water / MT14 air) | Same anchor line in corp (16041 "MT Sensors: MT10, …"); no water-leak mapping exists | **Clean port** (verify corp's second "- **Sensors**:" list line too) |
| 7 | `meraki_isr_name` lookup | Corp destructure (22284), `if (meraki_isr_email)` block (22716–17), `needs_meraki_isr` instruction (23184), tool schema (25215) — all byte-identical anchors; corp's extra lookup-filter diagnostics (16810/16831) are separate code, untouched | **Clean port** — also gives corp's #33 dead-end a resolution path (name→candidates chips) |
| 8 | Test file | Same CJS-transform convention both repos use; asserts only on shared code | **Ports as-is** (corp CI Node version unverified) |

Shared-constant safety: the only IDs the diff references are `STRATUS_SALES_ISR_ID`
(2570562000027286729 — present 7× in corp bundle; same Zoho org org647122552 on both
sides, 71 refs) and no owner/email/hostname literals. Owner identity flows through
`{{OWNER_ZOHO_ID}}`/`getOwnerForCaller` templating in both (corp 29 refs, personal 18;
corp's one literal Chris id is the intentional `SEED_USERS` caller-roster entry, 16575).

## A2. Adversarial round (track 1) — findings and dispositions

An independent adversarial reviewer probe-executed the diff. Every claim was re-verified
in the main session before acting. Outcomes (all fixes below are in the round-2 commit):

| Finding | Verdict | Disposition |
|---|---|---|
| HIGH — naive corp port double-defines `isPlaceholderName`/`PLACEHOLDER_NAME_RE`/`stripInjectedClassifierContext` → module-scope SyntaxError, corp worker fails to boot | Accepted (repro: duplicate const in ESM throws at parse) | Port instructions in table A made mechanical: patch existing corp definitions in place; never paste helper hunks |
| MED — continuation rule inert on real zoho-page turns: extension PREFIXES `[Active Zoho page:...]`, `^`-anchored rule never matched (probe: exact corp-#31 turn → `general`) | Confirmed by main-session probe | FIXED: strip now removes `[Active Zoho page:]` lines (ctx flags still read the raw message) |
| MED — "yes, uncheck the inactive flag and assign Jesse" hijacked to `crm_write`, losing `assign_cisco_rep_to_deal` (regresses 2026-07-09 reactivation fix) | Confirmed by probe | FIXED: `assign/reassign/uncheck/reactivate/inactive` added to the continuation rule's exclusion vocabulary → falls through to `cisco_rep` |
| MED — prompt hunk "hardcodes personal-org Zoho id" | **Rejected**: both environments share Zoho org org647122552 (71 refs in corp bundle); the Stratus Sales id appears 7× in corp's own deployed code and pre-existed on that prompt line on main | No change; the merge-care note near corp's deal-create diagnostics (16810/16831) retained in table A |
| LOW — `PUBLIC-SECTOR,3` minted bogus `LIC-SECTOR` (substring match); qty 0 / unbounded qty accepted | Confirmed by probe | FIXED both workers: `\b` anchor on all pair regexes, qty capped `{1,5}`, qty-0 pairs skipped |
| LOW — placeholder guard false positives ("Client Names LLC" via plural broadening; pure-CJK names via ASCII check) | Confirmed | FIXED: regex reverted to Amir's singular `name\b` (exact corp parity), letter check now unicode `\p{L}\p{N}` |
| Secondary — `license_term:"36"` would stamp "36-Year" | Confirmed | FIXED: stamp whitelist {1,3,5,7,10} |
| Secondary — `Quote_Stage` default could re-create the forbidden Admin_Action+Quote_Stage combo after that guard already ran | Confirmed (ordering) | FIXED: default skipped when `Admin_Action` present |
| Secondary — `[Email body:` block at end of message (no close marker) failed open into classification | Confirmed | FIXED: strip-to-end fallback |
| Secondary — ISR name match whose record lacks an Email logged misleading "no record matches" | Confirmed | FIXED: explicit no-email-on-file step |
| Secondary — real Cisco rep emails in the new test file | Noted (repo already carries 20+ @cisco.com refs on main, incl. 13 in the worker itself) | Test file switched to synthetic addresses anyway |

Documented residual limitations (accepted, not coded): term stamp is skipped when the
deal name itself contains any term token, so a deal literally named "…1yr and 3yr Options"
can still yield same-titled quotes; quotes whose term was silently defaulted to 1-year now
get an accurate "- 1-Year" suffix (intentional labeling change); ISR name search reads at
most 50 records for very common first names; single-char and "NA" names stay blocked
(Amir-parity by design).

## B. Personal-vs-corp environment differences that matter

Deployment topology (track-2 sweep of the three unmerged corp-migration branches +
workflows): main is hardwired to the personal account — all four wrangler.toml files pin
`account_id ec1888c5…` and deploy.yml pushes with a single personal `CLOUDFLARE_API_TOKEN`.
The corp-side config exists in this repo only as **unmerged placeholders**:
- PR #149 branch (`refactor/wrangler-environments`): `[env.personal]`/`[env.corp]` split;
  top-level deliberately has no name/account so a flag-less deploy fails loudly. All corp
  blocks are `<CORP_*>` placeholders. **Merging it alone would break deploy.yml/build-check.yml**
  (bare `wrangler deploy` without `-e` fails by design) — workflows must gain `-e personal`
  in the same merge.
- PR #148 branch (`fix/corp-migration-prereqs`): adds `PRICE_CRON_READONLY` (skips the
  price-cron's GitHub commit — its only cross-account write) and un-hardcodes
  `PRICE_CRON_REPO`; **main still hardcodes `cjgraves1119/stratus-bot-v2` as the cron's
  commit target** (worker-gchat/src/index.js:30649) — verify what the corp fork does here,
  since corp's 11:00 UTC cron demonstrably runs.
- PR #86 branch (depersonalize): disjoint history, superseded by main's SYSTEM_OWNER_*
  refactor — but two orphan `env.BOT_DEFAULT_OWNER_ID` refs survive on main
  (index.js:11318, 25488) with that var defined nowhere (pre-existing latent bug, not #155's).
- Corp runs the **extension**, not the GChat bot: the env.corp header notes corp skips
  `GCP_SERVICE_ACCOUNT_KEY`/`GOOGLE_PROJECT_NUMBER`.
- `ANTHROPIC_GATEWAY_URL`: if corp leaves it unset, corp Claude traffic silently bills
  through Chris's AI-Gateway account (corp-deploy/README.md §4 warning).
- **Atomic cutover rule** (corp-deploy/README.md §6): both environments write the SAME live
  Zoho org, Gmail, and price book — never run write paths in parallel during a cutover.

Extension distribution is fully divergent: personal is NOT on the Chrome Web Store — it's a
self-hosted CRX3 signed with repo secret `EXT_SIGNING_KEY`, served from GitHub Pages
(`update_url` manifest.json:116; release flow = release-extension.yml on `ext-v*` tag,
publishing only update-manifest.xml + .crx). Corp is Web-Store distributed (Amir's
`scripting`-permission justification emails). The API base is baked at build time
(`STRATUS_API_BASE` DefinePlugin, webpack.config.js:60-63; default = personal gateway,
constants.js:12-14); the manifest already whitelists both hosts.

Workers/config (evidence: worker-gchat/wrangler.toml + worker/wrangler.toml + corp bundle):
- Accounts/hostnames: personal `ec1888c5…`/`*.chrisg-ec1.workers.dev` vs corp `262c72fe…`/`*.it-262.workers.dev`. Extension manifest already carries BOTH host_permissions.
- Vars that differ by design (wrangler.toml comments are explicit): `SYSTEM_OWNER_ID/EMAIL/NAME`, `PRICE_CRON_NOTIFY_EMAIL`, `ANTHROPIC_GATEWAY_URL` (account-scoped), `CRM_AGENT_CLAUDE_DEFAULT` ("CORP NOTE: review/flip for cost before go-live"), `CF_QUOTE_V3_ENABLED` (secret; personal-on / corp-off by design), `QUOTE_PO_WORKFLOW_ENABLED`.
- Corp-only code: `reterm_quote_licenses`, `convert_quote_licenses_fedramp` (in crm_write/subscription/general subsets), `SEED_USERS` roster, EOM+fiscal-quarter Valid_Till policy in the quote template (personal template still says today+30d — personal is BEHIND corp on date policy), FedRAMP classifier rule, stratus-quote button fast-path rule.
- Personal-only: V3 model-intent quoting path, dev-bot items (PR #154 reference list), auto-deploy of all 3 workers on push to main (`.github/workflows/deploy.yml`).
- Shared: Zoho org + record IDs, D1 `error_reports` schema (verified identical shape both accounts), 11:00 UTC cron slot (price refresh + digest — Amir asked to keep).

CI/deploy paths:
- Personal: PR checks = wrangler dry-runs ×3 + gitleaks + data-file sync (all green on #155). **Push to `main` AUTO-DEPLOYS all three workers to the personal account** (deploy.yml). ⇒ merging #155 IS a personal-env production deploy.
- Corp: merge-to-main auto-deploy on their side (Amir email 2026-07-22: "Automatic deploy when PR merged to main branch", deploy id 5d41df0a…); corp deploys are Amir-driven.

Extension: PR #155 touches NO extension code ⇒ no corp extension rebuild, no Web Store
review cycle, no manifest/permission deltas. (The screenshot-permission bug remains a
corp-extension item on Amir's plate; personal manifest keeps context-menu-gesture capture.)

## C. Policy decisions that must be made by humans (not portable as code)

1. Quote expiration: corp EOM/fiscal-quarter policy vs Eric's "≤2 weeks price protection" (report #19) — divergent; decide before further date work.
2. Subscription licensing SKU truth (report #35) — needs Chris/Roman product decision; no code on either side models it.
3. Antenna posture in corp PR 29 — Tim directed ADVISORY note, not auto-add; verify PR 29 matches before merging it.
4. `CRM_AGENT_CLAUDE_DEFAULT` cost flip for corp go-live (wrangler.toml corp note).

## D. Pre-merge verification checklist

For #155 → personal main (remember: merge = auto-deploy):
- [ ] Re-run `node worker-gchat/test-error-log-fixes-2026-07-31.js` (40/40) + webex suites at the merge SHA
- [ ] Post-deploy smoke: paste the Ohio Valley Gas 20-pair line → quantities exact; create a 3-yr quote → Subject carries "- 3-Year", Quote_Stage=Qualification; "use <rep name> for ISR" → auto-resolves
- [ ] Confirm no dev-branch (1.25.x) regressions: merge main → dev/consolidated-2026-07-21 afterward so the live dev bot picks the fixes up

Personal-repo hygiene surfaced by this review (pre-existing, separate from #155):
- [ ] Remove/define the two orphan `env.BOT_DEFAULT_OWNER_ID` refs (index.js:11318, 25488)
- [ ] Decide on PR #148/#149 (corp-migration prereqs + env split) — still unmerged; #149 requires simultaneous workflow `-e personal` updates
- [ ] release-extension.yml:12 comment still cites the stale pre-2026-06-04 extension ID

For the corp port (Amir executes; nothing here touches corp):
- [ ] Verify corp's price-cron commit target (main hardcodes Chris's repo as `PRICE_CRON_REPO`) and corp's `ANTHROPIC_GATEWAY_URL` (unset = bills via Chris's gateway)
- [ ] Port hunks per table A verdicts (skip 3c; adapt 2/4 as noted — no duplicate helpers)
- [ ] Diff corp's classifier insertion point (extra FedRAMP/fast-path rules shift line numbers, not semantics)
- [ ] Run the ported test file on corp CI; add corp's own EOM-template cases if the Subject-stamp interacts with their date wording
- [ ] Corp deploy + send SHA/deploy-id back per the established email workflow
- [ ] Post-deploy: watch the next two 11:00 UTC digests for recurrence of #16/#31 (tool availability), #38/#39 (title/stage), and any new "undefined" records

## E. Codex handoff packet (run from Cowork where the bridge is installed)

Paste to Codex (read-only sandbox):
"Adversarially review commit e19b545 on branch claude/chrome-extension-logs-pr-review-09f5cn
of cjgraves1119/stratus-bot-v2 (PR #155) as a REVIEWER FOR CORPORATE PORTING. Known corp
divergences: corp already defines isPlaceholderName/PLACEHOLDER_NAME_RE/stripInjectedClassifierContext;
corp TOOL_SUBSETS add reterm_quote_licenses + convert_quote_licenses_fedramp; corp quote
template enforces end-of-month Valid_Till; corp guards deterministic intake with
isPlaceholderName already. Attack: (1) pair-parser regex edge cases (mixed pair/non-pair
tokens, trailing commas, qty 0/huge, '=' spare suffixes); (2) continuation-rule false
positives that could strip needed toolsets ('yes cancel that', 'no', bare emails in email
flows); (3) deriveQuoteTermLabel wrong-stamp risk on 7/10-year and SA-/DUO- prefixes;
(4) Quote_Stage default interactions with Admin_Action/update paths; (5) meraki_isr_name
Zoho criteria injection/escaping; (6) any duplicate-definition hazard when hunks land on
corp code. Single-packet handoff: one consolidated response with file:line cites."

---
_Assembled from: corp worker bundle (read-only fetch, It@ account), corp+personal D1
error_reports, wrangler.toml ×2, .github/workflows, PR #148/#149/#86 branches, the
2026-07 email record, and PR #155's diff. Corp repo itself was never accessed._
