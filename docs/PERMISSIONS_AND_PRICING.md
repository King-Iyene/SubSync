# Who sees what, how they get in, and how to price it

SubSync is one app that three kinds of people can open. Most of your customers will be the
second and third kind (a business inside a client account), because an agency has many of them.

## 1. The three views

| | Agency user | Business owner (installed it themselves) | Client staff (agency switched it on) |
| --- | --- | --- | --- |
| Where it appears | Left menu of any client account the app is on | Left menu of their own account | Left menu of their own account |
| Sees | Every client account | Their own account only | Their own account only |
| Can change things in SubSync | Yes | Yes (their own settings, goals, call lists, checklist) | No, read-only |
| Pages | Overview, Accounts, Clients, Team, Search, Deals, Pipeline, Leads, Call lists, Inbox, Onboarding, Email health, Duplicates, Alerts, Settings | "My account" home, Team, Search, Deals, Pipeline, Leads, Call lists, Inbox, Onboarding, Email health, Duplicates, Alerts, Settings | "My account" home, Search, Deals, Pipeline, Leads, Inbox, Duplicates, Onboarding, Alerts |
| Never sees | n/a | Other accounts, the Clients page (fees, renewals, notes), agency controls | Other accounts, fees, notes, goals, exports, settings, API keys, call lists, the team page |

How it is enforced (not just hidden links):

1. The identity comes from the platform's encrypted sign-in message, decrypted on our server. The browser never says who it is.
2. The session we issue is signed and carries the view (`agency`, `business` or `client`) and the one account it is limited to. Editing it breaks the signature.
3. Every request is checked against an allow-list of routes for that view (anything not listed is refused), then every query is restricted to that one account.
4. A client view is re-checked on each request, so when the agency switches it off, access ends at once.
5. Automated tests cover this: `src/lib/__tests__/access.test.ts` and the "business view" and "client view" sections of `scripts/check-api.ts`.

## 2. How each person gets in

- **Agency**: installs the app for the agency (bulk install). Agency staff open it from inside any client account. This does not need a separate agency-menu app: the menu item lives in the client account's sidebar, and what you see depends on who you are, not where you click. An agency user always gets the agency view.
- **Business owner**: installs the app from the marketplace inside their own account. They get a token for that one account and only their own data is synced. Needs "Who can install" to include Sub-account (it does: both Agency and Sub-account are ticked).
- **Client staff**: nothing to install. The agency opens an account's page in SubSync and presses "Switch on" under "Let this client open SubSync", or uses Settings > Client access to switch on all. It is off by default.

If an agency user opens the app in an account that installed it for itself (and the agency has not installed it), they get that account's business view.

## 3. Pricing: how the marketplace bills, and what to set

Facts from the marketplace documentation:

- The app's target is **Sub-account** and it cannot be changed after creation. A sub-account app is billed **per install**, so an agency with 20 clients installed pays for 20 installs, and a business pays for its own one. Agencies can resell it with their own markup.
- The marketplace keeps 15%. Payouts are monthly (Tipalti).
- Tiered pricing by number of accounts (for example "up to 15 accounts for $29") is not possible on a sub-account app. It would need a second app with an Agency target. Not recommended until there is demand.

Recommended plans (price per client account per month, each paid plan with a 14 day trial):

| Plan | Price | What it unlocks |
| --- | --- | --- |
| Free | $0 | Overview / My account, contact search, onboarding checklist, settings. Agencies: up to 5 client accounts. |
| Starter | $9 | + health, stale deals, leads, inbox, pipeline, call lists, duplicates, email health, alerts |
| Pro | $19 | + Clients page and reports, exports, AI connector, Team, report builder |

Your saved portal plan is a single paid plan at $5 per account. Both work with the code; the
feature split lives in `src/lib/entitlements.ts`. Decide by how you want to sell:
the single $5 plan is simplest to explain to agencies; two paid plans earn more from the
businesses that use the call lists and pipeline tools every day. Whatever you pick, the price
itself is only a setting in the portal, never in code.

### Steps in the portal (you do these; I do not touch billing)

1. Developer portal > SubSync > Pricing: create the plans above (names must be exactly Free, Starter, Pro so they are easy to map).
2. After saving, open each plan and copy its plan id.
3. In Vercel > subsync > Settings > Environment Variables add `GHL_PLAN_IDS` with JSON like `{"<free id>":"free","<starter id>":"starter","<pro id>":"pro"}`. This is how a purchase turns into a tier.
4. When you are ready to charge, add `ENFORCE_PLANS` = `true`. Until then every install sees every feature (so testers are never blocked).
5. Re-deploy, then install on a test account and confirm the right tier shows.

## 4. Permissions (scopes)

Requested today (read only, plus the two used for agency installs): `locations.readonly`, `contacts.readonly`,
`opportunities.readonly`, `calendars.readonly`, `conversations.readonly`, `oauth.readonly`, `oauth.write`.
Nothing writes to a client's CRM data. Everything shipped in this round (sources, do-not-disturb,
birthdays, team, deal movement, timelines) uses these same permissions.

Not requested, and what they would unlock (each is your call, because it changes what people approve):

| Scope | Unlocks | Cost of asking |
| --- | --- | --- |
| `calendars/events.readonly` | Appointments: show rate, no-shows, bookings | Adds a line to every install approval |
| `users.readonly` | Real team names instead of typed ones | Small |
| `contacts.write` | Merging or tidying duplicates inside the CRM | Large: SubSync would then be able to change client data. Only with preview, confirmation and a saved snapshot |

Note: sub-account installs must not ask for agency-only scopes. `oauth.readonly` and `oauth.write` are only used on the
agency path; if the platform ever rejects them for a business install, remove them from the app and keep agency installs
on bulk install.
