# Unanswered messages: customer voice (Round 3)

Date: 2026-11-10. Labels: VERIFIED (page opened and read), INFERENCE (my reasoning), UNVERIFIED (search snippet or vendor claim only).

## Coverage and gaps
- Reddit: NOT FOUND. The search tool refuses reddit.com, so no r/gohighlevel, r/agency, r/solar or r/medspa evidence. King should search these by hand.
- Fast Lane Forum, X/Twitter, Facebook groups, YouTube comments: NOT FOUND (not reachable or not indexed).
- G2/Capterra/Trustpilot: only thin snippets, no inbox-specific threads read (UNVERIFIED).
- Almost everything below is the GHL ideas board (ideas.gohighlevel.com), which is real user voice, VERIFIED. Roles are rarely shown; "user" means unstated. Votes are as shown at fetch time.

## Items
1. **Unreplied filter missing.** Inbox filters by last-message direction, not "customer waiting". Workflow messages hide unanswered replies. Andrew Madsen, user, Sep 2025 and Apr 2026, merged into a 2022 post (15 votes, same pain from Carla AO). ideas.gohighlevel.com/conversations/p/allow-users-to-filter-conversations-inbox-for-contact-reply. VERIFIED. Recurs: 3 posts merged.
2. **Replies to unassigned contacts invisible.** Replies show only to the assignee; "My Chat" misses unassigned; assigned-only users cannot see them. Jay Martin, user, Mar 15 2025, 10 votes. Comment by Garrett Meyer, Sep 22 2026: "hides leads until the client asks did anyone see this". .../conversations/p/bug-report-missing-sms-email-replies-due-to-contact-assignment-rules. VERIFIED.
3. **No alerts for unassigned contacts.** Notification setting is "all" or "assigned to me"; unassigned fall through. Joe S, user, Feb 2 2024, 3 votes. .../users-permissions/p/notifications-for-unassigned-contacts. VERIFIED.
4. **Cannot see "mine + unassigned" at once.** Must reset filters each session, so unassigned leads get missed. Christian Santiago, user, Sep 29 2026, 2 votes. .../conversations/p/feature-request-save-custom-inbox-filter-views-in-conversations. VERIFIED.
5. **Setters cannot see or claim unassigned leads.** Inbound goes to whoever answers first, but "assigned only" users cannot self-assign. Nathan Cameron Apr 2024, 99 votes, merged posts from 2022 and 2023 (Zachary Schubert, Ryan Hartigan, Dani Repasky). .../users-permissions/p/can-only-see-their-own-leads-unassigned. VERIFIED. Recurs: 4+ authors over 4 years.
6. **Notifications reach everyone, clients confused by several replying.** Joe M, Jul 20 2025, 12 votes; Eddy (CEO, WhatSnap.ai) Apr 14 2026; Ryan Jenkins Aug 2025 says he lost clients overwhelmed by one mega thread. .../conversations/p/conversation-notifications-should-only-go-to-assigned-user-for-mobile-app. VERIFIED.
7. **Spam floods the inbox, hides real leads.** "Mark as spam" requested May 4 2023, 811 votes, still Planned. Kevin Russell Oct 15 2026: real leads missed in the clutter. Bryce Claudin Apr 2026: about 75% of contacts are spam. Marc C Jul 2026: 40+ spam calls a day. PM said Oct 15 2026 it is prioritised this quarter. .../conversations/p/mark-as-spam-in-conversations. VERIFIED. Recurs: 15+ comments.
8. **"DND Incoming" does not block Instagram/Facebook/email.** Will Mitchell Feb 25 2024, 25 votes; Jack Wheeler (360 Fitness) Nov 2024; Eddy Apr 2026. .../conversations/p/make-dnd-incoming-apply-across-all-incoming-conversation-channels. VERIFIED.
9. **Internal team emails clutter the inbox and notifications.** Stefan Asseg Jun 5 2024, 102 votes, Planned (Jun 2026). Ryan Hartigan: a customer asked why their salespeople appear as contacts. .../conversations/p/ignore-internal-emails-in-conversations. VERIFIED.
10. **Unread is not "handled".** Opening a chat does not mark it read; only a reply or manual action does. Will Ralfe Apr 6 2025, 54 votes. Eddy: team must be trained or counts drift. .../conversations/p/unread-messages-not-marking-as-read-when-opened. VERIFIED. Recurs: 8 comments.
11. **Cannot measure staff reply speed.** Abed Malak Apr 16 2024, 41 votes. Eddy Mar 24 2026: tracking in spreadsheets, "painful". Wes P Feb 2026: no view of sales team activity. .../conversations/p/we-need-a-way-of-tracking-response-times. VERIFIED.
12. **Need to know if a human replied.** "User Replied" trigger for SLA tracking and stopping sequences. Wateeb Khan Apr 17 2026, 286 votes, marked Complete Jul 2026. Francisco Quesada Aug 2026: it misses replies sent from Facebook, Instagram, WhatsApp apps. .../automations/p/user-replied-trigger. VERIFIED.
13. **Many sub-accounts, no combined inbox.** Jenny Hobbs Jul 9 2025, 6 votes; Billy Holdeman-Bass agrees Aug 2026. .../users-permissions/p/view-multiple-sub-account-inboxes-in-one-place. VERIFIED. Related requests (toggle agency accounts, push alerts lost when logged in via agency) seen as titles only: UNVERIFIED.
14. **Opportunity-level round robin missing.** New lead's contact gets an owner, the deal stays ownerless. Late 2024 request, .../automations/p/assign-user-to-opportunity-action. UNVERIFIED (snippet).
15. **Clients call leads "garbage" while nobody tracks follow-up.** Agency sales practitioner, Aug 14 2026; lists ownerless leads, after-hours leads waiting till morning, one-call-and-stop. Agencies cannot show what happened after delivery. salesgem.io/blog/agency-clients-dont-follow-up-on-leads/. VERIFIED read, but vendor-promoting and anecdotal.
16. **Slow contact mislabelled as bad leads.** WhatConverts and BoomTown blogs; a cited 70% vs 22% answer rate (1 hour vs 4 hours). Vendor marketing, UNVERIFIED.
17. **Missed form notifications.** A Trustpilot reviewer lost opportunities. Date and URL not captured. UNVERIFIED.
18. **After-hours leads.** No direct customer complaint found. Only vendor/agency blogs; native "Working Hours" exists for Conversation AI agents only. NOT FOUND as first-hand voice.

## What GHL already shipped (affects our wedge)
- Conversation SLAs with live timers and overdue filters (VERIFIED, changelog, no date shown). Admin-only SLA Performance dashboard, data from Mar 23 2026, needs Labs and the new Conversations UI (UNVERIFIED, search summary). SLA dashboard widgets with a 1-year limit (VERIFIED).
- Wait step "User Replied" with timeout (VERIFIED via item 12).
- INFERENCE: all of this is per account and opt-in. Cross-account ranking, proof to clients, and "never set up" detection remain gaps.

## Top 8 pains (frequency x money)
1. Ownerless or unassigned conversations missed (items 2 to 5, 14). About 4 posts, 110+ votes, spanning 2022 to 2026. Directly lost leads.
2. Spam and junk burying real leads (7, 8, 9). 811 + 102 + 25 votes. Missed leads plus wasted setter time.
3. Cannot prove or measure reply speed (11, 12, 15). 41 + 286 votes. Retention risk: client blames the agency.
4. No "customer waiting" view; unread is not unreplied (1, 10). 15 + 54 votes.
5. Client blames "bad leads" (15, 16). Few first-hand voices, INFERENCE that it is high money (churn).
6. Juggling many sub-accounts (13). Low votes (6), but it is the agency's daily reality (INFERENCE).
7. Notification noise and misrouting (3, 6, 9). About 12 votes plus comments.
8. After-hours and weekend leads (18). Vendor voice only; weakest evidence.

## Implication for the module (INFERENCE)
Lead with "customers waiting with no human reply, grouped by owner, including ownerless", ignore spam and internal contacts by default, and show a cross-account view. Do not promise SLA features GHL now ships natively.
