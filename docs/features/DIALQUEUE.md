# DIALQUEUE: fill the CRM's own call queue from Call mode

SubSync cannot start a call itself. The call queue is the CRM's own dialer: SubSync ranks leads and puts them where the CRM's Manual Actions page finds them. Research read 6 Nov 2026, public pages only, no live calls.

## 0. How could SubSync ship and auto-create the workflow at install? Recommendation first

**Recommendation.** Keep the TAG route as the default (works today, needs only `contacts.write`, no beta access). Add a one-click "Set up call queue" button that uses the Workflows API to create the workflow when the account is allowed to (INFERENCE that this will be rare for now: the API is limited availability). Do NOT depend on a Marketplace Module or a shipped snapshot. Fallbacks, in order: (1) API-created workflow, (2) a snapshot/workflow share link King publishes for agencies to import, (3) the customer builds 3 steps by hand (the in-app guide).

**What the dialer vendors do (public pages).**
- WAVV: install from the agency marketplace, pick sub-accounts, a WAVV button appears in each sidebar, the customer signs up there. Nothing public says it auto-creates or auto-publishes a workflow. UNVERIFIED that it does. https://wavv.com/highlevel
- Kixie: ships its own workflow ACTIONS (for example "Add to PowerList") that appear in the workflow builder; the customer builds the workflow and picks the action. https://support.kixie.com/hc/en-us/articles/35092491864091-HighLevel-Workflow-Actions-for-Kixie
- Aloware / Hot Prospector: no public page found for a HighLevel auto-created workflow (Aloware's public "add to power dialer" action is documented for another CRM). UNVERIFIED for HighLevel.
- Pattern (INFERENCE): marketplace dialers ship custom workflow actions through developer-portal Modules; none is documented as pushing a published workflow into the account. The customer still builds the workflow.

**1. Modules: custom workflow action and trigger. VERIFIED (partly).** Developers can create custom Workflow Triggers and Actions in the Marketplace. They appear in a sub-account's workflow builder only when the app is installed there. Actions belong to "LC Premium Triggers & Actions" and are billed per execution to the sub-account, which must have that feature turned on. Scope: `workflows.readonly` to read them. The page does not say how a trigger is fired from our server. https://marketplace.gohighlevel.com/docs/marketplace-modules/WorkflowActionsAndTriggers.md . Our own action "Add to call queue" would mean a per-execution charge on the customer for no benefit over the tag, so NOT recommended now. A custom trigger fired by SubSync would remove the tag, but how to fire it is CHECK.

**2. Snapshot attached to the listing. VERIFIED (limits).** A listing may include one snapshot, sold with the app; the buyer pushes it to locations themselves; the link could not be edited after publishing (2023 docs, may be outdated). Not an install-time hook. https://marketplace.gohighlevel.com/docs/marketplace-modules/Snapshots.md . A single workflow can be copied to another sub-account by hand (INFERENCE, agency blogs).

**3. Workflows API (v3). VERIFIED.** Endpoints: Get Step Types, Validate Workflow Definition, Create Workflow, Get/Update Workflow Definition, Update Workflow Status, Search, Delete, logs. Create: `POST /workflows?locationId=`, scope `workflows.write`, header `Version: v3`, body `name`, `source.system`, `triggers`, `actions`, `edges`, folder by `folderName`/`folderPath` with `createFolderIfMissing`. Always created as `draft`; publish with Update Workflow Status. **Limited availability: enabled only for selected sub-accounts, others get 403 `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION`.** https://marketplace.gohighlevel.com/docs/ghl/workflows/create-workflow . Whether a "Manual Action: Call" step type exists in Get Step Types: CHECK (the page was not readable). Update Workflow Status scope: CHECK (probably `workflows.write`).

**4. Enrol a contact. VERIFIED (shape).** `POST /contacts/{contactId}/workflow/{workflowId}`, scope `contacts.write`, optional body `eventStartTime`; the docs say `Version: v3`, our client sends 2021-07-28 like the other contact calls (CHECK). Published-state requirement and rate limit not stated (CHECK). https://marketplace.gohighlevel.com/docs/ghl/contacts/add-contact-to-workflow

**5. Manual Actions page. VERIFIED (help pages, third party and a partner knowledge base).** Under Conversations, Manual Actions: call or SMS tasks made by workflows, campaigns or power-dialer lists; filter by workflow, type, status (Yet to Call, Completed, Skipped) and assignee; complete, skip or re-queue; bulk assign. Ordering, a per-user cap, and whether the dialer opens inline: not documented (INFERENCE: tasks are assigned to a user by the workflow step). https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000006720-understanding-manual-actions-in-hirise-design . Deep link `.../v2/location/<id>/conversations/manual_actions` is King's observation (VERIFIED by King), built in `src/lib/links.ts`.

### Design for install-time setup (build only after King confirms the API is enabled for a test account)
- Portal: King enables scope `workflows.write` as OPTIONAL (also `workflows.readonly`). No Module needed.
- Where: INSTALL webhook (location installs) and the "Set up call queue" button both call one function `ensureCallQueueWorkflow(location)`.
- Create: one workflow in a neutrally named folder ("Call queue"), name "Call queue (tag)", trigger: contact tagged `subsync-call-now`, action: Manual Action: Call (assigned to the contact owner or round robin, CHECK), action: remove the tag. Validate first (Validate Workflow Definition), create, then Update Workflow Status to published. Dry run until WORKFLOWS_WRITE_LIVE is on.
- Idempotent: store `workflow_id` in `call_queue_settings` (already has the column); before creating, look up by id, then by exact name in the folder (Search); never create twice; a double INSTALL event or button press is a no-op.
- Failure: on 403 `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION` or a missing step type, show the 3-step guide (tag route) with no error tone.
- Uninstall: SubSync never deletes the customer's workflow; it stops tagging, and says in Settings "your Call queue workflow is still in your CRM; delete it if you do not want it". Data deletion on uninstall is unchanged.
- King must click: portal scope toggle, and the first real test (a test account the API is enabled for; ask HighLevel support if not). Nothing else.

## Other behaviours SubSync could delegate to ship-with-the-app workflows (all INFERENCE, same limits)

| Behaviour | Trigger SubSync can set | Workflow action | Today |
|---|---|---|---|
| Auto-calling of hot leads | tag `subsync-call-now` | Manual Action: Call | this stage |
| Text back after a missed call | tag `subsync-missed-call` | SMS with a template the customer edits (writes a message, needs consent rules, so customer-owned) | not built |
| Appointment reminders | native appointment trigger | SMS/email | the CRM does this natively; do not build |
| No-show recovery | tag `subsync-noshow` | Manual Action: Call + SMS task | list exists in Call mode |
| Speed-to-lead breach alert | tag `subsync-late-lead` | internal notification to the owner | SubSync already alerts by email and in-app |
| Stale deal nudge | tag `subsync-stale` | task for the owner | Clean-up |

## 1. Build as shipped (this stage)
- Pure rules `src/lib/dial/callqueue.ts` (unit tested): who qualifies, DND and no-phone skipped, lead-local calling window, caps (per run 25, per day 100, manual batch 50), 24 h memory (a due redial is exempt), 30 writes per run, un-tag when a lead no longer qualifies.
- Executor `callqueue-exec.ts`: spaced 2.1 s (28 a minute), stops on missing permission or 429, dry run records nothing as queued.
- Server `callqueue-run.ts`, routes `/api/app/dial/cq-*`, cron hook in `/api/cron/sync` (every cron run, live accounts only). All writes through `writeToCrm`: WRITE_GHL_LIVE off by default, per-account opt-in, one audit line per write.
- Tables: migration `20261116090000_call_queue.sql` (NOT applied). Until it runs every route answers that it needs the database update.
- Un-tag on outcome or reply: a lead leaves the queue when it falls off the lists (called, answered, booked, replied where the list excludes replies, asked not to be contacted). Webhook-triggered fill is not built: the cron path is every few minutes (INFERENCE: closer to 45 to 60 s needs the fast delta path hooked in).
- The CRM's own smart list on the tag `subsync-call-now` is a live view of the queue.
- Adding to the queue cannot be undone from SubSync; the screen says so.
