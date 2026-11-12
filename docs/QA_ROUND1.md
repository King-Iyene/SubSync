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
