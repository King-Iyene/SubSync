# Today (front page) R1: landscape, pain, errors, moat (11 Nov 2026)
Labels: VERIFIED = read in a source with link or in our code/docs; INFERENCE = reasoning or vendor/blog claim; UNVERIFIED = searched, not found. Builds on docs/research/TODAY_COMPETITORS.md (3 Nov) and docs/TODAY_REVIEW.md; not repeated.

## What exists (our code)
- src/app/app/views/today*.tsx plus src/lib/analytics/today-*.ts, about 3.5k lines: tabs for Growth, Lead flow, Clients coming and going, Proof, Forecast, Sources, Coverage, a shared filter bar, an email list. VERIFIED (read).
- Thin: it is a report hub, not a morning routine. docs/TODAY_REVIEW.md found one fact shown six times and numbers that disagree. The "what to do first" must now come from the finished modules (Speed, Appointments, Pipeline, Clients, Team), not from its own older queries. Overview (overview.tsx 110 lines, exec-summary.tsx 134) repeats Today with stale tiles. VERIFIED (read).

## What the platform gives and lacks
- Gives (VERIFIED in existing research): per-account dashboards and SLA widgets; an agency roll-up of activity counts (appointments created, contacts created, messages). Agency View controls need a higher plan (help.gohighlevel.com article 48001224166, per TODAY_COMPETITORS.md).
- Lacks: one ranked "do this first" across all client accounts, any record of what was fixed, any daily message about it. Ideas-board asks ("Master Dashboard", "Agency Roll Up Reporting") exist; vote counts UNVERIFIED (board not readable).
- NOT available: user logins and session activity, ad spend per lead, revenue actually collected per client (payments scope not granted), call audio content.

## Competitors
| Tool | Does | Price (label) |
|---|---|---|
| AgencyAnalytics | Client dashboards, goals, alerts, anomaly detection, AI insights, white-label | about $25 per client per month, $20 annual (INFERENCE: dashthis.com/alternatives/agency-analytics) |
| Databox | Metric dashboards, notice when a metric moves wrongly | $159 to $399 per month platform tier (INFERENCE: capterra.com/p/154024/Databox/pricing) |
| All The Apps | Own-platform "Measure" screens | $129 to $499 flat (VERIFIED in CLAUDE.md) |
| Hot Prospector | Speed-to-lead score and dialer, per account | INFERENCE (TODAY_COMPETITORS.md) |
| GoCSM | Health from logins, usage, billing | INFERENCE |
None found that opens with ranked lead-handling work across all accounts plus proof. Marketplace not browsable from here: King checks before launch.

## Customer pain (INFERENCE: consultant and vendor blogs; forums unreadable)
1. Owners do an exception scan each morning; charts are not read ("3 to 5 alerts per account so they stay meaningful").
2. Agencies must justify the retainer: "what are we paying for?" Proof beats dashboards.
3. Automations stop silently (consultevo.com and 2026 support-complaint articles), so the page must surface failures, not assume health.
4. Monthly reports are manual copy-paste ("manual, error-prone aggregation", consultevo.com).

## Biggest sources of error
- Same deal or person counted in several tiles (fix: one counting rule, reuse Audit's).
- Dollar tiles from test or junk deals; "stale" defined globally (use Pipeline's per-stage rule).
- "Fixed" claims we cannot prove: count a fix only when the next sync shows it resolved.
- Time zones: "today" is the client account's day, not the server's.
- Echo from our own writes inflating activity (CLAUDE.md rule 14).

## Moat from our history
- The event store lets Today say "this week we caught 31 problems, 24 are fixed, median fix time 3 h". The platform keeps no such history. A newcomer starts at zero; label "history starts <date>".
- A daily opened-vs-resolved ledger per account becomes the receipt that justifies the agency's fee and the reason to open the app daily.

## What would make an owner pay (money first)
1. One button: "Start with the 14 people waiting" opening the exact rows. 2. Proof forwardable to a client in 10 seconds. 3. A 7 am email that is the product for owners who never log in. Without these Today is a report, not a habit.

## Customer's-eye check
Would an agency owner pay? Yes if the first screen is a short ranked list, one button and a weekly receipt; no if it shows twelve tiles. Confusing today: tab names (Coverage, Sources, Growth) that mean nothing to a setter; duplicated numbers. Move those behind a "Numbers" tab.
