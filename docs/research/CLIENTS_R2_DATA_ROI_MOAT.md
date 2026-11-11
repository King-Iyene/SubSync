# Clients module R2: data, ROI, moat (2026-11-11)

Labels: V = VERIFIED (a source states it; most are vendor blogs, so reliability is low unless noted), I = INFERENCE, U = UNVERIFIED.

## 1. Agency client churn
- Retainer agencies: about 1.6% monthly churn (18% a year), 56-month average life. Full-service digital 2.1%, SEO 3.2%, agencies with 1-10 staff about 32% a year. Vendor report, 2026, sample unknown. V, low reliability. https://agiled.app/statistics/client-retention-statistics , https://focus-digital.co/average-marketing-agency-churn/
- Annual retention of 92% for eight-figure agencies and 78% for seven-figure agencies (Predictable Profits 2025, quoted by Swydo). 70% is the red-flag line. V, low. https://www.swydo.com/?p=21556
- B2B agency median retention 68% a year (Starr Conspiracy, 47 clients, 2024). V, medium. https://www.thestarrconspiracy.com/insights/benchmarks/b2b-marketing-agency-benchmarks-2025
- A Seven Figure Agency handbook claims 10-15% monthly for some retainer services. This conflicts with the sources above, so U. https://sevenfigureagency.com/marketing-agency-client-retention/
- Why clients leave: delivery dissatisfaction ranks first for clients and seventh for agencies (Setup survey, 2025, 400+ people). Portent 2019: 76% leave over poor communication or unmet expectations, while 56% of agencies think it is money. Whatagraph and Portent say agencies misread the cause. V, medium. https://setup.squarespace.com/blog/why-clients-end-their-agency-relationships-why-agencies-think-they-do , https://portent.com/agency-horror-stories/
- Time to value: 43% (Moxo 2026) or about 70% of churn happens in the first 90 days. The two figures conflict, so U. Vendors say faster onboarding (5-7 days vs 14-21) retains 92% vs 70-80% at 90 days. U. A client who has not logged in for 30 days may not see value. https://www.swydo.com/blog/client-onboarding/ , https://agiled.app/statistics/client-onboarding-statistics
- Cost of losing a client = MRR x expected remaining months. At 1.6% monthly churn that is MRR x 62; example from source: $8,000 x 36 months = $288,000. The formula is I, the example is V. https://agiled.app/statistics/client-retention-statistics

Use: show the agency its own churn; never claim an industry rate as fact. Pair "$X per month at risk" with the agency's own average client MRR (entered by the agency).

## 2. Client health score (computable from CRM data)
Only the general approach is sourced: usage trend is the strongest signal, thresholds must be calibrated on the agency's own churn history, and flagging about 30% of accounts is noise. V, low. https://blog.getdarwin.ai/en/ai-customer-health-scores-2026 , https://www.basedash.com/blog/how-to-build-a-customer-health-score-signals-weighting-and-sql . All weights below are I and are a starting point.

| Signal (per client account, vs its own 8-week baseline) | Weight |
|---|---|
| New-lead volume trend | 20 |
| Reply speed and SLA attainment | 20 |
| Leads or conversations waiting with no answer | 15 |
| Show rate and appointments with no outcome | 15 |
| Pipeline movement (stage changes, deals won) | 10 |
| Client staff's own activity (logins, notes, outcomes set) | 10 |
| Data quality (owner set, no junk deals) | 5 |
| Client opened a report or receipt | 5 |

Rules (all I):
- Minimum data: at least 28 days of history and at least 20 leads; otherwise show "Not enough data yet", no score.
- Score band: Healthy, Watch, At risk. Label it "Estimate".
- Churn-risk flag only when 2 or more signals have dropped for 2 weeks in a row, or lead volume is down 40% or more against baseline, or the client has not opened anything for 30 days. Always show which signals tripped, in plain words.
- Seasonal and tiny accounts (under 20 leads a month) get "Watch" at most.
- The agency can mark "known reason" (paused ads, holiday), which mutes the flag.
- Track flag accuracy: once an agency marks a client as left, record whether we flagged it earlier. This is the moat feedback loop.

## 3. Proof-to-client features
- Evidence that speed matters: 2007 InsideSales/MIT (vendor data, not peer reviewed): about 100x contact odds and 21x qualification odds at 5 minutes vs 30. HBR 2011 (2,241 firms audited): contact within an hour gave about 7x qualification odds. V, medium. https://ainora.lt/blog/lead-response-time-5-minutes-study-2026 . Use only as small-print context, never as our claim.
- Features: weekly and monthly Receipt (what we caught, what got fixed), ROI summary (answered-in-time leads, recovered no-shows, $ at stake, labelled estimate), public verified reply-time page (per account, opt-in by the agency, only SubSync-measured numbers), one-click QBR (Receipts plus trends). A QBR page is I; reporting is a commodity (see 5), so the differentiator is outcome data nobody else holds.
- What agencies pay: reporting tools run $20-25 per client per month (AgencyAnalytics Core), $44-69 per month entry (DashThis, Swydo), $286-$1,118 per month (Whatagraph). V, low to medium, sources conflict. https://madgicx.com/compare/agencyanalytics-review , https://dashthis.com/alternatives/swydo/

## 4. Moat: what to record now (append-only, per account, per day)
- Every metric time series: lead count, first-reply time (median, P90), SLA attainment, waiting count, show rate, unmarked appointments, stage moves, staff activity, data quality.
- Every alert fired, its time, and when it cleared (fixed by whom, if known).
- Health score and each signal at every computation, plus the flag and whether it was muted.
- Agency events: client added, paused, removed or churned (agency marks), notes.
- Peer benchmark by vertical (home services, med spa, solar, real estate, coaches): opt-in only, store only the vertical and aggregate numbers, and show a benchmark only when the cohort has at least 10 accounts from at least 5 different agencies (I; a small cohort could reveal one agency). Show percentile bands, not names. Without 5 agencies, show nothing.
- Why hard to copy: history cannot be rebuilt (GHL gives no clean history), and churn labels come only from us.

## 5. Price anchors and resale margin
- SubSync $11.50 per client account per month is half of AgencyAnalytics Core ($20-25). If the agency charges the client $23, it keeps $11.50 (I, from the brief's own math).
- Standing in the market: reporting tools sell dashboards; none of the sources lists reply-time or no-show outcomes. U (limited search).

## 6. Risks
- Privacy: health scores describe staff behaviour. Show agency and client admins counts only, no message content. Peer data opt-in only. Delete or anonymise on uninstall.
- False churn alarms: the main trust risk. Use minimum data, "Estimate" label, muting, accuracy tracking. Quiet seasons look like decline.
- API limits: 100 requests per 10 seconds and 200,000 per day, counted per app per location (or company). V, high (official docs). https://marketplace.gohighlevel.com/docs/other/rate-limits/index.html . Run syncing per account on a queue; prefer webhooks, and keep history in our store.
- Native catching up: GHL or All The Apps could add dashboards. Our edge is history plus outcome checks, not charts. I.
- Marketing claims: the agency-churn figures are vendor numbers; do not put them in the UI.

## Ranked moat/money features
1. Weekly Receipt per client (what we caught and fixed). Customer sees: proof to forward. Data: alerts and fixes. Hard to copy: needs our alert history. Works at 1 agency.
2. Churn-risk flag with reasons. Sees: "3 clients to call this week and why". Data: 8-week baselines. Copy: needs history and accuracy labels. 3+ agencies to calibrate.
3. Verified reply-time page (opt-in). Sees: shareable proof. Data: reply-time series. Copy: independent third-party measure. 1 agency.
4. One-click QBR. Sees: slide-ready summary. Data: Receipts plus trends. Copy: needs 90 days history. 1 agency.
5. Health score history chart. Sees: client trend. Data: daily scores. Copy: cannot be backfilled. 1 agency.
6. Revenue-at-risk per agency (churn flag x client MRR, labelled estimate). Sees: dollars. Data: MRR typed in by the agency. Copy: easy alone, hard with flag history. 1 agency.
7. Vertical benchmark (opt-in). Sees: "you are in the slowest 25% of med spas". Data: pooled aggregates. Copy: needs a pooled cohort. 5+ agencies per vertical, 10+ accounts.
8. Onboarding first-win tracker (first 30 days). Sees: "client 14 days in, no answer to 6 leads". Data: install-date series. Copy: moderate. 1 agency.
