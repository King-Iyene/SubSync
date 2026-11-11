# Improve round 1: research, learn, improve, every module (11 Nov 2026)

Scope: Speed to lead (with Unanswered), Pipeline, Clients, Team, Today (with Numbers), Account audit, Payments (planned). Appointments is covered elsewhere.
Method: read each module brief, R-files and screens in `src/app/app/views/` (ap3, cl3, pl3, pp3, today*, audit*, speed*, unanswered*), plus 3 web searches today. Labels: VERIFIED = read on a page or in our repo; INFERENCE = my reasoning; UNVERIFIED = blog or snippet only. Tags: $ money, C customer, I innovation. "Data: yes" = buildable with data we already hold or read on granted scopes.
Honest limits: Reddit, forums, GHL ideas board and the marketplace were not reachable; customer voice is from earlier R-files. Web results today were mostly blogs.

## Fresh web facts used across modules
- GHL 2026 dashboard additions: a Reselling tab (usage per account), AI spend dashboard with caps, Marketplace Earnings under Labs. UNVERIFIED (blogs): https://rsla.io/blog/gohighlevel-updates-2026 , https://www.softomatesolutions.com/blog/gohighlevel-updates-2026-release-notes/ . No response-time report or failed-payment view found on the agency dashboard (UNVERIFIED, absence in blogs only).
- AgencyAnalytics now lists goals, alerts, anomaly detection, MCP access for AI tools and a client portal; per-client price about $20 to $25 (UNVERIFIED, conflicting pages): https://dashthis.com/alternatives/agency-analytics/ , https://www.agencyanalytics.com/pricing . Direction: competitors move to alerts plus AI. Our edge stays lead-handling outcomes and our own history.
- Pipedrive "rotting" is per-stage days with no activity, no default notifications; HubSpot stale filter and time-in-stage reports exist (UNVERIFIED, one blog): https://crmnewstoday.com/pipedrive-rotting-deals-stop-leads-going-cold/ . Per-stage stale is now table stakes; our edge is cross-account and "stale since when" from our history.
- GHL facts from repo R-files (VERIFIED, cited there): only LAST stage/status change time is stored; no per-deal history; forecast is per account and off by default (Labs); SLA dashboard and "User Replied" trigger exist per account; flat user model, no cross-account people view; SaaS API gives status and plan but no next charge date or failure reason.

---

## 1. Speed to lead (incl. Unanswered)
**1. Others do now.** GHL: per-account SLA timers, admin SLA dashboard, "User Replied" wait step, unread view (VERIFIED in UNANSWERED_RESEARCH_SUMMARY). Dialers (Kixie, Aloware, PhoneBurner, Close) give auto-dial on new lead, voicemail drop, response-time reports, round-robin routing (VERIFIED vendor pages, SPEED_COMPETITORS). Gap vs us: none cross-account, none keeps proof.
**2. Pains still missed, by money.** (a) Ownerless leads nobody owns (99 votes, VERIFIED): we show them but cannot assign without write switch. (b) "Client blames bad leads": need a one-page "leads were answered in X min, here is proof" per client. (c) After-hours and weekend leads: no coverage view by hour. (d) Spam inflating "unanswered" (811 votes on GHL, being fixed natively). (e) Setter blamed for bot/automation replies.
**3. Data unused.** Held: touch_events, lead_events, speed_daily. Unused: hour-of-day x weekday coverage heat map per account; lead source to response time; call duration if call records carry it (CHECK); missed-call vs form lead. NOT available: reply for leads older than 14 days, call audio, user logins.
**4. Top 8.**
1. Per-client "Response proof" one-pager (median, P90, SLA %, trend, no names), shareable. S-M, $, data yes.
2. Alert "SLA fell from 92% to 61%" in the 7 am email with the 3 accounts and 3 setters behind it. S, $, yes.
3. Coverage heat map (hour x weekday, share of leads touched in SLA). M, $ C, yes.
4. Source-to-response table ("Facebook leads wait 4x longer than website"). M, $ I, yes.
5. Assign-owner action through gateway with preview (ownerless leads). M, $ C, yes (needs write switch).
6. Cost-of-delay estimate per account using the account's own close rate by response bucket (min-data rule). M, $ I, yes once 90 days of history.
7. Setter fairness: exclude leads outside their shift or never assigned from their score. S-M, C, partly (shift unknown, NOT available).
8. Digest of "newly late since yesterday" with a one-tap Call mode start. S, C, yes.
**5. Customer's-eye risks.** Two lists, "Speed" and "Unanswered", with different counts for what looks like one idea: add one line "why these differ". Automated touches setting is jargon: say "Count automatic texts as a reply?". Empty state for a new account with no history must say "history starts <date>", not zero. Slow first screen on big accounts (keep the 2 s rule). Setters see a score with no coaching: add "what to do" line.

## 2. Pipeline and deals
**1. Others do now.** GHL: 17 opportunity widgets, Lost by reason, optional forecast with expected close date and hygiene flags, stale-opportunity workflow trigger based on last edit (VERIFIED R1). Pipedrive: per-stage rotting; HubSpot: time-in-stage reports, deal stale filters (UNVERIFIED blog above). None cross-account.
**2. Pains by money.** (a) Deals rot silently; owner finds out at month end. (b) Lost reason empty so nobody learns. (c) Forecast numbers owners do not trust (junk and test deals). (d) Deals with no owner or no value. (e) "Booked but never won" leaks between appointments and deals.
**3. Data unused.** Held: deal_history (our event store), per-stage dwell, appointment join by contact. Unused: lead source to won rate and cycle length; lost-reason trends; value changes (OpportunityMonetaryValueUpdate webhook). NOT available: stage history before install, previous stage in webhook (CHECK), real revenue collected (payments scope not granted).
**4. Top 8.**
1. "Rotting since" per deal using our history plus a weekly "N deals will go stale this week" early warning. S-M, $, yes.
2. Lost-reason nudge: list of lost deals with no reason, bulk "set reason" with preview. S, $ C, yes (write).
3. Booked-to-won funnel per account joined to Appointments. M, $, yes.
4. Weighted forecast with range and "not enough data" guard, labelled Estimate. M, $, yes after history builds.
5. Source ROI: won value by lead source. M, $, yes.
6. Owner workload and "deals per person aging" feeding Team. S, $ C, yes.
7. Outlier panel (single deal over 40%) with the capped-value note shown once, not on every tile. S, C, yes.
8. Reopen detector (won to open, lost to open) so reports do not shift unseen. S, I, yes via history.
**5. Customer's-eye risks.** Ten tabs is a lot: default to Overview and Needs attention and hide the rest behind "More" until data exists. Tabs that need history (Stage history, Forecast) show empty for weeks: say "history starts <date>, N days to go". Stale rules per stage need a first-run explainer ("we learn your normal pace; until then we use 14 days, marked assumed"). Dollar tiles must reconcile with Today numbers.

## 3. Clients (client accounts)
**1. Others do now.** GHL agency dashboard (Q1 2026) shows account activity, wallet balance, ticket volume; Reselling tab for usage billing (UNVERIFIED blogs). GoCSM scores health from logins and billing (INFERENCE). AgencyAnalytics gives client portals, goals and alerts.
**2. Pains by money.** (a) Churn: owner learns a client is unhappy or unpaid late. (b) Which accounts cost more than they pay (usage, AI spend, wallet empty). (c) Onboarding stalls: account installed but nothing connected. (d) No proof pack at renewal time. (e) Wallet runs out so lead messages stop.
**3. Data unused.** Held: location sync status, health and activity per account. Unused: wallet balance (`wallet.readonly`, VERIFIED CLIENTS_V2_R1), SaaS plan and status via `saas-locations` (our current call is buggy: missing `companyId`, wrong version header, shows "Needs permission: reconnect" wrongly). NOT available: next charge date, failure reason, last login.
**4. Top 8.**
1. Fix the plan/billing call (companyId, v3, saas-locations bulk) and show the real reason. S, $ C, yes. This is a bug first.
2. Wallet low or empty alert per client ("messages will stop"). S, $ C, data: needs `wallet.readonly` (check scope held).
3. Churn-risk list: low Speed score + falling activity + past-due plan, ranked. M, $ I, yes after fix 1.
4. Margin view: paid plan price vs our $11.50 and wallet usage (agency sees profit per client). M, $, partly.
5. Client account page with Proof block (links to response proof, show rate, receipts). M, $ C, yes.
6. Onboarding checklist per new account (installed, synced, first alert, first receipt). S, C, yes.
7. Renewal-ready export: one-page "last 90 days" per client. M, $, yes.
8. Quiet-account detector (no new leads in N days vs its own normal; may be an ad problem, label as such). S, I, yes.
**5. Customer's-eye risks.** "Needs permission: reconnect" is the worst dead end: owner will reinstall for nothing; show real cause. Rows that only link out to the CRM feel like a dead end: open an in-app page first. "Plan" is ambiguous (our plan vs the plan they sell); use "Paid plan you sell". Do not show people/quiet members here (Team owns them).

## 4. Team (people)
**1. Others do now.** GHL Agent Reporting per user per account (calls split by manual/automation/dialer, SMS/email stats, appointment report by user), flat Admin/User roles, no team hierarchy, no cross-account leaderboard (VERIFIED/UNVERIFIED in PEOPLE_R1; ideas board asks for setter comparison cards). Close has leaderboards; Kixie sells coaching.
**2. Pains by money.** (a) Which setter is the problem, with fair comparison. (b) Overloaded vs idle people, rebalance. (c) Pay and bonus disputes over who set which appointment ("appointment: who set it" request). (d) Setter leaves, leads sit unowned. (e) Burnt deals by one closer.
**3. Data unused.** Held: location_users, touch_events, appointment_history, deal_history. Unused: per-user conversion chain lead to touch to booking to show to won; user's lead mix (hard vs easy sources) for fair scoring; call dispositions. NOT available: last login, online status, shift hours, per-user activity feed.
**4. Top 8.**
1. Fair score: compare setters on the same source and hour mix (normalised). M, I $, yes.
2. "Who set it, who showed, who closed" attribution table for bonuses (exportable). M, $, yes (appointment creator CHECK).
3. Overload and idle flags using open items per person (no login data). S, C, yes.
4. Departing-user sweep: leads and deals still owned by a deactivated user, one-tap reassign preview. S-M, $, yes (write).
5. Setter's own page (my queue, my score, my fixes today). M, C, yes.
6. Coaching line per person ("slowest after 6 pm: 41 min") from heat map. S, C I, yes.
7. Cross-account person (same email in two accounts) merged view. M, I, yes.
8. Weekly team receipt email to the account admin. S, $, yes.
**5. Customer's-eye risks.** Two nav ideas: "Team" vs "Find a lead" must read clearly; label change only partly done. A score without a reason makes setters defensive: show the one-line why. Users the API calls deleted or without roles can appear as raw ids: resolve names (exists) and mark "removed user". Never rank a person on fewer than a minimum of leads (shows "not enough data").

## 5. Today (incl. Numbers / old Overview)
**1. Others do now.** AgencyAnalytics and Databox: dashboards, goals, alerts, anomaly detection; GHL: per-account dashboards and agency roll-up with custom widgets; nobody ranks "do this first" across accounts or keeps "fixed" history (TODAY_R1, INFERENCE).
**2. Pains by money.** (a) Daily exception scan across many accounts. (b) "What are we paying for?" at renewal. (c) Silent automation failure. (d) Manual monthly report copy-paste.
**3. Data unused.** Held: every finished module's rollup, event store. Unused: ledger of what got fixed and when (median time to fix); per-module "new since yesterday" deltas; module counts for Payments/Workflows once built. NOT available: ad spend, collected revenue, user logins.
**4. Top 8.**
1. Rebuild Today as ranked list (max 5) with ONE big button and money-at-risk ordering (brief done, build). L, $ C, yes.
2. 7 am email = same list, one button, quiet days. M, $, yes.
3. "Done today / fixed since yesterday" ledger from event store. M, $ I, yes.
4. Weekly receipt per client (found, fixed, open, median fix time), branded. M, $, yes.
5. Numbers tab capped at 6 tiles, each opens rows; Overview redirect. S, C, yes.
6. Tile delta vs last week with "history starts" guard. S, C, yes.
7. Per-role view: owner all accounts, admin one, setter own queue. M, C, yes.
8. Snooze or "known issue" on an item for N days so the list stays honest. S, C, yes.
**5. Customer's-eye risks.** Numbers that disagree with their module (biggest trust killer); read rollups only. $2.4M repeated on three tiles (known from CLAUDE.md 13A). Report-hub tabs (Growth, Forecast, Sources) bury the action: keep them under Numbers. All-clear state must say what was checked, or it looks broken. Time zone wrong at 7 am email.

## 6. Account audit
**1. Others do now.** Free audit tools look at ads and sites, not CRM data; consultants sell manual workflow audits at about $150 to $500 per month (INFERENCE, AUDIT_R1/WORKFLOWS_COMPETITORS). GHL has no "what is wrong" page.
**2. Pains by money.** (a) Salesperson needs a hard number to open a client talk. (b) No baseline at install, so no before/after. (c) One-off audit forgotten. (d) Estimate looks invented.
**3. Data unused.** Held: audit counts per run (not stored yet). Unused: history of runs (planned au_runs). NOT available: pre-install audit (no token), replies older than 14 days, payments, ads.
**4. Top 8.**
1. Store every run append-only with rules version (moat first). S, $ I, yes.
2. Baseline at install, auto-run on new location. S, $, yes.
3. "Then vs now" per finding with min-sample rule. M, $, yes after 1.
4. Branded client one-pager (counts only, no names, expiring revocable link). M, $, yes.
5. Monthly re-audit email "better / worse". S, $, yes.
6. Prospect mode: audit the agency's own trial client first and offer a 14-day trial instead of pre-install (platform limit). S, $, yes.
7. One-tap fix per finding that deep-links to the module (Speed, Appointments, Pipeline). S, C, yes.
8. Estimate range with sample size shown next to it. S, C, yes (exists partly).
**5. Customer's-eye risks.** Two money figures (counted vs estimate): keep separate lines. A share page that leaks lead names or another account would end trust: test it. "Not checked" for old leads must appear as a plain line, not an empty row. A first run on a huge account looks stuck: keep the progress bar.

## 7. Payments (planned; PAYMENTS_BRIEF, PAYMENTS_R1)
**1. Others do now.** GHL has invoices, transactions, subscriptions and a SaaS billing view per area; Stripe dunning handles retries (INFERENCE); no cross-account recovery queue found (UNVERIFIED). AgencyAnalytics does not touch CRM payments.
**2. Pains by money.** (a) Client stops paying and cash does not arrive: found late. (b) Failed card on a client's customer. (c) Late invoices at a client. (d) Wallet empty, usage unbilled. (e) Refund spikes.
**3. Data unused.** Not yet used: `payments/transactions.readonly`, `payments/subscriptions.readonly`, `invoices.readonly` (VERIFIED endpoints, scopes need adding as OPTIONAL before pilots; every added scope forces re-approval, so batch with the next version). SaaS plan status. NOT available: disputes and chargebacks, next charge date, failure reason, card expiry (VERIFIED absent). Status strings are undocumented: read real rows first (CHECK).
**4. Top 8.**
1. Recovery queue ranked by amount x age (failed, late, past-due, failed subscription). L, $, yes after scopes.
2. Past-due client plan alert (needs the Clients plan fix). S, $, yes.
3. Estimated monthly recurring revenue from plan price x active accounts, labelled Estimate. S, $, yes.
4. Late-invoice derived status in account time zone. S, $, yes.
5. Probe whether SaaS charges appear on the provider location's transactions (would unlock failed SaaS charges). S, $ I, CHECK.
6. Refund and chargeback-risk tile (refunds only; disputes manual entry). S, I, partly.
7. Wallet-low alert (shared with Clients). S, $, yes.
8. "Money at stake today" line on Today. S, $ C, yes.
**5. Customer's-eye risks.** Adding payment scopes triggers a re-approve banner for every install: warn first. Wrong "failed" count if status strings are guessed: verify on real rows. Showing customer names and amounts raises privacy stakes: role-gate (setters see nothing). Do not promise disputes.

---

## TOP 20 across modules (by money impact)
1. Today as ranked list with ONE button and 7 am email (retention, the reason to open daily). L
2. Payments recovery queue (cash found before it is lost). L
3. Fix Clients plan/billing call and show past-due plans (agency revenue visibility; a bug). S
4. Per-client Response proof one-pager plus weekly receipt (justifies $11.50 at renewal). M
5. Audit history: baseline at install and then-vs-now (acquisition and proof). S-M
6. Alert "SLA fell, here are the accounts and people" in the morning email. S
7. Wallet low/empty alert (leads stop being messaged). S
8. Churn-risk list (Speed drop + inactivity + past due). M
9. Deals "rotting since" and "going stale this week" warnings. S-M
10. Departing-user sweep and ownerless-lead assign (lost leads). S-M
11. Booked-to-won funnel across Appointments and Pipeline. M
12. Source ROI (response time, show rate, won value by source). M
13. Cost-of-delay estimate from the account's own history. M
14. Client one-pager from Audit and monthly re-audit email. M
15. Fair setter score and who-set/showed/closed table for bonuses. M
16. Lost-reason nudge and bulk set. S
17. Coverage heat map (after-hours gaps). M
18. Margin view per client (price minus usage). M
19. Weighted forecast with range, min-data guard. M
20. Onboarding checklist for new accounts. S

## Cross-module links that bring customers back daily
- **Today is the only front door:** it reads each module's rollup (never recomputes) and shows one ranked list; every row deep-links into the module's exact rows. Today's "Done" ledger comes from the event store.
- **One proof page per client account:** the Clients account page holds Response proof (Speed), show rate (Appointments), deals saved (Pipeline), people (Team), plan and payment status (Clients/Payments), baseline then-vs-now (Audit). It is what the agency screenshots at renewal, and it is the weekly receipt.
- **One shared money-status function** for Clients and Payments (as the briefs already say), so "past due" is one number everywhere.
- **One alert pipeline:** every module emits events into the alert engine; the 7 am email and Today list are two views of it. Per-account mute and snooze keep it calm.
- **People link everywhere:** a person name in Speed, Pipeline or Appointments opens Team's person panel; a setter's own queue is the Today view for that role.
- **Our own history is the moat:** record first (deal_history, touch_events, au_runs, receipts), then build screens; every "then vs now" and forecast depends on days we have already recorded.

## Needs King (not blocking)
- Add optional scopes for Payments (transactions, subscriptions, invoices) and wallet in ONE GHL version bump, before pilots.
- Confirm marketplace search for existing "speed to lead / pipeline / payments" apps (UI only King can browse).
