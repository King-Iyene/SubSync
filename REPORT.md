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

### Landed and verified (commit, deploy build success, live probes ok, and checked on real KD Squares Test data inside GHL)

| Batch | Commit | What shipped |
| --- | --- | --- |
| 1 | `20a2cba` | 7.11 data freshness strip with a stale warning after 6 hours; 11.4 connection health card (failed jobs, last sync, token refresh); 11.5 per-account sync status with a Resync button. Also fixed a bug found by the new tests: a malformed account id on the resync route fell through and started a full sync. |
| 2 | `6d65273` | New **Pipeline** page: 2.1 stage funnel (estimated from current positions, no stage history is kept), 2.2 average time to win, 2.3 stage dwell and bottleneck flag, 2.4 revenue forecast with worst/likely/best and 30/60/90 day view, 2.5 wins and losses by month, 2.6 deal risk score (0 to 100, with reasons), 2.8 deal size distribution, 2.9 pipeline value trend, 2.11 aging buckets, 2.15 account comparison, 2.16 abandoned deals worth reopening, 2.20 pipeline coverage against a saved monthly target, 2.21 dead pipeline cleanup list, 2.22 every pipeline in one table. |
| 3 | `284a36e` | New **Leads** page: 3.4 lead quality score (rule-based, fixed weights), 3.5 lifecycle, 3.6 lead aging, 3.9 inactive contacts (never engaged vs went silent), 3.10 contact growth with per-account change, 3.11 tag usage plus duplicate-looking tags, 3.15 invalid and disposable email and invalid phone detection with examples, 3.18 VIP contacts with a "reach out" flag, 3.19 large import detection, 3.20 same person in several client accounts. |
| 4 | `eb5f75a` | New **Call lists** page: 8.1 eight preset queues plus a custom filter builder, 8.2 saved lists, 8.3 priority score, 8.4 call outcome logger with auto-advance, 8.5 follow-up queue, 8.6 power hour timer with session stats, 8.8 newest-leads queue with a speed-to-lead alert, 8.9 win-back list, 8.10 recent customers for referral requests. |

Tests: 111 unit tests and an expanded HTTP integration check (`npm run check:api`, now run through `scripts/with-dev-server.mjs`) pass. `scripts/deploy-check.sh` runs after every push.

Database change: one **additive** migration (`20261030000000_insights_tables.sql`: account_profiles, goals, call_lists, call_outcomes). No existing data was changed or removed.
