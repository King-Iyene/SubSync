# People: search, call lists and the lead panel (stage PEOPLE)

Status: **BUILT, awaiting King's checks** (4 to 5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\PEOPLE`, branch `stage/people`). Not marked passed. The money-first test and the review of the old screen are in `docs/PEOPLE_REVIEW.md`.

## What was built

One page for two jobs: **find a person** and **call the people who need it most**.

1. **A search box first** (name, phone or email, across every client account the person may see; part of a name or email or the last digits of a phone is enough). Server side, 50 a page, the count exact up to 10,000 then "10,000+". Recent searches (kept on the server for that person, cleared with one press). Filters are behind one "Filters" button; a filter result can be saved as a list and shows as a chip.
2. **One sentence and one button**: "48 new leads are waiting for a reply. Also: 8 no-shows, 188 hot leads, 43 stale deals." and "Start with James Walker" (opens the person, then the arrows go down the list).
3. **Five ready-made lists** as plain tabs with counts: Waiting (Speed to lead's list), No-shows (Appointments), Follow-ups (the call list), Hot (the call list) and Stale (Today's deals). They are NOT new definitions: each is read through the function its own page uses, and the count on a tab equals its rows (tested live on the demo against Speed's and Appointments' own numbers). A client's staff get the same five lists, cut to their own account on the server, starting on "Mine" when anything is assigned to them.
4. **Rows (KF-8)**: one line of name, one line of reason ("Never answered, waiting 3 h · Google Search · Owner Priya Shah"), ONE small Call button in its own column (44 px on a phone) and a three-dot menu (Show, Call, Email, Open in your CRM, Copy details). "Do not disturb" is written on the row; pressing Call or Email on such a person stops with a warning first ("Do not call" is focused, "Call anyway" is a second, deliberate press). Call and Email open the CRM through the white-label link helper (the CRM has no link straight to its dialer or mail box, said once per page: "Not available from your CRM yet..."); never `tel:` unless the person chose "My own phone app"; SubSync sends nothing.
5. **The lead panel** (`ds/lead-drawer.tsx`, shared by every page): the headline (one sentence about the person and the one next step: "Never answered. Waiting 14 days. Call now, or reply in your CRM."), Call and Email, the facts, **tags with the day SubSync first saw each** (and the honest note: the CRM does not say when a tag was added), open deals, custom fields (live), "Log how the call went" (SubSync's own record; then the next person opens), "Write a note to paste into your CRM" (copied only; nothing saved or sent), and a **timeline** grouped by day: messages and calls from the CRM (when, which way, which channel; never the words), the first reply, appointments and their status changes, deal moves, tag changes, calls logged in SubSync. "What changed since you last looked" per person. Previous and next arrows; `j`/`k` or the left and right arrows too; the panel traps focus and gives it back.
6. **Header search** (Ctrl K): arrows and Enter, a Call button on each result, recent searches and recently opened when the box is empty.
7. **Other tabs**: Tags (a tag's people and a clickable per-day chart), Going cold, Sources: same rows, same panel.
8. **The panel opens from every list and chart mark**: Today's and the audit's records panel, Speed, Appointments, Unanswered messages, Duplicates (new: each record has "Show"), People, the header search. All use `ds/lead-drawer.tsx`.

Files: `src/lib/people/person.ts` (headline, timeline, since-you-looked, notes), `queue.ts` (lists, search term, recents), `rows.ts` (row words, matching, Mine), `types.ts`; `src/lib/analytics/people-queue-queries.ts`, `people-person-queries.ts`, `people-recent-queries.ts`; `src/lib/api/people-queue-routes.ts`; UI `src/app/app/views/people-module.tsx`, `people-find.tsx`, `people-rows.tsx`, `people-more.tsx`, `people-filters.tsx`, `global-search.tsx`, `ds/lead-drawer.tsx`, `lead-parts.tsx`, `contact-actions.tsx`. Changed: `people-list-queries.ts` (capped count, phone digits only for phone-like words), `people-routes.ts`, `helpers.ts` (messages), `ghl-data.ts` (one read for calls and messages), `access.ts`, `router.ts`, `duplicates-parts.tsx`.

## The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/PEOPLE_REVIEW.md` starts with the money-first test, then the old screen for four roles at three widths with real screenshots | DONE: that file; `docs/review/people-old-*.png` |
| 2a | Fast search across the caller's accounts, server side, paged, scales to 100+ accounts and 20,000+ contacts, never sends everything | DONE: `searchPeople` (page of 50, capped count); DB test "150 accounts" and "one account of 20,000 contacts" |
| 2b | Ready-made call lists reusing the existing definitions, plus saved custom filters | DONE: `people-queue-queries.ts`; METRICS "People, call lists"; the chip equals the rows (DB test and e2e); saved filters are chips |
| 2c | The person panel: headline, tags with the day (honest note), timeline from the event store, open deals, owner, source, DND warning, Call/Email via the CRM links, Open in your CRM, copy, previous/next | DONE: `lead-drawer.tsx`, `people-person-queries.ts`; e2e "Start with the first person...", "tags show the day...", "a person who asked not to be contacted..." |
| 2d | The panel opens from every list and chart mark; fix any page that does not | DONE: audited all uses of the shared panel; Duplicates did not use it, now does ("Show"); e2e "the duplicate review opens the same lead panel" |
| 2e | Client staff only their own account (server side); setters see their own queue by default | DONE: `startOnMine`, `allowed`; DB tests with forged `location`, `account`, `accounts`; e2e "a client's staff only ever read their own account" |
| 2f | Customer expectations: what changed since I last looked, recent searches, a note to self (no CRM writes), keyboard navigation | DONE: all four (see Customer-eyes) |
| 2g | KF-1, KF-8, KF-9, KF-10 | DONE: no badges or dots (unit test), one small button column, one page of 25 whatever the accounts, one primary action |
| 3 | Design skills run on the finished screens; screenshots `docs/review/people-<role>-<390/768/1440>.png` | DONE: below |
| 4 | Tests | below |

## Design skills run

- **design:design-critique.** Found: at 768 the five tabs wrapped and left "Stale deals" alone on a second line; "1 stale deals" was wrong grammar in the sentence under the headline; the line under the search box wrapped to two lines; the panel showed the reason for the list ("Never answered, waiting 14 days") AND the headline that says the same, and a loading block sat between the name and the buttons so everything jumped when the person arrived. Changed: shorter tab words (Waiting, No-shows, Follow-ups, Hot, Stale) with the long label in the help line under them; proper singular and plural in "Also"; a one-line search hint; the list's reason is shown only until the headline arrives (`pending`), and the loading block sits under the buttons. What works and was kept: search first, one sentence, one button, one small button a row.
- **design:accessibility-review (WCAG 2.1 AA).** Found: the header search's `aria-controls` pointed at an element that was not there; the count of results changed silently; the Call button in a header search result is not in the tab order (4.1.2/2.1.1 risk). Changed: `aria-controls` only when the list exists; the count is a polite live region. Kept on purpose: the header search's Call button is reached through Enter, which opens the panel where Call and Email are in the tab order (so every action is still keyboard reachable). Already right: names that start with the visible text ("Call James Walker, in your CRM"), the panel traps focus and returns it, keys only act while the panel or list has focus (2.1.4), the stop warning is text and a rule, not colour alone, targets are 44 px on a phone (tested).
- **design:ux-copy.** Reviewed: the sentence, list helps, empty states, the Call note, warnings, log text, note text. Kept: "Start with James Walker", "Nobody needs a call right now.", "Do not call" / "Call anyway", "Log how the call went", "SubSync does not save this or send it anywhere." Each empty state says what to do next ("Choose Everyone to see the rest", "Check the spelling, try part of the email or the last digits of the phone number, or clear a filter").
- **dataviz:** the only chart is the existing per-day tag bar chart; unchanged.

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| "Start with James Walker": one button to the most urgent person, then the arrows | P3 setter | top of People |
| Why each person is on a list, in words, and who owns them | P3, P2 | every row |
| Warning before calling or emailing someone who asked not to be contacted | P3, P4 | rows, panel, header search |
| "What changed since you last looked" per person | P2, P3 | panel |
| Recent searches and recently opened people, kept for the person alone and clearable | P2, P3 | search box, bottom of People |
| Log how a call went, then the next person opens | P3 | panel |
| A note to paste into the CRM (copied, not saved) | P3, P4 | panel |
| Copy details, copy this page of a list | P2, P5 | row menu, list footer |
| A client's staff start on their own queue when something is assigned to them, else everyone with a line that says why | P3 | lists |
| Keys: `j`/`k` in a list, arrows in the panel and the header search | P2 | everywhere |

Proposals (not built): see FOR THE LEAD.

## King's 5 checks

1. Open People as the agency: a search box, one sentence ("N new leads are waiting for a reply"), a button "Start with ...", five tabs with numbers. Press the button: the person opens with one sentence about them and Call and Email. Press the right arrow: the next person.
2. Compare the numbers: the Waiting number is the same as Speed to lead's "waiting" number, No-shows the same as Appointments' no-shows to rebook, Stale the same as Today's stale deals.
3. Type three letters of a name in the search box: people from any client appear; press a name. Open the panel on a person with tags: each tag shows "added <day>" if SubSync saw it added, and a note says the CRM does not say when.
4. Find a person marked "Do not disturb" and press Call: you get a stop first with "Do not call" ready.
5. Open People as a client's staff (`?as=client`) and as a business owner: same page, only that one account, no account names. On your phone: the Call button and the arrows are easy to hit and nothing scrolls sideways.

## Tests

See "Verification" below (commands and real results).

## Verification (commands run in `C:\Users\KING\wt\PEOPLE`, 4 to 5 Nov 2026, dev server on port 3161)

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint src tests` | 0 errors, 10 warnings (all were there before: unused disable directives and unused imports in files of other stages) |
| `node --test src/lib/__tests__/` | 944 tests, 944 pass, 0 fail (includes 30 in `people-v2.test.ts` and the 23 older ones in `people-f10.test.ts`) |
| `vitest run` on `people-v2-db`, `people-lists-db`, `call-lists-db`, `client-access`, `route-registry`, `tenant-tables`, `access-roles` with `--no-file-parallelism` | 7 files, 58 tests pass. The new file's 11 tests include the 150-account test (one page of 25, 40 waiting, no person twice, bounded time) and the one-account-of-20,000-contacts test (search answers one page, the count stops at 10,000). Fixture companies removed afterwards. The first run found a real bug (an email containing digits was also searched in phone numbers: 12 matches instead of 1); fixed in `people-list-queries.ts` and `rows.ts`, with a unit test |
| `PW_BASE_URL=http://localhost:3161 npx playwright test tests/e2e/people-v2.spec.ts --project=desktop-1440` | all 13 non-role tests and the 4 role tests pass (in three runs: some failed once on a loaded machine with a 120 s wait on the first read and passed alone; three test bugs were fixed: Ctrl K pressed before the page was ready, an agency-only address used for a client, and a reload that raced the "opened" write). Covers: four roles; chips equal rows and equal Speed's and Appointments' own numbers; panel; tags with a day; do-not-disturb stop; log a call moves on; search; recent; since you last looked; note only copied; client tenancy; header search; duplicates open the panel |
| same file, `--project=phone-390 -g "search first\|the phone"` | 5 pass (four roles, and the phone test: nothing sideways on any tab or in the panel, every target 44 px) |
| same file, `--project=tablet-768 -g "search first"` | 4 pass |
| `playwright test tests/e2e/f10.spec.ts tests/e2e/menu.spec.ts --project=desktop-1440` | pass (f10 rewritten for the new tabs; three steps needed a longer wait on this machine: the going-cold chart's own endpoint took over 45 s) |
| `playwright test tests/e2e/d0.spec.ts -g "style guide's list, lead panel\|a chart is clickable"` | 2 pass (the shared panel and the clickable charts still work) |

Updated old tests: `tests/e2e/f1.spec.ts` (tab "Sources"), `freshness.spec.ts` and `menu.spec.ts` (tab names), `f10.spec.ts` (rewritten for the new tabs and the new panel words).

### Findings while testing (all fixed or recorded)
1. A lead can be counted by Speed to lead before its contact has been copied (demo: 1 of 48). The first build dropped such a row, so the chip said 48 and the pages showed 47. Now the row is kept from what Speed knew, and the panel says "SubSync has not copied this contact yet".
2. The search answer echoed the choices it was asked for, including a `location` of another company (the tenancy echo `check-tenancy` counts as a leak). Removed.
3. `people/home` took 17 to 35 s on this machine under load (several large reads, 190 ms from the database). Speed's list is now kept 45 s and its first page is read beside the counts; warm calls are under a second. NOT measured on the hosted app.

## NOT verified
- **Nothing was tried against a real CRM account.** The CRM's live message and call shape (`fetchConversationActivity`, read defensively), the CRM links landing on the right contact, and that the CRM has no dialer or mail box link, are unchanged from earlier stages (CHECK).
- `scripts/check-tenancy.ts` and the integration chain were NOT run (forbidden in parallel mode); the new read addresses and two forged writes are appended to it, and the one echo it would have caught was fixed by reasoning. The lead must run it alone.
- Real scale: the 150-account and 20,000-contact figures are from fixtures; a real agency of 100 accounts with 50,000 contacts each (a search of two letters scans trigram indexes over millions of rows) was not tried. The database stops a read after 8 s and the screen says so.
- Tag days exist only for tags SubSync saw change after it started watching.
- `tests/e2e/f1.spec.ts` (tab renamed to Sources) and `freshness.spec.ts` (tab names) were edited but not re-run; `scripts/check-api.ts` was not touched or run.
- Screenshots exist at the three widths for the four roles (`docs/review/people-<role>-<width>.png`, `people-panel-<role>-<width>.png`); the 1440 set was taken before the last wording fix (the subtitle for a single account).

## FOR THE LEAD

**Log entry.** Stage PEOPLE: People rebuilt (search, five ready-made call lists, the lead panel with headline, tags with the day, timeline, since-you-looked, recent searches). BUILT, awaiting King's checks. Decisions for King: a client's staff get the call lists and may log a call on their own account (`PEOPLE_DAILY_RULES` in `src/lib/access.ts`, reversible); the power hour timer and tiles are gone; recent searches are kept server side per person. UNSURE: real-account speed of `people/home`; the live shape of CRM messages. NOT VERIFIED LIVE: messages and calls from the CRM in the timeline.

**Migrations.** None. No table, column or index was added (recent searches use a new kind of row in the existing `saved_views`, page `people-recent`).

**Shared logs.** I appended (end of file only) to `docs/METRICS.md` ("People, call lists and the lead panel"), `docs/DECISIONS.md` and `docs/TENANCY.md`. I did not touch `OVERNIGHT_LOG`, `NEEDS_KING`, `NOTES_COVERAGE`, `PROGRESS`, `FEATURE_STATUS`, `PROPOSALS`.

**Coverage updates.** None required; N20, N35, N49, N50, N53 and N54 are answered by this stage, for the lead to mark with `node scripts/notes-coverage.mjs set <ID> DONE-TONIGHT "..."` after King's checks.

**Proposals.**
1. A streak ("5 done today") after logging calls (P3). Effort small, risk none.
2. Team lists: a manager hands a list to one setter by name (P1, P5). Needs the Users API; effort medium.
3. The CRM's call history for every row (P3): one read per conversation; only worth it if the CRM adds a bulk call read.
4. Push a list to the CRM by tag (N20): still not built (needs a write scope).
5. Unify the three row-action implementations (Speed's `useLeadActions`, Appointments', and `ds/contact-actions.tsx`): a small refactor after merge.

**Files likely to conflict at merge:** `src/lib/api/router.ts` (one added line in the people helpers), `src/lib/access.ts` (a new constant and two spread entries), `src/app/app/ds/index.ts` (one export line), `src/app/app/ds/lead-drawer.tsx` (rewritten: if another stage touched it, take this one and re-add), `src/app/app/views/duplicates-parts.tsx` and `duplicates.tsx` (a "Show" button and one prop), `tests/e2e/f10.spec.ts`, `freshness.spec.ts`, `menu.spec.ts`, `f1.spec.ts`, `scripts/check-tenancy.ts` (two blocks), and `docs/METRICS.md`, `DECISIONS.md`, `TENANCY.md` (appended at the end).

**Local-only change not committed:** `next.config.ts` has a `turbopack.root` line needed to run the dev server from a worktree whose `node_modules` is a junction; it is marked skip-worktree.
