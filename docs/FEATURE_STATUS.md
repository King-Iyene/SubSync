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
