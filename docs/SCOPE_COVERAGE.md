# Permission coverage: which screen uses each of the 80 permissions

Written 14 Nov 2026 from the code on `main` (each module's reads and writes were checked in the source, not copied from older docs). Updated 14 Nov 2026 after the More tools build: nine more permissions have a screen, and `locations/tasks.write` was dropped (79 permissions). Reasons in plain words: `docs/SCOPES.md` (generated from `src/lib/scope-groups.ts`).

How to read the columns
- **Screen**: the exact menu path where the permission is used.
- **Read or change**: read means SubSync only looks. Change means SubSync writes, always after a preview and a confirm.
- **Live on main**: yes means the code is merged on `main`. Most modules sit behind a switch that is off in the code and was switched on in production on 13 Nov 2026 (`docs/MORNING_REPORT_13NOV.md`); that switch was not re-checked today. The newest screens (Money checks, plan monitor, Account setup, safe writes) are on by default in the code.
- **Tested on a real account**: NO unless `docs/FEATURE_STATUS.md` says yes. Yes entries: the 30 Oct and 31 Oct 2026 checks on the three real accounts (contacts, deals, conversations, appointments, messages for speed to lead) and the 13 Nov installed list. Nothing else has answered from a real account yet.

## Totals

| | Count |
| --- | --- |
| Permissions asked for | 79 (7 required, 72 optional) |
| With a live screen that uses them | 70 (files.readonly moved to unused: the file list needs medias.readonly) |
| Kept for a later feature, nothing uses them yet | 9 (see below: the platform asks for another permission for what each would do) |
| Tested on a real account | 9 (the new screens above were tested with a recorded fake of the platform, not a real account) |

## Table

| Permission | Screen (menu path) | Read or change | Live on main | Tested on a real account |
| --- | --- | --- | --- | --- |
| `locations.readonly` | Every screen (account names, time zones); Clients > Accounts | read | yes | yes |
| `oauth.readonly` | Clients > Accounts (installed accounts); Clients > Money and plans (plan monitor reads the installed list) | read | yes | yes (installed list, 13 Nov) |
| `oauth.write` | Behind every screen: the key limited to one client account | change (a key, not your data) | yes | yes (the three accounts sync) |
| `locations.features.read` | Kept for a later feature, nothing uses it yet. The platform's public description lists no read it unlocks, so Account setup cannot show features switched on | read | no | no |
| `contacts.readonly` | Find a lead > Contact search and Call lists; Clean-up > Data health; Today | read | yes | yes (30 Oct) |
| `contacts.write` | Meeting notes (summary note on the matched contact); Clean-up > Data health (phone and name fixes); lead panel (notes, tags, call results, Mark done and Delete on a task SubSync made) | change | yes | no |
| `opportunities.readonly` | Pipeline and deals; Today; Account audit; Clients > Health > Account setup (pipelines and stages) | read | yes | yes (30 Oct) |
| `opportunities.write` | Pipeline and deals (change or delete a deal) | change | yes | no |
| `conversations.readonly` | Speed to lead; Unanswered messages; Today | read | yes | yes (30 Oct) |
| `conversations/message.readonly` | Speed to lead (who replied first, and when) | read | yes | yes (31 Oct, 10 leads timed) |
| `conversations/message.write` | Lead panel, message box (a person presses Send); open from Find a lead, Unanswered messages or Speed to lead | change | yes | no |
| `conversations.write` | Unanswered messages > Clear junk (delete one junk conversation, typed count) | change | yes | no |
| `conversations/reports.readonly` | Kept for a later feature, nothing uses it yet | read | no | no |
| `conversations/livechat.write` | Kept for a later feature, nothing uses it yet | change | no | no |
| `calendars.readonly` | Appointments; Getting started (setup checklist) | read | yes | yes (31 Oct) |
| `calendars/events.readonly` | Appointments (status, no-show list, insights) | read | yes | yes (31 Oct, 38 appointments) |
| `calendars/groups.readonly` | Appointments (calendar list under its group) | read | yes | no |
| `calendars/resources.readonly` | Clients > Health > Account setup (rooms and equipment) | read | yes | no |
| `calendars/events.write` | Appointments (create, change, delete an appointment) | change | yes | no |
| `users.readonly` | Team member names on Team, Speed to lead, Unanswered messages | read | yes | no |
| `locations/tags.readonly` | Settings > Targets > Call queues (check the queue tags exist); Find a lead > Call lists | read | yes | no |
| `locations/customFields.readonly` | Meeting notes setup (custom field names) | read | yes | no |
| `locations/tags.write` | Settings > Targets > Call queues > Create this tag | change | yes | no |
| `workflows.readonly` | Workflows (list across accounts, health checks) | read | yes | no |
| `workflows.logs` | Workflows (runs and failed steps, last 30 days) | read | yes | no |
| `workflows.write` | Workflows (rename, copy into another account) | change | yes | no |
| `workflows.publish` | Workflows (publish or pause) | change | yes | no |
| `workflows.delete` | Workflows (delete with typed confirmation and a saved copy) | change | yes | no |
| `campaigns.readonly` | Workflows (campaign list and health) | read | yes | no |
| `emails/campaigns.readonly` | Workflows (email, bulk and workflow campaigns) | read | yes | no |
| `emails/stats.readonly` | Workflows (campaign delivery totals) | read | yes | no |
| `saas/location.read` | Kept for a later feature, nothing uses it yet. The platform's public description lists no read this permission unlocks; the plan reads need `saas/company.read`, which cannot be granted to this app. The Plans and payments block on Clients shows Needs permission or Not available | read | no | no |
| `payments/transactions.readonly` | Money > Today, Recovery (failed payments, refunds) | read | yes | no |
| `payments/subscriptions.readonly` | Money > Today, Recovery (failed repeat payments) | read | yes | no |
| `invoices.readonly` | Money > Upcoming and Recovery (late invoices); Money > Client payments > Money checks (invoices by status) | read | yes | no |
| `wallet.readonly` | Clients > account page (credit balance); Money | read | yes | no |
| `marketplace-installer-details.readonly` | Clients > Money and plans > Install record (GET /marketplace/app/{appId}/installations; plan id and install date, compared with what SubSync recorded; company owners and administrators only) | read | yes | no (not called against a real account yet) |
| `payments/orders.readonly` | Money > Client payments > Money checks (recent orders); lead panel, Orders and payments | read | yes | no |
| `payments/coupons.readonly` | Money > Client payments > Money checks (coupons) | read | yes | no |
| `payments/integration.readonly` | Money > Client payments > Money checks (payment provider connected, live or test) | read | yes | no |
| `payments/custom-provider.readonly` | Money > Client payments > Money checks (custom payment provider yes or no; keys never read) | read | yes | no |
| `charges.readonly` | Money > Client payments > Money checks (charges made by apps); Clients > Money and plans (last charge in the plan monitor) | read | yes | no |
| `products.readonly` | Money > Client payments > Money checks (products) | read | yes | no |
| `products/prices.readonly` | Money > Client payments > Money checks (prices of the first 20 products) | read | yes | no |
| `products/collection.readonly` | Money > Client payments > Money checks (product collections) | read | yes | no |
| `invoices/schedule.readonly` | Money > Client payments > Money checks (invoice schedules) | read | yes | no |
| `invoices/template.readonly` | Money > Client payments > Money checks (invoice templates) | read | yes | no |
| `invoices/estimate.readonly` | Money > Client payments > Money checks (estimates by status) | read | yes | no |
| `pipelines.readonly` | Clients > Health > Account setup > Rename a pipeline stage (GET /opportunities/pipelines/{id}, the one read the platform ties to this permission; the pipeline list stays on opportunities.readonly) | read | yes | no (not called against a real account yet) |
| `objects/schema.readonly` | Clients > Health > Account setup (custom record types) | read | yes | no |
| `objects/record.readonly` | Clients > Health > Account setup (records in a custom type, a count) | read | yes | no |
| `notes.readonly` | Kept for a later feature, nothing uses it yet. The platform has no read for notes across an account, so nothing can be shown | read | no | no |
| `locations/customValues.readonly` | Clients > Health > Account setup (custom values); Settings > Targets > Call queues (reply target check) | read | yes | no |
| `locations/templates.readonly` | Clients > Health > Account setup (text and email templates) | read | yes | no |
| `locations/tasks.readonly` | Clients > Health > Account setup (open and overdue task counts) | read | yes | no |
| `recurring-tasks.readonly` | Lead panel > Follow-up and quotes > Repeating follow-up (read back the one just made, GET /locations/{id}/recurring-tasks/{id}; the platform has no list) | read | yes | no (not called against a real account yet) |
| `files.readonly` | None. The platform documents this permission only for opening one shared file by its link; nothing in SubSync does that. The file count in Clients > Health > Account setup calls the file list, which needs `medias.readonly` (not in the listing), so that row shows Not available | read | no | no |
| `lc-email.readonly` | Kept for a later feature, nothing uses it yet. The platform's public description has no read it unlocks | read | no | no |
| `emails/builder.readonly` | Clients > Health > Account setup (saved email designs, a count) | read | yes | no |
| `emails/schedule.readonly` | Clients > Health > Account setup (scheduled emails, a count) | read | yes | no |
| `emails/templates.readonly` | Clients > Health > Account setup > Email templates (GET /emails/locations/{id}/templates; names and dates only) | read | yes | no (not called against a real account yet) |
| `phonenumbers.read` | Clients > Health > Account setup (phone numbers, last four digits only) | read | yes | no |
| `numberpools.read` | Clients > Health > Account setup (number pools) | read | yes | no |
| `locations/customValues.write` | Settings > Targets > Call queues > Set up your CRM > Save my reply target | change | yes | no |
| `recurring-tasks.write` | Lead panel > Follow-up and quotes > Repeating follow-up (POST /locations/{id}/recurring-tasks; the platform asks for exactly this permission) | change | yes | no (not called against a real account yet) |
| `notes.write` | Kept for a later feature, nothing uses it yet. Notes are added with `contacts.write` today | change | no | no |
| `pipelines.write` | Clients > Health > Account setup > Rename a pipeline stage (PUT /opportunities/pipelines/{id}; every stage sent back, only one name changes) | change | yes | no (not called against a real account yet) |
| `pipelines.create` | Settings > Targets > Call queues > Set up your CRM > Create the standard sales pipeline (only when the account has none) | change | yes | no |
| `invoices.write` | Lead panel > Follow-up and quotes > Quote or invoice > Invoice (unsent draft, POST /invoices/) | change | yes | no (not called against a real account yet) |
| `invoices/schedule.write` | Kept for a later feature, nothing uses it yet | change | no | no |
| `invoices/template.write` | Lead panel > Follow-up and quotes > Quote or invoice > Invoice template (POST /invoices/template) | change | yes | no (not called against a real account yet) |
| `invoices/estimate.write` | Lead panel > Follow-up and quotes > Quote or invoice > Estimate (unsent, POST /invoices/estimate) | change | yes | no (not called against a real account yet) |
| `forms.readonly` | Clean-up > Lead intake (Applications this week, submissions per form) | read | yes | no |
| `surveys.readonly` | Clean-up > Lead intake (Applications this week, submissions per survey) | read | yes | no |
| `funnels/funnel.readonly` | Clean-up > Lead intake (funnel names and steps) | read | yes | no |
| `funnels/page.readonly` | Clean-up > Lead intake > Funnel pages | read | yes | no |
| `funnels/pagecount.readonly` | Clean-up > Lead intake > Funnel pages (page count) | read | yes | no |
| `funnels/redirect.readonly` | Clean-up > Lead intake > Redirects and trigger links | read | yes | no |
| `links.readonly` | Clean-up > Lead intake > Redirects and trigger links | read | yes | no |

## Things the Account setup check found

- `files.readonly`: guards only GET /files/d/{slug}. The Account setup file count uses GET /medias/files, which needs `medias.readonly`, a permission that is not in the listing.
- `notes.readonly`, `locations.features.read`, `lc-email.readonly`: the published description has no read they unlock, so nothing SubSync can show depends on them.
- `saas/location.read`: unlocks no known read.
- `pipelines.readonly` and `emails/templates.readonly`: unused. The reads that exist ask for `opportunities.readonly` and `locations/templates.readonly`.
- `marketplace-installer-details.readonly`: the plan monitor does not call it.

Whether to drop the 18 unused permissions from the listing is King's decision. Removing one is a new version and every install approves again; keeping them means a later feature needs no new approval. The reasons already say "kept for a later feature".

## Not asked for

`users.write` (SubSync never manages people), `saas/company.read` (company level only, cannot be granted to this app), invoice sending (the resend button is switched off).

## What the platform really asks for (checked 14 Nov 2026 in the platform's own operation catalogue; no real account was called)

| Permission | Existing screen | Permission the platform asks for | Live call tested on a real account |
| --- | --- | --- | --- |
| `notes.readonly` | Lead panel > Notes | `contacts.readonly` (GET /contacts/{id}/notes) | no. Stays unused: not a permission the platform asks for. |
| `notes.write` | Lead panel notes, meeting summaries | `contacts.write` (POST /contacts/{id}/notes) | no. Stays unused. |
| `locations.features.read`, `saas/location.read` | Clients > Money and plans | none found: GET /locations/{id} asks for `locations.readonly`; no SaaS read for a location key | no. Recorded in docs/BLOCKED.md. |
| `lc-email.readonly` | Clients > onboarding checks | none found: no read for sending domains or sending addresses | no. Recorded in docs/BLOCKED.md. |
| `conversations/reports.readonly` | Speed to lead | none found: no response-time report operation exists | no. SubSync's own measured numbers stay. |
| `conversations/livechat.write` | Lead panel message box | only a typing indicator for website chat, which needs a visitor id the contact record does not give | no. Recorded in docs/BLOCKED.md. |
| `invoices/schedule.write` | Money > Client payments | `invoices/schedule.write` exists (create a repeating invoice) but no screen was built: it needs a template and a contact in one step | no. Recorded in docs/BLOCKED.md. |
| `locations/tasks.write` | none | none: removed from the list at King's decision | not applicable |
