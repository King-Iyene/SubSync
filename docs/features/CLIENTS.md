# Clients, rebuilt as the agency's client book (stage CLIENTS)

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\CLIENTS`, branch `stage/clients`). Not marked passed. The money test and the review of the old screen are in `docs/CLIENTS_REVIEW.md`. Definitions: `docs/METRICS.md`, "Clients, rebuilt". Decisions: `docs/DECISIONS.md`, 5 Nov 2026. This replaces the Health and Details and billing tabs of stage C1; Onboarding, Compare and Reviews (QBR) are unchanged.

## Evaluation (principle 1)

(a) **Decision and for whom.** Which clients to check in with first, which renewals are coming, what each client pays and what it got: the agency owner and account manager. (b) **Data.** Everything is already read (people waiting, no-shows, quiet deals from the Account audit's rows; replies in time from the lead ledger; score, churn warning and lead-flow drop from the derived account). Fee, renewal, industry and the log are typed by the agency; SubSync cannot read them and says so. (c) **Does the CRM do it?** It shows one account at a time; no cross-client health, renewals or fee against value. (d) **Simplest version that proves value:** one sentence, one button, five rows, the client page. (e) **Risk.** A health label that looks wrong on a real account (thresholds are the existing ones; nothing was tested on a real agency), and "value created" read as money (labelled an estimate, formula one tap away).

## What changed

| Before | Now |
|---|---|
| Five tabs; Health (three views of the same clients, 2,633 px at 1440) and Details and billing (a second table) | One Clients tab: sentence, one button, five rows who need you, renewals, three figures; See all N clients; Onboarding, Compare, Reviews (QBR), Industries unchanged or moved |
| No money next to health | Fee and renewal in the row; "$5,000 a month at stake" in the sentence |
| Reasons without numbers, one sentence printed twice, 17 against Today's 21 waiting | One reason with the number from the same rules as Today and the audit ("Nothing has happened in the account for 73 days. And 3 more things.") |
| Fee, renewal, industry in a second table | Typed in the row (Enter saves, Escape cancels), labelled "You enter this; SubSync does not read it from your CRM." |
| Open a client = a long report | A client page: why, what to say (text only), what changed, fee against value created, renewal and dates for a calendar, private log, trends behind a button, copy or print a summary |
| Table of every client in the browser | Server-paged list of 25 with search, order and chips; five rows inline (tested at 150) |
| Dot pills | Plain words, an icon and a thin rule |

Files: `src/lib/analytics/clients-v2.ts` (all rules), `clients-v2-book.ts`, `clients-v2-queries.ts`, `src/lib/api/clients-book-routes.ts` (`GET clients?part=home|list|one|names`), `src/app/app/views/clients/` (`book.tsx`, `book-rows.tsx`, `book-all.tsx`, `client-page.tsx`, `industries.tsx`, `index.tsx`; `details.tsx` now holds only the log). Changed: `router.ts` (one import, `clientsBookPart`, one dispatch line), `audit-api.ts` (`Core.replies`, two lines), `scripts/check-tenancy.ts` (new addresses), old tests. `accounts.tsx` (the old Health tab) is no longer drawn; it is kept.

## The brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/CLIENTS_REVIEW.md` starts with the money test and reviews the current screen (agency; client staff and business owner) at 1440, 768, 390 with screenshots | DONE: that file; `docs/review/clients-old-<role>-<width>.png`. The old Details tab was not photographed (described from the code) |
| 2a | One sentence + one primary action | `headlineOf`, `primaryOf`; e2e "the sentence is the API's, there is one filled button" |
| 2b | Ranked list, top 5 inline, See all with search/sort/filter/paging, server paged, 100+ | `selectClients`, `pageOf`; unit "150 clients: ... every page of every filter"; e2e "See all ..." |
| 2c | Calm row: name, health word with reason, fee, renewal with countdown, ONE small button, row menu | `book-rows.tsx`; `clients-book-components.test.ts` |
| 2d | Client page: reasons, what changed, fee vs value created (formula in words, estimate labelled), log, renewal, inline edits | `client-page.tsx`, `valueOf`, `valueFormula`, `whatChanged`; e2e "a client's page" |
| 2e | Reminders display only; copy/print summary, no vendor words | `reminderDays`, `clientSummaryText` (no fee, no private notes, no product name; tested) |
| 2f | Missing things: why at risk, renewals list (60 days), what to say, calm all-clear | `assess`, "Renewals in the next 60 days", `talkingPoints`, all-clear block with `nextStep` |
| 2g | KF-1, KF-7, KF-8, KF-9, KF-10 | Plain words and a thin rule; first-use button "Add your first client fee"; honest label in four places; two lines under every column and figure; dismissible guide `HowTo`; one button column; five rows then See all; one primary |
| 2h | Tenancy | Agency only (route policy); `part=one` and `PUT` for another company's id are 404; e2e "never reach the book"; `check-tenancy.ts` addresses added (not run) |
| 3 | Design skills run; screenshots | Below; `docs/review/clients-<role>-<width>.png` |
| 4 | Tests | Below |

## Design skills run

- **design:design-critique.** Found: the same renewal appeared in "Who needs you" and in the renewals list (kept: different question, different order); the "Open client page" menu item repeated the row button; the honest label repeated four times on one screen; values typed in the client page looked like plain text. Changed: the duplicate menu item removed; the renewals hint says only "The dates are typed by you"; a "Change" cue after each typed value; on a phone the name takes its own line and the reason the full width (the first version clamped both to a narrow column). Kept: the sentence as the biggest thing with the amounts in the accent colour, one filled button, rows with one outlined button each, a thin rule not boxes.
- **design:accessibility-review (WCAG 2.1 AA).** Checked: every control is a real button or link with a name that starts with its visible text ("Open account (Summit HVAC)"); value buttons say what pressing them does; editor inputs have labels, errors use `role="alert"`; Enter saves, Escape cancels; the column help is keyboard reachable; status is a word and an icon, never colour alone; 44 px targets at 390 (tested); no sideways scroll (tested); the list heading takes focus when a list opens. NOT checked with a screen reader or measured for contrast beyond the app's own tokens.
- **design:ux-copy.** Kept: "Check in with the 3 clients at risk", "Who needs you", "Add your first client fee", "Open account", "Renewal due". Changed: "None of the last 24 new leads got a reply in time" (not "Only 0%"); "SubSync does not know what your clients pay you. Add a fee for each client to see how much is at stake." instead of a bare "n/a"; talking points are written to be said to the client and never name the product or the fee.
- **dataviz.** No chart on this screen on purpose: the data's jobs are one headline (a sentence), a ranked list (the list itself) and three magnitudes (plain figures with text). The old four-bar chart repeated four counts that are now the chips under the sentence; it was cut. Trends stay behind "Trends and reply history" using the existing line charts. No categorical palette, so the validator was not run.

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| "Check in with the 3 clients at risk" opens the worst one, with Previous and Next through the clients who need you | P1 owner, P2 account manager | headline, client page |
| What to say for each reason, with a Copy button | P2 | client page |
| A renewal due is in the needs list with its countdown and the dates to start the conversation | P1 | row, client page |
| A summary to copy or print that leaves out the fee and private notes | P1, P5 | row menu, client page |
| "Add your first client fee" opens the first client's fee for typing | P1 | headline, At a glance |
| An all-clear that names the next useful step | P1 | the page |

## Tests

`src/lib/__tests__/clients-v2.test.ts` (21: the label and its reason, small numbers, tiny samples, new clients, not-read, ordering, counts equal lists, sentence and button, calm state, value created, what changed, what to say, summary, banned words, 150 clients), `clients-v2-book.test.ts` (6: each figure is its source's), `tests/unit/clients-v2-db.test.ts` (5, database), `tests/unit/clients-book-components.test.ts` (10), `tests/e2e/clients-v2.spec.ts`, `tests/e2e/clients-capture.spec.ts`. Updated: `c1-components.test.ts`, `c1.spec.ts`, `menu.spec.ts`.

## King's 5 checks (plain words)

1. Open Clients as the agency. The first thing is one sentence ("3 clients look at risk, 2 renewals due within 30 days, $5,000 a month at stake.") and one button. Press the button: the worst client's page opens; press the arrow for the next one.
2. On a row press the fee, type 3210, press Enter: it saves in the row and the "at stake" figure changes. Press a renewal date or "Add renewal date". The words "You enter this; SubSync does not read it from your CRM." are on the page.
3. On a client's page read "What to say", press Copy, press "Copy a summary" in More: the text has no fee and no product name. Press "How this is worked out" under Value created.
4. Press "See all 12 clients": search a name, change the order, press a chip, go to page 2 if there is one. The number in the heading equals the chip you pressed.
5. On your phone: the rows read name, reason, then health, fee and renewal; buttons are easy to hit and nothing scrolls sideways. Open `?as=client#clients`: "Not available" and no money.

## NOT verified

- **Nothing here was tested on a real agency.** Only the demo company and fixtures. Whether the Watch threshold for slow replies feels right on real data is unknown: on the demo it puts 9 of 13 clients in Watch because the demo's replies are poor.
- The demo's value created is mostly "too few new deals to compare", so the 7.2x sentence was not seen on the demo; it is tested with fixtures.
- The old Details tab was not photographed (no server of the old code was available on my port).
- A client's own "my account health" view (the generic My account page for a business owner or a client's staff) was NOT changed; see proposals.
- Printing was checked by emulating print in the markup only, not by a real print preview.
- `scripts/check-tenancy.ts` has new addresses and was NOT run (shared fixtures).

## FOR THE LEAD

**Log entry.** Stage CLIENTS: Clients rebuilt as the agency's client book. BUILT, awaiting King's checks. Decisions for King: "at stake" = fees of At risk clients only; the book uses the Account audit's count of people waiting (Today's rule), so labels can differ from the old Accounts tab; slow replies alone make a client Watch. UNSURE: the Watch threshold on real data. NOT VERIFIED LIVE: everything about a real CRM.

**Migrations.** None.

**Shared logs.** The task asked for entries, so `docs/METRICS.md` and `docs/DECISIONS.md` were appended (end of file only). `NEEDS_KING`, `PROGRESS`, `FEATURE_STATUS`, `NOTES_COVERAGE`, `PROPOSALS` untouched.

**Coverage updates.** `node scripts/notes-coverage.mjs set N56 DONE-TONIGHT "CLIENTS: one client book with fee, renewal and health in the row (views/clients/book*.tsx)"`; `... set N58 DONE-TONIGHT "CLIENTS: fee, renewal, industry typed in the row; log on the client page"`.

**Proposals.**
1. *Paste a list of fees and renewal dates* (P1 with 50+ clients): "client, fee, date" in one box. Small; low risk (typed data).
2. *Renewal and at-risk alerts* through the alert engine and the notification matrix (sends, so needs its switches). Small once F9 exists.
3. *My account health for a client's staff and a business owner*: the same reasons in plain words, no fee, no notes, on the My account page. Small; low risk.
4. *Account manager filter*: one manager's clients (owner label exists). Small.
5. *Fees from billing data* after the financial scopes are agreed (N57).

**Files likely to conflict at merge:** `src/lib/api/router.ts` (one import, `clientsBookPart`, one dispatch line near `a === "clients"`), `src/lib/api/audit-api.ts` (the `Core` type and its return, two lines), `scripts/check-tenancy.ts` (two address lines), `tests/e2e/c1.spec.ts`, `tests/e2e/menu.spec.ts`, `tests/unit/c1-components.test.ts`, `docs/METRICS.md`, `docs/DECISIONS.md`. Not touched: `nav.ts`, the sidebar, `dashboard.tsx`, `lead-drawer.tsx`, `globals.css`, scopes, the marketplace app.

**Local-only changes not committed:** `next.config.ts` has a `turbopack.root` line and `tsconfig.json` is rewritten by the dev server (both marked skip-worktree).

## Verification

Commands run in `C:UsersKINGwtCLIENTS` (5 Nov 2026) against the dev server on port 3181 (demo company, real database). The tenancy check and the integration chain were NOT run (shared fixtures; the lead runs them).

| Command | Result |
|---|---|
| `npx next typegen && npx tsc --noEmit` | clean |
| `npx eslint src tests` | 0 errors, 12 warnings (older unused imports, none in a file of this stage) |
| `node --test src/lib/__tests__/` | 941 tests, 941 pass, 0 fail (27 are the new `clients-v2` and `clients-v2-book` tests) |
| `npx vitest run tests/unit/clients-v2-db.test.ts --no-file-parallelism` | 5 passed (database: counted money equals `dealFigures` over `loadDeals`; another company's ids answer nothing; 150 client accounts; fixtures removed afterwards) |
| `npx vitest run` on `c1-components`, `clients-book-components`, `route-registry`, `client-access`, `c1-access`, `ds-components` (--no-file-parallelism) | 6 files, 69 tests passed |
| `PW_BASE_URL=http://localhost:3181 npx playwright test tests/e2e/clients-v2.spec.ts` at desktop-1440, phone-390, tablet-768 (one project at a time, about 14 minutes each: every demo call takes 10 to 40 seconds) | tablet-768: 12 of 12 passed. desktop-1440 (10 tests then) and phone-390 (12): everything passed except "a client's staff opening Clients get a plain not available and no money" on both, which failed on my own test mistake (the regex `fee` matched "Give feedback"); fixed to `fees?` and re-run at desktop-1440 and phone-390: passed. The two tests added after the desktop run started (trends behind one button, industry picker) passed at phone-390 and tablet-768 and were NOT run at desktop-1440. |
| `tests/e2e/c1.spec.ts`, `menu.spec.ts` (edited for the new tab names) | NOT run |
| `scripts/check-tenancy.ts` (five new read addresses, four for a client's staff) | NOT run |
| Screenshots | `docs/review/clients-<agency|client-staff|business-owner>-<390|768|1440>.png` and `-full.png`; `clients-agency-all-*` and `clients-agency-page-*` for the list and a client's page; `clients-old-*` for the screen before |

One thing the tests found about the demo: with its poor reply data nine of 13 clients are Watch, so "Who needs you" lists 12 of 13. The sentence and the button lead with the three At risk clients, and five rows are inline; but a real agency with good reply speed will look calmer than the demo.
