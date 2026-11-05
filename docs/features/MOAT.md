# MOAT: work inside SubSync (stage/moat)

King: "make users LIVE in our app, not take them to the main app: write, update, delete from the app."

## 1. API facts (read 4 Nov 2026 in the platform's official OpenAPI files, https://github.com/GoHighLevel/highlevel-api-docs/tree/main/apps: conversations.json, contacts.json, opportunities.json, calendars.json)

All VERIFIED as "the endpoint exists with this scope in the official spec". NONE verified live (no real call was made).

| Action | Endpoint | Scope | In scopes.ts? |
|---|---|---|---|
| Send SMS / Email / WhatsApp (also IG, FB, Live chat, RCS) | POST /conversations/messages (type, contactId, message, subject, html, emailFrom, templateId, scheduledTimestamp, fromNumber...) | conversations/message.write | NEW (only .readonly is there) |
| Read a conversation's messages (text, direction, channel, sender, status) | GET /conversations/{conversationId}/messages | conversations/message.readonly | yes, optional |
| Find the conversation of a contact | GET /conversations/search?contactId= | conversations.readonly | yes |
| Note: create / update / delete | POST/PUT/DELETE /contacts/{id}/notes[/{noteId}] | contacts.write | yes, optional |
| Task: create / update / complete / delete | POST /contacts/{id}/tasks (title, dueDate, completed, assignedTo), PUT .../{taskId}, PUT .../{taskId}/completed, DELETE | contacts.write | yes (contacts.write) |
| Tags add / remove | POST / DELETE /contacts/{id}/tags | contacts.write | yes |
| Update contact fields and owner | PUT /contacts/{id} (name, email, phone, tags, customFields, dnd, assignedTo...) | contacts.write | yes |
| Delete contact | DELETE /contacts/{id} | contacts.write | yes |
| Update deal (stage, status, value, owner) | PUT /opportunities/{id} (pipelineStageId, status, monetaryValue, assignedTo); PUT /opportunities/{id}/status (won/lost, lostReasonId) | opportunities.write | yes, optional |
| Appointment status (showed / no-show / cancelled / confirmed) | PUT /calendars/events/appointments/{eventId} appointmentStatus: new, confirmed, cancelled, showed, noshow, invalid | calendars/events.write | yes, optional |
| Create appointment | POST /calendars/events/appointments | calendars/events.write | yes |
| Users on the account (owner picker) | GET /users/ | users.readonly | yes |

### Calling (the honest answer)
- **There is NO endpoint that places or starts a phone call, rings a user's phone, or opens the dialer.** Searched all four specs: none.
- What exists: POST /conversations/messages/outbound "Add an external outbound call" (scope conversations/message.write). It only RECORDS a call in the contact's conversation, and it requires a `conversationProviderId`, meaning SubSync would have to be registered as a custom conversation provider (a separate marketplace module, new setup, new review). Not used.
- Read only: call messages inside a conversation, recordings (GET .../recording) and transcriptions (conversations/message.readonly).
- So SubSync does this: shows the number big with Copy, records the attempt and its outcome (no answer, spoke, booked, wrong number) as SubSync's own record AND as a note through the write gateway, and offers "Call in your CRM" (opens the person in the CRM) as a labelled fallback. No tel: unless the person chose the phone-app dialer. No telephony is built.

### INFERENCE / CHECK
- The send-message spec marks `subType` and `status` required, which looks like a documentation error; CHECK with one real test message in a throwaway account before enabling.
- SMS to a number on Do Not Disturb is refused by the platform too, but SubSync refuses first.
- Message sending needs a connected number (SMS) or sending domain (email) in the account; the platform answers with an error if not. SubSync shows it in plain words.
- No endpoint to undo a sent message. Notes, tags, tasks, owner, fields, deal stage/value/status and appointment status have a before-value and can be undone by writing the old value back; a sent message and a contact delete cannot be undone.

## 2. What was built

**The Lead workbench** (the shared lead panel: src/app/app/ds/lead-drawer.tsx and ds/wb/*). It opens from every list and chart mark that already opened the panel (Today, Speed, Appointments, Unanswered, People, Audit, Clients, Duplicates, Pipeline) with previous/next and the j/k and arrow keys. Tabs: Conversation (live thread, composer with templates and merge fields), Update (note, task, tags, owner, details, appointment status, delete), Deals (stage, value, won/lost, owner). Under them the older history (tags with days, custom fields, timeline) stays.
- **One gateway:** src/lib/ghl/workbench.ts (planAction then runAction), on the same switches as the Clean-up gateway: WRITE_GHL_LIVE off by default, the per-account opt-in (Settings), a preview and a confirm click, Do Not Disturb (hard refusal), quiet hours 8am to 9pm in the account's zone (needs a tick), size limits, a typed name before a delete, 30 writes a minute per company and 3 messages a minute per person, no identical message to one person within a minute, one audit line per write (ids and field names only, never text), and an undo built on the server from the before-values (tags, owner, details, deal, appointment status, note and task; a sent message and a delete cannot be undone and say so). The rate limits are per server instance (best effort).
- **Dry run everywhere:** with the switch off or the account not allowed, every action previews, then "Record as a dry run" writes one WOULD line and sends nothing. The demo can never write.
- **Routes:** GET workbench/context, GET workbench/thread (text shown, never stored), POST workbench/preview, POST workbench/do (src/lib/api/workbench-routes.ts). Every id is re-read from SubSync's copy of the caller's accounts; forged ids are "not found"; a client's staff may message and note on their own account but not delete.
- **Calling:** see section 1. SubSync places no call. The Call button opens a sheet: the number big, Copy, "Call in your CRM" (or the person's own phone app if they chose it), and four outcome buttons that record the attempt in SubSync (the person leaves the call lists for 12 hours) and write a short note through the gateway.
- **Duplicates:** each record card has "Show lead" again; it opens the shared panel with the group's records as previous/next.

**Pipeline** (views/pipeline-board.tsx, analytics/pipeline-board.ts, api/pipeline-board-routes.ts, GET pipeline-intel?view=board). One headline (open value, deals, stuck value, no next step), one action ("Move the N stuck deals" walks them in the panel), a board by stage, "Where the stuck money is" (top 5 clients, See all paged), a forecast line only with 20 or more closed deals, the open-pipeline line only with 14 or more days and a 10 percent change. The 25 In use dropdowns moved into the Pipelines gear drawer (shows 5, search for the rest). The older all-in-one screen is behind "More detail" (loads only when opened).
- Definitions (also in docs/METRICS.md): each open deal counted once; stuck judged per stage (twice the median days open deals have sat in that stage, kept between 5 and 30 days, or the account's stale-days setting when the stage has fewer than 5 deals) AND quiet for 7 days; no next step = no upcoming appointment AND quiet for 7 days.

## 3. Not verified
Every real call (nothing here touched a real CRM). The request shapes are from the official spec. The first live test is in docs/NEEDS_KING.md section 30(f).
