# Speed to lead: rebuilt as a queue (stage SPEED)

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\SPEED`, branch `stage/speed`). Not marked passed. The money-first test and the review of the old screen are in `docs/SPEED_REVIEW.md`.

## What was built

One question: **"who is waiting for a first reply, and what do I do first?"** Top to bottom, for every role:

1. A slim header (title, one line that says SubSync measures and never sends, a "More" menu: copy a summary, print, change the default target, how to use this page).
2. **One sentence** ("49 leads are waiting for a reply across 12 clients. 42 of them were never answered.") and **one button** ("Reply to the oldest waiting lead", opens the lead in the CRM through the white-label link). Under it one line of proof: the typical first reply for the range, and the labelled cost estimate with its formula one tap away.
3. **Reply now**: five rows (KF-8: one small Reply button, 44 px on a phone, and a quiet three-dot menu: Show this lead, Call in your CRM, Email in your CRM, Copy details). "See all N" opens the whole list in place: searched, sorted, filtered ("No owner", "Mine") and paged **on the server**, 25 a page, so 6 or 150 clients cost the same. A lead nobody owns says who usually replies fastest in that client (a display, nothing is assigned).
4. **How fast replies come**: one range with a comparison (previous period, same dates last month), the typical first reply, the share answered in time (a percentage only from 5 leads, "n of 5 so far" below that), "298 leads: 58 in time, 183 late, 57 not answered" where each number opens its leads, one line about leads that only got an automatic message, a clickable weekly bar chart (only when the range holds two or more weeks).
5. **Who is slow**: clients (agency, more than one client) and people (agency and business owner; never a client's staff, hidden by the server). Top 5 and "See all N" (searched and paged on the server). A client with fewer than 5 leads, or a person with fewer than 3 replies, is listed after the ranked ones with "n of 5 so far". Each client has its own reply target, typed inline ("You type this number. SubSync does not read it from your CRM.").
6. **More detail** (closed): the "Where leads come from" table with its own range. Then the measuring note at the bottom.
7. **All clear**: "Nobody is waiting for a reply right now." plus the next best step (the slowest client under 50% in time, many leads with no source, a slow typical reply, else check Appointments).

Files: `src/lib/analytics/speed-v2.ts` (pure: selection, order, paging, sentences, ranking, suggestion, estimate), `speed-v2-queries.ts` (home, list, compare, set one target), `src/lib/api/speed-routes.ts` (`GET /api/app/speed?part=home|list|compare`, `PUT /api/app/speed/target`), `src/app/app/views/speed.tsx`, `speed-rows.tsx`, `speed-all.tsx`, `speed-picture.tsx`, `supabase/migrations/20261105110000_speed_account_target.sql`. Changed: `speed-intel.ts` (`judge` honours an account's own target, nothing else), `speed-queries.ts` (`loadRows` also reads phone, email, do-not-disturb and time zone and orders newest first; `loadTargets`), `speed-parts.ts`, `access.ts` (one rule: a business owner may `PUT speed/target`), `router.ts` (one dispatch block). The old answers (`speed`, `speed?part=summary|source|accounts|people`) are kept for Today, the alerts and the source table; `speed-cards.tsx` keeps `PersonName`, the lead columns and the source card.

### The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/SPEED_REVIEW.md` starts with the money test, then reviews the screen for four roles at three widths with screenshots; numbers agree with Today; differences defined in METRICS | DONE: `docs/SPEED_REVIEW.md`, `docs/review/speed-old-*.png`, `docs/METRICS.md` "Speed to lead, second pass"; agreement tested in `speed-v2.test.ts` ("Today and Speed agree") and `speed-v2.spec.ts` ("the same people as Today", live on the demo for agency, business, client) |
| 2a | One headline sentence, one primary action | DONE: `speed.tsx` (HeadlineBlock + PrimaryButton), e2e role tests |
| 2b | Short Reply now list (5 inline), See all with search, sort, filter, paging, server paged, scales to 100+ | DONE: `speed-all.tsx`, `speedList`; `speed-v2.test.ts` "150 client accounts"; `speed-v2-db.test.ts`; e2e "See all opens the whole list" |
| 2c | Response-time picture: median, answered within target with a plain explanation, per-person / per-account comparison, trend vs previous with minimum-sample rules, no tiny-base percentages | DONE: `speed-picture.tsx`, `pctOf`, `shareChange`; tests "a tiny base never gets a percentage", "comparing accounts", "comparing people" |
| 2d | Every chart mark clickable, opening exactly its own leads, count equals rows (KF-6) | DONE: one selection `selectLeads`; unit tests; e2e "a figure opens exactly its own leads" and "every figure's count equals the rows of its list" |
| 2e | Lead panel with tags + day added, timeline, DND warning before dialing, quiet hours | DONE by the shared `LeadDrawer` (tags with the day SubSync first saw them, timeline) and `dialWarnings` (do-not-disturb, calling hours) in the row menu (`speed-rows.tsx`); unit coverage in the F10 tests; e2e checks the drawer opens. NOT run against a real contact with a tag history |
| 2f | Per-account reply target editable inline with a plain note that the user types it | DONE: `TargetEditor`, `setAccountTarget`, migration; e2e "a reply target is typed by a person"; DB test (skipped until the update has run) |
| 2g | Setter ranking visible to agency/owner, client staff see their own queue, tenancy server-side | DONE: `seePeople` in `speed-routes.ts`; e2e "only ever read their own account" |
| 2h | Missing things: who should reply (display only), cost estimate labelled with formula, copy/print summary, calm all-clear with next best action | DONE: `suggestReplier`, `costEstimate`/`costLine`/`costFormula`, `summaryText`, `nextBestAction` (all unit tested) |
| 2i | KF-1 (no pills, no tinted banners), KF-8 (compact aligned rows, one button column, row menu), KF-9 (scale), KF-10 (calm) | DONE: see "Design skills run"; screenshots |
| 3 | Design skills run on the finished screens; screenshots `docs/review/speed-<role>-<390|768|1440>.png` | DONE: below |
| 4 | Tests | below |

## Design skills run

- **design:design-critique.** Found: on a phone the "Who is slow" rows were four lines tall (name, typical, share, leads and target each on their own line), so five clients filled the screen; the dollar figure, the reason to care, sat in the same grey as the rest of the proof line; "See all" sat top right on Reply now but under the list on Who is slow; three places said SubSync never sends a reply (subtitle, how-to, footer). Changed: the client rows put share, leads and target on one wrapping line under the name (a `contents` grid on desktop), the estimate is medium-weight foreground text, See all is right-aligned on both. Kept: the headline as the biggest thing, one filled button, rows of one line of title and one of reason, plain status words with a warning icon only for "Never answered", no pills and no tinted boxes. The measuring line stays in the subtitle (trust, N78) and the footer (the exact rule); the how-to is dismissible. NOT changed: the shared bar chart draws its top axis tick over its own caption (visible in the screenshots); it is the shared component, so it is left for the lead.
- **design:accessibility-review (WCAG 2.1 AA).** Found: the three breakdown buttons said "58 answered in time" in their name while showing "58 in time" (2.5.3 Label in Name), and the people buttons put the name first; the Compare switch used `role="tab"` without panels or arrow keys (4.1.2 over-promises); a list opened from a number did not move focus (2.4.3) and the changing count was silent; the name button in a row was only about 24 px high. Changed: names now start with the visible text ("58 in time, open the list", "63 replies, Dana Brooks, open the list"); the switch is a group of toggle buttons (`aria-pressed`); an opened list takes focus to its heading and Back puts focus on "See all" (or the first section heading); the list's range line is a polite live region; the name button is at least 24 px and the row is at least 56. Checked, no change needed: every control is a real button or link; the Reply link says it opens a new tab; the target input has a label and an error with `role="alert"`; a status is always a word (never colour alone); the call warning is an `alertdialog` that focuses "Do not call"; one h1, h2 in order; colours are the app's own tokens used by Today's reviewed screen; thumb targets (Reply, menu, primary) are at least 44 px at 390 (tested).
- **design:ux-copy.** Changed: "No new leads to time yet" to "No new leads yet"; the permission note agrees in number ("1 of 13 accounts has not approved"); the left-out clause of the estimate says why ("1 client is left out because it has fewer than 20 closed deals"). Kept: "Reply to the oldest waiting lead", "Reply now", "Who is slow", "How this is worked out", "Show them", "Needs permission: reconnect" (the existing wording the tests and Today use), the target note ("You type this number. SubSync does not read it from your CRM."), no platform name and no jargon (tested on every role).
- **dataviz.** The weekly share is one series over time, so a bar chart is the right form (not a donut, not a gauge); one axis labelled "% of leads"; each bar carries its number; the bar colour is the status colour of the share (good from 80%, warning from 50%, else bad), which is status, not identity, and the number is always printed, so colour is not the only carrier; the empty week is a dashed placeholder, not a zero bar; below 5 leads in a week the bar is absent and the note says why. There is no categorical palette, so the validator was not run. The shared chart's top tick overlaps its caption (see above).

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| A setter sees the lead that has waited longest as the page's one button and the first row, with "Reply" in one tap | P3 setter | headline, Reply now |
| Call and Email in the row menu, with a warning before calling someone who asked not to be contacted or outside calling hours | P3, P4 | row menu |
| "No owner. Priya Shah usually replies fastest here" so an owner knows who to give the lead to | P1, P4 | row |
| "Mine" and "No owner" chips in the full list | P3 | See all |
| The cost estimate in dollars, labelled, with the formula one tap away | P1 agency owner, P4 | proof line |
| A copyable and printable summary for a client review | P1, P5 | More menu |
| A reply target for each client, typed inline | P1, P2 | Who is slow |
| An all-clear that says what to do next instead of an empty page | all | headline |
| The ranking of people hidden from a client's staff | P3, P4 | server |

Proposals (bigger, not built): see "FOR THE LEAD".

## Tests

Written and run, with the commands and results in "Verification". `src/lib/__tests__/speed-v2.test.ts` (18 tests: targets, one selection feeding figure and list with ties and unanswered leads, stable order, per-account targets, the automatic-touch setting, filters and search, paging, the headline, Today agreement through Today's own `mergeReplies` and `countsOf`, tiny samples, ranking of clients and people, who should reply, the estimate, next best step, sentences, a 150-account scale test), `tests/unit/speed-v2-db.test.ts` (database: two fixture companies), `tests/e2e/speed-v2.spec.ts` (four roles, See all, figure to list counts, Today agreement, tenancy, target, call and email menu, range in the address), `tests/e2e/speed-capture.spec.ts` (screenshots). Updated: `tests/unit/speed-ui.test.ts` (the page, the source card and the new files), `tests/e2e/speed.spec.ts` (the old browser tests moved to the new spec).

## King's 5 checks (plain words)

1. Open Speed to lead as the agency. The first thing is one sentence ("49 leads are waiting...") and one button. Press the button: the top lead opens in your CRM. Press "See all 49": the list opens with the same number; search a name; go to page 2; press Back to Reply now.
2. In a row press the three dots: Call in your CRM and Email in your CRM open the contact in your CRM (they never open your phone and never send anything). Try it on a contact marked do not disturb: a warning comes first.
3. Under How fast replies come press "57 not answered": the list has 57 leads. Press a bar of the weekly chart: its list has the number on the bar. Choose "Last 7 days" and "Previous period": the sentence names the dates.
4. Under Who is slow press Change next to a client, type 30, Save. That client's leads are now judged against 30 minutes (this needs the database update that comes with the merge; until then the screen says so in words). Press "Use the default".
5. Open the same page as a client's staff (`?as=client`) and as a business owner: one account, no "Who is slow" for the client's staff, and on your phone nothing scrolls sideways and the buttons are easy to hit.

## NOT verified

- **Nothing here was tested against a real CRM account.** The Reply, Call and Email links open the contact through the white-label link; whether they land on the right contact in a real white-label domain, and whether a real contact has tags with dates, was not tried. The CRM has no link that opens its own dialer or mail box (F10, CHECK), so Call and Email open the contact and the menu says so.
- The cost estimate on a real agency: the formula is the Account audit's; the demo shows $125,398 from 8 clients with a win rate, which is demo data.
- The per-account target was exercised through the API and unit tests; the database column does not exist on the live database until the merge applies the migration, so the saved-target path was NOT run (the "without the update" path was).
- The breach alerts and Today's lead-ledger insights (coverage strip, speed by source) still judge against the default target, not an account's own.
- A very large real account (20,000 leads in a range): the read is capped at the newest 20,000 and the screen says so; not measured on a real agency with 100 clients.
- Windows are UTC calendar days (as before).

## FOR THE LEAD

**Log entry.** Stage SPEED: Speed to lead rebuilt as a queue, BUILT, awaiting King's checks. Decisions for King: (1) the leads waiting are Today's "new leads" by one rule, so the old headline "8 waiting and 42 never answered" is now "49 waiting, 42 of them never answered"; (2) a client's staff no longer see the ranking of people (hidden by the server); (3) a reply target can be set per client account, the default stays in Settings. UNSURE: breach alerts and Today's ledger insights still use the default target. NOT VERIFIED LIVE: everything about a real CRM.

**Migration.** `supabase/migrations/20261105110000_speed_account_target.sql`: one nullable column `locations.speed_target_minutes` with a range check (1 to 1440). **Additive: yes. Idempotent: yes (`add column if not exists`, the constraint is added only if missing). Nothing dropped, renamed or tightened.** NOT applied to the live database by this stage (main applies it with the merge). Old code never reads it; the new code works without it (the screen says "needs the latest database update" when a target is saved, and every account uses the default). `tests/unit/speed-v2-db.test.ts` has one test that needs the column and skips itself until it exists.

**Files likely to conflict at merge:** `src/lib/api/router.ts` (one import and one dispatch block next to the duplicates block), `src/lib/access.ts` (one rule on the business list), `src/lib/analytics/speed-queries.ts` and `speed-intel.ts` (small additive edits), `docs/METRICS.md` and `docs/DECISIONS.md` (appended), `tests/e2e/speed.spec.ts`, `tests/unit/speed-ui.test.ts`. Not touched: `src/app/app/nav.ts`, the sidebar, `dashboard.tsx`, `ui.tsx`, `globals.css`, scopes, the marketplace app.

**Proposals.**
1. *Chase mode for setters* (still open from F2): one lead at a time, full screen, Reply, Skip, Done.
2. *Targets by source and industry that the owner can edit* (F2 proposal 2), now that the per-client target exists.
3. *Make the alerts and Today's ledger honour a client's own target* (small, after this merges).
4. *Send the "waiting leads" sentence as the first line of the daily digest* (the headline text is one pure function, `headlineOf`).
5. *A real business-hours clock* (F2 proposal 3): the same function, a metric version.

**Local-only changes not committed:** `next.config.ts` has a `turbopack.root` line and `tsconfig.json` was edited by `next typegen` (both marked skip-worktree).

## Verification (commands run in `C:\Users\KING\wt\SPEED`, 5 Nov 2026; the dev server on port 3131 reads the real database through the demo company)

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint src tests scripts/check-tenancy.ts` | 0 errors, 12 warnings, none in a file of this stage |
| `node --test src/lib/__tests__/` | 879 tests, 879 pass, 0 fail (18 are the new `speed-v2.test.ts`, including the 150-account scale test and the Today-agreement test) |
| `npx vitest run tests/unit/speed-v2-db.test.ts --no-file-parallelism` | 5 passed, 1 skipped (the saved-target test skips itself until the column exists); fixture companies removed afterwards |
| `npx vitest run tests/unit/speed-ui.test.ts access-roles route-registry client-access speed-f2 golden-speed today-lists` | all pass |
| `npx vitest run tests/unit/data-inventory.test.ts` | 1 FAILED, expected: "locations columns: migration files against the live database". The migration file adds `speed_target_minutes`; the live database does not have it until the merge applies the migration. It passes once the migration has run. |
| `PW_BASE_URL=http://localhost:3131 npx playwright test tests/e2e/speed-v2.spec.ts` (one group at a time) | desktop-1440: all 12 pass (four roles; See all; figure to list counts; Today agreement for agency, business and client; every figure's count equals its list for months, weeks, clients and people; tenancy; the target without the column; call and email menu and lead panel; range in the address). tablet-768 and phone-390: the four role tests pass (no sideways scroll, thumb-sized buttons at 390). |
| `npx playwright test tests/e2e/speed.spec.ts --project=desktop-1440` (the older API tests of the answers Today and the alerts still read) | 7 of 8 pass (the one timing out at the default 90 s passes with `--timeout=500000`). **1 FAILS and is not from this stage:** "contacts that are not leads are left out" expects the demo to hold left-out contacts of the reasons import, spam, test and duplicate; the demo today has only "do not contact" and "test" (the old screenshot, taken before any change, shows 12 and 9). The left-out query is untouched. |
| `TURBOPACK_ROOT=C:/Users/KING TEST_PORT=3133 TEST_DIST_DIR=.next-speed-t CHECKS=check-tenancy node scripts/with-dev-server.mjs` | **NOT a clean pass.** Two runs got through all the cross-read sweeps (which include the six new Speed addresses with the other agency's accounts and a person id) and all forged writes (which include the new `PUT speed/target` on the other agency's account, refused with a 4xx) and then both stopped at `scripts/check-tenancy.ts:190`: `select id from connections where installation_id = <agency B>` returned no row, i.e. the fixture connection of the other agency was already gone. That line and the connection fixture are not part of this stage; the same fixture worked on the Duplicates branch before the Connections changes were merged, so the lead should run the check on main to see whether it is the Connections stage. Fixtures were removed (checked: no `xtest-` installations left). |
| Screenshots | `docs/review/speed-<role>-<390|768|1440>.png` and `-full.png` (new), `docs/review/speed-old-<role>-<width>.png` (before; the client's staff at 1440 was not captured) |

One fix found by the tests: the first role test failed because the headline number counts up when the page opens (the test read it mid-animation); the test now waits for it. The target test failed because the write answered 503 before it checked the account existed; `setAccountTarget` now checks the account belongs to the caller's company first, so another company's account is always "not found" with or without the database update.

> Update 11 Nov 2026: Call mode and every Call button use the CRM's own calling only. The "Call with" picker (CRM / this device / connected dialer) was removed from the screens; the stored preference is kept but unused.
