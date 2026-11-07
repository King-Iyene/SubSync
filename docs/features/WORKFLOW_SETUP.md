# WORKFLOW_SETUP: set up the call queue workflow in a client account

Built on the Workflows API v3 findings in DIALQUEUE.md (Create is limited availability and answers 403 `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION` elsewhere). Decision (King): build assuming the API gets enabled for installers, but always offer a guided fallback.

## What exists
- `src/lib/workflows-setup/`: `templates.ts` (registry; one template, `call_queue`, version 1), `steps.ts` (resolves real step type ids from Get Step Types), `client.ts` (HTTP client + error mapping), `provisioner.ts` (idempotent find-or-create, gated writes), `naming.ts`, `run.ts` (database + token wiring).
- Routes `/api/app/dial/cq-wf` (GET state), `cq-wf-setup` (POST, confirm), `cq-wf-check` (POST, read only), `cq-wf-settings` (PUT: folder name, assign, auto setup). UI: `workflow-setup-card.tsx` inside Call mode > Call queue setup.
- Table migration `20261117090000_workflow_setup.sql` (NOT applied): `workflow_setup` and `workflow_setup_settings`. Both are in the tenant lists (removed on uninstall and on removing one account).

## Rules
- Folder: find or create ONE folder (the Create call carries `folderName` + `createFolderIfMissing`); workflow: look up by stored id, then by exact name; never created twice; never edited, renamed or deleted; a newer template version only shows "Update available". A workflow the customer deleted is re-created only when a person presses Set up, never by an automatic run.
- Writes: `WRITE_GHL_LIVE` AND the account's write opt-in, else the answer is "Would create folder X and workflow Y". Validate first (live only), create, publish, 2 s apart. One audit line per write (dry run by the gateway, live by the provisioner), ids only.
- Names (white-label safe): folder default "Lead Response Automations", or "<Brand> Automations" when the company brand is on, or a per-account name; workflow "Call queue"; tag default `call-now` (a tag already saved keeps working). A vendor word is refused everywhere. The template key exists only in our table.
- Calls are assigned to a chosen user or round robin, never "contact owner".
- Fallback: 403 not enabled, missing permission, a rejected definition, or a missing step type (Manual Action: Call) shows a calm message and "Do it yourself in 5 steps" with copy buttons, plus "I did it" (read-only check; without `workflows.readonly` it counts contacts carrying the tag).
- INSTALL: for a location install, after the first sync is queued, it runs only when the account has "Set up automatically" on (default off). It never stops an install.
- Uninstall: customer workflows are never deleted; our rows go with the install's data.

## UNVERIFIED until the first enabled account
The step config field names (trigger tag, manual action assignment, remove tag), the Get Step Types answer shape, and the Update Status scope. The validate call runs before any create and a rejection falls back to the guide.

## Planned templates (listed only, not built)
`missed_call_textback` (tag, SMS the customer owns), `noshow_recovery` (tag, call + SMS task), `speed_breach_alert` (tag, notify the owner).
