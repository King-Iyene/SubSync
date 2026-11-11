# Overview R1: should it exist? (11 Nov 2026)
Labels as in TODAY_R1.md.

## What exists
overview.tsx (110 lines) and exec-summary.tsx (134): KPI tiles (open pipeline, revenue at risk, churn badge, stacked bar) from the first overnight build. VERIFIED (read). CLAUDE.md section 13A already found $2.4M on three tiles and $1.2M on two; the Audit and Pipeline rebuilds fixed their own screens, not this one.

## Verdict: merge into Today, retire the separate screen
- Today already carries Growth, Lead flow, Proof and Forecast. Overview adds no decision a person cannot take from Today, Pipeline or Clients. CLAUDE.md principle 1: no answer to "what do they do next", do not build it.
- Keep a "Numbers" tab in Today with at most 6 tiles, each read from a finished module's own rollup (Speed median, unanswered, show rate, open deals, stale deals, accounts needing attention), each clickable with count equal to rows.
- Keep the route #overview as a redirect to Today > Numbers so old links, emails and notifications work.

## Platform and competitors
Same as TODAY_R1.md. The platform dashboard and AgencyAnalytics already give KPI tiles; a tile page is the commodity layer (CLAUDE.md section 8 defers a report builder). We win on ranked action and history, not on tiles.

## Pain and errors
- Pain: tiles that disagree between screens destroy trust faster than a missing tile (INFERENCE; docs/BUYER_AND_UX_REVIEW.md).
- Errors: stale-value duplicates; win rate on too few closed deals (rule: minimum 20 closed, else "not enough data"); unlabelled estimates; test accounts counted.
- NOT available: revenue collected, ad spend.

## Moat
Trend lines on Numbers come from our daily snapshots (account_metrics_daily), labelled "history starts <date>". Nothing new to record.

## Customer's-eye check
Would an owner pay for Overview alone? No. Would they miss it? Only the numbers, which live on in Today > Numbers. Do it last and small.
