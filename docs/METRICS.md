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

**Waiting for a reply** (FACT), also called "waiting past the reply target". A conversation whose **last message is from the
customer** (inbound), older than the reply target (Settings, default 4 hours), and **newer than 30 days** (`WAITING_WINDOW_DAYS`). Older
inbound threads are "stale": nobody is still expecting an answer, so they are not counted. One window and one target are used on every
screen: Today, Overview, Inbox, Account audit and the exports all count the same conversations, and the Inbox says the window in words
("in the last 30 days") and splits the same total into "newer than a week" and "older than a week", so the parts add up to the headline.
- **Internal notes and system activity** are never the customer waiting: they are not inbound, so a conversation whose last message is one
  is not counted as waiting. *Known limit:* if a note or activity was added after the customer's last message, that conversation drops out
  until the platform's list shows the customer's message as last; we only store the last message, not the whole thread.
- **Automatic replies** (a workflow answering the customer) look like a reply, so the conversation is treated as answered. *Not built:* a
  setting to ignore automatic replies, because the conversation list does not say who or what sent the last message (Speed to lead reads
  messages and does; the Inbox does not).
- **Pending** (inside the target) and **answered** are not waiting. **Missing data** is not guessed.
- **Channels** are named in words from the message type (Text message, Email, WhatsApp, Facebook, Instagram, Live chat, Call) and counted
  for the waiting conversations only.
- **Deleted conversations:** the sync replaces an account's conversation list on every run, so a conversation the platform no longer
  returns disappears at the next sync.
- **Limit:** the sync reads up to the most recent conversations per account (a fixed number of pages; 1,000 on the largest connected
  account). If an account has more, older conversations are not read; because the platform lists the newest first, the 30 day window is
  normally covered, but this is not proven.
Code: `waiting.ts` (the rule), `queries.ts` (`inbox`, the SQL). Tests: `waiting.test.ts`, `tests/unit/inbox-waiting-db.test.ts` (the SQL and the rule
agree on every demo account), `tests/e2e/inbox.spec.ts`.

**New contacts, 30 days.** Contacts created in the last 30 days.

**Data completeness.** Average of three shares of contacts: with an email, with a phone of 7 or more digits,
with at least one tag.

**Dormant account.** No contact, deal or message activity for the dormant threshold (30 days by default).

## Health score and risk (0 to 100; "engagement score" in the code)

**Health score** (FACT, shown with where every point came from). The sum of five parts, nothing hidden, maximum exactly 100:
- Recent activity, 40: last activity 3 days ago or less 40, up to 7 days 34, 14 days 26, 30 days 16, 60 days 6, older or never 0.
- New contacts, 20: new in the last 30 days against about 5% of the contact list (at least 5 for a small list), capped at 20.
- Deals that are moving, 20: the share of counted open deals that are not stale; 8 when there are no open deals.
- Replies kept up with, 10: 10 minus 2 for each conversation waiting past the reply target, never below 0.
- Complete contact data, 10: the completeness percentage divided by 10.
**Bands** (shown as Thriving, Healthy, Watch, At risk): 75 and above, 55 to 74, 35 to 54, under 35.
**Gone quiet** ("dormant" in the code): no contact, deal or message activity for the quiet setting (30 days by default), or no activity ever recorded.
**Leave risk** (shown as Steady, Could leave, Likely to leave; "churn risk" in the code). A warning sign, not a prediction. It is "Could leave" when
the account has been quiet for the quiet setting or more, or its health is under 40, or its health fell 12 points from its recent average; and
"Likely to leave" when it has been quiet for twice the setting or never been active, or its health is under 25, or it fell 25 points. The
fall needs at least 3 days of score history. Each screen says the reasons in words.
Plain words on screen: Health, Steady, Could leave, Likely to leave, Gone quiet. The Accounts page has a "What do these words mean?" panel.
Code: `scoring.ts`. Tests: `core.test.ts`, `scoring-f7.test.ts` (golden cases at every threshold), `tests/e2e/accounts.spec.ts`.

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

## Call lists

Nobody is messaged from Call lists and there is no dialer: each row opens the person in the CRM (link built from the company's own domain). A list
shows the top 100 of up to 400 candidates, ranked by priority (deal value, quiet time, newness), and says "Showing the top N of M". A person is
left out of every list when they asked not to be contacted (do not contact), were marked wrong number or not interested, or were called in the last 12
hours (follow-ups that are due are the exception). Deal dollars on a row are counted deals only (value above zero and an owner), as everywhere.
The nine pre-built lists, each defined here once (code: `call-queries.ts`, test: `tests/unit/call-lists-db.test.ts` on a golden dataset):
- **Hot leads not contacted in 3+ days:** an open deal, and no activity for 3 days or more.
- **New leads with no reply (4 hours):** created in the last 4 hours and nobody on the team has messaged them yet.
- **Proposal stage, quiet for 7+ days:** an open deal in a stage named proposal, quote, negotiation or contract with no activity for a week.
- **Customers due a check-in:** won a deal, and no activity for 60 days or more.
- **Newest leads (24 hours):** created in the last 24 hours and no deal yet.
- **Win-back:** won a deal over 180 days ago and nothing open now.
- **No-show recovery:** a no-show in the last 14 days and not booked again since.
- **Recent customers:** won a deal in the last 90 days.
- **Follow-ups due:** a call outcome of follow-up whose date has passed.
Speed: each list is looked up from its small side (the deals, the appointments, the outcomes or the newest contacts) rather than by reading every
contact, with two added indexes; on the largest connected account (52,926 contacts) a list went from timing out (over 8 seconds) to 0.4 to 2.0 seconds
including a round trip of about 0.4 seconds from the test machine. `scripts/profile-calls.ts` repeats the measurement.

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

## Freshness and refresh (stage S0.4)

**Freshness** (FACT). How old the copy of the CRM that SubSync shows is. One definition, one function (`freshnessOf` in
`src/lib/sync/freshness.ts`), one place on screen (the line above every page), and the same words in the daily brief:
- An account's last successful refresh is the last time its conversations were read (`locations.conversations_synced_at`;
  that read happens in every 15 minute cycle). Until that exists, the first time anything was read for it (`last_synced_at`).
- The one value shown is the OLDEST of the accounts the person may see (a client's staff see their own account only), so the
  screen never claims to be fresher than its stalest account. Each account's own time is listed under "Each account".
- Wording: "Updated 7 min ago" (up to and including 30 minutes). Over 30 minutes: "Updated 45 min ago, refresh is delayed".
  If the latest read of an account failed after its last success: "Updated 9 min ago, but the latest refresh failed for 1 account"
  (or "..., refresh is failing" when also over 30 minutes) and a plain reason. Before anything has finished: "First sync in progress"
  or "Not synced yet". Demo data: "Sample data. Nothing here is refreshed from a real account."
- A failure counts only while it is the latest finished job of its kind for that account (`distinct on (location_id, type)`), so a
  later success clears it. A failure of the job that lists the accounts, or an access token not renewed for 3 days, is a connection
  problem for the whole install.
- The note "a sync is running" is shown only for a first sync, or when a job has been queued or running for 10 minutes or more
  (`LONG_RUNNING_MINUTES`). A normal refresh, which takes seconds, never shows it.
- Not affected by a filter chosen on screen.
Code: `src/lib/sync/freshness.ts` (words), `freshness-queries.ts` (the one read). Tests: `src/lib/__tests__/freshness.test.ts`,
`tests/unit/sync-reliability-db.test.ts` (real rows), `tests/unit/freshness-one-source.test.ts` (one place in the source),
`scripts/check-sync.ts` (every answer says the same sentence), `tests/e2e/freshness.spec.ts` (every page in a browser).

**Refresh cadence** (FACT about the system, not a number on screen). Every 15 minutes each account's conversations, appointments and reply
times are re-read and alerts are recomputed; once a day the contacts and deals are re-read in full; a change in the CRM queues the matching
read at once. The scheduler wakes every 5 minutes. A cycle is due when the previous one was QUEUED 14 minutes ago (measured from the start with a
one minute allowance); measured from the finish with a plain 15 the real cadence was 20 minutes (live history, 31 Oct to 1 Nov). Code:
`src/lib/sync/schedule.ts`, `scheduleFastRefresh` in `engine.ts`. Tests: `schedule.test.ts` (fake clock, outage, duplicate wake-up),
`sync-reliability-db.test.ts`.

**Send window** (the daily brief and the Monday email). Sent once per local day, when the scheduler's hourly check falls in the chosen local hour
or the next 3 hours (`SEND_CATCHUP_HOURS`), never past the end of that local day; later than that the day is skipped. The Monday email also needs
Monday in the chosen time zone. Daylight-saving days: a chosen hour that does not exist goes out at the next hour; an hour that happens twice
sends once (one send per local date). Code: `dueNow` (`digest-intel.ts`), `weeklyDue` (`weekly-email.ts`), `inSendWindow` (`schedule.ts`).
Tests: `src/lib/__tests__/dispatch-time.test.ts`.

**Sync alarm** (internal, not a customer number). An install whose oldest account was last refreshed more than 30 minutes ago, or which has had
no finished refresh and no progress. Written to the audit log (`sync.alarm`, at most once an hour while it stands; `sync.recovered` when it
clears) and shown at `/api/admin/diagnostics` (server secret only). Code: `src/lib/sync/alarm.ts`, `watchdog.ts`. Tests: `alarm.test.ts`,
`sync-reliability-db.test.ts`.
