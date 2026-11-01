# Decisions log

Format: date, decision, reason.

## 2026-10-28

- **Repo is `King-Iyene/SubSync`, made private.** It already existed (empty, public) when the build started; the brief calls for private, and CLAUDE.md is in it. Local folder is `C:\Users\KING\Desktop\SubSync`.
- **Commit and push straight to `main`.** King's standing instruction so Vercel auto-deploys on every push. No feature branches or PRs.
- **Next.js 16.4 (App Router, `src/`), React 19, Tailwind 4, shadcn/ui.** Latest `create-next-app` defaults. Its `AGENTS.md` says this Next.js has breaking changes, so read `node_modules/next/dist/docs/` before relying on older APIs.
- **GitHub CLI authenticated via device flow in King's logged-in browser tab.**
- **Supabase project `subsync` (ref `ugfvzcbkqnhtejgcqhsb`, East US / N. Virginia) on the FREE org "Vercel integration Base" for now.** King wanted to avoid the extra ~$10/mo a new project costs in the Pro org while building. Move to Pro before charging customers (Settings > Transfer project, or recreate and re-run migrations). Free projects pause after ~1 week idle and cap at 500 MB.
- **Project created with "Automatically expose new tables" OFF and "Enable automatic RLS" ON.** All access is server-side with the secret/service key; no RLS policies exist on purpose.
- **Migrations are applied with `supabase db push --db-url` using the DB password in `.env.local`**, so no `supabase login` is needed. The direct host `db.<ref>.supabase.co:5432` worked.
- **Schema (`20261028000000_init_schema.sql`):** installations, locations, cached_contacts, cached_opportunities, sync_jobs, settings. Contacts carry generated `full_name` and `phone_digits` columns with trigram indexes for search. Location tokens are minted on demand, not stored.
- **Secret key not yet in `.env.local`.** The browser tool was blocked from reading it, so King pastes it in or we add it to Vercel by hand.
- **Framing policy:** `/app` sends `Content-Security-Policy: frame-ancestors https:` so it can be embedded from any https origin (agencies use white-label domains, so a GHL-only allowlist would break real customers). Tradeoff: any https site could frame it, so identity and data access must rely on GHL SSO verification, never on the framing origin. Every other route is `frame-ancestors 'self'`.
- **Privacy and Terms pages are honest placeholders** (written 2026-10-28) and need human/legal review before going Public, because the app stores client contact data.
- **Vercel project `subsync`** (team "king-iyene's projects", Pro) imported from `King-Iyene/SubSync`, deploys on every push to `main`. First production deploy succeeded.
- **Production URL is `https://subsync-topaz.vercel.app`.** `subsync.vercel.app` belongs to someone else (redirects to azhardev.me), so never use it. Custom domain later.
- **Supabase env vars came from the Vercel-Supabase integration** (connected the `supabase-subsync` resource to the project, Production + Preview, marked Sensitive). It created `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `SUPABASE_JWT_SECRET` and the `POSTGRES_*` vars, so the secret key never passed through chat or local files.
- **Deployment Protection must be turned off for production.** Vercel Authentication currently puts the URL behind a Vercel login, which would block the GHL iframe and marketplace review. It is a security setting, so King changes it (Project > Settings > Deployment Protection).
- **Still to add in Vercel:** `NEXT_PUBLIC_APP_URL`, `TOKEN_ENCRYPTION_KEY` (generate at step 5), and the `GHL_*` values (step 4).
- **Logo:** hub-and-three-spokes mark, `public/brand/subsync-logo.svg` and `subsync-logo-512.png` (512x512, 18 kB). No platform names in it.

## 2026-10-29

- **Roadmap saved to `docs/ROADMAP.md`.** It matches the brief's phases except the DNS check, which King's roadmap lists in the Phase 1 onboarding checklist while the brief has it in Phase 4. Kept in Phase 4 for now: it needs external DNS lookups, not just the GHL API.
- **BLOCKER: the portal draft app has Target User = Sub-Account, and that field is locked.** The portal says "8 scopes unavailable, Target User is Sub-Account, so Agency-only scopes are not applicable." `POST /oauth/locationToken` needs the `oauth.write` scope and an Agency access token (checked in the GHL docs), so the brief's agency-level design needs an app whose Target User is **Agency**. Plan: create a new draft app with Target User = Agency and copy the settings over, then delete the old draft.
- **Portal fields saved on the current draft (to be redone on the new app):** Who can install = Agency only; listing type White-label (the portal's recommended default, differs from the brief's "Standard"; chosen because white-label agencies are the target customers); redirect URLs for production and localhost; scopes `locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `calendars.readonly`, `conversations.readonly` (all tagged Sub-Account in the portal, which is fine for location tokens).
- **Not done in the portal yet:** logo (needs a native file-picker click, file is `public/brand/subsync-logo-512.png`), Support Details (a support phone number is required and King has not given one), Getting Started / listing copy, Modules (Custom Pages and SSO), Client Keys.
- **Pricing model received from King (2026-10-29), needs one fix before use.** Agency app, buyer needs a $297+ GHL plan. Free: cross-account search + onboarding checklist for up to 5 client accounts. Paid: "$5/account/month, all features, unlimited accounts". King's examples (30 accounts = $90, 100 accounts = $300) are what **$3** per account gives; at $5 they would be $150 and $500. The brief (section 8) also says $3. **Open question for King: $3 or $5?** Until answered, the code treats price as a config value, not a constant.
- **Pricing differs from the brief in structure too:** the brief's free tier was "up to 5 accounts, all features"; the new model gates by feature (search + onboarding free, the rest paid) as well as by count. Plan limits and feature gating are enforced in our own code (`installations.plan`, `location_limit`), not just in the listing. Whether the GHL marketplace pricing UI can express "free tier + per-account paid tier" is still to check at pricing time.
- **Testing risk:** King's own agency is on the $97 Starter plan, and the new pricing assumes buyers on $297+. Agency-level private app install may be blocked on Starter, so plan on the sandbox account.
- **Pricing confirmed by King: $5 per client account per month.** The earlier examples (30 accounts = $90, 100 = $300) were wrong; at $5 they are $150 and $500. Net to us at $5 after GHL's 15% share is about $4.25 per account. Free tier: cross-account search + onboarding checklist for up to 5 client accounts. Paid: all features, unlimited accounts. The brief's old $3 figure is superseded.

## 2026-10-29 (correction)

- **CORRECTION: the BLOCKER above was wrong. Keep the ORIGINAL draft (Target User = Sub-Account); do not use an Agency-target app.** GHL's own distribution docs recommend Target User = Sub-account for ~95% of apps ("cannot be modified once set"). Agencies still install it, and an agency install returns a Company token with `isBulkInstallation: true`. The documented flow is then: list the locations where the app is installed, exchange the agency token for a location token per location, and listen to the AppInstall webhook for new installs. An Agency-target app is the wrong shape: the portal marks 167 Sub-Account-only scopes (contacts, opportunities, calendars, conversations) as unavailable for it, so it cannot read client account data at all.
- **The Sub-Account-target draft can select `oauth.write` ("Generate location access tokens for OAuth apps") and `oauth.readonly` ("View installed locations for an OAuth app").** Both are now ticked, so the app has 7 scopes: `locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `calendars.readonly`, `conversations.readonly`, `oauth.write`, `oauth.readonly`. It stays open to adding sub-account-level features later, which King wants. Unavailable on this app are the Agency-only scopes (companies, snapshots, custom menus, SaaS) which Phase 1 does not need.
- **Two apps named SubSync now exist in the portal.** Keep `6ae2a79309eaa881c1eb419e` (original, Sub-Account target). The one I created by mistake is `6ae2b7db6c40014528683d67` (Agency target) and should be deleted by King in the portal.
- **Who can install on the original draft is set to "Agency only".** Phase 1 features are agency features. When sub-account features ship, change it to "Everyone" (Target User cannot be changed, install scope should be).
- **Still unverified until a real install:** that the agency-install-then-locationToken flow works for a Sub-Account-target app with exactly these scopes, and whether King's $97 Starter agency can install a private agency app.

## 2026-10-29 (portal progress on app 6ae2a79309eaa881c1eb419e)

- **Saved in the portal:** Basic Info (name, tagline, company, website, categories Analytics & data + Data management, niche Advertising Agency, logo), Listing Configuration (Agency only, White-label), Auth (2 redirect URLs, 7 scopes), and a Custom Page module (id `6ae2ba1906a8b3d7612d0292`: title SubSync, placement Left menu navigation, icon `chart-area`, live URL `https://subsync-topaz.vercel.app/app`, testing URL `http://localhost:3000/app`, no mic/camera). Mandatory steps counter shows 1 of 5 (only Basic info counts so far).
- **Product tradeoff to decide:** for a Sub-Account-target app the only custom-page placement offered is "Sub-account left navigation menu". The SubSync dashboard will therefore open from inside a client account's left menu, not from the agency-level menu. It can still show agency-wide data, because our backend knows the agency from the SSO payload and holds a token for every installed location, but the user must be viewing it from a client account where the app is installed. An Agency-target app would offer an agency menu but cannot read contacts or deals (see correction above). Revisit if this feels wrong in a real install.
- **Blocked on assets King or the finished app must provide:** App Profiles needs at least three 16:9 preview images (min 640x360). Use real screenshots of the working dashboard, not mock-ups. Support Details needs a support phone number (King has not supplied one). Getting Started Guide is optional; write it once install works.
- **Revisit at go-live (King's note: some things change then):** production domain (custom domain instead of the `*.vercel.app` URL, which means updating the redirect URL, custom page URL, website and support URLs in the portal), Supabase moved to Pro, Vercel plan, price ($5 per client account), Privacy/Terms legal review, switching the app from Private to Public.
- **Support Details saved in the portal** (support email, documentation and support URLs, support phone, terms and privacy URLs). The phone number King supplied is intentionally not recorded in the repo. Remaining blockers for the portal's mandatory steps: App Profiles (three real 16:9 preview images) and Pricing.

## 2026-10-29 (install flow and dashboard shell)

- **Built the OAuth install flow.** `/api/oauth/install` redirects to the platform install screen (scopes in `src/lib/ghl/scopes.ts`, kept in sync with the portal). `/api/oauth/callback` exchanges the code at `/oauth/token` (form-encoded, `user_type=Company`, `redirect_uri`), encrypts both tokens with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`), upserts `installations` by `company_id` and creates the default `settings` row, then redirects to `/installed` or `/installed/error`. Only agency (Company) installs are accepted. Errors are logged without tokens, codes or bodies.
- **Built SSO identity.** `/app` asks its parent frame for `REQUEST_USER_DATA`; `/api/sso` decrypts the reply with `GHL_SSO_KEY` on the server (CryptoJS passphrase format: base64 "Salted__" + salt, AES-256-CBC, key and IV via EVP_BytesToKey/MD5) and returns only `userId, companyId, role, type, userName, activeLocation` plus whether that agency is installed. The email in the payload is deliberately dropped. Verified against a payload generated by real CryptoJS.
- **Tests:** `npm test` (node's built-in runner, 11 tests) covers token encryption (round trip, fresh IV, tamper, wrong key, bad key length) and SSO decryption. `tsconfig` allows `.ts` import extensions so Node can run them.
- **Migration `20261029000000_installation_token_fields.sql`** adds `scope`, `user_type`, `user_id`, `is_bulk_installation` to `installations` (applied).
- **Fixed a real styling bug:** shadcn's generated `--font-sans: var(--font-sans)` pointed at itself, so the entire site rendered in Times New Roman, including the already-deployed pages. It now uses the Geist font the layout loads.
- **`/app` framing is now `frame-ancestors 'self' https:`** (added `'self'` so the page can be framed from the same origin when testing locally).
- **Not done yet:** `TOKEN_ENCRYPTION_KEY`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SSO_KEY`, `GHL_REDIRECT_URI` and `NEXT_PUBLIC_APP_URL` are not set in Vercel, so installs and SSO return a safe "not configured" response in production until they are. The refresh-token rotation lock and the installed-locations sync are step 7.
- **Next:** a research pass on gaps in the platform's native tooling to extend the roadmap (King's request), then the sync engine.

## 2026-10-29 (research findings that affect the build)

- **Sync design:** the platform's rate limits are per app **per resource** (one location or one company), not shared, so per-account sync workers can run in parallel with a separate burst budget per client account. Read the `X-RateLimit-*` headers; the docs give no 429 guidance, so we add our own backoff. This corrects the brief's reading of "100 per 10 seconds" as a single shared budget.
- **Webhooks:** verify `X-GHL-Signature` (Ed25519) only; the legacy `X-WH-Signature` was deprecated on 2026-09-01. Handlers must be fast and idempotent because non-2xx is retried up to 12 times.
- **Roadmap proposals** from the research are listed in `docs/ROADMAP.md` for King's decision. No roadmap order was changed.
- **Roadmap decision (King, 2026-10-29): keep the order as planned.** Applied only the duplicate-finder narrowing (within one account) and the activity-based engagement flag. King then asked for deeper research that also weighs how hard each feature would be for GHL to build quickly (defensibility), not only whether customers would pay. That pass is tracked in `docs/FEATURE_RESEARCH.md`.

## 2026-10-29 (deep research results; full detail in `docs/DEEP_RESEARCH.md`)

- **CORRECTION: no 15% revenue share today.** The official pricing help article (modified 2026-06-23) says no commission is deducted and the developer receives the entire payment, "currently". Earlier notes that assumed 15% (net about $4.25 at $5) are superseded: plan on $5.00 gross, and model 15% only as a downside case.
- **Private apps are capped at 5 agencies** (installs blocked from the 6th, for apps created after 2025-11-18; sub-accounts and bulk installs count as one agency). Real growth needs a Public listing and marketplace review, so plan the Public submission earlier than the brief's final step.
- **Public listing needs** 3-6 real screenshots, a demo video including uninstall, a stated data-retention behaviour on disconnect, privacy and terms URLs, and a 24-hour support reply. Scope changes can trigger re-review: add the scopes we will need while still private, then freeze the list before submitting.
- **Unified inbox demand is weaker than first reported** (two posts, about 6 votes each). Keeping the roadmap order stands on firmer ground.
- **Login and user-activity data is unresolved:** one source says the API does not expose it, another notes a competitor sells login tracking. Engagement stays data-activity-based; test whether the Users API exposes last login.
- **Webhook event names are now confirmed** (see DEEP_RESEARCH section 7), including `LCEmailStats`, which is available only to location-level apps and fits our Sub-Account-target app.
- **To check before step 7:** the location-token endpoint path. One researcher cites `POST /oauth/location-token`, while our client and the official template use `/oauth/locationToken`. Confirm against the live API spec.
- **Pricing risk:** GoCSM (health scoring for these agencies) lists flat tiers that work out to roughly $1.60-$2 per account per month at 100 accounts, against our $5. Vendor claim, unverified. Overlap is partial; revisit tiered or flat pricing for engagement features before launch.
- **Workflow features are speculative:** the Workflows API is a closed beta enabled per sub-account (others get a 403) and execution logs are UI-only. Roadmap items 14-17 and any workflow-failure monitoring should not be promised.
- **Proposals from the deep research are listed in `docs/ROADMAP.md` for King's decision. No roadmap order was changed.**

## 2026-10-29 (King: "go with the best plan")

- **Roadmap updated** (`docs/ROADMAP.md`): dormant-account flag moved into Phase 1 (item 5); the DNS checker became a continuous email authentication and deliverability monitor and moved to Phase 3; Phase 4 workflow items marked speculative; Public listing milestone placed right after Phase 1, with Phase 1 run as a private pilot of up to 5 agencies. **Pricing was not changed:** King still decides $3 vs $5 vs tiers against GoCSM, and price stays a setting, not a constant.
- **Location-token path confirmed from the published spec:** `/oauth/locationToken` (our path was right; the other spelling was only a docs URL slug). The spec says the body is **form-encoded**, so the client now form-encodes it instead of sending JSON. `/oauth/installedLocations` needs `companyId` and `appId` (both required) and the `Version: 2021-07-28` header, and returns `{ locations: [{ _id, name, address, isInstalled, versionId, installedAt }], count }`.
- **New env var `GHL_APP_ID`** (the marketplace app id; non-secret; value `6ae2a79309eaa881c1eb419e`, set locally, still to be added to Vercel).
- **Refresh-token rotation is now safe** (`src/lib/ghl/token-manager.ts`): refresh when within 5 minutes of expiry, save the rotated token with a compare-and-swap on the stored refresh token, and if a refresh fails or loses the race, re-read the row and use the winner's tokens. Residual risk: if GHL accepts a refresh but our database write then fails, that rotated token is lost and the agency must reinstall. Acceptable for now; revisit if it shows up in logs.
- **Request backoff** (`src/lib/ghl/http.ts`): retries 429 and 5xx with exponential backoff and jitter, honours `Retry-After`, and exposes `X-RateLimit-*` header parsing. The docs give no 429 guidance, so this is our own policy.
- **Install now also pulls the list of client accounts** (`src/lib/sync/sync-locations.ts`): after saving the install, the callback lists installed locations (paged) and upserts them into `locations`. It is best effort: a failure is logged and does not fail the install. Not yet exercised against the real API (needs the keys).
- **Tests:** 29 unit tests (`npm test`), covering encryption, SSO decryption, token refresh including the race cases, backoff and paging.

## 2026-10-29 (overnight build, King asleep: "build all the features")

- **Database access** switched from the Supabase REST client to direct SQL (`postgres` with `prepare:false`, pooled URL). RLS stays on with no policies, so only the server can read or write. Reason: joins, `FOR UPDATE SKIP LOCKED` for the sync queue, and fewer round trips.
- **Sessions:** the dashboard signs in through the host app's postMessage handshake, the server decrypts the SSO payload, and returns an HMAC-signed Bearer token kept in memory only (no cookies in the iframe). **Agency users only**; account-level users are refused.
- **Sync design:** `sync_jobs` queue, time-budgeted slices, cron every 5 minutes, metrics snapshot job last so history is consistent. Daily full refresh.
- **Scoring is explainable by design:** five components, each with a plain-language reason. No black-box number.
- **AI connector (MCP):** read-only, hashed `sk_subsync_` keys, 5 per agency, 60 requests a minute, paid feature. Chosen because it is hard for the platform to copy quickly and costs us little.
- **Free plan gating exists but is off by default** (`ENFORCE_PLANS=true` enables it) so testing is not blocked. Price stays a setting.
- **Demo mode** (`DEMO_MODE=true`) seeds 14 fictional accounts for screenshots and the portal video. Must stay off in production.
- **Data deletion:** Settings "Delete my data" requires typing `DELETE`; uninstall purges everything. Blocked in demo.
- **Lead-flow alert** thresholds (50% drop, baseline of at least 10, at least 7 days of history) are my defaults; tune from real data.
- **Unverified against the real platform** (listed in `MORNING_CHECKLIST.md`): contact endpoint field names, SSO `type` value for agency users, bulk-install token flow, Starter-plan install, Users API last login, conversation "waiting" detection.
- **Tests:** 79 unit tests, a DB integration check and an HTTP integration check (including the AI connector end to end) all pass.

## 2026-10-29 (production address)

- **Our production address is `https://subsync-topaz.vercel.app` (King confirmed; the earlier team-scoped address was a protected alias).** `https://subsync.vercel.app` belongs to someone else (it redirects to another site); never put it in the portal or env vars. Plan a custom domain before going Public.
- The topaz address is public (no login wall). Install and SSO return 503 until the GHL env vars are added. Step-by-step: `docs/LAUNCH_GUIDE.md`.

## 2026-10-30 (custom domain)

- **Production address is now `https://subsync.kdsquares.com`** (CNAME at GoDaddy to Vercel, added to the Vercel project as a Production domain). The old `subsync-topaz.vercel.app` address still works as an alias but must not be used in the GHL portal.
- Changed: Vercel `NEXT_PUBLIC_APP_URL`, and in the GHL portal the redirect URL, webhook URL, Custom Page URL and the support/privacy/terms links. The OAuth redirect address is built from `NEXT_PUBLIC_APP_URL`, so that is the only variable that changes on a future move.
- **Lesson:** the portal's Test Link uses the FIRST redirect URL on the list. A leftover `http://localhost:3000/...` entry sent the first test install to localhost (blank page). Keep only live redirect URLs in the portal.
- Vercel needs an email code to reveal a stored variable; to change a value, delete and re-add it.

## 2026-10-30 (first real install, verified)

- **First real install worked end to end** on the KD Squares Test sub-account: OAuth callback saved the agency and tokens, SSO opened the live dashboard inside GHL, and a sync pulled structure, contacts (332), opportunities (189) and conversations with no errors.
- **Fact learned:** the platform's installed-locations list can be empty for a few seconds after an install, so the first sync found 0 accounts until "Sync now". Fix: `scheduleDailyRefresh` now retries every 3 minutes for any install that still has no client accounts.
- **Fact learned:** the portal's Test Link installs on a single sub-account (a location install), and the final handoff opens our site in a new tab; automated browsers block that pop-up, so a person must click the last Confirm.
- Assumptions now confirmed: the `type === "agency"` SSO check, the contact/opportunity endpoints and field names, the oauth.write and oauth.readonly scopes, and the Starter-plan private install. Still unverified: bulk install across several sub-accounts, the Users API last login, uninstall webhook purge.

## 2026-10-30 (pricing set up in the portal, draft)

- **King confirmed $5 per client account per month.** Portal pricing is Freemium: **Free Plan ($0)** and **Pro ($5 monthly)**, plus a **14-day free trial**. Saved on the draft version; nothing is charged until the app is published.
- **For testing, free and paid give the same access:** `ENFORCE_PLANS` is unset, so every feature is open. Turn it on (`ENFORCE_PLANS=true` in Vercel) only when the free plan should be limited to 5 client accounts and the core views. The portal cannot express "free for the first 5 accounts", so our app enforces that limit.
- The Free Plan row cannot be edited after saving (no feature text). Cosmetic only.
- **Open:** payout account setup (King, GHL's payout provider), and the price against GoCSM (revisit after the first 10 paying agencies).

## 2026-10-31 (Master Brief v3 adopted, Wave 0)

- **`CLAUDE.md` is now Master Brief v3 (including section 13A).** The earlier v2 brief, and the feature encyclopedia, moved to `docs/reference/` as background. Where they disagree, v3 wins. The encyclopedia is an idea bank, not a to-do list: sections 2 to 14 of it were never built and are not planned. Only appointment insights (its section 1) shipped, and that matches Wave 1 item 2.
- **Feature switches live in the database** (`feature_flags`, code in `flags.ts` and `flags-core.ts`). A switched-off feature disappears from the menu and its API answers 404; its public addresses go dead too. Code and data are kept. A row in the table overrides the default either way, so turning one on needs no deploy. Off by default: reports (QBR, compare two), builder, meeting notes, data cleanup, AI connector, compare setups, industry playbooks, connections (Slack, Fathom, Zoom sign-in), duplicates, clients, team, leads. Reason: none is in Wave 1, several are listed under "defer" or "avoid" in sections 7 and 8, and 13A names Duplicates and Data cleanup as DEFER. `FLAGS_ALL_ON=true` flips only the defaults and is used by the automated checks. Not hidden: Settings keeps the manual Slack web address for alerts and the daily brief.
- **Tension to know about:** Slack, Fathom and Zoom sign-in and Data cleanup were built at King's request before v3 arrived. v3 says avoid an integration connector catalog and does not list Data cleanup. They are switched off, not deleted; the setup guide `docs/CONNECTIONS_SETUP.md` stays valid if they are wanted later.
- **Pricing:** v3 says Free plus one Pro plan at $9 per client account, with a `plan_entitlements` table and `ENTITLEMENTS_MODE` (`open` or `enforced`). Today the code behaves as `open` (everything unlocked, one plan). The table, the mode setting and the `can(identity, feature)` function are not built yet. They are required before any outside agency installs (pre-pilot gate) and need King's portal steps first (add Pro at $9, delete the $5 plan).
- **Event store:** `deal_events` already recorded deal changes. Added `appointment_events` (first seen, status change, move of a minute or more), written during the appointment sync. First reads of an account record nothing. Nothing reads these tables for a screen yet. First-response times and conversation assignment are not recorded yet.
- **Tenant isolation test** (`scripts/check-tenancy.ts`): two real agencies in the database, 384 cross-reads across every read route as agency, business, client and forged sessions, and write attacks. Passes. It runs with the other checks on every full run.
- **White-label links:** one helper (`links.ts`) builds every "open in your CRM" link from the agency's own domain, taken from the sign-in details unless the agency typed one. The platform's own domain is only the fallback. An automated scan fails the build if any screen, email, message or tool text names the platform.
- **Overview numbers:** dollar figures count only deals with a value and an owner (and say how many were left out); a win rate and the two estimates need 20 closed deals; estimates are labelled and show their formula; one fact, one tile; at most six tiles. Per-stage stale thresholds are NOT done: they need stage history from the event store. See `docs/METRICS.md`.
- **Gaps against v3 section 5 that are not fixed:** one Supabase project serves development and production (v3 wants two); no error tracker and no errors table yet; no `plan_entitlements`; no data-access audit log screen (the `audit_log` table records changes only).

## 2026-10-31 (research checklist, section 13)

- Results are in `docs/RESEARCH.md`. Confirmed: all webhook event names including `PlanChange`; the 100 per 10 seconds and 200,000 per day limits; the messages scope and fields (so speed-to-lead can tell a person from automation); the Users API fields for staff access; the commission wording (none); trial rules. Not found in public docs: free plan with per-account billing, card on file on bulk install, editing "Who can install" after saving, per-location usage data, the installer details endpoint name.
- **Open questions only King or the platform's support can answer:** (1) does a free plan work together with per-account pricing and bulk install, (2) what happens to accounts without a card on a bulk install, (3) can Who can install be changed after saving, (4) the exact scope name for installer details, (5) the real commission, from the Earnings page or the developer terms.
- Our location-token call uses the older spelling `/oauth/locationToken`; the docs show `/oauth/location-token`. Kept as is because it is proven on the live install.
- The project folder on this machine was found empty at the start of this step and was restored by cloning the repository at its latest commit. Secrets (`.env.local`) are not in the repository, so local checks that need the database cannot run here until that file is put back.

## 2026-10-31 (plan entitlements built, still in open mode)

- **Built:** `plan_entitlements` (plan id to tier), `install_plans` (the plan each account is on, from `AppInstall` and `PlanChange` events), `ENTITLEMENTS_MODE` (`open`, the default, or `enforced`), and one decision function `can(feature, tier, mode)` in `entitlements-core.ts`. The API answers 402 for a feature outside the plan and the menu shows it with a Pro note; features switched off by flag still answer 404 and disappear. Free keeps overview (which carries the daily brief), contact search, data health and settings; everything else needs Pro. An unknown or missing plan id counts as free. An agency counts as paid when at least one of its accounts is. A demo install is always paid.
- **Nothing changes for anyone today.** The mode is open, so every feature stays unlocked, and the new tables are only read in enforced mode. Plan events are recorded when they arrive; a failure to record never blocks an install.
- **The migration `20261031090000_entitlements.sql` has NOT been applied to the live database** (this machine has no database credentials, and the project folder was restored from GitHub without `.env.local`). Apply it before enforcing. Until then recording a plan quietly does nothing.
- **Not tested end to end:** the unit tests cover the decision logic (5 tests). The database parts and enforced mode were not run, because there is no database here. Run them with the full suite once credentials are back, then simulate installs with different plan ids before switching to enforced.
- **Payload fields for `PlanChange` are unconfirmed** (names read from the docs index only). The reader accepts `planId` or `newPlanId`, top level or under `data`. Check against a real event.
- **Swapping a plan:** `node --env-file=.env.local --import tsx scripts/set-plan.ts <planId> <free|pro>`. Pre-pilot gate steps 3 and 4 are now: run that for the new $9 plan id, then set `ENTITLEMENTS_MODE=enforced` in Vercel (King's click) and run the full suite.

## 2026-10-31 (entitlements applied and tested)

- **Correction to the entry above:** the project's real folder is `C:\Users\KING\OneDrive\Desktop\SubSync` (OneDrive redirects the Desktop). The empty `C:\Users\KING\Desktop\SubSync` seen earlier is a different, empty path, so nothing was lost and `.env.local` was never missing. Work happens in the OneDrive folder.
- **The entitlements, flags, events and domain migrations are applied to the live database.**
- **Enforced mode is tested end to end** (`scripts/check-entitlements.ts`, real non-demo installs, simulated plan ids): the free list works, everything else answers 402, re-mapping a plan takes effect at once, an unknown or missing plan id fails closed, a paid account unlocks its agency and a downgrade locks it again, two agencies do not affect each other, the demo stays unlocked. It needs `ENTITLEMENTS_MODE=enforced` on the server, so it is run on its own and is not in the default run: `ENTITLEMENTS_MODE=enforced CHECKS=check-entitlements node --env-file=.env.local scripts/with-dev-server.mjs`.
- **Production is still in open mode.** The only things left before enforcing are the ones that need the portal: the $9 plan and its plan id, then `set-plan.ts`, then `ENTITLEMENTS_MODE=enforced` in Vercel.

## 2026-10-31 (research file read; Instant Audit built; scopes published)

- Read `SubSync_Competitive_Intelligence_AllTheApps.md` in full. Its conclusions are already the plan in the v3 brief: the gap is sales-floor operations (speed to lead, appointment hygiene, setter performance, stage history, anomaly alerts) for appointment-driven agencies, delivered as alerts and queues rather than reports; reporting and white-label PDFs are a commodity; the competitor wins on breadth and human onboarding and loses on complexity and 165 permissions. Not adopted: breadth.
- **Built the account audit** (Wave 1 #5, the onboarding hook the research calls the best sales asset): stale deal money (a counted fact), slow follow-up (a labelled estimate, never added to the fact), unmarked appointments, unrecovered no-shows, thin contact records, deals left out of totals, each with what to do and where to start. Free tier. A paste-able summary and print. Facts and estimates are kept apart by design; the page says "Not enough data" rather than inventing a figure.
- **Scopes:** published version 2.0.0 with 12 new optional scopes (read and verified-change). See `SCOPE_PLAN.md`. Change scopes are only ever used behind a preview, typed confirmation, snapshot and undo; messaging and user management are deliberately excluded.

## 2026-10-31 (King: build the sellable version, batch 1)

- King asked for everything built-but-off to be switched on and for the 184-feature list to be built in batches. Defaults now: only `connections` (provider apps not created) and `ai` (no screen) are off. Rollback is a flag row, not a revert.
- Batch 1 findings: inbox aging buckets, smart call queues (new leads, hot leads, no-show recovery, stale proposals) and stage dwell already existed, so they were not rebuilt. Built: weekly Monday email (needs `RESEND_API_KEY` and `EMAIL_FROM`; address set in Settings; hourly cron `/api/cron/weekly`), per-person first-reply time and show rate on Team (minimums 3 replies, 5 outcomes), roadmap with voting, dark shell with agency name and colour, per-account client access switches.

## 2026-10-31 (night, King asleep)

- King asked for meeting notes to also be written into the matched contact in the CRM. Built (`meeting-crm.ts`): once per meeting, claimed before writing so repeat deliveries cannot duplicate, capped at 8,000 characters, never throws, setting `push_notes_to_crm` (on by default) in Settings. Brief section 0 says writes only behind a preview; this is the one deliberate exception, on King's explicit instruction. Home page and in-app help wording were corrected to say so.
- Privacy policy and terms do not yet mention that SubSync writes a meeting note to a contact. A human must review and update them before going Public.
- Call recordings: not built. A one-off log of call message field names was added so the build uses the real shape. Look for "probe: call message fields" in the production logs after the next sync.
- Sync queue now runs appointment and speed jobs first, and the cron works for four minutes per run.

## 2026-10-31 (new Master Brief v3 saved, buyer and UX review plan saved)

- `CLAUDE.md` replaced with the updated Master Brief v3 (adds 1A the "smoke detector" thesis, 2A releases and versions, 13B GHL review standard). `docs/BUYER_AND_UX_REVIEW.md` saved from King's file.
- `docs/READINESS_AND_TEST_PLAN.md` is referenced by the brief and the review plan but does not exist in the repo yet. Not invented; King to supply it, or ask for it to be written.
- Where the new brief and what was built or asked since disagree, recorded here so nothing is silent:
  - Brief 1A and section 8: read-only by default, never message leads. Built: meeting summaries are also written into the matched contact's notes (King's explicit instruction, 31 Oct, with a switch in Settings, default on). This is an internal note, not a message to a lead.
  - Brief 13B: internal terms ("agency", "sub-account", "location") must not appear in end-user-facing content, and the UI label "Agency view" must be renamed. The app still says "Agency view" and uses "agency" in places. To be listed in the COPY_AUDIT and fixed.
  - Brief 14: "do not add features not listed here without asking". King has since asked for more (the 184-feature list in batches, real-estate source targets, shareable audit link, 15-minute refresh). Treated as King's instruction; each is flagged and reversible.
  - Brief 2A: a push to `main` goes live for every install at once. Followed: unfinished work stays behind flags, and a full production build now runs before each push.

## 2026-10-31 (runbook saved)

- `docs/RUNBOOK.md` saved from King's file. One stage at a time, STOP after each, wait for King's NEXT. `CLAUDE.md` wins where they disagree.
- Still missing from the repo: `docs/READINESS_AND_TEST_PLAN.md` (referenced by the brief, the review plan and the runbook).
- Where the repo already differs from what the runbook assumes (to settle at S0.1): tests run with Node's own test runner (283 tests), not Vitest; there is no Playwright suite; a demo tenant and a `DEMO_MODE` flag already exist; feature flags, `ENTITLEMENTS_MODE` and tenant isolation tests (384 cross-reads) already exist; there is no `APP_MODE=maintenance` kill switch, no `npm run verify` or `npm run e2e`, and no `docs/PROGRESS.md` yet.

## 2026-10-31 (runbook stage S0.1)

- Vitest for new tests, Node's runner kept for the 283 existing ones; `npm run verify` runs both. Reason: rewriting working tests adds risk and no customer value.
- Demo allowed only when `DEMO_MODE=true` and neither `NODE_ENV` nor `VERCEL_ENV` is production. Preview builds (NODE_ENV production) therefore have no demo. Reason: runbook S0.1.
- Kill switch `APP_MODE=maintenance` stops queuing, the worker, crons, sign-in and data calls but deliberately leaves install and uninstall webhooks working, so an uninstall during maintenance still deletes data.
- Fixed a phone and tablet overflow found by the first browser run: `min-w-0` on Card and an explicit one-column base on every responsive grid.
- Installed Vitest with `--legacy-peer-deps` (peer conflict on `@types/node`). To be resolved by upgrading `@types/node` to 22 or later.

- (S0.1 incident) First push failed on Vercel: dependency peer conflict hidden by `--legacy-peer-deps`. Fixed by upgrading `@types/node` to 24. Rule added: any stage that changes dependencies must pass `npm install --dry-run` (no flags) before pushing.

## 2026-10-31 (runbook stage S0.2)

- Role comes only from the decrypted SSO payload (`deriveIdentity`); five roles. Reason: runbook S0.2 and CLAUDE.md 4.1.
- Agency staff are refused until the Users API can prove which accounts they may open. Reason: default deny; showing every account was a cross-tenant leak inside one agency. Cost: pilot agencies with staff need the owner to open it first.
- Account users get the read-only client session even when their business installed the app. Reason: brief 4.1 (no settings or plan information).
- One list of tenant tables (`src/lib/tenant-tables.ts`) drives uninstall and delete; a schema-drift test fails when a table is unclassified. Kept on uninstall: `audit_log`, `install_plans`, `identity_log` (no customer contacts, messages or credentials).
- Errors are logged through `safeError`, which strips row values, emails, phone numbers and token-like strings.
- Unknown share ids render not-found content with HTTP 200 (soft 404). Accepted for now; no data leaks. Revisit in F6.
- gitleaks is not installed; a value search plus shape search over the full history is used instead. Installing it needs King's yes.

## 2026-10-31 (runbook stage S0.3)

- One link helper, `crmUrl(source, path)`: domain typed in Settings, then the sign-in domain, then the default host only when neither exists. The path cannot change the host.
- "Agency" becomes "company" in all in-app text, emails, errors and install pages; "Agency view" becomes "All client accounts"; "location" becomes "account". Public pages that address agencies as their audience (home, privacy, terms, support) may still say "agency".
- The banned-terms test reads the code's syntax tree (strings, template text, page markup) instead of lines, so multi-line text is caught and queries, comments and identifiers are not. Two narrow machine-only exceptions are listed in the test.
- King (31 Oct 2026): stop waiting for PASS or NEXT between stages. Evidence and King's 5 checks are still written for each stage; stages proceed in runbook order.

## 2026-10-31 (runbook stage F1)

- Open pipeline means counted open deals (value above 0 and an owner) on every screen; the Pipeline screen no longer sums every open deal. Deals left out are counted and explained on screen. Reason: Pipeline said $2.4M while Overview said $1.0M for the same accounts.
- One minimum of 20 closed deals for every win rate and anything built on one (account, all-accounts Pipeline, team member, deals view, forecast). The older minimum of 5 is gone. Reason: "50%" from 3 won and 3 lost was shown as a forecast basis.
- Outlier note at 50% of a dollar figure with at least 3 deals.
- The existing "Hide test accounts" switch is kept; no second test-account rule.
- Leads "Quiet over 90 days" is hidden until contact activity is synced (none of the 103,404 synced contacts has any), because it only measured how long ago contacts were added.
- Currency is not stored; dollar figures say "as entered in each account". Storing currency at sync is an open issue.

## 2026-10-31 (runbook stage F2)

- Lead rules live in `lead-rules.ts` and are stored on each lead (`excluded`, `clock_start`) after every speed sync, so every reader agrees. Reasons in order: bulk import, spam, test, do not contact, duplicate.
- Business hours is a clock-start shift (next opening in the account's time zone, Monday to Friday), off by default. Reason: a business-minutes clock would need the same logic in SQL and in code; the shift covers the night and weekend leads that cause the false alerts. A lead that arrives in hours and is unanswered at closing keeps counting overnight.
- Facebook and Instagram lead forms are timed at 10 minutes and shown as their own source; messages to the page stay social at 60.
- example.com is not a test-contact signal (it is the placeholder in sample data).
- The real estate sample audit is a fictional published snapshot under the demo installation, created by a script; it is not a real customer's data.

## 2026-10-31 (runbook stage F3 and "do not hide pages")

- Appointment rules: invalid appointments are in no figure; a claim about change needs 10 recorded outcomes (rates) or 10 bookings (volume) in the earlier period; group events are not clashes; "same day" uses the client account's time zone.
- King asked that no page be hidden. Nothing is switched off by default now (the AI assistant connector was the last). The runbook's F5 step "hide the Overview page" is not done: Overview stays in the menu. The only pages not shown are the ones a client account's own staff must not see (Settings, Accounts, Clients, Team and similar), which is a security rule, not a feature switch.
- The sidebar keeps Settings, Getting started and What's new pinned under the scrolling sections, because the lower items looked hidden on a short window.

## 2026-10-31 (runbook stage F6)

- Share links last 14 days, can be switched off by the installation that made them (and only by it), count opens, and are rate limited per address on the public page. Previews carry no name.
- The public page prints light and compact so it fits two pages on A4 and Letter.
- The demo installation holds the public sample audit; its links are never listed or switched off from the demo.
- Process (King, 31 Oct): fast and still accurate. Iterate with the one relevant test file or the quick mode of the tenancy script, run the full gates in the background while writing the next stage, and run the full suite once before each push and once at the end. Source edits are not made while a build or browser run is in progress.
