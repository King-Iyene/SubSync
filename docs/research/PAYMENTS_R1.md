# Payments module research (R1, 11 Nov 2026)

Labels: VERIFIED = official page fetched today; INFERENCE = reasoning; UNVERIFIED = third-party. Companion: CLIENTS_V2_R1.md (SaaS endpoints, errors, moat). Doc base https://marketplace.gohighlevel.com/docs/ghl/ .

## 1. Two kinds of money, two data paths

A. The agency's own SaaS subscriptions from its clients (the agency's recurring revenue).
- Data: `GET /saas/saas-locations/{companyId}` (agency token, `saas/company.read`) gives `subscriptionStatus` per account; `saas-plan` gives price and currency. VERIFIED.
- Missing: next charge date, failure reason, retry count, charged amount, card expiry. NOT in the API. So "upcoming charges" for SaaS can only be an ESTIMATE: plan price x active accounts, billing day unknown unless the account's subscription start is learned from our own first-seen date (INFERENCE, label it).
- Maybe: SaaS charges run through Stripe connected to a provider sub-account (`providerLocationId` on the plan, VERIFIED field). `GET /payments/subscriptions` and `/payments/transactions` on THAT location with a location token might list the agency's SaaS charges, with real statuses and dates. CHECK first (INFERENCE). If true, it unlocks failed SaaS charges, amounts, dates.

B. The clients' own customer payments (a client sells services, collects through invoices, order forms, subscriptions).
- `GET /payments/transactions` (`payments/transactions.readonly`): amount, currency, status, `amountRefunded`, `liveMode`, `subscriptionId`, `chargeId`, contact, `createdAt`, `fulfilledAt`; filters altId/altType=location, paymentMode, startAt/endAt, subscriptionId, contactId; limit/offset; no status filter. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/payments/list-transactions.md
- `GET /payments/subscriptions` (`payments/subscriptions.readonly`): contact, amount, currency, status, liveMode, entity source, subscriptionSnapshot (provider-side detail, may hold period end, CHECK), createdAt/updatedAt. No next-billing field documented. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/payments/list-subscriptions.md
- `GET /invoices/` (`invoices.readonly`, agency or location token): status draft | sent | payment_processing | paid | void | partially_paid, `amountDue`, `amountPaid`, `total`, `dueDate` (YYYY-MM-DD), issueDate; filters status, startAt/endAt, paymentMode; limit and offset required. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/invoices/list-invoices.md
- "Overdue" is not a status: derive it as status in (sent, partially_paid) and dueDate before today in the account's timezone. INFERENCE.
- Status values for transactions and subscriptions are undocumented ("succeeded" and "active" are the only examples). A failed payment is probably `failed` (INFERENCE): CHECK by reading real rows and counting distinct values before any "failed" tile ships.
- Auth: payments endpoints are sub-account level; we mint location tokens (we hold `oauth.write`). Cost: 1 to 3 calls per account per sweep; page with offset, use `startAt` for incremental runs.

## 2. Disputes, refunds

- Disputes and chargebacks: NOT in the API (no endpoint, no field). Refunds: only `amountRefunded` on a transaction (no refund endpoint documented). VERIFIED absence on the fetched pages; INFERENCE that the platform UI has them from Stripe.
- Consequence: a dispute tracker fed by real data is impossible today. Honest options: (1) manual log by the agency, labelled "entered by you", with due dates and a reminder (Stripe's evidence window is typically about 7 to 21 days, card-network dependent, UNVERIFIED: tell the user to read the due date from their processor email); (2) a read-only processor connection later (Stripe restricted key or Stripe App) as a separate decision with security cost. Recommend (1) now, flag (2) as PROPOSAL.

## 3. Webhooks (event names VERIFIED, https://marketplace.gohighlevel.com/docs/category/webhook)

- Money: InvoiceCreate, InvoiceUpdate, InvoiceSent, InvoicePaid, InvoicePartiallyPaid, InvoiceVoid, InvoiceDelete; OrderCreate, OrderStatusUpdate; Price*/Product* events.
- No named event for a failed transaction, subscription change, refund or dispute. INFERENCE: OrderStatusUpdate may carry failed payments (CHECK payload).
- App billing (our own subscription): AppPaymentStatus (failed or recovered recurring payment of a paid app), PlanChange, AppInstall/Uninstall/Update.
- SaaS: SaaSPlanCreate exists; no subscription-status event. So SaaS status needs the hourly poll and diff.
- Rule from CLAUDE.md: webhooks can be missed; polling plus diff is the truth, webhooks only speed it up.

## 4. Write actions (what could be one-click)

- Resend invoice: `POST /invoices/{invoiceId}/send` (`invoices.write`), body altId, altType=location, userId, action (sms_and_email | email | sms | send_manually), liveMode. VERIFIED. https://marketplace.gohighlevel.com/docs/ghl/invoices/send-invoice.md . This messages the client's customer. It conflicts with the standing rule "SubSync never replies for the agency" and the "never message leads" build rule: needs King's explicit decision. Default: not built; offer "copy reminder text" plus "Open in your CRM".
- Update-card link for a failed subscription: no endpoint found (UNVERIFIED). `PUT /saas/update-saas-subscription/{locationId}` is a queued subscription update (slug says generate-payment-link) but semantics unclear; needs `saas/company.write`. Do not build.
- Retry a failed charge: no endpoint found. Retry is a UI action at agency level (UNVERIFIED, consultevo). Deep link only.

## 5. Dunning practice and competitors (UNVERIFIED unless stated)

- Standard recovery: automatic retries over about 2 weeks (Stripe Smart Retries default is 8 tries in 2 weeks, UNVERIFIED), card-updater, a 3-to-5 email sequence, a pre-expiry card warning, grace period then pause or cancel.
- Churnkey about $250 per month and up; Baremetrics Recover $69 to $129 per month or 10% of recovered; Paddle/ProfitWell Retain about 15 to 25% of recovered. Source quality low (competitor blogs): https://www.flycode.com/blog/churnkey-alternatives-2026-payment-recovery-cancel-flows
- What they do that we cannot: retry cards, run emails. What nobody does for GHL agencies (INFERENCE): one cross-account list of failed and late money with who, how much, how long, next step, and proof of what was recovered.
- Platform natives: failed-payment workflows and invoice reminders per account (UNVERIFIED), suspend-on-failure setting. They fire; they do not show a ranked, historical, cross-account picture.
- Surcharge to "involuntary churn": common claim that 20 to 40% of subscription churn is failed payments (vendor claim, UNVERIFIED). Use only as interview question, never in the UI.

## 6. Errors to guard (see CLIENTS_V2_R1 section 6)

Test vs live rows (exclude `liveMode=false`), currency never summed across, undocumented status strings stored raw, "overdue" derived in the account timezone, double counting (a transaction and its invoice and its order describe one payment: count money from transactions only, use invoices for "owed", never add them), partial refunds net of `amountRefunded`, Stripe amounts possibly in minor units (CHECK).

## 7. Moat

Append-only `pm_events`: status transitions with timestamps (invoice sent to overdue to paid, transaction failed, subscription active to past_due to active). Yields time-to-recover, recovery rate by account, repeat late payers, seasonality, "money recovered after we flagged it" proof (receipt). The API shows only the current state; competitors that read Stripe have history for Stripe, not for GHL invoices and orders. Start recording on day one, label "history starts <date>".

## 8. Open checks for King or the builder (run once on a real agency token)

1. Does the SaaS provider location's `/payments/transactions` list the agency's own SaaS charges?
2. Distinct `status` strings returned by transactions, subscriptions and invoices on real data.
3. Does `subscriptionSnapshot` include current period end?
4. Are amounts major or minor units?
5. `GET /saas/saas-locations/{companyId}`: do non-SaaS accounts appear?
6. Do Private Integration vs OAuth agency tokens differ (we use OAuth).
