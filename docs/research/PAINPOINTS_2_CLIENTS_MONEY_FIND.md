# Pain-point research 2: CLIENTS, MONEY, FIND A LEAD

Date: 2026-11-12. Method: web search plus page fetches. Labels: VERIFIED = read on the cited page; INFERENCE = my reasoning; THIN = little evidence.

## Honest caveat (read first)
- Search could not surface Reddit threads, G2/Capterra review text, Facebook or Discord content. Every search returned vendor blogs, help docs and the GHL ideas board instead. So there is NO verified Reddit evidence below. Recommend King (or a browser-driven pass) read r/gohighlevel and r/HighLevel directly before treating any "frequency" as final.
- Strongest real evidence: the GHL ideas board (vote counts, dates, agency comments) and GHL's own help docs (what native already does).
- Many blogs are vendor sales pages (churn "stats" from them are marketing, not data).
- No hard willingness-to-pay data for SubSync-style tools. Only price anchors (GoCSM, GHL plans).

## Cross-cutting facts (VERIFIED)
- GHL already has an Agency Dashboard with Summary (revenue, MRR, customers), SaaS tab (new/expansion/contraction/churned/reactivation MRR) and Reselling tab (per-sub-account revenue, cost, profit, margin). It does NOT cover failed payments or wallet metrics. SaaS Analytics needs the $497 plan and only covers subscriptions made inside GHL (not outside Stripe subs). https://help.gohighlevel.com/support/solutions/articles/155000007327-agency-dashboard-overview-summary-saas-and-reselling-metrics ; https://help.gohighlevel.com/support/solutions/articles/155000006991-understanding-monthly-recurring-revenue-mrr-in-the-agency-dashboard
- Agency-level reporting across sub-accounts: a 2025 third-party post says GHL added a sub-accounts section with six metrics (users, appointments, submissions, outreach...). https://growthable.io/new-features/agency-analytics-across-all-subaccounts-released/ (INFERENCE: partial, so the pain is "shallow", not "absent").

---

## 4. CLIENTS (agency control center)

### Top 5 pain points
1. **No single view of all client accounts' stats; agencies open each account by hand.** Idea "Master dashboard for all subaccount stats" has 70 votes (posted 2020, merged with a 2025 request). A commenter with 100+ locations says he checks each manually and the API endpoints he tried did not work. VERIFIED. https://ideas.gohighlevel.com/reporting/p/master-dashboard-for-all-subaccount-stats
2. **Cannot see which accounts are inactive or not using the product** (contacts added, emails sent) so agencies cannot spot churn risk. Same merged request (Feb 2025). VERIFIED (same URL).
3. **Agency dashboard widgets do not roll up sub-account data** ("Edit Agency Dashboard", "Agency-level view of ad performance of all subaccounts", "agency-level monthly form submissions"). Several separate requests. VERIFIED titles only; votes not fetched. https://ideas.gohighlevel.com/dashboard/p/edit-agency-dashboard ; https://ideas.gohighlevel.com/ad-manager/p/agency-level-view-of-ad-performance-of-all-subaccounts ; https://ideas.gohighlevel.com/reporting/p/agency-level-monthly-form-submission-reporting-across-all-sub-accounts
4. **Churn is noticed late.** Consultants say the earliest churn signal is a stalled onboarding milestone (calendar connected, first contact imported, first workflow live, first lead) and recommend manual weekly inactivity audits or tag-based health scores. INFERENCE for frequency (vendor/consultant blogs). https://hlgrowthpartner.com/post/gohighlevel-saas-mode-churn-reduction ; https://sawankr.com/courses/go-highlevel/is-your-agency-setup-broken-find-out-now
5. **Support staff need access to a global list of sub-accounts, but that forces full agency-level access** (permission pain). One idea on the board. THIN. https://ideas.gohighlevel.com/users-permissions/p/new-custom-agency-role-support-specialist-with-agency-tab-toggles-hipaa-safeguar

### Frequency
Pain 1 is high and long-lived (6 years, 70 votes). Others low to medium (single posts).

### What they do today
Open each account manually; export to Looker Studio/Google Data Studio; DIY pipeline or tags (Healthy / At risk); weekly audits; GHL's new sub-accounts dashboard section; paid tools: GoCSM (health score 0-100, MRR at risk, NPS surveys, login tracking). GoCSM price: one comparison site lists Pro at about $147/mo for up to 50 sub-accounts (unconfirmed; G2 lists no dollar amounts, thin reviews). https://gocsm.com/ ; https://comparebestai.com/tools/csm

### Would they pay?
MAYBE-YES. The problem is real and there is a priced competitor (GoCSM, about $3/account/month at its stated 50-account tier, INFERENCE) that sells exactly "see churn before it happens". $11.50/account is about 4x that per account. That is a risk: price is high versus GoCSM for the same "health" job unless SubSync adds money and lead-handling proof. No direct quote from a buyer found.

### Competitors and where they fail
- GoCSM: health score, MRR at risk, NPS. Built for SaaS-mode agencies only; scoring is engagement/finance, not lead-handling outcomes. Thin public reviews.
- GHL native: sub-account metrics section, but shallow (counts), no history, no risk scoring.
- All The Apps: its own measures track its own platform items, not client lead handling (from project brief).

### SubSync features that map to the pain
Accounts list with health, "at risk of cancelling" flags, activity/last-seen per account, compare accounts, marketplace apps per account, SaaS fee per account.

### SubSync features with NO evidence of pain (demote candidates)
- "Marketplace apps per account" view: no request found.
- Subscription/SaaS fee per account on the Clients screen: belongs in MONEY (the evidence is there, not here).
- Compare-accounts side by side: only implied by "check each manually"; build as a sortable table, not a separate feature.

### What SubSync already has vs the evidence
Source: docs/FEATURE_STATUS.md and src/app/app/views (clients/, cl2/, accounts.tsx). Statuses come from FEATURE_STATUS rows; where I only saw file names it is INFERENCE.

| Existing feature | Mark | Why |
|---|---|---|
| Accounts list / rollup of all client accounts (accounts.tsx, cl2) | COVERED | 70-vote "master dashboard" pain |
| Health and onboarding tabs (clients/health-tab, onboarding-tab) | COVERED | stalled-onboarding churn theory (INFERENCE) |
| Clients coming and going (Today card, client_departures) | COVERED | churn visibility; history starts only from migration day |
| Save-this-account (7 am brief) | COVERED | at-risk idea |
| Silent-account alert (0 contacts/messages in N days) | GAP | Feb 2025 request; confirm not already in alerts |
| Roll-up for 100+ accounts with export | GAP (check scale) | 100+ location commenter |
| Fees per account, Compare, Reviews/QBR (flag `reports` OFF) | SURPLUS | no pain found; QBR already DEFER |
| Marketplace apps per account | SURPLUS | no request found |
| Industries tab | SURPLUS | no request found |

### 3 missing features that evidence suggests would sell
1. **Silent-account alert**: "account X added 0 contacts and sent 0 messages in 14 days" (directly the Feb 2025 request). Cheap from our event store.
2. **Onboarding ladder per new account** (calendar connected, first contact, first workflow, first lead, first appointment) with "stuck at step N for 7 days" alert. Matches the consultant churn theory. INFERENCE it prevents churn.
3. **Rolled-up agency table with 100+ accounts, sortable, with one export**: replaces the "open each account / Looker Studio" routine (70-vote idea).

---

## 5. MONEY (agency revenue, churn, failed payments, wallet)

### Top 5 pain points
1. **Agency absorbs usage costs when a client's card fails or the account is paused** (phone, A2P, dedicated IP, call storage, AI subscriptions). Agencies must turn off each service by hand; missing one means the agency pays. Idea posted June 2026, 5 votes. VERIFIED. https://ideas.gohighlevel.com/saas/p/auto-stop-all-sub-account-charges-when-recharge-fails-or-account-is-paused
2. **Wallet hits $0 and scheduled messages fail because auto-recharge is slow**; people want a $1 trigger and agency-level default rules. 19 votes; commenters from Jan 2025 and Jan 2026 say the same. VERIFIED. https://ideas.gohighlevel.com/saas/p/fix-message-failures-due-to-wallet-balance-reaching-0-this-is-the-default-settin
3. **Failed payment pauses the client account immediately with no warning to the customer**; fix is Stripe emails outside GHL. 11 votes, Aug 2026. VERIFIED. https://ideas.gohighlevel.com/ad-reporting-and-attribution/p/native-customer-facing-payment-failure-notifications-for-saas-sub-accounts
4. **Reporting gaps in GHL SaaS analytics**: no failed-charge/subscription report request (posted), ProfitWell-style churn and cohorts (2 votes only), subs created outside GHL are not counted, past-due subs still count as MRR until cancelled. VERIFIED for the docs facts; votes low. https://ideas.gohighlevel.com/invoice/p/reporting-dashboard-for-payments-subscriptions-etc ; https://ideas.gohighlevel.com/reporting/p/replicate-profitwell-mrr-churn-reporting-for-saas-agencies-and-subscriptions-in ; https://help.gohighlevel.com/support/solutions/articles/155000006991-understanding-monthly-recurring-revenue-mrr-in-the-agency-dashboard
5. **Rebilling and surprise usage**: agency wallet funds usage first and recovers it later; free credits given to clients are charged to the agency; markup rebilling only on the $497 plan; rebilling can silently fail (no card, wrong plan, disabled product); recharge can fall back to other cards on file. Guides tell agencies to reconcile wallet history by hand. INFERENCE for frequency (guides, not complaints). https://www.seldonframe.com/guides/gohighlevel-wallets-and-rebilling ; https://help.gohighlevel.com/support/solutions/articles/48001207115-saas-wallet-credit-management-sub-account-level

### Setter/closer payouts
No evidence found. THIN. Do not treat as proven.
### Refunds and disputes, late invoices
Only "invoice reporting at agency level with custom date range" idea seen (title only). THIN. https://ideas.gohighlevel.com/invoicing/p/invoice-reporting-at-agency-sub-account-level-with-custom-date-range

### Frequency
Wallet and failed-payment pains: medium-high (multiple posts in 2025 to 2026, 5 to 19 votes each; vote counts are small in absolute terms). MRR reporting: medium (native exists; gaps are edge cases).

### What they do today
Stripe dunning emails; manual disconnecting of services; set high auto-recharge amounts; manual wallet transaction reconciliation; GHL SaaS Analytics (needs $497 plan); ProfitWell/Baremetrics for subs outside GHL. Dunning/churn-recovery services are sold by vendors (price not found).

### Would they pay?
MAYBE. Money-protection ("don't let me pay for a deadbeat client") has the clearest ROI story: an unpaid phone/AI bill is real dollars. No price evidence for a standalone tool. The question is whether the data is available: SubSync is read-only, and wallet and failed-payment data may not be exposed by the API (CHECK; brief item 13.8).

### Competitors and where they fail
- GHL native: MRR/churn MRR only; no failed-payment or wallet metrics in the dashboard doc; no alerts.
- GoCSM: "revenue intelligence" (Feb 2026 changelog), MRR at risk. https://gocsm.featurebase.app/changelog/rocket-gocsm-revenue-intelligence-now-live
- ProfitWell/Baremetrics: Stripe-only, not GHL wallet-aware.

### SubSync features that map
Failed-payment and past-due list, accounts with low wallet, cost-vs-revenue per account (margin), churn watch.

### No evidence of pain (demote candidates)
- Setter/closer payouts.
- Refund and dispute tracking.
- A full MRR dashboard duplicating GHL's (native already has it; only add what it lacks).

### What SubSync already has vs the evidence
Source: FEATURE_STATUS rows for Finance (fn/), Wallet guard (wg/), 7 am brief. All flags default OFF; tested on a local DB only; no live data yet.

| Existing feature | Mark | Why |
|---|---|---|
| Wallet guard (balance readings, alerts) | COVERED, unverified | wallet $0 failures (19 votes); platform call not yet probed with a real token |
| Finance: MRR (daily snapshot) | COVERED, partly duplicate | native has MRR; our daily history adds what native lacks |
| Finance: churn | COVERED | churn reporting gap (low votes) |
| Finance: revenue, ledger | SURPLUS (lean) | native Reselling tab already shows revenue/cost/profit per account |
| Finance: payouts (setter/closer) | SURPLUS | no evidence found |
| Payments line in 7 am brief | COVERED | failed-payment pain |
| Loss-guard: usage still running after failed recharge or pause | GAP | June 2026 idea; highest money case |
| Margin per account incl. free credits | GAP | rebilling mechanics (INFERENCE) |
| Failed-payment recovery board with days past due | GAP | 11-vote no-warning idea |

### 3 missing features that evidence suggests would sell
1. **Loss-guard alert**: "account X: recharge failed / account paused / wallet near $0 while paid usage still running, estimated $/day leak" (ideas 1 and 2, VERIFIED pain). Highest money case.
2. **Margin per account**: what the account costs us (usage incl. free credits) vs what it pays; flag accounts losing money. Backed by the rebilling mechanics (free credits on the agency, failed rebilling falls to agency).
3. **Failed-payment recovery board**: past-due accounts with days past due, amount, and a copy-ready reminder (we do not message; the agency does). Pairs with the 11-vote "no warning to customer" gap.

---

## 6. FIND A LEAD (search, going cold, call lists, reactivation)

### Top 5 pain points
1. **No cross-account contact search.** Contacts live per sub-account and do not sync. Global Search V2 is a Labs feature documented at the sub-account level; its help page does not say it spans accounts. Agencies loop per account or write scripts. VERIFIED for the docs, INFERENCE that agencies want it. https://help.gohighlevel.com/support/solutions/articles/155000008323-global-search-v2 ; https://consultevo.com/gohighlevel-copy-contacts-between-sub-accounts/
2. **Sharing and copying contacts between sub-accounts is manual** (requests: "Sharing Contacts between Sub Accounts", copy without automations, share smart lists across sub-accounts). Votes not fetched. THIN-MEDIUM. https://ideas.gohighlevel.com/contacts/p/sharing-contacts-between-sub-accounts ; https://ideas.gohighlevel.com/smartlists/p/build-once-deploy-everywhere-share-smart-lists-across-sub-accounts
3. **Database reactivation is a hot, sold service** but lists need heavy scrubbing first (DND, abandoned), age filtering, and source/product filters; reactivation rates fall past roughly 2 years. Many Fiverr/Contra/Skool offers and one case with 800 cold leads (11% re-engaged, self-reported). VERIFIED that the market exists; effect sizes are vendor claims. https://contra.com/p/lsbllQML-voice-ai-reactivates-800-cold-leads-11percent-re-engaged ; https://www.skool.com/gohighlevel/database-reactivation-question-2
4. **Searching conversation text is weak** (idea: search past conversations for specific text; global search across every field). Votes not fetched. THIN. https://ideas.gohighlevel.com/conversations/p/search-past-conversations-for-specific-text ; https://ideas.gohighlevel.com/crm/p/global-search-function-ability-to-search-every-field-in-every-object-module
5. **Call lists / going-cold lists are hand-built smart lists** (age, source, stage). No complaint found, only DIY guides. THIN.

### Frequency
Reactivation: high as a service category. Cross-account search: low-medium evidence of demand (no vote-heavy post found).

### What they do today
Smart Lists with filters, workflows (native), outside tools (dialers, AI voice reactivation vendors), per-account loops and scripts, paid reactivation freelancers.

### Would they pay?
MAYBE-LOW as a SubSync module. People pay for outcomes (reactivation done-for-you), not for search. Search alone is a feature, not a product. Value rises only if tied to "money found" (cold deals with value, no-shows not recovered). No price evidence for a search tool.

### Competitors and where they fail
GHL smart lists (per account, no cross-account), dialers (Kixie, Aloware, etc.), AI voice reactivation vendors. SubSync must not send (brief rules), so it can only produce the list and open it in the CRM.

### SubSync features that map
Cross-account search, going-cold list, tag/source filters, call list, "bulk reactivation" (list only).

### No evidence of pain (demote candidates)
- Bulk call and bulk reactivation inside SubSync (we cannot send; agencies buy this elsewhere). Keep as export or hand-off only.
- Tags and sources as separate screens (only useful as filters).

### What SubSync already has vs the evidence
Source: FEATURE_STATUS (Contact search, Call lists, Leads, Today email leads, Bring back); views people-*.tsx, leads.tsx, global-search.tsx, quiet-deals.tsx, dial-*.tsx.

| Existing feature | Mark | Why |
|---|---|---|
| Contact search / global search | COVERED | no native cross-account search; verify ours spans accounts for agency role |
| Leads: cold lists, engaged-then-quiet, missing vs invalid (50,958 of 52,926 on cold lists, real data) | COVERED | reactivation market is real; scrub-first need |
| Quiet deals | COVERED | stale-deal money angle |
| Today: Email leads list + CSV (no DND, audited) | COVERED | matches reactivation-ready export |
| Call lists (smart lists, no-show list) | COVERED, weak evidence | only DIY guides |
| Dollar-ranked cold money list, cross-account | GAP (verify) | strongest sell; confirm value-ranked ordering exists |
| Dial mode / dial queue (dial-*.tsx) | SURPLUS | dialers owned by competitors; no pain evidence |
| Bulk reactivation inside SubSync | SURPLUS | we cannot send; keep export/hand-off |
| Duplicates / cleanup hub | SURPLUS | already DEFER; no pain found |

### 3 missing features that evidence suggests would sell
1. **Cold money list**: leads/deals with value that went quiet N days, ranked by dollar value, per account and agency-wide, with DND excluded and open-in-CRM link (matches reactivation demand and scrub-first pain).
2. **One-box search across all accounts** by phone/email/name (answers "which client account is this person in" for agency support staff; fixes the per-account loop), with role limits.
3. **Reactivation-ready export**: scrubbed list (no DND, no active deals, age band, source) as CSV for the agency's own workflow or dialer; shows count and estimated value before export.

---

## Verdict summary

| Module | Pain | Will pay | Note |
|---|---|---|---|
| CLIENTS | Medium-high | Maybe-yes | 70-vote idea, priced competitor GoCSM; price pressure at $11.50 |
| MONEY | Medium-high | Maybe | Best ROI story is loss-guard; API data availability must be checked first |
| FIND A LEAD | Medium-low | Maybe-no as a standalone | Sells only as dollar-ranked cold list |

## Top 3 build recommendations (money first)
1. Loss-guard and margin per account (failed recharge/paused account with running usage; negative-margin accounts).
2. Silent-account and stalled-onboarding alerts feeding a rolled-up all-accounts table (70-vote request; our event store gives history GHL lacks).
3. Cold money list ranked by dollar value with cross-account search as its entry point.

## Evidence gaps to close
Read r/gohighlevel, r/HighLevel and GHL Facebook groups manually; G2/Capterra text for GHL; All The Apps reviews (none found); confirm via live API whether wallet balance, usage and failed-payment data are readable with our scopes.
