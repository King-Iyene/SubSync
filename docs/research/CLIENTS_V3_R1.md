# Clients v3 research (R1, 11 Nov 2026): what the platform API really gives an agency control center

Labels: VERIFIED = official page fetched today (docs base https://marketplace.gohighlevel.com/docs/ghl/); INFERENCE = reasoning; UNVERIFIED = third party or not confirmed. Earlier work: CLIENTS_V2_R1.md, PAYMENTS_R1.md. No live probe was run (see section 7).

## 1. Verdict on the earlier findings

- CONFIRMED: SaaS list gives plan and status only. The location-subscription page lists no date, no amount, no payment-status field; `subscriptionStatus` is a free string (only `active` shown). VERIFIED: https://marketplace.gohighlevel.com/docs/ghl/saas-api/get-saas-locations.md and .../get-location-subscription.md
- CONFIRMED: no failure reason, retry count or next charge date in any SaaS endpoint (17 endpoints listed on https://marketplace.gohighlevel.com/docs/ghl/saas-api/saa-s; only `payment_pending` appears, on rebilling attach).
- CHALLENGED, new finding: `oauth/installed-locations` takes `appId` (not only our own app). It might list another app per account. INFERENCE: it is bound to apps our token is allowed to see, so most likely only SubSync. UNVERIFIED until the probe runs.
- NEW: Agency App Reselling Config API (`marketplace.app.read`, LOCATION token only, 60 requests/min per app): final client prices an agency set for an app. Not an install list. UNVERIFIED path (article gives no URL): https://gohighlevelassist.freshdesk.com/support/solutions/articles/155000007194-agency-app-reselling-config-api
- NEW: `GET /marketplace/billing/charges` exists but is a location token, and lists charges OUR app made to that account (usage meters). Not other apps. VERIFIED: .../marketplace/get-charges.md

## 2. See all subscriptions (the agency's SaaS plans)

| Item | Detail |
|---|---|
| Endpoint | `GET /saas/saas-locations/{companyId}?page=N` (Version v3) |
| Scope / token | `saas/company.read`; agency token (OAuth or Private Integration) |
| Rate limit | 10 requests/second per a help article (UNVERIFIED); page size not settable |
| Verified | per account: locationId, subscriptionId, customerId, saasMode, isSaaSV2, providerLocationId, `subscriptionInfo{priceId, saasPlanId, stripeProductId, subscriptionStatus}` |
| We build | plan, price (from `saas-plan`), status, since-when (OUR own timestamps), monthly recurring revenue estimate |
| NOT available | start date, renewal date, amount actually charged, trial end, status word list (we store raw words) |
| Platform UI | Agency view > Settings > Company billing / SaaS (open with the link helper `crmUrl(..., "/settings/saas")`, path INFERENCE) |

## 3. Who has not paid the SaaS fee

| Item | Detail |
|---|---|
| Endpoint | same list; the status word is the only signal |
| Verified | status is free text, example `active` |
| We build | "Paid", "Not paid" (past_due, unpaid, incomplete, incomplete_expired, canceled, paused: Stripe words, INFERENCE), "No plan"; "became unpaid on <date>" from our history (the moat) |
| NOT available | days overdue from the platform, failure reason, retry count, card expiry, dispute. "Became unpaid" is the day OUR sweep first saw it |
| Platform UI | failed-payment retry is an agency billing screen action only (UNVERIFIED) |
| Optional | `GET /saas/get-saas-locations by stripeId` (VERIFIED, lookup only, no extra data) |

## 4. Upcoming marketplace app charges

| Item | Detail |
|---|---|
| Endpoint | none found. Marketplace charges endpoint (`/marketplace/billing/charges`, `charges.readonly`, location token) lists PAST usage charges of our own app; fields chargeId, entityId (location), amountCharged, units, transactionType charge/refund, refunded, createdAt. No status, no future date. VERIFIED |
| Wallet | `GET /wallet/balance?locationId=` and `POST /wallet/transactions` (`wallet.readonly`; agency token may pass locationId, limit up to 1000, filters transactionType DEBIT/CREDIT, chargeType, settlementTime). VERIFIED https://marketplace.gohighlevel.com/docs/ghl/wallet/list-wallet-transactions.md |
| We build | wallet balance and low-balance list; our OWN estimate: "expected this cycle = sum of price of paid plans" clearly labelled estimate; no dates |
| NOT available | next charge date for any marketplace app or SaaS plan, upcoming app subscription list, agency billing invoice list |
| Platform UI | agency Marketplace > Billing |

## 5. Installed marketplace apps per account

| Item | Detail |
|---|---|
| Our app | `GET /oauth/installed-locations?companyId&appId` (agency OAuth token, `oauth.readonly`, Version v3, pageSize up to 100): per location `isInstalled`, `versionId`, `installedAt`, plus `installToFutureLocations`. VERIFIED https://marketplace.gohighlevel.com/docs/ghl/oauth/get-installed-location.md |
| Installer | `GET /marketplace/app/{appId}/installations` (`marketplace-installer-details.readonly`, OAuth only): installer, company, plan ids. Own app only (INFERENCE). VERIFIED fields |
| Other apps | NOT available: no endpoint lists the apps a client account has installed. Searched official docs and help: none. UNVERIFIED that another `appId` works in installed-locations |
| We build | matrix with a real SubSync column (installed/not, version, date) and ONE honest note "Other apps: not available from the platform yet" |
| Platform UI | agency Marketplace > Installed Apps |

## 6. Bulk install and buying apps for all accounts, usage

| Need | Finding |
|---|---|
| Bulk install an app to many accounts | No API. "Bulk installation" is an app setting and an agency UI action (VERIFIED: policy page https://marketplace.gohighlevel.com/docs/MarketplacePolicies/PrivateAppInstallLimits). We cannot do it through the gateway. We build a list of accounts missing SubSync with a deep link to the install screen |
| Buy/enable an app for all accounts | No API found. SaaS has `Bulk Enable SaaS`, `Disable SaaS`, `Update Rebilling`, `Pause location` (write, `saas/company.write`, VERIFIED names) but those change the agency's own bill; not built |
| Wallet / usage | see section 4. Per-account balance, complimentary credits, usage lines. Usage totals per feature: only via wallet transactions chargeType |
| Webhooks | `AppInstall`, `AppUninstall`, `PlanChange`, `AppPaymentStatus` (OUR app only), `LocationCreate/Update`. No event for SaaS subscription or other apps (VERIFIED names: https://marketplace.gohighlevel.com/docs/category/webhook). Rule: poll and diff, webhooks only speed it up |

## 7. Probe status

No read-only probe was run. A probe needs a token refresh and the refresh token rotates in the live database, so it is not safe to run from a worktree with a copied key (INFERENCE: key may also not match production). `scripts/saas-probe.mts` prints HTTP status, field NAMES and distinct status words for the SaaS list, one subscription, wallet and installed-locations with another appId. King runs it once: `node --env-file=.env.local --import tsx scripts/saas-probe.mts`. See docs/BLOCKED.md.

## 8. What we build from this (all live data, no invented numbers)

1. Money tab: one table of every client account (plan, price, status, how long, wallet, SubSync installed, health). Filters: not paid, no plan, plan, SubSync missing, low wallet. Counts equal rows.
2. "Who owes the SaaS fee" = the not-paid filter, oldest first.
3. Expected this cycle = estimate from plan price of paid accounts. At risk = same for not-paid. Both labelled estimates with the formula.
4. History (append-only `cl3_account_history`): every plan, status, wallet-band and install change with the day we saw it.
5. Not available (one note per area): next charge date, failure reason, other installed apps, bulk install, app purchases.
6. Scopes: no new scope. Already optional: `saas/company.read`, `wallet.readonly`, `oauth.readonly`, `marketplace-installer-details.readonly`. Missing ones show ONE "Needs permission: reconnect" line naming them.

Competitor context: GoCSM and All The Apps show MRR and health on their own platform; none confirmed to read failed-payment reasons either (UNVERIFIED).
