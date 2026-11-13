# Date rules (ONE source of truth)

Written 13 Nov 2026 after King's report that "date filters are not working properly". Code: `src/lib/design/zone.ts` (days, windows, time zone), `src/lib/design/range.ts` (presets), `src/lib/design/page-range.ts` (the bar's range and how it travels), `src/app/app/ds/page-range.tsx` (`usePageRange`).

## 1. The rules

1. **The date bar at the top governs every screen**, unless the screen says otherwise in plain words next to its numbers ("as of now", "always this week against last week", "last 8 weeks"). No screen may silently use a different window.
2. **Time zone: one zone for the whole app, Africa/Lagos** (no daylight saving: a day is always 24 hours). Set `NEXT_PUBLIC_APP_TIMEZONE` to change it. A "day" is a day in that zone, so "Today" begins at 00:00 Lagos time, not 01:00 (UTC midnight). **Weeks start on Monday.** The bar and every caption say the zone: "15 Oct to 13 Nov, Lagos time". Decision: one zone for the app, not one per client account, because the bar is shared by many accounts at once (a per-account zone would give each account a different window inside one total).
3. **Presets** (all resolve to whole days, first day to last day inclusive, last day never in the future):

   | Preset | Window (today = Fri 13 Nov 2026) |
   |---|---|
   | Today | 13 Nov |
   | Yesterday | 12 Nov |
   | Last 7 days | 7 Nov to 13 Nov |
   | Last 30 days | 15 Oct to 13 Nov |
   | Last 90 days | 16 Aug to 13 Nov |
   | This week | Mon 9 Nov to today |
   | Last week | Mon 2 Nov to Sun 8 Nov |
   | This month | 1 Nov to today |
   | Last month | 1 Oct to 31 Oct |
   | Custom | two dates, applied as soon as both are real, in order, not in the future, at most about 3 years |

   "Compare" is the same number of days straight before (or the same dates a month / a year earlier). The window travels as `r.page=<code>` in the address (`today`, `yday`, `7d`, `30d`, `90d`, `week`, `lweek`, `month`, `lmonth`, `custom:2026-10-01~2026-10-30`), so a pasted link shows what its sender saw. A custom range lives for the browser tab; a preset is remembered for next time.
4. **A card may override the bar only visibly.** A card that follows the bar says "Dates from the bar above: ..." with a "Change for this card only" link. A card with its own dates shows a highlighted line "This card only: ..." with "Use the dates above". A screen-level selector (for example Appointments' "Appointment date") shows a note saying it is not the bar's dates, with "Use the dates above".
5. **A count equals its rows.** Every count opens exactly the rows behind it in the same window (the drill-down is built from the same `from`/`to`).

## 2. What the range filters, per metric family

| Family | The range filters | Never filtered by the range ("as of now") |
|---|---|---|
| Leads, growth, lead flow | contact created (new lead) | total contacts, tags |
| Speed to lead | the lead's arrival (created) in the window; first reply may fall after it | leads waiting for a reply now (the queue) |
| Appointments | booked-for time (the day it happens), unless "Booked on" is chosen (booking day) | unmarked / past due list, no-shows still to recover (always "now") |
| Pipeline: won, lost, moved | last status change (won or lost), stage change time | **open money, stale deals, open deal counts** (what is open today) |
| Pipeline: new deals | created | |
| Payments / money | when the money event happened (recovered, refund, dispute opened) | money at risk and failing now |
| Team | the activity's time (replies, bookings) | who is on the roster, current queue |
| Clients | the period of the figure (leads, appointments, replies in range) | health "today", plan, who is quiet now |
| Proof | the week the alert was raised or cleared (fixed weeks, labelled) | alerts still open |
| Meeting notes | when the meeting started | the inbox of unmatched meetings |
| Account audit, Clean-up, Duplicates, Contact search / Find a lead, Calls, Inbox, Onboarding, Email health | nothing: "Live, as of right now" is shown in the bar and a note explains why | everything |

A figure that is "as of now" must say so next to the number; narrowing the bar must never change it.

## 3. How the code must work

- Browser: read dates from `usePageRange()` (or `useCardRange()`, which follows it). Never type "last 30 days" in code, never compute a window from `new Date()`.
- "Today" is `todayOf(Date.now())` / `localDay(ms)` (zone-aware), never `new Date().toISOString().slice(0, 10)` (that is the UTC day: at 00:30 in Lagos it is still yesterday).
- Server: the request carries `from` and `to` (days, inclusive). Readers convert with the shared helpers in `zone.ts` (`localDay`, `windowMs`, `dayStartMs`, `utcDayAfterToday`). A new reader uses `windowMs(from, to)`.
- The source guard (`src/lib/__tests__/date-rules.test.ts`) fails when a file builds its own "today" or day window outside the shared module. `date-guard-baseline.json` lists the existing exceptions; it may only shrink.

## 4. Known gaps (honest list)

1. **Server windows on timestamp columns are whole UTC days.** The browser sends Lagos days; the readers (`parseWindow`, `parseApptWindow`, `parsePlWindow`, speed window, payments window) still turn a day into `00:00 UTC`, so a window starts and ends 1 hour after Lagos midnight. This was left on purpose: the daily rollup tables (`speed_daily`, `client_daily`, `pm_rollup_daily`) are keyed by UTC day, and shifting the reader without moving the rollups would put figures on the wrong day. What is fixed now: "today", the future-date check and the default window all use the Lagos day. To close the gap: key the rollups by Lagos day (additive migration plus backfill), then switch the readers to `windowMs`.
2. **Time of day (hour) is not part of the range.** Custom is date-only. "Last hour" is not a preset. If wanted: add optional `fromTime` / `toTime` to the spec, then to every reader (needs the gap above closed first).
3. Exceptions in the guard baseline (each is "today as UTC day" in a server or screen that is not driven by the bar): `clients/details.tsx`, `fn/payouts.tsx` (print date), `pm/sections.tsx` (default "opened on"), `wg/data.ts` (usage wallet series), the exec appointments intel and queries, `bf-queries`, `cash-queries`, `clients-actions-queries`, `clients3-queries`, `dq-queries`, `people3-queries`, `today3-queries`, `client-routes`, `dq-routes`, `growth-api`, `people-actions-routes`, `pipeline3-routes`.
4. **Pipeline (Money flow cards) is outside this change** (another builder owns `src/app/app/views/pl3/*`). What it must do to match these rules is listed in the PR description.

## 5. Screen audit (13 Nov 2026)

PASS = already follows the bar and says so; FIXED = changed here; NEEDS-PL3 = belongs to the Pipeline builder. Not verified in the live app (no login from a build agent): every row is checked in code and unit tests only.

| Screen | Result |
|---|---|
| Date bar | FIXED: Today, Yesterday, 7/30/90, a "Week or month" menu (This week, Last week, This month, Last month), Custom applies by itself, zone named in the label |
| Today, Numbers | FIXED: the second date control (`DatesBar`) is gone; it now states the bar's dates in words |
| Today, "This week" evidence block | PASS: fixed windows, labelled ("Last 7 days", "Last 30 days", "This week") |
| Appointments (filters, counts) | FIXED: its own "Appointment date" choice is a labelled override with "Use the dates above" (now correct for the new presets); "Happening" renamed "Appointments happening"; today and presets in the account's day |
| Appointments, week/month table | FIXED: states plainly that it is always this period against the last and ignores the bar |
| Speed to lead, cards | FIXED: cards follow the bar and say so, "Change for this card only" is the only override |
| Clients (overview) | PASS (bar); trend cards FIXED the same way |
| Money (payments) | FIXED: "today" and the fallback window use the Lagos day; known gap 1 for the rollups |
| Finance | FIXED: "today" is the Lagos day; bar drives the range |
| Team | PASS (bar) |
| Meeting notes list | FIXED: read its own copy of the bar's rules and ignored a custom range; now uses `usePageRange` |
| Account audit, Clean-up, Duplicates, Contact search (Find a lead), Calls, Inbox, Onboarding, Email health | PASS: "Live, as of right now" with a note. Find a lead stays plain "ignores dates"; applying "added in range" is a proposal, not done |
| Growth, Lead flow, Proof, Forecast, Sources tabs (report filter) | FIXED: follows the bar by default; an override says "this tab only" with "Use the dates above"; "today" is the Lagos day |
| Proof | PASS (weeks are fixed and labelled) |
| Pipeline: Money flow cards and every pl3 screen | NEEDS-PL3 |
