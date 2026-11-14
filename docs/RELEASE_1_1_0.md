# Marketplace release: the one new version (called "1.1.0" in the brief)

Plain words. Written 11 Nov 2026, scope list updated 12 Nov 2026, from `src/lib/ghl/scopes.ts`, `src/lib/scope-groups.ts`, `docs/SCOPES.md`, `docs/SCOPE_PLAN.md`, `docs/NEEDS_KING.md`, `docs/features/PAYMENTS_BRIEF.md`, `CLIENTS_V2_BRIEF.md` and the code.

**Version number warning (INFERENCE):** the docs disagree on the live number (1.0.0 in CLAUDE.md, 2.0.0 published 31 Oct in SCOPE_PLAN, "2.1.0" and "2.2.0" in NEEDS_KING). Open the portal, read the live number, and call the new one the next number. Everything below says "the new version".

## 1. Scopes for this release

The app asks for 35 permissions today (7 required, 28 optional; five unused ones were removed on 14 Nov 2026, and the list includes conversations/message.write added 13 Nov 2026 for sending a text or email when a person presses Send): the 29-row table, the 3 Lead intake scopes, the 5 coming-feature scopes and 2 still-unused ones below. Against the 21 published in 2.0.0, **19 are new** (marked NEW; 15 in the table, 3 Lead intake, plus `locations/customFields.write`). The installed app has no workflows permission at all today. Anything already granted stays granted; only NEW ones make installs press Update.

Name check: the official scope page (marketplace.gohighlevel.com/docs/oauth/Scopes) loads with scripts, so it could not be read from here. "VERIFIED" below means a primary-source read recorded in our docs (SCOPE_PLAN, PAYMENTS_BRIEF); "INFERENCE" means not confirmed. Check each in the portal's scope picker: if the picker does not list it, do not tick it.

| Tick | Scope (exact) | R/O | Name | Used by (module) | If not granted the user sees |
|---|---|---|---|---|---|
| [ ] | `locations.readonly` | Req | VERIFIED | everything (names, time zones) | App cannot work |
| [ ] | `contacts.readonly` | Req | VERIFIED | Find lead, Data health, People queue | App cannot work |
| [ ] | `opportunities.readonly` | Req | VERIFIED | Pipeline, Audit | App cannot work |
| [ ] | `conversations.readonly` | Req | VERIFIED | Unanswered, Today | App cannot work |
| [ ] | `calendars.readonly` | Req | VERIFIED | Setup checklist, Appointments | App cannot work |
| [ ] | `oauth.readonly` | Req | VERIFIED | Finds installed accounts | App cannot work |
| [ ] | `oauth.write` | Req | VERIFIED | Mints one-account keys (changes nothing) | App cannot work |
| [ ] | `calendars/events.readonly` | Opt | VERIFIED | Appointments, no-show list | Needs permission: reconnect |
| [ ] | `users.readonly` | Opt | VERIFIED | Team names on lists (People, Unanswered) | Needs permission: reconnect; no names |
| [ ] | `conversations/message.readonly` | Opt | VERIFIED | True speed to lead, thread view | Needs permission: reconnect |
| [ ] | `calendars/groups.readonly` | Opt | VERIFIED | Calendar list under groups | Calendars without bookings missing |
| [ ] | `locations/tags.readonly` | Opt | VERIFIED | Hot-lead and cold-list rules | Needs permission: reconnect |
| [ ] | `locations/customFields.readonly` | Opt | VERIFIED | Meeting setup, custom fields | Needs permission: reconnect |
| [ ] | `contacts.write` | Opt | VERIFIED | Data cleanup, meeting notes, Find lead tag/note, call queue tag | Needs permission: reconnect; nothing is written |
| [ ] | `opportunities.write` | Opt | VERIFIED | Pipeline actions (stage, value, owner) after preview | Needs permission: reconnect |
| [ ] | `calendars/events.write` | Opt | VERIFIED | Mark showed / no-show after preview | Needs permission: reconnect |
| [ ] | `workflows.readonly` NEW | Opt | INFERENCE (Workflows API is limited availability) | Workflows page, setup check, and the automatic call queue workflow (section 1B) | Needs permission: reconnect |
| [ ] | `workflows.logs` NEW | Opt | INFERENCE | Failing/idle workflow checks | Needs permission: reconnect |
| [ ] | `workflows.write` NEW | Opt | INFERENCE | Rename/copy workflow after preview and confirm, and creating the call queue workflow (section 1B) | Needs permission: reconnect |
| [ ] | `workflows.publish` NEW | Opt | INFERENCE (NEEDS_KING says it may really be `workflows.write`) | Publish/pause after preview | Needs permission: reconnect |
| [ ] | `workflows.delete` NEW | Opt | INFERENCE | Delete with typed confirmation | Needs permission: reconnect |
| [ ] | `campaigns.readonly` NEW | Opt | INFERENCE | Campaign list and health | Needs permission: reconnect |
| [ ] | `emails/campaigns.readonly` NEW | Opt | INFERENCE | Same campaign list | Needs permission: reconnect |
| [ ] | `emails/stats.readonly` NEW | Opt | INFERENCE | Campaign delivery totals | Needs permission: reconnect |
| [ ] | `payments/transactions.readonly` NEW | Opt | VERIFIED | Payments: failed payments, refunds | Needs permission: reconnect |
| [ ] | `payments/subscriptions.readonly` NEW | Opt | VERIFIED | Payments: failed repeat payments | Needs permission: reconnect |
| [ ] | `invoices.readonly` NEW | Opt | VERIFIED | Payments: late invoices | Needs permission: reconnect |
| [ ] | `wallet.readonly` NEW | Opt | VERIFIED | Credit balance warning (Clients, Payments) | Needs permission: reconnect |
| [ ] | `marketplace-installer-details.readonly` NEW | Opt | INFERENCE (not seen in the docs by our searches; PAYMENTS_BRIEF calls it VERIFIED) | Our own plan check (reconcile) | Our check only; user sees nothing |

The table has 30 rows (14 NEW). The six unused scopes are listed separately below; one of them, `saas/location.read`, is also NEW vs 2.0.0, which makes 15 new in all.

**Lead intake (3 more optional read scopes, added after the table above was written):**

| Tick | Scope (exact) | R/O | Name | Used by | If not granted the user sees |
|---|---|---|---|---|---|
| [ ] | `forms.readonly` | Opt | VERIFIED | Lead intake: submissions per form | Needs permission: reconnect |
| [ ] | `surveys.readonly` | Opt | VERIFIED | Lead intake: submissions per survey | Needs permission: reconnect |
| [ ] | `funnels/funnel.readonly` | Opt | VERIFIED | Lead intake: funnel names | Needs permission: reconnect |

**Coming-feature permissions (King's decision, 12 Nov): five more OPTIONAL scopes, asked for now so no install has to approve again later.** None is used by any screen yet (the Permissions screen says so, and a skipped one never raises a reconnect warning). Rule kept: never `conversations/message.write`, `invoices.write` or `conversations.write` (delete).

| Tick | Scope (exact) | R/O | Name | For (coming) | If not granted |
|---|---|---|---|---|---|
| [ ] | `locations/tasks.readonly` | Opt | VERIFIED | AI follow-up tasks: check which leads already have a task | Nothing changes (not used yet) |
| [ ] | `locations/tasks.write` | Opt | VERIFIED | AI follow-up tasks: create an internal task after a preview | Nothing changes (not used yet) |
| [ ] | `locations/customFields.write` NEW | Opt | INFERENCE (confirm the picker lists it) | AI data cleaning: fix custom field values after a preview | Nothing changes (not used yet) |
| [ ] | `locations/tags.write` | Opt | VERIFIED | AI data cleaning: tidy tags after a preview | Nothing changes (not used yet) |
| [ ] | `conversations/reports.readonly` | Opt | VERIFIED | Richer response-time numbers | Nothing changes (not used yet) |

Only `locations/customFields.write` is NEW to the code in this change: the other four were already in `scopes.ts` (and in the 2.0.0 listing), so existing installs have them. Only the NEW ones make installs press Update.

**Still unused, still asked for (your call, same as before):**

| Tick | Scope | Name | Verdict |
|---|---|---|---|
| [ ] | `calendars/resources.readonly` | VERIFIED | Only probed, no feature. Remove later if you like. |
| [ ] | `saas/location.read` | INFERENCE, probably not an official scope | Unused. Remove later if you like (PAYMENTS_BRIEF says the same). |

Removing needs a small code change first (`scopes.ts`, `scope-groups.ts`, regenerate `docs/SCOPES.md`) so the install link and the portal match, or the install fails. Removed scopes stay granted on existing installs, so this is cleanup, not urgent. If you keep them, tick them too so the portal matches `scopes.ts`.

**Used by the code but NOT in `scopes.ts` (do not tick without King's decision):**

| Scope | Used by | Rule check |
|---|---|---|
| `conversations/message.write` | Inbox composer (send SMS/email), Fathom internal comments (`src/lib/connections/ingest.ts`) | ALLOWED as an OPTIONAL send scope by King on 13 Nov 2026 (supersedes CLAUDE.md sections 1A and 8 and standing rule 7) ("SubSync never replies for the agency"); `scope-groups.ts` lists it as "Never asked for". The internal-comment use is not a message to a lead, but the same scope also allows sending. Leave off. Composer stays preview only. |
| `conversations.write` | Clear junk: delete a conversation (`unanswered-gateway.ts`, flag `inbox_clear_junk`; request shape NOT VERIFIED LIVE) | A delete scope. Not in the list; NEEDS_KING item 33 says add it "next release". Recommend: leave off until the delete call is verified on a test account, then add in the next release (one more Update for every install). |
| `payments/orders.readonly` | Lead panel money tab | Not in list; shows Needs permission: reconnect always. Leave off (no need). |
| `forms.readonly` | Capabilities probe only | Not asked for. Leave off. |
| `invoices.write` | Resend invoice (flag `pm_resend`, off) | Would message a customer. Leave off. |

**Count for the portal: tick all 39 scopes (7 required, 32 optional): 29 from the first table, 3 Lead intake, 5 coming-feature, 2 still-unused. Set every one except the first 7 to Optional.** Total in `scopes.ts` today: 40.

## 2. Portal steps (King; about 10 minutes)

Needs your login. Do this on a quiet day: a published version goes live at once for a private app.

1. Open the developer portal (marketplace.gohighlevel.com), sign in, click **My Apps**, then **SubSync** (ID 6ae2a79309eaa881c1eb419e, NOT "KD Squares").
2. Open **Versions**. Note the live version number and how many versions exist. **Limit: assume 5 versions total, and only one draft at a time.** If you already have 3 or more, deprecate an old one first. Warning: deprecation needs 3 days notice and the docs say installs on a deprecated version may be uninstalled. NEVER deprecate a version that has real installs (the 3 installs are yours; still, do not risk it). If unsure, stop and send me a screenshot.
3. On the live version click **Clone as Draft**.
4. In the draft open **Advanced Settings**, then **Auth**, then **Scopes**. For each NEW row in section 1, click **Add scope**, search the exact string, tick it, set it to **Optional** (never Required). If the picker does not show a name, skip it and tell me which one.
5. Check no required scope changed (the 7 stay required) and that all 33 others are Optional, including the five coming-feature ones.
6. Do NOT touch **Modules**. We changed no module (the only module is the Custom Page, id 6ae2ba1906a8b3d7612d0292, unchanged). Module changes force Major and apply to every install at once.
7. Open the listing, then **Getting Started** and the description. Paste the guide from `docs/GETTING_STARTED_GUIDE.md` and make sure it does not promise anything not live (no "exports", no "messages sent for you"). Do not use the vendor's name or logo.
8. Click **Publish** (or **Create Version**). Choose the type: the portal usually offers **Major** when scopes are added (it did on 31 Oct). Choose **Minor** only if the portal lets you. Major means each install must press **Update** and confirm; that is what we want, because only an Update grants the new scopes.
9. Paste into **Agency Release Notes** (mandatory):

> Adds read-only visibility for payments and credit: failed payments, failed repeat payments, late invoices and each client account's credit balance. Adds workflow and campaign health checks and each client's plan status. Every new permission is optional and read only for payments. Workflow changes only happen after a preview and a confirm. Nothing here sends a message or charges anyone. Press Update and accept the new permissions to turn these on. Without them everything else keeps working and these screens say "Needs permission: reconnect".
>
> Five more optional permissions for coming features; skip them if you like.

10. Click **Publish**. Send me a screenshot of the Scopes list and the version number.

**Price and plan:** do not change them in this release (price changes apply to new installs only). The plan swap is in section 6, separate.

## 3. After publishing (your own accounts)

1. In your CRM open **Apps** (marketplace), find SubSync: you will see **Update**. Click it, read the release notes, accept all the permissions.
2. If there is no Update button, remove and re-add the install on that account (the permission screen then lists everything).
3. Do it once per account (your 3 installs), including the agency one if you bulk installed.
4. Open SubSync, **Settings**, **Permissions**. Every ticked scope must show **GRANTED**. A red "Not granted" row means that screen below still says Needs permission. Send me a screenshot of any that is not granted.

| Feature that switches on | Scopes it needs |
|---|---|
| Payments: failed payments and refunds | `payments/transactions.readonly` |
| Payments: failed repeat payments | `payments/subscriptions.readonly` |
| Payments: late invoices | `invoices.readonly` |
| Credit balance warning | `wallet.readonly` |
| Clients > Billing plan status | Not available for this kind of app (agency-only permission; removed 13 Nov 2026) |
| Workflows page and setup check | `workflows.readonly` |
| Failing and idle workflow checks | `workflows.logs` |
| Campaign list and health | `campaigns.readonly`, `emails/campaigns.readonly` |
| Campaign delivery totals | `emails/stats.readonly` |
| Workflow rename, copy, publish, delete (also need `WORKFLOWS_WRITE_LIVE` on) | `workflows.write`, `.publish`, `.delete` |
| Our plan check against our records | `marketplace-installer-details.readonly` |

Already working if granted in 2.0.0: speed to lead, appointments, tags, names, Data cleanup, meeting notes, deal and appointment actions.

## 1B. Call queue workflow: created automatically (the two permissions that matter)

SubSync creates the one internal "Call queue" workflow in each client account by itself (tag added, manual call task, tag removed; it sends nothing to contacts) when the CRM allows it. It needs only `workflows.readonly` and `workflows.write` (both Optional; they are rows in the table above, tick them there). Where the CRM has not enabled its Workflows API for the account (it answers 403 WORKFLOW_API_NOT_ENABLED_FOR_LOCATION), the card says so in plain words and shows the 2-minute hand-built steps. Without the permissions it says "Needs permission: reconnect".

Portal steps: developer portal > **My Apps** > SubSync > **Versions** > **Clone as Draft** > **Advanced Settings** > **Auth** > **Scopes** > **Add scope** > tick `workflows.readonly` and `workflows.write`, set both to **Optional** (only tick `workflows.publish` and `workflows.delete` if the picker lists them) > write the release notes (see below) > publish as 1.1.0 (Minor). Then in **KD Squares Test**: open the app list, press **Update**, allow the workflow permissions, and run the probe (docs/WORKFLOWS_PROBE.md). Writing stays a dry run until `WRITE_GHL_LIVE=true` and the account opted in.

Release note line: "New optional permission: workflows. SubSync can set up one internal call queue workflow in each client account for you. It never messages your contacts. Skip it and nothing breaks: you get a 2-minute guided setup instead."

## 4. Rollback

A live version cannot be edited or unpublished by us. Rollback is two things: (a) in code, switch the flag of the affected module off (`scripts/set-flags.ts off <prefix>`); screens then stop asking for the permission; (b) in the portal, Clone as Draft again, remove the scope, publish a patch (uses a version slot). Granted permissions stay on installs until removed. Never delete the live version while installs are on it.

## 5. Pre-pilot checklist (before any outside agency installs; private cap is 5 agencies)

- [ ] Section 6 below done (plan swap, enforced).
- [ ] Flags: switch off unfinished modules with `node --env-file=.env.local --import tsx scripts/set-flags.ts off inbox_,moat_,appt_,pl_` and decide per prefix for the rest from `src/lib/flags-core.ts`: `zoom_`, `lead_`, `ap_`, `cl_`, `pp_`, `au_`, `td_`, `ov_`, `fl_`, `wf_`, `pm_`, `cf_`, `cu_`. Note King's rule 11: leave a module on only if it is verified live; if one is off, say why and when it returns.
- [ ] Live switches that must stay OFF for outside installs: `WRITE_GHL_LIVE` (it is true today for testing), `WORKFLOWS_WRITE_LIVE`, per-account write opt-in off for non-test accounts, `pm_resend` off.
- [ ] `ENTITLEMENTS_MODE=enforced`; run entitlement and tenant isolation tests.
- [ ] Privacy policy and terms reviewed by a human (the app holds other businesses' customer data).
- [ ] Database size: Find lead's tables and indexes take about 715 MB per 1M contacts; the current plan is 500 MB. Upgrade the database plan (Supabase Pro, check size) before a large agency installs.
- [ ] Support email or phone live with a 24-hour reply (needed for review), logo and support details filled in the portal.

> UPDATE 13 Nov 2026 (King): there is now NO free plan. The draft has one plan, **Growth**, Paid, monthly, $11.50 per client account, 14-day free trial, id `6af521842a5c6a72fd97d767`. The old Free Plan (`6ae40eb4f65e3c03823476b8`) and the $5 plan are deleted from the draft. Feature lines: "Manage every client account from one screen", "Speed to lead: see who is waiting and who to call first", "Appointments, no-shows and win-back lists that recover lost leads", "Pipeline money: where deals sit, what is stuck, who wins", "Alerts and exports for every client account". Steps 1 and 2 below are done; "Free Plan feature lines" no longer apply. Code maps Growth to full access and keeps the old Free Plan id as legacy full access.

## 6. BEFORE ANY PILOT ONLY: swap the plan to $11.50 (do not do this in this release)

Why separate: prices cannot be edited, and changes apply to new installs only, so no outside install may land on the $5 plan.

1. Portal, **SubSync**, **Pricing** tab: **Add Plan**, name Pro, monthly, **$11.50** per client account, 14-day free trial. Feature lines must be honest: "Every screen that is live, alerts and the daily brief". No "exports" unless shipped.
2. Free Plan feature lines: Instant Audit, overview, search.
3. Delete the $5 plan. CHECK what happens to existing installs on a deleted plan: make sure you have none on it (use the Free Plan for your own tests).
4. Send me the new plan id. I run `node --env-file=.env.local --import tsx scripts/set-plan.ts <newPlanId> pro` then `set-plan.ts --list` to check.
5. Set `ENTITLEMENTS_MODE=enforced` in Vercel, redeploy, then I run the entitlement and tenancy tests.
6. Do one real paid install on the final plan.

NEEDS_KING item 4 says $9 and CLAUDE.md says $11.50: CLAUDE.md wins ($11.50).

## 7. Uncertain

- Live version number and whether the portal offers Minor or only Major.
- Names marked INFERENCE (workflows, campaigns, installer details).
- `workflows.publish` may not exist as a separate scope.
- Whether adding NEW optional scopes counts against the private install cap or re-bills anything (it should not).
