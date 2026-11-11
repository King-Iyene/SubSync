# Peer benchmarks: privacy and legal note (draft, 10 Nov 2026)

**A lawyer must review this before benchmarking is switched on for anyone. This is an engineering note, not legal advice.**

## What the feature does
Opt-in per agency. An agency that switches it on lets its client accounts count toward an anonymous comparison and lets it see the comparison. What leaves the database is only counts and three numbers (median, 25th and 75th percentile) of per-account median reply time, per kind of business. No names, no account or agency ids, no rows, no drilldown. Message text and contact identity are never used: only reply-time statistics.

## Safeguards built in (code, with tests)
- Off by default; a per-agency switch (`settings.benchmark_opt_in`), recorded in the audit log. Give to get: an agency that is off sees nothing.
- One function combines data across agencies (`src/lib/analytics/benchmarks-audited.ts`). A test fails if any other file does. Each call writes an audit line (counts bucketed, never the cell numbers).
- Shown only with at least 10 accounts from at least 5 agencies in a kind-of-business cell, and suppressed when one agency supplies over 40% of them. The message is the same for every failure ("Not enough accounts yet") so it does not leak which rule failed or how many accounts exist.
- Accounts need at least 30 answered leads in 90 days to count. Demo, ignored and uninstalled accounts are excluded.
- Uninstall removes the agency's rows and its opt-in; the next calculation no longer includes it.

## Questions for the lawyer
1. Is reply-time data about an account's leads "aggregate" or "de-identified" under CCPA/CPRA and "anonymous" under GDPR Recital 26 at these cell sizes, or does it need a stronger threshold?
2. Does the agency's data processing agreement need a clause naming benchmarking as a disclosed purpose, and does the end business (the client account) need to be told or to consent?
3. Opt-in per agency versus per client account: is the agency's consent enough where the client account is the data owner?
4. Any rule for businesses in the EU, the UK or Nigeria (NDPA) that changes the threshold or needs a transfer clause?
5. Wording of the switch label and of the privacy page line.

## Not done on purpose
No benchmark of individual people (setters) across agencies. No export. No benchmark below the cell minimums.
