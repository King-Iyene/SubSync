# What King does before and after the merge to main (3 Nov 2026)

A push to `main` deploys the code to production at once. Migrations are NOT applied by a deploy (no CI, no Edge Functions). Do these steps in this order.

## 1. Back up (2 minutes)
Supabase dashboard, Database, Backups: confirm a recent backup exists (or press "Create backup" on a paid plan). All 13 migrations are additive and re-runnable, but a backup is the undo.

## 2. Apply the 13 new migrations to the live Supabase project, in this order
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

Check first that the 26 older migrations (up to 20261031190000) are already applied: Table Editor should list `speed_*`, `lead_touches`, `shared_audits`, `email`/alert tables. If any are missing, apply those first, oldest first.
Then run `node --env-file=.env.local --import tsx scripts/supabase-proof.ts` (needs your `.env.local`); it compares the live schema with the repo. Send me the output.

## 3. Vercel
- Settings, Environment Variables: confirm `POSTGRES_URL`, `TOKEN_ENCRYPTION_KEY`, `GHL_APP_ID`, `GHL_CLIENT_ID`, `GHL_CLIENT_SECRET`, `GHL_SSO_KEY`, `GHL_REDIRECT_URI`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM` exist. Optional: Slack and Fathom pairs (see docs/CONNECTIONS_SETUP.md).
- Keep these OFF (unset) until the morning tests in docs/features/E0.md pass: `SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`. With them off, nothing is sent or written to a customer's CRM.
- Crons: `vercel.json` runs a job every 5 minutes. That needs Vercel Pro (Hobby allows daily only). Check the plan.
- Do NOT set `DEMO_MODE` in production.

## 4. Merge, then watch
Merge, wait for the Vercel build to go green, open the app, run the checks in docs/RUNBOOK.md. If something breaks: Vercel, Deployments, previous deploy, "Promote to Production" (the migrations stay; they are additive).

## 5. Things only you can do
- Slack: add the redirect URL (docs/NEEDS_KING.md item 1).
- Pricing gate before any outside install: add Pro $9, delete the $5 plan, tell me the new plan id, then set `ENTITLEMENTS_MODE=enforced`.
- GHL portal: version 2.2.0 with the new optional scopes (docs/features/Z2.md).
- Not tested live (no credentials in my sandbox): real sync counts against your CRM, real emails, Slack and Fathom, the real install and uninstall.
