# Workflows R1 (11 Nov 2026)
Labels as in TODAY_R1.md. Builds on docs/features/WORKFLOWS.md, docs/features/WORKFLOW_SETUP.md, docs/research/WORKFLOWS_COMPETITORS.md and WORKFLOWS_PAIN_POINTS.md, docs/BLOCKED.md.

## What exists
workflows*.tsx (about 6 files), src/lib/workflows/{ghl,sync,health,rename,tidy,run,reports,proof-email,detail,guards,cron,delivery,store}.ts: table of every workflow in every client account, health list with "what to do next", rename, publish, unpublish and delete behind preview and typed confirm, drift flags, name linter, proof email. Writes OFF until reconnect with the optional write scope and a live switch (WORKFLOWS_WRITE_LIVE). VERIFIED (read docs and file list). Never tested against a real account (docs/BLOCKED.md last row).
Thin: (1) response field names of search and logs are CHECK, so health may show "not known"; (2) no "no lead-handling workflow at all" check proven live; (3) no alert "turned off since yesterday" proven; (4) campaigns tab limited to totals.

## Platform (VERIFIED via the operation catalogue 4 Nov 2026)
- Gives: workflow search (status, version), definition read, step logs and log counts, create, validate, update, publish, delete; campaign lists and per-campaign totals (emails/stats.readonly).
- Lacks (docs/BLOCKED.md): rename of a published workflow without pausing, who is inside a workflow right now (logs cover about 60 days), per-recipient delivery list, delivery by hour, folders and tags write.
- Workflows API is limited availability per CLAUDE.md: CHECK on each install; infer failures from conversation and appointment data when absent.
- NOT available: why a contact was skipped beyond the log text; workflow trigger conditions without one definition read each.

## Competitors
- Native app: per-account list and run history; the installed-apps page flags connection failures, not failed runs (INFERENCE).
- Lead Spine: builds from a sentence and audits once (INFERENCE). Consultants: monitoring retainers about $150 to $500 per month (INFERENCE, WORKFLOWS_COMPETITORS.md).
- All The Apps: snapshot management and store; no failed-run alerting found (INFERENCE).
- Zapier and Make monitor their own scenarios, not the CRM's workflows (INFERENCE).
None found that continuously monitors all client accounts and alerts.

## Customer pain (INFERENCE: consultevo.com, 2026 GoHighLevel support-problems article "automations that stop triggering without warning")
1. A workflow stops or is switched off and nobody knows; leads go unanswered for days.
2. Steps fail silently (no phone, wrong sender).
3. Snapshot pushes cause drift between client accounts.
4. Duplicate workflows fire twice; messy names; no bulk operations.

## Biggest sources of error
- Reading "no runs" as "broken" when the account simply had no leads: compare with expected volume from lead flow.
- Deleting or renaming a workflow with contacts in progress (typed confirmation, snapshot first, daily cap).
- Mixing our write with a human edit: re-read version before write, refuse if it changed.
- Customer content stored: store names, states, counts only.

## Moat
Change history of each workflow (status, version, last run, error counts) recorded by us: "turned off on 8 Nov at 14:02, 31 leads arrived since, none were texted". The cross-link to Speed to lead (leads without a first touch while their workflow was off) is the proof only we can show. Outcome-based per CLAUDE.md 1A: workflows are the cause, unanswered leads are the proof.

## What would make an owner pay
Same-day "this automation stopped" alert with the count of leads affected, replacing a $150 to $500 monthly consultant check. Plus a bulk safe fix list.

## Customer's-eye check
Pays? Yes for the alert; not for a workflow table. Confusing: "drift", "enrolment". Say "different from your other clients" and "people who entered". Priority is proving it on real data before adding anything.
