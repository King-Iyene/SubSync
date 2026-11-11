# Clients v2 research (R1, 11 Nov 2026): managing client accounts, SaaS plan, billing status

Labels: VERIFIED = read on the official page (fetched today); INFERENCE = my reasoning; UNVERIFIED = third-party or secondhand. Doc base: https://marketplace.gohighlevel.com/docs/ghl/ . Everything marked CHECK must be tried on a live agency token before building.

## 1. Why the Billing block says "Needs permission: reconnect" (our own bug, likely)

Our sweep (`src/lib/analytics/clients3-billing.ts`) calls `/saas/get-saas-subscription/{id}` with no `companyId` and `Version: 2021-07-28`, then `/saas/saas-plan/{id}` with no `companyId`.
- VERIFIED: the current endpoint is `GET /saas/get-saas-subscription/{locationId}?companyId=...`, header `Version: v3`, scope `saas/company.read`, agency token only (OAuth or Private Integration Token). https://marketplace.gohighlevel.com/docs/ghl/saas-api/get-location-subscription.md
- VERIFIED: `GET /saas/saas-plan/{planId}?companyId=...` also needs `companyId`, scope `saas/company.read`. https://marketplace.gohighlevel.com/docs/ghl/saas-api/get-saas-plan.md
- We list `saas/location.read` as the scope. I found no official page that uses that name (INFERENCE: wrong or obsolete). The official scope is `saas/company.read`, already in our list.
- A 401/403/422 on a missing query parameter is shown to King as "Needs permission". Fix: pass `companyId`, use the bulk list below, and show the real HTTP reason ("Plan data needs SaaS mode switched on in your CRM" versus "Reconnect to grant permission").

## 2. What the SaaS API returns (VERIFIED unless noted)

| Need | Endpoint | Scope / token | Returns |
|---|---|---|---|
| All accounts on SaaS plans, one paged call | `GET /saas/saas-locations/{companyId}?page=` | `saas/company.read`, agency | per account: locationId, name, email, subscriptionId, customerId, saasMode, isSaaSV2, `subscriptionInfo{priceId, saasPlanId, stripeProductId, subscriptionStatus}`; pagination (page, limit, total, hasNext) |
| One account's subscription | `GET /saas/get-saas-subscription/{locationId}?companyId=` | same | locationId, saasPlanId, subscriptionId, customerId, productId, priceId, `subscriptionStatus` (example `active`). NO dates, NO amount, NO failure reason |
| Plan detail | `GET /saas/saas-plan/{planId}?companyId=` | same | title, description, planLevel 0-4, trialPeriod days, setupFee, userLimit, contactLimit, `prices[]` (amount, currency, billingInterval month/year), features, addOns |
| Plan list | `GET /saas/agency-plans/{companyId}` ("Get Agency Plans", path INFERENCE) | same | all plans |
| Wallet balance | `GET /wallet/balance?locationId=` | `wallet.readonly`; agency or location token | `balance`, `complimentaryCredits` (location reads only). Agency token plus `locationId` reads any of its accounts. https://marketplace.gohighlevel.com/docs/ghl/wallet/get-wallet-balance.md |
| Wallet transactions | Wallet API (the SaaS-API copies are marked deprecated, moved to Wallet API) | `wallet.readonly` | paged usage lines (CHECK shape) https://marketplace.gohighlevel.com/docs/ghl/saas-api/saa-s |
| Pause / enable / disable / rebilling / update subscription | `pause-location`, `bulk-enable-saas`, `bulk-disable-saas`, `update-rebilling`, `PUT /saas/update-saas-subscription/{locationId}` (queued, body subscriptionId, customerId, companyId) | `saas/company.write` | write actions. NOT recommended: they change what the agency bills. Skip in v2 |

Rate limit: a help article says "global rate limit of 10 requests per second" for these endpoints (UNVERIFIED, Freshdesk: https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000005768-public-api-endpoints-for-saas-configurator). Our ghlFetch queue already paces calls; the bulk list makes it one call per 100 accounts instead of two per account.

## 3. NOT available (searched, nothing found)

- Next billing date, failed-payment reason, retry count, amount actually charged, card expiry for a SaaS subscription: not in `saas/*` responses. INFERENCE: it lives in Stripe, not in the API.
- Disputes and chargebacks: no endpoint, no field. The transaction object has `amountRefunded` only. https://marketplace.gohighlevel.com/docs/ghl/payments/get-transaction-by-id.md
- Apps installed inside a client account: no agency-level endpoint found. "Installed locations" exists only for OUR app. INFERENCE: not available.
- Last login / last activity of a client: not in Get Location (see CLIENTS_R1). Derive from our event store.
- Usage totals per account other than wallet balance and wallet transactions (CHECK).
- Per-account "plan" in plain words: only the plan title from `saas-plan`. Accounts not in SaaS mode simply do not appear in the bulk list (INFERENCE): show "Not on a paid plan from you".

## 4. What the platform's own SaaS dashboard gives, and the gaps

- Failed reselling charges show on the agency billing screen; manual retry only from agency level (UNVERIFIED: https://consultevo.com/gohighlevel-retry-failed-payments/). Settings can suspend an account when its subscription fails; Stripe counts canceled, past due, incomplete, incomplete_expired as failed (UNVERIFIED, same source family).
- A Q1 2026 agency SaaS dashboard shows account activity, wallet balance, ticket volume (see docs/research/GHL_API_FEATURE_MAP.md, third-party).
- Payments widget shows successful/failed payments, refunds and disputes per account in the UI only (UNVERIFIED: https://consultevo.com/gohighlevel-billing-dashboard-guide/). INFERENCE: disputes exist in the UI, not the API.
- Ideas board gap (VERIFIED request exists, 0 votes read): no offboarding alert when a client cancels SaaS but keeps add-ons. https://highlevel.canny.io/saas/p/offboarding-workflow-add-on-management-for-saas-cancellations
- Gaps SubSync can fill: ONE ranked list across all accounts, history of status changes (the platform shows only "now"), reasons plus next step, and outcome health beside billing health ("pays but gets no leads answered" is the real churn signal).

## 5. Competitors (all pricing UNVERIFIED unless noted)

| Tool | What agencies/SaaS pay for | Price |
|---|---|---|
| GoCSM (GHL marketplace) | health score, MRR at risk, revenue and margin (see CLIENTS_R1) | not published |
| All The Apps | white-label, support desk, SaaS "Measure" of add-ons/tickets/payments | $129 / $299 / $499 per month (CLAUDE.md, VERIFIED earlier) |
| AgencyAnalytics | client reporting | about $20 per client per month |
| Churnkey | cancel flows, failed-payment recovery, Stripe only | from about $250 per month; https://churnrecovery.pages.dev/posts/Churnkey-Pricing-2026-Is-It-Worth-250-Month (competitor blog) |
| Baremetrics Recover | add-on dunning | conflicting: $69+ or $129 flat or 10% of recovered; https://www.flycode.com/blog/baremetrics-alternatives-2026 |
| ProfitWell / Paddle Retain | dunning, performance fee (15 to 25% of recovered, aggregator claim) | free for Paddle Billing users |
| Chargebee, Recurly | full billing with smart retries, dunning emails | not retrieved |

What they sell: recover failed charges automatically (card updater, smart retry, email sequence). SubSync cannot retry cards (read-only, no Stripe access), so our lane is detect, rank, explain, hand off, and prove. INFERENCE: price at $11.50 per account already; do not add a second price.

## 6. Biggest sources of error (all INFERENCE or UNVERIFIED, build guards)

1. SaaS mode off: the bulk list returns nothing; show "SaaS mode is not on", not "needs permission".
2. Mismatched plan IDs: V1 versus V2 (`isSaaSV2`), legacy subscriptions after migration (UNVERIFIED: growthable and consultevo posts). Group by `saasPlanId`, show "Plan not found" when saas-plan 404s; never print an id as a name.
3. Test versus live: transactions and invoices carry `liveMode` / `paymentMode`. Query `paymentMode=live`; drop `liveMode=false` rows from every total. Test-mode Stripe keys are the top cause of SaaS accounts failing to create (UNVERIFIED: https://growthable.io/gohighlevel-tutorials/account-management/saas-mode-sub-accounts-are-not-being-created-gohighlevel/).
4. Currency: amounts are per `currency`; never sum across currencies; show a total per currency. Minor-unit scaling is undocumented (the doc example shows "100"): CHECK against a real Stripe charge before display.
5. Timezones: `dueDate` is a date string (no zone); `createdAt` is UTC. Evaluate "overdue" in the account's own timezone (locations.timezone, we already store it).
6. Status enums are undocumented for transactions and subscriptions (typed `object`, only "succeeded"/"active" shown). Store the raw string, map known ones, show unknown ones as "Other: <raw>" and log them.
7. Agency token vs location token: SaaS and wallet-by-location work with the agency token; payments/invoices are per location (mint location tokens, we already do).

## 7. Moat: history the platform does not keep

The API returns only "now". An append-only `pm_events` table written by every sweep (subscription status changed, plan changed, wallet balance changed, invoice became overdue, transaction failed, refund amount changed) gives: days a client was past due, how often recovery works, plan-change timeline, wallet burn rate, "who pays late every month". It cannot be rebuilt later; label every chart "history starts <date>". Related: our own app's AppPaymentStatus and PlanChange webhooks (VERIFIED names, https://marketplace.gohighlevel.com/docs/category/webhook) feed SubSync's own billing health.

## 8. Current scopes (src/lib/ghl/scopes.ts)

Already requested: locations.readonly, contacts, opportunities, calendars, conversations, users, oauth.write/readonly, plus optional message, reports, tags, customFields, tasks, calendars groups/resources, writes, workflows.*, campaigns, emails, `saas/location.read`, `saas/company.read`. `docs/SCOPES.md` lists payments/transactions, marketplace-installer-details as "not asked for". New scopes needed: see PAYMENTS_BRIEF section 9.
