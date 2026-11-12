# How to test the automations (use a throwaway test account you own, never a client)

Nothing below was ever run against a real CRM account (see docs/TEST_SPEED_GUIDE.md). This guide says how, one automation at a time, and what is likely to break.
Written 11 Nov 2026. VERIFIED = read in our code or database today. UNVERIFIED = depends on the CRM, found out only by running it.

## 0. Before anything (10 minutes)

1. Run the read-only report (changes nothing, prints no secrets) from the project folder:
   `node --env-file=.env.local --import tsx scripts/automation-readiness.mts "KD Squares Test"`
   Every NO under a section tells you which test below will not work yet. Run it again after each fix.
2. The safe switches (all OFF unless the value is exactly `true`). **Claude never turns any of them on. You do, in Vercel > Settings > Environment Variables (Production), then redeploy.**

| Switch | What it allows | Turn on when |
|---|---|---|
| `WRITE_GHL_LIVE` | SubSync writes to the CRM (tags, notes, creating the workflows) | tests 2, 3, 4, 8 |
| Per-account opt-in | The same, for one account (Settings > allow changes for this account) | with the switch above; both are needed |
| `WORKFLOWS_WRITE_LIVE` | Publish or pause a workflow from the Workflows module | test 7 only |
| `SEND_EMAIL_LIVE` | Real emails leave (digest, save-account, breach, speed summary) | tests 5, 6 last step |
| `SEND_SLACK_LIVE` | Real Slack posts | only if you connect a test Slack |
| `FATHOM_WEBHOOK_LIVE` | Create or remove a meeting-tool subscription | not part of this guide, leave off |

   With a switch off the action is **written to the log as "WOULD SEND" or "WOULD WRITE" (ids and field names only) and nothing leaves.** That dry-run line is itself a pass for the "does it fire" part, so do every test dry first, then live.
3. Known blocker found today on "KD Squares Test": **the permissions `workflows.readonly`, `workflows.write` and `workflows.publish` are NOT granted** (the report shows NO). Tests 2, 3 and 7 cannot create anything until you reconnect the app on that account and approve them (needs the app's optional scopes; if the approve screen does not offer them, the app version in the developer portal needs them ticked, a Major update). Until then the setup screen shows "Needs permission: reconnect" (correct behaviour, test that wording too).
4. Plan: the test account is on the Free plan. Check `ENTITLEMENTS_MODE` is `open` or the account has a paid plan, otherwise paid screens stay locked.
5. Screenshots: for every test take one of SubSync and one of the CRM, with the time visible. Send them back named `T1-subsync.png`, `T1-crm.png`, and so on.
6. Never test on a client. Use only contacts you create with your own phone and email, named `ZZ-TEST ...`.

## 1. Missed-call text-back

- **What it is.** A message to the person who called and was not answered. **SubSync does not build or send it** (a message to a customer is the customer's own automation; docs/features/WORKFLOW_SETUP.md, library guide "Missed call text back"). SubSync only measures whether anyone called back.
- **Build the CRM side yourself once:** Automation > Create workflow > trigger "Call status" = missed > one text step in your words from your own number > Publish.
- **Trigger.** From a second phone call the test account's number and let it ring out. Wait about 45 seconds.
- **Expect in the CRM:** the contact is created or updated, the missed call shows in the conversation, your text-back is sent (your workflow, not SubSync).
- **Expect in SubSync** (after the next sync, 5 minutes): Speed > Coverage "Missed calls nobody called back" counts it; Call mode > "Missed calls, no callback" lists the same person. Call them back from the CRM: the person leaves both lists.
- **Switches:** none from SubSync. Your own workflow sends real text, so use your own number only.
- **Undo:** unpublish your workflow. SubSync has nothing to undo.
- **Risks:** the Call mode list was flagged "fix in progress" in the Speed guide; count mismatch is the thing to report. If the call record does not arrive in under 5 minutes, send the screenshot of the call in the CRM.

## 2. Call queue: the `call-now` tag and the "Lead Response Automations" folder (most likely to need fixes)

- **What it does.** Creates, in the CRM, a folder named **Lead Response Automations** holding a workflow **Call queue**: when a contact gets the tag `call-now`, a "Manual Action: Call" task is created for a chosen user or round robin, then the tag is removed. It never messages the contact.
- **Setup steps.** SubSync > Call mode > Call queue setup > **Set up**. First with `WRITE_GHL_LIVE` off: it answers "Would create folder X and workflow Y" (a rehearsal; screenshot it). Then turn the switch on, make sure the account opt-in is on, press Set up again.
- **Expect in the CRM:** Automation > folder "Lead Response Automations" > workflow "Call queue", published. Expect in SubSync: the card shows it as set up, the report's section 4 says YES.
- **Fire it.** In the CRM add the tag `call-now` to a `ZZ-TEST` contact (or in Call mode choose a list and press send to queue; that adds the tag through the safe gateway, at most the capped number of leads). Expect: a Call task in Conversations > Manual Actions, and the tag disappears from the contact within about a minute.
- **Safe switches:** `WRITE_GHL_LIVE` + account opt-in (create and tag), permissions `workflows.write`, `workflows.publish`, `contacts.write`.
- **Undo:** SubSync never deletes or edits a workflow it made. Delete or unpublish it yourself in the CRM (Automation > folder). Remove stray tags in the CRM. Our setup record can be left; Set up will not duplicate (it finds the folder and the workflow by name first).
- **Known risks (UNVERIFIED until the first run):**
  1. The Workflows create call is "limited availability": the CRM may answer 403 `WORKFLOW_API_NOT_ENABLED`. Then the card shows a calm message and a "Do it yourself in 5 steps" guide. That is a pass for the fallback, not a bug. Follow the 5 steps and press "I did it".
  2. The step field names (trigger tag list, manual-action assignment, remove-tag) are guesses from the docs. SubSync validates before creating; a rejection falls back to the guide. Send the exact message shown.
  3. If the trigger step type cannot be found the card says a step type is missing.
  4. Round robin may not be accepted for a manual action in every plan; pick one user and retry.
  5. Nothing in SubSync applies `needs-first-reply` or `no-show-follow-up` for you (see tests 3 and 4).

## 3. Speed alerts (slow first reply)

- **What it does.** Measures first human reply per new lead against the account's target and raises an in-app alert (and an email when sending is on) when a lead breaches. The optional workflow "Slow first reply call" (tag `needs-first-reply`) can turn a breach into a call task, but **only when somebody (you, or a workflow you build) adds that tag**: SubSync does not add it by itself.
- **Steps.** Speed > Rules: target 1 minute, quiet hours off, your own email as the recipient. In the CRM create a `ZZ-TEST` lead, do not reply. Wait for the next sync.
- **Expect in SubSync:** the lead in Speed > Race with a growing wait; a breach in Log and the bell, escalation steps in order. With `SEND_EMAIL_LIVE` off the Log shows `WOULD SEND` for the email. Reply as a person: the clock stops. An automatic message must not stop it.
- **For the tag workflow:** install "Slow first reply call" from the library (same rules as test 2), add the tag `needs-first-reply` yourself, expect a Call task and the tag removed.
- **Undo:** set the target back in Rules; resolve the alert; remove the test lead.
- **Risks:** Today's ledger still judges against the default target, not the account's own (noted in SPEED.md). The Slow-reply template only runs if the tag is added; nothing adds it automatically yet.

## 4. No-show recovery

- **What it does.** Appointments > no-shows not rebooked (recovery list), with a Call button that opens the contact in the CRM. Optional workflow "No-show follow-up call" (tag `no-show-follow-up`) makes a call task. It never texts the person. SubSync does not apply the tag by itself.
- **Steps.** In the CRM book a `ZZ-TEST` appointment 10 minutes ahead on a calendar of the test account, then after it passes set the status to No-show (or leave it with no status to test "Needs an outcome").
- **Expect in SubSync** after sync: Appointments lists it under no-show or "Needs an outcome"; the count is clickable to that person; Call opens the CRM contact. Rebook the person: it leaves the recovery list.
- **Tag workflow:** install "No-show follow-up call", add `no-show-follow-up` yourself: Call task appears, tag removed.
- **Switches:** none for reading. `WRITE_GHL_LIVE` + opt-in + `calendars/events.write` only if you record an outcome from SubSync (preview and confirm first).
- **Undo:** set the appointment status back in the CRM; delete the test appointment.
- **Risks:** appointment status words differ by calendar; report any status SubSync misreads. Time zone of the test account must be set.

## 5. Morning "save this account" email (dry run)

- **What it does.** One email per person per business day at the chosen hour: which accounts need saving, read only. Never messages a lead.
- **Steps.** Needs switches `cf_save` and `cf_email` (the report shows them ON in the database). Cash features > turn the morning email on, set the hour to the next hour, add your own email, add one muted account to prove muting.
- **Expect (dry run, `SEND_EMAIL_LIVE` off):** within the hour the Log has a `WOULD SEND` line for you (ids only) and nothing arrives in the inbox; running the job again the same day sends nothing (the day key is claimed first).
- **Go live last:** set `SEND_EMAIL_LIVE=true`, redeploy, wait for the next hour: one email to you. Check links open the right account and carry no vendor words. Check SPF/DKIM with `scripts/check-email-setup.ts`.
- **Undo:** turn the email off in Cash features; set `SEND_EMAIL_LIVE` back to off.
- **Risks:** the report showed the email provider key and sending address NOT set on this computer; confirm they are set in Vercel. Spam folder placement is the usual first-send problem.

## 6. Digest emails and breach alerts

- **Daily brief and weekly summary** (cron `daily` hourly, `weekly` hourly): Settings > Notifications, choose your hour and your email. Dry run: a `WOULD SEND` line in Log at that hour, once per day or week. Live: one email.
- **Speed summary** (cron `speed-digest`): Speed > Summary messages, add one with you as the recipient. Dry run writes `WOULD SEND`.
- **24-hour unanswered breach** (cron `inbox-breach`, needs `inbox_breach_alert`, ON): leave a `ZZ-TEST` inbound message unanswered 24 hours (or lower the per-account target if offered). Expect a breach alert in the bell, an email line in Log, and no repeat for the same conversation (deduped).
- **Slack:** only after you add a test Slack channel in Settings > Notifications and turn `SEND_SLACK_LIVE` on. A client's channel only ever gets that client's data.
- **Undo:** switch the message off in Notifications; switches back to off.
- **Risks:** a late run still sends within 3 hours, a very late one is skipped by design; time zone must be right.

## 7. Workflows module (install and rehearsal)

- **What it does.** Library of templates (Call queue, Slow first reply call, No-show follow-up call) you can install in one or many accounts (cap 25), with a preview table: would create, rehearse, exists, blocked. Rehearse means recorded, nothing sent.
- **Steps.** Needs `wf_library` (and `wf_bulk` for many). Workflows > Library > pick a template > choose only the test account > Preview. With switches off every row says rehearse; that is the first pass. Then with `WRITE_GHL_LIVE` and the opt-in on, Install.
- **Expect:** same CRM result as test 2; a second install says "exists" and creates nothing; an account without `workflows.write` says "Needs permission: reconnect".
- **Pause or publish** from the module needs `WORKFLOWS_WRITE_LIVE`, a preview, a signed confirm (15 minutes) and a typed name for deletes. Leave it off; test only the preview and the refusal.
- **Undo:** as test 2.
- **Risks:** same UNVERIFIED step names. Module reads (`workflows.readonly`) are missing on the test account today.

## 8. Safe gateway writes (tags, notes, field fixes)

- **What it does.** Every change to a contact goes through one gateway: master switch, account opt-in, preview, typed confirm, guardrails (do-not-disturb, deals, paying customers, never across accounts), spaced calls, one audit line (ids and field names only), a before-value so it can be undone.
- **Steps.** Create 3 `ZZ-TEST` contacts with a messy field (lowercase name, stray spaces). Data cleanup > fix lists > preview shows before and after > type the count to confirm. Dry run first: the contacts stay unchanged and a `WOULD WRITE` line appears. Then switches on: the fields change in the CRM.
- **Expect in the CRM:** only the named fields changed on the three contacts; the audit log row says `crm.write` with no values. **Undo** button in SubSync restores the before-values; check in the CRM.
- **Risks:** a person marked do-not-disturb must be skipped with a reason (test with one). A merge cannot be undone, do not test merge on anything you care about. The test account already has 11 earlier `crm.write` audit rows (6 Nov), so look at the newest ones.

## What to send back for each test
Worked or did not, the screenshots, the exact on-screen message if it failed, and the readiness report output before and after. After the tests, set every switch you turned on back to off unless you mean to keep it.
