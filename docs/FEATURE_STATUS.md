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
