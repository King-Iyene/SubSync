# Appointments R5: leaders view, filters, all calendars, gaps (2026-11-11)

For the builders (filters, executive view, all calendars). Labels: VERIFIED (read in primary source or in our code), INFERENCE, UNVERIFIED. Reddit/Facebook/forums were not reachable; customer voice is the ideas board numbers already in R3 plus vendor request boards. Builds on R1 to R4; not repeated.

## 0. Gaps found in what is built (VERIFIED in code, read 11 Nov)
- `Appt3Query` has `from/to` on appointment start only. `created_remote_at` (booked-at) exists and is used for lead-to-booked and lead time, but there is **no "date booked" filter** (the ask: created vs held date).
- Calendar groups: only probed in `ghl/capabilities.ts`; **not synced, stored, or filterable**. Filters are account, calendar, person, source.
- `sync/engine.ts`: `fetchCalendars(...).slice(0, MAX_CALENDARS=80)` is a **silent cap**; accounts with more than 80 calendars lose appointments with no message. One events request per calendar for a fixed window (90 days past, 60 future), no windowing or paging; the docs state no limit or paging fields, so a busy calendar may be truncated silently (see 1).
- Sync window 90 past / 60 future: no year view until our own history is older. Leaders ask for 12 months (Calendly keeps one year).
- Filter pickers read calendars from booked data, so a dead calendar (zero bookings) is missing there; `calendarsAll` covers it only on the Calendars tab.

## 1. What the GHL APIs give and do not give
| Endpoint | Gives | Does NOT give |
|---|---|---|
| `GET /calendars/` (calendars.readonly) | id, name, calendarType, teamMembers, isActive (VERIFIED, our probe fields) | Per-calendar stats; health of the Google/Outlook link (UNVERIFIED) |
| `GET /calendars/events` (calendars/events.readonly, v3) | id, title, notes, description, calendarId, groupId, contactId, appointmentStatus, assignedUserId, `users[]`, startTime, endTime, dateAdded, dateUpdated, rescheduledAt (only if rescheduled), createdBy{userId, source}, masterEventId, isRecurring, rrule, deleted, assignedResources, address. Needs one of userId, calendarId, groupId. VERIFIED https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar-events | Previous status, who changed status, reminder facts, UTM, booking page; no max range or paging stated (unknown) |
| `groupId` param on events | Group filter in one call; `groupId` on each event (VERIFIED, same page) | Group names (need groups call) |
| `GET /calendars/groups` (calendars/groups.readonly) | Group id and name. VERIFIED https://context7.com/gohighlevel/highlevel-api-docs | Membership list beyond `groupId` on calendar/event (INFERENCE) |
| `GET /calendars/resources/{type}` | Rooms and equipment; `assignedResources` on events. VERIFIED https://marketplace.gohighlevel.com/docs/oauth/Scopes/index.html | Utilisation |
| `GET /calendars/{id}/free-slots` | Open slots over a range, by timezone and user. INFERENCE (third-party wrappers) | History: live only, so **capacity must be snapshotted by us** |
| `GET /calendars/blocked-slots` (events.readonly) | Blocked time. VERIFIED (scope list) | Reason for the block |
| Appointment notes, calendar notifications | Exist in docs sidebar, paths not read. UNVERIFIED | Whether reminders were actually sent |
| Webhooks AppointmentCreate/Update | Status, owner, users, source, times | Previous status, createdBy; type string inconsistent (R1) |
| Round robin | Lightest load in a window around booking; sources disagree 24h vs +/-24h. INFERENCE https://growthable.io/gohighlevel-tutorials/calendar/round-robin-calendars-appointment-distribution-logic-in-gohighlevel/ | A log of why a person was chosen |
| UTM / booking source | `createdBy.source`; iframe loses UTMs (387-vote idea, R1) | Reliable campaign attribution: take source from the contact |

## 2. What SubSync can show that GHL does not
| Idea | Data | Held? |
|---|---|---|
| Cross-account health, worst first | events | Yes (built) |
| True show rate (unmarked kept apart) | events plus history | Yes (built) |
| Setter vs closer, show rate by booker | createdBy, assignedUserId | Yes (built); widget bookings have no user: label "Online booking" |
| Reschedule chain and rate | `rescheduledAt`, our time-change history | Yes (history records each move) |
| Double bookings / forced overlaps | events overlap per user | Yes (built); cannot prove forced (flag not on read) |
| Dead calendar | calendars plus events (`daysSince` exists) | Yes, needs an alert |
| Round-robin fairness | owner counts per calendar | Yes (built); weight by hours not count |
| Lead-time, weekday/hour effects | dateAdded vs start | Yes (built); needs 200+ per cell |
| Capacity ("slots left this month") | free-slots live | No: nightly snapshot job and scope probe needed |
| Source quality, revenue at risk | contact source, first reply, deals | Yes (built, estimates) |
| Calendar sync health | not in API | **Blocked** (proxy only: sudden booking drop) |
| Who changed a status | not in API | **Blocked** (actor stays "unknown") |
| Reminders sent / confirmed | messages | Only if the messages scope is granted |

## 3. Pain points ranked by money (INFERENCE from R3 numbers)
1. Show rate nobody can trust (387 votes robust reporting; 33 shown vs 8 real).
2. Setter pay and closer coaching without who-booked (14 votes, open since 2022).
3. No-shows never chased; Chili Piper users say manual marking is unreliable and ask for automatic detection https://suggest.chilipiper.com/feature-requests/p/automatic-no-show-detection-and-handling
4. More statuses (236 votes).
5. Round robin unfair (66), double booking, dead or disconnected calendars: bookings lost unseen.
6. Slots that no-show most: Chili Piper request for no-show by hour and weekday, not shipped https://suggest.chilipiper.com/feature-requests/p/report-on-popular-scheduling-times-booking-patterns-and-no-show-and-cancellation

## 4. How the leaders' tools present booking analytics
- **Calendly** (up to one year): created, completed, rescheduled; filter date, user, team, group; export event and employee data; Routing tab on Teams plan; no native no-show metric. https://calendly.com/help/calendly-analytics
- **Cal.com Insights 2.0**: created/completed/rescheduled/cancelled, host and guest no-shows, most/least booked links and members, bookings by hour, routing funnel, recent no-show guests, CSV. Filters: link, member, sub-team, booking status, attendee email, paid, rating, custom range. https://cal.com/blog/insight-2-0-calcom-scheduling
- **Chili Piper**: Meeting Distribution per rep (scheduled, rescheduled, canceled, no-show); filter assignee, host, booker; show rate is manual input. https://help.chilipiper.com/hc/en-us/articles/28997030478227-Workspace-s-Distribution-Reporting
- **RevenueHero / Cometly**: status per rep; no-show rate as a column on the source funnel. https://www.cometly.com/academy/no-show-rate-by-source
- Acuity, SavvyCal, HubSpot, Gong, Salesloft, Close: not read (paywalled or script pages). UNVERIFIED; no claims copied.
- **KPI set (consistent across the above)**: booked, held, no-show, cancelled, rescheduled (count and rate); per rep, per source, by hour and weekday; trend vs previous period; recent no-show list. Definitions: held/booked, no-show/booked https://umbrex.com/resources/company-analysis/sales/meetings-held-per-rep/
- **Leader rule (INFERENCE):** one headline, three numbers each vs the previous period, one ranked "who to talk to this week" list. Filters leaders use: period, team or group, person, status, source.

## 5. Biggest data-error sources and the checks to build
| Risk | Check |
|---|---|
| Timezone: UTC storage, "past due" and weekday/hour in the account zone; DST days have 23 or 25 hours | Group by account tz (we store it); fixtures on DST change days; show the zone in the filter bar |
| Created vs held date confusion | Explicit toggle "By appointment date / By date booked", stated on screen |
| Status mapping: read enum not documented (R1) | Keep raw status; "Other (n)" bucket; unmapped-status alert; never silently drop |
| Cancelled vs rescheduled: a move may be a cancel plus a new event, or one row with `rescheduledAt` | Count a chain once (same contact and calendar within 24h); report both rates |
| Round-robin owner changes after booking | Record owner changes (history kind `owner`); credit owner at appointment time |
| Imported, recurring (`rrule`, `masterEventId`), duplicate, `deleted:true` | Exclude deleted; collapse recurring; dedupe by id; flag backdated (dateAdded after start) |
| Auto-"showed" workflows | Alert when nearly all outcomes are one status or set seconds after start |
| Silent truncation (80-calendar cap, window, no paging) | Compare rows read vs expected; banner "Some data not read" |
| Our own writes | Already excluded (principle 14); keep the test |

## 6. Fifteen improvements (money, customer, innovation)
| # | Improvement | Data | Effort | Held |
|---|---|---|---|---|
| 1 | Remove the silent 80-calendar cap, window events by month, "not fully read" banner | events | S | yes |
| 2 | "Date booked / Appointment date" switch on every filter bar and list | created_remote_at | S | yes |
| 3 | Calendar group filter: sync groups, store groupId per calendar, picker | groups, event.groupId | M | yes (scope held; migration) |
| 4 | Executive view: headline, 3 KPIs vs previous period, "who to talk to" top 5, nothing else | built aggregates | M | yes |
| 5 | ALL calendars list: incl. zero-booking and inactive, by group, last booking, 30/90-day trend; pickers use it | calendars list | S | yes |
| 6 | Dead calendar alert (no booking for N days while leads still arrive) | calendars, events | S | yes |
| 7 | Unmapped-status and auto-"showed" data-trust alerts | events, history | S | yes |
| 8 | No-show and cancel rate by hour and weekday | events | S | yes |
| 9 | Previous period and same period last year on Overview | history | S | yes (year later) |
| 10 | Backfill 12 months on first install | events | M | yes |
| 11 | Setter fairness by hours, "who is overloaded" | events | S | yes |
| 12 | Reschedule chain per contact (count once, gap days) | history | M | yes |
| 13 | Nightly capacity snapshot, "slots left this month", sell-out alert | free-slots | L | no (probe first) |
| 14 | Weekly leader email: 3 numbers, 3 problems, one name | built | M | yes |
| 15 | Opt-in peer benchmark by vertical | pooled data | L | no (20+ agencies) |

Blocked, say so on screen: who changed a status, calendar-sync health, reminders sent (needs messages), campaign-level UTM.
