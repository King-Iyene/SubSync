# Clean-up (incl. Duplicates) R1 (11 Nov 2026)
Labels as in TODAY_R1.md. Builds on docs/CLEANUP_PARITY.md (12 tools), docs/features/CLEANUP.md, docs/features/DUPLICATES.md, docs/DUPLICATES_REVIEW.md, docs/research/DATA_QUALITY_COMPETITORS.md.

## What exists
cleanup.tsx, cleanup-hub.tsx, cleanup-parts.tsx, duplicates*.tsx (about 1,100 lines), src/lib/analytics/dedupe*.ts, cleanup-*.ts: one Clean-up entry with tabs Duplicates, Data quality, History, Rules; match score and reasons, configurable rules, survivorship preview, merge history. Writing is built but OFF until King flips one switch (docs/NEEDS_KING.md section 29). VERIFIED (read).
Thin: (1) nothing is live for the customer while writing is off, so the screen finds but cannot fix; (2) no scheduled "new duplicates this week" alert, which is what sells; (3) no import firewall linking to Data health's source ranking; (4) the typed-confirmation delete rule must be checked on every delete path.

## Platform
- No merge endpoint exists in the public contacts API (VERIFIED: docs/features/DUPLICATES.md, repo GoHighLevel/highlevel-api-docs apps/contacts.json). Only route: the customer's own "Merge Contact" workflow started by an API call. Merging is irreversible and admin-only in the app; bulk merge caps at about 10 contacts (INFERENCE: growthable.io tutorials). The "Potential Duplicate" filter exists in the app (INFERENCE: consultevo.com).
- GET /contacts/search/duplicate looks up one contact; it is not a scan (VERIFIED, DUPLICATES.md). We scan our own synced copy.
- "Allow Duplicate Contact" account setting governs creation (gohighlevelassist.freshdesk.com article 48001181714). CSV import auto-merges on phone or email, forms and Zapier can still create duplicates (INFERENCE, same article).
- NOT available: unsubscribed state, active payments, active workflows per contact (never guessed; protected-contact rule uses what we have: DND, open deals, upcoming appointments).

## Competitors
| Tool | Note | Price (label) |
|---|---|---|
| Cloudingo, DemandTools, DataGroomr, Plauti | Salesforce-side dedupe; scheduling, import dedupe, learn from past merges | about $132 per seat per year to $10k+ per year (INFERENCE, DATA_QUALITY_COMPETITORS.md) |
| Native app filter and merge | Per account, manual, no history, irreversible | included |
| Consultants | One-off cleanups | INFERENCE |
None found that keeps a history, ranks accounts by dirt, alerts on a bad import by source, or proves the result to a client (DATA_QUALITY_COMPETITORS.md).

## Customer pain (INFERENCE: consultevo.com, socinova.com, kixie.com/sales-blog)
1. The same person gets two or three calls and texts because workflows create a new contact each time.
2. Duplicates distort speed-to-lead and ownership, so reports cannot be trusted ("bad timestamps and ownership").
3. Fear: a merge cannot be undone and might cross clients.

## Biggest sources of error
- Merging two different people (shared family phone or email): never auto-merge on phone alone; show reasons and score.
- Merging across accounts: guard every location id with the shared tenant guard.
- Deleting a contact with a live deal, payment or appointment: protected, typed confirmation naming the item.
- Counting groups vs contacts inconsistently: count must equal rows on screen (King rule).
- Our own write echoing back as activity (rule 14).

## Moat
Merge and fix history per account (what, when, who approved, undo window) is ours alone: "last quarter we removed 412 duplicates for you". Per-source duplicate rate over time identifies the bad form or import. Cross-agency benchmark of duplicate rate only with k of 10 accounts and 3 agencies (docs/MOAT.md).

## What would make an owner pay
Sold as "cleaning keeps your numbers honest and stops double-texting": weekly "new duplicates found" alert, one-tap safe merge through the customer's own merge workflow, a before/after receipt. Money case: fewer double sends (carrier and consent risk) and trustworthy reports.

## Customer's-eye check
Pays? Yes if one click fixes the 20 obvious pairs with an undo note and it never touches the unsure ones. Confusing: "survivorship", "match score". Say "Keep this one. Which details to keep". Merge into one entry, Duplicates is a tab (done); finish by making Data health the tab "Health".
