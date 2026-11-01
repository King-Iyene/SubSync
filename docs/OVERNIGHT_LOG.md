# Overnight log (branch `overnight/2026-11-01`)

Rules: `docs/OVERNIGHT_RULES.md`. Plan and order: `docs/ROADMAP_V2.md` section 3. Coverage ledger: `docs/NOTES_COVERAGE.md`. Things for King: `docs/NEEDS_KING.md`.
Re-read those files and `docs/PROGRESS.md` in full at the start of every stage and after any context compaction.

## Start state (1 Nov 2026, evening)

- Repo: `C:\Users\KING\OneDrive\Desktop\SubSync` only. Branch `overnight/2026-11-01` created from `main` at 7f88137 (the docs commit), with the earlier uncommitted work carried over (Z2, Z3, Getting Started guide, test fixes, tenancy fixture fix).
- Roadmap V2.1, integrations spec and review notes N1 to N104 are in `docs/` (commit 7f88137, verified: "V2.1", E0/E2a/E2b, "3.2 Agency users", "11.1 Supabase rules", "N104" all present). Principles 1 to 14 are in `CLAUDE.md` between the markers, once.
- Old-runbook stages F1 to F10, E1 to E4, Z2 and Z3 were already BUILT before tonight (see `docs/PROGRESS.md`). Tonight's work for each stage is the delta that `docs/ROADMAP_V2.md` adds, with evidence rows. A stage is never marked PASSED.
- Test state on arrival: the integration chain (`scripts/with-dev-server.mjs`) passed api, connections and insights checks; the tenancy check failed once on `jobs: 2 !== 1` for the other agency. Cause found: the production sync cron (every 5 minutes, same database) queues jobs for any non-demo installation with a refresh token, and the fixture had one. Fixture now has no refresh token. A stale `next dev` server (PID 6448) on port 3100 earlier caused a 503 on the Zoom check; it was stopped.

## Decisions made for King

1. DECIDED FOR KING, please review: the coverage tool `scripts/notes-coverage.mjs` is committed (a small helper, outside any stage) so statuses can be updated reliably.
2. DECIDED FOR KING, please review: the review notes N1 to N26 were read in full tonight; N27 to N104 headings and stage lines were read for the ledger, and each note is read in full when the stage that handles it starts (logged per stage).

## Stage log

### Baseline close-out (S0.3 treated as PASSED by King's pre-approval; King still does his 5 checks)

Commands and real results (1 Nov 2026, on `overnight/2026-11-01`):
- `node scripts/with-dev-server.mjs` (nine integration checks, run in two parts because of the fixture fix): check-api passed ("All API checks passed"), check-connections passed, check-insights passed; then `CHECKS=check-tenancy,check-flags,check-metrics,check-audit,check-speed,check-roadmap`: tenant isolation (384 cross-reads) ok, feature switches ok, overview numbers ok, account audit ok, speed to lead ok, roadmap ok, `checks exit: 0`.
- `npm run verify`: `verify exit: 0`; Node tests `ℹ tests 329, pass 329, fail 0`; Vitest `Test Files 17 passed (17), Tests 116 passed (116)`; lint 0 errors, 6 warnings.
- `npm run e2e` (Playwright, three widths): `156 passed (45.1m)`, `1 failed`, `146 skipped` (the review-capture spec only runs with REVIEW=1), `3 did not run` (the three tests after the failure in the same serial file).
- The 1 failure (phone-390, settings spec "brand name"): TWO causes, both fixed. (1) Saving a setting ran a full recompute of every account (22 seconds on the demo tenant) even for a brand name; `settingsUpdate` in `src/lib/api/router.ts` now recomputes only when a setting that feeds a number or alert changed (`INSIGHT_SETTINGS`). That is a real fix: a 22 second save on a brand name would also have hurt customers. (2) The test looked at the first element containing the brand name, which on a phone is the hidden desktop sidebar: the test is wrong, now `.filter({ visible: true })`. Rerun on phone-390: brand test, Getting started, What's new, five groups: `4 passed (1.0m)`; the whole settings spec had 5 passing before the brand test ran. The demo tenant's brand name was restored (the test restores it; a manual PUT also restored it).
- Fixtures: the tenancy fixture lost its refresh token so the production cron cannot queue jobs for it (this had caused `jobs: 2 !== 1` once). A stale `next dev` server on port 3100 had caused a 503 on the Zoom check.

DECIDED FOR KING, please review: the stage agents (sub-agents, one at a time) build each stage from `docs/OVERNIGHT_AGENT_BRIEF.md`; I (the lead engineer) re-run the full suite and commit/tag each stage myself.
