# Payments module build: shared builder brief (read fully, then your slice)

Rules: docs/features/CLIENTS_BRIEF.md and CLIENTS_V2_BRIEF.md apply in full (King's rules, safety, white-label, flags default off in code and ON after the tenancy check, additive migrations NOT applied by builders and no drop/truncate/delete words outside comments and 'on delete cascade', never run check-tenancy, never push to main, named git adds, real `npx tsc --noEmit` output, report under 200 words). Money first. REAL data only; history says "history starts <date>". Every number and card opens exactly its rows with "Open in your CRM". Calm, max 3 colours, light and dark, Speed to lead design standard (control room, clickable counts, millions of rows). Tenant guard on every parameter, cross-tenant DB tests (xtest-). Never reply to or message anyone for the agency; all CRM writes through the gateway; delete needs a typed confirmation naming the item; edits show a preview.
Read first: docs/research/PAYMENTS_R1.md and CLIENTS_V2_R1.md. Menu label "Payments". Words: "client account", "Past due", "Late invoice", "Failed payment", "Refund", "Payment dispute". Never "sub-account", "SaaS", "GHL".

## 1. Customer view

Who: agency owner (their clients' paid plans AND their clients' customer payments across accounts), client admin (own account only), setters see nothing. They do next: chase the right person today. If missing, they say: "I only find out a client stopped paying when the cash does not arrive."

## 2. Two sections, one list (all filters recompute everything)

- Section A "Your clients' plans" (money the agency earns): per client account paid-plan status from `saas-locations`. Real: status, plan, price, currency, days in status. Not available: next charge date, failure reason (say so).
- Section B "Your clients' customers" (money clients earn): per account, from transactions, subscriptions, invoices.
Today: sentence plus one button ("4 payments need action: review"), tiles max 5: Failed, Late invoices, Past-due plans, Open disputes (manual), Refunds (30 days). Each opens its rows.

## 3. Recovery queue (the main screen)

One ranked list of items needing action: failed payments (transactions with a failed status, after CHECK of real strings), past-due client plans, late invoices (sent or partially_paid, dueDate passed in the account timezone), failed subscription payments (subscription not active). Row: account, who (contact name and email), amount and currency, age (days), reason in plain words, next step, priority. Rank: amount x age bucket, per currency (never summed across currencies; separate totals). Side panel opens in-app: full timeline for that item from `pm_events`, contact link, Open in your CRM (white-label helper), Copy reminder message (editable template, plain, no threat, SubSync sends nothing), Mark "contacted" (note), Snooze, Dismiss with reason.
Filters: account, status, currency, age bucket, amount range, live mode (test rows excluded, shown only behind a "show test payments" switch), date. Saved views.

## 4. Dispute tracker (manual, honest)

The API has no disputes (R1 section 2). Build a "Payment disputes" log the user fills: account, customer, amount, currency, reason, opened date, evidence due date, status (open, evidence sent, won, lost), link to the processor page, notes. Labelled "Entered by you; not read from your payment processor." Due-date alerts (3 days, 1 day, day of; in-app and daily brief), overdue shown red. Table `pm_disputes`. Edit shows a preview; delete asks for typed confirmation. PROPOSAL (needs King): later read disputes through a restricted processor key or app; cost: a stored financial credential, security review.

## 5. Upcoming charges (estimates only)

- Client plans: plan price x active accounts per interval = "Expected from your clients: about X per month (estimate: plan price x active accounts; billing days not provided by the platform)". If R1 check 1 proves the provider location lists SaaS charges, show real dates and amounts instead and drop the "estimate".
- Customers: subscriptions' next date only if `subscriptionSnapshot` carries a period end (CHECK), else show "Not available from the platform yet".

## 6. Revenue at risk (labelled estimate)

Past-due plan price + failed payment amounts + late invoice `amountDue`, per currency, each with its formula one tap away. Never one headline number across currencies; never double count an invoice and its transaction (money tiles use transactions for collected and failed, invoices for owed only).

## 7. One-click actions through the gateway

Decision for King (CLAUDE.md rule 7: SubSync never replies for the agency): the API does support "Send invoice" (`POST /invoices/{id}/send`, `invoices.write`, VERIFIED) but it messages the client's customer. Build it FLAG-OFF `pm_resend_invoice`, only after King approves: preview of recipient, channel and invoice, typed confirm, cap 20 per day per account, 24 h dedupe per invoice, audit log, excluded from our own reply metrics (rule 14), never to DND or unsubscribed contacts (rule 8). Update-card link and retry charge: NOT supported by the API (nothing found): do not build; "Open in your CRM" and "Copy message" instead. Default ON features are read-only.

## 8. History moat

`pm_events` append-only (installation_id, location_id, kind, item_id, from_status, to_status, amount, currency, occurred_at, observed_at, raw jsonb), idempotent key (installation_id, kind, item_id, to_status, occurred_at). Written by the sweep diff, and by webhooks (InvoicePaid, InvoiceSent, InvoiceVoid, OrderStatusUpdate, AppPaymentStatus, PlanChange) which only speed it up. Report: average days to recover, recovery rate, repeat late payers, "recovered after flagged" for the weekly receipt. First screen of each chart says "history starts <date>".

## 9. Scopes King must enable (all OPTIONAL; names INFERENCE where marked; portal: Developer Marketplace, app SubSync, Advanced Settings > Auth > Scopes)

| Scope | Why | Status |
|---|---|---|
| `saas/company.read` | client paid-plan status, plan prices (already ticked) | VERIFIED name |
| `wallet.readonly` | credit balance per account | VERIFIED name |
| `payments/transactions.readonly` | failed payments, refunds, collected | VERIFIED name |
| `payments/subscriptions.readonly` | customer subscriptions status | VERIFIED name |
| `invoices.readonly` | late and open invoices | VERIFIED name |
| `marketplace-installer-details.readonly` | reconcile our own plan and billing (SCOPES.md "planned") | VERIFIED name in CLAUDE.md; INFERENCE still needed |
| `invoices.write` | resend invoice, ONLY if King approves section 7; leave off otherwise | VERIFIED name |
Not requested: `saas/company.write` (changes what the agency bills), `payments/orders` (not needed). Remove `saas/location.read` after the live check (INFERENCE: not an official scope). This is one release: bump to a minor GHL version (Clone as Draft, add scopes, release notes "Adds payment and credit visibility, read only"), existing installs see Update. Until a scope is granted the screen says "Needs permission: reconnect" and names the plain reason; each section degrades alone.

## 10. Data, migrations, flags

Additive from 20261206110000 (Clients v2 uses 20261206090000 and 20261206100000): `pm_items` (current state of each failed payment, late invoice, subscription: key, account, kind, status_raw, status_mapped, amount, currency, due_date, contact_id, first_seen, last_seen, resolved_at, live_mode), `pm_events`, `pm_disputes`, `pm_notes` (contacted, snooze, dismiss), `pm_sync_state` (cursor per account and resource, last ok, last http status), `pm_rollup_daily` (per account, day, currency, failed_count/amount, late_count/amount, recovered_count/amount). RLS on, revoke anon and authenticated, tenant-tables.ts and check-tenancy read addresses updated (by King's gate, not the builder).
Sweep: incremental by `startAt` with a 7-day overlap, offset paging, 120 ms pacing, per-account cursor, resumable; test rows dropped at ingest only when `liveMode=false`; unknown statuses stored raw and logged; amounts stored as received plus `unit_check` flag until CHECK 4 (minor vs major units) is settled, and the UI hides money until it is.
Flags: `pm_module`, `pm_recovery`, `pm_disputes`, `pm_upcoming`, `pm_resend_invoice` (stays off pending King). METRICS.md: Failed payment, Late invoice, Past-due plan, Revenue at risk, Recovered, Days to recover, each with unit tests and fixtures (mixed currency, test mode, partial refund, invoice plus transaction duplicate, timezone edge at midnight, unknown status).

## 11. Builder slices (three worktrees from origin/main, own branch, junction node_modules, copy .env.local, local turbopack root skip-worktree)

- PMD (branch stage/pm-data, port 3651): migrations, sweep and diff, `pm_events`, `/api/app/payments?part=...`, guard, tests, METRICS, a one-off script that prints distinct status strings and unit scale from a real agency (output to King, CHECK 2 and 4). First commit: `src/lib/analytics/payments-types.ts`.
- PMU (branch stage/pm-ui, port 3652): Today, Recovery queue with side panel, tiles, filters and saved views, Upcoming, Disputes UI against typed fixtures marked "Sample data", empty/loading/error states, 1440/768/390.
- PMB (branch stage/pm-actions, port 3653): notes, snooze, contacted, dismiss, copy-message templates, disputes CRUD with typed delete, due-date alerts into the alert engine and daily brief, CSV, weekly receipt lines, flag-off resend invoice behind preview and typed confirm.
Do not edit outside the payments area except flag lists, router wiring, scopes list in one PR with docs, tests and docs.

## 12. Extras to include (list in your report)

"Why is this failing?" plain-words column from the status; client-ready reminder text in three tones; per-currency totals strip; "Not available from the platform yet" labels with the exact missing field; a "Check your payment setup" card when the account has SaaS mode off or only test-mode rows.

## 13. Why would I pay? (reviewer pass)

Does it tell the owner today who has not paid, how much, for how long, what to do, and prove what was recovered? Is each number a real row? Is nothing promised that is not live? If the disputes screen feels thin, say so honestly rather than inventing data.
