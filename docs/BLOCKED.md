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
