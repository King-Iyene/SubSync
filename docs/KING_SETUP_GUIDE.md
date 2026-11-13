# King's setup guide: Slack, permissions (scopes), API keys, in order

Plain steps. Each item says: needed or not, where to get it, what to paste where. Never paste secrets into chat: put them in Vercel (Settings > Environment Variables), then Redeploy.

## 0. What is live now vs what needs you
| Thing | Needed? | Status |
|---|---|---|
| App itself, all modules | Yes | Live, flags on |
| Slack connect (Add to Slack, routing rules, quiet hours, mutes, send a test) | Optional but it is the "notify" feature | Built, dry run; needs steps in section 1 |
| New permissions (scopes) so Money, Workflows, calendars show real data | Yes before pilots | Section 2 |
| $11.50 plan | Yes before pilots | Section 3 |
| AI (Claude API key) | Optional, later | Section 4: not needed to go live |
| Live sends (email, Slack, CRM writes, Fathom webhook) | Only when you decide | Section 5: all OFF now |

## 1. Slack (you already made the redirect and connected a channel: check these only)
The app already exists at api.slack.com/apps (SubSync).
1. **OAuth & Permissions > Redirect URLs** must contain exactly `https://subsync.kdsquares.com/api/integrations/slack/callback`, then **Add** and the separate **Save URLs**. If "Connect Slack" says "redirect_uri did not match", this is the cause.
2. **Basic Information > App Credentials**: copy Client ID and Client Secret into Vercel as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET` (Production). Redeploy.
3. Connected channel: in SubSync > Settings > Connections, press Connect Slack, pick your channel. Press **Send a test**: it shows what WOULD be sent (dry run) until you turn on `SEND_SLACK_LIVE=true` in Vercel (section 5).
4. **Not built yet (needs a bigger Slack permission set):** one-click creation of a channel per client and direct messages to people. To allow it later, in OAuth & Permissions add Bot Token Scopes `chat:write`, `channels:read`, `channels:manage`, `groups:write`, `im:write`, `users:read`, `users:read.email`, then reinstall the app to the workspace and tell me. Until then, notices go to the one channel you chose and in-app.
5. Recommended rule set to start: one channel for the daily brief, one for urgent alerts (leads waiting, failed payments), quiet hours at night, mute accounts you do not manage.

## 2. Permissions (scopes) for release 1.1.0 (steps in docs/RELEASE_1_1_0.md)
Why: some screens show "Needs permission: reconnect" until these are granted. Not a bug.
1. developer portal > My Apps > SubSync > Versions > **Clone as Draft** on the live version.
2. Advanced Settings > Auth > Scopes: **Add scope** for each NEW row in docs/RELEASE_1_1_0.md section 1, set **Optional** (never Required). Keep the 7 required ones unchanged.
3. Write the release notes (text is in the doc), choose **Minor**, publish. Private app: goes live at once.
4. In the CRM open your app list and press **Update**, accept the new permissions (each account that should show real data: start with KD Squares Test).
5. What each unlocks: payments/invoices/plan status and credit balance (Money), workflows and campaigns (Workflows), calendar events and users (Appointments, Call mode, Team), tags/custom fields/messages (Find lead, Meetings). CRM writes (notes, tasks, tags, call queue, clean-up fixes) stay dry run until the write scopes are granted AND the account opts in AND `WRITE_GHL_LIVE=true`.
6. **Call queue workflow, automatic setup (the two permissions that matter most here):** in step 2 make sure `workflows.readonly` and `workflows.write` are ticked and set to **Optional**. Portal path: developer portal > **My Apps** > SubSync > **Versions** > **Clone as Draft** > **Advanced Settings** > **Auth** > **Scopes** > **Add scope**. Write the release notes (docs/RELEASE_1_1_0.md section 1B), choose **Minor**, publish as 1.1.0. Then reinstall or **Update** in KD Squares Test to grant them, and run the probe: `node --env-file=.env.local --import tsx scripts/probe-workflows.ts --location <locationId>` (docs/WORKFLOWS_PROBE.md). Paste the output back to me. If the probe says the Workflows API is not enabled, send docs/WORKFLOWS_API_SUPPORT_MESSAGE.md to HighLevel developer support.
7. Do this BEFORE inviting pilots, because every scope added later forces every install to re-approve.

## 3. Plan swap (before any pilot installs)
Portal > Pricing: add Pro at $11.50 monthly per client account (honest feature lines), then delete the $5 plan. Send me the new plan id; I map it in `plan_entitlements` and switch `ENTITLEMENTS_MODE` to `enforced`, then run the tenant and entitlement tests.

## 4. AI and API keys (not needed to go live)
- Nothing in the product calls an AI model today. All numbers, matching and routing are plain tested code.
- A Claude subscription (what Claude Code uses) cannot power the product. If you want AI features (7am brief wording, proof report narration, meeting one-liners), you need an **Anthropic API key**: console.anthropic.com > API Keys > Create key > paste in Vercel as `ANTHROPIC_API_KEY`. Set a monthly spend limit there first. Cost is passed to customers through usage billing later.
- Decision for you: whether to start with the cheapest useful job (7am brief writer, small model). Details and ranked list: docs/AI_AGENTS_PLAN.md.
- Fathom (meeting notes): each person connects their own Fathom inside SubSync (their own login); nothing for you to paste, except the Fathom app credentials if you publish a Fathom marketplace app.
- Email (daily brief by email): `RESEND_API_KEY` from resend.com plus a verified sending domain; stays dry run until `SEND_EMAIL_LIVE=true`.

## 5. The live switches (all OFF now; turn on one at a time, after testing on KD Squares Test)
`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE` in Vercel. Each must be exactly `true` to be on. Suggestions: first `SEND_SLACK_LIVE` to your own test channel, then `SEND_EMAIL_LIVE` to your own address, then `WRITE_GHL_LIVE` only for KD Squares Test.

## 6. Before pilots
Turn test flags off: `node --env-file=.env.local --import tsx scripts/set-flags.ts off inbox_,moat_,appt_,pl_` plus the new module prefixes (ask me for the list). Database plan upgrade (Find lead needs about 715 MB per 1M contacts). Have privacy and terms reviewed by a person.
