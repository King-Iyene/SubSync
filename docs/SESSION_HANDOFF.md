# SubSync session handoff (written 10 Nov 2026; repo state last checked 8 Nov 2026, 21:08)

Paste this file, or tell a new session to read it first. Then read `docs/SAFETY_RULES.txt` and `docs/PROJECT_BRAIN.txt`.

## 1. Who and what
- King (they/them), founder of KD Squares Ltd. Builds SubSync: a GoHighLevel (GHL) Marketplace app for appointment-driven agencies. Positioning: "Know what is happening in every client account before your client does."
- Live site: https://subsync.kdsquares.com. GHL app ID 6ae2a79309eaa881c1eb419e (not the old "KD Squares" app).
- Stack: Next.js 16, Supabase (one database, 500 MB plan, shared by live and tests), Vercel, postgres.js, Playwright, Vitest, Node test runner.
- **Live repo: `C:\Users\KING\OneDrive\Desktop\SubSync`.** The copy at `C:\Users\KING\Desktop\SubSync` is an old clone (commit 9b5dcf3); King may delete it (a session open in it cannot be deleted while open). Agent worktrees live in `C:\Users\KING\wt\*` (do not delete).
- Price decision (8 Nov): Pro is **$11.50 per client account per month**. A temporary $5 plan still exists in the GHL portal and must be deleted. `CLAUDE.md` was updated by a session to $11.50 (check it).

## 2. Standing rules from King
- Money first (will a customer buy it). Simple, classy, sci-fi UI, little text, hover tips. Light and dark both right. Features named as the question they answer.
- Every count of people is clickable and opens exactly those people.
- Design for millions of leads and 100 to 200 client accounts: SQL aggregates, server paging (20/50/100), never load all rows. Database is only 500 MB: no big fixtures (an agent once filled it and made it read-only).
- All CRM writes through the safe write gateway (preview first, typed confirmation for delete, dry-run unless live switches are on). Live switches: WRITE_GHL_LIVE (already true in Vercel), SEND_EMAIL_LIVE, SEND_SLACK_LIVE, FATHOM_WEBHOOK_LIVE.
- White-label safe: never show vendor words in the UI.
- Tenant isolation is non-negotiable. `check-tenancy` must print `nothing changed: ok` before anything goes to main.
- One module at a time. Additive migrations only. King deletes remote branches himself.
- Use few tokens. Short replies, no recaps. King's English is rough; read for intent.
- Never edit permission settings or `.claude/settings.json` when the safety system blocks it; hand King the text to paste instead.

## 3. What is built (all on `main`, tested only on demo/test data, never a real client account)
Today, Speed to lead (Race, Pace, Coverage, Call mode, People, Capture, Rules, Log), Unanswered messages (people-based screen), Appointments (insights and status writes only), Account audit, People, Clients, Clean-up and Duplicates, Connections (in Settings), lead panel (message, note, task, tags, deals, appointment status, delete with typed confirmation), live sync (about 45 s delta plus webhooks), call queue (tag trigger `call-now`, auto mode off by default), workflow auto-setup (folder "Lead Response Automations"), speed digest email, shell with account and date filter bar, plan entitlements (`ENTITLEMENTS_MODE` open/enforced), event store, tenant isolation tests.
- Speed to lead closed 7 to 8 Nov. Final fixes merged (`a7c2cf9`). Missed-calls fix merged and pushed (`c666768`): Coverage and Call mode share one definition (`src/lib/analytics/missed-calls.ts`, `docs/METRICS.md`), SQL-paged, new indexes migration `20261118090000_missed_calls_scale.sql` applied. A caller disappears from the waiting list when a person texts, calls or logs a call result after the missed call.
- Test guide: `docs/TEST_SPEED_GUIDE.md`. Nothing was ever tested on a real CRM account. Workflow auto-setup and the `call-now` trigger are the most likely to need fixes on first real run.

## 4. In progress: Unanswered Messages Round 2
- Branch **`stage/unanswered2`** (not merged, **not pushed to GitHub**, live site unaffected). Plan: `docs/features/UNANSWERED2_PLAN.md`. Progress notes: `docs/features/UNANSWERED2_PROGRESS.txt`.
- Commits on the branch: `7d5aadb` items 1 and 2 (per-client reply target reusing `locations.speed_target_minutes`; exact SQL totals with `count(*) over()`); `9deff4b` item 3 first pass; `85120f9` progress note; `0b03166` item 3 real implementation by Copilot: private in-app 24-hour breach alert to the conversation's assigned owner (fallback account admin), dedupe, quiet hours, daily cap of 10 per recipient per UTC day, email dry-run only, new hourly cron `/api/cron/inbox-breach` in `vercel.json`, flag `inbox_breach_alert` default off.
- Verified for `0b03166`: typecheck passes; node tests 1283/1283. **Database test failed** because the live database lacks the new columns. **Tenancy not rerun after this commit** (the last pass was before it; the commit expanded check-tenancy reads).
- **Pending migration, additive only, NOT yet applied:** `supabase/migrations/20261118100000_unanswered_breach_alert.sql` (adds `cached_conversations.assigned_to`, `location_users.role`, `alerts.recipient_user_key`, `notifications.recipient_user_key`, three columns on `notification_deliveries`, and two indexes). The new code reads these columns, so the migration must be applied before the branch is ever merged. The safety system blocked me from applying it ("production deploy"); King's explicit "apply it" is needed. Command: `node --env-file=.env.local --import tsx scripts/apply-migration.ts supabase/migrations/20261118100000_unanswered_breach_alert.sql`. Then run `npx vitest run tests/unit/f9-notifications-db.test.ts tests/unit/unanswered-v2-db.test.ts --no-file-parallelism`, then the tenancy check alone.
- The 11 flags (all default off): inbox_per_client_sla, inbox_sql_aggregates, inbox_breach_alert, inbox_ball_in_court, inbox_working_hours, inbox_hide_noise, inbox_workload, inbox_snooze, inbox_channel_mix, inbox_digest, inbox_assign.
- Remaining items in order: 4 ball in whose court (follow-up list of people we are waiting on); 5 working-hours wait clock per account; 6 hide noise (automatic messages only, from source and direction metadata; do NOT read message text); 7 workload balance (counts only, no capacity column); 8 snooze and handled-outside-the-CRM (stored only in SubSync, reversible); 9 channel mix; 10 morning digest line; 11 assign from SubSync through the write gateway (optional scope, off until live switch and account opt-in).
- Decisions kept: client staff see the whole account queue (do not change without King); message snippets are NOT built (SubSync stores no message text; keyword-class snippet needs King's decision and a privacy/Trust change); saved views, unread tab and calls-known are removed.
- Known cleanup: a junk file named like `...UsersKING...UNANSWERED2_PROGRESS.txt` was committed in the repo root by mistake and removed with `git rm` in a later commit (verify it is gone). `REPORT.md` was deleted by a session and restored (verify it exists). Never use `git add .` or `-A`; name files.
- Playwright result for the Unanswered module was never shown. Run browser tests once at the end of the module (phone 390, tablet 768, desktop 1440), one width at a time; only backend items skip them.

## 5. Process and lessons (read before working)
- **Tenancy check:** `TEST_PORT=3102 TEST_DIST_DIR=.next-int2 CHECKS=check-tenancy node scripts/with-dev-server.mjs`. Takes 15 to 40 minutes, uses shared fixtures (`xtest-agency-a/b`). Run it alone, never twice at once, no `timeout`, no flags. Check the process list first. Run it every 3 items and before any push to main. Last line must be `nothing changed: ok`. If a run dies, delete those fixture installations. Delete `.next-int2` afterwards.
- **Merge chain (lead only):** `git merge --no-ff`, apply new migration, `npx next typegen && npx tsc --noEmit`, `node --test src/lib/__tests__/`, tenancy alone, push only if clean, then `git checkout tsconfig.json`. Agents in worktrees never run tenancy and never push to main.
- **Sessions got stuck** by: auto mode "classifier gave no verdict" errors (retry once, then skip and note; do not use sed or shell tricks), a scheduled task re-firing every minute (closing the window ends it; do not create scheduled tasks), memory filling and compacting (a compacted session loses these rules; save progress to `UNANSWERED2_PROGRESS.txt` first), reading too many files in one go (read only the plan and progress files).
- **Machine hygiene:** about 10 old `next dev` servers from earlier stages (ports 3331 to 3391, 6 to 8 Nov) are still running and may block ports 3102/3104. A restart clears them. Closing a Claude window can leave the terminal printing mouse junk like `[555;50;25M`; harmless, close the tab.
- **Tools:** King now uses VS Code with Claude Code and GitHub Copilot. Only one tool should edit the branch at a time. Copilot adds a `Co-authored-by: Copilot` trailer to commits. `.claude/settings.json` with a safe allowlist was created by King (typecheck, node tests, vitest, tenancy, git add/commit allowed; force push, reset --hard, clean, rm -rf, push to main denied). Reload by restarting the session; auto mode is unreliable here, prefer accept-edits.
- Prompt files for new sessions: `docs/SAFETY_RULES.txt`, `docs/PROJECT_BRAIN.txt`, `docs/NEXT_SESSION_PROMPT.txt`. The autonomous-build prompt and the "revise the plan" prompts were given in chat only.

## 6. What only King can do
- Say "apply it" for the pending migration (section 4).
- Vercel production switches: `SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `FATHOM_WEBHOOK_LIVE` (then redeploy). Slack redirect URL: `https://subsync.kdsquares.com/api/integrations/slack/callback`.
- Add optional scopes in the next publish: `conversations/message.write`, workflows read/write/publish, and any write scope for assign (confirm exact portal names).
- Pricing gate before any pilot: add the Pro plan at $11.50 monthly, delete the $5 plan, map the new plan id (`node --env-file=.env.local --import tsx scripts/set-plan.ts <planId> <free|pro>`), set `ENTITLEMENTS_MODE=enforced`, rerun tests. Check Vercel plan allows two hourly crons (`vercel.json` now has speed-digest and inbox-breach).
- One real test on a throwaway CRM account (steps in `docs/TEST_SPEED_GUIDE.md`).
- Privacy policy and terms need human review before going Public. Check and probably drop about 166 MB of `dh_flags` rows in the database that are not SubSync's.
- Delete merged remote branches. Recruit 3 to 5 pilot agencies.

## 7. Queue after Unanswered Round 2
1. Appointments module in the lead panel: reschedule, add, delete (typed confirmation), reassign, double-booking check, rebook after a no-show. Today only status changes exist (`calendars/events.write` scope exists but is optional).
2. Chat partner (AI): in-app assistant that answers "what should I do now?" from our own data, drafts replies for approval, never sends on its own, usage-metered. (My interpretation of King's "chat partner"; confirm.)
3. Going beyond: Today scale pass for 100+ clients, "All leads" explorer (20M rows, smart lists, paged), more workflow templates (missed-call text-back, no-show recovery, speed alerts), white-label email (display name, reply-to, own sending domain).
4. Advanced: anomaly detection, forecasts, source attribution, churn-risk alerts, AI daily brief, leaderboards, stage-history metrics, the rest of `docs/KING_SELECTED_FEATURES.md`.
5. Small open Speed items: chart bars 9 to 10 px wide on phone (Capture, People), account picker checkboxes 17 px, one "Contact not found" on Log from a stale filter, two older specs (speed4, speed6b) that did not finish due to dev-server database timeouts. See `docs/features/SPEED_CLOSEOUT.md`.
- Market research prompt (ready, uses $11.50): in `docs/PROJECT_BRAIN.txt` section 11.

## 8. First actions for a new session
1. Read `docs/SAFETY_RULES.txt`, this file, `docs/features/UNANSWERED2_PROGRESS.txt`. Do not read everything.
2. Run `git status`, `git log --oneline -5` on `stage/unanswered2`; confirm `REPORT.md` exists and the junk file is gone.
3. Ask King for "apply it", then apply the migration, run the database tests, then tenancy alone.
4. Continue with item 4. Commit named files only. Update the progress file after every item.
