# Contact panel write-back (notes, call results, tags)

Branch `contact-writeback`. King, 5 Nov 2026: the note and the call result must be written to the lead in the CRM, not kept only in SubSync.

## Evaluation (principle 1, five lines)
a. Who and what next: setters and agency staff log a call or a note and expect the CRM record to show it; if missing they would re-type it in the CRM.
b. Data available: VERIFIED in the API description (5 Nov 2026): create note, create task, add/remove tags, delete note, delete task are all `contacts.write` (already an OPTIONAL scope; nothing new to add).
c. CRM natively: it has notes, tasks, tags; SubSync saves the retyping and puts the call result there in one tap.
d. Simplest version: note + tag + (follow-up) task through the one write client, behind `WRITE_GHL_LIVE`.
e. Risk: writing to customer records (guardrails below), cost nil, privacy: note text is never stored by SubSync, only ids and status.

## What is a CRM write, what stays in SubSync (decided per action)
| Action | Where it goes |
|---|---|
| Add a note to this contact | CRM note |
| Call result buttons | CRM note + tag `subsync-call-<result>` (+ task for "Follow up in 3 days") AND SubSync's own list (12 hours off the call lists) |
| Add / remove a tag in the panel | CRM tag (remove asks first) |
| Today Done / Snooze / Assign to me | SubSync only (a working-queue marker; the CRM has no equivalent). PROPOSAL: "Assign to me" could set the contact owner in the CRM (`contacts.write`), needs King's yes. Today files belong to the `today-flow` branch, so the wording there is not changed here |
| Appointment outcome | Not built: setting an appointment status in the CRM needs the calendar events write scope. PROPOSAL, needs King |
| Copy summary / Copy details | Clipboard only |
| Private notes on a client (Clients page) | SubSync only, already said on screen |

## Guardrails
- One switch: `WRITE_GHL_LIVE` (off by default, not flipped). Off: the request is built, a dry run is recorded in the audit log (ids and field names only) and the screen says "Writing to your CRM is switched off for now".
- No permission: "Needs permission: reconnect". Real failure: the CRM's error number.
- Idempotent: unique key per contact + result (or note text hash) + minute in `contact_writes`; a retry after a failure is allowed.
- Cap: 200 writes per company per hour, plain message.
- Tenancy: the contact must be in an account the signed session may read (same check as every People call); a tampered id gives "not found" and records nothing.
- DND: notes, tags and tasks never message anyone, so DND is not a block (it is still shown). SubSync never sends a message.
- Every write has an audit line (who, contact, what, result). Notes carry the marker `[SubSync]`.
- Removals (tag, and Undo, which deletes a note/task/tag SubSync made) ask a plain confirmation on screen; the server also refuses a tag removal without `confirm`.
- Undo: ids of what we created are stored; only the person who saved can undo, within an hour; only things SubSync made are deleted (a tag only if it was not already on the contact).

## Tag dates
The CRM does not store them. `contact_tag_events` records the first-seen day at a sync (`exact = false`, shown "first seen"); a tag added from SubSync is recorded with the exact time (`exact = true`, "added"). The CRM tag name is never changed. SubSync also updates its own copy of the contact's tags at once so the next sync records nothing twice.

## Principle 14 (own writes never change our numbers)
- Note ids go to `crm_writes` (existing) and to `contact_writes`; the webhook echo check reads both (`isEchoOfOurWrite`); task ids are in `contact_writes`.
- Our call-result tags (`subsync-call-*`, prefix from `SUBSYNC_TAG_PREFIX`) are kept out of tag history by the sync. Hand-made tag changes write an exact event once.
- A write adds a `crm_writes` row, so the contact "last activity" date keeps the older value inside the window after our write (existing rule).
- NOT done: a webhook for a tag we added is not individually recognised (tag webhooks carry no id); it is covered by the above.

## Data
`contact_writes` (new, additive, in `docs/sql/PASTE_IN_SUPABASE.sql`), `contact_tag_events.exact` (new column). Both in the tenant-tables purge lists and the data inventory. If not applied: the panel says "needs the latest database update" (42P01/42703).

## Optional scopes King must have in the next app version
Only `contacts.write` (already listed as optional). Nothing else is needed. (`conversations/message.write` stays unused.)

## Verified / not
Unit tests (idempotency, cap, marker, request shapes, dry run, messages, tag names) pass. Database tests written (`tests/unit/contact-writeback-db.test.ts`) but need a database. Playwright spec `tests/e2e/contact-writeback.spec.ts` written; the app server could not start in this sandbox (no build/DB), so it and the screenshots are NOT run. Not tested against the live CRM.
