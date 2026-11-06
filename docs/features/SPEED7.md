# Speed to lead, seventh pass (stage SPEED7, branch `stage/speed7`)

## Part A: scale
Every Speed figure is now an SQL aggregate over `lead_touches` (`src/lib/analytics/speed-sql.ts`, `speed-sql-cards.ts`), never a read of every lead. The judging rule (within / late / waiting / not judged yet) is written once in SQL and checked against the original row-by-row `judge`/`summarise` in `tests/unit/speed7-scale-db.test.ts`.
- One grouped query per card (grouping sets give each account and the total in one pass): home summary, per-account ranking, weekly bars, waiting facts, people, auto-vs-person, no-source, scores, leak, proof, booking buckets.
- Lists are cut in the database (where, order, limit 40, offset) with exact totals and facets, search and sort on the server.
- Pulse (reasons, ready to act, person table, velocity, by-day), journey (+ list), Race, Coverage, Proof, Booking and Capture (lead flow, grouped counts) converted. Samples inside a payload are 8 rows per group; every count is exact.
- Migration `20261113090000_speed7_scale.sql` (indexes and rollup columns, additive, NOT applied). Code works without it.
- Not done: the new `speed_daily` columns are not yet filled or read (long ranges still use the index-bounded window aggregates); Coverage's touch-event cards (missed calls, best time, channel mix) still read the newest 60,000 events; the 2-day ladder preview and one-day duplicate drafts still use the capped row loader.
- `DB_POOL_MAX` (default 5) lets a deployment allow more parallel statements.

## Part B: phone (390)
Passed: speed6a, speed6b, speed6c, dial. speed4 hung once (browser crash) and was skipped. CSS: tab strip fades at the edge and snaps, 44px targets inside `.s6`.

## Part C: design review
Skills run on phone screenshots of the agency Race, Pace and Coverage tabs only (the full 4 roles x 2 widths run did not finish on the slow database link). Changes: tab strip edge fade and snap (hierarchy: shows more tabs exist), 44px minimum targets, helper text lifted to contrast above 4.5:1. Copy was reviewed and left as is (tests match its wording).
