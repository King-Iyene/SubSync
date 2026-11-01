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
