# Appointments: rebuilt around three work lists (stage APPT)

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\APPT`, branch `stage/appt`). Not marked passed. The money-first test and the review of the old screen are in `docs/APPOINTMENTS_REVIEW.md`; the definitions are in `docs/METRICS.md`, "Appointments, the work lists".

## 1. What was built

| Layer | What it is | Writes to the CRM? |
|---|---|---|
| The page (`appointments.tsx`, `appointments-work.tsx`) | One headline ("22 appointments need you", the three kinds counted in words, the counted open deals of those people), one primary button (Follow up the N no-shows, else Mark N past appointments, else Check N coming up; a calm all-clear when nothing is left), the true show rate with a plain sentence and an honest range, three lists of five rows each (No-shows to recover, Needs an outcome, Coming up that may not show), See all, and "Who needs a nudge" (people, calendars, client accounts). | **No.** SubSync only reads appointments. |
| Pure rules (`appointment-work.ts`) | The three lists (reusing `needsOutcome` and `noShowRecovery`, the functions Today's numbers come from), row reasons in words, ranking, search, sort, paging, true show rate and range, outcome buckets, comparison, headline, copy summary. | n/a |
| Reads (`appointment-work-queries.ts`) | One build per installation and set of accounts, kept 30 seconds: appointments (90 days back, 60 ahead), the contacts and counted open deals of the people in the lists only. `workOverview`, `workList`, `workCompare`. | n/a |
| Endpoints (`appointment-work-routes.ts`) | `GET appointments/work`, `appointments/list`, `appointments/compare`, dispatched from `router.ts` (one block). The accounts come from the signed session through `allowedIds`; the browser can narrow, never widen. The old `appointments`, `appointments/breakdown`, `appointments/<account>/<id>` and `appointment-insights` stay (Today, the audit, the weekly email and the Insights tab read them). | No. |
| The person panel (`ds/lead-drawer.tsx`) | The existing lead panel (tags with the day SubSync first saw each one, timeline, calls, deals, the do-not-disturb badge and the warning before a call) gets a `top` slot, and the appointment is shown there: status, time, calendar, who, "Open in your CRM to mark the outcome", what SubSync saw change. The email line is now "Email in your CRM" (the CRM link; the `mailto:` link is gone). | No. |

**Calls, email.** Each row has ONE small outlined button: **Call** (a person with a phone, on a no-show or an upcoming row) or **Open** (everything else, and the "Needs an outcome" rows). Both go through the white-label link helper (`dialPlan`, `src/lib/links.ts`); never `tel:` unless the person chose "my own phone app" in the Dialer setting. If the person asked not to be contacted, or it is outside 8 am to 9 pm where the account is, **Call opens the person panel with the warning instead of the CRM** (tested for the do-not-disturb case). The row menu holds Show the person and the appointment, Call in your CRM, Email in your CRM and Open in your CRM (to mark the outcome, on the unmarked rows). The CRM publishes no link that opens its dialer or its email box for one contact (CHECK in `src/lib/people/dial.ts`), so both open the contact and the panel says so.

Files: new `src/lib/analytics/appointment-work.ts`, `appointment-work-queries.ts`, `src/lib/api/appointment-work-routes.ts`, `src/app/app/views/appointments-work.tsx`; rewritten `src/app/app/views/appointments.tsx`; small edits to `router.ts` (one import, one dispatch block), `appointment-queries.ts` (three `export` words), `ds/lead-drawer.tsx` (the `top` slot and the email line), `scripts/check-tenancy.ts` (eight read addresses), `tests/e2e/appointments.spec.ts` (two UI tests replaced). **No migration.**

## 2. The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/APPOINTMENTS_REVIEW.md`: money test first; the old screen for four roles at three widths with real screenshots; what is confusing, repeated or missing | DONE, that file; `docs/review/appointments-old-<role>-<width>.png` (12 files) |
| 2 | One headline, one primary action | DONE: `appt-headline`, `appt-primary`; `headlineOf` (unit test) |
| 3 | Three plain lists, five rows inline, See all with search, sort, filter, paging that scales to 100+ accounts, server paged | DONE: `WorkSection`, `FullList`, `workList`; DB test at 150 accounts ("five rows per list, one page of a full list ... search and sort on the server"); first answer under 40 kB (asserted) |
| 4 | True show rate with a plain explanation and minimum-sample rules | DONE: `showRateOf` (5 marked outcomes; a range only from 3 unmarked and 5 points apart; a change only from 10 marked in both periods); unit tests "true show rate ..." and "the copy summary ..." |
| 5 | Chart marks clickable and opening exactly their own rows (count equals rows, KF-6) | DONE: four outcome bars; `inOutcomeBucket` is the rule for the count and the list; unit test, DB test "a chart bar's count equals the rows of the list it opens, for every bar", e2e "a chart mark opens exactly its own rows" |
| 6 | Appointment and lead panel with tags and the day added, timeline, do-not-disturb warning before dialing; "Open in your CRM to mark the outcome" via the white-label link; nothing written | DONE: lead panel `top` slot, `ApptTop`; e2e "a row opens the person with the appointment on top" and "a call to someone who asked not to be contacted opens the warning panel" |
| 7 | Per-person and per-account comparison people can act on | DONE: "Who needs a nudge", tabs People, Calendars, Client accounts (agency only), most to do first, the number opens exactly those rows (`compareBy`; unit and DB tests) |
| 8 | Reminders suggestion as display text only | DONE as the third list's reasons ("Not confirmed yet", "Missed their last one on Oct 3"). Nothing is sent. |
| 9 | Missing things a customer expects: calm all-clear, copy/print summary, who to call first, booking source only if data exists | all-clear: DONE (`headlineOf`). Copy summary and print: DONE (More menu, "Copy a summary"). Who to call first: DONE (money, then freshness; `selectWork`, unit test). Booking-source breakdown: NOT built on purpose, the Insights tab already has show rate by lead source (3 appointments per source, 5 outcomes for a rate) |
| 10 | Agency sees all accounts, a client's staff and a business owner see their own account only (server side) | DONE: DB test "each caller sees only their own accounts, and cannot ask for another"; e2e "a client's staff only ever read their own account"; eight new addresses in the tenancy sweep |
| 11 | KF-1 (no dot pills, no tinted banners), KF-8 (compact aligned rows, one small button column, a row menu), KF-9 (5 rows, See all, scale), KF-10 (calm) | DONE: rows copy the Today grid (`@3xl` fixed tracks, 44 px on a phone, 32 px on a laptop); status is words and a rule, never a pill |
| 12 | Same numbers as Today; one definition | DONE: Needs an outcome and No-shows to recover ARE Today's two kinds (same functions; 30 and 14 days). DB test compares with `appointmentView`; e2e compares with Today's `items`. Where this screen differs (the third list, the range, the value line) it is defined in `docs/METRICS.md` and unit tested |
| 13 | Design skills run and recorded | DONE, section 5 |
| 14 | Tests | section 4 |
| 15 | Log in DECISIONS.md | DONE |

## 3. Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| The money line: "The people behind them have $X of open deals" and the same per list | P1 agency owner, P4 owner | headline, list summaries |
| "Once marked, the rate will land between X% and Y%": the honest answer when appointments are unmarked | P1, P4 | true show rate card |
| Do not contact shown on the row, and Call never skips the warning | P3 setter | rows |
| Copy a summary (headline, rate, worst accounts) to paste in a message, and Print | P1, P5 | headline, More menu |
| Focus moves to the list when See all opens and back to its heading when it closes; the primary button scrolls to and focuses its list | keyboard and screen reader users | lists |
| A calm all-clear that says why nothing is left | P4 | headline, each empty list |
| Search finds a phone typed any way ("(555) 123-4567") | P2, P3 | See all |
| The comparison lists only people with something to do, with "See everyone" for the rest | P1, P2 | Who needs a nudge |

Proposals (not built, for `docs/PROPOSALS.md`): see FOR THE LEAD.

## 4. Tests and results (run in `C:\Users\KING\wt\APPT`, 5 Nov 2026)

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint` on every file added or changed | 0 errors, 0 warnings |
| `node --test src/lib/__tests__/appointment-work.test.ts` | 14 tests, 14 pass |
| `npx vitest run tests/unit/appointment-work-db.test.ts --no-file-parallelism` (real database, fixture companies removed afterwards) | 5 passed: counts equal `appointmentView` (Today's source), a person's deals once and a no-owner deal not counted, tenancy for agency and client with forged account and company ids, every chart bar's count equals its list, 150 accounts (five rows per list, one page of 25, short tables, search, sort) |
| `node --test src/lib/__tests__/` (the whole pure suite, includes the banned-words scan and the "one wording for a missing permission" test, which caught that the page had lost the words "Needs permission: reconnect": restored) | 875 tests, 875 pass, 0 fail |
| `npx vitest run` on `f3-appointments-ui`, `ds-components`, `ds-drill-range`, `route-registry`, `client-access`, `tenant-tables`, `access-roles`, `f3-appointments-db` (`--no-file-parallelism`) | 8 files, 85 tests, all passed |
| `PW_BASE_URL=http://localhost:3141 npx playwright test tests/e2e/appointments-v2.spec.ts -g "a headline, one button"` at phone-390, tablet-768 and desktop-1440 (the four roles; run again after the last edit) | 12 passed (7.5 min) |
| the same file, the six interaction tests at desktop-1440 (Today agreement, chart mark to list, See all with search, the person panel, the do-not-disturb warning, client tenancy) | 6 passed (5.4 min) |
| `npx playwright test tests/e2e/appointments.spec.ts --project=desktop-1440` (the older API and Insights tests, one UI test replaced) | 9 passed |

Written: unit tests for every number (unmarked, cancelled, rebooked, tiny samples, one person with two appointments, 150 accounts), a database test for the queries and the scale, `tests/e2e/appointments-v2.spec.ts` (four roles at the three widths, Today agreement, chart mark to list, See all, the person panel, the do-not-disturb warning, client tenancy, no sideways scroll, 44 px targets at 390), and the old `tests/e2e/appointments.spec.ts` updated (its two tests of the removed tab replaced by one for the card range).

## 5. Design skills run

- **design:design-critique** (screenshots at 1440 for the agency and a client's staff, 390 for the agency). Found: the first screen is crowded by the shell's permission notice and a three-line how-to box above the headline (the headline starts at about 410 to 515 px); the "Open deals" column says "none" on nearly every row; "Who needs a nudge" listed people with nothing to do; on a phone the row's reason was cut in the middle of a sentence. Changed: the how-to is one line; an empty deal cell is empty; the comparison shows only lines with something to do and a "See everyone" for the rest; reasons are one short line ("Missed 3 days ago · Follow-up call"). Kept (worked): the headline as the biggest thing, one filled button, rows on one grid with one small button and a quiet menu, no pills or tinted boxes.
- **design:accessibility-review (WCAG 2.1 AA, read from the code).** Found: the comparison tabs had no tab panel and no arrow keys (4.1.2, 2.1.1); pressing See all or Show fewer lost keyboard focus (2.4.3); the do-not-contact word relies on the warning colour but is also written (1.4.1, fine). Changed: a real `tabpanel` with arrow keys; focus moves to the opened list's title and back to the section heading on close; the primary button focuses the list it scrolls to. Checked in tests: every phone button is at least 44 px (tested), no sideways scroll (tested), the row buttons and menus carry the person's name for a screen reader, the chart bars have spoken labels with "open the list". Contrast was not measured with a tool (the colours are the app's own tokens used elsewhere).
- **design:ux-copy.** Changed: "need a person" to "need you"; "Where did they go, and your target" to "What happened to them, and your target"; the how-to to one line; the row reasons shortened. Kept: "Follow up the 8 no-shows" and "Mark 12 past appointments" (a verb and the number), "Needs an outcome", "Coming up that may not show", "Open in your CRM to mark the outcome", the empty states that say why nothing is left. No platform name on any role (tested).
- **dataviz.** The one chart is four ranked horizontal bars with a zero-based scale, a number on each and a spoken label; the form is right (four categories of one total, each needs to be pressed). Colour: Showed and No-show use the status colours (reserved for status, each with its word and number, so never colour alone), Cancelled uses the series colour. Red next to green is the classic colour-blindness pair; it is safe here because the order is fixed, every bar has its label and number, and the bars sit on separate lines. The palette validator is for categorical series, so it was not run. No change.

## 6. King's 5 checks (plain words)

1. Open Appointments as the agency. The first thing is a sentence ("N appointments need you") with the three kinds in words, then one big button. Press it: the page scrolls to the no-shows. Each row has Call or Open and a menu. Press Call on someone marked "Do not contact": a panel opens with the warning; nothing is called.
2. Press See all on "Needs an outcome". Type a first name in the search, change the sort, go to the next page. Then press the number next to a person in "Who needs a nudge": exactly those appointments open.
3. Open "What happened to them, and your target", press the No-show bar: the list has the same number as the bar. Change the dates on the true show rate card to Last 7 days: the sentence names the dates.
4. Open it as a client's staff (`?as=client`) and as a business owner (`?as=business`): same screen, only that one account, no client-account tab.
5. On your phone: the headline, the big button and the first rows are easy to hit, nothing scrolls sideways. Press a name: the person panel shows the appointment, "Open in your CRM to mark the outcome", tags with the day SubSync first saw them, and the timeline.

## 7. NOT verified

- **Nothing was tested against a real CRM account.** The demo has few deals on the people in these lists, so the money line (e.g. "$2,840") is only proven with fixtures.
- **"Open in your CRM to mark the outcome"** opens the contact. That the contact page is where a person can set showed or no-show was not verified, and the CRM has no published link to one appointment (the old F3 note still holds).
- **What the CRM's own reports show** for show rate was not looked at, so the page makes no claim about it, only the range.
- **The CRM's dialer and email box** cannot be opened by link (`DIALER_LINK_KNOWN` and `EMAIL_LINK_KNOWN` are false), so Call and Email open the contact.
- **The first read at 150 accounts** was timed only on fixtures (30 s cache, 60,000 appointment cap, 20,000 for a chart bar's list); a real agency with 100 accounts and a busy year of calendars was not tried.
- Booked-by and booking channel are still unverified live (the F3 note); they are not used on this page.
- Colour contrast was not measured with a tool.
- The tablet and phone widths were exercised by the four role tests only (not by the interaction tests, which ran at 1440).

## FOR THE LEAD

**Log entry.** Stage APPT: Appointments rebuilt around three work lists. BUILT, awaiting King's checks. Decisions for King: no-shows are counted over 14 days (Today's rule) rather than the 7 in the brief (DECIDED FOR KING, one constant `RECOVER_DAYS`); the Call button opens the warning panel instead of the CRM when there is a warning; email in the shared lead panel is now a CRM link, not `mailto:` (affects every page that opens the lead panel). UNSURE: the first read at 100 accounts with real data; whether the contact page is the right place to mark an outcome. NOT VERIFIED LIVE: everything about the real CRM.

**Migration.** None.

**Shared logs.** The task asked for entries, so I appended (end of file only) to `docs/DECISIONS.md` and `docs/METRICS.md`. I did not touch `docs/PROGRESS.md`, `docs/FEATURE_STATUS.md`, `docs/NOTES_COVERAGE.md`, `docs/NEEDS_KING.md`, `docs/TENANCY.md` or `docs/PROPOSALS.md` (no new table, no new scope).

**Coverage updates.** None: this answers King's chat instruction of 4 to 5 Nov. It extends N24, N25, N31 (done in F3) with the rebuilt screen.

**Proposals (for `docs/PROPOSALS.md`).**
1. *Mark showed or no-show from SubSync* (P2, P3): needs the calendar write permission; one press instead of a trip to the CRM; undo; preview first. Effort medium. Risk: writes to the CRM, needs King's approval and a scope. It is the one change that turns the biggest hole (unmarked appointments) into a fix.
2. *A morning message to each person with their unmarked and no-show count* (P2, P3): dry-run first, the existing notification service. Effort small. Risk: an outward message.
3. *Appointment value*: if the CRM's appointment or calendar carries a price, show real booked value instead of the open deals of the person. Effort small once the field is confirmed.
4. *Booking source on this tab*: only if the Insights tab's lead-source rows prove useful.
5. *Link a row to the exact appointment in the CRM calendar* if the CRM ever publishes a pattern.

**Files likely to conflict at merge:** `src/lib/api/router.ts` (one import, one dispatch block near the duplicates one), `src/app/app/ds/lead-drawer.tsx` (the `top` prop and the email line; other stages that touch the drawer), `scripts/check-tenancy.ts` (eight addresses added after the duplicates ones), `docs/METRICS.md` and `docs/DECISIONS.md` (appended), `tests/e2e/appointments.spec.ts`. Not touched: `nav.ts`, the sidebar, `dashboard.tsx`, `ui.tsx`, `globals.css`, scopes, the marketplace app, the Speed views.

**Local-only change not committed:** `next.config.ts` has a `turbopack.root` line (marked skip-worktree) and `tsconfig.json` is marked skip-worktree (Next adds its build folder).
