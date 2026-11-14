# Permissions SubSync asks for, and why

This file is generated from `src/lib/scope-groups.ts` (run `scripts/gen-scopes-doc.ts`). A test fails when it is stale, when a permission the app asks for is missing from it, or when it lists one the app does not ask for. Do not edit it by hand.

SubSync asks for 80 permissions: 7 required and 73 optional. Fewer permissions is a trust advantage, and every permission added later makes every installed company approve again, so each one below has a reason. An optional permission can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.

Wording rule: the screen says one of three things. **Needs permission: reconnect** (the app asked and this install declined, or the app has not asked yet), **Not available from the platform yet** (the platform refuses even with the permission, or has no such data), or it simply shows the data. See `docs/CAPABILITIES.md` for which data point is which.

## Your client accounts

Which accounts SubSync is connected to, and the one-account-at-a-time access it reads them with.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations.readonly` | read | required | Names, time zones and contact details of your client accounts, so every number is shown against the right account and clock. |
| `oauth.readonly` | read | required | Lists the accounts SubSync is installed on, so a new account is found without you doing anything. |
| `oauth.write` | change | required | Lets SubSync read one client account at a time with a key limited to that account. The platform offers no read-only way to do this. Changes in your accounts only happen after you preview and confirm, are logged, and can be undone where possible. |
| `locations.features.read` | read | optional | Which features each client account has switched on, for the Account setup check screen (planned), which will list what is missing in an account. Optional. Not used yet. |

## Contacts

People in your accounts.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `contacts.readonly` | read | required | Contacts and their tags, source, owner and do-not-contact flag, for search, call lists, data health and lead counts. |
| `contacts.write` | change | optional | Only to add a meeting summary as a note on the matched contact, and for Data cleanup (which always shows a preview first). Optional. Without it SubSync keeps working and the feature says: Needs permission, reconnect. |

## Deals

Your pipelines and the money in them.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `opportunities.readonly` | read | required | Deals, pipelines and stages, for open pipeline, stale deals and the account audit. |
| `opportunities.write` | change | optional | Only to change a deal (stage, status, value, owner, name) or delete one from the Pipeline screen, after a preview. A delete also needs a typed confirmation. Optional. |

## Conversations and calls

Who wrote to a lead, when, and whether a person or an automation did.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `conversations.readonly` | read | required | The conversation list: last message, direction, channel and unread count, for unanswered messages. Message text is never copied. |
| `conversations/message.readonly` | read | optional | The messages inside a conversation, only to see who sent each one and when (a person or an automation, a call or a text). This is the only way to measure true speed to lead. The text of a message is never stored. |
| `conversations/message.write` | change | optional | Only to send a text or an email to one lead when a person presses Send, after a preview. Optional. SubSync never sends on its own and never to a contact who asked not to be contacted. Without it the message box says: Needs permission, reconnect. |
| `conversations.write` | change | optional | Only to delete one junk conversation in Clear junk (Unanswered messages), after a preview and a typed count. A deleted conversation cannot be brought back. Optional. SubSync never deletes on its own, and never for a contact who asked not to be contacted or who has an open deal. |
| `conversations/reports.readonly` | read | optional | Response-time totals the platform already calculates, to compare with SubSync's own numbers. Optional, for later features, nothing uses it yet. Not used yet. |
| `conversations/livechat.write` | change | optional | Reserved, no screen yet: replying to website chat from SubSync, which would always need a person to press Send. Optional, for later features, nothing uses it yet. Not used yet. |

## Appointments

Bookings and what happened to them.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `calendars.readonly` | read | required | Calendars, for the setup checklist and to know which calendars exist. |
| `calendars/events.readonly` | read | optional | Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list. |
| `calendars/groups.readonly` | read | optional | Calendar groups, so every calendar can be listed under its group, even one with no bookings. |
| `calendars/resources.readonly` | read | optional | Rooms and equipment, for the Account setup check screen (planned), which will flag a calendar that points to a room or item that no longer exists. Optional. Not used yet. |
| `calendars/events.write` | change | optional | Only to create, change (status, time, owner, calendar, title) or delete an appointment from the Appointments screen, after a preview. A delete also needs a typed confirmation. Optional. |

## Team

Your team members' names.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `users.readonly` | read | optional | Team member names, so lists and leaderboards say who, never a raw ID. Without it lists cannot show names, and the feature says: Needs permission, reconnect. |

## Tags, fields and tasks

How your accounts label and follow up on contacts.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations/tags.readonly` | read | optional | Tag names, for hot-lead and cold-list rules. |
| `locations/customFields.readonly` | read | optional | The names of your custom fields, so a field shows its name instead of a code. Names only, never the values. |
| `locations/tags.write` | change | optional | Reserved, no screen yet: creating or renaming tags, which would always show a preview first. Optional, for later features, nothing uses it yet. Not used yet. |

## Workflows and campaigns

The automations and campaigns in your client accounts, and how they are doing.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `workflows.readonly` | read | optional | The list of workflows in each client account (name, state, last edited), for the Workflows page. Without it the page says: Needs permission, reconnect. |
| `workflows.logs` | read | optional | How many times each workflow ran and how many steps failed in the last 30 days, to find broken or idle ones. Who went through a workflow is never stored. |
| `workflows.write` | change | optional | Only to rename a workflow or copy one into another client account, after a preview and a confirm. Optional. |
| `workflows.publish` | change | optional | Only to publish or pause a workflow, after a preview and a confirm. Optional. |
| `workflows.delete` | change | optional | Only to delete a workflow, after a preview, a typed confirmation and a saved copy. Optional. |
| `campaigns.readonly` | read | optional | The list of campaigns in each client account (name, state, last change), to find stuck or failed ones. Read only: SubSync never starts or sends a campaign. |
| `emails/campaigns.readonly` | read | optional | The email, bulk and workflow campaigns of each client account, read only, for the same list. |
| `emails/stats.readonly` | read | optional | How many messages of each campaign were sent, delivered, opened, clicked, bounced or are still waiting, to find campaigns that looked sent but did not arrive. Totals only: SubSync never sees who received what. |
| `saas/location.read` | read | optional | Optional. Requested for the Plans and payments block on the Clients screen. Honest status: the platform's public API description lists no read that this permission unlocks (the plan reads ask for saas/company.read, company level), so the block shows Needs permission or Not available until the platform confirms what it unlocks. |

## Payments and credit

Failed and late payments, so you can chase the money, and the credit balance of each client account.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `payments/transactions.readonly` | read | optional | Each payment's status, amount and who paid, to list failed payments and refunds. Read only: SubSync cannot charge, refund or retry anything. Without it Payments says: Needs permission, reconnect. |
| `payments/subscriptions.readonly` | read | optional | Whether a customer's repeat payment is active or past due, to list failed repeat payments. Read only. |
| `invoices.readonly` | read | optional | Which invoices are sent, partly paid or paid and when they are due, to list late invoices. Read only: SubSync never sends or changes an invoice. |
| `wallet.readonly` | read | optional | The credit balance of each client account, to warn you before it runs out. Read only. |
| `marketplace-installer-details.readonly` | read | optional | One record for the token that asks: the installer, the company and the plan id (no dates, no trial). Used only to cross-check the Marketplace installs block, whose dates, plan and trial flag come from the installed list. Read only. |

## Money checks

Orders, invoices, products and payment setup, for the Money checks screen (planned). All read only. Optional, and nothing uses them yet.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `payments/orders.readonly` | read | optional | Orders and their payment status, for the Money checks screen (planned), to find orders that were never paid. Read only. Optional. Not used yet. |
| `payments/coupons.readonly` | read | optional | The discount codes in each client account, for the Money checks screen (planned), to find expired or unlimited ones. Read only. Optional. Not used yet. |
| `payments/integration.readonly` | read | optional | Whether a payment provider is connected and in live or test mode, for the Money checks screen (planned), so a client taking test payments is caught. Read only. Optional. Not used yet. |
| `payments/custom-provider.readonly` | read | optional | Whether a custom payment provider is set up, for the Money checks screen (planned). Read only. Optional. Not used yet. |
| `charges.readonly` | read | optional | Charges the platform made for your usage, for the Money checks screen (planned), to warn about a surprise bill. Read only. Optional. Not used yet. |
| `products.readonly` | read | optional | The products you sell, for the Money checks screen (planned), to find a product without a price or an image. Read only. Optional. Not used yet. |
| `products/prices.readonly` | read | optional | The prices set on each product, for the Money checks screen (planned), to find a missing or zero price. Read only. Optional. Not used yet. |
| `products/collection.readonly` | read | optional | Product collections, for the Money checks screen (planned), to find an empty one. Read only. Optional. Not used yet. |
| `invoices/schedule.readonly` | read | optional | Repeating invoice schedules, for the Money checks screen (planned), to find one that stopped. Read only. Optional. Not used yet. |
| `invoices/template.readonly` | read | optional | Invoice templates, for the Money checks screen (planned), to find an account with none set up. Read only. Optional. Not used yet. |
| `invoices/estimate.readonly` | read | optional | Estimates and whether they were accepted, for the Money checks screen (planned), to find estimates nobody followed up. Read only. Optional. Not used yet. |

## Account setup check

What each client account has set up, for the Account setup check screen (planned): which pipelines, templates, numbers and files exist and what is missing. All read only. Optional, and nothing uses them yet.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `pipelines.readonly` | read | optional | The list of pipelines and their stages, for the Account setup check screen (planned), to find an account with no pipeline or an empty stage list. Read only. Optional. Not used yet. |
| `objects/schema.readonly` | read | optional | The names of custom record types, for the Account setup check screen (planned). Names only. Optional. Not used yet. |
| `objects/record.readonly` | read | optional | How many records each custom record type holds, for the Account setup check screen (planned). A count only. Optional. Not used yet. |
| `notes.readonly` | read | optional | Whether contacts have notes, for the Account setup check screen (planned). Counts only, SubSync does not copy note text. Optional. Not used yet. |
| `locations/customValues.readonly` | read | optional | The names of the custom values (company name, links, hours) set in each client account, for the Account setup check screen (planned), to find an empty one. Optional. Not used yet. |
| `locations/templates.readonly` | read | optional | The names of the text and email templates in each client account, for the Account setup check screen (planned). Names only. Optional. Not used yet. |
| `locations/tasks.readonly` | read | optional | Open and overdue tasks, for the Account setup check screen (planned), to find tasks nobody is doing. Optional. Not used yet. |
| `recurring-tasks.readonly` | read | optional | Repeating tasks, for the Account setup check screen (planned), to find one that stopped. Optional. Not used yet. |
| `files.readonly` | read | optional | The names of uploaded files, for the Account setup check screen (planned). Names only, files are never opened. Optional. Not used yet. |
| `lc-email.readonly` | read | optional | The sending email addresses connected to each client account, for the Account setup check screen (planned), to find one that is not set up. Optional. Not used yet. |
| `emails/builder.readonly` | read | optional | The names of saved email designs, for the Account setup check screen (planned). Names only. Optional. Not used yet. |
| `emails/schedule.readonly` | read | optional | Emails scheduled to go out, for the Account setup check screen (planned), to find one stuck in the queue. Read only. Optional. Not used yet. |
| `emails/templates.readonly` | read | optional | The names of email templates, for the Account setup check screen (planned). Names only. Optional. Not used yet. |
| `phonenumbers.read` | read | optional | The phone numbers of each client account, for the Account setup check screen (planned), to find an account with no number to call or text from. Optional. Not used yet. |
| `numberpools.read` | read | optional | Number pools (groups of sending numbers), for the Account setup check screen (planned), to find an empty pool. Optional. Not used yet. |

## Reserved, no screen yet

Permissions asked for now, so a later feature never forces every install to approve again. Nothing in SubSync uses them today, and every use would show a preview first.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations/customValues.write` | change | optional | Reserved, no screen yet: changing a custom value in a client account, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `locations/tasks.write` | change | optional | Reserved, no screen yet: creating an internal task for your team, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `recurring-tasks.write` | change | optional | Reserved, no screen yet: creating or stopping a repeating task, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `notes.write` | change | optional | Reserved, no screen yet: adding a note to a contact, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `pipelines.write` | change | optional | Reserved, no screen yet: changing a pipeline or its stages, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `pipelines.create` | change | optional | Reserved, no screen yet: creating a pipeline, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `invoices.write` | change | optional | Reserved, no screen yet: changing an invoice, after a preview and a typed confirmation. SubSync never sends an invoice on its own, and the resend button is switched off. Optional, for later features, nothing uses it yet. Not used yet. |
| `invoices/schedule.write` | change | optional | Reserved, no screen yet: pausing or changing a repeating invoice, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `invoices/template.write` | change | optional | Reserved, no screen yet: changing an invoice template, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |
| `invoices/estimate.write` | change | optional | Reserved, no screen yet: changing an estimate, after a preview. Optional, for later features, nothing uses it yet. Not used yet. |

## Lead intake

Which form, survey or funnel each lead came from, so you can see which one brings good leads and which one goes quiet.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `forms.readonly` | read | optional | The names of your forms and when each was submitted, to count submissions per form and warn you when one goes quiet. SubSync never reads the answers. Without it Lead intake says: Needs permission, reconnect. |
| `surveys.readonly` | read | optional | The same for surveys and applications: names and submission times only, never the answers. |
| `funnels/funnel.readonly` | read | optional | The names and number of steps of your funnels, so a lead whose source carries a funnel name can be shown under it. Funnel views and conversion are not available from the platform. |
| `funnels/page.readonly` | read | optional | The names of the pages inside each funnel, for the Lead intake health screen (planned), so a funnel with a missing or empty page is found. Page names only. Optional. Not used yet. |
| `funnels/pagecount.readonly` | read | optional | How many pages a funnel has, for the Lead intake health screen (planned). A count only. Optional. Not used yet. |
| `funnels/redirect.readonly` | read | optional | The redirects set on your funnels, for the Lead intake health screen (planned), to find one that sends visitors to the wrong place. Read only. Optional. Not used yet. |
| `links.readonly` | read | optional | The trigger links in each client account, for the Lead intake health screen (planned), to find links that stopped working. Link names and addresses only. Optional. Not used yet. |

## Email health

No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile.

## Not requested, and why

| Permission | Why it is not asked for |
| --- | --- |
| `users.write` | Adding, changing or removing team members. Not asked for: SubSync never manages people. |
| `saas/company.read` | Reading your clients' plans and payment status. Not asked for: the platform only gives it to apps installed at company level, so it can never be granted to this app. |

## Rules for every change permission

Show exactly what will change, require a typed confirmation, keep the old values so it can be undone, write an audit entry, and refuse when the permission was declined. Nothing in SubSync changes your data without a preview, except the note added to a matched contact when a meeting summary arrives (switchable in Settings).
