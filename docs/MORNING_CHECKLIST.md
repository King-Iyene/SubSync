# Morning checklist: connection testing

Order matters. Steps marked **King** need your hands (permanent, security, or your own logins).

## 1. Unblock the deployed site (King)

- [ ] Vercel project, Settings, Deployment Protection: turn **Vercel Authentication** off for production (otherwise every page redirects to a Vercel login, including the GHL install callback and webhooks).
- [ ] Vercel project, Settings, Environment Variables (Production). Then redeploy.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | your production URL, no trailing slash |
| `GHL_APP_ID` | `6ae2a79309eaa881c1eb419e` |
| `GHL_CLIENT_ID` | from the app's Advanced Settings, Auth |
| `GHL_CLIENT_SECRET` | same page |
| `GHL_SSO_KEY` | the app's Shared Secret |
| `GHL_REDIRECT_URI` | `<production URL>/api/oauth/callback` (must match the portal exactly) |
| `TOKEN_ENCRYPTION_KEY` | a **new** production key: `openssl rand -base64 32`. Do not reuse the local one. |
| `CRON_SECRET` | any long random string; Vercel sends it to the cron routes |
| `POSTGRES_URL` and Supabase vars | already set by the Vercel Supabase integration; confirm present |

Leave `DEMO_MODE` and `ENFORCE_PLANS` unset in production for now (demo off, plans not enforced while you test).

## 2. Portal settings (King)

- [ ] Redirect URL, webhook URL (`<production URL>/api/webhooks/ghl`) and SSO page URL (`<production URL>/app`) set on the app.
- [ ] Scopes match `src/lib/ghl/scopes.ts`. Add everything we will ever need now; scope changes can trigger re-review later.
- [ ] Delete the extra Agency-target app `6ae2b7db6c40014528683d67` (the wrong one).
- [ ] Upload three real 16:9 screenshots (use demo mode locally: `DEMO_MODE=true npm run dev`, then `npm run seed:demo` first).

## 3. First real test, in this order

1. Install the app on your agency via the install link. Expect to land on `/installed`.
2. Open the app from inside the agency. Expect the dashboard, not the demo. If it says it is not recognised as an agency user, the SSO `type` value is the assumption to fix (`src/lib/ghl/sso.ts`).
3. Overview should list your client accounts within a minute; contacts fill in over the next sync slices (cron runs every 5 minutes, or press **Sync now**).
4. Check one account's detail page against the real account: contact count, open deals, unread conversations.
5. Settings: paste a Slack webhook, press test.

## 4. Assumptions I could not verify without real keys

Report any of these that fail and I will fix them:

- Contact list endpoint field names (`GET /contacts/` paging by `startAfterId`).
- SSO payload: whether agency users arrive with `type === "agency"`.
- Bulk install: that the company token can mint tokens for all 7 scopes on each location.
- Whether a private agency app installs on the $97 Starter plan.
- Whether the Users API exposes last login (engagement stays activity-based either way).
- Conversation "waiting" detection (last message direction and read state).

## 5. Before going public

- [ ] Decide pricing against GoCSM (`COMPETITORS.md`), then fill the Pricing step in the portal.
- [ ] Legal review of `/privacy` and `/terms`.
- [ ] Consider moving Supabase to Pro.
- [ ] Turn on `ENFORCE_PLANS=true` when billing is wired.

## Useful commands

```bash
npm test                 # unit tests
npm run check:db         # database integration check (uses .env.local)
npm run seed:demo        # reseed demo data (about a minute)
DEMO_MODE=true npm run dev
```
