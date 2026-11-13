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

## Budget (statements, cold, biggest real company)

Keep these from growing; a change that adds statements to a first-screen read must say why.

| Module | Reads | Statements in a row (cold) | Notes |
|---|---|---|---|
| Today | 20 | 213 | exec summary 14, today 33, today3 today 29 |
