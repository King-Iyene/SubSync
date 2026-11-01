# Permissions SubSync asks for, and why

This file is generated from `src/lib/scope-groups.ts` (run `scripts/gen-scopes-doc.ts`). A test fails when it is stale, when a permission the app asks for is missing from it, or when it lists one the app does not ask for. Do not edit it by hand.

SubSync asks for 21 permissions: 7 required and 14 optional. Fewer permissions is a trust advantage, and every permission added later makes every installed company approve again, so each one below has a reason. An optional permission can be declined: the feature that needs it then says "Needs permission: reconnect" and everything else keeps working.

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
| `conversations/reports.readonly` | read | optional | Reserved for conversation reports. Not used yet. |

## Appointments

Bookings and what happened to them.

| Permission | Kind | Required | Why we ask |
| --- | --- | --- | --- |
| `calendars.readonly` | read | required | Calendars, for the setup checklist and to know which calendars exist. |
| `calendars/events.readonly` | read | optional | Appointments and their status (showed, no-show, never marked), for the appointment checks and the no-show list. |
| `calendars/groups.readonly` | read | optional | Reserved for calendar groups. Not used yet. |
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
| `locations/tasks.readonly` | read | optional | Reserved for task follow-up checks. Not used yet. |
| `locations/tags.write` | change | optional | Reserved for tagging after a preview. Nothing in SubSync uses it today. |
| `locations/tasks.write` | change | optional | Reserved for creating follow-up tasks after a preview. Nothing in SubSync uses it today. |

## Email health

No permission needed. SubSync checks the sending domain's public DNS records (SPF, DKIM, DMARC) from the domain it finds on the account's profile.

## Not requested, and why

| Permission | Why it is not asked for |
| --- | --- |
| `payments/transactions.readonly` | Failed payments and wallet balance. Not asked for: financial permissions cost trust and no feature needs them yet. |
| `invoices.readonly` | Invoices. Not asked for, for the same reason. |
| `workflows.readonly` | Whether automations are running. Not asked for: the platform limits this to some accounts, so SubSync watches the results (leads left unanswered) instead. |
| `forms.readonly` | Form-by-form lead source. Not asked for yet. |
| `marketplace-installer-details.readonly` | Reading each install's plan, to double-check billing. Planned for a later release. |
| `conversations/message.write` | Sending messages. Never asked for: SubSync does not reply to anyone, it measures how fast your team does. |

## Rules for every change permission

Show exactly what will change, require a typed confirmation, keep the old values so it can be undone, write an audit entry, and refuse when the permission was declined. Nothing in SubSync changes your data without a preview, except the note added to a matched contact when a meeting summary arrives (switchable in Settings).
