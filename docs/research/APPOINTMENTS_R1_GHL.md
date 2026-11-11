# Appointments inside GoHighLevel - R1 research (2026-11-10)

Labels: VERIFIED = read in a primary source (GHL docs, help center, ideas board). INFERENCE = reasoning or third-party blogs. UNVERIFIED = single weak source. NOT FOUND = searched, no result.

## 1. API and webhooks
- Status values accepted on update: new, confirmed, cancelled, showed, noshow, invalid, completed, active. VERIFIED https://marketplace.gohighlevel.com/docs/ghl/calendars/edit-appointment/index.html (the GET docs show only "confirmed" as an example, so the full enum on read responses is not documented: CHECK live data).
- Update: `PUT /calendars/events/appointments/{eventId}`, header Version v3, scope `calendars/events.write`. Fields include `assignedUserId`, `startTime`, `endTime`, `calendarId`, `ignoreFreeSlotValidation` (skips availability check, which is how double bookings get created on purpose). VERIFIED (same URL).
- List: `GET /calendars/events`, scope `calendars/events.readonly`, needs `locationId`, `startTime`, `endTime` (ms) plus one of `userId`, `calendarId`, `groupId`. Returns `appointmentStatus`, `assignedUserId`, `users[]` (secondary owners), `contactId`, `dateAdded`, `dateUpdated`, `rescheduledAt` (only if rescheduled), `deleted`, `createdBy {userId, source}`, `masterEventId`. VERIFIED https://marketplace.gohighlevel.com/docs/ghl/calendars/get-calendar-events
- Webhook: AppointmentCreate / AppointmentUpdate payload has `appointmentStatus`, `assignedUserId`, `users`, `source`, `calendarId`, `contactId`, times. The Update doc page shows `type: "AppointmentCreate"` in its example, so the type string for updates is inconsistent. No `createdBy` and no previous status in the payload: we must diff against our own store. VERIFIED https://marketplace.gohighlevel.com/docs/2021-07-28/webhook/AppointmentUpdate.md
- Delete event endpoint exists in the docs sidebar; details not read. UNVERIFIED.
- Rate limits: 100 requests per 10 seconds burst and 200,000 per day, per app per resource (location or company). VERIFIED https://marketplace.gohighlevel.com/docs/oauth/Faqs
- Community report: v1 status change returned 400; v2 PUT with locationId worked. INFERENCE https://community.latenode.com/t/zapier-webhook-returns-400-bad-request-when-changing-appointment-status-in-gohighlevel/22459

## 2. Native reporting
- Appointment Report (Reporting > Appointment Report): counts by status (booked, confirmed, cancelled, new), channel and source split, top calendars by bookings, top 5 calendars by cancellations and reschedules, popular weekdays. Per-user: only the "top 5 users by number of appointments". No filters, no scope statement in the article. VERIFIED https://help.gohighlevel.com/support/solutions/articles/155000002758
- Older third-party guides describe user/calendar filters, show/no-show boxes and export. Conflicts with the help article, so UI has changed. INFERENCE https://growthable.io/gohighlevel-tutorials/appointment-reporting-for-gohighlevel/
- Reporting is per sub-account. Agency-wide appointment report: NOT FOUND.
- Who booked vs who took the meeting: the API exposes `assignedUserId` and `createdBy.userId/source`, but no native report ranks setter (creator) vs closer (assignee) share. NOT FOUND natively. INFERENCE from field list.
- Appointment audit log request marked Complete (19 votes), but a user in Aug 2025 says history of who booked and when is no longer visible. VERIFIED https://ideas.gohighlevel.com/scheduling-calendar/p/appointment-audit-logs-actions-pertaining-to-who-when-where-what-how-for-all-app

## 3. Native calendar features
- Calendar types: personal, round robin, collective, event/class, service. Round robin toggle to book with the contact's assigned user (July 2025, community post). Multi-duration booking added Aug 24-28 2026 across personal, round robin, collective, event calendars. Single-service appointments rescheduled in Google/Outlook now sync back (Sep 21-25 2026). INFERENCE (third-party roundups) https://netpartners.marketing/highlevel-updates-week-september-21-25-2026/ and https://netpartners.marketing/highlevel-updates-week-august-24-28-2026/
- Workflows: trigger on appointment status (no-show follow-up, confirmations, reminders). Cancellation is its own status, so workflows built on New/Confirmed miss it. INFERENCE https://consultevo.com/gohighlevel-appointment-status-workflow-triggers/
- Deposits/payments on booking: NOT FOUND in this pass (not researched to a source).
- Official changelog (ideas.gohighlevel.com/changelog) not fetched. NOT FOUND directly.

## 4. Sync, double booking
- Causes reported: one-way sync, wrong conflict calendars, simultaneous bookings (race), Google event created after GHL booking, staff override, lag under high volume, "connected" status while external events do not block slots. INFERENCE (blogs) https://autogencrm.com/ghl-calendar-smart-sync/ and https://consultevo.com/gohighlevel-google-calendar-sync-double-bookings/
- `ignoreFreeSlotValidation` lets staff or integrations force overlaps. VERIFIED (edit-appointment URL).

## 5. Ideas board (votes)
- Robust appointment reporting: cost per appointment in ad reports, no-show rate, source of booked appointment: 387 votes, "Under review", comments from Jan 2026 say calendar iframe loses attribution (UTMs show as Direct). VERIFIED https://ideas.gohighlevel.com/ad-reporting-and-attribution/p/robust-appointment-reporting
- Calendar limits per week: 1 vote. Available-slots-per-month view: 2 votes. Recurring appointments: 1 vote. Create appointments in the past: merged, count not shown. Calendar UTM parameters (May 2025): count not shown. VERIFIED/partial, via search snippets. https://ideas.gohighlevel.com/scheduling-calendar/p/calendar-appointment-limits-per-week

## 6. Marketplace apps in this lane
- No app found for cross-account no-show / show rate / setter-closer share. Search returned only API docs, a voice-AI booking template (v1.1.1, 0 reviews) and GenSpeak. Install counts and prices not retrievable by search. NOT FOUND. Needs a manual marketplace UI check (search "no show", "appointment", "setter").
- Outside GHL: Hyros added no-show call tracking by source (not a GHL app). INFERENCE.

## What GHL does not have that agencies would pay for
1. Cross-account appointment dashboard (agency-wide show, no-show, cancel rates).
2. Setter (creator) vs closer (assignee) booking share and show rate per person, over time.
3. Status-change history: previous status and who changed it (webhook has no previous status; audit log visibility reported lost).
4. "Past start time, status never set" hygiene list: staff forgetting to mark outcomes.
5. Unrecovered no-show queue (no-shows not rebooked within N days).
6. Full per-user table (native shows top 5 users only).
7. Booking-source attribution (387 votes, iframe loses UTMs).
8. Alerts on sync failure or silent double booking (forced overlaps via ignoreFreeSlotValidation, disconnected calendars).
9. Reschedule and cancellation rate per calendar/user trended over time (native shows top 5 calendars only).
10. Proof Receipts: weekly "what was caught and fixed" for the client.
