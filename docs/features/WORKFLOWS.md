# Workflows module (stage W1)

## Step 1: evaluate before building (principle 1)

1. **Decision and user.** The agency owner (and a client admin for their own account) decides which automations to keep, fix, rename or retire, and whether each client account has the basic lead-handling automations at all. They next open the broken one in the CRM, or fix it from SubSync after a preview. If it were missing they would say: "I cannot tell which of my 40 clients has a workflow that silently stopped."
2. **Data.** VERIFIED against the live operation catalogue (`search_operations` and `describe_operation`, 4 Nov 2026). The list, the definition, step logs and log counts exist. Response field names of the search and the logs are only CHECK (the catalogue gives the shape, not a sample), so the parser accepts several spellings and shows "not known" instead of guessing.
3. **Native or competitor overlap.** The CRM lists workflows per account, and All The Apps lists them too. Neither ranks failing or idle workflows across accounts, finds accounts with no lead-handling workflow, or does bulk rename with a preview and an undo. Our edge is cross-account health, safe bulk operations and proof (a log of what was caught and changed). We do not build a workflow builder (section 8 of the brief).
4. **Simplest version that proves value.** A table of every workflow in every client account, a health list with "what to do next", then rename, publish, unpublish and delete behind preview and confirm. SubSync-side labels and ratings work without any write permission.
5. **Risk.** Write permissions (optional, off until reconnect), deleting a workflow ends contacts in progress (typed confirmation, daily cap, snapshot first, extra confirm when it ran recently), renaming a published workflow needs it set to draft for a moment (the preview says so and it is off by default in bulk), no customer content is stored (names, states, counts, times only).

## Verified API facts (all `services.leadconnectorhq.com`, location token)

| Operation | Endpoint | Scope | Status |
|---|---|---|---|
| Search | `POST /workflows/search` (filters name, status, folder, updatedAt; sort; limit; offset or `searchAfter`) | `workflows.readonly` | VERIFIED shape, item fields CHECK |
| Get one definition | `GET /workflows/{id}/definition` (round trips into the update; carries `version`) | `workflows.readonly` | VERIFIED |
| Step logs | `GET /workflows/{id}/logs` (newest first, 60 days kept, max 30 day window, filters by status, contact, run) | `workflows.logs` | VERIFIED |
| Log counts | `GET /workflows/{id}/logs/aggregate` (`groupBy`, `statuses`, 30 day window) | `workflows.logs` | VERIFIED |
| Create | `POST /workflows/` full definition, always created as draft | `workflows.write` | VERIFIED |
| Validate | `POST /workflows/definition/validate` (nothing saved) | `workflows.write` | VERIFIED |
| Update definition (rename, edit) | `PUT /workflows/{id}/definition` full overwrite, `version` required, **draft only** (published returns 409) | `workflows.write` | VERIFIED |
| Publish or unpublish | `PUT /workflows/{id}/status` body `{status: published or draft}`; locked or scheduled-paused return 409 | `workflows.publish` | VERIFIED |
| Delete | `DELETE /workflows/{id}` permanent, ends enrolments in progress | `workflows.delete` | VERIFIED |

Consequences: there is no "rename only" call. Rename is draft, read definition, overwrite with the new name, publish again (so a published workflow is briefly a draft: shown in the preview, never done without a tick). Clone is create from a definition read in another account (CHECK: asset ids inside a definition may not exist in the other account, so a validate call comes first and failures are shown). There is no "folders" or "tags" write, so labels and groups stay in SubSync. There is no way to read who is inside a workflow right now, only recent enrolments and exits from the logs (the delete guard uses that, labelled an estimate).

## Scopes (all OPTIONAL)

`workflows.readonly`, `workflows.logs`, `workflows.write`, `workflows.publish`, `workflows.delete`. Without them the screen says "Needs permission: reconnect" and names the exact ones. Readonly alone gives the inventory; logs adds health and last run.

## Plan and flags

Feature `workflows` (inventory, free tier read only) and `workflows_pro` (health alerts, labels, history) and `workflows_write` (safe edits, admins only). Flag `workflows` is OFF by default (`DEFAULT_OFF`), on for the demo and tests (`FLAGS_ALL_ON`). `WORKFLOWS_WRITE_LIVE` (default off) decides whether a confirmed write is sent: off means a dry run that is recorded and sends nothing.

## Guardrails on every write

Preview (a table of before and after), signed confirm token (15 minutes, tied to this install and these exact changes), typed name for delete, caps (5 deletes and 100 changes per day per company, 50 per request), snapshot of the definition before any change or delete, idempotent by `op_key`, audit row, history row (`workflow_changes`), role check (agency owner or admin, business admin; never a client's staff), excluded from every metric. Undo: rename and publish state are reversed by a new change; a deleted workflow is recreated as a draft from its snapshot with a new id (CHECK how well definitions round trip).

## PROPOSALS (not built, need King's approval)

- **PROPOSAL 1: Template library and snapshot restore.** Keep a library of the agency's best workflows (from snapshots), push one to many accounts with validate first, restore a broken one to last week's version. Evidence: agencies rebuild the same five workflows per client; All The Apps sells snapshot stores.
- **PROPOSAL 2: Proof in the weekly Receipts.** One line per account per week from the logs: "Missed-call text back ran 31 times, 0 failures, 4 leads replied" next to the lead-handling numbers, so the agency can show the automation worked. Evidence: the thesis in the brief (prove it to clients); needs the logs permission and a minimum sample.

## Second pass (11 Nov 2026): outcome gaps, library, bulk install

**Customer view.** Who: agency owner (all accounts), client admin (own account). Next: open the people who fell through, set up the missing automation from the library after a preview. If missing: "I cannot tell which client's lead handling is leaking." Pays: the gap list with the open deal value (estimate) is the consultant check, every hour.

**Evaluation.** (a) decision above. (b) Data: lead_touches, touch_events, cached_appointments, cached_opportunities, all held already, verified by running the SQL against the live schema in the cross-tenant test. Automations present/missing is by workflow name (estimate). (c) Native and competitors: no cross-account outcome check found (WORKFLOWS_R1.md). (d) Simplest: four outcome gaps per account, each with the automation that prevents it. (e) Risk: writes (rehearsal unless live switch plus per-account opt-in), false "missing" when a workflow has an unusual name (labelled estimate).

**Live probe (read-only, scripts/wf-probe.mts).** Run 11 Nov against the live database: the one real install has NO workflow permissions granted (`workflows.readonly`, `workflows.logs`, none in its scope), and this machine has no platform client credentials to refresh a token, so no workflow call was made. Response field names stay CHECK; parsers still read several spellings and show "not known". Unlock: King reconnects the install with the optional workflow permissions, then run the script.

**Built (flags default off: wf_outcomes, wf_library, wf_bulk, wf_today).** Gaps tab (tiles, ranked accounts with keyset paging, search, filters, every count opens the exact people with Open), "What to do today" line plus one alert per account and gap through the alert engine (feeds Today), daily record `wf_outcome_daily` (our moat: history of leaks per account), Library tab (templates: call queue, slow-first-reply call task, no-show call task; guides for the two that message customers), install in one or up to 25 accounts with preview, signed confirm, caps, audit and History rows, rehearsal by default. Change history already exists (`workflow_changes`); install rows added. Sample data only with `?wffx`.

**Not available (said on screen).** Who is inside a workflow now, per-recipient delivery. Missed call text back and reminders are not created by SubSync (they message customers).
