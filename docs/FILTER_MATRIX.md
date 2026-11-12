# Filter matrix (date bar and client accounts)

Rule: the date bar in the shell is the ONE range of the app. Code reads it with `usePageRange()` (`src/app/app/ds/page-range.tsx`), or `useCardRange()` which starts from it. Result words: PASS follows the bar and the label shows it; FIXED was failing and is now PASS; OWN means a screen deliberately uses its own window and says so on screen with the reason. VERIFIED here: typecheck, 1633 unit tests, a real browser click-test of the bar (custom 15 Dec 2023 to 11 Nov 2026: label right, address `r.page=custom:...`, reads asked for the new window, "Updating the numbers" shown). NOT verified: numbers per module (this machine has no database; run the manual steps at the end).

Root cause of the reported bug: a custom range over 366 days was refused in silence (the bar never showed the reason) and the app fell back to the last 30 days. Now the limit is ONE shared constant (1096 days, `range-limits.ts`) used by the bar and every server reader, typed dates are checked before Apply with a plain reason, and a problem is always shown.

| Module | Range | Accounts | Before | Now |
|---|---|---|---|---|
| Speed to lead (home, Race, Pace, Coverage, People, Capture) | bar | bar | silent fallback | FIXED |
| Speed: coverage "last 30 days" captions, Proof receipt text | bar for data | bar | hard-coded text | OWN (text names its window) |
| Unanswered | right now | bar | n/a | OWN (note under bar) |
| Appointments (module and older screens) | bar; own "Appointment date" is a labelled override with "Use the bar's dates" | bar | two controls disagreed | FIXED |
| Appointments worklists (no-show recovery 7/14 days) | fixed horizon | bar | n/a | OWN (stated) |
| Pipeline (module) | bar | bar | own 30/45/90 | FIXED |
| Pipeline forecast win rate (last year) | fixed | bar | n/a | OWN (in the formula) |
| Clients (module: overview, needs, trends, compare, people) | bar | bar | own 7/30/90 | FIXED |
| Clients older trends and compare (cards) | bar, card override labelled | bar | started at 90d | FIXED |
| Clients Money, Plans, Accounts | right now (plan state) | bar | n/a | OWN (note) |
| Team (module, all period tabs; receipt max 90 days says so) | bar | bar | own 7/28/90 | FIXED |
| Today queue | right now | one choice shared with all pages | Today kept its own choice | FIXED (accounts) / OWN (queue) |
| Today > Numbers | bar (server takes from/to) | bar | own 7/30/90 | FIXED |
| Today growth, flow, clients, forecast, sources, coverage, proof tabs | bar until the tab picks its own dates ("Dates at the top of the page") | bar | own defaults | FIXED |
| Today front-page KPIs (last 7 / 30 days) | fixed snapshot | bar | n/a | OWN (labelled) |
| Today / Recover (wallet), receipts | weekly receipts | bar | n/a | OWN (weekly) |
| Payments Today, History | bar (recovered, refunds, history; label shows dates) | bar | fixed 30/90 days | FIXED |
| Payments queue and CSV | bar (day a problem was flagged) | bar | no date filter | FIXED |
| Payments disputes | bar (opened or evidence due in range) | bar | no date filter | FIXED |
| Payments upcoming | none: platform gives no due dates, tab says so | bar | n/a | OWN (stated) |
| Account audit | right now | bar | n/a | OWN (note) |
| Find lead (People search), Lead intake | right now | bar | n/a | OWN (note) |
| Clean-up, Duplicates, Data health | right now | bar | n/a | OWN (note) |
| Workflows overview | platform's own last 30 days | dates only | n/a | OWN (note) |
| Workflows Proof | bar | dates only | own 7/30 | FIXED |
| Meeting notes | bar (by meeting day) | n/a | no date filter | FIXED |

Cross-cutting
- Label: always the applied range; typed range needs Apply; reason shown for a bad one; Reset; compare-with-previous toggle (`pc=prev`); "Updating the numbers" while reads are in flight. FIXED.
- Stale data: `useData` drops an answer made for another window or another set of client accounts (key = account filter + from/to) and shows Loading. FIXED.
- Server caches key on the full query string and the allowed accounts, so a new range or account never reuses an old answer. PASS.
- Persistence: address (`r.page`, `pc`) first, then this tab (custom) or this browser (preset). FIXED.
- Accounts: choosing clients on any page sets Today's choice and the shared filter together. FIXED. Opening from inside a client account starts both on that account.
- Found and fixed on the way: the "booked on" filter of Appointments and the executive tab never matched (a date pattern written without its backslashes), so it was ignored.
- "History starts <date>": shown where the screen knows it (Today Numbers, Payments, Clients); a range that starts earlier says the older part is empty.

Manual check (needs a database): set Custom 15/12/2023 to 11/11/2026, press Apply, open each row above marked FIXED and confirm the numbers change from the last-30-days figures; reload; open another page and back; press Reset.
