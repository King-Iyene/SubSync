# Handoff (3 Nov 2026, end of the M1 and M2 build)

Source of truth: CLAUDE.md (read "Working principles" and the operating principles). Standing routines: docs/PROMPTS.md.

## State
- Branch `claude/ecstatic-dijkstra-os2oco` holds the whole build: overnight branch + main-s6rbxo (merged, histories were unrelated) + E2b + D1 + simplify cuts 1 to 6 + test and security fixes. It was merged to `main` once all tests were green (see docs/FEATURE_STATUS.md, "Final test run").
- M1 (S0.2b, S0.4, F1, D0, F2, F3, F6) and M2 (F4, F5, F8, F9, F10, C1, E0, E2a, E2b, D1) are built and pass the tests listed there.
- Nothing was run against Supabase, the real CRM, real email, Slack or Fathom. Live switches (`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`) must stay off until docs/features/E0.md's morning tests pass.

## King must do (steps in docs/MERGE_AND_MIGRATE.md)
Apply the 13 new migrations to Supabase in order, check `GHL_APP_ID`, keep live switches off, then the pre-pilot pricing gate ($9 Pro, delete $5, tell Claude the plan id, enforced mode).

## Waiting for King's yes (not built)
- docs/INNOVATION_M1_M2.md: Alert outcomes (recommended), Coverage gaps, Likely no-show ranking.
- docs/SIMPLIFY_M1_M2.md cuts 7 to 14 (hide Duplicates/Cleanup, merge Team, Compare and Reviews, merge Slack card, Getting started trim).
- E2a: KEEP or CUT after real Fathom meetings. E2b needs a decision on the `conversations/message.write` scope (comments stay "SubSync only" until then). Zoom scope (E1), F9 product-name hiding.

## How to run the tests (sandbox or laptop)
Typecheck `npx tsc --noEmit`, lint `npx eslint`, build `npx next build`, Node `node --test "src/lib/__tests__/*.test.ts"`, Vitest `npx vitest run --no-file-parallelism` (needs DATABASE_URL to a THROWAWAY Postgres with the migrations applied; never production), HTTP checks `scripts/check-*.ts` against a dev server, browser `npx playwright test --project=desktop-1440`. Reseed the demo (`scripts/seed-demo.ts`, `scripts/make-sample-audit.ts`) before a browser run; some tests change the demo's state.
