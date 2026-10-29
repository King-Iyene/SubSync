# Feature research: gaps in GHL's native tooling

Researched 2026-10-29. Confidence labels: **Verified** (official docs or the platform's own pages), **Vendor claim** (a company selling a competing product), **Inference** (our reasoning, no direct evidence).

Most web sources here are vendor blogs and consultants with something to sell. Direct user demand is thin: I found one ideas-board post and no vote counts for the cross-account items. Treat everything below as directional until agencies tell us otherwise.

## 1. What agencies are missing

| Gap | Evidence | Confidence |
|---|---|---|
| No inbox across client accounts. One ideas-board post, "UniBox for ALL Sub-Accounts", says monitoring many accounts means 40+ tabs open. The only workaround in the help docs is combined notifications in Agency View. | [ideas board post](https://ideas.gohighlevel.com/conversations/p/unibox-for-all-sub-accounts-pls), [help article](https://pyroshelp.helpscoutdocs.com/article/1020-recieving-notifications-for-all-subaccounts) | Verified that the request exists. Votes and status not visible. |
| No cross-account reporting. Dashboards live inside one account; the agency dashboard shows aggregate totals only. Agencies assemble comparisons by hand. | [Omni Online Strategies](https://omnionlinestrategies.com/blog/how-digital-marketing-agencies-use-gohighlevel-one-dashboard), [Windsor.ai](https://windsor.ai/how-to-connect-gohighlevel-to-chatgpt/) | Vendor claim |
| No way to see whether a client account is dormant. A user asked for visibility into client logins. | [ideas board: ability to see user activity](https://ideas.gohighlevel.com/users-permissions/p/ability-to-see-user-activity) | Verified that the request exists |
| Setup drift between accounts: comparing tags, custom fields and trigger links across locations and copying what is missing. | [ghladmin by Growthable](https://growthable.io/tools/ghladmin/) exists to do exactly this | Vendor claim, but a shipped product suggests real demand |
| Contact search is location-scoped by design; there is no global search. | API search requires a location ID ([example](https://tinycommand.com/integrations/gohighlevel/actions/search-contacts)) | Verified (API behaviour). Demand is **inference**. |
| Duplicates appear after imports and restores; the platform has a per-account duplicate filter and "Copy Contact to Sub-Account" matches on email. | [4Spot Consulting](https://4spotconsulting.com/beyond-the-basics-diagnosing-preventing-highlevel-duplicates-after-data-restore/), [ConsultEvo](https://consultevo.com/gohighlevel-manage-duplicate-contacts/) | Vendor claim |
| Snapshot updates cannot be reverted (493 votes, planned). This is a platform feature, not ours to build. | [ideas board](https://ideas.gohighlevel.com/) | Verified |

## 2. Who already serves this

- **GoCSM**: customer-success tool for HighLevel agencies. 0-100 health score per account from adoption, revenue, logins and sentiment; inactivity alerts; billing signals via Stripe. Covers our Phase 2 "engagement score" and "churn risk" ideas. [changelog](https://gocsm.featurebase.app/changelog/rocket-new-health-dashboard-v3-now-live). Vendor claims.
- **AgencyAnalytics, Databox, Two Minute Reports, Windsor.ai**: reporting tools with HighLevel connectors; AgencyAnalytics advertises roll-ups across locations. Reporting is crowded; we should not compete on dashboards and charts. [AgencyAnalytics](https://agencyanalytics.com/feature/highlevel-reporting-integration), [Databox](https://help.databox.com/integrate-gohighlevel-with-databox). Vendor claims.
- **ghladmin (Growthable)**: side-by-side configuration comparison and bulk copy across locations. [site](https://growthable.io/tools/ghladmin/).
- **"All The Apps"** (the brief's closest competitor, "about 197K installs"): I could not find it in any search, so that claim is unverified. Check the marketplace listing directly.
- I found no marketplace listing offering a cross-account inbox or global contact search. Absence from search results is not proof the marketplace has none.

## 3. What the platform already does natively (do not rebuild)

- Agency dashboard with aggregate totals; recent updates add dynamic custom values in dashboard widgets. Vendor-reported, not from official release notes.
- Combined notifications for all accounts in Agency View.
- Copy workflows to another account; copy contact to another account; per-account duplicate filter; bulk actions.
- Mobile app search and Ask AI (agency admins).

## 4. API facts that shape the design (Verified from official docs)

- **Rate limits are per app, per resource.** 100 requests per 10 seconds and 200,000 per day, where a resource is one location or one company. Each install gets its own budget, so syncing 30 client accounts is **not** capped at 100 per 10 seconds in total; each account has its own allowance. Responses carry `X-RateLimit-*` headers; read them instead of counting. The docs say nothing about 429 retry behaviour, so implement backoff ourselves. [rate limits](https://marketplace.gohighlevel.com/docs/other/rate-limits/index.html)
- **Webhooks:** signature header `X-GHL-Signature` (Ed25519); the older `X-WH-Signature` (RSA-SHA256) is deprecated from **1 September 2026**, which has passed, so verify Ed25519 only. Any non-2xx or timeout is retried with exponential backoff up to 12 times, so handlers must be fast and idempotent. Confirmed event names: `ContactCreate`, `ContactUpdate`; opportunity, appointment, location and install events exist but I could not get their exact names. [webhook guide](https://marketplace.gohighlevel.com/docs/webhook/WebhookIntegrationGuide.md)
- **Agency install flow:** an agency install returns a Company token with `isBulkInstallation: true`; list installed locations, exchange the agency token for a location token per location, and listen for `AppInstall` to catch new ones. [distribution model](https://marketplace.gohighlevel.com/docs/oauth/AppDistribution.md)
- **Not exposed by API (reported):** newer AI Employee surfaces, snapshot operations, parts of the funnel builder. [API report card](https://supergood.ai/api-report-card/gohighlevel). Vendor claim. **Login and user-activity data was requested on the ideas board, which suggests the API does not expose it.** If so, any "engagement score" must be built from data activity (contacts, deals, conversations), not logins, unlike GoCSM.

## 5. Recommendations (for King to decide)

1. **Keep Phase 1 as planned** (search, completeness, stale deals, onboarding). None of it overlaps the native tools we found.
2. **Consider pulling a read-only "unread across accounts" view forward from Phase 2.** It has the only direct demand evidence we found. Needs `conversations.readonly` (already requested); the cost is polling every location or finding the right webhook events.
3. **Add "setup comparison" as a new Phase 2 candidate** (tags, custom fields, custom values across accounts, read-only first). A shipped competitor exists, it is low-risk, and it needs extra read scopes (`locations/tags.readonly`, `locations/customValues.readonly`, `locations/customFields.readonly`; names to confirm in the portal).
4. **Narrow roadmap item 10, "cross-account duplicate finder and merge".** Contacts in different client accounts belong to different businesses; merging or even surfacing them across clients risks exposing one client's customers to another. Recommend duplicate detection **within** an account only, or across accounts that belong to the same end client.
5. **Do not build a standalone health-score product against GoCSM.** Ship a lightweight activity-based flag (accounts with no new contacts, deals or conversations in N days) as a feature, not the product.
6. **Keep the price model.** The platform confirms agencies buy apps per-sub-account or usage-based, which fits $5 per client account.

## 6. Still unverified

- Exact webhook event names for opportunities, conversations, appointments and uninstall.
- Whether the API exposes any user login or activity data.
- Vote counts and status of the unified inbox request.
- The "All The Apps" competitor and its install count.
- Whether a Sub-Account-target app installed in bulk can call the locations and oauth endpoints with only the 7 scopes selected (we find out at the first real install).
