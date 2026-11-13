# Sales-team pain points an AI helper can fix (12 Nov 2026)

Question: what hurts setters, closers, managers and agency owners (home services, med spa, solar, real estate, coaches, info-product offers), what can an AI job fix using only our GoHighLevel data, and what would they pay for?

## 0. How to read this (honest limits)
- Reddit, Facebook groups, Discord and G2 review pages could NOT be read (G2 returned 403; Reddit never surfaced in search). There are no Reddit quotes here. "In their own words" lines are paraphrased from vendor and forum pages, and marked as such. Do not treat them as verbatim customer quotes.
- Labels: VERIFIED = I read the page. REPORTED = a search summary or a secondary page quoting someone else. INFERENCE = my reasoning.
- Many numbers come from vendors who sell the fix. Treat as direction, not proof. Real proof of payment comes only from the 10 interviews in section 5.
- Already in the repo and not repeated here: `docs/AI_AGENTS_PLAN.md` (14 planned jobs, API-key-per-tenant, number post-check) and `docs/research/PAINPOINTS_SUMMARY.md` (per-module pain). This file adds sales-floor evidence and ranks AI jobs.

## 1. The evidence that matters (short list)
| # | Fact | Source | Label |
|---|---|---|---|
| E1 | Reps spend about 40% of the week selling, 60% (about 24 h) on admin, data entry, internal meetings, CRM upkeep | Salesforce State of Sales 2026 (n=4,050) as quoted in [attention.com](https://www.attention.com/blog-posts/crm-data-entry-tax-rep-time-2026) | REPORTED (page read, original report not read) |
| E2 | 68% of reps say note-taking and data input are the most time-consuming tasks; 43% say admin takes 10 to 20 h a week | same page, citing State of Sales 6th ed. | REPORTED |
| E3 | Only 35% completely trust their organisation's data | same page, citing State of Sales 2026 | REPORTED |
| E4 | Reps do not follow up within 24 h 32% of the time; when they do, win rate is +14% and deals are 11% shorter | [Gong Labs blog](https://www.gong.io/blog/data-shows-these-3-seller-mistakes-are-costing-you-time-and-money) | VERIFIED (vendor data) |
| E5 | Deals where every action item was completed win 20% more; 45% of sellers say a critical action item falls through the cracks each week; one extra email to a silent prospect more than doubled win rate vs nothing | same Gong page | VERIFIED (vendor data) |
| E6 | Only 45% of sales leaders and sellers have high confidence in their forecast accuracy | [Gartner 2020 press release](https://www.gartner.com/en/newsroom/press-releases/2020-02-12-gartner-says-less-than-50--of-sales-leaders-and-selle) (403 when fetched; figure from search summary) | REPORTED, old (2020) |
| E7 | Speed: 2007 MIT/InsideSales study is the source of "5 minutes" claims; HBR 2011 "The Short Life of Online Sales Leads" audited 2,241 US firms and found most reply too slowly. Many blogs mix the two | search summaries; [HBR page](https://hbr.org/2011/03/the-short-life-of-online-sales-leads) gives only a teaser | REPORTED. Do NOT quote "21x" as HBR |
| E8 | 27% of calls to home-services businesses go unanswered; under 3% of callers who hit voicemail leave a message (Invoca's own data) | [Invoca](https://www.invoca.com/blog/how-much-missed-sales-calls-cost-home-services-businesses) | VERIFIED (vendor). CallRail 2025 puts it at 14% (REPORTED). Dollar-per-call claims ($200 to $1,200) vary wildly: INFERENCE only |
| E9 | No-show rate by call time ranges about 17 to 19% in Gong's sales-call data; weekend calls about 4x higher | HubSpot and Gong posts via search | REPORTED |
| E10 | Med spa: vendor claims that deposits cut no-shows (25 USD deposit about 15 to 18%; 100 USD+ about 5 to 7%) and that fast follow-up lifts lead-to-consult booking from about 12% to 22% | vendor blogs via search | REPORTED, weak (marketing) |
| E11 | GHL ideas board: "AI lead summary from 90 days of activity" asked by 3 people (one says they are trying to build it themselves); lead scoring about 140 votes (marked complete 2024, a commenter could not find it); "Ask AI" board items mostly 1 to 7 votes, top one 35 | [ideas: AI summary](https://ideas.gohighlevel.com/contacts/p/ai-lead-summary-based-on-90-days-activity-and-conversation), [ideas: lead scoring](https://ideas.gohighlevel.com/conversations/p/adding-lead-scores-for-each-customer-actionengagement), [ideas: Ask AI](https://ideas.gohighlevel.com/ask-ai) | VERIFIED. Read: lead scoring is a real ask; "AI summary" demand is thin |
| E12 | Gong small-team complaint: platform fee reported as 5,000 to 10,000 USD a year plus seats; Reddit-sourced claim of about 12,000 USD a year for 3 seats | competitor blogs via search | REPORTED (competitors wrote these) |
| E13 | AI SDR tools (11x, Artisan): repeated complaints of generic emails, zero meetings, churn after 30 to 60 days, 36,000 to 65,000 USD a year contracts | search summaries of vendor and rival blogs | REPORTED |
| E14 | AI notetakers: action items needed about 30% manual cleanup; no tool above about 75% action-item accuracy in one tester's run; CRM-sync issues recur | search summaries (DEV post, G2 comments) | REPORTED |
| E15 | Agencies: 47% of leaders say client reporting is critical for retention (AgencyAnalytics 2024); 43% say their hardest reporting problem is showing metrics that prove value; 36% of agency staff cite churn or unstable revenue as the top profit hit (AAAA) | search summaries of vendor and trade surveys | REPORTED |
| E16 | Close on G2: 4.7 of 5 over 2,073 reviews, top complaint is missing features. Aloware: 4.1 of 5 over 827, call issues and slowness. Kixie: 4.8 of 5 over 862 | G2 comparison pages via search | REPORTED |
| E17 | Dealer forum thread: managers say the only thing that keeps CRM updated is a daily review of overdue tasks and leads with no next step | [DealerRefresh](https://forum.dealerrefresh.com/threads/how-often-do-your-sales-reps-actually-update-the-crm-after-customer-calls.13520/) | REPORTED (search summary) |

Read-across (INFERENCE): the strongest, most repeated pain is "follow-up falls through the cracks" (E4, E5, E8, E17) and "nobody keeps the CRM true" (E1 to E3). Both are things we can see from CRM metadata without reading a word of a message. The weakest evidence is for anything that needs a lot of rep-by-rep voice or text content.

## 2. Top 15 pain points, ranked (pain x how often x willingness to pay)
Scoring is mine (INFERENCE) from the evidence above. "Pay" = would a GHL agency or business pay extra for it from us.

### 1. Leads and missed calls nobody answers or owns
- Who: agency owner (blamed by the client), setter, business owner.
- Evidence: E4, E8; PAINPOINTS_SUMMARY ranks speed-to-lead as the strongest module (87-vote call-data ask).
- Paraphrase: "The client says the leads are bad; the leads were never called."
- AI job: who to call first + why it is stuck (see jobs below).
- Data: contacts created, first inbound/outbound message and call times, assigned user, missed calls, tags. HAVE (speed-to-lead engine).
- Output: a ranked list, each row one plain sentence ("Asked for a quote Tue 4pm, called once, no answer, no text since").
- Guardrails: counts from SQL; AI only writes the sentence; no messages sent.
- Pay: YES. Anchor: AgencyAnalytics about 12 to 15 USD per client; our Pro 11.50 USD per account already covers the alerts. AI part: bundle, not a separate price.

### 2. Appointments that happen (or not) and nobody records the result
- Who: owner, setter, closer.
- Evidence: PAINPOINTS_SUMMARY (status problems, double-booking 115 votes); E9, E10.
- Paraphrase: "Half my calendar says 'booked' even though the visit was last week."
- AI job: no-show recovery plan + outcome nudges ("this looks like a no-show: Mark it?").
- Data: appointments, status, start time, contact history, workflow/tag signals. HAVE.
- Output: recovery list with one-line reason and a draft text for human approval.
- Guardrails: never auto-send; skip DND; never change status without one-tap confirm; audit log.
- Pay: YES (money is visible: no-show recovered = booked job). Anchor: Hot Prospector-style speed tools are sold as agency add-ons; price as part of Pro or 5 to 10 USD per account.

### 3. Follow-ups forgotten: leads quietly go cold
- Who: setter, closer, owner.
- Evidence: E4, E5 (45% lose an action item weekly; extra email doubles win rate).
- Paraphrase: "I told her I'd call Thursday. I didn't."
- AI job: follow-up plan per lead (next step, date, reason) and "why did it go cold".
- Data: conversation metadata (direction, time, who), tasks, stage history, appointment outcomes. HAVE. Message text: optional (needs per-account opt-in).
- Output: "Next step: call Thursday. Last touch 9 days ago. Asked about price." Cold reasons grouped across the account.
- Guardrails: reasons must come from a fixed list we compute (no reply, no owner, price asked, no-show, ghosted after quote) and AI only explains; no invented facts.
- Pay: YES. Highest daily-use job.

### 4. Nobody keeps the CRM clean (stages wrong, notes missing, owner blank)
- Who: manager, owner (and the client who sees dirty data).
- Evidence: E1 to E3, E17.
- Paraphrase: "Reps hate updating next steps." (vendor-quoted customer; VERIFIED on attention.com page.)
- AI job: data review + cleaning proposals (stage looks wrong, deal has no owner, contact missing phone).
- Data: opportunities, stage history, contacts, custom fields, tasks. HAVE.
- Output: a reviewable list "12 deals look stuck or mis-staged: apply all / one by one".
- Guardrails: preview, confirm, undo, typed confirm on deletes; protected contacts (open deal, appointment, payment, DND) never touched.
- Pay: MAYBE alone (GHL ships duplicates and auto-merge), better as part of the weekly proof. Anchor: cleaning tools 0 to 20 USD per account.

### 5. Agency cannot prove its work to the client (churn risk)
- Who: agency owner.
- Evidence: E15 (47% say reporting critical for retention; 43% struggle to show value).
- Paraphrase: "The client asks what they are paying me for."
- AI job: monthly client report in plain words (what we caught, what was fixed, what happened).
- Data: our event store (alerts, SLA, show rate, recoveries). HAVE and it is the moat (history cannot be rebuilt).
- Output: one page the agency can forward, with the agency logo; numbers from SQL.
- Guardrails: number post-check; no claims we cannot show; no GHL words (white-label rule).
- Pay: YES. Anchor: AgencyAnalytics 12 to 15 USD per client; Two Minute Reports similar. Strongest "money first" feature for agency owners.

### 6. Owner does not know what changed overnight
- Who: owner, manager.
- Evidence: PAINPOINTS_SUMMARY (all-accounts view, 70-vote ask since 2020).
- AI job: 7am brief (five lines: what broke, who to call, what is at risk).
- Data: all rollups. HAVE.
- Output: email or Slack message; one main action per line.
- Guardrails: numbers from SQL; capped length; opt-in; quiet hours.
- Pay: YES as the habit that keeps them subscribed (retention), not as a line item. Cost 1 to 3 cents a day (AI_AGENTS_PLAN estimate).

### 7. Call and meeting notes are not written, or written badly
- Who: setter, closer, solo coach.
- Evidence: E1, E2, E14. Fathom ask 48 votes in GHL ideas (PAINPOINTS_SUMMARY).
- Paraphrase: "I spent more time writing the note than on the call."
- AI job: meeting summary + follow-up draft from Fathom summaries (the customer's own Fathom account).
- Data: Fathom call summary, matched contact (exact email only). HAVE (meeting notes module).
- Output: 3-line summary, action items, a draft follow-up for approval, posted as a note.
- Guardrails: match by exact email else wait in private inbox; our own notes excluded from metrics; no cross-client placement.
- Pay: MAYBE. Notetakers are cheap or free (Fathom, Fireflies) and GHL may build Fathom natively. Do not charge separately; use as stickiness.

### 8. Reps do not know who to call first
- Who: setter, closer.
- Evidence: lead scoring about 140 votes (E11); E4.
- AI job: "who to call first" ranking.
- Data: recency, source, replies, appointments, stage, deal value. HAVE.
- Output: top 10 with one reason each.
- Guardrails: rule-based score first; AI only explains; show "why" every time; no hidden score.
- Pay: YES (daily use). Anchor: native lead scoring exists but poorly found (E11 comment).

### 9. Managers cannot coach (no time to listen to calls)
- Who: manager, agency owner with setters.
- Evidence: Gong's whole market; E12 shows price is the pain, not the need.
- AI job: setter/closer coaching notes from metadata (speed, follow-up count, outcomes) plus optional Fathom summaries.
- Data: users, calls, messages by user, appointments, outcomes. HAVE metadata; call audio/transcripts NOT available except Fathom.
- Output: per-rep weekly note: "Fast first reply, but 40% of leads get only one touch".
- Guardrails: never a ranking of people without enough data; show sample size; manager-only visibility.
- Pay: MAYBE-YES for agencies with 3+ setters. Anchor: Gong from about 5,000 to 12,000 USD a year minimum (REPORTED), so 15 to 30 USD per seat undercuts it by a lot.

### 10. Pipeline is wrong and the forecast is a guess
- Who: owner, closer.
- Evidence: E6; PAINPOINTS_SUMMARY (no stage history, 13 votes; no time in stage, 10).
- AI job: deal health check + forecast in words.
- Data: opportunities, stage history from our event store. HAVE (history grows with time).
- Output: "8 deals stuck over 14 days; likely 2 to 3 wins this month; low confidence".
- Guardrails: show "not enough data" below a minimum number of closed deals; a range, never a single number; label estimate.
- Pay: MAYBE. Real accounts rarely have 20 closed deals (PAINPOINTS_SUMMARY says so). Ship health check first, forecast later.

### 11. Automations break silently
- Who: agency owner.
- Evidence: PAINPOINTS_SUMMARY (no cross-account error view; high pain).
- AI job: setup auditor + "why leads stopped" explanation.
- Data: workflow health, outcome gaps (no outbound after form fill). HAVE partial.
- Output: "Missed-call text-back looks off in 3 accounts".
- Guardrails: outcome-based inference only; no writes.
- Pay: YES-MAYBE. Strongest as an alert, AI explains it.

### 12. Duplicates and messy contacts
- Who: owner, setter.
- Evidence: PAINPOINTS_SUMMARY (GHL ships dupes and auto-merge).
- AI job: duplicate judge for uncertain pairs.
- Data: contacts, activity. HAVE.
- Output: "Same person? Yes 85%: same phone, name spelled differently".
- Guardrails: protected contacts never merged; preview and undo.
- Pay: NO alone. Included feature.

### 13. Asking simple questions needs a report builder
- Who: owner.
- Evidence: Ask AI board items are 1 to 35 votes (E11), so the market is not shouting for it.
- AI job: ask-your-data box.
- Data: our rollups only (never raw SQL from the model).
- Guardrails: tenant-bound, number check, cost cap. Highest risk and cost.
- Pay: MAYBE (wow in demos, little repeat use). Build last.

### 14. Deal losses are never reviewed
- Who: owner, closer, coach.
- Evidence: Gong's win/loss claims; weak in our segment (INFERENCE).
- AI job: win/loss review.
- Data: closed deals, stage path, lost reason (often blank). Partly HAVE; lost reasons are usually empty in real GHL accounts (INFERENCE).
- Pay: NO until lost reasons are filled. Low priority.

### 15. Churn or sudden drops are not explained
- Who: owner.
- Evidence: E15 (36% cite churn as profit hit).
- AI job: churn/anomaly explanation ("leads down 40%: form stopped sending on Oct 28").
- Data: daily rollups and event store. HAVE as history grows.
- Pay: YES if it names a cause; otherwise it is noise.

## 3. What NOT to build (and why)
1. AI that texts or emails leads on its own. Consent, spam and brand risk; GHL workflows and Hot Prospector-type tools already do it (master brief rule). Drafts for human approval only.
2. AI SDR / cold outreach. Crowded; E13 shows churn at 30 to 60 days and 36,000 USD plus contracts; wrong customer for us.
3. Call recording, transcription, dialer, voice agent. Telephony burden; Fathom, Fireflies and GHL's own Voice AI exist.
4. Generic AI chatbot over everything (as a first release). Hard to verify, costly, little demand in GHL ideas (E11).
5. Hidden lead score with no reason shown. Reps ignore what they cannot explain.
6. Full-blown forecast for small accounts. Not enough closed deals.
7. Anything reading message text by default. Privacy and trust: metadata first, text only with a per-account opt-in.
8. Auto-merge or auto-delete of contacts. Violates protect-people rule; GHL does auto-merge itself.
9. White-label PDF / QBR builders as separate products (already marked DEFER in the brief); the monthly report job covers it.

## 4. Build order for AI jobs (money first, customer second, innovation third)
Mapped to the planned job list. All use the customer's own AI key, numbers from SQL, suggestions only at first.

| Rank | AI job | Why this slot | Pain # | Data ready? |
|---|---|---|---|---|
| 1 | Monthly client report (narrated proof) | Direct money and agency retention; uses our unique history | 5 | Yes |
| 2 | Who to call first (reasons) | Daily use, clear win, rule-first so low risk | 8, 1 | Yes |
| 3 | 7am brief | The habit that keeps the subscription | 6 | Yes |
| 4 | Lead summary + next step (follow-up plan) | Fixes forgotten follow-up, the top repeated pain | 3 | Yes (metadata); text optional |
| 5 | Why leads go cold (grouped reasons per account) | Gives agencies a talking point with clients | 3, 1 | Yes |
| 6 | Reply drafts (human approved) | Speeds the fix for 1 and 3; build after 4 | 1, 2, 3 | Yes, needs text opt-in |
| 7 | No-show recovery plan (inside reply drafts) | Direct revenue | 2 | Yes |
| 8 | Churn/anomaly explanations | Saves accounts; needs history to grow | 15 | Partial |
| 9 | Setter/closer coaching notes | Paid by agencies with setters; needs sample size | 9 | Metadata yes |
| 10 | Meeting summary + follow-up | Stickiness, not revenue | 7 | Yes |
| 11 | Setup auditor | Onboarding and alert quality | 11 | Partial |
| 12 | Deal health check | Needs stage history | 10 | Grows with time |
| 13 | Data review + cleaning proposals | Part of proof, low standalone pay | 4 | Yes |
| 14 | Duplicate judge | Included extra | 12 | Yes |
| 15 | Forecast in words | Wait for enough closed deals | 10 | Often no |
| 16 | Ask-your-data box | Highest cost and risk, last | 13 | Yes |
| 17 | Win/loss review | Lost reasons usually blank | 14 | Weak |

Packaging (INFERENCE): jobs 1 to 5 inside Pro as small monthly allowances (so Pro keeps its 11.50 USD per account promise), heavy use through the meter. Keep AI cost around 3 to 5 times lower than the price (AI_AGENTS_PLAN section 4).

### NEW jobs worth adding (labelled NEW, need King's approval)
- NEW A. Missed-call and ignored-lead explainer for the client: a plain "your leads and what happened to each" page the agency can show to a complaining client. Evidence: E8 (27% unanswered, under 3% leave a voicemail) and the owner pain "client says leads are bad" (E4, PAINPOINTS_SUMMARY). Data: have. Pay: strong because it ends arguments and protects retention.
- NEW B. Promise-keeper: finds "I will call you Thursday" style commitments in Fathom summaries or notes and checks whether a call or task followed. Evidence: E5 (45% of sellers lose an action item weekly; completed action items +20% win rate). Data: Fathom summaries plus calls/tasks, have. Output: "3 promises made, 2 not kept". Guardrails: only exact-matched meetings; suggestion only.
- NEW C. Reactivation list explainer: for old leads (cold money list), AI suggests the best 25 to wake up and why. Evidence: PAINPOINTS_SUMMARY "reactivation sells as an outcome". Guardrails: DND-safe, draft only. Pay: yes, easy to show dollars.
- NEW D. Weekly "one thing to fix" per account: a single sentence ranked across all findings. Evidence: simplicity rule and E3 (35% trust their data, so fewer, clearer outputs). Cheap, pairs with the brief.

## 5. Ten interview questions for agency owners
Ask for real stories, not opinions. Never pitch. Write down the exact words.
1. Tell me about the last time a client said their leads were bad. What did you check, and how long did it take?
2. How do you know today that every new lead got a reply in 5 minutes? What do you look at?
3. When did a client last find out about a missed call or a lead nobody touched before you did? What happened?
4. How many of your clients' booked appointments actually happen, and who updates the status? How do you know?
5. If you could get five lines every morning about your accounts, what would you want in them? What would make you stop reading?
6. What do you send clients each month to prove the work? How long does it take, and who does it?
7. Which of your clients are you most afraid of losing right now, and what tells you?
8. Would you let an AI write follow-up texts if you approved each one first? What would make you say no?
9. If this saved you one hour a week per client, what would you pay per client per month? What price would be too cheap to believe?
10. What do you pay today for anything similar (reporting, call tracking, notetaker, speed-to-lead)? What do you hate about it?

Success test (INFERENCE): 3 of 10 owners describe a recent incident without prompting, and at least 2 name a price above 10 USD per account. If not, narrow to alerts plus the monthly report.
