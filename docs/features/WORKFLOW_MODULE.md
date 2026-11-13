# WORKFLOW MODULE: custom workflow triggers and actions

Flag: `wf_module` (default OFF). Migration: `20261231220000_workflow_module.sql` (additive). Portal values King types: `docs/WORKFLOW_MODULE_PORTAL_SHEET.md`.

## Operating principles (the five lines)
- (a) Decision and who: an agency owner or account admin wants their own workflow to react when SubSync spots a silent failure (lead unanswered, no-show, stuck deal, quiet account), and wants a workflow to hand a contact to SubSync's call queue or record an appointment outcome. Without it they copy leads into queues by hand.
- (b) Data: triggers read SubSync's own copies (`lead_touches`, `cached_appointments`, `cached_opportunities`, `cached_contacts`). Firing needs `workflows.readonly` (module prerequisite) plus the contact write scope for the tag action and `calendars/events.write` for the outcome action (both already optional scopes).
- (c) Native or competitor: the CRM has native "no reply" and "appointment status" workflow triggers per account, built by hand. Kixie ships its own custom actions. SubSync's difference: one measured, deduped, cross-account signal fed to the customer's workflow.
- (d) Simplest version: 4 triggers, 2 actions, one settings card, all off until switched on per account.
- (e) Risk: cost (each run is billed by the CRM to the sub-account), cross-tenant calls (tenant is read only from the verified body), consent (never replies to anyone; Do Not Disturb contacts are never sent in a trigger and never tagged), module edits on a live app apply at once (see the portal sheet).

## What the official docs say (read 12 Nov 2026)
Sources: `marketplace.gohighlevel.com/docs/marketplace-modules/WorkflowActionsAndTriggers.md`, `.../CustomTriggers.md`, `.../CustomActions.md`, help article 155000001024, `.../Authorization/authorization_doc/`.

| Fact | Status |
|---|---|
| Custom triggers and actions are part of "LC Premium Triggers & Actions"; billed **per execution** to the sub-account, which must have the premium feature enabled and the app installed to see them | VERIFIED |
| Scope `workflows.readonly` must be enabled "to access actions and triggers" (the help article spells it `workflows.readyonly`, a typo) | VERIFIED |
| Trigger portal fields: Name, Key (immutable, "used to reference the trigger within workflows"), Icon, Short Description, Summary, sample JSON payload, Filters (String, Select, Multi-Select, Dynamic; one Dynamic per trigger), custom variables (name + reference into the sample), Subscription URL (POST, optional headers) | VERIFIED |
| Create dialog (live portal, seen read-only by King's coordinator): only Name (required) and Key (required, hint `eg: myapp_new`), then Save. Everything else is configured after Save | VERIFIED (screen) / CHECK (edit screens after Save not opened) |
| Subscription URL receives `{ triggerData: { id, key, filters, eventType (CREATED / UPDATED / DELETED), targetUrl }, meta: { key, version }, extras: { locationId, workflowId, companyId } }` whenever a customer adds, edits or removes the trigger in a workflow. `targetUrl` looks like `https://services.leadconnectorhq.com/workflows-marketplace/triggers/execute/{id}/{id}` | VERIFIED |
| A workflow can run contactless; "send any payload data via Marketplace Triggers" and use it in the workflow; contact lookup is optional | VERIFIED |
| A deleted trigger: workflows using it skip execution. Each new version must be submitted and approved; on approval it becomes available to all sub-accounts | VERIFIED |
| **How the app FIRES a trigger** (method, auth header, body, rate limits) is NOT documented. Our reading: POST to the `targetUrl` the CRM gave, `Authorization: Bearer <account token>`, `Version: 2021-07-28`, JSON body of our payload (a third-party project reached the same reading and calls it inference) | **CHECK: prove on a test account before WORKFLOWS_WRITE_LIVE is switched on** |
| Trigger firing rate limits and payload size | CHECK (not documented). We cap ourselves: 20 per run, 30 per hour, 200 per day per trigger per account |
| Action portal fields: Name, Key (immutable), Icon, Short Description, Summary, input fields (String, Numerical, Textarea, Select, Multiple Select, Radio, Toggle, Checkbox, Attachment, Rich Text, Hidden, Dynamic; Required, Reference, Default, validation rules), Execution (API mode = POST to our URL with headers we define, or Custom Code), Pause Execution toggle, sample Response Data and custom variables, multi-branch options | VERIFIED |
| The request the CRM sends to our action URL: `{ data: {<input fields by reference>}, extras: { locationId, contactId, workflowId }, meta: { key, version } }` | VERIFIED |
| Request **signature**: none documented for custom actions. Headers are only the ones we configure. (The OAuth doc says the platform manages the token pair and passes the access token to external calls of custom actions and triggers; no header name given) | VERIFIED (absent) / CHECK (whether an `Authorization` or `X-GHL-Signature` header is sent) |
| Expected action **response**: a JSON object (sample saved as Response Data, arrays allowed, `branchId` routes the contact in sync multi-branch mode). Status-code semantics, timeout and retry policy: not documented | CHECK |
| Numeric input type spelling (`numeric` in examples vs "Numerical" in the UI) | CHECK |
| Private test app first, module edits apply to the whole app immediately | VERIFIED (RELEASE_1_1_0.md and the portal) |

### What we did about the gaps (decisions)
1. **Verification.** Because no platform signature is documented, the call is authenticated with a shared secret header **we define in the portal** (`x-subsync-key`, a long random value in env `WORKFLOW_MODULE_SECRET`), compared in constant time. If the CRM also sends `X-GHL-Signature` we verify it as a webhook signature (a wrong one is refused). `WORKFLOW_MODULE_REQUIRE_SIGNATURE=true` makes it mandatory once a test proves the platform signs these calls.
2. **Tenant.** Resolved only from the verified body, `extras.locationId`, which must be one installed, not-ignored account owned by exactly one install. Anything in `data` or at the top level is ignored for identity. A contact or appointment id that belongs to another account is "not found".
3. **Idempotency.** The CRM documents no execution id, so the key is a hash of action + account + workflow + contact + the step's own inputs (and `extras.executionId` if one ever appears). The same call twice does nothing the second time.
4. **Responses** are HTTP 200 with `{ ok, result, message, action }` for every business outcome (so a workflow can branch on `result`), 403 for unknown account / not switched on, 404 when the flag is off, 429 above 60 calls a minute per account, 400 for a malformed call.
5. **Firing** is built to the best reading above, behind `WORKFLOWS_WRITE_LIVE` (off: one "WOULD WRITE workflow.trigger.<key>" audit line per account and trigger, nothing sent, nothing marked sent so it still fires later).

## Triggers (fired by `/api/cron/workflow-triggers` every 10 minutes)
Only for accounts that switched the trigger on AND have a subscription (a workflow in the customer's CRM uses it). Order of checks: on, subscription, quiet hours (account's local 21:00 to 07:00 unless the account turned alert quiet hours off; held items stay eligible), room under the caps, never a Do Not Disturb contact, one send per episode (unique `sent` row), master switch. Payload: `trigger, contactId, name, phone, source, minutesWaiting, pipeline, stage, owner, link` and nothing else (no message text); the link uses the account's own CRM domain.

| Key | Fires when | Threshold | Episode (dedupe) |
|---|---|---|---|
| `subsync_lead_unanswered` | a counted lead (`lead_touches.excluded is null`) has no first human touch after X minutes, within the last 24 h | X = the account's speed target (setting), overridable on the card | the conversation |
| `subsync_no_show` | an appointment with status no-show and a start time in the last 24 h | none | the appointment |
| `subsync_deal_stuck` | an open deal worth more than 0 has not changed stage for N days | N = 14 default, 1 to 365 | the deal in that stage |
| `subsync_account_quiet` | no new lead for N days although there were leads in the last 60 days (contactless trigger; payload has the minutes since the last lead and a link to the account) | N = 7 default | the last lead's date |

Known gaps: `owner` is only filled for no-shows (the appointment's assigned user id; the lead and deal tables do not carry an owner SubSync trusts); `source` is the contact's source when synced; `pipeline`/`stage` only for deals.

## Actions
Endpoint `POST /api/hooks/workflow/action`; the action is chosen by `meta.key`. Order: verify, resolve tenant, flag, account opted in to THIS action (settings card, default off), per-minute cap, idempotency, safety rules, write gateway.
- `subsync_add_to_call_queue`: needs `extras.contactId`. Contact must exist in that account's SubSync copy; Do Not Disturb refuses; already carrying the account's call-queue tag (from Call queue settings) does nothing; otherwise the tag is added through `writeToCrm` (master `WRITE_GHL_LIVE` AND the account's write opt-in, else a dry run), audited, logged in `call_queue_log` with source `workflow`. Tag-only, so the delete/merge "protected" rules do not apply; DND does.
- `subsync_mark_outcome`: input `outcome` (showed / noshow) and optional `appointmentId` (else the contact's latest appointment in the last 7 days). The appointment must be in that account, belong to the contact, already have happened (same preview rule as the app), and not already carry that status; written through `writeAppointment` (same gate, audit and history marker as the app, so the echo is ours), local copy updated, action logged.

Own-write rule: both actions record who did it as `workflow`; the tag write goes through the same call-queue logging so the call-queue and webhook echo handling treat it as ours.

## Settings card
Settings, Integrations, "Workflow blocks" (`wfm-card.tsx`, API `/api/app/wfm`). Administrators only (company admins pick an account they may see; a client's admin manages their own). Per block: on/off (default off), the threshold where it applies, last fired time, count sent, "waiting for a workflow in your CRM to use it" when no subscription exists, and the cost sentence: the CRM bills each run to the client account; SubSync does not charge.

## Tests
`tests/unit/workflow-module.test.ts` (24): secret and signature verification, tenant read only from `extras`, subscription address allow-list, payload fields, caps and quiet hours, flag default off, opt-in and DND gating, idempotency, cross-account contact and appointment "not found", dry run vs live firing, dedupe, hourly cap, quiet hours, one post per address. `tests/unit/workflow-xtenant-db.test.ts` (real database, skips without one): cross-company contact not found, not-switched-on refused, subscription stored for the owning company only.

## Not verified live (cannot be, from here)
The firing request, the signature (if any) and headers on action calls, timeouts and retries, rate limits, the portal edit screens after Save, billing behaviour. All CHECK items above are for the private test app.

## Extras added while building
- Contactless "Account went quiet" trigger and its new-account guard (an account with no leads yet is new, not quiet).
- One post per address even when several workflows use the same trigger.
- A plain-words result for every action outcome so a workflow can branch on `result`.
