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
