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

## 5. Tests written

Node (`src/lib/__tests__`): `cleanup-v2.test.ts` (nicknames, initials, spelling, transposed digits, shared household phone, shared company mailbox, placeholder numbers, presets, common names, survivorship, every finding and its exact fix, the score and a tiny sample, the trend, worst-first, the import check), `cleanup-history.test.ts` (history sentences, undo rules, 150 accounts and 5,100 groups, a 20,000-contact scan), `crm-gateway.test.ts` (stubbed platform only: switched off, no opt-in, audited with ids only, the merge route's blockers and results). Database (`tests/unit/cleanup-v2-db.test.ts`, forged ids on every new route, a client's staff refused, what-would-this-setting-find, the import check stored nowhere, history and undo, apply never reaches the platform, 150 accounts) and `cleanup-nav.test.ts`. Browser: `tests/e2e/cleanup-v2.spec.ts` (four roles at three widths, menu and old addresses, a setting changes the groups, data quality count equals rows, a pasted file, history, merging explained). Updated: `dedupe.test.ts`, `cleanup-intel.test.ts`, `duplicates-merge.spec.ts`, `menu.spec.ts`, `s02b.spec.ts` (one word each).

## 6. Design skills run (what each changed)

- **Design critique.** Found: the trend sentence wrapped in a narrow box; the page opened on a tip box before the number; the Duplicates screen was a stack of technical blocks (score, bullet list, rules note, table) around the merge button. Changed: trend boxes widened; and, with King's feedback of 5 Nov, the whole Duplicates screen was redesigned: one question ("Are these the same person?"), two cards showing only what differs, a match meter with one plain reason, "Yes, combine them" beside "No, different people", everything technical behind "How we decided"; Data quality opens with a score ring and three big cards. Kept (worked): the calm column, no pills, compact right-hand row buttons.
- **Accessibility review.** Found: the score bar was announced twice (an image label and the number); the "Copy the fixes" and "Download" buttons repeated on every row with the same name; the import result was not announced. Changed: the bar is hidden from assistive technology and the number carries a spoken label; each row button names its problem; the import result is a status region. Checked: tabs are a real tab list with arrow keys; radios sit in a labelled group; the strictness slider has a label and a description; every phone button is 44 px; fast-review keys work only after the person turns the switch on (WCAG 2.1.4); the ring is hidden decoration with a spoken sentence.
- **UX copy.** Changed: "Merge now" to "Start the merge"; "Strict, Balanced, Loose" to "Careful, Normal, Thorough"; "duplicate groups" to "people appear more than once"; "A pair needs a score of 50" to "Likely matches are shown"; the database-update messages to "not available yet, SubSync is finishing an update". Kept: "Decide later", "Skip", "Undo", the plain history sentences.
- **Dataviz palette check.** The ring and the bars use the app's own status colours (success, warning, destructive) and always carry the number and a word (colour is never the only signal); the trend is the existing one-line sparkline in the single series colour. No new chart type, no categorical palette, so the validator was not needed.

### Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| A plain summary with an estimate of the time ("about 27 minutes") and a progress bar | P2 | Duplicates |
| "Combine all the sure ones" previews the list first | P2 | Duplicates |
| Fast review: Y, N, L or swipe | P3 setter, P2 | Duplicates |
| What a setting would find, before saving it | P1, P2 | Rules |
| Three big cards with a real before and after | P1, P4 | Data quality |
| Check a file before importing, copy only the new people | P2 | Data quality |
| Copy the fixes as CSV, open each contact in the CRM | P2 | Data quality |
| Copyable five-step recipe to stop new duplicates; copyable merge-workflow steps | P2 | Rules |
| History with Undo | P1, P4 | History |

## 7. Verification record (commands run in `C:\Users\KING\wt\CLEANUP`, 4 to 5 Nov 2026)

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint src tests scripts/check-tenancy.ts` | 0 errors, 13 warnings |
| `node --test src/lib/__tests__/` | 944 tests, 944 pass |
| `npx vitest run tests/unit/cleanup-v2-db.test.ts tests/unit/cleanup-nav.test.ts tests/unit/client-access.test.ts tests/unit/ds-components.test.ts tests/unit/tenant-tables.test.ts tests/unit/data-inventory.test.ts --no-file-parallelism` | 65 pass, 1 fails: the live-database half of `data-inventory.test.ts`, because the migration `20261105120000_cleanup_v2.sql` is not applied to the live database (the inventory names its 3 columns and 1 table). It passes once the migration is applied. The migration-file half passes. |
| `PW_BASE_URL=http://localhost:3191 npx playwright test tests/e2e/cleanup-v2.spec.ts --project=desktop-1440` | 9 of 9 pass (one test was re-run alone after a fix: the strictness choices were disabled while the database update was missing; now they can be tried without saving) |
| the four role tests at `phone-390` and `tablet-768` (no sideways scroll, plain words, tabs per role, 44 px phone buttons) | 8 of 8 pass |
| `scripts/check-tenancy.ts`, the integration chain, the full e2e suite | NOT run (the brief forbids it; the lead runs tenancy alone). New read addresses and 7 forged writes were appended to `scripts/check-tenancy.ts`. |

Screenshots: `docs/review/cleanup-<role>-<390|768|1440>.png` for the four roles (agency all accounts, agency inside one account, a client's staff, a business owner), plus `cleanup-agency-all-rules-1440.png` and `cleanup-agency-all-history-1440.png`.

## 8. NOT verified

- **Every real CRM call.** Tests use a stubbed platform only. The merge-workflow route (is a published workflow required, the `Version` header, which record survives, Do Not Disturb, conversations and deals after a workflow merge) and the field updates through the new gateway were never run against the platform; the first live test plan is `docs/NEEDS_KING.md` 29 (e).
- **Saving rules, the per-account switch and the score history** were exercised only through code paths that skip when the migration is missing (the database test marks them "needs the update"); they run once the migration is applied. The strictness preview ("what would this setting find") was verified live on the demo: Careful 5 groups, Normal 10, Thorough 55 for one client.
- **The daily scan and the new-duplicates alert** need the snapshot table; their code ran only in the part that does not need it. UNSURE: how long the daily scan takes for an agency of 100 accounts with 50,000 contacts each (it is time-budgeted at 25 seconds per refresh and resumes).
- **Fast review on a real phone** (swipe) was not tried on a device; keys Y, N and L and the buttons were exercised in code review only, not in a browser run.
- **Real agency scale.** 150 accounts and 5,100 groups were tested in units; a 20,000-contact account was scanned in a unit test; no real agency with 100 accounts was used.
- **The UI research** rests on two pages read in full (HubSpot, Insycle) and review summaries for the rest.

## FOR THE LEAD

**Log entry.** Stage CLEANUP: Clean-up module (Duplicates, Data quality, History, Rules), one write gateway, the friendly redesign. BUILT, awaiting King's checks. Decisions for King: switching writing on (NEEDS_KING 29; recommend yes, one throwaway test account first); a client's staff keep Duplicates and gain History only (DECIDED FOR KING); the older Data cleanup apply is now behind the gateway (a behaviour change, no real use lost). UNSURE: see section 8. NOT VERIFIED LIVE: every CRM write.

**Migration.** `supabase/migrations/20261105120000_cleanup_v2.sql`: `locations.cleanup_rules jsonb`, `locations.cleanup_write_enabled boolean not null default false`, `settings.cleanup_defaults jsonb`, new table `cleanup_quality_snapshots` (RLS on, no policy, like its siblings). **Additive: yes. Idempotent: yes. NOT applied by me** (the brief). The old code never reads any of it; the new code works without it (Normal matching, writing off, no history). Needs applying before the rules, the switch and the score trend work; `tests/unit/data-inventory.test.ts` (live half) fails until it is.

**Shared logs.** The task asked for entries, so I appended (end of file only) to `docs/NEEDS_KING.md` (new section 29, renumber if another stage took it), `docs/DECISIONS.md`, `docs/METRICS.md`, `docs/TENANCY.md`, `docs/PROPOSALS.md`. Not touched: `PROGRESS.md`, `FEATURE_STATUS.md`, `NOTES_COVERAGE.md`, `OVERNIGHT_LOG.md`.

**Coverage updates.** None (no note id is about this; it answers King's chat instruction).

**Files likely to conflict at merge:** `src/app/app/nav.ts` (the Duplicates and Data cleanup lines became Clean-up and Duplicates-as-child, plus one PARENT entry); `src/app/app/dashboard.tsx` (the imports, the `menu` line, the two `case` lines); `src/lib/api/router.ts` (imports, one dispatch block before the speed block, the cleanup apply gate, `cleanupView`); `src/lib/api/duplicates-routes.ts` and `src/app/app/views/duplicates.tsx` and `duplicates-parts.tsx` (the Duplicates stage's files, heavily changed); `src/lib/analytics/dedupe.ts`, `dedupe-review.ts`, `dedupe-queries.ts`; `src/lib/analytics/service.ts` (3 lines in `refreshInsights`); `src/lib/notifications/catalog.ts` (one word); `src/app/app/views/settings.tsx` (one import, one line); `src/lib/demo/dupes-demo.ts`; `src/lib/data-inventory.ts`, `src/lib/tenant-tables.ts`; `scripts/check-tenancy.ts` (additions); `tests/e2e/duplicates-merge.spec.ts`, `menu.spec.ts`, `s02b.spec.ts` (one word each); the appended docs.

**Local-only change not committed:** `next.config.ts` has a `turbopack.root` line (skip-worktree).

## Round 2 (5 Nov): advanced matching, prevention, polish

Built: `match-evidence.ts` (weighted evidence, tiers, penalties, learning), "Look deeper" in the rules (on in Thorough), rejected pairs never return (read from the stored decisions in `dedupe-queries.ts`), the Maybe filter, `arrival-parse.ts`, `prevention.ts`, `arrival.ts` (webhook hook), `tagPossibleDuplicate` in the gateway (stub-tested), the arrivals card, the prevention tick in Rules, the daily alert counts arrivals. UI: body text is at least 14 px in the Clean-up screens (no `text-xs`), score ring counts up and draws in (reduced motion respected), cards lift on hover and show a focus ring, a check mark pops on the all-clean state. Merge-with-caution stays the rule; the workflow route is behind the gateway so the other session's workflow feature can plug into `mergeViaWorkflow` and `tagPossibleDuplicate`. Decision recorded in `docs/DECISIONS.md`: Clean-up's Data quality tab is the one data-quality screen; the separate Data health module stays flagged off.
Verified this round: see the lead report. NOT verified: the webhook payload shape of a real contact-created event (read defensively; unit-tested on three shapes), the precision and recall on real data.

Round 2 verification (5 Nov): tsc clean; eslint 0 errors; node --test 1047/1047; vitest cleanup-v2-db 10/10, cleanup-nav, tenant-tables, client-access pass; Playwright cleanup-v2.spec.ts desktop-1440 and phone-390 (role tests, menu, setting preview, data quality): 11/11 pass. Screenshots re-taken for the four roles at 1440 and 390 (768 not re-taken this round, per the lead). check-tenancy not run.
