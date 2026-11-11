# Unanswered R4: Data, ROI and Moat (research, 10 Nov 2026)

Labels: V = VERIFIED (read in the source page), I = INFERENCE, U = UNVERIFIED (secondary or vendor claim, not checked at source).

## 1. Response-time benchmarks (reliability noted)
| Vertical | Finding | Year / sample | Reliability | Label |
|---|---|---|---|---|
| Cross-industry | Avg first reply 42h; 37% within 1h; 23% never | 2011, 2,241 US firms, secret shopper (HBR) | Good sample, old. HBR page itself did not show figures; numbers via secondary summary. https://ainora.lt/blog/lead-response-time-5-minutes-study-2026 | U |
| Cross-industry | Call at 5 min vs 30 min: ~100x contact, ~21x qualify | 2007, 6 companies, 15,000+ leads (MIT/InsideSales) | Small sample, old, often misattributed to Harvard. Same URL as above | U |
| Legal | Median 13 min; 25% reply in 5 min; 26% never; no conversion data | Q1 2025, 1,333 firms, fictitious-lead shopper. https://hennessey.com/2025-lead-form-response-time-study/ | Best-documented vertical figure; speed only, not conversion | V |
| Real estate | Median 39 min; mean 8h17m; 47% never reply | 2024, 74 to 100+ brokerages (Roof.ai audit) | Vendor audit. https://focus-digital.co/average-speed-to-lead-by-industry-and-what-every-minute-of-delay-costs/ | U |
| Home services | Only ~60% replied within 5 days | 2018, 466 firms (Valve+Meter). https://www.proremodeler.com/5-day-look-response-times | Oldest; no 5-minute metric | V (60% figure) |
| Solar | Most took over a day; 77% made 4 or fewer calls | 2015, 30 installers (Velocify). https://prnewswire.com/news-releases/new-secret-shopper-study-of-solar-industry-by-velocify-reveals-need-to-improve-sales-response-processes-300116855.html | Tiny, old, vendor | V (headline) |
| Med spa | No credible study found; only vendor case studies | n/a | Do not cite numbers | U |
| Coaching/info | No study found | n/a | Same | U |
| B2B SaaS | Only 7% replied under 60s; 4h50m average | 2022 (Chili Piper). https://www.chilipiper.com/article/chili-insights-vendor-response-time | Vendor, not our verticals | V |

Takeaway (I): direction is consistent ("faster is better"), but no vertical has a trustworthy conversion-by-speed curve. Multipliers like 391%, 100x, 21x should never be shown as fact. This gap is the moat: our own data can be the first real curve for appointment-driven SMBs.

## 2. Dollars at risk: defensible estimate formula (I)
Show as "estimated", formula one tap away, hidden below minimum data.

`at_risk = unanswered_leads_over_SLA x account_booking_rate x close_rate x avg_deal_value x speed_penalty`

- booking_rate, close_rate, deal_value: from the account's own history (our event store); show "not enough data" under about 30 closed deals or 100 leads.
- speed_penalty: start conservative (for example 0.2 to 0.3 of expected value lost for leads waiting over 1 hour). Replace with the account's own measured curve once it exists. Never use published multipliers.
- Exclude $0 deals, test contacts, DND and leads already handled by another channel.
- Show a range (low/high), not a point. Also report "leads never answered" as plain counts, which need no model.

## 3. What agencies pay (price anchors)
- AgencyAnalytics Core: $20 per client per month annual, volume discounts at 25+ clients; includes goals, alerts, anomaly detection. https://agencyanalytics.com/pricing (V). Note: brief says $12 to $15; the page now says $20.
- GHL SaaS Mode needs the $497 Agency Pro plan per most third-party guides; markups are typically on usage (U). https://www.webdew.com/blog/gohighlevel-saas-mode
- GHL docs: agencies buy apps per sub-account or usage-based; agencies set a markup on usage-based marketplace apps, applied app-wide, not per client. https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000005501-marketplace-agency-reselling-for-apps-with-usage-based-pricing (V). Commission rate not stated; the brief's $10 to $10.50 example (0% commission) was not re-verified here (U).
- Willingness to pay: no direct evidence found. Only a proxy: agencies already pay $20 per client for reporting plus alerts. $11.50 sits below that anchor (I). Real evidence must come from pilot interviews.

## 4. Moat patterns: peer benchmarks
| Product | Minimum cohort | Anonymisation / opt-in | Source |
|---|---|---|---|
| Databox | 15 distinct sources per cohort | Anonymised; opt-in to compare | https://help.databox.com/how-is-data-being-calculated-in-the-benchmark-groups (page fetched did not confirm; search snippet only) U |
| BambooHR | 5 companies | Opt-out (included by default) | https://www.bamboohr.com/about-bamboohr/data-principles V (via search) |
| Triple Whale | 5 brands | Only medians and percentile ranges leave the system | https://kb.triplewhale.com/en/articles/15606855-can-other-brands-see-my-data U |
| Gainsight | Minimum aggregation rule | Opt-in at first use | https://benchmarks.gainsight.com/faqs/ U |
| ChartMogul | All accounts contribute | Covered by Terms | https://help.chartmogul.com/article/138-benchmarks U |
| Fathom | Not stated | Hide company names: numbered entries | https://support.fathomhq.com/en/articles/1405912-privacy-in-a-benchmark-group V |

Design for SubSync (I): opt-in per agency, aggregate-only (median, P25/P75), minimum 10 accounts from at least 5 different agencies per vertical cell (stricter than the 5-brand norm because lead data touches end customers), no account names, no small-cell drilldown, and cohort suppression when one agency supplies over 40%.
Legal (I, not legal advice): GDPR Recital 26 treats truly anonymous data as out of scope; CCPA "aggregate consumer information" is group data not linkable to a consumer. Our benchmarks use only response-time and outcome statistics, never message text or contact identity. Needs a lawyer before launch; state in the DPA that benchmarking is a disclosed purpose. Source: https://www.bclplaw.com/en-US/insights/what-qualifies-as-aggregate-or-de-identified-information-under-the-ccpa.html

**Start collecting now (append-only):** vertical tag per account (set at install, editable), business-hours config, timezone, per-lead: created time, source channel, first human touch time and user, automated touch flag, owner at each change, appointment booked/showed/no-show, deal won/lost with value and date, SLA at the time, alerts fired and what happened next. Store raw timestamps, never just aggregates.

## 5. Risks
- GHL native: an SLA Performance dashboard (Conversations > Analytics, admin-only, data from 23 Mar 2026) already exists. https://help.gohighlevel.com/support/solutions/articles/155000007658-how-to-track-sla-performance-in-conversations (V). It is per account and not cross-agency. A cross-account native view is plausible within 12 months (I). Our edge: history, outcomes, benchmarks, alerts.
- API limits: 100 requests per 10s, 200,000 per day, counted per app per location, so more installs do not dilute the budget. https://marketplace.gohighlevel.com/docs/other/rate-limits (V). Defaults can be changed by GHL; read the rate-limit headers.
- False alarms: after-hours leads, spam and bots, leads answered by phone (not in messages), automated replies counted as human, shared inbox with no owner. Mitigate with business hours, "human vs auto" setting, snooze, one digest instead of per-lead pings, and a feedback button on every alert (also feeds precision metrics).
- Bad ownership data: many conversations have no assigned user (I). Show "unowned" as its own finding, never blame a user without a verified assignment.
- Benchmarks are weak at small N; do not show them before cohort minimums are met.

## 6. Ranked moat features
| # | Feature | Why competitors cannot copy | Data needed | Possible at |
|---|---|---|---|---|
| 1 | Account's own speed-to-outcome curve ("your leads answered under 5 min book X% vs Y%") | Needs months of timestamped history that GHL does not expose retroactively | Lead, first touch, booking, show, win | 1 agency, about 3 months |
| 2 | Proof Receipts (alerts caught, fixed, recovered value, trend) | History of our own alerts and what happened next | Alert log plus follow-up outcome | 1 agency, about 2 months |
| 3 | Setter/closer scorecards across accounts, normalised for lead quality | Cross-account owner history; native reports are per account | Owner at each change, outcomes | 3 agencies |
| 4 | Vertical peer benchmark ("median 14 min vs your 41") | Network effect; needs cohorts and opt-in trust | Vertical tag, first-response times | 15 to 25 agencies (about 10 accounts per vertical from 5 agencies) |
| 5 | Calibrated at-risk dollars (penalty learned from real data) | Needs outcomes at scale to learn the penalty per vertical | Close rates and value by speed bucket | 20+ agencies |
| 6 | Predictive "this lead is about to go cold" and no-show risk | Model trained on our cross-account outcome data | Full reply and appointment history | 30+ agencies, 100k+ leads (I) |

Open items for King: confirm GHL commission and the SaaS markup example in the developer docs; find one real med spa or solar agency willing to share anonymised timestamps to validate the penalty.
