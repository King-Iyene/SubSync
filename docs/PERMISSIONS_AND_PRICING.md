# Who sees what, how they get in, and how to price it

> **Pricing in this document is superseded (31 Oct 2026).** Master Brief v3 (`CLAUDE.md`, section 6) decides:
> Freemium, a Free Plan at $0 and ONE paid plan, Pro, at **$9 per client account per month**, 14 day trial,
> installable by everyone. Where this document says flat $5, no free plan or no locked features, v3 wins. The
> sections on who sees what and on permissions still hold. Steps for the portal are in the section "Before any
> outside agency installs" at the end of this file. Nothing needs to change in the portal while we are building.

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

## 3. Pricing: one flat price, everything included (decided 30 Oct 2026)

SubSync is **$5 per client account per month, with a 14 day free trial, no tiers, no free plan and no locked features**. The code
reflects this: every feature is open for every install, and there is no billing code at all, because the marketplace collects the money.

How the marketplace bills (from its documentation):

- The app's target is **Sub-account** and cannot be changed. It is billed **per install**, so an agency with 20 clients pays for 20 installs and a business pays for its own one.
- **Differential pricing** lets an agency charge its own client more than it pays you: you charge the agency $5, the agency charges the client $15 to $29 (its choice) and keeps the difference. The marketplace does that billing. This is what turns SubSync from a cost into income for the agency.
- The marketplace keeps 15% (about $4.25 of each $5 reaches you). Payouts are monthly.
- Tiered pricing by number of accounts is not possible on a sub-account app, which fits the flat model.

What an agency earns at $15 per client:

| Clients | Agency pays | Agency charges | Agency keeps |
| --- | --- | --- | --- |
| 5 | $25 | $75 | $50 |
| 10 | $50 | $150 | $100 |
| 25 | $125 | $375 | $250 |
| 50 | $250 | $750 | $500 |

**Raising the price later** is a change in the developer portal only (for example to $7 after 500 installs; existing installs keep the price they started on). No code change.

### What the portal looks like right now, and what has to change (you do this; I have not touched billing)

Read on 30 Oct 2026: the app is set to **Freemium**, with a "Free Plan" ($0, plan id `6ae40eb4f65e3c03823476b8`) and "Pro" (monthly $5, plan id `6ae42703f65e3c03823bb53b`), and no billing meters. To match the decision above:

1. Developer portal > SubSync > **Pricing**.
2. Change "Is your app free or paid?" from Freemium to **Paid**.
3. Keep one plan, **Pro, Monthly, $5**. Remove the Free Plan. (Deleting a plan is permanent, so this is yours to click.)
4. Set the free trial to **14 days**.
5. Turn on **differential pricing** (the setting that lets an agency set its own client price) if the portal shows it for your app type.
6. Save.

The app does not read plan ids any more, so changing the portal plans will not break anything. Existing test installs keep working.

## 4. Permissions (scopes)

Requested now (30 Oct 2026, saved on the draft in the developer portal): `locations.readonly`, `contacts.readonly`,
`opportunities.readonly`, `calendars.readonly`, `conversations.readonly`, `oauth.readonly`, `oauth.write`, and two new optional,
read-only ones: **`calendars/events.readonly`** (appointments) and **`users.readonly`** (real team names). Optional means an installer can
decline them and the install still works; the Appointments page then shows "needs approval".

An install made before these were added keeps its old permissions. To pick up the new ones, the account (or the agency) reinstalls from the
marketplace and approves. Nothing is lost by doing so.

Nothing writes to a client's CRM data. Meeting notes are stored inside SubSync only; "Copy note" puts a ready-made note on the clipboard.

Not requested yet, and what each would unlock (each is your call, because it changes what people approve):

| Scope | Unlocks | Cost of asking |
| --- | --- | --- |
| `contacts.write` (optional) | **Data cleanup can apply its changes** (phone numbers, name casing, bulk tags), and later one-click filing of meeting notes | Large: SubSync could then change client data. Every change is previewed, confirmed by typing the number, re-checked per contact, saved with its original value and can be undone. Without it the tool still previews, and says plainly that applying needs approval |
| `contacts.write` | Tidying duplicates inside the CRM | Large; not recommended: the platform has no safe merge call |

Note: sub-account installs must not ask for agency-only scopes. `oauth.readonly` and `oauth.write` are only used on the agency path; if the
platform ever rejects them for a business install, remove them from the app and keep agency installs on bulk install.

## 5. What every install gets

Everything. There are no tiers: Today, Appointments, Meeting notes, Data cleanup, Clients, Team, call lists, duplicates, exports, the AI connector and the rest are on for every install, and the agency's clients get the same pages in their own read-only view if the agency switches it on.

## 6. Selling it by industry

The global "Show only" filter and the industry playbooks let an agency sell one app to, say, twelve dental clinics and eight estate agents and
see each group on its own. Resale ideas that fit the paid tiers:

- **Clinics and dental groups:** "no-show recovery and recall" as a monthly add-on (appointments, no-show call list, recall list). Message text is never stored, which is the first question a clinic asks.
- **Estate agents and trades:** "lead response guarantee" (reply target of an hour or less, shown on the daily brief).
- **Boutiques and retail:** "win-back and birthday offers" (win-back call list, birthdays on the Leads page).
- **Any client:** the client view (read-only, their own account only) as a "your results dashboard", and the branded printable report as a monthly deliverable.

## Before any outside agency installs (the pre-pilot gate, from Master Brief v3 section 6)

Not needed while we build. Today the portal has a Free Plan at $0 and a temporary Pro at $5, and the app
unlocks everything for both, so your own testing is unaffected. Use the Free Plan for your own test installs
so nobody sits on the $5 plan. Do these, in this order, only when you are about to invite a pilot agency:

1. Developer portal, SubSync, **Pricing**. Keep "Freemium".
2. **Add a plan**: name "Pro", billing **Monthly**, price **$9** (per client account). A plan's price cannot be
   edited, which is why this is a new plan and not a change to the $5 one.
3. Give each plan honest feature lines. Only promise what is live on the day you do this. As of today that is:
   Free Plan: "Overview of every client account", "Contact search across client accounts", "Data health checks".
   Pro: "Everything in Free", "Appointment show-rate and no-show recovery", "Unanswered conversation inbox",
   "Call lists". Do not add Instant Audit, speed-to-lead alerts or the weekly email until they have shipped.
4. Keep the **14 day** free trial on Pro.
5. Send me the new Pro plan's id (it appears in the plan's row or the plan page). I add it to the entitlements
   table. Never paste anything secret.
6. **Delete the $5 plan.** Deleting is permanent and is yours to click. First make sure nobody is on it: only
   your own test installs should exist, and they should be on the Free Plan. CHECK with the platform what
   happens to an install that is still on a deleted plan; that is why it must be empty first.
7. I switch the app from "open" to "enforced", then run the entitlement tests and the tenant isolation tests.

What is not built yet on our side for this gate: the entitlements table, the open or enforced setting, and the
function that decides what each plan gets (`can(identity, feature)`). They are next, and they are the reason
this gate is closed. Cross-agency isolation, which the gate also names, is already tested on every full run.
