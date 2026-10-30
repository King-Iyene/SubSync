# Overnight report: SubSync feature encyclopedia (in progress)

Source spec: `SubSync_Full_Feature_Encyclopedia.md` (184 features, 14 sections). This file is updated as work lands.
Rules followed: small commits to `main`, deploy checked after every push, no destructive database changes, no env var, secret, billing or payment changes.

## How each item was triaged

Every feature was checked against the data SubSync actually syncs today: contacts (name, email, phone, tags, dates), deals (pipeline, stage, value, status, stage dates), conversations (last message type, direction, time, unread) and daily account metrics. It does **not** sync appointments, users, tasks, workflows, lead source, custom fields, DND flags, call logs or message bodies.

| Section | Status |
| --- | --- |
| 1. Appointments (28) | **Blocked**: needs calendar events data and the `calendars/events.readonly` permission, which the app has not been granted. |
| 2. Pipeline and deals (22) | Mostly buildable. See progress below. |
| 3. Contacts and leads (20) | Partly buildable. Source, custom fields, DND and birthdays are not synced. |
| 4. Communication (18) | Partly buildable from last-message data. Response times, sentiment, message content search are not. |
| 5. Team performance (16) | **Mostly blocked**: needs the users data and `users.readonly`, plus per-user activity. |
| 6. Client success (14) | Mostly buildable with manual inputs (fees, renewal dates, notes). Email delivery needs an email provider key. |
| 7. Reporting (12) | Partly buildable. Scheduled email delivery needs an email provider key. |
| 8. Smart call lists (10) | Mostly buildable. Territory queues need users data. |
| 9. Workflows (8) | **Blocked**: Workflows API is closed beta (per-account 403). |
| 10. Compliance (8) | DNS checker already built. The rest needs A2P, email stats or phone data we do not sync. |
| 11. Platform (6) | Partly buildable. |
| 12. AI (10) | **Blocked** where it needs an AI provider key. 12.1 to 12.5 point to `MOAT_FEATURES.md`, which was not attached. |
| 13. Gamification (6) | **Blocked**: needs per-user data; 13.1 to 13.3 point to the missing `MOAT_FEATURES.md`. |
| 14. Client-facing (6) | 14.1 to 14.3 point to the missing `MOAT_FEATURES.md`. A public client link also needs a security decision. |
| Business Mode (second app mode) and the revised pricing table | **Not touched**: needs a second app in the portal, and pricing is billing, which is off limits tonight. |

## Progress

(filled in below as batches land)
