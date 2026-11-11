# Appointments R3: customer voice (research, 2026-11-10)

Scope note: only the GHL ideas board yielded dated, vote-counted primary posts (VERIFIED by page fetch). Reddit, Fast Lane Forum, GHL community, G2/Capterra/Trustpilot: NOT FOUND (search returned only vendor and agency blogs). Only 11 real items found, not 15-25; none invented. Author names are mostly not shown by the pages.

## Items (ideas.gohighlevel.com, VERIFIED unless noted)

| # | Pain | Date | Votes | Quote | URL |
|---|---|---|---|---|---|
| 1 | Need custom appointment statuses beyond Confirmed/Showed/No Show/Reschedule | 2023-11-02 | 236 | "customize or add certain appointment statuses" | /scheduling-calendar/p/custom-appointment-status |
| 2 | Round robin is not fair (per day, not per appointment); marked Complete | 2024-03-23 | 66 | "prioritising per day and not per appointment" | /scheduling-calendar/p/improve-equal-distribution-in-round-robin-calendar-events |
| 3 | Recurring appointments missing | undated | 87 (13 comments) | n/a | /scheduling-calendar/p/recurring-appointments-2 |
| 4 | Report cannot filter by Appointment Owner and Created By (setter vs closer); status Upcoming | 2022-09-21 | 18 | "filtered by Appointment Owner and by Created By" | /reporting/p/filter-by-appointment-owner |
| 5 | Cannot see who booked an appointment (merged into "Booked By" widget request) | 2025-03-26 | 14 | "no way to see data on who an appointment was booked by" | /dashboard/p/adding-appointment-widget-with-booked-by-feature |
| 6 | Created By custom field wanted for workflows/reports | 2025-06-11 | 7 | "'created by' user is tracked in reporting" (INFERENCE: wants it exposed) | /scheduling-calendar/p/custom-field-for-appointment-created-by |
| 7 | Per-setter booking count report | 2025-05-24 | 2 | "track how many appointment each setter booked" | /ad-reporting-and-attribution/p/i-need-a-what-in-reporting-to-track-how-many-appointment-each-setter-booked-for |
| 8 | Appointment numbers inflated (33 shown vs 8 Voice AI bookings) | 2026-01-08 | 2 | "numbers are including appointments previously booked by the subaccount" | /dashboard/p/reporting-issues-plus-suggested-reporting-modifications |
| 9 | Appointment report source attribution inaccurate | 2026-01-25 | 1 | "analyze what source gives me the best results" | /reporting/p/appointment-report-custom-fields-adjustable-columns-filter-a-to-z-contact-source |
| 10 | KPI export of calendar list | 2025-10-29 | 4 | "track KPIs more efficiently" | /dashboard/p/downloadable-calendar-list-export-for-kpi-performance-tracking |
| 11 | Google Calendar organizer not added as guest; support said no fix scheduled | 2024-09-26 | 7 | "isn't added as a member/guest to the meeting" | /scheduling-calendar/p/ghl-not-adding-organizer-as-guest-to-google-calendar-meetings |
| 12 | Voice AI forces Confirmed status | 2025-07-22 | 21 | "doesn't allow us to control this behavior" | /ai-employee/p/allow-voice-ai-to-book-appointments-as-unconfirmed-instead-of-forcing-confirmed |
| 13 | Pay-in-store bookings need no-show protection (card on file); workaround risks double-booking | undated | 10 | n/a | /scheduling-calendar/p/services-v2-let-customers-choose-pay-online-or-pay-in-store-at-booking |
| 14 | Per-calendar sync direction/mapping to Google/Outlook | undated | 8 | n/a | /scheduling-calendar/p/map-each-highlevel-calendar-to-its-own-google-outlook-calendar-with-sync-directi |

(Prefix all paths with https://ideas.gohighlevel.com.) Item 13 and 14 text is from the board listing summary, not full post.

## Secondary (UNVERIFIED, vendor/consultant blogs, not customers)
- Double bookings blamed on split availability and sync lag (consultevo.com/gohighlevel-google-calendar-sync-double-bookings). Consultant claim.
- Reminder workflows silently not sending: draft mode, wrong trigger, "Stop on Response" (ghlscaleup.com, growthable.io). Consultant claim.
- Reports only accurate if staff mark Showed/No-show promptly (growthable.io appointment reporting guide). Advice, implies the unmarked-status gap.
- AgencyAnalytics added HighLevel appointments data (updates.agencyanalytics.com): shows agencies want client-facing appointment reporting. VERIFIED existence, not content.

## Not found
Reddit, Fast Lane Forum, GHL community threads, G2/Capterra/Trustpilot, after-hours bookings, reschedule chaos, deposits (only item 13), "client asks how many did you book": NOT FOUND as customer voice.

## Ranked top pains (frequency x money; ranking is INFERENCE from few data points)
1. Setter vs closer attribution (who booked vs who owns): items 4-8, 2022 to 2026, still open. Money: setter pay and performance management.
2. Appointment report numbers untrustworthy/inflated (8, 9; plus unmarked-status advice).
3. Status gaps: only 4 statuses, 236 votes, top-voted item (1), plus Voice AI forced Confirmed (12). Hurts true show rate.
4. Round-robin fairness (2, 66 votes): lead and commission distribution.
5. No-show protection/deposits (13): direct revenue loss; thin evidence.
6. Calendar sync/double booking (11, 14, blogs): lost bookings.
7. Reminders silently failing (blogs only): UNVERIFIED but fits "silent failure" wedge.
8. KPI export/client reporting (10, AgencyAnalytics integration).

## Implication for SubSync (INFERENCE)
Created-By vs Owner split and unmarked-status hygiene are long-standing, voted, unresolved gaps; GHL listed owner filter as "Upcoming" since 2022. Check whether Created By is exposed in API before building.
