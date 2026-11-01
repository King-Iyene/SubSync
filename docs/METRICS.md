# Metric definitions

Every number shown in SubSync is defined here once. If a number on screen disagrees with this file, the
screen is wrong. Each definition names the code that computes it and the test that pins it.
Status: FACT means counted directly from synced records. ESTIMATE means built from a rate, and the screen
says so and shows the formula.

Defaults are per install and can be changed in Settings: stale after 30 days, dormant after 30 days,
reply target (SLA) 4 hours.

## Deals

**Counted deal.** An open deal with a value above zero and a person it belongs to (an owner). Only counted
deals feed any dollar figure or open/stale count. Deals without a value or without an owner are not deleted
or hidden from the Stale deals list; they are left out of the totals, and the Overview says how many
(`excludedDeals`). Code: `queries.ts` (`counted`). Test: `scripts/check-metrics.ts` recomputes it from raw rows.

**Open pipeline** (FACT). Sum of value over counted open deals. Count of counted open deals. This is the only definition:
Today, Overview, Accounts, Account audit, Pipeline, Clients and the exports all use it, and a browser test
(`tests/e2e/consistency.spec.ts`) checks that they agree. Every screen that shows the total also says how many open
deals were left out and why (no value, no owner). The rule lives in `metrics.ts` (`isCounted`, `openPipeline`) and
once in SQL for the account tiles (`queries.ts`) and the deal list (`pipeline-queries.ts`); `scripts/check-metrics.ts`
recomputes it from raw rows. Amounts are as entered in each account. The database stores no currency, so nothing
is converted and a note on the Overview and Pipeline says so (open issue: store each account's currency at sync).

**Stale deal** (FACT). A counted open deal whose last movement is older than the stale threshold (30 days by
default). Movement is the latest of: last stage change, last action, last update, last status change; if the
platform gave none, the created or last-synced time. **Stale deal value** is the sum of their values and is
a part of Open pipeline, never more than it.
*Known gap:* the threshold is one number for every stage. Brief 13A asks for a threshold per pipeline stage.
That needs stage history (how long deals normally sit in each stage), which only exists once the event store
has collected enough moves. Until then one number is used, and the screen says "have not moved", not "lost".

**Win rate** (FACT, with a minimum). Won deals divided by won plus lost deals, shown only when there are at least
**20** closed deals (`MIN_CLOSED_DEALS` in `metrics.ts`). Below that there is no win rate and nothing is built on it.
This one minimum applies to an account, to the all-accounts Pipeline total, to each team member and to the deals
view; an earlier minimum of 5 on the Pipeline screen produced "50%" from 3 won and 3 lost and is gone. The screen
says how many closed deals there are and how many are needed. Tests: `metrics.test.ts` (golden dataset),
`derive.test.ts`, `metrics-trust.test.ts`, `people-intel.test.ts`, `consistency.spec.ts`.

**Outlier note** (FACT). When one counted open deal is at least half (`OUTLIER_SHARE`, 50%) of the open pipeline and
there are at least 3 counted deals, the card says "One deal ($X) is N% of this". Shown on Overview and Pipeline.
Code: `outlier` in `metrics.ts`. Test: `metrics.test.ts`.

**Average deal value.** Average value of won deals; when there are none, open value divided by open deals.

## Estimates (always labelled "Estimate, not a fact")

**Expected revenue** (ESTIMATE). For each account that has a win rate: counted open value times that
account's win rate; added across accounts. If no account has a win rate the Overview shows "Not enough data".
It can never exceed Open pipeline.

**Likely revenue, Pipeline screen** (ESTIMATE). Open pipeline times the win rate; "Not enough data" below 20 closed
deals. Labelled "Estimate, not a fact" with the formula under the number (a tap on the label).

**Cost of slow follow-up** (ESTIMATE). Conversations waiting past the reply target, times the account's
average deal value, times its win rate. It is the rough size of the problem, not money lost. "Not enough
data" when there is no win rate.

*Note on the round figures first seen in test data:* the connected test agency holds a large block of
imported test deals, so open value was a round $2,400,000 and exactly half of it was "expected" because that
imported data won exactly half. That was real data, not a default, but it is why the two tiles looked
identical. They are now separate, gated and labelled.

## Conversations and contacts

**Waiting past SLA** (FACT). Conversations whose last message was inbound, older than the reply target, and
newer than 30 days (older threads are treated as dead, not as waiting).

**New contacts, 30 days.** Contacts created in the last 30 days.

**Data completeness.** Average of three shares of contacts: with an email, with a phone of 7 or more digits,
with at least one tag.

**Dormant account.** No contact, deal or message activity for the dormant threshold (30 days by default).

## Engagement score (0 to 100, FACT-based, shown with where every point came from)

Recent activity 40 (3 days or fewer 40, up to 7 days 34, 14 days 26, 30 days 16, 60 days 6, else 0) plus New
contacts 20 (new in 30 days against about 5% of the list, minimum 5) plus Pipeline health 20 (share of counted
open deals that are not stale; 8 with no open deals) plus Responsiveness 10 (10 minus 2 per conversation
waiting past SLA) plus Data quality 10 (completeness divided by 10). Code: `scoring.ts`.

## Appointments

**Status mapping.** The platform sends new, confirmed, cancelled, showed, noshow and invalid. Spelling and spacing are folded to one
form ("No Show", "no_show" and "NoShow" are noshow; "canceled" is cancelled; "booked" and "scheduled" are new). In words: new is
booked, not yet confirmed; confirmed is booked and confirmed; showed is held; noshow is a no-show; cancelled is cancelled; invalid is a
mistaken, spam or test booking. A status we do not know (for example "rescheduled") is kept as it is and treated like new: active, with
no outcome. Code: `normaliseAppointmentStatus` in `ghl-data.ts`.
**Active.** Not cancelled and not invalid.
**Booked** (in a window). Every appointment that was due to start in the window, cancelled ones included, **invalid ones never**
(they were not real). A rescheduled appointment is one appointment, counted once at its current start time; the old time is not counted.
**No outcome recorded** (the "unmarked" list). An active appointment whose start was more than 3 hours ago (a grace period for it to
run) and whose status is not showed or noshow. Cancelled and invalid appointments are not on this list.
**Show rate** (FACT, with a minimum). showed / (showed + noshow), over appointments **with a recorded outcome only**: the unmarked ones
are not guessed at and are not in it. Shown only with at least **5** recorded outcomes in the window (`MIN_OUTCOMES_FOR_RATE`), and the
screen shows the count it is built on; otherwise "not enough outcomes".
**Claims about change need a baseline.** "Show rate fell N points" needs at least **10** recorded outcomes in both periods, and "Bookings
are down N%" needs at least **10** bookings in the earlier period (`MIN_BASELINE_FOR_CLAIM`). Under that the page states the numbers and
makes no claim, so a quiet account never reads "down 100%".
**Time zones.** Windows are rolling (30 days is 30 times 24 hours), so they have no midnight or daylight-saving edge. Anything by day or
hour (the best-times map, "booked twice on the same day") uses the client account's own time zone, so 23:30 and 00:30 local are different
days, and the same wall clock time is the same cell either side of a daylight-saving change. An unknown time zone is read as UTC.
**Group events.** Several contacts booked into one session (same person, same calendar, same start) are one session, not a clash. One
person on two different calendars within 30 minutes is a clash.
**No-show recovery.** No-shows in the last N days where the contact has no later active appointment.
Code: `appointment-intel.ts`, `appointment-deep.ts`. Tests: `appointment-intel.test.ts`, `appointment-deep.test.ts`, `appointment-f3.test.ts`
(golden cases), `tests/e2e/appointments.spec.ts` (demo tenant, Insights tab).

## Our own history (event store, recording now)

`deal_events`: a deal first seen after the first sync, a stage change, a status change.
`appointment_events`: an appointment first seen after the first sync, a status change, a move of one minute
or more. Both are append-only and are never edited. The first sync of an account records nothing, because
every record would look new. Nothing yet reads these tables for a screen. Planned readers (Wave 2): deal
velocity, stage dwell time (which will also give per-stage stale thresholds), true show-rate history.

## Leads: quiet contacts

**Quiet over 90 days** (FACT, only when activity is known). Contacts whose last recorded activity (or, with none, their created
date) is more than 90 days old. The platform does not send a contact's last activity to us yet: on 31 Oct 2026 all
103,404 synced contacts had none, so "quiet" would only have meant "added long ago" (52,735 of 52,926 on the screen at
the time, 100%). The tile and the Going quiet card now show "Not measured" until at least one contact has recorded
activity. Code: `activityKnown` in `leads.tsx`.

## Test accounts

An account is "test data" when its name contains test, testing, demo, sample, sandbox or dummy as a whole
word. The "Hide test accounts" switch removes them from every page. It works on accounts only, not on
individual deals. Code: `test-data.ts`.

## Speed to lead (Wave 1 #1)

**Lead.** A new contact (created in the last 14 days) that has a conversation and is not left out for one of these reasons
(`lead-rules.ts`, applied after every speed sync, first match wins, and shown on screen as "N new contacts were not
counted as leads: ..."):
- *bulk import*: the source or a tag says import, csv, upload, bulk or migration, or 20 or more contacts in the account were
  created in the same minute;
- *spam*: the source or a tag says spam, junk, bot or fake;
- *test*: the name or a tag says test, demo, sample, sandbox or dummy as a whole word, or the email is a throwaway test
  address (test.com, mailinator, guerrillamail, yopmail). example.com is not a signal (it is the placeholder in sample data);
- *do not contact*: the contact has asked not to be contacted;
- *duplicate*: an earlier contact in the same account has the same email or the same phone number (a merged or repeated
  contact is counted once, as the earlier one).
A contact with no conversation is not timed either: bulk imports would otherwise look like thousands of unanswered leads.
**Start of the clock.** The earlier of the contact being created and the first inbound message.
**First touch.** The first outbound message or call at or after the start that a person sent from the app: an outbound message
with a user attached and the source `app`, or an outbound call (the platform records calls as messages of type TYPE_CALL) with a
user attached, answered or not. An inbound call is the lead calling, not a reply. Messages from workflows, campaigns, bulk actions or the API are automation
and do not stop the clock, unless the account switches on "Count automatic messages as a reply" (off by default).
**Business hours** (off by default, Settings). When on, a lead that arrives while the team is closed starts its clock at the next
opening time in that account's own time zone: Monday to Friday, from the opening hour to the closing hour (default 9 to 17), so a
Saturday lead is timed from Monday 09:00 and daylight-saving changes are handled. A lead that arrives during opening hours starts at
its own time; if it is still unanswered at closing it keeps counting overnight (it shows as waiting, never hidden). Stored as
`clock_start` on each lead; every screen, alert and the team figures read it. Code: `clockStart` in `lead-rules.ts`.
**Sources and targets.** portal and phone 5 minutes, Facebook and Instagram lead forms 10, web forms 15, social messages (DM, Messenger,
WhatsApp, TikTok, LinkedIn) 60, anything else the account target. "Facebook Lead Form" is a Meta lead form, "Instagram DM" is a social
message. How the CRM records Meta leads is not yet confirmed on live data: none of the connected accounts has any. The classifier reads
the contact's source text; attribution fields are not synced.
**Response time.** First touch minus start. **Target.** Per install, default 15 minutes, set in Settings (1 to 1,440).
**Hit rate.** Leads answered within the target divided by leads answered within it, answered late, or still waiting past
it. A lead still inside its target window is not judged yet. Shown only with at least 5 judged leads.
**Typical first reply and 9 in 10.** The median and 90th percentile of response times, only with at least 5 replies.
**Waiting now.** No first touch and older than the target. **Who replies fastest.** Median response per person, only
people with at least 3 replies, and only a named sender (a reply with no user is not a person).
Limits: the first 100 messages of a conversation are read, so a very long thread could hide an early reply; up to 100
unanswered leads per account are re-read each sync; leads answered once are never read again.
Code: `speed-intel.ts` (the rules), `speed-queries.ts` (the screen), `handleSpeed` in the sync engine. Tests:
`speed-intel.test.ts`, `scripts/check-speed.ts` (recomputes from raw rows). Not yet verified on real data: the
conversation messages permission has not been approved on the real accounts, so the real sync will record
"needs permission" until it is. 

**Breach alert.** One in-app alert per account (Slack too, when connected) when 3 or more new leads from the last two days
have no person reply past the target: a warning at 3, critical at 8. It names the count, the target and the longest wait,
is one open alert per account (a rerun never duplicates it) and resolves by itself when the leads are answered. Older
leads are not alerted on: they are no longer something to rush to. Email delivery is not built (no email service key).
Tests: `speed-alerts.test.ts`, and `scripts/check-speed.ts` raises, repeats and resolves one end to end.
