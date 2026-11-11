# Clients module: landscape and pain (R1, 11 Nov 2026)

Method: web search plus a few page fetches. Many sources are vendor blogs (biased). Labels: VERIFIED = read on the page; INFERENCE = my reasoning; UNVERIFIED = secondhand or vendor claim.

## 1. GHL native tools and marketplace lane

- Agency dashboard has a Sub-accounts list with per-account metrics; Reports break down appointments, outreach, users, submissions, with date filters. Data appeared to start about Oct 2022; metric-based triggers were only expected. VERIFIED (old, Oct 2022 post): https://growthable.io/blogs/agency-analytics-across-all-subaccounts-released/
- Third-party guides describe a single agency-level roll-up, and billing visible at agency level only. UNVERIFIED: https://automatethejourney.com/blog/gohighlevel-dashboards-setup-guide
- Native health score or churn signal: NOT FOUND in official docs. Search returned no official page. INFERENCE: not native.
- Ideas-board requests with votes (agency reporting, health, churn, onboarding, usage): NOT FOUND (board not indexable). King should check the live board.
- Location API fields. The Get Location doc lists id, companyId, name, domain, address, timezone, email, phone, business{}, social{}, settings{}, reseller. It does NOT show dateAdded, plan or status on that page (page may be truncated). VERIFIED partial: https://marketplace.gohighlevel.com/docs/ghl/locations/get-location . Last-activity field: NOT FOUND. INFERENCE: activity must be derived from our own event store, which supports the moat.
- Marketplace apps: GoCSM is the direct lane competitor. Per-account health score 0-100 from product adoption, revenue, login activity, sentiment; bands Thriving/Healthy/Steady/At Risk; configurable weights; nightly recalculation; "MRR at risk" overview; account needing attention list; trend graph. VERIFIED: https://gocsm.featurebase.app/changelog/rocket-new-health-dashboard-v3-now-live . It added revenue intelligence (revenue, cost, margin, churn) in Feb 2026. VERIFIED (search snippet): https://gocsm.featurebase.app/changelog/rocket-gocsm-revenue-intelligence-now-live . Price: NOT FOUND (G2 shows Core/Pro/Premium tiers by user count, no dollar figures): https://www.g2.com/products/gocsm/pricing . Automatic churn alerts: NOT confirmed on the page.
- GoCSM measures the agency's own SaaS-mode relationship (logins, feature adoption, billing). INFERENCE: it does not measure whether the client's own leads are being answered, which is SubSync's outcome data.
- All The Apps: Measure section tracks its own platform (add-ons, tickets, payments); no visible show rate or speed-to-lead (from CLAUDE.md brief, previously VERIFIED). No sub-account health score found.

## 2. Competitors

| Tool | Price | Features | Source / label |
|---|---|---|---|
| AgencyAnalytics | About $20 per client per month annual, about $25 monthly (conflicting sources); Enterprise custom from 25 clients | 90+ integrations, unlimited dashboards, goals, alerts, anomaly detection, white-label portal and domain | UNVERIFIED (aggregators): https://blog.coupler.io/?p=85540 ; https://agencyanalytics.com/pricing |
| Databox, Whatagraph, Swydo | Not retrieved | Marketing reporting | NOT FOUND |
| Vitally | Vendr median about $34.5K per year; other sites $299 to $1,500+ per month | CS platform, manual health config, 2 to 4 week setup | UNVERIFIED: https://dupple.com/learn/best-customer-success-software |
| ChurnZero | Median about $44.7K per year | Most configurable health engine, real-time scores | UNVERIFIED (same) |
| Gainsight | Median about $49.9K per year, custom | Health from usage, adoption, tickets, logins, NPS; for large teams | UNVERIFIED (same) |
| HubSpot customer health | NOT FOUND | | |

Takeaways. INFERENCE: (a) client reporting is a commodity at about $20 per client; SubSync at $11.50 undercuts it and adds outcomes. (b) Enterprise CS tools are priced and built for SaaS; they need product-usage data agencies cannot feed. (c) Hard to copy: our recorded history of each client's lead handling, appointment outcomes and response times (event store), plus per-account SLA proof. Dashboards, white-label portals and NPS are easy to copy.

## 3. Customer voice (all vendor-authored; no Reddit threads surfaced)

- Clients leave over lost confidence, not only results: https://www.whatconverts.com/blog/why-static-client-reports-are-killing-agency-retention/ . UNVERIFIED.
- Delivery dissatisfaction cited by 48% of departing clients versus agencies ranking it 7th; narrative reports tied to 9% versus 31% churn. Original study not checked, correlational. UNVERIFIED: https://www.tapclicks.com/blog/why-your-marketing-dashboard-is-losing-you-clients-in-2026-and-how-to-fix-it
- Unclear or irregular reports hide the agency's impact; "clients leave when they cannot see what they pay for". UNVERIFIED: https://www.callrail.com/blog/agency-client-retention-why-they-leave
- About 70% of churn in first 90 days (AI automation agencies). UNVERIFIED: https://ciela.ai/blogs/why-ai-automation-clients-churn-and-how-to-keep-them
- Churn warning signs for agencies: https://agencyanalytics.com/blog/reengaging-churned-customers (not read in full).
- A health score built only on logins misses low asset adoption. UNVERIFIED (GoCSM post, via search).
- Reporting burden, juggling many sub-accounts, slow follow-up as a churn cause: NOT FOUND as firsthand voice. King's 5 owner interviews should cover this.

## Gaps SubSync can own

1. Health based on the client's lead-handling outcomes (response time, unanswered leads, show rate), not agency logins.
2. Churn risk that blends outcome decay plus no-activity plus SLA breaches.
3. Proof of results: weekly Receipts per client showing what was caught and fixed.
4. First-90-days onboarding monitor (is the account actually receiving and answering leads).
5. "What to fix first" ranked queue across all client accounts, with dollars at risk.
6. Silent-failure detection (workflow broke, leads no owner) before the client notices.
7. Account activity history that GHL lacks (stage changes, last staff touch), built from our event store.
8. Plain-language client-ready explanations (narrative of why a number moved).
9. Price gap: $11.50 per account vs about $20 reporting tools and four-to-five-figure CS tools.
10. Setter and staff accountability per client, usable in client calls.

## 8 ranked features agencies would pay for (INFERENCE, validate in interviews)

1. Client outcome health score (0-100, one-line explanation per score), sorted worst first.
2. Churn-risk alerts (email daily brief): "Client X: 14 unanswered leads, show rate down".
3. "Fix first" queue with dollars at risk and one-tap open in the CRM.
4. Weekly proof Receipt per client (white-label, shareable) to send before the client asks.
5. New-client 90-day onboarding tracker with setup checklist and first-result milestones.
6. Silent-failure detector (no inbound, no outbound, nothing booked in N days).
7. Agency-wide trend and "MRR at risk" using the agency's own client price (entered once).
8. Pre-call brief for each client (last 30 days, wins, open problems).

Open checks: GHL location fields dateAdded/plan; ideas board votes; All The Apps health features; Databox/Whatagraph/Swydo prices; marketplace for any "client health" app other than GoCSM.
