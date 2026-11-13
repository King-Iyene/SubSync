# Everything SubSync can change in your CRM (one list)

Decision (King, 13 Nov 2026): SubSync is not read-only. It can change things in a client's CRM and send texts and emails, always through a preview and a confirm, with an audit log, only when a person presses the button (or a schedule they set), and never to a contact who asked not to be contacted. This replaces every older "SubSync only reads / never messages leads" statement (CLAUDE.md sections 1A and 8, standing rule 7).

Common guardrails for every row below: the server switch `WRITE_GHL_LIVE` (off unless exactly `true`; off means the request is built, a "WOULD WRITE" line is recorded and nothing is sent), the account's own opt-in (Settings), an optional scope (skipped scope shows "Needs permission: reconnect"), a preview, a confirm, a protection check (do-not-contact, open deals, payments, upcoming appointments where it matters), spacing and rate limits, one audit line per write with ids and field names only, and our own writes excluded from our own numbers (crm_writes).

| Action | Scope needed | Where (gateway) | Extra guardrails | Undo possible |
|---|---|---|---|---|
| Send a text or an email to one lead | conversations/message.write | `workbench.ts` runAction via `api/send-routes.ts` (flag `send_messages`, default off) | Preview of exact text, to whom and from where; do-not-contact re-read live just before sending (fails closed); quiet hours per account time zone; per-person hour and day caps, account daily cap; duplicate check; role check; optional opt-out line on texts; link allow-list; no card, ID or password text; kill switch `SEND_MESSAGES_KILL` and an in-app pause per account; AI drafts never sent automatically | No |
| Send to selected (bulk, up to 20) | conversations/message.write | `send-routes.ts` bulkRoute | Same checks for every person, typed `SEND n` confirmation, one account at a time | No |
| Internal comment on a conversation (meeting summary) | conversations/message.write | `ghl/crm-writes.ts`, `connections/ingest.ts` | Only for a certain contact match; the person's own connection | Yes (removed) |
| Add a note, add a task | contacts.write | `ghl/crm-writes.ts`, `workbench.ts` | Preview; marked as SubSync's own | Yes (removed) |
| Add or remove a tag | contacts.write | `crm-writes.ts`, `workbench.ts` | Preview | Yes |
| Change a contact's owner | contacts.write | `ghl/people-gateway.ts` | One field of one contact; preview | Yes |
| Fix contact data (name, email, phone, custom fields) | contacts.write, locations/customFields.write | `crm-gateway.ts` (clean-up), `workbench.ts` | Before value saved; typed count; skips contacts changed since the preview | Yes |
| Mark do-not-disturb | contacts.write | `workbench.ts` | Preview | Yes |
| Merge duplicate contacts | contacts.write | `ghl/crm-merge.ts` | Protected contacts skipped (do-not-contact, deals, payments, appointments); ticked box | No |
| Delete a contact | contacts.write | `workbench.ts` | Owner side only; typed name | No |
| Delete a conversation | conversations.write (not requested today) | `ghl/unanswered-gateway.ts` | Typed count; protected contacts skipped | No |
| Update a deal (stage, status, value, owner), create a deal | opportunities.write | `ghl/pipeline-gateway.ts`, `workbench.ts` | Preview; confirm | Update yes, create no |
| Book or update an appointment, set its status | calendars/events.write | `ghl/appointment-gateway.ts` | Preview; confirm | Status yes |
| Add a contact to a workflow, create or change workflows | contacts.write, workflows.write, workflows.publish, workflows.delete | `workflow-module/`, `crm-writes.ts` | Preview; typed confirmation and a saved copy for delete | Delete: from saved copy |

What SubSync reads is listed on the Trust page (every permission with its reason). A client's own staff see a read-only view of their own account.
