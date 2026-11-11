# Appointments R4: data, ROI and moat (research, 2026-11-10)

Labels: V = VERIFIED (read in a source; vendor sources are low reliability), I = INFERENCE, U = UNVERIFIED. Most benchmarks are vendor blogs: directional only, never a promise in the UI.

## 1. Show / no-show benchmarks
| Vertical | Figure | Source | Label |
|---|---|---|---|
| Med spa | ~4% no-show (non-membership spas ~1%), 2026 vendor report | https://www.zenoti.com/thecheckin/no-show-revenue-calculator | V, vendor, medium |
| Salons / fitness / professional services | 15-20% / 12-15% / 10-18% | https://www.schedulingkit.com/blog/average-no-show-rates-by-industry | V, compilation, low |
| Healthcare overall | 23-27% vendor; ~6.8% self-reported (definitions differ) | https://www.getweave.com/no-show-rate/ | V, low |
| Solar (set to held) | show 65-80%; under 60% = qualification/confirmation problem; close 22-38% of held | https://resources.rework.com/libraries/solar-home-energy-growth/solar-sales-kpis-metrics | V, vendor, low |
| Solar appointment-set programs | 65-75% confirmed show with double confirmation; no-show+reschedule 25-35% | https://elevarus.com/buy-solar-leads-appointment-set-vs-raw-economics/ | V, vendor, low |
| Legal | ~22% no-show; one firm 72% to 93% show after day-before + morning-of texts (anecdote) | https://www.lawmatics.com/blog/3-guaranteed-ways-to-eliminate-consultation-no-shows-using-lawmatics | V, vendor, low |
| Dental, home services, real estate, coaching | No reliable benchmark found | n/a | U |

Definitions differ (cancellations counted or not). I: SubSync's pooled data will become the only credible benchmark for GHL-style lead-gen appointments.

## 2. What reduces no-shows
- Reminders: typical trial effect ~30-40% relative reduction. Pediatric RCT 38.1% to 23.5%; UK BIT cost-of-missed-appointment SMS about 32% (https://www.nsw.gov.au/departments-and-agencies/behavioural-insights-unit/blog/using-reminders-to-cut-missed-hospital-appointments). V, medium.
- Timing: 2012 meta-analysis found no significant difference between 24, 48, 72h+. A 475,214-appointment WhatsApp preprint: one reminder at ~24h RR 0.76 vs 0.91 at 72h (not peer reviewed) (via https://schedulingkit.com/statistics/appointment-reminder-statistics). V, low-medium.
- Deposits: vendor claims up to 55% reduction; Tock customers 1.7% no-show (https://exploretock.com/join/resources/eliminate-no-shows-3-tock-tools/). Restaurant context, not lead-gen. V, low.
- Confirmations and same-day rebook: no measured effect found. U. SubSync can measure these itself (section 5).

## 3. Revenue-lost formula (labelled estimate with range)
Per account, last 30 days:
- Lost to no-shows = no-shows x P(close | held) x average deal value. Low = own close rate x 0.5, mid x 0.75, high x 1.0 (I: no-shows are likely lower intent; state the haircut).
- Unmarked: count past-time appointments with no outcome. Estimate how many were no-shows using the account's own no-show share among marked outcomes; show as a range, never a single dollar figure.
- Minimum data: 10 held appointments and 5 closed deals, else show counts only ("not enough data").
- Recoverable = no-shows not rebooked in 7 days x rebook rate x above.
- Label: "Estimate from your own close rate and deal values. Tap for formula." Without close data, use industry range tagged "industry guess".

## 4. Setter / closer metrics
- Booking share per user = booked by user / total booked. Book-to-show = held / booked. Show-to-close = won / held (solar 22-38%). Lead-to-booked speed: median and P90.
- Contact-to-set: digital 25-45%, canvass/referral 40-60%; a setter booking 70-80% of contacts is likely not qualifying (Rework link above). V, low.
- Speed-to-lead: the "21x within 5 vs 30 min" figure measured lead qualification, not sales; do not promise conversion (https://www.revenuehero.io/blog/what-is-speed-to-lead-in-2026-benchmarks-data-and-real-expectations). V, medium.
- CHECK: GHL booker/createdBy field; public-widget bookings may have no user.

## 5. Moat from our own history
Record now (append-only): appointment id, contact id, calendar id, assigned user, booker (user or source: widget/workflow), start/end and timezone, every status change with timestamp and actor, booked-at, lead created-at, lead source/UTM, first-response time, reminder messages (count, channel, time before start), reschedule chain, payment/deposit present, opportunity id with later stage and value, outcome-marked-at.
Unlocks: show rate by booker, source, response-speed bucket, lead time, weekday/hour; reminder effect; same-day rebook rate.
Peer benchmarks: opt-in, anonymised, self-declared vertical, minimum cohort (suggest 10+ accounts and 200+ appointments per cell; hide a cell if one account is over 40%). I. Must respect CLAUDE.md 4.2 tenancy.

## 6. Price anchors
AgencyAnalytics ~$12-15 per client/month; All The Apps $129/$299/$499 per month (from CLAUDE.md, secondary). SubSync $11.50 per account. No verified standalone appointment-reporting add-on price found. U.

## 7. Risks
- GHL API: burst 100 requests/10s and 200,000/day per app per resource; headers show remaining (https://marketplace.gohighlevel.com/docs/other/rate-limits). V, high. Queue backfills.
- Appointment status values not confirmed in official docs (CHECK live API); store raw plus mapped status.
- Bad status data: staff forget to mark; keep "unmarked" its own bucket, never count as showed. Auto-"showed" workflows pollute rates.
- Double counting: reschedules/edits; dedupe by contact+calendar+chain; exclude SubSync's own writes (principle 14).
- Timezones: store UTC plus calendar timezone; "past time" and weekday/hour in account timezone; DST edges.
- Keep cancellations separate from no-shows; define in METRICS.md.

## 8. Ranked moat/money features
| # | Feature | Customer sees | Data needed | Hard to copy because | Possible at |
|---|---|---|---|---|---|
| 1 | Unmarked cleanup + true show rate | "9 past due, no outcome; true show rate 71% not 88%" | status history, times | needs continuous watching, not a report | 1 agency |
| 2 | Revenue-at-risk range | Labelled $ range of no-show loss | outcomes, close rate, deal value | credible only with own history | 1 agency |
| 3 | Show rate by booker | Setters ranked on shows, not bookings | booker field, outcomes | needs bookers recorded over time | 3 agencies |
| 4 | Show rate by source and response speed | "Answered under 5 min shows more" | source, first response, outcomes | joins conversation and appointment history | 3 agencies |
| 5 | Best days/hours, lead-time | Slot advice per account | start times, outcomes | needs hundreds of appointments per account | 5 agencies |
| 6 | Reminder effectiveness | "24h reminder accounts show +x" | reminder logs | nobody logs reminders beside outcomes | 10 agencies |
| 7 | Opt-in peer benchmark by vertical | "Your show rate vs similar med spas" | pooled opt-in outcomes | network data grows with installs | 20+ agencies, 10+ per vertical |
| 8 | No-show risk score per upcoming appointment | Flag likely no-shows to confirm | all above | needs large labelled history | 30+ agencies |
