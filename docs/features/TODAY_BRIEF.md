# Today (front page) build: one integrated builder brief

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (King's rules, tenant guard `ownedLocation` on every id parameter, additive migrations NOT applied by builders and free of drop/truncate/delete words outside comments and 'on delete cascade', never run check-tenancy, never push to main, named git adds, real output of `npx tsc --noEmit`, short report under 200 words, flags default off in code and switched ON after the tenancy check). Read: docs/research/TODAY_R1.md, OVERVIEW_R1.md, docs/TODAY_REVIEW.md, docs/features/TODAY.md, src/app/app/views/today*.tsx, src/lib/analytics/today-*.ts, how views/cl3 and views/pl3 were built.

Goal: the daily "What to do today" page and the proof an agency shows its clients, so customers return every day. Money first (retention and the 7 am email), customer second, innovation third. Overview is folded in (see REMAINING_MODULES_ORDER.md).

## Evaluation (principle 1)
(a) Decision: the agency owner (all accounts), a client admin (own account) and a setter (own queue) decide what to do first today; next they press ONE button that opens exact rows. Missing, they say "I still open six screens to know where to start". (b) Data: counts already exist per finished module (Speed unanswered and breaches, Appointments unmarked and no-shows, Pipeline stale deals, Clients needing attention, Workflows failing, Data health). Read each module's rollup, never recompute (test it). History of "fixed" comes from our event store. (c) Native/competitor: none ranks across accounts or keeps proof (TODAY_R1.md). (d) Simplest version: a ranked list of at most 5 items with a count and one big button. (e) Risk: a number that disagrees with its source module; a "fixed" claim not proven; wrong time zone; leaking another account's count.

## Sub-sections (tabs): Today | Proof | Numbers | Settings (daily email time, quiet days)
1. **Today:** sentence ("14 people are waiting and 9 appointments have no outcome"), ONE button "Start with the 14 people", ranked list max 5 (each reason = count that opens its rows plus Open in your CRM), "Done today" ledger, calm all-clear state ("Nothing needs you. 3 things fixed since yesterday"). Account users see only their account and queue. Rank = estimated money at risk first, then age; show why each is ranked. Money figures carry "Estimate".
2. **Proof:** weekly receipt: found, fixed, still open, median time to fix, per account and for the agency; copy for client, print, CSV through a tenant-guarded route; "history starts <date>". Reuse proof-view.ts, weekly-email.ts.
3. **Numbers:** replaces Overview. At most 6 tiles from module rollups, trends from account_metrics_daily, minimum-data rules, each tile opens its rows. #overview redirects here. Old tabs Growth, Lead flow, Coming and going, Forecast, Sources, Coverage move under "More numbers" with plain names; do not delete code.
4. **Daily email** at the account's local 7 am (one per person): the same ranked list, one button; unsubscribe link; never sends to leads.

## Data and what is NOT available
Real synced data only. Not available: logins, ad spend, collected revenue. State it where a missing number would sit ("Needs permission: reconnect" or "Not available from the platform yet").

## Moat
New tables: `td_daily_items` (account, day, item kind, opened count, resolved count, first seen, resolved at), `td_receipts` (week, found, fixed, median fix minutes). Append-only, idempotent on (account, day, kind). Record before screens: ship the recording in the first commit.

## Scale and design
SQL aggregates only, keyset paging, first screen under 2 s at 1M+ leads; read rollups, not scans. Calm, max 3 colours, no glow, tabular numbers, light and dark, 1440/768/390, labels never overlap, loading/empty/error states. Frontend-design skill for the UI.

## Customer's-eye check (required before done)
Walk as agency owner with 20 accounts, client admin and setter. Questions: does the first screen say what to do in 5 seconds; do all counts equal their rows; is anything shown twice; would they forward the receipt to a client. Record answers in docs/TODAY_REVIEW.md.

## Setup
One builder. Worktree `git fetch origin && git worktree add C:\Users\KING\wt\TD -b stage/td origin/main`; junction node_modules, copy .env.local; port 3641. Flags: `td_today`, `td_proof`, `td_numbers`, `td_email`. Migrations from 20261204090000 (`20261204090000_td_daily_items.sql`, `20261204100000_td_receipts.sql`). Tests: tenant cross-read (xtest- prefix, cleaned up), counts-equal-rows against each source module, time-zone day boundaries, rank order, redirect.

## Extras to build and list in the report
Per-person "my queue" button for setters; "snooze this item 1 day" (SubSync-only, logged); streak-free calm note "last problem fixed 2 h ago"; copy-as-text of the receipt.

## Done when
Flags ON in the live app, verified in a real browser with real roles, why-would-I-pay pass written, FEATURE_STATUS.md and METRICS.md updated.
