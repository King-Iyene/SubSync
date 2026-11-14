# Write permissions with no safe, simple use today

Written 14 Nov 2026 for King's decision (branch feat/safe-writes). Each of these is an optional write permission the app can ask for. A reviewer asks "what is this for", and for each one below
SubSync has no feature that needs it, and the only features that could use it would either message a lead, move money, or send documents on a client's behalf. Rule 8 and the build rules say
SubSync does not do those. King decides whether to keep or drop each one; the default recommendation is DROP (a smaller permission list is a trust advantage and every added permission forces a reinstall).

| Permission | Why there is no safe simple use today | Recommendation |
|---|---|---|
| conversations.write | Its only uses are creating or changing a conversation record (for example starting a thread or marking it read or starred). SubSync never replies for the agency, and a conversation SubSync created would show up in the client's inbox with no human behind it. | Drop |
| conversations/livechat.write | Sends and edits website live-chat messages. That is sending a message to a visitor for the agency, which SubSync does not do. | Drop |
| invoices.write | Creates, edits, sends and voids invoices, which charge a client's customers. A mistake costs real money and SubSync is not a billing tool. | Drop |
| invoices/schedule.write | Schedules recurring invoices (automatic charges to a client's customers). Same money risk, and a schedule keeps running after SubSync is gone. | Drop |
| invoices/template.write | Creates invoice templates. Nothing in SubSync uses a template, and a template alone proves no customer value. | Drop |
| invoices/estimate.write | Creates and sends estimates (quotes) to a client's customers. Sending a document to a lead for the agency, with no human review, is outside the read-only, never-message principle. | Drop |
| recurring-tasks.write | Creates tasks that repeat on a schedule in a client's CRM. A repeating task that SubSync created would keep making work for the team after the agency stops using SubSync, and the published API description lists no scope for these endpoints, so it cannot be tested. | Drop |
| notes.write | Notes SubSync adds today (call results, meeting notes) are created with contacts.write, which the app already holds as a required permission; Fathom notes use it too. A separate notes.write adds nothing. | Drop (keep contacts.write) |

## Finding for the four write permissions that now have a feature

- locations/tags.write: used by "Create this tag" (Settings, Call queues). POST /locations/{id}/tags is in the published API description with this scope. Verified in the description; NOT VERIFIED LIVE.
- locations/customValues.write: used by "Save my reply target" (the value subsync_sla_minutes). Create (POST) lists this scope; update (PUT .../customValues/{id}) lists no scope in the published description, so it is assumed to need the same one. NOT VERIFIED LIVE. To tell create from update SubSync also reads custom values (locations/customValues.readonly, an optional read permission).
- pipelines.create: used by "Create the standard sales pipeline". The endpoint (POST /opportunities/pipelines, scope pipelines.create) appears on the marketplace documentation page but NOT in the downloadable API description, so the request body follows the documentation page only. NOT VERIFIED LIVE.
- locations/tasks.write: **no published endpoint uses it.** The published description has only "Task Search" (locations/tasks.readonly) under locations. Marking a task done (PUT /contacts/{contactId}/tasks/{taskId}/completed) and deleting a task (DELETE /contacts/{contactId}/tasks/{taskId}) both need contacts.write, which the app already holds. So the new task buttons work through contacts.write, and locations/tasks.write is still without a use. Recommendation: do not request locations/tasks.write unless the platform documents an endpoint for it; tell a reviewer the task buttons use contacts.write.
