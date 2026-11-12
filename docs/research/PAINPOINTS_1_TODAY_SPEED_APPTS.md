# Pain-point research 1: Today, Speed to lead, Appointments (12 Nov 2026)

## Read this first: how strong is the evidence?
- VERIFIED = read on the page (GHL ideas board posts fetched directly; vote counts as shown). INFERENCE = my reasoning.
- Reddit could NOT be fetched (blocked), and web search surfaced no Reddit threads. G2/Capterra pages for the named tools gave little on these topics. Facebook groups, Discord and YouTube comments were not reachable. So: no Reddit/FB/Discord evidence is claimed anywhere below.
- What we do have: the GHL ideas board (real agency users, vote counts), vendor and agency blogs (biased, they sell fixes), and vendor-reported statistics (unverified). No source gives hard willingness-to-pay for a monitoring app. Pricing evidence is indirect only.
- Bottom line: the pain is real and repeatedly stated by agencies, but there is NO direct proof anyone will pay $11.50/account for an alert-first monitor. That must come from the 5 agency interviews and paid audits.

---------------------------------------------------------------------
## 1. TODAY (daily "what to do first" screen)

Verdict: pain MEDIUM-HIGH (as a concept), pay MAYBE.

### Top pain points
1. **Agencies cannot see all clients in one place; checking each account by hand takes days.** Mentioned: most frequent theme (3+ separate ideas-board threads, 70+ votes).
   - "Master dashboard across all subaccounts" request, 70 votes, open since May 2020 with comments to 2026; poster left Ontraport because it had this. VERIFIED https://ideas.gohighlevel.com/reporting/p/subaccount-reporting-from-agency-level
   - A user with a 100+ location client says it takes days to check each account and "there is no way to get agency level data in 1 report" (Mar 2025). VERIFIED (same URL)
   - Merged ask: spot inactive subaccounts at agency level (same URL).
2. **Clients not answering the leads the agency generates, and the agency finds out late.** Mentioned: 2 direct sources, plus blogs.
   - Agency with 400+ locations says "we see a pattern of our clients not answering phones for the leads we are providing" and wants call data to find who needs help (Mar 2024). VERIFIED https://ideas.gohighlevel.com/call-tracking/p/api-to-support-call-tracking-details
   - Agency forum/blogs: client gets leads, follows up slowly, blames lead quality, churns; "invisible post-handoff failure". INFERENCE-grade (vendor blogs): https://sevenfigureagency.com/clients-leads-turning-cold , https://www.breakcold.com/pt/blog/increase-retention-for-your-lead-gen-agency-and-decrease-churn
3. **Missed follow-ups are silent and hard to notice.** Consultant blog: the costliest GHL setup mistake is missed follow-ups because nobody sees them. Weak evidence (vendor blog) https://consultevo.com/gohighlevel-setup-mistake-missed-follow-ups/
4. **Proof for the client (reports that match reality).** Blog: clients notice when reporting does not match reality. Weak. The ROI/call-tracking thread (87 votes) shows agencies use CallRail only to prove ROI: "CallRail is still the only reason we use it" (Apr 2025). VERIFIED (call-tracking URL above)
5. **Daily push digest of "who needs a call".** Evidence of demand is generic: other CRMs ship it as a standard feature (BoomTown "New - Not Contacted" daily email, Nutshell admin digests, Conversica). Zapier/n8n templates exist for "overdue lead alerts". I found NO GHL ideas-board request for a digest. INFERENCE: demand exists in CRMs generally; GHL users build it with workflows. https://zapier.com/templates/details/send-daily-overdue-lead-and-callback-alerts-to-team

### What they do instead
GHL native stale-opportunity workflow trigger, internal notifications, per-account dashboards, opening each sub-account, exporting to Looker Studio/Google Data Studio, AgencyAnalytics ($59-$349/mo plans per one vendor roundup), Two Minute Reports, CallRail for call proof.

### Would they pay / price evidence
- Indirect only. Reporting tools: AgencyAnalytics about $12-15/client (per CLAUDE.md, not re-verified); white-label dashboards wholesale $14-$69 per client account/month (one vendor page, weak: https://www.rapidevelopers.com/md/white-label/advertising-dashboard). So $11.50 sits at the low end of the market. INFERENCE.
- Agencies pay CallRail instead of waiting for GHL, which shows they pay for missing visibility. VERIFIED (ideas thread).

### Competitors and where they fail
- AgencyAnalytics: reports, not "what to do now"; reviewers cite broken integrations and tier-forcing upgrades; none of the results mention a GHL integration beyond its own marketing page. https://www.g2.com/products/agencyanalytics/reviews
- GHL native: per-account only; agency-wide ask open since 2020 (70 votes).
- All The Apps: not researched deeply here (search returned nothing specific).

### SubSync features that map
Agency-wide Today, money at risk, leads waiting, quiet deals, 7am brief, proof report -> pain points 1, 2, 4.

### Features with NO evidence of pain (demote candidates)
- "Money at risk" dollar figure: no source says agencies want a dollar estimate; estimates built on junk deal data erode trust (our own 13A finding). INFERENCE.
- Quiet-deal tracking as a headline: GHL already has a stale-opportunity trigger; no complaint found about it.
- Proof report: weak direct evidence; agencies pay for ROI proof but via call tracking.

### 3 missing features that would sell (money first)
1. **Client-ignoring-leads alert to the agency**: "Client X: 9 leads, 0 touched in 24h" sent to the agency owner BEFORE the client complains. Directly maps to the 400-location agency and churn blogs. Protects retention revenue.
2. **Inactive/dormant account detector** across all accounts (no leads, no messages, no logins in N days): the 2025 merged ask. Cheap, uses our event store.
3. **"Prove it" one-page per client: leads in, answered in X min, appointments, no-shows** (replace CallRail-style ROI proof). Agencies resell this to clients, so it supports their markup.

---------------------------------------------------------------------
## 2. SPEED TO LEAD

Verdict: pain HIGH (stated by agencies, backed by widely cited stats), pay MAYBE (crowded; native + paid tools exist).

### Top pain points
1. **Slow/no first response kills conversion and the agency takes the blame.** Mentioned: very often (almost every blog; one forum post).
   - Forum post: client gets a lead, does not follow up fast, blames lead quality, churns; "gurus never talk about" it. Source found via search, page blocked (403): https://www.biggerpockets.com/forums/80/topics/1285191-what-i-ve-noticed-about-lead-follow-up-using-gohighlevel (summary from search snippet; INFERENCE-grade)
   - Widely quoted stats: contact within 5 minutes vs 30 gives ~21x qualification odds; waiting 1 hour ~7x less likely (HBR/InsideSales, secondary sources, sample sizes unverified). https://www.verse.ai/blog/speed-to-lead-statistics
2. **No cross-account measurement of calls answered/missed.** Mentioned: 87-vote thread (Feb 2021 to Jul 2026) plus 4-vote thread.
   - Agency with 400+ locations cannot get missed/answered counts by location through the API (Mar 2024). VERIFIED https://ideas.gohighlevel.com/call-tracking/p/api-to-support-call-tracking-details
   - Multiple users say they keep CallRail only because GHL lacks this (Mar & Apr 2025). VERIFIED (same URL)
   - Request for missed/completed/busy per phone number and missed percentage "to monitor responsiveness" (Dec 2025, 4 votes). VERIFIED https://ideas.gohighlevel.com/call-tracking/p/call-reporting-and-missed-call-analytics
   - Voicemails counted as completed calls (report accuracy bug thread). https://highlevel.canny.io/call-tracking/p/call-reporting-improvement-voicemails-are-being-counted-as-completed-calls
3. **Unanswered inbox is hard to see.** Mentioned: 2-3 threads, low votes.
   - GHL Unread view flags threads because of outbound workflow messages, so real unanswered customer replies are buried; request for "last customer reply" filter (Sep 2025, merged Apr 2026). VERIFIED https://ideas.gohighlevel.com/conversations/p/allow-users-to-filter-conversations-inbox-for-contact-reply
   - Official support says custom conversation filters are not possible (via search summary). Last-call-status filter exists in a changelog entry. https://ideas.gohighlevel.com/changelog/conversations-expanded-filtering-capabilities
   - Companion request to separate automated from human messages: https://ideas.gohighlevel.com/ad-reporting-and-attribution/p/filter-conversation-threads-by-automated-vs-one-to-one-messages-while-keeping-in
4. **Routing/ownership: leads sit in one shared queue with no owner.** Blogs only (weak): https://consultevo.com/how-gohighlevel-helps-fix-slow-response-times-in-lead-follow-up/
5. **No agreed response standard/SLA.** Blogs advise setting one and tracking speed-to-lead and contact rate. Weak. GHL does have SLA indicators in conversations (per a third-party guide), per account only.

### What they do instead
Missed-call text-back (default in GHL), speed-to-lead workflows, internal notifications, "User Replied" SLA escalation, CallRail, Kixie, Aloware (from $30/user/mo, 5-user minimum on dialer tiers per a rival's comparison), Hot Prospector (speed-to-lead auto-queue, G2 4.5 from only 10 reviews), AI responders, Chili Piper.

### Would they pay / price evidence
- Agencies already pay for CallRail and dialers per seat/number just to get call data. VERIFIED (users say so). Dialers charge per user (~$30+). Pay is plausible for visibility, but per-account $11.50 vs per-seat tools is untested. INFERENCE.
- No source shows anyone paying specifically for "response-time monitoring".

### Competitors and where they fail
- Kixie/Aloware/Hot Prospector: act on leads (dial/queue) and report per account; they require switching the phone system; Kixie pricing opaque, Trustpilot 3.8 with auto-renewal complaints (vendor roundups). They are not independent monitors across accounts. https://dupple.com/reviews/kixie
- GHL native: per account, calls API missing, report quality issues.
- CallRail: used as the workaround; separate bill.

### SubSync features that map
First-reply time, SLA, never-answered leads, missed calls with no callback, unanswered inbox -> pain points 1, 2, 3. Strongest match: pain 2 (agency-wide missed/answered/response data).

### No evidence of pain (demote candidates)
- "Call mode" (dial queue): competes with dialers, no complaint found that agencies want it from us; CLAUDE.md already says avoid dialers. Demote.
- "Booking funnel / where leads leak": no source asks for it. Demote until interviews confirm.
- Setter-level ranking: no source found.

### 3 missing features that would sell
1. **Cross-account missed-call and callback report** ("missed calls with no callback within 1 hour, by client"). This is the single most-voted unmet need (87 votes, 6 years, CallRail workaround).
2. **True "unanswered customer reply" queue** (last message inbound, human not automated, aged buckets), exactly what GHL's Unread view cannot do; fills the 2025-26 request.
3. **"Client is ignoring leads" scorecard the agency can send to the client** (median response, % never touched) so the agency wins the blame argument and keeps the retainer. Retention revenue = money first.

---------------------------------------------------------------------
## 3. APPOINTMENTS

Verdict: pain MEDIUM, pay MAYBE (strongest pain is no-shows/outcomes hygiene; double-booking is real but is a GHL bug, not our lane).

### Top pain points
1. **Double bookings.** Mentioned: highest-voted calendar thread.
   - "Prevent double-booking": 115 votes, comments Mar 2023 to Dec 2025; leads book several slots, AI bots rebook, webinar races create overlaps. VERIFIED https://ideas.gohighlevel.com/scheduling-calendar/p/prevent-double-booking
   - Google sync gaps: recurring events not blocking, busy/available not syncing (May 2024). https://ideas.gohighlevel.com/scheduling-calendar/p/busy-vs-available-doesnt-seem-to-sync-from-google , https://ideas.gohighlevel.com/scheduling-calendar/p/recurring-meetings-in-google-calendar-not-hidden-in-booking-link-and-get-double
2. **Booking status is wrong/unconfirmed by default, so appointment data is unreliable.** Mentioned: several threads.
   - Requests to default bookings to Unconfirmed; Voice AI forced to Confirmed ("ideal for 3 of my subaccounts"). https://ideas.gohighlevel.com/scheduling-calendar/p/calendar-booking-status-default-to-unconfirmed-instead-of-confirmed , https://ideas.gohighlevel.com/ai-employee/p/allow-voice-ai-to-book-appointments-as-unconfirmed-instead-of-forcing-confirmed
   - Guides warn status changes drive show-rate reports and conflicting workflows overwrite them. https://consultevo.com/gohighlevel-update-appointment-status-workflow/
3. **No-shows and recovery.** Mentioned: constantly in vendor blogs, but I found NO ideas-board request asking for a no-show recovery list; recovery is handled by native workflows.
   - Vendor-reported no-show benchmarks: med spas ~5% (Zenoti, 30,000+ businesses, most credible) vs 15-25% (blogs); home services ~12-18% (one vendor, unverified). Reminders cut no-shows 25-50% (vendor claims). https://www.zenoti.com/thecheckin/medspa-cancellation-rate , https://www.schedulingkit.com/statistics/no-show-statistics
4. **Appointments with no outcome recorded** (staff forget to mark showed/no-show). Evidence is INFERENCE from the status-dependence of reports above; no user states it as a complaint in what I found. This is our own thesis, not yet a voiced pain.
5. **Booking sources/attribution of appointments.** Only generic evidence (call-tracking ROI threads). Weak.

### What they do instead
Native reminder/no-show workflows, Update Appointment Status action, Appointment Report (created/confirmed/showed/no-show/cancelled), manual calendar review, calendar smart-list view, Calendly-style fixes, consultants' troubleshooting guides.

### Would they pay / price evidence
No price evidence. Vendor ROI calculators exist (Zenoti, PatientNow, Prospyr) but those are sold to clinics, not agencies. INFERENCE: value is stronger for the end business (revenue per no-show) than for the agency.

### Competitors and where they fail
GHL native covers reports and workflows per account. Hyros-style "track no-show calls" exists for ad attribution. Specialist med spa suites (Zenoti etc.) own clinic-side. None found that independently audits outcome hygiene across many accounts. INFERENCE (limited search).

### SubSync features that map
Show rate, no-show recovery, outcome gaps -> pain points 2, 3, 4. Calendar health/double bookings -> pain 1.

### No evidence of pain (demote candidates)
- Show-rate as a standalone chart: no one asks for it; it only matters once statuses are trustworthy.
- Booking-sources report: no direct evidence.
- Calendar-health score: demand is for prevention (a GHL-core fix) not detection; detect-only may feel like a nag.

### 3 missing features that would sell
1. **Double-booking and same-lead-multiple-appointments detector with alert** (115-vote problem; we can detect even though we cannot prevent): "Lead has 3 open appointments; slot X has 2 bookings".
2. **"Unmarked appointments" queue with one-tap outcome (showed/no-show)**, so reports become true. Makes the show-rate metric credible; write scope is optional and guarded per standing rule.
3. **No-show revenue recovery list with dollar value and days-since**, ranked, scoped to the last 7 days not rebooked. Money-first, but expect agencies to say "I already have a workflow", so pair it with proof of how many were actually recovered.

---------------------------------------------------------------------
## Overall answers to King's three questions
1. **Will clients buy it?** Probably agencies, not end clients, and only for the retention/proof angle. Evidence of the pain is real; evidence of payment is absent. Treat $11.50 as plausible (below reporting-tool prices) but unproven.
2. **Real pain point?** Agencies are blamed for bad results when the client does not answer leads, and they cannot see client behaviour across accounts. Supported by: 400-location agency, 87-vote call-data thread, 70-vote cross-account dashboard thread, churn blogs.
3. **Is what is in Today a pain point?** Partly. Cross-account "who is ignoring leads / missed calls / inactive" = yes. Dollar "money at risk", quiet-deal totals, and generic proof report = weak or no direct evidence. Lead with leads waiting and missed calls; demote dollar estimates.

## Top 3 build recommendations
1. Cross-account missed-call + callback + never-answered report and the "client ignoring leads" alert to the agency (Speed to lead and Today). Strongest evidence, retention revenue.
2. Unanswered-customer-reply queue (human vs automated aware) and unmarked-appointment queue with one-tap outcome. Fills GHL gaps that people are explicitly requesting.
3. Double-booking detector and no-show recovery list with dollar value, plus one-page per-client proof the agency can resell.

Suggested next steps (not research): ask the 5 interviewees about the "client ignoring leads" scenario and what they pay CallRail for; run paid audits to test willingness to pay; re-check Reddit and Facebook groups by hand because those could not be reached here.

---------------------------------------------------------------------
## What SubSync already has vs the evidence
Source: docs/FEATURE_STATUS.md and file names under src/app/app/views (not every screen was opened; "partly" = I saw it named but did not read it). COVERED = pain evidence + we have it. GAP = evidence, we lack it or it is not live. SURPLUS = we have it, no pain evidence found.

### Today
| Item | Status | Note |
|---|---|---|
| Leads waiting, accounts needing attention, Fix first queue | COVERED | Maps to cross-account visibility (70-vote thread). Demo only, not on real installs yet |
| Daily 7am brief (Slack; email is dry run, flags off) | COVERED but not live | No GHL request found, but other CRMs ship it. Email send blocked on key/flag |
| Client ignoring leads alert to agency owner | GAP | Strongest retention evidence; closest is unanswered 24h alert (flag OFF) |
| Inactive/dormant account detector | GAP | Asked in merged 2025 ticket. Partly: "Clients coming and going", health tab |
| Per-client proof one-pager (Receipts, proof tab) | COVERED (weak evidence) | today-proof.tsx exists |
| Money at risk / forecast / quiet deals dollar tiles | SURPLUS | No source asks for dollar estimates |
| Finance, MRR, churn, payouts, email-leads list, meeting notes | SURPLUS | No evidence in this research; off or off-lane |

### Speed to lead
| Item | Status | Note |
|---|---|---|
| First-reply median, SLA attainment, leads never answered | COVERED | Not run on real data; needs messages permission |
| Unanswered inbox queue with aging | COVERED | Matches the "last customer reply" filter request; human-vs-automated awareness is the key detail to confirm |
| Missed calls with no callback (cross-account) | GAP | 87-vote thread; needs call data, API limited per users. Named in views but not proven on live data |
| Per-phone-number missed/answered percentage | GAP | 4-vote request |
| Breach alert (in-app, Slack; email not built) | COVERED | Alert email missing |
| Call mode / dial queue (dial-mode, dial-queue-panel) | SURPLUS | No evidence; conflicts with brief section 8 |
| Booking funnel / where leads leak (bf/*) | SURPLUS | No source asks for it |
| Speed race / setter ranking | SURPLUS | No evidence found |

### Appointments
| Item | Status | Note |
|---|---|---|
| Unmarked appointments queue and alert | COVERED (thesis, not voiced pain) | Real agency calendar permission not approved, so unverified live |
| True show rate, insights tab | COVERED (weak) | Only meaningful with clean statuses; demo/unit tests only |
| No-show recovery list | COVERED (weak) | Blogs only, native workflows compete |
| One-tap outcome marking (write, optional) | GAP / partly | Write scope guarded per standing rule; confirm live |
| Double-booking / multi-appointment detector | GAP | 115-vote thread; our mention of double booking is minimal in insights code |
| Calendar health score | SURPLUS (weak) | Prevention is what people ask for, not a score |
| Booking sources report | SURPLUS | No evidence |
