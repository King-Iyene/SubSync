# Today screen: competitor and expectations research

Researched 2026-11-03 for the Today module (the daily command centre an agency owner opens first).

Label rules: **VERIFIED** = the claim is on a vendor or platform page I have the URL for. **INFERENCE** = third-party or SEO content, my reasoning, or a vendor claim I could not confirm. **NOT FOUND** = searched, no source.
Important limit: WebFetch could not reach any vendor host from this session (DNS blocked for gocsm.com, hotprospector.com, agencyanalytics.com, allthe.apps, marketplace.gohighlevel.com, highlevel.canny.io), and reddit.com is blocked for WebSearch. Everything below was read as WebSearch result summaries of the named URLs, never as full pages. So "VERIFIED" here means "the summary quotes that page", not "I read the whole page". Nothing in this file is a first-hand Reddit or Facebook quote (NOT FOUND). To close the gaps, allow those hosts in the session network settings and re-run, or check the marketplace UI by hand.

## 1. One-page summary

1. No tool found shows lead-handling outcomes (first response, unanswered leads, unmarked appointments, no-show recovery) for all of an agency's client accounts on one screen. Not found is not proven absent: the marketplace could not be browsed. INFERENCE.
2. GHL's own rolled-up view is activity counts (up to 8 columns: active users, appointments created, contacts created, email, text, WhatsApp) and the official article says Agency View controls need the $497 plan and above. VERIFIED (help.gohighlevel.com article 48001224166, via search summary).
3. GHL's SLA Performance Dashboard and first-response widgets exist but are configured and shown per client account. VERIFIED (mirror of the official help, gohighlevelassist.freshdesk.com articles 155000008084, 155000007658).
4. GHL's recent agency-dashboard work is reselling money (SaaS tab, reselling widgets, location revenue/margin breakdown), not lead handling. VERIFIED (freshdesk mirror 155000007991 and community posts).
5. Closest paid overlaps: All The Apps (197.2K installs, 4.7 from 61 reviews, WL tag; its Measure screen was not seen), GoCSM (health from logins/usage/billing, not lead handling), Hot Prospector (speed-to-lead score and a dialer, per account), Kixie (call/response reports and Slack/email alerts, per rep).
6. Owners' morning habit, from adjacent ad-agency sources, is a short exception scan, not a chart review: "treat the morning check as an exception check", and "3 to 5 alerts per account so they stay meaningful". INFERENCE (vendor/blog sources, not agency owners in GHL).
7. Demand for a cross-account view is real on GHL's own ideas board ("Master Dashboard", "Subaccount Reporting From Agency Level", "Agency Roll Up Reporting"); vote counts could not be read this session.
8. Pricing anchors per client account: AgencyAnalytics about $20 to $25, GoCSM about $1.64 (at 100 accounts, vendor claim), DashThis about $10 to $16 per dashboard, All The Apps flat $129 to $499 per agency, SubSync $9.
9. Best Today play: a ranked "what needs action now" list across accounts plus a one-line scorecard per account, mirrored into a short exception email. Do not build a chart wall.

## 2. Competitors and alternatives

| Name | Type | Price (label) | Home-screen features | Praised | Complained | URL |
|---|---|---|---|---|---|---|
| All The Apps (Level Up Marketplace) | GHL marketplace app, white-label | Listing says "Free to install"; $129/$299/$499 per month from King's brief, NOT re-confirmed this session (INFERENCE) | Brief says "Measure" tracks its own platform (add-ons, tickets, payments, SaaS); blank-canvas multi-location dashboard builder. I did not see the screen (NOT FOUND) | 4.7 stars, 61 reviews, 197.2K installs (VERIFIED, marketplace listing via search summary, undated) | Review text NOT FOUND; brief says complexity, 165 scopes, support-heavy (INFERENCE) | marketplace.gohighlevel.com/all-apps |
| GHL native agency dashboard and rolled-up reporting | Platform native | Needs $497 plan for Agency View controls (VERIFIED per official article; a third party says it is on all plans, so conflicting) | Sub-accounts list with up to 8 metric columns per summary card; SaaS tab (MRR, churn); reselling and location-margin widgets | Native, no extra install | Per-account only for lead handling; request for roll-up still open on ideas board | help.gohighlevel.com/support/solutions/articles/48001224166-agency-rolled-up-reporting |
| GHL SLA Performance Dashboard and SLA widgets | Platform native, per account | Not priced separately found | By user and channel: SLA met or breached, average first response time trend by day, week, month | Exists natively | Set up inside each client account; no roll-up seen (INFERENCE) | gohighlevelassist.freshdesk.com/support/solutions/articles/155000008084-sla-widgets-for-dashboards-reporting |
| GoCSM | GHL-agency health scoring | About $1,970/yr for 100 accounts, $3,970 for 300 (vendor claim from docs/DEEP_RESEARCH.md; pricing page not reachable) | Health overview: login activity, product adoption, NPS feedback, overall health; workflow triggers for login and revenue (Mar 2026) | NOT FOUND | G2 shows zero reviews (VERIFIED via search summary, g2.com/products/gocsm/reviews); focus is SaaS agencies, not lead handling | gocsm.featurebase.app/en/changelog |
| Hot Prospector | Dialer plus speed-to-lead, GHL-native sync | $137/$297/$497/$750 (SoftwareFinder) vs from $197 (Software Advice AU): INFERENCE, conflicting | Live dashboard: total dials, pickup rate, appointments booked, speed to lead (by agent and source per vendor); "12s" figure is a mockup | G2 4.5 from 10; Trustpilot 4.5 from 14; speed-to-lead automation | Pricing unclear until after first campaigns; wants more tutorials | hotprospector.com/speed-to-lead ; g2.com/products/hot-prospector |
| Kixie | Sales dialer | From $35 per user per month (third party, INFERENCE) | Call History Dashboard (missed vs answered, response times, rep performance); AI Insights with alerts and scheduled reports by email or Slack; speed-to-lead page claims under 20 s | Vendor claims only | NOT FOUND | kixie.com/speed-to-lead-automation-solution |
| Aloware | Sales dialer | $30/$60/$85 per user per month annual (third party, INFERENCE) | Reporting dashboards on uPro tier; no speed-to-lead report found | NOT FOUND | GHL link is "Zapier or API" per a competitor (Hot Prospector), unverified | hotprospector.com/aloware-alternative |
| Chili Piper, Convoso, Lead Source | Routing and dialing | Price NOT FOUND | Home screens NOT FOUND this session | NOT FOUND | NOT FOUND | none |
| ghladmin (Growthable) | GHL admin utilities | "Free to start" (docs/DEEP_RESEARCH.md, vendor) | Location comparison, stale-deal board (vendor) | NOT FOUND | NOT FOUND | growthable.io/tools/ghladmin/ |
| AgencyAnalytics | Client reporting suite | Core about $25 per client per month, $20 annual (May 2026, third party); older $79 and $239 plans | Dashboards, automated reports, AI summaries, metric alerts and goals (older Agency plan) | G2 about 4.7, Capterra about 4.8 from about 115: clean dashboards, automated reports, fast chat support | Limited data in some integrations, a LinkedIn connector broken over a week, UI redesign confusion | agencyanalytics.com/integrations/highlevel ; capterra.com/p/158746/Agency-Analytics/reviews/ |
| Databox | Dashboards and scorecards | Free plan (3 sources, 1 dashboard); paid about $64 to $399 per month, sources conflict | Scorecards, goals, metric anomalies and smart alerts on higher tiers; no daily digest found | Scorecards | NOT FOUND | capterra.com/p/154024/Databox/pricing/ |
| DashThis | Dashboards for agencies | $49 (3 dashboards), $159 (10), $264 to $309 (25) per month (third party) | Report dashboards | NOT FOUND | NOT FOUND | reportingninja.com/blog/dashthis-pricing |
| Whatagraph | Reporting | Go from $286 per month; Max from $812 (a competitor's page, INFERENCE) | Cross-account "spot campaign problems before your clients do" PPC monitoring agents | NOT FOUND | NOT FOUND | whatagraph.com/ai-agents-for-marketing/ppc-monitoring |
| Geckoboard | KPI wall dashboards | Essential $44, Pro $87, Scale $615 per month (Mar 2026, third party) | TV-style KPI dashboards | NOT FOUND | Free plan removed for new signups | capterra.com/p/153066/Geckoboard/pricing |
| Klipfolio, Looker Studio templates | BI dashboards | Klipfolio $49 to $249 or from $99, sources conflict; Looker Studio free | Not researched in depth (NOT FOUND) | NOT FOUND | NOT FOUND | none |
| Two Minute Reports | Reporting from GHL into Sheets, Looker Studio, native dashboards | About $8 to $9 per month lite, $49 basic (third party) | Scheduled delivery, "real-time reporting alerts" | NOT FOUND | NOT FOUND | twominutereports.com/integrations/gohighlevel |
| TrueClicks (ad-account monitor, adjacent) | Cross-account PPC monitoring | NOT FOUND | "50+ daily monitoring checks", alerts when an account or tracking goes down (vendor claim) | NOT FOUND | NOT FOUND | search summary only |

Not found: the "Today" or "inbox" home screens of Chili Piper, Convoso and Lead Source; per-app review text on the GHL marketplace; install counts for any app except All The Apps.

## 3. What agency owners do and say

All short phrases below are as returned in search summaries of the named page. NOT FOUND: any direct Reddit, Facebook group or YouTube quote.

- Cross-account view is a long-standing ask on GHL's own ideas board. Phrases: "quick-glance review of all client (subaccounts) stats" (highlevel.canny.io/reporting/p/master-dashboard-for-all-subaccount-stats); "dashboards that report on stats for individual subaccounts, available at a glance, at an agency level" (ideas.gohighlevel.com/reporting/p/subaccount-reporting-from-agency-level); "identify under performing accounts" (a post found via search on the same topic; exact URL not shown). "some of our users have 3+ logins just to be able to view multiple sub-accounts" (canny/ideas post, URL not shown). VERIFIED that the posts exist; votes unread.
- Inactivity: "ability to see user activity" and "Live User Status & Last Seen for Sub-Accounts" requests; a commenter says it would show "whether a sub-account is effectively dormant" (ideas.gohighlevel.com/users-permissions/p/ability-to-see-user-activity). VERIFIED that it exists; no shipped alert found.
- Unified inbox: "UniBox for ALL Sub-Accounts" and "View multiple sub account inboxes in one place" exist (ideas.gohighlevel.com/conversations/p/unibox-for-all-sub-accounts-pls). Earlier docs say only about 6 votes each, so weak demand (docs/DEEP_RESEARCH.md, not re-checked).
- Blame cycle with clients: "The client complains about lead quality. The agency blames targeting." and "agencies rely on the client to report back on how they managed each lead, which they rarely do" (callrail.com/blog/stop-ghosting-your-agency-leads and vendor blogs; vendor sources, INFERENCE as demand).
- GHL agency blog: leads "sat until a busy tradesperson checked their phone, often hours later" (pivot2thrive.com.au/post/speed-to-lead-gohighlevel-agencies-2026; agency blog, INFERENCE).
- Morning routine (adjacent, PPC agencies, not GHL): "usually check every morning to see how everything went the day before, nothing too in depth" (Moz Q&A forum, mozdev.nodebb.com/community/q/post/21298); morning check as "an exception check" with a "control panel that points to where to look" (eshopset-com.pages.dev); "3 to 5 alerts per account" (optmyzr.com/case-studies/ppc-pros/). A GHL operator describes a roughly 10-minute morning look at active automations plus a Monday per-account review (hmx-zone.vercel.app/blog/gohighlevel-sub-accounts-manage-13-clients; one blog, INFERENCE).
- What they would pay for: NOT FOUND as a direct statement. The only price evidence is behaviour: agencies already buy GoCSM, AgencyAnalytics, per-sub-account add-ons ($49 client-portal add-on per one third-party guide). INFERENCE.

## 4. Gaps we can own on Today (max 6)

1. **Lead-handling outcomes across accounts on one screen.** Native SLA reporting is per account (freshdesk 155000008084, 155000007658) and the roll-up shows activity counts, not response time or show rate (article 48001224166). No competitor row above shows it. INFERENCE (marketplace not browsable).
2. **Roll-up without the $497 plan.** Official article ties Agency View controls to $497 and above. An agency on $297 gets no cross-account view natively; we can serve them. INFERENCE (a third party says all plans; conflicting).
3. **An exception list, not charts.** Adjacent sources describe the morning check as short and exception-based, and cap alerts at 3 to 5 per account. Reporting tools (AgencyAnalytics, Databox, DashThis, Geckoboard) lead with charts. INFERENCE.
4. **Proof for the client conversation.** The "lead quality" blame cycle has no tool that shows "your team did not touch these 14 leads". Today can link each flagged item to evidence (lead, time, nobody touched). INFERENCE from vendor blogs.
5. **Health scoring misses lead handling.** GoCSM scores logins, adoption, NPS and billing (changelog June 2025, Mar 2026), none of which says whether leads were answered. We complement it. VERIFIED (changelog via summary).
6. **Setter view of the same screen.** Kixie and Hot Prospector show rep performance inside their dialers; nothing found shows a per-user "my unanswered leads" queue read from GHL data without moving the team to a new dialer. INFERENCE.

## 5. Features customers would pay for (ranked, max 8)

Evidence for willingness to pay is indirect (see section 3). Ranking is by evidence strength x fit with the wedge. Effort S/M/L.

| # | Feature | Why (evidence) | Effort | Reuses |
|---|---|---|---|---|
| 1 | "Needs action now" ranked list across accounts: leads past SLA with no touch, with count, oldest age, deep link | Gap 1 and 3; exception-first morning check | M | lead_touches, cached_conversations, alerts |
| 2 | One-row-per-account lead-handling scorecard: median first response, SLA %, unanswered count, arrow vs last week, sorted worst first | Native roll-up lacks these (gap 1); Hot Prospector and Kixie sell the same numbers per account | M | lead_touches, account_metrics_daily |
| 3 | Appointments with no outcome plus no-shows not rebooked (7 days) | "Reports lie when staff forget" is our wedge; Hot Prospector tracks appointments booked, not unmarked | S | cached_appointments, appointment_events |
| 4 | Short morning brief email (top 5 items, "all clear" when none), Slack later | Kixie sends scheduled alerts by email or Slack; owners want short scan | M | alerts, account_metrics_daily |
| 5 | "Fixed since yesterday" strip (alerts resolved, outcomes recorded) | Proof for the agency; feeds weekly Receipts | S | alerts, appointment_events, deal_events |
| 6 | Stale-deal value per stage with minimum-data guard | GHL pipeline view is per account; avoids duplicate-dollar tiles trap | S | cached_opportunities, deal_events |
| 7 | Setter "my queue" for client-account users (own unanswered leads only) | Gap 6; Wave 1 item 4 | M | lead_touches, cached_conversations |
| 8 | Client-safe one-tap weekly summary (read-only, per account) | Blame-cycle evidence (gap 4); Receipts in Wave 1. Client portal links are DEFER in the brief, so keep it a summary, not a portal | M | account_metrics_daily, alerts |

## 6. What NOT to build (crowded or risky)

- Chart-heavy report builder, white-label PDF reports, TV KPI walls: AgencyAnalytics, Databox, DashThis, Whatagraph, Geckoboard, Two Minute Reports and GHL custom dashboards own this (section 2). Already DEFER in the brief.
- A dialer, power dialer or auto-text responder: Kixie, Aloware, Hot Prospector, GHL. Also consent risk.
- Detecting a problem and auto-replying as the pitch: GHL native workflows do both. Never claim it as a differentiator (brief section 1A).
- A general health score on the Today screen: GoCSM covers logins and billing; keep Today to lead-handling outcomes.
- Login and last-seen based "dormant" claims: not confirmed in the API (docs/DEEP_RESEARCH.md); use data activity and say so.
- Agency money widgets (MRR, margin): GHL's own SaaS tab and reselling widgets.
- Many tiles or one collapsed dollar figure: see the brief's metric trust rules. Cap Today at about 6 tiles.
- Benchmarks quoted as fact ("5 minutes makes conversion 9x more likely" was a vendor-page claim I could not trace to a primary source): do not put it in the UI.

## 7. Risks and unknowns

- Fetch was blocked, so every source is a search summary. Prices, ratings and features can be stale or wrong. Verify before quoting anything publicly.
- All The Apps: tier prices, Measure screen, review text, current install count not verified. If it ships sales-ops dashboards the gap narrows (brief estimates 12 to 18 months, INFERENCE).
- GHL plan gating for roll-up reporting conflicts between the official article ($497+) and third-party posts (all plans). Test in King's own agency.
- GHL could add first-response and show-rate columns to the roll-up (columns list has changed over time: WhatsApp was added). This is the main strategic risk for Today.
- No direct agency-owner payment evidence. The brief's own gate (interview 5 owners; check marketplace for "speed to lead", "response time", "no show", "SLA", "monitor") is still required.
- GoCSM has zero G2 reviews, so its real traction is unknown; its pricing is a vendor claim from earlier research.
- Reddit, Facebook group and YouTube review evidence is NOT FOUND. Ideas-board vote counts for the cross-account requests were not readable this session (earlier docs cite 70 and 109 votes for related posts and 6 for unified inbox; not re-verified).
- AgencyAnalytics pricing may have moved to per-client in May 2026 (third party only).
