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
| Clients (fees, renewals, QBR, compare) | Defer (QBR, renewal calendars) | partly | typed by hand | Health, onboarding, details and industries remain; Compare and Reviews/QBR are hidden by `reports` (default OFF). Real but empty until typed |
| Team | Not in Wave 1 (Wave 2 leaderboard) | no (`team`, default OFF) | deals, appointments, user names | Screen is hidden pending Wave 2; code retained. Names need the users permission, not yet approved on the real agency |
| Industry playbooks, compare setups | Defer | no | pipelines, calendars | Real, round 2 |
| Unanswered 24-hour private alert (Item 3) | Wave 1 #3 | off (`inbox_breach_alert`, default OFF) | cached conversation assignment and last-message time; verified account roles | Implemented with recipient-only delivery, dedupe, 10/day cap, quiet hours, and dry-run-only email. TypeScript, build, and 1,297 Node tests pass. Database test blocked (`unanswered_outcomes` missing); live tenancy sweep also blocked by `recipient_user_key` missing from the configured database. |
| Unanswered advanced operations | King-approved extension | off by default (`inbox_working_hours`, `inbox_workload`, `inbox_digest`, and `inbox_breach_alert`) | cached conversations, account timezone/settings, touch events, alert and notification records | Code includes business-hours timing, account-configurable unread-alert escalation, recovery metadata, ownerless/workload/handoff/spike alerts, weekly receipts with response patterns, unread markers, and fixed-choice outcomes. Pure rules are unit-tested. Live deployment is held until the schema is safely updated and the tenancy sweep passes. |
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
| AI assistant connector | Hidden (`ai`, default OFF; Wave 2) | Flag tests; read-only, per-client-account, API key required; code retained |
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
Open, for King: the three proposals in `docs/INNOVATION_M1_M2.md` (recommended: Alert outcomes). Nothing there was built without your yes.

## Simplification pass (8 Nov 2026)

`docs/SIMPLIFY_M1_M2.md` is the current screen, tile and settings inventory. King chose to expose all whole modules for live testing: Team, Clean-up, Duplicates, Compare/Reviews, AI, Meetings, Workflows, and Data health are on by default. Zoom/Google Meet and optional Inbox add-ons remain off. With no overrides, menu counts are agency 14→17, business/client admin 14→17, and client staff/setter 13→15; Compare and Reviews/QBR tabs remain 5. Overview remains at six metrics. Eight Settings sections and all essential controls remain. These are local code defaults, not deployed; existing global database overrides can still supersede them and were not changed.

### Item 3: 24-hour unanswered alert walkthrough (8 Nov 2026)

**VERIFIED in code; not verified against a live CRM or browser roles.** The alert flag is default OFF. When enabled, a waiting conversation is routed privately to its verified assigned account user, or to the verified account administrator when no owner is available. The Inbox shows the count to every caller who can see that account; the bell and Alerts list show a private alert only to its recipient.

| Person | What they see first | What they do next | Where they could get confused | Fix made |
| --- | --- | --- | --- | --- |
| Agency owner | Today, then the cross-account Unanswered messages queue; private alerts addressed to a setter or account admin do not appear in the owner's bell. | Open Unanswered messages, use the account breakdown, and reply to the oldest person in the CRM. | The Inbox API already returned a 24-hour count, but the page discarded it, making the alert invisible at agency level. | Show the 24-hour count above the queue and say the oldest person is first. Explain why the bell alert is private. |
| Setter (client account user) | Their account's Today page and the notification bell; an alert appears only when the verified conversation assignment is theirs. | Open the alert, review the named person at the top of the account's waiting queue, then open the CRM conversation and reply. | The old notification body pointed to Alerts while the link opened the Inbox; the Alerts action also went to the account page. | Make the body page-neutral, identify the person in the stored alert, and make the Alerts action open Unanswered messages. It still opens the queue, not a deep link to one conversation. |
| Client admin | Their account's Today page; they receive the private alert when no assigned owner can be verified. | Open the alert, check the account queue, and reply or assign the work in the CRM. | An account admin in a client view could mistake app-level notification settings for settings they can change. They also need to know why the alert came to them. | Explain the admin fallback on the alert and say only the administrator managing the app can change notification settings. |

**VERIFIED automated checks:** `npx tsc --noEmit`, `npm test` (1,284 passed), and the focused browser test at phone, tablet, and both desktop widths (4 passed). The browser run logged that the configured database is missing `notification_deliveries.recipient_user_key`; this did not block the Inbox assertions. **CHECK:** apply `20261118100000_unanswered_breach_alert.sql` only to a confirmed dev/test database, then rerun the breach database and expanded tenant tests. The environment has not been confirmed safe to migrate, so those database checks remain blocked.

| Workflows and campaigns (W1) | Flag `workflows`, default ON for pilot testing. List across client accounts, health checks with alerts (in app and email through the existing alert engine), campaign delivery from totals, Proof page, inline detail, working queue (Mark fixed, Snooze, Watch), labels, ratings and notes (SubSync only), change history with undo, guarded rename, publish, pause, copy and delete. Data source: workflow and campaign endpoints (docs/features/WORKFLOWS.md). Tested against live data: NO (mocks, a throwaway database and the demo only). Writes are rehearsals until `WORKFLOWS_WRITE_LIVE=true`. Field names of the search, log and statistics answers are CHECK items. |

| Workflows round 2 | Tidy up tab (names, duplicates, same workflow across accounts), turned-off and review-due prompts, saved views, command palette (Ctrl Shift K), hourly refresh route, weekly Proof email rehearsal. Demo and mocks only; not tested against live data. The Proof email is never sent from here (needs a dispatcher message type). |
| Data health (DH1) | Flag `data_health`, default ON for pilot testing. Score, daily history and since-install record, time slider, league table, quality firewall alerts by source, Imports view, finder lists with queue, safe phone and name fix (rehearsal unless DATA_HEALTH_WRITE_LIVE), undo, rules, Proof page, export, benchmarks (k 10 and 3 companies, opt out), weekly digest rehearsal. Unit and database tests pass on a throwaway database; NOT tested against live CRM data; fix write path untested against the real API. |
| Today: Growth tab (email leads) | Part of Today (no flag). Counters with change against the same stretch before, daily chart with 7 day average, sign ups to unique people, monthly goal per client with forecast, source mix, drop or spike in Worth a look and as a `growth` alert, league table. Read only from synced contacts. Needs migration `20261106110000_growth.sql` for goals and settings (degrades with a plain message). Data source: cached_contacts. Tested against live data: NO (demo company and two fixture companies only; run the manual count below on a real client). Check: pick one client, compare "This month" with the CRM's contacts created this month that have an email, after taking out copies and test records. |
| Today: Lead flow tab | Report. Four-column flow chart (new leads, replied or not, booked or not, showed up or no-show or no outcome), drop-off %, every step and band opens its people, dates (7 days default, 30 days, this month, last month, custom), "Too few leads to read" under 10. Data: contacts, first-reply check, appointments, deals; "Not checked" for leads older than the 14-day reply check (`docs/BLOCKED.md`). | Unit (flow, records, ranges), DB (counts, dates, cross-tenant, bad dates) and Playwright 1440 pass on seeded data. Not yet checked against King's live account. |
| Today: Clients coming and going | Report, company-level only (403 for client staff and business owners). Weekly added and removed chart (clickable), current count, recent list, one line on where counts start. New table `client_departures` (additive, in `PASTE_IN_SUPABASE.sql`); degrades to arrivals only without it. | Unit, DB (recording a removal, refusal, tenancy) and Playwright pass on seeded data. Departures start the day the migration is applied. |
| Today: Email leads list and CSV | Under Growth. One person once per client, search, client filter, 50 a page, CSV of what is shown without do-not-contact or unsubscribed, audit line per download. | DB (tenancy, filters, CSV, audit) and Playwright pass on seeded data. |
| Today: names, tags, "What is this?" | Every tab and section has a name, a one-line subtitle and a To do or Report tag; glossary in `docs/features/TODAY.md`. | Unit test over every tab; Playwright walks every tab. |
| Today: pointer on everything pressable | Global rule in `globals.css`; Playwright walks Today and every tab at 1440. | Pass on seeded data. |
| Today: Bring back | Per row and for all ticked rows on the set-aside list; toast with Undo; uses the existing server undo (own lane and clients only). | Unit and Playwright pass; contact panel and queue "..." menu do not show it (a set-aside row is not in the queue). |
| Today: click sweep | `tests/e2e/today-click-everything.spec.ts`: real mouse click on every visible control and every menu item at 1440 and 1024, agency owner and client staff (759 clicks in the last run). |
| Contact panel write-back | Notes, call results (note + tag + follow-up task), tags add/remove, Undo, cap, audit, own-write exclusion. Writes only when WRITE_GHL_LIVE is on (OFF). Data source: CRM contacts API (contacts.write, optional). Unit tests yes; DB and Playwright written, NOT run here; live CRM: NO. docs/features/CONTACT_WRITEBACK.md |

| Unanswered actions (round 3, slice B): open lead, claim, assign owner (batch), snooze, note, outcome, hide by default, clear junk | Wave 1 #3 | off (`inbox_open_lead`, `inbox_claim`, `inbox_assign`, `inbox_note`, `inbox_outcome_ui`, `inbox_snooze`, `inbox_hide_noise`, `inbox_clear_junk`; all default OFF) | cached conversations and contacts, deals, appointments, `touch_events` flags, SubSync marks | Server, rules and components written and unit-tested (stubbed platform only); components are not wired into the screen yet. Migration 20261120090000_unanswered_actions.sql NOT applied. NOT tested on a real CRM account; the delete request shape is not verified live. |

| Unanswered inside Speed to lead (stage merge-speed-waiting): tab "Unanswered" after Coverage, segments Everyone / New leads / Existing customers, dense list with density switch, sub-sections, old #inbox links kept as an alias | Wave 1 #3 | built on branch stage/merge-speed-waiting, not merged; same flags as Unanswered (`inbox_control_room` for the room; `inbox_filters`, `inbox_views`, `inbox_quiet`, `inbox_search`, `inbox_keys` for their parts) | Demo company only; DB test (SQL list with snooze and hide on) passes; browser check at 1079px wide done by hand, Playwright at 1440 written and run once, 390 and 768 not run |

| Customer review fixes (11 Nov, stage/customer-review): Race headline wording when nobody waits, People "have never had a reply" wording, shorter date buttons on a phone, no duplicate freshness text in the header, "Live, as of right now", Unanswered entry in the Speed guide | Review | on | UI copy and layout only; no data or flags changed | Checked by screenshot on the demo company (desktop 1440 and phone 390). typecheck and unit tests pass except one flag-defaults test that fails on main too. See docs/review/CUSTOMER_REVIEW_11NOV.md. |

Customer review test results (11 Nov, demo server, desktop-1440, one spec at a time): works: unanswered-in-speed "old address and new address open the Unanswered tab"; broken or not proven: unanswered-in-speed "every number equals the rows" (hit the 300 s timeout on the slow demo server, no assertion message seen), menu.spec (failed at "Overview stays within its six-metric cap", received 0 metrics, a page that was still loading, not touched by this change); not tested: f4, inbox, unanswered-v2, unanswered-actions, unanswered-capture, unanswered3-ac (their page-title and headline checks were updated to the Unanswered-in-Speed screen, not run because each test takes about 4 minutes on the demo server).
| Appointments actions and meetings (slice AB): panel with timeline, mark outcome, move with best slots, owner by drag and drop, edit, add, book again, delete (typed), bulk, undo, Fathom Meetings (match, suggested outcome, follow-up note and task, no follow-up list) | Wave 1 #2 | off (`appt_actions`, `appt_delete`, `appt_bulk`, `appt_meetings`) | SubSync copy of appointments, contacts, deals, touch events, own calls | Server, gateway, components and unit tests written (stubbed platform only); components are NOT mounted in the Appointments screen yet (integrator). Migration 20261125100000_appointment_actions.sql NOT applied. NOT tested on a real CRM; request shapes not verified live. |
| Pipeline 3 data and API (stage PD): deal history (append-only, webhook, sync and hourly sweep, flag `pl_record`), per-stage stale limits, money flow graph, drain by lost reason, replay, forecast range with track record, win rate, velocity, leak finder, deal health, who closes, sources, stage history, account health, weekly receipt, deal detail | Pipeline module | off (`pl_*` flags, default off) | cached deals, pipelines, contacts, appointments, own deal history | Built 11 Nov. Unit tests (27) pass. DB tests in tests/unit/pipeline3-db.test.ts skip until `20261126090000_pipeline3.sql` is applied (CI applies it to a fresh database). Not run on real data: history starts when `pl_record` is switched on, so flows and the replay stay empty at first and say so. Lost reason id needs a check in the live payload. |
| Pipeline deal actions (slice PB): deal panel with dwell against the stage's own median, timeline, move stage, owner, value, won/lost with reason, rename, note, task, one-tap unclog fixes, bulk, undo, delete (typed) | Pipeline module | off (`pl_actions`, `pl_bulk`, `pl_delete`) | cached_opportunities, deal_events, pipeline_actions (new, migration 20261126100000 not applied) | no: unit tests only (rules, gateway with stubbed fetch); request shapes NOT VERIFIED LIVE; needs opportunities.write |
| Team actions and reports (slice PB): coaching notes, targets, away marks and idle snoozes, one thing to work on, next-lead estimate, move leads with preview, protections and undo, client receipt (copy, print layout, CSV), quiet and overload alerts, weekly team lines for the summary email | Team module | off (`pp_coaching`, `pp_idle`, `pp_nextlead`, `pp_actions`, `pp_proof`; weekly lines use `pp_scorecards`) | location_users, lead_touches, touch_events, cached_conversations and contacts, coaching_notes, user_targets, user_away, people_write_log, people_proof_prefs (new, migration 20261203090000 not applied) | no: unit tests only (rules, gateway with stubbed fetch); the cross-tenant database test skips until the migration is applied; request shape (PUT contact with assignedTo) NOT VERIFIED LIVE; moving leads needs the optional permission contacts.write |
| Account audit history (stage AU): au_runs history (baseline at install, daily by view and sweep), then-vs-now with minimum rules, "since the last audit" sentence, added-lately list with "Audit this account", counts-only one-pager block, monthly re-audit message with per-account mute, typed confirmation to switch off a link (flags `au_history`, `au_onepager`, `au_monthly`, off) | built, unit tests pass, UI checked with ?aufx sample at 1280 and 390 | tested against live data: NO (needs migrations applied, then flags on) |
| Today module (stage TD): ranked "What to do today" with one button, Done today ledger, Proof (weekly receipt, copy, print, CSV), Numbers (max 6 tiles; Overview merged here, `#overview` redirects), Settings (daily email, quiet days), put-aside marks, my queue for a team member | Today | off (`td_module`, `td_today`, `td_proof`, `td_numbers`, `td_email`, `td_record`; old Overview behind `ov_screen`, off) | Clients rollup and live tables, speed_daily, td_daily_items, td_receipts | Typecheck and unit tests only; DB tests and a live check wait for the migrations (20261204090000 to 20261204110000) and the flags |
| Payments (stage PAY): Today (one sentence, 5 tiles that open their rows, money at risk with formula, recovered), Recovery queue (keyset paging, filters, saved views, side panel with timeline, copy-message in 3 tones, contacted, put aside, dismiss), Disputes log (preview, typed delete, due-date alerts), Upcoming (estimates and "Not available from the platform yet"), History (our own record), Setup | flags pm_* (default off in code; King switches on after the tenancy check); resend invoice pm_resend stays OFF | Data: platform payments, repeat payments, invoices and client paid plans (new optional scopes). Tested against LIVE data: NO (stub platform in tests/unit/payments-xtenant-db.test.ts; status words and amount units still to check on a real agency with scripts/pm-status-probe.ts) |
