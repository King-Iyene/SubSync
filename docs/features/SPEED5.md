# Speed to lead, fifth pass (stage SPEED5, branch `stage/speed5`)

Built from `docs/research/SPEED_COMPETITORS.md` (TOP picks and moat ideas) and the data-quality tools (DupeCatcher, Clientell, Insycle, Dedupely). Pure rules: `src/lib/analytics/speed5.ts`. Reads: `speed5-queries.ts`. Screen pieces: `src/app/app/views/speed5-ui.tsx`.

## What it does
| Piece | Where | Rule |
|---|---|---|
| Bookings by first-reply time (the money chart) | Pace | Leads 90 days ago to yesterday; booked = a non-cancelled appointment for the person made after the lead arrived, within 14 days. Six groups (5 min, 15 min, 1 h, 4 h, over 4 h, no reply). A group needs 10 leads for a rate, the chart 30, the "N times as often" line 10 fast and 10 slow (over 1 h). |
| Breach alerts use each account's own target | alerts, Today | `perAccountBreaches` counts per account against `locations.speed_target_minutes`; `derive.ts` names that target. Today's ledger (coming breaches, since-you-left, within-target share, streak) uses `targetOf`. Business hours: the lead clock (`clock_start`) already skips closed hours in each account's own time zone when that setting is on; hours are the company's setting, not stored per account. |
| Escalation ladder | Rules; alerts | Past the account's target: the owner. `nextAfterMin` later: the next person (round robin). `managerAfterMin` later: a manager (alert turns critical). Company-wide, defaults 15 and 45, stored in `settings.speed_escalation`. The bell/Slack/email follow the existing alert switches (dry run while those are off); Rules shows "what the alert would say now" and each waiting lead's step. Not for a client's staff (it names people). |
| Round-robin suggestion | Race | For a lead nobody owns: the person who replied in the last 30 days and holds the fewest waiting leads (ties: fewest recent, then smaller id). One tap opens the existing preview-then-confirm gateway (dry run while writes are off). |
| Money-at-risk meter | Race | Counted = open deals of the people past target (a fact). Estimate = waiting leads x (fast booking rate minus slow rate) x the accounts' average deal, only when the booking gap is measured; never negative. |
| Our response speed report | Rules | Per account: leads, typical first reply, answered in time, replied within 5 minutes, each against last month; header, footer, one account per printed page, no product name. |
| Duplicate guard | Race rows and the reply panel note | The Clean-up match engine (`scoreEvidence`) on the same account only; a "sure" or "likely" older record shows "Possible duplicate of X. Reply to the older record." Read only. Heavy cleaning stays in Clean-up (link). |
| Repeat enquirer | Race | A sure or likely older record of the same person: chip, and it counts ten minutes closer to its deadline in the Race order. |
| Lead validity | quality score | Throwaway email -20, shared mailbox -10, made-up phone -15; malformed email or short phone are listed but cost nothing. Quiet: never hides a lead. |
| New-lead duplicate alert | bell | `leaddup:<account>` (kind duplicates, info) when 2 or more new leads of the last 24 hours look like existing people. Rebuilt every refresh. |

## Data
One additive migration, `20261111090000_speed_escalation.sql` (`settings.speed_escalation jsonb`), NOT applied. Until it runs the default ladder applies and saving answers "needs the latest database update". No new table. Every read is bound to the accounts the router allowed.

## Not built
Per-account business hours (company setting only), cross-account round robin, the "who covers who" idea, Slack as a separate ladder channel, an automatic reassign on breach (assignment stays one tap and confirmed).
