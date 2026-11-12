# SubSync product plan 1 (11 Nov 2026)

Written by the product strategist, for King. Order of weight: money first, customer second, innovation third.
Labels: VERIFIED = read in our repo or a primary page. INFERENCE = my reasoning. UNVERIFIED = vendor blog or search snippet only (links given).
Honest limits: I read the repo and docs and searched the web. I did NOT run the live app, so "gap" items below come from reading briefs, QA and code, not from clicking. Reddit, Facebook groups, the GHL ideas board and the marketplace were not reachable. Competitor prices come from third-party pages that disagree with each other; check the vendor pages before quoting any number.

## 0. The big finding (read this first)

**We have built far more than customers can see or pay for.** VERIFIED in `src/lib/flags-core.ts`: well over 100 feature names sit in the default-off list (Today, Proof, Payments, Clients v2/v3, Team, Pipeline, Workflows, Clean-up, Settings hub, cash features, Find a lead, Audit history). VERIFIED in `src/lib/live-flags.ts` and `docs/NEEDS_KING.md`: the live switches `SEND_EMAIL_LIVE` and `SEND_SLACK_LIVE` are off unless set in Vercel, so the 7 am email, alerts and receipts are "WOULD SEND" log lines. VERIFIED in `docs/NEEDS_KING.md` item 4 and `CLAUDE.md` section 6: the pre-pilot gate (add Pro at $11.50, delete the $5 plan, map the plan id, enforce entitlements) is not done, and `NEEDS_KING.md` still says "$9", `COMPETITORS.md` says "$5": the docs disagree with the brief.
Result: today revenue is zero and King discovers gaps by hand. The next best dollar is not a new feature. It is a **go-live and "nothing invisible" pass**, then the proof and alert features that agencies pay to resell.

**How I stop King finding gaps by hand: a "Definition of live" gate** (item 1 below). One automated check per module that fails the build when: a list row has no Open button, a count is not equal to the rows it opens, an empty state has no next step, a flag is off without an owner and a return date, a module has no menu entry or guide, or a screen is missing from What's new. Gaps become test failures, not King's job.

## 1. What the sidebar really holds (VERIFIED from `src/app/app/nav.ts`, `docs/features/*`, `docs/QA_ROUND1.md`)
| Menu entry | What it does | State |
|---|---|---|
| Today (+ Numbers, Proof, Settings; absorbs Overview) | Ranked "what to do first", one button, daily email, weekly receipt, done ledger | Built, flags `td_*` off, email dry-run |
| Speed to lead (+ Unanswered tab) | First-reply time, SLA, never-answered, river view, breach alerts | Built; most mature; some flags off |
| Appointments | True show rate, unmarked, no-show recovery, calendars, leadership view | Built; QA fixed date and double-click bugs; calendars sync has a silent cap of 80 per account (R5) |
| Clients (+ Accounts, Setup) | Health, plan and payment status, Money tab, notes, compare | v2/v3 merged, flags off |
| Payments | Failed and late payments, recovery queue, dispute log | Built, flag off, status words and amount units still CHECK |
| Find a lead (Search, Leads, Call lists) | Cross-account search at 1M rows, bulk actions, call mode | Built, flags off |
| Account audit | Install-day audit, share link, history, one-pager, monthly message | Built, `au_*` off |
| Clean-up (Duplicates, Data quality, History, Rules, Health) | Fix lists, tag and remove junk (cap 25, typed words), merges | Built, flags off |
| Team (More) | Setter and closer scores, coaching, away, targets | Built |
| Pipeline and deals (More) | Slipping deals, lost reasons, stage history | Built |
| Meeting notes, Workflows (More) | Fathom notes (private inbox); outcome gaps and template library | Built, hidden pending pilots and live probes |
| Settings, Integrations, Notifications, Getting started, What's new | Setup, Slack/Fathom, guides | Settings hub flag off |

## 2. Market: what agencies pay for and complain about
- **Reporting is a commodity with a per-client price.** AgencyAnalytics now sells one per-client plan, about $20 per client per month on annual billing; older tiers started near $79 for 5 clients (UNVERIFIED, conflicting: https://blog.coupler.io/?p=85540). Databox about $71 to $399+ per month, white label an extra $80 (UNVERIFIED: https://mammoth.io/blog/databox-pricing/ , https://madgicx.com/compare/databox-review). DashClicks from $199 per month with white label (UNVERIFIED snippet: https://www.dashclicks.com/pricing/). Our $11.50 per client sits under these, and we add something they lack: CRM lead-handling outcomes. They report ads, SEO and social.
- **Closest rival for the owner's wallet is GoCSM**: health score, MRR at risk, revenue intelligence launched Feb and May 2026 (https://gocsm.featurebase.app/changelog/rocket-new-health-dashboard-v3-now-live); prices not public (https://www.g2.com/products/gocsm/reviews). It scores billing and engagement; we hold lead-handling outcomes it cannot see.
- **Hot Prospector** sells speed-to-lead and booking tools with white label on all plans, price by quote (UNVERIFIED: https://hotprospector.com/pricing). It acts (sends), we audit; both can sit in one agency.
- **GHL complaints that map to us.** Usage bills grow past the plan fee; the agency wallet hides totals (UNVERIFIED, competitor blogs: https://inflowave.netlify.app/resources/gohighlevel-hidden-fees-2026). Third-party pages say 2026 added wallet visibility, a Reselling tab and AI spend caps (UNVERIFIED: https://rsla.io/blog/gohighlevel-updates-2026), so a plain wallet alert is table stakes soon; our edge is cross-account history and projection. Dashboard slows at peak hours (UNVERIFIED: https://dev.to/robert_denim/gohighlevel-review-2026-real-agency-experience-after-18-months-31i6).
- **Why clients leave (the pain our proof page sells against).** "Bad leads" often means slow follow-up (UNVERIFIED case: https://www.callrail.com/blog/viirl-marketing-data-secure-100m-home-service-jobs). Churn is a trust problem: the client stops believing the agency knows what is going on (UNVERIFIED: https://www.whatconverts.com/blog/why-static-client-reports-are-killing-agency-retention/). Reports should include speed to lead, contact rate, meeting-set rate (https://www.provenroi.com/build-an-effective-agency-client-relationship-that-lasts/). Much early churn is in the first 90 days (UNVERIFIED: https://www.saashero.net/uncategorized/lead-gen-agencies-onboarding-retention/).
- **Ad spend and ROAS are not native in GHL**; vendors (AnyTrack, LeadJourney) send won deals back to ad platforms (UNVERIFIED: https://anytrack.io/playbooks/send-gohighlevel-phone-closes-to-facebook-ads , https://blog.coupler.io/gohighlevel-reporting/). Opportunity for an import-based ROAS view, but it needs a data source we do not hold.
- **All The Apps**: not re-verified today (search returned nothing specific). Use the figures in `CLAUDE.md` section 1 (VERIFIED there earlier). Assume they enter our lane within 12 to 18 months.

## 3. Top 25 candidates we do not have (or have dark)
Scores: Cash = could it be sold this month (H/M/L). Data = held now (Y), partly (P), no (N). Effort S under 1 week, M 1 to 3 weeks, L over 3. Moat = how much our own history helps. Risk = privacy/API/compliance.
| # | Candidate | Who pays | Cash | Data | Eff | Moat | Risk |
|---|---|---|---|---|---|---|---|
| 1 | Go-live and "Definition of live" gate for what is built | Everyone (unblocks all revenue) | H | Y | S-M | n/a | Low |
| 2 | Branded client Proof page and monthly report (link + PDF) | Agency owner, at renewal | H | Y | M | High | Leak of names (test it) |
| 3 | 7 am brief and "save this account" email, live | Agency owner, setter | H | Y | S | Med | Email deliverability |
| 4 | Install-day audit pack: branded one-pager, baseline, paid one-off | Agency salesperson | H | Y | S-M | Med | Estimate honesty |
| 5 | Wallet and usage guard (low, burn rate, days left) | Agency owner | H | P (wallet read granted optional) | S-M | High (history) | Per-location usage API CHECK |
| 6 | Client health and churn watchlist plus retention playbooks | Agency owner with 15+ clients | M | P | M | High | Score must be explainable |
| 7 | Agency MRR and margin view (plans sold, past due, MRR at risk) | Agency owner | M | P (plan call fixed in v3) | M | Med | Plan status words |
| 8 | Payments recovery queue (built) | Owner, client admin | M | P | S to switch on | Med | Status words CHECK, role-gate |
| 9 | Setter and closer payout report (who set, showed, closed) | Agencies with setters | M | P | M | High | Definition of setter (King) |
| 10 | AI daily brief per account, usage-metered | Owner | M | Y | M | Med | AI data policy, cost |
| 11 | "Ask your data" chat with guardrails (MCP connector exists) | Owner | L | Y | M | Low | Wrong answers; read-only, cite rows |
| 12 | Lead-flow anomaly alerts against own normal | Owner | M | Y (daily snapshots) | S-M | High | False alarms; min-data rule |
| 13 | Forecast: bookings, pipeline, revenue with range | Owner, client admin | L | P (history grows) | M | High | Trust; "not enough data" |
| 14 | Source and ROI attribution; ad-spend import for ROAS | Agencies running ads | L | P (source yes, spend no) | L | Med | Spend data source |
| 15 | SLA guarantee page: agency promises "answered in 5 min", live public proof | Agency owner (sales tool) | M | Y | M | High | Public data, counts only |
| 16 | Call and meeting insights (Fathom summaries) | Agencies whose closers use Fathom | L | P | built | Low | Privacy; personal connections |
| 17 | Review and reputation monitor | Local-service clients | L | N | M | Low | Crowded; needs reviews scope |
| 18 | New-client onboarding automation (baseline audit, first receipt, checklist) | Owner | M | Y | S | Med | Low |
| 19 | Template drift monitor (same setup across clients) | Agencies with snapshots | L | P (workflows API limited) | M | Low | API access blocked today |
| 20 | Benchmarks across accounts, opt-in, anonymised | Everyone; sells itself | L now | N (needs installs) | M | Highest | Privacy; 10 accounts, 3 agencies minimum |
| 21 | Outbound webhooks and a small public API | Technical agencies | M | Y | S-M | Low | Tenant isolation |
| 22 | Zapier or Make connector (after 21) | Agencies | L | Y | M | Low | Maintenance |
| 23 | Coverage heat map (hour by weekday) and after-hours gaps | Owner, setter manager | M | Y | M | High | Low |
| 24 | Departing-user sweep and ownerless-lead assign | Owner | M | Y | S-M | Med | Writes: preview and undo |
| 25 | Mobile push (PWA) and WhatsApp nudges for setters | Setters, owners | M | Y | M | Med | WhatsApp needs a sender account |
Not recommended: client login portal (GHL has one, crowded), dialer, sending messages (CLAUDE.md section 8).

## 4. Build next: ranked (top 12)
Format per item: customer, pain, build, data, money, effort, risks, flags.

**1. Go-live pass and the Definition-of-live gate.** Customer: King and every pilot agency. Pain: features merged but dark, emails not sent, plan gate undone, docs disagree. Build: flip the shipped `td_*`, `au_*`, `cf_*`, `cl2/cl3`, `pm_*`, `pp_*`, `fl_*`, `cu_*`, `st_*` flags on in order after the tenancy check; set `SEND_EMAIL_LIVE`/`SEND_SLACK_LIVE`; one GHL version bump with all optional scopes; pre-pilot gate; fix stale docs; add the gate test (Open button on every row, count equals rows, empty-state next step, flag owner and date, menu entry or guide, What's new line). Data: none new. Money: nothing sells until this ships. Effort: S-M. Risks: first real sends (test on King's own accounts first), slow first screens (QA found 8+ startup calls), re-approval banner from new scopes. Flags: all above; record each in `docs/FEATURE_STATUS.md`.

**2. Client Proof page and monthly report (branded, link and PDF).** Customer: agency owner at renewal; client admin. Pain: client says "bad leads", owner has no proof. Build: one page per client account: reply time and SLA %, never-answered fixed, show rate, deals saved, receipts, then-and-now from the audit history; agency logo and colours; no lead names; expiring revocable link; monthly email; print and PDF. Data: `speed_daily`, receipts, `au_runs`, `td_receipts`, appointment history (all held). Money: the reason to keep every account on Pro; a Reports tier hypothesis $17 to $19 per account (see section 6). Effort: M (v1 one week: extend the existing share link). Risks: name or cross-account leak (test it), white-label words test. Flags: `au_onepager`, `td_proof`, new `pr_report`.

**3. Morning brief, "save this account" and wallet-low alerts, delivered.** Customer: owner (all accounts), setter (own queue). Pain: finding out from the client. Build: take the built digest live; add Slack as a channel; per-account mute and snooze; "last checked" line on calm days. Data: held. Money: first alert that saves a client justifies the plan; Slack and WhatsApp can be the higher tier. Effort: S. Risks: email setup, time zones at 7 am, alert fatigue (5-item cap exists). Flags: `td_email`, `cf_save`, `cf_email`.

**4. Install-day audit pack and prospect mode.** Customer: agency salesperson. Pain: no hard number to open a client conversation. Build: branded one-pager with dollars at risk (range and sample size beside it), auto-run at install, monthly then-and-now, "run on my trial client first" flow. Data: held. Money: free-tier hook; paid one-off "Audit pack" hypothesis $49 to $99 per agency per 10 accounts through GHL one-time pricing (VERIFIED model exists in CLAUDE.md section 3; CHECK it can coexist with Freemium). Effort: S-M. Risks: estimate looks invented; keep counted and estimated figures on separate lines. Flags: `au_history`, `au_onepager`, `au_monthly`.

**5. Wallet and usage guard.** Customer: agency owner. Pain: surprise bills (top GHL complaint, UNVERIFIED sources above). Build: daily wallet snapshot per client, low balance alert, burn rate and days left, spike alert, "accounts that cost more than they pay" once plan price known. Data: `wallet.readonly` read already in Clients v3, history starts when we record; per-location usage by type is CHECK. Money: Pro feature that the owner understands in 10 seconds; AI-spend caps later. Effort: S-M. Risks: GHL ships the same natively (INFERENCE), so lead with history and cross-account projection. Flags: new `wg_guard`.

**6. Client health and churn watchlist with playbooks.** Customer: owner with 15+ clients. Pain: learns a client is leaving at the cancel email. Build: ranked list from reply speed drop, no new leads versus own normal, past-due plan, wallet empty, no-show spike; each row has a one-line reason and a playbook ("send the proof page, book a call, fix the leak"). Data: Clients, Speed, Payments rollups. Money: higher-tier candidate; competes with GoCSM on outcomes it cannot see. Effort: M. Risks: unexplainable score (keep reasons, not a number). Flags: `cl2_*`, new `ch_watch`.

**7. Agency MRR and margin view.** Customer: owner. Pain: "which clients owe me, which earn me nothing". Build: plans sold per client, paid and past due, MRR and MRR at risk, profit after our $11.50 and wallet cost. Data: Clients v3 plan facts and Money tab. Money: Pro; stickiness (the owner's own numbers live here). Effort: M. Risks: status strings undocumented (CHECK), "not available from the platform" for next charge date. Flags: `cl3_money`.

**8. Setter and closer payout report.** Customer: agencies paying setters per booking. Pain: commission disputes. Build: who set, showed, closed per appointment, CSV, per period, fair-score fix. Data: appointment history and users (held; creator field CHECK). Money: Pro+; sold to owners with 3+ setters. Effort: M. Risks: King must set the setter definition (decision 3). Flags: `pp_*`.

**9. Lead-flow anomaly alerts and booking forecast.** Customer: owner. Pain: ad broke on Friday, found Tuesday. Build: lead volume, reply time and show rate against the account's own normal; "may be an ad problem" label; forecast with range after 60 days of history. Data: `account_metrics_daily`, event store. Money: higher tier. Effort: S-M for alerts, M for forecast. Risks: false alarms; minimum-data rule. Flags: new `an_alerts`.

**10. AI daily brief and "ask your data" (metered).** Customer: owner who wants a ready client message. Pain: copy-pasting numbers into a client email. Build: brief per account from rollups; chat through the existing MCP connector with read-only tools and row citations; per-brief billing meter and wallet charge API. Data: rollups and event store. Money: usage price or $9 to $19 tier (CLAUDE.md hypothesis). Effort: M-L. Risks: AI data policy (aggregates only, no names), meter API CHECK, wrong answers. Flags: new `ai_brief`, `ai_ask`.

**11. SLA guarantee page and coverage heat map.** Customer: agency owner selling the service. Pain: cannot prove "we answer in 5 minutes". Build: a public live-proof page per client with the promise, SLA %, last 30 days, hour-by-weekday heat map, after-hours gaps. Data: held. Money: it helps the agency win new clients; ties to Proof. Effort: M. Risks: public counts only. Flags: new `sla_page`.

**12. Push channels and outbound webhooks.** Customer: setters (phone push), technical agencies (Zapier). Pain: nobody opens another dashboard. Build: PWA install with web push for "3 leads waiting"; Slack channel alerts; signed outbound webhook `alert.created` with a tenant-guarded API. Data: held. Money: retention; webhooks open an integration story at low effort. Effort: M. Risks: push on iOS quirks, webhook tenant isolation test. Flags: new `ch_push`, `api_hooks`.

## 5. Quick wins this week (all S; King does not need to notice any of these)
1. Flip the verified flags on and set the two live switches on King's own accounts first (needs decision 1).
2. Add the Definition-of-live test and run it once; fix what it finds (Open buttons, empty states, flags without an owner).
3. Calendars: show a message when an account has more than 80 calendars, list dead calendars in pickers, and give every empty calendar a reason line (R5 gaps: silent cap).
4. Clean-up: let "remove junk" run in more than one batch of 25 with typed confirmation, and show "what we did not touch and why" (protected contacts). INFERENCE from the CU decision text; confirm in the screen.
5. Fix stale docs and copy: $9 and $5 mentions, "Plan" label to "Paid plan you sell" (Clients), "Agency view" wording.
6. Speed vs Unanswered: one line "why these two numbers differ" on both.
7. Make every link-style action 32 px (44 px on phone); QA found 24 px ones.
8. Cut the 8+ startup calls in the shell to one batch before measuring on production.
9. Today all-clear state lists what was checked; every "history starts <date>" empty state shows the date.
10. Add two honest lines to the Free plan listing and keep the Pro description free of promises that are not live.
11. Share-page leak test: counts only, one account, revoked link returns nothing.
12. Slack redirect fix (NEEDS_KING item 1) so Slack alerts can be proven live.

## 6. Gaps found across modules (VERIFIED where a doc or code line is cited; otherwise INFERENCE)
- **Dead ends.** Clients rows that only link out to the CRM; "Needs permission: reconnect" shown when the platform gave another reason (fixed in v3 for plans, check Payments and Workflows); lists with no Open button in sample data (QA); Open icon cut off at the right edge (fixed in Appointments, check others).
- **Numbers that cannot be opened or disagree.** Rule exists (count equals rows). QA found it broken twice in Appointments. The gate test makes it permanent. Speed and Unanswered use different counts with no explanation; Today's money tiles must reuse module rollups (decision recorded).
- **Empty and half-empty screens.** Calendars (silent 80 cap, dead calendars hidden), Stage history and Forecast (need weeks of history; show the start date and days to go), Appointments before the calendar permission, Team names before the users permission.
- **Thin Clean-up.** Removal capped at 25 per run, merges need typed words and a switch, Data health folded in as a tab. Fine for safety, thin for a big agency; add batches, a weekly "new duplicates" alert, and a proof line ("score 54 to 88").
- **Two account pickers and a bar that follows nothing.** Fixed in Today, Appointments, Team, Pipeline; two pickers remain at 390 px in Appointments and Team (QA).
- **Jargon.** "Automated touches", "SLA", "touch", "sub-account", "Agency view". Rule: plain words, one-line "what this means" on every score.
- **Proof is scattered.** Response proof lives in Speed, show rate in Appointments, deals saved in Pipeline, plan status in Clients, baseline in Audit. One Proof page per client (item 2) is the fix.
- **Docs disagree.** FEATURE_STATUS still lists Team and Duplicates as hidden; NEEDS_KING says $9; COMPETITORS says $5. A stale doc is how King gets surprised. Add "last checked" dates and make the gate read `FEATURE_STATUS.md`.

**What Today should pull from each module (read the rollups, never recompute):** Speed: people waiting, SLA drop, oldest wait. Appointments: unmarked, no-shows to recover. Pipeline: deals going stale this week, lost with no reason. Clients: accounts to save, plan past due, wallet low. Payments: money at stake today. Clean-up: new duplicates and bad-import alert. Workflows: stopped automation with leads affected. Audit: new accounts with a baseline waiting. Team: idle or overloaded people. Meetings: unmatched meeting in inbox (private to the person). Each row: one reason, one number that opens its rows, one Open button. Setters see only their queue.

## 7. Pricing and packaging (all numbers are HYPOTHESES for pilots)
Facts: GHL bills internal only; Pro $11.50 per client account per month; free plus one paid plan today; price changes apply to new installs only; agency base fee only works for Agency-only installs (CLAUDE.md sections 2, 6).
| Tier | Price | Contents | Why they pay |
|---|---|---|---|
| Free | $0 | Account audit (one run), Today basic counts, Contact search, Data health score | Hook and install-day demo |
| Pro | $11.50 per client account | Everything in Wave 1: Speed, Appointments, Pipeline, Clients, Today with email, Proof page (SubSync-branded), Payments, Call mode, alerts | Replaces blind spots; the proof pays for itself at renewal |
| Pro plus (new plan, later) | $17 to $19 per account | White-label Proof and monthly PDF, churn watchlist, anomaly and forecast, wallet guard history, payout report, AI brief | Agency resells the report ($20 per client is the AgencyAnalytics anchor, UNVERIFIED) |
| Usage add-on | per AI brief or per batch, through a billing meter and wallet charge API (VERIFIED to exist, CLAUDE.md section 3) | AI brief, ask-your-data | Cost passes through |
| One-off Audit pack | $49 to $99 per agency (GHL one-time pricing CHECK, or invoice outside the app because it is a service) | Branded audit on 10 accounts | Cash now, pulls installs |
| Annual plan | about 2 months free | CHECK whether GHL plans support an annual interval; if not, skip | Cash up front, lower churn |
Rules: never list a feature in a plan line before it is live and verified; build the plan table from `plan_entitlements`, not hard-coded ids; do not create the higher plan until it has features (an empty premium plan is dishonest). White-label add-on as a separate agency fee is not possible with "Everyone" installs (INFERENCE from CLAUDE.md section 2), so white-label branding sits inside Pro plus. Math check: 20 accounts at $11.50 is $230 per month to us; the agency at $23 per client keeps $230 (CLAUDE.md section 6).

## 8. 30 / 60 / 90 days (gates follow CLAUDE.md section 12)
- **Days 1 to 30: be visible and billable.** Go-live pass and gate test (item 1); pre-pilot gate; version bump with scopes; email and Slack live; Proof page v1 with agency logo (item 2); install-day audit pack (item 4); wallet guard v1 (item 5); Payments switched on after the real status-word probe; recruit 3 pilot agencies and run 5 owner interviews. Gate: 3 pilots connected and opening it weekly.
- **Days 31 to 60: retain.** Churn watchlist and MRR view (6, 7); anomaly alerts (9); payout report (8, after King's setter rule); Slack and push (12); SLA page (11); monthly report PDF; start the Pro plus plan. Gate: 2 agencies say they would pay the price.
- **Days 61 to 90: grow.** AI brief and ask-your-data in beta with 3 pilots, metered (10); source and ROAS import if pilots ask (14); benchmarks opt-in once 10 accounts from 3 agencies exist (20); webhooks and API (21); security review and Public listing decision. Gate: 20 agencies installed, 10 paying.
- **Kill or narrow:** if pilots say they already get this from GHL reports or AgencyAnalytics, narrow to Speed, Appointments and the Proof page only.

## 9. Decisions I need from King (maximum 5)
1. **Go live with the shipped modules and the live switches.** Set `SEND_EMAIL_LIVE` and `SEND_SLACK_LIVE` to `true` in Vercel (Production, then redeploy) and let the lead switch the verified flags on after the tenancy check; publish one GHL version with every optional scope batched (Clone as Draft, Minor). My recommendation: yes, on King's own accounts this week, then pilots. It changes what real installs receive, and only you can touch Vercel and the portal.
2. **Pre-pilot pricing gate.** Add Pro at $11.50 monthly with honest feature lines, delete the $5 plan, send me the new plan id. Recommendation: do it now, before any outside install, because price changes only apply to new installs. Do not create a higher plan yet; add it as a new plan when white-label reports and the watchlist are live.
3. **Setter and closer definition (blocks the payout report).** Recommendation: use the default in NEEDS_KING item 8 (setter = whoever booked the appointment, else the lead owner at booking; closer = the appointment's assigned user).
4. **AI data policy and metering.** Approve sending only counts and rollups (never names, emails, phones or message text) to the AI provider, billed per brief through a billing meter. Recommendation: yes with aggregates only; this is a privacy and money commitment you would state on the trust page.
5. **Slack and WhatsApp accounts (logins only you can do).** Fix the Slack redirect URL (NEEDS_KING item 1) and decide on a WhatsApp sender (needs a Meta business account or a provider). Recommendation: Slack now; WhatsApp only after two pilots ask, because it adds a vendor, per-message cost and consent rules.
