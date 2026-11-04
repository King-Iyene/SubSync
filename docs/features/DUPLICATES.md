# Duplicate contacts: the guided review (stage DUP)

Status: **BUILT, awaiting King's checks** (4 to 5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\DUP`, branch `stage/dup`). Not marked passed. The review of the old screen and the money-first test are in `docs/DUPLICATES_REVIEW.md`.

## 1. What the platform's merge can really do (researched first)

Sources: the platform's published API description (its public GitHub repository `GoHighLevel/highlevel-api-docs`, file `apps/contacts.json` and `apps/opportunities.json`, read 4 Nov 2026) and its help centre article "How to Manage and Merge Duplicate Contacts" (help.gohighlevel.com, read 4 Nov 2026). No live call was made and no real token was used.

| # | Fact | Label | Source |
|---|---|---|---|
| 1 | The public contacts API has **no merge endpoint**. Its paths are: search, search/duplicate, tasks, appointments (read), tags, notes, bulk tags, bulk business, get/update/delete contact, upsert, business, followers, campaigns, workflows, create, list. None contains "merge". | VERIFIED | `apps/contacts.json`, every path listed |
| 2 | `GET /contacts/search/duplicate` (scope `contacts.readonly`, parameters `locationId`, `number`, `email`) looks up the ONE existing contact for an email or phone, following the account's "Allow Duplicate Contact" setting. It is not a scan, so it cannot list the duplicates of an account. | VERIFIED | same file |
| 3 | The only contact writes are update, delete, tags, notes, tasks, followers, campaigns, workflow membership. All need `contacts.write`. | VERIFIED | same file, `security` of each path |
| 4 | A deal cannot be moved to another contact with the API: the update body of an opportunity holds `pipelineId, name, pipelineStageId, status, monetaryValue, assignedTo, customFields` and no contact. Needs `opportunities.write`. | VERIFIED | `apps/opportunities.json`, `UpdateOpportunityDto` |
| 5 | There is no endpoint to move a conversation or an appointment from one contact to another. (Appointments of a contact can only be read.) | INFERENCE (no such path in the contacts API; the calendar and conversation descriptions were not read path by path) | contacts API paths |
| 6 | Deleting a contact is one call, and nothing in the description offers a way back. | VERIFIED that the call exists, INFERENCE that it is permanent | `DELETE /contacts/{contactId}` |
| 7 | The platform's own merge: select contacts in the Contacts list, More, Merge; or Contacts, the three-dot menu, Manage Duplicates (scans by email, phone or name; the recommended default is email). **Up to 10 contacts at once.** | VERIFIED | help article |
| 8 | Only an Agency Admin or a Sub-Account Admin can use Manage Duplicates. | VERIFIED | help article |
| 9 | What the merge combines: the kept ("master") contact keeps its name, main email and main phone, and conflicting fields use the value you pick. Tags are combined. Tasks, notes, opportunities and products are combined. Conversations are combined. Custom fields of the others fill a blank field only. **Appointments, payments, orders and invoices default to the master's values.** Active workflow executions move to the master (an execution already running there is kept). | VERIFIED | help article |
| 10 | **A merge is permanent.** "Reject" (not a duplicate) is also permanent: rejected values are left out of later scans. | VERIFIED | help article |
| 11 | A workflow action "Merge Contact" exists, and each account has "Allow Duplicate Contacts" plus primary and secondary duplicate fields (Settings, Business Profile, Contact Preferences). | VERIFIED | help article |
| 12 | What the merge does with Do Not Disturb is not written down anywhere I could read. | CHECK (test on a throwaway pair in a test account before trusting it) | help article is silent |
| 13 | There is no link that opens the merge screen or Manage Duplicates for a given contact. The app opens the contact (the white-label link helper) and tells the person where to press. | CHECK (none found; if one is published, change `crmSteps` and the button in `duplicates-parts.tsx`) | none found |
| 14 | The merge screen needs an administrator in the CRM, so a client's staff who are not administrators may not be able to finish a merge themselves. The screen says so. | INFERENCE from 8 | help article |

**What follows.** Because of 1, 4 and 5, a merge built from the public calls (fill gaps on one contact, add the tags, delete the other) would **destroy** the other record's conversation, deals and appointments and cannot copy notes. So SubSync's one-click merge is built to refuse in that case (section 3) and the real merge is done in the platform's own screen, which loses nothing. That is also why the guided layer is the product, and the one-click layer is a safe option for the day the platform publishes a real merge call.

## 2. What was built

| Layer | What it is | Writes to the CRM? |
|---|---|---|
| (a) The guided merge | One group per screen (a stepper), the best record pre-picked with the reason in words, only what differs, a merge sheet that lists what is kept, moved and removed, the warnings, "Open both in your CRM" (the record to keep first, white-label link helper `src/lib/links.ts`), "Copy the summary", then "I merged them in my CRM". | **No.** Works today with the 21 scopes already granted. |
| (b) The one-click merge | `POST /api/app/duplicates/merge` and `src/lib/ghl/crm-merge.ts`: a composed merge, behind the existing off switch (`WRITE_GHL_LIVE`, `src/lib/live-flags.ts`). | **Off.** With the switch off (the committed default, and always for the demo) it records one "WOULD WRITE crm.contact.merge" line (ids and field names only) and sends nothing. When on, it still refuses to run if the record to remove has a conversation, deals, appointments, a Do Not Disturb mark, or if the two clearly differ. |

Files: `src/lib/analytics/dedupe.ts` (grouping, now also splits a chain that ties two different people together), `src/lib/analytics/dedupe-review.ts` (all review rules, pure), `src/lib/analytics/dedupe-queries.ts` (queue read, 45-second cache, decisions, snooze, one group in detail), `src/lib/api/duplicates-routes.ts` (the endpoints), `src/lib/ghl/crm-merge.ts` (layer b), `src/app/app/views/duplicates.tsx` and `duplicates-parts.tsx` (the screen), `src/lib/demo/dupes-demo.ts` (made-up messy duplicates for the demo), `supabase/migrations/20261105100000_duplicate_snoozes.sql`.

### The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/DUPLICATES_REVIEW.md` starts with the money-first test, then reviews the current screen | DONE, that file |
| 2 | Establish from the API docs what a merge can do; two layers; no write scope added; no live write | DONE: section 1 above; layer (a) and (b) above; `docs/NEEDS_KING.md` section added by the lead (see FOR THE LEAD) |
| 3 | One group per screen, stepper, previous/next, keyboard; best record pre-picked with reason; differences only; one big primary button; Not a duplicate; Skip; undoable Not now; list grouped by likelihood with a plain reason, count per account, ranked, top 5 + See all with search, sort, paging at 100+ accounts and thousands of groups; guardrails shown before merge; never across accounts; never where people clearly differ | DONE: `duplicates.tsx`, `dedupe-review.ts`; tests in section 5 |
| 4 | Tags with the day each was added, last activity, owner, source, open deals; call and email buttons through the link helper; "Merge all the obvious ones" preview; health number in the header; share summary if cheap; group by name with counts and paginate | DONE: record cards, `Compare`, `emailPlan`, `DialButton`, obvious panel, headline, More menu "Copy a summary". The old "group by name" list is replaced by groups with their names, counts and paging. |
| 5 | Role rules: client staff and business owners see only their own account, same screen; the agency filter names accounts | DONE: server derives the account from the session; the shell's filter drawer (KF-2) names accounts; tests `tests/unit/duplicates-db.test.ts`, `tests/e2e/duplicates-merge.spec.ts` |
| 6 | Calm, lovable design; design skills run; phone thumb sized; screenshots | DONE, see section 6 |
| 7 | Tests | section 5 |
| 8 | Metrics defined; decision logged; this file | section 4 and "FOR THE LEAD" |

## 3. The guardrails (shown before a merge, in plain words)

A warning appears in the merge sheet, with one deliberate click ("I have checked this. Continue.") before the way forward is shown, for any of:

1. **Do Not Disturb**: someone in the group asked not to be contacted.
2. **A paying customer**: a record that will be removed has won deals. (SubSync does not read payments; a won deal is the closest sign.)
3. **Open deals** on a record that will be removed (they move to the kept contact; the value is shown when known).
4. **Different owners**: the records belong to different team members.

And, with no click that can override them: a merge across two client accounts does not exist (a group is always inside one account; every request is re-read from the caller's own account; another account's contact answers "not found"); and records that **clearly differ** (a different email AND a different phone) are never grouped: a chain such as A and B share an email, B and C share a phone, A and C differ on both is split, so nobody is asked to merge two people (`splitCompatible`, `clearlyDiffer`).

## 4. Metrics defined here (copy for `docs/METRICS.md`, see FOR THE LEAD)

- **Duplicate group**: two or more contacts of ONE client account that share an email (case, spaces, gmail dots and "+tags" ignored) or a phone number (last 10 digits). A group never spans two client accounts and never holds two records that clearly differ.
- **Groups to fix** (the headline): groups that are not decided and not set aside. The headline, the stepper's "Group 3 of 41", the list and the client list all use the same open list.
- **Extra contacts to remove**: records inside open groups minus one kept record per group.
- **Share of your list**: extra contacts divided by all contacts of the accounts in scope. Under 1% is written "under 1% of your list"; no share is shown when nothing is extra.
- **Best record to keep** (the pre-pick): the record with the most to lose, in this order: won deals, open deals, a conversation, a phone and an email, tags, recent activity, then the oldest. The reason lists up to three things the pick has that the others lack ("Most recent activity, has a phone and an email, 2 open deals").
- **How sure**: "Almost certainly the same person" (same email or same phone), "Very likely" (written differently), "Could be" (the name only). Not a percentage.
- **Importance** (the order of groups): open deals first, then paying customers, then a Do Not Disturb contact, then recent activity, then how sure we are.
- **Obvious group**: two or three records with the same email AND the same phone, no warning in section 3. Previewed, never merged from here.
- **Tag dates**: the day SubSync first SAW a tag on the contact (`contact_tag_events`, filled since SubSync started watching tags), not the day it was added.

## 5. Tests

Written and run (commands and results are in "Verification" below): `src/lib/__tests__/dedupe-review.test.ts` (grouping, clearly-different split, best record with ties and missing phone, reason text, warnings, differences, merge plan, obvious, ranking, paging at 150 accounts and 5,000 groups, health), `src/lib/__tests__/crm-merge.test.ts` (switched off, request order, refusal, stubbed client only), `tests/unit/duplicates-db.test.ts` (tenancy, decisions, snooze, forged requests, WOULD WRITE line, 450 groups at 150 accounts), `tests/e2e/duplicates-merge.spec.ts` (stepper, pre-pick, merge sheet, switched off, not a duplicate persists, undo, warnings, obvious preview, list paging, four roles, client tenancy, phone). Updated: `tests/unit/client-access.test.ts` (a client's staff may now decide about their own account: `POST duplicates`).

**Verification (commands run in `C:\Users\KING\wt\DUP`, 4 to 5 Nov 2026):**

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean (no output) |
| `npx eslint src tests scripts/check-api.ts scripts/check-tenancy.ts` | 0 errors; 12 warnings, none in a file of this stage (unused disable directives in other specs) |
| `node --test src/lib/__tests__/` | 860 tests, 860 pass, 0 fail (includes 16 in `dedupe-review.test.ts`, 6 in `crm-merge.test.ts`, the 9 older `dedupe.test.ts`) |
| `npx vitest run tests/unit/duplicates-db.test.ts --no-file-parallelism` | 5 passed (real database, fixture companies removed afterwards) |
| `npx vitest run tests/unit/client-access.test.ts tests/unit/tenant-tables.test.ts tests/unit/access-roles.test.ts tests/unit/route-registry.test.ts tests/unit/data-inventory.test.ts` | 35 passed, 1 failed. The failure is in `data-inventory.test.ts` (live database against the migration files): the live `cached_contacts` has a column `first_seen_at` that comes from another stage's migration which is not in this worktree. Not from this stage: the table list (which includes `duplicate_snoozes`) matches. It resolves when the branches are merged. |
| `TURBOPACK_ROOT=C:/Users/KING TEST_PORT=3123 TEST_DIST_DIR=.next-dup-t CHECKS=check-tenancy node scripts/with-dev-server.mjs` | "tenant isolation: two agencies, 544 cross-reads as agency, business, client and forged sessions, attacks refused ... nothing changed: ok". The run includes the five new duplicate read addresses and three forged writes (decide, set aside, merge) on the other agency's contacts. The first run FAILED on one real finding (below) before it was fixed. Fixtures removed (checked). |
| `PW_BASE_URL=http://localhost:3121 npx playwright test tests/e2e/duplicates-merge.spec.ts --project=desktop-1440`, in pieces because each demo call takes about 10 seconds | all 15 tests pass at 1440: the four roles, stepper, merge sheet and switched-off merge, "I merged them" and Undo, Not a duplicate (after a reload) and Undo, Not now and Undo, the warning click, the obvious preview, list paging and search, one client at a time, client tenancy, client decisions. The four role tests also pass at **tablet-768 and phone-390** (no sideways scroll; Merge and both arrows at least 44 px high at 390). |

Findings while testing (all fixed, none hidden):
1. **Tenancy echo (found by `check-tenancy`).** The answer echoed the `location` the caller asked for, even when it belonged to another company, which the sweep counts as a leak (it is only an echo, but a request must never make an answer name another company's account). Now echoed only when it is one of the caller's own accounts.
2. A bulk insert in my own test fixture ignored `dnd` because the first row did not name it (postgres.js takes the columns from the first row); the test now names every column.
3. `?as=location` opened with an address hash showed all accounts: that is the shell's rule (it narrows to the account only when opened without a hash, so a deep link shows everything); the spec now opens the app, then the menu entry, like a real person.
4. The old `scripts/check-api.ts` duplicates section tested the old answer; rewritten for the new one. **Not run** (it needs the whole integration chain and writes to the demo); it type-checks and lints.

## 6. Design skills run

Run on the finished screens (screenshots `docs/review/duplicates-*.png`). What each changed:

- **design:design-critique.** Found: the primary button sat below the first screen at 1440 x 900 (under the differences table and a footnote), so "one big primary action" was not on the first screen; the link "Open" was ambiguous; a team member whose name SubSync does not know showed as a raw id ("user-e5f0"); on a phone the second line of an "Up next" row was cut off before the warning; the tag-date footnote appeared even when no tag differed. Changed: the Merge block now sits directly under the "Best match picked" line and the differences come after it; "Open contact"; unknown owners read "Team member e5f0" (two different owners never look the same); row notes wrap to two lines; the tag note shows only when tags differ or have dates. Kept (worked): one calm column, the headline as the biggest thing, the pre-picked record with its reason, plain status words with no pills or tinted boxes.
- **design:accessibility-review (WCAG 2.1 AA).** Found: single-letter shortcuts (M, N, S) were active anywhere on the page (2.1.4 Character Key Shortcuts); after a decision, focus was lost with the pressed button; the A / B letters in the differences were hidden from a screen reader on desktop, so a row read without saying which record; the undo message vanished after 12 seconds. Changed: M, N and S act only while focus is inside the group on screen (the arrows stay global, and never act inside a box, a menu or a radio); focus moves to "Group n of N" after a decision; the letters are read aloud on desktop and visible on a phone; the message stays 20 seconds and Undo is also in Show, Done. Checked: radios and arrows have names, "Group n of N" is a live region, the warning is announced (role alert), the merge sheet takes focus on open, every phone button is at least 44 px (tested), no sideways scroll (tested), colours are the app's own tokens (the warning words use the existing warning token).
- **design:ux-copy.** Changed: "Merge here (switched off)" to "Merge from here (not on yet)"; "Merge into the kept one" to "Merge in and remove" (it says what happens); the toast after "I merged them" to "Marked as merged. It leaves the list after SubSync next refreshes from your CRM." Kept: "Merge these 2 contacts", "Not a duplicate", "Not now", "Skip", the reasons ("Same email and phone number", "Almost certainly the same person"), warnings as one sentence each. No platform name in any text (tested on every role).
- **Dataviz palette check:** not applicable, the screen has no chart (the numbers are words and counts).

### Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| The pick comes with its reason in words, so nobody has to compare eight fields | P2 ops person, P3 setter | the line under the two records |
| Undo on every decision (toast, and under Show, Done) and "Not now" for 7 days instead of a permanent choice | P2, P4 | toast, Done list |
| "Copy the summary" of a merge (who to keep, what moves, the three steps in the CRM) to paste to a colleague | P1 agency owner, P5 | merge sheet |
| "Copy a summary" of the whole list (groups, extra contacts, share, top clients) | P1, P5 | More menu |
| Clients with the most at stake first, searchable and paged, one tap to review only that client (the client is named in the filter note) | P1 | Clients with duplicates |
| A one-line "Stop new duplicates" with the exact CRM setting path, shown only for accounts that allow duplicates | P2, P4 | bottom of the page |
| A dismissible two-line how-to; keys for the keyboard | P2 | top of the page |

Proposals (not built; for `docs/PROPOSALS.md`): see FOR THE LEAD.

## 7. King's 5 checks (plain words)

1. Open Duplicates in the demo as the agency: the headline says how many groups, how many extra contacts and about what share of the list. Press Merge these 2 contacts: you see what is kept, moved and removed, then "Open both in your CRM". Press "I merged them" and watch the number go down by one; press Undo.
2. Press Not a duplicate on a group, reload the page: it stays gone. Find it under All groups, Show, Done, and undo it.
3. Find a group marked "Check before merging" (a Do Not Disturb contact, a customer, deals or two owners): the merge sheet makes you click "I have checked this" before the next step.
4. Open the same page as a client's staff (`?as=client`) and as a business owner: same screen, only that one account, no list of other clients.
5. On your phone: the group, the big Merge button and the arrows are easy to hit and nothing scrolls sideways.

## 8. NOT verified

- **Nothing here was tested against a real CRM account.** The real merge screen, "Open both in your CRM" landing on the right contact, and a real merge's effect on Do Not Disturb were not tried (CHECK items 12 and 13).
- The composed merge (layer b) was only run against a stubbed client. It has never touched the platform.
- The 45-second cache and the 60,000 row cap were exercised on the demo and on fixtures (450 groups at 150 accounts), not on a real agency with 100 accounts and 50,000 contacts per account. The candidate read of a very large real account is UNSURE (it ran in the time of the other pages on the demo).
- Tag dates exist only for tags SubSync saw change after it started watching; older tags show no date.
- The shell's account filter changes which accounts the review covers (it is the one used by the other pages); it was checked on the demo only through the API.

## FOR THE LEAD

**Log entry (OVERNIGHT_LOG style).** Stage DUP: duplicate contacts rebuilt as a guided review. BUILT, awaiting King's checks. Decisions for King: merging from SubSync recommended NO (`docs/NEEDS_KING.md` section 28); a client's staff may now decide about their own account (DECIDED FOR KING, reversible with one line in `src/lib/access.ts`). UNSURE: the real candidate read on an agency with 100 accounts and 50,000 contacts per account; what the platform's merge does with Do Not Disturb. NOT VERIFIED LIVE: everything about the real CRM (the deep links land on the right contacts, the merge screen steps).

**Migration.** `supabase/migrations/20261105100000_duplicate_snoozes.sql`: one NEW table `duplicate_snoozes` with an index and row level security on (no policy, like its siblings). **Additive: yes. Idempotent: yes (`if not exists`). Nothing dropped, renamed or tightened. Already APPLIED to the live database** with `scripts/apply-migration.ts` (new table, nothing to back up; checked 0 rows afterwards). The old code never reads it. Classified in `src/lib/tenant-tables.ts` (purged with the account's data and on uninstall), `src/lib/data-inventory.ts` and `docs/TENANCY.md`.

**Shared logs.** The task asked for entries, so I appended (end of file only) to `docs/NEEDS_KING.md` (new section 28: renumber if another stage also took 28), `docs/DECISIONS.md`, `docs/METRICS.md` and `docs/TENANCY.md`. I did not touch `docs/PROGRESS.md`, `docs/FEATURE_STATUS.md`, `docs/NOTES_COVERAGE.md` or `docs/PROPOSALS.md`.

**Coverage updates.** None: no note id in `docs/NOTES_COVERAGE.md` is about duplicates; this stage answers King's chat instruction of 4 Nov.

**Proposals.**
1. *Merge Contact workflow recipe* (P1, P2): the platform has a workflow action "Merge Contact" that needs no new permission. After a person has merged a few groups by hand, SubSync could show a one-time recipe (a workflow that merges exact matches as they arrive), written as steps for them to build. Effort: small (text). Risk: none (SubSync writes nothing).
2. *Duplicates in the Instant Audit* (P1): "41 duplicates are inflating your lead count by about 2%" as one audit line. Effort: small (the number already exists). Risk: low.
3. *Name and company matching* (P2): only if the company name is later copied into SubSync. Effort: medium. Risk: noisy matches.
4. *A real merge call*, if the platform ever publishes one: build the one-click merge on it, keep the four warnings. Effort: small (the executor exists). Risk: depends on the call.

**Files likely to conflict at merge:** `src/lib/api/router.ts` (one new dispatch block near the top of `handle`, the old `duplicates` function removed, one line in `duplicateBulk`); `src/lib/access.ts` (one entry in `CLIENT_RULES`); `src/lib/demo/seed.ts` (one import, one line in `ensureDemo`); `src/lib/tenant-tables.ts` and `src/lib/data-inventory.ts` (one name each); `tests/unit/client-access.test.ts` (one word); `scripts/check-api.ts` (the duplicates section) and `scripts/check-tenancy.ts` (additions); the four appended docs. Not touched: `src/app/app/nav.ts`, the sidebar, `dashboard.tsx`, `ui.tsx`, `globals.css`, scopes, the marketplace app.

**Local-only change not committed:** `next.config.ts` has a `turbopack.root` line that was needed to run the dev server from a worktree whose `node_modules` is a junction; it is marked skip-worktree and was reverted before the last commit.
