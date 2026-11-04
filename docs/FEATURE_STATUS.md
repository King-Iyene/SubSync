# Feature status

One row per feature. **Class** is the brief's call (section 7 wave, or "defer" / "avoid" from section 8 and
13A). **Visible** is the default switch state (see `docs/DECISIONS.md`, 2026-10-31). **Live data** says
whether it has been checked against the connected test agency, not only demo data and automated tests.
Be sceptical of any "yes" that has no date: the only live audit so far is round 2 of `REPORT.md` (30 Oct
2026), which covered what each page showed on real synced data for contacts, deals and conversations.

Automated checks that run on every full run: unit tests (244), then HTTP checks for the whole API, the
connections, appointment insights, two-agency tenant isolation, feature switches and the Overview numbers.

| Feature | Class | Visible | Data source | Live data |
| --- | --- | --- | --- | --- |
| Today (daily brief, priorities) | Wave 1 #6 (digest) | yes | contacts, deals, conversations, own history | Shown on real data in round 2; own-history comparison needs more days of history |
| Account audit (Instant Audit) | Wave 1 #5, free tier | yes | deals, conversations, appointments (when readable), contact records | Built 31 Oct from the same numbers as the Overview; money checked to the dollar against it on demo data. Not yet run on the real agency; the appointment findings wait on the calendar permission |
| Speed to lead | Wave 1 #1 | yes | conversation messages (new permission), contacts | Built 31 Oct. Definition in METRICS. Numbers match raw rows on demo data. **Not run on real data**: needs the messages permission approved. Breach alert (in-app and Slack) built and tested end to end on demo data; no email yet |
| Overview | Wave 0 (fixed, see METRICS) | yes | contacts, deals, conversations | Real data audited in round 2; the new rules (deals without value or owner left out, 20-deal minimum) are checked on demo data only |
| Inbox and SLA | Wave 1 #1 and #3 | yes | conversation summaries (no message text, no sender user) | Real in round 2. Not yet true speed-to-lead: it has no first-touch time or who answered. Needs the conversation messages permission |
| Appointments (to do) | Wave 1 #2 | yes | calendar events | **No.** The real agency has not approved the calendar permission yet (all three accounts show "needs permission") |
| Appointment insights | Wave 1 #2 | yes | calendar events, contacts, deals, conversations | **No**, same reason. Demo data and unit tests only |
| Call lists | Wave 1 #4 | yes | contacts, deals, appointments, conversations | Real in round 2 (lists); no-show list waits on appointments |
| Contact search | Free tier (brief section 6) | yes | contacts | Real, round 2 |
| Pipeline and deals | Needed for Instant Audit (stale value) | yes | deals | Real, round 2 |
| Accounts and account detail | Core | yes | all synced data | Real, round 2 |
| Setup checklist and email sender health | Core / Instant Audit | yes | calendars, pipelines, DNS | Real, round 2 |
| Alerts | Wave 1 #1 | yes | derived | Real, round 2 |
| Settings (thresholds, branding, daily brief, Slack web address) | Core, Wave 1 #7 (partly) | yes | settings | Real |
| Getting started | Wave 1 #8 (in-app help) | yes | derived | Real |
| Duplicates | Defer (13A) | no | contacts | Real data in round 2. The list is now grouped by name, searchable and paginated (20 rows a page) |
| Data cleanup | Defer (13A) | no | contacts, writes with typed confirmation | Never run on the real account (needs a write permission SubSync does not request) |
| Meeting notes | Not in v3 | no | meeting tools | No |
| Connections (Slack, Fathom, Zoom sign-in) | Avoid (connector catalog) | no | provider apps | **No.** Provider apps do not exist yet. Tested with signed pretend deliveries only |
| Leads | Not in Wave 1 | no | contacts | Real, round 2 |
| Clients (fees, renewals, QBR, compare) | Defer (QBR, renewal calendars) | no | typed by hand | Real but empty until typed |
| Team | Not in Wave 1 (Wave 2 leaderboard) | no | deals, appointments, user names | Names need the users permission, not yet approved on the real agency |
| Industry playbooks, compare setups | Defer | no | pipelines, calendars | Real, round 2 |
| AI assistant connector and keys | Not in v3 (AI is Wave 2) | no | all | No |
| Branded reports and exports | Defer (white-label PDF reports) | partly | derived | Exports of stale deals, duplicates, inbox, deals and alerts remain on; branded reports are behind the reports switch |
| Show only filter (industry, owner, hide test accounts) | Not in v3 | yes | settings | Industry needs typing on the Clients page, which is now hidden |

## Not built yet (Wave 0 and Wave 1 gaps)

- Speed to lead: screen, rules, sync and the in-app and Slack breach alert are built. Still to do: email delivery (needs an email service key) and verification on real data once the messages permission is approved.
- Instant Audit: the page and a copy-able summary exist. Still to do: run it automatically at install, a share link a client can open, and verify on live data.
- Weekly digest email per agency and account owner (Wave 1 #6): the daily brief goes to Slack only; no email service key.
- White-label UI: agency logo and colours with the SubSync name hidden (Wave 1 #7). Only a business name and colour for printed reports exist.
- Roadmap with voting and a change log page (Wave 1 #8).
- Plan entitlements are built and tested (open by default). Still needed: the $9 plan in the portal, its id mapped, and enforced mode switched on (section 6).
- Verification of every PRIORITIZE feature against live data and a manual count: blocked on the calendar and users permissions being approved on the real agency, and not yet repeated for the new Overview rules.

## Live check on real accounts (31 Oct 2026, after the permissions update)

| Feature | Result on the three real accounts |
| --- | --- |
| Today and Do this first | Works: real pipeline, 284 unread, ranked attention list |
| Appointments | Works: 38 appointments read, 24 booked in the 30 days before, show rate 60%, none booked in the last 30 days |
| Speed to lead | Works: 10 leads timed, 9 still waiting, 1 answered inside 15 minutes; median shows "not enough data" until 5 replies, as designed |
| Settings: client access per account | Works: switch and On/Off badge per account |
| Zoom sign-in | Connect Zoom button live; real sign-in and a real summary not yet tested (needs paid host) |
| Weekly and alert email | Keys present in production; first real send not yet observed |

## Runbook stage S0.1 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| `npm run verify` | Built | Green |
| `npm run e2e` (3 widths, demo tenant) | Built | 21 pass |
| Demo login blocked in production | Built | Unit tests plus a live check (HTTP 403) |
| Kill switch `APP_MODE=maintenance` | Built | Unit tests and browser test; not yet flipped on the real site |
| New features default off (guard test) | Built | Unit test |
| Golden dataset (speed) | Built | 4 unit tests |
| Phone and tablet layout fix (wide tables) | Built | Browser tests on 5 pages |

## Runbook stage S0.2 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| Identity from the verified SSO payload, five roles | Built | Unit tests (all roles and edge cases) and sign-in route tests with fixtures; not yet with real users in the CRM |
| Agency staff refused (default deny until Users API check) | Built | Unit and route tests; live check is King's check 4 |
| Account user read-only | Built | Unit, route and 9 attack tests |
| Tenant isolation, two agencies | Built | 384 cross-reads plus share link and webhook attacks, all refused |
| Uninstall and "delete my data" purge every tenant table | Built | Real database, fixture company; schema-drift test |
| Route guard registry and `docs/TENANCY.md` | Built | Test fails on any unlisted route |
| Safe logging, bundle scan, history scan | Built | Scripts green; gitleaks not used (not installed) |

## Runbook stage S0.3 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| `crmUrl` helper; every CRM link built from the white-label domain | Built | Unit tests; browser run with a fake white-label domain; not yet with a real white-label login |
| No platform name or internal words (agency, sub-account, location) on any screen, email, error or install page | Built | Syntax-tree scan (fails the build) and 30 browser tests over 20 screens plus public pages |
| Shared audit page wording | Built | Real shared page checked in the tenancy script |
| Platform's own install consent screen | Not ours | Not changeable; the white-label install URL is still a CHECK |

## Runbook stage F1 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| One definition of open pipeline on every screen (counted deals) | Built | Consistency browser tests on the demo tenant; database check on KD Squares Test |
| One minimum of 20 closed deals for every win rate and forecast | Built | Golden dataset unit tests; old tests moved from 5 to 20 |
| Outlier note, left-out deals sentence, estimate label with formula | Built | Browser tests; unit tests for the rule |
| Leads "Quiet over 90 days" | Hidden ("Not measured") | Database: no contact has recorded activity |
| Currency | Not stored, labelled | Open issue |
| CRM comparisons (new contacts, unread conversations) | Pending | King's checks |

## Runbook stage F2 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| Lead rules: bulk import, spam, test, do not contact, duplicate left out | Built | Unit tests, real-database test, browser test on the messy demo |
| Calls count as a first touch | Built | Unit tests only (no live call seen) |
| Business hours and time zones (off by default) | Built | Unit tests (incl. daylight saving), real-database test; not yet on a real account |
| Meta lead forms as their own source | Built | Unit and browser tests; live recording of Meta leads unconfirmed |
| Plain-words headline, left-out sentence | Built | Browser tests at 3 widths, screenshots |
| Real estate sample audit page | Built | Browser test; fictional data |
| Figures match raw rows | Verified | `check-speed.ts` against the database |

## Runbook stage F3 (31 Oct 2026) and King's "show every page" request

| Item | Status | Tested |
| --- | --- | --- |
| Appointment rules: invalid excluded, 10-appointment baseline for change claims, group events, time-zone same-day, status folding | Built | 8 golden tests, demo browser tests |
| Insights tab | Verified working on the demo at 3 widths | Browser test with screenshots; real windows are empty (all 38 real appointments are from September) |
| AI assistant connector switched on (no feature is off by default now) | Built | Flag tests; read-only, per-client-account, API key required |
| Menu: Settings, Getting started and What's new pinned so they are always visible; spacing compacted | Built | Browser test on a short window |

## Runbook stage F6 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| Share link: 14-day expiry, view count, owner-only switch off, audit log entry | Built | Tenant isolation script (real server and database) |
| Public page: noindex, generic preview, no names, rate limit, snapshot and expiry dates | Built | Tenant isolation script, logged-out browser test |
| One-page fix plan and "What we found" on the public page | Built | Browser test; sample audit carries fix steps |
| Print on A4 and Letter | Built | Browser test: real PDFs of 2 pages or fewer |
| Real estate sample audit (fictional) | Live at /audit/sample-real-estate-team-audit | Browser test |

## Runbook stage F4 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| One waiting definition and window (customer wrote last, past the target, 30 days) on every screen | Built | Rule tests, database agreement test, browser test (Inbox total equals Overview) |
| Headline in words, window named, channel counts, CSV channel column, list limit 2,000 | Built | Browser tests at 3 widths |
| Internal notes, automatic replies, deleted conversations | Documented and tested (notes never wait, automatic replies count as replies, the sync replaces the list) | Unit and database tests |
| Ignore automatic replies setting | Not built (needs the message source) | n/a |
| Conversation sync cap (1,000 per account) | Known limit | Real accounts hit it |

## Runbook stage F5 (31 Oct 2026)

| Item | Status | Tested |
| --- | --- | --- |
| Today front door: leads waiting, appointments to fix, accounts needing attention, in plain words | Built | 15 browser tests at 3 widths |
| Today rebuilt: outcome headline, Fix first queue, clickable donut and bars, vs your usual, what SubSync caught, account view for setters and client staff (3 Nov 2026) | Built, awaiting King's checks | Demo company only, not yet on real installs (docs/features/TODAY.md) |
| Today second pass (4 Nov 2026): the records behind every number in one panel, spotted today, since your last visit, if nobody acts today, People, Sources and Coverage tabs, working queue (Done, Snooze, Assign, Undo; SubSync only), junk control, saved views, Ctrl K palette, printable report, fixed-column Fix first rows, new account list layer | Built, awaiting King's checks | Demo company and fixture companies only, not yet on the three real installs. Browser tests (desktop 1440): `today2.spec.ts` (columns line up at 1440 and 1024; picker Done, Show all accounts, Esc, outside) and `today2-controls.spec.ts` (every control). Database tests: `today-actions-db`, `today-views-db`. Needs migration `20261104090000_today_actions.sql` for the buttons; Today opens without it |
| First-sync-only banner, filter drawer, one-sentence subtitle, outlier note | Built | Browser tests |
| Opens on the launching client account, with a way back to all accounts | Built | Browser test (simulated launch) |
| Overview merged into Today and hidden | Not done on purpose (King: do not hide pages) | n/a |

## Runbook stages F7 to F9 (31 Oct 2026, built; tests run at the end)

| Item | Status | Tested |
| --- | --- | --- |
| Accounts and account detail in plain words, defined health rules, what-this-means panel | Built | Tests written, not yet run |
| Settings in five groups, change log updated, behavior tests for every setting, client access enforced and brand name on the shared page (tenancy script) | Built | Tests written, not yet run |
| Alert emails sent once, retried, quiet hours, stop link and one-click header, unmarked appointments alert | Built | Tests written, not yet run; real send and sending-domain check pending |


## Stage S0.2b: Tenancy follow-ups (1 Nov 2026, built; awaiting King's checks)

| Item | Status | Data source | Tested against live data |
| --- | --- | --- | --- |
| Cross-client "same person" card and count removed (N48) | Built | none (removed) | Unit and integration tests; no query compares people across accounts |
| "What we store" generated from the schema; privacy page and help text produced from it (N83) | Built | database schema (migration files and live database) | Yes: compared with the live schema, 39 tables |
| "Delete my data": owner only, typed word, audit entry (N83) | Built | session identity | Yes: two real fixture companies over HTTP |
| Uninstall and "Delete my data" delete what the text says (N83) | Built | real rows | Yes: fixture company with a row in every table |
| Client accounts' staff never receive fees, notes, settings, tickets or other clients' data; access off is immediate (N84) | Built | two real fixture companies | Yes (HTTP, every route a client may and may not call) |
| Login domain found at sign-in and install event; Settings field is an override (N82) | Built | sign-in and install event | Database tests yes; a real signed install event NOT VERIFIED LIVE |
| Setting "save unmatched meetings in an account" removed; stored values migrated (N93) | Built | none (removed) | Yes: live table backed up, counts before and after; matching tests on real rows |
| Zoom and Google Meet hidden behind a switch, off by default | Built | feature switches | Yes: API check with the switch off, browser run at the default state |
| Meeting notes page behind its own switch, off until E2a | Built | feature switches | Yes (menu test updated to the new rule) |
| Refresh every 15 minutes (the due rule measured from the start of the last cycle) (N33) | Built | sync job table, cron every 5 minutes | Yes: live history shows what it was (20 min); the new rule is proven by a fake-clock scheduler test and database tests; the 15 minute cadence itself NOT VERIFIED LIVE until merge (`scripts/sync-timeline.ts`) |
| One freshness line above every page; same sentence in Today, Overview, Sync status and the Slack brief (N74, N6) | Built | last successful refresh per account | Yes: real rows over HTTP (`scripts/check-sync.ts`) and every page in a browser (`tests/e2e/freshness.spec.ts`) |
| Sync status panel: next refresh, per-account refresh, failures with plain reasons, what runs when (N81) | Built | sync job table, accounts | Yes: fixture company with a failed read, stale account, long-running job |
| "Sync is running" note only for a first sync or one running 10 minutes or more (UX-06) | Built | sync job table | Yes |
| Internal sync alarm (older than 30 minutes) to the audit log, and a secret-only diagnostics address (N33) | Built, notification is a dry run | sync job table | Yes on real installs (0 alarms now); outward notification not built |
| "Send at" honoured per time zone, once a day, 3 hour catch-up (N80) | Built | settings, clock | Yes with fake clocks across 7 time zones and both 2026 New York clock changes; a real send NOT VERIFIED LIVE |
| Install and uninstall webhooks accepted under the names the platform really sends (INSTALL, UNINSTALL) | Built | live webhook log | Names verified from the live log; a real uninstall event NOT VERIFIED LIVE (`docs/NEEDS_KING.md` section 15) |
| One counted-deal rule everywhere: value, owner and in play (N38, UX-02) | Built | synced deals, owner's stage rules | Yes: golden deals in a real database (`tests/unit/f1-deal-scope-db.test.ts`), 37 pages under 5 filters (`scripts/check-filter.ts`); real agency: 1 counted deal of 10,374 open (1,033 closed out by name, 9,189 no value, 151 no owner); the CRM comparison is King's check |
| Stages and pipelines: the owner classifies, with name suggestions; win probability per stage (N37, N38) | Built | `stage_rules` table | Yes over HTTP with two agencies, a business and a client (`scripts/check-stage-rules.ts`); real: 13 of 80 stage pairs closed out by name |
| Forecast as a range with a method drawer, owner assumptions, timing from the real sales cycle (N37) | Built, no real account has enough closed deals to show one | synced deals | Hand-worked unit tests; real accounts correctly say "No forecast yet" (6 closed deals); forecast versus actual each month NOT built (P1) |
| Definition versions: history never drawn across a change of rule (N39) | Built | `account_metrics_daily.definition_version` | Yes: golden history in a real database; the real series (2,400,000 then 1,000,000) is the case it fixes |
| Unread and waiting told apart; the wait chart over the same set; Critical only a day to a week; the 500-conversation limit stated (N15) | Built | synced conversations | Yes: real figures 285 unread, 24 also waiting; the chart equals the list under every filter |
| Health label held down by waiting customers; never Healthy in Needs attention (N16, N62) | Built | derived | Yes: unit tests and demo browser test; real: KD Squares LTD 21 waiting, was Healthy, now At risk |
| Leads: cold lists, engaged then quiet, "not checked", missing apart from invalid, sources action (N45, N46, N47) | Built | synced contacts, conversations, appointments, deals | Yes: golden leads in a real database; the SQL and JavaScript validity rules proven identical; real: 50,958 of 52,926 contacts on cold lists, 0 invalid emails of 50,891 checked |
| Percentage change only on a base of 10 (5,000 dollars) (N6) | Built | daily numbers | Yes: unit tests, demo API test |
| The same filter gives the same numbers on every page (N1, N8) | Built | all pages | Yes: 5 filters, 37 pages, 3 pages that ignored the filter fixed |
| Data point audit (N44) and capability matrix (N64) | Written; the cut list awaits King | docs | Capability live column NOT VERIFIED LIVE (one call after the merge: `/api/admin/capabilities`) |

## Stage D0: structure, design tokens, shared components (1 Nov 2026)
| Feature | Status | Data source | Tested against live data |
| --- | --- | --- | --- |
| Design tokens, light and dark, company colour on top | built (BUILT, awaiting King's checks) | src/app/globals.css | contrast unit test reads the real CSS; browser checked at 3 widths on the demo company |
| /design style guide | built | made-up sample data in the page | no (no real data involved) |
| Pilot menu, People tabs, My day | built | existing endpoints | demo company only |
| Filter bar with account names and left-out reasons | built | segments (agency) | demo company; it has no test or ignored account |
| List, lead panel, notices, states, charts | built | existing endpoints | demo company only |
| Clickable charts, card ranges | built, on the Speed to lead trend | speed trend with the leads behind each week | count equals rows by unit test; demo company in the browser |
| E2b Meeting notes destinations (note, comment, contact field, parts, layouts, locks) | Wave 2 (meeting notes), behind the Meeting notes switch | no (switch off by default) | Fathom delivery (E2a), the account's own field list (needs the optional read permission) | **No.** Fixtures and a local database only; real CRM limits, comment permission and field writes are INFERENCE/CHECK (docs/features/E2b.md) |

## Stage D1: design polish, light and dark, Mode A review (3 Nov 2026)
| Feature | Status | Data source | Tested against live data |
| --- | --- | --- | --- |
| Flat blocks (no card inside a card), key-figure strips, one slim toolbar row | built (BUILT, awaiting King's sign-off) | shared pieces in `ui.tsx`, `dashboard.tsx` | demo company only, 3 widths, light and dark (60 captures): 0 nested boxes |
| Restrained motion: page fade, bars grow, figures count up once, grey loading placeholders; all off under reduced motion | built | none | browser: with reduced motion the figure is final at first read; without it `$0` then `$1,397,934`; unit tests for the rules |
| Contrast fixes (status colours, ticks) | built | theme tokens | browser contrast check: 0 failures in 92 captures (demo company) |
| Mode A buyer and UX review, S0 and S1 fixed | built | screenshots | demo company; no real person (Mode C) |
| `scripts/ui-check.cjs` (repeatable UI check) | built | demo app | demo company |


## Final test run before the merge to main (3 Nov 2026) — run in a sandbox with a throwaway local Postgres, NOT against Supabase

Everything below is VERIFIED only for what it says. Nothing was run against the live Supabase project, the real CRM, a real mailbox, Slack or Fathom (no credentials in the sandbox). Those stay **NOT VERIFIED LIVE**.

| Check | Result |
| --- | --- |
| Typecheck, lint, production build, bundle secret scan | Pass (lint: 0 errors, 9 warnings about unused variables) |
| Node unit tests (`src/lib/__tests__`) | 751 of 751 |
| Vitest, incl. real-database tests on a local Postgres built from the 39 migrations | 714 of 714 (57 files) |
| Tenant isolation, two agencies, 448 cross-tenant reads as agency, business, client and forged sessions | All refused (`scripts/check-tenancy.ts`) |
| Share link: revoke, 14-day expiry, view count, rate limit (30 a minute), generic preview | Pass (inside the tenancy script) |
| Entitlements in `enforced` mode (free list, 402 for paid, plan swap is a row, unknown plan fails closed) | Pass (`check-entitlements.ts`); `open` mode runs with every other check |
| White-label scan (no platform name in screens, emails, errors; default-domain links allowed only as the non-white-label fallback) | Pass (Node banned-terms tests and `check-audit.ts`) |
| HTTP integration checks: api, connections, insights, sync, flags, metrics, filter (37 pages x 7 filters), stage rules, speed, roadmap, F8, audit | All pass |
| Browser suite, desktop 1440 px (the real target: a desktop web app inside a CRM) | 226 passed, 20 skipped by design, 1 intermittent failure (`f4.spec.ts:34`, an API shape test that passes on its own and failed only in the full run; order-dependent, INFERENCE) |
| Browser suite at phone 390 and tablet 768 px | Not a gate. Two real sideways-scroll bugs found and fixed; the full phone and tablet runs were not repeated on the final code |
| Security review against GHL's review standard | `docs/SECURITY_REVIEW.md`: 0 critical, 0 high, 2 medium (1 fixed, 1 low-risk left, see below), 8 low |
| Real data against manual CRM counts (F1, F2, F3, F6) | **NOT VERIFIED LIVE** (needs the live database and King's CRM counts) |
| `scripts/supabase-proof.ts` (live schema equals the repo) | **NOT RUN** (needs King's credentials) |

### Real bugs the full run found and fixed (not test changes)
1. Removing one client account left its feedback rows behind (`feedback_items` was missing from the per-account purge). Privacy gap.
2. The Appointments page scrolled sideways on a phone (shared filter dropdown) and `/design` did too (screen-reader chart tables). Both fixed.
3. The quarterly review claimed problems were "sorted out" when SubSync only knows they stopped showing. Now says "cleared (fixed, dismissed or no longer showing)". A proof feature is proposed in `docs/INNOVATION_M1_M2.md`.
4. Dial setting label bound to the wrong element (duplicate id), Ctrl+K then Enter closed the panel it opened, a duplicate Settings heading, and a reset message lost on save.
5. The Connect button was disabled in the demo, and the demo agency session could not show the owner-only screens (demo only; unreachable in production).
6. Security: a signed webhook meant for another app could purge one of our installs; cron and admin secrets are now compared in constant time; `nosniff` and `Referrer-Policy` added; typed People searches (a name, email or phone) no longer go into browser storage.

### Customer walkthrough (Prompt B), M1 and M2. INFERENCE: from the demo company, the screens and the tests, not from real users.

| Module | Agency owner: sees first, does, gets confused by | Setter (client's staff): same | Client admin: same |
| --- | --- | --- | --- |
| Today | Leads waiting in one sentence, then accounts needing attention. Does: open the worst account. Confusion: "Filter accounts" is collapsed, so people do not know why a number is smaller (it now says what is left out). | Opens on My day, not Today. Sees their own leads to call. Confusion: none found; no settings or plan. | Same as the owner but one account. |
| Speed to lead | Median and share answered inside the target, accounts ranked. Does: open the accounts that fail. Confusion: "not enough data" until 5 replies; the screen now says "1 of 5 replies so far". | Own leads waiting. | Own account, ranked people. |
| Appointments + Insights | Unmarked appointments and no-shows to recover; true show rate. Confusion: a health score of 73 on a rich demo vs "n/a" on a thin account; the rule (needs 3 of 4 checks) is explained on the card. | Own appointments to mark and remind. | Own account. |
| Unanswered messages | Counts by age, saved views. Confusion: unread vs waiting (told apart). | Own queue. | Own account. |
| Account audit + share link | The sellable asset. Does: share a link with a prospect. Confusion: none after the white-label fix; link expires in 14 days and can be switched off. | Not shown. | Own account's audit. |
| Clients | Health, onboarding, fees, compare, quarterly review. Confusion: five tabs; QBR wording fixed. | Not shown (no fees, notes or other clients; tested). | Not shown. |
| People and Call lists | Search, smart lists, going cold. Confusion: four tabs; the header search now hands off in memory. | Own contacts and call lists. | Own account. |
| Settings, Getting started, What's new | Eight sections. Confusion: finding where Slack, Fathom and alerts live (Integrations, Connections). | Short guide only. | Guide for business admins. |
| Connections and meeting notes (E0, E2a, E2b) | Own Fathom connection plus a team status table (names and status, never content). Behind a flag and dry-run switches. Confusion: "Needs permission: reconnect" for comments until a write permission is approved. | Own connection only. | Own connection only. |

Top three problems fixed from the walkthrough: (1) sideways scrolling on phones, (2) the review overclaiming fixes, (3) a Ctrl+K search that closed the panel it opened.
Open, for King: the simplify cuts 7 to 14 in `docs/SIMPLIFY_M1_M2.md` (hiding Duplicates and Cleanup, merging Team into Settings, Compare and Reviews), and the three proposals in `docs/INNOVATION_M1_M2.md` (recommended: Alert outcomes). Nothing there was built without your yes.
