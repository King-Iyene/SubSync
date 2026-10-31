# Progress

Read this first when a session restarts. Rules: `docs/RUNBOOK.md` section 0 (one stage at a time, STOP after each, wait for King's NEXT). Where documents disagree, `CLAUDE.md` wins.

## Current stage

**S0.3 White-label hygiene: BUILT AND VERIFIED (31 Oct 2026).** King said to keep going without PASS or NEXT; next stage: **F1 Numbers truth**.
Evidence: `docs/features/S0.3.md` (S0.2: `docs/features/S0.2.md`; F1 spec: `docs/features/F1.md`). From S0.3 on King does not need to type PASS or NEXT; every stage still writes its evidence and King's 5 checks.

## Stage list (Milestone M1 first)

| Stage | Name | Status |
| --- | --- | --- |
| S0.1 | Test harness and safety rails | Passed |
| S0.2 | Identity, roles, tenant isolation | Passed |
| S0.3 | White-label hygiene | Built, verified (King's checks pending, no wait) |
| F1 | Numbers truth | Not started |
| F2 | Speed to lead | Not started |
| F3 | Appointments | Not started |
| F6 | Account audit and Share link | Not started (M1 complete after this) |
| F4, F5, F7 to F10 | M2 pilot menu | Not started |
| E1 to E4 | Zoom, Fathom, Slack, hidden pages | Not started |
| Z1 to Z3 | Re-review, release 1.1.0, first pilot | Not started |

## Open issues (carried forward)

- `docs/READINESS_AND_TEST_PLAN.md` is referenced by `CLAUDE.md`, the runbook and the review plan but does not exist. King to supply, or ask for it to be written.
- The repo folder sits inside OneDrive, which locks files and breaks `next build` and `next dev` with `EPERM` errors from time to time. Moving the repo outside OneDrive is recommended (King's call).
- Tests and the demo tenant use the same Supabase project as production. Demo rows are flagged `is_demo`, but the brief wants separate dev and production projects (King's step).
- (Resolved) Vitest first needed `--legacy-peer-deps`, which made the Vercel build fail. Fixed by upgrading `@types/node` to 24 (production runs Node 24); a plain `npm install` now works.
- The 21-item Review (`docs/FULL_REVIEW_REPORT.md`, `UX_REVIEW.md`, `METRIC_AUDIT.md`, `COPY_AUDIT.md`) lists the S1 problems that F1 and F5 will fix.
- Local database access depends on the machine having IPv6 (Supabase's direct host is IPv6 only). It was down for several hours on 31 Oct.

## Facts a fresh session needs

- Run everything with `npm run verify` (typecheck, lint, build, 286 Node tests, 78 Vitest tests, plus a build-output secret scan) and `npm run e2e` (24 layout tests at 3 widths plus 30 white-label tests at desktop width).
- Run `npx next build` before every push; a failed Vercel build keeps the last good deploy live silently.
- Never run two test runs at once; they fight over port 3100 and the `.next` folder.
- The demo login works only with `DEMO_MODE=true` and never when `NODE_ENV` or `VERCEL_ENV` is `production`. `APP_MODE=maintenance` is the kill switch.
