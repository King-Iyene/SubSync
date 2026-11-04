# Handoff: Today v2 (4 Nov 2026)

Branch `claude/ecstatic-dijkstra-os2oco` holds Today v2 on top of main f07a7f6. It is NOT merged to main yet.

## Built (see docs/features/TODAY.md, docs/DECISIONS.md "Today 2")
- Every number, tile, slice, bar, point and insight opens a records panel (search, sort, Open, Maximise).
- Fix first and Accounts needing you use fixed columns (King's alignment bug).
- Account picker: Done, Show all accounts, Esc, outside click and whole-row ticking work (King's dead-button bug).
- Insights with why, end-of-day forecast, People / Sources / Coverage tabs, daily email preview, command palette (Ctrl Shift K), saved views, print report.
- Working queue (Done / Snooze / Assign) stored only in SubSync table `today_actions` (migration 20261104090000, also in docs/sql/PASTE_IN_SUPABASE.sql). Without the migration the app opens normally and says "Needs the latest database update".
- Tenancy leak found and fixed (marks across accounts), with a DB test.

## Last known test results
tsc clean, eslint 0 errors, node tests 831 pass, vitest 734 pass. Desktop 1440 browser: Today specs 48 of 49 in a combined run; f1 N8, f4 and one Today spec passed alone and failed only under shared-database contention. NOT re-run together after the last fixes.

## Next steps for whoever continues
1. Start Postgres (`pg_ctlcluster 16 main start`), make a throwaway DB, apply all migrations, reseed the demo (scripts/seed-demo.ts, scripts/make-sample-audit.ts).
2. Run alone, one session only: typecheck (`npx next typegen && npx tsc --noEmit`), node tests, vitest `--no-file-parallelism`, `npx next build`, scripts/check-*.ts (tenancy, enforced entitlements), then `npx playwright test --project=desktop-1440`. Look at the Today screenshots in docs/review/today*.png for looks.
3. If green, merge to main, then confirm the Vercel status and the GitHub Actions Check run from GitHub.
4. Tell King the migration is still needed in Supabase.

## King must do
Apply docs/sql/PASTE_IN_SUPABASE.sql (15 migrations incl. today_actions) in the Supabase SQL Editor. Not yet applied.

## Choices that are mine, not King's
"Done holds 7 days"; which stale deals the junk control leaves out. Rejected: sparkline annotations.

## Not verified
Real installs (only the demo company); since-last-visit needs a second visit.
