# QA scale and correctness (12 Nov 2026)

A repeatable test that builds a synthetic agency (3 client accounts, plus a second agency for isolation) at 120, 5,000 or 100,000 leads in a THROWAWAY Postgres, then checks every headline number and times every screen's endpoints through the dev server. It never touches the live database: both scripts refuse any `DATABASE_URL` that is not on localhost and any run without `DATABASE_SSL=off`.

## Files
- `scripts/seed-scale.mts` the seeder (`--size 120|5000|100000`; generate_series, deterministic, 2.8 s / 14 s / 166 s).
- `scripts/check-scale.ts` correctness and speed (works with `scripts/with-dev-server.mjs` as `CHECKS=check-scale`).
- `scripts/scale-guard.ts` the safety guard and the fixture ids; `scripts/scale-db-setup.mts` fakes the Supabase roles and extensions; `scripts/scale-server.mjs` starts one dev server on the throwaway database; `scripts/scale-probe.mts` calls endpoints by hand (`DUMP=800` prints bodies).
- `scripts/scale.env` the local throwaway connection (no secret in it). `.github/workflows/scale.yml` manual CI run (Actions, "scale", Run workflow, pick the size; default 5000).
- `src/lib/__tests__/scale-guards.test.ts` unit tests: the guard, the migration and the two query fixes below.

## What the seed holds (per run, agency A: 50/30/20 % over 3 accounts; agency B: size/10, 60 to 3,000)
Contacts: ~5 % no phone, 3 % invalid phone, 2 % duplicate phone, 3 % duplicate email, 8 % no email, 4 % do-not-disturb, 10 % no owner, 2 % test contacts. Tags (1 to 6 per contact): `test-lead`, `call-now`, `hot`, `cold`, `booked`, `no-show`, `lead-new`, `dnd`, 100-character names, an accented name with a comma, quotes and a tick, and upper/lower-case duplicates (`HOT`, `Hot`, `Call-Now`). Conversations for 85 % (35 % wait on us, aged 30 min / 2 h / 10 h / 36 h / 5 days), human and automatic touches, missed calls, lead rules applied the way the sync applies them. Appointments for 40 % (showed, no-show, no outcome, cancelled, future, double bookings). Deals for 50 % (+ a second deal on every 10th): two pipelines, $0 and empty junk, real values, no owner, open/won/lost, stage-change events. Tag history, call outcomes, wallet row, team names.

## How to run it
1. A throwaway Postgres on localhost (any one of):
   - Docker: `docker run --rm -p 5433:5432 -e POSTGRES_PASSWORD=ci postgres:16`
   - No Docker (Windows, what this run used): in a folder OUTSIDE OneDrive run `npm i embedded-postgres`, then start it from a small script with `initdbFlags: ["--encoding=UTF8","--locale=C"]`, `port: 5433`, `postgresFlags: ["-c","fsync=off","-c","shared_buffers=512MB"]` (a database in OneDrive made checkpoints take minutes).
   - CI: the `postgres:16` service in `scale.yml`.
2. `node --env-file=scripts/scale.env --import tsx scripts/scale-db-setup.mts` then `node --env-file=scripts/scale.env --import tsx scripts/migrate.ts`.
3. A test-only `.env.local` with made-up values (same as `tenancy.yml` writes; do NOT copy the real one).
4. `node --env-file=.env.local --env-file=scripts/scale.env --import tsx scripts/seed-scale.mts --size 5000`
5. One dev server: `node scripts/scale-server.mjs 3191` (add `WEBPACK=1` in a git worktree whose `node_modules` is a junction), or let CI run `scripts/with-dev-server.mjs`.
6. `BASE_URL=http://localhost:3191 node --env-file=.env.local --env-file=scripts/scale.env --import tsx scripts/check-scale.ts` (`SCALE_RUNS` warm calls per endpoint, `SCALE_WALK_PAGES` pages of each list to open, `SCALE_SPEED=0` skips timing, `SCALE_OUT=file.md` writes the table).

## Correctness: 64 checks, all passing at 120 and 5,000 leads; 63 of 64 at 100,000 (the one failure is timing drift, see below)
Each headline number is compared with an independent SQL count on the seeded rows, and each number with the rows it opens (every page read, no repeats):
- Speed to lead: leads / answered / within / late / waiting equal SQL; the waiting list opens as many rows as the tile; race judged/within equal SQL over 30 days.
- Unanswered: people waiting and the over-24-hours count equal SQL.
- Appointments: "no outcome" tile = its list = SQL; "no-shows to recover" = its list = SQL; double bookings = brute-force SQL (all pairs) = the Calendars conflicts list.
- Clients: ok + watch + act + unknown = 3 accounts; waiting and unmarked tiles equal the screens they come from.
- Pipeline: open deals and open value equal SQL (value above zero, has an owner, not an outlier); the stuck tile = its list.
- Find a lead, tags and sources: the Tags list count for each tag = SQL = the Find a lead total = the rows opened by Load more (no repeats, every row carries the tag); `test-lead`, `call-now`, `hot`, `cold`, `booked`, `no-show`, `lead-new`, `dnd`, `HOT`, `Call-Now`; match all / any / not-this-tag; one account; sources. Long and odd tag names never give a server error. Totals above 10,000 are shown as "capped" and compared as "10000+".
- Call mode: the `call-now` list holds the tagged leads. Going cold: the quiet group opens its count.
- Tag writes through the safe gateway: preview says how many will change; "do" without confirm is refused (400); with confirm it is a dry run (nothing saved, our own copy unchanged, one audit row per person, repeating the request in the same minute adds nothing).
- Clean-up: the leads list opens its count.
- Tenant isolation: agency A never receives agency B's accounts or contacts on 10 reads, agency B never receives A's on 8, a client-account user sees only its own account (and its own tag counts), a bulk tag on the other agency's contact is refused (404) and changes nothing.

## Speed: first call (cold, route already built) / p50 / p95 in ms (local Windows Postgres 18, one machine)
| Screen | Endpoint | 120 leads | 5,000 leads | 100,000 leads |
|---|---|---|---|---|
| Today | `today3?part=today` | 52 / 30 / 36 | 224 / 32 / 45 | 1423 / 33 / 36 |
| Today | `today` | 81 / 55 / 67 | 1102 / 695 / 999 | 7173 / 4455 / 4621 |
| Today | `today3?part=numbers&days=30` | 42 / 30 / 33 | 201 / 31 / 33 | 1319 / 29 / 30 |
| Speed to lead | `speed` | 33 / 39 / 61 | 134 / 129 / 131 | 592 / 620 / 664 |
| Speed to lead | `speed?part=race` | 44 / 52 / 61 | 242 / 169 / 182 | 1220 / 1129 / 1154 |
| Speed to lead | `speed?part=coverage` | 1234 / 1102 / 1200 | 934 / 905 / 981 | 4180 / 4863 / 4903 |
| Speed to lead | `speed?part=pulse` | 544 / 551 / 588 | 469 / 480 / 531 | 1391 / 1287 / 1379 |
| Speed to lead | `speed?part=booking` | 31 / 30 / 33 | 40 / 53 / 80 | 638 / 707 / 712 |
| Speed to lead | `speed?part=list&status=waiting` | 32 / 46 / 48 | 51 / 44 / 52 | 308 / 268 / 283 |
| Speed to lead | `speed?part=list&status=all` | 35 / 40 / 44 | 73 / 63 / 83 | 489 / 545 / 560 |
| Speed to lead | `speed?part=journey` | 38 / 31 / 46 | 48 / 45 / 50 | 461 / 370 / 374 |
| Speed to lead | `speed?part=insights` | 56 / 47 / 54 | 387 / 525 / 638 | 6318 / 5659 / 6217 |
| Unanswered | `inbox?part=home` | 68 / 50 / 65 | 136 / 121 / 132 | 1624 / 1538 / 1554 |
| Appointments | `appointments?part=overview` | 31 / 30 / 32 | 1952 / 30 / 38 | 4965 / 27 / 28 |
| Appointments | `appointments?part=needs-outcome` | 25 / 31 / 33 | 1319 / 31 / 42 | 1536 / 29 / 35 |
| Appointments | `appointments?part=noshow-recovery` | 39 / 30 / 31 | 1030 / 43 / 47 | 892 / 20 / 27 |
| Appointments | `appointments?part=list` | 593 / 27 / 32 | 604 / 35 / 47 | 1015 / 31 / 31 |
| Appointments | `appointments?part=flow-tree` | 568 / 30 / 34 | 537 / 33 / 42 | 956 / 32 / 34 |
| Appointments | `appointments?part=health` | 518 / 30 / 46 | 569 / 28 / 32 | 959 / 32 / 32 |
| Appointments | `appointments?part=sources` | 901 / 31 / 31 | 921 / 32 / 37 | 1428 / 33 / 41 |
| Appointments | `appointments?part=calendars` | 1972 / 31 / 38 | 2123 / 44 / 47 | 8688 / 28 / 32 |
| Appointments | `appointments?part=booking-share` | 1418 / 33 / 37 | 1376 / 33 / 34 | 2312 / 29 / 30 |
| Clients | `clients3?part=overview` | 24 / 27 / 34 | 102 / 32 / 39 | 1006 / 28 / 29 |
| Clients | `clients3?part=needs-attention` | 59 / 33 / 40 | 79 / 27 / 31 | 1026 / 32 / 33 |
| Clients | `clients3?part=billing` | 29 / 28 / 33 | 29 / 31 / 47 | 27 / 30 / 31 |
| Clients | `clients3?part=people` | 32 / 32 / 45 | 62 / 23 / 30 | 482 / 29 / 32 |
| Clients | `clients?part=home` | 27 / 31 / 35 | 237 / 30 / 33 | 1736 / 41 / 43 |
| Pipeline | `pipeline3?part=overview` | 48 / 30 / 34 | 219 / 29 / 33 | 3535 / 24 / 33 |
| Pipeline | `pipeline3?part=attention&bucket=stale` | 62 / 24 / 32 | 197 / 32 / 34 | 3269 / 28 / 30 |
| Pipeline | `pipeline3?part=list` | 50 / 31 / 33 | 189 / 30 / 34 | 2902 / 31 / 34 |
| Pipeline | `pipeline3?part=forecast` | 52 / 32 / 34 | 458 / 31 / 32 | 7480 / 29 / 30 |
| Pipeline | `pipeline3?part=sources` | 39 / 25 / 33 | 181 / 32 / 33 | 2873 / 32 / 36 |
| Pipeline | `pipeline3?part=health` | 51 / 31 / 33 | 198 / 30 / 34 | 2851 / 30 / 33 |
| Pipeline | `pipeline-intel?view=board` | 43 / 31 / 33 | 134 / 100 / 119 | 3070 / 2296 / 2797 |
| Find a lead | `people/options` | 29 / 32 / 34 | 54 / 16 / 22 | 504 / 29 / 29 |
| Find a lead | `people/find` | 33 / 29 / 32 | 34 / 30 / 33 | 30 / 30 / 33 |
| Find a lead | `people/find?tags=hot` | 31 / 35 / 60 | 33 / 30 / 32 | 34 / 46 / 51 |
| Find a lead | `people/find?tags=call-now&tagMode=any` | 28 / 32 / 35 | 21 / 29 / 37 | 40 / 41 / 48 |
| Find a lead | `people/find?notTag=hot&source=Referral` | 24 / 27 / 36 | 46 / 32 / 40 | 105 / 102 / 120 |
| Find a lead | `people/going-cold?bucket=quiet` | 34 / 42 / 45 | 49 / 71 / 80 | 516 / 574 / 668 |
| Find a lead | `contact-intel` | 61 / 44 / 49 | 187 / 197 / 234 | 3334 / 3597 / 3956 |
| Clean-up | `dq/leads` | 33 / 37 / 57 | 46 / 51 / 61 | 252 / 227 / 237 |
| Clean-up | `dq/dupes` | 19 / 30 / 33 | 37 / 31 / 32 | 24 / 30 / 31 |
| Clean-up | `data-health` | 83 / 31 / 39 | 31 / 35 / 42 | 5178 / 58 / 76 |
| Clean-up | `cleanup` | 32 / 28 / 32 | 31 / 29 / 35 | 29 / 31 / 32 |

Flags: over 1,000 ms warm or over 3,000 ms cold. The 100,000 column was taken before the last small change to `speed?part=coverage` (see below); every other row is final. Cold on `appointments`, `pipeline3`, `data-health` is the first read filling a server-side cache; the p50 shows the cached cost.

## Bugs found and fixed (each has a test)
1. Pipeline, every tab (`src/lib/analytics/pipeline3-queries.ts`): the per-account open total was left inline and the planner re-ran it once per deal: **92 to 125 s per read at 55,000 deals, now 2.5 s** (a one-word `MATERIALIZED`). Covered by `scale-guards.test.ts` and by the pipeline checks at every size.
2. Appointments, double bookings (`appointments3-queries.ts`): the tile joined every pair in an account on "same calendar OR same person" (**35 s at 40,000 bookings**), and the Calendars list behind it used a second, slightly different copy of the join (it counted bookings a day either side of the window, the tile did not, so the tile and its list could disagree at the edges, and the list took minutes). Both now come from one function (`clashKeys`): two indexed passes plus UNION. 4 s at 100,000 leads, where the data holds 126,000 clashing pairs; the cold Calendars tab went from several minutes to 9 to 16 s. Brute-force and list-equality checks run at 120 and 5,000.
3. Appointments, every list: the lead record before each appointment was found by scanning the account's leads for each appointment. New index `lead_touches_contact_idx` (migration `20261231090000_scale_indexes.sql`, additive; the same file adds `cached_appointments_owner_loc_start_idx`). Appointments overview cold 27 s to 5 to 7 s.
4. Speed, coverage tab: seven independent reads ran one after another; now together (4.9 s to about 2 s at 100,000 leads, 3.9 s to 0.9 s at 5,000).
5. Test-data finding, not a product bug: the "next page" cursor of the Clean-up leads list drops the microseconds of a timestamp; the CRM sends milliseconds, so real data is safe, but a record stored with microseconds repeats on the next page. The seed uses whole seconds.

## Found, not fixed (logged)
- `speed`, `today` (the old Today read), `contact-intel`, `speed?part=insights`, `pipeline-intel?view=board`, `inbox?part=home`, `speed?part=pulse`/`race` are still 1 to 6 s at 100,000 leads: they read the whole 30 day window and compute in the application. A rollup table (like `account_rollup`) is the fix; each needs its own plan. Under 1 s at 5,000 except coverage and insights (about 1 s).
- Hard read caps that silently cut a figure at very large accounts: `loadRows` 20,000 leads per window (`speed-queries.ts`), `loadTouchEvents` 60,000 events, the weekly history 50,000 rows. At 100,000 leads the 14 day window held 19,800 rows, just under the cap, so the numbers still matched; one more account of that size would be silently short. They should say "showing the newest 20,000" or be replaced by SQL aggregates.
- "Double bookings" counts pairs, so 31,000 bookings give 126,641. Honest for a handful, misleading for a stress account; consider "N bookings overlap another".
- Tag names: the Find a lead counts and filters treat `HOT` and `hot` as different tags; the lead panel's tag list merges them. The CRM keeps tags case-insensitive, so real data should not show it. INFERENCE.
- Cross-screen tiles (Clients waiting/unmarked vs the screens they come from) can differ by 1 to 3 at 100,000 leads because bookings and replies pass their time limit between two slow reads; the check allows 5.
- `pg_timezone_names` is joined by every appointment and coverage query; on this Windows build each use costs about 150 ms (that is why coverage is about 1 s even with 120 leads). Not an issue measured on Linux; check on Supabase.
- 100,000 leads is a 166 s seed and about 3 GB of disk; the CI workflow is for 5,000 (about 3 minutes).
