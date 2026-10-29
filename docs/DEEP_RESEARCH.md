# Deep research: what is defensible, and what customers pay for

Researched 2026-10-29 by four parallel streams, then cross-checked. Extends `FEATURE_RESEARCH.md`. Labels: **Verified** (official page or the platform's published API specs), **Checked** (reported by a researcher, then re-verified by hand), **Vendor** (a seller's claim), **Inference** (our reasoning).

Caveats: Reddit, Facebook groups and the JS-rendered marketplace pages could not be reached, so community evidence is thin. The ideas board gives real vote counts, but the fetch tool sometimes mixed up votes and comment counts on listing pages, so counts below come from individual post pages where possible. No source showed how long any request has sat "Planned".

## 1. Where the streams agree and disagree

**Agree**
- Every CRM data API is **per location**: contacts search, conversations search, opportunities search and workflows list all take a location ID and a sub-account token. No company-level endpoint for contacts, conversations, opportunities or workflows was found (absence of evidence, not proof). The agency token lists locations and mints per-location tokens; the agency-only scopes cover provisioning, billing and snapshots, not CRM data. GHL's own MCP server is one location per call. So a cross-account view must fan out across locations. Verified.
- GHL's recent agency-admin investment is **revenue levers** (SaaS mode, rebilling, bulk toggles, a new Sub-Accounts list with filters and bulk actions), not reading across tenants' CRM data. Inference.
- No documented case of GHL absorbing a cross-account tool. The only absorption claim is one vendor (CloseBot) saying GHL builds what about 80% of users need and leaves niche, deep features to apps. Vendor.

**Disagree, and how I resolve it**
- *Login and user-activity data.* One stream says the locations response and the webhook list have no login fields, so engagement scoring must use data activity. Another notes GoCSM sells login tracking, so some source may exist. **Unresolved.** Keep the engagement flag data-activity-based, and test whether the Users API exposes last login (needs a users read scope; confirm name in the portal).
- *Unified inbox demand.* Earlier I called it the only direct demand evidence. Two posts exist but with about 6 votes each, so that case is **weaker than I said**. Your decision to keep the roadmap order stands on firmer ground.
- *Revenue share.* The brief's 15% is unsupported. Checked: the help article (modified 2026-06-23) says no commission is deducted today.

## 2. Demand evidence (ideas board votes unless noted)

| Pain | Evidence | Strength |
|---|---|---|
| No agency-level reporting across accounts | "Master Dashboard for all subaccount stats" 70 votes (2020), commenter with 100+ locations; "Agency-level view of ad performance" 109 votes, Under Review, commenter with about 200 accounts wanting weekly roll-ups to reduce attrition | Strongest |
| Dormant clients and user activity | 191 votes (2023), unanswered "is this happening?" comment in May 2026 | Strong |
| Snapshot mistakes and drift | Revert snapshot update 493 votes (Planned); snapshot history and audit 151 (Planned) | Strong, but the revert is GHL's to build; a read-only drift report is separate |
| Staff permissions per sub-account | 144 votes | Strong, but a platform limit; we could only assist |
| Wallet and rebilling failure alerts | 25 votes | Moderate; whether the data is readable by API is unverified |
| A2P and phone status across accounts | 61 votes (2023); partly solved natively since (an "A2P Verified" filter in Agency View) | Moderate, partly solved |
| Cross-account unified inbox | 6 + 6 votes | Weak |
| Silent workflow failures | 6 votes; execution logs are UI-only with no API | Thin, and likely not buildable |
| Onboarding and QA | Vendor and freelancer pages only | Real but unmeasured |

## 3. What agencies already pay for (all Vendor claims)

- **GoCSM** (health scoring for HighLevel agencies): nightly health checks, inactivity and billing alerts, 70 playbooks. Pricing page shows flat tiers with account caps: about $1,970/yr for 100 accounts, $3,970/yr for 300, $6,970/yr for 700, plus an "unlimited accounts, login activity" plan at $570/yr. **That is roughly $1.60-$2 per account per month at 100 accounts, against our $5.** No customer counts or reviews shown.
- **ghladmin (Growthable):** location comparison, bulk create fields and tags, stale-deal board; "free to start". No user counts.
- Reporting tools (AgencyAnalytics, Databox, Two Minute Reports, Windsor.ai) and ad-hoc spend (managed support, freelancers for A2P and workflows, custom polling scripts).
- "All The Apps" and its claimed 197K installs: **not found anywhere; unverified.** Only the marketplace listing can settle it.
- Third-party counts say 1,273 to 1,800+ marketplace listings and 4-7 paid apps per agency, with per-sub-account pricing common (Vendor, unverified).

## 4. External-data features (hard for GHL, buildable by us)

- **Registration status for A2P is not in the public API.** The phone-system spec has 4 endpoints (number pools, numbers by location, available numbers, purchase). Status exists only in the Trust Center UI. Verified.
- **What is readable:** numbers per location (`phonenumbers.read`), message outcomes including failed, undelivered and opt-out (`conversations/message.readonly`), and webhooks `OutboundMessage`, `InboundMessage`, `ContactDndUpdate`. So a **delivery-outcome monitor** is possible; a registration monitor is not (and scraping is not recommended).
- **Email:** no domain or DNS endpoints exist. The `LCEmailStats` webhook gives per-email events (recipient domain, SMTP codes, sending IP, an authenticated flag), forward-only, and is **available only to location-level apps**, which matches our Sub-Account-target app. Domain checks (SPF, DKIM, DMARC, blacklists) need external lookups. Google's sender rules (SPF/DKIM for all; SPF+DKIM+DMARC above 5,000 messages a day to Gmail; spam rate under 0.3%) are official; Microsoft's equivalent rules from May 2025 are only vendor-reported. Google Postmaster Tools API v2 exists but likely needs domain verification per client domain, a real onboarding cost.
- **Ads:** the ad-manager spec exposes Facebook, Google and LinkedIn reporting (`adPublishing.readonly`) only where the client connected the ad account inside GHL. Contacts carry attribution and click-id fields. Joining spend to contact attribution to opportunity value would give cost per lead and per won deal across all clients. Feasible but a crowded space, and limited to GHL-connected ad accounts.
- **Reviews and Google Business Profile:** no reviews list endpoint; would need Google's own API and approval. Low priority.
- **Opt-in cross-agency benchmarks:** precedent exists (Klaviyo, Mailchimp). Response time and show rate can be computed from scopes we have. Cold-start problem, GHL's developer terms on aggregating across locations are unchecked, and it needs opt-in and a minimum cohort. Potentially the strongest long-term moat.

## 5. Marketplace rules and money

- **No commission today. (Checked)** "We currently do not deduct any commission. You receive the entire payment." Payouts monthly on the 15th via Tipalti. "Currently" means it can change; model 15% as a downside case only.
- **Pricing models:** Free, Paid subscription, Paid one-time, Freemium, and usage-based. An agency fee plus a per-sub-account fee exists ($50 + $10 per sub-account example). A free allowance followed by a per-account charge is not described; test in the portal. Trials 1-90 days. Agencies can mark up; you receive the base price. Take payment inside GHL so agencies can resell.
- **Private apps are capped at 5 agencies. (Checked)** For apps created after 2025-11-18, installs are blocked from the 6th agency. Sub-accounts and bulk installs count as one. A security review opens only at 6+, and publishing publicly removes the cap. **Real growth means going Public.**
- **Public listing needs:** least-privilege scopes with a justification each, HTTPS, tokens never in client code, no customer data in logs, 3-6 screenshots, a demo video (install, setup, main flows, errors, uninstall), support reply within 24 hours, privacy and terms URLs, and a disconnect flow that states whether synced data is kept or deleted. Scope, domain or data-flow changes can trigger re-review.
- **Testing:** sandbox accounts are free and last up to 6 months, but only a single-location install is documented. Whether a sandbox can exercise the agency-token and bulk-install flow is unknown. A changelog says $97 agencies can install agency-distributed apps; a private app on $97 is undocumented.
- **Data and privacy (Inference, not legal advice):** end client is probably the controller, the agency the processor and SubSync the agency's sub-processor, which implies a DPA, a sub-processor list, breach notice, deletion on uninstall and a purpose limit. GHL imposes no stated caching limit or deletion deadline. Minimum storage principle: identifiers and aggregates, names and emails only where a feature visibly needs them, never show one client's contacts in another's view, purge on uninstall.

## 6. Defensibility ranking

Score: demand evidence, how hard for GHL to build quickly, and whether we can build it from the API.

| # | Capability | Demand | Hard for GHL | Buildable | Verdict |
|---|---|---|---|---|---|
| 1 | Cross-account activity and dormant-account flag (built from data activity) | Strong (70, 109, 191 votes) | Medium-high: cross-tenant reads, request open since 2020/2023 | Yes, current scopes | **Top priority.** GoCSM competes, so differentiate on speed and price |
| 2 | Cross-account search, stale-deal and completeness roll-ups (Phase 1) | Indirect (the reporting pain) | High: all APIs per location, no company endpoint | Yes | Core product, as planned |
| 3 | Email authentication and deliverability monitor | Indirect | High: needs external DNS data | Yes (`LCEmailStats` + DNS lookups) | **Best new idea.** Upgrade roadmap item 18 |
| 4 | Messaging delivery-outcome monitor | Moderate (61 votes, partly solved) | Medium: registration status not in API | Outcomes only | Candidate |
| 5 | Ad spend to opportunity attribution | Moderate | Medium; crowded | Yes, GHL-connected ads only | Candidate, later |
| 6 | Opt-in cross-agency benchmarks | Unknown | High once it has agencies | Yes | Long-term moat; needs install base first |
| 7 | Snapshot drift report (read-only) | Strong for snapshots overall | Medium | Partly; Workflows API is beta, gated per location | Candidate; ghladmin partly covers it |
| - | Workflow failure monitoring, review monitor, staff permissions | Thin or platform-limited | n/a | Not feasible or off-scope | Skip |

**Risks to the current plan**
- Roadmap items 14-17 (workflow audit and sync) depend on a **closed-beta Workflows API enabled per sub-account**; others get a 403. Treat Phase 4 workflow features as speculative.
- **Pricing:** GoCSM's flat tiers work out to about a third to two fifths of our $5 per account at 100 accounts. Overlap is partial (dormancy and health), but agencies will compare. Consider flat or tiered pricing for engagement features.
- **Private cap:** 5 agencies. Plan the Public submission earlier than the brief's last step.
- **Scopes:** several candidates need scopes we have not requested (`adPublishing.readonly`, `phonenumbers.read`, `conversations/message.readonly`, a users read scope). Adding scopes after a public review can trigger re-review, but least-privilege review rejects scopes without a feature. Add them while private, then freeze the list before submitting.

## 7. Engineering facts to carry into the build

- **Webhook event names confirmed (Verified from the published API specs):** `ContactCreate`, `ContactUpdate`, `OpportunityStageUpdate`, `OpportunityStatusUpdate`, `AppointmentCreate`, `InboundMessage`, `OutboundMessage`, `ConversationUnreadWebhook`, `ContactDndUpdate`, `LCEmailStats`, `AppInstall`, `AppUninstall`. Verify signatures with `X-GHL-Signature` (Ed25519) only.
- **Check before building the sync:** one researcher cited the location-token endpoint as `POST /oauth/location-token` in the current docs, while the official template and an earlier doc fetch use `/oauth/locationToken`. Our client uses `/oauth/locationToken`. Confirm the live path against the API spec first.
- **Rate limits are per app per location or company,** so per-account sync workers can run in parallel with separate budgets.
- **Data minimisation:** the current `cached_contacts` stores names, emails and phones for search. Keep that, but write the retention window into the privacy policy before going Public, and never serve one account's contacts in another account's view by default.

## 8. Still unverified

- Whether the Users API exposes last login; whether wallet and A2P-adjacent data are readable.
- The "All The Apps" competitor; GoCSM's popularity; any marketplace install counts.
- Signed developer agreement terms (revenue share, aggregation of data across locations).
- Whether a Freemium plan can give a free allowance then charge per account; whether a sandbox runs an agency bulk install; a private install on a real $97 account.
- Whether privacy and terms URLs are mandatory at submission (the review guidelines and listing checklist disagree).
