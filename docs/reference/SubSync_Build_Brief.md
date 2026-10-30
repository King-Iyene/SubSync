# SubSync - Build Brief (v2)

Save this file as `CLAUDE.md` in the root of the `subsync` project folder so every Claude Code session reads it. You can also paste it whole into a chat.

---

## 0. WORKING AGREEMENT (read first)

I am King. I am a non-traditional builder who vibe-codes with you. You are the lead engineer on this project.

- This brief is a starting point, not a cage. If you find a better structure, library, schema, or build order, use it and tell me why in two lines. If the GHL API docs contradict this brief, trust the docs and tell me.
- Make small decisions yourself. Ask me only when a choice is expensive, irreversible, or needs a login/click only I can do. One question at a time.
- Keep a running log in `docs/DECISIONS.md` (date, decision, reason). Keep commits small and clear.
- Never commit secrets. `.env*` files are gitignored. Never expose the Supabase service role key to the browser.
- When you need me to do something in a browser (GHL developer portal, Supabase dashboard, Vercel dashboard), give me a numbered list with the exact button labels and the exact text to paste, then tell me what to send back. Do not assume I know where anything is.
- Before you rely on any GHL API detail from this brief, check the live docs. Docs are available as markdown by appending `.md` to many pages under https://marketplace.gohighlevel.com/docs/ (for example https://marketplace.gohighlevel.com/docs/oauth/CreateMarketplaceApp.md).
- Verified facts below are marked VERIFIED. Anything marked CHECK is my best understanding and must be confirmed against the docs before you build on it.

**Git workflow (standing instruction from King):** commit and push straight to `main` on GitHub every time code is written, no feature branches or PRs, so Vercel auto-deploys.

---

## 1. WHAT WE ARE BUILDING

**SubSync** is a GoHighLevel (GHL) Marketplace app for agencies. It gives an agency one dashboard across ALL of its client accounts (GHL calls them sub-accounts or locations).

Why it should win:
- GHL's native tools work inside one account at a time. Nothing native crosses account boundaries.
- Closest marketplace competitor ("All The Apps", about 197K installs) does onboarding checklists and support, not cross-account intelligence.
- Insycle (data quality tool) does not support GHL.
- Our moat is cross-account intelligence. Do NOT build features GHL already has natively (bulk tag, basic reporting, dark mode, shortcuts).

Business model: agency-level app, paid per client account per month, sold through the GHL Marketplace. Details in section 8.

Scope decision: SubSync is an AGENCY-level app first (company-level OAuth, "Agency only" install). A sub-account-level variant may come later. Cost tracking and margin features are explicitly OUT of scope.

---

## 2. NAMING AND IDENTIFIERS (use exactly these)

| Thing | Value |
|---|---|
| Product name | SubSync |
| Git repo | `subsync` (private) |
| Local folder | `subsync` |
| Supabase project | `subsync` |
| Vercel project | `subsync` |
| GHL marketplace app name | SubSync |
| GHL app version | 1.0.0 |
| Company on listing | KD Squares Ltd |
| Support email | code@kdsquares.com (I can change this) |
| Production URL | whatever Vercel assigns first (for example https://subsync.vercel.app), custom domain later |

Public-facing naming rule (important for marketplace approval): the GHL developer form says to avoid "highlevel" or "gohighlevel" references in the logo and website, and GHL's app review guidelines say to avoid internal terms like "sub-account" in listing text and images. So in anything public (listing text, screenshots, logo, landing page) say "client accounts" or "business accounts", not "sub-accounts", and do not use the GHL name or logo. Inside our own dashboard UI, "client accounts" is also the preferred wording.

---

## 3. TECH STACK

- Next.js (App Router), TypeScript, Tailwind, shadcn/ui
- Supabase (Postgres) for tokens, cached data, settings
- Vercel for hosting
- GitHub for source
- GHL OAuth 2.0 and GHL API v2 (base URL `https://services.leadconnectorhq.com`, header `Version: 2021-07-28` on most endpoints, CHECK per endpoint)
- Billing: GHL Marketplace native billing (see section 8). Do NOT integrate Lemon Squeezy or Stripe for marketplace installs.

---

## 4. WHO DOES WHAT

**You (Claude Code) can do with CLIs, after I log in once:**
- git and GitHub: `gh auth login`, then `gh repo create subsync --private`
- Supabase: `supabase login`, `supabase link`, `supabase db push` (I may create the empty project in the dashboard first and give you the project ref and DB password, either route is fine)
- Vercel: `vercel login`, `vercel link`, `vercel env add`, `vercel deploy`
- Generating the logo as SVG and exporting PNG

**Only I can do (web only):**
- Creating/editing the app in the GHL Marketplace developer portal (marketplace.gohighlevel.com). Section 6 gives you the exact values to hand me.
- Copying the Client ID, Client Secret, and SSO key out of the portal.
- Installing the private app into my accounts using the Test Link.

GHL also has a Marketplace CLI and MCP server (https://marketplace.gohighlevel.com/docs/sdk/marketplace-cli/mcp). CHECK whether it can create or update app settings. If it can, use it. Do not depend on it.

---

## 5. BUILD ORDER

Work in this order. Each step has a "done when". Reorder if you find a better path.

**Step 0 - Preflight.** Check node, git, gh, supabase CLI, vercel CLI are installed and logged in. Tell me exactly what to install or log into. Done when all CLIs respond.

**Step 1 - Repo and skeleton.** Create the Next.js project with shadcn/ui, init git, create the private GitHub repo `subsync`, push. Add `.gitignore`, `.env.example`, `docs/DECISIONS.md`. Done when the repo exists on GitHub and `npm run dev` works.

**Step 2 - Supabase.** Create (or link) the Supabase project, put migrations in `supabase/migrations/`, run them. Schema guidance in section 9. Done when tables exist and a test insert/select works from server code.

**Step 3 - Vercel.** Link the repo, set env vars, deploy placeholder pages: `/` (landing), `/app` (the dashboard that GHL will iframe), `/privacy`, `/terms`, `/support`. The marketplace needs support, privacy, and terms URLs. Write honest placeholder privacy and terms text and tell me they need a human review before we go Public (the app stores client contact data). Done when the production URL loads all pages.

**Step 4 - GHL developer portal setup (me, with your help).** Give me the portal checklist from section 6 with the Vercel URL filled in. Generate the logo. Done when I send you the Client ID, Client Secret, and SSO key and you have stored them as env vars locally and in Vercel.

**Step 5 - OAuth install flow.** See section 7. Done when I can install the private app into my own account via the Test Link and a row appears in `installations`.

**Step 6 - Embedded app and identity.** The app appears inside GHL via the Custom Pages module (iframe) and identifies the agency through GHL SSO. See section 7. Done when opening SubSync from inside GHL shows the right agency name without a separate login.

**Step 7 - Sync engine.** Pull the list of client accounts, then contacts and opportunities per account into Supabase, with rate limiting and resumable jobs. See section 10.

**Step 8 - Feature 1: Cross-account contact search.** One search box (name, email, phone). Results show contact, which client account, tags, last activity, and a deep link into that contact in GHL. Done when searching returns correct matches across at least 2 accounts quickly (target under 1 second from cache).

**Step 9 - Feature 2: Data completeness report.** Per client account: total contacts, % with email, % with phone, % with tags, % active in last 90 days. Color coded, sortable. Done when numbers match a manual spot check on one account.

**Step 10 - Feature 3: Stale deal alerts.** All open opportunities across accounts that have not changed in 30/60/90 days (configurable). Sortable, with deep link into GHL. Done when it matches a manual check.

**Step 11 - Feature 4: Client onboarding checklist.** Per client account: has pipeline, has contacts, has calendar, has workflow (if workflow API is available for that account, otherwise show "unknown", never guess). Completion percentage.

**Step 12 - Test and ship.** Test on the GHL sandbox account and on my real account. Then pricing setup, privacy/terms review, switch Private to Public and submit for review.

**Roadmap after Phase 1 (do not build yet):**
- Phase 2: unified inbox across accounts, lead response time tracking, client engagement score, churn risk alerts.
- Phase 3: multi-pipeline dashboard, cross-account duplicate finder, central task queue, scheduled data exports, global DND.
- Phase 4: workflow audit and trigger conflict detection (workflow API is limited availability, see below), batch settings propagation, workflow template sync, DNS health checker (external DNS lookups), team performance.
- Phase 5: natural language queries and AI weekly client summaries.

---

## 6. GHL DEVELOPER PORTAL SETUP (exact values)

I already have a developer account. I have a blank draft app named SubSync open (version "vdraft", status DRAFT). The form shows a "Mandatory steps (0/5)" box: Basic info, Profile details, Support details, Pricing details, Publish.

Give me this as a checklist and fill in the URL once Vercel is live.

**Build > Profile > Basic Info**
- App name: SubSync
- App logo: 1:1, PNG/SVG/JPEG/JPG/GIF, min 400x400, max 800x800, max 500 kB. No HighLevel or GoHighLevel references. You generate it (simple, clean mark, works on light and dark backgrounds) and export a 512x512 PNG under 500 kB.
- Category: Data management, Analytics and data, CRM (already selected)
- Tagline: "One dashboard for all your client accounts" (shorten if there is a character limit)
- Business niche: pick the closest to agencies or marketing agencies from the dropdown
- Company: KD Squares Ltd
- Website: the Vercel production URL (no GHL references on the page)

**Listing Configuration / App Profiles / Getting Started Guide**
Use this copy, adjust to the field limits:

Short description:
"SubSync gives teams that manage many client accounts one place to search contacts across every account, spot stale deals, check data quality, and track onboarding progress."

Long description:
"Managing dozens of client accounts means jumping between dashboards all day. SubSync connects to your accounts and brings the important signals into one view.
- Search any contact across all client accounts at once
- See data health per account: missing emails, missing phones, untagged and inactive contacts
- Catch stale deals before they go cold, across every pipeline
- Track onboarding progress for each new client account
Built for agencies and teams that manage many client accounts. Install once, see everything."

Getting started (3 steps): 1) Install SubSync and approve access. 2) Wait a few minutes for the first sync. 3) Open SubSync from your menu and start with Search.

**Support Details**
- Support email: code@kdsquares.com
- Support URL: https://<production-url>/support
- Privacy policy URL: https://<production-url>/privacy
- Terms URL: https://<production-url>/terms

**Advanced Settings > Auth**
- Who can install: Agency only (CHECK the exact label in the form)
- Listing type: Standard
- Redirect URLs: `http://localhost:3000/api/oauth/callback` and `https://<production-url>/api/oauth/callback`
- Scopes (request the minimum, add more only when a feature needs them): `locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `calendars.readonly`, `conversations.readonly`. CHECK which scopes are needed to list installed locations and to mint location tokens (the oauth/locationToken and installed locations endpoints). Add `contacts.write` only when we actually write.
- Client keys: I copy the Client ID and Client Secret and send them to you.

**Modules**
- Custom Pages: enable, point the iframe URL at `https://<production-url>/app`. Enable SSO and give me the SSO key. CHECK the exact module settings in the docs.
- Webhooks: subscribe to app install and uninstall events and contact/opportunity change events if available. CHECK event names.

**Pricing:** fill in last, see section 8.

**Testing:** Developer portal > My Apps > SubSync > Manage > Versions > three dots > Test Link, enter my Location ID, open the link, click Install. I will test on my own agency and on the GHL sandbox account (CHECK how to request a sandbox; the sandbox allows 2 sub-accounts).

Open question to test early: my own agency is on the $97 Starter plan (3 accounts). GHL docs say the agency-level app marketplace is limited to certain plans and use older plan names. CHECK whether an agency-level private app can be installed and tested on my Starter plan. If not, use the sandbox account. Report back what you find.

---

## 7. OAUTH AND AUTH DETAILS

VERIFIED from GHL docs:
- Authorization Code flow. Access token lasts about 24 hours (about 86,399 seconds).
- Refresh token is valid for up to ONE YEAR or until used. Every refresh returns a NEW refresh token and the old one stops working. You must save the new refresh token on every refresh. Reusing an old one fails. Use a lock or atomic update so two parallel requests do not both refresh and break the token chain.
- Token endpoint: `POST https://services.leadconnectorhq.com/oauth/token` (form-encoded). Include `user_type` ("Company" for agency installs, "Location" for single account installs).
- Rate limit: burst 100 requests per 10 seconds, 200,000 per day, per app per resource. Handle 429 with backoff and read rate limit headers.

CHECK in docs (important, easy to miss):
- Agency installs give a Company-level token. To call contacts or opportunities for a specific client account, mint a location token with `POST /oauth/locationToken` (companyId + locationId). The community starter repo uses this. Do not assume the company token can read location data directly.
- Listing which client accounts have the app installed (`/oauth/installedLocations` or similar).
- Install page flow: `https://marketplace.gohighlevel.com/oauth/chooselocation?...` with `response_type=code`, `redirect_uri`, `client_id`, `scope`.

Reference starters (read them, do not copy blindly):
- https://github.com/GoHighLevel/ghl-marketplace-app-template (official, Node/Express, includes SSO)
- https://github.com/malikyousaf-0/gohighlevel-oauth-starter (TypeScript, rotation-safe refresh, signed webhooks)

SSO and embedding:
- The app runs in an iframe through Custom Pages. GHL passes encrypted user context to the iframe via postMessage; decrypt it server-side with the SSO key. CHECK the SSO docs for the exact message names and decryption method.
- Do not use NextAuth, Clerk, or our own login for the embedded app. Identity comes from GHL SSO.
- Framing headers: allow embedding from GHL domains. Many white-label agencies use their own custom domains, so a strict allowlist can break real customers. Decide an approach (for example `frame-ancestors https:` plus SSO verification), tell me the tradeoff, and record it in DECISIONS.md.

Webhooks: verify the signature on the RAW request body (GHL signs webhook payloads, reportedly Ed25519 in the `X-GHL-Signature` header, CHECK). Acknowledge fast, process via a queue/job.

On uninstall: stop syncing and delete that agency's cached data and tokens.

---

## 8. BILLING AND PRICING

VERIFIED from GHL materials:
- GHL Marketplace has native billing. Agencies (and optionally sub-accounts) pay inside the GHL platform. It supports free plans, paid plans, free trials, and usage-based pricing. GHL takes a 15% revenue share. Developer payouts go through Tipalti, monthly, on the 15th for the previous month's earnings.
- Therefore do not build external billing for marketplace installs. Do not add Lemon Squeezy or Stripe for this.

Decision: start at $3 per client account per month, with a free tier up to 5 client accounts. Net to us at $3 is about $2.55 after GHL's 15%. We will revisit after the first 10 paying agencies.

Your job at pricing time:
- Read https://help.gohighlevel.com/support/solutions/articles/155000001217-set-up-your-marketplace-app-pricing and the pricing section of the developer form.
- Propose how to represent "free up to 5 client accounts, then $3 per account" inside GHL's pricing model. If the marketplace cannot express a free allowance on a per-account plan, propose the nearest option (for example a free plan plus a paid plan, with limits enforced in our app). Tell me clearly what is not possible.
- Enforce plan limits in our own code, not just in the listing.
- Free trial: propose 14 days.
- Do not go Public until pricing, privacy policy, and terms are done.

---

## 9. DATABASE GUIDANCE (suggestion, improve it)

Tables (names flexible):
- `installations`: company_id (unique), encrypted access_token, encrypted refresh_token, token_expires_at, plan/limits, installed_at, uninstalled_at
- `locations`: installation_id, location_id, name, email, phone, timezone, last_synced_at
- `cached_contacts`: installation_id, location_id, contact_id, first_name, last_name, email, phone, tags[], date_added, last_activity_at, synced_at
- `cached_opportunities`: installation_id, location_id, opportunity_id, pipeline_id/name, stage_id/name, contact_id/name, monetary_value, status, last_stage_change_at, last_status_change_at, synced_at
- `sync_jobs`: installation_id, location_id, type, cursor, status, error, started_at, finished_at
- `settings`: installation_id, stale thresholds and other preferences

Security requirements:
- Enable RLS on every table. All access happens server-side with the service role. No public policies.
- Encrypt tokens at rest (Supabase Vault or app-level AES-GCM). Never log tokens.
- Data minimization: store only the fields features need. This is other businesses' customer data.
- Add indexes for search (email, phone, name; consider trigram search for names).
- Write the schema as migration files in `supabase/migrations/`, not by hand in the dashboard.

---

## 10. SYNC ENGINE REQUIREMENTS

- Cross-account search cannot be done live. Calling every account on every keystroke would blow the rate limit. Cache in Supabase and serve search from the cache.
- First sync: page through each account's contacts and opportunities with a queue, respecting 100 requests per 10 seconds, resumable if it fails halfway (cursor in `sync_jobs`).
- Keep fresh using webhooks for contact and opportunity changes (if available) plus a periodic reconciliation sync. Show "last synced" in the UI.
- Estimate storage for a large agency (for example 30 accounts x 20,000 contacts) and tell me if the free Supabase tier will not hold it.
- Vercel function time limits and cron limits apply. Long syncs must be chunked and resumable. Tell me which Vercel plan the sync design needs.

---

## 11. HOSTING AND COST REALITY (tell me before launch)

As far as I know, and CHECK current terms on the pricing pages before launch:
- Vercel Hobby (free) is for non-commercial use and has tight cron and function limits. We can develop on it, but before charging real customers we likely need Vercel Pro.
- Supabase free projects can pause after inactivity and have small storage limits. A live paid product should be on Supabase Pro.
- Realistic launch infrastructure cost is roughly $45 per month, not $0. Confirm the real numbers and tell me.

---

## 12. KNOWN API LIMITS TO RESPECT

- Workflows API v3 is limited availability. Quote from GHL docs: it is "currently enabled for selected sub-accounts only; any other sub-account receives 403 WORKFLOW_API_NOT_ENABLED_FOR_LOCATION". Any workflow feature must handle 403 gracefully and show "not available for this account", never fail silently or guess.
- Some UI features have no API. Do not promise a feature until you have confirmed the endpoint exists and works with our scopes.
- GHL audit logs only keep 60 days. If we ever want change history, we must record it ourselves from the day of install.

---

## 13. KICKOFF

Start now with Step 0 and Step 1. Tell me what I need to log into. Then move through the steps in order, stopping at Step 4 so I can complete the developer portal setup with you.
