# Unanswered messages: GHL native and marketplace landscape (R1)

Researched 2026-11-10. Labels: VERIFIED = fetched and read the primary page; INFERENCE = reasoning or third-party/search summary; UNVERIFIED = not confirmed. Marketplace UI could not be browsed.

## 1. Native Conversations inbox
- **Filter builder:** Assigned, Follower, Mention, Last Message Direction (inbound/outbound), Last Outbound Message Type (manual/automated), Last Message Channel, Tag. No dedicated "unreplied" filter; "last message inbound" is the closest. Sort "Oldest Manual Messages" exists. Bulk actions: mark read/unread, star, delete (100 per batch, INFERENCE from third parties). VERIFIED. https://help.gohighlevel.com/support/solutions/articles/48001222121-overview-of-conversation-filters
- **Conversation SLAs:** per-account toggle; needs the "CRM Redesign" Labs flag. Timer starts at the oldest unanswered customer message; stops on a team reply or "mark as read" (so marking read hides a missed reply). Statuses Active/Due Soon/Overdue; sort "Longest SLA Overdue". Workflow messages off by default; AI replies count by default. No business hours (calendar hours only). SLA reporting and SLA workflow triggers "not available yet". Applies only to messages arriving after enabling. VERIFIED. https://help.gohighlevel.com/support/solutions/articles/155000006745-how-to-setup-conversation-slas
- **Manual Actions:** Conversations > Manual Actions holds call/SMS tasks from workflows (pending, missed, completed). Completion semantics disagree across sources. INFERENCE. https://www.trellus.ai/post/diagnose-gohighlevel-manual-call-task
- **Mobile/push:** push opens the conversation (app v3.49.4); WhatsApp alerts added. No evidence of "unassigned only" or "unreplied for X" alerts. INFERENCE. https://highlevel.canny.io/changelog/highlevel-leadconnector-mobile-app-production-release-v3494
- **Snippets:** UNVERIFIED (not found in a primary source).

## 2. Workflows
- **Wait step with "User Replied":** pauses until a team member replies, with optional timeout; on timeout escalate (notify, reassign, task). Examples: 30-minute support SLA, 15-minute sales SLA. Date not shown. VERIFIED. https://ideas.gohighlevel.com/changelog/wait-step-now-with-support-for-user-replies
- **Limit:** the User Replied trigger reportedly ignores workflow and Conversation AI messages. INFERENCE (agency blog). https://www.ghlscaleup.com/blog/law-firm-lead-follow-up-gohighlevel
- **Assign To User:** single user or round robin/split traffic; "only apply to unassigned contacts" toggle, else it overwrites. Assignment is on the contact; conversation owner is a related but separate field. VERIFIED (via search summary). https://help.gohighlevel.com/support/solutions/articles/155000003300
- Missed-call text-back, stale-lead and no-response ladders exist natively, per account, built by the agency. INFERENCE.

## 3. Reporting
- Official ideas board still asks for First Response Time (106 votes, merged post last active April 2026, no status label). Strong sign native first-response reporting is incomplete. VERIFIED. https://ideas.gohighlevel.com/dashboard/p/first-response-time-tracking-for-new-leads
- SLA widgets and an SLA dashboard (met/breached by user and channel, average first response) exist per account; no roll-up seen. INFERENCE (prior repo research, `docs/research/TODAY_COMPETITORS.md`, via mirror of articles 155000008084 and 155000007658).
- This conflicts with the SLA article's "reporting not available yet". Treat as CHECK in a live account.
- Agency roll-up is activity counts and reselling money, not lead handling (same prior research). INFERENCE.

## 4. API and webhook facts that shape us
- **Rate limits:** 100 requests per 10 seconds burst, 200,000 per day, counted per app per location/company, so each install gets its own budget. 429 has no Retry-After; headers `X-RateLimit-Remaining`, `X-RateLimit-Daily-Remaining`, `X-RateLimit-Daily-Reset`. VERIFIED. https://marketplace.gohighlevel.com/docs/other/rate-limits.md
- **Search conversations:** scope `conversations.readonly`. Filters: `assignedTo` (incl. `unassigned`), `status` (all/read/unread/starred), `lastMessageDirection`, `lastMessageAction` (automated/manual), `lastMessageType`. Sort by `last_message_date` or `last_manual_message_date`. Response documents `unreadCount`, `lastMessageBody/Type`; docs do not list `lastMessageDate`, direction or `assignedTo` in the response (CHECK with live call). Default limit 20, `startAfterDate` pagination. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/conversations/search-conversation.md
- **Messages:** scope `conversations/message.readonly`. Fields `direction`, `status` (includes `read`, `failed`, `opt_out`), `userId`, `source` (workflow, bulk_actions, campaign, api, app), `messageType`, `dateAdded`. Cursor `lastMessageId`. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/conversations/get-messages.md
- **Webhooks:** InboundMessage (all channels incl. call/voicemail, with `conversationId`, `userId`), OutboundMessage (includes internal comments, `userId`/`source` present on user sends, absent on a workflow example), ConversationUnreadUpdate (`unreadCount`, `inbox`, `starred`, `deleted`). VERIFIED. https://marketplace.gohighlevel.com/docs/webhook/OutboundMessage.md ; https://marketplace.gohighlevel.com/docs/webhook/ConversationUnreadWebhook.md
- **Implications:** (a) internal comments appear in OutboundMessage, so exclude them from "replied" (rule 14 applies); (b) `read` status and marking-as-read must not count as a reply; (c) no "unreplied" flag, so we compute it from direction plus time, and the event store is the real history.

## 5. Marketplace and adjacent apps
| App | Price | Installs | Lane | Gap |
|---|---|---|---|---|
| All The Apps | $129/$299/$499 per month (brief, not re-confirmed) | about 197K (brief; one listing summary) | white-label suite, dashboard builder | no seen response-time or unanswered tracking (Measure screen unseen) INFERENCE |
| Hot Prospector | quoted $137 to $750 (conflicting, third party) | UNVERIFIED | speed-to-lead score, free audit, dialer | per account; alerts and agency roll-up not mentioned VERIFIED https://hotprospector.com/speed-to-lead |
| Kixie, Aloware | per user, third-party prices | UNVERIFIED | dialers with response reports | per rep, not agency-wide INFERENCE |
| LeadReply | UNVERIFIED | early access | white-label AI responder | sends, does not audit INFERENCE |
No marketplace app was found dedicated to unanswered messages across an agency's accounts. Not proof of absence.

## Gaps SubSync can own
- Cross-account "waiting for reply" queue ranked by age, one screen for all client accounts (native is per account).
- Computed unreplied state from direction and time, independent of "mark as read" (which clears native SLA timers).
- Business-hours-aware aging (native SLAs use calendar hours).
- Own history of SLA breaches and recoveries (native lacks SLA reporting history).
- Per-user and per-account first-response and unanswered trends, the long-requested missing report.
- Detecting replies hidden by automation: workflow or AI messages counted as answers, and internal comments.
- Unassigned inbound with no owner, flagged before the client notices.
- Proof for clients: weekly receipts of unanswered counts caught and cleared.
