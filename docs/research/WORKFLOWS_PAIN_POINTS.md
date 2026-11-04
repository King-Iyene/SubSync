# Workflow and campaign pain points (4 Nov 2026)

Method: 4 web searches plus the live operation catalogue. Reddit, the community forum, Facebook groups, G2 and YouTube were NOT readable from here (search returned none of them). The evidence is agency troubleshooting blogs and the CRM's own help pages, so every complaint is INFERENCE (what agencies write about, not a count of people). API column: VERIFIED = checked with `describe_operation` or `search_operations`; BLOCKED = no endpoint found.

| # | Pain | Who feels it | Evidence | API | Verdict |
|---|---|---|---|---|---|
| 1 | A workflow stops or is turned off and nobody is told | Owner | INFERENCE (troubleshooting blogs, "workflow not triggering" guides) | VERIFIED list shows status; our sync notices the change | BUILD: "turned off" alert and change history |
| 2 | Steps fail silently (no phone number, wrong sender) and the error is hard to find | Owner, setter | INFERENCE (blogs: "actions fail silently") | VERIFIED logs by status and by step | BUILD (done in W1: failing check, errors in plain words in the detail panel) |
| 3 | Contacts sit in a Wait step for days (time windows, event waits with no timeout) | Setter | INFERENCE (guides) | Partly: log counts by step; who is inside now is BLOCKED | PROPOSAL: stuck-in-wait finder from step logs |
| 4 | No view of which workflows touch one contact | Setter | INFERENCE | VERIFIED logs filter by contact, per workflow only (one call per workflow) | PROPOSAL |
| 5 | Same workflow differs between client accounts after snapshot pushes ("drift") | Owner | INFERENCE (snapshot guides: a push overwrites edited assets; linked pushes) | VERIFIED search gives version and status per account | BUILD: compare across accounts with drift flags |
| 6 | Cannot compare one workflow across accounts | Owner | INFERENCE | VERIFIED definition read per workflow | BUILD (names, states, versions now); PROPOSAL: step by step diff |
| 7 | Messy, duplicated names ("New Workflow 2", "(copy)") | Owner, new hire | INFERENCE | VERIFIED rename needs draft, overwrite, publish | BUILD: name linter with one-tap fix and preview |
| 8 | Duplicate or near duplicate workflows firing twice | Owner | INFERENCE ("triggers firing twice" is a common support topic) | VERIFIED list; triggers need one definition read each | BUILD: duplicate finder (names). PROPOSAL: same trigger in two workflows |
| 9 | No bulk operations across accounts | Owner | INFERENCE (one source: bulk actions across accounts are limited) | VERIFIED status, rename, delete, create | BUILD (done in W1: bulk rename, publish, pause, copy, delete with preview) |
| 10 | Campaign shows sent but did not deliver | Owner | INFERENCE | VERIFIED totals via `emails/stats.readonly` | BUILD (done in W1) |
| 11 | Campaign stuck or queued | Owner | INFERENCE | VERIFIED totals include queued | BUILD (done in W1) |
| 12 | Bounces and sending domain problems | Owner | INFERENCE | VERIFIED bounce totals; domain DNS is already checked from public records in Email health | BUILD (done); domain link: existing Email health |
| 13 | SMS blocked: A2P 10DLC rejection, error 30034 on unregistered numbers | Owner, client | INFERENCE (official help article plus agency blogs) | BLOCKED: no registration status endpoint found | SKIP (record in BLOCKED) |
| 14 | SMS opt-outs and compliance | Owner | INFERENCE | Contact DND flags exist in contacts, not per workflow | SKIP here |
| 15 | Unclear which automation sent a message | Setter | INFERENCE | Message source fields are CHECK | PROPOSAL |
| 16 | Cost surprises from usage | Owner | INFERENCE | Usage and wallet data not found in the catalogue search | SKIP |
| 17 | Disabled workflow in one account only after a push | Owner | INFERENCE (a review-request example in one blog) | VERIFIED status per account | BUILD: part of compare and the turned-off alert |
| 18 | Nobody owns or reviews old automations | Owner | INFERENCE | SubSync side | BUILD: "overdue to review" prompt (Review for 14 days) |
| 19 | Proof for the client that automations work | Owner | INFERENCE | Logs and alerts | BUILD (done: Proof page, now also a weekly email in dry run) |
| 20 | Account-by-account checking takes hours; no morning view | Owner | INFERENCE | Our sync | BUILD: scheduled refresh (hourly route), saved views, command palette |

## What this changed in the build
1. Added the turned-off alert (also pushes in-app and email through the existing dispatcher), compare across accounts, name linter, duplicate finder and review-due prompts.
2. Added a scheduled refresh route and a dry-run weekly Proof email, because "nobody is told" is the strongest theme.
3. Hid the shell's account bar on this page so only the page's own picker shows.
4. Left A2P status, usage cost, who-is-inside-a-wait and which-automation-sent-it out: no endpoint, or only a CHECK field.

## Honest limits
- No count of how many people hit each problem. Vendor blogs have an interest in selling audits (consultants quote $150 to $500 a month for monitoring).
- Not one source was a real agency owner's own words. Do the five interviews in the brief before betting more on this module.
