# SaaS and installer reads: live probe (13 Nov 2026)

Read-only. Only GET calls, through the app's own token code (`scripts/saas-installer-probe.mts`, pool of 2). Run against the agency install (3 client accounts), once. Nothing printed but statuses and field names. Ids anonymised.
Docs checked: the platform's public API descriptions (saas-api, marketplace, oauth) in the open `highlevel-api-docs` repository; the marketplace docs site is a script-rendered page, so it was not readable by fetch.

## What this install had granted
`oauth.readonly` granted. NOT granted on this install: `saas/location.read`, `saas/company.read`, `marketplace-installer-details.readonly`, `wallet.readonly`. The portal draft ticks `saas/location.read`, `marketplace-installer-details.readonly` and `wallet.readonly`, but an install only gets what it was granted at install time: King must reinstall (or press Update on the new version) before any of the three can answer.

## Results
| Read | Token | Scope the API description names | HTTP now | Meaning |
|---|---|---|---|---|
| `GET /saas/saas-locations/{companyId}?page=1` (plan and status per account) | agency | `saas/company.read` (agency access only) | 401 "The token is not authorized for this scope." | Permission not granted. NOT "agency apps only": the old code read every 401 as that. |
| `GET /saas/get-saas-subscription/{locationId}?companyId=` | agency | `saas/company.read` | 401 same | same |
| `GET /saas-api/public-api/get-saas-subscription/{loc}` | agency | agency access | 401 same | same |
| `GET /saas/agency-plans/{companyId}`, `GET /saas/saas-plan/{planId}` | agency | agency access | 401 same | same |
| `GET /saas/get-saas-subscription/{loc}` and `/saas/saas-locations/{company}` with a LOCATION token | location | none (agency access only) | 401 same | Location tokens are refused the same way. |
| `GET /saas/location/{loc}` (guess) | location | n/a | 404 "Cannot GET /saas-api/location/{id}" | No such route. |
| `GET /marketplace/app/{appId}/installations` | agency and location | `marketplace-installer-details.readonly` | 401 same | Permission not granted. |
| `GET /wallet/balance?locationId=` | location | `wallet.readonly` | 401 same | Permission not granted. |
| `GET /oauth/installedLocations?companyId&appId&skip&limit` (Version 2021-07-28) | agency | `oauth.readonly` | **200** | LIVE DATA, see below. |
| the same with `isInstalled=false` | agency | `oauth.readonly` | 200, count 0 | none removed |

## `saas/location.read`: nothing in the public API description is tied to it
All 11 SaaS routes list "Agency-Access" only (no scope named on the route; the page for each names `saas/company.read`). There is no location-level SaaS read to call. `saas/location.read` unlocks nothing documented. CHECK: ask platform support what it unlocks. To get plan names, status and price SubSync needs `saas/company.read` on the draft (King has not ticked it; it is not in `src/lib/ghl/scopes.ts` either, so no install can ever grant it today). Whether a Sub-account app is allowed to hold it is CHECK (the portal may only offer it to company-level apps).

## What the SaaS reads return when granted (from the API description, NOT seen live)
`saas-locations`: per account `locationId, subscriptionId, customerId, saasMode, isSaaSV2, providerLocationId, subscriptionInfo{priceId, saasPlanId, stripeProductId, subscriptionStatus}`. `saas-plan`: `title, trialPeriod, userLimit, contactLimit, prices[]`.
`subscriptionStatus` is a free string. Not in any SaaS read: next payment date, amount charged, failed-payment reason, retry count, overdue invoice list, trial end date. So "who defaults" can only mean a past-due style STATUS word, and "upcoming payments" does not exist.

## Installer details (`GET /marketplace/app/{appId}/installations`, Version 2021-07-28)
Per the API description: ONE record (`installationDetails`) for the token that asks, not a list: `companyId, locationId, companyName, relationshipNumber, companyEmail*, companyOwnerFullName*, userId, isWhitelabelCompany, companyPlan*, marketplaceAppPlanId, whitelabelDetails` (*null for account-level installs). No install date, no trial, no status, no version. Needs `marketplace-installer-details.readonly` (agency or location token). So it cannot power a "who is installed, when, on trial" list.

## The installed list does (live, `oauth.readonly`)
`GET /oauth/installedLocations`: 3 of 3 accounts returned. Item fields: `_id, name, address, isInstalled, versionId, installedAt, planId, trial{onTrial}`. All 3 installed, all installed 14 days ago, version id present on all, `planId` present on the unfiltered list (not on the `onTrial=true` filter's items, which also ignored the filter: it returned the same 3 rows with `onTrial:false`, so the filter cannot be trusted). `trial` holds only the boolean `onTrial`: no trial start, length or end date. `isInstalled=false` returns an empty list, so an uninstalled account is simply absent from the list.
A bug found: the old hourly read called `/oauth/installed-locations` (404, wrong path, wrong paging) and never stored anything. It now uses the path above.

## Wallet (already built)
`GET /wallet/balance?locationId=` (location token, `wallet.readonly`). The code reads `balance` and `complimentaryCredits`. Not seen live: refused with the same 401 on all 3 accounts.

## NOT available (say so plainly in the app)
Who is defaulting on THIS app's payment (SubSync's own marketplace billing): no endpoint. Payments due in the next 7 days, next payment date, failed-payment reason, trial end date: no endpoint. Other marketplace apps installed in an account: no endpoint. Plan name, status and price of the agency's own SaaS plans: exists, but only after `saas/company.read` is granted, and not proven live yet.
