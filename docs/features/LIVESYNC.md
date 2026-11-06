# Live sync (stage/live)

Goal: what the lead panel, People search and the lists show is what the CRM says now, within seconds, and the screen says plainly whether it is live.

## Layers (fastest first)
1. Live read-through (`src/lib/live/live-read.ts`, route `GET workbench/live`): when a lead panel opens (from a chart, list, popup or search) the CRM is asked for the contact (tags, owner, DND, email, phone), its conversation, calls, and on a full read the notes, tasks, appointments and deals. The copy shows first; the live answer replaces it. Poll every 5 s while open (a full read every 6th poll and on focus); paused while the tab is hidden; stopped after 10 minutes without a touch; a failure or 429 doubles the wait up to 60 s. Server throttle: one CRM read per person per 2.5 s. Badge: "Live. Updated N s ago" or "From the last sync".
2. Write-through (`live-cache.ts`): every live read, webhook, search hit and delta stores the contact and conversation in the copy (upsert, scoped by installation and location). A tag that differs from the copy is recorded in `contact_tag_events` with the real time (only for a person the copy already held; our own call-outcome tags are skipped). Calls seen live go to `touch_events` (metadata only, de-duplicated against the webhook within a minute). After a SubSync write through the workbench the person is read back and cached at once. Message text is never stored; notes and tasks are shown live and not stored.
3. Webhooks (`webhook-apply.ts`, called from `src/app/api/webhooks/ghl/route.ts` after signature check and duplicate drop): updates the copy in about a second and skips the full area re-read when that worked.
4. Delta (`delta.ts`): while somebody has an account open, at most every 45 s per account, the 100 most recently updated contacts and 100 most recent conversations (2 requests) are stored. Never a full resync, never deletes. Needs no scheduler (the open panel drives it, `after()` response hook).
5. Search (`crmFind`): People and the global search ask the CRM for a typed term when the copy finds fewer than 5 people, in accounts the caller may see (at most 5 accounts, 10 hits each), store the hits, and search again. Also `GET workbench/find?q=`.
6. Existing safety nets stay: the 15-minute fast refresh and the daily full sync.

## Tenancy
Every route derives the installation from the session, checks the account is in the caller's allowed set and in this installation's `locations`, uses that account's own token, and refuses a contact whose CRM location is not the requested one (`ForeignContact`, answered as "Contact not found"). Webhook application requires the location to belong to the installation that matched the event.

## Events
| Event | Handled | Needs enabling in the marketplace app webhook settings |
|---|---|---|
| ContactCreate | yes: contact read back and stored (~1 s) | yes |
| ContactUpdate | yes: same | yes (CHECK it is offered under that name) |
| ContactTagUpdate | yes: same, tag change recorded | yes |
| ContactDndUpdate | yes: same | yes |
| ContactDelete | yes: row removed | yes |
| Owner change (contact) | arrives as ContactUpdate: yes | covered by ContactUpdate (CHECK) |
| InboundMessage / OutboundMessage (calls arrive as a call-type message) | yes: conversation stored; touch event stored; conversation re-read queued (feeds speed numbers) | yes |
| ConversationUnreadWebhook / ConversationUpdate | yes: conversation stored | yes (CHECK names) |
| OpportunityCreate / Update / StageUpdate / StatusUpdate / AssignedToUpdate / MonetaryValueUpdate | yes: stored from the payload (~instant) | yes |
| OpportunityDelete | yes: row removed | yes |
| AppointmentCreate | re-read of appointments queued (a new one is not in the copy yet) | yes |
| AppointmentUpdate | yes: status/time/owner updated in place when known, else re-read | yes |
| AppointmentDelete | yes: row removed | yes |
| NoteCreate / NoteUpdate / NoteDelete | no copy kept; the open panel sees them within 5 s by the live read | optional |
| TaskCreate / TaskComplete / TaskDelete | same as notes | optional |
| LocationUpdate, INSTALL, UNINSTALL, plan events | unchanged | already on |

CHECK: a dedicated call-status event was not confirmed; calls are read from the conversation (live read) and from message webhooks.

## Possible new scopes
The live read uses contacts, conversations, conversation messages, opportunities and calendar reads already requested. Notes and tasks need `contacts.readonly` (already there) and may need the notes/tasks read scope on some installs: when refused the panel shows the part as missing and carries on. No scope change was made.

## Not verified here
No real CRM call was made (tests use stubs). The exact response shapes of notes, tasks, contact appointments and `contacts/search` sorting are from the documentation and need one look against a live account.
