# Workflows build: one integrated builder brief

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (list in TODAY_BRIEF.md first paragraph). Read: docs/research/WORKFLOWS_R1.md, WORKFLOWS_COMPETITORS.md, WORKFLOWS_PAIN_POINTS.md, docs/features/WORKFLOWS.md, WORKFLOW_SETUP.md, docs/BLOCKED.md, src/lib/workflows/*, views/workflows*.tsx.

Goal: replace the $150 to $500 per month consultant check. Alert the same day an automation stops and say how many leads were affected. Outcome-based (CLAUDE.md 1A): workflows are the cause, unanswered leads are the proof. No workflow builder. SubSync never messages leads.

## Evaluation (principle 1)
(a) Decision: owner (all accounts) and client admin decide which automation to fix now; next they open it in the CRM or fix it after a preview. Missing: "I cannot tell which client has an automation that silently stopped". (b) Data: VERIFIED catalogue (search, definition, logs, counts); response field names are CHECK: first job is a live read-only probe on King's own test location, record real shapes in docs/features/WORKFLOWS.md and replace guessed parsers. If the API is unavailable on an install, fall back to outcome signals (leads with no first touch). (c) Native and competitors: no cross-account failure alerting found (WORKFLOWS_R1.md). (d) Simplest: "turned off / failing / never ran" list with leads affected. (e) Risk: writes (optional scope off until reconnect), false "broken" when volume is zero, stale parsers.

## Slices (inside one builder, in order)
1. **Live verification and parsers** (read-only): probe real responses; fix parsers; show "not known" rather than guess.
2. **History recording first:** append-only `wf_status_events` (account, workflow id, status, version, last run, error count, seen at) on every sync; idempotent on (workflow, seen minute bucket). Gives "turned off on 8 Nov 14:02".
3. **Stopped-automation alert:** status turned off, error rate spike, or silent while leads kept arriving (join lead flow: leads in the window with no first touch). Alert through the existing alert engine, in-app and email; dedupe, quiet hours, per-account mute. Wording "Your 'New lead text' automation stopped on Mon. 31 new people arrived since; 0 were texted."
4. **Coverage check:** accounts with no lead-handling workflow at all (name or trigger heuristics, labelled "looks like"), clickable list.
5. **Drift and names:** plain wording "different from your other clients", name linter with preview (exists); verify live.
6. **Safe fixes (existing, verify then enable):** rename, publish, unpublish, delete behind preview, snapshot, daily cap, extra confirm when it ran recently; DELETE needs a typed confirmation naming the workflow; all CRM writes through the gateway; undo where the platform allows. Flag `WORKFLOWS_WRITE_LIVE` stays a King switch.
7. **Receipt line** into Today: "we caught N stopped automations, M fixed".

## NOT available (say so on screen)
Who is inside a workflow now, per-recipient delivery list, delivery by hour, rename of a published flow without pausing, folders/tags write (docs/BLOCKED.md). Campaign write needs a scope King has not approved.

## Scale and tenancy
Per-account rollup of workflow health refreshed in the hourly sweep; keyset paging for 100 to 200 accounts and thousands of workflows; filters recompute counts; count equals rows; tenant guard on every location and workflow id; cross-tenant DB test.

## Customer's-eye check (required)
Owner of 20 accounts: does the first screen say "2 automations need you"? Would they cancel a consultant for it? Confusing words: drift, enrolment: replaced. Record in docs/features/WORKFLOWS.md.

## Setup
Worktree C:\Users\KING\wt\WF, branch stage/wf, port 3643. Flags `wf_alerts`, `wf_coverage`, `wf_history`, `wf_fixes`. Migrations from 20261206090000 (`20261206090000_wf_status_events.sql`, `20261206100000_wf_alert_state.sql`). Tests: parsers against recorded real fixtures, alert dedupe, zero-volume not flagged, xtest- tenant cross-read.

## Extras to list
"Affected people" button opening the exact leads; weekly "automation health" line for the client receipt; one-tap mute per workflow.

## Done when
Probed on a real location, flags ON, verified with real roles in a browser, why-would-I-pay pass written.
