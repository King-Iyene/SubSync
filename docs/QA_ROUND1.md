# QA round 1 (customer's-eye pass: agency owner, 50+ accounts, 50+ users)

Method: dev server (all flags on) with the sample switches (tdfx, aufx, apfx, apxfx, ppfx, clfx, plfx, pmfx) at 1440 light, 390 light for most screens; code review for the rest.
Limits (be honest): the dev link to the database is slow (about 0.2 s per query, 15 to 60 s per first screen), so the real-data path was only partly walked, dark mode and 768 were not walked, and Pipeline, Payments, Account audit tabs got only a first-screen look. Find lead was skipped as asked.

## Fixed in this PR
| Module | Defect | Severity | Status |
|---|---|---|---|
| Appointments | The bar's date buttons (7/30/90 days) did nothing; the screen kept its own date, so two dates disagreed | blocks going live (wrong numbers under a wrong label) | fixed: the screen follows the bar |
| Appointments | A number inside a clickable row (Account health "No outcome", Booking share bookings) fired the row too: 14 opened a list of 74, and Booking share opened a list and a panel together | blocks going live (count not equal to rows) | fixed (Hit stops the row click) |
| Appointments | Drill chip said "selected person" instead of the name | polish | fixed |
| Appointments | The Open button was cut off at the right edge of wide lists | annoying | fixed (stays in view) |
| Appointments > Leadership | Lower cards ran past the right edge of the screen | annoying | fixed (one shrinkable column); re-check in browser |
| Team, Pipeline | Bar showed a date control that did nothing (they have their own period) | annoying | fixed: bar shows accounts only |
| Team > Money | Two total boxes looked like buttons and did nothing; search box touched them | polish | fixed |
| Today | Bar account choice did nothing to the new Today; two account pickers | blocks going live (choice ignored) | fixed: one choice kept in sync; the second picker is hidden for agency owners |
| Today | Number lists used a bare link, not the Open button and lead panel | annoying | fixed |

## Left
| Module | Defect | Severity |
|---|---|---|
| All | First screen takes 15 to 60 s on the slow dev database link; the shell fires 8 or more calls at once (freshness, segments, dialer, usage, notifications are repeated). Measure on production before switching on | blocks going live until measured |
| Today, Clients (sample only) | Sample lists show 40 rows for a count of 11; sample account page asks the live API and gets a 404 | polish (sample only) |
| Appointments, Team | Still two account pickers (bar plus own) on 390 wide; pushes content down | annoying |
| All | Link-style buttons ("Pause for 7 days", "How is this worked out?") are 24 px tall; Recover Open icons 39 px at 390 | annoying |
| Clients | People tab crashed once during an automated run while files were being edited; not reproduced afterwards (likely hot reload) | watch |
| Pipeline, Payments, Account audit | Only first screen seen, no defects spotted; tabs and drills not walked | unverified |

## Verdicts
- Today (+Numbers, Proof, Settings, Recover): ready to switch on after the speed check.
- Account audit: ready to switch on (first screen clean, wording plain).
- Appointments: fix first has been done in this PR; ready once the Leadership width fix is eyeballed.
- Team: ready to switch on.
- Clients v2: fix first: confirm the account page and bulk/plans screens on real data (not walked).
- Pipeline (Slipping) and Payments: fix first only because they were not walked tab by tab; no known defects.
- Cash features (save card, Recover): ready to switch on.

Checks: tsc clean, 1592 unit tests pass, eslint clean on touched files. Cleaned up: my dev server on 3660 is stopped. Other builders' dev servers on ports 3521-3654 were left alone.


---

# QA round 2 (deeper pass: Clients, Pipeline, Payments, Find a lead; dark mode and widths)

Method: dev server (all flags on, demo company in the dev database) with the sample switches (clfx, plfx, pmfx), real demo data where it exists, Playwright walks at 1440 (dark and light), then a layout probe at 390 and 768 in dark mode on Today, Account audit, Appointments, Team, Clients (with its new Money tab), Pipeline, Payments, Find a lead, Clean-up, Workflows and Settings (sideways scroll, 44 px taps, vendor words, low-contrast text).
Limits (honest): the dev database link is slow (14 to 40 s per request, and two browsers at once cause "taking too long" screens that are the test's own load, not the app). The demo company is read-only on the server ("The sample data cannot be changed."), so saving a view, adding a note, bulk apply, adding a dispute and deleting could only be walked as far as the refusal message; the typed-name confirmations were read in code and are covered by the existing server tests. Payments has no real rows in the demo, so its queue and side panel were walked on the sample switch. The disk filled up once during the run (other builders' files); the server was restarted and the scans redone.

## Fixed in this PR
| Module | Defect | Severity | Status |
|---|---|---|---|
| Pipeline | Clicking a coin stack (or any list of deals) crashed the whole page ("This page couldn't load"): the role labels read an answer without the expected shape | blocks going live | fixed (answer checked before use); stack drill verified to open its deals |
| Find a lead | A search ("ma") looped (too many updates), fired the read again and again and could show "Nobody matches" instead of the people | blocks going live | fixed (the loader depends on the text of the choices only; search term kept stable); 152 people, 50 rows, Load more to 100 of 152 verified |
| Clients > Accounts, Payments | Saved views were named and deleted in a browser pop-up, which is blocked inside some embedded frames and then does nothing | annoying (silent failure) | fixed: small form on the page; delete needs the view's name typed |
| Clients > Health and risk | Printed "undefined of undefined clients" | annoying | fixed |
| Clients > account page | "Why Needs permission?" shown on an account where nothing was refused (the real cause was old data) | annoying (misleading) | fixed: shows only when a read was refused, otherwise "What needs fixing here?" |
| Pipeline, Team | "n/a" in Days to win and Rank | polish | fixed (plain words) |
| All | Identical reads fired together by different parts of a screen (options, freshness, roles, pipelines) went out twice or more | speed | fixed: one shared read; any change drops the shared reads so a refresh after a change always asks again |
| Phone (390) | Bell, Sync now, Search people, feedback links, Open arrows and pager buttons were 36 to 39 px | annoying | fixed to 44 px |

## Left
| Module | Defect | Severity |
|---|---|---|
| All | First screens fire 7 to 11 calls (shell: freshness, segments, usage, dialer, notifications, roles, plus the screen's own). In dev every call is also doubled by React's check mode, so production is about half. Pipeline Needs attention 17 calls in one click; each call takes 14 to 40 s on this link. Measure on production before switching on. | blocks going live until measured |
| Pipeline > Money flow | The money-flow read is asked by the card grid and the picker separately (now shared while in flight) | speed (improved) |
| Demo company | Plans and Payments are empty ("Plans not read yet", "Last read: Never"), so plan states past due / cancelled were seen only on the sample switch | polish |
| Clients, Pipeline | Saved views in Pipeline and Payments live in this browser only (not shared with the team) | annoying |
| Appointments | "How Appointments works" link is 19 px tall at 390 | polish |
| Walk limits | Write paths (notes, bulk apply, disputes, deal delete) not run end to end because the demo is read-only | unverified on live |

## Verdicts (round 2)
- Clients (v2 table, filters, account page, notes, bulk preview, plans, Money tab, health): ready to switch on after the speed check. Every count equalled its rows (13 accounts, 13 rows; search 1 of 13; Quiet 4 = 4 rows); the bulk bar and preview worked and refused politely on the demo.
- Pipeline: was "fix first" (page crash on every drill); fixed, ready to switch on after the speed check.
- Payments: ready to switch on (sample walk: 5 items = 5 rows, side panel never blank, plain notices, no vendor words); verify with a real payments account.
- Find a lead: was "fix first" (search loop); fixed, ready to switch on after the speed check. Tag and note previews show the names and the count; Change owner is explained when the ticked people are in different accounts.
- Today, Account audit, Appointments (incl. Leadership), Team, Clean-up, Workflows, Settings at 390 and 768 dark: see the probe lines below.

### Probe lines (dark mode)
- 390 dark: no sideways scroll and no vendor words on Today (Today, Recover, Proof), Account audit, Appointments (Overview, Needs outcome, No-show recovery), Team, Clients (Overview, Money, Accounts), Pipeline, Payments, Find a lead, Clean-up, Workflows, Settings. No low-contrast text found. Small taps found and fixed: bell, Sync now, Search people, feedback links, Open arrows, pager, section tabs, guide link, Accounts arrow.
- 768 dark: Today, Account audit, Team, Clients and Pipeline fit. Appointments scrolled sideways by 5 px (the Last 7 / 30 / 90 / Custom buttons): fixed and re-measured (0 px). The 768 pass for Payments, Find a lead, Clean-up, Workflows and Settings was not finished (the scan was stopped for time); they fit at 390 and 1440.
- Also fixed: the page-open counter returned a 400 on every open of Clean-up, Data health and Integrations; a duplicate-key warning in the duplicates tag list.
- Still small on a phone (left): Workflows list controls (36 to 39 px, about 120 of them), Clean-up radio "Keep ..." (21 px) and "Call in your CRM" (39 px), the account picker in the bar (43 px). A "same key" warning also appears once in Clean-up or Workflows on the demo (source not found).
- Speed: each screen's calls are listed under Left; no single call was measured on production.

Checks: tsc clean, 1627 unit tests pass (1 skipped), eslint clean on touched files, PR checks below. My dev server on port 3670 is stopped.
