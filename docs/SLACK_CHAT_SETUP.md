# Chat with the SubSync bot in Slack: setup (for King)

Flag: `slack_chat` (default OFF). Needs `ai_byo` and `ai_ask_data` on as well. Replies stay in dry-run until `SEND_SLACK_LIVE=true` (do not set it until you have tested).

## What it does

People DM the bot or @mention it in a channel and ask ("who hasn't been answered?", "how many no-shows this week?"). The answer comes from the same read-only
Ask your data tools as the app, with the customer's own AI key, the number check, and a "Open the rows" link for every figure. It never messages leads and never
writes to the CRM.

Safety rules built in:
- Every request is checked against Slack's signature (`X-Slack-Signature`) and must be under 5 minutes old. Anything else gets 401.
- A Slack workspace maps to ONE company (or one client account). The tenant comes only from that link, never from the words typed. An unknown workspace gets no answer.
- Slack people are not matched to app roles, so answers are account-level totals and no names go to the AI. The "Open the rows" link opens in the app, where the person signs in with their own role.
- Per-person limit: 8 questions in 10 minutes. The customer's own monthly AI cap and the `AI_KILL_ALL=true` kill switch apply too. Turning the `slack_chat` flag off stops all answers.

## Alert reports, in Slack and in chat

- Alert messages in Slack are built from the alert's facts (counts, window, usual level, biggest causes, what changed since last time) and a link that opens the exact rows. They no longer repeat every hour: one message per real change, a daily reminder, and one "back to normal" note.
- Optional AI wording: flag `ai_slack_reports` (default OFF, needs `ai_byo`) plus the account's own switch in Settings > AI ("Alert reports in Slack"). The AI writes only the two sentences under the headline, from the same facts. Any figure not in the facts is rejected, and then the data-specific template is used (never the generic text). No extra Slack or Vercel setting is needed.
- In chat, people can ask "what alerts fired today?" or "explain the bad records alert". The bot reads the same facts, and each count has an "Open the rows" link.

## 1. Slack app settings (api.slack.com/apps, your SubSync app)

1. **Basic Information > App Credentials**: copy the **Signing Secret**.
2. **OAuth & Permissions > Scopes > Bot Token Scopes**: add exactly these: `incoming-webhook` (already there), `app_mentions:read`, `chat:write`, `im:history`, `im:read`, `im:write`.
   Do NOT add `channels:history`: the bot only needs to hear mentions and direct messages.
3. **App Home**: turn on **Messages Tab** and tick **Allow users to send Slash commands and messages from the messages tab**.
4. **Event Subscriptions**: switch **Enable Events** on.
   - **Request URL**: `https://subsync.kdsquares.com/api/slack/events` (it must show "Verified" in green; this works only after the Vercel step below is deployed).
   - **Subscribe to bot events**: add `app_mention` and `message.im`.
   - Save Changes.
5. **Reinstall to Workspace** when Slack asks (scopes changed).

## 2. Vercel environment variables (Production)

| Name | Value | Why |
|---|---|---|
| `SLACK_SIGNING_SECRET` | the Signing Secret from step 1.1 | verifies every request is from Slack |
| `SLACK_CHAT_SCOPES` | `true` | makes "Add to Slack" ask for the chat permissions above (leave it unset while chat is off) |

Never put the signing secret in chat or git. Do not set `SEND_SLACK_LIVE` yet.

## 3. Turn it on

1. Merge the PR and approve the "production" migration apply (adds `slack_chat_links` and `slack_chat_events`).
2. Turn the `slack_chat` flag ON (with `ai_byo` and `ai_ask_data`).
3. In SubSync, open **Settings > Connections > Slack** and press **Add to Slack** again for your workspace. Slack now shows the chat permissions; allow them. That saves the workspace link to your company (or to one account for a business install).
4. Test while replies are dry-run: DM the bot "how many leads are waiting?". The server log shows `WOULD SEND slack.chat.reply`. When you are happy, set `SEND_SLACK_LIVE=true` and redeploy.

## What the Slack card in Settings > Connections will show

The existing Slack card keeps showing the channel that receives alerts. After step 3 the same sign-in also links the workspace for chat; no second card is needed.
(A small "Chat with the bot: connected / not connected" line for that card is not built yet.)

## If something is wrong

- Request URL will not verify: the signing secret in Vercel is missing or wrong, or the deploy is not live.
- The bot is silent: the flag is off, `AI_KILL_ALL=true`, the workspace was never linked (step 3), or replies are still dry-run.
- "AI is not connected yet": the company has not connected its own AI key in Settings > Connections.
