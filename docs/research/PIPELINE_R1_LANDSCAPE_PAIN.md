# Pipeline and deals: landscape and customer pain (R1)

Date: 2026-11-10. Labels: VERIFIED = read on the cited page; INFERENCE = my reasoning; UNVERIFIED = third-party or not confirmed.

## 1. Native GHL pipelines and opportunities

**Reports (VERIFIED)** - https://help.gohighlevel.com/support/solutions/articles/155000008109-opportunities-widgets-in-dashboards-reports
- 17 opportunity widgets: counts, open/won/lost/abandoned counts and values, Lost Opportunities By Reason, counts by status, counts and revenue over time, "won this month" widgets.
- Group By (pipeline/stage) works only on 4 widgets. No standalone win-rate, velocity or stage-distribution widget in this article.
- Using Status Change as a date can shift historical numbers when deals are reopened; lost deals with no reason show as "None".
- Statuses: open, won, lost, abandoned (widgets confirm all four).

**Forecast (VERIFIED)** - https://help.gohighlevel.com/support/solutions/articles/155000007688-opportunity-forecasting-in-highlevel
- Off by default; enabled per account under Labs. Forecast tab shows probability-weighted Expected Revenue, uses a new Expected Close Date.
- Data-hygiene insights flag missing value, missing date and stale deals. Deals with no close date are excluded (changelog, https://highlevel.canny.io/changelog/opportunity-forecasting, UNVERIFIED via search snippet).
- Per account only. No cross-account view. INFERENCE.

**Stale handling (UNVERIFIED, third-party)** - https://consultevo.com/gohighlevel-stale-opportunity-workflow-trigger/
- A "Stale Opportunity" workflow trigger exists; staleness is based on last update, so any edit resets it. Stale = "not edited", not "no real activity". INFERENCE.

**API fields (VERIFIED)** - https://marketplace.gohighlevel.com/docs/ghl/opportunities/get-opportunity
- `status`, `lastStatusChangeAt`, `lastStageChangeAt`, `monetaryValue` (number), `assignedTo` (user id), `source`, `lostReasonId`.
- Only the LAST stage/status change time is stored. No per-deal stage history endpoint found. INFERENCE (not found in docs searched).

**Webhooks (VERIFIED)** - https://marketplace.gohighlevel.com/docs/webhook/OpportunityStageUpdate.md ; .../OpportunityStatusUpdate.md ; .../OpportunityMonetaryValueUpdate.md
- Separate events for stage, status and value change; payload carries assignedTo, contactId, monetaryValue, dateAdded. Type of `monetaryValue` differs between doc versions (number vs string): validate live. Payloads showing previous stage not confirmed (CHECK).

**Rate limits (VERIFIED)** - https://marketplace.gohighlevel.com/docs/oauth/Faqs
- 100 requests per 10 seconds burst and 200,000 per day, per app per resource (location or company).

**Per-account pipeline limits:** NOT FOUND in sources read.

**Workflows on stage change:** triggers exist (Opportunity status/stage changed, stale). Only third-party sources read (UNVERIFIED): https://growthable.io/gohighlevel-tutorials/opportunities/automating-opportunities-in-gohighlevel/

**Marketplace apps in this lane:** none found via search; marketplace cannot be browsed from here. King must check the marketplace UI (search "pipeline", "forecast", "stale deals"). External: SegMetrics GHL Deal Pipeline dashboard (days to close, deal age) https://segmetrics.io/dashboard-template/gohighlevel-deal-pipeline/ (UNVERIFIED listing).

## 2. Competitors

| Tool | Price (UNVERIFIED unless noted) | Pipeline features |
|---|---|---|
| HubSpot Sales Hub | Starter ~$7-20, Pro ~$90-100, Enterprise $150 per seat/mo (VERIFIED page, labels unclear) https://www.hubspot.com/pricing/sales | Forecasting from Pro up, deal journey analytics, dashboards; hierarchy forecasting on Enterprise |
| Pipedrive | ~$14/seat; forecasting ~$39/seat (aggregator) https://dupple.com/learn/best-sales-tracking-tools | Forecast view, deal rotting. Pricing page returned 403, not verified |
| Close | Solo $9, Essentials $35, Growth $99, Scale $139 per user (VERIFIED) https://www.close.com/pricing | Calling-led; live call coaching on Scale; AI agent on all plans |
| Clari | Quote only; est. $1.5-3k per seat/yr (aggregator) https://leadhaste.com/blog/clari-pricing-2026 | Forecast roll-ups, deal inspection |
| Gong | ~$1.2-2.4k per user/yr; Forecast adds 20-40% (aggregator) https://prospeo.io/s/sales-forecasting-software | Conversation intel, deal risk, coaching |
| Salesforce | Not researched: NOT FOUND | - |
| AgencyAnalytics | ~$25-59 base, tiered by client count; GHL metrics include pipelines and pipeline value (vendor pages) https://agencyanalytics.com/integrations/highlevel | Client reporting, no deal-health alerts seen |
| Databox | From ~$159/mo (competitor page) https://help.databox.com/integrate-gohighlevel-with-databox | Pulls contacts, opportunities, appointments |

Stalled-deal alerts, win/loss reasons and rep leaderboards: not confirmed per vendor in sources read. INFERENCE: enterprise tools are seat-priced for single sales teams, not cross-client agency monitoring.

## 3. Customer voice

GHL ideas board (VERIFIED, fetched):
- "Pipeline History", 36 votes, 2023: track how a contact moves first to last stage; wants counts per stage over time. https://ideas.gohighlevel.com/opportunities/p/pipeline-history
- "Historical Pipeline Stage Reporting by Date (Critical for KPI Reporting)", 10 votes, Jun 2026, Under review: the funnel assumes every lead passed every earlier stage; historical stage movement is not stored; commenter wants stall points and SLA tracking. https://ideas.gohighlevel.com/dashboard/p/historical-pipeline-stage-reporting-by-date-critical-for-kpi-reporting
- "Add Historical Stage Reporting" (merged with Year over Year Reporting), 13 votes, 2024. https://ideas.gohighlevel.com/dashboard/p/add-historical-stage-reporting
- "Accurate Tracking of Leads Across Pipeline Stages", 6 votes, Nov 2025. https://ideas.gohighlevel.com/opportunities/p/feature-request-accurate-tracking-of-leads-across-pipeline-stages

Pains with evidence: no stage history (VERIFIED, 4 requests). Lost reasons blank (VERIFIED, widget note). Stale = edit-based (UNVERIFIED).
NOT FOUND: marketplace and review-site reviews on junk deals, bad forecasts, "who is closing", or client reporting; ideas-board posts on win rate and cross-pipeline reporting were not located.
INFERENCE: junk or $0 deals and unresolved open deals distort pipeline totals (third-party guides say this: https://consultevo.com/gohighlevel-pipeline-cleanup-system/).

## Gaps SubSync can own

1. Real stage history: GHL stores only last change; our event store records every stage and status transition from install (VERIFIED gap).
2. Honest funnel: entered-stage counts, not "assumed passed through" (VERIFIED request).
3. Stale by real inactivity (no outbound touch, no reply), not by record edit.
4. Cross-account money view: open, at-risk, won, lost across all client accounts in one screen.
5. Clean-money tiles: exclude $0, ownerless and test deals; "not enough data" on small samples.
6. Lost-reason completeness: list lost deals with no reason, per account.
7. Stage dwell time and velocity per stage and per account.
8. Per-owner closing view across accounts (assignedTo), with sample-size guards.
9. Forecast hygiene: deals missing value or close date, overdue deals, across accounts.
10. Weekly proof of what was caught, shareable to clients.

## Ranked: 8 features agencies would pay for (INFERENCE, validate in interviews)

1. Cross-account stalled-deal alerts with dollars at risk.
2. Stage history and true funnel (moat, filled from install).
3. Money-first Overview: open, at-risk, won this month, per account.
4. Deals with no owner, no value or no lost reason: fix queue.
5. Stage dwell time and slow-stage warnings.
6. Closer view: who is closing across client accounts.
7. Weekly client-ready pipeline receipt.
8. Slipping-forecast and overdue-close-date warnings.
