# Appointments: research summary and build plan (11 Nov 2026)

Detail and sources: APPOINTMENTS_R1_GHL.md, R2_PLATFORMS.md, R3_CUSTOMER_VOICE.md, R4_DATA_ROI_MOAT.md (same folder). Labels: VERIFIED / INFERENCE / UNVERIFIED as in those files. Reddit, forums and review sites could not be reached, so customer voice is almost only the GHL ideas board.

## 1. What GHL does NOT have (money first), VERIFIED unless noted
1. **Setter vs closer.** The API gives `assignedUserId` (owner) and `createdBy` (who booked), but no report ranks "who booked" vs "who took the meeting". Requests open since 2022 ("filter by Appointment Owner and Created By", status Upcoming; "who booked this", 14 votes). Setter pay and coaching depend on it.
2. **Trustworthy numbers.** Native report shows counts by status and only the top 5 users and top 5 calendars, per account. A user reports inflated counts (33 shown vs 8 real). "Robust appointment reporting" (cost per appointment, no-show rate, source): 387 votes, Under review.
3. **More statuses.** Custom statuses: 236 votes (top-voted). Voice AI forces "Confirmed" (21 votes).
4. **History.** The webhook has no previous status; users say who booked and when is no longer visible. We must keep our own history.
5. **Cross-account view.** No agency-wide appointment report found. No marketplace app in this lane found (needs a manual check in the marketplace).
6. **Unmarked appointments.** Reports are only true if staff mark showed or no-show; nothing watches for forgotten ones.
7. **Round robin fairness** (66 votes) and **double booking** (the API lets staff force overlaps with `ignoreFreeSlotValidation`), **no-show protection** (10 votes, thin).

## 2. What other platforms sell
Booking itself is a commodity (reminders, deposits, waitlists, round robin are gated by tier everywhere). The weak spot is analytics: reviewers call Calendly's shallow; Acuity and Cal.com show no outcome analytics on their pages. Price anchors: per seat $5 to $28; AgencyAnalytics $20 per client; Databox $20 per account pack. **SubSync at $11.50 per client account is under them.** Not found on any page read: a cross-account no-show or show-rate view, or a status-change history (absence on a marketing page is not proof of absence).

## 3. Numbers we may and may not use
Med spa no-show about 4% and solar show rate 65 to 80% are vendor figures; no reliable figure for dental, home services, real estate or coaching. Reminders cut no-shows by 30 to 40% relative (vendor/secondary). **Never show invented benchmarks:** show each account's own numbers, and labelled estimates with a range and the formula one tap away ("not enough data" under about 200 appointments).

## 4. The moat (our own history, hard to copy)
Record now, append-only, raw timestamps: appointment, contact, calendar, owner, booker (user or source), start/end and timezone, every status change with time and who, booked-at, lead created-at and source, first-response time, reminder facts, reschedule chain, deposit present, opportunity stage and value, outcome-marked-at. This unlocks:
1. Unmarked cleanup and **true show rate** (1 agency).
2. **Revenue-at-risk range** from no-shows and unmarked (1 agency).
3. **Show rate by booker**: setters ranked on shows, not bookings (3 agencies).
4. Show rate by source and by response speed (3 agencies).
5. Best days and hours, lead time (5 agencies).
6. Reminder effectiveness (10 agencies).
7. Opt-in peer benchmark by vertical (20+ agencies, 10+ accounts per cell, hide a cell if one agency supplies over 40%).
8. No-show risk score for upcoming appointments (30+ agencies).

## 5. What exists today (code, from docs/features/APPOINTMENTS.md)
Appointments rebuilt around three work lists with insights, deep links and status writes (showed, no-show, cancelled). Missing: reschedule, add, delete, reassign, setter-vs-closer, cross-account health, history, reminders view.

## 6. Build plan: sub-sections, money first
Appointments becomes a module with sub-sections (tabs), each with room for 1M+ appointments, compact tables, a right-side panel, clickable counts, Speed design standard:
1. **Overview**: one sentence ("9 appointments past due with no outcome; true show rate 71%, not 88%"), one button, 3 cards.
2. **Needs outcome**: past-due appointments never marked, one-click mark showed / no-show (gateway).
3. **No-show recovery**: no-shows not rebooked in 7 days, rebook, call, snooze.
4. **Booking share**: setter (creator) vs closer (owner), per person, trend, show rate by booker.
5. **Cross-account health**: worst account first, show, cancel, no-show, unmarked, per account and vertical.
6. **Sources and speed**: show rate by lead source and by first-reply speed.
7. **Calendar fairness and conflicts**: round-robin balance, double bookings and forced overlaps, disconnected calendars (alerts).
8. **Revenue at risk**: labelled range.
9. **Proof**: weekly receipt, verified page, benchmark (opt-in, later).
10. **Actions**: reschedule, add, reassign, delete (typed confirmation), through the gateway with preview, audit log, double-booking check.
Everything behind its own flag (ON for testing, reminder item 33), additive migrations, tenancy before main.

## 7. Features inside each sub-section (from the research, pain points and advanced ideas)
Every item below is a pain point or a moat item above. Each sub-section is a full-width area with a compact table (server-paged, 1M+ rows), a right-side panel with the appointment details, clickable counts, flags ON for testing.
1. **Overview:** headline sentence + one button; true show rate vs reported; revenue-at-risk range; 3 cards; animated "where do my appointments go" journey (booked, confirmed, showed, closed).
2. **Needs outcome:** past-due appointments with no outcome; one-click Showed / No-show / Cancelled / Invalid / Completed (gateway, preview); bulk mark; "auto-mark suggestion" from a later deal or message, never automatic; weekly alert; extra statuses shown as our own labels (the 236-vote ask) without changing the CRM.
3. **No-show recovery:** no-shows in the last 7 days not rebooked; rebook (add appointment), call, snooze, mark lost; recovered counter and dollars; "rebooked within 24h" rate.
4. **Booking share (setter vs closer):** who booked (creator or source) vs who owns it; per person table, trend, book-to-show, show-to-close, speed from lead to booked; leaderboard; unassigned bookings; fairness of round robin (per appointment, not per day); fix ownerless bookings with Assign.
5. **Cross-account health:** worst account first; show, cancel, no-show, unmarked, reschedule rates per account, per calendar, per vertical; weekly ranking; per-account target.
6. **Sources and speed:** show rate by lead source/UTM (the 387-vote ask), by first-reply speed, by lead time, by weekday and hour; best slots advice.
7. **Calendars and conflicts:** double bookings and forced overlaps, disconnected or one-way calendars, reminder gaps (appointments with no reminder sent), reschedule and cancellation trend, capacity view (slots left per month).
8. **Reminders and no-show prevention:** confirmation status, "not confirmed 24h before" list, reminder effectiveness (needs history), deposit present flag, risk flags for likely no-shows (later, needs data).
9. **Actions:** reschedule, add, reassign, delete (typed confirmation, never when blocked), double-booking check, audit log, undo note; all through the safe gateway.
10. **Proof:** weekly appointment receipt per client (booked, showed, recovered, still unmarked), verified page, opt-in peer benchmark later.
11. **Meetings (Fathom):** see section 8.

## 8. Fathom sub-section (meeting details inside the appointment)
Fathom integration exists in the code (stage E2a, fixtures, `FATHOM_WEBHOOK_LIVE` switch, per-person connections). In Appointments it becomes the easiest way to see what happened in the meeting:
- **Easy connect and sync:** one connect button per person (a personal tool belongs to the person who connected it, tokens never visible to others), status line "synced 2 min ago", Sync now, clear error text.
- **Appointment details panel:** appointment time, owner, booker, status, deal, plus the meeting recording link, summary, action items, next step, duration, who attended, matched automatically.
- **Match with certainty only:** match meeting to appointment by contact, time window and attendee email; if not certain it waits in the person's private inbox ("Needs matching", one-click match), never guessed (principle 13).
- **Outcome from the meeting:** suggest Showed (a meeting happened) or No-show (calendar slot passed with no meeting); one tap to confirm, never automatic.
- **Follow-up:** action items to an internal note and task (gateway, our own writes excluded from metrics), "no next step set" list, "meeting held but deal not moved" list.
- **Coaching:** per setter and closer: talk time, meeting length, show-to-close, next step set rate (no message text stored in SubSync beyond what the connection returns; privacy rules in docs).
- **Money angle:** "meetings held, no follow-up within 2 days" is lost revenue; "closer takes 40% shorter meetings and closes less" is coaching an agency can sell.

## 9. King's rule: edit, modify and delete appointments (11 Nov 2026)
From the appointment side panel and from every list, with the safe write gateway: **edit** (time, calendar, owner, notes, status), **modify** (reschedule, reassign, change duration, add an appointment), **delete**. Edit and reschedule show a preview of what changes and can be undone for a short time. **Delete ALWAYS needs a confirmation**: a dialog that names the appointment (who, when, calendar), says it cannot be undone, and requires typing the word DELETE (or the contact's name) before the button works; bulk delete shows the count and the list and needs the same typing. Never deletes silently, never from a keyboard shortcut. Double-booking check before create/reschedule; audit log of every change (who, what, before/after); dry-run unless the live switch and the account opt-in are on; our own writes excluded from our metrics; needs `calendars/events.write` as an OPTIONAL scope with a clear "Needs permission: reconnect" message until granted.
