# Feedback: what people send, what King is told, where King reads it

## Who uses it and what happens next

- Anyone in the app (agency owner, setter, client admin) can use "Give feedback", "Report a problem" or "Suggest something". They see "Thanks, we read every one" and a reference. We promise no reply time.
- King (platform owner) reads everything in the **Feedback (owner)** screen, and is pushed a message only when someone is stuck. If the screen were missing, King could only read feedback through a secret-protected route.

## What King is told (defaults)

| Item | Alert | Where it shows |
|---|---|---|
| "I am stuck" (severity blocking), and every "Report a problem" | **Instant, urgent**: email and/or Slack | Inbox |
| "Something annoying" | Nothing | Inbox, "new" count |
| Ideas, normal feedback, suggestions, roadmap votes | Nothing | Inbox, "new" count |
| Optional daily summary (off by default) | One message a day: counts by kind and severity, newest 5 | Inbox |

King can change this inside the inbox (the owner setting wins over the defaults): **Instant alerts for**: only stuck / stuck and annoying / everything; **Send me a daily summary**: on/off.

### What an instant alert says

Subject (email) and first line (Slack):
`[URGENT] New feedback: problem, blocking, from <company name (short id)>, page <page>`
then the reference (R-xxxxxx), a link to the Feedback inbox, and, only if you turned it on, a 160-character excerpt (emails and phone numbers removed). The default is ids and severity only.

### Rules that always hold

- **Dry run by default.** The global switches `SEND_EMAIL_LIVE` and `SEND_SLACK_LIVE` (exactly `true` to turn on) decide whether anything leaves. With a switch off, nothing is sent and the audit log gets `notify.king.alert_dry_run` with exactly what would have gone (kind, severity, account short id, page, and an excerpt only if `FEEDBACK_NOTIFY_INCLUDE_TEXT=true`). Each channel is judged separately.
- **Rate limit and dedupe.** One alert per severity per 10 minutes. Extra ones are counted (`notify.king.held`) and the next alert says "N more of this kind". The same item never alerts twice.
- **Failures never reach the sender.** The alert runs after the answer is sent; any error is logged (`notify.king.failed`) and the person's submission is already saved.
- **No contact data, no tokens.** The addresses (`FEEDBACK_NOTIFY_EMAIL`, `FEEDBACK_SLACK_WEBHOOK`) are never logged or shown (the inbox shows only "set / not set" and whether the switches are on). The Slack address is only called if it is a real `hooks.slack.com` address.
- Nothing is promised to customers about alerts; the screens only say "we read every one".

## How to turn it on (Vercel, Production environment variables)

Names only; King sets the values.

| Variable | Needed for | Notes |
|---|---|---|
| `PLATFORM_OWNER_COMPANY_IDS` | Seeing the inbox | Comma list of company ids. Matches an **agency** session only. |
| `PLATFORM_OWNER_EMAILS` | Seeing the inbox (alternative) | Comma list of sign-in emails. Read at sign-in only, never stored. |
| `FEEDBACK_NOTIFY_EMAIL` | Email alerts | King's address. |
| `FEEDBACK_SLACK_WEBHOOK` | Slack alerts | An incoming webhook URL (https://hooks.slack.com/...). |
| `SEND_EMAIL_LIVE` / `SEND_SLACK_LIVE` | Really sending | Existing global switches. Leave off to rehearse. |
| `FEEDBACK_NOTIFY_INCLUDE_TEXT` | Excerpt in alerts | Default off (ids and severity only). |
| `FEEDBACK_DIGEST` | Daily summary | `daily` to start with it on. The inbox switch overrides it once used. Default off. |

The daily summary is sent by the cron `/api/cron/feedback-digest` (08:00 UTC) and only if it is on; it never sends twice in 20 hours.

## The inbox (owner only)

Menu item **Feedback (owner)** with a count of new items. Visible only to the platform owner: everyone else never sees the item, and the routes under `/api/app/owner/feedback` answer **404** to anyone else (also to business and client sessions and to the demo).

Inside: newest first; kind, severity, account (short id, plus the name when known), page, date, status (new / seen / planned / done / won't fix); search and filters (kind, severity, status); status changes (each writes the audit line `feedback.status_changed`); vote counts for roadmap items; the last alert record per severity; the delivery status. What people typed is shown as plain text (escaped). Customer contacts are never read.

Tables (migration `20261231320000_feedback_owner.sql`, additive): `feedback_triage`, `feedback_owner_settings`, `feedback_alert_state`. Customers still see only their own submissions (`feedback_items`, `roadmap_suggestions` are unchanged).

## Follow-ups (not built)

- Replying to a sender from the inbox.
- Notifying voters when an item ships (the dry-run line exists; real delivery needs its own review).
