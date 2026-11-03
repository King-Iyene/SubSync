# Needs King (things I skipped on purpose; everything else is done or logged)

Each item: (a) what it is, (b) why it was skipped, (c) the exact click or command, (d) the risk if it is not done. Maintained during the overnight run (branch `overnight/2026-11-01`). Nothing here has been done.

## 1. Slack: fix the redirect address so a live Slack connect can work
- (a) The Slack app "SubSync" refuses the return address the code uses.
- (b) It is a change to the Slack app registration, which only King may touch.
- (c) api.slack.com/apps, SubSync, **OAuth & Permissions**, **Redirect URLs**: add exactly `https://subsync.kdsquares.com/api/integrations/slack/callback`, press **Add**, then press the separate **Save URLs** button. In Basic Information check the Client ID is `4475622980481.12455703070615`.
- (d) Without it "Connect Slack" fails with "redirect_uri did not match" (S-REDIRECT) and F9's Slack flow cannot be tested live.

## 2. Zoom (optional, Zoom stays hidden): add the scope that identifies the user
- (a) Zoom scope `user:read:user`.
- (b) Zoom app registration is King's.
- (c) marketplace.zoom.us, the SubSync app, **Scopes**, add **View a user** (`user:read:user`), save. Anyone who connected before must reconnect.
- (d) Only matters when Zoom is turned on (stage E1, not tonight).

## 3. Fathom: keep unmatched meetings from being saved anywhere (DONE in code by S0.2b, nothing left to click)
- (a) The option "If nobody in a meeting is a known contact, save it in [client account]" is gone from the app, the API and the code, and the one stored value (none was set) was migrated to "do not save it".
- (b) It was King's own connection setting.
- (c) Nothing to do. If you want to look: Settings, Connections, Fathom has no "save it in" choice any more.
- (d) None.

## 4. Pre-pilot pricing gate (before ANY outside agency installs)
- (a) Add the $9 Pro plan, delete the $5 plan, map the new plan id in `plan_entitlements`, switch `ENTITLEMENTS_MODE` to `enforced`.
- (b) Plans, prices and the marketplace are critical and King's.
- (c) See `docs/RUNBOOK.md` section 3 and `CLAUDE.md` section 6. Tell me the new plan id and I will map it and run the entitlement and tenancy tests.
- (d) Outside installs would land on the temporary $5 plan.

## 5. Release 2.2.0 (marketplace version): scopes and listing
- (a) One new version bundling the optional read scopes, the optional permissions to add notes to contacts and internal comments to conversations (and custom field definitions), corrected listing copy and the pricing change. The exact scope list tonight's stages need is collected in section 12 below.
- (b) Marketplace version, scope and listing changes are critical. The portal limits an app to 5 versions.
- (c) Portal: My Apps, SubSync, Versions, **Clone as Draft** on 2.1.0, Scopes, Pricing, Publish as Minor (steps in `docs/features/Z2.md` and `docs/ROADMAP_V2.md` section 6).
- (d) Until done, features that need the new permissions show "Needs permission: reconnect".

## 6. Real-world checks that need King (not done tonight)
- Run `scripts/check-email-setup.ts` (read only) and, only with King's say-so, `scripts/send-test-emails.ts` to an address King owns.
- Data-deletion test for real on the KD Squares Test account (install, sync, Delete my data, sync, uninstall).
- Data cleanup real write and undo on the KD Squares Test account (ZZ-TEST contacts).
- Support inbox test: send a message from another address to code@kdsquares.com and note the reply time.
- Reason skipped: they send mail, write to a real account or need King's inbox.

## 7. Human review of the privacy page and terms
- (a) `/privacy` and `/terms` are honest drafts, not legal advice.
- (b) Needs a person.
- (c) Send both pages to a reviewer before going Public.
- (d) The app stores other businesses' customer data.

## 8. Setter and closer definition (decision, stage T1 never starts tonight)
- (a) Who counts as a setter and who as a closer (N27). Proposed default: setter = the user who booked the appointment (else the lead owner at booking), closer = the appointment's assigned user.
- (b) King decides.
- (c) Reply "use the default" or give the rule.
- (d) T1 cannot start.

## 9. Style approval (D0): approved by King (with this one change, applied)
- (a) The style (KD Squares palette, calm and exact, light and dark) is **approved by King, with one change: plain status words and plain banners (no dot, no tinted pill, no icon-in-a-circle box). That change is applied** (docs/features/D0.md, KF-1). The /design page still says "style awaiting King's approval" until you press approved once on the live address, because only the live page can be seen by you; a one-word reply changes the label.
- (b) The label is yours to clear; the written comparison with two alternatives is in docs/features/D0.md section 3.
- (c) After the merge, open `/design` on the live address and reply "approved" or what to change. Also reply "keep" or "change" for these decisions I made for you: dark stays the default look with Light and Match my device one tap away; the menu is the pilot menu with everything else under "More" and Contact search, Leads and Call lists as tabs inside People; the filter and each card's range are remembered in the browser and carried in the address.
- (d) D1 polish builds on it; the light theme of pages D0 did not touch is checked in D1.
- (e) New from D0 for the merge: the filter list now includes the client accounts you set to ignore (flagged, never counted) so the screen can say they are left out and why; the Speed to lead answer now carries the leads behind each week of the trend (up to 60 per week). No migration, no new permission.

## 10. Merge of the overnight branch and any held migrations
- (a) All work is on branch `overnight/2026-11-01`. Nothing is on `main`.
- (b) I never merge or push to main.
- (c) Type: "Merge stages up to <ID> into main" (the list of stage tags is in the morning report). I run the merge, the full tests and the push.
- (d) Production keeps running the previous code until then.

## 11. Held migrations (written, NOT applied)
None so far (stage S0.4 has no migration). (Stage S0.2b wrote and APPLIED two additive migrations to the live database after saving the tables to backups/: `20261101010000_detected_app_domain.sql` and `20261101020000_meeting_default_account_retired.sql`. Both are in docs/features/S0.2b.md with the backup file names and row counts. The old main code keeps working against them.) Stage F1 also APPLIED one additive migration, `20261101030000_f1_numbers_truth.sql` (a new table `stage_rules` and three new columns: `account_metrics_daily.definition_version`, `settings.cold_tags`, `settings.deal_rules_revision`), after saving `account_metrics_daily` (459 rows) and `settings` (3 rows) to `backups/`; the counts were the same afterwards and the new table was empty. The old main code ignores all four additions and keeps working. Nothing is held.

## 12. Scopes the overnight stages need for release 2.2.0
S0.2b needs none (nothing new is read or written in the CRM). S0.4 needs none (it reads nothing new; the webhook events to tick are listed in section 15). F1 needs none: it reads nothing new (`docs/CAPABILITIES.md` lists every data point and its permission). From that matrix, permissions later stages MAY want, all optional, none asked for tonight: `workflows.readonly` (failing workflows; the platform may still refuse), `payments/transactions.readonly` and `invoices.readonly` (stage R1, parked), `forms.readonly` (lead source detail), `marketplace-installer-details.readonly` (stage Z2, plan reconciliation). Filled in as later stages are built.

## 13. Checks from stage S0.2b (nothing is skipped; these need King or a real signed event)
- (a) **The install event carries the company's login domain (N82).** We read `whitelabelDetails.domain` from the install event and keep it; this is proven by tests with made-up events and by the sign-in capture already working on your real agency (it stored app.kdsquares.com), but no real signed install event was available overnight. (b) A real event can only come from the platform. (c) At the next real install (or when you reinstall on KD Squares Test), open Settings, Links: it should say "found by itself" with the right address, and Open links should use it. (d) Low: sign-in fills the same field at the first open, so a missed event only delays it.
- (a) **Three decisions made for you, please confirm or change (docs/DECISIONS.md):** the Meeting notes privacy switches stay visible while a meeting tool is connected even though the page is off; "Delete my data" may be pressed by the agency owner, or by the administrator of a business that installed it for itself (nobody else); a meeting nobody can be matched to is only counted, even for a single business, until the private Meeting inbox exists (E0, E2a). (b) They are your call. (c) Reply "keep" or say what to change. (d) Low.
- (a) **Real-world check of "Delete my data" as owner and as administrator.** (b) It deletes real data, so it was only tested on fixture companies. (c) Already in section 6 (data-deletion test on KD Squares Test). (d) The button's role rule is proven by test, not by a live press.

## 14. A leftover test server on port 3100 (harmless, but please stop it)
- (a) A `next dev -p 3100` process (PID 53848, parent 53508) from my own debugging is idle on your machine.
- (b) The permission layer refused my request to stop it, so I left it alone and ran the tests on port 3101 instead.
- (c) In a PowerShell window: `Stop-Process -Id 53508 -Force` (or restart the computer).
- (d) None for the app. It only blocks `npm run e2e` and the default test harness from starting their own server on port 3100.

## 15. Stage S0.4 (sync reliability): what takes effect when you merge, and what only you can check
- (a) **`vercel.json` gains one cron entry** (`/api/cron/watchdog`, every 10 minutes: the internal alarm). The existing entries are unchanged (`/api/cron/sync` every 5 minutes, `/api/cron/daily` hourly at :00, `/api/cron/weekly` hourly at :05). (b) `vercel.json` only takes effect when the branch is merged and deployed; I did not touch the Vercel project or its environment variables. (c) After the merge, in Vercel, project, Settings, **Cron Jobs**: you should see four jobs. This needs the Pro plan (Hobby refuses anything more often than once a day and would fail the deploy: if the deploy fails with "Hobby accounts are limited to daily cron jobs", the plan is the cause). (d) Without it the refresh falls back to what it was.
- (a) **Refresh now really runs every 15 minutes (it ran every 20).** The fix is in the code and takes effect on merge. (c) Proof, a few hours after the merge: `node --env-file=.env.local --import tsx scripts/sync-timeline.ts --hours 6` should show "Gap between cycles: median 15 min" and no gap over 30. (d) Low.
- (a) **Real INSTALL and UNINSTALL webhook events were being ignored (found in the live webhook log: the platform sends the types `INSTALL`, `UNINSTALL`, `UPDATE`; the code only knew `AppInstall` and `AppUninstall`).** From the merge on, a real uninstall event removes that company's (or that one account's) copied data and tokens, as the privacy page promises, and a new account added after a bulk install is picked up within minutes instead of at the next daily read. (b) DECIDED FOR KING, please review: it changes what happens at a real uninstall. (c) Reply "keep" or tell me to revert `canonicalType` in `src/lib/ghl/webhook.ts`. To test: on KD Squares Test, uninstall the app and open Settings of the agency: that account's data should be gone within a minute; reinstall to bring it back. (d) Without it, uninstalling leaves the copied data in place until someone presses "Delete my data".
- (a) **Which webhook events the marketplace app is subscribed to.** The live log of the last 3 days contains only INSTALL, UNINSTALL, UPDATE, ContactCreate and ContactUpdate, and no appointment, deal or message event. That may only mean nothing happened in those accounts, or the events are not ticked. (b) The portal is yours and I must not change the app. (c) Developer portal, My Apps, SubSync, **Advanced Settings**, **Webhooks** (the page that lists events): confirm the delivery URL is `https://subsync.kdsquares.com/api/webhooks/ghl` and that these are ticked: ContactCreate, ContactUpdate, ContactDelete, ContactTagUpdate, ContactDndUpdate, OpportunityCreate, OpportunityUpdate, OpportunityDelete, OpportunityStageUpdate, OpportunityStatusUpdate, OpportunityAssignedToUpdate, OpportunityMonetaryValueUpdate, AppointmentCreate, AppointmentUpdate, AppointmentDelete, InboundMessage, OutboundMessage, ConversationUnreadWebhook, LocationUpdate, plus the app install and uninstall events. Ticking events is a settings change that may need a new version; check whether it applies to the live version (batch it with release 2.2.0 if it needs one). Tell me which are ticked. (d) Without them the cache still refreshes every 15 minutes, only the "within a few minutes" changes do not happen.
- (a) **Optional: an outside watcher.** Everything that watches the sync runs inside Vercel (the sync cron, the watchdog cron), so if Vercel itself stops, nothing says so. (b) A paid or third-party monitor is your call. (c) Any uptime monitor that can send a header (for example UptimeRobot, paid tier, or Better Stack) can call `https://subsync.kdsquares.com/api/admin/diagnostics` with the header `Authorization: Bearer <CRON_SECRET>` every 10 minutes and alert when the answer has `"alarms"` above 0 or the call fails. (d) Low: the alarm lines in the audit log are the only record until then, and nothing is emailed or posted anywhere yet (the notification is a dry run until the F9 dispatcher).
- (a) **Real-data check of the new freshness line (King's 5 checks in `docs/features/S0.4.md`)**: compare three timestamps with the CRM. (c) Listed there.

## 16. Stage F1 (numbers truth plus audits): approve the cut list, run one check after the merge, and three decisions made for you
- (a) **Approve the cut list in `docs/DATA_POINTS.md`.** The audit lists every card and number on every page (116 rows: KEEP 78, MERGE 15, CUT 8, MOVE 3, LATER 8, DEFER 4) with the question it answers, who needs it, the decision it supports, and a recommendation. (b) The roadmap says to show King the list before cutting anything, so **nothing was cut, hidden or removed because of it.** (c) Read the CUT rows first (Fine today list, Open alerts tile, Cost of slow follow-up, Average health score and gone-quiet count, Deal sizes, Your most valuable contacts, Birthdays, Recent deal movement) and reply "approve the cut list" or name the rows to keep; I will then remove or merge them in the stage that owns each page (most are F5, F4 and D1). (d) Without it the pages stay as long as they are today, which is the problem N44 describes.
- (a) **After the merge, run the live capability check once.** (b) The platform's real answers could not be read from this machine: the real tokens are encrypted with a key that exists only where the app runs. (c) `curl -H "Authorization: Bearer <your CRON_SECRET>" https://subsync.kdsquares.com/api/admin/capabilities` (read only, GET requests only, at most 70 of them, field names and counts only). Send me the answer and I will fill the "Live" column of `docs/CAPABILITIES.md` and the count check (contacts, deals, open deals, conversations in the app against the platform). (d) Until then the matrix rests on what the production sync stored.
- (a) **Decisions made for you (DECIDED FOR KING, please review; all in `docs/DECISIONS.md`).** 1. A stage whose name says "Disqualified", "Wrong Phone Number", "Not interested", "Lost" and the like, and a pipeline named "[Not IN USE]", are treated as closed out or not in use **until you say otherwise**; the screen says "decided by the name" and the Pipeline page lets you change each one. On the real accounts this takes 1,033 open deals out of the stage lists and the stale and dead counts, and no dollar figure moves (none of them has a value and an owner). 2. An account's health label is held down by the customers waiting for a reply: 5 or more waiting is at best Watch, 15 or more is At risk, whatever the score says (KD Squares LTD, 21 waiting, was "Healthy" and is now "At risk"). 3. The way deals are counted is now version 3, so the "Open pipeline over time" line and every "vs yesterday" for deals start afresh; on the real agency that means no line until a second day has been counted (it had only three days of history, drawn across a change of rule). (b) They are your call. (c) Reply "keep" or tell me what to change. (d) Low.
- (a) **Real-world checks that need your eyes** are King's 5 checks in `docs/features/F1.md`, mainly the CRM counts (contacts, open deals, unread, waiting). (b) This machine cannot read the CRM. (c) Listed there. (d) The app-side numbers were checked against the database only.
- (a) **Release 2.2.0** is not touched by this stage (no permission added). (b)-(d) See section 12.

## 17. From stages F4 and F6 (parallel batch)
- **Missed calls (N5), needs one live read.** The stored conversations show 34 real conversations ending in a call but no call result (answered, missed, voicemail), so missed calls cannot be built from here. The sync already logs the field names of one call message once ("probe: call message fields"). Morning step: read that line in the Vercel log, or run `node --env-file=.env.local --import tsx scripts/audit-capabilities.ts` and look at the call-message row, then tell me the field names. Risk if skipped: Unanswered messages and the lead drawer keep saying "result not known" for calls.
- **Decision to approve (F6): a sender who has set their own business name shows no product sign-up link on the shared audit page** (white-label owners resell the page); an unbranded page keeps the link. Say "keep the link" if you want it on every page.
- **Logo on audits:** no white-label logo address is saved anywhere, so reports carry the name and colour only. F8/D1 decide how to save it (it comes from the sign-in/install data).
- **After the merge (lead does this, nothing for King):** apply `supabase/migrations/20261102060000_f4_saved_views.sql` (new empty table `saved_views`, nothing tightened) and rerun `scripts/make-sample-audit.ts` so the sample audit shows the new layout.

## 18. From stage F3 (appointments)
- Check after the first real sync: open any appointment on a real account and see whether the panel says who booked it and how (the field names for "booked by" were not verified against a live event; if the platform uses other names the panel says "Not recorded by your CRM").
- Release 2.2.0: marking an appointment showed or no-show from SubSync would need the calendar-events write permission. Not requested, proposal only.
- Migration `20261102040000_f3_appointments.sql` (3 new nullable columns) is already APPLIED to the live database (backups `cached_appointments-2026-11-01T21-53-07-114Z.json` 320 rows, `settings-2026-11-01T21-53-07-114Z.json` 3 rows; counts unchanged after). If the live database were ever restored from before 1 Nov 21:53 UTC, re-run the file.

## 19. From stage F2 (speed to lead)
- **Optional live check (Facebook/Instagram lead forms):** send one real lead-form lead through a TEST account so the source can be checked live. Until then "recognises Facebook and Instagram forms" is NOT VERIFIED LIVE. Live read-only counts today: 19 counted leads, 17 with no recorded source; the only source value seen is a website form.
- **Missed calls (N5)** stay blocked (no call result stored). After the merge the sync re-reads recent leads and logs "probe: call message fields" (names only); read that line in the Vercel log and tell me the field names.
- **The same person in King's own three test accounts counts three times** (one shared test contact). Mark the test accounts in Settings (F8 adds the control) so they are left out.
- Migration `20261102030000_speed_f2.sql` (new columns `lead_touches.auto_touch_at`, `human_touch_at`, `read_version`, `team_names.photo_url`) is already APPLIED to the live database (backups `lead_touches-2026-11-01T21-33-43-694Z.json` 379 rows and `team_names-2026-11-01T21-33-43-694Z.json` 43 rows; counts unchanged after).

## 20. From stage E0 (personal connections): the four live switches and morning tests
- **The four live switches are all OFF** (`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`, set as Vercel environment variables to exactly `true`). I do not change Vercel variables. What each does when you turn it on: `WRITE_GHL_LIVE` lets SubSync write meeting notes, internal comments and fields into the CRM (needs the optional `contacts.write` permission, already in the app; internal comments need `conversations/message.write`); `FATHOM_WEBHOOK_LIVE` lets a person's Fathom connection create its webhook; `SEND_SLACK_LIVE` and `SEND_EMAIL_LIVE` let alerts and emails actually go out.
- **Behaviour change on merge:** the OLD shared Fathom path stops writing notes into the CRM until `WRITE_GHL_LIVE=true` (notes are still saved inside SubSync). That setting was opt-in and off by default.
- **Morning tests, in this order (nothing was tested live):** (1) the CRM note/comment length test on KD Squares Test: `node --env-file=.env.local --import tsx scripts/ghl-write-limits.ts --run` with `WRITE_GHL_LIVE=true` set for that command only (the script refuses otherwise); the limits assumed are note 3,000, comment 2,000 and text field 500 characters until proven; (2) connect your own Fathom with `FATHOM_WEBHOOK_LIVE=true` and `WRITE_GHL_LIVE` still off: expect a `meetings` row and a WOULD WRITE line, no note; (3) then `WRITE_GHL_LIVE=true` for one real note authored as you, and check it shows on the contact.
- **Scopes for release 2.2.0:** optional `conversations/message.write` (internal comments). Already requested and enough: `contacts.write`, `users.readonly`, `locations/customFields.readonly`.
- **Housekeeping:** remove the unused `SUPABASE_SERVICE_ROLE_KEY` and the unused `NEXT_PUBLIC_SUPABASE_*` pair from every Vercel environment and from your `.env.local` (no code uses them); decide whether to backfill the Supabase migration ledger (5 of 30 recorded).
- Migration `20261102070000_user_connections.sql` is already APPLIED (5 new empty tables, row level security on, no policy, public roles refused, proved by `scripts/supabase-proof.ts`: 28 passed, 0 failed, 6 not verified live).

## 21. From stage F5 (Today)
- **Decision to approve:** an agency person who opens SubSync from inside a client account now sees EVERY page narrowed to that account until they press "See all client accounts" (before: they landed on the account page and other pages stayed unfiltered). Say "narrow only Today" if you prefer; it is a one-line change in `dashboard.tsx`.
- **Load:** Today now makes six reads. If the 53,000-contact account feels slow, tell me and I will cache or trim them.
- The Today filter help says "Owners can change which accounts count as test accounts in Settings": true only after F8's Settings control is merged (check in the morning).

## 22. From stage F10 (People and call lists)
- **The CRM dialer link (KF-3): none exists publicly.** The research found no public CRM link that opens a contact's dialer, so every Call button opens the contact in the CRM and says "Not available from your CRM yet". If you know a dialer link pattern for your CRM, send it and I will use it. Users can choose "My own phone app" in the Dialer setting. The CRM's own call history for one lead is read live in the panel and is NOT VERIFIED LIVE (the tokens cannot be opened on this machine).
- **Speed on the hosted app is unmeasured.** From this machine (about 190 ms to the database) every call list loaded in 1.2 to 2.1 s on the 52,926-contact install, People first page 1.3 s; People options 2.9 s and tag detail 2.6 s load in parallel and are cached 60 s. The database itself answers in 13 to 94 ms. Morning check: open People and Call lists on the real account and tell me if any list takes over 2 seconds.
- Migration `20261102100000_f10_people.sql` (new empty table `contact_tag_events`, index `cached_contacts_tags_gin`) is already APPLIED (backup `cached_contacts-2026-11-01T22-16-51-000Z.json`, 107,716 rows before and after).

## 23. From stage F8 (Settings, Getting started, roadmap, trust)
- **Approve the Trust page wording (`/trust`).** Every sentence is derived from tested code or labelled as a promise, but the incident and compliance promises are my wording: you approve them and a lawyer should review. It says honestly "no public status page yet" and shows no company registration number, address, phone or founders (nothing is invented): tell me the real company details to show.
- **"Test account" means the existing "ignore this account" switch** (it also hides the account from lists and reports). Tell me if you want a separate flag.
- **Check on the next real install:** that `contacts.write` is the permission the platform needs to add a note to a contact (the app says "Needs permission: reconnect" otherwise).
- **Feedback and roadmap suggestions are stored and never sent** (a "WOULD SEND" audit line is written for the alert to you). Your admin view is `GET /api/admin/feedback` (server secret) or `node --env-file=.env.local --import tsx scripts/feedback-report.ts`. Real sending needs F9's dispatcher and the live switches (NEEDS_KING section 20).
- Release 2.2.0 scopes: `docs/SCOPES.md` (generated, tested) lists all 21 requested permissions grouped by feature with the reason for each.
- Migration `20261102090000_f8_feedback.sql` (two new empty tables, row level security on) is already APPLIED.

## 24. READ FIRST: the run stopped at the weekly usage limit
- (a) The overnight run hit your weekly usage limit (resets Nov 3, 7pm New York). Done and merged on branch `overnight/2026-11-01`: S0.2b, S0.4, F1, D0, F2, F3, F4, F5, F6, F8, F10, E0. Unfinished with work saved on their own branches: F9, E2a, C1. Not started: E2b, D1.
- (b) NOTHING is on `main`, and the merged branch has NOT been tested as a whole (only typechecked), so it must not go live yet. Your live app is unchanged except for the additive database migrations listed in this file (old code works with them).
- (c) What you do: nothing now. When the limit resets, tell me "Continue the overnight run". I will run the full tests, fix failures, finish F9, E2a, C1, E2b and D1, test again, and then merge to main as you asked.
- (d) Risk if you do nothing: none for the live app. The new work simply waits.

## 25. From stage E2a (Fathom end to end): recommendation KEEP (based on fixtures only, nothing live)
- **Nothing was run live.** The Fathom handler, the private Meeting inbox, the first-save preview and the expiry job are built and tested with signed fixtures and the dry-run CRM client (all four live switches off). The 9 live proofs and your exact morning test for each are in `docs/features/E2a.md` ("NOT VERIFIED LIVE"). Order: (1) turn the `meetings` feature flag on for your own account; (2) connect your own Fathom with `FATHOM_WEBHOOK_LIVE=true` (WRITE_GHL_LIVE still off): expect a stored meeting and a WOULD WRITE line; (3) then `WRITE_GHL_LIVE=true` for one real note authored as you.
- **Open questions only a live run answers:** whether Fathom accepts the OAuth token when creating a webhook, and whether the 400 fallback is the right signal for a solo (non-team) Fathom plan.
- Staff of the company (not account users) are not matched yet, so their calls wait in the inbox.
- New cron `/api/cron/meeting-expiry` (daily 03:20, in `vercel.json`, takes effect on merge): clears expired inbox calls, handled calls after 90 days, delivery ids after 30 days.
- Migration `20261102130000_e2a_fathom_inbox.sql` (two new empty tables, row level security on, no policy) is already APPLIED. `scripts/supabase-proof.ts` reports 29 passed, 1 failed (the failure is migration files vs live tables from other stages not yet merged in that worktree; re-run after all merges), 6 not verified live.

## 26. From stage C1 (Clients)
- **Check the Clients page in the demo:** fees, renewals, industries and logged conversations should now show (the demo fills itself on the first open after the merge and ignores errors, so if it still says "not set" tell me).
- **The "Fix it" links in Onboarding use CRM settings addresses written from memory, not checked against a live account** (each step also says in words where to click). Please click each one once on a real account and tell me which are wrong; they are all in `FIX` in `src/lib/analytics/client-success.ts`.
- "Value created" now counts only deals with a value and an owner, so it can read lower than before. "Stuck" counts days since SubSync first saw the client account, not since the agency signed the client.
- The Review no longer prints the team's private notes about the client (the old one did): intentional.
- Auto-fill of fee and renewal from billing needs the financial scopes (R1, parked). Migration `20261102110000_c1_clients.sql` (four new empty tables) is already APPLIED.

## 27. From stage F9 (alerts, Slack, notifications): READ BEFORE MERGING TO MAIN
- **IMPORTANT, behaviour change on merge: every email and every Slack post now goes through `SEND_EMAIL_LIVE` and `SEND_SLACK_LIVE`, both off.** After this is live, the Monday email, the alert emails, the Slack alerts and the daily brief are only logged as "WOULD SEND" until YOU set both variables to `true` in Vercel (Project, Settings, Environment Variables, Production, then redeploy). Your 3 real installs currently receive these messages; they would stop at the moment of the merge. I do not change Vercel variables, so before I merge to main you must either set both to `true` (messages continue as today) or accept the pause. Tell me which.
- `RESEND_API_KEY` and `EMAIL_FROM` are not in the local `.env.local`, so the one allowed test email to king@kdsquares.com was not sent and inbox-versus-spam placement is NOT VERIFIED LIVE. Morning test: `node --env-file=.env.local --import tsx scripts/send-test-emails.ts code@kdsquares.com` (it refuses any other address and sends at most 5 in 24 hours).
- **DNS for kdsquares.com (read-only lookups): SPF, DKIM (`resend._domainkey`) and DMARC are all present; nothing required is missing.** DMARC is `p=none`; the stricter record to move to later is in `docs/features/F9.md` section 6.
- **Slack live connect still needs you (N92):** api.slack.com/apps, SubSync, OAuth & Permissions, Redirect URLs: add `https://subsync.kdsquares.com/api/integrations/slack/callback`, press Add, then the separate Save URLs; and the app keys (`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`) must be in Vercel.
- Two places connect Slack (E0's Team connections card and the new Notifications page): the earlier channel shows in Notifications as "set up earlier"; one line removes the duplicate if you prefer.
- The daily brief now appears in the bell for every real company by default; the weekly email uses the generic composer so it looks simpler than the old styled one (DECIDED FOR KING: a ninth kind "Other alerts" keeps late replies, stale deals, churn risk and data quality reaching people).
- Migration `20261102120000_f9_notifications.sql` (five new empty tables, row level security on) is already APPLIED.
