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

**Open pipeline** (FACT). Sum of value over counted open deals. Count of counted open deals.

**Stale deal** (FACT). A counted open deal whose last movement is older than the stale threshold (30 days by
default). Movement is the latest of: last stage change, last action, last update, last status change; if the
platform gave none, the created or last-synced time. **Stale deal value** is the sum of their values and is
a part of Open pipeline, never more than it.
*Known gap:* the threshold is one number for every stage. Brief 13A asks for a threshold per pipeline stage.
That needs stage history (how long deals normally sit in each stage), which only exists once the event store
has collected enough moves. Until then one number is used, and the screen says "have not moved", not "lost".

**Win rate** (FACT, with a minimum). Won deals divided by won plus lost deals, per account, shown only when
the account has at least **20** closed deals (`MIN_CLOSED_DEALS`). Below that there is no win rate and nothing
is built on it. Test: `derive.test.ts`, `metrics-trust.test.ts`.

**Average deal value.** Average value of won deals; when there are none, open value divided by open deals.

## Estimates (always labelled "Estimate, not a fact")

**Expected revenue** (ESTIMATE). For each account that has a win rate: counted open value times that
account's win rate; added across accounts. If no account has a win rate the Overview shows "Not enough data".
It can never exceed Open pipeline.

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

Platform statuses: new, confirmed, cancelled, showed, noshow, invalid. **Held** is showed. An appointment is
**active** unless cancelled or invalid.
**Show rate** (FACT, with a minimum): showed divided by showed plus no-show, only with at least 5 recorded
outcomes in the window; otherwise "not enough outcomes".
**Unmarked.** An active appointment whose time has passed (after a short grace period) with no showed or
no-show recorded. These make a show rate lie, so they are listed rather than guessed.
**No-show recovery.** No-shows in the last N days where the contact has no later active appointment.
Code: `appointment-intel.ts`, `appointment-deep.ts`. Tests: `appointment-intel.test.ts`, `appointment-deep.test.ts`.

## Our own history (event store, recording now)

`deal_events`: a deal first seen after the first sync, a stage change, a status change.
`appointment_events`: an appointment first seen after the first sync, a status change, a move of one minute
or more. Both are append-only and are never edited. The first sync of an account records nothing, because
every record would look new. Nothing yet reads these tables for a screen. Planned readers (Wave 2): deal
velocity, stage dwell time (which will also give per-stage stale thresholds), true show-rate history.

## Test accounts

An account is "test data" when its name contains test, testing, demo, sample, sandbox or dummy as a whole
word. The "Hide test accounts" switch removes them from every page. It works on accounts only, not on
individual deals. Code: `test-data.ts`.

## Speed to lead (Wave 1 #1)

**Lead.** A new contact (created in the last 14 days) that has a conversation. A contact with no conversation is not
timed: bulk imports would otherwise look like thousands of unanswered leads.
**Start of the clock.** The earlier of the contact being created and the first inbound message.
**First touch.** The first outbound message at or after the start that a person sent from the app: an outbound message
with a user attached and the source `app`. Messages from workflows, campaigns, bulk actions or the API are automation
and do not stop the clock, unless the account switches on "Count automatic messages as a reply" (off by default).
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
