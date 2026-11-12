# QA round 3 (12 Nov 2026): paying-customer walk through the live app

Tested in the live app inside the CRM (KD Squares Test, all 3 client accounts, last 30 days), dark mode, desktop and a 375 px phone width. Read-only: no test data was created (CRM-side data entry not done in this round) and nothing was sent.
Status: **fixed** (in the PR for this round), **not fixed** (logged), **King** (only King can do it).

## Fixed in this round

| Module | Issue | Status |
|---|---|---|
| Speed to lead, Pace | "Who should I reply to first?" said "See all 13 waiting" but the list it opened said "Waiting for a first reply: 5 leads". The number counted every lead with no person touch; the list shows leads past their target with no reply. The number now counts the same people as the list. | fixed |
| Speed to lead, Race | "Typical first reply 9 sec" was drawn from ONE reply while 13 of 14 leads never got one (the Numbers tab correctly said "needs 5 answered leads"). The typical reply now needs 5 answered leads, else "n/a". | fixed |
| Appointments, Needs outcome | Today said "23 appointments with no outcome" (all of them 51 to 83 days old); Appointments, last 30 days, said "Every past appointment has an outcome. Your show rate is as true as it can be." Both were right for their dates, but the second claim was false. It now says "No appointment in these dates is missing an outcome" with a "Look back 90 days" button. | fixed |
| Appointments | A grey note "This screen is showing 2026-10-13 to 2026-11-12 (its own date choice), not the dates in the bar above" appeared with no override (the screen counted its first day a few hours earlier than the bar). It now shows only when the choice really differs. | fixed |
| Payments | With the payments permission missing, the screen said "No payment needs action right now" above four zero tiles. Zeros from a read that never happened read as good news. It now says SubSync cannot see payments yet. | fixed |
| Every module, phone width | The date bar was sticky and took about a third of a 375 px screen. It is sticky from tablet width up only. | fixed |

## Checked and fine

- Today: brief, ranked list, Open buttons, Recover (24 rows equal "All 24"), Proof, Numbers (booking funnel and tiles). Loads in under 5 s after the first call.
- Speed to lead: Race, Pace (journey table, ready list, side panel list), Call mode (honest "Start is off because nobody can be called right now").
- Clients (tile "Appointments with no outcome 23" opens exactly 23 rows), Payments (honest permission note), Find a lead (5 new leads equals the Speed list), Account audit, Clean-up, Overview, Team, Pipeline, Settings (Connections), Meeting notes (inbox, plain words), Workflows (honest "cannot read workflows yet").
- No "GoHighLevel", "HighLevel", "GHL" or "sub-account" words seen on any screen visited.
- 375 px: bottom bar works, settings sections fold, nothing overflows except the date presets row (see below).

## Not fixed (logged)

| Module | Issue | Why |
|---|---|---|
| Numbers vs Speed to lead | Numbers and Clients say 20 new leads in 30 days; Speed to lead Pace says 14 arrived. Different lead sets (Speed leaves out some leads). Needs a written definition and one source. | needs a metrics decision |
| Today vs Speed | Today "21 people waited over a day", Clients "24 leads waiting", Speed "5 never had a first reply", Find a lead "5": four counts for related things (conversations versus first replies). Each is labelled, but a customer will ask which is true. | needs a naming pass |
| Speed to lead | The first click on a tab right after closing a side panel with Escape did nothing (needed a second click). Seen once; not reproduced in code. | CHECK |
| Date bar, 375 px | The presets row (7 days, 30 days, 90 days, Custom) scrolls sideways inside its box: "Custom" is cut off until you swipe. | cosmetic |
| Workflows, Payments | The permission note shows raw permission names (workflows.readonly, payment/transactions.readonly). Plain words would be "reconnect to allow reading workflows". | wording pass |
| Today | "46 team members have gone quiet" on a test account; likely correct (inactive CRM users) but loud. | CHECK with King |
| Slow first load | Speed to lead, Appointments, Pace took 4 to 6 s to show real content after the click (skeleton first). Over the 3 s rule. | needs a profiling pass (cache the first read) |
| Test data | Not created: leads, bookings, a deal, a call-now tag. The CRM pane is small and every step needs screenshots. | King or the next round |

## King

- Reconnect the test account with the workflow and payments permissions (docs/RELEASE_1_1_0.md) so Workflows and Payments show data.
