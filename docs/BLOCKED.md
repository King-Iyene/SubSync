# Blocked (what was tried, what would unlock it)

## Lead flow: reply step for leads older than 14 days (5 Nov 2026)
- **Tried:** the reply check (`lead_touches`) is built by the sync from conversations of the last 14 days only (`SPEED_WINDOW_DAYS` in `src/lib/sync/engine.ts`). Older leads have no check, so whether a person replied is not known.
- **On screen:** those leads are a grey "Not checked" step with a one-line explanation, never counted as replied or never answered. Booking, show up and no-show use appointments and are known for every lead.
- **Unlocks it:** a longer first-reply window in the sync (cost: more conversation reads per sync), then history fills in forward. Not changed here (it multiplies API calls); King to decide.

## Workflows module (4 Nov 2026)

| What | Tried | Unlocks it |
|---|---|---|
| Rename a workflow without pausing it | Operation catalogue: the only rename path is the full definition update, which the platform refuses for a published workflow (409) | A rename-only call from the platform. Today SubSync pauses and republishes, only when ticked |
| Campaign rename, pause, schedule control | Searched campaign operations: list, get and per-campaign statistics exist; the write calls found are for email drafts (`emails/campaigns.write`, create, update a draft, schedule) | A decision from King to ask for `emails/campaigns.write` (it can also start a send, which the brief forbids) |
| Contacts behind a delivery number (who bounced, opened, unsubscribed) | Searched email, conversation and contact operations: only per-campaign totals and a message export by location | A per-recipient delivery listing from the platform |
| Delivery by day and hour | Statistics answer is totals per campaign, no timeline | A time-bucketed statistics call |
| Who is inside a workflow right now | Logs show enrolments and exits in the last 60 days only | A "contacts currently in workflow" call. Delete uses an estimate from the logs instead |
| Folders and tags on a workflow in the CRM | No write call for either | Folders and labels stay in SubSync only |
| Live test of any of this | No real account was touched; no write call was made | A test client account and `WORKFLOWS_WRITE_LIVE=true` on a preview deployment |

| Live probe of the Workflows API | Ran scripts/wf-probe.mts: the live install has no workflow permissions, and this machine has no platform client credentials | King reconnects the install with the optional workflow permissions, then runs the script |

| Next charge date, failed-payment reason, apps other than SubSync per account, bulk install and buying an app for all accounts (Clients v3) | Read the official SaaS, marketplace, wallet and installer pages and searched help articles (docs/research/CLIENTS_V3_R1.md): no field or endpoint gives them. Installed-locations takes an app id but is likely limited to our own app | A platform endpoint for per-account subscription dates and app installs; until then Money says "Not available from the platform yet" and links to the CRM |
| Live probe of billing endpoints (Clients v3) | A probe needs a token refresh, which rotates the refresh token in the live database, so it was not run from a copied key | King runs `node --env-file=.env.local --import tsx scripts/saas-probe.mts [other app id]` once and sends back the output (status words, field names) |

## Scopes with no honest screen yet (14 Nov 2026, More tools build)
Checked in the platform's own operation catalogue; no real account was called (a probe needs a token refresh, which rotates the live refresh token).

| Permission | Tried | What would unlock it |
|---|---|---|
| `notes.readonly`, `notes.write` | Notes on a contact are read with `contacts.readonly` and added with `contacts.write` (GET and POST /contacts/{id}/notes). The platform does not ask for these two names | The platform tying notes to its own permission. The notes screens keep using the contact permissions |
| `locations.features.read`, `saas/location.read` | GET /locations/{id} asks for `locations.readonly` and lists no feature or SaaS field; no SaaS read exists for a client-account key | A platform read for features switched on or the SaaS plan of one account |
| `lc-email.readonly` | Searched for sending domain, sending address and verification reads: only email verification (a write) and conversation email lookups exist | A read that lists sending domains or addresses |
| `conversations/reports.readonly` | Searched for a conversation report or response-time operation: none exists | A response-time report endpoint. Speed to lead keeps SubSync's own measured numbers |
| `conversations/livechat.write` | The only operation is a typing indicator for website chat and it needs a visitor id the contact record does not give yet | The platform adding the visitor id to the contact read |
| `invoices/schedule.write` | Create invoice schedule exists, but it needs a saved template, a contact and a rule in one step | A decision on the simplest honest version: a repeating invoice from a saved template, after a preview |
| `locations/tasks.write` | No operation asks for it | Removed from the list on King's decision (79 permissions) |
