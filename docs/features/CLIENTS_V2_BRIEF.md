# Clients v2 build: shared builder brief (read fully, then your slice)

Rules: docs/features/CLIENTS_BRIEF.md applies in full (it points to APPOINTMENTS_BRIEF, PIPELINE_BRIEF, UNANSWERED3_BRIEF): King's rules, safety, white-label, flags default off in code and switched ON after the tenancy check, additive migrations NOT applied by builders (no drop/truncate/delete words outside comments and 'on delete cascade'), never run check-tenancy, never push to main, named git adds, read the REAL output of `npx tsc --noEmit`, short report under 200 words. Money first, the customer second, innovation third. REAL GHL data only; anything history-based says "history starts <date>". Every number opens its rows. Calm, simple, max 3 colours, light and dark, 1440/768/390. Tenant guard (`ownedLocation`) on every parameter, cross-tenant DB tests with xtest- prefix. Scale: 1M+ rows, keyset paging, first screen under 2 s.
Read first: docs/research/CLIENTS_V2_R1.md, PAYMENTS_R1.md, CLIENTS_R1/R2, src/lib/analytics/clients3-billing.ts, src/app/app/views/cl3/*, views/clients/*, and the Team (People) module files (docs/features/PEOPLE_BRIEF.md).
Pairs with docs/features/PAYMENTS_BRIEF.md: Clients owns the ACCOUNT (plan, status, health, notes); Payments owns the MONEY (failed, late, owed). They share the account's money status through one function; never duplicate a query.

## 1. What King found (customer view, two lines per fix)

1. "Plan and subscription" only says "Needs permission: reconnect". Who: agency owner. They need: which plan each client is on and whether it is paid up; without it they open the CRM per client. Cause: our call omits `companyId`, uses an outdated version header and an unverified scope name (R1 section 1). Fix it first: it is a bug before it is a feature.
2. Plain words for "plan": "Your plan for this client" = the plan YOU sell them in your CRM (SaaS plan), shown as title, price per month, billing status. Never the word "SaaS" alone; say "paid plan you sell".
3. Rows only link out to the CRM. Every client row, card and count opens an in-app account page.
4. Per-account people and quiet members belong in Team, not Clients.

## 2. Names (white-label rule, CLAUDE.md)

UI says "client account(s)" or "Accounts". Never "sub-account", "location", "agency view", "SaaS Configurator", "GoHighLevel/GHL". Plain labels: "Paid plan" (not SaaS plan), "Payment status", "Credit balance" (wallet), "Past due". Add the existing UI-string scan test coverage for the new files. Menu label stays "Clients".

## 3. What moves to Team

Move (UI only, keep code and data): "People per account", quiet or idle members, who works in which account, per-account staff activity. Clients keeps one count per account ("3 people, 1 quiet") that links to Team filtered to that account. Team gets an "Account" filter and a column "Accounts they work in". Slice CVU does the move with redirects from the old Clients tab so bookmarks work. No data duplication.

## 4. Information architecture (calm, six screens)

Clients: Today | Accounts | Needs attention | Trends | Compare | Reports. Billing becomes columns and a filter on Accounts, not a separate tab. Setup health folds into the account page ("Connection" card) and a banner on Today.
- Today: one plain sentence and one button ("3 clients are past due: review"), then 4 tiles max (Past due, Needs attention, New this month, Quiet 14 days), each opens its rows.
- Accounts: table (search, sort, filter by Paid plan, Payment status, Health, Industry; saved views), columns: Name, Paid plan, Payment status, Credit balance, Last activity, Health, Open in SubSync (primary), Open in your CRM (secondary). Keyset paging; bulk select.

## 5. Account page (new, opens from every row, deep link `?account=<id>` through the guard)

Header: name, status pill (Active, Past due, Paused, Cancelled, Not on a paid plan), Open in your CRM.
Cards (each shows "Not available from the platform yet" or "Needs permission: reconnect" with the exact reason, never blur):
1. Paid plan: title, price and currency per interval, trial days, plan limits (users, contacts), status, since (our first-seen date, "history starts"), source `saas-locations` / `saas-plan`.
2. Payment status and history: current status, days in this status (from `pm_events`), past-due count, last status change, timeline (history moat), link "Open in Payments" with this account filtered.
3. Credit balance (wallet): balance, complimentary credits, 30-day trend from our snapshots, "low" flag below a threshold the agency sets (default none). Needs `wallet.readonly`.
4. Usage and limits: contacts versus plan contact limit, users versus user limit (our own counts). Real numbers only.
5. Installed apps: NOT available from the platform (R1 section 3). Show that sentence, not an empty card; offer "Notes" as a manual checklist instead (no invented data).
6. Last activity: last inbound, last outbound by a user, last appointment, last sync (from our tables). "Quiet N days" rule: no user outbound and no new contact for N days (N set per agency, default 14).
7. Health: reuse existing health (outcome-based). One line why. No new score.
8. Notes and tasks: private to the agency (SubSync-only table `cl_account_notes`, author, time, pinned, type: note | promise | renewal date). Typed confirmation to delete; edit shows preview.
9. People: count only, links to Team.
10. Connection: scopes granted, last sync, reconnect guidance.

## 6. Failed-subscription handling

- Detect: each hourly sweep reads `GET /saas/saas-locations/{companyId}` (all pages) and diffs `subscriptionStatus` against `client_billing`; a change writes `pm_events` and flips the account's payment status. Statuses stored raw; mapped: active/trialing = Paid up; past_due/unpaid/incomplete = Past due; canceled/incomplete_expired = Cancelled; paused = Paused; unknown = "Other: <raw>" (logged).
- Show: Past due list on Today and Accounts with days in status, plan price (money at risk = monthly price, labelled "estimate: plan price per month"), and the plain next steps card: "1 Check the card in your payment dashboard, 2 Ask the client to update it, 3 We will tell you when it is paid." Buttons: Open in your CRM (agency billing page deep link via the white-label helper), Copy message to client (editable text, SubSync sends nothing), Snooze 3 days, Mark "client contacted" (note).
- Alert: daily brief and in-app when an account becomes Past due and when it recovers. Dedupe, quiet hours.
- No automatic pause, cancel, retry or plan change. SubSync cannot retry cards and must not change what the agency bills (R1 section 2).
- Offboarding guard (ideas-board gap): a Cancelled account that still has our data or workflows is listed "Cancelled, still active elsewhere" only if we can see it (CHECK).

## 7. Bulk actions (SubSync-only unless stated)

Select rows then: Add note, Set quiet-days rule, Snooze alerts, Export CSV (tenant-guarded route, formula-injection safe), Add to a saved group, Copy messages for all selected past-due clients (one per client). Anything touching the CRM goes through the gateway with preview, confirm, audit log, undo, cap; none expected in v2.

## 8. Proof

Weekly receipt per client gains one line: "Paid plan: active since <date>" and, when relevant, "Payment problem fixed on <date>" from `pm_events`. Agency-level proof: "We flagged N past-due clients, M recovered, $X per month back" (history starts <date>), shown on Today and in the daily brief.

## 9. Data, migrations, flags

- Additive migrations from 20261206090000 (shared numbering with Payments; Clients v2 takes 20261206090000 and 20261206100000, Payments starts 20261206110000): `alter table client_billing add column ...` (company_id, subscription_id, customer_id, price_id, price_amount numeric, price_currency, billing_interval, trial_days, plan_title, status_raw, status_since timestamptz, wallet_balance numeric, wallet_credits numeric, http_status int, reason text); `cl_account_notes`; `cl_wallet_snapshots (installation_id, location_id, day, balance)`. All with RLS on, revoke from anon, authenticated; added to tenant-tables.ts and the check-tenancy read addresses (CD does not run it).
- Replace `refreshClientBilling` internals: one paged bulk call, plan cache per run, `companyId` query, `Version: v3`, store HTTP status and reason so the UI says exactly why ("SaaS mode off", "Reconnect", "Plan not found"). Wallet: `GET /wallet/balance?locationId=` per account, 120 ms pacing, skipped when scope missing.
- Flags (default off in code, ON after tenancy): `cl_account_page`, `cl_billing_v2`, `cl_wallet`, `cl_notes`, `cl_team_move`. METRICS.md: Past due, Quiet N days, Money at risk (estimate) definitions with unit tests; fixtures cover currency mixes, unknown status, accounts with no plan.

## 10. Builder slices (three worktrees, own branch each, from origin/main, junction node_modules, copy .env.local, own port)

- CVD (branch stage/cv-data, port 3641): migrations, sweep rewrite, `/api/app/clients3?part=account|billing|notes|wallet`, guard, tests, METRICS. First commit and push types `clients3-types.ts` additions.
- CVU (branch stage/cv-ui, port 3642): Accounts table, account page, Today, Team move, empty/loading/error states, "Sample data" fixtures until CVD lands, rename pass and string-scan test.
- CVB (branch stage/cv-actions, port 3643): failed-subscription card, copy message, snooze, notes CRUD with typed delete, bulk actions, CSV, receipt lines, daily-brief item.
Do not edit outside the clients area except flag lists, router wiring, tests and docs.

## 11. Extras to include (list in your report)

Account page "Copy a summary for a client call"; search by client email; a "Why 'Needs permission'?" explainer with the exact scope names in plain words; "Not on a paid plan from you" bucket for accounts missing from the bulk list.

## 12. Why would I pay? (reviewer pass, answer before merge)

Can an agency owner see in 10 seconds which clients owe money and for how long? Can they open any client without leaving SubSync? Is every sentence true and every number traceable to a real row? Anything that is a guess must say "estimate" and show its formula.

## 13. Optional scopes

See PAYMENTS_BRIEF section 9: Clients v2 needs `saas/company.read` (already ticked), `wallet.readonly`. Remove `saas/location.read` from `scopes.ts` and SCOPES.md only after the live check shows it is unused (INFERENCE it is not an official scope; changing the list forces a version bump, batch with the payments scopes in one release).
