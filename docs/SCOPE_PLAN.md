# Permission (scope) plan

Brief 13A: few permissions is a trust advantage (the biggest competitor asks for 165). The catch is that
every permission added later makes every installed agency approve again. So before any outside agency
installs, every read permission that Waves 1 and 2 will need should already be in the listing as an
OPTIONAL permission, and the app must keep working when an optional one is not granted.

Names below are from the platform's own scope list (read 31 Oct 2026). Which endpoint needs which scope is
marked CHECK where the list only describes it loosely.

## Today (7 required, 2 optional, all read-only except oauth.write)

| Scope | Why | Used by |
| --- | --- | --- |
| `locations.readonly` | Names, time zones of client accounts | everything |
| `contacts.readonly` | Contacts | search, data health, leads, call lists |
| `opportunities.readonly` | Deals and pipelines | pipeline, stale deals, Instant Audit |
| `conversations.readonly` | Conversation summaries (last message, direction, time) | inbox and SLA |
| `calendars.readonly` | Calendars | setup checklist |
| `oauth.readonly` | List the accounts the app is installed on | sync |
| `oauth.write` | Mint a per-account token from the agency token | sync (kept: no read-only way to do this, CHECK) |
| optional `calendars/events.readonly` | Appointments | appointments, insights, no-show recovery |
| optional `users.readonly` | Team member names | team names on lists and leaderboards |

Nothing in this list is unused today. `oauth.write` sounds scary but it is the permission that lets the app
read one client account at a time with a token limited to that account.

## Proposed new OPTIONAL read permissions (add in the portal before any pilot install)

| Scope | Needed for | Wave | Status |
| --- | --- | --- | --- |
| `conversations/message.readonly` | The messages inside a conversation: who sent each one, a person or automation, and when. This is the only way to measure true speed-to-lead (first human touch) and who answered | 1 (#1, #3) | CONFIRMED (31 Oct): the list-messages endpoint requires exactly this scope and returns direction, userId, source and dateAdded |
| `locations/tags.readonly` | Tag names for hot-lead queues and lead source grouping | 1 (#4), 2 | confirmed to exist |
| `locations/customFields.readonly` | Reading a lead-source custom field for source attribution | 3 | confirmed to exist; not needed before Wave 3, so can wait |
| `marketplace-installer-details.readonly` | Reconcile each install's plan (the brief's "Get installer details") | pricing gate | NOT confirmed: my searches of the docs did not find this endpoint or scope name. Do not add until the exact name is seen in the portal |

Recommendation: add the first and second now (they unblock Wave 1; the fourth waits until its name is confirmed) and
leave custom fields until Wave 3. Not recommended: `voice-ai-dashboard.readonly` (it only covers the
platform's Voice AI call logs, not ordinary calls, so it would not give call data), and any write scope.
The `contacts.write` permission that Data cleanup needs stays out while that feature is switched off.

## How to add them (King, in the developer portal)

1. Open the developer portal, My Apps, SubSync, then Advanced Settings, then Auth.
2. Under Scopes choose Add scope, tick `conversations/message.readonly`, `locations/tags.readonly` and
   `marketplace-installer-details.readonly`, and for each choose **Optional**, not Required.
3. Save the draft. Send me a screenshot of the scope list.
4. I will then add the same names to the install link in `src/lib/ghl/scopes.ts` and make each feature say
   "needs permission" instead of failing when it is not granted (the appointments page already works this
   way). I must not change the code first: asking for a permission the listing does not have makes the
   install fail.
5. Reinstall on the test agency to approve the new optional ones.

## What is checked

`scopes.ts` is the single list used for the install link; a unit test pins it. Features that depend on an
optional scope store `needs_permission` for that account and show a plain banner, never an error.

## Done on 31 Oct 2026: version 2.0.0 published with 12 new optional scopes

King asked for broad access so advanced features can be built on it, including change access, always behind
verification. In the portal I cloned the live 1.0.0 as a draft, added the scopes below as **Optional**, and
published it as **2.0.0** (the platform only offers a major bump when scopes are added; a private app goes live
at once). Existing installs approve the new version once. The install link in `scopes.ts` now asks for the same
21 scopes, and a unit test pins the list.

New optional read: `conversations/message.readonly` (first human touch, speed-to-lead),
`conversations/reports.readonly`, `locations/tags.readonly`, `locations/customFields.readonly`,
`locations/tasks.readonly`, `calendars/groups.readonly`, `calendars/resources.readonly`.
New optional change: `calendars/events.write` (mark an appointment showed or no-show), `contacts.write`,
`opportunities.write`, `locations/tags.write`, `locations/tasks.write`.

Deliberately NOT added: sending messages (`conversations/message.write`), editing users, deleting anything,
and the 165-scope sprawl the brief warns about. Rule for every change scope: show exactly what will change,
require a typed confirmation, snapshot the old values, allow undo, and refuse when the scope was declined.
Nothing uses the change scopes yet except Data cleanup (switched off).

The earlier list above that says `marketplace-installer-details.readonly` was not found is unchanged.

## Planned for version 2.1.0: the Workflows module (8 new optional scopes, 29 scopes in total)

All optional, so an install that declines them keeps working and the Workflows page says "Needs permission: reconnect" with the exact names:
`workflows.readonly` and `workflows.logs` (read the list and the run history), `campaigns.readonly`, `emails/campaigns.readonly` and `emails/stats.readonly`
(read campaigns and their delivery totals), and the change scopes `workflows.write` (rename, copy), `workflows.publish` and `workflows.delete`, each used only after
a preview and a confirm and only with `WORKFLOWS_WRITE_LIVE` switched on. SubSync still asks for 29 scopes in total (7 required and 22 optional). Nothing here can send a message or start a campaign.
Batch it into the 1.1.0 release with the other scope and pricing changes (docs/DECISIONS.md).

## Clients billing view (stage CD)
The app now asks for 31 scopes: two new OPTIONAL read scopes, saas/location.read and saas/company.read (names INFERENCE, CHECK in the portal list before release 2.3.0). They feed only the Billing view in Clients (plan and subscription status per client account). Without them the view says: Needs permission, reconnect.

## Payments module (stage PAY, release 2.1.0 batch)
The app now asks for 36 scopes: five new OPTIONAL read scopes, `payments/transactions.readonly`, `payments/subscriptions.readonly`, `invoices.readonly`, `wallet.readonly` and `marketplace-installer-details.readonly`. The first three feed the Payments screens (failed payments, failed repeat payments, late invoices; the response fields were read in the platform's public API pages on 11 Nov 2026), the fourth the credit balance, the fifth our own plan check. All read only: SubSync cannot charge, refund, retry or send anything. `invoices.write` (send an invoice again) is NOT requested: the feature behind it (flag pm_resend) is off until King approves messaging a customer. Until a permission is granted Payments says: Needs permission: reconnect, and each part works on its own. Batch it into the same GHL release as the other scope and pricing changes (Clone as Draft, minor version, release notes: Adds payment and credit visibility, read only).

## Lead intake (stage DQ, release 2.2.0 batch)
The app now asks for 39 scopes: three new OPTIONAL read scopes, `forms.readonly`, `surveys.readonly` and `funnels/funnel.readonly`. They feed only the Lead intake tab in Clean-up: the names and submission times of forms and surveys (never the answers), and the names and step counts of funnels. Declined, the tab says "Needs permission: reconnect" and everything else keeps working. Verified in the platform docs (docs/research/DATAQUALITY_R1.md): forms and surveys have list and submission endpoints, funnels have a list; funnel views and conversion are not available from the platform. Batch it into the same release as the other scope changes (docs/DECISIONS.md).
