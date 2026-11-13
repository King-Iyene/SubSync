# Workflow module: what King types in the developer portal

Server side is built behind flag `wf_module` (off). Background and every VERIFIED / CHECK fact: `docs/features/WORKFLOW_MODULE.md`.

## Read this first
1. **Build and test in a separate PRIVATE test app first**, not the live SubSync app. Module edits on a live app apply to the whole app **immediately** (they are not tied to one version) and every run is **billed per execution by the CRM to the sub-account** that uses it.
2. **The live app is v2.1.0.** The release that contains the modules must be a **Major** update: **2.2.0 is next**. Existing installs do not update by themselves; the customer presses Update. Batch it with any other scope or listing change (do not burn versions; assume 5 maximum).
3. In the live app, Modules > Workflows shows an **orange warning marker** in the sidebar until the entry is configured. That is expected while it is empty.
4. Needs the scope `workflows.readonly` on the app (the docs say it is required to access actions and triggers). Add it as an optional scope in the same release.
5. Nothing fires in production until the server has `WORKFLOW_MODULE_SECRET`, the flag `wf_module` is on, and (for triggers) `WORKFLOWS_WRITE_LIVE=true` after the firing test below passes.

## Before you start: the secret (one time)
Make a long random value (40+ characters, for example 64 hex characters). Store it only as Vercel env `WORKFLOW_MODULE_SECRET` (never in chat or git). You paste the same value as a header in the portal (below). If you rotate it, change both.

Base address used below: `https://<our production domain>` (the same domain as the app's redirect URL).

## Step 1: Create each entry (the Create dialog has only Name and Key)
Modules > Workflows > Triggers > **Create trigger** (or Actions > **Create action**), then **Save**. Keys are immutable and must be unique; use exactly these.

| Kind | Name | Key |
|---|---|---|
| Trigger | Lead unanswered | `subsync_lead_unanswered` |
| Trigger | No-show detected | `subsync_no_show` |
| Trigger | Deal stuck in a stage | `subsync_deal_stuck` |
| Trigger | Account went quiet | `subsync_account_quiet` |
| Action | Add to SubSync call queue | `subsync_add_to_call_queue` |
| Action | Mark appointment outcome | `subsync_mark_outcome` |

## Step 2: After Save, inside the trigger / action
Per the official docs (CustomTriggers, CustomActions). The edit screens after Save were NOT opened when this sheet was written, so field labels may differ slightly: **CHECK** each against the screen.

### Triggers (all four)
- Icon: any neutral icon. Do not use the CRM's own logo or name.
- Short Description and Summary: use the text in the table below.
- **Subscription URL** (POST): `https://<our production domain>/api/hooks/workflow/subscription`. Header: name `x-subsync-key`, value = the secret.
- Sample data (JSON; used for filters and custom variables). Same shape for all four:
```json
{ "trigger": "subsync_lead_unanswered", "contactId": "abc123XYZ", "name": "Sam Example", "phone": "+15555550100", "source": "Facebook", "minutesWaiting": 42, "pipeline": "Sales", "stage": "New lead", "owner": "Pat", "link": "https://app.example.com/v2/location/LOC/contacts/detail/abc123XYZ" }
```
- Custom variables (name, reference into the sample): Contact id `contactId`, Name `name`, Phone `phone`, Source `source`, Minutes waiting `minutesWaiting`, Pipeline `pipeline`, Stage `stage`, Owner `owner`, Link `link`.
- Filters: none needed. (CHECK: leave empty.)
- The workflow may run without a contact (the docs allow it); `subsync_account_quiet` has no contact.

| Key | Short description | Summary |
|---|---|---|
| `subsync_lead_unanswered` | A new lead has waited longer than your reply target with no human reply. | Starts when SubSync sees a lead with no reply after your target time. Sends name, phone, source, minutes waiting and a link. |
| `subsync_no_show` | An appointment was marked as a no-show in the last day. | Starts when an appointment is marked no-show. Sends the contact's name, phone and a link. |
| `subsync_deal_stuck` | An open deal has sat in one stage too long. | Starts when an open deal has not moved for the number of days set in SubSync. Sends contact, pipeline, stage and a link. |
| `subsync_account_quiet` | No new leads arrived for several days. | Starts when this account gets no new leads for the number of days set in SubSync. |

Each trigger must be switched on per account in SubSync (Settings, Integrations, Workflow blocks), and it only fires after a workflow in the CRM uses it (that is when the CRM calls our Subscription URL and gives us the address to send to).

### Actions (both)
- Execution: **API mode**, Method POST, URL `https://<our production domain>/api/hooks/workflow/action`. Header: name `x-subsync-key`, value = the secret. (CHECK: the Custom Code mode is not used.)
- Pause Execution: off. Multi-branch: off. (The reply is a plain object with `ok`, `result` and `message`; a workflow can branch on `result`.)
- Icon and descriptions below.

**`subsync_add_to_call_queue`**: Short description: Tags the contact with this account's call-queue tag so your call queue picks it up. Summary: Adds your call-queue tag through SubSync. Does nothing for contacts who asked not to be contacted. Input fields: none (the contact comes from the workflow). Sample response:
```json
{ "ok": true, "result": "dry_run", "message": "Recorded. Changes to your CRM are switched off, so nothing was sent.", "action": "subsync_add_to_call_queue" }
```
Custom variables on the response: `ok`, `result`, `message` (same references).

**`subsync_mark_outcome`**: Short description: Marks one past appointment as showed or no-show. Summary: Records the outcome of an appointment that already happened. Input fields:
| Name | Type | Required | Reference | Options |
|---|---|---|---|---|
| Outcome | Select | Yes | `outcome` | Showed = `showed`, No-show = `noshow` |
| Appointment id | String | No | `appointmentId` | Leave empty to use the contact's latest appointment from the last 7 days |

Sample response as above with `"action": "subsync_mark_outcome"`. Possible `result` values: `done`, `dry_run`, `already`, `not_enabled`, `unknown_account`, `not_found`, `dnd`, `future`, `bad_input`, `needs_permission`, `failed`, `limit`.

## Step 3: Test in the private test app, in this order
1. Install the test app on one test account. In SubSync (flag on for that company) turn on the actions for the account. Build a tiny workflow: trigger "Contact created", action "Add to SubSync call queue". Run it for a test contact. Expected: `dry_run` (writes are off). Send back the CRM's execution log for the action and tell me whether any `Authorization` or signature header arrived (I log header NAMES only).
2. Turn on `subsync_no_show` for the account, build a workflow using the trigger, and check the CRM called our Subscription URL (SubSync Settings shows "waiting for a workflow" until it did).
3. Firing test: set `WORKFLOWS_WRITE_LIVE=true` for a short time on the test environment only, make one test lead go unanswered, and check the workflow starts once and only once. Send back what the CRM shows. This proves the one thing the docs do not describe (how a trigger is fired).
4. Only then repeat in the live app as part of the 2.2.0 Major release (Clone as Draft, add scope `workflows.readonly` and the module entries, release notes, Major). Remember the entries go live for all installs at once, and each run is billed to the client account by the CRM.

## Env vars to set (Vercel)
`WORKFLOW_MODULE_SECRET` (required), `WORKFLOW_MODULE_REQUIRE_SIGNATURE` (optional, `true` only after step 1 proves a signature is sent), `WORKFLOWS_WRITE_LIVE` (existing master switch for outward workflow calls; stays off until step 3).
