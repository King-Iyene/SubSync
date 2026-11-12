# Morning report, 13 Nov 2026

## Live now (all merged to main, flags ON except `zoom_meet`, `pm_resend`)
- All modules built and merged: Team, Clients, Payments, cash features, Account audit, Today (Today/Proof/Numbers/Settings), Workflows, Clean-up/Data quality/Dedupe, Settings and guides, Find lead, Appointments (+Booking funnel), Wallet and 7am brief, Proof page, Finance, Meetings, Call mode, meeting-note and Slack automation (flags `am_*` ON).
- Today the tab keeps the older layout; Recover tab and the new brief/accounts-to-save/in-this-order/done-today blocks are hidden (code kept; Brief settings, Copy for Slack, Accounts to save list are under Today > Settings).
- Speed to lead: hidden cards restored (the "More" fold now starts open), journey breakdown table, funnel clicks open leads in a side panel, funnel minimum 10 leads.
- Call mode: always a live main button, plain wording, no "Start is off".
- QA rounds 3 and 4 merged: counts equal rows, "waiting" counts unified, plain permission wording, phone-width fixes, read caches (tenant-keyed) and two additive indexes.

## Not verified (honest list)
- Speed to lead, Appointments, Pace: time the first click after deploy. If still over 3 s, next step is a per-account rollup table.
- Light mode and 768 px for every module; Wallet/brief, Meetings and Workflows sub-tabs; Booking funnel clicks.
- Test data (3 contacts, bookings, a deal, call-now tag) NOT created in KD Squares Test yet.
- Today's 24 won-back / 18 / 2 / 23 counts: 23 no-outcome appointments are 51-83 days old (90-day window); not shortened.
- Local tenancy backstop hung; CI tenancy passed on every merged PR.
- 14 stale vitest files are quarantined (not run in CI). One to check: `client-access.test.ts` expects client staff to be refused GET /finance and /team, but access.ts allows them (probably intended).

## Some screens will look empty until the new permissions are granted (not a bug)
Until King publishes release 1.1.0 (docs/RELEASE_1_1_0.md: 14 new optional scopes) and re-approves in each account, these show a plain "Needs permission: reconnect" note instead of data:
- **Money > Client payments / Plans and churn:** failed payments, late invoices, repeat payments, plan status, credit balance (payments, invoices and plan-status permissions).
- **Workflows:** workflow and campaign health (workflows read permission).
- **Appointments and Call mode:** calendar events, users and some conversation/message detail where those optional scopes are missing; Team shows fewer roles/quiet people.
- **Meetings and Find lead:** tags, custom fields and message history depend on their optional scopes.
- **Anything SubSync writes to the CRM** (notes, tasks, tags, call queue, merge/clean-up fixes) stays a dry run until the write scopes are granted AND the account opts in AND WRITE_GHL_LIVE is on. Nothing writes today.
- Test with the KD Squares Test account after re-approving it, then check Money, Workflows and Appointments again.

## What King needs to do after all this (in order)
1. Make the Browser pane wide (it shrank), then tell me; I finish the click-through of every module, every button and text, and create the test data (KD Squares Test only).
2. Portal: Clone as Draft, add the 14 NEW optional scopes, write release notes, publish 1.1.0 (steps in docs/RELEASE_1_1_0.md); then reinstall/re-approve in the test account so the scopes apply.
3. Before any pilot: add the $11.50 plan, delete the $5 plan (section 6 of the release doc), tell me the new plan id.
4. Upgrade the database plan (Find lead is about 715 MB per 1M contacts vs 500 MB).
5. Slack: fix the redirect; create the Slack bot app (needed for one-click setup and DMs).
6. Decide on AI agents and the API key (docs/AI_AGENTS_PLAN.md).
7. Decide when to switch on live sends (SEND_EMAIL_LIVE, SEND_SLACK_LIVE, FATHOM_WEBHOOK_LIVE, WRITE_GHL_LIVE): all OFF now.
8. Review privacy and terms pages; delete `C:\Users\KING\wt` with scripts/clean-wt.ps1.
9. Before pilots, turn test flags off (command below) and remind me.

## Only King can do
1. Release 1.1.0 scopes (docs/RELEASE_1_1_0.md): Clone as Draft, release notes; reconnect the test account with workflow, payments and write scopes so Workflows and Payments show real data.
2. $11.50 plan swap and delete the $5 plan before pilots.
3. Slack: redirect fix; one-click Slack setup and DMs need a Slack bot app with new scopes.
4. Bigger database plan as data grows (Find lead is about 715 MB per 1M contacts vs a 500 MB plan).
5. AI agents: docs/AI_AGENTS_PLAN.md (needs an API key; Claude subscription tokens cannot power the product).
6. Keep `SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `FATHOM_WEBHOOK_LIVE` off until you decide.
7. Privacy/terms review; delete `C:\Users\KING\wt` with scripts/clean-wt.ps1.
8. Before pilots, switch test flags off: `node --env-file=.env.local --import tsx scripts/set-flags.ts off inbox_,moat_,appt_,pl_` plus new module prefixes.
9. Decide the headline "people waiting" number (definitions in docs/METRICS.md).
