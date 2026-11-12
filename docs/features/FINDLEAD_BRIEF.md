# Find a lead: brief (flags fl_find, fl_bulk; default off)

Customer view: WHO: agency owner, account admin, setter. NEXT: find the person, open them, tag or note a group, export a list. If missing: "I have to open each client account to find one person."
Operating-principle check: (a) decision: who to call or fix next; (b) data is in `cached_contacts` (verified); (c) CRM does per-account only; (d) simplest: one box plus typed filters; (e) risks: scale, bulk writes, export (see R1).

## Built (this branch)
- `GET people/find` (fl_find): keyset page `after=<cursor>`; count only on the first page (exact to 10,000). Order: match rank, last activity, added, account, contact (all newest first). Cursor is a strict shape; the query is limited to the caller's installation and accounts.
- Typed pickers (SearchPick) for tag, without-tag, owner, source, stage, account (40 shown, "type to narrow").
- Shared Open button on every row (opens the lead panel); do-not-disturb shows its words and a reason; Call stays.
- `POST people/bulk` (fl_bulk): add a tag or a note to up to 50 ticked people; step preview then step do with confirm; goes through changeTag / saveContactNote (gateway: hourly cap, dry run, permission check, undo log, our writes excluded from numbers). Admin side only. NO bulk delete exists.
- `GET people/export` (fl_bulk): CSV, up to 5,000 rows, formula-safe, admin side only.
- Migration 20261213090000: one partial owner index (additive, no new tables).
- Already existed and reused: saved lists shared with the team, lead panel timeline, duplicates (own page), change owner (Team actions, preview and undo).

## Tests
`src/lib/__tests__/find-lead.test.ts` (cursor, bulk rules, CSV safety); `tests/unit/find-lead-db.test.ts` (keyset complete, no dupes, ties, tenant isolation, forged cursor; ran on in-memory Postgres); tenancy addresses appended to `scripts/check-tenancy.ts` (CI runs it).

## Not done (logged)
Change owner inside the bulk bar (use Team actions today); search live-timed at 1M+ rows; audit row for exports; Slack/email of lists.
