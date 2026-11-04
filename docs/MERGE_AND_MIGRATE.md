# What King does before and after the merge to main (3 Nov 2026)

A push to `main` deploys the code to production at once. Migrations are NOT applied by a deploy (no CI, no Edge Functions). Do these steps in this order.

## 1. Back up (2 minutes)
Supabase dashboard, Database, Backups: confirm a recent backup exists (or press "Create backup" on a paid plan). All 15 migrations are additive and re-runnable, but a backup is the undo.

## 2. Apply the 15 new migrations to the live Supabase project, in this order
Open Supabase, SQL Editor, New query. For each file below, paste the whole file and press Run. Wait for "Success" before the next one. (Or from your computer: `node --env-file=.env.local --import tsx scripts/apply-migration.ts supabase/migrations/<file>.sql`; it refuses anything that drops or deletes.)

1. 20261101010000_detected_app_domain.sql
2. 20261101020000_meeting_default_account_retired.sql
3. 20261101030000_f1_numbers_truth.sql
4. 20261102030000_speed_f2.sql
5. 20261102040000_f3_appointments.sql
6. 20261102060000_f4_saved_views.sql
7. 20261102070000_user_connections.sql
8. 20261102090000_f8_feedback.sql
9. 20261102100000_f10_people.sql
10. 20261102110000_c1_clients.sql
11. 20261102120000_f9_notifications.sql
12. 20261102130000_e2a_fathom_inbox.sql
13. 20261103090000_e2b_setup.sql
14. 20261103100000_nc_brand_logo.sql
15. 20261104090000_today_actions.sql (Today's working queue: Done, Snooze, Assign. Until it is applied Today still opens and shows every row; the buttons say "Needs the latest database update")

Check first that the 26 older migrations (up to 20261031190000) are already applied: Table Editor should list `speed_*`, `lead_touches`, `shared_audits`, `email`/alert tables. If any are missing, apply those first, oldest first.
Then run `node --env-file=.env.local --import tsx scripts/supabase-proof.ts` (needs your `.env.local`); it compares the live schema with the repo. Send me the output.

## 3. Vercel
- Settings, Environment Variables: confirm `POSTGRES_URL`, `TOKEN_ENCRYPTION_KEY`, `GHL_APP_ID`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SSO_KEY`, `GHL_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` exist. Optional: Slack and Fathom pairs (see docs/CONNECTIONS_SETUP.md).
- Keep these OFF (unset) until the morning tests in docs/features/E0.md pass: `SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`. With them off, nothing is sent or written to a customer's CRM.
- Crons: `vercel.json` runs a job every 5 minutes. That needs Vercel Pro (Hobby allows daily only). Check the plan.
- Do NOT set `DEMO_MODE` in production.
- **`GHL_APP_ID` must be the SubSync app's id (`6ae2a79309eaa881c1eb419e`), not the old KD Squares app.** Since this release the webhook handler ignores signed events carrying a different app id (a security fix), so a wrong id would make real install and uninstall events be ignored. Client ID and Secret must also come from the SubSync app.

## 4. Merge, then watch
Merge, wait for the Vercel build to go green, open the app, run the checks in docs/RUNBOOK.md. If something breaks: Vercel, Deployments, previous deploy, "Promote to Production" (the migrations stay; they are additive).

## 5. Things only you can do
- Slack: add the redirect URL (docs/NEEDS_KING.md item 1).
- Pricing gate before any outside install: add Pro $9, delete the $5 plan, tell me the new plan id, then set `ENTITLEMENTS_MODE=enforced`.
- GHL portal: version 2.2.0 with the new optional scopes (docs/features/Z2.md).
- Not tested live (no credentials in my sandbox): real sync counts against your CRM, real emails, Slack and Fathom, the real install and uninstall.

## 6. Security review (docs/SECURITY_REVIEW.md): what is left open
- Fixed in this release: webhook for another app, constant-time secret checks, `nosniff` and `Referrer-Policy`, typed searches kept out of browser storage.
- Open, low risk, for a later release: the old `settings.slack_webhook_url` is stored in plain text (the trust page discloses it); no `script-src` content policy; weak rate limits on the shared audit and email-check addresses; no `state` value on the install callback (GHL's flow). The app can be framed by any HTTPS site on purpose, because agencies use their own white-label domains; every data call needs a signed session.
- Not code, still yours before the GHL review: 24-hour support channel, HTTPS redirect URLs (remove any localhost one), the Loom demo (install, setup, main flows, errors, uninstall), a sandbox test install, privacy and terms reviewed by a human.

## 7. Automatic migrations (GitHub workflow `.github/workflows/migrations.yml`)

What it does, so you stop pasting SQL by hand:
- **Check** (every push and pull request): spins up a brand-new Postgres, applies ALL migrations from scratch, applies them again (must change nothing), then typechecks and runs the unit tests. VERIFIED in my sandbox with the same runner (`scripts/migrate.ts`): 39 files apply cleanly from scratch and a second run applies 0.
- **Apply to Supabase** (only when a push to `main` changes `supabase/migrations/**`, or by hand): waits for YOUR click, then applies only the migrations not yet recorded, once each, in order, each inside one transaction. It records them in a table `subsync_migrations`. It refuses any file that drops, truncates or deletes (those you run by hand).
- NOT VERIFIED: the workflow has never run on GitHub (I cannot run Actions from my sandbox) and the runner has never touched your Supabase. The first run is yours to watch.

One-time setup, in this order:
1. GitHub, repo `King-Iyene/SubSync`, **Settings, Environments, New environment**, name it exactly `production`. Tick **Required reviewers** and add yourself. Save.
2. In that same environment, **Add environment secret**: name `SUPABASE_DB_URL`. Value: Supabase, **Project Settings, Database, Connection string, Session pooler** (port 5432, URI). Replace `[YOUR-PASSWORD]` with the database password. Use the SESSION pooler, not "Transaction pooler" (the runner needs a session for its lock) and not the "Direct connection" (it is IPv6-only and GitHub's machines are IPv4). Never paste this value in chat.
3. **Baseline once** (Supabase already has the older 26 migrations, and the runner must not re-run them): GitHub, **Actions, migrations, Run workflow**, set `baseline_through` to `20261029030000_api_keys.sql`, leave the rest, **Run workflow**, then press **Review deployments, Approve** on the `production` job. It marks only the first 5 files as already applied and runs nothing. The first 5 cannot be run twice, but production certainly has them. Every later file is safe to run twice (tested), so the next step applies the rest and does nothing where a table already exists.
4. **Apply the 15 new ones**: Actions, migrations, Run workflow, set `dry_run` to **false**, leave `baseline_through` empty, Run workflow, Approve. This replaces step 2 of the manual list above. Or, with `dry_run` true, it only prints what it would apply.
5. From now on: a migration file merged to `main` shows a pending approval on the Actions page. Approve it and it is applied.

Limits to know: it migrates the database only; the Vercel deploy still happens on its own at the same moment, so a migration should be merged in a change that works with or without the new tables for a few minutes (ours are additive). Turn on Supabase backups first. If a migration fails it stops and nothing after it runs; fix forward with a new file.

## 8. Version note (restore, 3 Nov 2026)
The app is the version where M1 and M2 were complete, plus the agency logo (the company's own logo in the menu, reports, shared audit and emails; the SubSync mark only when the company has no name or logo of its own). The round-2 changes (text cuts, brighter theme, Clean-up, lead panel, one-line filter, Call button, Pipeline tabs, new-client notice) are NOT in this version. They are saved under the git tag `round2-before-revert` and can be brought back one at a time.
