# Metric definitions

## Lead flow (Today, Lead flow tab)
- **Cohort:** contacts CREATED (date added) in the chosen dates, each client's own midnight to midnight, for the clients the person may read. Dates: last 7 days (default), last 30 days, this month, last month, custom (at most 366 days, not in the future). A lead the lead rules set aside (`lead_touches.excluded`) is left out. Followed to where each lead is now; the dates only choose which leads.
- **Replied to:** a person (not an automatic message) answered: `lead_touches.human_touch_at` is set. **Never answered:** SubSync read the lead's conversation and found no person's reply, or the lead is under 14 days old with no conversation at all. **Not checked:** older than 14 days with no reading (the first-reply check only covers conversations of the last 14 days), or reading conversations is not approved. These three add up to the new leads.
- **Booked an appointment:** at least one appointment of the contact whose status is not cancelled or invalid. **No appointment:** the rest. Booked and no appointment add up to the new leads, whatever the reply step says.
- **Showed up / No-show / No outcome yet:** of the booked leads. Showed up wins over no-show (any showed appointment); then no-show; otherwise the appointment is still to come or nobody marked it. These add up to the booked leads.
- **Won a deal** (a number beside the chart, not a step): the lead has a deal with status won.
- **Percentages** are of the parent step (replied, never answered, not checked, booked and no appointment: of new leads; showed up, no-show, no outcome yet: of booked). Under 10 leads the chart shows counts only and says "Too few leads to read".
- **Every step and every band** opens the leads counted in it; the count on the mark equals the rows (the browser holds up to 3,000 leads per read; the counts cover up to 20,000, and the list says when it was cut). Tests: `src/lib/__tests__/lead-flow.test.ts`, `flow-records.test.ts`, `tests/unit/lead-flow-db.test.ts`.

## Clients coming and going (Today, agency only)
- **Added:** when SubSync first saw the client (`locations.installed_at`, else `created_at`). **Removed:** the day the client's data was removed (uninstall or removed from the list), recorded in `client_departures` from the day that table exists; earlier departures are not known. The tab says both in one line. Weeks start on Monday (UTC), the last 12 weeks, the current week still running. **Current** is the clients on the list now. Tests: `clients-flow.test.ts`, `tests/unit/today-reports-db.test.ts`.

## Email leads list (Today, Growth tab)
- The same people as the Growth counters (one person once per client, the Growth rules), newest first, with a search over email, name, client and source. The download has exactly the people the filters show, minus anyone marked do not contact or tagged unsubscribed (they stay in the list, marked). A download writes one audit line (counts only).

Every number shown in SubSync is defined here once. If a number on screen disagrees with this file, the
screen is wrong. Each definition names the code that computes it and the test that pins it.
Status: FACT means counted directly from synced records. ESTIMATE means built from a rate, and the screen
says so and shows the formula.

Defaults are per install and can be changed in Settings: stale after 30 days, dormant after 30 days,
reply target (SLA) 4 hours.

## Conventions that apply to every number

- **Window.** Every "last N days" is rolling (N times 24 hours back from now), so a window has no midnight edge and no daylight-saving edge. A figure by calendar day or by hour of day (the best-times map, "booked twice the same day", after-hours leads) uses the client account's own time zone; an unknown time zone is read as UTC.
- **Currency.** Amounts are shown as entered in each account. The database stores no currency, so nothing is converted or added across currencies, and each dollar card says so. (Open: store each account's currency at sync.)
- **Exclusions.** Ignored accounts, and accounts hidden by the filter at the top of the app (a kind of business, an account manager, "hide test accounts"), are left out of every number on every page. One test (`scripts/check-filter.ts`) proves the same filter gives the same numbers on all pages.
- **Minimum sample.** Each rate, claim or estimate names its minimum in its own definition (20 closed deals for a win rate and the forecast, 5 replies, 5 recorded outcomes, 10 for a "down X%" claim, 10 or 5,000 dollars for a percentage change) and the screen says "not enough data" with the number still needed.
- **One place.** A definition lives in one function or one SQL fragment; screens call it and do not calculate (the sums on the Leads and Stages cards are done on the server).

## Deals

**Counted deal.** An open deal with a value above zero, a person it belongs to (an owner), and a place **in play**: not in a closed-out
or ignored stage and not in a pipeline marked not in use (see "Stage rules" below; stage F1, N38). Only counted deals feed any dollar figure or
open/stale count. Deals that are not counted are not deleted; they are left out of the totals, and every screen that shows a total says how many were
left out and why, in three reasons that never overlap: in a closed-out stage or an unused pipeline (counted first), no value, no owner
(`excludedDeals`, `excluded.closedOut`, `excluded.noValue`, `excluded.noOwner`). One SQL fragment states the rule everywhere
(`stage-rules-sql.ts`: `countedInScope`), and the Pipeline, Today, Overview, Accounts, Team, Leads lifecycle, Call lists, the stage cells, the
quiet-deals list and the exports all use it. Code: `queries.ts` (`counted`), `metrics.ts`. Tests: `tests/unit/f1-deal-scope-db.test.ts` (golden
deals in a real database), `scripts/check-filter.ts` (same figures on every page under every filter), `scripts/check-metrics.ts`.

**Open pipeline** (FACT). Sum of value over counted open deals (in play, with a value and an owner). Count of counted open deals. This is the only definition:
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

**Likely revenue, Pipeline screen** (ESTIMATE). The most likely figure of the forecast below; "Not enough data" when the forecast has no basis.
Labelled "Estimate, not a fact" with the method one tap away.

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
- **Unread** (FACT, stage F1, N15) is a different thing from waiting. Unread is every conversation whose unread count is above zero, the same figure on
  Today (the "Unread conversations" tile), Overview (`kpis.unread`) and the Inbox ("Unread (N)"). A conversation can be both unread and waiting; the
  Inbox says how many of the unread ones are also waiting (`unread.unreadAndWaiting`) and lists those only once, under waiting. The old Inbox card showed
  only the unread ones that were not waiting, which is why Today said 285 and the Inbox 259: on 1 Nov 2026 the real figures were 285 unread, of which
  24 were also waiting, so 261 were shown below (a few hours earlier: 26 and 259). Nothing was added together; one list was subtracting the other. Code:
  `unreadSummary` in `waiting.ts`. Test: `f1-rules.test.ts` and the "unread" checks in `scripts/check-filter.ts`.
- **Critical** (stage F1, N15). A waiting customer is "critical" only when they have waited more than 24 hours and less than a week
  (`CRITICAL_FROM_HOURS`, `CRITICAL_UNTIL_HOURS` in `comms-intel.ts`). Longer than a week is the "Older than a week" bucket and is never critical, so an
  alarm is never raised on threads that are mostly dead. The wait chart counts exactly the waiting set the Inbox list shows (it used to count every
  inbound thread, including ones 750 days old: 255 customers on the chart against 26 in the list).
- **Read limit** (stage F1, N15). SubSync reads the newest 500 conversations of each account (`CONVERSATIONS_READ_PER_ACCOUNT`, five pages of 100 in
  `engine.ts`). Where an account is at the limit, Today, Overview and the Inbox say "SubSync reads the newest 500 conversations of each account. N of M
  accounts have more than that, so older conversations are not counted here" (`readLimitNote`). On 1 Nov 2026, 2 of the 3 real accounts were at 500.
  The Inbox list itself is capped at 2,000 rows and says "Showing the first 2,000" if that ever happens.
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
**The label people read** (stage F1, N16 and N62) is the score's band held down by the reply delay (`healthBand` in `scoring.ts`): with 5 or more customers
waiting for a reply past the target the label is at best Watch, with 15 or more it is At risk, whatever the score says. The score only takes up to 10
points off for waiting replies, so an account with 23 customers waiting scored 57 and read "Healthy" inside a "Needs attention" list. The score itself is
unchanged, so its history stays comparable; the screens say when the label was held down ("The score says healthy, but 21 customers are waiting for a
reply, so it is shown as at risk"). In a "Needs attention" list nothing is labelled Healthy or Thriving: `attentionBand` makes it at best Watch.
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

## Stage rules: which deals are in play (stage F1, N38)

A deal in a stage named "Disqualified", "Wrong Phone Number", "Unreachable", "Not interested", "Lost" and the like is closed out by design, and a pipeline
named "[Not IN USE]" is not one anyone works. Deals there are never open pipeline, never stale and never "dead pipeline to clean up", and they are not
forecast. The owner can classify each stage (Active, Closed out, Ignore) and each pipeline (In use, Not in use) under "Stages and pipelines" on the
Pipeline page. **With no rule from the owner, the suggestion made from the name applies, and the screen says so ("The stage's name says the deal is closed
out. Change this if it is wrong").** The owner's rule always wins, in both directions (a stage named Disqualified can be marked Active). Rules are stored
by pipeline and stage NAME (lower case, trimmed), so the same pipeline cloned into many client accounts is one rule (table `stage_rules`). Words that suggest
closed out (whole words, case-insensitive): disqualified, bad fit, not a fit, not qualified, unqualified, wrong number, wrong phone, wrong contact,
unreachable, do not contact, dnc, junk, spam, not interested, closed lost, lost, dead, archived, abandoned. Words that suggest a pipeline is not in use:
not in use, unused, deprecated, do not use, inactive, archived, retired, obsolete. The same two patterns are used by the screen and by the database
(`CLOSED_OUT_STAGE_PATTERN`, `NOT_IN_USE_PIPELINE_PATTERN` in `stage-rules.ts`, read by Postgres with `~*`), and a test checks they have no escapes.
A rule can be taken off ("Use the name instead"). Changing a class is a **change of definition** (see "Definition versions"); a win probability is not.
Real data on 1 Nov 2026: of 80 pipeline and stage pairs with open deals, 13 are closed out by name (for example School Outreach / Bad Fit, Wrong Phone
Number, Not Interested, Unreachable; KDS LinkedIn Outreach Partner / Disqualified; two pipelines marked [Not IN USE]), holding 1,033 open deals, none of
which has both a value and an owner, so today the rule changes no dollar figure on the real accounts; it changes the stage lists and the stale and dead
counts. Code: `stage-rules.ts`, `stage-rules-sql.ts`. Tests: `f1-rules.test.ts`, `tests/unit/f1-deal-scope-db.test.ts`.

## Forecast (stage F1, N37; rewritten)

The forecast is shown only when there is a real basis, and always as a **range with its basis on show**:
1. **From your closed deals.** A win rate needs at least 20 closed deals (one minimum for the whole product). The range is the open value times the low
   and the high end of an 80% interval for that win rate (Wilson interval on won out of closed: 12 won of 20 is a rate of 60% that is really between about
   46% and 73%, so 20,000 of open value converts to about 9,145 to 14,553, most likely 12,000). Fewer closed deals, a wider range. The screen states it:
   "About 80% sure the open value converts to between $A and $B". Code: `rateRange`, `forecast` in `pipeline-intel.ts`.
2. **Your own assumptions.** Until there is history, the owner sets a win probability per stage under "Stages and pipelines". The forecast is the sum of
   value times the probability of its stage, with a band of 10 points either way, and is labelled "Your own assumptions", with no confidence figure because
   there is no statistic behind it. A stage with no probability set is left out (and counted: "N deals are in a stage with no probability"), never given a
   default. When both exist, history leads and the owner's figure is shown beside it.
3. **Timing** comes from the real sales cycle of each pipeline: for a deal already d days old, the share of that pipeline's won deals that closed within
   the next 30, 60 or 90 days given that they took longer than d (`closesWithin`). It needs at least 10 won deals with dates in the same pipeline; a deal
   older than any won deal is not placed in time (and counted). The three horizons are therefore different numbers, never one repeated. Each horizon is
   given as a range using the same low and high as the total.
4. **What is in it:** counted open deals only (a value, an owner, in play). The "How this is calculated" drawer lists the formula, the inputs (open deals and
   value, closed deals and the minimum, the win rate, the won deals used for timing), what was included, what was left out and why, and the caveats
   (currency not converted; assumes open deals behave like closed ones; timing basis).
5. Below the minimum and with no stage probabilities: "No forecast yet. It needs 20 closed deals (there are 5, so 15 more), or a win probability that you
   set for each stage." *Not built:* forecast versus actual each month (N37 item 6) needs a monthly snapshot of the forecast and a forecast that has existed
   for a month; no real account has 20 closed deals yet. It is part of stage P1 (Pipeline rebuild).
Tests: `pipeline-intel.test.ts` (history range worked by hand, owner band, timing, no-basis text, too few won deals), `consistency.spec.ts`.

## Definition versions (stage F1, N39)

Every daily snapshot (`account_metrics_daily`) is written with the version of the counting rules it was counted under (`definition_version`: the code's
`DEAL_RULES_VERSION` times 1000 plus the number of times the owner has changed a stage class). History is only ever compared inside one version:
- the "Open pipeline over time" chart draws only the days of the newest version and says how many earlier days were not drawn and why;
- "vs yesterday" and "vs the last 7 days" for open pipeline, stale deals and the health score use only days of the current version;
- the churn baseline (score history), the executive summary's 30-days-ago figures and anomaly series, the account trend and the Today headlines follow
  the same rule. Figures that do not depend on how deals are counted (new contacts, unread, contacts, completeness) keep their whole history.
Rows written before the column existed (null) are read by date: every open deal counted up to 30 Oct 2026 (version 1), counted deals from 31 Oct 2026
(version 2). This is the real case behind N39: on the real agency the series read 2,400,000 over 10,374 deals on 30 Oct and 1,000,000 over 1 deal from
31 Oct, a change of rule drawn as a fall. Version 3 (this stage) starts with the stage rules; the earlier days are not drawn, which is why the chart
needs two days before it appears again. Code: `definitions.ts`, `definitions-sql.ts`. Tests: `f1-rules.test.ts`, `tests/unit/f1-deal-scope-db.test.ts`.

## Percent change (stage F1, N6)

A percentage change is shown only when the figure it is measured against is at least 10 (a count) or 5,000 (dollars): `percentChange` in `metrics.ts`.
Below that the screen shows the plain difference ("down 2 from yesterday") or states the earlier figure ("was 2 before (too small a base for a
percentage)"), so two contacts never read as "-100% vs yesterday". Applies to the Today tiles, the executive summary, the Leads growth table and every
"down X%" alert that has its own baseline rule.

## Leads: cold lists and what a contact has done (stage F1, N45)

The platform does not send a contact's last activity (none of the 103,404 synced contacts has one), so "quiet over 90 days" measured age. It is replaced by
what SubSync can really see:
- **Cold lists** are the tags that name a bought, scraped or cold-outreach list (words: cold, outreach, scrape, purchased, bought, list import, lead list,
  prospecting list), unless the owner chose the list of tags himself (even an empty list: then nothing is cold). Contacts carrying a cold tag are counted
  apart as "on cold lists" and are never counted as working leads or as going quiet. Each cold list is shown on its own with how many of its contacts
  have a reply, booking or deal seen. Stored in `settings.cold_tags` (null means "use the tag names").
- **Engaged** means a signal exists: the customer wrote last in a conversation (an inbound last message), an appointment (not invalid), or a deal in play.
  For working leads: seen in the last 90 days, **engaged then quiet** (a signal, and nothing since for more than 90 days), or **nothing seen**.
  Limit, stated on the screen: conversations are the newest 500 of each account (see "Read limit"), so "nothing seen" is not "never replied", and a
  conversation where we wrote last says nothing about a reply.
- Real data on 1 Nov 2026 (the agency install): 52,926 contacts, of which 50,958 carry a cold tag (`cold email outreach` alone 49,622, with 3 contacts
  engaged), 1,968 are working leads: 152 seen in the last 90 days, 275 engaged then quiet, 1,541 nothing seen.
Code: `suggestColdTag`, `effectiveColdTags`, `engagementOf` (`contact-intel.ts`), `contactOverview` (`contact-queries.ts`). Tests: `f1-rules.test.ts`,
`tests/unit/f1-deal-scope-db.test.ts`.

## Leads: data quality, and where leads come from (stage F1, N46 and N47)

- **Invalid**, **disposable** and **missing** are three different counts. Invalid is judged on the values that exist (an email that cannot work, a phone
  of fewer than 7 or more than 15 digits or one repeated digit); missing means nothing was typed. Every figure says "N of M checked". When the check
  cannot run it says **"Not checked"** with the reason ("The contacts have not been read yet", "No contact has an email address to check") and never
  shows a zero. The database check and the JavaScript check are the same rule, and a database test feeds both the same addresses and numbers (it found
  that the database accepted ".dot@x.com" and "dou..ble@x.com" that the other rule refuses, and that was fixed). Real data on 1 Nov 2026: 0 invalid emails of
  50,891 checked, 0 invalid phones of 36,746, 2,035 contacts with no email and 16,180 with no phone: the zero is a real zero, and the large number is
  what is missing.
- **Sources.** The text in a contact's source is grouped into kinds (Facebook or Instagram lead form, property site or call or walk-in, web form or ads or
  website chat, a message, something else, none). When 50% or more of at least 20 contacts have no source, the card opens with the action ("99% of your
  contacts have no source recorded, so you cannot tell which marketing brings customers") and three steps. The Speed to lead side of N47 is stage F2.
Code: `qualityFigures`, `sourceSummary` (`contact-intel.ts`).

## Leads lifecycle: two counts of "open deal" (stage F1, UX-02)

"In an open deal (any value)" counts contacts with an open deal in play, whatever its value. The line under it says how many of those contacts have a deal with
a value and an owner, the kind the dollar figures count (on the real agency: 9,171 contacts in an open deal, 1 with a counted deal). Both are shown, with
the difference said in one sentence, so the Leads page no longer appears to disagree with Pipeline.

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

## Today, rebuilt (3 Nov 2026)

Today measures nothing new. Every figure is one SubSync already shows on its own page, under that page's definition. What Today adds is the order, the sentences, the shares behind the charts and the "vs your usual" comparisons. Code: `src/lib/analytics/today-queue.ts` (pure), `src/lib/api/today-api.ts` (gathers the reads), tests `src/lib/__tests__/today-queue.test.ts`, `today-geometry.test.ts`, `tests/unit/today-db.test.ts`.

**The five kinds of thing.** Leads waiting (Speed to lead: a lead past its reply target with no person's reply, never-answered included), appointments to mark (Appointments: past by more than 3 hours, last 30 days, not cancelled, no outcome), no-shows to recover (last 14 days, not rebooked), stale deals (the Account audit: counted open deals with no movement for the stale days; the dollar figure is the sum of their values), unanswered messages (the audit's waiting conversations: customer's message last, older than the reply hours, newer than 30 days). Each kind has one list; the count shown anywhere is the number of rows in that list (the list may be capped, and then says so).

**The Fix first queue.** One row per client account and kind. Ranking rule, in this order: (1) value at risk, largest first: counted dollars when the row has them (stale deals), else the existing slow-follow-up estimate (waiting conversations x average deal x win rate, only where the account has enough closed deals), else 0; (2) how long it has been wrong, longest first (the oldest item in the row); (3) severity, urgent before soon before when you can; (4) account name, then kind, so the order never flickers between two reads. Money we can count therefore outranks counts. Severity: leads waiting is urgent when the oldest has waited an hour or more or one was never answered, else soon; unanswered messages urgent at 5 or more; stale deals urgent at 10 or more; no-shows soon; appointments to mark soon at 5 or more, else when you can. Wording per row is 6 to 10 words. Test: "the ranking rule" and "equal value and age fall back to severity".

**The headline.** "N clients need you today. $X is at risk." N is the number of client accounts with at least one row in the queue; $X is the counted value of stale deals only (a fact, never an estimate). One deal worth at least half of the stalled money (the audit's outlier guard) is said out loud: "One deal is $Y of that." With nothing to do: "Every client account is on track today." For one account the count is of things: "3 things need you today."

**Four figures against your usual.** A comparison appears only above the minimum sample, else the tile says "Not enough history yet to compare with your usual." Typical first reply: the median first reply of leads that arrived in the last 7 days against the 7 days before (each needs at least 5 answered leads, the minimum for a median); a difference under 15% is "about the same". The line is the 7-day typical reply for each of the last 7 days; a day under the minimum is left out, never guessed. Open pipeline at risk: the stale-deal count against the daily check's own normal (at least 4 earlier days, outside the usual band). Leads waiting and appointments to mark have no stored history, so they show the raw count and say so.

**What needs attention (the donut).** One slice per kind with something in it; share is the count over the total, rounded so the shares add up to 100. The count on a slice equals the number of rows in the list it opens (test: "donut slices"). **Where it is happening (the bars).** The top 8 accounts by number of things to fix, split by kind in the same colours as the donut; dollars in the tooltip. Clicking a bar sets Today's own account choice.

**What SubSync caught.** From the existing alerts: raised in the last 7 days (by day created), cleared (by day the condition went away) and still open now. The word is cleared: SubSync cannot tell whether a person fixed it. Not shown to a client's staff.

**For one account (a business, a setter, a client's staff).** My numbers this week: typical first reply as above; show rate (last 30 days against the 30 before, needs 5 appointments with an outcome, a difference under 5 points is "about the same"); leads answered inside the target (this week against last, needs 5 judged leads). Streak: days in a row, counting back from yesterday, on which at least one lead arrived and every lead was answered inside the target (UTC days; a day with no leads neither extends nor breaks it).

## Today, second pass (4 Nov 2026)

Still no new measurement of the CRM. Everything below is worked out from rows SubSync already holds: Today's own items (the five kinds above), the lead ledger (the same `lead_touches` rows, window, exclusions and judging as Speed to lead: the last 14 days, `speed_target_minutes` as the reply target) and the alerts. Code: `today-records.ts` (lists), `today-state.ts` (marks and the junk control), `today-smart.ts` (insights and the rest), `today-specs.ts` (one list per mark). Unit tests beside each.

**The list behind every mark.** Every number, slice, bar, legend row, day, tile, headline figure, insight and hour opens one list. Its count is the number that was pressed (unit test: every kind of mark of a fixture is opened and the heading count is compared with the rows). A list that was cut says so under the table ("SubSync loaded the first N of M"); the heading still shows the true count. Search, filters, sorting and the spreadsheet download only narrow what the person already received; nothing is requested for other accounts. A mark whose records SubSync does not hold (history older than 14 days) is not a button and says why.

**Working queue (Done, Snooze, Assign to me, Undo).** One append-only row per press in `today_actions` (who, when, which items). Done holds the row's items back for 7 days (`DONE_HOLD_DAYS`); if the CRM still shows them wrong after that, they come back. Snooze 1 day is 24 hours; Snooze until Monday is the next Monday 08:00 in the client account's own time zone (UTC when the zone cannot be read). Assign to me shows the person's name on the row and holds nothing back. Undo is open for 10 seconds and is a new row that points at the press it cancels. A press covers exactly the items of that row at that moment, worked out by the server (the browser names only the row and the action). Lanes: an agency or a business administrator share the `team` lane; a client's staff have a lane of their own (`user:<id>`) and may only press Done and Snooze, so a setter can never hide a problem from the agency. A held item leaves the rows, the totals, the queue, the headline and every chart (the true totals are reduced by exactly the rows removed, so a capped list stays honest); the "Set aside" list shows each with who and until when. SubSync's own marks are never read by any metric, are not written to the CRM and are not events of the CRM event store. If `today_actions` does not exist yet Today opens with every row and a press answers "Needs the latest database update".

**Junk control, "Exclude test and very old deals".** Applies only to stale deals. A stale deal is left out of the dollar figure and the counts when its own name is an obvious test name (the same words as the test-account switch) or when it has not moved for more than 3 times the stale-days setting (`JUNK_MULTIPLE`, 90 days at the default 30). The list under the control names every deal left out with its dollars, so the figure can be rebuilt by hand. On by default (the person's choice is remembered in this browser); saved per view.

**Spotted today (at most three cards, facts before estimates).** Each card shows how many leads it is based on and opens them. (1) Owner with leads nobody replied to: the owner with the most leads of the last 14 days that arrived at least 3 days ago with no reply, at least 5 of them (a count, a fact). (2) No-shows nobody rebooked: the client account with the most, at least 3, worked out from the items on screen so a row set aside is not counted (a fact). (3) After hours: typical first reply of leads that arrived between 18:00 and 08:00 (account's own time) against leads that arrived 08:00 to 18:00, each group at least 5 answered, shown only when the night time is at least 2 times longer and at least a minute longer (an estimate, labelled). (4) Source: slowest source against fastest, each at least 5 answered leads, at least 2 times and a minute longer (an estimate). A comparison never says why.

**Since your last visit.** Per person, `saved_views` page `today_visit` holds when Today was last open and when the visit before ended. A visit is a stretch of use with no gap over 30 minutes. It counts: leads that arrived, leads whose reply target ran out without a reply inside it, leads that got a first reply, alerts that cleared (not for a client's staff). Counted from the ledger, so a visit older than 14 days is cut to 14 and the strip says so. The first ever visit shows nothing.

**If nobody acts today.** Leads inside their reply window with no reply: each passes the target at arrival plus the target. Counted open deals whose last movement is between the stale days and the stale days plus one day ago: they turn stale within a day (dollars counted). Appointments that start later today (account's time zone) will need an outcome marked. The line says "If nobody acts today: ..." and a number is never a promise. A live ring on the next lead to breach counts down to it.

**Best next action, per client account.** From fixed rules, never a model: the account's top row in the queue decides the kind; leads: the 5 longest-waiting, no-shows: 3, appointments: 5, stale deals: the 3 biggest, conversations: the 5 oldest. The effect line is arithmetic on the count ("12 leads would still be waiting after that").

**Why behind a red row (leads rows only).** At most three measurable things the row's leads have in common, each covering at least 2 leads and at least half of the row: no owner in the CRM, arrived outside 08:00 to 18:00 in the account's time, one source. It says what they share, never what caused it.

**Coverage strip (24 hours).** Per local hour of arrival, leads judged in the last 14 days, how many were answered inside the target. An hour is a gap when it has at least 5 judged leads and fewer than half were answered inside the target. The title names the hour that misses most, or says no hour stands out, or that there are too few leads.

**Speed by source.** Per source as typed in the CRM (grouped without regard to case), judged leads, how many were answered inside the target, and the typical first reply once at least 5 were answered. Fewer, and the typical time is not shown.

**Workload by person.** Leads waiting by the person who owns them in the CRM, with how many first replies that person sent in the last 14 days. Overloaded: at least 5 waiting and at least twice the middle person's count (needs 3 people). Quiet: at least 3 waiting and no first reply in 14 days, shown only when the ledger holds at least 5 replies in all. A person's typical reply needs 3 replies.

**Accounts compared.** Typical first reply per client account over the last 14 days, ranked only with at least 5 answered leads; the 3 fastest and the 3 slowest (fewer when fewer than 6 are ranked, so the lists never overlap).

**Saved views, command palette, printable report.** A view stores which client accounts and the junk switch, nothing else, and is the person's own (at most 10). The palette lists jumps, lists, accounts, views and actions; Ctrl or Cmd + K opens it on Today. The report prints the headline, the top 12 Fix first rows, the insights, the forecast line and what SubSync caught, with the sender's own brand name when one is set.

## Workflows and campaigns (module W1)

- **Failing** workflow: published, with logs known, at least 3 failed steps and at least 20% of the steps of the last 30 days failed (critical from 50%). Counted from the log totals; never from a guess.
- **Never ran (30 days)**: published and the log total of the last 30 days is exactly 0. An estimate (a rare trigger can be quiet on purpose). Unknown logs are "not known", never 0.
- **Old draft**: draft and not edited for 30 days. Estimate.
- **Campaign looks stuck**: shown as running or scheduled and not changed for 14 days. Estimate. **Campaign failed**: the platform says failed.
- **Missing basics**: an account has no published workflow whose name looks like missed call text back, new lead follow up, appointment reminders or no show follow up. By name only, so an estimate.
- **Delivered share** = delivered / sent, only when both are reported and sent is above 0. **Delivery health (0 to 100)** = 100 x delivered share, minus 50 x (bounced + failed) / sent, minus 200 x unsubscribed share (capped at 10%), only from 50 sent. Below that: "Not enough data".
- **Looks sent but did not arrive**: from 50 sent, shown as sent or done, and delivered share below 80%. Bounces above 5%, unsubscribes above 2% and messages waiting for more than 2 days are separate prompts.
- **Against its own usual**: the campaign's delivered share against the median of the same account's earlier campaigns, needs 3 earlier ones of 50 sent or more.
- **Marked fixed / snoozed** hides a finding for 7 days / until the date; it returns by itself if the problem is still there. **Cleared** (Proof) = the alert's condition went away; SubSync cannot tell who fixed it.
## Today, third pass (4 Nov 2026): the counting rule

Still no new measurement. This pass fixes how the same figures are COUNTED and worded. Code: `src/lib/analytics/today-queue.ts` (`mergeReplies`, `countsOf`), tests `src/lib/__tests__/today-count.test.ts`, `tests/unit/today-lists.test.ts`, `tests/e2e/today3.spec.ts`.

**The bug.** Today counted "leads waiting" (Speed to lead) and "unanswered messages" (the audit's waiting conversations) as two kinds and added them. A new lead that nobody answered is usually also a conversation nobody answered, so one person was counted twice (live: "8 leads waiting and 24 unanswered messages" were shown as 32 things, and the 8 were among the 24).

**Waiting for a reply** = distinct contacts (people) who are waiting for a reply: either a new lead past the reply target (`speed_target_minutes`) with no person's reply, or a conversation whose last message is the customer's and which is older than the reply window (`sla_hours`). A person who is both is ONE person. A person with several waiting conversations is one person (the longest wait). A conversation with no contact id is counted once per conversation. Each person is one row (kind `replies`). **New leads among them** is a SUBSET, said as "of which N are new leads" or "(N new leads)", never added to the people count.

**Capped lists.** The two source lists are capped (200 waiting leads, 100 waiting conversations). When a list was cut, the part that was not loaded cannot be matched with the other list, so the count adds what is missing from each list (an upper bound) and the list says it was cut ("first ones only"). With neither list cut the count is exact.

**One function.** `countsOf(totals, rows)` returns `replies`, `newLeads`, `appointments`, `noshows`, `stale`, `staleDollars`, `things` (the kinds added up; no person is in it twice) and `accounts` (client accounts with at least one row). The headline, the breakdown line, the tiles, the work list, the bars, the lists behind every number, the share text and the daily brief read these. Unit test: one fixture (8 leads inside 24 conversations, plus a second account) is built once, and the headline sentence, the breakdown, the tile, the work-list rows, the bar totals, every bar segment and every list's count and rows are compared; the old double count (32) must not appear anywhere.

**The other three kinds** are separate problems and are never merged with people waiting: appointments to mark, no-shows to win back, deals gone quiet (the old "stale deals"). Dollars are only ever the counted value of deals gone quiet.

**Headline.** All client accounts: "N clients need you today." (N = accounts with a row), then "$X is at risk." and, if one deal is at least half, "One deal is $Y of that." One account: "N people are waiting for a reply." when anyone is waiting (the thing to do first; the dollars go in the line under it), else "N things need you today.", else "You are all caught up today."

**Charts.** No donut. A client account chart exists only when more than one client account is on screen: one stacked bar per account, the top 8 by things to do, a "+N more" link to the full list. A segment opens that account's records of that kind (count on the mark = rows opened, title "Account, kind"); the name opens that account's records of every kind. With one account there is no chart: a list grouped by kind with counts that open that kind.

**History footnote.** "Comparisons with your usual start after 7 days of history." appears once under the tiles when any comparison lacks history (and a tile with no comparison says nothing).

**Marks on one person.** Done for now, Snooze and Assign on the Reply now list act on one person (row key `<account>|replies|<person>`); the server looks the person up in the same read and refuses a person that is not in the caller's accounts.

## Duplicate contacts (stage DUP, 5 Nov 2026)

Code: `src/lib/analytics/dedupe.ts` (grouping), `src/lib/analytics/dedupe-review.ts` (everything shown), tests `src/lib/__tests__/dedupe-review.test.ts` and `dedupe.test.ts`. No new measurement of the CRM: these numbers are counted from SubSync's own copy of the contacts.

**Duplicate group.** Two or more contacts of ONE client account that share an email (case, spaces, gmail dots and "+tags" ignored) or a phone number (last 10 digits). A group never spans two client accounts and never holds two records that clearly differ (a different email AND a different phone). A chain that ties two different people together is split.

**Groups to fix** (the headline, "Group 3 of 41", the list, the client list, the client count) = groups not decided and not set aside, all counted from the same open list. **Extra contacts to remove** = records in open groups minus one kept record per group. **Share of your list** = extra contacts over all contacts of the accounts in scope ("under 1%" below 1%; nothing shown when there are no extra contacts). Verified against the 5,000-group fixture (`dedupe-review.test.ts`): per-account counts add up to the headline.

**Best record to keep.** Most to lose first: won deals, open deals, a conversation, a phone and an email, tags, recent activity, then the oldest. The reason lists up to three things the pick has that the others lack. **Importance** (order of groups): open deals, paying customers (won deals; payments are not read), Do Not Disturb, recent activity, how sure. **How sure** is three words, not a percentage. **Obvious group**: two or three records with the same email AND phone and no warning. **Tag date**: the day SubSync first saw the tag (since it started watching), never the day it was added.

## Speed to lead, second pass (stage SPEED, 5 Nov 2026)

Code: `src/lib/analytics/speed-v2.ts` (every selection, sentence and ranking, pure), `speed-v2-queries.ts` (the reads), `speed-intel.ts` (`judge`, `summarise`, unchanged definitions). Tests: `src/lib/__tests__/speed-v2.test.ts`, `tests/unit/speed-v2-db.test.ts`, `tests/e2e/speed-v2.spec.ts`. No new measurement of the CRM; the first-reply definitions in "Speed to lead" above still apply.

**Leads waiting** (the headline, "Reply now", "See all N") = new leads of the last 14 days whose first reply from a person is missing and whose reply target has passed (`judge` = "waiting"). They are exactly the people Today counts as "of which N are new leads" (Today, third pass): the same rows, the same exclusions (bulk imports, spam, test, do not contact, repeats), the same window. A person who is also an unanswered conversation is ONE person in Today's total; Speed shows only the lead part. **Never answered** is the part of them that has waited more than 3 days: "42 of them", never added to the waiting number. Tested: Today's `mergeReplies` + `countsOf` on the same fixture gives `newLeads` equal to Speed's waiting count (`speed-v2.test.ts`) and live on the demo for the agency, a business owner and a client's staff (`speed-v2.spec.ts`).

**Answered in time** = of the leads that arrived in the chosen range and are judged (answered, or past their target), the share a person answered inside the target. A percentage shows from 5 judged leads; below that the screen says "n of 5 so far". **Typical first reply** = the middle reply time, from 5 replies. **A change** (this range against another) is the difference in points and only when both ranges hold at least 10 judged leads (`shareChange`).

**One selection.** A figure and the list behind it are one function (`selectLeads`): the count on a number, a bar, a person or a client is the number of rows when it is pressed (checked on fixtures with ties, no-reply leads and the automatic-touch setting, and live for months, weeks, clients and people). Order: longest wait first (answered leads after, newest first); ties by wait, name and id, so a page never shuffles.

**Who is slow.** Clients: ranked by the share answered in time, lowest first, from 5 judged leads; clients with fewer are listed after with "n of 5 leads so far". People: ranked by typical first reply, slowest first, from 3 replies; others "n of 3 replies so far". A client's staff never get the people ranking (the server returns none).

**A client's own reply target** = a whole number of minutes (1 to 1440) typed by a person for one client account (`locations.speed_target_minutes`). Every lead of that account is judged against it (`TouchRow.targetMinutes`); without one the default target in Settings applies. Leads in the source table are still judged against their source's target. UNSURE: the breach alerts and Today's lead-ledger insights still use the default target.

**Who should reply** (a display): for a lead nobody owns, the person in that account with the lowest typical first reply in the range who has at least 3 replies (ties: more replies, then id). Never written to the CRM.

**What this costs you** (an ESTIMATE, always labelled): per client, leads waiting x the client's average deal x its win rate (`followUpEstimate`, the same formula as the Account audit; a win rate needs 20 closed deals; a client without one is left out and counted). Summed over clients.

**Next best step** (the all-clear): reply first; else the slowest client under 50% in time; else many leads with no source; else a typical reply over an hour (if the person may change the target); else nothing.
## Appointments, the work lists (stage APPT, 5 Nov 2026)

Code: `src/lib/analytics/appointment-work.ts` (pure), `appointment-work-queries.ts` (reads), tests `src/lib/__tests__/appointment-work.test.ts`, `tests/unit/appointment-work-db.test.ts`, `tests/e2e/appointments-v2.spec.ts`. No new measurement of the CRM: the three lists reuse `needsOutcome` and `noShowRecovery`, the same functions Today's "appointments to mark" and "no-shows to win back" come from, so the number on Today and the list here are one number (checked by a database test against `appointmentView` and a browser test against Today's items).

**Needs an outcome** = Today's appointments to mark: an active appointment (not cancelled, not invalid) that started more than 3 hours ago, in the last 30 days, still not showed or no-show. Older ones are history, not a job.
**No-shows to recover** = Today's no-shows to win back: no-shows of the last **14 days** whose person has no later active appointment (a cancelled later booking is not a rebooking). The rebuild brief said 7 days; 14 is kept because Today already counts 14 and the two must agree. One row per person (the latest miss).
**Coming up that may not show** (new, appointments only): an active appointment starting in the next 7 days that is **not confirmed yet** (status new), or whose person **missed an earlier appointment** (a no-show before it, in the 90 days SubSync holds). Each row says which, in words. "Remind today" of the old page (not confirmed, within 2 days) is a subset of it.
**The three kinds never share an appointment** (a past appointment cannot be both unmarked and a no-show; an upcoming one is in the future), so **"N appointments need you" is their sum**, and the headline, the list counts, "See all" and the comparison tables all use these rows.
**The headline action.** No-shows first (the money and the clock), then outcomes to mark, then the shaky appointments coming up. All clear when all three are zero.
**Value at stake.** The counted open deals of the people in a list (one per person, deals with no value, no owner or out of play left out: the one "counted deal" rule), shown as "people with $X of open deals". It is not a forecast and not "booked revenue": SubSync does not read what an appointment is worth.
**True show rate** = showed / (showed + no-show) over appointments someone **marked**, in the card's own window (default the last 30 days, compared with the 30 before; the window is always stated). Needs 5 marked outcomes, else "not enough yet". Unmarked appointments are not guessed. **Range**: when at least 3 appointments in the window have no outcome and the two ends are at least 5 points apart, the card says "once marked, the rate will land between X% and Y%": X counts every unmarked one as a no-show, Y as showed. It is arithmetic, not a prediction. A change against the earlier window is claimed only when both periods have 10 marked outcomes; otherwise the card says it is too few to call. (What the CRM's own reports show was not verified.)
**Outcome bars** (the chart behind "Where did they go"): in the window, Showed, No-show, No outcome yet (needs an outcome by the rule above), Cancelled. Invalid is in none. A bar's count is the number of rows its list opens (database and browser tests).
**Comparison.** Per person (who the appointment is assigned to), calendar or client account: To do = that line's rows in the three lists (pressing it opens exactly those rows); show rate over the card's window with the 5-outcome minimum. Most to do first. Client accounts are only offered to an agency with more than one; a client's staff never get them.
**Order of rows** ("who to call first"): No-shows: most open-deal dollars first, then the most recent miss. Needs an outcome: dollars first, then the oldest. Coming up: soonest first, dollars break ties. Other sorts: newest, oldest, client A to Z, name A to Z.
**Server and scale.** One read per installation and set of accounts is cached 30 seconds. The first answer holds five rows per list and short tables (under 40 kB at 150 accounts); a full list is asked a page of 25 (at most 50) at a time with search, sort, client and person filters on the server. A chart bar's list is cut from the appointments of the window, newest 20,000 at most, and says so when cut.
## Account audit, rebuilt (stage AUDIT, 5 Nov 2026)

No new measurement of the CRM. The audit reads the same four lists as Today and Speed to lead, applies one counting rule, and adds a sentence about the money. Code: `src/lib/analytics/audit-v2.ts` (findings, the counting rule, money, good news, share text), `audit-clients.ts` (client list, paging, progress, first run), `src/lib/api/audit-api.ts` (gathers the lists, 45-second kept read), tests `src/lib/__tests__/audit-v2.test.ts`, `tests/unit/audit-v2-db.test.ts`, `tests/e2e/audit-v2.spec.ts`.

**The counting rule (no double counting).** A person or a deal is counted ONCE across the findings. A person is `locationId + contactId` (the same contact id in two client accounts is two people); a row with no contact is never matched and counts for itself. The order of ownership is: (1) deals gone quiet (counted money first; only deals that are not old or test deals claim their person), (2) people waiting for a reply, (3) no-shows not rebooked, (4) appointments with no outcome. A later finding never lists a person an earlier one holds. Each finding's count equals the rows of its list (a list cut at its cap keeps the true total and says so). A person with a quiet deal who is also waiting is listed under the deal. Old or test deals never claim a person. People waiting for a reply are merged by Today's own function (`mergeReplies`): a new lead and an unanswered conversation of one person are one person; "N of them are new leads" is a subset, never added.

**Deals gone quiet** (a fact, counted) = open deals with a value above $0 and an owner, in a stage that is being worked, untouched for the stale days (the Account audit's own query, `staleDealList`), minus **old or test deals**: untouched for more than 3 times the stale days (`JUNK_MULTIPLE`, 90 days by default) or named like a test (`isJunk`, the same rule as Today's junk control). Old or test deals are their own finding ("N old or test deals are still open"), carry no dollars into any sentence, and sort last. One deal that is at least half of the counted money (at least 3 deals; `OUTLIER_SHARE`) is said out loud next to the figure.

**People waiting for a reply** = Today's rule (a lead past the reply target with no person's reply, or a conversation whose last message is the customer's, older than the reply hours, newer than 30 days), minus people already held by a quiet deal. **No-shows not rebooked** = Appointments' rule (last 14 days, no later booking), minus people held by an earlier finding. **Appointments with no outcome** = Appointments' rule (started more than 3 hours ago, last 30 days, not cancelled), minus people held by an earlier finding. A calendar that cannot be read gives no count and no "clean": the page says so, and the grade does not count that check.

**The monthly estimate (labelled Estimate).** For each client account with at least 20 won or lost deals (`MIN_CLOSED_FOR_PRICE`, the same minimum as the win rate): (people waiting for a reply + no-shows not rebooked, each person once) x the account's average deal x its win rate, summed. The range is the same sum with the Wilson margin of each win rate (`rateRange`, the forecast's own range). People in accounts under the minimum are counted but NOT priced, and the sentence says how many; with no priced account the sentence counts things and shows no dollar figure. It is the size of the problem, not money already lost, labelled "a month" because it covers people still waiting from the last 30 days; it is never added to the counted deal figure, on screen or in the share text. A cut list makes it "at least".

**The sentence.** `Your account is leaking about $X a month.` (all accounts: `Your client accounts are leaking about $X a month.`) when there is a priced estimate; `We found N things to fix.` when nothing can be priced; `Nothing needs fixing in your account.` when every check is clean. The counted deal money is said in a separate line ("Counted separately: $Y sits in open deals nobody has touched for a while. It is not part of the estimate.").

**Ranking of findings.** Money first (a finding's own dollars, counted or estimated, each labelled as what it is), then how easy the fix is (quick fix, then needs a call or a decision, then takes a while), then the bigger count, then the name. Old or test deals always sort last. The primary button opens the first finding that is not old or test deals. Ranking is the only place counted and estimated money are compared.

**The grade** (one account only): "N of 4 checks are clean. A check is clean when SubSync finds nothing to fix in it." The four checks are deals gone quiet, people waiting, no-shows, appointments; a check that could not be read is left out of both numbers. An agency has no single grade: it reads "N of M client accounts have nothing to fix."

**What is healthy** (at most four lines; each only when measured on enough cases): a check that found nothing; leads answered inside the reply target at 80% or more over the last 14 days (at least 5 judged leads); show rate at or above the account's own target over the last 30 days (at least 5 appointments with an outcome); and the share of counted open pipeline money that has moved in 30 days when under 25% of it is quiet. Nothing is claimed under the minimum.

**Clients to look at first** (agency, more than one client account on screen). One row per client account that has something to fix, built from the same rows as the findings (so a client's numbers add up to the totals). Order "Most money at risk" = counted quiet-deal dollars + that client's estimate (used only to order the list, never shown as one number), then things to fix, then name; also "Most things to fix" and "Name". Search is on the name; the page size is capped at 50; a page past the end is the last page; the server sends five rows with the page and 10 at a time for "See all". Clean clients are not listed. Verified with a 150-account fixture.

**Progress.** From data SubSync already keeps: (1) deals that stopped moving: the daily check's count now against its oldest trusted count at least 7 days earlier, for accounts with a trusted reading on both days; under 7 days of history it says "Not enough history yet". (2) Leads answered inside the reply target: this week against the week before, each needs 5 judged leads; a difference under 5 points is "about the same". No new history table is written.

**First run.** While any account has not finished its first read, the page says "Reading your client accounts: N of M done" with a progress bar and looks again every 20 seconds; the numbers it shows meanwhile are what is read so far.

**Share link.** Same table, token (192 random bits), 14-day expiry and switch-off as before; now carries the sentence, the figures, the finding titles with what is wrong and the fix, the good news and the grade line, and how each number is counted. Never an account name, a person or a deal. It covers the accounts of the page the person was looking at (the page filter, and the one client if they had opened one). An older link still opens (every new field is optional).

## Clean-up: data quality, match score and matching rules (stage CLEANUP)

- **Finding.** One named problem of one contact, found by `findingsOf` (`src/lib/analytics/quality.ts`). Twelve exist: no working email or phone; no name; email that cannot work (not name@domain.tld); throwaway email (22 listed domains); phone too short (under 7 digits) or too long (over 15); email with a known domain typo; phone not in +digits form; name entirely in capitals or lower case (or odd spacing); shared company mailbox (info@, sales@ and about 30 more); test or made-up record (names such as "test user", or test@example.com, or a .invalid address); placeholder phone (one repeated digit, a counting run); empty contact. A count on screen is the number of contacts with that finding; the list behind it is the same scan, so they cannot differ.
- **Data-quality score (0 to 100).** Needs at least 50 contacts, otherwise "not enough contacts to score". Five parts, each 100 minus 100 times the share of contacts with the problem divided by the share at which the part is fully bad: Can be reached (weight 30, fully bad at 50 percent unreachable), Details that work (20, 20 percent invalid), Tidy formatting (10, 50 percent), No junk or tests (25, 10 percent), No duplicates (15, extra duplicate contacts as a share of all, 10 percent). Score = 100 minus the sum of weight times that part's badness, rounded. Words: 90 and over Excellent, 75 Good, 55 Fair, below Needs work. Portfolio score = the average of the scored clients weighted by contact count. This is NOT the older "Contact data complete" (email, phone, tags) of the Accounts page, which is unchanged.
- **Trend.** Only from stored daily snapshots (`cleanup_quality_snapshots`, one row per client per day). Two snapshots at least 3 days apart are needed; otherwise "Not enough history yet". The change is the newest score minus the oldest in the last 90 days.
- **New likely duplicates (the alert).** The open duplicate groups of a client whose newest contact was added after the previous day's snapshot. 3 or more raise an alert; the first scan of a client never alerts.
- **Match score of a pair (0 to 100).** Same email as typed 94; same address written differently (capitals, dots, +tag) 82; same phone as typed 90; same last 10 digits 80; two digits swapped 60; same name adds 5 to another signal, alone 35; a similar name (nickname, initial, small typo) adds 3, alone 32. Guards: a phone shared by different first names, or a shared company mailbox with different names, is capped at 55 and says why. A group's score is its best pair. Only pairs at or above the client's threshold (Strict 85, Balanced 50, Loose 30, custom 25 to 90) link. Words: 90 and over almost certainly the same person, 75 very likely, below could be.
- **Matching rules.** Strict: email and phone as typed, threshold 85. Balanced: email and phone in any format, the same name as extra proof, threshold 50 (the behaviour before this stage). Loose: also similar names, swapped digits and a name on its own (never for a name shared by more than 8 contacts), threshold 30.
- **Which value wins.** Per field (name, email, phone, owner, source): the record kept, the most recently used, the fullest, or the oldest. Defaults: name fullest, email and phone the record kept, owner the record kept, source the oldest.
## People, call lists and the lead panel (stage PEOPLE, 5 Nov 2026)

Nothing here is a new definition of a metric. The five lists are the lists other pages already use, read through the same function, so a number on a chip and the number on the page it comes from are one thing (tests: `tests/unit/people-v2-db.test.ts`, `tests/e2e/people-v2.spec.ts` "every chip's number is the number of people in its list").

| List | Who is on it | Read through | Count on its chip |
| --- | --- | --- | --- |
| Waiting for a reply | New leads nobody has replied to (Speed to lead's "waiting", the last 14 days; Today's "new leads"), the longest wait first | `speedList` status waiting | Speed's own total. A lead whose contact is not in SubSync's copy yet is kept, from what Speed knew (it shows as "Unnamed contact", as it does on Speed to lead). |
| No-shows to rebook | Missed an appointment in the last 14 days and no later booking that is not cancelled or itself missed (Appointments' "recover") | `workBase` items of kind recover, one row per person | The people with a contact. Bookings with no contact attached are not people: they are counted in "N bookings have no contact attached" under the list, so chip plus that note equals Appointments' number. |
| Follow-ups due | People whose last logged call was "follow up" and whose day has come | the call list `follow_ups_due` | rows (the call list holds at most 400; a full one says so) |
| Hot leads gone quiet | An open deal in play and nothing for 3 days or more, biggest deals first (the call list "hot leads not contacted in 3+ days") | the call list `hot_uncontacted` | rows (same cap of 400) |
| Stale deals | Counted open deals (a value, an owner, in play) with no movement for the account's stale days, biggest first (Today's stale deals) | `staleDealList` | Today's count of DEALS, not people: a person with two stale deals has two rows. The list shows the first 100 deals and says so. Deals with no contact are not rows (nobody to call) and are said in a note. |

The call-list reads keep their existing rules: a contact who asked not to be contacted, one called in the last 12 hours, and one marked wrong number or not interested are not on Hot leads or Follow-ups. Waiting, No-shows and Stale deals do show a do-not-disturb person, marked on the row, with a stop before any call or email.

**Mine.** A person is "mine" when the contact's owner is the person asking, or (for a no-show) the booking is assigned to them. A client's staff start on Mine only when at least one person on the list is assigned to them; otherwise they see everyone and the screen says "Nobody is assigned to you in this list, so it shows everyone" (a queue of zero would look broken). An agency or business owner starts on everyone.

**The sentence at the top.** The most urgent list that has anybody on it, in the order waiting, no-shows, follow-ups, hot, stale, then "Also:" the others in short. When every list is empty: "Nobody needs a call right now."

**Search.** A name or email needs 2 characters; a phone number 3 digits (so "55" does not match every number). It matches part of the name, the email, or the last digits of the phone, inside the caller's accounts, 50 a page, ordered by exact email, then name starts with the words, then most recent activity. The count is exact up to 10,000 and then stops ("10,000+"): a count of two letters in a very large agency would cost more than the page.

**The headline of a person** (first rule that fits): asked not to be contacted (a stop); the customer wrote last and nobody has answered ("Never answered" only when a lead has waited more than 3 days, Speed's rule); a no-show to rebook; a follow-up due; a counted deal with no movement for the stale days; a booking coming up; an open deal; a customer; quiet for 90 days or more; a new contact; otherwise the last activity. It names only what a fact says.

**Tag dates.** The day SubSync first SAW a tag added (`contact_tag_events`, filled since SubSync started watching), never the day it was added in the CRM, which the CRM does not say. The panel says so beside the tags.

**The timeline** merges what SubSync holds: contact added, first reply (the lead ledger), the last message, calls logged in SubSync, appointments and their status changes (`appointment_events`), deal created, moved and won or lost (`deal_events`), tags added and removed; and, read live for one person when the CRM answers, its messages (when, which way, which channel, who sent it; NEVER the words) and calls. NOT VERIFIED LIVE: the shape of the CRM's messages (read defensively, every field optional).

**Since you last looked.** The time the signed-in person last had this person open (kept for them alone), compared with the timeline: the things newer than that, never the "added" row; nothing the first time.
## Clients, rebuilt (stage CLIENTS, 5 Nov 2026)

No new measurement of the CRM. The book reads the same rows as Today, the Account audit and Speed to lead and applies one set of rules. Code: `src/lib/analytics/clients-v2.ts` (every rule), `clients-v2-book.ts` (builds the book from the facts), `clients-v2-queries.ts` (counted deal money, the typed profile), `src/lib/api/clients-book-routes.ts`; tests `src/lib/__tests__/clients-v2.test.ts`, `clients-v2-book.test.ts`, `tests/unit/clients-v2-db.test.ts`, `tests/unit/clients-book-components.test.ts`, `tests/e2e/clients-v2.spec.ts`.

**What is typed and what is read.** Fee, renewal date, industry and the log are typed by the agency; SubSync does not read them from the CRM and says so on screen. Everything else is worked out.

**People waiting, no-shows, quiet deals** = the Account audit's per-client rows (Today's rules; `core.clients`). Never the account's own `unanswered` count, which counts conversations past the reply hours and disagrees with Today (the old Health tab said 17 for a client Today counts as 21).
**Replies in time** = Today's own `withinTargetShare` over the last 14 days of the lead ledger, against the default reply target, claimed only from 5 judged leads (`MIN_REPLY_LEADS`); under 5 there is no claim.

**Health label** (one word per client, with the reason):
- **Not read yet**: SubSync has not finished reading the account. Never judged.
- **New**: added fewer than 14 days ago (`NEW_CLIENT_DAYS`). Not judged on score, activity or a drop; people waiting still count.
- **At risk**: gone quiet, or a health score under 35, or the churn warning is high, or 15 or more people are waiting (`REPLY_DELAY_AT_RISK`).
- **Watch**: health score 35 to 54, or the churn warning is medium, or 5 or more people waiting (`REPLY_DELAY_WATCH`), or fewer than half of the last 14 days' new leads (from 5 judged) got a reply in time, or new contacts are down at least 50% against the client's own normal (`leadFlowDrop`: needs 7 history points and a baseline of 10), or 3 or more no-shows are still waiting.
- **Healthy**: none of the above. 1 to 4 people waiting, 1 or 2 no-shows and 3 or more quiet deals are shown as a line and never change the label.
The row's reason is the most serious reason with its number, "and N more things". A client labelled At risk or Watch always has at least one reason that is not a small note.

**Who needs you** = At risk, Watch, and any client whose renewal is overdue or due within 14 days (shown as "Renewal due" or "Renewal overdue", never "Healthy"). Order: At risk, Watch, renewal due, then the rest; inside a group the renewal that is soonest within 30 days, then the bigger fee (money first), then the lower score, then the name. The headline numbers, the chips and the list are all `selectClients`, so a count equals the clients it opens (tested on 150 clients, every page of every filter).
**Renewals in the next 60 days** = clients with a typed renewal date that is overdue or within 60 days, soonest first; "due within 30 days" in the sentence counts overdue ones too. The countdown is `renewalStatus` (client-intel).
**Money at stake** = the monthly fees the agency typed for the clients labelled At risk. The page says when only some of them have a fee. **Monthly fees** = the sum of typed fees, with how many clients have one.
**Value created** (client page) = the value of deals that started in the last 30 days (counted deals: a value above zero and an owner, and an open deal also in play) divided by the typed monthly fee. A multiple is said only from 3 new deals; under that the dollars are shown and the sentence says there are too few. Labelled an estimate; the formula is one tap away. Counted by one SQL statement (`countedDealMoney`) that a database test holds equal to `dealFigures` over `loadDeals`.
**What changed** = the client's daily record now against the day about 30 days earlier (within a week of that day): health score when it moved 5 points or more; new contacts with `changeBetween` (a percentage only from a base of 10, else the plain difference); open pipeline when it moved 20% or more. Under 28 days of record it says so and claims nothing.
**What to say** = text per reason, to read out or copy. **Reminder days** = 60, 30 and 14 days before the renewal that are still ahead. Both are displays; nothing is sent. The **client summary** (copy or print) leaves out the fee and the team's private notes and names no product.
**Server and scale.** The first answer holds five rows of each list and counts (a few kB at 150 clients); a full list is asked 25 at a time (at most 50) with search, filter and order on the server; the heavy read is the Account audit's own 45-second kept read, shared by account set. Agency only: a business owner and a client's staff get 403 on every Clients address.
## Unanswered messages, second pass (stage UNANS, 5 Nov 2026)

Code: `src/lib/analytics/unanswered-v2.ts` (everything pure: the person, the buckets, the one selection, the rankings, the sentences, the agreement with Today), `unanswered-v2-queries.ts` (the reads), `src/lib/api/unanswered-routes.ts` (`GET /api/app/inbox?part=home|list|ranks`). Tests: `src/lib/__tests__/unanswered-v2.test.ts`, `tests/unit/unanswered-v2-db.test.ts`, `tests/e2e/unanswered-v2.spec.ts`. No new measurement of the CRM: which conversations are waiting is still `waitingState` in `waiting.ts` ("Waiting for a reply" above: the customer wrote last, older than the reply target, newer than 30 days; an internal note or an answered thread is not waiting).

**Person.** The screen counts PEOPLE, not conversations: a person (`account:contact`, or `account:conversation-<id>` for a conversation with no contact on file; the key Today's `mergeReplies` uses) with several waiting conversations is ONE person and one row; the oldest waiting conversation names the wait, the channel and where Reply goes. Conversations are said separately ("n conversations" on the row). A conversation with no contact on file is its own person.

**Waiting buckets** (the one chart). Whole hours since the customer's unanswered message: **Under 4 hours** (only exists when the reply target is below 4 hours; it is left out otherwise), **4 to 24 hours**, **1 to 2 days** (24 to 47), **2 days or more** (48 and up, which includes a week or more; a wait of 7 days or more is drawn quietly, never as an alarm, N13/N15). A bar left out under a reply target cannot hold anyone. The buckets add up to the headline.

**One selection (KF-6).** The number on a bar, a chip, a client or an owner and the rows behind it are one function (`selectPeople`): filters are wait bucket, channel, client, owner (`none`, `me`, a team member id), a search over name, client, channel, email and phone. A chip's count is the length of the selection with that one choice changed, so it is its own list. Order: longest wait first; ties by name, then key, so a page never shuffles. A page is at most 50 rows.

**Rankings.** Clients: people waiting (most first), then the longest wait, then the name. Owners (inside one account only; never for a client's staff): the contact's owner, "No owner" is a row of its own, most waiting first.

**Today agreement (the necessary difference).** Today's "waiting for a reply" = people with a waiting conversation PLUS new leads past their reply target with no person's reply who do NOT have a waiting conversation (a form fill, a lead that only got an automatic message), each person once (`mergeReplies`, "Today, third pass"). This screen = the first group. So **Today = people here + new leads with no waiting conversation**, from Today's own function on the same two lists; the screen says it in one line ("Today shows 94 because it also counts 48 new leads nobody has replied to yet") and the new leads that are among the people here are said as "N of them are new leads", never added. Tested on a fixture (`unanswered-v2.test.ts`, "Today agrees") and live on the demo for the agency, a business owner and a client's staff (`unanswered-v2.spec.ts`). Today caps its source lists (100 conversations); this screen reads up to 20,000 waiting conversations, oldest first, and says so when it is reached, so with more than 100 waiting conversations in a scope Today's count can be an upper bound and this one the exact one.

**Estimate (labelled).** People waiting x the client's average deal x its win rate (a win rate needs 20 closed deals), the one formula of the Account audit and Speed to lead (`followUpEstimate`); it counts people, not conversations. A client without a win rate is left out and counted, never guessed.

**Owner.** The team member the CONTACT is assigned to (the conversation list does not say who a conversation is assigned to). A client's staff can narrow to "Mine" and "No owner" only; a colleague's id is ignored for them on the server.

**Not measured:** message text (never stored); whether a call was answered ("Call, result not known"); unread (a different question: the Unread tile on Today).


- **Turned off** (Workflows): a workflow that was published at the earlier update and is now a draft or paused, noticed in the last 7 days, not changed by SubSync, and still not published. Campaigns count as info only.
- **Same workflow across accounts**: names are matched after lower case, punctuation and "copy" are removed; drift = states differ, version numbers differ (a platform edit counter, so an inference that the contents differ), or it is missing from some client accounts. Needs 2 accounts.
- **Near duplicate**: inside one client account, same normalised name or at least 80% shared words (words of 2 letters or more).
- **Review due**: decision Review and no change to the note for 14 days.

## Data health (module DATA_HEALTH)

- **Contacts counted:** every synced contact of the client account, minus ones marked Ignore in SubSync. Fewer than 50: no score ("not enough data").
- **Score:** 100 minus, for each problem, its weight times min(1, share of contacts with it / its cap). Weights: duplicates 20 (cap 15%), junk 15 (5%), invalid phone 10 (20%), invalid email 10 (10%), no phone 10 (50%), no email 10 (50%), no activity 10 (60%), no owner 5 (60%), no source 5 (50%), no deal and no conversation 5 (60%). Rounded. 85 and up good, 65 and up fair, under 65 poor. Estimate; the formula is in `src/lib/data-health/score.ts`.
- **Duplicate:** an extra copy: every contact in a same-email or same-phone group except the oldest (the existing duplicate finder).
- **Invalid phone:** under 7 or over 15 digits, letters, or one repeated digit or 1234567. **Invalid email:** not name@domain.tld, double dots, or a common typo domain (gmial.com). **No phone / no email:** empty. These never overlap with invalid.
- **Junk:** a first, last or full name like test, asdf, xxx, fake, demo, none, n/a, only digits; email at example.com or a test domain or starting test@; a phone of repeated digits; plus the account's own junk words.
- **No activity:** last activity (or date added) older than the account's days setting (default 180). Skipped for contacts SubSync changed in the last 7 days.
- **No deal and no conversation:** no row in synced deals and none in synced conversations. **No source / no owner:** empty.
- **Quality firewall spike:** per source, bad records (duplicate, junk, invalid phone or email) created in the last 24 hours, at least the account's minimum (default 10), at least 3 times the same source's daily average over the 14 days before (counted as 1 if lower), and at least a third of what that source created.
- **Since you installed:** first stored score, latest score, flags ever raised, flags that stopped being flagged. **Average time to fix:** mean hours between an alert raised and resolved.
- **Benchmark:** median and quartiles of the latest score (last 14 days) of accounts in the same size and industry group, only with at least 10 accounts from at least 3 companies and never from opted out companies.

## Email leads (Today, Growth tab)
Code: `src/lib/analytics/growth.ts` (rules), `growth-records.ts` (the people behind each number). Tests: `src/lib/__tests__/growth.test.ts`, `growth-records.test.ts`, `tests/unit/growth-db.test.ts`.
- **A lead** is ONE unique person with a usable email, counted once per client account (the same person at two clients is one lead for each). People are told apart by a **normalised email**: lower case, trimmed, the `+tag` removed, and for Gmail the dots in the name removed (`googlemail.com` is `gmail.com`). The earliest record of a person is the lead; later records are copies.
- **Left out, with the reason shown:** no email (not a sign up at all); invalid address or test and junk records (same rules as Data health: names like test, asdf; domains like example.com, mailinator.com); the company's own **staff domains** (a setting); **shared mailboxes** such as info@, sales@, support@ (a setting, on by default); **extra copies**.
- **Sign ups** = records with an email added in the last 30 days. **Gross against unique:** sign ups = unique leads + copies + test or junk + staff + shared mailboxes. The five numbers always add up (unit tested).
- **Periods** use each client's own time zone: today since local midnight, this week since Monday, this month since the 1st. **The change** compares with the same stretch of the period before, never with a whole one: today so far with yesterday to the same time, this week so far with last week to the same weekday and time, this month so far with last month to the same day. A percentage needs at least 5 in the earlier period; otherwise it says "Too few to compare". All time has no comparison.
- **Daily chart:** new leads per day for 30 days ending today (today is unfinished and drawn lighter). The line is the 7 day average over complete days only. **The rate badge** is the last 7 complete days against the 7 before; within 5% it says Steady; it needs 14 complete days and at least 5 leads in the earlier week.
- **Goal:** one monthly number per client (SubSync's own table `growth_goals`). Progress is the month so far over the goal. **Forecast** = leads so far divided by days elapsed times days in the month; it needs 7 days of the month, before that it says "Not enough data yet". On track = forecast reaches the goal; Behind otherwise; Reached when met.
- **Sources:** last 30 days by source (Data's usual source label), against the 30 days before. Best = the source that grew most, worst = the one that fell most, each with at least 5 leads in one of the two periods and only when the earlier period had at least 5 leads in all.
- **Sudden drop or spike** (Worth a look and an alert of kind `growth`, dedupe key `growth:<client>:<week|day>:<drop|spike>`): this week so far against the average of the 4 weeks before to the same point (needs 28 days of history, a normal of 10 or more, and 2 days into the week): drop at 40% under, spike at 60% over. Today against the average of the previous 14 days: judged only after 3 pm local time, needs a normal of 3 a day, drop at 60% under, spike at 150% over. Thin data stays quiet.
- **Who edits:** goals and the two settings are set by the company that looks after the clients; a business owner and a client's staff read only. A client's staff see their own client only and never the list of internal domains.

## Today urgency words
"Urgent" is rare on purpose. A reply row is Urgent only when its oldest wait is **4 hours or more**, or **10 or more** people wait; otherwise it is "Soon". Quiet deals are Urgent only at **25 or more**; no-shows are "Soon"; appointments with no outcome are "Soon" at 5 or more, else "Can wait". Never answered alone no longer makes a row urgent.


## Range semantics of the report tabs (5 Nov 2026)
Dates are whole local days, first and last included, in each client's own time zone for lead counts. The comparison is the same number of days directly before the chosen ones ("vs the 30 days before"); under 5 leads before, it says "Too few to compare". Today, This week, This month and All time are always calendar stretches, and the monthly goal is always this month. Sources compare the chosen dates against the days before them. Proof covers the last 7 days and Sources and Coverage the last 14 days of leads SubSync holds, so those tabs filter by client only.

## Pipeline board (stage MOAT)
- **Counted once:** each open deal id appears in exactly one stage and is added to the headline once; only deals the existing rules count (value above zero, an owner, pipeline in use, not a closed-out stage).
- **Stuck (per stage):** time in the CURRENT stage (stage change, else created) above that stage's limit AND no activity for 7 days (or unknown). Limit = 2 x the median days open deals have sat in that stage, clamped 5 to 30; stages with fewer than 5 deals use the account's stale-days setting.
- **No next step:** no upcoming appointment for the deal's contact (not cancelled, no-show or invalid) AND no activity for 7 days.
- **Forecast shown** only with 20 or more closed deals; **trend line** only with 14 or more days and a change of at least 10 percent of its high. Tests: src/lib/__tests__/pipeline-board.test.ts.

## Missed calls nobody called back (stage MISSED, 7 Nov 2026)

One definition, one SQL source (`src/lib/analytics/missed-calls.ts`), read by Speed > Coverage ("Missed calls nobody called back") and Speed > Call mode (first list, "Missed calls, no callback"). Before this, Coverage counted calls with no callback or text in 15 minutes from the newest 60,000 events of 30 days, and Call mode counted people with no outbound touch at all from the last 7 days (400 at most), so the two could disagree (Coverage showed 1, Call mode showed none).

- **Missed call**: a recorded inbound call that was not answered (touch event kind `missed_call`; status no answer, busy, voicemail, missed, cancelled).
- **Waiting caller** (the person Call mode lists, and the count Coverage shows): one row per account + contact. Their latest missed call is inside the date range and the accounts the person may read, and after it there is no outbound touch of any kind (a person's call or message, or an automatic text; a send that failed does not count) and no call result logged in Call mode.
- **Date range**: the Speed page's range (default the last 30 days). Account filter and the agency, client and business roles narrow it inside the accounts the router allowed; a client's staff only see callers assigned to them, decided inside the SQL so counts and pages are theirs too. Accounts marked ignored are left out.
- **Dollars**: counted open deals of those callers (value above zero, an owner, a stage in play: the usual counted-deal rule). Ranking: dollars first, then the newest missed call.
- **Recovered within 15 minutes** (Coverage): missed CALLS (not people) followed by any outbound touch (not failed) within 900 seconds. **Texted back within 60 seconds**: missed calls followed by a text or WhatsApp within 60 seconds. Shown only with 5 or more missed calls.
- **Count equals rows**: Call mode's clickable count is the full number of waiting callers; its list is the same people one server page at a time (20, 50 or 100). Coverage shows the same count and the first 50 of the same ranked list.
- Coverage's other event cards (best time to reach, channel mix, who could cover after hours) are SQL aggregates over the same date range, with no row cap (`coverage-events-sql.ts`). The pure versions in `speed-v4.ts` stay as the written rule and are unit tested.
- Other Call mode lists (new leads not reached, hot leads, no-show saver, proposals, follow-ups, saved filters, redial) are read one page at a time with the true total (`count(*) over ()`), and a client's staff filter is inside the SQL.
- Scale: indexes in `20261118090000_missed_calls_scale.sql` (additive, idempotent, NOT applied by the build). Tested in `tests/unit/missed-calls-db.test.ts` (golden dataset always; the 100,000-missed-call fixture with `MISSED_SCALE=1`, which refuses to run above 380 MB of the shared 500 MB database).

## Unanswered, round 3: moat and proof (stage UD, 10 Nov 2026)
Code: `src/lib/analytics/moat-core.ts` (rules), `moat-queries.ts` (SQL aggregates), `moat-record.ts` (raw record), `benchmarks-audited.ts`, `reply-proof.ts`. Tests: `src/lib/__tests__/moat-core.test.ts`, `moat-guards.test.ts`, `tests/unit/moat-db.test.ts`. Every flag below defaults off.
- **Raw record (FACT, D1).** `moat_events`, append-only (an update raises an error), one row per fact, unique by `event_key` so a second sweep writes nothing. Kinds: lead created (with channel and the reply target at that time), first person touch (who, owner then), first automatic touch, owner change, alert fired, alert outcome, appointment booked / showed / no-show, deal won / lost (value and date), reply target set, alert feedback. Metadata only, never message text. Derived hourly from the tables SubSync already keeps, so a missed run is caught up (72 hours back).
- **Kind of business.** Optional tag per client account (`account_profiles.vertical`): med spa, solar, home services, real estate, legal, coaching, other.
- **Receipt (D2).** A month is [first day, next month's first day) UTC. Alerts = `breach24` alerts raised; got a reply = resolved with a person's reply observed; still waiting = open; booked after = got a reply and the contact has a non-cancelled appointment created after the alert; late leads = new leads (lead rules) whose first person reply took longer than the account's reply target, or never came. A count opens exactly those people (`part=receipt-people`).
- **Dollars at risk / kept (ESTIMATE).** `leads x booking rate x close rate x average deal value x 0.2 to 0.3`, shown as low to high. Leads = alerted leads that got a reply ("kept") or late leads ("at risk"). Booking rate = leads of the last 90 days that booked / those leads. Close rate = won / (won + lost) deals of the last 365 days. Average deal value = mean value of won deals above $0. Shown only with at least 100 leads (90 days), 30 closed deals (365 days) and a deal value; otherwise "Not enough data yet" with what is missing. The agency total adds only accounts that have an estimate.
- **Speed-to-outcome curve (D3).** Bands by first person reply: under 5 min, 5 to 60 min, 1 to 24 h, over 24 h, never answered. Rate = leads with a non-cancelled appointment created after the lead arrived / leads in the band. Leads from the last N days (default 90), excluding the last day and leads the rules set aside. A band under 20 leads shows no rate; the whole chart under 100 leads says how many more are needed.
- **Scorecards (D4).** Per person who made the first reply in the last N days (7 to 90): typical (median) and slowest-tenth (P90) reply time, unanswered share of leads owned by that person, after-hours coverage (of after-hours leads the person replied to, the share answered within 60 minutes; after hours = weekend or outside the company's opening hours in the account's time zone), week on week trend of the median (needs 5 replies in each week; under 10% change is "about the same"). A person under 5 replies shows no speeds. An agency sees everyone in scope; a client's administrator sees that account's team; a client's staff see only themselves.
- **Peer benchmark (D5).** Median and quarter points of per-account median reply time (90 days, accounts with at least 30 answered leads), for one kind of business, over agencies that switched benchmarking on. Shown only with at least 10 accounts from at least 5 agencies and not when one agency supplies over 40%; the message never says which rule failed. One audited function reads across agencies. See `docs/features/UNANSWERED3_BENCHMARKS_PRIVACY.md`.
- **Wait clocks (E1).** Real wait = now minus the customer's last message. Working-hours wait = Monday to Friday inside the company's opening hours in the account's time zone. The screen says which clock the alerts use.
- **Reply target (E2).** The per-account target Speed already uses (`locations.speed_target_minutes`), set from the new control; a change is recorded as a `reply_target_set` fact.
- **Weekly proof (E3).** Each Monday 08:00 to 09:59 UTC, one notification per client account to its account administrator with last week's receipt. Email is dry-run only until the live send switch is on. Morning line: "Last week: N of M alerted leads got a reply, typically within X."
- **Channel mix (E4).** Share of new leads by the channel of their first message. Fastest channel = lowest median first reply among channels with at least 10 replied leads, only when two channels qualify.
- **Verified reply-time page (D6).** Last 30 days measured from the account's own records, at least 20 leads. The stored snapshot carries a SHA-256 of its content and a link to the previous page's hash for the installation (plus an HMAC when `PROOF_SIGNING_SECRET` is set); the page says whether it is unchanged. Expires after 30 days, can be switched off, never indexed, no contact or message on it, no promise wording.
## Unanswered actions (round 3, slice B, flags inbox_open_lead, inbox_claim, inbox_assign, inbox_note, inbox_outcome_ui, inbox_snooze, inbox_hide_noise, inbox_clear_junk)
- Snoozed (set aside): a waiting conversation with an unreleased SubSync snooze whose end time is in the future. It is left out of the waiting list and every count and ranking built from it, and shown as "N set aside, show". Longest snooze 30 days. A snooze ending is automatic (no job): the query compares the end time with now. Lives only in SubSync (`unanswered_snoozes`); no CRM write; no message text. "Tomorrow morning" is the next 9:00 in the account's time zone that is at least 6 hours away (24 hours when the zone is unknown).
- Hidden by default (one reason each, in this order, so counts add up): set aside; not a lead (the person's newest recorded outcome is "not a lead"; a later outcome brings them back); your own team or spam (a tag among spam, bot, internal, staff, team, employee, test, do-not-reply, or the contact's email or phone equals the client account's own email or phone); automatic messages (the newest inbound message, within a minute of the conversation's last message, is flagged automated in `touch_events`, from the message's own source and direction, never its text). Each of the last three can be switched off by an administrator (`unanswered_hide_settings`); a snooze cannot. "N hidden" counts waiting people (customer wrote last, inside the window, past the reply target) that match a reason, in SQL. Rule twins: `hideReason` (unanswered-actions.ts, unit-tested) and `reasonSql` (unanswered-actions-queries.ts, database-tested).
- Protected from clearing: do not disturb, an open deal, a customer (a won deal; payments are not readable, so a won deal is the nearest proof), an upcoming appointment (not cancelled), and any conversation whose contact SubSync does not have. Clearing deletes the conversation only, never the contact, at most 10 at a time, with the typed count ("delete N"), and cannot be undone. Cleared people are marked not a lead.
- Owner changes (claim, assign): only someone on that one account's team (`location_users`), at most 20 at a time, one client account per batch; a claim only on an ownerless lead. The owner before is stored (`unanswered_actions`) so a batch can be put back. Our own writes (owner changes, notes) are never replies: they add no message, and a note's id goes in the shared write log (`crm_writes`) so the sync and the webhook echo skip it (principle 14).
- Unit tests: src/lib/__tests__/unanswered-actions.test.ts; database tests: tests/unit/unanswered-actions-db.test.ts (skip until the migration is applied).


## Unanswered messages, round 3 (slices A and C: lists, filters, search)

- **Waiting for us (list).** One row per person (location plus contact, or the conversation when there is no contact). The person's oldest conversation whose last message is the customer's, newer than 30 days and older than the account's reply target, names the wait. The list, its total and every chip are computed by the database (`unanswered-sql.ts`); a chip's number is the same query with that one choice changed, so a number equals the rows behind it. Same rule as `waiting.ts`, so the total equals the home figure (tested in `tests/unit/unanswered-sql-db.test.ts`).
- **Waiting on them.** Same grouping, but the last message is ours (outbound, internal notes excluded), newer than 30 days and older than the chosen quiet time (4 hours, 1 day or 3 days; default 1 day). Automatic messages count as ours because the platform does not say which they were.
- **Mine and unowned.** Assigned to the signed-in user, or assigned to nobody.
- **Deal worth.** At least the chosen amount in open deals (monetary value, status open) for that contact.
- **Find anyone.** People with a conversation, matched by name, email, client name (all words must match) or phone digits (3 or more digits), in the accounts the caller may read; one row per person with the state of their latest conversation. Paged 20, 50 or 100.
