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
See the sections below, updated as the stage lands.
