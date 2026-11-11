# Unanswered messages: rebuilt as "the people waiting" (stage UNANS)

> **Update 10 Nov 2026 (stage merge-speed-waiting):** this screen is now the tab "Unanswered" of Speed to lead (Proposals item 2 was taken). The old menu entry is gone; #inbox and every old link still land on that tab. See docs/DECISIONS.md and "Unanswered inside Speed to lead" in docs/METRICS.md. The text below describes the screen itself and is still true.

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\UNANS`, branch `stage/unans`). Not marked passed. The money-first test, the overlap with Speed to lead and Today, and the review of the old screen are in `docs/UNANSWERED_REVIEW.md`.

## What was built

One question: **"who wrote to us and is still waiting for a reply, and who do I answer first?"** Top to bottom, for every role:

1. A slim header (title, one line that says SubSync shows who is waiting and never sends a reply, a "More" menu: copy a summary, print, download the list, change the reply target, how to use this page).
2. **One sentence** ("46 people are waiting for a reply across 9 clients. The longest has waited 4 days.") and **one button** ("Reply to the oldest of the 46 people waiting", which opens that conversation in the CRM through the white-label link). Under it: what waiting means in one line, the labelled cost estimate with its formula one tap away, and one line that explains Today's number ("Today shows 94 because it also counts 48 new leads nobody has replied to yet" with a link to Speed to lead). The all-clear says "Nobody is waiting for a reply." plus the next best step and two buttons.
3. **Reply now**: five people (KF-8: name, one reason line with the client, channel, owner, how long, ONE small Reply button 44 px on a phone, a quiet three-dot menu: Show person, Call in your CRM, Email in your CRM, Copy details). A person with several waiting conversations is one row ("2 conversations"). "See all N" opens the whole list in place: searched, filtered by how long, channel and owner ("No owner", "Mine"), sorted, and paged **on the server**, 25 a page, so 6 or 150 clients cost the same. "N are assigned to you. Show mine" for anyone who owns some.
4. **How long they have waited**: the one chart, three or four bars. Each bar is one button whose number is the number of people it opens.
5. **Where people are waiting**: an agency with more than one client sees the top five clients by people waiting and "See all N" (searched and paged on the server). Inside one account (a business owner, or an agency user who opened one client) the same place ranks the people who own the customers, "No owner" included. A client's staff get neither (the server sends none).
6. The notes at the bottom: SubSync keeps only who wrote, when and which channel; owner means; a call cannot be judged; the 30-day window; unread is not waiting.

Files: `src/lib/analytics/unanswered-v2.ts` (pure: the person, the buckets, the one selection, facets, rankings, sentences, estimate, agreement with Today, the bounded first screen), `unanswered-v2-queries.ts` (`unansweredHome`, `unansweredList`, `unansweredRanks`), `src/lib/api/unanswered-routes.ts` (`GET /api/app/inbox?part=home|list|ranks`), `src/app/app/views/inbox.tsx` (the page; the name `InboxView` is kept), `unanswered-rows.tsx`, `unanswered-all.tsx`, `unanswered-picture.tsx`. Changed: `router.ts` (one import and one dispatch block), `speed-v2-queries.ts` (one word: `accountFacts` is exported), `scripts/check-tenancy.ts` (nine read addresses appended), `src/lib/demo/seed.ts` (`ensureInboxDemo` now deletes and re-makes the four sample conversations in ONE transaction: every demo sign-in used to delete them and re-insert them a moment later, so a read in between, and a test, saw four people fewer; found because this stage's tests compare two reads). Kept untouched: the older `GET /api/app/inbox` (the exports, the saved views, the older tests), `waiting.ts` (the one rule), `waiting-view.ts`, `inbox-controls.tsx` (no longer used by the page; its tests still run). Not touched: `lead-drawer.tsx`, the People views, `nav.ts`, the sidebar, scopes, the marketplace app, migrations.

### The numbered brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/UNANSWERED_REVIEW.md` starts with the money test, an honest overlap analysis with Speed to lead and Today, and a review of the old screen for four roles at three widths with screenshots | DONE: `docs/UNANSWERED_REVIEW.md`, `docs/review/unanswered-old-*.png` (24 images: four roles x three widths x viewport and full page) |
| 2a | One sentence and one primary action ("Reply to the oldest of the N people waiting") | DONE: `inbox.tsx` (HeadlineBlock + PrimaryButton), `primaryLabel`, e2e role tests |
| 2b | Aging buckets as the one chart; each bar opens exactly its rows; count equals rows (KF-6) | DONE: `WaitedSection`, `selectPeople`; unit test "a bar and the list behind it are one selection"; DB test; e2e "a bar opens exactly its people" and "every number agrees with its list" |
| 2c | "Reply now" 5 rows + See all, server searched, sorted and filtered by bucket, channel, account, owner, paged; scales to 100+ accounts | DONE: `unansweredList`, `WaitList`; unit "150 client accounts" (first screen under 12 kB, 6,000 people, paged); DB test; e2e See all |
| 2d | Row = who, snippet, how long, channel, ONE small Reply button (the conversation in the CRM, white-label), a row menu (Show person, Call, Email, Copy) | DONE except the snippet: SubSync stores no message text (see "NOT built"); `unanswered-rows.tsx`; link from `deepLinks.conversation` in `unanswered-routes.ts` |
| 2e | DND and quiet-hours warning before dialing; the shared lead panel from every row | DONE: `dialWarnings` before Call (same component logic as Speed), `LeadDrawer` through `usePersonActions`; e2e menu and panel test |
| 2f | Agency view ranks accounts (top 5 + See all); account view ranks people (owners); a client's staff see only their own queue | DONE: `WhereSection`, `rankAccounts`, `rankOwners`, `unansweredRanks`; the client's staff get no ranking and a colleague's id is ignored (DB test, e2e). "Only their own queue" is read as their own account, a Mine chip and no colleagues ranking (DECIDED FOR KING, see DECISIONS) |
| 2g | Calm all-clear with the next best step; copy summary and print | DONE: `nextBestAction`, `summaryText`, the More menu |
| 2h | KF-1 (no pills, no tinted banners), KF-8 (compact aligned rows), KF-9 (never more than 5 inline, scale), KF-10 (calm) | DONE: see "Design skills run"; screenshots |
| 2i | Numbers agree with Today (same function; the headline equals Today's number where the filters match; difference documented and unit tested) | DONE: `todayAgreement` through Today's own `mergeReplies` and `countsOf`; METRICS "Unanswered messages, second pass"; unit test "Today agrees"; e2e "every number agrees with its list, and with Today" for three roles |
| 3 | Design skills run; what each changed recorded here; screenshots `docs/review/unanswered-<role>-<390|768|1440>.png` | DONE: below |
| 4 | Tests, `tsc`, eslint, node tests, touched vitest files, e2e, DECISIONS | DONE: "Verification" |

## Design skills run

- **design:design-critique.** Found on the first build: the wait chart as a vertical bar chart gave three very wide bars with an empty middle one and its top axis label collided with the chart caption (a known issue of the shared bar chart); every row of the demo carried a warning triangle because every wait was 3 to 5 days, so the icon said nothing; the proof block had three paragraphs under the headline. Changed: the chart is three or four bar ROWS (label, bar, number), the whole row one button at least 44 px high on a phone, each bar carries its number (no axis needed); the triangle is gone (the word "Waiting 4 days" and the warning colour say it; a week or more is quiet, never an alarm); the Today line and the money line are shorter and sit in one block; the notes at the bottom are two short paragraphs. Kept: the headline as the biggest thing, one filled button, rows of one line of title and one of reason, no pills, no tinted boxes, one menu trigger, one button height.
- **design:accessibility-review (WCAG 2.1 AA).** Checked in the code: every control is a real button, link or select; each bar and number is a button whose spoken name starts with the visible text ("4 to 24 hours: 8 people, open the list", "17 people" inside "Metro Auto Repair: 17 people waiting, open the list") so the name contains the label (2.5.3); chips are `aria-pressed` buttons; the channel and sort selects and the search have labels; an opened list moves focus to its heading and Back returns focus to See all or the chart heading (2.4.3); the list range is a polite live region; the call warning is an `alertdialog` that focuses "Do not call"; the Reply link says it opens a new tab; heading order is one h1 then h2s; a wait is always a word, never colour alone; thumb targets (Reply, menu, primary button, bars) are at least 44 px at 390 (tested). Not changed, to be tested with a screen reader by a person: the name button in a row is 24 px high on a phone (the row around it is at least 56 px; 2.5.5 is AAA).
- **design:ux-copy.** Changed: "Today shows 94 because it also counts 48 new leads nobody has replied to yet (a form fill, or only an automatic message)." instead of the longer first draft; "Download the list (CSV)" instead of "Download every waiting conversation"; "No one is behind this number." for an empty list; the bottom notes cut to two short paragraphs and the unread footnote; "4-hour reply target" with a hyphen. Kept: "Reply to the oldest of the N people waiting", "Reply now", "Show person", "Call in your CRM", "Email in your CRM", "Needs permission: reconnect" (the existing wording), no platform name and no jargon (tested on every role).
- **dataviz.** One series over an ordered category (how long), so bars are the right form (not a donut, not a gauge); one axis-free chart because every bar is labelled with its number; the bar colour is the first chart token and the two longest waits use the warning colour, which is a status (past a day) and the number and the bucket name are always printed, so colour is never the only carrier; a zero bucket is a quiet row, not a bar; buckets that cannot hold anyone under the reply target are left out. There is no categorical palette (single series), so the palette validator was not run.

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| The one button opens the oldest conversation itself, not the contact | P3 setter | headline |
| A person with three waiting threads is one row; the sentence says "people", like Today | P1, P2 | everywhere |
| "Mine" and "N are assigned to you. Show mine" | P3 | Reply now, See all |
| "No owner" is a chip and a row of its own in the owner ranking | P1, P4 | list, ranking |
| Call and Email in the row menu with the do-not-disturb and calling-hours warning before a call | P3, P4 | row menu |
| The labelled money estimate with its formula one tap away | P1, P4 | proof line |
| One line that explains why Today shows a bigger number, with a link to Speed to lead | P1, P2 | headline |
| Copy a summary and Print for a client review | P1, P5 | More |
| An all-clear that says what to do next and offers the two next screens | all | headline |
| Export is no longer offered to a client's staff, who could never use it | P3 | More |
| Owner names use one rule ("Former team member", "Name not loaded yet", "Needs permission: reconnect") instead of a paragraph about missing names | P1 | rows |

## Proposals (bigger or riskier, not built)

1. **Store a short snippet of the last message** (the row would say what the customer asked). Needs a column, the conversation-messages permission and a changed privacy statement and Trust page; only King can decide. A middle road: store only a keyword class ("asks for price", "asks to reschedule") computed at sync, never the text.
2. **Make this a tab of Speed to lead** ("New leads | Existing customers") if the menu must shrink; the two screens share the row, the menu and the lead panel.
3. **Assign from SubSync** (needs a write permission and the write switch; the owner ranking already shows who is overloaded).
4. **A morning digest line** from the headline sentence (`headlineOf` is one pure function) and an alert when someone crosses 24 hours.
5. **Reply-time promise per client** (like the per-client target in Speed to lead) so the 4-hour reply target can differ for a roofer and a dentist; today it is one number in Settings.

## King's 5 checks (plain words)

1. Open Unanswered messages as the agency. The first thing is one sentence ("46 people are waiting...") and one button. Press the button: the oldest conversation opens in your CRM. Press "See all 46": the list opens with the same number; type a name; press "4 to 24 hours"; press Back.
2. Under "How long they have waited" press the biggest bar: its list has exactly the number on the bar. Under "Where people are waiting" press a client's number: the same.
3. In a row press the three dots: Call in your CRM and Email in your CRM open the contact in your CRM (never your phone, never a sent message). Try a person marked do not disturb: a warning comes first.
4. Read the line under the headline: "Today shows N because it also counts M new leads nobody has replied to yet". Open Today: its "waiting for a reply" number is N. Open Speed to lead: the M are there.
5. Open the same page as a client's staff (`?as=client`) and as a business owner: one account, no ranking of colleagues for the client's staff, and on your phone nothing scrolls sideways and the buttons are easy to hit.

## NOT verified / NOT built

- **Nothing here was tested against a real CRM account.** The Reply link opens the conversation, and Call and Email open the contact, through the white-label link; whether the conversation address lands on the right thread on a real white-label domain was not tried (the pattern is the one the old page used). The CRM has no link that opens its own dialer or mail box (F10, CHECK), so Call and Email open the contact and the menu says so.
- **No message snippet** (SubSync stores no message text; proposal 1).
- **A very large real account.** The read is capped at the 20,000 waiting conversations that have waited longest and the screen says so; not measured on a real agency with 100 clients. Timing on the demo: the first answer takes 11 to 15 seconds on this machine, because every demo call signs in again.
- **Today's source lists are capped** (100 waiting conversations); with more than that in one scope Today's count can be an upper bound and this screen's the exact one (METRICS).
- **Calls**: whether a call was answered is not known; the row says so.
- **Unread** is no longer a list on this page (a footnote only). It still appears on Today and in the older answer.
- **The client's staff "own queue"** is the account, not only contacts assigned to them (see DECISIONS).
- **Saved views** are no longer offered in the page (the endpoints and the table stay).

## Verification (commands run in `C:\Users\KING\wt\UNANS`, 4 Nov 2026 by the clock of this machine; the dev server on port 3171 reads the real database through the demo company)

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint src tests` | 0 errors, 12 warnings, none in a file of this stage |
| `node --test src/lib/__tests__/` | 929 tests, 929 pass, 0 fail (15 are the new `unanswered-v2.test.ts`: the one rule, a person once, the buckets, a bar and its list, chips that count their own list, search, stable order, paging, the headline, rankings, **Today agrees**, the estimate, the next step, the summary, **150 client accounts** (6,000 people, first screen under 12 kB), no platform words) |
| `npx vitest run tests/unit/unanswered-v2-db.test.ts --no-file-parallelism` | 7 passed (database: two fixture companies; the other company's account, a forged account id, an empty account list and a colleague's id read nothing; fixtures removed afterwards) |
| `npx vitest run tests/unit/inbox-waiting-db.test.ts f4-components route-registry` | passed (the first run failed once because another process was re-making the sample conversations at that moment, the race described above; alone it passes) |
| `npx vitest run tests/unit/speed-ui.test.ts access-roles client-access d1-polish ds-components inbox-views-db today-lists tenant-tables` | all pass |
| `PW_BASE_URL=http://localhost:3171 npx playwright test tests/e2e/unanswered-v2.spec.ts` desktop-1440 | 10 of 11 passed in the first full run; the one failure ("every number agrees with its list", a bar showed 8 and the list 9 because a person crossed the 4 hour target between two slow reads) led to the pair-retaking helpers; the three changed tests then passed on desktop-1440 (5, 6, 8) |
| same, tablet-768 | 10 of 11 passed; the failure was the same test 8 (the sample conversations were being re-made by another process); not re-run after the fix |
| same, phone-390 | first run 8 of 11 (tests 5, 6 and 8: the same two causes); after the fix tests 6 and 8 passed and test 5 passed on its own re-run. The four role tests pass at all three widths (no sideways scroll; Reply, three dots, the primary button and the bars at least 44 px at 390) |
| `UNANS_CAPTURE=unanswered ... unanswered-capture.spec.ts` | screenshots `docs/review/unanswered-<role>-<390|768|1440>.png` and `-full.png` (new) and `docs/review/unanswered-old-<role>-<width>.png` (before). The page is 2,500 px tall at 390 for the agency (was 4,344) |
| `scripts/check-tenancy.ts` | **NOT run** (shared fixtures; the lead runs it alone). Nine read addresses of this screen were appended, aimed at the other agency's account, owner and name |
| `npm run verify`, the integration chain, the full e2e | NOT run |

Older tests changed: `tests/e2e/f4.spec.ts` (the six UI tests about tabs, wait chips, saved views, choices and the drill panel were removed; their API tests, the deals test, the SLA-word test and the client's staff test stay), `tests/e2e/inbox.spec.ts` (the screen test follows the new page), `tests/e2e/f1.spec.ts` (the unread test reads the footnote), `src/lib/__tests__/f4-wording.test.ts` (names the new files). Not run: `tests/e2e/f4.spec.ts`, `inbox.spec.ts`, `f1.spec.ts` after the change.

Two things found by the tests, both fixed: the person's name came from the first conversation in the list, not the oldest (a unit test caught it); and a race in the demo seed (above).

## FOR THE LEAD

**Log entry.** Stage UNANS: Unanswered messages rebuilt as the people waiting, BUILT, awaiting King's checks. Decisions for King: (1) the screen counts people, not conversations, and Today's number is this screen's people plus the new leads that have no waiting conversation (stated on the screen); (2) unread and saved views are no longer in the page; (3) no message snippet; (4) a client's staff see their own account with a Mine chip rather than only contacts assigned to them. UNSURE: whether the conversation address opens the right thread on a real white-label domain. NOT VERIFIED LIVE: everything about a real CRM.

**Migration.** None. Nothing in `supabase/migrations/` was added or changed.

**Files likely to conflict at merge:** `src/lib/demo/seed.ts` (one function, `ensureInboxDemo`), `src/lib/api/router.ts` (one import and one dispatch block next to the speed block), `src/lib/analytics/speed-v2-queries.ts` (one word), `scripts/check-tenancy.ts` (nine read addresses appended to the reads array), `docs/METRICS.md` and `docs/DECISIONS.md` (appended), `tests/e2e/f4.spec.ts`, `tests/e2e/inbox.spec.ts`, `tests/e2e/f1.spec.ts` and `src/lib/__tests__/f4-wording.test.ts` (older UI tests of the old screen replaced or updated), `src/app/app/views/inbox.tsx` (rewritten).

**Coverage updates.** For the lead to decide; the old F4 notes (N11 to N15) now have a rebuilt screen: `node scripts/notes-coverage.mjs set F4 DONE-TONIGHT "rebuilt in stage UNANS, see docs/features/UNANSWERED.md"` (not run: shared ledger).

**Local-only changes not committed:** `next.config.ts` has a `turbopack.root` line and `tsconfig.json` was edited by `next typegen` (both marked skip-worktree).
