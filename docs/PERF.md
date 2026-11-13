# Performance budget and how to measure it

Target (King, 13 Nov 2026): shell and sign-in under 2 s; every module's first meaningful paint under 1 s warm and under 3 s cold; tab switches under 300 ms; no skeleton longer than 1 s when data is cached.

## Measure

```
npm run perf:measure                       # every module (slow: about 20 minutes from a far-away machine)
npm run perf:measure -- "Money" "Pipeline"  # some modules
BUDGET_MS=3000 npm run perf:measure -- Today   # exit 1 when a module's reads, opened all at once, take longer
```

It calls the real app router in this process (no server needed) against the database in `.env.local`, as a signed agency session for the biggest real company. It sends GET reads only and never writes
(`ANSWER_STORE=off` is set so the stored-answer table is not written either). The reads per module are the ones in `scripts/demo-endpoints.json` (recorded from the real screens).

It prints per module: the slowest reads (first call with nothing cached, then the same read again), the statements each used, and the wall time and statement count when the module's reads all go at once (how the browser opens it).

Read the output like this:

- **Statements** are exact and do not depend on where you run. This is the number to keep down; a read that needs a dozen statements one after the other costs a dozen round trips.
- **Milliseconds** from a developer machine include about 190 ms per round trip to the database (production is a few ms in the same region), so they are about 50 times the production figure for round-trip-bound reads. Compare runs from the same machine.
- Other live traffic on the database adds noise, so repeat a slow number before acting on it.

Every API answer also carries `Server-Timing: app;dur=<ms>, stmts;desc="<n>"` (visible in the browser's network panel). `stmts` counts the statements this server instance ran while the request was open
(a number only: no names, no ids; an upper bound when other requests overlap). Reads over 2.5 s log one `slow_api` line with the route name only.

## Where the time goes (13 Nov 2026 findings)

See `docs/DECISIONS.md` (perf round). Short version: the host function and the database are both in `iad1` / us-east-1, the static page is served from the edge in 0.3 s, so the 20 to 30 s first open is the sign-in chain plus the
reads of the first screen, not the network. The first screen of a module costs 5 to 30 statements per read and the database is a small shared instance that also runs the sync and the hourly data checks.

## Budget and baseline (13 Nov 2026, before the stored-answer change, biggest real company, from a machine ~190 ms from the database)

"Statements" is what a module reads need when the cache is empty (the number to keep down). "All at once" is the wall time of the browser opening the module from here; divide by about 50 for the production order of magnitude when a read is round-trip bound. Reads that are execution bound (Pipeline: funnel, people, stage history) do not shrink that way.

| Module | Reads | Statements (cold, in a row) | All at once (cold, from here) | Slowest read (cold, from here) |
|---|---|---|---|---|
| Today | 20 | 213 | 36.2 s | today/growth 31.8 s (40,000 contacts read), exec-summary 16.3 s |
| Speed to lead | 4 | 46 | 29.3 s | race 16.7 s (always live, never stored) |
| Appointments | 24 | not finished | not finished | overview 12.5 s |
| Clients | 29 | 299 | 36.7 s | clients home 6.9 s, trends 5.4 s |
| Money | 9 | 49 | 2.7 s | payments options 2.4 s |
| Find a lead | 9 | 94 | 4.5 s | people/home 10.8 s and a 503 (the database stopped it for taking too long) |
| Account audit | 3 | 40 | 2.3 s | audit 5.0 s |
| Clean-up | 9 | 53 | 2.9 s | dq/overview 3.9 s |
| Team | 11 | 98 | 7.1 s | team 12.9 s |
| Pipeline | 17 | 148 | 29.9 s | pipeline3 people 20.1 s, stage-history 14.6 s, funnel 13.5 s (8 to 12 statements each: execution bound) |
| Meeting notes | 10 | 20 | 0.6 s | (401 here: needs a person session) |
| Workflows | 6 | 34 | 2.3 s | workflows 3.9 s |
| Settings | 2 | 6 | 1.0 s | api-keys 1.1 s |

After this round every first-screen read above (except the live race, exports and settings-like reads) is served from the stored answer after its first computation: 2 statements (the answer and the installation data-change time) instead of the numbers above. That could not be measured here without writing to the production answer table, so it is an expected figure, not a measured one.

## Still open (evidence, not yet changed)

- Pipeline funnel, people and stage history run 8 to 12 heavy statements (13 to 20 s) even with the rollup fresh: needs a query redesign on deal_history.
- people/home (Find a lead) hits the database statement timeout from here: the queue counts over 53,000 contacts.
- today/growth reads up to 40,000 contacts per call (0.7 s inside the database, then transfer and counting): move the counting into SQL.
- The database is the bottleneck: 737 MB on a 224 MB cache, shared with the sync (the deletes on cached_conversations and the dh_flags upserts used most database time in the week since 6 Nov). A larger compute size and running the hourly data-health job less often are King decisions.
