# Unanswered messages: research summary for King (10 Nov 2026)

Four research files sit next to this one (R1 GHL landscape, R2 competitors, R3 customer voice, R4 data/ROI/moat). Every claim there has a link and a label: VERIFIED (read at the source), INFERENCE (reasoning), UNVERIFIED (snippet or vendor claim). Reddit, X, YouTube and Facebook could not be searched, so customer voice comes almost only from GHL's own ideas board.

## 1. Will people buy it?
- **The pains are real and old.** They are on GHL's own ideas board with vote counts, some open since 2022. VERIFIED.
- **Whether they will PAY is not proven.** No review or forum says "I would pay for this". Only your pilot agencies can prove that.
- **Price check:** AgencyAnalytics lists $20 per client for reporting plus alerts. SubSync at $11.50 per client account is under that anchor. VERIFIED anchor, INFERENCE on willingness.

## 2. The pains, ranked by votes and money (all from the GHL ideas board, VERIFIED)
| # | Pain | Evidence | Money impact |
|---|---|---|---|
| 1 | **Ownerless conversations are missed.** Replies show only to the assignee. Setters cannot see or claim unassigned leads. | 99 votes (4 authors, 2022 to 2026) plus 10, 3 and 2 vote posts. A comment: it "hides leads until the client asks did anyone see this" | Directly lost leads |
| 2 | **Spam and junk bury real leads.** | "Mark as spam": 811 votes, GHL says it is prioritised this quarter. Internal emails 102 votes. | Missed leads, wasted setter time. GHL is fixing it, so do not build a big moat here. |
| 3 | **Cannot measure or prove reply speed.** Agencies track it in spreadsheets, "painful". | 41 votes (response times), 286 votes ("User Replied" trigger, shipped July 2026) | Client blames the agency, churn risk |
| 4 | **No "customer is waiting" view.** Unread is not "handled". | 15 votes (unreplied filter), 54 votes (opening a chat does not mark it read) | Daily friction |
| 5 | **Client blames "bad leads"** when the real cause is slow follow-up. | Agency practitioner post, Aug 2026 (anecdotal, vendor-promoting) | Retention (INFERENCE) |
| 6 | Many client accounts, no combined inbox. | Only 6 votes. Weaker than I said earlier. | Daily reality for agencies (INFERENCE) |
| 7 | Notifications reach everyone or the wrong person. | About 12 votes | Noise |
| 8 | After-hours leads. | No first-hand voice found, vendor blogs only | Weakest evidence |

## 3. What GHL already ships (do not promise this)
Conversation SLA timers per account (calendar hours), an admin-only SLA Performance dashboard per account (from 23 Mar 2026; one source says it needs Labs), the "User Replied" wait step, an unread view. All per account, opt-in, and the timer stops when a chat is marked read. A cross-account native view in 12 months is plausible. INFERENCE.
**There is one conflict between files:** R1 says first-response reporting is only a request; R4 and R3 say the SLA dashboard exists. Treat the dashboard as existing and check it in your own account.

## 4. Competitors (R2)
Aloware, Kixie and Hot Prospector are per-seat dialers. Front, Help Scout and Zendesk have strong reply-time rules but are single-inbox. AgencyAnalytics ($20 per client) does reporting and alerts. Not found in any tool checked: a cross-client "who is still waiting" view with client-ready proof. This comes from pricing pages only, so interview agencies before claiming it publicly. Lead Source and Conversica were not assessed.

## 5. Benchmarks and the dollar claim (R4)
- **No vertical has a trustworthy "reply speed to booking rate" curve.** Med spa and coaching have no study at all. Legal is best sourced: median 13 minutes across 1,333 firms (2025, speed only). Real estate median 39 minutes (vendor audit). The famous "21x" is a 2007 study of six companies and is often misattributed. Never show those multipliers as fact.
- **Dollars at risk, safe version:** `waiting leads over target x this account's booking rate x close rate x average deal value x a conservative speed penalty`. Always labelled an estimate with a low-to-high range, formula one tap away, and "not enough data" until the account has about 30 closed deals or 100 leads. Plain counts ("12 leads never answered") need no model.

## 6. The moat (what a competitor cannot copy)
| # | Feature | Why it is a moat | Possible when |
|---|---|---|---|
| 1 | **The account's own speed-to-outcome curve** ("answered under 5 min: 38% book; over 1 hour: 9%") | Needs months of timestamps GHL does not keep. Would be the first real curve for appointment-driven SMBs | 1 agency, about 3 months |
| 2 | **Proof Receipts** (alerts caught, who fixed it, leads booked after, trend) | Our own history of alerts and what happened next | 1 agency, about 2 months |
| 3 | Setter and closer scorecards across accounts | Cross-account owner history | 3 agencies |
| 4 | Vertical peer benchmark ("median 14 min vs your 41") | Network effect. Opt-in, aggregate only, at least 10 accounts from 5 agencies per cell | 15 to 25 agencies |
| 5 | Calibrated dollars at risk (penalty learned from real data) | Needs outcomes at scale | 20+ agencies |
| 6 | Predict which lead is about to go cold | Model on cross-agency outcomes | 30+ agencies |

**Start recording now, raw timestamps only:** a vertical tag per account, business hours and timezone, lead created time, channel, first human touch and who, automated touch flag, owner at each change, booked/showed/no-show, won/lost with value, the target at the time, alerts fired and what happened next. History cannot be rebuilt later.

## 7. Risks
GHL ships the same natively (watch the changelog). API budget is 100 requests per 10 seconds per app per location, so the sync must pace itself. False alarms (after-hours, spam, phone replies, automatic replies counted as human): handle with business hours, a "human vs automatic" setting, snooze and one digest instead of per-lead pings. Bad ownership data: show "ownerless" as its own finding and never blame a person without a verified assignment. Benchmarks and privacy: needs a lawyer and an opt-in before launch.

## 8. What this changes in the plan
1. **Lead with ownerless conversations, and let a setter claim one.** It is the top verified pain (99 votes).
2. **Receipts and the speed-to-outcome curve** are the moat that works with one agency. Start recording the data now.
3. **Hide spam and internal contacts by default** in our queue instead of building delete. GHL is shipping native spam marking. Delete stays narrow and later.
4. Snooze/handled, internal note, then the redesign to the Speed standard.
5. Benchmarks wait for 15+ agencies. Collect the vertical tag now.

## 9. Still needed from King
Interview 5 agency owners ("How do you know your client's leads are answered?"). Search Reddit and Facebook groups by hand (the search tool cannot reach them). Confirm the SLA dashboard in your own account. Find one med spa or solar agency willing to share anonymised timestamps.
