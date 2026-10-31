# The moat: what a competitor cannot copy quickly

From the competitive research and Master Brief v3. The competitor (All The Apps) wins on breadth, white-label
and human onboarding. It does not track sales performance. A copy of our screens would take them weeks; the things
below take them months or cannot be bought at all. Status is as of 31 Oct 2026 and is honest about what is not
there yet.

## 1. Our own history (cannot be recreated later)

The platform keeps almost no history: no clean record of when a deal moved stage, when an appointment's status
changed, or how long a lead waited. SubSync records these itself from the day an account is connected.

| Record | What it enables | Status |
| --- | --- | --- |
| `deal_events` (created, stage change, status change) | deal velocity, time spent in each stage, per-stage stale thresholds | Recording since 30 Oct. **0 events on the real accounts so far**: the test data has not changed. It grows with real activity |
| `appointment_events` (created, status, moved) | true show-rate history, reschedule patterns, who marks outcomes | Recording code live; **0 events** until the calendar permission is approved |
| `lead_touches` (when a lead began, when a person first replied, who) | speed-to-lead trends, per-person response history | Recording code live; **0 rows** until the messages permission is approved |
| Daily account snapshots (`account_metrics_daily`) | each account compared with its own normal, anomaly and churn alerts | Recording, running on every sync |

Rule: every new thing we can measure gets an event row before it gets a screen, because a screen can be built
later but history cannot.

## 2. Anomaly detection against each account's own normal

"Lead volume fell 60% against this account's usual week" needs weeks of per-account baseline. A newcomer starts
at zero. Built: z-score alerts on pipeline, new contacts and score, lead-flow drop alert, speed-to-lead breach alert.
Next: apply the same own-normal comparison to show rate and first-reply time.

## 3. Cross-agency benchmarks (a network effect, the strongest long-term moat)

"Your med-spa clients show up 58% of the time; the median across SubSync med spas is 71%." Nobody can offer that
without many installs in one niche, and it improves with every agency that joins. Not built. Design rules before any
code: opt-in; only aggregates; never show a figure from fewer than 10 accounts or 3 agencies; no account or agency is
identifiable; industry comes from what agencies type on the Clients page (so that screen matters even though it is
switched off). Needs real installs first.

## 4. The niche, done deeply

Appointment-driven agencies (home services, med spas, solar, real estate, coaches). Industry playbooks with
reply targets per industry already exist (switched off). Deepening them, per-industry show-rate and speed targets and
the language used on screen, is cheap and hard to copy for a generalist.

## 5. Trust

21 permissions against the competitor's 165, every change behind a preview, typed confirmation and undo, nothing
that sends messages, data deleted on uninstall, two-agency isolation tested on every run. Cheap to say, expensive
to fake, and it matters to the agencies that resell this under their own name.

## What to build next for the moat, in order

1. Get real data flowing (the 2.0.0 approval). Without it sections 1 and 2 stay empty on the real accounts.
2. Stage dwell time and deal velocity from `deal_events`, which also delivers the per-stage "stale" rule the brief asks for.
3. Setter and closer leaderboard across accounts (replies, first-reply time, appointments held, deals won), from the history above.
4. Benchmarks (section 3), after a first handful of agencies.
5. Email delivery of the weekly digest, so the product reaches people who do not open the app.
