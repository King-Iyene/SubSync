# SubSync launch guide, A to Z (baby steps)

Do the parts in order. Each step says who does it. "Tell Claude" means paste the thing into the chat and I do the rest.

## Where things stand (2026-10-29)

- The code is finished and tested on fake data. The site is **live and public** at `https://subsync-topaz.vercel.app`, but install and sign-in say "not configured" until the keys are added (Parts 2 and 3).
- Your real address is `https://subsync-topaz.vercel.app`. **Do not use `https://subsync.vercel.app`**: that belongs to someone else and redirects to another website.
- Nothing has been tested against a real GHL agency yet. That is Part 3.

---

## Part 1. Make the site reachable (already done)

The public address `https://subsync-topaz.vercel.app` loads with no login wall (checked 2026-10-29). Nothing to do here.

## Part 2. Give the site its secrets (about 20 minutes, you)

You cannot paste secrets to me, so you add them in Vercel yourself.

1. Vercel, project **subsync**, **Settings**, **Environment Variables**.
2. Add each of these, with **Production** ticked:

| Name | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | `https://subsync-topaz.vercel.app` |
| `GHL_APP_ID` | `6ae2a79309eaa881c1eb419e` |
| `GHL_REDIRECT_URI` | `https://subsync-topaz.vercel.app/api/oauth/callback` |
| `TOKEN_ENCRYPTION_KEY` | a new random key (see below) |
| `CRON_SECRET` | a long random string (see below) |
| `GHL_CLIENT_ID` | from GHL, Part 3 step 4 |
| `GHL_CLIENT_SECRET` | from GHL, Part 3 step 4 |
| `GHL_SSO_KEY` | from GHL (the Shared Secret), Part 3 step 4 |

To make a random value, open a terminal and run `openssl rand -base64 32`, then copy the output. Do it twice, once for each of the two random values.

3. Do not add `DEMO_MODE` or `ENFORCE_PLANS`.
4. Vercel, **Deployments**, the top one, three dots, **Redeploy**.

## Part 3. Finish the app in the GHL developer portal (you, about 1 hour)

Everything to type is in `docs/GHL_PORTAL_CHECKLIST.md`. The short version:

1. marketplace.gohighlevel.com, **My Apps**, **SubSync** (the correct one, version 1.0.0, **Sub-Account** target, **Agency only** install).
2. **Delete the extra app** `6ae2b7db6c40014528683d67` (it is the wrong, Agency-target one).
3. **Build, Advanced Settings, Auth**:
   - Redirect URL: `https://subsync-topaz.vercel.app/api/oauth/callback`
   - Scopes ticked: `locations.readonly`, `contacts.readonly`, `opportunities.readonly`, `calendars.readonly`, `conversations.readonly`, `oauth.write`, `oauth.readonly`
4. Copy the **Client ID**, **Client Secret** and the **Shared Secret** (SSO key). Put them in Vercel (Part 2), then redeploy again.
5. **Modules, Custom Pages**: URL `https://subsync-topaz.vercel.app/app`, SSO on.
6. **Webhooks**: URL `https://subsync-topaz.vercel.app/api/webhooks/ghl`.
7. **Support**: email `code@kdsquares.com`, and the `/support`, `/privacy`, `/terms` URLs on the same address.
8. Upload your logo (the black shop pin) under App logo.

## Part 4. First real test (you and me, about 30 minutes)

1. Developer portal, My Apps, SubSync, Manage, Versions, three dots, **Test Link**. Enter your agency's Location ID, open the link, click **Install**.
2. You should land on a "SubSync installed" page. Tell me. I check the database for the install row.
3. Open SubSync from inside your GHL agency (the new menu item). You should see the dashboard with your own client accounts, not the demo.
4. Press **Sync now**. Wait 5 to 10 minutes. Numbers should appear.
5. Tell me what you see, or what error appears. Screenshots are fine. I fix whatever the real platform did differently from my assumptions (listed in `docs/MORNING_CHECKLIST.md`, section 4).

If install is refused on your $97 Starter plan, use the GHL sandbox account or upgrade one month. Tell me and I will check which.

## Part 5. Make it look ready to sell (you and me)

1. I reseed the demo and take clean screenshots. You upload **3 real 16:9 screenshots** in App Profiles (the file picker is yours).
2. Record a short demo video that includes an uninstall (I can script it; you upload).
3. Fill the **Pricing** step. Decide first: $5 per client account, free up to 5 (the plan in the notes), or cheaper tiers because GoCSM is cheaper. Tell me and I set it up.
4. Get Privacy and Terms checked by a person. They are honest placeholders now.

## Part 6. Go public (you)

1. Remember: while private, the app can only be installed by 5 agencies. To sell, you must go **Public**.
2. In the portal, **Publish**, switch Private to Public, submit for review. Reviewers can ask for changes; I fix them.
3. Before real customers: upgrade **Vercel to Pro** and **Supabase to Pro** (about $45 a month together), set `ENFORCE_PLANS=true`, and ask me to do a last check.

## Part 7. After launch

- Watch the Overview "Data sync" card and the Vercel logs for failed jobs.
- Tell me what the first agencies ask for. Next ideas are in `docs/ROADMAP.md`.

## Quick reference: who does what

| Only you | Me |
| --- | --- |
| Vercel Deployment Protection, env vars, Pro plans | Code, fixes, tests, deploys |
| GHL keys, deleting the extra app, uploads, pricing and publish clicks | Checking the database, reading errors, demo data, screenshots, video script |
