# Account audit (the Instant Audit), rebuilt (stage AUDIT)

Status: **BUILT, awaiting King's checks** (5 Nov 2026, parallel mode: worktree `C:\Users\KING\wt\AUDIT`, branch `stage/audit`). Not marked passed. The money test and the review of the old screen are in `docs/AUDIT_REVIEW.md`. The definitions are in `docs/METRICS.md`, "Account audit, rebuilt". The decisions are in `docs/DECISIONS.md`, 5 Nov 2026.

## Evaluation (principle 1)

(a) **Decision and for whom.** What to fix first, and what the leak costs: the business owner, the agency owner, a setter (their own queue), and an agency salesperson who needs one page to hand a prospect. (b) **Data.** All four lists already exist and run on the 21 scopes granted (deals, conversations, leads, calendars); nothing new is read. The estimate needs 20 won or lost deals per account, else no dollar figure. (c) **The CRM already does it?** Its reports are per account and per thing, none says what is wrong and what it costs; free audit tools look at ads and sites. (d) **Simplest version that proves value:** one sentence, one button, the findings with the exact rows. (e) **Risk.** A dollar figure that looks invented: mitigated by the minimum sample, the range, "Estimate" on it, the formula one tap away, and never adding counted and estimated money. Privacy: the share link carries no names; tenancy tests below.

## What changed

| Before | Now |
|---|---|
| One dollar figure five times; four tiles | One sentence about the money ("Your account is leaking about $X a month.", labelled Estimate, formula one tap away); the counted deal money in one separate line |
| A person or deal could be in several findings | One counting rule (deals, then people waiting, then no-shows, then appointments); unit and browser tested |
| One global stale age | Old or test deals are their own finding and never in the money (Today's rule) |
| "Good to know" tags, dot pills | Plain text; one button per finding; "N of 4 checks are clean" |
| "Where to start" table of 10, no paging | Top five, "See all N clients" with search, order and paging on the server (tested at 150) |
| No good news, no progress | "What is healthy" and "Progress" with minimum samples |
| Blank until the first read | "Reading your client accounts: 5 of 12 done", progress bar, refreshes by itself |
| Told an account user how many accounts the filter hides | Never sent to an account user (tested) |
| Share link: figures and titles | The same link, now also the sentence, the good news and the formulas; no names |

Files: `src/lib/analytics/audit-v2.ts`, `audit-clients.ts`, `share-queries.ts` (new, pure or small); `src/lib/api/audit-api.ts` (new, gathers the lists, 45-second kept read); `src/lib/api/router.ts` (the audit handlers replaced; `GET audit`, `GET audit/clients`, `POST audit/share` now take the same accounts as the page); `src/app/app/views/audit.tsx` and `audit-parts.tsx`; `src/lib/analytics/share-intel.ts` (optional new fields); `src/app/audit/[id]/page.tsx` and `report.tsx`; tests below. The old `audit-intel.ts` stays (Today reads its figures); it no longer draws this screen.

## The brief and where each item is

| # | Instruction | Where / evidence |
|---|---|---|
| 1 | `docs/AUDIT_REVIEW.md` starts with the money test, then reviews the current screen for four roles at 1440, 768 and 390 with real screenshots | DONE: that file; `docs/review/audit-old-<role>-<1440|768|390>.png` (12 photographs; 4 roles x 3 widths) |
| 2a | One-sentence verdict, estimate labelled, formula one tap away | `audit-v2.ts` `buildAuditV2` (verdict), `audit-parts.tsx` `VerdictBlock`, `Formula`; test "money: the estimate is people x average deal x win rate" |
| 2b | A grade only if explainable in one line | "N of 4 checks are clean. A check is clean when SubSync finds nothing to fix in it." (one account); "N of M client accounts have nothing to fix." (agency) |
| 2c | Findings ranked by money and ease; each with what is wrong, how many, the value with its formula, ONE button to the shared list (count equals rows), one how-to-fix line | `FindingRow`; the shared list is `RecordsPanel` built by `itemsSpec`; test "across the whole audit no person appears in two findings, and the counts equal the rows"; e2e "a finding opens exactly the rows it counted" at 3 widths and 4 roles |
| 2d | What is healthy | `healthyLines`, "What is healthy" block; test "good news" |
| 2e | Progress since the last audit (additive data, minimum samples, "not enough data yet") | `progressOf`; uses the daily check and the lead ledger (no new table); tests "progress" |
| 2f | No double counting, stated in METRICS.md, unit tested, reusing Today's rule | `claimPeople`, `mergeReplies`; METRICS.md; tests |
| 2g | Per-account audit for client users; agency lists clients by money (top 5 + See all, search/sort/paging, server paged, 100+) | `clientRows`, `pageClients`, `GET audit/clients`; tests "150 accounts" (pure), e2e "the client list is paged on the server" |
| 2h | Shareable summary: tokenised, expiring, no more data than chosen, never another account's, white-label, read-only, never sent automatically; "prospect mode" only if cheap and safe | Existing share link (192-bit token, 14 days, switch-off, scrubbed) now carries the new sentence; `share-queries.ts`; `tests/unit/audit-v2-db.test.ts`; `scripts/check-tenancy.ts`; prospect mode NOT built (needs the prospect's login; the link already serves the hand-over) |
| 2i | A calm "what to do first" primary action, a first-run state, re-run/refresh | `startLabel` button; `ReadingStrip` and `readingOf`; "Run the audit again" and `?fresh=1` |
| 2j | KF-1, KF-8, KF-9, KF-10 | No dot pills or tinted banners (plain text, thin rule); one small outlined button per row in a fixed column (44 px on a phone); never more than 5 clients inline, then See all; one primary action, headline biggest |
| 3 | Design skills run, recorded here; screenshots | Section "Design skills run" below; `docs/review/audit-<role>-<width>.png` |
| 4 | Tests | "Tests" below |

## Design skills run

- **design:design-critique.** Found: the page opened with a how-to box above the sentence (repeats what the page shows); the primary button was followed by its own fix line, which the first finding repeats; the button label "Show the 1 appointment" wrapped on two lines; "0 of 4 checks are clean" read as a failing mark; the Progress label wrapped. Changed: the how-to is gone; the fix line next to the button is gone; labels are "Show 11 people"; the zero case reads "None of the 4 checks is clean yet"; the label column is wider. Kept (worked): the headline as the biggest thing with the amount in the accent colour, one filled button, rows with one button each, a thin rule instead of boxes, the quiet money line.
- **design:accessibility-review (WCAG 2.1 AA).** Found: five "How this is counted" summaries share one visible name (2.4.6, 2.5.3); the row number was read as part of the title and the list (1.3.1); the Show buttons did not say which list (2.4.4); a refresh gave no announcement (4.1.3). Changed: each summary and each Show button has a spoken suffix with the finding's name; the row number is hidden from a screen reader; the footer is a polite status line that changes when the audit is read again. Checked: every control has a name, the search box and order have labels, pager buttons have names, the list panel traps focus and returns it (existing component), colour is never the only signal (words "Better", "Worse"; check mark with text), 44 px on a phone (tested), no sideways scroll (tested).
- **design:ux-copy.** Changed: "times the win rate" became "times how often your deals close" in the sentence (the formula keeps "win rate" with its plain meaning); "nobody has touched for a while" gives the number of days; "They wrote to a client account and nobody has answered after 4 hours" became "They wrote in and nobody has replied for more than 4 hours". Kept: "Reply to the 96 people", "Show 11 people", "Audit this client", "Run the audit again", "Nothing needs fixing in your account.", "Reading your client accounts: 5 of 12 done."
- **dataviz.** No chart on this screen on purpose: the data's jobs are one headline (a sentence, not a chart), a ranked list (the list itself, a bar chart would repeat it) and one magnitude (the thin bar "N of M accounts read", one colour, a text value beside it, role and values for a screen reader). Status colour is used only for the check mark, always with words.

## Customer-eyes improvements (KF-5)

| What | Persona | Where |
|---|---|---|
| The primary button is named after the action ("Reply to the 96 people") and opens that list | P2 ops, P3 setter | the verdict |
| "Audit this client" narrows the page to one client and says so; "Show all clients" returns | P1 agency owner | client rows |
| "Copy a summary" to paste to a client or a colleague | P1, P5 | More menu |
| "See a sample to send a client" in the demo | P1 | More menu |
| The first read of the accounts is shown as progress and refreshes itself | P4 business owner | top of the page |
| Old and test deals are named and sent to "close out" instead of hiding the real figure | P2 | finding 5 |

Proposals (not built; for `docs/PROPOSALS.md`): see FOR THE LEAD.

## King's 5 checks (plain words)

1. Open Account audit in the demo as the agency: the first thing is one sentence about money with the word Estimate above it; press "How this is worked out" and read the formula. Press the filled button: a list opens and its title count equals the rows.
2. Look at the findings: each has one button, no number is repeated, and the money for deals ("counted") is a separate line from the estimate.
3. Press "Audit this client" on a client row: the page narrows to that client and says so; press "Show all clients". Press "See all 13 clients" and try the search and the order.
4. Open the same page as a client's staff (`?as=client`) and as a business owner (`?as=business`): the same page for one account, no list of other clients.
5. On your phone: the buttons are easy to hit and nothing scrolls sideways; in the More menu, open the sample audit to see what a client receives.

## Tests

(Results are in "Verification" below.) `src/lib/__tests__/audit-v2.test.ts` (the counting rule, money, ranking, old or test deals, the sentence, the grade, healthy lines, the client list at 150 accounts, progress, first run, share text), `tests/unit/audit-v2-db.test.ts` (the share link: live, expired, switched off, wrong token, other company, view count; the lists at 150 client accounts and another company reading nothing), `tests/e2e/audit-v2.spec.ts` (four roles at three widths: the sentence, one primary action, a finding opens exactly its rows, plain words, no sideways scroll, 44 px targets at 390; the API: counts equal rows and nobody in two findings; the client list paged on the server; one client only and a forged id; an account user's view; the demo cannot share; Run again and See all), `scripts/check-tenancy.ts` (five new audit read addresses for every kind of session, plus the existing share link sweep, which now runs through the rebuilt share). Updated: `tests/unit/audit-report.test.ts` (the screen test), `tests/e2e/share-print.spec.ts` (the list and the links on the new screen).

## Verification

VERIFICATION_PLACEHOLDER

## NOT verified

- **Nothing here was tested against a real CRM account.** Only the demo company and fixtures. Whether the estimate sentence is believable on a real agency's numbers, and the deep links landing on the right contacts, were not checked.
- The 45-second kept read and the 3,000-row read caps were exercised on the demo and on fixtures (150 accounts, 3,000 deals), not on a real agency with 100 accounts and 50,000 contacts each. A real agency's "waiting for a reply" count depends on Speed to lead's 200-lead list; above it the count is an upper bound and the page says so.
- "Since your last audit" is not literal: progress compares SubSync's own daily check and lead ledger; no snapshot of each audit is stored (it would need a table).
- The shared page was read on the demo's sample and by `check-tenancy`; a real client opening a real link in a real browser was not checked.

## FOR THE LEAD

**Log entry.** Stage AUDIT: the Account audit rebuilt for trust. BUILT, awaiting King's checks. Decisions for King: the sentence is "leaking about $X a month" (estimate, formula under it); old and test deals are separated from the money (Today's rule); grade is "N of 4 checks are clean". UNSURE: whether "a month" is the right word for a 30-day window; how an agency with 100 accounts will feel the 200-lead cap on Speed to lead's waiting list. NOT VERIFIED LIVE: everything about a real CRM.

**Migrations.** None. Nothing needs the database to change.

**Shared logs.** The task asked for entries, so I appended (end of file only) to `docs/METRICS.md` and `docs/DECISIONS.md`. I did not touch `docs/NEEDS_KING.md`, `docs/PROGRESS.md`, `docs/FEATURE_STATUS.md`, `docs/NOTES_COVERAGE.md` or `docs/PROPOSALS.md`.

**Coverage updates.** None: this answers King's chat instruction of 4 Nov (and old notes N7 and N8 about back links and the filter, which the new screen keeps).

**Proposals.**
1. *Audit history* (P1): store one compact row per audit run so "since your last audit" is literal and a client can see the line go down over months. Effort: small (one additive table). Risk: low.
2. *Duplicates in the audit* (P1): "41 duplicates are inflating your lead count by about 2%" as one finding. Effort: small (the number exists). Risk: low.
3. *Per-stage quiet ages* (P2): replace the one global quiet age with each stage's own when the event store has enough history. Effort: medium. Risk: noisy until history exists.
4. *Prospect mode* (P1, P5): run the audit on a prospect through a read-only invite they approve. Effort: large; needs their login and a consent flow, so not built.

**Files likely to conflict at merge:** `src/lib/api/router.ts` (the audit handlers block near `computeAudit`, three import lines, the dispatch lines for `audit`, `auditRevoke`), `src/app/app/dashboard.tsx` (one word: `<AuditView />`), `src/lib/analytics/share-intel.ts` (three optional fields), `scripts/check-tenancy.ts` (one block of read addresses), `docs/METRICS.md` and `docs/DECISIONS.md` (appended). Not touched: `src/app/app/nav.ts`, the sidebar, `globals.css`, `ui.tsx`, scopes, the marketplace app, Today's own files (`today-*`), the Speed and Appointments views.

**Local-only change not committed:** `next.config.ts` has a `turbopack.root` line (marked skip-worktree); `tsconfig.json` is marked skip-worktree because the dev server rewrites it.
