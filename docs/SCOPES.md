# Permissions SubSync asks for, and why

This file is generated from `src/lib/scope-groups.ts` (run `scripts/gen-scopes-doc.ts`). A test fails when it is stale, when a permission the app asks for is missing from it, or when it lists one the app does not ask for. Do not edit it by hand.

SubSync asks for 79 permissions: 7 required and 72 optional. Fewer permissions is a trust advantage, and every permission added later makes every installed company approve again, so each one below has a reason. An optional permission can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.

Wording rule: the screen says one of three things. **Needs permission: reconnect** (the app asked and this install declined, or the app has not asked yet), **Not available from the platform yet** (the platform refuses even with the permission, or has no such data), or it simply shows the data. See `docs/CAPABILITIES.md` for which data point is which.

## Your client accounts

Which accounts SubSync is connected to, and the one-account-at-a-time access it reads them with.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations.readonly` | read | required | Names, time zones and contact details of your client accounts, so every number is shown against the right account and clock. |
| `oauth.readonly` | read | required | Lists the accounts SubSync is installed on, so a new account is found without you doing anything. |
| `oauth.write` | change | required | Lets SubSync read one client account at a time with a key limited to that account. The platform offers no read-only way to do this. Changes in your accounts only happen after you preview and confirm, are logged, and can be undone where possible. |
| `locations.features.read` | read | optional | Kept for a later feature, nothing uses it yet: the platform's public description lists no read that this permission unlocks, so Account setup cannot show which features an account has switched on. Optional. Not used yet. |

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
| `conversations/reports.readonly` | read | optional | Kept for a later feature, nothing uses it yet: response-time totals the platform already calculates, to compare with SubSync's own numbers. Optional. Not used yet. |
| `conversations/livechat.write` | change | optional | Kept for a later feature, nothing uses it yet: the platform uses it only to show a typing indicator to a website chat visitor, which needs a visitor id the contact record does not give yet. Optional. Not used yet. |

## Appointments

Bookings and what happened to them.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `calendars.readonly` | read | required | Calendars, for the setup checklist and to know which calendars exist. |
| `calendars/events.readonly` | read | optional | Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list. |
| `calendars/groups.readonly` | read | optional | Calendar groups, so every calendar can be listed under its group, even one with no bookings. |
| `calendars/resources.readonly` | read | optional | Rooms and equipment, for Clients > Health > Account setup, which flags a calendar that points to a room or item that no longer exists. Read only. Optional. |
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
| `locations/tags.write` | change | optional | Only to create a missing call queue tag from Settings > Targets > Call queues (Create this tag), after a preview and a confirm. Optional. Without it the button says: Needs permission, reconnect. |

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
| `saas/location.read` | read | optional | Optional. Requested for the Plans and payments block on the Clients screen. Honest status: the platform's public API description lists no read that this permission unlocks (the plan reads ask for saas/company.read, company level), so no screen reads anything with it and the block shows Needs permission or Not available. Kept for a later feature. Not used yet. |

## Payments and credit

Failed and late payments, so you can chase the money, and the credit balance of each client account.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `payments/transactions.readonly` | read | optional | Each payment's status, amount and who paid, to list failed payments and refunds. Read only: SubSync cannot charge, refund or retry anything. Without it Payments says: Needs permission, reconnect. |
| `payments/subscriptions.readonly` | read | optional | Whether a customer's repeat payment is active or past due, to list failed repeat payments. Read only. |
| `invoices.readonly` | read | optional | Which invoices are sent, partly paid or paid and when they are due, to list late invoices. Read only: SubSync never sends or changes an invoice. |
| `wallet.readonly` | read | optional | The credit balance of each client account, to warn you before it runs out (Clients > account page, Money). Read only. The platform's public API description names no permission for the wallet calls, so whether this one is accepted is not confirmed; if it is refused the screen says Needs permission or Not available. |
| `marketplace-installer-details.readonly` | read | optional | The platform's install record for your company (plan id and install date), shown as Install record on Clients > Money and plans for company owners and administrators, and compared with the plan SubSync recorded. Optional. |

## Money checks

Orders, invoices, products and payment setup, shown in Money > Client payments > Money checks (one client account at a time, read live, nothing stored). All read only. Optional.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `payments/orders.readonly` | read | optional | Orders and their payment status, for Money > Client payments > Money checks (recent orders), to find orders that were never paid, and for the Orders and payments panel on a lead. Read only. Optional. |
| `payments/coupons.readonly` | read | optional | The discount codes in each client account, for Money > Client payments > Money checks, to find expired or unlimited ones. Read only. Optional. |
| `payments/integration.readonly` | read | optional | Whether a payment provider is connected and in live or test mode, for Money > Client payments > Money checks, so a client taking test payments is caught. Read only. Optional. |
| `payments/custom-provider.readonly` | read | optional | Whether a custom payment provider is set up, for Money > Client payments > Money checks. Only the provider name is used, never its keys. Read only. Optional. |
| `charges.readonly` | read | optional | Charges apps made through the platform's billing meters, for Money > Client payments > Money checks and for the last charge in the plan monitor (Clients > Money and plans). Read only. Optional. SubSync has no billing meters, so an empty list is expected. |
| `products.readonly` | read | optional | The products you sell, for Money > Client payments > Money checks, to find a product without a price. Read only. Optional. |
| `products/prices.readonly` | read | optional | The prices set on each product (the first 20 products), for Money > Client payments > Money checks, to find a missing or zero price. Read only. Optional. |
| `products/collection.readonly` | read | optional | Product collections, for Money > Client payments > Money checks, to find an empty one. Read only. Optional. |
| `invoices/schedule.readonly` | read | optional | Repeating invoice schedules, for Money > Client payments > Money checks, to find one that stopped. Read only. Optional. |
| `invoices/template.readonly` | read | optional | Invoice templates, for Money > Client payments > Money checks, to find an account with none set up. Read only. Optional. |
| `invoices/estimate.readonly` | read | optional | Estimates and whether they were accepted, for Money > Client payments > Money checks, to find estimates nobody followed up. Read only. Optional. |

## Account setup check

What each client account has set up, shown in Clients > Health > Account setup: which pipelines, templates, numbers and files exist and what is missing. Counts and names only, all read only. A few permissions here are kept for a later feature and say so. Optional.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `pipelines.readonly` | read | optional | Only to read one pipeline and its stages just before a stage is renamed (Clients > Health > Account setup > Rename a pipeline stage). The list of pipelines on every other screen uses opportunities.readonly. Optional. |
| `objects/schema.readonly` | read | optional | The names of custom record types, for Clients > Health > Account setup. Names only. Optional. |
| `objects/record.readonly` | read | optional | How many records each custom record type holds, for Clients > Health > Account setup. A count only. Optional. |
| `notes.readonly` | read | optional | Kept for a later feature: the platform asks for contacts.readonly to read notes on a contact, so the Notes list in the lead panel uses that. Optional. Not used yet. |
| `locations/customValues.readonly` | read | optional | The names of the custom values (company name, links, hours) set in each client account, for Clients > Health > Account setup and to check the reply target in Settings > Targets > Call queues. Optional. |
| `locations/templates.readonly` | read | optional | The names of the text and email templates in each client account, for Clients > Health > Account setup. Names only. Optional. |
| `locations/tasks.readonly` | read | optional | Open and overdue tasks, as counts, for Clients > Health > Account setup, to find tasks nobody is doing. Optional. |
| `recurring-tasks.readonly` | read | optional | Only to read back the repeating follow-up SubSync has just made, so Saved means the platform really has it. The platform has no list of repeating tasks, so nothing else is read. Optional. |
| `files.readonly` | read | optional | Kept for a later feature, nothing uses it yet: in the platform's documentation this permission only opens one shared file by its link. The file count in Clients > Health > Account setup uses the file list, which the documentation says needs a different permission (medias.readonly) that is not in the listing, so that row shows Not available until it is added. Optional. Not used yet. |
| `lc-email.readonly` | read | optional | Kept for a later feature, nothing uses it yet: the platform's public description has no read it unlocks, so Account setup cannot show sending addresses. Optional. Not used yet. |
| `emails/builder.readonly` | read | optional | How many saved email designs each client account has, for Clients > Health > Account setup. A count only. Optional. |
| `emails/schedule.readonly` | read | optional | Emails scheduled to go out, as a count, for Clients > Health > Account setup. Read only. Optional. |
| `emails/templates.readonly` | read | optional | The names and dates of email templates, for Clients > Health > Account setup > Email templates. Never what is inside a template. Optional. |
| `phonenumbers.read` | read | optional | The phone numbers of each client account (only the last four digits are shown), for Clients > Health > Account setup, to find an account with no number to call or text from. Optional. |
| `numberpools.read` | read | optional | Number pools (groups of sending numbers), for Clients > Health > Account setup, to find an empty pool. Optional. |

## Set-up changes and reserved

Permissions for small, one-time set-up changes (a tag, a pipeline, a reply target), each behind a preview and a confirm, and permissions kept for later features so a later feature never forces every install to approve again. A reason that says nothing uses it yet is true today, and every future use would show a preview first.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations/customValues.write` | change | optional | Only to save one value, the reply target (subsync_sla_minutes), from Settings > Targets > Call queues (Set up your CRM), after a preview and a confirm. Optional. |
| `recurring-tasks.write` | change | optional | Only to add a repeating follow-up task on one contact, from the lead panel (Follow-up and quotes), after a preview and a confirm. It always ends after a set number of repeats. Optional. Without it the button says: Needs permission, reconnect. |
| `notes.write` | change | optional | Kept for a later feature: the platform asks for contacts.write to add a note, so notes and meeting summaries use that. Optional. Not used yet. |
| `pipelines.write` | change | optional | Only to rename one pipeline stage (Clients > Health > Account setup > Rename a pipeline stage), after a preview and a confirm. Stage order stays and no deal moves. Optional. |
| `pipelines.create` | change | optional | Only to create the standard sales pipeline from Settings > Targets > Call queues (Set up your CRM), and only when the account has no pipeline, after a preview and a confirm. Optional. |
| `invoices.write` | change | optional | Only to save one unsent invoice for a contact, from the lead panel (Follow-up and quotes), after a preview and a confirm. SubSync never sends an invoice, and the resend button is switched off. Optional. |
| `invoices/schedule.write` | change | optional | Kept for a later feature, nothing uses it yet: pausing or changing a repeating invoice, after a preview. Optional. Not used yet. |
| `invoices/template.write` | change | optional | Only to save one invoice template, from the lead panel (Follow-up and quotes), after a preview and a confirm. Optional. |
| `invoices/estimate.write` | change | optional | Only to save one unsent estimate for a contact, from the lead panel (Follow-up and quotes), after a preview and a confirm. SubSync never sends it. Optional. |

## Lead intake

Which form, survey or funnel each lead came from, so you can see which one brings good leads and which one goes quiet.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `forms.readonly` | read | optional | The names of your forms and when each was submitted, to count submissions per form and warn you when one goes quiet. SubSync never reads the answers. Without it Lead intake says: Needs permission, reconnect. |
| `surveys.readonly` | read | optional | The same for surveys and applications: names and submission times only, never the answers. |
| `funnels/funnel.readonly` | read | optional | The names and number of steps of your funnels, so a lead whose source carries a funnel name can be shown under it. Funnel views and conversion are not available from the platform. |
| `funnels/page.readonly` | read | optional | The names of the pages inside each funnel, for Clean-up > Lead intake (Funnel pages), so a funnel with a missing or empty page is found. Page names only. Optional. |
| `funnels/pagecount.readonly` | read | optional | How many pages a funnel has, for Clean-up > Lead intake (Funnel pages). A count only. Optional. |
| `funnels/redirect.readonly` | read | optional | The redirects set on your funnels, for Clean-up > Lead intake (Redirects and trigger links), to find one with an empty target. Read only. Optional. |
| `links.readonly` | read | optional | The trigger links in each client account, for Clean-up > Lead intake (Redirects and trigger links), to find a link with an empty target. Link names and addresses only. Optional. |

## Email health

No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile.

## Not requested, and why

| Permission | Why it is not asked for |
| --- | --- |
| `users.write` | Adding, changing or removing team members. Not asked for: SubSync never manages people. |
| `saas/company.read` | Reading your clients' plans and payment status. Not asked for: the platform only gives it to apps installed at company level, so it can never be granted to this app. |

## Rules for every change permission

Show exactly what will change, require a typed confirmation, keep the old values so it can be undone, write an audit entry, and refuse when the permission was declined. Nothing in SubSync changes your data without a preview, except the note added to a matched contact when a meeting summary arrives (switchable in Settings).
