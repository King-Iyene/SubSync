# Today: review and rebuild brief (4 Nov 2026)

Reviewed on the LIVE app inside King's CRM (a single client account, KD Squares LTD, King's own sign-in) and on the demo, against `docs/KING_REVIEW_NOTES.md` (N1, N2, N3, N4, N5, N6, N7, N9, N16, N29, N34, N74), `docs/BUYER_AND_UX_REVIEW.md` (personas P1 to P5, the 5-second test, "one primary action per screen"), `docs/KING_FEEDBACK_LIVE.md` (KF-1 to KF-7) and King's message of 4 Nov. Verdict: **NOT GOOD ENOUGH. FIX THEN PILOT.** The earlier builds (F5, Today v2) added many features but the page does not do its one job: tell a person, in five seconds, what to do first.

## What a person sees today (live, one account)

1. Five rows of chrome before any content: a notice ("You opened this from inside a client account..."), search and bell, "Updated 2 min ago / Each account", the title and a long subtitle, four buttons (Preview the daily email, Print report, Share Today, Sync now), a filter row (Client accounts, Showing, Views, Commands). The first useful sentence starts below the middle of a 646 px window.
2. The same fact is shown six times in one account: the headline ("8 leads waiting and 24 unanswered messages"), the "Leads waiting now 8" tile, "Fix first" (a row of 24 and a row of 8), the donut ("32 need attention"), a bar chart ("KD Squares LTD has 32 things to fix") and "Accounts needing you" ("24 conversations ... and 31 more things").
3. The numbers disagree: 32 in the donut and the bar, "31 more things" in Accounts needing you, 24 and 8 in the queue, and a "Leads waiting 8 ... oldest 39 h" tile. The 8 leads are very likely among the 24 unanswered conversations, so 8 + 24 = 32 counts some people twice.
4. Charts that cannot answer anything: a donut with two slices (25% / 75%) for one account, and a one-bar "bar chart" with one account. Clicking a slice opens EVERY lead or conversation of that kind in all accounts (King's screenshot: "Unanswered messages, all client accounts, 27 conversations"), not the thing that was clicked. A chart whose click shows "everything" is decoration.
5. Four tiles repeat "Not enough history yet to compare with your usual." three times; "0 replies" as a headline value; "If nobody acts today: Nothing is about to go wrong today." (an empty section taking space).
6. A client-account user gets two menu items, Today and My day, that overlap.
7. The row actions (Open in CRM, Show, Done, ...) crowd every row, and "Show" opens a large records panel for a row that has one obvious action.
8. Features King asked for that are missing or weak: a clear first action for a setter ("reply to these people now, oldest first, one click to reply"); a plain explanation of the filter (N1); what changed since yesterday in one line; a calm all-clear; the same page working well on a phone for a client's staff (N29, P3).

## What Today must be (the spec)

One question: **"What needs a person today, and what do I do first?"** Five-second test: a stranger can say what this is, who it is for and what to press.

**Layout, top to bottom (all roles)**
- ONE slim header row: title "Today", a quiet status ("Updated 2 min ago", one source of truth, the existing `StatusLine`), a client-account filter chip that names the accounts (agency only) and ONE overflow menu "More" holding Preview daily email, Print, Share, Sync now, Views, Commands. No second notice banner: the "opened from inside a client account" note is a one-line chip in the filter row ("Showing KD Squares LTD. See all").
- ONE headline sentence in large type, then ONE primary button.
- Then the work list. Then (agency, all accounts only) the account breakdown. Then "Since you last looked" and "What changed". Everything else goes behind a clearly labelled "More detail" tab (Overview detail, People, Sources, Coverage), collapsed by default.

**One counting rule.** A person (contact) is counted once for "needs a reply": a new lead nobody answered is the same conversation as an unanswered message. Define in `docs/METRICS.md`: "Waiting for a reply" = distinct contacts whose last message is inbound and unanswered past the reply target; "New leads among them" is a SUBSET, shown as "of which N are new leads", never added. Appointments to mark, no-shows to recover, stale deals are separate kinds. The headline, the tiles, the queue, the charts and the drill lists must all use the same function; a unit test proves the same number everywhere.

**Charts only where they answer a question, and every mark drills to exactly its own records**
- One account (client staff, or an agency person inside one account): NO donut and NO account bars. Show a simple "what needs doing" list grouped by kind with counts that open that kind.
- All accounts (agency): ONE stacked bar per account (segments = kinds), sorted by what needs doing, max 8 bars plus "N more". Clicking a SEGMENT opens that account's records of that kind; clicking the account name opens that account's records of every kind; count shown on the mark equals the rows (existing test pattern `today-specs.test.ts`). Delete the two-slice donut.
- The records panel title says exactly what was clicked ("KD Squares LTD, unanswered messages, 24").

**The work list ("Fix first")** is the page's main object: for a setter it is "Reply now": the oldest unanswered people first, 5 rows visible, "See all N", each row: who, how long, channel, ONE button "Reply in your CRM" (white-label link) and a small "Done for now" (existing `today_actions`). Other actions live in a row menu. For an agency in all-accounts view each row is one account's biggest problem with one button.

**Tiles:** at most four, each a plain number, a plain sentence, and ONE shared footnote when history is short ("Comparisons start after 7 days of history") instead of repeating it. No "0 replies" as a value: use "No replies yet" with the sentence.

**Roles**
- Agency owner or admin, all accounts: headline "N clients need you today", the account bars, the queue by account.
- Agency person inside one account, and a client's staff: the single-account layout (no account chart); a client's staff see "My day" content on Today itself (one menu item, not two: remove the duplicate "My day" item and make Today the page; keep the old address working).
- Business owner (single account, non-technical): the same single-account layout with plain words (no "SLA", no "past the target"; say "waiting longer than 15 minutes for a reply").
- Phone: header collapses to title and menu; headline, then the first 3 rows; one thumb-sized button per row; no sideways scroll at 390 px.

**Plain words** (N11): no "SLA", "stale", "pipeline at risk" as bare jargon; every tile one sentence of what it means and what to do. KF-1 (plain badges, no pills), KF-2 (the filter names accounts), KF-4 (card ranges only on cards that show change over time), KF-6 (clickable marks) all apply. Dialing: KF-3.

**Do not delete:** the records panel, search people, command palette, saved views, share and print, the daily-email preview, since-last-visit, insights (they stay, behind "More" or the overflow menu so they stop competing with the first action). Do not touch tenancy rules: a client user must only ever see their own account's rows (existing tests stay green).

## Acceptance

1. 5-second test passes on the demo at 1440, 768 and 390 px for: agency all accounts, agency inside one account, client staff, business owner.
2. Above-the-fold at 1440x800: header + headline + button + at least the first 3 work rows are visible without scrolling.
3. One number per fact: a test builds a fixture where leads are a subset of unanswered conversations and asserts the headline, tile, queue, bar and drill list agree.
4. Every chart mark: the count equals the rows opened, and the opened list is only what was clicked (test per mark).
5. No chart shown for a single account; no duplicate menu item; no repeated "not enough history" lines (test counts the text).
6. Typecheck, eslint, unit tests and the Today e2e specs pass; real screenshots at three widths for the four roles in `docs/review/today-v3-*.png`; written King's 5 checks in `docs/features/TODAY.md`.

## Today 3 customer's-eye check (11 Nov 2026, stage TD)
Walked in a real browser (demo data, real API path, sample switch `?tdfx=1`), at 1440 and 390, light and dark, as agency, agency inside one account, business and client staff. Screens: `docs/review/td-*.png`.
- **Does the first screen say what to do in 5 seconds?** Yes: one sentence ("11 deals gone quiet, and 14 people have waited over a day for a reply.") and one button ("Wake up the 11 deals") above a ranked list of at most five.
- **Do counts equal rows?** Yes: every count opens its rows with "Open in your CRM"; DB test asserts count = total for waiting over a day; every kind answers 200 for own and foreign accounts.
- **Anything shown twice?** Found and fixed: the money estimate appeared as a chip and in the "why" line (chip removed); "Every number follows this choice" twice on Numbers (one left); "Needs permission" was both a notice and a list item (now only the notice).
- **Would an owner forward the receipt?** Yes: plain three lines, "Copy for your client", Print, CSV. It says "history starts <date>" and shows no figures until two days of record exist.
- **Fixed during the walk**: copy button failed silently where the browser refuses the clipboard (fallback added); staff saw a Settings tab they cannot use (hidden); a recording SQL error (bare `day` alias) and a boolean array error were caught by running the sweep on a fresh database.
- **Why would I pay?** It replaces opening six screens each morning, and it keeps the only record of what was found and fixed for the "what are we paying for" talk. Weak spot: first-day agencies see "history starts today" until a week passes.
- **Not verified**: speed against 1M rows on the live database (dev server latency to the remote database is 10 s or more per call, so the 2 s target is by design: shared counts, 30 s cache, parallel reads, not measured); the live email (dry run only).
