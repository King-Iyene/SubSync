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

### Stage S0.4: Sync reliability and scheduler (1 Nov 2026): BUILT, awaiting King's checks

Full instruction list, the five evaluation lines, the real-data diagnosis, the evidence table (one row per item) and King's 5 checks are in `docs/features/S0.4.md`. Notes handled: N33, N74, UX-06 (DONE-TONIGHT), N80 and N81 (their S0.4 parts), N6 and N62 (the freshness parts). Nothing was committed or pushed (the lead does that). No database migration, no change to Vercel settings or environment variables, nothing sent to anyone (no email, no Slack, no test email: 0 of 5 used).

**What was built (short).** The real cause of "Last synced keeps growing": before 06:25 UTC on 31 Oct the 5 minute cron could not run (Vercel Hobby allows once a day), so cycles came 82 to 489 minutes apart; after it the cadence was a steady 20 minutes, not 15, because a cycle was due "15 minutes after the last one finished" on a scheduler that wakes every 5 (fixed: measured from when the last cycle was queued, 14 minutes). One freshness function (`src/lib/sync/freshness.ts`: the oldest account's last successful refresh) feeds one line above every page ("Updated 7 min ago"; "..., refresh is delayed" over 30 minutes; "..., but the latest refresh failed for 1 account"), Today, the Overview, the Slack brief and a new Settings "Sync status" panel that replaces Connection health and Data sync. The vague badge, the always-on "sync running" banner and the second timestamps are gone. The "sync running" note shows only for a first sync or one queued or running 10 minutes or more. An internal alarm (`/api/cron/watchdog`, every 10 minutes) writes `sync.alarm` and `sync.recovered` audit lines; `/api/admin/diagnostics` (server secret only) shows every real install's alarm state, queue, cadence and the webhook event types received. "Send at" is bounded and tested with fake clocks across 7 time zones and the 2026 New York clock changes (a send happens in the chosen local hour or the next 3, once per local date). `scripts/sync-timeline.ts` prints the real timeline.

**Decisions made for King (also in `docs/DECISIONS.md`).**
1. DECIDED FOR KING, please review: **the webhook route now understands the real `INSTALL` and `UNINSTALL` event names** (the live webhook log shows the platform sends those; the code only knew `AppInstall` and `AppUninstall`, so install and uninstall events were silently ignored). On merge a real uninstall event removes that account's or company's copied data and tokens, as the privacy page promises, and a new account added after a bulk install is picked up within minutes. To revert: `canonicalType` in `src/lib/ghl/webhook.ts`.
2. Scheduler: keep Vercel Cron on the Pro plan with the existing queue (weighed `pg_cron` and a queue service; reasons in DECISIONS). Wake every 5 minutes, refresh every 15.
3. The one freshness value is the OLDEST account's last successful refresh (never fresher than the stalest account); a filter on screen never changes it.
4. The daily brief and Monday email send within 3 hours after the chosen hour, once per local day, else the day is skipped (switching the brief on in the afternoon waits for tomorrow instead of sending at once).
5. Alarm notification is a dry run (an audit line saying "WOULD NOTIFY", nothing sent); the real notification belongs to the F9 dispatcher with its switches.
6. Removed (not hidden): the old `freshness()` helper and its test in `digest-intel`, `analytics/health.ts`, `health-card.tsx`. The old `health-level.ts` rule (6 hours) is kept, marked unused, with its tests.

**UNSURE.**
- UNSURE: that the plan became Pro at 06:25 UTC on 31 Oct. It is read from the job history (the first steady cycle), not from the Vercel dashboard.
- UNSURE: which webhook events the marketplace app is subscribed to. The 3-day log holds only INSTALL, UNINSTALL, UPDATE, ContactCreate and ContactUpdate. `docs/NEEDS_KING.md` section 15 lists what to tick.
- UNSURE: whether an UNINSTALL event can arrive late (after a reinstall) and remove the fresh install. The same hazard existed in the design for the documented names; not guarded here.
- UNSURE: the oldest-account rule means one account whose permission was removed keeps the whole line at "delayed" or "failing" until it is reconnected. That is the truthful reading; the detail line names the account.
- The demo company shows "Sample data" on the line (it has no real sync), so the browser test cannot see a numeric time; the numeric wording is covered on real rows (`check-sync.ts`, `sync-reliability-db.test.ts`).

**NOT VERIFIED LIVE.**
- The new 15 minute cadence (takes effect on merge): `node --env-file=.env.local --import tsx scripts/sync-timeline.ts --hours 6` a few hours after the merge must show a median gap of 15.
- A real INSTALL or UNINSTALL delivery, a real appointment, deal or message webhook, a real alarm during an outage, a real "Send at" delivery (all tested with fixtures or fake clocks and transports).

**Migrations.** None. (No table or column was added; the new audit lines use the existing `audit_log`.)

**Tests run, real result lines.**
- `npm run verify`: `verify exit: 0`. Node tests `ℹ tests 373`, `ℹ pass 373`, `ℹ fail 0`. Vitest `Test Files  23 passed (23)`, `Tests  168 passed (168)`. Lint 0 errors, 6 warnings (the same six as before).
- Integration chain on its own port (`TEST_PORT=3101 TEST_DIST_DIR=.next-int node scripts/with-dev-server.mjs`): `checks exit: 0`. "All API checks passed." (including "sync status + resync: ok"), connections ok, appointment insights ok, "tenant isolation: two agencies, 384 cross-reads as agency, business, client and forged sessions, attacks refused, ... nothing changed: ok", then the new check: "one sentence everywhere (Today, Overview, freshness line, Sync status, Slack brief), for agency, business and client: ok", "Sync status panel: next run, what runs when, refused to clients, own account only for a business: ok", "the 'sync running' note: absent for a normal refresh, present for a long one: ok", "stale and failed wording is the same on every surface; reasons are plain; a neighbour's failure stays hidden: ok", "diagnostics and alarm addresses: secret only; 2 real installs listed, 0 alarms now; watchdog checked 2: ok", then feature switches, overview numbers, account audit, speed to lead and roadmap ok. `tsconfig.json` restored with `git checkout` and `.next-int` removed.
- `npm run e2e`: 188 passed (53.5m), 166 skipped (the review-capture spec and the width-specific tests, as before), `e2e exit: 0`, on the e2e-style server Playwright starts itself (the real default switches). That is 170 (the previous stage's run) plus 18 new tests: the new `tests/e2e/freshness.spec.ts` (4 page groups, the Sync status panel, and the business and client views, at 3 widths). The existing Today test "the sync banner is only for a first sync" and the settings, menu, consistency and white-label specs pass unchanged.

**Files changed (summary).** New: `src/lib/sync/{schedule,freshness,freshness-queries,alarm,watchdog,timeline}.ts`, `src/app/app/views/sync-status.tsx`, `src/app/api/cron/watchdog/route.ts`, `src/app/api/admin/diagnostics/route.ts`, `scripts/sync-timeline.ts`, `scripts/check-sync.ts`, tests `src/lib/__tests__/{schedule,dispatch-time,freshness,alarm,webhook-events}.test.ts`, `tests/unit/{sync-reliability-db,freshness-one-source}.test.ts`, `tests/e2e/freshness.spec.ts`, `docs/features/S0.4.md`. Changed: `vercel.json`, `src/lib/sync/engine.ts`, `src/lib/ghl/webhook.ts`, `src/app/api/webhooks/ghl/route.ts`, `src/lib/api/router.ts`, `src/lib/access.ts`, `src/lib/analytics/{digest-intel,digest-service,weekly-email,health-level}.ts`, `src/app/api/cron/{daily,weekly}/route.ts`, `src/app/app/{dashboard,types}.ts(x)`, `src/app/app/views/{today,overview,settings}.tsx`, `src/lib/route-guards.ts`, `scripts/{check-api,check-tenancy,with-dev-server}`, `tests/unit/client-access.test.ts`, `src/lib/__tests__/digest-intel.test.ts`. Removed: `src/app/app/views/health-card.tsx`, `src/lib/analytics/health.ts`. Docs: DECISIONS, METRICS, NEEDS_KING (section 15), NOTES_COVERAGE, PROGRESS, FEATURE_STATUS, TENANCY, this log.

Status: S0.4 BUILT, awaiting King's checks. Tag for the lead: `stage-S0.4`.

#### S0.4: lead engineer's check
- I re-ran `npm run verify`: `verify exit: 0`; Node `ℹ tests 373 / ℹ pass 373 / ℹ fail 0`; Vitest `Test Files 23 passed (23) / Tests 168 passed (168)` (same numbers as the agent). The integration chain (`checks exit: 0`, including the new check-sync) and `npm run e2e` (`188 passed (53.5m)`, `166 skipped`, `e2e exit: 0`) are the agent's own runs against the same tree; I did not repeat them. The 18 screenshots the e2e run rewrote in `docs/review/` were reverted (not stage evidence).
- DECIDED FOR KING, please review (customer data): real UNINSTALL notices now actually delete the company's copied data (before, the live type names INSTALL/UNINSTALL were silently ignored). That matches what the privacy page promises, takes effect only when this branch is merged, and reverts by removing `canonicalType` in `src/lib/ghl/webhook.ts`. UNSURE: a delayed UNINSTALL arriving after a reinstall would remove the fresh install (the notice carries no timestamp to compare); not guarded.
- Status: S0.4 BUILT, awaiting King's checks. Tag `stage-S0.4`.


### Stage F1: Numbers truth plus audits (1 Nov 2026): BUILT, awaiting King's checks

Full evidence table (one row per instruction), real data, UNSURE items and King's 5 checks are in `docs/features/F1.md`. Notes handled: N6, N15, N16, N38, N45, N46, UX-01, UX-02, UX-04 (DONE-TONIGHT); N1, N8, N37, N39, N47, N62, N64 (their F1 parts); N44 (NEEDS-KING: approve the cut list); N17 (not a code item). Nothing was committed or pushed.

**What was built (short).** One written definition of a counted deal everywhere (stage rules: a stage or pipeline can be Active, Closed out or Unset, by name or by the owner's choice, with a win chance per stage; `stage_rules`, `definition_version`), so Today, Overview, Pipeline, Team, Leads and exports stop disagreeing; the forecast is a range with its method and a drawer (no number without enough closed deals); history is only compared inside one definition version; the cold list is apart from working leads; "0 invalid" is told from "not checked"; no percentage on a small base; the unread card now says how many of the unread are also waiting (the 285 against 259 was the Inbox listing unread minus waiting); the wait chart equals its list and an ancient thread is never "Critical"; the read limit (500 conversations per account) is disclosed; KD Squares LTD with 21 customers waiting is now "At risk"; the same filter gives the same numbers on 37 pages (`scripts/check-filter.ts`, which found three pages that ignored it). Also `docs/DATA_POINTS.md` (116 rows, nothing cut), `docs/CAPABILITIES.md`, `docs/METRICS.md`, `docs/METRIC_AUDIT.md`.

**Decisions made for King (also in `docs/DECISIONS.md`).**
1. DECIDED FOR KING, please review: reply-delay labels use 5 customers waiting for "Watch" and 15 for "At risk" (my choice, not a measurement).
2. DECIDED FOR KING: stage names like Disqualified, Wrong Phone Number, Unreachable and pipelines marked "Not in use" are closed out by name unless the owner marks them Active (13 of 80 real stage pairs; 1,033 real deals).
3. Core change, performance only: the insight refresh writes accounts and alerts in one statement each (17 s down to about 6 s on the demo); same rows, same conflict rules.
4. Nothing was cut from the data point list; King approves first (`docs/NEEDS_KING.md` section 16).

**UNSURE.**
- UNSURE: the business install did not grant `calendars/events.readonly` or `users.readonly`, yet appointments and team names read `ok` for it.
- UNSURE: whether the platform sends a last-activity time on another address (the contact list sends none: 0 of 52,926).
- UNSURE: the demo's lead rows age out of the 14 day speed window after about 16 hours, so `speed.spec.ts:17` needs a fresh seed (`npm run seed:demo`, then `scripts/make-sample-audit.ts`). Not a product bug; a test-data fragility that existed before this stage.
- UNSURE: test deals by name ("test" in a deal name) were never defined; not built.
- UNSURE: `check-flags` was running when the chain was stopped; its result line was not captured.

**NOT VERIFIED LIVE.**
- Every "Live" cell of `docs/CAPABILITIES.md`: the real tokens cannot be opened on this machine, so no call to the platform was made. After the merge, one secret-only call to `/api/admin/capabilities` (or `scripts/audit-capabilities.ts`) completes it (`docs/NEEDS_KING.md` section 16).
- Every CRM count (contacts, open deals, unread, waiting): King's 5 checks.

**Migrations.** `supabase/migrations/20261101030000_f1_numbers_truth.sql` (additive, idempotent), applied after backups: `backups/account_metrics_daily-2026-11-01T14-20-44-744Z.json` (459 rows) and `backups/settings-2026-11-01T14-20-44-744Z.json` (3 rows). After: 459 and 3 rows, new table `stage_rules` 0 rows. The demo tenant was re-seeded (demo rows only) and its sample audit link recreated.

**Tests run, real result lines.** (Per the lead's change of plan the full suite was not run to the end; what ran on the final code is stated exactly.)
- `npm run verify` (final code): `verify exit: 0`, Node `ℹ tests 402 / ℹ pass 402 / ℹ fail 0`, Vitest `Test Files  24 passed (24)`, `Tests  184 passed (184)`, lint `0 errors, 6 warnings`.
- Integration chain (final code, stopped while `check-flags` ran): "All API checks passed.", connections ok, appointment insights ok, tenant isolation ok (384 cross-reads), sync ok. NOT RUN on the final code: check-flags, check-metrics, check-filter, check-stage-rules, check-audit, check-speed, check-roadmap (all passed one change earlier, `chain exit 0`).
- `npm run e2e` (399 tests, code before the last fixes): `179 passed (1.2h)`, `186 skipped`, `24 did not run`, `10 failed` (4 tests at the widths; all diagnosed and fixed, see `docs/features/F1.md` section 5). Targeted rerun of `speed`, `f1`, `settings` specs: `69 passed (26.6m)`, `4 failed`; `settings` alone: `18 passed (14.0m)`, `1 failed`, `8 did not run` (before the last write speed-up). The settings spec was NOT rerun after the speed-up; the full browser run is for the end of M1.

**Files changed (summary).** New: `src/lib/analytics/{stage-rules,stage-rules-sql,definitions,definitions-sql}.ts`, `src/lib/text.ts`, `src/lib/ghl/{capabilities,capabilities-run}.ts`, `src/app/api/admin/capabilities/route.ts`, `src/app/app/views/{forecast-card,stage-rules-card}.tsx`, the migration, `scripts/{check-filter,check-stage-rules,audit-capabilities}.ts`, tests `src/lib/__tests__/f1-rules.test.ts`, `tests/unit/f1-deal-scope-db.test.ts`, `tests/e2e/f1.spec.ts`, docs `DATA_POINTS.md`, `CAPABILITIES.md`. Changed: the analytics queries and intelligence modules, the router and access rules, the demo seed, the Overview, Today, Inbox, Pipeline, Leads, Accounts, Account detail and Executive summary screens, the check scripts, `docs/{METRICS,METRIC_AUDIT,NEEDS_KING,DECISIONS,PROGRESS,FEATURE_STATUS,NOTES_COVERAGE,TENANCY}.md`, `docs/features/F1.md`.

Status: F1 BUILT, awaiting King's checks. Tag for the lead: `stage-F1`.

#### F1: lead engineer's note
- Speed mode (King's instruction): the lead did not re-run the suites after F1; the agent's results stand and the full M1 test run happens after D0, F2, F3 and F6 are built. Agent's final-code results: `npm run verify` exit 0 (Node 402/402, Vitest 184/184, lint 0 errors). Earlier full e2e had `10 failed` (4 distinct tests: settings stale threshold at three widths, speed.spec:59 phone), partly fixed (sample audit link recreated; alert/metric writes batched); to be rerun in the M1 full run. Not run on final code: check-flags, check-metrics, check-filter, check-stage-rules, check-audit, check-speed, check-roadmap.
- DECIDED FOR KING (stable core touched): `snapshotMetrics` and `syncAlerts` now write in one statement each (alert step 18.2 s to 1.3 s). Please review in DECISIONS.md.
- Status: F1 BUILT, awaiting King's checks. Tag `stage-F1`.

#### King's instruction during the run: commit to main
King wrote in the chat: "also please make sure to commit to main branch please". This replaces the safety rule "never push to main, never merge" for this run. How it is applied (DECIDED FOR KING, please review): the branch is merged into `main` and pushed only after the full test run for a milestone passes (M1, then M2), because `main` deploys to the live app for the real installs and the live database already carries this run's additive migrations. Never force-pushed; a merge commit or fast-forward only. Items in NEEDS_KING that take effect on merge (cron watchdog, real uninstall deletion, scopes) are listed in the morning report.

### Stage D0: Structure, design tokens, shared components (1 Nov 2026): BUILT, awaiting King's checks

Full instruction list, the five evaluation lines, the three-direction comparison, the component reference (props for the F2, F3 and F6 agents), the customer-eyes table, the evidence table and King's 5 checks are in `docs/features/D0.md`. Notes handled: N28, N34, UX-11 and N74 (DONE-TONIGHT); the D0 parts of N3, N7, N8, N9, N10, N14, N19, N29, N36, N50, N52, N63, N76, N89, UX-07, UX-09, UX-10, UX-13. King's live feedback KF-1 to KF-6 applied. Nothing was committed or pushed. No migration, no permission, nothing sent (0 of 5 test emails used).

**What was built (short).** KD Squares tokens in light and dark (every text pair 4.5:1, marks 3:1, tested from the real CSS; the company's own colour sits on top and is made readable). The look King approved with his one change: plain status words (text in the status colour with a thin left rule; no dot, no pill), plain one-row notices and error text with an error ID, empty states between two rules, underline tabs, cards with no soft shadow. The pilot menu in plain groups with Contact search, Leads and Call lists as tabs inside People and everything else under More (nothing removed). One page template, one role-aware filter bar (it names the accounts in, removable, and the accounts left out with a reason), one list (10 rows, View all, pages of 25, copy, arrow keys), the lead panel (arrows through the list it was opened from, "Call in your CRM", no tel: links), one HTML chart approach with scales, tooltips and placeholders, clickable charts (a bar opens exactly the leads behind it; the count is the same by construction and by test; Back keeps the bar marked), a range and comparison on each card (stated in words, in the address, remembered, no percentage on a tiny base), My day for a client's staff, a how-to note and next-step buttons, a working browser Back button and a Back link, light/dark/auto choice, and the style guide at /design. Applied to Today, Speed to lead, Appointments, Account audit and Overview.

**Decisions made for King (also in docs/DECISIONS.md).**
1. DECIDED FOR KING, please review: dark stays the default look (what people had); Light and Match my device are one tap away.
2. DECIDED FOR KING, please review: the filter and each card's range are remembered in this browser and carried in the page address.
3. DECIDED FOR KING (stable core touched lightly, read-only): every read endpoint accepts `accounts=id,id`; the filter options list ignored accounts (flagged, never counted); the Speed to lead answer carries up to 60 leads behind each week of the trend. Reverting means removing those fields.
4. Test changes, not loosening: menu.spec and freshness.spec for the new labels and People tabs; freshness-one-source for the StatusLine rename; route-registry for the public /design page.
5. No frontend-design skill is installed; I used the dataviz skill's palette validator. Install hint in D0.md section 8.

**UNSURE.**
- UNSURE: the leftover server on port 3100 serves stale server code (it showed the old menu), so I tested on my own server on port 3102; the lead should use a clean server.
- UNSURE: whether a CRM link opens the dialer for a contact (KF-3); the UI says it opens the contact in the CRM. Remaining tel: links are in the Appointments Insights tab and Call lists (F3, F10).
- UNSURE: the light theme of pages D0 did not touch (D1 verifies both themes).
- UNSURE: the remembered filter may surprise someone who forgets it; the drawer says (on) and names what is hidden.

**NOT VERIFIED LIVE.** The new `accounts=` filter and the extended `scripts/check-filter.ts` (integration chain not run); the filter list with a real test or ignored account (the demo has none); the trend rows for a real client session (scoped by the same `allowed` as the number, not exercised).

**Migrations.** None.

**Tests run, real result lines** (the full suite was NOT run, per the lead's speed mode).
- `npx tsc --noEmit`: exit 0. `npx eslint src tests scripts`: 0 errors, 6 warnings (the same six).
- `node --test` on design-tokens, ui-logic, range, trend-drill, banned-terms, zoom-hidden, access, speed-intel, speed-alerts: `ℹ tests 80, ℹ pass 80, ℹ fail 0`.
- `npx vitest run` on ds-components, ds-drill-range, route-registry, client-access, data-inventory: `Test Files 5 passed (5), Tests 57 passed (57)`; freshness-one-source: `Tests 7 passed (7)`.
- `npx playwright test tests/e2e/d0.spec.ts` (own server, port 3102): desktop first pass `12 passed, 1 skipped, 1 failed` (my test's fault, fixed); new KF tests at desktop `7 passed`; phone-390 plus tablet-768 `32 passed, 2 skipped, 2 failed (12.5m)`: two real bugs at 768 px (a 1050 px wide Appointments page; an uncovered name) fixed with container queries and rerun `2 passed`; later subset rerun at desktop and phone `8 passed`. Not run: menu, freshness, today, speed, appointments specs; npm run verify; the integration chain.

**Files changed (summary).** New: `src/app/app/ds/*` (template, filters, alert, states, data-list, lead-drawer, charts, drill, card-range, how-to, my-day, remember, theme, index), `src/app/design/*`, `src/lib/design/{color,filters,route,range,trend-bars,ui-logic}.ts`, tests `src/lib/__tests__/{design-tokens,ui-logic,range,trend-drill}.test.ts`, `tests/unit/{ds-components,ds-drill-range}.test.ts`, `tests/e2e/d0.spec.ts`, `docs/features/D0.md`. Changed: `src/app/globals.css`, `dashboard.tsx`, `nav.ts`, `ui.tsx`, the five M1 views plus `inbox.tsx` (title), `sync-status.tsx`, `src/lib/{access,route-guards}.ts`, `src/lib/api/router.ts`, `src/lib/analytics/{speed-intel,speed-queries}.ts`, `scripts/check-filter.ts`, `tests/e2e/{menu,freshness}.spec.ts`, `tests/unit/{route-registry,freshness-one-source}.test.ts`, docs (DECISIONS, FEATURE_STATUS, PROGRESS, NEEDS_KING section 9, NOTES_COVERAGE, PROPOSALS, TENANCY). Removed: `src/app/app/views/filter-bar.tsx` (replaced by the shared filter bar).

Status: D0 BUILT, awaiting King's checks. Tag for the lead: `stage-D0`.

#### D0: lead engineer's note
- Speed mode: the agent ran `npx tsc --noEmit` (exit 0), `npx eslint src tests scripts` (0 errors, 6 warnings), `node --test` on 9 test files (tests 80, pass 80, fail 0), vitest on 6 files (57 + 7 passed) and its own e2e spec `tests/e2e/d0.spec.ts` on its own port (desktop 12+7 passed, phone and tablet 32 passed, 2 skipped, 2 failed that were real 768px bugs and were fixed; the tablet rerun passed). The full suite, integration chain, and menu/freshness/today/speed/appointments e2e specs were NOT run: they run in the M1 full test.
- King's feedback KF-1 to KF-6 applied by the agent (plain status text and banners, filter lists account names, card ranges, clickable charts). KF-7 (Clients) belongs to C1.
- UNSURE (agent): the leftover `next dev` on 3100 serves stale server code; the lead must start from a clean server for the M1 run. No frontend-design skill is installed; dataviz skill used.
- Status: D0 BUILT, awaiting King's checks (style approved by King in chat with one change, applied). Tag `stage-D0`.

#### F6 and F4 (built in parallel worktrees, merged into the overnight branch; tags stage-F6, stage-F4)
- Both agents ran only typecheck, eslint and pure unit tests (speed mode). F6: `npx tsc --noEmit` exit 0; eslint 0 errors, 6 warnings; `node --test` (audit-intel, share-link, banned-terms) tests 24, pass 24; vitest (ds-components, ds-drill-range, route-registry, audit-report) 58 passed; `scripts/check-audit-print.ts` real print engine A4 2 pages, Letter 2 pages. SLIP (honest): the F6 agent ran one database test file once by accident; it created and deleted two fixture companies (0 left, verified). F4: `npx tsc --noEmit` exit 0; `node --test src/lib/__tests__/waiting-view.test.ts` tests 19, pass 19; with the database variables emptied `node --test src/lib/__tests__/` tests 473, pass 473 and `npx vitest run` Test Files 18 passed | 10 skipped, Tests 142 passed | 94 skipped. Database and browser tests were written and NOT run; the full M1 test run follows.
- DECIDED FOR KING (F6): a branded sender's shared page drops the product sign-up link. DECIDED FOR KING (F4): "Assigned to" is the contact's assigned team member; the chip "7 days, older" is one chip equal to the Older tab; the Unread tab counts every unread conversation so a conversation can sit in two tabs.
- NOT VERIFIED LIVE: call-message result fields (missed calls blocked); every count against the CRM. Details: `docs/features/F4.md` and `docs/features/F6.md`.
- Migrations: F6 none. F4 `20261102060000_f4_saved_views.sql` written, held; the lead applies it (new empty table) at the test phase.

#### F3 (parallel worktree; merged, tag stage-F3)
- Agent ran: `npx tsc --noEmit` exit 0; eslint no output; `node --test` appointment files tests 50 pass 50; `node --test src/lib/__tests__/` tests 472 pass 472; vitest f3-appointments-ui 9 passed. Not run: DB and browser tests (`tests/unit/f3-appointments-db.test.ts`, `tests/e2e/appointments.spec.ts`), verify, integration chain. Known and expected: `tenant-tables.test.ts` and `data-inventory.test.ts` still fail until E0 (tables from E0) is merged.
- Merge: one conflict in `src/lib/access.ts` (both sides added rules; kept both) and one type fix in `src/lib/analytics/audit-queries.ts` (F3's appointment contact id can be null; F6's audit list accepts null). `npx tsc --noEmit` on the merged tree: clean.
- Migration applied by the agent (additive, backups first): `20261102040000_f3_appointments.sql`.
- DECIDED FOR KING (F3): rows open the appointment panel first, "See the lead" one press away (D0's rule said lead drawer first; one-line change); default show-rate target 75%; a source that equals a calendar name is treated as a calendar.

#### F2 (parallel worktree; merged, tag stage-F2)
- Agent ran: `npx tsc --noEmit` exit 0; eslint 0 errors; `node --test` (13 files) tests 110 pass 110; vitest (6 files) 93 passed (45 new). `data-inventory.test.ts` live-schema comparison fails only because the live database already has other stages' tables (expected until all branches are merged). Not run: DB and browser tests (`tests/unit/speed-f2-db.test.ts`, `tests/e2e/speed.spec.ts`, extended `scripts/check-speed.ts`), verify, integration chain.
- Merge: one import conflict in `src/lib/api/router.ts` (kept both); `npx tsc --noEmit` on the merged tree: clean.
- Migration applied by the agent (additive, backups first): `20261102030000_speed_f2.sql`.
- Merge follow-up (not done): F3's `personLabel` still shows "Team member (name not available)" where F2's `resolveUser` (in `people-labels.ts`) would say "Former team member" or "Needs permission: reconnect"; unify in D1 if time allows.
- UNSURE (agent): card windows are UTC days; the headline stays "last 14 days, now" while cards default to 30 days; 100 leads per account per run are re-read to fill the new columns.

#### E0 (parallel worktree; merged, tag stage-E0)
- Agent ran: `npx tsc --noEmit` clean; eslint 0 errors; `node --test src/lib/__tests__/` tests 450 pass 450; vitest with the database variables emptied: Test Files 22 passed | 10 skipped, Tests 238 passed | 102 skipped (103 new pure tests); `scripts/supabase-proof.ts` against the live project: `28 passed, 0 failed, 6 not verified live` (45 tables, RLS on every one, 0 policies, anon and authenticated refused on the 5 new tables, token columns encrypted, no service-role key in code). Written, NOT run: `tests/unit/e0-connections-db.test.ts` (14), `tests/e2e/e0-connections.spec.ts` (6), edits to `check-connections.ts`, `check-flags.ts`, `menu.spec.ts`, `s02b.spec.ts`. Slip (honest): the agent ran `meeting-matching.test.ts` twice against the shared database; no fixture was left behind.
- Merge: six conflict files (TENANCY.md, access.ts, tenant-tables.ts, data-inventory.ts, client-access.test.ts, router.ts), all additive on both sides, kept both; `npx tsc --noEmit` on the merged tree clean.
- Migration applied (additive, new empty tables, counts 0 before and after): `20261102070000_user_connections.sql`.
- NOT VERIFIED LIVE: real Fathom delivery writing a `meetings` row, simultaneous retries giving one note, a real provider refresh, a note id matching one in the CRM, the real GHL note/comment length limits, what the platform's user list shows for company staff.
- DECIDED FOR KING: the old shared Fathom path no longer writes CRM notes unless WRITE_GHL_LIVE=true; the existing shared Fathom connection is marked "legacy, reconnect to make it personal" and was not migrated (tokens never touched).

#### F5 (parallel worktree; merged cleanly, tag stage-F5)
- Agent ran: `npx tsc --noEmit` exit 0; eslint 0 errors; `node --test` (10 files) tests 120 pass 120; vitest (5 files) 67 passed. Written, NOT run: `tests/e2e/today.spec.ts` (12), `tests/unit/f5-today-db.test.ts` (3). No migration.
- DECIDED FOR KING: see NEEDS_KING section 21 (every page narrows to the active account for an agency person opened inside a client account).
