# UX review (live app, KD Squares Test account, 31 Oct 2026)

Method: Mode B from `docs/BUYER_AND_UX_REVIEW.md`, read-only, in the live app inside the CRM as the agency owner. Every page in the navigation was opened at desktop width (about 800 px frame). Today was also opened at phone width (375 px). Screenshots were taken in the session; they are **not saved in the repo yet**.

**Not done, so nothing below claims it:** Mode A (no Playwright run, no demo tenant: the local database connection is down), tablet width, console and network error capture, keyboard and contrast checks, any account-level (setter or business owner) view, any real human.

Severity: S0 blocker, S1 major, S2 moderate, S3 polish.

## S0

None confirmed. No tenant leak was seen, and no forbidden branding. The automated tenant tests (384 cross-reads) passed earlier today. Not re-run in this review.

## S1

**UX-01 Win rate and revenue forecast built on 6 closed deals.** Pipeline shows "Win rate 50% (3 won, 3 lost)", "Likely revenue $1,200,000" and a forecast of worst $600,000 / likely $1,200,000 / best $1,800,000. Brief section 13A rule 3 says never show a win rate on too few closed deals. The code has two different minimums: `src/lib/analytics/pipeline-intel.ts:243` uses 5, `src/lib/analytics/derive.ts:11` uses 20. Persona: P1, P2. Why it costs trust: this is the exact pattern the brief already called out ("a default win rate near 50%"). Fix: one shared constant (20), and "not enough closed deals" on Pipeline too.

**UX-02 Two different "open pipeline" numbers.** Today, Overview and the audit say $1,000,000 (deals with a value and an owner). Pipeline says $2,400,000 across 10,374 open deals. Leads says 10,172 in an open deal. A buyer reads these as the product disagreeing with itself. Fix: one definition on every screen, or show both with one line explaining the difference ("$1,000,000 counted; $1,400,000 is on deals with no owner").

**UX-03 Meeting notes page states something that is no longer true.** `src/app/app/views/meetings.tsx:92`: "SubSync does not write into your CRM ... needs a write permission this app does not ask for". SubSync now writes a note on the matched contact, and the permission is requested. The same page still tells users to connect Zoom through Zapier or Make, although Connect Zoom exists. Persona: P6, P1. Fix: rewrite the page around the real flow; keep the private address only as the fallback.

**UX-04 The first screen's headline is one test deal.** Today's "Do this first" says "$1,000,000 is sitting in 1 deal that has not moved", 100% of the counted pipeline. One deal drives the biggest sentence in the product. Persona: P1 (5-second test: reads as a data problem, not a lead problem). Fix: an outlier guard ("one deal is 100% of this number; check it is real") and, when speed-to-lead data exists, lead the screen with unanswered leads instead.

**UX-05 Agency user opened from inside a client account lands on the agency view.** Brief 4.1 says they should land on that account and be able to switch. Also the label "Agency view" (sidebar footer, `src/app/app/dashboard.tsx:279`) must be renamed per brief 13B. Persona: P1, P5.

## S2

**UX-06 "A sync is still running, so some numbers may change" appears on almost every load.** The 15-minute refresh runs constantly, so the banner shows all the time and the product looks unstable. Fix: show it only for the first sync or when data is older than the refresh window.

**UX-07 Clipping at narrow widths.** Accounts: the Contacts column is cut off and a scroll bar appears inside the card. Overview: the "$1,000,000" tile value is clipped. The brief requires no horizontal scroll. Fix: wrap or truncate tables; tile values scale down.

**UX-08 Clients page is mostly "n/a" and "not set".** Four tiles, three of them n/a. It is also a commodity feature per the research (client reports and QBR). Cut it from the nav or show it only once fees are entered.

**UX-09 Visual sameness.** Almost every page is four rounded tiles then one or two large cards. Tiles per page: Deals 8, Clients 8, Appointments 5, Account detail 5, Speed 4, Pipeline 4. Brief 13A caps the Overview at about 6 tiles.

**UX-10 Too much text before the content.** Page subtitles run up to about 190 characters and wrap to three lines (Accounts, Alerts, Duplicates, Data cleanup, Clients, Meeting notes). A setter will not read them.

**UX-11 Navigation has 20 items.** Brief: "8 to 12 outcomes done deeply". See the cut list in `BUYER_REVIEW.md`.

**UX-12 Call lists spins for more than 5 seconds** on first open. No skeleton, no progress.

**UX-13 Persistent filter bar** ("Show only [industries] / Hide 1 test account") sits above every page's title and pushes content down, even for an account with one filter option.

## S3

- Team shows "Team member ZWol" and similar for people whose names are not resolved. The Add name link works but a stranger will not know it exists.
- Duplicates tile "Exact matches 2,535" is a scary number from test data with no context.
- The Meeting notes explainer uses numbered steps for tools most users do not have.

## What works (specific)

- Speed to lead lists each waiting lead with a badge for how long, "never answered" versus "waiting", a "no owner" flag and an Open contact link. A setter can find the first lead to chase in one glance.
- Inbox & SLA gives each waiting conversation a Reply link and the channel it came from.
- Counts match the CRM where I checked (332 contacts for KD Squares Test).
- Phone width: the menu becomes a top tab bar and content reflows to one column.
