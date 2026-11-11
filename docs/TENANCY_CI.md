# Tenant-isolation check in GitHub Actions

Workflow: `.github/workflows/tenancy.yml`. Runs the full `scripts/check-tenancy.ts` on every pull request to main (and by hand), in parallel with the `migrations` workflow, so it is finished before the PR is ready to merge. It never uses King's machine or the production database.

## How it works
1. A throwaway Postgres 16 service starts; Supabase roles and extensions are faked; every migration is applied (`scripts/migrate.ts`).
2. A test-only `.env.local` is written with made-up secrets (random `TOKEN_ENCRYPTION_KEY`, dummy CRM ids). No real secret is used.
3. `scripts/with-dev-server.mjs` starts `next dev` on port 3102 in demo mode with `FLAGS_ALL_ON=true` and `ENTITLEMENTS_MODE=open` (same as the local run), then runs only `check-tenancy`.
4. The check creates fixtures `xtest-agency-a/b` in the CI database, tries every cross-tenant read and write, and must print `nothing changed: ok`. The job fails if that line is missing.
5. The log is uploaded as the artifact `tenancy-log` (always, even on failure).

The only code change for CI: `DATABASE_SSL=off` makes `src/lib/db.ts` skip TLS (the CI Postgres has none). It is unset in production. No assertion was changed or shortened.

Limits: job timeout 40 minutes; a newer push to the same PR cancels the older run; the Next compile cache (`.next-int2/cache`) is cached.

## Reading a failure
- Download `tenancy-log` from the run page, or read the "Run the full tenancy check" step.
- An assertion error names the endpoint and the other agency's marker (for example `zzTenantB`) that leaked: that is a real isolation bug. Fix the route, never the test.
- "Dev server did not start": look for a compile error earlier in the log or a missing env value in the test `.env.local`.
- A migration error: same as the `migrations` workflow.
- Cancelled: a newer push replaced the run.
