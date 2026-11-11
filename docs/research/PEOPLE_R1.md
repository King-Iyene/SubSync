# People (team) module: landscape, pain, errors, moat (R1, 11 Nov 2026)

Method: web search plus page fetches. Many sources are vendor blogs (biased). Labels: VERIFIED = read on the page; INFERENCE = my reasoning; UNVERIFIED = secondhand, vendor claim or search snippet only. Scope: the agency's TEAM across client accounts (setters, closers, support, owners). The repo today has two things with the word People/Team: the **Team** screen (`views/people.tsx`, route `team`, per-user deals, idle and reply pace) and the **People** screen (`people-module.tsx`, a lead search and call lists, NOT staff). This research covers the staff side.

## 1. What GHL gives natively, and the gaps

- **Agent Reporting** (per user): opportunities and conversions, SMS and email stats (automation excluded), call metrics split automation / manual / dialer / incoming, sales value, cycle and velocity. Filters: team members, date range with Compare, pipeline. VERIFIED: https://growthable.io/gohighlevel-tutorials/reporting/agent-reporting/ (a tutorial blog, not official docs; the page does not say who can open it).
- **Appointment report** filterable by user (booked, showed, no-show, cancelled). UNVERIFIED (blog): https://consultevo.com/gohighlevel-appointment-report-guide/
- **Per sub-account, never across accounts.** The agency dashboard rolls up accounts, not people. UNVERIFIED (blogs): https://consultevo.com/gohighlevel-agency-rolled-up-reporting/ . No native cross-account setter or closer leaderboard found. INFERENCE.
- **Flat user model**: no "team" or manager hierarchy; only Admin and User roles. VERIFIED: ideas board, 132 votes, Oct 2025, comments to Sep 2026, no status shown: https://highlevel.canny.io/users-permissions/p/please-please-please-more-user-roles-and-granualr-permissions
- **Ideas board request** for cards comparing individual appointment-setter performance across a team (no shipped status found): https://ideas.gohighlevel.com/dashboard/p/gohighlevel-dashboard-enhancement-request . A second request, "appointment: who set the appointment", exists: https://ideas.gohighlevel.com/dashboard/p/appointment-who-set-the-appointment (title only, UNVERIFIED content).
- **Vendor critique** (Kixie, sells a dialer, biased): native reporting is per individual only, retrospective, counts voicemail as "answered", no dispositions. UNVERIFIED: https://www.kixie.com/sales-blog/how-to-get-advanced-sales-reports-in-gohighlevel/

## 2. What the API really gives us (use only this)

- **Users**: `GET /users/search` (needs `companyId`; optional `locationId`, `type`, `role`; agency or sub-account token; scope `users.readonly`; Version v3). Each user: id, name, first/last name, email, phone, extension, `roles {type, role, locationIds[], restrictSubAccount}`, `permissions{...booleans incl. assignedDataOnly, agentReportingEnabled}`, `deleted`, platformLanguage. VERIFIED: https://marketplace.gohighlevel.com/docs/ghl/users/search-users.md
- **NOT available**: last login time, online status, shift or working hours, call duration by person unless the call record carries it (CHECK), per-user activity feed. VERIFIED absent from the Search Users spec. Consequence: "idle" can only mean "no recorded activity in the CRM", never "not working". Calls made on a personal phone are invisible.
- **Already in our database** (repo, VERIFIED by reading migrations): `location_users` (name only; installation, location, user; no role, email or access list); `team_names` (typed or platform names); `touch_events` (one row per message or call: direction, channel, kind, `user_id`, `automated`, source, outcome; metadata only); `lead_events` (created, first_touch, owner_changed with user_id); `appointment_history` and `appointment_facts`; `deal_history`/`deal_facts`; `speed_daily` (by_owner counts); `cached_appointments.assigned_to` (owner only: no field for who BOOKED it); contact and deal owner columns.
- **CHECK before building**: whether calendar events carry a creator/booked-by user (not stored today); whether call messages carry a talk duration and `userId`; whether `roles.locationIds` is empty for "all accounts" admins; page limits of Search Users (default 25).

## 3. Competitors

| Tool | What it does for people | Price | Label |
|---|---|---|---|
| Kixie | Live leaderboard (15 s refresh) of calls, connections, talk time, SMS, presence, by SDR or AE board; dispositions sync to GHL; time windows to 30 days. Reads its own phone switch, so it needs its dialer | Not shown on the page | VERIFIED page: https://www.kixie.com/sales-blog/how-to-create-a-real-time-sales-leaderboard-for-gohighlevel/ |
| Aloware | Dialer inside GHL with two-way sync and its own performance reports; no agent-leaderboard docs found | Not retrieved | UNVERIFIED: https://aloware.com/integrations/gohighlevel |
| HubSpot Sales Hub | Rep analytics, goals, call coaching and conversation intelligence mostly on Enterprise; Professional about $90 to $100 per seat per month | about $90 to $100 per seat | UNVERIFIED (aggregators): https://blog.hubspot.com/sales/hubspot-sales-hub-pricing |
| AgencyAnalytics, Databox | Client-marketing reporting (channels, ads, SEO); no staff view found. Prices were not re-checked here (Clients research: about $20 per client for AgencyAnalytics, UNVERIFIED) | | INFERENCE |
| Chili Piper | Lead routing and booking; round-robin and capacity rules. Search returned nothing | NOT FOUND | NOT FOUND |

Takeaways. INFERENCE: (a) dialer vendors rank people on their own phone data; they cannot see replies, appointments set, shows or deals across accounts. (b) HubSpot-class tools are per-seat, single CRM, priced far above $11.50 per account. (c) Nobody found ranks a team ACROSS client accounts from outcomes (answered, booked, showed, won) with fair normalisation. That is the gap.

## 4. Customer pain (all secondary; no firsthand Reddit or Facebook voice reachable)

- Agencies that split setting from closing cannot see each setter's output; this is the 2025 ideas request above. VERIFIED that the request exists, not how many want it.
- Staff users cannot be limited to the right accounts or contacts without hacks (house accounts, followers). VERIFIED (132-vote thread). Agencies want per-person access to a subset of accounts.
- Leaderboards demotivate when ranked on raw totals; they reward territory and lead quality, not skill; activity counts get gamed. Fixes: normalise for lead source and account, count only calls above a minimum length, audit against connect rates, measure only what the person controls. UNVERIFIED (vendor and consulting blogs): https://blog.hubspot.com/sales/5-bad-sales-leaderboard-practices-to-avoid-at-all-costs ; https://salesscreen.com/blog/weighted-scoring-for-sales-leaderboards-guide ; https://us.fitgap.com/stack-guides/measuring-sales-performance-fairly-across-segments-with-normalized-benchmarks
- Gaps to confirm in King's 5 owner interviews: "Who is slow in which client?", "Who do I put on the new client?", "Who deserves the bonus?"

## 5. Biggest sources of error (design against each)

1. **Wrong person credited.** The contact OWNER is not the person who answered; the appointment owner is not who booked it. Credit actions to the actor (`touch_events.user_id`), outcomes (show, win) to the owner at that time (use `lead_events.owner_changed` and the history tables, not today's owner).
2. **Automated vs human.** Workflow messages, missed-call text-back and AI replies carry no human. Count only `automated = false` with a user_id; show automated separately. A touch with no user_id is "unknown", not a person.
3. **Users in only some accounts.** A person's numbers must be built per account and shown with the accounts they work in; rank only inside the accounts they share with peers. The agency owner and admins appear in many accounts and skew totals (flag as "owner/admin", exclude from ranking by default).
4. **Deleted, renamed or duplicate users** (same person, two ids across accounts; `deleted: true`). Key by id; match across accounts only by id or verified email, never by name guess (operating principle 13).
5. **Lead quality and volume differences.** Two setters on different sources are not comparable raw. Compare within the same account and source mix; show "not enough data" under a minimum (propose 20 leads and 14 days); never rank on small samples.
6. **Our own writes** (notes, internal comments, reassignments) must not count as a person's activity (principle 14).
7. **Idle misread.** Without login data, a quiet person may be on the phone. Label "no activity recorded in your CRM".
8. **Time zones and hours.** Count response time inside each account's business hours (existing Speed rule), not wall clock.

## 6. Moat from our own recorded history

Only we can show, per person and over months: first-response time before and after a coaching change; booked-to-showed rate by who booked; handoff quality setter to closer (days from booked to deal); workload over time; "when a lead was reassigned from A to B, what happened". GHL keeps none of this history (its reports start from now and cannot replay ownership). INFERENCE, supported by our `lead_events` owner_changed, `touch_events`, `*_history` tables. Every figure built from history is labelled "history starts <date>". Add one new store: a per-person daily rollup (`user_daily`) plus an owner-at-time record for appointments and deals, so history is never rebuilt.

## 7. Recommendation

- **Merge People and Team into ONE module**: "Team" in the nav (id `team` already exists and is in the access lists), module code `pp`. Rename the old lead-search screen label from "People" to "Find a lead" to remove the clash (King to confirm; default taken). Keep old `TeamView` behind a flag until the new one is verified, then retire.
- Money first: show each client account's revenue and dollars at risk per person (deals won value, open value stale, unanswered waiting). Customer second: a setter sees their own scorecard and queue. Innovation third: next-lead suggestion, coaching, history.
