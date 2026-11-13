# Permissions SubSync asks for, and why

This file is generated from `src/lib/scope-groups.ts` (run `scripts/gen-scopes-doc.ts`). A test fails when it is stale, when a permission the app asks for is missing from it, or when it lists one the app does not ask for. Do not edit it by hand.

SubSync asks for 40 permissions: 7 required and 33 optional. Fewer permissions is a trust advantage, and every permission added later makes every installed company approve again, so each one below has a reason. An optional permission can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.

Wording rule: the screen says one of three things. **Needs permission: reconnect** (the app asked and this install declined, or the app has not asked yet), **Not available from the platform yet** (the platform refuses even with the permission, or has no such data), or it simply shows the data. See `docs/CAPABILITIES.md` for which data point is which.

## Your client accounts

Which accounts SubSync is connected to, and the one-account-at-a-time access it reads them with.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `locations.readonly` | read | required | Names, time zones and contact details of your client accounts, so every number is shown against the right account and clock. |
| `oauth.readonly` | read | required | Lists the accounts SubSync is installed on, so a new account is found without you doing anything. |
| `oauth.write` | change | required | Lets SubSync read one client account at a time with a key limited to that account. The platform offers no read-only way to do this. It changes nothing in your accounts. |

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
| `opportunities.write` | change | optional | Reserved for a later, previewed action on deals. Nothing in SubSync uses it today. |

## Conversations and calls

Who wrote to a lead, when, and whether a person or an automation did.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `conversations.readonly` | read | required | The conversation list: last message, direction, channel and unread count, for unanswered messages. Message text is never copied. |
| `conversations/message.readonly` | read | optional | The messages inside a conversation, only to see who sent each one and when (a person or an automation, a call or a text). This is the only way to measure true speed to lead. The text of a message is never stored. |
| `conversations/reports.readonly` | read | optional | For coming, richer response-time numbers (conversation reports). Not used yet: nothing in SubSync uses it today, and skipping it changes nothing. |

## Appointments

Bookings and what happened to them.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `calendars.readonly` | read | required | Calendars, for the setup checklist and to know which calendars exist. |
| `calendars/events.readonly` | read | optional | Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list. |
| `calendars/groups.readonly` | read | optional | Calendar groups, so every calendar can be listed under its group, even one with no bookings. |
| `calendars/resources.readonly` | read | optional | Reserved for rooms and equipment. Not used yet. |
| `calendars/events.write` | change | optional | Reserved for marking an appointment showed or no-show after a preview. Nothing in SubSync uses it today. |

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
| `locations/customFields.readonly` | read | optional | Reserved for lead-source detail. Not used yet. |
| `locations/tasks.readonly` | read | optional | For coming follow-up checks on your team's tasks. Not used yet: nothing in SubSync uses it today, and skipping it changes nothing. |
| `locations/customFields.write` | change | optional | For coming data cleaning that fixes custom field values, always after a preview. Not used yet: nothing in SubSync uses it today, and skipping it changes nothing. |
| `locations/tags.write` | change | optional | For coming tagging help, always after a preview. Not used yet: nothing in SubSync uses it today, and skipping it changes nothing. |
| `locations/tasks.write` | change | optional | For coming follow-up tasks created for your team, always after a preview. Not used yet: nothing in SubSync uses it today, and skipping it changes nothing. |

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
| `saas/location.read` | read | optional | Optional. Not used by the Billing view today. |
| `saas/company.read` | read | optional | The plan and subscription status each client account has on your plans, for the Billing view in Clients. Without it the view says: Needs permission, reconnect. |

## Payments and credit

Failed and late payments, so you can chase the money, and the credit balance of each client account.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `payments/transactions.readonly` | read | optional | Each payment's status, amount and who paid, to list failed payments and refunds. Read only: SubSync cannot charge, refund or retry anything. Without it Payments says: Needs permission, reconnect. |
| `payments/subscriptions.readonly` | read | optional | Whether a customer's repeat payment is active or past due, to list failed repeat payments. Read only. |
| `invoices.readonly` | read | optional | Which invoices are sent, partly paid or paid and when they are due, to list late invoices. Read only: SubSync never sends or changes an invoice. |
| `wallet.readonly` | read | optional | The credit balance of each client account, to warn you before it runs out. Read only. |
| `marketplace-installer-details.readonly` | read | optional | Which plan each install is on, to double-check billing against our own records. Read only. |

## Lead intake

Which form, survey or funnel each lead came from, so you can see which one brings good leads and which one goes quiet.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `forms.readonly` | read | optional | The names of your forms and when each was submitted, to count submissions per form and warn you when one goes quiet. SubSync never reads the answers. Without it Lead intake says: Needs permission, reconnect. |
| `surveys.readonly` | read | optional | The same for surveys and applications: names and submission times only, never the answers. |
| `funnels/funnel.readonly` | read | optional | The names and number of steps of your funnels, so a lead whose source carries a funnel name can be shown under it. Funnel views and conversion are not available from the platform. |

## Email health

No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile.

## Not requested, and why

| Permission | Why it is not asked for |
| --- | --- |
| `invoices.write` | Sending an invoice again. Not asked for: it would message your client's customer, and SubSync does not message anyone for you. |
| `conversations.write` | Deleting a conversation. Not asked for: SubSync does not delete anyone's conversations. |
| `conversations/message.write` | Sending messages. Never asked for: SubSync does not reply to anyone, it measures how fast your team does. |

## Rules for every change permission

Show exactly what will change, require a typed confirmation, keep the old values so it can be undone, write an audit entry, and refuse when the permission was declined. Nothing in SubSync changes your data without a preview, except the note added to a matched contact when a meeting summary arrives (switchable in Settings).
