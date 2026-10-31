# Buyer review (31 Oct 2026)

This is an AI playing buyers. It is a cheap filter for clarity and trust and **is not evidence that anyone will pay**. Real-human results go in the last section, and there are none yet.

What was actually tested: P1 and P2 in the live app as the agency owner, on three accounts. P5 and P6 partly. P3 (setter) and P4 (local business owner) were **not** tested in the app, because that needs an account-level login; P4 below is judged from copy and screens only.

## P1 Skeptical agency owner, 20 clients

- **5-second test:** Today shows a filter bar, a sync banner, then "$1,000,000 is sitting in 1 deal". It reads like a data-quality message, not "your leads are being missed". The product's job is not stated on screen one.
- **Job task (which client is in trouble, under 60 s):** Today's "Needs attention" list ranks accounts with a reason and an action. This works, though it sits below three blocks of status text.
- **Number trust:** fails. Pipeline says $2,400,000 and 50% win rate on 6 closed deals; Today says $1,000,000. I would not repeat either to a client (UX-01, UX-02).
- **Scores (1 to 5):** clarity 3, trust 2, usefulness 3, effort to get value 4, design 3.
- **Would I pay per account:** $5 maybe, $9 maybe if numbers agree and alerts reach me, $15 no. "What do I get that GHL workflows plus AgencyAnalytics don't give me?" The answer on screen is not obvious.
- **Top 3 reasons not to buy:** the numbers disagree; I cannot see money recovered, only problems; it looks like another dashboard of tiles.
- **Top 3 impressions:** the never-answered and no-owner lead list; the shareable audit link with names scrubbed; Reply and Open contact links one click from each item.
- **Remove:** Clients, Duplicates, Data cleanup, Leads from the main menu.

## P2 Ops manager or VA

- Needs: which client, what to do, in 60 seconds. Today's attention list does this. Risk: alert noise is unknown, since only 5 alerts exist on this data. The permanent "sync still running" banner would train a VA to ignore banners (UX-06).
- Scores: clarity 3, trust 3, usefulness 4, effort 4, design 3. Would pay $9: maybe.

## P3 Setter or closer: **not tested**

Needs an account-level user. Open question for real testing: does a setter land on their own lead list, and are the Team, Settings and plan pages hidden? The automated tests say yes (client and business views passed, 384 cross-reads). Not seen by eye.

## P4 Local business owner: **copy and screens only**

SLA, engagement score, stale, dormant, churn, P90, dwell: none of it is readable by this person. "Am I missing leads?" is not answered in those words anywhere. Would pay: no, as shown. Needs a one-sentence answer on the first screen ("3 leads waiting for a reply") and plain words.

## P5 White-label agency owner

- The sidebar shows "SubSync" and the footer says "Agency view". A Business name setting exists (placeholder "Acme Marketing") but the brand is not set in this account, so the SubSync name is the default.
- The shared audit page and emails show the agency's brand name when set, otherwise "Your agency". Would drop the tool if "Agency view" and SubSync stay visible after setting a brand (UX-05). Needs a retest with a brand name set and a white-label domain.

## P6 Hostile reviewer

- Positives: 21 permissions, all marked optional in the portal; tenant isolation tests; names scrubbed from the shared audit; no CRM brand names in the UI.
- Concerns: the Meeting notes page makes a false claim about not writing to the CRM (UX-03); the privacy policy and terms do not mention that SubSync writes a note to a contact; a public audit link exists (30 days, no names, but unauthenticated); the Zoom client secret and token passed through a screen read during setup (regenerate them); the live app has not been checked for console errors or secrets in the front-end bundle.

## Objections a buyer will raise

1. "Why does it say $1,000,000 and $2,400,000?"
2. "My workflows already alert me." (Answer must be: we check that the workflow actually worked.)
3. "What is the proof it saved me anything?"
4. "Another dashboard." (Cut list below.)
5. "Who sees my clients' data?"

## Cut list (hide from the main navigation, keep code)

Clients (and QBR), Duplicates, Data cleanup, Leads, Meeting notes (move into Settings until proven), Setup (merge into Getting started). That leaves about 11 items: Today, Account audit, Overview, Inbox & SLA, Speed to lead, Appointments, Contact search, Pipeline and deals, Call lists, Accounts, Team.

## Verdict: **FIX THEN PILOT**

Blocking list before any pilot (all from `UX_REVIEW.md` and `METRIC_AUDIT.md`):
1. UX-01 and MET-02: one win-rate minimum, "not enough data" on Pipeline.
2. UX-02 and MET-01: one definition of open pipeline.
3. UX-03: fix the Meeting notes claim; update the privacy policy and terms.
4. UX-04: outlier guard and a lead-first Today.
5. UX-05: land on the account when opened from inside one; rename "Agency view".
6. MET-03: verify "Quiet over 90 days".
7. Test P3 and P4 with a real account-level user.

## Real humans

None yet. Weight these above everything above when they exist. Protocol: `docs/BUYER_AND_UX_REVIEW.md` section 9. The question that matters: "Would you pay $200 for the audit and fix plan this week?"
