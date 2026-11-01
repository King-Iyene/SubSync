# SubSync Overnight Run: M1 and M2 (continuous, autonomous)

This file is the instruction. Follow it exactly. King is asleep and will not answer anything until morning.

**Do NOT ask King questions. Do NOT wait for NEXT or for approval between stages. Do NOT write "waiting for King" mid-run.** Every "STOP" at the end of a stage prompt in docs/ROADMAP_V2.md is replaced by: write King's 5 checks into docs/OVERNIGHT_LOG.md and go straight on to the next stage. Stop only for the hard-stop reasons in section 9.

---

## 1. First (15 minutes at most)

1. Save this file as docs/OVERNIGHT_RULES.md (it may already be there). **At the start of every stage, and after any context compaction, re-read in full:** docs/OVERNIGHT_RULES.md, docs/OVERNIGHT_LOG.md, docs/NEEDS_KING.md, docs/NOTES_COVERAGE.md, docs/PROGRESS.md. This is how you keep the plan across a very long run.
2. Use only the OneDrive repo (C:\Users\KING\OneDrive\Desktop\SubSync). Never touch C:\Users\KING\Desktop\SubSync.
3. Do not interrupt the integration test run that is already going. Wait for it (at most 20 minutes). If S0.3's tests are green, treat S0.3 as PASSED by King (pre-approved; King does the 5 checks in the morning). If not green, fix only what the failing tests show (two tries). If still not green, stop.
4. If docs/ROADMAP_V2.md, docs/INTEGRATIONS_SPEC.md or docs/KING_REVIEW_NOTES.md are not yet in docs/, copy them from Downloads (SubSync_Roadmap_V2_Compiled_Prompts.md, SubSync_Integrations_and_Meeting_Notes_Spec_v1.md, SubSync_King_Review_Notes.md). Check they are the new versions: "V2.1" and "E0" in the roadmap; "3.2 Agency users" and "11.1 Supabase rules" in the spec; "N104" in the notes. If a check fails, stop.
5. Put principles 1 to 14 from section 2 of docs/ROADMAP_V2.md into CLAUDE.md exactly once, between `<!-- SUBSYNC OPERATING PRINCIPLES START -->` and `<!-- SUBSYNC OPERATING PRINCIPLES END -->`.
6. Create branch `overnight/2026-11-01` from the current commit. Do ALL work on it. Commit the docs there. Push the branch after every commit so a sudden stop loses nothing.
7. Create docs/NOTES_COVERAGE.md (section 6), docs/NEEDS_KING.md and docs/OVERNIGHT_LOG.md.

---

## 2. Scope and order

Work in this exact order, one stage at a time, using the stage prompts and addenda in docs/ROADMAP_V2.md:

**M1, the sellable audit:** S0.2b, S0.4, F1, D0, F2, F3, F6
**M2, pilot-ready:** F4, F5, F8, F9, F10, C1, E0, E2a, E2b, D1

**NEVER start** (not tonight): Z1, Z2, Z3, T1, C1b, P1, C2, E5, W1, E1, E3, R1, E4. These touch the marketplace, need King's definitions, or wait for pilot evidence.

**Dependencies:** if a stage fails, revert it to its tag, write why, and continue only with stages that do not depend on it. E2a needs E0. E2b needs E2a. If every remaining stage depends on the failed one, stop.

**Usage limit:** King's weekly limit may run out mid-run. If you see a usage warning, immediately finish or revert the current step, update the log and NEEDS_KING, push the branch, and stop cleanly. Never leave a half-applied change.

---

## 3. DRY-RUN MODE for anything that touches the outside world

Build every feature fully, **including the outward-facing parts**. But the outward action itself stays OFF behind flags that default to false and are committed as false:

`SEND_EMAIL_LIVE`, `SEND_SLACK_LIVE`, `WRITE_GHL_LIVE`, `FATHOM_WEBHOOK_LIVE`

- In dry-run the code builds the exact request, writes "WOULD SEND" or "WOULD WRITE" with the payload (ids and field names only; no secrets, no message bodies of real customers) to the audit table and the log, and sends nothing.
- Tests use fake transports and **signed sample payloads** (for example a Fathom webhook fixture). Check request shapes against the documented APIs (docs/INTEGRATIONS_SPEC.md section 4). Anything not proven against the real service is marked **NOT VERIFIED LIVE** in the ledger, and the exact morning test goes into docs/NEEDS_KING.md.
- **The one live exception:** transactional test emails to the allowlist `king@kdsquares.com`, at most 5 in the whole night, through a code-level allowlist guard that rejects every other recipient. Add a test that proves the guard rejects another address. No other email, no text message, no Slack message, no post.
- Never create a real Fathom, Slack or Zoom connection or webhook. Never write to a real GHL contact, note, comment or field. Reading real data is fine and expected.
- Read-only checks are allowed, for example a DNS lookup of SPF, DKIM and DMARC for kdsquares.com (F9 item 6). Report the result.

Stage notes:
- **F8:** feedback and suggestion alerts to King are dry-run (or the allowlisted email). The Trust page and "What we store" must state only what is true, and an automated check must prove it.
- **F9:** build the dispatcher, the preferences matrix, the copy editor, the in-app bell and the Slack connect flow. Test with fake transports. Slack live connect needs King to fix the redirect URL first; list it in NEEDS_KING.
- **E0:** follow docs/INTEGRATIONS_SPEC.md including section 11.1 (Supabase proof) and the migration rules in section 8 below. Tokens never printed.
- **E2a and E2b:** the Fathom webhook handler, matching, Meeting inbox, destinations and field mapping are built and tested with signed fixtures and the dry-run GHL client. The write scopes are not granted yet: the screens say "Needs permission: reconnect". List the scopes for release 2.2.0 in NEEDS_KING.
- **D1:** polish only, using the D0 components.

---

## 4. Autonomy: do not wait, skip the critical, tell King after

- You have King's approval for everything inside the scope and not on the critical list. Never stop to ask.
- When a decision is needed: take the safest default in docs/ROADMAP_V2.md, log it, continue. If there is no safe default, take the most reversible option, log it as "DECIDED FOR KING, please review", and continue.
- **CRITICAL** means anything irreversible, reaching outside this repo, touching money, messages or customers, or able to break the live app for the 3 real installs. Examples: sending anything to a real person, billing or plan changes, GHL marketplace version, scope, price or listing changes, changes to the Fathom, Slack or Zoom app registrations, rotating or printing secrets, deleting real data, destructive or access-tightening database changes, pushing to main, merging.
- For every critical item: **SKIP it, do not do a partial version**, write it to docs/NEEDS_KING.md with (a) what it is, (b) why it was skipped, (c) the exact click or command King must do, (d) the risk if he does not, and CONTINUE with other work.
- If blocked (tool fails, credential missing, service down): log it, skip that part, move to independent work. Never loop on the same failure more than twice.

---

## 5. ANTI-SKIM (reading and finishing properly, no shortcuts)

- **READ FULLY.** Before each stage, read the stage's whole prompt and every note and spec section it references, start to finish, in chunks if needed. Searching for keywords is not reading. After reading, write into the log a numbered list of EVERY instruction and every acceptance clause in that stage, in your own words. If your list has fewer items than the prompt has sentences containing "must", "do", "add", "test" or "acceptance", read again.
- **NO EVIDENCE, NOT DONE.** At the end of each stage write a table, one row per item from that list: DONE with evidence (file and line, test name, or the command and its real output), or SKIPPED or BLOCKED with the reason. Never write "done", "similar to above", "etc." or "as before" without a row for each item.
- **NO FAKE WORK.** No placeholders, no TODO stubs, no hard-coded or mocked numbers shown as real, no tests that assert nothing, no loosening, deleting or skipping a test to make it pass, no disabled checks. If a test is wrong, say so in the log, fix it properly, and explain. Run the FULL test suite at the end of every stage (not a subset) and copy the real result line into the log. Never write "all tests pass" without the command and its output.
- **REAL DATA.** Where a stage says to verify against real accounts, contacts or roles, do it and record the numbers (for example "332 contacts in the app, 332 in GHL"). If you cannot, write "NOT VERIFIED ON REAL DATA", never "verified".
- **NO SILENT SCOPE CUTS.** Anything left out of a stage goes into the SKIPPED rows. A shorter stage than the prompt describes with no SKIPPED rows is a failure.
- **SELF-AUDIT BEFORE EACH COMMIT.** Re-read the stage prompt once more and tick every sentence against your table. Read your own diff. Remove or log anything outside the stage's scope or unexplained.
- **BE HONEST.** When unsure, write "UNSURE:" and the reason. Do not smooth over a failure.

---

## 6. NOTES COVERAGE LEDGER (list them all out)

- At the start, read docs/KING_REVIEW_NOTES.md in full (N1 to N104) and docs/BUYER_AND_UX_REVIEW.md in full. Create docs/NOTES_COVERAGE.md with one row for EVERY note N1 to N104 and every buyer-review finding (S1, S2, S3). Columns: ID, one-line title, the stage that handles it (from docs/ROADMAP_V2.md), status.
- Statuses: **DONE-TONIGHT** (with evidence), **PLANNED-LATER** (name the stage), **NEEDS-KING** (it is in docs/NEEDS_KING.md), **PARKED** (say why), **NOT-A-CODE-ITEM** (a decision or question for King). No note may be missing, and none may have neither a stage nor a reason.
- A note with no stage in the roadmap goes under ORPHANS, with a proposed stage in docs/NEEDS_KING.md.
- Print the counts per status at the start and again at the end. Update the status column after every stage.

---

## 7. Decisions King pre-approves

- **D0 style guide:** build it with tokens only, on the KD Squares palette (navy #000C25 to #02244F, brand teal #0A658B, gold #D4AD58), light and dark. Mark it "style awaiting King's approval".
- **Anything needing a new GHL scope:** build it so the screen says "Needs permission: reconnect" when the scope is missing, and list it for release 2.2.0 in docs/NEEDS_KING.md. Do not change the marketplace app.
- **Zoom and Google Meet** stay hidden behind the flag (S0.2b item 6). Slack and Fathom stay visible.

---

## 8. Safety (never do, even if a stage says so)

- Never push to main, never merge, never force-push. Work on `overnight/2026-11-01` only.
- Never send an email (except the allowlist exception in section 3), text or Slack message, post anywhere, spend money, upgrade a plan, or rotate or print a secret.
- Never change or deprecate a GHL marketplace version, pricing or listing. Do not touch the Fathom, Slack or Zoom app registrations.
- **Live Supabase migrations are allowed ONLY if all of these are true:** additive (new tables, columns or indexes; no drops, renames or deletes); idempotent; the old main code keeps working after it; you first save the affected tables to a local `backups/` folder (gitignored) and record row counts; you verify the counts after. A one-off update of a stored setting value is allowed only with that backup and only on the stage's own table. **Any migration that tightens access (row level security or policies) or could break the live app: write the file, do NOT apply it, and put it in docs/NEEDS_KING.md as "King applies with the merge".**
- Never delete real customer data. Test deletion on test data only.

---

## 9. How, and when to stop

- One commit per logical step. At the end of each stage commit "stage <ID>: <title>" and tag `stage-<ID>`.
- Keep steps small. If a step cannot finish cleanly, revert it and log what happened.
- Stop a stage (then follow the dependency rule) if: a test fails twice after fixes; any security or tenancy test fails; you find changes outside the stage's scope.
- Hard stop for the whole run: the usage limit, the integration chain dead for more than 20 minutes with no independent work left, or every remaining stage blocked.
- Mark every stage **"BUILT, awaiting King's checks"**. Never write "PASSED".
- After each stage append one line to docs/OVERNIGHT_LOG.md and print one short line in the chat, then go straight on.

---

## 10. Morning report, printed IN THE CHAT

King never opens GitHub or the repo. **Everything he needs must be printed here in the chat.** Never tell him to "check the file".

At the end, print in this order:
1. The FULL text of docs/NEEDS_KING.md.
2. docs/NOTES_COVERAGE.md: the counts per status, then every note that is NOT DONE-TONIGHT in one block with its stage.
3. Per stage: built, blocked or skipped, with a compact evidence table (the full tables stay in docs/OVERNIGHT_LOG.md; King can type "show <stage> evidence").
4. Tests run and their real result lines.
5. Files changed and counts.
6. Every decision you made for King, including "DECIDED FOR KING".
7. Everything you are UNSURE about.
8. King's 5 checks per stage, in plain words, in the order he should do them (M1 first).
9. Migrations applied (with backup file names and row counts) and migrations held.
10. What was NOT VERIFIED LIVE (the dry-run items) and the exact morning test for each.
11. What you did NOT do.
12. The branch name and ONE sentence King can type to merge, for example: "Merge stages up to F3 into main". When he types it, run the merge up to the tag `stage-<ID>` yourself, run the full tests, push, and report. Never merge before he says so.

Then print "Overnight run finished. Waiting for King." and stop.


---

# APPENDIX: the same instructions as typed in the chat (word for word, in the order King sent them)

Precedence: the M2 ADD-ON (third block) OVERRIDES any line in the first block that conflicts with it. In particular the first block's "NEVER start F9, E0, E2a, E2b" and its "safe-stage test" are REPLACED by the M2 list. Zoom and Google Meet stay hidden, Slack and Fathom stay visible.

## Block 1: OVERNIGHT MODE

OVERNIGHT MODE, CONTINUOUS AND AUTONOMOUS. I am going to sleep and will not answer anything until morning. Do NOT ask me questions. Do NOT wait for NEXT or for approval between stages. Work through the whole scope below on your own. Stop only for the hard-stop reasons listed here.

FIRST (10 minutes max)
1. Save these rules word for word to docs/OVERNIGHT_RULES.md. Re-read that file, docs/OVERNIGHT_LOG.md, docs/NEEDS_KING.md and docs/PROGRESS.md IN FULL at the start of every stage and after any context compaction, so you never lose the plan.
2. Use only the OneDrive repo (C:\Users\KING\OneDrive\Desktop\SubSync). Never touch C:\Users\KING\Desktop\SubSync.
3. Do not interrupt the integration test run that is already going. Wait for it (at most 20 minutes). If S0.3's tests are green, S0.3 is PASSED by King (I pre-approve it; I will do the 5 checks in the morning). If not green, fix only what the failing tests show (two tries), then continue if green, otherwise stop.
4. If docs/ROADMAP_V2.md, docs/INTEGRATIONS_SPEC.md or docs/KING_REVIEW_NOTES.md are not yet in docs/, copy them from Downloads (SubSync_Roadmap_V2_Compiled_Prompts.md, SubSync_Integrations_and_Meeting_Notes_Spec_v1.md, SubSync_King_Review_Notes.md) and check they are the new versions (V2.1 and E0 in the roadmap; "3.2 Agency users" and "11.1 Supabase rules" in the spec; "N104" in the notes). If a check fails, stop.
5. Put principles 1 to 14 from section 2 of docs/ROADMAP_V2.md into CLAUDE.md exactly once, between <!-- SUBSYNC OPERATING PRINCIPLES START --> and <!-- SUBSYNC OPERATING PRINCIPLES END -->.
6. Create branch overnight/2026-11-01 from the current commit and do ALL work on it. Commit the docs there. Push the branch after every commit so a sudden stop loses nothing.

SCOPE, in this order (my review and the buyer review turned into stages)
S0.2b, S0.4, F1, D0, F2, F3, F6. This is milestone M1 (the sellable audit).
If M1 finishes, continue with the next stages in docs/ROADMAP_V2.md section 3 order ONLY if they pass the safe-stage test: no sending to real people, no new connection to an outside service, no writing to GHL contacts, no GHL version, scope, price or listing change, no billing, and no decision marked "King decides". NEVER start: F9, E0, E2a, E2b, E1, E3, Z1, Z2, Z3, T1, W1, R1.
Dependencies: if a stage fails, revert it to its tag, write why, and continue only with stages that do not depend on it. If every remaining stage depends on it, stop.

AUTONOMY: DO NOT WAIT FOR ME, SKIP THE CRITICAL AND TELL ME AFTER
- You have my approval for everything inside the scope and not on the critical list. Never stop to ask. Never write "waiting for King" mid-run.
- When a decision is needed, take the safest default in docs/ROADMAP_V2.md, log it in docs/OVERNIGHT_LOG.md, and continue. If there is no safe default, take the most reversible option, log it as "DECIDED FOR KING, please review", and continue.
- CRITICAL means anything that is irreversible, reaches outside this repo, touches money, messages or customers, or could break the live app for the 3 real installs. Examples: sending anything to a real person, billing or plan changes, GHL marketplace version, scope, price or listing changes, changes to the Fathom, Slack or Zoom app registrations, rotating or printing secrets, deleting real data, destructive or access-tightening database changes, pushing to main, merging.
- For every critical item: SKIP it, do not do a partial version, write it to docs/NEEDS_KING.md with (a) what it is, (b) why it was skipped, (c) the exact command or click I must do, (d) the risk if I do not do it, and then CONTINUE with other work. I will handle docs/NEEDS_KING.md after I wake up.
- If you get blocked (a tool fails, a credential is missing, a service is down), log it, skip that part, and move to independent work. Do not loop on the same failure more than twice.

ANTI-SKIM (reading and finishing properly; no shortcuts)
- READ FULLY. Before each stage, read the stage's whole prompt and every note or spec section it references, start to finish, in chunks if needed. Searching for keywords is not reading. After reading, write into the log a numbered list of EVERY instruction and every acceptance clause in that stage, copied in your own words. If the list has fewer items than the prompt has sentences with "must", "do", "add", "test" or "acceptance", read again.
- NO EVIDENCE, NOT DONE. At the end of each stage write a table with one row per item from that list: DONE with evidence (file and line, test name, or the command and its real output), or SKIPPED or BLOCKED with the reason. Never write "done", "similar to above", "etc.", or "as before" without a row for each item.
- NO FAKE WORK. No placeholders, no TODO stubs, no hard-coded or mocked numbers shown as real, no tests that assert nothing, no loosening, deleting or skipping a test to make it pass, no disabled checks. If a test is wrong, say so in the log, fix it properly, and explain. Run the FULL test suite at the end of every stage (not a subset) and copy the real result line into the log. Never write "all tests pass" without the command and its output.
- REAL DATA. Where a stage says to verify against real accounts, contacts or roles, do it and record the numbers (for example "332 contacts in the app, 332 in GHL"). If you cannot, mark it "NOT VERIFIED ON REAL DATA", never "verified".
- NO SILENT SCOPE CUTS. If you leave anything out of a stage, it goes into the SKIPPED rows. A shorter stage than the prompt describes with no SKIPPED rows is a failure.
- SELF-AUDIT BEFORE EACH COMMIT. Re-read the stage prompt one more time and tick every sentence against your table. Read your own diff. If something is outside the stage's scope or unexplained, remove it or log it.
- BE HONEST. When you are unsure, write "UNSURE:" and the reason. Do not smooth over a failure.

DECISIONS I PRE-APPROVE
- D0 style guide: build it with tokens only, on the KD Squares palette (navy #000C25 to #02244F, brand teal #0A658B, gold #D4AD58), light and dark. Mark it "style awaiting King's approval".
- Anything that needs a new GHL scope: build it so the screen says "Needs permission: reconnect" when the scope is missing, and list it for release 2.2.0 in docs/NEEDS_KING.md. Do not change the marketplace app.

SAFETY (never do, even if a stage says so)
- Never push to main, never merge, never force-push.
- Never send an email, text or Slack message to a real person, post anywhere, spend money, upgrade a plan, rotate or print a secret.
- Never change or deprecate a GHL marketplace version, pricing or listing. Do not touch the Fathom, Slack or Zoom app registrations.
- Live Supabase migrations are allowed ONLY if all of these are true: additive (new tables, columns or indexes; no drops, renames or deletes); idempotent; the old main code keeps working after it; you first save the affected tables to a local backups/ folder (gitignored) and record row counts; you verify the counts after. A one-off update of a stored setting value is allowed only with that backup and only on the stage's own table. Any migration that tightens access (row level security or policies) or could break the live app: write the file, do NOT apply it, and put it in docs/NEEDS_KING.md as "King applies with the merge".
- Never delete real customer data. Test deletion on test data only.

HOW
- One commit per logical step. At the end of each stage, commit "stage <ID>: <title>" and tag stage-<ID>.
- Keep steps small and never leave a change half-applied, because my usage limit can cut you off at any moment. If a step cannot finish cleanly, revert it and log what happened.
- If a test fails twice after fixes, if any security or tenancy test fails, or if you find changes outside the stage's scope: stop that stage, follow the dependency rule, and log why.
- Mark every stage "BUILT, awaiting King's checks". Never write "PASSED".
- After each stage, go straight on to the next. Do not stop to report.

MORNING REPORT
- Keep docs/OVERNIGHT_LOG.md and docs/NEEDS_KING.md updated after every stage. At the very end print, in this order: (1) the contents of docs/NEEDS_KING.md; (2) per stage built, blocked or skipped, with its evidence table; (3) tests run and real results; (4) files changed and counts; (5) every decision you made for me; (6) anything you are UNSURE about; (7) King's 5 checks per stage; (8) migrations applied (with backup file names and row counts) and migrations held; (9) the branch name and the exact commands to review and merge it; (10) what you did NOT do. Then print "Overnight run finished. Waiting for King." and stop.

## Block 2: NOTES COVERAGE LEDGER

NOTES COVERAGE LEDGER (list them out)
- At the start, read docs/KING_REVIEW_NOTES.md in full (N1 to N104) and docs/BUYER_AND_UX_REVIEW.md in full. Create docs/NOTES_COVERAGE.md with one row for EVERY note N1 to N104 and every buyer-review finding (S1, S2, S3), with these columns: ID, one-line title, the stage that handles it (from docs/ROADMAP_V2.md), status.
- Statuses: DONE-TONIGHT (with evidence), PLANNED-LATER (name the stage), NEEDS-KING (it is in docs/NEEDS_KING.md), PARKED (say why), NOT-A-CODE-ITEM (a decision or a question for me). No note may be missing, and none may have neither a stage nor a reason.
- If any note has no stage in the roadmap, list it under ORPHANS and put a proposed stage in docs/NEEDS_KING.md.
- Print the counts per status at the start and again at the end. Update the status column after every stage.
- At the very end, print every note that is NOT DONE-TONIGHT in one block, with its stage.

I NEVER OPEN GITHUB. Everything I need must be printed here in this chat, not left in a file for me to find. At the end, print the FULL text of docs/NEEDS_KING.md and docs/NOTES_COVERAGE.md, not just their paths. Do not tell me to "check the repo". Instead of git commands, give me ONE sentence to type to you in the morning (for example "Merge stages up to F2 into main"), and you run the git commands yourself.

## Block 3: M2 ADD-ON

M2 ADD-ON. This is added to the overnight prompt above and OVERRIDES any line above that conflicts with it. Same rules as above (autonomous, no questions, skip the critical, anti-skim, notes ledger, print everything in the chat). Nothing else changes.

SCOPE
After M1 (S0.2b, S0.4, F1, D0, F2, F3, F6), continue straight on to M2, in this order, using the stage prompts in docs/ROADMAP_V2.md:
F4, F5, F8, F9, F10, C1, E0, E2a, E2b, D1
The "safe-stage test" and the "NEVER start F9, E0, E2a, E2b" line above are replaced by this list. NEVER start: E1, E3, Z1, Z2, Z3, T1, C1b, P1, C2, E5, W1, R1, E4.
E2a needs E0, and E2b needs E2a. If a stage fails, revert it to its tag, log why, and continue with stages that do not depend on it.
If I get a usage warning: finish or revert the current step, update the log and NEEDS_KING, push the branch, and stop cleanly.

DRY-RUN MODE (this is how M2 is safe while I sleep)
Build every M2 feature fully, including the parts that touch the outside world. But the outward action itself stays OFF behind flags that default to false and are committed as false: SEND_EMAIL_LIVE, SEND_SLACK_LIVE, WRITE_GHL_LIVE, FATHOM_WEBHOOK_LIVE.
- In dry-run the code builds the exact request, logs "WOULD SEND" or "WOULD WRITE" (ids and field names only, no secrets, no customer message text) to the audit table and the log, and sends nothing.
- Test with fake transports and signed sample payloads (for example a Fathom webhook fixture). Check request shapes against the documented APIs in docs/INTEGRATIONS_SPEC.md section 4. Anything not proven against the real service is "NOT VERIFIED LIVE" in the ledger, with the exact morning test written in docs/NEEDS_KING.md.
- The one live exception: transactional test emails to the allowlist king@kdsquares.com, at most 5 in the whole night, through a code-level allowlist guard that rejects every other recipient. Add a test that proves it rejects another address. No other email, no text, no Slack message, no post.
- Never create a real Fathom, Slack or Zoom connection or webhook. Never write to a real GHL contact, note, comment or field. Reading real data is fine.
- A DNS lookup of SPF, DKIM and DMARC for kdsquares.com (F9 item 6) is allowed. Report the result.

STAGE NOTES
- F8: alerts to me are dry-run (or the allowlisted email). The Trust page and "What we store" must state only what is true, and an automated check must prove it.
- F9: build the dispatcher, the preferences matrix, the copy editor, the in-app bell and the Slack connect flow, tested with fake transports. A live Slack connect needs me to fix the redirect URL first, so list it in NEEDS_KING.
- E0: follow docs/INTEGRATIONS_SPEC.md, including section 3.2 (agency users) and section 11.1 (Supabase proof), and the migration rules above (additive and backed up; anything that tightens access is held for me). Never print tokens.
- E2a and E2b: webhook handler, matching, Meeting inbox, destinations and field mapping, built and tested with signed fixtures and the dry-run GHL client. The write scopes are not granted yet, so the screens say "Needs permission: reconnect". List the scopes for release 2.2.0 in NEEDS_KING.
- Zoom and Google Meet stay hidden. Slack and Fathom stay visible.
- D1: polish only, using the D0 components.

MORNING REPORT additions
Also print: what was NOT VERIFIED LIVE (the dry-run items) with the exact morning test for each, and in "King's 5 checks" list the stages in the order I should do them (M1 first).
