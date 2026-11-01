# Overnight log (branch `overnight/2026-11-01`)

Rules: `docs/OVERNIGHT_RULES.md`. Plan and order: `docs/ROADMAP_V2.md` section 3. Coverage ledger: `docs/NOTES_COVERAGE.md`. Things for King: `docs/NEEDS_KING.md`.
Re-read those files and `docs/PROGRESS.md` in full at the start of every stage and after any context compaction.

## Start state (1 Nov 2026, evening)

- Repo: `C:\Users\KING\OneDrive\Desktop\SubSync` only. Branch `overnight/2026-11-01` created from `main` at 7f88137 (the docs commit), with the earlier uncommitted work carried over (Z2, Z3, Getting Started guide, test fixes, tenancy fixture fix).
- Roadmap V2.1, integrations spec and review notes N1 to N104 are in `docs/` (commit 7f88137, verified: "V2.1", E0/E2a/E2b, "3.2 Agency users", "11.1 Supabase rules", "N104" all present). Principles 1 to 14 are in `CLAUDE.md` between the markers, once.
- Old-runbook stages F1 to F10, E1 to E4, Z2 and Z3 were already BUILT before tonight (see `docs/PROGRESS.md`). Tonight's work for each stage is the delta that `docs/ROADMAP_V2.md` adds, with evidence rows. A stage is never marked PASSED.
- Test state on arrival: the integration chain (`scripts/with-dev-server.mjs`) passed api, connections and insights checks; the tenancy check failed once on `jobs: 2 !== 1` for the other agency. Cause found: the production sync cron (every 5 minutes, same database) queues jobs for any non-demo installation with a refresh token, and the fixture had one. Fixture now has no refresh token. A stale `next dev` server (PID 6448) on port 3100 earlier caused a 503 on the Zoom check; it was stopped.

## Decisions made for King

1. DECIDED FOR KING, please review: the coverage tool `scripts/notes-coverage.mjs` is committed (a small helper, outside any stage) so statuses can be updated reliably.
2. DECIDED FOR KING, please review: the review notes N1 to N26 were read in full tonight; N27 to N104 headings and stage lines were read for the ledger, and each note is read in full when the stage that handles it starts (logged per stage).

## Stage log

### Baseline close-out (S0.3 treated as PASSED by King's pre-approval; King still does his 5 checks)

Commands and real results (1 Nov 2026, on `overnight/2026-11-01`):
- `node scripts/with-dev-server.mjs` (nine integration checks, run in two parts because of the fixture fix): check-api passed ("All API checks passed"), check-connections passed, check-insights passed; then `CHECKS=check-tenancy,check-flags,check-metrics,check-audit,check-speed,check-roadmap`: tenant isolation (384 cross-reads) ok, feature switches ok, overview numbers ok, account audit ok, speed to lead ok, roadmap ok, `checks exit: 0`.
- `npm run verify`: `verify exit: 0`; Node tests `ℹ tests 329, pass 329, fail 0`; Vitest `Test Files 17 passed (17), Tests 116 passed (116)`; lint 0 errors, 6 warnings.
- `npm run e2e` (Playwright, three widths): `156 passed (45.1m)`, `1 failed`, `146 skipped` (the review-capture spec only runs with REVIEW=1), `3 did not run` (the three tests after the failure in the same serial file).
- The 1 failure (phone-390, settings spec "brand name"): TWO causes, both fixed. (1) Saving a setting ran a full recompute of every account (22 seconds on the demo tenant) even for a brand name; `settingsUpdate` in `src/lib/api/router.ts` now recomputes only when a setting that feeds a number or alert changed (`INSIGHT_SETTINGS`). That is a real fix: a 22 second save on a brand name would also have hurt customers. (2) The test looked at the first element containing the brand name, which on a phone is the hidden desktop sidebar: the test is wrong, now `.filter({ visible: true })`. Rerun on phone-390: brand test, Getting started, What's new, five groups: `4 passed (1.0m)`; the whole settings spec had 5 passing before the brand test ran. The demo tenant's brand name was restored (the test restores it; a manual PUT also restored it).
- Fixtures: the tenancy fixture lost its refresh token so the production cron cannot queue jobs for it (this had caused `jobs: 2 !== 1` once). A stale `next dev` server on port 3100 had caused a 503 on the Zoom check.

DECIDED FOR KING, please review: the stage agents (sub-agents, one at a time) build each stage from `docs/OVERNIGHT_AGENT_BRIEF.md`; I (the lead engineer) re-run the full suite and commit/tag each stage myself.

### Stage S0.2b: Tenancy follow-ups (1 Nov 2026): BUILT, awaiting King's checks

Full instruction list, the five evaluation lines, the evidence table (one row per item) and King's 5 checks are in `docs/features/S0.2b.md`. Notes handled: N48, N82, N83, N84, N93 (N73 context). Nothing was committed or pushed (the lead does that).

**What was built (short).** No cross-client matching at all (card, query, tile and count removed). A client's staff provably never receive fees, notes, owner labels, keys, saved lists, settings or other clients' data (two leaks found by the new test and fixed: the owner label, and Getting started steps that revealed whether Slack and email were set up). "What we store", the privacy page's lists and the help answer are generated from `src/lib/data-inventory.ts`, which a test compares with the migration files and the live database (39 tables) and which fails for a new table or personal-looking column nobody described. "Delete my data" is for the agency owner (or a business's own administrator), needs the typed word, and is audited. The login domain is found at sign-in and in the install event and Settings only offers an override (and a save no longer freezes the found address as "typed"). The setting "save unmatched meetings in an account" is gone everywhere; matching is exact-email-and-certain-only. Zoom and Google Meet are behind `zoom_meet` and the Meeting notes page behind `meetings`, both off by default.

**Decisions made for King (also in `docs/DECISIONS.md`).**
1. DECIDED FOR KING (his newer instruction): the Meeting notes page is off by default until E2a passes; this overrides "do not hide pages". Zoom and Google Meet hidden behind `zoom_meet`.
2. DECIDED FOR KING, please review: the "Meeting notes privacy" switches stay visible in Settings while a meeting tool is connected, even with the page off (otherwise a connected Fathom writes notes with no way to switch it off).
3. DECIDED FOR KING, please review: "Delete my data" may be pressed by the agency owner, or by the administrator of a business that installed the app for itself; nobody else (agency administrator, staff, clients, an agency person only visiting a self-installed business).
4. DECIDED FOR KING, please review: until the private Meeting inbox exists (E0, E2a) a meeting that cannot be matched with certainty is only counted, for every connection including a single business's (it used to save in the business's own account).
5. The N48 card was removed outright, not kept agency-only.
6. Matching is certain-or-nothing (an email two records share, or matches in two clients, decides nothing; names and phones never match).
7. `scripts/backup-tables.ts` (a small helper that saves tables to `backups/` and prints row counts) and a guard in `scripts/with-dev-server.mjs` (refuses to start when something already answers on port 3100) were added; both are test-infrastructure helpers outside the feature.

**UNSURE.**
- UNSURE: whether the agency owner flag (`isAgencyOwner`) really arrives as `true` for King's own sign-in in every case; the role rules were proven with made-up payloads and the earlier S0.2 work, and "Delete my data" now depends on it. King's check 2 tests it.
- UNSURE: the install event may reach us before the install row exists (the webhook then has nothing to attach the domain to); sign-in fills the same field at the first open, so nothing is lost, only delayed.
- UNSURE: `docs/ROADMAP_V2.md` says the e2e server has `FLAGS_ALL_ON` set; it does not (the e2e server removes it, so it already tests the real default switches). Only the integration harness sets it.

**NOT VERIFIED LIVE.**
- A real signed install event carrying `whitelabelDetails.domain` (exact morning test in `docs/NEEDS_KING.md` section 13).
- "Delete my data" pressed by a real owner and a real administrator (tested only on fixture companies; NEEDS_KING section 6 has the real-account test).
- `scripts/check-connections.ts` (Zoom part) and the 200 answer to Zoom's address check in `scripts/check-flags.ts`: see "Environment problem" below.

**Environment problem (read this).** A `next dev` server for this repo was already listening on port 3100 (PID 53848, started 01:47, before this stage began, idle, with the browser-test settings: no `FLAGS_ALL_ON`, no Zoom test secret). I was not permitted to stop it (the permission layer refused), and `scripts/with-dev-server.mjs` would have silently tested against it. So I ran each integration script by hand against that server, writing temporary rows in `feature_flags` (`meetings` and `zoom_meet` set to on, which is what the harness's `FLAGS_ALL_ON` does) and removing them afterwards (the table is empty again, checked). Everything passed except what needs the harness's own server: the Zoom part of `check-connections.ts` (the server has no `ZOOM_WEBHOOK_SECRET_TOKEN`, so Zoom's notification address answers 503) and the 200 answer in `check-flags.ts` (it accepts 503 and still fails on 404). **The lead should stop that server and rerun `node scripts/with-dev-server.mjs`** to get those two parts. The harness now refuses to start while something answers on 3100.

**Migrations applied to the live database (additive, backups first).**
- `20261101010000_detected_app_domain.sql`: new nullable column `settings.detected_app_domain`. Backup `backups/settings-2026-11-01T07-13-06-609Z.json`; settings 3 rows before, 3 after.
- `20261101020000_meeting_default_account_retired.sql`: `update connections set default_location_id = null where default_location_id is not null`. Backup `backups/connections-2026-11-01T07-13-06-609Z.json`; connections 1 row before, 1 after; rows with a default account 0 before and 0 after (the one real Fathom connection already said "do not save it").
- None held.

**Tests run, real result lines.**
- `npm run verify`: `verify exit: 0`. Node tests `ℹ tests 335`, `ℹ pass 335`, `ℹ fail 0`. Vitest `Test Files  21 passed (21)`, `Tests  146 passed (146)`. Lint 0 errors, 6 warnings (the same six as before). Build compiled; `/privacy` is now partial-prerender like `/audit/[id]`.
- Integration scripts, each `exit 0` against the running server with the temporary flag rows: `check-api` ("All API checks passed"), `check-insights`, `check-flags` ("feature switches: off hides the page, API and public addresses; others untouched; back on restores: ok"), `check-metrics`, `check-audit`, `check-speed`, `check-roadmap`, and `check-tenancy` in full: "tenant isolation: two agencies, 384 cross-reads as agency, business, client and forged sessions, attacks refused, account user read-only, client secrets never sent, client access off at once, Delete my data owner-only and audited, share link and webhook safe, nothing changed: ok". `check-connections` passed up to the Zoom part (see above).
- `npm run e2e`: final full run `170 passed (47.5m)`, `166 skipped` (the review-capture spec and the width-specific tests, as before), `e2e exit 0`. An earlier full run of this stage had `155 passed`, `4 failed`: three were my own new browser spec (a heading name that matched two headings, and two tests that opened too many pages inside the 90 second limit on this machine's slow database link, plus a leftover Fathom test connection that my own aborted run of `check-connections.ts` had left on the demo tenant, now removed), and one was the settings speed-target test timing out while my slow test's saves were still running in the background (it passed on its own rerun and in the final full run). The spec was rewritten (one test per page) and the leftover removed; nothing was loosened, deleted or skipped.

**Files changed (summary).** New: `src/lib/data-inventory.ts`, `supabase/migrations/20261101010000_detected_app_domain.sql`, `supabase/migrations/20261101020000_meeting_default_account_retired.sql`, `scripts/backup-tables.ts`, `docs/features/S0.2b.md`, tests `src/lib/__tests__/zoom-hidden.test.ts`, `tests/unit/{client-access,data-inventory,domain-detect,meeting-matching}.test.ts`, `tests/e2e/s02b.spec.ts`, `tests/fixtures/{schema-from-migrations,visible-text,meeting-hook}.ts`. Changed: see `git status`.

#### S0.2b: lead engineer's own re-run (after the agent's build)

- Problem found: a stale `next dev -p 3100` (PID 53848, started 01:47, an e2e-style server with no `FLAGS_ALL_ON` and no Zoom test secret) was holding port 3100 and the `.next` folder. It is a leftover of my own debugging (I started `scripts/e2e-server.mjs` by hand to time a request and `pkill` did not stop its child). The permission layer refused my request to stop it, so I did NOT work around that. Instead the harness now supports a separate port and build folder: `TEST_PORT=3101 TEST_DIST_DIR=.next-int node scripts/with-dev-server.mjs` (new optional `distDir` in `next.config.ts`, default unchanged `.next`; `.next-int` is gitignored; Next auto-edited `tsconfig.json` while running, which I reverted with `git checkout`).
- Full integration chain on the clean server: `checks exit: 0`: "All API checks passed", connections ("Fathom and Zoom signed deliveries ... ok", so the Zoom part the agent could not run now passes), appointment insights ok, "tenant isolation: two agencies, 384 cross-reads as agency, business, client and forged sessions, attacks refused, account user read-only, client secrets never sent, client access off at once, Delete my data owner-only and audited, share link and webhook safe ... ok", feature switches ok, overview numbers ok, account audit ok, speed to lead ok, roadmap ok.
- `npm run verify`: `verify exit: 0`; Node `ℹ tests 335 / ℹ pass 335 / ℹ fail 0`; Vitest `Test Files 21 passed (21) / Tests 146 passed (146)`.
- `npm run e2e`: NOT re-run by me. The agent's final full run reports `170 passed (47.5m)`, `166 skipped`, exit 0, against the e2e-style server (the same configuration Playwright would start). A full e2e run costs 47 minutes, so from here I run it at the end of each milestone and in stages the agents mark as UI-heavy, and rely on the agent's own full run in between. DECIDED FOR KING, please review.
- Migrations applied (additive, backed up first): `20261101010000_detected_app_domain.sql` (new nullable `settings.detected_app_domain`; backup `backups/settings-2026-11-01T07-13-06-609Z.json`; settings 3 rows before, 3 after) and `20261101020000_meeting_default_account_retired.sql` (clears `connections.default_location_id`; backup `backups/connections-2026-11-01T07-13-06-609Z.json`; connections 1 row before, 1 after; rows with a default account 0 before, 0 after). None held. The old `main` code still works (it only reads the cleared column).
- NOT VERIFIED LIVE: a real signed install event carrying `whitelabelDetails.domain`; a real owner pressing "Delete my data" (fixtures only). Morning tests are in NEEDS_KING.
- Agent's note for King: `docs/ROADMAP_V2.md` says the e2e server sets FLAGS_ALL_ON; it actually removes it (so e2e already tests the flag-off state). Left as is.
- Status: S0.2b BUILT, awaiting King's checks. Tag `stage-S0.2b`.
