# Clean-up (including Duplicates) build: one integrated builder brief

Rules: docs/features/CLIENTS_BRIEF.md and the briefs it points to apply in full (list in TODAY_BRIEF.md first paragraph). Read: docs/research/CLEANUP_R1.md, docs/CLEANUP_PARITY.md, docs/features/CLEANUP.md, DUPLICATES.md, docs/DUPLICATES_REVIEW.md, docs/NEEDS_KING.md section 29, src/app/app/views/cleanup*.tsx, duplicates*.tsx, src/lib/analytics/dedupe*.ts, cleanup-*.ts.

Goal: keep an account's contacts honest and stop double-texting. Duplicates stay a tab of this one entry. The matching and survivorship logic is built; do not rewrite it.

## Evaluation (principle 1)
(a) Decision: owner and client admin decide which pairs to merge and which source creates duplicates; next they approve a safe merge or fix the source form. Missing: "my reps text the same person twice". (b) Data: our synced contacts; NO platform merge endpoint (VERIFIED, DUPLICATES.md): the only legitimate merge is the customer's own "Merge Contact" workflow started by an API call, behind King's switch (NEEDS_KING.md 29). NOT available: unsubscribed state, active payments, active workflows per contact. (c) Native does manual per-account merge, irreversible; none keeps history or alerts (CLEANUP_R1.md). (d) Simplest: weekly "new duplicates found" with a safe-merge list. (e) Risk: merging two people, crossing accounts, deleting protected contacts.

## Slices (inside one builder, in order)
1. **Recording first:** append-only `cu_scans` (account, scan day, groups found, contacts in groups, new since last scan, top sources) written by the hourly sweep, idempotent per (account, day); ids and counts only, no names.
2. **Weekly alert and receipt:** "23 new duplicates this week, 17 are obvious" through the alert engine and the Today receipt; per-account mute.
3. **Obvious vs unsure:** tiers by rule score; only the obvious tier gets "Merge all 17" (preview, reasons visible, undo note); unsure pairs go to a person one by one. Never auto-merge on phone alone.
4. **Source finder:** which form, import or workflow creates the duplicates (join Data health source ranking); the fix is a link and plain advice, not a write.
5. **Make it live where lawful:** once King flips the write switch, run the first real merge on a test location and record it; until then the screen says "Needs permission: reconnect" or "Not available from the platform yet" exactly, and the merge button stays disabled (rule 6 of CLAUDE.md: say so in the same message with the return condition).
6. **Health tab:** absorb Data health as the tab "Health" (see DATA_HEALTH_BRIEF.md) in nav only; its code stays.
7. **Protected contacts:** DND, open deals, upcoming appointments never deleted or bulk-merged without an extra step; every delete needs a typed confirmation naming the contact or the count; edits show a preview; our own writes tagged and excluded from metrics (rule 14).

## Scale and tenancy
SQL aggregates with blocking keys (normalised email, last 9 digits of phone, name+postcode) not pairwise scans; keyset paging; 1M+ contacts per agency in under 2 s for the first screen using the rollup; count equals rows (group count and contact count are labelled differently); tenant guard on every location id; cross-tenant DB test for scan and merge.

## Customer's-eye check (required)
Owner with 20 accounts: "Is it safe? Can I undo?" Words: "Keep this one. Which details to keep" instead of survivorship. Would they pay for it alone? Weakly; as the sweeper plus receipt, yes. Record in docs/DUPLICATES_REVIEW.md.

## Setup
Worktree C:\Users\KING\wt\CU, branch stage/cu, port 3644. Flags `cu_alerts`, `cu_tiers`, `cu_sources`. Migrations from 20261207090000 (`20261207090000_cu_scans.sql`). Tests: tier rules, no phone-only auto-merge, protected contacts, xtest- tenant cross-read, scale test at 1M rows (skip if no DB).

## Extras to list
"Merge all obvious" with count equal to rows; copy a client-ready "we cleaned N" line; export CSV of what changed.

## Done when
Flags ON, verified with real roles in a browser, why-would-I-pay pass written. Writing status stated honestly.
