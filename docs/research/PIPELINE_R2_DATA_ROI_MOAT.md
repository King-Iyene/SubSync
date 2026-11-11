# Pipeline and deals: benchmarks, formulas, moat (R2, 2026-11-10)

Labels: VERIFIED = a source states it (vendor blog counts as "stated", not proven). INFERENCE = our reasoning. UNVERIFIED = not found or conflicting. Only web-search summaries were read; no primary reports were opened. Treat every benchmark as directional.

## 1. Benchmarks (all vendor-sourced; definitions differ)

| Vertical | Finding | Source | Label / reliability |
|---|---|---|---|
| Home services | Sales cycle about 30 d roofing, 60 d windows/doors and remodel, 90 d HVAC, 180 d kitchen/bath; B2C cost per lead $144 (2026) | https://webfx.com/blog/home-services/home-services-marketing-benchmarks/ | VERIFIED (stated), low: agency blog, no sample given |
| Home improvement | In-home close rate 15-20% typical, 25-35% top dealers (2026) | https://www.threekit.com/blog/door-window-company-marketing-benchmark-2026 | VERIFIED (stated), low |
| Solar | 3-5% of all leads, 15-25% of qualified leads; cycle 30-45 d; close rate 22-38% per consultation run (Rework) | https://www.surgepv.com/blog/solar-close-rate ; https://resources.rework.com/libraries/solar-home-energy-growth/solar-sales-kpis-metrics | VERIFIED (stated), low: software vendors, definitions differ |
| Real estate | Win rate 16%, cycle 147 d (Digital Bloom); 20-25% and 105 d (others) | https://thedigitalbloom.com/learn/pipeline-performance-benchmarks-2025/ ; https://prospeo.io/s/sales-cycle-length | Conflicting, low |
| Legal | "14% inquiry to signed retainer, top firms 40-50%" attributed to Clio 2025; not found in Clio's own report | https://www.legalsoft.com/blog/law-firm-client-intake-statistics | UNVERIFIED |
| Med spa | Nothing usable found | n/a | UNVERIFIED |
| Coaching | Nothing usable found | n/a | UNVERIFIED |
| Cross-industry | B2B win rate about 21%; deals closing in under 50 d win 47% vs 20% or less later | https://outreach.ai/resources/blog/sales-win-rate | VERIFIED (stated), low |

Stage dwell time and stale-deal share: no credible public benchmark found for any vertical. INFERENCE: this gap is the moat. Do not show any outside benchmark as a "target"; show only the account's own history until a peer cohort exists.

## 2. Weighted pipeline and revenue at risk (INFERENCE, standard method per https://www.sifthub.io/glossary/weighted-pipeline)

Eligible deal = open, value > 0, has owner, not tagged test, created by a real contact, not flagged outlier.
- Weighted pipeline = sum(value x P(stage)), where P(stage) = share of deals that ever reached that stage and later closed won, from our own history.
- Shrinkage (INFERENCE, standard empirical Bayes): P = (wins + k x prior) / (n + k), k = 10, prior = account's overall win rate, else a vertical default shown as "assumed". Show a range using the Wilson 80% interval, not one number.
- Minimum data: stage P only if n >= 20 deals passed the stage in 12 months; win rate only if >= 15 closed deals; otherwise display "not enough data". One source suggests about 50 recent deals (https://blog.abmatic.ai/sales-pipeline-forecasting-guide, stated, low).
- Outliers: cap value at the account's 95th percentile for forecast totals (list the capped deals separately). Exclude $0 and ownerless deals from dollar tiles but count them in a "data health" tile. Exclude test deals by name/tag rules plus a user toggle.
- Revenue at risk = weighted value of eligible deals past their stage stale limit (below), with low/high from the Wilson range. Never reuse the same number on two tiles.

## 3. Stale, velocity, win/loss, small-sample forecasting (INFERENCE unless stated)

- Stale per stage: no stage change, note, message or appointment for more than the 75th percentile of that stage's historical dwell time (floor 3 d, cap 60 d). Until 20 completed stays exist, use the stage-order default: 2x the median of the pipeline's closed-won cycle divided by stage count, labelled "estimate".
- Velocity = (open eligible deals x win rate x average won value) / median won cycle days (standard formula). Dwell = median and P90 days per stage from our event store.
- Win/loss: win rate by source, owner and value band; lost-reason ranking only with >= 10 lost deals; flag "no reason recorded" as its own bucket (this is usually the largest).
- Forecast accuracy with small samples: report coverage (share of closed deals that landed inside the stated range) and bias (forecast / actual) per month; recalibrate quarterly. Do not use ML below roughly 100 closed deals. Weighted-pipeline weakness (every deal in a stage treated alike): https://forecastio.ai/blog/weighted-pipeline-vs-ai-sales-forecasting (VERIFIED, stated).

## 4. Moat from our own history

Record now, append-only, never edited (INFERENCE: GHL gives current state, not clean history; CHECK what the opportunity webhooks and search return before relying on them):
- Stage change: old stage, new stage, timestamp, actor (user or automation, if given), pipeline.
- Status change (open/won/lost/abandoned), lost reason (CHECK field name; search results showed no `lostReasonId` evidence, https://marketplace.gohighlevel.com/docs/webhook/OpportunityStageUpdate.md).
- Value changes, owner changes, source, created date, contact id hash, snapshot of the open pipeline daily (catches missed webhooks).
- Mark our own writes so they never count.

Peer benchmark rules: opt-in per client account and per agency; minimum cohort 10 accounts and at least 5 agencies in the same vertical; no cell shown with under 20 deals; show only medians/quartiles, never a named account; round values; no cross-agency client names; revocable, with a stated retention. Vertical must be self-declared (verify by sample).

## 5. Price anchors

- Clari core about $100-120 per user per month, full stack $200-310 (estimates). Gong $100-150 (estimates). InsightSquared $30-149 (conflicting). https://www.docket.io/resources/research/clari-review ; https://www.avoma.com/blog/gong-pricing — UNVERIFIED (no official list prices).
- Agency reporting tools about $12-15 per client (from the master brief). Our $11.50 per client account already sits at that anchor; a forecast add-on at $9-19 per account (brief hypothesis) is consistent. Nothing found for GHL-marketplace pipeline add-ons: UNVERIFIED.

## 6. Risks

- API: 100 requests per 10 s per app per resource, 200,000 per day (https://jc-aiwiki.pages.dev/gohighlevel/api-rate-limits, third-party wiki, VERIFIED stated; confirm in official docs). Mitigation: webhooks first, queued nightly reconcile, backoff on 429.
- Bad data: junk, duplicate and test deals, missing owners, stages renamed or reordered (store stage ids and names per event). Mitigation: data-health score, minimum-data rules, never blur "no data" and "zero".
- GHL native catching up: it already has pipeline reports and opportunity stats (INFERENCE from the master brief); our edge is cross-account history and alerts, not charts.
- Benchmarks are weak, so avoid promising numbers in UI or listing.

## 7. Ranked moat/money features (INFERENCE throughout)

1. **Stage-dwell stale alerts per stage.** Sees: "6 deals stuck longer than 75% of your won deals ($42k est.)". Data: stage events. Hard to copy: GHL lacks history; needs weeks of recording. Agencies needed: 1 (own history).
2. **Pipeline snapshot time series** (daily open value, count, mix). Sees: trend and coverage. Data: daily snapshots. Hard to copy: cannot be backfilled. Agencies: 1.
3. **Lost-reason and "no reason recorded" report.** Sees: why deals die, by owner and source. Data: status events, reason. Hard: needs consistent capture over time. Agencies: 1 per account, 10+ for patterns.
4. **Forecast with honest range and track record.** Sees: next-30-day range plus last 6 months' accuracy. Data: stage history, closes. Hard: calibrated per account, needs 6+ months. Agencies: 1 account with 15+ closed deals.
5. **Deal data-health score and one-tap fixes** (ownerless, $0, duplicate, test). Sees: trustworthy dollar tiles. Data: current state. Hard: moderate. Agencies: 1.
6. **Opt-in peer benchmarks** (stage dwell, win rate by vertical). Sees: "you vs peers". Data: pooled events. Hard: needs cohort scale and trust. Agencies: 5+ agencies, 10+ accounts per vertical.
7. **Owner and source win-rate ladder.** Sees: which setter/closer and source converts to revenue. Data: owner change events, source. Hard: needs owner history. Agencies: 1, better at 3+ accounts per agency.
8. **Weekly "pipeline receipts" for clients** (what moved, what was caught, recovered value). Sees: proof of value to the end client. Data: events plus alert log. Hard: needs the alert-to-outcome record. Agencies: 1, grows with use.
