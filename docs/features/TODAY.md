# Today (rebuilt, 3 Nov 2026)

Status: **BUILT, awaiting King's checks.** Branch `worktree-agent-a508aebf1da92404b`. No database migration. Replaces the F5 front door (`docs/features/F5.md` stays as history).

## Who uses it, what they do next, what they would say if it were missing

- An agency owner on 5 to 60 client accounts: opens the top row of Fix first in the CRM and hands the rest to the team. "I would have to open five pages in every account to find which client is on fire."
- A setter, a business administrator or a client's staff on one account: answers the oldest waiting lead, makes today's calls, marks yesterday's appointments. "I would not know what to do first."

## What it does

Agency owner (all client accounts, or the ones picked in Today's own selector):
1. One big sentence: "13 clients need you today. $1,397,934 is at risk." Built only from existing figures; the dollars are counted stale-deal value, never an estimate.
2. Four figures against the account's own usual: leads waiting now (live oldest wait), typical first reply (7 days vs the 7 before, with a line), appointments to mark, open pipeline at risk. A comparison shows only above the minimum sample.
3. **Fix first**: the 7 most valuable things (see all N). Each row: account, what is wrong, what is at stake, how long it has been wrong, one button Open in CRM (white-label link) and a quiet Show the leads. j and k move, Enter opens.
4. Two charts, both clickable: **What needs attention** (donut, total in the centre; a slice or a legend row filters the queue to that kind and opens the list behind it, the count on the slice is the number of rows) and **Where it is happening** (top 8 accounts, bars split by kind; a bar narrows Today to that account). Each has a plain title that states the finding, a hint until the first click, and a "Showing: ..." chip with a cross to go back.
5. Accounts needing you (top 5, all on request): one reason each, health in plain words, Open in CRM, Only this account.
6. For your next client review: alerts raised, cleared and still open in the last 7 days (the word is cleared), and a 7-day strip (raised above the line, cleared below); a day opens that day's alerts.
7. Share Today copies the headline and the top 3 as plain text. SubSync sends nothing.

The account selector belongs to Today only: multi-select with search, shown to agency users with 2 or more accounts, never to a client's staff. The choice is in the address (`#today?ta=<ids>`) and remembered in this browser for Today only. Today does not draw the shared header filter and ignores it; every other page keeps it.

One account (business administrator, setter, client's staff): the same sentence for their account, My leads waiting (oldest first, live timer, one big Open in CRM each), Calls to make today (new leads nobody answered, no-shows, appointments to confirm; a person who asked not to be contacted is a disabled "Do not call"), My appointments today and tomorrow (which have no outcome marked), Also needs you, My numbers this week against their own usual, Done for today with the streak, Share my day. A business administrator also sees what SubSync caught. They get no fees, plan, settings, other accounts or agency-wide screen: the server reads only their own account whatever the address says.

## Components added to /design (reusable)

Headline number block (`HeadlineBlock`), Fix first queue and row (`FixFirstQueue`, `QueueRowView`), local account picker (`LocalAccountPicker`), pulse tile with sparkline and "vs your usual" (`PulseTile`, `PulseSpark`), proof strip and raised/cleared strip (`ProofStrip`, `RaisedClearedStrip`), donut (`DonutChart`), account bars (`AccountBars`), showing chip and chart hint (`ShowingChip`, `ChartHint`), the list behind a mark (`RowsPanel`), a live clock hook (`useNow`). Sample data: `src/app/design/sample-today.ts`; page: `src/app/design/today-blocks.tsx`. Pure rules: `src/lib/analytics/today-queue.ts`, `src/lib/design/donut.ts`. Metric definitions: `docs/METRICS.md` ("Today, rebuilt").

## Evidence

- Typecheck clean; eslint 0 errors (9 older warnings); `node --test src/lib/__tests__` 780 pass; `npx vitest run --no-file-parallelism` all pass, including `tests/unit/today-db.test.ts` (two real fixture companies: tampered `accounts=` for an agency, a business and a client never returns another account).
- Playwright at 1440 (demo company): `today.spec.ts` 21 of 21, plus menu, consistency, freshness, d0, f1, f4, whitelabel, f8, f10, demo, speed. Screenshots in `docs/review/` (`today-before.png`, `today-after.png`, `today-charts-*.png`, `today-account-*.png`).
- Colour: one chart colour per kind (chart-1 to chart-5), contrast of every mark on the page and the card in both themes is in `design-tokens.test.ts`.

## NOT verified live

- Everything above ran on the demo company. Not run on the three real installs: the queue ranking on real data, reply speed against the usual with real history, the alerts strip, and the client views with a real account user.
- The donut puts leads and deals in one whole because King asked for it; a lead and a deal are not the same size of problem, so the shares say how many things, not how much they matter. The queue is where money ranks.
- Stale deals use chart-4 (green). It is a category colour, never a status, and every row also has a word and an icon; King may prefer to move it.
- Lists behind a slice are capped at 100 rows (200 for leads); a capped list says so.
- Leads waiting and appointments to mark have no stored history, so they cannot be compared with a usual yet (they say so).
- The streak counts UTC days.

## King's 5 checks

1. Open Today as the agency owner. The first thing is one sentence with a client count and a dollar figure. Read the line under it and compare two of its numbers with Speed to lead and Appointments.
2. Press a slice of the donut. The queue narrows to that kind, a chip says what you are looking at, and the list opens with the same count as the slice. Press the cross on the chip.
3. Pick one account in "Client accounts" (or press a bar). Every number changes to that account, the address now has `ta=`, and Speed to lead is not narrowed. Press Back from a page you opened: you return to the same accounts.
4. Open Today as a client's staff user (demo: `/app?as=client`): only their account, their leads with a running wait, calls, appointments, numbers; no fees, settings or other accounts.
5. Press Share Today and paste it in a message: headline and top 3, nothing sent.

## Extra added (principle 2)

When a single deal is most of the stalled money, the headline says so ("One deal is $1,000,000 of that"), so the dollar figure is never read as a pattern.
