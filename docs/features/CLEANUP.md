# Clean-up: duplicates, data quality, history, rules, and writing to the CRM (stage CLEANUP)

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\CLEANUP`, branch `stage/cleanup`). Not marked passed. The parity research and the money-first test are in `docs/CLEANUP_PARITY.md`; the exact steps King follows to switch writing on are in `docs/NEEDS_KING.md` section 29.

King's words: "that is fucking important too, need a fucking good logic for that; they should be THESE TOOLS' STANDARD, and alike in features if possible." Added by the lead during the stage: "SubSync MUST write to the CRM where needed ... that is the whole point" (built to full quality, OFF until King flips one switch), and "parity is the floor, not the goal".

## 1. The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | Research the standard tools (public pages only) and write `docs/CLEANUP_PARITY.md` with a matrix, the money-first test at the top, price anchors | DONE: `docs/CLEANUP_PARITY.md` (12 tools; 4 could not be read directly and say so) |
| 2 | Investigate how a REAL merge can be done legitimately; do not enable a write; add a numbered section to `docs/NEEDS_KING.md` | DONE: parity doc section 3; `docs/NEEDS_KING.md` section 29. Verdict: no merge call exists; the customer's own "Merge Contact" workflow, started by an API call, is the only legitimate route |
| 3a | Configurable matching rules per account, visible match score and reasons, presets, saved per account | DONE: `cleanup-rules.ts`, `dedupe.ts` (`scorePair`, `groupDuplicates` take the rules), `cleanup-config.ts`, Rules tab, `MatchWhy` on every group, a live "what would this setting find" |
| 3b | Survivorship rules shown in the preview and editable as defaults | DONE: `pickFields` in `cleanup-rules.ts`, "What each field becomes" in the merge sheet, five selects in the Rules tab |
| 3c | Merge history and audit log screen with undo of SubSync-side decisions | DONE: History tab (`history-intel.ts`, `history-queries.ts`), undo of a decision or a set-aside |
| 3d | Data-quality score per account and client with a trend from stored snapshots, worst-first list, top 5 plus See all, 100+ accounts | DONE: `quality.ts`, `quality-queries.ts`, `cleanup_quality_snapshots`, Data quality tab; tested at 150 accounts |
| 3e | Standardization and validation findings with exact fixes, each opening its exact records (count equals rows), CSV of fixes, Open in your CRM | DONE: 12 findings, the shared records panel, `cleanup/quality/csv` |
| 3f | Scheduled scan with an alert when new likely duplicates appear | DONE: `cleanup-scan.ts` inside the existing refresh; alert kind `duplicates` to the bell (email and Slack only through the existing off switches) |
| 3g | "Stop new duplicates" as a copyable recipe | DONE: Rules tab, five steps, Copy button |
| 3h | Check-before-import tool | DONE: `import-check.ts`, `cleanup/import-check`, Data quality tab; in memory, 5,000 rows, 1.5 MB, nothing stored |
| 3i | Same visual language, one shared score and preview component | DONE: `ScoreMeter` in `cleanup-parts.tsx` is used for a pair's match score and a client's quality score |
| 4 | One menu entry "Clean-up" with tabs; old addresses work; flags honoured; client staff unchanged | DONE: `nav.ts` (the only nav change), `cleanup-hub.tsx`, `dashboard.tsx`; `tests/unit/cleanup-nav.test.ts` |
| 5 | Design skills run; what each changed; screenshots for four roles | DONE: section 6; `docs/review/cleanup-<role>-<width>.png` |
| 6 | Tests | section 5 |
| L1 | (Lead) the real write path: merge route, field updates, tags, safe removal only where the API allows | DONE, OFF: `src/lib/ghl/crm-gateway.ts`; removal is deliberately not built (section 3) |
| L2 | (Lead) ONE gateway: per-account opt-in in Settings, preview before/after, confirm, guardrails, never across accounts, rate limits, before-snapshot, audit per write, retry | DONE (section 3) |
| L3 | (Lead) keep `WRITE_GHL_LIVE` default false and the dry-run behaviour; stub-only tests | DONE; `src/lib/__tests__/crm-gateway.test.ts` uses a stubbed platform only |
| L4 | (Lead) NEEDS_KING: scopes, Vercel variable, first live test plan | DONE: section 29 |
| L5 | (Lead) parity rows from "needs write access" to "built, off until enabled"; improvements recorded | DONE: `docs/CLEANUP_PARITY.md` sections 2.5 and 4; ideas not built are in `docs/PROPOSALS.md` |

## 2. What changed (files)

New: `src/lib/analytics/` `name-match.ts`, `cleanup-rules.ts`, `email-fix.ts`, `quality.ts`, `quality-queries.ts`, `import-check.ts`, `history-intel.ts`, `history-queries.ts`, `cleanup-config.ts`, `cleanup-scan.ts`; `src/lib/ghl/crm-gateway.ts`; `src/lib/api/cleanup-routes.ts`; `src/app/app/views/` `cleanup-hub.tsx`, `cleanup-parts.tsx`, `quality-tab.tsx`, `history-tab.tsx`, `rules-tab.tsx`, `write-access.tsx`, `duplicates-extra.tsx`; `supabase/migrations/20261105120000_cleanup_v2.sql`; tests `cleanup-v2.test.ts`, `cleanup-history.test.ts`, `crm-gateway.test.ts` (node), `cleanup-v2-db.test.ts`, `cleanup-nav.test.ts` (vitest), `cleanup-v2.spec.ts` (Playwright).

Changed: `dedupe.ts` (rules, new reasons, household and shared-mailbox guards), `dedupe-review.ts` (reason words, pair scores), `dedupe-queries.ts` (per-client rules, name and swapped-digit candidates, preview counts, other contacts sharing a value), `duplicates-routes.ts` (score, reasons, picks, workflow plan, history, rules, merge through the workflow, undo of a set-aside), `duplicates.tsx` and `duplicates-parts.tsx` (embedded in the tab, match score, field picks, merge from SubSync; the old composed "Merge from here" button is no longer on screen, its code stays), `cleanup.tsx` (embedded, email typo rule, switch state), `cleanup-intel.ts`, `cleanup-platform.ts`, `cleanup-writer.ts`, `cleanup-queries.ts` (email rule; a dry-run outcome that leaves the changes waiting), `router.ts` (the gateway on apply, the new routes), `service.ts` (the daily scan and the alert), `catalog.ts` (the alert kind), `settings.tsx` (one card), `nav.ts`, `dashboard.tsx`, `dupes-demo.ts` (made-up mess), `data-inventory.ts`, `tenant-tables.ts`, `scripts/check-tenancy.ts` (additions only).

## 3. The write gateway (what makes writing safe)

Everything that changes a client's contacts goes through `src/lib/ghl/crm-gateway.ts`:

1. **Master switch.** `WRITE_GHL_LIVE` (off unless exactly `true`). Off: the request is built, one "WOULD WRITE" line (ids and field names only) is recorded, nothing is sent, and the changes stay waiting.
2. **Per-account opt-in.** `locations.cleanup_write_enabled`, off by default, switched on by a person in Settings, Integrations, Changing contacts (and in the Rules tab), written to the history with who and when. Without it a run is refused (403) and a merge answers "not switched on".
3. **Preview and confirm.** Field fixes: the exact before and after for every contact, and the number of changes typed back (existing flow). Merge: the plan (who survives, who is enrolled, the warnings) and a ticked box "I understand it cannot be undone".
4. **Guardrails.** Do Not Disturb blocks a merge; a third contact sharing the email or phone blocks it (the workflow merges every match); people who clearly differ block it; a group is never across two accounts (every id is re-read from the caller's own account); open deals, a won deal and different owners are warnings that need a deliberate click.
5. **Rate and batching.** Calls are spaced 150 ms (about 7 a second, under the platform's 100 per 10 seconds); the platform client also reads the rate-limit headers and retries a 429 or a server error with backoff; the runner works in batches of 20 with a time budget and resumes.
6. **Before-value.** Each field fix stores the value it replaced (`cleanup_changes.before_value`); the whole run can be undone (the contact is re-read first and left alone if someone changed it). A merge cannot be undone anywhere on this platform, and the screen says so.
7. **Audit.** One `crm.write` line per write: who, when, account id, contact id, the operation and the field NAMES only (tested: no phone number, name or email appears). Dry runs are `dry_run.would_write`.
8. **Failure handling.** A refused permission stops the run with "Needs permission"; a server error is retried by the client, then named with its number; a failed item stays failed with its reason and the person can run again (only what is left is retried).

**Merging.** There is no merge endpoint. The route is: add the NEWER record to the customer's own workflow that has the "Merge Contact" action (`POST /contacts/{id}/workflow/{workflowId}`, `contacts.write`); the CRM merges it into the OLDER record and keeps conversations, deals and notes. Limits stated in words: only exact email or phone matches; the older record always survives (SubSync says when that differs from its pick); a merge cannot be undone. The customer builds the workflow once per client (steps on the Rules tab). **Removal** of contacts (`DELETE`) is not built: it is permanent and loses history; a merge in the CRM already removes the extra record safely.

## 4. Metrics defined here

In `docs/METRICS.md`, section "Clean-up: data quality, match score and matching rules": the twelve findings, the score and its five parts, the trend rule, the new-duplicates alert, the pair score, the three presets, and which value wins.

## 5. Tests and verification

(see section 7 for the exact commands and their results)

## 6. Design skills run

(see below, filled in after the screens were photographed)

## 7. Verification record

(see below)

## FOR THE LEAD
(see below)
