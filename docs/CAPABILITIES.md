# Capability matrix (stage F1, item 2, note N64)

Written 1 Nov 2026 by the F1 stage agent. For every kind of data SubSync wants: the endpoint, the permission it needs, whether the app asks for it, whether each real install granted it, whether the platform restricts it, and, where something is unavailable, the one true cause.

## The three causes (and the words the screen uses)

N64 found three different situations shown with one blurred sentence ("the platform does not give this app ..."), which sends people looking for a switch that does not exist. They are:

| Cause | What it means | Words on screen | What fixes it |
| --- | --- | --- | --- |
| **Needs permission** | The app never asked for the permission, or this install declined it | "Needs permission: reconnect" (declined) or "Needs permission: SubSync never asked for it" (not requested) | A new marketplace release with the optional permission (release 2.2.0 or later, King), then the install approves it |
| **Platform restricted** | The permission is granted and the platform still refuses (a closed beta, a plan feature) | "Not available from the platform yet" | Nothing on our side |
| **Not exposed** | The platform has no such data at any address | "Not available from the platform yet" | Nothing; record it ourselves from now on, or use another signal |

The rules are code and are unit tested: `classifyProbe` in `src/lib/ghl/capabilities.ts` (`src/lib/__tests__/f1-rules.test.ts`).

## How this was tested, and what could not be

- **Stored evidence (done, real data, 1 Nov 2026).** SubSync's own copies of the two real installs (the agency install and the business install; counts below) show what the platform really returned in the production sync: which fields are filled, which conversation types exist, which access flags the sync recorded after real 401/403 answers, which events arrive. This is read from the database only.
- **Live read-only probes (NOT VERIFIED LIVE from this machine).** The app's own token service could not open the real install's tokens here: they are encrypted with a key that exists only where the app runs, and this machine has a different one ("Unsupported state or unable to authenticate data"). I did not look for the production key (reading local secrets files was refused by the permission layer, correctly) and made no call to the platform. What exists instead: `scripts/audit-capabilities.ts` and the same check inside the app at `/api/admin/capabilities` (server secret only, GET requests only, one record at a time, at most 70 requests, field names and counts and statuses only, no value or token). **Morning test, after the merge deploys:** `curl -H "Authorization: Bearer <CRON_SECRET>" https://subsync.kdsquares.com/api/admin/capabilities` fills the "Live" column below and adds a count check per account (contacts, deals, open deals and conversations in the app against what the platform reports). Every cell marked NOT VERIFIED LIVE is what that call settles.
- No write call was made anywhere. Nothing in this stage touches a real account.

## Permissions the app asks for (21) and what each install granted

The install link asks for the 21 permissions in `src/lib/ghl/scopes.ts` (pinned by a test). The two real installs granted:

| Install | Granted | Not granted of the 21 |
| --- | --- | --- |
| Agency (3 accounts: KD Squares LTD, KD Squares Test, Niger Delta Innovate Ltd) | 21 of 21 | none |
| Business (KD Squares LTD installed for itself) | 19 of 21 | `calendars/events.readonly`, `users.readonly` |

UNSURE: the business install did not grant `calendars/events.readonly` or `users.readonly`, yet the sync recorded appointments and team names as readable (`ok`) for it and stored 3 appointments. Either the platform accepts `calendars/events.write` and a similar permission for reading, or the recorded permission list is not the whole picture. The live check settles it.

## The matrix

"App asks" = the permission is in the install link. State: **Available**, **Partly** (available, with a field or a share missing), **Needs permission**, **Restricted**, **Not exposed**, **Not verified**. Evidence is the stored copy on 1 Nov 2026 unless it says live.

| Data point we want | Endpoint | Permission | App asks | Agency / Business install | Platform gates it? | State and cause | Evidence | Live |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Contacts (name, email, phone, tags, dates, do-not-disturb, assigned user, birth date) | `GET /contacts/` | `contacts.readonly` | yes | granted / granted | no | **Available** | 52,926 contacts (agency), 50,479 (business): email on 50,891, phone on 36,746 | NOT VERIFIED LIVE |
| Contact's total count | `GET /contacts/` (`meta.total`) | `contacts.readonly` | yes | granted / granted | no | **Not verified** | the count check needs the live call | NOT VERIFIED LIVE |
| Contact's source | field `source` of the contact | `contacts.readonly` | yes | granted / granted | no | **Partly**: the field exists, but only 703 of 52,926 contacts carry one (1.3%). The platform has it only when whatever created the contact set it | 99% "no source" on the Leads page | NOT VERIFIED LIVE (attribution detail not synced) |
| Contact's last activity | field `lastActivity` of the contact | `contacts.readonly` | yes | granted / granted | no | **Not exposed** by the contact list: 0 of 52,926 contacts have a value. Replaced by signals SubSync can see (a customer message, an appointment, a deal), see `docs/METRICS.md` | `cached_contacts.last_activity_at` empty everywhere | NOT VERIFIED LIVE |
| Contact custom field values | `GET /contacts/` (`customFields`) | `contacts.readonly` | yes | granted / granted | no | **Not verified**: not synced (the privacy page promises no custom fields are copied) | by design | n/a |
| Tag names and ids | `GET /locations/{id}/tags` | `locations/tags.readonly` | yes | granted / granted | no | **Not verified** (not used: tags are read as text on each contact) | tags on 51,726 contacts | NOT VERIFIED LIVE |
| Custom field definitions | `GET /locations/{id}/customFields` | `locations/customFields.readonly` | yes | granted / granted | no | **Not verified** (not used yet) | none | NOT VERIFIED LIVE |
| Deals (value, status, stage, owner, dates, contact) | `GET /opportunities/search` | `opportunities.readonly` | yes | granted / granted | no | **Available**. Dates of the last stage change and status change on 10,380 of 10,380 deals; owner on 1,231 (12%); value above zero on 157 (1.5%) | 10,380 deals (agency), 9,057 (business) | NOT VERIFIED LIVE |
| Deal's last action date | field `lastActionDate` | `opportunities.readonly` | yes | granted / granted | no | **Not exposed**: 0 of 10,380 deals have it, so "stale" uses the latest of the other dates | `cached_opportunities.last_action_at` empty | NOT VERIFIED LIVE |
| Deal's source | field `source` | `opportunities.readonly` | yes | granted / granted | no | **Partly**: 377 of 10,380 | stored copy | NOT VERIFIED LIVE |
| Pipelines and stages (names, order) | `GET /opportunities/pipelines` | `opportunities.readonly` | yes | granted / granted | no | **Available**: 66 pipelines (agency), 11 (business). Needed by the stage rules | stored copy | NOT VERIFIED LIVE |
| Stage history (when a deal entered each stage) | none | n/a | n/a | n/a | n/a | **Not exposed**: only the time of the last stage change. SubSync records changes itself from install day (`deal_events`), which is why stage dwell and velocity wait for that history | `deal_events` | n/a |
| Why a deal was lost | field `lostReasonId` | `opportunities.readonly` | yes | granted / granted | no | **Not verified** (not synced; win/loss reasons are Wave 3) | none | NOT VERIFIED LIVE |
| Conversation list (last message, direction, channel, unread) | `GET /conversations/search` | `conversations.readonly` | yes | granted / granted | no | **Partly**: the channel, time and unread count are on every conversation; the direction of the last message is on only 698 of 1,265 (agency): 567 have none, and 558 of the stored conversations are of the type "no show" (system activity), so they are never counted as a customer waiting (the link between the two is likely but not proven row by row) | stored copy | NOT VERIFIED LIVE |
| Number of conversations an account has | `GET /conversations/search` (`total`) | `conversations.readonly` | yes | granted / granted | no | **Not verified**. SubSync reads only the newest 500 per account (two of three real accounts are at 500), which every conversation count now says | stored 500, 265, 500 | NOT VERIFIED LIVE |
| Messages in a conversation (who sent, a person or automation, call details) | `GET /conversations/{id}/messages` | `conversations/message.readonly` | yes | granted / granted | no | **Available** in the app's reply-time record (`lead_touches`: 11 leads in the agency install, 1 with a sender); direct call not made here | `lead_touches` | NOT VERIFIED LIVE |
| Calls and missed calls | the same messages (type call) | `conversations/message.readonly` | yes | granted / granted | no | **Available as a message type**: 19 conversations whose last message is a call (agency), 15 (business). The result of a call (answered, missed, how long) is in fields the sync logged by name once, not kept. So "missed calls" can be built; it is not built | stored conversation types | NOT VERIFIED LIVE (call result fields) |
| Conversation assignee | field `assignedTo` | `conversations.readonly` | yes | granted / granted | no | **Not verified** (not synced) | none | NOT VERIFIED LIVE |
| Appointments (status, time, assigned user, contact) | `GET /calendars/events` | `calendars/events.readonly` | yes | granted / **not listed** | no | **Available** (flags `ok` for all four account rows). 38 appointments (agency), 3 (business). Statuses seen: confirmed, cancelled, showed, no-show, invalid | stored copy and access flags | NOT VERIFIED LIVE (see UNSURE above) |
| Appointment status history | none | n/a | n/a | n/a | n/a | **Not exposed**: only the current status. SubSync records changes itself (`appointment_events`) | `appointment_events` | n/a |
| Calendars (names, team members) | `GET /calendars/` | `calendars.readonly` | yes | granted / granted | no | **Available** (calendar counts stored) | stored copy | NOT VERIFIED LIVE |
| Calendar groups, rooms and equipment | `GET /calendars/groups`, `/calendars/resources/rooms` | `calendars/groups.readonly`, `calendars/resources.readonly` | yes | granted / granted | no | **Not verified** (not used) | none | NOT VERIFIED LIVE |
| Team members (names, roles, photos) | `GET /users/` | `users.readonly` | yes | granted / **not listed** | no | **Available** (flags `ok`): used to name people; names are typed by hand where missing. Last login: **Not exposed** | stored flags | NOT VERIFIED LIVE |
| Account details (name, time zone, email, website) | `GET /locations/{id}` | `locations.readonly` | yes | granted / granted | no | **Available** | stored copy | NOT VERIFIED LIVE |
| Tasks | `locations/{id}/tasks/search` (a POST that only reads) | `locations/tasks.readonly` | yes | granted / granted | no | **Not verified** (not called: a POST; not used) | none | NOT VERIFIED LIVE |
| Conversation reports | not identified | `conversations/reports.readonly` | yes | granted / granted | no | **Not verified** (endpoint name not confirmed; not used) | none | NOT VERIFIED LIVE |
| Failing workflows | `GET /workflows/` | `workflows.readonly` | **no** | n/a | yes: the platform limits who can use the workflows interface (earlier research, not re-tested) | **Needs permission** (never asked) and possibly **Restricted**; the live check will say which | refused if called | NOT VERIFIED LIVE |
| Failed payments, upcoming rebills, wallet balance | `GET /payments/transactions` and related | `payments/transactions.readonly` and others | **no** | n/a | unknown | **Needs permission** (never asked). A wallet balance address is not known: **Not verified** | refused if called | NOT VERIFIED LIVE |
| Invoices | `GET /invoices/` | `invoices.readonly` | **no** | n/a | unknown | **Needs permission** (never asked) | none | NOT VERIFIED LIVE |
| Form submissions (lead source detail) | `GET /forms/` | `forms.readonly` | **no** | n/a | unknown | **Needs permission** (never asked) | none | NOT VERIFIED LIVE |
| Phone registration (A2P) status | not known | not known | no | n/a | unknown | **Not verified**: no endpoint is known. Offer a manual checklist item, not a fake watcher | none | NOT VERIFIED LIVE |
| Each install's plan | `GET /marketplace/app/{appId}/installations` | `marketplace-installer-details.readonly` | **no** | n/a | no | **Needs permission** (never asked; release 2.2.0, stage Z2) | the install event carries the plan | n/a |
| Change notifications (webhooks) | the app's webhook address | the events ticked in the developer portal | n/a | n/a | the portal | **Partly**: in the last 3 days only INSTALL, UNINSTALL, UPDATE, ContactCreate and ContactUpdate arrived (S0.4). No appointment, deal or message event was seen: either nothing happened or the events are not ticked (`docs/NEEDS_KING.md` section 15) | `webhook_events` | n/a |

## What F1 changed because of this matrix

- The "Not watched yet" reasons (`NOT_WATCHED`) no longer say "the platform does not give this app call logs yet" (calls are in the data) or use one sentence for different causes: each now names its cause. The card itself moves to Settings in F5.
- `/api/admin/capabilities` and `scripts/audit-capabilities.ts` exist so the matrix can be completed in one call.
- No permission was added, removed or changed, and the marketplace app was not touched. Permissions the roadmap may want for later stages, from this matrix: `workflows.readonly` (failing workflows, only if the platform allows it), `payments/transactions.readonly` and `invoices.readonly` (stage R1, parked), `forms.readonly` (source detail, optional), `marketplace-installer-details.readonly` (stage Z2). F1 itself needs none (`docs/NEEDS_KING.md` section 12).

## Stage C2: merge, merge link and restore (3 Nov 2026)

Written from the code and the docs we hold. **No live call was made** (this machine cannot read the real install's tokens, and C2 changes nothing in a CRM). Every row is CHECK until the morning test below settles it. The product is built for the worst case: no merge from SubSync, no delete from SubSync.

| Question | What we know | Status | What the screen does |
| --- | --- | --- | --- |
| Does the CRM API have a merge that keeps history of both contacts? | The public contacts API we use lists, reads, creates, updates and deletes a contact. We found no merge call in our docs or code. The CRM's own Merge button (Contacts list, select two) does keep both histories. | CHECK (read the contacts API reference and try it in a test account) | Guided merge only. We never merge. |
| Can a link open the CRM merge screen with the contacts preselected? | We know the contact page link (`/v2/location/{id}/contacts/detail/{contactId}`, `deepLinks().contact`). We know of no link that opens Merge with contacts ticked. | CHECK (try it in a test account) | Button "Open both in your CRM" opens the two contact pages, built by the white-label `crmUrl` helper. The steps for the CRM's Merge button are printed beside it. |
| Can a deleted contact be restored? | A deleted contact is gone with its conversations, appointments and payment links. We know of no restore call. A SubSync copy could only create a new contact with a new id. | CHECK (delete a test contact, look for it in the CRM and API) | SubSync has no delete button. The page says nothing is deleted from here. |
| Is a contact's payment or subscription in our data? | No. Payments need `payments/transactions.readonly`, which the app does not ask for (matrix above). | Needs permission (never asked) | The keep suggestion says "payments not checked". The merge warning says to check payments in the CRM. |
| Are active workflows in our data? | No (`workflows.readonly` not asked, platform limits it). | Not verified | Same: never claimed. |
| Open deals, upcoming appointments, do-not-disturb, tags, source, dates | In our copy of contacts, deals and appointments (synced). | Verified in the stored data | Used for the keep suggestion and the safeguards. |

**Morning test (King or the next stage, in a test account):** (1) merge two test contacts with the CRM button and note whether both histories remain; (2) try `POST /contacts/merge` style calls only in a sandbox and record the answer; (3) check whether the Merge screen accepts a link with contact ids; (4) delete a test contact and look for a restore. Record each answer here and change the status from CHECK.
