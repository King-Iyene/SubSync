# SubSync: what is built

Everything below is implemented, covered by unit tests or the integration checks (`npm test`, `npm run check:db`, `npm run check:api`), and visible in demo mode. None of it has run against a real GoHighLevel agency yet; see `MORNING_CHECKLIST.md`.

Public wording says "client accounts", never "sub-accounts" or the platform name.

## Dashboard views

| View | What it does |
| --- | --- |
| Overview | KPIs across every client account, "needs attention" list with reasons, account health bands, sync status, print-friendly summary. |
| Accounts | Sortable, filterable table of all accounts with score, churn risk, dormancy, pipeline value and CSV export. |
| Account detail | Score breakdown (5 explainable components), 90-day trends, stale deals, onboarding checklist, email health, alerts, notes and controls (ignore, owner), printable client report. |
| Search | One search box across contacts in every client account (name, email, phone). |
| Deals | Three tabs: stale deals across accounts, pipeline roll-up by stage, and deal hygiene (deals with no value, no contact, no owner or no movement). |
| Inbox | Conversations waiting on a reply past your SLA, across accounts. |
| Onboarding | New-account checklist (automatic checks plus manual and custom items) with completion percentage. |
| Email health | SPF, DKIM, DMARC and MX checks per sending domain with plain-English fixes. |
| Duplicates | Duplicate contacts within an account. |
| Alerts | Deduplicated alerts: dormant, SLA breach, stale revenue, email problems, lead-flow drop. Resolve automatically when the cause clears. |
| Settings | Thresholds (stale, dormant, SLA), Slack digest webhook and test, AI connector keys, data deletion. |

## Analytics

- **Engagement score** 0 to 100 from five components, each with the reason it scored that way. Bands: thriving, healthy, watch, at risk.
- **Dormancy** from last real activity, not logins.
- **Churn risk** (low, medium, high) from score history and activity trend, with reasons.
- **Revenue at risk**: value of stale open deals. **Expected revenue**: open value times each account's own win rate (needs at least 5 closed deals). **Slow follow-up cost**: waiting conversations times deal value times win rate (clearly labelled an estimate).
- **Lead-flow drop alert**: new contacts in the last 30 days down 50% or more against the account's own baseline. Needs 7 or more days of history and a baseline of at least 10, and is suppressed on accounts already flagged dormant.
- **Weekly Slack digest** (cron, Mondays 08:00 UTC) and on-demand "send now". Only `hooks.slack.com` webhooks are accepted.
- **CSV exports** with spreadsheet formula-injection protection.

## AI connector (MCP)

Agencies create read-only API keys in Settings (`sk_subsync_...`, shown once, stored as a SHA-256 hash, 5 keys max, revocable). Any MCP-capable AI assistant can then point at `/api/mcp` and ask questions such as "which clients are going dormant" or "list stale deals over $5,000".

Tools: `portfolio_summary`, `list_accounts`, `get_account`, `search_contacts`, `list_stale_deals`, `list_waiting_conversations`, `list_alerts`. Rate limited to 60 requests a minute per key. Revoked keys stop working immediately. It never writes anything.

## Platform plumbing

- **Install**: OAuth with bulk install, company token exchanged for per-account tokens, installed-locations sync.
- **Sign-in**: single sign-on from inside the host app, agency users only.
- **Sync**: job queue with `FOR UPDATE SKIP LOCKED`, time-budgeted slices, cron every 5 minutes, daily refresh, per-account rate limiting and backoff. Webhooks (Ed25519 verified) trigger targeted re-syncs.
- **Tokens**: AES-256-GCM at rest, refresh rotation with compare-and-swap.
- **Plan gating**: free up to 5 client accounts (overview, search, onboarding, settings); everything else paid. Off unless `ENFORCE_PLANS=true`. Price is a setting, not a constant.
- **Data control**: "Delete my data" in Settings (typed confirmation) wipes synced data; uninstall purges everything.
- **Demo mode** (`DEMO_MODE=true`): 14 fictional agencies' worth of accounts with realistic history, for screenshots and the portal demo video. Off in production.

## Not built (ideas from research, not promised)

Scheduled client report emails (needs an email provider), configurable score weights, per-account goals and alert rules, AI-written weekly digest, cross-agency benchmarks (needs many installs), setup comparison between accounts, anything touching workflows (API is closed beta).
