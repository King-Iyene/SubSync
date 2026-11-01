# Progress

Read this first when a session restarts. Rules: `docs/RUNBOOK.md` section 0 (one stage at a time, STOP after each, wait for King's NEXT). Where documents disagree, `CLAUDE.md` wins.

## Current stage

**F5 Today: BUILT AND VERIFIED (31 Oct 2026).** King asked to build F7 to F10, E1 to E4 and Z1 to Z3 first, push as built, then run the full tests.
Evidence: `docs/features/F4.md` (F6: `docs/features/F6.md`). From S0.3 on King does not need to type PASS or NEXT; every stage still writes its evidence and King's 5 checks.

## Stage list (Milestone M1 first)

| Stage | Name | Status |
| --- | --- | --- |
| S0.1 | Test harness and safety rails | Passed |
| S0.2 | Identity, roles, tenant isolation | Passed |
| S0.3 | White-label hygiene | Built, verified, follow-up done (branded install link, company name replaces product name) |
| S0.2b | Tenancy follow-ups (overnight run, 1 Nov) | BUILT, awaiting King's checks: no cross-client matching, client staff never receive agency-only data (tested), "What we store" generated from the schema and "Delete my data" owner-only, login domain found automatically, no "save a meeting in an account" setting, Zoom and Google Meet hidden, Meeting notes page off until E2a. Evidence: `docs/features/S0.2b.md` |
| F1 | Numbers truth | Built, verified (King's CRM checks pending, no wait) |
| F2 | Speed to lead | Built, verified (King's CRM checks pending, no wait) |
| F3 | Appointments | Built, verified (King's CRM checks pending, no wait) |
| F6 | Account audit and Share link | Built, verified (M1 complete) |
| F4 | Inbox and SLA | Built, verified |
| F5 | Today | Built, verified |
| F7 | Accounts | Built (tests run at the end) |
| F8 | Settings, Getting started, What's new | Built (tests run at the end) |
| F9 | Alerts and emails | Built (tests and real sends at the end) |
| F10 | Call lists | Built (tests at the end) |
| E1 to E4 | Zoom, Fathom, Slack, the pages that were hidden | Reviewed and documented; real meeting, Slack and write tests need King |
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

- Run everything with `npm run verify` (typecheck, lint, build, 286 Node tests, 78 Vitest tests, plus a build-output secret scan) and `npm run e2e` (76 tests: layout, white-label, consistency and speed; the full run takes about 13 minutes).
- Run `npx next build` before every push; a failed Vercel build keeps the last good deploy live silently.
- Never run two test runs at once; they fight over port 3100 and the `.next` folder.
- The demo login works only with `DEMO_MODE=true` and never when `NODE_ENV` or `VERCEL_ENV` is `production`. `APP_MODE=maintenance` is the kill switch.
