# Filter audit (13 Nov 2026)

King: "the 90 days filter is still not working" and "check the filter for all other modules". Rules: `docs/DATE_RULES.md` section 2.
Method: the real router called in-process (`scripts/audit-filters.ts`, read only) for the real company behind **KD Squares Test** (location `ojRd5O4FHowafUkAMZxn`), each read asked for 30 days, 90 days and 30 days + the account picker; answers compared path by path. The test company has no closed (won or lost) deals, no payments and no finance access for the test session, so those rows can only show "does not move" for lack of data, not for a bug; they are marked.

## Server answer keys (the likely cause of "still not working"): NOT the cause
Stored answers (`read_answers`), the in-memory answer cache and every route cache (`today3`, `appointments`, `pipeline3`, `clients3`, `people3`, `cash`, `payments`, `wg`, `bf`, exec) are keyed by the **whole address** (`sp.toString()` / sorted query without `_r`) plus who is asking. `src/lib/__tests__/cache-keys.test.ts` now proves, for every stored read, that each of 34 filters (from, to, hours, compare, location, account, pipeline, stage, owner, source, tag, status, channel, calendar, q, page, size, sort, part, basis, period, range, days ...) changes the key, and fails when a route cache key stops holding the whole address. The query-level caches (finance range, payouts range and basis, call queue filters, pipeline basis location/pipeline/owner/source/search, brief, growth dates) are guarded too. 30 days never answers 90 days.

## What was actually wrong (found and fixed)
| # | Where | Bug | Fix |
|---|---|---|---|
| 1 | Pipeline > Overview, Won / Lost, "No reason" | Counted a fixed 30 days (`d30`) whatever the bar said (card text "N won in 30 days") | Count what closed inside the bar's window (live SQL and stored rollup); text says the real number of days |
| 2 | Speed to lead > People ("Who replies fastest?") and "Which channel gets answered fastest?" | Hard-coded `days=30`, no mention on screen | Follow the bar (`from`/`to`/hours), one line under the title says "Leads that arrived <dates>, Lagos time" |
| 3 | Speed to lead > Coverage, "Lost at night" empty line | Typed "in the last 30 days" under a 90-day bar | Shows the bar's dates |
| 4 | Pipeline > Money flow table (King's count-vs-rows report) | DEALS column was `openCount` = only deals inside the money (value, owner, not test, not outlier), so pipelines full of no-value deals showed 0 | `allOpenCount` = every open deal of the pipeline (live and stored branch); DEALS shows it, "N in money" beside it when smaller; the existing "Not counted in money: ..." sub-line keeps the reasons. Overview tile reads "Open money, N of M deals counted" |

Live check of #4 (read only, KD Squares Test, 90 days): Event Registration Pipeline 7 (all no value), AGL Sales Pipeline_Leprofessor 36 (17 no value, 19 test), Test Cleaning Services 1, Air Conditioner Pipeline 1, vasquez real estate by sekibo 1, Willow Creek Med Spa 17, Skill acquisition pipeline 12: all non-zero now, money $0 where nothing is counted.

## Module x filter result
Legend: works = number moves with the filter, checked live; labelled = fixed window or "as of now", and the screen says so; fixed = bug above; code-only = read in code and unit tests, not run against the database; n/a = filter does not apply.

| Module / tab | Dates (30 vs 90) | Account picker | Pipeline pick | Own filters |
|---|---|---|---|---|
| Today: Lead flow, Growth, Email leads | works (live: 135 > 305 leads, 5 > 39 emails) | works (sent as `location`) | n/a | n/a |
| Today: Booking funnel mini | works (live 134 > 197) | works | n/a | code-only |
| Today: Overview, Today, Exec summary, Clients flow, Wallet | labelled "as of now" (live: unchanged, as the rules say) | works where numbers exist | code-only (PR #145) | n/a |
| Today: Numbers, Proof | code-only (heavy read timed out on the shared database during the run) | code-only | code-only | n/a |
| Speed to lead: Home / queue | labelled (queue is "now"; trend weeks fixed) | works (5 fields move) | n/a | code-only |
| Speed to lead: Pulse, Ignored leads | works (31 > 91 days, 25 fields move) | works | n/a | code-only |
| Speed to lead: Journey, Booking | window passed to the SQL (code); live unchanged on this account's data | works | n/a | code-only |
| Speed to lead: Coverage | fixed (#3); window passed to SQL | works | n/a | code-only |
| Speed to lead: People scorecards, Channels | fixed (#2) | note: these two cards have no account picker of their own | n/a | n/a |
| Speed to lead: Proof (printable) | labelled "last 30 days against the 30 before" (fixed on purpose) | works | n/a | n/a |
| Speed to lead: Race / Curve | labelled "right now" / "own last 90 days" | works | n/a | n/a |
| Appointments: Overview, Health, Needs outcome, Flow tree, Sources, Calendars, Booking share, Exec slots/summary/decisions, Work, Insights | works (live: booked 0 > 35, unmarked 0 > 22, rows 0 > 20 ...) | works | n/a | code-only (outcome, status, calendar, source, user) |
| Appointments: Trends, Receipt, Exec pace | labelled (this period against the last, "ignores the bar" line) | works | n/a | n/a |
| Appointments: Meetings home / matching | not tested (401 for the in-process session) | not tested | n/a | not tested |
| Pipeline: Overview | fixed (#1); open money labelled "as of now" | works | works (PR #145) | n/a |
| Pipeline: Pipelines table / Money flow table | fixed (#4); dates apply to won and lost only | works | works | works (search) |
| Pipeline: Sources, Stage history | works (live: sources 2 > 15, history rows 3 > 20) | works | works | code-only |
| Pipeline: Won/lost, People, Health, Stuck, Slipping, Attention | window passed (code); live unchanged: this company has no closed deals | works | works | code-only |
| Pipeline: Funnel / River | not touched (other builder) | | | |
| Money: Payments today | works (window moves; no payment events in test data) | works | n/a | code-only |
| Money: Finance (overview, payouts, ledger) | not tested live (403 for the test session; owner only) | code-only | n/a | code-only |
| Clients, Find a lead, Account audit, Clean-up / Duplicates, Team, Meeting notes, Calls / Inbox, Workflows, Proof | **not tested live** (the shared database timed out during the run); code-only: cache keys proven, windows read through the shared parsers (tests in `filters-everywhere.test.ts`), "as of now" families say so (DATE_RULES section 5) | code-only | n/a | code-only |

## Left
- Run `AUDIT_ONLY=<module> node --env-file=.env.local --import tsx scripts/audit-filters.ts` (3 reads per endpoint) for the rows marked not tested, when the database is quiet.
- Today open-pipeline tile still says "N deals" meaning the money-counted deals (its drill-down opens exactly those); the other counts now say "of M".
- Funnel counts are history based ("entered a step") and are not the same number as open deals; the other builder owns that screen.
