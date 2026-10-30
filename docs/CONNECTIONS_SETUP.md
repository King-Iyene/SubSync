# Connecting Slack, Fathom and Zoom (what only you can do)

SubSync now has real sign-in connections for all three. The code is built, deployed and tested with
pretend Fathom and Zoom deliveries (correct signatures, duplicates, wrong accounts, old deliveries).
What it has **not** been tested against is the real Slack, Fathom and Zoom, because each needs an app
created in its own developer portal. Until you do these steps, the Connections card in Settings shows
"Not switched on yet" and the private-address method on the Meeting notes page keeps working.

Production address used below: `https://subsync.kdsquares.com`.

After each app is created, you add its keys to Vercel as environment variables (Project, Settings,
Environment Variables, Production) and redeploy. I have not touched any environment variable.

| Variable | Comes from |
|---|---|
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | Slack app, Basic Information |
| `FATHOM_CLIENT_ID`, `FATHOM_CLIENT_SECRET` | Fathom app |
| `ZOOM_CLIENT_ID`, `ZOOM_CLIENT_SECRET` | Zoom app, App Credentials |
| `ZOOM_WEBHOOK_SECRET_TOKEN` | Zoom app, Features, Event Subscriptions (Secret Token) |

A connection turns itself on as soon as its variables exist. Zoom needs all three of its variables.

## 1. Slack ("Add to Slack")

1. Open https://api.slack.com/apps and press **Create New App**, then **From scratch**.
2. Name it **SubSync**, choose any workspace you own, press **Create App**.
3. Left menu **OAuth & Permissions**. Under **Redirect URLs** press **Add New Redirect URL**, paste
   `https://subsync.kdsquares.com/api/integrations/slack/callback`, press **Add**, then **Save URLs**.
4. Same page, **Scopes**, **Bot Token Scopes**, **Add an OAuth Scope**, choose `incoming-webhook`.
5. Left menu **Basic Information**: copy **Client ID** and **Client Secret**.
6. Left menu **Manage Distribution**: tick the checklist boxes and press **Activate Public Distribution**
   (without it, only your own workspace can connect).
7. Send me nothing here: put the two values into Vercel as `SLACK_CLIENT_ID` and `SLACK_CLIENT_SECRET`.

What a person sees: Connect Slack opens Slack's own page where they pick a channel. SubSync posts a first
"connected" message there. Alerts and the daily brief use that channel. Disconnect removes it.

## 2. Fathom

1. Fill in https://fathom.video/marketplace_applications/new (this is Fathom's form for apps).
2. Redirect URL: `https://subsync.kdsquares.com/api/integrations/fathom/callback`. Scope: `public_api`.
3. When Fathom gives you the **Client ID** and **Client Secret**, put them in Vercel as
   `FATHOM_CLIENT_ID` and `FATHOM_CLIENT_SECRET`.

What happens: the person signs in to Fathom; SubSync registers its own webhook with Fathom (summary and
action items only, no transcript); every delivery is checked against Fathom's signature. Each meeting is
filed in the account that knows the most people in it. If nobody in the meeting is a known contact it is
counted but not saved, unless the person chose a default account.

Fathom's docs gave two token addresses (`api.fathom.ai` and `fathom.video`). The code uses
`fathom.video`, which is what Fathom's own software kit uses. If sign-in fails with that, tell me.

## 3. Zoom

1. Open https://marketplace.zoom.us, **Develop**, **Build App**, choose **General App**, user-managed.
2. **OAuth Redirect URL** and the allow list: `https://subsync.kdsquares.com/api/integrations/zoom/callback`.
3. Scopes: add `user:read:user` and the scope for past meeting participants
   (`meeting:read:list_past_participants`). Zoom shows the exact scopes each event needs when you add the event
   below, and accepts them there. Participants are a best-effort extra: if Zoom refuses it, notes go to the
   account chosen as the default.
4. **Features, Event Subscriptions**: turn on, **Event notification endpoint URL**
   `https://subsync.kdsquares.com/api/hooks/zoom`, then **Add Events**: under Meeting choose
   **Meeting summary has been completed**.
5. Copy the **Secret Token** shown on that page. Put it in Vercel as `ZOOM_WEBHOOK_SECRET_TOKEN`.
   Press **Validate** only after the variable is live and redeployed (Zoom asks the address a question and
   SubSync answers it).
6. If Zoom asks for a **Deauthorization notification URL**, use the same
   `https://subsync.kdsquares.com/api/hooks/zoom`. When someone removes the app in Zoom, SubSync removes
   their connection.
7. Copy the **Client ID** and **Client Secret** into Vercel as `ZOOM_CLIENT_ID` and `ZOOM_CLIENT_SECRET`.

Limits worth knowing: Zoom only writes a summary when the host is on a paid plan with **Meeting Summary with
AI Companion** switched on, and not for end-to-end encrypted meetings. SubSync does not write summaries
itself and does not keep Zoom transcripts. Zoom's webhook does not list who joined, so SubSync asks Zoom for
the participant list; when that is not allowed, the meeting goes to the default account.

## Before going public

- Each of the three apps has its own review. Slack public distribution, Fathom's marketplace form and
  Zoom's app review all want a privacy page and a support address; both already exist on the site.
- The privacy policy should say that, if a person connects Slack, Fathom or Zoom, SubSync receives a meeting
  summary or posts to a Slack channel on their behalf. I have not edited the legal text; it needs a human review.
- Tokens are encrypted at rest with the same key as the platform tokens and are never sent to the browser.

## What is tested, and what is not

Tested (automatically, every time): signature checks for Fathom and Zoom including wrong, changed and old
deliveries; the Zoom address check; token exchange and refresh for each provider against a pretend
provider (right addresses, right way of sending the keys, refresh tokens used once); the signed sign-in
state (expires, cannot be reused for another app, cannot be edited); routing to the right account and
never a guessed one; duplicate deliveries; a single business staying inside its own account; a
disconnected address going dead; nothing secret in what the browser receives.

Not yet tested: a real sign-in at Slack, Fathom and Zoom, a real Fathom delivery and a real Zoom summary.
That needs the three apps above. When you have created one, tell me and I will test it with you on the
KD Squares Test account.
