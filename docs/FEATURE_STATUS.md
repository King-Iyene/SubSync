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
