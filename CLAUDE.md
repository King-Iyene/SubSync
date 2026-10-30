# SubSync - Master Brief v3 (long-term source of truth)

Save this as `CLAUDE.md` in the repo root. It replaces Build Brief v2 as the main instruction file.
Move the older documents into `docs/reference/` and treat them as background only:
- `SubSync_Build_Brief.md` (v2, setup details still valid)
- `SubSync_Advanced_Features.md`, `SubSync_Moat_Features.md`, `SubSync_Full_Feature_Encyclopedia.md` (idea banks, NOT a to-do list)
- `SubSync_Competitive_Intelligence_AllTheApps.md` (full research behind this brief)

Where this brief and an older document disagree, this brief wins.

---

## 0. WORKING AGREEMENT

I am King. I vibe-code with you. You are the lead engineer.

- This brief sets direction and guardrails, not every detail. Choose better structures, libraries and schemas when you find them, and tell me why in two lines.
- Make small decisions yourself. Ask me only when a choice is expensive, irreversible, or needs a login or click only I can do. One question at a time.
- Facts are labeled VERIFIED (read in a primary source), INFERENCE (reasoning, could be wrong), or CHECK (confirm in GHL docs or the live API before building on it). Never build on a CHECK item without confirming it first.
- When the GHL docs or live API contradict this brief, trust the docs and tell me.
- Keep `docs/DECISIONS.md` (date, decision, reason) and `docs/FEATURE_STATUS.md` (every feature: status, data source, tested against live data yes/no).
- When I must act in a browser (GHL developer portal, Supabase, Vercel), give me numbered steps with exact button labels and exact text to paste, and tell me what to send back.
- Never commit secrets. Never expose the Supabase service role key to the browser.
- Do not rewrite working code to tidy it. Extend it. See section 5.

---

## 1. WHAT SUBSYNC IS (and the wedge)

SubSync is a GoHighLevel (GHL) Marketplace app that shows agencies, and the businesses they serve, what is happening across their client accounts and tells them what to do about it.

**Positioning:** "Know what is happening in every client account before your client does."

**The wedge (INFERENCE from research):** sales-floor operations intelligence for appointment-driven agencies (home services, med spas, solar, real estate, coaches). It is alerts-first and action-first, not another reporting tool.

**Why this lane (VERIFIED unless noted):**
- The biggest marketplace player, All The Apps (196.6K installs, 4.7 stars from 61 reviews, $129 / $299 / $499 per month), owns white-label branding, onboarding, support desk, knowledge base, and integration connectors. Its "Measure" section tracks its own platform (add-ons, tickets, payments, SaaS subscriptions). It does not visibly track show rate, speed-to-lead, setter performance, or pipeline conversion. It does have a blank-canvas multi-location dashboard builder, so they could enter our lane (assume 12 to 18 months, INFERENCE).
- GHL's native reports already cover appointments, agent performance, pipeline, and an aggregate agency dashboard, but per account, with limited history, and reviewers call it "wide rather than deep".
- Client-facing reporting is a commodity (AgencyAnalytics at about $12 to $15 per client per month, Two Minute Reports, Looker Studio, Databox).
- Their weaknesses: complexity (1,315 features), 165 permission scopes, a support-heavy model, and a $129 entry price.

**What we win with:** alerts and queues (push, not pull), our own historical record (stage and status changes, appointment outcomes), cross-account setter and closer visibility, speed to value (Instant Audit), minimal permissions, and focus (8 to 12 outcomes done deeply, not 184 features).

---

## 2. LOCKED DECISIONS

From the GHL developer portal (King's screenshots) and GHL docs:

| Setting | Value | Status |
|---|---|---|
| Who is the target user | Sub-account | LOCKED (cannot be changed) |
| Can agency bulk install | Yes | LOCKED |
| Listing type | White-label | Chosen |
| GHL app to use | SubSync (ID 6ae2a79309eaa881c1eb419e). Do NOT use the older "KD Squares" app (ID 66be40372c3d9943f28ea0ba) | From King's screenshot. Make sure the Client ID and Secret in env vars come from the SubSync app |
| App type | Private for now (cap: 5 agencies) | Chosen |
| Who can install | Everyone (keep as set) | Decided. GHL's recommended default for maximum reach. CHECK whether it can be changed after saving |
| Billing | GHL internal billing (never an external payment page; external pages cannot be resold and cannot be switched back once internal billing is live) | Decided |
| Pricing model | Differential pricing: agency base fee plus per-client-account fee, with a free tier | Section 6 |
| Free trial | 14 days (GHL allows 1 to 90) | Decided |

Why "Everyone": the target user is Sub-account, so the businesses (client accounts) are the market. "Everyone" lets a business install SubSync itself and also lets an agency bulk install it across all its clients and resell it at a markup. It is GHL's recommended setting for reach, it reaches small accounts as well as agencies, and it keeps the setup simple.

What we give up: GHL documents the "agency base fee plus per-account fee" (differential pricing) only for Agency Only installs, so we price per client account only (section 6). We may also hit card-on-file friction on bulk installs (section 6). Both are acceptable at launch. If we later want an agency base fee, we can add a separate Agency-only listing.

---

## 3. RESEARCH DIGEST (so you do not need to redo it, but verify anything marked CHECK)

**GHL distribution and billing (VERIFIED, help.gohighlevel.com, Mar to Oct 2026):**
- Sub-account target with Agency Only install: agency pays base price plus per-sub-account price (differential pricing). Agencies can set a flat markup on the per-account part when reselling. The agency base fee is not resold.
- Pricing models: Free, Paid subscription, Paid one-time, Freemium. Free trial 1 to 90 days, once per user per app per 90 days.
- Usage-based pricing exists: billing meters (Custom Event API, dynamic price) charged through the Create Wallet Charge API. Good for AI features.
- Failed payment: 30-day grace period with automatic retries.
- Payouts through Tipalti, monthly on the 15th. **Commission: GHL's pricing help article (modified June 23, 2026) says "We currently do not deduct any commission". An earlier source I gave King said 15%. UNRESOLVED. Model both.**
- Private apps: max 5 agencies, then installs are blocked until Public or Security Review passes.

**Install events (VERIFIED, AppInstall webhook docs):** the INSTALL webhook includes `appId`, `companyId`, `locationId` (for location installs), `userId`, `planId`, `trial {onTrial, trialDuration, trialStartDate}`, `isWhitelabelCompany`, `whitelabelDetails {domain, logoUrl}`, `companyName`. For future locations added after a bulk install, `userId` and `companyId` may be missing. A "Get Installer Details" endpoint (`GET /marketplace/app/{appId}/installations`, OAuth token, scope `marketplace-installer-details.readonly`) returns installer info including plan, useful for reconciliation. **GHL does not turn features on or off. It bills, installs, and tells you the plan. Our code decides what each user gets.**

**Bulk install token flow (VERIFIED):** an agency bulk install returns `userType: Company` and `isBulkInstallation: true`. Then: (1) call Get Installed Locations, (2) mint a Location token for each installed location from the agency token, (3) listen to AppInstall for future installs and mint tokens for new locations.

**Competitor pricing anchors:** All The Apps $129 / $299 / $499 per month; HubSpot Sales Hub Professional about $100 per seat per month; AgencyAnalytics about $12 to $15 per client.

**What I got wrong earlier (do not repeat):** All The Apps is paid, not free; GHL has native appointment and agent reports; "nobody does cross-account reporting" was overstated; buyers need Unlimited or Founder plans; feature count is a weakness, not a selling point.

**Full evidence and sources:** `docs/reference/SubSync_Competitive_Intelligence_AllTheApps.md`.

---

## 4. TENANCY, IDENTITY AND ENTITLEMENTS (the most important design in this brief)

### 4.1 One app, two experiences
SubSync is one app that shows:
- **Agency view** to agency users: all of that agency's installed client accounts.
- **Account view** to sub-account users: only their own account.

Identity comes from GHL SSO in the embedded iframe (not our own login). VERIFIED (GHL "User Context in Marketplace Apps" doc): the app asks the parent window for user data (`postMessage` with `REQUEST_USER_DATA`), receives an encrypted payload, and our backend decrypts it with the app's Shared Secret (generated in the portal under Advanced Settings > Auth). The decrypted payload contains `userId`, `companyId`, `role` ("admin" or "user"), `type` ("agency" or "location"), `userName`, `email`, `isAgencyOwner` (true or false), `versionId`, `appStatus`, `whitelabelDetails`, and `activeLocation` when the user is inside a client account. CHECK: the docs' location-context example shows `type: agency` even with `activeLocation` set, so log real payloads in test installs and confirm exactly what each kind of user sends.

**Same features for everyone. Scope and permissions differ by identity. GHL does not decide this, our backend does, from the verified payload:**

| Who | How we know | What they see |
|---|---|---|
| Agency owner or agency admin | `type` agency, with `isAgencyOwner` true or `role` admin | All of that agency's installed client accounts, plus plan and billing status |
| Agency staff user | `type` agency, `role` user | Only the client accounts that user can access in GHL (CHECK the Users API for each user's location access). If we cannot verify access, show nothing until we can |
| Client account admin | `type` location, `role` admin | Only their own account (all views, alert settings) |
| Client account user (for example a setter) | `type` location, `role` user | Only their own account, limited to their own queue and performance. No settings or plan info (proposal, King can adjust) |

An agency user who is inside a specific client account (`activeLocation` set) opens that account by default and can switch to the agency view. If an agency-wide screen cannot be shown from inside a client account menu, tell King and propose the fallback (agency dashboard reached by a link or a second small listing).

Token note for "Everyone" installs: a business that installs directly gives us only a Location token, so it gets the Account view. An agency that bulk installs gives us the Company token (`userType: Company`, `isBulkInstallation: true`), and we then mint Location tokens, so the Agency view works. Support both paths.

### 4.2 NON-NEGOTIABLE security rule
**A sub-account user must never see data from any other client account. An agency must never see another agency's data.**
- Enforce on the server in one place (middleware). Never trust IDs sent from the browser.
- Derive `companyId`, `locationId`, and user type from the verified SSO payload on every request. Decide what to return from those, not from request parameters.
- Write tests with two fake agencies and several locations that try cross-tenant reads (changing IDs in requests). They must fail. Run them on every deploy.
- Add a visible audit log table of data access for support and trust.

### 4.3 Entitlements: GHL does not know features, we do
- Table `plan_entitlements`: GHL `planId` to tier name to feature flags and limits.
- Table `installations` stores `planId`, trial info, status, per company and per location.
- A single function `can(identity, feature)` decides access. Every module calls it. No feature check is scattered in UI code.
- Keep feature flags in the database so any module can be turned off per tier or globally without a deploy.
- CHECK how plan changes and cancellations are signaled (webhook event name, or reconcile by polling Get Installer Details on a schedule). Build the reconcile job regardless; webhooks can be missed.
- CHECK how the free tier works with bulk install and per-account billing (which accounts are "free" when an agency has more than 3). If GHL cannot express "first 3 accounts free", fall back to a free plan with limits enforced in our code and an upgrade prompt, and tell King.

### 4.4 Tokens
- Store the agency (Company) token and mint Location tokens on demand. Refresh tokens rotate on every use: always save the new refresh token, use a lock so two parallel refreshes cannot break the chain, encrypt at rest, never log tokens.
- On uninstall: stop syncing, delete that tenant's tokens and cached data on a defined schedule, and keep a minimal audit record.

---

## 5. ARCHITECTURE FOR STABILITY (so building does not keep breaking things)

Build a small stable core and plug features into it.

**Stable core (change rarely, test heavily):**
1. Auth and tenancy middleware (section 4)
2. Token service
3. Install lifecycle and entitlements
4. Sync engine (webhooks plus reconciliation, rate-limited queue, resumable jobs)
5. **Event store:** an append-only table where we record changes ourselves (opportunity stage and status changes, appointment status changes, first-response times, conversation assignment). GHL does not give clean history, so this is both a quality fix and our long-term data moat. Start recording now; history cannot be recreated later.
6. Alert engine (rules, thresholds per account, quiet hours, dedupe, digests; channels: in-app, email, Slack later)
7. Notification and email service

**Feature modules (plug-ins on top of the core):** each module owns its tables, endpoints, UI route, and a feature flag. A module may read from the core and event store. It may not write to another module's tables.

**Rules:**
- Additive migrations only (new columns and tables). No destructive schema change without a written plan and a backup.
- Idempotent sync and webhook handlers (the same event twice causes no double counting).
- Every metric has one written definition in `docs/METRICS.md` and a unit test using fixtures.
- Every shipped feature is verified against live data and a manual count in the GHL UI (like the 332 contacts / 189 deals check). Record it in `FEATURE_STATUS.md`.
- Feature flag every new module. Rollback means flag off, not a revert.
- Separate dev and production Supabase projects. Vercel preview deployments for every change.
- Errors go to a log table and an error tracker. Every screen has loading, empty, and error states.
- Small commits. No big-bang refactors. If a core change is needed, write the plan in DECISIONS.md first.

---

## 6. PRICING (what to configure and how it maps to features)

With "Everyone" install there is ONE price line: a price per client account per month. GHL documents the "agency base fee plus per-account fee" model only for Agency Only installs, so we skip the base fee for now. CHECK in the Pricing tab which options are available for this configuration.

**Start simple: a free plan and ONE paid plan.** Fewer tiers means fewer entitlement bugs.

| Plan | Price | Includes |
|---|---|---|
| Free | $0 | Instant Audit, overview, contact search, data health |
| Pro (final, still to be created) | $9 per client account per month | Everything in Wave 1 |
| Higher tier (later, as a new plan) | $9 to $19 per client account per month (hypothesis) | AI brief, anomaly detection, forecasts |

**How it works:**
- A business that installs directly pays the price itself.
- An agency that bulk installs and resells pays the developer price per account and charges its clients a marked-up price. GHL's documented example: developer price $10, the client pays the agency $10.50 with a 5% markup, the developer earns $10.
- Each install carries a `planId`. Entitlements are per location. Proposed rule: the agency-wide view unlocks when at least one of the agency's installed accounts is on a paid plan. Tell King if GHL's model makes a better rule easier.
- CHECK card-on-file friction: GHL docs say a paid app is charged to each sub-account's card on file, and accounts without a card are skipped on bulk install. CHECK how reselling changes this. If agencies would have to chase clients for cards, tell King.

**Configured in the portal (King, Oct 30, 2026):** Freemium, Free Plan $0, Pro $5 monthly, 14-day free trial, no billing meters yet. The Pro feature line reads "All views, alerts and exports for every client account". Keep that line honest: do not promise exports or alerts until they ship. Add one or two feature lines to the Free Plan so the difference is clear (Instant Audit, overview, search). King confirmed a plan's price cannot be edited: to change it, add a new plan and delete the old one. Final decision: Pro at $9 per client account per month. See the plan swap procedure below.

**Math (hypotheses to test with the pilot agencies):** an agency with 20 accounts pays $180 per month at $9. If it charges clients $18, it earns $360 and keeps $180. At 1,000 paid accounts that is $9,000 per month before any commission, about $7,650 if GHL took 15%. Competitor anchors: AgencyAnalytics about $12 to $15 per client per month, All The Apps from $129 per month.

**Plan swap procedure and development mode**
- Today the portal has Free Plan $0 and a temporary Pro plan at $5. Both unlock the same features while we build, so King can test.
- Never hardcode plan IDs. Deleting and re-adding a plan creates a new `planId`. Use the `plan_entitlements` table (`planId` to tier). Add an env setting `ENTITLEMENTS_MODE`: `open` (everything unlocked, for development and until pricing is final) or `enforced`.
- King uses the Free Plan for his own test installs, so nothing is billed and nobody sits on the $5 plan. Test paid-plan behavior by replaying simulated INSTALL webhook payloads with different `planId` values. Do one real paid install only on the final plan.
- **Pre-pilot gate (must be done before ANY outside agency installs):** (1) King adds Pro at $9 monthly with honest feature lines, (2) King deletes the $5 plan, (3) you add the new plan ID to `plan_entitlements`, (4) switch to `enforced`, then run the entitlement tests and the tenant isolation tests, (5) CHECK what happens to existing installs on a deleted plan, and make sure there are none.

**This is not "same price for agency and sub-account".** There is one price per account. The agency can mark it up.

Usage meters for AI features (when built): bill per AI brief or per batch of AI checks through a billing meter and the Create Wallet Charge API, so API cost is passed through.

**Task for you:** read GHL's pricing doc, then give King exact portal steps for the Pricing tab (free plan, paid plan, free trial) and build the `plan_entitlements` mapping.

---

## 7. WHAT TO SHIP

### Wave 0: Stabilize the overnight build (do this first, before anything new)
1. Read `REPORT.md` from the overnight run. For every shipped feature, classify: **PRIORITIZE, DEFER, or AVOID** using sections 7 and 8.
2. Verify each PRIORITIZE feature against live data. Fix or flag off anything wrong or shallow.
3. Flag off DEFER and AVOID features (do not delete; keep the code).
4. Add the cross-tenant security tests (section 4.2).
5. Add the event store and start recording changes now.
6. Write `docs/METRICS.md`, `docs/FEATURE_STATUS.md`.
7. Fix UI debt: the Duplicates page prints every name; group by name and show counts, paginate, and cap list length.
Done when: all remaining visible features are verified, tenant tests pass, and the event store is recording.

### Wave 1: The wedge (about 3 to 4 weeks)
Each item: data source (CHECK endpoints), metric definition, edge cases, tests, flag, verification.

1. **Speed-to-lead monitor with SLA alerts.** Definition (write it in METRICS.md): time from a new lead (contact created or first inbound) to the first human outbound touch (message or call by a user). Make "count automated touches" a setting. SLA target per account. Alert when a lead breaches SLA with no touch (email and in-app; Slack later). Agency view ranks accounts; account view ranks users. CHECK message fields for direction, source, and userId.
2. **Appointment hygiene and true show rate.** Flag appointments whose time has passed but status was never set to showed or no-show (reports lie when staff forget). Show true show rate once statuses are fixed. No-show recovery list: no-shows in the last 7 days not rebooked. CHECK appointment status values and change events.
3. **Unanswered conversations and unified inbox.** Aging buckets (1h, 4h, 24h, 48h plus). Agency view across accounts, account view for one. Deep link to open the conversation in GHL.
4. **Smart call queues.** Pre-built lists (yesterday's no-shows, new leads with no touch, hot leads untouched for 3 days, stale deals) plus saved custom filters. Ranked by priority. Opens the contact in GHL (we do not build a dialer).
5. **Instant Audit.** Within minutes of install: problems found and dollars at risk (stale deal value, leads unanswered over an hour, unrecovered no-shows, unmarked appointments). Shareable summary. This is the onboarding hook and the main marketing asset.
6. **Weekly digest email** per agency and per account owner: what happened, what needs attention.
7. **White-label SubSync UI.** Agency logo and colors, SubSync name hidden. Needed for white-label verification and resale.
8. **Roadmap with voting, change log page, in-app help.** Cheap trust builders competitors use well.

### Wave 2 (after Wave 1 is verified and pilots are using it)
- Cross-account setter and closer leaderboard, activity and idle detection
- Anomaly detection (lead volume or response time versus the account's own normal) and client engagement score
- Stage history based metrics from our event store: deal velocity, stage dwell time
- AI daily action brief (usage-metered)

### Wave 3
- Forecast, win/loss, source attribution, churn risk alerts, Slack integration
- Reconsider a "usage and margin guard" if the API exposes per-location usage or wallet data (CHECK). Reviews list surprise usage bills among the top GHL complaints.
- A second listing for direct small businesses ("Everyone" can install), if demand shows up.

---

## 8. DO NOT BUILD (or defer)

**Defer (crowded or commodity):** custom report builder, white-label PDF reports, QBR generator, client portal links, workflow inventory and template sync, gamification extras (badges, TV mode), contract renewal calendars, satisfaction surveys.

**Avoid (competitors own it, or hard and risky):**
- Dialers and telephony engines (GHL has its own; Hot Prospector, Kixie, Aloware, PhoneBurner exist; compliance and infrastructure burden)
- White-label theming of GHL itself, login page builder, support ticket desk, knowledge base, onboarding portal, snapshot or service stores
- Integration connector catalog
- Anything GHL already does natively in the same way: bulk tagging, basic contact management, basic pipeline view, calendar booking, workflow builder

---

## 9. MARKETING AND SITE (build after Wave 1 is demoable)

Message: "Know what is happening in every client account before your client does."

Page flow: hero with one button ("Run your free audit"), live counters from real data, interactive demo with sample data (no install needed), three outcome blocks (Speed to lead, Show rate, Setter performance), profit calculator (base fee plus per account, client price, agency margin), trust block (minimal permissions, read-only by default, data deleted on uninstall), roadmap and change log links, FAQ with trial terms.

Look: dark, premium, one accent color, animated counters, a live alert feed ticking in, smooth scroll sections. Inspired by the competitor's glow-and-gradient dark style but with SubSync's own colors and identity. Keep it fast.

Lead magnets: speed-to-lead cost calculator, shareable Agency Health Audit.

Required pages for marketplace review: `/privacy`, `/terms`, `/support`. Write honest drafts and flag that a human must review them before going Public (the app stores other businesses' customer data).

Public-facing wording rule: say "client accounts" and "business accounts", not "sub-accounts"; do not use the GHL name or logo in the app logo, website, or listing images (the portal form warns about this).

---

## 10. COSTS AND OPERATIONS

As far as I know, and CHECK the pricing pages before launch: Vercel Hobby is non-commercial and has tight cron and function limits, so plan on Vercel Pro before charging customers. Supabase free projects can pause and have small storage limits, so plan on Supabase Pro at launch. Realistic launch infrastructure is about $45 to $100 per month plus AI usage. Estimate storage for a large agency (for example 30 accounts x 20,000 contacts) and tell King if free tiers will not hold it.

---

## 11. WHAT ONLY KING CAN DO (give King exact steps for each)

1. Listing Configuration: no change needed. Leave Who can install as Everyone. Also generate the Shared Secret (Advanced Settings > Auth > Shared Secret > Generate) and store it only as an env var `GHL_APP_SHARED_SECRET`, never in chat or git.
2. Pricing tab: not needed while we build. Before ANY pilot agency installs, add the $9 Pro plan and delete the $5 plan (steps in section 6).
3. Create a Tipalti account when invited; confirm payouts work for King's bank (UNVERIFIED).
4. Recruit 3 to 5 pilot agencies (private cap is 5), ideally appointment-driven agencies with setter teams.
5. Get privacy policy and terms reviewed by a human before Public.
6. Decide on Security Review versus going Public after the pilot.
7. Later: pursue GHL's developer partner program (invite-only per All The Apps; CHECK how to apply).

---

## 12. GATES AND KILL CRITERIA

| Gate | Target |
|---|---|
| End of Wave 0 | All visible features verified; tenant tests pass; event store recording |
| Before any pilot install | $9 plan created, $5 plan deleted, plan IDs mapped, entitlements enforced, all tests pass |
| 30 days | 3 or more pilot agencies connected and opening it weekly |
| 60 days | 2 or more agencies say they would pay the proposed price |
| 90 days | Public listing live; 20 agencies installed; 10 paying |

If pilots say they already get this from AgencyAnalytics or GHL native reports and will not pay, narrow to speed-to-lead and appointment hygiene only. If All The Apps ships sales-ops dashboards, speed up and lean into alerts and setter ops. If the API cannot supply call and appointment data well, shift weight toward pipeline and conversation features.

---

## 13. VERIFICATION CHECKLIST (research tasks for you, in this order)

1. What target user, install, and listing settings does the current SubSync app have in the portal? (King's screenshots show Sub-account target, Everyone, bulk Yes, White-label, Private.)
2. SSO payload fields and whether an agency user can see an agency-wide screen from a sub-account menu.
3. Webhook event names for: contact create/update, opportunity create/stage/status change, appointment create/update, inbound and outbound messages, install and uninstall, plan change.
4. Get Installed Locations and location-token minting endpoints; rate limits per app and per resource.
5. Appointment status values; message fields (direction, source, userId, timestamp); call records and what they contain.
6. How free tier plus per-account billing behaves with bulk install.
7. Create Wallet Charge API and billing meter setup for AI features.
8. Whether the API exposes per-location usage or wallet data.
9. Commission and payout facts from the developer portal docs.
10. Whether Who can install can be changed after saving (Everyone to Agency only, or back).
11. Whether agency-level apps can be tested from King's Starter plan or only via sandbox or Test Link.
12. Log real SSO payloads for each kind of user (agency owner, agency admin, agency staff, client admin, client user, with and without `activeLocation`) and record exactly what `type`, `role`, and `isAgencyOwner` return.
13. How to read which client accounts an agency staff user can access (Users API).

---

## 13A. FIRST-LOOK FINDINGS (King's review, Oct 30) - FIX THESE IN WAVE 0

**White-label hygiene (agencies resell this app under their own brand):**
- Never hardcode `app.gohighlevel.com` or `leadconnectorhq.com`. Build every "Open in your CRM" link, email link, and reinstall prompt with one helper that uses `whitelabelDetails.domain` from the SSO payload and the INSTALL event (store it per company). Fall back to the default domain only when the company is not white-labeled. CHECK the exact deep-link URL patterns for contacts, conversations, opportunities, and appointments.
- Never show the words "GoHighLevel", "HighLevel", or "GHL" in any UI text, email, empty state, error message, or help page. Say "your CRM" or "your platform". Add an automated test that scans UI strings and email templates for those words.
- CHECK the white-label OAuth install flow and what URL a white-labeled agency sees during install. Report what you find to King.

**Scope plan:**
- Today: 7 required read-only scopes plus 2 optional. Few scopes is a trust advantage (the biggest competitor requests 165). Keep it lean.
- Catch: every scope added later forces every installed agency to re-approve and reinstall (the Appointments banner shows this). Before any pilot installs, list every read scope Waves 1 and 2 will need and add them now as OPTIONAL scopes, with graceful degradation when not granted. Candidates (confirm exact names in the docs): conversation messages, calendar events, users, tags, custom fields. Add write scopes only for features we keep, and keep them optional. Remove any scope no feature uses.

**Metric trust rules (the Overview currently shows $2,400,000 on three different tiles and $1,200,000 on two):**
- With test data, almost every deal is stale, so "stale deal value", "open pipeline", and "revenue at risk" collapse into one number. "Expected revenue" and "slow follow-up cost" are both exactly $1,200,000, which suggests a default win rate near 50% and a shared formula. Real agency accounts are also full of junk deals, so this will happen with real data.
- Fix: (1) exclude $0 and ownerless deals from dollar tiles, (2) define "stale" per pipeline stage, not one global age, (3) never show a win rate built on fewer than a minimum number of closed deals; show "not enough data" instead, (4) label every estimate as an estimate, with the formula one tap away, (5) add a filter to hide obvious test accounts and test deals, (6) cap the Overview at about 6 tiles. Write each definition in `docs/METRICS.md` and unit-test it.

**Scope creep triage:**
- Classify Duplicates, Data cleanup, Meeting notes, Leads, Clients, and Team against sections 7 and 8. Flag off anything not in Wave 1. Duplicates and Data cleanup are DEFER (they overlap native GHL and paid tools). Keep the code, hide the navigation.
- Group the Duplicates list by name with counts and paginate it.

**Design pass (after Wave 0):** one consistent layout, fewer tiles per screen, one clear primary action per screen, a distinct visual identity (dark premium shell with one accent color), and a "what should I do next" panel at the top of Today. Inspiration, not copying.

---

## 14. KICKOFF

Read this whole file. Then:
1. Do Wave 0 first, including everything in section 13A. Report what you found in `REPORT.md` and tell me what is verified, what you flagged off, and what is blocked.
2. Run the verification checklist (section 13) and update DECISIONS.md.
3. Give me exact portal steps for the Pricing tab (section 11.2).
4. Then start Wave 1 in order, one module at a time, each verified on live data before the next.
Do not add features not listed here without asking.
